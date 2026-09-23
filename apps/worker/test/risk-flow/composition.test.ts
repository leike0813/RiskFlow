/**
 * 合成样本、待甲方复核：本文件全部工程、参与者、命令身份、摘要与工件正文均为合成夹具，
 * 不代表生产数据，也不得作为生产回退来源。
 *
 * C30 父运行生产组合根行为验证（IP-03，实施计划 §6 的构造期闭合与真实接线）：
 * 真实 Testcontainers PostgreSQL + 完整生产迁移链 + 真实 C03 事务单元 + 真实 C04 文件系统工件
 * 存储 + 真实 PostgreSQL checkpointer；只有 C24 识别子图运行面、评估子运行运行面、逐空间配对
 * 解析、冻结重试预算与 C05 授权复验用可控替身注入（生产中同为注入端口）。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessServiceError, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import type { ArtifactStorePolicyV1 } from "@riskflow/core/artifacts";
import {
  AuthorizationContextV1Schema,
  type AuthorizationContextV1,
  type ModuleBranchV1,
  type StartWorkflowRunCommandV1,
} from "@riskflow/contracts/ports";
import { workflowEntryIdentityFor, workflowRunIdentityFor } from "@riskflow/core/workflow";

import { createArtifactStore } from "@riskflow/adapters/artifacts";
import {
  createPostgresTransactionUnit,
  runPostgresMigrations,
  setupPostgresCheckpointer,
  type PostgresCheckpointer,
} from "@riskflow/adapters/postgres";

import {
  createPostgresRuntime,
  type PostgresRuntime,
} from "../../../../packages/adapters/dist/postgres/pool.js";
import {
  startPostgresFixture,
  type PostgresTestFixture,
} from "../../../../packages/adapters/test/postgres/fixture.js";
import {
  createRiskFlowGraphComposition,
  type RiskFlowGraphCompositionOptionsV1,
  type RiskFlowGraphCompositionV1,
} from "../../src/risk-flow/index.js";

const PROJECT_ID = "project-c30-composition";
const ACTOR_ID = "actor-c30-composition";
const TIMESTAMP = "2030-04-01T00:00:00.000Z";
const clock = {
  current: new Date(TIMESTAMP),
  now(): Date {
    this.current = new Date(this.current.getTime() + 1_000);
    return this.current;
  },
};
const PROJECT_REVISION_REF = {
  kind: "project-revision" as const,
  reference: { entityId: "revision-c30-composition", versionId: "v1" },
};
const SOURCE_VERSION_REF = {
  kind: "source-version" as const,
  reference: { entityId: "source-c30-composition", versionId: "v1" },
};
const SPACE_REF = {
  kind: "spatial-scope" as const,
  reference: { entityId: "spatial-scope-composition", versionId: "v1" },
};
const APPLICABILITY_REF = {
  kind: "applicability-metadata-snapshot" as const,
  reference: { entityId: "applicability-composition", versionId: "v1" },
};
const MONITORING_REF = {
  kind: "monitoring-snapshot" as const,
  reference: { entityId: "monitoring-composition", versionId: "v1" },
};
const GRAPH_VERSION = { entityId: "risk-flow-graph", versionId: "v1" };
const RETRY_POLICY_REF = { entityId: "retry-policy", versionId: "v1" };
const SUB_GRAPH_VERSIONS = {
  identification: { entityId: "identification-graph", versionId: "v1" },
  assessment: { entityId: "assessment-graph", versionId: "v1" },
} as const;

/** 组合根契约要求的全部必需依赖（`REQUIRED_DEPENDENCIES_V1`）：任一缺失即拒绝构造。 */
const REQUIRED_DEPENDENCIES_V1 = [
  "db",
  "transactionUnit",
  "artifactStore",
  "authorization",
  "runtimeAuthorization",
  "checkpointer",
  "identificationRuntime",
  "assessmentRuntime",
  "riskSpatialPairing",
  "retryPolicy",
  "subGraphVersions",
  "retryPolicyRef",
] as const;

const ARTIFACT_POLICY: ArtifactStorePolicyV1 = {
  schemaVersion: "1",
  policyRef: { entityId: "artifact-policy", versionId: "v1" },
  maxArtifactBytes: 64 * 1024 * 1024,
  maxConcurrentWrites: 4,
  maxConcurrentReads: 4,
  stagingMaxBytes: 128 * 1024 * 1024,
  orphanGracePeriodMs: 30_000,
  registrationTimeoutMs: 1_000,
  maintenanceBatchSize: 250,
};

const authorizationFor = (capability: string): AuthorizationContextV1 =>
  AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: {
      kind: "authorization-context",
      reference: { entityId: `authorization:${capability}`, versionId: "v1" },
    },
    actorId: ACTOR_ID,
    projectId: PROJECT_ID,
    grantedCapabilities: [capability],
    spatialScopeRefs: [SPACE_REF],
    sourceAccessGrantRefs: [],
    authorizationPolicyRef: { entityId: "authorization-policy", versionId: "v1" },
    decidedAt: TIMESTAMP,
    invocation: { kind: "human" },
  });

/** 分支 → 能力（`MODULE_BRANCH_CAPABILITY_V1` 的逆映射）：复验替身按请求分支回填能力。 */
const CAPABILITY_BY_BRANCH: Readonly<Record<string, string>> = {
  "workflow.start-run": "workflow.start",
  "workflow.resume-run": "workflow.resume",
  "workflow.cancel-run": "workflow.cancel",
};

/** C05 复验替身（适配器侧）：只按签发身份放行，撤销后一律拒绝。 */
const createAccessStub = (authorization: AuthorizationContextV1) => {
  let revoked = false;
  const port: Pick<LocalIdentityAccessV1, "verify"> = {
    verify: async (input) => {
      const capability = CAPABILITY_BY_BRANCH[input.branch];
      if (revoked || capability === undefined) {
        throw new AccessServiceError({
          code: "AUTHORIZATION_DENIED",
          retryable: false,
          stage: "c30-composition-test-verify",
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
      return {
        context: AuthorizationContextV1Schema.parse({
          ...authorization,
          grantedCapabilities: [capability],
          authorizationContextRef: input.authorizationContextRef,
        }),
      } as Awaited<ReturnType<LocalIdentityAccessV1["verify"]>>;
    },
  };
  return {
    port,
    revoke: () => {
      revoked = true;
    },
  };
};

/** C05 复验替身（运行入口）：撤销返回 `undefined`，否则回填原授权。 */
const runtimeAuthorizationPort = {
  verifyCurrent: async (input: {
    readonly authorization: AuthorizationContextV1;
    readonly branch: ModuleBranchV1;
  }) => input.authorization,
};

const startCommandFor = (input: {
  readonly commandId: string;
  readonly payload: StartWorkflowRunCommandV1["payload"];
}): StartWorkflowRunCommandV1 => ({
  kind: "start-run",
  commandId: input.commandId,
  idempotencyKey: input.commandId,
  projectId: PROJECT_ID,
  actorId: ACTOR_ID,
  issuedAt: TIMESTAMP,
  authorization: authorizationFor("workflow.start"),
  payload: input.payload,
});

const readyPayload = (): StartWorkflowRunCommandV1["payload"] => ({
  entryMode: "identify-and-assess",
  graphVersion: GRAPH_VERSION,
  retryPolicyRef: RETRY_POLICY_REF,
  projectRevisionRef: PROJECT_REVISION_REF,
  spatialScopeRefs: [SPACE_REF],
  sourceVersionRefs: [SOURCE_VERSION_REF],
  assessmentContexts: [
    {
      spatialScopeRef: SPACE_REF,
      applicabilityMetadataSnapshotRef: APPLICABILITY_REF,
      monitoringSnapshotRefs: [MONITORING_REF],
    },
  ],
});

interface CompositionFixtureV1 {
  readonly postgres: PostgresTestFixture;
  readonly runtime: PostgresRuntime;
  readonly transactionUnit: ReturnType<typeof createPostgresTransactionUnit>;
  readonly artifactStore: Awaited<ReturnType<typeof createArtifactStore>>;
  readonly checkpointer: PostgresCheckpointer;
  readonly access: ReturnType<typeof createAccessStub>;
  readonly rootDirectory: string;
  options(): RiskFlowGraphCompositionOptionsV1;
  close(): Promise<void>;
}

const startFixture = async (): Promise<CompositionFixtureV1> => {
  const postgres = await startPostgresFixture();
  try {
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
      additionalMigrationRoots: [postgres.fixtureMigrationRoot],
    });
    const runtime = createPostgresRuntime(postgres.app, "riskflow_app");
    const transactionUnit = createPostgresTransactionUnit(postgres.app);
    const rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c30-composition-"));
    const artifactStore = await createArtifactStore({
      ...postgres.app,
      rootDirectory,
      policy: ARTIFACT_POLICY,
    });
    const checkpointer = await setupPostgresCheckpointer({
      ...postgres.checkpointer,
      validateReference: () => true,
    });
    const access = createAccessStub(authorizationFor("workflow.start"));
    // 识别/评估子运行面与配对解析在构造期闭合用例中不会被调用；被调用即说明组合根接错端口。
    const unexpected = async (): Promise<never> => {
      throw new TypeError("composition test reached a port outside the exercised contract");
    };
    return {
      postgres,
      runtime,
      transactionUnit,
      artifactStore,
      checkpointer,
      access,
      rootDirectory,
      options() {
        return {
          db: runtime.db,
          transactionUnit,
          artifactStore,
          authorization: access.port,
          runtimeAuthorization: runtimeAuthorizationPort,
          checkpointer,
          identificationRuntime: { start: unexpected, resume: unexpected, cancel: unexpected },
          assessmentRuntime: { start: unexpected, resume: unexpected, cancel: unexpected },
          riskSpatialPairing: { resolve: async () => undefined },
          retryPolicy: { read: async () => undefined },
          subGraphVersions: SUB_GRAPH_VERSIONS,
          retryPolicyRef: RETRY_POLICY_REF,
          now: () => clock.now(),
        };
      },
      async close() {
        await checkpointer.end().catch(() => undefined);
        await artifactStore.close().catch(() => undefined);
        await transactionUnit.close().catch(() => undefined);
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

describe("C30 父运行生产组合根（真实 PostgreSQL 接线）", () => {
  let fixture: CompositionFixtureV1;
  let composition: RiskFlowGraphCompositionV1;

  beforeAll(async () => {
    fixture = await startFixture();
    composition = createRiskFlowGraphComposition(fixture.options());
  }, 300_000);

  afterAll(async () => {
    await fixture?.close().catch(() => undefined);
  }, 120_000);

  const countRows = async (): Promise<number> => {
    const result = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.workflow_graph_results WHERE project_id = $1",
      [PROJECT_ID],
    );
    return Number(result.rows[0]?.count ?? "0");
  };
  const countAudit = async (): Promise<number> => {
    const result = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit.entries WHERE project_id = $1",
      [PROJECT_ID],
    );
    return Number(result.rows[0]?.count ?? "0");
  };

  it("任一必需依赖缺失即抛 TypeError，且不产生半组合", () => {
    for (const dependency of REQUIRED_DEPENDENCIES_V1) {
      const options: Record<string, unknown> = { ...fixture.options() };
      delete options[dependency];
      expect(
        () => createRiskFlowGraphComposition(options as RiskFlowGraphCompositionOptionsV1),
        `missing dependency: ${dependency}`,
      ).toThrowError(TypeError);
    }
  });

  it("依赖齐全时返回登记的适配器/端口/图/运行时，且注入身份被原样使用", () => {
    const options = fixture.options();
    const built = createRiskFlowGraphComposition(options);
    expect(Object.keys(built).sort()).toEqual([
      "adapter",
      "graph",
      "ports",
      "registrationStore",
      "runtime",
    ]);
    expect(built.registrationStore).toBe(built.adapter.registrationStore);
    expect(built.ports.registrationStore).toBe(built.adapter.registrationStore);
    expect(built.ports.bodies).toBe(built.adapter.bodies);
    expect(built.ports.transactionUnit).toBe(options.transactionUnit);
    expect(built.ports.identificationRuntime).toBe(options.identificationRuntime);
    expect(built.ports.assessmentRuntime).toBe(options.assessmentRuntime);
    expect(built.ports.riskSpatialPairing).toBe(options.riskSpatialPairing);
    expect(built.ports.retryPolicy).toBe(options.retryPolicy);
    expect(built.ports.subGraphVersions).toBe(options.subGraphVersions);
    expect(built.ports.retryPolicyRef).toBe(options.retryPolicyRef);
    expect(built.ports.now).toBe(options.now);
    expect(typeof built.graph.invoke).toBe("function");
    expect(typeof built.runtime.workflowPort.startRun).toBe("function");
    expect(typeof built.runtime.workflowPort.resumeRun).toBe("function");
    expect(typeof built.runtime.workflowPort.cancelRun).toBe("function");
  });

  it("门禁不通过时 startRun 返回结构化失败且零业务补写", async () => {
    const rowsBefore = await countRows();
    const auditBefore = await countAudit();
    const failed = await composition.runtime.workflowPort.startRun(
      startCommandFor({
        commandId: "c30-composition-gate-failed",
        payload: {
          entryMode: "identify-and-assess",
          graphVersion: GRAPH_VERSION,
          retryPolicyRef: RETRY_POLICY_REF,
          projectRevisionRef: PROJECT_REVISION_REF,
          spatialScopeRefs: [SPACE_REF],
          sourceVersionRefs: [SOURCE_VERSION_REF],
        },
      }),
    );
    expect(failed).toMatchObject({
      kind: "failed",
      error: {
        code: "BUSINESS_BLOCKED",
        category: "business-blocked",
        retryable: false,
        blockerKind: "assessment-contexts-missing",
      },
    });
    expect(await countRows()).toBe(rowsBefore);
    expect(await countAudit()).toBe(auditBefore);
  }, 120_000);

  it("门禁通过时登记首版运行状态，重复命令按同一运行身份重放不增行", async () => {
    const command = startCommandFor({
      commandId: "c30-composition-gate-ready",
      payload: readyPayload(),
    });
    const started = await composition.runtime.workflowPort.startRun(command);
    // 识别准备尚未到达：父运行如实登记等待，不猜测结论。
    expect(started.kind).toBe("waiting");
    expect(started.kind === "waiting" ? started.waiting.kind : undefined).toBe(
      "knowledge-preparation",
    );

    // 运行身份由公共公式派生（生成端与断言端共用同一函数，不硬编码身份字符串）。
    const entryIdentity = workflowEntryIdentityFor({
      entryMode: "identify-and-assess",
      projectId: PROJECT_ID,
      frozenRefs: [
        PROJECT_REVISION_REF,
        SPACE_REF,
        SOURCE_VERSION_REF,
        APPLICABILITY_REF,
        MONITORING_REF,
      ],
    });
    const { runRef } = workflowRunIdentityFor({
      projectId: PROJECT_ID,
      entryMode: "identify-and-assess",
      entryIdentity,
      graphVersion: GRAPH_VERSION,
    });
    const latest = await composition.registrationStore.readLatestRunState({
      projectId: PROJECT_ID,
      runId: runRef.reference.entityId,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      authorization: authorizationFor("workflow.start"),
    });
    expect(latest?.state.status).toBe("waiting");
    expect(latest?.state.stage).toBe("identification");
    expect(latest?.state.lastWaitingRef?.kind).toBe("knowledge-preparation");
    expect(latest?.state.entryIdentity).toEqual(entryIdentity);

    const rowsAfterFirst = await countRows();
    const replay = await composition.runtime.workflowPort.startRun(command);
    expect(replay.kind).toBe("waiting");
    expect(await countRows()).toBe(rowsAfterFirst);
    const rows = await composition.registrationStore.listRunRows({
      projectId: PROJECT_ID,
      runId: runRef.reference.entityId,
    });
    // 两个不同的运行状态版本各一行：入口（识别进行中）与识别等待；重放不再增行。
    expect(rows.filter((row) => row.resultKind === "run-state")).toHaveLength(2);
    expect(rows.filter((row) => row.resultKind === "entry-snapshot")).toHaveLength(1);
    expect(
      new Set(rows.filter((row) => row.resultKind === "run-state").map((r) => r.resultVersionId))
        .size,
    ).toBe(2);
  }, 120_000);
});
