/**
 * 合成样本、待甲方复核：本文件全部工程、参与者、命令身份、摘要与正文均为合成夹具，
 * 不代表生产数据，也不得作为生产回退来源。
 *
 * C41 端到端命令链证据（IP-8）：在同一个真实边界内跑通
 * 等待运行 → 人工采纳（C28 决定 → C41 终局 → 恢复）→ 真实现场执行 → 真实 C25 实际评估 →
 * 正式反馈 → 反馈分段启动，并覆盖失败后同键重试补齐、跨空间/陈旧/冒充失败关闭与
 * 「人工决定前不执行预测」。唯一替身是 C30 **写**入口（见 `fixture.ts` 文件头「替身面」）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ModuleErrorV1 } from "@riskflow/contracts/ports";

import {
  c41WaitingRunRefFor,
  startHumanDecisionFeedbackFixture,
  type HumanDecisionFeedbackPostgresFixtureV1,
} from "./fixture.js";

const MEASURE_RELEASE_REF = {
  kind: "measure-library-release" as const,
  reference: { entityId: "release-measure-library", versionId: "1" },
};

let fixture: HumanDecisionFeedbackPostgresFixtureV1 | undefined;

const PG_TIMEOUT_MS = 240_000;
const pgIt = (name: string, body: () => Promise<unknown>): void => {
  void it(name, body, PG_TIMEOUT_MS);
};

const settled = <T extends { readonly kind: string }>(
  result: T,
): Extract<T, { readonly kind: "succeeded" }> => {
  if (result.kind !== "succeeded") {
    throw new Error(`expected succeeded, received: ${JSON.stringify(result).slice(0, 800)}`);
  }
  return result as Extract<T, { readonly kind: "succeeded" }>;
};

const failureOf = (result: { readonly kind: string }): ModuleErrorV1 => {
  if (result.kind !== "failed") {
    throw new Error(`expected failed, received: ${JSON.stringify(result).slice(0, 800)}`);
  }
  return (result as unknown as { readonly error: ModuleErrorV1 }).error;
};

describe("C41 人工决定与反馈命令链", () => {
  beforeAll(async () => {
    fixture = await startHumanDecisionFeedbackFixture();
  }, 900_000);

  afterAll(async () => {
    await fixture?.close();
  });

  pgIt("等待运行到人工决定、现场执行、实际评估与反馈分段形成一条真实链", async () => {
    const state = fixture!;
    const prefix = "c41-chain";
    const prepared = await state.state.prepareRecommendation({ prefix });
    const scope = await state.state.recommendationScope(prepared.recommendationRef);
    const forecastsBefore = await state.state.countRows("response_forecast_outcomes");

    // 1) 人工采纳：等待中的真实运行 → C28 决定 → C41 终局 → 恢复调用一次。
    const decisionCommand = await state.adoptCommand({
      commandId: `${prefix}-decision`,
      decision: "adopted",
      recommendationRef: prepared.recommendationRef,
      preActionMonitoringSnapshotRef: prepared.preActionMonitoringSnapshotRef,
      spatialScopeRef: scope,
    });
    const adopted = settled(await state.record(decisionCommand));
    expect(adopted.result.kind).toBe("adoption");
    if (adopted.result.kind !== "adoption") return;
    const runRef = c41WaitingRunRefFor({
      projectId: decisionCommand.projectId,
      idempotencyKey: decisionCommand.idempotencyKey,
      adoptedRecommendationRef: prepared.recommendationRef,
    });
    expect(adopted.result.forecastRunRef).toEqual(runRef);
    expect(state.workflow.startCalls).toHaveLength(1);
    expect(state.workflow.resumeCalls).toHaveLength(1);
    expect(state.workflow.resumeCalls[0]?.payload).toMatchObject({
      workflowRunRef: runRef,
      resumeCause: {
        kind: "human-decision-committed",
        routeDecisionRef: adopted.result.routeDecisionRef,
      },
    });

    // 2) 人工决定前不执行预测：运行登记只有等待事实、零评估子运行路由，C28 无预测结果。
    const runRows = await state.runRows(runRef.reference.entityId);
    expect(runRows.filter((row) => row.resultKind === "waiting")).toHaveLength(1);
    expect(runRows.some((row) => row.routeKind === "assessment-sub-run")).toBe(false);
    const runStateRow = runRows.find((row) => row.resultKind === "run-state");
    if (runStateRow?.artifactRef === undefined) throw new Error("expected a run-state row");
    expect(
      await state.readRunState({
        runId: runRef.reference.entityId,
        artifactRef: runStateRow.artifactRef,
        spatialScopeRef: scope,
      }),
    ).toMatchObject({ bodyKind: "run-state", runState: { status: "waiting", assessmentRunRefs: [] } });
    expect(await state.state.countRows("response_forecast_outcomes")).toBe(forecastsBefore);

    // 3) 现场执行：仍有效的人工采纳决定形成一项独立执行事实。
    const executed = settled(
      await state.record(
        await state.executionCommand({
          commandId: `${prefix}-execution`,
          actionSource: {
            kind: "adopted-recommendation",
            responseRecommendationRef: prepared.recommendationRef,
          },
          spatialScopeRef: scope,
        }),
      ),
    );
    expect(executed.result.kind).toBe("execution");
    if (executed.result.kind !== "execution") return;
    const executionRef = executed.result.executionRecordRef;
    expect(await state.countC28Executions()).toBe(1);
    expect(await state.state.countRows("response_forecast_outcomes")).toBe(forecastsBefore);

    // 4) 真实 C25 执行后实际评估（冻结准备 + prepare + evaluate）+ 受权工件。
    const post = await state.state.postActionAssessment({
      suffix: prefix,
      riskInputKey: prepared.riskInputKey,
    });
    const artifact = await state.state.publishFeedbackArtifact({ suffix: prefix });

    // 5) 正式反馈：冻结输入 committed，正式反馈引用成立，后续分段只以精确引用启动。
    const feedbackCommand = await state.feedbackCommand({
      commandId: `${prefix}-feedback`,
      executionRecordRef: executionRef,
      postActionMonitoringSnapshotRef: post.monitoringSnapshotRef,
      feedbackArtifactRef: artifact,
      actualAssessmentRecordRef: post.assessmentRecordRef,
      spatialScopeRef: scope,
    });
    const feedback = settled(await state.record(feedbackCommand));
    expect(feedback.result.kind).toBe("feedback");
    if (feedback.result.kind !== "feedback") return;

    const snapshotRows = await state.feedbackSnapshotRows();
    expect(snapshotRows).toHaveLength(1);
    expect(snapshotRows[0]).toMatchObject({
      state: "committed",
      execution_id: executionRef.reference.entityId,
      actual_assessment_record_id: post.assessmentRecordRef.reference.entityId,
      feedback_id: feedback.result.feedbackRef.reference.entityId,
    });
    expect(snapshotRows[0]?.["committed_at"]).not.toBeNull();
    expect(snapshotRows[0]?.["segment_started_at"]).not.toBeNull();
    expect(await state.countC28Feedback()).toBe(1);
    expect(state.workflow.segmentStartCalls).toHaveLength(1);
    expect(state.workflow.segmentStartCalls[0]?.payload).toMatchObject({
      entryMode: "record-response-feedback",
      feedbackRef: feedback.result.feedbackRef,
      executionRecordRef: executionRef,
    });

    // 6) 决定、执行、反馈三个事实各自独立且引用精确；运行仍未被推进为预测。
    const decisions = await state.decisionRows();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      state: "adopted",
      route_decision_id: adopted.result.routeDecisionRef.reference.entityId,
      forecast_run_id: runRef.reference.entityId,
    });
    expect(await state.countC28Decisions()).toBe(1);
    expect(await state.state.countRows("response_forecast_outcomes")).toBe(forecastsBefore);
  });

  pgIt("失败后同键重试补齐且不产生第二条事实", async () => {
    const state = fixture!;
    const prefix = "c41-chain-retry";
    const c28FeedbackBefore = await state.countC28Feedback();
    const c28ExecutionsBefore = await state.countC28Executions();
    const c28DecisionsBefore = await state.countC28Decisions();
    const segmentStartsBefore = state.workflow.segmentStartCalls.length;
    const prepared = await state.state.prepareRecommendation({ prefix });
    const scope = await state.state.recommendationScope(prepared.recommendationRef);
    const adopted = settled(
      await state.record(
        await state.adoptCommand({
          commandId: `${prefix}-decision`,
          decision: "adopted",
          recommendationRef: prepared.recommendationRef,
          preActionMonitoringSnapshotRef: prepared.preActionMonitoringSnapshotRef,
          spatialScopeRef: scope,
        }),
      ),
    );
    expect(adopted.result.kind).toBe("adoption");
    const execution = settled(
      await state.record(
        await state.executionCommand({
          commandId: `${prefix}-execution`,
          actionSource: {
            kind: "adopted-recommendation",
            responseRecommendationRef: prepared.recommendationRef,
          },
          spatialScopeRef: scope,
        }),
      ),
    );
    expect(execution.result.kind).toBe("execution");
    if (execution.result.kind !== "execution") return;
    const post = await state.state.postActionAssessment({
      suffix: prefix,
      riskInputKey: prepared.riskInputKey,
    });
    const artifact = await state.state.publishFeedbackArtifact({ suffix: prefix });
    const commandId = `${prefix}-feedback`;
    const command = await state.feedbackCommand({
      commandId,
      executionRecordRef: execution.result.executionRecordRef,
      postActionMonitoringSnapshotRef: post.monitoringSnapshotRef,
      feedbackArtifactRef: artifact,
      actualAssessmentRecordRef: post.assessmentRecordRef,
      spatialScopeRef: scope,
    });

    // 正式反馈写入中断（审计主键冲突 → C03 事务整体回滚）：命令失败，冻结输入仍为 prepared。
    await state.preinsertAuditConflict(`audit-${commandId}:response-feedback`);
    try {
      expect(failureOf(await state.record(command)).code).toBe("TERMINAL_FAILURE");
    } finally {
      await state.clearAuditConflict(`audit-${commandId}:response-feedback`);
    }
    expect(await state.countC28Feedback()).toBe(c28FeedbackBefore);
    expect(state.workflow.segmentStartCalls).toHaveLength(segmentStartsBefore);
    const interrupted = (await state.feedbackSnapshotRows()).filter(
      (row) => row["idempotency_key"] === commandId,
    );
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]).toMatchObject({ state: "prepared", committed_at: null });

    // 原键同载荷重试：补齐正式反馈、标记冻结输入并启动精确分段，事实仍只有一条。
    const retried = settled(await state.record(command));
    expect(retried.result.kind).toBe("feedback");
    expect(await state.countC28Feedback()).toBe(c28FeedbackBefore + 1);
    const retriedSnapshots = (await state.feedbackSnapshotRows()).filter(
      (row) => row["idempotency_key"] === commandId,
    );
    expect(retriedSnapshots).toHaveLength(1);
    expect(retriedSnapshots[0]).toMatchObject({ state: "committed" });
    expect(retriedSnapshots[0]?.["segment_started_at"]).not.toBeNull();
    expect(state.workflow.segmentStartCalls).toHaveLength(segmentStartsBefore + 1);
    // 采纳与执行事实在重试前后保持一项。
    expect(await state.countC28Decisions()).toBe(c28DecisionsBefore + 1);
    expect(await state.countC28Executions()).toBe(c28ExecutionsBefore + 1);
    expect(
      (await state.decisionRows()).filter(
        (row) => row["recommendation_id"] === prepared.recommendationRef.reference.entityId,
      ),
    ).toHaveLength(1);
  });

  pgIt("跨空间、陈旧版本与冒充操作者在同一链路上失败关闭", async () => {
    const state = fixture!;
    const prefix = "c41-chain-denied";
    const prepared = await state.state.prepareRecommendation({ prefix });
    const scope = await state.state.recommendationScope(prepared.recommendationRef);
    const decisionsBefore = (await state.decisionRows()).length;
    const startsBefore = state.workflow.startCalls.length;
    const resumesBefore = state.workflow.resumeCalls.length;
    const executionsBefore = await state.countC28Executions();
    const c28DecisionsBefore = await state.countC28Decisions();

    // 跨空间：授权空间与建议空间不符，决定写入前失败。
    const restrictedScope = await state.state.spatialScopeFor("restricted");
    expect(
      failureOf(
        await state.record(
          await state.adoptCommand({
            commandId: `${prefix}-cross-scope`,
            decision: "adopted",
            recommendationRef: prepared.recommendationRef,
            preActionMonitoringSnapshotRef: prepared.preActionMonitoringSnapshotRef,
            spatialScopeRef: restrictedScope,
          }),
        ),
      ).code,
    ).toBe("BUSINESS_BLOCKED");

    // 陈旧版本：确认期间目标版本失效（精确版本已不存在）。
    expect(
      failureOf(
        await state.record(
          await state.adoptCommand({
            commandId: `${prefix}-stale-version`,
            decision: "adopted",
            recommendationRef: {
              kind: "response-recommendation",
              reference: {
                entityId: prepared.recommendationRef.reference.entityId,
                versionId: "c41-chain-absent-version",
              },
            },
            preActionMonitoringSnapshotRef: prepared.preActionMonitoringSnapshotRef,
            spatialScopeRef: scope,
          }),
        ),
      ).code,
    ).toBe("BUSINESS_BLOCKED");

    // 冒充操作者：命令自称主体与当前授权主体不符，服务端不可枚举地拒绝。
    const forged = await state.adoptCommand({
      commandId: `${prefix}-forged-actor`,
      decision: "adopted",
      recommendationRef: prepared.recommendationRef,
      preActionMonitoringSnapshotRef: prepared.preActionMonitoringSnapshotRef,
      spatialScopeRef: scope,
    });
    expect(
      failureOf(await state.record({ ...forged, actorId: "actor-c41-forged" })).code,
    ).toBe("AUTHORIZATION_DENIED");

    // 三次失败都不产生决定、运行、执行或预测事实。
    expect(await state.decisionRows()).toHaveLength(decisionsBefore);
    expect(state.workflow.startCalls).toHaveLength(startsBefore);
    expect(state.workflow.resumeCalls).toHaveLength(resumesBefore);
    expect(await state.countC28Decisions()).toBe(c28DecisionsBefore);
    expect(await state.countC28Executions()).toBe(executionsBefore);
    expect(
      await state.runRows(
        c41WaitingRunRefFor({
          projectId: forged.projectId,
          idempotencyKey: forged.idempotencyKey,
          adoptedRecommendationRef: prepared.recommendationRef,
        }).reference.entityId,
      ),
    ).toHaveLength(0);
  });

  pgIt("独立行动执行不伪造建议且不触发预测或反馈", async () => {
    const state = fixture!;
    const prefix = "c41-chain-independent";
    const decisionsBefore = (await state.decisionRows()).length;
    const adoptedDecisionsBefore = await state.countC28Decisions();
    const executionsBefore = await state.countC28Executions();
    const startsBefore = state.workflow.startCalls.length;
    const segmentStartsBefore = state.workflow.segmentStartCalls.length;
    const execution = settled(
      await state.record(
        await state.executionCommand({
          commandId: `${prefix}-execution`,
          actionSource: { kind: "independent-action", measureReleaseRefs: [MEASURE_RELEASE_REF] },
        }),
      ),
    );
    expect(execution.result.kind).toBe("execution");
    if (execution.result.kind !== "execution") return;

    // 独立行动不生成建议、采纳决定、预测运行或反馈：C30 写入口未被触达。
    expect(await state.countC28Executions()).toBe(executionsBefore + 1);
    expect(await state.decisionRows()).toHaveLength(decisionsBefore);
    expect(await state.countC28Decisions()).toBe(adoptedDecisionsBefore);
    expect(state.workflow.startCalls).toHaveLength(startsBefore);
    expect(state.workflow.segmentStartCalls).toHaveLength(segmentStartsBefore);
    const rows = await state.state.recommendation.c26.c25.postgres.postgres.adminPool.query<{
      source_kind: string;
      recommendation_id: string | null;
    }>(
      `SELECT source_kind, recommendation_id FROM business.response_execution_records
         WHERE project_id = $1 AND execution_id = $2`,
      [state.projectId, execution.result.executionRecordRef.reference.entityId],
    );
    expect(rows.rows[0]).toMatchObject({
      source_kind: "independent-action",
      recommendation_id: null,
    });
  });
});
