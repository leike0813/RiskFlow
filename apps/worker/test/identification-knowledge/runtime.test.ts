import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  AgentRuntimeError,
  AgentTaskDefinitionRegistry,
  AgentTaskEnvelopeV1Schema,
  buildCompletedAgentTaskResult,
  emptyAgentBudgetUsage,
  makeAgentError,
  type AgentBudgetUsageV1,
  type AgentDomainToolResultV1,
  type AgentStructuredErrorV1,
  type AgentTaskActionV1,
  type AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import type { AgentTaskRefV1 } from "@riskflow/contracts/ports";
import {
  KNOWLEDGE_AUTHORING_TASK_TYPE,
  createKnowledgeAuthoringTaskDefinition,
  IdentificationKnowledgeValidationPolicyV1Schema,
  type IdentificationKnowledgeValidationPolicyV1,
  type KnowledgeAuthoringSegmentSliceRequestV1,
  type KnowledgeAuthoringBaselineReadRequestV1,
  type KnowledgeAuthoringTaskPortV1,
} from "@riskflow/core/identification-knowledge";
import type { ArtifactRefV1 } from "@riskflow/core/artifacts";
import type { ModelGatewayPortV1, StructuredCompletionRequestV1 } from "@riskflow/core/model";
import type { AgentTaskExecutionStoreV1 } from "@riskflow/adapters/agent-runtime";

import { AgentRuntimeRunner } from "../../src/agent-runtime/index.js";
import {
  KnowledgeAuthoringRunner,
  interpretKnowledgeAuthoringModelStep,
  withKnowledgeAuthoringModelStep,
  type KnowledgeAuthoringModelStepOptionsV1,
} from "../../src/identification-knowledge/index.js";

const NOW = "2030-01-01T00:00:01.000Z";
const EPOCH = "2030-01-01T00:00:00.000Z";

const sha256 = (seed: string): string => createHash("sha256").update(seed).digest("hex");

const versionRef = (entityId: string, versionId = "1") => ({ entityId, versionId });

const artifactRef = (entityId: string): ArtifactRefV1 => ({
  kind: "content-artifact",
  reference: { entityId, versionId: `sha256:${sha256(entityId)}` },
});

const POLICY_REF = versionRef("policy:identification-knowledge", "1");

const policy: IdentificationKnowledgeValidationPolicyV1 =
  IdentificationKnowledgeValidationPolicyV1Schema.parse({
    schemaVersion: "1",
    policyRef: POLICY_REF,
    criticalProcessKinds: ["扩径准备"],
    coverage: [{ processKind: "扩径准备", minimumMechanisms: 1, minimumEvidence: 1 }],
    allowedStandardLevels: ["national", "industry"],
    allowedCaseConstructionMethods: ["variable-diameter-shield"],
    maxEntriesPerPackage: 64,
    tools: {
      segmentSliceToolRef: versionRef("tool:knowledge-segment-slice", "1"),
      baselineKnowledgeToolRef: versionRef("tool:baseline-knowledge", "1"),
    },
    agent: {
      definitionRef: versionRef("agent-definition:knowledge-authoring", "1"),
      modelDeploymentRef: versionRef("model-deployment:knowledge-authoring", "1"),
      promptTemplateRef: versionRef("prompt-template:knowledge-authoring", "1"),
      toolPolicyRef: versionRef("tool-policy:knowledge-authoring", "1"),
      budgetPolicyRef: versionRef("budget-policy:knowledge-authoring", "1"),
      incrementSchemaRef: versionRef("increment-schema:knowledge-authoring", "1"),
      validationPolicyRef: versionRef("validation-policy:knowledge-authoring", "1"),
      budgetPolicy: {
        schemaVersion: "1",
        policyRef: versionRef("budget-policy:knowledge-authoring", "1"),
        modelDeploymentRef: versionRef("model-deployment:knowledge-authoring", "1"),
        promptTemplateRef: versionRef("prompt-template:knowledge-authoring", "1"),
        toolPolicyRef: versionRef("tool-policy:knowledge-authoring", "1"),
        maxModelInvocations: 4,
        maxToolInvocations: 2,
        maxContextTokens: 4096,
        maxOutputTokens: 1024,
        maxInputBytes: 65_536,
        maxOutputBytes: 65_536,
        maxCandidates: 2,
        maxObjects: 64,
        maxSupplementarySearches: 0,
        maxCorrections: 0,
        maxTransientRetries: 0,
        maxConcurrentActions: 1,
        maxWallClockMs: 60_000,
      },
    },
  });

const taskRef: AgentTaskRefV1 = {
  kind: "agent-task",
  reference: versionRef("agent-task:project-1:command-1", "1"),
  taskType: KNOWLEDGE_AUTHORING_TASK_TYPE,
  triggerMode: "embedded",
  modelDeploymentRef: policy.agent.modelDeploymentRef,
  promptTemplateRef: policy.agent.promptTemplateRef,
  toolPolicyRef: policy.agent.toolPolicyRef,
  budgetPolicyRef: policy.agent.budgetPolicyRef,
  incrementSchemaRef: policy.agent.incrementSchemaRef,
  validationPolicyRef: policy.agent.validationPolicyRef,
};

const SOURCE_VERSION = versionRef("source-version:manual", "1");
const SEGMENT_ID = "manual-chapter-overview";

const evidence = [{ locator: { sourceSegmentId: SEGMENT_ID }, sourceVersion: SOURCE_VERSION }];

const task = {
  envelope: AgentTaskEnvelopeV1Schema.parse({
    schemaVersion: "1",
    agentTaskRef: taskRef,
    commandId: "command-1",
    idempotencyKey: "task-idempotency-1",
    taskType: KNOWLEDGE_AUTHORING_TASK_TYPE,
    triggerMode: "embedded",
    projectId: "project-1",
    actorId: "actor-1",
    parentRunRef: { kind: "workflow-run", reference: versionRef("run-1", "1") },
    frozenInputRef: artifactRef("frozen-manifest"),
    modelDeploymentRef: taskRef.modelDeploymentRef,
    promptTemplateRef: taskRef.promptTemplateRef,
    toolPolicyRef: taskRef.toolPolicyRef,
    budgetPolicyRef: taskRef.budgetPolicyRef,
    incrementSchemaRef: taskRef.incrementSchemaRef,
    validationPolicyRef: taskRef.validationPolicyRef,
    authorization: {
      schemaVersion: "1",
      authorizationContextRef: {
        kind: "authorization-context",
        reference: versionRef("authorization", "1"),
      },
      actorId: "actor-1",
      projectId: "project-1",
      grantedCapabilities: ["agent-task.start"],
      spatialScopeRefs: [],
      sourceAccessGrantRefs: [],
      authorizationPolicyRef: versionRef("authorization-policy", "1"),
      decidedAt: EPOCH,
      invocation: { kind: "human" },
    },
    frozenAuthorization: {
      schemaVersion: "1",
      authorizationContextRef: {
        kind: "authorization-context",
        reference: versionRef("authorization", "1"),
      },
      actorId: "actor-1",
      projectId: "project-1",
      grantedCapabilities: ["agent-task.start"],
      spatialScopeRefs: [],
      sourceAccessGrantRefs: [],
      authorizationPolicyRef: versionRef("authorization-policy", "1"),
      capturedAt: EPOCH,
    },
    createdAt: EPOCH,
  }),
  state: {
    schemaVersion: "1",
    agentTaskRef: taskRef,
    status: "running",
    taskVersion: 2,
    cancelRequested: false,
    latestCandidateVersion: 0,
    updatedAt: EPOCH,
  },
  budgetPolicy: policy.agent.budgetPolicy,
  budgetLedger: {
    schemaVersion: "1",
    reserved: emptyAgentBudgetUsage(),
    used: emptyAgentBudgetUsage(),
    activeWallClockMs: 0,
    currentConcurrency: 0,
    ledgerVersion: 1,
    changedAt: EPOCH,
  },
} as unknown as AgentTaskSnapshotV1;

const claim = {
  task,
  attemptNumber: 1,
  workerId: "worker-1",
  leaseToken: "lease-1",
  leaseUntil: "2030-01-01T00:00:30.000Z",
};

const observationRef = artifactRef("observation:knowledge-segment");

const segmentSliceRequest = {
  kind: "read-knowledge-segment-slice",
  sourceSegmentSetRef: {
    kind: "source-segment-set",
    reference: versionRef("segment-set:manual", "1"),
  },
  sourceSegmentIds: [SEGMENT_ID],
  limit: 8,
} satisfies KnowledgeAuthoringSegmentSliceRequestV1;

const baselineReadRequest = {
  kind: "read-exact-knowledge",
  definitionType: "process-model",
  releaseRef: {
    kind: "knowledge-release",
    reference: versionRef("knowledge-release:process-model", "1"),
  },
} satisfies KnowledgeAuthoringBaselineReadRequestV1;

const candidateIncrement = {
  schemaVersion: "1" as const,
  candidateVersion: 1,
  definitionType: "process-model" as const,
  operations: [
    {
      operation: "retire-node" as const,
      expectedBaselineDigest: sha256("baseline"),
      reasonCode: "baseline-superseded",
      evidence,
      nodeId: "node-1",
    },
    {
      operation: "retire-edge" as const,
      expectedBaselineDigest: sha256("baseline"),
      reasonCode: "baseline-superseded",
      evidence,
      edgeId: "edge-1",
    },
  ],
};

const candidateSubmission = {
  kind: "submit-knowledge-candidate" as const,
  candidate: candidateIncrement,
};

const candidateValidation = {
  schemaVersion: "1" as const,
  items: [
    {
      checkId: "increment.operation",
      disposition: "accepted" as const,
      reasonCode: "accepted",
      evidenceReferences: [],
    },
  ],
  disposition: "accepted" as const,
  validationArtifactRef: artifactRef("candidate-validation"),
  validatedAt: NOW,
};

interface FailureRecordV1 {
  readonly code: string;
  readonly reasonCode: string | undefined;
}

const makeStore = (overrides: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  const actionFailures: FailureRecordV1[] = [];
  const taskFailures: FailureRecordV1[] = [];
  const candidates: Array<{ readonly disposition: string; readonly candidateVersion: number }> = [];
  let claimed = false;
  const store = {
    calls,
    actionFailures,
    taskFailures,
    candidates,
    async claim() {
      if (claimed) return undefined;
      claimed = true;
      return claim;
    },
    async verifyWorker() {
      calls.push("verify");
    },
    async findAction() {
      return undefined;
    },
    async reserveAction(input: {
      readonly actionId: string;
      readonly reservationId: string;
      readonly actionType: AgentTaskActionV1["actionType"];
      readonly amount?: Partial<AgentBudgetUsageV1>;
    }) {
      calls.push("reserve");
      const amount = { ...emptyAgentBudgetUsage(), ...input.amount };
      if (input.actionType === "model-invocation") amount.modelInvocations = 1;
      if (input.actionType === "domain-tool") amount.toolInvocations = 1;
      return {
        task,
        reservation: {
          schemaVersion: "1" as const,
          reservationId: input.reservationId,
          actionId: input.actionId,
          amount,
          concurrency: 1,
          reservedAt: EPOCH,
        },
      };
    },
    async heartbeat() {
      calls.push("heartbeat");
      return "2030-01-01T00:00:30.000Z";
    },
    async recordCandidate(input: {
      readonly candidate: { readonly disposition: string; readonly candidateVersion: number };
    }) {
      calls.push("candidate");
      candidates.push({
        disposition: input.candidate.disposition,
        candidateVersion: input.candidate.candidateVersion,
      });
    },
    async completeAction() {
      calls.push("complete-action");
      return task;
    },
    async completeTask() {
      calls.push("complete-task");
      return task;
    },
    async failAction(input: { readonly error: AgentStructuredErrorV1 }) {
      calls.push("fail");
      actionFailures.push({ code: input.error.code, reasonCode: input.error.reasonCode });
      return task;
    },
    async releaseLease() {
      calls.push("release");
    },
    async failTask(input: { readonly error: AgentStructuredErrorV1 }) {
      calls.push("fail-task");
      taskFailures.push({ code: input.error.code, reasonCode: input.error.reasonCode });
      return task;
    },
    ...overrides,
  } as unknown as AgentTaskExecutionStoreV1 & {
    calls: string[];
    actionFailures: FailureRecordV1[];
    taskFailures: FailureRecordV1[];
    candidates: Array<{ readonly disposition: string; readonly candidateVersion: number }>;
  };
  return store;
};

interface PortCallsV1 {
  readonly segmentSlices: unknown[];
  readonly baselineReads: unknown[];
  readonly validations: unknown[];
  readonly finalized: unknown[];
}

const makePort = (segmentSlice?: AgentDomainToolResultV1) => {
  const calls: PortCallsV1 = {
    segmentSlices: [],
    baselineReads: [],
    validations: [],
    finalized: [],
  };
  const port = {
    calls,
    async readSegmentSlice(input: unknown) {
      calls.segmentSlices.push(input);
      return segmentSlice ?? { observationArtifactRef: observationRef, effect: "none" as const };
    },
    async readExactKnowledge(input: unknown) {
      calls.baselineReads.push(input);
      return { observationArtifactRef: observationRef, effect: "none" as const };
    },
    async validateAuthoringCandidate(input: { readonly candidate: unknown }) {
      calls.validations.push(input.candidate);
      return candidateValidation;
    },
    async finalizeAuthoringCandidate(input: { readonly candidate: unknown }) {
      calls.finalized.push(input.candidate);
      return buildCompletedAgentTaskResult(taskRef, {
        kind: "knowledge-revision",
        reference: versionRef("knowledge-revision:1", "1"),
      });
    },
  } as unknown as KnowledgeAuthoringTaskPortV1 & { calls: PortCallsV1 };
  return port;
};

const makeGateway = (...values: readonly unknown[]) => {
  let index = 0;
  const completeStructured = vi.fn(async (request: StructuredCompletionRequestV1) => {
    if (index >= values.length) throw new Error("model gateway script exhausted");
    const value = values[index];
    index += 1;
    if (value instanceof Error) throw value;
    return {
      schemaVersion: "1" as const,
      invocationId: request.invocationId,
      modelDeploymentRef: request.modelDeploymentRef,
      serverBuildRef: versionRef("server-build", "1"),
      modelVersionRef: versionRef("model-version", "1"),
      usage: { available: true, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      rawResponseRef: {
        kind: "diagnostic-artifact" as const,
        reference: versionRef("raw-model-response", "1"),
      },
      promptTemplateRef: request.promptTemplateRef,
      outputSchemaRef: request.outputSchemaRef,
      value,
      finishReason: "stop" as const,
    };
  });
  return { completeStructured, port: { completeStructured } as unknown as ModelGatewayPortV1 };
};

type RenderedStepV1 = {
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly maxOutputTokens: number;
  readonly domainTool?: unknown;
};

const setup = (options: {
  readonly script: readonly unknown[];
  readonly segmentSlice?: AgentDomainToolResultV1;
  readonly storeOverrides?: Record<string, unknown>;
}) => {
  const store = makeStore(options.storeOverrides);
  const port = makePort(options.segmentSlice);
  const persisted: Array<{
    readonly actionId: string;
    readonly purposeCode: string;
    readonly value: unknown;
  }> = [];
  const persistArtifact = vi.fn(
    async (input: {
      readonly task: AgentTaskSnapshotV1;
      readonly actionId: string;
      readonly purposeCode: string;
      readonly value: unknown;
    }) => {
      persisted.push(input);
      return artifactRef(`${input.actionId}:${input.purposeCode}`);
    },
  );
  const definition = createKnowledgeAuthoringTaskDefinition({ policy, port });
  const modelStep = withKnowledgeAuthoringModelStep({ policy, persistArtifact, now: () => NOW });
  const renderModelStep = vi.fn(modelStep.renderModelStep);
  const gateway = makeGateway(...options.script);
  const runner = new AgentRuntimeRunner({
    store,
    registry: new AgentTaskDefinitionRegistry([definition]),
    workerId: "worker-1",
    leaseDurationMs: 30_000,
    maxConcurrentTasks: 1,
    modelGateway: gateway.port,
    renderModelStep,
    interpretModelStep: modelStep.interpretModelStep,
    persistArtifact,
    now: () => NOW,
  });
  const settleAuthoringFailures = vi.fn(async () => 1);
  const authoringRunner = new KnowledgeAuthoringRunner({ runner, settleAuthoringFailures });
  return {
    store,
    port,
    persisted,
    renderModelStep,
    gateway,
    settleAuthoringFailures,
    authoringRunner,
  };
};

describe("knowledge authoring model step", () => {
  it("routes reads to the frozen tools and drives tool to candidate to validation to revision", async () => {
    const { store, port, persisted, renderModelStep, settleAuthoringFailures, authoringRunner } =
      setup({ script: [segmentSliceRequest, candidateSubmission] });

    // `KnowledgeAuthoringRunner` 先跑 shared runner，再对 C17 attempt 收口一次。
    expect(await authoringRunner.runOnce()).toEqual({ processedTasks: 1, settledFailures: 1 });
    expect(settleAuthoringFailures).toHaveBeenCalledTimes(1);

    // 有界切片读取按冻结工具引用路由，观察工件在下一轮渲染中回填。
    expect(port.calls.segmentSlices).toEqual([segmentSliceRequest]);
    const toolIntent = persisted.find(
      (entry) =>
        entry.purposeCode === "agent-action-intent" &&
        (entry.value as { readonly actionType?: string }).actionType === "domain-tool",
    );
    expect((toolIntent?.value as { readonly toolRef?: unknown } | undefined)?.toolRef).toEqual(
      policy.tools.segmentSliceToolRef,
    );
    expect(renderModelStep.mock.calls[0]?.[2]).toEqual({});
    expect(renderModelStep.mock.calls[1]?.[2]).toEqual({
      previousObservationArtifactRef: observationRef,
    });

    // 渲染请求只携带引用与策略预算，不设置领域工具。
    const firstStep = renderModelStep.mock.results[0]?.value as RenderedStepV1 | undefined;
    expect(firstStep?.maxOutputTokens).toBe(policy.agent.budgetPolicy.maxOutputTokens);
    expect(firstStep?.domainTool).toBeUndefined();
    expect(firstStep?.messages).toHaveLength(2);
    expect(JSON.parse(firstStep?.messages[1]?.content ?? "")).toEqual({
      frozenManifestArtifactRef: task.envelope.frozenInputRef,
    });

    // 候选与增量各落一份 JSON 工件，同一候选正文既用于逐项校验也用于 revision 收口。
    const candidateArtifacts = persisted.filter(
      (entry) => entry.purposeCode === "agent-candidate" || entry.purposeCode === "agent-increment",
    );
    expect([...candidateArtifacts.map((entry) => entry.purposeCode)].sort()).toEqual([
      "agent-candidate",
      "agent-increment",
    ]);
    expect(candidateArtifacts.map((entry) => entry.value)).toEqual([
      candidateIncrement,
      candidateIncrement,
    ]);
    expect(port.calls.validations).toEqual([candidateIncrement]);
    expect(port.calls.finalized).toEqual([candidateIncrement]);

    // 校验通过后 candidate 以 completed 加结果引用落库，任务以正式结果完成。
    expect(store.candidates).toEqual([{ disposition: "completed", candidateVersion: 1 }]);
    expect(store.calls).toContain("complete-task");
    expect(store.actionFailures).toEqual([]);
    expect(store.taskFailures).toEqual([]);
  });

  it("settles C17 failures once instead of producing a fallback result", async () => {
    const modelFailure = setup({ script: [new Error("gateway down")] });
    expect(await modelFailure.authoringRunner.runOnce()).toEqual({
      processedTasks: 1,
      settledFailures: 1,
    });
    expect(modelFailure.gateway.completeStructured).toHaveBeenCalledTimes(1);
    expect(modelFailure.store.actionFailures).toEqual([{ code: "AGENT_MODEL_FAILURE" }]);
    expect(modelFailure.store.calls).not.toContain("complete-task");
    expect(modelFailure.port.calls.validations).toEqual([]);
    expect(modelFailure.settleAuthoringFailures).toHaveBeenCalledTimes(1);

    const toolFailure = setup({
      script: [segmentSliceRequest],
      segmentSlice: { observationArtifactRef: observationRef, effect: "committed" },
    });
    expect(await toolFailure.authoringRunner.runOnce()).toEqual({
      processedTasks: 1,
      settledFailures: 1,
    });
    expect(toolFailure.store.actionFailures).toEqual([{ code: "AGENT_TOOL_FAILURE" }]);
    expect(toolFailure.store.calls).not.toContain("complete-task");
    expect(toolFailure.port.calls.validations).toEqual([]);
    expect(toolFailure.settleAuthoringFailures).toHaveBeenCalledTimes(1);

    const budgetFailure = setup({
      script: [segmentSliceRequest],
      storeOverrides: {
        async reserveAction() {
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_BUDGET_EXHAUSTED",
              category: "budget",
              retryable: false,
              stage: "test.budget",
              taskRef,
            }),
          );
        },
      },
    });
    expect(await budgetFailure.authoringRunner.runOnce()).toEqual({
      processedTasks: 1,
      settledFailures: 1,
    });
    expect(budgetFailure.store.taskFailures).toEqual([{ code: "AGENT_BUDGET_EXHAUSTED" }]);
    expect(budgetFailure.store.calls).not.toContain("complete-task");
    expect(budgetFailure.port.calls.validations).toEqual([]);
    expect(budgetFailure.settleAuthoringFailures).toHaveBeenCalledTimes(1);

    // 取消发生在 claim 之前：shared runner 不处理任何任务，模块仍收口一次并保持无结果。
    const cancelled = setup({ script: [segmentSliceRequest] });
    const controller = new AbortController();
    controller.abort();
    expect(await cancelled.authoringRunner.runOnce(controller.signal)).toEqual({
      processedTasks: 0,
      settledFailures: 1,
    });
    expect(cancelled.store.calls).toEqual([]);
    expect(cancelled.settleAuthoringFailures).toHaveBeenCalledTimes(1);
  });
});

describe("knowledge authoring model step routing", () => {
  const now = () => NOW;
  const persistArtifact = vi.fn(async () => observationRef);
  const options: KnowledgeAuthoringModelStepOptionsV1 = { policy, persistArtifact, now };
  const foreignTask = {
    ...task,
    envelope: {
      ...task.envelope,
      agentTaskRef: { ...taskRef, taskType: "data-cleaning" },
    },
  } as unknown as AgentTaskSnapshotV1;
  const definition = createKnowledgeAuthoringTaskDefinition({ policy, port: makePort() });
  const modelResponse = (value: unknown) => ({
    schemaVersion: "1" as const,
    invocationId: "agent-task:project-1:command-1:action:3",
    modelDeploymentRef: policy.agent.modelDeploymentRef,
    serverBuildRef: versionRef("server-build", "1"),
    modelVersionRef: versionRef("model-version", "1"),
    usage: { available: true, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    rawResponseRef: {
      kind: "diagnostic-artifact" as const,
      reference: versionRef("raw-model-response", "1"),
    },
    promptTemplateRef: policy.agent.promptTemplateRef,
    outputSchemaRef: policy.agent.incrementSchemaRef,
    value,
    finishReason: "stop" as const,
  });

  const throwCode = (run: () => unknown): string => {
    try {
      run();
    } catch (error) {
      if (error instanceof AgentRuntimeError) return error.details.code;
      throw error;
    }
    throw new Error("expected the model step callback to throw");
  };

  it("maps read actions to the frozen tool references and rejects unknown actions", async () => {
    await expect(
      interpretKnowledgeAuthoringModelStep(options, modelResponse(segmentSliceRequest), task),
    ).resolves.toEqual({
      kind: "tool-request",
      toolRef: policy.tools.segmentSliceToolRef,
      toolInput: segmentSliceRequest,
    });
    await expect(
      interpretKnowledgeAuthoringModelStep(options, modelResponse(baselineReadRequest), task),
    ).resolves.toEqual({
      kind: "tool-request",
      toolRef: policy.tools.baselineKnowledgeToolRef,
      toolInput: baselineReadRequest,
    });

    const invalid = interpretKnowledgeAuthoringModelStep(
      options,
      modelResponse({ kind: "unexpected-action" }),
      task,
    );
    await expect(invalid).rejects.toBeInstanceOf(AgentRuntimeError);
    await expect(
      interpretKnowledgeAuthoringModelStep(
        options,
        modelResponse({ kind: "unexpected-action" }),
        task,
      ),
    ).rejects.toMatchObject({
      details: { code: "AGENT_INPUT_INVALID", stage: "worker.knowledge-authoring.action.schema" },
    });
    expect(persistArtifact).not.toHaveBeenCalled();
  });

  it("persists both candidate artifacts and versions each submission", async () => {
    const persisted: Array<{
      readonly actionId: string;
      readonly purposeCode: string;
      readonly value: unknown;
    }> = [];
    const persist = vi.fn(
      async (input: {
        readonly actionId: string;
        readonly purposeCode: string;
        readonly value: unknown;
      }) => {
        persisted.push(input);
        return artifactRef(`${input.actionId}:${input.purposeCode}`);
      },
    );
    const versioned = {
      ...task,
      state: { ...task.state, latestCandidateVersion: 3 },
    } as unknown as AgentTaskSnapshotV1;

    const outcome = await interpretKnowledgeAuthoringModelStep(
      { policy, persistArtifact: persist, now },
      modelResponse(candidateSubmission),
      versioned,
    );

    expect(persisted.map((entry) => entry.purposeCode).sort()).toEqual([
      "agent-candidate",
      "agent-increment",
    ]);
    expect(persisted.map((entry) => entry.actionId)).toEqual([
      "agent-task:project-1:command-1:action:3",
      "agent-task:project-1:command-1:action:3",
    ]);
    expect(persisted.map((entry) => entry.value)).toEqual([candidateIncrement, candidateIncrement]);
    expect(outcome).toMatchObject({
      kind: "completed",
      candidatePayload: candidateIncrement,
      increment: candidateIncrement,
    });
    expect(outcome.candidate).toMatchObject({
      taskRef,
      candidateVersion: 4,
      parentCandidateVersion: 3,
      disposition: "pending",
      createdAt: NOW,
    });
    expect(outcome.usage).toEqual({
      ...emptyAgentBudgetUsage(),
      candidates: 1,
      objects: candidateIncrement.operations.length,
    });
  });

  it("delegates non-authoring task types to the inner model step and fails closed without one", () => {
    const innerStep = {
      messages: [{ role: "user" as const, content: "inner" }],
      maxOutputTokens: 1,
    };
    const inner = {
      renderModelStep: vi.fn(() => innerStep),
      interpretModelStep: vi.fn(() => ({ kind: "failed" as const })),
    };
    const delegated = withKnowledgeAuthoringModelStep({ ...options, inner });
    expect(delegated.renderModelStep(foreignTask, definition)).toEqual(innerStep);
    expect(inner.renderModelStep).toHaveBeenCalledWith(foreignTask, definition, undefined);
    expect(delegated.interpretModelStep(modelResponse({}), foreignTask, definition)).toEqual({
      kind: "failed",
    });

    const withoutInner = withKnowledgeAuthoringModelStep(options);
    expect(throwCode(() => withoutInner.renderModelStep(foreignTask, definition))).toBe(
      "AGENT_INPUT_INVALID",
    );
    expect(
      throwCode(() => withoutInner.interpretModelStep(modelResponse({}), foreignTask, definition)),
    ).toBe("AGENT_INPUT_INVALID");
  });
});

describe("knowledge authoring runner", () => {
  it("runs the shared runner first and settles C17 failures exactly once per pass", async () => {
    const signal = new AbortController().signal;
    const runOnce = vi.fn(async () => 2);
    const settleAuthoringFailures = vi.fn(async () => 3);
    const runner = new KnowledgeAuthoringRunner({
      runner: { runOnce } as unknown as AgentRuntimeRunner,
      settleAuthoringFailures,
    });

    await expect(runner.runOnce(signal)).resolves.toEqual({
      processedTasks: 2,
      settledFailures: 3,
    });
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(runOnce).toHaveBeenCalledWith(signal);
    expect(settleAuthoringFailures).toHaveBeenCalledTimes(1);
    expect(settleAuthoringFailures).toHaveBeenCalledWith(signal);
    expect(runOnce.mock.invocationCallOrder[0]).toBeLessThan(
      settleAuthoringFailures.mock.invocationCallOrder[0]!,
    );

    // 无 signal 的调用沿用 shared runner 的默认信号；模块不自行创建租约或并发。
    await expect(runner.runOnce()).resolves.toEqual({ processedTasks: 2, settledFailures: 3 });
    expect(runOnce).toHaveBeenLastCalledWith(undefined);
    expect(settleAuthoringFailures).toHaveBeenCalledTimes(2);
  });
});
