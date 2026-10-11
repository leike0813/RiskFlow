import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  AuthorizationContextV1Schema,
  type AuthorizationContextV1,
} from "@riskflow/contracts/ports";
import { CANDIDATE_REPAIRABLE_REASON_CODES_V1 } from "@riskflow/core/identification/candidate-finalization";
import {
  DEPLOYMENT_POLICY_ERROR_V1,
  DeploymentPolicyCatalogV1Schema,
  DeploymentPolicyError,
  createDeploymentPolicyCatalogReaderV1,
  createDeploymentPolicyResolversV1,
} from "../../src/deployment/policies.js";
import {
  DEPLOYMENT_QUALITY_GATE_ERROR_V1,
  DeploymentQualityGateError,
  createDeploymentRetrievalQualityGateV1,
} from "../../src/deployment/quality-gate.js";
import {
  DEPLOYMENT_PROJECT_PAGE_MAX_V1,
  createDeploymentProjectListerV1,
  createDeploymentSiteContextReaderV1,
  createDeploymentSpatialPairingReaderV1,
  type DeploymentProjectSummaryV1,
} from "../../src/deployment/readers.js";
import {
  DEPLOYMENT_RETRIEVAL_QUERY_TEXT_MAX_BYTES_V1,
  DeploymentRetrievalDatasetV1Schema,
  DeploymentSyntheticSiteContextPackV1Schema,
} from "../../src/deployment/schema.js";
import type { ArtifactReadHandleV1, ArtifactStoreV1 } from "@riskflow/core/artifacts";

const projectId = "project-rail-01";
const approval = {
  approvedBy: "operator-01",
  approvedAt: "2030-01-01T00:00:00.000Z",
  releaseId: "release-2030-01",
};

const acceptancePolicy = {
  schemaVersion: "1" as const,
  acceptancePolicyRef: { entityId: "acceptance-policy", versionId: "v3" },
  datasetRef: { entityId: "retrieval-dataset", versionId: "v2" },
  syntheticSample: false,
  topK: 5,
  denseRecallAt5Min: 0.8,
  bm25RecallAt5Min: 0.8,
  rrfRecallAt5Min: 0.85,
  rrfNdcgAt5Min: 0.75,
  reconciliationRatioMin: 1,
  authorizationLeakageMax: 0,
  qdrantQueryP95MsMax: 120,
  warmupRuns: 1,
  measuredRuns: 3,
};

const retryPolicy = {
  schemaVersion: "1" as const,
  policyRef: { entityId: "retry-policy", versionId: "v1" },
  maxAttempts: 3,
  backoffMs: 250,
};

const calibrationPolicy = {
  schemaVersion: "1" as const,
  policyRef: { entityId: "calibration-policy", versionId: "v1" },
  projectId,
  definitionRef: { entityId: "calibration-definition", versionId: "v1" },
  toolPolicyRef: { entityId: "calibration-tools", versionId: "v1" },
  incrementSchemaRef: { entityId: "calibration-increment", versionId: "v1" },
  validationPolicyRef: { entityId: "calibration-validation", versionId: "v1" },
  budgetPolicy: {
    schemaVersion: "1" as const,
    policyRef: { entityId: "calibration-budget", versionId: "v1" },
    modelDeploymentRef: { entityId: "calibration-model", versionId: "v1" },
    promptTemplateRef: { entityId: "calibration-prompt", versionId: "v1" },
    toolPolicyRef: { entityId: "calibration-tools", versionId: "v1" },
    maxModelInvocations: 1,
    maxToolInvocations: 1,
    maxContextTokens: 100,
    maxInputBytes: 1000,
    maxOutputBytes: 1000,
    maxCandidates: 1,
    maxObjects: 8,
    maxSupplementarySearches: 0,
    maxCorrections: 0,
    maxTransientRetries: 0,
    maxConcurrentActions: 1,
    maxWallClockMs: 60_000,
  },
  evidenceRequirementCount: 1,
  maxOperations: 1,
};

const hybridRetrievalPolicy = {
  schemaVersion: "1" as const,
  policyRef: { entityId: "hybrid-policy", versionId: "v1" },
  evidenceBaseDefinitionType: "retrieval-evidence-base" as const,
  modelDeploymentRef: { entityId: "embedding-model", versionId: "v1" },
  dense: { vectorName: "dense" as const, dimensions: 8, distance: "cosine" as const },
  bm25: {
    vectorName: "bm25" as const,
    model: "qdrant/bm25" as const,
    tokenizer: "multilingual" as const,
    language: "zh-CN",
    stemmer: "none" as const,
    stopwords: [],
  },
  densePrefetchLimit: 5,
  bm25PrefetchLimit: 5,
  topK: 5,
  rrf: { k: 60, denseWeight: 1, bm25Weight: 1 },
  memberBatchLimit: 10,
  memberByteLimit: 1024,
  memberLimit: 10,
  embeddingTimeoutMs: 1000,
  projectionTimeoutMs: 1000,
  acceptancePolicyRef: { entityId: "acceptance-policy", versionId: "v3" },
  projectionCompatibilityRef: { entityId: "projection-compatibility", versionId: "v1" },
};

const measured = (
  overrides: Record<string, unknown> = {},
  provenance: {
    acceptancePolicyRef?: { entityId: string; versionId: string };
    datasetRef?: { entityId: string; versionId: string };
  } = {},
) => ({
  acceptancePolicyRef: provenance.acceptancePolicyRef ?? acceptancePolicy.acceptancePolicyRef,
  datasetRef: provenance.datasetRef ?? acceptancePolicy.datasetRef,
  measurements: measurements(overrides),
});

const measurements = (overrides: Record<string, unknown> = {}) => ({
  denseRecallAt5: 0.92,
  bm25RecallAt5: 0.9,
  rrfRecallAt5: 0.94,
  rrfNdcgAt5: 0.81,
  reconciliationRatio: 1,
  authorizationLeakage: 0,
  qdrantQueryP95Ms: 42,
  queryCount: 12,
  memberCount: 40,
  p95SampleCount: 12,
  environment: {
    nodeVersion: "v24.12.0",
    containerRuntime: "docker-27.1.1",
    qdrantServiceRef: "qdrant-v1-19-0",
    cpuModel: "epyc-9354",
    platform: "linux-x64",
  },
  measuredAt: "2030-01-01T00:00:00.000Z",
  ...overrides,
});

const catalogEntry = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  projectId,
  policyType: "retrieval-acceptance",
  policyRef: { entityId: "acceptance-policy", versionId: "v3" },
  approval,
  body: acceptancePolicy,
  ...overrides,
});

const buildCatalog = (entries: readonly unknown[]) =>
  DeploymentPolicyCatalogV1Schema.parse({
    schemaVersion: 1,
    catalogRef: { entityId: "policy-catalog", versionId: "v1" },
    purpose: "production",
    downstreamAuthorization: {
      policyRef: { entityId: "downstream-authorization", versionId: "1" },
      bindings: [
        { rootBranch: "workflow.start-run", downstreamBranches: ["agent-task.start-task"] },
      ],
    },
    entries,
  });

describe("策略 catalog", () => {
  it("下游分支清单必须版本化且拒绝重复及未知分支", () => {
    const catalog = buildCatalog([catalogEntry()]);
    const missing = { ...catalog };
    delete (missing as Partial<typeof catalog>).downstreamAuthorization;
    expect(DeploymentPolicyCatalogV1Schema.safeParse(missing).success).toBe(false);
    for (const bindings of [
      [catalog.downstreamAuthorization.bindings[0], catalog.downstreamAuthorization.bindings[0]],
      [
        {
          rootBranch: "workflow.start-run",
          downstreamBranches: ["agent-task.start-task", "agent-task.start-task"],
        },
      ],
      [{ rootBranch: "workflow.start-run", downstreamBranches: ["free-shell"] }],
    ]) {
      expect(
        DeploymentPolicyCatalogV1Schema.safeParse({
          ...catalog,
          downstreamAuthorization: { ...catalog.downstreamAuthorization, bindings },
        }).success,
      ).toBe(false);
    }
  });
  it("按精确 ref 解析，缺失、错版本与重复条目一律失败", () => {
    const reader = createDeploymentPolicyCatalogReaderV1(
      buildCatalog([
        catalogEntry(),
        catalogEntry({
          policyType: "retry",
          policyRef: { entityId: "retry-policy", versionId: "v1" },
          body: retryPolicy,
        }),
      ]),
    );
    const resolvers = createDeploymentPolicyResolversV1(reader);
    expect(
      resolvers.hybridRetrievalAcceptance({
        projectId,
        policyRef: { entityId: "acceptance-policy", versionId: "v3" },
      }).topK,
    ).toBe(5);
    expect(
      resolvers.retryPolicy({
        projectId,
        policyRef: { entityId: "retry-policy", versionId: "v1" },
      }).maxAttempts,
    ).toBe(3);

    // 错版本与不存在类型都不允许回退到其它条目。
    expect(() =>
      resolvers.hybridRetrievalAcceptance({
        projectId,
        policyRef: { entityId: "acceptance-policy", versionId: "v4" },
      }),
    ).toThrow(DeploymentPolicyError);
    expect(
      reader.tryResolve({
        projectId: "project-other",
        policyType: "retry",
        policyRef: { entityId: "retry-policy", versionId: "v1" },
      }),
    ).toBeUndefined();
    expect(reader.listProjectIds()).toEqual([projectId]);
  });

  it("同一工程同一类型出现重复条目即拒绝，不静默取其一", () => {
    expect(() =>
      createDeploymentPolicyCatalogReaderV1(buildCatalog([catalogEntry(), catalogEntry()])),
    ).toThrow(DeploymentPolicyError);
  });

  it("允许同一工程同一类型的不同精确版本，并冻结解析后的完整正文", () => {
    const reader = createDeploymentPolicyCatalogReaderV1(
      buildCatalog([
        catalogEntry(),
        catalogEntry({
          policyType: "retry",
          policyRef: { entityId: "retry-policy", versionId: "v1" },
          body: retryPolicy,
        }),
        catalogEntry({
          policyType: "retry",
          policyRef: { entityId: "retry-policy", versionId: "v2" },
          body: { ...retryPolicy, policyRef: { entityId: "retry-policy", versionId: "v2" } },
        }),
      ]),
    );

    expect(
      reader.resolve({
        projectId,
        policyType: "retry",
        policyRef: { entityId: "retry-policy", versionId: "v1" },
      }).maxAttempts,
    ).toBe(3);
    expect(
      reader.resolve({
        projectId,
        policyType: "retry",
        policyRef: { entityId: "retry-policy", versionId: "v2" },
      }).policyRef.versionId,
    ).toBe("v2");
    const body = reader.resolve({
      projectId,
      policyType: "retrieval-acceptance",
      policyRef: acceptancePolicy.acceptancePolicyRef,
    });
    expect(Object.isFrozen(body)).toBe(true);
    expect(Object.isFrozen(body.acceptancePolicyRef)).toBe(true);
    expect(() => {
      (body as { topK: number }).topK = 10;
    }).toThrow(TypeError);
  });

  it("校验自带工程和 ref，组合类型使用目录分配的组合身份", () => {
    const responsePolicy = {
      schemaVersion: "1",
      policyRef: { entityId: "response-policy", versionId: "v1" },
      projectId,
      bindings: [],
    };
    expect(() =>
      buildCatalog([
        catalogEntry({
          policyType: "response-generation",
          policyRef: { entityId: "response-policy", versionId: "v2" },
          body: responsePolicy,
        }),
      ]),
    ).toThrow();
    expect(() =>
      buildCatalog([
        catalogEntry({
          policyType: "response-generation",
          policyRef: responsePolicy.policyRef,
          body: { ...responsePolicy, projectId: "project-other" },
        }),
      ]),
    ).toThrow();

    const assessmentRuntime = {
      schemaVersion: "1",
      projectId,
      warningAggregationPolicyRef: { entityId: "warning-aggregation", versionId: "v1" },
      notificationPolicyRef: { entityId: "notification", versionId: "v1" },
      responseGenerationPolicyRef: { entityId: "response-generation", versionId: "v1" },
      responseValidationPolicyRef: { entityId: "response-validation", versionId: "v1" },
      responseAgentPolicyRef: { entityId: "response-agent", versionId: "v1" },
      calibrationAgentPolicyRef: { entityId: "calibration-agent", versionId: "v1" },
      retryPolicyRef: { entityId: "retry", versionId: "v1" },
      reviewPolicyRef: { entityId: "review", versionId: "v1" },
      modelDeploymentRef: { entityId: "model", versionId: "v1" },
      promptTemplateRef: { entityId: "prompt", versionId: "v1" },
    };
    const compositionRef = { entityId: "approved-assessment-runtime", versionId: "v4" };
    const riskCandidateBundle = {
      generation: {
        schemaVersion: "1",
        policyRef: { entityId: "generation", versionId: "v1" },
        policySetRef: {
          kind: "identification-policy-set",
          reference: { entityId: "set", versionId: "v1" },
        },
        outputSchemaRef: { entityId: "output-schema", versionId: "v1" },
        budgetPolicyRef: { entityId: "budget", versionId: "v1" },
        budget: {
          maxCandidates: 4,
          maxOutputBytes: 4096,
          maxTotalTokens: 1000,
          maxWallClockMs: 5000,
          maxRepairRounds: 1,
        },
      },
      validation: {
        schemaVersion: "1",
        policyRef: { entityId: "validation", versionId: "v1" },
        policySetRef: {
          kind: "identification-policy-set",
          reference: { entityId: "set", versionId: "v1" },
        },
        ruleValidationPolicyRef: { entityId: "rule-validation", versionId: "v1" },
        allowedMechanismTypes: [],
        requiredMechanismTypes: [],
        requiredRelationTypes: [],
        repairableReasonCodes: [...CANDIDATE_REPAIRABLE_REASON_CODES_V1],
      },
      merge: {
        schemaVersion: "1",
        policyRef: { entityId: "merge", versionId: "v1" },
        policySetRef: {
          kind: "identification-policy-set",
          reference: { entityId: "set", versionId: "v1" },
        },
        embeddingDeploymentRef: { entityId: "embedding", versionId: "v1" },
        embeddingBudgetPolicyRef: { entityId: "embedding-budget", versionId: "v1" },
        relatedNodeIds: [],
        riskEventCosineThreshold: 0.9,
        evidenceSetSimilarityThreshold: 0.8,
        weights: { processNode: 0.4, riskEvent: 0.35, evidence: 0.25 },
        groupThreshold: 0.8,
        maxGroupMembers: 4,
        memberOrder: "candidate-ref-ascending",
        tieBreak: "lexicographically-smallest-candidate-ref",
      },
      confidence: {
        schemaVersion: "1",
        policyRef: { entityId: "confidence", versionId: "v1" },
        policySetRef: {
          kind: "identification-policy-set",
          reference: { entityId: "set", versionId: "v1" },
        },
        weights: {
          modelConfidence: 0.4,
          ruleConsistency: 0.3,
          simulationConstraint: 0.1,
          multiSourceMerge: 0.2,
        },
        requiredBasis: ["model-confidence"],
        missingBasisBehavior: "block",
        roundingDecimals: 2,
      },
      forcedReview: {
        schemaVersion: "1",
        policyRef: { entityId: "forced-review", versionId: "v1" },
        policySetRef: {
          kind: "identification-policy-set",
          reference: { entityId: "set", versionId: "v1" },
        },
        autoAcceptanceThreshold: 0.9,
        forcedReviewReasonCodes: [],
        reviewPolicyRef: { entityId: "review", versionId: "v1" },
      },
    };
    const warningRuntime = {
      schemaVersion: "1",
      projectId,
      warningAggregationPolicy: {
        schemaVersion: "1",
        policyRef: { entityId: "warning-aggregation", versionId: "v1" },
        projectId,
        responseDirectionByTriggerType: {
          风险等级超过风险可接受阈值: "direction-risk",
          监测指标越限: "direction-monitoring",
          "趋势/加速度/异常评分越限": "direction-trend",
          多指标联合规则命中: "direction-joint",
        },
      },
      notificationPolicy: {
        schemaVersion: "1",
        policyRef: { entityId: "notification", versionId: "v1" },
        projectId,
        channel: "in-app",
        recipientActorIds: ["operator-01"],
      },
    };
    const assignedRefs = [
      {
        policyType: "risk-candidate",
        policyRef: { entityId: "approved-risk-candidate", versionId: "v2" },
        body: riskCandidateBundle,
      },
      {
        policyType: "warning-runtime",
        policyRef: { entityId: "approved-warning-runtime", versionId: "v3" },
        body: warningRuntime,
      },
    ] as const;
    const reader = createDeploymentPolicyCatalogReaderV1(
      buildCatalog([
        catalogEntry({
          policyType: "assessment-runtime",
          policyRef: compositionRef,
          body: assessmentRuntime,
        }),
        ...assignedRefs.map((entry) => catalogEntry(entry)),
      ]),
    );
    expect(
      reader.resolve({ projectId, policyType: "assessment-runtime", policyRef: compositionRef }),
    ).toEqual(assessmentRuntime);
    for (const entry of assignedRefs) {
      expect(
        reader.resolve({ projectId, policyType: entry.policyType, policyRef: entry.policyRef }),
      ).toEqual(entry.body);
      expect(() =>
        reader.resolve({
          projectId,
          policyType: entry.policyType,
          policyRef:
            entry.policyType === "risk-candidate"
              ? entry.body.generation.policyRef
              : entry.body.warningAggregationPolicy.policyRef,
        }),
      ).toThrow(DeploymentPolicyError);
    }
    expect(() =>
      reader.resolve({
        projectId,
        policyType: "assessment-runtime",
        policyRef: { entityId: "warning-aggregation", versionId: "v1" },
      }),
    ).toThrow(DeploymentPolicyError);
  });

  it("hybrid-retrieval 绑定运行时 Schema，和 retrieval-acceptance 分开校验", () => {
    expect(() =>
      buildCatalog([
        catalogEntry({
          policyType: "hybrid-retrieval",
          policyRef: hybridRetrievalPolicy.policyRef,
          body: acceptancePolicy,
        }),
      ]),
    ).toThrow();

    const reader = createDeploymentPolicyCatalogReaderV1(
      buildCatalog([
        catalogEntry({
          policyType: "hybrid-retrieval",
          policyRef: hybridRetrievalPolicy.policyRef,
          body: hybridRetrievalPolicy,
        }),
      ]),
    );
    expect(
      createDeploymentPolicyResolversV1(reader).hybridRetrievalPolicy({
        projectId,
        policyRef: hybridRetrievalPolicy.policyRef,
      }).topK,
    ).toBe(5);
    expect(() =>
      buildCatalog([
        catalogEntry({
          policyType: "hybrid-retrieval",
          policyRef: { entityId: "hybrid-policy", versionId: "v2" },
          body: hybridRetrievalPolicy,
        }),
      ]),
    ).toThrow();
  });

  it("calibration 按原 Schema 的 policyRef 精确匹配目录 ref", () => {
    const reader = createDeploymentPolicyCatalogReaderV1(
      buildCatalog([
        catalogEntry({
          policyType: "calibration",
          policyRef: calibrationPolicy.policyRef,
          body: calibrationPolicy,
        }),
      ]),
    );
    expect(
      createDeploymentPolicyResolversV1(reader).calibrationValidationPolicy({
        projectId,
        policyRef: calibrationPolicy.policyRef,
      }),
    ).toEqual(calibrationPolicy);
    expect(() =>
      buildCatalog([
        catalogEntry({
          policyType: "calibration",
          policyRef: { entityId: "calibration-policy", versionId: "v2" },
          body: calibrationPolicy,
        }),
      ]),
    ).toThrow();
  });

  it("要求显式目录 purpose", () => {
    expect(() =>
      DeploymentPolicyCatalogV1Schema.parse({
        schemaVersion: 1,
        catalogRef: { entityId: "policy-catalog", versionId: "v1" },
        entries: [catalogEntry()],
      }),
    ).toThrow();
    expect(
      DeploymentPolicyCatalogV1Schema.parse({
        schemaVersion: 1,
        catalogRef: { entityId: "policy-catalog", versionId: "v1" },
        purpose: "synthetic-acceptance",
        downstreamAuthorization: {
          policyRef: { entityId: "downstream-authorization", versionId: "1" },
          bindings: [
            { rootBranch: "workflow.start-run", downstreamBranches: ["agent-task.start-task"] },
          ],
        },
        entries: [catalogEntry()],
      }).purpose,
    ).toBe("synthetic-acceptance");
  });

  it("正文自带 ref 与登记 ref 不一致时拒绝入目录录", () => {
    expect(() =>
      buildCatalog([
        catalogEntry({
          policyRef: { entityId: "acceptance-policy", versionId: "v9" },
        }),
      ]),
    ).toThrow();
  });

  it("缺失策略使用稳定错误类别，不泄露正文", () => {
    const reader = createDeploymentPolicyCatalogReaderV1(buildCatalog([catalogEntry()]));
    try {
      reader.resolve({
        projectId,
        policyType: "retrieval-review",
        policyRef: { entityId: "retrieval-review-policy", versionId: "v1" },
      });
      expect.unreachable("缺失策略必须抛错");
    } catch (error) {
      expect((error as DeploymentPolicyError).code).toBe(DEPLOYMENT_POLICY_ERROR_V1.missing);
      expect(JSON.stringify(error)).not.toContain("acceptancePolicyRef");
    }
  });
});

describe("检索质量门禁", () => {
  it("复用 core 逐门判定，任一门槛失败即 overall=failed", async () => {
    const gate = createDeploymentRetrievalQualityGateV1({
      measure: async () => measured({ bm25RecallAt5: 0.1 }),
    });
    const report = await gate.evaluate({
      policy: acceptancePolicy,
      signal: new AbortController().signal,
    });
    expect(report.overall).toBe("failed");
    // 单路失败不得被融合分掩盖。
    expect(report.gates.find((item) => item.gateId === "bm25-recall-at-5")?.passed).toBe(false);
  });

  it("全部门槛通过时才 passed", async () => {
    const gate = createDeploymentRetrievalQualityGateV1({ measure: async () => measured() });
    const report = await gate.evaluate({
      policy: acceptancePolicy,
      signal: new AbortController().signal,
    });
    expect(report.overall).toBe("passed");
    expect(report.gates.every((item) => item.passed)).toBe(true);
  });

  it("缺证据或报告与策略不符时失败，不得以合成常量冒充", async () => {
    const missing = createDeploymentRetrievalQualityGateV1({ measure: async () => undefined });
    await expect(
      missing.evaluate({ policy: acceptancePolicy, signal: new AbortController().signal }),
    ).rejects.toThrow(DeploymentQualityGateError);

    // 测量来源若回报的是上一代数据集，不能用它充当本代证据。
    const stale = createDeploymentRetrievalQualityGateV1({
      measure: async () =>
        measured({}, { datasetRef: { entityId: "retrieval-dataset", versionId: "v1" } }),
    });
    try {
      await stale.evaluate({ policy: acceptancePolicy, signal: new AbortController().signal });
      expect.unreachable("陈旧测量必须被拒绝");
    } catch (error) {
      expect((error as DeploymentQualityGateError).code).toBe(
        DEPLOYMENT_QUALITY_GATE_ERROR_V1.datasetRefMismatch,
      );
    }

    const wrongPolicy = createDeploymentRetrievalQualityGateV1({
      measure: async () =>
        measured({}, { acceptancePolicyRef: { entityId: "acceptance-policy", versionId: "v1" } }),
    });
    try {
      await wrongPolicy.evaluate({
        policy: acceptancePolicy,
        signal: new AbortController().signal,
      });
      expect.unreachable("策略身份不符的测量必须被拒绝");
    } catch (error) {
      expect((error as DeploymentQualityGateError).code).toBe(
        DEPLOYMENT_QUALITY_GATE_ERROR_V1.policyRefMismatch,
      );
    }
  });

  it("授权泄漏超过门槛时不得 ready", async () => {
    const gate = createDeploymentRetrievalQualityGateV1({
      measure: async () => measured({ authorizationLeakage: 3 }),
    });
    const report = await gate.evaluate({
      policy: acceptancePolicy,
      signal: new AbortController().signal,
    });
    expect(report.overall).toBe("failed");
    expect(report.gates.find((item) => item.gateId === "authorization-leakage")?.passed).toBe(
      false,
    );
  });
});

describe("工程枚举与空间配对窄读", () => {
  const project = (projectIdValue: string): DeploymentProjectSummaryV1 => ({
    projectId: projectIdValue,
    revision: 1,
    spatialScopeRefs: [{ entityId: `scope-${projectIdValue}`, versionId: "v1" }],
    sourceRegistrationRefs: [{ entityId: `source-${projectIdValue}`, versionId: "v1" }],
  });

  it("有界分页并只在确有后续时给出游标", async () => {
    const rows = ["p1", "p2", "p3"].map(project);
    // 单页装不满时不应发游标，否则调用方会翻页空集。
    const single = createDeploymentProjectListerV1({
      listProjects: async ({ afterProjectId }) =>
        rows.filter((row) => afterProjectId === undefined || row.projectId > afterProjectId),
    });
    const first = await single.list({ limit: 10 });
    expect(first.projects.map((item) => item.projectId)).toEqual(["p1", "p2", "p3"]);
    expect(first.nextCursor).toBeUndefined();

    // 满页且确有后续时发游标，指向上页最后一条。
    const paged = createDeploymentProjectListerV1({
      listProjects: async ({ afterProjectId, limit }) =>
        rows
          .filter((row) => afterProjectId === undefined || row.projectId > afterProjectId)
          .slice(0, limit),
    });
    const second = await paged.list({ limit: 2 });
    expect(second.projects.map((item) => item.projectId)).toEqual(["p1", "p2"]);
    expect(second.nextCursor).toEqual({ projectId: "p2" });

    const third = await paged.list({ limit: 2, cursor: second.nextCursor });
    expect(third.projects.map((item) => item.projectId)).toEqual(["p3"]);
    expect(third.nextCursor).toBeUndefined();
  });

  it("limit 被夹到固定上限，避免宿主一次拉全量", async () => {
    let observed = 0;
    const lister = createDeploymentProjectListerV1({
      listProjects: async ({ limit }) => {
        observed = limit;
        return [];
      },
    });
    await lister.list({ limit: 10_000 });
    expect(observed).toBe(DEPLOYMENT_PROJECT_PAGE_MAX_V1);
  });

  it.each([200, 201])("上限满页仍能区分后续工程：%i 条", async (count) => {
    const rows = Array.from({ length: count }, (_, index) =>
      project(`p${String(index).padStart(3, "0")}`),
    );
    const lister = createDeploymentProjectListerV1({
      listProjects: async ({ afterProjectId, limit }) => {
        expect(limit).toBeLessThanOrEqual(DEPLOYMENT_PROJECT_PAGE_MAX_V1);
        return rows
          .filter((row) => afterProjectId === undefined || row.projectId > afterProjectId)
          .slice(0, limit);
      },
    });
    const first = await lister.list({ limit: DEPLOYMENT_PROJECT_PAGE_MAX_V1 });
    expect(first.projects).toHaveLength(200);
    if (count === 200) {
      expect(first.nextCursor).toBeUndefined();
    } else {
      expect(first.nextCursor).toEqual({ projectId: "p199" });
      const second = await lister.list({ limit: 200, cursor: first.nextCursor });
      expect(second.projects.map(({ projectId }) => projectId)).toEqual(["p200"]);
      expect(second.nextCursor).toBeUndefined();
    }
  });

  const authorization = () =>
    AuthorizationContextV1Schema.parse({
      schemaVersion: "1",
      authorizationContextRef: {
        kind: "authorization-context",
        reference: { entityId: "auth-spatial", versionId: "v1" },
      },
      actorId: "actor-spatial",
      projectId,
      grantedCapabilities: ["risk-assessment.read"],
      spatialScopeRefs: [
        { kind: "spatial-scope", reference: { entityId: "scope-a", versionId: "v1" } },
      ],
      sourceAccessGrantRefs: [
        { kind: "source-access-grant", reference: { entityId: "grant-a", versionId: "v1" } },
      ],
      authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      decidedAt: "2030-01-01T00:00:00.000Z",
      invocation: { kind: "human" },
    }) as AuthorizationContextV1;

  it("空间配对精确命中才返回，无匹配、多匹配与无权均 undefined", async () => {
    const scopes = [
      { entityId: "scope-a", versionId: "v1" },
      { entityId: "scope-b", versionId: "v1" },
    ];
    const reader = createDeploymentSpatialPairingReaderV1({
      listRecordScopes: async () => scopes,
    });
    expect(
      await reader.readPairing({
        projectId,
        riskRecordId: "risk-1",
        requestedPairingRef: { entityId: "scope-b", versionId: "v1" },
        authorization: authorization(),
      }),
    ).toEqual({ entityId: "scope-b", versionId: "v1" });

    // 异空间不借用其它空间。
    expect(
      await reader.readPairing({
        projectId,
        riskRecordId: "risk-1",
        requestedPairingRef: { entityId: "scope-c", versionId: "v1" },
        authorization: authorization(),
      }),
    ).toBeUndefined();

    // 重复登记视为异常，不猜测。
    const duplicated = createDeploymentSpatialPairingReaderV1({
      listRecordScopes: async () => [scopes[0]!, scopes[0]!],
    });
    expect(
      await duplicated.readPairing({
        projectId,
        riskRecordId: "risk-1",
        requestedPairingRef: { entityId: "scope-a", versionId: "v1" },
        authorization: authorization(),
      }),
    ).toBeUndefined();

    // 无权时所属 adapter 返回 undefined。
    const denied = createDeploymentSpatialPairingReaderV1({
      listRecordScopes: async () => undefined,
    });
    expect(
      await denied.readPairing({
        projectId,
        riskRecordId: "risk-1",
        requestedPairingRef: { entityId: "scope-a", versionId: "v1" },
        authorization: authorization(),
      }),
    ).toBeUndefined();
  });
});

// ----------------------------------------------------- D-20 功能验收合成输入

const loadAcceptanceFixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../references/acceptance/synthetic-v1/${name}`, import.meta.url),
      "utf8",
    ),
  ) as unknown;

const siteContextPack = DeploymentSyntheticSiteContextPackV1Schema.parse(
  loadAcceptanceFixture("site-contexts.json"),
);
const retrievalDataset = DeploymentRetrievalDatasetV1Schema.parse(
  loadAcceptanceFixture("retrieval-dataset.json"),
);

describe("功能验收合成输入夹具", () => {
  it("现场包覆盖五工序的资源齐备、资源不足与禁忌约束，且身份与工程一致", () => {
    expect(siteContextPack.projectId).toBe("synthetic-station-tunnel-project");
    expect(siteContextPack.sampleNotice).toBe("合成样本、待甲方复核");
    expect(siteContextPack.contexts).toHaveLength(15);

    const refs = siteContextPack.contexts.map((entry) => entry.siteContextRef.entityId);
    expect(new Set(refs).size).toBe(refs.length);
    for (const entry of siteContextPack.contexts) {
      expect(entry.projectId, entry.siteContextRef.entityId).toBe(siteContextPack.projectId);
    }

    // 五工序 × 三种现场条件各一条，且每条都有真实工序证据。
    for (const node of ["node-01", "node-02", "node-03", "node-04", "node-05"]) {
      const forNode = siteContextPack.contexts.filter((entry) =>
        entry.siteContextRef.entityId.includes(node),
      );
      expect(
        forNode.map((entry) => entry.siteContextRef.entityId),
        node,
      ).toEqual(
        ["resourced", "understaffed", "taboo"].map(
          (condition) => `site-context-${node}-${condition}`,
        ),
      );
      for (const entry of forNode) {
        expect(entry.evidenceReferences.length, entry.siteContextRef.entityId).toBeGreaterThan(0);
        expect(
          entry.evidenceReferences[0]?.locator.sourceSegmentId,
          entry.siteContextRef.entityId,
        ).toMatch(/^SYN-KB-PROCESS-0[1-5]$/u);
      }
    }
  });

  it("检索数据集六类机理各一查询，来源分类与 grade 直接落在 1-3", () => {
    expect(retrievalDataset.syntheticSample).toBe(true);
    expect(retrievalDataset.sampleNotice).toBe("合成样本、待甲方复核");
    expect(retrievalDataset.queries).toHaveLength(6);

    const queryIds = retrievalDataset.queries.map((query) => query.queryId);
    expect(new Set(queryIds).size).toBe(queryIds.length);
    const mechanismEntries = new Set(
      retrievalDataset.queries.flatMap((query) =>
        query.relevance
          .filter((entry) => entry.sourceKind === "risk-mechanism")
          .map((entry) => entry.sourceEntryId),
      ),
    );
    expect(mechanismEntries.size).toBe(6);

    for (const query of retrievalDataset.queries) {
      expect(Buffer.byteLength(query.queryText, "utf8"), query.queryId).toBeLessThanOrEqual(
        DEPLOYMENT_RETRIEVAL_QUERY_TEXT_MAX_BYTES_V1,
      );
      const identities = query.relevance.map(
        (entry) => `${entry.sourceKind}|${entry.sourceEntryId}`,
      );
      expect(new Set(identities).size, query.queryId).toBe(identities.length);
      for (const entry of query.relevance) {
        expect(entry.grade, `${query.queryId}->${entry.sourceEntryId}`).toBeGreaterThanOrEqual(1);
        expect(entry.grade, `${query.queryId}->${entry.sourceEntryId}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it("重复身份、异工程与缺合成 notice 的输入一律拒绝", () => {
    const first = siteContextPack.contexts[0]!;
    const rejects = (
      schema: { safeParse: (input: unknown) => { success: boolean } },
      input: unknown,
    ) => schema.safeParse(input).success;

    expect(
      rejects(DeploymentSyntheticSiteContextPackV1Schema, {
        ...siteContextPack,
        contexts: [first, first],
      }),
    ).toBe(false);
    expect(
      rejects(DeploymentSyntheticSiteContextPackV1Schema, {
        ...siteContextPack,
        contexts: [{ ...first, projectId: "other-project" }],
      }),
    ).toBe(false);

    const query = retrievalDataset.queries[0]!;
    expect(
      rejects(DeploymentRetrievalDatasetV1Schema, { ...retrievalDataset, queries: [query, query] }),
    ).toBe(false);
    // 合成数据集缺待复核 notice 时不得通过。
    const { sampleNotice: _omitted, ...withoutNotice } = retrievalDataset;
    void _omitted;
    expect(rejects(DeploymentRetrievalDatasetV1Schema, withoutNotice)).toBe(false);

    // 单条 relevance 身份重复同样拒绝。
    expect(
      rejects(DeploymentRetrievalDatasetV1Schema, {
        ...retrievalDataset,
        queries: [{ ...query, relevance: [query.relevance[0], query.relevance[0]] }],
      }),
    ).toBe(false);
  });
});

describe("现场上下文精确窄读", () => {
  const fixtureContext = siteContextPack.contexts[0]!;
  const fixtureRef = fixtureContext.siteContextRef;
  const requestedAt = "2026-03-10T00:00:00.000Z";

  const authorizationFor = (
    scope: { entityId: string; versionId: string } = {
      entityId: "spatial-scope-synthetic-v1",
      versionId: "1",
    },
  ): AuthorizationContextV1 =>
    AuthorizationContextV1Schema.parse({
      schemaVersion: "1",
      authorizationContextRef: {
        kind: "authorization-context",
        reference: { entityId: "auth-site", versionId: "v1" },
      },
      actorId: "operator-site",
      projectId: "synthetic-station-tunnel-project",
      grantedCapabilities: ["warning-response.recommend"],
      spatialScopeRefs: [{ kind: "spatial-scope", reference: scope }],
      sourceAccessGrantRefs: [
        { kind: "source-access-grant", reference: { entityId: "grant-site", versionId: "v1" } },
      ],
      authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      decidedAt: "2026-03-09T00:00:00.000Z",
      invocation: { kind: "human" },
    }) as AuthorizationContextV1;

  const storeOver = (
    body: unknown,
    verified?: Promise<never>,
  ): { store: ArtifactStoreV1; openCount: () => number } => {
    let opens = 0;
    const store: ArtifactStoreV1 = {
      put: async () => {
        throw new Error("not used");
      },
      open: async () => {
        opens += 1;
        const bytes = new TextEncoder().encode(JSON.stringify(body));
        const handle = {
          manifest: { schemaVersion: "1" },
          content: (async function* () {
            yield bytes;
          })(),
          verified: verified ?? Promise.resolve({ schemaVersion: "1" }),
        } as unknown as ArtifactReadHandleV1;
        return handle;
      },
    };
    return { store, openCount: () => opens };
  };

  const readerWith = (
    body: unknown,
    verified?: Promise<never>,
    bindings: readonly {
      projectId: string;
      siteContextRef: { entityId: string; versionId: string };
      artifactRef: { entityId: string; versionId: string };
    }[] = [
      {
        projectId: siteContextPack.projectId,
        siteContextRef: fixtureRef,
        artifactRef: { entityId: "artifact-site-context", versionId: "1" },
      },
    ],
  ) => {
    const tracked = storeOver(body, verified);
    return {
      read: createDeploymentSiteContextReaderV1({ artifactStore: tracked.store, bindings }).read,
      openCount: tracked.openCount,
    };
  };

  it("精确绑定读取返回原 Schema 解析的现场上下文", async () => {
    const { read, openCount } = readerWith(fixtureContext);
    await expect(
      read({
        requestId: "req-site-ok",
        requestedAt,
        authorization: authorizationFor(),
        siteContextRef: fixtureRef,
      }),
    ).resolves.toMatchObject({
      siteContextRef: fixtureRef,
      processStatus: fixtureContext.processStatus,
    });
    expect(openCount()).toBe(1);
  });

  it("未登记的精确 ref 不触发 open", async () => {
    const { read, openCount } = readerWith(fixtureContext);
    await expect(
      read({
        requestId: "req-site-unknown",
        requestedAt,
        authorization: authorizationFor(),
        siteContextRef: { entityId: "site-context-not-provisioned", versionId: "1" },
      }),
    ).resolves.toBeUndefined();
    expect(openCount()).toBe(0);
  });

  it("异空间与未来观测时间返回 undefined", async () => {
    const wrongScope = readerWith(fixtureContext);
    await expect(
      wrongScope.read({
        requestId: "req-site-scope",
        requestedAt,
        authorization: authorizationFor({ entityId: "spatial-scope-other", versionId: "1" }),
        siteContextRef: fixtureRef,
      }),
    ).resolves.toBeUndefined();

    // 正文观测时间晚于本次请求时间即不接受，不做时间外推。
    const future = readerWith({
      ...fixtureContext,
      observedAt: "2026-04-01T00:00:00.000Z",
    });
    await expect(
      future.read({
        requestId: "req-site-future",
        requestedAt,
        authorization: authorizationFor(),
        siteContextRef: fixtureRef,
      }),
    ).resolves.toBeUndefined();
  });

  it("C04 verified 拒绝向上传播，不降级为未验证正文", async () => {
    const failing = readerWith(
      fixtureContext,
      Promise.reject(new Error("artifact verification failed")) as Promise<never>,
    );
    await expect(
      failing.read({
        requestId: "req-site-unverified",
        requestedAt,
        authorization: authorizationFor(),
        siteContextRef: fixtureRef,
      }),
    ).rejects.toThrow("artifact verification failed");
  });

  it("超过 1 MiB 的正文按有界读取拒绝", async () => {
    const oversized = readerWith({
      ...fixtureContext,
      availableResources: Array.from({ length: 120_000 }, (_unused, index) => `resource-${index}`),
    });
    await expect(
      oversized.read({
        requestId: "req-site-oversized",
        requestedAt,
        authorization: authorizationFor(),
        siteContextRef: fixtureRef,
      }),
    ).rejects.toThrow();
  });
});
