/**
 * C41 人工决定与反馈命令 PostgreSQL 组合夹具：包装真实 C28/C27/C25/C14/C04/C03 链，
 * 并接入真实 C30 登记端口与绑定证明，用于 IP-4/IP-5/IP-6/IP-8 的可运行证据。
 *
 * **替身面（必读；替身只补 packages 内不可达的运行时，不复制任何业务算法）**
 * 1. C30 **写**入口 `WorkflowPortV1`（`startRun`/`resumeRun`/`cancelRun`）是薄替身 `C30WriteStandInV1`：
 *    不复制 C30 图或业务算法，只做三件事——用真实 C30 登记端口把「人工采纳前等待中的真实运行」写成
 *    真实登记行（run-state `status: "waiting"` + `human-decision` 等待行 + 入口 `route-decision` 行
 *    + `run-state` 行），返回 `{kind:"waiting", waiting, workflowRunRef}`，并记录调用日志供「决定前
 *    零预测 / 恢复只发生一次 / 后续分段只以精确 feedbackRef 启动」断言。真实 C30 运行时在
 *    `apps/worker/src/risk-flow/`，测试树不得导入 `apps/**`。
 * 2. 替身在写入登记行前用**真实 C05** 复验 C41 传入的授权上下文：C05 要求复验用的 `invocationId`
 *    与签发时一致，故夹具在签发每一份授权时记录 `contextRef → invocationId`，替身按该记录复验
 *    （等价于组合根按运行时派生 id 签发；替身不猜测 id）。
 * 3. `basis` 与 `measureReleases` 两个只读接缝以显式失败替身注入：C41 只调用
 *    `readRecommendationContext`（只读 C27/C28/C25 与 C30 表，不触达这两个接缝）。
 * 4. C25 合成夹具使用固定 `c25-engine-run`，未登记 C30 运行；完成性证明在此以可控替身注入，
 *    真实 C30 证明由 `postgres-workflow-adapter.test.ts` 单独验证。
 *
 * 其余全部真实：Testcontainers PostgreSQL + 完整生产迁移链（含 C41 `000051`）、真实 C03 事务/审计/回执、
 * 真实 C04 文件系统工件、真实 C28 决定/执行/反馈写入、真实 C25 评估链与精确评估证明、
 * 真实 C30 登记端口与绑定证明、真实 C05 授权复验。
 */
import type { Kysely } from "kysely";

import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import type { HumanDecisionFeedbackDownstreamAuthorizerV1 } from "@riskflow/core/human-decision-feedback";
import type { ResponseLifecycleContextReaderV1 } from "@riskflow/core/response-lifecycle";
import { sha256CanonicalJson, type TransactionUnitV1 } from "@riskflow/core/persistence";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";
import type { AssessmentBasisReleaseSetReaderV1 } from "@riskflow/core/scoring-rules";
import {
  WorkflowGraphResultRowV1Schema,
  WorkflowGraphRunStateV1Schema,
  type WorkflowGraphResultRowV1,
  type WorkflowGraphRunStateV1,
} from "@riskflow/core/workflow";
import type { VersionReference } from "@riskflow/contracts/common";
import {
  AuthorizationContextV1Schema,
  ModuleErrorV1Schema,
  StartWorkflowRunCommandV1Schema,
  WarningResponseRecordCommandV1Schema,
  type AuthorizationContextV1,
  type ActualAssessmentProofResultV1,
  type CancelWorkflowRunCommandV1,
  type CancelWorkflowRunResultV1,
  type ContentArtifactRefV1,
  type ExecutionRecordRefV1,
  type HumanDecisionFeedbackCommandV1,
  type HumanDecisionProofResultV1,
  type HumanDecisionProofQueryV1,
  type ModuleBranchV1,
  type ModuleErrorV1,
  type MonitoringSnapshotRefV1,
  type ResumeWorkflowRunCommandV1,
  type ResumeWorkflowRunResultV1,
  type ResponseRecommendationRefV1,
  type ResponseWorkflowBindingProofResultV1,
  type RiskAssessmentRecordRefV1,
  type RouteDecisionRefV1,
  type SpatialScopeRefV1,
  type StartWorkflowRunCommandV1,
  type StartWorkflowRunResultV1,
  type WarningResponseRecordCommandV1,
  type WarningResponseRecordResultV1,
  type WaitingRefV1,
  type WorkflowPortV1,
  type WorkflowRunRefV1,
} from "@riskflow/contracts/ports";

import {
  createPostgresHumanDecisionFeedbackAdapter,
  type PostgresHumanDecisionFeedbackAdapter,
} from "../../src/human-decision-feedback/index.js";
import { createPostgresResponseLifecycleContextReader } from "../../src/response-lifecycle/index.js";
import type { PostgresDatabase } from "../../src/postgres/types.js";
import {
  createPostgresWorkflowAdapter,
  type PostgresWorkflowAdapterV1,
} from "../../src/workflow/postgres-workflow-adapter.js";
import {
  C28_EXECUTION_TIME,
  C28_FEEDBACK_TIME,
  C28_FIXTURE_TIME,
  startResponseLifecycleFixture,
  type ResponseLifecyclePostgresFixtureV1,
} from "../response-lifecycle/fixture.js";

/** C41 命令与夹具的公共时点：与 C28 夹具同一时间基（执行晚于决定、反馈晚于执行）。 */
export const C41_FIXTURE_TIME = C28_FIXTURE_TIME;
export const C41_EXECUTION_TIME = C28_EXECUTION_TIME;
export const C41_FEEDBACK_TIME = C28_FEEDBACK_TIME;

/** 服务端已发布的 C30 入口控制：测试常量，绝不来自客户端（design D2）。 */
export const C41_GRAPH_VERSION: VersionReference = {
  entityId: "risk-flow-graph",
  versionId: "c41-fixture-graph-v1",
};
export const C41_RETRY_POLICY_REF: VersionReference = {
  entityId: "workflow-retry-policy",
  versionId: "1",
};

/** 与 C26/C27/C28 夹具同一名 C25 管理员会话（口令已按既有夹具轮换一次）。 */
const C25_MANAGER_LOGIN_NAME = "c25-engine-manager";
const C25_MANAGER_PASSWORD = "c25-engine-manager-password-changed";
const C41_FIXTURE_LOGIN_ATTEMPT = "c41-human-decision-login";
const ENTRY_ROUTE_KIND = "entry-accepted" as const;

export type AdoptRecommendationCommandV1 = Extract<
  WarningResponseRecordCommandV1,
  { readonly kind: "adopt-recommendation" }
>;
export type RecordExecutionCommandV1 = Extract<
  WarningResponseRecordCommandV1,
  { readonly kind: "record-execution" }
>;
export type RecordFeedbackCommandV1 = Extract<
  WarningResponseRecordCommandV1,
  { readonly kind: "record-feedback" }
>;

export interface HumanDecisionProofRequestV1 {
  /** 覆盖默认 queryId：需要变更授权空间/来源的用例必须换 id，避免 C05 幂等键命中异载荷。 */
  readonly queryId?: string;
  readonly routeDecisionRef: RouteDecisionRefV1;
  readonly workflowRunRef: WorkflowRunRefV1;
  readonly responseRecommendationRef: ResponseRecommendationRefV1;
  readonly spatialScopeRef?: SpatialScopeRefV1;
  readonly actorId?: string;
  readonly authorization?: AuthorizationContextV1;
}

/** 等待模式创建的真实运行引用：按「工程 + 业务幂等键 + 精确采纳建议」稳定派生（替身与用例共用）。 */
export const c41WaitingRunRefFor = (input: {
  readonly projectId: string;
  readonly idempotencyKey: string;
  readonly adoptedRecommendationRef: ResponseRecommendationRefV1;
}): WorkflowRunRefV1 => ({
  kind: "workflow-run",
  reference: {
    entityId: `risk-flow-run:${sha256CanonicalJson({
      projectId: input.projectId,
      idempotencyKey: input.idempotencyKey,
      recommendation: input.adoptedRecommendationRef,
    }).slice(0, 32)}`,
    versionId: "1",
  },
});

const unsupportedError = (causalRunId: string): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    code: "UNSUPPORTED_CONTRACT",
    category: "technical",
    retryable: false,
    stageCode: "c41-fixture.c30-write-stand-in",
    occurredAt: C41_FIXTURE_TIME,
    causalRunId,
    schemaVersion: "1",
  });

/** C30 写入口替身的注入接缝（见文件头「替身面」）。 */
export interface C30WriteStandInDepsV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly registrationStore: PostgresWorkflowAdapterV1["registrationStore"];
  readonly bodies: PostgresWorkflowAdapterV1["bodies"];
  readonly transactionUnit: TransactionUnitV1;
  /** 按签发时的 invocationId 复验指定上下文：C05 要求复验 id 与签发 id 一致。 */
  readonly verifyAsIssued: (input: {
    readonly authorization: AuthorizationContextV1;
    readonly branch: ModuleBranchV1;
    readonly requestedAt: string;
  }) => Promise<AuthorizationContextV1>;
  readonly authorizeFor: (input: {
    readonly branch: ModuleBranchV1;
    readonly invocationId: string;
    readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
    readonly requestedAt: string;
  }) => Promise<AuthorizationContextV1>;
}

/** C30 **写**入口替身：真实登记行 + 真实 C05 复验 + 调用日志（见文件头「替身面」）。 */
export class C30WriteStandIn implements WorkflowPortV1 {
  readonly startCalls: StartWorkflowRunCommandV1[] = [];
  readonly resumeCalls: ResumeWorkflowRunCommandV1[] = [];
  readonly waitingRunRefs: WorkflowRunRefV1[] = [];
  /** 后续反馈分段（`record-response-feedback`）启动调用，供「只以精确引用启动」断言。 */
  readonly segmentStartCalls: StartWorkflowRunCommandV1[] = [];
  /**
   * 测试可控的 `startRun` 处置：`waiting` 为真实等待登记（默认）；`already-advanced` 模拟运行在
   * 人工采纳前已被推进（非等待态），用于「绑定尚未成立即失败关闭」的用例。
   */
  startDisposition: "waiting" | "already-advanced" = "waiting";
  /**
   * 测试可控的等待登记错配（决定写入前必须失败关闭）：`wrong-recommendation` 让等待行指向另一建议，
   * `unregistered-run` 返回一个从未登记过事实的运行引用，`missing-wait-state-version` 交出真实运行
   * 但不给等待点状态版本（drift design D-02：缺失即失败闭合，不以运行登记摘要顶替）。
   */
  bindingFault:
    "none" | "wrong-recommendation" | "unregistered-run" | "missing-wait-state-version" = "none";
  readonly #deps: C30WriteStandInDepsV1;

  constructor(deps: C30WriteStandInDepsV1) {
    this.#deps = deps;
  }

  async startRun(command: StartWorkflowRunCommandV1): Promise<StartWorkflowRunResultV1> {
    const parsed = StartWorkflowRunCommandV1Schema.parse(command);
    const payload = parsed.payload;
    // 先按真实 C05 复验 C41 传入的授权：替身不自行放宽授权语义。
    const verified = await this.#deps
      .verifyAsIssued({
        authorization: parsed.authorization,
        branch: "workflow.start-run",
        requestedAt: parsed.issuedAt,
      })
      .catch((): undefined => undefined);
    if (verified === undefined) {
      return { kind: "failed", error: unsupportedError(parsed.commandId) };
    }
    // 反馈分段入口：只记录精确引用并返回已启动运行，不重做人工录入（design D4）。
    if (payload.entryMode === "record-response-feedback") {
      this.segmentStartCalls.push(parsed);
      return {
        kind: "succeeded",
        result: {
          workflowRunRef: {
            kind: "workflow-run",
            reference: {
              entityId: `risk-flow-run:feedback-segment:${sha256CanonicalJson({
                projectId: parsed.projectId,
                idempotencyKey: parsed.idempotencyKey,
                feedbackRef: payload.feedbackRef,
              }).slice(0, 24)}`,
              versionId: "1",
            },
          },
          disposition: "created",
        },
      };
    }
    const spatialScopeRefs = verified.spatialScopeRefs;
    if (
      payload.entryMode !== "forecast-response" ||
      payload.waitForDecision !== true ||
      spatialScopeRefs.length !== 1
    ) {
      // 等待模式只接受恰好一个已授权空间，不猜测空间、也不复用其它入口语义（design D2）。
      return { kind: "failed", error: unsupportedError(parsed.commandId) };
    }
    const spatialScopeRef = spatialScopeRefs[0] as SpatialScopeRefV1;
    this.startCalls.push(parsed);
    const runRef = c41WaitingRunRefFor({
      projectId: parsed.projectId,
      idempotencyKey: parsed.idempotencyKey,
      adoptedRecommendationRef: payload.adoptedRecommendationRef,
    });
    if (this.startDisposition === "already-advanced") {
      // 运行已推进（非等待态）：不登记等待事实，调用方必须安全失败而不是把已推进运行当绑定。
      return { kind: "succeeded", result: { workflowRunRef: runRef, disposition: "created" } };
    }
    if (this.bindingFault === "unregistered-run") {
      // 返回从未登记事实的运行引用：绑定证明必然读不到该运行，调用方必须失败关闭。
      const foreignRunRef: WorkflowRunRefV1 = {
        kind: "workflow-run",
        reference: { entityId: `${runRef.reference.entityId}:unregistered`, versionId: "1" },
      };
      return {
        kind: "waiting",
        waiting: {
          kind: "human-decision",
          routeDecisionRef: {
            kind: "route-decision",
            reference: {
              entityId: `risk-flow-entry:${foreignRunRef.reference.entityId}`,
              versionId: "c41-unregistered-run",
            },
          },
          responseRecommendationRef: payload.adoptedRecommendationRef,
          spatialScopeRef,
        },
        workflowRunRef: foreignRunRef,
      };
    }
    const existing = await this.#deps.registrationStore.listRunRows({
      projectId: this.#deps.projectId,
      runId: runRef.reference.entityId,
    });
    const existingWaitings = existing.filter(
      (row) => row.resultKind === "waiting" && row.waitingRef?.kind === "human-decision",
    );
    const existingWaiting =
      existingWaitings.length === 1 ? existingWaitings[0]?.waitingRef : undefined;
    if (existingWaiting?.kind === "human-decision") {
      // 同业务幂等身份重放：返回同一运行引用，不重复登记事实（design D2）。等待点状态版本
      // 取本运行已登记的 run-state 行版本——C30 绑定证明回读的正文版本与之逐字一致。
      return {
        kind: "waiting",
        waiting: existingWaiting,
        workflowRunRef: runRef,
        ...(this.#waitingStateVersionOf(existing) === undefined
          ? {}
          : { waitStateVersion: this.#waitingStateVersionOf(existing) as string }),
      };
    }
    const registered = await this.#registerWaitingRun({
      command: parsed,
      verified,
      // 错配建议：等待行写另一建议引用，绑定证明据此复核失败（决定写入前关闭）。
      recommendationRef:
        this.bindingFault === "wrong-recommendation"
          ? {
              kind: "response-recommendation",
              reference: {
                entityId: `${payload.adoptedRecommendationRef.reference.entityId}:decoy`,
                versionId: payload.adoptedRecommendationRef.reference.versionId,
              },
            }
          : payload.adoptedRecommendationRef,
      spatialScopeRef,
      runRef,
    });
    this.waitingRunRefs.push(runRef);
    return {
      kind: "waiting",
      waiting: registered.waiting,
      workflowRunRef: runRef,
      // 交出真实等待运行却不交等待点状态版本：调用方必须失败闭合，不按运行登记摘要继续。
      ...(this.bindingFault === "missing-wait-state-version"
        ? {}
        : { waitStateVersion: registered.waitStateVersion }),
    };
  }

  /** 已登记 run-state 行的版本即运行停在等待点时的状态版本；无登记行则不编造值。 */
  #waitingStateVersionOf(rows: readonly WorkflowGraphResultRowV1[]): string | undefined {
    return rows.find((row) => row.resultKind === "run-state")?.resultVersionId;
  }

  async resumeRun(command: ResumeWorkflowRunCommandV1): Promise<ResumeWorkflowRunResultV1> {
    const verified = await this.#deps
      .verifyAsIssued({
        authorization: command.authorization,
        branch: "workflow.resume-run",
        requestedAt: command.issuedAt,
      })
      .catch((): undefined => undefined);
    if (verified === undefined) {
      return { kind: "failed", error: unsupportedError(command.commandId) };
    }
    this.resumeCalls.push(command);
    // 恢复只把既有等待运行推进一格：替身不执行预测、不改写登记事实。
    return {
      kind: "succeeded",
      result: { workflowRunRef: command.payload.workflowRunRef, disposition: "existing" },
    };
  }

  async cancelRun(command: CancelWorkflowRunCommandV1): Promise<CancelWorkflowRunResultV1> {
    return { kind: "failed", error: unsupportedError(command.commandId) };
  }

  /** 一次动作的全部行 + run-state 正文在同一 C03 事务提交（与 C30 适配器登记契约一致）。 */
  async #registerWaitingRun(input: {
    readonly command: StartWorkflowRunCommandV1;
    readonly verified: AuthorizationContextV1;
    readonly recommendationRef: ResponseRecommendationRefV1;
    readonly spatialScopeRef: SpatialScopeRefV1;
    readonly runRef: WorkflowRunRefV1;
  }): Promise<{
    readonly waiting: Extract<WaitingRefV1, { readonly kind: "human-decision" }>;
    readonly waitStateVersion: string;
  }> {
    const deps = this.#deps;
    const runId = input.runRef.reference.entityId;
    const forecastPayload = input.command.payload as Extract<
      StartWorkflowRunCommandV1["payload"],
      { readonly entryMode: "forecast-response" }
    >;
    const frozenRefs = [
      forecastPayload.preActionMonitoringSnapshotRef,
      forecastPayload.frozenAssessmentBasisRef,
      forecastPayload.assessmentBasisReleaseSetRef,
      input.spatialScopeRef,
    ].filter((ref) => ref !== undefined);
    const entryIdentity: VersionReference = {
      entityId: `risk-flow-entry:${deps.projectId}:${input.command.payload.entryMode}`,
      versionId: sha256CanonicalJson({ entryMode: input.command.payload.entryMode, frozenRefs }),
    };
    const entryRouteRef: RouteDecisionRefV1 = {
      kind: "route-decision",
      reference: {
        entityId: `risk-flow-entry:${runId}`,
        versionId: sha256CanonicalJson({
          entryMode: input.command.payload.entryMode,
          entryIdentity,
          frozenRefs,
        }),
      },
    };
    const waiting: Extract<WaitingRefV1, { readonly kind: "human-decision" }> = {
      kind: "human-decision",
      routeDecisionRef: entryRouteRef,
      responseRecommendationRef: input.recommendationRef,
      spatialScopeRef: input.spatialScopeRef,
    };
    const stageResultRef = {
      kind: "stage-result" as const,
      reference: {
        entityId: `risk-flow-stage-result:${runId}:preparing`,
        versionId: sha256CanonicalJson({ runId, stage: "preparing", entryRouteRef }),
      },
    };
    const withoutVersion: Omit<WorkflowGraphRunStateV1, "runVersionId"> = {
      schemaVersion: "1",
      projectId: deps.projectId,
      runId,
      entryMode: input.command.payload.entryMode,
      entryIdentity,
      stage: "preparing",
      status: "waiting",
      assessmentRunRefs: [],
      acceptedRiskRecordRefs: [],
      assessmentRecordRefs: [],
      warningRecordRefs: [],
      responseRecommendationRefs: [input.recommendationRef],
      deviationRecordRefs: [],
      calibrationSuggestionRefs: [],
      lastRouteDecisionRef: entryRouteRef,
      lastStageResultRef: stageResultRef,
      lastWaitingRef: waiting,
      recordedAt: input.command.issuedAt,
    };
    const runState = WorkflowGraphRunStateV1Schema.parse({
      ...withoutVersion,
      runVersionId: sha256CanonicalJson(withoutVersion),
    });
    const runStateArtifactId = `risk-flow-graph-run-state:${runId}:${runState.runVersionId}`;
    // 正文写入前签发本子命令自己的授权：C30 适配器以同一 invocationId 复验（C05 契约）。
    const artifactRef = (await deps.bodies.putBody({
      projectId: deps.projectId,
      actorId: deps.actorId,
      commandId: `${runId}:body:${runStateArtifactId}`,
      issuedAt: input.command.issuedAt,
      artifactId: runStateArtifactId,
      body: { bodyKind: "run-state", runState },
      invocationId: `c30-body-write:${deps.projectId}:${runStateArtifactId}`,
      authorization: await deps.authorizeFor({
        branch: "workflow.start-run",
        invocationId: `c30-body-write:${deps.projectId}:${runStateArtifactId}`,
        spatialScopeRefs: [input.spatialScopeRef],
        requestedAt: input.command.issuedAt,
      }),
    })) as ContentArtifactRefV1;
    const actionId = `${runId}:prepare`;
    const base = {
      schemaVersion: "1" as const,
      projectId: deps.projectId,
      runId,
      runVersionId: runState.runVersionId,
      entryMode: input.command.payload.entryMode,
      commandId: actionId,
      actorRef: deps.actorId,
      authorizationContextRef: input.verified.authorizationContextRef,
      authorizationScopeDigest: authorizationScopeDigest(input.verified),
      validAt: input.command.issuedAt,
      recordedAt: input.command.issuedAt,
      persistedAt: input.command.issuedAt,
      auditEntryId: `${actionId}:audit`,
      frozenRefs,
    };
    const rows: WorkflowGraphResultRowV1[] = [
      WorkflowGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "route-decision",
        resultId: entryRouteRef.reference.entityId,
        resultVersionId: entryRouteRef.reference.versionId,
        idempotencyKey: `risk-flow-graph:route-decision:${runId}:prepare:${ENTRY_ROUTE_KIND}`,
        requestDigest: sha256CanonicalJson({ resultKind: "route-decision", entryRouteRef }),
        routeDecisionRef: entryRouteRef,
        routeKind: ENTRY_ROUTE_KIND,
      }),
      WorkflowGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "stage-result",
        resultId: stageResultRef.reference.entityId,
        resultVersionId: stageResultRef.reference.versionId,
        idempotencyKey: `risk-flow-graph:stage-result:${runId}:prepare`,
        requestDigest: sha256CanonicalJson({ resultKind: "stage-result", stageResultRef }),
        stage: "preparing",
        stageResultRef,
      }),
      WorkflowGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "waiting",
        resultId: `risk-flow-waiting:${runId}:${sha256CanonicalJson(waiting).slice(0, 32)}`,
        resultVersionId: sha256CanonicalJson(waiting),
        idempotencyKey: `risk-flow-graph:waiting:${runId}:${sha256CanonicalJson(waiting)}`,
        requestDigest: sha256CanonicalJson({ resultKind: "waiting", waiting }),
        stage: "preparing",
        waitingRef: waiting,
      }),
      WorkflowGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "run-state",
        resultId: artifactRef.reference.entityId,
        resultVersionId: runState.runVersionId,
        idempotencyKey: `risk-flow-graph:run-state:${runState.runVersionId}`,
        requestDigest: sha256CanonicalJson({ resultKind: "run-state", artifactRef }),
        stage: "preparing",
        artifactRef,
      }),
    ];
    await deps.transactionUnit.execute(
      {
        projectId: deps.projectId,
        commandKind: "risk-flow-graph.prepare",
        commandId: actionId,
        idempotencyKey: actionId,
        payload: { rows: rows.length },
        actorRef: deps.actorId,
        authorizationContextRef: input.verified.authorizationContextRef,
        issuedAt: input.command.issuedAt,
      },
      async (context) => {
        for (const row of rows) {
          await deps.registrationStore.registerRow(
            { row, occurredAt: input.command.issuedAt },
            context,
          );
        }
        return {
          resultRef: input.runRef,
          audit: {
            auditEntryId: `${actionId}:audit`,
            projectId: deps.projectId,
            action: "risk-flow-graph.prepare",
            targetRef: input.runRef,
            actorRef: deps.actorId,
            authorizationContextRef: input.verified.authorizationContextRef,
            occurredAt: input.command.issuedAt,
            recordedAt: input.command.issuedAt,
            version: { entityId: `${actionId}:audit`, versionId: "1" },
            commandId: actionId,
            idempotencyKey: actionId,
          },
          events: [],
        };
      },
    );
    return { waiting, waitStateVersion: runState.runVersionId };
  }
}

export interface HumanDecisionFeedbackPostgresFixtureV1 {
  /** 被包装的真实 C28 夹具（真实 C27 建议链、C28 适配器、C25 评估链、C03/C04/C14/C05）。 */
  readonly state: ResponseLifecyclePostgresFixtureV1;
  readonly db: Kysely<PostgresDatabase>;
  readonly projectId: string;
  readonly managerId: string;
  readonly access: LocalIdentityAccessV1;
  /** C41 组合适配器：同时实现 `HumanDecisionFeedbackPortV1` 与 `HumanDecisionProofPortV1`。 */
  readonly adapter: PostgresHumanDecisionFeedbackAdapter;
  /** 真实 C30 登记端口与绑定证明（绑定证明按 C30 适配器实现，未替换）。 */
  readonly workflowAdapter: PostgresWorkflowAdapterV1;
  /** C30 写入口替身（见文件头「替身面」）。 */
  readonly workflow: C30WriteStandIn;
  /** C25 fixture 的合成运行没有 C30 状态；此处只替代完成性证明供 C41 命令测试。 */
  setAssessmentRunCompleted(completed: boolean): void;
  readonly rootSpatialScopeRef: SpatialScopeRefV1;
  readonly rootSpatialScope: SpatialScopeRefV1;

  /** 按精确分支与调用身份签发真实 C06 窄上下文（夹具内所有授权的唯一签发点）。 */
  authorizeFor(input: {
    readonly branch: ModuleBranchV1;
    readonly invocationId: string;
    readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
    readonly requestedAt?: string;
  }): Promise<AuthorizationContextV1>;
  readonly authorizeDownstream: HumanDecisionFeedbackDownstreamAuthorizerV1;

  adoptCommand(input: {
    readonly commandId: string;
    readonly decision: "adopted" | "declined";
    readonly recommendationRef: ResponseRecommendationRefV1;
    readonly reasonCode?: string;
    readonly preActionMonitoringSnapshotRef?: MonitoringSnapshotRefV1;
    readonly spatialScopeRef?: SpatialScopeRefV1;
    readonly issuedAt?: string;
  }): Promise<AdoptRecommendationCommandV1>;
  executionCommand(input: {
    readonly commandId: string;
    readonly actionSource: RecordExecutionCommandV1["payload"]["actionSource"];
    readonly executedByActorId?: string;
    readonly recordedByActorId?: string;
    readonly occurredAt?: string;
    readonly spatialScopeRef?: SpatialScopeRefV1;
    readonly issuedAt?: string;
  }): Promise<RecordExecutionCommandV1>;
  feedbackCommand(input: {
    readonly commandId: string;
    readonly executionRecordRef: ExecutionRecordRefV1;
    readonly postActionMonitoringSnapshotRef: MonitoringSnapshotRefV1;
    readonly feedbackArtifactRef: ContentArtifactRefV1;
    readonly actualAssessmentRecordRef?: RiskAssessmentRecordRefV1;
    readonly occurredAt?: string;
    readonly spatialScopeRef?: SpatialScopeRefV1;
    readonly issuedAt?: string;
  }): Promise<RecordFeedbackCommandV1>;

  /** 公开入口（C41 三分支）与采纳证明入口的直接调用助手。 */
  record(command: HumanDecisionFeedbackCommandV1): Promise<WarningResponseRecordResultV1>;
  proofQuery(input: HumanDecisionProofRequestV1): Promise<HumanDecisionProofQueryV1>;
  verifyHumanDecisionCommitted(
    input: HumanDecisionProofRequestV1,
  ): Promise<HumanDecisionProofResultV1>;
  /** 用真实 C30 绑定证明端口复核指定等待运行的绑定事实（与 C41 内部同一次授权身份）。 */
  verifyBindingProof(input: {
    readonly commandId: string;
    readonly recommendationRef: ResponseRecommendationRefV1;
    readonly workflowRunRef: WorkflowRunRefV1;
    readonly spatialScopeRef?: SpatialScopeRefV1;
  }): Promise<ResponseWorkflowBindingProofResultV1>;
  /** 直接调用真实 C25 精确评估证明（与 C41 内部调用同一次授权身份）。 */
  verifyAssessmentProof(input: {
    readonly queryId: string;
    readonly riskAssessmentRecordRef: RiskAssessmentRecordRefV1;
    readonly spatialScopeRef?: SpatialScopeRefV1;
  }): Promise<ActualAssessmentProofResultV1>;
  /** 建议链自身的 C25 基线评估记录引用（推荐实体行上的精确记录身份）。 */
  baselineAssessmentRecordRef(
    recommendationRef: ResponseRecommendationRefV1,
  ): Promise<RiskAssessmentRecordRefV1>;
  /** 读取指定 run-state 登记行所属的 C04 正文（真实 C30 读路径）。 */
  readRunState(input: {
    readonly runId: string;
    readonly artifactRef: ContentArtifactRefV1;
    readonly spatialScopeRef?: SpatialScopeRefV1;
  }): Promise<unknown>;
  /** 预置审计主键冲突（C03 事务内审计写入真实失败）与复原。 */
  preinsertAuditConflict(auditEntryId: string): Promise<void>;
  clearAuditConflict(auditEntryId: string): Promise<void>;

  /** C41 两表与 C28/C30 事实的只读回读，供稳定可观察契约断言。 */
  decisionRows(): Promise<readonly Record<string, unknown>[]>;
  feedbackSnapshotRows(): Promise<readonly Record<string, unknown>[]>;
  countC28Decisions(): Promise<number>;
  countC28Executions(): Promise<number>;
  countC28Feedback(): Promise<number>;
  runRows(runId: string): Promise<readonly WorkflowGraphResultRowV1[]>;
  /** 篡改按真实路由引用定位的采纳行摘要列：正文与索引不一致必须类型化失败（design D5）。 */
  tamperDecisionDigest(routeDecisionRef: RouteDecisionRefV1): Promise<void>;
  close(): Promise<void>;
}

const jsonRowsOf = async (
  adminPool: {
    query: (text: string, values: readonly unknown[]) => Promise<{ rows: unknown[] }>;
  },
  statement: string,
  projectId: string,
  extraValues: readonly unknown[] = [],
): Promise<readonly Record<string, unknown>[]> => {
  const result = await adminPool.query(statement, [projectId, ...extraValues]);
  return result.rows as readonly Record<string, unknown>[];
};

const countOf = async (
  adminPool: {
    query: (text: string, values: readonly unknown[]) => Promise<{ rows: { count?: string }[] }>;
  },
  table: string,
  projectId: string,
): Promise<number> => {
  const result = await adminPool.query(
    `SELECT COUNT(*)::text AS count FROM business.${table} WHERE project_id = $1`,
    [projectId],
  );
  return Number(result.rows[0]?.count ?? "0");
};

export const startHumanDecisionFeedbackFixture =
  async (): Promise<HumanDecisionFeedbackPostgresFixtureV1> => {
    const state = await startResponseLifecycleFixture();
    const postgres = state.recommendation.c26.c25.postgres;
    const db = state.db;
    const projectId = state.projectId;
    const managerId = state.managerId;
    const access = postgres.access;
    const transactionUnit = postgres.transactionUnit;
    const artifactStore: ArtifactStoreV1 = postgres.artifactStore;
    const adminPool = postgres.postgres.adminPool;
    const rootSpatialScopeRef = state.rootSpatialScopeRef;

    const login = await access
      .login({
        kind: "login",
        loginAttemptId: C41_FIXTURE_LOGIN_ATTEMPT,
        loginName: C25_MANAGER_LOGIN_NAME,
        password: C25_MANAGER_PASSWORD,
      })
      .catch((error: unknown) => {
        throw new Error(`C41 fixture requires the C25 manager session: ${String(error)}`);
      });
    const sessionToken = login.sessionToken;

    /** 签发台账：C05 复验要求 id 与签发时一致，替身据此复验而不猜测 id。 */
    const issuedInvocations = new Map<string, { invocationId: string; branch: ModuleBranchV1 }>();

    /**
     * C25 只读证明在披露前按准备快照声明的来源复验（`#verifyCommand(..., {sourceVersionRefs})`），
     * 因此该分支的授权必须覆盖工程来源集合。与 C28 夹具对监测分支的处理同源：组合根按读写分支
     * 补齐工程来源，不扩大空间。
     */
    const projectSourceRows = await adminPool.query<{
      source_version_id: string;
      version_id: string;
    }>(
      `SELECT sv.source_version_id, sv.version_id FROM business.source_versions sv
         WHERE sv.project_id = $1 ORDER BY sv.source_version_id, sv.version_id`,
      [projectId],
    );
    const projectSourceVersionRefs = projectSourceRows.rows.map((row) => ({
      kind: "source-version" as const,
      reference: { entityId: row.source_version_id, versionId: row.version_id },
    }));

    const authorizeFor = async (input: {
      readonly branch: ModuleBranchV1;
      readonly invocationId: string;
      readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
      readonly requestedAt?: string;
    }): Promise<AuthorizationContextV1> => {
      const context = AuthorizationContextV1Schema.parse(
        (
          await access.authorize({
            invocation: { kind: "human-session", sessionToken },
            invocationId: input.invocationId,
            projectId,
            branch: input.branch,
            requestedSpatialScopeRefs: [...input.spatialScopeRefs] as never,
            requestedSourceVersionRefs: (input.branch === "risk-assessment.read-input-snapshot"
              ? projectSourceVersionRefs
              : []) as never,
            requestedAt: input.requestedAt ?? C41_FIXTURE_TIME,
          })
        ).context,
      );
      issuedInvocations.set(context.authorizationContextRef.reference.entityId, {
        invocationId: input.invocationId,
        branch: input.branch,
      });
      return context;
    };

    const verifyAsIssued = async (input: {
      readonly authorization: AuthorizationContextV1;
      readonly branch: ModuleBranchV1;
      readonly requestedAt: string;
    }): Promise<AuthorizationContextV1> => {
      const issued = issuedInvocations.get(
        input.authorization.authorizationContextRef.reference.entityId,
      );
      if (issued === undefined || issued.branch !== input.branch) {
        throw new TypeError("c41 fixture: authorization was not issued for this branch");
      }
      const decision = await access.verify({
        authorizationContextRef: input.authorization.authorizationContextRef,
        invocationId: issued.invocationId,
        projectId,
        branch: input.branch,
        requestedSpatialScopeRefs: [...input.authorization.spatialScopeRefs],
        requestedSourceVersionRefs: [],
        requestedAt: input.requestedAt,
      });
      return AuthorizationContextV1Schema.parse(decision.context);
    };

    const authorizeDownstream: HumanDecisionFeedbackDownstreamAuthorizerV1 = (request) =>
      authorizeFor({
        branch: request.branch,
        invocationId: request.invocationId,
        spatialScopeRefs: request.requestedSpatialScopeRefs,
        requestedAt: request.requestedAt,
      });

    const workflowAdapter = createPostgresWorkflowAdapter({
      db,
      transactionUnit,
      artifactStore,
      authorization: access,
      now: () => new Date(C41_FIXTURE_TIME),
    });
    const workflow = new C30WriteStandIn({
      projectId,
      actorId: managerId,
      registrationStore: workflowAdapter.registrationStore,
      bodies: workflowAdapter.bodies,
      transactionUnit,
      verifyAsIssued,
      authorizeFor,
    });
    let assessmentRunCompleted = true;
    const runCompletionProof: PostgresWorkflowAdapterV1["runCompletionProof"] = {
      verifyWorkflowRunCompletion: async (query) =>
        assessmentRunCompleted &&
        query.payload.workflowRunRef.reference.entityId === "c25-engine-run"
          ? {
              kind: "succeeded",
              result: {
                kind: "completed",
                projectId: query.projectId,
                workflowRunRef: query.payload.workflowRunRef,
                riskAssessmentRecordRef: query.payload.riskAssessmentRecordRef,
                auditTrailRef: {
                  kind: "audit-trail",
                  reference: { entityId: "c41-fixture-assessment-run", versionId: "1" },
                },
              },
            }
          : { kind: "failed", error: unsupportedError(query.queryId) },
    };

    /** C41 只调用 `readRecommendationContext`：两个未触达的只读接缝以显式失败替身注入。 */
    const unreachableSeam = (seam: string) => async (): Promise<never> => {
      throw new TypeError(`c41 fixture read seam ${seam} must not be reached`);
    };
    const responseContext: ResponseLifecycleContextReaderV1 =
      createPostgresResponseLifecycleContextReader({
        db,
        artifactStore,
        basis: {
          readAssessmentBasisReleaseSet: unreachableSeam("basis"),
        } as unknown as AssessmentBasisReleaseSetReaderV1,
        monitoring: postgres.monitoringStore,
        measureReleases: { readPublishedMeasureReleases: unreachableSeam("measure-releases") },
        authorizeDownstream: (request) =>
          authorizeDownstream({
            ...request,
            requestedSpatialScopeRefs: request.requestedSpatialScopeRefs ?? [],
          }),
      });

    const adapter = createPostgresHumanDecisionFeedbackAdapter({
      db,
      transactionUnit,
      access,
      authorizeDownstream,
      workflow,
      bindingProof: workflowAdapter.bindingProof,
      assessmentProof: state.recommendation.c26.c25.engine,
      runCompletionProof,
      responseLifecycle: state.adapter,
      responseContext,
      workflowStartControl: {
        graphVersion: C41_GRAPH_VERSION,
        retryPolicyRef: C41_RETRY_POLICY_REF,
      },
      now: () => new Date(C41_FIXTURE_TIME),
    });

    const proofQuery = async (
      input: HumanDecisionProofRequestV1,
    ): Promise<HumanDecisionProofQueryV1> => {
      const queryId =
        input.queryId ?? `c41-fixture-proof:${input.routeDecisionRef.reference.entityId}`;
      return {
        kind: "verify-human-decision-committed",
        queryId,
        projectId,
        actorId: input.actorId ?? managerId,
        requestedAt: C41_FIXTURE_TIME,
        authorization:
          input.authorization ??
          (await authorizeFor({
            branch: "workflow.resume-run",
            invocationId: queryId,
            spatialScopeRefs: [input.spatialScopeRef ?? rootSpatialScopeRef],
            requestedAt: C41_FIXTURE_TIME,
          })),
        payload: {
          routeDecisionRef: input.routeDecisionRef,
          workflowRunRef: input.workflowRunRef,
          responseRecommendationRef: input.responseRecommendationRef,
        },
      };
    };

    return {
      state,
      db,
      projectId,
      managerId,
      access,
      adapter,
      workflowAdapter,
      workflow,
      setAssessmentRunCompleted(completed) {
        assessmentRunCompleted = completed;
      },
      rootSpatialScopeRef,
      rootSpatialScope: rootSpatialScopeRef,
      authorizeFor,
      authorizeDownstream,

      async adoptCommand(input) {
        const issuedAt = input.issuedAt ?? C41_FIXTURE_TIME;
        const spatialScopeRef = input.spatialScopeRef ?? rootSpatialScopeRef;
        return WarningResponseRecordCommandV1Schema.parse({
          kind: "adopt-recommendation",
          commandId: input.commandId,
          idempotencyKey: input.commandId,
          projectId,
          actorId: managerId,
          issuedAt,
          // 公开命令授权与 C41 内部决定授权同 (commandId, branch)：请求空间必须与 C41 后续请求一致，
          // 否则 C05 幂等键命中异载荷而抛 IDEMPOTENCY_CONFLICT。
          authorization: await authorizeFor({
            branch: "warning-response.adopt-recommendation",
            invocationId: input.commandId,
            spatialScopeRefs: [spatialScopeRef],
            requestedAt: issuedAt,
          }),
          payload: {
            responseRecommendationRef: input.recommendationRef,
            decision: input.decision,
            reasonCode:
              input.reasonCode ??
              (input.decision === "adopted" ? "field-verified" : "not-applicable"),
            ...(input.preActionMonitoringSnapshotRef === undefined
              ? {}
              : { preActionMonitoringSnapshotRef: input.preActionMonitoringSnapshotRef }),
          },
        }) as AdoptRecommendationCommandV1;
      },

      async executionCommand(input) {
        const issuedAt = input.issuedAt ?? C41_FIXTURE_TIME;
        const spatialScopeRef = input.spatialScopeRef ?? rootSpatialScopeRef;
        return WarningResponseRecordCommandV1Schema.parse({
          kind: "record-execution",
          commandId: input.commandId,
          idempotencyKey: input.commandId,
          projectId,
          actorId: managerId,
          issuedAt,
          authorization: await authorizeFor({
            branch: "warning-response.record-execution",
            invocationId: input.commandId,
            spatialScopeRefs: [spatialScopeRef],
            requestedAt: issuedAt,
          }),
          payload: {
            actionSource: input.actionSource,
            executedByActorId: input.executedByActorId ?? managerId,
            recordedByActorId: input.recordedByActorId ?? managerId,
            occurredAt: input.occurredAt ?? C41_EXECUTION_TIME,
            evidenceReferences: [
              {
                locator: { sourceSegmentId: "c41-execution-evidence" },
                sourceVersion: { entityId: "source-version-c41", versionId: "1" },
              },
            ],
          },
        }) as RecordExecutionCommandV1;
      },

      async feedbackCommand(input) {
        const issuedAt = input.issuedAt ?? C41_FIXTURE_TIME;
        const spatialScopeRef = input.spatialScopeRef ?? rootSpatialScopeRef;
        return WarningResponseRecordCommandV1Schema.parse({
          kind: "record-feedback",
          commandId: input.commandId,
          idempotencyKey: input.commandId,
          projectId,
          actorId: managerId,
          issuedAt,
          authorization: await authorizeFor({
            branch: "warning-response.record-feedback",
            invocationId: input.commandId,
            spatialScopeRefs: [spatialScopeRef],
            requestedAt: issuedAt,
          }),
          payload: {
            executionRecordRef: input.executionRecordRef,
            postActionMonitoringSnapshotRef: input.postActionMonitoringSnapshotRef,
            feedbackArtifactRef: input.feedbackArtifactRef,
            occurredAt: input.occurredAt ?? C41_FEEDBACK_TIME,
            ...(input.actualAssessmentRecordRef === undefined
              ? {}
              : { actualAssessmentRecordRef: input.actualAssessmentRecordRef }),
          },
        }) as RecordFeedbackCommandV1;
      },

      async record(command) {
        return adapter.record(command);
      },

      proofQuery,

      async verifyHumanDecisionCommitted(input) {
        return adapter.verifyHumanDecisionCommitted(await proofQuery(input));
      },

      async verifyBindingProof(input) {
        // 授权身份与 C41 内部调用完全一致：C05 幂等命中同一上下文，检出的即真实登记事实。
        const queryId = `${input.commandId}:binding`;
        return workflowAdapter.bindingProof.verifyResponseWorkflowBinding({
          kind: "verify-response-workflow-binding",
          queryId,
          projectId,
          actorId: managerId,
          requestedAt: C41_FIXTURE_TIME,
          authorization: await authorizeFor({
            branch: "workflow.start-run",
            invocationId: queryId,
            spatialScopeRefs: [input.spatialScopeRef ?? rootSpatialScopeRef],
            requestedAt: C41_FIXTURE_TIME,
          }),
          payload: {
            responseRecommendationRef: input.recommendationRef,
            workflowRunRef: input.workflowRunRef,
          },
        });
      },

      async readRunState(input) {
        return workflowAdapter.bodies.readBody({
          projectId,
          artifactRef: input.artifactRef,
          actorId: managerId,
          requestedAt: C41_FIXTURE_TIME,
          invocationId: `c30-body-read:${projectId}:${input.artifactRef.reference.entityId}`,
          authorization: await authorizeFor({
            branch: "workflow.start-run",
            invocationId: `c30-body-read:${projectId}:${input.artifactRef.reference.entityId}`,
            spatialScopeRefs: [input.spatialScopeRef ?? rootSpatialScopeRef],
            requestedAt: C41_FIXTURE_TIME,
          }),
        });
      },

      async verifyAssessmentProof(input) {
        // 授权身份与 C41 内部调用完全一致：queryId 即签发 invocationId（C05 幂等命中同一上下文）。
        return state.recommendation.c26.c25.engine.verifyActualAssessment({
          kind: "verify-actual-assessment",
          queryId: input.queryId,
          projectId,
          actorId: managerId,
          requestedAt: C41_FIXTURE_TIME,
          authorization: await authorizeFor({
            branch: "risk-assessment.read-input-snapshot",
            invocationId: input.queryId,
            spatialScopeRefs: [input.spatialScopeRef ?? rootSpatialScopeRef],
            requestedAt: C41_FIXTURE_TIME,
          }),
          payload: { riskAssessmentRecordRef: input.riskAssessmentRecordRef },
        });
      },

      async baselineAssessmentRecordRef(recommendationRef) {
        const rows = await jsonRowsOf(
          adminPool,
          `SELECT assessment_record_id, assessment_record_version_id
             FROM business.response_recommendations
             WHERE project_id = $1 AND recommendation_id = $2 AND version_id = $3`,
          projectId,
          [recommendationRef.reference.entityId, recommendationRef.reference.versionId],
        );
        const row = rows[0];
        if (row === undefined) {
          throw new TypeError("c41 fixture: recommendation row is missing");
        }

        return {
          kind: "risk-assessment-record",
          reference: {
            entityId: String(row["assessment_record_id"]),
            versionId: String(row["assessment_record_version_id"]),
          },
        };
      },

      async preinsertAuditConflict(auditEntryId) {
        return state.preinsertAuditConflict(auditEntryId);
      },
      async clearAuditConflict(auditEntryId) {
        return state.clearAuditConflict(auditEntryId);
      },

      async decisionRows() {
        return jsonRowsOf(
          adminPool,
          `SELECT * FROM business.human_response_decisions
             WHERE project_id = $1 ORDER BY persisted_at, decision_id`,
          projectId,
        );
      },

      async feedbackSnapshotRows() {
        return jsonRowsOf(
          adminPool,
          `SELECT * FROM business.human_feedback_input_snapshots
             WHERE project_id = $1 ORDER BY persisted_at, snapshot_id`,
          projectId,
        );
      },

      async countC28Decisions() {
        return countOf(adminPool, "response_adoption_decisions", projectId);
      },
      async countC28Executions() {
        return countOf(adminPool, "response_execution_records", projectId);
      },
      async countC28Feedback() {
        return countOf(adminPool, "response_feedback_records", projectId);
      },

      async runRows(runId) {
        return workflowAdapter.registrationStore.listRunRows({ projectId, runId });
      },

      async tamperDecisionDigest(routeDecisionRef) {
        // 采纳行的 decision_id 是 C41 自身决定身份，决定表按真实 C30/C28 路由引用定位；
        // 必须命中恰好一行，否则「行与正文摘要不一致」用例会静默空转。
        const updated = await adminPool.query<{ decision_id: string }>(
          `UPDATE business.human_response_decisions SET content_digest = $1
             WHERE project_id = $2 AND route_decision_id = $3 AND route_decision_version_id = $4
           RETURNING decision_id`,
          [
            "f".repeat(64),
            projectId,
            routeDecisionRef.reference.entityId,
            routeDecisionRef.reference.versionId,
          ],
        );
        if (updated.rows.length !== 1) {
          throw new TypeError(
            `c41 fixture: expected exactly one adopted decision row to tamper, updated ${updated.rows.length}`,
          );
        }
      },

      async close() {
        await state.close();
      },
    };
  };
