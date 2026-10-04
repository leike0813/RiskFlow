import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ForecastPolicyV1 } from "@riskflow/core/assessment-config";
import { EFFECT_FORECAST_MODEL_ALGORITHM_VERSION_V1 } from "@riskflow/core/response-lifecycle";
import {
  createEffectForecastModelReaderV1,
  createProductionEffectForecastExecutorsV1,
} from "../../src/response-lifecycle/index.js";

import {
  C28_FORECAST_REQUIRED_REF,
  C28_TARGET_INDICATOR,
  C28_TARGET_UNIT,
  startResponseLifecycleFixture,
  type ResponseLifecyclePostgresFixtureV1,
} from "./fixture.js";

/**
 * 生产预测执行器的集成链：真实 C04 模型工件、真实 C06 授权、真实 C25 预测风险状态投影，
 * 再经 C28 正式 adapter 原子收口。模型参数是本用例显式声明的合成值，
 * 代表「合成样本、待甲方复核」，不代表真实模型推理质量或甲方正式规则已经交付。
 */

let fixture: ResponseLifecyclePostgresFixtureV1 | undefined;

const PG_TIMEOUT_MS = 300_000;
const pgIt = (name: string, body: () => Promise<unknown>): void => {
  void it(name, body, PG_TIMEOUT_MS);
};

const MEASURE = "measure-grouting";
const MODEL_EVIDENCE = {
  locator: { sourceSegmentId: "c28-forecast-model-sample" },
  sourceVersion: { entityId: "source-version-c28", versionId: "1" },
};

const modelBase = {
  schemaVersion: "1",
  algorithmVersion: EFFECT_FORECAST_MODEL_ALGORITHM_VERSION_V1,
  targetIndicatorId: C28_TARGET_INDICATOR,
  unit: C28_TARGET_UNIT,
  stepMs: 1000,
  maxHorizonSteps: 720,
  calculationScale: 2,
  measureEffects: [{ measureId: MEASURE, offset: "0", perStep: "0" }],
  evidenceReferences: [MODEL_EVIDENCE],
  sampleOrigin: "synthetic",
  reviewStatus: "pending-client-review",
} as const;

const historicalModel = (parameters: Record<string, unknown>) => ({
  ...modelBase,
  method: "historical-statistics",
  inputIndicators: [{ indicatorId: "indicator-possibility-1", unit: "1" }],
  parameters: {
    intercept: "0",
    inputCoefficients: [{ coefficient: "1" }],
    horizonCoefficient: "0",
    fitSampleCount: 240,
    ...parameters,
  },
});

/** 走一次真实建议链到预测，命令标识可独立指定以免互相撞幂等键。 */
const adoptedForecast = async (state: ResponseLifecyclePostgresFixtureV1, prefix: string) => {
  const prepared = await state.prepareRecommendation({ prefix });
  const scope = await state.recommendationScope(prepared.recommendationRef);
  const binding = state.binding({
    suffix: prefix,
    recommendationRef: prepared.recommendationRef,
    spatialScopeRef: scope,
  });
  const decision = await state.recordDecision(
    await state.decisionCommand({
      commandId: `${prefix}-decision`,
      decision: "adopted",
      binding,
    }),
  );
  if (decision.kind !== "succeeded") {
    throw new Error(`adoption failed: ${JSON.stringify(decision).slice(0, 400)}`);
  }
  const snapshot = state.forecastSnapshot({
    recommendationRef: prepared.recommendationRef,
    routeDecisionRef: binding.routeDecisionRef,
    preActionMonitoringSnapshotRef: prepared.preActionMonitoringSnapshotRef,
    basisRef: prepared.baselineAssessmentInputSnapshotRef,
    forecastPolicyRef: state.forecastPolicyReleaseRef,
    authorizationContextRef: {
      kind: "authorization-context",
      reference: { entityId: "placeholder", versionId: "1" },
    },
  });
  const command = await state.forecastCommand({
    commandId: `${prefix}-forecast`,
    binding,
    snapshotRef: snapshot.ref,
    snapshot: snapshot.body,
    ...{ spatialScope: "root" as const },
  });
  // 计数点取在建议链完成之后、预测之前：建议链本身会新建一次 C25 评估，不属于预测的写入。
  const before = {
    assessments: await countAssessmentRows(state, "risk_assessment_records"),
    valueSets: await countAssessmentRows(state, "indicator_actual_value_sets"),
    warnings: await countAssessmentRows(state, "warning_records"),
  };
  const result = await state.forecastResponse({
    ...command,
    payload: {
      ...command.payload,
      forecastInputSnapshot: {
        ...command.payload.forecastInputSnapshot,
        authorizationContextRef: command.authorization.authorizationContextRef,
      },
    },
  });
  if (result.kind !== "succeeded") {
    throw new Error(`forecast failed: ${JSON.stringify(result).slice(0, 400)}`);
  }
  return { outcome: result.result.outcome, before };
};

/** 预测前后对 C25 实际事实表做行数对比：预测是纯只读投影。 */
const countAssessmentRows = async (
  state: ResponseLifecyclePostgresFixtureV1,
  table: string,
): Promise<number> => {
  const result = await state.recommendation.c26.c25.postgres.postgres.adminPool.query<{
    count: string;
  }>(`SELECT COUNT(*)::text AS count FROM business.${table} WHERE project_id = $1`, [
    state.projectId,
  ]);
  return Number(result.rows[0]?.count ?? "0");
};

/** 按已发布策略装配生产执行器：C04 读取与 C25 投影都走真实实现。 */
const installExecutors = (
  state: ResponseLifecyclePostgresFixtureV1,
  policies: readonly ForecastPolicyV1[],
): void => {
  state.setExecutors(
    createProductionEffectForecastExecutorsV1({
      policies,
      models: createEffectForecastModelReaderV1({
        artifactStore: state.recommendation.c26.c25.postgres.artifactStore,
      }),
      assessment: state.assessment,
      authorizeDownstream: (request) => state.authorizeDownstream(request as never),
    }),
  );
};

/**
 * 发布模型工件 → 用 put 返回的真实引用发布对应策略 → 装配生产执行器 → 走一次建议链。
 * `requiredRef` 必须逐字等于 C04 实际持有的工件引用，因此策略在工件发布之后才组装。
 */
const forecastWithModel = async (input: {
  readonly prefix: string;
  readonly artifactId: string;
  readonly model: Record<string, unknown>;
  readonly policyId: string;
  readonly method: ForecastPolicyV1["method"];
  readonly inputIndicatorIds: readonly string[];
}) => {
  const state = fixture!;
  const modelRef = await state.publishForecastModel({
    artifactId: input.artifactId,
    model: { ...input.model, projectId: state.projectId },
  });
  const policy: ForecastPolicyV1 = {
    policyId: input.policyId,
    method: input.method,
    inputIndicatorIds: input.inputIndicatorIds,
    targetIndicatorId: C28_TARGET_INDICATOR,
    horizonSteps: 5,
    unit: C28_TARGET_UNIT,
    requiredRef: modelRef.reference,
  };
  await state.setForecastPolicies([policy]);
  installExecutors(state, [policy]);
  return await adoptedForecast(state, input.prefix);
};

const boundModel = (
  state: ResponseLifecyclePostgresFixtureV1,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  ...overrides,
  projectId: state.projectId,
  measureLibraryReleaseRef: state.measureLibraryReleaseRef,
});
describe("C28 生产预测执行器工厂", () => {
  beforeAll(async () => {
    fixture = await startResponseLifecycleFixture();
    // C25 冻结依据是在工程根空间与工程来源下复验的；组合根按工程活动空间集合签发精确上下文。
  }, 900_000);

  afterAll(async () => {
    await fixture?.close();
  });

  pgIt("同一策略重复装配被拒绝，不静默挑一个", () => {
    const state = fixture!;
    const policy: ForecastPolicyV1 = {
      policyId: "c28-duplicate-policy",
      method: "historical-statistics",
      inputIndicatorIds: ["indicator-possibility-1"],
      targetIndicatorId: C28_TARGET_INDICATOR,
      horizonSteps: 5,
      unit: C28_TARGET_UNIT,
      requiredRef: C28_FORECAST_REQUIRED_REF,
    };
    expect(() =>
      installExecutors(state, [
        policy,
        { ...policy, inputIndicatorIds: [...policy.inputIndicatorIds].reverse() },
      ]),
    ).toThrow();
  });

  pgIt("历史统计方法按真实模型工件预测，风险状态来自 C25 投影", async () => {
    const state = fixture!;
    const forecast = await forecastWithModel({
      prefix: "c28-factory-statistics",
      artifactId: "c28-forecast-statistics-model",
      policyId: "c28-forecast-statistics",
      method: "historical-statistics",
      inputIndicatorIds: ["indicator-possibility-1"],
      model: boundModel(state, historicalModel({ inputCoefficients: [{ coefficient: "2" }] })),
    });
    expect(forecast.outcome.availability.kind, JSON.stringify(forecast.outcome.availability)).toBe(
      "available",
    );
    if (
      forecast.outcome.availability.kind !== "available" ||
      forecast.outcome.projected?.kind !== "available"
    ) {
      throw new Error(
        `expected an available forecast: ${JSON.stringify(forecast.outcome.availability)} ${JSON.stringify(forecast.outcome.projected)}`,
      );
    }
    // 预测值真的来自模型参数代入：全零系数模型给出精确零，非零系数给出非零值。
    expect(Number(forecast.outcome.projected.predictedValue)).toBeGreaterThan(0);
    // 风险状态由 C25 用冻结依据重算：等级必须落在冻结矩阵内，且两轴都是有限分。
    expect(forecast.outcome.projected.predictedRiskState.riskLevel).toMatch(/^level-\d$/u);
    expect(Number.isFinite(forecast.outcome.projected.predictedRiskState.likelihoodScore)).toBe(
      true,
    );
    expect(Number.isFinite(forecast.outcome.projected.predictedRiskState.consequenceScore)).toBe(
      true,
    );
    // 证据来自模型工件，不来自执行器自身。
    expect(forecast.outcome.projected.evidenceReferences).toEqual([MODEL_EVIDENCE]);

    const zeroForecast = await forecastWithModel({
      prefix: "c28-factory-zero",
      artifactId: "c28-forecast-zero-model",
      policyId: "c28-forecast-zero",
      method: "historical-statistics",
      inputIndicatorIds: ["indicator-possibility-1"],
      model: boundModel(
        state,
        historicalModel({
          intercept: "0",
          inputCoefficients: [{ coefficient: "0" }],
          horizonCoefficient: "0",
        }),
      ),
    });
    expect(zeroForecast.outcome.projected?.kind).toBe("available");
    if (zeroForecast.outcome.projected?.kind === "available") {
      expect(zeroForecast.outcome.projected.predictedValue).toBe("0");
    }
  });

  pgIt("模型工件不满足 Schema 时交回受控不可用，不回退到基线值", async () => {
    const forecast = await forecastWithModel({
      prefix: "c28-factory-broken",
      artifactId: "c28-forecast-broken-model",
      policyId: "c28-forecast-broken",
      method: "historical-statistics",
      inputIndicatorIds: ["indicator-possibility-1"],
      model: { method: "historical-statistics" },
    });
    expect(forecast.outcome.availability).toEqual({
      kind: "unavailable",
      reasonCode: "policy-unavailable",
    });
    expect(forecast.outcome.projected?.kind).toBe("unavailable");
    expect(forecast.outcome.projected).not.toHaveProperty("predictedValue");
  });

  pgIt("模型措施效果绑定非正式措施库版本时不可用", async () => {
    const state = fixture!;
    const forecast = await forecastWithModel({
      prefix: "c28-factory-library",
      artifactId: "c28-forecast-library-mismatch",
      policyId: "c28-forecast-library",
      method: "historical-statistics",
      inputIndicatorIds: ["indicator-possibility-1"],
      model: {
        ...boundModel(state, historicalModel({})),
        measureLibraryReleaseRef: { entityId: "other-measure-library", versionId: "9" },
      },
    });
    // 措施效果不是模型自带的：与建议同一措施库版本才对得上，否则不接受。
    expect(forecast.outcome.availability).toEqual({
      kind: "unavailable",
      reasonCode: "policy-unavailable",
    });
  });

  pgIt("趋势与机理方法各自走真实模型工件与真实 C25 投影", async () => {
    const state = fixture!;
    const trendForecast = await forecastWithModel({
      prefix: "c28-factory-trend",
      artifactId: "c28-forecast-trend-model",
      policyId: "c28-forecast-trend",
      method: "monitoring-trend",
      inputIndicatorIds: [C28_TARGET_INDICATOR],
      model: boundModel(state, {
        ...modelBase,
        method: "monitoring-trend",
        inputIndicators: [{ indicatorId: C28_TARGET_INDICATOR, unit: C28_TARGET_UNIT }],
        parameters: { windowPoints: 5 },
      }),
    });
    const mechanismForecast = await forecastWithModel({
      prefix: "c28-factory-mechanism",
      artifactId: "c28-forecast-mechanism-model",
      policyId: "c28-forecast-mechanism",
      method: "mechanism-model",
      inputIndicatorIds: ["indicator-possibility-1"],
      model: boundModel(state, {
        ...modelBase,
        method: "mechanism-model",
        inputIndicators: [{ indicatorId: "indicator-possibility-1", unit: "1" }],
        parameters: {
          intercept: "0",
          terms: [{ indicatorId: "indicator-possibility-1", power: 1, coefficient: "1" }],
          horizonCoefficient: "0",
          inputDomains: [
            { indicatorId: "indicator-possibility-1", domain: { lower: "-1000", upper: "1000" } },
          ],
          outputDomain: { lower: "-10000", upper: "10000" },
        },
      }),
    });
    for (const [prefix, outcome] of [
      ["trend", trendForecast.outcome],
      ["mechanism", mechanismForecast.outcome],
    ] as const) {
      expect(outcome.availability.kind, `${prefix} ${JSON.stringify(outcome.availability)}`).toBe(
        "available",
      );
      expect(outcome.projected?.kind, prefix).toBe("available");
      if (outcome.projected?.kind === "available") {
        expect(Number.isFinite(Number(outcome.projected.predictedValue)), prefix).toBe(true);
        expect(outcome.projected.predictedRiskState.riskLevel, prefix).toMatch(/^level-\d$/u);
      }
    }
  });

  pgIt("预测不写任何实际事实，也不新增评估记录或预警", async () => {
    const state = fixture!;
    const forecast = await forecastWithModel({
      prefix: "c28-factory-pure",
      artifactId: "c28-forecast-pure-model",
      policyId: "c28-forecast-pure",
      method: "historical-statistics",
      inputIndicatorIds: ["indicator-possibility-1"],
      model: boundModel(state, historicalModel({ inputCoefficients: [{ coefficient: "1" }] })),
    });
    expect(forecast.outcome.availability.kind).toBe("available");
    expect(await countAssessmentRows(state, "risk_assessment_records")).toBe(
      forecast.before.assessments,
    );
    expect(await countAssessmentRows(state, "indicator_actual_value_sets")).toBe(
      forecast.before.valueSets,
    );
    expect(await countAssessmentRows(state, "warning_records")).toBe(forecast.before.warnings);
  });
});
