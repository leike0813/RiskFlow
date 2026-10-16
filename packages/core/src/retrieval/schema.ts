import { z } from "zod";

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import {
  AuthorizationContextRefV1Schema,
  AuthorizationContextV1Schema,
  ContentArtifactRefV1Schema,
  ContractReferenceV1Schema,
  KnowledgeQueryResultRefV1Schema,
  KnowledgeReleaseRefV1Schema,
  RetrievalEvidenceBaseReleaseRefV1Schema,
  type AuthorizationContextRefV1,
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type KnowledgeQueryResultRefV1,
  type KnowledgeReleaseRefV1,
  type RetrievalEvidenceBaseReleaseRefV1,
} from "@riskflow/contracts/ports";

/**
 * C20 检索投影与查询的唯一领域 Schema 模块（design D2/D3/D5/D9/D11）。
 *
 * 事实边界：策略、代际、清单、结果与验收报告全部在这里版本化定义；Qdrant 线上报文
 * Schema 留在 adapters 层，不泄漏为领域 API。任何新增字段都必须先开 OpenSpec change。
 */

export const HYBRID_RETRIEVAL_SCHEMA_VERSION_V1 = "1" as const;

/** 检索证据库固定的三类成员来源（与 C17 组合发布成员定义类型同源）。 */
export const RETRIEVAL_SOURCE_KINDS_V1 = [
  "risk-mechanism",
  "standard-library",
  "case-library",
] as const;
export const RetrievalSourceKindV1Schema = z.enum(RETRIEVAL_SOURCE_KINDS_V1);
export type RetrievalSourceKindV1 = z.infer<typeof RetrievalSourceKindV1Schema>;

export const RETRIEVAL_DENSE_VECTOR_NAME_V1 = "dense" as const;
export const RETRIEVAL_BM25_VECTOR_NAME_V1 = "bm25" as const;
export const RETRIEVAL_BM25_MODEL_V1 = "qdrant/bm25" as const;
export const RETRIEVAL_BM25_TOKENIZER_V1 = "multilingual" as const;

export const RETRIEVAL_GENERATION_STATUS_V1 = [
  "building",
  "ready",
  "active",
  "superseded",
  "failed",
] as const;
export const RetrievalGenerationStatusV1Schema = z.enum(RETRIEVAL_GENERATION_STATUS_V1);
export type RetrievalGenerationStatusV1 = z.infer<typeof RetrievalGenerationStatusV1Schema>;

export const HYBRID_RETRIEVAL_FAILURE_STAGES_V1 = [
  "event",
  "source-read",
  "embedding",
  "projection",
  "reconciliation",
  "quality",
  "activation",
  "query",
  "authorization",
  "result-persistence",
] as const;
export const HybridRetrievalFailureStageV1Schema = z.enum(HYBRID_RETRIEVAL_FAILURE_STAGES_V1);
export type HybridRetrievalFailureStageV1 = z.infer<typeof HybridRetrievalFailureStageV1Schema>;

export const HYBRID_RETRIEVAL_FAILURE_CODES_V1 = [
  "UNSUPPORTED_EVENT_VERSION",
  "SOURCE_FACT_DRIFT",
  "POLICY_NOT_FOUND",
  "POLICY_INCOMPATIBLE",
  "RESOURCE_LIMIT_EXCEEDED",
  "EMBEDDING_FAILED",
  "EMBEDDING_DIMENSION_MISMATCH",
  "QDRANT_UNAVAILABLE",
  "QDRANT_INVALID_RESPONSE",
  "DUAL_INDEX_MISMATCH",
  "QUALITY_GATE_FAILED",
  "ACTIVATION_CONFLICT",
  "GENERATION_NOT_READY",
  "AUTHORIZATION_DENIED",
  "AUTHORIZATION_RECONCILIATION_FAILED",
  "FUSION_RECONCILIATION_FAILED",
  "IDEMPOTENCY_CONFLICT",
  "RESULT_PERSISTENCE_FAILED",
  "RETRIEVAL_INPUT_DRIFT",
] as const;
export const HybridRetrievalFailureCodeV1Schema = z.enum(HYBRID_RETRIEVAL_FAILURE_CODES_V1);
export type HybridRetrievalFailureCodeV1 = z.infer<typeof HybridRetrievalFailureCodeV1Schema>;

/** 验收硬门标识：每项独立判定，禁止用融合总分掩盖单项失败。 */
export const RETRIEVAL_ACCEPTANCE_GATE_IDS_V1 = [
  "dense-recall-at-5",
  "bm25-recall-at-5",
  "rrf-recall-at-5",
  "rrf-ndcg-at-5",
  "dual-index-reconciliation",
  "authorization-leakage",
  "qdrant-query-p95-ms",
] as const;
export const RetrievalAcceptanceGateIdV1Schema = z.enum(RETRIEVAL_ACCEPTANCE_GATE_IDS_V1);
export type RetrievalAcceptanceGateIdV1 = z.infer<typeof RetrievalAcceptanceGateIdV1Schema>;

export const HYBRID_RETRIEVAL_SAMPLE_NOTICE_V1 = "合成样本、待甲方复核" as const;

/** 排序信号语义标记：RRF 与各路分值是查询相关排序信号，不是风险置信度。 */
export const HYBRID_RETRIEVAL_SCORE_SEMANTICS_V1 = "ranking-signal-not-confidence" as const;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
export type Sha256V1 = z.infer<typeof sha256Schema>;

const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();
const positiveFinite = z.number().finite().positive();

const retrievalRef = <const T extends string>(kind: T) =>
  z.strictObject({ kind: z.literal(kind), reference: VersionReferenceSchema });

export const RetrievalGenerationRefV1Schema = retrievalRef("retrieval-generation");
export type RetrievalGenerationRefV1 = z.infer<typeof RetrievalGenerationRefV1Schema>;

export const RetrievalMemberRefV1Schema = retrievalRef("retrieval-member");
export type RetrievalMemberRefV1 = z.infer<typeof RetrievalMemberRefV1Schema>;

export const RetrievalGenerationTransitionRefV1Schema = retrievalRef(
  "retrieval-generation-transition",
);
export type RetrievalGenerationTransitionRefV1 = z.infer<
  typeof RetrievalGenerationTransitionRefV1Schema
>;

export const RetrievalScanRefV1Schema = retrievalRef("retrieval-projection-scan");
export type RetrievalScanRefV1 = z.infer<typeof RetrievalScanRefV1Schema>;

// ------------------------------------------------------------------ 策略

const bm25ConfigShape = {
  model: z.literal(RETRIEVAL_BM25_MODEL_V1),
  tokenizer: z.literal(RETRIEVAL_BM25_TOKENIZER_V1),
  language: IdentifierSchema,
  stemmer: z.literal("none"),
  /** 中文工程语料不使用停用词：策略冻结为空集合，任何非空配置都被拒绝。 */
  stopwords: z.array(z.string()).length(0),
};

export const HybridRetrievalBm25ConfigV1Schema = z.strictObject(bm25ConfigShape);
export type HybridRetrievalBm25ConfigV1 = z.infer<typeof HybridRetrievalBm25ConfigV1Schema>;

/**
 * 版本化检索策略（design D3）。数值必须有限、非负，并满足
 * `topK <= 各路 prefetch <= 成员上限`；双路权重均大于零。
 */
export const HybridRetrievalPolicyV1Schema = z
  .strictObject({
    schemaVersion: z.literal(HYBRID_RETRIEVAL_SCHEMA_VERSION_V1),
    policyRef: VersionReferenceSchema,
    /** 适用的检索证据库定义类型；本 change 只支持组合发布包。 */
    evidenceBaseDefinitionType: z.literal("retrieval-evidence-base"),
    modelDeploymentRef: VersionReferenceSchema,
    /** 可选查询指令：只渲染查询 Embedding 文本，同一策略版本内固定。 */
    queryInstruction: z.string().trim().min(1).optional(),
    dense: z.strictObject({
      vectorName: z.literal(RETRIEVAL_DENSE_VECTOR_NAME_V1),
      dimensions: positiveInt,
      distance: z.enum(["cosine", "dot", "euclid"]),
    }),
    bm25: z.strictObject({
      vectorName: z.literal(RETRIEVAL_BM25_VECTOR_NAME_V1),
      ...bm25ConfigShape,
    }),
    densePrefetchLimit: positiveInt,
    bm25PrefetchLimit: positiveInt,
    topK: positiveInt,
    rrf: z.strictObject({
      k: positiveInt,
      denseWeight: positiveFinite,
      bm25Weight: positiveFinite,
    }),
    memberBatchLimit: positiveInt,
    memberByteLimit: positiveInt,
    memberLimit: positiveInt,
    embeddingTimeoutMs: positiveInt,
    projectionTimeoutMs: positiveInt,
    acceptancePolicyRef: VersionReferenceSchema,
    projectionCompatibilityRef: VersionReferenceSchema,
  })
  .superRefine((policy, context) => {
    if (policy.topK > policy.densePrefetchLimit) {
      context.addIssue({
        code: "custom",
        path: ["densePrefetchLimit"],
        message: "dense prefetch limit must be at least topK",
      });
    }
    if (policy.topK > policy.bm25PrefetchLimit) {
      context.addIssue({
        code: "custom",
        path: ["bm25PrefetchLimit"],
        message: "bm25 prefetch limit must be at least topK",
      });
    }
    if (policy.densePrefetchLimit > policy.memberLimit) {
      context.addIssue({
        code: "custom",
        path: ["densePrefetchLimit"],
        message: "dense prefetch limit must not exceed the member limit",
      });
    }
    if (policy.bm25PrefetchLimit > policy.memberLimit) {
      context.addIssue({
        code: "custom",
        path: ["bm25PrefetchLimit"],
        message: "bm25 prefetch limit must not exceed the member limit",
      });
    }
  });
export type HybridRetrievalPolicyV1 = z.infer<typeof HybridRetrievalPolicyV1Schema>;

// ------------------------------------------------------- 代际、成员与清单

export const RetrievalMemberReleaseRefsV1Schema = z.strictObject({
  /** 三个组合槽位与事件载荷一致：成员发布本身是 C16 generic 知识发布引用。 */
  riskMechanismRef: KnowledgeReleaseRefV1Schema,
  standardLibraryRef: KnowledgeReleaseRefV1Schema,
  caseLibraryRef: KnowledgeReleaseRefV1Schema,
});
export type RetrievalMemberReleaseRefsV1 = z.infer<typeof RetrievalMemberReleaseRefsV1Schema>;

/**
 * 代际身份输入（design D3）。任一字段变化都必须产生新代际；
 * `projectionCompatibilityRef` 固定 Qdrant 主版本能力、向量名与 BM25 配置。
 */
export const RetrievalGenerationIdentityInputsV1Schema = z.strictObject({
  projectId: IdentifierSchema,
  sourceEventId: IdentifierSchema,
  evidenceBaseReleaseRef: RetrievalEvidenceBaseReleaseRefV1Schema,
  memberReleaseRefs: RetrievalMemberReleaseRefsV1Schema,
  policyRef: VersionReferenceSchema,
  modelDeploymentRef: VersionReferenceSchema,
  projectionCompatibilityRef: VersionReferenceSchema,
});
export type RetrievalGenerationIdentityInputsV1 = z.infer<
  typeof RetrievalGenerationIdentityInputsV1Schema
>;

export const RetrievalMemberManifestEntryV1Schema = z.strictObject({
  memberRef: RetrievalMemberRefV1Schema,
  pointId: IdentifierSchema,
  sourceKind: RetrievalSourceKindV1Schema,
  sourceReleaseRef: KnowledgeReleaseRefV1Schema,
  sourceEntryId: IdentifierSchema,
  contentDigest: sha256Schema,
  authorizationScopeDigest: sha256Schema,
  denseDimensions: positiveInt,
  bm25Language: IdentifierSchema,
});
export type RetrievalMemberManifestEntryV1 = z.infer<typeof RetrievalMemberManifestEntryV1Schema>;

export const RetrievalIndexManifestV1Schema = z.strictObject({
  schemaVersion: z.literal(HYBRID_RETRIEVAL_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  generationRef: RetrievalGenerationRefV1Schema,
  policyRef: VersionReferenceSchema,
  modelDeploymentRef: VersionReferenceSchema,
  projectionCompatibilityRef: VersionReferenceSchema,
  membersSha256: sha256Schema,
  members: z.array(RetrievalMemberManifestEntryV1Schema).min(1),
});
export type RetrievalIndexManifestV1 = z.infer<typeof RetrievalIndexManifestV1Schema>;

export const RetrievalGenerationV1Schema = z.strictObject({
  schemaVersion: z.literal(HYBRID_RETRIEVAL_SCHEMA_VERSION_V1),
  generationRef: RetrievalGenerationRefV1Schema,
  identity: RetrievalGenerationIdentityInputsV1Schema,
  collectionName: IdentifierSchema,
  authorizationScopeDigest: sha256Schema,
  expectedMemberCount: nonNegativeInt,
  manifestSha256: sha256Schema,
  createdAt: IsoDateTimeSchema,
  createdBy: IdentifierSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
});
export type RetrievalGenerationV1 = z.infer<typeof RetrievalGenerationV1Schema>;

export const RetrievalGenerationTransitionV1Schema = z
  .strictObject({
    schemaVersion: z.literal(HYBRID_RETRIEVAL_SCHEMA_VERSION_V1),
    transitionRef: RetrievalGenerationTransitionRefV1Schema,
    generationRef: RetrievalGenerationRefV1Schema,
    ordinal: positiveInt,
    status: RetrievalGenerationStatusV1Schema,
    occurredAt: IsoDateTimeSchema,
    manifestSha256: sha256Schema.optional(),
    failureCode: HybridRetrievalFailureCodeV1Schema.optional(),
    noteCode: IdentifierSchema.optional(),
  })
  .superRefine((transition, context) => {
    if (transition.status === "ready" && transition.manifestSha256 === undefined) {
      context.addIssue({
        code: "custom",
        path: ["manifestSha256"],
        message: "ready transition must record the reconciled manifest digest",
      });
    }
    if (transition.status === "failed" && transition.failureCode === undefined) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "failed transition must record the failure code",
      });
    }
  });
export type RetrievalGenerationTransitionV1 = z.infer<typeof RetrievalGenerationTransitionV1Schema>;

export const RetrievalActivationV1Schema = z.strictObject({
  schemaVersion: z.literal(HYBRID_RETRIEVAL_SCHEMA_VERSION_V1),
  generationRef: RetrievalGenerationRefV1Schema,
  projectId: IdentifierSchema,
  evidenceBaseReleaseRef: RetrievalEvidenceBaseReleaseRefV1Schema,
  policyRef: VersionReferenceSchema,
  authorizationScopeDigest: sha256Schema,
  activationOrdinal: positiveInt,
  previousGenerationRef: RetrievalGenerationRefV1Schema.optional(),
  activatedAt: IsoDateTimeSchema,
  actorRef: IdentifierSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
});
export type RetrievalActivationV1 = z.infer<typeof RetrievalActivationV1Schema>;

// ------------------------------------------------- Qdrant 投影观测（adapter 回读）

export const RetrievalPointPayloadV1Schema = z.strictObject({
  schemaVersion: z.literal(HYBRID_RETRIEVAL_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  generationRef: RetrievalGenerationRefV1Schema,
  /** `generationRef.reference.versionId` 的字符串投影：Qdrant 载荷过滤只能匹配标量。 */
  generationKey: IdentifierSchema,
  sourceKind: RetrievalSourceKindV1Schema,
  sourceReleaseRef: KnowledgeReleaseRefV1Schema,
  sourceEntryId: IdentifierSchema,
  contentDigest: sha256Schema,
  authorizationScopeDigest: sha256Schema,
});
export type RetrievalPointPayloadV1 = z.infer<typeof RetrievalPointPayloadV1Schema>;

export const RetrievalProjectionPointV1Schema = z.strictObject({
  pointId: IdentifierSchema,
  hasDenseVector: z.boolean(),
  hasSparseVector: z.boolean(),
  denseDimensions: nonNegativeInt,
  payload: RetrievalPointPayloadV1Schema.optional(),
});
export type RetrievalProjectionPointV1 = z.infer<typeof RetrievalProjectionPointV1Schema>;

export const RetrievalProjectionObservationV1Schema = z.strictObject({
  collectionName: IdentifierSchema,
  generationRef: RetrievalGenerationRefV1Schema,
  serviceVersion: IdentifierSchema,
  points: z.array(RetrievalProjectionPointV1Schema),
  complete: z.boolean(),
});
export type RetrievalProjectionObservationV1 = z.infer<
  typeof RetrievalProjectionObservationV1Schema
>;

export const RetrievalManifestDifferenceV1Schema = z.strictObject({
  code: z.enum([
    "MEMBER_MISSING",
    "MEMBER_UNEXPECTED",
    "DENSE_VECTOR_MISSING",
    "SPARSE_VECTOR_MISSING",
    "DIMENSION_MISMATCH",
    "CONTENT_DIGEST_MISMATCH",
    "SOURCE_REFERENCE_MISMATCH",
    "SCOPE_DIGEST_MISMATCH",
    "PAYLOAD_MISSING",
    "GENERATION_MISMATCH",
  ]),
  memberRef: IdentifierSchema.optional(),
  detailCode: IdentifierSchema.optional(),
});
export type RetrievalManifestDifferenceV1 = z.infer<typeof RetrievalManifestDifferenceV1Schema>;

export const RetrievalReconciliationV1Schema = z.strictObject({
  consistent: z.boolean(),
  checkedMemberCount: nonNegativeInt,
  differences: z.array(RetrievalManifestDifferenceV1Schema),
});
export type RetrievalReconciliationV1 = z.infer<typeof RetrievalReconciliationV1Schema>;

// ------------------------------------------------------------- 双路查询与融合

export const RetrievalFusedHitV1Schema = z.strictObject({
  pointId: IdentifierSchema,
  rank: positiveInt,
  score: z.number().finite(),
  payload: RetrievalPointPayloadV1Schema,
});
export type RetrievalFusedHitV1 = z.infer<typeof RetrievalFusedHitV1Schema>;

export const RetrievalRouteHitV1Schema = z.strictObject({
  pointId: IdentifierSchema,
  rank: positiveInt,
  score: z.number().finite(),
});
export type RetrievalRouteHitV1 = z.infer<typeof RetrievalRouteHitV1Schema>;

export const RetrievalHybridHitV1Schema = z.strictObject({
  pointId: IdentifierSchema,
  rank: positiveInt,
  fusionScore: z.number().finite(),
  denseRank: positiveInt.optional(),
  bm25Rank: positiveInt.optional(),
  /** 两路各自的 RRF 贡献 `weight / (k + rank)`，用于可重放解释。 */
  denseContribution: z.number().finite().nonnegative(),
  bm25Contribution: z.number().finite().nonnegative(),
});
export type RetrievalHybridHitV1 = z.infer<typeof RetrievalHybridHitV1Schema>;

export const RetrievalHybridQueryV1Schema = z.strictObject({
  collectionName: IdentifierSchema,
  generationRef: RetrievalGenerationRefV1Schema,
  queryDenseVector: z.array(z.number().finite()).min(1),
  queryText: z.string().min(1),
  policy: HybridRetrievalPolicyV1Schema,
  filter: z.strictObject({
    projectId: IdentifierSchema,
    generationRef: RetrievalGenerationRefV1Schema,
    authorizationScopeDigest: sha256Schema,
    visiblePointIds: z.array(IdentifierSchema),
  }),
});
export type RetrievalHybridQueryV1 = z.infer<typeof RetrievalHybridQueryV1Schema>;

export const RetrievalHybridQueryResultV1Schema = z.strictObject({
  collectionName: IdentifierSchema,
  generationRef: RetrievalGenerationRefV1Schema,
  serviceVersion: IdentifierSchema,
  fused: z.array(RetrievalFusedHitV1Schema),
  denseRoute: z.array(RetrievalRouteHitV1Schema),
  bm25Route: z.array(RetrievalRouteHitV1Schema),
  /** 服务端 RRF 请求自身的墙钟耗时；p95 以该样本计量。 */
  fusedQueryDurationMs: z.number().finite().nonnegative(),
});
export type RetrievalHybridQueryResultV1 = z.infer<typeof RetrievalHybridQueryResultV1Schema>;

// --------------------------------------------------------------- 查询输入与结果

export const HybridRetrievalInputRefsV1Schema = z.strictObject({
  inputSnapshotRef: z.strictObject({
    kind: z.literal("identification-input-snapshot"),
    reference: VersionReferenceSchema,
  }),
  workItemRef: z.strictObject({
    kind: z.literal("identification-work-item"),
    reference: VersionReferenceSchema,
  }),
  retrievalPolicyRef: VersionReferenceSchema,
});
export type HybridRetrievalInputRefsV1 = z.infer<typeof HybridRetrievalInputRefsV1Schema>;

export const HybridRetrievalQueryInputV1Schema = z.strictObject({
  schemaVersion: z.literal(HYBRID_RETRIEVAL_SCHEMA_VERSION_V1),
  queryId: IdentifierSchema,
  projectId: IdentifierSchema,
  actorId: IdentifierSchema,
  requestedAt: IsoDateTimeSchema,
  refs: HybridRetrievalInputRefsV1Schema,
  evidenceBaseReleaseRef: RetrievalEvidenceBaseReleaseRefV1Schema,
  policy: HybridRetrievalPolicyV1Schema,
  queryText: z.string().min(1),
  authorizationScopeDigest: sha256Schema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  authorization: AuthorizationContextV1Schema,
});
export type HybridRetrievalQueryInputV1 = z.infer<typeof HybridRetrievalQueryInputV1Schema>;

export const HybridRetrievalFactMemberV1Schema = z.strictObject({
  memberRef: RetrievalMemberRefV1Schema,
  sourceKind: RetrievalSourceKindV1Schema,
  sourceReleaseRef: KnowledgeReleaseRefV1Schema,
  sourceEntryId: IdentifierSchema,
  contentDigest: sha256Schema,
  evidenceSourceVersionRefs: z.array(VersionReferenceSchema),
});
export type HybridRetrievalFactMemberV1 = z.infer<typeof HybridRetrievalFactMemberV1Schema>;

export const HybridRetrievalHitV1Schema = z.strictObject({
  rank: positiveInt,
  memberRef: RetrievalMemberRefV1Schema,
  sourceKind: RetrievalSourceKindV1Schema,
  sourceReleaseRef: KnowledgeReleaseRefV1Schema,
  sourceEntryId: IdentifierSchema,
  contentDigest: sha256Schema,
  evidenceSourceVersionRefs: z.array(VersionReferenceSchema),
  denseRank: positiveInt.optional(),
  bm25Rank: positiveInt.optional(),
  denseContribution: z.number().finite().nonnegative(),
  bm25Contribution: z.number().finite().nonnegative(),
  fusionScore: z.number().finite(),
});
export type HybridRetrievalHitV1 = z.infer<typeof HybridRetrievalHitV1Schema>;

export const HybridRetrievalResultPayloadV1Schema = z.strictObject({
  schemaVersion: z.literal(HYBRID_RETRIEVAL_SCHEMA_VERSION_V1),
  queryId: IdentifierSchema,
  projectId: IdentifierSchema,
  actorId: IdentifierSchema,
  requestedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
  refs: HybridRetrievalInputRefsV1Schema,
  evidenceBaseReleaseRef: RetrievalEvidenceBaseReleaseRefV1Schema,
  memberReleaseRefs: RetrievalMemberReleaseRefsV1Schema,
  generationRef: RetrievalGenerationRefV1Schema,
  collectionName: IdentifierSchema,
  projectionCompatibilityRef: VersionReferenceSchema,
  policyRef: VersionReferenceSchema,
  modelDeploymentRef: VersionReferenceSchema,
  embeddingDimensions: positiveInt,
  bm25: HybridRetrievalBm25ConfigV1Schema,
  rrf: z.strictObject({
    k: positiveInt,
    denseWeight: positiveFinite,
    bm25Weight: positiveFinite,
  }),
  densePrefetchLimit: positiveInt,
  bm25PrefetchLimit: positiveInt,
  topK: positiveInt,
  authorizationScopeDigest: sha256Schema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  hits: z.array(HybridRetrievalHitV1Schema),
  /** RRF 与各路分值是查询相关排序信号，不是风险置信度，也不参与 P/C、矩阵与预警。 */
  scoreSemantics: z.literal(HYBRID_RETRIEVAL_SCORE_SEMANTICS_V1),
  knowledgeQueryResultRef: KnowledgeQueryResultRefV1Schema,
});
export type HybridRetrievalResultPayloadV1 = z.infer<typeof HybridRetrievalResultPayloadV1Schema>;

export const HybridRetrievalResultV1Schema = HybridRetrievalResultPayloadV1Schema.extend({
  resultArtifactRef: ContentArtifactRefV1Schema,
});
export type HybridRetrievalResultV1 = z.infer<typeof HybridRetrievalResultV1Schema>;

export const HybridRetrievalFailureV1Schema = z.strictObject({
  schemaVersion: z.literal(HYBRID_RETRIEVAL_SCHEMA_VERSION_V1),
  stage: HybridRetrievalFailureStageV1Schema,
  code: HybridRetrievalFailureCodeV1Schema,
  retryable: z.boolean(),
  occurredAt: IsoDateTimeSchema,
  projectId: IdentifierSchema.optional(),
  eventId: IdentifierSchema.optional(),
  queryId: IdentifierSchema.optional(),
  generationRef: RetrievalGenerationRefV1Schema.optional(),
  detailCode: IdentifierSchema,
  contextRefs: z.array(ContractReferenceV1Schema),
});
export type HybridRetrievalFailureV1 = z.infer<typeof HybridRetrievalFailureV1Schema>;

// ------------------------------------------------------------- 验收策略与报告

export const HybridRetrievalAcceptancePolicyV1Schema = z.strictObject({
  schemaVersion: z.literal(HYBRID_RETRIEVAL_SCHEMA_VERSION_V1),
  acceptancePolicyRef: VersionReferenceSchema,
  datasetRef: VersionReferenceSchema,
  syntheticSample: z.boolean(),
  topK: positiveInt,
  denseRecallAt5Min: z.number().finite().min(0).max(1),
  bm25RecallAt5Min: z.number().finite().min(0).max(1),
  rrfRecallAt5Min: z.number().finite().min(0).max(1),
  rrfNdcgAt5Min: z.number().finite().min(0).max(1),
  reconciliationRatioMin: z.number().finite().min(0).max(1),
  authorizationLeakageMax: nonNegativeInt,
  qdrantQueryP95MsMax: positiveFinite,
  warmupRuns: nonNegativeInt,
  measuredRuns: positiveInt,
});
export type HybridRetrievalAcceptancePolicyV1 = z.infer<
  typeof HybridRetrievalAcceptancePolicyV1Schema
>;

export const RetrievalAcceptanceGateV1Schema = z.strictObject({
  gateId: RetrievalAcceptanceGateIdV1Schema,
  threshold: z.number().finite(),
  observed: z.number().finite(),
  passed: z.boolean(),
  sampleCount: nonNegativeInt,
  boundaryNote: IdentifierSchema,
});
export type RetrievalAcceptanceGateV1 = z.infer<typeof RetrievalAcceptanceGateV1Schema>;

export const HybridRetrievalAcceptanceReportV1Schema = z
  .strictObject({
    schemaVersion: z.literal(HYBRID_RETRIEVAL_SCHEMA_VERSION_V1),
    acceptancePolicyRef: VersionReferenceSchema,
    datasetRef: VersionReferenceSchema,
    syntheticSample: z.boolean(),
    sampleNotice: z.literal(HYBRID_RETRIEVAL_SAMPLE_NOTICE_V1).optional(),
    environment: z.strictObject({
      nodeVersion: IdentifierSchema,
      containerRuntime: IdentifierSchema,
      qdrantServiceRef: IdentifierSchema,
      cpuModel: IdentifierSchema,
      platform: IdentifierSchema,
    }),
    gates: z.array(RetrievalAcceptanceGateV1Schema).min(1),
    overall: z.enum(["passed", "failed"]),
    measuredAt: IsoDateTimeSchema,
  })
  .superRefine((report, context) => {
    if (report.syntheticSample && report.sampleNotice === undefined) {
      context.addIssue({
        code: "custom",
        path: ["sampleNotice"],
        message: "synthetic datasets must carry the pending-review notice",
      });
    }
  });
export type HybridRetrievalAcceptanceReportV1 = z.infer<
  typeof HybridRetrievalAcceptanceReportV1Schema
>;

export const HybridRetrievalAcceptanceMeasurementsV1Schema = z.strictObject({
  denseRecallAt5: z.number().finite().min(0).max(1),
  bm25RecallAt5: z.number().finite().min(0).max(1),
  rrfRecallAt5: z.number().finite().min(0).max(1),
  rrfNdcgAt5: z.number().finite().min(0).max(1),
  reconciliationRatio: z.number().finite().min(0).max(1),
  authorizationLeakage: nonNegativeInt,
  qdrantQueryP95Ms: positiveFinite,
  queryCount: nonNegativeInt,
  memberCount: nonNegativeInt,
  p95SampleCount: nonNegativeInt,
  environment: z.strictObject({
    nodeVersion: IdentifierSchema,
    containerRuntime: IdentifierSchema,
    qdrantServiceRef: IdentifierSchema,
    cpuModel: IdentifierSchema,
    platform: IdentifierSchema,
  }),
  measuredAt: IsoDateTimeSchema,
});
export type HybridRetrievalAcceptanceMeasurementsV1 = z.infer<
  typeof HybridRetrievalAcceptanceMeasurementsV1Schema
>;

export type {
  AuthorizationContextRefV1,
  AuthorizationContextV1,
  ContentArtifactRefV1,
  KnowledgeQueryResultRefV1,
  KnowledgeReleaseRefV1,
  RetrievalEvidenceBaseReleaseRefV1,
};
