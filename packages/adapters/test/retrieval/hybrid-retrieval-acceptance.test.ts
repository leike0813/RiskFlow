import { cpus, platform } from "node:os";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  evaluateRetrievalAcceptance,
  reconcileDualIndexManifest,
  type HybridRetrievalPolicyV1,
  type RetrievalReconciliationV1,
} from "@riskflow/core/retrieval";

import { QdrantRetrievalProjection } from "../../src/retrieval/qdrant-rest-client.js";
import {
  buildAcceptanceManifest,
  fixedDenseVectorFor,
  loadRetrievalAcceptanceDataset,
  loadRetrievalAcceptancePolicy,
  ndcgAtK,
  percentile,
  recallAtK,
  retrievalAcceptancePolicy,
  type RetrievalAcceptanceManifestV1,
  type SyntheticRetrievalDatasetV1,
} from "./fixture.js";
import {
  QDRANT_TEST_IMAGE,
  startQdrantRetrievalFixture,
  type QdrantRetrievalFixture,
} from "./qdrant-container.js";

/**
 * IP-07 / V-06：真实 Qdrant 1.19.0 上的双路质量、权限、p95 与全删重建验收。
 * 质量硬门逐项独立判定；任一未达标即整体失败，不允许用融合均值掩盖。
 */

const policy: HybridRetrievalPolicyV1 = retrievalAcceptancePolicy();
const dataset: SyntheticRetrievalDatasetV1 = loadRetrievalAcceptanceDataset();
const acceptancePolicy = loadRetrievalAcceptancePolicy();
const manifest: RetrievalAcceptanceManifestV1 = buildAcceptanceManifest({ dataset, policy });

const denseVectorByPointId = new Map<string, readonly number[]>();
for (const member of dataset.members) {
  const pointId = [...manifest.memberIdByPointId.entries()].find(
    ([, memberId]) => memberId === member.memberId,
  )?.[0];
  if (pointId === undefined)
    throw new Error(`fixture member ${member.memberId} has no manifest point`);
  denseVectorByPointId.set(
    pointId,
    fixedDenseVectorFor({
      semanticGroup: member.semanticGroup,
      memberIndex: dataset.members.indexOf(member),
    }),
  );
}

const generationScopeDigest = manifest.manifest.members[0]!.authorizationScopeDigest;

const semanticGroupByMemberId = new Map(
  dataset.members.map((member) => [member.memberId, member.semanticGroup]),
);

const buildGeneration = async (
  projection: QdrantRetrievalProjection,
): Promise<RetrievalReconciliationV1> => {
  await projection.ensureCollection({ collectionName: manifest.collectionName, policy });
  await projection.upsertMembers({
    collectionName: manifest.collectionName,
    policy,
    manifest: manifest.manifest,
    texts: manifest.manifest.members.map((member) => ({
      pointId: member.pointId,
      text: manifest.memberTextByPointId.get(member.pointId) ?? "",
    })),
    denseVectors: manifest.manifest.members.map((member) => ({
      pointId: member.pointId,
      vector: denseVectorByPointId.get(member.pointId) ?? [],
    })),
  });
  const observed = await projection.inspectGeneration({
    collectionName: manifest.collectionName,
    generationRef: manifest.generationRef,
    pageSize: 64,
    maxPoints: policy.memberLimit,
  });
  return reconcileDualIndexManifest({
    projectId: dataset.projectId,
    expected: manifest.manifest,
    observed,
  });
};

const queryVectorFor = (semanticGroup: string): readonly number[] =>
  fixedDenseVectorFor({ semanticGroup, memberIndex: -1 });

const memberIdsOf = (pointIds: readonly string[]): readonly string[] =>
  pointIds
    .map((pointId) => manifest.memberIdByPointId.get(pointId))
    .filter((memberId): memberId is string => memberId !== undefined);

describe("hybrid retrieval acceptance against real Qdrant 1.19.0", () => {
  let fixture: QdrantRetrievalFixture;
  let projection: QdrantRetrievalProjection;
  let firstReconciliation: RetrievalReconciliationV1;
  const quality = {
    denseRecall: 0,
    bm25Recall: 0,
    rrfRecall: 0,
    rrfNdcg: 0,
    reconciliationRatio: 0,
    leakage: 0,
    p95Ms: 0,
    p95Samples: 0,
    rankings: [] as { queryId: string; memberIds: readonly string[] }[],
    perQuery: [] as {
      queryId: string;
      routeKind: string;
      dense: readonly string[];
      bm25: readonly string[];
      rrf: readonly string[];
      expected: readonly string[];
    }[],
  };

  beforeAll(async () => {
    fixture = await startQdrantRetrievalFixture();
    projection = new QdrantRetrievalProjection({ baseUrl: fixture.baseUrl });
    firstReconciliation = await buildGeneration(projection);

    // 门禁按路分工：稠密召回在语义改写与双路查询上评估，BM25 在词法与双路查询上评估，
    // RRF/融合质量对全部查询评估——单路失败不能被融合均值掩盖（design D11）。
    const denseRecalls: number[] = [];
    const bm25Recalls: number[] = [];
    const rrfRecalls: number[] = [];
    const rrfNdcgs: number[] = [];

    for (const query of dataset.queries) {
      const result = await projection.queryHybrid({
        collectionName: manifest.collectionName,
        generationRef: manifest.generationRef,
        queryDenseVector: [...queryVectorFor(query.semanticGroup)],
        queryText: query.text,
        policy,
        filter: {
          projectId: query.projectId,
          generationRef: manifest.generationRef,
          authorizationScopeDigest: generationScopeDigest,
          visiblePointIds: manifest.manifest.members.map((member) => member.pointId),
        },
      });
      const rrfIds = memberIdsOf(result.fused.map((hit) => hit.pointId));
      const denseIds = memberIdsOf(result.denseRoute.map((hit) => hit.pointId));
      const bm25Ids = memberIdsOf(result.bm25Route.map((hit) => hit.pointId));
      if (query.routeKind !== "lexical") {
        denseRecalls.push(
          recallAtK({
            retrieved: denseIds,
            relevant: query.expectedRelevantMemberIds,
            k: policy.topK,
          }),
        );
      }
      if (query.routeKind !== "semantic-paraphrase") {
        bm25Recalls.push(
          recallAtK({
            retrieved: bm25Ids,
            relevant: query.expectedRelevantMemberIds,
            k: policy.topK,
          }),
        );
      }
      quality.perQuery.push({
        queryId: query.queryId,
        routeKind: query.routeKind,
        dense: denseIds,
        bm25: bm25Ids,
        rrf: rrfIds,
        expected: query.expectedRelevantMemberIds,
      });
      rrfRecalls.push(
        recallAtK({ retrieved: rrfIds, relevant: query.expectedRelevantMemberIds, k: policy.topK }),
      );
      rrfNdcgs.push(
        ndcgAtK({ retrieved: rrfIds, relevant: query.expectedRelevantMemberIds, k: policy.topK }),
      );
      quality.rankings.push({ queryId: query.queryId, memberIds: rrfIds });
      for (const hit of result.fused) {
        if (
          hit.payload.projectId !== query.projectId ||
          hit.payload.authorizationScopeDigest !== generationScopeDigest
        ) {
          quality.leakage += 1;
        }
      }
    }
    const mean = (values: readonly number[]): number =>
      values.reduce((total, value) => total + value, 0) / values.length;
    quality.denseRecall = mean(denseRecalls);
    quality.bm25Recall = mean(bm25Recalls);
    quality.rrfRecall = mean(rrfRecalls);
    quality.rrfNdcg = mean(rrfNdcgs);

    // 跨工程干扰：payload 过滤必须在融合与两条单路里同时收窄到 0 个候选；
    // 同工程无权限干扰的整次拒绝由 C17 回查门禁承担（见 hybrid-retrieval-service.test.ts）。
    for (const interference of dataset.interference) {
      if (interference.interferenceKind !== "cross-project") continue;
      const result = await projection.queryHybrid({
        collectionName: manifest.collectionName,
        generationRef: manifest.generationRef,
        queryDenseVector: [...queryVectorFor("seepage-piping")],
        queryText: interference.text,
        policy,
        filter: {
          projectId: interference.projectId,
          generationRef: manifest.generationRef,
          authorizationScopeDigest: generationScopeDigest,
          visiblePointIds: manifest.manifest.members.map((member) => member.pointId),
        },
      });
      quality.leakage += result.fused.length;
      quality.leakage += result.denseRoute.length + result.bm25Route.length;
    }

    const probe = dataset.queries[0]!;
    const samples: number[] = [];
    for (let run = 0; run < acceptancePolicy.warmupRuns + acceptancePolicy.measuredRuns; run += 1) {
      const result = await projection.queryHybrid({
        collectionName: manifest.collectionName,
        generationRef: manifest.generationRef,
        queryDenseVector: [...queryVectorFor(probe.semanticGroup)],
        queryText: probe.text,
        policy,
        filter: {
          projectId: probe.projectId,
          generationRef: manifest.generationRef,
          authorizationScopeDigest: generationScopeDigest,
          visiblePointIds: manifest.manifest.members.map((member) => member.pointId),
        },
      });
      if (run >= acceptancePolicy.warmupRuns) samples.push(result.fusedQueryDurationMs);
    }
    quality.p95Ms = percentile(samples, 0.95);
    quality.p95Samples = samples.length;
    quality.reconciliationRatio = firstReconciliation.consistent ? 1 : 0;
  }, 300_000);

  afterAll(async () => {
    if (fixture !== undefined) await fixture.stop();
  });

  it("reconciles every member across both index routes against the PostgreSQL manifest", () => {
    expect(firstReconciliation.differences).toEqual([]);
    expect(firstReconciliation.consistent).toBe(true);
    expect(firstReconciliation.checkedMemberCount).toBe(dataset.members.length);
  });

  it("reports dual-route and fused quality metrics per query", () => {
    for (const query of dataset.queries) {
      const ranking = quality.rankings.find((entry) => entry.queryId === query.queryId);
      expect(ranking).toBeDefined();
      expect(ranking!.memberIds.length).toBeGreaterThan(0);
      for (const memberId of ranking!.memberIds) {
        expect(semanticGroupByMemberId.has(memberId)).toBe(true);
      }
    }
    expect(quality.p95Samples).toBe(acceptancePolicy.measuredRuns);
    console.log(JSON.stringify(quality.perQuery, null, 1));
    console.log(
      JSON.stringify(
        {
          denseRecallAt5: quality.denseRecall,
          bm25RecallAt5: quality.bm25Recall,
          rrfRecallAt5: quality.rrfRecall,
          rrfNdcgAt5: quality.rrfNdcg,
          reconciliationRatio: quality.reconciliationRatio,
          authorizationLeakage: quality.leakage,
          qdrantQueryP95Ms: quality.p95Ms,
          p95SampleCount: quality.p95Samples,
          endpoint: fixture.endpoint,
          qdrantServiceVersion: fixture.serviceVersion,
        },
        null,
        1,
      ),
    );
  });

  it("passes every hard gate independently and never hides a single-route failure", () => {
    const report = evaluateRetrievalAcceptance({
      policy: acceptancePolicy,
      measurements: {
        denseRecallAt5: quality.denseRecall,
        bm25RecallAt5: quality.bm25Recall,
        rrfRecallAt5: quality.rrfRecall,
        rrfNdcgAt5: quality.rrfNdcg,
        reconciliationRatio: quality.reconciliationRatio,
        authorizationLeakage: quality.leakage,
        qdrantQueryP95Ms: quality.p95Ms,
        queryCount: dataset.queries.length,
        memberCount: dataset.members.length,
        p95SampleCount: quality.p95Samples,
        environment: {
          nodeVersion: process.version,
          containerRuntime: `docker/${fixture.endpoint}`,
          qdrantServiceRef: `${QDRANT_TEST_IMAGE}#${fixture.serviceVersion}`,
          cpuModel: cpus()[0]?.model ?? "unknown",
          platform: platform(),
        },
        measuredAt: new Date().toISOString(),
      },
    });

    // 报告是验收证据：逐门独立结论 + 合成样本标记必须同时存在。
    console.log(JSON.stringify(report, null, 1));
    expect(report.gates).toHaveLength(7);
    for (const gate of report.gates) {
      expect(gate.passed).toBe(true);
    }
    expect(report.sampleNotice).toBe("合成样本、待甲方复核");
    expect(report.overall).toBe("passed");
    expect(quality.leakage).toBe(0);
  }, 120_000);

  it("rebuilds equivalent generations after deleting every C20 collection", async () => {
    const collections = await projection.listRetrievalCollections({
      namePrefix: "riskflow-retrieval-",
    });
    expect(collections).toContain(manifest.collectionName);
    for (const collectionName of collections) {
      await projection.deleteGenerationCollection({
        collectionName,
        generationRef: manifest.generationRef,
      });
    }
    expect(
      await projection.listRetrievalCollections({ namePrefix: "riskflow-retrieval-" }),
    ).toEqual([]);

    const rebuilt = await buildGeneration(projection);
    expect(rebuilt.consistent).toBe(true);
    expect(rebuilt.checkedMemberCount).toBe(firstReconciliation.checkedMemberCount);

    for (const query of dataset.queries) {
      const result = await projection.queryHybrid({
        collectionName: manifest.collectionName,
        generationRef: manifest.generationRef,
        queryDenseVector: [...queryVectorFor(query.semanticGroup)],
        queryText: query.text,
        policy,
        filter: {
          projectId: query.projectId,
          generationRef: manifest.generationRef,
          authorizationScopeDigest: generationScopeDigest,
          visiblePointIds: manifest.manifest.members.map((member) => member.pointId),
        },
      });
      const rebuildIds = memberIdsOf(result.fused.map((hit) => hit.pointId));
      const original = quality.rankings.find((entry) => entry.queryId === query.queryId);
      expect(rebuildIds).toEqual(original?.memberIds);
    }
  }, 180_000);
});
