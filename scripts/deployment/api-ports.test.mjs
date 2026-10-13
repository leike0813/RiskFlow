import { describe, expect, it, vi } from "vitest";

import {
  REQUIRED_API_PORT_METHODS_V1,
  REQUIRED_API_PROVIDERS_V1,
  createDeploymentApiPortsV1,
} from "./composition/api-ports.mjs";
import { ReportExportPolicyV1Schema } from "../../packages/core/dist/workflow/index.js";

/**
 * 只验证装配契约：provider 方法存在、缺项拒绝、类型分派。
 * 这里不接数据库、不造领域结果，也不复制测试 SQL——真实终态由功能验收承担。
 */
const stub = (methods) => Object.fromEntries(methods.map((method) => [method, () => undefined]));
const reportPolicyRef = { entityId: "report-export", versionId: "v1" };
const reportPolicy = ReportExportPolicyV1Schema.parse({
  schemaVersion: "1",
  policyRef: reportPolicyRef,
  format: "json",
  queryTypes: ["risk-overview"],
  sections: ["run-summary"],
  maxPages: 1,
  maxItems: 1,
  maxBytes: 1024,
});

const providers = (overrides = {}) => {
  const base = {
    db: {},
    access: {
      ...stub(["verify", "authorize"]),
      systemAdministration: stub(["read", "execute"]),
    },
    artifactStore: stub(["put", "open"]),
    contextSource: stub(["apply", "freeze", "read", "resolveReadQuery"]),
    monitoringStore: stub(["resolveSnapshotQuery"]),
    knowledgeModeling: stub(["govern", "resolve", "retrieve"]),
    riskIdentification: stub(["plan", "analyze", "finalize"]),
    riskIdentificationRead: stub(["read"]),
    riskAssessment: stub(["prepare", "evaluate"]),
    riskAssessmentRead: stub(["read"]),
    workflow: stub(["startRun", "resumeRun", "cancelRun"]),
    humanDecisionFeedback: stub(["record"]),
    reviewAudit: stub(["requestReview", "decideReview", "trace"]),
    agentTask: stub(["startTask", "resumeTask", "cancelTask", "confirmCommand"]),
    agentTaskRead: stub(["read"]),
    warningLifecycle: stub(["open", "acknowledge", "read"]),
    recommendation: stub(["createCandidate", "validateAndRecord"]),
    responseLifecycle: stub(["calculateDeviation"]),
    calibration: stub(["createSuggestion", "createGovernanceDraft", "recordReviewOutcome"]),
    transactionUnit: stub(["execute"]),
    workflowRegistrationStore: stub([
      "assertCurrentRunVersion",
      "registerRow",
      "readRow",
      "listRunRows",
      "readLatestRunState",
      "registerLink",
      "listRunLinks",
      "registerQuery",
      "readQuery",
    ]),
    workflowBodies: stub(["readBody"]),
    riskRecordTrace: stub(["readBatch"]),
    resultReadAuthorization: stub(["issueResultReadAuthorization"]),
    runEvents: stub(["subscribe", "subscribeWithSourceAuthorization"]),
    projectPolicies: {
      reader: { listProjectIds: () => ["project-a"] },
      resolveProject: () => ({
        binding: { projectId: "project-a", policyRefs: { "report-export": reportPolicyRef } },
        policies: { "report-export": reportPolicy },
      }),
    },
    systemOperations: {
      probe: async () => ({ status: "available" }),
      readModelVersions: async () => [
        {
          taskType: "response-recommendation",
          deploymentRef: { entityId: "deployment", versionId: "v1" },
          modelVersionRef: { entityId: "model", versionId: "v1" },
          promptTemplateRef: { entityId: "prompt", versionId: "v1" },
          toolPolicyRef: { entityId: "tools", versionId: "v1" },
          budgetPolicyRef: { entityId: "budget", versionId: "v1" },
          supportedTriggerModes: ["embedded"],
        },
      ],
    },
    retrievalRelationshipResults: stub(["readRelationshipResult"]),
    hybridResultReader: stub(["readOfficial"]),
  };
  return { ...base, ...overrides };
};

describe("生产 API 全端口装配契约", () => {
  it("返回的 ApiPortsV1 覆盖全部声明端口，且逐个具备必需的公开方法", () => {
    const ports = createDeploymentApiPortsV1(providers());
    for (const [portKey, methods] of Object.entries(REQUIRED_API_PORT_METHODS_V1)) {
      expect(ports[portKey], `缺少端口 ${portKey}`).toBeDefined();
      for (const method of methods) {
        expect(typeof ports[portKey][method], `端口 ${portKey} 缺方法 ${method}`).toBe("function");
      }
    }
  });

  it("缺任一必需 provider 即拒绝装配，不返回半装配端口", () => {
    for (const name of Object.keys(REQUIRED_API_PROVIDERS_V1)) {
      expect(
        () => createDeploymentApiPortsV1(providers({ [name]: undefined })),
        `缺少 ${name} 时应拒绝装配`,
      ).toThrow(TypeError);
    }
  });

  it("provider 存在但缺任一必需公开方法同样拒绝装配", () => {
    expect(() =>
      createDeploymentApiPortsV1(providers({ workflow: { startRun: () => {} } })),
    ).toThrow(/workflow\.(resumeRun|cancelRun)/);
    expect(() =>
      createDeploymentApiPortsV1(
        providers({ warningLifecycle: { open: () => {}, read: () => {} } }),
      ),
    ).toThrow(/warningLifecycle\.acknowledge/);
  });

  it("warningResponse 按原三分支分派到真实领域适配器，未登记分支失败关闭", () => {
    const calls = [];
    const ports = createDeploymentApiPortsV1(
      providers({
        warningLifecycle: {
          open: (command) => (calls.push(["warning.open", command.kind]), "opened"),
          acknowledge: (command) => (calls.push(["warning.acknowledge", command.kind]), "acked"),
          read: () => undefined,
        },
        recommendation: {
          createCandidate: (command) => (
            calls.push(["recommendation.createCandidate", command.kind]),
            "candidate"
          ),
          validateAndRecord: (command) => (
            calls.push(["recommendation.validateAndRecord", command.kind]),
            "recorded"
          ),
        },
        responseLifecycle: {
          calculateDeviation: (command) => (
            calls.push(["responseLifecycle.calculateDeviation", command.kind]),
            "deviation"
          ),
        },
        calibration: {
          createSuggestion: (command) => (
            calls.push(["calibration.createSuggestion", command.kind]),
            "suggestion"
          ),
          createGovernanceDraft: () => undefined,
          recordReviewOutcome: () => undefined,
        },
      }),
    );

    expect(ports.warningResponse.open({ kind: "open" })).toBe("opened");
    expect(ports.warningResponse.recommend({ kind: "create-candidate" })).toBe("candidate");
    expect(ports.warningResponse.recommend({ kind: "validate-and-record" })).toBe("recorded");
    expect(ports.warningResponse.record({ kind: "acknowledge" })).toBe("acked");
    expect(ports.warningResponse.record({ kind: "calculate-deviation" })).toBe("deviation");
    expect(ports.warningResponse.record({ kind: "create-calibration-suggestion" })).toBe(
      "suggestion",
    );
    expect(calls.map(([name]) => name)).toEqual([
      "warning.open",
      "recommendation.createCandidate",
      "recommendation.validateAndRecord",
      "warning.acknowledge",
      "responseLifecycle.calculateDeviation",
      "calibration.createSuggestion",
    ]);

    // 未登记的分支不得落到任一领域适配器，必须失败关闭而不是猜测归属。
    expect(() => ports.warningResponse.record({ kind: "record-execution" })).toThrow(TypeError);
    expect(() => ports.warningResponse.recommend({ kind: "unknown" })).toThrow(TypeError);
  });

  it("engineeringData 就是注入的同一 context-source registry，systemAdministration 取自 access", () => {
    const contextSource = stub(["apply", "freeze", "read", "resolveReadQuery"]);
    const access = {
      ...stub(["verify", "authorize"]),
      systemAdministration: stub(["read", "execute"]),
    };
    const ports = createDeploymentApiPortsV1(providers({ contextSource, access }));
    expect(ports.engineeringData).toBe(contextSource);
    expect(ports.systemAdministration).toBe(access.systemAdministration);
  });

  it("组装真实公开投影工厂与完整质量两阶段端口，并保留 API 运维结果 Schema", async () => {
    const subscription = { kind: "succeeded", result: { eventRefs: [] } };
    const runEvents = {
      subscribe: vi.fn(async () => subscription),
      subscribeWithSourceAuthorization: vi.fn(async () => subscription),
    };
    const options = providers({ runEvents });
    const ports = createDeploymentApiPortsV1(options);

    expect(typeof ports.projection.query).toBe("function");
    expect(typeof ports.projectionResultRead.readPage).toBe("function");
    expect(typeof ports.projectionReportRead.read).toBe("function");
    expect(typeof ports.qualityProjectionQuery.candidateSourceVersionRefs).toBe("function");
    expect(typeof ports.qualityProjectionQuery.queryWithSourceGrants).toBe("function");
    expect(typeof ports.systemOperationsRead.read).toBe("function");
    const request = { kind: "subscribe" };
    await expect(ports.projection.subscribe(request)).resolves.toBe(subscription);
    expect(runEvents.subscribe).toHaveBeenCalledWith(request);
    const authorizeEvent = async () => undefined;
    await expect(
      ports.runEventSubscription.subscribeWithSourceAuthorization(request, authorizeEvent),
    ).resolves.toBe(subscription);
    expect(runEvents.subscribeWithSourceAuthorization).toHaveBeenCalledWith(
      request,
      authorizeEvent,
    );

    const result = await ports.systemOperationsRead.read({
      schemaVersion: "1",
      queryId: "operations-query",
      requestedAt: "2026-10-11T00:00:00.000Z",
      payload: { kind: "health" },
    });
    expect(result.kind).toBe("succeeded");
    expect(result.result.kind).toBe("health");
    expect(result.result.components).toHaveLength(4);

    const versions = await ports.systemOperationsRead.read({
      schemaVersion: "1",
      queryId: "model-versions-query",
      requestedAt: "2026-10-11T00:00:00.000Z",
      payload: { kind: "model-versions" },
    });
    expect(versions.result.kind).toBe("model-versions");
    expect(versions.result.items).toHaveLength(1);
  });
});
