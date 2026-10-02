import { z } from "zod";

import {
  CommandEnvelopeSchema,
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import {
  AgentTaskRefV1Schema,
  AgentTaskResultRefV1Schema,
  AssessmentBasisReleaseSetRefV1Schema,
  AssessmentInputSnapshotRefV1Schema,
  AuthorizationContextV1Schema,
  CalibrationSuggestionRefV1Schema,
  CalibrationReviewOutcomeCommandV1Schema as ContractsCalibrationReviewOutcomeCommandV1Schema,
  ContentArtifactRefV1Schema,
  ContractReferenceV1Schema,
  DeviationRecordRefV1Schema,
  KnowledgeReleaseRefV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  ReviewDecisionRefV1Schema,
  type CalibrationReviewOutcomeCommandV1 as ContractsCalibrationReviewOutcomeCommandV1,
  type ContractReferenceV1,
  type ModuleCapabilityV1,
  type ModuleErrorV1,
  type ModuleBranchV1,
} from "@riskflow/contracts/ports";
import { GradeIntervalSchema, ScoringThresholdSchema } from "@riskflow/contracts/records";

import {
  DeviationPolicyV1Schema,
  MonitoringWarningThresholdV1Schema,
  RiskAcceptanceThresholdV1Schema,
  RiskMatrixBandV1Schema,
  WeightEntryV1Schema,
} from "../assessment-config/index.js";
import { ResponseDeviationFactRefV1Schema } from "../response-lifecycle/index.js";

/**
 * C29 私有 schema：只描述校准输入快照、类型化领域操作、候选与稳定失败事实。
 * 公共偏差记录、命令、事件、复核类型和任务类型只从 `@riskflow/contracts` 消费，不复制字段。
 */
export const CALIBRATION_SCHEMA_VERSION_V1 = "1" as const;
export const CALIBRATION_INPUT_SNAPSHOT_KIND_V1 = "calibration-input-snapshot" as const;

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const reasonTextSchema = z.string().trim().min(1).max(2000);

/* -------------------------------------------------------------------------- */
/* D-03：目标定义类型与冻结输入                                                 */
/* -------------------------------------------------------------------------- */

/** 只允许可受校准影响、且 C16 可 `submit-revision` 的单一定义类型。 */
export const CALIBRATION_TARGET_DEFINITION_TYPES_V1 = [
  "weight-set",
  "risk-matrix",
  "risk-acceptance-threshold",
  "monitoring-warning-threshold",
  "deviation-policy",
  "structured-scoring-rule",
] as const;
export const CalibrationTargetDefinitionTypeV1Schema = z.enum(
  CALIBRATION_TARGET_DEFINITION_TYPES_V1,
);
export type CalibrationTargetDefinitionTypeV1 = z.infer<
  typeof CalibrationTargetDefinitionTypeV1Schema
>;

export const CalibrationInputSnapshotRefV1Schema = z.strictObject({
  kind: z.literal(CALIBRATION_INPUT_SNAPSHOT_KIND_V1),
  reference: VersionReferenceSchema,
});
export type CalibrationInputSnapshotRefV1 = z.infer<typeof CalibrationInputSnapshotRefV1Schema>;

/**
 * 冻结输入工件正文：固定 C28 偏差事实、派生公共记录引用、C25 冻结评估输入、
 * C19 评估依据、单目标定义与基准摘要、校验策略和 C08 执行策略。
 * 目标与基准只来自冻结依据，禁止在此保存 latest 或可变查询。
 */
export const CalibrationInputSnapshotV1Schema = z.strictObject({
  schemaVersion: z.literal(CALIBRATION_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  deviationFactRef: ResponseDeviationFactRefV1Schema,
  deviationRecordRef: DeviationRecordRefV1Schema,
  frozenAssessmentBasisRef: AssessmentInputSnapshotRefV1Schema,
  basisReleaseSetRef: AssessmentBasisReleaseSetRefV1Schema,
  targetDefinitionType: CalibrationTargetDefinitionTypeV1Schema,
  targetReleaseRef: KnowledgeReleaseRefV1Schema,
  baseArtifactRef: ContentArtifactRefV1Schema,
  baseContentDigest: digestSchema,
  calibrationValidationPolicyRef: VersionReferenceSchema,
  modelDeploymentRef: VersionReferenceSchema,
  promptTemplateRef: VersionReferenceSchema,
  toolPolicyRef: VersionReferenceSchema,
  budgetPolicyRef: VersionReferenceSchema,
  preparedBy: IdentifierSchema,
  preparedAt: IsoDateTimeSchema,
});
export type CalibrationInputSnapshotV1 = z.infer<typeof CalibrationInputSnapshotV1Schema>;

/* -------------------------------------------------------------------------- */
/* D-04：闭合类型化领域操作                                                     */
/* -------------------------------------------------------------------------- */

/** 六个分支与目标定义类型一一对应；replacement 直接复用 C18/C19 项目 Schema。 */
export const CalibrationOperationV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("replace-weight-entry"),
    definitionType: z.literal("weight-set"),
    axis: z.enum(["possibility", "consequence"]),
    entry: WeightEntryV1Schema,
  }),
  z.strictObject({
    kind: z.literal("replace-risk-matrix-band"),
    definitionType: z.literal("risk-matrix"),
    axis: z.enum(["possibility", "consequence"]),
    band: RiskMatrixBandV1Schema,
  }),
  z.strictObject({
    kind: z.literal("replace-risk-acceptance-threshold"),
    definitionType: z.literal("risk-acceptance-threshold"),
    threshold: RiskAcceptanceThresholdV1Schema,
  }),
  z.strictObject({
    kind: z.literal("replace-monitoring-warning-threshold"),
    definitionType: z.literal("monitoring-warning-threshold"),
    threshold: MonitoringWarningThresholdV1Schema,
  }),
  z.strictObject({
    kind: z.literal("replace-deviation-policy"),
    definitionType: z.literal("deviation-policy"),
    policy: DeviationPolicyV1Schema,
  }),
  z.strictObject({
    kind: z.literal("replace-scoring-rule-interval"),
    definitionType: z.literal("structured-scoring-rule"),
    ruleId: IdentifierSchema,
    replacement: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("threshold"), threshold: ScoringThresholdSchema }),
      z.strictObject({ kind: z.literal("grade-interval"), interval: GradeIntervalSchema }),
    ]),
  }),
]);
export type CalibrationOperationV1 = z.infer<typeof CalibrationOperationV1Schema>;

/** 每项操作的确定性处置：接受或带稳定原因拒绝。 */
export const CalibrationOperationDispositionV1Schema = z.enum(["accepted", "rejected"]);
export type CalibrationOperationDispositionV1 = z.infer<
  typeof CalibrationOperationDispositionV1Schema
>;

export const CalibrationValidationItemV1Schema = z.strictObject({
  operationIndex: z.number().int().nonnegative(),
  operationKind: IdentifierSchema,
  disposition: CalibrationOperationDispositionV1Schema,
  reasonCode: IdentifierSchema.optional(),
});
export type CalibrationValidationItemV1 = z.infer<typeof CalibrationValidationItemV1Schema>;

export const CALIBRATION_REJECTION_CLASSES_V1 = ["repairable", "terminal"] as const;
export const CalibrationRejectionClassV1Schema = z.enum(CALIBRATION_REJECTION_CLASSES_V1);
export type CalibrationRejectionClassV1 = z.infer<typeof CalibrationRejectionClassV1Schema>;

/** 候选逐项校验：只有 `repairable` 可在原 C08 预算内返回同一任务。 */
export const CalibrationCandidateValidationV1Schema = z
  .strictObject({
    schemaVersion: z.literal(CALIBRATION_SCHEMA_VERSION_V1),
    disposition: CalibrationOperationDispositionV1Schema,
    rejectionClass: CalibrationRejectionClassV1Schema.optional(),
    items: z.array(CalibrationValidationItemV1Schema).min(1),
    candidateDigest: digestSchema.optional(),
  })
  .superRefine((validation, context) => {
    if (validation.disposition === "accepted" && validation.rejectionClass !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["rejectionClass"],
        message: "accepted validation must not carry a rejection class",
      });
    }
    if (validation.disposition === "rejected" && validation.rejectionClass === undefined) {
      context.addIssue({
        code: "custom",
        path: ["rejectionClass"],
        message: "rejected validation requires a rejection class",
      });
    }
    if (validation.disposition === "accepted" && validation.candidateDigest === undefined) {
      context.addIssue({
        code: "custom",
        path: ["candidateDigest"],
        message: "accepted validation requires the candidate digest",
      });
    }
  });
export type CalibrationCandidateValidationV1 = z.infer<
  typeof CalibrationCandidateValidationV1Schema
>;

/** Agent 增量：绑定原任务、结果与冻结输入，只携带闭合领域操作、理由与证据。 */
export const CalibrationCandidateV1Schema = z.strictObject({
  schemaVersion: z.literal(CALIBRATION_SCHEMA_VERSION_V1),
  taskRef: AgentTaskRefV1Schema,
  resultRef: AgentTaskResultRefV1Schema,
  inputSnapshotRef: CalibrationInputSnapshotRefV1Schema,
  rationale: reasonTextSchema,
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
  operations: z.array(CalibrationOperationV1Schema).min(1).max(64),
});
export type CalibrationCandidateV1 = z.infer<typeof CalibrationCandidateV1Schema>;

/* -------------------------------------------------------------------------- */
/* 私有用例命令                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 后两个用例的命令信封：只补精确建议/决定与调用方声明的决定类型。
 *
 * 载荷与内部信封由 contracts 定义一次（design D-03），core 直接复用；公共治理入口按自身
 * branch 复验单能力授权（design D-08），因此此处不再断言调用方同时持有多个 capability。
 */
export const CalibrationReviewOutcomeCommandV1Schema =
  ContractsCalibrationReviewOutcomeCommandV1Schema;
export type CalibrationReviewOutcomeCommandV1 = ContractsCalibrationReviewOutcomeCommandV1;
export { CalibrationGovernanceOutcomeV1Schema } from "@riskflow/contracts/ports";
export type { CalibrationGovernanceOutcomeV1 } from "@riskflow/contracts/ports";

export const CALIBRATION_SUGGESTION_OUTCOMES_V1 = [
  "pending-review",
  "returned",
  "rejected",
  "approved-for-draft",
] as const;
export { CalibrationSuggestionStatusV1Schema } from "@riskflow/contracts/vocabulary";
export type { CalibrationSuggestionStatusV1 } from "@riskflow/contracts/vocabulary";
export type CalibrationSuggestionStatus = z.infer<
  typeof import("@riskflow/contracts/vocabulary").CalibrationSuggestionStatusV1Schema
>;

/* -------------------------------------------------------------------------- */
/* 稳定失败事实源                                                              */
/* -------------------------------------------------------------------------- */

export const CALIBRATION_REASON_CODES_V1 = [
  "calibration-authorization-required",
  "calibration-contract-drift",
  "calibration-deviation-fact-unavailable",
  "calibration-deviation-within-threshold",
  "calibration-deviation-fact-incomplete",
  "calibration-frozen-assessment-mismatch",
  "calibration-target-not-affected",
  "calibration-basis-member-unavailable",
  "calibration-base-artifact-mismatch",
  "calibration-agent-task-unavailable",
  "calibration-agent-result-mismatch",
  "calibration-agent-budget-exhausted",
  "calibration-candidate-invalid",
  "calibration-review-task-unavailable",
  "calibration-review-decision-not-found",
  "calibration-review-decision-not-approval",
  "calibration-review-target-mismatch",
  "calibration-suggestion-not-advanceable",
  "calibration-governance-draft-conflict",
  "calibration-idempotency-conflict",
] as const;
export const CalibrationReasonCodeV1Schema = z.enum(CALIBRATION_REASON_CODES_V1);
export type CalibrationReasonCodeV1 = z.infer<typeof CalibrationReasonCodeV1Schema>;

export const CALIBRATION_FAILURE_CODES_V1 = [
  "AUTHORIZATION_DENIED",
  "UNSUPPORTED_CONTRACT",
  "ENTITY_NOT_FOUND",
  "BUSINESS_BLOCKED",
  "STALE_VERSION",
  "IDEMPOTENCY_CONFLICT",
  "TRANSIENT_FAILURE",
  "TERMINAL_FAILURE",
] as const;
export const CalibrationFailureCodeV1Schema = z.enum(CALIBRATION_FAILURE_CODES_V1);
export type CalibrationFailureCodeV1 = z.infer<typeof CalibrationFailureCodeV1Schema>;

const FAILURE_CODE_BY_REASON_V1: Readonly<
  Record<CalibrationReasonCodeV1, CalibrationFailureCodeV1>
> = Object.freeze({
  "calibration-authorization-required": "AUTHORIZATION_DENIED",
  "calibration-contract-drift": "UNSUPPORTED_CONTRACT",
  "calibration-deviation-fact-unavailable": "BUSINESS_BLOCKED",
  "calibration-deviation-within-threshold": "BUSINESS_BLOCKED",
  "calibration-deviation-fact-incomplete": "BUSINESS_BLOCKED",
  "calibration-frozen-assessment-mismatch": "STALE_VERSION",
  "calibration-target-not-affected": "BUSINESS_BLOCKED",
  "calibration-basis-member-unavailable": "BUSINESS_BLOCKED",
  "calibration-base-artifact-mismatch": "STALE_VERSION",
  "calibration-agent-task-unavailable": "BUSINESS_BLOCKED",
  "calibration-agent-result-mismatch": "BUSINESS_BLOCKED",
  "calibration-agent-budget-exhausted": "BUSINESS_BLOCKED",
  "calibration-candidate-invalid": "BUSINESS_BLOCKED",
  "calibration-review-task-unavailable": "BUSINESS_BLOCKED",
  "calibration-review-decision-not-found": "ENTITY_NOT_FOUND",
  "calibration-review-decision-not-approval": "BUSINESS_BLOCKED",
  "calibration-review-target-mismatch": "STALE_VERSION",
  "calibration-suggestion-not-advanceable": "BUSINESS_BLOCKED",
  "calibration-governance-draft-conflict": "IDEMPOTENCY_CONFLICT",
  "calibration-idempotency-conflict": "IDEMPOTENCY_CONFLICT",
});

export interface CalibrationTargetRefV1 {
  readonly kind: string;
  readonly reference: { readonly entityId: string; readonly versionId: string };
}

export interface CalibrationFailureV1 {
  readonly code: CalibrationFailureCodeV1;
  readonly reasonCode: CalibrationReasonCodeV1;
  readonly targetRef: CalibrationTargetRefV1 | ContractReferenceV1;
}

export class CalibrationError extends Error {
  readonly failure: CalibrationFailureV1;

  constructor(failure: CalibrationFailureV1) {
    super(failure.code);
    this.name = "CalibrationError";
    this.failure = failure;
  }
}

export const calibrationFailureFrom = (error: unknown): CalibrationFailureV1 | undefined =>
  error instanceof CalibrationError ? error.failure : undefined;

export function failCalibration(
  reasonCode: CalibrationReasonCodeV1,
  targetRef: CalibrationTargetRefV1 | ContractReferenceV1,
  code?: CalibrationFailureCodeV1,
): never {
  throw new CalibrationError({
    code: code ?? FAILURE_CODE_BY_REASON_V1[reasonCode],
    reasonCode,
    targetRef,
  });
}

/** 失败引用先按公共闭合联合复验；形态不足时退化为稳定的模块引用，绝不改写原引用。 */
const contractTargetRef = (
  targetRef: CalibrationTargetRefV1 | ContractReferenceV1,
): ContractReferenceV1 => {
  const parsed = ContractReferenceV1Schema.safeParse(targetRef);
  return parsed.success
    ? parsed.data
    : {
        kind: "calibration-suggestion",
        reference: { entityId: "warning-response.calibration", versionId: "1" },
      };
};

export const toCalibrationModuleError = (
  failure: CalibrationFailureV1,
  causalRunId: string,
  requiredCapability: ModuleCapabilityV1,
): ModuleErrorV1 => {
  const common = {
    stageCode: "warning-response.calibration",
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
        schemaVersion: CALIBRATION_SCHEMA_VERSION_V1,
      });
    case "ENTITY_NOT_FOUND":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "ENTITY_NOT_FOUND",
        category: "not-found",
        retryable: false,
        targetRef: contractTargetRef(failure.targetRef),
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
        idempotencyKey: causalRunId,
        priorCommandId: causalRunId,
      });
    case "TRANSIENT_FAILURE":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "TRANSIENT_FAILURE",
        category: "technical",
        retryable: true,
        attempt: 1,
        retryPolicyRef: { entityId: "calibration-retry-policy", versionId: "1" },
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "calibration-transient", versionId: "1" },
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
          reference: { entityId: "calibration-terminal", versionId: "1" },
        },
      });
  }
};

/** C29 四个用例各自映射的既有能力分支；不新增 capability 枚举值。 */
export const CALIBRATION_BRANCH_CAPABILITIES_V1 = {
  prepareInput: MODULE_BRANCH_CAPABILITY_V1["warning-response.create-calibration-suggestion"],
  createSuggestion: MODULE_BRANCH_CAPABILITY_V1["warning-response.create-calibration-suggestion"],
  recordReviewOutcome:
    MODULE_BRANCH_CAPABILITY_V1["warning-response.create-calibration-suggestion"],
  createGovernanceDraft:
    MODULE_BRANCH_CAPABILITY_V1["warning-response.create-calibration-suggestion"],
} as const satisfies Readonly<Record<string, ModuleCapabilityV1>>;

export type CalibrationBranchV1 = ModuleBranchV1;
