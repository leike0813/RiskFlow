/**
 * C37 D-20/D-07：系统运维观测。
 *
 * C35 健康/模型查询仍由当前系统管理员授权，并保持既有条目与时间边界；
 * 本模块只提供**有界**的真实探针：API、Worker、模型、数据库四个组件，
 * 每项带 AbortSignal 与整体截止时间。
 *
 * 不变量：
 * - 存活与就绪分离：进程存在不等于业务接线完整；
 * - 依赖不可用、接线不完整或正在停止写入时就绪失败；
 * - 不使用 unknown/test 常量假成功，也不把超时解释为正常；
 * - 只回报稳定状态、原因码与计数，不含正文、秘密、URL 或宿主路径。
 */

export const OBSERVABILITY_COMPONENT_IDS_V1 = Object.freeze(["api", "worker", "model", "database"]);

export type ObservabilityComponentIdV1 = (typeof OBSERVABILITY_COMPONENT_IDS_V1)[number];

/** 单个探针的输入；signal 允许宿主在整体截止前取消。 */
export interface ObservabilityProbeInputV1 {
  readonly componentId: ObservabilityComponentIdV1;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

/** 探针返回值；只有 ok 为 true 才计为可用。 */
export interface ObservabilityProbeResultV1 {
  readonly ok: boolean;
  readonly reasonCode?: string;
  readonly detail?: unknown;
}

export type ObservabilityProbeV1 = (
  input: ObservabilityProbeInputV1,
) => Promise<ObservabilityProbeResultV1 | undefined>;

export type ObservabilityProbesV1 = Readonly<
  Partial<Record<ObservabilityComponentIdV1, ObservabilityProbeV1>>
>;

/** 单个组件的观察结果；只含稳定状态、原因码与计数。 */
export interface ObservabilityComponentReportV1 {
  readonly componentId: ObservabilityComponentIdV1;
  readonly status: "ready" | "unavailable";
  readonly reasonCode: string;
  readonly observedAt: string;
}

export interface ObservabilityReportV1 {
  readonly observedAt: string;
  readonly ready: boolean;
  readonly components: readonly ObservabilityComponentReportV1[];
  readonly unavailableCount: number;
}

export class ObservabilityProbeError extends Error {
  readonly componentId: ObservabilityComponentIdV1;
  readonly reasonCode: string;

  constructor(componentId: ObservabilityComponentIdV1, reasonCode: string) {
    super(`probe failed for ${componentId}: ${reasonCode}`);
    this.name = "ObservabilityProbeError";
    this.componentId = componentId;
    this.reasonCode = reasonCode;
  }
}

const DEFAULT_TIMEOUT_MS = 2_000;

/**
 * 运行四项组件探针并汇总。
 *
 * 任一组件不可用都会让整体 `ready` 为 false：不得用平均或多数掩盖单项失败。
 * 探针在截止前未返回时按不可用收口，且不把内部错误细节写进报告。
 */
export const collectSystemObservabilityV1 = async ({
  probes,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
  now = () => new Date(),
}: {
  readonly probes: ObservabilityProbesV1;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
}): Promise<ObservabilityReportV1> => {
  const observedAt = now().toISOString();
  const entries: ObservabilityComponentReportV1[] = [];
  for (const componentId of OBSERVABILITY_COMPONENT_IDS_V1) {
    const probe = probes[componentId];
    if (probe === undefined) {
      entries.push(
        Object.freeze({
          componentId,
          status: "unavailable" as const,
          reasonCode: "COMPONENT_NOT_CONFIGURED",
          observedAt,
        }),
      );
      continue;
    }
    entries.push(await runSingleProbe(probe, componentId, timeoutMs, signal, observedAt));
  }
  const ready = entries.every((entry) => entry.status === "ready");
  return Object.freeze({
    observedAt,
    ready,
    components: Object.freeze(entries),
    unavailableCount: entries.filter((entry) => entry.status !== "ready").length,
  });
};

const runSingleProbe = async (
  probe: ObservabilityProbeV1,
  componentId: ObservabilityComponentIdV1,
  timeoutMs: number,
  outerSignal: AbortSignal | undefined,
  observedAt: string,
): Promise<ObservabilityComponentReportV1> => {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  outerSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await probe({ componentId, timeoutMs, signal: controller.signal });
    // 在 abort 之后才返回的探针一律按超时处理，不当作成功。
    const aborted = controller.signal.aborted || outerSignal?.aborted === true;
    if (aborted) {
      return Object.freeze({
        componentId,
        status: "unavailable" as const,
        reasonCode: "PROBE_TIMEOUT_OR_CANCELLED",
        observedAt,
      });
    }
    if (result === undefined || result === null || result.ok !== true) {
      return Object.freeze({
        componentId,
        status: "unavailable" as const,
        reasonCode: result?.reasonCode ?? "PROBE_FAILED",
        observedAt,
      });
    }
    return Object.freeze({
      componentId,
      status: "ready" as const,
      reasonCode: result.reasonCode ?? "PROBE_OK",
      observedAt,
    });
  } catch {
    // 探针抛错只保留稳定原因码，不泄露连接串、路径或堆栈。
    return Object.freeze({
      componentId,
      status: "unavailable" as const,
      reasonCode: "PROBE_THREW",
      observedAt,
    });
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", forwardAbort);
  }
};

/** 把 core collector 的报告折算为运维观察项；不改变其既有结论。 */
export const observabilityFromHealthReportV1 = (
  report: Readonly<Record<string, { ok?: boolean }>> | undefined | null,
  { observedAt }: { observedAt?: string } = {},
) => {
  if (report === undefined || report === null) {
    return Object.freeze({
      status: "unavailable",
      reasonCode: "HEALTH_REPORT_MISSING",
      observedAt: observedAt ?? new Date().toISOString(),
    });
  }
  const entries = Object.entries(report);
  const ready = entries.length > 0 && entries.every(([, item]) => item?.ok === true);
  return Object.freeze({
    status: ready ? "ready" : "unavailable",
    reasonCode: ready ? "HEALTH_REPORT_OK" : "HEALTH_REPORT_DEGRADED",
    observedAt: observedAt ?? new Date().toISOString(),
    checkedCount: entries.length,
    failedCount: entries.filter(([, item]) => item?.ok !== true).length,
  });
};

/**
 * 容量与资源预算登记。
 *
 * 只记录批准配置中的上限与最近观测值；不据此自行扩容或换模型。
 */
export const readCapacityBudgetV1 = (
  budget:
    | {
        readonly workerPollMs: number;
        readonly workerMaxConcurrency: number;
        readonly healthProbeTimeoutMs: number;
        readonly drainTimeoutMs: number;
      }
    | undefined
    | null,
) => {
  if (budget === undefined || budget === null) {
    return Object.freeze({ status: "unavailable", reasonCode: "CAPACITY_BUDGET_MISSING" });
  }
  return Object.freeze({
    status: "ready",
    reasonCode: "CAPACITY_BUDGET_PRESENT",
    workerPollMs: budget.workerPollMs,
    workerMaxConcurrency: budget.workerMaxConcurrency,
    healthProbeTimeoutMs: budget.healthProbeTimeoutMs,
    drainTimeoutMs: budget.drainTimeoutMs,
  });
};
