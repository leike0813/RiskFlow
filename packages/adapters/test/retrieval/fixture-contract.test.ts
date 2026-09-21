import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  HYBRID_RETRIEVAL_SAMPLE_NOTICE_V1,
  HybridRetrievalAcceptancePolicyV1Schema,
  HybridRetrievalPolicyV1Schema,
  RETRIEVAL_SOURCE_KINDS_V1,
  RetrievalSourceKindV1Schema,
} from "@riskflow/core/retrieval";
import { z } from "@riskflow/core/model";
import { IdentifierSchema, VersionReferenceSchema } from "@riskflow/contracts/common";

/**
 * 固定夹具契约（IP-07 / design D11）：数据集与验收策略先过核心 Schema，
 * 再约束合成标记、阈值、成员/查询完整性、跨工程与无权限干扰项以及成员字节上限。
 * 数据集形状由 C20 组合层与验收测试共同读取，冻结在 datasetRef 版本下。
 */

const loadFixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as unknown;

const DatasetMemberV1Schema = z.strictObject({
  memberId: IdentifierSchema,
  sourceKind: RetrievalSourceKindV1Schema,
  semanticGroup: IdentifierSchema,
  /** 中文成员文本：同时用于稠密嵌入与 BM25 文档推断，必须非空。 */
  text: z.string().min(1),
  evidenceSourceVersionRef: VersionReferenceSchema,
});

const DatasetQueryV1Schema = z.strictObject({
  queryId: IdentifierSchema,
  routeKind: z.enum(["lexical", "semantic-paraphrase", "dual-route"]),
  projectId: IdentifierSchema,
  semanticGroup: IdentifierSchema,
  text: z.string().min(1),
  expectedRelevantMemberIds: z.array(IdentifierSchema).min(1),
});

const DatasetInterferenceV1Schema = z.strictObject({
  queryId: IdentifierSchema,
  /** 跨工程由 projectId 区分；无权限为同工程但资料授权范围之外。 */
  interferenceKind: z.enum(["cross-project", "no-permission"]),
  projectId: IdentifierSchema,
  text: z.string().min(1),
  interferenceMemberIds: z.array(IdentifierSchema).min(1),
  note: z.string().min(1),
});

const SyntheticHybridRetrievalDatasetV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  syntheticSample: z.literal(true),
  sampleNotice: z.literal(HYBRID_RETRIEVAL_SAMPLE_NOTICE_V1),
  datasetRef: VersionReferenceSchema,
  projectId: IdentifierSchema,
  members: z.array(DatasetMemberV1Schema).min(6),
  queries: z.array(DatasetQueryV1Schema).min(3),
  interference: z.array(DatasetInterferenceV1Schema).min(2),
});

/** 验收数据集始终按同一版本化检索策略测量；阈值本身在相邻验收策略文件中。 */
const companionPolicy = HybridRetrievalPolicyV1Schema.parse({
  schemaVersion: "1",
  policyRef: { entityId: "retrieval-policy", versionId: "c20-synthetic-v1" },
  evidenceBaseDefinitionType: "retrieval-evidence-base",
  modelDeploymentRef: { entityId: "embedding-deployment", versionId: "synthetic-v1" },
  dense: { vectorName: "dense", dimensions: 64, distance: "cosine" },
  bm25: {
    vectorName: "bm25",
    model: "qdrant/bm25",
    tokenizer: "multilingual",
    language: "chinese",
    stemmer: "none",
    stopwords: [],
  },
  densePrefetchLimit: 40,
  bm25PrefetchLimit: 40,
  topK: 5,
  rrf: { k: 60, denseWeight: 1, bm25Weight: 1 },
  memberBatchLimit: 64,
  memberByteLimit: 4096,
  memberLimit: 500,
  embeddingTimeoutMs: 30000,
  projectionTimeoutMs: 60000,
  acceptancePolicyRef: { entityId: "retrieval-acceptance-policy", versionId: "c20-synthetic-v1" },
  projectionCompatibilityRef: { entityId: "retrieval-projection-compatibility", versionId: "v1" },
});

const acceptancePolicy = HybridRetrievalAcceptancePolicyV1Schema.parse(
  loadFixture("acceptance-policy.v1.json"),
);

const dataset = SyntheticHybridRetrievalDatasetV1Schema.parse(
  loadFixture("synthetic-hybrid-retrieval.v1.json"),
);

const memberIds = new Set(dataset.members.map((member) => member.memberId));
const memberKindById = new Map(
  dataset.members.map((member) => [member.memberId, member.sourceKind]),
);
const membersByGroup = (group: string) =>
  dataset.members.filter((member) => member.semanticGroup === group);

describe("acceptance policy fixture", () => {
  it("fixes the approved thresholds and measurement boundary", () => {
    expect(acceptancePolicy).toMatchObject({
      schemaVersion: "1",
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
    });
    expect(acceptancePolicy.topK).toBe(companionPolicy.topK);
    expect(companionPolicy.memberLimit).toBeGreaterThanOrEqual(dataset.members.length);
  });

  it("pins the dataset it measures, including the pending-review marker", () => {
    expect(acceptancePolicy.datasetRef).toEqual(dataset.datasetRef);
    expect(acceptancePolicy.syntheticSample).toBe(true);
    expect(dataset.syntheticSample).toBe(true);
    expect(dataset.sampleNotice).toBe("合成样本、待甲方复核");
  });
});

describe("synthetic hybrid retrieval dataset", () => {
  it("declares unique members covering all three source kinds", () => {
    const ids = dataset.members.map((member) => member.memberId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(dataset.members.length).toBeGreaterThanOrEqual(6);
    expect(new Set(dataset.members.map((member) => member.sourceKind))).toEqual(
      new Set(RETRIEVAL_SOURCE_KINDS_V1),
    );
    for (const kind of RETRIEVAL_SOURCE_KINDS_V1) {
      expect(dataset.members.filter((member) => member.sourceKind === kind).length).toBeGreaterThan(
        0,
      );
    }
  });

  it("keeps every member text within the companion policy limits", () => {
    for (const member of dataset.members) {
      expect(member.text.trim().length, member.memberId).toBeGreaterThan(0);
      expect(Buffer.byteLength(member.text, "utf8"), member.memberId).toBeLessThanOrEqual(
        companionPolicy.memberByteLimit,
      );
    }
    expect(dataset.members.length).toBeLessThanOrEqual(companionPolicy.memberLimit);
  });

  it("declares unique queries for every route kind with existent relevant members", () => {
    expect(new Set(dataset.queries.map((query) => query.queryId)).size).toBe(
      dataset.queries.length,
    );
    expect(new Set(dataset.queries.map((query) => query.text)).size).toBe(dataset.queries.length);
    expect(new Set(dataset.queries.map((query) => query.routeKind))).toEqual(
      new Set(["lexical", "semantic-paraphrase", "dual-route"]),
    );
    for (const query of dataset.queries) {
      expect(query.projectId, query.queryId).toBe(dataset.projectId);
      expect(query.expectedRelevantMemberIds.length).toBeLessThanOrEqual(companionPolicy.topK);
      for (const memberId of query.expectedRelevantMemberIds) {
        expect(memberIds.has(memberId), `${query.queryId} -> ${memberId}`).toBe(true);
      }
      expect(query.semanticGroup, query.queryId).toBeDefined();
      expect(membersByGroup(query.semanticGroup).length, query.queryId).toBeGreaterThanOrEqual(2);
    }
  });

  it("covers every member by at least one expected relevant set", () => {
    const covered = new Set(dataset.queries.flatMap((query) => query.expectedRelevantMemberIds));
    expect(
      dataset.members.map((member) => member.memberId).filter((id) => !covered.has(id)),
    ).toEqual([]);
  });

  it("keeps semantic-paraphrase queries on a semantic group with several members", () => {
    const paraphrase = dataset.queries.filter((query) => query.routeKind === "semantic-paraphrase");
    expect(paraphrase.length).toBeGreaterThan(0);
    for (const query of paraphrase) {
      expect(membersByGroup(query.semanticGroup).length, query.queryId).toBeGreaterThanOrEqual(2);
    }
  });

  it("mixes both routes for dual-route queries", () => {
    const dualRoute = dataset.queries.filter((query) => query.routeKind === "dual-route");
    expect(dualRoute.length).toBeGreaterThan(0);
    for (const query of dualRoute) {
      const kinds = new Set(
        query.expectedRelevantMemberIds.map((memberId) => memberKindById.get(memberId)),
      );
      expect(kinds.size, query.queryId).toBeGreaterThan(1);
    }
  });

  it("marks interference items across project or authorization boundaries", () => {
    expect(dataset.interference.length).toBeGreaterThanOrEqual(2);
    expect(new Set(dataset.interference.map((item) => item.queryId)).size).toBe(
      dataset.interference.length,
    );
    for (const item of dataset.interference) {
      expect(item.interferenceMemberIds.length).toBeGreaterThan(0);
      for (const memberId of item.interferenceMemberIds) {
        expect(memberIds.has(memberId), `${item.queryId} -> ${memberId}`).toBe(true);
      }
      if (item.interferenceKind === "cross-project")
        expect(item.projectId).not.toBe(dataset.projectId);
      if (item.interferenceKind === "no-permission") expect(item.projectId).toBe(dataset.projectId);
    }
    expect(new Set(dataset.interference.map((item) => item.interferenceKind))).toEqual(
      new Set(["cross-project", "no-permission"]),
    );
  });
});
