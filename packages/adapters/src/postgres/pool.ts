import pg from "pg";
import { Kysely, PostgresDialect } from "kysely";

import {
  persistenceError,
  type PersistenceErrorCodeV1,
  type PersistenceErrorV1,
} from "@riskflow/core/persistence";

import type { PostgresDatabase } from "./types.js";

export interface PostgresConnectionConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  allowExitOnIdle?: boolean;
  applicationName?: string;
}

export interface PostgresRuntime {
  readonly pool: pg.Pool;
  readonly db: Kysely<PostgresDatabase>;
  close(): Promise<void>;
}

export type PostgresSessionRole = "riskflow_migrator" | "riskflow_checkpointer";

export class PostgresPersistenceError extends Error implements PersistenceErrorV1 {
  readonly code: PersistenceErrorCodeV1;
  readonly retryable: boolean;
  readonly stage: string;
  readonly occurredAt: string;
  readonly diagnosticRef: PersistenceErrorV1["diagnosticRef"];
  readonly contextRefs: PersistenceErrorV1["contextRefs"];

  constructor(details: PersistenceErrorV1) {
    super(details.code);
    this.name = "PostgresPersistenceError";
    this.code = details.code;
    this.retryable = details.retryable;
    this.stage = details.stage;
    this.occurredAt = details.occurredAt;
    this.diagnosticRef = details.diagnosticRef;
    this.contextRefs = details.contextRefs;
  }
}

const diagnosticRef = (code: PersistenceErrorCodeV1): PersistenceErrorV1["diagnosticRef"] => ({
  kind: "diagnostic-artifact",
  reference: { entityId: `persistence-${code.toLowerCase()}`, versionId: "v1" },
});

export const makePersistenceError = (
  code: PersistenceErrorCodeV1,
  stage: string,
  retryable = false,
  contextRefs: PersistenceErrorV1["contextRefs"] = [],
): PostgresPersistenceError =>
  new PostgresPersistenceError(
    persistenceError(code, stage, diagnosticRef(code), contextRefs, retryable),
  );

const isPersistenceError = (error: unknown): error is PostgresPersistenceError =>
  error instanceof PostgresPersistenceError;

export const mapPostgresError = (
  error: unknown,
  stage: string,
  fallbackCode: PersistenceErrorCodeV1 = "TRANSACTION_FAILED",
): PostgresPersistenceError => {
  if (isPersistenceError(error)) return error;
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
  if (
    code === "57P01" ||
    code?.startsWith("08") ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT"
  ) {
    return makePersistenceError("CONNECTION_FAILED", stage, true);
  }
  if (code === "40001" || code === "40P01" || code === "55P03") {
    return makePersistenceError("TRANSACTION_FAILED", stage, true);
  }
  return makePersistenceError(fallbackCode, stage);
};

export const createPostgresPool = (
  config: PostgresConnectionConfig,
  sessionRole?: PostgresSessionRole,
): pg.Pool => {
  if (!config.connectionString && !config.host && !config.database) {
    throw makePersistenceError("CONNECTION_FAILED", "pool.create");
  }
  return new pg.Pool(
    sessionRole === undefined ? config : { ...config, options: `-c role=${sessionRole}` },
  );
};

export const createPostgresRuntime = (
  config: PostgresConnectionConfig,
  sessionRole?: PostgresSessionRole,
): PostgresRuntime => {
  const pool = createPostgresPool(config, sessionRole);
  const db = new Kysely<PostgresDatabase>({ dialect: new PostgresDialect({ pool }) });
  return {
    pool,
    db,
    async close() {
      await db.destroy();
    },
  };
};
