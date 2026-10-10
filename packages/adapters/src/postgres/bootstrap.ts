import type { PostgresConnectionConfig } from "./pool.js";
import { createPostgresPool, mapPostgresError } from "./pool.js";

export const POSTGRES_FOUNDATION_SCHEMAS = [
  "business",
  "audit",
  "outbox",
  "langgraph_checkpoint",
] as const;

export const POSTGRES_FOUNDATION_ROLES = [
  "riskflow_migrator",
  "riskflow_app",
  "riskflow_outbox_worker",
  "riskflow_checkpointer",
  // C37 D-19：宿主部署运维主体；只继承运维表权限，不获得业务或迁移能力。
  "riskflow_deployment_operator",
] as const;

const createRole = (role: string) => `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
    CREATE ROLE ${role} NOLOGIN;
  ELSE
    ALTER ROLE ${role} NOLOGIN;
  END IF;
END
$$`;

const bootstrapStatements = [
  ...POSTGRES_FOUNDATION_ROLES.map(createRole),
  "CREATE SCHEMA IF NOT EXISTS business AUTHORIZATION riskflow_migrator",
  "CREATE SCHEMA IF NOT EXISTS audit AUTHORIZATION riskflow_migrator",
  "CREATE SCHEMA IF NOT EXISTS outbox AUTHORIZATION riskflow_migrator",
  "CREATE SCHEMA IF NOT EXISTS langgraph_checkpoint AUTHORIZATION riskflow_checkpointer",
  "ALTER SCHEMA business OWNER TO riskflow_migrator",
  "ALTER SCHEMA audit OWNER TO riskflow_migrator",
  "ALTER SCHEMA outbox OWNER TO riskflow_migrator",
  "ALTER SCHEMA langgraph_checkpoint OWNER TO riskflow_checkpointer",
  ...POSTGRES_FOUNDATION_SCHEMAS.map((schema) => `REVOKE CREATE ON SCHEMA ${schema} FROM PUBLIC`),
  ...POSTGRES_FOUNDATION_SCHEMAS.map((schema) => `REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC`),
  "GRANT USAGE ON SCHEMA business, audit, outbox TO riskflow_app",
  "GRANT USAGE ON SCHEMA business, outbox TO riskflow_outbox_worker",
  "GRANT USAGE ON SCHEMA langgraph_checkpoint TO riskflow_checkpointer",
];

export const bootstrapPostgresFoundation = async (
  config: PostgresConnectionConfig,
): Promise<void> => {
  const pool = createPostgresPool(config);
  try {
    for (const statement of bootstrapStatements) {
      await pool.query(statement);
    }
  } catch (error) {
    throw mapPostgresError(error, "bootstrap");
  } finally {
    await pool.end();
  }
};

export type PostgresBootstrapConfig = PostgresConnectionConfig;
