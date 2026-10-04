/**
 * 合成样本、待甲方复核：本文件全部工程、参与者、命令身份、摘要与工件正文均为合成夹具，
 * 不代表生产数据，也不得作为生产回退来源。
 *
 * C30 运行事实适配器行为验证（IP-04）：真实 Testcontainers PostgreSQL + 完整生产迁移链 +
 * 真实 C03 事务单元 / C04 文件系统工件存储，只有 C05 授权复验用可控替身注入。
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessServiceError, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  AuthorizationContextV1Schema,
  type AuthorizationContextV1,
  type ModuleBranchV1,
  type ResponseWorkflowBindingProofQueryV1,
  type WorkflowRunCompletionProofQueryV1,
} from "@riskflow/contracts/ports";
import { sha256CanonicalJson } from "@riskflow/core/persistence";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";
import {
  WorkflowGraphRunStateV1Schema,
  type WorkflowGraphResultRowV1,
  type WorkflowGraphRunStateV1,
} from "@riskflow/core/workflow";

import { createFilesystemArtifactStore } from "../../src/artifacts/filesystem-artifact-store.js";
import { PostgresArtifactRegistry } from "../../src/artifacts/postgres-artifact-registry.js";
import { runPostgresMigrations } from "../../src/postgres/migrations/run.js";
import * as assessmentRiskflowGraphsMigration from "../../src/postgres/migrations/workflow/deliver-assessment-and-riskflow-graphs/000050_assessment_riskflow_graphs.js";
import * as graphTraceReportProjectionsMigration from "../../src/postgres/migrations/workflow/deliver-graph-trace-and-report-projections/000051_graph_trace_report_projections.js";
import { createPostgresRuntime, type PostgresRuntime } from "../../src/postgres/pool.js";
import { PostgresTransactionUnit } from "../../src/postgres/transaction-unit.js";
import {
  createPostgresWorkflowAdapter,
  type PostgresWorkflowAdapterV1,
} from "../../src/workflow/index.js";
import { artifactPolicy } from "../artifacts/fixture.js";
import { startPostgresFixture, type PostgresTestFixture } from "../postgres/fixture.js";

const PROJECT_ID = "project-c30";
const OTHER_PROJECT_ID = "project-c30-other";
const ACTOR_ID = "actor-c30";
const RUN_ID = `risk-flow-run:${PROJECT_ID}`;
const OTHER_RUN_ID = `risk-flow-run:${PROJECT_ID}:other`;
const TIMESTAMP = "2030-02-01T00:00:00.000Z";
const sha = (seed: string): string => createHash("sha256").update(seed).digest("hex");
const RUN_VERSION_ID = sha("run-version-1");
const NEXT_RUN_VERSION_ID = sha("run-version-2");
const BODY_RUN_VERSION_ID = sha("run-version-body");
const SPATIAL_SCOPE_REF = {
  kind: "spatial-scope" as const,
  reference: { entityId: "scope-c30", versionId: "v1" },
};
const ENTRY_IDENTITY = { entityId: `workflow-entry:${PROJECT_ID}:assess`, versionId: "entry-v1" };
const RISK_RECORD_REF = {
  kind: "standardized-risk-record" as const,
  reference: { entityId: "risk-record-c30", versionId: "v1" },
};
const STAGE_RESULT_REF = {
  kind: "stage-result" as const,
  reference: { entityId: "stage-result-c30:A5", versionId: "v1" },
};
const RUN_REF = {
  kind: "workflow-run" as const,
  reference: { entityId: RUN_ID, versionId: RUN_VERSION_ID },
};

/** C30 绑定证明夹具：真实等待运行（入口路由行 + 人工决定等待行 + 运行状态正文）。 */
const BINDING_QUERY_ID = "c41-binding-proof-query";
const BINDING_RUN_ID = `risk-flow-run:${PROJECT_ID}:binding`;
const BINDING_RUN_VERSION_ID = sha("binding-run-version");
const BINDING_RECOMMENDATION_REF = {
  kind: "response-recommendation" as const,
  reference: { entityId: "recommendation-binding-c30", versionId: "v1" },
};
const BINDING_MONITORING_REF = {
  kind: "monitoring-snapshot" as const,
  reference: { entityId: "monitoring-binding-c30", versionId: "v1" },
};
const BINDING_ENTRY_IDENTITY = {
  entityId: `workflow-entry:${PROJECT_ID}:forecast-response`,
  versionId: sha("binding-entry-identity"),
};
/** 入口路由引用按运行派生：登记行身份不含 run_id，跨运行夹具必须自行区分。 */
const bindingEntryRouteRefFor = (runId: string) => ({
  kind: "route-decision" as const,
  reference: {
    entityId: `risk-flow-entry:${runId}`,
    versionId: sha(`binding-entry-route:${runId}`),
  },
});
const BINDING_ENTRY_ROUTE_REF = bindingEntryRouteRefFor(BINDING_RUN_ID);
const BINDING_RUN_REF = {
  kind: "workflow-run" as const,
  reference: { entityId: BINDING_RUN_ID, versionId: sha("binding-run-identity") },
};
const BINDING_FROZEN_REFS = [
  BINDING_RECOMMENDATION_REF,
  BINDING_MONITORING_REF,
  SPATIAL_SCOPE_REF,
] as const;

const authorizationFor = (overrides: Record<string, unknown> = {}): AuthorizationContextV1 =>
  AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: {
      kind: "authorization-context",
      reference: { entityId: "authorization-c30", versionId: "v1" },
    },
    actorId: ACTOR_ID,
    projectId: PROJECT_ID,
    grantedCapabilities: ["workflow.start"],
    spatialScopeRefs: [SPATIAL_SCOPE_REF],
    sourceAccessGrantRefs: [],
    authorizationPolicyRef: { entityId: "authorization-policy", versionId: "v1" },
    decidedAt: TIMESTAMP,
    invocation: { kind: "human" },
    ...overrides,
  });

const AUTHORIZATION = authorizationFor();
const SCOPE_DIGEST = authorizationScopeDigest(AUTHORIZATION);

/** C05 复验替身：只按签发身份放行，撤销后一律拒绝，并记录每次复验请求。 */
const createAccess = () => {
  const calls: { readonly invocationId: string; readonly branch: ModuleBranchV1 }[] = [];
  let revoked = false;
  /** 不同窄读按各自用途分支签发；替身按当前绑定的上下文原样回放。 */
  let contextOverride: AuthorizationContextV1 | undefined;
  /**
   * 真实 C05 要求 `authorization_contexts.invocation_id` 与请求 id 逐项一致（一个上下文一个 id），
   * 因此这里可绑定唯一合法 id：复验用别的 id 一律拒绝，证明类调用必须先满足该约束。
   */
  let boundInvocationId: string | undefined;
  const port: Pick<LocalIdentityAccessV1, "verify"> = {
    verify: async (input) => {
      calls.push({ invocationId: input.invocationId, branch: input.branch });
      if (
        revoked ||
        (boundInvocationId !== undefined && input.invocationId !== boundInvocationId)
      ) {
        throw new AccessServiceError({
          code: "AUTHORIZATION_DENIED",
          retryable: false,
          stage: "c30-test-verify",
          occurredAt: TIMESTAMP,
          diagnosticRef: {
            kind: "diagnostic-artifact",
            reference: { entityId: "access-diagnostic", versionId: "1" },
          },
          contextRefs: [],
          requiredCapability: "workflow.start",
          authorizationPolicyRef: { entityId: "authorization-policy", versionId: "v1" },
        });
      }
      const result = AuthorizationContextV1Schema.safeParse(contextOverride ?? AUTHORIZATION);
      if (!result.success) throw new TypeError("invalid test authorization");
      return {
        context: { ...result.data, authorizationContextRef: input.authorizationContextRef },
      } as Awaited<ReturnType<LocalIdentityAccessV1["verify"]>>;
    },
  };
  return {
    port,
    calls,
    revoke: () => {
      revoked = true;
    },
    restore: () => {
      revoked = false;
    },
    bindInvocationId: (invocationId: string | undefined) => {
      boundInvocationId = invocationId;
    },
    setAuthorization: (value: AuthorizationContextV1 | undefined) => {
      contextOverride = value;
    },
  };
};

const runState = (input: {
  readonly runVersionId: string;
  readonly status?: WorkflowGraphRunStateV1["status"];
  readonly runId?: string;
  readonly assessmentRecordRefs?: WorkflowGraphRunStateV1["assessmentRecordRefs"];
  readonly resultRef?: WorkflowGraphRunStateV1["resultRef"];
}): WorkflowGraphRunStateV1 =>
  WorkflowGraphRunStateV1Schema.parse({
    schemaVersion: "1",
    projectId: PROJECT_ID,
    runId: input.runId ?? RUN_ID,
    runVersionId: input.runVersionId,
    entryMode: "assess",
    entryIdentity: ENTRY_IDENTITY,
    stage: "A5",
    status: input.status ?? "running",
    assessmentRunRefs: [],
    acceptedRiskRecordRefs: [RISK_RECORD_REF],
    assessmentRecordRefs: input.assessmentRecordRefs ?? [],
    ...(input.resultRef === undefined ? {} : { resultRef: input.resultRef }),
    warningRecordRefs: [],
    responseRecommendationRefs: [],
    deviationRecordRefs: [],
    calibrationSuggestionRefs: [],
    recordedAt: TIMESTAMP,
  });

/** 最小合法登记行：完整引用形状由核心判别联合与迁移 CHECK 互为对照。 */
const resultRowFor = (
  kind: WorkflowGraphResultRowV1["resultKind"],
  suffix: string,
): WorkflowGraphResultRowV1 => {
  const base = {
    schemaVersion: "1" as const,
    projectId: PROJECT_ID,
    resultId: `result-${kind}-${suffix}`,
    resultVersionId: sha(`result-version-${kind}-${suffix}`),
    runId: RUN_ID,
    runVersionId: RUN_VERSION_ID,
    entryMode: "assess" as const,
    commandId: `c30-fixture-${kind}-${suffix}`,
    idempotencyKey: `c30-idempotency-${kind}-${suffix}`,
    requestDigest: sha(`request-${kind}-${suffix}`),
    actorRef: ACTOR_ID,
    authorizationContextRef: AUTHORIZATION.authorizationContextRef,
    authorizationScopeDigest: SCOPE_DIGEST,
    validAt: TIMESTAMP,
    recordedAt: TIMESTAMP,
    persistedAt: TIMESTAMP,
    auditEntryId: `c30-fixture-${kind}-${suffix}:audit`,
    frozenRefs: [RISK_RECORD_REF],
  };
  switch (kind) {
    case "entry-snapshot":
      return {
        ...base,
        resultKind: "entry-snapshot",
        stage: "preparing",
        entryIdentity: ENTRY_IDENTITY,
      };
    case "stage-result":
      return {
        ...base,
        resultKind: "stage-result",
        stage: "A5",
        stageResultRef: STAGE_RESULT_REF,
      };
    case "route-decision":
      return {
        ...base,
        resultKind: "route-decision",
        routeDecisionRef: {
          kind: "route-decision",
          reference: { entityId: "route-decision-c30", versionId: "v1" },
        },
        routeKind: "assessment-continue",
      };
    case "run-state":
      return { ...base, resultKind: "run-state", stage: "A5" };
    case "waiting":
      return {
        ...base,
        resultKind: "waiting",
        stage: "A8",
        waitingRef: {
          kind: "review",
          reviewTaskRef: {
            kind: "review-task",
            reference: { entityId: "review-c30", versionId: "v1" },
            reviewType: "calibration-suggestion",
            targetRef: {
              kind: "calibration-suggestion",
              reference: { entityId: "calibration-suggestion-c30", versionId: "v1" },
            },
            waitingRunRef: RUN_REF,
          },
        },
      };
    case "workflow-error":
      return {
        ...base,
        resultKind: "workflow-error",
        stage: "A5",
        workflowErrorRef: {
          kind: "workflow-error",
          reference: { entityId: "workflow-error-c30", versionId: "v1" },
        },
      };
    case "run-result":
      return {
        ...base,
        resultKind: "run-result",
        stage: "result-summary",
        runResultRef: {
          kind: "assessment-run-result",
          reference: { entityId: "assessment-run-result-c30", versionId: "v1" },
        },
      };
  }
  /* c8 ignore next */
  throw new TypeError("unknown row kind");
};

interface WorkflowAdapterTestFixture {
  readonly postgres: PostgresTestFixture;
  readonly runtime: PostgresRuntime;
  readonly migratorRuntime: PostgresRuntime;
  readonly transactionUnit: PostgresTransactionUnit;
  readonly adapter: PostgresWorkflowAdapterV1;
  readonly artifactStore: ArtifactStoreV1 & { close(): Promise<void> };
  readonly access: ReturnType<typeof createAccess>;
  readonly rootDirectory: string;
  close(): Promise<void>;
}

const startFixture = async (): Promise<WorkflowAdapterTestFixture> => {
  const postgres = await startPostgresFixture();
  try {
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
      additionalMigrationRoots: [postgres.fixtureMigrationRoot],
    });
    const rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c30-workflow-"));
    const runtime = createPostgresRuntime(postgres.app, "riskflow_app");
    const migratorRuntime = createPostgresRuntime(postgres.migrator, "riskflow_migrator");
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
    const adapter = createPostgresWorkflowAdapter({
      db: runtime.db,
      transactionUnit,
      artifactStore,
      authorization: access.port,
      now: () => new Date(TIMESTAMP),
    });
    return {
      postgres,
      runtime,
      migratorRuntime,
      transactionUnit,
      adapter,
      artifactStore,
      access,
      rootDirectory,
      async close() {
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

/** 单容器夹具：整个文件共享一次迁移链与一次适配器构造。 */
let fixture: WorkflowAdapterTestFixture;

beforeAll(async () => {
  fixture = await startFixture();
}, 180_000);

afterAll(async () => {
  await fixture?.close();
});

/** 在真实 C03 事务内登记一行：收据、审计与登记行同事务提交（审计身份按同一命令派生）。 */
const registerWithinTransaction = async (input: {
  readonly row: WorkflowGraphResultRowV1;
  readonly commandKind?: string;
  readonly commit?: boolean;
}) => {
  const commandId = input.row.commandId;
  const commandKind = input.commandKind ?? "workflow.register-row";
  return await fixture.transactionUnit.execute(
    {
      projectId: input.row.projectId,
      commandKind,
      commandId,
      idempotencyKey: input.row.idempotencyKey,
      payload: { resultId: input.row.resultId, kind: input.row.resultKind },
      actorRef: input.row.actorRef,
      authorizationContextRef: input.row.authorizationContextRef,
      issuedAt: input.row.recordedAt,
      runId: input.row.runId,
    },
    async (context) => {
      await fixture.adapter.registrationStore.registerRow(
        { row: input.row, occurredAt: input.row.recordedAt },
        context,
      );
      if (input.commit === false) throw new TypeError("synthetic commit failure");
      return {
        resultRef: RUN_REF,
        audit: {
          auditEntryId: input.row.auditEntryId,
          projectId: input.row.projectId,
          action: commandKind,
          targetRef: RUN_REF,
          actorRef: input.row.actorRef,
          authorizationContextRef: input.row.authorizationContextRef,
          occurredAt: input.row.recordedAt,
          recordedAt: input.row.recordedAt,
          version: RUN_REF.reference,
          commandId,
          idempotencyKey: input.row.idempotencyKey,
          runId: input.row.runId,
        },
        events: [],
      };
    },
  );
};

describe("C30 workflow registration adapter", () => {
  it("registers appended facts inside the C03 transaction and replays the same identity", async () => {
    const row = resultRowFor("entry-snapshot", "entry-1");
    const receipt = await registerWithinTransaction({ row });
    expect(receipt.replayed).toBe(false);

    const stored = await fixture.adapter.registrationStore.readRow({
      projectId: row.projectId,
      runId: row.runId,
      resultKind: "entry-snapshot",
      resultId: row.resultId,
      resultVersionId: row.resultVersionId,
    });
    expect(stored?.entryIdentity).toEqual(ENTRY_IDENTITY);

    const replay = await registerWithinTransaction({ row });
    expect(replay.replayed).toBe(true);
    const rows = await fixture.adapter.registrationStore.listRunRows({
      projectId: row.projectId,
      runId: row.runId,
    });
    expect(rows.filter((item) => item.resultId === row.resultId)).toHaveLength(1);
  });

  it("rejects the same idempotency key carrying a different payload without overwriting the first fact", async () => {
    const first = resultRowFor("stage-result", "idem-1");
    await registerWithinTransaction({ row: first });
    const conflicting = {
      ...resultRowFor("stage-result", "idem-2"),
      commandId: first.commandId,
      idempotencyKey: first.idempotencyKey,
    };
    const outcome = await fixture.transactionUnit.execute(
      {
        projectId: first.projectId,
        commandKind: "workflow.register-row",
        commandId: `${first.commandId}:second`,
        idempotencyKey: `${first.idempotencyKey}:second`,
        payload: { resultId: conflicting.resultId },
        actorRef: first.actorRef,
        authorizationContextRef: first.authorizationContextRef,
        issuedAt: first.recordedAt,
      },
      async (context) => {
        await fixture.adapter.registrationStore.registerRow(
          { row: conflicting, occurredAt: conflicting.recordedAt },
          context,
        );
        return {
          resultRef: RUN_REF,
          audit: {
            auditEntryId: `${first.commandId}:second:audit`,
            projectId: first.projectId,
            action: "workflow.register-row",
            targetRef: RUN_REF,
            actorRef: first.actorRef,
            authorizationContextRef: first.authorizationContextRef,
            occurredAt: first.recordedAt,
            recordedAt: first.recordedAt,
            version: RUN_REF.reference,
            commandId: `${first.commandId}:second`,
            idempotencyKey: `${first.idempotencyKey}:second`,
          },
          events: [],
        };
      },
    );
    const persisted = await fixture.adapter.registrationStore.readRow({
      projectId: first.projectId,
      runId: first.runId,
      resultKind: "stage-result",
      resultId: first.resultId,
      resultVersionId: first.resultVersionId,
    });
    expect(persisted?.requestDigest).toBe(first.requestDigest);
    expect(outcome.replayed).toBe(false);
  });

  it("rolls back registered rows and audit entries when the transaction fails", async () => {
    const row = resultRowFor("route-decision", "rollback-1");
    await expect(
      registerWithinTransaction({ row, commit: false, commandKind: "workflow.register-rollback" }),
    ).rejects.toThrowError();
    const stored = await fixture.adapter.registrationStore.readRow({
      projectId: row.projectId,
      runId: row.runId,
      resultKind: "route-decision",
      resultId: row.resultId,
      resultVersionId: row.resultVersionId,
    });
    expect(stored).toBeUndefined();
    const audit = await sql<{ count: string }>`
      SELECT count(*)::text AS count FROM audit.entries
      WHERE project_id = ${PROJECT_ID} AND action = 'workflow.register-rollback'
    `.execute(fixture.runtime.db);
    expect(audit.rows[0]?.count).toBe("0");
  });

  it("keeps one run state per run version and asserts the expected state version", async () => {
    const first = {
      ...resultRowFor("run-state", "state-1"),
      resultVersionId: RUN_VERSION_ID,
      runVersionId: RUN_VERSION_ID,
    };
    await registerWithinTransaction({ row: first });

    const duplicate = {
      ...resultRowFor("run-state", "state-1-duplicate"),
      resultVersionId: first.resultVersionId,
      runVersionId: first.runVersionId,
    };
    await expect(registerWithinTransaction({ row: duplicate })).rejects.toThrowError();

    const second = {
      ...resultRowFor("run-state", "state-2"),
      resultVersionId: NEXT_RUN_VERSION_ID,
      runVersionId: NEXT_RUN_VERSION_ID,
    };
    await registerWithinTransaction({ row: second });

    await expect(
      fixture.transactionUnit.execute(
        {
          projectId: PROJECT_ID,
          commandKind: "workflow.assert-version",
          commandId: "c30-assert-current",
          idempotencyKey: "c30-assert-current",
          payload: { runId: RUN_ID },
          actorRef: ACTOR_ID,
          authorizationContextRef: AUTHORIZATION.authorizationContextRef,
          issuedAt: TIMESTAMP,
          runId: RUN_ID,
        },
        async (context) => {
          await fixture.adapter.registrationStore.assertCurrentRunVersion(
            { projectId: PROJECT_ID, runId: RUN_ID, expectedRunVersionId: NEXT_RUN_VERSION_ID },
            context,
          );
          return {
            resultRef: RUN_REF,
            audit: {
              auditEntryId: "c30-assert-current:audit",
              projectId: PROJECT_ID,
              action: "workflow.assert-version",
              targetRef: RUN_REF,
              actorRef: ACTOR_ID,
              authorizationContextRef: AUTHORIZATION.authorizationContextRef,
              occurredAt: TIMESTAMP,
              recordedAt: TIMESTAMP,
              version: RUN_REF.reference,
              commandId: "c30-assert-current",
              idempotencyKey: "c30-assert-current",
            },
            events: [],
          };
        },
      ),
    ).resolves.toBeDefined();

    await expect(
      fixture.transactionUnit.execute(
        {
          projectId: PROJECT_ID,
          commandKind: "workflow.assert-stale",
          commandId: "c30-assert-stale",
          idempotencyKey: "c30-assert-stale",
          payload: { runId: RUN_ID },
          actorRef: ACTOR_ID,
          authorizationContextRef: AUTHORIZATION.authorizationContextRef,
          issuedAt: TIMESTAMP,
          runId: RUN_ID,
        },
        async (context) => {
          await fixture.adapter.registrationStore.assertCurrentRunVersion(
            { projectId: PROJECT_ID, runId: RUN_ID, expectedRunVersionId: RUN_VERSION_ID },
            context,
          );
          throw new TypeError("stale run version must not pass");
        },
      ),
    ).rejects.toThrowError();
  });

  it("stores the run state body in C04 and reads it back only for the current authorization", async () => {
    const artifactRef = await fixture.adapter.bodies.putBody({
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      commandId: "c30-body-state-1",
      invocationId: "c30-body-state-1",
      issuedAt: TIMESTAMP,
      artifactId: `c30-run-state:${RUN_ID}:${BODY_RUN_VERSION_ID}`,
      body: { bodyKind: "run-state", runState: runState({ runVersionId: BODY_RUN_VERSION_ID }) },
      authorization: AUTHORIZATION,
    });
    expect(artifactRef.kind).toBe("content-artifact");

    const row = {
      ...resultRowFor("run-state", "state-body-1"),
      resultVersionId: BODY_RUN_VERSION_ID,
      runVersionId: BODY_RUN_VERSION_ID,
      artifactRef,
    };
    await registerWithinTransaction({ row });

    const latest = await fixture.adapter.registrationStore.readLatestRunState({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      invocationId: "c30-run-state-read",
      authorization: AUTHORIZATION,
    });
    expect(latest?.state.runVersionId).toBe(BODY_RUN_VERSION_ID);

    fixture.access.revoke();
    const denied = await fixture.adapter.registrationStore.readLatestRunState({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      invocationId: "c30-run-state-read",
      authorization: AUTHORIZATION,
    });
    fixture.access.restore();
    expect(denied).toBeUndefined();

    const missing = await fixture.adapter.registrationStore.readLatestRunState({
      projectId: OTHER_PROJECT_ID,
      runId: OTHER_RUN_ID,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      invocationId: "c30-run-state-read",
      authorization: AUTHORIZATION,
    });
    expect(missing).toBeUndefined();
  });

  it("proves a completed run only for its exact recorded assessment", async () => {
    const runId = `${RUN_ID}:completion`;
    const runVersionId = sha("completion-run-version");
    const assessmentRef = {
      kind: "risk-assessment-record" as const,
      reference: { entityId: "assessment-completed-c30", versionId: "1" },
    };
    const workflowRunRef = {
      kind: "workflow-run" as const,
      reference: { entityId: runId, versionId: sha("completion-run-identity") },
    };
    const resultVersionId = sha("completion-result-version");
    const resultRef = {
      kind: "risk-flow-run-result" as const,
      reference: { entityId: `risk-flow-run-result:${runId}`, versionId: resultVersionId },
    };
    const artifactRef = await fixture.adapter.bodies.putBody({
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      commandId: "c30-body-completion",
      invocationId: "c30-body-completion",
      issuedAt: TIMESTAMP,
      artifactId: `c30-run-state:${runId}:${runVersionId}`,
      body: {
        bodyKind: "run-state",
        runState: runState({
          runId,
          runVersionId,
          status: "completed",
          assessmentRecordRefs: [assessmentRef],
          resultRef,
        }),
      },
      authorization: AUTHORIZATION,
    });
    await registerWithinTransaction({
      row: {
        ...resultRowFor("run-state", "completion"),
        runId,
        runVersionId,
        resultVersionId: runVersionId,
        resultId: artifactRef.reference.entityId,
        artifactRef,
      },
    });
    const resultArtifactRef = await fixture.adapter.bodies.putBody({
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      commandId: "c30-body-completion-result",
      invocationId: "c30-body-completion-result",
      issuedAt: TIMESTAMP,
      artifactId: `c30-run-result:${runId}:${resultVersionId}`,
      body: {
        bodyKind: "run-result",
        runResult: {
          schemaVersion: "1",
          projectId: PROJECT_ID,
          runRef: workflowRunRef,
          entryMode: "assess",
          stage: "result-summary",
          assessmentRunRefs: [],
          assessmentRecordRefs: [assessmentRef],
          warningRecordRefs: [],
          responseRecommendationRefs: [],
          deviationRecordRefs: [],
          calibrationSuggestionRefs: [],
          skippedTails: [],
          auditTrailRef: {
            kind: "audit-trail",
            reference: { entityId: `risk-flow-run-audit:${runId}`, versionId: resultVersionId },
          },
          recordedAt: TIMESTAMP,
        },
      },
      authorization: AUTHORIZATION,
    });
    await registerWithinTransaction({
      row: {
        ...resultRowFor("run-result", "completion"),
        runId,
        runVersionId,
        resultVersionId: resultArtifactRef.reference.versionId,
        resultId: resultArtifactRef.reference.entityId,
        runResultRef: resultArtifactRef,
        artifactRef: resultArtifactRef,
      },
    });
    const query = {
      kind: "verify-workflow-run-completion",
      queryId: "c30-run-completion-query",
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      authorization: AUTHORIZATION,
      payload: {
        workflowRunRef,
        riskAssessmentRecordRef: assessmentRef,
      },
    } satisfies WorkflowRunCompletionProofQueryV1;
    expect(
      await fixture.adapter.runCompletionProof.verifyWorkflowRunCompletion(query),
    ).toMatchObject({
      kind: "succeeded",
      result: { riskAssessmentRecordRef: assessmentRef },
    });
    expect(
      await fixture.adapter.runCompletionProof.verifyWorkflowRunCompletion({
        ...query,
        payload: {
          ...query.payload,
          riskAssessmentRecordRef: {
            ...assessmentRef,
            reference: { entityId: "assessment-other", versionId: "1" },
          },
        },
      }),
    ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    expect(
      await fixture.adapter.runCompletionProof.verifyWorkflowRunCompletion({
        ...query,
        payload: {
          ...query.payload,
          workflowRunRef: {
            ...workflowRunRef,
            reference: { ...workflowRunRef.reference, versionId: "wrong-version" },
          },
        },
      }),
    ).toMatchObject({ kind: "failed", error: { code: "TERMINAL_FAILURE" } });
    fixture.access.revoke();
    expect(
      await fixture.adapter.runCompletionProof.verifyWorkflowRunCompletion(query),
    ).toMatchObject({
      kind: "failed",
      error: { code: "AUTHORIZATION_DENIED" },
    });
    fixture.access.restore();
  });

  describe("D-12 入口元数据窄读", () => {
    const ENTRIES_AUTHORIZATION = authorizationFor({ grantedCapabilities: ["projection.query"] });
    const currentRecord = {
      kind: "risk-assessment-record" as const,
      reference: { entityId: "assessment-entries-current", versionId: "1" },
    };
    const previousRecord = {
      kind: "risk-assessment-record" as const,
      reference: { entityId: "assessment-entries-previous", versionId: "1" },
    };
    const readInput = (assessmentRecordRefs = [currentRecord]) => ({
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      authorization: ENTRIES_AUTHORIZATION,
      assessmentRecordRefs,
    });

    /** 登记一个评估子运行：入口行 + 精确 run-state 工件 + 产出该记录的正式链边。 */
    const registerAssessmentRun = async (input: {
      readonly suffix: string;
      readonly runId: string;
      readonly recordRef: {
        readonly kind: "risk-assessment-record";
        readonly reference: { readonly entityId: string; readonly versionId: string };
      };
      readonly entryMode: "assess" | "reassess";
      readonly reassessmentEntry?: {
        readonly previousAssessmentRecordRef: typeof previousRecord;
        readonly reason: "monitoring-snapshot" | "applicability-metadata";
        readonly changedInputRefs: readonly (typeof previousRecord)[];
      };
    }) => {
      const runVersionId = sha(`entries-run-version:${input.suffix}`);
      const entryIdentity = {
        entityId: `workflow-entry:${PROJECT_ID}:${input.suffix}`,
        versionId: sha(`entries-entry:${input.suffix}`),
      };
      await registerWithinTransaction({
        row: {
          ...resultRowFor("entry-snapshot", input.suffix),
          runId: input.runId,
          runVersionId,
          resultId: `entry-snapshot:${input.runId}:1`,
          resultVersionId: "1",
          entryIdentity,
          entryMode: input.entryMode,
        },
      });
      const artifactRef = await fixture.adapter.bodies.putBody({
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        commandId: `c30-body-entries-${input.suffix}`,
        invocationId: `c30-body-entries-${input.suffix}`,
        issuedAt: TIMESTAMP,
        artifactId: `c30-run-state:${input.runId}:${runVersionId}`,
        authorization: ENTRIES_AUTHORIZATION,
        body: {
          bodyKind: "run-state",
          runState: WorkflowGraphRunStateV1Schema.parse({
            schemaVersion: "1",
            projectId: PROJECT_ID,
            runId: input.runId,
            runVersionId,
            entryMode: input.entryMode,
            entryIdentity,
            stage: "A5",
            status: "completed",
            assessmentRunRefs: [],
            acceptedRiskRecordRefs: [RISK_RECORD_REF],
            assessmentRecordRefs: [input.recordRef],
            warningRecordRefs: [],
            responseRecommendationRefs: [],
            deviationRecordRefs: [],
            calibrationSuggestionRefs: [],
            ...(input.reassessmentEntry === undefined
              ? {}
              : { reassessmentEntry: input.reassessmentEntry }),
            recordedAt: TIMESTAMP,
          }),
        },
      });
      await registerWithinTransaction({
        row: {
          ...resultRowFor("run-state", input.suffix),
          runId: input.runId,
          runVersionId,
          resultVersionId: runVersionId,
          resultId: artifactRef.reference.entityId,
          artifactRef,
        },
      });
      const linkId = sha(`entries-link:${input.suffix}`);
      await fixture.transactionUnit.execute(
        {
          projectId: PROJECT_ID,
          commandKind: "workflow.register-link",
          commandId: `c30-link-entries-${input.suffix}`,
          idempotencyKey: `c30-link-entries-${input.suffix}`,
          payload: { linkId },
          actorRef: ACTOR_ID,
          authorizationContextRef: ENTRIES_AUTHORIZATION.authorizationContextRef,
          issuedAt: TIMESTAMP,
          runId: input.runId,
        },
        async (context) => {
          await fixture.adapter.registrationStore.registerLink(
            {
              link: {
                schemaVersion: "1",
                projectId: PROJECT_ID,
                linkId,
                runId: input.runId,
                fromRef: RISK_RECORD_REF,
                toRef: input.recordRef,
                relation: "risk-assessment",
                sourceStage: "A5",
                stageResultRef: STAGE_RESULT_REF,
                authorizationContextRef: ENTRIES_AUTHORIZATION.authorizationContextRef,
                authorizationScopeDigest: SCOPE_DIGEST,
                actorRef: ACTOR_ID,
                recordedAt: TIMESTAMP,
                auditEntryId: `c30-link-entries-${input.suffix}:audit`,
              },
            },
            context,
          );
          return {
            resultRef: RUN_REF,
            audit: {
              auditEntryId: `c30-link-entries-${input.suffix}:audit`,
              projectId: PROJECT_ID,
              action: "workflow.register-link",
              targetRef: RUN_REF,
              actorRef: ACTOR_ID,
              authorizationContextRef: ENTRIES_AUTHORIZATION.authorizationContextRef,
              occurredAt: TIMESTAMP,
              recordedAt: TIMESTAMP,
              version: RUN_REF.reference,
              commandId: `c30-link-entries-${input.suffix}`,
              idempotencyKey: `c30-link-entries-${input.suffix}`,
            },
            events: [],
          };
        },
      );
    };

    // 替身按绑定上下文回放；本组结束必须复原，否则后续用例会拿到错分支上下文。
    afterEach(() => {
      fixture.access.setAuthorization(undefined);
    });

    it("重评运行按已登记入口事实返回原因与变化集合，非重评运行返回空变化集合", async () => {
      fixture.access.setAuthorization(ENTRIES_AUTHORIZATION);
      await registerAssessmentRun({
        suffix: "reassess",
        runId: "risk-flow-run:entries-reassess",
        recordRef: currentRecord,
        entryMode: "reassess",
        reassessmentEntry: {
          previousAssessmentRecordRef: previousRecord,
          reason: "monitoring-snapshot",
          changedInputRefs: [previousRecord],
        },
      });
      const assessRecord = {
        kind: "risk-assessment-record" as const,
        reference: { entityId: "assessment-entries-assess", versionId: "1" },
      };
      await registerAssessmentRun({
        suffix: "assess",
        runId: "risk-flow-run:entries-assess",
        recordRef: assessRecord,
        entryMode: "assess",
      });

      const result = await fixture.adapter.entriesRead.readAssessmentEntriesForRecords(
        readInput([currentRecord, assessRecord]),
      );
      expect(result).toMatchObject({ kind: "succeeded" });
      if (result.kind !== "succeeded") return;
      expect(result.entries).toEqual([
        {
          assessmentRecordRef: currentRecord,
          runRef: {
            kind: "workflow-run",
            reference: {
              entityId: "risk-flow-run:entries-reassess",
              versionId: sha("entries-run-version:reassess"),
            },
          },
          entryMode: "reassess",
          previousAssessmentRecordRef: previousRecord,
          reason: "monitoring-snapshot",
          changedInputRefs: [previousRecord],
        },
        {
          assessmentRecordRef: assessRecord,
          runRef: {
            kind: "workflow-run",
            reference: {
              entityId: "risk-flow-run:entries-assess",
              versionId: sha("entries-run-version:assess"),
            },
          },
          entryMode: "assess",
          changedInputRefs: [],
        },
      ]);
    });

    it("重评元数据缺失、目标无链边、授权撤销与空输入一律失败闭合", async () => {
      fixture.access.setAuthorization(ENTRIES_AUTHORIZATION);
      // 入口事实缺席：历史工件可读，但不得据此编造原因。
      await registerAssessmentRun({
        suffix: "reassess-missing",
        runId: "risk-flow-run:entries-reassess-missing",
        recordRef: {
          kind: "risk-assessment-record",
          reference: { entityId: "assessment-entries-missing", versionId: "1" },
        },
        entryMode: "reassess",
      });
      expect(
        await fixture.adapter.entriesRead.readAssessmentEntriesForRecords(
          readInput([
            {
              kind: "risk-assessment-record",
              reference: { entityId: "assessment-entries-missing", versionId: "1" },
            },
          ]),
        ),
      ).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });

      // 目标不在本工程获准链边内：与不存在不可区分。
      expect(
        await fixture.adapter.entriesRead.readAssessmentEntriesForRecords(
          readInput([
            {
              kind: "risk-assessment-record",
              reference: { entityId: "assessment-entries-unlinked", versionId: "1" },
            },
          ]),
        ),
      ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });

      expect(
        await fixture.adapter.entriesRead.readAssessmentEntriesForRecords(readInput([])),
      ).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });

      await registerAssessmentRun({
        suffix: "reassess-ok",
        runId: "risk-flow-run:entries-reassess-ok",
        recordRef: {
          kind: "risk-assessment-record",
          reference: { entityId: "assessment-entries-ok", versionId: "1" },
        },
        entryMode: "reassess",
        reassessmentEntry: {
          previousAssessmentRecordRef: previousRecord,
          reason: "applicability-metadata",
          changedInputRefs: [previousRecord],
        },
      });
      const okRef = {
        kind: "risk-assessment-record" as const,
        reference: { entityId: "assessment-entries-ok", versionId: "1" },
      };
      fixture.access.revoke();
      expect(
        await fixture.adapter.entriesRead.readAssessmentEntriesForRecords(readInput([okRef])),
      ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
      fixture.access.restore();
      expect(
        await fixture.adapter.entriesRead.readAssessmentEntriesForRecords(readInput([okRef])),
      ).toMatchObject({ kind: "succeeded" });
    });
  });

  describe("D-04 运行投影窄读", () => {
    const RUN_AUTHORIZATION = authorizationFor({ grantedCapabilities: ["projection.query"] });
    const GRAPH_VERSION = { entityId: "risk-flow-graph", versionId: "graph-v1" };
    const childStages = (runId: string) =>
      ["A0", "A5", "A9"].map((stage) => ({
        stage,
        versionId: sha(`run-read-stage:${runId}:${stage}`),
      }));

    afterEach(() => {
      fixture.access.setAuthorization(undefined);
    });

    /** 登记一个运行：入口行、阶段结果行、精确 run-state 工件（可选父子链边）。 */
    const registerRun = async (input: {
      readonly suffix: string;
      readonly runId: string;
      readonly stages: readonly { readonly stage: string; readonly versionId: string }[];
      readonly assessmentRunRefs?: readonly WorkflowRunRefV1[];
      readonly parentRunId?: string;
      readonly omitGraphVersion?: boolean;
    }) => {
      const runVersionId = sha(`run-read-version:${input.suffix}`);
      const runRef = {
        kind: "workflow-run" as const,
        reference: { entityId: input.runId, versionId: runVersionId },
      };
      const entryIdentity = {
        entityId: `workflow-entry:${PROJECT_ID}:${input.suffix}`,
        versionId: sha(`run-read-entry:${input.suffix}`),
      };
      await registerWithinTransaction({
        row: {
          ...resultRowFor("entry-snapshot", input.suffix),
          runId: input.runId,
          runVersionId,
          resultId: `entry-snapshot:${input.runId}:1`,
          resultVersionId: "1",
          entryIdentity,
        },
      });
      for (const stage of input.stages) {
        await registerWithinTransaction({
          row: {
            ...resultRowFor("stage-result", `${input.suffix}:${stage.stage}`),
            runId: input.runId,
            runVersionId,
            resultId: `stage-result:${input.runId}:${stage.stage}`,
            resultVersionId: stage.versionId,
            stage: stage.stage as WorkflowGraphResultRowV1["stage"],
            stageResultRef: {
              kind: "stage-result",
              reference: {
                entityId: `stage-result:${input.runId}:${stage.stage}`,
                versionId: stage.versionId,
              },
            },
          },
        });
      }
      const artifactRef = await fixture.adapter.bodies.putBody({
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        commandId: `c30-body-run-read-${input.suffix}`,
        invocationId: `c30-body-run-read-${input.suffix}`,
        issuedAt: TIMESTAMP,
        artifactId: `c30-run-state:${input.runId}:${runVersionId}`,
        authorization: RUN_AUTHORIZATION,
        body: {
          bodyKind: "run-state",
          runState: WorkflowGraphRunStateV1Schema.parse({
            schemaVersion: "1",
            projectId: PROJECT_ID,
            runId: input.runId,
            runVersionId,
            entryMode: "identify-and-assess",
            entryIdentity,
            stage: "assessment",
            status: "completed",
            ...(input.omitGraphVersion ? {} : { graphVersion: GRAPH_VERSION }),
            assessmentRunRefs: input.assessmentRunRefs ?? [],
            acceptedRiskRecordRefs: [RISK_RECORD_REF],
            assessmentRecordRefs: [],
            warningRecordRefs: [],
            responseRecommendationRefs: [],
            deviationRecordRefs: [],
            calibrationSuggestionRefs: [],
            recordedAt: TIMESTAMP,
          }),
        },
      });
      await registerWithinTransaction({
        row: {
          ...resultRowFor("run-state", input.suffix),
          runId: input.runId,
          runVersionId,
          resultVersionId: runVersionId,
          resultId: artifactRef.reference.entityId,
          artifactRef,
        },
      });
      if (input.parentRunId !== undefined) {
        const linkId = sha(`run-read-link:${input.suffix}`);
        await fixture.transactionUnit.execute(
          {
            projectId: PROJECT_ID,
            commandKind: "workflow.register-link",
            commandId: `c30-link-run-read-${input.suffix}`,
            idempotencyKey: `c30-link-run-read-${input.suffix}`,
            payload: { linkId },
            actorRef: ACTOR_ID,
            authorizationContextRef: RUN_AUTHORIZATION.authorizationContextRef,
            issuedAt: TIMESTAMP,
            runId: input.runId,
          },
          async (context) => {
            await fixture.adapter.registrationStore.registerLink(
              {
                link: {
                  schemaVersion: "1",
                  projectId: PROJECT_ID,
                  linkId,
                  runId: input.runId,
                  fromRef: {
                    kind: "workflow-run",
                    reference: { entityId: input.parentRunId!, versionId: "1" },
                  },
                  toRef: runRef,
                  relation: "parent-child",
                  sourceStage: "assessment" as const,
                  authorizationContextRef: RUN_AUTHORIZATION.authorizationContextRef,
                  authorizationScopeDigest: SCOPE_DIGEST,
                  actorRef: ACTOR_ID,
                  recordedAt: TIMESTAMP,
                  auditEntryId: `c30-link-run-read-${input.suffix}:audit`,
                },
              },
              context,
            );
            return {
              resultRef: RUN_REF,
              audit: {
                auditEntryId: `c30-link-run-read-${input.suffix}:audit`,
                projectId: PROJECT_ID,
                action: "workflow.register-link",
                targetRef: RUN_REF,
                actorRef: ACTOR_ID,
                authorizationContextRef: RUN_AUTHORIZATION.authorizationContextRef,
                occurredAt: TIMESTAMP,
                recordedAt: TIMESTAMP,
                version: RUN_REF.reference,
                commandId: `c30-link-run-read-${input.suffix}`,
                idempotencyKey: `c30-link-run-read-${input.suffix}`,
              },
              events: [],
            };
          },
        );
      }
      return runRef;
    };

    const read = (workflowRunRef: WorkflowRunRefV1, assessmentRunRef?: WorkflowRunRefV1) =>
      fixture.adapter.runRead.readAssessmentRun({
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: RUN_AUTHORIZATION,
        workflowRunRef,
        ...(assessmentRunRef === undefined ? {} : { assessmentRunRef }),
      });

    it("评估子运行直接呈现其阶段，父运行只在唯一子运行时自动选中", async () => {
      fixture.access.setAuthorization(RUN_AUTHORIZATION);
      const childAId = "risk-flow-run:run-read-child-a";
      const childBId = "risk-flow-run:run-read-child-b";
      const parentId = "risk-flow-run:run-read-parent";
      const childA = await registerRun({
        suffix: "child-a",
        runId: childAId,
        stages: childStages(childAId),
        parentRunId: parentId,
      });
      const childB = await registerRun({
        suffix: "child-b",
        runId: childBId,
        stages: childStages(childBId),
        parentRunId: parentId,
      });

      // 目标为评估子运行：直接呈现该子运行已登记的 A0/A5/A9 阶段。
      const childView = await read(childA);
      expect(childView).toMatchObject({ kind: "succeeded" });
      if (childView.kind !== "succeeded") return;
      expect(childView.projection).toMatchObject({
        runRef: childA,
        graphVersion: GRAPH_VERSION,
        stage: "assessment",
        status: "completed",
        stages: [
          { stageCode: "A0", state: "A0" },
          { stageCode: "A5", state: "A5" },
          { stageCode: "A9", state: "A9" },
        ],
      });
      expect(childView.projection.stages.every((item) => item.stageResultRef !== undefined)).toBe(
        true,
      );
      // 子运行没有自己的子运行：不给选择，也不合成父阶段。
      expect(childView.projection.assessmentRunRefs).toEqual([]);
      expect(childView.projection.selectedAssessmentRunRef).toBeUndefined();

      // 父运行 + 唯一子运行：自动选中并呈现子运行阶段。
      const singleParentId = "risk-flow-run:run-read-parent-single";
      await registerRun({
        suffix: "child-single",
        runId: "risk-flow-run:run-read-child-single",
        stages: [],
        parentRunId: singleParentId,
      });
      const singleParent = await registerRun({
        suffix: "parent-single",
        runId: singleParentId,
        stages: [],
        assessmentRunRefs: [
          {
            kind: "workflow-run",
            reference: { entityId: "risk-flow-run:run-read-child-single", versionId: "1" },
          },
        ],
      });
      const singleView = await read(singleParent);
      expect(singleView).toMatchObject({ kind: "succeeded" });
      if (singleView.kind !== "succeeded") return;
      expect(singleView.projection.selectedAssessmentRunRef).toBeDefined();
      expect(singleView.projection.assessmentRunRefs).toHaveLength(1);

      // 父运行 + 多子运行且未选中：阶段留空交页面引导，不合成一条轨迹。
      const parent = await registerRun({
        suffix: "parent-multi",
        runId: parentId,
        stages: [],
        assessmentRunRefs: [childA, childB],
      });
      const multiView = await read(parent);
      expect(multiView).toMatchObject({ kind: "succeeded" });
      if (multiView.kind !== "succeeded") return;
      expect(multiView.projection.stages).toEqual([]);
      expect(multiView.projection.selectedAssessmentRunRef).toBeUndefined();
      expect(multiView.projection.assessmentRunRefs).toEqual([childA, childB]);

      // 显式选中其中一个子运行。
      const selected = await read(parent, childB);
      expect(selected).toMatchObject({ kind: "succeeded" });
      if (selected.kind !== "succeeded") return;
      expect(selected.projection.selectedAssessmentRunRef).toEqual(childB);
      expect(selected.projection.stages.map((item) => item.stageCode)).toEqual(["A0", "A5", "A9"]);
    });

    it("子运行归属、图版本缺失与授权撤销一律失败闭合", async () => {
      fixture.access.setAuthorization(RUN_AUTHORIZATION);
      const parentId = "risk-flow-run:run-read-guard-parent";
      const foreignChildId = "risk-flow-run:run-read-guard-child";
      const parent = await registerRun({
        suffix: "guard-parent",
        runId: parentId,
        stages: [],
        assessmentRunRefs: [
          { kind: "workflow-run", reference: { entityId: foreignChildId, versionId: "1" } },
        ],
      });

      // 声明了子运行但没有该父运行的 parent-child 链边：不认其自报的父字段。
      expect(
        await read(parent, {
          kind: "workflow-run",
          reference: { entityId: foreignChildId, versionId: "1" },
        }),
      ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });

      // 选中不属于该运行的子运行：与不存在不可区分。
      expect(
        await read(parent, {
          kind: "workflow-run",
          reference: { entityId: "risk-flow-run:absent", versionId: "1" },
        }),
      ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });

      // 目标运行未登记：同样按授权拒绝收口。
      expect(
        await read({
          kind: "workflow-run",
          reference: { entityId: "risk-flow-run:absent", versionId: "1" },
        }),
      ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });

      // 历史工件缺精确图版本：失败闭合，不用入口身份反推或编造。
      const legacyId = "risk-flow-run:run-read-legacy";
      const legacy = await registerRun({
        suffix: "legacy",
        runId: legacyId,
        stages: [],
        omitGraphVersion: true,
      });
      expect(await read(legacy)).toMatchObject({
        kind: "failed",
        error: { code: "BUSINESS_BLOCKED" },
      });

      fixture.access.revoke();
      expect(await read(parent)).toMatchObject({
        kind: "failed",
        error: { code: "AUTHORIZATION_DENIED" },
      });
      fixture.access.restore();
    });
  });

  it("registers links append-only and refuses relations outside the closed set", async () => {
    const link = {
      schemaVersion: "1" as const,
      projectId: PROJECT_ID,
      linkId: sha("link-1"),
      runId: RUN_ID,
      fromRef: RISK_RECORD_REF,
      toRef: STAGE_RESULT_REF,
      relation: "risk-assessment" as const,
      sourceStage: "A5" as const,
      stageResultRef: STAGE_RESULT_REF,
      authorizationContextRef: AUTHORIZATION.authorizationContextRef,
      authorizationScopeDigest: SCOPE_DIGEST,
      actorRef: ACTOR_ID,
      recordedAt: TIMESTAMP,
      auditEntryId: "c30-link-1:audit",
    };
    let linkOutcome: { readonly kind: string; readonly replayed?: boolean } = { kind: "unknown" };
    await fixture.transactionUnit.execute(
      {
        projectId: PROJECT_ID,
        commandKind: "workflow.register-link",
        commandId: "c30-link-1",
        idempotencyKey: "c30-link-1",
        payload: { linkId: link.linkId },
        actorRef: ACTOR_ID,
        authorizationContextRef: AUTHORIZATION.authorizationContextRef,
        issuedAt: TIMESTAMP,
        runId: RUN_ID,
      },
      async (context) => {
        const outcome = await fixture.adapter.registrationStore.registerLink({ link }, context);
        linkOutcome = outcome;
        return {
          resultRef: RUN_REF,
          audit: {
            auditEntryId: link.auditEntryId,
            projectId: PROJECT_ID,
            action: "workflow.register-link",
            targetRef: RUN_REF,
            actorRef: ACTOR_ID,
            authorizationContextRef: AUTHORIZATION.authorizationContextRef,
            occurredAt: TIMESTAMP,
            recordedAt: TIMESTAMP,
            version: RUN_REF.reference,
            commandId: "c30-link-1",
            idempotencyKey: "c30-link-1",
          },
          events: [],
        };
      },
    );
    expect(linkOutcome).toEqual({ kind: "registered", replayed: false });

    const stored = await fixture.adapter.registrationStore.listRunLinks({
      projectId: PROJECT_ID,
      runId: RUN_ID,
    });
    expect(stored.map((item) => item.relation)).toContain("risk-assessment");

    await expect(
      sql`
        INSERT INTO business.workflow_graph_links (
          project_id, link_id, run_id, from_ref, to_ref, relation, source_stage,
          authorization_context_ref, authorization_scope_digest, actor_ref, recorded_at, audit_entry_id
        ) VALUES (
          ${PROJECT_ID}, ${sha("link-2")}, ${RUN_ID}, ${JSON.stringify(RISK_RECORD_REF)}::jsonb,
          ${JSON.stringify(STAGE_RESULT_REF)}::jsonb, 'invented-relation', 'A5',
          ${JSON.stringify(AUTHORIZATION.authorizationContextRef)}::jsonb, ${SCOPE_DIGEST},
          ${ACTOR_ID}, clock_timestamp(), 'c30-fixture-link-2:audit'
        )
      `.execute(fixture.runtime.db),
    ).rejects.toThrowError();
  });

  it("registers a projection query once per query identity and replays it unchanged", async () => {
    const registration = {
      schemaVersion: "1" as const,
      projectId: PROJECT_ID,
      queryResultId: "query-result-c30:run-view",
      queryResultVersionId: sha("query-version-1"),
      queryType: "run-view",
      targetRef: RUN_REF,
      runId: RUN_ID,
      actorRef: ACTOR_ID,
      authorizationContextRef: AUTHORIZATION.authorizationContextRef,
      authorizationScopeDigest: SCOPE_DIGEST,
      requestedAt: TIMESTAMP,
      recordedAt: TIMESTAMP,
      persistedAt: TIMESTAMP,
      auditEntryId: "c30-query-run-view:audit",
    };
    const created = await fixture.adapter.registrationStore.registerQuery({ registration });
    expect(created).toEqual({ kind: "registered", replayed: false });
    const replay = await fixture.adapter.registrationStore.registerQuery({ registration });
    expect(replay).toEqual({ kind: "registered", replayed: true });

    const stored = await fixture.adapter.registrationStore.readQuery({
      projectId: PROJECT_ID,
      queryResultId: registration.queryResultId,
      queryResultVersionId: registration.queryResultVersionId,
    });
    expect(stored?.queryType).toBe("run-view");

    const conflicting = {
      ...registration,
      queryResultVersionId: sha("query-version-2"),
      targetRef: STAGE_RESULT_REF,
    };
    expect(
      await fixture.adapter.registrationStore.registerQuery({ registration: conflicting }),
    ).toMatchObject({ kind: "idempotency-conflict" });
  });

  it("freezes an optional spatial target on query registration and still reads legacy rows", async () => {
    const scoped = {
      schemaVersion: "1" as const,
      projectId: PROJECT_ID,
      queryResultId: "query-result-c31:risk-overview",
      queryResultVersionId: sha("query-version-scoped"),
      queryType: "risk-overview",
      targetRef: {
        kind: "project-revision" as const,
        reference: { entityId: "project-revision-c31", versionId: "v1" },
      },
      spatialScopeRef: SPATIAL_SCOPE_REF,
      actorRef: ACTOR_ID,
      authorizationContextRef: AUTHORIZATION.authorizationContextRef,
      authorizationScopeDigest: SCOPE_DIGEST,
      requestedAt: TIMESTAMP,
      recordedAt: TIMESTAMP,
      persistedAt: TIMESTAMP,
      auditEntryId: "c31-query-risk-overview:audit",
    };
    expect(await fixture.adapter.registrationStore.registerQuery({ registration: scoped })).toEqual(
      {
        kind: "registered",
        replayed: false,
      },
    );
    const storedScoped = await fixture.adapter.registrationStore.readQuery({
      projectId: PROJECT_ID,
      queryResultId: scoped.queryResultId,
      queryResultVersionId: scoped.queryResultVersionId,
    });
    expect(storedScoped?.spatialScopeRef).toEqual(SPATIAL_SCOPE_REF);
    expect(storedScoped?.queryType).toBe("risk-overview");

    const legacy = {
      ...scoped,
      queryResultId: "query-result-c31:legacy",
      queryResultVersionId: sha("query-version-legacy"),
      queryType: "run-view",
      targetRef: RUN_REF,
      runId: RUN_ID,
      auditEntryId: "c31-query-run-view-legacy:audit",
      spatialScopeRef: undefined,
    };
    await fixture.adapter.registrationStore.registerQuery({ registration: legacy as never });
    const storedLegacy = await fixture.adapter.registrationStore.readQuery({
      projectId: PROJECT_ID,
      queryResultId: legacy.queryResultId,
      queryResultVersionId: legacy.queryResultVersionId,
    });
    expect(storedLegacy?.spatialScopeRef).toBeUndefined();
    const legacyRow = await sql<{ spatial_scope_ref: unknown }>`
      SELECT spatial_scope_ref FROM business.workflow_query_results
      WHERE project_id = ${PROJECT_ID} AND query_result_id = ${legacy.queryResultId}
    `.execute(fixture.runtime.db);
    expect(legacyRow.rows).toEqual([{ spatial_scope_ref: null }]);
  });

  it("rejects concurrent overview registrations with one identity and different spatial targets", async () => {
    const queryResultId = "query-result-c31:concurrent-spatial";
    const first = {
      schemaVersion: "1" as const,
      projectId: PROJECT_ID,
      queryResultId,
      queryResultVersionId: sha("c31-concurrent-spatial-a"),
      queryType: "risk-overview" as const,
      targetRef: {
        kind: "project-revision" as const,
        reference: { entityId: "project-revision-c31", versionId: "v1" },
      },
      spatialScopeRef: SPATIAL_SCOPE_REF,
      actorRef: ACTOR_ID,
      authorizationContextRef: AUTHORIZATION.authorizationContextRef,
      authorizationScopeDigest: SCOPE_DIGEST,
      requestedAt: TIMESTAMP,
      recordedAt: TIMESTAMP,
      persistedAt: TIMESTAMP,
      auditEntryId: `${queryResultId}:audit`,
    };
    const second = {
      ...first,
      queryResultVersionId: sha("c31-concurrent-spatial-b"),
      spatialScopeRef: {
        kind: "spatial-scope" as const,
        reference: { entityId: "scope-c31-other", versionId: "v1" },
      },
    };
    const outcomes = await Promise.all(
      [first, second].map((registration) =>
        fixture.adapter.registrationStore.registerQuery({ registration }),
      ),
    );
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual([
      "idempotency-conflict",
      "registered",
    ]);
    const rows = await sql<{ query_result_version_id: string }>`
      SELECT query_result_version_id FROM business.workflow_query_results
      WHERE project_id = ${PROJECT_ID} AND query_result_id = ${queryResultId}
    `.execute(fixture.runtime.db);
    expect(rows.rows).toHaveLength(1);
    const winner = [first, second].find(
      (registration) => registration.queryResultVersionId === rows.rows[0]?.query_result_version_id,
    );
    expect(winner).toBeDefined();
    if (winner !== undefined) {
      expect(
        await fixture.adapter.registrationStore.readQuery({
          projectId: PROJECT_ID,
          queryResultId,
          queryResultVersionId: winner.queryResultVersionId,
        }),
      ).toMatchObject({ spatialScopeRef: winner.spatialScopeRef });
    }
  });

  it("adds and reverses the C31 spatial column and containment indexes idempotently", async () => {
    await graphTraceReportProjectionsMigration.down(fixture.migratorRuntime.db);
    const dropped = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'business' AND table_name = 'workflow_query_results'
        AND column_name = 'spatial_scope_ref'
    `.execute(fixture.migratorRuntime.db);
    expect(dropped.rows).toHaveLength(0);

    await graphTraceReportProjectionsMigration.up(fixture.migratorRuntime.db);
    await graphTraceReportProjectionsMigration.up(fixture.migratorRuntime.db);
    const indexes = await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'business'
        AND indexname IN (
          'workflow_graph_results_frozen_refs_gin',
          'workflow_graph_links_refs_gin'
        )
    `.execute(fixture.migratorRuntime.db);
    expect(indexes.rows.map((row) => row.indexname).sort()).toEqual([
      "workflow_graph_links_refs_gin",
      "workflow_graph_results_frozen_refs_gin",
    ]);
    const restored = await fixture.adapter.registrationStore.readQuery({
      projectId: PROJECT_ID,
      queryResultId: "query-result-c31:legacy",
      queryResultVersionId: sha("query-version-legacy"),
    });
    expect(restored?.spatialScopeRef).toBeUndefined();
  });

  it("keeps the application role append-only on every C30 table", async () => {
    for (const table of [
      "business.workflow_graph_results",
      "business.workflow_graph_links",
      "business.workflow_query_results",
    ]) {
      await expect(
        sql`UPDATE ${sql.table(table)} SET actor_ref = actor_ref WHERE project_id = ${PROJECT_ID}`.execute(
          fixture.runtime.db,
        ),
      ).rejects.toThrowError();
      await expect(
        sql`DELETE FROM ${sql.table(table)} WHERE project_id = ${PROJECT_ID}`.execute(
          fixture.runtime.db,
        ),
      ).rejects.toThrowError();
    }
  });

  it("re-enters up and reverses down without touching upstream history", async () => {
    const before = await fixture.adapter.registrationStore.listRunRows({
      projectId: PROJECT_ID,
      runId: RUN_ID,
    });
    await assessmentRiskflowGraphsMigration.up(fixture.migratorRuntime.db);
    const afterReentry = await fixture.adapter.registrationStore.listRunRows({
      projectId: PROJECT_ID,
      runId: RUN_ID,
    });
    expect(afterReentry.length).toBe(before.length);

    await assessmentRiskflowGraphsMigration.down(fixture.migratorRuntime.db);
    const tables = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'business'
        AND table_name IN ('workflow_graph_results', 'workflow_graph_links', 'workflow_query_results')
    `.execute(fixture.migratorRuntime.db);
    expect(tables.rows).toHaveLength(0);

    await assessmentRiskflowGraphsMigration.up(fixture.migratorRuntime.db);
    const restored = await fixture.adapter.registrationStore.listRunRows({
      projectId: PROJECT_ID,
      runId: RUN_ID,
    });
    expect(restored).toHaveLength(0);
  });

  /** 等待运行夹具：入口路由行 + 人工决定等待行 + 运行状态正文（与运行图登记形状一致）。 */
  const seedBindingRun = async (runId = BINDING_RUN_ID): Promise<void> => {
    const runTag = sha(runId).slice(0, 12);
    const entryRouteRef = bindingEntryRouteRefFor(runId);
    const rowBase = (suffix: string) => ({
      schemaVersion: "1" as const,
      projectId: PROJECT_ID,
      runId,
      runVersionId: BINDING_RUN_VERSION_ID,
      entryMode: "forecast-response" as const,
      commandId: `c30-binding-${runTag}-${suffix}`,
      idempotencyKey: `c30-binding-${runTag}-${suffix}`,
      requestDigest: sha(`binding-request-${suffix}`),
      actorRef: ACTOR_ID,
      authorizationContextRef: AUTHORIZATION.authorizationContextRef,
      authorizationScopeDigest: SCOPE_DIGEST,
      validAt: TIMESTAMP,
      recordedAt: TIMESTAMP,
      persistedAt: TIMESTAMP,
      auditEntryId: `c30-binding-${runTag}-${suffix}:audit`,
      frozenRefs: [...BINDING_FROZEN_REFS],
    });
    const artifactRef = await fixture.adapter.bodies.putBody({
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      commandId: `${runId}:body`,
      invocationId: `${runId}:body`,
      issuedAt: TIMESTAMP,
      artifactId: `c30-binding-run-state:${runId}:${BINDING_RUN_VERSION_ID}`,
      body: {
        bodyKind: "run-state",
        runState: WorkflowGraphRunStateV1Schema.parse({
          schemaVersion: "1",
          projectId: PROJECT_ID,
          runId,
          runVersionId: BINDING_RUN_VERSION_ID,
          entryMode: "forecast-response",
          entryIdentity: BINDING_ENTRY_IDENTITY,
          stage: "assessment",
          status: "waiting",
          assessmentRunRefs: [],
          acceptedRiskRecordRefs: [],
          assessmentRecordRefs: [],
          warningRecordRefs: [],
          responseRecommendationRefs: [],
          deviationRecordRefs: [],
          calibrationSuggestionRefs: [],
          recordedAt: TIMESTAMP,
        }),
      },
      authorization: AUTHORIZATION,
    });
    const rows: WorkflowGraphResultRowV1[] = [
      {
        ...rowBase("entry-route"),
        resultKind: "route-decision",
        resultId: entryRouteRef.reference.entityId,
        resultVersionId: entryRouteRef.reference.versionId,
        routeDecisionRef: entryRouteRef,
        routeKind: "entry-accepted",
      },
      {
        ...rowBase("human-decision-waiting"),
        resultKind: "waiting",
        // 等待行身份按运行限定：登记行主键不含 run_id，跨运行夹具必须自行区分。
        resultId: sha(`binding-waiting-${runTag}`),
        resultVersionId: sha(`binding-waiting-version-${runTag}`),
        stage: "preparing",
        waitingRef: {
          kind: "human-decision",
          routeDecisionRef: entryRouteRef,
          responseRecommendationRef: BINDING_RECOMMENDATION_REF,
          spatialScopeRef: SPATIAL_SCOPE_REF,
        },
      },
      {
        ...rowBase("run-state"),
        resultKind: "run-state",
        resultId: artifactRef.reference.entityId,
        resultVersionId: BINDING_RUN_VERSION_ID,
        stage: "assessment",
        artifactRef,
      },
    ];
    for (const row of rows) await registerWithinTransaction({ row });
  };

  const bindingQuery = (overrides: Record<string, unknown> = {}) =>
    ({
      kind: "verify-response-workflow-binding",
      queryId: BINDING_QUERY_ID,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      authorization: AUTHORIZATION,
      payload: {
        responseRecommendationRef: BINDING_RECOMMENDATION_REF,
        workflowRunRef: BINDING_RUN_REF,
      },
      ...overrides,
    }) as ResponseWorkflowBindingProofQueryV1;

  it("returns the exact binding for one already-verified authorization context", async () => {
    await seedBindingRun();
    const rows = await fixture.adapter.registrationStore.listRunRows({
      projectId: PROJECT_ID,
      runId: BINDING_RUN_ID,
    });
    const frozenKeys = [
      ...new Set(
        rows
          .flatMap((row) => row.frozenRefs)
          .map((ref) =>
            "reference" in ref
              ? `${ref.kind}/${ref.reference.entityId}/${ref.reference.versionId}`
              : `${ref.kind}/${ref.eventId}/${ref.eventVersion}`,
          ),
      ),
    ].sort();

    // 真实 C05 语义：该上下文只对 `queryId` 这一个 invocation_id 有效，内部不得再派生第二个身份。
    const callsBefore = fixture.access.calls.length;
    fixture.access.bindInvocationId(BINDING_QUERY_ID);
    const proof = await fixture.adapter.bindingProof.verifyResponseWorkflowBinding(bindingQuery());
    const newCalls = fixture.access.calls.slice(callsBefore);
    fixture.access.bindInvocationId(undefined);

    expect(newCalls).toEqual([{ invocationId: BINDING_QUERY_ID, branch: "workflow.start-run" }]);
    expect(proof).toMatchObject({
      kind: "succeeded",
      result: {
        kind: "bound",
        projectId: PROJECT_ID,
        responseRecommendationRef: BINDING_RECOMMENDATION_REF,
        spatialScopeRef: SPATIAL_SCOPE_REF,
        routeDecisionRef: BINDING_ENTRY_ROUTE_REF,
        workflowRunRef: BINDING_RUN_REF,
        runStatus: "waiting",
        auditTrailRef: {
          kind: "audit-trail",
          reference: {
            entityId: `c30-binding-${sha(BINDING_RUN_ID).slice(0, 12)}-entry-route:audit`,
            versionId: "v1",
          },
        },
      },
    });
    expect(proof.kind === "succeeded" ? proof.result.frozenDigest : undefined).toBe(
      sha256CanonicalJson(frozenKeys),
    );
  });

  it("keeps missing, unauthorized and mismatched facts indistinguishable", async () => {
    await seedBindingRun();
    const mismatched = await fixture.adapter.bindingProof.verifyResponseWorkflowBinding(
      bindingQuery({
        payload: {
          responseRecommendationRef: {
            kind: "response-recommendation",
            reference: { entityId: "recommendation-binding-other", versionId: "v1" },
          },
          workflowRunRef: BINDING_RUN_REF,
        },
      }),
    );
    const unknownRun = await fixture.adapter.bindingProof.verifyResponseWorkflowBinding(
      bindingQuery({
        payload: {
          responseRecommendationRef: BINDING_RECOMMENDATION_REF,
          workflowRunRef: {
            kind: "workflow-run",
            reference: { entityId: `${BINDING_RUN_ID}:absent`, versionId: sha("absent-run") },
          },
        },
      }),
    );
    fixture.access.revoke();
    const unauthorized =
      await fixture.adapter.bindingProof.verifyResponseWorkflowBinding(bindingQuery());
    fixture.access.restore();

    for (const result of [mismatched, unknownRun, unauthorized]) {
      expect(result).toMatchObject({
        kind: "failed",
        error: { code: "AUTHORIZATION_DENIED", category: "authorization", retryable: false },
      });
    }
    // 除调用方自己给出的运行身份外，三类失败的错误正文逐项相同（不可据此枚举目标）。
    const normalized = [mismatched, unknownRun, unauthorized].map((result) => ({
      ...result,
      error: { ...(result as { error: Record<string, unknown> }).error, causalRunId: "run" },
    }));
    expect(normalized[0]).toEqual(normalized[1]);
    expect(normalized[1]).toEqual(normalized[2]);
    // 证明只读：不新增登记行，也不写成功审计。
    const rows = await fixture.adapter.registrationStore.listRunRows({
      projectId: PROJECT_ID,
      runId: BINDING_RUN_ID,
    });
    expect(rows.filter((row) => row.resultKind === "waiting")).toHaveLength(1);
  });

  it("fails closed with a typed failure when the persisted binding contradicts itself", async () => {
    const tamperedRunId = `risk-flow-run:${PROJECT_ID}:binding-tampered`;
    await seedBindingRun();
    await seedBindingRun(tamperedRunId);
    // 把运行状态行指向另一运行的真实正文：引用可读、但正文自称的运行与登记行不符，必须稳定失败。
    const firstRunStateRow = (
      await fixture.adapter.registrationStore.listRunRows({
        projectId: PROJECT_ID,
        runId: BINDING_RUN_ID,
      })
    ).find((row) => row.resultKind === "run-state");
    await fixture.postgres.adminPool.query(
      "UPDATE business.workflow_graph_results SET artifact_ref = $1::jsonb WHERE project_id = $2 AND run_id = $3 AND result_kind = 'run-state'",
      [JSON.stringify(firstRunStateRow?.artifactRef), PROJECT_ID, tamperedRunId],
    );
    const tampered = await fixture.adapter.bindingProof.verifyResponseWorkflowBinding(
      bindingQuery({
        payload: {
          responseRecommendationRef: BINDING_RECOMMENDATION_REF,
          workflowRunRef: {
            kind: "workflow-run",
            reference: { entityId: tamperedRunId, versionId: sha("tampered-run") },
          },
        },
      }),
    );
    expect(tampered).toMatchObject({
      kind: "failed",
      error: { code: "TERMINAL_FAILURE", category: "technical", retryable: false },
    });

    // 查询本身不合法（未声明的判别值）：稳定契约失败，不做部分接受。
    const invalid = await fixture.adapter.bindingProof.verifyResponseWorkflowBinding({
      ...bindingQuery(),
      kind: "verify-unknown-proof",
    } as unknown as ResponseWorkflowBindingProofQueryV1);
    expect(invalid).toMatchObject({
      kind: "failed",
      error: { code: "UNSUPPORTED_CONTRACT", category: "technical", retryable: false },
    });
  });
});
