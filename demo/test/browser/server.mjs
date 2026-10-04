/**
 * C32 demo 浏览器验收的真实服务夹具（D12）：demo 生产构建 + 真实 HTTP/授权/投影接缝 +
 * 真实 PostgreSQL/C03/C04/C06，不引入开发服务器、Mock 后端或 Mock 浏览器。
 * C33 扩展：注入识别只读（run-list/run-read/record-catalog/record-read）、复核队列只读与
 * decide-review 命令端口，并播种完成态/等待/可重试失败识别运行、两条标准化风险记录
 * （自动验收 + 人工复核验收）、 pending/过期复核任务与 trace-chain/association-graph 投影链边。
 * 治理、检索与识别事实均为合成样本（待甲方复核），经真实迁移表与工件接缝播种。
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
import {
  createAssessmentEntryContextReadPort,
  createPostgresEngineeringContextSourceRegistry,
} from "../../../packages/adapters/dist/engineering-data/context-source/index.js";
import { createPostgresMonitoringStore } from "../../../packages/adapters/dist/engineering-data/monitoring/index.js";
import {
  createPostgresRiskCandidateFinalizationAdapter,
  createPostgresRiskRecordTraceReader,
} from "../../../packages/adapters/dist/identification/candidate-finalization/index.js";
import {
  PostgresIdentificationContextAdapter,
  PostgresOfficialHybridResultReader,
  createPostgresKnowledgeRetrievalReadAdapter,
} from "../../../packages/adapters/dist/identification/context/index.js";
import {
  createPostgresIdentificationGraphAdapter,
  identificationGraphReadInvocationIdV1,
} from "../../../packages/adapters/dist/identification/graph/index.js";
import { createPostgresRiskIdentificationReadAdapter } from "../../../packages/adapters/dist/identification/read/index.js";
import { createPostgresKnowledgeGovernanceReadAdapter } from "../../../packages/adapters/dist/knowledge-governance/index.js";
import {
  bootstrapPostgresFoundation,
  createPostgresTransactionUnit,
  runPostgresMigrations,
} from "../../../packages/adapters/dist/postgres/index.js";
import { createPostgresRuntime } from "../../../packages/adapters/dist/postgres/pool.js";
import { PostgresRetrievalAdapter } from "../../../packages/adapters/dist/retrieval/index.js";
import { createPostgresRiskAssessmentEngine } from "../../../packages/adapters/dist/risk-assessment/engine/index.js";
import { createPostgresStandardizedRiskInputFactsReader } from "../../../packages/adapters/dist/identification/read/index.js";
import { createPostgresExternalRiskInputFactsReader } from "../../../packages/adapters/dist/engineering-data/context-source/index.js";
import { createRiskInputFactsReader } from "../../../packages/core/dist/risk-assessment/engine/index.js";
import {
  DEMO_FORECAST_POLICIES,
  createRecommendationPolicies,
  createRiskAssessmentRuntimePolicies,
  createWarningRuntimePolicies,
} from "./deploymentPolicies.mjs";
import {
  PostgresWarningAssessmentContextReader,
  createPostgresWarningLifecycleAdapter,
} from "../../../packages/adapters/dist/warning/index.js";
import { createPostgresRecommendationAdapter } from "../../../packages/adapters/dist/recommendation/index.js";
import {
  createEffectForecastModelReaderV1,
  createPostgresResponseLifecycleAdapter,
  createProductionEffectForecastExecutorsV1,
} from "../../../packages/adapters/dist/response-lifecycle/index.js";
import { createPostgresCalibrationAdapter } from "../../../packages/adapters/dist/calibration/index.js";
import { createPostgresHumanDecisionFeedbackAdapter } from "../../../packages/adapters/dist/human-decision-feedback/index.js";
import {
  createPostgresReviewAuditAdapter,
  createPostgresReviewQueueReadAdapter,
} from "../../../packages/adapters/dist/review-audit/index.js";
import {
  createPostgresWorkflowAdapter,
  createPostgresWorkflowProjection,
  workflowGraphReadInvocationIdV1,
} from "../../../packages/adapters/dist/workflow/index.js";
import { ArtifactPutCommandV1Schema } from "../../../packages/core/dist/artifacts/index.js";
import {
  AcceptanceRouteSetV1Schema,
  RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1,
  RiskCandidateFinalizationResultRowV1Schema,
  StandardizedRiskRecordWriteV1Schema,
} from "../../../packages/core/dist/identification/candidate-finalization/index.js";
import {
  IdentificationGraphArtifactBodyV1Schema,
  IdentificationGraphResultRowV1Schema,
  IdentificationGraphRunStateV1Schema,
} from "../../../packages/core/dist/identification/graph/index.js";
import { authorizationScopeDigest } from "../../../packages/core/dist/retrieval/index.js";
import {
  WorkflowGraphArtifactBodyV1Schema,
  WorkflowGraphResultRowV1Schema,
} from "../../../packages/core/dist/workflow/index.js";
import { StandardizedRiskRecordEnvelopeSchema } from "../../../packages/contracts/dist/records/index.js";
import { IdentificationInputSnapshotV1Schema } from "../../../packages/contracts/dist/workflows/index.js";

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
const RESTRICTED_LOGIN = "demo-restricted";
const ACCOUNT_PASSWORD = "Riskflow-Demo-2030!";
const ACCOUNT_PASSWORD_CHANGED = "Riskflow-Demo-2030-Changed!";
const RESTRICTED_PASSWORD_CHANGED = "Riskflow-Demo-Restricted-Changed!";
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

/**
 * 评估执行（写）路径的部署注入接缝在本装配中不提供。
 *
 * C34 只读分支不消费这些接缝；一旦误被调用立即失败，而不是返回空集合或默认策略冒充
 * 「评估依据已就绪」——后者会把未执行伪装成已评估。
 */
const unwiredWritePathSeam = (label) => () => {
  throw new Error(`评估执行路径接缝未在演示装配中注入：${label}`);
};

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
    // 受限会话验收账号：建立后从不在服务端改密，每次登录都由真实 C06 发放
    // mustChangePassword=true 的会话，只能先在浏览器里走完改密。
    const restricted = await createAccount(
      RESTRICTED_LOGIN,
      "首次登录改密（验收）",
      "demo-browser-create-restricted",
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
      const changed = await access.changePassword({
        kind: "change-password",
        sessionToken: initial.sessionToken,
        newPassword: ACCOUNT_PASSWORD_CHANGED,
      });
      // 通知策略需要精确账户主体；登录结果携带 accountRef，改密结果只带新令牌。
      return { ...changed, accountRef: initial.accountRef, sessionToken: changed.sessionToken };
    };
    const operatorSession = await loginAs(OPERATOR_LOGIN, "demo-browser-operator-login");
    const viewerSession = await loginAs(VIEWER_LOGIN, "demo-browser-viewer-login");
    const responderSession = await loginAs(RESPONDER_LOGIN, "demo-browser-responder-login");

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
    /**
     * 风险输入事实 XOR：标准化风险记录归识别验收域，外部风险事件归工程数据源登记域，
     * 由 core 的组合工厂按 kind 分派。两个分支各自复验 C06 当前授权，不共用一个查询。
     */
    const riskInputFacts = createRiskInputFactsReader({
      standardizedRiskRecord: createPostgresStandardizedRiskInputFactsReader({
        db: appRuntime.db,
        authorization: access,
      }),
      externalRiskEvent: createPostgresExternalRiskInputFactsReader({
        db: appRuntime.db,
        authorization: access,
        artifactStore,
      }),
    });
    const registry = createPostgresEngineeringContextSourceRegistry({
      db: appRuntime.db,
      transactionUnit,
      access,
      artifactStore,
      artifactReferenceGuard: artifactStore.referenceGuard,
      monitoringStore,
      // C25 风险输入事实接缝：评估准备冻结经它复验精确 XOR 输入（design D-01）。
      riskInputFacts,
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

    /**
     * C25/C26/C29 共用的真实 C06 下游签发接缝（design D-06）。
     *
     * 按调用方请求的精确 branch 逐次签发，不合并能力也不裁剪：请求什么 branch 就签什么，
     * 绑定不符时 C06 自己关闭失败。空间范围必须显式给出——human-session 路径不回填父
     * 上下文范围，漏传会让下游上下文范围为空而不是全工程。
     */
    const authorizeDownstream = async (request) =>
      (
        await access.authorize({
          invocation: { kind: "human-session", sessionToken: operatorSession.sessionToken },
          invocationId: request.invocationId,
          projectId: request.projectId,
          branch: request.branch,
          requestedSpatialScopeRefs: [...(request.requestedSpatialScopeRefs ?? [spatialScopeRef])],
          requestedSourceVersionRefs: [...(request.requestedSourceVersionRefs ?? [])],
        })
      ).context;
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
    await access.administerProject({
      kind: "revise-membership",
      projectId: PROJECT_ID,
      commandId: "demo-browser-restricted-membership",
      idempotencyKey: "demo-browser-restricted-membership",
      expectedVersion: "none",
      authorizationContextRef: administratorContextRef,
      membershipId: "demo-browser-restricted-membership",
      accountId: restricted.resultRef.entityId,
      roles: ["business-viewer"],
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

    // ---- C33 识别运行 / 标准化风险记录 / 复核任务播种（合成样本、待甲方复核） ----
    const graphAdapter = createPostgresIdentificationGraphAdapter({
      db: appRuntime.db,
      transactionUnit,
      artifactStore,
      authorization: access,
    });
    const finalizationAdapter = createPostgresRiskCandidateFinalizationAdapter({
      db: appRuntime.db,
      transactionUnit,
    });
    const reviewAudit = createPostgresReviewAuditAdapter({
      db: appRuntime.db,
      transactionUnit,
      access,
    });

    const runIdFor = (suffix) => `workflow-run:${PROJECT_ID}:${suffix}`;
    const runVersionFor = (suffix) => sha(`run-version-${suffix}`);
    const groupRefFor = (runId, groupId) =>
      kindRef(
        "identification-group",
        `identification-group:${runId}:${groupId}`,
        sha(`group-${runId}-${groupId}`),
      );

    // 复核任务先于运行播种：等待运行的 run-state 需指向其待决定任务引用。请求经真实授权
    // （invocationId=commandId，与 C27 适配器复验约定一致），身份为工程经理。
    const requestReviewTask = async (suffix, options) => {
      const commandId = `demo-c33-review-request-${suffix}`;
      const authorization = await operatorAuth(commandId, "review-audit.request-review");
      const reviewType = options.reviewType ?? "identification-group";
      const result = await reviewAudit.requestReview({
        kind: "request-review",
        commandId,
        idempotencyKey: commandId,
        projectId: PROJECT_ID,
        actorId: authorization.actorId,
        issuedAt: options.issuedAt,
        authorization,
        payload: {
          reviewType,
          targetRef: {
            kind: reviewType,
            reference: {
              entityId: options.targetEntityId,
              versionId: options.targetVersionId ?? "1",
            },
          },
          validationSnapshotRef: {
            kind: "validation-snapshot",
            reference: { entityId: `validation-${suffix}`, versionId: "1" },
          },
          evidenceSnapshotRef: {
            kind: "evidence-snapshot",
            reference: { entityId: `evidence-${suffix}`, versionId: "1" },
          },
          waitingRunRef: {
            kind: "workflow-run",
            reference: {
              entityId: options.waitingRunEntityId,
              versionId: options.waitingRunVersionId ?? "1",
            },
          },
          reviewPolicyRef: { entityId: "review-policy", versionId: "1" },
        },
      });
      if (result.kind !== "succeeded") {
        throw new Error(
          `demo fixture review request ${suffix} failed: ${JSON.stringify(result)}`,
        );
      }
      return result.result.reviewTaskRef;
    };

    const waitingRunId = runIdFor("waiting");
    const waitingRunVersionId = runVersionFor("waiting");
    const waitingPendingGroupRef = groupRefFor(waitingRunId, "group-pending");
    const pendingTaskRef = await requestReviewTask("pending", {
      targetEntityId: waitingPendingGroupRef.reference.entityId,
      targetVersionId: waitingPendingGroupRef.reference.versionId,
      waitingRunEntityId: waitingRunId,
      waitingRunVersionId,
      issuedAt: "2030-06-01T09:05:00.000Z",
    });
    // 过期语义：同一目标实体先请求 v1（保持 pending），再从另一等待运行请求更晚的 v2 →
    // v1 不被取代但目标版本已过期（stale），v2 为可决定的现行版本。
    const staleTargetEntityId = `identification-group:${PROJECT_ID}:stale-target`;
    const staleTaskRefV1 = await requestReviewTask("stale-v1", {
      targetEntityId: staleTargetEntityId,
      targetVersionId: "1",
      waitingRunEntityId: runIdFor("stale-w1"),
      issuedAt: "2030-06-01T07:00:00.000Z",
    });
    const freshTaskRefV2 = await requestReviewTask("stale-v2", {
      targetEntityId: staleTargetEntityId,
      targetVersionId: "2",
      waitingRunEntityId: runIdFor("stale-w2"),
      issuedAt: "2030-06-01T07:10:00.000Z",
    });
    const batchTaskRef1 = await requestReviewTask("batch-1", {
      targetEntityId: `identification-group:${PROJECT_ID}:batch-target-1`,
      waitingRunEntityId: runIdFor("batch-w1"),
      issuedAt: "2030-06-01T07:20:00.000Z",
    });
    const batchTaskRef2 = await requestReviewTask("batch-2", {
      targetEntityId: `identification-group:${PROJECT_ID}:batch-target-2`,
      waitingRunEntityId: runIdFor("batch-w2"),
      issuedAt: "2030-06-01T07:30:00.000Z",
    });
    // viewer 降级证据专用：保持 pending，viewer 的决定提交必须失败闭合（无 decide 分支）。
    const viewerTaskRef = await requestReviewTask("viewer-denied", {
      targetEntityId: `identification-group:${PROJECT_ID}:viewer-target`,
      waitingRunEntityId: runIdFor("viewer-w"),
      issuedAt: "2030-06-01T07:40:00.000Z",
    });

    // C04 正文写入与生产读侧共用同一 body-write 派生调用身份（真实授权接缝）。
    const putGraphBody = async (artifactId, body) => {
      const authorization = await operatorAuth(
        identificationGraphReadInvocationIdV1({
          operation: "body-write",
          projectId: PROJECT_ID,
          targetId: artifactId,
        }),
        "risk-identification.plan",
      );
      return graphAdapter.putBody({
        projectId: PROJECT_ID,
        actorId: authorization.actorId,
        commandId: `demo-c33-put-${artifactId}`,
        issuedAt: NOW,
        artifactId,
        body: IdentificationGraphArtifactBodyV1Schema.parse(body),
        authorization,
      });
    };

    const graphRowFor = (input) => {
      const base = {
        schemaVersion: "1",
        projectId: PROJECT_ID,
        resultId: input.resultId,
        resultVersionId: sha(`result-version-${input.suffix}`),
        runId: input.runId,
        runVersionId: input.runVersionId,
        commandId: `demo-c33-${input.suffix}`,
        idempotencyKey: `demo-c33-idempotency-${input.suffix}`,
        requestDigest: sha(`demo-c33-request-${input.suffix}`),
        artifactRef: input.artifactRef,
        authorizationScopeDigest: scopeDigest,
        actorRef: baseAuth.actorId,
        authorizationContextRef: baseAuth.authorizationContextRef,
        validAt: input.validAt,
        recordedAt: input.validAt,
        persistedAt: input.validAt,
        auditEntryId: `demo-c33-${input.suffix}:audit`,
      };
      switch (input.kind) {
        case "work-plan":
          return IdentificationGraphResultRowV1Schema.parse({
            ...base,
            resultKind: "work-plan",
            parentRunRef: kindRef(
              "workflow-run",
              `risk-flow-run:${PROJECT_ID}`,
              sha("parent-version"),
            ),
            inputSnapshotRef: input.inputSnapshotRef,
            workPlanRef: input.workPlanRef,
          });
        case "stage-result":
          return IdentificationGraphResultRowV1Schema.parse({
            ...base,
            resultKind: "stage-result",
            workPlanRef: input.workPlanRef,
            stageResultRef: input.stageResultRef,
          });
        case "run-state":
          return IdentificationGraphResultRowV1Schema.parse({
            ...base,
            resultKind: "run-state",
          });
        default:
          throw new Error(`unknown graph row kind ${input.kind}`);
      }
    };

    const registerGraphRows = async (rows, commandId) => {
      const normalized = rows.map((row) =>
        IdentificationGraphResultRowV1Schema.parse({
          ...row,
          commandId,
          auditEntryId: `${commandId}:audit`,
        }),
      );
      const head = normalized[0];
      await transactionUnit.execute(
        {
          projectId: PROJECT_ID,
          commandKind: "identification-graph-result-register",
          commandId,
          idempotencyKey: commandId,
          payload: { fixture: "合成样本、待甲方复核" },
          actorRef: baseAuth.actorId,
          authorizationContextRef: baseAuth.authorizationContextRef,
          issuedAt: NOW,
        },
        async (context) => {
          const outcome = await graphAdapter.registerResults(
            { rows: normalized, occurredAt: NOW },
            context,
          );
          if (outcome.kind !== "registered") {
            throw new Error("demo fixture graph row seeding failed");
          }
          return {
            resultRef: head.artifactRef,
            audit: {
              auditEntryId: `${commandId}:audit`,
              projectId: PROJECT_ID,
              action: "identification-graph-result-register",
              targetRef: head.artifactRef,
              actorRef: baseAuth.actorId,
              authorizationContextRef: baseAuth.authorizationContextRef,
              occurredAt: NOW,
              recordedAt: NOW,
              version: { entityId: head.resultId, versionId: head.resultVersionId },
              commandId,
              idempotencyKey: commandId,
            },
            events: [],
          };
        },
      );
    };

    const runStateBody = (runId, runVersionId, stage, status, workItemRef, extra = {}) => ({
      bodyKind: "run-state",
      runState: IdentificationGraphRunStateV1Schema.parse({
        schemaVersion: "1",
        runId,
        runVersionId,
        stage,
        status,
        completedWorkItemRefs: [],
        pendingWorkItemRefs: [workItemRef],
        validatedCandidateSetRefs: [],
        failedWorkItemRefs: [],
        acceptedRiskRecordRefs: [],
        rejectedGroupRefs: [],
        pendingGroupRefs: [],
        ...extra,
      }),
    });

    // 完整运行：工作计划 + I1/I3/I5/I7 阶段正文 + 验收路由集 + 两条记录（自动/人工）+ run-state。
    const completedSuffix = "completed";
    const completedRunId = runIdFor(completedSuffix);
    const completedRunVersionId = runVersionFor(completedSuffix);
    const completedRunRef = kindRef("workflow-run", completedRunId, completedRunVersionId);
    const completedValidAt = "2030-06-01T08:00:00.000Z";
    const workPlanRef = kindRef(
      "identification-work-plan",
      `identification-work-plan:${completedRunId}`,
      sha("work-plan-request-completed"),
    );
    const inputSnapshotRef = kindRef(
      "identification-input-snapshot",
      `identification-input-snapshot:${completedRunId}`,
      sha("input-snapshot-request-completed"),
    );
    const workItemRef = kindRef(
      "identification-work-item",
      `identification-work-item:${completedRunId}:PN-EXPAND-02`,
      sha("work-item-request-completed"),
    );
    const completedAgentTaskRef = {
      kind: "agent-task",
      reference: versionRef("demo-c33-agent-task-completed"),
      taskType: "retrieval-review",
      triggerMode: "embedded",
      modelDeploymentRef: versionRef("demo-model-deployment"),
      promptTemplateRef: versionRef("demo-prompt-template"),
      toolPolicyRef: versionRef("demo-tool-policy"),
      budgetPolicyRef: versionRef("demo-budget-policy"),
      incrementSchemaRef: versionRef("demo-increment-schema"),
      validationPolicyRef: versionRef("demo-validation-policy"),
    };
    const acceptedGroupRef = groupRefFor(completedRunId, "group-accepted");
    const reviewedGroupRef = groupRefFor(completedRunId, "group-reviewed");
    const rejectedGroupRef = groupRefFor(completedRunId, "group-rejected");
    const completedReviewTaskRef = {
      kind: "review-task",
      reference: versionRef(`review-task:${completedRunId}:group-reviewed`),
      reviewType: "identification-group",
      targetRef: reviewedGroupRef,
      waitingRunRef: completedRunRef,
    };
    const recordAutoRef = kindRef(
      "standardized-risk-record",
      `risk-record:${completedRunId}:record-auto`,
      "1",
    );
    const recordReviewRef = kindRef(
      "standardized-risk-record",
      `risk-record:${completedRunId}:record-review`,
      "1",
    );
    const routeDecisionRef = kindRef(
      "route-decision",
      `route-decision:${completedRunId}:group-accepted`,
      sha("route-decision-completed"),
    );
    const reviewDecisionRef = kindRef(
      "review-decision",
      `review-decision:${completedRunId}:group-reviewed`,
      sha("review-decision-completed"),
    );
    const routeSetRef = kindRef(
      "acceptance-route-set",
      `acceptance-route-set:${completedRunId}`,
      sha("route-set-completed"),
    );
    const mergePlanRef = kindRef(
      "merge-plan",
      `merge-plan:${completedRunId}`,
      sha("merge-plan-completed"),
    );
    const confidenceFixture = (value) => ({
      value,
      basis: [
        { source: "model-confidence", available: true, value, weight: 1, contribution: value },
        { source: "rule-consistency", available: true, value, weight: 1, contribution: value },
        {
          source: "simulation-constraint",
          available: true,
          value,
          weight: 1,
          contribution: value,
        },
        { source: "multi-source-merge", available: true, value, weight: 1, contribution: value },
      ],
      policyRef: versionRef("demo-confidence-policy"),
      missingBasisBehavior: "block",
      roundingDecimals: 4,
    });

    const planArtifactRef = await putGraphBody(`demo-c33-body-plan-${completedSuffix}`, {
      bodyKind: "work-plan",
      workPlan: {
        schemaVersion: "1",
        projectId: PROJECT_ID,
        workPlanRef,
        inputSnapshotRef,
        inputSnapshot: IdentificationInputSnapshotV1Schema.parse({
          schemaVersion: "1",
          preparationSnapshotRef: kindRef(
            "identification-preparation-snapshot",
            "demo-preparation",
          ),
          processModelReleaseRef: kindRef(
            "process-model-release",
            processModelReleaseRef.reference.entityId,
            processModelReleaseRef.reference.versionId,
          ),
          riskMechanismReleaseRef: kindRef(
            "risk-mechanism-release",
            mechanismReleaseRef.reference.entityId,
            mechanismReleaseRef.reference.versionId,
          ),
          retrievalEvidenceBaseReleaseRef: kindRef(
            "retrieval-evidence-base-release",
            mechanismReleaseRef.reference.entityId,
            mechanismReleaseRef.reference.versionId,
          ),
          identificationPolicySetRef: kindRef("identification-policy-set", "demo-policy-set"),
          retrievalPolicyRef: versionRef("demo-retrieval-policy"),
          retrievalReviewAgentPolicyRef: versionRef("demo-review-agent-policy"),
          repairPolicyRef: versionRef("demo-repair-policy"),
          confidencePolicyRef: versionRef("demo-confidence-policy"),
          forcedReviewPolicyRef: versionRef("demo-forced-review-policy"),
          retryPolicyRef: versionRef("demo-retry-policy"),
          modelDeploymentRef: versionRef("demo-model-deployment"),
          promptTemplateRef: versionRef("demo-prompt-template"),
          authorizationContextRef: baseAuth.authorizationContextRef,
          auditTrailRef: kindRef("audit-trail", `audit-trail:${completedRunId}`),
          createdBy: baseAuth.actorId,
          createdAt: completedValidAt,
        }),
        workItems: [
          {
            schemaVersion: "1",
            workItemRef,
            nodeId: "PN-EXPAND-02",
            spatialScopeRefs: [businessSpatialScopeRef],
            sourceVersionRefs: [sourceA.sourceVersionRef],
            sourceSegmentSetRefs: [sourceA.sourceSegmentSetRef],
            frozenQueryText: "PN-EXPAND-02 冻结查询依据",
          },
        ],
        excludedWorkItems: [],
      },
    });

    const stageBodies = [
      { stage: "I1", body: { stage: "I1", resultKind: "ready", inputSnapshotRef } },
      {
        stage: "I3",
        body: {
          stage: "I3",
          retrievalArtifactSetRefs: [],
          agentTaskRefs: [completedAgentTaskRef],
          failedWorkItemRefs: [],
        },
      },
      {
        stage: "I5",
        body: {
          stage: "I5",
          validatedCandidateSetRef: kindRef(
            "validated-candidate-set",
            `validated-candidate-set:${completedRunId}:PN-EXPAND-02`,
            sha("validated-completed"),
          ),
          reviewTaskRefs: [completedReviewTaskRef],
        },
      },
      {
        stage: "I7",
        body: {
          stage: "I7",
          acceptanceRouteSetRef: routeSetRef,
          reviewTaskRefs: [completedReviewTaskRef],
        },
      },
    ];
    const stageRows = [];
    for (const { stage, body } of stageBodies) {
      const stageResultRef = kindRef(
        "stage-result",
        `stage-result:${completedRunId}:${stage}`,
        sha(`stage-result-completed-${stage}`),
      );
      const artifactRef = await putGraphBody(
        `demo-c33-body-stage-${completedSuffix}-${stage}`,
        {
          bodyKind: "stage-result",
          stageResult: {
            schemaVersion: "1",
            runRef: completedRunRef,
            recordedAt: completedValidAt,
            ...body,
          },
        },
      );
      stageRows.push(
        graphRowFor({
          kind: "stage-result",
          suffix: `completed-stage-${stage}`,
          runId: completedRunId,
          runVersionId: completedRunVersionId,
          artifactRef,
          validAt: completedValidAt,
          resultId: stageResultRef.reference.entityId,
          workPlanRef,
          stageResultRef,
        }),
      );
    }

    // 验收路由集正文走 C04（C22 写入语义），登记行走既有 C22 适配器。
    const routeSet = AcceptanceRouteSetV1Schema.parse({
      schemaVersion: "1",
      projectId: PROJECT_ID,
      workPlanRef,
      identificationRunRef: completedRunRef,
      inputSnapshotRef,
      policySetRef: kindRef("identification-policy-set", "demo-policy-set"),
      mergePlanRef,
      confidencePolicyRef: versionRef("demo-confidence-policy"),
      forcedReviewPolicyRef: versionRef("demo-forced-review-policy"),
      routes: [
        {
          routeKind: "automatic",
          groupId: "group-accepted",
          groupVersionId: acceptedGroupRef.reference.versionId,
          groupRef: acceptedGroupRef,
          compositeConfidence: confidenceFixture(0.8),
          routeDecisionRef,
        },
        {
          routeKind: "review",
          groupId: "group-reviewed",
          groupVersionId: reviewedGroupRef.reference.versionId,
          groupRef: reviewedGroupRef,
          compositeConfidence: confidenceFixture(0.5),
          reviewTaskRef: completedReviewTaskRef,
          waitingRunRef: completedRunRef,
          validationSnapshotRef: kindRef(
            "validation-snapshot",
            `validation-snapshot:${completedRunId}`,
          ),
          evidenceSnapshotRef: kindRef(
            "evidence-snapshot",
            `evidence-snapshot:${completedRunId}`,
          ),
          reviewPolicyRef: versionRef("demo-review-policy"),
          forcedReviewReasonCode: "below-confidence-threshold",
        },
      ],
      authorizationScopeDigest: scopeDigest,
      authorizationContextRef: baseAuth.authorizationContextRef,
      routedAt: completedValidAt,
    });
    const routeSetAuth = await operatorAuth(
      "demo-c33-route-set",
      "risk-identification.accept-groups",
    );
    const routeSetArtifactRef = await putJson(
      `demo-c33-body-route-set-${completedSuffix}`,
      RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.acceptanceRouteSet,
      routeSet,
      routeSetAuth,
      "risk-identification.finalize",
    );
    const routeSetRow = RiskCandidateFinalizationResultRowV1Schema.parse({
      schemaVersion: "1",
      commandId: "demo-c33-route-set-row",
      projectId: PROJECT_ID,
      resultId: routeSetRef.reference.entityId,
      resultVersionId: routeSetRef.reference.versionId,
      requestDigest: sha("route-set-request-completed"),
      artifactRef: routeSetArtifactRef,
      inputSnapshotRef,
      authorizationScopeDigest: scopeDigest,
      actorRef: baseAuth.actorId,
      authorizationContextRef: baseAuth.authorizationContextRef,
      resultKind: "acceptance-route-set",
      workPlanRef,
      mergePlanRef,
      acceptanceRouteSetRef: routeSetRef,
    });
    await transactionUnit.execute(
      {
        projectId: PROJECT_ID,
        commandKind: "identification.accept-groups",
        commandId: "demo-c33-route-set-row",
        idempotencyKey: "demo-c33-route-set-row",
        payload: { fixture: "合成样本、待甲方复核" },
        actorRef: baseAuth.actorId,
        authorizationContextRef: baseAuth.authorizationContextRef,
        issuedAt: NOW,
      },
      async (context) => {
        const outcome = await finalizationAdapter.registerResults(
          { rows: [routeSetRow], occurredAt: completedValidAt },
          context,
        );
        if (outcome.kind !== "registered") {
          throw new Error("demo fixture route set seeding failed");
        }
        return {
          resultRef: routeSetRef,
          audit: {
            auditEntryId: "demo-c33-route-set-row:audit",
            projectId: PROJECT_ID,
            action: "identification.accept-groups",
            targetRef: routeSetRef,
            actorRef: baseAuth.actorId,
            authorizationContextRef: baseAuth.authorizationContextRef,
            occurredAt: completedValidAt,
            recordedAt: completedValidAt,
            version: routeSetRef.reference,
            commandId: "demo-c33-route-set-row",
            idempotencyKey: "demo-c33-route-set-row",
          },
          events: [],
        };
      },
    );

    // 标准化风险记录：自动路线与人工复核路线各一条，经既有 C22 写入路径入库。
    const insertRecord = async (suffix, input) => {
      const write = StandardizedRiskRecordWriteV1Schema.parse({
        riskRecordId: input.recordRef.reference.entityId,
        versionId: "1",
        riskRecordRef: input.recordRef,
        rowId: `row-${suffix}`,
        idempotencyKey: `identification.accept-groups:${suffix}`,
        requestDigest: sha(`record-request-${suffix}`),
        projectId: PROJECT_ID,
        workPlanRef,
        identificationRunRef: completedRunRef,
        inputSnapshotRef,
        mergePlanRef,
        ...input.decisionRef,
        groupId: input.groupId,
        groupVersionId: input.groupRef.reference.versionId,
        groupRef: input.groupRef,
        representativeCandidateRefs: [
          kindRef(
            "content-artifact",
            `candidate-artifact-${suffix}`,
            `sha256:${sha(`candidate-${suffix}`)}`,
          ),
        ],
        sourceSegmentIds: input.sourceSegmentIds,
        mechanismEntryIds: input.mechanismEntryIds,
        // 空间范围、来源版本与证据并集在登记时定型（schema 要求），取值来自本条记录
        // 自己已登记的资料事实，不按当前资料反推，也不跨记录借用。
        spatialScopeRefs: input.spatialScopeRefs,
        sourceVersionRefs: input.sourceVersionRefs,
        evidenceReferences: input.evidenceReferences,
        authorizationScopeDigest: scopeDigest,
        authorizationContextRef: baseAuth.authorizationContextRef,
        actorRef: baseAuth.actorId,
        commandId: `demo-c33-record-${suffix}`,
        occurredAt: input.occurredAt,
      });
      const envelope = StandardizedRiskRecordEnvelopeSchema.parse({
        riskRecordId: input.recordRef.reference.entityId,
        record: {
          processNodeId: input.processNodeId,
          riskSource: input.riskSource,
          riskFactor: input.riskFactor,
          riskEvent: input.riskEvent,
          riskElementRelations: input.riskElementRelations,
          evidenceLocator: { sourceSegmentId: input.sourceSegmentIds[0] },
          modelConfidence: input.modelConfidence,
        },
        riskMechanismEntryIds: input.mechanismEntryIds,
        sourceIds: input.sourceSegmentIds,
        compositeConfidence: {
          value: input.compositeValue,
          basis: ["model-confidence"],
        },
        version: {
          reference: {
            entityId: input.recordRef.reference.entityId,
            versionId: "1",
          },
          effectivePeriod: { validFrom: input.occurredAt },
          systemTime: { recordedAt: input.occurredAt },
        },
        audit: {
          actorId: baseAuth.actorId,
          action: "identification.accept-groups",
          recordedAt: input.occurredAt,
        },
      });
      const commandId = `demo-c33-record-${suffix}`;
      await transactionUnit.execute(
        {
          projectId: PROJECT_ID,
          commandKind: "identification.accept-groups",
          commandId,
          idempotencyKey: commandId,
          payload: { fixture: "合成样本、待甲方复核", recordIds: [write.riskRecordId] },
          actorRef: baseAuth.actorId,
          authorizationContextRef: baseAuth.authorizationContextRef,
          issuedAt: NOW,
        },
        async (context) => {
          const outcome = await finalizationAdapter.insertRecords(
            { rows: [write], records: [envelope], occurredAt: input.occurredAt },
            context,
          );
          if (outcome.kind !== "inserted") {
            throw new Error(`demo fixture record ${suffix} seeding failed`);
          }
          return {
            resultRef: input.recordRef,
            audit: {
              auditEntryId: `${commandId}:audit`,
              projectId: PROJECT_ID,
              action: "identification.accept-groups",
              targetRef: input.recordRef,
              actorRef: baseAuth.actorId,
              authorizationContextRef: baseAuth.authorizationContextRef,
              occurredAt: input.occurredAt,
              recordedAt: input.occurredAt,
              version: input.recordRef.reference,
              commandId,
              idempotencyKey: commandId,
            },
            events: [],
          };
        },
      );
    };
    await insertRecord("record-auto", {
      recordRef: recordAutoRef,
      decisionRef: { routeDecisionRef },
      groupId: "group-accepted",
      groupRef: acceptedGroupRef,
      processNodeId: "PN-EXPAND-02",
      riskSource: "变径扩挖土仓压力",
      riskFactor: "土仓压力不足",
      riskEvent: "过挖导致地表沉降超限",
      riskElementRelations: [
        { sourceElement: "土仓压力", relation: "诱发", targetElement: "地表沉降" },
      ],
      sourceSegmentIds: [sourceA.segmentIds[0]],
      mechanismEntryIds: ["MEC-VDS-017"],
      spatialScopeRefs: [spatialScopeRef],
      sourceVersionRefs: [sourceA.sourceVersionRef],
      evidenceReferences: [sampleEvidence],
      modelConfidence: 0.8,
      compositeValue: 0.8,
      occurredAt: "2030-06-01T08:10:00.000Z",
    });
    // 第二条记录的人工验收路线 + 证据跨共享/受限两资料（A 段 2 可读、B 段 1 仅脱敏定位）。
    await insertRecord("record-review", {
      recordRef: recordReviewRef,
      decisionRef: { reviewDecisionRef },
      groupId: "group-reviewed",
      groupRef: reviewedGroupRef,
      processNodeId: "PN-EXPAND-03",
      riskSource: "刀盘扩径作业",
      riskFactor: "扩径刀具磨损",
      riskEvent: "刀盘扩径卡顿导致围岩扰动",
      riskElementRelations: [
        { sourceElement: "刀具磨损", relation: "加剧", targetElement: "围岩扰动" },
      ],
      sourceSegmentIds: [sourceA.segmentIds[1], sourceB.segmentIds[0]],
      mechanismEntryIds: ["MEC-VDS-017"],
      spatialScopeRefs: [spatialScopeRef],
      sourceVersionRefs: [sourceA.sourceVersionRef, sourceB.sourceVersionRef],
      evidenceReferences: [
        evidenceFor(sourceA.sourceVersionRef, sourceA.segmentIds[1]),
        evidenceFor(sourceB.sourceVersionRef, sourceB.segmentIds[0]),
      ],
      modelConfidence: 0.55,
      compositeValue: 0.5,
      occurredAt: "2030-06-01T08:20:00.000Z",
    });

    const completedRunStateArtifactRef = await putGraphBody(
      `demo-c33-body-run-state-${completedSuffix}`,
      runStateBody(completedRunId, completedRunVersionId, "I9", "completed", workItemRef, {
        completedWorkItemRefs: [workItemRef],
        pendingWorkItemRefs: [],
        acceptedRiskRecordRefs: [recordAutoRef, recordReviewRef],
        pendingGroupRefs: [],
        rejectedGroupRefs: [rejectedGroupRef],
        acceptedRouteSetRef: routeSetRef,
        resultRef: kindRef(
          "identification-run-result",
          `identification-run-result:${completedRunId}`,
          sha("run-result-completed"),
        ),
      }),
    );
    await registerGraphRows(
      [
        graphRowFor({
          kind: "work-plan",
          suffix: "completed-plan",
          runId: completedRunId,
          runVersionId: completedRunVersionId,
          artifactRef: planArtifactRef,
          validAt: completedValidAt,
          resultId: workPlanRef.reference.entityId,
          workPlanRef,
          inputSnapshotRef,
        }),
        ...stageRows,
        graphRowFor({
          kind: "run-state",
          suffix: "completed-run-state",
          runId: completedRunId,
          runVersionId: completedRunVersionId,
          artifactRef: completedRunStateArtifactRef,
          validAt: completedValidAt,
          resultId: "result-run-state-completed",
        }),
      ],
      "demo-c33-register-completed",
    );

    // 等待复核运行（I5 暂停，指向待决定复核任务）与可重试失败运行（I3 基础设施失败）。
    const waitingWorkItemRef = kindRef(
      "identification-work-item",
      `identification-work-item:${waitingRunId}:PN-EXPAND-02`,
      sha("work-item-request-waiting"),
    );
    const waitingArtifactRef = await putGraphBody(
      "demo-c33-body-run-state-waiting",
      runStateBody(waitingRunId, waitingRunVersionId, "I5", "waiting", waitingWorkItemRef, {
        pendingGroupRefs: [waitingPendingGroupRef],
        lastWaitingRef: {
          kind: "human-review",
          reviewTaskRef: pendingTaskRef,
          groupRef: waitingPendingGroupRef,
        },
      }),
    );
    await registerGraphRows(
      [
        graphRowFor({
          kind: "run-state",
          suffix: "run-state-waiting",
          runId: waitingRunId,
          runVersionId: waitingRunVersionId,
          artifactRef: waitingArtifactRef,
          validAt: "2030-06-01T09:00:00.000Z",
          resultId: "result-run-state-waiting",
        }),
      ],
      "demo-c33-register-waiting",
    );
    const failedRunId = runIdFor("failed");
    const failedRunVersionId = runVersionFor("failed");
    const failedArtifactRef = await putGraphBody(
      "demo-c33-body-run-state-failed",
      runStateBody(
        failedRunId,
        failedRunVersionId,
        "I3",
        "retryable-failure",
        kindRef(
          "identification-work-item",
          `identification-work-item:${failedRunId}:PN-EXPAND-02`,
          sha("work-item-request-failed"),
        ),
        {
          lastErrorRef: kindRef(
            "workflow-error",
            "identification-graph-workflow-error:I3:RETRYABLE_INFRASTRUCTURE_FAILURE",
            "v1",
          ),
        },
      ),
    );
    await registerGraphRows(
      [
        graphRowFor({
          kind: "run-state",
          suffix: "run-state-failed",
          runId: failedRunId,
          runVersionId: failedRunVersionId,
          artifactRef: failedArtifactRef,
          validAt: "2030-06-01T10:00:00.000Z",
          resultId: "result-run-state-failed",
        }),
      ],
      "demo-c33-register-failed",
    );

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
      // 真实 C22 窄读：投影的追溯链/关联图/总览在补证据定位时经它复验授权并对账范围摘要。
      riskRecordTrace: createPostgresRiskRecordTraceReader({
        db: appRuntime.db,
        authorization: access,
      }),
    });

    // C33 追溯链边播种：记录 → 评估 → 预警 → 处置 → 偏差 → 校准（真实登记行；
    // 读取仍受投影复验接缝约束，未通过复验时页面失败闭合）。投影按查询登记时点截断
    // 已成立事实，夹具事实的登记时点必须早于页面真实请求时点，故不用未来时钟 NOW。
    const chainRecordedAt = "2026-06-01T00:00:00.000Z";
    const registerProjectionLink = async (linkSuffix, fromRef, toRef, relation, sourceStage) => {
      const commandId = `demo-c33-link-${linkSuffix}`;
      await transactionUnit.execute(
        {
          projectId: PROJECT_ID,
          commandKind: "workflow.register-link",
          commandId,
          idempotencyKey: commandId,
          payload: { linkId: linkSuffix, fixture: "合成样本、待甲方复核" },
          actorRef: baseAuth.actorId,
          authorizationContextRef: baseAuth.authorizationContextRef,
          issuedAt: NOW,
          runId: completedRunId,
        },
        async (context) => {
          await workflow.registrationStore.registerLink(
            {
              link: {
                schemaVersion: "1",
                projectId: PROJECT_ID,
                linkId: `demo-c33-link-${linkSuffix}`,
                runId: completedRunId,
                fromRef,
                toRef,
                relation,
                sourceStage,
                stageResultRef: {
                  kind: "stage-result",
                  reference: { entityId: `${linkSuffix}:stage`, versionId: "1" },
                },
                authorizationContextRef: baseAuth.authorizationContextRef,
                authorizationScopeDigest: scopeDigest,
                actorRef: baseAuth.actorId,
                recordedAt: chainRecordedAt,
                auditEntryId: `${commandId}:audit`,
              },
            },
            context,
          );
          return {
            resultRef: completedRunRef,
            audit: {
              auditEntryId: `${commandId}:audit`,
              projectId: PROJECT_ID,
              action: "workflow.register-link",
              targetRef: completedRunRef,
              actorRef: baseAuth.actorId,
              authorizationContextRef: baseAuth.authorizationContextRef,
              occurredAt: NOW,
              recordedAt: NOW,
              version: completedRunRef.reference,
              commandId,
              idempotencyKey: commandId,
              runId: completedRunId,
            },
            events: [],
          };
        },
      );
    };
    const chainRef = (kind, entityId) => kindRef(kind, entityId, "1");
    const assessmentRef = chainRef(
      "risk-assessment-record",
      `risk-assessment-record:${completedRunId}:1`,
    );
    const warningRef = chainRef("warning-record", `warning-record:${completedRunId}:1`);
    const recommendationRef = chainRef(
      "response-recommendation",
      `response-recommendation:${completedRunId}:1`,
    );
    const deviationRef = chainRef("deviation-record", `deviation-record:${completedRunId}:1`);
    const calibrationRef = chainRef(
      "calibration-suggestion",
      `calibration-suggestion:${completedRunId}:1`,
    );
    await registerProjectionLink(
      "risk-assessment",
      recordAutoRef,
      assessmentRef,
      "risk-assessment",
      "assessment",
    );
    await registerProjectionLink(
      "assessment-warning",
      assessmentRef,
      warningRef,
      "assessment-warning",
      "assessment",
    );
    await registerProjectionLink(
      "warning-recommendation",
      warningRef,
      recommendationRef,
      "warning-recommendation",
      "assessment",
    );
    await registerProjectionLink(
      "feedback-deviation",
      recommendationRef,
      deviationRef,
      "feedback-deviation",
      "assessment",
    );
    await registerProjectionLink(
      "deviation-calibration",
      deviationRef,
      calibrationRef,
      "deviation-calibration",
      "assessment",
    );

    // 链运行登记行播种（fix-projection-reverification-identity-seam IP-06）：risk-overview
    // 正向读取要求同一运行既有 entry-snapshot 行（冻结引用覆盖工程修订），又有带 C04 正文的
    // run-state 行；登记时点同样必须早于页面真实请求时点。
    const chainRunId = `risk-flow-run:${PROJECT_ID}:chain`;
    const chainRunVersionId = sha("c33-chain-run-version");
    const chainRunRef = kindRef("workflow-run", chainRunId, chainRunVersionId);
    const chainEntryIdentity = {
      entityId: `workflow-entry:${PROJECT_ID}:identify-and-assess`,
      versionId: "entry-v1",
    };
    const chainFrozenRefs = [projectRevisionRef, spatialScopeRef];
    const chainStateArtifactId = `c33-chain-run-state:${chainRunId}:${chainRunVersionId}`;
    // C30 正文写入与生产读侧共用同一 body-write 派生调用身份（真实授权接缝）。
    const chainBodyAuth = await operatorAuth(
      workflowGraphReadInvocationIdV1({
        operation: "body-write",
        projectId: PROJECT_ID,
        targetId: chainStateArtifactId,
      }),
      "workflow.start-run",
    );
    const chainStateArtifactRef = await workflow.bodies.putBody({
      projectId: PROJECT_ID,
      actorId: chainBodyAuth.actorId,
      commandId: "demo-c33-chain-body-run-state",
      issuedAt: chainRecordedAt,
      artifactId: chainStateArtifactId,
      body: WorkflowGraphArtifactBodyV1Schema.parse({
        bodyKind: "run-state",
        runState: {
          schemaVersion: "1",
          projectId: PROJECT_ID,
          runId: chainRunId,
          runVersionId: chainRunVersionId,
          entryMode: "identify-and-assess",
          entryIdentity: chainEntryIdentity,
          stage: "result-summary",
          status: "completed",
          parentRunRef: completedRunRef,
          assessmentRunRefs: [],
          acceptedRiskRecordRefs: [recordAutoRef, recordReviewRef],
          assessmentRecordRefs: [assessmentRef],
          warningRecordRefs: [warningRef],
          responseRecommendationRefs: [recommendationRef],
          deviationRecordRefs: [deviationRef],
          calibrationSuggestionRefs: [calibrationRef],
          recordedAt: chainRecordedAt,
        },
      }),
      authorization: chainBodyAuth,
    });
    const chainRowBase = (rowSuffix) => ({
      schemaVersion: "1",
      projectId: PROJECT_ID,
      resultId: `${chainRunId}:${rowSuffix}`,
      resultVersionId: sha(`c33-chain-result-${rowSuffix}`),
      runId: chainRunId,
      runVersionId: chainRunVersionId,
      entryMode: "identify-and-assess",
      commandId: `demo-c33-chain-${rowSuffix}`,
      idempotencyKey: `demo-c33-chain-${rowSuffix}`,
      requestDigest: sha(`demo-c33-chain-request-${rowSuffix}`),
      actorRef: baseAuth.actorId,
      authorizationContextRef: baseAuth.authorizationContextRef,
      authorizationScopeDigest: scopeDigest,
      validAt: chainRecordedAt,
      recordedAt: chainRecordedAt,
      persistedAt: chainRecordedAt,
      auditEntryId: `demo-c33-chain-${rowSuffix}:audit`,
      frozenRefs: chainFrozenRefs,
    });
    const registerChainRow = async (row) => {
      const commandId = row.commandId;
      await transactionUnit.execute(
        {
          projectId: PROJECT_ID,
          commandKind: "workflow.register-row",
          commandId,
          idempotencyKey: row.idempotencyKey,
          payload: { resultId: row.resultId, fixture: "合成样本、待甲方复核" },
          actorRef: baseAuth.actorId,
          authorizationContextRef: baseAuth.authorizationContextRef,
          issuedAt: chainRecordedAt,
          runId: chainRunId,
        },
        async (context) => {
          await workflow.registrationStore.registerRow(
            { row, occurredAt: chainRecordedAt },
            context,
          );
          return {
            resultRef: chainRunRef,
            audit: {
              auditEntryId: row.auditEntryId,
              projectId: PROJECT_ID,
              action: "workflow.register-row",
              targetRef: chainRunRef,
              actorRef: baseAuth.actorId,
              authorizationContextRef: baseAuth.authorizationContextRef,
              occurredAt: chainRecordedAt,
              recordedAt: chainRecordedAt,
              version: chainRunRef.reference,
              commandId,
              idempotencyKey: commandId,
              runId: chainRunId,
            },
            events: [],
          };
        },
      );
    };
    await registerChainRow(
      WorkflowGraphResultRowV1Schema.parse({
        ...chainRowBase("entry-snapshot"),
        resultKind: "entry-snapshot",
        stage: "preparing",
        entryIdentity: chainEntryIdentity,
      }),
    );
    await registerChainRow(
      WorkflowGraphResultRowV1Schema.parse({
        ...chainRowBase("run-state"),
        resultKind: "run-state",
        resultVersionId: chainRunVersionId,
        stage: "result-summary",
        artifactRef: chainStateArtifactRef,
      }),
    );
    const freePort = await new Promise((resolved, rejected) => {
      const probe = createServer();
      probe.once("error", rejected);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        probe.close(() => resolved(address.port));
      });
    });
    const publicOrigin = `http://127.0.0.1:${freePort}`;

    // ---- C34 评估只读（design D-04）：C25 引擎 + 全部真实接缝 ----
    //
    // C34 八条只读分支只用到 recordCatalog/entryContext/entriesRead/runRead 四个接缝，
    // 其余接缝属于评估执行（写）路径，本装配不提供，也不会为读面伪造结果。
    const identificationRead = createPostgresRiskIdentificationReadAdapter({
      db: appRuntime.db,
      artifactStore,
      authorization: access,
    });

    const assessmentEngine = createPostgresRiskAssessmentEngine({
      db: appRuntime.db,
      transactionUnit,
      access,
      artifactStore,
      preparationContext: registry,
      riskInputFacts,
      basisReader: unwiredWritePathSeam("basisReader"),
      runtimePolicies: createRiskAssessmentRuntimePolicies({ projectId: PROJECT_ID }),
      monitoring: monitoringStore,
      authorizeDownstream,
      entryContext: createAssessmentEntryContextReadPort(registry),
      runRead: workflow.runRead,
      entriesRead: workflow.entriesRead,
      recordCatalog: identificationRead,
    });

    // ---- C34 处置只读（design D-05）：C27→C28→C29→C41→C26 的组合窄读 ----
    //
    // 五者的 C34 读视图只消费 db 与 C06 授权复验；策略、证明、图执行器等写路径接缝
    // 一律显式未接线——它们属于处置写入，不在本装配的读取面内。
    const recommendation = createPostgresRecommendationAdapter({
      db: appRuntime.db,
      transactionUnit,
      access,
      artifactStore,
      reader: unwiredWritePathSeam("recommendationReader"),
      policies: createRecommendationPolicies({
        projectId: PROJECT_ID,
        // 生成策略按已入库的风险记录绑定风险事件分类；演示只登记自动路线那条。
        bindings: [
          {
            riskInputRef: {
              kind: "standardized-risk-record",
              reference: { entityId: recordAutoRef.reference.entityId, versionId: "1" },
            },
            riskEventCategory: "地表沉降超限",
          },
        ],
        targetIndicators: [{ indicatorItem: "地表沉降", targetValue: 10 }],
        reviewedStandardEvidence: [{ measureId: "MS-001", evidenceItem: "监测日报" }],
      }),
      agentTasks: unwiredWritePathSeam("recommendationAgentTasks"),
    });
    /**
     * C28 生产预测执行器：按已发布 C18 策略的唯一 requiredRef 装配，
     * 模型正文只经 C04 受权读取，风险状态只经 C25 只读投影重算。
     * 不下发命令能力；两个读取分支在各自 branch 上以调用者身份另取读取能力。
     */
    const forecastExecutors = createProductionEffectForecastExecutorsV1({
      policies: DEMO_FORECAST_POLICIES,
      models: createEffectForecastModelReaderV1({ artifactStore }),
      assessment: assessmentEngine,
      authorizeDownstream,
    });
    const responseLifecycle = createPostgresResponseLifecycleAdapter({
      db: appRuntime.db,
      transactionUnit,
      access,
      reader: unwiredWritePathSeam("responseLifecycleReader"),
      forecastExecutors,
    });
    const calibration = createPostgresCalibrationAdapter({
      db: appRuntime.db,
      transactionUnit,
      access,
      deviationFacts: responseLifecycle,
      inputSnapshots: assessmentEngine,
      basis: unwiredWritePathSeam("calibrationBasis"),
      artifactStore,
      agentResults: unwiredWritePathSeam("calibrationAgentResults"),
      reviews: unwiredWritePathSeam("calibrationReviews"),
      governance: unwiredWritePathSeam("calibrationGovernance"),
      authorizeDownstream,
    });
    const humanDecisionFeedback = createPostgresHumanDecisionFeedbackAdapter({
      db: appRuntime.db,
      transactionUnit,
      access,
      authorizeDownstream,
      workflow: unwiredWritePathSeam("humanDecisionWorkflow"),
      bindingProof: workflow.bindingProof,
      assessmentProof: assessmentEngine,
      runCompletionProof: workflow.runCompletionProof,
      responseLifecycle,
      responseContext: unwiredWritePathSeam("humanDecisionResponseContext"),
      workflowStartControl: unwiredWritePathSeam("humanDecisionWorkflowStartControl"),
    });
    const warningLifecycle = createPostgresWarningLifecycleAdapter({
      db: appRuntime.db,
      transactionUnit,
      access,
      assessmentContext: new PostgresWarningAssessmentContextReader({ db: appRuntime.db }),
      runtimePolicies: createWarningRuntimePolicies({
        projectId: PROJECT_ID,
        // 通知接收主体取已登录账号的精确账户引用；不从用户名或文案推断主体。
        recipientActorIds: [
          operatorSession.accountRef.entityId,
          responderSession.accountRef.entityId,
          viewerSession.accountRef.entityId,
        ],
        responseDirectionByTriggerType: {
          风险等级超过风险可接受阈值: "评估并制定处置方案",
          监测指标越限: "加密监测并复核处置范围",
          "趋势/加速度/异常评分越限": "趋势复核与现场核查",
          多指标联合规则命中: "联合规则专项处置",
        },
      }),
      authorizeDownstream,
      recommendations: recommendation,
      routeDecisions: humanDecisionFeedback,
      lifecycle: responseLifecycle,
      calibration,
    });

    const api = buildApi({
      access,
      ports: {
        riskAssessmentRead: assessmentEngine,
        warningResponseRead: warningLifecycle,
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
        riskIdentificationRead: identificationRead,
        reviewQueueRead: createPostgresReviewQueueReadAdapter({
          db: appRuntime.db,
          authorization: access,
        }),
        reviewAudit,
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
      "/overview",
      "/login",
      "/change-password",
      "/project",
      "/project/documents",
      "/project/monitoring",
      "/identification",
      "/identification/records",
      "/identification/graph",
      "/identification/process-model",
      "/assessment",
      "/assessment/start",
      "/assessment/records",
      "/assessment/matrix",
      "/assessment/reassessments",
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
    for (const prefix of [
      "/project",
      "/identification",
      "/assessment",
      "/warnings",
      "/response",
      "/risks",
    ]) {
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
      /** 受限账号：初始密码即通用初始密码，改密后另有其密码。 */
      restrictedLogin: RESTRICTED_LOGIN,
      restrictedAccountPassword: ACCOUNT_PASSWORD,
      restrictedPasswordChanged: RESTRICTED_PASSWORD_CHANGED,
      accountPassword: ACCOUNT_PASSWORD_CHANGED,
      seriesEntityId: seriesRef.reference.entityId,
      sourceAVersionEntityId: sourceA.sourceVersionRef.reference.entityId,
      sourceBVersionEntityId: sourceB.sourceVersionRef.reference.entityId,
      relationshipResult: {
        entityId: relationshipResultRef.reference.entityId,
        versionId: relationshipResultRef.reference.versionId,
      },
      identification: {
        completedRunId,
        waitingRunId,
        failedRunId,
        chainRunId,
        recordAutoId: recordAutoRef.reference.entityId,
        recordReviewId: recordReviewRef.reference.entityId,
        pendingTask: pendingTaskRef,
        staleTask: staleTaskRefV1,
        freshTask: freshTaskRefV2,
        batchTasks: [batchTaskRef1, batchTaskRef2],
        viewerTask: viewerTaskRef,
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
