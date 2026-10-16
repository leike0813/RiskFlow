import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { authorizationScopeDigest } from "../../packages/core/dist/retrieval/index.js";

import { createDeploymentBuildQualityGateV1 } from "./composition/quality-gate.mjs";
import { startRetrievalFixture } from "../../packages/adapters/test/retrieval/postgres-retrieval-fixture.ts";

/**
 * C37 D-20 / IP-04：C20 构建门禁的部署组合行为。
 * 替身只承担计算与装配契约；真实 Qdrant 三路质量由 adapters 既有验收测试承担。
 */

const PROJECT_ID = "project-c37-gate";
const ACTOR_ID = "actor-c37";
const CONTENT_DIGEST = "a".repeat(64);
const OTHER_DIGEST = "b".repeat(64);
const TIMESTAMP = "2026-10-11T02:00:00.000Z";

const generationRef = Object.freeze({
  kind: "retrieval-generation",
  reference: Object.freeze({ entityId: "retrieval-generation-c37", versionId: "g1" }),
});
const authorizationContextRef = Object.freeze({
  kind: "authorization-context",
  reference: Object.freeze({ entityId: "authorization-context-c37", versionId: "1" }),
});
const evidenceBaseReleaseRef = Object.freeze({
  kind: "retrieval-evidence-base-release",
  reference: Object.freeze({ entityId: "evidence-base-c37", versionId: "v1" }),
});
const knowledgeReleaseRef = (entityId) =>
  Object.freeze({
    kind: "knowledge-release",
    reference: Object.freeze({ entityId, versionId: "r1" }),
  });

const authorization = {
  schemaVersion: "1",
  authorizationContextRef,
  actorId: ACTOR_ID,
  projectId: PROJECT_ID,
  grantedCapabilities: ["knowledge-modeling.retrieve"],
  spatialScopeRefs: [
    { kind: "spatial-scope", reference: { entityId: "spatial-scope-1", versionId: "1" } },
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
};
const SCOPE_DIGEST = authorizationScopeDigest(authorization);

const policy = Object.freeze({
  schemaVersion: "1",
  policyRef: Object.freeze({ entityId: "retrieval-policy", versionId: "c37-gate-v1" }),
  evidenceBaseDefinitionType: "retrieval-evidence-base",
  modelDeploymentRef: Object.freeze({
    entityId: "embedding-deployment",
    versionId: "c37-gate-v1",
  }),
  dense: { vectorName: "dense", dimensions: 4, distance: "cosine" },
  bm25: {
    vectorName: "bm25",
    model: "qdrant/bm25",
    tokenizer: "multilingual",
    language: "chinese",
    stemmer: "none",
    stopwords: [],
  },
  densePrefetchLimit: 10,
  bm25PrefetchLimit: 10,
  topK: 3,
  rrf: { k: 60, denseWeight: 0.6, bm25Weight: 0.4 },
  memberBatchLimit: 16,
  memberByteLimit: 8192,
  memberLimit: 64,
  embeddingTimeoutMs: 5000,
  projectionTimeoutMs: 10_000,
  acceptancePolicyRef: Object.freeze({
    entityId: "retrieval-acceptance-policy",
    versionId: "c37-gate-v1",
  }),
  projectionCompatibilityRef: Object.freeze({
    entityId: "projection-compatibility",
    versionId: "c37-gate-v1",
  }),
});

const MEMBERS = [
  {
    pointId: "point-1",
    sourceKind: "risk-mechanism",
    sourceEntryId: "entry-1",
    releaseRef: knowledgeReleaseRef("risk-mechanism-release"),
  },
  {
    pointId: "point-2",
    sourceKind: "standard-library",
    sourceEntryId: "entry-2",
    releaseRef: knowledgeReleaseRef("standard-library-release"),
  },
  {
    pointId: "point-3",
    sourceKind: "case-library",
    sourceEntryId: "entry-3",
    releaseRef: knowledgeReleaseRef("case-library-release"),
  },
];

const manifest = Object.freeze({
  schemaVersion: "1",
  projectId: PROJECT_ID,
  generationRef,
  policyRef: policy.policyRef,
  modelDeploymentRef: policy.modelDeploymentRef,
  projectionCompatibilityRef: policy.projectionCompatibilityRef,
  membersSha256: CONTENT_DIGEST,
  members: MEMBERS.map((member, index) => ({
    memberRef: {
      kind: "retrieval-member",
      reference: { entityId: `member-${index}`, versionId: "m1" },
    },
    pointId: member.pointId,
    sourceKind: member.sourceKind,
    sourceReleaseRef: member.releaseRef,
    sourceEntryId: member.sourceEntryId,
    contentDigest: CONTENT_DIGEST,
    authorizationScopeDigest: SCOPE_DIGEST,
    denseDimensions: 4,
    bm25Language: "chinese",
  })),
});

const generation = Object.freeze({
  schemaVersion: "1",
  generationRef,
  identity: Object.freeze({
    projectId: PROJECT_ID,
    sourceEventId: "event-1",
    evidenceBaseReleaseRef,
    memberReleaseRefs: Object.freeze({
      riskMechanismRef: MEMBERS[0].releaseRef,
      standardLibraryRef: MEMBERS[1].releaseRef,
      caseLibraryRef: MEMBERS[2].releaseRef,
    }),
    policyRef: policy.policyRef,
    modelDeploymentRef: policy.modelDeploymentRef,
    projectionCompatibilityRef: policy.projectionCompatibilityRef,
  }),
  collectionName: "collection-c37-gate",
  authorizationScopeDigest: SCOPE_DIGEST,
  expectedMemberCount: 3,
  manifestSha256: CONTENT_DIGEST,
  createdAt: TIMESTAMP,
  createdBy: ACTOR_ID,
  authorizationContextRef,
});

const dataset = Object.freeze({
  schemaVersion: "1",
  projectId: PROJECT_ID,
  datasetRef: Object.freeze({ entityId: "retrieval-dataset", versionId: "c37-gate-v1" }),
  evidenceBaseReleaseRef,
  syntheticSample: true,
  sampleNotice: "合成样本、待甲方复核",
  queries: [
    {
      queryId: "query-1",
      queryText: "盾构开仓渗漏风险机理",
      relevance: [
        {
          sourceKind: "risk-mechanism",
          sourceReleaseRef: MEMBERS[0].releaseRef,
          sourceEntryId: "entry-1",
          grade: 3,
        },
        {
          sourceKind: "standard-library",
          sourceReleaseRef: MEMBERS[1].releaseRef,
          sourceEntryId: "entry-2",
          grade: 1,
        },
      ],
    },
    {
      queryId: "query-2",
      queryText: "类似工程开仓事故案例",
      relevance: [
        {
          sourceKind: "case-library",
          sourceReleaseRef: MEMBERS[2].releaseRef,
          sourceEntryId: "entry-3",
          grade: 2,
        },
      ],
    },
  ],
});

const acceptancePolicy = Object.freeze({
  schemaVersion: "1",
  acceptancePolicyRef: policy.acceptancePolicyRef,
  datasetRef: dataset.datasetRef,
  syntheticSample: true,
  topK: 2,
  denseRecallAt5Min: 0.5,
  bm25RecallAt5Min: 0.5,
  rrfRecallAt5Min: 0.5,
  rrfNdcgAt5Min: 0.5,
  reconciliationRatioMin: 1,
  authorizationLeakageMax: 0,
  qdrantQueryP95MsMax: 100,
  warmupRuns: 1,
  measuredRuns: 3,
});

const reconciliation = Object.freeze({
  consistent: true,
  checkedMemberCount: 3,
  differences: [],
});

const payloadOf = (member, scopeDigest = SCOPE_DIGEST) => ({
  schemaVersion: "1",
  projectId: PROJECT_ID,
  generationRef,
  generationKey: generationRef.reference.versionId,
  sourceKind: member.sourceKind,
  sourceReleaseRef: member.releaseRef,
  sourceEntryId: member.sourceEntryId,
  contentDigest: CONTENT_DIGEST,
  authorizationScopeDigest: scopeDigest,
});

const route = (pointIds) =>
  pointIds.map((pointId, index) => ({ pointId, rank: index + 1, score: 1 - index / 10 }));

/** 默认三路命中：dense/bm25/融合都把 query-1 的相关成员放在前两位。 */
const queryResult = (overrides = {}) => ({
  collectionName: generation.collectionName,
  generationRef,
  serviceVersion: "1.19.0",
  fused: [MEMBERS[0], MEMBERS[1]].map((member, index) => ({
    pointId: member.pointId,
    rank: index + 1,
    score: 1 - index / 10,
    denseRank: index + 1,
    bm25Rank: index + 2,
    denseContribution: 0.01 * (index + 1),
    bm25Contribution: 0.005 * (index + 1),
    payload: payloadOf(member),
  })),
  denseRoute: route([MEMBERS[0].pointId, MEMBERS[1].pointId, MEMBERS[2].pointId]),
  bm25Route: route([MEMBERS[1].pointId, MEMBERS[0].pointId, MEMBERS[2].pointId]),
  fusedQueryDurationMs: 5,
  ...overrides,
});

const createHarness = (options = {}) => {
  const state = {
    embedCalls: [],
    queryCalls: 0,
    queryTexts: [],
    queryFilters: [],
    verifyCalls: [],
    reports: [],
  };
  const gate = createDeploymentBuildQualityGateV1({
    datasets: [dataset],
    acceptancePolicies: [{ projectId: PROJECT_ID, policy: acceptancePolicy }],
    generationStore: { readGeneration: async () => structuredClone(generation) },
    projection: {
      queryHybrid: async (query) => {
        state.queryCalls += 1;
        state.queryTexts.push(query.queryText);
        state.queryFilters.push(query.filter);
        const result = options.queryResult
          ? options.queryResult(state.queryCalls)
          : queryResult({ fusedQueryDurationMs: 4 + state.queryCalls });
        return result;
      },
      serviceVersion: async () => ({ version: "1.19.0" }),
    },
    modelGateway: {
      embed: async (request, signal) => {
        state.embedCalls.push({ request, signal });
        return {
          vectors: [[1, 0, 0, 0]],
          dimensions: 4,
          modelDeploymentRef: policy.modelDeploymentRef,
        };
      },
    },
    access: {
      verifyDeploymentContext: async (request) => {
        state.verifyCalls.push(request);
        if (options.verify !== undefined) return options.verify(request);
        return { context: authorization };
      },
    },
    budgetPolicyRef: { entityId: "budget-policy", versionId: "1" },
    timeoutMs: 2000,
    containerRuntime: "docker-27.1.1",
    onReport: async (report) => {
      state.reports.push(report);
    },
    ...options.overrides,
  });
  return {
    gate,
    state,
    input: (overrides = {}) => ({
      projectId: PROJECT_ID,
      generationRef,
      manifest,
      reconciliation,
      policy,
      ...overrides,
    }),
  };
};

describe("C20 构建门禁的部署组合", () => {
  it("reads an uncommitted building generation through the caller transaction only", async () => {
    const fixture = await startRetrievalFixture();
    try {
      const { gate, state, input } = createHarness({
        overrides: { generationStore: fixture.adapter },
      });
      const command = {
        projectId: PROJECT_ID,
        commandKind: "retrieval-quality-fixture",
        commandId: "retrieval-quality-command",
        idempotencyKey: "retrieval-quality-command",
        payload: { generationRef },
        actorRef: ACTOR_ID,
        authorizationContextRef,
        issuedAt: TIMESTAMP,
      };
      await fixture.transactionUnit.execute(command, async (context) => {
        await fixture.adapter.ensureBuildingGeneration({
          generation,
          transitionRef: {
            kind: "retrieval-generation-transition",
            reference: { entityId: "retrieval-quality-building", versionId: "1" },
          },
          actorRef: ACTOR_ID,
          authorizationContextRef,
          occurredAt: TIMESTAMP,
          context,
        });
        expect(await fixture.adapter.readGeneration(generationRef)).toBeUndefined();
        await expect(gate.evaluate(input())).resolves.toMatchObject({
          passed: false,
          detailCode: "generation-not-found",
        });
        await expect(gate.evaluate(input(), context)).resolves.toMatchObject({ passed: true });
        expect(state.reports).toHaveLength(1);
        expect(await fixture.adapter.readGenerationStatus(generationRef, context)).toBe("building");
        return {
          resultRef: authorizationContextRef,
          audit: {
            auditEntryId: "retrieval-quality-audit",
            projectId: PROJECT_ID,
            action: command.commandKind,
            targetRef: authorizationContextRef,
            actorRef: ACTOR_ID,
            authorizationContextRef,
            occurredAt: TIMESTAMP,
            recordedAt: TIMESTAMP,
            version: authorizationContextRef.reference,
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
          },
          events: [],
        };
      });
      expect(await fixture.adapter.readGeneration(generationRef)).toEqual(generation);
      expect(await fixture.adapter.readActivation(generationRef)).toBeUndefined();
    } finally {
      await fixture.close();
    }
  });

  it("按数据集真实计算三路指标并经 onReport 耐久保存报告后才通过", async () => {
    const { gate, state, input } = createHarness();

    await expect(gate.evaluate(input())).resolves.toEqual({
      passed: true,
      detailCode: "acceptance-gates-passed",
    });

    // 每次 Embedding 都先按代际登记的授权引用与创建者复验，并复用同一 Embedding 向量做 p95 探针。
    expect(state.verifyCalls).toHaveLength(2);
    expect(state.verifyCalls[0]).toMatchObject({
      authorizationContextRef,
      actorId: ACTOR_ID,
      requiredCapability: "knowledge-modeling.retrieve",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
    });
    expect(state.embedCalls[0].request.texts).toEqual([dataset.queries[0].queryText]);
    expect(state.embedCalls[0].signal).toBeDefined();
    // 两次查询各一轮指标，加探针查询的 1 次预热与 3 次测量。
    expect(state.queryCalls).toBe(6);
    // 每次查询（含探针）都以本代清单实际成员收窄可见范围（D-05），不得省略该过滤。
    expect(state.queryFilters).toHaveLength(6);
    for (const filter of state.queryFilters) {
      expect(filter.visiblePointIds).toEqual(MEMBERS.map((member) => member.pointId));
    }

    const report = state.reports[0];
    expect(report.overall).toBe("passed");
    expect(report.sampleNotice).toBe("合成样本、待甲方复核");
    expect(report.environment).toMatchObject({
      nodeVersion: process.version,
      containerRuntime: "docker-27.1.1",
      qdrantServiceRef: "1.19.0",
      platform: `${process.platform}/${process.arch}`,
    });
    const observed = Object.fromEntries(report.gates.map((gate) => [gate.gateId, gate.observed]));
    expect(observed["dense-recall-at-5"]).toBe(0.5);
    expect(observed["bm25-recall-at-5"]).toBe(0.5);
    expect(observed["rrf-recall-at-5"]).toBe(0.5);
    expect(observed["rrf-ndcg-at-5"]).toBe(0.5);
    expect(observed["dual-index-reconciliation"]).toBe(1);
    expect(observed["authorization-leakage"]).toBe(0);
    expect(observed["qdrant-query-p95-ms"]).toBe(9);
    expect(report.gates.find((gate) => gate.gateId === "qdrant-query-p95-ms").sampleCount).toBe(3);
  });

  it("命中越权或非本代清单成员时授权泄漏硬门独立失败", async () => {
    const harness = createHarness({
      // 只污染融合载荷的授权范围摘要：召回不受影响，泄漏硬门必须独立失败。
      queryResult: () => {
        const base = queryResult();
        return {
          ...base,
          fused: base.fused.map((hit, index) =>
            index === 0
              ? hit
              : {
                  ...hit,
                  payload: { ...hit.payload, authorizationScopeDigest: OTHER_DIGEST },
                },
          ),
        };
      },
    });

    await expect(harness.gate.evaluate(harness.input())).resolves.toEqual({
      passed: false,
      detailCode: "authorization-leakage",
    });
  });

  it("清单摘要与正式代际不一致时直接不通过且不发查询", async () => {
    const harness = createHarness();
    const drifted = { ...manifest, membersSha256: OTHER_DIGEST };

    await expect(gateWithDrift(harness, drifted)).resolves.toEqual({
      passed: false,
      detailCode: "manifest-digest-mismatch",
    });
    expect(harness.state.queryCalls).toBe(0);
    expect(harness.state.reports).toHaveLength(0);
  });

  it("相关性成员无法映射到本代清单时不通过", async () => {
    const harness = createHarness();
    const unknownMember = {
      ...dataset,
      queries: [
        dataset.queries[0],
        {
          ...dataset.queries[1],
          relevance: [
            {
              sourceKind: "risk-mechanism",
              sourceReleaseRef: MEMBERS[0].releaseRef,
              sourceEntryId: "entry-absent",
              grade: 3,
            },
          ],
        },
      ],
    };

    const unmapped = createHarness({ overrides: { datasets: [unknownMember] } });
    await expect(unmapped.gate.evaluate(unmapped.input())).resolves.toEqual({
      passed: false,
      detailCode: "relevance-member-unmapped",
    });
    // 全部查询先核对：后面的查询缺成员时也不得先产生 Embedding 副作用。
    expect(unmapped.state.embedCalls).toHaveLength(0);
    expect(harness.state.queryCalls).toBe(0);
  });

  it("授权被拒或摘要不是本代际时在 Embedding 前失败", async () => {
    const readOnly = createHarness({
      verify: () => ({
        context: { ...authorization, grantedCapabilities: ["knowledge-modeling.read"] },
      }),
    });
    await expect(readOnly.gate.evaluate(readOnly.input())).resolves.toMatchObject({
      passed: false,
      detailCode: "authorization-capability-missing",
    });
    expect(readOnly.state.embedCalls).toHaveLength(0);

    const denied = createHarness({
      verify: () => {
        throw new Error("AUTHORIZATION_DENIED");
      },
    });
    await expect(denied.gate.evaluate(denied.input())).resolves.toEqual({
      passed: false,
      detailCode: "authorization-rejected",
    });
    expect(denied.state.embedCalls).toHaveLength(0);

    const drifted = createHarness({
      verify: () => ({
        context: {
          ...authorization,
          spatialScopeRefs: [
            {
              kind: "spatial-scope",
              reference: { entityId: "spatial-scope-other", versionId: "1" },
            },
          ],
        },
      }),
    });
    await expect(drifted.gate.evaluate(drifted.input())).resolves.toEqual({
      passed: false,
      detailCode: "authorization-scope-digest-mismatch",
    });
    expect(drifted.state.embedCalls).toHaveLength(0);
  });

  it("总截止到达即失败，迟到结果不计成功也不再发新查询", async () => {
    let release;
    const hung = createHarness({
      queryResult: () =>
        new Promise((resolve) => {
          release = () => resolve(queryResult());
        }),
      overrides: { timeoutMs: 30 },
    });

    await expect(hung.gate.evaluate(hung.input())).resolves.toEqual({
      passed: false,
      detailCode: "quality-gate-deadline-exceeded",
    });
    expect(hung.state.queryCalls).toBe(1);
    expect(hung.state.reports).toHaveLength(0);

    release();
    await delay(10);
    expect(hung.state.queryCalls).toBe(1);
    expect(hung.state.reports).toHaveLength(0);
  });

  it("报告未被宿主耐久保存时不通过", async () => {
    const harness = createHarness({
      overrides: {
        onReport: async () => {
          throw new Error("ARTIFACT_PUT_FAILED");
        },
      },
    });

    await expect(harness.gate.evaluate(harness.input())).resolves.toEqual({
      passed: false,
      detailCode: "quality-gate-report-not-saved",
    });
  });

  it("缺少验收策略或精确数据集时按缺失失败，不回落默认值", async () => {
    const otherProject = createHarness({
      overrides: {
        acceptancePolicies: [{ projectId: "project-other", policy: acceptancePolicy }],
      },
    });
    await expect(otherProject.gate.evaluate(otherProject.input())).resolves.toEqual({
      passed: false,
      detailCode: "acceptance-policy-not-found",
    });

    const otherDataset = {
      ...dataset,
      datasetRef: { entityId: "retrieval-dataset", versionId: "other" },
    };
    const missingDataset = createHarness({ overrides: { datasets: [otherDataset] } });
    await expect(missingDataset.gate.evaluate(missingDataset.input())).resolves.toEqual({
      passed: false,
      detailCode: "retrieval-dataset-not-found",
    });
  });

  it("成员发布引用与代际槽位不一致时按证据不成立失败", async () => {
    const drifted = {
      ...manifest,
      members: manifest.members.map((member, index) =>
        index === 1 ? { ...member, sourceReleaseRef: MEMBERS[0].releaseRef } : member,
      ),
    };
    const harness = createHarness();

    await expect(harness.gate.evaluate(harness.input({ manifest: drifted }))).resolves.toEqual({
      passed: false,
      detailCode: "member-release-mismatch",
    });
    expect(harness.state.embedCalls).toHaveLength(0);
  });

  it("单路命中非本代清单 pointId 与探针命中的泄漏都计入授权泄漏门", async () => {
    const strayRoute = createHarness({
      queryResult: () =>
        queryResult({
          denseRoute: route([MEMBERS[0].pointId, MEMBERS[1].pointId, "point-absent"]),
        }),
    });
    await expect(strayRoute.gate.evaluate(strayRoute.input())).resolves.toEqual({
      passed: false,
      detailCode: "authorization-leakage",
    });

    // 首轮指标结果干净，后续探针结果泄漏：探针同样必须被检查。
    const leakyProbe = createHarness({
      queryResult: (calls) =>
        calls === 1
          ? queryResult()
          : queryResult({
              fused: [
                {
                  pointId: MEMBERS[0].pointId,
                  rank: 1,
                  score: 1,
                  denseContribution: 0.01,
                  bm25Contribution: 0.01,
                  payload: payloadOf(MEMBERS[0]),
                },
              ].map((hit) => ({
                ...hit,
                payload: { ...hit.payload, contentDigest: OTHER_DIGEST },
              })),
            }),
    });
    await expect(leakyProbe.gate.evaluate(leakyProbe.input())).resolves.toEqual({
      passed: false,
      detailCode: "authorization-leakage",
    });
  });

  it("同一 pointId 在结果里重复命中不会把分级 NDCG 放大到 1 以上", async () => {
    const duplicated = createHarness({
      queryResult: () => {
        const base = queryResult();
        return { ...base, fused: [base.fused[0], base.fused[1], base.fused[0]] };
      },
    });

    await expect(duplicated.gate.evaluate(duplicated.input())).resolves.toEqual({
      passed: true,
      detailCode: "acceptance-gates-passed",
    });
    const ndcg = duplicated.state.reports[0].gates.find((gate) => gate.gateId === "rrf-ndcg-at-5");
    expect(ndcg.observed).toBe(0.5);
    expect(ndcg.observed).toBeLessThanOrEqual(1);
  });

  it("总截止覆盖代际读取与报告保存，迟到结果一律不通过", async () => {
    const slowStore = createHarness({
      overrides: {
        timeoutMs: 30,
        generationStore: {
          readGeneration: async () => {
            await delay(80);
            return generation;
          },
        },
      },
    });
    await expect(slowStore.gate.evaluate(slowStore.input())).resolves.toEqual({
      passed: false,
      detailCode: "quality-gate-deadline-exceeded",
    });
    expect(slowStore.state.reports).toHaveLength(0);

    const slowReport = createHarness({
      overrides: {
        timeoutMs: 30,
        onReport: async () => {
          await delay(80);
        },
      },
    });
    await expect(slowReport.gate.evaluate(slowReport.input())).resolves.toEqual({
      passed: false,
      detailCode: "quality-gate-deadline-exceeded",
    });
    // 已经开始的保存动作自行 settle，但超时结果不得当成通过。
    await delay(80);
    expect(slowReport.state.reports).toHaveLength(0);
  });

  it("目录重复精确键与超限轮次在装配期拒绝", () => {
    expect(() => createHarness({ overrides: { datasets: [dataset, dataset] } })).toThrow(
      /DEPLOYMENT_QUALITY_GATE_DUPLICATE_KEY:datasets/,
    );
    expect(() =>
      createHarness({
        overrides: {
          acceptancePolicies: [
            { projectId: PROJECT_ID, policy: acceptancePolicy },
            { projectId: PROJECT_ID, policy: acceptancePolicy },
          ],
        },
      }),
    ).toThrow(/DEPLOYMENT_QUALITY_GATE_DUPLICATE_KEY:acceptancePolicies/);
    expect(() =>
      createHarness({
        overrides: {
          acceptancePolicies: [
            {
              projectId: PROJECT_ID,
              policy: { ...acceptancePolicy, warmupRuns: 90, measuredRuns: 90 },
            },
          ],
        },
      }),
    ).toThrow(/DEPLOYMENT_QUALITY_GATE_MEASURED_RUNS_EXCEEDED/);
  });

  it("策略声明查询指令时只渲染查询 Embedding 文本，BM25 查询仍用原文本", async () => {
    const instruction =
      "Given a Chinese engineering risk query, retrieve the applicable standard clauses";
    const { gate, state, input } = createHarness();

    await expect(
      gate.evaluate(input({ policy: { ...policy, queryInstruction: instruction } })),
    ).resolves.toEqual({ passed: true, detailCode: "acceptance-gates-passed" });

    expect(state.embedCalls.map((call) => call.request.texts)).toEqual(
      dataset.queries.map((query) => [`Instruct: ${instruction}\nQuery:${query.queryText}`]),
    );
    expect(new Set(state.queryTexts)).toEqual(
      new Set(dataset.queries.map((query) => query.queryText)),
    );
  });

  it("独立质量测量不得复用前一次查询的模型工件身份", async () => {
    const { gate, state, input } = createHarness();
    await expect(gate.evaluate(input())).resolves.toMatchObject({ passed: true });
    await expect(
      gate.evaluate(
        input({ policy: { ...policy, queryInstruction: "Retrieve engineering standards" } }),
      ),
    ).resolves.toMatchObject({ passed: true });
    const keys = state.embedCalls.map((call) => call.request.idempotencyKey);
    expect(keys).toHaveLength(dataset.queries.length * 2);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("缺必需依赖与耐久回调时拒绝装配", () => {
    expect(() => createHarness({ overrides: { onReport: undefined } })).toThrow(
      /DEPLOYMENT_QUALITY_GATE_DEPENDENCY_MISSING:onReport/,
    );
    expect(() => createHarness({ overrides: { modelGateway: {} } })).toThrow(
      /DEPLOYMENT_QUALITY_GATE_PORT_INVALID:modelGateway.embed/,
    );
    expect(() => createHarness({ overrides: { timeoutMs: 0 } })).toThrow(
      /DEPLOYMENT_QUALITY_GATE_INPUT_INVALID:timeoutMs/,
    );
  });
});

const gateWithDrift = (harness, driftedManifest) =>
  harness.gate.evaluate(harness.input({ manifest: driftedManifest }));
