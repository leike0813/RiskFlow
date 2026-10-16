import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HYBRID_RETRIEVAL_SCHEMA_VERSION_V1,
  HybridRetrievalPolicyV1Schema,
  RETRIEVAL_SOURCE_KINDS_V1,
  normalizeRetrievalMembers,
  retrievalCollectionNameFor,
  retrievalGenerationRefFor,
  type HybridRetrievalPolicyV1,
  type RetrievalGenerationRefV1,
  type RetrievalHybridQueryV1,
  type RetrievalIndexManifestV1,
  type RetrievalMemberManifestEntryV1,
  type RetrievalSourceKindV1,
} from "@riskflow/core/retrieval";

import {
  QdrantRetrievalProjection,
  QdrantRetrievalProjectionError,
} from "../../src/retrieval/qdrant-rest-client.js";
import {
  QDRANT_TEST_SERVICE_VERSION,
  startQdrantRetrievalFixture,
  type QdrantRetrievalFixture,
} from "./qdrant-container.js";

/**
 * Qdrant 检索投影 adapter 的真实服务契约测试（design D4/D7/D9/D11）：
 * 所有断言都打在真实 Qdrant 1.19.0 上，不使用协议 Mock 证明 adapter 行为；
 * 仅在非法响应与不可达端点两个失败路径上注入 fetch double（adapter 仍走真实代码路径）。
 */

const PROJECT_ID = "project-hybrid-alpha";
const AUTHORIZATION_SCOPE_DIGEST = "9c".repeat(32);
const DIMENSIONS = 8;
const BM25_UNIQUE_TOKEN = "SL274-2020";

const DENSE_QUERY_VECTOR: readonly number[] = [1, 0, 0, 0, 0, 0, 0, 0];
const DENSE_BY_ENTRY_ID: Readonly<Record<string, readonly number[]>> = {
  "rm-seepage-piping": DENSE_QUERY_VECTOR,
  "std-slope-001": [0, 1, 0, 0, 0, 0, 0, 0],
  "case-dam-toe": [0, 0, 1, 0, 0, 0, 0, 0],
};

const riskMechanismReleaseRef = {
  kind: "knowledge-release" as const,
  reference: { entityId: "release-risk-mechanism", versionId: "v1" },
};
const standardLibraryReleaseRef = {
  kind: "knowledge-release" as const,
  reference: { entityId: "release-standard-library", versionId: "v1" },
};
const caseLibraryReleaseRef = {
  kind: "knowledge-release" as const,
  reference: { entityId: "release-case-library", versionId: "v1" },
};
const RELEASE_REF_BY_KIND: Readonly<Record<RetrievalSourceKindV1, typeof riskMechanismReleaseRef>> =
  {
    "risk-mechanism": riskMechanismReleaseRef,
    "standard-library": standardLibraryReleaseRef,
    "case-library": caseLibraryReleaseRef,
  };

const ENTRY_BY_KIND: Readonly<
  Record<
    RetrievalSourceKindV1,
    { readonly entryId: string; readonly entry: Readonly<Record<string, unknown>> }
  >
> = {
  "risk-mechanism": {
    entryId: "rm-seepage-piping",
    entry: {
      mechanismId: "rm-seepage-piping",
      mechanismType: "渗流管涌",
      nodeIds: ["node-dam-toe"],
      preconditions: ["坝基砂砾层连续"],
      triggeringFactors: ["库水位快速下降"],
      evolutionPath: "细粒流失形成管涌通道",
      consequences: ["坝基渗透破坏"],
    },
  },
  "standard-library": {
    entryId: "std-slope-001",
    entry: {
      entryId: "std-slope-001",
      level: "national",
      standardIdentity: "土石坝设计规范",
      standardVersion: BM25_UNIQUE_TOKEN,
      clauseRefs: ["8.3.2 坝坡稳定与泄流能力校核"],
    },
  },
  "case-library": {
    entryId: "case-dam-toe",
    entry: {
      entryId: "case-dam-toe",
      constructionMethod: "均质土坝分层碾压",
      engineeringConditions: ["弱透水坝基"],
      process: "初期蓄水后坝后排水棱体出浑水",
      events: ["下游坝脚出现渗水点"],
      outcomes: ["坝体未失稳"],
      treatments: ["增设反滤层"],
    },
  },
};

const buildPolicy = (overrides?: {
  readonly dimensions?: number;
  readonly distance?: "cosine" | "dot" | "euclid";
}): HybridRetrievalPolicyV1 =>
  HybridRetrievalPolicyV1Schema.parse({
    schemaVersion: HYBRID_RETRIEVAL_SCHEMA_VERSION_V1,
    policyRef: { entityId: "retrieval-policy", versionId: "v1" },
    evidenceBaseDefinitionType: "retrieval-evidence-base",
    modelDeploymentRef: { entityId: "embedding-deployment", versionId: "v1" },
    dense: {
      vectorName: "dense",
      dimensions: overrides?.dimensions ?? DIMENSIONS,
      distance: overrides?.distance ?? "cosine",
    },
    bm25: {
      vectorName: "bm25",
      model: "qdrant/bm25",
      tokenizer: "multilingual",
      language: "chinese",
      stemmer: "none",
      stopwords: [],
    },
    densePrefetchLimit: 4,
    bm25PrefetchLimit: 4,
    topK: 3,
    rrf: { k: 60, denseWeight: 1, bm25Weight: 1 },
    memberBatchLimit: 2,
    memberByteLimit: 4096,
    memberLimit: 16,
    embeddingTimeoutMs: 5_000,
    projectionTimeoutMs: 15_000,
    acceptancePolicyRef: { entityId: "retrieval-acceptance-policy", versionId: "v1" },
    projectionCompatibilityRef: {
      entityId: "retrieval-projection-compatibility",
      versionId: "qdrant-1.19-v1",
    },
  });

const policy = buildPolicy();

const generationFor = (sourceEventId: string): RetrievalGenerationRefV1 =>
  retrievalGenerationRefFor({
    projectId: PROJECT_ID,
    sourceEventId,
    evidenceBaseReleaseRef: {
      kind: "retrieval-evidence-base-release",
      reference: { entityId: "evidence-base-alpha", versionId: "v1" },
    },
    memberReleaseRefs: {
      riskMechanismRef: riskMechanismReleaseRef,
      standardLibraryRef: standardLibraryReleaseRef,
      caseLibraryRef: caseLibraryReleaseRef,
    },
    policyRef: policy.policyRef,
    modelDeploymentRef: policy.modelDeploymentRef,
    projectionCompatibilityRef: policy.projectionCompatibilityRef,
  });

const expectedPayload = (
  manifest: RetrievalIndexManifestV1,
  member: RetrievalMemberManifestEntryV1,
): Readonly<Record<string, unknown>> => ({
  schemaVersion: HYBRID_RETRIEVAL_SCHEMA_VERSION_V1,
  projectId: manifest.projectId,
  generationRef: manifest.generationRef,
  generationKey: manifest.generationRef.reference.versionId,
  sourceKind: member.sourceKind,
  sourceReleaseRef: member.sourceReleaseRef,
  sourceEntryId: member.sourceEntryId,
  contentDigest: member.contentDigest,
  authorizationScopeDigest: member.authorizationScopeDigest,
});

const PAYLOAD_KEYS = [
  "authorizationScopeDigest",
  "contentDigest",
  "generationKey",
  "generationRef",
  "projectId",
  "schemaVersion",
  "sourceEntryId",
  "sourceKind",
  "sourceReleaseRef",
];

interface MemberFixture {
  readonly manifest: RetrievalIndexManifestV1;
  readonly texts: readonly { readonly pointId: string; readonly text: string }[];
  readonly denseVectors: readonly {
    readonly pointId: string;
    readonly vector: readonly number[];
  }[];
  readonly payloadByPointId: Readonly<Record<string, unknown>>;
  readonly pointIdByEntryId: Readonly<Record<string, string>>;
}

const buildMemberFixture = (generationRef: RetrievalGenerationRefV1): MemberFixture => {
  const normalized = normalizeRetrievalMembers({
    projectId: PROJECT_ID,
    generationRef,
    policy,
    authorizationScopeDigest: AUTHORIZATION_SCOPE_DIGEST,
    sources: RETRIEVAL_SOURCE_KINDS_V1.map((sourceKind) => ({
      sourceKind,
      sourceReleaseRef: RELEASE_REF_BY_KIND[sourceKind],
      entries: [ENTRY_BY_KIND[sourceKind]],
    })),
  });
  if (normalized.kind !== "succeeded") {
    throw new Error(`member fixture rejected: ${normalized.code}/${normalized.detailCode}`);
  }
  const denseVectors: { pointId: string; vector: readonly number[] }[] = [];
  const payloadByPointId: Record<string, unknown> = {};
  const pointIdByEntryId: Record<string, string> = {};
  for (const member of normalized.manifest.members) {
    const vector = DENSE_BY_ENTRY_ID[member.sourceEntryId];
    if (vector === undefined) throw new Error(`no dense fixture for ${member.sourceEntryId}`);
    denseVectors.push({ pointId: member.pointId, vector });
    payloadByPointId[member.pointId] = expectedPayload(normalized.manifest, member);
    pointIdByEntryId[member.sourceEntryId] = member.pointId;
  }
  return {
    manifest: normalized.manifest,
    texts: normalized.points,
    denseVectors,
    payloadByPointId,
    pointIdByEntryId,
  };
};

const expectProjectionError = async (
  promise: Promise<unknown>,
  code: string,
  detailCode?: string,
): Promise<QdrantRetrievalProjectionError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(QdrantRetrievalProjectionError);
    const projectionError = error as QdrantRetrievalProjectionError;
    expect(projectionError.code).toBe(code);
    if (detailCode !== undefined) expect(projectionError.detailCode).toBe(detailCode);
    return projectionError;
  }
  throw new Error(`expected ${code}, but the call resolved`);
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const stubFetch = (handler: (url: string, init?: RequestInit) => Response): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return handler(url, init);
  }) as typeof fetch;

describe("QdrantRetrievalProjection", () => {
  let fixture: QdrantRetrievalFixture;
  let adapter: QdrantRetrievalProjection;

  const rawUpsert = async (collectionName: string, points: readonly unknown[]): Promise<void> => {
    const response = await fetch(
      `${fixture.baseUrl}/collections/${encodeURIComponent(collectionName)}/points?wait=true`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ points }),
      },
    );
    expect(response.ok).toBe(true);
  };

  const rawDelete = async (collectionName: string): Promise<void> => {
    await fetch(`${fixture.baseUrl}/collections/${encodeURIComponent(collectionName)}`, {
      method: "DELETE",
    });
  };

  const rawScroll = async (
    collectionName: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> => {
    const response = await fetch(
      `${fixture.baseUrl}/collections/${encodeURIComponent(collectionName)}/points/scroll`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 100, with_payload: true }),
      },
    );
    expect(response.ok).toBe(true);
    const body = (await response.json()) as {
      readonly result: { readonly points: readonly Readonly<Record<string, unknown>>[] };
    };
    return body.result.points;
  };

  const buildQuery = (
    generationRef: RetrievalGenerationRefV1,
    projectId: string = PROJECT_ID,
  ): RetrievalHybridQueryV1 => ({
    collectionName: retrievalCollectionNameFor(generationRef),
    generationRef,
    queryDenseVector: [...DENSE_QUERY_VECTOR],
    queryText: BM25_UNIQUE_TOKEN,
    policy,
    filter: {
      projectId,
      generationRef,
      authorizationScopeDigest: AUTHORIZATION_SCOPE_DIGEST,
      visiblePointIds: Object.values(buildMemberFixture(generationRef).pointIdByEntryId),
    },
  });

  // 干扰点：验证 payload filter 在 Qdrant 侧隔离工程、代际和授权范围。
  const foreignPoint = (input: {
    readonly pointId: string;
    readonly projectId: string;
    readonly generationRef: RetrievalGenerationRefV1;
    readonly sourceEntryId: string;
    readonly dense: readonly number[];
    readonly bm25Text: string;
    readonly authorizationScopeDigest?: string;
  }): Readonly<Record<string, unknown>> => ({
    id: input.pointId,
    vector: {
      dense: [...input.dense],
      bm25: {
        text: input.bm25Text,
        model: policy.bm25.model,
        options: {
          tokenizer: policy.bm25.tokenizer,
          language: policy.bm25.language,
          stemmer: { type: policy.bm25.stemmer },
          stopwords: { languages: [], custom: [] },
          lowercase: true,
        },
      },
    },
    payload: {
      schemaVersion: HYBRID_RETRIEVAL_SCHEMA_VERSION_V1,
      projectId: input.projectId,
      generationRef: input.generationRef,
      generationKey: input.generationRef.reference.versionId,
      sourceKind: "case-library",
      sourceReleaseRef: caseLibraryReleaseRef,
      sourceEntryId: input.sourceEntryId,
      contentDigest: "1a".repeat(32),
      authorizationScopeDigest: input.authorizationScopeDigest ?? AUTHORIZATION_SCOPE_DIGEST,
    },
  });

  beforeAll(async () => {
    fixture = await startQdrantRetrievalFixture();
    adapter = new QdrantRetrievalProjection({ baseUrl: fixture.baseUrl });
    console.log(
      `[c20] qdrant fixture path=${fixture.endpoint} baseUrl=${fixture.baseUrl} version=${fixture.serviceVersion}`,
    );
  }, 120_000);

  afterAll(async () => {
    await fixture.stop();
  }, 30_000);

  it("reports the pinned Qdrant service version", async () => {
    await expect(adapter.serviceVersion()).resolves.toEqual({
      version: QDRANT_TEST_SERVICE_VERSION,
    });
    expect(fixture.serviceVersion).toBe(QDRANT_TEST_SERVICE_VERSION);
  });

  it("creates the dual-vector collection once and rejects incompatible re-create", async () => {
    const generationRef = generationFor("event-create");
    const collectionName = retrievalCollectionNameFor(generationRef);

    // 共享 endpoint 上可能残留上次运行的 collection；先按精确代际清理，再断言首次创建。
    await adapter.deleteGenerationCollection({ collectionName, generationRef });
    expect(await adapter.ensureCollection({ collectionName, policy })).toEqual({ created: true });
    expect(await adapter.ensureCollection({ collectionName, policy })).toEqual({ created: false });

    await expectProjectionError(
      adapter.ensureCollection({ collectionName, policy: buildPolicy({ dimensions: 16 }) }),
      "POLICY_INCOMPATIBLE",
      "dense-dimensions-mismatch",
    );
    await expectProjectionError(
      adapter.ensureCollection({ collectionName, policy: buildPolicy({ distance: "euclid" }) }),
      "POLICY_INCOMPATIBLE",
      "dense-distance-mismatch",
    );

    const denseOnlyName = retrievalCollectionNameFor(generationFor("event-dense-only"));
    await rawDelete(denseOnlyName);
    const denseOnly = await fetch(`${fixture.baseUrl}/collections/${denseOnlyName}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vectors: { dense: { size: DIMENSIONS, distance: "Cosine" } } }),
    });
    expect(denseOnly.ok).toBe(true);
    await expectProjectionError(
      adapter.ensureCollection({ collectionName: denseOnlyName, policy }),
      "POLICY_INCOMPATIBLE",
      "bm25-vector-missing",
    );
  });

  it("upserts both vector representations with a minimal payload", async () => {
    const generationRef = generationFor("event-upsert");
    const members = buildMemberFixture(generationRef);
    const collectionName = retrievalCollectionNameFor(generationRef);
    await adapter.ensureCollection({ collectionName, policy });
    await adapter.upsertMembers({
      collectionName,
      policy,
      manifest: members.manifest,
      texts: members.texts,
      denseVectors: members.denseVectors,
    });

    const observation = await adapter.inspectGeneration({
      collectionName,
      generationRef,
      pageSize: 10,
      maxPoints: 10,
    });
    expect(observation.complete).toBe(true);
    expect(observation.serviceVersion).toBe(QDRANT_TEST_SERVICE_VERSION);
    expect(observation.points).toHaveLength(members.manifest.members.length);
    for (const point of observation.points) {
      expect(point.hasDenseVector).toBe(true);
      expect(point.hasSparseVector).toBe(true);
      expect(point.denseDimensions).toBe(DIMENSIONS);
      expect(point.payload).toEqual(members.payloadByPointId[point.pointId]);
    }

    // 最小载荷：真实 Qdrant 上只保留 9 个约定字段，正文不进入投影。
    const rawPoints = await rawScroll(collectionName);
    expect(rawPoints).toHaveLength(members.manifest.members.length);
    for (const point of rawPoints) {
      const payload = point["payload"] as Readonly<Record<string, unknown>>;
      expect(Object.keys(payload).sort()).toEqual(PAYLOAD_KEYS);
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain(BM25_UNIQUE_TOKEN);
      expect(serialized).not.toContain("细粒流失");
    }

    // 分页上限：即使页面尚未取完也必须报告 complete=false，调用方据此不得声称已核对整代际。
    const capped = await adapter.inspectGeneration({
      collectionName,
      generationRef,
      pageSize: 1,
      maxPoints: members.manifest.members.length - 1,
    });
    expect(capped.points).toHaveLength(members.manifest.members.length - 1);
    expect(capped.complete).toBe(false);
  });

  it("fuses dense and BM25 prefetch with per-route ranks", async () => {
    const generationRef = generationFor("event-query");
    const members = buildMemberFixture(generationRef);
    const collectionName = retrievalCollectionNameFor(generationRef);
    await adapter.ensureCollection({ collectionName, policy });
    await adapter.upsertMembers({
      collectionName,
      policy,
      manifest: members.manifest,
      texts: members.texts,
      denseVectors: members.denseVectors,
    });

    const result = await adapter.queryHybrid(buildQuery(generationRef));
    expect(result.collectionName).toBe(collectionName);
    expect(result.generationRef.reference.versionId).toBe(generationRef.reference.versionId);
    expect(result.serviceVersion).toBe(QDRANT_TEST_SERVICE_VERSION);
    expect(result.fusedQueryDurationMs).toBeGreaterThanOrEqual(0);

    expect(result.denseRoute.map((hit) => hit.rank)).toEqual(
      result.denseRoute.map((_hit, index) => index + 1),
    );
    expect(result.bm25Route.map((hit) => hit.rank)).toEqual(
      result.bm25Route.map((_hit, index) => index + 1),
    );
    expect(result.fused.map((hit) => hit.rank)).toEqual(
      result.fused.map((_hit, index) => index + 1),
    );

    // 稠密路按余弦相似度命中查询向量对齐的成员；BM25 路按服务端 inference 命中唯一词法成员。
    expect(result.denseRoute[0]?.pointId).toBe(members.pointIdByEntryId["rm-seepage-piping"]);
    expect(result.bm25Route[0]?.pointId).toBe(members.pointIdByEntryId["std-slope-001"]);
    expect(result.fused.length).toBeGreaterThan(0);

    const densePointIds = new Set(result.denseRoute.map((hit) => hit.pointId));
    const bm25PointIds = new Set(result.bm25Route.map((hit) => hit.pointId));
    for (const hit of result.fused) {
      expect(hit.payload).toEqual(members.payloadByPointId[hit.pointId]);
      expect(densePointIds.has(hit.pointId) || bm25PointIds.has(hit.pointId)).toBe(true);
    }
    const fusedPointIds = new Set(result.fused.map((hit) => hit.pointId));
    expect(fusedPointIds.has(members.pointIdByEntryId["std-slope-001"])).toBe(true);
    expect(fusedPointIds.has(members.pointIdByEntryId["rm-seepage-piping"])).toBe(true);
  });

  it("keeps other generations and projects out of query results", async () => {
    const generationRef = generationFor("event-isolation");
    const members = buildMemberFixture(generationRef);
    const collectionName = retrievalCollectionNameFor(generationRef);
    await adapter.ensureCollection({ collectionName, policy });
    await adapter.upsertMembers({
      collectionName,
      policy,
      manifest: members.manifest,
      texts: members.texts,
      denseVectors: members.denseVectors,
    });

    // 干扰点 1：同 collection 内、另一代际的载荷，与查询向量/词法完全对齐，仍必须被过滤掉。
    const foreignGenerationRef = generationFor("event-isolation-foreign");
    const foreignPointId = "aaaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee";
    // 干扰点 2：同代际但另一工程；既验证 projectId 过滤，也作为 projectId 过滤的正对照。
    const foreignProjectId = "project-hybrid-gamma";
    const otherProjectPointId = "bbbbbbbb-cccc-5ddd-8eee-ffffffffffff";
    await rawUpsert(collectionName, [
      foreignPoint({
        pointId: foreignPointId,
        projectId: PROJECT_ID,
        generationRef: foreignGenerationRef,
        sourceEntryId: "case-foreign-generation",
        dense: DENSE_QUERY_VECTOR,
        bm25Text: BM25_UNIQUE_TOKEN,
      }),
      foreignPoint({
        pointId: otherProjectPointId,
        projectId: foreignProjectId,
        generationRef,
        sourceEntryId: "case-foreign-project",
        dense: DENSE_QUERY_VECTOR,
        bm25Text: BM25_UNIQUE_TOKEN,
      }),
    ]);

    const result = await adapter.queryHybrid(buildQuery(generationRef));
    expect(result.fused.length).toBeGreaterThan(0);
    for (const pointId of [foreignPointId, otherProjectPointId]) {
      expect(result.fused.map((hit) => hit.pointId)).not.toContain(pointId);
      expect(result.denseRoute.map((hit) => hit.pointId)).not.toContain(pointId);
      expect(result.bm25Route.map((hit) => hit.pointId)).not.toContain(pointId);
    }

    // 正对照：换成该 collection 中真实存在的另一工程 filter 时，只返回该工程的干扰点。
    const foreignQuery = buildQuery(generationRef, foreignProjectId);
    const foreignProject = await adapter.queryHybrid({
      ...foreignQuery,
      filter: { ...foreignQuery.filter, visiblePointIds: [otherProjectPointId] },
    });
    expect(foreignProject.fused.map((hit) => hit.pointId)).toEqual([otherProjectPointId]);
    expect(foreignProject.denseRoute.map((hit) => hit.pointId)).toEqual([otherProjectPointId]);

    // 边界回归：不存在的工程 filter 在本 collection 上必须一路命中都不返回。
    const otherProject = await adapter.queryHybrid(
      buildQuery(generationRef, "project-hybrid-beta"),
    );
    expect(otherProject.fused).toEqual([]);
    expect(otherProject.denseRoute).toEqual([]);
    expect(otherProject.bm25Route).toEqual([]);
  });

  it("keeps authorized recall when foreign points saturate the prefetch window", async () => {
    const generationRef = generationFor("event-saturation");
    const collectionName = retrievalCollectionNameFor(generationRef);
    // 召回窗口收到 1：干扰点的相似度与词频都高于本工程成员，只有 prefetch 级过滤才能保住召回。
    const saturationPolicy = HybridRetrievalPolicyV1Schema.parse({
      ...policy,
      densePrefetchLimit: 1,
      bm25PrefetchLimit: 1,
      topK: 1,
    });
    const members = buildMemberFixture(generationRef);
    await adapter.ensureCollection({ collectionName, policy: saturationPolicy });
    await adapter.upsertMembers({
      collectionName,
      policy: saturationPolicy,
      manifest: members.manifest,
      texts: members.texts,
      denseVectors: members.manifest.members.map((member) => ({
        pointId: member.pointId,
        // 本工程成员刻意弱于干扰点，未过滤的 prefetch 会把它们挤到窗口之外。
        vector:
          member.sourceEntryId === "rm-seepage-piping"
            ? [0.98, 0.199, 0, 0, 0, 0, 0, 0]
            : [0, 0, 1, 0, 0, 0, 0, 0],
      })),
    });
    await rawUpsert(
      collectionName,
      [0, 1, 2].flatMap((index) => [
        foreignPoint({
          pointId: `${String(index)}aaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee`,
          projectId: "project-hybrid-beta",
          generationRef,
          sourceEntryId: `case-saturation-${String(index)}`,
          dense: DENSE_QUERY_VECTOR,
          bm25Text: `${BM25_UNIQUE_TOKEN} ${BM25_UNIQUE_TOKEN} ${BM25_UNIQUE_TOKEN}`,
        }),
        foreignPoint({
          pointId: `${String(index)}bbbbbbb-cccc-5ddd-8eee-ffffffffffff`,
          projectId: PROJECT_ID,
          generationRef,
          sourceEntryId: `case-other-scope-${String(index)}`,
          dense: DENSE_QUERY_VECTOR,
          bm25Text: `${BM25_UNIQUE_TOKEN} ${BM25_UNIQUE_TOKEN} ${BM25_UNIQUE_TOKEN}`,
          authorizationScopeDigest: "ab".repeat(32),
        }),
      ]),
    );

    const result = await adapter.queryHybrid({
      ...buildQuery(generationRef),
      policy: saturationPolicy,
    });
    expect(result.fused).toHaveLength(1);
    expect(result.fused[0]?.payload.projectId).toBe(PROJECT_ID);
    expect(result.fused[0]?.payload.authorizationScopeDigest).toBe(AUTHORIZATION_SCOPE_DIGEST);
    expect(result.denseRoute.map((hit) => hit.pointId)).toContain(
      members.pointIdByEntryId["rm-seepage-piping"],
    );
    expect(result.bm25Route.map((hit) => hit.pointId)).toContain(
      members.pointIdByEntryId["std-slope-001"],
    );
  });

  it("deletes exactly the generation collection", async () => {
    const generationRef = generationFor("event-delete");
    const collectionName = retrievalCollectionNameFor(generationRef);
    const neighbourName = retrievalCollectionNameFor(generationFor("event-delete-neighbour"));
    await adapter.ensureCollection({ collectionName, policy });
    await adapter.ensureCollection({ collectionName: neighbourName, policy });

    await expectProjectionError(
      adapter.deleteGenerationCollection({
        collectionName: `${collectionName}-suffix`,
        generationRef,
      }),
      "POLICY_INCOMPATIBLE",
      "collection-name-not-derived-from-generation",
    );

    await expect(
      adapter.listRetrievalCollections({ namePrefix: "riskflow-retrieval-" }),
    ).resolves.toEqual(expect.arrayContaining([collectionName, neighbourName]));

    expect(await adapter.deleteGenerationCollection({ collectionName, generationRef })).toEqual({
      deleted: true,
    });
    const remaining = await adapter.listRetrievalCollections({ namePrefix: "riskflow-retrieval-" });
    expect(remaining).not.toContain(collectionName);
    expect(remaining).toContain(neighbourName);
    expect(await adapter.deleteGenerationCollection({ collectionName, generationRef })).toEqual({
      deleted: false,
    });
  });

  it("maps an unreachable endpoint to QDRANT_UNAVAILABLE", async () => {
    const unreachable = new QdrantRetrievalProjection({
      baseUrl: "http://127.0.0.1:1",
      requestTimeoutMs: 3_000,
    });
    const error = await expectProjectionError(unreachable.serviceVersion(), "QDRANT_UNAVAILABLE");
    expect(error.retryable).toBe(true);
    await expectProjectionError(
      unreachable.listRetrievalCollections({ namePrefix: "riskflow-retrieval-" }),
      "QDRANT_UNAVAILABLE",
    );
  });

  it("maps malformed responses to QDRANT_INVALID_RESPONSE", async () => {
    const notJson = new QdrantRetrievalProjection({
      baseUrl: "http://qdrant.invalid",
      fetchImpl: stubFetch(() => new Response("not-json", { status: 200 })),
    });
    await expectProjectionError(
      notJson.serviceVersion(),
      "QDRANT_INVALID_RESPONSE",
      "invalid-json",
    );

    const wrongShape = new QdrantRetrievalProjection({
      baseUrl: "http://qdrant.invalid",
      fetchImpl: stubFetch(() => jsonResponse({ version: 19 })),
    });
    await expectProjectionError(
      wrongShape.listRetrievalCollections({ namePrefix: "x" }),
      "QDRANT_INVALID_RESPONSE",
      "collections-list",
    );

    const generationRef = generationFor("event-stub");
    const members = buildMemberFixture(generationRef);
    const payload = members.payloadByPointId[members.pointIdByEntryId["rm-seepage-piping"]];
    const unknownPointId = "bbbbbbbb-cccc-5ddd-8eee-ffffffffffff";
    const fusedWithoutRoute = new QdrantRetrievalProjection({
      baseUrl: "http://qdrant.invalid",
      fetchImpl: stubFetch((url, init) => {
        if (url.endsWith("/") && (init?.method ?? "GET") === "GET") {
          return jsonResponse({ version: QDRANT_TEST_SERVICE_VERSION });
        }
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Readonly<
          Record<string, unknown>
        >;
        const query = body["query"] as Readonly<Record<string, unknown>>;
        // 融合响应多出一个两路都不存在的 point：不得返回部分结果。
        if ("rrf" in query) {
          return jsonResponse({
            result: {
              points: [
                { id: unknownPointId, score: 0.5, payload },
                { id: members.pointIdByEntryId["rm-seepage-piping"], score: 0.4, payload },
              ],
            },
            status: "ok",
          });
        }
        return jsonResponse({
          result: { points: [{ id: members.pointIdByEntryId["rm-seepage-piping"], score: 0.9 }] },
          status: "ok",
        });
      }),
    });
    await expectProjectionError(
      fusedWithoutRoute.queryHybrid(buildQuery(generationRef)),
      "FUSION_RECONCILIATION_FAILED",
      "fused-hit-missing-from-routes",
    );
  });

  it("fails closed when member representations are incomplete or oversize", async () => {
    const generationRef = generationFor("event-limits");
    const members = buildMemberFixture(generationRef);
    const collectionName = retrievalCollectionNameFor(generationRef);
    await adapter.ensureCollection({ collectionName, policy });

    await expectProjectionError(
      adapter.upsertMembers({
        collectionName,
        policy,
        manifest: members.manifest,
        texts: members.texts.slice(1),
        denseVectors: members.denseVectors,
      }),
      "DUAL_INDEX_MISMATCH",
      "member-text-missing",
    );
    await expectProjectionError(
      adapter.upsertMembers({
        collectionName,
        policy,
        manifest: members.manifest,
        texts: members.texts,
        denseVectors: [],
      }),
      "DUAL_INDEX_MISMATCH",
      "member-dense-vector-missing",
    );
    await expectProjectionError(
      adapter.upsertMembers({
        collectionName,
        policy,
        manifest: members.manifest,
        texts: members.texts,
        denseVectors: members.denseVectors.map((dense) => ({
          pointId: dense.pointId,
          vector: [...dense.vector, 0],
        })),
      }),
      "EMBEDDING_DIMENSION_MISMATCH",
      "dense-vector-dimensions",
    );
    // 资源上限：成员数超过策略 memberLimit 时任何批次都不会发出。
    const oversizeManifest: RetrievalIndexManifestV1 = {
      ...members.manifest,
      members: [...members.manifest.members, ...members.manifest.members.slice(0, 2)],
    };
    await expectProjectionError(
      adapter.upsertMembers({
        collectionName,
        policy: HybridRetrievalPolicyV1Schema.parse({ ...policy, memberLimit: 4 }),
        manifest: oversizeManifest,
        texts: members.texts,
        denseVectors: members.denseVectors,
      }),
      "RESOURCE_LIMIT_EXCEEDED",
      "member-count",
    );
    await expectProjectionError(
      adapter.upsertMembers({
        collectionName,
        policy: HybridRetrievalPolicyV1Schema.parse({ ...policy, memberByteLimit: 8 }),
        manifest: members.manifest,
        texts: members.texts,
        denseVectors: members.denseVectors,
      }),
      "RESOURCE_LIMIT_EXCEEDED",
      "member-byte-limit",
    );

    // 失败后 collection 仍为空：既没有半正式点，也没有可查询的部分索引。
    expect(
      await adapter.inspectGeneration({
        collectionName,
        generationRef,
        pageSize: 10,
        maxPoints: 10,
      }),
    ).toMatchObject({ points: [], complete: true });
  });
});
