import { describe, expect, it, vi } from "vitest";

import {
  REQUIRED_API_PORT_METHODS_V1,
  REQUIRED_API_PROVIDERS_V1,
  createDeploymentApiPortsV1,
} from "./composition/api-ports.mjs";
import { ReportExportPolicyV1Schema } from "../../packages/core/dist/workflow/index.js";
import { ModuleErrorV1Schema } from "../../packages/contracts/dist/ports/index.js";

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
      ...stub([
        "verify",
        "authorize",
        "authorizeBusinessAction",
        "readCurrentSpatialScopeRef",
        "workspaceVisibility",
      ]),
      systemAdministration: stub(["read", "execute"]),
      projectWorkspaceAccess: stub(["read", "execute"]),
      projectAccessPresentation: stub(["read"]),
    },
    artifactStore: stub(["put", "open"]),
    contextSource: stub([
      "apply",
      "freeze",
      "read",
      "resolveReadQuery",
      "reviseContext",
      "readProjectRevision",
      "readCurrentProjectRevision",
      "readSpatialRevision",
      "readCurrentSpatialRevision",
      "readSourceVersion",
      "readSegmentSetSummary",
    ]),
    documentConverter: stub(["listBySourceVersion", "readRecordByRef", "readFailureSummary"]),
    dataCleaningStore: stub([
      "listResultsForSubject",
      "listPreparationsForSubject",
      "readResultExclusions",
    ]),
    monitoringStore: stub([
      "resolveSnapshotQuery",
      "listBatchesBySeries",
      "listSnapshotsBySeries",
      "readCurrentSeriesCatalogItem",
      "readSeriesScopeRef",
    ]),
    knowledgeModeling: stub(["govern", "resolve", "retrieve"]),
    applicableRuleSetAssembly: stub(["assemble"]),
    riskIdentification: stub(["plan", "analyze", "finalize"]),
    riskIdentificationRead: stub(["read", "readDashboard"]),
    riskAssessment: stub(["prepare", "evaluate"]),
    riskAssessmentRead: stub(["read", "readDashboard"]),
    workflow: stub(["startRun", "resumeRun", "cancelRun"]),
    humanDecisionFeedback: stub(["record"]),
    reviewAudit: stub(["requestReview", "decideReview", "trace"]),
    agentTask: stub(["startTask", "resumeTask", "cancelTask", "confirmCommand"]),
    agentTaskRead: stub(["read"]),
    warningLifecycle: stub(["open", "acknowledge", "read", "readDashboard"]),
    recommendation: stub(["measureCandidates", "createCandidate", "validateAndRecord"]),
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
    const options = providers();
    const query = { kind: "measure-candidates" };
    const measures = { kind: "succeeded", result: { knowledgeQueryResultRef: "exact-query" } };
    options.recommendation.measureCandidates = vi.fn(() => measures);
    options.knowledgeModeling.retrieve = vi.fn(() => "knowledge-result");
    const ports = createDeploymentApiPortsV1(options);
    for (const [portKey, methods] of Object.entries(REQUIRED_API_PORT_METHODS_V1)) {
      expect(ports[portKey], `缺少端口 ${portKey}`).toBeDefined();
      for (const method of methods) {
        expect(typeof ports[portKey][method], `端口 ${portKey} 缺方法 ${method}`).toBe("function");
      }
    }
    expect(ports.knowledgeModeling.retrieve(query)).toBe(measures);
    expect(options.recommendation.measureCandidates).toHaveBeenCalledWith(query);
    for (const kind of ["hybrid-evidence", "relationship-context"])
      expect(ports.knowledgeModeling.retrieve({ kind })).toBe("knowledge-result");
    expect(options.knowledgeModeling.retrieve).toHaveBeenCalledTimes(2);
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
          readDashboard: () => undefined,
        },
        recommendation: {
          measureCandidates: () => undefined,
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

  it("入口能力读面取自同一真实 C06 适配器，缺失时拒绝装配而不是空能力", () => {
    const read = vi.fn(async () => ({
      schemaVersion: "1",
      projectId: "project-a",
      capabilities: [],
      authorizationPolicyRef: { entityId: "access-policy", versionId: "v2" },
    }));
    const access = {
      ...providers().access,
      systemAdministration: stub(["read", "execute"]),
      projectWorkspaceAccess: stub(["read", "execute"]),
      projectAccessPresentation: { read },
    };
    // 装配层不包一层空实现：路由拿到的是真实 C06 端口本身。
    expect(() =>
      createDeploymentApiPortsV1(
        providers({ access: { ...access, projectAccessPresentation: undefined } }),
      ),
    ).toThrow(/projectAccessPresentation/);
  });

  it("仪表盘公共读面组合六来源的所属窄读，缺来源实现即拒绝装配", () => {
    const options = providers();
    // 组合层只调用所属 Adapter 的窄读方法：六个窄读缺任一即无法完成装配。
    for (const [provider, method] of [
      ["riskIdentificationRead", "readDashboard"],
      ["riskAssessmentRead", "readDashboard"],
      ["warningLifecycle", "readDashboard"],
    ]) {
      expect(() =>
        createDeploymentApiPortsV1(
          providers({ [provider]: { ...options[provider], [method]: undefined } }),
        ),
      ).toThrow(new RegExp(`${provider}\\.${method}`));
    }
    // 装配后的仪表盘服务确实读六来源，而不是回落成目录遍历或空统计。
    const calls = [];
    const denied = ModuleErrorV1Schema.parse({
      code: "AUTHORIZATION_DENIED",
      category: "authorization",
      retryable: false,
      requiredCapability: "projection.query",
      authorizationPolicyRef: { entityId: "access-policy", versionId: "v3" },
      stageCode: "risk-dashboard.source-authorization",
      occurredAt: "2026-10-19T00:00:00.000Z",
      causalRunId: "dashboard-1",
    });
    const tracking = (name) => ({
      ...stub(["read", "readDashboard"]),
      readDashboard: async () => {
        calls.push(name);
        return { kind: "failed", error: denied };
      },
    });
    const tracked = createDeploymentApiPortsV1(
      providers({
        // 来源授权由同一 C06 业务动作判定签发；组合层不自己判定。
        access: {
          ...providers().access,
          systemAdministration: stub(["read", "execute"]),
          projectWorkspaceAccess: stub(["read", "execute"]),
          projectAccessPresentation: stub(["read"]),
          authorizeBusinessAction: async (input) => ({
            context: {
              schemaVersion: "1",
              authorizationContextRef: {
                kind: "authorization-context",
                reference: { entityId: "auth-1", versionId: "1" },
              },
              actorId: "actor-1",
              projectId: "project-a",
              grantedCapabilities: [input.capability],
              spatialScopeRefs: [],
              sourceAccessGrantRefs: [],
              authorizationPolicyRef: { entityId: "access-policy", versionId: "v3" },
              decidedAt: "2026-10-19T00:00:00.000Z",
              invocation: { kind: "human" },
            },
            contextRef: {
              kind: "authorization-context",
              reference: { entityId: "auth-1", versionId: "1" },
            },
            redacted: false,
          }),
        },
        riskIdentificationRead: tracking("riskRecords"),
        riskAssessmentRead: tracking("assessments"),
        warningLifecycle: {
          ...stub(["open", "acknowledge", "read"]),
          readDashboard: async () => {
            calls.push("warnings");
            return { kind: "failed", error: denied };
          },
        },
      }),
    );
    return tracked.riskDashboardRead
      .read({
        queryId: "dashboard-1",
        projectId: "project-a",
        actorId: "actor-1",
        requestedAt: "2026-10-19T00:00:00.000Z",
        kind: "read",
        payload: {},
        authorization: {
          schemaVersion: "1",
          authorizationContextRef: {
            kind: "authorization-context",
            reference: { entityId: "auth-1", versionId: "1" },
          },
          actorId: "actor-1",
          projectId: "project-a",
          grantedCapabilities: ["projection.query"],
          spatialScopeRefs: [],
          sourceAccessGrantRefs: [],
          authorizationPolicyRef: { entityId: "access-policy", versionId: "v3" },
          decidedAt: "2026-10-19T00:00:00.000Z",
          invocation: { kind: "human" },
        },
      })
      .then((result) => {
        expect(result.kind).toBe("succeeded");
        expect(calls).toEqual(["riskRecords", "assessments", "warnings"]);
      });
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
