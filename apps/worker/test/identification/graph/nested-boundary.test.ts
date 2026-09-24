/**
 * 合成样本、待甲方复核：本文件全部工程、参与者、命令身份、摘要与工件正文均为合成夹具。
 *
 * C40 嵌套边界行为验证（spec `父图调用识别子图时保持中断与检查点边界`）：父图用真实
 * `StateGraph` + 真实 C03 PostgreSQL checkpointer，识别子运行用真实 C24 图、运行时、适配器与
 * 登记面，只复现 C30 识别节点「调用 C24 运行时并登记父等待」的调用方式，不复制其实现。
 * 断言父/子检查点身份、等待引用、错误类别与数据库事实，不锁定 LangGraph 内部节点调用顺序。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  RiskFlowGraphStateV1Schema,
  type RiskFlowGraphStateV1,
} from "@riskflow/contracts/workflows";
import type { IdentificationGraphStartCommandV1 } from "@riskflow/core/identification/graph";

import { setupPostgresCheckpointer } from "../../../../../packages/adapters/test/identification/graph/wiring.js";
import type { IdentificationGraphRunOutcomeV1 } from "../../../src/identification/graph/index.js";

import {
  AUTHORIZATION_CONTEXT_REF,
  PARENT_RUN_REF,
  PROJECT_ID,
  SYNTHETIC_SAMPLE_NOTICE,
  WORK_PLAN_ENTITY_ID,
  automaticRouteFor,
  reviewDecisionRefFor,
  reviewRouteFor,
  riskRecordRefFor,
  startIdentificationGraphHarness,
  versionRef,
  type IdentificationGraphHarnessV1,
} from "./fixture.js";

/** 自动验收组：I6 合并只形成该组时由系统决定直接入库。 */
const AUTO_GROUP = "nested-group-auto";
/** 人工复核组：决定未成立时阻塞在 I8 等待。 */
const REVIEW_GROUP = "nested-group-review";

const PARENT_THREAD_ID = `risk-flow-run-thread:${PROJECT_ID}:c40-nested-boundary`;
const PARENT_CONFIG = { configurable: { thread_id: PARENT_THREAD_ID } };

const parentChannels = Annotation.Root({
  schemaVersion: Annotation<RiskFlowGraphStateV1["schemaVersion"]>(),
  graphVersion: Annotation<RiskFlowGraphStateV1["graphVersion"]>(),
  runRef: Annotation<RiskFlowGraphStateV1["runRef"]>(),
  threadId: Annotation<RiskFlowGraphStateV1["threadId"]>(),
  entryMode: Annotation<RiskFlowGraphStateV1["entryMode"]>(),
  authorizationContextRef: Annotation<RiskFlowGraphStateV1["authorizationContextRef"]>(),
  status: Annotation<RiskFlowGraphStateV1["status"]>(),
  stage: Annotation<RiskFlowGraphStateV1["stage"]>(),
  assessmentRunRefs: Annotation<RiskFlowGraphStateV1["assessmentRunRefs"]>(),
  waitingRefs: Annotation<RiskFlowGraphStateV1["waitingRefs"]>(),
  identificationRunRef: Annotation<RiskFlowGraphStateV1["identificationRunRef"]>(),
});

/** 父图初始状态：真实父运行（`RiskFlowGraphStateV1`）停在识别阶段、等待登记前。 */
const parentInitialState = (): RiskFlowGraphStateV1 =>
  RiskFlowGraphStateV1Schema.parse({
    schemaVersion: "1",
    graphVersion: versionRef("risk-flow-graph", "1"),
    runRef: PARENT_RUN_REF,
    threadId: PARENT_THREAD_ID,
    entryMode: "identify-and-assess",
    authorizationContextRef: AUTHORIZATION_CONTEXT_REF,
    status: "running",
    stage: "identification",
    assessmentRunRefs: [],
    waitingRefs: [],
  });

interface NestedParentRunV1 {
  /** 父检查点暴露的公开状态（按 schema 字段取回，父图未写检查点时为空对象）。 */
  readonly parentState: Record<string, unknown>;
  readonly parentNext: readonly string[];
  readonly childOutcome: IdentificationGraphRunOutcomeV1 | undefined;
  /** 父节点内 C24 调用抛出的错误；未抛出时为 `undefined`。 */
  readonly childThrown: unknown;
  /** 父图自身调用抛出的错误；未抛出时为 `undefined`。 */
  readonly parentThrown: unknown;
}

const parentStateOf = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || !("values" in value)) return {};
  const values = (value as { readonly values?: unknown }).values;
  if (typeof values !== "object" || values === null) return {};
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => Object.hasOwn(RiskFlowGraphStateV1Schema.shape, key)),
  );
};

/**
 * 在真实 C03 容器内跑一次「父图识别节点调用 C24 子运行」：父 saver 与 C24 子 saver 是同一容器的
 * 独立实例，父图只复现 C30 的调用方式（不捕获图中断、不伪造检查点），资源在本函数内收口。
 */
const runNestedParent = async (input: {
  readonly harness: IdentificationGraphHarnessV1;
  readonly startCommand: IdentificationGraphStartCommandV1;
}): Promise<NestedParentRunV1> => {
  const checkpointer = await setupPostgresCheckpointer({
    ...input.harness.postgres.checkpointer,
    validateReference: () => true,
  });
  let childOutcome: IdentificationGraphRunOutcomeV1 | undefined;
  let childThrown: unknown;
  let parentThrown: unknown;
  const parent = new StateGraph(parentChannels)
    .addNode("identification", async () => {
      try {
        const outcome = await input.harness.runtime.start(input.startCommand);
        childOutcome = outcome;
        return {
          identificationRunRef: outcome.state.runRef,
          status: outcome.state.status,
          waitingRefs: outcome.state.waitingRef === undefined ? [] : [outcome.state.waitingRef],
        };
      } catch (error: unknown) {
        childThrown = error;
        throw error;
      }
    })
    .addEdge(START, "identification")
    .addEdge("identification", END)
    .compile({ checkpointer });
  try {
    await parent.invoke(parentInitialState(), PARENT_CONFIG);
  } catch (error: unknown) {
    parentThrown = error;
  }
  const snapshot = await parent.getState(PARENT_CONFIG);
  await checkpointer.end();
  return {
    parentState: parentStateOf(snapshot),
    parentNext: (snapshot as { readonly next?: readonly string[] }).next ?? [],
    childOutcome,
    childThrown,
    parentThrown,
  };
};

/** 同容器检查点分布：只按 C03 表事实断言子运行检查点的线程与命名空间归属。 */
const checkpointNamespacesOf = async (
  harness: IdentificationGraphHarnessV1,
  threadId: string,
): Promise<readonly { readonly namespace: string; readonly rows: number }[]> => {
  const result = await harness.postgres.adminPool.query<{ namespace: string; rows: number }>(
    "select checkpoint_ns as namespace, count(*)::int as rows from langgraph_checkpoint.checkpoints where thread_id = $1 group by 1 order by 1",
    [threadId],
  );
  return result.rows;
};

describe(`C24 嵌套图边界（真实父/子 StateGraph + 真实 C03 PostgreSQL checkpointer）— ${SYNTHETIC_SAMPLE_NOTICE}`, () => {
  let harness: IdentificationGraphHarnessV1;

  beforeEach(async () => {
    harness = await startIdentificationGraphHarness();
  }, 300_000);

  afterEach(async () => {
    await harness.close();
  }, 120_000);

  it("嵌套识别运行进入人工复核等待：父图登记自身等待、子检查点归属原子运行", async () => {
    const { world } = harness;
    const run = harness.scope("nested-review-wait");
    const reviewRoute = reviewRouteFor(WORK_PLAN_ENTITY_ID, REVIEW_GROUP, run.runRef);
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP), reviewRoute];

    const nested = await runNestedParent({
      harness,
      startCommand: harness.startCommand(run),
    });

    // 子运行返回既有类型化等待结果，父节点据此登记父运行等待，中断不穿透父节点。
    expect(nested.childThrown).toBeUndefined();
    expect(nested.parentThrown).toBeUndefined();
    const outcome = nested.childOutcome;
    expect(outcome?.state.status).toBe("waiting");
    expect(outcome?.state.runRef).toEqual(run.runRef);
    expect(outcome?.state.waitingRef?.kind).toBe("review");
    expect(nested.parentState.status).toBe("waiting");
    expect(nested.parentState.identificationRunRef).toEqual(run.runRef);
    expect(nested.parentState.waitingRefs).toEqual(
      outcome?.state.waitingRef === undefined ? [] : [outcome.state.waitingRef],
    );

    // 子检查点只落在原子运行的线程与根命名空间；父图检查点同样属于父线程的根命名空间。
    const childNamespaces = await checkpointNamespacesOf(harness, run.threadId);
    expect(childNamespaces.map((entry) => entry.namespace)).toEqual([""]);
    expect(childNamespaces[0]?.rows).toBeGreaterThan(0);
    expect(
      (await checkpointNamespacesOf(harness, PARENT_THREAD_ID)).map((entry) => entry.namespace),
    ).toEqual([""]);
    const childSnapshot = (await harness.graph.getState({
      configurable: { thread_id: run.threadId },
    })) as { readonly values?: Record<string, unknown>; readonly next?: readonly string[] };
    expect(childSnapshot.values?.status).toBe("waiting");
    expect(childSnapshot.values?.stage).toBe("I8");
    expect(childSnapshot.next).toContain("wait");

    // 业务等待事实只登记一次，且与子检查点等待引用一致。
    expect(await harness.rows(run, "waiting")).toHaveLength(1);
    const cursor = await harness.latestRunState(run);
    expect(cursor.state.status).toBe("waiting");
    expect(cursor.state.lastWaitingRef?.kind).toBe("human-review");
  }, 120_000);

  it("中断后同身份重试：沿原子运行检查点回读并对账，不重复业务事实", async () => {
    const { world } = harness;
    const run = harness.scope("nested-retry");
    const reviewRoute = reviewRouteFor(WORK_PLAN_ENTITY_ID, REVIEW_GROUP, run.runRef);
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP), reviewRoute];
    const command = harness.startCommand(run);

    const nested = await runNestedParent({ harness, startCommand: command });
    const first = nested.childOutcome;
    expect(first?.state.status).toBe("waiting");
    const rowsAfterFirst = await harness.rows(run);

    // 同命令、同载荷重试：按原子运行线程与检查点身份回读，返回首次等待结果。
    const retried = await harness.runtime.start(command);
    expect(retried.disposition).toBe("existing");
    expect(retried.runVersionId).toBe(first?.runVersionId);
    expect(retried.state.status).toBe("waiting");
    expect(retried.state.waitingRef).toEqual(first?.state.waitingRef);
    // 不重复创建复核任务、阶段结果、风险记录、审计、事件或第二个子运行。
    expect(await harness.rows(run)).toEqual(rowsAfterFirst);
    expect(
      (await checkpointNamespacesOf(harness, run.threadId)).map((entry) => entry.namespace),
    ).toEqual([""]);
    const retriedSnapshot = (await harness.graph.getState({
      configurable: { thread_id: run.threadId },
    })) as { readonly values?: Record<string, unknown>; readonly next?: readonly string[] };
    expect(retriedSnapshot.values?.status).toBe("waiting");
    expect(retriedSnapshot.values?.stage).toBe("I8");
    expect(retriedSnapshot.next).toContain("wait");

    // 父图节点内的重放（C30 恢复时重新进入识别节点的调用方式）同样沿原子检查点对账。
    const replayedInsideParent = await runNestedParent({ harness, startCommand: command });
    expect(replayedInsideParent.childThrown).toBeUndefined();
    expect(replayedInsideParent.childOutcome?.disposition).toBe("existing");
    expect(replayedInsideParent.childOutcome?.state.waitingRef).toEqual(first?.state.waitingRef);
    expect(replayedInsideParent.parentState.status).toBe("waiting");
    expect(replayedInsideParent.parentState.identificationRunRef).toEqual(run.runRef);
    expect(await harness.rows(run)).toEqual(rowsAfterFirst);
  }, 120_000);

  it("原复核决定成立后恢复：沿原子线程推进到终态，重复与迟到信号无额外事实", async () => {
    const { world } = harness;
    const run = harness.scope("nested-resume");
    const reviewRoute = reviewRouteFor(WORK_PLAN_ENTITY_ID, REVIEW_GROUP, run.runRef);
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP), reviewRoute];

    const nested = await runNestedParent({ harness, startCommand: harness.startCommand(run) });
    expect(nested.childOutcome?.state.status).toBe("waiting");
    const cursor = await harness.latestRunState(run);
    const parentCheckpointsBefore = await checkpointNamespacesOf(harness, PARENT_THREAD_ID);

    world.reviewDecisions.set(reviewRoute.groupRef.reference.entityId, {
      kind: "approve-unchanged",
      ref: reviewDecisionRefFor(REVIEW_GROUP),
    });
    const resumeCommand = harness.resumeCommand(run, {
      expectedRunVersionId: cursor.runVersionId,
      resumeCause: {
        kind: "review-resolved",
        reviewDecisionRef: reviewDecisionRefFor(REVIEW_GROUP),
      },
    });
    const resumed = await harness.runtime.resume(resumeCommand);
    expect(resumed.disposition).toBe("resumed");
    expect(resumed.state.status).toBe("completed");
    expect(resumed.state.acceptedRiskRecordRefs.map((ref) => ref.reference.entityId)).toEqual([
      riskRecordRefFor(AUTO_GROUP).reference.entityId,
      riskRecordRefFor(REVIEW_GROUP).reference.entityId,
    ]);

    // 同一原子线程与根命名空间推进到终态；父图检查点不被子图恢复改写，也不新建子运行。
    const childSnapshot = (await harness.graph.getState({
      configurable: { thread_id: run.threadId },
    })) as { readonly values?: Record<string, unknown> };
    expect(childSnapshot.values?.status).toBe("completed");
    expect(childSnapshot.values?.resultRef).toBeDefined();
    expect(
      (await checkpointNamespacesOf(harness, run.threadId)).map((entry) => entry.namespace),
    ).toEqual([""]);
    expect(await checkpointNamespacesOf(harness, PARENT_THREAD_ID)).toEqual(
      parentCheckpointsBefore,
    );

    // 重复恢复信号返回原回执；终态后的迟到信号同样不重放阶段动作。
    const rowsAfterResume = await harness.rows(run);
    const replayed = await harness.runtime.resume(resumeCommand);
    expect(replayed.disposition).toBe("resumed");
    expect(replayed.runVersionId).toBe(resumed.runVersionId);
    expect(await harness.rows(run)).toEqual(rowsAfterResume);
    const late = await harness.runtime.resume(
      harness.resumeCommand(run, {
        resumeCause: {
          kind: "review-resolved",
          reviewDecisionRef: reviewDecisionRefFor(REVIEW_GROUP),
        },
      }),
    );
    expect(late.state.status).toBe("completed");
    expect(await harness.rows(run)).toEqual(rowsAfterResume);
  }, 120_000);

  it("子检查点缺失或错位时零补写封闭，不从父图或错误命名空间推导等待", async () => {
    const { world } = harness;
    const run = harness.scope("nested-checkpoint-misplaced");
    const reviewRoute = reviewRouteFor(WORK_PLAN_ENTITY_ID, REVIEW_GROUP, run.runRef);
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP), reviewRoute];
    const command = harness.startCommand(run);

    const nested = await runNestedParent({ harness, startCommand: command });
    expect(nested.childOutcome?.state.status).toBe("waiting");
    const cursor = await harness.latestRunState(run);
    const rowsAfterWaiting = await harness.rows(run);

    // 定向故障注入：把原子运行的根命名空间检查点整体挪到错误命名空间。
    const misplaced = await harness.postgres.adminPool.query(
      "update langgraph_checkpoint.checkpoints set checkpoint_ns = 'parent-task' where thread_id = $1 and checkpoint_ns = '' returning checkpoint_id",
      [run.threadId],
    );
    expect(misplaced.rowCount).toBeGreaterThan(0);
    await expect(harness.runtime.start(command)).rejects.toMatchObject({
      error: { code: "CONTRACT_INVALID", retryable: false },
    });
    await expect(
      harness.runtime.resume(
        harness.resumeCommand(run, {
          expectedRunVersionId: cursor.runVersionId,
          resumeCause: {
            kind: "review-resolved",
            reviewDecisionRef: reviewDecisionRefFor(REVIEW_GROUP),
          },
        }),
      ),
    ).rejects.toMatchObject({ error: { code: "CONTRACT_INVALID", retryable: false } });

    // 检查点彻底缺失同样失败闭合：已提交业务不回滚、不补写、不伪造等待。
    await harness.postgres.adminPool.query(
      "delete from langgraph_checkpoint.checkpoints where thread_id = $1",
      [run.threadId],
    );
    await expect(harness.runtime.start(command)).rejects.toMatchObject({
      error: { code: "CONTRACT_INVALID", retryable: false },
    });
    expect(await harness.rows(run)).toEqual(rowsAfterWaiting);
    expect((await harness.latestRunState(run)).state.status).toBe("waiting");
  }, 120_000);

  it("等待引用不再由业务登记证明时零补写封闭，不回退父图或检查点事实", async () => {
    const { world } = harness;
    const run = harness.scope("nested-waiting-reference-lost");
    const reviewRoute = reviewRouteFor(WORK_PLAN_ENTITY_ID, REVIEW_GROUP, run.runRef);
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP), reviewRoute];
    const command = harness.startCommand(run);

    const nested = await runNestedParent({ harness, startCommand: command });
    expect(nested.childOutcome?.state.status).toBe("waiting");

    // 定向故障注入：删除等待登记行，检查点的等待引用不再能由当前授权下的业务回读证明。
    await harness.postgres.adminPool.query(
      "DELETE FROM business.identification_graph_results WHERE project_id = $1 AND run_id = $2 AND result_kind = 'waiting'",
      [PROJECT_ID, run.runRef.reference.entityId],
    );
    const rowsAfterDelete = await harness.rows(run);
    expect(rowsAfterDelete.filter((row) => row.resultKind === "waiting")).toHaveLength(0);

    await expect(harness.runtime.start(command)).rejects.toMatchObject({
      error: { retryable: false, detailCode: "checkpoint-inconsistent" },
    });
    // 零补写：不从检查点正文补写登记行，已成立事实与运行游标保持不变。
    expect(await harness.rows(run)).toEqual(rowsAfterDelete);
    expect((await harness.latestRunState(run)).state.status).toBe("waiting");
  }, 120_000);

  it("历史等待引用不能充当最新运行版本的等待", async () => {
    const { world } = harness;
    const run = harness.scope("nested-stale-waiting");
    world.routes = [
      automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP),
      reviewRouteFor(WORK_PLAN_ENTITY_ID, REVIEW_GROUP, run.runRef),
    ];
    const command = harness.startCommand(run);
    expect(
      (await runNestedParent({ harness, startCommand: command })).childOutcome?.state.status,
    ).toBe("waiting");

    // 模拟旧版本仍留有同一等待登记：引用存在，但不属于最新业务游标版本。
    const changed = await harness.postgres.adminPool.query(
      "update business.identification_graph_results set run_version_id = 'old-version' where project_id = $1 and run_id = $2 and result_kind = 'waiting' returning result_id",
      [PROJECT_ID, run.runRef.reference.entityId],
    );
    expect(changed.rowCount).toBe(1);
    const rowsAfterChange = await harness.rows(run);
    expect(rowsAfterChange.find((row) => row.resultKind === "waiting")?.runVersionId).toBe(
      "old-version",
    );
    expect((await harness.latestRunState(run)).runVersionId).not.toBe("old-version");
    await expect(harness.runtime.start(command)).rejects.toMatchObject({
      error: { detailCode: "checkpoint-inconsistent", retryable: false },
    });
    expect(await harness.rows(run)).toEqual(rowsAfterChange);
  }, 120_000);

  it("权限收窄后拒绝跨图恢复，且不借错误结果枚举子图业务事实", async () => {
    const { world, access } = harness;
    const run = harness.scope("nested-authorization-revoked");
    const reviewRoute = reviewRouteFor(WORK_PLAN_ENTITY_ID, REVIEW_GROUP, run.runRef);
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP), reviewRoute];

    const nested = await runNestedParent({ harness, startCommand: harness.startCommand(run) });
    expect(nested.childOutcome?.state.status).toBe("waiting");
    const cursor = await harness.latestRunState(run);
    const rowsBefore = await harness.rows(run);
    const resumeCommand = harness.resumeCommand(run, {
      expectedRunVersionId: cursor.runVersionId,
      resumeCause: {
        kind: "review-resolved",
        reviewDecisionRef: reviewDecisionRefFor(REVIEW_GROUP),
      },
    });

    access.revoke();
    try {
      world.reviewDecisions.set(reviewRoute.groupRef.reference.entityId, {
        kind: "approve-unchanged",
        ref: reviewDecisionRefFor(REVIEW_GROUP),
      });
      // 撤权后推进被拒：启动命令在命令级授权复验处拒绝；恢复在受保护游标读取处按不披露语义拒绝，
      // 无权方无法借错误类别判断该运行是否存在（既有 C24 读取语义，不由本 change 改写）。
      await expect(harness.runtime.resume(resumeCommand)).rejects.toMatchObject({
        error: { code: "INPUT_NOT_READY", retryable: false },
      });
      await expect(harness.runtime.start(harness.startCommand(run))).rejects.toMatchObject({
        error: { code: "AUTHORIZATION_DENIED", retryable: false },
      });
    } finally {
      access.restore();
    }
    // 撤权期间不落任何业务事实：恢复授权后回读与撤权前逐字一致，运行仍停在等待。
    expect(await harness.rows(run)).toEqual(rowsBefore);
    expect((await harness.latestRunState(run)).state.status).toBe("waiting");
  }, 120_000);
});
