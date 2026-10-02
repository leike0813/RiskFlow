/** 合成样本、待甲方复核：本文件所有工程、身份、摘要与工件正文均为合成夹具。 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ArtifactPutCommandV1Schema, type ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  createQualityEvaluationService,
  QualityDatasetV1Schema,
  qualityDatasetArtifactId,
  type QualityEvaluationReportV1,
} from "@riskflow/core/quality";
import { AtomicCommandV1Schema, sha256CanonicalJson } from "@riskflow/core/persistence";
import {
  bootstrapInitialSystemAdministrator,
  createPostgresLocalIdentityAccess,
  type PostgresLocalIdentityAccess,
} from "../../src/auth/index.js";
import type {
  AuthorizationContextRefV1,
  AuthorizationContextV1,
  ContentArtifactRefV1,
  ProjectRevisionRefV1,
  SourceAccessGrantRefV1,
  SourceVersionRefV1,
  SpatialScopeRefV1,
  WorkflowRunRefV1,
} from "@riskflow/contracts/ports";

import { createFilesystemArtifactStore } from "../../src/artifacts/filesystem-artifact-store.js";
import { PostgresArtifactRegistry } from "../../src/artifacts/postgres-artifact-registry.js";
import {
  createPostgresEngineeringContextSourceRegistry,
  type PostgresEngineeringContextSourceRegistry,
} from "../../src/engineering-data/context-source/index.js";
import { PostgresRiskCandidateFinalizationAdapter } from "../../src/identification/candidate-finalization/postgres-risk-candidate-adapter.js";
import { runPostgresMigrations } from "../../src/postgres/migrations/run.js";
import { createPostgresRuntime, type PostgresRuntime } from "../../src/postgres/pool.js";
import { PostgresTransactionUnit } from "../../src/postgres/transaction-unit.js";
import * as qualityIndexMigration from "../../src/postgres/migrations/query-projection/deliver-quality-evaluation-module/000052_quality_evaluation_report_index.js";
import {
  createPostgresQualityEvaluationAdapter,
  createPostgresQualityProjectionAdapter,
} from "../../src/quality/index.js";
import { artifactPolicy } from "../artifacts/fixture.js";
import { startPostgresFixture, type PostgresTestFixture } from "../postgres/fixture.js";
import {
  AUTHORIZATION_FIXTURE,
  QUALITY_FIXTURE_TIME,
  seedQualityEvaluationFixture,
  type QualityEvaluationSeededSampleV1,
} from "./fixture.js";

const TABLE = "business.quality_evaluation_report_index";
const DATASET_TABLE = "business.quality_evaluation_dataset_freeze";
const SCRIPT_PATH = resolve(import.meta.dirname, "../../../../scripts/quality/evaluate.mjs");
const DATASET_ARTIFACT_ID = "quality-dataset-c36-integration-dataset@2030-06-01.1";
const DATASET_PURPOSE_CODE = "quality-evaluation.dataset";
const DATASET_MEDIA_TYPE = "application/vnd.riskflow.quality-evaluation-dataset+json";
const REPORT_PURPOSE_CODE = "quality-evaluation.report";

interface QualityFixtureV1 {
  readonly postgres: PostgresTestFixture;
  readonly runtime: PostgresRuntime;
  readonly migratorRuntime: PostgresRuntime;
  readonly transactionUnit: PostgresTransactionUnit;
  readonly artifactStore: ArtifactStoreV1;
  readonly artifactRegistry: PostgresArtifactRegistry;
  readonly artifactRootDirectory: string;
  readonly appPool: Pool;
  /** 共享的真实 C06 接入：同一测试库内所有真实签发/登录都经它完成。 */
  readonly access: PostgresLocalIdentityAccess;
  /** 共享的真实 C13 组合：C36 必审资料段证明与投影授权映射都只在公开接缝上验证。 */
  readonly contextSource: PostgresEngineeringContextSourceRegistry;
  close(): Promise<void>;
}

const startFixture = async (): Promise<QualityFixtureV1> => {
  const postgres = await startPostgresFixture();
  try {
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
      additionalMigrationRoots: [postgres.fixtureMigrationRoot],
    });
    const rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c36-quality-"));
    const runtime = createPostgresRuntime(postgres.app, "riskflow_app");
    const migratorRuntime = createPostgresRuntime(postgres.migrator, "riskflow_migrator");
    const transactionUnit = new PostgresTransactionUnit(runtime.db);
    const appPool = new Pool(postgres.app);
    const registry = new PostgresArtifactRegistry({
      db: runtime.db,
      transactionUnit,
      pool: runtime.pool,
    });
    const artifactStore = await createFilesystemArtifactStore({
      rootDirectory,
      policy: artifactPolicy(),
      registry,
      transactionUnit,
    });
    const access = createPostgresLocalIdentityAccess({
      ...postgres.app,
      hmacKey: Buffer.alloc(32, 11),
      keyVersion: "key-v1",
    });
    const contextSource = createPostgresEngineeringContextSourceRegistry({
      db: runtime.db,
      transactionUnit,
      access,
      artifactStore,
      artifactReferenceGuard: registry,
    });
    return {
      postgres,
      runtime,
      migratorRuntime,
      transactionUnit,
      artifactStore,
      artifactRegistry: registry,
      artifactRootDirectory: rootDirectory,
      appPool,
      access,
      contextSource,
      async close() {
        await appPool.close().catch(() => undefined);
        await artifactStore.close().catch(() => undefined);
        await access.close().catch(() => undefined);
        await runtime.close().catch(() => undefined);
        await migratorRuntime.close().catch(() => undefined);
        await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
        await postgres.close().catch(() => undefined);
      },
    };
  } catch (error) {
    await postgres.close().catch(() => undefined);
    throw error;
  }
};

let fixture: QualityFixtureV1 | undefined;

beforeAll(async () => {
  fixture = await startFixture();
}, 300_000);

afterAll(async () => {
  await fixture?.close().catch(() => undefined);
}, 300_000);

const authorization: AuthorizationContextV1 = AUTHORIZATION_FIXTURE;

let putSequence = 0;

const putJson = async (input: {
  readonly artifactId: string;
  readonly purposeCode: string;
  readonly mediaType: string;
  readonly value: unknown;
}): Promise<ContentArtifactRefV1["reference"]> => {
  putSequence += 1;
  const payload = new TextEncoder().encode(JSON.stringify(input.value, null, 2));
  const result = await fixture!.artifactStore.put(
    ArtifactPutCommandV1Schema.parse({
      schemaVersion: "1",
      commandId: `${input.artifactId}:put:${putSequence}`,
      idempotencyKey: `${input.artifactId}:put:${putSequence}`,
      projectId: authorization.projectId,
      actorId: authorization.actorId,
      issuedAt: QUALITY_FIXTURE_TIME,
      authorization,
      requiredCapability: "projection.export",
      artifactId: input.artifactId,
      artifactKind: "content",
      purposeCode: input.purposeCode,
      mediaType: input.mediaType,
      parentArtifactRefs: [],
      evidenceReferences: [],
      additionalSpatialScopeRefs: [],
      additionalSourceAccessGrantRefs: [],
    }),
    (async function* () {
      yield payload;
    })(),
  );
  return result.artifactRef.reference;
};

const contentRef = (entityId: string, versionId: string): ContentArtifactRefV1 => ({
  kind: "content-artifact",
  reference: { entityId, versionId },
});

const evaluationService = () => {
  const adapter = createPostgresQualityEvaluationAdapter({
    db: fixture!.runtime.db,
    transactionUnit: fixture!.transactionUnit,
    artifactStore: fixture!.artifactStore,
    artifactReferenceGuard: fixture!.artifactRegistry,
    recordStore: new PostgresRiskCandidateFinalizationAdapter({
      db: fixture!.runtime.db,
      transactionUnit: fixture!.transactionUnit,
    }),
    evidenceAccess: fixture!.contextSource,
    now: () => new Date(QUALITY_FIXTURE_TIME),
  });
  return createQualityEvaluationService(adapter.serviceOptions());
};

const queryProjection = () =>
  createPostgresQualityProjectionAdapter({
    db: fixture!.runtime.db,
    now: () => new Date(QUALITY_FIXTURE_TIME),
  });

const queryEnvelope = (payload: unknown, queryId: string) => ({
  queryId,
  projectId: authorization.projectId,
  actorId: authorization.actorId,
  requestedAt: QUALITY_FIXTURE_TIME,
  authorization: { ...authorization, grantedCapabilities: ["projection.query"] },
  kind: "query" as const,
  payload,
});

const qualityListSelector = {
  mode: "list" as const,
  projectRevisionRef: {
    kind: "project-revision" as const,
    reference: { entityId: "quality-revision", versionId: "r1" },
  },
  pageSize: 50,
};

let seededSamples: readonly QualityEvaluationSeededSampleV1[] = [];
let datasetArtifactRef: ContentArtifactRefV1 | undefined;
let reportArtifactRef: ContentArtifactRefV1 | undefined;

const datasetBody = (datasetVersion: string, samples = seededSamples) => ({
  schemaVersion: "1",
  datasetId: "c36-integration-dataset",
  datasetVersion,
  sampleKind: "synthetic",
  sourceQualificationRef: null,
  sourceQualificationMissingReasonCode: "no-deidentified-party-samples-supplied",
  projectId: authorization.projectId,
  projectRevisionRef: {
    kind: "project-revision",
    reference: { entityId: "quality-revision", versionId: "r1" },
  },
  labelPolicyRef: { entityId: "quality-label-policy", versionId: "v1" },
  createdAt: QUALITY_FIXTURE_TIME,
  samples: samples.map((sample) => sample.datasetSample),
});

/** 按显式工程授权写冻结数据集工件；工件身份必须与数据集版本一一对应。 */
const putProjectArtifact = async (input: {
  readonly authorization: AuthorizationContextV1;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly value: unknown;
}): Promise<ContentArtifactRefV1> => {
  const artifactId = qualityDatasetArtifactId({
    datasetId: input.datasetId,
    datasetVersion: input.datasetVersion,
  });
  const payload = new TextEncoder().encode(JSON.stringify(input.value, null, 2));
  const result = await fixture!.artifactStore.put(
    ArtifactPutCommandV1Schema.parse({
      schemaVersion: "1",
      commandId: `${artifactId}:put`,
      idempotencyKey: `${artifactId}:put`,
      projectId: input.authorization.projectId,
      actorId: input.authorization.actorId,
      issuedAt: QUALITY_FIXTURE_TIME,
      authorization: input.authorization,
      requiredCapability: "projection.export",
      artifactId,
      artifactKind: "content",
      purposeCode: DATASET_PURPOSE_CODE,
      mediaType: DATASET_MEDIA_TYPE,
      parentArtifactRefs: [],
      evidenceReferences: [],
      additionalSpatialScopeRefs: [],
      additionalSourceAccessGrantRefs: [],
    }),
    (async function* () {
      yield payload;
    })(),
  );
  return { kind: "content-artifact", reference: result.artifactRef.reference };
};

interface ProjectDatasetSampleV1 {
  readonly sampleId: string;
  readonly sourceSegmentRefs: readonly unknown[];
  readonly requiredEvidenceRefs: readonly unknown[];
}

/** 独立工程用例的冻结数据集正文：工程、修订与空间范围由调用方给定。 */
const projectDatasetBody = (input: {
  readonly projectId: string;
  readonly datasetId: string;
  readonly projectRevisionRef: ProjectRevisionRefV1;
  readonly datasetVersion: string;
  readonly spatialScopeRef: SpatialScopeRefV1;
  readonly samples: readonly ProjectDatasetSampleV1[];
}) => ({
  schemaVersion: "1",
  datasetId: input.datasetId,
  datasetVersion: input.datasetVersion,
  sampleKind: "synthetic",
  sourceQualificationRef: null,
  sourceQualificationMissingReasonCode: "no-deidentified-party-samples-supplied",
  projectId: input.projectId,
  projectRevisionRef: input.projectRevisionRef,
  labelPolicyRef: { entityId: "quality-label-policy", versionId: "v1" },
  createdAt: QUALITY_FIXTURE_TIME,
  samples: input.samples.map((sample) => ({
    sampleId: sample.sampleId,
    spatialScopeRef: input.spatialScopeRef,
    processNodeId: "process-node-real-source",
    sourceSegmentRefs: [...sample.sourceSegmentRefs],
    applicabilitySnapshotRef: {
      kind: "applicability-metadata-snapshot",
      reference: { entityId: `quality-applicability-${sample.sampleId}`, versionId: "1" },
    },
    identificationInputSnapshotRef: {
      kind: "identification-input-snapshot",
      reference: { entityId: `quality-input-${sample.sampleId}`, versionId: "1" },
    },
    assessmentInputSnapshotRef: {
      kind: "assessment-input-snapshot",
      reference: { entityId: `quality-assessment-input-${sample.sampleId}`, versionId: "1" },
    },
    expectedEventKey: "risk-event-real-source",
    expectedPositive: false,
    requiredEvidenceRefs: [...sample.requiredEvidenceRefs],
    versionRefs: {
      identificationKnowledgeReleaseRef: { entityId: "identification-knowledge", versionId: "1" },
      identificationPolicySetRef: { entityId: "identification-policy-set", versionId: "1" },
      indicatorSystemRef: { entityId: "indicator-system", versionId: "1" },
      indicatorFieldMappingRef: { entityId: "indicator-field-mapping", versionId: "1" },
      applicableRuleSetRef: { entityId: "applicable-rule-set", versionId: "1" },
      weightSetRef: { entityId: "weight-set", versionId: "1" },
      riskMatrixRef: { entityId: "risk-matrix", versionId: "1" },
      modelDeploymentRef: { entityId: "model-deployment", versionId: "1" },
      promptTemplateRef: { entityId: "prompt-template", versionId: "1" },
      reviewPolicyRef: { entityId: "review-policy", versionId: "1" },
    },
  })),
});

/** 既有资料策略的当前修订；没有策略时返回 `none`，更新时按 C06 期望版本语义精确提交。 */
const currentSourceGrantVersion = async (input: {
  readonly projectId: string;
  readonly sourceVersionRef: SourceVersionRefV1;
}): Promise<{ readonly entityId: string; readonly versionId: string } | "none"> => {
  const policy = await fixture!.postgres.adminPool.query<{
    source_access_grant_id: string;
    current_revision_id: string;
  }>(
    `SELECT source_access_grant_id, current_revision_id FROM business.source_access_policies
      WHERE project_id = $1 AND source_entity_id = $2 AND source_version_id = $3`,
    [
      input.projectId,
      input.sourceVersionRef.reference.entityId,
      input.sourceVersionRef.reference.versionId,
    ],
  );
  const row = policy.rows[0];
  if (row === undefined) return "none";
  const revision = await fixture!.postgres.adminPool.query<{ revision_no: number }>(
    "SELECT revision_no FROM business.source_access_policy_revisions WHERE revision_id = $1",
    [row.current_revision_id],
  );
  const revisionNo = revision.rows[0]?.revision_no;
  if (revisionNo === undefined) throw new Error("source access policy revision is missing");
  return { entityId: row.source_access_grant_id, versionId: String(revisionNo) };
};

const evaluate = (input: {
  readonly commandId: string;
  readonly datasetRef: ContentArtifactRefV1;
  readonly authorization?: AuthorizationContextV1;
  readonly commands?: readonly string[];
  readonly runRefs?: readonly WorkflowRunRefV1[];
}) =>
  evaluationService().evaluateDataset({
    projectId: authorization.projectId,
    actorId: authorization.actorId,
    commandId: input.commandId,
    idempotencyKey: input.commandId,
    requestedAt: QUALITY_FIXTURE_TIME,
    datasetArtifactRef: input.datasetRef,
    runRefs: input.runRefs ?? [],
    authorization: input.authorization ?? authorization,
    runEvidence: {
      commands: input.commands ?? [
        "pnpm quality:evaluate -- --dataset synthetic.json --output result.json",
      ],
      codeHead: "deadbeef",
      environment: { nodeVersion: process.version },
    },
  });

/* ------------------------------------------------------------------ 真实 C06/C13 世界 */

const TEST_ADMIN_LOGIN = "c36-test-admin";
const TEST_ADMIN_PASSWORD = "Riskflow-C36-Admin-2030!";
const TEST_ADMIN_PASSWORD_CHANGED = "Riskflow-C36-Admin-2030-Changed!";

let administrationRef: Promise<AuthorizationContextRefV1> | undefined;

/** 同一测试库只能引导一次初始管理员：文件内所有真实 C06 用例共享这一份。 */
const systemAdministrationContext = async (): Promise<AuthorizationContextRefV1> => {
  administrationRef ??= (async () => {
    if (
      (await fixture!.postgres.adminPool.query("SELECT 1 FROM business.local_accounts")).rowCount
    ) {
      throw new Error("C36 test database already has accounts");
    }
    await bootstrapInitialSystemAdministrator({
      connection: fixture!.postgres.migrator,
      loginName: TEST_ADMIN_LOGIN,
      displayName: "C36 测试管理员",
      password: TEST_ADMIN_PASSWORD,
    });
    const login = await fixture!.access.login({
      kind: "login",
      loginAttemptId: "c36-admin-login",
      loginName: TEST_ADMIN_LOGIN,
      password: TEST_ADMIN_PASSWORD,
    });
    const changed = await fixture!.access.changePassword({
      kind: "change-password",
      sessionToken: login.sessionToken,
      newPassword: TEST_ADMIN_PASSWORD_CHANGED,
    });
    return changed.systemAdministrationContextRef;
  })();
  return administrationRef;
};

interface RealOperatorWorldV1 {
  readonly accountId: string;
  readonly sessionToken: string;
  readonly password: string;
  readonly accessScopeRef: SpatialScopeRefV1;
}

/** 真实工程成员：建账号、开工程、改密，并按 `projection.export` 取得访问空间范围。 */
const realOperatorWorld = async (input: {
  readonly projectId: string;
  readonly loginName: string;
  readonly password: string;
  readonly changedPassword: string;
}): Promise<RealOperatorWorldV1> => {
  const administratorContextRef = await systemAdministrationContext();
  const account = await fixture!.access.administerIdentity({
    kind: "create-account",
    commandId: `${input.loginName}-create`,
    idempotencyKey: `${input.loginName}-create`,
    expectedVersion: "none",
    authorizationContextRef: administratorContextRef,
    loginName: input.loginName,
    displayName: `${input.loginName} 操作员`,
    password: input.password,
  });
  await fixture!.access.administerProject({
    kind: "open-project",
    projectId: input.projectId,
    commandId: `${input.loginName}-open-project`,
    idempotencyKey: `${input.loginName}-open-project`,
    expectedVersion: "none",
    authorizationContextRef: administratorContextRef,
    initialRiskManagerAccountId: account.resultRef.entityId,
    includeAdministrator: true,
  });
  const login = await fixture!.access.login({
    kind: "login",
    loginAttemptId: `${input.loginName}-login`,
    loginName: input.loginName,
    password: input.password,
  });
  const session = await fixture!.access.changePassword({
    kind: "change-password",
    sessionToken: login.sessionToken,
    newPassword: input.changedPassword,
  });
  const decision = await fixture!.access.authorize({
    invocation: { kind: "human-session", sessionToken: session.sessionToken },
    invocationId: `${input.loginName}-scope`,
    projectId: input.projectId,
    branch: "projection.export",
    requestedSpatialScopeRefs: [],
    requestedSourceVersionRefs: [],
  });
  return {
    accountId: account.resultRef.entityId,
    sessionToken: session.sessionToken,
    password: input.changedPassword,
    accessScopeRef: decision.context.spatialScopeRefs[0]!,
  };
};

/** 按精确分支签发当前 C06 上下文；调用点保证 invocation 与随后的读查询 id 一致。 */
const authorizeFor = async (input: {
  readonly world: RealOperatorWorldV1;
  readonly projectId: string;
  readonly branch: "engineering-data.register-source-delivery" | "engineering-data.evidence-access";
  readonly invocationId: string;
  readonly spatialScopeRefs?: readonly SpatialScopeRefV1[];
  readonly sourceVersionRefs?: readonly SourceVersionRefV1[];
}): Promise<AuthorizationContextV1> =>
  (
    await fixture!.access.authorize({
      invocation: { kind: "human-session", sessionToken: input.world.sessionToken },
      invocationId: input.invocationId,
      projectId: input.projectId,
      branch: input.branch,
      requestedSpatialScopeRefs: [...(input.spatialScopeRefs ?? [input.world.accessScopeRef])],
      requestedSourceVersionRefs: [...(input.sourceVersionRefs ?? [])],
    })
  ).context;

interface RealSourceWorldV1 {
  readonly projectRevisionRef: ProjectRevisionRefV1;
  readonly businessSpatialScopeRef: SpatialScopeRefV1;
  readonly sourceVersionRef: SourceVersionRefV1;
  readonly segmentIds: readonly string[];
}

/** 用 C13 公开命令建真实来源事实：项目/空间修订、适用性快照、交付与两个资料段。 */
const seedRealSource = async (input: {
  readonly world: RealOperatorWorldV1;
  readonly projectId: string;
  readonly suffix: string;
}): Promise<RealSourceWorldV1> => {
  const writeBranch = "engineering-data.register-source-delivery" as const;
  const project = await fixture!.contextSource.reviseContext({
    commandId: `c36-${input.suffix}-project`,
    idempotencyKey: `c36-${input.suffix}-project`,
    projectId: input.projectId,
    actorId: input.world.accountId,
    issuedAt: QUALITY_FIXTURE_TIME,
    authorization: await authorizeFor({
      world: input.world,
      projectId: input.projectId,
      branch: writeBranch,
      invocationId: `c36-${input.suffix}-project`,
    }),
    kind: "project",
    expectedVersion: "none",
    name: `C36 ${input.suffix} 工程`,
    lifecycle: "active",
    applicabilityMetadata: {
      constructionMethod: "盾构法",
      stratumCondition: "合成地层",
      engineeringStage: "掘进",
    },
    effectivePeriod: { validFrom: QUALITY_FIXTURE_TIME },
  });
  if (project.kind !== "succeeded" || project.result.kind !== "project-revision") {
    throw new Error(`C36 ${input.suffix} C13 project revision failed`);
  }
  const projectRevisionRef = project.result.revision.projectRevisionRef;
  const spatial = await fixture!.contextSource.reviseContext({
    commandId: `c36-${input.suffix}-spatial`,
    idempotencyKey: `c36-${input.suffix}-spatial`,
    projectId: input.projectId,
    actorId: input.world.accountId,
    issuedAt: QUALITY_FIXTURE_TIME,
    authorization: await authorizeFor({
      world: input.world,
      projectId: input.projectId,
      branch: writeBranch,
      invocationId: `c36-${input.suffix}-spatial`,
    }),
    kind: "spatial",
    spatialScopeRef: input.world.accessScopeRef,
    projectRevisionRef,
    expectedVersion: "none",
    name: `C36 ${input.suffix} 区间`,
    worksiteLocation: "合成工地",
    applicabilityOverrides: {},
    status: "active",
    effectivePeriod: { validFrom: QUALITY_FIXTURE_TIME },
  });
  if (spatial.kind !== "succeeded" || spatial.result.kind !== "spatial-revision") {
    throw new Error(`C36 ${input.suffix} C13 spatial revision failed`);
  }
  const businessSpatialScopeRef = spatial.result.revision.spatialScopeRef;
  const applicability = await fixture!.contextSource.createApplicabilitySnapshot({
    commandId: `c36-${input.suffix}-applicability`,
    idempotencyKey: `c36-${input.suffix}-applicability`,
    projectId: input.projectId,
    actorId: input.world.accountId,
    issuedAt: QUALITY_FIXTURE_TIME,
    authorization: await authorizeFor({
      world: input.world,
      projectId: input.projectId,
      branch: writeBranch,
      invocationId: `c36-${input.suffix}-applicability`,
    }),
    projectRevisionRef,
    spatialScopeRef: businessSpatialScopeRef,
    formedAt: QUALITY_FIXTURE_TIME,
  });
  if (
    applicability.kind !== "succeeded" ||
    applicability.result.kind !== "applicability-snapshot"
  ) {
    throw new Error(`C36 ${input.suffix} C13 applicability snapshot failed`);
  }
  const writeAuthorization = await authorizeFor({
    world: input.world,
    projectId: input.projectId,
    branch: writeBranch,
    invocationId: `c36-${input.suffix}-write`,
  });
  const putSourceJson = async (artifactId: string, mediaType: string, value: unknown) => {
    const payload = new TextEncoder().encode(JSON.stringify(value, null, 2));
    const result = await fixture!.artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: "1",
        commandId: `${artifactId}:put`,
        idempotencyKey: `${artifactId}:put`,
        projectId: input.projectId,
        actorId: input.world.accountId,
        issuedAt: QUALITY_FIXTURE_TIME,
        authorization: writeAuthorization,
        requiredCapability: "engineering-data.write",
        artifactId,
        artifactKind: "content",
        purposeCode: "engineering-data.register-source-delivery",
        mediaType,
        parentArtifactRefs: [],
        evidenceReferences: [],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      }),
      (async function* () {
        yield payload;
      })(),
    );
    return result.artifactRef;
  };
  const bodyRef = await putSourceJson(
    `c36-${input.suffix}-body`,
    "text/plain",
    `C36 ${input.suffix} 合成来源正文`,
  );
  const metadataRef = await putSourceJson(`c36-${input.suffix}-metadata`, "application/json", {
    schemaVersion: "1",
    projectRevisionRef,
    spatialScopeRefs: [businessSpatialScopeRef],
    registeredByAccountId: input.world.accountId,
    sourceItemId: `c36-${input.suffix}-source-item`,
    sourceItemName: `C36 ${input.suffix} 合成来源`,
    sourceCategory: "engineering-document",
    sourceMetadata: {
      documentType: "合成来源",
      formedAt: QUALITY_FIXTURE_TIME,
      sourceOrganization: "合成夹具",
    },
    descriptor: { kind: "file-upload", contentFingerprint: `C36 ${input.suffix} 合成来源正文` },
    applicabilityMetadataSnapshotRef: applicability.result.snapshot.snapshotRef,
  });
  const delivery = await fixture!.contextSource.apply({
    commandId: `c36-${input.suffix}-delivery`,
    idempotencyKey: `c36-${input.suffix}-delivery`,
    projectId: input.projectId,
    actorId: input.world.accountId,
    issuedAt: QUALITY_FIXTURE_TIME,
    authorization: await authorizeFor({
      world: input.world,
      projectId: input.projectId,
      branch: writeBranch,
      invocationId: `c36-${input.suffix}-delivery`,
    }),
    kind: "register-source-delivery",
    payload: {
      sourceConnectionRef: { entityId: "file-upload", versionId: "1" },
      deliveryKey: `c36-${input.suffix}-delivery`,
      sourceArtifactRef: bodyRef,
      metadataArtifactRef: metadataRef,
      occurredAt: QUALITY_FIXTURE_TIME,
    },
  });
  if (delivery.kind !== "succeeded") {
    throw new Error(`C36 ${input.suffix} C13 source delivery failed`);
  }
  const sourceVersionRef = delivery.result.sourceVersionRef;
  const segmentIds = ["segment_1", "segment_2"].map(
    (segmentId) => `${sourceVersionRef.reference.entityId}-chapter_1-${segmentId}`,
  );
  const segments = await fixture!.contextSource.registerSegments({
    commandId: `c36-${input.suffix}-segments`,
    idempotencyKey: `c36-${input.suffix}-segments`,
    projectId: input.projectId,
    actorId: input.world.accountId,
    issuedAt: QUALITY_FIXTURE_TIME,
    authorization: await authorizeFor({
      world: input.world,
      projectId: input.projectId,
      branch: writeBranch,
      invocationId: `c36-${input.suffix}-segments`,
      sourceVersionRefs: [sourceVersionRef],
    }),
    sourceVersionRef,
    sourceId: sourceVersionRef.reference.entityId,
    segments: segmentIds.map((sourceSegmentId, index) => ({
      sourceSegmentId: sourceSegmentId as never,
      chapterId: "chapter_1",
      segmentId: `segment_${index + 1}`,
      kind: "chapter" as const,
      spatialScopeRefs: [businessSpatialScopeRef],
      locator: { kind: "document" as const, pageNumber: index + 1, headingPath: ["质量验收"] },
    })),
  });
  if (segments.kind !== "succeeded") {
    throw new Error(`C36 ${input.suffix} C13 source segments failed`);
  }
  return { projectRevisionRef, businessSpatialScopeRef, sourceVersionRef, segmentIds };
};

/** D-10 签发接缝：按现有 `engineering-data.evidence-access` 分支逐批签发。 */
const evidenceIssuerFor = (world: RealOperatorWorldV1, projectId: string) => ({
  issueReadAuthorization: async (request: {
    readonly queryId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
    readonly sourceVersionRefs: readonly SourceVersionRefV1[];
  }) =>
    authorizeFor({
      world,
      projectId,
      branch: "engineering-data.evidence-access",
      invocationId: request.queryId,
      spatialScopeRefs: request.spatialScopeRefs,
      sourceVersionRefs: request.sourceVersionRefs,
    }),
});

describe("C36 migration 000052", () => {
  it("重复 up 幂等，down 可逆序回滚，只授 riskflow_app SELECT/INSERT", async () => {
    const db = fixture!.migratorRuntime.db as never;
    await qualityIndexMigration.up(db);
    await qualityIndexMigration.up(db);
    const privileges = await fixture!.postgres.adminPool.query<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(
      `SELECT has_table_privilege('riskflow_app', $1, 'SELECT') AS can_select,
              has_table_privilege('riskflow_app', $1, 'INSERT') AS can_insert,
              has_table_privilege('riskflow_app', $1, 'UPDATE') AS can_update,
              has_table_privilege('riskflow_app', $1, 'DELETE') AS can_delete`,
      [TABLE],
    );
    expect(privileges.rows[0]).toEqual({
      can_select: true,
      can_insert: true,
      can_update: false,
      can_delete: false,
    });
    const scopeColumn = await fixture!.postgres.adminPool.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'business' AND table_name = 'quality_evaluation_report_index'
         AND column_name = 'spatial_scope_refs'`,
    );
    expect(scopeColumn.rows[0]?.data_type).toBe("jsonb");
    const datasetPrivileges = await fixture!.postgres.adminPool.query<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(
      `SELECT has_table_privilege('riskflow_app', $1, 'SELECT') AS can_select,
              has_table_privilege('riskflow_app', $1, 'INSERT') AS can_insert,
              has_table_privilege('riskflow_app', $1, 'UPDATE') AS can_update,
              has_table_privilege('riskflow_app', $1, 'DELETE') AS can_delete`,
      [DATASET_TABLE],
    );
    expect(datasetPrivileges.rows[0]).toEqual(privileges.rows[0]);
    for (const role of ["riskflow_outbox_worker", "riskflow_checkpointer"]) {
      const granted = await fixture!.postgres.adminPool.query<{ allowed: boolean }>(
        `SELECT has_table_privilege($1, $2, 'SELECT') AS allowed`,
        [role, TABLE],
      );
      expect(granted.rows[0]?.allowed).toBe(false);
    }
    await expect(
      fixture!.appPool.query(`UPDATE ${TABLE} SET project_id = project_id`),
    ).rejects.toBeDefined();
    await expect(fixture!.appPool.query(`DELETE FROM ${TABLE}`)).rejects.toBeDefined();
    await qualityIndexMigration.down(db);
    const dropped = await fixture!.postgres.adminPool.query<{ table_name: string | null }>(
      `SELECT to_regclass($1) AS table_name`,
      [TABLE],
    );
    expect(dropped.rows[0]?.table_name).toBeNull();
    const droppedDataset = await fixture!.postgres.adminPool.query<{ table_name: string | null }>(
      `SELECT to_regclass($1) AS table_name`,
      [DATASET_TABLE],
    );
    expect(droppedDataset.rows[0]?.table_name).toBeNull();
    await qualityIndexMigration.up(db);
  }, 300_000);
});

describe("C36 质量评估写入路径", () => {
  it("授权读 → 确定性指标 → C04 报告 → C03 索引/回执/审计原子提交", async () => {
    const seeded = await seedQualityEvaluationFixture({
      recordStore: new PostgresRiskCandidateFinalizationAdapter({
        db: fixture!.runtime.db,
        transactionUnit: fixture!.transactionUnit,
      }),
      transactionUnit: fixture!.transactionUnit,
      authorization,
      putJson,
    });
    seededSamples = seeded.samples;
    const reference = await putJson({
      artifactId: DATASET_ARTIFACT_ID,
      purposeCode: DATASET_PURPOSE_CODE,
      mediaType: DATASET_MEDIA_TYPE,
      value: datasetBody("2030-06-01.1"),
    });
    datasetArtifactRef = { kind: "content-artifact", reference };

    const result = await evaluate({
      commandId: "quality-command-1",
      datasetRef: datasetArtifactRef,
    });
    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded") return;
    reportArtifactRef = result.reportArtifactRef;

    const readBack = await fixture!.artifactStore.open({
      schemaVersion: "1",
      requestId: "quality-report-read",
      idempotencyKey: "quality-report-read",
      artifactRef: result.reportArtifactRef,
      projectId: authorization.projectId,
      actorId: authorization.actorId,
      requestedAt: QUALITY_FIXTURE_TIME,
      purposeCode: REPORT_PURPOSE_CODE,
      requiredCapability: "projection.export",
      authorization,
    });
    const chunks: Uint8Array[] = [];
    for await (const chunk of readBack.content) chunks.push(chunk);
    const receipt = await readBack.verified;
    expect(`sha256:${receipt.content.hash.value}`).toBe(
      result.reportArtifactRef.reference.versionId,
    );
    expect(readBack.manifest.mediaType).toBe(
      "application/vnd.riskflow.quality-evaluation-report+json",
    );
    const report = JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"),
    ) as {
      label: string;
      samples: readonly { sampleId: string; classification: string }[];
      evidenceChainStatus: string;
      metrics: readonly {
        metricCode: string;
        numerator: number;
        denominator: number;
        status: string;
      }[];
    };
    expect(report.label).toBe("合成样本，待甲方复核");
    expect(report.samples.map((sample) => [sample.sampleId, sample.classification])).toEqual(
      seededSamples.map((sample) => [
        sample.datasetSample["sampleId"],
        sample.expectedClassification,
      ]),
    );
    expect(report.evidenceChainStatus).toBe("partial");
    expect(report.metrics.find((metric) => metric.metricCode === "accuracy")).toMatchObject({
      numerator: 2,
      denominator: 6,
    });
    expect(report.metrics.find((metric) => metric.metricCode === "coverage")).toMatchObject({
      numerator: 2,
      denominator: 6,
    });
    expect(
      report.metrics.find((metric) => metric.metricCode === "audit-completeness"),
    ).toMatchObject({
      numerator: 0,
      denominator: 6,
    });
    expect(report.metrics.find((metric) => metric.metricCode === "replay-rate")).toMatchObject({
      numerator: 0,
      denominator: 1,
      status: "computed",
      value: 0,
    });
    expect(report.metrics.find((metric) => metric.metricCode === "grade-match")).toMatchObject({
      status: "not-computable",
      reasonCode: "quality-metric-denominator-zero",
    });

    const rows = await fixture!.postgres.adminPool.query<{
      audit_entry_id: string;
      sample_kind: string;
      spatial_scope_refs: unknown;
      summary_payload: { metrics: readonly unknown[] };
    }>(
      `SELECT audit_entry_id, sample_kind, spatial_scope_refs, summary_payload FROM ${TABLE}
       WHERE project_id = $1 AND report_artifact_id = $2`,
      [authorization.projectId, result.reportArtifactRef.reference.entityId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.sample_kind).toBe("synthetic");
    expect(rows.rows[0]?.spatial_scope_refs).toEqual(authorization.spatialScopeRefs);
    expect(rows.rows[0]?.summary_payload.metrics).toHaveLength(7);
    const auditRows = await fixture!.postgres.adminPool.query<{ audit_entry_id: string }>(
      `SELECT audit_entry_id FROM audit.entries WHERE audit_entry_id = $1`,
      [rows.rows[0]?.audit_entry_id],
    );
    expect(auditRows.rows).toHaveLength(1);
  }, 300_000);

  it("同键同摘要重放不重复追加，异摘要报冲突且不产生第二条索引", async () => {
    const replayed = await evaluate({
      commandId: "quality-command-1",
      datasetRef: datasetArtifactRef!,
    });
    expect(replayed.kind).toBe("succeeded");
    const countIndexRows = async (): Promise<string | undefined> => {
      const rows = await fixture!.postgres.adminPool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM ${TABLE} WHERE project_id = $1`,
        [authorization.projectId],
      );
      return rows.rows[0]?.total;
    };
    expect(await countIndexRows()).toBe("1");

    const conflicting = await evaluate({
      commandId: "quality-command-1",
      datasetRef: datasetArtifactRef!,
      commands: ["pnpm quality:evaluate -- --dataset other.json --output other.json"],
    });
    expect(conflicting).toMatchObject({
      kind: "failed",
      failure: { code: "IDEMPOTENCY_CONFLICT" },
    });
    expect(await countIndexRows()).toBe("1");
  }, 300_000);

  it("同一数据集版本出现不同摘要时报错版而不是覆盖历史", async () => {
    const reference = await putJson({
      artifactId: `${DATASET_ARTIFACT_ID}:amended`,
      purposeCode: DATASET_PURPOSE_CODE,
      mediaType: DATASET_MEDIA_TYPE,
      value: datasetBody("2030-06-01.1", seededSamples.slice(0, 3)),
    });
    const conflicting = await evaluate({
      commandId: "quality-command-2",
      datasetRef: { kind: "content-artifact", reference },
    });
    expect(conflicting).toMatchObject({ kind: "failed", failure: { code: "STALE_VERSION" } });
  }, 300_000);

  it("拒绝别名工件绕过数据集版本身份", async () => {
    const reference = await putJson({
      artifactId: `${DATASET_ARTIFACT_ID}:alias`,
      purposeCode: DATASET_PURPOSE_CODE,
      mediaType: DATASET_MEDIA_TYPE,
      value: datasetBody("2030-06-01.1"),
    });
    const result = await evaluate({
      commandId: "quality-command-alias",
      datasetRef: { kind: "content-artifact", reference },
    });
    expect(result).toMatchObject({ kind: "failed", failure: { code: "STALE_VERSION" } });
    const rows = await fixture!.postgres.adminPool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM ${TABLE} WHERE command_id = $1`,
      ["quality-command-alias"],
    );
    expect(rows.rows[0]?.total).toBe("0");
  }, 300_000);

  it("并发同摘要只冻结一次且不同运行报告可各自成立", async () => {
    const body = { ...datasetBody("2030-06-04.1"), datasetId: "c36-concurrent-same" };
    const reference = await putJson({
      artifactId: `quality-dataset-${body.datasetId}@${body.datasetVersion}`,
      purposeCode: DATASET_PURPOSE_CODE,
      mediaType: DATASET_MEDIA_TYPE,
      value: body,
    });
    const datasetRef = { kind: "content-artifact" as const, reference };
    const inputs = [
      { commandId: "quality-concurrent-same-a", datasetRef },
      {
        commandId: "quality-concurrent-same-b",
        datasetRef,
        runRefs: [
          {
            kind: "workflow-run" as const,
            reference: { entityId: "quality-run-b", versionId: "1" },
          },
        ],
      },
    ];
    const results = await Promise.all(inputs.map(evaluate));
    expect(results.map((result) => result.kind)).toEqual(["succeeded", "succeeded"]);
    const freeze = await fixture!.postgres.adminPool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM ${DATASET_TABLE} WHERE project_id = $1 AND dataset_id = $2`,
      [authorization.projectId, body.datasetId],
    );
    expect(freeze.rows[0]?.total).toBe("1");
    const reports = await fixture!.postgres.adminPool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM ${TABLE} WHERE project_id = $1 AND dataset_artifact_id = $2`,
      [authorization.projectId, datasetRef.reference.entityId],
    );
    expect(reports.rows[0]?.total).toBe("2");
    const replayed = await evaluate(inputs[0]!);
    expect(replayed.kind).toBe("succeeded");
    const afterReplay = await fixture!.postgres.adminPool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM ${TABLE} WHERE project_id = $1 AND dataset_artifact_id = $2`,
      [authorization.projectId, datasetRef.reference.entityId],
    );
    expect(afterReplay.rows[0]?.total).toBe("2");
  }, 300_000);

  it("并发同版本不同摘要仅一条正式报告，另一条报错版", async () => {
    const artifactId = "quality-dataset-c36-concurrent-conflict@2030-06-05.1";
    const datasetRef = await Promise.all(
      [datasetBody("2030-06-05.1"), datasetBody("2030-06-05.1", seededSamples.slice(0, 3))].map(
        async (body) => ({
          kind: "content-artifact" as const,
          reference: await putJson({
            artifactId,
            purposeCode: DATASET_PURPOSE_CODE,
            mediaType: DATASET_MEDIA_TYPE,
            value: { ...body, datasetId: "c36-concurrent-conflict" },
          }),
        }),
      ),
    );
    expect(datasetRef[0]!.reference.versionId).not.toBe(datasetRef[1]!.reference.versionId);
    const results = await Promise.all(
      datasetRef.map((ref, index) =>
        evaluate({
          commandId: `quality-concurrent-conflict-${index}`,
          datasetRef: ref,
        }),
      ),
    );
    expect(results.map((result) => result.kind).sort()).toEqual(["failed", "succeeded"]);
    expect(results.find((result) => result.kind === "failed")).toMatchObject({
      kind: "failed",
      failure: { code: "STALE_VERSION" },
    });
    const freeze = await fixture!.postgres.adminPool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM ${DATASET_TABLE} WHERE project_id = $1 AND dataset_id = $2`,
      [authorization.projectId, "c36-concurrent-conflict"],
    );
    expect(freeze.rows[0]?.total).toBe("1");
    const reports = await fixture!.postgres.adminPool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM ${TABLE} WHERE project_id = $1 AND dataset_artifact_id = $2`,
      [authorization.projectId, artifactId],
    );
    expect(reports.rows[0]?.total).toBe("1");
  }, 300_000);

  it("缺少 projection.export 的授权上下文被拒绝且不写索引", async () => {
    const denied: AuthorizationContextV1 = {
      ...authorization,
      grantedCapabilities: ["projection.query"],
    };
    const result = await evaluate({
      commandId: "quality-command-denied",
      datasetRef: datasetArtifactRef!,
      authorization: denied,
    });
    expect(result).toMatchObject({ kind: "failed", failure: { code: "AUTHORIZATION_DENIED" } });
    const deniedRows = await fixture!.postgres.adminPool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM ${TABLE} WHERE command_id = $1`,
      ["quality-command-denied"],
    );
    expect(deniedRows.rows[0]?.total).toBe("0");

    const wrongScope = await evaluate({
      commandId: "quality-command-wrong-scope",
      datasetRef: datasetArtifactRef!,
      authorization: {
        ...authorization,
        spatialScopeRefs: [
          { kind: "spatial-scope", reference: { entityId: "other-scope", versionId: "v1" } },
        ],
      },
    });
    expect(wrongScope).toMatchObject({ kind: "failed", failure: { code: "AUTHORIZATION_DENIED" } });
  }, 300_000);
});

describe("C36 页面查询投影", () => {
  it("以当前授权有界分页与精确命中返回摘要", async () => {
    const projection = queryProjection();
    const listed = await projection.query(
      queryEnvelope(
        { queryType: "quality-evaluation", selector: qualityListSelector },
        "quality-query-list",
      ),
    );
    expect(listed.kind).toBe("succeeded");
    if (listed.kind !== "succeeded") return;
    expect(listed.result.queryResultRef.kind).toBe("query-result");
    expect(listed.result.nextCursor).toBeUndefined();
    const summary = listed.result.qualitySummaries?.find(
      (item) => item.reportArtifactRef.reference.entityId === reportArtifactRef?.reference.entityId,
    );
    expect(summary).toBeDefined();
    if (summary === undefined) return;
    expect(summary.metrics).toHaveLength(7);
    expect(summary.label).toBe("合成样本，待甲方复核");
    expect(summary.sampleKind).toBe("synthetic");
    expect(summary.reportArtifactRef).toEqual(reportArtifactRef);
    expect(summary.datasetArtifactRef).toEqual(datasetArtifactRef);
    expect(summary.evidenceRefs).toEqual([]);

    const exact = await projection.query(
      queryEnvelope(
        {
          queryType: "quality-evaluation",
          selector: { mode: "exact", reportArtifactRef },
        },
        "quality-query-exact",
      ),
    );
    expect(exact.kind === "succeeded" && exact.result.qualitySummaries).toHaveLength(1);
  }, 300_000);

  it("无权、跨空间、跨工程、不存在与非法游标统一同形拒绝，旧查询类型不被接管", async () => {
    const projection = queryProjection();
    const otherProject = "other-quality-project";
    const foreignCursor = Buffer.from(
      JSON.stringify({
        projectId: otherProject,
        projectRevisionRef: { entityId: "quality-revision", versionId: "r1" },
        createdAt: QUALITY_FIXTURE_TIME,
        reportArtifactId: "other-project-report",
        reportArtifactVersionId: "1",
      }),
      "utf8",
    ).toString("base64url");
    const absent = await projection.query(
      queryEnvelope(
        {
          queryType: "quality-evaluation",
          selector: {
            mode: "exact",
            reportArtifactRef: contentRef("absent-report", `sha256:${"0".repeat(64)}`),
          },
        },
        "quality-query-absent",
      ),
    );
    const crossProject = await projection.query({
      ...queryEnvelope(
        {
          queryType: "quality-evaluation",
          selector: { mode: "exact", reportArtifactRef },
        },
        "quality-query-cross-project",
      ),
      projectId: otherProject,
      authorization: {
        ...authorization,
        projectId: otherProject,
        grantedCapabilities: ["projection.query"],
      },
    });
    const unauthorized = await projection.query({
      ...queryEnvelope(
        {
          queryType: "quality-evaluation",
          selector: { mode: "exact", reportArtifactRef },
        },
        "quality-query-unauthorized",
      ),
      authorization: {
        ...authorization,
        grantedCapabilities: ["projection.query", "projection.export"],
      },
    });
    const crossSpace = await projection.query({
      ...queryEnvelope(
        {
          queryType: "quality-evaluation",
          selector: { mode: "exact", reportArtifactRef },
        },
        "quality-query-cross-space",
      ),
      authorization: {
        ...authorization,
        grantedCapabilities: ["projection.query"],
        spatialScopeRefs: [
          { kind: "spatial-scope", reference: { entityId: "other-scope", versionId: "v1" } },
        ],
      },
    });
    const cursor = await projection.query(
      queryEnvelope(
        {
          queryType: "quality-evaluation",
          selector: { ...qualityListSelector, pageSize: 10, cursor: foreignCursor },
        },
        "quality-query-cursor",
      ),
    );
    const malformedCursor = Buffer.from(
      JSON.stringify({
        projectId: authorization.projectId,
        projectRevisionRef: { entityId: "quality-revision", versionId: "r1" },
        createdAt: "not-a-date",
        reportArtifactId: "quality-report",
        reportArtifactVersionId: "1",
      }),
      "utf8",
    ).toString("base64url");
    const malformed = await projection.query(
      queryEnvelope(
        {
          queryType: "quality-evaluation",
          selector: { ...qualityListSelector, pageSize: 10, cursor: malformedCursor },
        },
        "quality-query-malformed-cursor",
      ),
    );
    const legacy = await projection.query(
      queryEnvelope(
        {
          queryType: "review-queue",
          projectRevisionRef: {
            kind: "project-revision",
            reference: { entityId: "quality-revision", versionId: "r1" },
          },
        },
        "quality-query-legacy",
      ),
    );
    const codes = [absent, cursor, malformed, crossProject, crossSpace, unauthorized].map(
      (outcome) => (outcome.kind === "failed" ? outcome.error.code : "succeeded"),
    );
    expect(codes).toEqual([
      "ENTITY_NOT_FOUND",
      "ENTITY_NOT_FOUND",
      "ENTITY_NOT_FOUND",
      "ENTITY_NOT_FOUND",
      "ENTITY_NOT_FOUND",
      "ENTITY_NOT_FOUND",
    ]);
    expect(legacy.kind === "failed" && legacy.error.code).toBe("UNSUPPORTED_CONTRACT");
    const rejectionShapes = new Set(
      [absent, cursor, malformed, crossProject, crossSpace, unauthorized].map((outcome) =>
        outcome.kind === "failed"
          ? JSON.stringify({
              code: outcome.error.code,
              category: outcome.error.category,
              retryable: outcome.error.retryable,
              stageCode: outcome.error.stageCode,
            })
          : "succeeded",
      ),
    );
    expect(rejectionShapes.size).toBe(1);
  }, 300_000);

  it("撤权后证据定位引用被过滤而工程级摘要仍可见", async () => {
    const projection = queryProjection();
    const listed = await projection.query({
      ...queryEnvelope(
        { queryType: "quality-evaluation", selector: qualityListSelector },
        "quality-query-redacted",
      ),
      authorization: {
        ...authorization,
        grantedCapabilities: ["projection.query"],
        sourceAccessGrantRefs: [],
      },
    });
    expect(listed.kind).toBe("succeeded");
    if (listed.kind !== "succeeded") return;
    expect(listed.result.qualitySummaries?.length).toBeGreaterThan(0);
    expect(
      listed.result.qualitySummaries?.every((summary) => summary.evidenceRefs.length === 0),
    ).toBe(true);
  }, 300_000);
});

describe("C36 数据集计算 CLI", () => {
  const CLI_PROJECT_ID = "quality-cli-project";
  const CLI_OPERATOR = "quality-cli-operator";
  const CLI_OPERATOR_PASSWORD = "Riskflow-Cli-Operator-2030!";
  const CLI_OPERATOR_PASSWORD_CHANGED = "Riskflow-Cli-Operator-2030-Changed!";
  const CLI_HMAC_KEY = Buffer.alloc(32, 11);

  it("冻结数据集、写 C04 报告并按实际命令输出安全引用", async () => {
    const cliWorld = await realOperatorWorld({
      projectId: CLI_PROJECT_ID,
      loginName: CLI_OPERATOR,
      password: CLI_OPERATOR_PASSWORD,
      changedPassword: CLI_OPERATOR_PASSWORD_CHANGED,
    });
    const cliSpatialScopeRef = cliWorld.accessScopeRef;

    // CLI 需要一份已冻结的运行输出：正式记录身份与 C04 记录快照。
    const cliAuthorization: AuthorizationContextV1 = {
      ...AUTHORIZATION_FIXTURE,
      projectId: CLI_PROJECT_ID,
      grantedCapabilities: ["projection.export"],
    };
    const cliRecordId = "identification-risk-record-cli-1";
    const cliRecordDigest = sha256CanonicalJson({ projectId: CLI_PROJECT_ID, cliRecordId });
    const cliSourceSegmentRef = {
      locator: { sourceSegmentId: "segment-cli-1" },
      sourceVersion: { entityId: "quality-source", versionId: "v1" },
    };
    const cliRecordStore = new PostgresRiskCandidateFinalizationAdapter({
      db: fixture!.runtime.db,
      transactionUnit: fixture!.transactionUnit,
    });
    await fixture!.transactionUnit.execute(
      AtomicCommandV1Schema.parse({
        projectId: CLI_PROJECT_ID,
        commandKind: "identification.risk-record-accepted",
        commandId: "cli-seed-record",
        idempotencyKey: "cli-seed-record",
        payload: { cliRecordId },
        actorRef: cliAuthorization.actorId,
        authorizationContextRef: cliAuthorization.authorizationContextRef,
        issuedAt: QUALITY_FIXTURE_TIME,
      }),
      async (context) => {
        const target = {
          kind: "standardized-risk-record" as const,
          reference: { entityId: "cli-seed", versionId: "1" },
        };
        const insertion = await cliRecordStore.insertRecords(
          {
            rows: [
              {
                riskRecordId: cliRecordId,
                versionId: cliRecordDigest,
                riskRecordRef: {
                  kind: "standardized-risk-record",
                  reference: { entityId: cliRecordId, versionId: cliRecordDigest },
                },
                rowId: `${cliRecordId}:row`,
                idempotencyKey: `${cliRecordId}:idempotency`,
                requestDigest: cliRecordDigest,
                projectId: CLI_PROJECT_ID,
                workPlanRef: {
                  kind: "identification-work-plan",
                  reference: { entityId: "cli-work-plan", versionId: "1" },
                },
                identificationRunRef: {
                  kind: "workflow-run",
                  reference: { entityId: "cli-run", versionId: "1" },
                },
                inputSnapshotRef: {
                  kind: "identification-input-snapshot",
                  reference: { entityId: "cli-input", versionId: "1" },
                },
                mergePlanRef: {
                  kind: "merge-plan",
                  reference: { entityId: "cli-merge", versionId: "1" },
                },
                routeDecisionRef: {
                  kind: "route-decision",
                  reference: { entityId: "cli-route", versionId: "1" },
                },
                groupId: "cli-group",
                groupVersionId: "1",
                groupRef: {
                  kind: "identification-group",
                  reference: { entityId: "cli-group", versionId: "1" },
                },
                representativeCandidateRefs: [
                  {
                    kind: "content-artifact",
                    reference: { entityId: "cli-candidate", versionId: "1" },
                  },
                ],
                sourceSegmentIds: [cliSourceSegmentRef.locator.sourceSegmentId],
                mechanismEntryIds: ["cli-mechanism"],
                spatialScopeRefs: [
                  {
                    kind: "spatial-scope",
                    reference: { entityId: "cli-scope-ref", versionId: "1" },
                  },
                ],
                sourceVersionRefs: [
                  {
                    kind: "source-version",
                    reference: { entityId: "cli-source-ref", versionId: "1" },
                  },
                ],
                evidenceReferences: [
                  {
                    locator: { sourceSegmentId: cliSourceSegmentRef.locator.sourceSegmentId },
                    sourceVersion: { entityId: "cli-source-ref", versionId: "1" },
                  },
                ],
                authorizationScopeDigest: sha256CanonicalJson({ scope: "cli-scope" }),
                authorizationContextRef: cliAuthorization.authorizationContextRef,
                actorRef: cliAuthorization.actorId,
                commandId: "cli-seed-record",
                occurredAt: QUALITY_FIXTURE_TIME,
              },
            ],
            records: [
              {
                riskRecordId: cliRecordId,
                record: {
                  processNodeId: "process-node-cli",
                  riskSource: "cli-risk-source",
                  riskFactor: "cli-risk-factor",
                  riskEvent: "risk-event-cli",
                  riskElementRelations: [
                    { sourceElement: "element-a", relation: "affects", targetElement: "element-b" },
                  ],
                  evidenceLocator: { sourceSegmentId: "segment-cli-1" },
                  modelConfidence: 0.5,
                },
                riskMechanismEntryIds: ["cli-mechanism"],
                sourceIds: ["quality-source"],
                compositeConfidence: { value: 0.5, basis: ["cli:0.5"] },
                version: {
                  reference: { entityId: cliRecordId, versionId: cliRecordDigest },
                  effectivePeriod: { validFrom: QUALITY_FIXTURE_TIME },
                  systemTime: { recordedAt: QUALITY_FIXTURE_TIME },
                },
                audit: {
                  actorId: cliAuthorization.actorId,
                  action: "identification.risk-record-accepted",
                  recordedAt: QUALITY_FIXTURE_TIME,
                },
              },
            ],
            occurredAt: QUALITY_FIXTURE_TIME,
          },
          context,
        );
        if (insertion.kind === "conflict") throw new Error("cli fixture record conflicted");
        return {
          resultRef: target,
          audit: {
            auditEntryId: "cli-seed-record:audit",
            projectId: CLI_PROJECT_ID,
            action: "identification.risk-record-accepted",
            targetRef: target,
            actorRef: cliAuthorization.actorId,
            authorizationContextRef: cliAuthorization.authorizationContextRef,
            occurredAt: QUALITY_FIXTURE_TIME,
            recordedAt: QUALITY_FIXTURE_TIME,
            version: { entityId: "cli-seed-record:audit", versionId: "1" },
            commandId: "cli-seed-record",
            idempotencyKey: "cli-seed-record",
          },
          events: [],
        };
      },
    );
    const cliSnapshotRef = await putJson({
      artifactId: "quality-sample-snapshot-cli-1",
      purposeCode: "quality-evaluation.sample-snapshot",
      mediaType: "application/json",
      value: {
        riskRecordId: cliRecordId,
        record: {
          processNodeId: "process-node-cli",
          riskSource: "cli-risk-source",
          riskFactor: "cli-risk-factor",
          riskEvent: "risk-event-cli",
          riskElementRelations: [
            { sourceElement: "element-a", relation: "affects", targetElement: "element-b" },
          ],
          evidenceLocator: { sourceSegmentId: "segment-cli-1" },
          modelConfidence: 0.5,
        },
        riskMechanismEntryIds: ["cli-mechanism"],
        sourceIds: ["quality-source"],
        compositeConfidence: { value: 0.5, basis: ["cli:0.5"] },
        version: {
          reference: { entityId: cliRecordId, versionId: cliRecordDigest },
          effectivePeriod: { validFrom: QUALITY_FIXTURE_TIME },
          systemTime: { recordedAt: QUALITY_FIXTURE_TIME },
        },
        audit: {
          actorId: cliAuthorization.actorId,
          action: "identification.risk-record-accepted",
          recordedAt: QUALITY_FIXTURE_TIME,
        },
      },
    });

    const datasetPath = join(tmpdir(), `c36-cli-dataset-${process.pid}.json`);
    const outputPath = join(tmpdir(), `c36-cli-output-${process.pid}.json`);
    const configPath = join(tmpdir(), `c36-cli-config-${process.pid}.json`);
    const cliDataset = {
      schemaVersion: "1",
      datasetId: "c36-cli-dataset",
      datasetVersion: "2030-06-03.1",
      sampleKind: "synthetic",
      sourceQualificationRef: null,
      sourceQualificationMissingReasonCode: "no-deidentified-party-samples-supplied",
      projectId: CLI_PROJECT_ID,
      projectRevisionRef: {
        kind: "project-revision",
        reference: { entityId: "cli-revision", versionId: "r1" },
      },
      labelPolicyRef: { entityId: "quality-label-policy", versionId: "v1" },
      createdAt: QUALITY_FIXTURE_TIME,
      samples: [
        {
          sampleId: "cli-sample-1",
          spatialScopeRef: cliSpatialScopeRef,
          processNodeId: "process-node-cli",
          sourceSegmentRefs: [cliSourceSegmentRef],
          applicabilitySnapshotRef: {
            kind: "applicability-metadata-snapshot",
            reference: { entityId: "cli-applicability", versionId: "1" },
          },
          identificationInputSnapshotRef: {
            kind: "identification-input-snapshot",
            reference: { entityId: "cli-input", versionId: "1" },
          },
          assessmentInputSnapshotRef: {
            kind: "assessment-input-snapshot",
            reference: { entityId: "cli-assessment-input", versionId: "1" },
          },
          riskRecordRef: {
            kind: "standardized-risk-record",
            reference: { entityId: cliRecordId, versionId: cliRecordDigest },
          },
          standardizedRiskRecordSnapshotArtifactRef: {
            kind: "content-artifact",
            reference: cliSnapshotRef,
          },
          expectedEventKey: "risk-event-cli",
          expectedPositive: true,
          requiredEvidenceRefs: [cliSourceSegmentRef],
          versionRefs: {
            identificationKnowledgeReleaseRef: {
              entityId: "identification-knowledge",
              versionId: "k3",
            },
            identificationPolicySetRef: { entityId: "identification-policy-set", versionId: "p2" },
            indicatorSystemRef: { entityId: "indicator-system", versionId: "i4" },
            indicatorFieldMappingRef: { entityId: "indicator-field-mapping", versionId: "m2" },
            applicableRuleSetRef: { entityId: "applicable-rule-set", versionId: "r5" },
            weightSetRef: { entityId: "weight-set", versionId: "w3" },
            riskMatrixRef: { entityId: "risk-matrix", versionId: "mx2" },
            modelDeploymentRef: { entityId: "model-deployment", versionId: "md1" },
            promptTemplateRef: { entityId: "prompt-template", versionId: "pt4" },
            reviewPolicyRef: { entityId: "review-policy", versionId: "rp1" },
          },
        },
      ],
    };
    writeFileSync(datasetPath, JSON.stringify(cliDataset, null, 2), "utf8");
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          connection: fixture!.postgres.app,
          artifactRootDirectory: fixture!.artifactRootDirectory,
          artifactPolicy: artifactPolicy(),
          projectId: CLI_PROJECT_ID,
          loginName: CLI_OPERATOR,
          password: CLI_OPERATOR_PASSWORD_CHANGED,
          hmacKeyBase64: CLI_HMAC_KEY.toString("base64"),
          keyVersion: "key-v1",
          codeHead: "c36-cli-evidence",
          runRefs: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const cli = spawnSync(
      process.execPath,
      [resolve(SCRIPT_PATH), "--dataset", datasetPath, "--output", outputPath],
      {
        cwd: resolve(SCRIPT_PATH, "../../.."),
        env: { ...process.env, QUALITY_EVALUATION_CONFIG: configPath },
        encoding: "utf8",
      },
    );
    expect(cli.stderr).toBe("");
    expect(cli.status).toBe(0);
    const output = JSON.parse(readFileSync(outputPath, "utf8")) as {
      datasetArtifactRef: ContentArtifactRefV1;
      reportArtifactRef: ContentArtifactRefV1;
      command: string;
      metrics: readonly { metricCode: string }[];
    };
    expect(output.command).toContain("--dataset");
    expect(output.reportArtifactRef.reference.entityId).toContain("quality-evaluation-report-");
    expect(output.metrics.map((metric) => metric.metricCode)).toHaveLength(7);

    const cliIndex = await fixture!.postgres.adminPool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM ${TABLE} WHERE project_id = $1 AND report_artifact_id = $2`,
      [CLI_PROJECT_ID, output.reportArtifactRef.reference.entityId],
    );
    expect(cliIndex.rows[0]?.total).toBe("1");

    // 报告工件由 CLI 以真实 C06 会话写入；读回必须使用同一签发路径取得的等价授权。
    const readAccess = createPostgresLocalIdentityAccess({
      ...fixture!.postgres.app,
      hmacKey: CLI_HMAC_KEY,
      keyVersion: "key-v1",
    });
    let readAuthorization: AuthorizationContextV1;
    try {
      const readSession = await readAccess.login({
        kind: "login",
        loginAttemptId: "cli-read-login",
        loginName: CLI_OPERATOR,
        password: CLI_OPERATOR_PASSWORD_CHANGED,
      });
      const readDecision = await readAccess.authorize({
        invocation: { kind: "human-session", sessionToken: readSession.sessionToken },
        invocationId: "cli-read-authorize",
        projectId: CLI_PROJECT_ID,
        branch: "projection.export",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      });
      readAuthorization = readDecision.context;
    } finally {
      await readAccess.close().catch(() => undefined);
    }
    const cliRead = await fixture!.artifactStore.open({
      schemaVersion: "1",
      requestId: "cli-report-read",
      idempotencyKey: "cli-report-read",
      artifactRef: output.reportArtifactRef,
      projectId: CLI_PROJECT_ID,
      actorId: readAuthorization.actorId,
      requestedAt: QUALITY_FIXTURE_TIME,
      purposeCode: REPORT_PURPOSE_CODE,
      requiredCapability: "projection.export",
      authorization: readAuthorization,
    });
    const cliChunks: Uint8Array[] = [];
    for await (const chunk of cliRead.content) cliChunks.push(chunk);
    const cliReceipt = await cliRead.verified;
    expect(`sha256:${cliReceipt.content.hash.value}`).toBe(
      output.reportArtifactRef.reference.versionId,
    );
    expect(cliChunks.length).toBeGreaterThan(0);
  }, 300_000);
});

describe("C36 正式零结果公开读组合", () => {
  it("只在终态全集、精确工作项和当前授权一致时出具冻结范围证明", async () => {
    const synthetic = QualityDatasetV1Schema.parse(
      JSON.parse(
        readFileSync(
          resolve(import.meta.dirname, "../../../core/test/quality/fixtures/synthetic.json"),
          "utf8",
        ),
      ),
    );
    const base = synthetic.samples.find((sample) => sample.sampleId === "sample-gamma")!;
    const runRef = {
      kind: "workflow-run" as const,
      reference: { entityId: "run", versionId: "1" },
    };
    const workPlanRef = {
      kind: "identification-work-plan" as const,
      reference: { entityId: "plan", versionId: "1" },
    };
    const terminalResultRef = {
      kind: "identification-run-result" as const,
      reference: { entityId: "terminal", versionId: "1" },
    };
    const workItemRef = {
      kind: "identification-work-item" as const,
      reference: { entityId: "work-item", versionId: "1" },
    };
    const zeroResultRef = {
      kind: "identification-zero-result" as const,
      reference: { entityId: "zero-result", versionId: "1" },
    };
    const sample = { ...base, formalRunProofRefs: { runRef, workPlanRef, terminalResultRef } };
    const sourceVersionRef = {
      kind: "source-version" as const,
      reference: base.sourceSegmentRefs[0]!.sourceVersion,
    };
    const workItem = {
      workItemRef,
      nodeId: base.processNodeId,
      spatialScopeRefs: [base.spatialScopeRef],
      sourceVersionRefs: [sourceVersionRef],
    };
    const result = {
      projectId: authorization.projectId,
      runRef,
      workPlanRef,
      inputSnapshotRef: base.identificationInputSnapshotRef,
      acceptedRiskRecordRefs: [],
      acceptedEventRefs: [],
      failedWorkItemRefs: [],
      skippedWorkItemRefs: [],
      rejectedGroupRefs: [],
      pendingReviewTaskRefs: [],
      zeroResults: [{ workItemRef, zeroResultRef }],
    };
    let current = true;
    const adapter = createPostgresQualityEvaluationAdapter({
      db: fixture!.runtime.db,
      transactionUnit: fixture!.transactionUnit,
      artifactStore: fixture!.artifactStore,
      artifactReferenceGuard: fixture!.artifactRegistry,
      recordStore: new PostgresRiskCandidateFinalizationAdapter({
        db: fixture!.runtime.db,
        transactionUnit: fixture!.transactionUnit,
      }),
      evidenceAccess: fixture!.contextSource,
      formalRunEvidence: {
        registrationStore: {
          async readCompletedRunResult() {
            return { kind: "read", runResult: result as never };
          },
        },
        workPlanReader: {
          async readExact() {
            return {
              kind: "succeeded",
              read: { inputSnapshotRef: result.inputSnapshotRef, workItems: [workItem] } as never,
            };
          },
        },
        zeroResultReader: {
          async readZeroResult() {
            return current
              ? {
                  kind: "read",
                  zeroResult: {
                    nodeId: workItem.nodeId,
                    workItemRef,
                    inputSnapshotRef: result.inputSnapshotRef,
                  } as never,
                }
              : { kind: "unavailable" };
          },
        },
      },
    });
    const request = {
      projectId: authorization.projectId,
      actorId: authorization.actorId,
      requestedAt: QUALITY_FIXTURE_TIME,
      sample,
      spatialScopeRefs: [base.spatialScopeRef],
      sourceVersionRefs: [sourceVersionRef],
      issuer: {
        async issueReadAuthorization() {
          return { ...authorization, grantedCapabilities: ["risk-identification.run" as const] };
        },
      },
    };
    const proved = await adapter.readFormalZeroResult(request);
    expect(proved.kind).toBe("proved");
    expect(await adapter.readFormalZeroResult(request)).toEqual(proved);
    expect(
      (
        await adapter.readFormalZeroResult({
          ...request,
          sample: {
            ...sample,
            processNodeId: "another-node",
          },
        })
      ).kind,
    ).toBe("failed");
    current = false;
    expect((await adapter.readFormalZeroResult(request)).kind).toBe("failed");
  });
});

describe("C36 必审资料段证明（真实 C13/C06）", () => {
  const EVIDENCE_PROJECT_ID = "quality-required-evidence-project";
  const EVIDENCE_OPERATOR = "quality-evidence-operator";
  const EVIDENCE_PASSWORD = "Riskflow-Evidence-2030!";
  const EVIDENCE_PASSWORD_CHANGED = "Riskflow-Evidence-2030-Changed!";

  it("逐项解析必审资料段并计入审计链完整率，缺项、错版与撤权失败闭合", async () => {
    const world = await realOperatorWorld({
      projectId: EVIDENCE_PROJECT_ID,
      loginName: EVIDENCE_OPERATOR,
      password: EVIDENCE_PASSWORD,
      changedPassword: EVIDENCE_PASSWORD_CHANGED,
    });
    const source = await seedRealSource({
      world,
      projectId: EVIDENCE_PROJECT_ID,
      suffix: "required-evidence",
    });
    // 资料授权事实由 C13 写入分支的项目风险经理上下文登记，与 C06 现有命令语义一致。
    const sourceAccessContext = await authorizeFor({
      world,
      projectId: EVIDENCE_PROJECT_ID,
      branch: "engineering-data.register-source-delivery",
      invocationId: "c36-source-access-context-required-evidence",
    });
    const reviseSourceAccess = async (input: {
      readonly commandId: string;
      readonly visibility: "project-shared" | "restricted";
      readonly allowedAccountIds: readonly string[];
      readonly registeredByAccountId: string;
    }) =>
      fixture!.access.administerProject({
        kind: "revise-source-access",
        projectId: EVIDENCE_PROJECT_ID,
        commandId: input.commandId,
        idempotencyKey: input.commandId,
        expectedVersion: await currentSourceGrantVersion({
          projectId: EVIDENCE_PROJECT_ID,
          sourceVersionRef: source.sourceVersionRef,
        }),
        authorizationContextRef: sourceAccessContext.authorizationContextRef,
        sourceVersionRef: source.sourceVersionRef,
        visibility: input.visibility,
        allowedAccountIds: [...input.allowedAccountIds],
        spatialScopeRefs: [world.accessScopeRef],
        registeredByAccountId: input.registeredByAccountId,
      });
    await reviseSourceAccess({
      commandId: "c36-required-evidence-grant",
      visibility: "project-shared",
      allowedAccountIds: [],
      registeredByAccountId: world.accountId,
    });
    const evaluationAuthorization = await authorizeFor({
      world,
      projectId: EVIDENCE_PROJECT_ID,
      branch: "projection.export",
      invocationId: "c36-required-evidence-evaluate",
    });
    const segmentRefs = [source.segmentIds[0]!, source.segmentIds[1]!].map((sourceSegmentId) => ({
      locator: { sourceSegmentId },
      sourceVersion: source.sourceVersionRef.reference,
    }));
    const evaluateWithIssuer = (commandId: string, datasetArtifactRef: ContentArtifactRefV1) =>
      evaluationService().evaluateDataset({
        projectId: EVIDENCE_PROJECT_ID,
        actorId: world.accountId,
        commandId,
        idempotencyKey: commandId,
        requestedAt: QUALITY_FIXTURE_TIME,
        datasetArtifactRef,
        runRefs: [],
        authorization: evaluationAuthorization,
        requiredEvidenceAccess: evidenceIssuerFor(world, EVIDENCE_PROJECT_ID),
        runEvidence: {
          commands: [
            "pnpm exec vitest run packages/adapters/test/quality/postgres-quality-evaluation.test.ts",
          ],
          codeHead: "c36-required-evidence",
          environment: { nodeVersion: process.version },
        },
      });
    const auditOf = (report: QualityEvaluationReportV1) =>
      report.metrics.find((metric) => metric.metricCode === "audit-completeness");

    const positiveRef = await putProjectArtifact({
      authorization: evaluationAuthorization,
      datasetId: "c36-required-evidence-dataset",
      datasetVersion: "2030-06-06.1",
      value: projectDatasetBody({
        projectId: EVIDENCE_PROJECT_ID,
        datasetId: "c36-required-evidence-dataset",
        projectRevisionRef: {
          kind: "project-revision",
          reference: { entityId: "quality-required-evidence-revision", versionId: "r1" },
        },
        datasetVersion: "2030-06-06.1",
        spatialScopeRef: world.accessScopeRef,
        samples: [
          {
            sampleId: "required-1",
            sourceSegmentRefs: [segmentRefs[0]],
            requiredEvidenceRefs: [segmentRefs[0]],
          },
          {
            sampleId: "required-2",
            sourceSegmentRefs: [segmentRefs[1]],
            requiredEvidenceRefs: [segmentRefs[1]],
          },
        ],
      }),
    });
    const positive = await evaluateWithIssuer("c36-required-evidence-command", positiveRef);
    expect(positive.kind).toBe("succeeded");
    if (positive.kind !== "succeeded") return;
    expect(auditOf(positive.report)).toMatchObject({
      numerator: 2,
      denominator: 2,
      status: "computed",
      value: 1,
    });
    expect(positive.report.evidenceChainStatus).toBe("complete");
    expect(
      positive.report.samples.every(
        (sample) => !sample.reasonCodes.includes("quality-evidence-artifact-unverified"),
      ),
    ).toBe(true);

    // 同版重放：同一命令、同一冻结版本得到同一收据集合与报告引用。
    const replayed = await evaluateWithIssuer("c36-required-evidence-command", positiveRef);
    expect(replayed.kind).toBe("succeeded");
    if (replayed.kind !== "succeeded") return;
    expect(replayed.reportArtifactRef).toEqual(positive.reportArtifactRef);
    expect(auditOf(replayed.report)).toEqual(auditOf(positive.report));

    // 缺一项：拥有方无法解析的资料段使该样例审计链失败闭合，且不产出部分收据。
    const absentRef = {
      locator: {
        sourceSegmentId: `${source.sourceVersionRef.reference.entityId}-chapter_1-segment_9`,
      },
      sourceVersion: source.sourceVersionRef.reference,
    };
    const missingRef = await putProjectArtifact({
      authorization: evaluationAuthorization,
      datasetId: "c36-required-evidence-dataset",
      datasetVersion: "2030-06-06-missing.1",
      value: projectDatasetBody({
        projectId: EVIDENCE_PROJECT_ID,
        datasetId: "c36-required-evidence-dataset",
        projectRevisionRef: {
          kind: "project-revision",
          reference: { entityId: "quality-required-evidence-revision", versionId: "r1" },
        },
        datasetVersion: "2030-06-06-missing.1",
        spatialScopeRef: world.accessScopeRef,
        samples: [
          {
            sampleId: "required-missing",
            sourceSegmentRefs: [segmentRefs[0], absentRef],
            requiredEvidenceRefs: [segmentRefs[0], absentRef],
          },
        ],
      }),
    });
    const missing = await evaluateWithIssuer("c36-required-evidence-missing", missingRef);
    expect(missing.kind).toBe("succeeded");
    if (missing.kind !== "succeeded") return;
    expect(auditOf(missing.report)).toMatchObject({ numerator: 0, denominator: 1 });
    expect(missing.report.evidenceChainStatus).toBe("partial");
    expect(missing.report.samples[0]?.reasonCodes).toContain(
      "quality-evidence-artifact-unverified",
    );

    // 错版：资料版本没有当前策略，签发即拒权，样例保持未判定。
    const wrongVersionRef = {
      locator: { sourceSegmentId: segmentRefs[0]!.locator.sourceSegmentId },
      sourceVersion: { entityId: source.sourceVersionRef.reference.entityId, versionId: "2" },
    };
    const driftedRef = await putProjectArtifact({
      authorization: evaluationAuthorization,
      datasetId: "c36-required-evidence-dataset",
      datasetVersion: "2030-06-06-drift.1",
      value: projectDatasetBody({
        projectId: EVIDENCE_PROJECT_ID,
        datasetId: "c36-required-evidence-dataset",
        projectRevisionRef: {
          kind: "project-revision",
          reference: { entityId: "quality-required-evidence-revision", versionId: "r1" },
        },
        datasetVersion: "2030-06-06-drift.1",
        spatialScopeRef: world.accessScopeRef,
        samples: [
          {
            sampleId: "required-drift",
            sourceSegmentRefs: [wrongVersionRef],
            requiredEvidenceRefs: [wrongVersionRef],
          },
        ],
      }),
    });
    const drifted = await evaluateWithIssuer("c36-required-evidence-drift", driftedRef);
    expect(drifted.kind).toBe("succeeded");
    if (drifted.kind !== "succeeded") return;
    expect(auditOf(drifted.report)).toMatchObject({ numerator: 0, denominator: 1 });

    // 跨空间：签发上下文不覆盖样例空间时，C13 拒绝解析，样例失败闭合。
    const crossSpace = await evaluationService().evaluateDataset({
      projectId: EVIDENCE_PROJECT_ID,
      actorId: world.accountId,
      commandId: "c36-required-evidence-cross-space",
      idempotencyKey: "c36-required-evidence-cross-space",
      requestedAt: QUALITY_FIXTURE_TIME,
      datasetArtifactRef: positiveRef,
      runRefs: [],
      authorization: evaluationAuthorization,
      requiredEvidenceAccess: {
        issueReadAuthorization: async (request) =>
          authorizeFor({
            world,
            projectId: EVIDENCE_PROJECT_ID,
            branch: "engineering-data.evidence-access",
            invocationId: request.queryId,
            spatialScopeRefs: [
              {
                kind: "spatial-scope",
                reference: { entityId: "quality-cross-space", versionId: "v1" },
              },
            ],
            sourceVersionRefs: request.sourceVersionRefs,
          }),
      },
      runEvidence: {
        commands: [
          "pnpm exec vitest run packages/adapters/test/quality/postgres-quality-evaluation.test.ts",
        ],
        codeHead: "c36-required-evidence",
        environment: { nodeVersion: process.version },
      },
    });
    expect(crossSpace.kind).toBe("succeeded");
    if (crossSpace.kind !== "succeeded") return;
    expect(auditOf(crossSpace.report)).toMatchObject({ numerator: 0, denominator: 2 });
    expect(crossSpace.report.evidenceChainStatus).toBe("partial");

    // 撤权：资料改为仅另一成员可见后当前会话无法解析，失败关闭且不复用旧收据。
    const administratorAccount = await fixture!.postgres.adminPool.query<{ account_id: string }>(
      "SELECT account_id FROM business.local_accounts WHERE login_name = $1",
      [TEST_ADMIN_LOGIN],
    );
    const otherAccountId = administratorAccount.rows[0]!.account_id;
    await reviseSourceAccess({
      commandId: "c36-required-evidence-revoke",
      visibility: "restricted",
      allowedAccountIds: [otherAccountId],
      registeredByAccountId: otherAccountId,
    });
    const revoked = await evaluateWithIssuer("c36-required-evidence-revoked", positiveRef);
    expect(revoked.kind).toBe("succeeded");
    if (revoked.kind !== "succeeded") return;
    expect(auditOf(revoked.report)).toMatchObject({ numerator: 0, denominator: 2 });
    expect(revoked.report.evidenceChainStatus).toBe("partial");
  }, 600_000);
});

describe("C36 投影 grant 与来源版本映射（真实 C06/C13）", () => {
  const GRANT_PROJECT_ID = "quality-grant-mapping-project";
  const GRANT_OPERATOR = "quality-grant-operator";
  const GRANT_PASSWORD = "Riskflow-Grant-2030!";
  const GRANT_PASSWORD_CHANGED = "Riskflow-Grant-2030-Changed!";
  const GRANT_REVISION = {
    kind: "project-revision" as const,
    reference: { entityId: "quality-grant-revision", versionId: "r1" },
  };

  it("只披露取得当前 grant 的来源版本定位引用，撤权与无映射只删定位不删摘要", async () => {
    const world = await realOperatorWorld({
      projectId: GRANT_PROJECT_ID,
      loginName: GRANT_OPERATOR,
      password: GRANT_PASSWORD,
      changedPassword: GRANT_PASSWORD_CHANGED,
    });
    const source = await seedRealSource({ world, projectId: GRANT_PROJECT_ID, suffix: "grant" });
    // 资料授权事实由 C13 写入分支的项目风险经理上下文登记，与 C06 现有命令语义一致。
    const sourceAccessContext = await authorizeFor({
      world,
      projectId: GRANT_PROJECT_ID,
      branch: "engineering-data.register-source-delivery",
      invocationId: "c36-source-access-context-grant",
    });
    const reviseSourceAccess = async (input: {
      readonly commandId: string;
      readonly visibility: "project-shared" | "restricted";
      readonly allowedAccountIds: readonly string[];
      readonly registeredByAccountId: string;
    }) =>
      fixture!.access.administerProject({
        kind: "revise-source-access",
        projectId: GRANT_PROJECT_ID,
        commandId: input.commandId,
        idempotencyKey: input.commandId,
        expectedVersion: await currentSourceGrantVersion({
          projectId: GRANT_PROJECT_ID,
          sourceVersionRef: source.sourceVersionRef,
        }),
        authorizationContextRef: sourceAccessContext.authorizationContextRef,
        sourceVersionRef: source.sourceVersionRef,
        visibility: input.visibility,
        allowedAccountIds: [...input.allowedAccountIds],
        spatialScopeRefs: [world.accessScopeRef],
        registeredByAccountId: input.registeredByAccountId,
      });
    await reviseSourceAccess({
      commandId: "c36-grant-source-access",
      visibility: "project-shared",
      allowedAccountIds: [],
      registeredByAccountId: world.accountId,
    });
    const evaluationAuthorization = await authorizeFor({
      world,
      projectId: GRANT_PROJECT_ID,
      branch: "projection.export",
      invocationId: "c36-grant-evaluate",
    });
    const segmentRefs = source.segmentIds.map((sourceSegmentId) => ({
      locator: { sourceSegmentId },
      sourceVersion: source.sourceVersionRef.reference,
    }));
    const datasetArtifactRef = await putProjectArtifact({
      authorization: evaluationAuthorization,
      datasetId: "c36-grant-dataset",
      datasetVersion: "2030-06-07.1",
      value: projectDatasetBody({
        projectId: GRANT_PROJECT_ID,
        datasetId: "c36-grant-dataset",
        projectRevisionRef: GRANT_REVISION,
        datasetVersion: "2030-06-07.1",
        spatialScopeRef: world.accessScopeRef,
        samples: segmentRefs.map((reference, index) => ({
          sampleId: `grant-${index + 1}`,
          sourceSegmentRefs: [reference],
          requiredEvidenceRefs: [reference],
        })),
      }),
    });
    const evaluated = await evaluationService().evaluateDataset({
      projectId: GRANT_PROJECT_ID,
      actorId: world.accountId,
      commandId: "c36-grant-evaluate-command",
      idempotencyKey: "c36-grant-evaluate-command",
      requestedAt: QUALITY_FIXTURE_TIME,
      datasetArtifactRef,
      runRefs: [],
      authorization: evaluationAuthorization,
      requiredEvidenceAccess: evidenceIssuerFor(world, GRANT_PROJECT_ID),
      runEvidence: {
        commands: [
          "pnpm exec vitest run packages/adapters/test/quality/postgres-quality-evaluation.test.ts",
        ],
        codeHead: "c36-grant-mapping",
        environment: { nodeVersion: process.version },
      },
    });
    expect(evaluated.kind).toBe("succeeded");
    if (evaluated.kind !== "succeeded") return;

    const queryAuthorization = await authorizeFor({
      world,
      projectId: GRANT_PROJECT_ID,
      branch: "projection.query",
      invocationId: "c36-grant-query",
    });
    const projection = queryProjection();
    const request = {
      queryId: "c36-grant-list",
      projectId: GRANT_PROJECT_ID,
      actorId: world.accountId,
      requestedAt: QUALITY_FIXTURE_TIME,
      authorization: queryAuthorization,
      kind: "query" as const,
      payload: {
        queryType: "quality-evaluation" as const,
        selector: { mode: "list" as const, projectRevisionRef: GRANT_REVISION, pageSize: 50 },
      },
    };
    const candidates = await projection.candidateSourceVersionRefs(request);
    expect(candidates.kind).toBe("candidates");
    if (candidates.kind !== "candidates") return;
    expect(candidates.versions.map((version) => version.sourceVersionRef)).toEqual([
      source.sourceVersionRef,
    ]);
    expect(candidates.rowRefs).toHaveLength(1);
    const grants = new Map<string, readonly SourceAccessGrantRefV1[]>();
    for (const [index, version] of candidates.versions.entries()) {
      const context = await authorizeFor({
        world,
        projectId: GRANT_PROJECT_ID,
        branch: "projection.query",
        invocationId: `c36-grant-sign-${index}`,
        sourceVersionRefs: [version.sourceVersionRef],
      });
      expect(context.grantedCapabilities).toEqual(["projection.query"]);
      grants.set(version.versionKey, context.sourceAccessGrantRefs);
    }
    expect([...grants.values()].every((grantRefs) => grantRefs.length > 0)).toBe(true);

    // grant 身份与来源版本身份不同：披露的定位引用必须仍精确对应被签发的来源版本。
    const disclosed = await projection.queryWithSourceGrants(request, grants, candidates);
    expect(disclosed.kind).toBe("succeeded");
    if (disclosed.kind !== "succeeded") return;
    expect(disclosed.result.qualitySummaries?.[0]?.evidenceRefs).toEqual(segmentRefs);

    // 单阶段查询没有请求内 grant 映射，因此不披露任何定位引用。
    const closed = await projection.query(request);
    expect(closed.kind).toBe("succeeded");
    if (closed.kind !== "succeeded") return;
    expect(closed.result.qualitySummaries?.[0]?.evidenceRefs).toEqual([]);

    // 无映射时只删除定位引用，工程级摘要与分页形状不变。
    const unmapped = await projection.queryWithSourceGrants(
      request,
      new Map<string, readonly SourceAccessGrantRefV1[]>(),
      candidates,
    );
    expect(unmapped.kind).toBe("succeeded");
    if (unmapped.kind !== "succeeded") return;
    expect(
      unmapped.result.qualitySummaries?.every((summary) => summary.evidenceRefs.length === 0),
    ).toBe(true);
    expect(unmapped.result.qualitySummaries?.length).toBe(closed.result.qualitySummaries?.length);

    // 撤权后当前会话签不出该版本的 grant，定位引用不再披露。
    const administratorAccount = await fixture!.postgres.adminPool.query<{ account_id: string }>(
      "SELECT account_id FROM business.local_accounts WHERE login_name = $1",
      [TEST_ADMIN_LOGIN],
    );
    const otherAccountId = administratorAccount.rows[0]!.account_id;
    await reviseSourceAccess({
      commandId: "c36-grant-source-access-revoked",
      visibility: "restricted",
      allowedAccountIds: [otherAccountId],
      registeredByAccountId: otherAccountId,
    });
    const revokedContext = await authorizeFor({
      world,
      projectId: GRANT_PROJECT_ID,
      branch: "projection.query",
      invocationId: "c36-grant-sign-revoked",
      sourceVersionRefs: [source.sourceVersionRef],
    });
    expect(revokedContext.sourceAccessGrantRefs).toEqual([]);
    const revoked = await projection.queryWithSourceGrants(
      request,
      new Map([[candidates.versions[0]!.versionKey, revokedContext.sourceAccessGrantRefs]]),
      candidates,
    );
    expect(revoked.kind).toBe("succeeded");
    if (revoked.kind !== "succeeded") return;
    expect(revoked.result.qualitySummaries?.[0]?.evidenceRefs).toEqual([]);

    // 同键重放不追加业务事实。
    const counts = await fixture!.postgres.adminPool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM ${TABLE} WHERE project_id = $1`,
      [GRANT_PROJECT_ID],
    );
    const replayed = await projection.queryWithSourceGrants(request, grants, candidates);
    const countsAfter = await fixture!.postgres.adminPool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM ${TABLE} WHERE project_id = $1`,
      [GRANT_PROJECT_ID],
    );
    expect(replayed.kind).toBe("succeeded");
    expect(countsAfter.rows[0]?.total).toBe(counts.rows[0]?.total);

    const appended = await evaluationService().evaluateDataset({
      projectId: GRANT_PROJECT_ID,
      actorId: world.accountId,
      commandId: "c36-grant-evaluate-command-after-selection",
      idempotencyKey: "c36-grant-evaluate-command-after-selection",
      requestedAt: QUALITY_FIXTURE_TIME,
      datasetArtifactRef,
      runRefs: [],
      authorization: evaluationAuthorization,
      requiredEvidenceAccess: evidenceIssuerFor(world, GRANT_PROJECT_ID),
      runEvidence: {
        commands: [
          "pnpm exec vitest run packages/adapters/test/quality/postgres-quality-evaluation.test.ts",
        ],
        codeHead: "c36-grant-mapping",
        environment: { nodeVersion: process.version },
      },
    });
    expect(appended.kind).toBe("succeeded");
    const changedPage = await projection.queryWithSourceGrants(request, grants, candidates);
    expect(changedPage.kind).toBe("failed");
  }, 600_000);
});
