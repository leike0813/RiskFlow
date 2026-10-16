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
  agentTaskRefFor,
  reserveAgentBudget,
  settleAgentBudget,
  AgentActionEntryV1Schema,
  AgentLaunchContextV1Schema,
  AgentProposalSummaryV1Schema,
  AgentTaskDetailV1Schema,
  AgentTaskReadQueryV1Schema,
  AgentValidationCheckEntryV1Schema,
  AgentValidationPageV1Schema,
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
    measureCandidateUsage: () => ({ candidates: 1, objects: 1 }),
    validateCandidate: () => ({
      schemaVersion: "1",
      items: [],
      disposition: "accepted",
      validationArtifactRef: artifact("diagnostic-artifact", `${taskType}-validation-result`),
      validatedAt: "2030-01-01T00:00:00.000Z",
    }),
    finalizeCandidate: (_candidate, context) =>
      buildCompletedAgentTaskResult(
        context.envelope.agentTaskRef,
        artifact("content-artifact", `${taskType}-result`),
        undefined,
        context.envelope.agentTaskRef.taskType === "response-recommendation"
          ? ["recommendation-candidate"]
          : undefined,
      ),
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

  it("records actual over-budget usage only on failure settlement and refuses another reservation", () => {
    const taskPolicy = { ...policy("data-cleaning"), maxInputTokens: 10 };
    const initial = {
      schemaVersion: "1" as const,
      reserved: emptyAgentBudgetUsage(),
      used: emptyAgentBudgetUsage(),
      activeWallClockMs: 0,
      currentConcurrency: 0,
      ledgerVersion: 1,
      changedAt: "2030-01-01T00:00:00.000Z",
    };
    const reserved = reserveAgentBudget(taskPolicy, initial, {
      actionType: "model-invocation",
      actionId: "overrun-action",
      reservationId: "overrun-reservation",
      amount: { inputTokens: 10 },
    });
    const actual = { ...emptyAgentBudgetUsage(), modelInvocations: 1, inputTokens: 11 };
    expect(() =>
      settleAgentBudget(taskPolicy, reserved.ledger, reserved.reservation, actual),
    ).toThrow(AgentRuntimeError);
    const failed = settleAgentBudget(
      taskPolicy,
      reserved.ledger,
      reserved.reservation,
      actual,
      "2030-01-01T00:00:01.000Z",
      0,
      { allowBudgetOverrun: true },
    );
    expect(failed.used.inputTokens).toBe(11);
    expect(failed.reserved.inputTokens).toBe(0);
    expect(() =>
      reserveAgentBudget(taskPolicy, failed, {
        actionType: "model-invocation",
        actionId: "after-overrun",
        reservationId: "after-overrun",
      }),
    ).toThrow(AgentRuntimeError);
  });

  it("records the actual wall-clock overrun when settling a timeout failure", () => {
    const taskPolicy = policy("data-cleaning");
    const reserved = reserveAgentBudget(
      taskPolicy,
      {
        schemaVersion: "1",
        reserved: emptyAgentBudgetUsage(),
        used: emptyAgentBudgetUsage(),
        activeWallClockMs: taskPolicy.maxWallClockMs - 1,
        currentConcurrency: 0,
        ledgerVersion: 1,
        changedAt: "2030-01-01T00:00:00.000Z",
      },
      {
        actionType: "model-invocation",
        actionId: "timeout-action",
        reservationId: "timeout-reservation",
        now: "2030-01-01T00:00:00.000Z",
      },
    );
    const actual = { ...emptyAgentBudgetUsage(), modelInvocations: 1 };

    expect(() =>
      settleAgentBudget(
        taskPolicy,
        reserved.ledger,
        reserved.reservation,
        actual,
        "2030-01-01T00:00:01.000Z",
        2,
      ),
    ).toThrow(AgentRuntimeError);
    expect(
      settleAgentBudget(
        taskPolicy,
        reserved.ledger,
        reserved.reservation,
        actual,
        "2030-01-01T00:00:01.000Z",
        2,
        { allowWallClockOverrun: true },
      ).activeWallClockMs,
    ).toBe(taskPolicy.maxWallClockMs + 1);
  });

  it("keeps state transitions versioned and classifies refusal boundaries", () => {
    const registry = new AgentTaskDefinitionRegistry([definition("data-cleaning")]);
    const prepared = prepareAgentTaskStart(
      startCommand,
      registry.get("data-cleaning"),
      "2030-01-01T00:00:00.000Z",
    );
    expect(prepared.taskRef).toEqual(agentTaskRefFor(startCommand));
    expect(agentTaskRefFor({ ...startCommand, idempotencyKey: "other-batch" })).not.toEqual(
      prepared.taskRef,
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

describe("C35 Agent 任务只读投影契约", () => {
  const readAuthorization = {
    ...authorization,
    grantedCapabilities: ["agent-task.read" as const],
  };
  const readQueryBase = {
    queryId: "query-1",
    projectId: "project-1",
    actorId: "actor-1",
    requestedAt: "2030-01-01T00:00:00.000Z",
    authorization: readAuthorization,
  };
  const taskDefinition = definition("data-cleaning");
  const prepared = prepareAgentTaskStart(startCommand, taskDefinition, "2030-01-01T00:00:00.000Z");

  it("详情按原预算策略与台账整体引用，不合并成虚构总上限", () => {
    const detail = {
      kind: "detail",
      summary: {
        agentTaskRef: prepared.taskRef,
        status: "pending",
        taskVersion: 1,
        initiatorActorId: "actor-1",
        parentRunRef: startCommand.payload.parentRunRef,
        frozenInputRef: startCommand.payload.frozenInputRef,
        createdAt: "2030-01-01T00:00:00.000Z",
        updatedAt: "2030-01-01T00:00:00.000Z",
      },
      budget: { policy: prepared.budgetPolicy, ledger: prepared.budgetLedger },
      actions: [
        { branch: "agent-task.cancel-task", availability: "allowed" },
        {
          branch: "agent-task.confirm-command",
          availability: "business-unavailable",
          reasonCode: "NO_PROPOSAL",
        },
      ],
    };
    const parsed = AgentTaskDetailV1Schema.safeParse(detail);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // 原上限字段逐项保留；台账的 used/reserved/墙钟/并发原样呈现。
    expect(parsed.data.budget.policy.maxContextTokens).toBe(100);
    expect(parsed.data.budget.policy.maxInputTokens).toBeUndefined();
    expect(parsed.data.budget.ledger.currentConcurrency).toBe(0);
    expect(parsed.data.summary.taskVersion).toBe(1);
  });

  it("提案摘要只允许可确认字段，命令工件引用不得泄露", () => {
    const base = {
      commandProposalRef: { kind: "command-proposal" as const, reference: ref("proposal-1") },
      taskRef: prepared.taskRef,
      targetRef: { kind: "project-revision" as const, reference: ref("project-revision-1") },
      expectedTargetVersion: ref("project-revision-2"),
      expectedEffect: "publish-knowledge-release",
      externalEffects: ["business-write" as const],
      proposedAt: "2030-01-01T00:00:00.000Z",
    };
    expect(AgentProposalSummaryV1Schema.safeParse(base).success).toBe(true);
    expect(
      AgentProposalSummaryV1Schema.safeParse({
        ...base,
        commandArtifactRef: artifact("content-artifact", "command-1"),
      }).success,
    ).toBe(false);
    expect(
      AgentProposalSummaryV1Schema.safeParse({ ...base, commandIdempotencyKey: "idem-1" }).success,
    ).toBe(false);
  });

  it("安全行动只暴露引用与实际用量，不返回租约、命令正文或模型输出", () => {
    const entry = {
      actionId: "action-1",
      sequence: 0,
      actionType: "domain-tool",
      status: "completed",
      intentArtifactRef: artifact("content-artifact", "intent-1"),
      resultRef: contractRef("knowledge-revision", "revision-1"),
      usage: emptyAgentBudgetUsage(),
      recordedAt: "2030-01-01T00:00:00.000Z",
    };
    expect(AgentActionEntryV1Schema.safeParse(entry).success).toBe(true);
    for (const leak of ["leaseToken", "modelOutput", "intentBody", "observationBody"]) {
      expect(AgentActionEntryV1Schema.safeParse({ ...entry, [leak]: "secret" }).success).toBe(
        false,
      );
    }
  });

  it("逐项校验分页按原数组顺序稳定收口并受页上限约束", () => {
    const check = (index: number) => ({
      checkId: `check-${index}`,
      disposition: "accepted" as const,
      reasonCode: "REASON-1",
      evidenceReferences: [],
    });
    const page = {
      kind: "validation",
      agentTaskRef: prepared.taskRef,
      candidateVersion: 1,
      items: [check(0), check(1)],
    };
    expect(AgentValidationPageV1Schema.safeParse(page).success).toBe(true);
    expect(
      AgentValidationPageV1Schema.safeParse({
        ...page,
        items: Array.from({ length: 51 }, (_unused, index) => check(index)),
      }).success,
    ).toBe(false);
    // 逐项投影的处置取值闭合在原 C08 枚举内，不接受自由结论。
    for (const disposition of ["accepted", "rejected"] as const) {
      expect(
        AgentValidationCheckEntryV1Schema.safeParse({
          checkId: "check-x",
          disposition,
          reasonCode: "REASON-1",
          evidenceReferences: [],
        }).success,
      ).toBe(true);
    }
    expect(
      AgentValidationCheckEntryV1Schema.safeParse({
        checkId: "check-x",
        disposition: "maybe",
        reasonCode: "REASON-1",
        evidenceReferences: [],
      }).success,
    ).toBe(false);
  });

  it("启动上下文只在定义支持交互且输入真实时回送完整原载荷", () => {
    const payload = {
      taskType: "data-cleaning",
      triggerMode: "interactive",
      parentRunRef: startCommand.payload.parentRunRef,
      frozenInputRef: startCommand.payload.frozenInputRef,
      modelDeploymentRef: startCommand.payload.modelDeploymentRef,
      promptTemplateRef: startCommand.payload.promptTemplateRef,
      toolPolicyRef: startCommand.payload.toolPolicyRef,
      budgetPolicyRef: startCommand.payload.budgetPolicyRef,
      incrementSchemaRef: startCommand.payload.incrementSchemaRef,
      validationPolicyRef: startCommand.payload.validationPolicyRef,
    };
    expect(AgentLaunchContextV1Schema.safeParse({ supported: true, payload }).success).toBe(true);
    expect(
      AgentLaunchContextV1Schema.safeParse({
        supported: false,
        reasonCode: "DEFINITION_EMBEDDED_ONLY",
      }).success,
    ).toBe(true);
    // 不支持时不得附带半份载荷；支持时不得省略冻结输入。
    expect(
      AgentLaunchContextV1Schema.safeParse({ supported: false, reasonCode: "X", payload }).success,
    ).toBe(false);
    expect(
      AgentLaunchContextV1Schema.safeParse({
        supported: true,
        payload: { ...payload, frozenInputRef: undefined },
      }).success,
    ).toBe(false);
  });

  it("窄读分支只读不改写动作语义：缺 agent-task.read 的信封失败关闭", () => {
    expect(
      AgentTaskReadQueryV1Schema.safeParse({
        ...readQueryBase,
        kind: "detail",
        payload: { agentTaskRef: prepared.taskRef },
      }).success,
    ).toBe(true);
    expect(
      AgentTaskReadQueryV1Schema.safeParse({
        ...readQueryBase,
        authorization: { ...readAuthorization, grantedCapabilities: ["agent-task.start"] },
        kind: "detail",
        payload: { agentTaskRef: prepared.taskRef },
      }).success,
    ).toBe(false);
    // 跨工程与伪造身份在解析期即被拒绝。
    expect(
      AgentTaskReadQueryV1Schema.safeParse({
        ...readQueryBase,
        projectId: "project-2",
        kind: "list",
        payload: {},
      }).success,
    ).toBe(false);
    // 只读面不提供任何写入口：启动/取消/确认不在 read 联合内。
    for (const kind of ["start-task", "cancel-task", "confirm-command"]) {
      expect(
        AgentTaskReadQueryV1Schema.safeParse({ ...readQueryBase, kind, payload: {} }).success,
      ).toBe(false);
    }
  });
});
