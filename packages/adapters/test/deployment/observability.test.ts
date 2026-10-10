import { describe, expect, it } from "vitest";

import {
  OBSERVABILITY_COMPONENT_IDS_V1,
  collectSystemObservabilityV1,
  observabilityFromHealthReportV1,
  readCapacityBudgetV1,
} from "../../src/deployment/observability.js";

/** overrides 传的是真实探针函数；未覆盖的组件一律返回 ok。 */
const readyProbes = (overrides = {}) =>
  Object.fromEntries(
    OBSERVABILITY_COMPONENT_IDS_V1.map((componentId) => [
      componentId,
      overrides[componentId] ?? (async () => ({ ok: true })),
    ]),
  );

describe("四组件运维观测", () => {
  it("覆盖 API/Worker/模型/数据库四组件", () => {
    expect([...OBSERVABILITY_COMPONENT_IDS_V1]).toEqual(["api", "worker", "model", "database"]);
  });

  it("四项全部可用才整体 ready", async () => {
    const report = await collectSystemObservabilityV1({ probes: readyProbes() });
    expect(report.ready).toBe(true);
    expect(report.components).toHaveLength(4);
    expect(report.unavailableCount).toBe(0);
    expect(report.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("任一组件不可用即整体不 ready，不用多数掩盖单项失败", async () => {
    const report = await collectSystemObservabilityV1({
      probes: readyProbes({ model: async () => ({ ok: false, reasonCode: "MODEL_UNAVAILABLE" }) }),
    });
    expect(report.ready).toBe(false);
    expect(report.unavailableCount).toBe(1);
    const model = report.components.find((item) => item.componentId === "model");
    expect(model.status).toBe("unavailable");
    expect(model.reasonCode).toBe("MODEL_UNAVAILABLE");
  });

  it("未配置的组件如实报为不可用，不假定正常", async () => {
    const probes = readyProbes();
    delete probes.database;
    const report = await collectSystemObservabilityV1({ probes });
    expect(report.ready).toBe(false);
    const database = report.components.find((item) => item.componentId === "database");
    expect(database.reasonCode).toBe("COMPONENT_NOT_CONFIGURED");
  });

  it("探针抛错收口为不可用且不泄露内部细节", async () => {
    const report = await collectSystemObservabilityV1({
      probes: readyProbes({
        api: async () => {
          throw new Error("connect ECONNREFUSED 10.0.0.13:5432");
        },
      }),
    });
    const api = report.components.find((item) => item.componentId === "api");
    expect(api.status).toBe("unavailable");
    expect(JSON.stringify(api)).not.toContain("10.0.0.13");
    expect(JSON.stringify(api)).not.toContain("ECONNREFUSED");
  });

  it("整体截止时间到达后未完成的探针按不可用收口", async () => {
    const report = await collectSystemObservabilityV1({
      probes: readyProbes({
        worker: ({ signal }) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () => resolve({ ok: true }), { once: true });
          }),
      }),
      timeoutMs: 30,
    });
    const worker = report.components.find((item) => item.componentId === "worker");
    // 探针在 abort 后才 resolve：按超时收口，不当作成功。
    expect(worker?.status).toBe("unavailable");
    expect(worker?.reasonCode).toBe("PROBE_TIMEOUT_OR_CANCELLED");
    expect(report.ready).toBe(false);
  });
});

describe("健康报告折算与容量预算", () => {
  it("报告缺失时如实标记不可用", () => {
    const result = observabilityFromHealthReportV1(undefined);
    expect(result.status).toBe("unavailable");
    expect(result.reasonCode).toBe("HEALTH_REPORT_MISSING");
  });

  it("任一项失败即降级，并统计失败数", () => {
    const degraded = observabilityFromHealthReportV1({
      modelObservation: { ok: true },
      workerObservation: { ok: false },
    });
    expect(degraded.status).toBe("unavailable");
    expect(degraded.checkedCount).toBe(2);
    expect(degraded.failedCount).toBe(1);
  });

  it("空报告不得视为正常", () => {
    expect(observabilityFromHealthReportV1({}).status).toBe("unavailable");
  });

  it("容量预算缺失时不可用，齐全时只回报上限", () => {
    expect(readCapacityBudgetV1(undefined).status).toBe("unavailable");
    const budget = readCapacityBudgetV1({
      workerPollMs: 1_000,
      workerMaxConcurrency: 4,
      healthProbeTimeoutMs: 2_000,
      drainTimeoutMs: 30_000,
    });
    expect(budget.status).toBe("ready");
    expect(budget.workerPollMs).toBe(1_000);
    expect(budget).not.toHaveProperty("autoScale");
  });
});
