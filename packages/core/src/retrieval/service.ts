import { createHash } from "node:crypto";
import { z } from "zod";

import {
  AuthorizationContextV1Schema,
  KnowledgeRetrievalQueryV1Schema,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type DiagnosticArtifactRefV1,
  type KnowledgeQueryResultRefV1,
  type KnowledgeReleaseRefV1,
  type KnowledgeRetrievalQueryV1,
  type KnowledgeRetrievalResultV1,
  type ModuleErrorV1,
} from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";

import { ArtifactPutCommandV1Schema, type ArtifactStoreV1 } from "../artifacts/index.js";
import type {
  IdentificationKnowledgeExactReadV1,
  IdentificationKnowledgeReleaseReaderV1,
} from "../identification-knowledge/index.js";
import { EmbeddingRequestV1Schema, type ModelGatewayPortV1 } from "../model/index.js";
import { canonicalJson, sha256CanonicalJson } from "../persistence/index.js";
import type {
  HybridRetrievalInputReaderV1,
  RetrievalGenerationStoreV1,
  RetrievalProjectionPortV1,
} from "./ports.js";
import {
  HybridRetrievalAcceptanceMeasurementsV1Schema,
  HybridRetrievalAcceptancePolicyV1Schema,
  HybridRetrievalAcceptanceReportV1Schema,
  HybridRetrievalFailureV1Schema,
  HybridRetrievalPolicyV1Schema,
  HybridRetrievalResultPayloadV1Schema,
  HYBRID_RETRIEVAL_SCHEMA_VERSION_V1,
  HYBRID_RETRIEVAL_SCORE_SEMANTICS_V1,
  RetrievalGenerationRefV1Schema,
  RetrievalHybridQueryResultV1Schema,
  RetrievalHybridQueryV1Schema,
  RetrievalIndexManifestV1Schema,
  RetrievalMemberRefV1Schema,
  RetrievalProjectionObservationV1Schema,
  RetrievalReconciliationV1Schema,
  RETRIEVAL_SOURCE_KINDS_V1,
  type HybridRetrievalAcceptancePolicyV1,
  type HybridRetrievalAcceptanceReportV1,
  type HybridRetrievalFailureCodeV1,
  type HybridRetrievalFailureStageV1,
  type HybridRetrievalFailureV1,
  type HybridRetrievalHitV1,
  type HybridRetrievalPolicyV1,
  type HybridRetrievalQueryInputV1,
  type HybridRetrievalResultPayloadV1,
  type RetrievalGenerationRefV1,
  type RetrievalGenerationStatusV1,
  type RetrievalGenerationV1,
  type RetrievalHybridQueryResultV1,
  type RetrievalIndexManifestV1,
  type RetrievalManifestDifferenceV1,
  type RetrievalMemberManifestEntryV1,
  type RetrievalProjectionObservationV1,
  type RetrievalReconciliationV1,
  type RetrievalSourceKindV1,
} from "./schema.js";

/**
 * C20 确定性核心（design D3/D5/D7/D11）。这里只做身份、状态、对账、融合复验与门禁判定；
 * 不访问网络、数据库或文件系统，全部外部事实经端口注入。
 */

/** 授权范围摘要：只取资源范围，不取调用者身份，保证投影与查询可用同一摘要对账。 */
export const authorizationScopeDigest = (authorization: AuthorizationContextV1): string => {
  const parsed = AuthorizationContextV1Schema.parse(authorization);
  return sha256CanonicalJson({
    projectId: parsed.projectId,
    spatialScopeRefs: [...parsed.spatialScopeRefs]
      .map((scope) => `${scope.reference.entityId}/${scope.reference.versionId}`)
      .sort(),
    sourceAccessGrantRefs: [...parsed.sourceAccessGrantRefs]
      .map((grant) => `${grant.reference.entityId}/${grant.reference.versionId}`)
      .sort(),
    authorizationPolicyRef: {
      entityId: parsed.authorizationPolicyRef.entityId,
      versionId: parsed.authorizationPolicyRef.versionId,
    },
  });
};

export const retrievalGenerationRefFor = (input: {
  readonly projectId: string;
  readonly sourceEventId: string;
  readonly evidenceBaseReleaseRef: RetrievalGenerationV1["identity"]["evidenceBaseReleaseRef"];
  readonly memberReleaseRefs: RetrievalGenerationV1["identity"]["memberReleaseRefs"];
  readonly policyRef: VersionReference;
  readonly modelDeploymentRef: VersionReference;
  readonly projectionCompatibilityRef: VersionReference;
}): RetrievalGenerationRefV1 =>
  RetrievalGenerationRefV1Schema.parse({
    kind: "retrieval-generation",
    reference: {
      entityId: `retrieval-generation:${input.projectId}:${input.evidenceBaseReleaseRef.reference.entityId}`,
      versionId: `sha256:${sha256CanonicalJson({
        projectId: input.projectId,
        sourceEventId: input.sourceEventId,
        evidenceBaseReleaseRef: input.evidenceBaseReleaseRef,
        memberReleaseRefs: input.memberReleaseRefs,
        policyRef: input.policyRef,
        modelDeploymentRef: input.modelDeploymentRef,
        projectionCompatibilityRef: input.projectionCompatibilityRef,
      })}`,
    },
  });

/** 投影兼容身份：Qdrant 服务线 + 向量名 + BM25 配置；任一变化都产生新代际。 */
export const projectionCompatibilityRefFor = (input: {
  readonly serviceVersion: string;
  readonly policy: HybridRetrievalPolicyV1;
}): VersionReference => {
  const [major, minor] = input.serviceVersion.split(".");
  const serviceLine = `${major ?? input.serviceVersion}.${minor ?? "0"}`;
  const digest = sha256CanonicalJson({
    serviceLine,
    denseVectorName: input.policy.dense.vectorName,
    denseDimensions: input.policy.dense.dimensions,
    denseDistance: input.policy.dense.distance,
    bm25VectorName: input.policy.bm25.vectorName,
    bm25Model: input.policy.bm25.model,
    bm25Tokenizer: input.policy.bm25.tokenizer,
    bm25Language: input.policy.bm25.language,
    bm25Stemmer: input.policy.bm25.stemmer,
    bm25Stopwords: [...input.policy.bm25.stopwords],
  });
  return {
    entityId: "retrieval-projection-compatibility",
    versionId: `qdrant-${serviceLine}-${digest.slice(0, 32)}`,
  };
};

/** 一代一 collection；名称由代际身份确定性派生，便于精确删除与重建对账。 */
export const retrievalCollectionNameFor = (generationRef: RetrievalGenerationRefV1): string =>
  `riskflow-retrieval-${generationRef.reference.versionId.replace(/^sha256:/u, "").slice(0, 32)}`;

const MEMBER_TEXT_FIELDS: Readonly<Record<RetrievalSourceKindV1, readonly string[]>> = {
  "risk-mechanism": [
    "mechanismId",
    "mechanismType",
    "nodeIds",
    "preconditions",
    "triggeringFactors",
    "evolutionPath",
    "consequences",
  ],
  "standard-library": ["entryId", "level", "standardIdentity", "standardVersion", "clauseRefs"],
  "case-library": [
    "entryId",
    "constructionMethod",
    "engineeringConditions",
    "process",
    "events",
    "outcomes",
    "treatments",
  ],
};

const flattenTextValue = (value: unknown): string[] => {
  if (value === undefined || value === null) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) return value.flatMap((item) => flattenTextValue(item));
  return [canonicalJson(value)];
};

/**
 * 成员文本投影：按来源类型的固定字段顺序拼接，忽略未知字段。
 * 同一投影同时用于 Qdrant document inference、清单对账与查询回查，因此必须确定。
 */
export const retrievalMemberText = (
  sourceKind: RetrievalSourceKindV1,
  entry: Readonly<Record<string, unknown>>,
): string =>
  MEMBER_TEXT_FIELDS[sourceKind].flatMap((field) => flattenTextValue(entry[field])).join("\n");

export const retrievalMemberContentDigest = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

/** 由稳定身份摘要派生 Qdrant point 身份。 */
export const retrievalMemberPointId = (identityDigest: string): string =>
  `${identityDigest.slice(0, 8)}-${identityDigest.slice(8, 12)}-5${identityDigest.slice(13, 16)}-${(
    (Number.parseInt(identityDigest[16] ?? "0", 16) & 0x3) |
    0x8
  ).toString(16)}${identityDigest.slice(17, 20)}-${identityDigest.slice(20, 32)}`;

export const retrievalMemberRefFor = (input: {
  readonly generationRef: RetrievalGenerationRefV1;
  readonly sourceKind: RetrievalSourceKindV1;
  readonly sourceReleaseRef: KnowledgeReleaseRefV1;
  readonly sourceEntryId: string;
  readonly contentDigest: string;
}): RetrievalMemberManifestEntryV1["memberRef"] =>
  RetrievalMemberRefV1Schema.parse({
    kind: "retrieval-member",
    reference: {
      entityId: `retrieval-member:${input.generationRef.reference.versionId
        .replace(/^sha256:/u, "")
        .slice(0, 16)}:${input.sourceKind}:${input.sourceEntryId}`,
      versionId: `sha256:${input.contentDigest}`,
    },
  });

export type RetrievalMemberSourceV1 = {
  readonly sourceKind: RetrievalSourceKindV1;
  readonly sourceReleaseRef: KnowledgeReleaseRefV1;
  readonly entries: readonly {
    readonly entryId: string;
    readonly entry: Readonly<Record<string, unknown>>;
  }[];
};

export const normalizeRetrievalMembers = (input: {
  readonly projectId: string;
  readonly generationRef: RetrievalGenerationRefV1;
  readonly policy: HybridRetrievalPolicyV1;
  readonly authorizationScopeDigest: string;
  readonly sources: readonly RetrievalMemberSourceV1[];
}):
  | {
      readonly kind: "succeeded";
      readonly manifest: RetrievalIndexManifestV1;
      readonly points: readonly {
        readonly pointId: string;
        readonly text: string;
      }[];
    }
  | {
      readonly kind: "failed";
      readonly code: HybridRetrievalFailureCodeV1;
      readonly detailCode: string;
    } => {
  const seenKinds = new Set<string>();
  for (const source of input.sources) {
    if (seenKinds.has(source.sourceKind)) {
      return { kind: "failed", code: "SOURCE_FACT_DRIFT", detailCode: "duplicate-source-kind" };
    }
    seenKinds.add(source.sourceKind);
  }
  for (const required of RETRIEVAL_SOURCE_KINDS_V1) {
    if (!seenKinds.has(required)) {
      return {
        kind: "failed",
        code: "SOURCE_FACT_DRIFT",
        detailCode: `missing-source-${required}`,
      };
    }
  }

  const members: RetrievalMemberManifestEntryV1[] = [];
  const points: { pointId: string; text: string }[] = [];
  const entryKeys = new Set<string>();

  for (const source of [...input.sources].sort((left, right) =>
    left.sourceKind.localeCompare(right.sourceKind),
  )) {
    if (source.entries.length === 0) {
      return {
        kind: "failed",
        code: "SOURCE_FACT_DRIFT",
        detailCode: `empty-source-${source.sourceKind}`,
      };
    }
    for (const entry of [...source.entries].sort((left, right) =>
      left.entryId.localeCompare(right.entryId),
    )) {
      const key = `${source.sourceKind}/${entry.entryId}`;
      if (entryKeys.has(key)) {
        return { kind: "failed", code: "SOURCE_FACT_DRIFT", detailCode: `duplicate-entry-${key}` };
      }
      entryKeys.add(key);
      const text = retrievalMemberText(source.sourceKind, entry.entry);
      if (text.trim().length === 0) {
        return { kind: "failed", code: "SOURCE_FACT_DRIFT", detailCode: `empty-entry-${key}` };
      }
      if (Buffer.byteLength(text, "utf8") > input.policy.memberByteLimit) {
        return {
          kind: "failed",
          code: "RESOURCE_LIMIT_EXCEEDED",
          detailCode: `member-bytes-${source.sourceKind}`,
        };
      }
      const contentDigest = retrievalMemberContentDigest(text);
      const memberRef = retrievalMemberRefFor({
        generationRef: input.generationRef,
        sourceKind: source.sourceKind,
        sourceReleaseRef: source.sourceReleaseRef,
        sourceEntryId: entry.entryId,
        contentDigest,
      });
      const pointId = retrievalMemberPointId(sha256CanonicalJson(memberRef));
      points.push({ pointId, text });
      members.push({
        memberRef,
        pointId,
        sourceKind: source.sourceKind,
        sourceReleaseRef: source.sourceReleaseRef,
        sourceEntryId: entry.entryId,
        contentDigest,
        authorizationScopeDigest: input.authorizationScopeDigest,
        denseDimensions: input.policy.dense.dimensions,
        bm25Language: input.policy.bm25.language,
      });
    }
  }

  if (members.length > input.policy.memberLimit) {
    return { kind: "failed", code: "RESOURCE_LIMIT_EXCEEDED", detailCode: "member-count" };
  }

  return {
    kind: "succeeded",
    manifest: RetrievalIndexManifestV1Schema.parse({
      schemaVersion: HYBRID_RETRIEVAL_SCHEMA_VERSION_V1,
      projectId: input.projectId,
      generationRef: input.generationRef,
      policyRef: input.policy.policyRef,
      modelDeploymentRef: input.policy.modelDeploymentRef,
      projectionCompatibilityRef: input.policy.projectionCompatibilityRef,
      membersSha256: sha256CanonicalJson(members),
      members,
    }),
    points,
  };
};

const ALLOWED_GENERATION_TRANSITIONS: Readonly<
  Record<RetrievalGenerationStatusV1, readonly RetrievalGenerationStatusV1[]>
> = {
  building: ["ready", "failed"],
  ready: ["active", "failed"],
  active: ["superseded"],
  superseded: [],
  failed: [],
};

export const assertGenerationTransition = (
  from: RetrievalGenerationStatusV1,
  to: RetrievalGenerationStatusV1,
): boolean => ALLOWED_GENERATION_TRANSITIONS[from].includes(to);

/** 双索引清单逐项对账（design D5 步骤 5）；Qdrant 载荷永远不被提升为事实源。 */
export const reconcileDualIndexManifest = (input: {
  readonly projectId: string;
  readonly expected: RetrievalIndexManifestV1;
  readonly observed: RetrievalProjectionObservationV1;
}): RetrievalReconciliationV1 => {
  const observed = RetrievalProjectionObservationV1Schema.parse(input.observed);
  const expected = RetrievalIndexManifestV1Schema.parse(input.expected);
  const differences: RetrievalManifestDifferenceV1[] = [];
  const memberRef = (member: RetrievalMemberManifestEntryV1) => member.memberRef.reference.entityId;

  if (observed.generationRef.reference.versionId !== expected.generationRef.reference.versionId) {
    differences.push({ code: "GENERATION_MISMATCH" });
  }
  if (!observed.complete) {
    differences.push({ code: "MEMBER_MISSING", detailCode: "incomplete-scan" });
  }

  const byPoint = new Map(observed.points.map((point) => [point.pointId, point]));
  for (const member of expected.members) {
    const point = byPoint.get(member.pointId);
    if (point === undefined) {
      differences.push({ code: "MEMBER_MISSING", memberRef: memberRef(member) });
      continue;
    }
    byPoint.delete(member.pointId);
    if (!point.hasDenseVector)
      differences.push({ code: "DENSE_VECTOR_MISSING", memberRef: memberRef(member) });
    if (!point.hasSparseVector)
      differences.push({ code: "SPARSE_VECTOR_MISSING", memberRef: memberRef(member) });
    if (point.denseDimensions !== member.denseDimensions) {
      differences.push({ code: "DIMENSION_MISMATCH", memberRef: memberRef(member) });
    }
    const payload = point.payload;
    if (payload === undefined) {
      differences.push({ code: "PAYLOAD_MISSING", memberRef: memberRef(member) });
      continue;
    }
    if (
      payload.projectId !== input.projectId ||
      payload.generationRef.reference.versionId !== expected.generationRef.reference.versionId ||
      payload.generationKey !== expected.generationRef.reference.versionId ||
      payload.sourceKind !== member.sourceKind ||
      payload.sourceEntryId !== member.sourceEntryId ||
      payload.sourceReleaseRef.reference.entityId !== member.sourceReleaseRef.reference.entityId ||
      payload.sourceReleaseRef.reference.versionId !== member.sourceReleaseRef.reference.versionId
    ) {
      differences.push({ code: "SOURCE_REFERENCE_MISMATCH", memberRef: memberRef(member) });
    }
    if (payload.contentDigest !== member.contentDigest) {
      differences.push({ code: "CONTENT_DIGEST_MISMATCH", memberRef: memberRef(member) });
    }
    if (payload.authorizationScopeDigest !== member.authorizationScopeDigest) {
      differences.push({ code: "SCOPE_DIGEST_MISMATCH", memberRef: memberRef(member) });
    }
  }
  for (const point of byPoint.values()) {
    differences.push({ code: "MEMBER_UNEXPECTED", detailCode: point.pointId });
  }

  return RetrievalReconciliationV1Schema.parse({
    consistent: differences.length === 0,
    checkedMemberCount: expected.members.length,
    differences,
  });
};

export const rrfContribution = (weight: number, k: number, rank: number): number =>
  weight / (k + rank);

/**
 * 融合复验（design D7）：按精确策略复算每路贡献并核对最终顺序。
 * Qdrant 的 RRF 归一会掩盖绝对分值，因此这里核对顺序与单调性，而不是分值相等。
 */
export const reconcileRrfResult = (input: {
  readonly policy: HybridRetrievalPolicyV1;
  readonly result: RetrievalHybridQueryResultV1;
}): RetrievalReconciliationV1 => {
  const policy = HybridRetrievalPolicyV1Schema.parse(input.policy);
  const result = RetrievalHybridQueryResultV1Schema.parse(input.result);
  const differences: RetrievalManifestDifferenceV1[] = [];
  const denseRanks = new Map(result.denseRoute.map((hit) => [hit.pointId, hit.rank]));
  const bm25Ranks = new Map(result.bm25Route.map((hit) => [hit.pointId, hit.rank]));
  const ordered = result.fused.map((hit) => {
    const denseRank = denseRanks.get(hit.pointId);
    const bm25Rank = bm25Ranks.get(hit.pointId);
    return {
      pointId: hit.pointId,
      contribution:
        (denseRank === undefined
          ? 0
          : rrfContribution(policy.rrf.denseWeight, policy.rrf.k, denseRank)) +
        (bm25Rank === undefined
          ? 0
          : rrfContribution(policy.rrf.bm25Weight, policy.rrf.k, bm25Rank)),
      score: hit.score,
    };
  });

  if (ordered.length > policy.topK) {
    differences.push({ code: "MEMBER_UNEXPECTED", detailCode: "fused-exceeds-topK" });
  }
  if (result.denseRoute.length === 0 || result.bm25Route.length === 0) {
    differences.push({ code: "MEMBER_MISSING", detailCode: "route-empty" });
  }
  for (const hit of ordered) {
    if (hit.contribution <= 0) {
      differences.push({ code: "MEMBER_UNEXPECTED", detailCode: `unranked-${hit.pointId}` });
    }
  }
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (previous.contribution < current.contribution - 1e-9) {
      differences.push({ code: "MEMBER_UNEXPECTED", detailCode: "fusion-order-mismatch" });
      break;
    }
    if (previous.score < current.score) {
      differences.push({ code: "MEMBER_UNEXPECTED", detailCode: "fused-score-not-monotonic" });
      break;
    }
  }

  return RetrievalReconciliationV1Schema.parse({
    consistent: differences.length === 0,
    checkedMemberCount: ordered.length,
    differences,
  });
};

/** 每项硬门独立判定：融合总分或平均值不得掩盖任一单路、权限、版本或 p95 失败。 */
export const evaluateRetrievalAcceptance = (input: {
  readonly policy: HybridRetrievalAcceptancePolicyV1;
  readonly measurements: unknown;
}): HybridRetrievalAcceptanceReportV1 => {
  const policy = HybridRetrievalAcceptancePolicyV1Schema.parse(input.policy);
  const measurements = HybridRetrievalAcceptanceMeasurementsV1Schema.parse(input.measurements);
  const gates = [
    {
      gateId: "dense-recall-at-5" as const,
      threshold: policy.denseRecallAt5Min,
      observed: measurements.denseRecallAt5,
      passed: measurements.denseRecallAt5 >= policy.denseRecallAt5Min,
      sampleCount: measurements.queryCount,
      boundaryNote: `Recall@${policy.topK} on the fixed synthetic dataset`,
    },
    {
      gateId: "bm25-recall-at-5" as const,
      threshold: policy.bm25RecallAt5Min,
      observed: measurements.bm25RecallAt5,
      passed: measurements.bm25RecallAt5 >= policy.bm25RecallAt5Min,
      sampleCount: measurements.queryCount,
      boundaryNote: `Recall@${policy.topK} on the fixed synthetic dataset`,
    },
    {
      gateId: "rrf-recall-at-5" as const,
      threshold: policy.rrfRecallAt5Min,
      observed: measurements.rrfRecallAt5,
      passed: measurements.rrfRecallAt5 >= policy.rrfRecallAt5Min,
      sampleCount: measurements.queryCount,
      boundaryNote: `Recall@${policy.topK} on the fixed synthetic dataset`,
    },
    {
      gateId: "rrf-ndcg-at-5" as const,
      threshold: policy.rrfNdcgAt5Min,
      observed: measurements.rrfNdcgAt5,
      passed: measurements.rrfNdcgAt5 >= policy.rrfNdcgAt5Min,
      sampleCount: measurements.queryCount,
      boundaryNote: `nDCG@${policy.topK} on the fixed synthetic dataset`,
    },
    {
      gateId: "dual-index-reconciliation" as const,
      threshold: policy.reconciliationRatioMin,
      observed: measurements.reconciliationRatio,
      passed: measurements.reconciliationRatio >= policy.reconciliationRatioMin,
      sampleCount: measurements.memberCount,
      boundaryNote: "member identity/vector/payload parity against the projected manifest",
    },
    {
      gateId: "authorization-leakage" as const,
      threshold: policy.authorizationLeakageMax,
      observed: measurements.authorizationLeakage,
      passed: measurements.authorizationLeakage <= policy.authorizationLeakageMax,
      sampleCount: measurements.queryCount,
      boundaryNote: "leaked protected candidates or body content across authorization boundaries",
    },
    {
      gateId: "qdrant-query-p95-ms" as const,
      threshold: policy.qdrantQueryP95MsMax,
      observed: measurements.qdrantQueryP95Ms,
      passed: measurements.qdrantQueryP95Ms <= policy.qdrantQueryP95MsMax,
      sampleCount: measurements.p95SampleCount,
      boundaryNote: "serial dual-route RRF requests after the query dense vector is ready",
    },
  ];
  return HybridRetrievalAcceptanceReportV1Schema.parse({
    schemaVersion: HYBRID_RETRIEVAL_SCHEMA_VERSION_V1,
    acceptancePolicyRef: policy.acceptancePolicyRef,
    datasetRef: policy.datasetRef,
    syntheticSample: policy.syntheticSample,
    ...(policy.syntheticSample ? { sampleNotice: "合成样本、待甲方复核" } : {}),
    environment: measurements.environment,
    gates,
    overall: gates.every((gate) => gate.passed) ? "passed" : "failed",
    measuredAt: measurements.measuredAt,
  });
};

export type HybridRetrievalFailureContextV1 = {
  readonly stage: HybridRetrievalFailureStageV1;
  readonly code: HybridRetrievalFailureCodeV1;
  readonly retryable?: boolean;
  readonly projectId?: string;
  readonly eventId?: string;
  readonly queryId?: string;
  readonly generationRef?: RetrievalGenerationRefV1;
  readonly detailCode: string;
  readonly contextRefs?: readonly ContractReferenceV1[];
  readonly occurredAt: string;
};

export const hybridRetrievalFailure = (
  context: HybridRetrievalFailureContextV1,
): HybridRetrievalFailureV1 =>
  HybridRetrievalFailureV1Schema.parse({
    schemaVersion: HYBRID_RETRIEVAL_SCHEMA_VERSION_V1,
    stage: context.stage,
    code: context.code,
    retryable: context.retryable ?? false,
    occurredAt: context.occurredAt,
    ...(context.projectId === undefined ? {} : { projectId: context.projectId }),
    ...(context.eventId === undefined ? {} : { eventId: context.eventId }),
    ...(context.queryId === undefined ? {} : { queryId: context.queryId }),
    ...(context.generationRef === undefined ? {} : { generationRef: context.generationRef }),
    detailCode: context.detailCode,
    contextRefs: [...(context.contextRefs ?? [])],
  });

const diagnosticRefFor = (failure: HybridRetrievalFailureV1): DiagnosticArtifactRefV1 => ({
  kind: "diagnostic-artifact",
  reference: {
    entityId: `retrieval-failure:${failure.stage}:${failure.code}`,
    versionId: failure.detailCode,
  },
});

/** 内部结构化失败到公共模块错误的稳定映射；公共错误码集合保持不变。 */
export const mapHybridFailureToModuleError = (input: {
  readonly failure: HybridRetrievalFailureV1;
  readonly causalRunId: string;
  readonly authorizationPolicyRef: VersionReference;
  readonly blockerRef: ContractReferenceV1;
  readonly idempotencyKey?: string;
  readonly priorCommandId?: string;
}): ModuleErrorV1 => {
  const failure = HybridRetrievalFailureV1Schema.parse(input.failure);
  const base = {
    stageCode: `hybrid-retrieval.${failure.stage}`,
    occurredAt: failure.occurredAt,
    causalRunId: input.causalRunId,
  };
  switch (failure.code) {
    case "AUTHORIZATION_DENIED":
    case "AUTHORIZATION_RECONCILIATION_FAILED":
      return {
        ...base,
        code: "AUTHORIZATION_DENIED",
        category: "authorization",
        retryable: false,
        requiredCapability: "knowledge-modeling.retrieve",
        authorizationPolicyRef: input.authorizationPolicyRef,
      };
    case "IDEMPOTENCY_CONFLICT":
      return {
        ...base,
        code: "IDEMPOTENCY_CONFLICT",
        category: "idempotency",
        retryable: false,
        idempotencyKey: input.idempotencyKey ?? failure.detailCode,
        priorCommandId: input.priorCommandId ?? failure.detailCode,
      };
    case "GENERATION_NOT_READY":
    case "POLICY_NOT_FOUND":
    case "POLICY_INCOMPATIBLE":
    case "DUAL_INDEX_MISMATCH":
    case "QUALITY_GATE_FAILED":
    case "ACTIVATION_CONFLICT":
    case "RETRIEVAL_INPUT_DRIFT":
    case "SOURCE_FACT_DRIFT":
      return {
        ...base,
        code: "BUSINESS_BLOCKED",
        category: "business-blocked",
        retryable: false,
        blockerKind: failure.code,
        blockerRef: input.blockerRef,
      };
    case "QDRANT_UNAVAILABLE":
    case "EMBEDDING_FAILED":
    case "RESULT_PERSISTENCE_FAILED":
      return {
        ...base,
        code: "TRANSIENT_FAILURE",
        category: "technical",
        retryable: true,
        attempt: 1,
        retryPolicyRef: input.authorizationPolicyRef,
        diagnosticRef: diagnosticRefFor(failure),
      };
    default:
      return {
        ...base,
        code: "TERMINAL_FAILURE",
        category: "technical",
        retryable: false,
        diagnosticRef: diagnosticRefFor(failure),
      };
  }
};

export const retrievalRequestDigest = (input: {
  readonly refs: HybridRetrievalQueryInputV1["refs"];
  readonly evidenceBaseReleaseRef: HybridRetrievalQueryInputV1["evidenceBaseReleaseRef"];
  readonly generationRef: RetrievalGenerationRefV1;
  readonly policyRef: VersionReference;
  readonly authorizationScopeDigest: string;
  readonly topK: number;
}): string => sha256CanonicalJson(input);

export interface HybridRetrievalServiceOptionsV1 {
  readonly inputReader: HybridRetrievalInputReaderV1;
  readonly generationStore: RetrievalGenerationStoreV1;
  readonly projection: RetrievalProjectionPortV1;
  /** C17 发布事实窄读；正式命中必须经此回查并复验当前权限。 */
  readonly sourceFacts: IdentificationKnowledgeReleaseReaderV1;
  readonly modelGateway: Pick<ModelGatewayPortV1, "embed">;
  readonly artifactStore: ArtifactStoreV1;
  readonly budgetPolicyRef: VersionReference;
  readonly now?: () => Date;
  readonly failureSink?: {
    record(failure: HybridRetrievalFailureV1): Promise<void>;
  };
}

const retrievalEntriesOf = (
  sourceKind: RetrievalSourceKindV1,
  read: IdentificationKnowledgeExactReadV1,
): readonly Readonly<Record<string, unknown>>[] => {
  if (read.package.definitionType !== sourceKind) return [];
  if (read.package.definitionType === "risk-mechanism") return read.package.mechanisms;
  return read.package.entries;
};

const retrievalEntryIdOf = (
  sourceKind: RetrievalSourceKindV1,
  entry: Readonly<Record<string, unknown>>,
): string | undefined => {
  const value = entry[sourceKind === "risk-mechanism" ? "mechanismId" : "entryId"];
  return typeof value === "string" ? value : undefined;
};

const entryEvidenceSourceVersions = (
  entry: Readonly<Record<string, unknown>>,
): readonly { readonly entityId: string; readonly versionId: string }[] => {
  const evidence = entry["evidence"];
  if (!Array.isArray(evidence)) return [];
  const versions: { entityId: string; versionId: string }[] = [];
  for (const item of evidence) {
    if (typeof item !== "object" || item === null) continue;
    const { entityId, versionId } =
      (item as { sourceVersion?: Record<string, unknown> }).sourceVersion ?? {};
    if (typeof entityId === "string" && typeof versionId === "string") {
      versions.push({ entityId, versionId });
    }
  }
  return versions;
};

type HybridQuery = Extract<KnowledgeRetrievalQueryV1, { kind: "hybrid-evidence" }>;

/**
 * 混合检索查询服务（design D6）：当前授权 → 精确代际 → 双路检索 → 事实回查 → 受保护结果。
 * 任一步失败都不返回结果引用，也不降级到单路或旧代际。
 */
const HybridQueryEnvelopeV1Schema = z.strictObject(
  KnowledgeRetrievalQueryV1Schema.options[0].shape,
);

export class HybridRetrievalService {
  readonly #options: HybridRetrievalServiceOptionsV1;
  readonly #now: () => Date;

  constructor(options: HybridRetrievalServiceOptionsV1) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
  }

  async retrieve(query: KnowledgeRetrievalQueryV1): Promise<KnowledgeRetrievalResultV1> {
    const envelope = HybridQueryEnvelopeV1Schema.safeParse(query);
    if (envelope.success) {
      const hybridQuery = envelope.data;
      const authorization = hybridQuery.authorization;
      if (
        authorization.projectId !== hybridQuery.projectId ||
        authorization.actorId !== hybridQuery.actorId ||
        !authorization.grantedCapabilities.includes("knowledge-modeling.retrieve")
      ) {
        return this.#fail(hybridQuery, authorization.authorizationContextRef, {
          stage: "authorization",
          code: "AUTHORIZATION_DENIED",
          detailCode: "query-authorization-mismatch",
          projectId: hybridQuery.projectId,
          queryId: hybridQuery.queryId,
          occurredAt: this.#now().toISOString(),
        });
      }
      const parsed = KnowledgeRetrievalQueryV1Schema.safeParse(hybridQuery);
      if (parsed.success && parsed.data.kind === "hybrid-evidence") {
        return this.#retrieveHybridEvidence(parsed.data);
      }
    }
    // 其他分支由后续 change（C21 等）实现；C20 保持既有公共契约的 UNSUPPORTED_CONTRACT，
    // 并且不把契约不匹配记入检索失败观测（那不是一次检索尝试）。
    const causalRunId =
      typeof (query as { queryId?: unknown }).queryId === "string"
        ? (query as { queryId: string }).queryId
        : "hybrid-retrieval";
    return {
      kind: "failed",
      error: {
        stageCode: "hybrid-retrieval.unsupported_branch",
        occurredAt: this.#now().toISOString(),
        causalRunId,
        code: "UNSUPPORTED_CONTRACT",
        category: "technical",
        retryable: false,
        schemaVersion: HYBRID_RETRIEVAL_SCHEMA_VERSION_V1,
      },
    };
  }

  async #fail(
    query: Pick<HybridQuery, "queryId" | "authorization">,
    blockerRef: ContractReferenceV1,
    context: HybridRetrievalFailureContextV1,
    extra?: { readonly idempotencyKey?: string; readonly priorCommandId?: string },
  ): Promise<KnowledgeRetrievalResultV1> {
    const failure = hybridRetrievalFailure(context);
    await this.#options.failureSink?.record(failure);
    return {
      kind: "failed",
      error: mapHybridFailureToModuleError({
        failure,
        causalRunId: query.queryId,
        authorizationPolicyRef: query.authorization.authorizationPolicyRef,
        blockerRef,
        ...(extra?.idempotencyKey === undefined ? {} : { idempotencyKey: extra.idempotencyKey }),
        ...(extra?.priorCommandId === undefined ? {} : { priorCommandId: extra.priorCommandId }),
      }),
    };
  }

  #failure(
    context: Omit<HybridRetrievalFailureContextV1, "occurredAt">,
  ): HybridRetrievalFailureContextV1 {
    return { ...context, occurredAt: this.#now().toISOString() };
  }

  async #retrieveHybridEvidence(query: HybridQuery): Promise<KnowledgeRetrievalResultV1> {
    const { inputReader, generationStore } = this.#options;
    const callerScopeDigest = authorizationScopeDigest(query.authorization);
    const refs = {
      inputSnapshotRef: query.payload.inputSnapshotRef,
      workItemRef: query.payload.workItemRef,
      retrievalPolicyRef: query.payload.retrievalPolicyRef,
    };
    const read = await inputReader.readExact({
      refs,
      projectId: query.projectId,
      queryId: query.queryId,
      actorId: query.actorId,
      requestedAt: query.requestedAt,
      authorization: query.authorization,
      invocationId: `hybrid-retrieval-input-${query.queryId}`,
    });
    if (read.kind === "failed") {
      return this.#fail(query, refs.inputSnapshotRef, {
        stage: read.code === "AUTHORIZATION_DENIED" ? "authorization" : "query",
        code: read.code,
        detailCode: `input-read-${read.detailCode}`,
        projectId: query.projectId,
        queryId: query.queryId,
        occurredAt: this.#now().toISOString(),
      });
    }

    const frozen = read.input;
    const policy = frozen.policy;
    const sameReference = (left: VersionReference, right: VersionReference): boolean =>
      left.entityId === right.entityId && left.versionId === right.versionId;
    const inputDrift =
      frozen.queryId !== query.queryId ||
      frozen.projectId !== query.projectId ||
      frozen.actorId !== query.actorId ||
      !sameReference(frozen.refs.inputSnapshotRef.reference, refs.inputSnapshotRef.reference) ||
      !sameReference(frozen.refs.workItemRef.reference, refs.workItemRef.reference) ||
      !sameReference(frozen.refs.retrievalPolicyRef, refs.retrievalPolicyRef) ||
      !sameReference(policy.policyRef, refs.retrievalPolicyRef);
    if (inputDrift) {
      return this.#fail(query, refs.inputSnapshotRef, {
        stage: "query",
        code: "RETRIEVAL_INPUT_DRIFT",
        detailCode: "frozen-input-reference-mismatch",
        projectId: query.projectId,
        queryId: query.queryId,
        occurredAt: this.#now().toISOString(),
      });
    }

    const scopeDigest = authorizationScopeDigest(frozen.authorization);
    if (
      scopeDigest !== frozen.authorizationScopeDigest ||
      scopeDigest !== callerScopeDigest ||
      frozen.authorization.projectId !== query.projectId ||
      frozen.authorization.actorId !== query.actorId ||
      !frozen.authorization.grantedCapabilities.includes("knowledge-modeling.retrieve")
    ) {
      return this.#fail(query, refs.inputSnapshotRef, {
        stage: "authorization",
        code: "AUTHORIZATION_RECONCILIATION_FAILED",
        detailCode: "authorization-scope-digest-mismatch",
        projectId: query.projectId,
        queryId: query.queryId,
        occurredAt: this.#now().toISOString(),
      });
    }
    if (
      !sameReference(
        frozen.authorizationContextRef.reference,
        query.authorization.authorizationContextRef.reference,
      )
    ) {
      return this.#fail(query, refs.inputSnapshotRef, {
        stage: "authorization",
        code: "AUTHORIZATION_DENIED",
        detailCode: "stale-authorization-context",
        projectId: query.projectId,
        queryId: query.queryId,
        occurredAt: this.#now().toISOString(),
      });
    }

    const generation = await generationStore.readActiveGeneration({
      projectId: query.projectId,
      evidenceBaseReleaseRef: frozen.evidenceBaseReleaseRef,
      policyRef: policy.policyRef,
      authorizationScopeDigest: frozen.authorizationScopeDigest,
    });
    if (generation === undefined) {
      return this.#fail(query, frozen.evidenceBaseReleaseRef, {
        stage: "query",
        code: "GENERATION_NOT_READY",
        detailCode: "no-active-ready-generation",
        projectId: query.projectId,
        queryId: query.queryId,
        occurredAt: this.#now().toISOString(),
      });
    }

    const requestDigest = retrievalRequestDigest({
      refs: frozen.refs,
      evidenceBaseReleaseRef: frozen.evidenceBaseReleaseRef,
      generationRef: generation.generationRef,
      policyRef: policy.policyRef,
      authorizationScopeDigest: frozen.authorizationScopeDigest,
      topK: policy.topK,
    });
    const existing = await generationStore.readQueryResult({
      projectId: query.projectId,
      queryId: query.queryId,
    });
    if (existing !== undefined) {
      if (existing.requestDigest === requestDigest) {
        return {
          kind: "succeeded",
          result: { knowledgeQueryResultRef: existing.knowledgeQueryResultRef },
        };
      }
      return this.#fail(
        query,
        refs.inputSnapshotRef,
        {
          stage: "query",
          code: "IDEMPOTENCY_CONFLICT",
          detailCode: "query-id-reused-with-different-payload",
          projectId: query.projectId,
          queryId: query.queryId,
          occurredAt: this.#now().toISOString(),
        },
        {
          idempotencyKey: `hybrid-retrieval:${query.projectId}:${query.queryId}`,
          priorCommandId: `hybrid-retrieval:${query.projectId}:${query.queryId}`,
        },
      );
    }

    const embedding = await this.#embedQuery(query, frozen);
    if (embedding.kind === "failed") {
      return this.#fail(query, frozen.evidenceBaseReleaseRef, embedding.failure);
    }
    const hybrid = await this.#queryProjection(query, frozen, generation, embedding.vector);
    if (hybrid.kind === "failed") {
      return this.#fail(query, frozen.evidenceBaseReleaseRef, hybrid.failure);
    }
    const facts = await this.#readHitFacts(query, frozen, generation, hybrid.result);
    if (facts.kind === "failed") {
      return this.#fail(query, frozen.evidenceBaseReleaseRef, facts.failure);
    }
    return this.#persistResult(query, frozen, generation, facts.hits, requestDigest);
  }

  async #embedQuery(
    query: HybridQuery,
    frozen: HybridRetrievalQueryInputV1,
  ): Promise<
    | { readonly kind: "succeeded"; readonly vector: readonly number[] }
    | { readonly kind: "failed"; readonly failure: HybridRetrievalFailureContextV1 }
  > {
    const policy = frozen.policy;
    const now = this.#now();
    const failure = (code: HybridRetrievalFailureCodeV1, detailCode: string, retryable = false) =>
      this.#failure({
        stage: "embedding",
        code,
        detailCode,
        retryable,
        projectId: query.projectId,
        queryId: query.queryId,
      });
    let embedding;
    try {
      embedding = await this.#options.modelGateway.embed(
        EmbeddingRequestV1Schema.parse({
          schemaVersion: "1",
          invocationId: `hybrid-retrieval-embed-${query.queryId}`,
          idempotencyKey: `hybrid-retrieval-embed:${query.projectId}:${query.queryId}`,
          issuedAt: now.toISOString(),
          projectId: query.projectId,
          actorId: query.actorId,
          authorization: frozen.authorization,
          requiredCapability: "knowledge-modeling.retrieve",
          modelDeploymentRef: policy.modelDeploymentRef,
          budgetPolicyRef: this.#options.budgetPolicyRef,
          deadlineAt: new Date(now.getTime() + policy.embeddingTimeoutMs).toISOString(),
          parentArtifactRefs: [],
          evidenceReferences: [],
          texts: [frozen.queryText],
          maxInputBytes: policy.memberByteLimit,
          maxBatchItems: 1,
        }),
        AbortSignal.timeout(policy.embeddingTimeoutMs),
      );
    } catch {
      return {
        kind: "failed",
        failure: failure("EMBEDDING_FAILED", "query-embedding-call-failed", true),
      };
    }
    const vector = embedding.vectors[0];
    if (
      embedding.modelDeploymentRef.entityId !== policy.modelDeploymentRef.entityId ||
      embedding.modelDeploymentRef.versionId !== policy.modelDeploymentRef.versionId
    ) {
      return {
        kind: "failed",
        failure: failure("POLICY_INCOMPATIBLE", "embedding-deployment-mismatch"),
      };
    }
    if (
      embedding.dimensions !== policy.dense.dimensions ||
      vector === undefined ||
      vector.length !== policy.dense.dimensions
    ) {
      return {
        kind: "failed",
        failure: failure("EMBEDDING_DIMENSION_MISMATCH", "query-embedding-dimensions"),
      };
    }
    return { kind: "succeeded", vector };
  }

  async #queryProjection(
    query: HybridQuery,
    frozen: HybridRetrievalQueryInputV1,
    generation: RetrievalGenerationV1,
    vector: readonly number[],
  ): Promise<
    | { readonly kind: "succeeded"; readonly result: RetrievalHybridQueryResultV1 }
    | { readonly kind: "failed"; readonly failure: HybridRetrievalFailureContextV1 }
  > {
    const policy = frozen.policy;
    const failure = (code: HybridRetrievalFailureCodeV1, detailCode: string, retryable = false) =>
      this.#failure({
        stage: code === "QDRANT_UNAVAILABLE" ? "projection" : "reconciliation",
        code,
        detailCode,
        retryable,
        projectId: query.projectId,
        queryId: query.queryId,
        generationRef: generation.generationRef,
      });
    let result: RetrievalHybridQueryResultV1;
    try {
      result = await this.#options.projection.queryHybrid(
        RetrievalHybridQueryV1Schema.parse({
          collectionName: generation.collectionName,
          generationRef: generation.generationRef,
          queryDenseVector: [...vector],
          queryText: frozen.queryText,
          policy,
          filter: {
            projectId: query.projectId,
            generationRef: generation.generationRef,
            authorizationScopeDigest: frozen.authorizationScopeDigest,
          },
        }),
      );
    } catch {
      return {
        kind: "failed",
        failure: failure("QDRANT_UNAVAILABLE", "hybrid-query-unavailable", true),
      };
    }
    if (
      result.collectionName !== generation.collectionName ||
      result.generationRef.reference.versionId !== generation.generationRef.reference.versionId
    ) {
      return {
        kind: "failed",
        failure: failure("DUAL_INDEX_MISMATCH", "query-generation-mismatch"),
      };
    }
    const reconciliation = reconcileRrfResult({ policy, result });
    if (!reconciliation.consistent) {
      return {
        kind: "failed",
        failure: failure(
          "FUSION_RECONCILIATION_FAILED",
          reconciliation.differences[0]?.detailCode ?? "fusion-mismatch",
        ),
      };
    }
    return { kind: "succeeded", result };
  }

  async #readHitFacts(
    query: HybridQuery,
    frozen: HybridRetrievalQueryInputV1,
    generation: RetrievalGenerationV1,
    hybrid: RetrievalHybridQueryResultV1,
  ): Promise<
    | { readonly kind: "succeeded"; readonly hits: readonly HybridRetrievalHitV1[] }
    | { readonly kind: "failed"; readonly failure: HybridRetrievalFailureContextV1 }
  > {
    const policy = frozen.policy;
    const denseRanks = new Map(hybrid.denseRoute.map((hit) => [hit.pointId, hit.rank]));
    const bm25Ranks = new Map(hybrid.bm25Route.map((hit) => [hit.pointId, hit.rank]));
    const reads = new Map<string, IdentificationKnowledgeExactReadV1>();
    const hits: HybridRetrievalHitV1[] = [];
    const factualFailure = (
      stage: HybridRetrievalFailureStageV1,
      code: HybridRetrievalFailureCodeV1,
      detailCode: string,
    ) =>
      this.#failure({
        stage,
        code,
        detailCode,
        projectId: query.projectId,
        queryId: query.queryId,
        generationRef: hybrid.generationRef,
      });

    for (const [index, hit] of hybrid.fused.slice(0, policy.topK).entries()) {
      const payload = hit.payload;
      const expectedRelease =
        generation.identity.memberReleaseRefs[
          payload.sourceKind === "risk-mechanism"
            ? "riskMechanismRef"
            : payload.sourceKind === "standard-library"
              ? "standardLibraryRef"
              : "caseLibraryRef"
        ];
      if (
        payload.generationRef.reference.versionId !== hybrid.generationRef.reference.versionId ||
        payload.projectId !== query.projectId ||
        payload.authorizationScopeDigest !== frozen.authorizationScopeDigest
      ) {
        return {
          kind: "failed",
          failure: factualFailure(
            "authorization",
            "AUTHORIZATION_RECONCILIATION_FAILED",
            "candidate-scope-mismatch",
          ),
        };
      }
      if (
        payload.sourceReleaseRef.reference.entityId !== expectedRelease.reference.entityId ||
        payload.sourceReleaseRef.reference.versionId !== expectedRelease.reference.versionId ||
        hit.pointId !==
          retrievalMemberPointId(
            sha256CanonicalJson(
              retrievalMemberRefFor({
                generationRef: generation.generationRef,
                sourceKind: payload.sourceKind,
                sourceReleaseRef: payload.sourceReleaseRef,
                sourceEntryId: payload.sourceEntryId,
                contentDigest: payload.contentDigest,
              }),
            ),
          )
      ) {
        return {
          kind: "failed",
          failure: factualFailure(
            "reconciliation",
            "SOURCE_FACT_DRIFT",
            "candidate-member-mismatch",
          ),
        };
      }
      const releaseKey = `${payload.sourceReleaseRef.reference.entityId}/${payload.sourceReleaseRef.reference.versionId}`;
      let read = reads.get(releaseKey);
      if (read === undefined) {
        const outcome = await this.#options.sourceFacts.readExact({
          projectId: query.projectId,
          releaseRef: payload.sourceReleaseRef,
          actorId: query.actorId,
          requestedAt: this.#now().toISOString(),
          invocationId: `hybrid-retrieval-fact-${query.queryId}`,
          authorization: frozen.authorization,
        });
        if (outcome.kind === "failed") {
          return {
            kind: "failed",
            failure:
              outcome.error.code === "AUTHORIZATION_DENIED"
                ? factualFailure(
                    "authorization",
                    "AUTHORIZATION_RECONCILIATION_FAILED",
                    "fact-read-authorization-denied",
                  )
                : factualFailure(
                    "source-read",
                    "SOURCE_FACT_DRIFT",
                    `fact-read-${outcome.error.code}`,
                  ),
          };
        }
        read = outcome.read;
        reads.set(releaseKey, read);
      }
      const entry = retrievalEntriesOf(payload.sourceKind, read).find(
        (candidate) => retrievalEntryIdOf(payload.sourceKind, candidate) === payload.sourceEntryId,
      );
      if (entry === undefined) {
        return {
          kind: "failed",
          failure: factualFailure("source-read", "SOURCE_FACT_DRIFT", "source-entry-missing"),
        };
      }
      if (
        retrievalMemberContentDigest(retrievalMemberText(payload.sourceKind, entry)) !==
        payload.contentDigest
      ) {
        return {
          kind: "failed",
          failure: factualFailure("reconciliation", "SOURCE_FACT_DRIFT", "content-digest-drift"),
        };
      }
      const denseRank = denseRanks.get(hit.pointId);
      const bm25Rank = bm25Ranks.get(hit.pointId);
      hits.push({
        rank: index + 1,
        memberRef: retrievalMemberRefFor({
          generationRef: hybrid.generationRef,
          sourceKind: payload.sourceKind,
          sourceReleaseRef: payload.sourceReleaseRef,
          sourceEntryId: payload.sourceEntryId,
          contentDigest: payload.contentDigest,
        }),
        sourceKind: payload.sourceKind,
        sourceReleaseRef: payload.sourceReleaseRef,
        sourceEntryId: payload.sourceEntryId,
        contentDigest: payload.contentDigest,
        evidenceSourceVersionRefs: [...entryEvidenceSourceVersions(entry)],
        ...(denseRank === undefined ? {} : { denseRank }),
        ...(bm25Rank === undefined ? {} : { bm25Rank }),
        denseContribution:
          denseRank === undefined
            ? 0
            : rrfContribution(policy.rrf.denseWeight, policy.rrf.k, denseRank),
        bm25Contribution:
          bm25Rank === undefined
            ? 0
            : rrfContribution(policy.rrf.bm25Weight, policy.rrf.k, bm25Rank),
        fusionScore: hit.score,
      });
    }
    return { kind: "succeeded", hits };
  }

  async #persistResult(
    query: HybridQuery,
    frozen: HybridRetrievalQueryInputV1,
    generation: RetrievalGenerationV1,
    hits: readonly HybridRetrievalHitV1[],
    requestDigest: string,
  ): Promise<KnowledgeRetrievalResultV1> {
    const policy = frozen.policy;
    const knowledgeQueryResultRef: KnowledgeQueryResultRefV1 = {
      kind: "knowledge-query-result",
      reference: {
        entityId: `retrieval-query-result:${query.projectId}:${query.queryId}`,
        versionId: requestDigest,
      },
    };
    const completedAt = this.#now().toISOString();
    // 先按类型装配再运行期校验：两者不一致时在编译期就暴露，而不是等 parse 抛错。
    const payloadValue: HybridRetrievalResultPayloadV1 = {
      schemaVersion: HYBRID_RETRIEVAL_SCHEMA_VERSION_V1,
      queryId: query.queryId,
      projectId: query.projectId,
      actorId: query.actorId,
      requestedAt: query.requestedAt,
      completedAt,
      refs: frozen.refs,
      evidenceBaseReleaseRef: frozen.evidenceBaseReleaseRef,
      memberReleaseRefs: generation.identity.memberReleaseRefs,
      generationRef: generation.generationRef,
      collectionName: generation.collectionName,
      projectionCompatibilityRef: policy.projectionCompatibilityRef,
      policyRef: policy.policyRef,
      modelDeploymentRef: policy.modelDeploymentRef,
      embeddingDimensions: policy.dense.dimensions,
      // 结果记录 BM25 配置本身；向量名属于策略，不重复进入结果载荷。
      bm25: {
        model: policy.bm25.model,
        tokenizer: policy.bm25.tokenizer,
        language: policy.bm25.language,
        stemmer: policy.bm25.stemmer,
        stopwords: policy.bm25.stopwords,
      },
      rrf: policy.rrf,
      densePrefetchLimit: policy.densePrefetchLimit,
      bm25PrefetchLimit: policy.bm25PrefetchLimit,
      topK: policy.topK,
      authorizationScopeDigest: frozen.authorizationScopeDigest,
      authorizationContextRef: frozen.authorizationContextRef,
      hits: [...hits],
      scoreSemantics: HYBRID_RETRIEVAL_SCORE_SEMANTICS_V1,
      knowledgeQueryResultRef,
    };
    const payload = HybridRetrievalResultPayloadV1Schema.parse(payloadValue);
    let artifactRef;
    try {
      const put = await this.#options.artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: `hybrid-retrieval-result-${query.projectId}-${query.queryId}`,
          idempotencyKey: `hybrid-retrieval-result:${query.projectId}:${query.queryId}`,
          projectId: query.projectId,
          actorId: query.actorId,
          issuedAt: completedAt,
          authorization: frozen.authorization,
          requiredCapability: "knowledge-modeling.retrieve",
          artifactId: `hybrid-retrieval-result-${query.queryId}`,
          artifactKind: "content",
          purposeCode: "hybrid-retrieval-query-result",
          mediaType: "application/json",
          parentArtifactRefs: [],
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        (async function* () {
          yield Buffer.from(canonicalJson(payload), "utf8");
        })(),
      );
      artifactRef = put.artifactRef;
    } catch {
      return this.#fail(query, frozen.evidenceBaseReleaseRef, {
        stage: "result-persistence",
        code: "RESULT_PERSISTENCE_FAILED",
        detailCode: "result-artifact-put-failed",
        retryable: true,
        projectId: query.projectId,
        queryId: query.queryId,
        generationRef: generation.generationRef,
        occurredAt: this.#now().toISOString(),
      });
    }

    let registered;
    try {
      registered = await this.#options.generationStore.registerQueryResult({
        projectId: query.projectId,
        queryId: query.queryId,
        requestDigest,
        generationRef: generation.generationRef,
        policyRef: policy.policyRef,
        authorizationScopeDigest: frozen.authorizationScopeDigest,
        resultArtifactRef: artifactRef,
        knowledgeQueryResultRef,
        recordedAt: completedAt,
        actorRef: query.actorId,
        authorizationContextRef: frozen.authorizationContextRef,
      });
    } catch {
      return this.#fail(query, frozen.evidenceBaseReleaseRef, {
        stage: "result-persistence",
        code: "RESULT_PERSISTENCE_FAILED",
        detailCode: "result-registration-failed",
        retryable: true,
        projectId: query.projectId,
        queryId: query.queryId,
        generationRef: generation.generationRef,
        occurredAt: this.#now().toISOString(),
      });
    }
    if (registered.kind === "idempotency-conflict") {
      return this.#fail(
        query,
        frozen.evidenceBaseReleaseRef,
        {
          stage: "result-persistence",
          code: "IDEMPOTENCY_CONFLICT",
          detailCode: "query-id-reused-with-different-payload",
          projectId: query.projectId,
          queryId: query.queryId,
          generationRef: generation.generationRef,
          occurredAt: this.#now().toISOString(),
        },
        {
          idempotencyKey: `hybrid-retrieval:${query.projectId}:${query.queryId}`,
          priorCommandId: `hybrid-retrieval:${query.projectId}:${query.queryId}`,
        },
      );
    }
    return { kind: "succeeded", result: { knowledgeQueryResultRef } };
  }
}
