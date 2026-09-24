import { z } from "zod";

import {
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
  type VersionReference,
} from "@riskflow/contracts/common";
import { ModelOutputResultSchema } from "@riskflow/contracts/records";
import {
  AcceptanceRouteSetRefV1Schema,
  AuthorizationContextRefV1Schema,
  ContentArtifactRefV1Schema,
  DiagnosticArtifactRefV1Schema,
  EvidenceSnapshotRefV1Schema,
  IdentificationCandidateSetRefV1Schema,
  IdentificationGroupRefV1Schema,
  IdentificationInputSnapshotRefV1Schema,
  IdentificationPolicySetRefV1Schema,
  IdentificationWorkItemRefV1Schema,
  IdentificationWorkPlanRefV1Schema,
  IdentificationZeroResultRefV1Schema,
  MergePlanRefV1Schema,
  ModelContextArtifactSetRefV1Schema,
  RetrievalArtifactSetRefV1Schema,
  ReviewTaskRefV1Schema,
  RouteDecisionRefV1Schema,
  SourceVersionRefV1Schema,
  ValidatedCandidateSetRefV1Schema,
  ValidationSnapshotRefV1Schema,
  WorkflowRunRefV1Schema,
  type IdentificationInputSnapshotRefV1,
  type IdentificationPolicySetRefV1,
  type IdentificationWorkItemRefV1,
  type ModelContextArtifactSetRefV1,
  type RetrievalArtifactSetRefV1,
} from "@riskflow/contracts/ports";

import { sha256CanonicalJson } from "../../persistence/index.js";

export const RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1 = "1" as const;

/** 候选、合并、验收集合的硬上限；策略只能在其内收窄。 */
export const MAX_RISK_CANDIDATES_V1 = 64;
export const MAX_GROUP_MEMBERS_V1 = 64;
export const MAX_REPAIR_ROUNDS_V1 = 8;
export const MAX_VALIDATED_CANDIDATE_SETS_V1 = 512;

/** D-09 一张追加式登记表承载的中间结果种类。 */
export const RISK_CANDIDATE_FINALIZATION_RESULT_KINDS_V1 = [
  "candidate-set",
  "zero-result",
  "validated-candidate-set",
  "identification-group",
  "merge-plan",
  "validation-snapshot",
  "evidence-snapshot",
  "route-decision",
  "acceptance-route-set",
] as const;
export const RiskCandidateFinalizationResultKindV1Schema = z.enum(
  RISK_CANDIDATE_FINALIZATION_RESULT_KINDS_V1,
);
export type RiskCandidateFinalizationResultKindV1 = z.infer<
  typeof RiskCandidateFinalizationResultKindV1Schema
>;

/** 确定性校验的稳定检查身份；报告与测试只断言这些标识。 */
export const CANDIDATE_VALIDATION_CHECK_IDS_V1 = Object.freeze({
  schema: "candidate.output-schema",
  nodeBinding: "candidate.process-node-binding",
  riskEvent: "candidate.risk-event-expression",
  relationEndpoints: "candidate.relation-endpoints",
  evidenceReachability: "candidate.evidence-reachability",
  mechanismApplicability: "candidate.mechanism-applicability",
  ruleConsistency: "candidate.rule-consistency",
  simulationConstraint: "candidate.simulation-constraint",
});
export type CandidateValidationCheckIdV1 =
  (typeof CANDIDATE_VALIDATION_CHECK_IDS_V1)[keyof typeof CANDIDATE_VALIDATION_CHECK_IDS_V1];

/** 稳定原因码；权限、来源资格、版本兼容、规则冲突与仿真失败不进入修正循环。 */
export const CANDIDATE_VALIDATION_REASON_CODES_V1 = Object.freeze({
  accepted: "accepted",
  schemaInvalid: "candidate-schema-invalid",
  nodeMismatch: "candidate-node-mismatch",
  relationEndpointMissing: "candidate-relation-endpoint-missing",
  evidenceNotFrozen: "candidate-evidence-not-frozen",
  mechanismNotApplicable: "candidate-mechanism-not-applicable",
  ruleConflict: "candidate-rule-conflict",
  simulationViolation: "candidate-simulation-violation",
  authorizationRevoked: "authorization-revoked",
  sourceVersionIncompatible: "source-version-incompatible",
  budgetExhausted: "generation-budget-exhausted",
});
export type CandidateValidationReasonCodeV1 =
  (typeof CANDIDATE_VALIDATION_REASON_CODES_V1)[keyof typeof CANDIDATE_VALIDATION_REASON_CODES_V1];

/**
 * 设计 D-05 允许修正的原因码封闭集合。策略的 `repairableReasonCodes` 只能是它的子集，
 * 因此权限、来源资格、版本兼容、规则冲突与仿真失败永远不会被策略打开为可修正。
 */
export const CANDIDATE_REPAIRABLE_REASON_CODES_V1 = Object.freeze([
  CANDIDATE_VALIDATION_REASON_CODES_V1.schemaInvalid,
  CANDIDATE_VALIDATION_REASON_CODES_V1.nodeMismatch,
  CANDIDATE_VALIDATION_REASON_CODES_V1.relationEndpointMissing,
  CANDIDATE_VALIDATION_REASON_CODES_V1.evidenceNotFrozen,
  CANDIDATE_VALIDATION_REASON_CODES_V1.mechanismNotApplicable,
]);

export const CANDIDATE_TERMINAL_REASON_CODES_V1 = Object.freeze([
  CANDIDATE_VALIDATION_REASON_CODES_V1.authorizationRevoked,
  CANDIDATE_VALIDATION_REASON_CODES_V1.sourceVersionIncompatible,
  CANDIDATE_VALIDATION_REASON_CODES_V1.ruleConflict,
  CANDIDATE_VALIDATION_REASON_CODES_V1.simulationViolation,
  CANDIDATE_VALIDATION_REASON_CODES_V1.budgetExhausted,
]);

/** 合并组的显式跳过原因；`null` 表示该组确有重复。 */
export const MERGE_SKIP_REASON_CODE_V1 = "no-duplicate" as const;

/** 路由计分依据来源；检索 RRF 排序分数不在其中。 */
export const CONFIDENCE_BASIS_SOURCES_V1 = [
  "model-confidence",
  "rule-consistency",
  "simulation-constraint",
  "multi-source-merge",
] as const;
export const ConfidenceBasisSourceV1Schema = z.enum(CONFIDENCE_BASIS_SOURCES_V1);
export type ConfidenceBasisSourceV1 = z.infer<typeof ConfidenceBasisSourceV1Schema>;

export const FORCED_REVIEW_REASON_CODES_V1 = Object.freeze({
  lowConfidence: "below-confidence-threshold",
  mergeAmbiguity: "merge-ambiguity",
  policyFlag: "forced-review-policy-flag",
});
export type ForcedReviewReasonCodeV1 =
  (typeof FORCED_REVIEW_REASON_CODES_V1)[keyof typeof FORCED_REVIEW_REASON_CODES_V1];

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();
const unitInterval = z.number().finite().min(0).max(1);
const uniqueIdentifiers = z
  .array(IdentifierSchema)
  .min(1)
  .refine((values) => new Set(values).size === values.length);

// --------------------------------------------------------------- 生成策略与预算

/** 生成/修正的硬预算；模型调用次数、输出字节、token 与墙钟都在此封闭。 */
export const RiskCandidateGenerationBudgetV1Schema = z.strictObject({
  maxCandidates: positiveInt.max(MAX_RISK_CANDIDATES_V1),
  maxOutputBytes: positiveInt,
  maxTotalTokens: positiveInt,
  maxWallClockMs: positiveInt,
  maxRepairRounds: nonNegativeInt.max(MAX_REPAIR_ROUNDS_V1),
});
export type RiskCandidateGenerationBudgetV1 = z.infer<typeof RiskCandidateGenerationBudgetV1Schema>;

export const RiskCandidateGenerationPolicyV1Schema = z.strictObject({
  schemaVersion: z.literal(RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1),
  policyRef: VersionReferenceSchema,
  policySetRef: IdentificationPolicySetRefV1Schema,
  outputSchemaRef: VersionReferenceSchema,
  budgetPolicyRef: VersionReferenceSchema,
  budget: RiskCandidateGenerationBudgetV1Schema,
});
export type RiskCandidateGenerationPolicyV1 = z.infer<typeof RiskCandidateGenerationPolicyV1Schema>;

/** 校验与修正策略：可修正原因码只能是设计 D-05 封闭集合的子集。 */
export const RiskCandidateValidationPolicyV1Schema = z
  .strictObject({
    schemaVersion: z.literal(RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1),
    policyRef: VersionReferenceSchema,
    policySetRef: IdentificationPolicySetRefV1Schema,
    ruleValidationPolicyRef: VersionReferenceSchema,
    /** 可选仿真/试验约束：声明时必须能由候选可达证据满足，否则该候选终止。 */
    simulationConstraint: z
      .strictObject({
        policyRef: VersionReferenceSchema,
        requiredSourceVersionRefs: z.array(SourceVersionRefV1Schema).min(1),
      })
      .optional(),
    /** 机理条目适用性：允许的机理类型集合（空集表示不限）。 */
    allowedMechanismTypes: z.array(IdentifierSchema),
    /** 规则一致性要求候选来源必须派生的机理类型集合（空集表示不限）。 */
    requiredMechanismTypes: z.array(IdentifierSchema),
    /** 风险要素关系必须覆盖的关系类型集合（空集表示不限）。 */
    requiredRelationTypes: z.array(IdentifierSchema),
    repairableReasonCodes: z.array(IdentifierSchema).min(1),
  })
  .superRefine((policy, context) => {
    const allowed = new Set<string>(CANDIDATE_REPAIRABLE_REASON_CODES_V1);
    for (const code of policy.repairableReasonCodes) {
      if (!allowed.has(code)) {
        context.addIssue({
          code: "custom",
          path: ["repairableReasonCodes"],
          message: "repairable reason code is not in the closed repairable set",
        });
      }
    }
    if (new Set(policy.repairableReasonCodes).size !== policy.repairableReasonCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["repairableReasonCodes"],
        message: "repairable reason codes must be unique",
      });
    }
  });
export type RiskCandidateValidationPolicyV1 = z.infer<typeof RiskCandidateValidationPolicyV1Schema>;

// ------------------------------------------------------- 候选与候选集（RI-S57～S58）

/** RI-S57 结构化输出形状：有上限的候选结果集合；合法零候选是正式终态，不是失败。 */
export const RiskCandidateModelOutputV1Schema = z.strictObject({
  candidates: z.array(ModelOutputResultSchema).max(MAX_RISK_CANDIDATES_V1),
});
export type RiskCandidateModelOutputV1 = z.infer<typeof RiskCandidateModelOutputV1Schema>;

export const RiskCandidateV1Schema = z.strictObject({
  candidateId: IdentifierSchema,
  candidateVersion: positiveInt,
  parentCandidateRef: ContentArtifactRefV1Schema.optional(),
  projectId: IdentifierSchema,
  inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
  workItemRef: IdentificationWorkItemRefV1Schema,
  modelContextArtifactSetRef: ModelContextArtifactSetRefV1Schema,
  nodeId: IdentifierSchema,
  /** 六字段模型内容直接嵌入 C01 SSOT，不复制形状。 */
  output: ModelOutputResultSchema,
  modelDeploymentRef: VersionReferenceSchema,
  promptTemplateRef: VersionReferenceSchema,
  outputSchemaRef: VersionReferenceSchema,
  budgetPolicyRef: VersionReferenceSchema,
  rawResponseRef: DiagnosticArtifactRefV1Schema,
  invocationId: IdentifierSchema,
  generatedAt: IsoDateTimeSchema,
});
export type RiskCandidateV1 = z.infer<typeof RiskCandidateV1Schema>;

export const CandidateBudgetUsageV1Schema = z.strictObject({
  modelInvocations: nonNegativeInt,
  inputTokens: nonNegativeInt,
  outputTokens: nonNegativeInt,
  totalTokens: nonNegativeInt,
  outputBytes: nonNegativeInt,
  elapsedMs: nonNegativeInt,
  repairRounds: nonNegativeInt,
});
export type CandidateBudgetUsageV1 = z.infer<typeof CandidateBudgetUsageV1Schema>;

/**
 * 正式零结果正文（design D-03）：只表示本次冻结推理未产生候选，不推断工程无风险，
 * 不生成候选集、合并组或风险记录。身份、冻结输入、原始响应与资源证据在此固定。
 */
export const RiskCandidateZeroResultV1Schema = z.strictObject({
  schemaVersion: z.literal(RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1),
  outcome: z.literal("zero-candidates"),
  candidateCount: z.literal(0),
  projectId: IdentifierSchema,
  inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
  workItemRef: IdentificationWorkItemRefV1Schema,
  nodeId: IdentifierSchema,
  modelContextArtifactSetRef: ModelContextArtifactSetRefV1Schema,
  retrievalArtifactSetRef: RetrievalArtifactSetRefV1Schema,
  modelContextPayloadDigest: digestSchema,
  policySetRef: IdentificationPolicySetRefV1Schema,
  generationPolicyRef: VersionReferenceSchema,
  modelDeploymentRef: VersionReferenceSchema,
  promptTemplateRef: VersionReferenceSchema,
  outputSchemaRef: VersionReferenceSchema,
  budgetPolicyRef: VersionReferenceSchema,
  rawResponseRef: DiagnosticArtifactRefV1Schema,
  invocationId: IdentifierSchema,
  usage: CandidateBudgetUsageV1Schema,
  authorizationScopeDigest: digestSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  actorRef: IdentifierSchema,
  commandId: IdentifierSchema,
  formedAt: IsoDateTimeSchema,
});
export type RiskCandidateZeroResultV1 = z.infer<typeof RiskCandidateZeroResultV1Schema>;

const candidateKey = (candidate: { candidateId: string; candidateVersion: number }): string =>
  `${candidate.candidateId}\u0000${candidate.candidateVersion}`;

export const RiskCandidateSetV1Schema = z
  .strictObject({
    schemaVersion: z.literal(RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1),
    projectId: IdentifierSchema,
    inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
    workItemRef: IdentificationWorkItemRefV1Schema,
    nodeId: IdentifierSchema,
    modelContextArtifactSetRef: ModelContextArtifactSetRefV1Schema,
    /** C21 冻结检索工件集引用：修正与重读五项上下文必须回到同一份输入。 */
    retrievalArtifactSetRef: RetrievalArtifactSetRefV1Schema,
    /** 五项上下文正文摘要：候选只能来自这一精确上下文。 */
    modelContextPayloadDigest: digestSchema,
    policySetRef: IdentificationPolicySetRefV1Schema,
    generationPolicyRef: VersionReferenceSchema,
    modelDeploymentRef: VersionReferenceSchema,
    promptTemplateRef: VersionReferenceSchema,
    outputSchemaRef: VersionReferenceSchema,
    budgetPolicyRef: VersionReferenceSchema,
    candidateSetVersion: positiveInt,
    parentCandidateSetRef: ContentArtifactRefV1Schema.optional(),
    candidates: z.array(RiskCandidateV1Schema).min(1).max(MAX_RISK_CANDIDATES_V1),
    /** 本版本消耗的全部原始模型响应引用；失败轮次也在此保留。 */
    rawResponseRefs: z.array(DiagnosticArtifactRefV1Schema).min(1),
    usage: CandidateBudgetUsageV1Schema,
    authorizationScopeDigest: digestSchema,
    authorizationContextRef: AuthorizationContextRefV1Schema,
    generatedAt: IsoDateTimeSchema,
  })
  .superRefine((set, context) => {
    const keys = set.candidates.map(candidateKey);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "candidate versions must be unique",
      });
    }
  });
export type RiskCandidateSetV1 = z.infer<typeof RiskCandidateSetV1Schema>;

// ----------------------------------------------------- 确定性校验（RI-S58～S59）

export const CandidateValidationCheckV1Schema = z.strictObject({
  checkId: IdentifierSchema,
  passed: z.boolean(),
  reasonCode: IdentifierSchema,
  evidenceRefs: z.array(EvidenceReferenceSchema),
});
export type CandidateValidationCheckV1 = z.infer<typeof CandidateValidationCheckV1Schema>;

export const CandidateValidationEntryV1Schema = z.strictObject({
  candidateId: IdentifierSchema,
  candidateVersion: positiveInt,
  candidateRef: ContentArtifactRefV1Schema,
  disposition: z.enum(["accepted", "repairable", "terminal"]),
  checks: z.array(CandidateValidationCheckV1Schema).min(1),
});
export type CandidateValidationEntryV1 = z.infer<typeof CandidateValidationEntryV1Schema>;

/** 正式已校验候选集：正文只入 C04，登记行只存引用与确定性结论。 */
export const CandidateValidationSetV1Schema = z
  .strictObject({
    schemaVersion: z.literal(RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1),
    projectId: IdentifierSchema,
    inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
    workItemRef: IdentificationWorkItemRefV1Schema,
    nodeId: IdentifierSchema,
    candidateSetRef: ContentArtifactRefV1Schema,
    candidateSetVersion: positiveInt,
    policySetRef: IdentificationPolicySetRefV1Schema,
    validationPolicyRef: VersionReferenceSchema,
    ruleValidationPolicyRef: VersionReferenceSchema,
    simulationConstraintPolicyRef: VersionReferenceSchema.optional(),
    entries: z.array(CandidateValidationEntryV1Schema).min(1).max(MAX_RISK_CANDIDATES_V1),
    acceptedCandidateRefs: z.array(ContentArtifactRefV1Schema).min(1),
    usage: CandidateBudgetUsageV1Schema,
    authorizationScopeDigest: digestSchema,
    authorizationContextRef: AuthorizationContextRefV1Schema,
    completedAt: IsoDateTimeSchema,
  })
  .superRefine((set, context) => {
    const keys = set.entries.map(candidateKey);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message: "validation entries must be unique per candidate version",
      });
    }
    if (set.entries.some((entry) => entry.disposition !== "accepted")) {
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message: "validated candidate set only contains accepted candidates",
      });
    }
    if (set.acceptedCandidateRefs.length !== set.entries.length) {
      context.addIssue({
        code: "custom",
        path: ["acceptedCandidateRefs"],
        message: "accepted candidate refs must cover every validation entry",
      });
    }
  });
export type CandidateValidationSetV1 = z.infer<typeof CandidateValidationSetV1Schema>;

// ------------------------------------------------- 合并与综合置信度（RI-S61～S62）

export const RiskCandidateMergePolicyV1Schema = z.strictObject({
  schemaVersion: z.literal(RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1),
  policyRef: VersionReferenceSchema,
  policySetRef: IdentificationPolicySetRefV1Schema,
  embeddingDeploymentRef: VersionReferenceSchema,
  embeddingBudgetPolicyRef: VersionReferenceSchema,
  /** 工序一致性只允许同节点，或显式列出的相关节点。 */
  relatedNodeIds: z.array(IdentifierSchema),
  riskEventCosineThreshold: unitInterval,
  evidenceSetSimilarityThreshold: unitInterval,
  weights: z.strictObject({
    processNode: unitInterval,
    riskEvent: unitInterval,
    evidence: unitInterval,
  }),
  groupThreshold: unitInterval,
  maxGroupMembers: positiveInt.max(MAX_GROUP_MEMBERS_V1),
  memberOrder: z.literal("candidate-ref-ascending"),
  tieBreak: z.literal("lexicographically-smallest-candidate-ref"),
});
export type RiskCandidateMergePolicyV1 = z.infer<typeof RiskCandidateMergePolicyV1Schema>;

/** 三信号权重和必须为 1：聚合值是可重放的加权和，不是未归一化的评分。 */
export const assertMergePolicyWeights = (
  policy: RiskCandidateMergePolicyV1,
): RiskCandidateMergePolicyV1 => {
  const { processNode, riskEvent, evidence } = policy.weights;
  if (Math.abs(processNode + riskEvent + evidence - 1) > 1e-6) {
    throw new TypeError("merge policy weights must sum to 1");
  }
  return policy;
};

export const ProcessNodeConsistencyV1Schema = z.strictObject({
  signal: z.literal("process-node"),
  satisfied: z.boolean(),
  nodeIds: uniqueIdentifiers,
  allowedNodeIds: uniqueIdentifiers,
});
export type ProcessNodeConsistencyV1 = z.infer<typeof ProcessNodeConsistencyV1Schema>;

export const SimilaritySignalV1Schema = z.strictObject({
  signal: z.enum(["risk-event", "evidence-locator"]),
  value: unitInterval,
  threshold: unitInterval,
  satisfied: z.boolean(),
});
export type SimilaritySignalV1 = z.infer<typeof SimilaritySignalV1Schema>;

export const GroupMergeEvidenceV1Schema = z.strictObject({
  processNode: ProcessNodeConsistencyV1Schema,
  riskEvent: SimilaritySignalV1Schema,
  evidence: SimilaritySignalV1Schema,
  aggregate: z.strictObject({
    value: unitInterval,
    threshold: unitInterval,
    satisfied: z.boolean(),
  }),
});
export type GroupMergeEvidenceV1 = z.infer<typeof GroupMergeEvidenceV1Schema>;

export const IdentificationGroupMemberV1Schema = z.strictObject({
  candidateId: IdentifierSchema,
  candidateVersion: positiveInt,
  candidateRef: ContentArtifactRefV1Schema,
  nodeId: IdentifierSchema,
  sourceSegmentIds: uniqueIdentifiers,
  mechanismEntryIds: uniqueIdentifiers,
  modelConfidence: unitInterval,
});
export type IdentificationGroupMemberV1 = z.infer<typeof IdentificationGroupMemberV1Schema>;

export const IdentificationGroupV1Schema = z
  .strictObject({
    schemaVersion: z.literal(RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1),
    projectId: IdentifierSchema,
    workPlanRef: IdentificationWorkPlanRefV1Schema,
    inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
    policySetRef: IdentificationPolicySetRefV1Schema,
    groupId: IdentifierSchema,
    groupVersionId: IdentifierSchema,
    nodeIds: uniqueIdentifiers,
    members: z.array(IdentificationGroupMemberV1Schema).min(1).max(MAX_GROUP_MEMBERS_V1),
    mergeEvidence: GroupMergeEvidenceV1Schema,
    disposition: z.enum(["merged", "no-duplicate"]),
    skipReasonCode: IdentifierSchema.optional(),
    mergePolicyRef: VersionReferenceSchema,
    embeddingDeploymentRef: VersionReferenceSchema,
    embeddingArtifactRef: ContentArtifactRefV1Schema,
    authorizationScopeDigest: digestSchema,
    authorizationContextRef: AuthorizationContextRefV1Schema,
    groupedAt: IsoDateTimeSchema,
  })
  .superRefine((group, context) => {
    if (group.disposition === "no-duplicate" && group.skipReasonCode === undefined) {
      context.addIssue({
        code: "custom",
        path: ["skipReasonCode"],
        message: "an explicit skip reason is required when no duplicate was found",
      });
    }
    if (group.disposition === "merged" && group.skipReasonCode !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["skipReasonCode"],
        message: "a merged group must not carry a skip reason",
      });
    }
    if (group.disposition === "merged" && group.members.length < 2) {
      context.addIssue({
        code: "custom",
        path: ["members"],
        message: "a merged group requires at least two members",
      });
    }
    const keys = group.members.map(candidateKey);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["members"],
        message: "group members must be unique per candidate version",
      });
    }
  });
export type IdentificationGroupV1 = z.infer<typeof IdentificationGroupV1Schema>;

export const MergePlanGroupEntryV1Schema = z.strictObject({
  groupId: IdentifierSchema,
  groupVersionId: IdentifierSchema,
  groupRef: IdentificationGroupRefV1Schema,
  disposition: z.enum(["merged", "no-duplicate"]),
  memberCount: positiveInt,
});
export type MergePlanGroupEntryV1 = z.infer<typeof MergePlanGroupEntryV1Schema>;

export const MergePlanV1Schema = z
  .strictObject({
    schemaVersion: z.literal(RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1),
    projectId: IdentifierSchema,
    workPlanRef: IdentificationWorkPlanRefV1Schema,
    identificationRunRef: WorkflowRunRefV1Schema,
    inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
    policySetRef: IdentificationPolicySetRefV1Schema,
    validatedCandidateSetRefs: z
      .array(ValidatedCandidateSetRefV1Schema)
      .min(1)
      .max(MAX_VALIDATED_CANDIDATE_SETS_V1),
    mergePolicyRef: VersionReferenceSchema,
    embeddingDeploymentRef: VersionReferenceSchema,
    embeddingArtifactRef: ContentArtifactRefV1Schema,
    groups: z.array(MergePlanGroupEntryV1Schema).min(1),
    /** 参与合并的候选精确版本全集；用于证明没有遗漏已校验候选。 */
    evaluatedCandidateRefs: z.array(ContentArtifactRefV1Schema).min(1),
    authorizationScopeDigest: digestSchema,
    authorizationContextRef: AuthorizationContextRefV1Schema,
    plannedAt: IsoDateTimeSchema,
  })
  .superRefine((plan, context) => {
    const keys = plan.groups.map((entry) => `${entry.groupId}\u0000${entry.groupVersionId}`);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", path: ["groups"], message: "groups must be unique" });
    }
    const memberTotal = plan.groups.reduce((total, entry) => total + entry.memberCount, 0);
    if (memberTotal !== plan.evaluatedCandidateRefs.length) {
      context.addIssue({
        code: "custom",
        path: ["evaluatedCandidateRefs"],
        message: "groups must cover every evaluated candidate exactly once",
      });
    }
    const setKeys = plan.validatedCandidateSetRefs.map(
      (ref) => `${ref.reference.entityId}\u0000${ref.reference.versionId}`,
    );
    if (new Set(setKeys).size !== setKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["validatedCandidateSetRefs"],
        message: "validated candidate sets must be unique",
      });
    }
  });
export type MergePlanV1 = z.infer<typeof MergePlanV1Schema>;

export const CompositeConfidenceBasisV1Schema = z.strictObject({
  source: ConfidenceBasisSourceV1Schema,
  available: z.boolean(),
  value: unitInterval,
  weight: unitInterval,
  contribution: unitInterval,
});
export type CompositeConfidenceBasisV1 = z.infer<typeof CompositeConfidenceBasisV1Schema>;

export const CompositeConfidencePolicyV1Schema = z.strictObject({
  schemaVersion: z.literal(RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1),
  policyRef: VersionReferenceSchema,
  policySetRef: IdentificationPolicySetRefV1Schema,
  weights: z.strictObject({
    modelConfidence: unitInterval,
    ruleConsistency: unitInterval,
    simulationConstraint: unitInterval,
    multiSourceMerge: unitInterval,
  }),
  requiredBasis: z.array(ConfidenceBasisSourceV1Schema).min(1),
  missingBasisBehavior: z.enum(["block", "exclude-and-renormalize"]),
  roundingDecimals: z.number().int().min(0).max(8),
});
export type CompositeConfidencePolicyV1 = z.infer<typeof CompositeConfidencePolicyV1Schema>;

/** 权重和必须为 1：缺项处理由 `missingBasisBehavior` 决定，而不是靠未归一化的权重。 */
export const assertCompositeConfidenceWeights = (
  policy: CompositeConfidencePolicyV1,
): CompositeConfidencePolicyV1 => {
  const weights = policy.weights;
  const total =
    weights.modelConfidence +
    weights.ruleConsistency +
    weights.simulationConstraint +
    weights.multiSourceMerge;
  if (Math.abs(total - 1) > 1e-6) {
    throw new TypeError("composite confidence weights must sum to 1");
  }
  return policy;
};

export const GroupCompositeConfidenceV1Schema = z.strictObject({
  value: unitInterval,
  basis: z.array(CompositeConfidenceBasisV1Schema).length(4),
  policyRef: VersionReferenceSchema,
  missingBasisBehavior: z.enum(["block", "exclude-and-renormalize"]),
  roundingDecimals: z.number().int().min(0).max(8),
});
export type GroupCompositeConfidenceV1 = z.infer<typeof GroupCompositeConfidenceV1Schema>;

// --------------------------------------------------- 验收路由与决定（RI-S61～S64）

export const ForcedReviewPolicyV1Schema = z.strictObject({
  schemaVersion: z.literal(RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1),
  policyRef: VersionReferenceSchema,
  policySetRef: IdentificationPolicySetRefV1Schema,
  autoAcceptanceThreshold: unitInterval,
  forcedReviewReasonCodes: z.array(IdentifierSchema),
  reviewPolicyRef: VersionReferenceSchema,
});
export type ForcedReviewPolicyV1 = z.infer<typeof ForcedReviewPolicyV1Schema>;

export const AutomaticAcceptanceDecisionV1Schema = z.strictObject({
  schemaVersion: z.literal(RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  workPlanRef: IdentificationWorkPlanRefV1Schema,
  inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
  mergePlanRef: MergePlanRefV1Schema,
  groupId: IdentifierSchema,
  groupVersionId: IdentifierSchema,
  groupRef: IdentificationGroupRefV1Schema,
  routeDecisionRef: RouteDecisionRefV1Schema,
  decision: z.literal("accept-unchanged"),
  compositeConfidence: GroupCompositeConfidenceV1Schema,
  confidencePolicyRef: VersionReferenceSchema,
  forcedReviewPolicyRef: VersionReferenceSchema,
  decidedAt: IsoDateTimeSchema,
});
export type AutomaticAcceptanceDecisionV1 = z.infer<typeof AutomaticAcceptanceDecisionV1Schema>;

const acceptanceRouteCommon = {
  groupId: IdentifierSchema,
  groupVersionId: IdentifierSchema,
  groupRef: IdentificationGroupRefV1Schema,
  compositeConfidence: GroupCompositeConfidenceV1Schema,
};

export const AcceptanceRouteV1Schema = z.discriminatedUnion("routeKind", [
  z.strictObject({
    ...acceptanceRouteCommon,
    routeKind: z.literal("automatic"),
    routeDecisionRef: RouteDecisionRefV1Schema,
  }),
  z.strictObject({
    ...acceptanceRouteCommon,
    routeKind: z.literal("review"),
    reviewTaskRef: ReviewTaskRefV1Schema,
    waitingRunRef: WorkflowRunRefV1Schema,
    validationSnapshotRef: ValidationSnapshotRefV1Schema,
    evidenceSnapshotRef: EvidenceSnapshotRefV1Schema,
    reviewPolicyRef: VersionReferenceSchema,
    forcedReviewReasonCode: IdentifierSchema,
  }),
]);
export type AcceptanceRouteV1 = z.infer<typeof AcceptanceRouteV1Schema>;

export const AcceptanceRouteSetV1Schema = z.strictObject({
  schemaVersion: z.literal(RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  workPlanRef: IdentificationWorkPlanRefV1Schema,
  identificationRunRef: WorkflowRunRefV1Schema,
  inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
  policySetRef: IdentificationPolicySetRefV1Schema,
  mergePlanRef: MergePlanRefV1Schema,
  confidencePolicyRef: VersionReferenceSchema,
  forcedReviewPolicyRef: VersionReferenceSchema,
  routes: z.array(AcceptanceRouteV1Schema).min(1),
  authorizationScopeDigest: digestSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  routedAt: IsoDateTimeSchema,
});
export type AcceptanceRouteSetV1 = z.infer<typeof AcceptanceRouteSetV1Schema>;

export const IdentificationGroupDecisionKindV1Schema = z.enum([
  "approve-unchanged",
  "approve-revised-candidate",
  "confirm-merge",
  "keep-separate",
  "reject",
  "return-upstream",
]);
export type IdentificationGroupDecisionKindV1 = z.infer<
  typeof IdentificationGroupDecisionKindV1Schema
>;

// ------------------------------------------------ 验证/证据快照与登记行

export const IdentificationSnapshotEntryV1Schema = z.discriminatedUnion("entryKind", [
  z.strictObject({
    entryKind: z.literal("validation"),
    checkId: IdentifierSchema,
    passed: z.boolean(),
    reasonCode: IdentifierSchema,
  }),
  z.strictObject({
    entryKind: z.literal("evidence"),
    candidateId: IdentifierSchema,
    candidateVersion: positiveInt,
    candidateRef: ContentArtifactRefV1Schema,
    sourceSegmentId: IdentifierSchema,
    mechanismEntryId: IdentifierSchema.optional(),
  }),
]);
export type IdentificationSnapshotEntryV1 = z.infer<typeof IdentificationSnapshotEntryV1Schema>;

export const IdentificationSnapshotV1Schema = z
  .strictObject({
    schemaVersion: z.literal(RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1),
    projectId: IdentifierSchema,
    inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
    workPlanRef: IdentificationWorkPlanRefV1Schema,
    mergePlanRef: MergePlanRefV1Schema,
    policySetRef: IdentificationPolicySetRefV1Schema,
    groupId: IdentifierSchema,
    groupVersionId: IdentifierSchema,
    groupRef: IdentificationGroupRefV1Schema,
    snapshotKind: z.enum(["validation", "evidence"]),
    entries: z.array(IdentificationSnapshotEntryV1Schema).min(1),
    authorizationScopeDigest: digestSchema,
    authorizationContextRef: AuthorizationContextRefV1Schema,
    createdAt: IsoDateTimeSchema,
  })
  .superRefine((snapshot, context) => {
    const expected = snapshot.snapshotKind === "validation" ? "validation" : "evidence";
    if (snapshot.entries.some((entry) => entry.entryKind !== expected)) {
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message: "snapshot entries must match the declared snapshot kind",
      });
    }
  });
export type IdentificationSnapshotV1 = z.infer<typeof IdentificationSnapshotV1Schema>;

/** 正式标准化风险记录写入行：payload 每次都由 C01 共享 envelope 解析。 */
export const StandardizedRiskRecordWriteV1Schema = z.strictObject({
  riskRecordId: IdentifierSchema,
  versionId: IdentifierSchema,
  riskRecordRef: z.strictObject({
    kind: z.literal("standardized-risk-record"),
    reference: VersionReferenceSchema,
  }),
  rowId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  requestDigest: digestSchema,
  projectId: IdentifierSchema,
  workPlanRef: IdentificationWorkPlanRefV1Schema,
  identificationRunRef: WorkflowRunRefV1Schema,
  inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
  mergePlanRef: MergePlanRefV1Schema,
  /** 自动路线携带该组的系统决定；人工路线改携带已成立的人工决定。 */
  routeDecisionRef: RouteDecisionRefV1Schema.optional(),
  reviewDecisionRef: z
    .strictObject({
      kind: z.literal("review-decision"),
      reference: VersionReferenceSchema,
    })
    .optional(),
  groupId: IdentifierSchema,
  groupVersionId: IdentifierSchema,
  groupRef: IdentificationGroupRefV1Schema,
  /** 该记录正文所引用的代表候选内容地址。 */
  representativeCandidateRefs: z.array(ContentArtifactRefV1Schema).min(1),
  sourceSegmentIds: uniqueIdentifiers,
  mechanismEntryIds: uniqueIdentifiers,
  authorizationScopeDigest: digestSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  actorRef: IdentifierSchema,
  commandId: IdentifierSchema,
  occurredAt: IsoDateTimeSchema,
});
export type StandardizedRiskRecordWriteV1 = z.infer<typeof StandardizedRiskRecordWriteV1Schema>;

// ------------------------------------------------ 追加式中间结果登记行

const resultRowBase = {
  schemaVersion: z.literal(RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1),
  /** 产生本登记的 C03 命令身份；审计外键 `audit_entry_id` 由它确定性派生。 */
  commandId: IdentifierSchema,
  projectId: IdentifierSchema,
  resultId: IdentifierSchema,
  resultVersionId: IdentifierSchema,
  requestDigest: digestSchema,
  artifactRef: ContentArtifactRefV1Schema,
  inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
  authorizationScopeDigest: digestSchema,
  actorRef: IdentifierSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
};

/** D-09 严格判别：每种登记行的完整引用形状只在此处限定。 */
const workPlanRefField = { workPlanRef: IdentificationWorkPlanRefV1Schema };
export const RiskCandidateFinalizationResultRowV1Schema = z.discriminatedUnion("resultKind", [
  z.strictObject({
    ...resultRowBase,
    resultKind: z.literal("candidate-set"),
    workItemRef: IdentificationWorkItemRefV1Schema,
    modelContextArtifactSetRef: ModelContextArtifactSetRefV1Schema,
    candidateSetRef: IdentificationCandidateSetRefV1Schema,
  }),
  z.strictObject({
    ...resultRowBase,
    resultKind: z.literal("zero-result"),
    workItemRef: IdentificationWorkItemRefV1Schema,
    modelContextArtifactSetRef: ModelContextArtifactSetRefV1Schema,
    zeroResultRef: IdentificationZeroResultRefV1Schema,
  }),
  z.strictObject({
    ...resultRowBase,
    resultKind: z.literal("validated-candidate-set"),
    workItemRef: IdentificationWorkItemRefV1Schema,
    candidateSetRef: IdentificationCandidateSetRefV1Schema,
    validatedCandidateSetRef: ValidatedCandidateSetRefV1Schema,
  }),
  z.strictObject({
    ...resultRowBase,
    ...workPlanRefField,
    resultKind: z.literal("identification-group"),
    groupRef: IdentificationGroupRefV1Schema,
  }),
  z.strictObject({
    ...resultRowBase,
    ...workPlanRefField,
    resultKind: z.literal("merge-plan"),
    mergePlanRef: MergePlanRefV1Schema,
  }),
  z.strictObject({
    ...resultRowBase,
    ...workPlanRefField,
    resultKind: z.literal("validation-snapshot"),
    groupRef: IdentificationGroupRefV1Schema,
    validationSnapshotRef: ValidationSnapshotRefV1Schema,
  }),
  z.strictObject({
    ...resultRowBase,
    ...workPlanRefField,
    resultKind: z.literal("evidence-snapshot"),
    groupRef: IdentificationGroupRefV1Schema,
    evidenceSnapshotRef: EvidenceSnapshotRefV1Schema,
  }),
  z.strictObject({
    ...resultRowBase,
    ...workPlanRefField,
    resultKind: z.literal("route-decision"),
    groupRef: IdentificationGroupRefV1Schema,
    routeDecisionRef: RouteDecisionRefV1Schema,
  }),
  z.strictObject({
    ...resultRowBase,
    ...workPlanRefField,
    resultKind: z.literal("acceptance-route-set"),
    mergePlanRef: MergePlanRefV1Schema,
    acceptanceRouteSetRef: AcceptanceRouteSetRefV1Schema,
  }),
]);
export type RiskCandidateFinalizationResultRowV1 = z.infer<
  typeof RiskCandidateFinalizationResultRowV1Schema
>;

/** 由组合根注入的 C22 策略快照：全部来自输入冻结的策略集，缺一项即拒绝构造。 */
export const RiskCandidatePolicyBundleV1Schema = z.strictObject({
  generation: RiskCandidateGenerationPolicyV1Schema,
  validation: RiskCandidateValidationPolicyV1Schema,
  merge: RiskCandidateMergePolicyV1Schema,
  confidence: CompositeConfidencePolicyV1Schema,
  forcedReview: ForcedReviewPolicyV1Schema,
});
export type RiskCandidatePolicyBundleV1 = z.infer<typeof RiskCandidatePolicyBundleV1Schema>;

// ------------------------------------------------------------- 稳定身份派生

const MAX_ARTIFACT_VERSION_ID_LENGTH_V1 = 200;
/** 中间正文的 artifact id 前缀；不参与任何公共契约。 */
export const RISK_CANDIDATE_FINALIZATION_ARTIFACT_PREFIX_V1 =
  "risk-candidate-finalization" as const;
/** C22 中间正文的 C04 purpose code；正文只经 C04 读取。 */
export const RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1 = Object.freeze({
  candidateSet: "risk-candidate-set",
  zeroResult: "risk-candidate-zero-result",
  validationSet: "risk-candidate-validation-set",
  group: "identification-group",
  mergePlan: "identification-merge-plan",
  snapshot: "identification-group-snapshot",
  routeDecision: "identification-route-decision",
  acceptanceRouteSet: "identification-acceptance-route-set",
  riskEventVector: "risk-candidate-risk-event-vector",
});
export const RETRIEVAL_ARTIFACT_SET_ENTITY_PREFIX_V1 = "retrieval-review:" as const;

/**
 * C21 把 `model-context` 结果行的 `resultId` 固定为
 * `identification-model-context:<projectId>:<workItemEntityId>:<taskEntityId>`，而 C02 命令只携带
 * `retrievalArtifactSetRef`（`retrieval-review:<taskEntityId>`）。这里只做这一处确定性反解，
 * 反解失败即拒绝，不扫描其它登记行、不使用 latest。
 */
export const modelContextResultIdFor = (input: {
  readonly projectId: string;
  readonly workItemEntityId: string;
  readonly retrievalArtifactSetEntityId: string;
}): string | undefined => {
  const prefix = RETRIEVAL_ARTIFACT_SET_ENTITY_PREFIX_V1;
  if (!input.retrievalArtifactSetEntityId.startsWith(prefix)) return undefined;
  const taskEntityId = input.retrievalArtifactSetEntityId.slice(prefix.length);
  if (taskEntityId.length === 0) return undefined;
  const resultId = `identification-model-context:${input.projectId}:${input.workItemEntityId}:${taskEntityId}`;
  return resultId.length > MAX_ARTIFACT_VERSION_ID_LENGTH_V1 ? undefined : resultId;
};

/** 候选集登记身份：同一工作项一个候选集身份，版本由请求摘要决定。 */
export const candidateSetEntityIdFor = (input: {
  readonly projectId: string;
  readonly workItemEntityId: string;
}): string => `identification-candidate-set:${input.projectId}:${input.workItemEntityId}`;

export const candidateSetRefFor = (input: {
  readonly projectId: string;
  readonly workItemEntityId: string;
  readonly requestDigest: string;
}): z.infer<typeof IdentificationCandidateSetRefV1Schema> => ({
  kind: "identification-candidate-set",
  reference: {
    entityId: candidateSetEntityIdFor(input),
    versionId: input.requestDigest,
  },
});

export const validatedCandidateSetRefFor = (input: {
  readonly projectId: string;
  readonly candidateSetEntityId: string;
  readonly requestDigest: string;
}): z.infer<typeof ValidatedCandidateSetRefV1Schema> => ({
  kind: "validated-candidate-set",
  reference: {
    entityId: `validated-candidate-set:${input.projectId}:${input.candidateSetEntityId}`,
    versionId: input.requestDigest,
  },
});

/** 正式零结果身份：同一工程同一工作项一个身份，版本由命令身份与冻结请求摘要决定。 */
export const zeroResultEntityIdFor = (input: {
  readonly projectId: string;
  readonly workItemEntityId: string;
}): string => `identification-zero-result:${input.projectId}:${input.workItemEntityId}`;

/**
 * 零结果冻结请求摘要（design D-03）：只由命令/幂等身份、冻结输入、五项上下文、模型、提示、
 * 输出 Schema、预算策略与授权范围组成，模型调用前即可重算；不取墙钟或模型文本作为幂等身份。
 */
export const zeroResultRequestDigestFor = (input: {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly workItemRef: IdentificationWorkItemRefV1;
  readonly inputSnapshotRef: IdentificationInputSnapshotRefV1;
  readonly retrievalArtifactSetRef: RetrievalArtifactSetRefV1;
  readonly modelContextArtifactSetRef: ModelContextArtifactSetRefV1;
  readonly modelContextPayloadDigest: string;
  readonly policySetRef: IdentificationPolicySetRefV1;
  readonly generationPolicyRef: VersionReference;
  readonly modelDeploymentRef: VersionReference;
  readonly promptTemplateRef: VersionReference;
  readonly outputSchemaRef: VersionReference;
  readonly budgetPolicyRef: VersionReference;
  readonly authorizationScopeDigest: string;
}): string =>
  sha256CanonicalJson({
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    projectId: input.projectId,
    workItemRef: input.workItemRef.reference,
    inputSnapshotRef: input.inputSnapshotRef.reference,
    retrievalArtifactSetRef: input.retrievalArtifactSetRef.reference,
    modelContextArtifactSetRef: input.modelContextArtifactSetRef.reference,
    modelContextPayloadDigest: input.modelContextPayloadDigest,
    policySetRef: input.policySetRef.reference,
    generationPolicyRef: input.generationPolicyRef,
    modelDeploymentRef: input.modelDeploymentRef,
    promptTemplateRef: input.promptTemplateRef,
    outputSchemaRef: input.outputSchemaRef,
    budgetPolicyRef: input.budgetPolicyRef,
    authorizationScopeDigest: input.authorizationScopeDigest,
  });

export const zeroResultRefFor = (input: {
  readonly projectId: string;
  readonly workItemEntityId: string;
  readonly requestDigest: string;
}): z.infer<typeof IdentificationZeroResultRefV1Schema> => ({
  kind: "identification-zero-result",
  reference: {
    entityId: zeroResultEntityIdFor(input),
    versionId: input.requestDigest,
  },
});

export const identificationGroupRefFor = (input: {
  readonly projectId: string;
  readonly workPlanEntityId: string;
  readonly groupId: string;
  readonly requestDigest: string;
}): z.infer<typeof IdentificationGroupRefV1Schema> => ({
  kind: "identification-group",
  reference: {
    entityId: `identification-group:${input.projectId}:${input.workPlanEntityId}:${input.groupId}`,
    versionId: input.requestDigest,
  },
});

export const mergePlanRefFor = (input: {
  readonly projectId: string;
  readonly workPlanEntityId: string;
  readonly requestDigest: string;
}): z.infer<typeof MergePlanRefV1Schema> => ({
  kind: "merge-plan",
  reference: {
    entityId: `merge-plan:${input.projectId}:${input.workPlanEntityId}`,
    versionId: input.requestDigest,
  },
});

export const acceptanceRouteSetRefFor = (input: {
  readonly projectId: string;
  readonly workPlanEntityId: string;
  readonly requestDigest: string;
}): z.infer<typeof AcceptanceRouteSetRefV1Schema> => ({
  kind: "acceptance-route-set",
  reference: {
    entityId: `acceptance-route-set:${input.projectId}:${input.workPlanEntityId}`,
    versionId: input.requestDigest,
  },
});

export const routeDecisionRefFor = (input: {
  readonly projectId: string;
  readonly mergePlanEntityId: string;
  readonly groupId: string;
  readonly requestDigest: string;
}): z.infer<typeof RouteDecisionRefV1Schema> => ({
  kind: "route-decision",
  reference: {
    entityId: `route-decision:${input.projectId}:${input.mergePlanEntityId}:${input.groupId}`,
    versionId: input.requestDigest,
  },
});

export const validationSnapshotRefFor = (input: {
  readonly projectId: string;
  readonly groupEntityId: string;
  readonly requestDigest: string;
}): z.infer<typeof ValidationSnapshotRefV1Schema> => ({
  kind: "validation-snapshot",
  reference: {
    entityId: `validation-snapshot:${input.projectId}:${input.groupEntityId}`,
    versionId: input.requestDigest,
  },
});

export const evidenceSnapshotRefFor = (input: {
  readonly projectId: string;
  readonly groupEntityId: string;
  readonly requestDigest: string;
}): z.infer<typeof EvidenceSnapshotRefV1Schema> => ({
  kind: "evidence-snapshot",
  reference: {
    entityId: `evidence-snapshot:${input.projectId}:${input.groupEntityId}`,
    versionId: input.requestDigest,
  },
});

export const identificationRunRefFor = (input: {
  readonly projectId: string;
  readonly workPlanEntityId: string;
}): z.infer<typeof WorkflowRunRefV1Schema> => ({
  kind: "workflow-run",
  reference: {
    entityId: `identification-run:${input.projectId}:${input.workPlanEntityId}`,
    versionId: "v1",
  },
});

/** 候选工件身份：候选集身份 + 候选 id + 版本，保证同一版本重放得到同一 id。 */
export const candidateArtifactIdFor = (input: {
  readonly candidateSetEntityId: string;
  readonly candidateId: string;
  readonly candidateVersion: number;
}): string =>
  `${RISK_CANDIDATE_FINALIZATION_ARTIFACT_PREFIX_V1}-candidate-${input.candidateSetEntityId}-${input.candidateId}-v${input.candidateVersion}`;

/** C08 复核任务引用与冻结输入的确定性身份（重放不重复请求复核）。 */
export const identificationGroupReviewTaskRefFor = (input: {
  readonly projectId: string;
  readonly groupVersionId: string;
  readonly reviewType: "identification-group";
  readonly waitingRunRef: z.infer<typeof WorkflowRunRefV1Schema>;
  readonly reviewPolicyRef: VersionReference;
}): z.infer<typeof ReviewTaskRefV1Schema> => ({
  kind: "review-task",
  reference: {
    entityId: `identification-group-review:${input.projectId}:${input.groupVersionId}`,
    versionId: input.reviewPolicyRef.versionId,
  },
  reviewType: input.reviewType,
  targetRef: {
    kind: "identification-group",
    reference: { entityId: "pending", versionId: input.groupVersionId },
  },
  waitingRunRef: input.waitingRunRef,
});

export const reviewRequestCommandIdFor = (input: {
  readonly projectId: string;
  readonly groupVersionId: string;
}): string => `c22-route-review:${input.projectId}:${input.groupVersionId}`;

export const acceptGroupsCommandDigestInput = (input: {
  readonly acceptanceRouteSetRef: {
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
  readonly acceptedGroupRefs: readonly {
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }[];
  readonly decisionRefs: readonly {
    readonly kind: string;
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }[];
}): unknown => ({
  acceptanceRouteSetRef: input.acceptanceRouteSetRef.reference,
  acceptedGroupRefs: input.acceptedGroupRefs.map((ref) => ref.reference),
  decisionRefs: input.decisionRefs.map((ref) => ({ kind: ref.kind, ...ref.reference })),
});
