import { z } from "zod";

import {
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  ValidationResultSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import {
  AssessmentInputSnapshotRefV1Schema,
  AssessmentPreparationSnapshotRefV1Schema,
  ContentArtifactRefV1Schema,
  ContractReferenceV1Schema,
  KnowledgeQueryResultRefV1Schema,
  MeasureLibraryReleaseRefV1Schema,
  ModuleErrorV1Schema,
  RecommendationCandidateRefV1Schema,
  RiskAssessmentRecordRefV1Schema,
  RiskInputVersionRefV1Schema,
  SpatialScopeRefV1Schema,
  WarningRecordRefV1Schema,
  WarningResponseTaskRefV1Schema,
  type ContractReferenceV1,
  type ModuleCapabilityV1,
  type ModuleErrorV1,
} from "@riskflow/contracts/ports";
import { ScalarValueSchema, TriggerIndicatorSchema } from "@riskflow/contracts/records";
import { WarningTriggerTypeSchema, type WarningTriggerType } from "@riskflow/contracts/vocabulary";

import { AgentTaskBudgetPolicyV1Schema } from "../agent-runtime/index.js";
import { AssessmentMeasureV1Schema } from "../assessment-config/index.js";

/**
 * C27 自有 schema：只描述处置措施候选、受限 Agent 增量、三项校验与建议候选的模块内事实；
 * 公共命令/结果/引用/正式记录仍只从 `@riskflow/contracts` 消费，不复制公共字段。
 */
export const RECOMMENDATION_SCHEMA_VERSION_V1 = "1" as const;
export const RECOMMENDATION_TASK_TYPE_V1 = "response-recommendation" as const;
export const RECOMMENDATION_MAX_CANDIDATES_V1 = 256;
export const RECOMMENDATION_MAX_SELECTIONS_V1 = 64;
export const RECOMMENDATION_MAX_WARNINGS_V1 = 256;

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const positiveInteger = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger, "must be a safe integer");

const refKey = (value: { readonly entityId: string; readonly versionId: string }): string =>
  `${value.entityId}\u0000${value.versionId}`;

const uniqueByKey = <T extends z.ZodType>(
  item: T,
  key: (value: z.infer<T>) => string,
  min: number,
  max: number,
) =>
  z
    .array(item)
    .min(min)
    .max(max)
    .superRefine((values, context) => {
      const keys = values.map(key);
      if (new Set(keys).size !== keys.length) {
        context.addIssue({ code: "custom", message: "identities must be unique" });
      }
    });

const versionedReferenceSchema = (kind: string) =>
  z.strictObject({ kind: z.literal(kind), reference: VersionReferenceSchema });

export const AssessmentBasisReleaseSetRefV1Schema = versionedReferenceSchema(
  "assessment-basis-release-set",
);
export type AssessmentBasisReleaseSetRefV1 = z.infer<typeof AssessmentBasisReleaseSetRefV1Schema>;

/* -------------------------------------------------------------------------- */
/* 冻结措施候选（D-03）                                                        */
/* -------------------------------------------------------------------------- */

/** 任务版本内的单条预警及其精确评估链：候选与校验都按该冻结引用复核。 */
export const RecommendationFrozenWarningV1Schema = z.strictObject({
  warningRecordRef: WarningRecordRefV1Schema,
  triggerType: WarningTriggerTypeSchema,
  triggerIndicators: z.array(TriggerIndicatorSchema).min(1),
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
  assessmentRecordRef: RiskAssessmentRecordRefV1Schema,
  assessmentInputSnapshotRef: AssessmentInputSnapshotRefV1Schema,
  preparationSnapshotRef: AssessmentPreparationSnapshotRefV1Schema,
});
export type RecommendationFrozenWarningV1 = z.infer<typeof RecommendationFrozenWarningV1Schema>;

/** 单条候选措施：C18 原内容 + 匹配的预警与触发类型，不复制或改写措施事实。 */
export const MeasureCandidateV1Schema = z.strictObject({
  measure: AssessmentMeasureV1Schema,
  triggerTypes: uniqueByKey(
    WarningTriggerTypeSchema,
    (value) => value,
    1,
    WarningTriggerTypeSchema.options.length,
  ),
  warningRecordRefs: uniqueByKey(
    WarningRecordRefV1Schema,
    (value) => refKey(value.reference),
    1,
    RECOMMENDATION_MAX_WARNINGS_V1,
  ),
});
export type MeasureCandidateV1 = z.infer<typeof MeasureCandidateV1Schema>;

export const MeasureCandidateSetV1Schema = z
  .strictObject({
    schemaVersion: z.literal(RECOMMENDATION_SCHEMA_VERSION_V1),
    projectId: IdentifierSchema,
    warningResponseTaskRef: WarningResponseTaskRefV1Schema,
    riskInputRef: RiskInputVersionRefV1Schema,
    spatialScopeRef: SpatialScopeRefV1Schema,
    applicableRuleSetRef: VersionReferenceSchema,
    basisReleaseSetRef: AssessmentBasisReleaseSetRefV1Schema,
    measureLibraryReleaseRef: MeasureLibraryReleaseRefV1Schema,
    measureArtifactRef: ContentArtifactRefV1Schema,
    measureContentDigest: digestSchema,
    generationPolicyRef: VersionReferenceSchema,
    validationPolicyRef: VersionReferenceSchema,
    agentPolicyRef: VersionReferenceSchema,
    reviewPolicyRef: VersionReferenceSchema,
    riskEventCategory: IdentifierSchema,
    warnings: uniqueByKey(
      RecommendationFrozenWarningV1Schema,
      (value) => refKey(value.warningRecordRef.reference),
      1,
      RECOMMENDATION_MAX_WARNINGS_V1,
    ),
    candidates: uniqueByKey(
      MeasureCandidateV1Schema,
      (value) => value.measure.measureId,
      1,
      RECOMMENDATION_MAX_CANDIDATES_V1,
    ),
    inputDigest: digestSchema,
    frozenAt: IsoDateTimeSchema,
    frozenBy: IdentifierSchema,
  })
  .superRefine((set, context) => {
    const sorted = [...set.candidates].sort((left, right) =>
      left.measure.measureId < right.measure.measureId ? -1 : 1,
    );
    if (
      sorted.some(
        (candidate, index) =>
          candidate.measure.measureId !== set.candidates[index]!.measure.measureId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "candidates must be sorted",
      });
    }
    const warningKeys = new Set(
      set.warnings.map((warning) => refKey(warning.warningRecordRef.reference)),
    );
    for (const [index, candidate] of set.candidates.entries()) {
      for (const ref of candidate.warningRecordRefs) {
        if (!warningKeys.has(refKey(ref.reference))) {
          context.addIssue({
            code: "custom",
            path: ["candidates", index, "warningRecordRefs"],
            message: "candidate references a warning outside the frozen set",
          });
        }
      }
    }
  });
export type MeasureCandidateSetV1 = z.infer<typeof MeasureCandidateSetV1Schema>;

/* -------------------------------------------------------------------------- */
/* 部署注入的版本化策略与现场上下文（D-06）                                     */
/* -------------------------------------------------------------------------- */

/** 风险事件类别只能由已审核策略按精确风险输入引用显式绑定。 */
export const ResponseGenerationPolicyV1Schema = z
  .strictObject({
    schemaVersion: z.literal(RECOMMENDATION_SCHEMA_VERSION_V1),
    policyRef: VersionReferenceSchema,
    projectId: IdentifierSchema,
    bindings: uniqueByKey(
      z.strictObject({
        riskInputRef: RiskInputVersionRefV1Schema,
        riskEventCategory: IdentifierSchema,
      }),
      (value) => `${value.riskInputRef.kind}\u0000${refKey(value.riskInputRef.reference)}`,
      0,
      4096,
    ),
  })
  .superRefine((policy, context) => {
    const sorted = [...policy.bindings].sort((left, right) =>
      refKey(left.riskInputRef.reference) < refKey(right.riskInputRef.reference) ? -1 : 1,
    );
    if (
      sorted.some(
        (binding, index) =>
          binding.riskInputRef.reference.entityId !==
            policy.bindings[index]!.riskInputRef.reference.entityId ||
          binding.riskInputRef.reference.versionId !==
            policy.bindings[index]!.riskInputRef.reference.versionId,
      )
    ) {
      context.addIssue({ code: "custom", path: ["bindings"], message: "bindings must be sorted" });
    }
  });
export type ResponseGenerationPolicyV1 = z.infer<typeof ResponseGenerationPolicyV1Schema>;

/** 三项校验的甲方审核依据：目标值、规范许可、禁忌条件与可执行工序状态。 */
export const ResponseValidationPolicyV1Schema = z.strictObject({
  schemaVersion: z.literal(RECOMMENDATION_SCHEMA_VERSION_V1),
  policyRef: VersionReferenceSchema,
  projectId: IdentifierSchema,
  targetIndicators: uniqueByKey(
    z.strictObject({ indicatorItem: IdentifierSchema, targetValue: ScalarValueSchema }),
    (value) => value.indicatorItem,
    1,
    256,
  ),
  reviewedStandardEvidence: uniqueByKey(
    z.strictObject({ measureId: IdentifierSchema, evidenceItem: IdentifierSchema }),
    (value) => `${value.measureId}\u0000${value.evidenceItem}`,
    0,
    4096,
  ),
  contraindicationRules: uniqueByKey(
    z.strictObject({
      contraindicationId: IdentifierSchema,
      triggerTypes: uniqueByKey(WarningTriggerTypeSchema, (value) => value, 1, 64),
    }),
    (value) => value.contraindicationId,
    0,
    256,
  ),
  executableProcessStatuses: uniqueByKey(IdentifierSchema, (value) => value, 1, 64),
});
export type ResponseValidationPolicyV1 = z.infer<typeof ResponseValidationPolicyV1Schema>;

/** 可信提供者按精确引用与时间取得的现场上下文；命令不得内联规则或资源。 */
export const RecommendationSiteContextV1Schema = z.strictObject({
  schemaVersion: z.literal(RECOMMENDATION_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  siteContextRef: VersionReferenceSchema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  processNodeRef: VersionReferenceSchema,
  processStatus: IdentifierSchema,
  availableResources: uniqueByKey(IdentifierSchema, (value) => value, 0, 4096),
  constraints: uniqueByKey(IdentifierSchema, (value) => value, 0, 4096),
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
  observedAt: IsoDateTimeSchema,
});
export type RecommendationSiteContextV1 = z.infer<typeof RecommendationSiteContextV1Schema>;

/** 处置 Agent 的版本化编制策略：绑定任务类型、工具、增量 schema、校验策略与硬预算。 */
export const ResponseAgentPolicyV1Schema = z
  .strictObject({
    schemaVersion: z.literal(RECOMMENDATION_SCHEMA_VERSION_V1),
    policyRef: VersionReferenceSchema,
    projectId: IdentifierSchema,
    definitionRef: VersionReferenceSchema,
    toolPolicyRef: VersionReferenceSchema,
    incrementSchemaRef: VersionReferenceSchema,
    validationPolicyRef: VersionReferenceSchema,
    budgetPolicy: AgentTaskBudgetPolicyV1Schema,
  })
  .superRefine((policy, context) => {
    if (refKey(policy.toolPolicyRef) !== refKey(policy.budgetPolicy.toolPolicyRef)) {
      context.addIssue({
        code: "custom",
        path: ["toolPolicyRef"],
        message: "toolPolicyRef must match the frozen budget policy",
      });
    }
  });
export type ResponseAgentPolicyV1 = z.infer<typeof ResponseAgentPolicyV1Schema>;

/* -------------------------------------------------------------------------- */
/* 受限 Agent 增量、候选与校验快照（D-04/D-07）                                 */
/* -------------------------------------------------------------------------- */

export const ResponseRecommendationIncrementV1Schema = z
  .strictObject({
    schemaVersion: z.literal(RECOMMENDATION_SCHEMA_VERSION_V1),
    selections: z
      .array(
        z.strictObject({
          measureId: IdentifierSchema,
          order: positiveInteger.max(RECOMMENDATION_MAX_SELECTIONS_V1),
        }),
      )
      .min(1)
      .max(RECOMMENDATION_MAX_SELECTIONS_V1),
  })
  .superRefine((increment, context) => {
    const ids = increment.selections.map((selection) => selection.measureId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["selections"],
        message: "measures must be unique",
      });
    }
    const orders = [...increment.selections.map((selection) => selection.order)].sort(
      (left, right) => left - right,
    );
    if (orders.some((order, index) => order !== index + 1)) {
      context.addIssue({
        code: "custom",
        path: ["selections"],
        message: "orders must start at 1 and be contiguous",
      });
    }
  });
export type ResponseRecommendationIncrementV1 = z.infer<
  typeof ResponseRecommendationIncrementV1Schema
>;

export const RecommendationCandidateV1Schema = z.strictObject({
  schemaVersion: z.literal(RECOMMENDATION_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  candidateRef: RecommendationCandidateRefV1Schema,
  warningResponseTaskRef: WarningResponseTaskRefV1Schema,
  measureCandidateQueryResultRef: KnowledgeQueryResultRefV1Schema,
  generationPolicyRef: VersionReferenceSchema,
  agentTaskRef: z.strictObject({
    kind: z.literal("agent-task"),
    reference: VersionReferenceSchema,
  }),
  parentRunRef: z.strictObject({
    kind: z.literal("workflow-run"),
    reference: VersionReferenceSchema,
  }),
  riskEventCategory: IdentifierSchema,
  spatialScopeRef: SpatialScopeRefV1Schema,
  selections: ResponseRecommendationIncrementV1Schema.shape.selections,
  primaryWarningRecordRef: WarningRecordRefV1Schema,
  matchedWarningRefs: uniqueByKey(
    WarningRecordRefV1Schema,
    (value) => refKey(value.reference),
    1,
    RECOMMENDATION_MAX_WARNINGS_V1,
  ),
  candidateDigest: digestSchema,
  createdBy: IdentifierSchema,
  createdAt: IsoDateTimeSchema,
});
export type RecommendationCandidateV1 = z.infer<typeof RecommendationCandidateV1Schema>;

/** 校验证据快照：三项独立结果加完整诊断，保存到 C04 后只留精确引用与摘要。 */
export const RecommendationValidationEvidenceV1Schema = z.strictObject({
  schemaVersion: z.literal(RECOMMENDATION_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  candidateRef: RecommendationCandidateRefV1Schema,
  validationPolicyRef: VersionReferenceSchema,
  siteContextRef: VersionReferenceSchema,
  targetIndicators: z.array(
    z.strictObject({
      indicatorItem: IdentifierSchema,
      targetValue: ScalarValueSchema,
    }),
  ),
  resourceRequirements: z.array(IdentifierSchema),
  results: z.strictObject({
    triggerConsistency: ValidationResultSchema,
    standardsCompliance: ValidationResultSchema,
    siteFeasibility: ValidationResultSchema,
  }),
  diagnostics: z.array(
    z.strictObject({
      checkId: z.enum(["trigger-consistency", "standards-compliance", "site-feasibility"]),
      reasonCode: IdentifierSchema,
      passed: z.boolean(),
      references: z.array(ContractReferenceV1Schema),
    }),
  ),
  validatedBy: IdentifierSchema,
  validatedAt: IsoDateTimeSchema,
});
export type RecommendationValidationEvidenceV1 = z.infer<
  typeof RecommendationValidationEvidenceV1Schema
>;

export const RecommendationValidationResultsV1Schema = z.strictObject({
  triggerConsistency: ValidationResultSchema,
  standardsCompliance: ValidationResultSchema,
  siteFeasibility: ValidationResultSchema,
});
export type RecommendationValidationResultsV1 = z.infer<
  typeof RecommendationValidationResultsV1Schema
>;

export const recommendationValidationPassed = (
  results: RecommendationValidationResultsV1,
): boolean =>
  results.triggerConsistency.passed &&
  results.standardsCompliance.passed &&
  results.siteFeasibility.passed;

/* -------------------------------------------------------------------------- */
/* 闭合失败事实源（D-08）                                                      */
/* -------------------------------------------------------------------------- */

export const RECOMMENDATION_REASON_CODES_V1 = [
  "recommendation-authorization-required",
  "recommendation-contract-drift",
  "recommendation-task-version-stale",
  "recommendation-warning-mismatch",
  "measure-candidates-unavailable",
  "measure-category-unbound",
  "measure-candidates-empty",
  "response-policy-unavailable",
  "response-policy-mismatch",
  "site-context-unavailable",
  "site-context-mismatch",
  "agent-task-result-mismatch",
  "recommendation-candidate-mismatch",
  "recommendation-idempotency-conflict",
  "recommendation-validation-rejected",
  "review-request-failed",
] as const;
export const RecommendationReasonCodeV1Schema = z.enum(RECOMMENDATION_REASON_CODES_V1);
export type RecommendationReasonCodeV1 = z.infer<typeof RecommendationReasonCodeV1Schema>;

export const RECOMMENDATION_FAILURE_CODES_V1 = [
  "AUTHORIZATION_DENIED",
  "UNSUPPORTED_CONTRACT",
  "BUSINESS_BLOCKED",
  "STALE_VERSION",
  "IDEMPOTENCY_CONFLICT",
  "TRANSIENT_FAILURE",
  "TERMINAL_FAILURE",
] as const;
export const RecommendationFailureCodeV1Schema = z.enum(RECOMMENDATION_FAILURE_CODES_V1);
export type RecommendationFailureCodeV1 = z.infer<typeof RecommendationFailureCodeV1Schema>;

const FAILURE_CODE_BY_REASON_V1: Readonly<
  Record<RecommendationReasonCodeV1, RecommendationFailureCodeV1>
> = Object.freeze({
  "recommendation-authorization-required": "AUTHORIZATION_DENIED",
  "recommendation-contract-drift": "UNSUPPORTED_CONTRACT",
  "recommendation-task-version-stale": "STALE_VERSION",
  "recommendation-warning-mismatch": "BUSINESS_BLOCKED",
  "measure-candidates-unavailable": "BUSINESS_BLOCKED",
  "measure-category-unbound": "BUSINESS_BLOCKED",
  "measure-candidates-empty": "BUSINESS_BLOCKED",
  "response-policy-unavailable": "BUSINESS_BLOCKED",
  "response-policy-mismatch": "STALE_VERSION",
  "site-context-unavailable": "BUSINESS_BLOCKED",
  "site-context-mismatch": "STALE_VERSION",
  "agent-task-result-mismatch": "STALE_VERSION",
  "recommendation-candidate-mismatch": "STALE_VERSION",
  "recommendation-idempotency-conflict": "IDEMPOTENCY_CONFLICT",
  "recommendation-validation-rejected": "BUSINESS_BLOCKED",
  "review-request-failed": "TERMINAL_FAILURE",
});

export interface RecommendationTargetRefV1 {
  readonly kind: string;
  readonly reference: { readonly entityId: string; readonly versionId: string };
}

export interface RecommendationFailureV1 {
  readonly code: RecommendationFailureCodeV1;
  readonly reasonCode: RecommendationReasonCodeV1;
  readonly targetRef: RecommendationTargetRefV1;
}

export class RecommendationError extends Error {
  readonly failure: RecommendationFailureV1;

  constructor(failure: RecommendationFailureV1) {
    super(failure.code);
    this.name = "RecommendationError";
    this.failure = failure;
  }
}

export const recommendationFailureFrom = (error: unknown): RecommendationFailureV1 | undefined =>
  error instanceof RecommendationError ? error.failure : undefined;

export const failRecommendation = (
  reasonCode: RecommendationReasonCodeV1,
  targetRef: RecommendationTargetRefV1,
  code?: RecommendationFailureCodeV1,
): never => {
  throw new RecommendationError({
    code: code ?? FAILURE_CODE_BY_REASON_V1[reasonCode],
    reasonCode,
    targetRef,
  });
};

/** 失败引用先按公共闭合联合复验；形态不足时退化为稳定的建议任务引用，绝不改写原引用。 */
const contractTargetRef = (targetRef: RecommendationTargetRefV1): ContractReferenceV1 => {
  const parsed = ContractReferenceV1Schema.safeParse(targetRef);
  return parsed.success
    ? parsed.data
    : {
        kind: "warning-response-task",
        reference: { entityId: "warning-response.recommendation", versionId: "1" },
      };
};

export const toRecommendationModuleError = (
  failure: RecommendationFailureV1,
  causalRunId: string,
  requiredCapability: ModuleCapabilityV1 = "warning-response.recommend",
): ModuleErrorV1 => {
  const common = {
    stageCode: "warning-response.recommendation",
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
        schemaVersion: RECOMMENDATION_SCHEMA_VERSION_V1,
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
        retryPolicyRef: { entityId: "recommendation-retry-policy", versionId: "1" },
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "recommendation-transient", versionId: "1" },
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
          reference: { entityId: "recommendation-terminal", versionId: "1" },
        },
      });
  }
};

/** 触发类型集合的规范顺序：与 C26 预警分组一致，用于稳定的证据排序。 */
export const orderTriggerTypes = (
  triggerTypes: readonly WarningTriggerType[],
): readonly WarningTriggerType[] => [...new Set(triggerTypes)].sort();
