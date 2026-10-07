/**
 * 合成样本、待甲方复核：本文件全部工程、参与者、命令身份、摘要与正文均为合成夹具，
 * 不代表生产数据，也不得作为生产回退来源。
 *
 * C41 人工决定与反馈命令 PostgreSQL 行为验证（IP-4/IP-5/IP-6）：真实 Testcontainers PostgreSQL +
 * 完整生产迁移链（含 C41 `000051`）+ 真实 C03/C04/C05/C14/C25/C27/C28 链 + 真实 C30 登记端口与绑定证明；
 * 唯一替身是 C30 **写**入口（见 `fixture.ts` 文件头「替身面」）。用例共享一个容器，断言一律按
 * 本用例自己的精确引用/幂等键收口，不依赖全局行数。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decisionRefFor } from "@riskflow/core/human-decision-feedback";
import type {
  ModuleErrorV1,
  ResponseRecommendationRefV1,
  SpatialScopeRefV1,
  WaitingRefV1,
} from "@riskflow/contracts/ports";

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

/** 断言成功并给出 `succeeded` 分支：失败正文必须可见，不接受静默失败。 */
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

const adminRows = async <T extends Record<string, unknown>>(
  statement: string,
  values: readonly unknown[],
): Promise<readonly T[]> => {
  const pool = fixture!.state.recommendation.c26.c25.postgres.postgres.adminPool;
  const result = await pool.query(statement, [...values]);
  return result.rows as readonly T[];
};

/** C41 决定行按精确建议版本收口：用例之间共享容器，不按全局行数断言。 */
const decisionRowOf = async (
  recommendationRef: ResponseRecommendationRefV1,
): Promise<Record<string, unknown> | undefined> => {
  const rows = await fixture!.decisionRows();
  return rows.find(
    (row) =>
      row["recommendation_id"] === recommendationRef.reference.entityId &&
      row["recommendation_version_id"] === recommendationRef.reference.versionId,
  );
};

const snapshotRowsOf = async (
  idempotencyKey: string,
): Promise<readonly Record<string, unknown>[]> =>
  (await fixture!.feedbackSnapshotRows()).filter(
    (row) => row["idempotency_key"] === idempotencyKey,
  );

describe("C41 人工决定与反馈命令 PostgreSQL 链", () => {
  beforeAll(async () => {
    fixture = await startHumanDecisionFeedbackFixture();
  }, 900_000);

  afterAll(async () => {
    await fixture?.close();
  });

  /** 冻结正式建议与精确空间：采纳/拒绝/执行/反馈共用的前置。 */
  const prepareRecommendation = async (prefix: string) => {
    const state = fixture!;
    const prepared = await state.state.prepareRecommendation({ prefix });
    return { prepared, scope: await state.state.recommendationScope(prepared.recommendationRef) };
  };

  /** 正式采纳一条建议：返回真实等待运行引用与终局采纳结果。 */
  const adoptRecommendation = async (prefix: string) => {
    const state = fixture!;
    const { prepared, scope } = await prepareRecommendation(prefix);
    const command = await state.adoptCommand({
      commandId: `${prefix}-decision`,
      decision: "adopted",
      recommendationRef: prepared.recommendationRef,
      preActionMonitoringSnapshotRef: prepared.preActionMonitoringSnapshotRef,
      spatialScopeRef: scope,
    });
    const result = settled(await state.record(command));
    if (result.result.kind !== "adoption") {
      throw new Error(
        `expected adoption, received: ${JSON.stringify(result.result).slice(0, 400)}`,
      );
    }
    return { prepared, scope, command, adoption: result.result };
  };

  /** 已采纳建议的现场执行：返回精确执行引用。 */
  const executeAdopted = async (input: {
    readonly prefix: string;
    readonly recommendationRef: ResponseRecommendationRefV1;
    readonly scope: SpatialScopeRefV1;
  }) => {
    const state = fixture!;
    const result = settled(
      await state.record(
        await state.executionCommand({
          commandId: `${input.prefix}-execution`,
          actionSource: {
            kind: "adopted-recommendation",
            responseRecommendationRef: input.recommendationRef,
          },
          spatialScopeRef: input.scope,
        }),
      ),
    );
    if (result.result.kind !== "execution") {
      throw new Error(
        `expected execution, received: ${JSON.stringify(result.result).slice(0, 400)}`,
      );
    }
    return result.result.executionRecordRef;
  };

  pgIt("采纳命令保存终局采纳并冻结等待中的真实运行", async () => {
    const state = fixture!;
    const resumesBefore = state.workflow.resumeCalls.length;
    const segmentStartsBefore = state.workflow.segmentStartCalls.length;
    const prepared = await state.state.prepareRecommendation({ prefix: "c41-adopt" });
    const scope = await state.state.recommendationScope(prepared.recommendationRef);
    // 真实 C25 精确证明：建议链基线评估与冻结输入逐项一致（C41 采纳路径的第一步只读证明）。
    const baselineProof = await state.verifyAssessmentProof({
      queryId: "c41-adopt-decision:baseline-assessment",
      riskAssessmentRecordRef: await state.baselineAssessmentRecordRef(prepared.recommendationRef),
      spatialScopeRef: scope,
    });
    if (baselineProof.kind !== "succeeded") {
      throw new Error(`C25 基线评估证明失败：${JSON.stringify(baselineProof).slice(0, 1200)}`);
    }
    expect(baselineProof.result).toMatchObject({
      kind: "established",
      riskAssessmentRecordRef: await state.baselineAssessmentRecordRef(prepared.recommendationRef),
      spatialScopeRef: scope,
    });
    const command = await state.adoptCommand({
      commandId: "c41-adopt-decision",
      decision: "adopted",
      recommendationRef: prepared.recommendationRef,
      preActionMonitoringSnapshotRef: prepared.preActionMonitoringSnapshotRef,
      spatialScopeRef: scope,
    });
    const adoption = settled(await state.record(command)).result;
    if (adoption.kind !== "adoption") {
      throw new Error(`expected adoption: ${JSON.stringify(adoption).slice(0, 400)}`);
    }
    // C41 必须原样使用 C30 `startRun` 返回的精确运行引用（与 C30 登记行一致）。
    const runRef = c41WaitingRunRefFor({
      projectId: command.projectId,
      idempotencyKey: command.idempotencyKey,
      adoptedRecommendationRef: prepared.recommendationRef,
    });
    expect(adoption.forecastRunRef).toEqual(runRef);

    // 决定前只有等待事实：唯一人工决定等待行、入口路由行与运行状态行，零评估子运行路由。
    const rows = await state.runRows(runRef.reference.entityId);
    expect(rows.filter((row) => row.resultKind === "waiting")).toHaveLength(1);
    expect(rows.some((row) => row.routeKind === "assessment-sub-run")).toBe(false);
    const waitingRow = rows.find((row) => row.resultKind === "waiting");
    if (waitingRow?.waitingRef?.kind !== "human-decision") {
      throw new Error("expected one human-decision waiting row");
    }
    const waiting: Extract<WaitingRefV1, { readonly kind: "human-decision" }> =
      waitingRow.waitingRef;
    expect(waiting.responseRecommendationRef).toEqual(prepared.recommendationRef);
    expect(waiting.spatialScopeRef).toEqual(scope);

    // 运行状态正文真实可读且停留在等待态（真实 C30 登记行 + 真实 C04 正文）。
    const runStateRow = rows.find((row) => row.resultKind === "run-state");
    if (runStateRow?.artifactRef === undefined) throw new Error("expected a run-state row");
    expect(
      await state.readRunState({
        runId: runRef.reference.entityId,
        artifactRef: runStateRow.artifactRef,
        spatialScopeRef: scope,
      }),
    ).toMatchObject({
      bodyKind: "run-state",
      runState: { runId: runRef.reference.entityId, status: "waiting" },
    });

    // 采纳结果就是该等待运行登记的路由与运行引用。
    expect(adoption.routeDecisionRef).toEqual(waiting.routeDecisionRef);

    // 真实 C30 绑定证明：状态等待、空间与建议逐项一致。
    const proof = settled(
      await state.verifyBindingProof({
        commandId: command.commandId,
        recommendationRef: prepared.recommendationRef,
        workflowRunRef: runRef,
        spatialScopeRef: scope,
      }),
    );
    expect(proof.result).toMatchObject({
      responseRecommendationRef: prepared.recommendationRef,
      spatialScopeRef: scope,
      routeDecisionRef: waiting.routeDecisionRef,
      workflowRunRef: runRef,
      runStatus: "waiting",
    });

    // 绑定与终局决定冻结同一份等待点状态版本（drift design D-03）。
    expect(runStateRow.resultVersionId).toBe(proof.result.runStateVersion);

    // C41 终局决定行：采纳 + 真实路由/运行引用 + 恢复已标记。
    expect(await decisionRowOf(prepared.recommendationRef)).toMatchObject({
      state: "adopted",
      route_decision_id: waiting.routeDecisionRef.reference.entityId,
      route_decision_version_id: waiting.routeDecisionRef.reference.versionId,
      forecast_run_id: runRef.reference.entityId,
      forecast_run_version_id: runRef.reference.versionId,
      resumed_at: expect.anything(),
    });

    // C28 采纳领域事实存在，且决定身份就是绑定路由引用。
    const c28Decisions = await adminRows<{ decision_id: string; version_id: string }>(
      `SELECT decision_id, version_id FROM business.response_adoption_decisions
         WHERE project_id = $1 AND recommendation_id = $2 AND recommendation_version_id = $3`,
      [
        state.projectId,
        prepared.recommendationRef.reference.entityId,
        prepared.recommendationRef.reference.versionId,
      ],
    );
    expect(c28Decisions).toHaveLength(1);
    expect(c28Decisions[0]).toMatchObject({
      decision_id: waiting.routeDecisionRef.reference.entityId,
      version_id: waiting.routeDecisionRef.reference.versionId,
    });

    // 采纳不记录现场执行或反馈；恢复恰好一次且只携带精确人工决定引用。
    const executions = await adminRows(
      `SELECT execution_id FROM business.response_execution_records
         WHERE project_id = $1 AND recommendation_id = $2 AND recommendation_version_id = $3`,
      [
        state.projectId,
        prepared.recommendationRef.reference.entityId,
        prepared.recommendationRef.reference.versionId,
      ],
    );
    expect(executions).toHaveLength(0);
    expect(state.workflow.resumeCalls).toHaveLength(resumesBefore + 1);
    expect(state.workflow.resumeCalls.at(-1)?.payload).toMatchObject({
      workflowRunRef: runRef,
      // 恢复提交的是冻结的等待点状态版本，不是运行登记摘要（drift design D-03/D-05）。
      expectedStateVersion: proof.result.runStateVersion,
      resumeCause: { kind: "human-decision-committed", routeDecisionRef: waiting.routeDecisionRef },
    });
    expect(state.workflow.resumeCalls.at(-1)?.payload.expectedStateVersion).not.toBe(
      runRef.reference.versionId,
    );
    expect(state.workflow.segmentStartCalls).toHaveLength(segmentStartsBefore);
  });

  pgIt("拒绝命令保存终局拒绝且不创建预测运行或采纳事实", async () => {
    const state = fixture!;
    const { prepared, scope } = await prepareRecommendation("c41-decline");
    const command = await state.adoptCommand({
      commandId: "c41-decline-decision",
      decision: "declined",
      recommendationRef: prepared.recommendationRef,
      preActionMonitoringSnapshotRef: prepared.preActionMonitoringSnapshotRef,
      spatialScopeRef: scope,
    });
    const startsBefore = state.workflow.startCalls.length;
    const resumesBefore = state.workflow.resumeCalls.length;
    const c28Before = await state.countC28Decisions();
    const result = settled(await state.record(command));
    expect(result.result.kind).toBe("decline");
    if (result.result.kind !== "decline") return;

    // 终局拒绝：不调用 C30、无预测运行、无 C28 采纳事实、无执行。
    expect(state.workflow.startCalls).toHaveLength(startsBefore);
    expect(state.workflow.resumeCalls).toHaveLength(resumesBefore);
    expect(await state.runRows(result.result.routeDecisionRef.reference.entityId)).toHaveLength(0);
    expect(await state.countC28Decisions()).toBe(c28Before);
    expect(await decisionRowOf(prepared.recommendationRef)).toMatchObject({
      state: "declined",
      route_decision_id: null,
      route_decision_version_id: null,
      forecast_run_id: null,
      forecast_run_version_id: null,
      resumed_at: null,
    });
    const declinedRef = result.result.routeDecisionRef;

    // 同键重放返回同一逻辑结果，且不产生第二条事实。
    const replay = settled(await state.record(command));
    expect(replay.result).toEqual({ kind: "decline", routeDecisionRef: declinedRef });
    const rowsAfterReplay = (await state.decisionRows()).filter(
      (row) => row["recommendation_id"] === prepared.recommendationRef.reference.entityId,
    );
    expect(rowsAfterReplay).toHaveLength(1);

    // 同一建议再提交采纳：失败关闭且既有拒绝事实不变。
    const conflict = await state.record(
      await state.adoptCommand({
        commandId: "c41-decline-then-adopt",
        decision: "adopted",
        recommendationRef: prepared.recommendationRef,
        preActionMonitoringSnapshotRef: prepared.preActionMonitoringSnapshotRef,
        spatialScopeRef: scope,
      }),
    );
    expect(failureOf(conflict).code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await decisionRowOf(prepared.recommendationRef)).toMatchObject({ state: "declined" });
    expect(await state.countC28Decisions()).toBe(c28Before);
    expect(state.workflow.startCalls).toHaveLength(startsBefore);
  });

  pgIt("缺少或错配绑定时在决定事实写入前失败关闭", async () => {
    const state = fixture!;
    const { prepared, scope } = await prepareRecommendation("c41-binding");
    const decisionsBefore = (await state.decisionRows()).length;
    const startsBefore = state.workflow.startCalls.length;
    const resumesBefore = state.workflow.resumeCalls.length;

    // 执行前监测快照不在该建议的冻结评估输入中：决定写入前安全失败。
    expect(
      failureOf(
        await state.record(
          await state.adoptCommand({
            commandId: "c41-binding-wrong-snapshot",
            decision: "adopted",
            recommendationRef: prepared.recommendationRef,
            preActionMonitoringSnapshotRef: {
              kind: "monitoring-snapshot",
              reference: { entityId: "c41-monitoring-absent", versionId: "1" },
            },
            spatialScopeRef: scope,
          }),
        ),
      ),
    ).toMatchObject({
      code: "BUSINESS_BLOCKED",
      blockerKind: "human-decision-feedback-pre-action-snapshot-unavailable",
    });

    // 跨空间：授权只覆盖受限空间，建议属于另一空间。
    const restrictedScope = await state.state.spatialScopeFor("restricted");
    expect(
      failureOf(
        await state.record(
          await state.adoptCommand({
            commandId: "c41-binding-cross-scope",
            decision: "adopted",
            recommendationRef: prepared.recommendationRef,
            preActionMonitoringSnapshotRef: prepared.preActionMonitoringSnapshotRef,
            spatialScopeRef: restrictedScope,
          }),
        ),
      ).code,
    ).toBe("BUSINESS_BLOCKED");

    // 不存在的建议版本（陈旧引用）：同样在写入前失败，且不自动改选版本。
    expect(
      failureOf(
        await state.record(
          await state.adoptCommand({
            commandId: "c41-binding-stale-version",
            decision: "adopted",
            recommendationRef: {
              kind: "response-recommendation",
              reference: {
                entityId: prepared.recommendationRef.reference.entityId,
                versionId: "c41-absent-version",
              },
            },
            preActionMonitoringSnapshotRef: prepared.preActionMonitoringSnapshotRef,
            spatialScopeRef: scope,
          }),
        ),
      ).code,
    ).toBe("BUSINESS_BLOCKED");

    expect(await state.decisionRows()).toHaveLength(decisionsBefore);
    expect(state.workflow.startCalls).toHaveLength(startsBefore);

    // 运行未停留在等待态：绑定不可用，绝不把已推进运行当作绑定。
    state.workflow.startDisposition = "already-advanced";
    try {
      expect(
        failureOf(
          await state.record(
            await state.adoptCommand({
              commandId: "c41-binding-advanced-run",
              decision: "adopted",
              recommendationRef: prepared.recommendationRef,
              preActionMonitoringSnapshotRef: prepared.preActionMonitoringSnapshotRef,
              spatialScopeRef: scope,
            }),
          ),
        ),
      ).toMatchObject({
        code: "BUSINESS_BLOCKED",
        blockerKind: "human-decision-feedback-binding-unavailable",
      });
    } finally {
      state.workflow.startDisposition = "waiting";
    }
    // 该用例只留下进行中占位：不是终局采纳，无运行引用、无 C28 决定、无恢复调用。
    expect(await decisionRowOf(prepared.recommendationRef)).toMatchObject({
      state: "pending-adoption",
      route_decision_id: null,
      forecast_run_id: null,
      resumed_at: null,
    });
    expect(state.workflow.resumeCalls).toHaveLength(resumesBefore);
  });

  pgIt("绑定证明与建议或运行不符时在决定写入前失败关闭", async () => {
    const state = fixture!;
    const decisionsBefore = (await state.decisionRows()).length;
    const adoptedBefore = (await state.decisionRows()).filter(
      (row) => row["state"] === "adopted",
    ).length;
    const c28DecisionsBefore = await state.countC28Decisions();

    // 绑定证明给出错建议：等待行指向另一建议引用。
    const wrongRecommendation = await prepareRecommendation("c41-binding-proof-recommendation");
    state.workflow.bindingFault = "wrong-recommendation";
    try {
      expect(
        failureOf(
          await state.record(
            await state.adoptCommand({
              commandId: "c41-binding-proof-recommendation",
              decision: "adopted",
              recommendationRef: wrongRecommendation.prepared.recommendationRef,
              preActionMonitoringSnapshotRef:
                wrongRecommendation.prepared.preActionMonitoringSnapshotRef,
              spatialScopeRef: wrongRecommendation.scope,
            }),
          ),
        ),
      ).toMatchObject({
        code: "BUSINESS_BLOCKED",
        blockerKind: "human-decision-feedback-binding-unavailable",
      });
    } finally {
      state.workflow.bindingFault = "none";
    }

    // 绑定证明给出未登记运行：等待行所属运行无法回读。
    const unregisteredRun = await prepareRecommendation("c41-binding-proof-run");
    state.workflow.bindingFault = "unregistered-run";
    try {
      expect(
        failureOf(
          await state.record(
            await state.adoptCommand({
              commandId: "c41-binding-proof-run",
              decision: "adopted",
              recommendationRef: unregisteredRun.prepared.recommendationRef,
              preActionMonitoringSnapshotRef:
                unregisteredRun.prepared.preActionMonitoringSnapshotRef,
              spatialScopeRef: unregisteredRun.scope,
            }),
          ),
        ),
      ).toMatchObject({
        code: "BUSINESS_BLOCKED",
        blockerKind: "human-decision-feedback-binding-unavailable",
      });
    } finally {
      state.workflow.bindingFault = "none";
    }

    // 等待结果交出真实运行却不交等待点状态版本：不得以运行登记摘要顶替，决定前失败关闭。
    const missingVersion = await prepareRecommendation("c41-binding-missing-wait-version");
    state.workflow.bindingFault = "missing-wait-state-version";
    try {
      expect(
        failureOf(
          await state.record(
            await state.adoptCommand({
              commandId: "c41-binding-missing-wait-version",
              decision: "adopted",
              recommendationRef: missingVersion.prepared.recommendationRef,
              preActionMonitoringSnapshotRef:
                missingVersion.prepared.preActionMonitoringSnapshotRef,
              spatialScopeRef: missingVersion.scope,
            }),
          ),
        ),
      ).toMatchObject({
        code: "BUSINESS_BLOCKED",
        blockerKind: "human-decision-feedback-binding-unavailable",
      });
    } finally {
      state.workflow.bindingFault = "none";
    }

    // 两种错配都只留下进行中占位：无终局采纳、无 C28 决定。
    expect(await state.decisionRows()).toHaveLength(decisionsBefore + 3);
    expect((await state.decisionRows()).filter((row) => row["state"] === "adopted")).toHaveLength(
      adoptedBefore,
    );
    expect(await state.countC28Decisions()).toBe(c28DecisionsBefore);
  });

  pgIt("已采纳建议形成独立现场执行且不产生预测或反馈", async () => {
    const state = fixture!;
    const { prepared, scope, adoption } = await adoptRecommendation("c41-execution");
    const executionRef = await executeAdopted({
      prefix: "c41-execution",
      recommendationRef: prepared.recommendationRef,
      scope,
    });
    expect(executionRef.kind).toBe("execution-record");

    // 只保存一项可追溯执行事实，且来源指向采纳决定。
    expect(
      await adminRows(
        `SELECT execution_id FROM business.response_execution_records
           WHERE project_id = $1 AND recommendation_id = $2 AND recommendation_version_id = $3`,
        [
          state.projectId,
          prepared.recommendationRef.reference.entityId,
          prepared.recommendationRef.reference.versionId,
        ],
      ),
    ).toHaveLength(1);
    expect(
      await adminRows(
        `SELECT execution_id FROM business.response_execution_records
           WHERE project_id = $1 AND execution_id = $2 AND source_kind = 'adopted-recommendation'
             AND route_decision_id = $3`,
        [
          state.projectId,
          executionRef.reference.entityId,
          adoption.routeDecisionRef.reference.entityId,
        ],
      ),
    ).toHaveLength(1);

    // 原采纳决定与等待运行的预测状态不变：执行不是预测、也不改写决定。
    expect(await decisionRowOf(prepared.recommendationRef)).toMatchObject({
      state: "adopted",
      route_decision_id: adoption.routeDecisionRef.reference.entityId,
      forecast_run_id: adoption.forecastRunRef.reference.entityId,
    });
    const rows = await state.runRows(adoption.forecastRunRef.reference.entityId);
    expect(rows.some((row) => row.routeKind === "assessment-sub-run")).toBe(false);
    const feedbackRows = await adminRows(
      `SELECT feedback_id FROM business.response_feedback_records WHERE project_id = $1 AND execution_id = $2`,
      [state.projectId, executionRef.reference.entityId],
    );
    expect(feedbackRows).toHaveLength(0);

    // 未采纳建议：写入前业务阻断。
    const undecided = await prepareRecommendation("c41-execution-undecided");
    expect(
      failureOf(
        await state.record(
          await state.executionCommand({
            commandId: "c41-execution-undecided",
            actionSource: {
              kind: "adopted-recommendation",
              responseRecommendationRef: undecided.prepared.recommendationRef,
            },
            spatialScopeRef: undecided.scope,
          }),
        ),
      ),
    ).toMatchObject({
      code: "BUSINESS_BLOCKED",
      blockerKind: "human-decision-feedback-decision-not-adopted",
    });
    expect(
      await adminRows(
        `SELECT execution_id FROM business.response_execution_records
           WHERE project_id = $1 AND recommendation_id = $2`,
        [state.projectId, undecided.prepared.recommendationRef.reference.entityId],
      ),
    ).toHaveLength(0);

    // 录入主体冒充他人：C28 现场执行校验拒绝，且不产生执行事实。
    expect(
      failureOf(
        await state.record(
          await state.executionCommand({
            commandId: "c41-execution-impersonated",
            actionSource: { kind: "independent-action", measureReleaseRefs: [MEASURE_RELEASE_REF] },
            recordedByActorId: "actor-c41-impersonated",
          }),
        ),
      ).code,
    ).toBe("BUSINESS_BLOCKED");
    expect(
      await adminRows(
        `SELECT execution_id FROM business.response_execution_records
           WHERE project_id = $1 AND execution_id = $2`,
        [state.projectId, "c41-execution-impersonated"],
      ),
    ).toHaveLength(0);

    // 独立行动：只引用同工程已发布措施，不产生建议、采纳或预测事实。
    const startsBefore = state.workflow.startCalls.length;
    const decisionsBefore = (await state.decisionRows()).length;
    const independent = settled(
      await state.record(
        await state.executionCommand({
          commandId: "c41-execution-independent",
          actionSource: { kind: "independent-action", measureReleaseRefs: [MEASURE_RELEASE_REF] },
        }),
      ),
    );
    expect(independent.result.kind).toBe("execution");
    expect(
      await adminRows(
        `SELECT execution_id, recommendation_id FROM business.response_execution_records
           WHERE project_id = $1 AND execution_id = $2`,
        [
          state.projectId,
          independent.result.kind === "execution"
            ? independent.result.executionRecordRef.reference.entityId
            : "",
        ],
      ),
    ).toHaveLength(1);
    expect(await state.decisionRows()).toHaveLength(decisionsBefore);
    expect(state.workflow.startCalls).toHaveLength(startsBefore);
  });

  pgIt("执行后反馈冻结精确输入并只以精确引用启动后续分段", async () => {
    const state = fixture!;
    const { prepared, scope } = await adoptRecommendation("c41-feedback");
    const executionRef = await executeAdopted({
      prefix: "c41-feedback",
      recommendationRef: prepared.recommendationRef,
      scope,
    });
    const post = await state.state.postActionAssessment({
      suffix: "c41-feedback",
      riskInputKey: prepared.riskInputKey,
    });
    const artifact = await state.state.publishFeedbackArtifact({ suffix: "c41-feedback" });
    const segmentStartsBefore = state.workflow.segmentStartCalls.length;
    const feedbackRowsBefore = await adminRows(
      `SELECT feedback_id FROM business.response_feedback_records WHERE project_id = $1 AND execution_id = $2`,
      [state.projectId, executionRef.reference.entityId],
    );

    // 缺精确实际评估选择器：失败关闭且无冻结输入、无正式反馈。
    expect(
      failureOf(
        await state.record(
          await state.feedbackCommand({
            commandId: "c41-feedback-missing-selector",
            executionRecordRef: executionRef,
            postActionMonitoringSnapshotRef: post.monitoringSnapshotRef,
            feedbackArtifactRef: artifact,
            spatialScopeRef: scope,
          }),
        ),
      ),
    ).toMatchObject({
      code: "BUSINESS_BLOCKED",
      blockerKind: "human-decision-feedback-actual-assessment-required",
    });
    expect(await snapshotRowsOf("c41-feedback-missing-selector")).toHaveLength(0);

    // C25 记录已成立但所属 C30 运行未完成：正式反馈与冻结输入均不得产生。
    state.setAssessmentRunCompleted(false);
    try {
      expect(
        failureOf(
          await state.record(
            await state.feedbackCommand({
              commandId: "c41-feedback-run-pending",
              executionRecordRef: executionRef,
              postActionMonitoringSnapshotRef: post.monitoringSnapshotRef,
              feedbackArtifactRef: artifact,
              actualAssessmentRecordRef: post.assessmentRecordRef,
              spatialScopeRef: scope,
            }),
          ),
        ).code,
      ).toBe("BUSINESS_BLOCKED");
      expect(await snapshotRowsOf("c41-feedback-run-pending")).toHaveLength(0);
    } finally {
      state.setAssessmentRunCompleted(true);
    }

    // 其它风险输入的实际评估：链不符必须失败关闭，且不落部分正式反馈。
    const foreign = await state.state.postActionAssessment({
      suffix: "c41-feedback-foreign",
      riskInputKey: "c41-feedback-foreign-risk",
    });
    expect(
      failureOf(
        await state.record(
          await state.feedbackCommand({
            commandId: "c41-feedback-foreign",
            executionRecordRef: executionRef,
            postActionMonitoringSnapshotRef: post.monitoringSnapshotRef,
            feedbackArtifactRef: artifact,
            actualAssessmentRecordRef: foreign.assessmentRecordRef,
            spatialScopeRef: scope,
          }),
        ),
      ).code,
    ).toBe("BUSINESS_BLOCKED");
    // 冻结输入只是内部产物（不是正式反馈、也不是成功审计），正式反馈一项都没有。
    const foreignSnapshots = await snapshotRowsOf("c41-feedback-foreign");
    expect(foreignSnapshots).toHaveLength(1);
    expect(foreignSnapshots[0]).toMatchObject({ state: "prepared", committed_at: null });
    expect(foreignSnapshots[0]?.["segment_started_at"]).toBeNull();
    expect(
      await adminRows(
        `SELECT feedback_id FROM business.response_feedback_records WHERE project_id = $1 AND execution_id = $2`,
        [state.projectId, executionRef.reference.entityId],
      ),
    ).toEqual(feedbackRowsBefore);

    // C28 正式写入中断（审计主键冲突 → 整体回滚）：命令失败、冻结输入仍为 prepared。
    const commandId = "c41-feedback-interrupted";
    const command = await state.feedbackCommand({
      commandId,
      executionRecordRef: executionRef,
      postActionMonitoringSnapshotRef: post.monitoringSnapshotRef,
      feedbackArtifactRef: artifact,
      actualAssessmentRecordRef: post.assessmentRecordRef,
      spatialScopeRef: scope,
    });
    await state.preinsertAuditConflict(`audit-${commandId}:response-feedback`);
    try {
      expect(failureOf(await state.record(command)).code).toBe("TERMINAL_FAILURE");
    } finally {
      await state.clearAuditConflict(`audit-${commandId}:response-feedback`);
    }
    const interrupted = await snapshotRowsOf(commandId);
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]).toMatchObject({ state: "prepared", committed_at: null });
    expect(interrupted[0]?.["segment_started_at"]).toBeNull();
    expect(state.workflow.segmentStartCalls).toHaveLength(segmentStartsBefore);
    expect(
      await adminRows(
        `SELECT feedback_id FROM business.response_feedback_records WHERE project_id = $1 AND execution_id = $2`,
        [state.projectId, executionRef.reference.entityId],
      ),
    ).toEqual(feedbackRowsBefore);

    // 原键同载荷重试补齐：正式反馈成立、冻结输入 committed、分段以精确引用启动一次。
    const retried = settled(await state.record(command));
    expect(retried.result.kind).toBe("feedback");
    if (retried.result.kind !== "feedback") return;
    const committed = await snapshotRowsOf(commandId);
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({
      state: "committed",
      execution_id: executionRef.reference.entityId,
      actual_assessment_record_id: post.assessmentRecordRef.reference.entityId,
      feedback_id: retried.result.feedbackRef.reference.entityId,
      feedback_version_id: retried.result.feedbackRef.reference.versionId,
    });
    expect(committed[0]?.["committed_at"]).not.toBeNull();
    expect(committed[0]?.["segment_started_at"]).not.toBeNull();
    expect(
      await adminRows(
        `SELECT feedback_id FROM business.response_feedback_records
           WHERE project_id = $1 AND execution_id = $2 AND feedback_id = $3`,
        [
          state.projectId,
          executionRef.reference.entityId,
          retried.result.feedbackRef.reference.entityId,
        ],
      ),
    ).toHaveLength(1);
    expect(state.workflow.segmentStartCalls).toHaveLength(segmentStartsBefore + 1);
    expect(state.workflow.segmentStartCalls.at(-1)?.payload).toMatchObject({
      entryMode: "record-response-feedback",
      executionRecordRef: executionRef,
      feedbackRef: retried.result.feedbackRef,
    });

    // 正式反馈事件与精确引用一致：后续分段只读该引用。
    const events = await adminRows<{ event_json: Record<string, unknown> }>(
      `SELECT event_json FROM outbox.events
         WHERE project_id = $1 AND event_type = 'warning.feedback-recorded.v1'
           AND producer_command_id = $2`,
      // C28 按模块派生回执身份，事件生产者与回执逐字一致。
      [state.projectId, `${commandId}:c28-warning-response.record-feedback`],
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.["event_json"]).toMatchObject({
      producerCommandId: `${commandId}:c28-warning-response.record-feedback`,
      payload: { feedbackRef: retried.result.feedbackRef, executionRecordRef: executionRef },
    });
  });

  pgIt("采纳证明只返回已终局采纳并对非终局或错配同型失败", async () => {
    const state = fixture!;
    const { prepared, scope, adoption } = await adoptRecommendation("c41-proof");
    const proof = settled(
      await state.verifyHumanDecisionCommitted({
        routeDecisionRef: adoption.routeDecisionRef,
        workflowRunRef: adoption.forecastRunRef,
        responseRecommendationRef: prepared.recommendationRef,
        spatialScopeRef: scope,
      }),
    );
    expect(proof.result).toMatchObject({
      kind: "adopted",
      routeDecisionRef: adoption.routeDecisionRef,
      workflowRunRef: adoption.forecastRunRef,
      responseRecommendationRef: prepared.recommendationRef,
      spatialScopeRef: scope,
      decidedBy: state.managerId,
    });

    // 运行或建议不符：与越权同型（不可枚举目标存在性）。
    const wrongRun = failureOf(
      await state.verifyHumanDecisionCommitted({
        routeDecisionRef: adoption.routeDecisionRef,
        workflowRunRef: {
          kind: "workflow-run",
          reference: { entityId: "c41-absent-run", versionId: "1" },
        },
        responseRecommendationRef: prepared.recommendationRef,
        spatialScopeRef: scope,
      }),
    );
    if (wrongRun.code !== "AUTHORIZATION_DENIED") {
      throw new Error(
        `运行不符证明非 AUTHORIZATION_DENIED：${JSON.stringify(wrongRun).slice(0, 400)}`,
      );
    }
    const other = await prepareRecommendation("c41-proof-other");
    expect(
      failureOf(
        await state.verifyHumanDecisionCommitted({
          routeDecisionRef: adoption.routeDecisionRef,
          workflowRunRef: adoption.forecastRunRef,
          responseRecommendationRef: other.prepared.recommendationRef,
          spatialScopeRef: scope,
        }),
      ).code,
    ).toBe("AUTHORIZATION_DENIED");

    // 运行期越权与事实缺失：授权合法（resume-run 分支）但无法证明目标事实 → 同型 AUTHORIZATION_DENIED。
    // 注：本夹具只有一条建议链（唯一空间），无法构造「按 resume-run 分支可签发、但不覆盖决定空间」的上下文
    //（受限空间对该分支不可签发，C05 在签发阶段即拒绝），因此空间不符的失败关闭证据落在命令层
    //（「缺少或错配绑定时…」与「跨空间、陈旧版本与冒充…」两条用例）。
    // a) 决策缺失：未知路由引用。
    expect(
      failureOf(
        await state.verifyHumanDecisionCommitted({
          routeDecisionRef: {
            kind: "route-decision",
            reference: { entityId: "c41-absent-decision", versionId: "1" },
          },
          workflowRunRef: adoption.forecastRunRef,
          responseRecommendationRef: prepared.recommendationRef,
          spatialScopeRef: scope,
        }),
      ).code,
    ).toBe("AUTHORIZATION_DENIED");

    // b) 工程不符属查询级越权（与能力不符同组）：strict 查询门在披露前拒绝 → TERMINAL_FAILURE，
    //    同样零副作用、不回显被查询引用。
    const validResumeQuery = await state.proofQuery({
      routeDecisionRef: adoption.routeDecisionRef,
      workflowRunRef: adoption.forecastRunRef,
      responseRecommendationRef: prepared.recommendationRef,
      spatialScopeRef: scope,
    });
    const decisionsBeforeForeignProject = (await state.decisionRows()).length;
    const foreignProject = failureOf(
      await state.adapter.verifyHumanDecisionCommitted({
        ...validResumeQuery,
        projectId: "project-c41-foreign",
      }),
    );
    expect(foreignProject.code).toBe("TERMINAL_FAILURE");
    // 不回显被查询正文引用：错误只允许携带 queryId（本用例 queryId 由路由引用派生），不得回显建议精确引用与路由版本。
    expect(JSON.stringify(foreignProject)).not.toContain(
      prepared.recommendationRef.reference.entityId,
    );
    expect(JSON.stringify(foreignProject)).not.toContain(
      adoption.routeDecisionRef.reference.versionId,
    );
    expect(await state.decisionRows()).toHaveLength(decisionsBeforeForeignProject);

    // c) 查询级越权（能力不符：以 adopt-recommendation 分支上下文冒充 resume-run）：
    //    strict 查询门在披露前拒绝，按仓库既有约定（与 C25 严格查询门一致）落成 TERMINAL_FAILURE，
    //    且零副作用、不回显被查询引用。
    const decisionsBeforeUnauthorized = (await state.decisionRows()).length;
    const unauthorized = failureOf(
      await state.verifyHumanDecisionCommitted({
        routeDecisionRef: adoption.routeDecisionRef,
        workflowRunRef: adoption.forecastRunRef,
        responseRecommendationRef: prepared.recommendationRef,
        spatialScopeRef: scope,
        authorization: await state.authorizeFor({
          branch: "warning-response.adopt-recommendation",
          invocationId: "c41-proof-unauthorized",
          spatialScopeRefs: [scope],
        }),
      }),
    );
    expect(unauthorized.code).toBe("TERMINAL_FAILURE");
    const unauthorizedText = JSON.stringify(unauthorized);
    expect(unauthorizedText).not.toContain(prepared.recommendationRef.reference.entityId);
    expect(unauthorizedText).not.toContain(adoption.routeDecisionRef.reference.versionId);
    expect(await state.decisionRows()).toHaveLength(decisionsBeforeUnauthorized);

    // 进行中（pending-adoption）：不是终局采纳，同型失败。
    const pending = await prepareRecommendation("c41-proof-pending");
    state.workflow.startDisposition = "already-advanced";
    try {
      failureOf(
        await state.record(
          await state.adoptCommand({
            commandId: "c41-proof-pending-decision",
            decision: "adopted",
            recommendationRef: pending.prepared.recommendationRef,
            preActionMonitoringSnapshotRef: pending.prepared.preActionMonitoringSnapshotRef,
            spatialScopeRef: pending.scope,
          }),
        ),
      );
    } finally {
      state.workflow.startDisposition = "waiting";
    }
    const pendingRef = decisionRefFor({
      projectId: state.projectId,
      responseRecommendationRef: pending.prepared.recommendationRef,
      commandId: "c41-proof-pending-decision",
      idempotencyKey: "c41-proof-pending-decision",
      decision: "adopted",
      reasonCode: "field-verified",
      preActionMonitoringSnapshotRef: pending.prepared.preActionMonitoringSnapshotRef,
    });
    expect(await decisionRowOf(pending.prepared.recommendationRef)).toMatchObject({
      state: "pending-adoption",
    });
    const pendingQuery = await state.proofQuery({
      routeDecisionRef: pendingRef,
      workflowRunRef: adoption.forecastRunRef,
      responseRecommendationRef: pending.prepared.recommendationRef,
      spatialScopeRef: pending.scope,
    });
    const pendingProofResult = await state.adapter.verifyHumanDecisionCommitted(pendingQuery);
    if (
      pendingProofResult.kind !== "failed" ||
      pendingProofResult.error.code !== "AUTHORIZATION_DENIED"
    ) {
      throw new Error(
        `pending 证明非 AUTHORIZATION_DENIED：${JSON.stringify(pendingProofResult).slice(0, 400)} | query=${JSON.stringify(
          pendingQuery,
        ).slice(0, 900)}`,
      );
    }

    // 拒绝（declined）：终局但不是采纳，同型失败。
    const declined = await prepareRecommendation("c41-proof-declined");
    const declinedResult = settled(
      await state.record(
        await state.adoptCommand({
          commandId: "c41-proof-declined-decision",
          decision: "declined",
          recommendationRef: declined.prepared.recommendationRef,
          spatialScopeRef: declined.scope,
        }),
      ),
    );
    expect(declinedResult.result.kind).toBe("decline");
    if (declinedResult.result.kind !== "decline") return;
    const declinedProof = await state.verifyHumanDecisionCommitted({
      routeDecisionRef: declinedResult.result.routeDecisionRef,
      workflowRunRef: adoption.forecastRunRef,
      responseRecommendationRef: declined.prepared.recommendationRef,
      spatialScopeRef: declined.scope,
    });
    if (declinedProof.kind !== "failed" || declinedProof.error.code !== "AUTHORIZATION_DENIED") {
      throw new Error(
        `declined 证明非 AUTHORIZATION_DENIED：${JSON.stringify(declinedProof).slice(0, 300)} | row=${JSON.stringify(
          await decisionRowOf(declined.prepared.recommendationRef),
        ).slice(0, 700)}`,
      );
    }

    // 行与正文摘要不一致：类型化终止失败，绝不返回部分证明。
    await state.tamperDecisionDigest(adoption.routeDecisionRef);
    expect(
      failureOf(
        await state.verifyHumanDecisionCommitted({
          routeDecisionRef: adoption.routeDecisionRef,
          workflowRunRef: adoption.forecastRunRef,
          responseRecommendationRef: prepared.recommendationRef,
          spatialScopeRef: scope,
        }),
      ).code,
    ).toBe("TERMINAL_FAILURE");
  });

  pgIt("同键重放返回同一逻辑结果且同键异载荷失败关闭", async () => {
    const state = fixture!;
    const { prepared, scope, command, adoption } = await adoptRecommendation("c41-replay");
    const resumesAfterFirst = state.workflow.resumeCalls.length;
    const c28DecisionsAfterFirst = await state.countC28Decisions();

    const replay = settled(await state.record(command));
    expect(replay.result).toEqual({ ...adoption });
    expect(state.workflow.resumeCalls).toHaveLength(resumesAfterFirst);
    expect(await state.countC28Decisions()).toBe(c28DecisionsAfterFirst);
    expect(
      await adminRows(
        `SELECT decision_id FROM business.human_response_decisions WHERE project_id = $1 AND recommendation_id = $2`,
        [state.projectId, prepared.recommendationRef.reference.entityId],
      ),
    ).toHaveLength(1);

    // 同键异载荷：不得覆盖已成立事实。
    expect(
      failureOf(
        await state.record(
          await state.adoptCommand({
            commandId: command.commandId,
            decision: "declined",
            recommendationRef: prepared.recommendationRef,
            preActionMonitoringSnapshotRef: prepared.preActionMonitoringSnapshotRef,
            reasonCode: command.payload.reasonCode,
            spatialScopeRef: scope,
          }),
        ),
      ).code,
    ).toBe("IDEMPOTENCY_CONFLICT");
    expect(
      failureOf(
        await state.record(
          await state.adoptCommand({
            commandId: command.commandId,
            decision: "adopted",
            recommendationRef: prepared.recommendationRef,
            preActionMonitoringSnapshotRef: prepared.preActionMonitoringSnapshotRef,
            reasonCode: "different-reason",
            spatialScopeRef: scope,
          }),
        ),
      ).code,
    ).toBe("IDEMPOTENCY_CONFLICT");
    expect(await decisionRowOf(prepared.recommendationRef)).toMatchObject({ state: "adopted" });
    expect(await state.countC28Decisions()).toBe(c28DecisionsAfterFirst);
  });
});
