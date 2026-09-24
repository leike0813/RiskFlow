/**
 * 合成样本、待甲方复核：本文件全部工程、参与者、命令身份、摘要与工件正文均为合成夹具，
 * 不代表生产数据，也不得作为生产回退来源。
 *
 * C30 运行/追踪投影行为验证（IP-08）：真实 Testcontainers PostgreSQL + 完整生产迁移链 +
 * 真实 C03 事务单元 / C04 文件系统工件存储，只有 C05 授权复验与 C22 公开批读用可控替身注入。
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessServiceError, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  AuthorizationContextV1Schema,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type ModuleBranchV1,
  type ProjectionQueryResultV1,
  type ProjectionResultItemV1,
  type ProjectionResultReadRequestV1,
  type RiskAssessmentRecordRefV1,
  type RiskRecordTraceReadResultV1,
  type StandardizedRiskRecordRefV1,
} from "@riskflow/contracts/ports";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";
import type { WorkflowGraphResultRowV1, WorkflowSkippedTailV1 } from "@riskflow/core/workflow";

import { createFilesystemArtifactStore } from "../../src/artifacts/filesystem-artifact-store.js";
import { PostgresArtifactRegistry } from "../../src/artifacts/postgres-artifact-registry.js";
import { runPostgresMigrations } from "../../src/postgres/migrations/run.js";
import { createPostgresRuntime, type PostgresRuntime } from "../../src/postgres/pool.js";
import { PostgresTransactionUnit } from "../../src/postgres/transaction-unit.js";
import {
  createPostgresWorkflowAdapter,
  createPostgresWorkflowProjection,
  type PostgresWorkflowAdapterV1,
  type PostgresWorkflowProjectionV1,
} from "../../src/workflow/index.js";
import { artifactPolicy } from "../artifacts/fixture.js";
import { startPostgresFixture, type PostgresTestFixture } from "../postgres/fixture.js";

const PROJECT_ID = "project-c30-projection";
const OTHER_PROJECT_ID = "project-c30-other";
const ACTOR_ID = "actor-c30-projection";
const ROOT_RUN_ID = `risk-flow-run:${PROJECT_ID}`;
const CHILD_RUN_ID = `assessment-run:${PROJECT_ID}`;
const TIMESTAMP = "2030-03-01T00:00:00.000Z";
const sha = (seed: string): string => createHash("sha256").update(seed).digest("hex");
const ROOT_RUN_VERSION_ID = sha("root-run-version");
const CHILD_RUN_VERSION_ID = sha("child-run-version");
const RISK_RECORD_REF: ContractReferenceV1 = {
  kind: "standardized-risk-record",
  reference: { entityId: "risk-record-projection", versionId: "v1" },
};
const ASSESSMENT_RECORD_REF: ContractReferenceV1 = {
  kind: "risk-assessment-record",
  reference: { entityId: "assessment-record-projection", versionId: "v1" },
};
const SPATIAL_SCOPE_REF = {
  kind: "spatial-scope" as const,
  reference: { entityId: "scope-c30-projection", versionId: "v1" },
};

const authorizationFor = (projectId = PROJECT_ID): AuthorizationContextV1 =>
  AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: {
      kind: "authorization-context",
      reference: { entityId: "authorization-c30-projection", versionId: "v1" },
    },
    actorId: ACTOR_ID,
    projectId,
    grantedCapabilities: ["projection.query"],
    spatialScopeRefs: [SPATIAL_SCOPE_REF],
    sourceAccessGrantRefs: [],
    authorizationPolicyRef: { entityId: "authorization-policy", versionId: "v1" },
    decidedAt: TIMESTAMP,
    invocation: { kind: "human" },
  });

const AUTHORIZATION = authorizationFor();
const SCOPE_DIGEST = authorizationScopeDigest(AUTHORIZATION);

const createAccess = () => {
  const calls: { readonly invocationId: string; readonly branch: ModuleBranchV1 }[] = [];
  let revoked = false;
  return {
    calls,
    port: {
      verify: async (input: {
        readonly authorizationContextRef: { readonly kind: "authorization-context" };
        readonly invocationId: string;
        readonly branch: ModuleBranchV1;
      }) => {
        calls.push({ invocationId: input.invocationId, branch: input.branch });
        if (revoked) {
          throw new AccessServiceError({
            code: "AUTHORIZATION_DENIED",
            retryable: false,
            stage: "c30-projection-test-verify",
            occurredAt: TIMESTAMP,
            diagnosticRef: {
              kind: "diagnostic-artifact",
              reference: { entityId: "access-diagnostic", versionId: "1" },
            },
            contextRefs: [],
            requiredCapability: "projection.query",
            authorizationPolicyRef: { entityId: "authorization-policy", versionId: "v1" },
          });
        }
        return { context: AUTHORIZATION } as Awaited<ReturnType<LocalIdentityAccessV1["verify"]>>;
      },
    } satisfies Pick<LocalIdentityAccessV1, "verify">,
    revoke: () => {
      revoked = true;
    },
    restore: () => {
      revoked = false;
    },
  };
};

interface ProjectionTestFixture {
  readonly postgres: PostgresTestFixture;
  readonly runtime: PostgresRuntime;
  readonly transactionUnit: PostgresTransactionUnit;
  readonly workflow: PostgresWorkflowAdapterV1;
  readonly projection: PostgresWorkflowProjectionV1;
  readonly artifactStore: ArtifactStoreV1 & { close(): Promise<void> };
  readonly access: ReturnType<typeof createAccess>;
  readonly trace: {
    calls: number;
    /** 设定后覆盖逐引用合成的结果，用于不可证明与失败路径。 */
    override: RiskRecordTraceReadResultV1 | undefined;
  };
  readonly rootDirectory: string;
  close(): Promise<void>;
}

const startFixture = async (): Promise<ProjectionTestFixture> => {
  const postgres = await startPostgresFixture();
  try {
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
      additionalMigrationRoots: [postgres.fixtureMigrationRoot],
    });
    const rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c30-projection-"));
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
    const trace: ProjectionTestFixture["trace"] = { calls: 0, override: undefined };
    const projection = createPostgresWorkflowProjection({
      db: runtime.db,
      registrationStore: workflow.registrationStore,
      bodies: workflow.bodies,
      authorization: access.port,
      riskRecordTrace: {
        readBatch: async (input) => {
          trace.calls += 1;
          if (trace.override !== undefined) return trace.override;
          // 默认逐引用合成：只暴露已成立的最小来源定位，不携带任何风险正文。
          return {
            kind: "succeeded",
            items: input.riskRecordRefs.map((riskRecordRef) => ({
              kind: "found" as const,
              riskRecordRef,
              processNodeId: "process-node-1",
              sourceSegmentIds: ["segment-other", "segment-1"],
              riskMechanismEntryIds: ["mechanism-1"],
              evidenceLocator: { sourceSegmentId: "segment-1" },
              auditTrailRef: {
                kind: "audit-trail" as const,
                reference: { entityId: "audit-risk-record", versionId: "1" },
              },
            })),
          } as RiskRecordTraceReadResultV1;
        },
      },
      now: () => new Date(TIMESTAMP),
    });
    return {
      postgres,
      runtime,
      transactionUnit,
      workflow,
      projection,
      artifactStore,
      access,
      trace,
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

let fixture: ProjectionTestFixture;

beforeAll(async () => {
  fixture = await startFixture();
}, 180_000);

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
  commandId: `c30-projection-${runId}-${suffix}`,
  idempotencyKey: `c30-projection-${runId}-${suffix}`,
  requestDigest: sha(`request-${runId}-${suffix}`),
  actorRef: ACTOR_ID,
  authorizationContextRef: AUTHORIZATION.authorizationContextRef,
  authorizationScopeDigest: SCOPE_DIGEST,
  validAt: TIMESTAMP,
  recordedAt: TIMESTAMP,
  persistedAt: TIMESTAMP,
  auditEntryId: `c30-projection-${runId}-${suffix}:audit`,
  frozenRefs: [RISK_RECORD_REF],
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

const registerLink = async (input: {
  readonly linkId: string;
  readonly runId: string;
  readonly fromRef: ContractReferenceV1;
  readonly toRef: ContractReferenceV1;
  readonly relation: "risk-assessment" | "run-stage" | "parent-child";
  readonly stage: "A5" | "assessment" | "preparing";
  readonly evidenceLocator?: { readonly sourceSegmentId: string };
}) => {
  const commandId = `c30-projection-link-${input.linkId}`;
  await fixture.transactionUnit.execute(
    {
      projectId: PROJECT_ID,
      commandKind: "workflow.register-link",
      commandId,
      idempotencyKey: commandId,
      payload: { linkId: input.linkId },
      actorRef: ACTOR_ID,
      authorizationContextRef: AUTHORIZATION.authorizationContextRef,
      issuedAt: TIMESTAMP,
      runId: input.runId,
    },
    async (context) => {
      await fixture.workflow.registrationStore.registerLink(
        {
          link: {
            schemaVersion: "1",
            projectId: PROJECT_ID,
            linkId: input.linkId,
            runId: input.runId,
            fromRef: input.fromRef,
            toRef: input.toRef,
            relation: input.relation,
            sourceStage: input.stage,
            stageResultRef: {
              kind: "stage-result",
              reference: { entityId: `${input.linkId}:stage`, versionId: "v1" },
            },
            ...(input.evidenceLocator === undefined
              ? {}
              : { evidenceLocator: input.evidenceLocator }),
            authorizationContextRef: AUTHORIZATION.authorizationContextRef,
            authorizationScopeDigest: SCOPE_DIGEST,
            actorRef: ACTOR_ID,
            recordedAt: TIMESTAMP,
            auditEntryId: `${commandId}:audit`,
          },
        },
        context,
      );
      return {
        resultRef: {
          kind: "workflow-run" as const,
          reference: { entityId: input.runId, versionId: ROOT_RUN_VERSION_ID },
        },
        audit: {
          auditEntryId: `${commandId}:audit`,
          projectId: PROJECT_ID,
          action: "workflow.register-link",
          targetRef: {
            kind: "workflow-run" as const,
            reference: { entityId: input.runId, versionId: ROOT_RUN_VERSION_ID },
          },
          actorRef: ACTOR_ID,
          authorizationContextRef: AUTHORIZATION.authorizationContextRef,
          occurredAt: TIMESTAMP,
          recordedAt: TIMESTAMP,
          version: { entityId: input.runId, versionId: ROOT_RUN_VERSION_ID },
          commandId,
          idempotencyKey: commandId,
          runId: input.runId,
        },
        events: [],
      };
    },
  );
};

/** 父运行与一个评估子运行的可读事实：身份行 + 状态正文 + 一条来源链边。 */
const seedRuns = async () => {
  for (const [runId, runVersionId] of [
    [ROOT_RUN_ID, ROOT_RUN_VERSION_ID],
    [CHILD_RUN_ID, CHILD_RUN_VERSION_ID],
  ] as const) {
    const artifactRef = await fixture.workflow.bodies.putBody({
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      commandId: `c30-projection-body-${runId}`,
      issuedAt: TIMESTAMP,
      artifactId: `c30-run-state:${runId}:${runVersionId}`,
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
          stage: runId === ROOT_RUN_ID ? "result-summary" : "A9",
          status: "completed",
          ...(runId === CHILD_RUN_ID
            ? {
                parentRunRef: {
                  kind: "workflow-run" as const,
                  reference: { entityId: ROOT_RUN_ID, versionId: ROOT_RUN_VERSION_ID },
                },
              }
            : {}),
          assessmentRunRefs:
            runId === ROOT_RUN_ID
              ? [
                  {
                    kind: "workflow-run" as const,
                    reference: { entityId: CHILD_RUN_ID, versionId: CHILD_RUN_VERSION_ID },
                  },
                ]
              : [],
          acceptedRiskRecordRefs: [RISK_RECORD_REF],
          assessmentRecordRefs: [ASSESSMENT_RECORD_REF],
          warningRecordRefs: [],
          responseRecommendationRefs: [],
          deviationRecordRefs: [],
          calibrationSuggestionRefs: [],
          recordedAt: TIMESTAMP,
        },
      },
      authorization: AUTHORIZATION,
    });
    await register({
      ...rowBase(runId, runVersionId, "entry"),
      resultKind: "entry-snapshot",
      stage: runId === ROOT_RUN_ID ? "preparing" : "A0",
      entryIdentity: {
        entityId: `workflow-entry:${PROJECT_ID}:identify-and-assess`,
        versionId: "entry-v1",
      },
    });
    await register({
      ...rowBase(runId, runVersionId, "state"),
      resultKind: "run-state",
      resultVersionId: runVersionId,
      stage: runId === ROOT_RUN_ID ? "result-summary" : "A9",
      artifactRef,
    });
  }
  await registerLink({
    linkId: sha("link-risk-assessment"),
    runId: CHILD_RUN_ID,
    fromRef: RISK_RECORD_REF,
    toRef: ASSESSMENT_RECORD_REF,
    relation: "risk-assessment",
    stage: "A5",
    evidenceLocator: { sourceSegmentId: "stored-segment" },
  });
};

const PROJECT_REVISION_REF: ContractReferenceV1 = {
  kind: "project-revision",
  reference: { entityId: "project-revision-c31", versionId: "v1" },
};
const REPORT_RUN_ID = `risk-flow-run:${PROJECT_ID}:report`;
const LATER_RUN_ID = `risk-flow-run:${PROJECT_ID}:later`;
const CURSOR_RUN_ID = `risk-flow-run:${PROJECT_ID}:cursor`;
const OVERFLOW_RUN_ID = `risk-flow-run:${PROJECT_ID}:overflow`;
const REPORT_RUN_VERSION_ID = sha("c31-report-run-version");
const LATER_RUN_VERSION_ID = sha("c31-later-run-version");
const CURSOR_RUN_VERSION_ID = sha("c31-cursor-run-version");
const OVERFLOW_RUN_VERSION_ID = sha("c31-overflow-run-version");
const LATER_RECORDED_AT = "2031-01-01T00:00:00.000Z";
const REPORT_SKIPPED_TAIL: WorkflowSkippedTailV1 = {
  tailKind: "warning",
  reasonCode: "warning-not-triggered",
  lastEstablishedRef: ASSESSMENT_RECORD_REF,
};
const riskRecordRefs = (count: number, prefix: string): StandardizedRiskRecordRefV1[] =>
  Array.from({ length: count }, (_unused, index) => ({
    kind: "standardized-risk-record" as const,
    reference: { entityId: `${prefix}-${index}`, versionId: "v1" },
  }));

interface OverviewRunSeedV1 {
  readonly runId: string;
  readonly runVersionId: string;
  readonly suffix: string;
  readonly recordedAt?: string;
  /** 缺省使用报告主夹具修订；越界与隔离场景可用独立修订。 */
  readonly revisionRef?: ContractReferenceV1;
  readonly resultRunId?: string;
  readonly acceptedRiskRecordRefs: readonly StandardizedRiskRecordRefV1[];
  readonly assessmentRecordRefs: readonly RiskAssessmentRecordRefV1[];
  readonly skippedTails: readonly WorkflowSkippedTailV1[];
}

/**
 * C31 合成报告运行：入口行 + 最新状态正文 + 结果正文，全部只登记已成立引用与缺席原因；
 * 冻结引用固定为同一工程修订与空间目标，供报告选择谓词命中。
 */
const seedOverviewRun = async (seed: OverviewRunSeedV1): Promise<void> => {
  const recordedAt = seed.recordedAt ?? TIMESTAMP;
  const frozenRefs = [seed.revisionRef ?? PROJECT_REVISION_REF, SPATIAL_SCOPE_REF];
  const stateArtifactRef = await fixture.workflow.bodies.putBody({
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    commandId: `c31-report-state-${seed.suffix}`,
    issuedAt: recordedAt,
    artifactId: `c31-run-state:${seed.runId}:${seed.runVersionId}`,
    body: {
      bodyKind: "run-state",
      runState: {
        schemaVersion: "1",
        projectId: PROJECT_ID,
        runId: seed.runId,
        runVersionId: seed.runVersionId,
        entryMode: "identify-and-assess",
        entryIdentity: {
          entityId: `workflow-entry:${PROJECT_ID}:identify-and-assess`,
          versionId: "entry-v1",
        },
        stage: "result-summary",
        status: "completed",
        assessmentRunRefs: [],
        acceptedRiskRecordRefs: [...seed.acceptedRiskRecordRefs],
        assessmentRecordRefs: [...seed.assessmentRecordRefs],
        warningRecordRefs: [],
        responseRecommendationRefs: [],
        deviationRecordRefs: [],
        calibrationSuggestionRefs: [],
        recordedAt,
      },
    },
    authorization: AUTHORIZATION,
  });
  const resultArtifactRef = await fixture.workflow.bodies.putBody({
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    commandId: `c31-report-result-${seed.suffix}`,
    issuedAt: recordedAt,
    artifactId: `c31-run-result:${seed.runId}:${seed.runVersionId}`,
    body: {
      bodyKind: "run-result",
      runResult: {
        schemaVersion: "1",
        projectId: PROJECT_ID,
        runRef: {
          kind: "workflow-run",
          reference: {
            entityId: seed.resultRunId ?? seed.runId,
            versionId: sha(`${seed.runId}:run-ref`),
          },
        },
        entryMode: "identify-and-assess",
        stage: "result-summary",
        assessmentRunRefs: [],
        assessmentRecordRefs: [...seed.assessmentRecordRefs],
        warningRecordRefs: [],
        responseRecommendationRefs: [],
        deviationRecordRefs: [],
        calibrationSuggestionRefs: [],
        skippedTails: [...seed.skippedTails],
        auditTrailRef: {
          kind: "audit-trail",
          reference: { entityId: `c31-report-${seed.suffix}:audit`, versionId: "1" },
        },
        recordedAt,
      },
    },
    authorization: AUTHORIZATION,
  });
  const rows: WorkflowGraphResultRowV1[] = [
    {
      ...rowBase(seed.runId, seed.runVersionId, `${seed.suffix}-entry`),
      recordedAt,
      validAt: recordedAt,
      frozenRefs,
      resultKind: "entry-snapshot",
      stage: "preparing",
      entryIdentity: {
        entityId: `workflow-entry:${PROJECT_ID}:identify-and-assess`,
        versionId: "entry-v1",
      },
    },
    {
      ...rowBase(seed.runId, seed.runVersionId, `${seed.suffix}-state`),
      recordedAt,
      validAt: recordedAt,
      frozenRefs,
      resultKind: "run-state",
      resultVersionId: seed.runVersionId,
      stage: "result-summary",
      artifactRef: stateArtifactRef,
    },
    {
      ...rowBase(seed.runId, seed.runVersionId, `${seed.suffix}-result`),
      recordedAt,
      validAt: recordedAt,
      frozenRefs,
      resultKind: "run-result",
      stage: "result-summary",
      runResultRef: {
        kind: "risk-flow-run-result",
        reference: { entityId: `${seed.runId}:result`, versionId: "v1" },
      },
      artifactRef: resultArtifactRef,
    },
  ];
  for (const row of rows) await register(row);
};

const queryFor = async (
  queryId: string,
  payload: Record<string, unknown>,
): Promise<ProjectionQueryResultV1> =>
  await fixture.projection.queryProjection.query({
    queryId,
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    requestedAt: TIMESTAMP,
    authorization: AUTHORIZATION,
    kind: "query",
    payload,
  } as never);

const readRequest = (input: {
  readonly queryResultRef: ProjectionResultReadRequestV1["queryResultRef"];
  readonly limit?: number;
  readonly cursor?: string;
  readonly authorization?: AuthorizationContextV1;
}): ProjectionResultReadRequestV1 => ({
  projectId: PROJECT_ID,
  queryResultRef: input.queryResultRef,
  requestedAt: TIMESTAMP,
  limit: input.limit ?? 100,
  ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  authorization: input.authorization ?? AUTHORIZATION,
});

describe("C30 workflow projection adapter", () => {
  it("registers a run-view query and pages versioned run summaries deterministically", async () => {
    await seedRuns();
    const queried = await fixture.projection.queryProjection.query({
      queryId: "query-run-view",
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      authorization: AUTHORIZATION,
      kind: "query",
      payload: {
        queryType: "run-view",
        workflowRunRef: {
          kind: "workflow-run",
          reference: { entityId: ROOT_RUN_ID, versionId: ROOT_RUN_VERSION_ID },
        },
      },
    } as never);
    expect(queried.kind).toBe("succeeded");
    if (queried.kind !== "succeeded") return;
    const queryResultRef = queried.result.queryResultRef;

    const firstPage = await fixture.projection.resultRead.readPage(readRequest({ queryResultRef }));
    expect(firstPage.kind).toBe("page");
    if (firstPage.kind !== "page") return;
    expect(firstPage.queryType).toBe("run-view");
    const runIds = firstPage.items
      .filter((item) => item.kind === "run-summary")
      .map((item) => (item.kind === "run-summary" ? item.workflowRunRef.reference.entityId : ""));
    expect(runIds).toContain(ROOT_RUN_ID);
    expect(runIds).toContain(CHILD_RUN_ID);

    const single = await fixture.projection.resultRead.readPage(
      readRequest({ queryResultRef, limit: 1 }),
    );
    expect(single.kind).toBe("page");
    if (single.kind !== "page") return;
    expect(single.items).toHaveLength(1);
    expect(single.nextCursor).toBeDefined();

    const second = await fixture.projection.resultRead.readPage(
      readRequest({
        queryResultRef,
        limit: 100,
        ...(single.nextCursor === undefined ? {} : { cursor: single.nextCursor }),
      }),
    );
    expect(second.kind).toBe("page");
    if (second.kind !== "page") return;
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
  });

  it("rejects forged cursors, unknown query references and unsupported query types", async () => {
    const forged = await fixture.projection.resultRead.readPage(
      readRequest({
        queryResultRef: {
          kind: "query-result",
          reference: { entityId: `query-result:${PROJECT_ID}:query-run-view`, versionId: sha("x") },
        },
        cursor: "forged.cursor",
      }),
    );
    expect(forged).toMatchObject({ kind: "failed" });

    const unknown = await fixture.projection.resultRead.readPage(
      readRequest({
        queryResultRef: {
          kind: "query-result",
          reference: { entityId: "query-result:missing", versionId: "missing" },
        },
      }),
    );
    expect(unknown).toMatchObject({ kind: "failed" });
    if (unknown.kind === "failed") expect(unknown.error.code).toBe("ENTITY_NOT_FOUND");

    const unsupported = await fixture.projection.queryProjection.query({
      queryId: "query-review-queue",
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      authorization: AUTHORIZATION,
      kind: "query",
      payload: {
        queryType: "review-queue",
        projectRevisionRef: {
          kind: "project-revision",
          reference: { entityId: "project-revision-c30", versionId: "v1" },
        },
      },
    } as never);
    expect(unsupported).toMatchObject({ kind: "failed" });
    if (unsupported.kind === "failed") {
      expect(unsupported.error).toMatchObject({ code: "BUSINESS_BLOCKED" });
    }
  });

  it("keeps unauthorized and cross-project reads indistinguishable from missing targets", async () => {
    const queried = await fixture.projection.queryProjection.query({
      queryId: "query-run-view-auth",
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      authorization: AUTHORIZATION,
      kind: "query",
      payload: {
        queryType: "run-view",
        workflowRunRef: {
          kind: "workflow-run",
          reference: { entityId: ROOT_RUN_ID, versionId: ROOT_RUN_VERSION_ID },
        },
      },
    } as never);
    expect(queried.kind).toBe("succeeded");
    if (queried.kind !== "succeeded") return;

    fixture.access.revoke();
    const revoked = await fixture.projection.resultRead.readPage(
      readRequest({ queryResultRef: queried.result.queryResultRef }),
    );
    fixture.access.restore();
    const missing = await fixture.projection.resultRead.readPage(
      readRequest({
        queryResultRef: {
          kind: "query-result",
          reference: { entityId: "query-result:absent", versionId: "absent" },
        },
      }),
    );
    expect(revoked.kind).toBe("failed");
    expect(missing.kind).toBe("failed");
    if (revoked.kind === "failed" && missing.kind === "failed") {
      expect(revoked.error.code).toBe(missing.error.code);
      expect(revoked.error.code).toBe("ENTITY_NOT_FOUND");
    }

    const crossProject = await fixture.projection.queryProjection.query({
      queryId: "query-cross-project",
      projectId: OTHER_PROJECT_ID,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      authorization: authorizationFor(OTHER_PROJECT_ID),
      kind: "query",
      payload: {
        queryType: "run-view",
        workflowRunRef: {
          kind: "workflow-run",
          reference: { entityId: ROOT_RUN_ID, versionId: ROOT_RUN_VERSION_ID },
        },
      },
    } as never);
    expect(crossProject).toMatchObject({ kind: "failed" });
  });

  it("returns bounded trace links with one source batch and no placeholder tail", async () => {
    const queried = await fixture.projection.queryProjection.query({
      queryId: "query-trace-chain",
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      authorization: AUTHORIZATION,
      kind: "query",
      payload: { queryType: "trace-chain", subjectRef: RISK_RECORD_REF },
    } as never);
    expect(queried.kind).toBe("succeeded");
    if (queried.kind !== "succeeded") return;

    const callsBefore = fixture.trace.calls;
    const page = await fixture.projection.resultRead.readPage(
      readRequest({ queryResultRef: queried.result.queryResultRef }),
    );
    expect(page.kind).toBe("page");
    if (page.kind !== "page") return;
    expect(page.queryType).toBe("trace-chain");
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      kind: "trace-link",
      relation: "risk-assessment",
      evidenceLocator: { sourceSegmentId: "stored-segment" },
    });
    expect(fixture.trace.calls - callsBefore).toBe(1);

    const legacyWithoutTrace = createPostgresWorkflowProjection({
      db: fixture.runtime.db,
      registrationStore: fixture.workflow.registrationStore,
      bodies: fixture.workflow.bodies,
      authorization: fixture.access.port,
      now: () => new Date(TIMESTAMP),
    });
    const legacyPage = await legacyWithoutTrace.resultRead.readPage(
      readRequest({ queryResultRef: queried.result.queryResultRef }),
    );
    expect(legacyPage).toMatchObject({ kind: "page", queryType: "trace-chain" });

    fixture.trace.override = {
      kind: "succeeded",
      items: [
        {
          kind: "failed",
          riskRecordRef: RISK_RECORD_REF,
          error: {
            code: "ENTITY_NOT_FOUND",
            category: "not-found",
            retryable: false,
            stageCode: "read-batch",
            occurredAt: TIMESTAMP,
            causalRunId: "c30-projection",
            targetRef: RISK_RECORD_REF,
          },
        },
      ],
    };
    const incomplete = await fixture.projection.resultRead.readPage(
      readRequest({ queryResultRef: queried.result.queryResultRef }),
    );
    fixture.trace.override = undefined;
    expect(incomplete).toMatchObject({ kind: "failed" });
    if (incomplete.kind === "failed") {
      expect(incomplete.error).toMatchObject({
        code: "BUSINESS_BLOCKED",
        blockerKind: "trace-chain-incomplete",
      });
    }
  });

  it("projects a frozen revision into report facts, absence and stable bounded pages", async () => {
    await seedOverviewRun({
      runId: REPORT_RUN_ID,
      runVersionId: REPORT_RUN_VERSION_ID,
      suffix: "c31-report",
      acceptedRiskRecordRefs: riskRecordRefs(101, "report-risk"),
      assessmentRecordRefs: [ASSESSMENT_RECORD_REF],
      skippedTails: [REPORT_SKIPPED_TAIL],
    });
    const queried = await queryFor("query-overview-scoped", {
      queryType: "risk-overview",
      projectRevisionRef: PROJECT_REVISION_REF,
      spatialScopeRef: SPATIAL_SCOPE_REF,
    });
    expect(queried.kind).toBe("succeeded");
    if (queried.kind !== "succeeded") return;
    const queryResultRef = queried.result.queryResultRef;

    const callsBefore = fixture.trace.calls;
    const first = await fixture.projection.resultRead.readPage(
      readRequest({ queryResultRef, limit: 100 }),
    );
    expect(first.kind).toBe("page");
    if (first.kind !== "page") return;
    expect(first.queryType).toBe("risk-overview");
    expect(first.items).toHaveLength(100);
    expect(first.items[0]).toMatchObject({
      kind: "run-summary",
      workflowRunRef: { reference: { entityId: REPORT_RUN_ID } },
    });
    const facts = first.items.filter(
      (item): item is Extract<ProjectionResultItemV1, { kind: "report-fact" }> =>
        item.kind === "report-fact",
    );
    expect(facts).toHaveLength(99);
    const riskFact = facts.find((fact) => fact.factRef.kind === "standardized-risk-record");
    expect(riskFact).toMatchObject({
      factRef: { reference: { entityId: "report-risk-0" } },
      evidenceLocator: { sourceSegmentId: "segment-1" },
    });
    const assessmentFact = facts.find((fact) => fact.factRef.kind === "risk-assessment-record");
    expect(assessmentFact?.factRef).toEqual(ASSESSMENT_RECORD_REF);
    // 报告项只披露引用、审计与获准证据定位，不携带领域正文或推断等级。
    expect(Object.keys(first.items[0] ?? {}).sort()).toEqual([
      "auditTrailRef",
      "entryIdentity",
      "kind",
      "status",
      "workflowRunRef",
    ]);
    for (const fact of facts) {
      expect(Object.keys(fact).sort()).toEqual(
        fact.factRef.kind === "standardized-risk-record"
          ? ["auditTrailRef", "evidenceLocator", "factRef", "kind", "workflowRunRef"]
          : ["auditTrailRef", "factRef", "kind", "workflowRunRef"],
      );
    }
    expect(first.nextCursor).toBeDefined();
    expect(fixture.trace.calls - callsBefore).toBe(1);

    const second = await fixture.projection.resultRead.readPage(
      readRequest({
        queryResultRef,
        limit: 100,
        ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
      }),
    );
    expect(second.kind).toBe("page");
    if (second.kind !== "page") return;
    expect(second.items).toHaveLength(4);
    expect(second.nextCursor).toBeUndefined();
    const absence = second.items.find((item) => item.kind === "report-absence");
    expect(absence).toMatchObject({
      tailKind: "warning",
      reasonCode: "warning-not-triggered",
      lastEstablishedRef: ASSESSMENT_RECORD_REF,
    });
    expect(Object.keys(absence ?? {}).sort()).toEqual([
      "auditTrailRef",
      "kind",
      "lastEstablishedRef",
      "reasonCode",
      "tailKind",
      "workflowRunRef",
    ]);

    // 后续发布不改变历史查询：同修订/空间的重复读取仍是同一页，且晚于登记时点的运行不进入结果。
    await seedOverviewRun({
      runId: LATER_RUN_ID,
      runVersionId: LATER_RUN_VERSION_ID,
      suffix: "c31-later",
      recordedAt: LATER_RECORDED_AT,
      acceptedRiskRecordRefs: [RISK_RECORD_REF],
      assessmentRecordRefs: [],
      skippedTails: [],
    });
    const replay = await fixture.projection.resultRead.readPage(
      readRequest({ queryResultRef, limit: 100 }),
    );
    expect(replay).toEqual(first);
  });

  it("returns a real empty page when the frozen revision has no established run", async () => {
    const queried = await queryFor("query-overview-empty", {
      queryType: "risk-overview",
      projectRevisionRef: {
        kind: "project-revision",
        reference: { entityId: "project-revision-c31", versionId: "absent" },
      },
      spatialScopeRef: SPATIAL_SCOPE_REF,
    });
    expect(queried.kind).toBe("succeeded");
    if (queried.kind !== "succeeded") return;
    const page = await fixture.projection.resultRead.readPage(
      readRequest({ queryResultRef: queried.result.queryResultRef, limit: 100 }),
    );
    expect(page).toMatchObject({ kind: "page", queryType: "risk-overview", items: [] });
  });

  it("refuses a report whose result body points to another run", async () => {
    const revisionRef: ContractReferenceV1 = {
      kind: "project-revision",
      reference: { entityId: "project-revision-mismatched-result", versionId: "v1" },
    };
    await seedOverviewRun({
      runId: `risk-flow-run:${PROJECT_ID}:mismatched-result`,
      runVersionId: sha("mismatched-result-run-version"),
      resultRunId: `risk-flow-run:${PROJECT_ID}:another-run`,
      suffix: "c31-mismatched-result",
      revisionRef,
      acceptedRiskRecordRefs: [RISK_RECORD_REF],
      assessmentRecordRefs: [],
      skippedTails: [],
    });
    const queried = await queryFor("query-overview-mismatched-result", {
      queryType: "risk-overview",
      projectRevisionRef: revisionRef,
      spatialScopeRef: SPATIAL_SCOPE_REF,
    });
    expect(queried.kind).toBe("succeeded");
    if (queried.kind !== "succeeded") return;
    const page = await fixture.projection.resultRead.readPage(
      readRequest({ queryResultRef: queried.result.queryResultRef }),
    );
    expect(page).toMatchObject({ kind: "failed" });
    if (page.kind === "failed") {
      expect(page.error).toMatchObject({ blockerKind: "risk-overview-incomplete" });
    }
  });

  it("pages distinct fact kinds that share an entity and version", async () => {
    const shared = { entityId: "shared-report-fact", versionId: "v1" };
    const revisionRef: ContractReferenceV1 = {
      kind: "project-revision",
      reference: { entityId: "project-revision-shared-fact", versionId: "v1" },
    };
    await seedOverviewRun({
      runId: `risk-flow-run:${PROJECT_ID}:shared-fact`,
      runVersionId: sha("shared-fact-run-version"),
      suffix: "c31-shared-fact",
      revisionRef,
      acceptedRiskRecordRefs: [{ kind: "standardized-risk-record", reference: shared }],
      assessmentRecordRefs: [{ kind: "risk-assessment-record", reference: shared }],
      skippedTails: [],
    });
    const queried = await queryFor("query-overview-shared-fact", {
      queryType: "risk-overview",
      projectRevisionRef: revisionRef,
      spatialScopeRef: SPATIAL_SCOPE_REF,
    });
    expect(queried.kind).toBe("succeeded");
    if (queried.kind !== "succeeded") return;
    const first = await fixture.projection.resultRead.readPage(
      readRequest({ queryResultRef: queried.result.queryResultRef, limit: 2 }),
    );
    expect(first.kind).toBe("page");
    if (first.kind !== "page") return;
    expect(first.nextCursor).toBeDefined();
    const second = await fixture.projection.resultRead.readPage(
      readRequest({
        queryResultRef: queried.result.queryResultRef,
        limit: 2,
        ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
      }),
    );
    expect(second.kind).toBe("page");
    if (second.kind !== "page") return;
    const kinds = [...first.items, ...second.items].flatMap((item) =>
      item.kind === "report-fact" ? [item.factRef.kind] : [],
    );
    expect(kinds.sort()).toEqual(["risk-assessment-record", "standardized-risk-record"]);
  });

  it("expands a bounded association graph over proved runs with one source batch per page", async () => {
    await seedRuns();
    await registerLink({
      linkId: sha("c31-link-parent-child"),
      runId: ROOT_RUN_ID,
      fromRef: {
        kind: "workflow-run",
        reference: { entityId: ROOT_RUN_ID, versionId: ROOT_RUN_VERSION_ID },
      },
      toRef: {
        kind: "workflow-run",
        reference: { entityId: CHILD_RUN_ID, versionId: CHILD_RUN_VERSION_ID },
      },
      relation: "parent-child",
      stage: "preparing",
    });
    const queried = await queryFor("query-association-graph", {
      queryType: "association-graph",
      subjectRef: RISK_RECORD_REF,
    });
    expect(queried.kind).toBe("succeeded");
    if (queried.kind !== "succeeded") return;
    const queryResultRef = queried.result.queryResultRef;

    const callsBefore = fixture.trace.calls;
    const first = await fixture.projection.resultRead.readPage(
      readRequest({ queryResultRef, limit: 1 }),
    );
    expect(first.kind).toBe("page");
    if (first.kind !== "page") return;
    expect(first.queryType).toBe("association-graph");
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeDefined();
    expect(fixture.trace.calls - callsBefore).toBeLessThanOrEqual(1);
    if (first.nextCursor !== undefined) {
      const fields = JSON.parse(
        Buffer.from(first.nextCursor.split(".")[0] ?? "", "base64url").toString("utf8"),
      ) as string[];
      fields[2] = "forged-link-position";
      const encoded = Buffer.from(JSON.stringify(fields)).toString("base64url");
      const forgedPosition = await fixture.projection.resultRead.readPage(
        readRequest({ queryResultRef, cursor: `${encoded}.${sha(JSON.stringify(fields))}` }),
      );
      expect(forgedPosition).toMatchObject({ kind: "failed" });
      if (forgedPosition.kind === "failed") {
        expect(forgedPosition.error).toMatchObject({ blockerKind: "cursor-invalid" });
      }
    }

    const second = await fixture.projection.resultRead.readPage(
      readRequest({
        queryResultRef,
        limit: 50,
        ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
      }),
    );
    expect(second.kind).toBe("page");
    if (second.kind !== "page") return;
    const relations = [...first.items, ...second.items].map((item) =>
      item.kind === "trace-link" ? item.relation : item.kind,
    );
    expect([...relations].sort()).toEqual(["parent-child", "risk-assessment"]);
    const riskEdge = [...first.items, ...second.items].find(
      (item) => item.kind === "trace-link" && item.relation === "risk-assessment",
    );
    expect(riskEdge).toMatchObject({
      fromRef: RISK_RECORD_REF,
      toRef: ASSESSMENT_RECORD_REF,
      evidenceLocator: { sourceSegmentId: "segment-1" },
    });
    expect(riskEdge?.auditTrailRef).toBeDefined();

    // 来源资格不可证明：整页失败，不披露半份图。
    fixture.trace.override = {
      kind: "failed",
      error: {
        code: "ENTITY_NOT_FOUND",
        category: "not-found",
        retryable: false,
        stageCode: "read-batch",
        occurredAt: TIMESTAMP,
        causalRunId: "c30-projection",
        targetRef: RISK_RECORD_REF,
      },
    };
    const unprovable = await fixture.projection.resultRead.readPage(
      readRequest({ queryResultRef, limit: 50 }),
    );
    const deniedQuery = await queryFor("query-graph-source-denied", {
      queryType: "association-graph",
      subjectRef: RISK_RECORD_REF,
    });
    fixture.trace.override = undefined;
    expect(deniedQuery).toMatchObject({ kind: "failed" });
    if (deniedQuery.kind === "failed") expect(deniedQuery.error.code).toBe("ENTITY_NOT_FOUND");
    expect(unprovable).toMatchObject({ kind: "failed" });
    if (unprovable.kind === "failed") {
      expect(unprovable.error).toMatchObject({
        code: "BUSINESS_BLOCKED",
        blockerKind: "association-graph-incomplete",
      });
    }

    // C22 回了同数量的错误引用时也不能把登记时的定位当作当前授权证据。
    fixture.trace.override = {
      kind: "succeeded",
      items: [
        {
          kind: "found",
          riskRecordRef: {
            kind: "standardized-risk-record",
            reference: { entityId: "another-risk", versionId: "v1" },
          },
          processNodeId: "process-node-1",
          sourceSegmentIds: ["segment-1"],
          riskMechanismEntryIds: ["mechanism-1"],
          evidenceLocator: { sourceSegmentId: "segment-1" },
          auditTrailRef: {
            kind: "audit-trail",
            reference: { entityId: "audit-risk-record", versionId: "1" },
          },
        },
      ],
    };
    const wrongBatch = await fixture.projection.resultRead.readPage(
      readRequest({ queryResultRef, limit: 50 }),
    );
    fixture.trace.override = undefined;
    expect(wrongBatch).toMatchObject({ kind: "failed" });

    const withoutTrace = createPostgresWorkflowProjection({
      db: fixture.runtime.db,
      registrationStore: fixture.workflow.registrationStore,
      bodies: fixture.workflow.bodies,
      authorization: fixture.access.port,
      now: () => new Date(TIMESTAMP),
    });
    const missingSource = await withoutTrace.resultRead.readPage(
      readRequest({ queryResultRef, limit: 50 }),
    );
    expect(missingSource).toMatchObject({ kind: "failed" });
  });

  it("rejects an unprovable graph subject and forged cursors on the new branches", async () => {
    const unprovable = await queryFor("query-unprovable-graph", {
      queryType: "association-graph",
      subjectRef: {
        kind: "standardized-risk-record",
        reference: { entityId: "risk-record-absent", versionId: "v1" },
      },
    });
    expect(unprovable).toMatchObject({ kind: "failed" });
    if (unprovable.kind === "failed") expect(unprovable.error.code).toBe("ENTITY_NOT_FOUND");

    const queried = await queryFor("query-overview-cursor", {
      queryType: "risk-overview",
      projectRevisionRef: PROJECT_REVISION_REF,
      spatialScopeRef: SPATIAL_SCOPE_REF,
    });
    expect(queried.kind).toBe("succeeded");
    if (queried.kind !== "succeeded") return;
    const forged = await fixture.projection.resultRead.readPage(
      readRequest({
        queryResultRef: queried.result.queryResultRef,
        cursor: "Zm9yZ2Vk",
      }),
    );
    expect(forged).toMatchObject({ kind: "failed" });
    if (forged.kind === "failed") {
      expect(forged.error).toMatchObject({
        code: "BUSINESS_BLOCKED",
        blockerKind: "cursor-invalid",
      });
    }

    // 只接受绑定精确查询结果与授权摘要的游标：另一查询的合法游标同样被拒绝。
    await seedOverviewRun({
      runId: CURSOR_RUN_ID,
      runVersionId: CURSOR_RUN_VERSION_ID,
      suffix: "c31-cursor",
      acceptedRiskRecordRefs: riskRecordRefs(2, "cursor-risk"),
      assessmentRecordRefs: [],
      skippedTails: [],
    });
    const first = await fixture.projection.resultRead.readPage(
      readRequest({ queryResultRef: queried.result.queryResultRef, limit: 1 }),
    );
    expect(first.kind).toBe("page");
    if (first.kind !== "page") return;
    if (first.nextCursor !== undefined) {
      const fields = JSON.parse(
        Buffer.from(first.nextCursor.split(".")[0] ?? "", "base64url").toString("utf8"),
      ) as string[];
      fields[2] = JSON.stringify(["risk-flow-run:missing", ""]);
      const encoded = Buffer.from(JSON.stringify(fields)).toString("base64url");
      const forgedPosition = await fixture.projection.resultRead.readPage(
        readRequest({
          queryResultRef: queried.result.queryResultRef,
          cursor: `${encoded}.${sha(JSON.stringify(fields))}`,
        }),
      );
      expect(forgedPosition).toMatchObject({ kind: "failed" });
      if (forgedPosition.kind === "failed") {
        expect(forgedPosition.error).toMatchObject({ blockerKind: "cursor-invalid" });
      }
    }
    const other = await queryFor("query-overview-cursor-other", {
      queryType: "risk-overview",
      projectRevisionRef: PROJECT_REVISION_REF,
      spatialScopeRef: SPATIAL_SCOPE_REF,
    });
    expect(other.kind).toBe("succeeded");
    if (other.kind !== "succeeded") return;
    const crossQuery = await fixture.projection.resultRead.readPage(
      readRequest({
        queryResultRef: other.result.queryResultRef,
        ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
      }),
    );
    expect(crossQuery).toMatchObject({ kind: "failed" });
    if (crossQuery.kind === "failed") {
      expect(crossQuery.error).toMatchObject({
        code: "BUSINESS_BLOCKED",
        blockerKind: "cursor-invalid",
      });
    }
  });

  it("fails explicitly when a proved graph or a single run exceeds the hard bounds", async () => {
    // 关联运行越界：33 条已证明的 parent-child 边使关联运行超过 32 个，返回稳定越界原因而不是裁剪后的图。
    for (let index = 0; index < 33; index += 1) {
      await registerLink({
        linkId: sha(`c31-link-overflow-${index}`),
        runId: CHILD_RUN_ID,
        fromRef: {
          kind: "workflow-run",
          reference: { entityId: CHILD_RUN_ID, versionId: CHILD_RUN_VERSION_ID },
        },
        toRef: {
          kind: "workflow-run",
          reference: { entityId: `risk-flow-run:${PROJECT_ID}:overflow-${index}`, versionId: "v1" },
        },
        relation: "parent-child",
        stage: "preparing",
      });
    }
    const graph = await queryFor("query-graph-overflow", {
      queryType: "association-graph",
      subjectRef: RISK_RECORD_REF,
    });
    expect(graph.kind).toBe("succeeded");
    if (graph.kind !== "succeeded") return;
    const graphPage = await fixture.projection.resultRead.readPage(
      readRequest({ queryResultRef: graph.result.queryResultRef, limit: 50 }),
    );
    expect(graphPage).toMatchObject({ kind: "failed" });
    if (graphPage.kind === "failed") {
      expect(graphPage.error).toMatchObject({
        code: "BUSINESS_BLOCKED",
        blockerKind: "association-graph-overflow",
      });
    }

    // 单运行报告展开越界：1001 个事实超过 1000 项硬上限，不返回截断后的报告。
    const revisionRef: ContractReferenceV1 = {
      kind: "project-revision",
      reference: { entityId: "project-revision-c31-overflow", versionId: "v1" },
    };
    await seedOverviewRun({
      runId: OVERFLOW_RUN_ID,
      runVersionId: OVERFLOW_RUN_VERSION_ID,
      suffix: "c31-overflow",
      revisionRef,
      acceptedRiskRecordRefs: riskRecordRefs(1001, "overflow-risk"),
      assessmentRecordRefs: [],
      skippedTails: [],
    });
    const report = await queryFor("query-overview-overflow", {
      queryType: "risk-overview",
      projectRevisionRef: revisionRef,
      spatialScopeRef: SPATIAL_SCOPE_REF,
    });
    expect(report.kind).toBe("succeeded");
    if (report.kind !== "succeeded") return;
    const reportPage = await fixture.projection.resultRead.readPage(
      readRequest({ queryResultRef: report.result.queryResultRef, limit: 100 }),
    );
    expect(reportPage).toMatchObject({ kind: "failed" });
    if (reportPage.kind === "failed") {
      expect(reportPage.error).toMatchObject({
        code: "BUSINESS_BLOCKED",
        blockerKind: "risk-overview-overflow",
      });
    }
  });

  it("keeps revoked report reads indistinguishable from missing targets", async () => {
    const queried = await queryFor("query-overview-revoked", {
      queryType: "risk-overview",
      projectRevisionRef: PROJECT_REVISION_REF,
      spatialScopeRef: SPATIAL_SCOPE_REF,
    });
    expect(queried.kind).toBe("succeeded");
    if (queried.kind !== "succeeded") return;

    fixture.access.revoke();
    const revoked = await fixture.projection.resultRead.readPage(
      readRequest({ queryResultRef: queried.result.queryResultRef, limit: 100 }),
    );
    fixture.access.restore();
    const missing = await fixture.projection.resultRead.readPage(
      readRequest({
        queryResultRef: {
          kind: "query-result",
          reference: { entityId: "query-result:absent", versionId: "absent" },
        },
      }),
    );
    expect(revoked).toMatchObject({ kind: "failed" });
    expect(missing).toMatchObject({ kind: "failed" });
    if (revoked.kind === "failed" && missing.kind === "failed") {
      expect(revoked.error.code).toBe(missing.error.code);
      expect(revoked.error.code).toBe("ENTITY_NOT_FOUND");
    }
  });
});
