/**
 * 合成样本、待甲方复核：本文件全部工程、参与者、命令身份、摘要与工件正文均为合成夹具，
 * 不代表生产数据，也不得作为生产回退来源。
 *
 * C30 父运行图/运行时行为验证（IP-03，实施计划 §6 的 R1/S4、R2/S2、R4/S1～S3）：
 * 真实 Testcontainers PostgreSQL + 完整生产迁移链 + 真实 C03 事务单元 + 真实 C04 文件系统
 * 工件存储 + 真实 PostgreSQL checkpointer + C30 登记/正文适配器。只有 C24 识别子图运行面、
 * 评估子运行运行面、逐空间配对解析、冻结重试预算与 C05 授权复验用可控替身注入——这些在生产
 * 组合根里同样是注入端口（`apps/worker/src/risk-flow/composition.ts`）。
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessServiceError, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import type { ArtifactStorePolicyV1 } from "@riskflow/core/artifacts";
import {
  AuthorizationContextV1Schema,
  ModuleErrorV1Schema,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type HumanDecisionProofPortV1,
  type HumanDecisionProofQueryV1,
  type ModuleBranchV1,
  type StandardizedRiskRecordRefV1,
  type StartWorkflowRunCommandV1,
  type WaitingRefV1,
  type WorkflowEntryModeV1,
  type WorkflowRunRefV1,
  type WorkflowRunStatusV1,
} from "@riskflow/contracts/ports";
import {
  IdentificationGraphStateV1Schema,
  type IdentificationGraphStateV1,
} from "@riskflow/contracts/workflows";
import type {
  IdentificationGraphRunOutcomeV1,
  IdentificationGraphRuntimeV1,
  IdentificationGraphStartCommandV1,
} from "@riskflow/core/identification/graph";
import { sha256CanonicalJson } from "@riskflow/core/persistence";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";
import {
  WorkflowGraphRunStateV1Schema,
  workflowEntryIdentityFor,
  workflowRunIdentityFor,
  type WorkflowGraphBodyPortV1,
  type WorkflowGraphRegistrationStoreV1,
  type WorkflowGraphResultRowV1,
  type WorkflowGraphRunCommandV1,
  type WorkflowGraphRunOutcomeV1,
  type WorkflowGraphRunStateV1,
  type WorkflowGraphRuntimePortV1,
} from "@riskflow/core/workflow";

import { createArtifactStore } from "@riskflow/adapters/artifacts";
import {
  createPostgresTransactionUnit,
  runPostgresMigrations,
  setupPostgresCheckpointer,
  type PostgresCheckpointer,
} from "@riskflow/adapters/postgres";
import {
  createPostgresWorkflowAdapter,
  type PostgresWorkflowAdapterV1,
} from "@riskflow/adapters/workflow";

import {
  createPostgresRuntime,
  type PostgresRuntime,
} from "../../../../packages/adapters/dist/postgres/pool.js";
import {
  startPostgresFixture,
  type PostgresTestFixture,
} from "../../../../packages/adapters/test/postgres/fixture.js";
import {
  createRiskFlowGraph,
  createRiskFlowGraphRuntime,
  type RiskFlowGraphPortsV1,
  type RiskFlowGraphRunnerV1,
  type RiskFlowGraphRuntimeV1,
  type RiskFlowStartCommandV1,
  type RiskFlowAssessmentPairingV1,
  type RiskSpatialPairingResolverV1,
} from "../../src/risk-flow/index.js";

const PROJECT_ID = "project-c30-runtime";
const ACTOR_ID = "actor-c30-runtime";
const TIMESTAMP = "2030-03-01T00:00:00.000Z";
/**
 * 单调时钟：每次读取前进 1 秒。C30 的登记行以真实持久化时刻排序，固定时钟会让同一运行的
 * 多版运行状态时间戳相同、回读退化为按版本哈希排序，因此夹具必须提供可区分的时间序列。
 */
const clock = {
  current: new Date(TIMESTAMP),
  now(): Date {
    this.current = new Date(this.current.getTime() + 1_000);
    return this.current;
  },
};
const sha = (seed: string): string => createHash("sha256").update(seed).digest("hex");
const refKey = (ref: { readonly kind: string } & Record<string, unknown>): string =>
  sha(JSON.stringify(ref));

const PROJECT_REVISION_REF = {
  kind: "project-revision" as const,
  reference: { entityId: "revision-c30", versionId: "v1" },
};
const SOURCE_VERSION_REF = {
  kind: "source-version" as const,
  reference: { entityId: "source-c30", versionId: "v1" },
};
const SPACE_A = {
  kind: "spatial-scope" as const,
  reference: { entityId: "spatial-scope-a", versionId: "v1" },
};
const SPACE_B = {
  kind: "spatial-scope" as const,
  reference: { entityId: "spatial-scope-b", versionId: "v1" },
};
const APPLICABILITY_A = {
  kind: "applicability-metadata-snapshot" as const,
  reference: { entityId: "applicability-a", versionId: "v1" },
};
const APPLICABILITY_B = {
  kind: "applicability-metadata-snapshot" as const,
  reference: { entityId: "applicability-b", versionId: "v1" },
};
const MONITORING_A = {
  kind: "monitoring-snapshot" as const,
  reference: { entityId: "monitoring-a", versionId: "v1" },
};
const MONITORING_B = {
  kind: "monitoring-snapshot" as const,
  reference: { entityId: "monitoring-b", versionId: "v1" },
};
const PREPARATION_REF = {
  kind: "identification-preparation-snapshot" as const,
  reference: { entityId: "preparation-c30", versionId: "v1" },
};
const GRAPH_VERSION = { entityId: "risk-flow-graph", versionId: "v1" };
const RETRY_POLICY_REF = { entityId: "retry-policy", versionId: "v1" };
const SUB_GRAPH_VERSIONS = {
  identification: { entityId: "identification-graph", versionId: "v1" },
  assessment: { entityId: "assessment-graph", versionId: "v1" },
} as const;

const riskRecordRef = (name: string, version = "v1"): StandardizedRiskRecordRefV1 => ({
  kind: "standardized-risk-record",
  reference: { entityId: `risk-record-${name}`, versionId: version },
});

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

const authorizationFor = (
  capability: string,
  scopes: readonly {
    readonly kind: "spatial-scope";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }[],
): AuthorizationContextV1 =>
  AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: {
      kind: "authorization-context",
      reference: { entityId: `authorization:${capability}`, versionId: "v1" },
    },
    actorId: ACTOR_ID,
    projectId: PROJECT_ID,
    grantedCapabilities: [capability],
    spatialScopeRefs: [...scopes],
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

/** C05 复验替身（适配器侧）：只按签发身份放行，撤销后一律拒绝，并记录每次复验请求。 */
const createAccessStub = (authorization: AuthorizationContextV1) => {
  const calls: { readonly invocationId: string; readonly branch: ModuleBranchV1 }[] = [];
  let revoked = false;
  const port: Pick<LocalIdentityAccessV1, "verify"> = {
    verify: async (input) => {
      calls.push({ invocationId: input.invocationId, branch: input.branch });
      if (revoked) {
        throw new AccessServiceError({
          code: "AUTHORIZATION_DENIED",
          retryable: false,
          stage: "c30-runtime-test-verify",
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
      const capability = CAPABILITY_BY_BRANCH[input.branch];
      if (capability === undefined) {
        throw new AccessServiceError({
          code: "AUTHORIZATION_DENIED",
          retryable: false,
          stage: "c30-runtime-test-branch",
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
    calls,
    revoke: () => {
      revoked = true;
    },
  };
};

/** C05 复验替身（运行入口）：撤销或身份不符返回 `undefined`（运行入口按权限失败收口）。 */
const createRuntimeAuthorizationStub = () => {
  let revoked = false;
  const port = {
    verifyCurrent: async (input: { readonly authorization: AuthorizationContextV1 }) =>
      revoked ? undefined : input.authorization,
  };
  return {
    port,
    revoke: () => {
      revoked = true;
    },
    restore: () => {
      revoked = false;
    },
  };
};

/** C24 识别子图运行面替身：同一命令身份始终返回同一子运行，重复事件不产生第二个子运行。 */
const createIdentificationRuntimeStub = (options: {
  readonly acceptedRiskRecordRefs?: readonly StandardizedRiskRecordRefV1[];
  readonly reviewWaiting?: WaitingRefV1;
}) => {
  const commands: IdentificationGraphStartCommandV1[] = [];
  const runRefs = new Map<string, WorkflowRunRefV1>();
  let acceptedRiskRecordRefs: readonly StandardizedRiskRecordRefV1[] =
    options.acceptedRiskRecordRefs ?? [];
  let reviewWaiting: WaitingRefV1 | undefined = options.reviewWaiting;
  const runtime: IdentificationGraphRuntimeV1 = {
    start: async (command) => {
      commands.push(command);
      const runRef =
        runRefs.get(command.commandId) ??
        ({
          kind: "workflow-run",
          reference: {
            entityId: `identification-run:${sha(command.parentRiskFlowRunRef.reference.entityId).slice(0, 16)}`,
            versionId: sha(command.commandId),
          },
        } satisfies WorkflowRunRefV1);
      runRefs.set(command.commandId, runRef);
      const state: IdentificationGraphStateV1 = IdentificationGraphStateV1Schema.parse({
        schemaVersion: "1",
        graphVersion: command.graphVersion,
        parentRiskFlowRunRef: command.parentRiskFlowRunRef,
        runRef,
        threadId: `identification-run-thread:${sha(command.commandId).slice(0, 24)}`,
        triggerType: "manual",
        triggerReasonCode: command.triggerReasonCode,
        authorizationContextRef: command.authorization.authorizationContextRef,
        preparationSnapshotRef: command.preparationSnapshotRef,
        status: reviewWaiting === undefined ? "running" : "waiting",
        stage: "I5",
        agentTaskRefs: [],
        acceptedRiskRecordRefs: [...acceptedRiskRecordRefs],
        reviewTaskRefs: [],
        rejectedGroupRefs: [],
        failedWorkItemRefs: [],
        ...(reviewWaiting === undefined ? {} : { waitingRef: reviewWaiting }),
      });
      return {
        state,
        runVersionId: sha(
          `identification-run-version:${command.commandId}:${sha256CanonicalJson(acceptedRiskRecordRefs)}`,
        ),
        disposition: "created",
      } satisfies IdentificationGraphRunOutcomeV1;
    },
    resume: async () => {
      throw new TypeError("identification stub resume is outside this slice's evidence");
    },
    cancel: async () => {
      throw new TypeError("identification stub cancel is outside this slice's evidence");
    },
  };
  return {
    runtime,
    commands,
    setAcceptedRiskRecordRefs: (refs: readonly StandardizedRiskRecordRefV1[]) => {
      acceptedRiskRecordRefs = refs;
    },
    setReviewWaiting: (waiting: WaitingRefV1 | undefined) => {
      reviewWaiting = waiting;
    },
  };
};

/**
 * 评估子运行运行面替身（`WorkflowGraphRuntimePortV1`）：像真实子图运行时那样把**自己的**
 * 运行状态正文写入 C04、把登记行写进 C30 表，因此父运行读取的是真实可回读的子运行事实；
 * 子运行是否继续由本替身的状态决定，父运行侧断言点始终是登记行/链边/启动命令。
 */
const createAssessmentRuntimeStub = (deps: {
  readonly transactionUnit: { execute: (...args: never[]) => Promise<unknown> };
  readonly registrationStore: WorkflowGraphRegistrationStoreV1;
  readonly bodies: WorkflowGraphBodyPortV1;
}) => {
  const commands: WorkflowGraphRunCommandV1[] = [];
  const runVersions = new Map<string, string>();
  let status: WorkflowRunStatusV1 = "waiting";
  let waitingRef: WaitingRefV1 | undefined;
  const start = async (command: WorkflowGraphRunCommandV1): Promise<WorkflowGraphRunOutcomeV1> => {
    commands.push(command);
    const runVersionId =
      runVersions.get(command.commandId) ??
      sha(`assessment-run-version:${command.commandId}:${status}`);
    runVersions.set(command.commandId, runVersionId);
    const state: WorkflowGraphRunStateV1 = WorkflowGraphRunStateV1Schema.parse({
      schemaVersion: "1",
      projectId: command.projectId,
      runId: command.runRef.reference.entityId,
      runVersionId,
      entryMode: command.entryMode,
      entryIdentity: command.entryIdentity,
      stage: "A0",
      status,
      parentRunRef: command.parentRunRef,
      assessmentRunRefs: [],
      acceptedRiskRecordRefs: [],
      assessmentRecordRefs: [],
      warningRecordRefs: [],
      responseRecommendationRefs: [],
      deviationRecordRefs: [],
      calibrationSuggestionRefs: [],
      recordedAt: TIMESTAMP,
      ...(waitingRef === undefined ? {} : { lastWaitingRef: waitingRef }),
    });
    const artifactRef = await deps.bodies.putBody({
      projectId: command.projectId,
      actorId: command.actorId,
      commandId: `${command.commandId}:body`,
      issuedAt: command.issuedAt,
      artifactId: `assessment-run-state:${command.runRef.reference.entityId}:${runVersionId}`,
      body: { bodyKind: "run-state", runState: state },
      invocationId: command.commandId,
      authorization: command.authorization,
    });
    const auditEntryId = `${command.commandId}:audit`;
    await deps.transactionUnit.execute(
      {
        projectId: command.projectId,
        commandKind: "assessment-graph.start-run",
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        payload: { runId: command.runRef.reference.entityId, runVersionId },
        actorRef: command.actorId,
        authorizationContextRef: command.authorization.authorizationContextRef,
        issuedAt: command.issuedAt,
        runId: command.runRef.reference.entityId,
        threadId: command.threadId,
      } as never,
      (async (context: unknown) => {
        await deps.registrationStore.registerRow(
          {
            row: {
              schemaVersion: "1",
              projectId: command.projectId,
              resultKind: "run-state",
              resultId: artifactRef.reference.entityId,
              resultVersionId: runVersionId,
              runId: command.runRef.reference.entityId,
              runVersionId,
              parentRunId: command.parentRunRef?.reference.entityId,
              threadId: command.threadId,
              entryMode: command.entryMode,
              commandId: command.commandId,
              idempotencyKey: command.idempotencyKey,
              requestDigest: sha(`assessment-run-state:${command.commandId}:${runVersionId}`),
              actorRef: command.actorId,
              authorizationContextRef: command.authorization.authorizationContextRef,
              authorizationScopeDigest: authorizationScopeDigest(command.authorization),
              validAt: command.validAt,
              recordedAt: TIMESTAMP,
              persistedAt: TIMESTAMP,
              auditEntryId,
              artifactRef,
              stage: "A0",
              frozenRefs: [...command.frozenRefs],
            } satisfies WorkflowGraphResultRowV1,
            occurredAt: TIMESTAMP,
          },
          context,
        );
        return {
          resultRef: artifactRef as ContractReferenceV1,
          audit: {
            auditEntryId,
            projectId: command.projectId,
            action: "assessment-graph.start-run",
            targetRef: artifactRef as ContractReferenceV1,
            actorRef: command.actorId,
            authorizationContextRef: command.authorization.authorizationContextRef,
            occurredAt: TIMESTAMP,
            recordedAt: TIMESTAMP,
            version: artifactRef.reference,
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            runId: command.runRef.reference.entityId,
            threadId: command.threadId,
          },
          events: [],
        };
      }) as never,
    );
    return {
      runRef: command.runRef,
      runVersionId,
      status: state.status,
      stage: state.stage,
      assessmentRunRefs: [],
      ...(state.lastWaitingRef === undefined ? {} : { lastWaitingRef: state.lastWaitingRef }),
    };
  };
  return {
    commands,
    setStatus: (nextStatus: WorkflowRunStatusV1, nextWaiting?: WaitingRefV1) => {
      status = nextStatus;
      waitingRef = nextWaiting;
    },
    runtime: {
      start,
      resume: async () => {
        throw new TypeError("assessment stub resume is outside this slice's evidence");
      },
      cancel: async () => {
        throw new TypeError("assessment stub cancel is outside this slice's evidence");
      },
    } satisfies WorkflowGraphRuntimePortV1,
  };
};

/** C41 人工采纳证明替身（design D2/D3）：记录每次核对请求，可切换为成功采纳或各类错配/失败。 */
type HumanDecisionProofModeV1 =
  "adopted" | "failed" | "wrong-run" | "wrong-recommendation" | "wrong-scope";

interface HumanDecisionProofStubV1 {
  readonly port: HumanDecisionProofPortV1;
  readonly queries: HumanDecisionProofQueryV1[];
  setMode(mode: HumanDecisionProofModeV1): void;
}

const createHumanDecisionProofStub = (input: {
  readonly spatialScopeRef: typeof SPACE_A | typeof SPACE_B;
}): HumanDecisionProofStubV1 => {
  const queries: HumanDecisionProofQueryV1[] = [];
  let mode: HumanDecisionProofModeV1 = "adopted";
  const port: HumanDecisionProofPortV1 = {
    verifyHumanDecisionCommitted: async (query) => {
      queries.push(query);
      if (mode === "failed") {
        return {
          kind: "failed",
          error: ModuleErrorV1Schema.parse({
            code: "TERMINAL_FAILURE",
            category: "technical",
            retryable: false,
            stageCode: "c30-runtime-test-proof",
            occurredAt: TIMESTAMP,
            causalRunId: query.projectId,
            diagnosticRef: {
              kind: "diagnostic-artifact",
              reference: { entityId: "human-decision-proof", versionId: "1" },
            },
          }),
        };
      }
      return {
        kind: "succeeded",
        result: {
          kind: "adopted",
          projectId: query.projectId,
          routeDecisionRef: query.payload.routeDecisionRef,
          workflowRunRef:
            mode === "wrong-run"
              ? {
                  kind: "workflow-run",
                  reference: { entityId: "risk-flow-run:other", versionId: sha("other-run") },
                }
              : query.payload.workflowRunRef,
          responseRecommendationRef:
            mode === "wrong-recommendation"
              ? {
                  kind: "response-recommendation",
                  reference: { entityId: "response-recommendation:other", versionId: "v1" },
                }
              : query.payload.responseRecommendationRef,
          spatialScopeRef: mode === "wrong-scope" ? SPACE_B : input.spatialScopeRef,
          decidedBy: ACTOR_ID,
          decidedAt: TIMESTAMP,
          auditTrailRef: {
            kind: "audit-trail",
            reference: { entityId: "human-decision-proof:audit", versionId: "v1" },
          },
        },
      };
    },
  };
  return {
    port,
    queries,
    setMode: (nextMode) => {
      mode = nextMode;
    },
  };
};

interface RiskFlowHarnessV1 {
  readonly postgres: PostgresTestFixture;
  readonly runtime: PostgresRuntime;
  readonly transactionUnit: ReturnType<typeof createPostgresTransactionUnit>;
  readonly artifactStore: Awaited<ReturnType<typeof createArtifactStore>>;
  readonly adapter: PostgresWorkflowAdapterV1;
  readonly access: ReturnType<typeof createAccessStub>;
  readonly runtimeAuthorization: ReturnType<typeof createRuntimeAuthorizationStub>;
  readonly identification: ReturnType<typeof createIdentificationRuntimeStub>;
  readonly assessment: ReturnType<typeof createAssessmentRuntimeStub>;
  readonly humanDecisionProof: HumanDecisionProofStubV1;
  readonly pairingSpaces: Map<string, typeof SPACE_A | typeof SPACE_B>;
  readonly ports: RiskFlowGraphPortsV1;
  readonly graph: RiskFlowGraphRunnerV1;
  readonly riskFlowRuntime: RiskFlowGraphRuntimeV1;
  readonly rootDirectory: string;
  close(): Promise<void>;
}

const startHarness = async (
  postgres: PostgresTestFixture,
  options: {
    readonly checkpointStageResultsUsable?: boolean;
    /** C05 复验签发身份的空间范围：必须与用例命令的授权范围一致，否则登记行摘要无法复验。 */
    readonly authorizationScopes?: readonly (typeof SPACE_A | typeof SPACE_B)[];
  } = {},
): Promise<RiskFlowHarnessV1> => {
  const runtime = createPostgresRuntime(postgres.app, "riskflow_app");
  const transactionUnit = createPostgresTransactionUnit(postgres.app);
  const rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c30-risk-flow-"));
  const authorization = authorizationFor(
    "workflow.start",
    options.authorizationScopes ?? [SPACE_A, SPACE_B],
  );
  const access = createAccessStub(authorization);
  const runtimeAuthorization = createRuntimeAuthorizationStub();
  try {
    const artifactStore = await createArtifactStore({
      ...postgres.app,
      rootDirectory,
      policy: ARTIFACT_POLICY,
    });
    const adapter = createPostgresWorkflowAdapter({
      db: runtime.db,
      transactionUnit,
      artifactStore,
      authorization: access.port,
      now: () => clock.now(),
    });
    // 故障注入：`validateReference` 拒绝阶段结果引用时，prepare 之后的检查点写入失败，
    // 业务事实已提交而持久检查点停留在上一阶段（design D-08 的“业务领先”情形）。
    const checkpointer: PostgresCheckpointer = await setupPostgresCheckpointer({
      ...postgres.checkpointer,
      validateReference: (reference) =>
        options.checkpointStageResultsUsable !== false || reference.kind !== "stage-result",
    });
    const identification = createIdentificationRuntimeStub({});
    const pairingSpaces = new Map<string, typeof SPACE_A | typeof SPACE_B>();
    const riskSpatialPairing: RiskSpatialPairingResolverV1 = {
      resolve: async (input) => pairingSpaces.get(refKey(input.riskRecordRef)),
    };
    const ports: RiskFlowGraphPortsV1 = {
      transactionUnit,
      registrationStore: adapter.registrationStore,
      bodies: adapter.bodies,
      identificationRuntime: identification.runtime,
      assessmentRuntime: {} as WorkflowGraphRuntimePortV1,
      riskSpatialPairing,
      retryPolicy: { read: async () => ({ maxAttempts: 2, backoffMs: 1_000 }) },
      subGraphVersions: SUB_GRAPH_VERSIONS,
      retryPolicyRef: RETRY_POLICY_REF,
      now: () => clock.now(),
    };
    const assessment = createAssessmentRuntimeStub({
      transactionUnit: transactionUnit as unknown as {
        execute: (...args: never[]) => Promise<unknown>;
      },
      registrationStore: adapter.registrationStore,
      bodies: adapter.bodies,
    });
    const wiredPorts: RiskFlowGraphPortsV1 = { ...ports, assessmentRuntime: assessment.runtime };
    const graph = createRiskFlowGraph({ ports: wiredPorts, checkpointer });
    const humanDecisionProof = createHumanDecisionProofStub({ spatialScopeRef: SPACE_A });
    const riskFlowRuntime = createRiskFlowGraphRuntime({
      ports: wiredPorts,
      graph,
      authorization: runtimeAuthorization.port,
      humanDecisionProof: humanDecisionProof.port,
      now: () => clock.now(),
    });
    return {
      postgres,
      runtime,
      transactionUnit,
      artifactStore,
      adapter,
      access,
      runtimeAuthorization,
      identification,
      assessment,
      humanDecisionProof,
      pairingSpaces,
      ports: wiredPorts,
      graph,
      riskFlowRuntime,
      rootDirectory,
      async close() {
        await checkpointer.end().catch(() => undefined);
        await artifactStore.close().catch(() => undefined);
        await transactionUnit.close().catch(() => undefined);
        await runtime.close().catch(() => undefined);
        await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
      },
    };
  } catch (error) {
    await transactionUnit.close().catch(() => undefined);
    await runtime.close().catch(() => undefined);
    await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
};

/** 最新运行状态回读（真实适配器，按当前授权复验）：断言只针对可观察业务状态。 */
const readLatestState = async (
  harness: RiskFlowHarnessV1,
  runRef: WorkflowRunRefV1,
  capability: string,
): Promise<WorkflowGraphRunStateV1 | undefined> =>
  (
    await harness.adapter.registrationStore.readLatestRunState({
      projectId: PROJECT_ID,
      runId: runRef.reference.entityId,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      invocationId: "risk-flow-cursor-read",
      authorization: authorizationFor(capability, [SPACE_A, SPACE_B]),
    })
  )?.state;

/** 入口命令：一次性冻结引用与逐空间配对由调用方给出（生产由公共载荷门禁产出）。 */
const startCommandFor = (input: {
  readonly runKey: string;
  readonly entryMode?: WorkflowEntryModeV1;
  readonly frozenRefs: readonly ContractReferenceV1[];
  readonly pairing: readonly RiskFlowAssessmentPairingV1[];
  readonly capability?: string;
  readonly primaryRiskRef?: ContractReferenceV1;
}): RiskFlowStartCommandV1 => {
  const entryMode: WorkflowEntryModeV1 = input.entryMode ?? "identify-and-assess";
  const entryIdentity = {
    entityId: `workflow-entry:${PROJECT_ID}:${entryMode}`,
    versionId: sha(`entry:${input.runKey}:${entryMode}`),
  };
  return {
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    authorization: authorizationFor(input.capability ?? "workflow.start", [SPACE_A, SPACE_B]),
    commandId: `c30-start:${input.runKey}`,
    idempotencyKey: `c30-start:${input.runKey}`,
    issuedAt: TIMESTAMP,
    validAt: TIMESTAMP,
    graphVersion: GRAPH_VERSION,
    retryPolicyRef: RETRY_POLICY_REF,
    entryMode,
    entryIdentity,
    frozenRefs: [...input.frozenRefs],
    pairing: [...input.pairing],
    runRef: {
      kind: "workflow-run",
      reference: {
        entityId: `risk-flow-run:${PROJECT_ID}:${input.runKey}`,
        versionId: sha(`run:${input.runKey}`),
      },
    },
    threadId: `risk-flow-run-thread:${input.runKey}`,
    ...(input.primaryRiskRef === undefined ? {} : { primaryRiskRef: input.primaryRiskRef }),
  };
};

const pairingOf = (input: {
  readonly space: typeof SPACE_A | typeof SPACE_B;
  readonly applicability: typeof APPLICABILITY_A | typeof APPLICABILITY_B;
  readonly monitoring: typeof MONITORING_A | typeof MONITORING_B;
}): RiskFlowAssessmentPairingV1 => ({
  spatialScopeRef: input.space,
  applicabilityMetadataSnapshotRef: input.applicability,
  monitoringSnapshotRefs: [input.monitoring],
});

const IDENTIFY_FROZEN_REFS: readonly ContractReferenceV1[] = [
  PROJECT_REVISION_REF,
  SPACE_A,
  SPACE_B,
  SOURCE_VERSION_REF,
  APPLICABILITY_A,
  APPLICABILITY_B,
  MONITORING_A,
  MONITORING_B,
];

/** 评估子运行等待引用（替身用它表示子运行停在人工确认等待）。 */
const USER_CONFIRMATION_WAITING: WaitingRefV1 = {
  kind: "user-confirmation",
  userConfirmationRef: {
    kind: "user-confirmation",
    reference: { entityId: "user-confirmation-c30", versionId: "v1" },
  },
};

describe("C30 父运行图运行时（真实 PostgreSQL + 真实 LangGraph + 真实事务）", () => {
  let postgres: PostgresTestFixture;
  let harness: RiskFlowHarnessV1;

  beforeAll(async () => {
    postgres = await startPostgresFixture();
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
      additionalMigrationRoots: [postgres.fixtureMigrationRoot],
    });
    harness = await startHarness(postgres);
  }, 300_000);

  afterAll(async () => {
    await harness?.close().catch(() => undefined);
    await postgres?.close().catch(() => undefined);
  }, 120_000);

  const rowsOf = (runRef: WorkflowRunRefV1): Promise<readonly WorkflowGraphResultRowV1[]> =>
    harness.adapter.registrationStore.listRunRows({
      projectId: PROJECT_ID,
      runId: runRef.reference.entityId,
    });
  const linksOf = (runRef: WorkflowRunRefV1) =>
    harness.adapter.registrationStore.listRunLinks({
      projectId: PROJECT_ID,
      runId: runRef.reference.entityId,
    });
  /** C30 业务事实的审计条目数（工件读访问审计不属于业务补写，不计入）。 */
  const auditCount = async (action?: string): Promise<number> => {
    const result = await postgres.adminPool.query<{ count: string }>(
      action === undefined
        ? "SELECT count(*)::text AS count FROM audit.entries WHERE project_id = $1 AND action LIKE 'risk-flow-%'"
        : "SELECT count(*)::text AS count FROM audit.entries WHERE project_id = $1 AND action = $2",
      action === undefined ? [PROJECT_ID] : [PROJECT_ID, action],
    );
    return Number(result.rows[0]?.count ?? "0");
  };
  const latestStateOf = async (runRef: WorkflowRunRefV1) => {
    const rows = await rowsOf(runRef);
    const runStates = rows.filter((row) => row.resultKind === "run-state");
    const runState = runStates.at(-1);
    if (runState === undefined) return undefined;
    return await readLatestState(harness, runRef, "workflow.start");
  };
  const runStateIds = (rows: readonly WorkflowGraphResultRowV1[]): readonly string[] =>
    rows
      .filter((row) => row.resultKind === "run-state")
      .map((row) => `${row.resultId}/${row.resultVersionId}`);

  /** `identify-and-assess` 入口先等在识别阶段，`inputs-ready` 事件到达后才推进识别与评估。 */
  const applyPreparation = (runRef: WorkflowRunRefV1) =>
    harness.riskFlowRuntime.applyIdentificationPreparation({
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      authorization: authorizationFor("workflow.resume", [SPACE_A, SPACE_B]),
      commandId: `c30-inputs-ready:${runRef.reference.entityId}`,
      idempotencyKey: `c30-inputs-ready:${runRef.reference.entityId}`,
      issuedAt: TIMESTAMP,
      runRef,
      identificationPreparationSnapshotRef: PREPARATION_REF,
    });
  const startAndApplyPreparation = async (run: RiskFlowStartCommandV1) => {
    const started = await harness.riskFlowRuntime.start(run);
    expect(started.status).toBe("waiting");
    expect(started.lastWaitingRef?.kind).toBe("knowledge-preparation");
    return await applyPreparation(run.runRef);
  };

  it("R1/S4 每条风险只使用本风险空间的配对上下文", async () => {
    const riskA = riskRecordRef("a");
    const riskB = riskRecordRef("b");
    harness.pairingSpaces.set(refKey(riskA), SPACE_A);
    harness.pairingSpaces.set(refKey(riskB), SPACE_B);
    harness.identification.setAcceptedRiskRecordRefs([riskA, riskB]);
    harness.identification.setReviewWaiting(undefined);
    harness.assessment.setStatus("waiting", USER_CONFIRMATION_WAITING);

    const run = startCommandFor({
      runKey: "pairing-per-space",
      frozenRefs: IDENTIFY_FROZEN_REFS,
      pairing: [
        pairingOf({ space: SPACE_A, applicability: APPLICABILITY_A, monitoring: MONITORING_A }),
        pairingOf({ space: SPACE_B, applicability: APPLICABILITY_B, monitoring: MONITORING_B }),
      ],
    });
    const outcome = await startAndApplyPreparation(run);
    expect(outcome.disposition).toBe("existing");
    expect(outcome.status).toBe("waiting");
    expect(outcome.stage).toBe("assessment");

    // 父运行启动了两个评估子运行（每条已验收风险版本一个），启动命令各自携带本风险空间的配对。
    expect(harness.assessment.commands).toHaveLength(2);
    const commandForA = harness.assessment.commands.find(
      (command) => command.acceptedRiskRecordRef?.reference.entityId === riskA.reference.entityId,
    );
    const commandForB = harness.assessment.commands.find(
      (command) => command.acceptedRiskRecordRef?.reference.entityId === riskB.reference.entityId,
    );
    expect(commandForA?.spatialScopeRef).toEqual(SPACE_A);
    expect(commandForA?.applicabilityMetadataSnapshotRef).toEqual(APPLICABILITY_A);
    expect(commandForA?.monitoringSnapshotRefs).toEqual([MONITORING_A]);
    expect(commandForB?.spatialScopeRef).toEqual(SPACE_B);
    expect(commandForB?.applicabilityMetadataSnapshotRef).toEqual(APPLICABILITY_B);
    expect(commandForB?.monitoringSnapshotRefs).toEqual([MONITORING_B]);
    // 绝不跨空间复用：每份冻结输入只含自己空间的空间/适用性/监测引用。
    expect(commandForA?.frozenRefs).not.toContainEqual(SPACE_B);
    expect(commandForA?.frozenRefs).not.toContainEqual(APPLICABILITY_B);
    expect(commandForA?.frozenRefs).not.toContainEqual(MONITORING_B);
    expect(commandForB?.frozenRefs).not.toContainEqual(SPACE_A);
    expect(commandForB?.frozenRefs).not.toContainEqual(APPLICABILITY_A);
    expect(commandForB?.frozenRefs).not.toContainEqual(MONITORING_A);

    // 登记面：两条子运行路由行、两条父子链边、父运行状态收录两个子运行。
    const rows = await rowsOf(run.runRef);
    const subRunRoutes = rows.filter(
      (row) => row.resultKind === "route-decision" && row.routeKind === "assessment-sub-run",
    );
    expect(subRunRoutes).toHaveLength(2);
    const links = await linksOf(run.runRef);
    const assessmentRunKeys = new Set(
      outcome.assessmentRunRefs.map(
        (child) => `${child.reference.entityId}/${child.reference.versionId}`,
      ),
    );
    const subRunLinks = links.filter(
      (link) =>
        link.relation === "parent-child" &&
        "reference" in link.toRef &&
        assessmentRunKeys.has(`${link.toRef.reference.entityId}/${link.toRef.reference.versionId}`),
    );
    expect(subRunLinks).toHaveLength(2);
    expect(outcome.assessmentRunRefs).toHaveLength(2);
    const state = await latestStateOf(run.runRef);
    expect(state?.status).toBe("waiting");
    expect(state?.stage).toBe("assessment");
    expect(state?.assessmentRunRefs).toHaveLength(2);
  }, 120_000);

  it("R1/S4 缺配对空间时阻断该风险的评估并保留其它风险已成立事实", async () => {
    harness.assessment.commands.length = 0;
    harness.identification.commands.length = 0;
    const riskA = riskRecordRef("a", "v2");
    const riskB = riskRecordRef("b", "v2");
    const riskC = riskRecordRef("c", "v1");
    harness.pairingSpaces.set(refKey(riskA), SPACE_A);
    harness.pairingSpaces.set(refKey(riskB), SPACE_B);
    harness.pairingSpaces.delete(refKey(riskC));
    harness.identification.setAcceptedRiskRecordRefs([riskA, riskB, riskC]);

    const run = startCommandFor({
      runKey: "pairing-blocked",
      frozenRefs: IDENTIFY_FROZEN_REFS,
      pairing: [
        pairingOf({ space: SPACE_A, applicability: APPLICABILITY_A, monitoring: MONITORING_A }),
        pairingOf({ space: SPACE_B, applicability: APPLICABILITY_B, monitoring: MONITORING_B }),
      ],
    });
    const outcome = await startAndApplyPreparation(run);

    // 阻断按正式失败收口：只阻断缺少配对的那条风险，不伪造评估子运行。
    expect(outcome.status).toBe("terminal-failure");
    expect(outcome.errorRef?.reference.entityId).toContain("spatial-pairing-missing");
    expect(harness.assessment.commands).toHaveLength(2);

    const rows = await rowsOf(run.runRef);
    const blockedRoute = rows.find(
      (row) => row.resultKind === "route-decision" && row.routeKind === "spatial-pairing-missing",
    );
    expect(blockedRoute).toBeDefined();
    const errorRow = rows.find((row) => row.resultKind === "workflow-error");
    expect(errorRow).toBeDefined();
    // 其它两条风险已成立事实保留：各自的路由行与父子链边都在。
    const subRunRoutes = rows.filter(
      (row) => row.resultKind === "route-decision" && row.routeKind === "assessment-sub-run",
    );
    expect(subRunRoutes).toHaveLength(2);
    const blockedRunChildLinks = (await linksOf(run.runRef)).filter(
      (link) => link.relation === "parent-child",
    );
    // 识别子运行 + 两条已成立评估子运行：链边保留，阻断风险不产生链边。
    expect(blockedRunChildLinks).toHaveLength(3);
    // 运行汇总如实记录缺席链尾与原因码，而不是占位结论。
    const runResultRow = rows.find((row) => row.resultKind === "run-result");
    expect(runResultRow).toBeDefined();
    const runResult = await harness.adapter.registrationStore.readRow({
      projectId: PROJECT_ID,
      runId: run.runRef.reference.entityId,
      resultKind: "run-result",
      resultId: runResultRow?.resultId ?? "",
      resultVersionId: runResultRow?.resultVersionId ?? "",
    });
    expect(runResult).toBeDefined();
    // 运行汇总如实指出被阻断的精确风险版本（缺席链尾的原因码 + 最后成立引用），不伪造评估结论。
    const resultRow = rows.find((row) => row.resultKind === "run-result");
    const runResultBody =
      resultRow?.runResultRef === undefined
        ? undefined
        : await harness.adapter.bodies.readBody({
            projectId: PROJECT_ID,
            artifactRef: resultRow.runResultRef,
            actorId: ACTOR_ID,
            requestedAt: TIMESTAMP,
            invocationId: `c30-body-read:${PROJECT_ID}:${resultRow.runResultRef.reference.entityId}`,
            authorization: authorizationFor("workflow.start", [SPACE_A, SPACE_B]),
          });
    expect(runResultBody?.bodyKind).toBe("run-result");
    expect(
      runResultBody?.bodyKind === "run-result"
        ? runResultBody.runResult.skippedTails.map((tail) => tail.reasonCode)
        : [],
    ).toEqual(["spatial-pairing-missing"]);
    expect(
      runResultBody?.bodyKind === "run-result"
        ? runResultBody.runResult.skippedTails.map((tail) => tail.lastEstablishedRef)
        : [],
    ).toEqual([expect.objectContaining({ kind: "standardized-risk-record" })]);
    expect((await latestStateOf(run.runRef))?.lastErrorRef?.reference.entityId).toContain(
      "spatial-pairing-missing",
    );
  }, 120_000);

  it("R2/S2 无合格风险时不创建空评估子运行（等待或类型化终态）", async () => {
    harness.assessment.commands.length = 0;
    harness.identification.commands.length = 0;
    // 变体一：只剩待复核 —— 如实登记等待，零评估子运行。
    harness.identification.setAcceptedRiskRecordRefs([]);
    const pendingRun = startCommandFor({
      runKey: "no-qualified-pending",
      frozenRefs: IDENTIFY_FROZEN_REFS,
      pairing: [
        pairingOf({ space: SPACE_A, applicability: APPLICABILITY_A, monitoring: MONITORING_A }),
      ],
    });
    harness.identification.setReviewWaiting({
      kind: "review",
      reviewTaskRef: {
        kind: "review-task",
        reference: { entityId: "review-task-c30", versionId: "v1" },
        reviewType: "identification-group",
        targetRef: {
          kind: "identification-group",
          reference: { entityId: "identification-group-pending", versionId: "v1" },
        },
        waitingRunRef: pendingRun.runRef,
      },
    });
    const pendingOutcome = await startAndApplyPreparation(pendingRun);
    expect(pendingOutcome.status).toBe("waiting");
    expect(pendingOutcome.stage).toBe("identification");
    expect(pendingOutcome.lastWaitingRef?.kind).toBe("review");
    expect(pendingOutcome.assessmentRunRefs).toEqual([]);
    expect(harness.assessment.commands).toEqual([]);
    expect(
      (await rowsOf(pendingRun.runRef)).filter(
        (row) => row.resultKind === "route-decision" && row.routeKind === "assessment-sub-run",
      ),
    ).toEqual([]);

    // 变体二：没有已验收风险也没有待复核 —— 只登记 no-qualified-risk 与缺席链尾后完成。
    harness.identification.setReviewWaiting(undefined);
    const rejectedRun = startCommandFor({
      runKey: "no-qualified-rejected",
      frozenRefs: IDENTIFY_FROZEN_REFS,
      pairing: [
        pairingOf({ space: SPACE_A, applicability: APPLICABILITY_A, monitoring: MONITORING_A }),
      ],
    });
    const rejectedOutcome = await startAndApplyPreparation(rejectedRun);
    expect(rejectedOutcome.status).toBe("completed");
    expect(rejectedOutcome.assessmentRunRefs).toEqual([]);
    expect(harness.assessment.commands).toEqual([]);
    const rows = await rowsOf(rejectedRun.runRef);
    expect(
      rows.some(
        (row) => row.resultKind === "route-decision" && row.routeKind === "no-qualified-risk",
      ),
    ).toBe(true);
    expect(rows.some((row) => row.resultKind === "run-result")).toBe(true);
    const state = await latestStateOf(rejectedRun.runRef);
    expect(state?.status).toBe("completed");
    expect(state?.resultRef).toBeDefined();
    expect(state?.lastWaitingRef).toBeUndefined();
  }, 120_000);

  it("R4/S1 inputs-ready 恢复复用已提交结果，不产生第二个识别子运行或重复登记行", async () => {
    harness.assessment.commands.length = 0;
    harness.identification.commands.length = 0;
    const run = startCommandFor({
      runKey: "inputs-ready",
      frozenRefs: IDENTIFY_FROZEN_REFS,
      pairing: [
        pairingOf({ space: SPACE_A, applicability: APPLICABILITY_A, monitoring: MONITORING_A }),
      ],
    });
    harness.identification.setAcceptedRiskRecordRefs([]);
    harness.identification.setReviewWaiting({
      kind: "review",
      reviewTaskRef: {
        kind: "review-task",
        reference: { entityId: "review-task-inputs-ready", versionId: "v1" },
        reviewType: "identification-group",
        targetRef: {
          kind: "identification-group",
          reference: { entityId: "identification-group-inputs-ready", versionId: "v1" },
        },
        waitingRunRef: run.runRef,
      },
    });
    const started = await harness.riskFlowRuntime.start(run);
    expect(started.status).toBe("waiting");
    expect(started.lastWaitingRef?.kind).toBe("knowledge-preparation");
    expect(harness.identification.commands).toHaveLength(0);

    const applied = await harness.riskFlowRuntime.applyIdentificationPreparation({
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      authorization: authorizationFor("workflow.resume", [SPACE_A, SPACE_B]),
      commandId: `c30-inputs-ready:${run.runRef.reference.entityId}`,
      idempotencyKey: `c30-inputs-ready:${run.runRef.reference.entityId}`,
      issuedAt: TIMESTAMP,
      runRef: run.runRef,
      identificationPreparationSnapshotRef: PREPARATION_REF,
    });
    expect(applied.status).toBe("waiting");
    expect(harness.identification.commands).toHaveLength(1);

    const rowsAfterFirst = await rowsOf(run.runRef);
    const linksAfterFirst = await linksOf(run.runRef);
    const auditAfterFirst = await auditCount();
    const stateAfterFirst = await latestStateOf(run.runRef);
    const identificationRunRef = stateAfterFirst?.identificationRunRef;
    expect(identificationRunRef).toBeDefined();

    // 同一 `inputs-ready` 事件重放：命中同一识别子运行身份、同一动作身份，登记面不增长。
    const replayed = await harness.riskFlowRuntime.applyIdentificationPreparation({
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      authorization: authorizationFor("workflow.resume", [SPACE_A, SPACE_B]),
      commandId: `c30-inputs-ready:${run.runRef.reference.entityId}`,
      idempotencyKey: `c30-inputs-ready:${run.runRef.reference.entityId}`,
      issuedAt: TIMESTAMP,
      runRef: run.runRef,
      identificationPreparationSnapshotRef: PREPARATION_REF,
    });
    expect(replayed.status).toBe("waiting");
    // 识别子运行启动命令身份稳定：重放不产生第二个子运行。
    expect(new Set(harness.identification.commands.map((command) => command.commandId)).size).toBe(
      1,
    );
    expect(harness.identification.commands).toHaveLength(2);
    const rowsAfterReplay = await rowsOf(run.runRef);
    const linksAfterReplay = await linksOf(run.runRef);
    expect(runStateIds(rowsAfterReplay)).toEqual(runStateIds(rowsAfterFirst));
    expect(
      rowsAfterReplay.map((row) => `${row.resultKind}/${row.resultId}/${row.resultVersionId}`),
    ).toEqual(
      rowsAfterFirst.map((row) => `${row.resultKind}/${row.resultId}/${row.resultVersionId}`),
    );
    expect(linksAfterReplay.map((link) => link.linkId)).toEqual(
      linksAfterFirst.map((link) => link.linkId),
    );
    expect(await auditCount()).toBe(auditAfterFirst);
    expect((await latestStateOf(run.runRef))?.identificationRunRef).toEqual(identificationRunRef);
    // 等待引用保持唯一：待复核等待没有被重复登记。
    expect(rowsAfterReplay.filter((row) => row.resultKind === "waiting")).toHaveLength(
      rowsAfterFirst.filter((row) => row.resultKind === "waiting").length,
    );
  }, 120_000);

  it("R4/S2 检查点指向业务从未登记的阶段时以 CHECKPOINT_INCONSISTENT 零补写封闭", async () => {
    harness.identification.commands.length = 0;
    const run = startCommandFor({
      runKey: "checkpoint-fake",
      frozenRefs: IDENTIFY_FROZEN_REFS,
      pairing: [
        pairingOf({ space: SPACE_A, applicability: APPLICABILITY_A, monitoring: MONITORING_A }),
      ],
    });
    harness.identification.setAcceptedRiskRecordRefs([]);
    harness.identification.setReviewWaiting(undefined);
    const started = await harness.riskFlowRuntime.start(run);
    expect(started.status).toBe("waiting");
    const cursorBefore = await readLatestState(harness, run.runRef, "workflow.resume");
    expect(cursorBefore).toBeDefined();

    // 检查点被写到业务从未登记的位置（`result-summary`），业务侧仍停在识别等待：虚指检查点。
    const forged: WorkflowGraphRunContextV1 = {
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      authorization: authorizationFor("workflow.resume", [SPACE_A, SPACE_B]),
      commandId: "c30-forge-checkpoint",
      idempotencyKey: "c30-forge-checkpoint",
      issuedAt: TIMESTAMP,
      validAt: TIMESTAMP,
      entryRecordedAt: TIMESTAMP,
      runRef: run.runRef,
      threadId: run.threadId,
      entryMode: run.entryMode,
      entryIdentity: run.entryIdentity,
      frozenRefs: [...run.frozenRefs],
      pairing: [...run.pairing],
      retryPolicyRef: RETRY_POLICY_REF,
      subGraphVersions: SUB_GRAPH_VERSIONS,
    };
    const forgedError = {
      kind: "workflow-error" as const,
      reference: { entityId: "workflow-error-forged", versionId: "v1" },
    };
    await harness.graph.recover(
      {
        schemaVersion: "1",
        graphVersion: GRAPH_VERSION,
        runRef: run.runRef,
        threadId: run.threadId,
        entryMode: run.entryMode,
        authorizationContextRef: forged.authorization.authorizationContextRef,
        status: "terminal-failure",
        stage: "result-summary",
        assessmentRunRefs: [],
        waitingRefs: [],
        lastErrorRef: forgedError,
      },
      "summarize",
      { configurable: { thread_id: run.threadId, riskflowRiskFlowGraphRunV1: forged } },
    );

    const rowsBefore = await rowsOf(run.runRef);
    const linksBefore = await linksOf(run.runRef);
    const auditBefore = await auditCount();
    await expect(
      harness.riskFlowRuntime.resume({
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        authorization: authorizationFor("workflow.resume", [SPACE_A, SPACE_B]),
        commandId: "c30-resume-checkpoint-fake",
        idempotencyKey: "c30-resume-checkpoint-fake",
        issuedAt: TIMESTAMP,
        validAt: TIMESTAMP,
        runRef: run.runRef,
        expectedRunVersionId: cursorBefore?.runVersionId ?? "",
        resumeCause: {
          kind: "inputs-ready",
          identificationPreparationSnapshotRef: PREPARATION_REF,
        },
      }),
    ).rejects.toMatchObject({
      error: {
        code: "CHECKPOINT_INCONSISTENT",
        retryable: false,
        detailCode: "checkpoint-inconsistent",
      },
    });
    // 零补写：不从检查点正文补写业务表，也不新增登记行、链边或审计。
    expect(
      (await rowsOf(run.runRef)).map(
        (row) => `${row.resultKind}/${row.resultId}/${row.resultVersionId}`,
      ),
    ).toEqual(rowsBefore.map((row) => `${row.resultKind}/${row.resultId}/${row.resultVersionId}`));
    expect((await linksOf(run.runRef)).map((link) => link.linkId)).toEqual(
      linksBefore.map((link) => link.linkId),
    );
    expect(await auditCount()).toBe(auditBefore);
    expect((await latestStateOf(run.runRef))?.status).toBe("waiting");
  }, 120_000);

  it("R4/S3 取消在部分提交后保留已提交事实、审计与链边，并停止未开始动作", async () => {
    harness.identification.commands.length = 0;
    const run = startCommandFor({
      runKey: "cancel",
      frozenRefs: IDENTIFY_FROZEN_REFS,
      pairing: [
        pairingOf({ space: SPACE_A, applicability: APPLICABILITY_A, monitoring: MONITORING_A }),
      ],
    });
    harness.identification.setAcceptedRiskRecordRefs([]);
    harness.identification.setReviewWaiting(undefined);
    const started = await harness.riskFlowRuntime.start(run);
    expect(started.status).toBe("waiting");

    const rowsBefore = await rowsOf(run.runRef);
    const linksBefore = await linksOf(run.runRef);
    const identificationStarts = harness.identification.commands.length;
    const cursor = await readLatestState(harness, run.runRef, "workflow.cancel");
    const cancelled = await harness.riskFlowRuntime.cancel({
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      authorization: authorizationFor("workflow.cancel", [SPACE_A, SPACE_B]),
      commandId: "c30-cancel:partial",
      idempotencyKey: "c30-cancel:partial",
      issuedAt: TIMESTAMP,
      validAt: TIMESTAMP,
      runRef: run.runRef,
      expectedRunVersionId: cursor?.runVersionId ?? "",
      reasonCode: "operator-cancelled",
    });
    expect(cancelled.disposition).toBe("cancellation-recorded");
    expect(cancelled.status).toBe("cancelled");

    const rowsAfter = await rowsOf(run.runRef);
    // 已提交事实、链边与审计一律保留（并集），并追加取消路由、运行汇总与取消态运行状态。
    for (const before of rowsBefore) {
      expect(
        rowsAfter.some(
          (row) =>
            row.resultKind === before.resultKind &&
            row.resultId === before.resultId &&
            row.resultVersionId === before.resultVersionId,
        ),
      ).toBe(true);
    }
    for (const link of linksBefore) {
      expect((await linksOf(run.runRef)).some((item) => item.linkId === link.linkId)).toBe(true);
    }
    expect(
      rowsAfter.some((row) => row.resultKind === "route-decision" && row.routeKind === "cancelled"),
    ).toBe(true);
    expect(rowsAfter.some((row) => row.resultKind === "run-result")).toBe(true);
    expect(await auditCount("risk-flow-graph.cancel")).toBeGreaterThan(0);

    // 未开始动作停止：等待态被取消后不再推进识别节点，也不再登记新的事实。
    const rowsAtCancel = await rowsOf(run.runRef);
    const replayed = await harness.riskFlowRuntime.applyIdentificationPreparation({
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      authorization: authorizationFor("workflow.resume", [SPACE_A, SPACE_B]),
      commandId: "c30-inputs-ready-after-cancel",
      idempotencyKey: "c30-inputs-ready-after-cancel",
      issuedAt: TIMESTAMP,
      runRef: run.runRef,
      identificationPreparationSnapshotRef: PREPARATION_REF,
    });
    expect(replayed.disposition).toBe("already-cancelled");
    expect(replayed.status).toBe("cancelled");
    expect(harness.identification.commands).toHaveLength(identificationStarts);
    expect(
      (await rowsOf(run.runRef)).map(
        (row) => `${row.resultKind}/${row.resultId}/${row.resultVersionId}`,
      ),
    ).toEqual(
      rowsAtCancel.map((row) => `${row.resultKind}/${row.resultId}/${row.resultVersionId}`),
    );
  }, 120_000);

  it("R4/S3 权限拒绝与陈旧版本以不可重试失败收口，不被重试绕过", async () => {
    harness.identification.commands.length = 0;
    const run = startCommandFor({
      runKey: "denied",
      frozenRefs: IDENTIFY_FROZEN_REFS,
      pairing: [
        pairingOf({ space: SPACE_A, applicability: APPLICABILITY_A, monitoring: MONITORING_A }),
      ],
    });
    harness.identification.setAcceptedRiskRecordRefs([]);
    harness.identification.setReviewWaiting(undefined);
    const started = await harness.riskFlowRuntime.start(run);
    expect(started.status).toBe("waiting");
    const rowsBefore = await rowsOf(run.runRef);
    const auditBefore = await auditCount();
    const cursor = await readLatestState(harness, run.runRef, "workflow.resume");

    // 权限失败：撤销后拒绝，且明确不可重试。
    harness.runtimeAuthorization.revoke();
    const denied = await harness.riskFlowRuntime.workflowPort.resumeRun({
      kind: "resume-run",
      commandId: "c30-resume-denied",
      idempotencyKey: "c30-resume-denied",
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      issuedAt: TIMESTAMP,
      authorization: authorizationFor("workflow.resume", [SPACE_A, SPACE_B]),
      payload: {
        workflowRunRef: run.runRef,
        expectedStateVersion: cursor?.runVersionId ?? "",
        resumeCause: {
          kind: "transient-recovered",
          workflowErrorRef: {
            kind: "workflow-error",
            reference: { entityId: "workflow-error-c30", versionId: "v1" },
          },
          diagnosticArtifactRef: {
            kind: "diagnostic-artifact",
            reference: { entityId: "diagnostic-c30", versionId: "v1" },
          },
        },
      },
    });
    expect(denied).toMatchObject({
      kind: "failed",
      error: { code: "AUTHORIZATION_DENIED", category: "authorization", retryable: false },
    });
    // 重试（`transient-recovered`）不绕过权限失败：业务面零补写。
    expect(
      (await rowsOf(run.runRef)).map(
        (row) => `${row.resultKind}/${row.resultId}/${row.resultVersionId}`,
      ),
    ).toEqual(rowsBefore.map((row) => `${row.resultKind}/${row.resultId}/${row.resultVersionId}`));
    expect(await auditCount()).toBe(auditBefore);

    // 权限恢复后，陈旧版本仍以不可重试冲突收口：重试不绕过并发冲突。
    harness.runtimeAuthorization.restore();
    await expect(
      harness.riskFlowRuntime.resume({
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        authorization: authorizationFor("workflow.resume", [SPACE_A, SPACE_B]),
        commandId: "c30-resume-stale",
        idempotencyKey: "c30-resume-stale",
        issuedAt: TIMESTAMP,
        validAt: TIMESTAMP,
        runRef: run.runRef,
        expectedRunVersionId: sha("stale-run-version"),
        resumeCause: { kind: "transient-recovered" },
      }),
    ).rejects.toMatchObject({
      error: { code: "VERSION_CONFLICT", retryable: false, detailCode: "stale_version" },
    });
    expect(
      (await rowsOf(run.runRef)).map(
        (row) => `${row.resultKind}/${row.resultId}/${row.resultVersionId}`,
      ),
    ).toEqual(rowsBefore.map((row) => `${row.resultKind}/${row.resultId}/${row.resultVersionId}`));
    expect(await auditCount()).toBe(auditBefore);
  }, 120_000);
});

describe("C30 父运行图运行时（检查点写入失败后恢复对账）", () => {
  let postgres: PostgresTestFixture;
  let harness: RiskFlowHarnessV1;

  beforeAll(async () => {
    postgres = await startPostgresFixture();
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
      additionalMigrationRoots: [postgres.fixtureMigrationRoot],
    });
    harness = await startHarness(postgres, { checkpointStageResultsUsable: false });
  }, 300_000);

  afterAll(async () => {
    await harness?.close().catch(() => undefined);
    await postgres?.close().catch(() => undefined);
  }, 120_000);

  it("R4/S2 业务领先且无法由登记事实证明时以 CHECKPOINT_INCONSISTENT 零补写封闭", async () => {
    const run = startCommandFor({
      runKey: "checkpoint-lag",
      frozenRefs: IDENTIFY_FROZEN_REFS,
      pairing: [
        pairingOf({ space: SPACE_A, applicability: APPLICABILITY_A, monitoring: MONITORING_A }),
      ],
    });
    harness.identification.setAcceptedRiskRecordRefs([]);
    harness.identification.setReviewWaiting(undefined);
    // 检查点写入 failure：prepare 的业务事实已提交，持久检查点仍停在准备前状态。
    await expect(harness.riskFlowRuntime.start(run)).rejects.toMatchObject({
      error: { code: "RETRYABLE_INFRASTRUCTURE_FAILURE", retryable: true },
    });
    const rowsBeforeLoss = await harness.adapter.registrationStore.listRunRows({
      projectId: PROJECT_ID,
      runId: run.runRef.reference.entityId,
    });
    expect(rowsBeforeLoss.some((row) => row.resultKind === "stage-result")).toBe(true);
    const cursor = await readLatestState(harness, run.runRef, "workflow.resume");
    expect(cursor?.stage).toBe("identification");

    // 证明该领先的登记事实丢失（引用无法回读）：业务领先但无法证明。
    await postgres.adminPool.query(
      "DELETE FROM business.workflow_graph_results WHERE project_id = $1 AND run_id = $2 AND result_kind = 'stage-result'",
      [PROJECT_ID, run.runRef.reference.entityId],
    );
    const rowsBefore = await harness.adapter.registrationStore.listRunRows({
      projectId: PROJECT_ID,
      runId: run.runRef.reference.entityId,
    });
    const linksBefore = await harness.adapter.registrationStore.listRunLinks({
      projectId: PROJECT_ID,
      runId: run.runRef.reference.entityId,
    });
    const auditBefore = await postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit.entries WHERE project_id = $1 AND action LIKE 'risk-flow-%'",
      [PROJECT_ID],
    );

    await expect(
      harness.riskFlowRuntime.resume({
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        authorization: authorizationFor("workflow.resume", [SPACE_A, SPACE_B]),
        commandId: "c30-resume-checkpoint-lag",
        idempotencyKey: "c30-resume-checkpoint-lag",
        issuedAt: TIMESTAMP,
        validAt: TIMESTAMP,
        runRef: run.runRef,
        expectedRunVersionId: cursor?.runVersionId ?? "",
        resumeCause: { kind: "reevaluate", reasonCode: "checkpoint-lag" },
      }),
    ).rejects.toMatchObject({
      error: {
        code: "CHECKPOINT_INCONSISTENT",
        retryable: false,
        detailCode: "checkpoint-inconsistent",
      },
    });

    // 零补写：不补造阶段结果、不新增登记行/链边/审计，也不推进业务状态。
    expect(
      (
        await harness.adapter.registrationStore.listRunRows({
          projectId: PROJECT_ID,
          runId: run.runRef.reference.entityId,
        })
      ).map((row) => `${row.resultKind}/${row.resultId}/${row.resultVersionId}`),
    ).toEqual(rowsBefore.map((row) => `${row.resultKind}/${row.resultId}/${row.resultVersionId}`));
    expect(
      (
        await harness.adapter.registrationStore.listRunLinks({
          projectId: PROJECT_ID,
          runId: run.runRef.reference.entityId,
        })
      ).map((link) => link.linkId),
    ).toEqual(linksBefore.map((link) => link.linkId));
    const auditAfter = await postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit.entries WHERE project_id = $1 AND action LIKE 'risk-flow-%'",
      [PROJECT_ID],
    );
    expect(auditAfter.rows[0]?.count).toBe(auditBefore.rows[0]?.count);
    const after = await readLatestState(harness, run.runRef, "workflow.resume");
    expect(after?.runVersionId).toBe(cursor?.runVersionId);
    expect(after?.stage).toBe("identification");
  }, 120_000);
});

/**
 * C41 接线等待/恢复门：等待模式的预测运行只认人工采纳事实。
 *
 * 与上一组用例相同只能真实 PostgreSQL + 真实 LangGraph + 真实 C03/C04，唯一差别是 C05 复验身份
 * 只授权一个空间（等待门要求唯一已授权空间，且登记行的授权范围摘要必须与复验结果逐项一致）。
 */
describe("C30 人工决定等待门（唯一已授权空间）", () => {
  let postgres: PostgresTestFixture;
  let harness: RiskFlowHarnessV1;

  beforeAll(async () => {
    postgres = await startPostgresFixture();
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
      additionalMigrationRoots: [postgres.fixtureMigrationRoot],
    });
    harness = await startHarness(postgres, { authorizationScopes: [SPACE_A] });
    // 评估子运行替身停在人工确认等待：父运行据此如实登记等待，不猜测结论。
    harness.assessment.setStatus("waiting", USER_CONFIRMATION_WAITING);
  }, 300_000);

  afterAll(async () => {
    await harness?.close().catch(() => undefined);
    await postgres?.close().catch(() => undefined);
  }, 120_000);

  const rowsOf = (runRef: WorkflowRunRefV1): Promise<readonly WorkflowGraphResultRowV1[]> =>
    harness.adapter.registrationStore.listRunRows({
      projectId: PROJECT_ID,
      runId: runRef.reference.entityId,
    });

  /** C30 业务事实的审计条目数（工件读访问审计不属于业务补写，不计入）。 */
  const auditCount = async (): Promise<number> => {
    const result = await postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit.entries WHERE project_id = $1 AND action LIKE 'risk-flow-%'",
      [PROJECT_ID],
    );
    return Number(result.rows[0]?.count ?? "0");
  };

  /** 每个用例一份独立冻结输入：运行身份由冻结引用派生，用例之间不得命中同一运行。 */
  const forecastEntryFor = (variant: string, waitForDecision: boolean) => {
    const refs = {
      adoptedRecommendationRef: {
        kind: "response-recommendation" as const,
        reference: { entityId: `response-recommendation-c30-${variant}`, versionId: "v1" },
      },
      preActionMonitoringSnapshotRef: {
        kind: "monitoring-snapshot" as const,
        reference: { entityId: `monitoring-forecast-c30-${variant}`, versionId: "v1" },
      },
      assessmentBasisReleaseSetRef: {
        kind: "assessment-basis-release-set" as const,
        reference: { entityId: `basis-forecast-c30-${variant}`, versionId: "v1" },
      },
      frozenAssessmentBasisRef: {
        kind: "assessment-input-snapshot" as const,
        reference: { entityId: `assessment-input-forecast-c30-${variant}`, versionId: "v1" },
      },
    };
    const { adoptedRecommendationRef, preActionMonitoringSnapshotRef } = refs;
    return {
      refs,
      runRef: workflowRunIdentityFor({
        projectId: PROJECT_ID,
        entryMode: "forecast-response",
        entryIdentity: workflowEntryIdentityFor({
          entryMode: "forecast-response",
          projectId: PROJECT_ID,
          frozenRefs: [
            adoptedRecommendationRef,
            preActionMonitoringSnapshotRef,
            refs.assessmentBasisReleaseSetRef,
            refs.frozenAssessmentBasisRef,
          ],
        }),
        graphVersion: GRAPH_VERSION,
      }).runRef,
      payload: {
        entryMode: "forecast-response" as const,
        graphVersion: GRAPH_VERSION,
        retryPolicyRef: RETRY_POLICY_REF,
        ...refs,
        ...(waitForDecision ? { waitForDecision: true as const } : {}),
      },
    };
  };

  it("命令身份绑定先于图调用：同键异载荷失败，重放不产生第二次绑定审计", async () => {
    harness.assessment.commands.length = 0;
    const entry = forecastEntryFor("binding", true);
    const command: StartWorkflowRunCommandV1 = {
      kind: "start-run",
      commandId: "c30-start-run-bound",
      idempotencyKey: "c30-start-run-bound",
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      issuedAt: TIMESTAMP,
      authorization: authorizationFor("workflow.start", [SPACE_A]),
      payload: entry.payload,
    };
    /** 命令身份绑定审计：只按命令身份查，不按运行分区（绑定早于任何图登记）。 */
    const boundAuditRows = async () => {
      const result = await postgres.adminPool.query<{ action: string; command_id: string }>(
        "SELECT action, command_id FROM audit.entries WHERE project_id = $1 AND command_id = $2 AND action = 'workflow.start-run-bound'",
        [PROJECT_ID, command.commandId],
      );
      return result.rows;
    };
    const started = await harness.riskFlowRuntime.workflowPort.startRun(command);
    expect(started.kind).toBe("waiting");
    if (started.kind !== "waiting") return;
    expect(started.workflowRunRef).toEqual(entry.runRef);

    // 绑定审计与运行登记审计分别描述各自事实；绑定只写一次。
    const boundAudit = await boundAuditRows();
    expect(boundAudit).toHaveLength(1);
    expect(boundAudit[0]).toMatchObject({ action: "workflow.start-run-bound" });

    // 同命令身份重放：不重复绑定审计，也不产生第二个运行。
    const replay = await harness.riskFlowRuntime.workflowPort.startRun(command);
    expect(replay.kind === "waiting" ? replay.workflowRunRef : undefined).toEqual(entry.runRef);
    expect(await boundAuditRows()).toHaveLength(1);

    // 同键异载荷：绑定阶段即失败，不进入第二个图/评估运行。
    const conflicting = await harness.riskFlowRuntime.workflowPort.startRun({
      ...command,
      payload: forecastEntryFor("binding-other", true).payload,
    });
    expect(conflicting.kind).toBe("failed");
    expect(harness.assessment.commands).toEqual([]);
    expect(await boundAuditRows()).toHaveLength(1);
  }, 120_000);

  it("C41/S1 等待模式的预测运行只登记等待与入口事实，同键重放返回同一运行引用", async () => {
    harness.assessment.commands.length = 0;
    harness.humanDecisionProof.queries.length = 0;
    const entry = forecastEntryFor("waiting-replay", true);
    const command: StartWorkflowRunCommandV1 = {
      kind: "start-run",
      commandId: "c30-forecast-waiting",
      idempotencyKey: "c30-forecast-waiting",
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      issuedAt: TIMESTAMP,
      authorization: authorizationFor("workflow.start", [SPACE_A]),
      payload: entry.payload,
    };
    const started = await harness.riskFlowRuntime.workflowPort.startRun(command);
    expect(started.kind).toBe("waiting");
    if (started.kind !== "waiting") return;
    // 等待引用自带精确建议与唯一已授权空间；运行引用由公式派生并原样返回，调用方不自行派生。
    expect(started.waiting).toMatchObject({
      kind: "human-decision",
      responseRecommendationRef: entry.refs.adoptedRecommendationRef,
      spatialScopeRef: SPACE_A,
    });
    expect(started.workflowRunRef).toEqual(entry.runRef);

    // 等待态零评估、零预测：没有评估子运行启动，也没有评估子运行路由行。
    expect(harness.assessment.commands).toEqual([]);
    const rows = await rowsOf(entry.runRef);
    expect(rows.filter((row) => row.resultKind === "waiting")).toHaveLength(1);
    expect(
      rows.filter(
        (row) => row.resultKind === "route-decision" && row.routeKind === "assessment-sub-run",
      ),
    ).toEqual([]);
    const waitingRow = rows.find((row) => row.resultKind === "waiting");
    if (waitingRow?.waitingRef?.kind !== "human-decision") {
      throw new TypeError("waiting row must carry the human decision reference");
    }
    // 等待行的决定路由引用就是本运行登记的入口路由引用（同一身份，可据它请求采纳证明）。
    expect(
      rows.some(
        (row) =>
          row.resultKind === "route-decision" &&
          row.routeKind === "entry-accepted" &&
          row.routeDecisionRef?.reference.entityId ===
            waitingRow.waitingRef.routeDecisionRef.reference.entityId &&
          row.routeDecisionRef?.reference.versionId ===
            waitingRow.waitingRef.routeDecisionRef.reference.versionId,
      ),
    ).toBe(true);
    const state = await readLatestState(harness, entry.runRef, "workflow.start");
    expect(state?.status).toBe("waiting");
    expect(state?.stage).toBe("assessment");

    // 同一命令身份重放：命中同一运行引用与同一登记事实，不产生第二个等待或子运行。
    const replay = await harness.riskFlowRuntime.workflowPort.startRun(command);
    expect(replay.kind).toBe("waiting");
    expect(replay.kind === "waiting" ? replay.workflowRunRef : undefined).toEqual(entry.runRef);
    expect(harness.assessment.commands).toEqual([]);
    const rowsAfterReplay = await rowsOf(entry.runRef);
    expect(
      rowsAfterReplay.map((row) => `${row.resultKind}/${row.resultId}/${row.resultVersionId}`),
    ).toEqual(rows.map((row) => `${row.resultKind}/${row.resultId}/${row.resultVersionId}`));
  }, 120_000);

  it("C41/S1 等待中的预测运行收到其它恢复原因一律失败关闭且零预测", async () => {
    harness.assessment.commands.length = 0;
    const entry = forecastEntryFor("other-cause", true);
    const started = await harness.riskFlowRuntime.workflowPort.startRun({
      kind: "start-run",
      commandId: "c30-forecast-waiting-other-cause",
      idempotencyKey: "c30-forecast-waiting-other-cause",
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      issuedAt: TIMESTAMP,
      authorization: authorizationFor("workflow.start", [SPACE_A]),
      payload: entry.payload,
    });
    if (started.kind !== "waiting" || started.workflowRunRef === undefined) {
      throw new TypeError("waiting mode must return the registered run reference");
    }
    const runRef = started.workflowRunRef;
    const cursor = await readLatestState(harness, runRef, "workflow.resume");
    expect(cursor?.status).toBe("waiting");
    const rowsBefore = await rowsOf(runRef);
    const auditBefore = await auditCount();
    harness.humanDecisionProof.queries.length = 0;

    for (const resumeCause of [
      {
        kind: "user-confirmed" as const,
        userConfirmationRef: {
          kind: "user-confirmation" as const,
          reference: { entityId: "user-confirmation-waiting-gate", versionId: "v1" },
        },
      },
      {
        kind: "transient-recovered" as const,
        workflowErrorRef: {
          kind: "workflow-error" as const,
          reference: { entityId: "workflow-error-waiting-gate", versionId: "v1" },
        },
        diagnosticArtifactRef: {
          kind: "diagnostic-artifact" as const,
          reference: { entityId: "diagnostic-waiting-gate", versionId: "v1" },
        },
      },
    ]) {
      const denied = await harness.riskFlowRuntime.workflowPort.resumeRun({
        kind: "resume-run",
        commandId: `c30-resume-waiting-denied:${resumeCause.kind}`,
        idempotencyKey: `c30-resume-waiting-denied:${resumeCause.kind}`,
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        issuedAt: TIMESTAMP,
        authorization: authorizationFor("workflow.resume", [SPACE_A]),
        payload: {
          workflowRunRef: runRef,
          expectedStateVersion: cursor?.runVersionId ?? "",
          resumeCause,
        },
      });
      expect(denied).toMatchObject({
        kind: "failed",
        error: { code: "BUSINESS_BLOCKED", category: "business-blocked", retryable: false },
      });
    }
    // 零预测、零补写，也不向 C41 证明端口发问。
    expect(harness.assessment.commands).toEqual([]);
    expect(harness.humanDecisionProof.queries).toEqual([]);
    expect(
      (await rowsOf(runRef)).map(
        (row) => `${row.resultKind}/${row.resultId}/${row.resultVersionId}`,
      ),
    ).toEqual(rowsBefore.map((row) => `${row.resultKind}/${row.resultId}/${row.resultVersionId}`));
    expect(await auditCount()).toBe(auditBefore);
    expect((await readLatestState(harness, runRef, "workflow.resume"))?.status).toBe("waiting");
  }, 120_000);

  it("C41/S2 人工采纳证明核对通过后恢复等待运行并建立唯一评估子运行", async () => {
    harness.assessment.commands.length = 0;
    harness.humanDecisionProof.setMode("adopted");
    harness.humanDecisionProof.queries.length = 0;
    const entry = forecastEntryFor("commit", true);
    const started = await harness.riskFlowRuntime.workflowPort.startRun({
      kind: "start-run",
      commandId: "c30-forecast-commit",
      idempotencyKey: "c30-forecast-commit",
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      issuedAt: TIMESTAMP,
      authorization: authorizationFor("workflow.start", [SPACE_A]),
      payload: entry.payload,
    });
    if (started.kind !== "waiting" || started.workflowRunRef === undefined) {
      throw new TypeError("waiting mode must return the registered run reference");
    }
    const runRef = started.workflowRunRef;
    const waitingRow = (await rowsOf(runRef)).find(
      (row) => row.resultKind === "waiting" && row.waitingRef?.kind === "human-decision",
    );
    if (waitingRow?.waitingRef?.kind !== "human-decision") {
      throw new TypeError("waiting row must carry the human decision reference");
    }
    const decisionRef = waitingRow.waitingRef.routeDecisionRef;
    const cursor = await readLatestState(harness, runRef, "workflow.resume");
    expect(cursor?.status).toBe("waiting");

    const resumed = await harness.riskFlowRuntime.workflowPort.resumeRun({
      kind: "resume-run",
      commandId: "c30-resume-human-decision-committed",
      idempotencyKey: "c30-resume-human-decision-committed",
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      issuedAt: TIMESTAMP,
      authorization: authorizationFor("workflow.resume", [SPACE_A]),
      payload: {
        workflowRunRef: runRef,
        expectedStateVersion: cursor?.runVersionId ?? "",
        resumeCause: { kind: "human-decision-committed", routeDecisionRef: decisionRef },
      },
    });
    // 决定成立后父运行推进到评估阶段；子运行替身停在人工确认等待，因此父运行如实保持等待。
    expect(resumed.kind).toBe("waiting");
    expect(harness.humanDecisionProof.queries).toHaveLength(1);
    // 证明按恢复命令自身身份复验（真实 C05 下签发 id 与复验 id 必须一致）。
    expect(harness.humanDecisionProof.queries[0]?.queryId).toBe(
      "c30-resume-human-decision-committed",
    );
    expect(harness.humanDecisionProof.queries[0]?.payload).toEqual({
      routeDecisionRef: decisionRef,
      workflowRunRef: runRef,
      responseRecommendationRef: entry.refs.adoptedRecommendationRef,
    });
    // 恰好一个评估子运行，且它携带已证实的采纳决定引用与唯一已授权空间（A0/A2 的精确输入）。
    expect(harness.assessment.commands).toHaveLength(1);
    const childCommand = harness.assessment.commands[0];
    expect(childCommand?.parentRunRef).toEqual(runRef);
    expect(childCommand?.entryMode).toBe("forecast-response");
    expect(childCommand?.frozenRefs).toContainEqual(decisionRef);
    expect(childCommand?.frozenRefs).toContainEqual(SPACE_A);
    expect(childCommand?.frozenRefs).toContainEqual(entry.refs.frozenAssessmentBasisRef);
    expect(childCommand?.frozenRefs.filter((ref) => ref.kind === "route-decision")).toEqual([
      decisionRef,
    ]);
    // 决定引用以精确路由行登记，父运行据此可追溯来源。
    expect(
      (await rowsOf(runRef)).filter(
        (row) =>
          row.resultKind === "route-decision" && row.routeKind === "human-decision-committed",
      ),
    ).toHaveLength(1);
  }, 120_000);

  it("C41/S2 采纳证明失败或错配（运行/建议/空间）时保持等待且零预测", async () => {
    for (const mode of ["failed", "wrong-run", "wrong-recommendation", "wrong-scope"] as const) {
      harness.assessment.commands.length = 0;
      harness.humanDecisionProof.setMode("adopted");
      const entry = forecastEntryFor(`proof-${mode}`, true);
      const started = await harness.riskFlowRuntime.workflowPort.startRun({
        kind: "start-run",
        commandId: `c30-forecast-proof-${mode}`,
        idempotencyKey: `c30-forecast-proof-${mode}`,
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        issuedAt: TIMESTAMP,
        authorization: authorizationFor("workflow.start", [SPACE_A]),
        payload: entry.payload,
      });
      if (started.kind !== "waiting" || started.workflowRunRef === undefined) {
        throw new TypeError("waiting mode must return the registered run reference");
      }
      const runRef = started.workflowRunRef;
      const waitingRow = (await rowsOf(runRef)).find(
        (row) => row.resultKind === "waiting" && row.waitingRef?.kind === "human-decision",
      );
      if (waitingRow?.waitingRef?.kind !== "human-decision") {
        throw new TypeError("waiting row must carry the human decision reference");
      }
      const cursor = await readLatestState(harness, runRef, "workflow.resume");
      const rowsBefore = await rowsOf(runRef);
      harness.humanDecisionProof.setMode(mode);

      const denied = await harness.riskFlowRuntime.workflowPort.resumeRun({
        kind: "resume-run",
        commandId: `c30-resume-proof-denied:${mode}`,
        idempotencyKey: `c30-resume-proof-denied:${mode}`,
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        issuedAt: TIMESTAMP,
        authorization: authorizationFor("workflow.resume", [SPACE_A]),
        payload: {
          workflowRunRef: runRef,
          expectedStateVersion: cursor?.runVersionId ?? "",
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
      // 保持等待、零预测、零补写：不追加决定路由行，也不启动评估子运行。
      expect(harness.assessment.commands).toEqual([]);
      const rowsAfter = await rowsOf(runRef);
      expect(
        rowsAfter.map((row) => `${row.resultKind}/${row.resultId}/${row.resultVersionId}`),
      ).toEqual(
        rowsBefore.map((row) => `${row.resultKind}/${row.resultId}/${row.resultVersionId}`),
      );
      expect(rowsAfter.filter((row) => row.routeKind === "human-decision-committed")).toEqual([]);
      expect((await readLatestState(harness, runRef, "workflow.resume"))?.status).toBe("waiting");
    }
    harness.humanDecisionProof.setMode("adopted");
  }, 300_000);

  it("C41/S2 等待模式之外不改变入口语义，且不猜测空间", async () => {
    harness.assessment.commands.length = 0;
    // 非等待调度：`forecast-response` 保持原语义（冻结集合不含空间与决定引用，直接进入评估阶段）。
    const entry = forecastEntryFor("default-semantics", false);
    const started = await harness.riskFlowRuntime.workflowPort.startRun({
      kind: "start-run",
      commandId: "c30-forecast-default-semantics",
      idempotencyKey: "c30-forecast-default-semantics",
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      issuedAt: TIMESTAMP,
      authorization: authorizationFor("workflow.start", [SPACE_A]),
      payload: entry.payload,
    });
    expect(started.kind).not.toBe("failed");
    expect(harness.assessment.commands).toHaveLength(1);
    expect(harness.assessment.commands[0]?.frozenRefs).not.toContainEqual(SPACE_A);
    expect(
      harness.assessment.commands[0]?.frozenRefs.filter((ref) => ref.kind === "route-decision"),
    ).toEqual([]);

    // 等待模式但不支持的空间范围（多于一个已授权空间）：类型化失败收口，绝不猜测空间。
    const ambiguous = forecastEntryFor("ambiguous-space", true);
    const denied = await harness.riskFlowRuntime.workflowPort.startRun({
      kind: "start-run",
      commandId: "c30-forecast-waiting-ambiguous-space",
      idempotencyKey: "c30-forecast-waiting-ambiguous-space",
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      issuedAt: TIMESTAMP,
      authorization: authorizationFor("workflow.start", [SPACE_A, SPACE_B]),
      payload: ambiguous.payload,
    });
    expect(denied).toMatchObject({
      kind: "failed",
      error: {
        code: "BUSINESS_BLOCKED",
        blockerKind: "wait-for-decision-unsupported",
        stageCode: "preparing",
      },
    });
    expect(harness.assessment.commands).toHaveLength(1);
  }, 120_000);
});
