/**
 * C41 人工决定与反馈命令接线自有事实 Schema（design D1/D3/D4）。
 *
 * 本模块只定义 C41 自己的终局决定索引与反馈冻结输入行：命令、结果与反馈输入快照正文一律引用
 * `@riskflow/contracts` 的单一公共 Schema，不复制 C27/C28/C25 的任何字段，也不另造第二套反馈正文。
 */
import { z } from "zod";

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import {
  AuditTrailRefV1Schema,
  EffectForecastRefV1Schema,
  ExecutionRecordRefV1Schema,
  ModuleErrorV1Schema,
  ResponseRecommendationRefV1Schema,
  RiskAssessmentRecordRefV1Schema,
  RouteDecisionRefV1Schema,
  SpatialScopeRefV1Schema,
  WorkflowRunRefV1Schema,
  type ModuleCapabilityV1,
  type ModuleErrorV1,
} from "@riskflow/contracts/ports";
import { ResponseFeedbackInputSnapshotV1Schema } from "@riskflow/contracts/workflows";

export const HUMAN_DECISION_FEEDBACK_SCHEMA_VERSION_V1 = "1" as const;

const schemaVersion = z.literal(HUMAN_DECISION_FEEDBACK_SCHEMA_VERSION_V1);
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);

/* -------------------------------------------------------------------------- */
/* D3：C41 自有终局决定索引                                                    */
/* -------------------------------------------------------------------------- */

/** 决定状态：进行中只允许原键同载荷继续；`adopted` 与 `declined` 是互斥终局（design D3）。 */
export const HUMAN_RESPONSE_DECISION_STATES_V1 = [
  "pending-adoption",
  "adopted",
  "declined",
] as const;
export const HumanResponseDecisionStateV1Schema = z.enum(HUMAN_RESPONSE_DECISION_STATES_V1);
export type HumanResponseDecisionStateV1 = z.infer<typeof HumanResponseDecisionStateV1Schema>;

/**
 * 终局决定行：C41 是公开命令的唯一终局索引，C28 的采纳决定仍是领域事实。
 * `pending-adoption` 只携带人工输入；`adopted` 额外固定真实 C30 运行与 C28 决定引用；
 * `declined` 不携带任何运行引用，因此不可能伪装成已采纳。
 */
export const HumanResponseDecisionV1Schema = z
  .strictObject({
    schemaVersion,
    projectId: IdentifierSchema,
    /** C41 自有决定身份（`route-decision` 形态）：由工程、建议精确版本与命令身份确定。 */
    decisionRef: RouteDecisionRefV1Schema,
    responseRecommendationRef: ResponseRecommendationRefV1Schema,
    spatialScopeRef: SpatialScopeRefV1Schema,
    state: HumanResponseDecisionStateV1Schema,
    reasonCode: IdentifierSchema,
    decidedBy: IdentifierSchema,
    decidedAt: IsoDateTimeSchema,
    commandId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
    /** 规范命令载荷摘要：同键异载荷在此收口，绝不覆盖已成立事实。 */
    commandDigest: digestSchema,
    auditTrailRef: AuditTrailRefV1Schema,
    /** 采纳成立后固定的真实 C30 路由决定引用（与 C28 决定同身份）。 */
    routeDecisionRef: RouteDecisionRefV1Schema.optional(),
    forecastRunRef: WorkflowRunRefV1Schema.optional(),
    /**
     * 与绑定同值的等待点运行状态版本（drift design D-03）：恢复按这份冻结值提交，
     * 不在恢复点重新读取运行状态。与 `forecastRunRef.reference.versionId` 语义不同，
     * 可选只为历史决定可读；缺失按失败闭合处理。
     */
    waitStateVersion: IdentifierSchema.optional(),
    /** 恢复完成时点：中断的恢复由同一命令身份补齐，缺失即表示尚未推进等待运行（design D2）。 */
    resumedAt: IsoDateTimeSchema.optional(),
  })
  .superRefine((row, context) => {
    const settled = row.state === "adopted";
    if (settled && (row.routeDecisionRef === undefined || row.forecastRunRef === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "adopted decision requires the real route decision and forecast run",
      });
    }
    if (!settled && (row.routeDecisionRef !== undefined || row.forecastRunRef !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "only an adopted decision carries the forecast run binding",
      });
    }
  });
export type HumanResponseDecisionV1 = z.infer<typeof HumanResponseDecisionV1Schema>;

/** 保留结果：`reserved` 表示该命令身份拥有该建议精确版本的唯一决定，可继续推进。 */
export type HumanResponseDecisionReservationV1 =
  | { readonly kind: "reserved"; readonly decision: HumanResponseDecisionV1 }
  | { readonly kind: "conflict"; readonly detailCode: HumanDecisionFeedbackFailureCodeV1 };

/* -------------------------------------------------------------------------- */
/* D4：C41 自有反馈冻结输入                                                    */
/* -------------------------------------------------------------------------- */

/** 冻结输入状态：`prepared` 只是内部输入，不是正式反馈、成功审计或领域事件（design D4）。 */
export const HUMAN_FEEDBACK_SNAPSHOT_STATES_V1 = ["prepared", "committed"] as const;
export const HumanFeedbackSnapshotStateV1Schema = z.enum(HUMAN_FEEDBACK_SNAPSHOT_STATES_V1);
export type HumanFeedbackSnapshotStateV1 = z.infer<typeof HumanFeedbackSnapshotStateV1Schema>;

/** 精确反馈输入快照引用：与 C30/C28 消费的快照正文引用同一身份。 */
export const ResponseFeedbackInputSnapshotRefV1Schema = z.strictObject({
  kind: z.literal("response-feedback-input-snapshot"),
  reference: VersionReferenceSchema,
});
export type ResponseFeedbackInputSnapshotRefV1 = z.infer<
  typeof ResponseFeedbackInputSnapshotRefV1Schema
>;

/**
 * 反馈冻结输入行：工程 + 命令种类 + 幂等键唯一，正文不可原地修改；
 * `inputDigest` 使同键重放在同一摘要下命中既有冻结输入，异载荷失败关闭。
 */
export const HumanFeedbackInputSnapshotRowV1Schema = z.strictObject({
  schemaVersion,
  projectId: IdentifierSchema,
  feedbackInputSnapshotRef: ResponseFeedbackInputSnapshotRefV1Schema,
  commandKind: z.literal("warning-response.record-feedback"),
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  inputDigest: digestSchema,
  snapshot: ResponseFeedbackInputSnapshotV1Schema,
  /** 冻结输入所属空间：由 C25 精确证明给出，读取时按当前授权复验同一空间。 */
  spatialScopeRef: SpatialScopeRefV1Schema,
  actualAssessmentRecordRef: RiskAssessmentRecordRefV1Schema,
  executionRecordRef: ExecutionRecordRefV1Schema,
  state: HumanFeedbackSnapshotStateV1Schema,
  preparedAt: IsoDateTimeSchema,
  committedAt: IsoDateTimeSchema.optional(),
  /** 反馈分段启动时点：启动失败由同一命令身份重试，缺失即表示该段尚未启动（design D4）。 */
  segmentStartedAt: IsoDateTimeSchema.optional(),
  /**
   * C28 记录反馈时解析出的真实效果预测：反馈分段据此冻结预测，A2/A3 才能核对偏差并驱动校准。
   * 预测不可用时缺席，分段按既有 `effect-forecast-missing` 语义跳过支路，不得补造预测。
   */
  effectForecastRef: EffectForecastRefV1Schema.optional(),
  auditTrailRef: AuditTrailRefV1Schema,
});
export type HumanFeedbackInputSnapshotRowV1 = z.infer<typeof HumanFeedbackInputSnapshotRowV1Schema>;

/** 冻结结果：`prepared` 返回既有或新建的冻结行；`conflict` 表示同键异载荷或并发冲突。 */
export type HumanFeedbackSnapshotReservationV1 =
  | { readonly kind: "prepared"; readonly row: HumanFeedbackInputSnapshotRowV1 }
  | { readonly kind: "conflict"; readonly detailCode: HumanDecisionFeedbackFailureCodeV1 };

/* -------------------------------------------------------------------------- */
/* 稳定失败                                                                    */
/* -------------------------------------------------------------------------- */

/** 稳定失败原因码：只表达可枚举的接线失败，不携带上游正文或存在性细节。 */
export const HUMAN_DECISION_FEEDBACK_FAILURE_CODES_V1 = [
  "human-decision-feedback-authorization-required",
  "human-decision-feedback-command-unsupported",
  "human-decision-feedback-binding-unavailable",
  "human-decision-feedback-decision-conflict",
  "human-decision-feedback-decision-required",
  "human-decision-feedback-decision-not-adopted",
  "human-decision-feedback-pre-action-snapshot-unavailable",
  "human-decision-feedback-actual-assessment-required",
  "human-decision-feedback-actual-assessment-mismatch",
  "human-decision-feedback-frozen-input-unavailable",
  "human-decision-feedback-frozen-input-conflict",
  "human-decision-feedback-downstream-unavailable",
  "human-decision-feedback-contract-drift",
] as const;
export const HumanDecisionFeedbackFailureCodeV1Schema = z.enum(
  HUMAN_DECISION_FEEDBACK_FAILURE_CODES_V1,
);
export type HumanDecisionFeedbackFailureCodeV1 = z.infer<
  typeof HumanDecisionFeedbackFailureCodeV1Schema
>;

export type HumanDecisionFeedbackFailureKindV1 =
  "authorization" | "business-blocked" | "idempotency" | "terminal";

export interface HumanDecisionFeedbackFailureV1 {
  readonly code: HumanDecisionFeedbackFailureCodeV1;
  readonly kind: HumanDecisionFeedbackFailureKindV1;
  readonly message: string;
}

/** 类型化失败：模块内部只用它传递稳定原因，公共结果一律经 `toHumanDecisionFeedbackModuleError`。 */
export class HumanDecisionFeedbackError extends Error {
  readonly failure: HumanDecisionFeedbackFailureV1;

  constructor(failure: HumanDecisionFeedbackFailureV1, cause?: unknown) {
    super(failure.code, cause === undefined ? undefined : { cause });
    this.name = "HumanDecisionFeedbackError";
    this.failure = failure;
  }
}

export function failHumanDecisionFeedback(
  code: HumanDecisionFeedbackFailureCodeV1,
  kind: HumanDecisionFeedbackFailureKindV1 = "business-blocked",
  cause?: unknown,
): never {
  throw new HumanDecisionFeedbackError({ code, kind, message: code }, cause);
}

/** 任意抛出 → 稳定公共错误：权限/冲突/业务阻断/瞬态与终止，绝不泄露上游正文。 */
export const toHumanDecisionFeedbackModuleError = (
  error: unknown,
  causalRunId: string,
  occurredAt: string,
): ModuleErrorV1 => {
  const failure = error instanceof HumanDecisionFeedbackError ? error.failure : undefined;
  const common = { stageCode: "human-decision-feedback", occurredAt, causalRunId };
  const code = failure?.code ?? "human-decision-feedback-contract-drift";
  const kind =
    failure?.kind ??
    (error instanceof Error && error.name === "AccessServiceError" ? "authorization" : "terminal");
  const requiredCapability: ModuleCapabilityV1 = "warning-response.record";
  const blockerRef = {
    kind: "response-recommendation",
    reference: { entityId: causalRunId, versionId: "1" },
  } as const;
  if (kind === "authorization") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code: "AUTHORIZATION_DENIED",
      category: "authorization",
      retryable: false,
      requiredCapability,
      authorizationPolicyRef: { entityId: "warning-response.authorization", versionId: "1" },
    });
  }
  if (kind === "idempotency") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code: "IDEMPOTENCY_CONFLICT",
      category: "idempotency",
      retryable: false,
      idempotencyKey: causalRunId,
      priorCommandId: code,
    });
  }
  if (kind === "business-blocked") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code: "BUSINESS_BLOCKED",
      category: "business-blocked",
      retryable: false,
      blockerKind: code,
      blockerRef,
    });
  }
  return ModuleErrorV1Schema.parse({
    ...common,
    code: "TERMINAL_FAILURE",
    category: "technical",
    retryable: false,
    diagnosticRef: {
      kind: "diagnostic-artifact",
      reference: { entityId: `human-decision-feedback:${code}`, versionId: "1" },
    },
  });
};
