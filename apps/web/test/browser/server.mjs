/**
 * C36 跨页面验收的真实服务夹具（D-07）：生产 Web 构建 + 真实 HTTP/授权/投影接缝 +
 * 真实 PostgreSQL/C04/C03/C36，不引入开发服务器、Mock 后端或 Mock 浏览器。
 */
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
import { createPostgresEngineeringContextSourceRegistry } from "../../../../packages/adapters/dist/engineering-data/context-source/index.js";
import { PostgresRiskCandidateFinalizationAdapter } from "../../../../packages/adapters/dist/identification/candidate-finalization/index.js";
import {
  createPostgresQualityEvaluationAdapter,
  createPostgresQualityProjectionAdapter,
} from "../../../../packages/adapters/dist/quality/index.js";
import {
  bootstrapPostgresFoundation,
  createPostgresTransactionUnit,
  runPostgresMigrations,
} from "../../../../packages/adapters/dist/postgres/index.js";
import { createPostgresRuntime } from "../../../../packages/adapters/dist/postgres/pool.js";
import { ArtifactPutCommandV1Schema } from "../../../../packages/core/dist/artifacts/index.js";
import {
  AtomicCommandV1Schema,
  sha256CanonicalJson,
} from "../../../../packages/core/dist/persistence/index.js";
import { createQualityEvaluationService } from "../../../../packages/core/dist/quality/index.js";

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
const OPERATOR_PASSWORD = "Riskflow-Operator-2030!";
const OPERATOR_PASSWORD_CHANGED = "Riskflow-Operator-2030-Changed!";
const OPERATOR_LOGIN = "quality-operator";
const PROJECT_ID = "quality-ui-project";
const FORBIDDEN_PROJECT_ID = "quality-ui-forbidden-project";
const PROJECT_REVISION = { entityId: PROJECT_ID, versionId: "r1" };
const DATASET_ARTIFACT_ID = "quality-dataset-c36-browser-dataset@2030-06-02.1";
const NOW = "2030-06-02T00:00:00.000Z";

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

const versionRef = (entityId) => ({ entityId, versionId: "1" });

const datasetSample = (input) => ({
  sampleId: input.sampleId,
  spatialScopeRef: { kind: "spatial-scope", reference: input.spatialScopeRef },
  processNodeId: input.processNodeId,
  sourceSegmentRefs: [input.sourceSegmentRef],
  applicabilitySnapshotRef: {
    kind: "applicability-metadata-snapshot",
    reference: versionRef(`quality-applicability-${input.sampleId}`),
  },
  identificationInputSnapshotRef: {
    kind: "identification-input-snapshot",
    reference: versionRef(`quality-input-${input.sampleId}`),
  },
  assessmentInputSnapshotRef: {
    kind: "assessment-input-snapshot",
    reference: versionRef(`quality-assessment-input-${input.sampleId}`),
  },
  ...(input.riskRecordRef === undefined ? {} : { riskRecordRef: input.riskRecordRef }),
  ...(input.snapshotArtifactRef === undefined
    ? {}
    : { standardizedRiskRecordSnapshotArtifactRef: input.snapshotArtifactRef }),
  expectedEventKey: input.expectedEventKey,
  expectedPositive: input.expectedPositive,
  requiredEvidenceRefs: [input.sourceSegmentRef],
  versionRefs: {
    identificationKnowledgeReleaseRef: versionRef("identification-knowledge"),
    identificationPolicySetRef: versionRef("identification-policy-set"),
    indicatorSystemRef: versionRef("indicator-system"),
    indicatorFieldMappingRef: versionRef("indicator-field-mapping"),
    applicableRuleSetRef: versionRef("applicable-rule-set"),
    weightSetRef: versionRef("weight-set"),
    riskMatrixRef: versionRef("risk-matrix"),
    modelDeploymentRef: versionRef("model-deployment"),
    promptTemplateRef: versionRef("prompt-template"),
    reviewPolicyRef: versionRef("review-policy"),
  },
});

const envelopeFor = (input) => ({
  riskRecordId: input.riskRecordId,
  record: {
    processNodeId: input.processNodeId,
    riskSource: "quality-risk-source",
    riskFactor: "quality-risk-factor",
    riskEvent: input.riskEvent,
    riskElementRelations: [
      { sourceElement: "element-a", relation: "affects", targetElement: "element-b" },
    ],
    evidenceLocator: { sourceSegmentId: input.sourceSegmentRef.locator.sourceSegmentId },
    modelConfidence: 0.5,
  },
  riskMechanismEntryIds: ["quality-mechanism"],
  sourceIds: ["quality-source"],
  compositeConfidence: { value: 0.5, basis: ["quality:0.5"] },
  version: {
    reference: { entityId: input.riskRecordId, versionId: input.recordDigest },
    effectivePeriod: { validFrom: NOW },
    systemTime: { recordedAt: NOW },
  },
  audit: {
    actorId: "quality-actor",
    action: "identification.risk-record-accepted",
    recordedAt: NOW,
  },
});

const recordWriteRow = (input, authorization, commandId) => ({
  riskRecordId: input.riskRecordId,
  versionId: input.recordDigest,
  riskRecordRef: {
    kind: "standardized-risk-record",
    reference: { entityId: input.riskRecordId, versionId: input.recordDigest },
  },
  rowId: `${input.riskRecordId}:row`,
  idempotencyKey: `${input.riskRecordId}:idempotency`,
  requestDigest: input.recordDigest,
  projectId: authorization.projectId,
  workPlanRef: { kind: "identification-work-plan", reference: versionRef("quality-work-plan") },
  identificationRunRef: { kind: "workflow-run", reference: versionRef("quality-run") },
  inputSnapshotRef: {
    kind: "identification-input-snapshot",
    reference: versionRef("quality-input-browser"),
  },
  mergePlanRef: { kind: "merge-plan", reference: versionRef("quality-merge-plan") },
  routeDecisionRef: { kind: "route-decision", reference: versionRef("quality-route-decision") },
  groupId: "quality-group-browser",
  groupVersionId: "1",
  groupRef: { kind: "identification-group", reference: versionRef("quality-group-browser") },
  representativeCandidateRefs: [
    { kind: "content-artifact", reference: { entityId: "quality-candidate", versionId: "1" } },
  ],
  sourceSegmentIds: [input.sourceSegmentRef.locator.sourceSegmentId],
  mechanismEntryIds: ["quality-mechanism"],
  authorizationScopeDigest: sha256CanonicalJson({ scope: "quality-ui-scope" }),
  authorizationContextRef: authorization.authorizationContextRef,
  actorRef: authorization.actorId,
  commandId,
  occurredAt: NOW,
});

/**
 * 启动真实服务：PostgreSQL + 生产迁移 + C04/C03/C06/C36 组合 + 生产 Web 构建。
 * 环境不可用时抛错，调用方必须让验收失败而不是跳过。
 */
export const startQualityBrowserServer = async () => {
  if (!existsSync(WEB_DIST)) throw new Error(`web production build is missing: ${WEB_DIST}`);
  if (!existsSync(MIGRATION_ROOT)) throw new Error(`migration root is missing: ${MIGRATION_ROOT}`);
  if (!existsSync(chromium.executablePath())) {
    throw new Error(`Chromium executable is missing: ${chromium.executablePath()}`);
  }

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase("riskflow")
    .withUsername("postgres")
    .withPassword(ROOT_PASSWORD)
    .start();
  const rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c36-browser-"));
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
    const adminPool = adminRuntime.pool;
    closeables.push(() => adminRuntime.close());
    for (const [role, groups] of loginRoles) {
      await adminPool.query(
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
        policyRef: versionRef("quality-browser-artifact-policy"),
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
      loginAttemptId: "browser-admin-login",
      loginName: "admin001",
      password: ADMIN_PASSWORD,
    });
    const adminSession = await access.changePassword({
      kind: "change-password",
      sessionToken: adminLogin.sessionToken,
      newPassword: "Riskflow-Admin-2030-Changed!",
    });
    const administratorContextRef = adminSession.systemAdministrationContextRef;
    const operator = await access.administerIdentity({
      kind: "create-account",
      commandId: "browser-create-operator",
      idempotencyKey: "browser-create-operator",
      expectedVersion: "none",
      authorizationContextRef: administratorContextRef,
      loginName: OPERATOR_LOGIN,
      displayName: "质量验收操作员",
      password: OPERATOR_PASSWORD,
    });
    for (const [projectId, initialRiskManagerAccountId] of [
      [PROJECT_ID, operator.resultRef.entityId],
      [FORBIDDEN_PROJECT_ID, "account-admin-untouched"],
    ]) {
      if (initialRiskManagerAccountId === "account-admin-untouched") {
        const secondOperator = await access.administerIdentity({
          kind: "create-account",
          commandId: "browser-create-other-operator",
          idempotencyKey: "browser-create-other-operator",
          expectedVersion: "none",
          authorizationContextRef: administratorContextRef,
          loginName: "quality-other-operator",
          displayName: "另一工程操作员",
          password: OPERATOR_PASSWORD,
        });
        await access.administerProject({
          kind: "open-project",
          projectId,
          commandId: `browser-open-${projectId}`,
          idempotencyKey: `browser-open-${projectId}`,
          expectedVersion: "none",
          authorizationContextRef: administratorContextRef,
          initialRiskManagerAccountId: secondOperator.resultRef.entityId,
        });
        continue;
      }
      await access.administerProject({
        kind: "open-project",
        projectId,
        commandId: `browser-open-${projectId}`,
        idempotencyKey: `browser-open-${projectId}`,
        expectedVersion: "none",
        authorizationContextRef: administratorContextRef,
        initialRiskManagerAccountId,
        includeAdministrator: true,
      });
    }

    const operatorLogin = await access.login({
      kind: "login",
      loginAttemptId: "browser-operator-login",
      loginName: OPERATOR_LOGIN,
      password: OPERATOR_PASSWORD,
    });
    const operatorSession = await access.changePassword({
      kind: "change-password",
      sessionToken: operatorLogin.sessionToken,
      newPassword: OPERATOR_PASSWORD_CHANGED,
    });
    // 资料授权变更以系统管理员作为登记成员：它是本工程的在册成员，且不属于浏览器会话。
    const administratorAccount = await adminPool.query(
      "SELECT account_id FROM business.local_accounts WHERE login_name = $1",
      ["admin001"],
    );
    const administratorAccountId = administratorAccount.rows[0]?.account_id;
    if (administratorAccountId === undefined) {
      throw new Error("browser fixture system administrator account is missing");
    }
    const evaluation = await access.authorize({
      invocation: { kind: "human-session", sessionToken: operatorSession.sessionToken },
      invocationId: "browser-evaluate-authorization",
      projectId: PROJECT_ID,
      branch: "projection.export",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
    });
    const authorization = evaluation.context;

    const putJson = async (artifactId, purposeCode, mediaType, value, options = {}) => {
      const result = await artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: `${artifactId}:put`,
          idempotencyKey: `${artifactId}:put`,
          projectId: authorization.projectId,
          actorId: authorization.actorId,
          issuedAt: NOW,
          authorization: options.authorization ?? authorization,
          requiredCapability: options.requiredCapability ?? "projection.export",
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
          yield new TextEncoder().encode(JSON.stringify(value, null, 2));
        })(),
      );
      return result.artifactRef.reference;
    };

    // D-10 真实 C13 来源事实：项目/空间修订、适用性快照、来源交付与资料段，
    // 使必审资料段收据与投影授权映射都由拥有方公开接缝产生。
    const contextSource = createPostgresEngineeringContextSourceRegistry({
      db: appRuntime.db,
      transactionUnit,
      access,
      artifactStore,
      artifactReferenceGuard: artifactStore.referenceGuard,
    });
    const accessScopeRef = authorization.spatialScopeRefs[0];
    const c13Authorization = async (invocationId, sourceVersionRefs = []) =>
      (
        await access.authorize({
          invocation: { kind: "human-session", sessionToken: operatorSession.sessionToken },
          invocationId,
          projectId: PROJECT_ID,
          branch: "engineering-data.register-source-delivery",
          requestedSpatialScopeRefs: [accessScopeRef],
          requestedSourceVersionRefs: [...sourceVersionRefs],
        })
      ).context;
    const projectRevision = await contextSource.reviseContext({
      commandId: "c36-browser-source-project",
      idempotencyKey: "c36-browser-source-project",
      projectId: PROJECT_ID,
      actorId: authorization.actorId,
      issuedAt: NOW,
      authorization: await c13Authorization("c36-browser-source-project"),
      kind: "project",
      expectedVersion: "none",
      name: "C36 质量验收工程",
      lifecycle: "active",
      applicabilityMetadata: {
        constructionMethod: "盾构法",
        stratumCondition: "合成地层",
        engineeringStage: "掘进",
      },
      effectivePeriod: { validFrom: NOW },
    });
    if (
      projectRevision.kind !== "succeeded" ||
      projectRevision.result.kind !== "project-revision"
    ) {
      throw new Error("browser fixture C13 project revision failed");
    }
    const spatialRevision = await contextSource.reviseContext({
      commandId: "c36-browser-source-spatial",
      idempotencyKey: "c36-browser-source-spatial",
      projectId: PROJECT_ID,
      actorId: authorization.actorId,
      issuedAt: NOW,
      authorization: await c13Authorization("c36-browser-source-spatial"),
      kind: "spatial",
      spatialScopeRef: accessScopeRef,
      projectRevisionRef: projectRevision.result.revision.projectRevisionRef,
      expectedVersion: "none",
      name: "C36 质量验收区间",
      worksiteLocation: "合成工地",
      applicabilityOverrides: {},
      status: "active",
      effectivePeriod: { validFrom: NOW },
    });
    if (
      spatialRevision.kind !== "succeeded" ||
      spatialRevision.result.kind !== "spatial-revision"
    ) {
      throw new Error("browser fixture C13 spatial revision failed");
    }
    const businessSpatialScopeRef = spatialRevision.result.revision.spatialScopeRef;
    const applicabilitySnapshot = await contextSource.createApplicabilitySnapshot({
      commandId: "c36-browser-source-applicability",
      idempotencyKey: "c36-browser-source-applicability",
      projectId: PROJECT_ID,
      actorId: authorization.actorId,
      issuedAt: NOW,
      authorization: await c13Authorization("c36-browser-source-applicability"),
      projectRevisionRef: projectRevision.result.revision.projectRevisionRef,
      spatialScopeRef: businessSpatialScopeRef,
      formedAt: NOW,
    });
    if (
      applicabilitySnapshot.kind !== "succeeded" ||
      applicabilitySnapshot.result.kind !== "applicability-snapshot"
    ) {
      throw new Error("browser fixture C13 applicability snapshot failed");
    }
    const writeAuthorization = await c13Authorization("c36-browser-source-write");
    const sourceArtifactRef = await putJson(
      "c36-browser-source-body",
      "engineering-data.register-source-delivery",
      "text/plain",
      "C36 合成来源资料正文",
      { authorization: writeAuthorization, requiredCapability: "engineering-data.write" },
    );
    const metadataArtifactRef = await putJson(
      "c36-browser-source-metadata",
      "engineering-data.register-source-delivery",
      "application/json",
      {
        schemaVersion: "1",
        projectRevisionRef: projectRevision.result.revision.projectRevisionRef,
        spatialScopeRefs: [businessSpatialScopeRef],
        registeredByAccountId: authorization.actorId,
        sourceItemId: "c36-browser-source-item",
        sourceItemName: "C36 合成来源",
        sourceCategory: "engineering-document",
        sourceMetadata: { documentType: "合成来源", formedAt: NOW, sourceOrganization: "合成夹具" },
        descriptor: { kind: "file-upload", contentFingerprint: "C36 合成来源资料正文" },
        applicabilityMetadataSnapshotRef: applicabilitySnapshot.result.snapshot.snapshotRef,
      },
      { authorization: writeAuthorization, requiredCapability: "engineering-data.write" },
    );
    const delivery = await contextSource.apply({
      commandId: "c36-browser-source-delivery",
      idempotencyKey: "c36-browser-source-delivery",
      projectId: PROJECT_ID,
      actorId: authorization.actorId,
      issuedAt: NOW,
      authorization: await c13Authorization("c36-browser-source-delivery"),
      kind: "register-source-delivery",
      payload: {
        sourceConnectionRef: { entityId: "file-upload", versionId: "1" },
        deliveryKey: "c36-browser-source-delivery",
        sourceArtifactRef: { kind: "content-artifact", reference: sourceArtifactRef },
        metadataArtifactRef: { kind: "content-artifact", reference: metadataArtifactRef },
        occurredAt: NOW,
      },
    });
    if (delivery.kind !== "succeeded") {
      throw new Error("browser fixture C13 source delivery failed");
    }
    const sourceVersionRef = delivery.result.sourceVersionRef;
    const segmentIds = ["segment_1", "segment_2"].map(
      (segmentId) => `${sourceVersionRef.reference.entityId}-chapter_1-${segmentId}`,
    );
    const segments = await contextSource.registerSegments({
      commandId: "c36-browser-source-segments",
      idempotencyKey: "c36-browser-source-segments",
      projectId: PROJECT_ID,
      actorId: authorization.actorId,
      issuedAt: NOW,
      authorization: await c13Authorization("c36-browser-source-segments", [sourceVersionRef]),
      sourceVersionRef,
      sourceId: sourceVersionRef.reference.entityId,
      segments: segmentIds.map((sourceSegmentId, index) => ({
        sourceSegmentId,
        chapterId: "chapter_1",
        segmentId: `segment_${index + 1}`,
        kind: "chapter",
        spatialScopeRefs: [businessSpatialScopeRef],
        locator: { kind: "document", pageNumber: index + 1, headingPath: ["质量验收"] },
      })),
    });
    if (segments.kind !== "succeeded") {
      throw new Error("browser fixture C13 source segments failed");
    }
    // D-11：资料授权事实由 C06 公开命令登记，页面查询只能按当前签发上下文披露定位引用。
    // 更新既有资料策略时必须按 C06 期望版本提交，故先读取当前 grant 修订。
    const currentSourceGrantVersion = async () => {
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
    const sourceAccessContext = await c13Authorization("c36-browser-source-access-context");
    const reviseSourceAccess = async (input) =>
      access.administerProject({
        kind: "revise-source-access",
        projectId: PROJECT_ID,
        commandId: input.commandId,
        idempotencyKey: input.commandId,
        expectedVersion: await currentSourceGrantVersion(),
        authorizationContextRef: sourceAccessContext.authorizationContextRef,
        sourceVersionRef,
        visibility: input.visibility,
        allowedAccountIds: [...input.allowedAccountIds],
        spatialScopeRefs: [accessScopeRef],
        registeredByAccountId: input.registeredByAccountId,
      });
    await reviseSourceAccess({
      commandId: "c36-browser-source-access",
      visibility: "project-shared",
      allowedAccountIds: [],
      registeredByAccountId: authorization.actorId,
    });

    const recordStore = new PostgresRiskCandidateFinalizationAdapter({
      db: appRuntime.db,
      transactionUnit,
    });
    const sourceSegmentRef = {
      locator: { sourceSegmentId: segmentIds[0] },
      sourceVersion: sourceVersionRef.reference,
    };
    const riskRecordId = "identification-risk-record-browser-1";
    const recordDigest = sha256CanonicalJson({ projectId: PROJECT_ID, riskRecordId });
    const seedCommandId = "browser-seed-records";
    await transactionUnit.execute(
      AtomicCommandV1Schema.parse({
        projectId: PROJECT_ID,
        commandKind: "identification.risk-record-accepted",
        commandId: seedCommandId,
        idempotencyKey: seedCommandId,
        payload: { riskRecordId },
        actorRef: authorization.actorId,
        authorizationContextRef: authorization.authorizationContextRef,
        issuedAt: NOW,
      }),
      async (context) => {
        const recordInput = {
          riskRecordId,
          recordDigest,
          processNodeId: "process-node-browser",
          riskEvent: "risk-event-browser",
          sourceSegmentRef,
        };
        const insertion = await recordStore.insertRecords(
          {
            rows: [recordWriteRow(recordInput, authorization, seedCommandId)],
            records: [envelopeFor(recordInput)],
            occurredAt: NOW,
          },
          context,
        );
        if (insertion.kind === "conflict") throw new Error("browser fixture record conflicted");
        const target = {
          kind: "standardized-risk-record",
          reference: versionRef("browser-seed"),
        };
        return {
          resultRef: target,
          audit: {
            auditEntryId: `${seedCommandId}:audit`,
            projectId: PROJECT_ID,
            action: "identification.risk-record-accepted",
            targetRef: target,
            actorRef: authorization.actorId,
            authorizationContextRef: authorization.authorizationContextRef,
            occurredAt: NOW,
            recordedAt: NOW,
            version: { entityId: `${seedCommandId}:audit`, versionId: "1" },
            commandId: seedCommandId,
            idempotencyKey: seedCommandId,
          },
          events: [],
        };
      },
    );
    const snapshotArtifactRef = {
      kind: "content-artifact",
      reference: await putJson(
        "quality-sample-snapshot-browser-1",
        "quality-evaluation.sample-snapshot",
        "application/json",
        envelopeFor({
          riskRecordId,
          recordDigest,
          processNodeId: "process-node-browser",
          riskEvent: "risk-event-browser",
          sourceSegmentRef,
        }),
      ),
    };
    const datasetArtifactRef = {
      kind: "content-artifact",
      reference: await putJson(
        DATASET_ARTIFACT_ID,
        "quality-evaluation.dataset",
        "application/vnd.riskflow.quality-evaluation-dataset+json",
        {
          schemaVersion: "1",
          datasetId: "c36-browser-dataset",
          datasetVersion: "2030-06-02.1",
          sampleKind: "synthetic",
          sourceQualificationRef: null,
          sourceQualificationMissingReasonCode: "no-deidentified-party-samples-supplied",
          projectId: PROJECT_ID,
          projectRevisionRef: { kind: "project-revision", reference: PROJECT_REVISION },
          labelPolicyRef: versionRef("quality-label-policy"),
          createdAt: NOW,
          samples: [
            datasetSample({
              sampleId: "browser-sample-1",
              spatialScopeRef: authorization.spatialScopeRefs[0].reference,
              processNodeId: "process-node-browser",
              sourceSegmentRef,
              riskRecordRef: {
                kind: "standardized-risk-record",
                reference: { entityId: riskRecordId, versionId: recordDigest },
              },
              snapshotArtifactRef,
              expectedEventKey: "risk-event-browser",
              expectedPositive: true,
            }),
            datasetSample({
              sampleId: "browser-sample-2",
              spatialScopeRef: authorization.spatialScopeRefs[0].reference,
              processNodeId: "process-node-browser",
              sourceSegmentRef: {
                locator: { sourceSegmentId: segmentIds[1] },
                sourceVersion: sourceVersionRef.reference,
              },
              expectedEventKey: "risk-event-browser-absent",
              expectedPositive: false,
            }),
          ],
        },
      ),
    };
    const evaluationService = createQualityEvaluationService(
      createPostgresQualityEvaluationAdapter({
        db: appRuntime.db,
        transactionUnit,
        artifactStore,
        artifactReferenceGuard: artifactStore.referenceGuard,
        recordStore,
        evidenceAccess: contextSource,
        now: () => new Date(NOW),
      }).serviceOptions(),
    );
    const acceptanceBrowser = await chromium.launch();
    const browserVersion = acceptanceBrowser.version();
    await acceptanceBrowser.close();
    const evaluated = await evaluationService.evaluateDataset({
      projectId: PROJECT_ID,
      actorId: authorization.actorId,
      commandId: "browser-quality-command",
      idempotencyKey: "browser-quality-command",
      requestedAt: NOW,
      datasetArtifactRef,
      runRefs: [],
      authorization,
      // D-10：必审资料段按现有 `engineering-data.evidence-access` 分支逐批签发。
      requiredEvidenceAccess: {
        issueReadAuthorization: async (request) =>
          (
            await access.authorize({
              invocation: { kind: "human-session", sessionToken: operatorSession.sessionToken },
              invocationId: request.queryId,
              projectId: request.projectId,
              branch: "engineering-data.evidence-access",
              requestedSpatialScopeRefs: [...request.spatialScopeRefs],
              requestedSourceVersionRefs: [...request.sourceVersionRefs],
            })
          ).context,
      },
      runEvidence: {
        commands: [
          "pnpm build && pnpm exec playwright test -c playwright.config.ts --project=chromium",
        ],
        codeHead: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: REPOSITORY_ROOT,
          encoding: "utf8",
        }).trim(),
        environment: {
          nodeVersion: process.version,
          platform: `${process.platform}/${process.arch}`,
          browserVersion,
        },
      },
    });
    if (evaluated.kind !== "succeeded") {
      throw new Error(`browser fixture evaluation failed: ${evaluated.failure.code}`);
    }

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
        qualityProjectionQuery: createPostgresQualityProjectionAdapter({ db: appRuntime.db }),
      },
      publicOrigin,
      now: () => new Date(),
    });
    // 生产 Web 构建由同一 Fastify 实例按 C10 既有路由集合提供；SPA 入口回落到 index.html。
    const spaPaths = [
      "/",
      "/login",
      "/change-password",
      "/overview",
      "/projects",
      "/identification",
      "/assessment",
      "/warnings",
      "/knowledge",
      "/review-audit",
    ];
    const sendFile = async (reply, filePath, statusCode) => {
      const body = await readFile(filePath);
      return reply
        .code(statusCode)
        .type(CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream")
        .send(body);
    };
    for (const spaPath of spaPaths) {
      api.get(spaPath, async (_request, reply) =>
        sendFile(reply, resolve(WEB_DIST, "index.html"), 200),
      );
    }
    api.get("/assets/*", async (request, reply) => {
      const requested = request.url.split("?")[0];
      const candidate = resolve(WEB_DIST, `.${requested}`);
      if (!candidate.startsWith(`${WEB_DIST}/`) || !existsSync(candidate)) {
        return reply.code(404).send({ code: "NOT_FOUND" });
      }
      return sendFile(reply, candidate, 200);
    });
    await api.listen({ host: "127.0.0.1", port: freePort });
    closeables.push(() => api.close());

    return {
      origin: publicOrigin,
      projectId: PROJECT_ID,
      forbiddenProjectId: FORBIDDEN_PROJECT_ID,
      projectRevisionRef: PROJECT_REVISION,
      operatorLogin: OPERATOR_LOGIN,
      operatorPassword: OPERATOR_PASSWORD_CHANGED,
      reportArtifactRef: evaluated.reportArtifactRef,
      datasetArtifactRef,
      /** D-11 撤权：把资料改为仅系统管理员可见，页面必须只保留工程级摘要。 */
      async revokeSourceAccess() {
        const receipt = await reviseSourceAccess({
          commandId: "c36-browser-source-access-revoked",
          visibility: "restricted",
          allowedAccountIds: [administratorAccountId],
          registeredByAccountId: administratorAccountId,
        });
        return receipt !== undefined;
      },
      close: async () => {
        for (const close of closeables.reverse()) {
          await Promise.resolve(close()).catch(() => undefined);
        }
        await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
        await container.stop().catch(() => undefined);
      },
    };
  } catch (error) {
    for (const close of closeables.reverse()) {
      await Promise.resolve(close()).catch(() => undefined);
    }
    await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
    await container.stop().catch(() => undefined);
    throw error;
  }
};
