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
  supersedeReviewTask,
  validateReviewDecision,
  ReviewRejectionAuditV1Schema,
  ReviewTaskStateV1Schema,
  reviewTaskIdentityKey,
  type ReviewTaskStateV1,
} from "@riskflow/core/review-audit";
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
  ReviewDecisionCommandV1Schema,
  ReviewDecisionResultV1Schema,
  ReviewDecisionRefV1Schema,
  ReviewRequestResultV1Schema,
  ReviewRequestV1Schema,
  ReviewTaskRefV1Schema,
  TraceQueryV1Schema,
  TraceResultV1Schema,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type ModuleBranchV1,
  type ModuleErrorV1,
  type ReviewAuditPortV1,
  type ReviewDecisionCommandV1,
  type ReviewDecisionRefV1,
  type ReviewDecisionResultV1,
  type ReviewRequestV1,
  type ReviewRequestResultV1,
  type ReviewTaskRefV1,
  type ReviewTargetRefV1,
  type TraceResultV1,
  type TraceQueryV1,
} from "@riskflow/contracts/ports";
import { IdentifierSchema } from "@riskflow/contracts/common";
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

export class PostgresReviewAuditAdapter implements ReviewAuditPortV1 {
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
      await this.#verify(
        valid.authorization,
        valid.projectId,
        valid.queryId,
        "review-audit.trace",
      );
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
      occurredAt: recordedAt,
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
