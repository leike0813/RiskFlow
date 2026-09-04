import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AgentTaskDefinitionRegistry,
  AgentTaskRuntime,
  AgentTaskStateV1Schema,
  AgentTaskEnvelopeV1Schema,
  AgentRuntimeError,
  buildCompletedAgentTaskResult,
  classifyValidationFailure,
  emptyAgentBudgetUsage,
  prepareAgentTaskStart,
  reserveAgentBudget,
  settleAgentBudget,
  type AgentTaskDefinitionV1,
  type AgentTaskSnapshotV1,
  type AgentTaskStoreV1,
} from "../../src/agent-runtime/index.js";
import {
  AgentTaskRefV1Schema,
  type AgentTaskTypeV1,
  type ContractReferenceV1,
} from "@riskflow/contracts/ports";

const ref = (entityId: string, versionId = "1") => ({ entityId, versionId });
const artifact = (kind: "content-artifact" | "diagnostic-artifact", entityId: string) => ({
  kind,
  reference: { entityId, versionId: `sha256:${"a".repeat(64)}` },
});
const contractRef = (
  kind:
    | "knowledge-revision"
    | "retrieval-artifact-set"
    | "recommendation-candidate"
    | "calibration-suggestion",
  entityId: string,
): ContractReferenceV1 => {
  if (kind === "knowledge-revision") return { kind, reference: ref(entityId) };
  if (kind === "retrieval-artifact-set") return { kind, reference: ref(entityId) };
  if (kind === "recommendation-candidate") return { kind, reference: ref(entityId) };
  return { kind, reference: ref(entityId) };
};
const authorization = {
  schemaVersion: "1" as const,
  authorizationContextRef: { kind: "authorization-context" as const, reference: ref("auth-1") },
  actorId: "actor-1",
  projectId: "project-1",
  grantedCapabilities: [
    "agent-task.start" as const,
    "agent-task.resume" as const,
    "agent-task.cancel" as const,
    "agent-task.confirm" as const,
  ],
  spatialScopeRefs: [],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: ref("access-policy"),
  decidedAt: "2030-01-01T00:00:00.000Z",
  invocation: { kind: "human" as const },
};

const policy = (taskType: AgentTaskDefinitionV1["metadata"]["taskType"]) => ({
  schemaVersion: "1" as const,
  policyRef: ref(`${taskType}-budget`),
  modelDeploymentRef: ref(`${taskType}-model`),
  promptTemplateRef: ref(`${taskType}-prompt`),
  toolPolicyRef: ref(`${taskType}-tools`),
  maxModelInvocations: 2,
  maxToolInvocations: 2,
  maxContextTokens: 100,
  maxInputBytes: 1_000,
  maxOutputBytes: 1_000,
  maxCandidates: 2,
  maxObjects: 10,
  maxSupplementarySearches: 1,
  maxCorrections: 1,
  maxTransientRetries: 1,
  maxConcurrentActions: 1,
  maxWallClockMs: 10_000,
});

const definition = (
  taskType: AgentTaskDefinitionV1["metadata"]["taskType"],
): AgentTaskDefinitionV1 => {
  const taskPolicy = policy(taskType);
  const toolRef = ref(`${taskType}-tool`);
  const schema = z.strictObject({ operation: z.literal("candidate") });
  return {
    metadata: {
      schemaVersion: "1",
      definitionRef: ref(`${taskType}-definition`),
      taskType,
      toolPolicyRef: taskPolicy.toolPolicyRef,
      incrementSchemaRef: ref(`${taskType}-increment`),
      validationPolicyRef: ref(`${taskType}-validation`),
      supportedTriggerModes: ["embedded", "interactive"],
      allowedToolRefs: [toolRef],
      resultFamilies:
        taskType === "data-cleaning"
          ? ["content-artifact"]
          : taskType === "knowledge-authoring"
            ? ["knowledge-revision"]
            : taskType === "retrieval-review"
              ? ["retrieval-artifact-set"]
              : taskType === "response-recommendation"
                ? ["recommendation-candidate", "response-recommendation"]
                : ["calibration-suggestion"],
    },
    budgetPolicy: taskPolicy,
    actionSchema: schema,
    incrementSchema: schema,
    candidateSchema: schema,
    tools: [],
    validateCandidate: () => ({
      schemaVersion: "1",
      items: [],
      disposition: "accepted",
      validationArtifactRef: artifact("diagnostic-artifact", `${taskType}-validation-result`),
      validatedAt: "2030-01-01T00:00:00.000Z",
    }),
  };
};

const startCommand = {
  kind: "start-task" as const,
  commandId: "command-start-1",
  idempotencyKey: "idempotency-start-1",
  projectId: "project-1",
  actorId: "actor-1",
  issuedAt: "2030-01-01T00:00:00.000Z",
  authorization,
  payload: {
    taskType: "data-cleaning" as const,
    triggerMode: "embedded" as const,
    parentRunRef: { kind: "workflow-run" as const, reference: ref("run-1") },
    frozenInputRef: { kind: "project-revision" as const, reference: ref("project-revision-1") },
    modelDeploymentRef: ref("data-cleaning-model"),
    promptTemplateRef: ref("data-cleaning-prompt"),
    toolPolicyRef: ref("data-cleaning-tools"),
    budgetPolicyRef: ref("data-cleaning-budget"),
    incrementSchemaRef: ref("data-cleaning-increment"),
    validationPolicyRef: ref("data-cleaning-validation"),
  },
};

describe("agent runtime core", () => {
  it("registers exactly the five task types and rejects extra DTO fields", () => {
    const registry = new AgentTaskDefinitionRegistry(
      (
        [
          "data-cleaning",
          "knowledge-authoring",
          "retrieval-review",
          "response-recommendation",
          "calibration-suggestion",
        ] as AgentTaskTypeV1[]
      ).map(definition),
    );
    registry.assertComplete();
    expect(registry.values()).toHaveLength(5);
    expect(registry.has("retrieval-review")).toBe(true);
    expect(AgentTaskRefV1Schema.safeParse({ ...startCommand.payload, extra: true }).success).toBe(
      false,
    );
    expect(() =>
      registry.parseAction("data-cleaning", { operation: "candidate", extra: true }),
    ).toThrow(AgentRuntimeError);
    expect(() =>
      registry.parseIncrement("data-cleaning", { operation: "candidate", op: "replace" }),
    ).toThrow(AgentRuntimeError);
    expect(() =>
      registry.assertToolAllowed("data-cleaning", ref("unknown-tool"), ref("data-cleaning-tools")),
    ).toThrow(AgentRuntimeError);
  });

  it("runs every registered task type through one C02 result family boundary", () => {
    const taskTypes: Array<{
      readonly taskType: AgentTaskTypeV1;
      readonly primaryRef: ReturnType<typeof contractRef>;
    }> = [
      { taskType: "data-cleaning", primaryRef: artifact("content-artifact", "cleaned") },
      {
        taskType: "knowledge-authoring",
        primaryRef: contractRef("knowledge-revision", "revision"),
      },
      {
        taskType: "retrieval-review",
        primaryRef: contractRef("retrieval-artifact-set", "retrieval"),
      },
      {
        taskType: "response-recommendation",
        primaryRef: contractRef("recommendation-candidate", "recommendation"),
      },
      {
        taskType: "calibration-suggestion",
        primaryRef: contractRef("calibration-suggestion", "calibration"),
      },
    ];
    for (const { taskType, primaryRef } of taskTypes) {
      const taskDefinition = definition(taskType);
      const task = prepareAgentTaskStart(
        {
          ...startCommand,
          payload: {
            ...startCommand.payload,
            taskType,
            modelDeploymentRef: taskDefinition.budgetPolicy.modelDeploymentRef,
            promptTemplateRef: taskDefinition.budgetPolicy.promptTemplateRef,
            toolPolicyRef: taskDefinition.budgetPolicy.toolPolicyRef,
            budgetPolicyRef: taskDefinition.budgetPolicy.policyRef,
            incrementSchemaRef: taskDefinition.metadata.incrementSchemaRef,
            validationPolicyRef: taskDefinition.metadata.validationPolicyRef,
          },
        },
        taskDefinition,
        "2030-01-01T00:00:00.000Z",
      );
      const result = buildCompletedAgentTaskResult(task.taskRef, primaryRef);
      expect(result.agentTaskRef.taskType).toBe(taskType);
      expect(result.status).toBe("completed");
    }
  });

  it("reserves and settles hard budgets without allowing a second reservation", () => {
    const taskPolicy = policy("data-cleaning");
    const initial = {
      schemaVersion: "1" as const,
      reserved: emptyAgentBudgetUsage(),
      used: emptyAgentBudgetUsage(),
      activeWallClockMs: 0,
      currentConcurrency: 0,
      ledgerVersion: 1,
      changedAt: "2030-01-01T00:00:00.000Z",
    };
    const first = reserveAgentBudget(taskPolicy, initial, {
      actionType: "model-invocation",
      actionId: "action-1",
      reservationId: "reservation-1",
      now: "2030-01-01T00:00:00.000Z",
    });
    expect(first.ledger.reserved.modelInvocations).toBe(1);
    const settled = settleAgentBudget(
      taskPolicy,
      first.ledger,
      first.reservation,
      { ...emptyAgentBudgetUsage(), modelInvocations: 1 },
      "2030-01-01T00:00:01.000Z",
      10,
    );
    expect(settled.used.modelInvocations).toBe(1);
    expect(settled.reserved.modelInvocations).toBe(0);
    expect(() =>
      reserveAgentBudget(taskPolicy, settled, {
        actionType: "model-invocation",
        actionId: "action-2",
        reservationId: "reservation-2",
        amount: { modelInvocations: 1 },
      }),
    ).toThrow(AgentRuntimeError);
  });

  it("keeps state transitions versioned and classifies refusal boundaries", () => {
    const registry = new AgentTaskDefinitionRegistry([definition("data-cleaning")]);
    const prepared = prepareAgentTaskStart(
      startCommand,
      registry.get("data-cleaning"),
      "2030-01-01T00:00:00.000Z",
    );
    const running = {
      ...prepared.state,
      status: "running" as const,
      taskVersion: 2,
      updatedAt: "2030-01-01T00:00:01.000Z",
    };
    expect(AgentTaskStateV1Schema.parse(running).status).toBe("running");
    expect(classifyValidationFailure({ reasonCode: "field-missing" })).toBe("repairable");
    expect(classifyValidationFailure({ reasonCode: "source-qualification-failed" })).toBe(
      "terminal",
    );
    expect(classifyValidationFailure({ reasonCode: "field-missing", terminal: true })).toBe(
      "terminal",
    );
  });

  it("returns the C02 result family selected by the registered task", () => {
    const taskRef = prepareAgentTaskStart(
      startCommand,
      definition("data-cleaning"),
      "2030-01-01T00:00:00.000Z",
    ).taskRef;
    const result = buildCompletedAgentTaskResult(
      taskRef,
      artifact("content-artifact", "cleaned-output"),
    );
    expect(result.status).toBe("completed");
    expect("incrementRef" in result ? result.incrementRef?.kind : undefined).toBe(
      "content-artifact",
    );
    expect(() =>
      AgentTaskEnvelopeV1Schema.parse({
        ...prepareAgentTaskStart(
          startCommand,
          definition("data-cleaning"),
          "2030-01-01T00:00:00.000Z",
        ).envelope,
        extra: true,
      }),
    ).toThrow();
  });

  it("uses the same runtime port for start and preserves its snapshot", async () => {
    let snapshot: AgentTaskSnapshotV1 | undefined;
    const store: AgentTaskStoreV1 = {
      async createTask(input) {
        snapshot = {
          envelope: input.envelope,
          state: input.state,
          budgetPolicy: input.budgetPolicy,
          budgetLedger: input.budgetLedger,
        };
        return snapshot;
      },
      async getTask() {
        return snapshot;
      },
      async resumeTask() {
        return snapshot!;
      },
      async cancelTask() {
        return snapshot!;
      },
      async confirmCommand() {
        return snapshot!;
      },
    };
    const runtime = new AgentTaskRuntime({
      registry: new AgentTaskDefinitionRegistry([definition("data-cleaning")]),
      store,
      now: () => "2030-01-01T00:00:00.000Z",
    });
    const result = await runtime.startTask(startCommand);
    expect(result.kind).toBe("succeeded");
    if (result.kind === "succeeded")
      expect(result.result.agentTaskRef).toEqual(snapshot?.envelope.agentTaskRef);
  });
});
