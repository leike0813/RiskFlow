import type { Kysely } from "kysely";

import {
  ConsumerHandlerResultV1Schema,
  ConsumerResultV1Schema,
  sha256CanonicalJson,
  type ConsumerResultV1,
  type IdempotentConsumerHandlerV1,
  type IdempotentConsumerV1,
} from "@riskflow/core/persistence";
import { DomainEventV1Schema, type DomainEventV1 } from "@riskflow/contracts/events";
import { IdentifierSchema } from "@riskflow/contracts/common";

import {
  bindPostgresTransaction,
  createPostgresTransactionContext,
  unbindPostgresTransaction,
} from "./transaction-unit.js";
import { makePersistenceError, mapPostgresError } from "./pool.js";
import type { PostgresDatabase } from "./types.js";

const jsonValue = (value: unknown) => value as never;

export class PostgresIdempotentConsumer implements IdempotentConsumerV1 {
  readonly #db: Kysely<PostgresDatabase>;

  constructor(db: Kysely<PostgresDatabase>) {
    this.#db = db;
  }

  async consume(
    consumerName: string,
    event: DomainEventV1,
    handler: IdempotentConsumerHandlerV1,
  ): Promise<ConsumerResultV1> {
    const validConsumerName = IdentifierSchema.safeParse(consumerName);
    const validEvent = DomainEventV1Schema.safeParse(event);
    if (!validConsumerName.success || !validEvent.success) {
      throw makePersistenceError("CONSUMER_CONFLICT", "consumer.input");
    }
    const normalizedEvent = validEvent.data;
    const eventSha256 = sha256CanonicalJson(normalizedEvent);
    const now = new Date().toISOString();

    try {
      await this.#db.transaction().execute(async (transaction) => {
        await transaction
          .insertInto("outbox.consumer_receipts")
          .values({
            consumer_name: validConsumerName.data,
            event_id: normalizedEvent.eventId,
            event_sha256: eventSha256,
            status: "pending",
            result_ref: null,
            attempt_count: 0,
            next_retry_at: null,
            last_error_code: null,
            last_diagnostic_ref: null,
            first_attempt_at: now,
            last_attempt_at: now,
            completed_at: null,
            updated_at: now,
          })
          .onConflict((conflict) => conflict.columns(["consumer_name", "event_id"]).doNothing())
          .execute();
        const row = await transaction
          .selectFrom("outbox.consumer_receipts")
          .select(["event_sha256"])
          .where("consumer_name", "=", validConsumerName.data)
          .where("event_id", "=", normalizedEvent.eventId)
          .executeTakeFirst();
        if (row === undefined || row.event_sha256 !== eventSha256) {
          throw makePersistenceError("IDEMPOTENCY_CONFLICT", "consumer.identity");
        }
      });

      return await this.#db.transaction().execute(async (transaction) => {
        const row = await transaction
          .selectFrom("outbox.consumer_receipts")
          .selectAll()
          .where("consumer_name", "=", validConsumerName.data)
          .where("event_id", "=", normalizedEvent.eventId)
          .forUpdate()
          .executeTakeFirst();
        if (row === undefined || row.event_sha256 !== eventSha256) {
          throw makePersistenceError("IDEMPOTENCY_CONFLICT", "consumer.identity");
        }
        if (row.status === "completed") {
          if (row.result_ref === null)
            throw makePersistenceError("TRANSACTION_FAILED", "consumer.receipt");
          return ConsumerResultV1Schema.parse({
            resultRef: row.result_ref,
            replayed: true,
          });
        }

        const context = createPostgresTransactionContext();
        bindPostgresTransaction(context, transaction);
        try {
          const handlerResult = ConsumerHandlerResultV1Schema.safeParse(
            await handler(context, normalizedEvent),
          );
          if (!handlerResult.success) {
            throw makePersistenceError("TRANSACTION_FAILED", "consumer.handler", true);
          }
          const attemptCount = row.attempt_count + 1;
          await transaction
            .updateTable("outbox.consumer_receipts")
            .set({
              status: "completed",
              result_ref: jsonValue(handlerResult.data.resultRef),
              attempt_count: attemptCount,
              next_retry_at: null,
              last_attempt_at: now,
              completed_at: now,
              updated_at: now,
            })
            .where("consumer_name", "=", validConsumerName.data)
            .where("event_id", "=", normalizedEvent.eventId)
            .execute();
          return ConsumerResultV1Schema.parse({
            resultRef: handlerResult.data.resultRef,
            replayed: false,
          });
        } finally {
          unbindPostgresTransaction(context);
        }
      });
    } catch (error) {
      const mapped = mapPostgresError(error, "consumer.consume");
      if (mapped.code === "CONSUMER_CONFLICT") throw mapped;
      if (mapped.code === "IDEMPOTENCY_CONFLICT") throw mapped;
      try {
        await this.#db.transaction().execute(async (transaction) => {
          await transaction
            .updateTable("outbox.consumer_receipts")
            .set({
              attempt_count: (eb) => eb("attempt_count", "+", 1),
              last_error_code: mapped.code,
              last_diagnostic_ref: jsonValue(mapped.diagnosticRef),
              last_attempt_at: now,
              next_retry_at: now,
              updated_at: now,
            })
            .where("consumer_name", "=", validConsumerName.data)
            .where("event_id", "=", normalizedEvent.eventId)
            .where("status", "=", "pending")
            .execute();
        });
      } catch (failureError) {
        throw mapPostgresError(failureError, "consumer.failure");
      }
      throw mapped;
    }
  }
}
