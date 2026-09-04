import { randomUUID } from "node:crypto";

import { sql, type Kysely, type Transaction } from "kysely";

import {
  AgentCommandProposalV1Schema,
  AgentTaskActionV1Schema,
  AgentTaskBudgetPolicyV1Schema,
  AgentBudgetLedgerV1Schema,
  AgentTaskEnvelopeV1Schema,
  AgentTaskStateV1Schema,
  AgentBudgetUsageV1Schema,
  AgentTaskDefinitionRegistry,
  AgentRuntimeError,
  AgentStructuredErrorV1Schema,
  AgentCandidateVersionV1Schema,
  agentTaskRefEquals,
  buildCompletedAgentTaskResult,
  canResumeAgentTask,
  emptyAgentBudgetUsage,
  makeAgentError,
  mapAgentError,
  normalizeAgentActionUsage,
  prepareAgentTaskStart,
  requestAgentTaskCancellation,
  reserveAgentBudget,
  settleAgentBudget,
  transitionAgentTask,
  type AgentBudgetLedgerV1,
  type AgentBudgetReservationV1,
  type AgentBudgetUsageV1,
  type AgentCandidateVersionV1,
  type AgentCommandExecutorV1,
  type AgentTaskActionV1,
  type AgentTaskDefinitionV1,
  type AgentTaskEnvelopeV1,
  type AgentTaskSnapshotV1,
  type AgentTaskStateV1,
  type AgentStructuredErrorV1,
} from "@riskflow/core/agent-runtime";
import {
  AccessServiceError,
  isAuthorizationSubset,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  ArtifactRefV1Schema,
  ArtifactStoreError,
  type ArtifactReferenceGuardV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  sha256CanonicalJson,
  type AtomicCommandV1,
  type JsonValue,
  type TransactionContextV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import type { ModelGatewayPortV1 } from "@riskflow/core/model";
import {
  AgentTaskResultRefV1Schema,
  AgentTaskRefV1Schema,
  CancelAgentTaskCommandV1Schema,
  ConfirmAgentCommandV1Schema,
  ResumeAgentTaskCommandV1Schema,
  ContractReferenceV1Schema,
  StartAgentTaskCommandV1Schema,
  AuthorizationContextRefV1Schema,
  type AgentTaskPortV1,
  type AgentTaskResultRefV1,
  type AgentTaskRefV1,
  type CancelAgentTaskCommandV1,
  type ConfirmAgentCommandV1,
  type ContractReferenceV1,
  type ModuleBranchV1,
  type ResumeAgentTaskCommandV1,
  type StartAgentTaskCommandV1,
} from "@riskflow/contracts/ports";
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  type VersionReference,
} from "@riskflow/contracts/common";

import { PostgresPersistenceError } from "../postgres/pool.js";
import { getPostgresTransaction, PostgresTransactionUnit } from "../postgres/transaction-unit.js";
import type { PostgresDatabase } from "../postgres/types.js";

type JsonColumn = JsonValue;
type TimestampColumn = Date | string;

interface AgentTaskRow {
  agent_task_id: string;
  version_id: string;
  project_id: string;
  task_type: string;
  trigger_mode: string;
  agent_task_ref: JsonColumn;
  envelope: JsonColumn;
  status: string;
  task_version: number;
  cancel_requested: boolean;
  cancel_reason_code: string | null;
  result_ref: JsonColumn | null;
  error: JsonColumn | null;
  current_proposal_ref: JsonColumn | null;
  current_proposal_artifact_ref: JsonColumn | null;
  latest_candidate_version: number;
  budget_policy_ref: JsonColumn;
  budget_policy: JsonColumn;
  budget_ledger: JsonColumn;
  parent_run_ref: JsonColumn;
  frozen_input_ref: JsonColumn;
  authorization_context_ref: JsonColumn;
  frozen_authorization: JsonColumn;
  command_id: string;
  idempotency_key: string;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

interface AgentTaskAttemptRow {
  agent_task_id: string;
  attempt_number: number;
  worker_id: string;
  lease_token: string;
  lease_until: TimestampColumn;
  status: string;
  started_at: TimestampColumn;
  heartbeat_at: TimestampColumn;
  finished_at: TimestampColumn | null;
  failure: JsonColumn | null;
}

interface AgentTaskActionRow {
  agent_task_id: string;
  action_id: string;
  attempt_number: number;
  sequence: number;
  action_type: string;
  status: string;
  idempotency_key: string;
  intent_artifact_ref: JsonColumn;
  result_ref: JsonColumn | null;
  result_artifact_ref: JsonColumn | null;
  reservation: JsonColumn;
  usage: JsonColumn;
  error_code: string | null;
  recorded_at: TimestampColumn;
  completed_at: TimestampColumn | null;
}

interface AgentTaskCandidateRow {
  agent_task_id: string;
  candidate_version: number;
  parent_candidate_version: number | null;
  candidate_artifact_ref: JsonColumn;
  increment_artifact_ref: JsonColumn;
  validation: JsonColumn | null;
  result_ref: JsonColumn | null;
  disposition: string;
  rejection_class: string | null;
  created_at: TimestampColumn;
}

interface AgentCommandConfirmationRow {
  agent_task_id: string;
  proposal_entity_id: string;
  proposal_version_id: string;
  proposal_ref: JsonColumn;
  decision: string;
  actor_id: string;
  authorization_context_ref: JsonColumn;
  target_version_ref: JsonColumn;
  command_result_ref: JsonColumn | null;
  command_idempotency_key: string;
  decided_at: TimestampColumn;
}

interface AgentRuntimeDatabase extends PostgresDatabase {
  "business.agent_tasks": AgentTaskRow;
  "business.agent_task_attempts": AgentTaskAttemptRow;
  "business.agent_task_actions": AgentTaskActionRow;
  "business.agent_task_candidates": AgentTaskCandidateRow;
  "business.agent_command_confirmations": AgentCommandConfirmationRow;
}

type AgentTransaction = Transaction<AgentRuntimeDatabase>;

const jsonValue = (value: unknown): JsonValue => value as JsonValue;
const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));
const asIso = (value: Date | string): string => asDate(value).toISOString();
const refEqual = (left: VersionReference, right: VersionReference): boolean =>
  left.entityId === right.entityId && left.versionId === right.versionId;
const taskId = (ref: AgentTaskRefV1): string => ref.reference.entityId;
const activeStatuses = ["pending", "running", "retryable-failure"] as const;

const authorizationWithinFrozenBoundary = (
  frozen: AgentTaskEnvelopeV1["frozenAuthorization"],
  current: AgentTaskEnvelopeV1["authorization"],
): boolean =>
  frozen.projectId === current.projectId &&
  frozen.actorId === current.actorId &&
  refEqual(frozen.authorizationPolicyRef, current.authorizationPolicyRef) &&
  current.grantedCapabilities.every((capability) =>
    frozen.grantedCapabilities.includes(capability),
  ) &&
  current.spatialScopeRefs.every((scope) =>
    frozen.spatialScopeRefs.some((parent) => refEqual(parent.reference, scope.reference)),
  ) &&
  current.sourceAccessGrantRefs.every((grant) =>
    frozen.sourceAccessGrantRefs.some((parent) => refEqual(parent.reference, grant.reference)),
  );

const authorizationWithinFrozenScope = (
  frozen: AgentTaskEnvelopeV1["frozenAuthorization"],
  current: AgentTaskEnvelopeV1["authorization"],
): boolean =>
  frozen.projectId === current.projectId &&
  refEqual(frozen.authorizationPolicyRef, current.authorizationPolicyRef) &&
  current.grantedCapabilities.every((capability) =>
    frozen.grantedCapabilities.includes(capability),
  ) &&
  current.spatialScopeRefs.every((scope) =>
    frozen.spatialScopeRefs.some((parent) => refEqual(parent.reference, scope.reference)),
  ) &&
  current.sourceAccessGrantRefs.every((grant) =>
    frozen.sourceAccessGrantRefs.some((parent) => refEqual(parent.reference, grant.reference)),
  );

const asTransaction = (context: TransactionContextV1): AgentTransaction =>
  getPostgresTransaction(context) as unknown as AgentTransaction;

const commit = (input: {
  readonly command: AtomicCommandV1;
  readonly targetRef: ContractReferenceV1;
  readonly version: VersionReference;
  readonly action: string;
  readonly now: string;
}) => ({
  resultRef: input.targetRef,
  audit: {
    auditEntryId: `agent-audit:${input.command.commandId}`,
    projectId: input.command.projectId,
    action: input.action,
    targetRef: input.targetRef,
    actorRef: input.command.actorRef,
    authorizationContextRef: input.command.authorizationContextRef,
    occurredAt: input.now,
    recordedAt: input.now,
    version: input.version,
    commandId: input.command.commandId,
    idempotencyKey: input.command.idempotencyKey,
  },
  events: [],
});

const commandFor = (input: {
  readonly kind: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly authorization: {
    readonly authorizationContextRef: {
      readonly kind: "authorization-context";
      readonly reference: VersionReference;
    };
  };
  readonly payload: unknown;
  readonly issuedAt?: string;
}): AtomicCommandV1 => ({
  projectId: input.projectId,
  commandKind: input.kind,
  commandId: input.commandId,
  idempotencyKey: input.idempotencyKey,
  payload: jsonValue(input.payload) as Record<string, JsonValue>,
  actorRef: input.actorId,
  authorizationContextRef: input.authorization.authorizationContextRef,
  ...(input.issuedAt === undefined ? {} : { issuedAt: input.issuedAt }),
});

const commandKey = (parts: readonly string[]): string => parts.join(":");

const rowSnapshot = (row: AgentTaskRow): AgentTaskSnapshotV1 => {
  const envelope = AgentTaskEnvelopeV1Schema.parse(row.envelope);
  const state = AgentTaskStateV1Schema.parse({
    schemaVersion: "1",
    agentTaskRef: row.agent_task_ref,
    status: row.status,
    taskVersion: row.task_version,
    cancelRequested: row.cancel_requested,
    ...(row.cancel_reason_code === null ? {} : { cancelReasonCode: row.cancel_reason_code }),
    ...(row.result_ref === null ? {} : { resultRef: row.result_ref }),
    ...(row.error === null ? {} : { error: row.error }),
    ...(row.current_proposal_ref === null ? {} : { currentProposalRef: row.current_proposal_ref }),
    latestCandidateVersion: row.latest_candidate_version,
    updatedAt: asIso(row.updated_at),
  });
  return {
    envelope,
    state,
    budgetPolicy: AgentTaskBudgetPolicyV1Schema.parse(row.budget_policy),
    budgetLedger: AgentBudgetLedgerV1Schema.parse(row.budget_ledger),
  };
};

const actionFromRow = (taskRef: AgentTaskRefV1, row: AgentTaskActionRow): AgentTaskActionV1 =>
  AgentTaskActionV1Schema.parse({
    schemaVersion: "1",
    taskRef,
    actionId: row.action_id,
    sequence: row.sequence,
    actionType: row.action_type,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    intentArtifactRef: row.intent_artifact_ref,
    ...(row.result_ref === null ? {} : { resultRef: row.result_ref }),
    ...(row.result_artifact_ref === null ? {} : { resultArtifactRef: row.result_artifact_ref }),
    reservation: row.reservation,
    usage: row.usage,
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    recordedAt: asIso(row.recorded_at),
    ...(row.completed_at === null ? {} : { completedAt: asIso(row.completed_at) }),
  });

const taskStateUpdate = (state: AgentTaskStateV1) => ({
  status: state.status,
  task_version: state.taskVersion,
  cancel_requested: state.cancelRequested,
  cancel_reason_code: state.cancelReasonCode ?? null,
  result_ref: state.resultRef === undefined ? null : jsonValue(state.resultRef),
  error: state.error === undefined ? null : jsonValue(state.error),
  current_proposal_ref:
    state.currentProposalRef === undefined ? null : jsonValue(state.currentProposalRef),
  latest_candidate_version: state.latestCandidateVersion ?? 0,
  updated_at: new Date(state.updatedAt),
});

export interface AgentTaskClaimV1 {
  readonly task: AgentTaskSnapshotV1;
  readonly attemptNumber: number;
  readonly workerId: string;
  readonly leaseToken: string;
  readonly leaseUntil: string;
}

export interface AgentTaskActionReservationV1 {
  readonly task: AgentTaskSnapshotV1;
  readonly reservation: AgentBudgetReservationV1;
}

export interface AgentTaskExecutionStoreV1 {
  readonly getTask?: (taskRef: AgentTaskRefV1) => Promise<AgentTaskSnapshotV1 | undefined>;
  claim(input: {
    readonly workerId: string;
    readonly leaseDurationMs: number;
    readonly now?: string;
  }): Promise<AgentTaskClaimV1 | undefined>;
  heartbeat(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly leaseDurationMs: number;
    readonly now?: string;
  }): Promise<string>;
  releaseLease(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly status?: "released" | "cancelled" | "completed";
    readonly now?: string;
  }): Promise<void>;
  failTask(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly error: AgentStructuredErrorV1;
    readonly now?: string;
  }): Promise<AgentTaskSnapshotV1>;
  reserveAction(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly actionId: string;
    readonly reservationId: string;
    readonly actionType: AgentTaskActionV1["actionType"];
    readonly sequence: number;
    readonly idempotencyKey: string;
    readonly intentArtifactRef: AgentTaskActionV1["intentArtifactRef"];
    readonly amount?: Partial<AgentBudgetUsageV1>;
    readonly now?: string;
  }): Promise<AgentTaskActionReservationV1>;
  findAction(taskRef: AgentTaskRefV1, actionId: string): Promise<AgentTaskActionV1 | undefined>;
  completeAction(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly actionId: string;
    readonly resultRef?: ContractReferenceV1;
    readonly resultArtifactRef?: AgentTaskActionV1["resultArtifactRef"];
    readonly usage: AgentBudgetUsageV1;
    readonly activeWallClockMs?: number;
    readonly now?: string;
  }): Promise<AgentTaskSnapshotV1>;
  completeTask(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly resultRef: AgentTaskResultRefV1;
    readonly now?: string;
  }): Promise<AgentTaskSnapshotV1>;
  failAction(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly actionId: string;
    readonly error: AgentStructuredErrorV1;
    readonly resultArtifactRef?: AgentTaskActionV1["resultArtifactRef"];
    readonly usage?: AgentBudgetUsageV1;
    readonly uncertain?: boolean;
    readonly activeWallClockMs?: number;
    readonly now?: string;
  }): Promise<AgentTaskSnapshotV1>;
  markWaiting(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly proposalRef: ContractReferenceV1;
    readonly proposalArtifactRef: AgentTaskActionV1["intentArtifactRef"];
    readonly now?: string;
  }): Promise<AgentTaskSnapshotV1>;
  recordCandidate(input: {
    readonly candidate: AgentCandidateVersionV1;
    readonly workerId: string;
    readonly leaseToken: string;
  }): Promise<void>;
  verifyWorker(task: AgentTaskSnapshotV1, invocationId: string): Promise<void>;
  readonly modelGateway?: ModelGatewayPortV1;
  readonly artifactStore?: ArtifactStoreV1;
}

type AgentLeaseMutation = (
  transaction: AgentTransaction,
  current: AgentTaskSnapshotV1,
  attempt: AgentTaskAttemptRow,
  now: string,
  context: TransactionContextV1,
) => Promise<void>;

export interface PostgresAgentTaskAdapterOptions {
  readonly db: Kysely<PostgresDatabase>;
  readonly registry: AgentTaskDefinitionRegistry;
  readonly transactionUnit?: TransactionUnitV1;
  readonly authorization?: LocalIdentityAccessV1;
  readonly artifactStore?: ArtifactStoreV1;
  readonly referenceGuard: ArtifactReferenceGuardV1;
  readonly commandExecutor?: AgentCommandExecutorV1;
  readonly modelGateway?: ModelGatewayPortV1;
  readonly now?: () => string;
}

export class PostgresAgentTaskAdapter implements AgentTaskPortV1, AgentTaskExecutionStoreV1 {
  readonly #db: Kysely<AgentRuntimeDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #registry: AgentTaskDefinitionRegistry;
  readonly #commandExecutor?: AgentCommandExecutorV1;
  readonly #authorization?: LocalIdentityAccessV1;
  readonly #referenceGuard: ArtifactReferenceGuardV1;
  readonly #now: () => string;
  readonly artifactStore?: ArtifactStoreV1;
  readonly modelGateway?: ModelGatewayPortV1;

  constructor(options: PostgresAgentTaskAdapterOptions) {
    this.#db = options.db as unknown as Kysely<AgentRuntimeDatabase>;
    this.#transactionUnit = options.transactionUnit ?? new PostgresTransactionUnit(options.db);
    this.#registry = options.registry;
    this.#referenceGuard = options.referenceGuard;
    this.#now = options.now ?? (() => new Date().toISOString());
    if (options.commandExecutor !== undefined) this.#commandExecutor = options.commandExecutor;
    if (options.authorization !== undefined) this.#authorization = options.authorization;
    if (options.artifactStore !== undefined) this.artifactStore = options.artifactStore;
    if (options.modelGateway !== undefined) this.modelGateway = options.modelGateway;
  }

  async #assertArtifactUsable(
    context: TransactionContextV1,
    task: AgentTaskSnapshotV1,
    artifactRef: AgentTaskActionV1["intentArtifactRef"],
    purposeCode: string,
    authorization: AgentTaskEnvelopeV1["authorization"] = task.envelope.authorization,
    requiredCapability?: AgentTaskEnvelopeV1["authorization"]["grantedCapabilities"][number],
  ): Promise<void> {
    const capability = requiredCapability ?? authorization.grantedCapabilities[0];
    if (capability === undefined)
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_AUTHORIZATION_DENIED",
          category: "authorization",
          stage: "artifact.reference.capability",
          taskRef: task.envelope.agentTaskRef,
        }),
      );
    await this.#referenceGuard.assertUsable(context, {
      schemaVersion: "1",
      artifactRef: ArtifactRefV1Schema.parse(artifactRef),
      projectId: task.envelope.projectId,
      purposeCode,
      requiredCapability: capability,
      authorization,
    });
  }

  async #readJsonArtifact(
    task: AgentTaskSnapshotV1,
    artifactRef: AgentTaskActionV1["intentArtifactRef"],
    authorization: AgentTaskEnvelopeV1["authorization"],
    purposeCode: string,
    requiredCapability?: AgentTaskEnvelopeV1["authorization"]["grantedCapabilities"][number],
  ): Promise<unknown> {
    const store = this.artifactStore;
    const capability = requiredCapability ?? authorization.grantedCapabilities[0];
    if (store === undefined || capability === undefined)
      throw new AgentRuntimeError(
        makeAgentError({
          code: store === undefined ? "AGENT_ARTIFACT_FAILURE" : "AGENT_AUTHORIZATION_DENIED",
          category: store === undefined ? "artifact" : "authorization",
          retryable: false,
          stage: "task.confirm.proposal-read",
          taskRef: task.envelope.agentTaskRef,
        }),
      );
    const now = IsoDateTimeSchema.parse(this.#now());
    const artifactVersion = artifactRef.reference.versionId;
    const requestId = `${task.envelope.agentTaskRef.reference.entityId}:${purposeCode}:${artifactVersion}`;
    const handle = await store.open({
      schemaVersion: "1",
      requestId,
      idempotencyKey: `${requestId}:open`,
      artifactRef: ArtifactRefV1Schema.parse(artifactRef),
      projectId: task.envelope.projectId,
      actorId: authorization.actorId,
      requestedAt: now,
      purposeCode,
      requiredCapability: capability,
      authorization,
    });
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of handle.content) {
      chunks.push(chunk);
      length += chunk.byteLength;
    }
    await handle.verified;
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder().decode(body)) as unknown;
    } catch {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_ARTIFACT_FAILURE",
          category: "artifact",
          retryable: false,
          stage: "task.confirm.proposal-json",
          taskRef: task.envelope.agentTaskRef,
        }),
      );
    }
  }

  async #verify(
    authorization: StartAgentTaskCommandV1["authorization"],
    projectId: string,
    branch: ModuleBranchV1,
    invocationId: string,
  ): Promise<void> {
    if (this.#authorization === undefined) return;
    const decision = await this.#authorization.verify({
      authorizationContextRef: authorization.authorizationContextRef,
      invocationId,
      projectId,
      branch,
      requestedSpatialScopeRefs: authorization.spatialScopeRefs,
      requestedSourceVersionRefs: [],
    });
    if (!isAuthorizationSubset(authorization, decision.context)) {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_AUTHORIZATION_DENIED",
          category: "authorization",
          stage: `authorization.${branch}`,
        }),
      );
    }
  }

  async #selectTaskById(
    id: string,
    database: Kysely<AgentRuntimeDatabase> | AgentTransaction = this.#db,
    forUpdate = false,
  ): Promise<AgentTaskRow | undefined> {
    const query = database
      .selectFrom("business.agent_tasks")
      .selectAll()
      .where("agent_task_id", "=", id);
    return (forUpdate ? query.forUpdate() : query).executeTakeFirst();
  }

  async #taskCommand(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly commandKind: string;
    readonly idempotencyKey: string;
    readonly payload: unknown;
    readonly actorId?: string;
    readonly authorization?: AgentTaskEnvelopeV1["authorization"];
    readonly issuedAt?: string;
  }): Promise<AtomicCommandV1> {
    const taskRef = AgentTaskRefV1Schema.parse(input.taskRef);
    const task = await this.getTask(taskRef);
    if (task === undefined)
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_TASK_NOT_FOUND",
          category: "not-found",
          stage: "task.command",
          taskRef,
        }),
      );
    const issuedAt = IsoDateTimeSchema.parse(input.issuedAt ?? this.#now());
    return commandFor({
      kind: input.commandKind,
      commandId: input.idempotencyKey,
      idempotencyKey: input.idempotencyKey,
      projectId: task.envelope.projectId,
      actorId: input.actorId ?? task.envelope.actorId,
      authorization: input.authorization ?? task.envelope.authorization,
      payload: input.payload,
      issuedAt,
    });
  }

  async getTask(taskRef: AgentTaskRefV1): Promise<AgentTaskSnapshotV1 | undefined> {
    const parsed = AgentTaskRefV1Schema.parse(taskRef);
    const row = await this.#selectTaskById(taskId(parsed));
    if (row === undefined) return undefined;
    const snapshot = rowSnapshot(row);
    return agentTaskRefEquals(snapshot.envelope.agentTaskRef, parsed) ? snapshot : undefined;
  }

  async createTask(input: {
    readonly envelope: AgentTaskEnvelopeV1;
    readonly state: AgentTaskStateV1;
    readonly budgetPolicy: AgentTaskDefinitionV1["budgetPolicy"];
    readonly budgetLedger: AgentBudgetLedgerV1;
  }): Promise<AgentTaskSnapshotV1> {
    const envelope = AgentTaskEnvelopeV1Schema.parse(input.envelope);
    const state = AgentTaskStateV1Schema.parse(input.state);
    const budgetPolicy = AgentTaskBudgetPolicyV1Schema.parse(input.budgetPolicy);
    const budgetLedger = AgentBudgetLedgerV1Schema.parse(input.budgetLedger);
    if (!agentTaskRefEquals(state.agentTaskRef, envelope.agentTaskRef))
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_INPUT_INVALID",
          category: "input",
          stage: "task.create.state-ref",
          taskRef: envelope.agentTaskRef,
        }),
      );
    if (
      !refEqual(budgetPolicy.policyRef, envelope.budgetPolicyRef) ||
      !refEqual(budgetPolicy.modelDeploymentRef, envelope.modelDeploymentRef) ||
      !refEqual(budgetPolicy.promptTemplateRef, envelope.promptTemplateRef) ||
      !refEqual(budgetPolicy.toolPolicyRef, envelope.toolPolicyRef)
    )
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_POLICY_MISMATCH",
          category: "policy",
          stage: "task.create.policy",
          taskRef: envelope.agentTaskRef,
        }),
      );
    const existing = await this.#selectTaskById(taskId(envelope.agentTaskRef));
    if (existing !== undefined) {
      const current = rowSnapshot(existing);
      const idempotencyIdentity = (value: AgentTaskEnvelopeV1) => {
        const stable = Object.fromEntries(
          Object.entries(value).filter(
            ([key]) => key !== "createdAt" && key !== "frozenAuthorization",
          ),
        );
        const stableAuthorization = Object.fromEntries(
          Object.entries(value.frozenAuthorization).filter(([key]) => key !== "capturedAt"),
        );
        return { ...stable, frozenAuthorization: stableAuthorization };
      };
      if (
        current.envelope.commandId !== envelope.commandId ||
        sha256CanonicalJson(idempotencyIdentity(current.envelope)) !==
          sha256CanonicalJson(idempotencyIdentity(envelope))
      ) {
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_IDEMPOTENCY_CONFLICT",
            category: "idempotency",
            stage: "task.create",
            taskRef: envelope.agentTaskRef,
            idempotencyKey: envelope.idempotencyKey,
            priorCommandId: current.envelope.commandId,
          }),
        );
      }
      return current;
    }
    const now = IsoDateTimeSchema.parse(envelope.createdAt);
    const command = commandFor({
      kind: "agent-task.start-task",
      commandId: envelope.commandId,
      idempotencyKey: envelope.idempotencyKey,
      projectId: envelope.projectId,
      actorId: envelope.actorId,
      authorization: envelope.authorization,
      payload: envelope,
      issuedAt: now,
    });
    await this.#transactionUnit.execute(command, async (context) => {
      const transaction = asTransaction(context);
      await transaction
        .insertInto("business.agent_tasks")
        .values({
          agent_task_id: taskId(envelope.agentTaskRef),
          version_id: envelope.agentTaskRef.reference.versionId,
          project_id: envelope.projectId,
          task_type: envelope.taskType,
          trigger_mode: envelope.triggerMode,
          agent_task_ref: jsonValue(envelope.agentTaskRef),
          envelope: jsonValue(envelope),
          status: state.status,
          task_version: state.taskVersion,
          cancel_requested: state.cancelRequested,
          cancel_reason_code: state.cancelReasonCode ?? null,
          result_ref: state.resultRef === undefined ? null : jsonValue(state.resultRef),
          error: state.error === undefined ? null : jsonValue(state.error),
          current_proposal_ref:
            state.currentProposalRef === undefined ? null : jsonValue(state.currentProposalRef),
          current_proposal_artifact_ref: null,
          latest_candidate_version: state.latestCandidateVersion ?? 0,
          budget_policy_ref: jsonValue(budgetPolicy.policyRef),
          budget_policy: jsonValue(budgetPolicy),
          budget_ledger: jsonValue(budgetLedger),
          parent_run_ref: jsonValue(envelope.parentRunRef),
          frozen_input_ref: jsonValue(envelope.frozenInputRef),
          authorization_context_ref: jsonValue(envelope.authorization.authorizationContextRef),
          frozen_authorization: jsonValue(envelope.frozenAuthorization),
          command_id: envelope.commandId,
          idempotency_key: envelope.idempotencyKey,
          created_at: new Date(envelope.createdAt),
          updated_at: new Date(envelope.createdAt),
        })
        .execute();
      return commit({
        command,
        targetRef: envelope.agentTaskRef,
        version: envelope.agentTaskRef.reference,
        action: "agent-task.start-task",
        now,
      });
    });
    const created = await this.getTask(envelope.agentTaskRef);
    if (created === undefined) {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_PERSISTENCE_FAILURE",
          category: "persistence",
          retryable: true,
          stage: "task.create.readback",
          taskRef: envelope.agentTaskRef,
        }),
      );
    }
    return created;
  }

  async startTask(command: StartAgentTaskCommandV1) {
    try {
      const valid = StartAgentTaskCommandV1Schema.parse(command);
      await this.#verify(
        valid.authorization,
        valid.projectId,
        "agent-task.start-task",
        valid.commandId,
      );
      const prepared = prepareAgentTaskStart(
        valid,
        this.#registry.get(valid.payload.taskType),
        this.#now(),
      );
      await this.createTask(prepared);
      return { kind: "succeeded" as const, result: { agentTaskRef: prepared.taskRef } };
    } catch (error) {
      return { kind: "failed" as const, error: this.#moduleError(error, command.projectId) };
    }
  }

  async #updateTask(
    transaction: AgentTransaction,
    taskRef: AgentTaskRefV1,
    state: AgentTaskStateV1,
    expectedVersion: number,
  ): Promise<void> {
    const result = await transaction
      .updateTable("business.agent_tasks")
      .set(taskStateUpdate(state))
      .where("agent_task_id", "=", taskId(taskRef))
      .where("task_version", "=", expectedVersion)
      .returning("agent_task_id")
      .executeTakeFirst();
    if (result === undefined) {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_STALE_VERSION",
          category: "concurrency",
          stage: "task.compare-and-set",
          taskRef,
          currentTaskVersion: expectedVersion,
        }),
      );
    }
  }

  async #commandTransaction(
    command: AtomicCommandV1,
    taskRef: AgentTaskRefV1,
    action: string,
    operation: (
      transaction: AgentTransaction,
      current: AgentTaskSnapshotV1,
      now: string,
      context: TransactionContextV1,
    ) => Promise<void>,
  ): Promise<AgentTaskSnapshotV1> {
    let result: AgentTaskSnapshotV1 | undefined;
    const now = IsoDateTimeSchema.parse(this.#now());
    const receipt = await this.#transactionUnit.execute(command, async (context) => {
      const transaction = asTransaction(context);
      const row = await this.#selectTaskById(taskId(taskRef), transaction, true);
      if (row === undefined)
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_TASK_NOT_FOUND",
            category: "not-found",
            stage: "task.lookup",
            taskRef,
          }),
        );
      const current = rowSnapshot(row);
      if (
        current.envelope.projectId !== command.projectId ||
        !agentTaskRefEquals(current.envelope.agentTaskRef, taskRef)
      )
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_AUTHORIZATION_DENIED",
            category: "authorization",
            stage: "task.target",
            taskRef,
          }),
        );
      await operation(transaction, current, now, context);
      result = await this.#selectTaskById(taskId(taskRef), transaction).then((next) =>
        next === undefined ? undefined : rowSnapshot(next),
      );
      if (result === undefined) throw new Error("agent task disappeared before commit");
      return commit({
        command,
        targetRef: taskRef,
        version:
          result.state.taskVersion === current.state.taskVersion
            ? current.envelope.agentTaskRef.reference
            : result.envelope.agentTaskRef.reference,
        action,
        now,
      });
    });
    if (result === undefined) {
      // C03 returns a durable receipt without re-running the handler on replay.
      // Read the already-committed task fact to preserve idempotent command semantics.
      const replayed = await this.getTask(taskRef);
      if (replayed === undefined || !receipt.replayed)
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_PERSISTENCE_FAILURE",
            category: "persistence",
            retryable: true,
            stage: "task.transaction.readback",
            taskRef,
          }),
        );
      result = replayed;
    }
    return result;
  }

  async #leaseTransaction(
    command: AtomicCommandV1,
    taskRef: AgentTaskRefV1,
    workerId: string,
    leaseToken: string,
    action: string,
    operation: AgentLeaseMutation,
    operationNow?: string,
  ): Promise<AgentTaskSnapshotV1> {
    let result: AgentTaskSnapshotV1 | undefined;
    const parsedTaskRef = AgentTaskRefV1Schema.parse(taskRef);
    const now = IsoDateTimeSchema.parse(operationNow ?? this.#now());
    const receipt = await this.#transactionUnit.execute(command, async (context) => {
      const transaction = asTransaction(context);
      const lease = await this.#lockLease(transaction, parsedTaskRef, workerId, leaseToken, now);
      if (lease.task.envelope.projectId !== command.projectId)
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_AUTHORIZATION_DENIED",
            category: "authorization",
            stage: "task.target",
            taskRef: parsedTaskRef,
          }),
        );
      await operation(transaction, lease.task, lease.attempt, now, context);
      const row = await this.#selectTaskById(taskId(parsedTaskRef), transaction);
      if (row === undefined) throw new Error("agent task disappeared before commit");
      result = rowSnapshot(row);
      return commit({
        command,
        targetRef: parsedTaskRef,
        version: result.envelope.agentTaskRef.reference,
        action,
        now,
      });
    });
    if (result === undefined) {
      const replayed = await this.getTask(parsedTaskRef);
      if (replayed === undefined || !receipt.replayed)
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_PERSISTENCE_FAILURE",
            category: "persistence",
            retryable: true,
            stage: "task.lease-transaction.readback",
            taskRef: parsedTaskRef,
          }),
        );
      result = replayed;
    }
    return result;
  }

  async resumeTask(command: ResumeAgentTaskCommandV1) {
    try {
      const valid = ResumeAgentTaskCommandV1Schema.parse(command);
      await this.#verify(
        valid.authorization,
        valid.projectId,
        "agent-task.resume-task",
        valid.commandId,
      );
      const taskRef = valid.payload.agentTaskRef;
      const atomic = commandFor({
        kind: "agent-task.resume-task",
        commandId: valid.commandId,
        idempotencyKey: valid.idempotencyKey,
        projectId: valid.projectId,
        actorId: valid.actorId,
        authorization: valid.authorization,
        payload: valid,
        issuedAt: valid.issuedAt,
      });
      const snapshot = await this.#commandTransaction(
        atomic,
        taskRef,
        "agent-task.resume-task",
        async (transaction, current, now) => {
          if (!canResumeAgentTask(current.state.status)) {
            throw new AgentRuntimeError(
              makeAgentError({
                code: "AGENT_CONFIRMATION_REQUIRED",
                category: "confirmation",
                stage: "task.resume.state",
                taskRef,
              }),
            );
          }
          if (
            current.state.status === "waiting-user-confirmation" &&
            valid.payload.resumeReason !== "user-confirmed"
          )
            throw new AgentRuntimeError(
              makeAgentError({
                code: "AGENT_CONFIRMATION_REQUIRED",
                category: "confirmation",
                stage: "task.resume.confirmation",
                taskRef,
              }),
            );
          if (
            current.state.status !== "waiting-user-confirmation" &&
            valid.payload.resumeReason === "user-confirmed"
          )
            throw new AgentRuntimeError(
              makeAgentError({
                code: "AGENT_INPUT_INVALID",
                category: "input",
                stage: "task.resume.reason",
                taskRef,
              }),
            );
          if (current.state.status === "pending") return;
          const next = transitionAgentTask(
            current.state,
            "pending",
            current.state.taskVersion,
            now,
          );
          await this.#updateTask(transaction, taskRef, next, current.state.taskVersion);
        },
      );
      const resultRef = snapshot.state.resultRef;
      if (resultRef === undefined) {
        return {
          kind: "failed" as const,
          error: this.#moduleError(
            makeAgentError({
              code: "AGENT_MODEL_FAILURE",
              category: "model",
              retryable: true,
              stage: "task.resume.pending",
              taskRef,
            }),
            valid.projectId,
          ),
        };
      }
      return {
        kind: "succeeded" as const,
        result: { agentTaskResultRef: AgentTaskResultRefV1Schema.parse(resultRef) },
      };
    } catch (error) {
      return { kind: "failed" as const, error: this.#moduleError(error, command.projectId) };
    }
  }

  async cancelTask(command: CancelAgentTaskCommandV1) {
    try {
      const valid = CancelAgentTaskCommandV1Schema.parse(command);
      await this.#verify(
        valid.authorization,
        valid.projectId,
        "agent-task.cancel-task",
        valid.commandId,
      );
      const taskRef = valid.payload.agentTaskRef;
      const atomic = commandFor({
        kind: "agent-task.cancel-task",
        commandId: valid.commandId,
        idempotencyKey: valid.idempotencyKey,
        projectId: valid.projectId,
        actorId: valid.actorId,
        authorization: valid.authorization,
        payload: valid,
        issuedAt: valid.issuedAt,
      });
      const snapshot = await this.#commandTransaction(
        atomic,
        taskRef,
        "agent-task.cancel-task",
        async (transaction, current, now) => {
          if (
            current.state.status === "completed" ||
            current.state.status === "terminal-failure" ||
            current.state.status === "cancelled"
          )
            return;
          const next = requestAgentTaskCancellation(
            current.state,
            current.state.taskVersion,
            valid.payload.reasonCode,
            now,
          );
          await this.#updateTask(transaction, taskRef, next, current.state.taskVersion);
        },
      );
      return {
        kind: "succeeded" as const,
        result: { agentTaskRef: snapshot.envelope.agentTaskRef },
      };
    } catch (error) {
      return { kind: "failed" as const, error: this.#moduleError(error, command.projectId) };
    }
  }

  async confirmCommand(command: ConfirmAgentCommandV1) {
    try {
      const valid = ConfirmAgentCommandV1Schema.parse(command);
      await this.#verify(
        valid.authorization,
        valid.projectId,
        "agent-task.confirm-command",
        valid.commandId,
      );
      const taskRef = valid.payload.agentTaskRef;
      const task = await this.getTask(taskRef);
      if (task === undefined)
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_TASK_NOT_FOUND",
            category: "not-found",
            stage: "task.confirm.task",
            taskRef,
          }),
        );
      const taskRow = await this.#selectTaskById(taskId(taskRef));
      if (taskRow === undefined || taskRow.current_proposal_artifact_ref === null)
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_CONFIRMATION_STALE",
            category: "confirmation",
            stage: "task.confirm.proposal-reference",
            taskRef,
          }),
        );
      const proposalArtifactRef = ArtifactRefV1Schema.parse(taskRow.current_proposal_artifact_ref);
      const proposal = AgentCommandProposalV1Schema.parse(
        await this.#readJsonArtifact(
          task,
          proposalArtifactRef,
          valid.authorization,
          "agent-command-proposal",
          "agent-task.confirm",
        ),
      );
      const targetReference =
        "reference" in proposal.targetRef ? proposal.targetRef.reference : undefined;
      if (
        !refEqual(
          proposal.commandProposalRef.reference,
          valid.payload.commandProposalRef.reference,
        ) ||
        !agentTaskRefEquals(proposal.taskRef, taskRef) ||
        proposal.projectId !== valid.projectId ||
        targetReference === undefined ||
        targetReference.entityId !== proposal.expectedTargetVersion.entityId ||
        targetReference.versionId !== proposal.expectedTargetVersion.versionId
      )
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_CONFIRMATION_STALE",
            category: "confirmation",
            stage: "task.confirm.proposal-schema",
            taskRef,
          }),
        );
      if (!authorizationWithinFrozenScope(task.envelope.frozenAuthorization, valid.authorization))
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_AUTHORIZATION_DENIED",
            category: "authorization",
            stage: "task.confirm.frozen-boundary",
            taskRef,
          }),
        );
      let commandResultRef: ContractReferenceV1 | undefined;
      let taskResultRef: AgentTaskResultRefV1 | undefined;
      if (valid.payload.confirmation === "confirmed") {
        const prior = await this.#db
          .selectFrom("business.agent_command_confirmations")
          .select(["decision", "command_result_ref"])
          .where("agent_task_id", "=", taskId(taskRef))
          .where("proposal_entity_id", "=", proposal.commandProposalRef.reference.entityId)
          .where("proposal_version_id", "=", proposal.commandProposalRef.reference.versionId)
          .executeTakeFirst();
        if (prior?.decision === "confirmed")
          return {
            kind: "succeeded" as const,
            result: { commandProposalRef: valid.payload.commandProposalRef },
          };
        if (prior?.decision === "rejected")
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_CONFIRMATION_STALE",
              category: "confirmation",
              stage: "task.confirm.decision",
              taskRef,
            }),
          );
        if (this.#commandExecutor === undefined)
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_INPUT_INVALID",
              category: "input",
              retryable: false,
              stage: "task.confirm.executor",
              taskRef,
            }),
          );
        const command = await this.#readJsonArtifact(
          task,
          proposal.commandArtifactRef,
          valid.authorization,
          "agent-command",
          "agent-task.confirm",
        );
        const executed = await this.#commandExecutor.execute({
          task,
          proposal,
          command,
          authorization: valid.authorization,
        });
        commandResultRef = ContractReferenceV1Schema.parse(executed.resultRef);
        taskResultRef = buildCompletedAgentTaskResult(
          taskRef,
          commandResultRef,
          undefined,
          this.#registry.get(taskRef.taskType).metadata.resultFamilies,
        );
      }
      const atomic = commandFor({
        kind: "agent-task.confirm-command",
        commandId: valid.commandId,
        idempotencyKey: valid.idempotencyKey,
        projectId: valid.projectId,
        actorId: valid.actorId,
        authorization: valid.authorization,
        payload: valid,
        issuedAt: valid.issuedAt,
      });
      await this.#commandTransaction(
        atomic,
        taskRef,
        "agent-task.confirm-command",
        async (transaction, current, now, context) => {
          if (
            current.state.status !== "waiting-user-confirmation" ||
            current.state.currentProposalRef === undefined ||
            !refEqual(
              current.state.currentProposalRef.reference,
              valid.payload.commandProposalRef.reference,
            )
          ) {
            throw new AgentRuntimeError(
              makeAgentError({
                code: "AGENT_CONFIRMATION_STALE",
                category: "confirmation",
                stage: "task.confirm.proposal",
                taskRef,
              }),
            );
          }
          const currentProposalRow = await this.#selectTaskById(taskId(taskRef), transaction, true);
          if (
            currentProposalRow === undefined ||
            currentProposalRow.current_proposal_artifact_ref === null
          )
            throw new AgentRuntimeError(
              makeAgentError({
                code: "AGENT_CONFIRMATION_STALE",
                category: "confirmation",
                stage: "task.confirm.proposal-reference",
                taskRef,
              }),
            );
          const currentProposalArtifactRef = ArtifactRefV1Schema.parse(
            currentProposalRow.current_proposal_artifact_ref,
          );
          if (!refEqual(currentProposalArtifactRef.reference, proposalArtifactRef.reference))
            throw new AgentRuntimeError(
              makeAgentError({
                code: "AGENT_CONFIRMATION_STALE",
                category: "confirmation",
                stage: "task.confirm.proposal-version",
                taskRef,
              }),
            );
          await this.#assertArtifactUsable(
            context,
            current,
            currentProposalArtifactRef,
            "agent-command-proposal",
            valid.authorization,
            "agent-task.confirm",
          );
          await this.#assertArtifactUsable(
            context,
            current,
            proposal.commandArtifactRef,
            "agent-command",
            valid.authorization,
            "agent-task.confirm",
          );
          const proposalRef = proposal.commandProposalRef;
          const previous = await transaction
            .selectFrom("business.agent_command_confirmations")
            .selectAll()
            .where("agent_task_id", "=", taskId(taskRef))
            .where("proposal_entity_id", "=", proposalRef.reference.entityId)
            .where("proposal_version_id", "=", proposalRef.reference.versionId)
            .executeTakeFirst();
          if (previous !== undefined && previous.decision !== valid.payload.confirmation) {
            throw new AgentRuntimeError(
              makeAgentError({
                code: "AGENT_CONFIRMATION_STALE",
                category: "confirmation",
                stage: "task.confirm.decision",
                taskRef,
              }),
            );
          }
          if (previous === undefined) {
            await transaction
              .insertInto("business.agent_command_confirmations")
              .values({
                agent_task_id: taskId(taskRef),
                proposal_entity_id: proposalRef.reference.entityId,
                proposal_version_id: proposalRef.reference.versionId,
                proposal_ref: jsonValue(proposal),
                decision: valid.payload.confirmation,
                actor_id: valid.actorId,
                authorization_context_ref: jsonValue(valid.authorization.authorizationContextRef),
                target_version_ref: jsonValue(proposal.expectedTargetVersion),
                command_idempotency_key: proposal.commandIdempotencyKey,
                command_result_ref:
                  commandResultRef === undefined ? null : jsonValue(commandResultRef),
                decided_at: new Date(now),
              })
              .execute();
          }
          if (valid.payload.confirmation === "confirmed") {
            const completedResult = taskResultRef;
            if (completedResult === undefined)
              throw new AgentRuntimeError(
                makeAgentError({
                  code: "AGENT_INPUT_INVALID",
                  category: "input",
                  stage: "task.confirm.result",
                  taskRef,
                }),
              );
            const next = transitionAgentTask(
              current.state,
              "completed",
              current.state.taskVersion,
              now,
              { resultRef: completedResult },
            );
            await this.#updateTask(transaction, taskRef, next, current.state.taskVersion);
          } else {
            const next = transitionAgentTask(
              current.state,
              "terminal-failure",
              current.state.taskVersion,
              now,
              {
                error: makeAgentError({
                  code: "AGENT_VALIDATION_REJECTED",
                  category: "validation",
                  stage: "task.confirm.rejected",
                  taskRef,
                }),
              },
            );
            await this.#updateTask(transaction, taskRef, next, current.state.taskVersion);
          }
          await transaction
            .updateTable("business.agent_tasks")
            .set({ current_proposal_artifact_ref: null })
            .where("agent_task_id", "=", taskId(taskRef))
            .execute();
        },
      );
      return {
        kind: "succeeded" as const,
        result: { commandProposalRef: valid.payload.commandProposalRef },
      };
    } catch (error) {
      return { kind: "failed" as const, error: this.#moduleError(error, command.projectId) };
    }
  }

  #moduleError(error: unknown, causalRunId: string) {
    if (error instanceof AccessServiceError) {
      const access = error.details;
      const diagnosticRef =
        access.diagnosticRef.kind === "diagnostic-artifact" ? access.diagnosticRef : undefined;
      const mapped =
        access.code === "AUTHORIZATION_DENIED"
          ? makeAgentError({
              code: "AGENT_AUTHORIZATION_DENIED",
              category: "authorization",
              stage: access.stage,
              ...(diagnosticRef === undefined ? {} : { diagnosticRef }),
            })
          : access.code === "STALE_ACCESS_VERSION"
            ? makeAgentError({
                code: "AGENT_STALE_VERSION",
                category: "concurrency",
                stage: access.stage,
                ...(diagnosticRef === undefined ? {} : { diagnosticRef }),
              })
            : access.code === "IDEMPOTENCY_CONFLICT"
              ? makeAgentError({
                  code: "AGENT_IDEMPOTENCY_CONFLICT",
                  category: "idempotency",
                  stage: access.stage,
                  idempotencyKey: access.idempotencyKey,
                  priorCommandId: access.priorCommandId,
                  ...(diagnosticRef === undefined ? {} : { diagnosticRef }),
                })
              : makeAgentError({
                  code: "AGENT_PERSISTENCE_FAILURE",
                  category: "persistence",
                  retryable: access.retryable,
                  stage: access.stage,
                  ...(diagnosticRef === undefined ? {} : { diagnosticRef }),
                });
      return mapAgentError(new AgentRuntimeError(mapped), { causalRunId });
    }
    if (error instanceof PostgresPersistenceError) {
      if (error.code === "IDEMPOTENCY_CONFLICT")
        return mapAgentError(
          new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_IDEMPOTENCY_CONFLICT",
              category: "idempotency",
              stage: error.stage,
              idempotencyKey: causalRunId,
              priorCommandId: causalRunId,
              diagnosticRef: error.diagnosticRef,
            }),
          ),
          { causalRunId },
        );
      return mapAgentError(
        new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_PERSISTENCE_FAILURE",
            category: "persistence",
            retryable: error.retryable,
            stage: error.stage,
            diagnosticRef: error.diagnosticRef,
          }),
        ),
        { causalRunId },
      );
    }
    if (error instanceof ArtifactStoreError) {
      return mapAgentError(
        new AgentRuntimeError(
          makeAgentError({
            code:
              error.code === "ARTIFACT_ACCESS_DENIED"
                ? "AGENT_AUTHORIZATION_DENIED"
                : "AGENT_ARTIFACT_FAILURE",
            category: error.code === "ARTIFACT_ACCESS_DENIED" ? "authorization" : "artifact",
            retryable: error.retryable,
            stage: error.stage,
            diagnosticRef: error.diagnosticRef,
          }),
        ),
        { causalRunId },
      );
    }
    return mapAgentError(error, { causalRunId });
  }

  async claim(input: {
    readonly workerId: string;
    readonly leaseDurationMs: number;
    readonly now?: string;
  }): Promise<AgentTaskClaimV1 | undefined> {
    const workerId = IdentifierSchema.parse(input.workerId);
    if (!Number.isSafeInteger(input.leaseDurationMs) || input.leaseDurationMs <= 0)
      throw new AgentRuntimeError(
        makeAgentError({ code: "AGENT_INPUT_INVALID", category: "input", stage: "claim.lease" }),
      );
    const now = IsoDateTimeSchema.parse(input.now ?? this.#now());
    const nowDate = new Date(now);
    try {
      const rows = await this.#db
        .selectFrom("business.agent_tasks")
        .selectAll()
        .where("status", "in", [...activeStatuses])
        .where("cancel_requested", "=", false)
        .orderBy("updated_at", "asc")
        .orderBy("agent_task_id", "asc")
        .limit(32)
        .execute();
      for (const row of rows) {
        const candidate = rowSnapshot(row);
        const key = commandKey(["agent-task", "claim", workerId, row.agent_task_id, now]);
        const command = commandFor({
          kind: "agent-task.claim",
          commandId: key,
          idempotencyKey: key,
          projectId: row.project_id,
          actorId: workerId,
          authorization: {
            authorizationContextRef: AuthorizationContextRefV1Schema.parse(
              row.authorization_context_ref,
            ),
          },
          payload: {
            workerId,
            taskRef: candidate.envelope.agentTaskRef,
            leaseDurationMs: input.leaseDurationMs,
            now,
          },
          issuedAt: now,
        });
        let claimed: AgentTaskClaimV1 | undefined;
        const receipt = await this.#transactionUnit.execute(command, async (context) => {
          const transaction = asTransaction(context);
          const currentRow = await transaction
            .selectFrom("business.agent_tasks")
            .selectAll()
            .where("agent_task_id", "=", row.agent_task_id)
            .forUpdate()
            .skipLocked()
            .executeTakeFirst();
          if (currentRow === undefined)
            return commit({
              command,
              targetRef: candidate.envelope.agentTaskRef,
              version: candidate.envelope.agentTaskRef.reference,
              action: "agent-task.claim",
              now,
            });
          const currentTask = rowSnapshot(currentRow);
          if (
            !activeStatuses.some((status) => status === currentTask.state.status) ||
            currentTask.state.cancelRequested
          )
            return commit({
              command,
              targetRef: currentTask.envelope.agentTaskRef,
              version: currentTask.envelope.agentTaskRef.reference,
              action: "agent-task.claim",
              now,
            });
          const existingLease = await transaction
            .selectFrom("business.agent_task_attempts")
            .selectAll()
            .where("agent_task_id", "=", currentRow.agent_task_id)
            .where("status", "=", "active")
            .forUpdate()
            .executeTakeFirst();
          if (existingLease !== undefined && asDate(existingLease.lease_until) > nowDate)
            return commit({
              command,
              targetRef: currentTask.envelope.agentTaskRef,
              version: currentTask.envelope.agentTaskRef.reference,
              action: "agent-task.claim",
              now,
            });
          if (existingLease !== undefined) {
            await transaction
              .updateTable("business.agent_task_attempts")
              .set({ status: "expired", finished_at: nowDate, lease_until: nowDate })
              .where("agent_task_id", "=", currentRow.agent_task_id)
              .where("attempt_number", "=", existingLease.attempt_number)
              .execute();
          }
          const previousAttempt = await transaction
            .selectFrom("business.agent_task_attempts")
            .select("attempt_number")
            .where("agent_task_id", "=", currentRow.agent_task_id)
            .orderBy("attempt_number", "desc")
            .limit(1)
            .executeTakeFirst();
          const attemptNumber = (previousAttempt?.attempt_number ?? 0) + 1;
          const leaseToken = randomUUID();
          const leaseUntil = new Date(nowDate.getTime() + input.leaseDurationMs);
          const updated = await transaction
            .updateTable("business.agent_tasks")
            .set({
              status: "running",
              task_version: sql`task_version + 1`,
              error: null,
              current_proposal_ref: null,
              current_proposal_artifact_ref: null,
              updated_at: nowDate,
            })
            .where("agent_task_id", "=", currentRow.agent_task_id)
            .where("task_version", "=", currentRow.task_version)
            .where("status", "in", [...activeStatuses])
            .returningAll()
            .executeTakeFirst();
          if (updated === undefined)
            return commit({
              command,
              targetRef: currentTask.envelope.agentTaskRef,
              version: currentTask.envelope.agentTaskRef.reference,
              action: "agent-task.claim",
              now,
            });
          await transaction
            .insertInto("business.agent_task_attempts")
            .values({
              agent_task_id: currentRow.agent_task_id,
              attempt_number: attemptNumber,
              worker_id: workerId,
              lease_token: leaseToken,
              lease_until: leaseUntil,
              status: "active",
              started_at: nowDate,
              heartbeat_at: nowDate,
              finished_at: null,
              failure: null,
            })
            .execute();
          const task = rowSnapshot(updated);
          claimed = {
            task,
            attemptNumber,
            workerId,
            leaseToken,
            leaseUntil: leaseUntil.toISOString(),
          };
          return commit({
            command,
            targetRef: task.envelope.agentTaskRef,
            version: task.envelope.agentTaskRef.reference,
            action: "agent-task.claim",
            now,
          });
        });
        if (claimed === undefined && receipt.replayed) {
          const replayedTask = await this.getTask(candidate.envelope.agentTaskRef);
          const replayedAttempt = await this.#db
            .selectFrom("business.agent_task_attempts")
            .selectAll()
            .where("agent_task_id", "=", row.agent_task_id)
            .where("worker_id", "=", workerId)
            .where("status", "=", "active")
            .where("lease_until", ">", nowDate)
            .orderBy("attempt_number", "desc")
            .executeTakeFirst();
          if (replayedTask !== undefined && replayedAttempt !== undefined)
            claimed = {
              task: replayedTask,
              attemptNumber: replayedAttempt.attempt_number,
              workerId,
              leaseToken: replayedAttempt.lease_token,
              leaseUntil: asIso(replayedAttempt.lease_until),
            };
        }
        if (claimed !== undefined) return claimed;
      }
      return undefined;
    } catch (error) {
      if (error instanceof AgentRuntimeError) throw error;
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_PERSISTENCE_FAILURE",
          category: "persistence",
          retryable: true,
          stage: "claim",
        }),
      );
    }
  }

  async heartbeat(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly leaseDurationMs: number;
    readonly now?: string;
  }): Promise<string> {
    if (!Number.isSafeInteger(input.leaseDurationMs) || input.leaseDurationMs <= 0)
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_INPUT_INVALID",
          category: "input",
          stage: "lease.heartbeat.duration",
          taskRef: input.taskRef,
        }),
      );
    const now = IsoDateTimeSchema.parse(input.now ?? this.#now());
    const nowDate = new Date(now);
    const leaseUntil = new Date(nowDate.getTime() + input.leaseDurationMs);
    const taskRef = AgentTaskRefV1Schema.parse(input.taskRef);
    const key = commandKey(["agent-task", "heartbeat", taskId(taskRef), input.leaseToken, now]);
    const command = await this.#taskCommand({
      taskRef,
      commandKind: "agent-task.heartbeat",
      idempotencyKey: key,
      actorId: input.workerId,
      payload: {
        taskRef,
        workerId: input.workerId,
        leaseToken: input.leaseToken,
        leaseDurationMs: input.leaseDurationMs,
        now,
      },
      issuedAt: now,
    });
    let result: string | undefined;
    const receipt = await this.#transactionUnit.execute(command, async (context) => {
      const transaction = asTransaction(context);
      await this.#lockLease(transaction, taskRef, input.workerId, input.leaseToken, now);
      const updated = await transaction
        .updateTable("business.agent_task_attempts")
        .set({ lease_until: leaseUntil, heartbeat_at: nowDate })
        .where("agent_task_id", "=", taskId(taskRef))
        .where("worker_id", "=", IdentifierSchema.parse(input.workerId))
        .where("lease_token", "=", IdentifierSchema.parse(input.leaseToken))
        .where("status", "=", "active")
        .where("lease_until", ">", nowDate)
        .returning("lease_until")
        .executeTakeFirst();
      if (updated === undefined)
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_STALE_VERSION",
            category: "concurrency",
            stage: "lease.heartbeat",
            taskRef,
          }),
        );
      result = asIso(updated.lease_until);
      return commit({
        command,
        targetRef: taskRef,
        version: taskRef.reference,
        action: "agent-task.heartbeat",
        now,
      });
    });
    if (result === undefined) {
      if (!receipt.replayed)
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_PERSISTENCE_FAILURE",
            category: "persistence",
            retryable: true,
            stage: "lease.heartbeat.readback",
            taskRef,
          }),
        );
      const replayed = await this.#db
        .selectFrom("business.agent_task_attempts")
        .select("lease_until")
        .where("agent_task_id", "=", taskId(taskRef))
        .where("worker_id", "=", IdentifierSchema.parse(input.workerId))
        .where("lease_token", "=", IdentifierSchema.parse(input.leaseToken))
        .executeTakeFirst();
      if (replayed === undefined)
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_STALE_VERSION",
            category: "concurrency",
            stage: "lease.heartbeat.readback",
            taskRef,
          }),
        );
      result = asIso(replayed.lease_until);
    }
    return result;
  }

  async releaseLease(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly status?: "released" | "cancelled" | "completed";
    readonly now?: string;
  }): Promise<void> {
    const now = IsoDateTimeSchema.parse(input.now ?? this.#now());
    const taskRef = AgentTaskRefV1Schema.parse(input.taskRef);
    const status = input.status ?? "released";
    const key = commandKey([
      "agent-task",
      "lease-release",
      taskId(taskRef),
      input.leaseToken,
      status,
    ]);
    const command = await this.#taskCommand({
      taskRef,
      commandKind: "agent-task.lease-release",
      idempotencyKey: key,
      actorId: input.workerId,
      payload: { taskRef, workerId: input.workerId, leaseToken: input.leaseToken, status, now },
      issuedAt: now,
    });
    await this.#transactionUnit.execute(command, async (context) => {
      const transaction = asTransaction(context);
      const updated = await transaction
        .updateTable("business.agent_task_attempts")
        .set({ status, finished_at: new Date(now), lease_until: new Date(now) })
        .where("agent_task_id", "=", taskId(taskRef))
        .where("worker_id", "=", IdentifierSchema.parse(input.workerId))
        .where("lease_token", "=", IdentifierSchema.parse(input.leaseToken))
        .where("status", "=", "active")
        .returning("agent_task_id")
        .executeTakeFirst();
      if (updated === undefined)
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_STALE_VERSION",
            category: "concurrency",
            stage: "lease.release",
            taskRef,
          }),
        );
      return commit({
        command,
        targetRef: taskRef,
        version: taskRef.reference,
        action: "agent-task.lease-release",
        now,
      });
    });
  }

  async failTask(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly error: AgentStructuredErrorV1;
    readonly now?: string;
  }): Promise<AgentTaskSnapshotV1> {
    const now = IsoDateTimeSchema.parse(input.now ?? this.#now());
    const error = AgentStructuredErrorV1Schema.parse(input.error);
    const taskRef = AgentTaskRefV1Schema.parse(input.taskRef);
    const key = commandKey([
      "agent-task",
      "task-fail",
      taskId(taskRef),
      input.leaseToken,
      error.code,
    ]);
    const command = await this.#taskCommand({
      taskRef,
      commandKind: "agent-task.task-fail",
      idempotencyKey: key,
      actorId: input.workerId,
      payload: { taskRef, workerId: input.workerId, leaseToken: input.leaseToken, error, now },
      issuedAt: now,
    });
    return this.#leaseTransaction(
      command,
      taskRef,
      input.workerId,
      input.leaseToken,
      "agent-task.task-fail",
      async (transaction, current, attempt) => {
        const nextStatus =
          error.code === "AGENT_CANCELLED"
            ? "cancelled"
            : error.retryable
              ? "retryable-failure"
              : "terminal-failure";
        const next = transitionAgentTask(
          current.state,
          nextStatus,
          current.state.taskVersion,
          now,
          { error },
        );
        await this.#updateTask(transaction, taskRef, next, current.state.taskVersion);
        await transaction
          .updateTable("business.agent_task_attempts")
          .set({
            status: nextStatus === "cancelled" ? "cancelled" : "released",
            finished_at: new Date(now),
            lease_until: new Date(now),
            failure: jsonValue(error),
          })
          .where("agent_task_id", "=", taskId(taskRef))
          .where("attempt_number", "=", attempt.attempt_number)
          .where("status", "=", "active")
          .execute();
      },
      now,
    );
  }

  async #lockLease(
    transaction: AgentTransaction,
    taskRef: AgentTaskRefV1,
    workerId: string,
    leaseToken: string,
    now: string,
  ): Promise<{ readonly task: AgentTaskSnapshotV1; readonly attempt: AgentTaskAttemptRow }> {
    const parsed = AgentTaskRefV1Schema.parse(taskRef);
    const row = await this.#selectTaskById(taskId(parsed), transaction, true);
    if (row === undefined)
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_TASK_NOT_FOUND",
          category: "not-found",
          stage: "lease.task",
          taskRef: parsed,
        }),
      );
    const attempt = await transaction
      .selectFrom("business.agent_task_attempts")
      .selectAll()
      .where("agent_task_id", "=", taskId(parsed))
      .where("worker_id", "=", IdentifierSchema.parse(workerId))
      .where("lease_token", "=", IdentifierSchema.parse(leaseToken))
      .where("status", "=", "active")
      .where("lease_until", ">", new Date(now))
      .forUpdate()
      .executeTakeFirst();
    if (attempt === undefined)
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_STALE_VERSION",
          category: "concurrency",
          stage: "lease.validate",
          taskRef: parsed,
        }),
      );
    const task = rowSnapshot(row);
    if (!agentTaskRefEquals(task.envelope.agentTaskRef, parsed))
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_AUTHORIZATION_DENIED",
          category: "authorization",
          stage: "lease.task-ref",
          taskRef: parsed,
        }),
      );
    if (task.state.cancelRequested)
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_CANCELLED",
          category: "cancelled",
          stage: "lease.cancelled",
          taskRef: parsed,
        }),
      );
    if (task.state.status !== "running")
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_INPUT_INVALID",
          category: "input",
          stage: "lease.state",
          taskRef: parsed,
        }),
      );
    return { task, attempt };
  }

  async reserveAction(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly actionId: string;
    readonly reservationId: string;
    readonly actionType: AgentTaskActionV1["actionType"];
    readonly sequence: number;
    readonly idempotencyKey: string;
    readonly intentArtifactRef: AgentTaskActionV1["intentArtifactRef"];
    readonly amount?: Partial<AgentBudgetUsageV1>;
    readonly now?: string;
  }): Promise<AgentTaskActionReservationV1> {
    const now = IsoDateTimeSchema.parse(input.now ?? this.#now());
    const taskRef = AgentTaskRefV1Schema.parse(input.taskRef);
    const actionId = IdentifierSchema.parse(input.actionId);
    const reservationId = IdentifierSchema.parse(input.reservationId);
    const sequence = input.sequence;
    const idempotencyKey = IdentifierSchema.parse(input.idempotencyKey);
    const intentArtifactRef = input.intentArtifactRef;
    if (intentArtifactRef === undefined)
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_INPUT_INVALID",
          category: "input",
          stage: "action.reserve.intent",
          taskRef,
          actionId,
        }),
      );
    const key = commandKey([
      "agent-task",
      "action-reserve",
      taskId(taskRef),
      actionId,
      reservationId,
    ]);
    const command = await this.#taskCommand({
      taskRef,
      commandKind: "agent-task.action-reserve",
      idempotencyKey: key,
      actorId: input.workerId,
      payload: {
        taskRef,
        workerId: input.workerId,
        leaseToken: input.leaseToken,
        actionId,
        reservationId,
        actionType: input.actionType,
        sequence,
        idempotencyKey,
        intentArtifactRef,
        amount: input.amount ?? {},
        now,
      },
      issuedAt: now,
    });
    let result: AgentTaskActionReservationV1 | undefined;
    const receipt = await this.#transactionUnit.execute(command, async (context) => {
      const transaction = asTransaction(context);
      const lease = await this.#lockLease(
        transaction,
        taskRef,
        input.workerId,
        input.leaseToken,
        now,
      );
      await this.#assertArtifactUsable(
        context,
        lease.task,
        intentArtifactRef,
        "agent-action-intent",
      );
      const existing = await transaction
        .selectFrom("business.agent_task_actions")
        .selectAll()
        .where("agent_task_id", "=", taskId(taskRef))
        .where("action_id", "=", actionId)
        .forUpdate()
        .executeTakeFirst();
      if (existing !== undefined) {
        const action = actionFromRow(lease.task.envelope.agentTaskRef, existing);
        if (action.status === "uncertain")
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_ACTION_UNCERTAIN",
              category: "action",
              retryable: false,
              stage: "budget.reserve.uncertain-action",
              taskRef,
              actionId,
            }),
          );
        if (action.status !== "failed") {
          result = { task: lease.task, reservation: action.reservation };
          return commit({
            command,
            targetRef: taskRef,
            version: taskRef.reference,
            action: "agent-task.action-reserve",
            now,
          });
        }
        const budget = reserveAgentBudget(lease.task.budgetPolicy, lease.task.budgetLedger, {
          actionType: input.actionType,
          actionId,
          reservationId,
          amount: {
            ...input.amount,
            transientRetries: (input.amount?.transientRetries ?? 0) + 1,
          },
          now,
        });
        const updated = await transaction
          .updateTable("business.agent_tasks")
          .set({ budget_ledger: jsonValue(budget.ledger), updated_at: new Date(now) })
          .where("agent_task_id", "=", taskId(taskRef))
          .where("task_version", "=", lease.task.state.taskVersion)
          .returningAll()
          .executeTakeFirst();
        if (updated === undefined)
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_STALE_VERSION",
              category: "concurrency",
              stage: "budget.retry.cas",
              taskRef,
            }),
          );
        await transaction
          .updateTable("business.agent_task_actions")
          .set({
            attempt_number: lease.attempt.attempt_number,
            status: "started",
            intent_artifact_ref: jsonValue(intentArtifactRef),
            reservation: jsonValue(budget.reservation),
            usage: jsonValue(emptyAgentBudgetUsage()),
            error_code: null,
            recorded_at: new Date(now),
            completed_at: null,
          })
          .where("agent_task_id", "=", taskId(taskRef))
          .where("action_id", "=", actionId)
          .execute();
        result = { task: rowSnapshot(updated), reservation: budget.reservation };
        return commit({
          command,
          targetRef: taskRef,
          version: taskRef.reference,
          action: "agent-task.action-reserve",
          now,
        });
      }
      const budget = reserveAgentBudget(lease.task.budgetPolicy, lease.task.budgetLedger, {
        actionType: input.actionType,
        actionId,
        reservationId,
        amount: {
          ...input.amount,
          ...(lease.attempt.attempt_number > 1
            ? { transientRetries: (input.amount?.transientRetries ?? 0) + 1 }
            : {}),
        },
        now,
      });
      const updated = await transaction
        .updateTable("business.agent_tasks")
        .set({ budget_ledger: jsonValue(budget.ledger), updated_at: new Date(now) })
        .where("agent_task_id", "=", taskId(taskRef))
        .where("task_version", "=", lease.task.state.taskVersion)
        .returningAll()
        .executeTakeFirst();
      if (updated === undefined)
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_STALE_VERSION",
            category: "concurrency",
            stage: "budget.reserve",
            taskRef,
          }),
        );
      const action = AgentTaskActionV1Schema.parse({
        schemaVersion: "1",
        taskRef,
        actionId,
        sequence,
        actionType: input.actionType,
        status: "started",
        idempotencyKey,
        intentArtifactRef,
        reservation: budget.reservation,
        usage: emptyAgentBudgetUsage(),
        recordedAt: now,
      });
      await transaction
        .insertInto("business.agent_task_actions")
        .values({
          agent_task_id: taskId(taskRef),
          action_id: action.actionId,
          attempt_number: lease.attempt.attempt_number,
          sequence: action.sequence,
          action_type: action.actionType,
          status: action.status,
          idempotency_key: action.idempotencyKey,
          intent_artifact_ref: jsonValue(action.intentArtifactRef),
          result_ref: null,
          result_artifact_ref: null,
          reservation: jsonValue(action.reservation),
          usage: jsonValue(action.usage),
          error_code: null,
          recorded_at: new Date(now),
          completed_at: null,
        })
        .execute();
      result = { task: rowSnapshot(updated), reservation: budget.reservation };
      return commit({
        command,
        targetRef: taskRef,
        version: taskRef.reference,
        action: "agent-task.action-reserve",
        now,
      });
    });
    if (result === undefined) {
      if (!receipt.replayed)
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_PERSISTENCE_FAILURE",
            category: "persistence",
            retryable: true,
            stage: "action.reserve.readback",
            taskRef,
            actionId,
          }),
        );
      const task = await this.getTask(taskRef);
      const action = task === undefined ? undefined : await this.findAction(taskRef, actionId);
      if (task === undefined || action === undefined)
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_PERSISTENCE_FAILURE",
            category: "persistence",
            retryable: true,
            stage: "action.reserve.replay-readback",
            taskRef,
            actionId,
          }),
        );
      result = { task, reservation: action.reservation };
    }
    return result;
  }

  async findAction(
    taskRef: AgentTaskRefV1,
    actionId: string,
  ): Promise<AgentTaskActionV1 | undefined> {
    const parsed = AgentTaskRefV1Schema.parse(taskRef);
    const row = await this.#selectTaskById(taskId(parsed));
    if (row === undefined) return undefined;
    const action = await this.#db
      .selectFrom("business.agent_task_actions")
      .selectAll()
      .where("agent_task_id", "=", taskId(parsed))
      .where("action_id", "=", IdentifierSchema.parse(actionId))
      .executeTakeFirst();
    return action === undefined
      ? undefined
      : actionFromRow(rowSnapshot(row).envelope.agentTaskRef, action);
  }

  async completeAction(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly actionId: string;
    readonly resultRef?: ContractReferenceV1;
    readonly resultArtifactRef?: AgentTaskActionV1["resultArtifactRef"];
    readonly usage: AgentBudgetUsageV1;
    readonly activeWallClockMs?: number;
    readonly now?: string;
  }): Promise<AgentTaskSnapshotV1> {
    const now = IsoDateTimeSchema.parse(input.now ?? this.#now());
    const taskRef = AgentTaskRefV1Schema.parse(input.taskRef);
    const actionId = IdentifierSchema.parse(input.actionId);
    const requestedUsage = AgentBudgetUsageV1Schema.parse(input.usage);
    const key = commandKey([
      "agent-task",
      "action-complete",
      taskId(taskRef),
      actionId,
      input.leaseToken,
    ]);
    const command = await this.#taskCommand({
      taskRef,
      commandKind: "agent-task.action-complete",
      idempotencyKey: key,
      actorId: input.workerId,
      payload: {
        taskRef,
        workerId: input.workerId,
        leaseToken: input.leaseToken,
        actionId,
        resultRef: input.resultRef ?? null,
        resultArtifactRef: input.resultArtifactRef ?? null,
        usage: requestedUsage,
        now,
      },
      issuedAt: now,
    });
    return this.#leaseTransaction(
      command,
      taskRef,
      input.workerId,
      input.leaseToken,
      "agent-task.action-complete",
      async (transaction, current, _attempt, _now, context) => {
        const row = await transaction
          .selectFrom("business.agent_task_actions")
          .selectAll()
          .where("agent_task_id", "=", taskId(taskRef))
          .where("action_id", "=", actionId)
          .forUpdate()
          .executeTakeFirst();
        if (row === undefined)
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_TASK_NOT_FOUND",
              category: "not-found",
              stage: "action.complete",
              taskRef,
              actionId,
            }),
          );
        const actionValue = actionFromRow(current.envelope.agentTaskRef, row);
        if (actionValue.status === "completed") return;
        if (actionValue.status === "uncertain")
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_ACTION_UNCERTAIN",
              category: "action",
              retryable: false,
              stage: "action.complete.uncertain",
              taskRef,
              actionId,
            }),
          );
        if (actionValue.status !== "started")
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_INPUT_INVALID",
              category: "input",
              stage: "action.complete.status",
              taskRef,
              actionId,
            }),
          );
        if (input.resultRef === undefined && input.resultArtifactRef === undefined)
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_INPUT_INVALID",
              category: "input",
              stage: "action.complete.result",
              taskRef,
              actionId,
            }),
          );
        if (input.resultArtifactRef !== undefined)
          await this.#assertArtifactUsable(
            context,
            current,
            input.resultArtifactRef,
            actionValue.actionType === "domain-tool"
              ? "agent-tool-observation"
              : "agent-action-result",
          );
        const usage = normalizeAgentActionUsage(actionValue.actionType, requestedUsage);
        const budget = settleAgentBudget(
          current.budgetPolicy,
          current.budgetLedger,
          actionValue.reservation,
          usage,
          now,
          input.activeWallClockMs ?? 0,
        );
        await transaction
          .updateTable("business.agent_task_actions")
          .set({
            status: "completed",
            result_ref: input.resultRef === undefined ? null : jsonValue(input.resultRef),
            result_artifact_ref:
              input.resultArtifactRef === undefined ? null : jsonValue(input.resultArtifactRef),
            usage: jsonValue(usage),
            completed_at: new Date(now),
          })
          .where("agent_task_id", "=", taskId(taskRef))
          .where("action_id", "=", actionValue.actionId)
          .execute();
        const updated = await transaction
          .updateTable("business.agent_tasks")
          .set({ budget_ledger: jsonValue(budget), updated_at: new Date(now) })
          .where("agent_task_id", "=", taskId(taskRef))
          .where("task_version", "=", current.state.taskVersion)
          .returningAll()
          .executeTakeFirst();
        if (updated === undefined)
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_STALE_VERSION",
              category: "concurrency",
              stage: "action.complete.cas",
              taskRef,
            }),
          );
      },
      now,
    );
  }

  async completeTask(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly resultRef: AgentTaskResultRefV1;
    readonly now?: string;
  }): Promise<AgentTaskSnapshotV1> {
    const now = IsoDateTimeSchema.parse(input.now ?? this.#now());
    const resultRef = AgentTaskResultRefV1Schema.parse(input.resultRef);
    const taskRef = AgentTaskRefV1Schema.parse(input.taskRef);
    const key = commandKey(["agent-task", "task-complete", taskId(taskRef), input.leaseToken]);
    const command = await this.#taskCommand({
      taskRef,
      commandKind: "agent-task.task-complete",
      idempotencyKey: key,
      actorId: input.workerId,
      payload: {
        taskRef,
        workerId: input.workerId,
        leaseToken: input.leaseToken,
        resultRef,
        now,
      },
      issuedAt: now,
    });
    return this.#leaseTransaction(
      command,
      taskRef,
      input.workerId,
      input.leaseToken,
      "agent-task.task-complete",
      async (transaction, current, attempt) => {
        const completedAction = await transaction
          .selectFrom("business.agent_task_actions")
          .select("action_id")
          .where("agent_task_id", "=", taskId(taskRef))
          .where("status", "=", "completed")
          .where((expression) =>
            expression.or([
              expression("result_ref", "is not", null),
              expression("result_artifact_ref", "is not", null),
            ]),
          )
          .executeTakeFirst();
        if (completedAction === undefined)
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_INPUT_INVALID",
              category: "input",
              stage: "task.complete.action",
              taskRef,
            }),
          );
        const next = transitionAgentTask(
          current.state,
          "completed",
          current.state.taskVersion,
          now,
          { resultRef },
        );
        await this.#updateTask(transaction, taskRef, next, current.state.taskVersion);
        await transaction
          .updateTable("business.agent_task_attempts")
          .set({ status: "completed", finished_at: new Date(now), lease_until: new Date(now) })
          .where("agent_task_id", "=", taskId(taskRef))
          .where("attempt_number", "=", attempt.attempt_number)
          .where("status", "=", "active")
          .execute();
      },
      now,
    );
  }

  async failAction(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly actionId: string;
    readonly error: AgentStructuredErrorV1;
    readonly resultArtifactRef?: AgentTaskActionV1["resultArtifactRef"];
    readonly usage?: AgentBudgetUsageV1;
    readonly activeWallClockMs?: number;
    readonly uncertain?: boolean;
    readonly now?: string;
  }): Promise<AgentTaskSnapshotV1> {
    const now = IsoDateTimeSchema.parse(input.now ?? this.#now());
    const error = AgentStructuredErrorV1Schema.parse(input.error);
    const taskRef = AgentTaskRefV1Schema.parse(input.taskRef);
    const actionId = IdentifierSchema.parse(input.actionId);
    const uncertain = input.uncertain === true || error.code === "AGENT_ACTION_UNCERTAIN";
    const requestedUsage = AgentBudgetUsageV1Schema.parse(input.usage ?? emptyAgentBudgetUsage());
    const key = commandKey([
      "agent-task",
      "action-fail",
      taskId(taskRef),
      actionId,
      input.leaseToken,
      error.code,
      uncertain ? "uncertain" : "settled",
    ]);
    const command = await this.#taskCommand({
      taskRef,
      commandKind: "agent-task.action-fail",
      idempotencyKey: key,
      actorId: input.workerId,
      payload: {
        taskRef,
        workerId: input.workerId,
        leaseToken: input.leaseToken,
        actionId,
        error,
        resultArtifactRef: input.resultArtifactRef ?? null,
        usage: requestedUsage,
        uncertain,
        now,
      },
      issuedAt: now,
    });
    return this.#leaseTransaction(
      command,
      taskRef,
      input.workerId,
      input.leaseToken,
      "agent-task.action-fail",
      async (transaction, current, _attempt, _now, context) => {
        const row = await transaction
          .selectFrom("business.agent_task_actions")
          .selectAll()
          .where("agent_task_id", "=", taskId(taskRef))
          .where("action_id", "=", actionId)
          .forUpdate()
          .executeTakeFirst();
        if (row === undefined)
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_TASK_NOT_FOUND",
              category: "not-found",
              stage: "action.fail",
              taskRef,
              actionId,
            }),
          );
        const action = actionFromRow(current.envelope.agentTaskRef, row);
        if (action.status === "completed") return;
        if (action.status === "uncertain") return;
        const usage = normalizeAgentActionUsage(action.actionType, requestedUsage);
        if (input.resultArtifactRef !== undefined)
          await this.#assertArtifactUsable(
            context,
            current,
            input.resultArtifactRef,
            action.actionType === "domain-tool" ? "agent-tool-observation" : "agent-action-result",
          );
        const budgetLedger = settleAgentBudget(
          current.budgetPolicy,
          current.budgetLedger,
          action.reservation,
          usage,
          now,
          input.activeWallClockMs ?? 0,
          { allowWallClockOverrun: error.code === "AGENT_WALL_CLOCK_EXCEEDED" },
        );
        const next = transitionAgentTask(
          current.state,
          uncertain || !error.retryable ? "terminal-failure" : "retryable-failure",
          current.state.taskVersion,
          now,
          { error },
        );
        await transaction
          .updateTable("business.agent_task_actions")
          .set({
            status: uncertain ? "uncertain" : "failed",
            result_artifact_ref:
              input.resultArtifactRef === undefined ? null : jsonValue(input.resultArtifactRef),
            error_code: error.code,
            usage: jsonValue(usage),
            completed_at: new Date(now),
          })
          .where("agent_task_id", "=", taskId(taskRef))
          .where("action_id", "=", action.actionId)
          .execute();
        const updated = await transaction
          .updateTable("business.agent_tasks")
          .set({ ...taskStateUpdate(next), budget_ledger: jsonValue(budgetLedger) })
          .where("agent_task_id", "=", taskId(taskRef))
          .where("task_version", "=", current.state.taskVersion)
          .returning("agent_task_id")
          .executeTakeFirst();
        if (updated === undefined)
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_STALE_VERSION",
              category: "concurrency",
              stage: "action.fail.cas",
              taskRef,
              actionId,
            }),
          );
      },
      now,
    );
  }

  async markWaiting(input: {
    readonly taskRef: AgentTaskRefV1;
    readonly workerId: string;
    readonly leaseToken: string;
    readonly proposalRef: ContractReferenceV1;
    readonly proposalArtifactRef: AgentTaskActionV1["intentArtifactRef"];
    readonly now?: string;
  }): Promise<AgentTaskSnapshotV1> {
    const now = IsoDateTimeSchema.parse(input.now ?? this.#now());
    const taskRef = AgentTaskRefV1Schema.parse(input.taskRef);
    const proposalRef = AgentCommandProposalV1Schema.shape.commandProposalRef.parse(
      input.proposalRef,
    );
    const key = commandKey([
      "agent-task",
      "wait",
      taskId(taskRef),
      input.leaseToken,
      proposalRef.reference.entityId,
      proposalRef.reference.versionId,
    ]);
    const command = await this.#taskCommand({
      taskRef,
      commandKind: "agent-task.wait",
      idempotencyKey: key,
      actorId: input.workerId,
      payload: {
        taskRef,
        workerId: input.workerId,
        leaseToken: input.leaseToken,
        proposalRef,
        proposalArtifactRef: input.proposalArtifactRef,
        now,
      },
      issuedAt: now,
    });
    return this.#leaseTransaction(
      command,
      taskRef,
      input.workerId,
      input.leaseToken,
      "agent-task.wait",
      async (transaction, current, attempt, _now, context) => {
        await this.#assertArtifactUsable(
          context,
          current,
          input.proposalArtifactRef,
          "agent-command-proposal",
        );
        const next = transitionAgentTask(
          current.state,
          "waiting-user-confirmation",
          current.state.taskVersion,
          now,
          { currentProposalRef: proposalRef },
        );
        await this.#updateTask(transaction, taskRef, next, current.state.taskVersion);
        await transaction
          .updateTable("business.agent_tasks")
          .set({ current_proposal_artifact_ref: jsonValue(input.proposalArtifactRef) })
          .where("agent_task_id", "=", taskId(taskRef))
          .execute();
        await transaction
          .updateTable("business.agent_task_attempts")
          .set({ status: "released", finished_at: new Date(now), lease_until: new Date(now) })
          .where("agent_task_id", "=", taskId(taskRef))
          .where("attempt_number", "=", attempt.attempt_number)
          .where("status", "=", "active")
          .execute();
      },
      now,
    );
  }

  async recordCandidate(input: {
    readonly candidate: AgentCandidateVersionV1;
    readonly workerId: string;
    readonly leaseToken: string;
  }): Promise<void> {
    const value = AgentCandidateVersionV1Schema.parse(input.candidate);
    const taskRef = AgentTaskRefV1Schema.parse(value.taskRef);
    const candidateDigest = sha256CanonicalJson(value);
    const candidateIdempotencyKey = commandKey([
      "agent-task",
      "candidate-record",
      taskId(taskRef),
      String(value.candidateVersion),
      candidateDigest,
    ]);
    const command = await this.#taskCommand({
      taskRef,
      commandKind: "agent-task.candidate-record",
      idempotencyKey: candidateIdempotencyKey,
      actorId: input.workerId,
      payload: {
        candidate: value,
      },
      issuedAt: value.createdAt,
    });
    await this.#leaseTransaction(
      command,
      taskRef,
      input.workerId,
      input.leaseToken,
      "agent-task.candidate-record",
      async (transaction, task, _attempt, _now, context) => {
        if (!agentTaskRefEquals(task.envelope.agentTaskRef, taskRef))
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_INPUT_INVALID",
              category: "input",
              stage: "candidate.task-ref",
              taskRef,
            }),
          );
        if (["completed", "terminal-failure", "cancelled"].includes(task.state.status))
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_INPUT_INVALID",
              category: "input",
              stage: "candidate.terminal-task",
              taskRef,
            }),
          );
        await this.#assertArtifactUsable(
          context,
          task,
          value.candidateArtifactRef,
          "agent-candidate",
        );
        await this.#assertArtifactUsable(
          context,
          task,
          value.incrementArtifactRef,
          "agent-increment",
        );
        if (value.validation !== undefined)
          await this.#assertArtifactUsable(
            context,
            task,
            value.validation.validationArtifactRef,
            "agent-validation",
          );
        const latestCandidateVersion = task.state.latestCandidateVersion ?? 0;
        const existing = await transaction
          .selectFrom("business.agent_task_candidates")
          .selectAll()
          .where("agent_task_id", "=", taskId(taskRef))
          .where("candidate_version", "=", value.candidateVersion)
          .forUpdate()
          .executeTakeFirst();
        if (existing !== undefined) {
          const existingCandidate = AgentCandidateVersionV1Schema.parse({
            schemaVersion: "1",
            taskRef,
            candidateVersion: existing.candidate_version,
            parentCandidateVersion: existing.parent_candidate_version ?? 0,
            candidateArtifactRef: existing.candidate_artifact_ref,
            incrementArtifactRef: existing.increment_artifact_ref,
            ...(existing.validation === null ? {} : { validation: existing.validation }),
            ...(existing.result_ref === null ? {} : { resultRef: existing.result_ref }),
            disposition: existing.disposition,
            ...(existing.rejection_class === null
              ? {}
              : { rejectionClass: existing.rejection_class }),
            createdAt: asIso(existing.created_at),
          });
          if (sha256CanonicalJson(existingCandidate) !== candidateDigest)
            throw new AgentRuntimeError(
              makeAgentError({
                code: "AGENT_IDEMPOTENCY_CONFLICT",
                category: "idempotency",
                stage: "candidate.version-conflict",
                taskRef,
                idempotencyKey: candidateIdempotencyKey,
                priorCommandId: candidateIdempotencyKey,
              }),
            );
          return;
        }
        if (
          value.candidateVersion !== latestCandidateVersion + 1 ||
          value.parentCandidateVersion !== latestCandidateVersion
        )
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_STALE_VERSION",
              category: "concurrency",
              stage: "candidate.parent-version",
              taskRef,
            }),
          );
        const inserted = await transaction
          .insertInto("business.agent_task_candidates")
          .values({
            agent_task_id: taskId(taskRef),
            candidate_version: value.candidateVersion,
            parent_candidate_version: value.parentCandidateVersion ?? null,
            candidate_artifact_ref: jsonValue(value.candidateArtifactRef),
            increment_artifact_ref: jsonValue(value.incrementArtifactRef),
            validation: value.validation === undefined ? null : jsonValue(value.validation),
            result_ref: value.resultRef === undefined ? null : jsonValue(value.resultRef),
            disposition: value.disposition,
            rejection_class: value.rejectionClass ?? null,
            created_at: new Date(value.createdAt),
          })
          .returning("candidate_version")
          .executeTakeFirst();
        if (inserted === undefined)
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_PERSISTENCE_FAILURE",
              category: "persistence",
              retryable: true,
              stage: "candidate.insert-readback",
              taskRef,
            }),
          );
        const updated = await transaction
          .updateTable("business.agent_tasks")
          .set({
            latest_candidate_version: value.candidateVersion,
            task_version: sql`task_version + 1`,
            updated_at: new Date(value.createdAt),
          })
          .where("agent_task_id", "=", taskId(taskRef))
          .where("latest_candidate_version", "=", latestCandidateVersion)
          .returning("agent_task_id")
          .executeTakeFirst();
        if (updated === undefined)
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_STALE_VERSION",
              category: "concurrency",
              stage: "candidate.version",
              taskRef,
            }),
          );
      },
      value.createdAt,
    );
  }

  async verifyWorker(task: AgentTaskSnapshotV1, invocationId: string): Promise<void> {
    if (this.#authorization === undefined) return;
    try {
      const decision = await this.#authorization.verify({
        authorizationContextRef: task.envelope.authorization.authorizationContextRef,
        invocationId: IdentifierSchema.parse(invocationId),
        projectId: task.envelope.projectId,
        branch: "agent-task.start-task",
        requestedSpatialScopeRefs: task.envelope.frozenAuthorization.spatialScopeRefs,
        requestedSourceVersionRefs: [],
      });
      if (
        !authorizationWithinFrozenBoundary(task.envelope.frozenAuthorization, decision.context) ||
        !isAuthorizationSubset(task.envelope.authorization, decision.context)
      )
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_AUTHORIZATION_DENIED",
            category: "authorization",
            stage: "authorization.worker",
          }),
        );
    } catch (error) {
      if (error instanceof AgentRuntimeError) throw error;
      if (error instanceof AccessServiceError) {
        const diagnosticRef =
          error.details.diagnosticRef.kind === "diagnostic-artifact"
            ? error.details.diagnosticRef
            : undefined;
        throw new AgentRuntimeError(
          makeAgentError({
            code:
              error.details.code === "STALE_ACCESS_VERSION"
                ? "AGENT_STALE_VERSION"
                : "AGENT_AUTHORIZATION_DENIED",
            category:
              error.details.code === "STALE_ACCESS_VERSION" ? "concurrency" : "authorization",
            stage: error.details.stage,
            ...(diagnosticRef === undefined ? {} : { diagnosticRef }),
          }),
        );
      }
      if (error instanceof PostgresPersistenceError)
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_PERSISTENCE_FAILURE",
            category: "persistence",
            retryable: error.retryable,
            stage: error.stage,
            diagnosticRef: error.diagnosticRef,
          }),
        );
      throw error;
    }
  }
}
