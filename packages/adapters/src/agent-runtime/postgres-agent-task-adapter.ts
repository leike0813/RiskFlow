import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

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
  AgentValidationResultV1Schema,
  AgentActionEntryV1Schema,
  AgentActionPageV1Schema,
  AgentCandidateEntryV1Schema,
  AgentCandidatePageV1Schema,
  AgentInternalStatusV1Schema,
  type AgentInternalStatusV1,
  AgentProposalSummaryV1Schema,
  AgentTaskBudgetViewV1Schema,
  AgentTaskDetailV1Schema,
  AgentTaskListPageV1Schema,
  AgentTaskReadQueryV1Schema,
  AgentUiReadCursorV1Schema,
  type AgentUiReadCursorV1,
  AgentTaskSummaryV1Schema,
  AgentValidationCheckEntryV1Schema,
  AgentValidationPageV1Schema,
  AGENT_UI_READ_PAGE_SIZE_DEFAULT_V1,
  agentInternalStatusesForPublicStatus,
  type AgentActionEntryV1,
  type AgentActionPageV1,
  type AgentCandidatePageV1,
  type AgentLaunchContextResultV1,
  type AgentProposalSummaryV1,
  type AgentTaskDetailV1,
  type AgentTaskListPageV1,
  type AgentTaskReadPortV1,
  type AgentTaskReadQueryV1,
  type AgentTaskReadResultV1,
  type AgentTaskSafeErrorV1,
  type AgentTaskSummaryV1,
  type AgentValidationPageV1,
  agentTaskRefEquals,
  assertAgentTaskExecutionBudget,
  buildCompletedAgentTaskResult,
  canResumeAgentTask,
  emptyAgentBudgetUsage,
  makeAgentError,
  mapAgentError,
  mapAgentInternalStatus,
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
  type AgentTaskExecutionAuthorityReaderV1,
  type AgentTaskExecutionAuthorityRequestV1,
  type AgentTaskFailureEvidenceReadRequestV1,
  type AgentTaskFailureEvidenceReadResultV1,
  type AgentTaskCompletedResultReadRequestV1,
  type AgentTaskCompletedResultReadResultV1,
  type AgentTaskCompletedResultReaderV1,
  type AgentTaskCompletedResultV1,
  type AgentTaskFailureEvidenceReaderV1,
  type AgentTaskFailureEvidenceV1,
  type AgentTaskSnapshotV1,
  type AgentTaskStateV1,
  type AgentStructuredErrorV1,
} from "@riskflow/core/agent-runtime";
import {
  ACCESS_POLICY_REF_V1,
  AccessServiceError,
  isAuthorizationSubset,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  ArtifactRefV1Schema,
  ArtifactStoreError,
  type ArtifactRefV1,
  type ArtifactReferenceGuardV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  sha256CanonicalJson,
  type AtomicCommandV1,
  type AtomicCommitV1,
  type JsonValue,
  type TransactionContextV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import type { ModelGatewayPortV1 } from "@riskflow/core/model";
import {
  AgentTaskResultRefV1Schema,
  AgentTaskRefV1Schema,
  AgentTaskTypeV1Schema,
  AuthorizationContextV1Schema,
  CancelAgentTaskCommandV1Schema,
  ConfirmAgentCommandV1Schema,
  ModuleErrorV1Schema,
  ResumeAgentTaskCommandV1Schema,
  ContractReferenceV1Schema,
  StartAgentTaskPayloadV1Schema,
  WorkflowRunRefV1Schema,
  StartAgentTaskCommandV1Schema,
  AuthorizationContextRefV1Schema,
  type AgentTaskPortV1,
  type AgentTaskResultRefV1,
  type AgentTaskRefV1,
  type AgentTaskTypeV1,
  type AuthorizationContextV1,
  type CancelAgentTaskCommandV1,
  type ConfirmAgentCommandV1,
  type ContractReferenceV1,
  type ModuleBranchV1,
  type ReadActionV1,
  type ModuleErrorV1,
  type ResumeAgentTaskCommandV1,
  type StartAgentTaskCommandV1,
} from "@riskflow/contracts/ports";
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  type VersionReference,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";

import { PostgresPersistenceError, mapPostgresError } from "../postgres/pool.js";
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
const READ_FAILURE_EVIDENCE_BRANCH = "agent-task.read-failure-evidence";
const READ_FAILURE_EVIDENCE_CAPABILITY = "agent-task.read";
const READ_FAILURE_EVIDENCE_COMMAND_KIND = "agent-task.read-failure-evidence";
/** 私有完成结果窄读复用同一 `agent-task.read` 分支与只读语义，只区分 causal 阶段码。 */
const READ_COMPLETED_RESULT_COMMAND_KIND = "agent-task.read-completed-result";

/** C35 只读面固定分支：只有这一条 branch 承载 UI 的有界窄读。 */
const UI_READ_BRANCH = "agent-task.read" satisfies ModuleBranchV1;
const UI_READ_CAPABILITY = "agent-task.read";
const UI_READ_STAGE_CODE = "agent-task.ui-read";

/**
 * C35 分页游标是不透明绑定令牌（design D-03）：它记录工程、actor、筛选条件、固定记录
 * 时点与精确目标/候选，并附原 C08 授权摘要。下一跳必须原样带上同一个授权摘要；摘要不匹配、
 * 字段未知或被改写一律失败关闭，游标不能被跨工程或跨筛选复用。
 */
type UiReadCursorBinding = AgentUiReadCursorV1;

const encodeUiReadCursor = (binding: UiReadCursorBinding): string =>
  Buffer.from(JSON.stringify(binding), "utf8").toString("base64url");

const invalidCursor = (stage: string): AgentRuntimeError =>
  new AgentRuntimeError(makeAgentError({ code: "AGENT_INPUT_INVALID", category: "input", stage }));

/** 严格字段与类型校验：未知字段、缺字段或被改写的游标一律失败关闭。 */
const decodeUiReadCursor = (cursor: string): UiReadCursorBinding => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor("ui-read.cursor-decode");
  }
  const decoded = AgentUiReadCursorV1Schema.safeParse(parsed);
  if (!decoded.success) throw invalidCursor("ui-read.cursor-shape");
  return decoded.data;
};

/** 下一跳必须复算出同一个绑定摘要；漂移就关闭而不是继续翻页。 */
const requireCursorBinding = (cursor: UiReadCursorBinding, expectedBindingDigest: string): void => {
  if (cursor.binding !== expectedBindingDigest) throw invalidCursor("ui-read.cursor-binding");
};

const resultRefEquals = (left: AgentTaskResultRefV1, right: AgentTaskResultRefV1): boolean =>
  left.status === right.status &&
  refEqual(left.reference, right.reference) &&
  agentTaskRefEquals(left.agentTaskRef, right.agentTaskRef);

const authorizationWithinFrozenScope = (
  frozen: AgentTaskEnvelopeV1["frozenAuthorization"],
  current: AgentTaskEnvelopeV1["authorization"],
): boolean =>
  frozen.projectId === current.projectId &&
  current.grantedCapabilities.every((capability) =>
    frozen.grantedCapabilities.includes(capability),
  ) &&
  current.spatialScopeRefs.every((scope) =>
    frozen.spatialScopeRefs.some(
      (parent) => parent.reference.entityId === scope.reference.entityId,
    ),
  ) &&
  current.sourceAccessGrantRefs.every((grant) =>
    frozen.sourceAccessGrantRefs.some(
      (parent) => parent.reference.entityId === grant.reference.entityId,
    ),
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

const settledActionUsage = (
  action: AgentTaskActionV1,
  requested: AgentBudgetUsageV1,
): AgentBudgetUsageV1 =>
  normalizeAgentActionUsage(action.actionType, {
    ...requested,
    corrections: Math.max(
      requested.corrections,
      action.errorCode === "AGENT_VALIDATION_REJECTED" ? 1 : 0,
    ),
    transientRetries: Math.max(
      requested.transientRetries,
      action.reservation.amount.transientRetries,
    ),
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

export class PostgresAgentTaskAdapter
  implements
    AgentTaskPortV1,
    AgentTaskExecutionStoreV1,
    AgentTaskFailureEvidenceReaderV1,
    AgentTaskCompletedResultReaderV1,
    AgentTaskExecutionAuthorityReaderV1,
    AgentTaskReadPortV1
{
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
    await handle.completed;
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

  /**
   * C35 有界窄读入口（design D-03）：授权先于存在性——解析失败、缺能力、跨工程或跨 actor
   * 都在命中存储前收口，不支持的操作给出稳定失败。读取路径不写回执、审计或事件，
   * 也不改写任何任务状态；写入口（start/resume/cancel/confirm）语义保持原样。
   */
  async read(query: AgentTaskReadQueryV1): Promise<AgentTaskReadResultV1> {
    const parsed = AgentTaskReadQueryV1Schema.safeParse(query);
    if (!parsed.success) {
      const queryId =
        typeof (query as { queryId?: unknown } | null)?.queryId === "string"
          ? (query as { queryId: string }).queryId
          : UI_READ_STAGE_CODE;
      if (this.#uiReadRequestDenied(query)) return this.#uiReadDenied(queryId);
      return this.#uiReadUnsupported(queryId);
    }
    const valid = parsed.data;
    try {
      await this.#verifyUiRead(valid);
      return await this.#uiRead(valid);
    } catch (error) {
      // 保留业务错误分类，技术故障带诊断引用返回。
      if (error instanceof AgentRuntimeError) {
        return {
          kind: "failed",
          error: mapAgentError(error, { causalRunId: valid.queryId }),
        };
      }
      if (
        error instanceof AccessServiceError &&
        !["ACCESS_TRANSIENT_FAILURE", "ACCESS_TERMINAL_FAILURE"].includes(error.details.code)
      )
        return this.#uiReadDenied(valid.queryId);
      const failure = mapPostgresError(error, "agent-task.ui-read");
      const retryable =
        error instanceof AccessServiceError
          ? error.details.code === "ACCESS_TRANSIENT_FAILURE"
          : failure.retryable;
      return {
        kind: "failed",
        error: ModuleErrorV1Schema.parse({
          code: retryable ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE",
          category: "technical",
          retryable,
          stageCode: UI_READ_STAGE_CODE,
          occurredAt: this.#now(),
          causalRunId: valid.queryId,
          diagnosticRef: failure.diagnosticRef,
          ...(retryable
            ? {
                attempt: 1,
                retryPolicyRef: {
                  entityId: "agent-retry-policy",
                  versionId: "1",
                },
              }
            : {}),
        }),
      };
    }
  }

  /** 拒绝先于读取：缺能力、跨工程、跨 actor 的请求无法探出目标是否存在。 */
  async #verifyUiRead(query: AgentTaskReadQueryV1): Promise<void> {
    if (this.#authorization === undefined)
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_AUTHORIZATION_DENIED",
          category: "authorization",
          stage: "ui-read.authorization",
        }),
      );
    if (
      query.projectId !== query.authorization.projectId ||
      query.actorId !== query.authorization.actorId ||
      !query.authorization.grantedCapabilities.includes(UI_READ_CAPABILITY)
    )
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_AUTHORIZATION_DENIED",
          category: "authorization",
          stage: "ui-read.authorization",
        }),
      );
    const decision = await this.#authorization.verify({
      authorizationContextRef: query.authorization.authorizationContextRef,
      invocationId: query.queryId,
      projectId: query.projectId,
      branch: UI_READ_BRANCH,
      requestedSpatialScopeRefs: query.authorization.spatialScopeRefs,
      requestedSourceVersionRefs: [],
    });
    if (
      decision.context.actorId !== query.actorId ||
      decision.context.projectId !== query.projectId
    )
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_AUTHORIZATION_DENIED",
          category: "authorization",
          stage: "ui-read.authorization",
        }),
      );
  }

  #uiReadRequestDenied(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const request = value as Record<string, unknown>;
    const context = request.authorization;
    if (typeof context !== "object" || context === null) return false;
    const authorization = context as Record<string, unknown>;
    const mismatched =
      (typeof request.projectId === "string" &&
        typeof authorization.projectId === "string" &&
        request.projectId !== authorization.projectId) ||
      (typeof request.actorId === "string" &&
        typeof authorization.actorId === "string" &&
        request.actorId !== authorization.actorId);
    if (mismatched) return true;
    return (
      Array.isArray(authorization.grantedCapabilities) &&
      !authorization.grantedCapabilities.includes(UI_READ_CAPABILITY)
    );
  }

  #uiReadDenied(queryId: string): AgentTaskReadResultV1 {
    return {
      kind: "failed",
      error: ModuleErrorV1Schema.parse({
        stageCode: UI_READ_STAGE_CODE,
        occurredAt: this.#now(),
        causalRunId: queryId,
        code: "AUTHORIZATION_DENIED",
        category: "authorization",
        retryable: false,
        requiredCapability: UI_READ_CAPABILITY,
        authorizationPolicyRef: ACCESS_POLICY_REF_V1,
      }),
    };
  }

  #uiReadUnsupported(queryId: string): AgentTaskReadResultV1 {
    return {
      kind: "failed",
      error: ModuleErrorV1Schema.parse({
        stageCode: UI_READ_STAGE_CODE,
        occurredAt: this.#now(),
        causalRunId: queryId,
        code: "UNSUPPORTED_CONTRACT",
        category: "technical",
        retryable: false,
        schemaVersion: "1",
      }),
    };
  }

  /** 游标只绑定页类型、工程、操作者、目标和业务筛选；每页重新检查当前权限。 */
  #uiCursorBinding(
    query: AgentTaskReadQueryV1,
    agentTaskId: string | null,
    filter: unknown,
  ): string {
    return sha256CanonicalJson({
      kind: query.kind,
      projectId: query.projectId,
      actorId: query.actorId,
      agentTaskId,
      filter,
    });
  }

  /** 只读当前工程内的任务行；跨工程与错配身份在读取前已被授权关卡挡住。 */
  async #selectOwnedTask(
    query: AgentTaskReadQueryV1,
    taskRef: { readonly kind: "agent-task"; readonly reference: VersionReference },
  ): Promise<AgentTaskRow> {
    const row = await this.#selectTaskById(taskRef.reference.entityId);
    if (
      row === undefined ||
      row.project_id !== query.projectId ||
      row.version_id !== taskRef.reference.versionId
    )
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_TASK_NOT_FOUND",
          category: "not-found",
          stage: "ui-read.task-scope",
        }),
      );
    return row;
  }

  #uiSummary(query: AgentTaskReadQueryV1, row: AgentTaskRow): AgentTaskSummaryV1 {
    const envelope = AgentTaskEnvelopeV1Schema.parse(row.envelope);
    const internalStatus = AgentInternalStatusV1Schema.parse(row.status);
    return AgentTaskSummaryV1Schema.parse({
      agentTaskRef: AgentTaskRefV1Schema.parse(row.agent_task_ref),
      status: mapAgentInternalStatus(internalStatus),
      taskVersion: row.task_version,
      initiatorActorId: envelope.actorId,
      parentRunRef: WorkflowRunRefV1Schema.parse(row.parent_run_ref),
      frozenInputRef: ContractReferenceV1Schema.parse(row.frozen_input_ref),
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
    });
  }

  async #uiRead(query: AgentTaskReadQueryV1): Promise<AgentTaskReadResultV1> {
    switch (query.kind) {
      case "list":
        return { kind: "succeeded", result: await this.#uiReadList(query) };
      case "detail":
        return { kind: "succeeded", result: await this.#uiReadDetail(query) };
      case "actions":
        return { kind: "succeeded", result: await this.#uiReadActions(query) };
      case "candidates":
        return { kind: "succeeded", result: await this.#uiReadCandidates(query) };
      case "validation":
        return { kind: "succeeded", result: await this.#uiReadValidation(query) };
      case "launch-context":
        return { kind: "succeeded", result: await this.#uiReadLaunchContext(query) };
    }
  }

  async #uiReadList(
    query: Extract<AgentTaskReadQueryV1, { readonly kind: "list" }>,
  ): Promise<AgentTaskListPageV1> {
    const pageSize = query.payload.pageSize ?? AGENT_UI_READ_PAGE_SIZE_DEFAULT_V1;
    // 绑定摘要只含真正的筛选条件：游标是位置而非筛选，页大小变化会改变切分因此必须一致。
    const binding = this.#uiCursorBinding(query, null, {
      taskType: query.payload.taskType ?? null,
      status: query.payload.status ?? null,
      parentRunRef: query.payload.parentRunRef ?? null,
      pageSize,
    });
    const cursor =
      query.payload.cursor === undefined ? undefined : decodeUiReadCursor(query.payload.cursor);
    if (cursor !== undefined) requireCursorBinding(cursor, binding);
    const asOfRecordedAt = cursor?.asOfRecordedAt ?? query.requestedAt;

    let builder = this.#db
      .selectFrom("business.agent_tasks")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .where("created_at", "<=", asOfRecordedAt);
    if (query.payload.taskType !== undefined)
      builder = builder.where("task_type", "=", query.payload.taskType);
    if (query.payload.status !== undefined)
      builder = builder.where(
        "status",
        "in",
        agentInternalStatusesForPublicStatus(query.payload.status) as readonly string[],
      );
    if (query.payload.parentRunRef !== undefined)
      builder = builder.where(
        "parent_run_ref",
        "=",
        jsonValue(WorkflowRunRefV1Schema.parse(query.payload.parentRunRef)),
      );
    if (cursor !== undefined)
      builder = builder.where((expression) =>
        expression.or([
          expression("created_at", ">", cursor.keyA),
          expression.and([
            expression("created_at", "=", cursor.keyA),
            expression("agent_task_id", ">", cursor.keyB),
          ]),
        ]),
      );
    const rows = await builder
      .orderBy("created_at", "asc")
      .orderBy("agent_task_id", "asc")
      .limit(pageSize + 1)
      .execute();
    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    return AgentTaskListPageV1Schema.parse({
      kind: "list",
      items: page.map((row) => this.#uiSummary(query, row)),
      asOfRecordedAt,
      ...(rows.length > pageSize && last !== undefined
        ? {
            nextCursor: encodeUiReadCursor({
              v: "1",
              binding,
              asOfRecordedAt,
              keyA: asIso(last.created_at),
              keyB: last.agent_task_id,
            }),
          }
        : {}),
    });
  }

  /**
   * 详情：按精确任务身份定位后给出摘要、原预算策略/台账、当前提案安全摘要、结果引用与
   * 结构化安全错误。启动/恢复/取消/确认的可用性只反映任务自身业务状态——读能力不等于
   * 写能力，真实授权判定仍由既有授权路由给出（design D-03/D-04/D-06）。
   */
  async #uiReadDetail(
    query: Extract<AgentTaskReadQueryV1, { readonly kind: "detail" }>,
  ): Promise<AgentTaskDetailV1> {
    const taskRef = query.payload.agentTaskRef;
    const row = await this.#selectOwnedTask(query, taskRef);
    const internalStatus = AgentInternalStatusV1Schema.parse(row.status);
    const currentProposal =
      row.current_proposal_artifact_ref === null
        ? undefined
        : AgentProposalSummaryV1Schema.parse(
            this.#proposalSummary(
              query,
              row,
              ArtifactRefV1Schema.parse(row.current_proposal_artifact_ref),
            ),
          );
    return AgentTaskDetailV1Schema.parse({
      kind: "detail",
      summary: this.#uiSummary(query, row),
      budget: AgentTaskBudgetViewV1Schema.parse({
        policy: AgentTaskBudgetPolicyV1Schema.parse(row.budget_policy),
        ledger: AgentBudgetLedgerV1Schema.parse(row.budget_ledger),
      }),
      actions: this.#uiActionAvailability(internalStatus),
      ...(currentProposal === undefined ? {} : { currentProposal }),
      ...(row.result_ref === null
        ? {}
        : { resultRef: AgentTaskResultRefV1Schema.parse(row.result_ref) }),
      ...(row.error === null ? {} : { safeError: this.#uiSafeError(row.error) }),
    });
  }

  /**
   * 只报告业务状态决定的可用性：终局或已取消的任务无法再恢复/取消，也没有待确认提案。
   * 授权层面的允许/拒绝不在此推断——读面不得代替写能力的判定。
   */
  #uiActionAvailability(status: AgentInternalStatusV1): ReadActionV1[] {
    const active = status === "pending" || status === "running" || status === "retryable-failure";
    const blocked: { branch: ModuleBranchV1; reasonCode: string }[] = [];
    if (!active) {
      blocked.push({ branch: "agent-task.resume-task", reasonCode: "TASK_NOT_RESUMABLE" });
      blocked.push({ branch: "agent-task.cancel-task", reasonCode: "TASK_NOT_CANCELLABLE" });
    }
    if (status !== "waiting-user-confirmation")
      blocked.push({
        branch: "agent-task.confirm-command",
        reasonCode: "TASK_HAS_NO_PENDING_PROPOSAL",
      });
    return blocked.map((entry) => ({
      branch: entry.branch,
      availability: "business-unavailable",
      reasonCode: entry.reasonCode,
    }));
  }

  /** 安全错误只保留码、类别、可重试标记与阶段；失败正文与诊断正文留在受保护的工件里。 */
  #uiSafeError(value: JsonColumn): AgentTaskSafeErrorV1 {
    const error = AgentStructuredErrorV1Schema.parse(value);
    return {
      code: error.code,
      category: error.category,
      retryable: error.retryable,
      stage: error.stage,
      occurredAt: error.occurredAt,
      ...(error.reasonCode === undefined ? {} : { reasonCode: error.reasonCode }),
    };
  }

  async #proposalSummary(
    query: AgentTaskReadQueryV1,
    row: AgentTaskRow,
    proposalArtifactRef: ArtifactRefV1,
  ): Promise<AgentProposalSummaryV1> {
    const proposal = AgentCommandProposalV1Schema.parse(
      await this.#readJsonArtifact(
        rowSnapshot(row),
        proposalArtifactRef,
        query.authorization,
        "agent-command-proposal",
        UI_READ_CAPABILITY,
      ),
    );
    return {
      commandProposalRef: proposal.commandProposalRef,
      taskRef: proposal.taskRef,
      targetRef: proposal.targetRef,
      expectedTargetVersion: proposal.expectedTargetVersion,
      expectedEffect: proposal.expectedEffect,
      externalEffects: proposal.externalEffects,
      proposedAt: proposal.proposedAt,
    };
  }

  async #uiReadActions(
    query: Extract<AgentTaskReadQueryV1, { readonly kind: "actions" }>,
  ): Promise<AgentActionPageV1> {
    const taskRef = query.payload.agentTaskRef;
    await this.#selectOwnedTask(query, taskRef);
    const pageSize = query.payload.pageSize ?? AGENT_UI_READ_PAGE_SIZE_DEFAULT_V1;
    const binding = this.#uiCursorBinding(query, taskRef.reference.entityId, {
      kind: "actions",
    });
    const cursor =
      query.payload.cursor === undefined ? undefined : decodeUiReadCursor(query.payload.cursor);
    if (cursor !== undefined) requireCursorBinding(cursor, binding);

    let builder = this.#db
      .selectFrom("business.agent_task_actions")
      .selectAll()
      .where("agent_task_id", "=", taskRef.reference.entityId);
    if (cursor !== undefined) builder = builder.where("sequence", ">", Number(cursor.keyA));
    const rows = await builder
      .orderBy("sequence", "asc")
      .limit(pageSize + 1)
      .execute();
    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    return AgentActionPageV1Schema.parse({
      kind: "actions",
      agentTaskRef: taskRef,
      items: page.map((row) => this.#uiActionEntry(taskRef, row)),
      ...(rows.length > pageSize && last !== undefined
        ? {
            nextCursor: encodeUiReadCursor({
              v: "1",
              binding,
              asOfRecordedAt: query.requestedAt,
              keyA: String(last.sequence),
              keyB: "",
            }),
          }
        : {}),
    });
  }

  /** 行动条目沿用既有 `actionFromRow` 的原映射，只挑出读面允许的引用、实际用量与时间。 */
  #uiActionEntry(taskRef: AgentTaskRefV1, row: AgentTaskActionRow): AgentActionEntryV1 {
    const action = actionFromRow(taskRef, row);
    return AgentActionEntryV1Schema.parse({
      actionId: action.actionId,
      sequence: action.sequence,
      actionType: action.actionType,
      status: action.status,
      intentArtifactRef: action.intentArtifactRef,
      ...(action.resultRef === undefined ? {} : { resultRef: action.resultRef }),
      ...(action.resultArtifactRef === undefined
        ? {}
        : { resultArtifactRef: action.resultArtifactRef }),
      ...(action.errorCode === undefined ? {} : { errorCode: action.errorCode }),
      usage: action.usage,
      recordedAt: action.recordedAt,
      ...(action.completedAt === undefined ? {} : { completedAt: action.completedAt }),
    });
  }

  async #uiReadCandidates(
    query: Extract<AgentTaskReadQueryV1, { readonly kind: "candidates" }>,
  ): Promise<AgentCandidatePageV1> {
    const taskRef = query.payload.agentTaskRef;
    await this.#selectOwnedTask(query, taskRef);
    const pageSize = query.payload.pageSize ?? AGENT_UI_READ_PAGE_SIZE_DEFAULT_V1;
    const binding = this.#uiCursorBinding(query, taskRef.reference.entityId, {
      kind: "candidates",
    });
    const cursor =
      query.payload.cursor === undefined ? undefined : decodeUiReadCursor(query.payload.cursor);
    if (cursor !== undefined) requireCursorBinding(cursor, binding);

    let builder = this.#db
      .selectFrom("business.agent_task_candidates")
      .selectAll()
      .where("agent_task_id", "=", taskRef.reference.entityId);
    if (cursor !== undefined)
      builder = builder.where("candidate_version", ">", Number(cursor.keyA));
    const rows = await builder
      .orderBy("candidate_version", "asc")
      .limit(pageSize + 1)
      .execute();
    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    return AgentCandidatePageV1Schema.parse({
      kind: "candidates",
      agentTaskRef: taskRef,
      items: page.map((row) =>
        AgentCandidateEntryV1Schema.parse({
          candidateVersion: row.candidate_version,
          parentCandidateVersion: row.parent_candidate_version ?? 0,
          candidateArtifactRef: row.candidate_artifact_ref,
          incrementArtifactRef: row.increment_artifact_ref,
          ...(row.validation === null
            ? {}
            : {
                validationArtifactRef: AgentValidationResultV1Schema.parse(row.validation)
                  .validationArtifactRef,
              }),
          disposition: row.disposition,
          ...(row.rejection_class === null ? {} : { rejectionClass: row.rejection_class }),
          createdAt: asIso(row.created_at),
        }),
      ),
      ...(rows.length > pageSize && last !== undefined
        ? {
            nextCursor: encodeUiReadCursor({
              v: "1",
              binding,
              asOfRecordedAt: query.requestedAt,
              keyA: String(last.candidate_version),
              keyB: "",
            }),
          }
        : {}),
    });
  }

  /**
   * 逐项校验按原验证结构的数组位置稳定分页；引用不可见或结构不可解析时整页安全失败，
   * 不用任何替代内容填补缺失的校验值。
   */
  async #uiReadValidation(
    query: Extract<AgentTaskReadQueryV1, { readonly kind: "validation" }>,
  ): Promise<AgentValidationPageV1> {
    const taskRef = query.payload.agentTaskRef;
    await this.#selectOwnedTask(query, taskRef);
    const pageSize = query.payload.pageSize ?? AGENT_UI_READ_PAGE_SIZE_DEFAULT_V1;
    const binding = this.#uiCursorBinding(query, taskRef.reference.entityId, {
      kind: "validation",
      candidateVersion: query.payload.candidateVersion,
    });
    const cursor =
      query.payload.cursor === undefined ? undefined : decodeUiReadCursor(query.payload.cursor);
    if (cursor !== undefined) requireCursorBinding(cursor, binding);

    const row = await this.#db
      .selectFrom("business.agent_task_candidates")
      .selectAll()
      .where("agent_task_id", "=", taskRef.reference.entityId)
      .where("candidate_version", "=", query.payload.candidateVersion)
      .executeTakeFirst();
    if (row === undefined || row.validation === null)
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_TASK_NOT_FOUND",
          category: "not-found",
          stage: "ui-read.validation-reference",
          taskRef,
        }),
      );
    const validation = AgentValidationResultV1Schema.parse(row.validation);
    const offset = cursor === undefined ? 0 : Number(cursor.keyA);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > validation.items.length)
      throw invalidCursor("ui-read.validation-cursor");
    const items = validation.items.slice(offset, offset + pageSize);
    return AgentValidationPageV1Schema.parse({
      kind: "validation",
      agentTaskRef: taskRef,
      candidateVersion: query.payload.candidateVersion,
      items: items.map((check) =>
        AgentValidationCheckEntryV1Schema.parse({
          checkId: check.checkId,
          disposition: check.disposition,
          ...(check.rejectionClass === undefined ? {} : { rejectionClass: check.rejectionClass }),
          reasonCode: check.reasonCode,
          evidenceReferences: check.evidenceReferences,
        }),
      ),
      ...(offset + pageSize < validation.items.length
        ? {
            nextCursor: encodeUiReadCursor({
              v: "1",
              binding,
              asOfRecordedAt: query.requestedAt,
              keyA: String(offset + pageSize),
              keyB: "",
            }),
          }
        : {}),
    });
  }

  /**
   * 启动上下文：只有来源任务仍是可启动状态、其任务类型定义仍在注册且支持 interactive、
   * 六类策略引用仍可解析时才回送完整原启动载荷；否则按稳定 reasonCode 给出不支持，
   * 不推测缺失策略，也不扩模型、工具或预算。
   */
  async #uiReadLaunchContext(
    query: Extract<AgentTaskReadQueryV1, { readonly kind: "launch-context" }>,
  ): Promise<AgentLaunchContextResultV1> {
    const sourceRef = query.payload.sourceAgentTaskRef;
    const row = await this.#selectOwnedTask(query, sourceRef);
    const unsupported = (reasonCode: string): AgentLaunchContextResultV1 => ({
      kind: "launch-context",
      sourceAgentTaskRef: sourceRef,
      launchContext: { supported: false, reasonCode },
    });
    const internalStatus = AgentInternalStatusV1Schema.parse(row.status);
    if (internalStatus === "terminal-failure" || internalStatus === "cancelled")
      return unsupported("SOURCE_TASK_TERMINAL");
    const envelope = AgentTaskEnvelopeV1Schema.parse(row.envelope);
    if (!this.#registry.has(envelope.taskType)) return unsupported("TASK_DEFINITION_UNREGISTERED");
    const definition = this.#registry.get(envelope.taskType);
    if (!definition.metadata.supportedTriggerModes.includes("interactive"))
      return unsupported("TRIGGER_MODE_UNSUPPORTED");
    if (
      !refEqual(definition.budgetPolicy.modelDeploymentRef, envelope.modelDeploymentRef) ||
      !refEqual(definition.budgetPolicy.promptTemplateRef, envelope.promptTemplateRef) ||
      !refEqual(definition.metadata.toolPolicyRef, envelope.toolPolicyRef) ||
      !refEqual(definition.budgetPolicy.policyRef, envelope.budgetPolicyRef) ||
      !refEqual(definition.metadata.incrementSchemaRef, envelope.incrementSchemaRef) ||
      !refEqual(definition.metadata.validationPolicyRef, envelope.validationPolicyRef)
    )
      return unsupported("STRATEGY_REFERENCE_UNAVAILABLE");
    return {
      kind: "launch-context",
      sourceAgentTaskRef: sourceRef,
      launchContext: {
        supported: true,
        payload: StartAgentTaskPayloadV1Schema.parse({
          taskType: envelope.taskType,
          triggerMode: "interactive",
          parentRunRef: envelope.parentRunRef,
          frozenInputRef: envelope.frozenInputRef,
          modelDeploymentRef: envelope.modelDeploymentRef,
          promptTemplateRef: envelope.promptTemplateRef,
          toolPolicyRef: envelope.toolPolicyRef,
          budgetPolicyRef: envelope.budgetPolicyRef,
          incrementSchemaRef: envelope.incrementSchemaRef,
          validationPolicyRef: envelope.validationPolicyRef,
        }),
      },
    };
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

  /**
   * 任务执行授权依据的内部窄读：只认本库真实任务行与当前有效 Worker 租约，
   * 调用方传入的信封或时钟都不作数。返回的原预算策略与台账供调用方判定剩余预算，
   * 本读面不改变任何状态、台账、回执、审计或事件。
   */
  async readExecutionAuthority(
    input: AgentTaskExecutionAuthorityRequestV1,
  ): Promise<AgentTaskSnapshotV1> {
    const taskRef = AgentTaskRefV1Schema.parse(input.taskRef);
    const now = IsoDateTimeSchema.parse(this.#now());
    return this.#db.transaction().execute(async (transaction) => {
      const lease = await this.#lockLease(
        transaction as unknown as AgentTransaction,
        taskRef,
        input.workerId,
        input.leaseToken,
        now,
      );
      assertAgentTaskExecutionBudget(lease.task);
      return lease.task;
    });
  }

  /** 检查点任务身份与父运行证明，不要求任务完成，不返回任务正文。 */
  async verifyCheckpointReference(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly invocationId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly taskRef: AgentTaskRefV1;
    readonly parentRunRef: { readonly kind: "workflow-run"; readonly reference: VersionReference };
  }): Promise<boolean> {
    const authorization = AuthorizationContextV1Schema.parse(input.authorization);
    const taskRef = AgentTaskRefV1Schema.parse(input.taskRef);
    const parentRunRef = WorkflowRunRefV1Schema.parse(input.parentRunRef);
    if (
      this.#authorization === undefined ||
      authorization.projectId !== input.projectId ||
      authorization.actorId !== input.actorId ||
      authorization.grantedCapabilities.length !== 1 ||
      authorization.grantedCapabilities[0] !== "agent-task.read"
    )
      return false;
    const decision = await this.#authorization.verify({
      authorizationContextRef: authorization.authorizationContextRef,
      projectId: input.projectId,
      invocationId: IdentifierSchema.parse(input.invocationId),
      branch: UI_READ_BRANCH,
      requestedSpatialScopeRefs: authorization.spatialScopeRefs,
      requestedSourceVersionRefs: [],
      requestedAt: IsoDateTimeSchema.parse(input.requestedAt),
    });
    if (decision.redacted || !isDeepStrictEqual(decision.context, authorization)) return false;
    const row = await this.#db
      .selectFrom("business.agent_tasks")
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("agent_task_id", "=", taskRef.reference.entityId)
      .where("version_id", "=", taskRef.reference.versionId)
      .executeTakeFirst();
    if (row === undefined) return false;
    const task = rowSnapshot(row);
    const scopeContained = (
      child: VersionReference,
      parents: readonly { reference: VersionReference }[],
    ) => parents.some((parent) => refEqual(child, parent.reference));
    return (
      task.envelope.projectId === input.projectId &&
      task.envelope.actorId === input.actorId &&
      row.task_type === taskRef.taskType &&
      row.trigger_mode === taskRef.triggerMode &&
      agentTaskRefEquals(task.envelope.agentTaskRef, taskRef) &&
      agentTaskRefEquals(task.state.agentTaskRef, taskRef) &&
      refEqual(task.envelope.parentRunRef.reference, parentRunRef.reference) &&
      refEqual(
        WorkflowRunRefV1Schema.parse(row.parent_run_ref).reference,
        parentRunRef.reference,
      ) &&
      refEqual(VersionReferenceSchema.parse(row.budget_policy_ref), task.budgetPolicy.policyRef) &&
      refEqual(task.budgetPolicy.policyRef, taskRef.budgetPolicyRef) &&
      refEqual(task.budgetPolicy.modelDeploymentRef, taskRef.modelDeploymentRef) &&
      refEqual(task.budgetPolicy.promptTemplateRef, taskRef.promptTemplateRef) &&
      refEqual(task.budgetPolicy.toolPolicyRef, taskRef.toolPolicyRef) &&
      task.envelope.frozenAuthorization.spatialScopeRefs.every((scope) =>
        scopeContained(scope.reference, decision.context.spatialScopeRefs),
      ) &&
      task.envelope.frozenAuthorization.sourceAccessGrantRefs.every((grant) =>
        scopeContained(grant.reference, decision.context.sourceAccessGrantRefs),
      )
    );
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

  async #executeAgentTransaction(
    command: AtomicCommandV1,
    operation: (context: TransactionContextV1) => Promise<AtomicCommitV1>,
  ) {
    let domainFailure: AgentRuntimeError | undefined;
    try {
      return await this.#transactionUnit.execute(command, async (context) => {
        try {
          return await operation(context);
        } catch (error) {
          if (error instanceof AgentRuntimeError) domainFailure = error;
          throw error;
        }
      });
    } catch (error) {
      // C03 保持原事务回滚；C08 对调用方保留已知领域错误的预算/权限分类。
      throw domainFailure ?? error;
    }
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
    const receipt = await this.#executeAgentTransaction(command, async (context) => {
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

  /**
   * 公共失败证据窄读：授权先行、单点任务投影、白名单字段，
   * 拒绝与目标边界统一为不可枚举的 `AUTHORIZATION_DENIED`。
   */
  async readTerminalFailure(
    request: AgentTaskFailureEvidenceReadRequestV1,
  ): Promise<AgentTaskFailureEvidenceReadResultV1> {
    const causalRunId =
      typeof request?.requestId === "string" && request.requestId.length > 0
        ? request.requestId
        : READ_FAILURE_EVIDENCE_COMMAND_KIND;
    try {
      const requestId = IdentifierSchema.parse(request.requestId);
      const projectId = IdentifierSchema.parse(request.projectId);
      const actorId = IdentifierSchema.parse(request.actorId);
      const requestedAt = IsoDateTimeSchema.parse(request.requestedAt);
      const taskRef = AgentTaskRefV1Schema.parse(request.taskRef);
      const expectedTaskType = AgentTaskTypeV1Schema.parse(request.expectedTaskType);
      const authorization = AuthorizationContextV1Schema.parse(request.authorization);
      if (
        this.#authorization === undefined ||
        authorization.projectId !== projectId ||
        authorization.actorId !== actorId ||
        authorization.grantedCapabilities.length !== 1 ||
        authorization.grantedCapabilities[0] !== READ_FAILURE_EVIDENCE_CAPABILITY
      )
        return { kind: "failed", error: this.#readFailureDenied(causalRunId) };
      const decision = await this.#authorization.verify({
        authorizationContextRef: authorization.authorizationContextRef,
        invocationId: requestId,
        projectId,
        branch: READ_FAILURE_EVIDENCE_BRANCH,
        requestedSpatialScopeRefs: authorization.spatialScopeRefs,
        requestedSourceVersionRefs: [],
        requestedAt,
      });
      if (
        decision.context.grantedCapabilities.length !== 1 ||
        decision.context.grantedCapabilities[0] !== READ_FAILURE_EVIDENCE_CAPABILITY ||
        !isAuthorizationSubset(authorization, decision.context)
      )
        return { kind: "failed", error: this.#readFailureDenied(causalRunId) };
      const evidence = await this.#withinReadFailureRead(() =>
        this.#projectTerminalFailure({
          projectId,
          taskRef,
          expectedTaskType,
        }),
      );
      if (evidence === undefined)
        return { kind: "failed", error: this.#readFailureDenied(causalRunId) };
      await this.#closeTerminalFailureRead({
        projectId,
        actorId,
        requestId,
        requestedAt,
        taskRef,
        expectedTaskType,
        authorization,
      });
      return { kind: "succeeded", evidence };
    } catch (error) {
      return { kind: "failed", error: this.#readFailureError(error, causalRunId) };
    }
  }

  /**
   * 模块内精确结果窄读：授权先行、单点任务投影、白名单字段。
   * 只接受 `completed` 且结果与候选精确一致的任务；缺失、错配与无权统一为不可枚举拒绝。
   * 复用 `agent-task.read` 的既有复核审计查询分支，不新增能力值，也不写回执/审计。
   */
  async readCompletedResult(
    request: AgentTaskCompletedResultReadRequestV1,
  ): Promise<AgentTaskCompletedResultReadResultV1> {
    const causalRunId =
      typeof request?.requestId === "string" && request.requestId.length > 0
        ? request.requestId
        : READ_COMPLETED_RESULT_COMMAND_KIND;
    try {
      const requestId = IdentifierSchema.parse(request.requestId);
      const projectId = IdentifierSchema.parse(request.projectId);
      const actorId = IdentifierSchema.parse(request.actorId);
      const requestedAt = IsoDateTimeSchema.parse(request.requestedAt);
      const taskRef = AgentTaskRefV1Schema.parse(request.taskRef);
      const resultRef = AgentTaskResultRefV1Schema.parse(request.resultRef);
      const expectedTaskType = AgentTaskTypeV1Schema.parse(request.expectedTaskType);
      const authorization = AuthorizationContextV1Schema.parse(request.authorization);
      if (
        this.#authorization === undefined ||
        authorization.projectId !== projectId ||
        authorization.actorId !== actorId ||
        authorization.grantedCapabilities.length !== 1 ||
        authorization.grantedCapabilities[0] !== READ_FAILURE_EVIDENCE_CAPABILITY
      )
        return { kind: "failed", error: this.#readFailureDenied(causalRunId) };
      const decision = await this.#authorization.verify({
        authorizationContextRef: authorization.authorizationContextRef,
        invocationId: requestId,
        projectId,
        branch: READ_FAILURE_EVIDENCE_BRANCH,
        requestedSpatialScopeRefs: authorization.spatialScopeRefs,
        requestedSourceVersionRefs: [],
        requestedAt,
      });
      if (
        decision.context.grantedCapabilities.length !== 1 ||
        decision.context.grantedCapabilities[0] !== READ_FAILURE_EVIDENCE_CAPABILITY ||
        !isAuthorizationSubset(authorization, decision.context)
      )
        return { kind: "failed", error: this.#readFailureDenied(causalRunId) };
      const result = await this.#withinReadFailureRead(() =>
        this.#projectCompletedResult({ projectId, taskRef, resultRef, expectedTaskType }),
      );
      if (result === undefined)
        return { kind: "failed", error: this.#readFailureDenied(causalRunId) };
      return { kind: "succeeded", result };
    } catch (error) {
      return { kind: "failed", error: this.#readFailureError(error, causalRunId) };
    }
  }

  /**
   * 只读任务信封、动作序号与候选行；结果必须命中候选保存的公共结果引用。
   * 任一持久化事实与请求不符时返回 `undefined`，由调用方统一收口为不可枚举拒绝。
   */
  async #projectCompletedResult(input: {
    readonly projectId: string;
    readonly taskRef: AgentTaskRefV1;
    readonly resultRef: AgentTaskResultRefV1;
    readonly expectedTaskType: AgentTaskTypeV1;
  }): Promise<AgentTaskCompletedResultV1 | undefined> {
    const row = await this.#db
      .selectFrom("business.agent_tasks")
      .select(["agent_task_ref", "task_type", "status", "result_ref", "envelope", "budget_ledger"])
      .where("agent_task_id", "=", input.taskRef.reference.entityId)
      .where("project_id", "=", input.projectId)
      .where("version_id", "=", input.taskRef.reference.versionId)
      .executeTakeFirst();
    if (row === undefined || row.status !== "completed" || row.result_ref === null)
      return undefined;
    const storedTaskRef = AgentTaskRefV1Schema.parse(row.agent_task_ref);
    if (
      row.task_type !== input.expectedTaskType ||
      storedTaskRef.taskType !== input.expectedTaskType ||
      !agentTaskRefEquals(storedTaskRef, input.taskRef)
    )
      return undefined;
    const envelope = AgentTaskEnvelopeV1Schema.parse(row.envelope);
    const storedResultRef = AgentTaskResultRefV1Schema.parse(row.result_ref);
    if (
      storedResultRef.status !== "completed" ||
      input.resultRef.status !== "completed" ||
      !resultRefEquals(storedResultRef, input.resultRef) ||
      !agentTaskRefEquals(envelope.agentTaskRef, input.taskRef) ||
      envelope.taskType !== input.expectedTaskType
    )
      return undefined;
    const candidates = await this.#db
      .selectFrom("business.agent_task_candidates")
      .select([
        "candidate_version",
        "candidate_artifact_ref",
        "increment_artifact_ref",
        "validation",
        "result_ref",
      ])
      .where("agent_task_id", "=", input.taskRef.reference.entityId)
      .orderBy("candidate_version", "asc")
      .execute();
    const candidate = candidates.find(
      (value) =>
        value.result_ref !== null &&
        resultRefEquals(AgentTaskResultRefV1Schema.parse(value.result_ref), storedResultRef),
    );
    if (candidate === undefined) return undefined;
    const actions = await this.#db
      .selectFrom("business.agent_task_actions")
      .select(["action_id", "sequence"])
      .where("agent_task_id", "=", input.taskRef.reference.entityId)
      .orderBy("sequence", "asc")
      .execute();
    return {
      taskRef: input.taskRef,
      taskType: input.expectedTaskType,
      resultRef: input.resultRef,
      frozenInputRef: envelope.frozenInputRef,
      parentRunRef: envelope.parentRunRef,
      candidateVersion: candidate.candidate_version,
      candidateArtifactRef: ArtifactRefV1Schema.parse(candidate.candidate_artifact_ref),
      incrementArtifactRef: ArtifactRefV1Schema.parse(candidate.increment_artifact_ref),
      ...(candidate.validation === null
        ? {}
        : { validation: AgentValidationResultV1Schema.parse(candidate.validation) }),
      usage: AgentBudgetLedgerV1Schema.parse(row.budget_ledger).used,
      actionRefs: actions.map((action) => ({
        entityId: action.action_id,
        versionId: String(action.sequence),
      })),
    };
  }

  /** 读取路径的数据库故障保留 C03 一致的可重试与不可恢复语义。 */
  async #withinReadFailureRead<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      throw mapPostgresError(error, READ_FAILURE_EVIDENCE_COMMAND_KIND);
    }
  }

  #readFailureDenied(causalRunId: string): ModuleErrorV1 {
    return ModuleErrorV1Schema.parse({
      stageCode: READ_FAILURE_EVIDENCE_COMMAND_KIND,
      occurredAt: IsoDateTimeSchema.parse(this.#now()),
      causalRunId,
      code: "AUTHORIZATION_DENIED",
      category: "authorization",
      retryable: false,
      requiredCapability: READ_FAILURE_EVIDENCE_CAPABILITY,
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
    });
  }

  #readFailureError(error: unknown, causalRunId: string): ModuleErrorV1 {
    if (error instanceof AccessServiceError) {
      const access = error.details;
      if (access.code === "ACCESS_TRANSIENT_FAILURE" || access.code === "ACCESS_TERMINAL_FAILURE")
        return mapAgentError(
          new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_PERSISTENCE_FAILURE",
              category: "persistence",
              retryable: access.retryable,
              stage: access.stage,
              ...(access.diagnosticRef.kind === "diagnostic-artifact"
                ? { diagnosticRef: access.diagnosticRef }
                : {}),
            }),
          ),
          { causalRunId },
        );
      return this.#readFailureDenied(causalRunId);
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
    if (error instanceof AgentRuntimeError && error.details.code === "AGENT_AUTHORIZATION_DENIED")
      return this.#readFailureDenied(causalRunId);
    return mapAgentError(error, { causalRunId });
  }

  /**
   * 只读三张 C08 现有表的窄列：任务投影、动作序号、候选与校验工件引用。
   * 任一持久化事实与请求不符时返回 `undefined`，由调用方统一收口为不可枚举拒绝。
   */
  async #projectTerminalFailure(input: {
    readonly projectId: string;
    readonly taskRef: AgentTaskRefV1;
    readonly expectedTaskType: AgentTaskTypeV1;
  }): Promise<AgentTaskFailureEvidenceV1 | undefined> {
    const row = await this.#db
      .selectFrom("business.agent_tasks")
      .select([
        "agent_task_ref",
        "task_type",
        "status",
        "cancel_reason_code",
        "error",
        "budget_ledger",
      ])
      .where("agent_task_id", "=", input.taskRef.reference.entityId)
      .where("project_id", "=", input.projectId)
      .where("version_id", "=", input.taskRef.reference.versionId)
      .executeTakeFirst();
    if (row === undefined) return undefined;
    const storedRef = AgentTaskRefV1Schema.parse(row.agent_task_ref);
    if (
      row.task_type !== input.expectedTaskType ||
      storedRef.taskType !== input.expectedTaskType ||
      !agentTaskRefEquals(storedRef, input.taskRef) ||
      (row.status !== "terminal-failure" && row.status !== "cancelled")
    )
      return undefined;
    const actions = await this.#db
      .selectFrom("business.agent_task_actions")
      .select(["action_id", "sequence"])
      .where("agent_task_id", "=", input.taskRef.reference.entityId)
      .orderBy("sequence", "asc")
      .execute();
    const candidates = await this.#db
      .selectFrom("business.agent_task_candidates")
      .select(["candidate_artifact_ref", "validation"])
      .where("agent_task_id", "=", input.taskRef.reference.entityId)
      .orderBy("candidate_version", "asc")
      .execute();
    const validationArtifactRefs: ArtifactRefV1[] = [];
    const seenValidationRefs = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.validation === null) continue;
      const ref = AgentValidationResultV1Schema.parse(candidate.validation).validationArtifactRef;
      const key = `${ref.kind}\u0000${ref.reference.entityId}\u0000${ref.reference.versionId}`;
      if (seenValidationRefs.has(key)) continue;
      seenValidationRefs.add(key);
      validationArtifactRefs.push(ref);
    }
    return {
      taskRef: input.taskRef,
      taskType: input.expectedTaskType,
      terminalStatus: row.status,
      ...(row.error === null ? {} : { error: AgentStructuredErrorV1Schema.parse(row.error) }),
      ...(row.cancel_reason_code === null ? {} : { cancelReasonCode: row.cancel_reason_code }),
      usage: AgentBudgetLedgerV1Schema.parse(row.budget_ledger).used,
      actionRefs: actions.map((action) => ({
        entityId: action.action_id,
        versionId: String(action.sequence),
      })),
      candidateArtifactRefs: candidates.map((candidate) =>
        ArtifactRefV1Schema.parse(candidate.candidate_artifact_ref),
      ),
      validationArtifactRefs,
    };
  }

  /** 每次查看失败证据独立追加审计，requestId 用于关联调用。 */
  async #closeTerminalFailureRead(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestId: string;
    readonly requestedAt: string;
    readonly taskRef: AgentTaskRefV1;
    readonly expectedTaskType: AgentTaskTypeV1;
    readonly authorization: AuthorizationContextV1;
  }): Promise<void> {
    const accessId = randomUUID();
    await this.#db
      .insertInto("audit.entries")
      .values({
        audit_entry_id: accessId,
        project_id: input.projectId,
        action: READ_FAILURE_EVIDENCE_COMMAND_KIND,
        target_ref: jsonValue(input.taskRef),
        actor_ref: input.actorId,
        authorization_context_ref: jsonValue(input.authorization.authorizationContextRef),
        version_ref: jsonValue(input.taskRef.reference),
        occurred_at: input.requestedAt,
        recorded_at: this.#now(),
        persisted_at: sql`clock_timestamp()`,
        command_id: input.requestId,
        idempotency_key: accessId,
        run_id: null,
        thread_id: null,
        reason_ref: null,
      })
      .execute();
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
    const receipt = await this.#executeAgentTransaction(command, async (context) => {
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
            ...(action.errorCode === "AGENT_VALIDATION_REJECTED"
              ? { corrections: 1 }
              : { transientRetries: (input.amount?.transientRetries ?? 0) + 1 }),
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
        amount: input.amount ?? {},
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
        const usage = settledActionUsage(actionValue, requestedUsage);
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
        const usage = settledActionUsage(action, requestedUsage);
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
          {
            allowWallClockOverrun: error.code === "AGENT_WALL_CLOCK_EXCEEDED",
            allowBudgetOverrun: error.category === "budget" && !error.retryable,
          },
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
      if (!isAuthorizationSubset(task.envelope.authorization, decision.context))
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
