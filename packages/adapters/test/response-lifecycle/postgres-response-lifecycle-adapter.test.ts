import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as responseLifecycleMigration from "../../src/postgres/migrations/warning-response/deliver-execution-forecast-feedback-and-deviation/000046_execution_forecast_feedback_deviation.js";
import { createPostgresRuntime } from "../../src/postgres/pool.js";
import {
  C28_FORECAST_METHOD,
  C28_FORECAST_REQUIRED_REF,
  C28_TARGET_INDICATOR,
  C28_TARGET_UNIT,
  startResponseLifecycleFixture,
  type ResponseLifecyclePostgresFixtureV1,
} from "./fixture.js";

const MEASURE_RELEASE_REF = {
  kind: "measure-library-release" as const,
  reference: { entityId: "release-measure-library", versionId: "1" },
};
const EVIDENCE = {
  locator: { sourceSegmentId: "c28-test-evidence" },
  sourceVersion: { entityId: "source-version-c28", versionId: "1" },
};

let fixture: ResponseLifecyclePostgresFixtureV1 | undefined;

const PG_TIMEOUT_MS = 240_000;
const pgIt = (name: string, body: () => Promise<unknown>): void => {
  void it(name, body, PG_TIMEOUT_MS);
};

/** 版本化预测执行器夹具：合成样本、待甲方复核；生产只注入 matching `requiredRef` 的正式实现。 */
const executor = (input: {
  readonly method?: string;
  readonly requiredRef?: { readonly entityId: string; readonly versionId: string };
  readonly predictedValue?: string;
  readonly riskLevel?: string;
  readonly unit?: string;
  readonly horizonSteps?: number;
  readonly evidence?: boolean;
}) => ({
  method: (input.method ?? C28_FORECAST_METHOD) as never,
  requiredRef: input.requiredRef ?? C28_FORECAST_REQUIRED_REF,
  forecast: (request: {
    readonly policy: {
      readonly targetIndicatorId: string;
      readonly unit: string;
      readonly horizonSteps: number;
    };
  }) => ({
    method: (input.method ?? C28_FORECAST_METHOD) as never,
    requiredRef: input.requiredRef ?? C28_FORECAST_REQUIRED_REF,
    targetIndicatorId: request.policy.targetIndicatorId,
    unit: input.unit ?? request.policy.unit,
    horizonSteps: input.horizonSteps ?? request.policy.horizonSteps,
    predictedValue: input.predictedValue ?? "12",
    predictedRiskState: {
      likelihoodScore: 2,
      consequenceScore: 2,
      riskLevel: input.riskLevel ?? "level-2",
    },
    evidenceReferences: input.evidence === false ? [] : [EVIDENCE],
    summary: "synthetic-executor",
  }),
});

describe("C28 处置执行、预测、反馈与偏差 PostgreSQL 链", () => {
  beforeAll(async () => {
    fixture = await startResponseLifecycleFixture();
  }, 900_000);

  afterAll(async () => {
    await fixture?.close();
  });

  /** 同一冻结输入的再次预测：新命令必须签发自己的精确授权。 */
  const forecastWith = async (input: {
    readonly commandId: string;
    readonly command: Awaited<ReturnType<ResponseLifecyclePostgresFixtureV1["forecastCommand"]>>;
  }) => {
    const state = fixture!;
    const command = await state.forecastCommand({
      commandId: input.commandId,
      binding: input.command.payload.binding,
      snapshotRef: input.command.payload.forecastInputSnapshotRef,
      snapshot: input.command.payload.forecastInputSnapshot,
    });
    return state.forecastResponse({
      ...command,
      payload: {
        ...command.payload,
        forecastInputSnapshot: {
          ...command.payload.forecastInputSnapshot,
          authorizationContextRef: command.authorization.authorizationContextRef,
        },
      },
    });
  };

  /** 冻结建议链 → 采纳 → 预测 → 执行：多场景共用的正式前置。 */
  const adoptedChain = async (prefix: string) => {
    const state = fixture!;
    const prepared = await state.prepareRecommendation({ prefix });
    const scope = await state.recommendationScope(prepared.recommendationRef);
    const binding = state.binding({
      suffix: prefix,
      recommendationRef: prepared.recommendationRef,
      spatialScopeRef: scope,
    });
    const decision = await state.recordDecision(
      await state.decisionCommand({
        commandId: `${prefix}-decision`,
        decision: "adopted",
        binding,
      }),
    );
    succeeded(decision);
    const forecastCommand = await state.forecastCommand({
      commandId: `${prefix}-forecast`,
      binding,
      ...(() => {
        const snapshot = state.forecastSnapshot({
          recommendationRef: prepared.recommendationRef,
          routeDecisionRef: binding.routeDecisionRef,
          preActionMonitoringSnapshotRef: prepared.preActionMonitoringSnapshotRef,
          basisRef: prepared.baselineAssessmentInputSnapshotRef,
          forecastPolicyRef: state.forecastPolicyReleaseRef,
          authorizationContextRef: {
            kind: "authorization-context",
            reference: { entityId: "placeholder", versionId: "1" },
          },
        });
        return { snapshotRef: snapshot.ref, snapshot: snapshot.body };
      })(),
      ...{ spatialScope: "root" as const },
    });
    // 快照必须由同一次已验证授权形成：用命令实际授权引用回填快照。
    const snapshotWithAuthorization = {
      ...forecastCommand.payload.forecastInputSnapshot,
      authorizationContextRef: forecastCommand.authorization.authorizationContextRef,
    };
    const forecast = await state.forecastResponse({
      ...forecastCommand,
      payload: {
        ...forecastCommand.payload,
        forecastInputSnapshot: snapshotWithAuthorization,
      },
    });
    if (forecast.kind !== "succeeded") {
      throw new Error(`C28 chain forecast failed: ${JSON.stringify(forecast).slice(0, 600)}`);
    }
    const execution = await state.recordExecution(
      await state.executionCommand({
        commandId: `${prefix}-execution`,
        actionSource: {
          kind: "adopted-recommendation",
          responseRecommendationRef: prepared.recommendationRef,
        },
      }),
    );
    if (execution.kind !== "succeeded") {
      throw new Error(`C28 chain execution failed: ${JSON.stringify(execution).slice(0, 600)}`);
    }
    return { prepared, binding, decision, forecastCommand, forecast, execution };
  };

  /** 断言成功并保留失败正文：预测与执行失败必须带类型化错误码，不接收静默失败。 */
  const succeeded = <T extends { readonly kind: string }>(
    result: T,
  ): Extract<T, { readonly kind: "succeeded" }> => {
    if (result.kind !== "succeeded") {
      throw new Error(`expected succeeded, received: ${JSON.stringify(result).slice(0, 600)}`);
    }
    return result as Extract<T, { readonly kind: "succeeded" }>;
  };

  const executionRef = (result: { kind: string; result?: { kind: string } }) =>
    result as unknown as {
      kind: "succeeded";
      result: {
        kind: "execution";
        executionRecordRef: {
          kind: "execution-record";
          reference: { entityId: string; versionId: string };
        };
      };
    };

  pgIt("迁移 up/down 可重复执行、保留既有事实并只授予 SELECT/INSERT", async () => {
    const state = fixture!;
    const runtime = createPostgresRuntime(
      state.recommendation.c26.c25.postgres.postgres.migrator,
      "riskflow_migrator",
    );
    const tables = [
      "response_adoption_decisions",
      "response_forecast_outcomes",
      "response_execution_records",
      "response_feedback_records",
      "response_deviation_facts",
    ];
    const tableCount = async (): Promise<number> => {
      const result = await state.recommendation.c26.c25.postgres.postgres.adminPool.query<{
        count: string;
      }>(
        `SELECT COUNT(*)::text AS count FROM information_schema.tables
           WHERE table_schema = 'business' AND table_name = ANY($1::text[])`,
        [tables],
      );
      return Number(result.rows[0]?.count ?? "0");
    };
    try {
      expect(await tableCount()).toBe(tables.length);
      // 重复 up 幂等，既有事实保留。
      const prepared = await state.prepareRecommendation({ prefix: "c28-migration" });
      const scope = await state.recommendationScope(prepared.recommendationRef);
      const binding = state.binding({
        suffix: "c28-migration",
        recommendationRef: prepared.recommendationRef,
        spatialScopeRef: scope,
      });
      await state.recordDecision(
        await state.decisionCommand({
          commandId: "c28-migration-decision",
          decision: "adopted",
          binding,
        }),
      );
      const rowsBefore = await state.countRows("response_adoption_decisions");
      await responseLifecycleMigration.up(runtime.db);
      expect(await tableCount()).toBe(tables.length);
      expect(await state.countRows("response_adoption_decisions")).toBe(rowsBefore);
      // 逆序 down 后可按原序重新建立五表。
      await responseLifecycleMigration.down(runtime.db);
      expect(await tableCount()).toBe(0);
      await responseLifecycleMigration.up(runtime.db);
      expect(await tableCount()).toBe(tables.length);
      const grants = await state.recommendation.c26.c25.postgres.postgres.adminPool.query<{
        table_name: string;
        privilege_type: string;
      }>(
        `SELECT table_name, privilege_type FROM information_schema.role_table_grants
           WHERE grantee = 'riskflow_app' AND table_schema = 'business' AND table_name = ANY($1::text[])
           ORDER BY table_name, privilege_type`,
        [tables],
      );
      expect(grants.rows.filter((row) => row.privilege_type === "UPDATE")).toHaveLength(0);
      expect(grants.rows.filter((row) => row.privilege_type === "DELETE")).toHaveLength(0);
      expect(grants.rows.filter((row) => row.privilege_type === "SELECT")).toHaveLength(5);
      expect(grants.rows.filter((row) => row.privilege_type === "INSERT")).toHaveLength(5);
    } finally {
      await runtime.close();
    }
  });

  pgIt("采纳正式建议保存不可变决定且不产生执行或预测", async () => {
    const state = fixture!;
    const prepared = await state.prepareRecommendation({ prefix: "c28-adopt" });
    const scope = await state.recommendationScope(prepared.recommendationRef);
    const binding = state.binding({
      suffix: "c28-adopt",
      recommendationRef: prepared.recommendationRef,
      spatialScopeRef: scope,
    });
    const result = await state.recordDecision(
      await state.decisionCommand({
        commandId: "c28-adopt-decision",
        decision: "adopted",
        binding,
      }),
    );
    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded") return;
    expect(result.result.kind).toBe("adoption");
    if (result.result.kind !== "adoption") return;
    expect(result.result.routeDecisionRef).toEqual(binding.routeDecisionRef);
    expect(result.result.forecastRunRef).toEqual(binding.forecastRunRef);
    expect(await state.countRows("response_adoption_decisions")).toBe(1);
    expect(await state.countRows("response_execution_records")).toBe(0);
    expect(await state.countRows("response_forecast_outcomes")).toBe(0);
    expect(await state.countRows("response_deviation_facts")).toBe(0);
    // 幂等重放返回同一决定引用且不新增事实。
    const replay = await state.recordDecision(
      await state.decisionCommand({
        commandId: "c28-adopt-decision",
        decision: "adopted",
        binding,
      }),
    );
    expect(replay.kind).toBe("succeeded");
    expect(await state.countRows("response_adoption_decisions")).toBe(1);
  });

  pgIt("拒绝建议只保存决定，不形成预测或执行", async () => {
    const state = fixture!;
    const prepared = await state.prepareRecommendation({ prefix: "c28-decline" });
    const scope = await state.recommendationScope(prepared.recommendationRef);
    const binding = state.binding({
      suffix: "c28-decline",
      recommendationRef: prepared.recommendationRef,
      spatialScopeRef: scope,
    });
    const result = await state.recordDecision(
      await state.decisionCommand({
        commandId: "c28-decline-decision",
        decision: "declined",
        binding,
      }),
    );
    expect(result.kind).toBe("succeeded");
    const rows = await state.recommendation.c26.c25.postgres.postgres.adminPool.query<{
      decision: string;
    }>(
      `SELECT decision FROM business.response_adoption_decisions
         WHERE project_id = $1 AND recommendation_id = $2`,
      [state.projectId, prepared.recommendationRef.reference.entityId],
    );
    expect(rows.rows).toEqual([{ decision: "declined" }]);
    expect(await state.countRows("response_forecast_outcomes")).toBe(0);
  });

  pgIt("错配工作流绑定与未授权空间在读取目标前失败闭合", async () => {
    const state = fixture!;
    const prepared = await state.prepareRecommendation({ prefix: "c28-binding" });
    const scope = await state.recommendationScope(prepared.recommendationRef);
    const binding = state.binding({
      suffix: "c28-binding",
      recommendationRef: prepared.recommendationRef,
      spatialScopeRef: scope,
    });
    const decisionsBefore = await state.countRows("response_adoption_decisions");
    const mismatched = await state.recordDecision(
      await state.decisionCommand({
        commandId: "c28-binding-mismatch",
        decision: "adopted",
        binding: {
          ...binding,
          responseRecommendationRef: {
            kind: "response-recommendation",
            reference: { entityId: "recommendation-absent", versionId: "1" },
          },
        },
      }),
    );
    // 目标不存在与无权同形：不可枚举的授权拒绝，不泄露目标是否存在。
    expect(mismatched.kind).toBe("failed");
    if (mismatched.kind === "failed") {
      expect(mismatched.error.code).toBe("AUTHORIZATION_DENIED");
    }
    const wrongProject = await state.recordDecision({
      ...(await state.decisionCommand({
        commandId: "c28-binding-project",
        decision: "adopted",
        binding,
      })),
      binding: { ...binding, projectId: "project-c28-other" },
    });
    expect(wrongProject.kind).toBe("failed");
    const restricted = await state.recordDecision(
      await state.decisionCommand({
        commandId: "c28-binding-restricted",
        decision: "adopted",
        binding,
        spatialScope: "restricted",
      }),
    );
    expect(restricted.kind).toBe("failed");
    if (restricted.kind === "failed") {
      expect(restricted.error.code).toBe("AUTHORIZATION_DENIED");
    }
    expect(await state.countRows("response_adoption_decisions")).toBe(decisionsBefore);
  });

  pgIt("同工程并发采纳只产生一个终局决定", async () => {
    const state = fixture!;
    const prepared = await state.prepareRecommendation({ prefix: "c28-concurrent" });
    const scope = await state.recommendationScope(prepared.recommendationRef);
    const first = state.binding({
      suffix: "c28-concurrent-a",
      recommendationRef: prepared.recommendationRef,
      spatialScopeRef: scope,
    });
    const second = state.binding({
      suffix: "c28-concurrent-b",
      recommendationRef: prepared.recommendationRef,
      spatialScopeRef: scope,
    });
    const results = await Promise.all([
      state.recordDecision(
        await state.decisionCommand({
          commandId: "c28-concurrent-a",
          decision: "adopted",
          binding: first,
        }),
      ),
      state.recordDecision(
        await state.decisionCommand({
          commandId: "c28-concurrent-b",
          decision: "adopted",
          binding: second,
        }),
      ),
    ]);
    expect(results.filter((result) => result.kind === "succeeded")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "failed")).toHaveLength(1);
    const rows = await state.recommendation.c26.c25.postgres.postgres.adminPool.query<{
      count: string;
    }>(
      `SELECT COUNT(*)::text AS count FROM business.response_adoption_decisions
         WHERE project_id = $1 AND recommendation_id = $2`,
      [state.projectId, prepared.recommendationRef.reference.entityId],
    );
    expect(rows.rows[0]?.count).toBe("1");
  });

  pgIt("完整预测冻结输入并按精确版本保存，重放不新建事实", async () => {
    const state = fixture!;
    state.setExecutors([executor({ predictedValue: "12" })]);
    const chain = await adoptedChain("c28-forecast");
    expect(chain.forecast.kind).toBe("succeeded");
    if (chain.forecast.kind !== "succeeded") return;
    const outcome = chain.forecast.result.outcome;
    expect(outcome.method).toBe(C28_FORECAST_METHOD);
    expect(outcome.targetIndicatorId).toBe(C28_TARGET_INDICATOR);
    expect(outcome.unit).toBe(C28_TARGET_UNIT);
    expect(outcome.availability.kind).toBe("available");
    expect(outcome.projected?.kind).toBe("available");
    if (outcome.projected?.kind === "available") {
      expect(outcome.projected.predictedValue).toBe("12");
    }
    expect(outcome.frozenAssessmentBasisRef.reference).toEqual(
      chain.prepared.baselineAssessmentInputSnapshotRef.reference,
    );
    expect(outcome.forecastPolicyRef).toEqual(state.forecastPolicyReleaseRef);
    const rowsAfterFirst = await state.countRows("response_forecast_outcomes");
    // 幂等重放：同命令返回同一预测引用且不新增事实。
    const replay = await state.forecastResponse({
      ...chain.forecastCommand,
      payload: {
        ...chain.forecastCommand.payload,
        forecastInputSnapshot: {
          ...chain.forecastCommand.payload.forecastInputSnapshot,
          authorizationContextRef: chain.forecastCommand.authorization.authorizationContextRef,
        },
      },
    });
    const replayResult = succeeded(replay);
    expect(replayResult.result.outcome.effectForecastRef).toEqual(outcome.effectForecastRef);
    // 只改命令标识的同载荷重试按冻结输入收敛到同一预测事实。
    const retried = await forecastWith({
      commandId: "c28-forecast-retry",
      command: chain.forecastCommand,
    });
    const retriedResult = succeeded(retried);
    expect(retriedResult.result.outcome.effectForecastRef).toEqual(outcome.effectForecastRef);
    // 快照必须由同一次已验证授权形成：换授权引用即失败闭合，不伪造授权。
    const forged = await state.forecastResponse({
      ...chain.forecastCommand,
      payload: {
        ...chain.forecastCommand.payload,
        forecastInputSnapshot: {
          ...chain.forecastCommand.payload.forecastInputSnapshot,
          authorizationContextRef: {
            kind: "authorization-context",
            reference: { entityId: "authorization-c28-forged", versionId: "1" },
          },
        },
      },
    });
    expect(forged.kind).toBe("failed");
    expect(await state.countRows("response_forecast_outcomes")).toBe(rowsAfterFirst);
  });

  pgIt("预测策略变更不改写既有预测结果", async () => {
    const state = fixture!;
    state.setExecutors([
      executor({ predictedValue: "12" }),
      executor({
        predictedValue: "9",
        requiredRef: { entityId: "forecast-statistics-model", versionId: "2" },
      }),
    ]);
    const chain = await adoptedChain("c28-forecast-version");
    expect(chain.forecast.kind).toBe("succeeded");
    if (chain.forecast.kind !== "succeeded") return;
    const original = chain.forecast.result.outcome;
    await state.setForecastPolicies([
      {
        policyId: "c28-forecast-policy",
        method: C28_FORECAST_METHOD,
        inputIndicatorIds: ["indicator-possibility-1"],
        targetIndicatorId: C28_TARGET_INDICATOR,
        horizonSteps: 5,
        unit: C28_TARGET_UNIT,
        requiredRef: { entityId: "forecast-statistics-model", versionId: "2" },
      },
    ]);
    const next = await forecastWith({
      commandId: "c28-forecast-version-next",
      command: chain.forecastCommand,
    });
    const nextResult = succeeded(next);
    expect(nextResult.result.outcome.effectForecastRef).not.toEqual(original.effectForecastRef);
    const stored = await state.recommendation.c26.c25.postgres.postgres.adminPool.query<{
      content_digest: string;
    }>(
      `SELECT content_digest FROM business.response_forecast_outcomes
         WHERE project_id = $1 AND forecast_id = $2`,
      [state.projectId, original.effectForecastRef.reference.entityId],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.content_digest).toMatch(/^[0-9a-f]{64}$/u);
  });

  pgIt("预测依据不完整时保存稳定不可用原因且不创建正式预测", async () => {
    const state = fixture!;
    state.setExecutors([executor({})]);
    await state.setUnmatchedForecastPolicy();
    const chain = await adoptedChain("c28-forecast-unavailable");
    expect(chain.forecast.kind).toBe("succeeded");
    if (chain.forecast.kind !== "succeeded") return;
    const outcome = chain.forecast.result.outcome;
    expect(outcome.availability).toEqual({
      kind: "unavailable",
      reasonCode: "policy-unavailable",
    });
    expect(outcome.projected?.kind).toBe("unavailable");
    await state.setForecastPolicies([
      {
        policyId: "c28-forecast-policy",
        method: C28_FORECAST_METHOD,
        inputIndicatorIds: ["indicator-possibility-1"],
        targetIndicatorId: C28_TARGET_INDICATOR,
        horizonSteps: 5,
        unit: C28_TARGET_UNIT,
        requiredRef: C28_FORECAST_REQUIRED_REF,
      },
    ]);
  });

  pgIt("缺少正式执行器时返回执行器不可用，不换方法或补默认值", async () => {
    const state = fixture!;
    state.setExecutors([]);
    const chain = await adoptedChain("c28-forecast-no-executor");
    expect(chain.forecast.kind).toBe("succeeded");
    if (chain.forecast.kind !== "succeeded") return;
    expect(chain.forecast.result.outcome.availability).toEqual({
      kind: "unavailable",
      reasonCode: "executor-unavailable",
    });
  });

  pgIt("三类版本化方法各自形成正式预测", async () => {
    const state = fixture!;
    const methods = [
      { method: "historical-statistics", requiredRef: { entityId: "model-a", versionId: "1" } },
      { method: "monitoring-trend", requiredRef: { entityId: "model-b", versionId: "1" } },
      { method: "mechanism-model", requiredRef: { entityId: "model-c", versionId: "1" } },
    ] as const;
    state.setExecutors(
      methods.map((entry) =>
        executor({ method: entry.method, requiredRef: entry.requiredRef, predictedValue: "11" }),
      ),
    );
    for (const entry of methods) {
      await state.setForecastPolicies([
        {
          policyId: `c28-forecast-${entry.method}`,
          method: entry.method,
          inputIndicatorIds: ["indicator-possibility-1"],
          targetIndicatorId: C28_TARGET_INDICATOR,
          horizonSteps: 5,
          unit: C28_TARGET_UNIT,
          requiredRef: entry.requiredRef,
        },
      ]);
      const chain = await adoptedChain(`c28-method-${entry.method}`);
      expect(chain.forecast.kind).toBe("succeeded");
      if (chain.forecast.kind !== "succeeded") continue;
      expect(chain.forecast.result.outcome.method).toBe(entry.method);
      expect(chain.forecast.result.outcome.availability.kind).toBe("available");
    }
  });

  pgIt("执行器结果不合法时失败闭合且不保存正式预测", async () => {
    const state = fixture!;
    const before = await state.countRows("response_forecast_outcomes");
    state.setExecutors([
      executor({ predictedValue: "12", unit: "m" }),
      executor({ riskLevel: "level-9" }),
      executor({ evidence: false }),
      executor({ requiredRef: { entityId: "other-model", versionId: "1" } }),
    ]);
    await state.setForecastPolicies([
      {
        policyId: "c28-forecast-policy",
        method: C28_FORECAST_METHOD,
        inputIndicatorIds: ["indicator-possibility-1"],
        targetIndicatorId: C28_TARGET_INDICATOR,
        horizonSteps: 5,
        unit: C28_TARGET_UNIT,
        requiredRef: C28_FORECAST_REQUIRED_REF,
      },
    ]);
    const prepared = await state.prepareRecommendation({ prefix: "c28-invalid-executor" });
    const scope = await state.recommendationScope(prepared.recommendationRef);
    const binding = state.binding({
      suffix: "c28-invalid-executor",
      recommendationRef: prepared.recommendationRef,
      spatialScopeRef: scope,
    });
    await state.recordDecision(
      await state.decisionCommand({
        commandId: "c28-invalid-executor-decision",
        decision: "adopted",
        binding,
      }),
    );
    const command = await state.forecastCommand({
      commandId: "c28-invalid-executor-forecast",
      binding,
      ...(() => {
        const snapshot = state.forecastSnapshot({
          recommendationRef: prepared.recommendationRef,
          routeDecisionRef: binding.routeDecisionRef,
          preActionMonitoringSnapshotRef: prepared.preActionMonitoringSnapshotRef,
          basisRef: prepared.baselineAssessmentInputSnapshotRef,
          forecastPolicyRef: state.forecastPolicyReleaseRef,
          authorizationContextRef: {
            kind: "authorization-context",
            reference: { entityId: "placeholder", versionId: "1" },
          },
        });
        return { snapshotRef: snapshot.ref, snapshot: snapshot.body };
      })(),
    });
    const result = await state.forecastResponse({
      ...command,
      payload: {
        ...command.payload,
        forecastInputSnapshot: {
          ...command.payload.forecastInputSnapshot,
          authorizationContextRef: command.authorization.authorizationContextRef,
        },
      },
    });
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.error.code).toBe("TERMINAL_FAILURE");
    }
    expect(await state.countRows("response_forecast_outcomes")).toBe(before);
  });

  pgIt("已采纳建议的现场执行与采纳保持两个独立事实", async () => {
    const state = fixture!;
    state.setExecutors([executor({ predictedValue: "12" })]);
    await state.setForecastPolicies([
      {
        policyId: "c28-forecast-policy",
        method: C28_FORECAST_METHOD,
        inputIndicatorIds: ["indicator-possibility-1"],
        targetIndicatorId: C28_TARGET_INDICATOR,
        horizonSteps: 5,
        unit: C28_TARGET_UNIT,
        requiredRef: C28_FORECAST_REQUIRED_REF,
      },
    ]);
    const chain = await adoptedChain("c28-execution");
    const execution = executionRef(chain.execution);
    expect(execution.kind).toBe("succeeded");
    expect(execution.result.kind).toBe("execution");
    const row = await state.recommendation.c26.c25.postgres.postgres.adminPool.query<{
      source_kind: string;
      recommendation_id: string;
      route_decision_id: string;
      executed_by_actor_id: string;
    }>(
      `SELECT source_kind, recommendation_id, route_decision_id, executed_by_actor_id
         FROM business.response_execution_records WHERE project_id = $1 AND execution_id = $2`,
      [state.projectId, execution.result.executionRecordRef.reference.entityId],
    );
    expect(row.rows[0]?.source_kind).toBe("adopted-recommendation");
    expect(row.rows[0]?.recommendation_id).toBe(
      chain.prepared.recommendationRef.reference.entityId,
    );
    expect(row.rows[0]?.route_decision_id).toBe(chain.binding.routeDecisionRef.reference.entityId);
    // 执行不关闭预警任务、不写反馈事件。
    const tasks = await state.recommendation.c26.taskRows();
    expect(tasks.every((task) => task.status !== "closed")).toBe(true);
    expect(await state.countEvents("warning.feedback-recorded.v1")).toBe(0);
  });

  pgIt("独立行动执行只引用已发布措施，不产生建议或决定", async () => {
    const state = fixture!;
    const executionsBefore = await state.countRows("response_execution_records");
    const decisionsBefore = await state.countRows("response_adoption_decisions");
    const result = executionRef(
      await state.recordExecution(
        await state.executionCommand({
          commandId: "c28-independent-execution",
          actionSource: {
            kind: "independent-action",
            measureReleaseRefs: [MEASURE_RELEASE_REF],
          },
        }),
      ),
    );
    succeeded(result);
    const row = await state.recommendation.c26.c25.postgres.postgres.adminPool.query<{
      source_kind: string;
      recommendation_id: string | null;
      measure_release_refs: unknown;
    }>(
      `SELECT source_kind, recommendation_id, measure_release_refs FROM business.response_execution_records
         WHERE project_id = $1 AND source_kind = 'independent-action'`,
      [state.projectId],
    );
    expect(row.rows[0]?.recommendation_id).toBeNull();
    expect(Array.isArray(row.rows[0]?.measure_release_refs)).toBe(true);
    expect(await state.countRows("response_execution_records")).toBe(executionsBefore + 1);
    // 独立行动不产生任何采纳决定：与既有决定数量保持一致。
    expect(await state.countRows("response_adoption_decisions")).toBe(decisionsBefore);
  });

  pgIt("伪造执行来源与不合法发生时间被拒绝且不产生执行事实", async () => {
    const state = fixture!;
    const before = await state.countRows("response_execution_records");
    // 不存在的措施发布：独立行动必须引用同工程已发布措施。
    const unknownRelease = executionRef(
      await state.recordExecution(
        await state.executionCommand({
          commandId: "c28-execution-unknown-release",
          actionSource: {
            kind: "independent-action",
            measureReleaseRefs: [
              {
                kind: "measure-library-release",
                reference: { entityId: "release-measure-library", versionId: "9" },
              },
            ],
          },
        }),
      ),
    );
    expect(unknownRelease.kind).toBe("failed");
    // 未决定建议：不得形成执行。
    const prepared = await state.prepareRecommendation({ prefix: "c28-execution-undecided" });
    const undecided = executionRef(
      await state.recordExecution(
        await state.executionCommand({
          commandId: "c28-execution-undecided",
          actionSource: {
            kind: "adopted-recommendation",
            responseRecommendationRef: prepared.recommendationRef,
          },
        }),
      ),
    );
    expect(undecided.kind).toBe("failed");
    // 发生时间早于采纳决定。
    const scope = await state.recommendationScope(prepared.recommendationRef);
    const binding = state.binding({
      suffix: "c28-execution-early",
      recommendationRef: prepared.recommendationRef,
      spatialScopeRef: scope,
    });
    await state.recordDecision(
      await state.decisionCommand({
        commandId: "c28-execution-early-decision",
        decision: "adopted",
        binding,
      }),
    );
    const early = executionRef(
      await state.recordExecution(
        await state.executionCommand({
          commandId: "c28-execution-early",
          actionSource: {
            kind: "adopted-recommendation",
            responseRecommendationRef: prepared.recommendationRef,
          },
          occurredAt: "2029-12-31T21:00:00.000Z",
        }),
      ),
    );
    expect(early.kind).toBe("failed");
    // 录入主体必须是当前验证主体：不得以他人身份录入。
    const impersonated = executionRef(
      await state.recordExecution(
        await state.executionCommand({
          commandId: "c28-execution-impersonated",
          actionSource: { kind: "independent-action", measureReleaseRefs: [MEASURE_RELEASE_REF] },
          recordedByActorId: "actor-c28-impersonated",
        }),
      ),
    );
    expect(impersonated.kind).toBe("failed");
    expect(await state.countRows("response_execution_records")).toBe(before);
  });

  pgIt("执行后反馈原子保存并发布既有反馈事件", async () => {
    const state = fixture!;
    state.setExecutors([executor({ predictedValue: "12" })]);
    await state.setForecastPolicies([
      {
        policyId: "c28-forecast-policy",
        method: C28_FORECAST_METHOD,
        inputIndicatorIds: ["indicator-possibility-1"],
        targetIndicatorId: C28_TARGET_INDICATOR,
        horizonSteps: 5,
        unit: C28_TARGET_UNIT,
        requiredRef: C28_FORECAST_REQUIRED_REF,
      },
    ]);
    const chain = await adoptedChain("c28-feedback");
    const forecastRef =
      chain.forecast.kind === "succeeded"
        ? chain.forecast.result.outcome.effectForecastRef
        : undefined;
    expect(forecastRef).toBeDefined();
    const execution = executionRef(chain.execution).result.executionRecordRef;
    const post = await state.postActionAssessment({
      suffix: "c28-feedback",
      riskInputKey: chain.prepared.riskInputKey,
    });
    const artifact = await state.publishFeedbackArtifact({ suffix: "c28-feedback" });
    const snapshot = state.feedbackSnapshot({
      suffix: "c28-feedback",
      executionRecordRef: execution,
      ...(forecastRef === undefined ? {} : { forecastRef }),
    });
    const feedback = await state.recordFeedback(
      await state.feedbackCommand({
        commandId: "c28-feedback-write",
        executionRecordRef: execution,
        postActionMonitoringSnapshotRef: post.monitoringSnapshotRef,
        feedbackArtifactRef: artifact,
        actualAssessmentRecordRef: post.assessmentRecordRef,
        snapshotRef: snapshot.ref,
        snapshot: snapshot.body,
      }),
    );
    const feedbackResult = succeeded(feedback);
    expect(feedbackResult.result.kind).toBe("feedback");
    const event = await state.lastEvent("warning.feedback-recorded.v1");
    expect(event?.["producerCommandId"]).toBe("c28-feedback-write");
    const payload = event?.["payload"] as {
      forecast: { kind: string; effectForecastRef?: { reference: { entityId: string } } };
      feedbackRef: { reference: { entityId: string } };
    };
    expect(payload.forecast.kind).toBe("available");
    expect(payload.forecast.effectForecastRef?.reference.entityId).toBe(
      forecastRef?.reference.entityId,
    );
    expect(await state.countEvents("warning.feedback-recorded.v1", "c28-feedback-write")).toBe(1);
    const row = await state.recommendation.c26.c25.postgres.postgres.adminPool.query<{
      forecast_availability: string;
      effect_forecast_id: string | null;
    }>(
      `SELECT forecast_availability, effect_forecast_id FROM business.response_feedback_records
         WHERE project_id = $1 AND feedback_id = $2`,
      [state.projectId, payload.feedbackRef.reference.entityId],
    );
    expect(row.rows[0]?.forecast_availability).toBe("available");
    expect(row.rows[0]?.effect_forecast_id).toBe(forecastRef?.reference.entityId);
  });

  pgIt("反馈时间或评估链不匹配时拒绝且不落部分事实", async () => {
    const state = fixture!;
    state.setExecutors([executor({ predictedValue: "12" })]);
    const chain = await adoptedChain("c28-feedback-mismatch");
    const execution = executionRef(chain.execution).result.executionRecordRef;
    const post = await state.postActionAssessment({
      suffix: "c28-feedback-mismatch",
      riskInputKey: chain.prepared.riskInputKey,
    });
    const artifact = await state.publishFeedbackArtifact({ suffix: "c28-feedback-mismatch" });
    const snapshot = state.feedbackSnapshot({
      suffix: "c28-feedback-mismatch",
      executionRecordRef: execution,
    });
    const before = await state.countRows("response_feedback_records");
    // 反馈发生时间早于执行。
    const early = await state.recordFeedback(
      await state.feedbackCommand({
        commandId: "c28-feedback-early",
        executionRecordRef: execution,
        postActionMonitoringSnapshotRef: post.monitoringSnapshotRef,
        feedbackArtifactRef: artifact,
        actualAssessmentRecordRef: post.assessmentRecordRef,
        snapshotRef: snapshot.ref,
        snapshot: snapshot.body,
        occurredAt: "2029-12-31T22:30:00.000Z",
      }),
    );
    expect(early.kind).toBe("failed");
    // 其它风险输入形成的实际评估。
    const foreignAssessment = await state.postActionAssessment({
      suffix: "c28-feedback-foreign",
      riskInputKey: "c28-feedback-foreign-risk",
    });
    const mismatched = await state.recordFeedback(
      await state.feedbackCommand({
        commandId: "c28-feedback-foreign",
        executionRecordRef: execution,
        postActionMonitoringSnapshotRef: foreignAssessment.monitoringSnapshotRef,
        feedbackArtifactRef: artifact,
        actualAssessmentRecordRef: foreignAssessment.assessmentRecordRef,
        snapshotRef: snapshot.ref,
        snapshot: snapshot.body,
      }),
    );
    expect(mismatched.kind).toBe("failed");
    // 反馈工件不存在。
    const missingArtifact = await state.recordFeedback(
      await state.feedbackCommand({
        commandId: "c28-feedback-missing-artifact",
        executionRecordRef: execution,
        postActionMonitoringSnapshotRef: post.monitoringSnapshotRef,
        feedbackArtifactRef: {
          kind: "content-artifact",
          reference: { entityId: "c28-feedback-artifact-absent", versionId: "1" },
        },
        actualAssessmentRecordRef: post.assessmentRecordRef,
        snapshotRef: snapshot.ref,
        snapshot: snapshot.body,
      }),
    );
    expect(missingArtifact.kind).toBe("failed");
    expect(await state.countRows("response_feedback_records")).toBe(before);
    expect(await state.countEvents("warning.feedback-recorded.v1", "c28-feedback-early")).toBe(0);
  });

  pgIt("独立行动反馈以稳定不可用原因发布既有事件", async () => {
    const state = fixture!;
    const execution = succeeded(
      await state.recordExecution(
        await state.executionCommand({
          commandId: "c28-independent-feedback-execution",
          actionSource: {
            kind: "independent-action",
            measureReleaseRefs: [MEASURE_RELEASE_REF],
          },
        }),
      ),
    );
    const executionRecordRef = execution.result.executionRecordRef;
    const post = await state.postActionAssessment({
      suffix: "c28-independent-feedback",
      riskInputKey: "c28-independent-risk",
    });
    const artifact = await state.publishFeedbackArtifact({ suffix: "c28-independent-feedback" });
    const snapshot = state.feedbackSnapshot({
      suffix: "c28-independent-feedback",
      executionRecordRef,
    });
    const feedback = await state.recordFeedback(
      await state.feedbackCommand({
        commandId: "c28-independent-feedback-record",
        executionRecordRef,
        postActionMonitoringSnapshotRef: post.monitoringSnapshotRef,
        feedbackArtifactRef: artifact,
        actualAssessmentRecordRef: post.assessmentRecordRef,
        snapshotRef: snapshot.ref,
        snapshot: snapshot.body,
      }),
    );
    expect(feedback.kind).toBe("succeeded");
    const event = await state.lastEvent("warning.feedback-recorded.v1");
    const payload = event?.["payload"] as { forecast: { kind: string; reasonCode?: string } };
    expect(payload.forecast.kind).toBe("unavailable");
    expect(payload.forecast.reasonCode).toBe("no-effect-forecast");
  });

  pgIt("三类偏差策略按冻结阈值产生私有事实并可供 C29 精确读取", async () => {
    const state = fixture!;
    state.setExecutors([executor({ predictedValue: "12", riskLevel: "level-2" })]);
    const cases = [
      {
        basis: "absolute",
        policy: {
          policyId: "c28-deviation-absolute",
          basis: "absolute" as const,
          threshold: "2",
          evidenceRequirements: ["monitoring-record"],
        },
        exceeds: (value: number) => value > 2,
      },
      {
        basis: "relative",
        policy: {
          policyId: "c28-deviation-relative",
          basis: "relative" as const,
          threshold: "0.1",
          minimumBaseline: "0.01",
          evidenceRequirements: ["monitoring-record"],
        },
        exceeds: (value: number) => value > 0.1,
      },
      {
        basis: "risk-level-step",
        policy: {
          policyId: "c28-deviation-level-step",
          basis: "risk-level-step" as const,
          levelStep: 1,
          riskMatrixRef: { entityId: "release-risk-matrix", versionId: "1" },
          evidenceRequirements: ["assessment-record"],
        },
        exceeds: (value: number) => value > 1,
      },
    ];
    for (const entry of cases) {
      await state.setDeviationPolicies([entry.policy]);
      const chain = await adoptedChain(`c28-deviation-${entry.basis}`);
      if (chain.forecast.kind !== "succeeded") continue;
      const forecastRef = chain.forecast.result.outcome.effectForecastRef;
      const execution = executionRef(chain.execution).result.executionRecordRef;
      const post = await state.postActionAssessment({
        suffix: `c28-deviation-${entry.basis}`,
        riskInputKey: chain.prepared.riskInputKey,
      });
      const artifact = await state.publishFeedbackArtifact({
        suffix: `c28-deviation-${entry.basis}`,
      });
      const snapshot = state.feedbackSnapshot({
        suffix: `c28-deviation-${entry.basis}`,
        executionRecordRef: execution,
        forecastRef,
      });
      const feedback = await state.recordFeedback(
        await state.feedbackCommand({
          commandId: `c28-deviation-feedback-${entry.basis}`,
          executionRecordRef: execution,
          postActionMonitoringSnapshotRef: post.monitoringSnapshotRef,
          feedbackArtifactRef: artifact,
          actualAssessmentRecordRef: post.assessmentRecordRef,
          snapshotRef: snapshot.ref,
          snapshot: snapshot.body,
        }),
      );
      expect(feedback.kind).toBe("succeeded");
      if (feedback.kind !== "succeeded" || feedback.result.kind !== "feedback") continue;
      const feedbackRef = feedback.result.feedbackRef;
      const deviation = await state.calculateDeviation(
        await state.deviationCommand({
          commandId: `c28-deviation-${entry.basis}`,
          effectForecastRef: forecastRef,
          feedbackRef,
          frozenAssessmentBasisRef: chain.prepared.baselineAssessmentInputSnapshotRef,
        }),
      );
      expect(deviation.kind).toBe("succeeded");
      if (deviation.kind !== "succeeded") continue;
      const fact = deviation.result.fact;
      expect(fact.basis).toBe(entry.basis);
      // 阈值判定与方向必须与保存的预测/实际值自洽：精确边界用例由 core 表格测试覆盖。
      const predicted = Number(fact.predictedValue);
      const actual = Number(fact.actualValue);
      expect(fact.direction).toBe(
        actual > predicted ? "actual-above" : actual < predicted ? "actual-below" : "equal",
      );
      expect(fact.thresholdExceeded).toBe(entry.exceeds(Number(fact.deviationValue)));
      const stored = await state.recommendation.c26.c25.postgres.postgres.adminPool.query<{
        deviation_payload: Record<string, unknown>;
      }>(
        `SELECT deviation_payload FROM business.response_deviation_facts
           WHERE project_id = $1 AND deviation_id = $2`,
        [state.projectId, deviation.result.deviationFactRef.reference.entityId],
      );
      const storedPayload = stored.rows[0]?.deviation_payload ?? {};
      expect(Object.keys(storedPayload)).not.toContain("calibrationRecommendation");
      expect(Object.keys(storedPayload)).not.toContain("reviewStatus");
      const read = await state.readDeviationFact({
        requestId: `c28-deviation-read-${entry.basis}`,
        deviationFactRef: deviation.result.deviationFactRef,
      });
      expect(read.kind).toBe("succeeded");
      if (read.kind === "succeeded") {
        // 只追加事实：重复读取返回同一不可变正文。
        const again = await state.readDeviationFact({
          requestId: `c28-deviation-read-again-${entry.basis}`,
          deviationFactRef: deviation.result.deviationFactRef,
        });
        expect(again.kind).toBe("succeeded");
        if (again.kind === "succeeded") {
          expect(again.result.fact).toEqual(read.result.fact);
        }
      }
      if (read.kind === "succeeded") {
        expect(read.result.fact.responseRecommendationRef.reference.entityId).toBe(
          chain.prepared.recommendationRef.reference.entityId,
        );
        expect(read.result.fact.deviationPolicyRef).toEqual({
          entityId: "release-deviation-policy",
          versionId: "1",
        });
        expect(read.result.fact.evidenceReferences.length).toBeGreaterThanOrEqual(2);
      }
      // 同命令重放返回同一私有事实引用。
      const replay = await state.calculateDeviation(
        await state.deviationCommand({
          commandId: `c28-deviation-${entry.basis}`,
          effectForecastRef: forecastRef,
          feedbackRef,
          frozenAssessmentBasisRef: chain.prepared.baselineAssessmentInputSnapshotRef,
        }),
      );
      expect(replay.kind).toBe("succeeded");
      if (replay.kind === "succeeded") {
        expect(replay.result.deviationFactRef).toEqual(deviation.result.deviationFactRef);
      }
    }
    expect(await state.countRows("response_deviation_facts")).toBe(3);
  });

  pgIt("无可用预测或多策略偏差文档时不产生偏差事实", async () => {
    const state = fixture!;
    state.setExecutors([executor({ predictedValue: "12" })]);
    // 独立行动没有建议链预测：偏差必须显式不可用。
    const execution = executionRef(
      await state.recordExecution(
        await state.executionCommand({
          commandId: "c28-deviation-independent-execution",
          actionSource: {
            kind: "independent-action",
            measureReleaseRefs: [MEASURE_RELEASE_REF],
          },
        }),
      ),
    ).result.executionRecordRef;
    const post = await state.postActionAssessment({
      suffix: "c28-deviation-independent",
      riskInputKey: "c28-deviation-independent-risk",
    });
    const artifact = await state.publishFeedbackArtifact({ suffix: "c28-deviation-independent" });
    const snapshot = state.feedbackSnapshot({
      suffix: "c28-deviation-independent",
      executionRecordRef: execution,
    });
    const feedback = await state.recordFeedback(
      await state.feedbackCommand({
        commandId: "c28-deviation-independent-feedback",
        executionRecordRef: execution,
        postActionMonitoringSnapshotRef: post.monitoringSnapshotRef,
        feedbackArtifactRef: artifact,
        actualAssessmentRecordRef: post.assessmentRecordRef,
        snapshotRef: snapshot.ref,
        snapshot: snapshot.body,
      }),
    );
    expect(feedback.kind).toBe("succeeded");
    if (feedback.kind !== "succeeded" || feedback.result.kind !== "feedback") return;
    const before = await state.countRows("response_deviation_facts");
    const unavailable = await state.calculateDeviation(
      await state.deviationCommand({
        commandId: "c28-deviation-independent",
        effectForecastRef: {
          kind: "effect-forecast",
          reference: { entityId: "effect-forecast-absent", versionId: "1" },
        },
        feedbackRef: feedback.result.feedbackRef,
        frozenAssessmentBasisRef: {
          kind: "assessment-input-snapshot",
          reference: { entityId: "assessment-input-absent", versionId: "1" },
        },
      }),
    );
    expect(unavailable.kind).toBe("unavailable");
    expect(await state.countRows("response_deviation_facts")).toBe(before);

    // 多策略偏差文档必须失败闭合，不猜策略。
    await state.setDeviationPolicies([
      {
        policyId: "c28-deviation-a",
        basis: "absolute",
        threshold: "2",
        evidenceRequirements: ["monitoring-record"],
      },
      {
        policyId: "c28-deviation-b",
        basis: "relative",
        threshold: "0.1",
        minimumBaseline: "0.01",
        evidenceRequirements: ["monitoring-record"],
      },
    ]);
    state.setExecutors([executor({ predictedValue: "12" })]);
    const chain = await adoptedChain("c28-deviation-multi-policy");
    if (chain.forecast.kind !== "succeeded") return;
    const chainExecution = executionRef(chain.execution).result.executionRecordRef;
    const chainPost = await state.postActionAssessment({
      suffix: "c28-deviation-multi-policy",
      riskInputKey: chain.prepared.riskInputKey,
    });
    const chainArtifact = await state.publishFeedbackArtifact({
      suffix: "c28-deviation-multi-policy",
    });
    const chainSnapshot = state.feedbackSnapshot({
      suffix: "c28-deviation-multi-policy",
      executionRecordRef: chainExecution,
      forecastRef: chain.forecast.result.outcome.effectForecastRef,
    });
    const chainFeedback = await state.recordFeedback(
      await state.feedbackCommand({
        commandId: "c28-deviation-multi-policy-feedback",
        executionRecordRef: chainExecution,
        postActionMonitoringSnapshotRef: chainPost.monitoringSnapshotRef,
        feedbackArtifactRef: chainArtifact,
        actualAssessmentRecordRef: chainPost.assessmentRecordRef,
        snapshotRef: chainSnapshot.ref,
        snapshot: chainSnapshot.body,
      }),
    );
    if (chainFeedback.kind !== "succeeded" || chainFeedback.result.kind !== "feedback") return;
    const multiPolicy = await state.calculateDeviation(
      await state.deviationCommand({
        commandId: "c28-deviation-multi-policy",
        effectForecastRef: chain.forecast.result.outcome.effectForecastRef,
        feedbackRef: chainFeedback.result.feedbackRef,
        frozenAssessmentBasisRef: chain.prepared.baselineAssessmentInputSnapshotRef,
      }),
    );
    expect(multiPolicy.kind).toBe("failed");
    if (multiPolicy.kind === "failed") {
      expect(multiPolicy.error.code).toBe("STALE_VERSION");
    }
    expect(await state.countRows("response_deviation_facts")).toBe(before);
  });

  pgIt("C29 精确读取按工程与空间收口，无列表或 latest", async () => {
    const state = fixture!;
    await state.setDeviationPolicies([
      {
        policyId: "c28-deviation-absolute",
        basis: "absolute",
        threshold: "2",
        evidenceRequirements: ["monitoring-record"],
      },
    ]);
    state.setExecutors([executor({ predictedValue: "12" })]);
    const chain = await adoptedChain("c28-deviation-read");
    if (chain.forecast.kind !== "succeeded") return;
    const execution = executionRef(chain.execution).result.executionRecordRef;
    const post = await state.postActionAssessment({
      suffix: "c28-deviation-read",
      riskInputKey: chain.prepared.riskInputKey,
    });
    const artifact = await state.publishFeedbackArtifact({ suffix: "c28-deviation-read" });
    const snapshot = state.feedbackSnapshot({
      suffix: "c28-deviation-read",
      executionRecordRef: execution,
      forecastRef: chain.forecast.result.outcome.effectForecastRef,
    });
    const feedback = await state.recordFeedback(
      await state.feedbackCommand({
        commandId: "c28-deviation-read-feedback",
        executionRecordRef: execution,
        postActionMonitoringSnapshotRef: post.monitoringSnapshotRef,
        feedbackArtifactRef: artifact,
        actualAssessmentRecordRef: post.assessmentRecordRef,
        snapshotRef: snapshot.ref,
        snapshot: snapshot.body,
      }),
    );
    if (feedback.kind !== "succeeded" || feedback.result.kind !== "feedback") return;
    const deviation = await state.calculateDeviation(
      await state.deviationCommand({
        commandId: "c28-deviation-read",
        effectForecastRef: chain.forecast.result.outcome.effectForecastRef,
        feedbackRef: feedback.result.feedbackRef,
        frozenAssessmentBasisRef: chain.prepared.baselineAssessmentInputSnapshotRef,
      }),
    );
    expect(deviation.kind).toBe("succeeded");
    if (deviation.kind !== "succeeded") return;
    // 受限空间与不存在的引用返回同一不可枚举失败。
    const restricted = await state.readDeviationFact({
      requestId: "c28-deviation-read-restricted",
      deviationFactRef: deviation.result.deviationFactRef,
      spatialScope: "restricted",
    });
    expect(restricted.kind).toBe("failed");
    const absent = await state.readDeviationFact({
      requestId: "c28-deviation-read-absent",
      deviationFactRef: {
        kind: "response-deviation-fact",
        reference: { entityId: "response-deviation-absent", versionId: "1" },
      },
    });
    expect(absent.kind).toBe("failed");
    if (restricted.kind === "failed" && absent.kind === "failed") {
      expect(restricted.error.code).toBe(absent.error.code);
      expect(restricted.error.code).toBe("AUTHORIZATION_DENIED");
    }
  });

  pgIt("同键异载荷冲突且事务任一成员失败整体回滚", async () => {
    const state = fixture!;
    const prepared = await state.prepareRecommendation({ prefix: "c28-rollback" });
    const scope = await state.recommendationScope(prepared.recommendationRef);
    const binding = state.binding({
      suffix: "c28-rollback",
      recommendationRef: prepared.recommendationRef,
      spatialScopeRef: scope,
    });
    const command = await state.decisionCommand({
      commandId: "c28-rollback-decision",
      decision: "adopted",
      binding,
    });
    const before = await state.countRows("response_adoption_decisions");
    // 预置审计主键冲突：业务事实、回执与审计必须整体不可见。
    await state.preinsertAuditConflict("audit-c28-rollback-decision:response-adoption-decision");
    const failed = await state.recordDecision(command);
    expect(failed.kind).toBe("failed");
    expect(await state.countRows("response_adoption_decisions")).toBe(before);
    expect(
      await state.countCommandRows("response_adoption_decisions", "c28-rollback-decision"),
    ).toBe(0);
    await state.clearAuditConflict("audit-c28-rollback-decision:response-adoption-decision");
    const succeeded = await state.recordDecision(command);
    expect(succeeded.kind).toBe("succeeded");
    expect(await state.countRows("response_adoption_decisions")).toBe(before + 1);
    expect(
      await state.countCommandRows("response_adoption_decisions", "c28-rollback-decision"),
    ).toBe(1);
    // 同键异载荷：同一命令标识不得改写已成立的决定。
    const conflicting = await state.recordDecision({
      ...(await state.decisionCommand({
        commandId: "c28-rollback-decision",
        decision: "declined",
        binding,
      })),
    });
    expect(conflicting.kind === "failed" ? "failed" : "succeeded").toBe("failed");
  });
});
