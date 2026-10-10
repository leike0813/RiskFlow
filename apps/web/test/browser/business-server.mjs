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

import { buildApi } from "../../../../apps/api/dist/index.js";
import {
  bootstrapInitialSystemAdministrator,
  createPostgresLocalIdentityAccess,
} from "../../../../packages/adapters/dist/auth/index.js";
import { createContentAddressedArtifactStore } from "../../../../packages/adapters/dist/artifacts/index.js";
import { createPostgresEngineeringDataCatalogAdapter } from "../../../../packages/adapters/dist/engineering-data/catalog/index.js";
import {
  createAssessmentEntryContextReadPort,
  createPostgresEngineeringContextSourceRegistry,
} from "../../../../packages/adapters/dist/engineering-data/context-source/index.js";
import { createPostgresMonitoringStore } from "../../../../packages/adapters/dist/engineering-data/monitoring/index.js";
import {
  createPostgresRiskCandidateFinalizationAdapter,
  createPostgresRiskRecordTraceReader,
} from "../../../../packages/adapters/dist/identification/candidate-finalization/index.js";
import {
  PostgresIdentificationContextAdapter,
  PostgresOfficialHybridResultReader,
  createPostgresKnowledgeRetrievalReadAdapter,
} from "../../../../packages/adapters/dist/identification/context/index.js";
import {
  createPostgresIdentificationGraphAdapter,
  identificationGraphReadInvocationIdV1,
} from "../../../../packages/adapters/dist/identification/graph/index.js";
import { createPostgresRiskIdentificationReadAdapter } from "../../../../packages/adapters/dist/identification/read/index.js";
import {
  PostgresKnowledgeGovernanceAdapter,
  governedReleaseResolutionInvocationId,
  createPostgresKnowledgeGovernanceReadAdapter,
} from "../../../../packages/adapters/dist/knowledge-governance/index.js";
import { createPostgresAssessmentConfigurationAdapter } from "../../../../packages/adapters/dist/assessment-config/index.js";
import { createPostgresScoringRulesAdapter } from "../../../../packages/adapters/dist/scoring-rules/index.js";
import { createAssessmentGraphComposition } from "../../../../apps/worker/dist/assessment/index.js";
import { createRiskFlowGraphComposition } from "../../../../apps/worker/dist/risk-flow/index.js";
import { createPostgresDataCleaningComposition } from "../../../../apps/worker/dist/engineering-data/cleaning/index.js";
import { createStructuredDocumentConversionAdapter } from "../../../../packages/adapters/dist/engineering-data/document-conversion/index.js";
import {
  bootstrapPostgresFoundation,
  createPostgresTransactionUnit,
  runPostgresMigrations,
  setupPostgresCheckpointer,
} from "../../../../packages/adapters/dist/postgres/index.js";
import { createPostgresRuntime } from "../../../../packages/adapters/dist/postgres/pool.js";
import { PostgresRetrievalAdapter } from "../../../../packages/adapters/dist/retrieval/index.js";
import { createPostgresRiskAssessmentEngine } from "../../../../packages/adapters/dist/risk-assessment/engine/index.js";
import { createPostgresStandardizedRiskInputFactsReader } from "../../../../packages/adapters/dist/identification/read/index.js";
import { createPostgresExternalRiskInputFactsReader } from "../../../../packages/adapters/dist/engineering-data/context-source/index.js";
import { createRiskInputFactsReader } from "../../../../packages/core/dist/risk-assessment/engine/index.js";
import {
  CALIBRATION_VALIDATION_POLICY,
  DEMO_FORECAST_POLICIES,
  DEMO_RISK_FLOW_CONFIG,
  createRecommendationPolicies,
  createResponseAgentPolicy,
  createScoringRulesPolicy,
  createRiskFlowRetryPolicyReader,
  createRiskAssessmentRuntimePolicies,
  createWarningRuntimePolicies,
  createAssessmentPolicyCatalog,
  makeDemoAssessmentConfigurationDocuments,
  DEMO_CONFIGURATION_SET_REF,
  POSSIBILITY_DEMO_INDICATOR_ID,
  SETTLEMENT_SLOPE_DEMO_INDICATOR_ID,
  DEMO_CONFIGURATION_INDICATOR_IDS,
  DEMO_MEASURE_IDS,
  DEMO_CALIBRATION_EVIDENCE,
  DEMO_CALIBRATION_OPERATIONS,
  DEMO_MODEL_DEPLOYMENTS,
  DEMO_REPORT_EXPORT_POLICY,
} from "./deploymentPolicies.mjs";
import {
  PostgresWarningAssessmentContextReader,
  createPostgresWarningLifecycleAdapter,
} from "../../../../packages/adapters/dist/warning/index.js";
import {
  PostgresRecommendationContextReader,
  createPostgresRecommendationAdapter,
} from "../../../../packages/adapters/dist/recommendation/index.js";
import { PostgresAgentTaskAdapter } from "../../../../packages/adapters/dist/agent-runtime/index.js";
import { AgentTaskDefinitionRegistry } from "../../../../packages/core/dist/agent-runtime/runtime.js";
import {
  AgentCandidateVersionV1Schema,
  AgentValidationResultV1Schema,
  emptyAgentBudgetUsage,
} from "../../../../packages/core/dist/agent-runtime/schema.js";
import {
  createResponseRecommendationTaskDefinition,
  ResponseRecommendationIncrementV1Schema,
} from "../../../../packages/core/dist/recommendation/index.js";
import {
  CalibrationCandidateV1Schema,
  createCalibrationSuggestionTaskDefinition,
} from "../../../../packages/core/dist/calibration/index.js";
import {
  buildCompletedAgentTaskResult,
  makeAgentError,
} from "../../../../packages/core/dist/agent-runtime/runtime.js";
import { createScoringRuleAuthoringTaskDefinition } from "../../../../packages/core/dist/scoring-rules/index.js";
import {
  KnowledgeGovernanceCommandV1Schema,
  StartAgentTaskCommandV1Schema,
} from "../../../../packages/contracts/dist/ports/index.js";
import {
  createEffectForecastModelReaderV1,
  createPostgresResponseLifecycleAdapter,
  createPostgresResponseLifecycleContextReader,
  createProductionEffectForecastExecutorsV1,
} from "../../../../packages/adapters/dist/response-lifecycle/index.js";
import { EFFECT_FORECAST_MODEL_PURPOSE_CODE_V1 } from "../../../../packages/core/dist/response-lifecycle/index.js";
import { createPostgresCalibrationAdapter } from "../../../../packages/adapters/dist/calibration/index.js";
import { createPostgresHumanDecisionFeedbackAdapter } from "../../../../packages/adapters/dist/human-decision-feedback/index.js";
import {
  createPostgresReviewAuditAdapter,
  createPostgresReviewAuditRead,
  createPostgresReviewQueueReadAdapter,
} from "../../../../packages/adapters/dist/review-audit/index.js";
import {
  createPostgresReportExport,
  createPostgresWorkflowAdapter,
  createPostgresWorkflowProjection,
} from "../../../../packages/adapters/dist/workflow/index.js";
import { parseLlamaCppDeploymentConfig } from "../../../../packages/adapters/dist/model/index.js";
import {
  collectSystemOperationsHealth,
  SYSTEM_OPERATIONS_REASON_CODES_V1,
} from "../../../../apps/api/dist/index.js";
import { ArtifactPutCommandV1Schema } from "../../../../packages/core/dist/artifacts/index.js";
import { isAuthorizationSubset } from "../../../../packages/core/dist/access/index.js";
import {
  AcceptanceRouteSetV1Schema,
  RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1,
  RiskCandidateFinalizationResultRowV1Schema,
  StandardizedRiskRecordWriteV1Schema,
} from "../../../../packages/core/dist/identification/candidate-finalization/index.js";
import {
  IdentificationGraphArtifactBodyV1Schema,
  IdentificationGraphResultRowV1Schema,
  IdentificationGraphRunStateV1Schema,
} from "../../../../packages/core/dist/identification/graph/index.js";
import { authorizationScopeDigest } from "../../../../packages/core/dist/retrieval/index.js";
import {
  WorkflowGraphArtifactBodyV1Schema,
  WorkflowGraphResultRowV1Schema,
} from "../../../../packages/core/dist/workflow/index.js";
import { StandardizedRiskRecordEnvelopeSchema } from "../../../../packages/contracts/dist/records/index.js";
import { IdentificationInputSnapshotV1Schema } from "../../../../packages/contracts/dist/workflows/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, "../../../..");
const WEB_DIST = resolve(REPOSITORY_ROOT, "apps/web/dist");
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
/** 只读验收账号的成员标识：撤权场景按同一成员改状态，不另建账号。 */
const VIEWER_MEMBERSHIP_ID = "demo-browser-viewer-membership";
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

/**
 * C28 读取人工反馈文档时校验的用途码。
 *
 * 该常量目前只定义在 `postgres-response-lifecycle-adapter.ts` 内部、未从包导出；
 * 装配侧必须与读侧逐字一致，否则 C28 会在记录反馈时以工件用途码不符关闭失败。
 */
const FEEDBACK_ARTIFACT_PURPOSE_CODE_V1 = "warning-response.feedback-artifact";

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

/**
 * 未启用的版本化配置接缝：返回抛错的 Proxy，任何属性读取都立即失败。
 *
 * 与「返回 undefined / 空对象」的区别是——空配置会让下游安静地按「没有策略」运行，
 * 把未编制成功伪装成已配置。这里宁可炸也不静默降级。
 */
// 刻意保留：任何未编制成功的能力一旦被读取就抛错，不静默降级。
const unwiredConfigSeam = (label) =>
  new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(`版本化配置接缝未在演示装配中登记：${label}.${String(property)}`);
      },
      has() {
        throw new Error(`版本化配置接缝未在演示装配中登记：${label}`);
      },
    },
  );
// 本装配不消费该接缝；显式标注避免被误当成已接线能力。
void unwiredConfigSeam;

/**
 * 本装配真实注册进各 C08 注册表的任务定义（合成样本、待甲方复核）。
 *
 * 三个 C08 组合根各自持有一个注册表，运维面的模型版本读要跨表列任务类型，因此这里
 * 收集的是同一批定义对象本身——不是另抄一份元数据。少登记的定义就少列一行，不会补。
 */
const registeredAgentTaskDefinitions = [];

/**
 * 启动真实服务：PostgreSQL + 生产迁移 + C04/C03/C06 组合 + C32 四条只读端口 + demo 生产构建。
 * 环境不可用时抛错，调用方必须让验收失败而不是跳过。
 */
export const startBusinessBrowserServer = async ({ riskLevelOnly = false } = {}) => {
  if (!existsSync(WEB_DIST)) throw new Error(`apps/web production build is missing: ${WEB_DIST}`);
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
    /**
     * 主体 → 真实会话令牌。C35 报告导出的配对结果读上下文必须由组合根按请求主体重新向 C06
     * 申请（C06 不允许把 `projection.export` 上下文在模块内收窄），因此装配根得知道每个
     * 已登录主体的真实会话；未在此登记的主体就没有导出能力，而不是借用别人的会话。
     */
    const sessionTokensByAccountId = new Map();
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
      const session = {
        ...changed,
        accountRef: initial.accountRef,
        sessionToken: changed.sessionToken,
      };
      sessionTokensByAccountId.set(session.accountRef.entityId, session.sessionToken);
      return session;
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
    /** 运维健康窄探针的授权身份。 */
    const probeAuth = (invocationId, branch, sourceVersionRefs = []) =>
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
    /**
     * 按原始字节放工件：结构化文档转换（C12）要读真实正文，不能拿 JSON 顶替。
     * 与 `putJson` 共用同一套访问快照字段，只让正文与媒体类型由调用方给定。
     */
    const putBody = async (
      artifactId,
      purposeCode,
      bytes,
      mediaType,
      authorization,
      requiredCapability,
    ) => {
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
          mediaType,
          parentArtifactRefs: [],
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        (async function* () {
          yield bytes;
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

    // ---- C15 数据清洗与 C12 结构化文档转换（IP-12：C19 编制的上游来源）----
    //
    // C19 编制硬依赖一条已收口的 C08 清洗任务（`scoring-rule-source-unavailable`），
    // 而清洗又硬依赖资料先经 C12 转换。两者都装配产品侧组合根：冻结、解析、任务创建、
    // 增量校验与收口全部走生产代码，本装配只给部署策略数据与受信调用来源。
    // 策略是部署数据而非行为，按已验证形态给定（合成样本、待甲方复核）。
    const conversionPolicyRef = versionRef("demo-c12-conversion-policy", "1");
    const conversionQualityPolicyRef = versionRef("demo-c12-quality-policy", "1");
    const conversionDeploymentRef = versionRef("demo-c12-converter-deployment", "1");
    const cleaningPolicyRef = versionRef("demo-c15-data-processing-policy", "1");
    const cleaningBudgetPolicyRef = versionRef("demo-c15-budget-policy", "1");
    const cleaningPolicy = {
      schemaVersion: "1",
      policyRef: cleaningPolicyRef,
      // 三个允许列表必须与 C12 转换命令逐字对齐，否则清洗取不到转换记录。
      allowedConversionPolicyRefs: [conversionPolicyRef],
      allowedQualityPolicyRefs: [conversionQualityPolicyRef],
      allowedConverterDeploymentRefs: [conversionDeploymentRef],
      allowedExclusionReasonCodes: ["demo-c15-manual-exclusion"],
      protectedSegmentKinds: [],
      // 内置 CSV 解析器产出 table/record/cell/paragraph 段；必含种类取 table。
      requiredSegmentKinds: ["table"],
      protectedMonitoringSelectionReasons: ["latest-valid", "correction"],
      minimumRetainedSegmentRatio: 0.5,
      minimumRetainedSampleRatio: 0.5,
      minimumDocumentCoverageRatio: 0.5,
      tools: {
        documentSegmentToolRef: versionRef("demo-c15-document-segment-tool", "1"),
        monitoringSnapshotToolRef: versionRef("demo-c15-monitoring-snapshot-tool", "1"),
        maxSegmentsPerRead: 8,
        maxMonitoringItemsPerRead: 8,
      },
      agent: {
        definitionRef: versionRef("demo-c15-cleaning-definition", "1"),
        modelDeploymentRef: versionRef("demo-c15-cleaning-model", "1"),
        promptTemplateRef: versionRef("demo-c15-cleaning-prompt", "1"),
        toolPolicyRef: versionRef("demo-c15-cleaning-tools", "1"),
        budgetPolicyRef: cleaningBudgetPolicyRef,
        incrementSchemaRef: versionRef("demo-c15-cleaning-increment", "1"),
        validationPolicyRef: versionRef("demo-c15-cleaning-validation", "1"),
        budgetPolicy: {
          schemaVersion: "1",
          policyRef: cleaningBudgetPolicyRef,
          modelDeploymentRef: versionRef("demo-c15-cleaning-model", "1"),
          promptTemplateRef: versionRef("demo-c15-cleaning-prompt", "1"),
          toolPolicyRef: versionRef("demo-c15-cleaning-tools", "1"),
          maxModelInvocations: 4,
          maxToolInvocations: 8,
          maxContextTokens: 4_096,
          maxInputBytes: 262_144,
          maxOutputBytes: 262_144,
          maxCandidates: 2,
          maxObjects: 32,
          maxSupplementarySearches: 2,
          maxCorrections: 2,
          maxTransientRetries: 1,
          maxConcurrentActions: 1,
          maxWallClockMs: 600_000,
        },
      },
    };
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
      // C11 冻结内部的下游读取（C25 风险输入事实、C19 依据成员）按 branch 另签精确上下文；
      // 闭包在首次调用时才求值，避开与本块之后的 operator 会话/空间身份定义的顺序依赖。
      authorizeDownstream: (request) => authorizeDownstream(request),
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
     * 下游上下文默认请求的来源版本：operator 在本工程共享的资料（资料 A 与 C12 转换来源）。
     *
     * 不带来源授权签发的上下文，其 `sourceAccessGrantRefs` 为空；下游按记录真实资料版本
     * 复验时（阶段二 `verifyScope`）解析出的来源授权不在该上下文之内，C06 会以
     * `verify.narrowing` 拒绝它自己签发的上下文。C08 任务信封同属这一类：它在
     * `recordCandidate`/`completeTask` 时按任务产出的工件访问快照复验，而那份快照继承自
     * 配置文档的来源授权，所以启动上下文与 `taskAuthorization` 必须请求同一份来源集。
     * 资料 B 仅系统管理员可见，不在此列。
     * 先声明、登记完成后填充：签发接缝必须晚于资料登记才有可请求的来源。
     */
    const downstreamSourceVersionRefs = [];
    /**
     * 演示账号会话索引：按 accountId 找到该账号自己的会话。
     *
     * 下游签发必须用**请求者自己的**会话。若一律用 operator 会话签发，签出的上下文里
     * actorId 是 operator，而调用点仍以真实请求者发起读取，C04 会因为上下文主体与请求
     * 主体不一致关闭失败——现象是 operator 什么都能读、其他角色一律读不到正文。
     * 该索引也让「谁读」和「以什么身份读」保持同一事实，不在 harness 里洗身份。
     */
    const sessionsByAccountId = new Map(
      [operatorSession, viewerSession, responderSession].map((session) => [
        session.accountRef.entityId,
        session.sessionToken,
      ]),
    );
    /**
     * C25/C26/C29 共用的真实 C06 下游签发接缝（design D-06）。
     *
     * 按调用方请求的精确 branch 逐次签发，不合并能力也不裁剪：请求什么 branch 就签什么，
     * 绑定不符时 C06 自己关闭失败。空间范围必须显式给出——human-session 路径不回填父
     * 上下文范围，漏传会让下游上下文范围为空而不是全工程。请求者不在演示账号索引内时
     * 关闭失败，由调用方回落到自己的上下文，不代签成 operator。
     */
    const authorizeDownstream = async (request) => {
      const sessionToken = sessionsByAccountId.get(request.actorId);
      if (sessionToken === undefined) {
        throw new Error(`no demo session for actor ${request.actorId}`);
      }
      return (
        await access.authorize({
          invocation: { kind: "human-session", sessionToken },
          invocationId: request.invocationId,
          projectId: request.projectId,
          branch: request.branch,
          requestedSpatialScopeRefs: [...(request.requestedSpatialScopeRefs ?? [spatialScopeRef])],
          requestedSourceVersionRefs: [
            ...(request.requestedSourceVersionRefs ?? downstreamSourceVersionRefs),
          ],
        })
      ).context;
    };
    /**
     * C15 组合根：清洗任务经 C06 的 `agent-task.start-task` 分支取得唯一启动上下文，
     * 再由同一个注入 C06 verifier 的 C08 adapter 创建。这里只声明受信调用来源，
     * 授权本身仍由 C06 按启动命令的 commandId 签发与复验。
     */
    const cleaning = createPostgresDataCleaningComposition({
      store: {
        db: appRuntime.db,
        transactionUnit,
        access,
        artifactStore,
        artifactReferenceGuard: artifactStore.referenceGuard,
        monitoringStore,
        policy: cleaningPolicy,
      },
      resolveStartAuthorizationInvocation: () => ({
        kind: "human-session",
        sessionToken: operatorSession.sessionToken,
      }),
    });
    await access.administerProject({
      kind: "revise-membership",
      projectId: PROJECT_ID,
      commandId: "demo-browser-viewer-membership",
      idempotencyKey: "demo-browser-viewer-membership",
      expectedVersion: "none",
      authorizationContextRef: administratorContextRef,
      membershipId: VIEWER_MEMBERSHIP_ID,
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
    if (
      spatialRevision.kind !== "succeeded" ||
      spatialRevision.result.kind !== "spatial-revision"
    ) {
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
        throw new Error(`demo fixture delivery ${suffix} failed: ${JSON.stringify(delivery)}`);
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
    downstreamSourceVersionRefs.push(sourceA.sourceVersionRef);

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
    const sourceVersionsByGrant = new Map();
    const reviseSourceAccess = async (sourceVersionRef, suffix, visibility, allowedAccountIds) => {
      const result = await access.administerProject({
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
      const registered = await appRuntime.pool.query(
        "SELECT current_revision_id FROM business.source_access_policies WHERE source_access_grant_id = $1",
        [result.resultRef.entityId],
      );
      const grant = {
        entityId: result.resultRef.entityId,
        versionId: registered.rows[0].current_revision_id,
      };
      sourceVersionsByGrant.set(`${grant.entityId}\u0000${grant.versionId}`, sourceVersionRef);
      return result;
    };
    await reviseSourceAccess(sourceA.sourceVersionRef, "a", "project-shared", []);
    await reviseSourceAccess(sourceB.sourceVersionRef, "b", "restricted", [administratorAccountId]);

    // ---- C12 结构化文档转换 + C15 清洗冻结（IP-12：C19 编制的上游来源）----
    //
    // 资料 A/B 的资料段是直接登记的，不经 C12 转换。这里单独登记一份可转换资料：
    // 正文是真实 CSV 字节，由内置 CSV 解析器产出 `table` 段（清洗策略的必含段种类），
    // 转换记录落库后 C15 冻结才能解析资料并创建真实的 C08 清洗任务。
    // 这样 C12/C15 链不触碰既有播种数据的资料段与证据引用（合成样本、待甲方复核）。
    const convertibleAuth = await writeAuth("demo-browser-source-c15");
    const convertibleBodyRef = await putBody(
      "demo-browser-source-c15-body",
      "engineering-data.register-source-delivery",
      new TextEncoder().encode(
        [
          "指标,单位,阈值,说明",
          "地表沉降累计值,mm,12.0,施工监测控制值",
          "地表沉降短期斜率,mm/d,2.0,施工监测控制值",
          "支护结构变形,mm,8.0,施工监测控制值",
        ].join("\n"),
      ),
      "text/csv",
      convertibleAuth,
      "engineering-data.write",
    );
    const convertibleMetadataRef = await putJson(
      "demo-browser-source-c15-metadata",
      "engineering-data.register-source-delivery",
      {
        schemaVersion: "1",
        projectRevisionRef,
        spatialScopeRefs: [businessSpatialScopeRef],
        registeredByAccountId: convertibleAuth.actorId,
        sourceItemId: "demo-browser-source-item-c15",
        sourceItemName: "C34 清洗来源资料（监测控制值表）",
        sourceCategory: "engineering-document",
        sourceMetadata: {
          documentType: "监测控制值表",
          formedAt: NOW,
          sourceOrganization: "合成夹具",
        },
        descriptor: { kind: "file-upload", contentFingerprint: "C34 合成监测控制值表" },
        applicabilityMetadataSnapshotRef: applicabilitySnapshotRef,
      },
      convertibleAuth,
      "engineering-data.write",
    );
    const convertibleDelivery = await registry.apply({
      commandId: "demo-browser-delivery-c15",
      idempotencyKey: "demo-browser-delivery-c15",
      projectId: PROJECT_ID,
      actorId: convertibleAuth.actorId,
      issuedAt: NOW,
      authorization: await writeAuth("demo-browser-delivery-c15"),
      kind: "register-source-delivery",
      payload: {
        sourceConnectionRef: versionRef("file-upload"),
        deliveryKey: "demo-browser-delivery-c15",
        sourceArtifactRef: convertibleBodyRef,
        metadataArtifactRef: convertibleMetadataRef,
        occurredAt: NOW,
      },
    });
    if (convertibleDelivery.kind !== "succeeded") {
      throw new Error(`demo fixture delivery c15 failed: ${JSON.stringify(convertibleDelivery)}`);
    }
    const convertibleSourceVersionRef = convertibleDelivery.result.sourceVersionRef;
    await reviseSourceAccess(convertibleSourceVersionRef, "c15", "project-shared", []);
    // 下游上下文的默认来源集必须覆盖这条链真正读取的资料：C19 组装的适用规则集按准备快照
    // 的来源登记，读取它的上下文少一个来源授权就过不了工件注册表的 `containsAll` 复验。
    // C12 转换来源是工程内共享，operator 有权；受限的资料 B 不在其列，也不应出现在这里。
    downstreamSourceVersionRefs.push(convertibleSourceVersionRef);

    const documentConversion = createStructuredDocumentConversionAdapter({
      // 不传 db 时适配器只把结果留在内存，C15 解析资料时查不到转换记录。
      db: appRuntime.db,
      transactionUnit,
      contextSource: registry,
      artifactStore,
      qualityPolicyRef: conversionQualityPolicyRef,
      converterDeploymentRef: conversionDeploymentRef,
      resourcePolicy: {
        schemaVersion: "1",
        policyRef: conversionPolicyRef,
        maxInputBytes: 1_048_576,
        maxZipEntries: 256,
        maxZipUncompressedBytes: 8_388_608,
        maxZipCompressionRatio: 64,
        maxXmlBytes: 4_194_304,
        maxPdfPages: 200,
        maxPdfTextItems: 20_000,
        maxSheets: 32,
        maxCells: 200_000,
        maxCsvRecords: 20_000,
        maxCsvFields: 64,
        maxOutputBlocks: 10_000,
      },
    });
    const conversionResult = await documentConversion.convert({
      schemaVersion: "1",
      conversionId: "demo-c12-conversion-c15",
      idempotencyKey: "demo-c12-conversion-c15",
      runId: "demo-c12-run-c15",
      threadId: "demo-c12-thread-c15",
      issuedAt: NOW,
      deadlineAt: "2030-06-02T01:00:00.000Z",
      projectId: PROJECT_ID,
      actorId: convertibleAuth.actorId,
      // 转换命令没有独立 C06 分支：按已验证形态用资料登记分支签发，
      // invocationId 与 conversionId 同值，空间与来源都显式给出。
      authorization: await operatorAuth(
        "demo-c12-conversion-c15",
        "engineering-data.register-source-delivery",
        [convertibleSourceVersionRef],
      ),
      sourceVersionRef: convertibleSourceVersionRef,
      sourceArtifactRef: convertibleBodyRef,
      mediaType: "text/csv",
      input: { kind: "csv" },
      conversionPolicyRef,
      qualityPolicyRef: conversionQualityPolicyRef,
      converterDeploymentRef: conversionDeploymentRef,
    });
    if (conversionResult.kind !== "succeeded") {
      throw new Error(
        `demo fixture C12 转换失败：${JSON.stringify(conversionResult.error ?? null)}`,
      );
    }

    /**
     * C15 真实清洗冻结：经产品侧 store 冻结识别准备，快照自带已创建的 C08 清洗任务。
     * 清洗任务随后由确定性 worker 走完整生命周期收口——这里不代写任何清洗结果。
     */
    const cleaningFreeze = await cleaning.store.freezeIdentificationPreparation({
      kind: "identification-preparation",
      commandId: "demo-c15-identification-preparation",
      idempotencyKey: "demo-c15-identification-preparation",
      projectId: PROJECT_ID,
      actorId: baseAuth.actorId,
      issuedAt: NOW,
      // 冻结走自己的 C06 分支（能力 `engineering-data.freeze`），不复用资料登记的写授权；
      // invocationId 与 commandId 同值，C06/C08 才能对得上同一份复验身份。
      authorization: await operatorAuth(
        "demo-c15-identification-preparation",
        "engineering-data.identification-preparation",
        [convertibleSourceVersionRef],
      ),
      payload: {
        projectRevisionRef,
        spatialScopeRefs: [spatialScopeRef],
        sourceVersionRefs: [convertibleSourceVersionRef],
        dataProcessingPolicyRef: cleaningPolicy.policyRef,
      },
    });
    if (cleaningFreeze.kind !== "succeeded") {
      // 首次冻结会因清洗任务尚未收口而停在 `data-cleaning-task-incomplete`，
      // 但 C08 任务已经按真实契约创建。驱动它走完生命周期后重放同一冻结命令即可收口，
      // 不另起一条任务，也不手工写已完成任务。
      if (cleaningFreeze.error?.blockerKind !== "data-cleaning-task-incomplete") {
        throw new Error(
          `demo fixture C15 冻结失败：${JSON.stringify(cleaningFreeze.error ?? null)}`,
        );
      }
    }

    /**
     * 确定性 C08 worker：按 C08 契约走完清洗任务生命周期。
     *
     * `claim` 会抢任意 active 任务，因此断言抢到的正是刚创建的那条；抢错就显式失败，
     * 不把「抢到别的任务」当成清洗已完成（design D-05 的有界 Agent 任务契约）。
     * 候选内容按合成样本给定，清洗判定与收口全部由生产定义代码完成。
     */
    const cleaningAdapter = cleaning.agentTaskAdapter;
    const claimAt = "2030-06-02T00:10:00.000Z";
    const claimStep = (seconds) => new Date(Date.parse(claimAt) + seconds * 1000).toISOString();
    const cleaningClaim = await cleaningAdapter.claim({
      workerId: "demo-c15-worker",
      leaseDurationMs: 600_000,
      now: claimAt,
    });
    if (cleaningClaim === undefined) {
      throw new Error("demo fixture C15 清洗任务无可认领的 active 任务");
    }
    const cleaningTaskRef = cleaningClaim.task.envelope.agentTaskRef;
    if (!cleaningTaskRef.reference.entityId.startsWith("agent-task:")) {
      throw new Error(`demo fixture C15 认领到非预期任务：${cleaningTaskRef.reference.entityId}`);
    }
    const cleaningAuthorization = cleaningClaim.task.envelope.authorization;
    const cleaningCapability = cleaningAuthorization.grantedCapabilities[0];
    const putCleaningArtifact = async (artifactId, purposeCode, artifactKind, value) =>
      artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: `${artifactId}:put`,
          idempotencyKey: `${artifactId}:put`,
          projectId: cleaningAuthorization.projectId,
          actorId: cleaningAuthorization.actorId,
          issuedAt: cleaningAuthorization.decidedAt,
          authorization: cleaningAuthorization,
          requiredCapability: cleaningCapability,
          artifactId,
          artifactKind,
          purposeCode,
          mediaType: "application/json",
          parentArtifactRefs: [],
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        (async function* () {
          yield new TextEncoder().encode(JSON.stringify(value));
        })(),
      );
    const cleaningCandidate = {
      schemaVersion: "1",
      candidateVersion: 1,
      observations: [],
      exclusions: [],
    };
    const intentPut = await putCleaningArtifact(
      `demo-c15-intent-${cleaningTaskRef.reference.entityId}`,
      "agent-action-intent",
      "diagnostic",
      { action: "submit-cleaning-candidate" },
    );
    const candidatePut = await putCleaningArtifact(
      `demo-c15-candidate-${cleaningTaskRef.reference.entityId}`,
      "agent-candidate",
      "content",
      cleaningCandidate,
    );
    const incrementPut = await putCleaningArtifact(
      `demo-c15-increment-${cleaningTaskRef.reference.entityId}`,
      "agent-increment",
      "diagnostic",
      cleaningCandidate,
    );
    const actionResultPut = await putCleaningArtifact(
      `demo-c15-action-result-${cleaningTaskRef.reference.entityId}`,
      "agent-action-result",
      "diagnostic",
      { action: "submit-cleaning-candidate", outcome: "accepted" },
    );
    const cleaningActionId = `${cleaningTaskRef.reference.entityId}:action`;
    const reserved = await cleaningAdapter.reserveAction({
      taskRef: cleaningTaskRef,
      workerId: cleaningClaim.workerId,
      leaseToken: cleaningClaim.leaseToken,
      actionId: cleaningActionId,
      reservationId: `${cleaningActionId}:reservation`,
      actionType: "model-invocation",
      sequence: 1,
      idempotencyKey: `${cleaningActionId}:idempotency`,
      intentArtifactRef: intentPut.artifactRef,
      now: claimStep(1),
    });
    await cleaningAdapter.completeAction({
      taskRef: cleaningTaskRef,
      workerId: cleaningClaim.workerId,
      leaseToken: cleaningClaim.leaseToken,
      actionId: cleaningActionId,
      resultRef: candidatePut.artifactRef,
      resultArtifactRef: actionResultPut.artifactRef,
      usage: { ...reserved.reservation.amount, modelInvocations: 1 },
      activeWallClockMs: 1_000,
      now: claimStep(2),
    });
    const cleaningDefinition = cleaning.store.createTaskDefinition();
    // C15 组合根在工厂里就把清洗定义注册进了自己的注册表，这里取的就是那批已注册定义。
    registeredAgentTaskDefinitions.push(...cleaning.registry.values());
    const cleaningValidation = await cleaningDefinition.validateCandidate(
      cleaningCandidate,
      cleaningClaim.task,
    );
    const cleaningResultRef = await cleaningDefinition.finalizeCandidate(
      cleaningCandidate,
      cleaningClaim.task,
    );
    await cleaningAdapter.recordCandidate({
      candidate: {
        schemaVersion: "1",
        taskRef: cleaningTaskRef,
        candidateVersion: 1,
        parentCandidateVersion: 0,
        candidateArtifactRef: candidatePut.artifactRef,
        incrementArtifactRef: incrementPut.artifactRef,
        validation: cleaningValidation,
        resultRef: cleaningResultRef,
        disposition: "accepted",
        createdAt: claimStep(3),
      },
      workerId: cleaningClaim.workerId,
      leaseToken: cleaningClaim.leaseToken,
    });
    await cleaningAdapter.completeTask({
      taskRef: cleaningTaskRef,
      workerId: cleaningClaim.workerId,
      leaseToken: cleaningClaim.leaseToken,
      resultRef: cleaningResultRef,
      now: claimStep(4),
    });
    /**
     * C19 编制要用的真实清洗任务引用：C08 认领返回的信封引用本身已是完整
     * `AgentTaskRefV1`（含 taskType、triggerMode 与四项任务策略引用），整体透传，
     * 不裁剪成只有 kind/reference——那会让 C19 按 AgentTaskRefV1 解析时以类型不符失败。
     */
    const dataCleaningTaskRef = cleaningTaskRef;

    /**
     * C19 编制候选的证据定位符：取自 C15 真实清洗结果里保留的资料段。编制校验要求
     * `evidenceLocator.sourceSegmentId` 与 `evidenceReferences[].locator.sourceSegmentId`
     * 都命中保留段，因此这里经公开只读接缝读回结果取实际段标识，不凭来源引用猜段名。
     */
    const cleaningReadAuthorization = await operatorAuth(
      "demo-c15-result-read",
      "engineering-data.evidence-access",
      [convertibleSourceVersionRef],
    );
    const cleaningResultRead = await cleaning.store.readBoundResult({
      projectId: PROJECT_ID,
      actorId: cleaningReadAuthorization.actorId,
      requestId: "demo-c15-result-read",
      requestedAt: cleaningReadAuthorization.decidedAt,
      authorization: cleaningReadAuthorization,
      taskRef: dataCleaningTaskRef,
    });
    if (cleaningResultRead.kind !== "ok") {
      throw new Error(
        `demo fixture C15 结果读取失败：${JSON.stringify(cleaningResultRead).slice(0, 400)}`,
      );
    }
    const retainedSourceSegments = cleaningResultRead.result.inputs
      .flatMap((input) =>
        (input.retainedSegmentIds ?? []).map((sourceSegmentId) => ({
          sourceVersionRef: input.sourceVersionRef,
          sourceSegmentId,
        })),
      )
      .filter((entry) => entry.sourceVersionRef !== undefined);
    if (retainedSourceSegments.length === 0) {
      throw new Error("demo fixture C15 未保留任何资料段，C19 编制无合法证据可引");
    }

    // 任务收口后重放同一冻结命令：命令身份与幂等键不变，C08 不会再建第二条任务。
    const cleaningFreezeSettled = await cleaning.store.freezeIdentificationPreparation({
      kind: "identification-preparation",
      commandId: "demo-c15-identification-preparation",
      idempotencyKey: "demo-c15-identification-preparation",
      projectId: PROJECT_ID,
      actorId: baseAuth.actorId,
      issuedAt: NOW,
      authorization: await operatorAuth(
        "demo-c15-identification-preparation",
        "engineering-data.identification-preparation",
        [convertibleSourceVersionRef],
      ),
      payload: {
        projectRevisionRef,
        spatialScopeRefs: [spatialScopeRef],
        sourceVersionRefs: [convertibleSourceVersionRef],
        dataProcessingPolicyRef: cleaningPolicy.policyRef,
      },
    });
    if (cleaningFreezeSettled.kind !== "succeeded") {
      throw new Error(
        `demo fixture C15 冻结收口失败：${JSON.stringify(cleaningFreezeSettled.error ?? null)}`,
      );
    }

    // ---- 监测序列 + 批次 + 冻结快照（C14 公开接缝） ----
    // 监测读沿用 operatorAuth 的同一来源集合，无需独立授权助手。
    const monitoringAuth = (invocationId, branch) =>
      operatorAuth(invocationId, branch, [sourceA.sourceVersionRef]);
    void monitoringAuth;
    const seriesRef = kindRef("monitoring-series", "demo-c32-series-settlement");
    /**
     * 资料 A 首个资料段的证据定位符：监测样本与工序模型正文共用同一条已登记证据。
     */
    const sampleEvidence = evidenceFor(sourceA.sourceVersionRef, sourceA.segmentIds[0]);

    /**
     * 登记一条真实监测序列并冻结它的快照：C25 的指标实际取值只能来自冻结快照。
     *
     * 每条序列各自走一遍「序列修订 → 可用性策略 → 样本工件 → 批次登记 → 快照冻结」，
     * 不共用正文也不共用策略：不同指标量纲不同，快照的 cutoff 网格也不同。
     */
    const registerMonitoringSeries = async (input) => {
      const seriesRef = kindRef("monitoring-series", input.seriesId);
      const policyRef = versionRef(`${input.seriesId}-availability-policy`);
      const identity = (purpose) => `demo-browser-${input.seriesId}-${purpose}`;
      const monitoringAuth = (invocationId, branch) =>
        operatorAuth(invocationId, branch, [sourceA.sourceVersionRef]);
      const revised = await monitoringStore.reviseSeries({
        commandId: identity("series"),
        idempotencyKey: identity("series"),
        projectId: PROJECT_ID,
        actorId: baseAuth.actorId,
        issuedAt: NOW,
        authorization: await monitoringAuth(
          identity("series"),
          "engineering-data.register-monitoring-batch",
        ),
        monitoringSeriesRef: seriesRef,
        expectedVersion: "none",
        projectRevisionRef,
        spatialScopeRef: businessSpatialScopeRef,
        monitoringObject: input.monitoringObject,
        monitoringIndicator: input.monitoringIndicator,
        parameterCode: input.parameterCode,
        canonicalUnit: input.canonicalUnit,
        unitConversions: [],
        effectivePeriod: { validFrom: NOW },
      });
      if (revised.kind !== "succeeded") {
        throw new Error(
          `demo fixture series failed ${input.seriesId}: ${JSON.stringify(revised).slice(0, 500)}`,
        );
      }
      const policy = await monitoringStore.registerAvailabilityPolicy({
        commandId: identity("policy"),
        idempotencyKey: identity("policy"),
        projectId: PROJECT_ID,
        actorId: baseAuth.actorId,
        issuedAt: NOW,
        authorization: await monitoringAuth(
          identity("policy"),
          "engineering-data.register-monitoring-batch",
        ),
        policy: {
          availabilityPolicyRef: policyRef,
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
      if (policy.kind !== "succeeded")
        throw new Error(`demo fixture availability policy failed ${input.seriesId}`);
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
            value: input.sampleAt(second),
            unit: input.canonicalUnit,
            evidenceReferences: [sampleEvidence],
          }),
        ),
      ].join("\n");
      const sampleAuth = await monitoringAuth(
        identity("samples"),
        "engineering-data.register-monitoring-batch",
      );
      const sampleArtifact = await artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: identity("samples"),
          idempotencyKey: identity("samples"),
          projectId: PROJECT_ID,
          actorId: sampleAuth.actorId,
          issuedAt: NOW,
          authorization: sampleAuth,
          requiredCapability: "engineering-data.write",
          artifactId: `demo-browser-samples-${input.seriesId}`,
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
        commandId: identity("batch"),
        idempotencyKey: identity("batch"),
        projectId: PROJECT_ID,
        actorId: sampleAuth.actorId,
        issuedAt: NOW,
        authorization: await monitoringAuth(
          identity("batch"),
          "engineering-data.register-monitoring-batch",
        ),
        kind: "register-monitoring-batch",
        payload: {
          monitoringSeriesRef: seriesRef,
          deliveryKey: identity("batch"),
          sampleArtifactRef: sampleArtifact.artifactRef,
          window: { from: "2030-01-01T00:00:05.000Z", to: "2030-01-01T00:00:11.000Z" },
          relation: { kind: "original" },
        },
      });
      if (batch.kind !== "succeeded") {
        throw new Error(
          `demo fixture monitoring batch failed ${input.seriesId}: ${JSON.stringify(batch)}`,
        );
      }
      const snapshot = await registry.freeze({
        commandId: identity("freeze"),
        idempotencyKey: identity("freeze"),
        projectId: PROJECT_ID,
        actorId: sampleAuth.actorId,
        issuedAt: NOW,
        authorization: await monitoringAuth(
          identity("freeze"),
          "engineering-data.monitoring-snapshot",
        ),
        kind: "monitoring-snapshot",
        payload: {
          monitoringSeriesRef: seriesRef,
          cutoff: "2030-01-01T00:00:10.000Z",
          availabilityPolicyRef: policyRef,
        },
      });
      if (snapshot.kind !== "succeeded") {
        throw new Error(`demo fixture monitoring snapshot failed ${input.seriesId}`);
      }
      return snapshot.result.monitoringSnapshotRef;
    };

    // 后果侧：地表沉降累计值（演示数据 2 mm/s 线性上升，cutoff 处 20 mm）。
    const settlementMonitoringSnapshotRef = await registerMonitoringSeries({
      seriesId: "demo-c32-series-settlement",
      monitoringObject: "地表沉降监测点",
      monitoringIndicator: "地表沉降",
      parameterCode: "settlement",
      canonicalUnit: "mm",
      sampleAt: (second) => second * 2,
    });
    // 可能性侧：泥水压力（演示数据 220 kPa 起，每秒 +20 kPa，cutoff 处 320 kPa）。
    // 监测指标名取自封闭词表 `MONITORING_INDICATOR_VALUES`，不能用词表外的自造名称。
    const slurryPressureMonitoringSnapshotRef = await registerMonitoringSeries({
      seriesId: "demo-c32-series-slurry-pressure",
      monitoringObject: "泥水压力监测点",
      monitoringIndicator: "泥水压力",
      parameterCode: "slurry-pressure",
      canonicalUnit: "kPa",
      sampleAt: (second) => 120 + second * 20,
    });
    // 合成重评输入：保持两项指标完整，以另一个真实登记快照表达沉降变化。
    const reassessmentSettlementMonitoringSnapshotRef = await registerMonitoringSeries({
      seriesId: "demo-c32-series-settlement-reassessment",
      monitoringObject: "地表沉降复测点",
      monitoringIndicator: "地表沉降",
      parameterCode: "settlement",
      canonicalUnit: "mm",
      sampleAt: (second) => second * 2 + 1,
    });

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
      // 工件用途码必须与该类定义所属领域登记的值一致：C04 读取按 `purposeCode` 与写入
      // 清单完全相等判定，治理读才读得出播种正文。识别族统一用知识包用途码。
      const artifactRef = await putJson(
        `demo-browser-governance-${definitionId}`,
        // 工件用途码必须与该类定义所属领域登记的值一致：C04 读取按 `purposeCode` 与写入
        // 清单完全相等判定，治理读才读得出播种正文。识别族统一用知识包用途码。
        "identification-knowledge-package",
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
          // 发布行会被 C16 的 release 事实读取重新解析：`review_task_ref` 必须满足
          // `ReviewTaskRefV1` 的判别联合，不能只放一个裸引用——否则同一 definitionType
          // 再次提交时读取既有发布事实就会按类型不符失败闭合。
          review_task_ref: JSON.stringify({
            kind: "review-task",
            reference: { entityId: `${definitionId}-rt`, versionId: "1" },
            reviewType: "knowledge-revision",
            targetRef: kindRef("knowledge-revision", `${definitionId}-rev-1`),
            waitingRunRef: {
              kind: "workflow-run",
              reference: { entityId: `${definitionId}-run`, versionId: "1" },
            },
          }),
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
        preparationSnapshotRef: kindRef("identification-preparation-snapshot", "demo-preparation"),
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
        preparationSnapshotRef: kindRef("identification-preparation-snapshot", "demo-preparation"),
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
    // structured-scoring-rule 与 applicable-rule-set 不再由 SQL 播种：C19 现在按真实
    // 编制任务、C16 提交与发布链产出这两类定义，C11 冻结准备快照后由 C19 组装适用规则集。
    // 播种行既过不了发布行解析的判别联合，也会与真实发布集在同一 definitionType 上撞出
    // STALE_VERSION，还会让 C19 `resolve` 取到缺少修订元数据的发布集。

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
      excludedMechanisms: [{ mechanismId: "MEC-VDS-018", reasonCode: "applicability-mismatch" }],
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
        throw new Error(`demo fixture review request ${suffix} failed: ${JSON.stringify(result)}`);
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
      const artifactRef = await putGraphBody(`demo-c33-body-stage-${completedSuffix}-${stage}`, {
        bodyKind: "stage-result",
        stageResult: {
          schemaVersion: "1",
          runRef: completedRunRef,
          recordedAt: completedValidAt,
          ...body,
        },
      });
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
          evidenceSnapshotRef: kindRef("evidence-snapshot", `evidence-snapshot:${completedRunId}`),
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
      // 资料 B 仅系统管理员可见，这条记录因此只对管理员可读；证据抽屉的受限脱敏态由此而来。
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
    /**
     * 真实 PostgreSQL checkpointer（design D-11）。用独立的 checkpointer 角色连接，
     * 与应用角色分离；契约引用校验在本装配内恒真——评估与风险流程的图状态引用都由
     * 所属注册表在同一事务内复验，检查点层不重复做一次弱校验。
     */
    const checkpointer = await setupPostgresCheckpointer({
      ...roleConfig("riskflow_checkpointer_login"),
      validateReference: () => true,
    });
    closeables.push(() => checkpointer.end());

    const workflow = createPostgresWorkflowAdapter({
      db: appRuntime.db,
      transactionUnit,
      artifactStore,
      authorization: access,
    });
    // ---- C35 报告导出服务（design D-09）：投影 → 报告服务 → 投影 ----
    //
    // 导出服务要经所属投影的 `resultRead` 读页，而投影又要注入导出服务才能实现
    // `projection.export`：这是同属一个组合根的循环依赖。按生产适配器测试同一解法拆成两步：
    // 先建不带导出的读投影只为取得 `resultRead`，再建注入导出服务的最终投影。
    // 两个投影共享同一个 `db`、同一个 `registrationStore` 与同一套工件，没有第二份事实。
    const projectionReader = createPostgresWorkflowProjection({
      db: appRuntime.db,
      registrationStore: workflow.registrationStore,
      bodies: workflow.bodies,
      authorization: access,
      riskRecordTrace: createPostgresRiskRecordTraceReader({
        db: appRuntime.db,
        authorization: access,
      }),
    });
    const reportExport = createPostgresReportExport({
      db: appRuntime.db,
      transactionUnit,
      artifactStore,
      registrationStore: workflow.registrationStore,
      resultRead: projectionReader.resultRead,
      authorization: access,
      // `projection.export` 上下文无法在模块内收窄成 `projection.result-read`，配对签发由
      // 组合根按请求主体的真实会话向 C06 重新申请；没有真实会话就没有导出能力。
      resultReadAuthorization: {
        issueResultReadAuthorization: async (request) => {
          const sessionToken = sessionTokensByAccountId.get(request.actorId);
          if (sessionToken === undefined) {
            throw new Error(`无真实会话可签发配对结果读上下文：${request.actorId}`);
          }
          const decision = await access.authorize({
            invocation: { kind: "human-session", sessionToken },
            invocationId: request.invocationId,
            projectId: request.projectId,
            branch: "projection.result-read",
            requestedSpatialScopeRefs: [...request.spatialScopeRefs],
            requestedSourceVersionRefs: [],
            requestedAt: request.requestedAt,
          });
          return decision.context;
        },
      },
      // 导出策略由部署冻结：缺省空集合＝无导出能力，这里显式登记合成策略（待甲方复核）。
      exportPolicies: [DEMO_REPORT_EXPORT_POLICY],
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
      reportExport: { exportReport: reportExport.exportReport },
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
    //
    // 播种按运行逐个进行：C31 的 risk-overview 每页只展开一个运行，翻页完全由用户驱动。
    // 只有一个运行就永远只有一页，「按页追溯」无从验收，因此这里登记两个真实运行，
    // 让下一页游标成为真实游标而不是构造出来的假游标。
    const seedRiskOverviewRun = async (
      suffix,
      parentRunRef,
      status = "completed",
      referenceCount = 0,
    ) => {
      const chainRunId = `risk-flow-run:${PROJECT_ID}:${suffix}`;
      const chainRunVersionId = sha(`c33-${suffix}-run-version`);
      const chainRunRef = kindRef("workflow-run", chainRunId, chainRunVersionId);
      const chainEntryIdentity = {
        entityId: `workflow-entry:${PROJECT_ID}:identify-and-assess`,
        versionId: `entry-${suffix}`,
      };
      // 冻结引用必须与 risk-overview 登记的目标逐字一致：登记目标只有工程修订
      // （总览查询不传空间范围）。多带一个空间引用会让入口行匹配不上，整页失败闭合。
      const chainFrozenRefs =
        suffix === "chain-a" || suffix === "chain-b" ? [projectRevisionRef] : [spatialScopeRef];
      const chainStateArtifactId = `c33-${suffix}-run-state:${chainRunId}:${chainRunVersionId}`;
      // C30 正文写入沿真实授权接缝复验：身份由签发方给出，端口按同一身份复验，
      // 不用无签发方的端口内派生身份。
      const chainBodyInvocationId = `demo-c33-${suffix}-chain-body-write`;
      const chainBodyAuth = await operatorAuth(chainBodyInvocationId, "workflow.start-run");
      const chainStateArtifactRef = await workflow.bodies.putBody({
        projectId: PROJECT_ID,
        actorId: chainBodyAuth.actorId,
        commandId: `demo-c33-${suffix}-body-run-state`,
        issuedAt: chainRecordedAt,
        artifactId: chainStateArtifactId,
        invocationId: chainBodyInvocationId,
        body: WorkflowGraphArtifactBodyV1Schema.parse({
          bodyKind: "run-state",
          runState: {
            schemaVersion: "1",
            projectId: PROJECT_ID,
            runId: chainRunId,
            runVersionId: chainRunVersionId,
            entryMode: "identify-and-assess",
            graphVersion: versionRef("demo-risk-flow", "1"),
            entryIdentity: chainEntryIdentity,
            stage: "result-summary",
            status,
            parentRunRef,
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
        resultVersionId: sha(`c33-${suffix}-result-${rowSuffix}`),
        runId: chainRunId,
        runVersionId: chainRunVersionId,
        entryMode: "identify-and-assess",
        // 命令身份按运行区分：复用同一 commandId 会让第二次播种撞上第一次的幂等登记。
        commandId: `demo-c33-${suffix}-${rowSuffix}`,
        idempotencyKey: `demo-c33-${suffix}-${rowSuffix}`,
        requestDigest: sha(`demo-c33-${suffix}-request-${rowSuffix}`),
        actorRef: baseAuth.actorId,
        authorizationContextRef: baseAuth.authorizationContextRef,
        authorizationScopeDigest: scopeDigest,
        validAt: chainRecordedAt,
        recordedAt: chainRecordedAt,
        persistedAt: chainRecordedAt,
        auditEntryId: `demo-c33-${suffix}-${rowSuffix}:audit`,
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
      for (let index = 0; index < referenceCount + (referenceCount > 0 ? 50 : 0); index += 1) {
        if (index < referenceCount)
          await registerChainRow(
            WorkflowGraphResultRowV1Schema.parse({
              ...chainRowBase(`result-${index}`),
              resultKind: "stage-result",
              stage: "assessment",
              stageResultRef: kindRef("stage-result", `${chainRunId}:result-${index}`),
            }),
          );
        await registerChainRow(
          WorkflowGraphResultRowV1Schema.parse({
            ...chainRowBase(`waiting-${index}`),
            resultKind: "waiting",
            stage: "assessment",
            waitingRef: {
              kind: "review",
              reviewTaskRef: {
                ...kindRef("review-task", `${chainRunId}:review-${index}`),
                reviewType: "response-candidate",
                waitingRunRef: chainRunRef,
                targetRef: kindRef("recommendation-candidate", `${chainRunId}:candidate-${index}`),
              },
            },
          }),
        );
      }
      return chainRunRef;
    };
    // 两个已登记运行：父子链上的兄弟运行，父运行相同、入口身份不同。
    const chainRunRef = await seedRiskOverviewRun("chain-a", completedRunRef);
    const chainRunId = chainRunRef.reference.entityId;
    const chainRunRefB = await seedRiskOverviewRun("chain-b", completedRunRef);
    const paginatedRunRef = await seedRiskOverviewRun("paginated", undefined, "waiting", 55);
    const terminalRunRef = await seedRiskOverviewRun("terminal", undefined, "terminal-failure");
    const freePort = await new Promise((resolved, rejected) => {
      const probe = createServer();
      probe.once("error", rejected);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        probe.close(() => resolved(address.port));
      });
    });
    const publicOrigin = `http://127.0.0.1:${freePort}`;

    // ---- C16 → C18 → C19 正式依据链（design D-11）----
    //
    // C16 拥有发布/修订/工件引用；C18 与 C19 都经它的 governedReleases 解析精确引用，
    // 各自只持有自己的配置集合与依据投影。C19 的 `resolve` 按冻结的评估准备快照物化
    // `assessment-basis-release-set`，本装配把它作为 C25 的依据读取端口与图组合根的
    // basisResolver。
    //
    // C18 与 C19 两类定义的提交与发布都在 C16 事务内完成，所以 C16 必须持有两者的治理
    // 策略；而两者又把 C16 当作精确引用解析器，互相成环。这里用两个转发代理打断构造期
    // 依赖：代理的方法体在调用时才取已建好的适配器，被调用而适配器尚未就绪即抛错，
    // 不用未定义引用或默认值顶替。
    const governanceTargets = { assessmentConfiguration: undefined, scoringRules: undefined };
    const forwardTo = (pick) => ({
      prepareRevision: (input) => {
        const target = pick();
        if (target === undefined) throw new Error("治理策略尚未接线");
        return target.prepareRevision(input);
      },
      appendPreparedRevision: (context, input) => {
        const target = pick();
        if (target === undefined) throw new Error("治理策略尚未接线");
        return target.appendPreparedRevision(context, input);
      },
      assertRevisionMetadata: (input) => {
        const target = pick();
        if (target === undefined) throw new Error("治理策略尚未接线");
        return target.assertRevisionMetadata(input);
      },
      appendRelease: (context, input) => {
        const target = pick();
        if (target === undefined) throw new Error("治理策略尚未接线");
        return target.appendRelease(context, input);
      },
    });
    const knowledgeGovernance = new PostgresKnowledgeGovernanceAdapter({
      db: appRuntime.db,
      transactionUnit,
      access,
      reviewAudit,
      // D-11：C16 派生精确调用身份后由部署签发审阅授权，C16 再亲自复验一次。
      // 缺这个提供者时 C16 在进入 C07 前就关闭失败，不允许回退到命令自带 authorization。
      reviewAuthorizationProvider: {
        authorize: (request) => operatorAuth(request.invocationId, request.branch),
      },
      assessmentConfigurationPolicy: forwardTo(() => governanceTargets.assessmentConfiguration),
      scoringRulesPolicy: forwardTo(() => governanceTargets.scoringRules),
    });
    // C16 的发布解析按「定义类型集合 + requiredAt + asOfRecordedAt」派生固定 invocationId
    // 并用它向 C06 复验，而不是沿用调用方命令身份。C18 与 C19 都会把各自的授权原样传下去，
    // invocationId 必然对不上。统一在这里按 C16 同一派生规则签发解析身份——与 C16 自身
    // 对审阅授权的处理同形；C18 与 C19 共用这一个解析接缝。
    const governedReleaseResolver = {
      resolveGovernedReleases: async (request) =>
        knowledgeGovernance.resolveGovernedReleases({
          ...request,
          authorization: await operatorAuth(
            governedReleaseResolutionInvocationId(request),
            "knowledge-modeling.assessment-basis",
          ),
        }),
    };
    const assessmentConfiguration = createPostgresAssessmentConfigurationAdapter({
      db: appRuntime.db,
      transactionUnit,
      artifactStore,
      governedReleases: governedReleaseResolver,
    });
    governanceTargets.assessmentConfiguration = assessmentConfiguration;
    const scoringRulesPolicy = createScoringRulesPolicy();
    const scoringAgentTasksRef = {};
    /**
     * C19 修订声明的比较基线，按定义类型分别记录。
     *
     * 评分规则一次发布只能带一条规则（适用规则集的 `includedMembers` 按 release 唯一），
     * 所以多个被加权指标要分多轮编制。每一轮的基线由调用方声明：首轮没有基线，之后各轮
     * 以上一轮的正式发布为基线。C16 提交侧必须用同一个引用，否则 C19 收口时的
     * 「检测基线 = C16 已校验的修订基线」校验必然失败。
     */
    const declaredBaseReleaseRefs = new Map();
    const scoringRules = createPostgresScoringRulesAdapter({
      db: appRuntime.db,
      transactionUnit,
      artifactStore,
      artifactReferenceGuard: artifactStore.referenceGuard,
      access,
      // C08 适配器持有 C19 编制任务定义：编制任务与清洗任务走同一 C08 契约入口。
      taskStore: {
        getTask: (taskRef) => scoringAgentTasksRef.current.getTask(taskRef),
      },
      // C15 结果与冻结输入按工程路由到本装配自己的清洗 store：清洗任务在哪个管线
      // 收口就由同一个 store 读回，不跨管线取事实。
      dataCleaning: {
        readBoundResult: (request) => cleaning.store.readBoundResult(request),
        loadFrozenInput: (task) => cleaning.store.loadFrozenInput(task),
      },
      configuration: assessmentConfiguration,
      governedReleases: governedReleaseResolver,
      // 准备快照投影由所属的 C11 提供，不注入假投影。
      preparationSnapshot: registry,
      // C19 的修订提交没有独立写路径：经 C16 `submit-revision` 与 C07 审阅、C16 发布同事务
      // 落库。授权按提交调用身份单独签发，不复用编制入口的上下文。
      submitRevision: {
        submitRevision: async (input) => {
          // 候选工件的访问快照随写入方的授权而定：C19 规则类候选由编制任务信封写入，
          // C19 规则集候选由组装入口写入，两者来源范围不同。C16 复验工件时按快照判定，
          // 范围不一致会以 ARTIFACT_ACCESS_DENIED 关闭，因此这里按定义类型给出对应来源，
          // 而不是固定一份来源。
          const isConfigurationType = Object.hasOwn(configurationDocuments, input.definitionType);
          const submitSourceRefs = isConfigurationType
            ? [convertibleSourceVersionRef]
            : [retainedSourceSegments[0].sourceVersionRef, sourceA.sourceVersionRef];
          const authorization = await operatorAuth(
            input.commandId,
            "knowledge-modeling.submit-revision",
            submitSourceRefs,
          );
          const evidenceSourceSegmentId = retainedSourceSegments[0].sourceSegmentId;
          const evidenceSourceRef = retainedSourceSegments[0].sourceVersionRef;
          // C18 配置类修订的证据引用指向上面发布配置正文时用的资料来源；C19 规则类修订
          // 的证据引用必须与候选工件一致（编制时用的是 C15 保留段）。两类不能混用同一个
          // 占位标识，否则 C16 解析工件时按来源不符失败。
          const evidenceReferences = isConfigurationType
            ? [
                {
                  locator: { sourceSegmentId: `${input.definitionType}:demo-browser-evidence` },
                  sourceVersion: { entityId: "demo-browser-source", versionId: "1" },
                },
              ]
            : [
                {
                  locator: { sourceSegmentId: evidenceSourceSegmentId },
                  sourceVersion: evidenceSourceRef.reference,
                },
              ];
          // C16 的修订基线：定义已存在时必须声明它基于哪一次发布，否则以
          // `STALE_VERSION` / `base-release-required` 拒绝。基线由 C19 编制侧的声明决定
          // （`prepareAuthoring` 的 `baseRuleReleaseRef`），提交侧必须逐字用同一个引用：
          // C19 收口时会校验「检测基线 = C16 已校验的修订基线」，两侧各算一套必然冲突。
          const baseReleaseRef = declaredBaseReleaseRefs.get(input.definitionType);
          const submitted = await knowledgeGovernance.govern(
            KnowledgeGovernanceCommandV1Schema.parse({
              kind: "submit-revision",
              commandId: input.commandId,
              idempotencyKey: input.idempotencyKey,
              projectId: input.projectId,
              actorId: authorization.actorId,
              issuedAt: input.issuedAt,
              authorization,
              payload: {
                definitionType: input.definitionType,
                candidateArtifactRef: input.candidateArtifactRef,
                // 关系快照与来源绑定已在候选工件内：C19 策略据此登记关系事实，
                // C16 只要求命令声明至少一条证据引用。
                evidenceReferences,
                ...(baseReleaseRef === undefined ? {} : { baseReleaseRef }),
              },
            }),
          );
          if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") {
            throw new Error(
              `C19 submit-revision 失败 ${input.definitionType}: ${JSON.stringify(submitted).slice(0, 900)}`,
            );
          }
          return { kind: "succeeded", revisionRef: submitted.result.knowledgeRevisionRef };
        },
      },
      // 编制任务经 C06 的 `agent-task.start-task` 分支取得唯一启动上下文，
      // 再由同一个注入 C06 verifier 的 C08 adapter 创建。
      startAgentTask: async (request) => {
        const authorization = await operatorAuth(
          request.command.commandId,
          "agent-task.start-task",
          [...downstreamSourceVersionRefs],
        );
        return scoringAgentTasksRef.current.startTask(
          StartAgentTaskCommandV1Schema.parse({ ...request.command, authorization }),
        );
      },
      // 版本化编制策略由部署冻结：组合根不在读侧现编默认策略（合成样本、待甲方复核）。
      policy: scoringRulesPolicy,
    });
    governanceTargets.scoringRules = scoringRules;
    const scoringRuleAuthoringDefinition = createScoringRuleAuthoringTaskDefinition({
      policy: scoringRulesPolicy,
      port: scoringRules,
    });
    registeredAgentTaskDefinitions.push(scoringRuleAuthoringDefinition);
    scoringAgentTasksRef.current = new PostgresAgentTaskAdapter({
      db: appRuntime.db,
      registry: new AgentTaskDefinitionRegistry([scoringRuleAuthoringDefinition]),
      transactionUnit,
      artifactStore,
      referenceGuard: artifactStore.referenceGuard,
      authorization: access,
    });

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
      basisReader: scoringRules,
      runtimePolicies: createRiskAssessmentRuntimePolicies({ projectId: PROJECT_ID }),
      monitoring: monitoringStore,
      authorizeDownstream,
      entryContext: createAssessmentEntryContextReadPort(registry),
      runRead: workflow.runRead,
      entriesRead: workflow.entriesRead,
      recordCatalog: identificationRead,
      // 入口运行策略与 C30 图的 `workflowStartControl` 取同一组部署值：入口面声明的图版本
      // 必须就是真会跑起来的那一版，缺省则入口如实报 `business-unavailable`。
      entryRunPolicy: {
        graphVersion: DEMO_RISK_FLOW_CONFIG.subGraphVersions.assessment,
        retryPolicyRef: DEMO_RISK_FLOW_CONFIG.retryPolicyRef,
      },
    });

    // ---- C16/C07/C18/C19 依据发布链：评估能跑起来的前提 ----
    //
    // 评估子图 A1 必须经 C19 `resolve` 解析出正式依据集合；解析不到就以
    // `UPSTREAM_WAITING` 收口，评估根本不会开始。因此本装配在开跑前走完真实发布链：
    //
    //   C18 11 类配置 → C16 提交 → C07 决定 → C16 发布
    //   C19 规则编制 → C08 任务 → 确定性候选 → C16 提交 → C07 → C16 发布
    //   C11 冻结评估准备快照
    //   C19 组装适用规则集 → C16 提交 → C07 → C16 发布
    //   C19 resolve → 正式依据集合
    //
    // 每一步都是真实写入：没有 SQL 播种「已发布」行冒充命令执行。

    /**
     * 这条链上释放的生效时点。
     *
     * C16 是双时间登记：读取按 `effective_from <= requiredAt` 过滤，而评估运行的 `validAt`
     * 取命令的真实签发时刻。固定演示时钟 `NOW`（2030）晚于任何随后启动的运行，用它生效
     * 等于「释放尚未生效」，A1 只能以 `required-release-unavailable` 收口。这里的释放确实
     * 是本装配刚刚写下的，取装配时刻才与它们在库中的真实先后一致。
     *
     * 同一定义类型可能被连续发布多次（每个被加权指标各一条评分规则），而
     * `knowledge_releases` 对 `(definition_id, effective_from)` 有唯一约束，所以时点必须
     * 逐次前移，不能让两次发布落在同一毫秒上。
     */
    const releaseEffectiveFrom = new Date().toISOString();
    let releaseEffectiveCount = 0;
    const publishApprovedRelease = async (revisionRef) => {
      const effectiveFrom = new Date(
        Date.parse(releaseEffectiveFrom) + releaseEffectiveCount,
      ).toISOString();
      releaseEffectiveCount += 1;
      const revisionKey = revisionRef.reference.entityId;
      const reviewCommandId = `${revisionKey}:review`;
      const reviewAuthorization = await operatorAuth(
        reviewCommandId,
        "knowledge-modeling.request-review",
      );
      const requested = await knowledgeGovernance.govern(
        KnowledgeGovernanceCommandV1Schema.parse({
          kind: "request-review",
          commandId: reviewCommandId,
          idempotencyKey: reviewCommandId,
          projectId: PROJECT_ID,
          actorId: reviewAuthorization.actorId,
          issuedAt: NOW,
          authorization: reviewAuthorization,
          payload: {
            revisionRef,
            reviewPolicyRef: { entityId: "demo-policy-review", versionId: "1" },
          },
        }),
      );
      if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") {
        throw new Error(
          `C16 request-review 失败 ${revisionKey}: ${JSON.stringify(requested).slice(0, 500)}`,
        );
      }
      const reviewTaskRef = requested.result.reviewTaskRef;
      const decisionCommandId = `${revisionKey}:decision`;
      const decisionAuthorization = await operatorAuth(
        decisionCommandId,
        "review-audit.decide-review",
      );
      const decided = await reviewAudit.decideReview({
        kind: "decide-review",
        commandId: decisionCommandId,
        idempotencyKey: decisionCommandId,
        projectId: PROJECT_ID,
        actorId: decisionAuthorization.actorId,
        issuedAt: NOW,
        authorization: decisionAuthorization,
        payload: {
          reviewTaskRef,
          targetRef: reviewTaskRef.targetRef,
          decision: { reviewType: "knowledge-revision", kind: "approve-publication" },
          reasonCode: "demo-browser-approved",
        },
      });
      if (decided.kind !== "succeeded") {
        throw new Error(
          `C07 decide-review 失败 ${revisionKey}: ${JSON.stringify(decided).slice(0, 500)}`,
        );
      }
      const publishCommandId = `${revisionKey}:publish`;
      const publishAuthorization = await operatorAuth(
        publishCommandId,
        "knowledge-modeling.publish-approved-release",
      );
      const published = await knowledgeGovernance.govern(
        KnowledgeGovernanceCommandV1Schema.parse({
          kind: "publish-approved-release",
          commandId: publishCommandId,
          idempotencyKey: publishCommandId,
          projectId: PROJECT_ID,
          actorId: publishAuthorization.actorId,
          issuedAt: NOW,
          authorization: publishAuthorization,
          payload: {
            revisionRef,
            reviewDecisionRef: decided.result.reviewDecisionRef,
            effectiveFrom,
          },
        }),
      );
      if (published.kind !== "succeeded" || published.result.kind !== "release") {
        throw new Error(
          `C16 publish 失败 ${revisionKey}: ${JSON.stringify(published).slice(0, 500)}`,
        );
      }
      return published.result.knowledgeReleaseRef;
    };

    // C18：11 类配置逐类走同一条提交→审核→发布链。不存在独立配置发布入口。
    // `forecast-policy` 正文要带真实模型工件引用，故该类配置在工件登记后单独发布（见下）。
    const configurationSetRef = riskLevelOnly
      ? { ...DEMO_CONFIGURATION_SET_REF, versionId: "risk-level-only" }
      : DEMO_CONFIGURATION_SET_REF;
    const assessmentConfigurationDocuments = (forecastModelRef) => {
      const documents = makeDemoAssessmentConfigurationDocuments({
        projectRevisionRef,
        configurationSetRef,
        forecastModelRef,
      });
      if (riskLevelOnly) {
        // 独立合成配置在真实审核发布前提高监测阈值；风险接受阈值保持原值。
        const document = documents["monitoring-warning-threshold"];
        documents["monitoring-warning-threshold"] = {
          ...document,
          content: {
            ...document.content,
            thresholds: document.content.thresholds.map((threshold) => ({
              ...threshold,
              comparison: { ...threshold.comparison, boundary: "1000000" },
            })),
          },
        };
      }
      return documents;
    };
    let configurationDocuments = assessmentConfigurationDocuments();
    /**
     * 已发布配置释放引用按 `definitionType` 归档：预测模型工件必须引用 C18 真实发布的
     * 措施库释放（`consistentWithPolicy` 会逐字段比对），不能在工件里另写一个引用。
     */
    const publishedConfigurationReleaseRefs = new Map();
    /**
     * 单类配置的发布（提交 → 审核 → 发布）。`forecast-policy` 的正文必须带真实模型工件引用，
     * 而该工件要等 `measure-library` 发布后才拿得到措施库释放，所以它被推迟到工件登记之后再发。
     */
    const publishConfigurationDefinition = async (definitionType, documents, suffix = "") => {
      const submitCommandId = `${PROJECT_ID}:${definitionType}:submit${suffix}`;
      const submitAuthorization = await operatorAuth(
        submitCommandId,
        "knowledge-modeling.submit-revision",
      );
      // C18 按媒体类型区分配置正文：普通 JSON 工件在读取时会被判为类型不符。
      const artifactRef = await putBody(
        `demo-c18-config-${definitionType}${suffix}`,
        "assessment-configuration",
        new TextEncoder().encode(JSON.stringify(documents[definitionType], null, 2)),
        "application/vnd.riskflow.assessment-configuration+json",
        submitAuthorization,
        "knowledge-modeling.govern",
      );
      const submitted = await knowledgeGovernance.govern(
        KnowledgeGovernanceCommandV1Schema.parse({
          kind: "submit-revision",
          commandId: submitCommandId,
          idempotencyKey: submitCommandId,
          projectId: PROJECT_ID,
          actorId: submitAuthorization.actorId,
          issuedAt: NOW,
          authorization: submitAuthorization,
          payload: {
            definitionType,
            ...(publishedConfigurationReleaseRefs.has(definitionType)
              ? { baseReleaseRef: publishedConfigurationReleaseRefs.get(definitionType) }
              : {}),
            candidateArtifactRef: artifactRef,
            evidenceReferences: [
              {
                locator: { sourceSegmentId: `${definitionType}:demo-browser-evidence` },
                sourceVersion: { entityId: "demo-browser-source", versionId: "1" },
              },
            ],
          },
        }),
      );
      if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") {
        throw new Error(
          `C18 submit 失败 ${definitionType}: ${JSON.stringify(submitted).slice(0, 500)}`,
        );
      }
      publishedConfigurationReleaseRefs.set(
        definitionType,
        await publishApprovedRelease(submitted.result.knowledgeRevisionRef),
      );
    };
    // 合成样本、待甲方复核：同一定义的新矩阵经真实提交、审核和发布。
    const publishNextRiskMatrix = async () => {
      const oldReleaseRef = publishedConfigurationReleaseRefs.get("risk-matrix");
      const suffix = `:historical-matrix-${Date.now()}`;
      const documents = structuredClone(configurationDocuments);
      documents["risk-matrix"].content.matrixVersion = "2026.10";
      const matrixRef = {
        entityId: documents["risk-matrix"].content.matrixId,
        versionId: "2026.10",
      };
      for (const type of [
        "risk-matrix",
        "risk-acceptance-threshold",
        "monitoring-warning-threshold",
      ]) {
        if (type !== "risk-matrix") documents[type].content.riskMatrixRef = matrixRef;
        await publishConfigurationDefinition(type, documents, suffix);
      }
      return { oldReleaseRef, newReleaseRef: publishedConfigurationReleaseRefs.get("risk-matrix") };
    };
    const configurationTypes = Object.keys(configurationDocuments).sort();
    for (const definitionType of configurationTypes) {
      if (definitionType === "forecast-policy") continue;
      await publishConfigurationDefinition(definitionType, configurationDocuments);
    }

    // 预测模型工件先于 `forecast-policy` 登记，`forecast-policy` 紧随其后发布；两者都必须在
    // C19 之前完成，因为 C19 编制规则时要按已发布释放解析成员。
    /**
     * C28 效果预测模型工件（合成样本、待甲方复核）。
     *
     * 正文引用经 C04 登记后才是内容寻址引用，`forecast-policy` 配置正文的 `requiredRef`
     * 必须逐字等于它：预测执行器按精确 requiredRef 匹配实现，填占位字面量会让执行器永远
     * 找不到实现（C28 记 `executor-unavailable`）。因此该工件必须先于 `forecast-policy`
     * 发布，而措施库释放又必须先于本工件——发布顺序由此确定。
     *
     * 方法与策略一致（monitoring-trend，目标指标取自身序列）；`measureLibraryReleaseRef`
     * 必须逐字段等于 C18 真实发布的措施库释放，否则 `consistentWithPolicy` 会拒绝。
     */
    const forecastModelArtifactRef = await putJson(
      "demo-c28-forecast-model",
      EFFECT_FORECAST_MODEL_PURPOSE_CODE_V1,
      {
        schemaVersion: "1",
        // 模型工件按 `EffectForecastModelArtifactV1Schema` 收口：工程与算法版本是必填的固定
        // 身份，缺任何一项都会被读侧判 `response-forecast-result-invalid` 而不是可读的模型。
        projectId: PROJECT_ID,
        algorithmVersion: "parameter-forecast-v1",
        method: DEMO_FORECAST_POLICIES[0].method,
        inputIndicators: [{ indicatorId: DEMO_FORECAST_POLICIES[0].targetIndicatorId, unit: "mm" }],
        targetIndicatorId: DEMO_FORECAST_POLICIES[0].targetIndicatorId,
        unit: "mm",
        stepMs: 1000,
        maxHorizonSteps: 4,
        calculationScale: 6,
        measureLibraryReleaseRef:
          publishedConfigurationReleaseRefs.get("measure-library")?.reference,
        // 措施效果按零偏移登记：预测值完全由沉降序列趋势外推，不叠加处置增益，
        // 保证趋势口径与 2 mm/s 的演示序列一致。
        measureEffects: DEMO_MEASURE_IDS.slice(0, 1).map((measureId) => ({
          measureId,
          offset: "0",
          perStep: "0",
        })),
        evidenceReferences: [
          {
            locator: {
              sourceSegmentId: `${sourceA.sourceVersionRef.reference.entityId}-chapter_1-segment_1`,
            },
            sourceVersion: sourceA.sourceVersionRef.reference,
          },
        ],
        sampleOrigin: "synthetic",
        // 合成样本只能是「待甲方复核」，取值必须落在 Schema 的两个枚举值内。
        reviewStatus: "pending-client-review",
        parameters: { windowPoints: 6 },
      },
      await operatorAuth("demo-c28-forecast-model", "knowledge-modeling.submit-revision"),
      "knowledge-modeling.govern",
    );
    configurationDocuments = assessmentConfigurationDocuments(forecastModelArtifactRef.reference);
    await publishConfigurationDefinition("forecast-policy", configurationDocuments);

    // ---- C19 规则编制与适用规则集发布 ----
    //
    // 编制候选经 C08 任务的确定性校验与收口后才成为正式修订；随后 C19 消费 C11
    // 冻结的评估准备快照组装适用规则集，同样走 C16/C07 发布。最后 `resolve` 按
    // 准备快照物化正式依据集合——评估子图 A1 消费的正是这个引用。
    //
    // 每个被加权指标各走一轮完整链路：适用规则集的 `includedMembers` 按 release 唯一，
    // 同一次发布里放两条规则在组装时会被拒。C19 内部按用途派生各自的读取身份：同一
    // requestId 读两个工件会在 C04 访问记录上撞出幂等冲突（commandId 是 requestId+outcome，
    // 幂等键却按用途不同）。
    for (const indicatorId of DEMO_CONFIGURATION_INDICATOR_IDS) {
      const authoringCommandId = `${PROJECT_ID}:c19-authoring-${indicatorId}`;
      const authoringPrepared = await scoringRules.prepareAuthoring({
        requestId: authoringCommandId,
        idempotencyKey: authoringCommandId,
        projectId: PROJECT_ID,
        actorId: (await operatorAuth(authoringCommandId, "knowledge-modeling.assessment-basis"))
          .actorId,
        requestedAt: NOW,
        authorization: await operatorAuth(
          authoringCommandId,
          "knowledge-modeling.assessment-basis",
        ),
        // C19 按 (工程, 清洗任务) 缓存首次的 C15 读取身份，并用它自己的 requestId 向 C06
        // 复验，因此签发标识必须与 requestId 同值。C15 的 `readBoundResult` 只按
        // `engineering-data.evidence-access` 复验，正文能否读到由 C04 的访问快照
        // （工程+空间+来源+策略）判定，所以这里必须带上清洗结果的来源范围。
        dataCleaningAuthorization: await operatorAuth(
          authoringCommandId,
          "engineering-data.evidence-access",
          [convertibleSourceVersionRef],
        ),
        projectRevisionRef: { kind: "project-revision", reference: projectRevisionRef.reference },
        dataCleaningTaskRef,
        requiredAt: NOW,
        asOfRecordedAt: NOW,
        scoringPolicyRef: scoringRulesPolicy.policyRef,
        sourceStandardKinds: ["国家标准"],
        ...(declaredBaseReleaseRefs.get("structured-scoring-rule") === undefined
          ? {}
          : { baseRuleReleaseRef: declaredBaseReleaseRefs.get("structured-scoring-rule") }),
      });
      if (authoringPrepared.kind !== "succeeded") {
        throw new Error(
          `C19 prepareAuthoring 失败: ${JSON.stringify(authoringPrepared).slice(0, 600)}`,
        );
      }
      const authoringTask = await scoringAgentTasksRef.current.getTask(
        authoringPrepared.agentTaskRef,
      );
      if (authoringTask === undefined) {
        throw new Error("C19 编制任务未持久化");
      }
      const finalizedRule = await scoringRules.finalizeAuthoringCandidate({
        task: authoringTask,
        candidate: {
          schemaVersion: "1",
          candidateVersion: 1,
          // 权重集里每个指标都必须有一条评分规则，否则 C25 在评分覆盖检查处以
          // `risk-assessment-rule-coverage` 关闭失败；一次编制只带一条，因为适用规则集的
          // `includedMembers` 按 release 唯一。`indicatorItem` 用 C18 已发布的指标标识，
          // 编制候选按 indicatorIds 集合校验。
          operations: [
            {
              kind: "add-rule",
              ruleId: `RULE-${indicatorId}`,
              rule: {
                ruleId: `RULE-${indicatorId}`,
                applicabilityConditions: {
                  constructionMethod: ["变径盾构法"],
                  stratumCondition: ["富水软弱地层"],
                  engineeringStage: ["变径空间扩挖"],
                },
                indicatorItem: indicatorId,
                // 演示阈值：按指标各自的量纲给分档线。评分规则是「命中即取值」：实际值必须落在
                // 某条分档线上，否则按 `scoring-value-out-of-range` 拒绝。沉降短期速率的序列
                // 实际值是 2 mm/s，因此它需要一条它能命中的 mm/s 量纲分档线（0.5 是监测预警
                // 阈值，2 ≥ 0.5 所以速率预警照常开出），并配一条从 0 起的完整等级区间。
                // 该指标基础分与累计沉降同为 3，后果侧 `maximum` 组合结果不变，P/C 与风险
                // 等级不因新增该指标而移动。
                scoringThresholds:
                  indicatorId === POSSIBILITY_DEMO_INDICATOR_ID
                    ? [
                        {
                          thresholdId: "demo-th-chamber-pressure",
                          score: 3,
                          value: 300,
                          operator: "gte",
                        },
                      ]
                    : indicatorId === SETTLEMENT_SLOPE_DEMO_INDICATOR_ID
                      ? [
                          {
                            thresholdId: "demo-th-settlement-slope",
                            score: 3,
                            value: 1,
                            operator: "gte",
                          },
                        ]
                      : [
                          {
                            thresholdId: "demo-th-settlement",
                            score: 3,
                            value: 10,
                            operator: "gte",
                          },
                        ],
                gradeIntervals:
                  indicatorId === SETTLEMENT_SLOPE_DEMO_INDICATOR_ID
                    ? [
                        // 等级区间必须首尾相接且不重叠：上界缺省会当成 +∞，两段就叠在一起了。
                        { grade: "demo-level-1", lowerBound: 0, upperBound: 3 },
                        { grade: "demo-level-3", lowerBound: 3 },
                      ]
                    : [{ grade: "demo-level-3", lowerBound: 3 }],
                exceptionClauses: [],
                // 证据定位符必须命中 C15 保留的资料段，否则整份候选按证据未核实拒绝。
                evidenceLocator: { sourceSegmentId: retainedSourceSegments[0].sourceSegmentId },
                ruleVersion: {
                  entityId: `RULE-${indicatorId}`,
                  versionId: "1",
                },
                // 编制候选只能是待审状态：批准由 C07 审核决定，Agent 无权自行置为已批准。
                reviewStatus: "pending",
              },
              sourceVersionRef: retainedSourceSegments[0].sourceVersionRef,
              evidenceReferences: [
                {
                  locator: { sourceSegmentId: retainedSourceSegments[0].sourceSegmentId },
                  // 证据引用的 `sourceVersion` 是扁平版本引用；`sourceVersionRef` 才是带
                  // `reference` 包裹的来源版本。两者形状不同，不能互相套用。
                  sourceVersion: retainedSourceSegments[0].sourceVersionRef.reference,
                },
              ],
            },
          ],
        },
      });
      if (finalizedRule.status !== "completed" || !("candidateRef" in finalizedRule)) {
        throw new Error(`C19 候选收口失败: ${JSON.stringify(finalizedRule).slice(0, 1200)}`);
      }
      // 下一轮的检测基线就是本轮刚发布的这次释放。
      declaredBaseReleaseRefs.set(
        "structured-scoring-rule",
        await publishApprovedRelease(finalizedRule.candidateRef),
      );
    }

    // C11 冻结评估准备快照：评估子图 A0 的入口身份由它铸出，A1 再据此解析依据。
    // C11 冻结评估准备快照：评估子图 A0 的入口身份由它铸出，A1 再据此解析依据。
    // 授权要覆盖待评估风险记录登记的全部来源：冻结内部先按授权修订有界解析来源，
    // 读取再按记录自身的精确空间与来源复验，两者任一不覆盖都会以 AUTHORIZATION_DENIED 关闭。
    const preparationCommandId = `${PROJECT_ID}:c11-preparation`;
    const preparationSourceRefs = [
      ...new Map(
        [
          ...retainedSourceSegments.map((entry) => entry.sourceVersionRef),
          sourceA.sourceVersionRef,
        ].map((ref) => [ref.reference.entityId, ref]),
      ).values(),
    ];
    const preparationAuthorization = await operatorAuth(
      preparationCommandId,
      "engineering-data.assessment-preparation",
      preparationSourceRefs,
    );
    const preparationFrozen = await registry.freeze({
      commandId: preparationCommandId,
      idempotencyKey: preparationCommandId,
      projectId: PROJECT_ID,
      actorId: preparationAuthorization.actorId,
      issuedAt: NOW,
      authorization: preparationAuthorization,
      kind: "assessment-preparation",
      payload: {
        riskInput: { kind: "standardized-risk-record", reference: recordAutoRef.reference },
        projectRevisionRef: { kind: "project-revision", reference: projectRevisionRef.reference },
        spatialScopeRef,
        applicabilityMetadataSnapshotRef: applicabilitySnapshotRef,
        entryMode: "assess",
        triggerReasonCode: "demo-browser-preparation",
        monitoringSnapshotRefs: [
          settlementMonitoringSnapshotRef,
          slurryPressureMonitoringSnapshotRef,
        ],
      },
    });
    if (
      preparationFrozen.kind !== "succeeded" ||
      preparationFrozen.result.kind !== "assessment-preparation"
    ) {
      throw new Error(`C11 评估准备冻结失败: ${JSON.stringify(preparationFrozen).slice(0, 600)}`);
    }
    const preparationSnapshotRef = preparationFrozen.result.assessmentPreparationSnapshotRef;

    // C19 组装适用规则集：消费准备快照投影与已发布配置，产出待发布的规则集修订。
    const assemblyCommandId = `${PROJECT_ID}:c19-assembly`;
    // 组装经 C11 准备快照投影读取依据成员，内部按 `knowledge-modeling.assessment-basis`
    // 分支另签精确上下文；该分支只带 `knowledge-modeling.read`，但仍需覆盖准备快照登记的
    // 来源范围，否则下游复验会以 AUTHORIZATION_DENIED 关闭。
    const assemblyAuthorization = await operatorAuth(
      assemblyCommandId,
      "knowledge-modeling.assessment-basis",
      preparationSourceRefs,
    );
    const assembled = await scoringRules.assembleApplicableRuleSetRevision({
      requestId: assemblyCommandId,
      idempotencyKey: assemblyCommandId,
      projectId: PROJECT_ID,
      actorId: assemblyAuthorization.actorId,
      requestedAt: NOW,
      authorization: assemblyAuthorization,
      projectRevisionRef: { kind: "project-revision", reference: projectRevisionRef.reference },
      preparationSnapshotRef,
      applicabilitySnapshotRef: applicabilitySnapshotRef,
      applicability: {
        constructionMethod: "变径盾构法",
        stratumCondition: "富水软弱地层",
        engineeringStage: "变径空间扩挖",
      },
      requiredAt: NOW,
      asOfRecordedAt: NOW,
      scoringPolicyRef: scoringRulesPolicy.policyRef,
      assemblyPolicyRef: scoringRulesPolicy.assemblyPolicyRef,
      compatibilityRef: scoringRulesPolicy.compatibilityRef,
      configurationSetRef,
    });
    if (assembled.kind !== "succeeded") {
      throw new Error(`C19 组装失败: ${JSON.stringify(assembled).slice(0, 600)}`);
    }
    await publishApprovedRelease(assembled.applicableRuleSetRevisionRef);

    // ---- C27 处置建议：Agent 任务契约与 C08 只读接缝 ----
    //
    // C27 按部署登记的 Agent 策略派生 C08 任务信封，候选经确定性校验后成为正式建议。
    // 任务定义的增量端口回指 C27 适配器自身——C27 既是任务定义的所有者，也是校验者，
    // 因此这里用延迟绑定打破构造期循环，不预先伪造候选。
    const responseAgentPolicy = createResponseAgentPolicy({ projectId: PROJECT_ID });
    const recommendationAdapterRef = {};
    const recommendationTaskDefinition = createResponseRecommendationTaskDefinition({
      policy: responseAgentPolicy,
      port: {
        validateIncrement: (input) => recommendationAdapterRef.current.validateIncrement(input),
        finalizeIncrement: (input) => recommendationAdapterRef.current.finalizeIncrement(input),
      },
    });
    /**
     * C29 校准建议的 Agent 任务定义：领域校验由 C29 自己在 `createSuggestion` 收口，
     * 任务定义这一侧只做候选自洽校验（证据条数、操作条数、引用绑定）。
     */
    const calibrationAgentPolicy = {
      definitionRef: CALIBRATION_VALIDATION_POLICY.definitionRef,
      toolPolicyRef: CALIBRATION_VALIDATION_POLICY.toolPolicyRef,
      incrementSchemaRef: CALIBRATION_VALIDATION_POLICY.incrementSchemaRef,
      validationPolicyRef: CALIBRATION_VALIDATION_POLICY.validationPolicyRef,
      budgetPolicy: CALIBRATION_VALIDATION_POLICY.budgetPolicy,
      evidenceRequirementCount: CALIBRATION_VALIDATION_POLICY.evidenceRequirementCount,
      maxOperations: CALIBRATION_VALIDATION_POLICY.maxOperations,
    };
    /**
     * C29 校验工件的引用：版本必须等于真实登记工件的正文摘要，否则任务收口打开该引用时
     * 会被工件守卫判为不存在。登记与引用走同一个派生函数，两处不会漂移。
     */
    const calibrationValidationBody = (taskRef, resultRef, bound) =>
      JSON.stringify({ schemaVersion: "1", taskRef, resultRef, bound });
    const calibrationValidationArtifactId = (taskRef) =>
      `demo-c29-validation:${taskRef.reference.entityId}`;
    const calibrationValidationArtifactRef = (taskRef, resultRef, bound) => ({
      kind: "content-artifact",
      reference: {
        entityId: calibrationValidationArtifactId(taskRef),
        versionId: `sha256:${sha(calibrationValidationBody(taskRef, resultRef, bound))}`,
      },
    });

    const calibrationTaskDefinition = createCalibrationSuggestionTaskDefinition({
      policy: calibrationAgentPolicy,
      port: {
        // 端口方法名是 `validateIncrement` / `finalizeIncrement`；这里写任务定义层的同名方法
        // 会让工厂在调用时拿到 undefined，校验步骤直接抛 TypeError。
        // 候选自洽：任务、结果与冻结输入三个引用必须落在本次任务上。
        validateIncrement: ({ candidate, task }) => {
          const bound =
            candidate.taskRef.reference.entityId ===
              task.envelope.agentTaskRef.reference.entityId &&
            candidate.resultRef.agentTaskRef.reference.entityId ===
              task.envelope.agentTaskRef.reference.entityId;
          return {
            schemaVersion: "1",
            items: [
              {
                checkId: "candidate-bound-to-task",
                disposition: bound ? "accepted" : "rejected",
                // 被拒项按契约必须带拒收类别，证据取候选自带的那些引用。
                ...(bound ? {} : { rejectionClass: "repairable" }),
                reasonCode: bound ? "candidate-bound" : "candidate-task-mismatch",
                evidenceReferences: candidate.evidenceReferences,
              },
            ],
            disposition: bound ? "accepted" : "rejected",
            ...(bound ? {} : { rejectionClass: "repairable" }),
            // 工件引用版本必须按内容摘要给出（契约要求 `sha256:<64 hex>`），
            // 不能用递增序号占位。
            validationArtifactRef: calibrationValidationArtifactRef(
              task.envelope.agentTaskRef,
              candidate.resultRef,
              bound,
            ),
            validatedAt: NOW,
          };
        },
        finalizeIncrement: ({ candidate, task }) =>
          buildCompletedAgentTaskResult(task.envelope.agentTaskRef, {
            kind: "calibration-suggestion",
            reference: candidate.inputSnapshotRef.reference,
          }),
      },
    });
    registeredAgentTaskDefinitions.push(recommendationTaskDefinition, calibrationTaskDefinition);
    const recommendationAgentTasks = new PostgresAgentTaskAdapter({
      db: appRuntime.db,
      // 同一注册表承载 C27 与 C29 两类任务定义，C29 读的也是这一个适配器里的完成任务。
      registry: new AgentTaskDefinitionRegistry([
        recommendationTaskDefinition,
        calibrationTaskDefinition,
      ]),
      transactionUnit,
      artifactStore,
      referenceGuard: artifactStore.referenceGuard,
      authorization: access,
    });

    /**
     * C08 记账工件：任务信封、候选、增量与动作结果都按 C04 登记真实工件，引用进入
     * C08 行与领域事实。用途码与媒体类型取任务定义族既有取值，不另造一套。
     */
    const agentArtifact = async (artifactId, purposeCode, mediaType, value) =>
      await putJson(artifactId, purposeCode, value, agentArtifactAuth, "knowledge-modeling.govern");
    // 记账工件按知识提交分支签发、写能力用 `knowledge-modeling.govern`（能力码不是分支）。
    const agentArtifactAuth = await operatorAuth(
      "demo-c08-bookkeeping",
      "knowledge-modeling.submit-revision",
    );
    const agentIntentArtifactRef = await agentArtifact(
      "demo-c08-action-intent",
      "agent-action-intent",
      "application/vnd.riskflow.agent-action-intent+json",
      { schemaVersion: "1", role: "agent-action-intent" },
    );
    const agentCandidateArtifactRef = await agentArtifact(
      "demo-c08-candidate",
      "agent-candidate",
      "application/vnd.riskflow.agent-candidate+json",
      { schemaVersion: "1", role: "agent-candidate" },
    );
    const agentIncrementArtifactRef = await agentArtifact(
      "demo-c08-increment",
      "agent-increment",
      "application/vnd.riskflow.agent-increment+json",
      { schemaVersion: "1", role: "agent-increment" },
    );
    const agentActionResultArtifactRef = await agentArtifact(
      "demo-c08-action-result",
      "agent-action-result",
      "application/vnd.riskflow.agent-action-result+json",
      { schemaVersion: "1", role: "agent-action-result" },
    );

    /**
     * C28 人工反馈文档工件（人工提交的业务输入，非「播种已写成功」）。
     *
     * `warning-response.record-feedback` 的 `feedbackArtifactRef` 必须指向按
     * `warning-response.feedback-artifact` 用途码真实登记的工件：C28 在记录反馈的同一
     * 事务里以 `knowledge-modeling.measure-candidates` 分支读取正文并校验用途码。正文是
     * 一份人工填写的反馈说明，由 C28 解析为 JSON 后随反馈记录一起持久回读。
     */
    /**
     * 反馈工件的写入口按 C28 的读取接缝对齐：同一 `knowledge-modeling.measure-candidates`
     * 分支、同一个 `knowledge-modeling.retrieve` 能力。写读两侧分支与能力一致，工件才在
     * 记录反馈时以用途码命中并被 C28 解析。
     */
    const feedbackArtifactAuth = await operatorAuth(
      "demo-c28-feedback-artifact",
      "knowledge-modeling.measure-candidates",
      [sourceA.sourceVersionRef],
    );
    const feedbackArtifactRef = await putJson(
      "demo-c28-feedback-document",
      FEEDBACK_ARTIFACT_PURPOSE_CODE_V1,
      {
        schemaVersion: "1",
        summary: "处置后地表沉降实测值仍高于采纳前趋势预测，反馈至本次处置闭环。",
        observations: [
          "执行后监测快照的地表沉降累计值与采纳前趋势外推值存在超过阈值的偏差。",
          "已按采纳建议完成现场复核，未再新增处置动作。",
        ],
        recordedByRole: "field-responder",
        // 反馈文档按证据引用回指本次评估所用的真实来源段，不写不存在的来源。
        evidenceReferences: [
          {
            locator: {
              sourceSegmentId: `${sourceA.sourceVersionRef.reference.entityId}-chapter_1-segment_1`,
            },
            sourceVersion: sourceA.sourceVersionRef.reference,
          },
        ],
      },
      feedbackArtifactAuth,
      "knowledge-modeling.retrieve",
    );

    /**
     * C08 有界任务的真实驱动（合成样本、待甲方复核）。
     *
     * 走完整生命周期：启动 → 领取 → 预留动作（消耗预算）→ 领域定义逐项校验候选 →
     * 登记候选版本 → 领域定义收口增量 → 完成动作与任务。候选是冻结的合成选择，
     * 接受与否由领域的确定性校验决定；这里不预置结论，也不返回伪造的成功引用。
     */
    const driveAgentTask = async (input) => {
      const taskRef = input.taskRef ?? (await startAgentTaskFor(input.startCommand));
      // 动作身份按任务引用派生：任务可能由调用方先启动再交回驱动（此时没有启动命令），
      // 用 `input.startCommand.commandId` 会读到 undefined。
      const actionPrefix = input.startCommand?.commandId ?? taskRef.reference.entityId;
      let claim;
      for (let attempt = 0; attempt < 32; attempt += 1) {
        claim = await agentTasks.claim({ workerId: input.workerId, leaseDurationMs: 600_000 });
        if (claim === undefined) break;
        if (claim.task.envelope.agentTaskRef.reference.entityId === taskRef.reference.entityId)
          break;
        await agentTasks.releaseLease({
          taskRef: claim.task.envelope.agentTaskRef,
          workerId: input.workerId,
          leaseToken: claim.leaseToken,
          status: "cancelled",
        });
        claim = undefined;
      }
      if (claim === undefined) throw new Error("C08 领取本任务失败");
      const actionId = `${actionPrefix}:model-invocation`;
      const reservation = await agentTasks.reserveAction({
        taskRef,
        workerId: input.workerId,
        leaseToken: claim.leaseToken,
        actionId,
        reservationId: `${actionId}:reservation`,
        actionType: "model-invocation",
        sequence: 0,
        idempotencyKey: actionId,
        intentArtifactRef: agentIntentArtifactRef,
        amount: { modelInvocations: 1 },
      });
      const increment = input.buildIncrement(reservation.task);
      const validation = AgentValidationResultV1Schema.parse(
        await input.definition.validateCandidate(increment, reservation.task),
      );
      const rejected = validation.items.some((item) => item.disposition === "rejected");
      // 结果引用必须在登记候选时就写上：C08 读完成任务按「候选行保存的公共结果引用」
      // 核对任务结果，候选行没有 `result_ref` 就永远读不回完成结果。
      // 候选版本与后续动作、任务收口一律用 C08 适配器自己的时钟。运行单的 `issuedAt` 早于
      // 本次领取，把它传给收尾调用会让尝试行的 `lease_until` 落到 `started_at` 之前，
      // 被 `agent_task_attempts_lease_ck` 判为非法的租约时间线。
      const finalized = input.definition.finalizeCandidate
        ? await input.definition.finalizeCandidate(increment, reservation.task)
        : undefined;
      await agentTasks.recordCandidate({
        candidate: AgentCandidateVersionV1Schema.parse({
          schemaVersion: "1",
          taskRef,
          candidateVersion: 1,
          parentCandidateVersion: 0,
          candidateArtifactRef: agentCandidateArtifactRef,
          incrementArtifactRef: input.incrementArtifactRef ?? agentIncrementArtifactRef,
          validation,
          ...(finalized === undefined ? {} : { resultRef: finalized }),
          disposition: rejected ? "rejected" : "pending",
          ...(rejected ? { rejectionClass: "repairable" } : {}),
          createdAt: new Date().toISOString(),
        }),
        workerId: input.workerId,
        leaseToken: claim.leaseToken,
      });
      if (rejected) {
        await agentTasks.failAction({
          taskRef,
          workerId: input.workerId,
          leaseToken: claim.leaseToken,
          actionId,
          error: makeAgentError({
            code: "AGENT_VALIDATION_REJECTED",
            category: "validation",
            stage: `${input.workerId}.validation`,
            taskRef,
            reasonCode: "increment-outside-frozen-input",
          }),
          resultArtifactRef: agentActionResultArtifactRef,
          usage: emptyAgentBudgetUsage(),
        });
        await agentTasks.releaseLease({
          taskRef,
          workerId: input.workerId,
          leaseToken: claim.leaseToken,
          status: "released",
        });
        return { kind: "rejected", taskRef, validation };
      }
      await agentTasks.completeAction({
        taskRef,
        workerId: input.workerId,
        leaseToken: claim.leaseToken,
        actionId,
        resultArtifactRef: agentActionResultArtifactRef,
        usage: emptyAgentBudgetUsage(),
        activeWallClockMs: 1_000,
      });
      await agentTasks.completeTask({
        taskRef,
        workerId: input.workerId,
        leaseToken: claim.leaseToken,
        resultRef: finalized,
      });
      return {
        kind: "completed",
        taskRef,
        ...(finalized === undefined ? {} : { resultRef: finalized }),
        validation,
      };
    };

    const agentTasks = recommendationAgentTasks;

    /** 启动一个 C08 有界任务：授权按启动命令的 commandId 现签，不复用其它用途的上下文。 */
    const startAgentTaskFor = async (startCommand) => {
      const started = await agentTasks.startTask(
        StartAgentTaskCommandV1Schema.parse({
          ...startCommand,
          authorization: await operatorAuth(startCommand.commandId, "agent-task.start-task", [
            ...downstreamSourceVersionRefs,
          ]),
        }),
      );
      if (started.kind !== "succeeded") {
        throw new Error(`C08 start-task 失败: ${JSON.stringify(started).slice(0, 500)}`);
      }
      return started.result.agentTaskRef;
    };

    /**
     * C27 组合 Agent 接缝（真实 C08 任务，合成样本、待甲方复核）。
     *
     * 候选选择按已发布措施库冻结（按 `measureId` 升序），是否落在本次冻结候选集合内
     * 由 C27 的确定性校验判定：被拒就按 `repairable` 收口，任务不会带着未通过校验的
     * 增量完成。正式建议仍由 C27 随后的三项校验与人工采纳决定。
     */
    const RECOMMENDATION_WORKER_ID = "demo-c27-recommendation-worker";
    /**
     * C29 校准组合 Agent 接缝（真实 C08 任务，合成样本、待甲方复核）。
     *
     * 增量是 C29 领域候选的完整正文，按 `agent-increment` 用途码登记为真实工件：C29
     * 随后的 `createSuggestion` 会按该引用回读并对冻结目标文档做确定性校验，候选是否
     * 成立由它裁决，这里不预判。操作取自已发布的风险可接受阈值，把可接受等级上限放宽
     * 一级——放宽而非收紧，避免把演示数据推成「全部越限」。
     */
    const CALIBRATION_WORKER_ID = "demo-c29-calibration-worker";
    const calibrationAgent = {
      ensureTask: async (input) => {
        const commandId = `${input.actionId}:calibration-agent`;
        const taskRef = await agentTasks
          .startTask(
            StartAgentTaskCommandV1Schema.parse({
              kind: "start-task",
              commandId,
              idempotencyKey: commandId,
              projectId: input.run.projectId,
              actorId: input.run.actorId,
              issuedAt: input.run.issuedAt,
              authorization: await operatorAuth(commandId, "agent-task.start-task", [
                ...downstreamSourceVersionRefs,
              ]),
              payload: {
                taskType: "calibration-suggestion",
                triggerMode: "embedded",
                parentRunRef: input.run.runRef,
                // 任务信封冻结的输入必须是冻结输入**工件**引用（C29 按 content-artifact 读取它
                // 取回快照正文）；快照引用只留在候选正文里。
                frozenInputRef: input.frozenInputRef,
                modelDeploymentRef: calibrationAgentPolicy.budgetPolicy.modelDeploymentRef,
                promptTemplateRef: calibrationAgentPolicy.budgetPolicy.promptTemplateRef,
                toolPolicyRef: calibrationAgentPolicy.toolPolicyRef,
                budgetPolicyRef: calibrationAgentPolicy.budgetPolicy.policyRef,
                incrementSchemaRef: calibrationAgentPolicy.incrementSchemaRef,
                validationPolicyRef: calibrationAgentPolicy.validationPolicyRef,
              },
            }),
          )
          .then((result) => (result.kind === "succeeded" ? result.result.agentTaskRef : undefined));
        if (taskRef === undefined) {
          return { kind: "failed", reasonCode: "calibration-agent-task-not-started" };
        }
        // 结果引用由任务身份派生，候选正文与任务结果引用同一个，因此先算引用再写工件。
        const resultRef = buildCompletedAgentTaskResult(taskRef, {
          kind: "calibration-suggestion",
          reference: input.inputSnapshotRef.reference,
        });
        const candidate = CalibrationCandidateV1Schema.parse({
          schemaVersion: "1",
          taskRef,
          resultRef,
          inputSnapshotRef: input.inputSnapshotRef,
          rationale: "偏差超出当前可接受阈值上限，放宽一档后复核是否需要收紧监测。",
          evidenceReferences: DEMO_CALIBRATION_EVIDENCE,
          operations: DEMO_CALIBRATION_OPERATIONS,
        });
        const incrementArtifactRef = await putBody(
          `${commandId}:increment`,
          "agent-increment",
          new TextEncoder().encode(JSON.stringify(candidate, null, 2)),
          "application/vnd.riskflow.agent-increment+json",
          agentArtifactAuth,
          "knowledge-modeling.govern",
        );
        // 校验工件必须真实登记：任务收口会按 `validationArtifactRef` 打开它，
        // 只给引用不落库会被工件守卫判为引用不存在。
        // 工件标识必须与端口给出的引用逐字一致：任务收口按引用去打开，登记用别的 id
        // 就会在守卫处被判为引用不存在。
        const validationBodyJson = calibrationValidationBody(taskRef, resultRef, true);
        await putBody(
          calibrationValidationArtifactId(taskRef),
          // 任务收口按 `agent-validation` 用途打开校验工件，登记用途必须与之一致。
          "agent-validation",
          new TextEncoder().encode(validationBodyJson),
          "application/vnd.riskflow.agent-validation+json",
          agentArtifactAuth,
          "knowledge-modeling.govern",
        );

        const driven = await driveAgentTask({
          workerId: CALIBRATION_WORKER_ID,
          issuedAt: input.run.issuedAt,
          definition: calibrationTaskDefinition,
          taskRef,
          startCommand: undefined,
          incrementArtifactRef,
          buildIncrement: () => candidate,
        });
        if (driven.kind === "rejected") {
          return { kind: "failed", reasonCode: "calibration-increment-rejected" };
        }
        return {
          kind: "completed",
          agentTaskRef: driven.taskRef,
          agentTaskResultRef: driven.resultRef,
        };
      },
    };

    const recommendationAgent = {
      resolveSiteContextRef: async (input) => ({
        entityId: `demo-site-context:${input.run.runRef.reference.entityId}`,
        versionId: "1",
      }),
      ensureTask: async (input) => {
        const commandId = `${input.actionId}:agent`;
        const driven = await driveAgentTask({
          workerId: RECOMMENDATION_WORKER_ID,
          issuedAt: input.run.issuedAt,
          definition: recommendationTaskDefinition,
          startCommand: {
            kind: "start-task",
            commandId,
            idempotencyKey: commandId,
            projectId: input.run.projectId,
            actorId: input.run.actorId,
            issuedAt: input.run.issuedAt,
            payload: {
              taskType: "response-recommendation",
              triggerMode: "embedded",
              parentRunRef: input.run.runRef,
              frozenInputRef: input.queryResultRef,
              modelDeploymentRef: responseAgentPolicy.budgetPolicy.modelDeploymentRef,
              promptTemplateRef: responseAgentPolicy.budgetPolicy.promptTemplateRef,
              toolPolicyRef: responseAgentPolicy.toolPolicyRef,
              budgetPolicyRef: responseAgentPolicy.budgetPolicy.policyRef,
              incrementSchemaRef: responseAgentPolicy.incrementSchemaRef,
              validationPolicyRef: responseAgentPolicy.validationPolicyRef,
            },
          },
          buildIncrement: () =>
            ResponseRecommendationIncrementV1Schema.parse({
              schemaVersion: "1",
              selections: DEMO_MEASURE_IDS.map((measureId, index) => ({
                measureId,
                order: index + 1,
              })),
            }),
        });
        if (driven.kind === "rejected") {
          return { kind: "failed", reasonCode: "recommendation-increment-rejected" };
        }
        return {
          kind: "completed",
          agentTaskRef: driven.taskRef,
          agentTaskResultRef: driven.resultRef,
        };
      },
    };

    // ---- C34 处置只读（design D-05）：C27→C28→C29→C41→C26 的组合窄读 ----
    //
    // 五者的 C34 读视图只消费 db 与 C06 授权复验；策略、证明、图执行器等写路径接缝
    // 一律显式未接线——它们属于处置写入，不在本装配的读取面内。
    const recommendation = createPostgresRecommendationAdapter({
      db: appRuntime.db,
      transactionUnit,
      access,
      artifactStore,
      reader: new PostgresRecommendationContextReader({
        db: appRuntime.db,
        artifactStore,
        basis: scoringRules,
        // C27 自身查询上下文只带处置域能力；依据集合与配置正文按知识读用途另签，
        // 否则 `readAssessmentBasisReleaseSet` 恒返回 unavailable，正式建议永不成立。
        authorizeDownstream,
      }),
      policies: createRecommendationPolicies({
        projectId: PROJECT_ID,
        // 现场上下文必须与候选集合落在同一空间修订上，否则正式建议关闭失败。
        spatialScopeRef,
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
        // 目标指标与已复核证据都取 C18 已发布集合里的标识：沿用旧夹具的 `MS-001`
        // 或指标显示名会让三项校验在「措施不在冻结候选/指标不匹配」处关闭失败。
        targetIndicators: DEMO_CONFIGURATION_INDICATOR_IDS.map((indicatorItem) => ({
          indicatorItem,
          targetValue: 10,
        })),
        reviewedStandardEvidence: DEMO_MEASURE_IDS.map((measureId) => ({
          measureId,
          evidenceItem: "监测日报",
        })),
        // 现场上下文取本次评估所在工序的真实事实：工序节点、状态与可用资源都来自
        // 变径空间扩挖这条工序，证据回指资料 A 的真实来源段。
        siteProcess: {
          processNodeRef: { entityId: "PN-EXPAND-02", versionId: "1" },
          processStatus: "施工中",
          availableResources: ["注浆设备"],
          constraints: [],
          evidenceReferences: [
            {
              locator: {
                sourceSegmentId: `${sourceA.sourceVersionRef.reference.entityId}-chapter_1-segment_1`,
              },
              sourceVersion: sourceA.sourceVersionRef.reference,
            },
          ],
        },
      }),
      agentTasks: recommendationAgentTasks,
      // C27 增量校验与候选建档的用途授权：按任务信封里的请求者本人签发，签发身份与
      // `invocationId` 必须逐字等于适配器复验时用的那个，否则 C06 判身份绑定不符。
      //
      // 来源集必须与下游其它分支同一份：候选工件把冻结候选集合登记为父工件，而候选集合
      // 的访问快照已并入配置文档的来源授权；少请求一个来源，C04 的父工件 `containsAll`
      // 复验就会以 `ARTIFACT_ACCESS_DENIED` 关闭，写不出一份可追溯的正式建议。
      taskAuthorization: {
        authorize: async ({ task, purpose }) => {
          const sessionToken = sessionsByAccountId.get(task.envelope.actorId);
          if (sessionToken === undefined) {
            throw new Error(`no demo session for actor ${task.envelope.actorId}`);
          }
          return (
            await access.authorize({
              invocation: { kind: "human-session", sessionToken },
              invocationId: `${task.envelope.agentTaskRef.reference.entityId}:${purpose}`,
              projectId: task.envelope.projectId,
              branch: "warning-response.create-candidate",
              requestedSpatialScopeRefs: [...task.envelope.authorization.spatialScopeRefs],
              requestedSourceVersionRefs: [...downstreamSourceVersionRefs],
            })
          ).context;
        },
      },
    });
    recommendationAdapterRef.current = recommendation;
    /**
     * C28 生产预测执行器：按已发布 C18 策略的唯一 requiredRef 装配，
     * 模型正文只经 C04 受权读取，风险状态只经 C25 只读投影重算。
     * 不下发命令能力；两个读取分支在各自 branch 上以调用者身份另取读取能力。
     */
    const forecastExecutors = createProductionEffectForecastExecutorsV1({
      // 模型工件经 C04 登记后拿到的是内容寻址引用（versionId 是 sha256 摘要），
      // 策略冻结的 `requiredRef` 是占位字面量 `{demo-policy-forecast, 1}`；执行器按精确
      // requiredRef 读取，所以这里用真实登记引用替换占位值，不改策略文档本身。
      policies: DEMO_FORECAST_POLICIES.map((policy) => ({
        ...policy,
        requiredRef: forecastModelArtifactRef.reference,
      })),
      models: createEffectForecastModelReaderV1({ artifactStore }),
      assessment: assessmentEngine,
      authorizeDownstream,
    });
    // 独立行动与建议链共用真实精确发布和正文读取，保持父请求的空间及来源上限。
    const measureReleaseReader = createPostgresKnowledgeGovernanceReadAdapter({
      db: appRuntime.db,
      access,
      artifactStore,
    });
    const responseContext = createPostgresResponseLifecycleContextReader({
      db: appRuntime.db,
      artifactStore,
      basis: scoringRules,
      monitoring: monitoringStore,
      measureReleases: {
        readPublishedMeasureReleases: async (input) => {
          const sourceVersionRefs = input.authorization.sourceAccessGrantRefs.map((grant) => {
            const source = sourceVersionsByGrant.get(
              `${grant.reference.entityId}\u0000${grant.reference.versionId}`,
            );
            if (source === undefined) throw new Error("measure source grant unavailable");
            return source;
          });
          const confirmed = [];
          for (const [index, reference] of input.measureLibraryReleaseRefs.entries()) {
            const queryId = `${input.requestId}:measure-release:${index}`;
            const authorization = await authorizeDownstream({
              branch: "knowledge-modeling.governance-read",
              invocationId: queryId,
              projectId: input.authorization.projectId,
              actorId: input.authorization.actorId,
              requestedSpatialScopeRefs: input.authorization.spatialScopeRefs,
              requestedSourceVersionRefs: sourceVersionRefs,
            });
            if (
              !isAuthorizationSubset(
                { ...input.authorization, grantedCapabilities: authorization.grantedCapabilities },
                authorization,
              )
            )
              throw new Error("measure release authorization exceeded request");
            const result = await measureReleaseReader.read({
              kind: "governance-read",
              queryId,
              projectId: authorization.projectId,
              actorId: authorization.actorId,
              requestedAt: input.requestedAt,
              authorization,
              payload: {
                operation: "read-definition-release",
                knowledgeReleaseRef: { kind: "knowledge-release", reference },
              },
            });
            if (
              result.kind !== "succeeded" ||
              result.result.definitionType !== "measure-library" ||
              result.result.releaseRef.reference.entityId !== reference.entityId ||
              result.result.releaseRef.reference.versionId !== reference.versionId
            ) {
              return [];
            }
            confirmed.push(reference);
          }
          return confirmed;
        },
      },
      authorizeDownstream,
    });
    const responseLifecycle = createPostgresResponseLifecycleAdapter({
      db: appRuntime.db,
      transactionUnit,
      access,
      reader: responseContext,
      forecastExecutors,
    });
    const calibration = createPostgresCalibrationAdapter({
      db: appRuntime.db,
      transactionUnit,
      access,
      deviationFacts: responseLifecycle,
      inputSnapshots: assessmentEngine,
      basis: scoringRules,
      artifactStore,
      // C29 只消费 C07 的复核请求与校准批准证明，不声明完整复核端口；治理只消费 C16
      // `submit-revision`，不触达发布、停用或回滚。三者都是本装配已有的真实适配器。
      agentResults: recommendationAgentTasks,
      reviews: reviewAudit,
      governance: { govern: (command) => knowledgeGovernance.govern(command) },
      authorizeDownstream,
    });
    const humanDecisionFeedback = createPostgresHumanDecisionFeedbackAdapter({
      db: appRuntime.db,
      transactionUnit,
      access,
      authorizeDownstream,
      // C41 发起的是真实 C30 运行，不走测试替身。父图组合根在本适配器之后构造（它依赖本
      // 适配器作为采纳证明），因此这里转发到运行时的实际写入口，首次调用时解析。
      workflow: {
        startRun: (command) => riskFlowComposition.runtime.workflowPort.startRun(command),
        resumeRun: (command) => riskFlowComposition.runtime.workflowPort.resumeRun(command),
        cancelRun: (command) => riskFlowComposition.runtime.workflowPort.cancelRun(command),
      },
      bindingProof: workflow.bindingProof,
      assessmentProof: assessmentEngine,
      runCompletionProof: workflow.runCompletionProof,
      responseLifecycle,
      responseContext,
      // 服务端已发布的入口控制，绝不取自客户端载荷。
      workflowStartControl: {
        graphVersion: DEMO_RISK_FLOW_CONFIG.subGraphVersions.assessment,
        retryPolicyRef: DEMO_RISK_FLOW_CONFIG.retryPolicyRef,
      },
    });
    const warningLifecycle = createPostgresWarningLifecycleAdapter({
      db: appRuntime.db,
      transactionUnit,
      access,
      assessmentContext: new PostgresWarningAssessmentContextReader({ db: appRuntime.db }),
      runtimePolicies: createWarningRuntimePolicies({
        projectId: PROJECT_ID,
        // 通知接收主体取已登录账号的精确账户引用；不从用户名或文案推断主体。
        // 收件人集合要求唯一且规范升序（C25 预警策略 strict Schema）。
        recipientActorIds: [
          operatorSession.accountRef.entityId,
          responderSession.accountRef.entityId,
          viewerSession.accountRef.entityId,
        ].sort(),
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

    /**
     * 评估图组合根（design D-11）：真实 checkpointer + C11 准备冻结 + C19 依据 + C25 评估
     * + C26 预警 + C27 处置 + C28 预测偏差 + C29 校准，全部指向本装配已建的所属适配器。
     *
     * 启动/恢复/取消三类运行控制各自按请求的精确 branch 复验当前授权；本演示装配不下发
     * 任何领域写命令，因此 `workflow` 端口保持未接线并显式失败——组合根可以构建，
     * 但不会在没有真实调用者的情况下凭空登记一次运行。
     */
    const assessmentComposition = createAssessmentGraphComposition({
      db: appRuntime.db,
      transactionUnit,
      artifactStore,
      authorization: access,
      runtimeAuthorization: {
        // 运行时端口约定：复验不通过返回 `undefined`，由运行时自己收口成
        // `RiskFlowGraphRunErrorV1`。这里若把 C06 的 AccessServiceError 直接抛出去，
        // 会被 requireRunError 归为 `unclassified-failure`，把「授权被拒」伪装成
        // 「技术故障、可重试」——同一个失败两种读法，验收无从断言。
        verifyCurrent: async (input) => {
          try {
            return (
              await access.verify({
                authorizationContextRef: input.authorization.authorizationContextRef,
                invocationId: input.invocationId,
                projectId: input.projectId,
                branch: input.branch,
                requestedSpatialScopeRefs: [],
                requestedSourceVersionRefs: [],
                requestedAt: input.requestedAt,
              })
            ).context;
          } catch {
            return undefined;
          }
        },
      },
      checkpointer,
      engineeringData: registry,
      basis: scoringRules,
      // C19 的 `assessment-basis` 解析落在 C17/C19 适配器上（按冻结准备快照物化
      // `assessment-basis-release-set`）；知识治理适配器只有 `resolveGovernedReleases`，
      // 不实现该分支，传错对象会在 A1 直接抛「resolve is not a function」。
      basisResolver: scoringRules,
      runtimePolicies: createRiskAssessmentRuntimePolicies({ projectId: PROJECT_ID }),
      riskAssessment: assessmentEngine,
      warning: warningLifecycle,
      recommendation,
      recommendationAgent,
      responseLifecycle,
      calibration,
      calibrationAgent,
      // 分段入口的冻结策略目录由部署持有：预测与校准策略只按调用方给出的精确依据集合
      // 引用解析，引用未登记即 `unavailable`，不回退到内建默认策略。
      policies: createAssessmentPolicyCatalog({
        projectId: PROJECT_ID,
        basisReader: scoringRules,
        authorizeDownstream,
        // 冻结引用必须是 C18 真实发布的 `forecast-policy` 释放：C28 会按依据集合读回该成员
        // 并逐项比对，返回策略自身的内容引用会被判 `response-forecast-policy-mismatch`。
        forecastPolicyRef: publishedConfigurationReleaseRefs.get("forecast-policy")?.reference,
      }),
      // 同一真实 C06 access：图按用途另签下游上下文（C11 冻结等），不复用运行上下文。
      authorizeDownstream,
    });
    // 组合根构建成功即证明十八项依赖齐备；运行控制端口保持未接线。

    /**
     * 风险流程父图组合根（design D-11/D-08）：评估子运行面用上面刚建的评估组合根运行时，
     * 人工采纳证明用真实 C41，重试预算只按冻结 `retryPolicyRef` 解析。
     *
     * 识别子运行面由 C24 自己的组合根提供（design D-02），本装配不代建；它以抛错标记
     * 注入——父图一旦路由到识别子运行就立即失败，而不是拿一个不存在的子运行面跑出一段
     * 无法追溯的父运行状态。
     */
    const riskFlowComposition = createRiskFlowGraphComposition({
      db: appRuntime.db,
      transactionUnit,
      artifactStore,
      authorization: access,
      runtimeAuthorization: {
        // 运行时端口约定：复验不通过返回 `undefined`，由运行时自己收口成
        // `RiskFlowGraphRunErrorV1`。这里若把 C06 的 AccessServiceError 直接抛出去，
        // 会被 requireRunError 归为 `unclassified-failure`，把「授权被拒」伪装成
        // 「技术故障、可重试」——同一个失败两种读法，验收无从断言。
        verifyCurrent: async (input) => {
          try {
            return (
              await access.verify({
                authorizationContextRef: input.authorization.authorizationContextRef,
                invocationId: input.invocationId,
                projectId: input.projectId,
                branch: input.branch,
                requestedSpatialScopeRefs: [],
                requestedSourceVersionRefs: [],
                requestedAt: input.requestedAt,
              })
            ).context;
          } catch {
            return undefined;
          }
        },
      },
      humanDecisionProof: humanDecisionFeedback,
      checkpointer,
      identificationRuntime: unwiredWritePathSeam("riskFlowIdentificationRuntime"),
      assessmentRuntime: assessmentComposition.runtime,
      // 空间配对只按调用方给出的精确来源解析，本装配不猜测验收风险的空间。
      riskSpatialPairing: { resolve: async () => undefined },
      retryPolicy: createRiskFlowRetryPolicyReader(),
      subGraphVersions: DEMO_RISK_FLOW_CONFIG.subGraphVersions,
      retryPolicyRef: DEMO_RISK_FLOW_CONFIG.retryPolicyRef,
    });
    // 两组合根构建成功即证明依赖齐备。`workflow` 写入口接父图运行时：`assess` 入口由父图
    // 直接路由到评估子运行面，不经过识别子运行面，因此不需要 C24 的识别组合根。
    // 识别子运行面仍保持抛错标记——真被路由到就立即失败，而不是跑出无法追溯的父运行状态。

    // ---- C35 窄读接缝：Agent 任务 / 复核与审计 / 报告导出 / 系统管理 / 运维 ----
    //
    // 五条接缝全部指向本装配已经持有的真实端口与同一个 PostgreSQL：
    //   - Agent 任务窄读 = C15 组合根里那个已注入 C06 verifier 的 C08 adapter 本身，
    //     它实现了 `AgentTaskReadPortV1`，不需要另造一个包装或测试替身；
    //   - 复核与审计窄读 = C07 的真实窄读适配器（同一张审计表、同一套 C06 复验）；
    //   - 报告导出窄读 = 上面那个真实报告导出服务的读面；
    //   - 系统管理 = C06 自身的系统管理端口；
    //   - 运维读取 = 下面显式实现的真实提供者。
    const agentTaskRead = cleaning.agentTaskAdapter;
    const reviewAuditRead = createPostgresReviewAuditRead({
      db: appRuntime.db,
      authorization: access,
    });

    /** 已登记的模型部署配置（合成样本、待甲方复核）：按任务信封的部署引用精确解析。 */
    const modelDeploymentConfigs = new Map(
      DEMO_MODEL_DEPLOYMENTS.map((value) => {
        const config = parseLlamaCppDeploymentConfig(value);
        return [`${config.deploymentRef.entityId}@${config.deploymentRef.versionId}`, config];
      }),
    );
    const modelDeploymentConfigFor = (ref) =>
      modelDeploymentConfigs.get(`${ref.entityId}@${ref.versionId}`);

    /**
     * C35 报告导出的真实播种（合成样本、待甲方复核）。
     *
     * 全程走生产路径：先用真实 `projection.query` 登记一次 risk-overview 查询拿到真实
     * `queryResultRef`，再把这条登记结果交给真实报告导出服务生成一次导出——绑定事务、
     * 有限全量分页、C04 耐久化与尾事务都由 C31/C04 自己完成。这里不拼 SQL 造「已完成」
     * 导出行，页面上的历史与下载因此都能回到真实工件。
     */
    const overviewQueryAuthorization = await operatorAuth(
      "demo-c35-overview-query",
      "projection.query",
    );
    // 登记时点必须早于页面真实请求时点：投影按登记时点截断事实，用未来时钟登记会让
    // 页面读不到这条查询结果。这里取装配时刻的真实时间，不用夹具的固定演示时钟。
    const c35RecordedAt = new Date().toISOString();
    const overviewQuery = await projection.queryProjection.query({
      queryId: "demo-c35-overview-query",
      projectId: PROJECT_ID,
      actorId: overviewQueryAuthorization.actorId,
      requestedAt: c35RecordedAt,
      authorization: overviewQueryAuthorization,
      kind: "query",
      payload: { queryType: "risk-overview", projectRevisionRef },
    });
    if (overviewQuery.kind !== "succeeded" || overviewQuery.result === undefined) {
      throw new Error(
        `C35 risk-overview 查询登记失败：${JSON.stringify(overviewQuery).slice(0, 400)}`,
      );
    }
    const reportQueryResultRef = overviewQuery.result.queryResultRef;
    const exportAuthorization = await operatorAuth("demo-c35-report-export", "projection.export");
    const reportExportResult = await reportExport.exportReport({
      queryId: "demo-c35-report-export",
      projectId: PROJECT_ID,
      actorId: exportAuthorization.actorId,
      requestedAt: new Date(Date.parse(c35RecordedAt) + 1).toISOString(),
      authorization: exportAuthorization,
      kind: "export",
      payload: {
        sourceRef: reportQueryResultRef,
        exportPolicyRef: DEMO_REPORT_EXPORT_POLICY.policyRef,
      },
    });
    if (reportExportResult.kind !== "succeeded") {
      throw new Error(`C35 报告导出失败：${JSON.stringify(reportExportResult).slice(0, 400)}`);
    }
    const reportExportArtifactRef = reportExportResult.result.exportArtifactRef;

    // ---- C35 运维读取提供者：健康与模型版本两个窄读面 ----
    //
    // 装配根自己实现 `SystemOperationsReadPortV1`（它不是自动生成的），事实来源只有两类：
    // 组件健康来自本装配真实持有的窄回调，模型版本来自真实 Agent 任务信封 + 已登记的
    // 版本化部署配置。没有窄回调的组件如实缺席，不为了让页面好看而编一个「可用」。
    const narrowProbe = (run) => async (_componentId, signal) => {
      const aborted = new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("probe-aborted")), { once: true });
      });
      const value = await Promise.race([run(), aborted]);
      if (signal.aborted) throw new Error("probe-aborted");
      return value;
    };
    const healthProbe = async (componentId, signal) => {
      switch (componentId) {
        // 本装配没有为 API 进程自身登记窄探针：HTTP 层健康由进程存活保证，不另造探针。
        case "api":
          return {
            status: "unknown",
            reasonCode: SYSTEM_OPERATIONS_REASON_CODES_V1.probeAbsent,
          };
        // 同一 PostgreSQL 的窄检查：只发一条 `SELECT 1`，不做迁移或表级巡检。
        case "postgresql":
          return narrowProbe(async () => {
            await appRuntime.pool.query("SELECT 1");
            return { status: "available" };
          })(componentId, signal);
        // C04 工件存储的窄检查：用真实会话授权真实打开上面那次导出工件并等到校验回执。
        // 身份固定：C06 对同一 invocationId 的同载荷重放是幂等重放，不会每次健康读取都
        // 另造一条授权上下文；C04 的读取命令也因 requestId 固定而成为同一次读取。
        // 导出对外给的是 `export-artifact` 引用，C04 只按 `content-artifact` 取正文；
        // 两者共用同一 reference（报告导出服务按同一引用生成），这里只换引用种类，不换标识。
        case "artifact-store":
          return narrowProbe(async () => {
            // 幂等键固定，载荷也必须逐字固定：`requestedAt` 每次取当前时间会让同一把幂等键
            // 配上不同载荷，C04 按幂等冲突关闭失败，探针就成了「未知」。
            const requestedAt = NOW;
            const probeAuthorization = await probeAuth(
              "demo-c35-artifact-probe",
              "projection.export",
            );
            const requestId = `demo-c35-artifact-probe:${reportExportArtifactRef.reference.versionId}`;
            const handle = await artifactStore.open({
              schemaVersion: "1",
              requestId,
              idempotencyKey: requestId,
              artifactRef: {
                kind: "content-artifact",
                reference: { ...reportExportArtifactRef.reference },
              },
              projectId: PROJECT_ID,
              actorId: probeAuthorization.actorId,
              requestedAt,
              purposeCode: "riskflow-report",
              requiredCapability: "projection.export",
              authorization: probeAuthorization,
            });
            for await (const _chunk of handle.content) void _chunk;
            await handle.verified;
            return { status: "available" };
          })(componentId, signal);
        // 本装配没有任何模型网关接线：如实呈现缺席，而不是把注册表里的引用说成可用。
        case "model-gateway":
          return {
            status: "unknown",
            reasonCode: SYSTEM_OPERATIONS_REASON_CODES_V1.modelNotConfigured,
          };
        default:
          return {
            status: "unknown",
            reasonCode: SYSTEM_OPERATIONS_REASON_CODES_V1.probeAbsent,
          };
      }
    };
    /** 模型版本：任务类型一行，全部引用取自真实注册定义元数据 + 已登记的版本化部署配置。 */
    const readModelVersions = () => {
      const items = [];
      for (const definition of registeredAgentTaskDefinitions) {
        const { metadata, budgetPolicy } = definition;
        // 任务信封引用的部署未登记时这一行就不出现：模型版本引用不猜、不补。
        const config = modelDeploymentConfigFor(budgetPolicy.modelDeploymentRef);
        if (config === undefined) continue;
        items.push({
          taskType: metadata.taskType,
          deploymentRef: config.deploymentRef,
          modelVersionRef: config.modelVersionRef,
          serverBuildRef: config.serverBuildRef,
          promptTemplateRef: budgetPolicy.promptTemplateRef,
          toolPolicyRef: budgetPolicy.toolPolicyRef,
          budgetPolicyRef: budgetPolicy.policyRef,
          supportedTriggerModes: [...metadata.supportedTriggerModes],
        });
        if (items.length >= 32) break;
      }
      return items;
    };
    const systemOperationsRead = {
      read: async (request) => {
        const capturedAt = new Date().toISOString();
        if (request.payload.kind === "health") {
          return {
            kind: "succeeded",
            result: await collectSystemOperationsHealth({
              probe: healthProbe,
              capturedAt,
              now: () => new Date(capturedAt),
            }),
          };
        }
        return {
          kind: "succeeded",
          result: { kind: "model-versions", capturedAt, items: readModelVersions() },
        };
      },
    };

    const api = buildApi({
      access,
      ports: {
        riskAssessmentRead: assessmentEngine,
        warningResponseRead: warningLifecycle,
        /**
         * C34 写命令接缝：HTTP 端口按公开命令联合分派到各领域适配器的真实方法。
         * 缺这一组注入，`warning-response.acknowledge` 等分支在 C30 直接 NOT_FOUND——
         * 页面上的确认控件永远不可用，而不是因为权限或业务前置条件。
         */
        warningResponse: {
          open: (command) => warningLifecycle.open(command),
          recommend: (command) =>
            command.kind === "create-candidate"
              ? recommendation.createCandidate(command)
              : recommendation.validateAndRecord(command),
          record: (command) => {
            if (command.kind === "acknowledge") return warningLifecycle.acknowledge(command);
            if (command.kind === "calculate-deviation") {
              return responseLifecycle.calculateDeviation(command);
            }
            return calibration.createSuggestion(command);
          },
        },
        humanDecisionFeedback: {
          record: (command) => humanDecisionFeedback.record(command),
        },
        calibrationGovernance: calibration,
        workflow: riskFlowComposition.runtime.workflowPort,
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
          // 定义正文按用途另签（design D-06）：页面列表上下文不带来源授权。
          authorizeDownstream,
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
        // ---- C35 窄读与运维端口（design D-05/D-09/D-13）：全部指向本装配真实持有的端口 ----
        // Agent 任务窄读就是 C15 组合根那个 C08 adapter 本身：它实现同一 `AgentTaskReadPortV1`，
        // 读的是同一个 `agent_tasks` 表，不另开一条数据通路。
        agentTaskRead,
        // 复核与审计窄读：C07 的真实窄读适配器，与写面同一张审计表。
        reviewAuditRead,
        // 报告导出窄读：上面那个真实报告导出服务的读面。
        projectionReportRead: reportExport.reportRead,
        // 系统管理：C06 自身的系统管理端口（六项管理动作与账号/工程目录都走它）。
        systemAdministration: access.systemAdministration,
        // 运维读取：本装配显式实现的真实提供者，见其定义处的事实来源说明。
        systemOperationsRead,
      },
      publicOrigin,
      now: () => new Date(),
    });
    /**
     * 撤权接缝：用真实 C06 `revise-membership` 改写只读验收账号的成员状态。
     *
     * 撤权不是「换一个没有权限的账号」——那只能证明从未授权。本接缝让同一个账号先按
     * `active` 完成一次真实读取，再把同一成员置为 `removed`，因此浏览器里观察到的
     * 失败闭合是真实的授权撤销，而不是从未拥有的权限。恢复时把状态改回 `active`，
     * 成员修订号由 C06 自己递增，这里不猜版本。
     */
    let viewerMembershipVersion = "1";
    const setViewerMembershipStatus = async (status) => {
      const result = await access.administerProject({
        kind: "revise-membership",
        projectId: PROJECT_ID,
        commandId: `demo-browser-viewer-membership-${status}-${viewerMembershipVersion}`,
        idempotencyKey: `demo-browser-viewer-membership-${status}-${viewerMembershipVersion}`,
        expectedVersion: {
          entityId: VIEWER_MEMBERSHIP_ID,
          versionId: viewerMembershipVersion,
        },
        authorizationContextRef: administratorContextRef,
        membershipId: VIEWER_MEMBERSHIP_ID,
        accountId: viewer.resultRef.entityId,
        roles: ["business-viewer"],
        spatialScopeRefs: [spatialScopeRef],
        status,
      });
      viewerMembershipVersion = result.resultRef.versionId;
      return result.resultRef.versionId;
    };
    const sendFile = async (reply, filePath, statusCode) => {
      const body = await readFile(filePath);
      return reply
        .code(statusCode)
        .type(CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream")
        .send(body);
    };
    const indexHtml = resolve(WEB_DIST, "index.html");
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
    // C37 D-17：生产路由已迁到 `/projects`、`/review-audit`、`/assessment/quality` 等
    // 新前缀，逐个登记深链前缀迟早还会漏。这里按 SPA 语义统一回落：
    // 任何非 `/api/`、非 `/assets/` 的 GET 都返回同一 index.html，由前端路由解析；
    // `/api/` 下的未匹配请求仍走 404 JSON，不被 SPA 吞掉。
    api.get("/assets/*", async (request, reply) => {
      const requested = request.url.split("?")[0];
      const candidate = resolve(WEB_DIST, `.${requested}`);
      if (!candidate.startsWith(`${WEB_DIST}/`) || !existsSync(candidate)) {
        return reply.code(404).send({ code: "NOT_FOUND" });
      }
      return sendFile(reply, candidate, 200);
    });
    // C37 D-17：生产路由迁到 `/projects`、`/review-audit`、`/assessment/quality` 等新前缀，
    // 逐个登记深链前缀迟早还会漏。这里按 SPA 语义统一回落：未匹配的非 API/资源 GET
    // 一律返回同一 index.html，由前端路由解析；`/api/` 下的未匹配请求仍走既有 404。
    api.get("/*", async (request, reply) => {
      const path = request.url.split("?")[0];
      if (path.startsWith("/api/") || path.startsWith("/assets/")) {
        return reply.code(404).send({ code: "NOT_FOUND" });
      }
      return sendFile(reply, indexHtml, 200);
    });
    await api.listen({ host: "127.0.0.1", port: freePort });
    closeables.push(() => api.close());

    return {
      origin: publicOrigin,
      projectId: PROJECT_ID,
      operatorLogin: OPERATOR_LOGIN,
      viewerLogin: VIEWER_LOGIN,
      responderLogin: RESPONDER_LOGIN,
      /**
       * 纯系统管理员账号：只有系统管理身份，没有任何业务角色。
       * 它在本工程里唯一的成员身份携带 `system-administrator` 角色，而该角色的业务分支集合
       * 为空——因此「它在业务窄读口无权」是真实的权限边界，而不是换个没有权限的账号。
       */
      administratorLogin: "admin001",
      administratorPassword: ADMIN_PASSWORD_CHANGED,
      /**
       * 账号主体标识：命令载荷里的 `decidedByActorId`/`recordedByActorId` 等要的是主体标识，
       * 不是登录名。两者混用会被 C28 以 `response-execution-source-invalid` 关闭失败。
       */
      operatorAccountId: operator.resultRef.entityId,
      responderAccountId: responder.resultRef.entityId,
      /** 受限账号：初始密码即通用初始密码，改密后另有其密码。 */
      restrictedLogin: RESTRICTED_LOGIN,
      restrictedAccountPassword: ACCOUNT_PASSWORD,
      restrictedPasswordChanged: RESTRICTED_PASSWORD_CHANGED,
      accountPassword: ACCOUNT_PASSWORD_CHANGED,
      seriesEntityId: seriesRef.reference.entityId,
      sourceAVersionEntityId: sourceA.sourceVersionRef.reference.entityId,
      sourceBVersionEntityId: sourceB.sourceVersionRef.reference.entityId,
      /**
       * 本装配真实冻结的两个监测快照：采纳建议的 `preActionMonitoringSnapshotRef` 与
       * 登记反馈的 `postActionMonitoringSnapshotRef` 都取自这里登记的真实快照引用，
       * C28 会按快照 cutoff 与序列取值做真实偏差计算，不接受拼装的假引用。
       */
      settlementMonitoringSnapshotRef,
      slurryPressureMonitoringSnapshotRef,
      reassessmentSettlementMonitoringSnapshotRef,
      /**
       * 资料 A 的真实来源版本与资料段标识：登记执行的 `evidenceReferences` 按真实来源段
       * 登记，C08/C29 的证据完整性与来源段一致性校验才会成立。
       */
      sourceA,
      assessmentSourceVersionRefs: downstreamSourceVersionRefs.map((ref) => ref.reference),
      /** C28 读取的人工反馈文档工件引用（`warning-response.feedback-artifact` 用途码）。 */
      feedbackArtifactRef,
      measureLibraryReleaseRef: publishedConfigurationReleaseRefs.get("measure-library").reference,
      independentMeasureIds: DEMO_MEASURE_IDS,
      paginatedRunRef,
      terminalRunRef,
      publishNextRiskMatrix,
      relationshipResult: {
        entityId: relationshipResultRef.reference.entityId,
        versionId: relationshipResultRef.reference.versionId,
      },
      /** 撤权接缝：真实 C06 成员状态改写，供浏览器观察授权撤销后的失败闭合。 */
      setViewerMembershipStatus,
      /**
       * 启动真实 `assess` 评估运行所需的冻结输入：全部是本装配登记的真实事实，
       * 不是为通过场景而拼的假引用。空间范围与适用性快照同源，评估子运行面据此推进。
       */
      assessStartInput: {
        graphVersion: DEMO_RISK_FLOW_CONFIG.subGraphVersions.assessment,
        retryPolicyRef: DEMO_RISK_FLOW_CONFIG.retryPolicyRef,
        riskInput: { kind: "standardized-risk-record", reference: recordAutoRef.reference },
        spatialScopeRef,
        projectRevisionRef: { kind: "project-revision", reference: projectRevisionRef.reference },
        applicabilityMetadataSnapshotRef: applicabilitySnapshotRef,
        // 评估准备按入口冻结的监测快照物化指标实际取值；不传就只剩风险记录自带字段，
        // C25 会以 `risk-assessment-monitoring-snapshot-coverage` 关闭失败。
        monitoringSnapshotRefs: [
          settlementMonitoringSnapshotRef,
          slurryPressureMonitoringSnapshotRef,
        ],
      },
      /**
       * 链运行登记的未确认预警：`warning-response.acknowledge` 的真实写入口，用于验收
       * 「完整信封冻结 + 响应丢失重试」——重试必须逐字节复用首次冻结的信封。
       */
      warningDetailRef: { ...warningRef.reference },
      /**
       * C15 真实清洗任务引用：C19 编制（`loadAuthoringManifest` → `readBoundResult`）
       * 唯一的上游来源。它来自上面的 C08 任务，不是构造出来的引用。
       */
      dataCleaningTaskRef,
      /**
       * C31 risk-overview 的两个已登记运行：同父、不同入口身份，用于验收「按页追溯」——
       * 下一页必须是真实的下一个运行，且与首页共用同一个 `queryResultRef`。
       */
      overviewRuns: [
        {
          runId: chainRunRef.reference.entityId,
          versionId: chainRunRef.reference.versionId,
          entryVersionId: "entry-chain-a",
        },
        {
          runId: chainRunRefB.reference.entityId,
          versionId: chainRunRefB.reference.versionId,
          entryVersionId: "entry-chain-b",
        },
      ],
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
      /**
       * C35 验收句柄：全部是本装配真实写入的事实，供浏览器按精确引用核对渲染与下载。
       */
      agentAudit: {
        /** C15 数据清洗任务的真实任务引用：有真实工具行动、候选与确定性校验。 */
        agentTask: {
          entityId: dataCleaningTaskRef.reference.entityId,
          versionId: dataCleaningTaskRef.reference.versionId,
          taskType: dataCleaningTaskRef.taskType,
        },
        /** 真实登记的识别分组复核任务（待决）。 */
        reviewTask: {
          entityId: pendingTaskRef.reference.entityId,
          versionId: pendingTaskRef.reference.versionId,
          reviewType: pendingTaskRef.reviewType,
        },
        /** 真实登记的 risk-overview 查询结果引用。 */
        reportQueryResultRef: {
          entityId: reportQueryResultRef.reference.entityId,
          versionId: reportQueryResultRef.reference.versionId,
        },
        /** 真实生成的报告导出工件引用（绑定 → 分页 → C04 落盘）。 */
        reportExportArtifactRef,
        /** 冻结的版本化导出策略引用。 */
        reportExportPolicyRef: DEMO_REPORT_EXPORT_POLICY.policyRef,
        /** 运维面按真实注册定义列出的模型版本行，供页面按标识核对。 */
        modelVersionTaskTypes: readModelVersions().map((item) => item.taskType),
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
