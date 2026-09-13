import { z } from "zod";

import {
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
  type VersionReference,
} from "@riskflow/contracts/common";
import {
  AgentTaskRefV1Schema,
  ApplicabilityMetadataSnapshotRefV1Schema,
  AssessmentPreparationSnapshotRefV1Schema,
  AuthorizationContextRefV1Schema,
  AuthorizationContextV1Schema,
  ContentArtifactRefV1Schema,
  KnowledgeReleaseRefV1Schema,
  KnowledgeRevisionRefV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  ProjectRevisionRefV1Schema,
  SourceVersionRefV1Schema,
  WaitingRefV1Schema,
  type KnowledgeRevisionRefV1,
} from "@riskflow/contracts/ports";
import { ApplicabilityMetadataDimensionSchema } from "@riskflow/contracts/vocabulary";
import {
  ApplicabilityMetadataSchema,
  ScalarValueSchema,
  StructuredScoringRuleSchema,
} from "@riskflow/contracts/records";

import { AgentTaskBudgetPolicyV1Schema } from "../agent-runtime/index.js";
import {
  ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1,
  AssessmentConfigurationDefinitionTypeV1Schema,
} from "../assessment-config/index.js";
import { sha256CanonicalJson } from "../persistence/canonical-json.js";

export const SCORING_RULES_SCHEMA_VERSION_V1 = "1" as const;
export const STRUCTURED_SCORING_RULE_MEDIA_TYPE_V1 =
  "application/vnd.riskflow.structured-scoring-rule+json" as const;
export const APPLICABLE_RULE_SET_MEDIA_TYPE_V1 =
  "application/vnd.riskflow.applicable-rule-set+json" as const;
export const SCORING_RULES_MAX_ARTIFACT_BYTES_V1 = 1024 * 1024;
export const STRUCTURED_SCORING_RULE_ARTIFACT_PURPOSE_CODE_V1 =
  "knowledge-modeling.structured-scoring-rule" as const;
export const APPLICABLE_RULE_SET_ARTIFACT_PURPOSE_CODE_V1 =
  "knowledge-modeling.applicable-rule-set" as const;
export const SCORING_RULE_AUTHORING_MANIFEST_PURPOSE_CODE_V1 =
  "knowledge-modeling.scoring-rule-authoring-manifest" as const;
export const ASSESSMENT_BASIS_RELEASE_SET_SCHEMA_VERSION_V1 = "1" as const;
export const ASSESSMENT_BASIS_RELEASE_SET_REF_KIND_V1 = "assessment-basis-release-set" as const;

export const SCORING_RULES_MAX_RULES_V1 = 512;
export const SCORING_RULES_MAX_OPERATIONS_V1 = 64;
export const SCORING_RULES_MAX_EVIDENCE_REFERENCES_V1 = 16;
export const SCORING_RULES_MAX_RELATION_EVIDENCE_V1 = 16;
export const SCORING_RULES_MAX_RELATIONS_V1 = 512;
export const SCORING_RULES_MAX_SOURCE_SEGMENTS_V1 = 256;
export const SCORING_RULE_AUTHORING_TASK_TYPE_V1 = "knowledge-authoring" as const;

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const positiveInteger = z.number().int().positive();

/**
 * 归一后的数值阈值区间。`null` 分别表示 −∞/＋∞；`eq` 的数值形式固定为闭合单点。
 * 这是 C19 唯一的端点/无穷边界表示，校验、冲突检测与评分必须共用。
 */
export const NormalizedScoringThresholdV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("numeric"),
    thresholdId: IdentifierSchema,
    score: z.number().finite(),
    operator: z.enum(["lt", "lte", "eq", "gte", "gt", "between"]),
    lower: z.number().finite().nullable(),
    lowerInclusive: z.boolean(),
    upper: z.number().finite().nullable(),
    upperInclusive: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("discrete"),
    thresholdId: IdentifierSchema,
    score: z.number().finite(),
    operator: z.literal("eq"),
    value: ScalarValueSchema,
  }),
]);
export type NormalizedScoringThresholdV1 = z.infer<typeof NormalizedScoringThresholdV1Schema>;

/** 等级区间固定左闭右开；`null` 下界＝−∞、`null` 上界＝＋∞。 */
export const NormalizedGradeIntervalV1Schema = z.strictObject({
  grade: IdentifierSchema,
  lower: z.number().finite().nullable(),
  upper: z.number().finite().nullable(),
  lowerInclusive: z.literal(true),
  upperInclusive: z.literal(false),
});
export type NormalizedGradeIntervalV1 = z.infer<typeof NormalizedGradeIntervalV1Schema>;

export const SCORING_VALUE_REJECTION_REASONS_V1 = [
  "scoring-value-type-mismatch",
  "scoring-value-out-of-range",
] as const;
export const ScoringValueRejectionReasonV1Schema = z.enum(SCORING_VALUE_REJECTION_REASONS_V1);
export type ScoringValueRejectionReasonV1 = z.infer<typeof ScoringValueRejectionReasonV1Schema>;

/** strict 判别结果：成功只含被命中的阈值与评分等级，失败不含任何补值。 */
export const ScoringRuleEvaluationResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("evaluated"),
    thresholdId: IdentifierSchema,
    score: z.number().finite(),
    grade: IdentifierSchema,
  }),
  z.strictObject({
    kind: z.literal("rejected"),
    reasonCode: ScoringValueRejectionReasonV1Schema,
  }),
]);
export type ScoringRuleEvaluationResultV1 = z.infer<typeof ScoringRuleEvaluationResultV1Schema>;

export const SCORING_RULE_RELATION_KINDS_V1 = ["conflict", "overlap"] as const;
export const ScoringRuleRelationKindV1Schema = z.enum(SCORING_RULE_RELATION_KINDS_V1);
export type ScoringRuleRelationKindV1 = z.infer<typeof ScoringRuleRelationKindV1Schema>;

export const SCORING_RULE_DECISION_KINDS_V1 = ["included", "excluded"] as const;
export const ScoringRuleDecisionKindV1Schema = z.enum(SCORING_RULE_DECISION_KINDS_V1);
export type ScoringRuleDecisionKindV1 = z.infer<typeof ScoringRuleDecisionKindV1Schema>;

/** 筛除原因是闭合枚举，不接受自由文本或模型自造原因。 */
export const SCORING_RULE_EXCLUSION_REASONS_V1 = [
  "assembly-policy-unavailable",
  "construction-method-mismatch",
  "stratum-condition-mismatch",
  "engineering-stage-mismatch",
  "exception-applies",
  "conflict-unresolved",
  "approved-conflict-resolution",
  "compatibility-mismatch",
  "superseded-overlap",
  "release-unavailable",
] as const;
export const ScoringRuleExclusionReasonV1Schema = z.enum(SCORING_RULE_EXCLUSION_REASONS_V1);
export type ScoringRuleExclusionReasonV1 = z.infer<typeof ScoringRuleExclusionReasonV1Schema>;

export const SCORING_RULE_ACCEPTANCE_REASONS_V1 = ["three-dimensional-match"] as const;
export const ScoringRuleAcceptanceReasonV1Schema = z.enum(SCORING_RULE_ACCEPTANCE_REASONS_V1);
export type ScoringRuleAcceptanceReasonV1 = z.infer<typeof ScoringRuleAcceptanceReasonV1Schema>;

export const SCORING_RULE_VALIDATION_REASONS_V1 = [
  "scoring-rule-content-valid",
  "scoring-rule-content-invalid",
  "scoring-rule-review-status-not-pending",
  "scoring-rule-applicability-incomplete",
  "scoring-rule-indicator-unknown",
  "scoring-rule-threshold-invalid",
  "scoring-rule-grade-invalid",
  "scoring-rule-exception-unknown",
  "scoring-rule-evidence-unverified",
  "scoring-rule-base-version-conflict",
  "scoring-rule-operation-invalid",
  "scoring-rule-target-unknown",
  "scoring-rule-envelope-invalid",
  "scoring-rule-source-unavailable",
  "scoring-rule-compatibility-mismatch",
  "scoring-rule-conflict-detected",
  "scoring-rule-limit-exceeded",
] as const;
export const ScoringRuleValidationReasonV1Schema = z.enum(SCORING_RULE_VALIDATION_REASONS_V1);
export type ScoringRuleValidationReasonV1 = z.infer<typeof ScoringRuleValidationReasonV1Schema>;

export const SCORING_RULE_REJECTION_CLASSES_V1 = ["repairable", "terminal"] as const;
export const ScoringRuleRejectionClassV1Schema = z.enum(SCORING_RULE_REJECTION_CLASSES_V1);
export type ScoringRuleRejectionClassV1 = z.infer<typeof ScoringRuleRejectionClassV1Schema>;

export const SCORING_RULE_DISPOSITIONS_V1 = ["accepted", "rejected"] as const;
export const ScoringRuleDispositionV1Schema = z.enum(SCORING_RULE_DISPOSITIONS_V1);
export type ScoringRuleDispositionV1 = z.infer<typeof ScoringRuleDispositionV1Schema>;

const applicableRuleSetMemberBase = {
  releaseRef: KnowledgeReleaseRefV1Schema,
  revisionRef: KnowledgeRevisionRefV1Schema,
  artifactRef: ContentArtifactRefV1Schema,
  contentDigest: hashSchema,
};

/** 规则集成员：精确四字段投影，不含正文、名称或自由字段。 */
export const ApplicableRuleSetIncludedMemberV1Schema = z.strictObject({
  ruleId: IdentifierSchema,
  ruleVersion: VersionReferenceSchema,
  ...applicableRuleSetMemberBase,
});
export type ApplicableRuleSetIncludedMemberV1 = z.infer<
  typeof ApplicableRuleSetIncludedMemberV1Schema
>;

export const ScoringRuleRelationRefV1Schema = z.strictObject({
  relationId: IdentifierSchema,
  relationKind: ScoringRuleRelationKindV1Schema,
});

export const ScoringRuleOverlapDomainV1Schema = z.strictObject({
  indicatorItem: IdentifierSchema,
  lower: z.number().finite().nullable(),
  lowerInclusive: z.boolean(),
  upper: z.number().finite().nullable(),
  upperInclusive: z.boolean(),
  leftThresholdIds: z.array(IdentifierSchema).min(1).max(64),
  rightThresholdIds: z.array(IdentifierSchema).min(1).max(64),
  leftGradeIds: z.array(IdentifierSchema).max(64),
  rightGradeIds: z.array(IdentifierSchema).max(64),
});
export type ScoringRuleOverlapDomainV1 = z.infer<typeof ScoringRuleOverlapDomainV1Schema>;

/** 不可变冲突/重叠事实：双方规则版本、交叠域、策略与闭合拟议处置。 */
export const scoringRuleIdentityKey = (ruleId: string, version: VersionReference): string =>
  JSON.stringify([ruleId, version.entityId, version.versionId]);

const sameVersionReference = (left: VersionReference, right: VersionReference): boolean =>
  left.entityId === right.entityId && left.versionId === right.versionId;

export const ScoringRuleRelationV1Schema = z
  .strictObject({
    relationId: IdentifierSchema,
    relationKind: ScoringRuleRelationKindV1Schema,
    policyRef: VersionReferenceSchema,
    leftRuleVersion: VersionReferenceSchema,
    rightRuleVersion: VersionReferenceSchema,
    leftRuleId: IdentifierSchema,
    rightRuleId: IdentifierSchema,
    overlap: ScoringRuleOverlapDomainV1Schema,
    overlapDigest: hashSchema,
    retainedRuleVersionRef: VersionReferenceSchema,
    excludedRuleVersionRef: VersionReferenceSchema,
    evidenceReferences: z
      .array(EvidenceReferenceSchema)
      .max(SCORING_RULES_MAX_RELATION_EVIDENCE_V1),
  })
  .superRefine((relation, context) => {
    if (
      relation.leftRuleId !== relation.leftRuleVersion.entityId ||
      relation.rightRuleId !== relation.rightRuleVersion.entityId
    ) {
      context.addIssue({
        code: "custom",
        path: ["leftRuleId"],
        message: "rule ids must match their version entity ids",
      });
    }
    if (
      scoringRuleIdentityKey(relation.leftRuleId, relation.leftRuleVersion) >=
      scoringRuleIdentityKey(relation.rightRuleId, relation.rightRuleVersion)
    ) {
      context.addIssue({
        code: "custom",
        path: ["rightRuleVersion"],
        message: "rule relation endpoints must use canonical identity order",
      });
    }
    const retainedIsEndpoint =
      sameVersionReference(relation.retainedRuleVersionRef, relation.leftRuleVersion) ||
      sameVersionReference(relation.retainedRuleVersionRef, relation.rightRuleVersion);
    const excludedIsEndpoint =
      sameVersionReference(relation.excludedRuleVersionRef, relation.leftRuleVersion) ||
      sameVersionReference(relation.excludedRuleVersionRef, relation.rightRuleVersion);
    if (
      !retainedIsEndpoint ||
      !excludedIsEndpoint ||
      sameVersionReference(relation.retainedRuleVersionRef, relation.excludedRuleVersionRef)
    ) {
      context.addIssue({
        code: "custom",
        path: ["retainedRuleVersionRef"],
        message: "relation disposition must retain and exclude distinct endpoints",
      });
    }
  });
export type ScoringRuleRelationV1 = z.infer<typeof ScoringRuleRelationV1Schema>;

export const ScoringRuleRelationStatusV1Schema = z.enum([
  "pending",
  "approved",
  "rejected",
  "returned",
]);
export type ScoringRuleRelationStatusV1 = z.infer<typeof ScoringRuleRelationStatusV1Schema>;

/**
 * 一次确定性冲突/重叠检测的完整快照：绑定候选正文摘要、精确比较基线与全部关系事实。
 * 检测先形成无 owner 模板；C16 生成 revision 后绑定关系身份和本快照，再同事务耐久化。
 */
export const ScoringRuleRelationSnapshotV1Schema = z.strictObject({
  policyRef: VersionReferenceSchema,
  candidateContentDigest: hashSchema,
  baseReleaseRef: KnowledgeReleaseRefV1Schema.optional(),
  baseRevisionRef: KnowledgeRevisionRefV1Schema.optional(),
  relations: z.array(ScoringRuleRelationV1Schema).max(SCORING_RULES_MAX_RELATIONS_V1),
  relationDigest: hashSchema,
});
export type ScoringRuleRelationSnapshotV1 = z.infer<typeof ScoringRuleRelationSnapshotV1Schema>;

/** 来源绑定：只增加追溯关系，不复制条文正文。 */
export const ScoringRuleSourceBindingV1Schema = z.strictObject({
  sourceVersionRef: SourceVersionRefV1Schema,
  cleaningResultArtifactRef: ContentArtifactRefV1Schema,
  evidenceReferences: z
    .array(EvidenceReferenceSchema)
    .min(1)
    .max(SCORING_RULES_MAX_EVIDENCE_REFERENCES_V1),
  agentTaskRef: AgentTaskRefV1Schema,
  validationArtifactRef: ContentArtifactRefV1Schema.optional(),
});
export type ScoringRuleSourceBindingV1 = z.infer<typeof ScoringRuleSourceBindingV1Schema>;

export const StructuredScoringRuleMemberV1Schema = z.strictObject({
  rule: StructuredScoringRuleSchema,
  binding: ScoringRuleSourceBindingV1Schema,
});
export type StructuredScoringRuleMemberV1 = z.infer<typeof StructuredScoringRuleMemberV1Schema>;

const sortedRuleMembers = z
  .array(StructuredScoringRuleMemberV1Schema)
  .min(1)
  .max(SCORING_RULES_MAX_RULES_V1)
  .superRefine((members, context) => {
    const ids = new Set<string>();
    for (const [index, member] of members.entries()) {
      if (ids.has(member.rule.ruleId)) {
        context.addIssue({
          code: "custom",
          path: [index, "rule", "ruleId"],
          message: "rule id must be unique",
        });
        return;
      }
      ids.add(member.rule.ruleId);
    }
    const keys = members.map((member) => member.rule.ruleId);
    for (let index = 1; index < keys.length; index += 1) {
      if (keys[index - 1]! >= keys[index]!) {
        context.addIssue({ code: "custom", path: [index], message: "rules must be sorted" });
        return;
      }
    }
  });

/** `structured-scoring-rule` 内容工件：正文 SSOT，按 ruleId 规范排序。 */
export const StructuredScoringRuleDocumentV1Schema = z.strictObject({
  schemaVersion: z.literal(SCORING_RULES_SCHEMA_VERSION_V1),
  projectRevisionRef: ProjectRevisionRefV1Schema,
  configurationSetRef: VersionReferenceSchema,
  compatibilityRef: VersionReferenceSchema,
  scoringPolicyRef: VersionReferenceSchema,
  cleaningResultArtifactRef: ContentArtifactRefV1Schema,
  agentTaskRef: AgentTaskRefV1Schema,
  members: sortedRuleMembers,
});
export type StructuredScoringRuleDocumentV1 = z.infer<typeof StructuredScoringRuleDocumentV1Schema>;

export const ApplicableRuleSetDecisionV1Schema = z.strictObject({
  ruleId: IdentifierSchema,
  ruleVersion: VersionReferenceSchema,
  decision: ScoringRuleDecisionKindV1Schema,
  reasonCode: z.union([ScoringRuleAcceptanceReasonV1Schema, ScoringRuleExclusionReasonV1Schema]),
  matchedDimensions: z.array(ApplicabilityMetadataDimensionSchema).max(3),
  ruleReleaseRef: KnowledgeReleaseRefV1Schema.optional(),
  ruleRevisionRef: KnowledgeRevisionRefV1Schema.optional(),
  artifactRef: ContentArtifactRefV1Schema.optional(),
  relationRefs: z.array(ScoringRuleRelationRefV1Schema).max(16),
});
export type ApplicableRuleSetDecisionV1 = z.infer<typeof ApplicableRuleSetDecisionV1Schema>;

const includedMembers = z
  .array(ApplicableRuleSetIncludedMemberV1Schema)
  .min(1)
  .max(SCORING_RULES_MAX_RULES_V1)
  .superRefine((members, context) => {
    const keys = members.map(
      (member) =>
        `${member.releaseRef.reference.entityId}@${member.releaseRef.reference.versionId}`,
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "rule releases must be unique" });
      return;
    }
    for (let index = 1; index < keys.length; index += 1) {
      if (keys[index - 1]! >= keys[index]!) {
        context.addIssue({ code: "custom", path: [index], message: "members must be sorted" });
        return;
      }
    }
  });

const ruleDecisions = z
  .array(ApplicableRuleSetDecisionV1Schema)
  .min(1)
  .max(SCORING_RULES_MAX_RULES_V1)
  .superRefine((decisions, context) => {
    const keys = decisions.map((decision) => decision.ruleId);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "each candidate requires exactly one decision" });
      return;
    }
    for (let index = 1; index < keys.length; index += 1) {
      if (keys[index - 1]! >= keys[index]!) {
        context.addIssue({ code: "custom", path: [index], message: "decisions must be sorted" });
        return;
      }
    }
  });

/** `applicable-rule-set` 内容工件：筛选决定是正文 SSOT。 */
export const ApplicableRuleSetDocumentV1Schema = z.strictObject({
  schemaVersion: z.literal(SCORING_RULES_SCHEMA_VERSION_V1),
  projectRevisionRef: ProjectRevisionRefV1Schema,
  applicabilitySnapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
  applicability: ApplicabilityMetadataSchema,
  configurationSetRef: VersionReferenceSchema,
  compatibilityRef: VersionReferenceSchema,
  assemblyPolicyRef: VersionReferenceSchema,
  requiredAt: IsoDateTimeSchema,
  includedMembers,
  decisions: ruleDecisions,
});
export type ApplicableRuleSetDocumentV1 = z.infer<typeof ApplicableRuleSetDocumentV1Schema>;

export const ScoringRuleToolPolicyV1Schema = z
  .strictObject({
    standardSegmentToolRef: VersionReferenceSchema,
    indicatorCatalogToolRef: VersionReferenceSchema,
    maxSegmentsPerRead: positiveInteger,
    maxIndicatorsPerRead: positiveInteger,
  })
  .superRefine((policy, context) => {
    if (
      policy.standardSegmentToolRef.entityId === policy.indicatorCatalogToolRef.entityId &&
      policy.standardSegmentToolRef.versionId === policy.indicatorCatalogToolRef.versionId
    ) {
      context.addIssue({
        code: "custom",
        path: ["indicatorCatalogToolRef"],
        message: "the two domain tools must be distinct",
      });
    }
  });
export type ScoringRuleToolPolicyV1 = z.infer<typeof ScoringRuleToolPolicyV1Schema>;

export const ScoringRuleAgentPolicyV1Schema = z
  .strictObject({
    definitionRef: VersionReferenceSchema,
    modelDeploymentRef: VersionReferenceSchema,
    promptTemplateRef: VersionReferenceSchema,
    toolPolicyRef: VersionReferenceSchema,
    budgetPolicyRef: VersionReferenceSchema,
    incrementSchemaRef: VersionReferenceSchema,
    validationPolicyRef: VersionReferenceSchema,
    budgetPolicy: AgentTaskBudgetPolicyV1Schema,
  })
  .superRefine((policy, context) => {
    const pairs = [
      ["modelDeploymentRef", policy.modelDeploymentRef, policy.budgetPolicy.modelDeploymentRef],
      ["promptTemplateRef", policy.promptTemplateRef, policy.budgetPolicy.promptTemplateRef],
      ["toolPolicyRef", policy.toolPolicyRef, policy.budgetPolicy.toolPolicyRef],
      ["budgetPolicyRef", policy.budgetPolicyRef, policy.budgetPolicy.policyRef],
    ] as const;
    for (const [field, value, expected] of pairs) {
      if (value.entityId !== expected.entityId || value.versionId !== expected.versionId) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} must match the frozen budget policy`,
        });
      }
    }
  });
export type ScoringRuleAgentPolicyV1 = z.infer<typeof ScoringRuleAgentPolicyV1Schema>;

/** 版本化 C19 编制策略：组合根注入并冻结，命令必须精确引用同一版本。 */
export const ScoringRulesPolicyV1Schema = z
  .strictObject({
    schemaVersion: z.literal(SCORING_RULES_SCHEMA_VERSION_V1),
    policyRef: VersionReferenceSchema,
    compatibilityRef: VersionReferenceSchema,
    assemblyPolicyRef: VersionReferenceSchema,
    conflictPriorityPolicyRef: VersionReferenceSchema,
    allowedSourceStandardKinds: z.array(IdentifierSchema).min(1).max(16),
    tools: ScoringRuleToolPolicyV1Schema,
    agent: ScoringRuleAgentPolicyV1Schema,
  })
  .superRefine((policy, context) => {
    if (
      new Set(policy.allowedSourceStandardKinds).size !== policy.allowedSourceStandardKinds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["allowedSourceStandardKinds"],
        message: "source standard kinds must be unique",
      });
    }
  });
export type ScoringRulesPolicyV1 = z.infer<typeof ScoringRulesPolicyV1Schema>;

export const ScoringRuleAuthoringManifestV1Schema = z.strictObject({
  schemaVersion: z.literal(SCORING_RULES_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  actorId: IdentifierSchema,
  projectRevisionRef: ProjectRevisionRefV1Schema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  cleaningResultArtifactRef: ContentArtifactRefV1Schema,
  cleaningResultDigest: hashSchema,
  dataCleaningTaskRef: AgentTaskRefV1Schema,
  compatibilityRef: VersionReferenceSchema,
  retainedSourceSegments: z
    .array(
      z.strictObject({
        sourceVersionRef: SourceVersionRefV1Schema,
        sourceSegmentIds: z
          .array(IdentifierSchema)
          .min(1)
          .max(SCORING_RULES_MAX_SOURCE_SEGMENTS_V1),
      }),
    )
    .min(1),
  sourceStandardKinds: z.array(IdentifierSchema).min(1).max(16),
  configurationSetRef: VersionReferenceSchema,
  indicatorSystemMember: z.strictObject({
    releaseRef: KnowledgeReleaseRefV1Schema,
    revisionRef: KnowledgeRevisionRefV1Schema,
    artifactRef: ContentArtifactRefV1Schema,
    contentDigest: hashSchema,
  }),
  baseRuleReleaseRef: KnowledgeReleaseRefV1Schema.optional(),
  scoringPolicyRef: VersionReferenceSchema,
  taskPolicy: z.strictObject({
    modelDeploymentRef: VersionReferenceSchema,
    promptTemplateRef: VersionReferenceSchema,
    toolPolicyRef: VersionReferenceSchema,
    budgetPolicyRef: VersionReferenceSchema,
    incrementSchemaRef: VersionReferenceSchema,
    validationPolicyRef: VersionReferenceSchema,
  }),
});
export type ScoringRuleAuthoringManifestV1 = z.infer<typeof ScoringRuleAuthoringManifestV1Schema>;

const ruleOperationBase = {
  ruleId: IdentifierSchema,
  rule: StructuredScoringRuleSchema,
  sourceVersionRef: SourceVersionRefV1Schema,
  evidenceReferences: z
    .array(EvidenceReferenceSchema)
    .min(1)
    .max(SCORING_RULES_MAX_EVIDENCE_REFERENCES_V1),
};

export const ScoringRuleAddOperationV1Schema = z.strictObject({
  kind: z.literal("add-rule"),
  ...ruleOperationBase,
});
export type ScoringRuleAddOperationV1 = z.infer<typeof ScoringRuleAddOperationV1Schema>;

export const ScoringRuleReplaceOperationV1Schema = z.strictObject({
  kind: z.literal("replace-rule"),
  baseRuleVersion: VersionReferenceSchema,
  ...ruleOperationBase,
});
export type ScoringRuleReplaceOperationV1 = z.infer<typeof ScoringRuleReplaceOperationV1Schema>;

/** Agent 只允许规则级 add/replace，没有 Patch、删除、整文档覆盖或发布字段。 */
export const ScoringRuleOperationV1Schema = z.discriminatedUnion("kind", [
  ScoringRuleAddOperationV1Schema,
  ScoringRuleReplaceOperationV1Schema,
]);
export type ScoringRuleOperationV1 = z.infer<typeof ScoringRuleOperationV1Schema>;

export const ScoringRuleAuthoringCandidateV1Schema = z.strictObject({
  schemaVersion: z.literal(SCORING_RULES_SCHEMA_VERSION_V1),
  candidateVersion: positiveInteger,
  operations: z.array(ScoringRuleOperationV1Schema).min(1).max(SCORING_RULES_MAX_OPERATIONS_V1),
});
export type ScoringRuleAuthoringCandidateV1 = z.infer<typeof ScoringRuleAuthoringCandidateV1Schema>;

export const ScoringRuleAuthoringIncrementV1Schema = ScoringRuleAuthoringCandidateV1Schema;
export type ScoringRuleAuthoringIncrementV1 = ScoringRuleAuthoringCandidateV1;

export const ScoringRuleStandardSegmentSliceRequestV1Schema = z.strictObject({
  kind: z.literal("read-standard-segment-slice"),
  sourceVersionRef: SourceVersionRefV1Schema,
  sourceSegmentIds: z.array(IdentifierSchema).min(1),
});
export type ScoringRuleStandardSegmentSliceRequestV1 = z.infer<
  typeof ScoringRuleStandardSegmentSliceRequestV1Schema
>;

export const ScoringRuleIndicatorCatalogSliceRequestV1Schema = z.strictObject({
  kind: z.literal("read-indicator-catalog-slice"),
  indicatorIds: z.array(IdentifierSchema).min(1),
});
export type ScoringRuleIndicatorCatalogSliceRequestV1 = z.infer<
  typeof ScoringRuleIndicatorCatalogSliceRequestV1Schema
>;

export const ScoringRuleCandidateSubmissionV1Schema = z.strictObject({
  kind: z.literal("submit-scoring-rule-candidate"),
  candidate: ScoringRuleAuthoringCandidateV1Schema,
});
export type ScoringRuleCandidateSubmissionV1 = z.infer<
  typeof ScoringRuleCandidateSubmissionV1Schema
>;

export const ScoringRuleActionV1Schema = z.discriminatedUnion("kind", [
  ScoringRuleStandardSegmentSliceRequestV1Schema,
  ScoringRuleIndicatorCatalogSliceRequestV1Schema,
  ScoringRuleCandidateSubmissionV1Schema,
]);
export type ScoringRuleActionV1 = z.infer<typeof ScoringRuleActionV1Schema>;

export const ScoringRuleValidationItemV1Schema = z.strictObject({
  checkId: IdentifierSchema,
  disposition: ScoringRuleDispositionV1Schema,
  rejectionClass: ScoringRuleRejectionClassV1Schema.optional(),
  reasonCode: ScoringRuleValidationReasonV1Schema,
  evidenceReferences: z
    .array(EvidenceReferenceSchema)
    .max(SCORING_RULES_MAX_EVIDENCE_REFERENCES_V1),
});
export type ScoringRuleValidationItemV1 = z.infer<typeof ScoringRuleValidationItemV1Schema>;

export const ScoringRuleValidationViewV1Schema = z.strictObject({
  disposition: ScoringRuleDispositionV1Schema,
  rejectionClass: ScoringRuleRejectionClassV1Schema.optional(),
  items: z.array(ScoringRuleValidationItemV1Schema).min(1),
});
export type ScoringRuleValidationViewV1 = z.infer<typeof ScoringRuleValidationViewV1Schema>;

const requiredPrepareCapability =
  MODULE_BRANCH_CAPABILITY_V1["knowledge-modeling.assessment-basis"];

export const PrepareScoringRuleAuthoringV1Schema = z
  .strictObject({
    requestId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
    projectId: IdentifierSchema,
    actorId: IdentifierSchema,
    requestedAt: IsoDateTimeSchema,
    authorization: AuthorizationContextV1Schema,
    /** C15 结果读取的 `engineering-data.evidence-access` 精确上下文（单 capability）。 */
    dataCleaningAuthorization: AuthorizationContextV1Schema,
    projectRevisionRef: ProjectRevisionRefV1Schema,
    dataCleaningTaskRef: AgentTaskRefV1Schema,
    requiredAt: IsoDateTimeSchema,
    asOfRecordedAt: IsoDateTimeSchema,
    scoringPolicyRef: VersionReferenceSchema,
    sourceStandardKinds: z.array(IdentifierSchema).min(1).max(16),
    baseRuleReleaseRef: KnowledgeReleaseRefV1Schema.optional(),
  })
  .superRefine((request, context) => {
    if (request.projectId !== request.authorization.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "request project does not match the authorization context",
      });
    }
    if (request.actorId !== request.authorization.actorId) {
      context.addIssue({
        code: "custom",
        path: ["actorId"],
        message: "request actor does not match the authorization context",
      });
    }
    if (!request.authorization.grantedCapabilities.includes(requiredPrepareCapability)) {
      context.addIssue({
        code: "custom",
        path: ["authorization", "grantedCapabilities"],
        message: "the assessment read capability is required",
      });
    }
    if (
      request.dataCleaningAuthorization.projectId !== request.projectId ||
      request.dataCleaningAuthorization.actorId !== request.actorId ||
      !request.dataCleaningAuthorization.grantedCapabilities.includes("engineering-data.read")
    ) {
      context.addIssue({
        code: "custom",
        path: ["dataCleaningAuthorization"],
        message: "the frozen C15 evidence-access authorization is required",
      });
    }
  });
export type PrepareScoringRuleAuthoringV1 = z.infer<typeof PrepareScoringRuleAuthoringV1Schema>;

export const PrepareScoringRuleAuthoringResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("succeeded"),
    agentTaskRef: AgentTaskRefV1Schema,
    manifestArtifactRef: ContentArtifactRefV1Schema,
    manifestDigest: hashSchema,
    replayed: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("failed"), error: ModuleErrorV1Schema }),
]);
export type PrepareScoringRuleAuthoringResultV1 = z.infer<
  typeof PrepareScoringRuleAuthoringResultV1Schema
>;

export const AssembleApplicableRuleSetV1Schema = z
  .strictObject({
    requestId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
    projectId: IdentifierSchema,
    actorId: IdentifierSchema,
    requestedAt: IsoDateTimeSchema,
    authorization: AuthorizationContextV1Schema,
    projectRevisionRef: ProjectRevisionRefV1Schema,
    preparationSnapshotRef: AssessmentPreparationSnapshotRefV1Schema,
    applicabilitySnapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
    applicability: ApplicabilityMetadataSchema,
    requiredAt: IsoDateTimeSchema,
    asOfRecordedAt: IsoDateTimeSchema,
    scoringPolicyRef: VersionReferenceSchema,
    assemblyPolicyRef: VersionReferenceSchema,
    compatibilityRef: VersionReferenceSchema,
    configurationSetRef: VersionReferenceSchema,
  })
  .superRefine((request, context) => {
    if (request.projectId !== request.authorization.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "request project does not match the authorization context",
      });
    }
    if (request.actorId !== request.authorization.actorId) {
      context.addIssue({
        code: "custom",
        path: ["actorId"],
        message: "request actor does not match the authorization context",
      });
    }
    if (!request.authorization.grantedCapabilities.includes(requiredPrepareCapability)) {
      context.addIssue({
        code: "custom",
        path: ["authorization", "grantedCapabilities"],
        message: "the assessment read capability is required",
      });
    }
  });
export type AssembleApplicableRuleSetV1 = z.infer<typeof AssembleApplicableRuleSetV1Schema>;

export const AssembleApplicableRuleSetResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("succeeded"),
    applicableRuleSetRevisionRef: KnowledgeRevisionRefV1Schema,
    applicableRuleSetArtifactRef: ContentArtifactRefV1Schema,
  }),
  z.strictObject({ kind: z.literal("waiting"), waiting: WaitingRefV1Schema }),
  z.strictObject({ kind: z.literal("failed"), error: ModuleErrorV1Schema }),
]);
export type AssembleApplicableRuleSetResultV1 = z.infer<
  typeof AssembleApplicableRuleSetResultV1Schema
>;

/* --- assessment basis release set members (D-14) --------------------------- */

export const AssessmentBasisReleaseSetMemberV1Schema = z.strictObject({
  ...applicableRuleSetMemberBase,
});
export type AssessmentBasisReleaseSetMemberV1 = z.infer<
  typeof AssessmentBasisReleaseSetMemberV1Schema
>;

const scoringRuleMembers = z
  .array(AssessmentBasisReleaseSetMemberV1Schema)
  .min(1)
  .max(SCORING_RULES_MAX_RULES_V1)
  .superRefine((members, context) => {
    const keys = members.map(
      (member) =>
        `${member.releaseRef.reference.entityId}@${member.releaseRef.reference.versionId}`,
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "rule release identities must be unique" });
      return;
    }
    for (let index = 1; index < keys.length; index += 1) {
      if (keys[index - 1]! >= keys[index]!) {
        context.addIssue({ code: "custom", path: [index], message: "members must be sorted" });
        return;
      }
    }
  });

export const AssessmentBasisConfigurationMemberV1Schema = z.strictObject({
  definitionType: AssessmentConfigurationDefinitionTypeV1Schema,
  ...applicableRuleSetMemberBase,
});
export type AssessmentBasisConfigurationMemberV1 = z.infer<
  typeof AssessmentBasisConfigurationMemberV1Schema
>;

const configurationMembers = z
  .array(AssessmentBasisConfigurationMemberV1Schema)
  .min(ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1.length)
  .max(ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1.length)
  .superRefine((members, context) => {
    const keys = members.map((member) => member.definitionType);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "configuration types must be unique" });
      return;
    }
    const canonical = [...ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1].sort();
    if (
      members.length !== canonical.length ||
      members.some((member, index) => member.definitionType !== canonical[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "the eleven configuration types must be covered in canonical order",
      });
    }
  });

export const AssessmentBasisReleaseSetMembersV1Schema = z.strictObject({
  applicableRuleSetMember: AssessmentBasisReleaseSetMemberV1Schema,
  scoringRuleMembers,
  configurationMembers,
});
export type AssessmentBasisReleaseSetMembersV1 = z.infer<
  typeof AssessmentBasisReleaseSetMembersV1Schema
>;

export const AssessmentBasisReleaseSetV1Schema = z.strictObject({
  schemaVersion: z.literal(ASSESSMENT_BASIS_RELEASE_SET_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  assessmentBasisReleaseSetRef: z.strictObject({
    kind: z.literal(ASSESSMENT_BASIS_RELEASE_SET_REF_KIND_V1),
    reference: VersionReferenceSchema,
  }),
  preparationSnapshotRef: AssessmentPreparationSnapshotRefV1Schema,
  applicabilitySnapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
  applicableRuleSetReleaseRef: KnowledgeReleaseRefV1Schema,
  configurationSetRef: VersionReferenceSchema,
  requiredAt: IsoDateTimeSchema,
  issuedAt: IsoDateTimeSchema,
  memberDigest: hashSchema,
  members: AssessmentBasisReleaseSetMembersV1Schema,
  recordedAt: IsoDateTimeSchema,
});
export type AssessmentBasisReleaseSetV1 = z.infer<typeof AssessmentBasisReleaseSetV1Schema>;

const requiredReadCapability = MODULE_BRANCH_CAPABILITY_V1["knowledge-modeling.assessment-basis"];

/** 精确集合引用；不接受名称、列表或 latest 选择器。 */
const assessmentBasisReleaseSetRefSchema = z.strictObject({
  kind: z.literal(ASSESSMENT_BASIS_RELEASE_SET_REF_KIND_V1),
  reference: VersionReferenceSchema,
});

/**
 * 成员读取请求：工程与 actor 只来自 C06 当前验证结果，调用方不得另传。
 */
export const ReadAssessmentBasisReleaseSetV1Schema = z
  .strictObject({
    requestId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
    requestedAt: IsoDateTimeSchema,
    authorization: AuthorizationContextV1Schema,
    assessmentBasisReleaseSetRef: assessmentBasisReleaseSetRefSchema,
  })
  .superRefine((request, context) => {
    if (!request.authorization.grantedCapabilities.includes(requiredReadCapability)) {
      context.addIssue({
        code: "custom",
        path: ["authorization", "grantedCapabilities"],
        message: "the assessment read capability is required",
      });
    }
  });
export type ReadAssessmentBasisReleaseSetV1 = z.infer<typeof ReadAssessmentBasisReleaseSetV1Schema>;

/**
 * 顶层 strict 判别结果：成功直接给出三个成员投影，不包装内部集合；
 * 授权有效但目标不可用统一为不可枚举的 `unavailable`，技术失败走独立 `failed`。
 */
export const AssessmentBasisReleaseSetReadResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("succeeded"),
    schemaVersion: z.literal(ASSESSMENT_BASIS_RELEASE_SET_SCHEMA_VERSION_V1),
    assessmentBasisReleaseSetRef: assessmentBasisReleaseSetRefSchema,
    memberDigest: hashSchema,
    applicableRuleSetMember: AssessmentBasisReleaseSetMemberV1Schema,
    scoringRuleMembers,
    configurationMembers,
  }),
  z.strictObject({ kind: z.literal("unavailable"), error: ModuleErrorV1Schema }),
  z.strictObject({ kind: z.literal("failed"), error: ModuleErrorV1Schema }),
]);
export type AssessmentBasisReleaseSetReadResultV1 = z.infer<
  typeof AssessmentBasisReleaseSetReadResultV1Schema
>;

/** 耐久关系身份：闭合关系语义再绑定工程与唯一候选修订 owner。 */
export const buildScoringRuleRelationIdentity = (input: {
  readonly projectId: string;
  readonly candidateRevisionRef: KnowledgeRevisionRefV1;
  readonly relationKind: ScoringRuleRelationKindV1;
  readonly policyRef: VersionReference;
  readonly leftRuleId: string;
  readonly leftRuleVersion: VersionReference;
  readonly rightRuleId: string;
  readonly rightRuleVersion: VersionReference;
  readonly overlapDigest: string;
  readonly retainedRuleVersionRef: VersionReference;
  readonly excludedRuleVersionRef: VersionReference;
}): string =>
  sha256CanonicalJson({
    projectId: input.projectId,
    candidateRevisionRef: input.candidateRevisionRef,
    relationKind: input.relationKind,
    policyRef: input.policyRef,
    leftRuleIdentity: [input.leftRuleId, input.leftRuleVersion],
    rightRuleIdentity: [input.rightRuleId, input.rightRuleVersion],
    overlapDigest: input.overlapDigest,
    retainedRuleVersionRef: input.retainedRuleVersionRef,
    excludedRuleVersionRef: input.excludedRuleVersionRef,
  });
