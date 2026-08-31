import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";

import {
  OutboxAcknowledgeV1Schema,
  OutboxClaimBatchRequestV1Schema,
  OutboxClaimBatchResultV1Schema,
  OutboxDeliveryPolicyV1Schema,
  OutboxFailureV1Schema,
  OutboxOperationResultV1Schema,
  outboxBackoffDelayMs,
  sha256CanonicalJson,
  type OutboxAcknowledgeV1,
  type OutboxClaimBatchRequestV1,
  type OutboxClaimBatchResultV1,
  type OutboxFailureV1,
  type OutboxOperationResultV1,
  type OutboxDeliveryPolicyV1,
  type OutboxV1,
} from "@riskflow/core/persistence";
import { DomainEventV1Schema } from "@riskflow/contracts/events";
import { VersionReferenceSchema } from "@riskflow/contracts/common";

import { makePersistenceError, mapPostgresError } from "./pool.js";
import type { PostgresDatabase } from "./types.js";

const asDate = (value: unknown): Date => {
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  throw makePersistenceError("TRANSACTION_FAILED", "outbox.time");
};
const asIso = (value: unknown): string => asDate(value).toISOString();

const isLeaseLost = () => makePersistenceError("OUTBOX_LEASE_LOST", "outbox.lease", true);
const policyConflict = () => makePersistenceError("TRANSACTION_FAILED", "outbox.policy");
const jsonValue = (value: unknown) => value as never;

const parseFrozenPolicy = (value: unknown): OutboxDeliveryPolicyV1 => {
  const parsed = OutboxDeliveryPolicyV1Schema.safeParse(value);
  if (!parsed.success) throw policyConflict();
  return parsed.data;
};

const rowToClaimedEvent = (row: {
  event_id: string;
  event_json: unknown;
  lease_owner: string | null;
  lease_token: string | null;
  lease_until: unknown;
  attempt_count: number;
  payload_sha256: string;
  delivery_policy_ref: unknown;
}): OutboxClaimBatchResultV1["events"][number] => {
  const event = DomainEventV1Schema.safeParse(row.event_json);
  const policyRef = VersionReferenceSchema.safeParse(row.delivery_policy_ref);
  if (
    !event.success ||
    !policyRef.success ||
    row.lease_owner === null ||
    row.lease_token === null ||
    row.lease_until === null
  ) {
    throw makePersistenceError("EVENT_CONTRACT_INVALID", "outbox.event");
  }
  return {
    eventId: row.event_id,
    event: event.data,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseUntil: asIso(row.lease_until),
    attemptCount: row.attempt_count,
    policyRef: policyRef.data,
    payloadSha256: row.payload_sha256,
  };
};

export class PostgresOutbox implements OutboxV1 {
  readonly #db: Kysely<PostgresDatabase>;

  constructor(db: Kysely<PostgresDatabase>) {
    this.#db = db;
  }

  async claimBatch(request: OutboxClaimBatchRequestV1): Promise<OutboxClaimBatchResultV1> {
    const parsed = OutboxClaimBatchRequestV1Schema.safeParse(request);
    if (!parsed.success) throw makePersistenceError("TRANSACTION_FAILED", "outbox.claim");
    const valid = parsed.data;
    const now = valid.now ?? new Date().toISOString();
    const nowDate = asDate(now);
    const policySha256 = sha256CanonicalJson(valid.policy);

    try {
      return await this.#db.transaction().execute(async (transaction) => {
        const rows = await transaction
          .selectFrom("outbox.events")
          .selectAll()
          .where((expression) =>
            expression.or([
              expression.and([
                expression("status", "=", "pending"),
                expression("next_attempt_at", "<=", nowDate),
              ]),
              expression.and([
                expression("status", "=", "leased"),
                expression("lease_until", "<=", nowDate),
                expression("next_attempt_at", "<=", nowDate),
              ]),
            ]),
          )
          .orderBy("next_attempt_at", "asc")
          .orderBy("persisted_at", "asc")
          .orderBy("event_id", "asc")
          .limit(valid.policy.batchSize)
          .forUpdate()
          .skipLocked()
          .execute();

        const leaseUntil = new Date(nowDate.getTime() + valid.policy.leaseDurationMs);
        const claimed = [] as OutboxClaimBatchResultV1["events"];
        for (const row of rows) {
          const frozenPolicy =
            row.delivery_policy_snapshot === null
              ? valid.policy
              : parseFrozenPolicy(row.delivery_policy_snapshot);
          const frozenSha256 = row.delivery_policy_sha256 ?? policySha256;
          if (frozenSha256 !== policySha256) throw policyConflict();
          if (row.attempt_count >= frozenPolicy.maxAttempts) {
            await transaction
              .updateTable("outbox.events")
              .set({
                status: "exhausted",
                lease_owner: null,
                lease_token: null,
                lease_until: null,
                next_attempt_at: null,
                updated_at: nowDate,
              })
              .where("event_id", "=", row.event_id)
              .execute();
            continue;
          }
          const updated = await transaction
            .updateTable("outbox.events")
            .set({
              status: "leased",
              lease_owner: valid.leaseOwner,
              lease_token: randomUUID(),
              lease_until: leaseUntil,
              attempt_count: row.attempt_count + 1,
              delivery_policy_ref: jsonValue(frozenPolicy.policyRef),
              delivery_policy_snapshot: jsonValue(frozenPolicy),
              delivery_policy_sha256: frozenSha256,
              updated_at: nowDate,
            })
            .where("event_id", "=", row.event_id)
            .returningAll()
            .executeTakeFirstOrThrow();
          claimed.push(rowToClaimedEvent(updated));
        }
        return OutboxClaimBatchResultV1Schema.parse({ events: claimed });
      });
    } catch (error) {
      throw mapPostgresError(error, "outbox.claim");
    }
  }

  async acknowledge(request: OutboxAcknowledgeV1): Promise<OutboxOperationResultV1> {
    const parsed = OutboxAcknowledgeV1Schema.safeParse(request);
    if (!parsed.success) throw makePersistenceError("TRANSACTION_FAILED", "outbox.acknowledge");
    const valid = parsed.data;
    const now = valid.now ?? new Date().toISOString();
    const nowDate = asDate(now);

    try {
      return await this.#db.transaction().execute(async (transaction) => {
        const updated = await transaction
          .updateTable("outbox.events")
          .set({
            status: "published",
            lease_owner: null,
            lease_token: null,
            lease_until: null,
            published_at: nowDate,
            updated_at: nowDate,
          })
          .where("event_id", "=", valid.eventId)
          .where("status", "=", "leased")
          .where("lease_owner", "=", valid.leaseOwner)
          .where("lease_token", "=", valid.leaseToken)
          .where("lease_until", ">", nowDate)
          .returning(["status", "attempt_count", "next_attempt_at"])
          .executeTakeFirst();
        if (updated === undefined) throw isLeaseLost();
        return OutboxOperationResultV1Schema.parse({
          eventId: valid.eventId,
          status: updated.status,
          attemptCount: updated.attempt_count,
          ...(updated.next_attempt_at === null
            ? {}
            : { nextAttemptAt: asIso(updated.next_attempt_at) }),
        });
      });
    } catch (error) {
      throw mapPostgresError(error, "outbox.acknowledge");
    }
  }

  async recordFailure(request: OutboxFailureV1): Promise<OutboxOperationResultV1> {
    const parsed = OutboxFailureV1Schema.safeParse(request);
    if (!parsed.success) throw makePersistenceError("TRANSACTION_FAILED", "outbox.failure");
    const valid = parsed.data;
    const now = valid.now ?? new Date().toISOString();
    const nowDate = asDate(now);

    try {
      return await this.#db.transaction().execute(async (transaction) => {
        const current = await transaction
          .selectFrom("outbox.events")
          .select(["attempt_count", "delivery_policy_snapshot", "delivery_policy_sha256"])
          .where("event_id", "=", valid.eventId)
          .where("status", "=", "leased")
          .where("lease_owner", "=", valid.leaseOwner)
          .where("lease_token", "=", valid.leaseToken)
          .where("lease_until", ">", nowDate)
          .forUpdate()
          .executeTakeFirst();
        if (current === undefined) throw isLeaseLost();

        const frozenPolicy = parseFrozenPolicy(current.delivery_policy_snapshot);
        if (current.delivery_policy_sha256 !== sha256CanonicalJson(valid.policy)) {
          throw policyConflict();
        }

        const exhausted = current.attempt_count >= frozenPolicy.maxAttempts;
        const nextAttemptAt = new Date(
          nowDate.getTime() + outboxBackoffDelayMs(frozenPolicy, current.attempt_count),
        );
        const updated = await transaction
          .updateTable("outbox.events")
          .set({
            status: exhausted ? "exhausted" : "pending",
            lease_owner: null,
            lease_token: null,
            lease_until: null,
            next_attempt_at: exhausted ? null : nextAttemptAt,
            last_error_code: valid.errorCode,
            last_diagnostic_ref: valid.diagnosticRef,
            updated_at: nowDate,
          })
          .where("event_id", "=", valid.eventId)
          .where("status", "=", "leased")
          .where("lease_owner", "=", valid.leaseOwner)
          .where("lease_token", "=", valid.leaseToken)
          .where("lease_until", ">", nowDate)
          .returning(["status", "attempt_count", "next_attempt_at"])
          .executeTakeFirst();
        if (updated === undefined) throw isLeaseLost();
        return OutboxOperationResultV1Schema.parse({
          eventId: valid.eventId,
          status: updated.status,
          attemptCount: updated.attempt_count,
          ...(updated.next_attempt_at === null
            ? {}
            : { nextAttemptAt: asIso(updated.next_attempt_at) }),
        });
      });
    } catch (error) {
      throw mapPostgresError(error, "outbox.failure");
    }
  }
}
