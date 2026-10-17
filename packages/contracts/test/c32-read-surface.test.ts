import { describe, expect, it } from "vitest";

import {
  EngineeringDataCatalogQueryV1Schema,
  EngineeringDataCatalogSuccessV1Schema,
  KnowledgeGovernanceReadQueryV1Schema,
  KnowledgeGovernanceReadSuccessV1Schema,
  KnowledgeRetrievalReadQueryV1Schema,
  KnowledgeRetrievalReadSuccessV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ProjectionResultReadPageV1Schema,
  ProjectionResultReadQueryV1Schema,
} from "../src/ports/index.js";

const versionRef = (kind: string, entityId = "entity-1", versionId = "v1") => ({
  kind,
  reference: { entityId, versionId },
});

const authorization = {
  schemaVersion: "1",
  authorizationContextRef: versionRef("authorization-context", "auth-1"),
  actorId: "actor-1",
  projectId: "project-1",
  grantedCapabilities: [
    "engineering-data.read",
    "knowledge-modeling.read",
    "knowledge-modeling.retrieve",
    "projection.query",
  ],
  spatialScopeRefs: [],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: { entityId: "policy-1", versionId: "v1" },
  decidedAt: "2026-09-24T00:00:00.000Z",
  invocation: { kind: "human" },
};

const queryBase = {
  queryId: "query-1",
  projectId: "project-1",
  actorId: "actor-1",
  requestedAt: "2026-09-24T00:00:00.000Z",
  authorization,
};

describe("C32 branch-capability 映射", () => {
  it("七条新 branch 全部映射到既有能力位", () => {
    expect(MODULE_BRANCH_CAPABILITY_V1["engineering-data.context-read"]).toBe(
      "engineering-data.read",
    );
    expect(MODULE_BRANCH_CAPABILITY_V1["engineering-data.source-catalog"]).toBe(
      "engineering-data.read",
    );
    expect(MODULE_BRANCH_CAPABILITY_V1["engineering-data.monitoring-catalog"]).toBe(
      "engineering-data.read",
    );
    expect(MODULE_BRANCH_CAPABILITY_V1["engineering-data.read-result"]).toBe(
      "engineering-data.read",
    );
    expect(MODULE_BRANCH_CAPABILITY_V1["knowledge-modeling.governance-read"]).toBe(
      "knowledge-modeling.read",
    );
    expect(MODULE_BRANCH_CAPABILITY_V1["knowledge-modeling.retrieval-result"]).toBe(
      "knowledge-modeling.retrieve",
    );
    expect(MODULE_BRANCH_CAPABILITY_V1["projection.result-read"]).toBe("projection.query");
  });
});

describe("EngineeringDataCatalogQueryV1Schema", () => {
  it("接受四种查询形态", () => {
    for (const [kind, payload] of [
      ["context-read", {}],
      ["source-catalog", { pageSize: 20 }],
      ["monitoring-catalog", { monitoringSeriesRef: versionRef("monitoring-series") }],
      ["read-result", { queryResultRef: versionRef("query-result") }],
    ] as const) {
      const parsed = EngineeringDataCatalogQueryV1Schema.safeParse({ ...queryBase, kind, payload });
      expect(parsed.success).toBe(true);
    }
  });

  it("拒绝契约外字段与超限页大小", () => {
    expect(
      EngineeringDataCatalogQueryV1Schema.safeParse({
        ...queryBase,
        kind: "source-catalog",
        payload: { pageSize: 20, surprise: true },
      }).success,
    ).toBe(false);
    expect(
      EngineeringDataCatalogQueryV1Schema.safeParse({
        ...queryBase,
        kind: "source-catalog",
        payload: { pageSize: 51 },
      }).success,
    ).toBe(false);
  });

  it("缺少所需能力时失败", () => {
    const parsed = EngineeringDataCatalogQueryV1Schema.safeParse({
      ...queryBase,
      authorization: { ...authorization, grantedCapabilities: ["projection.query"] },
      kind: "context-read",
      payload: {},
    });
    expect(parsed.success).toBe(false);
  });
});

describe("KnowledgeGovernanceReadQueryV1Schema", () => {
  it("接受四种操作", () => {
    for (const payload of [
      { operation: "list-definitions", definitionType: "risk-mechanism" },
      {
        operation: "read-definition-revision",
        knowledgeRevisionRef: versionRef("knowledge-revision"),
      },
      {
        operation: "read-definition-release",
        knowledgeReleaseRef: versionRef("knowledge-release"),
      },
      { operation: "current-release-set" },
    ]) {
      const parsed = KnowledgeGovernanceReadQueryV1Schema.safeParse({
        ...queryBase,
        kind: "governance-read",
        payload,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("拒绝未知操作与未知定义类型", () => {
    expect(
      KnowledgeGovernanceReadQueryV1Schema.safeParse({
        ...queryBase,
        kind: "governance-read",
        payload: { operation: "list-definitions", definitionType: "not-a-type" },
      }).success,
    ).toBe(false);
  });
});

describe("KnowledgeRetrievalReadQueryV1Schema / ProjectionResultReadQueryV1Schema", () => {
  it("检索结果读取接受精确引用", () => {
    expect(
      KnowledgeRetrievalReadQueryV1Schema.safeParse({
        ...queryBase,
        kind: "retrieval-result",
        payload: { knowledgeQueryResultRef: versionRef("knowledge-query-result") },
      }).success,
    ).toBe(true);
  });

  it("投影结果读取 limit 上限为 100", () => {
    const payload = { queryResultRef: versionRef("query-result"), limit: 101 };
    expect(
      ProjectionResultReadQueryV1Schema.safeParse({
        ...queryBase,
        kind: "result-read",
        payload,
      }).success,
    ).toBe(false);
    expect(
      ProjectionResultReadQueryV1Schema.safeParse({
        ...queryBase,
        kind: "result-read",
        payload: { ...payload, limit: 100 },
      }).success,
    ).toBe(true);
  });

  it("接受长读取游标", () => {
    expect(
      ProjectionResultReadQueryV1Schema.safeParse({
        ...queryBase,
        kind: "result-read",
        payload: { queryResultRef: versionRef("query-result"), cursor: "c".repeat(600) },
      }).success,
    ).toBe(true);
  });
});

describe("C32 成功结果判别联合", () => {
  it("接受长目录结果游标", () => {
    expect(
      EngineeringDataCatalogSuccessV1Schema.safeParse({
        kind: "source-catalog",
        items: [],
        totalCount: 0,
        nextCursor: "c".repeat(600),
      }).success,
    ).toBe(true);
    expect(
      ProjectionResultReadPageV1Schema.safeParse({
        kind: "page",
        queryType: "trace-chain",
        items: [],
        nextCursor: "d".repeat(600),
      }).success,
    ).toBe(true);
  });

  it("工程上下文读成功形状", () => {
    const parsed = EngineeringDataCatalogSuccessV1Schema.safeParse({
      kind: "context-read",
      projectId: "project-1",
      contextStatus: "active",
      currentProjectRevisionRef: versionRef("project-revision"),
      applicabilityMetadata: {
        constructionMethod: "m",
        stratumCondition: "s",
        engineeringStage: "e",
      },
      missingApplicabilityDimensions: [],
      spatialScopes: [{ spatialScopeRef: versionRef("spatial-scope"), name: "主线区间" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("治理风险矩阵正文形状且拒绝契约外字段", () => {
    const body = {
      definitionType: "risk-matrix",
      matrixId: "matrix-1",
      matrixVersion: "2026.06",
      possibilityAxis: { bands: [{ bandId: "P1", lower: "0", upper: "0.2" }] },
      consequenceAxis: { bands: [{ bandId: "C1", lower: "0", upper: "0.2" }] },
      riskLevels: [{ levelId: "I", ordinal: 1 }],
      cells: [{ possibilityBandId: "P1", consequenceBandId: "C1", riskLevelId: "I" }],
    };
    const parsed = KnowledgeGovernanceReadSuccessV1Schema.safeParse({
      kind: "read-definition-release",
      releaseRef: versionRef("knowledge-release"),
      definitionRef: versionRef("knowledge-definition"),
      definitionType: "risk-matrix",
      revisionRef: versionRef("knowledge-revision"),
      effectiveFrom: "2026-09-24T00:00:00.000Z",
      evidenceReferences: [
        {
          locator: { sourceSegmentId: "DOC1-S1-SEG1" },
          sourceVersion: { entityId: "s", versionId: "v1" },
        },
      ],
      body,
    });
    expect(parsed.success).toBe(true);
    expect(
      KnowledgeGovernanceReadSuccessV1Schema.safeParse({
        kind: "list-definitions",
        items: [],
        totalCount: 0,
        unexpected: 1,
      }).success,
    ).toBe(false);
  });

  it("混合检索结果成功形状", () => {
    const parsed = KnowledgeRetrievalReadSuccessV1Schema.safeParse({
      kind: "hybrid-evidence",
      knowledgeQueryResultRef: versionRef("knowledge-query-result"),
      policyRef: { entityId: "policy", versionId: "v1" },
      generationRef: {
        kind: "retrieval-generation",
        reference: { entityId: "g", versionId: "v1" },
      },
      topK: 10,
      hits: [
        {
          rank: 1,
          memberRef: { kind: "retrieval-member", reference: { entityId: "m", versionId: "v1" } },
          sourceKind: "risk-mechanism",
          sourceReleaseRef: versionRef("knowledge-release"),
          sourceEntryId: "MEC-1",
          denseContribution: 0.5,
          bm25Contribution: 0.5,
          fusionScore: 1,
          evidenceSourceVersionRefs: [],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});
