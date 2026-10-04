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
import type { TransactionUnitV1 } from "@riskflow/core/persistence";
import {
  AuthorizationContextV1Schema,
  ModuleErrorV1Schema,
  type AuthorizationContextV1,
  type HumanDecisionProofPortV1,
  type HumanDecisionProofQueryV1,
  type ModuleBranchV1,
  type StartWorkflowRunCommandV1,
} from "@riskflow/contracts/ports";
import {
  evaluateWorkflowEntryGate,
  workflowEntryIdentityFor,
  workflowRunIdentityFor,
} from "@riskflow/core/workflow";

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
const RECOMMENDATION_REF = {
  kind: "response-recommendation" as const,
  reference: { entityId: "recommendation-composition", versionId: "v1" },
};
const BASIS_RELEASE_SET_REF = {
  kind: "assessment-basis-release-set" as const,
  reference: { entityId: "basis-composition", versionId: "v1" },
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
  "humanDecisionProof",
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

/** C41 人工采纳证明替身：记录每次核对请求并固定失败关闭；成功推进由 IP-2 运行时用例覆盖。 */
interface HumanDecisionProofStubV1 {
  readonly port: HumanDecisionProofPortV1;
  readonly queries: HumanDecisionProofQueryV1[];
}

const createHumanDecisionProofStub = (): HumanDecisionProofStubV1 => {
  const queries: HumanDecisionProofQueryV1[] = [];
  const port: HumanDecisionProofPortV1 = {
    verifyHumanDecisionCommitted: async (query) => {
      queries.push(query);
      return {
        kind: "failed",
        error: ModuleErrorV1Schema.parse({
          code: "TERMINAL_FAILURE",
          category: "technical",
          retryable: false,
          stageCode: "c30-composition-test-proof",
          occurredAt: TIMESTAMP,
          causalRunId: query.projectId,
          diagnosticRef: {
            kind: "diagnostic-artifact",
            reference: { entityId: "human-decision-proof", versionId: "1" },
          },
        }),
      };
    },
  };
  return { port, queries };
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

/**
 * 合格入口载荷。给出 `suffix` 时按该后缀派生一组独立冻结引用，因此每个用例天然落在
 * 不同的运行分区，不会因为共享同一确定性运行身份而互相干扰；不给出时沿用模块级共享夹具。
 */
const readyPayload = (suffix?: string): StartWorkflowRunCommandV1["payload"] => {
  const scoped = <T extends { readonly reference: { readonly entityId: string } }>(base: T): T =>
    suffix === undefined
      ? base
      : {
          ...base,
          reference: { ...base.reference, entityId: `${base.reference.entityId}-${suffix}` },
        };
  const projectRevisionRef = scoped(PROJECT_REVISION_REF);
  const sourceVersionRef = scoped(SOURCE_VERSION_REF);
  const spaceRef = scoped(SPACE_REF);
  const applicabilityRef = scoped(APPLICABILITY_REF);
  const monitoringRef = scoped(MONITORING_REF);
  return {
    entryMode: "identify-and-assess",
    graphVersion: GRAPH_VERSION,
    retryPolicyRef: RETRY_POLICY_REF,
    projectRevisionRef,
    spatialScopeRefs: [spaceRef],
    sourceVersionRefs: [sourceVersionRef],
    assessmentContexts: [
      {
        spatialScopeRef: spaceRef,
        applicabilityMetadataSnapshotRef: applicabilityRef,
        monitoringSnapshotRefs: [monitoringRef],
      },
    ],
  };
};

interface CompositionFixtureV1 {
  readonly postgres: PostgresTestFixture;
  readonly runtime: PostgresRuntime;
  readonly transactionUnit: ReturnType<typeof createPostgresTransactionUnit>;
  readonly artifactStore: Awaited<ReturnType<typeof createArtifactStore>>;
  readonly checkpointer: PostgresCheckpointer;
  readonly access: ReturnType<typeof createAccessStub>;
  readonly humanDecisionProof: HumanDecisionProofStubV1;
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
    const humanDecisionProof = createHumanDecisionProofStub();
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
      humanDecisionProof,
      rootDirectory,
      options() {
        return {
          db: runtime.db,
          transactionUnit,
          artifactStore,
          authorization: access.port,
          runtimeAuthorization: runtimeAuthorizationPort,
          humanDecisionProof: humanDecisionProof.port,
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
  /** 公开命令的确定性运行引用：断言端与生产端共用同一门禁与身份函数，不硬编码身份字符串。 */
  const runIdOf = (command: StartWorkflowRunCommandV1): string => {
    const gate = evaluateWorkflowEntryGate(command.payload);
    if (gate.kind !== "ready") {
      throw new Error(`测试载荷未通过入口门禁：${gate.detailCode}`);
    }
    const entryIdentity = workflowEntryIdentityFor({
      entryMode: command.payload.entryMode,
      projectId: command.projectId,
      frozenRefs: gate.frozenRefs,
    });
    return workflowRunIdentityFor({
      projectId: command.projectId,
      entryMode: command.payload.entryMode,
      entryIdentity,
      graphVersion: command.payload.graphVersion,
    }).runRef.reference.entityId;
  };
  const countAudit = async (): Promise<number> => {
    const result = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit.entries WHERE project_id = $1",
      [PROJECT_ID],
    );
    return Number(result.rows[0]?.count ?? "0");
  };

  /**
   * 一次失败的事务单元：第一次 `execute` 抛可重试的基础设施失败，之后完全委托给真实单元。
   * 正文（C04）写入发生在登记事务之外，因此这正是“C04 已写、登记未成立、响应丢失”的边界：
   * 没有任何一行登记被提交，图却已经推进过。
   */
  const failOnceTransactionUnit = (): TransactionUnitV1 & { armed: boolean } => {
    const armed = { armed: true };
    return {
      get armed() {
        return armed.armed;
      },
      execute: async (command, handler, options) => {
        if (armed.armed) {
          armed.armed = false;
          throw new Error("injected registration outage");
        }
        return fixture.transactionUnit.execute(command, handler, options);
      },
    };
  };

  it("持久边界：入口登记提交失败后重试同一命令只补登记，不产生第二个运行", async () => {
    const command = startCommandFor({
      commandId: "c30-composition-bound-retry",
      payload: readyPayload("bound-retry"),
    });
    const runId = runIdOf(command);
    // 绑定事务先于图调用，但登记事务随后失败：调用方拿到失败响应，且没有任何登记行。
    const outage = failOnceTransactionUnit();
    const broken = createRiskFlowGraphComposition({
      ...fixture.options(),
      transactionUnit: outage,
    });
    const failed = await broken.runtime.workflowPort.startRun(command);
    expect(failed.kind).toBe("failed");
    expect(await broken.registrationStore.listRunRows({ projectId: PROJECT_ID, runId })).toEqual(
      [],
    );
    await broken.adapter.close?.().catch?.(() => undefined);

    // 依赖恢复后用原命令、原幂等键重试：继续启动同一运行，不新建运行、不重复绑定。
    const retry = await composition.runtime.workflowPort.startRun(command);
    expect(retry.kind).toBe("waiting");
    expect(retry.kind === "waiting" ? retry.workflowRunRef.reference.entityId : undefined).toBe(
      runId,
    );
    const restored = await composition.registrationStore.listRunRows({
      projectId: PROJECT_ID,
      runId,
    });
    expect(restored.filter((row) => row.resultKind === "entry-snapshot")).toHaveLength(1);
    // 绑定回执按幂等键复用，不因重试追加第二次绑定审计。
    const bindings = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit.entries WHERE project_id = $1 AND command_id = $2",
      [PROJECT_ID, command.commandId],
    );
    expect(Number(bindings.rows[0]?.count ?? "0")).toBe(1);
  }, 120_000);

  it("新 runtime 从同一数据库恢复既有运行，不重建也不丢已登记事实", async () => {
    const command = startCommandFor({
      commandId: "c30-composition-new-runtime",
      payload: readyPayload("new-runtime"),
    });
    const started = await composition.runtime.workflowPort.startRun(command);
    expect(started.kind).toBe("waiting");
    const runId = runIdOf(command);
    const before = await composition.registrationStore.listRunRows({
      projectId: PROJECT_ID,
      runId,
    });
    expect(before.length).toBeGreaterThan(0);

    // 用同一数据库重新组合一个全新 runtime：事实从登记面读回，不依赖前一个进程。
    const fresh = createRiskFlowGraphComposition(fixture.options());
    const latest = await fresh.registrationStore.readLatestRunState({
      projectId: PROJECT_ID,
      runId,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      invocationId: "risk-flow-cursor-read",
      authorization: authorizationFor("workflow.start"),
    });
    expect(latest?.state.status).toBe("waiting");
    expect(latest?.state.graphVersion).toEqual(GRAPH_VERSION);
    expect(await fresh.registrationStore.listRunRows({ projectId: PROJECT_ID, runId })).toEqual(
      before,
    );
  }, 120_000);

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
      invocationId: "risk-flow-cursor-read",
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

  it("等待模式的预测运行在人工采纳证明核对通过前保持等待，且不启动评估子运行", async () => {
    const command = startCommandFor({
      commandId: "c30-composition-forecast-wait",
      payload: {
        entryMode: "forecast-response",
        graphVersion: GRAPH_VERSION,
        retryPolicyRef: RETRY_POLICY_REF,
        adoptedRecommendationRef: RECOMMENDATION_REF,
        preActionMonitoringSnapshotRef: MONITORING_REF,
        assessmentBasisReleaseSetRef: BASIS_RELEASE_SET_REF,
        waitForDecision: true,
      },
    });
    const started = await composition.runtime.workflowPort.startRun(command);
    expect(started.kind).toBe("waiting");
    if (started.kind !== "waiting") return;
    expect(started.waiting.kind).toBe("human-decision");
    // 等待结果自带真实运行引用：与公共身份公式逐项一致，调用方无需自行派生。
    const entryIdentity = workflowEntryIdentityFor({
      entryMode: "forecast-response",
      projectId: PROJECT_ID,
      frozenRefs: [RECOMMENDATION_REF, MONITORING_REF, BASIS_RELEASE_SET_REF],
    });
    const { runRef } = workflowRunIdentityFor({
      projectId: PROJECT_ID,
      entryMode: "forecast-response",
      entryIdentity,
      graphVersion: GRAPH_VERSION,
    });
    expect(started.workflowRunRef).toEqual(runRef);

    const rows = await composition.registrationStore.listRunRows({
      projectId: PROJECT_ID,
      runId: runRef.reference.entityId,
    });
    const waitingRow = rows.find((row) => row.resultKind === "waiting");
    expect(waitingRow?.waitingRef).toMatchObject({
      kind: "human-decision",
      responseRecommendationRef: RECOMMENDATION_REF,
      spatialScopeRef: SPACE_REF,
    });
    if (waitingRow?.waitingRef?.kind !== "human-decision") {
      throw new TypeError("waiting row must carry the human decision reference");
    }
    // 决定路由引用就是本运行登记的入口路由引用（等待行的决定身份）。
    expect(
      rows.some(
        (row) =>
          row.resultKind === "route-decision" &&
          row.routeKind === "entry-accepted" &&
          row.routeDecisionRef?.reference.entityId ===
            waitingRow.waitingRef.routeDecisionRef.reference.entityId,
      ),
    ).toBe(true);
    // 等待态只登记等待与入口事实：没有评估子运行路由，评估子运行面从未被调用。
    expect(
      rows.filter(
        (row) => row.resultKind === "route-decision" && row.routeKind === "assessment-sub-run",
      ),
    ).toEqual([]);
    const latest = await composition.registrationStore.readLatestRunState({
      projectId: PROJECT_ID,
      runId: runRef.reference.entityId,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      invocationId: "risk-flow-cursor-read",
      authorization: authorizationFor("workflow.start"),
    });
    expect(latest?.state.status).toBe("waiting");
    // 等待态游标指向下一个要执行的阶段：恢复即进入评估，不重跑准备。
    expect(latest?.state.stage).toBe("assessment");

    // 注入的人工采纳证明被真实调用：固定失败关闭，运行保持等待且零评估动作。
    const denied = await composition.runtime.workflowPort.resumeRun({
      kind: "resume-run",
      commandId: "c30-composition-forecast-wait-resume",
      idempotencyKey: "c30-composition-forecast-wait-resume",
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      issuedAt: TIMESTAMP,
      authorization: authorizationFor("workflow.resume"),
      payload: {
        workflowRunRef: runRef,
        expectedStateVersion: latest?.state.runVersionId ?? "",
        resumeCause: {
          kind: "human-decision-committed",
          routeDecisionRef: waitingRow.waitingRef.routeDecisionRef,
        },
      },
    });
    expect(denied).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "human-decision-not-committed" },
    });
    expect(fixture.humanDecisionProof.queries).toHaveLength(1);
    expect(fixture.humanDecisionProof.queries[0]?.payload).toEqual({
      routeDecisionRef: waitingRow.waitingRef.routeDecisionRef,
      workflowRunRef: runRef,
      responseRecommendationRef: RECOMMENDATION_REF,
    });
    const afterDenied = await composition.registrationStore.readLatestRunState({
      projectId: PROJECT_ID,
      runId: runRef.reference.entityId,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      invocationId: "risk-flow-cursor-read",
      authorization: authorizationFor("workflow.resume"),
    });
    expect(afterDenied?.state.status).toBe("waiting");
    expect(
      (
        await composition.registrationStore.listRunRows({
          projectId: PROJECT_ID,
          runId: runRef.reference.entityId,
        })
      ).filter(
        (row) =>
          row.resultKind === "route-decision" && row.routeKind === "human-decision-committed",
      ),
    ).toEqual([]);
  }, 120_000);
});
