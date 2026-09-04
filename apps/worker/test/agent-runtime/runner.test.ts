import { describe, expect, it, vi } from "vitest";

import {
  AgentTaskDefinitionRegistry,
  AgentRuntimeError,
  emptyAgentBudgetUsage,
  makeAgentError,
  type AgentTaskDefinitionV1,
  type AgentTaskSnapshotV1,
  type AgentStructuredErrorV1,
} from "@riskflow/core/agent-runtime";
import { z } from "@riskflow/core/model";
import type { AgentTaskActionV1 } from "@riskflow/core/agent-runtime";
import type { AgentTaskRefV1 } from "@riskflow/contracts/ports";
import { AgentRuntimeRunner, type AgentStepOutcomeV1 } from "../../src/agent-runtime/index.js";
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
  envelope: { agentTaskRef: taskRef },
  state: { latestCandidateVersion: 0 },
} as unknown as AgentTaskSnapshotV1;
const definition = (): AgentTaskDefinitionV1 => ({
  metadata: {
    schemaVersion: "1",
    definitionRef: { entityId: "definition", versionId: "1" },
    taskType: "data-cleaning",
    toolPolicyRef: taskRef.toolPolicyRef,
    incrementSchemaRef: taskRef.incrementSchemaRef,
    validationPolicyRef: taskRef.validationPolicyRef,
    supportedTriggerModes: ["embedded"],
    allowedToolRefs: [],
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
  tools: [],
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
    async reserveAction() {
      calls.push("reserve");
      return { task, reservation };
    },
    async recordActionIntent() {
      calls.push("intent");
      return {} as AgentTaskActionV1;
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
    const executeStep = vi.fn(async ({ signal: received }: { signal: AbortSignal }) => {
      expect(received.aborted).toBe(false);
      return {
        kind: "uncertain" as const,
        error: makeAgentError({
          code: "AGENT_ACTION_UNCERTAIN",
          category: "action",
          retryable: false,
          stage: "test",
          taskRef,
          actionId: "agent-task:project-1:task-1:action:1",
        }),
      };
    });
    const runner = new AgentRuntimeRunner({
      store,
      registry: new AgentTaskDefinitionRegistry([definition()]),
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      maxConcurrentTasks: 1,
      executeStep,
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
      executeStep: vi.fn(),
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
      ({ signal: received }: { signal: AbortSignal }) =>
        new Promise<{
          readonly kind: "uncertain";
          readonly error: AgentStructuredErrorV1;
        }>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              resolve({
                kind: "uncertain",
                error: makeAgentError({
                  code: "AGENT_ACTION_UNCERTAIN",
                  category: "action",
                  retryable: false,
                  stage: "test",
                  taskRef,
                  actionId: "agent-task:project-1:task-1:action:1",
                }),
              }),
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
      registry: new AgentTaskDefinitionRegistry([definition()]),
      workerId: "worker-1",
      leaseDurationMs: 30,
      maxConcurrentTasks: 1,
      executeStep,
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
      ({ signal: received }: { signal: AbortSignal }) =>
        new Promise<AgentStepOutcomeV1>((resolve) => {
          received.addEventListener(
            "abort",
            () =>
              resolve({
                kind: "uncertain",
                error: makeAgentError({
                  code: "AGENT_CANCELLED",
                  category: "cancelled",
                  retryable: false,
                  stage: "test.cancelled",
                  taskRef,
                }),
              }),
            { once: true },
          );
        }),
    );
    const runner = new AgentRuntimeRunner({
      store,
      registry: new AgentTaskDefinitionRegistry([definition()]),
      workerId: "worker-1",
      leaseDurationMs: 30,
      maxConcurrentTasks: 1,
      executeStep,
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
    const executeStep = vi.fn();
    const runner = new AgentRuntimeRunner({
      store,
      registry: new AgentTaskDefinitionRegistry([definition()]),
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      maxConcurrentTasks: 1,
      executeStep,
      persistArtifact: async () => artifact,
      now: () => "2030-01-01T00:00:01.000Z",
    });
    expect(await runner.runOnce()).toBe(1);
    expect(executeStep).not.toHaveBeenCalled();
    expect(store.calls).toContain("complete-task");
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
      executeStep: vi.fn(),
      now: () => "2030-01-01T00:00:01.000Z",
    });
    expect(await runner.runOnce()).toBe(1);
    expect(store.calls).toContain("fail-task");
    expect(store.calls).not.toContain("reserve");
  });
});
