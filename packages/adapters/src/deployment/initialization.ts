import { sql, type Kysely } from "kysely";

import { bootstrapInitialSystemAdministrator } from "../auth/postgres-local-identity-access.js";
import { bootstrapPostgresFoundation } from "../postgres/bootstrap.js";
import type { PostgresConnectionConfig } from "../postgres/pool.js";
import { createPostgresRuntime } from "../postgres/pool.js";
import { runPostgresMigrations } from "../postgres/migrations/run.js";

import type { DeploymentConfigV1 } from "./schema.js";

/**
 * C37 D-05：初始化与运行连接分开。
 *
 * 初始化是显式部署动作：权限组 → 职责化 LOGIN → C03 迁移 → checkpointer schema
 * → C06 首次管理员引导。运行进程只检查兼容迁移版本，不做 DDL，也不持迁移凭据。
 * 重放保留已有事实：账号库非空时不重新引导管理员，不重置凭据或历史审计。
 */

export const DEPLOYMENT_INITIALIZATION_ERROR_V1 = {
  migrationFailed: "DEPLOYMENT_INITIALIZATION_MIGRATION_FAILED",
  compatibleCheckFailed: "DEPLOYMENT_INITIALIZATION_COMPATIBILITY_FAILED",
  loginRoleFailed: "DEPLOYMENT_INITIALIZATION_LOGIN_ROLE_FAILED",
} as const;
export type DeploymentInitializationErrorCodeV1 =
  (typeof DEPLOYMENT_INITIALIZATION_ERROR_V1)[keyof typeof DEPLOYMENT_INITIALIZATION_ERROR_V1];

export interface DeploymentInitializationErrorV1 {
  readonly code: DeploymentInitializationErrorCodeV1;
  readonly safeReason: string;
}

export interface DeploymentInitializationInputV1 {
  readonly config: DeploymentConfigV1;
  /** 仅迁移期使用的高权限连接；运行连接不得复用。 */
  readonly migrationConnection: PostgresConnectionConfig;
  readonly migrationRoot: string;
  readonly finalMigrationVersion: string;
  readonly initialAdministrator?: {
    readonly loginName: string;
    readonly displayName: string;
    /** 只经独立秘密文件提供，不接受命令行参数。 */
    readonly password: string;
  };
  readonly now?: () => Date;
}

export interface DeploymentInitializationResultV1 {
  readonly appliedMigrations: readonly string[];
  readonly finalMigrationVersion: string;
  readonly createdLoginRoles: readonly string[];
  readonly initialAdministratorCreated: boolean;
  readonly currentMigrationVersion: string;
}

const LOGIN_ROLE_KEYS_V1 = [
  "migratorRoleName",
  "appRoleName",
  "workerRoleName",
  "checkpointerRoleName",
  "deploymentOperatorRoleName",
] as const;
type DeploymentLoginRoleKeyV1 = (typeof LOGIN_ROLE_KEYS_V1)[number];

/** 职责化 LOGIN 只继承对应 NOLOGIN 组；运行主体不持迁移或宿主控制权限。 */
const LOGIN_ROLE_GROUP_MEMBERSHIP_V1: Readonly<
  Record<DeploymentLoginRoleKeyV1, readonly string[]>
> = Object.freeze({
  migratorRoleName: Object.freeze(["riskflow_migrator"]),
  appRoleName: Object.freeze(["riskflow_app"]),
  workerRoleName: Object.freeze(["riskflow_app", "riskflow_outbox_worker"]),
  checkpointerRoleName: Object.freeze(["riskflow_checkpointer"]),
  deploymentOperatorRoleName: Object.freeze(["riskflow_deployment_operator"]),
});

const loginRoleName = (config: DeploymentConfigV1, key: DeploymentLoginRoleKeyV1): string =>
  config.database[key];

/**
 * 迁移版本必须达到清单声明的最终版本；低版本不允许启动业务。
 * 迁移记录名形如 `000056_platform_<change>_<subject>`，比较用其序号前缀。
 */
const migrationSequenceOf = (migrationName: string): string => migrationName.slice(0, 6);

export const assertCompatibleMigrationVersion = async (
  db: Kysely<unknown>,
  finalMigrationVersion: string,
): Promise<string> => {
  const result = await sql<{ name: string }>`SELECT name FROM business._riskflow_migration
    ORDER BY name DESC LIMIT 1`.execute(db);
  const currentName = result.rows[0]?.name;
  if (currentName === undefined) {
    throw {
      code: DEPLOYMENT_INITIALIZATION_ERROR_V1.compatibleCheckFailed,
      safeReason: "the migration ledger is empty",
    } satisfies DeploymentInitializationErrorV1;
  }
  const current = migrationSequenceOf(currentName);
  if (current < finalMigrationVersion) {
    throw {
      code: DEPLOYMENT_INITIALIZATION_ERROR_V1.compatibleCheckFailed,
      safeReason: `current migration ${current} is older than the required ${finalMigrationVersion}`,
    } satisfies DeploymentInitializationErrorV1;
  }
  return current;
};

export const initializeDeploymentV1 = async (
  input: DeploymentInitializationInputV1,
): Promise<DeploymentInitializationResultV1> => {
  await bootstrapPostgresFoundation(input.migrationConnection);

  // 集群级 LOGIN 创建需要 CREATEROLE；这里用管理连接自身身份，不切换到迁移组角色。
  const operatorRuntime = createPostgresRuntime(input.migrationConnection);
  const createdLoginRoles: string[] = [];
  try {
    for (const key of LOGIN_ROLE_KEYS_V1) {
      const role = loginRoleName(input.config, key);
      // 职责化 LOGIN 只继承对应 NOLOGIN 组；运行主体不持迁移或宿主控制权限。
      // 角色名已由 DeploymentConfigV1 的标识符正则约束；DO 块不接受绑定参数。
      await sql
        .raw(
          `DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          CREATE ROLE ${role} LOGIN;
        ELSE
          ALTER ROLE ${role} LOGIN;
        END IF;
      END
      $$`,
        )
        .execute(operatorRuntime.db);
      for (const group of LOGIN_ROLE_GROUP_MEMBERSHIP_V1[key]) {
        // 角色名来自受控部署配置，不是自由文本；GRANT 只接受标识符。
        await sql`GRANT ${sql.raw(group)} TO ${sql.raw(role)}`.execute(operatorRuntime.db);
      }
      createdLoginRoles.push(role);
    }
  } catch {
    throw {
      code: DEPLOYMENT_INITIALIZATION_ERROR_V1.loginRoleFailed,
      safeReason: "could not create the deployment login roles",
    } satisfies DeploymentInitializationErrorV1;
  } finally {
    await operatorRuntime.close();
  }

  let appliedMigrations: readonly string[];
  try {
    appliedMigrations = (
      await runPostgresMigrations({
        ...input.migrationConnection,
        migrationRoot: input.migrationRoot,
      })
    ).applied;
  } catch {
    throw {
      code: DEPLOYMENT_INITIALIZATION_ERROR_V1.migrationFailed,
      safeReason: "the platform migrations did not complete",
    } satisfies DeploymentInitializationErrorV1;
  }

  const verifyRuntime = createPostgresRuntime(input.migrationConnection, "riskflow_migrator");
  let currentMigrationVersion: string;
  try {
    currentMigrationVersion = await assertCompatibleMigrationVersion(
      verifyRuntime.db as unknown as Kysely<unknown>,
      input.finalMigrationVersion,
    );
  } finally {
    await verifyRuntime.close();
  }

  // 首次管理员只在账号库为空时创建；重放保留已有账号与密码。
  let initialAdministratorCreated = false;
  if (input.initialAdministrator !== undefined) {
    try {
      await bootstrapInitialSystemAdministrator({
        connection: input.migrationConnection,
        loginName: input.initialAdministrator.loginName,
        displayName: input.initialAdministrator.displayName,
        password: input.initialAdministrator.password,
        ...(input.now !== undefined ? { now: input.now } : {}),
      });
      initialAdministratorCreated = true;
    } catch (error) {
      // 账号库非空时 C06 拒绝再次引导，这属于重放而非失败。
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ACCESS_TERMINAL_FAILURE"
      ) {
        initialAdministratorCreated = false;
      } else {
        throw error;
      }
    }
  }

  return {
    appliedMigrations,
    finalMigrationVersion: input.finalMigrationVersion,
    createdLoginRoles,
    initialAdministratorCreated,
    currentMigrationVersion,
  };
};
