import type { AuthorizationContextV1, SpatialScopeRefV1 } from "@riskflow/contracts/ports";
import {
  canonicalDecimalToString,
  isCanonicalDecimal,
  parseCanonicalDecimal,
  type ForecastPolicyV1,
} from "@riskflow/core/assessment-config";
import {
  computeEffectForecast,
  EFFECT_FORECAST_MODEL_MAX_ARTIFACT_BYTES_V1,
  type EffectForecastExecutorV1,
  type EffectForecastModelArtifactV1,
  type ForecastAlignedPointV1,
  type ResponseForecastExecutorRequestV1,
  type ResponseForecastExecutorResultV1,
  type ResponseForecastUnavailableReasonV1,
} from "@riskflow/core/response-lifecycle";
import type {
  ForecastRiskStatePortV1,
  ForecastRiskStateRequestV1,
} from "@riskflow/core/risk-assessment/engine";

import type { EffectForecastModelReaderV1 } from "./forecast-model-reader.js";

/**
 * 生产预测执行器工厂（design D-07）。
 *
 * 每个已发布 C18 预测策略的精确 `requiredRef` 装配唯一实现：执行器只走「读模型工件 →
 * 代入参数 → 求值 → 取 C25 预测风险状态」这条固定通路，不夹带默认参数、默认措施效果或方法
 * 回退。模型工件读不到、样本不足、工具失败与预算耗尽都收敛为受控不可用，由 C28 原子收口。
 */

export interface EffectForecastExecutorBudgetV1 {
  /** 模型工件正文的硬上限；超出即不可用，不做截断解析。 */
  readonly maxModelArtifactBytes: number;
}

export const DEFAULT_EFFECT_FORECAST_EXECUTOR_BUDGET_V1: EffectForecastExecutorBudgetV1 = {
  maxModelArtifactBytes: EFFECT_FORECAST_MODEL_MAX_ARTIFACT_BYTES_V1,
};

/** 执行器只在既有精确分支上取得读取能力：模型工件走 C04 成员读取，风险状态走 C25 输入快照读取。 */
export const EFFECT_FORECAST_AUTHORIZATION_BRANCHES_V1 = [
  "knowledge-modeling.measure-candidates",
  "risk-assessment.read-input-snapshot",
] as const;

export type EffectForecastAuthorizationBranchV1 =
  (typeof EFFECT_FORECAST_AUTHORIZATION_BRANCHES_V1)[number];

export type EffectForecastDownstreamAuthorizerV1 = (request: {
  readonly branch: EffectForecastAuthorizationBranchV1;
  readonly invocationId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly requestedAt: string;
  readonly requestedSpatialScopeRefs: readonly SpatialScopeRefV1[];
}) => Promise<AuthorizationContextV1>;

export interface ProductionEffectForecastExecutorsOptionsV1 {
  /** 已发布 C18 预测策略；工厂按 `requiredRef` 唯一装配，不接受运行期再选择。 */
  readonly policies: readonly ForecastPolicyV1[];
  /** C04 受权模型工件读取端口：由部署组合根注入真实实现。 */
  readonly models: EffectForecastModelReaderV1;
  /** C25 评估所有者的窄预测端口。 */
  readonly assessment: ForecastRiskStatePortV1;
  /** C06 下游授权签发：执行器以调用者身份在各自分支上取得能力。 */
  readonly authorizeDownstream: EffectForecastDownstreamAuthorizerV1;
  readonly budget?: EffectForecastExecutorBudgetV1;
}

/** 计算不可用/拒绝原因到 C28 公开原因码的唯一映射。 */
const computationReason = (reason: string): ResponseForecastUnavailableReasonV1 =>
  reason === "input-indicator-missing" ? "input-indicator-missing" : "policy-unavailable";

/** C25 预测风险状态的受控不可用到公开原因码的唯一映射。 */
const projectionReason = (reasonCode: string): ResponseForecastUnavailableReasonV1 =>
  reasonCode === "monitoring-series-mismatch"
    ? "monitoring-snapshot-unavailable"
    : "target-indicator-unsupported";

/**
 * 规范十进制预测值必须能被现有评分标量无损承载：C25 的预测入参是数值，转换有损时关闭失败，
 * 不允许四舍五入后当成一次正式预测。
 */
const asScoringScalar = (value: string): number | undefined => {
  const scalar = Number(value);
  return Number.isFinite(scalar) &&
    canonicalDecimalToString(parseCanonicalDecimal(String(scalar))) === value
    ? scalar
    : undefined;
};

/**
 * 基线取值：规范十进制字符串直接采用；数值只在能被精确表示为同一个规范十进制时采用。
 * 布尔与非规范字符串一律丢弃——它们不参与计算，随后按缺输入收敛为受控不可用。
 * 这与预测值出参用同一条「无损可表示」规则，两端不各用一套换算。
 */
const baselineOf = (
  request: ResponseForecastExecutorRequestV1,
): readonly { indicatorId: string; value: string }[] =>
  request.baseline.indicatorValues.flatMap((entry) => {
    if (typeof entry.value === "string") {
      return isCanonicalDecimal(entry.value)
        ? [{ indicatorId: entry.indicatorItem, value: entry.value }]
        : [];
    }
    if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) return [];
    const text = canonicalDecimalToString(parseCanonicalDecimal(String(entry.value)));
    return isCanonicalDecimal(text) ? [{ indicatorId: entry.indicatorItem, value: text }] : [];
  });

const alignedPointsOf = (
  request: ResponseForecastExecutorRequestV1,
): readonly ForecastAlignedPointV1[] =>
  request.monitoringSnapshot.alignedPoints.map((point) => ({
    sampledAt: point.sampledAt,
    value: point.value,
    unit: point.unit,
    status: point.status,
  }));

/**
 * 模型工件必须逐字复述策略与冻结建议的身份：方法、目标指标、单位、时域与措施库版本都要对上。
 * 措施效果因此只能来自与建议同版本的措施库，不接受模型自带的效果表。
 */
const consistentWithPolicy = (
  model: EffectForecastModelArtifactV1,
  policy: ForecastPolicyV1,
  measureLibraryReleaseRef: { readonly entityId: string; readonly versionId: string },
): boolean =>
  model.method === policy.method &&
  model.targetIndicatorId === policy.targetIndicatorId &&
  model.unit === policy.unit &&
  policy.horizonSteps <= model.maxHorizonSteps &&
  model.measureLibraryReleaseRef.entityId === measureLibraryReleaseRef.entityId &&
  model.measureLibraryReleaseRef.versionId === measureLibraryReleaseRef.versionId;

/** 组装 C25 窄预测请求：受权身份、基线记录、冻结依据与执行前快照全部按精确引用下发。 */
const riskStateRequest = (
  request: ResponseForecastExecutorRequestV1,
  authorization: AuthorizationContextV1,
  predictedValue: number,
): ForecastRiskStateRequestV1 => ({
  requestId: `${request.commandId}:risk-state`,
  idempotencyKey: `${request.commandId}:risk-state`,
  requestedAt: request.caller.requestedAt,
  projectId: request.caller.projectId,
  actorId: request.caller.actorId,
  authorization,
  baselineAssessmentRecordRef: request.baselineAssessmentRecordRef,
  frozenAssessmentBasisRef: request.snapshot.frozenAssessmentBasisRef,
  preActionMonitoringSnapshotRef: request.snapshot.preActionMonitoringSnapshotRef,
  targetIndicatorId: request.policy.targetIndicatorId,
  targetUnit: request.policy.unit,
  predictedValue,
});

const createExecutor = (
  policy: ForecastPolicyV1,
  models: EffectForecastModelReaderV1,
  assessment: ForecastRiskStatePortV1,
  authorizeDownstream: EffectForecastDownstreamAuthorizerV1,
  budget: EffectForecastExecutorBudgetV1,
): EffectForecastExecutorV1 => ({
  method: policy.method,
  requiredRef: policy.requiredRef,
  async forecast(request): Promise<ResponseForecastExecutorResultV1> {
    const echo = {
      method: policy.method,
      requiredRef: policy.requiredRef,
      targetIndicatorId: policy.targetIndicatorId,
      unit: policy.unit,
      horizonSteps: policy.horizonSteps,
      summary: `${policy.method}-${policy.targetIndicatorId}-${policy.horizonSteps}`,
    };
    const identity = {
      projectId: request.caller.projectId,
      actorId: request.caller.actorId,
      requestedAt: request.caller.requestedAt,
      requestedSpatialScopeRefs: request.caller.spatialScopeRefs,
    };
    // 1) 读模型工件：按策略精确 requiredRef、在调用者身份下、受权且有界。
    const artifact = await models.readModelArtifact({
      invocationId: `${request.commandId}:model`,
      authorization: await authorizeDownstream({
        ...identity,
        branch: "knowledge-modeling.measure-candidates",
        invocationId: `${request.commandId}:model`,
      }),
      modelRef: policy.requiredRef,
      maxBytes: budget.maxModelArtifactBytes,
    });
    if (artifact.kind !== "succeeded") {
      return { ...echo, availability: "unavailable", reasonCode: "policy-unavailable" };
    }
    const model = artifact.model;
    if (!consistentWithPolicy(model, policy, request.measureLibraryReleaseRef)) {
      return { ...echo, availability: "unavailable", reasonCode: "policy-unavailable" };
    }
    const evidenceReferences = [...model.evidenceReferences];
    // 2) 代入参数求值：三种方法互不回退，缺输入与非法模型各自按受控结果收敛。
    const computed =
      policy.method === "monitoring-trend"
        ? computeEffectForecast({
            method: policy.method,
            model,
            horizonSteps: policy.horizonSteps,
            cutoff: request.monitoringSnapshot.cutoff,
            alignedPoints: alignedPointsOf(request),
            measures: [...request.measures],
          })
        : computeEffectForecast({
            method: policy.method,
            model,
            horizonSteps: policy.horizonSteps,
            baselineValues: baselineOf(request),
            measures: [...request.measures],
          });
    if (computed.kind === "unavailable") {
      return {
        ...echo,
        availability: "unavailable",
        reasonCode: computationReason(computed.reason),
        evidenceReferences,
      };
    }
    if (computed.kind === "rejected") {
      return {
        ...echo,
        availability: "unavailable",
        reasonCode: computationReason(computed.reason),
      };
    }
    // 3) 取 C25 预测风险状态：执行器不自行评分或映射矩阵。
    const predictedValue = asScoringScalar(computed.value);
    if (predictedValue === undefined) {
      return { ...echo, availability: "unavailable", reasonCode: "target-indicator-unsupported" };
    }
    const projection = await assessment.projectForecastRiskState(
      riskStateRequest(
        request,
        await authorizeDownstream({
          ...identity,
          branch: "risk-assessment.read-input-snapshot",
          invocationId: `${request.commandId}:risk-state`,
        }),
        predictedValue,
      ),
    );
    if (projection.kind === "unavailable") {
      return {
        ...echo,
        availability: "unavailable",
        reasonCode: projectionReason(projection.reasonCode),
        evidenceReferences,
      };
    }
    if (projection.kind === "failed") {
      return { ...echo, availability: "unavailable", reasonCode: "executor-unavailable" };
    }
    return {
      ...echo,
      availability: "available",
      predictedValue: computed.value,
      predictedRiskState: projection.riskState,
      evidenceReferences,
    };
  },
});

/**
 * 按已发布策略装配执行器集合。同一个 `requiredRef` 重复出现时不静默取第一条：装配重复会让
 * 「每个精确 requiredRef 唯一实现」失效，直接失败而不是任意挑一个。
 */
export const createProductionEffectForecastExecutorsV1 = (
  options: ProductionEffectForecastExecutorsOptionsV1,
): readonly EffectForecastExecutorV1[] => {
  const budget = options.budget ?? DEFAULT_EFFECT_FORECAST_EXECUTOR_BUDGET_V1;
  const seen = new Set<string>();
  for (const policy of options.policies) {
    const key = `${policy.method}:${policy.requiredRef.entityId}@${policy.requiredRef.versionId}`;
    if (seen.has(key)) throw new Error(`duplicate forecast policy ${key}`);
    seen.add(key);
  }
  return options.policies.map((policy) =>
    createExecutor(policy, options.models, options.assessment, options.authorizeDownstream, budget),
  );
};
