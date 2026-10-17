/**
 * 合成样本、待甲方复核：本文件全部工程、参与者、命令身份、摘要与工件正文均为合成夹具，
 * 不代表生产数据，也不得作为生产回退来源。
 *
 * C35 报告导出行为验证（IP-05）：真实 Testcontainers PostgreSQL + 完整生产迁移链 +
 * 真实 C03 事务单元 / C04 文件系统工件存储 / C31 投影分页；只有 C05 授权复验与 C22 公开批读
 * 按既有投影测试口径用可控替身注入。故障注入作用在真实收据与真实工件写入上。
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessServiceError, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import type { TransactionUnitV1 } from "@riskflow/core/persistence";
import {
  AuthorizationContextV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type ExportArtifactRefV1,
  type ModuleBranchV1,
  type ProjectionExportRequestV1,
  type ProjectionExportResultV1,
  type QueryResultRefV1,
  type RiskRecordTraceReadResultV1,
} from "@riskflow/contracts/ports";
import { ProjectionReportReadResultV1Schema } from "@riskflow/core/workflow";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";
import type { WorkflowGraphResultRowV1, WorkflowSkippedTailV1 } from "@riskflow/core/workflow";

import { createFilesystemArtifactStore } from "../../src/artifacts/filesystem-artifact-store.js";
import { PostgresArtifactRegistry } from "../../src/artifacts/postgres-artifact-registry.js";
import { runPostgresMigrations } from "../../src/postgres/migrations/run.js";
import { createPostgresRuntime, type PostgresRuntime } from "../../src/postgres/pool.js";
import { PostgresTransactionUnit } from "../../src/postgres/transaction-unit.js";
import {
  createPostgresReportExport,
  createPostgresWorkflowAdapter,
  createPostgresWorkflowProjection,
  type PostgresWorkflowAdapterV1,
  type PostgresWorkflowProjectionOptionsV1,
} from "../../src/workflow/index.js";
import { artifactPolicy } from "../artifacts/fixture.js";
import { startPostgresFixture, type PostgresTestFixture } from "../postgres/fixture.js";

const PROJECT_ID = "project-c35-report";
const ACTOR_ID = "actor-c35-report";
const TIMESTAMP = "2032-04-01T00:00:00.000Z";
const sha = (seed: string): string => createHash("sha256").update(seed).digest("hex");

const SPATIAL_SCOPE_REF = {
  kind: "spatial-scope" as const,
  reference: { entityId: "scope-c35-report", versionId: "v1" },
};
const PROJECT_REVISION_REF: ContractReferenceV1 = {
  kind: "project-revision",
  reference: { entityId: "project-revision-c35", versionId: "v1" },
};
const POLICY_REF = { entityId: "report-export-policy", versionId: "v1" } as const;

const basePolicy = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  policyRef: POLICY_REF,
  format: "json",
  queryTypes: ["risk-overview"],
  sections: ["run-summary", "report-fact", "report-absence"],
  maxPages: 20,
  maxItems: 1000,
  maxBytes: 1024 * 1024,
  ...overrides,
});

/** 同一空间与策略，能力随分支变化：与 C06 `verify` 的 branch 绑定语义一致。 */
const authorizationFor = (branch: ModuleBranchV1): AuthorizationContextV1 =>
  AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: {
      kind: "authorization-context",
      reference: {
        entityId: `authorization-c35-report:${branch}`,
        versionId: "v1",
      },
    },
    actorId: ACTOR_ID,
    projectId: PROJECT_ID,
    grantedCapabilities: [MODULE_BRANCH_CAPABILITY_V1[branch]],
    spatialScopeRefs: [SPATIAL_SCOPE_REF],
    sourceAccessGrantRefs: [],
    authorizationPolicyRef: { entityId: "authorization-policy", versionId: "v1" },
    decidedAt: TIMESTAMP,
    invocation: { kind: "human" },
  });

const QUERY_AUTHORIZATION = authorizationFor("projection.query");
const EXPORT_AUTHORIZATION = authorizationFor("projection.export");
const SCOPE_DIGEST = authorizationScopeDigest(EXPORT_AUTHORIZATION);

const createAccess = () => {
  let revoked = false;
  const denied = (branch: ModuleBranchV1) =>
    new AccessServiceError({
      code: "AUTHORIZATION_DENIED",
      retryable: false,
      stage: "c35-report-test-verify",
      occurredAt: TIMESTAMP,
      diagnosticRef: {
        kind: "diagnostic-artifact",
        reference: { entityId: "access-diagnostic", versionId: "1" },
      },
      contextRefs: [],
      requiredCapability: MODULE_BRANCH_CAPABILITY_V1[branch],
      authorizationPolicyRef: { entityId: "authorization-policy", versionId: "v1" },
    });
  return {
    port: {
      verify: async (input: { readonly branch: ModuleBranchV1 }) => {
        if (revoked) throw denied(input.branch);
        return {
          context: authorizationFor(input.branch),
        } as Awaited<ReturnType<LocalIdentityAccessV1["verify"]>>;
      },
      // 正文读取前的配对重签发：与 C06 真实行为一致，按 branch 签发单一能力上下文。
      authorize: async (input: { readonly branch: ModuleBranchV1 }) => {
        if (revoked) throw denied(input.branch);
        const context = authorizationFor(input.branch);
        return {
          context,
          contextRef: context.authorizationContextRef,
          redacted: false,
        } as Awaited<ReturnType<LocalIdentityAccessV1["authorize"]>>;
      },
    } satisfies Pick<LocalIdentityAccessV1, "verify" | "authorize">,
    revoke: () => {
      revoked = true;
    },
    restore: () => {
      revoked = false;
    },
  };
};

interface ReportFixture {
  readonly postgres: PostgresTestFixture;
  readonly runtime: PostgresRuntime;
  readonly transactionUnit: PostgresTransactionUnit;
  readonly workflow: PostgresWorkflowAdapterV1;
  readonly artifactStore: ArtifactStoreV1 & { close(): Promise<void> };
  readonly access: ReturnType<typeof createAccess>;
  /** 真实 C04 put 之后的钩子：用于在 put 与尾事务之间撤销权限。 */
  readonly afterPut: { run: (() => void) | undefined };
  readonly rootDirectory: string;
  close(): Promise<void>;
}

const startFixture = async (): Promise<ReportFixture> => {
  const postgres = await startPostgresFixture();
  try {
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
      additionalMigrationRoots: [postgres.fixtureMigrationRoot],
    });
    const rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c35-report-"));
    const runtime = createPostgresRuntime(postgres.app, "riskflow_app");
    const transactionUnit = new PostgresTransactionUnit(runtime.db);
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
    const access = createAccess();
    const workflow = createPostgresWorkflowAdapter({
      db: runtime.db,
      transactionUnit,
      artifactStore,
      authorization: access.port,
      now: () => new Date(TIMESTAMP),
    });
    return {
      postgres,
      runtime,
      transactionUnit,
      workflow,
      artifactStore,
      access,
      afterPut: { run: undefined },
      rootDirectory,
      async close() {
        await artifactStore.close().catch(() => undefined);
        await runtime.close().catch(() => undefined);
        await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
        await postgres.close().catch(() => undefined);
      },
    };
  } catch (error) {
    await postgres.close().catch(() => undefined);
    throw error;
  }
};

let fixture: ReportFixture;

beforeAll(async () => {
  fixture = await startFixture();
}, 240_000);

afterAll(async () => {
  await fixture?.close();
});

const rowBase = (runId: string, runVersionId: string, suffix: string) => ({
  schemaVersion: "1" as const,
  projectId: PROJECT_ID,
  resultId: `${runId}:${suffix}`,
  resultVersionId: sha(`${runId}:${suffix}`),
  runId,
  runVersionId,
  entryMode: "identify-and-assess" as const,
  commandId: `c35-report-${runId}-${suffix}`,
  idempotencyKey: `c35-report-${runId}-${suffix}`,
  requestDigest: sha(`c35-report-request-${runId}-${suffix}`),
  actorRef: ACTOR_ID,
  authorizationContextRef: QUERY_AUTHORIZATION.authorizationContextRef,
  authorizationScopeDigest: SCOPE_DIGEST,
  validAt: TIMESTAMP,
  recordedAt: TIMESTAMP,
  persistedAt: TIMESTAMP,
  auditEntryId: `c35-report-${runId}-${suffix}:audit`,
  frozenRefs: [PROJECT_REVISION_REF, SPATIAL_SCOPE_REF],
});

/** 在真实 C03 事务内登记一行与其审计：投影只读已成立事实。 */
const register = async (row: WorkflowGraphResultRowV1) => {
  const commandId = row.commandId;
  const commandKind = "workflow.register-row";
  await fixture.transactionUnit.execute(
    {
      projectId: row.projectId,
      commandKind,
      commandId,
      idempotencyKey: row.idempotencyKey,
      payload: { resultId: row.resultId },
      actorRef: row.actorRef,
      authorizationContextRef: row.authorizationContextRef,
      issuedAt: row.recordedAt,
      runId: row.runId,
    },
    async (context) => {
      await fixture.workflow.registrationStore.registerRow(
        { row, occurredAt: row.recordedAt },
        context,
      );
      return {
        resultRef: {
          kind: "workflow-run" as const,
          reference: { entityId: row.runId, versionId: row.runVersionId },
        },
        audit: {
          auditEntryId: row.auditEntryId,
          projectId: row.projectId,
          action: commandKind,
          targetRef: {
            kind: "workflow-run" as const,
            reference: { entityId: row.runId, versionId: row.runVersionId },
          },
          actorRef: row.actorRef,
          authorizationContextRef: row.authorizationContextRef,
          occurredAt: row.recordedAt,
          recordedAt: row.recordedAt,
          version: { entityId: row.runId, versionId: row.runVersionId },
          commandId,
          idempotencyKey: row.idempotencyKey,
          runId: row.runId,
        },
        events: [],
      };
    },
  );
};

/**
 * C31 合成报告运行：入口行 + 最新状态正文 + 结果正文。事实引用与缺席原因都只登记已成立项，
 * 缺席项由结果正文的 `skippedTails` 承载，因此导出正文必须原样保留它们。
 */
const seedOverviewRun = async (seed: {
  readonly runId: string;
  readonly runVersionId: string;
  readonly suffix: string;
}) => {
  const runId = seed.runId;
  const runVersionId = seed.runVersionId;
  const riskRecordRef: ContractReferenceV1 = {
    kind: "standardized-risk-record",
    reference: { entityId: `risk-record-${seed.suffix}`, versionId: "v1" },
  };
  const assessmentRecordRef: ContractReferenceV1 = {
    kind: "risk-assessment-record",
    reference: { entityId: `assessment-record-${seed.suffix}`, versionId: "v1" },
  };
  const skippedTails: readonly WorkflowSkippedTailV1[] = [
    { tailKind: "warning", reasonCode: "warning-not-triggered" },
  ];
  const stateArtifactRef = await fixture.workflow.bodies.putBody({
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    commandId: `c35-report-state-${seed.suffix}`,
    invocationId: `c35-report-state-${seed.suffix}`,
    issuedAt: TIMESTAMP,
    artifactId: `c35-run-state:${runId}:${runVersionId}`,
    body: {
      bodyKind: "run-state",
      runState: {
        schemaVersion: "1",
        projectId: PROJECT_ID,
        runId,
        runVersionId,
        entryMode: "identify-and-assess",
        entryIdentity: {
          entityId: `workflow-entry:${PROJECT_ID}:identify-and-assess`,
          versionId: "entry-v1",
        },
        stage: "result-summary",
        status: "completed",
        assessmentRunRefs: [],
        acceptedRiskRecordRefs: [riskRecordRef],
        assessmentRecordRefs: [assessmentRecordRef],
        warningRecordRefs: [],
        responseRecommendationRefs: [],
        deviationRecordRefs: [],
        calibrationSuggestionRefs: [],
        recordedAt: TIMESTAMP,
      },
    },
    authorization: QUERY_AUTHORIZATION,
  });
  const resultArtifactRef = await fixture.workflow.bodies.putBody({
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    commandId: `c35-report-result-${seed.suffix}`,
    invocationId: `c35-report-result-${seed.suffix}`,
    issuedAt: TIMESTAMP,
    artifactId: `c35-run-result:${runId}:${runVersionId}`,
    body: {
      bodyKind: "run-result",
      runResult: {
        schemaVersion: "1",
        projectId: PROJECT_ID,
        runRef: {
          kind: "workflow-run",
          reference: { entityId: runId, versionId: runVersionId },
        },
        entryMode: "identify-and-assess",
        stage: "result-summary",
        assessmentRunRefs: [],
        assessmentRecordRefs: [assessmentRecordRef],
        warningRecordRefs: [],
        responseRecommendationRefs: [],
        deviationRecordRefs: [],
        calibrationSuggestionRefs: [],
        skippedTails: [...skippedTails],
        auditTrailRef: {
          kind: "audit-trail",
          reference: { entityId: `c35-report-${seed.suffix}:result-audit`, versionId: "1" },
        },
        recordedAt: TIMESTAMP,
      },
    },
    authorization: QUERY_AUTHORIZATION,
  });
  const rows: WorkflowGraphResultRowV1[] = [
    {
      ...rowBase(runId, runVersionId, `${seed.suffix}-entry`),
      resultKind: "entry-snapshot",
      stage: "preparing",
      entryIdentity: {
        entityId: `workflow-entry:${PROJECT_ID}:identify-and-assess`,
        versionId: "entry-v1",
      },
    },
    {
      ...rowBase(runId, runVersionId, `${seed.suffix}-state`),
      resultKind: "run-state",
      resultVersionId: runVersionId,
      stage: "result-summary",
      artifactRef: stateArtifactRef,
    },
    {
      ...rowBase(runId, runVersionId, `${seed.suffix}-result`),
      resultKind: "run-result",
      stage: "result-summary",
      runResultRef: {
        kind: "risk-flow-run-result",
        reference: { entityId: `${runId}:result`, versionId: "v1" },
      },
      artifactRef: resultArtifactRef,
    },
  ];
  for (const row of rows) await register(row);
};

const riskRecordTrace = {
  readBatch: async (input: {
    readonly riskRecordRefs: readonly ContractReferenceV1[];
  }): Promise<RiskRecordTraceReadResultV1> =>
    ({
      kind: "succeeded",
      items: input.riskRecordRefs.map((riskRecordRef) => ({
        kind: "found" as const,
        riskRecordRef: riskRecordRef as never,
        processNodeId: "process-node-c35",
        sourceSegmentIds: ["segment-c35"],
        riskMechanismEntryIds: ["mechanism-c35"],
        evidenceLocator: { sourceSegmentId: "segment-c35" },
        auditTrailRef: {
          kind: "audit-trail" as const,
          reference: { entityId: "audit-risk-record-c35", versionId: "1" },
        },
      })),
    }) as RiskRecordTraceReadResultV1,
};

/** 组合根装配：同一 C31 reader、真实 C03/C04 与按分支配对的 C05 签发方。 */
const compose = (
  overrides: {
    readonly policies?: readonly unknown[];
    readonly transactionUnit?: TransactionUnitV1;
    readonly artifactStore?: ArtifactStoreV1;
  } = {},
) => {
  const projectionOptions: PostgresWorkflowProjectionOptionsV1 = {
    db: fixture.runtime.db,
    registrationStore: fixture.workflow.registrationStore,
    bodies: fixture.workflow.bodies,
    authorization: fixture.access.port,
    riskRecordTrace,
    now: () => new Date(TIMESTAMP),
  };
  const reader = createPostgresWorkflowProjection(projectionOptions);
  const report = createPostgresReportExport({
    db: fixture.runtime.db,
    transactionUnit: overrides.transactionUnit ?? fixture.transactionUnit,
    artifactStore: overrides.artifactStore ?? fixture.artifactStore,
    registrationStore: fixture.workflow.registrationStore,
    resultRead: reader.resultRead,
    authorization: fixture.access.port,
    // C06 无法把 `projection.export` 上下文收窄成 `projection.query`，配对签发由组合根注入。
    resultReadAuthorization: {
      issueResultReadAuthorization: async () => authorizationFor("projection.result-read"),
    },
    ...(overrides.policies === undefined ? {} : { exportPolicies: overrides.policies }),
    now: () => new Date(TIMESTAMP),
  });
  const projection = createPostgresWorkflowProjection({
    ...projectionOptions,
    reportExport: { exportReport: report.exportReport },
  });
  return { projection, report };
};

const registerOverviewQuery = async (queryId: string): Promise<QueryResultRefV1> => {
  const result = await compose().projection.queryProjection.query({
    queryId,
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    requestedAt: TIMESTAMP,
    authorization: QUERY_AUTHORIZATION,
    kind: "query",
    payload: {
      queryType: "risk-overview",
      projectRevisionRef: PROJECT_REVISION_REF,
      spatialScopeRef: SPATIAL_SCOPE_REF,
    },
  } as never);
  if (result.kind !== "succeeded") {
    throw new Error(`risk-overview 登记失败：${result.error.stageCode}`);
  }
  return result.result.queryResultRef;
};

const exportRequest = (
  queryId: string,
  sourceRef: QueryResultRefV1,
  policyRef: { entityId: string; versionId: string } = POLICY_REF,
): ProjectionExportRequestV1 =>
  ({
    queryId,
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    requestedAt: TIMESTAMP,
    authorization: EXPORT_AUTHORIZATION,
    kind: "export",
    payload: { sourceRef, exportPolicyRef: policyRef },
  }) as ProjectionExportRequestV1;

const readQuery = (
  kind: "policies" | "preview" | "artifact" | "history",
  queryId: string,
  payload: Record<string, unknown>,
) =>
  ({
    queryId,
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    requestedAt: TIMESTAMP,
    authorization: EXPORT_AUTHORIZATION,
    kind,
    payload,
  }) as never;

/** 两段事务都以原 queryId 作幂等键，因此按它就能定位该次导出的唯一收据与审计。 */
const generatedAuditCount = async (queryId: string): Promise<number> => {
  const rows = await fixture.runtime.db
    .selectFrom("audit.entries")
    .select("audit_entry_id")
    .where("project_id", "=", PROJECT_ID)
    .where("action", "=", "projection.export.generated")
    .where("idempotency_key", "=", queryId)
    .execute();
  return rows.length;
};

const completedReceiptCount = async (queryId: string): Promise<number> => {
  const rows = await fixture.runtime.db
    .selectFrom("business.command_receipts")
    .select("command_id")
    .where("project_id", "=", PROJECT_ID)
    .where("command_kind", "=", "projection.export.completed")
    .where("idempotency_key", "=", queryId)
    .execute();
  return rows.length;
};

const expectSucceededArtifactRef = (result: ProjectionExportResultV1): ExportArtifactRefV1 => {
  expect(
    result.kind,
    result.kind === "failed"
      ? `${result.error.code}/${result.error.stageCode}/${
          "blockerKind" in result.error ? result.error.blockerKind : "-"
        }`
      : "",
  ).toBe("succeeded");
  if (result.kind !== "succeeded") throw new Error("导出未成功");
  expect(result.result.exportArtifactRef.kind).toBe("export-artifact");
  return result.result.exportArtifactRef;
};

describe("C35 报告导出适配器", () => {
  it("沿 C31 登记范围生成真实 JSON 工件，并在收窄读取后按原引用重建同一报告", async () => {
    await seedOverviewRun({
      runId: `risk-flow-run:${PROJECT_ID}:a`,
      runVersionId: sha("run-a"),
      suffix: "a",
    });
    const sourceRef = await registerOverviewQuery(`query-report-basic-${"source".repeat(40)}`);
    const { projection, report } = compose({ policies: [basePolicy()] });

    const exported = await projection.queryProjection.export(
      exportRequest("export-basic", sourceRef),
    );
    const exportArtifactRef = expectSucceededArtifactRef(exported);
    // export 引用与 C04 内容工件一一绑定，不存在第二种可猜测的工件映射。
    expect(exportArtifactRef.reference.versionId.startsWith("sha256:")).toBe(true);
    expect(await generatedAuditCount("export-basic")).toBe(1);
    expect(await completedReceiptCount("export-basic")).toBe(1);

    const preview = await report.reportRead.read(
      readQuery("preview", "preview-basic", {
        queryResultRef: sourceRef,
        exportPolicyRef: POLICY_REF,
      }),
    );
    expect(ProjectionReportReadResultV1Schema.safeParse(preview).success).toBe(true);
    expect(preview.kind).toBe("succeeded");
    if (preview.kind !== "succeeded" || preview.result.kind !== "preview") {
      throw new Error("预览未成功");
    }
    expect(preview.result.sourceRef).toEqual(sourceRef);
    expect(preview.result.scope.projectRevisionRef).toEqual(PROJECT_REVISION_REF);
    expect(preview.result.scope.asOfRecordedAt).toBe(TIMESTAMP);
    expect(preview.result.items.length).toBeGreaterThan(0);

    const firstPage = await projection.resultRead.readPage({
      projectId: PROJECT_ID,
      queryResultRef: sourceRef,
      requestedAt: TIMESTAMP,
      queryId: "long-cursor-first",
      limit: 1,
      authorization: authorizationFor("projection.result-read"),
    });
    if (firstPage.kind !== "page" || firstPage.nextCursor === undefined)
      throw new Error("expected a bounded first page");
    expect(firstPage.nextCursor.length).toBeGreaterThan(512);
    expect(
      ProjectionReportReadResultV1Schema.safeParse({
        ...preview,
        result: { ...preview.result, nextCursor: firstPage.nextCursor },
      }).success,
    ).toBe(true);
    const nextPage = await projection.resultRead.readPage({
      projectId: PROJECT_ID,
      queryResultRef: sourceRef,
      requestedAt: TIMESTAMP,
      queryId: "long-cursor-next",
      limit: 100,
      cursor: firstPage.nextCursor,
      authorization: authorizationFor("projection.result-read"),
    });
    expect(nextPage.kind).toBe("page");

    const artifact = await report.reportRead.read(
      readQuery("artifact", "artifact-basic", { exportArtifactRef }),
    );
    expect(ProjectionReportReadResultV1Schema.safeParse(artifact).success).toBe(true);
    expect(artifact.kind, artifact.kind === "failed" ? `${artifact.error.stageCode}` : "").toBe(
      "succeeded",
    );
    if (artifact.kind !== "succeeded" || artifact.result.kind !== "artifact") {
      throw new Error("工件读取未成功");
    }
    expect(artifact.result.fileName).toMatch(/^[A-Za-z0-9._-]{1,128}$/u);
    expect(artifact.result.byteLength).toBeGreaterThan(0);
    expect(artifact.result.body.bodyKind).toBe("riskflow-report");
    expect(artifact.result.body.queryResultRef).toEqual(sourceRef);
    expect(artifact.result.body.exportPolicyRef).toEqual(POLICY_REF);
    // 缺席项必须原样保留，不能只交付已成立事实。
    expect(artifact.result.body.items.some((item) => item.kind === "report-absence")).toBe(true);

    const history = await report.reportRead.read(
      readQuery("history", "history-basic", { pageSize: 50 }),
    );
    expect(ProjectionReportReadResultV1Schema.safeParse(history).success).toBe(true);
    expect(history.kind).toBe("succeeded");
    if (history.kind !== "succeeded" || history.result.kind !== "history") {
      throw new Error("历史读取未成功");
    }
    expect(history.result.items).toHaveLength(1);
    expect(history.result.items[0]?.sourceRef).toEqual(sourceRef);
    expect(history.result.items[0]?.exportPolicyRef).toEqual(POLICY_REF);
  });

  it("同源同策略重放返回同一引用，且不产生第二份逻辑报告或重复审计", async () => {
    await seedOverviewRun({
      runId: `risk-flow-run:${PROJECT_ID}:replay`,
      runVersionId: sha("run-replay"),
      suffix: "replay",
    });
    const sourceRef = await registerOverviewQuery("query-report-replay");
    const { projection } = compose({ policies: [basePolicy()] });

    const first = expectSucceededArtifactRef(
      await projection.queryProjection.export(exportRequest("export-replay", sourceRef)),
    );
    const second = expectSucceededArtifactRef(
      await projection.queryProjection.export(exportRequest("export-replay", sourceRef)),
    );
    expect(second).toEqual(first);
    expect(await generatedAuditCount("export-replay")).toBe(1);
    expect(await completedReceiptCount("export-replay")).toBe(1);
  });

  it("并发重放同一导出身份时不重复写收据、审计与工件", async () => {
    await seedOverviewRun({
      runId: `risk-flow-run:${PROJECT_ID}:concurrent`,
      runVersionId: sha("run-concurrent"),
      suffix: "concurrent",
    });
    const sourceRef = await registerOverviewQuery("query-report-concurrent");
    const { projection } = compose({ policies: [basePolicy()] });
    const request = exportRequest("export-concurrent", sourceRef);

    const [left, right] = await Promise.all([
      projection.queryProjection.export(request),
      projection.queryProjection.export(request),
    ]);
    expect(expectSucceededArtifactRef(left)).toEqual(expectSucceededArtifactRef(right));
    expect(await generatedAuditCount("export-concurrent")).toBe(1);
    expect(await completedReceiptCount("export-concurrent")).toBe(1);
  });

  it("C04 工件失败不发布成功引用，原身份重试后生成同一工件", async () => {
    await seedOverviewRun({
      runId: `risk-flow-run:${PROJECT_ID}:artifact-fail`,
      runVersionId: sha("run-artifact-fail"),
      suffix: "artifact-fail",
    });
    const sourceRef = await registerOverviewQuery("query-report-artifact-fail");
    const failingStore: ArtifactStoreV1 = {
      put: async () => {
        throw new Error("injected-artifact-put-failure");
      },
      open: (request) => fixture.artifactStore.open(request),
    };
    const broken = compose({
      policies: [basePolicy()],
      artifactStore: failingStore,
    });
    const failed = await broken.projection.queryProjection.export(
      exportRequest("export-artifact-fail", sourceRef),
    );
    expect(failed.kind).toBe("failed");
    // 绑定成功不等于导出成功：没有 completed 收据，也没有 generated 审计。
    expect(await completedReceiptCount("export-artifact-fail")).toBe(0);
    expect(await generatedAuditCount("export-artifact-fail")).toBe(0);

    const healthy = compose({ policies: [basePolicy()] });
    const retried = expectSucceededArtifactRef(
      await healthy.projection.queryProjection.export(
        exportRequest("export-artifact-fail", sourceRef),
      ),
    );
    expect(await completedReceiptCount("export-artifact-fail")).toBe(1);
    expect(await generatedAuditCount("export-artifact-fail")).toBe(1);
    expect(retried.reference.versionId.startsWith("sha256:")).toBe(true);
  });

  it("尾事务审计失败不冒充成功，原身份重试后只留一份 generated 审计", async () => {
    await seedOverviewRun({
      runId: `risk-flow-run:${PROJECT_ID}:audit-fail`,
      runVersionId: sha("run-audit-fail"),
      suffix: "audit-fail",
    });
    const sourceRef = await registerOverviewQuery("query-report-audit-fail");
    const failingUnit: TransactionUnitV1 = {
      execute: async (command, handler, options) => {
        if (command.commandKind === "projection.export.completed") {
          throw new Error("injected-tail-transaction-failure");
        }
        return await fixture.transactionUnit.execute(command, handler, options);
      },
    };
    const broken = compose({
      policies: [basePolicy()],
      transactionUnit: failingUnit,
    });
    const failed = await broken.projection.queryProjection.export(
      exportRequest("export-audit-fail", sourceRef),
    );
    expect(failed.kind).toBe("failed");
    expect(await completedReceiptCount("export-audit-fail")).toBe(0);
    expect(await generatedAuditCount("export-audit-fail")).toBe(0);

    const healthy = compose({ policies: [basePolicy()] });
    expectSucceededArtifactRef(
      await healthy.projection.queryProjection.export(
        exportRequest("export-audit-fail", sourceRef),
      ),
    );
    expect(await completedReceiptCount("export-audit-fail")).toBe(1);
    expect(await generatedAuditCount("export-audit-fail")).toBe(1);
  });

  it("策略未注入或未登记查询不产生导出能力", async () => {
    const sourceRef = await registerOverviewQuery("query-report-no-policy");
    const withoutPolicy = compose();
    const missing = await withoutPolicy.projection.queryProjection.export(
      exportRequest("export-no-policy", sourceRef),
    );
    expect(missing.kind).toBe("failed");

    const policies = await withoutPolicy.report.reportRead.read(
      readQuery("policies", "policies-empty", {}),
    );
    expect(policies.kind).toBe("succeeded");
    if (policies.kind !== "succeeded" || policies.result.kind !== "policies") {
      throw new Error("策略读取未成功");
    }
    expect(policies.result.items).toHaveLength(0);

    const withPolicy = compose({ policies: [basePolicy()] });
    const unregistered = await withPolicy.projection.queryProjection.export(
      exportRequest("export-unregistered", {
        kind: "query-result",
        reference: { entityId: "query-result:not-registered", versionId: "v1" },
      }),
    );
    expect(unregistered.kind).toBe("failed");
    const unsupportedSource = await withPolicy.projection.queryProjection.export({
      ...exportRequest("export-unsupported-source", sourceRef),
      payload: {
        sourceRef: PROJECT_REVISION_REF,
        exportPolicyRef: POLICY_REF,
      },
    } as never);
    expect(unsupportedSource.kind).toBe("failed");
  });

  it("策略的页数、条目与字节上限是硬边界，超限不返回部分报告", async () => {
    await seedOverviewRun({
      runId: `risk-flow-run:${PROJECT_ID}:bound-a`,
      runVersionId: sha("run-bound-a"),
      suffix: "bound-a",
    });
    await seedOverviewRun({
      runId: `risk-flow-run:${PROJECT_ID}:bound-b`,
      runVersionId: sha("run-bound-b"),
      suffix: "bound-b",
    });
    const sourceRef = await registerOverviewQuery("query-report-bounds");

    const pages = compose({ policies: [basePolicy({ maxPages: 1 })] });
    expect(
      (await pages.projection.queryProjection.export(exportRequest("export-pages", sourceRef)))
        .kind,
    ).toBe("failed");

    const items = compose({ policies: [basePolicy({ maxItems: 1 })] });
    expect(
      (await items.projection.queryProjection.export(exportRequest("export-items", sourceRef)))
        .kind,
    ).toBe("failed");

    const bytes = compose({ policies: [basePolicy({ maxBytes: 1 })] });
    expect(
      (await bytes.projection.queryProjection.export(exportRequest("export-bytes", sourceRef)))
        .kind,
    ).toBe("failed");

    expect(await completedReceiptCount("export-pages")).toBe(0);
    expect(await generatedAuditCount("export-pages")).toBe(0);

    const healthy = compose({ policies: [basePolicy()] });
    expectSucceededArtifactRef(
      await healthy.projection.queryProjection.export(exportRequest("export-pages", sourceRef)),
    );
    expect(await completedReceiptCount("export-pages")).toBe(1);
  });

  it("绑定与尾之间撤销导出权限时按失败收口，撤权后读取也不放行", async () => {
    await seedOverviewRun({
      runId: `risk-flow-run:${PROJECT_ID}:revoked`,
      runVersionId: sha("run-revoked"),
      suffix: "revoked",
    });
    const sourceRef = await registerOverviewQuery("query-report-revoked");
    const revokingStore: ArtifactStoreV1 = {
      put: async (command, content) => {
        const result = await fixture.artifactStore.put(command, content);
        fixture.access.revoke();
        return result;
      },
      open: (request) => fixture.artifactStore.open(request),
    };
    const revoking = compose({
      policies: [basePolicy()],
      artifactStore: revokingStore,
    });
    const revoked = await revoking.projection.queryProjection.export(
      exportRequest("export-revoked", sourceRef),
    );
    expect(revoked.kind).toBe("failed");
    // C04 已耐久化但尾事务没有成功：不得留下 completed 收据与 generated 审计。
    expect(await completedReceiptCount("export-revoked")).toBe(0);
    expect(await generatedAuditCount("export-revoked")).toBe(0);

    fixture.access.restore();
    const healthy = compose({ policies: [basePolicy()] });
    const exportArtifactRef = expectSucceededArtifactRef(
      await healthy.projection.queryProjection.export(exportRequest("export-revoked", sourceRef)),
    );
    expect(await generatedAuditCount("export-revoked")).toBe(1);

    fixture.access.revoke();
    try {
      const denied = await healthy.report.reportRead.read(
        readQuery("artifact", "artifact-revoked", { exportArtifactRef }),
      );
      expect(denied.kind).toBe("failed");
    } finally {
      fixture.access.restore();
    }
  });

  it("未注册报告服务时该 export 分支按稳定不支持语义失败", async () => {
    const sourceRef = await registerOverviewQuery("query-report-no-service");
    const withoutService = createPostgresWorkflowProjection({
      db: fixture.runtime.db,
      registrationStore: fixture.workflow.registrationStore,
      bodies: fixture.workflow.bodies,
      authorization: fixture.access.port,
      riskRecordTrace,
      now: () => new Date(TIMESTAMP),
    });
    const result = await withoutService.queryProjection.export(
      exportRequest("export-no-service", sourceRef),
    );
    expect(result.kind).toBe("failed");
  });
});
