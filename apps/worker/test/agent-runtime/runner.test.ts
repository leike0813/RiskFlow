import { describe, expect, it, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";

import {
  AgentTaskDefinitionRegistry,
  AgentRuntimeError,
  buildCompletedAgentTaskResult,
  emptyAgentBudgetUsage,
  makeAgentError,
  reserveAgentBudget,
  type AgentTaskDefinitionV1,
  type AgentDomainToolResultV1,
  type AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import { z, ModelGatewayError, modelGatewayError } from "@riskflow/core/model";
import type { ModelGatewayPortV1 } from "@riskflow/core/model";
import { makeArtifactError, type ArtifactStoreV1 } from "@riskflow/core/artifacts";
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
    completed: Promise.resolve({} as never),
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
  it.each(["direct", "after-tool", "wrong-task", "wrong-action", "wrong-candidate-task"])(
    "恢复完整候选校验且保持原证据：%s",
    async (scenario) => {
      const current = structuredClone(task);
      const records = new Map<string, unknown>();
      const actions = new Map<string, AgentTaskActionV1>();
      const candidatePayload = { operation: "candidate" };
      const validation = {
        schemaVersion: "1" as const,
        items: [
          {
            checkId: "entry-1",
            disposition: "rejected" as const,
            rejectionClass: "repairable" as const,
            reasonCode: "field-format-invalid",
            evidenceReferences: [],
          },
        ],
        disposition: "rejected" as const,
        rejectionClass: "repairable" as const,
        validationArtifactRef: artifact,
        validatedAt: "2030-01-01T00:00:00.000Z",
      };
      const candidate = {
        schemaVersion: "1" as const,
        taskRef,
        candidateVersion: 1,
        parentCandidateVersion: 0,
        candidateArtifactRef: {
          ...artifact,
          reference: { ...artifact.reference, entityId: "candidate-1" },
        },
        incrementArtifactRef: artifact,
        disposition: "pending" as const,
        createdAt: "2030-01-01T00:00:00.000Z",
      };
      records.set("candidate-1", candidatePayload);
      const failTask = vi.fn(async () => current);
      const recordCandidate = vi.fn(async ({ candidate: value }) => {
        current.state = { ...current.state, latestCandidateVersion: value.candidateVersion };
      });
      const store = makeStore({
        claim: async () => ({ ...claim, task: current }),
        findAction: async (_ref, id) => actions.get(id),
        recordCandidate,
        failTask,
        failAction: async (input) => {
          actions.set(input.actionId, {
            actionId: input.actionId,
            actionType: "model-invocation",
            status: "failed",
            sequence: 1,
            errorCode: input.error.code,
            resultArtifactRef: input.resultArtifactRef,
          } as AgentTaskActionV1);
          return current;
        },
      });
      const gateway = {
        completeStructured: vi.fn(async (request) => ({
          schemaVersion: "1",
          invocationId: request.invocationId,
          modelDeploymentRef: request.modelDeploymentRef,
          promptTemplateRef: request.promptTemplateRef,
          outputSchemaRef: request.outputSchemaRef,
          serverBuildRef: { entityId: "server", versionId: "1" },
          modelVersionRef: { entityId: "model", versionId: "1" },
          usage: { available: true, inputTokens: 4, outputTokens: 2, totalTokens: 6 },
          rawResponseRef: artifact,
          value: candidatePayload,
          finishReason: "stop",
        })),
      } as unknown as ModelGatewayPortV1;
      const runner = new AgentRuntimeRunner({
        store,
        registry: new AgentTaskDefinitionRegistry([
          { ...definition(), validateCandidate: () => validation },
        ]),
        workerId: "worker-1",
        leaseDurationMs: 30_000,
        maxConcurrentTasks: 1,
        modelGateway: gateway,
        renderModelStep: () => ({
          messages: [{ role: "user", content: "clean" }],
          maxOutputTokens: 10,
        }),
        interpretModelStep: () => ({
          kind: "completed",
          candidate,
          candidatePayload,
          increment: candidatePayload,
          usage: emptyAgentBudgetUsage(),
        }),
        persistArtifact: async ({ actionId, purposeCode, value }) => {
          const id = `${actionId}:${purposeCode}`;
          records.set(id, value);
          return { ...artifact, reference: { ...artifact.reference, entityId: id } };
        },
        artifactStore: {
          open: async (request) => ({
            manifest: {} as never,
            content: (async function* () {
              yield new TextEncoder().encode(
                JSON.stringify(records.get(request.artifactRef.reference.entityId)),
              );
            })(),
            completed: Promise.resolve({} as never),
          }),
        } as unknown as ArtifactStoreV1,
        now: () => "2030-01-01T00:00:01.000Z",
      });
      await runner.runOnce();
      const firstActionId = `${taskRef.reference.entityId}:action:1`;
      const feedback = records.get(`${firstActionId}:candidate-feedback:agent-action-result`) as {
        taskRef: AgentTaskRefV1;
        actionId: string;
        actionResultArtifactRef: typeof artifact;
        candidateFeedback: typeof candidate & { validation: typeof validation };
      };
      expect(recordCandidate).toHaveBeenCalledWith(
        expect.objectContaining({
          candidate: expect.objectContaining({ validation, disposition: "rejected" }),
        }),
      );
      expect(feedback.actionResultArtifactRef.reference.entityId).toBe(
        `${firstActionId}:agent-action-result`,
      );
      expect(records.get(feedback.actionResultArtifactRef.reference.entityId)).toMatchObject({
        rawResponseRef: artifact,
      });
      if (scenario === "after-tool") {
        const requestRef = {
          ...artifact,
          reference: { ...artifact.reference, entityId: "tool-request" },
        };
        const observationRef = {
          ...artifact,
          reference: { ...artifact.reference, entityId: "tool-observation" },
        };
        records.set("tool-request", {
          disposition: "tool-request",
          toolRef,
          toolInput: candidatePayload,
        });
        records.set("tool-observation", { observationArtifactRef: artifact });
        actions.set(`${taskRef.reference.entityId}:action:2`, {
          actionType: "model-invocation",
          status: "completed",
          resultArtifactRef: requestRef,
        } as AgentTaskActionV1);
        actions.set(`${taskRef.reference.entityId}:action:3`, {
          actionType: "domain-tool",
          status: "completed",
          resultArtifactRef: observationRef,
        } as AgentTaskActionV1);
      }
      if (scenario === "wrong-task")
        feedback.taskRef = {
          ...taskRef,
          modelDeploymentRef: { entityId: "other", versionId: "1" },
        };
      if (scenario === "wrong-action") feedback.actionId = "other-action";
      if (scenario === "wrong-candidate-task")
        feedback.candidateFeedback.taskRef = {
          ...taskRef,
          promptTemplateRef: { entityId: "other", versionId: "1" },
        };
      const invalid = scenario.startsWith("wrong-");
      await runner.runOnce();
      if (invalid) {
        expect(gateway.completeStructured).toHaveBeenCalledTimes(1);
        expect(failTask).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({ code: "AGENT_ARTIFACT_FAILURE", retryable: false }),
          }),
        );
      } else {
        expect(gateway.completeStructured).toHaveBeenCalledTimes(2);
        const requests = vi.mocked(gateway.completeStructured).mock.calls;
        const feedbackMessage = requests[1]![0].messages
          .map((message) => {
            try {
              return JSON.parse(message.content);
            } catch {
              return undefined;
            }
          })
          .find((value) => value?.validationFeedback !== undefined);
        expect(feedbackMessage.validationFeedback.previousCandidate).toEqual({
          candidateVersion: 1,
          candidate: candidatePayload,
          validation,
        });
      }
    },
  );

  it.each([0, 1])("模型纠错使用新行动且受剩余纠错预算%s约束", async (maxCorrections) => {
    const failedAction = Object.freeze({
      actionId: `${taskRef.reference.entityId}:action:1`,
      sequence: 1,
      actionType: "model-invocation",
      status: "failed",
      errorCode: "AGENT_VALIDATION_REJECTED",
    }) as AgentTaskActionV1;
    const current = structuredClone(task);
    current.budgetPolicy = { ...current.budgetPolicy, maxCorrections };
    current.budgetLedger = {
      ...current.budgetLedger,
      used: {
        ...current.budgetLedger.used,
        modelInvocations: 1,
        inputTokens: 4,
        outputTokens: 2,
        contextTokens: 6,
      },
    };
    const reserve = vi.fn(
      async (input: Parameters<AgentTaskExecutionStoreV1["reserveAction"]>[0]) => {
        const budget = reserveAgentBudget(current.budgetPolicy, current.budgetLedger, input);
        return {
          task: { ...current, budgetLedger: budget.ledger },
          reservation: budget.reservation,
        };
      },
    );
    const completeAction = vi.fn(async () => current);
    const failAction = vi.fn(async () => current);
    const store = makeStore({
      claim: vi
        .fn()
        .mockResolvedValueOnce({ ...claim, task: current, attemptNumber: 2 })
        .mockResolvedValue(undefined),
      findAction: async (_ref: AgentTaskRefV1, actionId: string) =>
        actionId === failedAction.actionId ? failedAction : undefined,
      reserveAction: reserve,
      completeAction,
      failAction,
    });
    const gateway = {
      completeStructured: vi.fn(async (request) => ({
        schemaVersion: "1",
        invocationId: request.invocationId,
        modelDeploymentRef: request.modelDeploymentRef,
        promptTemplateRef: request.promptTemplateRef,
        outputSchemaRef: request.outputSchemaRef,
        serverBuildRef: { entityId: "server", versionId: "1" },
        modelVersionRef: { entityId: "model", versionId: "1" },
        usage: { available: true, inputTokens: 4, outputTokens: 2, totalTokens: 6 },
        rawResponseRef: artifact,
        value: { operation: "candidate" },
        finishReason: "stop",
      })),
    } as unknown as ModelGatewayPortV1;
    const originalInput = `${failedAction.actionId}:agent-model-input`;
    const persisted = new Map<string, unknown>([[originalInput, { original: true }]]);
    const runner = new AgentRuntimeRunner({
      store,
      registry: new AgentTaskDefinitionRegistry([definition()]),
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      maxConcurrentTasks: 1,
      modelGateway: gateway,
      renderModelStep: () => ({
        messages: [{ role: "user", content: "clean" }],
        maxOutputTokens: 10,
      }),
      interpretModelStep: () => ({
        kind: "completed",
        candidate: {
          schemaVersion: "1",
          taskRef,
          candidateVersion: 1,
          parentCandidateVersion: 0,
          candidateArtifactRef: artifact,
          incrementArtifactRef: artifact,
          disposition: "pending",
          createdAt: "2030-01-01T00:00:01.000Z",
        },
        candidatePayload: { operation: "candidate" },
        increment: { operation: "candidate" },
        usage: emptyAgentBudgetUsage(),
      }),
      persistArtifact: async ({ actionId, purposeCode, value }) => {
        const key = `${actionId}:${purposeCode}`;
        if (persisted.has(key)) expect(value).toEqual(persisted.get(key));
        persisted.set(key, value);
        return artifact;
      },
      now: () => "2030-01-01T00:00:01.000Z",
    });
    expect(await runner.runOnce()).toBe(1);
    expect(persisted.get(originalInput)).toEqual({ original: true });
    expect(failedAction.status).toBe("failed");
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: `${taskRef.reference.entityId}:action:2`,
        amount: expect.objectContaining({ corrections: 1 }),
      }),
    );
    if (maxCorrections === 0) {
      expect(gateway.completeStructured).not.toHaveBeenCalled();
      expect(completeAction).not.toHaveBeenCalled();
    } else {
      expect(failAction).not.toHaveBeenCalled();
      expect(gateway.completeStructured).toHaveBeenCalledOnce();
      expect(gateway.completeStructured).toHaveBeenCalledWith(
        expect.objectContaining({
          invocationId: `${taskRef.reference.entityId}:action:2`,
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining("AGENT_VALIDATION_REJECTED"),
            }),
          ]),
        }),
        expect.anything(),
        expect.anything(),
      );
      expect(completeAction).toHaveBeenCalledWith(
        expect.objectContaining({
          usage: expect.objectContaining({
            corrections: 1,
            modelInvocations: 1,
            inputTokens: 4,
            outputTokens: 2,
          }),
        }),
      );
      expect(failAction).not.toHaveBeenCalled();
      expect(store.calls).toContain("complete-task");
    }
  });

  it.each(
    (
      [
        "ARTIFACT_ACCESS_DENIED",
        "ARTIFACT_INTEGRITY_FAILURE",
        "ARTIFACT_IDEMPOTENCY_CONFLICT",
      ] as const
    ).flatMap((code) => (["completed", "started"] as const).map((status) => ({ code, status }))),
  )("terminates unreadable recovery evidence: $code/$status", async ({ code, status }) => {
    let failure;
    let terminal = false;
    const store = makeStore({
      claim: async () => (terminal ? undefined : claim),
      findAction: async () =>
        ({
          status,
          actionType: status === "completed" ? "model-invocation" : "domain-tool",
          resultArtifactRef: artifact,
          intentArtifactRef: artifact,
        }) as AgentTaskActionV1,
      failTask: async (input) => {
        failure = input.error;
        terminal = true;
        return task;
      },
    });
    const execute = vi.fn();
    const runner = new AgentRuntimeRunner({
      store,
      registry: new AgentTaskDefinitionRegistry([definition(execute)]),
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      maxConcurrentTasks: 1,
      artifactStore: {
        open: async () => {
          throw makeArtifactError(code, "test.recovery");
        },
      } as unknown as ArtifactStoreV1,
      now: () => "2030-01-01T00:00:01.000Z",
    });
    expect(await runner.runOnce()).toBe(1);
    expect(await runner.runOnce()).toBe(0);
    expect(failure).toMatchObject({
      code:
        code === "ARTIFACT_ACCESS_DENIED" ? "AGENT_AUTHORIZATION_DENIED" : "AGENT_ARTIFACT_FAILURE",
      retryable: false,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(store.calls).not.toContain("reserve");
  });

  it("retries a failed tool with its recorded input and retains charged retry usage", async () => {
    const execute = vi.fn(async () => ({
      observationArtifactRef: artifact,
      effect: "committed" as const,
      resultRef: artifact,
    }));
    let settledUsage;
    const store = makeStore({
      findAction: async () =>
        ({
          status: "failed",
          actionType: "domain-tool",
          intentArtifactRef: artifact,
        }) as AgentTaskActionV1,
      reserveAction: async (input) => ({
        task,
        reservation: {
          ...reservation,
          actionId: input.actionId,
          amount: { ...emptyAgentBudgetUsage(), toolInvocations: 1, transientRetries: 1 },
        },
      }),
      completeAction: async (input) => {
        settledUsage = input.usage;
        return task;
      },
    });
    const runner = new AgentRuntimeRunner({
      store,
      registry: new AgentTaskDefinitionRegistry([definition(execute)]),
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      maxConcurrentTasks: 1,
      artifactStore: recoveryArtifactStore,
      persistArtifact: async () => artifact,
      now: () => "2030-01-01T00:00:01.000Z",
    });
    expect(await runner.runOnce()).toBe(1);
    expect(execute).toHaveBeenCalledOnce();
    expect(settledUsage).toMatchObject({ toolInvocations: 1, transientRetries: 1 });
    expect(store.calls).toContain("fail-task");
  });

  it("ends a retry when the original remaining budget cannot reserve another action", async () => {
    let terminal = false;
    let failure;
    const store = makeStore({
      claim: async () => (terminal ? undefined : claim),
      findAction: async () =>
        ({
          status: "failed",
          actionType: "domain-tool",
          intentArtifactRef: artifact,
        }) as AgentTaskActionV1,
      reserveAction: async () => {
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_BUDGET_EXHAUSTED",
            category: "budget",
            stage: "test.retry",
          }),
        );
      },
      failTask: async (input) => {
        terminal = true;
        failure = input.error;
        return task;
      },
    });
    const execute = vi.fn();
    const runner = new AgentRuntimeRunner({
      store,
      registry: new AgentTaskDefinitionRegistry([definition(execute)]),
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      maxConcurrentTasks: 1,
      artifactStore: recoveryArtifactStore,
      persistArtifact: async () => artifact,
      now: () => "2030-01-01T00:00:01.000Z",
    });
    expect(await runner.runOnce()).toBe(1);
    expect(await runner.runOnce()).toBe(0);
    expect(failure).toMatchObject({ code: "AGENT_BUDGET_EXHAUSTED", retryable: false });
    expect(execute).not.toHaveBeenCalled();
  });

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

  it("retains the action receipt when budget settlement fails", async () => {
    let failure;
    const store = makeStore({
      completeAction: async () => {
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_BUDGET_EXHAUSTED",
            category: "budget",
            stage: "budget.settle.inputTokens",
          }),
        );
      },
      failAction: async (input) => {
        failure = input;
        return task;
      },
    });
    const runner = new AgentRuntimeRunner({
      store,
      registry: new AgentTaskDefinitionRegistry([
        definition(async () => ({
          observationArtifactRef: artifact,
          effect: "committed",
          resultRef: artifact,
        })),
      ]),
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
    expect(failure).toMatchObject({
      error: { code: "AGENT_BUDGET_EXHAUSTED", retryable: false },
      resultArtifactRef: artifact,
    });
    expect(store.calls).not.toContain("complete-task");
  });

  it("records actual model usage and raw receipt when interpreting a response fails", async () => {
    let failure;
    const store = makeStore({
      failAction: async (input) => {
        failure = input;
        return task;
      },
    });
    const gateway = {
      completeStructured: vi.fn(async (request) => ({
        schemaVersion: "1",
        invocationId: request.invocationId,
        modelDeploymentRef: request.modelDeploymentRef,
        promptTemplateRef: request.promptTemplateRef,
        outputSchemaRef: request.outputSchemaRef,
        serverBuildRef: { entityId: "server", versionId: "1" },
        modelVersionRef: { entityId: "model", versionId: "1" },
        usage: { available: true, inputTokens: 4, outputTokens: 2, totalTokens: 6 },
        rawResponseRef: artifact,
        value: { operation: "candidate" },
        finishReason: "stop",
      })),
    } as unknown as ModelGatewayPortV1;
    const persisted = vi.fn(async () => artifact);
    const runner = new AgentRuntimeRunner({
      store,
      registry: new AgentTaskDefinitionRegistry([definition()]),
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      maxConcurrentTasks: 1,
      modelGateway: gateway,
      renderModelStep: () => ({
        messages: [{ role: "user", content: "clean" }],
        maxOutputTokens: 10,
      }),
      interpretModelStep: () => {
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_INPUT_INVALID",
            category: "input",
            stage: "test.interpret",
          }),
        );
      },
      persistArtifact: persisted,
      now: () => "2030-01-01T00:00:01.000Z",
    });
    expect(await runner.runOnce()).toBe(1);
    expect(failure).toMatchObject({
      error: { code: "AGENT_INPUT_INVALID" },
      usage: { modelInvocations: 1, inputTokens: 4, outputTokens: 2, contextTokens: 6 },
      resultArtifactRef: artifact,
    });
    expect(gateway.completeStructured).toHaveBeenCalledWith(
      expect.objectContaining({ maxInputTokens: 100, maxContextTokens: 100, maxOutputTokens: 10 }),
      expect.anything(),
      expect.anything(),
    );
    expect(persisted).toHaveBeenCalledWith(
      expect.objectContaining({
        purposeCode: "agent-action-result",
        value: expect.objectContaining({ rawResponseRef: artifact }),
      }),
    );
    expect(store.calls).not.toContain("complete-task");
  });

  it.each([
    {
      code: "MODEL_CONTEXT_EXCEEDED" as const,
      expectedCode: "AGENT_BUDGET_EXHAUSTED",
      category: "budget",
      retryable: false,
    },
    {
      code: "MODEL_OUTPUT_SCHEMA_INVALID" as const,
      expectedCode: "AGENT_VALIDATION_REJECTED",
      category: "validation",
      retryable: true,
    },
  ])(
    "保留模型$code的真实用量并交给既有失败恢复机制",
    async ({ code, expectedCode, category, retryable }) => {
      const inputTokens = code === "MODEL_CONTEXT_EXCEEDED" ? 101 : 4;
      let failure;
      const store = makeStore({
        failAction: async (input) => {
          failure = input;
          return task;
        },
      });
      const gateway = {
        completeStructured: async () => {
          throw new ModelGatewayError(
            modelGatewayError({
              code,
              retryable: false,
              stage: "usage.budget",
              invocationId: "action-1",
              modelDeploymentRef: taskRef.modelDeploymentRef,
              occurredAt: "2030-01-01T00:00:01.000Z",
              rawResponseRef: { ...artifact, kind: "diagnostic-artifact" },
              counts: { inputTokens, outputTokens: 2 },
            }),
          );
        },
      } as unknown as ModelGatewayPortV1;
      const runner = new AgentRuntimeRunner({
        store,
        registry: new AgentTaskDefinitionRegistry([definition()]),
        workerId: "worker-1",
        leaseDurationMs: 30_000,
        maxConcurrentTasks: 1,
        modelGateway: gateway,
        renderModelStep: () => ({
          messages: [{ role: "user", content: "clean" }],
          maxOutputTokens: 10,
        }),
        interpretModelStep: () => {
          throw new Error("must not interpret");
        },
        persistArtifact: async () => artifact,
        now: () => "2030-01-01T00:00:01.000Z",
      });
      expect(await runner.runOnce()).toBe(1);
      expect(failure).toMatchObject({
        error: { code: expectedCode, category, retryable },
        usage: {
          modelInvocations: 1,
          inputTokens,
          outputTokens: 2,
          contextTokens: inputTokens + 2,
        },
        resultArtifactRef: artifact,
      });
    },
  );

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
    expect(store.calls).toContain("fail-task");
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

  it("rebuilds completed tool calls from recorded evidence without re-executing the tool", async () => {
    const requestRef = {
      kind: "diagnostic-artifact" as const,
      reference: { entityId: "model-result-1", versionId: `sha256:${"d".repeat(64)}` },
    };
    const observationRef = {
      kind: "content-artifact" as const,
      reference: { entityId: "observed-1", versionId: `sha256:${"e".repeat(64)}` },
    };
    const secondRequestRef = {
      kind: "diagnostic-artifact" as const,
      reference: { entityId: "model-result-2", versionId: `sha256:${"f".repeat(64)}` },
    };
    const secondObservationRef = {
      kind: "content-artifact" as const,
      reference: { entityId: "observed-2", versionId: `sha256:${"0".repeat(64)}` },
    };
    const encoder = new TextEncoder();
    const toolRequestBytes = encoder.encode(
      JSON.stringify({
        disposition: "tool-request",
        toolRef,
        toolInput: { operation: "candidate" },
      }),
    );
    const recorded = new Map<string, Uint8Array>([
      [requestRef.reference.versionId, toolRequestBytes],
      [
        observationRef.reference.versionId,
        encoder.encode(JSON.stringify({ observationArtifactRef: observationRef })),
      ],
      [secondRequestRef.reference.versionId, toolRequestBytes],
      [
        secondObservationRef.reference.versionId,
        encoder.encode(JSON.stringify({ observationArtifactRef: secondObservationRef })),
      ],
    ]);
    const artifactStore = {
      open: async (request: { artifactRef: { reference: { versionId: string } } }) => ({
        manifest: {} as never,
        content: (async function* () {
          yield recorded.get(request.artifactRef.reference.versionId)!;
        })(),
        completed: Promise.resolve({} as never),
      }),
    } as unknown as ArtifactStoreV1;
    const recordedActions = [
      { status: "completed", actionType: "model-invocation", resultArtifactRef: requestRef },
      { status: "completed", actionType: "domain-tool", resultArtifactRef: observationRef },
      { status: "completed", actionType: "model-invocation", resultArtifactRef: secondRequestRef },
      { status: "completed", actionType: "domain-tool", resultArtifactRef: secondObservationRef },
    ] as unknown as AgentTaskActionV1[];
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
    const executeStep = vi.fn(async () => ({
      observationArtifactRef: artifact,
      effect: "none" as const,
    }));
    const renderModelStep = vi.fn(() => ({
      messages: [{ role: "user" as const, content: "continue" }],
      maxOutputTokens: 3,
    }));
    const interpretModelStep = vi.fn().mockReturnValueOnce({
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
    const store = makeStore({
      async findAction() {
        return recordedActions.shift();
      },
    });
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
      artifactStore,
      now: () => "2030-01-01T00:00:01.000Z",
    });

    expect(await runner.runOnce()).toBe(1);
    expect(executeStep).not.toHaveBeenCalled();
    // 只登记新的模型步，两次已记录的工具调用不重新预留动作。
    expect(store.calls.filter((call) => call === "reserve")).toHaveLength(1);
    expect(renderModelStep).toHaveBeenCalledOnce();
    expect(renderModelStep.mock.calls[0]?.[2]).toEqual({
      previousObservationArtifactRef: secondObservationRef,
      completedToolCalls: [
        { toolRef, input: { operation: "candidate" }, observationArtifactRef: observationRef },
        {
          toolRef,
          input: { operation: "candidate" },
          observationArtifactRef: secondObservationRef,
        },
      ],
    });
    expect(store.calls).toContain("complete-task");
  });

  it("returns a read-only tool observation to the model before finalizing", async () => {
    const outputSchema = z.strictObject({ operation: z.literal("candidate") });
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
    const secondObservation = {
      kind: "content-artifact" as const,
      reference: { entityId: "cleaned-2", versionId: `sha256:${"c".repeat(64)}` },
    };
    const observations = [artifact, secondObservation];
    const executeStep = vi.fn(async () => ({
      observationArtifactRef: observations.shift()!,
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
      maxOutputTokens: 3,
      outputSchema,
    }));
    const remainingBudgetTask = {
      ...task,
      budgetPolicy: { ...task.budgetPolicy, maxOutputTokens: 3 },
      budgetLedger: {
        ...task.budgetLedger,
        used: { ...task.budgetLedger.used, outputTokens: 1 },
      },
    };
    const store = makeStore({ claim: async () => ({ ...claim, task: remainingBudgetTask }) });
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
    expect(gateway.completeStructured).toHaveBeenCalledTimes(3);
    expect(gateway.completeStructured).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ maxOutputTokens: 2 }),
      outputSchema,
      expect.anything(),
    );
    expect(executeStep).toHaveBeenCalledTimes(2);
    // 第二次工具调用完成后，模型上下文仍同时保留首次与第二次读取事实。
    expect(renderModelStep.mock.calls[1]?.[2]).toEqual({
      previousObservationArtifactRef: artifact,
      completedToolCalls: [
        { toolRef, input: { operation: "candidate" }, observationArtifactRef: artifact },
      ],
    });
    expect(renderModelStep.mock.calls[2]?.[2]).toEqual({
      previousObservationArtifactRef: secondObservation,
      completedToolCalls: [
        { toolRef, input: { operation: "candidate" }, observationArtifactRef: artifact },
        { toolRef, input: { operation: "candidate" }, observationArtifactRef: secondObservation },
      ],
    });
    expect(store.calls.filter((call) => call === "complete-action")).toHaveLength(5);
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
    expect(capturedFailure?.activeWallClockMs).toBeGreaterThan(0);
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
      runTask: async (claimed, operation, execution) => {
        expect(execution).toMatchObject({ workerId: "worker-1", leaseToken: expect.any(String) });
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
