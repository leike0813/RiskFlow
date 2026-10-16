/**
 * C30 评估子图运行时（design D-02/D-03/D-07/D-08，IP-05/IP-06）。
 *
 * 实现 `WorkflowGraphRuntimePortV1`：父图用同一 `WorkflowPortV1` 语义启动/恢复/取消评估子运行。
 * `start` 复验 C06 当前授权后从冻结命令重建运行上下文与首版公共状态；`resume` 先核对
 * `expectedRunVersionId` 与 checkpoint，业务领先恰好一格且能由已登记阶段结果证明时只补一个
 * 增量，否则 `CHECKPOINT_INCONSISTENT` 零补写；`cancel` 只追加取消事实，已成立事实与审计保留。
 */
import { GraphInterrupt, type LangGraphRunnableConfig } from "@langchain/langgraph";

import {
  type AuthorizationContextV1,
  type ModuleBranchV1,
  type WorkflowRunRefV1,
} from "@riskflow/contracts/ports";
import {
  AssessmentGraphStateV1Schema,
  type AssessmentGraphStateV1,
} from "@riskflow/contracts/workflows";
import {
  CHECKPOINT_RUNTIME_CONTEXT_KEY_V1,
  sha256CanonicalJson,
  type JsonValue,
} from "@riskflow/core/persistence";
import {
  WorkflowGraphErrorV1Schema,
  classifyWorkflowGraphFailure,
  reconcileCheckpointReference,
  type WorkflowGraphErrorCodeV1,
  type WorkflowGraphErrorV1,
  type WorkflowGraphResultRowV1,
  type WorkflowGraphRunCommandV1,
  type WorkflowGraphRunStateV1,
  type WorkflowGraphRuntimePortV1,
  workflowEntryIdentityFor,
} from "@riskflow/core/workflow";

import {
  ASSESSMENT_GRAPH_RUN_CONFIG_KEY_V1,
  assessmentStageOf,
  parseAssessmentGraphState,
  readAssessmentCursor,
  recordAssessmentCancellation,
  type AssessmentGraphPortsV1,
  type AssessmentGraphRunContextV1,
  type AssessmentGraphRunnerV1,
} from "./graph.js";

/** C05 授权接缝：按精确调用身份复验当前授权，撤销或范围不符即返回 `undefined`。 */
export interface AssessmentGraphAuthorizationPortV1 {
  verifyCurrent(input: {
    readonly authorization: AuthorizationContextV1;
    readonly projectId: string;
    readonly actorId: string;
    readonly invocationId: string;
    readonly branch: ModuleBranchV1;
    readonly requestedAt: string;
  }): Promise<AuthorizationContextV1 | undefined>;
}

/** 运行时失败：只携带稳定 C30 错误与（可选的）原因，不携带上游正文。 */
export class AssessmentGraphRunErrorV1 extends Error {
  readonly error: WorkflowGraphErrorV1;
  /** 父图按 `code`/`retryable`/`detailCode` 收口子运行失败，因此原样暴露稳定字段（design D-07）。 */
  readonly code: string;
  readonly retryable: boolean;
  readonly detailCode: string;

  constructor(error: WorkflowGraphErrorV1, cause?: unknown) {
    super(`${error.code}:${error.detailCode}`, cause === undefined ? undefined : { cause });
    this.name = "AssessmentGraphRunErrorV1";
    this.error = error;
    this.code = error.code;
    this.retryable = error.retryable;
    this.detailCode = error.detailCode;
  }
}

const runFailure = (input: {
  readonly stage: AssessmentGraphStateV1["stage"];
  readonly code: WorkflowGraphErrorCodeV1;
  readonly retryable: boolean;
  readonly detailCode: string;
  readonly occurredAt: string;
}): AssessmentGraphRunErrorV1 =>
  new AssessmentGraphRunErrorV1(
    WorkflowGraphErrorV1Schema.parse({
      schemaVersion: "1",
      code: input.code,
      retryable: input.retryable,
      stage: input.stage,
      detailCode: input.detailCode,
      occurredAt: input.occurredAt,
    }),
  );

/** 运行命令的闭合处置：与公共结果逐项对应（design D-08）。 */
export type AssessmentRunDispositionV1 =
  "created" | "existing" | "cancellation-recorded" | "already-cancelled";

export interface AssessmentRunOutcomeV1 {
  readonly disposition: AssessmentRunDispositionV1;
  readonly runRef: WorkflowRunRefV1;
  readonly runVersionId: string;
  readonly status: WorkflowGraphRunStateV1["status"];
  readonly stage: AssessmentGraphStateV1["stage"];
  readonly assessmentRunRefs: readonly WorkflowRunRefV1[];
  readonly lastStageResultRef?: NonNullable<WorkflowGraphRunStateV1["lastStageResultRef"]>;
  readonly lastWaitingRef?: NonNullable<WorkflowGraphRunStateV1["lastWaitingRef"]>;
  readonly resultRef?: NonNullable<WorkflowGraphRunStateV1["resultRef"]>;
  readonly errorRef?: NonNullable<WorkflowGraphRunStateV1["lastErrorRef"]>;
}

export interface AssessmentGraphRuntimeOptionsV1 {
  readonly ports: AssessmentGraphPortsV1;
  readonly graph: AssessmentGraphRunnerV1;
  readonly authorization: AssessmentGraphAuthorizationPortV1;
  readonly now: () => Date;
}

/** 恢复命令：在公共启动命令上追加预期运行版本与恢复原因。 */
export interface AssessmentGraphResumeCommandV1 extends WorkflowGraphRunCommandV1 {
  readonly expectedRunVersionId: string;
  readonly resumeCause: unknown;
}

/** 取消命令：在公共启动命令上追加取消原因与（可选的）预期运行版本。 */
export interface AssessmentGraphCancelCommandV1 extends WorkflowGraphRunCommandV1 {
  readonly reasonCode: string;
  readonly expectedRunVersionId?: string;
}

/**
 * 评估子运行运行时：父图注入的 `WorkflowGraphRuntimePortV1` 实现。命令与返回比公共端口更精确：
 * 公共端口只声明与父图协作所需的子集，C30 自己的处置（`created`/`existing`/取消处置）与取消入参
 * 在具体实现上可见，父图仍按公共端口形态消费。
 */
export interface AssessmentGraphRuntimeV1 extends WorkflowGraphRuntimePortV1 {
  start(command: WorkflowGraphRunCommandV1): Promise<AssessmentRunOutcomeV1>;
  resume(command: AssessmentGraphResumeCommandV1): Promise<AssessmentRunOutcomeV1>;
  cancel(command: AssessmentGraphCancelCommandV1): Promise<AssessmentRunOutcomeV1>;
}

const graphConfig = (run: AssessmentGraphRunContextV1): LangGraphRunnableConfig => ({
  configurable: {
    thread_id: run.threadId,
    [ASSESSMENT_GRAPH_RUN_CONFIG_KEY_V1]: run,
    [CHECKPOINT_RUNTIME_CONTEXT_KEY_V1]: {
      schemaVersion: "1",
      projectId: run.projectId,
      actorId: run.actorId,
      threadId: run.threadId,
      runRef: run.runRef,
      authorization: run.authorization,
      invocationId: run.issuedInvocationId,
    },
  },
});

const runContextOf = (input: {
  readonly command: WorkflowGraphRunCommandV1;
  readonly authorization: AuthorizationContextV1;
}): AssessmentGraphRunContextV1 => ({
  projectId: input.command.projectId,
  actorId: input.command.actorId,
  authorization: input.authorization,
  commandId: input.command.commandId,
  issuedInvocationId: input.command.issuedInvocationId,
  idempotencyKey: input.command.idempotencyKey,
  issuedAt: input.command.issuedAt,
  validAt: input.command.validAt,
  runRef: input.command.runRef,
  parentRunRef: input.command.parentRunRef,
  entryMode: input.command.entryMode,
  entryIdentity: input.command.entryIdentity,
  frozenRefs: input.command.frozenRefs,
  acceptedRiskRecordRef: input.command.acceptedRiskRecordRef,
  spatialScopeRef: input.command.spatialScopeRef,
  applicabilityMetadataSnapshotRef: input.command.applicabilityMetadataSnapshotRef,
  monitoringSnapshotRefs: input.command.monitoringSnapshotRefs ?? [],
  assessmentRunRefs: input.command.assessmentRunRefs ?? [],
  reassessmentEntry: input.command.reassessmentEntry,
  graphVersion: input.command.graphVersion,
  threadId: input.command.threadId,
});

/** 首版公共状态：全部值来自冻结命令，缺失父运行引用即拒绝（design D-02）。 */
const initialStateOf = (run: AssessmentGraphRunContextV1): AssessmentGraphStateV1 => {
  const parentRiskFlowRunRef = run.parentRunRef;
  if (parentRiskFlowRunRef === undefined) {
    throw new TypeError("assessment run requires the parent risk-flow run reference");
  }
  return AssessmentGraphStateV1Schema.parse({
    schemaVersion: "1",
    graphVersion: run.graphVersion,
    parentRiskFlowRunRef,
    runRef: run.runRef,
    threadId: run.threadId,
    entryMode: run.entryMode,
    authorizationContextRef: run.authorization.authorizationContextRef,
    status: "running",
    stage: "A0",
    warningRecordRefs: [],
    warningResponseTaskRefs: [],
    agentTaskRefs: [],
    reviewTaskRefs: [],
  });
};

/** 已登记事实 → 公共状态：只重放状态、阶段与终态引用，不在恢复路径上猜测其它字段。 */
const stateOfCursor = async (
  ports: AssessmentGraphPortsV1,
  run: AssessmentGraphRunContextV1,
  cursor: WorkflowGraphRunStateV1,
): Promise<AssessmentGraphStateV1> => {
  const entrySnapshotRef = await ports.registrationStore.readAssessmentEntrySnapshot({
    projectId: run.projectId,
    runId: run.runRef.reference.entityId,
    actorId: run.actorId,
    requestedAt: ports.now().toISOString(),
    invocationId: run.issuedInvocationId,
    authorization: run.authorization,
  });
  return AssessmentGraphStateV1Schema.parse({
    ...initialStateOf(run),
    ...(entrySnapshotRef === undefined ? {} : { entrySnapshotRef }),
    status: cursor.status,
    stage: cursor.stage,
    ...(cursor.lastStageResultRef === undefined
      ? {}
      : { lastStageResultRef: cursor.lastStageResultRef }),
    ...(cursor.lastErrorRef === undefined ? {} : { lastErrorRef: cursor.lastErrorRef }),
    // 终态必须携带结果引用、等待态必须携带等待引用：两者都只从已登记事实重放，不造默认值。
    ...(cursor.resultRef === undefined ? {} : { resultRef: cursor.resultRef }),
    ...(cursor.status !== "waiting" || cursor.lastWaitingRef === undefined
      ? {}
      : { waitingRef: cursor.lastWaitingRef }),
  });
};

/**
 * 同一运行身份（design D-02）：`runId` 分区按父运行共享，同一父运行下的兄弟子运行只由入口身份区分；
 * 因此判定“已存在”必须逐字段核对入口身份，不能把兄弟子运行的已登记事实当成重放。
 */
const sameRunIdentity = (
  cursor: WorkflowGraphRunStateV1,
  run: AssessmentGraphRunContextV1,
): boolean =>
  cursor.entryIdentity.entityId === run.entryIdentity.entityId &&
  cursor.entryIdentity.versionId === run.entryIdentity.versionId;

/**
 * 入口身份自洽：同一命令载荷只对应一个运行身份（design D-02）。命令自带的入口身份必须与它自己的
 * 冻结引用派生出的身份一致，否则运行身份与冻结输入互不对应——重放路径因此不能只按身份命中就
 * 当成重放返回既有事实，必须在任何读写之前按契约冲突拒绝。
 */
const entryIdentityConsistent = (run: AssessmentGraphRunContextV1): boolean => {
  const expected = workflowEntryIdentityFor({
    entryMode: run.entryMode,
    projectId: run.projectId,
    frozenRefs: run.frozenRefs,
    reassessmentEntry: run.reassessmentEntry,
  });
  return (
    expected.entityId === run.entryIdentity.entityId &&
    expected.versionId === run.entryIdentity.versionId
  );
};

/** 运行结果收口：稳定引用、状态与错误引用，不携带正文（design D-07）。 */
const outcomeOf = (input: {
  readonly cursor: WorkflowGraphRunStateV1;
  readonly state: AssessmentGraphStateV1;
  readonly disposition: AssessmentRunDispositionV1;
}): AssessmentRunOutcomeV1 => ({
  disposition: input.disposition,
  runRef: input.state.runRef,
  runVersionId: input.cursor.runVersionId,
  status: input.state.status,
  stage: input.state.stage,
  assessmentRunRefs: input.cursor.assessmentRunRefs,
  ...(input.cursor.lastStageResultRef === undefined
    ? {}
    : { lastStageResultRef: input.cursor.lastStageResultRef }),
  ...(input.cursor.lastWaitingRef === undefined
    ? {}
    : { lastWaitingRef: input.cursor.lastWaitingRef }),
  ...(input.cursor.resultRef === undefined ? {} : { resultRef: input.cursor.resultRef }),
  ...(input.cursor.lastErrorRef === undefined ? {} : { errorRef: input.cursor.lastErrorRef }),
});

export const createAssessmentGraphRuntime = (
  options: AssessmentGraphRuntimeOptionsV1,
): AssessmentGraphRuntimeV1 => {
  const { ports } = options;

  const verifyCurrent = async (input: {
    readonly authorization: AuthorizationContextV1;
    readonly projectId: string;
    readonly actorId: string;
    readonly branch: ModuleBranchV1;
    readonly requestedAt: string;
    readonly stage: AssessmentGraphStateV1["stage"];
    /**
     * 已签发的调用身份：运行控制类复验必须用它，不提供派生回退。
     *
     * C06 `verify` 精确绑定签发时的 `invocationId`（C05：一个授权上下文只对应一个
     * invocation_id）。`workflow.start-run` / `resume-run` / `cancel-run` 的上下文由公开
     * 命令以 `commandId` 签发，评估子运行沿用父运行上下文；任何 `c30-workflow-start:*`
     * 派生串都没有签发方，复验必然被判绑定不符。
     */
    readonly issuedInvocationId: string;
  }): Promise<AuthorizationContextV1> => {
    const authorized = await options.authorization.verifyCurrent({
      authorization: input.authorization,
      projectId: input.projectId,
      actorId: input.actorId,
      invocationId: input.issuedInvocationId,
      branch: input.branch,
      requestedAt: input.requestedAt,
    });
    if (authorized === undefined) {
      throw runFailure({
        stage: input.stage,
        code: "AUTHORIZATION_DENIED",
        retryable: false,
        detailCode: "authorization_denied",
        occurredAt: options.now().toISOString(),
      });
    }
    return authorized;
  };

  const runGraph = async (input: {
    readonly run: AssessmentGraphRunContextV1;
    readonly invocation:
      | { readonly kind: "start"; readonly state: AssessmentGraphStateV1 }
      | { readonly kind: "resume"; readonly resumeCause: unknown }
      | { readonly kind: "retry"; readonly state: AssessmentGraphStateV1 }
      | {
          readonly kind: "recover";
          readonly state: AssessmentGraphStateV1;
          readonly completedNode: AssessmentGraphStateV1["stage"];
        };
    readonly stage: AssessmentGraphStateV1["stage"];
  }): Promise<AssessmentGraphStateV1> => {
    try {
      const result =
        input.invocation.kind === "start"
          ? await options.graph.invoke({ graph: input.invocation.state }, graphConfig(input.run))
          : input.invocation.kind === "resume"
            ? await options.graph.resume(
                {
                  resume: { kind: "assessment-resume", resumeCause: input.invocation.resumeCause },
                },
                graphConfig(input.run),
              )
            : input.invocation.kind === "retry"
              ? await options.graph.retry(input.invocation.state, graphConfig(input.run))
              : await options.graph.recover(
                  input.invocation.state,
                  input.invocation.completedNode,
                  graphConfig(input.run),
                );
      return parseAssessmentGraphState(result, options.now().toISOString());
    } catch (error: unknown) {
      if (error instanceof GraphInterrupt) {
        // 等待节点挂起：图状态已落 checkpoint，业务状态仍以登记行为准（design D-08）。
        const cursor = await readAssessmentCursor({ ports, run: input.run });
        if (cursor === undefined) {
          throw runFailure({
            stage: input.stage,
            code: "CONTRACT_INVALID",
            retryable: false,
            detailCode: "run-cursor-missing",
            occurredAt: options.now().toISOString(),
          });
        }
        return await stateOfCursor(ports, input.run, cursor);
      }
      if (error instanceof Error && error.name === "AssessmentGraphNodeFailureV1") {
        const typed = (error as { readonly error?: unknown }).error;
        if (typed !== undefined) {
          throw new AssessmentGraphRunErrorV1(WorkflowGraphErrorV1Schema.parse(typed));
        }
      }
      throw new AssessmentGraphRunErrorV1(
        classifyWorkflowGraphFailure({
          stage: input.stage,
          upstream: { code: "TRANSIENT_FAILURE", retryable: true },
          detailCode: "graph-invocation-failed",
          occurredAt: options.now().toISOString(),
        }),
        error,
      );
    }
  };

  /** checkpoint 状态读取：只读公开状态正文，绝不据 checkpoint 写业务事实（design D-08）。 */
  const readCheckpointState = async (input: {
    readonly run: AssessmentGraphRunContextV1;
  }): Promise<AssessmentGraphStateV1 | undefined> => {
    const snapshot = await options.graph.getState(graphConfig(input.run));
    if (typeof snapshot !== "object" || snapshot === null || !("values" in snapshot)) {
      return undefined;
    }
    const values = (snapshot as { readonly values?: unknown }).values;
    if (typeof values !== "object" || values === null) return undefined;
    const declared = new Set(Object.keys(AssessmentGraphStateV1Schema.shape));
    const record = Object.fromEntries(Object.entries(values).filter(([key]) => declared.has(key)));
    const parsed = AssessmentGraphStateV1Schema.safeParse(record);
    return parsed.success ? parsed.data : undefined;
  };

  /** 业务提交是否由已登记阶段结果证明：无法证明时检查点对账按不一致收口（design D-08）。 */
  const businessAheadIsProvable = (input: {
    readonly cursor: WorkflowGraphRunStateV1;
    readonly rows: readonly WorkflowGraphResultRowV1[];
  }): boolean => {
    const stageResultRef = input.cursor.lastStageResultRef;
    if (stageResultRef === undefined) return false;
    return input.rows.some(
      (row) =>
        row.resultKind === "stage-result" &&
        row.stageResultRef?.reference.entityId === stageResultRef.reference.entityId &&
        row.stageResultRef.reference.versionId === stageResultRef.reference.versionId,
    );
  };

  const start = async (command: WorkflowGraphRunCommandV1): Promise<AssessmentRunOutcomeV1> => {
    const authorized = await verifyCurrent({
      authorization: command.authorization,
      projectId: command.projectId,
      actorId: command.actorId,
      // 沿用父运行交下来的签发分支：父运行由启动命令推进时是 `workflow.start-run`，由恢复
      // 命令推进时是 `workflow.resume-run`，两者签发的上下文互不通用（design D-08）。
      branch: command.authorizationBranch,
      requestedAt: command.validAt,
      stage: "A0",
      issuedInvocationId: command.issuedInvocationId,
    });
    const run = runContextOf({ command, authorization: authorized });
    if (!entryIdentityConsistent(run)) {
      throw runFailure({
        stage: "A0",
        code: "CONTRACT_INVALID",
        retryable: false,
        detailCode: "entry-identity-mismatch",
        occurredAt: options.now().toISOString(),
      });
    }
    const existing = await readAssessmentCursor({ ports, run });
    if (existing !== undefined && sameRunIdentity(existing, run)) {
      return outcomeOf({
        cursor: existing,
        state: await stateOfCursor(ports, run, existing),
        disposition: "existing",
      });
    }
    const payload = Object.fromEntries(
      Object.entries(command).filter(
        ([key]) => !["authorization", "issuedInvocationId", "authorizationBranch"].includes(key),
      ),
    );
    const auditEntryId = `assessment-start:${sha256CanonicalJson({ projectId: command.projectId, commandId: command.commandId })}`;
    try {
      await ports.transactionUnit.execute(
        {
          projectId: command.projectId,
          commandKind: "assessment-graph.start",
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          payload: JSON.parse(JSON.stringify(payload)) as Record<string, JsonValue>,
          actorRef: command.actorId,
          authorizationContextRef: authorized.authorizationContextRef,
          issuedAt: command.issuedAt,
          runId: command.runRef.reference.entityId,
          threadId: command.threadId,
        },
        async () => ({
          resultRef: command.runRef,
          audit: {
            auditEntryId,
            projectId: command.projectId,
            action: "assessment-graph.start",
            targetRef: command.runRef,
            actorRef: command.actorId,
            authorizationContextRef: authorized.authorizationContextRef,
            occurredAt: command.issuedAt,
            recordedAt: command.issuedAt,
            version: command.runRef.reference,
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            runId: command.runRef.reference.entityId,
            threadId: command.threadId,
            reasonRef: run.parentRunRef,
          },
          events: [],
        }),
      );
    } catch (error) {
      const conflict =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "IDEMPOTENCY_CONFLICT";
      throw runFailure({
        stage: "A0",
        code: conflict ? "CONTRACT_INVALID" : "RETRYABLE_INFRASTRUCTURE_FAILURE",
        retryable: !conflict,
        detailCode: "start-run-binding-failed",
        occurredAt: options.now().toISOString(),
      });
    }
    const state = await runGraph({
      run,
      invocation: { kind: "start", state: initialStateOf(run) },
      stage: "A0",
    });
    const cursor = await readAssessmentCursor({ ports, run });
    if (cursor === undefined) {
      throw runFailure({
        stage: state.stage,
        code: "RETRYABLE_INFRASTRUCTURE_FAILURE",
        retryable: true,
        detailCode: "run-state-unconfirmed",
        occurredAt: options.now().toISOString(),
      });
    }
    return outcomeOf({ cursor, state, disposition: "created" });
  };

  const resume = async (
    command: AssessmentGraphResumeCommandV1,
  ): Promise<AssessmentRunOutcomeV1> => {
    const provisional = runContextOf({ command, authorization: command.authorization });
    const cursorBefore = await readAssessmentCursor({ ports, run: provisional });
    if (cursorBefore === undefined) {
      throw runFailure({
        stage: "A0",
        code: "RUN_NOT_FOUND",
        retryable: false,
        detailCode: "entity_not_found",
        occurredAt: options.now().toISOString(),
      });
    }
    const cursorStage = assessmentStageOf(cursorBefore.stage, options.now().toISOString());
    const authorized = await verifyCurrent({
      authorization: command.authorization,
      projectId: command.projectId,
      actorId: command.actorId,
      branch: "workflow.resume-run",
      requestedAt: command.validAt,
      stage: cursorStage,
      issuedInvocationId: command.issuedInvocationId,
    });
    const run = runContextOf({ command, authorization: authorized });
    if (cursorBefore.status === "cancelled") {
      return outcomeOf({
        cursor: cursorBefore,
        state: await stateOfCursor(ports, run, cursorBefore),
        disposition: "already-cancelled",
      });
    }
    if (cursorBefore.status === "completed" || cursorBefore.status === "terminal-failure") {
      throw runFailure({
        stage: cursorStage,
        code: "RUN_TERMINATED",
        retryable: false,
        detailCode: "run-already-terminal",
        occurredAt: options.now().toISOString(),
      });
    }
    if (cursorBefore.runVersionId !== command.expectedRunVersionId) {
      throw runFailure({
        stage: cursorStage,
        code: "VERSION_CONFLICT",
        retryable: false,
        detailCode: "stale_version",
        occurredAt: options.now().toISOString(),
      });
    }
    if (
      cursorBefore.status === "waiting" &&
      cursorBefore.lastWaitingRef?.kind === "business-preparation"
    ) {
      const cause = command.resumeCause as
        | {
            readonly kind?: string;
            readonly preparationRef?: {
              readonly kind?: string;
              readonly reference?: { readonly entityId?: string; readonly versionId?: string };
            };
          }
        | undefined;
      const expected = cursorBefore.lastWaitingRef.preparationRef;
      if (
        cause?.kind !== "business-preparation-ready" ||
        cause.preparationRef?.kind !== expected.kind ||
        cause.preparationRef.reference?.entityId !== expected.reference.entityId ||
        cause.preparationRef.reference.versionId !== expected.reference.versionId
      )
        throw runFailure({
          stage: cursorStage,
          code: "UPSTREAM_WAITING",
          retryable: false,
          detailCode: "preparation-reference-mismatch",
          occurredAt: options.now().toISOString(),
        });
    }
    const rows = await ports.registrationStore.listRunRows({
      projectId: run.projectId,
      runId: run.runRef.reference.entityId,
    });
    const checkpointState = await readCheckpointState({ run });
    if (checkpointState === undefined) {
      throw runFailure({
        stage: cursorStage,
        code: "RETRYABLE_INFRASTRUCTURE_FAILURE",
        retryable: true,
        detailCode: "checkpoint-unavailable",
        occurredAt: options.now().toISOString(),
      });
    }
    const reconciliation = reconcileCheckpointReference({
      checkpointStage: checkpointState.stage,
      registeredStage: cursorBefore.stage,
    });
    const provable =
      reconciliation === "business-ahead" &&
      businessAheadIsProvable({ cursor: cursorBefore, rows });
    if (
      reconciliation === "inconsistent" ||
      reconciliation === "checkpoint-ahead" ||
      (reconciliation === "business-ahead" && !provable)
    ) {
      // 检查点指向已登记事实无法证明的位置：零补写封闭（design D-08）。
      throw runFailure({
        stage: cursorStage,
        code: "CHECKPOINT_INCONSISTENT",
        retryable: false,
        detailCode: "checkpoint-inconsistent",
        occurredAt: options.now().toISOString(),
      });
    }
    const state = await runGraph({
      run,
      invocation:
        cursorBefore.status === "retryable-failure"
          ? { kind: "retry", state: checkpointState }
          : provable
            ? { kind: "recover", state: checkpointState, completedNode: checkpointState.stage }
            : { kind: "resume", resumeCause: command.resumeCause },
      stage: cursorBefore.status === "waiting" ? cursorStage : checkpointState.stage,
    });
    const cursor = await readAssessmentCursor({ ports, run });
    if (cursor === undefined) {
      throw runFailure({
        stage: state.stage,
        code: "RETRYABLE_INFRASTRUCTURE_FAILURE",
        retryable: true,
        detailCode: "run-state-unconfirmed",
        occurredAt: options.now().toISOString(),
      });
    }
    return outcomeOf({ cursor, state, disposition: "existing" });
  };

  const cancel = async (
    command: AssessmentGraphCancelCommandV1,
  ): Promise<AssessmentRunOutcomeV1> => {
    const provisional = runContextOf({ command, authorization: command.authorization });
    const cursor = await readAssessmentCursor({ ports, run: provisional });
    if (cursor === undefined) {
      throw runFailure({
        stage: "A0",
        code: "RUN_NOT_FOUND",
        retryable: false,
        detailCode: "entity_not_found",
        occurredAt: options.now().toISOString(),
      });
    }
    const cursorStage = assessmentStageOf(cursor.stage, options.now().toISOString());
    const authorized = await verifyCurrent({
      authorization: command.authorization,
      projectId: command.projectId,
      actorId: command.actorId,
      branch: "workflow.cancel-run",
      requestedAt: command.validAt,
      stage: cursorStage,
      issuedInvocationId: command.issuedInvocationId,
    });
    const run = runContextOf({ command, authorization: authorized });
    if (cursor.status === "cancelled") {
      return outcomeOf({
        cursor,
        state: await stateOfCursor(ports, run, cursor),
        disposition: "already-cancelled",
      });
    }
    if (cursor.status === "completed" || cursor.status === "terminal-failure") {
      throw runFailure({
        stage: cursorStage,
        code: "RUN_TERMINATED",
        retryable: false,
        detailCode: "run-already-terminal",
        occurredAt: options.now().toISOString(),
      });
    }
    if (
      command.expectedRunVersionId !== undefined &&
      cursor.runVersionId !== command.expectedRunVersionId
    ) {
      throw runFailure({
        stage: cursorStage,
        code: "VERSION_CONFLICT",
        retryable: false,
        detailCode: "stale_version",
        occurredAt: options.now().toISOString(),
      });
    }
    const cancelledState = await recordAssessmentCancellation({
      ports,
      run,
      state: await stateOfCursor(ports, run, cursor),
      cursor,
      reasonCode: command.reasonCode,
    });
    const cancelledCursor = await readAssessmentCursor({ ports, run });
    if (cancelledCursor === undefined) {
      throw runFailure({
        stage: cursorStage,
        code: "RETRYABLE_INFRASTRUCTURE_FAILURE",
        retryable: true,
        detailCode: "run-state-unconfirmed",
        occurredAt: options.now().toISOString(),
      });
    }
    return outcomeOf({
      cursor: cancelledCursor,
      state: cancelledState,
      disposition: "cancellation-recorded",
    });
  };

  return { start, resume, cancel };
};
