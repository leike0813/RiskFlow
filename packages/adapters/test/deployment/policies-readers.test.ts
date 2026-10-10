import { describe, expect, it } from "vitest";

import {
  AuthorizationContextV1Schema,
  type AuthorizationContextV1,
} from "@riskflow/contracts/ports";
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
  createDeploymentSpatialPairingReaderV1,
  type DeploymentProjectSummaryV1,
} from "../../src/deployment/readers.js";

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
    entries,
  });

describe("策略 catalog", () => {
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
