import { z } from "zod";

import {
  CommandEnvelopeSchema,
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
  type VersionReference,
} from "@riskflow/contracts/common";
import {
  AssessmentInputSnapshotRefV1Schema,
  AuthorizationContextV1Schema,
  ContentArtifactRefV1Schema,
  ContractReferenceV1Schema,
  EffectForecastRefV1Schema,
  ExecutionRecordRefV1Schema,
  FeedbackRefV1Schema,
  ModuleErrorV1Schema,
  MonitoringSnapshotRefV1Schema,
  ResponseFeedbackInputSnapshotRefV1Schema,
  ResponseForecastInputSnapshotRefV1Schema,
  RiskAssessmentRecordRefV1Schema,
  RouteDecisionRefV1Schema,
  SpatialScopeRefV1Schema,
  WarningResponseRecordCommandV1Schema,
  WorkflowRunRefV1Schema,
  type ContractReferenceV1,
  type ModuleCapabilityV1,
  type ModuleErrorV1,
  type WarningResponseRecordCommandV1,
} from "@riskflow/contracts/ports";
import { RiskStateSchema, type MeasureItem } from "@riskflow/contracts/records";
import {
  ResponseForecastInputSnapshotV1Schema,
  ResponseFeedbackInputSnapshotV1Schema,
  type ResponseForecastInputSnapshotV1,
} from "@riskflow/contracts/workflows";

import {
  CANONICAL_DECIMAL_MAX_FRACTION_DIGITS_V1,
  CanonicalDecimalV1Schema,
  ForecastMethodV1Schema,
  compareCanonicalDecimal,
  type ForecastPolicyV1,
} from "../assessment-config/index.js";
import { MonitoringSnapshotV1Schema } from "../engineering-data/monitoring/index.js";

/**
 * C28 自有 schema（D-02）：只描述人工决定、效果预测、现场执行、反馈与私有偏差事实。
 * 公共命令/引用/输入快照/RiskState 只从 `@riskflow/contracts` 消费，不复制公共字段，
 * 也不声明公共 `DeviationRecord` 所需的校准建议或审核状态。
 */
export const RESPONSE_LIFECYCLE_SCHEMA_VERSION_V1 = "1" as const;
export const RESPONSE_DEVIATION_FACT_KIND_V1 = "response-deviation-fact" as const;

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const unitSchema = z.string().regex(/^[\x21-\x7e]{1,32}$/u);
const positiveInteger = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger, "must be a safe integer");

/* -------------------------------------------------------------------------- */
/* D-04：C30 已验证工作流绑定                                                   */
/* -------------------------------------------------------------------------- */

/**
 * C30 拥有真实 route decision 与 workflow run；C28 只消费该绑定并逐项对账命令与上下文，
 * 不生成运行标识、不保存检查点。缺失或错配的路由/运行引用由 strict Schema 直接拒绝。
 */
export const VerifiedResponseWorkflowBindingV1Schema = z.strictObject({
  schemaVersion: z.literal(RESPONSE_LIFECYCLE_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  responseRecommendationRef: z.strictObject({
    kind: z.literal("response-recommendation"),
    reference: VersionReferenceSchema,
  }),
  spatialScopeRef: SpatialScopeRefV1Schema,
  routeDecisionRef: RouteDecisionRefV1Schema,
  forecastRunRef: WorkflowRunRefV1Schema,
  /**
   * 运行停在等待点时的**运行状态版本**（drift design D-03），不是运行登记摘要
   * `forecastRunRef.reference.versionId`。恢复必须提交这个值，恢复前据此核对归属；
   * 可选仅为保持历史绑定可读，缺失按失败闭合处理，不得用运行引用版本代替。
   */
  waitStateVersion: IdentifierSchema.optional(),
  boundAt: IsoDateTimeSchema,
});
export type VerifiedResponseWorkflowBindingV1 = z.infer<
  typeof VerifiedResponseWorkflowBindingV1Schema
>;

/* -------------------------------------------------------------------------- */
/* 私有命令：只补公共命令未表达的接缝字段                                        */
/* -------------------------------------------------------------------------- */

/** D-01：采纳/拒绝公开命令 + D-04 绑定；`declined` 到此结束，不产生预测输入或效果预测。 */
export const ResponseAdoptionDecisionCommandV1Schema = z
  .strictObject({
    schemaVersion: z.literal(RESPONSE_LIFECYCLE_SCHEMA_VERSION_V1),
    binding: VerifiedResponseWorkflowBindingV1Schema,
    command: WarningResponseRecordCommandV1Schema,
  })
  .superRefine((value, context) => {
    if (value.command.kind !== "adopt-recommendation") {
      context.addIssue({
        code: "custom",
        path: ["command", "kind"],
        message: "only the adopt-recommendation branch forms a decision",
      });
    }
  });
export type ResponseAdoptionDecisionCommandV1 = {
  readonly schemaVersion: "1";
  readonly binding: VerifiedResponseWorkflowBindingV1;
  readonly command: Extract<WarningResponseRecordCommandV1, { kind: "adopt-recommendation" }>;
};

/** D-01/D-05：内部预测入口不开放 HTTP DTO；正文是 C30 冻结的公共预测输入快照。 */
export const ForecastResponseCommandV1Schema = CommandEnvelopeSchema.extend({
  authorization: AuthorizationContextV1Schema,
  payload: z.strictObject({
    binding: VerifiedResponseWorkflowBindingV1Schema,
    forecastInputSnapshotRef: ResponseForecastInputSnapshotRefV1Schema,
    forecastInputSnapshot: ResponseForecastInputSnapshotV1Schema,
  }),
});
export type ForecastResponseCommandV1 = z.infer<typeof ForecastResponseCommandV1Schema>;

/** D-06：反馈命令只补 C30 已完成的真实 C25 实际评估引用，其余字段仍是公共命令。 */
export const ResponseFeedbackCommandV1Schema = z
  .strictObject({
    schemaVersion: z.literal(RESPONSE_LIFECYCLE_SCHEMA_VERSION_V1),
    command: WarningResponseRecordCommandV1Schema,
    feedbackInputSnapshotRef: ResponseFeedbackInputSnapshotRefV1Schema,
    feedbackInputSnapshot: ResponseFeedbackInputSnapshotV1Schema,
    actualAssessmentRecordRef: RiskAssessmentRecordRefV1Schema,
  })
  .superRefine((value, context) => {
    if (value.command.kind !== "record-feedback") {
      context.addIssue({
        code: "custom",
        path: ["command", "kind"],
        message: "only the record-feedback branch forms a feedback record",
      });
    }
  });
export type ResponseFeedbackCommandV1 = {
  readonly schemaVersion: "1";
  readonly command: Extract<WarningResponseRecordCommandV1, { kind: "record-feedback" }>;
  readonly feedbackInputSnapshotRef: { kind: "response-feedback-input-snapshot" } & {
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
  readonly feedbackInputSnapshot: z.infer<typeof ResponseFeedbackInputSnapshotV1Schema>;
  readonly actualAssessmentRecordRef: {
    readonly kind: "risk-assessment-record";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
};

/* -------------------------------------------------------------------------- */
/* D-02：C28 自有事实                                                          */
/* -------------------------------------------------------------------------- */

/** 终局人工决定：一个建议精确版本只能有一个 `adopted | declined`。 */
export const ResponseAdoptionDecisionV1Schema = z.strictObject({
  schemaVersion: z.literal(RESPONSE_LIFECYCLE_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  routeDecisionRef: RouteDecisionRefV1Schema,
  responseRecommendationRef: z.strictObject({
    kind: z.literal("response-recommendation"),
    reference: VersionReferenceSchema,
  }),
  decision: z.enum(["adopted", "declined"]),
  reasonCode: IdentifierSchema,
  forecastRunRef: WorkflowRunRefV1Schema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  decidedBy: IdentifierSchema,
  decidedAt: IsoDateTimeSchema,
});
export type ResponseAdoptionDecisionV1 = z.infer<typeof ResponseAdoptionDecisionV1Schema>;

/** 预测可用性：可用携带真实效果预测引用，不可用携带稳定原因，二者都不可原地重算。 */
export const ResponseForecastAvailabilityV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("available"), effectForecastRef: EffectForecastRefV1Schema }),
  z.strictObject({ kind: z.literal("unavailable"), reasonCode: IdentifierSchema }),
]);
export type ResponseForecastAvailabilityV1 = z.infer<typeof ResponseForecastAvailabilityV1Schema>;

export const RESPONSE_FORECAST_UNAVAILABLE_REASONS_V1 = [
  "executor-unavailable",
  "policy-unavailable",
  "model-artifact-unavailable",
  "monitoring-snapshot-unavailable",
  "monitoring-points-insufficient",
  "regression-degenerate",
  "monitoring-series-mismatch",
  "target-indicator-unsupported",
  "risk-state-unavailable",
  "input-indicator-missing",
  "input-indicator-unavailable",
  "measure-parameter-unavailable",
] as const;
export const ResponseForecastUnavailableReasonV1Schema = z.enum(
  RESPONSE_FORECAST_UNAVAILABLE_REASONS_V1,
);
export type ResponseForecastUnavailableReasonV1 = z.infer<
  typeof ResponseForecastUnavailableReasonV1Schema
>;

/** 可用预测的正文明细：规范预测值、预测风险状态、证据与摘要。 */
export const ResponseForecastProjectionV1Schema = z.strictObject({
  predictedValue: CanonicalDecimalV1Schema,
  predictedRiskState: RiskStateSchema,
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
  summary: IdentifierSchema,
});
export type ResponseForecastProjectionV1 = z.infer<typeof ResponseForecastProjectionV1Schema>;

/** 效果预测结果：冻结输入、策略、方法与 execution ref 全部按精确版本保存。 */
export const ResponseForecastOutcomeV1Schema = z
  .strictObject({
    schemaVersion: z.literal(RESPONSE_LIFECYCLE_SCHEMA_VERSION_V1),
    projectId: IdentifierSchema,
    effectForecastRef: EffectForecastRefV1Schema,
    responseRecommendationRef: z.strictObject({
      kind: z.literal("response-recommendation"),
      reference: VersionReferenceSchema,
    }),
    routeDecisionRef: RouteDecisionRefV1Schema,
    forecastRunRef: WorkflowRunRefV1Schema,
    forecastInputSnapshotRef: ResponseForecastInputSnapshotRefV1Schema,
    frozenAssessmentBasisRef: AssessmentInputSnapshotRefV1Schema,
    preActionMonitoringSnapshotRef: MonitoringSnapshotRefV1Schema,
    baselineAssessmentRecordRef: RiskAssessmentRecordRefV1Schema,
    forecastPolicyRef: VersionReferenceSchema,
    requiredRef: VersionReferenceSchema,
    method: ForecastMethodV1Schema,
    targetIndicatorId: IdentifierSchema,
    unit: unitSchema,
    horizonSteps: positiveInteger.max(720),
    inputDigest: digestSchema,
    availability: ResponseForecastAvailabilityV1Schema,
    projected: z
      .discriminatedUnion("kind", [
        ResponseForecastProjectionV1Schema.extend({ kind: z.literal("available") }),
        z.strictObject({ kind: z.literal("unavailable"), reasonCode: IdentifierSchema }),
      ])
      .optional(),
    spatialScopeRef: SpatialScopeRefV1Schema,
    computedBy: IdentifierSchema,
    computedAt: IsoDateTimeSchema,
  })
  .superRefine((outcome, context) => {
    // 可用预测必须携带可用正文，不可用预测不得携带正式预测值。
    if (outcome.availability.kind === "available" && outcome.projected?.kind !== "available") {
      context.addIssue({
        code: "custom",
        path: ["projected"],
        message: "available forecast requires an available projection",
      });
    }
    if (outcome.availability.kind === "unavailable" && outcome.projected?.kind === "available") {
      context.addIssue({
        code: "custom",
        path: ["projected"],
        message: "unavailable forecast must not carry a projection",
      });
    }
  });
export type ResponseForecastOutcomeV1 = z.infer<typeof ResponseForecastOutcomeV1Schema>;

/** 现场执行：来源闭合为已采纳建议（引用采纳决定）或独立行动（引用措施发布）。 */
export const ResponseExecutionSourceV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("adopted-recommendation"),
    responseRecommendationRef: z.strictObject({
      kind: z.literal("response-recommendation"),
      reference: VersionReferenceSchema,
    }),
    routeDecisionRef: RouteDecisionRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("independent-action"),
    measureReleaseRefs: z
      .array(
        z.strictObject({
          kind: z.literal("measure-library-release"),
          reference: VersionReferenceSchema,
        }),
      )
      .min(1),
  }),
]);
export type ResponseExecutionSourceV1 = z.infer<typeof ResponseExecutionSourceV1Schema>;

export const ResponseExecutionRecordV1Schema = z.strictObject({
  schemaVersion: z.literal(RESPONSE_LIFECYCLE_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  executionRecordRef: ExecutionRecordRefV1Schema,
  source: ResponseExecutionSourceV1Schema,
  executedByActorId: IdentifierSchema,
  recordedByActorId: IdentifierSchema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  occurredAt: IsoDateTimeSchema,
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
});
export type ResponseExecutionRecordV1 = z.infer<typeof ResponseExecutionRecordV1Schema>;

/** 反馈：执行后监测快照、反馈工件、C25 实际评估与预测可用性同事务保存。 */
export const ResponseFeedbackRecordV1Schema = z.strictObject({
  schemaVersion: z.literal(RESPONSE_LIFECYCLE_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  feedbackRef: FeedbackRefV1Schema,
  executionRecordRef: ExecutionRecordRefV1Schema,
  postActionMonitoringSnapshotRef: MonitoringSnapshotRefV1Schema,
  feedbackArtifactRef: ContentArtifactRefV1Schema,
  actualAssessmentRecordRef: RiskAssessmentRecordRefV1Schema,
  forecast: ResponseForecastAvailabilityV1Schema,
  deviationPolicyRef: VersionReferenceSchema.optional(),
  calibrationAgentPolicyRef: VersionReferenceSchema.optional(),
  spatialScopeRef: SpatialScopeRefV1Schema,
  occurredAt: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
  recordedBy: IdentifierSchema,
});
export type ResponseFeedbackRecordV1 = z.infer<typeof ResponseFeedbackRecordV1Schema>;

/** 私有偏差事实：C28 不填校准建议或审核状态，公共记录由 C29 组合。 */
export const ResponseDeviationFactRefV1Schema = z.strictObject({
  kind: z.literal(RESPONSE_DEVIATION_FACT_KIND_V1),
  reference: VersionReferenceSchema,
});
export type ResponseDeviationFactRefV1 = z.infer<typeof ResponseDeviationFactRefV1Schema>;

export const RESPONSE_DEVIATION_DIRECTIONS_V1 = ["actual-above", "actual-below", "equal"] as const;
export const ResponseDeviationDirectionV1Schema = z.enum(RESPONSE_DEVIATION_DIRECTIONS_V1);
export type ResponseDeviationDirectionV1 = z.infer<typeof ResponseDeviationDirectionV1Schema>;

export const ResponseDeviationFactV1Schema = z.strictObject({
  schemaVersion: z.literal(RESPONSE_LIFECYCLE_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  deviationFactRef: ResponseDeviationFactRefV1Schema,
  responseRecommendationRef: z.strictObject({
    kind: z.literal("response-recommendation"),
    reference: VersionReferenceSchema,
  }),
  executionRecordRef: ExecutionRecordRefV1Schema,
  effectForecastRef: EffectForecastRefV1Schema,
  feedbackRef: FeedbackRefV1Schema,
  frozenAssessmentBasisRef: AssessmentInputSnapshotRefV1Schema,
  deviationPolicyRef: VersionReferenceSchema,
  basis: z.enum(["absolute", "relative", "risk-level-step"]),
  riskMatrixRef: VersionReferenceSchema,
  targetIndicatorId: IdentifierSchema,
  unit: unitSchema,
  predictedValue: CanonicalDecimalV1Schema,
  actualValue: CanonicalDecimalV1Schema,
  deviationValue: CanonicalDecimalV1Schema,
  deviationValueNumber: z.number().finite(),
  thresholdExceeded: z.boolean(),
  direction: ResponseDeviationDirectionV1Schema,
  predictedRiskState: RiskStateSchema,
  actualRiskState: RiskStateSchema,
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
  summary: IdentifierSchema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  computedAt: IsoDateTimeSchema,
});
export type ResponseDeviationFactV1 = z.infer<typeof ResponseDeviationFactV1Schema>;

/* -------------------------------------------------------------------------- */
/* D-05：版本化效果预测执行器接缝                                               */
/* -------------------------------------------------------------------------- */

/**
 * 执行器输入：冻结快照正文、单个 C18 策略、基线指标/风险状态与 C14 执行前快照。
 *
 * 下发的是受权身份与冻结范围，不是 C28 命令本身的能力：执行器据此在各自既有分支上取得
 * 读取能力（C04 模型工件、C25 预测风险状态），因此不放大调用者范围，也不把命令上下文
 * 当成跨模块通行证。
 */
export interface ResponseForecastExecutorRequestV1 {
  readonly commandId: string;
  readonly projectId: string;
  readonly issuedAt: string;
  readonly idempotencyKey: string;
  readonly authorization: z.infer<typeof AuthorizationContextV1Schema>;
  readonly snapshot: ResponseForecastInputSnapshotV1;
  readonly policy: ForecastPolicyV1;
  readonly baseline: {
    readonly riskState: z.infer<typeof RiskStateSchema>;
    readonly indicatorValues: readonly {
      readonly indicatorItem: string;
      readonly value: string | number | boolean;
      /** 冻结指标体系中的数值指标正式单位；缺失时不能作为模型的合法输入。 */
      readonly unit?: string;
    }[];
  };
  readonly monitoringSnapshot: z.infer<typeof MonitoringSnapshotV1Schema>;
  /** 已采纳建议的正式措施集合：只带标识，效果一律来自模型工件按措施库版本绑定的声明。 */
  readonly adoptedMeasures: readonly MeasureItem[];
  /** 冻结建议所用措施库版本：模型工件的措施效果必须绑定同一版本。 */
  readonly measureLibraryReleaseRef: VersionReference;
  /** 建议链基线评估记录：C25 预测风险状态的重算起点。 */
  readonly baselineAssessmentRecordRef: z.infer<typeof RiskAssessmentRecordRefV1Schema>;
}

const responseForecastExecutorEchoV1 = {
  method: ForecastMethodV1Schema,
  requiredRef: VersionReferenceSchema,
  targetIndicatorId: IdentifierSchema,
  unit: unitSchema,
  horizonSteps: positiveInteger.max(720),
  summary: IdentifierSchema,
} as const;

/**
 * 成功预测结果：C28 另用 EffectForecastExecutorOutcomeV1 区分可用与业务不可用。
 */
export const ResponseForecastExecutorResultV1Schema = z.strictObject({
  ...responseForecastExecutorEchoV1,
  predictedValue: CanonicalDecimalV1Schema,
  predictedRiskState: RiskStateSchema,
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
});
export type ResponseForecastExecutorResultV1 = z.infer<
  typeof ResponseForecastExecutorResultV1Schema
>;

/** 执行结果联合：仅合法业务输入不足时返回 unavailable；错误通过失败通道传播。 */
export const EffectForecastExecutorOutcomeV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("available"),
    result: ResponseForecastExecutorResultV1Schema,
  }),
  z.strictObject({
    kind: z.literal("unavailable"),
    reasonCode: ResponseForecastUnavailableReasonV1Schema,
  }),
]);
export type EffectForecastExecutorOutcomeV1 = z.infer<typeof EffectForecastExecutorOutcomeV1Schema>;

/** 私有版本化执行接缝：由部署按 `requiredRef` 注入正式实现，测试夹具不得用于生产。 */
export interface EffectForecastExecutorV1 {
  readonly method: z.infer<typeof ForecastMethodV1Schema>;
  readonly requiredRef: { readonly entityId: string; readonly versionId: string };
  forecast(
    request: ResponseForecastExecutorRequestV1,
  ): Promise<EffectForecastExecutorOutcomeV1> | EffectForecastExecutorOutcomeV1;
}

/* -------------------------------------------------------------------------- */
/* D-06：参数预测模型是有界内容工件                                            */
/* -------------------------------------------------------------------------- */

/**
 * 参数模型是 C04 内容工件，不是 C18 配置包的一部分：模型的系数、阈值与措施效果必须能被
 * 精确引用并按内容寻址重放，因此不允许在执行器或装配代码里硬编码，也不接受任意公式串。
 * 本版本只支持三种声明式参数形状，`algorithmVersion` 固定以区分后续模型家族。
 */
export const EFFECT_FORECAST_MODEL_ALGORITHM_VERSION_V1 = "parameter-forecast-v1" as const;
export const EFFECT_FORECAST_MODEL_PURPOSE_CODE_V1 = "response-lifecycle.forecast-model" as const;
export const EFFECT_FORECAST_MODEL_MEDIA_TYPE_V1 = "application/json" as const;
export const EFFECT_FORECAST_MODEL_MAX_ARTIFACT_BYTES_V1 = 1024 * 1024;

const uniqueBy = <T>(schema: z.ZodType<T>, key: (value: T) => string, maximum: number) =>
  z
    .array(schema)
    .max(maximum)
    .superRefine((values, context) => {
      const keys = values.map(key);
      if (new Set(keys).size !== keys.length) {
        context.addIssue({ code: "custom", message: "collection must not contain duplicates" });
      }
    });

/** 样本来源与审核状态：合成样本只能处于待甲方复核，不得被表述为已审核。 */
export const EFFECT_FORECAST_SAMPLE_ORIGIN_V1_VALUES = ["synthetic", "client-reviewed"] as const;
export const EffectForecastSampleOriginV1Schema = z.enum(EFFECT_FORECAST_SAMPLE_ORIGIN_V1_VALUES);
export const EFFECT_FORECAST_REVIEW_STATUS_V1_VALUES = [
  "pending-client-review",
  "reviewed",
] as const;
export const EffectForecastReviewStatusV1Schema = z.enum(EFFECT_FORECAST_REVIEW_STATUS_V1_VALUES);

/** 模型声明的一条措施效果：按措施标识绑定到原措施库版本的正式 measureId。 */
const EffectForecastMeasureEffectV1Schema = z.strictObject({
  measureId: IdentifierSchema,
  offset: CanonicalDecimalV1Schema,
  perStep: CanonicalDecimalV1Schema,
});
export type EffectForecastMeasureEffectV1 = z.infer<typeof EffectForecastMeasureEffectV1Schema>;

const EffectForecastInputIndicatorV1Schema = z.strictObject({
  indicatorId: IdentifierSchema,
  unit: unitSchema,
});
export type EffectForecastInputIndicatorV1 = z.infer<typeof EffectForecastInputIndicatorV1Schema>;

/** 有界物理区间；下界不得大于上界，闭区间两端都是合法取值。 */
const EffectForecastDomainV1Schema = z
  .strictObject({ lower: CanonicalDecimalV1Schema, upper: CanonicalDecimalV1Schema })
  .superRefine((domain, context) => {
    if (compareCanonicalDecimal(domain.lower, domain.upper) > 0) {
      context.addIssue({
        code: "custom",
        path: ["upper"],
        message: "domain upper bound must not be below its lower bound",
      });
    }
  });

const effectForecastModelBase = {
  schemaVersion: z.literal(RESPONSE_LIFECYCLE_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  algorithmVersion: z.literal(EFFECT_FORECAST_MODEL_ALGORITHM_VERSION_V1),
  inputIndicators: uniqueBy(
    EffectForecastInputIndicatorV1Schema,
    (value) => value.indicatorId,
    32,
  ).min(1),
  targetIndicatorId: IdentifierSchema,
  unit: unitSchema,
  stepMs: positiveInteger,
  maxHorizonSteps: positiveInteger.max(720),
  calculationScale: positiveInteger.max(CANONICAL_DECIMAL_MAX_FRACTION_DIGITS_V1),
  measureLibraryReleaseRef: VersionReferenceSchema,
  measureEffects: uniqueBy(
    EffectForecastMeasureEffectV1Schema,
    (value) => value.measureId,
    128,
  ).min(1),
  evidenceReferences: uniqueBy(
    EvidenceReferenceSchema,
    (value) =>
      `${value.sourceVersion.entityId}@${value.sourceVersion.versionId}\u0000${JSON.stringify(value.locator)}`,
    256,
  ).min(1),
  sampleOrigin: EffectForecastSampleOriginV1Schema,
  reviewStatus: EffectForecastReviewStatusV1Schema,
} as const;

/** 已训练线性回归系数：运行时只代入基线，不重新拟合。 */
const HistoricalStatisticsParametersV1Schema = z.strictObject({
  intercept: CanonicalDecimalV1Schema,
  inputCoefficients: z
    .array(z.strictObject({ coefficient: CanonicalDecimalV1Schema }))
    .min(1)
    .max(32),
  horizonCoefficient: CanonicalDecimalV1Schema,
  fitSampleCount: positiveInteger.max(1_000_000).min(2),
});
export type HistoricalStatisticsParametersV1 = z.infer<
  typeof HistoricalStatisticsParametersV1Schema
>;

/** 趋势窗口点数：算法只取执行前快照末尾这些对齐槽的原下标做最小二乘。 */
const MonitoringTrendParametersV1Schema = z.strictObject({
  windowPoints: positiveInteger.max(720).min(2),
});
export type MonitoringTrendParametersV1 = z.infer<typeof MonitoringTrendParametersV1Schema>;

/** 有界多项式机理项：指标与次数组合唯一，禁止任意表达式。 */
const MechanismTermV1Schema = z.strictObject({
  indicatorId: IdentifierSchema,
  power: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  coefficient: CanonicalDecimalV1Schema,
});
export type MechanismTermV1 = z.infer<typeof MechanismTermV1Schema>;

const MechanismParametersV1Schema = z.strictObject({
  intercept: CanonicalDecimalV1Schema,
  terms: uniqueBy(MechanismTermV1Schema, (value) => `${value.indicatorId}@${value.power}`, 128).min(
    1,
  ),
  horizonCoefficient: CanonicalDecimalV1Schema,
  inputDomains: uniqueBy(
    z.strictObject({
      indicatorId: IdentifierSchema,
      domain: EffectForecastDomainV1Schema,
    }),
    (value) => value.indicatorId,
    32,
  ),
  outputDomain: EffectForecastDomainV1Schema,
});
export type MechanismParametersV1 = z.infer<typeof MechanismParametersV1Schema>;

const HistoricalStatisticsEffectForecastModelV1Schema = z.strictObject({
  ...effectForecastModelBase,
  method: z.literal("historical-statistics"),
  parameters: HistoricalStatisticsParametersV1Schema,
});
const MonitoringTrendEffectForecastModelV1Schema = z.strictObject({
  ...effectForecastModelBase,
  method: z.literal("monitoring-trend"),
  parameters: MonitoringTrendParametersV1Schema,
});
const MechanismEffectForecastModelV1Schema = z.strictObject({
  ...effectForecastModelBase,
  method: z.literal("mechanism-model"),
  parameters: MechanismParametersV1Schema,
});

export const EffectForecastModelArtifactV1Schema = z
  .discriminatedUnion("method", [
    HistoricalStatisticsEffectForecastModelV1Schema,
    MonitoringTrendEffectForecastModelV1Schema,
    MechanismEffectForecastModelV1Schema,
  ])
  .superRefine((model, context) => {
    // 甲方复核过的样本必须已审核；合成样本不得冒充已审核。
    if (model.sampleOrigin === "client-reviewed" && model.reviewStatus !== "reviewed") {
      context.addIssue({
        code: "custom",
        path: ["reviewStatus"],
        message: "client-reviewed samples must carry a reviewed status",
      });
    }
    if (model.reviewStatus === "reviewed" && model.sampleOrigin !== "client-reviewed") {
      context.addIssue({
        code: "custom",
        path: ["sampleOrigin"],
        message: "only client-reviewed samples may carry a reviewed status",
      });
    }
    // 趋势方法只能预测目标指标自身：序列取值就是它的输入，再声明别的指标没有口径。
    if (
      model.method === "monitoring-trend" &&
      (model.inputIndicators.length !== 1 ||
        model.inputIndicators[0]!.indicatorId !== model.targetIndicatorId ||
        model.inputIndicators[0]!.unit !== model.unit)
    ) {
      context.addIssue({
        code: "custom",
        path: ["inputIndicators"],
        message: "monitoring-trend models must take the target indicator as their only input",
      });
    }
    if (model.method === "historical-statistics") {
      const declared = model.inputIndicators.map((value) => value.indicatorId);
      if (model.parameters.inputCoefficients.length !== declared.length) {
        context.addIssue({
          code: "custom",
          path: ["parameters", "inputCoefficients"],
          message: "one coefficient per declared input is required",
        });
      }
    }
    if (model.method === "mechanism-model") {
      const declared = new Set(model.inputIndicators.map((value) => value.indicatorId));
      const dominated = model.parameters.terms.map((value) => value.indicatorId);
      const domainBound = new Set(model.parameters.inputDomains.map((value) => value.indicatorId));
      if (
        dominated.some((indicatorId) => !declared.has(indicatorId)) ||
        declared.size !== model.parameters.inputDomains.length ||
        [...domainBound].some((indicatorId) => !declared.has(indicatorId))
      ) {
        context.addIssue({
          code: "custom",
          path: ["parameters", "inputDomains"],
          message: "mechanism terms and input domains must cover exactly the declared inputs",
        });
      }
    }
  });
export type EffectForecastModelArtifactV1 = z.infer<typeof EffectForecastModelArtifactV1Schema>;

/* -------------------------------------------------------------------------- */
/* 闭合失败事实源                                                              */
/* -------------------------------------------------------------------------- */

export const RESPONSE_LIFECYCLE_REASON_CODES_V1 = [
  "response-lifecycle-authorization-required",
  "response-lifecycle-contract-drift",
  "response-recommendation-unavailable",
  "response-recommendation-not-adopted",
  "response-decision-conflict",
  "response-binding-mismatch",
  "response-forecast-policy-unavailable",
  "response-forecast-policy-mismatch",
  "response-forecast-input-mismatch",
  "response-forecast-result-invalid",
  "response-execution-source-invalid",
  "response-measure-release-unavailable",
  "response-feedback-chain-mismatch",
  "response-feedback-artifact-unavailable",
  "response-feedback-actual-assessment-mismatch",
  "response-deviation-input-unavailable",
  "response-deviation-policy-unavailable",
  "response-deviation-policy-mismatch",
  "response-deviation-value-incompatible",
  "response-lifecycle-idempotency-conflict",
] as const;
export const ResponseLifecycleReasonCodeV1Schema = z.enum(RESPONSE_LIFECYCLE_REASON_CODES_V1);
export type ResponseLifecycleReasonCodeV1 = z.infer<typeof ResponseLifecycleReasonCodeV1Schema>;

export const RESPONSE_LIFECYCLE_FAILURE_CODES_V1 = [
  "AUTHORIZATION_DENIED",
  "UNSUPPORTED_CONTRACT",
  "BUSINESS_BLOCKED",
  "STALE_VERSION",
  "IDEMPOTENCY_CONFLICT",
  "TRANSIENT_FAILURE",
  "TERMINAL_FAILURE",
] as const;
export const ResponseLifecycleFailureCodeV1Schema = z.enum(RESPONSE_LIFECYCLE_FAILURE_CODES_V1);
export type ResponseLifecycleFailureCodeV1 = z.infer<typeof ResponseLifecycleFailureCodeV1Schema>;

const FAILURE_CODE_BY_REASON_V1: Readonly<
  Record<ResponseLifecycleReasonCodeV1, ResponseLifecycleFailureCodeV1>
> = Object.freeze({
  "response-lifecycle-authorization-required": "AUTHORIZATION_DENIED",
  "response-lifecycle-contract-drift": "UNSUPPORTED_CONTRACT",
  "response-recommendation-unavailable": "BUSINESS_BLOCKED",
  "response-recommendation-not-adopted": "BUSINESS_BLOCKED",
  "response-decision-conflict": "BUSINESS_BLOCKED",
  "response-binding-mismatch": "STALE_VERSION",
  "response-forecast-policy-unavailable": "BUSINESS_BLOCKED",
  "response-forecast-policy-mismatch": "STALE_VERSION",
  "response-forecast-input-mismatch": "STALE_VERSION",
  "response-forecast-result-invalid": "TERMINAL_FAILURE",
  "response-execution-source-invalid": "BUSINESS_BLOCKED",
  "response-measure-release-unavailable": "BUSINESS_BLOCKED",
  "response-feedback-chain-mismatch": "BUSINESS_BLOCKED",
  "response-feedback-artifact-unavailable": "BUSINESS_BLOCKED",
  "response-feedback-actual-assessment-mismatch": "STALE_VERSION",
  "response-deviation-input-unavailable": "BUSINESS_BLOCKED",
  "response-deviation-policy-unavailable": "BUSINESS_BLOCKED",
  "response-deviation-policy-mismatch": "STALE_VERSION",
  "response-deviation-value-incompatible": "BUSINESS_BLOCKED",
  "response-lifecycle-idempotency-conflict": "IDEMPOTENCY_CONFLICT",
});

export interface ResponseLifecycleTargetRefV1 {
  readonly kind: string;
  readonly reference: { readonly entityId: string; readonly versionId: string };
}

export interface ResponseLifecycleFailureV1 {
  readonly code: ResponseLifecycleFailureCodeV1;
  readonly reasonCode: ResponseLifecycleReasonCodeV1;
  readonly targetRef: ResponseLifecycleTargetRefV1;
}

export class ResponseLifecycleError extends Error {
  readonly failure: ResponseLifecycleFailureV1;

  constructor(failure: ResponseLifecycleFailureV1) {
    super(failure.code);
    this.name = "ResponseLifecycleError";
    this.failure = failure;
  }
}

export const responseLifecycleFailureFrom = (
  error: unknown,
): ResponseLifecycleFailureV1 | undefined =>
  error instanceof ResponseLifecycleError ? error.failure : undefined;

export const failResponseLifecycle = (
  reasonCode: ResponseLifecycleReasonCodeV1,
  targetRef: ResponseLifecycleTargetRefV1,
  code?: ResponseLifecycleFailureCodeV1,
): never => {
  throw new ResponseLifecycleError({
    code: code ?? FAILURE_CODE_BY_REASON_V1[reasonCode],
    reasonCode,
    targetRef,
  });
};

/** 失败引用先按公共闭合联合复验；形态不足时退化为稳定的模块引用，绝不改写原引用。 */
const contractTargetRef = (targetRef: ResponseLifecycleTargetRefV1): ContractReferenceV1 => {
  const parsed = ContractReferenceV1Schema.safeParse(targetRef);
  return parsed.success
    ? parsed.data
    : {
        kind: "response-recommendation",
        reference: { entityId: "warning-response.response-lifecycle", versionId: "1" },
      };
};

export const toResponseLifecycleModuleError = (
  failure: ResponseLifecycleFailureV1,
  causalRunId: string,
  requiredCapability: ModuleCapabilityV1 = "warning-response.record",
): ModuleErrorV1 => {
  const common = {
    stageCode: "warning-response.response-lifecycle",
    occurredAt: new Date().toISOString(),
    causalRunId,
  };
  switch (failure.code) {
    case "AUTHORIZATION_DENIED":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "AUTHORIZATION_DENIED",
        category: "authorization",
        retryable: false,
        requiredCapability,
        authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      });
    case "UNSUPPORTED_CONTRACT":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "UNSUPPORTED_CONTRACT",
        category: "technical",
        retryable: false,
        schemaVersion: RESPONSE_LIFECYCLE_SCHEMA_VERSION_V1,
      });
    case "STALE_VERSION":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "STALE_VERSION",
        category: "concurrency",
        retryable: false,
        targetRef: contractTargetRef(failure.targetRef),
      });
    case "BUSINESS_BLOCKED":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "BUSINESS_BLOCKED",
        category: "business-blocked",
        retryable: false,
        blockerKind: failure.reasonCode,
        blockerRef: contractTargetRef(failure.targetRef),
      });
    case "IDEMPOTENCY_CONFLICT":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "IDEMPOTENCY_CONFLICT",
        category: "idempotency",
        retryable: false,
        idempotencyKey: "unknown",
        priorCommandId: "unknown",
      });
    case "TRANSIENT_FAILURE":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "TRANSIENT_FAILURE",
        category: "technical",
        retryable: true,
        attempt: 1,
        retryPolicyRef: { entityId: "response-lifecycle-retry-policy", versionId: "1" },
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "response-lifecycle-transient", versionId: "1" },
        },
      });
    case "TERMINAL_FAILURE":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "TERMINAL_FAILURE",
        category: "technical",
        retryable: false,
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "response-lifecycle-terminal", versionId: "1" },
        },
      });
  }
};

/** 未越限的方向：`equal` 只用于实际值等于预测值。 */
