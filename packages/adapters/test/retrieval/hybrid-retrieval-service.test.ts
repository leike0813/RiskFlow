import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AuthorizationContextV1Schema,
  KnowledgeRetrievalQueryV1Schema,
  type AuthorizationContextV1,
  type KnowledgeReleaseRefV1,
  type KnowledgeRetrievalQueryV1,
  type KnowledgeRetrievalResultV1,
  type ModuleErrorV1,
  type RetrievalEvidenceBaseReleaseRefV1,
} from "@riskflow/contracts/ports";
import {
  ArtifactPutResultV1Schema,
  type ArtifactPutCommandV1,
  type ArtifactPutResultV1,
  type ArtifactRefV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  CaseLibraryPackageV1Schema,
  IdentificationKnowledgeReleaseBindingV1Schema,
  IdentificationKnowledgeValidationReceiptV1Schema,
  RiskMechanismPackageV1Schema,
  StandardLibraryPackageV1Schema,
  type CaseLibraryPackageV1,
  type IdentificationKnowledgeExactReadV1,
  type IdentificationKnowledgeReleaseReaderV1,
  type RiskMechanismPackageV1,
  type StandardLibraryPackageV1,
} from "@riskflow/core/identification-knowledge";
import {
  EmbeddingResultV1Schema,
  type EmbeddingRequestV1,
  type EmbeddingResultV1,
  type ModelGatewayPortV1,
} from "@riskflow/core/model";
import { sha256CanonicalJson } from "@riskflow/core/persistence";
import {
  HybridRetrievalPolicyV1Schema,
  HybridRetrievalResultPayloadV1Schema,
  HybridRetrievalService,
  RetrievalGenerationV1Schema,
  RetrievalHybridQueryResultV1Schema,
  RetrievalPointPayloadV1Schema,
  authorizationScopeDigest,
  retrievalCollectionNameFor,
  retrievalGenerationRefFor,
  retrievalMemberContentDigest,
  retrievalMemberPointId,
  retrievalMemberRefFor,
  retrievalMemberText,
  rrfContribution,
  type HybridRetrievalFailureV1,
  type HybridRetrievalInputReaderV1,
  type HybridRetrievalQueryInputV1,
  type RetrievalGenerationRefV1,
  type RetrievalGenerationStoreV1,
  type RetrievalGenerationV1,
  type RetrievalHybridQueryV1,
  type RetrievalHybridQueryResultV1,
  type RetrievalMemberRefV1,
  type RetrievalPointPayloadV1,
  type RetrievalProjectionPortV1,
  type RetrievalSourceKindV1,
} from "@riskflow/core/retrieval";

/**
 * C20 查询服务在端口边界上的行为证据（IP-06 / V-05）。
 * 全部替身只实现端口接口；真实 Qdrant/PostgreSQL 由 adapter 容器测试覆盖，
 * 本文件既不伪造外部服务成功，也不触碰 core 内部实现细节。
 */

const PROJECT_ID = "project-c20";
const ACTOR_ID = "actor-c20";
const TIMESTAMP = "2026-09-21T00:00:00.000Z";
const HEX_ZERO = "0".repeat(64);
const HEX_LOW = "1".repeat(64);
const EMBEDDING_DIMENSIONS = 4;

const POLICY_REF = { entityId: "retrieval-policy", versionId: "1" };
const MODEL_DEPLOYMENT_REF = { entityId: "embedding-deployment", versionId: "1" };
const PROJECTION_COMPATIBILITY_REF = {
  entityId: "retrieval-projection-compatibility",
  versionId: "qdrant-1.19-0123456789abcdef",
};
const VALIDATION_POLICY_REF = {
  entityId: "identification-knowledge-validation-policy",
  versionId: "1",
};
const PREPARATION_SNAPSHOT_REF = {
  kind: "identification-preparation-snapshot" as const,
  reference: { entityId: "preparation-snapshot-1", versionId: "1" },
};
const BUDGET_POLICY_REF = { entityId: "budget-policy", versionId: "1" };

const EVIDENCE_BASE_RELEASE_REF: RetrievalEvidenceBaseReleaseRefV1 = {
  kind: "retrieval-evidence-base-release",
  reference: { entityId: "retrieval-evidence-base-release", versionId: "1" },
};

const RISK_MECHANISM_RELEASE_REF: KnowledgeReleaseRefV1 = {
  kind: "knowledge-release",
  reference: { entityId: "release-risk-mechanism", versionId: "1" },
};
const STANDARD_LIBRARY_RELEASE_REF: KnowledgeReleaseRefV1 = {
  kind: "knowledge-release",
  reference: { entityId: "release-standard-library", versionId: "1" },
};
const CASE_LIBRARY_RELEASE_REF: KnowledgeReleaseRefV1 = {
  kind: "knowledge-release",
  reference: { entityId: "release-case-library", versionId: "1" },
};

const RELEASE_REFS: Readonly<Record<RetrievalSourceKindV1, KnowledgeReleaseRefV1>> = {
  "risk-mechanism": RISK_MECHANISM_RELEASE_REF,
  "standard-library": STANDARD_LIBRARY_RELEASE_REF,
  "case-library": CASE_LIBRARY_RELEASE_REF,
};

const DEFAULT_ENTRY_IDS: Readonly<Record<RetrievalSourceKindV1, string>> = {
  "risk-mechanism": "mechanism-1",
  "standard-library": "standard-1",
  "case-library": "case-1",
};

const APPLICABILITY = {
  constructionMethod: ["variable-diameter-shield"],
  stratumCondition: ["soft-soil"],
  engineeringStage: ["expansion-preparation"],
};

const EVIDENCE = [
  {
    locator: { sourceSegmentId: "source-segment-1" },
    sourceVersion: { entityId: "source-version-1", versionId: "1" },
  },
];

const policy = HybridRetrievalPolicyV1Schema.parse({
  schemaVersion: "1",
  policyRef: POLICY_REF,
  evidenceBaseDefinitionType: "retrieval-evidence-base",
  modelDeploymentRef: MODEL_DEPLOYMENT_REF,
  dense: { vectorName: "dense", dimensions: EMBEDDING_DIMENSIONS, distance: "cosine" },
  bm25: {
    vectorName: "bm25",
    model: "qdrant/bm25",
    tokenizer: "multilingual",
    language: "chinese",
    stemmer: "none",
    stopwords: [],
  },
  densePrefetchLimit: 8,
  bm25PrefetchLimit: 8,
  topK: 3,
  rrf: { k: 60, denseWeight: 1, bm25Weight: 1 },
  memberBatchLimit: 8,
  memberByteLimit: 65_536,
  memberLimit: 64,
  embeddingTimeoutMs: 5_000,
  projectionTimeoutMs: 5_000,
  acceptancePolicyRef: { entityId: "retrieval-acceptance-policy", versionId: "1" },
  projectionCompatibilityRef: PROJECTION_COMPATIBILITY_REF,
});

const AUTHORIZATION_CONTEXT_REF = {
  kind: "authorization-context" as const,
  reference: { entityId: "authorization-context-1", versionId: "1" },
};

const makeAuthorization = (spatialScopeId: string): AuthorizationContextV1 =>
  AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: AUTHORIZATION_CONTEXT_REF,
    actorId: ACTOR_ID,
    projectId: PROJECT_ID,
    grantedCapabilities: ["knowledge-modeling.retrieve"],
    spatialScopeRefs: [
      { kind: "spatial-scope", reference: { entityId: spatialScopeId, versionId: "1" } },
    ],
    sourceAccessGrantRefs: [
      {
        kind: "source-access-grant",
        reference: { entityId: "source-access-grant-1", versionId: "1" },
      },
    ],
    authorizationPolicyRef: { entityId: "authorization-policy", versionId: "1" },
    decidedAt: TIMESTAMP,
    invocation: { kind: "human" },
  });

const authorization = makeAuthorization("spatial-scope-1");
const scopeDigest = authorizationScopeDigest(authorization);

const INPUT_REFS = {
  inputSnapshotRef: {
    kind: "identification-input-snapshot" as const,
    reference: { entityId: "input-snapshot-1", versionId: "1" },
  },
  workItemRef: {
    kind: "identification-work-item" as const,
    reference: { entityId: "work-item-1", versionId: "1" },
  },
  retrievalPolicyRef: POLICY_REF,
};

const QUERY_ID = "query-1";
const QUERY_TEXT = "盾构扩径施工掌子面稳定性失效机理";
const QUERY_INSTRUCTION =
  "Given a Chinese engineering risk query, retrieve the applicable standard clauses";

const makeQuery = (queryId: string = QUERY_ID): KnowledgeRetrievalQueryV1 =>
  KnowledgeRetrievalQueryV1Schema.parse({
    queryId,
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    requestedAt: TIMESTAMP,
    authorization,
    kind: "hybrid-evidence",
    payload: INPUT_REFS,
  });

const makeFrozenInput = (
  overrides: Partial<HybridRetrievalQueryInputV1> = {},
): HybridRetrievalQueryInputV1 =>
  ({
    schemaVersion: "1",
    queryId: QUERY_ID,
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    requestedAt: TIMESTAMP,
    refs: INPUT_REFS,
    evidenceBaseReleaseRef: EVIDENCE_BASE_RELEASE_REF,
    policy,
    queryText: QUERY_TEXT,
    authorizationScopeDigest: scopeDigest,
    authorizationContextRef: AUTHORIZATION_CONTEXT_REF,
    authorization,
    ...overrides,
  }) as HybridRetrievalQueryInputV1;

const generationRef: RetrievalGenerationRefV1 = retrievalGenerationRefFor({
  projectId: PROJECT_ID,
  sourceEventId: "identification-basis-event-1",
  evidenceBaseReleaseRef: EVIDENCE_BASE_RELEASE_REF,
  memberReleaseRefs: {
    riskMechanismRef: RISK_MECHANISM_RELEASE_REF,
    standardLibraryRef: STANDARD_LIBRARY_RELEASE_REF,
    caseLibraryRef: CASE_LIBRARY_RELEASE_REF,
  },
  policyRef: policy.policyRef,
  modelDeploymentRef: policy.modelDeploymentRef,
  projectionCompatibilityRef: policy.projectionCompatibilityRef,
});

const generation = RetrievalGenerationV1Schema.parse({
  schemaVersion: "1",
  generationRef,
  identity: {
    projectId: PROJECT_ID,
    sourceEventId: "identification-basis-event-1",
    evidenceBaseReleaseRef: EVIDENCE_BASE_RELEASE_REF,
    memberReleaseRefs: {
      riskMechanismRef: RISK_MECHANISM_RELEASE_REF,
      standardLibraryRef: STANDARD_LIBRARY_RELEASE_REF,
      caseLibraryRef: CASE_LIBRARY_RELEASE_REF,
    },
    policyRef: policy.policyRef,
    modelDeploymentRef: policy.modelDeploymentRef,
    projectionCompatibilityRef: policy.projectionCompatibilityRef,
  },
  collectionName: retrievalCollectionNameFor(generationRef),
  authorizationScopeDigest: scopeDigest,
  expectedMemberCount: 3,
  manifestSha256: HEX_ZERO,
  createdAt: TIMESTAMP,
  createdBy: ACTOR_ID,
  authorizationContextRef: AUTHORIZATION_CONTEXT_REF,
});

// ------------------------------------------------------------------ C17 事实替身

const entryFor = (
  sourceKind: RetrievalSourceKindV1,
  entryId: string,
): Readonly<Record<string, unknown>> => {
  if (sourceKind === "risk-mechanism") {
    return {
      mechanismId: entryId,
      mechanismType: "掌子面稳定性失效",
      nodeIds: ["node-1"],
      stateParameters: ["土仓/泥水压力"],
      monitoringIndicators: ["地表沉降"],
      applicability: APPLICABILITY,
      preconditions: ["precondition-1"],
      triggeringFactors: ["trigger-1"],
      evolutionPath: ["path-1"],
      consequences: ["consequence-1"],
      evidence: EVIDENCE,
    };
  }
  if (sourceKind === "standard-library") {
    return {
      entryId,
      level: "national",
      standardIdentity: "GB-50446",
      standardVersion: "2025",
      clauseRefs: ["clause-3.2"],
      applicability: APPLICABILITY,
      evidence: EVIDENCE,
    };
  }
  return {
    entryId,
    constructionMethod: "variable-diameter-shield",
    engineeringConditions: ["condition-1"],
    process: ["process-1"],
    events: ["event-1"],
    outcomes: ["outcome-1"],
    treatments: ["treatment-1"],
    applicability: APPLICABILITY,
    evidence: EVIDENCE,
  };
};

type RetrievalPackageV1 = RiskMechanismPackageV1 | StandardLibraryPackageV1 | CaseLibraryPackageV1;

const packageFor = (
  sourceKind: RetrievalSourceKindV1,
  entry: Readonly<Record<string, unknown>>,
): RetrievalPackageV1 => {
  const header = {
    schemaVersion: "1" as const,
    projectId: PROJECT_ID,
    validationPolicyRef: VALIDATION_POLICY_REF,
    preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
    generatedAt: TIMESTAMP,
  };
  if (sourceKind === "risk-mechanism") {
    return RiskMechanismPackageV1Schema.parse({
      ...header,
      definitionType: "risk-mechanism",
      processModelReleaseRef: {
        kind: "process-model-release",
        reference: { entityId: "process-model-release", versionId: "1" },
      },
      mechanisms: [entry],
    });
  }
  if (sourceKind === "standard-library") {
    return StandardLibraryPackageV1Schema.parse({
      ...header,
      definitionType: "standard-library",
      entries: [entry],
    });
  }
  return CaseLibraryPackageV1Schema.parse({
    ...header,
    definitionType: "case-library",
    entries: [entry],
  });
};

const exactReadFor = (
  sourceKind: RetrievalSourceKindV1,
  pkg: RetrievalPackageV1,
  releaseRef: KnowledgeReleaseRefV1,
): IdentificationKnowledgeExactReadV1 => ({
  package: pkg,
  validation: IdentificationKnowledgeValidationReceiptV1Schema.parse({
    schemaVersion: "1",
    projectId: PROJECT_ID,
    definitionType: sourceKind,
    packageDigest: HEX_ZERO,
    validationPolicyRef: VALIDATION_POLICY_REF,
    preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
    items: [
      {
        checkId: "check-1",
        targetKind: "package",
        targetId: `${sourceKind}-package`,
        disposition: "accepted",
        reasonCode: "accepted",
        evidenceReferences: [],
      },
    ],
    disposition: "accepted",
    validationArtifactRef: {
      kind: "content-artifact",
      reference: { entityId: "validation-artifact", versionId: `sha256:${HEX_ZERO}` },
    },
    validatedAt: TIMESTAMP,
  }),
  releaseBinding: IdentificationKnowledgeReleaseBindingV1Schema.parse({
    schemaVersion: "1",
    projectId: PROJECT_ID,
    definitionType: sourceKind,
    releaseRef,
    revisionRef: {
      kind: "knowledge-revision",
      reference: { entityId: `revision-${sourceKind}`, versionId: "1" },
    },
    candidateArtifactRef: {
      kind: "content-artifact",
      reference: { entityId: `candidate-${sourceKind}`, versionId: `sha256:${HEX_ZERO}` },
    },
    boundAt: TIMESTAMP,
  }),
});

interface MemberFixtureV1 {
  readonly sourceKind: RetrievalSourceKindV1;
  readonly sourceReleaseRef: KnowledgeReleaseRefV1;
  readonly sourceEntryId: string;
  readonly contentDigest: string;
  readonly pointId: string;
  readonly memberRef: RetrievalMemberRefV1;
  readonly exactRead: IdentificationKnowledgeExactReadV1;
}

const buildMember = (
  sourceKind: RetrievalSourceKindV1,
  sourceEntryId: string = DEFAULT_ENTRY_IDS[sourceKind],
  // 允许测试替换条目内容或标识，用于制造内容漂移与条目缺失。
  entry: Readonly<Record<string, unknown>> = entryFor(sourceKind, sourceEntryId),
): MemberFixtureV1 => {
  const sourceReleaseRef = RELEASE_REFS[sourceKind];
  const pkg = packageFor(sourceKind, entry);
  // 摘要按 Zod 解析后的条目计算：与 service 回查时看到的是同一形状。
  const parsedEntry =
    pkg.definitionType === "risk-mechanism" ? pkg.mechanisms[0]! : pkg.entries[0]!;
  const text = retrievalMemberText(sourceKind, parsedEntry);
  const contentDigest = retrievalMemberContentDigest(text);
  const memberRef = retrievalMemberRefFor({
    generationRef,
    sourceKind,
    sourceReleaseRef,
    sourceEntryId,
    contentDigest,
  });
  return {
    sourceKind,
    sourceReleaseRef,
    sourceEntryId,
    contentDigest,
    pointId: retrievalMemberPointId(sha256CanonicalJson(memberRef)),
    memberRef,
    exactRead: exactReadFor(sourceKind, pkg, sourceReleaseRef),
  };
};

const MEMBERS = [
  buildMember("risk-mechanism"),
  buildMember("standard-library"),
  buildMember("case-library"),
];
const memberScopeDigest = sha256CanonicalJson(MEMBERS.map((member) => member.pointId).sort());

const memberOf = (sourceKind: RetrievalSourceKindV1): MemberFixtureV1 => {
  const member = MEMBERS.find((candidate) => candidate.sourceKind === sourceKind);
  if (member === undefined) throw new Error(`missing member fixture ${sourceKind}`);
  return member;
};

const payloadFor = (
  member: MemberFixtureV1,
  overrides: Partial<RetrievalPointPayloadV1> = {},
): RetrievalPointPayloadV1 =>
  RetrievalPointPayloadV1Schema.parse({
    schemaVersion: "1",
    projectId: PROJECT_ID,
    generationRef,
    generationKey: generationRef.reference.versionId,
    sourceKind: member.sourceKind,
    sourceReleaseRef: member.sourceReleaseRef,
    sourceEntryId: member.sourceEntryId,
    contentDigest: member.contentDigest,
    authorizationScopeDigest: scopeDigest,
    ...overrides,
  });

// 双路名次：dense 命中机理与标准，bm25 命中案例与机理，同时覆盖互补与重叠成员。
const DENSE_RANKS: Readonly<Record<string, number>> = {
  [memberOf("risk-mechanism").pointId]: 1,
  [memberOf("standard-library").pointId]: 2,
};
const BM25_RANKS: Readonly<Record<string, number>> = {
  [memberOf("case-library").pointId]: 1,
  [memberOf("risk-mechanism").pointId]: 2,
};

const fusionFor = (
  overrides: Partial<RetrievalHybridQueryResultV1> = {},
): RetrievalHybridQueryResultV1 =>
  RetrievalHybridQueryResultV1Schema.parse({
    collectionName: generation.collectionName,
    generationRef,
    serviceVersion: "1.19.0",
    // 顺序按策略 RRF 贡献降序：机理(1/61+1/62) > 案例(1/61) > 标准(1/62)。
    fused: [
      {
        pointId: memberOf("risk-mechanism").pointId,
        rank: 1,
        score: 0.0325,
        payload: payloadFor(memberOf("risk-mechanism")),
      },
      {
        pointId: memberOf("case-library").pointId,
        rank: 2,
        score: 0.0164,
        payload: payloadFor(memberOf("case-library")),
      },
      {
        pointId: memberOf("standard-library").pointId,
        rank: 3,
        score: 0.0161,
        payload: payloadFor(memberOf("standard-library")),
      },
    ],
    denseRoute: [
      { pointId: memberOf("risk-mechanism").pointId, rank: 1, score: 0.91 },
      { pointId: memberOf("standard-library").pointId, rank: 2, score: 0.88 },
    ],
    bm25Route: [
      { pointId: memberOf("case-library").pointId, rank: 1, score: 12.4 },
      { pointId: memberOf("risk-mechanism").pointId, rank: 2, score: 11.1 },
    ],
    fusedQueryDurationMs: 12.5,
    ...overrides,
  });

// ------------------------------------------------------------------ 端口替身

type ReadActiveInput = Parameters<RetrievalGenerationStoreV1["readActiveGeneration"]>[0];
type RegisterInput = Parameters<RetrievalGenerationStoreV1["registerQueryResult"]>[0];
type ReadExactInput = Parameters<IdentificationKnowledgeReleaseReaderV1["readExact"]>[0];
type QueryInputReadInput = Parameters<HybridRetrievalInputReaderV1["readExact"]>[0];

interface StoredQueryResultV1 {
  readonly requestDigest: string;
  readonly knowledgeQueryResultRef: {
    readonly kind: "knowledge-query-result";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
  readonly resultArtifactRef: ArtifactRefV1;
}

class StubInputReader implements HybridRetrievalInputReaderV1 {
  input: HybridRetrievalQueryInputV1 = makeFrozenInput();
  failure:
    | {
        readonly code: "AUTHORIZATION_DENIED" | "POLICY_NOT_FOUND" | "RETRIEVAL_INPUT_DRIFT";
        readonly detailCode: string;
      }
    | undefined = undefined;
  readonly calls: QueryInputReadInput[] = [];

  async readExact(input: QueryInputReadInput) {
    this.calls.push(input);
    if (this.failure !== undefined) {
      return {
        kind: "failed" as const,
        code: this.failure.code,
        detailCode: this.failure.detailCode,
      };
    }
    return { kind: "succeeded" as const, input: this.input };
  }
}

class StubGenerationStore implements RetrievalGenerationStoreV1 {
  active: RetrievalGenerationV1 | undefined = generation;
  existing: StoredQueryResultV1 | undefined = undefined;
  registerOutcome: "registered" | "idempotency-conflict" = "registered";
  failNextRegister = false;
  readonly readActiveInputs: ReadActiveInput[] = [];
  readonly registerInputs: RegisterInput[] = [];

  async readActiveGeneration(input: ReadActiveInput): Promise<RetrievalGenerationV1 | undefined> {
    this.readActiveInputs.push(input);
    return this.active;
  }

  async readQueryResult(): Promise<StoredQueryResultV1 | undefined> {
    return this.existing;
  }

  async registerQueryResult(input: RegisterInput) {
    if (this.failNextRegister) throw new Error("postgres registration unavailable");
    this.registerInputs.push(input);
    return this.registerOutcome === "registered"
      ? { kind: "registered" as const, replayed: false }
      : { kind: "idempotency-conflict" as const };
  }

  // 查询路径不涉及写入/激活；一旦被误用必须立刻失败而不是静默通过。
  async ensureBuildingGeneration(): Promise<never> {
    throw new Error("query path must not create generations");
  }

  async readGeneration(): Promise<never> {
    throw new Error("query path must not read generations by ref");
  }

  async readGenerationStatus(): Promise<never> {
    throw new Error("query path must not read generation status");
  }

  async appendTransition(): Promise<never> {
    throw new Error("query path must not append transitions");
  }

  async readActivation(): Promise<never> {
    throw new Error("query path must not read activations");
  }

  async activateGeneration(): Promise<never> {
    throw new Error("query path must not activate generations");
  }
}

class StubProjection implements RetrievalProjectionPortV1 {
  result: RetrievalHybridQueryResultV1 = fusionFor();
  queryCalls = 0;
  readonly queries: RetrievalHybridQueryV1[] = [];

  async queryHybrid(query: RetrievalHybridQueryV1): Promise<RetrievalHybridQueryResultV1> {
    this.queryCalls += 1;
    this.queries.push(query);
    return this.result;
  }

  async serviceVersion(): Promise<never> {
    throw new Error("query path must not probe the service version");
  }

  async ensureCollection(): Promise<never> {
    throw new Error("query path must not create collections");
  }

  async upsertMembers(): Promise<never> {
    throw new Error("query path must not upsert members");
  }

  async inspectGeneration(): Promise<never> {
    throw new Error("query path must not inspect generations");
  }

  async deleteGenerationCollection(): Promise<never> {
    throw new Error("query path must not delete collections");
  }

  async listRetrievalCollections(): Promise<never> {
    throw new Error("query path must not list collections");
  }
}

class StubSourceFacts implements IdentificationKnowledgeReleaseReaderV1 {
  readonly reads = new Map<string, IdentificationKnowledgeExactReadV1>();
  readonly denied = new Set<string>();
  readonly calls: {
    readonly releaseRef: KnowledgeReleaseRefV1;
    readonly authorization: AuthorizationContextV1;
  }[] = [];

  constructor() {
    for (const member of MEMBERS) {
      this.reads.set(member.sourceReleaseRef.reference.entityId, member.exactRead);
    }
  }

  override(entityId: string, read: IdentificationKnowledgeExactReadV1): void {
    this.reads.set(entityId, read);
  }

  async readVisibleEntries(input: {
    releaseRefs: readonly KnowledgeReleaseRefV1[];
    authorization: AuthorizationContextV1;
  }) {
    return input.releaseRefs.flatMap((ref) => {
      this.calls.push({ releaseRef: ref, authorization: input.authorization });
      if (this.denied.has(ref.reference.entityId)) return [];
      const value = this.reads.get(ref.reference.entityId)?.package;
      if (
        value === undefined ||
        value.definitionType === "process-model" ||
        value.definitionType === "retrieval-evidence-base"
      )
        return [];
      const entries = value.definitionType === "risk-mechanism" ? value.mechanisms : value.entries;
      return entries.map((entry) => ({
        sourceKind: value.definitionType,
        sourceReleaseRef: ref,
        sourceEntryId: "mechanismId" in entry ? entry.mechanismId : entry.entryId,
        entry,
      }));
    });
  }

  async readExact(input: ReadExactInput) {
    this.calls.push({ releaseRef: input.releaseRef, authorization: input.authorization });
    const entityId = input.releaseRef.reference.entityId;
    if (this.denied.has(entityId)) {
      const error: ModuleErrorV1 = {
        stageCode: "identification-knowledge.read-exact",
        occurredAt: TIMESTAMP,
        causalRunId: "c17-read",
        code: "AUTHORIZATION_DENIED",
        category: "authorization",
        retryable: false,
        requiredCapability: "knowledge-modeling.retrieve",
        authorizationPolicyRef: { entityId: "authorization-policy", versionId: "1" },
      };
      return { kind: "failed" as const, error };
    }
    const read = this.reads.get(entityId);
    if (read === undefined) throw new Error(`unexpected C17 read for ${entityId}`);
    return { kind: "succeeded" as const, read };
  }
}

class StubModelGateway implements Pick<ModelGatewayPortV1, "embed"> {
  readonly calls: EmbeddingRequestV1[] = [];

  async embed(request: EmbeddingRequestV1): Promise<EmbeddingResultV1> {
    this.calls.push(request);
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => 0.1 * (index + 1));
    return EmbeddingResultV1Schema.parse({
      schemaVersion: "1",
      invocationId: request.invocationId,
      modelDeploymentRef: request.modelDeploymentRef,
      serverBuildRef: { entityId: "model-server-build", versionId: "1" },
      modelVersionRef: { entityId: "model-version", versionId: "1" },
      usage: { available: false },
      rawResponseRef: {
        kind: "diagnostic-artifact",
        reference: { entityId: "model-raw-response", versionId: "1" },
      },
      vectors: [vector],
      dimensions: EMBEDDING_DIMENSIONS,
    });
  }
}

class StubArtifactStore implements ArtifactStoreV1 {
  readonly puts: { readonly command: ArtifactPutCommandV1; readonly bytes: Buffer }[] = [];
  readonly results: ArtifactPutResultV1[] = [];
  failNextPut = false;

  async put(
    command: ArtifactPutCommandV1,
    content: AsyncIterable<Uint8Array>,
  ): Promise<ArtifactPutResultV1> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of content) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (this.failNextPut) throw new Error("artifact store unavailable");
    this.puts.push({ command, bytes });
    const hash = createHash("sha256").update(bytes).digest("hex");
    const artifactRef: ArtifactRefV1 = {
      kind: "content-artifact",
      reference: { entityId: command.artifactId, versionId: `sha256:${hash}` },
    };
    const result = ArtifactPutResultV1Schema.parse({
      artifactRef,
      manifest: {
        schemaVersion: "1",
        artifactRef,
        artifactKind: "content",
        content: { hash: { algorithm: "sha256", value: hash }, byteLength: bytes.byteLength },
        mediaType: command.mediaType,
        purposeCode: command.purposeCode,
        access: {
          projectId: command.projectId,
          spatialScopeRefs: command.authorization.spatialScopeRefs,
          sourceAccessGrantRefs: command.authorization.sourceAccessGrantRefs,
          authorizationPolicyRefs: [command.authorization.authorizationPolicyRef],
        },
        writePolicyRef: { entityId: "artifact-write-policy", versionId: "1" },
        parentArtifactRefs: [],
        evidenceReferences: [],
        producerCommandId: command.commandId,
        authorizationContextRef: command.authorization.authorizationContextRef,
        auditTrailRef: {
          kind: "audit-trail",
          reference: { entityId: "artifact-audit-trail", versionId: "1" },
        },
        occurredAt: TIMESTAMP,
        recordedAt: TIMESTAMP,
        persistedAt: TIMESTAMP,
      },
      manifestSha256: hash,
      replayed: false,
      deduplicated: false,
    });
    this.results.push(result);
    return result;
  }

  async open(): Promise<never> {
    throw new Error("query path must not read artifacts");
  }
}

interface HarnessV1 {
  readonly service: HybridRetrievalService;
  readonly inputReader: StubInputReader;
  readonly store: StubGenerationStore;
  readonly projection: StubProjection;
  readonly facts: StubSourceFacts;
  readonly gateway: StubModelGateway;
  readonly artifacts: StubArtifactStore;
  readonly failures: HybridRetrievalFailureV1[];
}

const createHarness = (): HarnessV1 => {
  const inputReader = new StubInputReader();
  const store = new StubGenerationStore();
  const projection = new StubProjection();
  const facts = new StubSourceFacts();
  const gateway = new StubModelGateway();
  const artifacts = new StubArtifactStore();
  const failures: HybridRetrievalFailureV1[] = [];
  const service = new HybridRetrievalService({
    inputReader,
    generationStore: store,
    projection,
    sourceFacts: facts,
    modelGateway: gateway,
    artifactStore: artifacts,
    budgetPolicyRef: BUDGET_POLICY_REF,
    now: () => new Date(TIMESTAMP),
    failureSink: {
      record: async (failure) => {
        failures.push(failure);
      },
    },
  });
  return { service, inputReader, store, projection, facts, gateway, artifacts, failures };
};

// ------------------------------------------------------------------ 断言助手

const errorOf = (result: KnowledgeRetrievalResultV1): ModuleErrorV1 => {
  if (result.kind !== "failed") throw new Error("expected a failed public result");
  return result.error;
};

type BlockedErrorV1 = Extract<ModuleErrorV1, { readonly code: "BUSINESS_BLOCKED" }>;
type DeniedErrorV1 = Extract<ModuleErrorV1, { readonly code: "AUTHORIZATION_DENIED" }>;
type TerminalErrorV1 = Extract<ModuleErrorV1, { readonly code: "TERMINAL_FAILURE" }>;

const expectBlocked = (result: KnowledgeRetrievalResultV1, blockerKind: string): BlockedErrorV1 => {
  const error = errorOf(result);
  expect(error.code).toBe("BUSINESS_BLOCKED");
  if (error.code !== "BUSINESS_BLOCKED") throw new Error("unreachable");
  expect(error.category).toBe("business-blocked");
  expect(error.retryable).toBe(false);
  expect(error.blockerKind).toBe(blockerKind);
  return error;
};

const expectAuthorizationDenied = (result: KnowledgeRetrievalResultV1): DeniedErrorV1 => {
  const error = errorOf(result);
  expect(error.code).toBe("AUTHORIZATION_DENIED");
  if (error.code !== "AUTHORIZATION_DENIED") throw new Error("unreachable");
  expect(error.category).toBe("authorization");
  expect(error.retryable).toBe(false);
  expect(error.requiredCapability).toBe("knowledge-modeling.retrieve");
  return error;
};

// 内部失败码不在公共错误里回传（避免泄露），故公共断言与 failureSink 观测分开检查。
const expectTerminalFailure = (result: KnowledgeRetrievalResultV1): TerminalErrorV1 => {
  const error = errorOf(result);
  expect(error.code).toBe("TERMINAL_FAILURE");
  if (error.code !== "TERMINAL_FAILURE") throw new Error("unreachable");
  expect(error.category).toBe("technical");
  expect(error.retryable).toBe(false);
  expect(error.diagnosticRef.kind).toBe("diagnostic-artifact");
  return error;
};

const expectNoPublishedResult = (harness: HarnessV1): void => {
  expect(harness.artifacts.puts).toHaveLength(0);
  expect(harness.store.registerInputs).toHaveLength(0);
};

const capturedPayload = (harness: HarnessV1) => {
  const put = harness.artifacts.puts[0];
  if (put === undefined) throw new Error("expected a result artifact put");
  return HybridRetrievalResultPayloadV1Schema.parse(JSON.parse(put.bytes.toString("utf8")));
};

// ------------------------------------------------------------------ 场景

describe("HybridRetrievalService：查询必须精确绑定输入并在当前权限下回查事实", () => {
  it.each([
    ["missing capability", { grantedCapabilities: ["knowledge-modeling.read"] }],
    ["foreign project", { projectId: "project-other" }],
    ["foreign actor", { actorId: "actor-other" }],
  ])("denies %s before reading the target", async (_label, override) => {
    const harness = createHarness();
    const query = {
      ...makeQuery(),
      authorization: { ...authorization, ...override },
    } as KnowledgeRetrievalQueryV1;

    expectAuthorizationDenied(await harness.service.retrieve(query));
    expect(harness.inputReader.calls).toHaveLength(0);
    expect(harness.store.readActiveInputs).toHaveLength(0);
    expect(harness.projection.queryCalls).toBe(0);
    expect(harness.facts.calls).toHaveLength(0);
    expectNoPublishedResult(harness);
  });

  it.each([
    ["spatial", { spatialScopeRefs: [{ kind: "source-access-grant" }] }],
    ["source", { sourceAccessGrantRefs: [{ kind: "spatial-scope" }] }],
  ])("rejects malformed %s scope before reading the target", async (_label, override) => {
    const harness = createHarness();
    const query = {
      ...makeQuery(),
      authorization: { ...authorization, ...override },
    } as KnowledgeRetrievalQueryV1;

    expect(errorOf(await harness.service.retrieve(query)).code).toBe("UNSUPPORTED_CONTRACT");
    expect(harness.inputReader.calls).toHaveLength(0);
    expect(harness.store.readActiveInputs).toHaveLength(0);
    expect(harness.projection.queryCalls).toBe(0);
    expect(harness.facts.calls).toHaveLength(0);
    expectNoPublishedResult(harness);
  });

  it("有权限查询返回事实回查后的结果引用并保留完整可重放解释", async () => {
    const harness = createHarness();
    const result = await harness.service.retrieve(makeQuery());

    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded") throw new Error("unreachable");
    expect(harness.projection.queries[0]?.filter).toEqual({
      projectId: PROJECT_ID,
      generationRef: generation.generationRef,
      authorizationScopeDigest: memberScopeDigest,
      visiblePointIds: MEMBERS.map((member) => member.pointId).sort(),
    });
    const knowledgeQueryResultRef = result.result.knowledgeQueryResultRef;

    const payload = capturedPayload(harness);
    // 请求引用、发布、代际、策略与双路参数必须逐项可定位、可重放。
    expect(payload.refs).toEqual(INPUT_REFS);
    expect(payload.evidenceBaseReleaseRef).toEqual(EVIDENCE_BASE_RELEASE_REF);
    expect(payload.memberReleaseRefs).toEqual({
      riskMechanismRef: RISK_MECHANISM_RELEASE_REF,
      standardLibraryRef: STANDARD_LIBRARY_RELEASE_REF,
      caseLibraryRef: CASE_LIBRARY_RELEASE_REF,
    });
    expect(payload.generationRef).toEqual(generationRef);
    expect(payload.collectionName).toBe(generation.collectionName);
    expect(payload.policyRef).toEqual(policy.policyRef);
    expect(payload.modelDeploymentRef).toEqual(policy.modelDeploymentRef);
    expect(payload.projectionCompatibilityRef).toEqual(PROJECTION_COMPATIBILITY_REF);
    expect(payload.embeddingDimensions).toBe(EMBEDDING_DIMENSIONS);
    // payload 只固定 BM25 文档/查询一致的配置，不含向量名等投影内部命名。
    expect(payload.bm25).toEqual({
      model: "qdrant/bm25",
      tokenizer: "multilingual",
      language: "chinese",
      stemmer: "none",
      stopwords: [],
    });
    expect(payload.rrf).toEqual(policy.rrf);
    expect(payload.topK).toBe(policy.topK);
    expect(payload.authorizationScopeDigest).toBe(memberScopeDigest);
    expect(payload.authorizationContextRef).toEqual(AUTHORIZATION_CONTEXT_REF);
    expect(payload.knowledgeQueryResultRef).toEqual(knowledgeQueryResultRef);
    expect(payload.scoreSemantics).toBe("ranking-signal-not-confidence");

    expect(payload.hits.map((hit) => hit.rank)).toEqual([1, 2, 3]);
    for (const hit of payload.hits) {
      const member = memberOf(hit.sourceKind);
      expect(hit.sourceReleaseRef).toEqual(member.sourceReleaseRef);
      expect(hit.sourceEntryId).toBe(member.sourceEntryId);
      expect(hit.contentDigest).toBe(member.contentDigest);
      expect(hit.memberRef).toEqual(member.memberRef);
      expect(hit.evidenceSourceVersionRefs).toEqual([
        { entityId: "source-version-1", versionId: "1" },
      ]);
      const denseRank = DENSE_RANKS[member.pointId];
      const bm25Rank = BM25_RANKS[member.pointId];
      expect(hit.denseRank).toBe(denseRank);
      expect(hit.bm25Rank).toBe(bm25Rank);
      expect(hit.denseContribution).toBeCloseTo(
        denseRank === undefined
          ? 0
          : rrfContribution(policy.rrf.denseWeight, policy.rrf.k, denseRank),
        10,
      );
      expect(hit.bm25Contribution).toBeCloseTo(
        bm25Rank === undefined ? 0 : rrfContribution(policy.rrf.bm25Weight, policy.rrf.k, bm25Rank),
        10,
      );
      expect(hit.fusionScore).toBe(
        fusionFor().fused.find((candidate) => candidate.pointId === member.pointId)?.score,
      );
    }

    // 结果契约里不存在置信度、P/C、风险等级或矩阵字段（额外字段会被 strict Schema 拒绝）。
    expect(
      Object.keys(payload).filter((key) =>
        /confidence|probability|risklevel|riskmatrix|matrix|pcvalue/iu.test(key),
      ),
    ).toEqual([]);
    expect(
      HybridRetrievalResultPayloadV1Schema.safeParse({ ...payload, confidence: 0.9 }).success,
    ).toBe(false);
    expect(
      HybridRetrievalResultPayloadV1Schema.safeParse({ ...payload, riskLevel: "high" }).success,
    ).toBe(false);

    // 登记事实必须与返回引用一致，并绑定代际、策略与授权摘要。
    const registered = harness.store.registerInputs[0];
    expect(registered).toBeDefined();
    expect(registered?.knowledgeQueryResultRef).toEqual(knowledgeQueryResultRef);
    expect(registered?.generationRef).toEqual(generationRef);
    expect(registered?.policyRef).toEqual(policy.policyRef);
    expect(registered?.authorizationScopeDigest).toBe(memberScopeDigest);
    expect(registered?.resultArtifactRef).toEqual(harness.artifacts.results[0]?.artifactRef);

    // 正式命中必须经 C17 逐发布回查，且读取的发布恰为补齐的互补成员集合。
    expect(new Set(harness.facts.calls.map((call) => call.releaseRef.reference.entityId))).toEqual(
      new Set([
        RISK_MECHANISM_RELEASE_REF.reference.entityId,
        STANDARD_LIBRARY_RELEASE_REF.reference.entityId,
        CASE_LIBRARY_RELEASE_REF.reference.entityId,
      ]),
    );
  });

  it("输入读取返回授权拒绝时封闭失败且不产生正式结果", async () => {
    const harness = createHarness();
    harness.inputReader.failure = { code: "AUTHORIZATION_DENIED", detailCode: "actor-lacks-scope" };
    const result = await harness.service.retrieve(makeQuery());

    expectAuthorizationDenied(result);
    expectNoPublishedResult(harness);
    expect(harness.projection.queryCalls).toBe(0);
    expect(harness.failures.map((failure) => [failure.stage, failure.code])).toEqual([
      ["authorization", "AUTHORIZATION_DENIED"],
    ]);
  });

  it("增加无关授权后仍使用原代际和实际可见条目", async () => {
    const harness = createHarness();
    const otherAuthorization = makeAuthorization("spatial-scope-other");
    harness.inputReader.input = makeFrozenInput({
      authorization: otherAuthorization,
      authorizationScopeDigest: authorizationScopeDigest(otherAuthorization),
    });
    const result = await harness.service.retrieve(makeQuery());

    expect(result.kind).toBe("succeeded");
    expect(harness.projection.queries[0]?.filter.visiblePointIds).toEqual(
      MEMBERS.map((member) => member.pointId).sort(),
    );
  });

  it("策略声明查询指令时只渲染查询 Embedding 文本，BM25 查询仍用原查询", async () => {
    const harness = createHarness();
    harness.inputReader.input = makeFrozenInput({
      policy: HybridRetrievalPolicyV1Schema.parse({
        ...policy,
        queryInstruction: QUERY_INSTRUCTION,
      }),
    });
    const result = await harness.service.retrieve(makeQuery());

    expect(result.kind).toBe("succeeded");
    expect(harness.gateway.calls[0]?.texts).toEqual([
      `Instruct: ${QUERY_INSTRUCTION}\nQuery:${QUERY_TEXT}`,
    ]);
    expect(harness.projection.queries[0]?.queryText).toBe(QUERY_TEXT);
  });

  it("rejects a policy body that differs from the requested policy reference", async () => {
    const harness = createHarness();
    harness.inputReader.input = makeFrozenInput({
      policy: HybridRetrievalPolicyV1Schema.parse({
        ...policy,
        policyRef: { entityId: policy.policyRef.entityId, versionId: "other-version" },
      }),
    });
    expectBlocked(await harness.service.retrieve(makeQuery()), "RETRIEVAL_INPUT_DRIFT");
    expect(harness.store.readActiveInputs).toHaveLength(0);
    expectNoPublishedResult(harness);
  });

  it("旧授权引用不影响当前可见成员查询", async () => {
    const harness = createHarness();
    harness.inputReader.input = makeFrozenInput({
      authorizationContextRef: {
        kind: "authorization-context",
        reference: { entityId: "authorization-context-stale", versionId: "1" },
      },
    });
    const result = await harness.service.retrieve(makeQuery());

    expect(result.kind).toBe("succeeded");
  });

  it("无匹配活动 ready 代际时以 GENERATION_NOT_READY 失败且不借用其他代际", async () => {
    const harness = createHarness();
    harness.store.active = undefined;
    const result = await harness.service.retrieve(makeQuery());

    const error = expectBlocked(result, "GENERATION_NOT_READY");
    expect(error.blockerRef.kind).toBe("retrieval-evidence-base-release");
    expect(harness.store.readActiveInputs).toEqual([
      {
        projectId: PROJECT_ID,
        evidenceBaseReleaseRef: EVIDENCE_BASE_RELEASE_REF,
        policyRef: policy.policyRef,
        authorizationScopeDigest: scopeDigest,
      },
    ]);
    expectNoPublishedResult(harness);
    expect(harness.projection.queryCalls).toBe(0);
    expect(harness.gateway.calls).toHaveLength(0);
  });

  it("候选权限摘要不一致、事实回查拒绝、来源条目缺失或内容漂移都拒绝整次结果", async () => {
    const cases: readonly {
      readonly name: string;
      readonly assertError: (result: KnowledgeRetrievalResultV1) => ModuleErrorV1;
      readonly apply: (harness: HarnessV1) => void;
      readonly expectedDetailCode: string;
      readonly expectedStage: string;
    }[] = [
      {
        name: "候选跨工程",
        assertError: expectAuthorizationDenied,
        expectedDetailCode: "candidate-scope-mismatch",
        expectedStage: "authorization",
        apply: (harness) => {
          const fused = fusionFor().fused.map((hit, index) =>
            index === 0
              ? {
                  ...hit,
                  payload: payloadFor(memberOf("risk-mechanism"), {
                    projectId: "foreign-project",
                  }),
                }
              : hit,
          );
          harness.projection.result = fusionFor({ fused });
        },
      },
      {
        name: "候选来源发布不属于当前代际",
        assertError: (result) => expectBlocked(result, "SOURCE_FACT_DRIFT"),
        expectedDetailCode: "candidate-member-mismatch",
        expectedStage: "reconciliation",
        apply: (harness) => {
          harness.projection.result = fusionFor({
            fused: fusionFor().fused.map((hit, index) =>
              index === 0
                ? {
                    ...hit,
                    payload: payloadFor(memberOf("risk-mechanism"), {
                      sourceReleaseRef: {
                        kind: "knowledge-release",
                        reference: { entityId: "unrelated-release", versionId: "1" },
                      },
                    }),
                  }
                : hit,
            ),
          });
        },
      },
      {
        name: "C17 对单个命中拒绝访问",
        assertError: (result) => expectBlocked(result, "SOURCE_FACT_DRIFT"),
        expectedDetailCode: "source-entry-missing",
        expectedStage: "source-read",
        apply: (harness) => {
          harness.facts.denied.add(STANDARD_LIBRARY_RELEASE_REF.reference.entityId);
        },
      },
      {
        name: "来源条目缺失",
        assertError: (result) => expectBlocked(result, "SOURCE_FACT_DRIFT"),
        expectedDetailCode: "source-entry-missing",
        expectedStage: "source-read",
        apply: (harness) => {
          harness.facts.override(
            STANDARD_LIBRARY_RELEASE_REF.reference.entityId,
            buildMember("standard-library", "standard-missing").exactRead,
          );
        },
      },
      {
        name: "内容摘要漂移",
        assertError: (result) => expectBlocked(result, "SOURCE_FACT_DRIFT"),
        expectedDetailCode: "content-digest-drift",
        expectedStage: "reconciliation",
        apply: (harness) => {
          const driftedEntry = {
            ...entryFor("standard-library", "standard-1"),
            clauseRefs: ["clause-9.9"],
          };
          harness.facts.override(
            STANDARD_LIBRARY_RELEASE_REF.reference.entityId,
            buildMember("standard-library", "standard-1", driftedEntry).exactRead,
          );
        },
      },
      {
        name: "规范正文漂移",
        assertError: (result) => expectBlocked(result, "SOURCE_FACT_DRIFT"),
        expectedDetailCode: "content-digest-drift",
        expectedStage: "reconciliation",
        apply: (harness) => {
          // C17 校验后补齐的规范正文同属成员投影：清单未登记即为事实漂移。
          const read = buildMember("standard-library", "standard-1").exactRead;
          if (read.package.definitionType !== "standard-library") {
            throw new Error("standard-library fixture must carry a standard-library package");
          }
          const entries = read.package.entries.map(
            (entry) =>
              ({
                ...entry,
                retrievalText: "clause-3.2 盾构始发前应完成端头加固。",
              }) as typeof entry,
          );
          harness.facts.override(STANDARD_LIBRARY_RELEASE_REF.reference.entityId, {
            ...read,
            package: { ...read.package, entries },
          });
        },
      },
    ];

    for (const scenario of cases) {
      const harness = createHarness();
      scenario.apply(harness);
      const result = await harness.service.retrieve(makeQuery());

      scenario.assertError(result);
      expect(harness.failures[0]?.detailCode, scenario.name).toBe(scenario.expectedDetailCode);
      expect(harness.failures[0]?.stage, scenario.name).toBe(scenario.expectedStage);
      // 整次结果拒绝：没有部分命中被发布，也没有结果引用产生。
      expectNoPublishedResult(harness);
      const serialized = JSON.stringify(errorOf(result));
      expect(serialized, scenario.name).not.toContain(memberOf("standard-library").sourceEntryId);
      expect(serialized, scenario.name).not.toContain(memberOf("standard-library").pointId);
      expect(serialized, scenario.name).not.toMatch(/rank/iu);
    }
  });
});

describe("HybridRetrievalService：查询结果必须保留可重放解释且区分排序分值与置信度", () => {
  it("同键同载荷返回既有结果引用且不再查询投影", async () => {
    const harness = createHarness();
    const first = await harness.service.retrieve(makeQuery());
    expect(first.kind).toBe("succeeded");
    const registered = harness.store.registerInputs[0];
    if (registered === undefined) throw new Error("expected a registered query result");

    harness.projection.queryCalls = 0;
    harness.gateway.calls.length = 0;
    harness.artifacts.puts.length = 0;
    harness.store.registerInputs.length = 0;
    harness.store.existing = {
      requestDigest: registered.requestDigest,
      knowledgeQueryResultRef: registered.knowledgeQueryResultRef,
      resultArtifactRef: registered.resultArtifactRef,
    };

    const replay = await harness.service.retrieve(makeQuery());
    expect(replay).toEqual(first);
    expect(harness.projection.queryCalls).toBe(0);
    expect(harness.gateway.calls).toHaveLength(0);
    expect(harness.artifacts.puts).toHaveLength(0);
    expect(harness.store.registerInputs).toHaveLength(0);
  });

  it("同 queryId 但载荷摘要不同时返回 IDEMPOTENCY_CONFLICT 且不覆盖原结果", async () => {
    const harness = createHarness();
    harness.store.existing = {
      requestDigest: HEX_LOW,
      knowledgeQueryResultRef: {
        kind: "knowledge-query-result",
        reference: { entityId: "retrieval-query-result:project-c20:query-1", versionId: HEX_LOW },
      },
      resultArtifactRef: {
        kind: "content-artifact",
        reference: { entityId: "prior-result-artifact", versionId: `sha256:${HEX_LOW}` },
      },
    };

    const result = await harness.service.retrieve(makeQuery());
    const error = errorOf(result);
    expect(error.code).toBe("IDEMPOTENCY_CONFLICT");
    if (error.code !== "IDEMPOTENCY_CONFLICT") throw new Error("unreachable");
    expect(error.category).toBe("idempotency");
    expect(error.idempotencyKey).toBe(`hybrid-retrieval:${PROJECT_ID}:${QUERY_ID}`);
    expect(error.priorCommandId).toBe(`hybrid-retrieval:${PROJECT_ID}:${QUERY_ID}`);
    expectNoPublishedResult(harness);
    expect(harness.projection.queryCalls).toBe(0);
  });
});

describe("HybridRetrievalService：双路检索不得降级或产生半正式结果", () => {
  it("投影返回不同代际时以 DUAL_INDEX_MISMATCH 失败", async () => {
    const harness = createHarness();
    harness.projection.result = fusionFor({
      generationRef: {
        kind: "retrieval-generation",
        reference: { entityId: generationRef.reference.entityId, versionId: `sha256:${HEX_LOW}` },
      },
    });
    const result = await harness.service.retrieve(makeQuery());

    expectBlocked(result, "DUAL_INDEX_MISMATCH");
    expectNoPublishedResult(harness);
    expect(harness.failures[0]?.stage).toBe("reconciliation");
  });

  it("融合命中缺席双路时以 FUSION_RECONCILIATION_FAILED 失败", async () => {
    const harness = createHarness();
    const orphanPointId = "orphan-0000-5000-8000-000000000000";
    harness.projection.result = fusionFor({
      fused: [
        {
          pointId: orphanPointId,
          rank: 1,
          score: 0.03,
          payload: payloadFor(memberOf("risk-mechanism")),
        },
        {
          pointId: memberOf("risk-mechanism").pointId,
          rank: 2,
          score: 0.02,
          payload: payloadFor(memberOf("risk-mechanism")),
        },
        {
          pointId: memberOf("standard-library").pointId,
          rank: 3,
          score: 0.01,
          payload: payloadFor(memberOf("standard-library")),
        },
      ],
    });
    const result = await harness.service.retrieve(makeQuery());

    expectTerminalFailure(result);
    expect(harness.failures[0]?.code).toBe("FUSION_RECONCILIATION_FAILED");
    expect(harness.failures[0]?.detailCode).toBe(`unranked-${orphanPointId}`);
    expectNoPublishedResult(harness);
  });

  it("融合顺序与策略 RRF 贡献不一致时以 FUSION_RECONCILIATION_FAILED 失败", async () => {
    const harness = createHarness();
    // 机理仅列 bm25 第 5 名（贡献 1/65）却排在其 dense 第 1 名（贡献 1/61）之前。
    harness.projection.result = fusionFor({
      fused: [
        {
          pointId: memberOf("risk-mechanism").pointId,
          rank: 1,
          score: 0.02,
          payload: payloadFor(memberOf("risk-mechanism")),
        },
        {
          pointId: memberOf("standard-library").pointId,
          rank: 2,
          score: 0.01,
          payload: payloadFor(memberOf("standard-library")),
        },
      ],
      denseRoute: [{ pointId: memberOf("standard-library").pointId, rank: 1, score: 0.9 }],
      bm25Route: [{ pointId: memberOf("risk-mechanism").pointId, rank: 5, score: 9.5 }],
    });
    const result = await harness.service.retrieve(makeQuery());

    expectTerminalFailure(result);
    expect(harness.failures[0]?.code).toBe("FUSION_RECONCILIATION_FAILED");
    expect(harness.failures[0]?.detailCode).toBe("fusion-order-mismatch");
    expectNoPublishedResult(harness);
  });

  it("任一路为空时以 FUSION_RECONCILIATION_FAILED 失败而非降级单路", async () => {
    const harness = createHarness();
    harness.projection.result = fusionFor({
      denseRoute: [],
      fused: [
        {
          pointId: memberOf("case-library").pointId,
          rank: 1,
          score: 0.02,
          payload: payloadFor(memberOf("case-library")),
        },
      ],
    });
    const result = await harness.service.retrieve(makeQuery());

    expectTerminalFailure(result);
    expect(harness.failures[0]?.code).toBe("FUSION_RECONCILIATION_FAILED");
    expect(harness.failures[0]?.detailCode).toBe("route-empty");
    expectNoPublishedResult(harness);
  });

  it("结果工件写入失败时不返回结果引用且错误可重试", async () => {
    const harness = createHarness();
    harness.artifacts.failNextPut = true;
    const result = await harness.service.retrieve(makeQuery());

    const error = errorOf(result);
    expect(error.code).toBe("TRANSIENT_FAILURE");
    if (error.code !== "TRANSIENT_FAILURE") throw new Error("unreachable");
    expect(error.category).toBe("technical");
    expect(error.retryable).toBe(true);
    expect(error.attempt).toBe(1);
    expect(error.diagnosticRef.kind).toBe("diagnostic-artifact");
    expect(harness.store.registerInputs).toHaveLength(0);
    expect(harness.failures[0]?.stage).toBe("result-persistence");
    expect(harness.failures[0]?.code).toBe("RESULT_PERSISTENCE_FAILED");
  });

  it("PostgreSQL result registration failure returns a retryable failure without a formal result", async () => {
    const harness = createHarness();
    harness.store.failNextRegister = true;

    const result = await harness.service.retrieve(makeQuery());

    expect(errorOf(result).code).toBe("TRANSIENT_FAILURE");
    expect(harness.failures[0]).toMatchObject({
      stage: "result-persistence",
      code: "RESULT_PERSISTENCE_FAILED",
      retryable: true,
    });
    expect(harness.artifacts.puts).toHaveLength(1);
    expect(harness.store.registerInputs).toHaveLength(0);
  });

  it("结果登记冲突时不返回结果引用", async () => {
    const harness = createHarness();
    harness.store.registerOutcome = "idempotency-conflict";
    const result = await harness.service.retrieve(makeQuery());

    expect(errorOf(result).code).toBe("IDEMPOTENCY_CONFLICT");
    expect(result).not.toHaveProperty("result");
    expect(harness.artifacts.puts).toHaveLength(1);
    expect(harness.store.registerInputs).toHaveLength(1);
    expect(harness.failures[0]?.stage).toBe("result-persistence");
  });
});

describe("HybridRetrievalService：非 hybrid-evidence 查询分支", () => {
  it("relationship-context 查询返回未支持分支的公开失败且不触碰任何端口", async () => {
    const harness = createHarness();
    const query = KnowledgeRetrievalQueryV1Schema.parse({
      queryId: "query-relationship",
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      authorization,
      kind: "relationship-context",
      payload: {
        inputSnapshotRef: INPUT_REFS.inputSnapshotRef,
        workItemRef: INPUT_REFS.workItemRef,
      },
    });

    const result = await harness.service.retrieve(query);
    // 其他分支由后续 change（C21 等）实现；C20 只保留既有公共契约，且不记为一次检索失败观测。
    const error = errorOf(result);
    expect(error.code).toBe("UNSUPPORTED_CONTRACT");
    if (error.code !== "UNSUPPORTED_CONTRACT") throw new Error("unreachable");
    expect(error.stageCode).toBe("hybrid-retrieval.unsupported_branch");
    expect(error.causalRunId).toBe("query-relationship");
    expect(error.schemaVersion).toBe("1");
    expect(error.category).toBe("technical");
    expect(error.retryable).toBe(false);
    expect(harness.inputReader.calls).toHaveLength(0);
    expect(harness.projection.queryCalls).toBe(0);
    expectNoPublishedResult(harness);
    expect(harness.failures).toHaveLength(0);
  });
});
