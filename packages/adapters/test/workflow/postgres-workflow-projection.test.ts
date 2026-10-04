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
  ProjectionResultReadPageV1Schema,
  ProjectionResultReadQueryResultV1Schema,
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
  /** 进程内重签发的签发身份对（design D6）：与 readBody 派生复验身份配对。 */
  const issues: { readonly invocationId: string; readonly branch: ModuleBranchV1 }[] = [];
  /** C06 重放绑定：`invocationId` → 首次绑定它的父上下文，用于复现真实冲突语义。 */
  const bodyReadBindings = new Map<string, string | undefined>();
  let revoked = false;
  let rotateVerifiedContext = false;
  const denied = () =>
    new AccessServiceError({
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
  return {
    calls,
    issues,
    port: {
      verify: async (input: {
        readonly authorizationContextRef: { readonly kind: "authorization-context" };
        readonly invocationId: string;
        readonly branch: ModuleBranchV1;
      }) => {
        calls.push({ invocationId: input.invocationId, branch: input.branch });
        if (revoked) {
          throw denied();
        }
        // 默认固定返回同一上下文，保持既有断言的稳定基线；开启 rotate 后每次复验签发新的
        // 上下文引用——与 C06 真实行为一致，也是正文读取身份必须随之变化的唯一前提。
        if (!rotateVerifiedContext) {
          return { context: AUTHORIZATION } as Awaited<ReturnType<LocalIdentityAccessV1["verify"]>>;
        }
        return {
          context: {
            ...AUTHORIZATION,
            authorizationContextRef: {
              kind: "authorization-context" as const,
              reference: { entityId: `verified-context-${calls.length}`, versionId: "1" },
            },
          },
        } as Awaited<ReturnType<LocalIdentityAccessV1["verify"]>>;
      },
      authorize: async (input: {
        readonly invocationId: string;
        readonly branch: ModuleBranchV1;
        readonly parentContext?: {
          readonly authorizationContextRef: { readonly entityId: string };
        };
      }) => {
        issues.push({ invocationId: input.invocationId, branch: input.branch });
        if (revoked) {
          throw denied();
        }
        // 按 C06 真实重放语义建模：同一 `invocationId` 必须始终对应同一父上下文，
        // 否则 `IDEMPOTENCY_CONFLICT`。替身若无条件放行，固定派生的正文读取身份就会
        // 掩盖「同一工件第二次起必然冲突」这一缺陷（design D1）。
        const parentId = input.parentContext?.authorizationContextRef.entityId;
        const bound = bodyReadBindings.get(input.invocationId);
        if (bound !== undefined && bound !== parentId) {
          throw denied();
        }
        bodyReadBindings.set(input.invocationId, parentId);
        return {
          context: AUTHORIZATION,
          contextRef: AUTHORIZATION.authorizationContextRef,
          redacted: false,
        } as Awaited<ReturnType<LocalIdentityAccessV1["authorize"]>>;
      },
    } satisfies Pick<LocalIdentityAccessV1, "verify" | "authorize">,
    /** 开启后每次复验签发新的授权上下文引用；返回关闭句柄，作用域限于调用方自己。 */
    rotateVerifiedContexts: () => {
      rotateVerifiedContext = true;
      return () => {
        rotateVerifiedContext = false;
      };
    },
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
    /** 每次 readBatch 收到的复验身份对，用于锁定"透传当前调用身份对"语义。 */
    invocations: { readonly invocationId: string; readonly branch: string }[];
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
    const trace: ProjectionTestFixture["trace"] = {
      calls: 0,
      invocations: [],
      override: undefined,
    };
    const projection = createPostgresWorkflowProjection({
      db: runtime.db,
      registrationStore: workflow.registrationStore,
      bodies: workflow.bodies,
      authorization: access.port,
      riskRecordTrace: {
        readBatch: async (input) => {
          trace.calls += 1;
          trace.invocations.push({ invocationId: input.invocationId, branch: input.branch });
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
  // 复验身份字段：HTTP 签发以信封 queryId 为 invocationId，本夹具用可断言的派生值。
  queryId: `read-page:${input.queryResultRef.reference.entityId}`,
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
    // 复验身份锁定：query 与 readPage 都以当前调用的领域 queryId 复验，且 branch 与调用入口的
    // 路由 branch 一一对应（query → projection.query，readPage → projection.result-read）。
    expect(
      fixture.access.calls.some(
        (call) => call.invocationId === "query-run-view" && call.branch === "projection.query",
      ),
    ).toBe(true);
    expect(
      fixture.access.calls.some(
        (call) =>
          call.invocationId === `read-page:${queryResultRef.reference.entityId}` &&
          call.branch === "projection.result-read",
      ),
    ).toBe(true);
    // 正文读取身份锁定（design D1）：run-state 正文读取前以 body-read 派生身份进程内重签发，
    // 签发 branch 与 readBody 复验由签发能力派生的 branch 配对（projection.query）；身份必须
    // 追加本次读取所依据的授权上下文，否则同一工件的第二次读取会与第一次争抢同一身份。
    const bodyReadPrefix = `c30-body-read:${PROJECT_ID}:c30-run-state:${ROOT_RUN_ID}:${ROOT_RUN_VERSION_ID}:`;
    const bodyReadIssues = fixture.access.issues.filter(
      (issue) =>
        issue.invocationId.startsWith(bodyReadPrefix) && issue.branch === "projection.query",
    );
    expect(bodyReadIssues.length).toBeGreaterThan(0);
    // 每个签发身份都带一个非空父上下文后缀。同一 (工件, 父上下文) 的重复签发共用同一身份
    // 是正确的——C06 重放路径据此返回既有上下文；本测试真正锁住的是多次读取都不失败。
    expect(bodyReadIssues.every((issue) => issue.invocationId.length > bodyReadPrefix.length)).toBe(
      true,
    );
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

  it("reads the same run body repeatedly when each read re-verifies its own context", async () => {
    // 缺陷回归（design D1）：投影端口每次读取都以本次 `queryId` 复验出**新的**父授权上下文。
    // 若正文读取身份只按 operation+工程+工件派生，第二次读取会与第一次争抢同一个
    // `invocation_id`，在 C06 重放比对处抛 `IDEMPOTENCY_CONFLICT` 并以 incomplete 收口。
    // 本用例开启替身的上下文轮转，使该冲突真实可复现；旧实现下第二次读取必然失败。
    await seedRuns();
    const stopRotating = fixture.access.rotateVerifiedContexts();
    const queried = await queryFor("query-run-view-repeat", {
      queryType: "run-view",
      workflowRunRef: {
        kind: "workflow-run",
        reference: { entityId: ROOT_RUN_ID, versionId: ROOT_RUN_VERSION_ID },
      },
    });
    expect(queried.kind).toBe("succeeded");
    if (queried.kind !== "succeeded") return;
    const queryResultRef = queried.result.queryResultRef;

    const rotated = new Set<string>();
    const collect = () => {
      const prefix = `c30-body-read:${PROJECT_ID}:c30-run-state:${ROOT_RUN_ID}:${ROOT_RUN_VERSION_ID}:`;
      for (const issue of fixture.access.issues) {
        if (issue.invocationId.startsWith(`${prefix}verified-context-`)) {
          rotated.add(issue.invocationId);
        }
      }
    };

    try {
      const first = await fixture.projection.resultRead.readPage(
        readRequest({ queryResultRef, limit: 100 }),
      );
      expect(first.kind).toBe("page");
      collect();

      // 同一登记结果被再次读取：每次都是独立读取，不是同一次调用的重放。
      const second = await fixture.projection.resultRead.readPage(
        readRequest({ queryResultRef, limit: 100 }),
      );
      expect(second.kind, `重复读取应成功，实际 ${JSON.stringify(second)}`).toBe("page");
      collect();

      if (first.kind !== "page" || second.kind !== "page") return;
      expect(second.items).toEqual(first.items);
      // 两次读取的父上下文不同，正文读取身份必须随之不同，不得共用同一个 `invocation_id`。
      expect(
        rotated.size,
        `正文读取身份应随父上下文变化，实际 ${[...rotated]}`,
      ).toBeGreaterThanOrEqual(2);
    } finally {
      stopRotating();
    }
  });

  it("serves the C32 result-read transport mapping with schema-valid page and failure outcomes", async () => {
    // 与 C32 HTTP 接线（apps/api invokeProjectionResultRead）同形：limit 缺省 50、无游标。
    await seedRuns();
    const queried = await queryFor("query-run-view-c32", {
      queryType: "run-view",
      workflowRunRef: {
        kind: "workflow-run",
        reference: { entityId: ROOT_RUN_ID, versionId: ROOT_RUN_VERSION_ID },
      },
    });
    expect(queried.kind).toBe("succeeded");
    if (queried.kind !== "succeeded") return;

    const page = await fixture.projection.resultRead.readPage(
      readRequest({ queryResultRef: queried.result.queryResultRef, limit: 50 }),
    );
    expect(ProjectionResultReadPageV1Schema.safeParse(page).success).toBe(true);

    const missing = await fixture.projection.resultRead.readPage(
      readRequest({
        queryResultRef: {
          kind: "query-result",
          reference: { entityId: "query-result:c32-absent", versionId: "absent" },
        },
        limit: 50,
      }),
    );
    expect(missing.kind).toBe("failed");
    // 失败判别必须能包成 C32 传输信封的 moduleResult，不扩散新错误码。
    const wrapped =
      missing.kind === "failed"
        ? { kind: "failed" as const, error: missing.error }
        : { kind: "succeeded" as const, result: missing };
    expect(ProjectionResultReadQueryResultV1Schema.safeParse(wrapped).success).toBe(true);
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
    // C22 嵌套读也必须用同一次 readPage 的领域身份对复验（含 result-read 路由 branch），
    // 不再自造 `c22-risk-record-trace:*`。
    expect(fixture.trace.invocations).toContainEqual({
      invocationId: `read-page:${queried.result.queryResultRef.reference.entityId}`,
      branch: "projection.result-read",
    });

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
      auditTrailRef: {
        reference: {
          entityId: rowBase(REPORT_RUN_ID, REPORT_RUN_VERSION_ID, "c31-report-state").auditEntryId,
        },
      },
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
    // 正文读取身份锁定（design D1）：结果正文读取前以 body-read 派生身份进程内重签发，
    // 签发 branch 与 readBody 复验由签发能力派生的 branch 配对（projection.query）；身份追加
    // 本次读取所依据的授权上下文后缀，使不同父上下文不共用同一身份。
    expect(
      fixture.access.issues.some(
        (issue) =>
          issue.invocationId.startsWith(
            `c30-body-read:${PROJECT_ID}:c31-run-result:${REPORT_RUN_ID}:${REPORT_RUN_VERSION_ID}:`,
          ) && issue.branch === "projection.query",
      ),
    ).toBe(true);

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
    // query 入口的嵌套 C22 读使用 projection.query 侧身份对（与 query 复验同一入口）。
    expect(fixture.trace.invocations).toContainEqual({
      invocationId: "query-association-graph",
      branch: "projection.query",
    });

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

    // C22 只确认记录来源、没有给出证据定位时，不从来源段列表猜一个定位。
    fixture.trace.override = {
      kind: "succeeded",
      items: [
        {
          kind: "found",
          riskRecordRef: RISK_RECORD_REF as StandardizedRiskRecordRefV1,
          processNodeId: "process-node-1",
          sourceSegmentIds: ["segment-1"],
          riskMechanismEntryIds: ["mechanism-1"],
          auditTrailRef: {
            kind: "audit-trail",
            reference: { entityId: "audit-risk-record", versionId: "1" },
          },
        },
      ],
    };
    const withoutLocator = await fixture.projection.resultRead.readPage(
      readRequest({ queryResultRef, limit: 50 }),
    );
    fixture.trace.override = undefined;
    expect(withoutLocator.kind).toBe("page");
    if (withoutLocator.kind === "page") {
      const riskLink = withoutLocator.items.find(
        (item) => item.kind === "trace-link" && item.relation === "risk-assessment",
      );
      expect(riskLink).not.toHaveProperty("evidenceLocator");
    }

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

  it("never reverifies with a self-derived identity on the query/readPage paths", () => {
    // 全文件回归锁：复验身份必须是调用方给出的领域标识；这里只禁绝本 change 移除的
    // 三个自造前缀（夹具自身的 `c30-projection-*` 命令身份是合法领域 commandId，不在此列）。
    for (const call of fixture.access.calls) {
      expect(call.invocationId.startsWith("c30-query:")).toBe(false);
      expect(call.invocationId.startsWith("c30-read-page:")).toBe(false);
      expect(call.invocationId.startsWith("c22-risk-record-trace:")).toBe(false);
    }
  });
});
