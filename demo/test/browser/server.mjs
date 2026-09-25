/**
 * C32 demo 浏览器验收的真实服务夹具（D12）：demo 生产构建 + 真实 HTTP/授权/投影接缝 +
 * 真实 PostgreSQL/C03/C04/C06，不引入开发服务器、Mock 后端或 Mock 浏览器。
 * 治理与检索事实为合成样本（待甲方复核），经真实迁移表与工件接缝播种。
 */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { TextEncoder } from "node:util";
import { fileURLToPath } from "node:url";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { chromium } from "@playwright/test";

import { buildApi } from "../../../apps/api/dist/index.js";
import {
  bootstrapInitialSystemAdministrator,
  createPostgresLocalIdentityAccess,
} from "../../../packages/adapters/dist/auth/index.js";
import { createContentAddressedArtifactStore } from "../../../packages/adapters/dist/artifacts/index.js";
import { createPostgresEngineeringDataCatalogAdapter } from "../../../packages/adapters/dist/engineering-data/catalog/index.js";
import { createPostgresEngineeringContextSourceRegistry } from "../../../packages/adapters/dist/engineering-data/context-source/index.js";
import { createPostgresMonitoringStore } from "../../../packages/adapters/dist/engineering-data/monitoring/index.js";
import {
  PostgresIdentificationContextAdapter,
  PostgresOfficialHybridResultReader,
  createPostgresKnowledgeRetrievalReadAdapter,
} from "../../../packages/adapters/dist/identification/context/index.js";
import { createPostgresKnowledgeGovernanceReadAdapter } from "../../../packages/adapters/dist/knowledge-governance/index.js";
import {
  bootstrapPostgresFoundation,
  createPostgresTransactionUnit,
  runPostgresMigrations,
} from "../../../packages/adapters/dist/postgres/index.js";
import { createPostgresRuntime } from "../../../packages/adapters/dist/postgres/pool.js";
import { PostgresRetrievalAdapter } from "../../../packages/adapters/dist/retrieval/index.js";
import {
  createPostgresWorkflowAdapter,
  createPostgresWorkflowProjection,
} from "../../../packages/adapters/dist/workflow/index.js";
import { ArtifactPutCommandV1Schema } from "../../../packages/core/dist/artifacts/index.js";
import { authorizationScopeDigest } from "../../../packages/core/dist/retrieval/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, "../../..");
const DEMO_DIST = resolve(REPOSITORY_ROOT, "demo/dist");
const MIGRATION_ROOT = resolve(REPOSITORY_ROOT, "packages/adapters/dist/postgres/migrations");
const POSTGRES_IMAGE =
  "postgres:18.6-bookworm@sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af";
const ROOT_PASSWORD = "riskflow-root-password";
const ROLE_PASSWORD = "riskflow-role-password";
const HMAC_KEY = Buffer.alloc(32, 7);
const KEY_VERSION = "key-v1";
const ADMIN_PASSWORD = "Riskflow-Admin-2030!";
const ADMIN_PASSWORD_CHANGED = "Riskflow-Admin-2030-Changed!";
const OPERATOR_LOGIN = "demo-operator";
const VIEWER_LOGIN = "demo-viewer";
const RESPONDER_LOGIN = "demo-responder";
const ACCOUNT_PASSWORD = "Riskflow-Demo-2030!";
const ACCOUNT_PASSWORD_CHANGED = "Riskflow-Demo-2030-Changed!";
const PROJECT_ID = "demo-c32-project";
const NOW = "2030-06-02T00:00:00.000Z";

const sha = (seed) => createHash("sha256").update(seed).digest("hex");

// 容器停止时 PostgreSQL 会主动断开仍打开的连接，pg 池以未监听的 'error' 事件抛出
// 57P01；这只是 teardown 噪声，不应压垮测试 worker。非 teardown 错误照常失败。
let tearingDown = false;
process.on("uncaughtException", (error) => {
  const code = /** @type {{ code?: string }} */ (error)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (tearingDown && (code === "57P01" || message.includes("terminating connection"))) return;
  console.error(error);
  process.exit(1);
});

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const kindRef = (kind, entityId, versionId = "1") => ({
  kind,
  reference: { entityId, versionId },
});
const versionRef = (entityId, versionId = "1") => ({ entityId, versionId });

/** 证据引用：A 为工程内共享资料，B 为仅系统管理员可见的受限资料（脱敏两态演示）。 */
const evidenceFor = (sourceVersionRef, sourceSegmentId) => ({
  locator: { sourceSegmentId },
  sourceVersion: sourceVersionRef.reference,
});

const agentTaskRef = {
  kind: "agent-task",
  reference: versionRef("demo-agent-task"),
  taskType: "retrieval-review",
  triggerMode: "embedded",
  modelDeploymentRef: versionRef("demo-model-deployment"),
  promptTemplateRef: versionRef("demo-prompt-template"),
  toolPolicyRef: versionRef("demo-tool-policy"),
  budgetPolicyRef: versionRef("demo-budget-policy"),
  incrementSchemaRef: versionRef("demo-increment-schema"),
  validationPolicyRef: versionRef("demo-validation-policy"),
};

/**
 * 启动真实服务：PostgreSQL + 生产迁移 + C04/C03/C06 组合 + C32 四条只读端口 + demo 生产构建。
 * 环境不可用时抛错，调用方必须让验收失败而不是跳过。
 */
export const startDemoBrowserServer = async () => {
  if (!existsSync(DEMO_DIST)) throw new Error(`demo production build is missing: ${DEMO_DIST}`);
  if (!existsSync(MIGRATION_ROOT)) {
    throw new Error(`migration root is missing: ${MIGRATION_ROOT}`);
  }
  if (!existsSync(chromium.executablePath())) {
    throw new Error(`Chromium executable is missing: ${chromium.executablePath()}`);
  }

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase("riskflow")
    .withUsername("postgres")
    .withPassword(ROOT_PASSWORD)
    .start();
  const rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c32-browser-"));
  const base = {
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    max: 8,
    connectionTimeoutMillis: 10_000,
  };
  const admin = { ...base, user: "postgres", password: ROOT_PASSWORD };
  const roleConfig = (user) => ({ ...base, user, password: ROLE_PASSWORD });
  const loginRoles = [
    ["riskflow_migrator_login", ["riskflow_migrator"]],
    ["riskflow_app_login", ["riskflow_app"]],
    ["riskflow_outbox_worker_login", ["riskflow_app", "riskflow_outbox_worker"]],
    ["riskflow_checkpointer_login", ["riskflow_checkpointer"]],
  ];
  const closeables = [];

  try {
    await bootstrapPostgresFoundation(admin);
    const adminRuntime = createPostgresRuntime(admin);
    closeables.push(() => adminRuntime.close());
    // pg 池在空闲连接被服务端断开时以未监听的 'error' 事件抛出（teardown 噪声）。
    // 无法触达各适配器内部池，经共享原型在首次 query 时挂空监听；真实查询错误仍按 Promise  rejection 传播。
    const poolPrototype = Object.getPrototypeOf(adminRuntime.pool);
    if (poolPrototype.__riskflowHarnessPatched !== true) {
      const originalQuery = poolPrototype.query;
      poolPrototype.query = function (...args) {
        if (this.listenerCount("error") === 0) this.on("error", () => undefined);
        return originalQuery.apply(this, args);
      };
      poolPrototype.__riskflowHarnessPatched = true;
    }
    for (const [role, groups] of loginRoles) {
      await adminRuntime.pool.query(
        `CREATE ROLE ${role} LOGIN PASSWORD '${ROLE_PASSWORD}' IN ROLE ${groups.join(", ")}`,
      );
    }
    const migrator = roleConfig("riskflow_migrator_login");
    await runPostgresMigrations({ connection: migrator, migrationRoot: MIGRATION_ROOT });

    const appRuntime = createPostgresRuntime(roleConfig("riskflow_app_login"), "riskflow_app");
    closeables.push(() => appRuntime.close());
    const transactionUnit = createPostgresTransactionUnit(roleConfig("riskflow_app_login"));
    closeables.push(() => transactionUnit.close());
    const artifactStore = await createContentAddressedArtifactStore({
      ...roleConfig("riskflow_app_login"),
      rootDirectory,
      policy: {
        schemaVersion: "1",
        policyRef: versionRef("demo-browser-artifact-policy"),
        maxArtifactBytes: 64 * 1024 * 1024,
        maxConcurrentWrites: 4,
        maxConcurrentReads: 4,
        stagingMaxBytes: 96 * 1024 * 1024,
        orphanGracePeriodMs: 10_000,
        registrationTimeoutMs: 1_000,
        maintenanceBatchSize: 100,
      },
    });
    closeables.push(() => artifactStore.close());

    await bootstrapInitialSystemAdministrator({
      connection: migrator,
      loginName: "admin001",
      displayName: "Initial administrator",
      password: ADMIN_PASSWORD,
    });
    const access = createPostgresLocalIdentityAccess({
      ...roleConfig("riskflow_app_login"),
      hmacKey: HMAC_KEY,
      keyVersion: KEY_VERSION,
    });
    closeables.push(() => access.close());
    const adminLogin = await access.login({
      kind: "login",
      loginAttemptId: "demo-browser-admin-login",
      loginName: "admin001",
      password: ADMIN_PASSWORD,
    });
    const adminSession = await access.changePassword({
      kind: "change-password",
      sessionToken: adminLogin.sessionToken,
      newPassword: ADMIN_PASSWORD_CHANGED,
    });
    const administratorContextRef = adminSession.systemAdministrationContextRef;
    const createAccount = async (loginName, displayName, commandId) =>
      access.administerIdentity({
        kind: "create-account",
        commandId,
        idempotencyKey: commandId,
        expectedVersion: "none",
        authorizationContextRef: administratorContextRef,
        loginName,
        displayName,
        password: ACCOUNT_PASSWORD,
      });
    const operator = await createAccount(
      OPERATOR_LOGIN,
      "工程经理（验收）",
      "demo-browser-create-operator",
    );
    const viewer = await createAccount(
      VIEWER_LOGIN,
      "业务查看（验收）",
      "demo-browser-create-viewer",
    );
    const responder = await createAccount(
      RESPONDER_LOGIN,
      "现场处置（验收）",
      "demo-browser-create-responder",
    );
    await access.administerProject({
      kind: "open-project",
      projectId: PROJECT_ID,
      commandId: "demo-browser-open-project",
      idempotencyKey: "demo-browser-open-project",
      expectedVersion: "none",
      authorizationContextRef: administratorContextRef,
      initialRiskManagerAccountId: operator.resultRef.entityId,
      includeAdministrator: true,
    });
    const loginAs = async (loginName, attemptId) => {
      const initial = await access.login({
        kind: "login",
        loginAttemptId: attemptId,
        loginName,
        password: ACCOUNT_PASSWORD,
      });
      return access.changePassword({
        kind: "change-password",
        sessionToken: initial.sessionToken,
        newPassword: ACCOUNT_PASSWORD_CHANGED,
      });
    };
    const operatorSession = await loginAs(OPERATOR_LOGIN, "demo-browser-operator-login");
    await loginAs(VIEWER_LOGIN, "demo-browser-viewer-login");
    await loginAs(RESPONDER_LOGIN, "demo-browser-responder-login");

    const authorize = async (sessionToken, invocationId, branch, sourceVersionRefs = []) =>
      (
        await access.authorize({
          invocation: { kind: "human-session", sessionToken },
          invocationId,
          projectId: PROJECT_ID,
          branch,
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [...sourceVersionRefs],
        })
      ).context;
    const operatorAuth = (invocationId, branch, sourceVersionRefs = []) =>
      authorize(operatorSession.sessionToken, invocationId, branch, sourceVersionRefs);

    const putJson = async (artifactId, purposeCode, value, authorization, requiredCapability) => {
      const result = await artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: `${artifactId}:put`,
          idempotencyKey: `${artifactId}:put`,
          projectId: PROJECT_ID,
          actorId: authorization.actorId,
          issuedAt: NOW,
          authorization,
          requiredCapability,
          artifactId,
          artifactKind: "content",
          purposeCode,
          mediaType: "application/json",
          parentArtifactRefs: [],
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        (async function* () {
          yield new TextEncoder().encode(JSON.stringify(value, null, 2));
        })(),
      );
      return result.artifactRef;
    };

    // ---- 工程上下文与空间区段（C13 公开接缝） ----
    const monitoringStore = createPostgresMonitoringStore({
      db: appRuntime.db,
      transactionUnit,
      access,
      artifactStore,
      artifactReferenceGuard: artifactStore.referenceGuard,
    });
    const registry = createPostgresEngineeringContextSourceRegistry({
      db: appRuntime.db,
      transactionUnit,
      access,
      artifactStore,
      artifactReferenceGuard: artifactStore.referenceGuard,
      monitoringStore,
    });
    const writeAuth = async (invocationId, sourceVersionRefs = []) =>
      operatorAuth(invocationId, "engineering-data.register-source-delivery", sourceVersionRefs);
    const projectRevision = await registry.reviseContext({
      commandId: "demo-browser-context-project",
      idempotencyKey: "demo-browser-context-project",
      projectId: PROJECT_ID,
      actorId: (await writeAuth("demo-browser-context-project-auth")).actorId,
      issuedAt: NOW,
      authorization: await writeAuth("demo-browser-context-project"),
      kind: "project",
      expectedVersion: "none",
      name: "C32 验收工程",
      lifecycle: "active",
      applicabilityMetadata: {
        constructionMethod: "变径盾构法",
        stratumCondition: "富水软弱地层",
        engineeringStage: "变径空间扩挖",
      },
      effectivePeriod: { validFrom: NOW },
    });
    if (
      projectRevision.kind !== "succeeded" ||
      projectRevision.result.kind !== "project-revision"
    ) {
      throw new Error("demo fixture project revision failed");
    }
    const projectRevisionRef = projectRevision.result.revision.projectRevisionRef;
    const baseAuth = await operatorAuth("demo-browser-base", "engineering-data.context-read");
    const spatialScopeRef = baseAuth.spatialScopeRefs[0];
    await access.administerProject({
      kind: "revise-membership",
      projectId: PROJECT_ID,
      commandId: "demo-browser-viewer-membership",
      idempotencyKey: "demo-browser-viewer-membership",
      expectedVersion: "none",
      authorizationContextRef: administratorContextRef,
      membershipId: "demo-browser-viewer-membership",
      accountId: viewer.resultRef.entityId,
      roles: ["business-viewer"],
      spatialScopeRefs: [spatialScopeRef],
      status: "active",
    });
    await access.administerProject({
      kind: "revise-membership",
      projectId: PROJECT_ID,
      commandId: "demo-browser-responder-membership",
      idempotencyKey: "demo-browser-responder-membership",
      expectedVersion: "none",
      authorizationContextRef: administratorContextRef,
      membershipId: "demo-browser-responder-membership",
      accountId: responder.resultRef.entityId,
      roles: ["field-responder"],
      spatialScopeRefs: [spatialScopeRef],
      status: "active",
    });
    const spatialRevision = await registry.reviseContext({
      commandId: "demo-browser-context-spatial",
      idempotencyKey: "demo-browser-context-spatial",
      projectId: PROJECT_ID,
      actorId: baseAuth.actorId,
      issuedAt: NOW,
      authorization: await writeAuth("demo-browser-context-spatial"),
      kind: "spatial",
      spatialScopeRef,
      projectRevisionRef,
      expectedVersion: "none",
      name: "站隧一体化试验区段",
      worksiteLocation: "合成工地",
      applicabilityOverrides: {},
      status: "active",
      effectivePeriod: { validFrom: NOW },
    });
    if (spatialRevision.kind !== "succeeded" || spatialRevision.result.kind !== "spatial-revision") {
      throw new Error("demo fixture spatial revision failed");
    }
    const businessSpatialScopeRef = spatialRevision.result.revision.spatialScopeRef;
    const applicabilitySnapshot = await registry.createApplicabilitySnapshot({
      commandId: "demo-browser-applicability-snapshot",
      idempotencyKey: "demo-browser-applicability-snapshot",
      projectId: PROJECT_ID,
      actorId: baseAuth.actorId,
      issuedAt: NOW,
      authorization: await writeAuth("demo-browser-applicability-snapshot"),
      projectRevisionRef,
      spatialScopeRef: businessSpatialScopeRef,
      formedAt: NOW,
    });
    if (
      applicabilitySnapshot.kind !== "succeeded" ||
      applicabilitySnapshot.result.kind !== "applicability-snapshot"
    ) {
      throw new Error("demo fixture applicability snapshot failed");
    }
    const applicabilitySnapshotRef = applicabilitySnapshot.result.snapshot.snapshotRef;

    // ---- 资料交付 A（工程内共享）与 B（仅系统管理员可见） ----
    const registerSource = async (suffix, name) => {
      const authorization = await writeAuth(`demo-browser-source-${suffix}`);
      const sourceArtifactRef = await putJson(
        `demo-browser-source-${suffix}-body`,
        "engineering-data.register-source-delivery",
        { note: `C32 合成资料 ${suffix} 正文` },
        authorization,
        "engineering-data.write",
      );
      const metadataArtifactRef = await putJson(
        `demo-browser-source-${suffix}-metadata`,
        "engineering-data.register-source-delivery",
        {
          schemaVersion: "1",
          projectRevisionRef,
          spatialScopeRefs: [businessSpatialScopeRef],
          registeredByAccountId: authorization.actorId,
          sourceItemId: `demo-browser-source-item-${suffix}`,
          sourceItemName: name,
          sourceCategory: "engineering-document",
          sourceMetadata: {
            documentType: "施工方案",
            formedAt: NOW,
            sourceOrganization: "合成夹具",
          },
          descriptor: { kind: "file-upload", contentFingerprint: `C32 合成资料 ${suffix}` },
          applicabilityMetadataSnapshotRef: applicabilitySnapshotRef,
        },
        authorization,
        "engineering-data.write",
      );
      const delivery = await registry.apply({
        commandId: `demo-browser-delivery-${suffix}`,
        idempotencyKey: `demo-browser-delivery-${suffix}`,
        projectId: PROJECT_ID,
        actorId: authorization.actorId,
        issuedAt: NOW,
        authorization: await writeAuth(`demo-browser-delivery-${suffix}`),
        kind: "register-source-delivery",
        payload: {
          sourceConnectionRef: versionRef("file-upload"),
          deliveryKey: `demo-browser-delivery-${suffix}`,
          sourceArtifactRef,
          metadataArtifactRef,
          occurredAt: NOW,
        },
      });
      if (delivery.kind !== "succeeded") {
        throw new Error(
          `demo fixture delivery ${suffix} failed: ${JSON.stringify(delivery)}`,
        );
      }
      const sourceVersionRef = delivery.result.sourceVersionRef;
      const segmentIds = ["segment_1", "segment_2"].map(
        (segmentId) => `${sourceVersionRef.reference.entityId}-chapter_1-${segmentId}`,
      );
      const segments = await registry.registerSegments({
        commandId: `demo-browser-segments-${suffix}`,
        idempotencyKey: `demo-browser-segments-${suffix}`,
        projectId: PROJECT_ID,
        actorId: authorization.actorId,
        issuedAt: NOW,
        authorization: await writeAuth(`demo-browser-segments-${suffix}`, [sourceVersionRef]),
        sourceVersionRef,
        sourceId: sourceVersionRef.reference.entityId,
        segments: segmentIds.map((sourceSegmentId, index) => ({
          sourceSegmentId,
          chapterId: "chapter_1",
          segmentId: `segment_${index + 1}`,
          kind: "chapter",
          spatialScopeRefs: [businessSpatialScopeRef],
          locator: { kind: "document", pageNumber: index + 1, headingPath: ["验收章节"] },
        })),
      });
      if (segments.kind !== "succeeded") throw new Error(`demo fixture segments ${suffix} failed`);
      return {
        sourceVersionRef,
        segmentIds,
        sourceSegmentSetRef: segments.result.segmentSet.sourceSegmentSetRef,
      };
    };
    const sourceA = await registerSource("a", "C32 验收资料 A");
    const sourceB = await registerSource("b", "C32 验收资料 B（受限）");

    // 资料访问授权：A 工程内共享；B 仅系统管理员可见。
    const administratorAccount = await adminRuntime.pool.query(
      "SELECT account_id FROM business.local_accounts WHERE login_name = $1",
      ["admin001"],
    );
    const administratorAccountId = administratorAccount.rows[0]?.account_id;
    if (administratorAccountId === undefined) {
      throw new Error("demo fixture system administrator account is missing");
    }
    const currentSourceGrantVersion = async (sourceVersionRef) => {
      const policy = await appRuntime.pool.query(
        `SELECT p.source_access_grant_id, r.revision_no
           FROM business.source_access_policies p
           JOIN business.source_access_policy_revisions r ON r.revision_id = p.current_revision_id
          WHERE p.project_id = $1 AND p.source_entity_id = $2 AND p.source_version_id = $3`,
        [PROJECT_ID, sourceVersionRef.reference.entityId, sourceVersionRef.reference.versionId],
      );
      const row = policy.rows[0];
      return row === undefined
        ? "none"
        : { entityId: row.source_access_grant_id, versionId: String(row.revision_no) };
    };
    const sourceAccessContext = await writeAuth("demo-browser-source-access-context");
    const reviseSourceAccess = async (sourceVersionRef, suffix, visibility, allowedAccountIds) =>
      access.administerProject({
        kind: "revise-source-access",
        projectId: PROJECT_ID,
        commandId: `demo-browser-source-access-${suffix}`,
        idempotencyKey: `demo-browser-source-access-${suffix}`,
        expectedVersion: await currentSourceGrantVersion(sourceVersionRef),
        authorizationContextRef: sourceAccessContext.authorizationContextRef,
        sourceVersionRef,
        visibility,
        allowedAccountIds: [...allowedAccountIds],
        spatialScopeRefs: [spatialScopeRef],
        registeredByAccountId: administratorAccountId,
      });
    await reviseSourceAccess(sourceA.sourceVersionRef, "a", "project-shared", []);
    await reviseSourceAccess(sourceB.sourceVersionRef, "b", "restricted", [administratorAccountId]);

    // ---- 监测序列 + 批次 + 冻结快照（C14 公开接缝） ----
    const monitoringAuth = (invocationId, branch) =>
      operatorAuth(invocationId, branch, [sourceA.sourceVersionRef]);
    const seriesRef = kindRef("monitoring-series", "demo-c32-series-settlement");
    const revised = await monitoringStore.reviseSeries({
      commandId: "demo-browser-series",
      idempotencyKey: "demo-browser-series",
      projectId: PROJECT_ID,
      actorId: baseAuth.actorId,
      issuedAt: NOW,
      authorization: await monitoringAuth(
        "demo-browser-series",
        "engineering-data.register-monitoring-batch",
      ),
      monitoringSeriesRef: seriesRef,
      expectedVersion: "none",
      projectRevisionRef,
      spatialScopeRef: businessSpatialScopeRef,
      monitoringObject: "地表沉降监测点",
      monitoringIndicator: "地表沉降",
      parameterCode: "settlement",
      canonicalUnit: "mm",
      unitConversions: [{ fromUnit: "cm", scale: 10, offset: 0 }],
      effectivePeriod: { validFrom: NOW },
    });
    if (revised.kind !== "succeeded") throw new Error("demo fixture series failed");
    const policy = await monitoringStore.registerAvailabilityPolicy({
      commandId: "demo-browser-policy",
      idempotencyKey: "demo-browser-policy",
      projectId: PROJECT_ID,
      actorId: baseAuth.actorId,
      issuedAt: NOW,
      authorization: await monitoringAuth(
        "demo-browser-policy",
        "engineering-data.register-monitoring-batch",
      ),
      policy: {
        availabilityPolicyRef: versionRef("demo-c32-availability-policy"),
        projectId: PROJECT_ID,
        monitoringSeriesRef: seriesRef,
        windowDurationMs: 10_000,
        intervalMs: 1_000,
        maxInterpolationGapMs: 2_000,
        slopeWindowSize: 5,
        accelerationWindowSize: 5,
        frequencyWindowSize: 5,
        anomalyBaselineSize: 2,
        anomalyScaleFloor: 0.1,
        frequencyPowerFloor: 0,
        minimumCoverageRatio: 0.5,
        maxFrequencySamples: 32,
        algorithmVersions: {
          alignment: "a1",
          slope: "s1",
          acceleration: "g1",
          frequency: "f1",
          anomaly: "n1",
        },
        recordedAt: NOW,
        audit: { actorId: baseAuth.actorId, action: "policy", recordedAt: NOW },
      },
    });
    if (policy.kind !== "succeeded") throw new Error("demo fixture availability policy failed");
    const sampleEvidence = evidenceFor(sourceA.sourceVersionRef, sourceA.segmentIds[0]);
    const sampleLines = [
      JSON.stringify({
        schemaVersion: "1",
        mediaType: "application/x-ndjson",
        monitoringSeriesRef: seriesRef,
        projectRevisionRef,
        spatialScopeRef: businessSpatialScopeRef,
        sourceVersionRef: sourceA.sourceVersionRef,
        sourceSegmentSetRef: sourceA.sourceSegmentSetRef,
        productionStrategyRef: versionRef("monitoring-production"),
        sampleCount: 5,
      }),
      ...[6, 7, 8, 9, 10].map((second) =>
        JSON.stringify({
          sourceSampleKey: `s-${second}`,
          sampledAt: `2030-01-01T00:00:${String(second).padStart(2, "0")}.000Z`,
          value: second * 2,
          unit: "mm",
          evidenceReferences: [sampleEvidence],
        }),
      ),
    ].join("\n");
    const sampleAuth = await monitoringAuth(
      "demo-browser-samples",
      "engineering-data.register-monitoring-batch",
    );
    const sampleArtifact = await artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: "1",
        commandId: "demo-browser-samples",
        idempotencyKey: "demo-browser-samples",
        projectId: PROJECT_ID,
        actorId: sampleAuth.actorId,
        issuedAt: NOW,
        authorization: sampleAuth,
        requiredCapability: "engineering-data.write",
        artifactId: "demo-browser-samples",
        artifactKind: "content",
        purposeCode: "engineering-data.register-monitoring-batch",
        mediaType: "application/x-ndjson",
        parentArtifactRefs: [],
        evidenceReferences: [sampleEvidence],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      }),
      (async function* () {
        yield new TextEncoder().encode(sampleLines);
      })(),
    );
    const batch = await registry.apply({
      commandId: "demo-browser-batch",
      idempotencyKey: "demo-browser-batch",
      projectId: PROJECT_ID,
      actorId: sampleAuth.actorId,
      issuedAt: NOW,
      authorization: await monitoringAuth(
        "demo-browser-batch",
        "engineering-data.register-monitoring-batch",
      ),
      kind: "register-monitoring-batch",
      payload: {
        monitoringSeriesRef: seriesRef,
        deliveryKey: "demo-browser-batch",
        sampleArtifactRef: sampleArtifact.artifactRef,
        window: { from: "2030-01-01T00:00:05.000Z", to: "2030-01-01T00:00:11.000Z" },
        relation: { kind: "original" },
      },
    });
    if (batch.kind !== "succeeded") {
      throw new Error(`demo fixture monitoring batch failed: ${JSON.stringify(batch)}`);
    }
    const snapshot = await registry.freeze({
      commandId: "demo-browser-freeze",
      idempotencyKey: "demo-browser-freeze",
      projectId: PROJECT_ID,
      actorId: sampleAuth.actorId,
      issuedAt: NOW,
      authorization: await monitoringAuth("demo-browser-freeze", "engineering-data.monitoring-snapshot"),
      kind: "monitoring-snapshot",
      payload: {
        monitoringSeriesRef: seriesRef,
        cutoff: "2030-01-01T00:00:10.000Z",
        availabilityPolicyRef: versionRef("demo-c32-availability-policy"),
      },
    });
    if (snapshot.kind !== "succeeded") throw new Error("demo fixture monitoring snapshot failed");

    // ---- 治理发布播种（SQL 行 + C04 正文工件；合成样本、待甲方复核） ----
    const governanceAuth = await operatorAuth(
      "demo-browser-governance",
      "knowledge-modeling.governance-read",
    );
    const seedCommandId = "demo-browser-governance-seed";
    await appRuntime.db
      .insertInto("business.command_receipts")
      .values({
        project_id: PROJECT_ID,
        command_kind: "knowledge-modeling.govern.v1",
        idempotency_key: seedCommandId,
        command_id: seedCommandId,
        payload_sha256: sha(seedCommandId),
        result_ref: JSON.stringify(kindRef("knowledge-definition", "seed")),
        audit_entry_id: `${seedCommandId}:audit`,
        actor_ref: governanceAuth.actorId,
        authorization_context_ref: JSON.stringify(governanceAuth.authorizationContextRef),
        completed_at: NOW,
        created_at: NOW,
      })
      .execute();
    await appRuntime.db
      .insertInto("audit.entries")
      .values({
        audit_entry_id: `${seedCommandId}:audit`,
        project_id: PROJECT_ID,
        action: "knowledge-modeling.seed",
        target_ref: JSON.stringify(versionRef("seed")),
        actor_ref: governanceAuth.actorId,
        authorization_context_ref: JSON.stringify(governanceAuth.authorizationContextRef),
        version_ref: JSON.stringify(versionRef("seed")),
        occurred_at: NOW,
        recorded_at: NOW,
        command_id: seedCommandId,
        idempotency_key: seedCommandId,
      })
      .execute();

    const seedGovernanceRelease = async (definitionType, definitionId, body) => {
      const artifactRef = await putJson(
        `demo-browser-governance-${definitionId}`,
        "knowledge-modeling.governance-read",
        body,
        governanceAuth,
        "knowledge-modeling.read",
      );
      await appRuntime.db
        .insertInto("business.knowledge_definitions")
        .values({
          definition_id: definitionId,
          version_id: "1",
          project_id: PROJECT_ID,
          definition_type: definitionType,
          created_by: governanceAuth.actorId,
          authorization_context_ref: JSON.stringify(governanceAuth.authorizationContextRef),
          command_id: seedCommandId,
          audit_entry_id: `${seedCommandId}:audit`,
          created_at: NOW,
          occurred_at: NOW,
          recorded_at: NOW,
          persisted_at: NOW,
        })
        .execute();
      await appRuntime.db
        .insertInto("business.knowledge_revisions")
        .values({
          revision_id: `${definitionId}-rev-1`,
          version_id: "1",
          definition_id: definitionId,
          definition_version_id: "1",
          project_id: PROJECT_ID,
          definition_type: definitionType,
          candidate_artifact_entity_id: artifactRef.reference.entityId,
          candidate_artifact_version_id: artifactRef.reference.versionId,
          candidate_artifact_ref: JSON.stringify(artifactRef),
          evidence_references: JSON.stringify([sampleEvidence]),
          base_release_ref: null,
          base_revision_ref: null,
          artifact_identity_digest: sha(definitionId),
          command_id: seedCommandId,
          actor_ref: governanceAuth.actorId,
          authorization_context_ref: JSON.stringify(governanceAuth.authorizationContextRef),
          audit_entry_id: `${seedCommandId}:audit`,
          occurred_at: NOW,
          recorded_at: NOW,
          persisted_at: NOW,
        })
        .execute();
      await appRuntime.db
        .insertInto("business.knowledge_releases")
        .values({
          release_id: `${definitionId}-rel-1`,
          version_id: "1",
          definition_id: definitionId,
          definition_version_id: "1",
          project_id: PROJECT_ID,
          definition_type: definitionType,
          revision_id: `${definitionId}-rev-1`,
          revision_version_id: "1",
          revision_ref: JSON.stringify(kindRef("knowledge-revision", `${definitionId}-rev-1`)),
          review_task_ref: JSON.stringify(kindRef("review-task", `${definitionId}-rt`)),
          review_decision_ref: JSON.stringify(kindRef("review-decision", `${definitionId}-rd`)),
          effective_from: NOW,
          restored_from_release_ref: null,
          reason_code: null,
          command_id: seedCommandId,
          actor_ref: governanceAuth.actorId,
          authorization_context_ref: JSON.stringify(governanceAuth.authorizationContextRef),
          audit_entry_id: `${seedCommandId}:audit`,
          occurred_at: NOW,
          recorded_at: NOW,
          persisted_at: NOW,
        })
        .execute();
      return kindRef("knowledge-release", `${definitionId}-rel-1`);
    };

    const processNode = (nodeId, processKind, inputs, outputs) => ({
      nodeId,
      processKind,
      inputs,
      outputs,
      equipmentRefs: ["扩径模块"],
      structuralComponentRefs: ["钢管片"],
      stateParameters: ["盾体直径"],
      monitoringIndicators: ["地表沉降"],
      applicability: {
        constructionMethod: ["变径盾构法"],
        stratumCondition: ["富水软弱地层"],
        engineeringStage: ["变径空间扩挖"],
      },
      evidence: [sampleEvidence],
    });
    const processModelReleaseRef = await seedGovernanceRelease(
      "process-model",
      "demo-c32-process-model",
      {
        schemaVersion: "1",
        projectId: PROJECT_ID,
        definitionType: "process-model",
        validationPolicyRef: versionRef("demo-validation-policy"),
        preparationSnapshotRef: kindRef(
          "identification-preparation-snapshot",
          "demo-preparation",
        ),
        generatedAt: NOW,
        nodes: [
          processNode("PN-EXPAND-01", "扩径准备", ["小盾构到达扩径工位"], ["扩径模块就绪"]),
          processNode("PN-EXPAND-02", "变径空间扩挖", ["扩径模块就绪"], ["变径空间成形"]),
          processNode("PN-EXPAND-03", "刀盘扩径", ["变径空间成形"], ["刀盘扩径完成"]),
          processNode("PN-EXPAND-04", "盾体扩径", ["刀盘扩径完成"], ["盾体扩径完成"]),
          processNode("PN-EXPAND-05", "缩径转换", ["盾体扩径完成"], ["缩径转换完成"]),
        ],
        dependencyEdges: [
          {
            edgeId: "edge-01-02",
            fromNodeId: "PN-EXPAND-01",
            toNodeId: "PN-EXPAND-02",
            relationType: "时间先后关系",
            evidence: [sampleEvidence],
          },
          {
            edgeId: "edge-02-03",
            fromNodeId: "PN-EXPAND-02",
            toNodeId: "PN-EXPAND-03",
            relationType: "受力依赖关系",
            evidence: [sampleEvidence],
          },
        ],
      },
    );
    const mechanismReleaseRef = await seedGovernanceRelease(
      "risk-mechanism",
      "demo-c32-risk-mechanism",
      {
        schemaVersion: "1",
        projectId: PROJECT_ID,
        definitionType: "risk-mechanism",
        validationPolicyRef: versionRef("demo-validation-policy"),
        preparationSnapshotRef: kindRef(
          "identification-preparation-snapshot",
          "demo-preparation",
        ),
        generatedAt: NOW,
        processModelReleaseRef: {
          kind: "process-model-release",
          reference: processModelReleaseRef.reference,
        },
        mechanisms: [
          {
            mechanismId: "MEC-VDS-017",
            mechanismType: "过挖与地表沉降",
            nodeIds: ["PN-EXPAND-02"],
            stateParameters: ["土仓/泥水压力"],
            monitoringIndicators: ["地表沉降"],
            applicability: {
              constructionMethod: ["变径盾构法"],
              stratumCondition: ["富水软弱地层"],
              engineeringStage: ["变径空间扩挖"],
            },
            preconditions: ["土仓压力不足"],
            triggeringFactors: ["超挖"],
            evolutionPath: ["变形发展"],
            consequences: ["地表沉降超限"],
            evidence: [
              sampleEvidence,
              evidenceFor(sourceB.sourceVersionRef, sourceB.segmentIds[0]),
            ],
          },
        ],
      },
    );
    const scoringRuleReleaseRef = await seedGovernanceRelease(
      "structured-scoring-rule",
      "demo-c32-scoring-rule",
      {
        schemaVersion: "1",
        projectRevisionRef,
        configurationSetRef: versionRef("demo-config-set"),
        compatibilityRef: versionRef("demo-compatibility"),
        scoringPolicyRef: versionRef("demo-scoring-policy"),
        cleaningResultArtifactRef: kindRef("content-artifact", "demo-cleaning-result", `sha256:${sha("cleaning")}`),
        agentTaskRef,
        members: [
          {
            rule: {
              ruleId: "RULE-SETTLE-001",
              applicabilityConditions: {
                constructionMethod: ["变径盾构法"],
                stratumCondition: ["富水软弱地层"],
                engineeringStage: ["变径空间扩挖"],
              },
              indicatorItem: "地表沉降",
              scoringThresholds: [
                { thresholdId: "th-1", score: 3, value: 10, operator: "gte" },
              ],
              gradeIntervals: [{ grade: "高", lowerBound: 3 }],
              exceptionClauses: [],
              evidenceLocator: { sourceSegmentId: sourceA.segmentIds[0] },
              ruleVersion: versionRef("RULE-SETTLE-001"),
              reviewStatus: "approved",
            },
            binding: {
              sourceVersionRef: sourceA.sourceVersionRef,
              cleaningResultArtifactRef: kindRef(
                "content-artifact",
                "demo-cleaning-result",
                `sha256:${sha("cleaning")}`,
              ),
              evidenceReferences: [sampleEvidence],
              agentTaskRef,
            },
          },
        ],
      },
    );
    await seedGovernanceRelease("risk-matrix", "demo-c32-risk-matrix", {
      schemaVersion: "1",
      definitionType: "risk-matrix",
      projectRevisionRef,
      configurationSetRef: versionRef("demo-config-set"),
      content: {
        matrixId: "demo-c32-matrix",
        matrixVersion: "2026.06",
        possibilityAxis: {
          bands: [
            { bandId: "P1", lower: "0", upper: "0.5" },
            { bandId: "P2", lower: "0.5", upper: "1" },
          ],
        },
        consequenceAxis: {
          bands: [
            { bandId: "C1", lower: "0", upper: "0.5" },
            { bandId: "C2", lower: "0.5", upper: "1" },
          ],
        },
        riskLevels: [
          { levelId: "I", ordinal: 1 },
          { levelId: "II", ordinal: 2 },
          { levelId: "III", ordinal: 3 },
        ],
        cells: [
          { possibilityBandId: "P1", consequenceBandId: "C1", riskLevelId: "III" },
          { possibilityBandId: "P1", consequenceBandId: "C2", riskLevelId: "II" },
          { possibilityBandId: "P2", consequenceBandId: "C1", riskLevelId: "II" },
          { possibilityBandId: "P2", consequenceBandId: "C2", riskLevelId: "I" },
        ],
      },
    });
    await seedGovernanceRelease("measure-library", "demo-c32-measure-library", {
      schemaVersion: "1",
      definitionType: "measure-library",
      projectRevisionRef,
      configurationSetRef: versionRef("demo-config-set"),
      content: {
        measures: [
          {
            measureId: "MS-001",
            riskEventCategory: "地表沉降超限",
            applicabilityConditions: [
              { dimension: "地层条件数据", values: ["富水软弱地层"] },
              { dimension: "工程阶段数据", values: ["变径空间扩挖"] },
              { dimension: "施工工法数据", values: ["变径盾构法"] },
            ],
            triggerTypes: ["监测指标越限"],
            steps: [{ stepOrdinal: 1, instruction: "加强同步注浆并复测" }],
            resourceRequirements: ["注浆设备"],
            targetIndicatorIds: ["地表沉降"],
            evidenceRequirements: ["监测日报"],
            contraindications: [],
          },
        ],
      },
    });
    await seedGovernanceRelease("applicable-rule-set", "demo-c32-rule-set", {
      schemaVersion: "1",
      projectRevisionRef,
      applicabilitySnapshotRef: applicabilitySnapshotRef,
      applicability: {
        constructionMethod: "变径盾构法",
        stratumCondition: "富水软弱地层",
        engineeringStage: "变径空间扩挖",
      },
      configurationSetRef: versionRef("demo-config-set"),
      compatibilityRef: versionRef("demo-compatibility"),
      assemblyPolicyRef: versionRef("demo-assembly-policy"),
      requiredAt: NOW,
      includedMembers: [
        {
          ruleId: "RULE-SETTLE-001",
          ruleVersion: versionRef("RULE-SETTLE-001"),
          releaseRef: scoringRuleReleaseRef,
          revisionRef: kindRef("knowledge-revision", "demo-c32-scoring-rule-rev-1"),
          artifactRef: kindRef(
            "content-artifact",
            "demo-cleaning-result",
            `sha256:${sha("cleaning")}`,
          ),
          contentDigest: sha("rule-content"),
        },
      ],
      decisions: [
        {
          ruleId: "RULE-SETTLE-001",
          ruleVersion: versionRef("RULE-SETTLE-001"),
          decision: "included",
          reasonCode: "three-dimensional-match",
          matchedDimensions: ["施工工法数据", "地层条件数据", "工程阶段数据"],
          ruleReleaseRef: scoringRuleReleaseRef,
          ruleRevisionRef: kindRef("knowledge-revision", "demo-c32-scoring-rule-rev-1"),
          relationRefs: [],
        },
      ],
    });

    // ---- 关系上下文检索结果播种（C21 登记行 + C04 正文工件） ----
    const relationshipQueryId = "demo-c32-relationship-query";
    const relationshipDigest = sha("demo-c32-relationship-request");
    const relationshipResultRef = kindRef(
      "knowledge-query-result",
      `relationship-query-result:${PROJECT_ID}:${relationshipQueryId}`,
      relationshipDigest,
    );
    const scopeDigest = authorizationScopeDigest(baseAuth);
    const relationshipPayload = {
      schemaVersion: "1",
      projectId: PROJECT_ID,
      queryId: relationshipQueryId,
      actorId: baseAuth.actorId,
      requestedAt: NOW,
      completedAt: NOW,
      inputSnapshotRef: kindRef("identification-input-snapshot", "demo-input-snapshot"),
      workItemRef: kindRef("identification-work-item", "demo-work-item"),
      nodeId: "PN-EXPAND-02",
      policySetRef: kindRef("identification-policy-set", "demo-policy-set"),
      retrievalPolicyRef: versionRef("demo-retrieval-policy"),
      reviewAgentPolicyRef: versionRef("demo-review-agent-policy"),
      releaseBinding: {
        processModelReleaseRef: {
          kind: "knowledge-release",
          reference: processModelReleaseRef.reference,
        },
        processModelPackageDigest: sha("process-model-package"),
        riskMechanismReleaseRef: {
          kind: "knowledge-release",
          reference: mechanismReleaseRef.reference,
        },
        riskMechanismPackageDigest: sha("risk-mechanism-package"),
        retrievalEvidenceBaseReleaseRef: {
          kind: "knowledge-release",
          reference: mechanismReleaseRef.reference,
        },
        retrievalEvidenceBasePackageDigest: sha("evidence-base-package"),
        compositeMemberReleaseRefs: [
          { kind: "knowledge-release", reference: processModelReleaseRef.reference },
          { kind: "knowledge-release", reference: mechanismReleaseRef.reference },
          { kind: "knowledge-release", reference: mechanismReleaseRef.reference },
        ],
      },
      currentNode: {
        nodeId: "PN-EXPAND-02",
        processKind: "变径空间扩挖",
        inputs: ["扩径模块就绪"],
        outputs: ["变径空间成形"],
        stateParameters: ["土仓/泥水压力"],
        monitoringIndicators: ["地表沉降"],
        applicability: {
          constructionMethod: ["变径盾构法"],
          stratumCondition: ["富水软弱地层"],
          engineeringStage: ["变径空间扩挖"],
        },
        evidence: [sampleEvidence],
      },
      neighborNodes: [
        {
          nodeId: "PN-EXPAND-01",
          processKind: "扩径准备",
          edgeId: "edge-01-02",
          relationType: "时间先后关系",
          upstream: true,
          evidence: [sampleEvidence],
        },
      ],
      dependencyEdges: [
        {
          edgeId: "edge-01-02",
          fromNodeId: "PN-EXPAND-01",
          toNodeId: "PN-EXPAND-02",
          relationType: "时间先后关系",
          evidence: [sampleEvidence],
        },
      ],
      mechanisms: [
        {
          mechanismId: "MEC-VDS-017",
          mechanismType: "过挖与地表沉降",
          stateParameters: ["土仓/泥水压力"],
          monitoringIndicators: ["地表沉降"],
          evidence: [sampleEvidence],
        },
      ],
      excludedMechanisms: [
        { mechanismId: "MEC-VDS-018", reasonCode: "applicability-mismatch" },
      ],
      authorizationScopeDigest: scopeDigest,
      authorizationContextRef: baseAuth.authorizationContextRef,
      knowledgeQueryResultRef: relationshipResultRef,
    };
    const relationshipArtifactRef = await putJson(
      "demo-browser-relationship-result",
      "identification-relationship-context",
      relationshipPayload,
      governanceAuth,
      "knowledge-modeling.read",
    );
    const relationshipCommandId = `relationship-query-result-${relationshipQueryId}:register:first`;
    await appRuntime.db
      .insertInto("business.command_receipts")
      .values({
        project_id: PROJECT_ID,
        command_kind: "identification.relationship-query-result.register",
        idempotency_key: relationshipCommandId,
        command_id: relationshipCommandId,
        payload_sha256: relationshipDigest,
        result_ref: JSON.stringify(relationshipArtifactRef),
        audit_entry_id: `relationship-query-result-${relationshipQueryId}:register:audit`,
        actor_ref: baseAuth.actorId,
        authorization_context_ref: JSON.stringify(baseAuth.authorizationContextRef),
        completed_at: NOW,
        created_at: NOW,
      })
      .execute();
    await appRuntime.db
      .insertInto("audit.entries")
      .values({
        audit_entry_id: `relationship-query-result-${relationshipQueryId}:register:audit`,
        project_id: PROJECT_ID,
        action: "identification.relationship-query-result.register",
        target_ref: JSON.stringify(relationshipArtifactRef),
        actor_ref: baseAuth.actorId,
        authorization_context_ref: JSON.stringify(baseAuth.authorizationContextRef),
        version_ref: JSON.stringify(relationshipResultRef.reference),
        occurred_at: NOW,
        recorded_at: NOW,
        command_id: relationshipCommandId,
        idempotency_key: relationshipCommandId,
      })
      .execute();
    await appRuntime.db
      .insertInto("business.identification_context_results")
      .values({
        project_id: PROJECT_ID,
        result_kind: "relationship",
        result_id: relationshipResultRef.reference.entityId,
        result_version_id: relationshipDigest,
        request_digest: relationshipDigest,
        artifact_ref: JSON.stringify(relationshipArtifactRef),
        input_snapshot_ref: JSON.stringify(relationshipPayload.inputSnapshotRef),
        work_item_ref: JSON.stringify(relationshipPayload.workItemRef),
        authorization_scope_digest: scopeDigest,
        actor_ref: baseAuth.actorId,
        authorization_context_ref: JSON.stringify(baseAuth.authorizationContextRef),
        query_id: relationshipQueryId,
        knowledge_query_result_ref: JSON.stringify(relationshipResultRef),
        agent_task_ref: null,
        baseline_query_result_ref: null,
        retrieval_artifact_set_ref: null,
        relationship_query_result_ref: null,
        model_context_artifact_set_ref: null,
        created_at: NOW,
        audit_entry_id: `relationship-query-result-${relationshipQueryId}:register:audit`,
      })
      .execute();

    // ---- HTTP：C32 只读端口 + 既有查询端口 + demo 静态资源同源挂载 ----
    const workflow = createPostgresWorkflowAdapter({
      db: appRuntime.db,
      transactionUnit,
      artifactStore,
      authorization: access,
    });
    const projection = createPostgresWorkflowProjection({
      db: appRuntime.db,
      registrationStore: workflow.registrationStore,
      bodies: workflow.bodies,
      authorization: access,
    });
    const freePort = await new Promise((resolved, rejected) => {
      const probe = createServer();
      probe.once("error", rejected);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        probe.close(() => resolved(address.port));
      });
    });
    const publicOrigin = `http://127.0.0.1:${freePort}`;
    const api = buildApi({
      access,
      ports: {
        engineeringData: registry,
        engineeringDataCatalog: createPostgresEngineeringDataCatalogAdapter({
          db: appRuntime.db,
          access,
          artifactStore,
          resolvers: {
            resolveReadQuery: (query, options) => registry.resolveReadQuery(query, options),
            resolveSnapshotQuery: (query, options) =>
              monitoringStore.resolveSnapshotQuery(query, options),
          },
        }),
        knowledgeGovernanceRead: createPostgresKnowledgeGovernanceReadAdapter({
          db: appRuntime.db,
          access,
          artifactStore,
        }),
        knowledgeRetrievalRead: createPostgresKnowledgeRetrievalReadAdapter({
          relationshipResults: new PostgresIdentificationContextAdapter({
            db: appRuntime.db,
            transactionUnit,
          }),
          hybridReader: new PostgresOfficialHybridResultReader({
            retrievalStore: new PostgresRetrievalAdapter({
              db: appRuntime.db,
              transactionUnit,
            }),
            artifactStore,
          }),
          artifactStore,
          access,
        }),
        projection: projection.queryProjection,
        projectionResultRead: projection.resultRead,
      },
      publicOrigin,
      now: () => new Date(),
    });
    const sendFile = async (reply, filePath, statusCode) => {
      const body = await readFile(filePath);
      return reply
        .code(statusCode)
        .type(CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream")
        .send(body);
    };
    const indexHtml = resolve(DEMO_DIST, "index.html");
    const spaPaths = [
      "/",
      "/login",
      "/project",
      "/project/documents",
      "/project/monitoring",
      "/identification",
      "/identification/records",
      "/identification/graph",
      "/identification/process-model",
      "/assessment",
      "/assessment/records",
      "/warnings",
      "/warnings/tasks",
      "/knowledge",
      "/knowledge/mechanisms",
      "/knowledge/rules",
      "/knowledge/matrix",
      "/knowledge/measures",
      "/knowledge/retrieval-result",
      "/review",
      "/review/trace",
      "/review/runs",
      "/agent",
    ];
    for (const spaPath of spaPaths) {
      api.get(spaPath, async (_request, reply) => sendFile(reply, indexHtml, 200));
    }
    for (const prefix of ["/project", "/identification", "/assessment", "/warnings", "/risks"]) {
      api.get(`${prefix}/*`, async (_request, reply) => sendFile(reply, indexHtml, 200));
    }
    api.get("/assets/*", async (request, reply) => {
      const requested = request.url.split("?")[0];
      const candidate = resolve(DEMO_DIST, `.${requested}`);
      if (!candidate.startsWith(`${DEMO_DIST}/`) || !existsSync(candidate)) {
        return reply.code(404).send({ code: "NOT_FOUND" });
      }
      return sendFile(reply, candidate, 200);
    });
    await api.listen({ host: "127.0.0.1", port: freePort });
    closeables.push(() => api.close());

    return {
      origin: publicOrigin,
      projectId: PROJECT_ID,
      operatorLogin: OPERATOR_LOGIN,
      viewerLogin: VIEWER_LOGIN,
      responderLogin: RESPONDER_LOGIN,
      accountPassword: ACCOUNT_PASSWORD_CHANGED,
      seriesEntityId: seriesRef.reference.entityId,
      sourceAVersionEntityId: sourceA.sourceVersionRef.reference.entityId,
      sourceBVersionEntityId: sourceB.sourceVersionRef.reference.entityId,
      relationshipResult: {
        entityId: relationshipResultRef.reference.entityId,
        versionId: relationshipResultRef.reference.versionId,
      },
      close: async () => {
        tearingDown = true;
        for (const close of closeables.reverse()) {
          await Promise.resolve(close()).catch((closeError) =>
            console.error("[harness] closeable failed:", closeError),
          );
        }
        await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
        await container.stop().catch(() => undefined);
      },
    };
  } catch (error) {
    tearingDown = true;
    for (const close of closeables.reverse()) {
      await Promise.resolve(close()).catch(() => undefined);
    }
    await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
    await container.stop().catch(() => undefined);
    throw error;
  }
};
