import type { JsonValue } from "@riskflow/core/persistence";
import type { ColumnType } from "kysely";

type JsonColumn = ColumnType<JsonValue, JsonValue, JsonValue>;
type TimestampColumn = ColumnType<Date, Date | string, Date | string>;

export interface CommandReceiptRow {
  project_id: string;
  command_kind: string;
  idempotency_key: string;
  command_id: string;
  payload_sha256: string;
  result_ref: JsonColumn | null;
  audit_entry_id: string | null;
  event_ids: string[];
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  run_id: string | null;
  thread_id: string | null;
  completed_at: TimestampColumn | null;
  created_at: TimestampColumn;
}

export interface AuditEntryRow {
  audit_entry_id: string;
  project_id: string;
  action: string;
  target_ref: JsonColumn;
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  version_ref: JsonColumn;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
  command_id: string;
  idempotency_key: string;
  run_id: string | null;
  thread_id: string | null;
  reason_ref: JsonColumn | null;
}

export interface OutboxEventRow {
  event_id: string;
  event_type: string;
  schema_version: string;
  event_version: number;
  project_id: string;
  aggregate_ref: JsonColumn;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
  causation_id: string;
  correlation_id: string;
  producer_command_id: string;
  idempotency_key: string;
  authorization_context_ref: JsonColumn;
  audit_trail_ref: JsonColumn;
  event_json: JsonColumn;
  payload_sha256: string;
  status: "pending" | "leased" | "published" | "exhausted";
  lease_owner: string | null;
  lease_token: string | null;
  lease_until: TimestampColumn | null;
  attempt_count: number;
  next_attempt_at: TimestampColumn | null;
  published_at: TimestampColumn | null;
  last_error_code: string | null;
  last_diagnostic_ref: JsonColumn | null;
  updated_at: TimestampColumn;
}

export interface ConsumerReceiptRow {
  consumer_name: string;
  event_id: string;
  event_sha256: string;
  status: "pending" | "completed";
  result_ref: JsonColumn | null;
  attempt_count: number;
  next_retry_at: TimestampColumn | null;
  last_error_code: string | null;
  last_diagnostic_ref: JsonColumn | null;
  first_attempt_at: TimestampColumn;
  last_attempt_at: TimestampColumn;
  completed_at: TimestampColumn | null;
  updated_at: TimestampColumn;
}

export interface PostgresDatabase {
  "business.command_receipts": CommandReceiptRow;
  "audit.entries": AuditEntryRow;
  "outbox.events": OutboxEventRow;
  "outbox.consumer_receipts": ConsumerReceiptRow;
}
