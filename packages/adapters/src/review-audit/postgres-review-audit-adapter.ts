import { randomUUID } from "node:crypto";

import {
  sql,
  type ColumnType,
  type InsertObject,
  type Kysely,
  type Selectable,
  type Transaction,
} from "kysely";

import {
  ACCESS_POLICY_REF_V1,
  AccessServiceError,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  createPendingReviewTask,
  reviewTargetEquals,
  reviewTaskRefEquals,
  supersedeReviewTask,
  validateReviewDecision,
  ReviewRejectionAuditV1Schema,
  ReviewTaskStateV1Schema,
  reviewTaskIdentityKey,
  type ReviewTaskStateV1,
} from "@riskflow/core/review-audit";
import type { IdentificationGroupDecisionReadV1 } from "@riskflow/core/identification/candidate-finalization";
import type { IdentificationPendingReviewReadV1 } from "@riskflow/core/identification/human-review";
import {
  AtomicCommandV1Schema,
  type AtomicCommitV1,
  type AtomicCommandV1,
  type JsonValue,
  type TransactionContextV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import {
  MODULE_BRANCH_CAPABILITY_V1,
  CalibrationSuggestionApprovalProofQueryV1Schema,
  CalibrationSuggestionApprovalProofResultV1Schema,
  IdentificationGroupRefV1Schema,
  KnowledgeRevisionApprovalProofQueryV1Schema,
  KnowledgeRevisionApprovalProofResultV1Schema,
  ReviewDecisionCommandV1Schema,
  ReviewDecisionResultV1Schema,
  ReviewDecisionRefV1Schema,
  ReviewDecisionV1Schema,
  ReviewRequestResultV1Schema,
  ReviewRequestV1Schema,
  ReviewTargetRefV1Schema,
  ReviewTaskRefV1Schema,
  RuleConflictRefV1Schema,
  TraceQueryV1Schema,
  TraceResultV1Schema,
  ValidationSnapshotRefV1Schema,
  EvidenceSnapshotRefV1Schema,
  WorkflowRunRefV1Schema,
  type AuthorizationContextV1,
  type CalibrationSuggestionApprovalProofPortV1,
  type CalibrationSuggestionApprovalProofQueryV1,
  type CalibrationSuggestionApprovalProofResultV1,
  type ContractReferenceV1,
  type IdentificationGroupRefV1,
  type KnowledgeRevisionApprovalProofQueryV1,
  type KnowledgeRevisionApprovalProofResultV1,
  type ModuleBranchV1,
  type ModuleErrorV1,
  type ReviewAuditPortV1,
  type ReviewDecisionCommandV1,
  type ReviewDecisionRefV1,
  type ReviewDecisionResultV1,
  type ReviewDecisionV1,
  type ReviewRequestV1,
  type ReviewRequestResultV1,
  type ReviewTaskRefV1,
  type ReviewTargetRefV1,
  type RuleConflictRefV1,
  type TraceResultV1,
  type TraceQueryV1,
} from "@riskflow/contracts/ports";
import { IdentifierSchema, VersionReferenceSchema } from "@riskflow/contracts/common";
import { DomainEventV1Schema, type DomainEventV1 } from "@riskflow/contracts/events";

import { makePersistenceError, mapPostgresError } from "../postgres/pool.js";
import { getPostgresTransaction } from "../postgres/transaction-unit.js";
import type { PostgresDatabase } from "../postgres/types.js";

type JsonColumn = ColumnType<JsonValue, JsonValue, JsonValue>;
type TimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;
type ReadTimestamp = Date | string;

interface ReviewTaskRow {
  review_task_id: string;
  version_id: string;
  project_id: string;
  review_type: string;
  target_kind: string;
  target_entity_id: string;
  target_version_id: string;
  target_ref: JsonColumn;
  waiting_run_entity_id: string;
  waiting_run_version_id: string;
  waiting_run_ref: JsonColumn;
  review_task_ref: JsonColumn;
  validation_snapshot_ref: JsonColumn;
  evidence_snapshot_ref: JsonColumn;
  review_policy_ref: JsonColumn;
  status: "pending" | "decided" | "superseded";
  decision_ref: JsonColumn | null;
  requested_by: string;
  requested_authorization_context_ref: JsonColumn;
  requested_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
  decided_at: TimestampColumn | null;
  superseded_at: TimestampColumn | null;
  superseded_by_command_id: string | null;
  superseded_by_actor: string | null;
}

interface ReviewDecisionRow {
  review_decision_id: string;
  version_id: string;
  review_task_id: string;
  review_decision_ref: JsonColumn;
  project_id: string;
  review_type: string;
  review_task_ref: JsonColumn;
  target_ref: JsonColumn;
  decision: JsonColumn;
  reason_code: string;
  validation_snapshot_ref: JsonColumn;
  evidence_snapshot_ref: JsonColumn;
  waiting_run_ref: JsonColumn;
  review_policy_ref: JsonColumn;
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  decided_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface ReviewRejectionRow {
  rejection_id: string;
  project_id: string;
  command_id: string;
  idempotency_key: string;
  review_task_ref: JsonColumn;
  target_ref: JsonColumn;
  waiting_run_ref: JsonColumn;
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  result_code: "STALE_VERSION" | "ENTITY_NOT_FOUND";
  reason_code: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface ReviewActivityRow {
  activity_id: string;
  project_id: string;
  subject_kind: string | null;
  subject_entity_id: string | null;
  subject_version_id: string | null;
  recorded_at: ReadTimestamp;
}

type ReviewAuditDatabase = PostgresDatabase & {
  "business.review_tasks": ReviewTaskRow;
  "business.review_decisions": ReviewDecisionRow;
  "audit.review_rejections": ReviewRejectionRow;
  "audit.review_activity_v1": ReviewActivityRow;
};
type ReviewTransaction = Transaction<ReviewAuditDatabase>;

const asReviewTransaction = (context: TransactionContextV1): ReviewTransaction =>
  getPostgresTransaction(context) as unknown as ReviewTransaction;

const jsonValue = (value: unknown): JsonValue => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("value is not JSON serializable");
  return JSON.parse(serialized) as JsonValue;
};

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const nowIso = (clock: () => Date): string => {
  const value = clock();
  if (Number.isNaN(value.getTime())) throw new TypeError("clock returned an invalid date");
  return value.toISOString();
};

const randomId = (prefix: string): string => `${prefix}-${randomUUID()}`;

const targetAsContractReference = (target: ReviewTargetRefV1): ContractReferenceV1 =>
  target as ContractReferenceV1;

const taskAsContractReference = (task: ReviewTaskRefV1): ContractReferenceV1 =>
  task as ContractReferenceV1;

const waitingRunFromTask = (task: ReviewTaskRefV1) => task.waitingRunRef;

const referenceKey = (reference: ContractReferenceV1): { entityId: string; versionId: string } =>
  "reference" in reference
    ? reference.reference
    : { entityId: reference.eventId, versionId: String(reference.eventVersion) };

const versionedRefEquals = (
  left: { readonly reference: { readonly entityId: string; readonly versionId: string } },
  right: { readonly reference: { readonly entityId: string; readonly versionId: string } },
): boolean =>
  left.reference.entityId === right.reference.entityId &&
  left.reference.versionId === right.reference.versionId;

const taskFromRow = (row: Selectable<ReviewTaskRow>): ReviewTaskStateV1 =>
  ReviewTaskStateV1Schema.parse({
    reviewTaskRef: row.review_task_ref,
    projectId: row.project_id,
    validationSnapshotRef: row.validation_snapshot_ref,
    evidenceSnapshotRef: row.evidence_snapshot_ref,
    reviewPolicyRef: row.review_policy_ref,
    status: row.status,
    ...(row.decision_ref === null ? {} : { decisionRef: row.decision_ref }),
    requestedBy: row.requested_by,
    requestedAuthorizationContextRef: row.requested_authorization_context_ref,
    requestedAt: asIso(row.requested_at),
    recordedAt: asIso(row.recorded_at),
    persistedAt: asIso(row.persisted_at),
    ...(row.decided_at === null ? {} : { decidedAt: asIso(row.decided_at) }),
    ...(row.superseded_at === null ? {} : { supersededAt: asIso(row.superseded_at) }),
    ...(row.superseded_by_command_id === null
      ? {}
      : { supersededByCommandId: row.superseded_by_command_id }),
    ...(row.superseded_by_actor === null ? {} : { supersededByActor: row.superseded_by_actor }),
  });

const taskRow = (
  task: ReviewTaskStateV1,
): InsertObject<ReviewAuditDatabase, "business.review_tasks"> => ({
  review_task_id: task.reviewTaskRef.reference.entityId,
  version_id: task.reviewTaskRef.reference.versionId,
  project_id: task.projectId,
  review_type: task.reviewTaskRef.reviewType,
  target_kind: task.reviewTaskRef.targetRef.kind,
  target_entity_id: task.reviewTaskRef.targetRef.reference.entityId,
  target_version_id: task.reviewTaskRef.targetRef.reference.versionId,
  target_ref: jsonValue(task.reviewTaskRef.targetRef),
  waiting_run_entity_id: task.reviewTaskRef.waitingRunRef.reference.entityId,
  waiting_run_version_id: task.reviewTaskRef.waitingRunRef.reference.versionId,
  waiting_run_ref: jsonValue(task.reviewTaskRef.waitingRunRef),
  review_task_ref: jsonValue(task.reviewTaskRef),
  validation_snapshot_ref: jsonValue(task.validationSnapshotRef),
  evidence_snapshot_ref: jsonValue(task.evidenceSnapshotRef),
  review_policy_ref: jsonValue(task.reviewPolicyRef),
  status: task.status,
  decision_ref: task.decisionRef === undefined ? null : jsonValue(task.decisionRef),
  requested_by: task.requestedBy,
  requested_authorization_context_ref: jsonValue(task.requestedAuthorizationContextRef),
  requested_at: task.requestedAt,
  ...(task.recordedAt === undefined ? {} : { recorded_at: task.recordedAt }),
  ...(task.persistedAt === undefined ? {} : { persisted_at: task.persistedAt }),
  decided_at: task.decidedAt ?? null,
  superseded_at: task.supersededAt ?? null,
  superseded_by_command_id: task.supersededByCommandId ?? null,
  superseded_by_actor: task.supersededByActor ?? null,
});

const atomicPayload = (value: object): Record<string, JsonValue> =>
  jsonValue(value) as Record<string, JsonValue>;

const atomicCommand = (
  command: ReviewRequestV1 | ReviewDecisionCommandV1,
  commandKind: string,
  payload: object,
): AtomicCommandV1 =>
  AtomicCommandV1Schema.parse({
    projectId: command.projectId,
    commandKind,
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    payload: atomicPayload(payload),
    actorRef: command.actorId,
    authorizationContextRef: command.authorization.authorizationContextRef,
    issuedAt: command.issuedAt,
  });

const auditTrailRef = (auditEntryId: string) => ({
  kind: "audit-trail" as const,
  reference: { entityId: auditEntryId, versionId: "1" },
});

const makeRequestEvent = (
  request: ReviewRequestV1,
  task: ReviewTaskRefV1,
  auditEntryId: string,
  recordedAt: string,
): DomainEventV1 =>
  DomainEventV1Schema.parse({
    schemaVersion: "1",
    eventId: randomId("event"),
    eventVersion: 1,
    eventType: "review.review-requested.v1",
    projectId: request.projectId,
    aggregateRef: taskAsContractReference(task),
    occurredAt: request.issuedAt,
    recordedAt,
    causationId: request.commandId,
    correlationId: task.waitingRunRef.reference.entityId,
    producerCommandId: request.commandId,
    idempotencyKey: request.idempotencyKey,
    authorizationContextRef: request.authorization.authorizationContextRef,
    auditTrailRef: auditTrailRef(auditEntryId),
    payload: {
      reviewTaskRef: task,
      targetRef: targetAsContractReference(task.targetRef),
      waitingRunRef: waitingRunFromTask(task),
    },
  });

const makeDecisionEvent = (
  command: ReviewDecisionCommandV1,
  task: ReviewTaskRefV1,
  decisionRef: ReviewDecisionRefV1,
  auditEntryId: string,
  recordedAt: string,
): DomainEventV1 =>
  DomainEventV1Schema.parse({
    schemaVersion: "1",
    eventId: randomId("event"),
    eventVersion: 1,
    eventType: "review.review-resolved.v1",
    projectId: command.projectId,
    aggregateRef: taskAsContractReference(task),
    occurredAt: command.issuedAt,
    recordedAt,
    causationId: command.commandId,
    correlationId: task.waitingRunRef.reference.entityId,
    producerCommandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    authorizationContextRef: command.authorization.authorizationContextRef,
    auditTrailRef: auditTrailRef(auditEntryId),
    payload: {
      reviewTaskRef: task,
      reviewDecisionRef: decisionRef,
      resumeRunRef: task.waitingRunRef,
    },
  });

type ReviewFailure = {
  readonly resultCode: "STALE_VERSION" | "ENTITY_NOT_FOUND";
  readonly reasonCode: string;
  readonly reviewTaskRef: ReviewTaskRefV1;
  readonly targetRef: ReviewTargetRefV1;
};

const reviewFailure = (failure: ReviewFailure): Error => {
  const error = makePersistenceError("TRANSACTION_FAILED", "review-audit.domain");
  Object.defineProperty(error, "reviewFailure", { value: failure });
  return error;
};

const readReviewFailure = (error: unknown): ReviewFailure | undefined => {
  if (!(error instanceof Error)) return undefined;
  const candidate = (error as Error & { reviewFailure?: unknown }).reviewFailure;
  if (candidate === undefined || typeof candidate !== "object" || candidate === null)
    return undefined;
  const parsed = candidate as Partial<ReviewFailure>;
  return parsed.resultCode !== undefined &&
    parsed.reasonCode !== undefined &&
    parsed.reviewTaskRef !== undefined &&
    parsed.targetRef !== undefined
    ? {
        resultCode: parsed.resultCode,
        reasonCode: parsed.reasonCode,
        reviewTaskRef: parsed.reviewTaskRef,
        targetRef: parsed.targetRef,
      }
    : undefined;
};

const moduleError = (
  value:
    | {
        readonly code: "AUTHORIZATION_DENIED";
        readonly branch: ModuleBranchV1;
        readonly causalRunId: string;
      }
    | {
        readonly code: "ENTITY_NOT_FOUND" | "STALE_VERSION";
        readonly targetRef: ContractReferenceV1;
        readonly causalRunId: string;
      }
    | {
        readonly code: "BUSINESS_BLOCKED";
        readonly causalRunId: string;
        readonly blockerKind?: string;
        readonly blockerRef?: ContractReferenceV1;
      }
    | {
        readonly code: "IDEMPOTENCY_CONFLICT";
        readonly idempotencyKey: string;
        readonly priorCommandId: string;
        readonly causalRunId: string;
      }
    | { readonly code: "UNSUPPORTED_CONTRACT"; readonly causalRunId: string }
    | {
        readonly code: "TRANSIENT_FAILURE" | "TERMINAL_FAILURE";
        readonly causalRunId: string;
      },
): ModuleErrorV1 => {
  const common = {
    stageCode: `review-audit.${value.code.toLowerCase()}`,
    occurredAt: new Date().toISOString(),
    causalRunId: IdentifierSchema.parse(value.causalRunId),
  };
  if (value.code === "AUTHORIZATION_DENIED") {
    return {
      ...common,
      code: value.code,
      category: "authorization",
      retryable: false,
      requiredCapability: MODULE_BRANCH_CAPABILITY_V1[value.branch],
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
    };
  }
  if (value.code === "ENTITY_NOT_FOUND" || value.code === "STALE_VERSION") {
    if (value.code === "ENTITY_NOT_FOUND") {
      return {
        ...common,
        code: value.code,
        category: "not-found",
        retryable: false,
        targetRef: value.targetRef,
      };
    }
    return {
      ...common,
      code: value.code,
      category: "concurrency",
      retryable: false,
      targetRef: value.targetRef,
    };
  }
  if (value.code === "BUSINESS_BLOCKED") {
    // 冲突门禁的读取失败不携带调用方上下文：blockerKind/blockerRef 仅用于满足 ModuleErrorV1 形状，
    // 默认指向 review-audit 自身的稳定占位引用，避免回显被查询的规则冲突目标。
    return {
      ...common,
      code: value.code,
      category: "business-blocked",
      retryable: false,
      blockerKind: IdentifierSchema.parse(value.blockerKind ?? "rule-conflict"),
      blockerRef: value.blockerRef ?? {
        kind: "rule-conflict",
        reference: { entityId: "review-audit-rule-conflict-decision-read", versionId: "1" },
      },
    };
  }
  if (value.code === "IDEMPOTENCY_CONFLICT") {
    return {
      ...common,
      code: value.code,
      category: "idempotency",
      retryable: false,
      idempotencyKey: value.idempotencyKey,
      priorCommandId: value.priorCommandId,
    };
  }
  if (value.code === "UNSUPPORTED_CONTRACT") {
    return {
      ...common,
      code: value.code,
      category: "technical",
      retryable: false,
      schemaVersion: "1",
    };
  }
  if (value.code === "TRANSIENT_FAILURE") {
    return {
      ...common,
      code: value.code,
      category: "technical",
      retryable: true,
      attempt: 1,
      retryPolicyRef: { entityId: "review-audit-retry-policy", versionId: "1" },
      diagnosticRef: {
        kind: "diagnostic-artifact",
        reference: { entityId: "review-audit-transient-failure", versionId: "1" },
      },
    };
  }
  return {
    ...common,
    code: value.code,
    category: "technical",
    retryable: false,
    diagnosticRef: {
      kind: "diagnostic-artifact",
      reference: { entityId: "review-audit-terminal-failure", versionId: "1" },
    },
  };
};

export interface PostgresReviewAuditAdapterOptions {
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: TransactionUnitV1;
  readonly access: LocalIdentityAccessV1;
  readonly now?: () => Date;
}

/**
 * C19 规则冲突门禁专用的窄读取结果。
 *
 * 该类型只服务 C19 冲突门禁按当前事实复核后的放行判断，属于适配器层面的窄读取接口，
 * 不进入公共 `ReviewAuditPortV1`：它不写审计、不发事件、不改任务状态，只做只读单点查询。
 * - `pending`：任务存在且事实一致，但尚未裁决（含 `pending`/`superseded`）。
 * - `failed`：授权失败或任务/决定事实不一致；错误不暴露目标是否存在。
 */
export type RuleConflictDecisionReadV1 =
  | {
      readonly kind: "decided";
      readonly decision: "approve-publication" | "reject" | "return-for-revision";
      readonly reviewDecisionRef: ReviewDecisionRefV1;
      readonly decidedAt: string;
    }
  | { readonly kind: "pending" }
  | { readonly kind: "failed"; readonly error: ModuleErrorV1 };

export class PostgresReviewAuditAdapter
  implements ReviewAuditPortV1, CalibrationSuggestionApprovalProofPortV1
{
  readonly #db: Kysely<ReviewAuditDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #access: LocalIdentityAccessV1;
  readonly #now: () => Date;

  constructor(options: PostgresReviewAuditAdapterOptions) {
    this.#db = options.db as unknown as Kysely<ReviewAuditDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#access = options.access;
    this.#now = options.now ?? (() => new Date());
  }

  async requestReview(request: ReviewRequestV1): Promise<ReviewRequestResultV1> {
    const parsed = ReviewRequestV1Schema.safeParse(request);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: "review-request" }),
      };
    }
    const valid = parsed.data;
    try {
      await this.#verify(
        valid.authorization,
        valid.projectId,
        valid.commandId,
        "review-audit.request-review",
      );
      const command = atomicCommand(valid, "review.request-review.v1", valid);
      const receipt = await this.#transactionUnit.execute(command, async (context) =>
        this.#requestInTransaction(context, valid),
      );
      const reviewTaskRef = ReviewTaskRefV1Schema.parse(receipt.resultRef);
      return ReviewRequestResultV1Schema.parse({ kind: "succeeded", result: { reviewTaskRef } });
    } catch (error) {
      return {
        kind: "failed",
        error: await this.#mapError(error, {
          branch: "review-audit.request-review",
          causalRunId: valid.payload.waitingRunRef.reference.entityId,
          command: valid,
        }),
      };
    }
  }

  async decideReview(command: ReviewDecisionCommandV1): Promise<ReviewDecisionResultV1> {
    const parsed = ReviewDecisionCommandV1Schema.safeParse(command);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: "review-decision" }),
      };
    }
    const valid = parsed.data;
    const causalRunId = valid.payload.reviewTaskRef.waitingRunRef.reference.entityId;
    try {
      await this.#verify(
        valid.authorization,
        valid.projectId,
        valid.commandId,
        "review-audit.decide-review",
      );
      const atomic = atomicCommand(valid, "review.decide-review.v1", valid);
      const receipt = await this.#transactionUnit.execute(atomic, async (context) =>
        this.#decideInTransaction(context, valid),
      );
      const reviewDecisionRef = ReviewDecisionRefV1Schema.parse(receipt.resultRef);
      return ReviewDecisionResultV1Schema.parse({
        kind: "succeeded",
        result: { reviewDecisionRef },
      });
    } catch (error) {
      const failure = readReviewFailure(error);
      if (failure !== undefined) {
        try {
          await this.#appendRejection(valid, failure);
        } catch (rejectionError) {
          return {
            kind: "failed",
            error: await this.#mapError(rejectionError, {
              branch: "review-audit.decide-review",
              causalRunId,
              command: valid,
            }),
          };
        }
        return {
          kind: "failed",
          error:
            failure.resultCode === "STALE_VERSION"
              ? moduleError({
                  code: "STALE_VERSION",
                  targetRef: taskAsContractReference(failure.reviewTaskRef),
                  causalRunId,
                })
              : moduleError({
                  code: "ENTITY_NOT_FOUND",
                  targetRef: taskAsContractReference(failure.reviewTaskRef),
                  causalRunId,
                }),
        };
      }
      return {
        kind: "failed",
        error: await this.#mapError(error, {
          branch: "review-audit.decide-review",
          causalRunId,
          command: valid,
        }),
      };
    }
  }

  async verifyKnowledgeRevisionApproval(
    query: KnowledgeRevisionApprovalProofQueryV1,
  ): Promise<KnowledgeRevisionApprovalProofResultV1> {
    const parsed = KnowledgeRevisionApprovalProofQueryV1Schema.safeParse(query);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: "review-approval-proof" }),
      };
    }
    const valid = parsed.data;
    try {
      await this.#verify(
        valid.authorization,
        valid.projectId,
        valid.queryId,
        "review-audit.verify-knowledge-revision-approval",
      );
      const projection = await this.#projectDecisionWithTask({
        projectId: valid.projectId,
        reviewDecisionRef: valid.payload.reviewDecisionRef,
      });
      if (projection === undefined) {
        return KnowledgeRevisionApprovalProofResultV1Schema.parse({
          kind: "succeeded",
          result: { kind: "not-approved", reason: "decision-not-found" },
        });
      }
      const { decisionRef, taskRef, decision, decidedAt } = projection;
      if (!reviewTargetEquals(taskRef.targetRef, valid.payload.revisionRef)) {
        return KnowledgeRevisionApprovalProofResultV1Schema.parse({
          kind: "succeeded",
          result: { kind: "not-approved", reason: "target-mismatch" },
        });
      }
      if (
        taskRef.reviewType !== "knowledge-revision" ||
        decision.reviewType !== "knowledge-revision"
      ) {
        throw new TypeError("review approval proof type is inconsistent");
      }
      if (decision.kind !== "approve-publication") {
        return KnowledgeRevisionApprovalProofResultV1Schema.parse({
          kind: "succeeded",
          result: { kind: "not-approved", reason: "decision-not-approval" },
        });
      }

      return KnowledgeRevisionApprovalProofResultV1Schema.parse({
        kind: "succeeded",
        result: {
          kind: "approved",
          revisionRef: valid.payload.revisionRef,
          reviewTaskRef: taskRef,
          reviewDecisionRef: decisionRef,
          decidedAt,
        },
      });
    } catch (error) {
      return {
        kind: "failed",
        error: await this.#mapError(error, {
          branch: "review-audit.verify-knowledge-revision-approval",
          causalRunId: valid.queryId,
        }),
      };
    }
  }

  /**
   * C29 专用证明查询：复用知识修订证明的授权先行与按工程/决定精确投影路径，
   * 只把合法决定收窄为 `approve-draft-creation`；不写业务审计、拒绝审计、回执或 Outbox。
   */
  async verifyCalibrationSuggestionApproval(
    query: CalibrationSuggestionApprovalProofQueryV1,
  ): Promise<CalibrationSuggestionApprovalProofResultV1> {
    const parsed = CalibrationSuggestionApprovalProofQueryV1Schema.safeParse(query);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: moduleError({
          code: "UNSUPPORTED_CONTRACT",
          causalRunId: "calibration-approval-proof",
        }),
      };
    }
    const valid = parsed.data;
    try {
      await this.#verify(
        valid.authorization,
        valid.projectId,
        valid.queryId,
        "review-audit.verify-calibration-suggestion-approval",
      );
      const projection = await this.#projectDecisionWithTask({
        projectId: valid.projectId,
        reviewDecisionRef: valid.payload.reviewDecisionRef,
      });
      if (projection === undefined) {
        return CalibrationSuggestionApprovalProofResultV1Schema.parse({
          kind: "succeeded",
          result: { kind: "not-approved", reason: "decision-not-found" },
        });
      }
      const { decisionRef, taskRef, decision, decidedAt } = projection;
      if (!reviewTargetEquals(taskRef.targetRef, valid.payload.calibrationSuggestionRef)) {
        return CalibrationSuggestionApprovalProofResultV1Schema.parse({
          kind: "succeeded",
          result: { kind: "not-approved", reason: "target-mismatch" },
        });
      }
      if (
        taskRef.reviewType !== "calibration-suggestion" ||
        decision.reviewType !== "calibration-suggestion"
      ) {
        throw new TypeError("calibration approval proof type is inconsistent");
      }
      return CalibrationSuggestionApprovalProofResultV1Schema.parse({
        kind: "succeeded",
        result: {
          kind:
            decision.kind === "approve-draft-creation"
              ? "approved-for-draft"
              : decision.kind === "reject"
                ? "rejected"
                : "returned-for-revision",
          calibrationSuggestionRef: valid.payload.calibrationSuggestionRef,
          reviewTaskRef: taskRef,
          reviewDecisionRef: decisionRef,
          decidedAt,
        },
      });
    } catch (error) {
      return {
        kind: "failed",
        error: await this.#mapError(error, {
          branch: "review-audit.verify-calibration-suggestion-approval",
          causalRunId: valid.queryId,
        }),
      };
    }
  }

  /**
   * 两类批准证明共用的只读投影：按工程和精确决定引用读取 C07 自有事实并复验
   * 任务/决定互相一致。不存在返回 `undefined`；不可能状态抛技术完整性失败。
   */
  async #projectDecisionWithTask(input: {
    readonly projectId: string;
    readonly reviewDecisionRef: ReviewDecisionRefV1;
  }): Promise<
    | {
        readonly decisionRef: ReviewDecisionRefV1;
        readonly taskRef: ReviewTaskRefV1;
        readonly decision: ReviewDecisionV1;
        readonly decidedAt: string;
      }
    | undefined
  > {
    const row = await this.#db
      .selectFrom("business.review_decisions as decision")
      .innerJoin("business.review_tasks as task", (join) =>
        join
          .onRef("task.review_task_id", "=", "decision.review_task_id")
          .onRef("task.project_id", "=", "decision.project_id"),
      )
      .select([
        "decision.review_decision_id as decisionId",
        "decision.version_id as decisionVersionId",
        "decision.project_id as decisionProjectId",
        "decision.review_task_id as decisionTaskId",
        "decision.review_decision_ref as decisionRef",
        "decision.review_type as decisionType",
        "decision.review_task_ref as decisionTaskRef",
        "decision.target_ref as decisionTargetRef",
        "decision.decision as decision",
        "decision.decided_at as decisionAt",
        "task.review_task_id as taskId",
        "task.version_id as taskVersionId",
        "task.project_id as taskProjectId",
        "task.review_type as taskType",
        "task.target_kind as taskTargetKind",
        "task.target_entity_id as taskTargetEntityId",
        "task.target_version_id as taskTargetVersionId",
        "task.review_task_ref as taskRef",
        "task.target_ref as taskTargetRef",
        "task.status as taskStatus",
        "task.decision_ref as taskDecisionRef",
        "task.decided_at as taskDecidedAt",
      ])
      .where("decision.project_id", "=", input.projectId)
      .where("decision.review_decision_id", "=", input.reviewDecisionRef.reference.entityId)
      .where("decision.version_id", "=", input.reviewDecisionRef.reference.versionId)
      .executeTakeFirst();

    if (row === undefined) return undefined;

    const decisionRef = ReviewDecisionRefV1Schema.parse(row.decisionRef);
    const taskRef = ReviewTaskRefV1Schema.parse(row.taskRef);
    const decisionTaskRef = ReviewTaskRefV1Schema.parse(row.decisionTaskRef);
    const decisionTargetRef = ReviewTargetRefV1Schema.parse(row.decisionTargetRef);
    const taskTargetRef = ReviewTargetRefV1Schema.parse(row.taskTargetRef);
    const decision = ReviewDecisionV1Schema.parse(row.decision);
    const taskDecisionRef =
      row.taskDecisionRef === null
        ? undefined
        : ReviewDecisionRefV1Schema.parse(row.taskDecisionRef);
    if (taskDecisionRef === undefined) {
      throw new TypeError("decided review task lacks a decision reference");
    }

    if (
      row.decisionId !== input.reviewDecisionRef.reference.entityId ||
      row.decisionVersionId !== input.reviewDecisionRef.reference.versionId ||
      row.decisionProjectId !== input.projectId ||
      row.taskProjectId !== input.projectId ||
      row.decisionTaskId !== row.taskId ||
      row.taskId !== taskRef.reference.entityId ||
      row.taskVersionId !== taskRef.reference.versionId ||
      row.taskType !== taskRef.reviewType ||
      row.taskTargetKind !== taskRef.targetRef.kind ||
      row.taskTargetEntityId !== taskRef.targetRef.reference.entityId ||
      row.taskTargetVersionId !== taskRef.targetRef.reference.versionId ||
      row.decisionType !== decision.reviewType ||
      row.taskStatus !== "decided" ||
      row.taskDecidedAt === null ||
      row.taskDecisionRef === null ||
      !versionedRefEquals(decisionRef, input.reviewDecisionRef) ||
      !versionedRefEquals(taskDecisionRef, input.reviewDecisionRef) ||
      !reviewTaskRefEquals(decisionTaskRef, taskRef) ||
      !reviewTargetEquals(taskTargetRef, taskRef.targetRef) ||
      !reviewTargetEquals(decisionTargetRef, taskTargetRef) ||
      asIso(row.taskDecidedAt) !== asIso(row.decisionAt)
    ) {
      throw new TypeError("review approval proof facts are inconsistent");
    }

    return { decisionRef, taskRef, decision, decidedAt: asIso(row.decisionAt) };
  }

  async trace(query: TraceQueryV1): Promise<TraceResultV1> {
    const parsed = TraceQueryV1Schema.safeParse(query);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: "review-trace" }),
      };
    }
    const valid = parsed.data;
    try {
      await this.#verify(valid.authorization, valid.projectId, valid.queryId, "review-audit.trace");
      const asOf = valid.payload.asOfRecordedAt ?? (await this.#databaseNow());
      const subject = valid.payload.subjectRef;
      const subjectReference = referenceKey(subject);
      const rows = await this.#db
        .selectFrom("audit.review_activity_v1")
        .select([
          "activity_id",
          "subject_kind",
          "subject_entity_id",
          "subject_version_id",
          "recorded_at",
        ])
        .where("project_id", "=", valid.projectId)
        .where(
          sql<boolean>`(
            (subject_kind = ${subject.kind}
              AND subject_entity_id = ${subjectReference.entityId}
              AND subject_version_id = ${subjectReference.versionId})
            OR (review_task_ref -> 'reference' ->> 'entityId' = ${subjectReference.entityId}
              AND review_task_ref -> 'reference' ->> 'versionId' = ${subjectReference.versionId})
            OR (target_ref ->> 'kind' = ${subject.kind}
              AND target_ref -> 'reference' ->> 'entityId' = ${subjectReference.entityId}
              AND target_ref -> 'reference' ->> 'versionId' = ${subjectReference.versionId})
            OR (review_decision_ref ->> 'kind' = ${subject.kind}
              AND review_decision_ref -> 'reference' ->> 'entityId' = ${subjectReference.entityId}
              AND review_decision_ref -> 'reference' ->> 'versionId' = ${subjectReference.versionId})
            OR (waiting_run_ref ->> 'kind' = ${subject.kind}
              AND waiting_run_ref -> 'reference' ->> 'entityId' = ${subjectReference.entityId}
              AND waiting_run_ref -> 'reference' ->> 'versionId' = ${subjectReference.versionId})
            OR (authorization_context_ref ->> 'kind' = ${subject.kind}
              AND authorization_context_ref -> 'reference' ->> 'entityId' = ${subjectReference.entityId}
              AND authorization_context_ref -> 'reference' ->> 'versionId' = ${subjectReference.versionId})
          )`,
        )
        .where("recorded_at", "<=", new Date(asOf))
        .orderBy("recorded_at", "asc")
        .orderBy("activity_id", "asc")
        .execute();

      const last = rows.at(-1);
      if (last === undefined) {
        return TraceResultV1Schema.parse({
          kind: "succeeded",
          result: {
            queryResultRef: {
              kind: "query-result",
              reference: { entityId: valid.queryId, versionId: "1" },
            },
          },
        });
      }
      return TraceResultV1Schema.parse({
        kind: "succeeded",
        result: {
          auditTrailRef: {
            kind: "audit-trail",
            reference: {
              entityId: `review-audit-${valid.projectId}-${subject.kind}-${subjectReference.entityId}`,
              versionId: last.activity_id,
            },
          },
        },
      });
    } catch (error) {
      return {
        kind: "failed",
        error: await this.#mapError(error, {
          branch: "review-audit.trace",
          causalRunId: valid.queryId,
        }),
      };
    }
  }

  /**
   * C19 规则冲突门禁专用的窄读取：以当前事实复核 `business.review_tasks` / `business.review_decisions`
   * 的单点记录，供门禁判断是否放行。授权分支沿用 `review-audit.trace`，只读、不写审计、不发事件。
   * 任何事实不一致都折叠为 BUSINESS_BLOCKED（不带 reviewTaskId / relationId），避免泄露目标存在性。
   */
  async readRuleConflictDecision(input: {
    readonly projectId: string;
    readonly relationRef: RuleConflictRefV1;
    readonly reviewTaskRef: ReviewTaskRefV1;
    readonly authorization: AuthorizationContextV1;
    readonly invocationId: string;
    readonly requestedAt: string;
  }): Promise<RuleConflictDecisionReadV1> {
    const blocked = (): RuleConflictDecisionReadV1 => ({
      kind: "failed",
      error: moduleError({ code: "BUSINESS_BLOCKED", causalRunId: input.invocationId }),
    });
    try {
      await this.#verify(
        input.authorization,
        input.projectId,
        input.invocationId,
        "review-audit.trace",
      );
      const task = await this.#db
        .selectFrom("business.review_tasks")
        .select([
          "review_type",
          "target_kind",
          "target_entity_id",
          "target_version_id",
          "target_ref",
          "review_task_ref",
          "status",
          "decision_ref",
        ])
        .where("project_id", "=", input.projectId)
        .where("review_task_id", "=", input.reviewTaskRef.reference.entityId)
        .where("version_id", "=", input.reviewTaskRef.reference.versionId)
        .executeTakeFirst();
      if (task === undefined) return blocked();

      const storedTaskRef = ReviewTaskRefV1Schema.parse(task.review_task_ref);
      const storedTargetRef = RuleConflictRefV1Schema.parse(task.target_ref);
      if (
        task.review_type !== "rule-conflict" ||
        task.review_type !== input.reviewTaskRef.reviewType ||
        task.target_kind !== "rule-conflict" ||
        task.target_entity_id !== input.relationRef.reference.entityId ||
        task.target_version_id !== input.relationRef.reference.versionId ||
        !reviewTaskRefEquals(storedTaskRef, input.reviewTaskRef) ||
        !versionedRefEquals(storedTargetRef, input.relationRef)
      ) {
        return blocked();
      }
      if (task.status !== "decided") return { kind: "pending" };

      const decisionRow = await this.#db
        .selectFrom("business.review_decisions")
        .select([
          "review_decision_ref",
          "review_type",
          "review_task_ref",
          "target_ref",
          "decision",
          "decided_at",
        ])
        .where("project_id", "=", input.projectId)
        .where("review_task_id", "=", input.reviewTaskRef.reference.entityId)
        .executeTakeFirst();
      if (decisionRow === undefined || task.decision_ref === null) return blocked();

      const storedDecisionRef = ReviewDecisionRefV1Schema.parse(decisionRow.review_decision_ref);
      const storedTaskDecisionRef = ReviewDecisionRefV1Schema.parse(task.decision_ref);
      const decisionTaskRef = ReviewTaskRefV1Schema.parse(decisionRow.review_task_ref);
      const decisionTargetRef = RuleConflictRefV1Schema.parse(decisionRow.target_ref);
      const decision = ReviewDecisionV1Schema.parse(decisionRow.decision);
      if (
        decisionRow.review_type !== "rule-conflict" ||
        decision.reviewType !== "rule-conflict" ||
        !versionedRefEquals(storedDecisionRef, storedTaskDecisionRef) ||
        !reviewTaskRefEquals(decisionTaskRef, storedTaskRef) ||
        !versionedRefEquals(decisionTargetRef, input.relationRef) ||
        (decision.kind !== "approve-publication" &&
          decision.kind !== "reject" &&
          decision.kind !== "return-for-revision")
      ) {
        return blocked();
      }

      return {
        kind: "decided",
        decision: decision.kind,
        reviewDecisionRef: storedDecisionRef,
        decidedAt: asIso(decisionRow.decided_at),
      };
    } catch (error) {
      return {
        kind: "failed",
        error: await this.#mapError(error, {
          branch: "review-audit.trace",
          causalRunId: input.invocationId,
        }),
      };
    }
  }

  /**
   * C22 验收决定窄读（design D-08）：以当前事实复核 `business.review_tasks` / `business.review_decisions`
   * 的单点记录，供 `accept-groups` 判断人工路线是否已成立。授权分支沿用 `review-audit.trace`，
   * 只读、不写审计、不发事件、不改任务状态，也不返回自由正文。
   * 任何事实不一致都折叠为稳定 `detailCode` 的 `blocked`：目标不存在、跨工程引用与事实不符
   * 彼此不可区分，不泄露目标存在性；`pending` 返回等待，`superseded` 作为陈旧任务阻断。
   */
  async readIdentificationGroupDecision(input: {
    readonly projectId: string;
    readonly groupRef: IdentificationGroupRefV1;
    readonly reviewTaskRef: ReviewTaskRefV1;
    readonly authorization: AuthorizationContextV1;
    readonly invocationId: string;
    readonly requestedAt: string;
  }): Promise<IdentificationGroupDecisionReadV1> {
    const blocked = (detailCode: string): IdentificationGroupDecisionReadV1 => ({
      kind: "blocked",
      detailCode,
    });
    try {
      await this.#verify(
        input.authorization,
        input.projectId,
        input.invocationId,
        "review-audit.trace",
      );
      const task = await this.#db
        .selectFrom("business.review_tasks")
        .select([
          "review_type",
          "target_kind",
          "target_entity_id",
          "target_version_id",
          "target_ref",
          "review_task_ref",
          "status",
          "decision_ref",
        ])
        .where("project_id", "=", input.projectId)
        .where("review_task_id", "=", input.reviewTaskRef.reference.entityId)
        .where("version_id", "=", input.reviewTaskRef.reference.versionId)
        .executeTakeFirst();
      if (task === undefined) return blocked("review-task-not-found");

      const storedTaskRef = ReviewTaskRefV1Schema.parse(task.review_task_ref);
      const storedTargetRef = IdentificationGroupRefV1Schema.parse(task.target_ref);
      if (
        task.review_type !== "identification-group" ||
        task.review_type !== input.reviewTaskRef.reviewType ||
        task.target_kind !== "identification-group" ||
        task.target_entity_id !== input.groupRef.reference.entityId ||
        task.target_version_id !== input.groupRef.reference.versionId ||
        !reviewTaskRefEquals(storedTaskRef, input.reviewTaskRef) ||
        !versionedRefEquals(storedTargetRef, input.groupRef)
      ) {
        return blocked("review-task-fact-mismatch");
      }
      if (task.status === "superseded") return blocked("review-task-stale");
      if (task.status !== "decided") return { kind: "pending" };

      const decisionRow = await this.#db
        .selectFrom("business.review_decisions")
        .select([
          "review_decision_ref",
          "review_type",
          "review_task_ref",
          "target_ref",
          "decision",
          "decided_at",
        ])
        .where("project_id", "=", input.projectId)
        .where("review_task_id", "=", input.reviewTaskRef.reference.entityId)
        .executeTakeFirst();
      if (decisionRow === undefined || task.decision_ref === null) {
        return blocked("review-decision-missing");
      }

      const storedDecisionRef = ReviewDecisionRefV1Schema.parse(decisionRow.review_decision_ref);
      const storedTaskDecisionRef = ReviewDecisionRefV1Schema.parse(task.decision_ref);
      const decisionTaskRef = ReviewTaskRefV1Schema.parse(decisionRow.review_task_ref);
      const decisionTargetRef = IdentificationGroupRefV1Schema.parse(decisionRow.target_ref);
      const decision = ReviewDecisionV1Schema.parse(decisionRow.decision);
      if (
        decisionRow.review_type !== "identification-group" ||
        decision.reviewType !== "identification-group" ||
        !versionedRefEquals(storedDecisionRef, storedTaskDecisionRef) ||
        !reviewTaskRefEquals(decisionTaskRef, storedTaskRef) ||
        !versionedRefEquals(decisionTargetRef, input.groupRef)
      ) {
        return blocked("review-decision-fact-mismatch");
      }

      // 决定联合由契约唯一限定；`approve-revised-candidate` 另需返回修订后的候选集引用。
      return {
        kind: "decided",
        decisionKind: decision.kind,
        reviewDecisionRef: storedDecisionRef,
        ...(decision.kind === "approve-revised-candidate"
          ? { revisedCandidateSetRef: decision.revisedCandidateRef }
          : {}),
        decidedAt: asIso(decisionRow.decided_at),
      };
    } catch (error) {
      // 授权拒绝与数据库失败都折叠为稳定 `blocked`，不区分目标是否存在。
      return blocked(
        error instanceof AccessServiceError
          ? "review-decision-not-authorized"
          : "review-decision-unavailable",
      );
    }
  }

  /**
   * C23 识别复核的待处理任务窄读（design D-03）：先按 `review-audit.decide-review` 验证当前
   * 授权，再按工程与完整任务版本读取 C07 自有事实。只返回精确任务、目标、冻结的验证/证据/复核
   * 策略与等待运行；不返回决定正文、证据正文或数据库行，也不改任务状态、不写审计、不发事件。
   * 事实错配、已替代、跨工程与读取失败折叠为闭合 `blocked`：授权先行使无权调用方无法区分目标
   * 存在性、版本陈旧或属于其它工程。已决定任务返回同一冻结事实（`decided`）仅供同命令重试对账，
   * 新的人工决定仍只能由 C07 在任务为 `pending` 时成立。
   */
  async readPendingIdentificationReview(input: {
    readonly projectId: string;
    readonly reviewTaskRef: ReviewTaskRefV1;
    readonly authorization: AuthorizationContextV1;
    readonly idempotencyKey: string;
    readonly invocationId: string;
    readonly requestedAt: string;
  }): Promise<IdentificationPendingReviewReadV1> {
    const blocked = (detailCode: string): IdentificationPendingReviewReadV1 => ({
      kind: "blocked",
      detailCode,
    });
    try {
      await this.#verify(
        input.authorization,
        input.projectId,
        input.invocationId,
        "review-audit.decide-review",
      );
      const task = await this.#db
        .selectFrom("business.review_tasks")
        .select([
          "review_type",
          "target_kind",
          "target_entity_id",
          "target_version_id",
          "target_ref",
          "review_task_ref",
          "validation_snapshot_ref",
          "evidence_snapshot_ref",
          "review_policy_ref",
          "waiting_run_ref",
          "waiting_run_entity_id",
          "waiting_run_version_id",
          "status",
          "decision_ref",
        ])
        .where("project_id", "=", input.projectId)
        .where("review_task_id", "=", input.reviewTaskRef.reference.entityId)
        .where("version_id", "=", input.reviewTaskRef.reference.versionId)
        .executeTakeFirst();
      if (task === undefined) return blocked("review-task-not-found");

      const storedTaskRef = ReviewTaskRefV1Schema.parse(task.review_task_ref);
      const storedTargetRef = IdentificationGroupRefV1Schema.safeParse(task.target_ref);
      const storedWaitingRunRef = WorkflowRunRefV1Schema.safeParse(task.waiting_run_ref);
      if (!storedTargetRef.success || !storedWaitingRunRef.success) {
        return blocked("review-task-fact-mismatch");
      }
      if (
        task.review_type !== "identification-group" ||
        task.target_kind !== "identification-group" ||
        storedTaskRef.reviewType !== "identification-group" ||
        storedTaskRef.targetRef.kind !== "identification-group" ||
        task.target_entity_id !== storedTargetRef.data.reference.entityId ||
        task.target_version_id !== storedTargetRef.data.reference.versionId ||
        !reviewTaskRefEquals(storedTaskRef, input.reviewTaskRef) ||
        !reviewTargetEquals(storedTaskRef.targetRef, storedTargetRef.data) ||
        task.waiting_run_entity_id !== storedWaitingRunRef.data.reference.entityId ||
        task.waiting_run_version_id !== storedWaitingRunRef.data.reference.versionId ||
        !versionedRefEquals(storedTaskRef.waitingRunRef, storedWaitingRunRef.data)
      ) {
        return blocked("review-task-fact-mismatch");
      }
      // 已替代任务不可复核也不可对账；已决定任务只有在当前命令精确命中原 C07 完成回执时
      // 才返回冻结事实，避免不同命令先生成修订工件、再由决定事务判陈旧。
      if (task.status === "superseded") return blocked("review-task-stale");
      if (task.status === "decided") {
        const storedDecisionRef = ReviewDecisionRefV1Schema.safeParse(task.decision_ref);
        if (!storedDecisionRef.success) return blocked("review-task-fact-mismatch");
        const receipt = await this.#db
          .selectFrom("business.command_receipts")
          .select(["command_id", "result_ref", "completed_at"])
          .where("project_id", "=", input.projectId)
          .where("command_kind", "=", "review.decide-review.v1")
          .where("idempotency_key", "=", input.idempotencyKey)
          .executeTakeFirst();
        const receiptDecisionRef = ReviewDecisionRefV1Schema.safeParse(receipt?.result_ref);
        if (
          receipt === undefined ||
          receipt.completed_at === null ||
          receipt.command_id !== input.invocationId ||
          !receiptDecisionRef.success ||
          !versionedRefEquals(receiptDecisionRef.data, storedDecisionRef.data)
        ) {
          return blocked("review-task-stale");
        }
      }

      const validationSnapshotRef = ValidationSnapshotRefV1Schema.safeParse(
        task.validation_snapshot_ref,
      );
      const evidenceSnapshotRef = EvidenceSnapshotRefV1Schema.safeParse(task.evidence_snapshot_ref);
      const reviewPolicyRef = VersionReferenceSchema.safeParse(task.review_policy_ref);
      if (
        !validationSnapshotRef.success ||
        !evidenceSnapshotRef.success ||
        !reviewPolicyRef.success
      ) {
        return blocked("review-task-fact-mismatch");
      }

      return {
        kind: task.status === "pending" ? "pending" : "decided",
        task: {
          reviewTaskRef: storedTaskRef,
          groupRef: storedTargetRef.data,
          validationSnapshotRef: validationSnapshotRef.data,
          evidenceSnapshotRef: evidenceSnapshotRef.data,
          reviewPolicyRef: reviewPolicyRef.data,
          waitingRunRef: storedWaitingRunRef.data,
        },
      };
    } catch (error) {
      // 授权拒绝与数据库失败都折叠为稳定 `blocked`，不区分目标是否存在。
      return blocked(
        error instanceof AccessServiceError
          ? "review-task-not-authorized"
          : "review-task-unavailable",
      );
    }
  }

  async #verify(
    authorization: AuthorizationContextV1,
    projectId: string,
    invocationId: string,
    branch: ModuleBranchV1,
  ): Promise<void> {
    await this.#access.verify({
      authorizationContextRef: authorization.authorizationContextRef,
      invocationId,
      projectId,
      branch,
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      requestedAt: authorization.decidedAt,
    });
  }

  async #requestInTransaction(
    context: TransactionContextV1,
    request: ReviewRequestV1,
  ): Promise<AtomicCommitV1> {
    const tx = asReviewTransaction(context);
    const target = request.payload.targetRef;
    const stableKey = Buffer.from(
      reviewTaskIdentityKey({
        projectId: request.projectId,
        waitingRunRef: request.payload.waitingRunRef,
        reviewType: request.payload.reviewType,
        targetRef: target,
      }),
      "utf8",
    ).toString("base64url");
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${stableKey}, 0))`.execute(tx);
    const pendingRows = await tx
      .selectFrom("business.review_tasks")
      .selectAll()
      .where("project_id", "=", request.projectId)
      .where("waiting_run_entity_id", "=", request.payload.waitingRunRef.reference.entityId)
      .where("waiting_run_version_id", "=", request.payload.waitingRunRef.reference.versionId)
      .where("review_type", "=", request.payload.reviewType)
      .where("target_kind", "=", target.kind)
      .where("target_entity_id", "=", target.reference.entityId)
      .where("status", "=", "pending")
      .forUpdate()
      .execute();
    const existing = pendingRows.find(
      (row) => row.target_version_id === target.reference.versionId,
    );
    if (existing !== undefined) {
      const existingTask = taskFromRow(existing);
      if (reviewTargetEquals(existingTask.reviewTaskRef.targetRef, target)) {
        const recordedAt = nowIso(this.#now);
        const auditEntryId = randomId("audit");
        return {
          resultRef: taskAsContractReference(existingTask.reviewTaskRef),
          audit: {
            auditEntryId,
            projectId: request.projectId,
            action: "review.request-review",
            targetRef: taskAsContractReference(existingTask.reviewTaskRef),
            actorRef: request.actorId,
            authorizationContextRef: request.authorization.authorizationContextRef,
            occurredAt: request.issuedAt,
            recordedAt,
            version: existingTask.reviewTaskRef.reference,
            commandId: request.commandId,
            idempotencyKey: request.idempotencyKey,
          },
          events: [makeRequestEvent(request, existingTask.reviewTaskRef, auditEntryId, recordedAt)],
        };
      }
    }

    const recordedAt = nowIso(this.#now);
    for (const row of pendingRows) {
      const oldTask = taskFromRow(row);
      const superseded = supersedeReviewTask(oldTask, {
        at: recordedAt,
        commandId: request.commandId,
        actorRef: request.actorId,
      });
      await tx
        .updateTable("business.review_tasks")
        .set({
          status: "superseded",
          superseded_at: superseded.supersededAt ?? recordedAt,
          superseded_by_command_id: superseded.supersededByCommandId ?? request.commandId,
          superseded_by_actor: superseded.supersededByActor ?? request.actorId,
        })
        .where("review_task_id", "=", oldTask.reviewTaskRef.reference.entityId)
        .where("project_id", "=", request.projectId)
        .execute();
    }

    const reviewTaskRef = ReviewTaskRefV1Schema.parse({
      kind: "review-task",
      reference: { entityId: randomId("review-task"), versionId: "1" },
      reviewType: request.payload.reviewType,
      targetRef: request.payload.targetRef,
      waitingRunRef: request.payload.waitingRunRef,
    });
    const task = createPendingReviewTask({
      request,
      reviewTaskRef,
      requestedAt: request.issuedAt,
      recordedAt,
    });
    await tx.insertInto("business.review_tasks").values(taskRow(task)).execute();
    const auditEntryId = randomId("audit");
    return {
      resultRef: taskAsContractReference(task.reviewTaskRef),
      audit: {
        auditEntryId,
        projectId: request.projectId,
        action: "review.request-review",
        targetRef: taskAsContractReference(task.reviewTaskRef),
        actorRef: request.actorId,
        authorizationContextRef: request.authorization.authorizationContextRef,
        occurredAt: request.issuedAt,
        recordedAt,
        version: task.reviewTaskRef.reference,
        commandId: request.commandId,
        idempotencyKey: request.idempotencyKey,
      },
      events: [makeRequestEvent(request, task.reviewTaskRef, auditEntryId, recordedAt)],
    };
  }

  async #decideInTransaction(
    context: TransactionContextV1,
    command: ReviewDecisionCommandV1,
  ): Promise<AtomicCommitV1> {
    const tx = asReviewTransaction(context);
    const taskRef = command.payload.reviewTaskRef;
    const row = await tx
      .selectFrom("business.review_tasks")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("review_task_id", "=", taskRef.reference.entityId)
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined) {
      throw reviewFailure({
        resultCode: "ENTITY_NOT_FOUND",
        reasonCode: "review-task-not-found",
        reviewTaskRef: taskRef,
        targetRef: command.payload.targetRef,
      });
    }
    const task = taskFromRow(row);
    const validation = validateReviewDecision(task, command);
    if (!validation.ok) {
      throw reviewFailure({
        resultCode: validation.resultCode,
        reasonCode: validation.reasonCode,
        reviewTaskRef: task.reviewTaskRef,
        targetRef: command.payload.targetRef,
      });
    }

    const decidedAt = nowIso(this.#now);
    const reviewDecisionRef = {
      kind: "review-decision" as const,
      reference: { entityId: randomId("review-decision"), versionId: "1" },
    };
    await tx
      .insertInto("business.review_decisions")
      .values({
        review_decision_id: reviewDecisionRef.reference.entityId,
        version_id: reviewDecisionRef.reference.versionId,
        review_task_id: task.reviewTaskRef.reference.entityId,
        review_decision_ref: jsonValue(reviewDecisionRef),
        project_id: command.projectId,
        review_type: task.reviewTaskRef.reviewType,
        review_task_ref: jsonValue(task.reviewTaskRef),
        target_ref: jsonValue(command.payload.targetRef),
        decision: jsonValue(command.payload.decision),
        reason_code: command.payload.reasonCode,
        validation_snapshot_ref: jsonValue(task.validationSnapshotRef),
        evidence_snapshot_ref: jsonValue(task.evidenceSnapshotRef),
        waiting_run_ref: jsonValue(task.reviewTaskRef.waitingRunRef),
        review_policy_ref: jsonValue(task.reviewPolicyRef),
        actor_ref: command.actorId,
        authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
        decided_at: decidedAt,
      })
      .execute();
    await tx
      .updateTable("business.review_tasks")
      .set({
        status: "decided",
        decision_ref: jsonValue(reviewDecisionRef),
        decided_at: decidedAt,
      })
      .where("project_id", "=", command.projectId)
      .where("review_task_id", "=", task.reviewTaskRef.reference.entityId)
      .execute();

    const recordedAt = nowIso(this.#now);
    const auditEntryId = randomId("audit");
    return {
      resultRef: reviewDecisionRef,
      audit: {
        auditEntryId,
        projectId: command.projectId,
        action: "review.decide-review",
        targetRef: taskAsContractReference(task.reviewTaskRef),
        actorRef: command.actorId,
        authorizationContextRef: command.authorization.authorizationContextRef,
        occurredAt: command.issuedAt,
        recordedAt,
        version: reviewDecisionRef.reference,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
      },
      events: [
        makeDecisionEvent(command, task.reviewTaskRef, reviewDecisionRef, auditEntryId, recordedAt),
      ],
    };
  }

  async #appendRejection(command: ReviewDecisionCommandV1, failure: ReviewFailure): Promise<void> {
    const recordedAt = nowIso(this.#now);
    const rejection = ReviewRejectionAuditV1Schema.parse({
      rejectionId: randomId("review-rejection"),
      projectId: command.projectId,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      reviewTaskRef: failure.reviewTaskRef,
      targetRef: targetAsContractReference(failure.targetRef),
      waitingRunRef: failure.reviewTaskRef.waitingRunRef,
      actorRef: command.actorId,
      authorizationContextRef: command.authorization.authorizationContextRef,
      resultCode: failure.resultCode,
      reasonCode: failure.reasonCode,
      occurredAt: command.issuedAt,
      recordedAt,
    });
    await this.#db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("audit.review_rejections")
        .values({
          rejection_id: rejection.rejectionId,
          project_id: rejection.projectId,
          command_id: rejection.commandId,
          idempotency_key: rejection.idempotencyKey,
          review_task_ref: jsonValue(rejection.reviewTaskRef),
          target_ref: jsonValue(rejection.targetRef),
          waiting_run_ref: jsonValue(rejection.waitingRunRef),
          actor_ref: rejection.actorRef,
          authorization_context_ref: jsonValue(rejection.authorizationContextRef),
          result_code: rejection.resultCode,
          reason_code: rejection.reasonCode,
          occurred_at: rejection.occurredAt,
          recorded_at: rejection.recordedAt,
        })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    });
  }

  async #databaseNow(): Promise<string> {
    const result = await sql<{ now: Date | string }>`SELECT clock_timestamp() AS now`.execute(
      this.#db,
    );
    const value = result.rows[0]?.now;
    return value === undefined ? nowIso(this.#now) : asIso(value);
  }

  async #lookupPriorCommand(command: AtomicCommandV1): Promise<string> {
    try {
      const row = await this.#db
        .selectFrom("business.command_receipts")
        .select("command_id")
        .where("project_id", "=", command.projectId)
        .where("command_kind", "=", command.commandKind)
        .where("idempotency_key", "=", command.idempotencyKey)
        .executeTakeFirst();
      return row?.command_id ?? "unknown-command";
    } catch {
      return "unknown-command";
    }
  }

  async #mapError(
    error: unknown,
    context: {
      readonly branch: ModuleBranchV1;
      readonly causalRunId: string;
      readonly command?: AtomicCommandV1 | ReviewRequestV1 | ReviewDecisionCommandV1;
    },
  ): Promise<ModuleErrorV1> {
    if (error instanceof AccessServiceError && error.details.code === "ACCESS_TRANSIENT_FAILURE") {
      return moduleError({ code: "TRANSIENT_FAILURE", causalRunId: context.causalRunId });
    }
    if (error instanceof AccessServiceError && error.details.code === "ACCESS_TERMINAL_FAILURE") {
      return moduleError({ code: "TERMINAL_FAILURE", causalRunId: context.causalRunId });
    }
    if (error instanceof AccessServiceError) {
      return moduleError({
        code: "AUTHORIZATION_DENIED",
        branch: context.branch,
        causalRunId: context.causalRunId,
      });
    }
    const mapped = mapPostgresError(error, "review-audit.adapter");
    if (mapped.code === "IDEMPOTENCY_CONFLICT" && context.command !== undefined) {
      const command =
        "commandKind" in context.command
          ? context.command
          : atomicCommand(
              context.command,
              context.branch === "review-audit.request-review"
                ? "review.request-review.v1"
                : "review.decide-review.v1",
              context.command,
            );
      return moduleError({
        code: "IDEMPOTENCY_CONFLICT",
        idempotencyKey: command.idempotencyKey,
        priorCommandId: await this.#lookupPriorCommand(command),
        causalRunId: context.causalRunId,
      });
    }
    if (mapped.retryable || mapped.code === "CONNECTION_FAILED") {
      return moduleError({ code: "TRANSIENT_FAILURE", causalRunId: context.causalRunId });
    }
    return moduleError({ code: "TERMINAL_FAILURE", causalRunId: context.causalRunId });
  }
}

export const createPostgresReviewAuditAdapter = (
  options: PostgresReviewAuditAdapterOptions,
): PostgresReviewAuditAdapter => new PostgresReviewAuditAdapter(options);
