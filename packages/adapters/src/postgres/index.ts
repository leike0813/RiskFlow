import type { IdempotentConsumerV1, OutboxV1, TransactionUnitV1 } from "@riskflow/core/persistence";

import { bootstrapPostgresFoundation } from "./bootstrap.js";
import {
  createPostgresCheckpointer,
  setupPostgresCheckpointer,
  type PostgresCheckpointer,
  type PostgresCheckpointerConfig,
} from "./checkpointer.js";
import { PostgresIdempotentConsumer } from "./idempotent-consumer.js";
import { runPostgresMigrations, type PostgresMigrationRunConfig } from "./migrations/run.js";
import { PostgresOutbox } from "./outbox.js";
import {
  createPostgresRuntime,
  type PostgresConnectionConfig,
  type PostgresRuntime,
} from "./pool.js";
import { PostgresTransactionUnit } from "./transaction-unit.js";

export type {
  PostgresConnectionConfig,
  PostgresMigrationRunConfig,
  PostgresCheckpointerConfig,
  PostgresRuntime,
};
export {
  bootstrapPostgresFoundation,
  createPostgresCheckpointer,
  runPostgresMigrations,
  setupPostgresCheckpointer,
  createPostgresRuntime,
};
export type { PostgresCheckpointer };
export type {
  ContractReferenceValidator,
  CheckpointReferenceValidationContextV1,
} from "./checkpointer.js";

export interface PostgresTransactionUnitHandle extends TransactionUnitV1 {
  readWorkflowRunBinding: PostgresTransactionUnit["readWorkflowRunBinding"];
  close(): Promise<void>;
}

export interface PostgresOutboxHandle extends OutboxV1 {
  close(): Promise<void>;
}

export interface PostgresIdempotentConsumerHandle extends IdempotentConsumerV1 {
  close(): Promise<void>;
}

const managed = <T extends object>(
  value: T,
  runtime: PostgresRuntime,
): T & { close(): Promise<void> } => Object.assign(value, { close: runtime.close });

export function createPostgresTransactionUnit(
  config: PostgresConnectionConfig,
): PostgresTransactionUnitHandle;
export function createPostgresTransactionUnit(config: PostgresRuntime): PostgresTransactionUnit;
export function createPostgresTransactionUnit(
  config: PostgresConnectionConfig | PostgresRuntime,
): PostgresTransactionUnit | PostgresTransactionUnitHandle {
  if ("db" in config) return new PostgresTransactionUnit(config.db);
  const runtime = createPostgresRuntime(config, "riskflow_app");
  return managed(new PostgresTransactionUnit(runtime.db), runtime);
}

export const createPostgresOutbox = (config: PostgresConnectionConfig): PostgresOutboxHandle => {
  const runtime = createPostgresRuntime(config, "riskflow_outbox_worker");
  return managed(new PostgresOutbox(runtime.db), runtime);
};

export const createPostgresIdempotentConsumer = (
  config: PostgresConnectionConfig,
): PostgresIdempotentConsumerHandle => {
  const runtime = createPostgresRuntime(config);
  return managed(new PostgresIdempotentConsumer(runtime.db), runtime);
};
