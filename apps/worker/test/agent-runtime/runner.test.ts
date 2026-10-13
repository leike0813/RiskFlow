import { describe, expect, it, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";

import {
  AgentTaskDefinitionRegistry,
  AgentRuntimeError,
  buildCompletedAgentTaskResult,
  emptyAgentBudgetUsage,
  makeAgentError,
  type AgentTaskDefinitionV1,
  type AgentDomainToolResultV1,
  type AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import { z } from "@riskflow/core/model";
import type { ModelGatewayPortV1 } from "@riskflow/core/model";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import type { AgentTaskActionV1 } from "@riskflow/core/agent-runtime";
import type { AgentTaskRefV1 } from "@riskflow/contracts/ports";
import { AgentRuntimeRunner } from "../../src/agent-runtime/index.js";
import type { AgentTaskClaimV1, AgentTaskExecutionStoreV1 } from "@riskflow/adapters/agent-runtime";

const taskRef: AgentTaskRefV1 = {
  kind: "agent-task",
  reference: { entityId: "agent-task:project-1:task-1", versionId: "1" },
  taskType: "data-cleaning",
  triggerMode: "embedded",
  modelDeploymentRef: { entityId: "model", versionId: "1" },
  promptTemplateRef: { entityId: "prompt", versionId: "1" },
  toolPolicyRef: { entityId: "tools", versionId: "1" },
  budgetPolicyRef: { entityId: "budget", versionId: "1" },
  incrementSchemaRef: { entityId: "increment", versionId: "1" },
  validationPolicyRef: { entityId: "validation", versionId: "1" },
};

const task = {
  envelope: {
    schemaVersion: "1",
    agentTaskRef: taskRef,
    commandId: "command-1",
    idempotencyKey: "task-idempotency-1",
    taskType: "data-cleaning",
    triggerMode: "embedded",
    projectId: "project-1",
    actorId: "actor-1",
    parentRunRef: {
      kind: "workflow-run",
      reference: { entityId: "run-1", versionId: "1" },
    },
    frozenInputRef: {
      kind: "content-artifact",
      reference: { entityId: "input", versionId: `sha256:${"a".repeat(64)}` },
    },
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
        reference: { entityId: "authorization", versionId: "1" },
      },
      actorId: "actor-1",
      projectId: "project-1",
      grantedCapabilities: ["agent-task.start"],
      spatialScopeRefs: [],
      sourceAccessGrantRefs: [],
      authorizationPolicyRef: { entityId: "authorization-policy", versionId: "1" },
      decidedAt: "2030-01-01T00:00:00.000Z",
      invocation: { kind: "human" },
    },
    frozenAuthorization: {
      schemaVersion: "1",
      authorizationContextRef: {
        kind: "authorization-context",
        reference: { entityId: "authorization", versionId: "1" },
      },
      actorId: "actor-1",
      projectId: "project-1",
      grantedCapabilities: ["agent-task.start"],
      spatialScopeRefs: [],
      sourceAccessGrantRefs: [],
      authorizationPolicyRef: { entityId: "authorization-policy", versionId: "1" },
      capturedAt: "2030-01-01T00:00:00.000Z",
    },
    createdAt: "2030-01-01T00:00:00.000Z",
  },
  state: {
    schemaVersion: "1",
    agentTaskRef: taskRef,
    status: "running",
    taskVersion: 2,
    cancelRequested: false,
    latestCandidateVersion: 0,
    updatedAt: "2030-01-01T00:00:00.000Z",
  },
  budgetPolicy: {
    schemaVersion: "1",
    policyRef: taskRef.budgetPolicyRef,
    modelDeploymentRef: taskRef.modelDeploymentRef,
    promptTemplateRef: taskRef.promptTemplateRef,
    toolPolicyRef: taskRef.toolPolicyRef,
    maxModelInvocations: 2,
    maxToolInvocations: 1,
    maxContextTokens: 100,
    maxInputBytes: 1_000,
    maxOutputBytes: 1_000,
    maxCandidates: 1,
    maxObjects: 1,
    maxSupplementarySearches: 0,
    maxCorrections: 0,
    maxTransientRetries: 0,
    maxConcurrentActions: 1,
    maxWallClockMs: 1_000,
  },
  budgetLedger: {
    schemaVersion: "1",
    reserved: emptyAgentBudgetUsage(),
    used: emptyAgentBudgetUsage(),
    activeWallClockMs: 0,
    currentConcurrency: 0,
    ledgerVersion: 1,
    changedAt: "2030-01-01T00:00:00.000Z",
  },
} as unknown as AgentTaskSnapshotV1;
const toolRef = { entityId: "cleaning-tool", versionId: "1" };
const definition = (
  execute: (signal: AbortSignal) => Promise<AgentDomainToolResultV1> = async () => ({
    observationArtifactRef: artifact,
    effect: "uncertain",
  }),
  recover?: AgentTaskDefinitionV1["tools"][number]["recover"],
): AgentTaskDefinitionV1 => ({
  metadata: {
    schemaVersion: "1",
    definitionRef: { entityId: "definition", versionId: "1" },
    taskType: "data-cleaning",
    toolPolicyRef: taskRef.toolPolicyRef,
    incrementSchemaRef: taskRef.incrementSchemaRef,
    validationPolicyRef: taskRef.validationPolicyRef,
    supportedTriggerModes: ["embedded"],
    allowedToolRefs: [toolRef],
    resultFamilies: ["content-artifact"],
  },
  budgetPolicy: {
    schemaVersion: "1",
    policyRef: taskRef.budgetPolicyRef,
    modelDeploymentRef: taskRef.modelDeploymentRef,
    promptTemplateRef: taskRef.promptTemplateRef,
    toolPolicyRef: taskRef.toolPolicyRef,
    maxModelInvocations: 1,
    maxToolInvocations: 1,
    maxContextTokens: 100,
    maxInputBytes: 1000,
    maxOutputBytes: 1000,
    maxCandidates: 1,
    maxObjects: 1,
    maxSupplementarySearches: 0,
    maxCorrections: 0,
    maxTransientRetries: 0,
    maxConcurrentActions: 1,
    maxWallClockMs: 1000,
  },
  actionSchema: z.strictObject({ operation: z.literal("candidate") }),
  incrementSchema: z.strictObject({ operation: z.literal("candidate") }),
  candidateSchema: z.strictObject({ operation: z.literal("candidate") }),
  tools: [
    {
      toolRef,
      budgetUsage: {},
      execute: async (_input, context) => execute(context.signal!),
      ...(recover === undefined ? {} : { recover }),
    },
  ],
  measureCandidateUsage: () => ({ candidates: 1, objects: 1 }),
  validateCandidate: () => ({
    schemaVersion: "1",
    items: [],
    disposition: "accepted",
    validationArtifactRef: {
      kind: "diagnostic-artifact",
      reference: { entityId: "validation", versionId: `sha256:${"a".repeat(64)}` },
    },
    validatedAt: "2030-01-01T00:00:00.000Z",
  }),
  finalizeCandidate: (_candidate, context) =>
    buildCompletedAgentTaskResult(context.envelope.agentTaskRef, artifact),
});

const claim: AgentTaskClaimV1 = {
  task,
  attemptNumber: 1,
  workerId: "worker-1",
  leaseToken: "lease-1",
  leaseUntil: "2030-01-01T00:00:30.000Z",
};

const reservation = {
  schemaVersion: "1" as const,
  reservationId: "reservation-1",
  actionId: "agent-task:project-1:task-1:action:1",
  amount: { ...emptyAgentBudgetUsage(), toolInvocations: 1 },
  concurrency: 1,
  reservedAt: "2030-01-01T00:00:00.000Z",
};

const artifact = {
  kind: "content-artifact" as const,
  reference: { entityId: "cleaned", versionId: `sha256:${"a".repeat(64)}` },
};
const recoveryIntent = new TextEncoder().encode(
  JSON.stringify({ toolRef, input: { operation: "candidate" } }),
);
const recoveryArtifactStore = {
  open: async () => ({
    manifest: {} as never,
    content: (async function* () {
      yield recoveryIntent;
    })(),
    verified: Promise.resolve({} as never),
  }),
} as unknown as ArtifactStoreV1;

const makeStore = (overrides: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  let claimed = true;
  const store = {
    calls,
    async claim() {
      if (!claimed) return undefined;
      claimed = false;
      return claim;
    },
    async verifyWorker() {
      calls.push("verify");
    },
    async findAction() {
      return undefined;
    },
    async reserveAction(input: {
      actionId: string;
      reservationId: string;
      actionType: AgentTaskActionV1["actionType"];
      amount?: Partial<typeof reservation.amount>;
    }) {
      calls.push("reserve");
      const amount = { ...emptyAgentBudgetUsage(), ...input.amount };
      if (input.actionType === "model-invocation") amount.modelInvocations = 1;
      if (input.actionType === "domain-tool") amount.toolInvocations = 1;
      return {
        task,
        reservation: {
          ...reservation,
          reservationId: input.reservationId,
          actionId: input.actionId,
          amount,
        },
      };
    },
    async heartbeat() {
      calls.push("heartbeat");
      return "2030-01-01T00:00:30.000Z";
    },
    async recordCandidate() {
      calls.push("candidate");
    },
    async completeAction() {
      calls.push("complete-action");
      return task;
    },
    async completeTask() {
      calls.push("complete-task");
      return task;
    },
    async failAction() {
      calls.push("fail");
      return task;
    },
    async releaseLease() {
      calls.push("release");
    },
    async failTask() {
      calls.push("fail-task");
      return task;
    },
    ...overrides,
  } as unknown as AgentTaskExecutionStoreV1 & { calls: string[] };
  return store;
};

describe("agent runtime worker", () => {
  it("propagates cancellation and records uncertain effects without retry", async () => {
    const store = makeStore();
    const signal = new AbortController().signal;
    const executeStep = vi.fn(async (received: AbortSignal) => {
      expect(received.aborted).toBe(false);
      return {
        observationArtifactRef: artifact,
        effect: "uncertain" as const,
      };
    });
    const runner = new AgentRuntimeRunner({
      store,
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      maxConcurrentTasks: 1,
      renderModelStep: () => ({
        messages: [],
        maxOutputTokens: 1,
        domainTool: { toolRef, input: { operation: "candidate" } },
      }),
      registry: new AgentTaskDefinitionRegistry([definition(executeStep)]),
      persistArtifact: async () => artifact,
      now: () => "2030-01-01T00:00:01.000Z",
    });
    expect(await runner.runOnce(signal)).toBe(1);
    expect(executeStep).toHaveBeenCalledOnce();
    expect(store.calls).toContain("fail");
    expect(store.calls).toContain("release");
  });

  it("persists the intent artifact before reserving budget", async () => {
    const store = makeStore();
    const persistArtifact = vi.fn(async ({ purposeCode }: { purposeCode: string }) => {
      if (purposeCode === "agent-action-intent") throw new Error("artifact unavailable");
      return artifact;
    });
    const runner = new AgentRuntimeRunner({
      store,
      registry: new AgentTaskDefinitionRegistry([definition()]),
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      maxConcurrentTasks: 1,
      renderModelStep: () => ({
        messages: [],
        maxOutputTokens: 1,
        domainTool: { toolRef, input: { operation: "candidate" } },
      }),
      persistArtifact,
      now: () => "2030-01-01T00:00:01.000Z",
    });
    expect(await runner.runOnce()).toBe(1);
    expect(persistArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ purposeCode: "agent-action-intent" }),
    );
    expect(store.calls).not.toContain("reserve");
    expect(store.calls).not.toContain("intent");
    expect(store.calls).toContain("release");
  });

  it("renews the lease while a tool action is running", async () => {
    const store = makeStore();
    const executeStep = vi.fn(
      (received: AbortSignal) =>
        new Promise<AgentDomainToolResultV1>((resolve, reject) => {
          const timer = setTimeout(
            () => resolve({ observationArtifactRef: artifact, effect: "uncertain" }),
            50,
          );
          received.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new Error("unexpected abort"));
            },
            { once: true },
          );
        }),
    );
    const runner = new AgentRuntimeRunner({
      store,
      workerId: "worker-1",
      leaseDurationMs: 30,
      maxConcurrentTasks: 1,
      renderModelStep: () => ({
        messages: [],
        maxOutputTokens: 1,
        domainTool: { toolRef, input: { operation: "candidate" } },
      }),
      registry: new AgentTaskDefinitionRegistry([definition(executeStep)]),
      persistArtifact: async () => artifact,
      now: () => "2030-01-01T00:00:01.000Z",
    });
    expect(await runner.runOnce()).toBe(1);
    expect(store.calls.filter((call) => call === "heartbeat").length).toBeGreaterThanOrEqual(4);
  });

  it("aborts a tool when the durable task requests cancellation", async () => {
    let reads = 0;
    const store = makeStore({
      async getTask() {
        reads += 1;
        return {
          ...task,
          state: { latestCandidateVersion: 0, status: "running", cancelRequested: reads > 0 },
        } as AgentTaskSnapshotV1;
      },
    });
    const executeStep = vi.fn(
      (received: AbortSignal) =>
        new Promise<AgentDomainToolResultV1>((resolve) => {
          received.addEventListener(
            "abort",
            () => resolve({ observationArtifactRef: artifact, effect: "uncertain" }),
            { once: true },
          );
        }),
    );
    const runner = new AgentRuntimeRunner({
      store,
      workerId: "worker-1",
      leaseDurationMs: 30,
      maxConcurrentTasks: 1,
      renderModelStep: () => ({
        messages: [],
        maxOutputTokens: 1,
        domainTool: { toolRef, input: { operation: "candidate" } },
      }),
      registry: new AgentTaskDefinitionRegistry([definition(executeStep)]),
      persistArtifact: async () => artifact,
      now: () => "2030-01-01T00:00:01.000Z",
    });
    expect(await runner.runOnce()).toBe(1);
    expect(executeStep).toHaveBeenCalledOnce();
    expect(store.calls).toContain("fail");
    expect(store.calls).not.toContain("complete-action");
  });

  it("reuses a completed action instead of invoking the step again", async () => {
    const store = makeStore({
      async findAction() {
        return { status: "completed", resultRef: artifact } as AgentTaskActionV1;
      },
    });
    const runner = new AgentRuntimeRunner({
      store,
      registry: new AgentTaskDefinitionRegistry([definition()]),
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      maxConcurrentTasks: 1,
      persistArtifact: async () => artifact,
      now: () => "2030-01-01T00:00:01.000Z",
    });
    expect(await runner.runOnce()).toBe(1);
    expect(store.calls).toContain("complete-task");
  });
  it("recovers an idempotent started action through the recovery port", async () => {
    const store = makeStore({
      async findAction() {
        return {
          status: "started",
          actionType: "domain-tool",
          reservation,
          intentArtifactRef: artifact,
        } as AgentTaskActionV1;
      },
    });
    const recoverStep = vi.fn(async () => ({
      observationArtifactRef: artifact,
      effect: "committed" as const,
      resultRef: artifact,
    }));
    const runner = new AgentRuntimeRunner({
      store,
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      maxConcurrentTasks: 1,
      registry: new AgentTaskDefinitionRegistry([
        definition(
          async () => ({
            observationArtifactRef: artifact,
            effect: "uncertain",
          }),
          recoverStep,
        ),
      ]),
      persistArtifact: async () => artifact,
      artifactStore: recoveryArtifactStore,
      now: () => "2030-01-01T00:00:01.000Z",
    });
    expect(await runner.runOnce()).toBe(1);
    expect(recoverStep).toHaveBeenCalledWith(
      { operation: "candidate" },
      expect.objectContaining({ actionId: reservation.actionId }),
    );
    expect(store.calls).toContain("complete-action");
    expect(store.calls).toContain("complete-task");
  });

  it("returns a read-only tool observation to the model before finalizing", async () => {
    const actionRef = {
      kind: "diagnostic-artifact" as const,
      reference: { entityId: "raw-model-response", versionId: `sha256:${"b".repeat(64)}` },
    };
    const gateway = {
      completeStructured: vi.fn(async (request) => ({
        schemaVersion: "1" as const,
        invocationId: request.invocationId,
        modelDeploymentRef: request.modelDeploymentRef,
        serverBuildRef: { entityId: "server", versionId: "1" },
        modelVersionRef: { entityId: "model-version", versionId: "1" },
        usage: { available: true, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        rawResponseRef: actionRef,
        promptTemplateRef: request.promptTemplateRef,
        outputSchemaRef: request.outputSchemaRef,
        value: { operation: "candidate" },
        finishReason: "stop" as const,
      })),
    } as unknown as ModelGatewayPortV1;
    const executeStep = vi.fn(async () => ({
      observationArtifactRef: artifact,
      effect: "none" as const,
    }));
    const interpretModelStep = vi
      .fn()
      .mockReturnValueOnce({
        kind: "tool-request",
        toolRef,
        toolInput: { operation: "candidate" },
      })
      .mockReturnValueOnce({
        kind: "completed",
        candidate: {
          schemaVersion: "1",
          taskRef,
          candidateVersion: 1,
          parentCandidateVersion: 0,
          candidateArtifactRef: artifact,
          incrementArtifactRef: artifact,
          disposition: "pending",
          createdAt: "2030-01-01T00:00:02.000Z",
        },
        candidatePayload: { operation: "candidate" },
        increment: { operation: "candidate" },
      });
    const renderModelStep = vi.fn(() => ({
      messages: [{ role: "user" as const, content: "continue" }],
      maxOutputTokens: 1,
    }));
    const store = makeStore();
    const runner = new AgentRuntimeRunner({
      store,
      registry: new AgentTaskDefinitionRegistry([definition(executeStep)]),
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      maxConcurrentTasks: 1,
      modelGateway: gateway,
      renderModelStep,
      interpretModelStep,
      persistArtifact: async () => artifact,
      now: () => "2030-01-01T00:00:01.000Z",
    });

    expect(await runner.runOnce()).toBe(1);
    expect(gateway.completeStructured).toHaveBeenCalledTimes(2);
    expect(executeStep).toHaveBeenCalledOnce();
    expect(renderModelStep.mock.calls[1]?.[2]).toEqual({
      previousObservationArtifactRef: artifact,
    });
    expect(store.calls.filter((call) => call === "complete-action")).toHaveLength(3);
    expect(store.calls).toContain("candidate");
    expect(store.calls).toContain("complete-task");
  });

  it("propagates the caller abort signal to the active tool", async () => {
    const controller = new AbortController();
    const executeStep = vi.fn(
      (received: AbortSignal) =>
        new Promise<AgentDomainToolResultV1>((_resolve, reject) => {
          received.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        }),
    );
    const store = makeStore();
    const runner = new AgentRuntimeRunner({
      store,
      registry: new AgentTaskDefinitionRegistry([definition(executeStep)]),
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      maxConcurrentTasks: 1,
      renderModelStep: () => ({
        messages: [],
        maxOutputTokens: 1,
        domainTool: { toolRef, input: { operation: "candidate" } },
      }),
      persistArtifact: async () => artifact,
      now: () => "2030-01-01T00:00:01.000Z",
    });

    const running = runner.runOnce(controller.signal);
    await vi.waitFor(() => expect(executeStep).toHaveBeenCalledOnce());
    controller.abort();
    expect(await running).toBe(1);
    expect(store.calls).toContain("fail");
    expect(store.calls).toContain("release");
  });

  it("aborts and records an action that reaches the hard wall-clock limit", async () => {
    const timeoutTask = {
      ...task,
      budgetPolicy: { ...task.budgetPolicy, maxWallClockMs: 20 },
    } as AgentTaskSnapshotV1;
    const timeoutClaim = { ...claim, task: timeoutTask };
    let capturedFailure:
      | { readonly error: { readonly code: string }; readonly activeWallClockMs?: number }
      | undefined;
    const store = makeStore({
      async claim() {
        return timeoutClaim;
      },
      async reserveAction(input: {
        actionId: string;
        reservationId: string;
        actionType: AgentTaskActionV1["actionType"];
        amount?: Partial<typeof reservation.amount>;
      }) {
        const amount = { ...emptyAgentBudgetUsage(), ...input.amount, toolInvocations: 1 };
        return {
          task: timeoutTask,
          reservation: {
            ...reservation,
            reservationId: input.reservationId,
            actionId: input.actionId,
            amount,
          },
        };
      },
      async failAction(input: typeof capturedFailure) {
        capturedFailure = input;
        return timeoutTask;
      },
    });
    const executeStep = vi.fn(
      (received: AbortSignal) =>
        new Promise<AgentDomainToolResultV1>((_resolve, reject) => {
          received.addEventListener(
            "abort",
            () => reject(new DOMException("timeout", "AbortError")),
            { once: true },
          );
        }),
    );
    const runner = new AgentRuntimeRunner({
      store,
      registry: new AgentTaskDefinitionRegistry([definition(executeStep)]),
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      maxConcurrentTasks: 1,
      renderModelStep: () => ({
        messages: [],
        maxOutputTokens: 1,
        domainTool: { toolRef, input: { operation: "candidate" } },
      }),
      persistArtifact: async () => artifact,
      now: () => "2030-01-01T00:00:01.000Z",
    });

    expect(await runner.runOnce()).toBe(1);
    expect(capturedFailure?.error.code).toBe("AGENT_WALL_CLOCK_EXCEEDED");
    expect(capturedFailure?.activeWallClockMs).toBeGreaterThanOrEqual(20);
  });

  it("does not leave an unauthorized claim retrying forever", async () => {
    const store = makeStore({
      async verifyWorker() {
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_AUTHORIZATION_DENIED",
            category: "authorization",
            stage: "test.authorization",
            taskRef,
          }),
        );
      },
    });
    const runner = new AgentRuntimeRunner({
      store,
      registry: new AgentTaskDefinitionRegistry([definition()]),
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      maxConcurrentTasks: 1,
      renderModelStep: () => ({
        messages: [],
        maxOutputTokens: 1,
        domainTool: { toolRef, input: { operation: "candidate" } },
      }),
      now: () => "2030-01-01T00:00:01.000Z",
    });
    expect(await runner.runOnce()).toBe(1);
    expect(store.calls).toContain("fail-task");
    expect(store.calls).not.toContain("reserve");
  });

  it("runs the whole claimed execution inside the host task scope", async () => {
    const scope = new AsyncLocalStorage<string>();
    const observed: string[] = [];
    const observe = () => {
      observed.push(scope.getStore() ?? "none");
    };
    const base = definition(async () => {
      observe();
      return { observationArtifactRef: artifact, effect: "none" as const };
    });
    const scopedDefinition: AgentTaskDefinitionV1 = {
      ...base,
      validateCandidate: (...input) => {
        observe();
        return base.validateCandidate(...input);
      },
      finalizeCandidate: (candidate, context) => {
        observe();
        return buildCompletedAgentTaskResult(context.envelope.agentTaskRef, artifact);
      },
    };
    const gateway = {
      completeStructured: vi.fn(async (request) => ({
        schemaVersion: "1" as const,
        invocationId: request.invocationId,
        modelDeploymentRef: request.modelDeploymentRef,
        serverBuildRef: { entityId: "server", versionId: "1" },
        modelVersionRef: { entityId: "model-version", versionId: "1" },
        usage: { available: true, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        rawResponseRef: artifact,
        promptTemplateRef: request.promptTemplateRef,
        outputSchemaRef: request.outputSchemaRef,
        value: { operation: "candidate" },
        finishReason: "stop" as const,
      })),
    } as unknown as ModelGatewayPortV1;
    const interpretModelStep = vi
      .fn()
      .mockReturnValueOnce({ kind: "tool-request", toolRef, toolInput: { operation: "candidate" } })
      .mockReturnValueOnce({
        kind: "completed",
        candidate: {
          schemaVersion: "1",
          taskRef,
          candidateVersion: 1,
          parentCandidateVersion: 0,
          candidateArtifactRef: artifact,
          incrementArtifactRef: artifact,
          disposition: "pending",
          createdAt: "2030-01-01T00:00:02.000Z",
        },
        candidatePayload: { operation: "candidate" },
        increment: { operation: "candidate" },
      });
    const scopedTasks: string[] = [];
    const store = makeStore();
    const runner = new AgentRuntimeRunner({
      store,
      registry: new AgentTaskDefinitionRegistry([scopedDefinition]),
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      maxConcurrentTasks: 1,
      modelGateway: gateway,
      renderModelStep: () => ({ messages: [], maxOutputTokens: 1 }),
      interpretModelStep,
      persistArtifact: async () => artifact,
      runTask: async (claimed, operation) => {
        scopedTasks.push(claimed.envelope.agentTaskRef.reference.entityId);
        await scope.run(claimed.envelope.agentTaskRef.reference.entityId, operation);
      },
      now: () => "2030-01-01T00:00:01.000Z",
    });

    expect(await runner.runOnce()).toBe(1);
    expect(scopedTasks).toEqual(["agent-task:project-1:task-1"]);
    // 工具执行与候选校验/收口都在同一作用域内，证明包裹的是完整执行而非仅模型步。
    expect(observed).toEqual(Array<string>(3).fill("agent-task:project-1:task-1"));
    expect(store.calls).toContain("complete-task");
  });

  it("leaves the claim to expire when the host scope cannot be established", async () => {
    const store = makeStore();
    const executeStep = vi.fn(async () => ({
      observationArtifactRef: artifact,
      effect: "none" as const,
    }));
    const runner = new AgentRuntimeRunner({
      store,
      registry: new AgentTaskDefinitionRegistry([definition(executeStep)]),
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      maxConcurrentTasks: 1,
      persistArtifact: async () => artifact,
      runTask: async () => {
        throw new Error("scope unavailable");
      },
      now: () => "2030-01-01T00:00:01.000Z",
    });

    await expect(runner.runOnce()).rejects.toThrow("scope unavailable");
    expect(executeStep).not.toHaveBeenCalled();
    expect(store.calls).toEqual([]);
  });
});
