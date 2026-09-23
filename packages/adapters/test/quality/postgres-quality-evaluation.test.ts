/** 合成样本、待甲方复核：本文件所有工程、身份、摘要与工件正文均为合成夹具。 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ArtifactPutCommandV1Schema, type ArtifactStoreV1 } from "@riskflow/core/artifacts";
import { createQualityEvaluationService } from "@riskflow/core/quality";
import { AtomicCommandV1Schema, sha256CanonicalJson } from "@riskflow/core/persistence";
import {
  bootstrapInitialSystemAdministrator,
  createPostgresLocalIdentityAccess,
} from "../../src/auth/index.js";
import type { AuthorizationContextV1, ContentArtifactRefV1, WorkflowRunRefV1 } from "@riskflow/contracts/ports";

import { createFilesystemArtifactStore } from "../../src/artifacts/filesystem-artifact-store.js";
import { PostgresArtifactRegistry } from "../../src/artifacts/postgres-artifact-registry.js";
import { PostgresRiskCandidateFinalizationAdapter } from "../../src/identification/candidate-finalization/postgres-risk-candidate-adapter.js";
import { runPostgresMigrations } from "../../src/postgres/migrations/run.js";
import { createPostgresRuntime, type PostgresRuntime } from "../../src/postgres/pool.js";
import { PostgresTransactionUnit } from "../../src/postgres/transaction-unit.js";
import * as qualityIndexMigration from "../../src/postgres/migrations/query-projection/deliver-quality-evaluation-module/000049_quality_evaluation_report_index.js";
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
    return {
      postgres,
      runtime,
      migratorRuntime,
      transactionUnit,
      artifactStore,
      artifactRegistry: registry,
      artifactRootDirectory: rootDirectory,
      appPool,
      async close() {
        await appPool.close().catch(() => undefined);
        await artifactStore.close().catch(() => undefined);
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

describe("C36 migration 000049", () => {
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
        runRefs: [{ kind: "workflow-run" as const, reference: { entityId: "quality-run-b", versionId: "1" } }],
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
    const datasetRef = await Promise.all([
      datasetBody("2030-06-05.1"),
      datasetBody("2030-06-05.1", seededSamples.slice(0, 3)),
    ].map(async (body) => ({
      kind: "content-artifact" as const,
      reference: await putJson({
        artifactId,
        purposeCode: DATASET_PURPOSE_CODE,
        mediaType: DATASET_MEDIA_TYPE,
        value: { ...body, datasetId: "c36-concurrent-conflict" },
      }),
    })));
    expect(datasetRef[0]!.reference.versionId).not.toBe(datasetRef[1]!.reference.versionId);
    const results = await Promise.all(datasetRef.map((ref, index) => evaluate({
      commandId: `quality-concurrent-conflict-${index}`,
      datasetRef: ref,
    })));
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
    const codes = [absent, cursor, malformed, crossProject, crossSpace, unauthorized].map((outcome) =>
      outcome.kind === "failed" ? outcome.error.code : "succeeded",
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
    expect(listed.result.qualitySummaries?.every((summary) => summary.evidenceRefs.length === 0)).toBe(true);
  }, 300_000);
});

describe("C36 数据集计算 CLI", () => {
  const CLI_PROJECT_ID = "quality-cli-project";
  const CLI_OPERATOR = "quality-cli-operator";
  const CLI_ADMIN_PASSWORD = "Riskflow-Cli-Admin-2030!";
  const CLI_OPERATOR_PASSWORD = "Riskflow-Cli-Operator-2030!";
  const CLI_OPERATOR_PASSWORD_CHANGED = "Riskflow-Cli-Operator-2030-Changed!";
  const CLI_HMAC_KEY = Buffer.alloc(32, 11);

  it("冻结数据集、写 C04 报告并按实际命令输出安全引用", async () => {
    const migrator = fixture!.postgres.migrator;
    await bootstrapInitialSystemAdministrator({
      connection: migrator,
      loginName: "cli-admin",
      displayName: "CLI administrator",
      password: CLI_ADMIN_PASSWORD,
    });
    const access = createPostgresLocalIdentityAccess({
      ...fixture!.postgres.app,
      hmacKey: CLI_HMAC_KEY,
      keyVersion: "key-v1",
    });
    let cliSpatialScopeRef = AUTHORIZATION_FIXTURE.spatialScopeRefs[0]!;
    try {
      const adminLogin = await access.login({
        kind: "login",
        loginAttemptId: "cli-admin-login",
        loginName: "cli-admin",
        password: CLI_ADMIN_PASSWORD,
      });
      const adminSession = await access.changePassword({
        kind: "change-password",
        sessionToken: adminLogin.sessionToken,
        newPassword: "Riskflow-Cli-Admin-2030-Changed!",
      });
      const operator = await access.administerIdentity({
        kind: "create-account",
        commandId: "cli-create-operator",
        idempotencyKey: "cli-create-operator",
        expectedVersion: "none",
        authorizationContextRef: adminSession.systemAdministrationContextRef,
        loginName: CLI_OPERATOR,
        displayName: "CLI 操作员",
        password: CLI_OPERATOR_PASSWORD,
      });
      await access.administerProject({
        kind: "open-project",
        projectId: CLI_PROJECT_ID,
        commandId: "cli-open-project",
        idempotencyKey: "cli-open-project",
        expectedVersion: "none",
        authorizationContextRef: adminSession.systemAdministrationContextRef,
        initialRiskManagerAccountId: operator.resultRef.entityId,
        includeAdministrator: true,
      });
      const operatorLogin = await access.login({
        kind: "login",
        loginAttemptId: "cli-operator-login",
        loginName: CLI_OPERATOR,
        password: CLI_OPERATOR_PASSWORD,
      });
      const operatorSession = await access.changePassword({
        kind: "change-password",
        sessionToken: operatorLogin.sessionToken,
        newPassword: CLI_OPERATOR_PASSWORD_CHANGED,
      });
      const decision = await access.authorize({
        invocation: { kind: "human-session", sessionToken: operatorSession.sessionToken },
        invocationId: "cli-scope-authorize",
        projectId: CLI_PROJECT_ID,
        branch: "projection.export",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      });
      cliSpatialScopeRef = decision.context.spatialScopeRefs[0]!;
    } finally {
      await access.close().catch(() => undefined);
    }

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
