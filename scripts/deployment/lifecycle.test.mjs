import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import {
  CLOSED_OUTBOX_EVENT_TYPES_V1,
  NO_BACKGROUND_CONSUMER,
  OutboxDispatchRegistryV1,
  UnknownOutboxEventError,
  deliveryPlanV1,
} from "./events.mjs";
import {
  ApiLifecycleV1,
  LifecycleStateV1,
  WorkerLifecycleV1,
  drainUntilV1,
  runProbeV1,
  safeLogRecordV1,
} from "./lifecycle.mjs";

const event = (eventType) => ({ eventId: `evt-${eventType}`, eventType });

describe("Outbox 事件闭合清单", () => {
  it("12 个已知事件逐项登记，未知事件失败且不静默吞掉", () => {
    expect(CLOSED_OUTBOX_EVENT_TYPES_V1).toHaveLength(12);
    for (const eventType of CLOSED_OUTBOX_EVENT_TYPES_V1) {
      const plan = deliveryPlanV1(eventType);
      expect(plan.eventType).toBe(eventType);
      expect(typeof plan.hasBackgroundConsumer).toBe("boolean");
    }
    expect(() => deliveryPlanV1("something.never-registered.v1")).toThrow(UnknownOutboxEventError);
  });

  it("无后台消费者的事件显式登记，ack 不删除事件", async () => {
    const registry = new OutboxDispatchRegistryV1();
    const plan = deliveryPlanV1("warning.warning-acknowledged.v1");
    expect(plan.consumerName).toBe(NO_BACKGROUND_CONSUMER);
    expect(plan.hasBackgroundConsumer).toBe(false);

    const result = await registry.dispatch(event("warning.warning-acknowledged.v1"));
    expect(result.status).toBe("acknowledged");
    expect(result.backgroundConsumerAbsent).toBe(true);
    expect(result.durableReceipt).toBeNull();
  });

  it("登记后台消费者时拒绝错名称与无消费者事件", () => {
    const registry = new OutboxDispatchRegistryV1();
    expect(() =>
      registry.register("knowledge.identification-basis-published.v1", "wrong-name", () => ({})),
    ).toThrow(TypeError);
    expect(() => registry.register("warning.warning-acknowledged.v1", "any", () => ({}))).toThrow(
      TypeError,
    );
    expect(() => registry.register("review.review-resolved.v1", "identification-recovery")).toThrow(
      TypeError,
    );
  });

  it("未绑定消费者时保持非就绪，assertReady 失败关闭", async () => {
    const registry = new OutboxDispatchRegistryV1();
    expect(registry.missingConsumers()).toEqual([
      "engineering.inputs-ready.v1",
      "identification.risk-record-accepted.v1",
      "knowledge.identification-basis-published.v1",
      "review.review-resolved.v1",
      "warning.warning-recorded.v1",
    ]);
    expect(() => registry.assertReady()).toThrow(TypeError);
    await expect(
      registry.dispatch(event("knowledge.identification-basis-published.v1")),
    ).rejects.toThrow(/not bound/);
  });

  it("消费者给出耐久回执后才 acknowledged", async () => {
    const registry = new OutboxDispatchRegistryV1();
    registry.register(
      "knowledge.identification-basis-published.v1",
      "projection",
      async (input) => ({ receipt: `receipt-${input.eventId}` }),
    );
    const ok = await registry.dispatch(event("knowledge.identification-basis-published.v1"));
    expect(ok.status).toBe("acknowledged");
    expect(ok.durableReceipt.receipt).toBe(
      "receipt-evt-knowledge.identification-basis-published.v1",
    );

    // 未给出回执时不得声称已处理。
    const silent = new OutboxDispatchRegistryV1();
    silent.register(
      "knowledge.identification-basis-published.v1",
      "projection",
      async () => undefined,
    );
    const failed = await silent.dispatch(event("knowledge.identification-basis-published.v1"));
    expect(failed.status).toBe("failed");
    expect(failed.durableReceipt).toBeNull();
  });

  it("全部绑定后进入就绪", () => {
    const registry = new OutboxDispatchRegistryV1();
    for (const eventType of registry.missingConsumers()) {
      const plan = deliveryPlanV1(eventType);
      registry.register(eventType, plan.consumerName, async () => ({ receipt: "ok" }));
    }
    expect(registry.missingConsumers()).toEqual([]);
    expect(registry.assertReady()).toBe(registry);
  });

  it("未登记的事件类型在 dispatch 时失败关闭", async () => {
    const registry = new OutboxDispatchRegistryV1();
    await expect(registry.dispatch(event("unknown.event.v1"))).rejects.toThrow(
      UnknownOutboxEventError,
    );
  });
});

describe("有界 drain 与探针", () => {
  it("在期限内空闲时 settled=true", async () => {
    expect(await drainUntilV1({ isBusy: () => false, timeoutMs: 500 })).toEqual({
      settled: true,
      remaining: 0,
    });
  });

  it("期限内未收口时 settled=false，不得当作停写证明", async () => {
    const outcome = await drainUntilV1({ isBusy: () => true, timeoutMs: 60, pollMs: 5 });
    expect(outcome.settled).toBe(false);
    expect(outcome.remaining).toBeGreaterThan(0);
  });

  it("探针成功、缺结果与抛错分别收口为稳定状态", async () => {
    const ok = await runProbeV1(async () => ({ ok: true }), { timeoutMs: 100 });
    expect(ok.status).toBe("ready");

    const missing = await runProbeV1(async () => undefined, { timeoutMs: 100 });
    expect(missing.status).toBe("unavailable");
    expect(missing.reasonCode).toBe("PROBE_NO_RESULT");

    const threw = await runProbeV1(
      async () => {
        throw new Error("boom");
      },
      { timeoutMs: 100 },
    );
    expect(threw.status).toBe("unavailable");
    expect(threw.reasonCode).toBe("PROBE_THREW");
  });

  it("探针挂起直到截止时间后收口为超时", async () => {
    const timedOut = await runProbeV1(
      (input) =>
        new Promise((resolve) => {
          input.signal.addEventListener("abort", () => resolve({ ok: true }), { once: true });
        }),
      { timeoutMs: 40 },
    );
    expect(timedOut.status).toBe("unavailable");
    expect(timedOut.reasonCode).toBe("PROBE_TIMEOUT_OR_CANCELLED");
  });

  it("外部取消时探针立即收口为 aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runProbeV1(async () => ({ ok: true }), {
      timeoutMs: 100,
      signal: controller.signal,
    });
    expect(result.status).toBe("unavailable");
    expect(result.reasonCode).toBe("PROBE_ABORTED");
  });

  it("日志只保留安全字段，正文与秘密不被复制", () => {
    const record = safeLogRecordV1({
      stage: "backup",
      status: "running",
      reasonCode: "MANIFEST_STAGE",
      operationId: "op-1",
      count: 3,
      body: "工程资料正文",
      secret: "db-password",
      url: "https://internal/path",
      hostPath: "/var/lib/riskflow",
      chainOfThought: "模型思维链",
    });
    expect(Object.keys(record).sort()).toEqual([
      "count",
      "operationId",
      "reasonCode",
      "stage",
      "status",
    ]);
    expect(JSON.stringify(record)).not.toContain("工程资料正文");
    expect(JSON.stringify(record)).not.toContain("db-password");
  });
});

describe("进程生命周期", () => {
  const stubApp = () => {
    const state = { listening: false, closed: false };
    return {
      state,
      async listen(options) {
        state.listening = true;
        state.options = options;
      },
      async close() {
        state.closed = true;
        state.listening = false;
      },
      server: { address: () => ({ address: "127.0.0.1", port: 8080 }) },
    };
  };

  it("API 显式监听，工厂本身不监听", async () => {
    const app = stubApp();
    const lifecycle = new ApiLifecycleV1({ app, listenOptions: { port: 8080 } });
    expect(app.state.listening).toBe(false);
    expect(lifecycle.state).toBe(LifecycleStateV1.STOPPED);

    const address = await lifecycle.listen();
    expect(app.state.listening).toBe(true);
    expect(app.state.options).toEqual({ port: 8080 });
    expect(address).toEqual({ address: "127.0.0.1", port: 8080 });
    expect(lifecycle.state).toBe(LifecycleStateV1.RUNNING);
  });

  it("就绪核验失败时不进入监听态", () => {
    const app = stubApp();
    const lifecycle = new ApiLifecycleV1({ app, listenOptions: { port: 8080 } });
    expect(() =>
      lifecycle.listen(() => {
        throw new Error("required port missing");
      }),
    ).toThrow("required port missing");
    expect(app.state.listening).toBe(false);
    expect(lifecycle.state).toBe(LifecycleStateV1.STOPPED);
  });

  it("关闭时限内未收口时如实报告 unsettled", async () => {
    const app = stubApp();
    const lifecycle = new ApiLifecycleV1({ app, listenOptions: { port: 8080 } });
    await lifecycle.listen();
    const release = lifecycle.trackRequest();
    const outcome = await lifecycle.close(50);
    expect(outcome.settled).toBe(false);
    release();
    await lifecycle.close(50);
    expect(app.state.closed).toBe(true);
    expect(lifecycle.state).toBe(LifecycleStateV1.STOPPED);
  });

  it("Worker 有界轮询按原身份 dispatch", async () => {
    const dispatched = [];
    const worker = new WorkerLifecycleV1({
      dispatch: async (input) => {
        dispatched.push(input.eventId);
        return { status: "acknowledged" };
      },
      poll: async () => ({ eventId: "evt-1", eventType: "review.review-resolved.v1" }),
      pollMs: 5,
      drainTimeoutMs: 200,
      leaseTimeoutMs: 60_000,
    });

    const outcome = await worker.runOnce();
    expect(dispatched).toEqual(["evt-1"]);
    expect(outcome.status).toBe("acknowledged");

    const stopped = await worker.stop();
    expect(stopped.settled).toBe(true);
    expect(stopped.unacknowledgedLeases).toBe(0);
    expect(worker.state).toBe(LifecycleStateV1.STOPPED);
  });

  it("关闭超时如实报告未确认租约，交还原恢复语义", async () => {
    const worker = new WorkerLifecycleV1({
      dispatch: () => new Promise(() => undefined),
      poll: async () => ({ eventId: "evt-stuck", eventType: "review.review-resolved.v1" }),
      pollMs: 5,
      drainTimeoutMs: 50,
      leaseTimeoutMs: 60_000,
    });
    worker.start();
    await delay(20);
    const outcome = await worker.stop();
    expect(outcome.settled).toBe(false);
    expect(outcome.unacknowledgedLeases).toBeGreaterThan(0);
    expect(outcome.leaseTimeoutMs).toBe(60_000);
  });
});
