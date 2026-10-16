import { z } from "zod";

import {
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import { ApplicabilityConditionsSchema } from "@riskflow/contracts/records";
import {
  AgentTaskRefV1Schema,
  AuthorizationContextRefV1Schema,
  ContentArtifactRefV1Schema,
  IdentificationInputSnapshotRefV1Schema,
  IdentificationPolicySetRefV1Schema,
  IdentificationWorkItemRefV1Schema,
  KnowledgeQueryResultRefV1Schema,
  KnowledgeReleaseRefV1Schema,
  ModelContextArtifactSetRefV1Schema,
  RetrievalArtifactSetRefV1Schema,
  ValidationSnapshotRefV1Schema,
  type KnowledgeQueryResultRefV1,
} from "@riskflow/contracts/ports";
import {
  MonitoringIndicatorSchema,
  ProcessDependencyRelationTypeSchema,
  ProcessNodeSchema,
  RiskMechanismTypeSchema,
  StateParameterDescriptionSchema,
} from "@riskflow/contracts/vocabulary";

import { RetrievalMemberRefV1Schema, RetrievalSourceKindV1Schema } from "../../retrieval/schema.js";
import {
  AgentTaskBudgetPolicyV1Schema,
  AgentValidationItemV1Schema,
} from "../../agent-runtime/schema.js";

export const IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1 = "1" as const;
/** 单次增量最多提交的操作数；候选规模另有策略上限。 */
export const MAX_RETRIEVAL_REVIEW_OPERATIONS_V1 = 32;
/** 单次有界补搜最多引用的冻结成员锚点数。 */
export const MAX_RESUPPLEMENT_ANCHORS_V1 = 4;

/** C08 `retrieval-review` 任务类型；C02 词汇已固定，C21 只注册定义，不新增类型。 */
export const RETRIEVAL_REVIEW_TASK_TYPE = "retrieval-review" as const;

/** D-03：一张登记表承载三类正式结果引用，正文只在 C04。 */
export const IDENTIFICATION_CONTEXT_RESULT_KINDS_V1 = [
  "relationship",
  "reviewed-retrieval",
  "model-context",
] as const;
export const IdentificationContextResultKindV1Schema = z.enum(
  IDENTIFICATION_CONTEXT_RESULT_KINDS_V1,
);
export type IdentificationContextResultKindV1 = z.infer<
  typeof IdentificationContextResultKindV1Schema
>;

/** 确定性校验的稳定检查身份；报告与测试只断言这些标识。 */
export const IDENTIFICATION_CONTEXT_CHECK_IDS_V1 = Object.freeze({
  incrementSchema: "retrieval-review.increment-schema",
  candidateSetBinding: "retrieval-review.candidate-set-binding",
  candidateMembership: "retrieval-review.candidate-membership",
  evidenceReachability: "retrieval-review.evidence-reachability",
  releaseVersion: "retrieval-review.release-version",
  currentAuthorization: "retrieval-review.current-authorization",
});

/** 稳定原因码；权限、来源资格与版本不兼容不进入修正循环。 */
export const IDENTIFICATION_CONTEXT_REASON_CODES_V1 = Object.freeze({
  schemaInvalid: "schema-invalid",
  candidateSetMismatch: "candidate-set-mismatch",
  candidateNotFrozen: "candidate-not-frozen",
  evidenceNotFrozen: "evidence-not-frozen",
  releaseDrift: "release-drift",
  authorizationDenied: "authorization-denied",
  authorizationRevoked: "authorization-revoked",
  sourceFactsMissing: "source-facts-missing",
  accepted: "accepted",
  excludedByAgent: "excluded-by-agent",
});
export type IdentificationContextReasonCodeV1 =
  (typeof IDENTIFICATION_CONTEXT_REASON_CODES_V1)[keyof typeof IDENTIFICATION_CONTEXT_REASON_CODES_V1];

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const positiveInt = z.number().int().positive();
const evidenceListSchema = z.array(EvidenceReferenceSchema).min(1);

// ------------------------------------------------------- 关系检索结果（RI-S55）

export const RelationshipContextNodeV1Schema = z.strictObject({
  nodeId: IdentifierSchema,
  processKind: ProcessNodeSchema,
  inputs: z.array(IdentifierSchema).min(1),
  outputs: z.array(IdentifierSchema).min(1),
  stateParameters: z.array(StateParameterDescriptionSchema),
  monitoringIndicators: z.array(MonitoringIndicatorSchema),
  applicability: ApplicabilityConditionsSchema,
  evidence: evidenceListSchema,
});
export type RelationshipContextNodeV1 = z.infer<typeof RelationshipContextNodeV1Schema>;

/** 一跳邻居：保留原始边身份与关系类型，`upstream` 表示邻居是边的起点。 */
export const RelationshipContextNeighborV1Schema = z.strictObject({
  nodeId: IdentifierSchema,
  processKind: ProcessNodeSchema,
  edgeId: IdentifierSchema,
  relationType: ProcessDependencyRelationTypeSchema,
  upstream: z.boolean(),
  evidence: evidenceListSchema,
});
export type RelationshipContextNeighborV1 = z.infer<typeof RelationshipContextNeighborV1Schema>;

/** 相接边按原方向保留 `fromNodeId → toNodeId`，不做隐式多跳。 */
export const RelationshipContextDependencyEdgeV1Schema = z.strictObject({
  edgeId: IdentifierSchema,
  fromNodeId: IdentifierSchema,
  toNodeId: IdentifierSchema,
  relationType: ProcessDependencyRelationTypeSchema,
  evidence: evidenceListSchema,
});
export type RelationshipContextDependencyEdgeV1 = z.infer<
  typeof RelationshipContextDependencyEdgeV1Schema
>;

export const RelationshipContextMechanismV1Schema = z.strictObject({
  mechanismId: IdentifierSchema,
  mechanismType: RiskMechanismTypeSchema,
  stateParameters: z.array(StateParameterDescriptionSchema),
  monitoringIndicators: z.array(MonitoringIndicatorSchema),
  evidence: evidenceListSchema,
});
export type RelationshipContextMechanismV1 = z.infer<typeof RelationshipContextMechanismV1Schema>;

/** 与当前节点显式关联但不满足适用性的机理；只留身份与原因供审计。 */
export const RelationshipContextExcludedMechanismV1Schema = z.strictObject({
  mechanismId: IdentifierSchema,
  reasonCode: IdentifierSchema,
});
export type RelationshipContextExcludedMechanismV1 = z.infer<
  typeof RelationshipContextExcludedMechanismV1Schema
>;

/** 三个精确发布的读回证明：发布引用、包摘要与证据库组合成员。 */
export const RelationshipContextReleaseBindingV1Schema = z.strictObject({
  processModelReleaseRef: KnowledgeReleaseRefV1Schema,
  processModelPackageDigest: digestSchema,
  riskMechanismReleaseRef: KnowledgeReleaseRefV1Schema,
  riskMechanismPackageDigest: digestSchema,
  retrievalEvidenceBaseReleaseRef: KnowledgeReleaseRefV1Schema,
  retrievalEvidenceBasePackageDigest: digestSchema,
  compositeMemberReleaseRefs: z.array(KnowledgeReleaseRefV1Schema).length(3),
});
export type RelationshipContextReleaseBindingV1 = z.infer<
  typeof RelationshipContextReleaseBindingV1Schema
>;

export const RelationshipContextPayloadV1Schema = z.strictObject({
  schemaVersion: z.literal(IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  queryId: IdentifierSchema,
  actorId: IdentifierSchema,
  requestedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
  inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
  workItemRef: IdentificationWorkItemRefV1Schema,
  nodeId: IdentifierSchema,
  policySetRef: IdentificationPolicySetRefV1Schema,
  retrievalPolicyRef: VersionReferenceSchema,
  reviewAgentPolicyRef: VersionReferenceSchema,
  releaseBinding: RelationshipContextReleaseBindingV1Schema,
  currentNode: RelationshipContextNodeV1Schema,
  neighborNodes: z.array(RelationshipContextNeighborV1Schema),
  dependencyEdges: z.array(RelationshipContextDependencyEdgeV1Schema),
  mechanisms: z.array(RelationshipContextMechanismV1Schema),
  excludedMechanisms: z.array(RelationshipContextExcludedMechanismV1Schema),
  authorizationScopeDigest: digestSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  knowledgeQueryResultRef: KnowledgeQueryResultRefV1Schema,
});
export type RelationshipContextPayloadV1 = z.infer<typeof RelationshipContextPayloadV1Schema>;

// -------------------------------------------- 冻结候选与类型化增量（RI-S55～S56）

/** 冻结候选成员：来源发布、命中身份与可回读的资料段证据。 */
export const RetrievalReviewCandidateV1Schema = z.strictObject({
  memberRef: RetrievalMemberRefV1Schema,
  sourceKind: RetrievalSourceKindV1Schema,
  sourceReleaseRef: KnowledgeReleaseRefV1Schema,
  sourceEntryId: IdentifierSchema,
  contentDigest: digestSchema,
  evidenceSourceVersionRefs: z.array(VersionReferenceSchema),
  /** 由 C17 精确发布条目解析出的资料段证据；`select` 只能引用这里的集合。 */
  evidence: evidenceListSchema,
  origin: z.enum(["baseline", "resupplement"]),
  originQueryResultRef: KnowledgeQueryResultRefV1Schema,
  /** 排序信号：RRF 融合名次与分值，不是置信度。 */
  rank: positiveInt,
  fusionScore: z.number().finite(),
});
export type RetrievalReviewCandidateV1 = z.infer<typeof RetrievalReviewCandidateV1Schema>;

export const RetrievalReviewResupplementV1Schema = z.strictObject({
  resupplementRef: VersionReferenceSchema,
  queryId: IdentifierSchema,
  queryResultRef: KnowledgeQueryResultRefV1Schema,
  requestDigest: digestSchema,
  supplementIntentCode: IdentifierSchema,
  anchorEntryIds: z.array(IdentifierSchema).min(1).max(MAX_RESUPPLEMENT_ANCHORS_V1),
  addedMemberCount: z.number().int().nonnegative(),
});
export type RetrievalReviewResupplementV1 = z.infer<typeof RetrievalReviewResupplementV1Schema>;

/**
 * 冻结候选版本（C08 任务输入工件）：基线正式结果 + 已完成获准补搜的成员集合。
 * 每个补搜产生一个新的不可变版本，`parentCandidateSetRef` 串起只追加链。
 */
export const RetrievalReviewCandidateSetV1Schema = z.strictObject({
  schemaVersion: z.literal(IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  taskRef: AgentTaskRefV1Schema,
  nodeId: IdentifierSchema,
  inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
  workItemRef: IdentificationWorkItemRefV1Schema,
  relationshipQueryResultRef: KnowledgeQueryResultRefV1Schema,
  baselineQueryResultRef: KnowledgeQueryResultRefV1Schema,
  baselineRequestDigest: digestSchema,
  generationRef: z.strictObject({
    kind: z.literal("retrieval-generation"),
    reference: VersionReferenceSchema,
  }),
  retrievalPolicyRef: VersionReferenceSchema,
  reviewAgentPolicyRef: VersionReferenceSchema,
  /** 工作项冻结查询文本；补搜文本只能由它与类型化意图确定性派生。 */
  frozenQueryText: z.string().min(1),
  candidateVersion: positiveInt,
  parentCandidateSetRef: ContentArtifactRefV1Schema.optional(),
  resupplements: z.array(RetrievalReviewResupplementV1Schema),
  members: z.array(RetrievalReviewCandidateV1Schema).min(1),
  frozenAuthorizationScopeDigest: digestSchema,
  frozenAuthorizationContextRef: AuthorizationContextRefV1Schema,
  frozenAt: IsoDateTimeSchema,
});
export type RetrievalReviewCandidateSetV1 = z.infer<typeof RetrievalReviewCandidateSetV1Schema>;

export const RetrievalReviewModelObservationV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("retrieval-result"),
    schemaVersion: z.literal(IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1),
    taskRef: AgentTaskRefV1Schema,
    candidateSetRef: ContentArtifactRefV1Schema,
    candidateVersion: positiveInt,
    queryResultRef: KnowledgeQueryResultRefV1Schema,
    members: z.array(RetrievalReviewCandidateV1Schema),
    resupplements: z.array(RetrievalReviewResupplementV1Schema),
  }),
  z.strictObject({
    kind: z.literal("validation"),
    schemaVersion: z.literal(IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1),
    taskRef: AgentTaskRefV1Schema,
    candidateSetRef: ContentArtifactRefV1Schema.optional(),
    items: z.array(AgentValidationItemV1Schema),
  }),
]);
export type RetrievalReviewModelObservationV1 = z.infer<
  typeof RetrievalReviewModelObservationV1Schema
>;

export const RetrievalReviewSelectOperationV1Schema = z.strictObject({
  operation: z.literal("select"),
  memberRef: RetrievalMemberRefV1Schema,
  evidence: evidenceListSchema,
  rationaleCode: IdentifierSchema,
});
export type RetrievalReviewSelectOperationV1 = z.infer<
  typeof RetrievalReviewSelectOperationV1Schema
>;

export const RetrievalReviewExcludeOperationV1Schema = z.strictObject({
  operation: z.literal("exclude"),
  memberRef: RetrievalMemberRefV1Schema,
  reasonCode: IdentifierSchema,
});
export type RetrievalReviewExcludeOperationV1 = z.infer<
  typeof RetrievalReviewExcludeOperationV1Schema
>;

/** 封闭的 `select | exclude` 操作联合；不允许补丁、正文、排序数值或风险分值。 */
export const RetrievalReviewOperationV1Schema = z.discriminatedUnion("operation", [
  RetrievalReviewSelectOperationV1Schema,
  RetrievalReviewExcludeOperationV1Schema,
]);
export type RetrievalReviewOperationV1 = z.infer<typeof RetrievalReviewOperationV1Schema>;

export const RetrievalReviewIncrementV1Schema = z.strictObject({
  schemaVersion: z.literal(IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1),
  candidateVersion: positiveInt,
  /** 所审阅的候选版本工件；必须是本工作项、本任务名下的冻结版本。 */
  candidateSetRef: ContentArtifactRefV1Schema,
  operations: z
    .array(RetrievalReviewOperationV1Schema)
    .min(1)
    .max(MAX_RETRIEVAL_REVIEW_OPERATIONS_V1),
});
export type RetrievalReviewIncrementV1 = z.infer<typeof RetrievalReviewIncrementV1Schema>;
/** C08 候选正文即类型化增量；不额外包一层整对象覆盖。 */
export const RetrievalReviewCandidateBodyV1Schema = RetrievalReviewIncrementV1Schema;
export type RetrievalReviewCandidateBodyV1 = RetrievalReviewIncrementV1;

// --------------------------------------------- Agent 动作与有界补搜意图

export const RETRIEVAL_REVIEW_TOOL_KINDS_V1 = [
  "read-frozen-result",
  "bounded-hybrid-resupplement",
] as const;
export const RetrievalReviewToolKindV1Schema = z.enum(RETRIEVAL_REVIEW_TOOL_KINDS_V1);
export type RetrievalReviewToolKindV1 = z.infer<typeof RetrievalReviewToolKindV1Schema>;

export const ReadFrozenResultActionV1Schema = z.strictObject({
  kind: z.literal("read-frozen-result"),
  candidateSetRef: ContentArtifactRefV1Schema,
  queryResultRef: KnowledgeQueryResultRefV1Schema,
  maxMembers: z.number().int().positive().max(64),
});
export type ReadFrozenResultActionV1 = z.infer<typeof ReadFrozenResultActionV1Schema>;

/**
 * 有界补搜动作：只接受冻结意图码与冻结成员锚点，附加查询文本由 C21 确定性派生，
 * 不接受自由正文、目标工程或版本改换。
 */
export const BoundedHybridResupplementActionV1Schema = z.strictObject({
  kind: z.literal("bounded-hybrid-resupplement"),
  candidateSetRef: ContentArtifactRefV1Schema,
  supplementIntentCode: IdentifierSchema,
  anchorEntryIds: z.array(IdentifierSchema).min(1).max(MAX_RESUPPLEMENT_ANCHORS_V1),
});
export type BoundedHybridResupplementActionV1 = z.infer<
  typeof BoundedHybridResupplementActionV1Schema
>;

export const SubmitRetrievalReviewActionV1Schema = z.strictObject({
  kind: z.literal("submit-retrieval-review"),
  increment: RetrievalReviewIncrementV1Schema,
});
export type SubmitRetrievalReviewActionV1 = z.infer<typeof SubmitRetrievalReviewActionV1Schema>;

/** C08 动作协议：两项有界工具加一个类型化提交动作，没有通用补丁。 */
export const RetrievalReviewActionV1Schema = z.discriminatedUnion("kind", [
  ReadFrozenResultActionV1Schema,
  BoundedHybridResupplementActionV1Schema,
  SubmitRetrievalReviewActionV1Schema,
]);
export type RetrievalReviewActionV1 = z.infer<typeof RetrievalReviewActionV1Schema>;

/** 补搜意图的冻结记录；C20 冻结查询输入窄读按稳定 queryId 精确回读它。 */
export const RetrievalResupplementIntentV1Schema = z.strictObject({
  schemaVersion: z.literal(IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  taskRef: AgentTaskRefV1Schema,
  actionId: IdentifierSchema,
  queryId: IdentifierSchema,
  candidateSetRef: ContentArtifactRefV1Schema,
  supplementIntentCode: IdentifierSchema,
  anchorEntryIds: z.array(IdentifierSchema).min(1).max(MAX_RESUPPLEMENT_ANCHORS_V1),
  queryText: z.string().min(1),
  frozenAt: IsoDateTimeSchema,
});
export type RetrievalResupplementIntentV1 = z.infer<typeof RetrievalResupplementIntentV1Schema>;

// ------------------------------------------------- 正式检索工件集（RI-S55～S56）

export const ReviewedRetrievalMemberV1Schema = z.strictObject({
  memberRef: RetrievalMemberRefV1Schema,
  sourceKind: RetrievalSourceKindV1Schema,
  sourceReleaseRef: KnowledgeReleaseRefV1Schema,
  sourceEntryId: IdentifierSchema,
  contentDigest: digestSchema,
  evidence: evidenceListSchema,
  originQueryResultRef: KnowledgeQueryResultRefV1Schema,
  /** 排序信号随证据保留，明确不是模型或综合置信度。 */
  rankingSignal: z.strictObject({
    rank: positiveInt,
    fusionScore: z.number().finite(),
    scoreSemantics: z.literal("ranking-signal-not-confidence"),
  }),
});
export type ReviewedRetrievalMemberV1 = z.infer<typeof ReviewedRetrievalMemberV1Schema>;

/** `retrieval-artifact-set` 的正式正文；正文只入 C04，登记行只存引用。 */
export const ReviewedRetrievalSetV1Schema = z.strictObject({
  schemaVersion: z.literal(IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  taskRef: AgentTaskRefV1Schema,
  nodeId: IdentifierSchema,
  inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
  workItemRef: IdentificationWorkItemRefV1Schema,
  candidateSetRef: ContentArtifactRefV1Schema,
  candidateVersion: positiveInt,
  baselineQueryResultRef: KnowledgeQueryResultRefV1Schema,
  relationshipQueryResultRef: KnowledgeQueryResultRefV1Schema,
  resupplementQueryResultRefs: z.array(KnowledgeQueryResultRefV1Schema),
  validationArtifactRef: ValidationSnapshotRefV1Schema,
  selectedMembers: z.array(ReviewedRetrievalMemberV1Schema).min(1),
  excludedMembers: z.array(
    z.strictObject({
      memberRef: RetrievalMemberRefV1Schema,
      reasonCode: IdentifierSchema,
    }),
  ),
  authorizationScopeDigest: digestSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  completedAt: IsoDateTimeSchema,
});
export type ReviewedRetrievalSetV1 = z.infer<typeof ReviewedRetrievalSetV1Schema>;

// ------------------------------------------------ RI-S56 五项上下文（D-07）

export const ModelContextTimeNeighborV1Schema = z.strictObject({
  nodeId: IdentifierSchema,
  processKind: ProcessNodeSchema,
  edgeId: IdentifierSchema,
  position: z.enum(["predecessor", "successor"]),
  evidence: evidenceListSchema,
});
export type ModelContextTimeNeighborV1 = z.infer<typeof ModelContextTimeNeighborV1Schema>;

export const ModelContextProcessNodeV1Schema = z.strictObject({
  nodeId: IdentifierSchema,
  processKind: ProcessNodeSchema,
  inputs: z.array(IdentifierSchema).min(1),
  outputs: z.array(IdentifierSchema).min(1),
  adjacentTimeNodes: z.array(ModelContextTimeNeighborV1Schema),
  evidence: evidenceListSchema,
});
export type ModelContextProcessNodeV1 = z.infer<typeof ModelContextProcessNodeV1Schema>;

export const ModelContextStateParametersV1Schema = z.strictObject({
  nodeId: IdentifierSchema,
  stateParameters: z.array(StateParameterDescriptionSchema).min(1),
  monitoringIndicators: z.array(MonitoringIndicatorSchema),
  evidence: evidenceListSchema,
});
export type ModelContextStateParametersV1 = z.infer<typeof ModelContextStateParametersV1Schema>;

export const ModelContextForceDependencyV1Schema = z.strictObject({
  edgeId: IdentifierSchema,
  fromNodeId: IdentifierSchema,
  toNodeId: IdentifierSchema,
  relationType: z.literal("受力依赖关系"),
  evidence: evidenceListSchema,
});
export type ModelContextForceDependencyV1 = z.infer<typeof ModelContextForceDependencyV1Schema>;

export const ModelContextMechanismV1Schema = z.strictObject({
  mechanismId: IdentifierSchema,
  mechanismType: RiskMechanismTypeSchema,
  stateParameters: z.array(StateParameterDescriptionSchema),
  evidence: evidenceListSchema,
});
export type ModelContextMechanismV1 = z.infer<typeof ModelContextMechanismV1Schema>;

export const ModelContextRetrievalEvidenceV1Schema = z.strictObject({
  memberRef: RetrievalMemberRefV1Schema,
  sourceKind: RetrievalSourceKindV1Schema,
  sourceReleaseRef: KnowledgeReleaseRefV1Schema,
  sourceEntryId: IdentifierSchema,
  evidence: evidenceListSchema,
  rankingSignal: z.strictObject({
    rank: positiveInt,
    fusionScore: z.number().finite(),
    scoreSemantics: z.literal("ranking-signal-not-confidence"),
  }),
});
export type ModelContextRetrievalEvidenceV1 = z.infer<typeof ModelContextRetrievalEvidenceV1Schema>;

/** 五项依据恰好五组，全部非空；缺任一项即阻断，不以模型补足。 */
export const ModelContextPayloadV1Schema = z.strictObject({
  schemaVersion: z.literal(IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  nodeId: IdentifierSchema,
  inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
  workItemRef: IdentificationWorkItemRefV1Schema,
  policySetRef: IdentificationPolicySetRefV1Schema,
  releaseBinding: RelationshipContextReleaseBindingV1Schema,
  relationshipQueryResultRef: KnowledgeQueryResultRefV1Schema,
  baselineQueryResultRef: KnowledgeQueryResultRefV1Schema,
  retrievalArtifactSetRef: RetrievalArtifactSetRefV1Schema,
  reviewTaskRef: AgentTaskRefV1Schema,
  reviewAgentPolicyRef: VersionReferenceSchema,
  retrievalPolicyRef: VersionReferenceSchema,
  processNode: ModelContextProcessNodeV1Schema,
  stateParameters: ModelContextStateParametersV1Schema,
  forceDependencies: z.array(ModelContextForceDependencyV1Schema).min(1),
  mechanisms: z.array(ModelContextMechanismV1Schema).min(1),
  retrievalEvidence: z.array(ModelContextRetrievalEvidenceV1Schema).min(1),
  authorizationScopeDigest: digestSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  assembledAt: IsoDateTimeSchema,
});
export type ModelContextPayloadV1 = z.infer<typeof ModelContextPayloadV1Schema>;

// ------------------------------------------------------------ 正式结果登记行

const resultRowBase = {
  schemaVersion: z.literal(IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  resultId: IdentifierSchema,
  resultVersionId: IdentifierSchema,
  requestDigest: digestSchema,
  artifactRef: ContentArtifactRefV1Schema,
  inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
  workItemRef: IdentificationWorkItemRefV1Schema,
  authorizationScopeDigest: digestSchema,
  actorRef: IdentifierSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
};

/** D-03 严格判别：每种结果行的完整引用形状在核心层唯一限定。 */
export const IdentificationContextResultRowV1Schema = z.discriminatedUnion("resultKind", [
  z.strictObject({
    ...resultRowBase,
    resultKind: z.literal("relationship"),
    queryId: IdentifierSchema,
    knowledgeQueryResultRef: KnowledgeQueryResultRefV1Schema,
  }),
  z.strictObject({
    ...resultRowBase,
    resultKind: z.literal("reviewed-retrieval"),
    agentTaskRef: AgentTaskRefV1Schema,
    baselineQueryResultRef: KnowledgeQueryResultRefV1Schema,
    retrievalArtifactSetRef: RetrievalArtifactSetRefV1Schema,
  }),
  z.strictObject({
    ...resultRowBase,
    resultKind: z.literal("model-context"),
    relationshipQueryResultRef: KnowledgeQueryResultRefV1Schema,
    retrievalArtifactSetRef: RetrievalArtifactSetRefV1Schema,
    modelContextArtifactSetRef: ModelContextArtifactSetRefV1Schema,
  }),
]);
export type IdentificationContextResultRowV1 = z.infer<
  typeof IdentificationContextResultRowV1Schema
>;

// ------------------------------------------------------------ 策略与稳定身份

/** C21 审阅策略：由组合根冻结注入，必须与输入快照的审阅策略引用一致。 */
export const RetrievalReviewPolicyV1Schema = z
  .strictObject({
    schemaVersion: z.literal(IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1),
    policyRef: VersionReferenceSchema,
    definitionRef: VersionReferenceSchema,
    toolPolicyRef: VersionReferenceSchema,
    incrementSchemaRef: VersionReferenceSchema,
    validationPolicyRef: VersionReferenceSchema,
    readFrozenResultToolRef: VersionReferenceSchema,
    resupplementToolRef: VersionReferenceSchema,
    budgetPolicyRef: VersionReferenceSchema,
    budgetPolicy: AgentTaskBudgetPolicyV1Schema,
    modelDeploymentRef: VersionReferenceSchema,
    promptTemplateRef: VersionReferenceSchema,
    maxCandidateMembers: z.number().int().positive().max(512),
    maxResupplements: z.number().int().positive().max(16),
    allowedSupplementIntentCodes: z
      .array(IdentifierSchema)
      .min(1)
      .refine((codes) => new Set(codes).size === codes.length),
    modelMaxOutputTokens: z.number().int().positive(),
  })
  .superRefine((policy, context) => {
    const budget = policy.budgetPolicy;
    for (const [key, actual, expected] of [
      ["policyRef", budget.policyRef, policy.budgetPolicyRef],
      ["modelDeploymentRef", budget.modelDeploymentRef, policy.modelDeploymentRef],
      ["promptTemplateRef", budget.promptTemplateRef, policy.promptTemplateRef],
      ["toolPolicyRef", budget.toolPolicyRef, policy.toolPolicyRef],
    ] as const) {
      if (actual.entityId !== expected.entityId || actual.versionId !== expected.versionId)
        context.addIssue({
          code: "custom",
          path: ["budgetPolicy", key],
          message: "budget reference mismatch",
        });
    }
    if (
      policy.maxCandidateMembers > budget.maxObjects ||
      policy.maxResupplements > budget.maxSupplementarySearches ||
      policy.modelMaxOutputTokens > (budget.maxOutputTokens ?? budget.maxContextTokens)
    )
      context.addIssue({
        code: "custom",
        path: ["budgetPolicy"],
        message: "review policy exceeds task budget",
      });
  });
export type RetrievalReviewPolicyV1 = z.infer<typeof RetrievalReviewPolicyV1Schema>;

/**
 * D-08 单份运行清单：V2 只引用唯一预算正文与候选/补搜业务参数；
 * 模型、提示与工具策略引用由该预算解析，不在策略中重复抄写。
 * modelMaxOutputTokens 仍是每步业务上限，超出被引用预算时由目录归一拒绝。
 */
export const RetrievalReviewPolicyV2Schema = z.strictObject({
  schemaVersion: z.literal("2"),
  policyRef: VersionReferenceSchema,
  definitionRef: VersionReferenceSchema,
  incrementSchemaRef: VersionReferenceSchema,
  validationPolicyRef: VersionReferenceSchema,
  readFrozenResultToolRef: VersionReferenceSchema,
  resupplementToolRef: VersionReferenceSchema,
  budgetPolicyRef: VersionReferenceSchema,
  maxCandidateMembers: z.number().int().positive().max(512),
  maxResupplements: z.number().int().positive().max(16),
  allowedSupplementIntentCodes: z
    .array(IdentifierSchema)
    .min(1)
    .refine((codes) => new Set(codes).size === codes.length),
  modelMaxOutputTokens: z.number().int().positive(),
});
export type RetrievalReviewPolicyV2 = z.infer<typeof RetrievalReviewPolicyV2Schema>;

/** 结果稳定身份：`relationship-query-result:<project>:<queryId>` 等（design D-03）。 */
export const relationshipQueryResultRefFor = (input: {
  readonly projectId: string;
  readonly queryId: string;
  readonly requestDigest: string;
}): KnowledgeQueryResultRefV1 => ({
  kind: "knowledge-query-result",
  reference: {
    entityId: `relationship-query-result:${input.projectId}:${input.queryId}`,
    versionId: input.requestDigest,
  },
});

export const retrievalArtifactSetRefFor = (input: {
  readonly entityId: string;
  readonly requestDigest: string;
}): z.infer<typeof RetrievalArtifactSetRefV1Schema> => ({
  kind: "retrieval-artifact-set",
  reference: {
    entityId: input.entityId,
    versionId: input.requestDigest,
  },
});

export const modelContextArtifactSetRefFor = (input: {
  readonly entityId: string;
  readonly requestDigest: string;
}): z.infer<typeof ModelContextArtifactSetRefV1Schema> => ({
  kind: "model-context-artifact-set",
  reference: {
    entityId: input.entityId,
    versionId: input.requestDigest,
  },
});

/** 关系读分支上下文调用身份：与调用身份绑定，保证 C06 幂等签发可重放。 */
export const identificationBasisReadInvocationIdFor = (input: {
  readonly queryId: string;
  readonly releaseRef: { readonly reference: { readonly entityId: string } };
}): string => `c21-identification-basis:${input.queryId}:${input.releaseRef.reference.entityId}`;

/** 补搜意图工件与稳定 queryId 的确定性身份（D-05）。 */
export const resupplementArtifactIdFor = (taskEntityId: string, actionId: string): string =>
  `retrieval-resupplement-intent:${taskEntityId}:${actionId}`;

/** 补搜 queryId 使用显式前缀，与基线的 `<nodeId>:retrieval-baseline` 永不混淆。 */
export const RESUPPLEMENT_QUERY_ID_MARKER = ":retrieval-resupplement:" as const;

export const resupplementQueryIdFor = (taskEntityId: string, actionId: string): string =>
  `${taskEntityId}${RESUPPLEMENT_QUERY_ID_MARKER}${actionId}`;

export const isResupplementQueryId = (queryId: string): boolean =>
  queryId.includes(RESUPPLEMENT_QUERY_ID_MARKER);

/**
 * 由工作项冻结查询文本与类型化意图派生补搜查询文本：只使用冻结字段，
 * 不接受自由正文，因此同一动作在重放时必然得到同一文本。
 */
export const resupplementQueryTextFor = (input: {
  readonly frozenQueryText: string;
  readonly supplementIntentCode: string;
  readonly anchorEntryIds: readonly string[];
}): string =>
  [
    input.frozenQueryText.trim(),
    input.supplementIntentCode.trim(),
    ...input.anchorEntryIds.map((id) => id.trim()),
  ]
    .filter((part) => part.length > 0)
    .join(" ");

export const parseResupplementQueryId = (
  queryId: string,
): { readonly taskEntityId: string; readonly actionId: string } | undefined => {
  const separator = queryId.lastIndexOf(":");
  if (separator <= 0 || separator === queryId.length - 1) return undefined;
  return { taskEntityId: queryId.slice(0, separator), actionId: queryId.slice(separator + 1) };
};
