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
  type ProjectionResultReadRequestV1,
  type RiskRecordTraceReadResultV1,
} from "@riskflow/contracts/ports";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";
import type { WorkflowGraphResultRowV1 } from "@riskflow/core/workflow";

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
  readonly trace: { result: RiskRecordTraceReadResultV1; calls: number };
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
    const trace = {
      calls: 0,
      result: {
        kind: "succeeded",
        items: [
          {
            kind: "found",
            riskRecordRef: RISK_RECORD_REF,
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
      } as RiskRecordTraceReadResultV1,
    };
    const projection = createPostgresWorkflowProjection({
      db: runtime.db,
      registrationStore: workflow.registrationStore,
      bodies: workflow.bodies,
      authorization: access.port,
      riskRecordTrace: {
        readBatch: async () => {
          trace.calls += 1;
          return trace.result;
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
  readonly stage: "A5" | "assessment";
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
  });
};

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
      queryId: "query-graph",
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      authorization: AUTHORIZATION,
      kind: "query",
      payload: { queryType: "association-graph", subjectRef: RISK_RECORD_REF },
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
      evidenceLocator: { sourceSegmentId: "segment-1" },
    });
    expect(fixture.trace.calls - callsBefore).toBe(1);

    fixture.trace.result = {
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
    expect(incomplete).toMatchObject({ kind: "failed" });
    if (incomplete.kind === "failed") {
      expect(incomplete.error).toMatchObject({
        code: "BUSINESS_BLOCKED",
        blockerKind: "trace-chain-incomplete",
      });
    }
  });
});
