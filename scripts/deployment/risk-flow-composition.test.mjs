import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeploymentAuthorizationError } from "../../packages/adapters/dist/auth/index.js";

const graphCompositionFactory = vi.hoisted(() => ({ create: vi.fn() }));
const humanDecisionFeedbackFactory = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("../../apps/worker/dist/risk-flow/index.js", () => ({
  createRiskFlowGraphComposition: graphCompositionFactory.create,
}));
vi.mock("../../packages/adapters/dist/human-decision-feedback/index.js", () => ({
  createPostgresHumanDecisionFeedbackAdapter: humanDecisionFeedbackFactory.create,
}));

import {
  createDeploymentHumanDecisionFeedbackV1,
  createDeploymentRiskFlowV1,
  createDeploymentRiskSpatialPairingV1,
} from "./composition/risk-flow.mjs";
import { SingleBindingV1 } from "./runtime.mjs";

const ref = (entityId, versionId = "v1") => ({ entityId, versionId });
const typedRef = (kind, entityId, versionId = "v1") => ({
  kind,
  reference: ref(entityId, versionId),
});
const spatialScopeRef = typedRef("spatial-scope", "space-a");
const identificationRunRef = typedRef("workflow-run", "identification-run-a");
const riskRecordRef = typedRef("standardized-risk-record", "risk-a");
const authorization = {
  schemaVersion: "1",
  authorizationContextRef: typedRef("authorization-context", "authorization-a"),
  actorId: "actor-a",
  projectId: "project-a",
  grantedCapabilities: ["engineering-data.read"],
  spatialScopeRefs: [spatialScopeRef],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: ref("authorization-policy"),
  decidedAt: "2026-10-11T00:00:00.000Z",
  invocation: { kind: "human" },
};

const binding = (projectId, suffix = projectId) => ({
  projectId,
  policyRefs: { retry: ref(`retry-${suffix}`) },
  graphVersions: {
    riskFlow: ref(`risk-flow-${suffix}`),
    identification: ref(`identification-${suffix}`),
    assessment: ref(`assessment-${suffix}`),
  },
});

const providers = (bindings = [binding("project-a")]) => {
  const projects = new Map(
    bindings.map((entry) => [
      entry.projectId,
      {
        binding: { projectId: entry.projectId, policyRefs: entry.policyRefs },
        policies: {
          retry: {
            policyRef: entry.policyRefs.retry,
            maxAttempts: entry.projectId === "project-a" ? 3 : 5,
            backoffMs: entry.projectId === "project-a" ? 200 : 800,
          },
        },
      },
    ]),
  );
  return {
    foundation: {
      config: { projectBindings: bindings },
      runtime: { db: {} },
      transactionUnit: { execute() {} },
      artifactStore: { put() {}, open() {} },
      access: { verify() {} },
    },
    resolveDeploymentPolicies: { resolveProject: (projectId) => projects.get(projectId) },
    checkpointer: { getTuple() {} },
    identificationRuntime: {},
    assessmentRuntime: {},
    riskSpatialPairing: { resolve() {} },
    runtimeAuthorization: { verifyCurrent() {} },
    humanDecisionProof: { verifyHumanDecisionCommitted() {} },
  };
};

beforeEach(() => {
  graphCompositionFactory.create.mockReset();
  humanDecisionFeedbackFactory.create.mockReset();
  humanDecisionFeedbackFactory.create.mockReturnValue({
    record: vi.fn(),
    verifyHumanDecisionCommitted: vi.fn(),
    readRouteDecision: vi.fn(),
  });
  graphCompositionFactory.create.mockImplementation((options) => {
    const runtime = {
      workflowPort: {
        startRun: vi.fn(async (command) => ({ kind: "started", command })),
        resumeRun: vi.fn(async (command) => ({ kind: "resumed", command })),
        cancelRun: vi.fn(async (command) => ({ kind: "cancelled", command })),
      },
      applyIdentificationPreparation: vi.fn(async (input) => input),
      applyAcceptedRisk: vi.fn(async (input) => input),
    };
    return {
      options,
      runtime,
      adapter: { entriesRead: {}, runRead: {} },
    };
  });
});

describe("C41 部署人工决定与反馈组合", () => {
  const feedbackProviders = () => {
    const assessmentProof = { verifyActualAssessment: vi.fn() };
    const responseLifecycle = {
      recordDecision: vi.fn(),
      forecastResponse: vi.fn(),
      recordExecution: vi.fn(),
      recordFeedback: vi.fn(),
      calculateDeviation: vi.fn(),
    };
    const responseContext = { readRecommendationContext: vi.fn() };
    const workflow = {
      startRun: vi.fn(async (command) => command),
      resumeRun: vi.fn(async (command) => command),
      cancelRun: vi.fn(async (command) => command),
    };
    return {
      options: {
        foundation: {
          runtime: { db: {} },
          transactionUnit: { execute: vi.fn() },
          access: { verify: vi.fn() },
        },
        authorizeDownstream: vi.fn(),
        assessmentProof,
        responseLifecycle,
        responseContext,
        workflowStartControl: {
          graphVersion: ref("risk-flow-project-a"),
          retryPolicyRef: ref("retry-project-a"),
        },
        routeDecisionsBinding: new SingleBindingV1("C41→C26 route decisions"),
      },
      workflow,
      assessmentProof,
      responseLifecycle,
      responseContext,
    };
  };

  it("builds one public C41 adapter for API, C30 proof and C26 route decisions", () => {
    const input = feedbackProviders();
    const result = createDeploymentHumanDecisionFeedbackV1(input.options);
    const adapter = humanDecisionFeedbackFactory.create.mock.results[0].value;

    expect(humanDecisionFeedbackFactory.create).toHaveBeenCalledTimes(1);
    expect(humanDecisionFeedbackFactory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentProof: input.assessmentProof,
        responseLifecycle: input.responseLifecycle,
        responseContext: input.responseContext,
        workflowStartControl: input.options.workflowStartControl,
      }),
    );
    expect(result.humanDecisionFeedback).toBe(adapter);
    expect(result.humanDecisionProof).toBe(adapter);
    expect(result.routeDecisions).toBe(adapter);
    expect(input.options.routeDecisionsBinding.isBound).toBe(true);
    expect(input.options.routeDecisionsBinding.useMethod("readRouteDecision", {})).toBeUndefined();

    createDeploymentRiskFlowV1({
      ...providers(),
      humanDecisionProof: result.humanDecisionProof,
    });
    expect(graphCompositionFactory.create.mock.calls[0][0].humanDecisionProof).toBe(adapter);
  });

  it("constructs the public PostgreSQL adapter rather than a host-side substitute", async () => {
    const actual = await vi.importActual(
      "../../packages/adapters/dist/human-decision-feedback/index.js",
    );
    humanDecisionFeedbackFactory.create.mockImplementation(
      actual.createPostgresHumanDecisionFeedbackAdapter,
    );
    const result = createDeploymentHumanDecisionFeedbackV1(feedbackProviders().options);

    expect(result.humanDecisionFeedback).toBeInstanceOf(actual.PostgresHumanDecisionFeedbackAdapter);
    expect(result.humanDecisionProof).toBe(result.humanDecisionFeedback);
    expect(result.routeDecisions).toBe(result.humanDecisionFeedback);
  });

  it("binds C30 workflow and its real proof ports once", async () => {
    const input = feedbackProviders();
    const result = createDeploymentHumanDecisionFeedbackV1(input.options);
    const [adapterOptions] = humanDecisionFeedbackFactory.create.mock.calls[0];
    const command = { commandId: "run-a" };

    await expect(adapterOptions.workflow.startRun(command)).rejects.toThrow(
      "deployment composition is not bound: C41→C30 workflow.startRun",
    );
    const bindingProof = { verifyResponseWorkflowBinding: vi.fn() };
    const runCompletionProof = { verifyWorkflowRunCompletion: vi.fn() };
    expect(result.bindC30({ workflow: input.workflow, bindingProof, runCompletionProof })).toBe(
      runCompletionProof,
    );
    await expect(adapterOptions.workflow.startRun(command)).resolves.toBe(command);
    expect(input.workflow.startRun).toHaveBeenCalledWith(command);
    await expect(adapterOptions.bindingProof.verifyResponseWorkflowBinding(command)).resolves.toBe(
      undefined,
    );
    expect(bindingProof.verifyResponseWorkflowBinding).toHaveBeenCalledWith(command);
    await expect(adapterOptions.runCompletionProof.verifyWorkflowRunCompletion(command)).resolves.toBe(
      undefined,
    );
    expect(runCompletionProof.verifyWorkflowRunCompletion).toHaveBeenCalledWith(command);
    expect(() => result.bindC30({ workflow: input.workflow, bindingProof, runCompletionProof })).toThrow(
      "already closed",
    );
  });

  it("fails construction when an owning-module proof or C26 binding is absent", () => {
    const missingProof = feedbackProviders().options;
    missingProof.assessmentProof = undefined;
    expect(() => createDeploymentHumanDecisionFeedbackV1(missingProof)).toThrow(
      "DEPLOYMENT_RISK_FLOW_DEPENDENCY_MISSING:assessmentProof",
    );

    const missingReaderBinding = feedbackProviders().options;
    missingReaderBinding.routeDecisionsBinding = undefined;
    expect(() => createDeploymentHumanDecisionFeedbackV1(missingReaderBinding)).toThrow(
      "DEPLOYMENT_RISK_FLOW_DEPENDENCY_MISSING:routeDecisionsBinding",
    );
  });
});

describe("C30 部署组合按工程绑定装配", () => {
  it("缺少任一必需生产 provider 时拒绝构造", () => {
    for (const name of [
      "checkpointer",
      "identificationRuntime",
      "assessmentRuntime",
      "riskSpatialPairing",
      "runtimeAuthorization",
      "humanDecisionProof",
    ]) {
      expect(() => createDeploymentRiskFlowV1({ ...providers(), [name]: undefined })).toThrow(
        "DEPLOYMENT_RISK_FLOW_DEPENDENCY_MISSING",
      );
    }
  });

  it("只装配各工程绑定的图版本与重试策略，retry reader 只接受其精确引用", async () => {
    const inputs = providers([binding("project-a"), binding("project-b")]);
    const result = createDeploymentRiskFlowV1(inputs);

    expect(result.compositions).toBeInstanceOf(Map);
    expect([...result.compositions.keys()]).toEqual(["project-a", "project-b"]);
    expect(graphCompositionFactory.create).toHaveBeenCalledTimes(2);
    const [a, b] = graphCompositionFactory.create.mock.calls.map(([value]) => value);
    expect(a.subGraphVersions).toEqual({
      identification: ref("identification-project-a"),
      assessment: ref("assessment-project-a"),
    });
    expect(b.subGraphVersions).toEqual({
      identification: ref("identification-project-b"),
      assessment: ref("assessment-project-b"),
    });
    await expect(
      a.retryPolicy.read({ projectId: "project-a", retryPolicyRef: ref("retry-project-a") }),
    ).resolves.toEqual({ maxAttempts: 3, backoffMs: 200 });
    await expect(
      a.retryPolicy.read({ projectId: "project-b", retryPolicyRef: ref("retry-project-a") }),
    ).resolves.toBeUndefined();
    await expect(
      b.retryPolicy.read({ projectId: "project-b", retryPolicyRef: ref("retry-project-a") }),
    ).resolves.toBeUndefined();
    expect(result.adapter.get("project-a")).toBe(result.compositions.get("project-a").adapter);
    expect(result.readers.get("project-a").runRead).toBe(
      result.compositions.get("project-a").adapter.runRead,
    );
  });

  it("错绑的重试引用或工程策略正文不匹配时拒绝构造", () => {
    const unbound = providers();
    unbound.foundation.config.projectBindings[0].policyRefs.retry = ref("other-retry");
    expect(() => createDeploymentRiskFlowV1(unbound)).toThrow(
      "DEPLOYMENT_RISK_FLOW_RETRY_POLICY_REF_MISMATCH",
    );

    const mismatched = providers();
    mismatched.resolveDeploymentPolicies.resolveProject = () => ({
      binding: { projectId: "project-a", policyRefs: { retry: ref("retry-project-a", "v2") } },
      policies: {
        retry: { policyRef: ref("retry-project-a", "v2"), maxAttempts: 4, backoffMs: 1 },
      },
    });
    expect(() => createDeploymentRiskFlowV1(mismatched)).toThrow(
      "DEPLOYMENT_RISK_FLOW_RETRY_POLICY_REF_MISMATCH",
    );
  });

  it("保留 WorkflowPortV1 DTO 并按工程分派启动、恢复、取消和原事件入口", async () => {
    const result = createDeploymentRiskFlowV1(
      providers([binding("project-a"), binding("project-b")]),
    );
    const command = (projectId) => ({
      projectId,
      payload: {
        graphVersion: ref(`risk-flow-${projectId}`),
        retryPolicyRef: ref(`retry-${projectId}`),
      },
    });
    const startA = command("project-a");
    const startB = command("project-b");
    await result.api.workflow.startRun(startA);
    await result.api.workflow.startRun(startB);
    await result.api.workflow.resumeRun({ projectId: "project-b" });
    await result.api.workflow.cancelRun({ projectId: "project-a" });
    const preparation = { projectId: "project-b", eventId: "event-1" };
    const acceptedRisk = { projectId: "project-a", eventId: "event-2" };
    await result.eventRuntime.applyIdentificationPreparation(preparation);
    await result.eventRuntime.applyAcceptedRisk(acceptedRisk);

    const runtimeA = result.compositions.get("project-a").runtime;
    const runtimeB = result.compositions.get("project-b").runtime;
    expect(runtimeA.workflowPort.startRun).toHaveBeenCalledWith(startA);
    expect(runtimeB.workflowPort.startRun).toHaveBeenCalledWith(startB);
    expect(runtimeB.workflowPort.resumeRun).toHaveBeenCalledWith({ projectId: "project-b" });
    expect(runtimeA.workflowPort.cancelRun).toHaveBeenCalledWith({ projectId: "project-a" });
    expect(runtimeB.applyIdentificationPreparation).toHaveBeenCalledWith(preparation);
    expect(runtimeA.applyAcceptedRisk).toHaveBeenCalledWith(acceptedRisk);

    await expect(
      result.api.workflow.startRun({
        ...startB,
        payload: { ...startB.payload, graphVersion: ref("risk-flow-project-a") },
      }),
    ).rejects.toThrow("DEPLOYMENT_RISK_FLOW_START_BINDING_MISMATCH");
    await expect(
      result.api.workflow.startRun({
        ...startB,
        payload: { ...startB.payload, retryPolicyRef: ref("retry-project-a") },
      }),
    ).rejects.toThrow("DEPLOYMENT_RISK_FLOW_START_BINDING_MISMATCH");
    expect(runtimeB.workflowPort.startRun).toHaveBeenCalledTimes(1);
  });
});

describe("C30 部署风险空间配对", () => {
  it("使用原风险事实请求与分支授权，只返回已登记空间的唯一精确配对", async () => {
    const downstreamAuthorization = { ...authorization };
    const authorizeDownstream = vi.fn(async () => downstreamAuthorization);
    const readDeploymentRiskScopes = vi.fn(async () => ({
      spatialScopeRefs: [typedRef("spatial-scope", "other-space"), spatialScopeRef],
      sourceVersionRefs: [],
      identificationRunRef,
    }));
    const resolver = createDeploymentRiskSpatialPairingV1({
      riskInputFacts: { readDeploymentRiskScopes },
      authorizeDownstream,
    });
    const pairing = {
      spatialScopeRef,
      applicabilityMetadataSnapshotRef: typedRef(
        "applicability-metadata-snapshot",
        "applicability-a",
      ),
    };

    await expect(
      resolver.resolve({
        projectId: "project-a",
        actorId: "actor-a",
        authorization,
        requestedAt: "2026-10-11T00:00:00.000Z",
        riskRecordRef,
        identificationRunRef,
        pairings: [pairing],
      }),
    ).resolves.toEqual(spatialScopeRef);
    const [authorizationRequest] = authorizeDownstream.mock.calls[0];
    expect(authorizationRequest).toMatchObject({
      projectId: "project-a",
      actorId: "actor-a",
      branch: "engineering-data.evidence-access",
      requestedSpatialScopeRefs: [spatialScopeRef],
    });
    const [factsRequest] = readDeploymentRiskScopes.mock.calls[0];
    expect(factsRequest).toMatchObject({
      requestId: authorizationRequest.invocationId,
      idempotencyKey: authorizationRequest.invocationId,
      requestedAt: "2026-10-11T00:00:00.000Z",
      authorization: downstreamAuthorization,
      riskInput: riskRecordRef,
    });
  });

  it("工程、风险或运行身份不符以及空间配对非唯一时失败关闭", async () => {
    const readDeploymentRiskScopes = vi.fn(async () => ({
      spatialScopeRefs: [spatialScopeRef],
      sourceVersionRefs: [],
      identificationRunRef,
    }));
    const resolver = createDeploymentRiskSpatialPairingV1({
      riskInputFacts: { readDeploymentRiskScopes },
      authorizeDownstream: async () => authorization,
    });
    const input = {
      projectId: "project-a",
      actorId: "actor-a",
      authorization,
      requestedAt: "2026-10-11T00:00:00.000Z",
      riskRecordRef,
      identificationRunRef,
      pairings: [
        {
          spatialScopeRef,
          applicabilityMetadataSnapshotRef: typedRef("applicability-metadata-snapshot", "app-a"),
        },
      ],
    };

    await expect(resolver.resolve({ ...input, projectId: "project-b" })).resolves.toBeUndefined();
    await expect(
      resolver.resolve({ ...input, riskRecordRef: typedRef("external-risk-event", "risk-a") }),
    ).resolves.toBeUndefined();
    await expect(
      resolver.resolve({ ...input, identificationRunRef: typedRef("workflow-run", "other-run") }),
    ).resolves.toBeUndefined();
    await expect(
      resolver.resolve({ ...input, pairings: [input.pairings[0], input.pairings[0]] }),
    ).resolves.toBeUndefined();
    expect(readDeploymentRiskScopes).toHaveBeenCalledTimes(2);
  });

  it("授权拒绝返回空配对，reader 的数据库故障原样抛出", async () => {
    const input = {
      projectId: "project-a",
      actorId: "actor-a",
      authorization,
      requestedAt: "2026-10-11T00:00:00.000Z",
      riskRecordRef,
      identificationRunRef,
      pairings: [],
    };
    const denied = createDeploymentRiskSpatialPairingV1({
      riskInputFacts: { readDeploymentRiskScopes: vi.fn() },
      authorizeDownstream: async () => {
        throw new DeploymentAuthorizationError(
          "DEPLOYMENT_AUTHORIZATION_DOWNSTREAM_REJECTED",
          "engineering-data.evidence-access",
        );
      },
    });
    await expect(denied.resolve(input)).resolves.toBeUndefined();

    const databaseError = new Error("database unavailable");
    const failingReader = createDeploymentRiskSpatialPairingV1({
      riskInputFacts: {
        readDeploymentRiskScopes: async () => {
          throw databaseError;
        },
      },
      authorizeDownstream: async () => authorization,
    });
    await expect(failingReader.resolve(input)).rejects.toBe(databaseError);
  });
});
