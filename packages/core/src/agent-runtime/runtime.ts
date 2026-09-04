import { z } from "zod";

import {
  AgentTaskRefV1Schema,
  AgentTaskResultRefV1Schema,
  AgentTaskTypeV1Schema,
  ConfirmAgentCommandV1Schema,
  CancelAgentTaskCommandV1Schema,
  DiagnosticArtifactRefV1Schema,
  type ContractReferenceV1,
  ModuleErrorV1Schema,
  ResumeAgentTaskCommandV1Schema,
  StartAgentTaskCommandV1Schema,
  type AgentTaskPortV1,
  type AgentTaskRefV1,
  type AgentTaskResultRefV1,
  type AgentTaskTypeV1,
  type CancelAgentTaskCommandV1,
  type ConfirmAgentCommandV1,
  type ModuleErrorV1,
  type ResumeAgentTaskCommandV1,
  type StartAgentTaskCommandV1,
} from "@riskflow/contracts/ports";
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  type VersionReference,
} from "@riskflow/contracts/common";

import {
  ModelGatewayError,
  type ModelGatewayPortV1,
  type StructuredCompletionRequestV1,
  type StructuredCompletionResultV1,
} from "../model/index.js";
import {
  AgentTaskBudgetPolicyV1Schema,
  AgentBudgetLedgerV1Schema,
  AgentBudgetReservationV1Schema,
  AgentTaskDefinitionMetadataV1Schema,
  AgentTaskEnvelopeV1Schema,
  AgentBudgetUsageV1Schema,
  AgentStructuredErrorV1Schema,
  AgentValidationResultV1Schema,
  AgentTaskActionV1Schema,
  agentAuthorizationBoundaryFromContext,
  emptyAgentBudgetUsage,
  primaryResultFamilyForTask,
  type AgentBudgetLedgerV1,
  type AgentBudgetReservationV1,
  type AgentBudgetUsageV1,
  type AgentStructuredErrorV1,
  type AgentTaskBudgetPolicyV1,
  type AgentTaskDefinitionMetadataV1,
  type AgentTaskEnvelopeV1,
  type AgentTaskActionV1,
  type AgentValidationResultV1,
  type AgentResultFamilyV1,
  type AgentRejectionClassV1,
  type AgentCommandProposalV1,
} from "./schema.js";
import {
  AgentStateTransitionError,
  canResumeAgentTask,
  createAgentTaskState,
  type AgentTaskStateV1,
} from "./state.js";

const nowIso = (): string => new Date().toISOString();
const sameRef = (
  left: { readonly entityId: string; readonly versionId: string },
  right: { readonly entityId: string; readonly versionId: string },
): boolean => left.entityId === right.entityId && left.versionId === right.versionId;
const assertTypedOperation = (value: unknown, stage: string): void => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throwAgentError({ code: "AGENT_INPUT_INVALID", category: "input", stage });
  const keys = Object.keys(value as object);
  if (
    keys.length === 0 ||
    keys.some((key) => ["op", "path", "from", "jsonPatch", "replace", "entityPatch"].includes(key))
  )
    throwAgentError({ code: "AGENT_INPUT_INVALID", category: "input", stage });
};
const errorRef = (code: string) => ({
  kind: "diagnostic-artifact" as const,
  reference: { entityId: `agent-${code.toLowerCase()}`, versionId: "v1" },
});
const isAbortLike = (error: unknown): boolean =>
  (typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "AbortError") ||
  (typeof error === "object" &&
    error !== null &&
    (("name" in error && error.name === "AbortError") ||
      ("code" in error && error.code === "MODEL_ABORTED")));

export const AGENT_ERROR_RETRYABLE: Readonly<Record<string, boolean>> = Object.freeze({
  AGENT_MODEL_FAILURE: true,
  AGENT_TOOL_FAILURE: true,
  AGENT_PERSISTENCE_FAILURE: true,
  AGENT_ACTION_UNCERTAIN: false,
});

export interface AgentErrorInput {
  readonly code: AgentStructuredErrorV1["code"];
  readonly category: AgentStructuredErrorV1["category"];
  readonly retryable?: boolean;
  readonly stage: string;
  readonly now?: string;
  readonly taskRef?: AgentTaskRefV1;
  readonly actionId?: string;
  readonly attempt?: number;
  readonly currentTaskVersion?: number;
  readonly idempotencyKey?: string;
  readonly priorCommandId?: string;
  readonly reasonCode?: string;
  readonly diagnosticRef?: AgentStructuredErrorV1["diagnosticRef"];
}

export const makeAgentError = (input: AgentErrorInput): AgentStructuredErrorV1 =>
  AgentStructuredErrorV1Schema.parse({
    schemaVersion: "1",
    code: input.code,
    category: input.category,
    retryable: input.retryable ?? AGENT_ERROR_RETRYABLE[input.code] ?? false,
    stage: IdentifierSchema.parse(input.stage),
    occurredAt: IsoDateTimeSchema.parse(input.now ?? nowIso()),
    ...(input.taskRef === undefined ? {} : { taskRef: AgentTaskRefV1Schema.parse(input.taskRef) }),
    ...(input.actionId === undefined ? {} : { actionId: IdentifierSchema.parse(input.actionId) }),
    ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
    ...(input.currentTaskVersion === undefined
      ? {}
      : { currentTaskVersion: input.currentTaskVersion }),
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    ...(input.priorCommandId === undefined ? {} : { priorCommandId: input.priorCommandId }),
    ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
    diagnosticRef: input.diagnosticRef ?? errorRef(input.code),
  });

export class AgentRuntimeError extends Error {
  readonly details: AgentStructuredErrorV1;

  constructor(details: AgentStructuredErrorV1) {
    super(details.code);
    this.name = "AgentRuntimeError";
    this.details = details;
  }
}

export const throwAgentError = (input: AgentErrorInput): never => {
  throw new AgentRuntimeError(makeAgentError(input));
};

export interface AgentBudgetRequestV1 {
  readonly actionType: AgentTaskActionV1["actionType"];
  readonly actionId: string;
  readonly reservationId: string;
  readonly amount?: Partial<AgentBudgetUsageV1>;
  readonly concurrency?: number;
  readonly modelDeploymentRef?: VersionReference;
  readonly promptTemplateRef?: VersionReference;
  readonly toolPolicyRef?: VersionReference;
  readonly now?: string;
}

const usageKeys = Object.keys(emptyAgentBudgetUsage()) as Array<keyof AgentBudgetUsageV1>;
const usageWith = (
  amount: Partial<AgentBudgetUsageV1> | undefined,
  actionType: AgentTaskActionV1["actionType"],
): AgentBudgetUsageV1 => {
  const result = emptyAgentBudgetUsage();
  for (const key of usageKeys) {
    const value = amount?.[key];
    if (value !== undefined) result[key] = value;
  }
  if (actionType === "model-invocation") result.modelInvocations += 1;
  if (actionType === "domain-tool") result.toolInvocations += 1;
  return AgentBudgetUsageV1Schema.parse(result);
};

export const normalizeAgentActionUsage = (
  actionType: AgentTaskActionV1["actionType"],
  actualInput?: Partial<AgentBudgetUsageV1> | AgentBudgetUsageV1,
): AgentBudgetUsageV1 => {
  const actual = AgentBudgetUsageV1Schema.parse({
    ...emptyAgentBudgetUsage(),
    ...(actualInput ?? {}),
  });
  if (actionType === "model-invocation")
    actual.modelInvocations = Math.max(1, actual.modelInvocations);
  if (actionType === "domain-tool") actual.toolInvocations = Math.max(1, actual.toolInvocations);
  return AgentBudgetUsageV1Schema.parse(actual);
};

const limitFor = (
  policy: AgentTaskBudgetPolicyV1,
  key: keyof AgentBudgetUsageV1,
): number | undefined => {
  const limits: Partial<Record<keyof AgentBudgetUsageV1, number>> = {
    modelInvocations: policy.maxModelInvocations,
    toolInvocations: policy.maxToolInvocations,
    contextTokens: policy.maxContextTokens,
    inputBytes: policy.maxInputBytes,
    outputBytes: policy.maxOutputBytes,
    candidates: policy.maxCandidates,
    objects: policy.maxObjects,
    supplementarySearches: policy.maxSupplementarySearches,
    corrections: policy.maxCorrections,
    transientRetries: policy.maxTransientRetries,
    ...(policy.maxInputTokens === undefined ? {} : { inputTokens: policy.maxInputTokens }),
    ...(policy.maxOutputTokens === undefined ? {} : { outputTokens: policy.maxOutputTokens }),
  };
  return limits[key];
};

const totalFor = (
  ledger: AgentBudgetLedgerV1,
  key: keyof AgentBudgetUsageV1,
  next: number,
): number => ledger.used[key] + ledger.reserved[key] + next;

export const reserveAgentBudget = (
  policyInput: AgentTaskBudgetPolicyV1,
  ledgerInput: AgentBudgetLedgerV1,
  request: AgentBudgetRequestV1,
): { readonly ledger: AgentBudgetLedgerV1; readonly reservation: AgentBudgetReservationV1 } => {
  const policy = AgentTaskBudgetPolicyV1Schema.parse(policyInput);
  const ledger = AgentBudgetLedgerV1Schema.parse(ledgerInput);
  const amount = usageWith(request.amount, request.actionType);
  for (const [field, value] of [
    ["modelDeploymentRef", request.modelDeploymentRef],
    ["promptTemplateRef", request.promptTemplateRef],
    ["toolPolicyRef", request.toolPolicyRef],
  ] as const) {
    if (value !== undefined && !sameRef(value, policy[field]))
      throwAgentError({
        code: "AGENT_POLICY_MISMATCH",
        category: "policy",
        stage: `budget.${field}`,
      });
  }
  for (const key of usageKeys) {
    const limit = limitFor(policy, key);
    if (limit !== undefined && totalFor(ledger, key, amount[key]) > limit) {
      const code =
        key === "contextTokens"
          ? "AGENT_CONTEXT_LIMIT_EXCEEDED"
          : key === "candidates"
            ? "AGENT_CANDIDATE_LIMIT_EXCEEDED"
            : key === "toolInvocations"
              ? "AGENT_TOOL_LIMIT_EXCEEDED"
              : "AGENT_BUDGET_EXHAUSTED";
      throwAgentError({ code, category: "budget", stage: `budget.${key}` });
    }
  }
  const concurrency = request.concurrency ?? 1;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throwAgentError({
      code: "AGENT_INPUT_INVALID",
      category: "input",
      stage: "budget.concurrency",
    });
  if (ledger.currentConcurrency + concurrency > policy.maxConcurrentActions)
    throwAgentError({
      code: "AGENT_CONCURRENCY_LIMIT_EXCEEDED",
      category: "budget",
      stage: "budget.concurrency",
    });
  if (ledger.activeWallClockMs >= policy.maxWallClockMs)
    throwAgentError({
      code: "AGENT_WALL_CLOCK_EXCEEDED",
      category: "budget",
      stage: "budget.wall-clock",
    });
  const nextReserved = { ...ledger.reserved };
  for (const key of usageKeys) nextReserved[key] += amount[key];
  const reservedAt = IsoDateTimeSchema.parse(request.now ?? nowIso());
  const reservation = AgentBudgetReservationV1Schema.parse({
    schemaVersion: "1",
    reservationId: request.reservationId,
    actionId: request.actionId,
    amount,
    concurrency,
    reservedAt,
  });
  return {
    reservation,
    ledger: AgentBudgetLedgerV1Schema.parse({
      ...ledger,
      reserved: nextReserved,
      currentConcurrency: ledger.currentConcurrency + concurrency,
      ledgerVersion: ledger.ledgerVersion + 1,
      changedAt: reservedAt,
    }),
  };
};

export const settleAgentBudget = (
  policyInput: AgentTaskBudgetPolicyV1,
  ledgerInput: AgentBudgetLedgerV1,
  reservationInput: AgentBudgetReservationV1,
  actualInput: AgentBudgetUsageV1,
  now = nowIso(),
  activeWallClockMs = 0,
  options: { readonly allowWallClockOverrun?: boolean } = {},
): AgentBudgetLedgerV1 => {
  const policy = AgentTaskBudgetPolicyV1Schema.parse(policyInput);
  const ledger = AgentBudgetLedgerV1Schema.parse(ledgerInput);
  const reservation = AgentBudgetReservationV1Schema.parse(reservationInput);
  const actionType =
    reservation.amount.modelInvocations > 0
      ? "model-invocation"
      : reservation.amount.toolInvocations > 0
        ? "domain-tool"
        : "deterministic-validation";
  const actual = normalizeAgentActionUsage(actionType, actualInput);
  for (const key of usageKeys) {
    if (actual[key] > reservation.amount[key] || ledger.reserved[key] < reservation.amount[key])
      throwAgentError({
        code: "AGENT_BUDGET_EXHAUSTED",
        category: "budget",
        stage: `budget.settle.${key}`,
      });
    if (ledger.used[key] + actual[key] > (limitFor(policy, key) ?? Number.MAX_SAFE_INTEGER))
      throwAgentError({
        code: "AGENT_BUDGET_EXHAUSTED",
        category: "budget",
        stage: `budget.used.${key}`,
      });
  }
  if (!Number.isSafeInteger(activeWallClockMs) || activeWallClockMs < 0)
    throwAgentError({ code: "AGENT_INPUT_INVALID", category: "input", stage: "budget.wall-clock" });
  if (
    !options.allowWallClockOverrun &&
    ledger.activeWallClockMs + activeWallClockMs > policy.maxWallClockMs
  )
    throwAgentError({
      code: "AGENT_WALL_CLOCK_EXCEEDED",
      category: "budget",
      stage: "budget.wall-clock",
    });
  const reserved = { ...ledger.reserved };
  const used = { ...ledger.used };
  for (const key of usageKeys) {
    reserved[key] -= reservation.amount[key];
    used[key] += actual[key];
  }
  if (ledger.currentConcurrency < reservation.concurrency)
    throwAgentError({
      code: "AGENT_CONCURRENCY_LIMIT_EXCEEDED",
      category: "budget",
      stage: "budget.settle.concurrency",
    });
  return AgentBudgetLedgerV1Schema.parse({
    ...ledger,
    reserved,
    used,
    currentConcurrency: ledger.currentConcurrency - reservation.concurrency,
    activeWallClockMs: ledger.activeWallClockMs + activeWallClockMs,
    ledgerVersion: ledger.ledgerVersion + 1,
    changedAt: IsoDateTimeSchema.parse(now),
  });
};

export interface AgentTaskSnapshotV1 {
  readonly envelope: AgentTaskEnvelopeV1;
  readonly state: AgentTaskStateV1;
  readonly budgetPolicy: AgentTaskBudgetPolicyV1;
  readonly budgetLedger: AgentBudgetLedgerV1;
}

export interface AgentTaskStoreV1 {
  createTask(input: {
    readonly envelope: AgentTaskEnvelopeV1;
    readonly state: AgentTaskStateV1;
    readonly budgetPolicy: AgentTaskBudgetPolicyV1;
    readonly budgetLedger: AgentBudgetLedgerV1;
  }): Promise<AgentTaskSnapshotV1>;
  getTask(taskRef: AgentTaskRefV1): Promise<AgentTaskSnapshotV1 | undefined>;
  resumeTask(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly expectedTaskVersion?: number;
    readonly evidenceRef: ContractReferenceV1;
    readonly now?: string;
  }): Promise<AgentTaskSnapshotV1>;
  cancelTask(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly reasonCode: string;
    readonly now?: string;
  }): Promise<AgentTaskSnapshotV1>;
  confirmCommand(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly proposalRef: ContractReferenceV1;
    readonly confirmation: "confirmed" | "rejected";
    readonly now?: string;
  }): Promise<AgentTaskSnapshotV1>;
}

export interface AgentDomainToolResultV1 {
  readonly observationArtifactRef: import("../artifacts/schema.js").ArtifactRefV1;
  readonly resultRef?: ContractReferenceV1;
  readonly effect: "none" | "committed" | "uncertain";
  readonly usage?: Partial<AgentBudgetUsageV1>;
}
export interface AgentCommandExecutionResultV1 {
  readonly resultRef: ContractReferenceV1;
}

export interface AgentCommandExecutorV1 {
  execute(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly proposal: AgentCommandProposalV1;
    readonly command: unknown;
    readonly authorization: AgentTaskEnvelopeV1["authorization"];
    readonly signal?: AbortSignal;
  }): Promise<AgentCommandExecutionResultV1>;
}

export interface AgentDomainToolExecutionContextV1 {
  readonly task: AgentTaskSnapshotV1;
  readonly taskRef: AgentTaskRefV1;
  readonly actionId: string;
  readonly signal?: AbortSignal;
}

export interface AgentDomainToolV1<TInput = unknown> {
  readonly toolRef: VersionReference;
  readonly budgetUsage: Partial<
    Pick<
      AgentBudgetUsageV1,
      "objects" | "supplementarySearches" | "corrections" | "transientRetries"
    >
  >;
  execute(
    input: TInput,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1>;
  recover?(
    input: TInput,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1 | undefined>;
}

export interface AgentTaskDefinitionV1<TAction = unknown, TCandidate = unknown> {
  readonly metadata: AgentTaskDefinitionMetadataV1;
  readonly budgetPolicy: AgentTaskBudgetPolicyV1;
  readonly actionSchema: z.ZodType<TAction>;
  readonly incrementSchema: z.ZodType<unknown>;
  readonly candidateSchema: z.ZodType<TCandidate>;
  readonly tools: readonly AgentDomainToolV1[];
  readonly measureCandidateUsage: (
    candidate: TCandidate,
    context: AgentTaskSnapshotV1,
  ) => Partial<Pick<AgentBudgetUsageV1, "candidates" | "objects" | "corrections">>;
  readonly validateCandidate: (
    candidate: TCandidate,
    context: AgentTaskSnapshotV1,
  ) => Promise<AgentValidationResultV1> | AgentValidationResultV1;
  readonly finalizeCandidate: (
    candidate: TCandidate,
    context: AgentTaskSnapshotV1,
  ) => Promise<AgentTaskResultRefV1> | AgentTaskResultRefV1;
}

export const AGENT_TASK_TYPE_VALUES = AgentTaskTypeV1Schema.options as readonly AgentTaskTypeV1[];

const metadataMatches = (
  command: StartAgentTaskCommandV1,
  definition: AgentTaskDefinitionV1,
): boolean =>
  definition.metadata.taskType === command.payload.taskType &&
  definition.metadata.supportedTriggerModes.includes(command.payload.triggerMode) &&
  sameRef(definition.metadata.toolPolicyRef, command.payload.toolPolicyRef) &&
  sameRef(definition.metadata.incrementSchemaRef, command.payload.incrementSchemaRef) &&
  sameRef(definition.metadata.validationPolicyRef, command.payload.validationPolicyRef) &&
  sameRef(definition.budgetPolicy.policyRef, command.payload.budgetPolicyRef) &&
  sameRef(definition.budgetPolicy.modelDeploymentRef, command.payload.modelDeploymentRef) &&
  sameRef(definition.budgetPolicy.promptTemplateRef, command.payload.promptTemplateRef) &&
  sameRef(definition.budgetPolicy.toolPolicyRef, command.payload.toolPolicyRef);

export const assertAgentTaskDefinitionForCommand = (
  command: StartAgentTaskCommandV1,
  definition: AgentTaskDefinitionV1,
): void => {
  if (!metadataMatches(command, definition))
    throwAgentError({ code: "AGENT_POLICY_MISMATCH", category: "policy", stage: "start.policy" });
};

export class AgentTaskDefinitionRegistry {
  readonly #definitions = new Map<AgentTaskTypeV1, AgentTaskDefinitionV1>();

  constructor(definitions: readonly AgentTaskDefinitionV1[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: AgentTaskDefinitionV1): void {
    const metadata = AgentTaskDefinitionMetadataV1Schema.parse(definition.metadata);
    const policy = AgentTaskBudgetPolicyV1Schema.parse(definition.budgetPolicy);
    if (!sameRef(metadata.toolPolicyRef, policy.toolPolicyRef))
      throwAgentError({
        code: "AGENT_POLICY_MISMATCH",
        category: "policy",
        stage: "registry.policy",
      });
    if (!metadata.supportedTriggerModes.length)
      throwAgentError({
        code: "AGENT_INPUT_INVALID",
        category: "input",
        stage: "registry.trigger-modes",
      });
    if (this.#definitions.has(metadata.taskType))
      throwAgentError({
        code: "AGENT_IDEMPOTENCY_CONFLICT",
        category: "idempotency",
        stage: "registry.duplicate",
      });
    const tools = definition.tools.map((tool) =>
      Object.freeze({
        ...tool,
        toolRef: { ...tool.toolRef },
        budgetUsage: AgentBudgetUsageV1Schema.partial()
          .strict()
          .parse(tool.budgetUsage) as AgentDomainToolV1["budgetUsage"],
      }),
    );
    this.#definitions.set(
      metadata.taskType,
      Object.freeze({ ...definition, metadata, budgetPolicy: policy, tools }),
    );
  }

  get(taskType: AgentTaskTypeV1): AgentTaskDefinitionV1 {
    const definition = this.#definitions.get(AgentTaskTypeV1Schema.parse(taskType));
    if (definition === undefined)
      throwAgentError({
        code: "AGENT_POLICY_NOT_FOUND",
        category: "policy",
        stage: "registry.lookup",
      });
    return definition!;
  }

  has(taskType: AgentTaskTypeV1): boolean {
    return this.#definitions.has(taskType);
  }

  assertComplete(): void {
    if (AGENT_TASK_TYPE_VALUES.some((taskType) => !this.#definitions.has(taskType)))
      throwAgentError({
        code: "AGENT_POLICY_NOT_FOUND",
        category: "policy",
        stage: "registry.complete",
      });
  }

  values(): readonly AgentTaskDefinitionV1[] {
    return [...this.#definitions.values()];
  }

  parseAction(taskType: AgentTaskTypeV1, value: unknown): unknown {
    const definition = this.get(taskType);
    try {
      const parsed = definition.actionSchema.parse(value);
      assertTypedOperation(parsed, "registry.action.untyped");
      return parsed;
    } catch {
      throwAgentError({ code: "AGENT_INPUT_INVALID", category: "input", stage: "registry.action" });
    }
  }

  parseIncrement(taskType: AgentTaskTypeV1, value: unknown): unknown {
    const definition = this.get(taskType);
    try {
      const parsed = definition.incrementSchema.parse(value);
      assertTypedOperation(parsed, "registry.increment.untyped");
      return parsed;
    } catch {
      throwAgentError({
        code: "AGENT_INPUT_INVALID",
        category: "input",
        stage: "registry.increment",
      });
    }
  }

  parseCandidate(taskType: AgentTaskTypeV1, value: unknown): unknown {
    const definition = this.get(taskType);
    try {
      const parsed = definition.candidateSchema.parse(value);
      assertTypedOperation(parsed, "registry.candidate.untyped");
      return parsed;
    } catch {
      throwAgentError({
        code: "AGENT_INPUT_INVALID",
        category: "input",
        stage: "registry.candidate",
      });
    }
  }

  assertToolAllowed(
    taskType: AgentTaskTypeV1,
    toolRef: VersionReference,
    policyRef: VersionReference,
  ): AgentDomainToolV1 {
    const definition = this.get(taskType);
    if (!sameRef(definition.metadata.toolPolicyRef, policyRef))
      throwAgentError({
        code: "AGENT_POLICY_MISMATCH",
        category: "policy",
        stage: "registry.tool-policy",
      });
    const tool = definition.tools.find((candidate) => sameRef(candidate.toolRef, toolRef));
    if (
      tool === undefined ||
      !definition.metadata.allowedToolRefs.some((ref) => sameRef(ref, toolRef))
    )
      throwAgentError({ code: "AGENT_TOOL_NOT_ALLOWED", category: "tool", stage: "registry.tool" });
    return tool!;
  }
}

const taskRefFor = (command: StartAgentTaskCommandV1): AgentTaskRefV1 => ({
  kind: "agent-task",
  reference: {
    entityId: `agent-task:${command.projectId}:${command.idempotencyKey}`,
    versionId: "1",
  },
  taskType: command.payload.taskType,
  triggerMode: command.payload.triggerMode,
  modelDeploymentRef: command.payload.modelDeploymentRef,
  promptTemplateRef: command.payload.promptTemplateRef,
  toolPolicyRef: command.payload.toolPolicyRef,
  budgetPolicyRef: command.payload.budgetPolicyRef,
  incrementSchemaRef: command.payload.incrementSchemaRef,
  validationPolicyRef: command.payload.validationPolicyRef,
});

const envelopeFor = (
  command: StartAgentTaskCommandV1,
  taskRef: AgentTaskRefV1,
  now: string,
): AgentTaskEnvelopeV1 =>
  AgentTaskEnvelopeV1Schema.parse({
    schemaVersion: "1",
    agentTaskRef: taskRef,
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    taskType: command.payload.taskType,
    triggerMode: command.payload.triggerMode,
    projectId: command.projectId,
    actorId: command.actorId,
    parentRunRef: command.payload.parentRunRef,
    frozenInputRef: command.payload.frozenInputRef,
    modelDeploymentRef: command.payload.modelDeploymentRef,
    promptTemplateRef: command.payload.promptTemplateRef,
    toolPolicyRef: command.payload.toolPolicyRef,
    budgetPolicyRef: command.payload.budgetPolicyRef,
    incrementSchemaRef: command.payload.incrementSchemaRef,
    validationPolicyRef: command.payload.validationPolicyRef,
    authorization: command.authorization,
    frozenAuthorization: agentAuthorizationBoundaryFromContext(command.authorization, now),
    createdAt: now,
  });

const initialLedger = (now: string): AgentBudgetLedgerV1 =>
  AgentBudgetLedgerV1Schema.parse({
    schemaVersion: "1",
    reserved: emptyAgentBudgetUsage(),
    used: emptyAgentBudgetUsage(),
    activeWallClockMs: 0,
    currentConcurrency: 0,
    ledgerVersion: 1,
    changedAt: now,
  });

export const prepareAgentTaskStart = (
  command: StartAgentTaskCommandV1,
  definition: AgentTaskDefinitionV1,
  now: string,
): {
  readonly taskRef: AgentTaskRefV1;
  readonly envelope: AgentTaskEnvelopeV1;
  readonly state: AgentTaskStateV1;
  readonly budgetPolicy: AgentTaskBudgetPolicyV1;
  readonly budgetLedger: AgentBudgetLedgerV1;
} => {
  const valid = StartAgentTaskCommandV1Schema.parse(command);
  assertAgentTaskDefinitionForCommand(valid, definition);
  const timestamp = IsoDateTimeSchema.parse(now);
  const taskRef = taskRefFor(valid);
  const envelope = envelopeFor(valid, taskRef, timestamp);
  return {
    taskRef,
    envelope,
    state: createAgentTaskState({ envelope, now: timestamp }),
    budgetPolicy: AgentTaskBudgetPolicyV1Schema.parse(definition.budgetPolicy),
    budgetLedger: initialLedger(timestamp),
  };
};

const publicResultFromSnapshot = (
  snapshot: AgentTaskSnapshotV1,
): AgentTaskResultRefV1 | undefined => {
  if (snapshot.state.resultRef !== undefined)
    return AgentTaskResultRefV1Schema.parse(snapshot.state.resultRef);
  return undefined;
};

export const mapAgentErrorToModuleError = (
  error: AgentStructuredErrorV1,
  context: {
    readonly causalRunId: string;
    readonly attempt?: number;
    readonly retryPolicyRef?: VersionReference;
  },
): ModuleErrorV1 => {
  const value = AgentStructuredErrorV1Schema.parse(error);
  const common = {
    stageCode: value.stage,
    occurredAt: value.occurredAt,
    causalRunId: context.causalRunId,
  };
  if (value.code === "AGENT_AUTHORIZATION_DENIED")
    return ModuleErrorV1Schema.parse({
      ...common,
      code: "AUTHORIZATION_DENIED",
      category: "authorization",
      retryable: false,
      requiredCapability: "agent-task.start",
      authorizationPolicyRef: { entityId: "access-policy", versionId: "1" },
    });
  if (value.code === "AGENT_TASK_NOT_FOUND")
    return ModuleErrorV1Schema.parse({
      ...common,
      code: "ENTITY_NOT_FOUND",
      category: "not-found",
      retryable: false,
      targetRef: value.taskRef ?? {
        kind: "agent-task",
        reference: { entityId: "unknown", versionId: "1" },
      },
    });
  if (value.code === "AGENT_STALE_VERSION" || value.code === "AGENT_CONFIRMATION_STALE")
    return ModuleErrorV1Schema.parse({
      ...common,
      code: "STALE_VERSION",
      category: "concurrency",
      retryable: false,
      targetRef: value.taskRef ?? {
        kind: "agent-task",
        reference: { entityId: "unknown", versionId: "1" },
      },
    });
  if (
    value.code === "AGENT_IDEMPOTENCY_CONFLICT" &&
    value.idempotencyKey !== undefined &&
    value.priorCommandId !== undefined
  )
    return ModuleErrorV1Schema.parse({
      ...common,
      code: "IDEMPOTENCY_CONFLICT",
      category: "idempotency",
      retryable: false,
      idempotencyKey: value.idempotencyKey,
      priorCommandId: value.priorCommandId,
    });
  if (value.retryable)
    return ModuleErrorV1Schema.parse({
      ...common,
      code: "TRANSIENT_FAILURE",
      category: "technical",
      retryable: true,
      attempt: context.attempt ?? value.attempt ?? 1,
      retryPolicyRef: context.retryPolicyRef ?? { entityId: "agent-retry-policy", versionId: "1" },
      diagnosticRef: value.diagnosticRef ?? errorRef(value.code),
    });
  if (value.code === "AGENT_UNSUPPORTED_VERSION")
    return ModuleErrorV1Schema.parse({
      ...common,
      code: "UNSUPPORTED_CONTRACT",
      category: "technical",
      retryable: false,
      schemaVersion: "1",
    });
  return ModuleErrorV1Schema.parse({
    ...common,
    code: "TERMINAL_FAILURE",
    category: "technical",
    retryable: false,
    diagnosticRef: value.diagnosticRef ?? errorRef(value.code),
  });
};

export const mapAgentError = (
  error: unknown,
  context: {
    readonly causalRunId: string;
    readonly attempt?: number;
    readonly retryPolicyRef?: VersionReference;
  },
): ModuleErrorV1 => {
  if (error instanceof AgentRuntimeError) return mapAgentErrorToModuleError(error.details, context);
  if (error instanceof AgentStateTransitionError)
    return mapAgentErrorToModuleError(
      makeAgentError({
        code: error.code,
        category: error.code === "AGENT_STALE_VERSION" ? "concurrency" : "input",
        stage: "state",
      }),
      context,
    );
  if (error instanceof z.ZodError)
    return mapAgentErrorToModuleError(
      makeAgentError({ code: "AGENT_INPUT_INVALID", category: "input", stage: "runtime" }),
      context,
    );
  if (error instanceof ModelGatewayError) {
    const retryable =
      typeof error === "object" &&
      error !== null &&
      "retryable" in error &&
      error.retryable === true;
    return mapAgentErrorToModuleError(
      makeAgentError({ code: "AGENT_MODEL_FAILURE", category: "model", retryable, stage: "model" }),
      context,
    );
  }
  return mapAgentErrorToModuleError(
    makeAgentError({
      code: "AGENT_PERSISTENCE_FAILURE",
      category: "persistence",
      retryable: true,
      stage: "runtime",
    }),
    context,
  );
};

export class AgentTaskRuntime implements AgentTaskPortV1 {
  readonly #registry: AgentTaskDefinitionRegistry;
  readonly #store: AgentTaskStoreV1;
  readonly #now: () => string;

  constructor(options: {
    readonly registry: AgentTaskDefinitionRegistry;
    readonly store: AgentTaskStoreV1;
    readonly now?: () => string;
  }) {
    this.#registry = options.registry;
    this.#store = options.store;
    this.#now = options.now ?? nowIso;
  }

  async startTask(command: StartAgentTaskCommandV1) {
    try {
      const valid = StartAgentTaskCommandV1Schema.parse(command);
      const definition = this.#registry.get(valid.payload.taskType);
      const prepared = prepareAgentTaskStart(valid, definition, this.#now());
      await this.#store.createTask(prepared);
      return { kind: "succeeded" as const, result: { agentTaskRef: prepared.taskRef } };
    } catch (error) {
      return {
        kind: "failed" as const,
        error: mapAgentError(error, {
          causalRunId: command.payload.parentRunRef.reference.entityId,
        }),
      };
    }
  }

  async resumeTask(command: ResumeAgentTaskCommandV1) {
    try {
      const valid = ResumeAgentTaskCommandV1Schema.parse(command);
      const snapshot = await this.#store.resumeTask({
        taskRef: valid.payload.agentTaskRef,
        evidenceRef: valid.payload.resumeEvidenceRef,
        now: this.#now(),
      });
      const result = publicResultFromSnapshot(snapshot);
      if (result !== undefined)
        return { kind: "succeeded" as const, result: { agentTaskResultRef: result } };
      if (!canResumeAgentTask(snapshot.state.status))
        throwAgentError({
          code: "AGENT_CONFIRMATION_REQUIRED",
          category: "confirmation",
          stage: "resume.state",
          taskRef: valid.payload.agentTaskRef,
        });
      return {
        kind: "failed" as const,
        error: mapAgentErrorToModuleError(
          makeAgentError({
            code: "AGENT_MODEL_FAILURE",
            category: "model",
            retryable: true,
            stage: "resume.pending",
            taskRef: valid.payload.agentTaskRef,
          }),
          { causalRunId: valid.payload.agentTaskRef.reference.entityId },
        ),
      };
    } catch (error) {
      return {
        kind: "failed" as const,
        error: mapAgentError(error, {
          causalRunId: command.payload.agentTaskRef.reference.entityId,
        }),
      };
    }
  }

  async cancelTask(command: CancelAgentTaskCommandV1) {
    try {
      const valid = CancelAgentTaskCommandV1Schema.parse(command);
      const snapshot = await this.#store.cancelTask({
        taskRef: valid.payload.agentTaskRef,
        reasonCode: valid.payload.reasonCode,
        now: this.#now(),
      });
      return {
        kind: "succeeded" as const,
        result: { agentTaskRef: snapshot.envelope.agentTaskRef },
      };
    } catch (error) {
      return {
        kind: "failed" as const,
        error: mapAgentError(error, {
          causalRunId: command.payload.agentTaskRef.reference.entityId,
        }),
      };
    }
  }

  async confirmCommand(command: ConfirmAgentCommandV1) {
    try {
      const valid = ConfirmAgentCommandV1Schema.parse(command);
      const snapshot = await this.#store.confirmCommand({
        taskRef: valid.payload.agentTaskRef,
        proposalRef: valid.payload.commandProposalRef,
        confirmation: valid.payload.confirmation,
        now: this.#now(),
      });
      return {
        kind: "succeeded" as const,
        result: {
          commandProposalRef: snapshot.state.currentProposalRef ?? valid.payload.commandProposalRef,
        },
      };
    } catch (error) {
      return {
        kind: "failed" as const,
        error: mapAgentError(error, {
          causalRunId: command.payload.agentTaskRef.reference.entityId,
        }),
      };
    }
  }
}

export const completeAgentStructured = async <T>(input: {
  readonly gateway: ModelGatewayPortV1;
  readonly task: AgentTaskSnapshotV1;
  readonly actionId: string;
  readonly promptTemplateRef: VersionReference;
  readonly outputSchemaRef: VersionReference;
  readonly messages: StructuredCompletionRequestV1["messages"];
  readonly parentArtifactRefs?: readonly import("../artifacts/schema.js").ArtifactRefV1[];
  readonly outputSchema: z.ZodType<T>;
  readonly maxOutputTokens: number;
  readonly remainingWallClockMs?: number;
  readonly now?: string;
  readonly signal?: AbortSignal;
}): Promise<StructuredCompletionResultV1<T>> => {
  const task = AgentTaskEnvelopeV1Schema.parse(input.task.envelope);
  if (
    !sameRef(input.promptTemplateRef, task.promptTemplateRef) ||
    !sameRef(input.outputSchemaRef, task.incrementSchemaRef)
  )
    throwAgentError({
      code: "AGENT_POLICY_MISMATCH",
      category: "policy",
      stage: "model.references",
      taskRef: task.agentTaskRef,
    });
  if (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1)
    throwAgentError({
      code: "AGENT_INPUT_INVALID",
      category: "input",
      stage: "model.max-output-tokens",
      taskRef: task.agentTaskRef,
    });
  if (
    input.task.budgetPolicy.maxOutputTokens !== undefined &&
    input.maxOutputTokens > input.task.budgetPolicy.maxOutputTokens
  )
    throwAgentError({
      code: "AGENT_BUDGET_EXHAUSTED",
      category: "budget",
      stage: "model.max-output-tokens",
      taskRef: task.agentTaskRef,
    });
  const remainingWallClockMs =
    input.remainingWallClockMs ??
    input.task.budgetPolicy.maxWallClockMs - input.task.budgetLedger.activeWallClockMs;
  if (!Number.isSafeInteger(remainingWallClockMs) || remainingWallClockMs <= 0)
    throwAgentError({
      code: "AGENT_WALL_CLOCK_EXCEEDED",
      category: "budget",
      stage: "model.wall-clock",
      taskRef: task.agentTaskRef,
    });
  const issuedAt = IsoDateTimeSchema.parse(input.now ?? nowIso());
  const deadlineAt = new Date(Date.parse(issuedAt) + remainingWallClockMs).toISOString();
  const request = {
    schemaVersion: "1" as const,
    invocationId: input.actionId,
    idempotencyKey: `${task.agentTaskRef.reference.entityId}:action:${input.actionId}`,
    issuedAt,
    projectId: task.projectId,
    actorId: task.actorId,
    authorization: task.authorization,
    requiredCapability: "agent-task.start" as const,
    modelDeploymentRef: task.modelDeploymentRef,
    budgetPolicyRef: task.budgetPolicyRef,
    deadlineAt,
    parentArtifactRefs: [...(input.parentArtifactRefs ?? [])],
    evidenceReferences: [],
    promptTemplateRef: input.promptTemplateRef,
    outputSchemaRef: input.outputSchemaRef,
    messages: input.messages,
    maxOutputTokens: input.maxOutputTokens,
  } satisfies StructuredCompletionRequestV1;
  try {
    return await input.gateway.completeStructured(request, input.outputSchema, input.signal);
  } catch (error) {
    if (isAbortLike(error))
      throwAgentError({
        code: "AGENT_CANCELLED",
        category: "cancelled",
        retryable: false,
        stage: "model.abort",
        taskRef: task.agentTaskRef,
      });
    const retryable =
      typeof error === "object" &&
      error !== null &&
      "retryable" in error &&
      error.retryable === true;
    const diagnosticRefCandidate =
      typeof error === "object" &&
      error !== null &&
      ("diagnosticRef" in error || "rawResponseRef" in error) &&
      typeof ("diagnosticRef" in error ? error.diagnosticRef : error.rawResponseRef) === "object" &&
      ("diagnosticRef" in error ? error.diagnosticRef : error.rawResponseRef) !== null
        ? "diagnosticRef" in error
          ? error.diagnosticRef
          : error.rawResponseRef
        : undefined;
    const diagnosticRef = DiagnosticArtifactRefV1Schema.safeParse(diagnosticRefCandidate);
    throw new AgentRuntimeError(
      makeAgentError({
        code: "AGENT_MODEL_FAILURE",
        category: "model",
        retryable,
        stage: "model.complete",
        taskRef: task.agentTaskRef,
        ...(diagnosticRef.success ? { diagnosticRef: diagnosticRef.data } : {}),
      }),
    );
  }
};

export const classifyValidationFailure = (input: {
  readonly reasonCode: string;
  readonly terminal?: boolean;
}): AgentRejectionClassV1 =>
  input.terminal === true ||
  /authorization|source|version|rule-conflict|trigger|compliance|resource|execution/i.test(
    input.reasonCode,
  )
    ? "terminal"
    : "repairable";

export const assertValidationResult = (value: unknown): AgentValidationResultV1 =>
  AgentValidationResultV1Schema.parse(value);

export const assertAgentAction = (value: unknown): AgentTaskActionV1 =>
  AgentTaskActionV1Schema.parse(value);

export const buildCompletedAgentTaskResult = (
  taskRef: AgentTaskRefV1,
  primaryRef: ContractReferenceV1,
  validationRef?: ContractReferenceV1,
  allowedFamilies?: readonly AgentResultFamilyV1[],
): AgentTaskResultRefV1 => {
  const family = primaryResultFamilyForTask(taskRef.taskType, primaryRef);
  if (family === undefined)
    return throwAgentError({
      code: "AGENT_INPUT_INVALID",
      category: "input",
      stage: "result.family",
      taskRef,
    });
  if (allowedFamilies !== undefined && !allowedFamilies.includes(family))
    throwAgentError({
      code: "AGENT_VALIDATION_REJECTED",
      category: "validation",
      stage: "result.family.policy",
      taskRef,
    });
  const result = {
    kind: "agent-task-result" as const,
    reference: { entityId: `agent-result:${taskRef.reference.entityId}`, versionId: "1" },
    status: "completed" as const,
    agentTaskRef: taskRef,
    ...(family === "content-artifact" && taskRef.taskType !== "response-recommendation"
      ? { incrementRef: primaryRef }
      : {}),
    ...(family === "knowledge-revision" ? { candidateRef: primaryRef } : {}),
    ...(family === "retrieval-artifact-set" ? { incrementRef: primaryRef } : {}),
    ...(family === "recommendation-candidate" ? { candidateRef: primaryRef } : {}),
    ...(family === "response-recommendation" ? { formalResultRef: primaryRef } : {}),
    ...(family === "calibration-suggestion" ? { candidateRef: primaryRef } : {}),
    ...(validationRef === undefined ? {} : { validationRef }),
  };
  return AgentTaskResultRefV1Schema.parse(result);
};
export const primaryReferenceFromAgentTaskResult = (
  result: AgentTaskResultRefV1,
): ContractReferenceV1 => {
  if (result.status !== "completed")
    throwAgentError({
      code: "AGENT_INPUT_INVALID",
      category: "input",
      stage: "result.primary-reference",
      taskRef: result.agentTaskRef,
    });
  if ("incrementRef" in result && result.incrementRef !== undefined) return result.incrementRef;
  if ("candidateRef" in result && result.candidateRef !== undefined) return result.candidateRef;
  if ("formalResultRef" in result && result.formalResultRef !== undefined)
    return result.formalResultRef;
  return throwAgentError({
    code: "AGENT_INPUT_INVALID",
    category: "input",
    stage: "result.primary-reference",
    taskRef: result.agentTaskRef,
  });
};
