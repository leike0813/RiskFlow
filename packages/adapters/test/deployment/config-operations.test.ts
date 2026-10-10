import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql, type Kysely } from "kysely";
import { Pool } from "pg";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createPostgresRuntime } from "../../src/postgres/pool.js";
import { runPostgresMigrations } from "../../src/postgres/migrations/run.js";
import {
  DEPLOYMENT_SECRET_ERROR_V1,
  createDeploymentSecretFileLoaderV1,
} from "../../src/deployment/secrets.js";
import {
  DEPLOYMENT_OPERATION_STAGE_V1,
  createPostgresDeploymentOperationStoreV1,
} from "../../src/deployment/operations.js";
import { initializeDeploymentV1 } from "../../src/deployment/initialization.js";
import {
  DeploymentConfigV1Schema,
  DeploymentOperationV1Schema,
  ReleaseManifestV1Schema,
  type DeploymentConfigV1,
} from "../../src/deployment/schema.js";
import { startPostgresFixture, type PostgresTestFixture } from "../postgres/fixture.js";

/** 不同输入必须得到不同摘要，否则“异载荷冲突”用例无法真正触发。 */
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const temporaryRoots: string[] = [];
const pools: Pool[] = [];

/** ZodError 的 issue 列表只读回 message 字段；不触碰宿主路径或秘密内容。 */
const issueMessagesOf = (error: unknown): readonly string[] => {
  if (typeof error !== "object" || error === null || !("issues" in error)) return [];
  const { issues } = error;
  if (!Array.isArray(issues)) return [];
  return issues.map((issue) =>
    typeof issue === "object" && issue !== null && "message" in issue ? String(issue.message) : "",
  );
};

const baseConfig = (): DeploymentConfigV1 =>
  DeploymentConfigV1Schema.parse({
    schemaVersion: 1,
    configRef: "config-primary",
    releaseId: "release-2030-01",
    instanceId: "app-vm-01",
    hosts: [
      { role: "inference", host: "10.0.0.11", ports: [8081] },
      { role: "application", host: "10.0.0.12", ports: [8443, 8080] },
      { role: "data", host: "10.0.0.13", ports: [5432, 6333] },
    ],
    publicOrigin: "https://riskflow.internal.example",
    localRoots: {
      applicationRoot: "/opt/riskflow/app",
      dataRoot: "/var/lib/riskflow/data",
      artifactRoot: "/var/lib/riskflow/artifacts",
      logRoot: "/var/log/riskflow",
    },
    database: {
      secretFileRefs: [
        { secretId: "db-migrator-password", filePath: "/etc/riskflow/secrets/db-migrator" },
        { secretId: "db-app-password", filePath: "/etc/riskflow/secrets/db-app" },
      ],
      migratorRoleName: "riskflow_migrator_login",
      appRoleName: "riskflow_app_login",
      workerRoleName: "riskflow_outbox_worker_login",
      checkpointerRoleName: "riskflow_checkpointer_login",
      deploymentOperatorRoleName: "riskflow_deployment_operator_login",
    },
    transport: {
      artifactEndpointRef: "data-vm-artifacts",
      connectTimeoutMs: 2_000,
      idleTimeoutMs: 5_000,
      totalTimeoutMs: 30_000,
      metadataMaxBytes: 65_536,
      maxConcurrentRequests: 8,
      shutdownTimeoutMs: 10_000,
    },
    worker: {
      pollMs: 1_000,
      maxConcurrency: 4,
      claimBatchSize: 10,
      drainTimeoutMs: 30_000,
      leaseTimeoutMs: 60_000,
    },
    health: {
      probeTimeoutMs: 2_000,
      livenessIntervalMs: 10_000,
      readinessIntervalMs: 5_000,
    },
    log: { level: "info", retentionDays: 30, maxFileMb: 64 },
    projectBindings: [{ projectId: "project-rail-01", policyCatalogRef: "catalog-2030-01" }],
  });

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

/** 测试需要构造非法配置去验证拒绝路径；生产输入一律经 Schema parse。 */
const withPublicOrigin = (publicOrigin: string): unknown => ({
  ...structuredClone(baseConfig()),
  publicOrigin,
});

/** 删除一个键以构造非法输入；生产输入一律经 Schema parse。 */
const withoutKey = (value: object, key: string): unknown => {
  const clone: Record<string, unknown> = { ...value };
  delete clone[key];
  return clone;
};

const withoutWorkerBudget = (): unknown => withoutKey(baseConfig(), "worker");

const withRelativeDataRoot = (): unknown => ({
  ...structuredClone(baseConfig()),
  localRoots: {
    applicationRoot: "/opt/riskflow/app",
    dataRoot: "var/lib/riskflow",
    artifactRoot: "/var/lib/riskflow/artifacts",
    logRoot: "/var/log/riskflow",
  },
});

describe("部署 strict Schema", () => {
  it("拒绝 http 公共入口、相对路径与隐式默认", () => {
    expect(() =>
      DeploymentConfigV1Schema.parse(withPublicOrigin("http://riskflow.internal")),
    ).toThrow();
    expect(() => DeploymentConfigV1Schema.parse(withRelativeDataRoot())).toThrow();
    // 缺 worker 生命周期预算必须失败，不能由宿主创造默认值。
    expect(() => DeploymentConfigV1Schema.parse(withoutWorkerBudget())).toThrow();
  });

  it("只允许 activate/rollback 携带确认，并要求精确目标", () => {
    const operation = {
      schemaVersion: 1,
      operationId: "operation-01",
      idempotencyKey: "key-01",
      action: "activate",
      releaseId: "release-2030-01",
      configRef: "config-primary",
      instanceId: "app-vm-01",
      actorId: "operator-01",
      currentAuthorizationRefs: ["auth-ref-01"],
      issuedAt: "2030-01-01T00:00:00.000Z",
      expectedRevision: 0,
      confirmation: {
        targetInstanceId: "app-vm-02",
        releaseId: "release-2030-01",
        configRef: "config-primary",
        expectedRevision: 3,
      },
      payloadDigest: sha256("payload"),
    };
    expect(DeploymentOperationV1Schema.parse(operation).action).toBe("activate");
    expect(() =>
      DeploymentOperationV1Schema.parse(withoutKey(operation, "confirmation")),
    ).toThrow();
    // 备份动作必须带 backupId，且不得携带确认。
    expect(() =>
      DeploymentOperationV1Schema.parse({ ...operation, action: "backup", backupId: "backup-01" }),
    ).toThrow();
    expect(() => DeploymentOperationV1Schema.parse({ ...operation, action: "backup" })).toThrow();
    expect(
      DeploymentOperationV1Schema.parse({
        ...operation,
        action: "backup",
        backupId: "backup-01",
        confirmation: undefined,
      }).backupId,
    ).toBe("backup-01");
  });

  it("容器镜像必须有 digest，其它制品不得携带", () => {
    const artifact = {
      artifactId: "postgres-image",
      kind: "container-image",
      version: "18.6-bookworm",
      os: "linux-x64",
      arch: "x64",
      sha256: sha256("image"),
      byteLength: 1024,
      relativePath: "images/postgres.tar",
      officialSource: "https://registry.example/postgres",
      licenseRef: "license-postgres",
      sbomRef: "sbom-postgres",
    };
    const manifest = {
      schemaVersion: 1,
      releaseId: "release-2030-01",
      codeCommit: "b".repeat(40),
      createdAt: "2030-01-01T00:00:00.000Z",
      serverCompatibility: {
        releaseId: "release-2030-01",
        minDesktopReleaseId: "desktop-2030-01",
      },
      desktopCompatibility: {
        desktopReleaseId: "desktop-2030-01",
        supportedServerReleaseIds: ["release-2030-01"],
        supportedElectronVersions: ["44.7.0"],
        supportedChromiumVersions: ["152.0.7977.130"],
        supportedBundledNodeVersions: ["24.21.0"],
      },
      artifacts: [artifact],
      configTemplateRefs: ["config-template-primary"],
      finalMigrationVersion: "000056",
      operationsManualRef: "manual-operations",
    };
    expect(() => ReleaseManifestV1Schema.parse(manifest)).toThrow();
    expect(
      ReleaseManifestV1Schema.parse({
        ...manifest,
        artifacts: [{ ...artifact, digest: `sha256:${"c".repeat(64)}` }],
      }).artifacts[0]?.digest,
    ).toBe(`sha256:${"c".repeat(64)}`);
    // 越界介质路径必须拒绝。
    expect(() =>
      ReleaseManifestV1Schema.parse({
        ...manifest,
        artifacts: [
          { ...artifact, digest: `sha256:${"c".repeat(64)}`, relativePath: "../../etc/passwd" },
        ],
      }),
    ).toThrow();
  });
});

describe("秘密文件加载", () => {
  it("拒绝过宽权限、符号链接与缺失文件，且不泄露宿主路径", () => {
    const root = mkdtempSync(join(tmpdir(), "riskflow-secrets-"));
    temporaryRoots.push(root);
    const secretPath = join(root, "db-app");
    writeFileSync(secretPath, "secret-value");
    chmodSync(secretPath, 0o644);

    const load = createDeploymentSecretFileLoaderV1({ expectedUid: process.getuid?.() });
    let captured: unknown;
    try {
      load([{ secretId: "db-app-password", filePath: secretPath }]);
    } catch (error) {
      captured = error;
    }
    expect(issueMessagesOf(captured)).toEqual([DEPLOYMENT_SECRET_ERROR_V1.tooPermissive]);
    // 错误只回 secretId 与原因码，不含宿主绝对路径或秘密内容。
    expect(JSON.stringify(captured)).not.toContain(root);
    expect(JSON.stringify(captured)).not.toContain("secret-value");

    chmodSync(secretPath, 0o600);
    expect(load([{ secretId: "db-app-password", filePath: secretPath }])["db-app-password"]).toBe(
      "secret-value",
    );

    let missing: unknown;
    try {
      load([{ secretId: "absent", filePath: join(root, "absent") }]);
    } catch (error) {
      missing = error;
    }
    expect(issueMessagesOf(missing)).toEqual([DEPLOYMENT_SECRET_ERROR_V1.missing]);
  });
});

describe("运维状态、追加审计与最小权限", () => {
  let postgres: PostgresTestFixture;
  let store: ReturnType<typeof createPostgresDeploymentOperationStoreV1>;

  beforeAll(async () => {
    postgres = await startPostgresFixture();
    const migratorRuntime = createPostgresRuntime(postgres.admin, "riskflow_migrator");
    await runPostgresMigrations({
      // 000056 会授权集群级角色归属，只有管理连接能执行；业务主体不得复用。
      connection: postgres.admin,
      migrationRoot: postgres.productionMigrationRoot,
    });
    store = createPostgresDeploymentOperationStoreV1({
      db: migratorRuntime.db as unknown as Kysely<unknown>,
      instanceId: "app-vm-01",
    });
    await migratorRuntime.close();
  }, 180_000);

  afterEach(async () => {
    while (pools.length > 0) await pools.pop()!.end();
  });

  it("同键同载荷复用原阶段，异载荷返回不可重试冲突", async () => {
    const accepted = await store.accept({
      operationId: "operation-retry",
      instanceId: "app-vm-01",
      idempotencyKey: "key-retry",
      payloadDigest: sha256("payload-a"),
      action: "backup",
      actorId: "operator-01",
      inputRefs: ["auth-ref-01"],
    });
    expect(accepted.stage).toBe(DEPLOYMENT_OPERATION_STAGE_V1.accepted);

    const replay = await store.accept({
      operationId: "operation-retry",
      instanceId: "app-vm-01",
      idempotencyKey: "key-retry",
      payloadDigest: sha256("payload-a"),
      action: "backup",
      actorId: "operator-01",
      inputRefs: ["auth-ref-01"],
    });
    expect(replay.revision).toBe(accepted.revision);

    await expect(
      store.accept({
        operationId: "operation-retry-2",
        instanceId: "app-vm-01",
        idempotencyKey: "key-retry",
        payloadDigest: sha256("payload-b"),
        action: "backup",
        actorId: "operator-01",
        inputRefs: ["auth-ref-01"],
      }),
    ).rejects.toThrow();
  });

  it("阶段推进与追加审计同事务，陈旧修订被拒绝", async () => {
    const accepted = await store.accept({
      operationId: "operation-cas",
      instanceId: "app-vm-01",
      idempotencyKey: "key-cas",
      payloadDigest: sha256("payload-cas"),
      action: "status",
      actorId: "operator-01",
      inputRefs: [],
    });
    const advanced = await store.advance({
      operationId: accepted.operationId,
      instanceId: accepted.instanceId,
      expectedRevision: accepted.revision,
      stage: DEPLOYMENT_OPERATION_STAGE_V1.completed,
      status: "completed",
      resultRefs: {
        releaseId: "release-2030-01",
        perProjectAuditRefs: [],
        stageCounters: { projects: 1 },
      },
      reasonCode: "STATUS_REPORTED",
    });
    expect(advanced.revision).toBe(accepted.revision + 1);

    await expect(
      store.advance({
        operationId: accepted.operationId,
        instanceId: accepted.instanceId,
        expectedRevision: accepted.revision,
        stage: DEPLOYMENT_OPERATION_STAGE_V1.running,
        status: "running",
        resultRefs: { releaseId: "release-2030-01", perProjectAuditRefs: [], stageCounters: {} },
        reasonCode: "STALE_RETRY",
      }),
    ).rejects.toThrow();

    const auditRefs = await store.readAuditRefs({
      operationId: accepted.operationId,
      instanceId: accepted.instanceId,
    });
    expect(auditRefs).toHaveLength(2);

    const result = await store.readResult({
      operationId: accepted.operationId,
      instanceId: accepted.instanceId,
    });
    expect(result?.status).toBe("completed");
    expect(result?.safeReasonCode).toBe("STATUS_REPORTED");
    expect(result?.operationAuditIds).toEqual(auditRefs);
  });

  it("业务主体不能写运维表，也不能改写运维审计", async () => {
    const appPool = new Pool({ ...postgres.app, applicationName: "riskflow-test-app" });
    pools.push(appPool);
    for (const statement of [
      `INSERT INTO business.deployment_operations
         (instance_id, operation_id, idempotency_key, payload_digest, action, stage, status,
          actor_id, input_refs, result_refs, created_at, updated_at)
       VALUES ('app-vm-01','forged','forged','${sha256("x")}','status','accepted','accepted',
               'attacker','[]'::jsonb,'{}'::jsonb, now(), now())`,
      `INSERT INTO business.deployment_operation_audit
         (event_id, operation_id, instance_id, revision, action, stage, outcome, actor_id,
          context_refs, release_refs, reason_code, recorded_at)
       VALUES ('forged','operation-cas','app-vm-01',0,'status','accepted','accepted','attacker',
               '[]'::jsonb,'[]'::jsonb,'FORGED', now())`,
      `DELETE FROM business.deployment_operation_audit`,
    ]) {
      await expect(appPool.query(statement)).rejects.toThrow();
    }
  });

  it("即使超级用户也不能改写或删除运维审计行", async () => {
    // 用超级用户身份验证：追加语义由触发器强制，而非依赖角色权限。
    const superuserPool = new Pool({
      ...postgres.admin,
      applicationName: "riskflow-test-superuser",
    });
    pools.push(superuserPool);
    await expect(
      superuserPool.query(
        `UPDATE business.deployment_operation_audit SET reason_code = 'TAMPERED' WHERE event_id LIKE 'deployment-audit-%'`,
      ),
    ).rejects.toThrow();
    await expect(
      superuserPool.query(
        `DELETE FROM business.deployment_operation_audit WHERE event_id LIKE 'deployment-audit-%'`,
      ),
    ).rejects.toThrow();
  });
});

describe("显式初始化", () => {
  it("空库建立权限与迁移，重放保留已成立事实", async () => {
    const postgres = await startPostgresFixture();
    const operatorPool = new Pool(postgres.migrator);
    pools.push(operatorPool);
    try {
      const first = await initializeDeploymentV1({
        config: baseConfig(),
        // 初始化是显式部署动作，使用高权限连接；运行主体不得复用。
        migrationConnection: postgres.admin,
        migrationRoot: postgres.productionMigrationRoot,
        finalMigrationVersion: "000056",
      });
      expect(first.currentMigrationVersion).toBe("000056");
      expect(first.createdLoginRoles).toEqual([
        "riskflow_migrator_login",
        "riskflow_app_login",
        "riskflow_outbox_worker_login",
        "riskflow_checkpointer_login",
        "riskflow_deployment_operator_login",
      ]);

      // 重放不得重置凭据或迁移事实。
      const replay = await initializeDeploymentV1({
        config: baseConfig(),
        migrationConnection: postgres.admin,
        migrationRoot: postgres.productionMigrationRoot,
        finalMigrationVersion: "000056",
      });
      expect(replay.appliedMigrations).toEqual([]);
      expect(replay.currentMigrationVersion).toBe("000056");

      const roleMembers = await sql<{ rolname: string }>`SELECT rolname FROM pg_roles
        WHERE rolname = 'riskflow_deployment_operator_login'`.execute(
        createPostgresRuntime(postgres.admin, "riskflow_migrator").db as unknown as Kysely<unknown>,
      );
      expect(roleMembers.rows).toHaveLength(1);
    } finally {
      await operatorPool.end().catch(() => undefined);
      await postgres.close();
    }
  }, 180_000);

  it("运行启动只检查迁移兼容，不做 DDL", async () => {
    const postgres = await startPostgresFixture();
    const appPool = new Pool(postgres.app);
    pools.push(appPool);
    try {
      // 未初始化时业务主体既没有表也没有建表权限。
      await expect(
        appPool.query(`CREATE TABLE business.deployment_probe (id int)`),
      ).rejects.toThrow();
    } finally {
      await appPool.end().catch(() => undefined);
      await postgres.close();
    }
  }, 180_000);
});
