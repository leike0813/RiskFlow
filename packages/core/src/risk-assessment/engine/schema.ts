import { z } from "zod";

import {
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import {
  ApplicabilityMetadataSchema,
  RiskStateSchema,
  ScalarValueSchema,
} from "@riskflow/contracts/records";
import {
  AssessmentInputSnapshotRefV1Schema,
  AssessmentPreparationSnapshotRefV1Schema,
  AssessmentBasisReleaseSetRefV1Schema,
  AuthorizationContextV1Schema,
  ContentArtifactRefV1Schema,
  IndicatorActualValueSetRefV1Schema,
  KnowledgeReleaseRefV1Schema,
  KnowledgeRevisionRefV1Schema,
  ModuleErrorV1Schema,
  RISK_INPUT_FACT_MAX_FIELDS_V1,
  RiskInputFactFieldPathSegmentV1Schema,
  RiskInputFactFieldV1Schema,
  RiskAssessmentRecordRefV1Schema,
  RiskInputVersionRefV1Schema,
  type ModuleErrorV1,
  type ContractReferenceV1,
} from "@riskflow/contracts/ports";
import {
  MonitoringIndicatorSchema,
  RiskAssessmentIndicatorTypeSchema,
  WarningTriggerTypeSchema,
} from "@riskflow/contracts/vocabulary";
import {
  AssessmentConfigurationMetricV1Schema,
  AssessmentIndicatorValueKindV1Schema,
} from "../../assessment-config/index.js";

/** C25 自有 schema/媒体/预算常量：只描述本模块拥有的派生事实。 */
export const RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1 = "1" as const;
export const RISK_ASSESSMENT_DECISION_MEDIA_TYPE_V1 =
  "application/vnd.riskflow.assessment-decision+json" as const;
export const RISK_ASSESSMENT_DECISION_ARTIFACT_PURPOSE_CODE_V1 =
  "risk-assessment.decision" as const;
export const RISK_ASSESSMENT_MAX_ARTIFACT_BYTES_V1 = 1024 * 1024;
/** 字段上限与契约层同源，避免 C11/C25 与所属 reader 出现两套预算。 */
export const RISK_ASSESSMENT_MAX_FACT_FIELDS_V1 = RISK_INPUT_FACT_MAX_FIELDS_V1;
export const RISK_ASSESSMENT_MAX_INDICATOR_VALUES_V1 = 512;
export const RISK_ASSESSMENT_MAX_TRIGGERS_V1 = 1024;

/* -------------------------------------------------------------------------- */
/* 闭合失败事实源（D-11）                                                      */
/* -------------------------------------------------------------------------- */

export const RISK_ASSESSMENT_REASON_CODES_V1 = [
  "risk-assessment-input-invalid",
  "risk-assessment-risk-input-unavailable",
  "risk-assessment-snapshot-incomplete",
  "risk-assessment-monitoring-snapshot-coverage",
  "risk-assessment-series-unavailable",
  "risk-assessment-basis-unavailable",
  "risk-assessment-runtime-policy-incomplete",
  "risk-assessment-artifact-mismatch",
  "risk-assessment-indicator-missing",
  "risk-assessment-indicator-ambiguous",
  "risk-assessment-unit-conflict",
  "risk-assessment-rule-coverage",
  "risk-assessment-numeric-unrepresentable",
  "risk-assessment-matrix-out-of-range",
  "risk-assessment-threshold-ambiguous",
  "risk-assessment-assessment-run-required",
  "risk-assessment-previous-record-mismatch",
  "risk-assessment-change-not-observed",
  "risk-assessment-project-mismatch",
  "risk-assessment-capability-required",
] as const;
export const RiskAssessmentReasonCodeV1Schema = z.enum(RISK_ASSESSMENT_REASON_CODES_V1);
export type RiskAssessmentReasonCodeV1 = z.infer<typeof RiskAssessmentReasonCodeV1Schema>;

export const RISK_ASSESSMENT_FAILURE_CODES_V1 = [
  "AUTHORIZATION_DENIED",
  "UNSUPPORTED_CONTRACT",
  "BUSINESS_BLOCKED",
  "STALE_VERSION",
  "IDEMPOTENCY_CONFLICT",
  "TRANSIENT_FAILURE",
  "TERMINAL_FAILURE",
] as const;
export const RiskAssessmentFailureCodeV1Schema = z.enum(RISK_ASSESSMENT_FAILURE_CODES_V1);
export type RiskAssessmentFailureCodeV1 = z.infer<typeof RiskAssessmentFailureCodeV1Schema>;

const FAILURE_CODE_BY_REASON_V1: Readonly<
  Record<RiskAssessmentReasonCodeV1, RiskAssessmentFailureCodeV1>
> = Object.freeze({
  "risk-assessment-input-invalid": "UNSUPPORTED_CONTRACT",
  "risk-assessment-risk-input-unavailable": "BUSINESS_BLOCKED",
  "risk-assessment-snapshot-incomplete": "BUSINESS_BLOCKED",
  "risk-assessment-monitoring-snapshot-coverage": "BUSINESS_BLOCKED",
  "risk-assessment-series-unavailable": "BUSINESS_BLOCKED",
  "risk-assessment-basis-unavailable": "BUSINESS_BLOCKED",
  "risk-assessment-runtime-policy-incomplete": "BUSINESS_BLOCKED",
  "risk-assessment-artifact-mismatch": "STALE_VERSION",
  "risk-assessment-indicator-missing": "BUSINESS_BLOCKED",
  "risk-assessment-indicator-ambiguous": "BUSINESS_BLOCKED",
  "risk-assessment-unit-conflict": "BUSINESS_BLOCKED",
  "risk-assessment-rule-coverage": "BUSINESS_BLOCKED",
  "risk-assessment-numeric-unrepresentable": "TERMINAL_FAILURE",
  "risk-assessment-matrix-out-of-range": "BUSINESS_BLOCKED",
  "risk-assessment-threshold-ambiguous": "BUSINESS_BLOCKED",
  "risk-assessment-assessment-run-required": "BUSINESS_BLOCKED",
  "risk-assessment-previous-record-mismatch": "STALE_VERSION",
  "risk-assessment-change-not-observed": "BUSINESS_BLOCKED",
  "risk-assessment-project-mismatch": "AUTHORIZATION_DENIED",
  "risk-assessment-capability-required": "AUTHORIZATION_DENIED",
});

export interface RiskAssessmentFailureV1 {
  readonly code: RiskAssessmentFailureCodeV1;
  readonly reasonCode: RiskAssessmentReasonCodeV1;
  readonly targetRef: ContractReferenceV1;
}

export class RiskAssessmentError extends Error {
  readonly failure: RiskAssessmentFailureV1;

  constructor(failure: RiskAssessmentFailureV1) {
    super(failure.code);
    this.name = "RiskAssessmentError";
    this.failure = failure;
  }
}

export function failRiskAssessment(
  reasonCode: RiskAssessmentReasonCodeV1,
  targetRef: ContractReferenceV1,
  code: RiskAssessmentFailureCodeV1 = FAILURE_CODE_BY_REASON_V1[reasonCode],
): never {
  throw new RiskAssessmentError({ code, reasonCode, targetRef });
}

/** 从原始错误或 adapter 包装错误恢复 C25 失败；非 C25 错误返回 `undefined`。 */
export const riskAssessmentFailureFrom = (error: unknown): RiskAssessmentFailureV1 | undefined => {
  if (error instanceof RiskAssessmentError) return error.failure;
  const wrapped =
    typeof error === "object" && error !== null && "riskAssessmentFailure" in error
      ? (error as { riskAssessmentFailure?: unknown }).riskAssessmentFailure
      : undefined;
  if (wrapped instanceof RiskAssessmentError) return wrapped.failure;
  return undefined;
};

export const toModuleError = (
  failure: RiskAssessmentFailureV1,
  causalRunId: string,
): ModuleErrorV1 => {
  const common = {
    stageCode: "risk-assessment.engine",
    occurredAt: new Date().toISOString(),
    causalRunId,
  };
  const targetRef = failure.targetRef;
  switch (failure.code) {
    case "AUTHORIZATION_DENIED":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "AUTHORIZATION_DENIED",
        category: "authorization",
        retryable: false,
        requiredCapability: "risk-assessment.read",
        authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      });
    case "STALE_VERSION":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "STALE_VERSION",
        category: "concurrency",
        retryable: false,
        targetRef,
      });
    case "BUSINESS_BLOCKED":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "BUSINESS_BLOCKED",
        category: "business-blocked",
        retryable: false,
        blockerKind: failure.reasonCode,
        blockerRef: targetRef,
      });
    case "UNSUPPORTED_CONTRACT":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "UNSUPPORTED_CONTRACT",
        category: "technical",
        retryable: false,
        schemaVersion: RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1,
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
        retryPolicyRef: { entityId: "risk-assessment-retry-policy", versionId: "1" },
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "risk-assessment-failure", versionId: "1" },
        },
      });
    default:
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "TERMINAL_FAILURE",
        category: "technical",
        retryable: false,
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "risk-assessment-failure", versionId: "1" },
        },
      });
  }
};

/* -------------------------------------------------------------------------- */
/* 风险输入事实（D-01 接缝 1）                                                 */
/* -------------------------------------------------------------------------- */

const factFieldPathSegment = RiskInputFactFieldPathSegmentV1Schema;

export { RiskInputFactFieldV1Schema };
export type { RiskInputFactFieldV1 } from "@riskflow/contracts/ports";

/**
 * 读取请求是接缝契约的一部分：身份、时间、授权与精确 XOR 风险输入由 C06 签发的
 * 调用方给出，所属 reader 不得从自由字符串推断工程或改换调用身份。
 */
export const RiskInputFactsReadRequestV1Schema = z.strictObject({
  requestId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  requestedAt: IsoDateTimeSchema,
  authorization: AuthorizationContextV1Schema,
  riskInput: RiskInputVersionRefV1Schema,
});
export type RiskInputFactsReadRequestV1 = z.infer<typeof RiskInputFactsReadRequestV1Schema>;

export const RiskInputFactsV1Schema = z.strictObject({
  schemaVersion: z.literal(RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  riskInput: RiskInputVersionRefV1Schema,
  fields: z.array(RiskInputFactFieldV1Schema).min(1).max(RISK_ASSESSMENT_MAX_FACT_FIELDS_V1),
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1).max(256),
});
export type RiskInputFactsV1 = z.infer<typeof RiskInputFactsV1Schema>;

/* -------------------------------------------------------------------------- */
/* 运行时策略提供者（D-04 十项）                                               */
/* -------------------------------------------------------------------------- */

export const AssessmentRuntimePolicySetV1Schema = z.strictObject({
  schemaVersion: z.literal(RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  warningAggregationPolicyRef: VersionReferenceSchema,
  notificationPolicyRef: VersionReferenceSchema,
  responseGenerationPolicyRef: VersionReferenceSchema,
  responseValidationPolicyRef: VersionReferenceSchema,
  responseAgentPolicyRef: VersionReferenceSchema,
  calibrationAgentPolicyRef: VersionReferenceSchema,
  retryPolicyRef: VersionReferenceSchema,
  reviewPolicyRef: VersionReferenceSchema,
  modelDeploymentRef: VersionReferenceSchema,
  promptTemplateRef: VersionReferenceSchema,
});
export type AssessmentRuntimePolicySetV1 = z.infer<typeof AssessmentRuntimePolicySetV1Schema>;

export const ASSESSMENT_RUNTIME_POLICY_SET_V1_FIELDS = [
  "warningAggregationPolicyRef",
  "notificationPolicyRef",
  "responseGenerationPolicyRef",
  "responseValidationPolicyRef",
  "responseAgentPolicyRef",
  "calibrationAgentPolicyRef",
  "retryPolicyRef",
  "reviewPolicyRef",
  "modelDeploymentRef",
  "promptTemplateRef",
] as const satisfies readonly (keyof AssessmentRuntimePolicySetV1)[];

/* -------------------------------------------------------------------------- */
/* 指标实际取值集（D-05）                                                      */
/* -------------------------------------------------------------------------- */

export const IndicatorValueSourceV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("risk-input"),
    riskInput: RiskInputVersionRefV1Schema,
    documentType: IdentifierSchema,
    fieldPath: z.array(factFieldPathSegment).min(1).max(16),
  }),
  z.strictObject({
    kind: z.literal("monitoring-value"),
    monitoringSnapshotRef: z.strictObject({
      kind: z.literal("monitoring-snapshot"),
      reference: VersionReferenceSchema,
    }),
    monitoringSeriesRef: z.strictObject({
      kind: z.literal("monitoring-series"),
      reference: VersionReferenceSchema,
    }),
    sampledAt: IsoDateTimeSchema,
  }),
  z.strictObject({
    kind: z.literal("monitoring-feature"),
    monitoringSnapshotRef: z.strictObject({
      kind: z.literal("monitoring-snapshot"),
      reference: VersionReferenceSchema,
    }),
    monitoringSeriesRef: z.strictObject({
      kind: z.literal("monitoring-series"),
      reference: VersionReferenceSchema,
    }),
    featureType: z.enum([
      "short-term-slope",
      "acceleration",
      "dominant-frequency",
      "anomaly-score",
    ]),
  }),
]);
export type IndicatorValueSourceV1 = z.infer<typeof IndicatorValueSourceV1Schema>;

export const IndicatorActualValueV1Schema = z.strictObject({
  indicatorId: IdentifierSchema,
  indicatorType: RiskAssessmentIndicatorTypeSchema,
  valueKind: AssessmentIndicatorValueKindV1Schema,
  mappingId: IdentifierSchema,
  source: IndicatorValueSourceV1Schema,
  rawValue: ScalarValueSchema,
  rawUnit: z
    .string()
    .regex(/^[\x21-\x7e]{1,32}$/u)
    .optional(),
  actualValue: ScalarValueSchema,
  canonicalValue: z.string().min(1).max(200),
  canonicalUnit: z
    .string()
    .regex(/^[\x21-\x7e]{1,32}$/u)
    .optional(),
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1).max(256),
});
export type IndicatorActualValueV1 = z.infer<typeof IndicatorActualValueV1Schema>;

const indicatorActualValues = z
  .array(IndicatorActualValueV1Schema)
  .min(1)
  .max(RISK_ASSESSMENT_MAX_INDICATOR_VALUES_V1)
  .superRefine((values, context) => {
    const keys = values.map((value) => value.indicatorId);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "indicator values must be unique" });
      return;
    }
    for (let index = 1; index < keys.length; index += 1) {
      if (keys[index - 1]! >= keys[index]!) {
        context.addIssue({ code: "custom", path: [index], message: "values must be sorted" });
        return;
      }
    }
  });

export const IndicatorActualValueSetV1Schema = z.strictObject({
  schemaVersion: z.literal(RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1),
  indicatorActualValueSetRef: IndicatorActualValueSetRefV1Schema,
  projectId: IdentifierSchema,
  inputSnapshotRef: AssessmentInputSnapshotRefV1Schema,
  values: indicatorActualValues,
  contentDigest: z.string().regex(/^[0-9a-f]{64}$/u),
});
export type IndicatorActualValueSetV1 = z.infer<typeof IndicatorActualValueSetV1Schema>;

/* -------------------------------------------------------------------------- */
/* 四类触发事实（D-07）                                                        */
/* -------------------------------------------------------------------------- */

export const AssessmentTriggerFactV1Schema = z.strictObject({
  triggerType: WarningTriggerTypeSchema,
  identity: IdentifierSchema,
  indicatorItem: IdentifierSchema,
  thresholdId: IdentifierSchema.optional(),
  jointRuleId: IdentifierSchema.optional(),
  monitoringIndicator: MonitoringIndicatorSchema.optional(),
  parameterCode: z.string().min(1).max(200).optional(),
  metric: AssessmentConfigurationMetricV1Schema.optional(),
  actualValue: ScalarValueSchema.optional(),
  thresholdValue: z.string().min(1).max(200).optional(),
  evidenceReferences: z.array(EvidenceReferenceSchema).max(256),
});
export type AssessmentTriggerFactV1 = z.infer<typeof AssessmentTriggerFactV1Schema>;

/* -------------------------------------------------------------------------- */
/* 决策工件（D-08）                                                            */
/* -------------------------------------------------------------------------- */

export const AxisContributionV1Schema = z.strictObject({
  indicatorId: IdentifierSchema,
  baseScore: z.string().min(1).max(200),
  basisPoints: z.number().int().nonnegative().max(10_000).optional(),
  weightedScore: z.string().min(1).max(200),
});
export type AxisContributionV1 = z.infer<typeof AxisContributionV1Schema>;

export const AxisScoreV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("weighted-average"),
    decimalScale: z.number().int().nonnegative().max(6),
    weightSetRef: VersionReferenceSchema,
    score: z.string().min(1).max(200),
    publicScore: z.number().finite(),
    contributions: z
      .array(AxisContributionV1Schema)
      .min(1)
      .max(RISK_ASSESSMENT_MAX_INDICATOR_VALUES_V1),
  }),
  z.strictObject({
    kind: z.literal("maximum"),
    score: z.string().min(1).max(200),
    publicScore: z.number().finite(),
    contributions: z
      .array(AxisContributionV1Schema)
      .min(1)
      .max(RISK_ASSESSMENT_MAX_INDICATOR_VALUES_V1),
  }),
]);
export type AxisScoreV1 = z.infer<typeof AxisScoreV1Schema>;

export const AssessmentRuleReferenceV1Schema = z.strictObject({
  indicatorId: IdentifierSchema,
  ruleId: IdentifierSchema,
  ruleVersion: VersionReferenceSchema,
  releaseRef: KnowledgeReleaseRefV1Schema,
  revisionRef: KnowledgeRevisionRefV1Schema,
  artifactRef: ContentArtifactRefV1Schema,
  contentDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  thresholdId: IdentifierSchema,
  grade: IdentifierSchema,
  baseScore: z.string().min(1).max(200),
});
export type AssessmentRuleReferenceV1 = z.infer<typeof AssessmentRuleReferenceV1Schema>;

export const AssessmentDecisionArtifactV1Schema = z.strictObject({
  schemaVersion: z.literal(RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  preparationSnapshotRef: AssessmentPreparationSnapshotRefV1Schema,
  inputSnapshotRef: AssessmentInputSnapshotRefV1Schema,
  assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1Schema,
  riskInput: RiskInputVersionRefV1Schema,
  applicability: ApplicabilityMetadataSchema,
  indicatorActualValueSetDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  axisScores: z.strictObject({
    possibility: AxisScoreV1Schema,
    consequence: AxisScoreV1Schema,
  }),
  matrix: z.strictObject({
    riskMatrixRef: VersionReferenceSchema,
    possibilityBandId: IdentifierSchema,
    consequenceBandId: IdentifierSchema,
    riskLevelId: IdentifierSchema,
    riskLevelOrdinal: z.number().int().positive().max(32),
  }),
  rules: z
    .array(AssessmentRuleReferenceV1Schema)
    .min(1)
    .max(RISK_ASSESSMENT_MAX_INDICATOR_VALUES_V1),
  triggers: z.array(AssessmentTriggerFactV1Schema).max(RISK_ASSESSMENT_MAX_TRIGGERS_V1),
  configurationRefs: z.strictObject({
    indicatorSystemRef: VersionReferenceSchema,
    indicatorFieldMappingRef: VersionReferenceSchema,
    weightSetRef: VersionReferenceSchema,
    scoringStrategyRef: VersionReferenceSchema,
    riskAcceptanceThresholdRef: VersionReferenceSchema,
    monitoringWarningThresholdRef: VersionReferenceSchema,
    jointTriggerPolicyRef: VersionReferenceSchema,
  }),
});
export type AssessmentDecisionArtifactV1 = z.infer<typeof AssessmentDecisionArtifactV1Schema>;

/* -------------------------------------------------------------------------- */
/* 预测风险状态投影（D-08）                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 预测风险状态只回答「按同一冻结依据重算后风险落在哪一档」。它不产生正式评估记录、
 * 实际值集合、准备快照、预警、收据或 Outbox 事件，因此结果形状不是评估记录的子集，
 * 而是直接给出风险状态本身。
 */
export const ForecastRiskStateRequestV1Schema = z.strictObject({
  requestId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  requestedAt: IsoDateTimeSchema,
  projectId: IdentifierSchema,
  actorId: IdentifierSchema,
  authorization: AuthorizationContextV1Schema,
  /** 预测所基于的正式评估记录：精确版本，不接受「最新」。 */
  baselineAssessmentRecordRef: RiskAssessmentRecordRefV1Schema,
  /** 冻结的评分依据：与正式评估同一 input snapshot，规则／权重／矩阵不重新解析。 */
  frozenAssessmentBasisRef: AssessmentInputSnapshotRefV1Schema,
  /** 执行前的精确监测快照：预测过程不得越过该快照使用更晚数据。 */
  preActionMonitoringSnapshotRef: z.strictObject({
    kind: z.literal("monitoring-snapshot"),
    reference: VersionReferenceSchema,
  }),
  targetIndicatorId: IdentifierSchema,
  targetUnit: IdentifierSchema,
  predictedValue: ScalarValueSchema,
});
export type ForecastRiskStateRequestV1 = z.infer<typeof ForecastRiskStateRequestV1Schema>;

/** 不可用是受控结论而非失败：依据或监测不满足重算前提时按原因码返回，不伪造分数。 */
export const ForecastRiskStateUnavailableReasonCodeV1Schema = z.enum([
  "risk-state-unavailable",
  "monitoring-series-mismatch",
]);
export type ForecastRiskStateUnavailableReasonCodeV1 = z.infer<
  typeof ForecastRiskStateUnavailableReasonCodeV1Schema
>;

export const ForecastRiskStateResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("succeeded"),
    riskState: RiskStateSchema,
  }),
  z.strictObject({
    kind: z.literal("unavailable"),
    reasonCode: ForecastRiskStateUnavailableReasonCodeV1Schema,
  }),
  z.strictObject({
    kind: z.literal("failed"),
    error: ModuleErrorV1Schema,
  }),
]);
export type ForecastRiskStateResultV1 = z.infer<typeof ForecastRiskStateResultV1Schema>;
