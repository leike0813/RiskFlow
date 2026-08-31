import { sql, type Kysely, type Transaction } from "kysely";

import {
  AtomicCommitV1Schema,
  AtomicCommandV1Schema,
  sha256CanonicalJson,
  type AtomicCommitReceiptV1,
  type AtomicCommandV1,
  type TransactionContextV1,
  type TransactionHandlerV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import { makePersistenceError, mapPostgresError } from "./pool.js";
import type { PostgresDatabase } from "./types.js";

const transactionHandles = new WeakMap<TransactionContextV1, Transaction<PostgresDatabase>>();

export const createPostgresTransactionContext = (): TransactionContextV1 =>
  ({}) as TransactionContextV1;

/** @internal Used by domain adapters in this package, never exported from the package barrel. */
export const getPostgresTransaction = (
  context: TransactionContextV1,
): Transaction<PostgresDatabase> => {
  const transaction = transactionHandles.get(context);
  if (transaction === undefined)
    throw makePersistenceError("TRANSACTION_FAILED", "transaction.context");
  return transaction;
};

/** @internal Used by the consumer adapter while it owns the transaction scope. */
export const bindPostgresTransaction = (
  context: TransactionContextV1,
  transaction: Transaction<PostgresDatabase>,
): void => {
  transactionHandles.set(context, transaction);
};

/** @internal */
export const unbindPostgresTransaction = (context: TransactionContextV1): void => {
  transactionHandles.delete(context);
};

const jsonValue = (value: unknown) => value as never;

const identityConflict = () =>
  makePersistenceError("IDEMPOTENCY_CONFLICT", "transaction.idempotency");

const eventContractError = () =>
  makePersistenceError("EVENT_CONTRACT_INVALID", "transaction.event");

const assertCommitBelongsToCommand = (
  command: AtomicCommandV1,
  commit: ReturnType<typeof AtomicCommitV1Schema.parse>,
) => {
  const audit = commit.audit;
  if (
    audit.projectId !== command.projectId ||
    audit.actorRef !== command.actorRef ||
    audit.authorizationContextRef.reference.entityId !==
      command.authorizationContextRef.reference.entityId ||
    audit.authorizationContextRef.reference.versionId !==
      command.authorizationContextRef.reference.versionId ||
    (audit.commandId !== undefined && audit.commandId !== command.commandId) ||
    (audit.idempotencyKey !== undefined && audit.idempotencyKey !== command.idempotencyKey)
  ) {
    throw eventContractError();
  }

  for (const event of commit.events) {
    if (
      event.projectId !== command.projectId ||
      event.producerCommandId !== command.commandId ||
      event.idempotencyKey !== command.idempotencyKey ||
      event.authorizationContextRef.reference.entityId !==
        command.authorizationContextRef.reference.entityId ||
      event.authorizationContextRef.reference.versionId !==
        command.authorizationContextRef.reference.versionId ||
      event.auditTrailRef.reference.entityId !== audit.auditEntryId ||
      event.auditTrailRef.reference.versionId !== audit.version.versionId
    ) {
      throw eventContractError();
    }
  }
};

const receiptFromRow = (row: {
  result_ref: unknown;
  audit_entry_id: string | null;
  event_ids: string[];
}): AtomicCommitReceiptV1 => {
  if (row.result_ref === null || row.audit_entry_id === null) {
    throw makePersistenceError("TRANSACTION_FAILED", "transaction.receipt");
  }
  return {
    resultRef: row.result_ref as AtomicCommitReceiptV1["resultRef"],
    auditEntryId: row.audit_entry_id,
    eventRefs: row.event_ids.map((eventId) => ({ kind: "domain-event", eventId, eventVersion: 1 })),
    replayed: true,
  };
};

export class PostgresTransactionUnit implements TransactionUnitV1 {
  readonly #db: Kysely<PostgresDatabase>;

  constructor(db: Kysely<PostgresDatabase>) {
    this.#db = db;
  }

  async execute(
    command: AtomicCommandV1,
    handler: TransactionHandlerV1,
  ): Promise<AtomicCommitReceiptV1> {
    const parsedCommand = AtomicCommandV1Schema.safeParse(command);
    if (!parsedCommand.success)
      throw makePersistenceError("TRANSACTION_FAILED", "transaction.command");
    const validCommand = parsedCommand.data;
    const payloadSha256 = sha256CanonicalJson(validCommand.payload);

    try {
      return await this.#db.transaction().execute(async (transaction) => {
        await transaction
          .insertInto("business.command_receipts")
          .values({
            project_id: validCommand.projectId,
            command_kind: validCommand.commandKind,
            idempotency_key: validCommand.idempotencyKey,
            command_id: validCommand.commandId,
            payload_sha256: payloadSha256,
            result_ref: null,
            audit_entry_id: null,
            event_ids: [],
            actor_ref: validCommand.actorRef,
            authorization_context_ref: jsonValue(validCommand.authorizationContextRef),
            run_id: validCommand.runId ?? null,
            thread_id: validCommand.threadId ?? null,
            completed_at: null,
            created_at: sql`clock_timestamp()`,
          })
          .onConflict((conflict) =>
            conflict.columns(["project_id", "command_kind", "idempotency_key"]).doNothing(),
          )
          .execute();

        const row = await transaction
          .selectFrom("business.command_receipts")
          .selectAll()
          .where("project_id", "=", validCommand.projectId)
          .where("command_kind", "=", validCommand.commandKind)
          .where("idempotency_key", "=", validCommand.idempotencyKey)
          .forUpdate()
          .executeTakeFirst();
        if (row === undefined) throw identityConflict();
        if (row.payload_sha256 !== payloadSha256) throw identityConflict();
        if (row.completed_at !== null) return receiptFromRow(row);

        const context = createPostgresTransactionContext();
        bindPostgresTransaction(context, transaction);
        try {
          const commitResult = await handler(context);
          const commit = AtomicCommitV1Schema.safeParse(commitResult);
          if (!commit.success) throw eventContractError();
          assertCommitBelongsToCommand(validCommand, commit.data);

          const audit = commit.data.audit;
          await transaction
            .insertInto("audit.entries")
            .values({
              audit_entry_id: audit.auditEntryId,
              project_id: audit.projectId,
              action: audit.action,
              target_ref: jsonValue(audit.targetRef),
              actor_ref: audit.actorRef,
              authorization_context_ref: jsonValue(audit.authorizationContextRef),
              version_ref: jsonValue(audit.version),
              occurred_at: audit.occurredAt,
              recorded_at: audit.recordedAt,
              persisted_at: sql`clock_timestamp()`,
              command_id: validCommand.commandId,
              idempotency_key: validCommand.idempotencyKey,
              run_id: validCommand.runId ?? audit.runId ?? null,
              thread_id: validCommand.threadId ?? audit.threadId ?? null,
              reason_ref: audit.reasonRef === undefined ? null : jsonValue(audit.reasonRef),
            })
            .execute();

          if (commit.data.events.length > 0) {
            await transaction
              .insertInto("outbox.events")
              .values(
                commit.data.events.map((event) => ({
                  event_id: event.eventId,
                  event_type: event.eventType,
                  schema_version: event.schemaVersion,
                  event_version: event.eventVersion,
                  project_id: event.projectId,
                  aggregate_ref: jsonValue(event.aggregateRef),
                  occurred_at: event.occurredAt,
                  recorded_at: event.recordedAt,
                  persisted_at: sql`clock_timestamp()`,
                  causation_id: event.causationId,
                  correlation_id: event.correlationId,
                  producer_command_id: event.producerCommandId,
                  idempotency_key: event.idempotencyKey,
                  authorization_context_ref: jsonValue(event.authorizationContextRef),
                  audit_trail_ref: jsonValue(event.auditTrailRef),
                  event_json: jsonValue(event),
                  payload_sha256: sha256CanonicalJson(event),
                  status: "pending" as const,
                  lease_owner: null,
                  lease_token: null,
                  lease_until: null,
                  attempt_count: 0,
                  next_attempt_at: sql`clock_timestamp()`,
                  published_at: null,
                  last_error_code: null,
                  last_diagnostic_ref: null,
                  updated_at: sql`clock_timestamp()`,
                })),
              )
              .execute();
          }

          const eventIds = commit.data.events.map((event) => event.eventId);
          await transaction
            .updateTable("business.command_receipts")
            .set({
              result_ref: jsonValue(commit.data.resultRef),
              audit_entry_id: audit.auditEntryId,
              event_ids: eventIds,
              completed_at: sql`clock_timestamp()`,
            })
            .where("project_id", "=", validCommand.projectId)
            .where("command_kind", "=", validCommand.commandKind)
            .where("idempotency_key", "=", validCommand.idempotencyKey)
            .execute();

          return {
            resultRef: commit.data.resultRef,
            auditEntryId: audit.auditEntryId,
            eventRefs: eventIds.map((eventId) => ({
              kind: "domain-event" as const,
              eventId,
              eventVersion: 1 as const,
            })),
            replayed: false,
          };
        } finally {
          unbindPostgresTransaction(context);
        }
      });
    } catch (error) {
      throw mapPostgresError(error, "transaction.execute");
    }
  }
}
