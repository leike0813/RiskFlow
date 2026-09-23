/**
 * C24 识别子图运行时（design D-01/D-05/D-07/D-09，IP-15/IP-16）。
 *
 * `start`：解析既有命令、复验 `workflow.start` 与工程/空间/资料授权、校验父运行与准备快照，
 * 再以 `(projectId, commandType, idempotencyKey)` 回查首次命令回执：同载荷返回原运行，异载荷
 * 由 C03 事务单元返回不可重试冲突。派生稳定子运行与 thread ID，**不**消费 `inputs-ready`
 * 自主建父运行（父运行身份只来自命令）。
 *
 * `resume`：先按事件与 producer 幂等身份去重（同一命令身份重放返回原回执且无副作用），再校验
 * 项目、子运行、线程、等待引用种类与版本、当前运行状态版本与当前授权，最后用**原 thread ID**
 * 恢复。checkpoint 引用先按当前授权做业务对账，无法证明即 `CHECKPOINT_INCONSISTENT` 且零补写。
 *
 * `cancel`：以预期运行状态版本做协作式登记，只阻止未开始动作；已提交事实、事件、审计与
 * checkpoint 历史一律不回滚。
 *
 * 技术重试次数与退避只来自冻结 `retryPolicyRef`；动作 ID 与首次相同，attempt 单调增加。
 */
import { GraphInterrupt, type LangGraphRunnableConfig } from "@langchain/langgraph";

import type { VersionReference } from "@riskflow/contracts/common";
import {
  ContentArtifactRefV1Schema,
  type AuthorizationContextV1,
  type IdentificationRunResultRefV1,
  type ModuleBranchV1,
  type WorkflowRunRefV1,
} from "@riskflow/contracts/ports";
import {
  IdentificationGraphStateV1Schema,
  type IdentificationGraphStateV1,
} from "@riskflow/contracts/workflows";

import {
  IdentificationGraphCancellationV1Schema,
  classifyIdentificationGraphOutcome,
  type IdentificationGraphRunOutcomeV1,
  type IdentificationGraphResumeCauseV1,
  type IdentificationGraphRuntimeV1,
} from "@riskflow/core/identification/graph";
import { sha256CanonicalJson, type JsonValue } from "@riskflow/core/persistence";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";

import {
  IDENTIFICATION_GRAPH_RUN_CONFIG_KEY_V1,
  IdentificationGraphNodeFailureV1,
  parseIdentificationGraphState,
  readCursor,
  readFrozenPolicyForRun,
  toIdentificationGraphError,
  type IdentificationGraphPortsV1,
  type IdentificationGraphRunContextV1,
  type IdentificationGraphRunnerV1,
} from "./graph.js";

/**
 * 运行时命令面直接采用 core 冻结契约（`IdentificationGraphRuntimeV1` 及其命令/结果）：
 * 本模块不新增公共契约，也不改 `WorkflowPortV1`。
 */
export type {
  IdentificationGraphCancelCommandV1,
  IdentificationGraphResumeCommandV1,
  IdentificationGraphRunOutcomeV1,
  IdentificationGraphRuntimeV1,
  IdentificationGraphStartCommandV1,
} from "@riskflow/core/identification/graph";

/** C05 授权接缝：按精确调用身份复验当前授权，撤销或范围不符即返回 `undefined`。 */
export interface IdentificationGraphAuthorizationPortV1 {
  verifyCurrent(input: {
    readonly authorization: AuthorizationContextV1;
    readonly projectId: string;
    readonly actorId: string;
    readonly invocationId: string;
    readonly branch: ModuleBranchV1;
    readonly requestedAt: string;
  }): Promise<AuthorizationContextV1 | undefined>;
}

/** 运行时失败：只携带稳定 C24 错误与（可选的）重试时刻。 */
export class IdentificationGraphRunErrorV1 extends Error {
  readonly error: ReturnType<typeof toIdentificationGraphError>;
  readonly retryAt: string | undefined;

  constructor(
    error: ReturnType<typeof toIdentificationGraphError>,
    retryAt?: string,
    cause?: unknown,
  ) {
    super(`${error.code}:${error.detailCode}`, cause === undefined ? undefined : { cause });
    this.name = "IdentificationGraphRunErrorV1";
    this.error = error;
    this.retryAt = retryAt;
  }
}

/**
 * 运行级失败收口：只按稳定 code、retryable 与 detailCode 分类到 C24 错误码，
 * 权限、版本、契约与检查点不一致一律不可重试（design D-10）。
 */
const runFailure = (input: {
  readonly stage: IdentificationGraphStateV1["stage"];
  readonly code: string;
  readonly retryable: boolean;
  readonly detailCode: string;
  readonly occurredAt: string;
  readonly retryAt?: string;
}): IdentificationGraphRunErrorV1 => {
  const error = classifyIdentificationGraphOutcome({
    stage: input.stage,
    upstream: { code: input.code, retryable: input.retryable },
    detailCode: input.detailCode,
    occurredAt: input.occurredAt,
  });
  return new IdentificationGraphRunErrorV1(
    error,
    input.retryAt === undefined ? undefined : input.retryAt,
  );
};

export interface IdentificationGraphRuntimeOptionsV1 {
  readonly ports: IdentificationGraphPortsV1;
  readonly graph: IdentificationGraphRunnerV1;
  readonly authorization: IdentificationGraphAuthorizationPortV1;
  readonly now: () => Date;
}

/** 稳定子运行身份：同一父运行、准备快照与图版本只对应一个子运行与线程（design D-01）。 */
export const identificationRunIdentityFor = (input: {
  readonly projectId: string;
  readonly parentRiskFlowRunRef: WorkflowRunRefV1;
  readonly preparationSnapshotRef: IdentificationGraphRunContextV1["preparationSnapshotRef"];
  readonly graphVersion: VersionReference;
}): { readonly runRef: WorkflowRunRefV1; readonly threadId: string } => {
  const digest = sha256CanonicalJson({
    projectId: input.projectId,
    parentRiskFlowRunRef: input.parentRiskFlowRunRef,
    preparationSnapshotRef: input.preparationSnapshotRef,
    graphVersion: input.graphVersion,
  });
  return {
    runRef: {
      kind: "workflow-run",
      reference: {
        entityId: `identification-run:${input.projectId}:${input.parentRiskFlowRunRef.reference.entityId}`,
        versionId: digest,
      },
    },
    threadId: `identification-run-thread:${input.projectId}:${digest}`,
  };
};

const graphConfig = (run: IdentificationGraphRunContextV1): LangGraphRunnableConfig => ({
  configurable: {
    thread_id: run.threadId,
    [IDENTIFICATION_GRAPH_RUN_CONFIG_KEY_V1]: run,
  },
});

/** checkpoint 状态读取：只读取通道正文并按公开 schema 解析，绝不据 checkpoint 写业务事实。 */
const readCheckpointState = async (input: {
  readonly graph: IdentificationGraphRunnerV1;
  readonly run: IdentificationGraphRunContextV1;
}): Promise<IdentificationGraphStateV1 | undefined> => {
  const snapshot = await input.graph.getState(graphConfig(input.run));
  if (typeof snapshot !== "object" || snapshot === null || !("values" in snapshot)) {
    return undefined;
  }
  const values = (snapshot as { readonly values?: unknown }).values;
  if (typeof values !== "object" || values === null) {
    return undefined;
  }
  return IdentificationGraphStateV1Schema.parse(
    parseIdentificationGraphState(values, input.run.issuedAt),
  );
};

const invocationIdFor = (input: {
  readonly operation: string;
  readonly projectId: string;
  readonly targetId: string;
}): string => `c24-${input.operation}:${input.projectId}:${input.targetId}`;

/** 命令回执：同键同摘要重放返回既有回执，异摘要由 C03 事务单元收口为不可重试冲突。 */
const recordCommandReceipt = async (input: {
  readonly ports: IdentificationGraphPortsV1;
  readonly projectId: string;
  readonly actorId: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly commandKind: string;
  readonly issuedAt: string;
  readonly authorization: AuthorizationContextV1;
  readonly payload: Record<string, JsonValue>;
  readonly resultRef: { readonly kind: "workflow-run"; readonly reference: VersionReference };
  readonly runId: string | undefined;
  readonly threadId: string | undefined;
  readonly stage: IdentificationGraphStateV1["stage"];
}): Promise<boolean> => {
  try {
    const receipt = await input.ports.transactionUnit.execute(
      {
        projectId: input.projectId,
        commandKind: input.commandKind,
        commandId: input.commandId,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
        actorRef: input.actorId,
        authorizationContextRef: input.authorization.authorizationContextRef,
        issuedAt: input.issuedAt,
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
      },
      async () => ({
        resultRef: input.resultRef,
        audit: {
          auditEntryId: `${input.commandId}:audit`,
          projectId: input.projectId,
          action: input.commandKind,
          targetRef: input.resultRef,
          actorRef: input.actorId,
          authorizationContextRef: input.authorization.authorizationContextRef,
          occurredAt: input.issuedAt,
          recordedAt: input.issuedAt,
          version: {
            entityId: input.resultRef.reference.entityId,
            versionId: input.resultRef.reference.versionId,
          },
          commandId: input.commandId,
          idempotencyKey: input.idempotencyKey,
          ...(input.runId === undefined ? {} : { runId: input.runId }),
          ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
        },
        events: [],
      }),
    );
    return receipt.replayed;
  } catch (error: unknown) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "TRANSACTION_FAILED";
    const retryable =
      typeof error === "object" &&
      error !== null &&
      "retryable" in error &&
      typeof error.retryable === "boolean"
        ? error.retryable
        : false;
    throw runFailure({
      stage: input.stage,
      code,
      retryable,
      detailCode: code.toLowerCase(),
      occurredAt: input.issuedAt,
    });
  }
};

const isGraphInterruptError = (error: unknown): boolean => error instanceof GraphInterrupt;

const cancellationResultRef = (input: {
  readonly projectId: string;
  readonly runId: string;
  readonly versionId: string;
}): IdentificationRunResultRefV1 => ({
  kind: "identification-run-result",
  reference: {
    entityId: `identification-cancellation:${input.projectId}:${input.runId}`,
    versionId: input.versionId,
  },
});

/**
 * 技术重试退避：次数与退避只来自冻结 `retryPolicyRef`（design D-10）。
 * 策略或最近失败事实读不到时不施加退避提示，由后续真实失败收口，绝不猜测阈值。
 */
const retryBackoffUntil = async (input: {
  readonly ports: IdentificationGraphPortsV1;
  readonly run: IdentificationGraphRunContextV1;
  readonly state: IdentificationGraphStateV1;
}): Promise<string | undefined> => {
  try {
    const policySet = await readFrozenPolicyForRun({
      ports: input.ports,
      run: input.run,
      state: input.state,
      stage: input.state.stage,
    });
    const latest = await input.ports.registrationStore.readLatestRunState({
      projectId: input.run.projectId,
      runId: input.run.runRef.reference.entityId,
    });
    if (latest === undefined) return undefined;
    return new Date(
      Date.parse(latest.row.recordedAt) + policySet.retryPolicy.backoffMs,
    ).toISOString();
  } catch {
    return undefined;
  }
};

export const createIdentificationGraphRuntime = (
  options: IdentificationGraphRuntimeOptionsV1,
): IdentificationGraphRuntimeV1 => {
  const { ports } = options;

  const parseGraphResult = (value: unknown): IdentificationGraphStateV1 =>
    IdentificationGraphStateV1Schema.parse(
      typeof value === "object" && value !== null
        ? Object.fromEntries(
            Object.entries(value).filter(([key]) =>
              Object.hasOwn(IdentificationGraphStateV1Schema.shape, key),
            ),
          )
        : value,
    );

  const outcomeOf = async (input: {
    readonly run: IdentificationGraphRunContextV1;
    readonly state: IdentificationGraphStateV1;
    readonly disposition: IdentificationGraphRunOutcomeV1["disposition"];
  }): Promise<IdentificationGraphRunOutcomeV1> => {
    const cursor = await readCursor({ ports, run: input.run });
    if (cursor === undefined) {
      throw runFailure({
        stage: input.state.stage,
        code: "CONTRACT_INVALID",
        retryable: false,
        detailCode: "run-cursor-missing",
        occurredAt: options.now().toISOString(),
      });
    }
    return {
      state: input.state,
      runVersionId: cursor.runVersionId,
      disposition: input.disposition,
    };
  };

  const runGraph = async (input: {
    readonly run: IdentificationGraphRunContextV1;
    readonly graphInput:
      | { readonly kind: "start"; readonly state: IdentificationGraphStateV1 }
      | { readonly kind: "resume"; readonly resumeValue: IdentificationGraphResumeCauseV1 }
      | { readonly kind: "retry"; readonly state: IdentificationGraphStateV1 };
    readonly stage: IdentificationGraphStateV1["stage"];
  }): Promise<IdentificationGraphStateV1> => {
    try {
      const result =
        input.graphInput.kind === "start"
          ? await options.graph.invoke({ graph: input.graphInput.state }, graphConfig(input.run))
          : input.graphInput.kind === "retry"
            ? await options.graph.retry(input.graphInput.state, graphConfig(input.run))
            : await options.graph.resume(
                { resume: input.graphInput.resumeValue },
                graphConfig(input.run),
              );
      return parseGraphResult(result);
    } catch (error: unknown) {
      if (error instanceof IdentificationGraphNodeFailureV1) {
        throw new IdentificationGraphRunErrorV1(error.error);
      }
      if (isGraphInterruptError(error)) throw error;
      // checkpoint 写入等运行期失败：业务事实已提交，返回可重试技术错误（design D-07）。
      throw new IdentificationGraphRunErrorV1(
        runFailure({
          stage: input.stage,
          code: "TRANSIENT_FAILURE",
          retryable: true,
          detailCode: "graph-invocation-failed",
          occurredAt: options.now().toISOString(),
        }).error,
        undefined,
        error,
      );
    }
  };

  return {
    async start(command) {
      const runIdentity = identificationRunIdentityFor({
        projectId: command.projectId,
        parentRiskFlowRunRef: command.parentRiskFlowRunRef,
        preparationSnapshotRef: command.preparationSnapshotRef,
        graphVersion: command.graphVersion,
      });
      const run: IdentificationGraphRunContextV1 = {
        projectId: command.projectId,
        actorId: command.actorId,
        authorization: command.authorization,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        issuedAt: command.issuedAt,
        validAt: command.validAt,
        triggerReasonCode: command.triggerReasonCode,
        runRef: runIdentity.runRef,
        parentRiskFlowRunRef: command.parentRiskFlowRunRef,
        graphVersion: command.graphVersion,
        preparationSnapshotRef: command.preparationSnapshotRef,
        threadId: runIdentity.threadId,
      };
      const authorized = await options.authorization.verifyCurrent({
        authorization: command.authorization,
        projectId: command.projectId,
        actorId: command.actorId,
        invocationId: invocationIdFor({
          operation: "workflow-start",
          projectId: command.projectId,
          targetId: command.commandId,
        }),
        branch: "workflow.start-run",
        requestedAt: command.requestedAt,
      });
      if (authorized === undefined) {
        throw runFailure({
          stage: "I0",
          code: "AUTHORIZATION_DENIED",
          retryable: false,
          detailCode: "authorization_denied",
          occurredAt: options.now().toISOString(),
        });
      }
      const frozenRun: IdentificationGraphRunContextV1 = { ...run, authorization: authorized };
      const replayed = await recordCommandReceipt({
        ports,
        projectId: command.projectId,
        actorId: command.actorId,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        commandKind: "identification-graph.start",
        issuedAt: command.issuedAt,
        authorization: authorized,
        payload: {
          runRef: runIdentity.runRef,
          preparationSnapshotRef: command.preparationSnapshotRef,
          graphVersion: command.graphVersion,
          triggerReasonCode: command.triggerReasonCode,
          validAt: command.validAt,
        },
        resultRef: runIdentity.runRef,
        runId: runIdentity.runRef.reference.entityId,
        threadId: runIdentity.threadId,
        stage: "I0",
      });
      const existing = await readCursor({ ports, run: frozenRun });
      if (replayed && existing !== undefined) {
        // 同载荷重放：不重复创建输入、计划、任务、阶段事实或 checkpoint 线程。
        const state = await readCheckpointState({ graph: options.graph, run: frozenRun });
        if (state === undefined) {
          throw runFailure({
            stage: existing.stage,
            code: "TRANSIENT_FAILURE",
            retryable: true,
            detailCode: "transient_failure",
            occurredAt: options.now().toISOString(),
          });
        }
        if (state.status === "running" || state.status === "pending") {
          throw runFailure({
            stage: state.stage,
            code: "TRANSIENT_FAILURE",
            retryable: true,
            detailCode: "checkpoint-write-unconfirmed",
            occurredAt: options.now().toISOString(),
          });
        }
        return await outcomeOf({ run: frozenRun, state, disposition: "existing" });
      }
      const initialState = IdentificationGraphStateV1Schema.parse({
        schemaVersion: "1",
        graphVersion: command.graphVersion,
        parentRiskFlowRunRef: command.parentRiskFlowRunRef,
        runRef: runIdentity.runRef,
        threadId: runIdentity.threadId,
        triggerType: "manual",
        triggerReasonCode: command.triggerReasonCode,
        authorizationContextRef: authorized.authorizationContextRef,
        preparationSnapshotRef: command.preparationSnapshotRef,
        status: "running",
        stage: "I0",
        agentTaskRefs: [],
        acceptedRiskRecordRefs: [],
        reviewTaskRefs: [],
        rejectedGroupRefs: [],
        failedWorkItemRefs: [],
      });
      const state = await runGraph({
        run: frozenRun,
        graphInput: { kind: "start", state: initialState },
        stage: "I0",
      });
      return await outcomeOf({
        run: frozenRun,
        state,
        disposition: existing === undefined ? "created" : "existing",
      });
    },

    async resume(command) {
      const cursorBefore = await readCursor({
        ports,
        run: {
          projectId: command.projectId,
          actorId: command.actorId,
          authorization: command.authorization,
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          issuedAt: command.issuedAt,
          validAt: command.issuedAt,
          triggerReasonCode: "resume",
          runRef: command.runRef,
          parentRiskFlowRunRef: command.runRef,
          graphVersion: { entityId: "identification-graph", versionId: "resume" },
          preparationSnapshotRef: {
            kind: "identification-preparation-snapshot",
            reference: { entityId: "unknown", versionId: "unknown" },
          },
          threadId: `identification-run-thread:${command.projectId}:${command.runRef.reference.versionId}`,
        },
      });
      if (cursorBefore === undefined) {
        throw runFailure({
          stage: "I0",
          code: "ENTITY_NOT_FOUND",
          retryable: false,
          detailCode: "entity_not_found",
          occurredAt: options.now().toISOString(),
        });
      }
      const authorized = await options.authorization.verifyCurrent({
        authorization: command.authorization,
        projectId: command.projectId,
        actorId: command.actorId,
        invocationId: invocationIdFor({
          operation: "workflow-resume",
          projectId: command.projectId,
          targetId: command.commandId,
        }),
        branch: "workflow.resume-run",
        requestedAt: command.requestedAt,
      });
      if (authorized === undefined) {
        throw runFailure({
          stage: cursorBefore.stage,
          code: "AUTHORIZATION_DENIED",
          retryable: false,
          detailCode: "authorization_denied",
          occurredAt: options.now().toISOString(),
        });
      }
      const replayed = await recordCommandReceipt({
        ports,
        projectId: command.projectId,
        actorId: command.actorId,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        commandKind: "identification-graph.resume",
        issuedAt: command.issuedAt,
        authorization: authorized,
        payload: {
          runRef: command.runRef,
          expectedRunVersionId: command.expectedRunVersionId,
          resumeKind: command.resumeCause.kind,
          ...(command.resumeCause.kind === "agent-task-completed"
            ? { agentTaskRef: command.resumeCause.agentTaskRef }
            : {}),
          ...(command.resumeCause.kind === "review-resolved"
            ? { reviewDecisionRef: command.resumeCause.reviewDecisionRef }
            : {}),
        },
        resultRef: command.runRef,
        runId: command.runRef.reference.entityId,
        threadId: undefined,
        stage: cursorBefore.stage,
      });
      const run: IdentificationGraphRunContextV1 = {
        projectId: command.projectId,
        actorId: command.actorId,
        authorization: authorized,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        issuedAt: command.issuedAt,
        validAt: command.issuedAt,
        triggerReasonCode: "resume",
        runRef: command.runRef,
        parentRiskFlowRunRef: command.runRef,
        graphVersion: {
          entityId: "identification-graph",
          versionId: command.runRef.reference.versionId,
        },
        preparationSnapshotRef: {
          kind: "identification-preparation-snapshot",
          reference: { entityId: "unknown", versionId: "unknown" },
        },
        threadId: `identification-run-thread:${command.projectId}:${command.runRef.reference.versionId}`,
      };
      const checkpointState = await readCheckpointState({ graph: options.graph, run });
      // checkpoint 状态里的冻结身份是权威：恢复必须用原 thread ID 与原准备快照（design D-05）。
      const frozenRun: IdentificationGraphRunContextV1 = {
        ...run,
        runRef: checkpointState?.runRef ?? run.runRef,
        parentRiskFlowRunRef: checkpointState?.parentRiskFlowRunRef ?? run.parentRiskFlowRunRef,
        graphVersion: checkpointState?.graphVersion ?? run.graphVersion,
        preparationSnapshotRef:
          checkpointState?.preparationSnapshotRef ?? run.preparationSnapshotRef,
        triggerReasonCode: checkpointState?.triggerReasonCode ?? run.triggerReasonCode,
        threadId: checkpointState?.threadId ?? run.threadId,
      };
      if (checkpointState === undefined) {
        throw runFailure({
          stage: cursorBefore.stage,
          code: "TERMINAL_FAILURE",
          retryable: false,
          detailCode: "terminal_failure",
          occurredAt: options.now().toISOString(),
        });
      }
      if (replayed) {
        return await outcomeOf({ run: frozenRun, state: checkpointState, disposition: "resumed" });
      }
      // checkpoint 引用对账：无法由当前授权下的业务回读证明时零补写地封闭（design D-07）。
      const reconcile = await ports.checkpoints.reconcileCheckpointReferences({
        projectId: command.projectId,
        runId: command.runRef.reference.entityId,
        state: checkpointState,
        actorId: command.actorId,
        requestedAt: command.requestedAt,
        authorization: authorized,
      });
      if (reconcile.kind === "inconsistent") {
        throw runFailure({
          stage: cursorBefore.stage,
          code: "TERMINAL_FAILURE",
          retryable: false,
          detailCode: "checkpoint-inconsistent",
          occurredAt: options.now().toISOString(),
        });
      }
      const expected = cursorBefore;
      const cancellationRow = (
        await ports.registrationStore.listRunRows({
          projectId: command.projectId,
          runId: command.runRef.reference.entityId,
        })
      ).find((row) => row.resultKind === "cancellation");
      if (cancellationRow !== undefined) {
        return await outcomeOf({
          run: frozenRun,
          state: IdentificationGraphStateV1Schema.parse({
            ...checkpointState,
            status: "cancelled",
            waitingRef: undefined,
            resultRef: cancellationResultRef({
              projectId: command.projectId,
              runId: command.runRef.reference.entityId,
              versionId: cancellationRow.requestDigest,
            }),
          }),
          disposition: "existing",
        });
      }
      if (expected.status !== "waiting" && expected.status !== "retryable-failure") {
        // 迟到信号：运行已离开该等待，返回原回执且不重复恢复。
        return await outcomeOf({ run: frozenRun, state: checkpointState, disposition: "existing" });
      }
      if (expected.runVersionId !== command.expectedRunVersionId) {
        throw runFailure({
          stage: expected.stage,
          code: "STALE_VERSION",
          retryable: false,
          detailCode: "stale_version",
          occurredAt: options.now().toISOString(),
        });
      }
      const waiting = expected.lastWaitingRef;
      if (command.resumeCause.kind === "transient-recovered") {
        if (expected.status !== "retryable-failure") {
          throw runFailure({
            stage: expected.stage,
            code: "BUSINESS_BLOCKED",
            retryable: false,
            detailCode: "not-a-retryable-failure",
            occurredAt: options.now().toISOString(),
          });
        }
        const backoffUntil = await retryBackoffUntil({
          ports,
          run: frozenRun,
          state: checkpointState,
        });
        if (backoffUntil !== undefined && options.now().getTime() < Date.parse(backoffUntil)) {
          throw runFailure({
            stage: expected.stage,
            code: "TRANSIENT_FAILURE",
            retryable: true,
            detailCode: "retry-backoff-pending",
            occurredAt: options.now().toISOString(),
            retryAt: backoffUntil,
          });
        }
      } else if (waiting === undefined) {
        throw runFailure({
          stage: expected.stage,
          code: "BUSINESS_BLOCKED",
          retryable: false,
          detailCode: "waiting-reference-missing",
          occurredAt: options.now().toISOString(),
        });
      } else if (
        (command.resumeCause.kind === "agent-task-completed" &&
          waiting.kind !== "retrieval-review-agent") ||
        (command.resumeCause.kind === "review-resolved" && waiting.kind !== "human-review")
      ) {
        throw runFailure({
          stage: expected.stage,
          code: "BUSINESS_BLOCKED",
          retryable: false,
          detailCode: "waiting-reference-kind-mismatch",
          occurredAt: options.now().toISOString(),
        });
      } else if (
        command.resumeCause.kind === "agent-task-completed" &&
        (waiting.kind !== "retrieval-review-agent" ||
          waiting.agentTaskRef.reference.entityId !==
            command.resumeCause.agentTaskRef.reference.entityId ||
          waiting.agentTaskRef.reference.versionId !==
            command.resumeCause.agentTaskRef.reference.versionId)
      ) {
        throw runFailure({
          stage: expected.stage,
          code: "BUSINESS_BLOCKED",
          retryable: false,
          detailCode: "waiting-reference-version-mismatch",
          occurredAt: options.now().toISOString(),
        });
      }
      const state = await runGraph({
        run: frozenRun,
        graphInput:
          command.resumeCause.kind === "transient-recovered"
            ? { kind: "retry", state: checkpointState }
            : { kind: "resume", resumeValue: command.resumeCause },
        stage: expected.stage,
      });
      return await outcomeOf({ run: frozenRun, state, disposition: "resumed" });
    },

    async cancel(command) {
      const authorized = await options.authorization.verifyCurrent({
        authorization: command.authorization,
        projectId: command.projectId,
        actorId: command.actorId,
        invocationId: invocationIdFor({
          operation: "workflow-cancel",
          projectId: command.projectId,
          targetId: command.commandId,
        }),
        branch: "workflow.cancel-run",
        requestedAt: command.requestedAt,
      });
      if (authorized === undefined) {
        throw runFailure({
          stage: "I0",
          code: "AUTHORIZATION_DENIED",
          retryable: false,
          detailCode: "authorization_denied",
          occurredAt: options.now().toISOString(),
        });
      }
      const provisionalRun: IdentificationGraphRunContextV1 = {
        projectId: command.projectId,
        actorId: command.actorId,
        authorization: authorized,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        issuedAt: command.issuedAt,
        validAt: command.issuedAt,
        triggerReasonCode: "cancel",
        runRef: command.runRef,
        parentRiskFlowRunRef: command.runRef,
        graphVersion: {
          entityId: "identification-graph",
          versionId: command.runRef.reference.versionId,
        },
        preparationSnapshotRef: {
          kind: "identification-preparation-snapshot",
          reference: { entityId: "unknown", versionId: "unknown" },
        },
        threadId: `identification-run-thread:${command.projectId}:${command.runRef.reference.versionId}`,
      };
      const replayed = await recordCommandReceipt({
        ports,
        projectId: command.projectId,
        actorId: command.actorId,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        commandKind: "identification-graph.cancel",
        issuedAt: command.issuedAt,
        authorization: authorized,
        payload: { runRef: command.runRef, reasonCode: command.reasonCode },
        resultRef: command.runRef,
        runId: command.runRef.reference.entityId,
        threadId: undefined,
        stage: "I0",
      });
      const checkpointState = await readCheckpointState({
        graph: options.graph,
        run: provisionalRun,
      });
      // 取消同样以 checkpoint 冻结身份为准，确保回执与对账读的是同一线程与准备快照。
      const run: IdentificationGraphRunContextV1 = {
        ...provisionalRun,
        runRef: checkpointState?.runRef ?? provisionalRun.runRef,
        parentRiskFlowRunRef:
          checkpointState?.parentRiskFlowRunRef ?? provisionalRun.parentRiskFlowRunRef,
        graphVersion: checkpointState?.graphVersion ?? provisionalRun.graphVersion,
        preparationSnapshotRef:
          checkpointState?.preparationSnapshotRef ?? provisionalRun.preparationSnapshotRef,
        triggerReasonCode: checkpointState?.triggerReasonCode ?? provisionalRun.triggerReasonCode,
        threadId: checkpointState?.threadId ?? provisionalRun.threadId,
      };
      const cursor = await readCursor({ ports, run });
      if (cursor === undefined || checkpointState === undefined) {
        throw runFailure({
          stage: "I0",
          code: "ENTITY_NOT_FOUND",
          retryable: false,
          detailCode: "entity_not_found",
          occurredAt: options.now().toISOString(),
        });
      }
      if (replayed || cursor.status === "cancelled") {
        const cancellationRow = (
          await ports.registrationStore.listRunRows({
            projectId: command.projectId,
            runId: command.runRef.reference.entityId,
          })
        ).find((row) => row.resultKind === "cancellation");
        if (cancellationRow === undefined) {
          throw runFailure({
            stage: cursor.stage,
            code: "CONTRACT_INVALID",
            retryable: false,
            detailCode: "cancellation-result-missing",
            occurredAt: options.now().toISOString(),
          });
        }
        return await outcomeOf({
          run,
          state: IdentificationGraphStateV1Schema.parse({
            ...checkpointState,
            status: "cancelled",
            waitingRef: undefined,
            resultRef: cancellationResultRef({
              projectId: command.projectId,
              runId: command.runRef.reference.entityId,
              versionId: cancellationRow.requestDigest,
            }),
          }),
          disposition: "already-cancelled",
        });
      }
      if (cursor.runVersionId !== command.expectedRunVersionId) {
        throw runFailure({
          stage: cursor.stage,
          code: "STALE_VERSION",
          retryable: false,
          detailCode: "stale_version",
          occurredAt: options.now().toISOString(),
        });
      }
      const cancellation = IdentificationGraphCancellationV1Schema.parse({
        schemaVersion: "1",
        runRef: command.runRef,
        reasonCode: command.reasonCode,
        cancelledAt: command.issuedAt,
      });
      const cancellationRef = cancellationResultRef({
        projectId: command.projectId,
        runId: command.runRef.reference.entityId,
        versionId: sha256CanonicalJson(cancellation),
      });
      const artifactId = `identification-graph-cancellation:${command.runRef.reference.entityId}`;
      const actionId = `${command.commandId}:cancel`;
      const put = await ports.bodies.putBody({
        projectId: command.projectId,
        actorId: command.actorId,
        commandId: `${actionId}:body`,
        issuedAt: command.issuedAt,
        artifactId,
        body: { bodyKind: "cancellation", cancellation },
        authorization: authorized,
      });
      const artifactRef = ContentArtifactRefV1Schema.parse(put);
      const runStateRef = {
        entityId: `identification-graph-run-state:${command.runRef.reference.entityId}`,
        versionId: sha256CanonicalJson({
          cancellation: cancellationRef,
          cursor: cursor.runVersionId,
        }),
      };
      await ports.transactionUnit.execute(
        {
          projectId: command.projectId,
          commandKind: "identification-graph.cancel",
          commandId: actionId,
          idempotencyKey: actionId,
          payload: { runRef: command.runRef, cancellationRef },
          actorRef: command.actorId,
          authorizationContextRef: authorized.authorizationContextRef,
          issuedAt: command.issuedAt,
          runId: command.runRef.reference.entityId,
          threadId: run.threadId,
        },
        async (context) => {
          const cancelled = await ports.registrationStore.registerRow(
            {
              row: {
                schemaVersion: "1",
                projectId: command.projectId,
                resultKind: "cancellation",
                resultId: artifactRef.reference.entityId,
                resultVersionId: artifactRef.reference.versionId,
                runId: command.runRef.reference.entityId,
                runVersionId: runStateRef.versionId,
                commandId: actionId,
                idempotencyKey: `identification-graph:cancellation:${command.runRef.reference.entityId}`,
                requestDigest: sha256CanonicalJson(cancellation),
                artifactRef,
                authorizationScopeDigest: authorizationScopeDigest(authorized),
                actorRef: command.actorId,
                authorizationContextRef: authorized.authorizationContextRef,
                validAt: command.issuedAt,
                recordedAt: command.issuedAt,
                persistedAt: command.issuedAt,
                auditEntryId: `${actionId}:audit`,
              },
              occurredAt: command.issuedAt,
            },
            context,
          );
          if (cancelled.kind === "idempotency-conflict") {
            throw new TypeError("identification-graph cancellation idempotency conflict");
          }
          return {
            resultRef: artifactRef,
            audit: {
              auditEntryId: `${actionId}:audit`,
              projectId: command.projectId,
              action: "identification-graph.cancel",
              targetRef: artifactRef,
              actorRef: command.actorId,
              authorizationContextRef: authorized.authorizationContextRef,
              occurredAt: command.issuedAt,
              recordedAt: options.now().toISOString(),
              version: {
                entityId: artifactRef.reference.entityId,
                versionId: artifactRef.reference.versionId,
              },
              commandId: actionId,
              idempotencyKey: actionId,
              runId: command.runRef.reference.entityId,
              threadId: run.threadId,
            },
            events: [],
          };
        },
      );
      return await outcomeOf({
        run,
        state: IdentificationGraphStateV1Schema.parse({
          ...checkpointState,
          status: "cancelled",
          waitingRef: undefined,
          resultRef: cancellationRef,
        }),
        disposition: "cancellation-recorded",
      });
    },
  };
};
