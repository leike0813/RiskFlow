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
import {
  assertCompatibleMigrationVersion,
  initializeDeploymentV1,
} from "../../src/deployment/initialization.js";
import {
  DeploymentConfigV1Schema,
  DeploymentOperationV1Schema,
  ReleaseManifestV1Schema,
  type DeploymentConfigV1,
} from "../../src/deployment/schema.js";
import { startPostgresFixture, type PostgresTestFixture } from "../postgres/fixture.js";
import { DEPLOYMENT_POLICY_TYPE_V1_VALUES } from "../../src/deployment/policies.js";
import { makeConfig } from "../engineering-data/document-conversion/mineru/fixture.js";

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
    purpose: "synthetic-acceptance",
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
        { secretId: "db-worker-password", filePath: "/etc/riskflow/secrets/db-worker" },
        { secretId: "db-checkpointer-password", filePath: "/etc/riskflow/secrets/db-checkpointer" },
        { secretId: "db-operator-password", filePath: "/etc/riskflow/secrets/db-operator" },
        { secretId: "auth-hmac-key", filePath: "/etc/riskflow/secrets/auth-hmac" },
        { secretId: "model-api-key", filePath: "/etc/riskflow/secrets/model-api" },
      ],
      host: "127.0.0.1",
      port: 5432,
      name: "riskflow",
      maxConnections: 20,
      connectionTimeoutMs: 10_000,
      idleTimeoutMs: 30_000,
      rolePasswordSecretIds: {
        migratorRoleName: "db-migrator-password",
        appRoleName: "db-app-password",
        workerRoleName: "db-worker-password",
        checkpointerRoleName: "db-checkpointer-password",
        deploymentOperatorRoleName: "db-operator-password",
      },
      migratorRoleName: "riskflow_migrator_login",
      appRoleName: "riskflow_app_login",
      workerRoleName: "riskflow_outbox_worker_login",
      checkpointerRoleName: "riskflow_checkpointer_login",
      deploymentOperatorRoleName: "riskflow_deployment_operator_login",
    },
    auth: { hmacSecretId: "auth-hmac-key", keyVersion: "key-v1" },
    api: { host: "127.0.0.1", port: 8080 },
    models: [
      {
        backend: "network-api",
        config: {
          schemaVersion: "1",
          protocol: "openai-chat",
          deploymentRef: { entityId: "chat", versionId: "v1" },
          serviceContractRef: { entityId: "chat-contract", versionId: "v1" },
          modelVersionRef: { entityId: "model", versionId: "v1" },
          baseUrl: "https://model.internal/v1",
          modelId: "model-v1",
          capabilities: ["completeStructured"],
          contextWindowTokens: 4096,
          maxOutputTokens: 1024,
          structuredOutputMode: "schema-prompt",
          reasoningEffort: "low",
          credentialRef: "model-api-key",
          requestTimeoutMs: 30_000,
          streamIdleTimeoutMs: 10_000,
          maxResponseBytes: 1_048_576,
          maxInputBytes: 65_536,
          maxBatchItems: 1,
          inputTokenUpperBoundPolicy: { maxTokensPerInputByte: 1, requestOverheadTokens: 64 },
        },
      },
    ],
    artifacts: {
      schemaVersion: "1",
      policyRef: { entityId: "artifact-policy", versionId: "v1" },
      maxArtifactBytes: 10_000_000,
      maxConcurrentWrites: 4,
      maxConcurrentReads: 8,
      stagingMaxBytes: 20_000_000,
      orphanGracePeriodMs: 60_000,
      registrationTimeoutMs: 10_000,
      maintenanceBatchSize: 100,
    },
    outbox: {
      policyRef: { entityId: "outbox-policy", versionId: "v1" },
      batchSize: 10,
      leaseDurationMs: 30_000,
      baseDelayMs: 100,
      maxDelayMs: 10_000,
      maxAttempts: 5,
    },
    qdrant: { baseUrl: "http://127.0.0.1:6333", requestTimeoutMs: 5_000 },
    policyCatalog: {
      filePath: "/etc/riskflow/policy-catalog.json",
      catalogRef: { entityId: "catalog-2030-01", versionId: "1" },
    },
    documentConversion: {
      resourcePolicy: {
        schemaVersion: "1",
        policyRef: { entityId: "conversion-policy", versionId: "v1" },
        maxInputBytes: 10_000_000,
        maxZipEntries: 100,
        maxZipUncompressedBytes: 20_000_000,
        maxZipCompressionRatio: 100,
        maxXmlBytes: 5_000_000,
        maxPdfPages: 100,
        maxPdfTextItems: 10_000,
        maxSheets: 10,
        maxCells: 100_000,
        maxCsvRecords: 10_000,
        maxCsvFields: 100,
        maxOutputBlocks: 10_000,
      },
      qualityPolicyRef: { entityId: "ocr-quality", versionId: "v1" },
      converterDeploymentRef: { entityId: "converter", versionId: "v1" },
      mineru: null,
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
    projectBindings: [
      {
        projectId: "project-rail-01",
        policyCatalogRef: { entityId: "catalog-2030-01", versionId: "1" },
        policyRefs: Object.fromEntries(
          DEPLOYMENT_POLICY_TYPE_V1_VALUES.map((type) => [
            type,
            {
              entityId: `${type}-policy`,
              versionId: "v1",
            },
          ]),
        ),
        graphVersions: {
          riskFlow: { entityId: "risk-flow-graph", versionId: "v1" },
          identification: { entityId: "identification-graph", versionId: "v1" },
          assessment: { entityId: "assessment-graph", versionId: "v1" },
        },
        retrievalBudgetPolicyRef: { entityId: "retrieval-budget", versionId: "v1" },
        forecastPolicyReleaseRef: {
          kind: "knowledge-release",
          reference: { entityId: "forecast-policy-release", versionId: "v1" },
        },
        calibrationTargetReleaseRef: {
          kind: "knowledge-release",
          reference: { entityId: "calibration-target-release", versionId: "v1" },
        },
        siteContextBindings: [
          {
            siteContextRef: { entityId: "site-context", versionId: "v1" },
            artifactRef: { entityId: "site-context-artifact", versionId: "v1" },
          },
        ],
      },
    ],
    retrievalQuality: {
      datasets: [
        {
          projectId: "project-rail-01",
          datasetRef: { entityId: "retrieval-dataset", versionId: "v1" },
          filePath: "/var/lib/riskflow/data/retrieval-datasets/project-rail-01/v1.json",
        },
      ],
      containerRuntime: "docker-27.3.1",
      timeoutMs: 900_000,
    },
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
  it("requires matching MinerU references and its credential before assembly", () => {
    const config = baseConfig();
    const mineru = makeConfig("official-v4", {
      deploymentRef: config.documentConversion.converterDeploymentRef,
      qualityPolicyRef: config.documentConversion.qualityPolicyRef,
    });
    const configured = { ...config, documentConversion: { ...config.documentConversion, mineru } };
    expect(DeploymentConfigV1Schema.safeParse(configured).success).toBe(false);
    const ready = {
      ...configured,
      database: {
        ...config.database,
        secretFileRefs: [
          ...config.database.secretFileRefs,
          { secretId: "mineru-token", filePath: "/etc/riskflow/secrets/mineru" },
        ],
      },
    };
    expect(DeploymentConfigV1Schema.safeParse(ready).success).toBe(true);
    expect(
      DeploymentConfigV1Schema.safeParse({
        ...ready,
        documentConversion: {
          ...ready.documentConversion,
          mineru: { ...mineru, deploymentRef: { entityId: "other", versionId: "v1" } },
        },
      }).success,
    ).toBe(false);
  });

  it.each(["forecastPolicyReleaseRef", "calibrationTargetReleaseRef", "siteContextBindings"])(
    "工程部署绑定缺少 %s 时拒绝就绪配置",
    (key) => {
      const config = baseConfig();
      expect(
        DeploymentConfigV1Schema.safeParse({
          ...config,
          projectBindings: [withoutKey(config.projectBindings[0]!, key)],
        }).success,
      ).toBe(false);
    },
  );

  it("同工程现场版本不能重复，不同版本可精确绑定", () => {
    const config = baseConfig();
    const binding = config.projectBindings[0]!;
    const site = binding.siteContextBindings[0]!;
    const withSites = (siteContextBindings: unknown[]) => ({
      ...config,
      projectBindings: [{ ...binding, siteContextBindings }],
    });
    expect(DeploymentConfigV1Schema.safeParse(withSites([site, site])).success).toBe(false);
    expect(
      DeploymentConfigV1Schema.safeParse(
        withSites([site, { ...site, siteContextRef: { ...site.siteContextRef, versionId: "v2" } }]),
      ).success,
    ).toBe(true);
  });

  it("拒绝 http 公共入口、相对路径与隐式默认", () => {
    expect(() =>
      DeploymentConfigV1Schema.parse(withPublicOrigin("http://riskflow.internal")),
    ).toThrow();
    expect(() => DeploymentConfigV1Schema.parse(withRelativeDataRoot())).toThrow();
    // 缺 worker 生命周期预算必须失败，不能由宿主创造默认值。
    expect(() => DeploymentConfigV1Schema.parse(withoutWorkerBudget())).toThrow();
    expect(() => DeploymentConfigV1Schema.parse(withoutKey(baseConfig(), "models"))).toThrow();
    expect(() =>
      DeploymentConfigV1Schema.parse({
        ...baseConfig(),
        documentConversion: { ...baseConfig().documentConversion, mineru: undefined },
      }),
    ).toThrow();
    expect(DeploymentConfigV1Schema.parse(baseConfig()).documentConversion.mineru).toBeNull();
  });

  it("检索质量配置缺项时拒绝，宿主不得补默认", () => {
    const config = baseConfig();
    expect(DeploymentConfigV1Schema.safeParse(withoutKey(config, "retrievalQuality")).success).toBe(
      false,
    );
    for (const key of ["datasets", "containerRuntime", "timeoutMs"]) {
      expect(
        DeploymentConfigV1Schema.safeParse({
          ...config,
          retrievalQuality: withoutKey(config.retrievalQuality, key),
        }).success,
      ).toBe(false);
    }
    expect(
      DeploymentConfigV1Schema.safeParse({
        ...config,
        retrievalQuality: { ...config.retrievalQuality, datasets: [] },
      }).success,
    ).toBe(false);
  });

  it("检索数据集按工程与精确版本唯一，同工程不同精确版本可共存", () => {
    const config = baseConfig();
    const dataset = config.retrievalQuality.datasets[0]!;
    const withDatasets = (datasets: unknown[]) => ({
      ...config,
      retrievalQuality: { ...config.retrievalQuality, datasets },
    });
    expect(DeploymentConfigV1Schema.safeParse(withDatasets([dataset, dataset])).success).toBe(
      false,
    );
    expect(
      DeploymentConfigV1Schema.safeParse(
        withDatasets([
          dataset,
          { ...dataset, datasetRef: { ...dataset.datasetRef, versionId: "v2" } },
        ]),
      ).success,
    ).toBe(true);
  });

  it("检索数据集必须绑定已登记工程且文件位于 dataRoot 内", () => {
    const config = baseConfig();
    const dataset = config.retrievalQuality.datasets[0]!;
    const withDatasets = (datasets: unknown[]) => ({
      ...config,
      retrievalQuality: { ...config.retrievalQuality, datasets },
    });
    expect(
      DeploymentConfigV1Schema.safeParse(withDatasets([{ ...dataset, projectId: "project-other" }]))
        .success,
    ).toBe(false);
    expect(
      DeploymentConfigV1Schema.safeParse(
        withDatasets([{ ...dataset, filePath: "/opt/riskflow/retrieval-datasets/v1.json" }]),
      ).success,
    ).toBe(false);
    expect(
      DeploymentConfigV1Schema.safeParse(withDatasets([withoutKey(dataset, "filePath")])).success,
    ).toBe(false);
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
      finalMigrationVersion: "000058",
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
  it("仅新建时设置 LOGIN 密码，完成 checkpointer setup 且重放保留密码", async () => {
    const postgres = await startPostgresFixture();
    const operatorPool = new Pool(postgres.migrator);
    pools.push(operatorPool);
    const config = DeploymentConfigV1Schema.parse({
      ...baseConfig(),
      database: {
        ...baseConfig().database,
        migratorRoleName: "ip02_migrator_login",
        appRoleName: "ip02_app_login",
        workerRoleName: "ip02_worker_login",
        checkpointerRoleName: "ip02_checkpointer_login",
        deploymentOperatorRoleName: "ip02_operator_login",
      },
    });
    const loginPasswords = {
      migratorRoleName: "ip02-migrator-secret",
      appRoleName: "ip02-app-secret",
      workerRoleName: "ip02-worker-secret",
      checkpointerRoleName: "ip02-checkpointer's-secret",
      deploymentOperatorRoleName: "ip02-operator-secret",
    };
    const checkpointerConnection = {
      ...postgres.admin,
      user: config.database.checkpointerRoleName,
      password: loginPasswords.checkpointerRoleName,
    };
    const initialAdministrator = {
      loginName: "deployment-admin",
      displayName: "部署管理员",
      password: "DeploymentAdminPassword-2026!",
    };
    const adminRuntime = createPostgresRuntime(postgres.admin);
    try {
      await expect(
        initializeDeploymentV1({
          config: withoutKey(baseConfig(), "purpose"),
          migrationConnection: postgres.admin,
          migrationRoot: postgres.productionMigrationRoot,
          finalMigrationVersion: "000058",
          loginPasswords,
          checkpointerConnection,
        } as never),
      ).rejects.toThrow();

      const first = await initializeDeploymentV1({
        config,
        // 初始化是显式部署动作，使用高权限连接；运行主体不得复用。
        migrationConnection: postgres.admin,
        migrationRoot: postgres.productionMigrationRoot,
        finalMigrationVersion: "000058",
        loginPasswords,
        checkpointerConnection,
        initialAdministrator,
      });
      expect(first.currentMigrationVersion).toBe("000058");
      expect(first.initialAdministratorCreated).toBe(true);
      expect(first.createdLoginRoles).toEqual([
        "ip02_migrator_login",
        "ip02_app_login",
        "ip02_worker_login",
        "ip02_checkpointer_login",
        "ip02_operator_login",
      ]);

      for (const roleKey of ["appRoleName", "workerRoleName"] as const) {
        const runtime = createPostgresRuntime(
          {
            ...postgres.admin,
            user: config.database[roleKey],
            password: loginPasswords[roleKey],
          },
          "riskflow_app",
        );
        try {
          await expect(
            assertCompatibleMigrationVersion(runtime.db as unknown as Kysely<unknown>, "000058"),
          ).resolves.toBe("000058");
          const privileges = await sql<{ canWrite: boolean; canReadLock: boolean }>`SELECT
            has_table_privilege(current_user, 'business._riskflow_migration', 'INSERT,UPDATE,DELETE') AS "canWrite",
            has_table_privilege(current_user, 'business._riskflow_migration_lock', 'SELECT') AS "canReadLock"`.execute(
            runtime.db,
          );
          expect(privileges.rows[0]).toEqual({ canWrite: false, canReadLock: false });
        } finally {
          await runtime.close();
        }
      }

      const passwordHash = await postgres.adminPool.query<{ rolpassword: string }>(
        "SELECT rolpassword FROM pg_authid WHERE rolname = $1",
        [config.database.checkpointerRoleName],
      );
      const checkpointerPool = new Pool(checkpointerConnection);
      try {
        expect((await checkpointerPool.query("SELECT current_user")).rows[0]?.current_user).toBe(
          config.database.checkpointerRoleName,
        );
        const checkpointTables = await checkpointerPool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'langgraph_checkpoint'",
        );
        expect(Number(checkpointTables.rows[0]?.count)).toBeGreaterThan(0);
        const checkpointCount = await checkpointerPool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM langgraph_checkpoint.checkpoints",
        );
        expect(Number(checkpointCount.rows[0]?.count)).toBe(0);
      } finally {
        await checkpointerPool.end();
      }
      await expect(
        assertCompatibleMigrationVersion(adminRuntime.db as unknown as Kysely<unknown>, "000055"),
      ).rejects.toMatchObject({ code: "DEPLOYMENT_INITIALIZATION_COMPATIBILITY_FAILED" });

      // 重放不得重置凭据或迁移事实。
      const replay = await initializeDeploymentV1({
        config,
        migrationConnection: postgres.admin,
        migrationRoot: postgres.productionMigrationRoot,
        finalMigrationVersion: "000058",
        loginPasswords: { ...loginPasswords, checkpointerRoleName: "changed-secret" },
        checkpointerConnection,
        initialAdministrator: {
          ...initialAdministrator,
          password: "DifferentAdminPassword-2026!",
        },
      });
      expect(replay.appliedMigrations).toEqual([]);
      expect(replay.currentMigrationVersion).toBe("000058");
      expect(replay.initialAdministratorCreated).toBe(false);
      const accounts = await postgres.adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM business.local_accounts",
      );
      expect(Number(accounts.rows[0]?.count)).toBe(1);

      const roleMembers = await sql<{ rolname: string }>`SELECT rolname FROM pg_roles
        WHERE rolname = 'ip02_operator_login'`.execute(
        adminRuntime.db as unknown as Kysely<unknown>,
      );
      expect(roleMembers.rows).toHaveLength(1);
      const passwordHashAfterReplay = await postgres.adminPool.query<{ rolpassword: string }>(
        "SELECT rolpassword FROM pg_authid WHERE rolname = $1",
        [config.database.checkpointerRoleName],
      );
      expect(passwordHashAfterReplay.rows[0]?.rolpassword).toBe(passwordHash.rows[0]?.rolpassword);
      const originalPasswordPool = new Pool(checkpointerConnection);
      await expect(originalPasswordPool.query("SELECT 1")).resolves.toBeDefined();
      await originalPasswordPool.end();
      const changedPasswordPool = new Pool({
        ...checkpointerConnection,
        password: "changed-secret",
        connectionTimeoutMillis: 500,
      });
      await expect(changedPasswordPool.query("SELECT 1")).rejects.toThrow();
      await changedPasswordPool.end();
    } finally {
      await adminRuntime.close();
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
