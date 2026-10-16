import { describe, expect, it } from "vitest";

import type { AuthorizationContextV1, ContractReferenceV1 } from "@riskflow/contracts/ports";
import { ModuleErrorV1Schema } from "@riskflow/contracts/ports";
import { sha256CanonicalJson } from "../../src/persistence/index.js";

import {
  HYBRID_RETRIEVAL_FAILURE_CODES_V1,
  HybridRetrievalAcceptanceMeasurementsV1Schema,
  HybridRetrievalAcceptancePolicyV1Schema,
  HybridRetrievalAcceptanceReportV1Schema,
  HybridRetrievalPolicyV1Schema,
  HybridRetrievalResultPayloadV1Schema,
  HybridRetrievalResultV1Schema,
  RETRIEVAL_ACCEPTANCE_GATE_IDS_V1,
  RETRIEVAL_SOURCE_KINDS_V1,
  RetrievalIndexManifestV1Schema,
  RetrievalHybridQueryResultV1Schema,
  RetrievalProjectionObservationV1Schema,
  assertGenerationTransition,
  authorizationScopeDigest,
  evaluateRetrievalAcceptance,
  hybridRetrievalFailure,
  mapHybridFailureToModuleError,
  normalizeRetrievalMembers,
  projectionCompatibilityRefFor,
  reconcileDualIndexManifest,
  reconcileRrfResult,
  retrievalCollectionNameFor,
  retrievalGenerationRefFor,
  retrievalMemberContentDigest,
  retrievalMemberPointId,
  retrievalMemberRefFor,
  retrievalMemberText,
  retrievalQueryEmbeddingText,
  type HybridRetrievalFailureCodeV1,
  type HybridRetrievalFailureStageV1,
  type HybridRetrievalPolicyV1,
  type RetrievalGenerationStatusV1,
  type RetrievalIndexManifestV1,
  type RetrievalMemberSourceV1,
} from "../../src/retrieval/index.js";

const versionRef = (entityId: string, versionId = "v1") => ({ entityId, versionId });
const knowledgeRelease = (entityId: string, versionId = "v1") => ({
  kind: "knowledge-release" as const,
  reference: versionRef(entityId, versionId),
});
const evidenceBaseRelease = (versionId = "v1") => ({
  kind: "retrieval-evidence-base-release" as const,
  reference: versionRef("evidence-base", versionId),
});
const authorizationContextRef = {
  kind: "authorization-context" as const,
  reference: versionRef("authorization-context"),
};
const TIMESTAMP = "2030-01-01T00:00:00.000Z";
const SCOPE_DIGEST = "47718e59ce8149a0fc0661ba347009040b9c0b2e036f49b56c0af6af305981ca";

const memberReleaseRefs = () => ({
  riskMechanismRef: knowledgeRelease("release-risk-mechanism"),
  standardLibraryRef: knowledgeRelease("release-standard-library"),
  caseLibraryRef: knowledgeRelease("release-case-library"),
});

const policyInput = () => ({
  schemaVersion: "1" as const,
  policyRef: versionRef("retrieval-policy", "v1"),
  evidenceBaseDefinitionType: "retrieval-evidence-base" as const,
  modelDeploymentRef: versionRef("embedding-deployment", "v1"),
  dense: { vectorName: "dense" as const, dimensions: 64, distance: "cosine" as const },
  bm25: {
    vectorName: "bm25" as const,
    model: "qdrant/bm25" as const,
    tokenizer: "multilingual" as const,
    language: "chinese",
    stemmer: "none" as const,
    stopwords: [] as string[],
  },
  densePrefetchLimit: 20,
  bm25PrefetchLimit: 20,
  topK: 5,
  rrf: { k: 60, denseWeight: 1, bm25Weight: 1 },
  memberBatchLimit: 64,
  memberByteLimit: 4096,
  memberLimit: 500,
  embeddingTimeoutMs: 30000,
  projectionTimeoutMs: 60000,
  acceptancePolicyRef: versionRef("retrieval-acceptance-policy", "v1"),
  projectionCompatibilityRef: versionRef("projection-compatibility", "v1"),
});

const makePolicy = (overrides: Record<string, unknown> = {}): HybridRetrievalPolicyV1 =>
  HybridRetrievalPolicyV1Schema.parse({ ...policyInput(), ...overrides });

/** 结果契约只记录 BM25 配置本身，矢量名属于策略与投影兼容身份。 */
const bm25Config = () => {
  const { model, tokenizer, language, stemmer, stopwords } = policyInput().bm25;
  return { model, tokenizer, language, stemmer, stopwords };
};

const identityInputs = (overrides: Record<string, unknown> = {}) => ({
  projectId: "project-alpha",
  sourceEventId: "event-identification-basis-published-1",
  evidenceBaseReleaseRef: evidenceBaseRelease(),
  memberReleaseRefs: memberReleaseRefs(),
  policyRef: versionRef("retrieval-policy", "v1"),
  modelDeploymentRef: versionRef("embedding-deployment", "v1"),
  projectionCompatibilityRef: versionRef("projection-compatibility", "v1"),
  ...overrides,
});

const generationRef = () => retrievalGenerationRefFor(identityInputs());

const authorization: AuthorizationContextV1 = {
  schemaVersion: "1",
  authorizationContextRef,
  actorId: "actor-retrieval",
  projectId: "project-alpha",
  grantedCapabilities: ["knowledge-modeling.retrieve"],
  spatialScopeRefs: [{ kind: "spatial-scope", reference: versionRef("spatial-scope-a") }],
  sourceAccessGrantRefs: [{ kind: "source-access-grant", reference: versionRef("grant-a") }],
  authorizationPolicyRef: versionRef("authorization-policy", "v1"),
  decidedAt: TIMESTAMP,
  invocation: { kind: "human" },
};

const memberSources = (): RetrievalMemberSourceV1[] => [
  {
    sourceKind: "risk-mechanism",
    sourceReleaseRef: knowledgeRelease("release-risk-mechanism"),
    entries: [
      {
        entryId: "mechanism-b",
        entry: {
          mechanismId: "mechanism-b",
          mechanismType: "渗透变形",
          consequences: ["坝基管涌"],
        },
      },
      {
        entryId: "mechanism-a",
        entry: {
          mechanismId: "mechanism-a",
          mechanismType: "边坡失稳",
          consequences: ["坝坡滑塌"],
        },
      },
    ],
  },
  {
    sourceKind: "standard-library",
    sourceReleaseRef: knowledgeRelease("release-standard-library"),
    entries: [
      {
        entryId: "std-1",
        entry: {
          entryId: "std-1",
          level: "行业标准",
          standardIdentity: "SL 795-2016",
          standardVersion: "2016",
          clauseRefs: ["5.2.3"],
        },
      },
    ],
  },
  {
    sourceKind: "case-library",
    sourceReleaseRef: knowledgeRelease("release-case-library"),
    entries: [
      {
        entryId: "case-1",
        entry: { entryId: "case-1", constructionMethod: "均质土坝", outcomes: ["渗流量下降"] },
      },
    ],
  },
];

const normalize = (overrides: Record<string, unknown> = {}) =>
  normalizeRetrievalMembers({
    projectId: "project-alpha",
    generationRef: generationRef(),
    policy: makePolicy(),
    authorizationScopeDigest: SCOPE_DIGEST,
    sources: memberSources(),
    ...overrides,
  });

const manifestFixture = (): RetrievalIndexManifestV1 => {
  const outcome = normalize();
  if (outcome.kind !== "succeeded") throw new Error("fixture normalization must succeed");
  return outcome.manifest;
};

const pointPayloadFor = (
  manifest: RetrievalIndexManifestV1,
  member: RetrievalIndexManifestV1["members"][number],
) => ({
  schemaVersion: "1" as const,
  projectId: manifest.projectId,
  generationRef: manifest.generationRef,
  generationKey: manifest.generationRef.reference.versionId,
  sourceKind: member.sourceKind,
  sourceReleaseRef: member.sourceReleaseRef,
  sourceEntryId: member.sourceEntryId,
  contentDigest: member.contentDigest,
  authorizationScopeDigest: member.authorizationScopeDigest,
});

const observationFor = (
  manifest: RetrievalIndexManifestV1,
  mutate: (points: Record<string, unknown>[]) => Record<string, unknown>[] = (points) => points,
  overrides: Record<string, unknown> = {},
) =>
  RetrievalProjectionObservationV1Schema.parse({
    collectionName: retrievalCollectionNameFor(manifest.generationRef),
    generationRef: manifest.generationRef,
    serviceVersion: "1.19.0",
    complete: true,
    points: mutate(
      manifest.members.map((member) => ({
        pointId: member.pointId,
        hasDenseVector: true,
        hasSparseVector: true,
        denseDimensions: member.denseDimensions,
        payload: pointPayloadFor(manifest, member),
      })),
    ),
    ...overrides,
  });

describe("HybridRetrievalPolicyV1 strict parsing", () => {
  it("accepts the frozen policy shape and rejects unknown fields and non-literal versions", () => {
    expect(HybridRetrievalPolicyV1Schema.safeParse(policyInput()).success).toBe(true);
    expect(
      HybridRetrievalPolicyV1Schema.safeParse({ ...policyInput(), policyKind: "hybrid" }).success,
    ).toBe(false);
    expect(
      HybridRetrievalPolicyV1Schema.safeParse({
        ...policyInput(),
        bm25: { ...policyInput().bm25, unknownBm25Field: 1 },
      }).success,
    ).toBe(false);
    expect(
      HybridRetrievalPolicyV1Schema.safeParse({
        ...policyInput(),
        rrf: { ...policyInput().rrf, unknownRrfField: 1 },
      }).success,
    ).toBe(false);
    expect(
      HybridRetrievalPolicyV1Schema.safeParse({
        ...policyInput(),
        dense: { ...policyInput().dense, unknownDenseField: 1 },
      }).success,
    ).toBe(false);
    expect(
      HybridRetrievalPolicyV1Schema.safeParse({ ...policyInput(), schemaVersion: "2" }).success,
    ).toBe(false);
    expect(
      HybridRetrievalPolicyV1Schema.safeParse({ ...policyInput(), schemaVersion: 1 }).success,
    ).toBe(false);
  });

  it.each([
    ["topK above the dense prefetch limit", { densePrefetchLimit: 4, topK: 5 }],
    ["topK above the bm25 prefetch limit", { bm25PrefetchLimit: 4, topK: 5 }],
    [
      "dense prefetch limit above the member limit",
      { densePrefetchLimit: 6, bm25PrefetchLimit: 5, topK: 5, memberLimit: 5 },
    ],
    [
      "bm25 prefetch limit above the member limit",
      { densePrefetchLimit: 5, bm25PrefetchLimit: 6, topK: 5, memberLimit: 5 },
    ],
    ["topK 0", { topK: 0 }],
    ["fractional topK", { topK: 2.5 }],
    ["zero dense weight", { rrf: { k: 60, denseWeight: 0, bm25Weight: 1 } }],
    ["negative dense weight", { rrf: { k: 60, denseWeight: -1, bm25Weight: 1 } }],
    ["zero bm25 weight", { rrf: { k: 60, denseWeight: 1, bm25Weight: 0 } }],
    [
      "infinite bm25 weight",
      { rrf: { k: 60, denseWeight: 1, bm25Weight: Number.POSITIVE_INFINITY } },
    ],
    ["NaN dense weight", { rrf: { k: 60, denseWeight: Number.NaN, bm25Weight: 1 } }],
    ["rrf k 0", { rrf: { k: 0, denseWeight: 1, bm25Weight: 1 } }],
    ["fractional rrf k", { rrf: { k: 2.5, denseWeight: 1, bm25Weight: 1 } }],
    ["negative rrf k", { rrf: { k: -3, denseWeight: 1, bm25Weight: 1 } }],
    [
      "zero dense dimensions",
      { dense: { vectorName: "dense", dimensions: 0, distance: "cosine" } },
    ],
    [
      "unknown dense distance",
      { dense: { vectorName: "dense", dimensions: 64, distance: "euclidean" } },
    ],
    ["unknown bm25 tokenizer", { bm25: { ...policyInput().bm25, tokenizer: "whitespace" } }],
    ["non-empty stopwords", { bm25: { ...policyInput().bm25, stopwords: ["the"] } }],
    ["unknown bm25 stemmer", { bm25: { ...policyInput().bm25, stemmer: "snowball" } }],
  ])("rejects %s", (_label, overrides) => {
    expect(
      HybridRetrievalPolicyV1Schema.safeParse({ ...policyInput(), ...overrides }).success,
    ).toBe(false);
  });

  it("accepts the exact boundary topK == prefetch limits == member limit", () => {
    expect(
      HybridRetrievalPolicyV1Schema.safeParse({
        ...policyInput(),
        densePrefetchLimit: 5,
        bm25PrefetchLimit: 5,
        topK: 5,
        memberLimit: 5,
      }).success,
    ).toBe(true);
  });
});

describe("查询 Embedding 文本渲染", () => {
  const query = "盾构扩径施工掌子面稳定性失效";
  const instruction =
    "Given a Chinese engineering risk query, retrieve the applicable standard clauses";

  it("只在策略声明查询指令时按固定模板渲染，否则使用原查询文本", () => {
    expect(retrievalQueryEmbeddingText(query, makePolicy())).toBe(query);
    expect(retrievalQueryEmbeddingText(query, makePolicy({ queryInstruction: instruction }))).toBe(
      `Instruct: ${instruction}\nQuery:${query}`,
    );
  });

  it("查询指令必须是非空任务描述并去除首尾空白", () => {
    for (const queryInstruction of ["", "   "]) {
      expect(
        HybridRetrievalPolicyV1Schema.safeParse({ ...policyInput(), queryInstruction }).success,
      ).toBe(false);
    }
    expect(
      HybridRetrievalPolicyV1Schema.parse({
        ...policyInput(),
        queryInstruction: ` ${instruction} `,
      }).queryInstruction,
    ).toBe(instruction);
  });
});

describe("result schemas reject confidence, probability/consequence and matrix fields", () => {
  const hit = () => ({
    rank: 1,
    memberRef: {
      kind: "retrieval-member" as const,
      reference: versionRef(
        "retrieval-member:abc:risk-mechanism:mechanism-a",
        `sha256:${"c".repeat(64)}`,
      ),
    },
    sourceKind: "risk-mechanism" as const,
    sourceReleaseRef: knowledgeRelease("release-risk-mechanism"),
    sourceEntryId: "mechanism-a",
    contentDigest: "c".repeat(64),
    evidenceSourceVersionRefs: [],
    denseRank: 1,
    bm25Rank: 2,
    denseContribution: 1 / 61,
    bm25Contribution: 1 / 62,
    fusionScore: 0.0322,
  });

  const resultPayload = () => ({
    schemaVersion: "1" as const,
    queryId: "query-alpha",
    projectId: "project-alpha",
    actorId: "actor-retrieval",
    requestedAt: TIMESTAMP,
    completedAt: "2030-01-01T00:00:05.000Z",
    refs: {
      inputSnapshotRef: {
        kind: "identification-input-snapshot" as const,
        reference: versionRef("input-snapshot"),
      },
      workItemRef: {
        kind: "identification-work-item" as const,
        reference: versionRef("work-item"),
      },
      retrievalPolicyRef: versionRef("retrieval-policy", "v1"),
    },
    evidenceBaseReleaseRef: evidenceBaseRelease(),
    memberReleaseRefs: memberReleaseRefs(),
    generationRef: generationRef(),
    collectionName: retrievalCollectionNameFor(generationRef()),
    projectionCompatibilityRef: versionRef("projection-compatibility", "v1"),
    policyRef: versionRef("retrieval-policy", "v1"),
    modelDeploymentRef: versionRef("embedding-deployment", "v1"),
    embeddingDimensions: 64,
    bm25: bm25Config(),
    rrf: { k: 60, denseWeight: 1, bm25Weight: 1 },
    densePrefetchLimit: 20,
    bm25PrefetchLimit: 20,
    topK: 5,
    authorizationScopeDigest: SCOPE_DIGEST,
    authorizationContextRef,
    hits: [hit()],
    scoreSemantics: "ranking-signal-not-confidence" as const,
    knowledgeQueryResultRef: {
      kind: "knowledge-query-result" as const,
      reference: versionRef("query-result"),
    },
  });

  it.each([
    ["confidence", 0.87],
    ["probability", 0.31],
    ["consequence", 0.52],
    ["riskLevel", "high"],
    ["riskMatrix", { cell: "III-2" }],
    ["warningTrigger", true],
  ])("rejects a top-level %s field", (field, value) => {
    expect(
      HybridRetrievalResultPayloadV1Schema.safeParse({ ...resultPayload(), [field]: value })
        .success,
    ).toBe(false);
    expect(
      HybridRetrievalResultPayloadV1Schema.safeParse({
        ...resultPayload(),
        hits: [{ ...hit(), [field]: value }],
      }).success,
    ).toBe(false);
  });

  it("rejects a score-semantics literal that claims confidence", () => {
    expect(
      HybridRetrievalResultPayloadV1Schema.safeParse({
        ...resultPayload(),
        scoreSemantics: "confidence",
      }).success,
    ).toBe(false);
  });

  it("requires the content-addressed result artifact ref on the persisted result", () => {
    expect(HybridRetrievalResultPayloadV1Schema.safeParse(resultPayload()).success).toBe(true);
    expect(HybridRetrievalResultV1Schema.safeParse(resultPayload()).success).toBe(false);
    expect(
      HybridRetrievalResultV1Schema.safeParse({
        ...resultPayload(),
        resultArtifactRef: {
          kind: "content-artifact",
          reference: versionRef("retrieval-result", `sha256:${"d".repeat(64)}`),
        },
      }).success,
    ).toBe(true);
  });

  it("rejects confidence fields on the raw dual-route query result", () => {
    const queryResult = {
      collectionName: retrievalCollectionNameFor(generationRef()),
      generationRef: generationRef(),
      serviceVersion: "1.19.0",
      fused: [
        {
          pointId: "point-a",
          rank: 1,
          score: 0.0326,
          payload: pointPayloadFor(manifestFixture(), manifestFixture().members[0]!),
        },
      ],
      denseRoute: [{ pointId: "point-a", rank: 1, score: 0.91 }],
      bm25Route: [{ pointId: "point-a", rank: 2, score: 4.2 }],
      fusedQueryDurationMs: 12.5,
    };
    expect(RetrievalHybridQueryResultV1Schema.safeParse(queryResult).success).toBe(true);
    expect(
      RetrievalHybridQueryResultV1Schema.safeParse({ ...queryResult, confidence: 0.9 }).success,
    ).toBe(false);
    expect(
      RetrievalHybridQueryResultV1Schema.safeParse({
        ...queryResult,
        fused: [{ ...queryResult.fused[0], confidence: 0.9 }],
      }).success,
    ).toBe(false);
  });
});

describe("retrieval identity is deterministic and content addressed", () => {
  it("derives one stable generation identity and a new one for every changed input", () => {
    const baseline = generationRef();
    expect(retrievalGenerationRefFor(identityInputs())).toEqual(baseline);
    expect(baseline.kind).toBe("retrieval-generation");

    const mutations: [string, Record<string, unknown>][] = [
      ["projectId", { projectId: "project-beta" }],
      ["sourceEventId", { sourceEventId: "event-identification-basis-published-2" }],
      ["evidenceBaseReleaseRef", { evidenceBaseReleaseRef: evidenceBaseRelease("v2") }],
      [
        "riskMechanismRef",
        {
          memberReleaseRefs: {
            ...memberReleaseRefs(),
            riskMechanismRef: knowledgeRelease("release-risk-mechanism", "v2"),
          },
        },
      ],
      [
        "standardLibraryRef",
        {
          memberReleaseRefs: {
            ...memberReleaseRefs(),
            standardLibraryRef: knowledgeRelease("release-standard-library", "v2"),
          },
        },
      ],
      [
        "caseLibraryRef",
        {
          memberReleaseRefs: {
            ...memberReleaseRefs(),
            caseLibraryRef: knowledgeRelease("release-case-library", "v2"),
          },
        },
      ],
      ["policyRef", { policyRef: versionRef("retrieval-policy", "v2") }],
      ["modelDeploymentRef", { modelDeploymentRef: versionRef("embedding-deployment", "v2") }],
      [
        "projectionCompatibilityRef",
        { projectionCompatibilityRef: versionRef("projection-compatibility", "v2") },
      ],
    ];
    for (const [label, overrides] of mutations) {
      const mutated = retrievalGenerationRefFor(identityInputs(overrides));
      expect(mutated.reference.versionId, label).not.toBe(baseline.reference.versionId);
      if (label === "projectId") {
        expect(mutated.reference.entityId).not.toBe(baseline.reference.entityId);
      } else {
        expect(mutated.reference.entityId).toBe(baseline.reference.entityId);
      }
    }
    expect(baseline.reference.entityId).toBe("retrieval-generation:project-alpha:evidence-base");
  });

  it("derives stable, content-addressed member refs and point ids", () => {
    const digest = "a".repeat(64);
    const memberRefInput = {
      generationRef: generationRef(),
      sourceKind: "risk-mechanism" as const,
      sourceReleaseRef: knowledgeRelease("release-risk-mechanism"),
      sourceEntryId: "mechanism-a",
      contentDigest: digest,
    };
    const memberRef = retrievalMemberRefFor(memberRefInput);
    expect(retrievalMemberRefFor(memberRefInput)).toEqual(memberRef);
    expect(memberRef.reference.versionId).toBe(`sha256:${digest}`);
    expect(
      retrievalMemberRefFor({ ...memberRefInput, contentDigest: "b".repeat(64) }).reference
        .versionId,
    ).toBe(`sha256:${"b".repeat(64)}`);
    expect(
      retrievalMemberRefFor({ ...memberRefInput, sourceEntryId: "mechanism-b" }).reference.entityId,
    ).not.toBe(memberRef.reference.entityId);
    expect(
      retrievalMemberRefFor({
        ...memberRefInput,
        generationRef: retrievalGenerationRefFor(identityInputs({ projectId: "project-beta" })),
      }).reference.entityId,
    ).not.toBe(memberRef.reference.entityId);

    const pointId = retrievalMemberPointId(digest);
    expect(retrievalMemberPointId(digest)).toBe(pointId);
    expect(pointId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(pointId).toHaveLength(36);
    expect(retrievalMemberPointId("b".repeat(64))).not.toBe(pointId);
    expect(retrievalMemberContentDigest("坝基管涌")).toMatch(/^[0-9a-f]{64}$/u);
    expect(retrievalMemberContentDigest("坝基管涌")).toBe(retrievalMemberContentDigest("坝基管涌"));
    expect(retrievalMemberContentDigest("坝基管涌")).not.toBe(
      retrievalMemberContentDigest("坝坡滑塌"),
    );
  });

  it("derives deterministic per-generation collection names", () => {
    const name = retrievalCollectionNameFor(generationRef());
    expect(retrievalCollectionNameFor(generationRef())).toBe(name);
    expect(name).toMatch(/^riskflow-retrieval-[0-9a-f]{32}$/u);
    expect(
      retrievalCollectionNameFor(
        retrievalGenerationRefFor(
          identityInputs({ policyRef: versionRef("retrieval-policy", "v2") }),
        ),
      ),
    ).not.toBe(name);
  });

  it("binds projection compatibility to the service line, vector names and BM25 config", () => {
    const policy = makePolicy();
    const baseline = projectionCompatibilityRefFor({ serviceVersion: "1.19.0", policy });
    expect(projectionCompatibilityRefFor({ serviceVersion: "1.19.0", policy })).toEqual(baseline);
    expect(projectionCompatibilityRefFor({ serviceVersion: "1.19.3", policy })).toEqual(baseline);
    expect(projectionCompatibilityRefFor({ serviceVersion: "1.20.0", policy })).not.toEqual(
      baseline,
    );
    expect(
      projectionCompatibilityRefFor({
        serviceVersion: "1.19.0",
        policy: makePolicy({ dense: { vectorName: "dense", dimensions: 128, distance: "cosine" } }),
      }),
    ).not.toEqual(baseline);
  });

  it("digests only the resource scope of an authorization context", () => {
    const reordered: AuthorizationContextV1 = {
      ...authorization,
      actorId: "another-actor",
      spatialScopeRefs: [...authorization.spatialScopeRefs],
      sourceAccessGrantRefs: [...authorization.sourceAccessGrantRefs],
    };
    expect(authorizationScopeDigest(reordered)).toBe(authorizationScopeDigest(authorization));
    expect(
      authorizationScopeDigest({
        ...authorization,
        sourceAccessGrantRefs: [
          ...authorization.sourceAccessGrantRefs,
          { kind: "source-access-grant", reference: versionRef("grant-b") },
        ],
      }),
    ).not.toBe(authorizationScopeDigest(authorization));
  });
});

describe("member normalization", () => {
  it("returns a sorted manifest whose digests come from the frozen text projection", () => {
    const outcome = normalize();
    if (outcome.kind !== "succeeded")
      throw new Error(`expected success, got ${outcome.detailCode}`);
    const sources = memberSources();
    const expectedOrder = [
      "case-library/case-1",
      "risk-mechanism/mechanism-a",
      "risk-mechanism/mechanism-b",
      "standard-library/std-1",
    ];
    expect(outcome.manifest.members.map((m) => `${m.sourceKind}/${m.sourceEntryId}`)).toEqual(
      expectedOrder,
    );
    expect(outcome.points).toHaveLength(4);
    expect(new Set(outcome.manifest.members.map((member) => member.sourceKind))).toEqual(
      new Set(RETRIEVAL_SOURCE_KINDS_V1),
    );
    for (const member of outcome.manifest.members) {
      const source = sources.find((s) => s.sourceKind === member.sourceKind)!;
      const raw = source.entries.find((e) => e.entryId === member.sourceEntryId)!;
      const text = retrievalMemberText(member.sourceKind, raw.entry);
      expect(member.contentDigest, member.sourceEntryId).toBe(retrievalMemberContentDigest(text));
      expect(member.pointId).toBe(retrievalMemberPointId(sha256CanonicalJson(member.memberRef)));
      expect(member.memberRef.reference.versionId).toBe(`sha256:${member.contentDigest}`);
      expect(member.authorizationScopeDigest).toBe(SCOPE_DIGEST);
      expect(member.denseDimensions).toBe(64);
      expect(member.bm25Language).toBe("chinese");
      expect(member.sourceReleaseRef).toEqual(source.sourceReleaseRef);
    }
    const again = normalize();
    if (again.kind !== "succeeded") throw new Error("expected success");
    expect(again.manifest.membersSha256).toBe(outcome.manifest.membersSha256);
    expect(again.manifest.membersSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(RetrievalIndexManifestV1Schema.safeParse(outcome.manifest).success).toBe(true);
  });

  it("把规范正文纳入成员投影文本与内容摘要", () => {
    const entry = {
      entryId: "std-1",
      level: "行业标准",
      standardIdentity: "SL 795-2016",
      standardVersion: "2016",
      clauseRefs: ["5.2.3"],
      retrievalText: "5.2.3 盾构开仓前应编制专项方案并设置防渗措施。",
    };
    const sources = memberSources().map((source) =>
      source.sourceKind === "standard-library"
        ? { ...source, entries: [{ entryId: "std-1", entry }] }
        : source,
    );
    const outcome = normalize({ sources });
    if (outcome.kind !== "succeeded")
      throw new Error(`expected success, got ${outcome.detailCode}`);
    const member = outcome.manifest.members.find((m) => m.sourceKind === "standard-library")!;
    const text = retrievalMemberText("standard-library", entry);
    expect(text).toContain("盾构开仓前应编制专项方案并设置防渗措施。");
    expect(text.endsWith("\n5.2.3 盾构开仓前应编制专项方案并设置防渗措施。")).toBe(true);
    expect(member.contentDigest).toBe(retrievalMemberContentDigest(text));
    // 同一规范条目在有无正文时摘要必须不同：正文本身进入投影。
    const baseline = normalize();
    if (baseline.kind !== "succeeded") throw new Error("baseline normalization must succeed");
    const baselineMember = baseline.manifest.members.find(
      (m) => m.sourceKind === "standard-library",
    )!;
    expect(member.contentDigest).not.toBe(baselineMember.contentDigest);
    expect(member.pointId).not.toBe(baselineMember.pointId);
  });

  it("keeps distinct members with identical projected text as separate points", () => {
    const sources = memberSources().map((source) =>
      source.sourceKind === "risk-mechanism"
        ? { ...source, entries: [{ entryId: "same", entry: { mechanismId: "same" } }] }
        : source.sourceKind === "standard-library"
          ? { ...source, entries: [{ entryId: "same", entry: { entryId: "same" } }] }
          : source,
    );
    const outcome = normalize({ sources });
    expect(outcome.kind).toBe("succeeded");
    if (outcome.kind !== "succeeded") return;
    expect(outcome.manifest.members).toHaveLength(3);
    expect(new Set(outcome.manifest.members.map((member) => member.pointId)).size).toBe(3);
    expect(outcome.manifest.members[1]?.contentDigest).toBe(
      outcome.manifest.members[2]?.contentDigest,
    );
  });

  it("requires all three source kinds exactly once", () => {
    const cases: [string, RetrievalMemberSourceV1[], string][] = [
      [
        "missing-source-kind",
        memberSources().filter((s) => s.sourceKind !== "case-library"),
        "missing-source-case-library",
      ],
      ["duplicate-source-kind", [...memberSources(), memberSources()[0]!], "duplicate-source-kind"],
      [
        "empty-source",
        memberSources().map((s) =>
          s.sourceKind === "standard-library" ? { ...s, entries: [] } : s,
        ),
        "empty-source-standard-library",
      ],
      [
        "duplicate-entry-id",
        memberSources().map((s) =>
          s.sourceKind === "risk-mechanism" ? { ...s, entries: [s.entries[1]!, s.entries[1]!] } : s,
        ),
        "duplicate-entry-risk-mechanism/mechanism-a",
      ],
      [
        "empty-entry",
        memberSources().map((s) =>
          s.sourceKind === "case-library"
            ? { ...s, entries: [{ entryId: "case-1", entry: {} }] }
            : s,
        ),
        "empty-entry-case-library/case-1",
      ],
    ];
    for (const [label, sources, detailCode] of cases) {
      const outcome = normalize({ sources });
      expect(outcome, label).toMatchObject({
        kind: "failed",
        code: "SOURCE_FACT_DRIFT",
        detailCode,
      });
    }
  });

  it("rejects a member count above the policy limit", () => {
    const outcome = normalize({
      policy: makePolicy({ densePrefetchLimit: 3, bm25PrefetchLimit: 3, topK: 3, memberLimit: 3 }),
    });
    expect(outcome).toMatchObject({
      kind: "failed",
      code: "RESOURCE_LIMIT_EXCEEDED",
      detailCode: "member-count",
    });
  });

  it("rejects member text above the policy byte limit", () => {
    const outcome = normalize({ policy: makePolicy({ memberByteLimit: 8 }) });
    expect(outcome).toMatchObject({ kind: "failed", code: "RESOURCE_LIMIT_EXCEEDED" });
    if (outcome.kind !== "failed") throw new Error("expected failure");
    expect(outcome.detailCode).toMatch(/^member-bytes-/u);
  });
});

describe("generation state machine", () => {
  const statuses: readonly RetrievalGenerationStatusV1[] = [
    "building",
    "ready",
    "active",
    "superseded",
    "failed",
  ];
  const allowed: Record<RetrievalGenerationStatusV1, readonly RetrievalGenerationStatusV1[]> = {
    building: ["ready", "failed"],
    ready: ["active", "failed"],
    active: ["superseded"],
    superseded: [],
    failed: [],
  };

  it.each(statuses.flatMap((from) => statuses.map((to) => [from, to] as const)))(
    "%s -> %s follows the frozen transition table",
    (from, to) => {
      expect(assertGenerationTransition(from, to)).toBe(allowed[from].includes(to));
    },
  );
});

describe("dual-index manifest reconciliation", () => {
  const manifest = manifestFixture();

  it("accepts a fully consistent observation", () => {
    const reconciliation = reconcileDualIndexManifest({
      projectId: manifest.projectId,
      expected: manifest,
      observed: observationFor(manifest),
    });
    expect(reconciliation).toEqual({
      consistent: true,
      checkedMemberCount: manifest.members.length,
      differences: [],
    });
  });

  it.each([
    [
      "a member point is missing",
      (points: Record<string, unknown>[]) => points.slice(1),
      "MEMBER_MISSING",
    ],
    [
      "an unexpected extra point exists",
      (points: Record<string, unknown>[]) => [...points, { ...points[0], pointId: "point-extra" }],
      "MEMBER_UNEXPECTED",
    ],
    [
      "the dense vector is missing",
      (points: Record<string, unknown>[]) =>
        points.map((point, index) => (index === 0 ? { ...point, hasDenseVector: false } : point)),
      "DENSE_VECTOR_MISSING",
    ],
    [
      "the sparse vector is missing",
      (points: Record<string, unknown>[]) =>
        points.map((point, index) => (index === 0 ? { ...point, hasSparseVector: false } : point)),
      "SPARSE_VECTOR_MISSING",
    ],
    [
      "the dense dimension differs",
      (points: Record<string, unknown>[]) =>
        points.map((point, index) => (index === 0 ? { ...point, denseDimensions: 32 } : point)),
      "DIMENSION_MISMATCH",
    ],
    [
      "the payload content digest differs",
      (points: Record<string, unknown>[]) =>
        points.map((point, index) =>
          index === 0
            ? { ...point, payload: { ...(point.payload as object), contentDigest: "e".repeat(64) } }
            : point,
        ),
      "CONTENT_DIGEST_MISMATCH",
    ],
    [
      "the payload scope digest differs",
      (points: Record<string, unknown>[]) =>
        points.map((point, index) =>
          index === 0
            ? {
                ...point,
                payload: { ...(point.payload as object), authorizationScopeDigest: "f".repeat(64) },
              }
            : point,
        ),
      "SCOPE_DIGEST_MISMATCH",
    ],
    [
      "the payload belongs to another source entry",
      (points: Record<string, unknown>[]) =>
        points.map((point, index) =>
          index === 0
            ? { ...point, payload: { ...(point.payload as object), sourceEntryId: "other-entry" } }
            : point,
        ),
      "SOURCE_REFERENCE_MISMATCH",
    ],
    [
      "the payload belongs to another project",
      (points: Record<string, unknown>[]) =>
        points.map((point, index) =>
          index === 0
            ? { ...point, payload: { ...(point.payload as object), projectId: "project-beta" } }
            : point,
        ),
      "SOURCE_REFERENCE_MISMATCH",
    ],
    [
      "the payload generation key differs",
      (points: Record<string, unknown>[]) =>
        points.map((point, index) =>
          index === 0
            ? { ...point, payload: { ...(point.payload as object), generationKey: "sha256:other" } }
            : point,
        ),
      "SOURCE_REFERENCE_MISMATCH",
    ],
    [
      "the payload is absent",
      (points: Record<string, unknown>[]) =>
        points.map((point, index) =>
          index === 0
            ? Object.fromEntries(Object.entries(point).filter(([key]) => key !== "payload"))
            : point,
        ),
      "PAYLOAD_MISSING",
    ],
  ])("reports %s as %s", (_label, mutate, expectedCode) => {
    const reconciliation = reconcileDualIndexManifest({
      projectId: manifest.projectId,
      expected: manifest,
      observed: observationFor(manifest, mutate as never),
    });
    expect(reconciliation.consistent).toBe(false);
    expect(reconciliation.differences.map((difference) => difference.code)).toContain(expectedCode);
    expect(reconciliation.checkedMemberCount).toBe(manifest.members.length);
  });

  it("reports an incomplete scan as a missing member", () => {
    const reconciliation = reconcileDualIndexManifest({
      projectId: manifest.projectId,
      expected: manifest,
      observed: observationFor(manifest, (points) => points, { complete: false }),
    });
    expect(reconciliation.consistent).toBe(false);
    expect(reconciliation.differences).toContainEqual({
      code: "MEMBER_MISSING",
      detailCode: "incomplete-scan",
    });
  });

  it("reports a generation mismatch when the observation belongs to another generation", () => {
    const other = retrievalGenerationRefFor(identityInputs({ projectId: "project-beta" }));
    const reconciliation = reconcileDualIndexManifest({
      projectId: manifest.projectId,
      expected: manifest,
      observed: observationFor(manifest, (points) => points, { generationRef: other }),
    });
    expect(reconciliation.consistent).toBe(false);
    expect(reconciliation.differences).toContainEqual({ code: "GENERATION_MISMATCH" });
  });
});

describe("RRF result reconciliation", () => {
  const fusedPayload = pointPayloadFor(manifestFixture(), manifestFixture().members[0]!);
  const rrfPolicy = () => makePolicy({ densePrefetchLimit: 3, bm25PrefetchLimit: 3, topK: 3 });

  const rrfResult = (overrides: Record<string, unknown> = {}) =>
    RetrievalHybridQueryResultV1Schema.parse({
      collectionName: retrievalCollectionNameFor(generationRef()),
      generationRef: generationRef(),
      serviceVersion: "1.19.0",
      fused: [
        { pointId: "point-b", rank: 1, score: 0.0327, payload: fusedPayload },
        { pointId: "point-a", rank: 2, score: 0.0325, payload: fusedPayload },
        { pointId: "point-c", rank: 3, score: 0.0321, payload: fusedPayload },
      ],
      denseRoute: [
        { pointId: "point-a", rank: 1, score: 0.91 },
        { pointId: "point-b", rank: 2, score: 0.88 },
        { pointId: "point-c", rank: 3, score: 0.81 },
      ],
      bm25Route: [
        { pointId: "point-b", rank: 1, score: 5.4 },
        { pointId: "point-c", rank: 2, score: 4.9 },
        { pointId: "point-a", rank: 3, score: 3.2 },
      ],
      fusedQueryDurationMs: 12.5,
      ...overrides,
    });

  it("accepts a fused order that matches the policy contributions", () => {
    expect(reconcileRrfResult({ policy: rrfPolicy(), result: rrfResult() })).toEqual({
      consistent: true,
      checkedMemberCount: 3,
      differences: [],
    });
  });

  it("rejects a fused order inconsistent with the policy contributions", () => {
    const swapped = rrfResult({
      fused: [
        { pointId: "point-a", rank: 1, score: 0.0327, payload: fusedPayload },
        { pointId: "point-b", rank: 2, score: 0.0325, payload: fusedPayload },
        { pointId: "point-c", rank: 3, score: 0.0321, payload: fusedPayload },
      ],
    });
    const reconciliation = reconcileRrfResult({ policy: rrfPolicy(), result: swapped });
    expect(reconciliation.consistent).toBe(false);
    expect(reconciliation.differences).toContainEqual({
      code: "MEMBER_UNEXPECTED",
      detailCode: "fusion-order-mismatch",
    });
  });

  it("changes the expected order when only the policy k changes", () => {
    const slowRanks = rrfResult({
      fused: [
        { pointId: "point-y", rank: 1, score: 0.0323, payload: fusedPayload },
        { pointId: "point-x", rank: 2, score: 0.0321, payload: fusedPayload },
      ],
      denseRoute: [
        { pointId: "point-x", rank: 1, score: 0.91 },
        { pointId: "point-y", rank: 2, score: 0.88 },
      ],
      bm25Route: [
        { pointId: "point-f1", rank: 1, score: 6.1 },
        { pointId: "point-y", rank: 2, score: 5.4 },
        { pointId: "point-f3", rank: 3, score: 4.2 },
        { pointId: "point-x", rank: 4, score: 3.1 },
      ],
    });
    const rankPolicy = makePolicy({ densePrefetchLimit: 4, bm25PrefetchLimit: 4, topK: 2 });
    const smallK = makePolicy({
      densePrefetchLimit: 4,
      bm25PrefetchLimit: 4,
      topK: 2,
      rrf: { k: 1, denseWeight: 1, bm25Weight: 1 },
    });
    expect(reconcileRrfResult({ policy: rankPolicy, result: slowRanks }).consistent).toBe(true);
    expect(reconcileRrfResult({ policy: smallK, result: slowRanks }).consistent).toBe(false);
  });

  it("changes the expected contributions when the policy weights change", () => {
    const denseHeavy = makePolicy({
      densePrefetchLimit: 3,
      bm25PrefetchLimit: 3,
      topK: 3,
      rrf: { k: 60, denseWeight: 2, bm25Weight: 0.05 },
    });
    const bm25Heavy = makePolicy({
      densePrefetchLimit: 3,
      bm25PrefetchLimit: 3,
      topK: 3,
      rrf: { k: 60, denseWeight: 0.1, bm25Weight: 1 },
    });
    expect(reconcileRrfResult({ policy: rrfPolicy(), result: rrfResult() }).consistent).toBe(true);
    expect(reconcileRrfResult({ policy: bm25Heavy, result: rrfResult() }).consistent).toBe(false);
    expect(reconcileRrfResult({ policy: denseHeavy, result: rrfResult() }).consistent).toBe(false);
  });

  it("rejects a fused list longer than topK", () => {
    const reconciliation = reconcileRrfResult({
      policy: makePolicy({ densePrefetchLimit: 3, bm25PrefetchLimit: 3, topK: 2 }),
      result: rrfResult(),
    });
    expect(reconciliation.consistent).toBe(false);
    expect(reconciliation.differences).toContainEqual({
      code: "MEMBER_UNEXPECTED",
      detailCode: "fused-exceeds-topK",
    });
  });

  it("rejects an empty route instead of degrading to a single-route result", () => {
    const reconciliation = reconcileRrfResult({
      policy: rrfPolicy(),
      result: rrfResult({ denseRoute: [] }),
    });
    expect(reconciliation.consistent).toBe(false);
    expect(reconciliation.differences).toContainEqual({
      code: "MEMBER_MISSING",
      detailCode: "route-empty",
    });
  });

  it("rejects a fused hit that appears in neither route", () => {
    const reconciliation = reconcileRrfResult({
      policy: rrfPolicy(),
      result: rrfResult({
        fused: [
          { pointId: "point-b", rank: 1, score: 0.0327, payload: fusedPayload },
          { pointId: "point-z", rank: 2, score: 0.0325, payload: fusedPayload },
          { pointId: "point-a", rank: 3, score: 0.0321, payload: fusedPayload },
        ],
      }),
    });
    expect(reconciliation.consistent).toBe(false);
    expect(reconciliation.differences).toContainEqual({
      code: "MEMBER_UNEXPECTED",
      detailCode: "unranked-point-z",
    });
  });

  it("rejects a fused order whose scores are not monotonic", () => {
    const reconciliation = reconcileRrfResult({
      policy: rrfPolicy(),
      result: rrfResult({
        fused: [
          { pointId: "point-b", rank: 1, score: 0.01, payload: fusedPayload },
          { pointId: "point-a", rank: 2, score: 0.9, payload: fusedPayload },
          { pointId: "point-c", rank: 3, score: 0.03, payload: fusedPayload },
        ],
      }),
    });
    expect(reconciliation.consistent).toBe(false);
    expect(reconciliation.differences).toContainEqual({
      code: "MEMBER_UNEXPECTED",
      detailCode: "fused-score-not-monotonic",
    });
  });
});

describe("retrieval acceptance gates", () => {
  const acceptancePolicy = (overrides: Record<string, unknown> = {}) =>
    HybridRetrievalAcceptancePolicyV1Schema.parse({
      schemaVersion: "1",
      acceptancePolicyRef: versionRef("retrieval-acceptance-policy", "v1"),
      datasetRef: versionRef("synthetic-hybrid-retrieval-dataset", "v1"),
      syntheticSample: true,
      topK: 5,
      denseRecallAt5Min: 0.8,
      bm25RecallAt5Min: 0.8,
      rrfRecallAt5Min: 0.9,
      rrfNdcgAt5Min: 0.85,
      reconciliationRatioMin: 1,
      authorizationLeakageMax: 0,
      qdrantQueryP95MsMax: 500,
      warmupRuns: 20,
      measuredRuns: 200,
      ...overrides,
    });

  const measurements = (overrides: Record<string, unknown> = {}) =>
    HybridRetrievalAcceptanceMeasurementsV1Schema.parse({
      denseRecallAt5: 0.95,
      bm25RecallAt5: 0.92,
      rrfRecallAt5: 0.98,
      rrfNdcgAt5: 0.93,
      reconciliationRatio: 1,
      authorizationLeakage: 0,
      qdrantQueryP95Ms: 180,
      queryCount: 12,
      memberCount: 6,
      p95SampleCount: 200,
      environment: {
        nodeVersion: "v24.0.0",
        containerRuntime: "docker-29.7.2",
        qdrantServiceRef: "qdrant/qdrant:v1.19.0",
        cpuModel: "Intel Xeon E5-2680 v4",
        platform: "linux-x64",
      },
      measuredAt: TIMESTAMP,
      ...overrides,
    });

  it("passes overall only when every hard gate passes independently", () => {
    const report = evaluateRetrievalAcceptance({
      policy: acceptancePolicy(),
      measurements: measurements(),
    });
    expect(report.overall).toBe("passed");
    expect(report.gates.map((gate) => gate.gateId)).toEqual([...RETRIEVAL_ACCEPTANCE_GATE_IDS_V1]);
    expect(report.gates.every((gate) => gate.passed)).toBe(true);
  });

  it.each([
    ["dense-recall-at-5", "denseRecallAt5", 0.79],
    ["bm25-recall-at-5", "bm25RecallAt5", 0.79],
    ["rrf-recall-at-5", "rrfRecallAt5", 0.89],
    ["rrf-ndcg-at-5", "rrfNdcgAt5", 0.84],
    ["dual-index-reconciliation", "reconciliationRatio", 0.99],
    ["authorization-leakage", "authorizationLeakage", 1],
    ["qdrant-query-p95-ms", "qdrantQueryP95Ms", 501],
  ] as const)("fails overall when only %s misses its threshold", (gateId, field, value) => {
    const report = evaluateRetrievalAcceptance({
      policy: acceptancePolicy(),
      measurements: measurements({ [field]: value }),
    });
    expect(report.overall).toBe("failed");
    expect(report.gates.filter((gate) => !gate.passed).map((gate) => gate.gateId)).toEqual([
      gateId,
    ]);
    const failed = report.gates.find((gate) => gate.gateId === gateId)!;
    expect(failed.observed).toBe(value);
  });

  it("covers every declared acceptance gate id in the failure table", () => {
    const covered = [
      "dense-recall-at-5",
      "bm25-recall-at-5",
      "rrf-recall-at-5",
      "rrf-ndcg-at-5",
      "dual-index-reconciliation",
      "authorization-leakage",
      "qdrant-query-p95-ms",
    ];
    expect([...RETRIEVAL_ACCEPTANCE_GATE_IDS_V1]).toEqual(covered);
  });

  it("carries the pending-review notice for a synthetic dataset", () => {
    const synthetic = evaluateRetrievalAcceptance({
      policy: acceptancePolicy(),
      measurements: measurements(),
    });
    expect(synthetic.syntheticSample).toBe(true);
    expect(synthetic.sampleNotice).toBe("合成样本、待甲方复核");
    expect(
      HybridRetrievalAcceptanceReportV1Schema.safeParse({ ...synthetic, sampleNotice: undefined })
        .success,
    ).toBe(false);

    const realSample = evaluateRetrievalAcceptance({
      policy: acceptancePolicy({ syntheticSample: false }),
      measurements: measurements(),
    });
    expect(realSample.syntheticSample).toBe(false);
    expect(realSample.sampleNotice).toBeUndefined();
  });
});

describe("internal failure to public module error mapping", () => {
  const mappings: readonly (readonly [
    HybridRetrievalFailureCodeV1,
    HybridRetrievalFailureStageV1,
    string,
    boolean,
  ])[] = [
    ["AUTHORIZATION_DENIED", "authorization", "AUTHORIZATION_DENIED", false],
    ["AUTHORIZATION_RECONCILIATION_FAILED", "authorization", "AUTHORIZATION_DENIED", false],
    ["IDEMPOTENCY_CONFLICT", "query", "IDEMPOTENCY_CONFLICT", false],
    ["GENERATION_NOT_READY", "query", "BUSINESS_BLOCKED", false],
    ["POLICY_NOT_FOUND", "query", "BUSINESS_BLOCKED", false],
    ["POLICY_INCOMPATIBLE", "query", "BUSINESS_BLOCKED", false],
    ["DUAL_INDEX_MISMATCH", "reconciliation", "BUSINESS_BLOCKED", false],
    ["QUALITY_GATE_FAILED", "quality", "BUSINESS_BLOCKED", false],
    ["ACTIVATION_CONFLICT", "activation", "BUSINESS_BLOCKED", false],
    ["RETRIEVAL_INPUT_DRIFT", "query", "BUSINESS_BLOCKED", false],
    ["SOURCE_FACT_DRIFT", "source-read", "BUSINESS_BLOCKED", false],
    ["QDRANT_UNAVAILABLE", "projection", "TRANSIENT_FAILURE", true],
    ["EMBEDDING_FAILED", "embedding", "TRANSIENT_FAILURE", true],
    ["RESULT_PERSISTENCE_FAILED", "result-persistence", "TRANSIENT_FAILURE", true],
    ["UNSUPPORTED_EVENT_VERSION", "event", "TERMINAL_FAILURE", false],
    ["RESOURCE_LIMIT_EXCEEDED", "projection", "TERMINAL_FAILURE", false],
    ["EMBEDDING_DIMENSION_MISMATCH", "embedding", "TERMINAL_FAILURE", false],
    ["QDRANT_INVALID_RESPONSE", "projection", "TERMINAL_FAILURE", false],
    ["FUSION_RECONCILIATION_FAILED", "reconciliation", "TERMINAL_FAILURE", false],
  ];

  const blockerRef: ContractReferenceV1 = {
    kind: "identification-input-snapshot",
    reference: versionRef("input-snapshot"),
  };

  it("maps every declared failure code to a schema-valid module error", () => {
    expect(mappings.map(([code]) => code).sort()).toEqual(
      [...HYBRID_RETRIEVAL_FAILURE_CODES_V1].sort(),
    );
  });

  it.each(mappings)("%s maps to %s", (code, stage, expectedCode, expectedRetryable) => {
    const failure = hybridRetrievalFailure({
      stage,
      code,
      detailCode: "detail-code",
      occurredAt: TIMESTAMP,
      projectId: "project-alpha",
      queryId: "query-alpha",
    });
    const error = mapHybridFailureToModuleError({
      failure,
      causalRunId: "query-alpha",
      authorizationPolicyRef: authorization.authorizationPolicyRef,
      blockerRef,
      idempotencyKey: "idempotency-alpha",
      priorCommandId: "command-alpha",
    });
    expect(ModuleErrorV1Schema.safeParse(error).success, code).toBe(true);
    expect(error.code).toBe(expectedCode);
    expect(error.retryable).toBe(expectedRetryable);
    expect(error.stageCode).toBe(`hybrid-retrieval.${stage}`);
    if (error.code === "BUSINESS_BLOCKED") expect(error.blockerKind).toBe(code);
    if (error.code === "AUTHORIZATION_DENIED") {
      expect(error.category).toBe("authorization");
      expect(error.requiredCapability).toBe("knowledge-modeling.retrieve");
    }
    if (error.code === "IDEMPOTENCY_CONFLICT") expect(error.category).toBe("idempotency");
    if (error.code === "TRANSIENT_FAILURE") expect(error.category).toBe("technical");
  });
});
