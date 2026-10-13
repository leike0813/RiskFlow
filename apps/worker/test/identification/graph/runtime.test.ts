/**
 * 合成样本、待甲方复核：本文件全部工程、参与者、命令身份、摘要与工件正文均为合成夹具。
 *
 * IP-21 行为验证：真实 LangGraph `StateGraph` + 真实 PostgreSQL checkpointer + 真实 C03 事务单元 /
 * C04 工件存储 / C24 登记面，只有 C17/C21/C22/C23 与策略目录用可控公开端口替身注入。
 * 断言稳定引用、终态、错误码与事务结果，不锁定节点内部调用顺序，也不用 LLM 文本作硬期望。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { IDENTIFICATION_GRAPH_BODY_PURPOSE_CODE_V1 } from "@riskflow/adapters/identification/graph";
import { createPostgresTransactionUnit } from "@riskflow/adapters/postgres";
import {
  IdentificationStageResultV1Schema,
  type IdentificationStageResultV1,
  type IdentificationStageV1,
} from "@riskflow/contracts/workflows";
import {
  IdentificationGraphArtifactBodyV1Schema,
  IdentificationGraphRunResultV1Schema,
  IdentificationGraphWorkPlanBodyV1Schema,
  type IdentificationGraphResultRowV1,
} from "@riskflow/core/identification/graph";

import {
  INPUT_SNAPSHOT_ENTITY_ID,
  NODE_CURRENT,
  NODE_EXCLUDED,
  NODE_NEIGHBOR,
  PREPARATION_SNAPSHOT_REF,
  PROJECT_ID,
  SYNTHETIC_SAMPLE_NOTICE,
  WORK_PLAN_ENTITY_ID,
  acceptanceSuffixFor,
  acceptedEventRefFor,
  automaticRouteFor,
  reviewDecisionRefFor,
  reviewRouteFor,
  reviewTaskRefFor,
  riskRecordRefFor,
  startIdentificationGraphHarness,
  versionRef,
  workItemRefFor,
  zeroResultRefFor,
  type IdentificationGraphHarnessV1,
  type IdentificationGraphRunScopeV1,
} from "./fixture.js";

/** 自动验收组：I6 合并只形成该组时由系统决定直接入库。 */
const AUTO_GROUP = "group-auto";
/** 人工复核组：决定未成立时本轮待定。 */
const REVIEW_GROUP = "group-review";
/** 另一个人工复核组：用于混合拒绝与全封闭场景。 */
const SECOND_REVIEW_GROUP = "group-review-second";

const workItemCurrent = workItemRefFor(WORK_PLAN_ENTITY_ID, NODE_CURRENT);
const workItemNeighbor = workItemRefFor(WORK_PLAN_ENTITY_ID, NODE_NEIGHBOR);

/** 读取某阶段全部 stage-result 登记行与其正文（正文只在 C04，登记行只保存引用）。 */
const stageRowsOf = async (
  harness: IdentificationGraphHarnessV1,
  run: IdentificationGraphRunScopeV1,
  stage: IdentificationStageV1,
) => {
  const matched: {
    readonly row: Extract<IdentificationGraphResultRowV1, { resultKind: "stage-result" }>;
    readonly result: IdentificationStageResultV1;
  }[] = [];
  for (const row of await harness.rows(run, "stage-result")) {
    if (row.resultKind !== "stage-result") continue;
    const body = IdentificationGraphArtifactBodyV1Schema.parse(
      await harness.readArtifactBody(
        row.artifactRef,
        IDENTIFICATION_GRAPH_BODY_PURPOSE_CODE_V1["stage-result"],
      ),
    );
    if (body.bodyKind !== "stage-result") continue;
    const result = IdentificationStageResultV1Schema.parse(body.stageResult);
    if (result.stage === stage) matched.push({ row, result });
  }
  return matched;
};

const stageResultOf = async (
  harness: IdentificationGraphHarnessV1,
  run: IdentificationGraphRunScopeV1,
  stage: IdentificationStageV1,
) => {
  const [matched] = await stageRowsOf(harness, run, stage);
  if (matched === undefined) throw new TypeError(`${stage} stage result row is not registered`);
  return matched.result;
};

const runResultOf = async (
  harness: IdentificationGraphHarnessV1,
  run: IdentificationGraphRunScopeV1,
) => {
  const row = (await harness.rows(run, "run-result"))[0];
  if (row === undefined || row.resultKind !== "run-result") {
    throw new TypeError("run result row is not registered");
  }
  const body = IdentificationGraphArtifactBodyV1Schema.parse(
    await harness.readArtifactBody(
      row.artifactRef,
      IDENTIFICATION_GRAPH_BODY_PURPOSE_CODE_V1["run-result"],
    ),
  );
  if (body.bodyKind !== "run-result") throw new TypeError("unexpected artifact body kind");
  return {
    row,
    runResult: IdentificationGraphRunResultV1Schema.parse(body.runResult),
  };
};

describe("C24 识别子图运行时（真实 LangGraph + PostgreSQL checkpointer）", () => {
  let harness: IdentificationGraphHarnessV1;

  beforeEach(async () => {
    harness = await startIdentificationGraphHarness();
  }, 300_000);

  afterEach(async () => {
    await harness.close();
  }, 120_000);

  it("I0～I2 从合格准备形成唯一输入快照与完整工作计划，并推进到 I9 完成收口", async () => {
    const { world } = harness;
    const run = harness.scope("happy-path");
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP)];

    const outcome = await harness.runtime.start(harness.startCommand(run));

    expect(SYNTHETIC_SAMPLE_NOTICE).toBe("合成样本、待甲方复核");
    expect(outcome.disposition).toBe("created");
    expect(outcome.state.status).toBe("completed");
    expect(outcome.state.stage).toBe("I9");
    expect(
      await createPostgresTransactionUnit(harness.app).readWorkflowRunBinding({
        projectId: PROJECT_ID,
        runRef: outcome.state.runRef,
        threadId: outcome.state.threadId,
        parentRunRef: outcome.state.parentRiskFlowRunRef,
      }),
    ).toBe(true);
    // I1 冻结的单一输入快照与 I2 完整计划的稳定身份。
    expect(outcome.state.inputSnapshotRef?.reference.entityId).toBe(INPUT_SNAPSHOT_ENTITY_ID);
    expect(outcome.state.workPlanRef?.reference.entityId).toBe(WORK_PLAN_ENTITY_ID);

    const snapshotRows = await harness.rows(run, "input-snapshot");
    const planRows = await harness.rows(run, "work-plan");
    expect(snapshotRows).toHaveLength(1);
    expect(planRows).toHaveLength(1);
    expect(await harness.rows(run, "workflow-error")).toHaveLength(0);
    expect(outcome.state.inputSnapshotRef).toEqual(
      snapshotRows[0]?.resultKind === "input-snapshot"
        ? snapshotRows[0].inputSnapshotRef
        : undefined,
    );
    expect(outcome.state.workPlanRef).toEqual(
      planRows[0]?.resultKind === "work-plan" ? planRows[0].workPlanRef : undefined,
    );

    // 计划正文：覆盖全部适用工序、稳定排序、回引同一准备快照的范围，非适用节点被显式排除。
    const workPlanBody = IdentificationGraphArtifactBodyV1Schema.parse(
      await harness.readArtifactBody(
        planRows[0]!.artifactRef,
        IDENTIFICATION_GRAPH_BODY_PURPOSE_CODE_V1["work-plan"],
      ),
    );
    if (workPlanBody.bodyKind !== "work-plan") {
      throw new TypeError("unexpected artifact body kind");
    }
    const workPlan = IdentificationGraphWorkPlanBodyV1Schema.parse(workPlanBody.workPlan);
    expect(workPlan.workItems.map((item) => item.nodeId)).toEqual([NODE_CURRENT, NODE_NEIGHBOR]);
    expect(workPlan.excludedWorkItems).toEqual([
      { nodeId: NODE_EXCLUDED, reasonCode: "NOT_APPLICABLE" },
    ]);
    for (const item of workPlan.workItems) {
      expect(item.frozenQueryText).toBe(`identification-process-node-query:${item.nodeId}`);
      expect(item.spatialScopeRefs).toEqual([
        { kind: "spatial-scope", reference: versionRef("spatial-scope-c24") },
      ]);
      expect(item.sourceSegmentSetRefs).toEqual([
        { kind: "source-segment-set", reference: versionRef("source-segment-set-c24") },
      ]);
      expect(item.workItemRef).toEqual(workItemRefFor(WORK_PLAN_ENTITY_ID, item.nodeId));
      expect(item.sourceVersionRefs).toEqual([
        { kind: "source-version", reference: versionRef("source-version-c24") },
      ]);
    }

    // I3 为每个工作项形成正式检索工件集与五项上下文后才有 I4/I5 调用。
    expect(world.calls.prepareReview).toHaveLength(2);
    expect(world.calls.assembleContext).toHaveLength(2);
    expect(world.calls.analyze.map((call) => call.kind)).toEqual([
      "assemble-and-infer",
      "repair-and-validate",
      "assemble-and-infer",
      "repair-and-validate",
    ]);
    // I6/I7/I8 各只调用一次全运行收口。
    expect(world.calls.finalize.map((call) => call.kind)).toEqual([
      "merge-run-candidates",
      "route-acceptance",
      "accept-groups",
    ]);

    // I8 阶段结果保存入库记录与事件精确引用；运行游标只追加一次。
    const i8StageResult = await stageResultOf(harness, run, "I8");
    expect(i8StageResult.stage).toBe("I8");
    if (i8StageResult.stage !== "I8") throw new TypeError("last stage result must be I8");
    expect(i8StageResult.standardizedRiskRecordRefs).toEqual([riskRecordRefFor(AUTO_GROUP)]);
    expect(i8StageResult.eventRefs).toEqual([acceptedEventRefFor(AUTO_GROUP)]);
    expect(outcome.state.acceptedRiskRecordRefs).toEqual([riskRecordRefFor(AUTO_GROUP)]);

    // I9 汇总：计数与精确引用一致，等待/拒绝/失败集合为空。
    const { row, runResult } = await runResultOf(harness, run);
    expect(runResult.workPlanRef.reference.entityId).toBe(WORK_PLAN_ENTITY_ID);
    expect(runResult.acceptedRiskRecordRefs).toEqual([riskRecordRefFor(AUTO_GROUP)]);
    expect(runResult.rejectedGroupRefs).toEqual([]);
    expect(runResult.pendingReviewTaskRefs).toEqual([]);
    expect(runResult.failedWorkItemRefs).toEqual([]);
    expect(runResult.skippedWorkItemRefs).toEqual([]);
    expect(outcome.state.resultRef?.reference.versionId).toBe(row.resultVersionId);
  });

  it("I0～I2 工作计划形成前的阶段结果按运行与阶段回读，重放不重复登记（D-15）", async () => {
    const { world } = harness;
    const run = harness.scope("stage-result-before-plan");
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP)];

    const command = harness.startCommand(run);
    const outcome = await harness.runtime.start(command);
    expect(outcome.state.status).toBe("completed");

    // I0 与成功的 I1 各登记一条阶段结果，都不携带工作计划引用，正文分别对应各自阶段。
    const i0 = await stageRowsOf(harness, run, "I0");
    const i1 = await stageRowsOf(harness, run, "I1");
    expect(i0).toHaveLength(1);
    expect(i1).toHaveLength(1);
    expect(i0[0]!.row.workPlanRef).toBeNull();
    expect(i1[0]!.row.workPlanRef).toBeNull();
    expect(i0[0]!.result).toMatchObject({ preparationSnapshotRef: PREPARATION_SNAPSHOT_REF });
    expect(i1[0]!.result).toMatchObject({
      resultKind: "ready",
      inputSnapshotRef: outcome.state.inputSnapshotRef,
    });

    // I2 起沿用同一冻结工作计划引用；阶段结果缺少该引用时按封闭失败处理。
    const frozenWorkPlanRef = outcome.state.workPlanRef;
    expect(frozenWorkPlanRef?.reference.entityId).toBe(WORK_PLAN_ENTITY_ID);
    for (const stage of ["I2", "I8"] as const) {
      const rows = await stageRowsOf(harness, run, stage);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.row.workPlanRef).toEqual(frozenWorkPlanRef);
    }

    // 同键重放不重复登记：I0/I1 的阶段登记与全部阶段登记行保持逐字不变。
    const stageRows = await harness.rows(run, "stage-result");
    const replayed = await harness.runtime.start(command);
    expect(replayed.disposition).toBe("existing");
    expect(await harness.rows(run, "stage-result")).toEqual(stageRows);
    expect(await stageRowsOf(harness, run, "I0")).toHaveLength(1);
    expect(await stageRowsOf(harness, run, "I1")).toHaveLength(1);
  });

  it("I9 精确验收路线不可读时不生成完成汇总", async () => {
    const { world } = harness;
    const run = harness.scope("i9-route-read-failure");
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP)];
    world.routeReadFailureAfter = 1;

    const outcome = await harness.runtime.start(harness.startCommand(run));

    expect(outcome.state.status).toBe("terminal-failure");
    expect(await harness.rows(run, "run-result")).toHaveLength(0);
    expect(await harness.rows(run, "workflow-error")).toHaveLength(1);
  });

  it("I0～I2 知识或策略未就绪时类型化等待且不形成半套输入快照或工作计划", async () => {
    const { world } = harness;
    const run = harness.scope("policy-not-ready");
    world.policyReady = false;
    world.routes = [];
    try {
      const command = harness.startCommand(run);
      const outcome = await harness.runtime.start(command);

      expect(outcome.state.status).toBe("waiting");
      expect(outcome.state.stage).toBe("I1");
      // 类型化等待：只投影为 `WaitingRefV1` 的知识准备变体。
      expect(outcome.state.waitingRef?.kind).toBe("knowledge-preparation");
      expect(await harness.rows(run, "input-snapshot")).toHaveLength(0);
      expect(await harness.rows(run, "work-plan")).toHaveLength(0);
      const waitingRows = await harness.rows(run, "waiting");
      expect(waitingRows).toHaveLength(1);
      expect(waitingRows[0]?.resultKind === "waiting" && waitingRows[0].waitingRef.kind).toBe(
        "knowledge-preparation",
      );
      const cursor = await harness.latestRunState(run);
      expect(cursor.state.stage).toBe("I1");
      expect(cursor.state.status).toBe("waiting");
      expect(cursor.state.lastWaitingRef?.kind).toBe("knowledge-preparation");

      // 相同启动命令重放：返回原等待运行且不重复解析、不重建线程。
      const resolveCallsBefore = world.calls.resolveExact.length;
      const replayed = await harness.runtime.start(command);
      expect(replayed.disposition).toBe("existing");
      expect(replayed.state.status).toBe("waiting");
      expect(replayed.runVersionId).toBe(cursor.runVersionId);
      expect(world.calls.resolveExact.length).toBe(resolveCallsBefore);
      // 复验仍按冻结的同一准备快照与双时间边界解析，不自动改选更新版本。
      for (const call of world.calls.resolveExact) {
        expect(call.preparationSnapshotRef).toEqual(PREPARATION_SNAPSHOT_REF);
        expect(call.requiredAt).toBe(command.validAt);
        expect(call.asOfRecordedAt).toBe(command.issuedAt);
      }

      // 等待类型与恢复原因不匹配时恢复失败闭合，不改为其它等待类型、不补写业务事实。
      await expect(
        harness.runtime.resume(
          harness.resumeCommand(run, {
            expectedRunVersionId: cursor.runVersionId,
            resumeCause: {
              kind: "agent-task-completed",
              agentTaskRef: reviewTaskRefFor(workItemCurrent),
            },
          }),
        ),
      ).rejects.toMatchObject({
        error: {
          code: "UPSTREAM_WAITING",
          retryable: false,
          detailCode: "waiting-reference-kind-mismatch",
        },
      });
      expect(await harness.rows(run, "input-snapshot")).toHaveLength(0);
      expect(await harness.rows(run, "work-plan")).toHaveLength(0);
    } finally {
      world.policyReady = true;
    }
  });

  it("I0～I2 识别基础返回上游类型化等待时登记等待且不写半快照", async () => {
    const { world } = harness;
    const run = harness.scope("basis-waiting");
    world.basis = "waiting";
    try {
      const outcome = await harness.runtime.start(harness.startCommand(run));
      expect(outcome.state.status).toBe("waiting");
      expect(outcome.state.stage).toBe("I1");
      expect(await harness.rows(run, "input-snapshot")).toHaveLength(0);
      expect(await harness.rows(run, "work-plan")).toHaveLength(0);
      const cursor = await harness.latestRunState(run);
      expect(cursor.state.lastWaitingRef).toMatchObject({
        kind: "knowledge-preparation",
        reasonCode: "knowledge-preparation",
      });
    } finally {
      world.basis = "succeeded";
    }
  });

  it("I0～I2 识别基础终止失败时封闭运行且保持既有准备事实不变", async () => {
    const { world } = harness;
    const run = harness.scope("basis-terminal-failure");
    world.basis = "failed";
    try {
      const outcome = await harness.runtime.start(harness.startCommand(run));
      expect(outcome.state.status).toBe("terminal-failure");
      expect(outcome.state.lastErrorRef?.reference.entityId).toBe(
        "identification-graph-workflow-error:I1:STALE_VERSION",
      );
      expect(await harness.rows(run, "work-plan")).toHaveLength(0);
      expect(await harness.rows(run, "input-snapshot")).toHaveLength(0);
      expect(await harness.rows(run, "workflow-error")).toHaveLength(1);
      // I0 的准备事实仍成立：终止失败不回滚已提交的阶段事实。
      expect(await harness.rows(run, "run-state")).not.toHaveLength(0);
    } finally {
      world.basis = "succeeded";
    }
  });

  it("I0～I2 工作计划不完整时按 WORK_PLAN_INVALID 阻断且不写部分计划", async () => {
    const { world } = harness;
    const run = harness.scope("work-plan-invalid");
    world.applicableNodes = [NODE_CURRENT];
    // 机理发布只覆盖不存在于工序模型的节点：适用工序为空，计划必须整体阻断。
    world.mechanismNodes = ["node-absent"];
    try {
      const outcome = await harness.runtime.start(harness.startCommand(run));
      expect(outcome.state.status).toBe("terminal-failure");
      expect(outcome.state.lastErrorRef?.reference.entityId).toBe(
        "identification-graph-workflow-error:I2:WORK_PLAN_INVALID",
      );
      expect(await harness.rows(run, "work-plan")).toHaveLength(0);
      // D-15：计划未形成，不得留下 I2 阶段结果；I0/I1 既有阶段事实按追加语义保持成立。
      expect(await stageRowsOf(harness, run, "I2")).toHaveLength(0);
      expect(await stageRowsOf(harness, run, "I0")).toHaveLength(1);
      expect(await stageRowsOf(harness, run, "I1")).toHaveLength(1);
      // 既有准备与知识事实保留：I1 的输入快照仍然成立。
      expect(await harness.rows(run, "input-snapshot")).toHaveLength(1);
    } finally {
      world.applicableNodes = [NODE_CURRENT, NODE_NEIGHBOR];
      world.mechanismNodes = [NODE_CURRENT, NODE_NEIGHBOR];
    }
  });

  it("启动命令相同载荷幂等重放返回原运行引用，异载荷返回不可重试冲突", async () => {
    const { world } = harness;
    const run = harness.scope("start-idempotency");
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP)];

    const command = harness.startCommand(run);
    const first = await harness.runtime.start(command);
    expect(first.disposition).toBe("created");
    const rowsAfterFirst = await harness.rows(run);

    const replayed = await harness.runtime.start(command);
    expect(replayed.disposition).toBe("existing");
    expect(replayed.runVersionId).toBe(first.runVersionId);
    expect(replayed.state.runRef).toEqual(first.state.runRef);
    // 不重复创建输入、计划、任务、阶段事实或检查点线程。
    expect(await harness.rows(run)).toEqual(rowsAfterFirst);
    expect(world.calls.prepareReview).toHaveLength(2);

    // 同键异载荷：准备快照被替换 → 不可重试冲突，首次业务事实与运行版本不变。
    await expect(
      harness.runtime.start(
        harness.startCommand(run, {
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          preparationSnapshotRef: {
            ...PREPARATION_SNAPSHOT_REF,
            reference: versionRef(PREPARATION_SNAPSHOT_REF.reference.entityId, "drifted"),
          },
        }),
      ),
    ).rejects.toMatchObject({ error: { code: "IDEMPOTENCY_CONFLICT", retryable: false } });
    expect(await harness.rows(run)).toEqual(rowsAfterFirst);
  });

  it("撤权后下一次效果前拒绝推进且不写入无权正文", async () => {
    const { world, access } = harness;
    const run = harness.scope("authorization-revoked");
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP)];
    access.revoke();
    try {
      await expect(harness.runtime.start(harness.startCommand(run))).rejects.toMatchObject({
        error: { code: "AUTHORIZATION_DENIED", retryable: false },
      });
      expect(await harness.rows(run)).toHaveLength(0);
      expect(world.calls.verifyCurrent.at(-1)?.branch).toBe("workflow.start-run");
    } finally {
      access.restore();
    }
  });

  it("I3 单项检索审阅终止失败时保留已成立证据且失败项不进 I4", async () => {
    const { world } = harness;
    const run = harness.scope("single-item-terminal-failure");
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP)];
    world.agentTaskStatus.set(NODE_NEIGHBOR, "terminal-failure");
    try {
      const outcome = await harness.runtime.start(harness.startCommand(run));
      expect(outcome.state.status).toBe("completed");
      // 失败项只封闭自身：另一项仍走完 I4/I5 并进入 I6。
      expect(world.calls.analyze.map((call) => call.kind)).toEqual([
        "assemble-and-infer",
        "repair-and-validate",
      ]);
      expect(outcome.state.failedWorkItemRefs).toEqual([workItemNeighbor]);
      expect(outcome.state.acceptedRiskRecordRefs).toEqual([riskRecordRefFor(AUTO_GROUP)]);
      const cursor = await harness.latestRunState(run);
      expect(cursor.state.failedWorkItemRefs).toEqual([workItemNeighbor]);
      expect(cursor.state.completedWorkItemRefs).toEqual([workItemCurrent]);

      const i3StageResult = await stageResultOf(harness, run, "I3");
      const { runResult } = await runResultOf(harness, run);
      // 失败项不被报告为已识别/已复核；已成立证据保留。
      expect(runResult.failedWorkItemRefs).toEqual([workItemNeighbor]);
      expect(i3StageResult.stage).toBe("I3");
    } finally {
      world.agentTaskStatus.delete(NODE_NEIGHBOR);
    }
  });

  it("I3 Agent 尚未完成时登记等待并暂停，恢复沿用原任务与线程", async () => {
    const { world } = harness;
    const run = harness.scope("agent-task-waiting");
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP)];
    world.agentTaskStatus.set(NODE_CURRENT, "running");
    try {
      const outcome = await harness.runtime.start(harness.startCommand(run));
      expect(outcome.state.status).toBe("waiting");
      expect(outcome.state.stage).toBe("I3");
      // 等待引用为 `agent-task` 变体并携带该精确任务引用，与恢复原因成对。
      expect(outcome.state.waitingRef?.kind).toBe("agent-task");
      const taskRef = outcome.state.agentTaskRefs[0];
      expect(taskRef?.reference).toEqual(reviewTaskRefFor(workItemCurrent).reference);
      expect(
        outcome.state.waitingRef?.kind === "agent-task"
          ? outcome.state.waitingRef.agentTaskRef.reference
          : undefined,
      ).toEqual(taskRef?.reference);
      const cursor = await harness.latestRunState(run);
      expect(cursor.state.lastWaitingRef).toMatchObject({
        kind: "retrieval-review-agent",
        workItemRef: { reference: workItemCurrent.reference },
      });
      // 尚未完成：不得进入 I4、不得新建替代任务。
      expect(world.calls.analyze).toHaveLength(0);
      expect(world.calls.startTask).toHaveLength(1);
      const firstTaskCommandId = world.calls.startTask[0]?.commandId;

      world.agentTaskStatus.set(NODE_CURRENT, "completed");
      const resumed = await harness.runtime.resume(
        harness.resumeCommand(run, {
          expectedRunVersionId: cursor.runVersionId,
          resumeCause: { kind: "agent-task-completed", agentTaskRef: taskRef! },
        }),
      );
      expect(resumed.disposition).toBe("resumed");
      expect(resumed.state.status).toBe("completed");
      // 恢复沿用原动作身份与线程：同一启动任务的命令身份被原样重放，不新建替代任务。
      expect(
        world.calls.startTask.filter((call) => call.commandId === firstTaskCommandId),
      ).toHaveLength(2);
      expect(world.calls.startTask[1]?.commandId).toBe(firstTaskCommandId);
      expect(world.calls.startTask[1]?.payload.modelDeploymentRef).toEqual(
        reviewTaskRefFor(workItemCurrent).modelDeploymentRef,
      );
    } finally {
      world.agentTaskStatus.delete(NODE_CURRENT);
    }
  });

  it("I4/I5 只按冻结策略集引用与确定性动作身份调用下游", async () => {
    const { world } = harness;
    const run = harness.scope("frozen-policy-refs");
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP)];
    world.applicableNodes = [NODE_CURRENT];
    world.mechanismNodes = [NODE_CURRENT];
    try {
      const outcome = await harness.runtime.start(harness.startCommand(run));
      expect(outcome.state.status).toBe("completed");

      const infer = world.calls.analyze[0];
      const validate = world.calls.analyze[1];
      expect(infer?.kind).toBe("assemble-and-infer");
      expect(validate?.kind).toBe("repair-and-validate");
      if (infer?.kind !== "assemble-and-infer" || validate?.kind !== "repair-and-validate") {
        throw new TypeError("analysis kinds must be assemble-and-infer then repair-and-validate");
      }
      // 模型/提示引用只来自冻结策略集，修复/校验/仿真策略同样来自冻结策略集。
      expect(infer.payload.modelDeploymentRef).toEqual(versionRef("model-deployment"));
      expect(infer.payload.promptTemplateRef).toEqual(versionRef("prompt-template"));
      expect(validate.payload.repairPolicyRef).toEqual(versionRef("repair-policy"));
      expect(validate.payload.ruleValidationPolicyRef).toEqual(
        versionRef("rule-validation-policy"),
      );
      expect(validate.payload.simulationConstraintPolicyRef).toBeUndefined();
      // 动作身份由命令与工作项确定性派生（同轮重放同身份）。
      expect(infer.commandId).toBe(infer.idempotencyKey);
      expect(infer.commandId).toContain(`I4:${workItemCurrent.reference.entityId}`);
      expect(validate.commandId).toContain(`I5:${workItemCurrent.reference.entityId}`);
      // 原始候选集与已校验候选项引用都在阶段结果里保留。
      const i4StageResult = (await harness.rows(run, "stage-result")).map((row) => row).at(-1);
      expect(i4StageResult?.resultKind).toBe("stage-result");
    } finally {
      world.applicableNodes = [NODE_CURRENT, NODE_NEIGHBOR];
      world.mechanismNodes = [NODE_CURRENT, NODE_NEIGHBOR];
    }
  });

  it("零结果工作项在 I4 逐项收口：不进入 I5/I6 且汇总逐项列明引用", async () => {
    const { world } = harness;
    const run = harness.scope("zero-result-all");
    world.zeroResultNodes.add(NODE_CURRENT);
    world.zeroResultNodes.add(NODE_NEIGHBOR);
    try {
      const outcome = await harness.runtime.start(harness.startCommand(run));

      expect(outcome.state.status).toBe("completed");
      const { runResult } = await runResultOf(harness, run);
      expect(runResult.zeroResults).toEqual([
        { workItemRef: workItemCurrent, zeroResultRef: zeroResultRefFor(NODE_CURRENT) },
        { workItemRef: workItemNeighbor, zeroResultRef: zeroResultRefFor(NODE_NEIGHBOR) },
      ]);
      // 零结果不是失败、跳过或已验收，也不产生记录、事件、候选集或验收路线。
      expect(runResult.failedWorkItemRefs).toEqual([]);
      expect(runResult.skippedWorkItemRefs).toEqual([]);
      expect(runResult.acceptedRiskRecordRefs).toEqual([]);
      expect(runResult.acceptedEventRefs).toEqual([]);
      expect(runResult.rejectedGroupRefs).toEqual([]);
      expect(
        world.calls.analyze.filter((call) => call.kind === "repair-and-validate"),
      ).toHaveLength(0);
      expect(
        world.calls.finalize.filter((call) => call.kind === "merge-run-candidates"),
      ).toHaveLength(0);
      const cursor = await harness.latestRunState(run);
      expect(cursor.state.validatedCandidateSetRefs).toEqual([]);
      expect(cursor.state.zeroResults).toHaveLength(2);
      // I4 阶段事实只保存零结果精确引用，不伪造候选集引用。
      const i4StageResults = await stageRowsOf(harness, run, "I4");
      expect(i4StageResults).toHaveLength(2);
      for (const { result } of i4StageResults) {
        expect(result.stage === "I4" ? result.candidateSetRef : undefined).toBeUndefined();
        expect(result.stage === "I4" ? result.zeroResultRef : undefined).toBeDefined();
        expect(result.stage === "I4" ? result.workItemRef : undefined).toBeDefined();
      }
      expect(world.calls.readZeroResult).toHaveLength(2);
      // 汇总逐项引用与 C22 窄读证据逐项配对（C36 覆盖证明消费的就是同一组引用）。
      expect(
        world.calls.readZeroResult.map((call) => ({
          workItemEntityId: call.workItemRef.reference.entityId,
          zeroResultEntityId: call.zeroResultRef.reference.entityId,
        })),
      ).toEqual([
        {
          workItemEntityId: workItemCurrent.reference.entityId,
          zeroResultEntityId: zeroResultRefFor(NODE_CURRENT).reference.entityId,
        },
        {
          workItemEntityId: workItemNeighbor.reference.entityId,
          zeroResultEntityId: zeroResultRefFor(NODE_NEIGHBOR).reference.entityId,
        },
      ]);
    } finally {
      world.zeroResultNodes.clear();
    }
  }, 120_000);

  it("零结果与候选工作项并存：只合并已校验候选集并清除上一项候选引用", async () => {
    const { world } = harness;
    const run = harness.scope("zero-result-mixed");
    world.zeroResultNodes.add(NODE_NEIGHBOR);
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP)];
    try {
      const outcome = await harness.runtime.start(harness.startCommand(run));

      expect(outcome.state.status).toBe("completed");
      const { runResult } = await runResultOf(harness, run);
      expect(runResult.zeroResults).toEqual([
        { workItemRef: workItemNeighbor, zeroResultRef: zeroResultRefFor(NODE_NEIGHBOR) },
      ]);
      expect(runResult.acceptedRiskRecordRefs).toEqual([riskRecordRefFor(AUTO_GROUP)]);
      expect(runResult.failedWorkItemRefs).toEqual([]);
      expect(runResult.skippedWorkItemRefs).toEqual([]);
      // I5 与 I6 只看候选工作项：零结果项不参与校验或合并。
      expect(
        world.calls.analyze.filter((call) => call.kind === "repair-and-validate"),
      ).toHaveLength(1);
      expect(
        world.calls.finalize.filter((call) => call.kind === "merge-run-candidates"),
      ).toHaveLength(1);
      // 零结果工作项结束后不保留上一项的候选集引用。
      expect(outcome.state.candidateSetRef).toBeUndefined();
    } finally {
      world.zeroResultNodes.clear();
    }
  }, 120_000);

  it("零结果无法由 C22 窄读证明时终止封闭且不登记该工作项的 I4 事实", async () => {
    const { world } = harness;
    const run = harness.scope("zero-result-unproven");
    world.zeroResultNodes.add(NODE_CURRENT);
    world.zeroResultRead.set(NODE_CURRENT, "inconsistent");
    try {
      const outcome = await harness.runtime.start(harness.startCommand(run));

      expect(outcome.state.status).toBe("terminal-failure");
      expect(await harness.rows(run, "workflow-error")).toHaveLength(1);
      expect(await stageRowsOf(harness, run, "I4")).toHaveLength(0);
      expect(await harness.rows(run, "run-result")).toHaveLength(0);
      expect(
        world.calls.analyze.filter((call) => call.kind === "repair-and-validate"),
      ).toHaveLength(0);
    } finally {
      world.zeroResultRead.delete(NODE_CURRENT);
      world.zeroResultNodes.clear();
    }
  }, 120_000);

  it("恢复时零结果无法再由 C22 窄读证明按 CHECKPOINT_INCONSISTENT 零补写封闭", async () => {
    const { world } = harness;
    const run = harness.scope("zero-result-recovery");
    world.zeroResultNodes.add(NODE_CURRENT);
    world.agentTaskStatus.set(NODE_NEIGHBOR, "running");
    try {
      const started = await harness.runtime.start(harness.startCommand(run));
      expect(started.state.status).toBe("waiting");
      const cursor = await harness.latestRunState(run);
      expect(cursor.state.zeroResults).toHaveLength(1);
      const rowsBefore = await harness.rows(run);
      const taskRef = started.state.agentTaskRefs[0];
      if (taskRef === undefined) throw new TypeError("waiting run must carry its agent task");

      world.zeroResultRead.set(NODE_CURRENT, "unavailable");
      await expect(
        harness.runtime.resume(
          harness.resumeCommand(run, {
            expectedRunVersionId: cursor.runVersionId,
            resumeCause: { kind: "agent-task-completed", agentTaskRef: taskRef },
          }),
        ),
      ).rejects.toMatchObject({
        error: { code: "CHECKPOINT_INCONSISTENT", retryable: false },
      });
      // 零补写：不从游标或检查点补写零结果事实，也不新增登记。
      expect(await harness.rows(run)).toEqual(rowsBefore);
    } finally {
      world.zeroResultRead.delete(NODE_CURRENT);
      world.zeroResultNodes.clear();
      world.agentTaskStatus.delete(NODE_NEIGHBOR);
    }
  }, 120_000);

  it("I5 不可修正候选失败记为工作项失败且不创建人工复核路线", async () => {
    const { world } = harness;
    const run = harness.scope("unrepairable-candidate");
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP)];
    world.validationOverride.set(NODE_CURRENT, "failed");
    try {
      const outcome = await harness.runtime.start(harness.startCommand(run));
      expect(outcome.state.status).toBe("completed");
      expect(outcome.state.failedWorkItemRefs).toEqual([workItemCurrent]);
      // 技术/确定性失败不得转换为人工通过路线：没有复核任务、没有等待。
      expect(outcome.state.reviewTaskRefs).toEqual([]);
      expect(outcome.state.waitingRef).toBeUndefined();
      expect(await harness.rows(run, "waiting")).toHaveLength(0);
      const i5StageResult = (
        await Promise.all((await harness.rows(run, "stage-result")).map(async (row) => row))
      ).at(-1);
      expect(i5StageResult).toBeDefined();
      const { runResult } = await runResultOf(harness, run);
      expect(runResult.failedWorkItemRefs).toEqual([workItemCurrent]);
    } finally {
      world.validationOverride.delete(NODE_CURRENT);
    }
  });

  it("I6～I8 自动组与人工组并存：自动组入库、待定组本轮零记录且运行保持 waiting", async () => {
    const { world } = harness;
    const run = harness.scope("auto-and-review-groups");
    world.routes = [
      automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP),
      reviewRouteFor(WORK_PLAN_ENTITY_ID, REVIEW_GROUP, run.runRef),
    ];

    const outcome = await harness.runtime.start(harness.startCommand(run));

    // 待复核组不阻止自动组入库，也不生成 completed。
    expect(outcome.state.status).toBe("waiting");
    expect(outcome.state.resultRef).toBeUndefined();
    expect(outcome.state.acceptedRiskRecordRefs).toEqual([riskRecordRefFor(AUTO_GROUP)]);
    const cursor = await harness.latestRunState(run);
    expect(cursor.state.stage).toBe("I8");
    expect(cursor.state.status).toBe("waiting");
    expect(cursor.state.acceptedRiskRecordRefs).toEqual([riskRecordRefFor(AUTO_GROUP)]);
    expect(cursor.state.pendingGroupRefs.map((ref) => ref.reference.entityId)).toEqual([
      reviewRouteFor(WORK_PLAN_ENTITY_ID, REVIEW_GROUP, run.runRef).groupRef.reference.entityId,
    ]);
    expect(cursor.state.rejectedGroupRefs).toEqual([]);
    expect(cursor.state.lastWaitingRef?.kind).toBe("human-review");
    expect(await harness.rows(run, "run-result")).toHaveLength(0);

    // 整集提交集必须恰等于全部 routes，且只提交已成立的决定。
    const submission = world.calls.finalize.at(-1);
    expect(submission?.kind).toBe("accept-groups");
    if (submission?.kind !== "accept-groups")
      throw new TypeError("last finalize must be accept-groups");
    expect(submission.payload.acceptedGroupRefs.map((ref) => ref.reference.entityId)).toEqual(
      world.routes.map((route) => route.groupRef.reference.entityId),
    );
    expect(submission.payload.decisionRefs).toEqual([
      automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP).routeDecisionRef,
    ]);

    const i8StageResult = await stageResultOf(harness, run, "I8");
    expect(i8StageResult.stage).toBe("I8");
    if (i8StageResult.stage !== "I8") throw new TypeError("last stage result must be I8");
    expect(i8StageResult.standardizedRiskRecordRefs).toEqual([riskRecordRefFor(AUTO_GROUP)]);
    expect(i8StageResult.eventRefs).toEqual([acceptedEventRefFor(AUTO_GROUP)]);
  }, 120_000);

  it("I6～I8 待定组后续有决定后恰入库一次，重复恢复事件同回执无副作用", async () => {
    const { world } = harness;
    const run = harness.scope("pending-then-decided");
    const reviewRoute = reviewRouteFor(WORK_PLAN_ENTITY_ID, REVIEW_GROUP, run.runRef);
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP), reviewRoute];

    const started = await harness.runtime.start(harness.startCommand(run));
    expect(started.state.status).toBe("waiting");
    const waitingCursor = await harness.latestRunState(run);

    // 类型不匹配的恢复原因只影响匹配组之外的情形：拒绝推进且不写新事实。
    const invalidResume = harness.resumeCommand(run, {
      expectedRunVersionId: waitingCursor.runVersionId,
      resumeCause: {
        kind: "agent-task-completed",
        agentTaskRef: reviewTaskRefFor(workItemCurrent),
      },
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(harness.runtime.resume(invalidResume)).rejects.toMatchObject({
        error: { detailCode: "waiting-reference-kind-mismatch" },
      });
    }

    world.reviewDecisions.set(reviewRoute.groupRef.reference.entityId, {
      kind: "approve-unchanged",
      ref: reviewDecisionRefFor(REVIEW_GROUP),
    });
    const resumeCommand = harness.resumeCommand(run, {
      expectedRunVersionId: waitingCursor.runVersionId,
      resumeCause: {
        kind: "review-resolved",
        reviewDecisionRef: reviewDecisionRefFor(REVIEW_GROUP),
      },
    });
    const resumed = await harness.runtime.resume(resumeCommand);
    expect(resumed.disposition).toBe("resumed");
    expect(resumed.state.status).toBe("completed");
    // 新决组恰入库一次，本轮已入库组按同一幂等身份重放为 no-op，不重复产生记录或事件。
    expect(resumed.state.acceptedRiskRecordRefs.map((ref) => ref.reference.entityId)).toEqual([
      riskRecordRefFor(AUTO_GROUP).reference.entityId,
      riskRecordRefFor(REVIEW_GROUP).reference.entityId,
    ]);
    const rowsAfterResume = await harness.rows(run);
    const { runResult } = await runResultOf(harness, run);
    expect(runResult.acceptedRiskRecordRefs.map((ref) => ref.reference.entityId)).toEqual([
      riskRecordRefFor(AUTO_GROUP).reference.entityId,
      riskRecordRefFor(REVIEW_GROUP).reference.entityId,
    ]);
    expect(runResult.rejectedGroupRefs).toEqual([]);
    expect(runResult.pendingReviewTaskRefs).toEqual([]);

    // 重复事件：同一恢复命令身份重放返回原回执且不产生新的业务事实。
    const replayed = await harness.runtime.resume(resumeCommand);
    expect(replayed.disposition).toBe("resumed");
    expect(replayed.runVersionId).toBe(resumed.runVersionId);
    expect(await harness.rows(run)).toEqual(rowsAfterResume);
  }, 120_000);

  it("I6～I8 混合合格组与拒绝组：合格组入库、被拒组零记录零事件", async () => {
    const { world } = harness;
    const run = harness.scope("mixed-accept-and-reject");
    const rejectedRoute = reviewRouteFor(WORK_PLAN_ENTITY_ID, SECOND_REVIEW_GROUP, run.runRef);
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP), rejectedRoute];
    world.reviewDecisions.set(rejectedRoute.groupRef.reference.entityId, {
      kind: "reject",
      ref: reviewDecisionRefFor(SECOND_REVIEW_GROUP),
    });

    const outcome = await harness.runtime.start(harness.startCommand(run));

    expect(outcome.state.status).toBe("completed");
    expect(outcome.state.acceptedRiskRecordRefs).toEqual([riskRecordRefFor(AUTO_GROUP)]);
    const i8StageResult = await stageResultOf(harness, run, "I8");
    expect(i8StageResult.stage).toBe("I8");
    const { runResult } = await runResultOf(harness, run);
    expect(runResult.acceptedRiskRecordRefs).toEqual([riskRecordRefFor(AUTO_GROUP)]);
    // 被拒组不产生任何记录或事件，只登记为拒绝。
    expect(runResult.rejectedGroupRefs.map((ref) => ref.reference.entityId)).toEqual([
      rejectedRoute.groupRef.reference.entityId,
    ]);
    expect(runResult.acceptedEventRefs).toEqual([]);
    const i8Rows = (await harness.rows(run, "stage-result")).filter((row) =>
      row.auditEntryId.includes("I8"),
    );
    expect(i8Rows.length).toBeGreaterThan(0);
  });

  it("I6～I8 全部组被封闭时按 skipped 幂等空结果收口", async () => {
    const { world } = harness;
    const run = harness.scope("all-groups-closed");
    const firstRoute = reviewRouteFor(WORK_PLAN_ENTITY_ID, REVIEW_GROUP, run.runRef);
    const secondRoute = reviewRouteFor(WORK_PLAN_ENTITY_ID, SECOND_REVIEW_GROUP, run.runRef);
    world.routes = [firstRoute, secondRoute];
    world.reviewDecisions.set(firstRoute.groupRef.reference.entityId, {
      kind: "return-upstream",
      ref: reviewDecisionRefFor(REVIEW_GROUP),
    });
    world.reviewDecisions.set(secondRoute.groupRef.reference.entityId, {
      kind: "reject",
      ref: reviewDecisionRefFor(SECOND_REVIEW_GROUP),
    });

    const outcome = await harness.runtime.start(harness.startCommand(run));

    expect(outcome.state.status).toBe("completed");
    expect(outcome.state.acceptedRiskRecordRefs).toEqual([]);
    const { runResult } = await runResultOf(harness, run);
    expect(runResult.acceptedRiskRecordRefs).toEqual([]);
    expect(runResult.acceptedEventRefs).toEqual([]);
    expect(runResult.rejectedGroupRefs.map((ref) => ref.reference.entityId)).toEqual([
      firstRoute.groupRef.reference.entityId,
      secondRoute.groupRef.reference.entityId,
    ]);
    // 验收动作身份由本轮决定集确定性派生（同决定集必得同一身份）。
    const submission = world.calls.finalize.at(-1);
    expect(submission?.kind).toBe("accept-groups");
    if (submission?.kind !== "accept-groups")
      throw new TypeError("last finalize must be accept-groups");
    expect(submission.commandId).toContain(
      acceptanceSuffixFor([
        reviewDecisionRefFor(REVIEW_GROUP),
        reviewDecisionRefFor(SECOND_REVIEW_GROUP),
      ]),
    );
  });

  it("I9 部分成功形成可解释汇总，计数与精确引用一致", async () => {
    const { world } = harness;
    const run = harness.scope("partial-success-summary");
    const rejectedRoute = reviewRouteFor(WORK_PLAN_ENTITY_ID, SECOND_REVIEW_GROUP, run.runRef);
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP), rejectedRoute];
    world.reviewDecisions.set(rejectedRoute.groupRef.reference.entityId, {
      kind: "reject",
      ref: reviewDecisionRefFor(SECOND_REVIEW_GROUP),
    });
    world.agentTaskStatus.set(NODE_NEIGHBOR, "terminal-failure");
    try {
      const outcome = await harness.runtime.start(harness.startCommand(run));
      expect(outcome.state.status).toBe("completed");
      const { runResult } = await runResultOf(harness, run);
      // 已验收、拒绝、失败三类精确引用与计数一致。
      expect(runResult.acceptedRiskRecordRefs).toEqual([riskRecordRefFor(AUTO_GROUP)]);
      expect(runResult.rejectedGroupRefs.map((ref) => ref.reference.entityId)).toEqual([
        rejectedRoute.groupRef.reference.entityId,
      ]);
      expect(runResult.failedWorkItemRefs).toEqual([workItemNeighbor]);
      expect(runResult.skippedWorkItemRefs).toEqual([]);
      expect(runResult.pendingReviewTaskRefs).toEqual([]);
      expect(outcome.state.failedWorkItemRefs).toEqual([workItemNeighbor]);
      expect(outcome.state.rejectedGroupRefs.map((ref) => ref.reference.entityId)).toEqual([
        rejectedRoute.groupRef.reference.entityId,
      ]);
    } finally {
      world.agentTaskStatus.delete(NODE_NEIGHBOR);
    }
  });

  it("可重试技术错误按冻结策略在预算内重试，预算耗尽后封闭失败", async () => {
    const { world } = harness;
    const run = harness.scope("retryable-budget");
    world.basis = "transient";
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP)];
    try {
      const first = await harness.runtime.start(harness.startCommand(run));
      expect(first.state.status).toBe("retryable-failure");
      expect(first.state.lastErrorRef?.reference.entityId).toBe(
        "identification-graph-workflow-error:I1:TRANSIENT_FAILURE",
      );

      // 预算内重试：沿用同一阶段动作身份，失败次数单调增加。
      const firstCursor = await harness.latestRunState(run);
      const retried = await harness.runtime.resume(
        harness.resumeCommand(run, {
          expectedRunVersionId: firstCursor.runVersionId,
          resumeCause: { kind: "transient-recovered" },
        }),
      );
      expect(retried.state.status).toBe("retryable-failure");
      expect(await harness.rows(run, "workflow-error")).toHaveLength(2);

      // 预算耗尽（冻结策略 maxAttempts = 2）：封闭失败，不再可重试。
      const secondCursor = await harness.latestRunState(run);
      const exhausted = await harness.runtime.resume(
        harness.resumeCommand(run, {
          expectedRunVersionId: secondCursor.runVersionId,
          resumeCause: { kind: "transient-recovered" },
        }),
      );
      expect(exhausted.state.status).toBe("terminal-failure");
      const errorRows = await harness.rows(run, "workflow-error");
      expect(errorRows).toHaveLength(3);
      // 未确认完成的副作用不得重放：I1 未成功就不存在输入快照或工作计划。
      expect(await harness.rows(run, "input-snapshot")).toHaveLength(0);
      expect(await harness.rows(run, "work-plan")).toHaveLength(0);
    } finally {
      world.basis = "succeeded";
    }
  });

  it("恢复引用缺失或版本不一致时失败闭合且不补写业务事实", async () => {
    const { world } = harness;
    const run = harness.scope("resume-closed-failures");
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP)];

    const started = await harness.runtime.start(harness.startCommand(run));
    expect(started.state.status).toBe("completed");
    const rowsBefore = await harness.rows(run);

    // 未登记的子运行：按不存在收口。
    await expect(
      harness.runtime.resume({
        ...harness.resumeCommand(run, { resumeCause: { kind: "transient-recovered" } }),
        runRef: {
          kind: "workflow-run",
          reference: versionRef(`identification-run:${PROJECT_ID}:unregistered`, "v1"),
        },
      }),
    ).rejects.toMatchObject({ error: { code: "INPUT_NOT_READY", retryable: false } });

    // 已完成的运行收到迟到信号：返回原回执且不重复推进。
    const late = await harness.runtime.resume(
      harness.resumeCommand(run, { resumeCause: { kind: "transient-recovered" } }),
    );
    expect(late.disposition).toBe("existing");
    expect(await harness.rows(run)).toEqual(rowsBefore);
  });

  it("终止错误封闭失败且不循环重试", async () => {
    const { world } = harness;
    const run = harness.scope("terminal-failure-no-loop");
    world.basis = "failed";
    try {
      const terminal = await harness.runtime.start(harness.startCommand(run));
      expect(terminal.state.status).toBe("terminal-failure");
      const errorRows = await harness.rows(run, "workflow-error");
      expect(errorRows).toHaveLength(1);

      // 终止失败不接受"瞬态恢复"：迟到信号返回原回执，不重放阶段动作。
      const late = await harness.runtime.resume(
        harness.resumeCommand(run, { resumeCause: { kind: "transient-recovered" } }),
      );
      expect(late.disposition).toBe("existing");
      expect(late.state.status).toBe("terminal-failure");
      expect(await harness.rows(run, "workflow-error")).toHaveLength(1);
    } finally {
      world.basis = "succeeded";
    }
  });

  it("协作式取消只阻止未开始动作并保留已成立事实", async () => {
    const { world } = harness;
    const run = harness.scope("cooperative-cancel");
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP)];
    world.agentTaskStatus.set(NODE_CURRENT, "running");
    try {
      const startCommand = harness.startCommand(run);
      const started = await harness.runtime.start(startCommand);
      expect(started.state.status).toBe("waiting");
      const waitingCursor = await harness.latestRunState(run);
      const rowsBeforeCancel = await harness.rows(run);
      const startTaskCallsBeforeCancel = world.calls.startTask.length;

      const cancelCommand = harness.cancelCommand(run, {
        expectedRunVersionId: waitingCursor.runVersionId,
      });
      const cancelled = await harness.runtime.cancel(cancelCommand);
      expect(cancelled.disposition).toBe("cancellation-recorded");
      expect(cancelled.state.status).toBe("cancelled");
      expect(cancelled.state.resultRef?.kind).toBe("identification-run-result");
      const cancellationRows = await harness.rows(run, "cancellation");
      expect(cancellationRows).toHaveLength(1);
      // 已成立事实不回滚：取消前的登记行仍是最终登记集合的子集。
      const rowsAfterCancel = await harness.rows(run);
      for (const row of rowsBeforeCancel) {
        expect(rowsAfterCancel).toContainEqual(row);
      }
      // 未开始的动作不再执行。
      const lateResume = await harness.runtime.resume(
        harness.resumeCommand(run, {
          resumeCause: {
            kind: "agent-task-completed",
            agentTaskRef: reviewTaskRefFor(workItemCurrent),
          },
        }),
      );
      expect(lateResume.disposition).toBe("existing");
      expect(world.calls.startTask).toHaveLength(startTaskCallsBeforeCancel);
      expect(world.calls.analyze).toHaveLength(0);

      // 同一取消命令重放：返回已取消回执且不重复登记。
      const replayed = await harness.runtime.cancel(cancelCommand);
      expect(replayed.disposition).toBe("already-cancelled");
      expect(await harness.rows(run, "cancellation")).toHaveLength(1);
      const replayedStart = await harness.runtime.start(startCommand);
      expect(replayedStart.state.status).toBe("cancelled");
      expect(replayedStart.state.resultRef).toEqual(cancelled.state.resultRef);
      expect(await harness.rows(run)).toEqual(rowsAfterCancel);
    } finally {
      world.agentTaskStatus.delete(NODE_CURRENT);
    }
  });

  it("恢复与取消竞争同一运行版本时至多一个推进到终态", async () => {
    const { world } = harness;
    const run = harness.scope("resume-cancel-race");
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP)];
    world.agentTaskStatus.set(NODE_CURRENT, "running");
    try {
      const started = await harness.runtime.start(harness.startCommand(run));
      expect(started.state.status).toBe("waiting");
      const current = await harness.latestRunState(run);
      const taskRef = started.state.agentTaskRefs[0]!;
      world.agentTaskStatus.set(NODE_CURRENT, "completed");

      const outcomes = await Promise.allSettled([
        harness.runtime.resume(
          harness.resumeCommand(run, {
            expectedRunVersionId: current.runVersionId,
            resumeCause: { kind: "agent-task-completed", agentTaskRef: taskRef },
          }),
        ),
        harness.runtime.cancel(
          harness.cancelCommand(run, { expectedRunVersionId: current.runVersionId }),
        ),
      ]);
      const advanced = outcomes.filter(
        (outcome) =>
          outcome.status === "fulfilled" &&
          (outcome.value.disposition === "resumed" ||
            outcome.value.disposition === "cancellation-recorded"),
      );
      expect(
        advanced,
        JSON.stringify(
          outcomes.map((outcome) =>
            outcome.status === "fulfilled"
              ? { disposition: outcome.value.disposition, status: outcome.value.state.status }
              : { rejected: String(outcome.reason) },
          ),
        ),
      ).toHaveLength(1);
      const latest = await harness.latestRunState(run);
      expect(["completed", "cancelled"]).toContain(latest.state.status);
      if (latest.state.status === "cancelled") {
        expect(await harness.rows(run, "run-result")).toHaveLength(0);
      } else {
        expect(await harness.rows(run, "cancellation")).toHaveLength(0);
      }
    } finally {
      world.agentTaskStatus.delete(NODE_CURRENT);
    }
  }, 120_000);

  it("检查点引用无法由业务回读证明时按 CHECKPOINT_INCONSISTENT 零补写封闭", async () => {
    const { world } = harness;
    const run = harness.scope("checkpoint-inconsistent");
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP)];
    world.agentTaskStatus.set(NODE_CURRENT, "running");
    try {
      const started = await harness.runtime.start(harness.startCommand(run));
      expect(started.state.status).toBe("waiting");
      const cursor = await harness.latestRunState(run);
      const rowsBefore = await harness.rows(run);

      // 让检查点引用的工作计划无法由业务回读证明（删除登记行，模拟引用丢失/被清理）。
      await harness.postgres.adminPool.query(
        "DELETE FROM business.identification_graph_results WHERE project_id = $1 AND run_id = $2 AND result_kind = 'work-plan'",
        [PROJECT_ID, run.runRef.reference.entityId],
      );
      const rowsAfterDelete = await harness.rows(run);
      expect(rowsAfterDelete.filter((row) => row.resultKind === "work-plan")).toHaveLength(0);

      await expect(
        harness.runtime.resume(
          harness.resumeCommand(run, {
            expectedRunVersionId: cursor.runVersionId,
            resumeCause: {
              kind: "agent-task-completed",
              agentTaskRef: reviewTaskRefFor(workItemCurrent),
            },
          }),
        ),
      ).rejects.toMatchObject({
        error: {
          code: "CHECKPOINT_INCONSISTENT",
          retryable: false,
          detailCode: "checkpoint-inconsistent",
        },
      });
      // 零补写：不从检查点正文补写业务表，也不新增阶段/结果登记。
      expect(await harness.rows(run)).toEqual(rowsAfterDelete);
      expect(rowsBefore.filter((row) => row.resultKind === "work-plan")).toHaveLength(1);
    } finally {
      world.agentTaskStatus.delete(NODE_CURRENT);
    }
  });
});

describe("C24 识别子图运行时（检查点写入失败注入）", () => {
  let harness: IdentificationGraphHarnessV1;

  beforeAll(async () => {
    harness = await startIdentificationGraphHarness({ failCheckpointPutAt: 3 });
  }, 300_000);

  afterAll(async () => {
    await harness.close();
  }, 120_000);

  it("业务提交后检查点写入失败：已提交事实保留且恢复按原幂等身份对账", async () => {
    const { world } = harness;
    const run = harness.scope("checkpoint-write-failure");
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP)];

    const command = harness.startCommand(run);
    let failure: unknown;
    try {
      await harness.runtime.start(command);
    } catch (error: unknown) {
      failure = error;
    }
    // 结构化可重试技术错误：业务事实已提交，检查点未写入。
    expect(failure).toMatchObject({
      error: { code: "RETRYABLE_INFRASTRUCTURE_FAILURE", retryable: true },
    });
    const rowsAfterFailure = await harness.rows(run);
    expect(rowsAfterFailure.length).toBeGreaterThan(0);
    expect(rowsAfterFailure.some((row) => row.resultKind === "run-state")).toBe(true);

    // 恢复信号先对账已提交业务；迟到信号不让旧 checkpoint 掩盖实际终态。
    const cursor = await harness.latestRunState(run);
    const recovered = await harness.runtime.resume(
      harness.resumeCommand(run, {
        expectedRunVersionId: cursor.runVersionId,
        resumeCause: { kind: "transient-recovered" },
      }),
    );
    expect(recovered.state.status).toBe("completed");
    expect(await harness.rows(run)).toEqual(expect.arrayContaining(rowsAfterFailure));
    expect(await stageRowsOf(harness, run, "I0")).toHaveLength(1);
    expect((await harness.runtime.start(command)).state.status).toBe("completed");
  });
});

describe("C24 识别子图运行时（中途检查点写入失败）", () => {
  let harness: IdentificationGraphHarnessV1;

  beforeAll(async () => {
    harness = await startIdentificationGraphHarness({ failCheckpointPutAt: 8 });
  }, 300_000);

  afterAll(async () => {
    await harness.close();
  }, 120_000);

  it("I5 业务提交后按首次登记恢复并继续到终态", async () => {
    const { world } = harness;
    const run = harness.scope("checkpoint-write-failure-i5");
    world.routes = [automaticRouteFor(WORK_PLAN_ENTITY_ID, AUTO_GROUP)];
    const command = harness.startCommand(run);
    await expect(harness.runtime.start(command)).rejects.toMatchObject({
      error: { code: "RETRYABLE_INFRASTRUCTURE_FAILURE", retryable: true },
    });
    const i5Before = await stageRowsOf(harness, run, "I5");
    expect(i5Before).toHaveLength(1);
    const committedAnalyze = world.calls.analyze
      .filter((call) => call.kind === "repair-and-validate")
      .at(-1);
    expect(committedAnalyze).toBeDefined();
    const rowsBefore = await harness.rows(run);

    const recovered = await harness.runtime.start(command);
    expect(recovered.state.status).toBe("completed");
    expect(recovered.state.candidateSetRef).toBeDefined();
    expect(await stageRowsOf(harness, run, "I5")).toEqual(expect.arrayContaining(i5Before));
    expect(
      world.calls.analyze.filter((call) => call.commandId === committedAnalyze!.commandId),
    ).toHaveLength(1);
    expect(await harness.rows(run)).toEqual(expect.arrayContaining(rowsBefore));
  });
});

describe("C24 识别子图运行时（等待检查点写入失败）", () => {
  let harness: IdentificationGraphHarnessV1;

  beforeAll(async () => {
    harness = await startIdentificationGraphHarness({ failCheckpointPutAt: 4 });
  }, 300_000);

  afterAll(async () => {
    await harness.close();
  }, 120_000);

  it("按已登记等待引用重建原线程且不新建识别输入", async () => {
    const run = harness.scope("checkpoint-write-failure-waiting");
    harness.world.policyReady = false;
    const command = harness.startCommand(run);
    await expect(harness.runtime.start(command)).rejects.toMatchObject({
      error: { code: "RETRYABLE_INFRASTRUCTURE_FAILURE", retryable: true },
    });
    const waitingBefore = await harness.rows(run, "waiting");
    expect(waitingBefore).toHaveLength(1);
    const recovered = await harness.runtime.start(command);
    expect(recovered.state.status).toBe("waiting");
    expect(recovered.state.waitingRef).toBeDefined();
    expect(await harness.rows(run, "waiting")).toEqual(waitingBefore);
    expect(await harness.rows(run, "input-snapshot")).toHaveLength(0);
  });
});

describe("C24 识别子图运行时（终止失败检查点写入失败）", () => {
  let harness: IdentificationGraphHarnessV1;

  beforeAll(async () => {
    harness = await startIdentificationGraphHarness({ failCheckpointPutAt: 4 });
  }, 300_000);

  afterAll(async () => {
    await harness.close();
  }, 120_000);

  it("按已登记错误恢复终态且不推进后续阶段", async () => {
    const run = harness.scope("checkpoint-write-failure-terminal");
    harness.world.basis = "failed";
    const command = harness.startCommand(run);
    await expect(harness.runtime.start(command)).rejects.toMatchObject({
      error: { code: "RETRYABLE_INFRASTRUCTURE_FAILURE", retryable: true },
    });
    const errorsBefore = await harness.rows(run, "workflow-error");
    expect(errorsBefore).toHaveLength(1);
    const recovered = await harness.runtime.start(command);
    expect(recovered.state.status).toBe("terminal-failure");
    expect(recovered.state.lastErrorRef).toEqual(errorsBefore[0]?.workflowErrorRef);
    expect(await harness.rows(run, "workflow-error")).toEqual(errorsBefore);
    expect(await stageRowsOf(harness, run, "I2")).toHaveLength(0);
  });
});
