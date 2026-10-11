/**
 * C37 D-06/D-07：API 与 Worker 进程的生命周期。
 *
 * 不变量：
 * - 关闭时先停止接收新工作，再停止 claim，最后在有限期限内 drain；
 * - drain 超时**不是**停写证明：返回 settled=false，由运维报告未完成；
 * - 未确认的租约交还原恢复语义，不重开任务、不扩预算、不自动采纳人工决定；
 * - 探针带 AbortSignal 与整体截止时间，不依赖调用方自己的定时器；
 * - 日志只含稳定状态、原因码、引用与计数，不含正文、秘密、URL、宿主路径或思维链。
 */

import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";

export class LifecycleStateV1 {
  static RUNNING = "running";
  static DRAINING = "draining";
  static STOPPED = "stopped";
}
/**
 * 有界 drain。
 *
 * 返回 settled=false 表示在期限内未收口；调用方必须据此报告未完成，
 * 不得声称停写成功，也不得扩大期限后伪装已收口。
 */
export const drainUntilV1 = async ({ isBusy, timeoutMs, pollMs = 25, clock = Date.now }) => {
  const deadline = clock() + timeoutMs;
  for (;;) {
    if (!isBusy()) return Object.freeze({ settled: true, remaining: 0 });
    if (clock() >= deadline) {
      return Object.freeze({ settled: false, remaining: isBusy() ? 1 : 0 });
    }
    await delay(pollMs);
  }
};
/**
 * 带整体截止时间与 AbortSignal 的探针执行。
 *
 * 超时、取消与非法结果都收口为稳定的不可用状态，不把内部错误细节透给调用方。
 */
export const runProbeV1 = async (probe, { timeoutMs, signal, now = () => new Date() }) => {
  if (signal?.aborted === true) {
    return Object.freeze({ status: "unavailable", reasonCode: "PROBE_ABORTED" });
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener?.("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await probe({ signal: controller.signal, deadlineMs: timeoutMs });
    // 探针在 abort 后才 resolve 也算超时：不得把取消后的返回当成成功。
    if (controller.signal.aborted) {
      return Object.freeze({
        status: "unavailable",
        reasonCode: "PROBE_TIMEOUT_OR_CANCELLED",
        observedAt: now().toISOString(),
        detail: null,
      });
    }
    if (result === undefined || result === null) {
      return Object.freeze({ status: "unavailable", reasonCode: "PROBE_NO_RESULT" });
    }
    return Object.freeze({
      status: result.ok === true ? "ready" : "unavailable",
      reasonCode: result.reasonCode ?? (result.ok === true ? "PROBE_OK" : "PROBE_FAILED"),
      observedAt: now().toISOString(),
      detail: result.detail ?? null,
    });
  } catch {
    return Object.freeze({
      status: "unavailable",
      reasonCode: controller.signal.aborted ? "PROBE_TIMEOUT_OR_CANCELLED" : "PROBE_THREW",
      observedAt: now().toISOString(),
      detail: null,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
};
/** 只允许安全字段进入日志；其余一律丢弃。 */
export const SAFE_LOG_FIELDS = Object.freeze([
  "stage",
  "status",
  "reasonCode",
  "operationId",
  "consumerName",
  "eventType",
  "projectId",
  "backupId",
  "releaseId",
  "instanceId",
  "count",
  "elapsedMs",
]);
/**
 * 构造一条脱敏日志记录。
 * 不接受正文、秘密、URL、宿主路径或模型原始响应；这些字段根本不会被复制。
 */
export const safeLogRecordV1 = (input) => {
  const record = {};
  for (const field of SAFE_LOG_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    record[field] = typeof value === "number" ? value : String(value);
  }
  return Object.freeze(record);
};
/**
 * API 进程生命周期：显式监听、停止接收、限时 drain。
 */
export class ApiLifecycleV1 {
  #app;
  #listenOptions;
  #state = LifecycleStateV1.STOPPED;
  #inFlight = 0;
  #address = null;
  constructor({ app, listenOptions }) {
    this.#app = app;
    this.#listenOptions = listenOptions;
  }
  get state() {
    return this.#state;
  }
  get address() {
    return this.#address;
  }
  /**
   * 显式监听。API 工厂本身不监听，端口由宿主决定。
   *
   * 就绪核验在转为 pending 之前同步执行：核验失败既不进入 listening，
   * 也不留下半启动状态；调用方可以直接用同步断言捕获。
   */
  listen(assertReady) {
    if (this.#state !== LifecycleStateV1.STOPPED) {
      throw new TypeError("api lifecycle can only listen from the stopped state");
    }
    assertReady?.();
    this.#state = LifecycleStateV1.RUNNING;
    return this.#app.listen(this.#listenOptions).then(() => {
      this.#address = this.#app.server.address();
      return this.#address;
    });
  }
  trackRequest() {
    this.#inFlight += 1;
    return () => {
      this.#inFlight -= 1;
    };
  }
  async close(timeoutMs) {
    if (this.#state === LifecycleStateV1.STOPPED) {
      return Object.freeze({ settled: true, remaining: 0 });
    }
    this.#state = LifecycleStateV1.DRAINING;
    const outcome = await drainUntilV1({ isBusy: () => this.#inFlight > 0, timeoutMs });
    // 无论是否在期限内收口，都关闭监听；未收口由调用方报告，不得当作停写证明。
    await this.#app.close();
    this.#state = LifecycleStateV1.STOPPED;
    return outcome;
  }
}
/**
 * Worker 进程生命周期：停止接收 → 停止 claim → 限时 drain → 交还租约。
 */
export class WorkerLifecycleV1 {
  #dispatch;
  #poll;
  #pollMs;
  #drainTimeoutMs;
  #leaseTimeoutMs;
  #state = LifecycleStateV1.STOPPED;
  #timer = null;
  #inFlight = 0;
  #claimed = 0;
  #backgroundFailure = null;
  #signal = new AbortController();
  constructor({ dispatch, poll, pollMs, drainTimeoutMs, leaseTimeoutMs }) {
    this.#dispatch = dispatch;
    this.#poll = poll;
    this.#pollMs = pollMs;
    this.#drainTimeoutMs = drainTimeoutMs;
    this.#leaseTimeoutMs = leaseTimeoutMs;
  }
  get state() {
    return this.#state;
  }
  get inFlight() {
    return this.#inFlight;
  }
  get backgroundFailure() {
    return this.#backgroundFailure;
  }
  /**
   * 有界轮询：runOnce 的每一轮都由宿主驱动，不修改任务预算本身。
   * 停止后不再 claim 新事件；已在途的按原身份收口。
   */
  async runOnce() {
    const event = await this.#poll({ signal: this.#signal.signal });
    if (event === undefined || event === null) return undefined;
    this.#inFlight += 1;
    this.#claimed += 1;
    try {
      return await this.#dispatch(event, { signal: this.#signal.signal });
    } finally {
      this.#inFlight -= 1;
    }
  }
  start() {
    if (this.#state !== LifecycleStateV1.STOPPED) {
      throw new TypeError("worker lifecycle can only start from the stopped state");
    }
    this.#state = LifecycleStateV1.RUNNING;
    this.#signal = new AbortController();
    const loop = async () => {
      while (this.#state === LifecycleStateV1.RUNNING) {
        await this.runOnce();
        await delay(this.#pollMs);
      }
    };
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void loop().catch((error) => {
        if (
          this.#signal.signal.aborted &&
          (error?.name === "AbortError" || error?.code === "ABORT_ERR")
        ) {
          return;
        }
        this.#backgroundFailure = error;
        if (this.#state === LifecycleStateV1.RUNNING) this.#state = LifecycleStateV1.DRAINING;
        this.#signal.abort();
      });
    }, 0);
    return this;
  }
  /**
   * SIGTERM 处理：停止 claim、取消轮询、限时 drain。
   * 返回 settled=false 时，未确认的租约必须交还原恢复语义。
   */
  async stop() {
    if (this.#state === LifecycleStateV1.STOPPED) {
      return Object.freeze({ settled: true, remaining: 0, unacknowledgedLeases: 0 });
    }
    this.#state = LifecycleStateV1.DRAINING;
    this.#signal.abort();
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    const outcome = await drainUntilV1({
      isBusy: () => this.#inFlight > 0,
      timeoutMs: this.#drainTimeoutMs,
    });
    this.#state = LifecycleStateV1.STOPPED;
    return Object.freeze({
      settled: outcome.settled,
      remaining: outcome.remaining,
      // 超时未收口时，租约按原契约过期并由原恢复语义接管。
      unacknowledgedLeases: outcome.settled ? 0 : this.#claimed,
      leaseTimeoutMs: this.#leaseTimeoutMs,
    });
  }
}
