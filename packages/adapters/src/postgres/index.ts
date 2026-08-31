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

export type { PostgresConnectionConfig, PostgresMigrationRunConfig, PostgresCheckpointerConfig };
export {
  bootstrapPostgresFoundation,
  createPostgresCheckpointer,
  runPostgresMigrations,
  setupPostgresCheckpointer,
};
export type { PostgresCheckpointer };

export interface PostgresTransactionUnitHandle extends TransactionUnitV1 {
  close(): Promise<void>;
}

export interface PostgresOutboxHandle extends OutboxV1 {
  close(): Promise<void>;
}

export interface PostgresIdempotentConsumerHandle extends IdempotentConsumerV1 {
  close(): Promise<void>;
}

export interface PostgresFoundationHandle {
  readonly transactionUnit: TransactionUnitV1;
  readonly outbox: OutboxV1;
  readonly consumer: IdempotentConsumerV1;
  close(): Promise<void>;
}

const managed = <T extends object>(
  value: T,
  runtime: PostgresRuntime,
): T & { close(): Promise<void> } => Object.assign(value, { close: runtime.close });

export const createPostgresFoundation = (
  config: PostgresConnectionConfig,
): PostgresFoundationHandle => {
  const runtime = createPostgresRuntime(config);
  return {
    transactionUnit: new PostgresTransactionUnit(runtime.db),
    outbox: new PostgresOutbox(runtime.db),
    consumer: new PostgresIdempotentConsumer(runtime.db),
    close: runtime.close,
  };
};

export const createPostgresTransactionUnit = (
  config: PostgresConnectionConfig,
): PostgresTransactionUnitHandle => {
  const runtime = createPostgresRuntime(config);
  return managed(new PostgresTransactionUnit(runtime.db), runtime);
};

export const createPostgresOutbox = (config: PostgresConnectionConfig): PostgresOutboxHandle => {
  const runtime = createPostgresRuntime(config);
  return managed(new PostgresOutbox(runtime.db), runtime);
};

export const createPostgresIdempotentConsumer = (
  config: PostgresConnectionConfig,
): PostgresIdempotentConsumerHandle => {
  const runtime = createPostgresRuntime(config);
  return managed(new PostgresIdempotentConsumer(runtime.db), runtime);
};
