import type { ContractReferenceV1 } from "@riskflow/contracts/ports";
import type { VersionReference as VersionReferenceV1 } from "@riskflow/contracts/common";
import type { C37SystemOperationIdV1 } from "../api/http.js";

import type { C09OperationIdV1 } from "../api/http.js";
import type { SafeHttpErrorV1 } from "../api/errors.js";
import type { WebActionAvailabilityV1 } from "./actions.js";

/**
 * C37 D-17：确认作用域判别。
 *
 * - `project`：工程业务命令，携带 projectId 与 context revision；
 * - `system`：系统管理/运维命令，没有工程上下文，改用管理 context ref 与会话修订。
 *
 * 判别让「上下文切换使确认失效」只作用于工程命令，系统命令不会因为换工程而被误清。
 */
export type CommandConfirmationScopeV1 =
  | Readonly<{
      kind: "project";
      projectId: string;
      contextRevision: number;
      sessionRef: VersionReferenceV1;
    }>
  | Readonly<{
      kind: "system";
      /** 真实账号引用；系统命令没有工程上下文，也不伪造工程。 */
      accountRef: VersionReferenceV1;
      sessionRef: VersionReferenceV1;
    }>;

/**
 * 成功结果既可能是领域引用，也可能是管理命令回执；不伪造领域 resultRef。
 *
 * 管理回执按其公开结构（成功类别 + 安全引用）判断，不在此复制 C06 的完整 Schema：
 * 页面只据 kind 决定刷新方式，具体校验仍由服务端与原契约负责。
 */
export type CommandConfirmationResultV1 =
  | Readonly<{ kind: "reference"; resultRef: ContractReferenceV1 }>
  | Readonly<{
      kind: "command-result";
      result: Readonly<{
        kind: string;
        resultRef?: ContractReferenceV1;
        previousVersionId?: string;
      }>;
    }>
  /**
   * 批量部分失败：逐 commandId 保留原成功引用或安全错误。
   *
   * 只在本地使用，不作为 HTTP DTO，也不与服务端事务合并：每项仍按原幂等与事务执行，
   * 重试只重发失败项的原信封，不重造已成功项的身份。
   */
  | Readonly<{
      kind: "batch-result";
      items: readonly Readonly<{
        commandId: string;
        outcome:
          | Readonly<{ kind: "succeeded"; result: CommandConfirmationResultV1 }>
          | Readonly<{ kind: "failed"; error: SafeHttpErrorV1 }>;
      }>[];
    }>;

export type CommandConfirmationPlanV1<TRequest> = Readonly<{
  confirmationId: string;
  operationId: C09OperationIdV1 | C37SystemOperationIdV1;
  /** 作用域即工程归属的唯一事实源，计划上不再另设 projectId 字段。 */
  scope: CommandConfirmationScopeV1;
  targets: readonly ContractReferenceV1[];
  inputVersions: readonly { entityId: string; versionId: string }[];
  expectedFacts: readonly string[];
  externalEffects: readonly string[];
  impact: "standard" | "high";
  commandId: string;
  idempotencyKey: string;
  request: TRequest;
}>;

export type ConfirmationStateV1<TRequest> =
  | Readonly<{ kind: "closed" }>
  | Readonly<{
      kind: "reviewing";
      plan: CommandConfirmationPlanV1<TRequest>;
      acknowledged: boolean;
    }>
  | Readonly<{ kind: "submitting"; plan: CommandConfirmationPlanV1<TRequest> }>
  | Readonly<{
      kind: "retryable-failure";
      plan: CommandConfirmationPlanV1<TRequest>;
      error: SafeHttpErrorV1;
    }>
  | Readonly<{ kind: "terminal-failure"; error: SafeHttpErrorV1 }>
  | Readonly<{ kind: "succeeded"; result: CommandConfirmationResultV1 }>;

export const CLOSED_CONFIRMATION_STATE_V1: ConfirmationStateV1<never> = Object.freeze({
  kind: "closed",
});

/**
 * CH-2 D-09：递归冻结 plain JSON 快照。
 *
 * 打开确认时对整个计划做一次 `structuredClone` 拍快照，再逐层冻结：浅冻结会让嵌套的
 * request 保持可变，调用方改一份源对象就能改掉已确认的载荷。
 */
const deepFreeze = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested, seen);
  return Object.freeze(value);
};

const snapshotPlan = <TRequest>(
  plan: CommandConfirmationPlanV1<TRequest>,
): CommandConfirmationPlanV1<TRequest> =>
  deepFreeze(
    structuredClone({ ...plan, request: plan.request }) as CommandConfirmationPlanV1<TRequest>,
  );

export const isHighImpactPlan = <TRequest>(plan: CommandConfirmationPlanV1<TRequest>): boolean =>
  plan.impact === "high";

export const canOpenConfirmation = (availability: WebActionAvailabilityV1): boolean =>
  availability.kind === "allowed";

export const openConfirmation = <TRequest>(
  plan: CommandConfirmationPlanV1<TRequest>,
  availability: WebActionAvailabilityV1,
): ConfirmationStateV1<TRequest> =>
  canOpenConfirmation(availability)
    ? Object.freeze({
        kind: "reviewing" as const,
        plan: snapshotPlan(plan),
        acknowledged: plan.impact !== "high",
      })
    : { kind: "closed" };

export const acknowledgeConfirmation = <TRequest>(
  state: ConfirmationStateV1<TRequest>,
  acknowledged = true,
): ConfirmationStateV1<TRequest> =>
  state.kind === "reviewing" && state.plan.impact === "high"
    ? Object.freeze({ ...state, acknowledged })
    : state;

export const beginConfirmationSubmit = <TRequest>(
  state: ConfirmationStateV1<TRequest>,
): ConfirmationStateV1<TRequest> => {
  if (state.kind !== "reviewing") return state;
  if (state.plan.impact === "high" && !state.acknowledged) return state;
  return Object.freeze({ kind: "submitting", plan: state.plan });
};

const isSafeHttpError = (value: unknown): value is SafeHttpErrorV1 => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === "1" &&
    typeof record.requestId === "string" &&
    typeof record.code === "string" &&
    typeof record.retryable === "boolean" &&
    typeof record.occurredAt === "string" &&
    Array.isArray(record.references)
  );
};

const fallbackError = (error: unknown): SafeHttpErrorV1 => {
  if (isSafeHttpError(error)) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    isSafeHttpError(error.error)
  )
    return error.error;
  return {
    schemaVersion: "1",
    requestId: "web-confirmation",
    code: "TERMINAL_FAILURE",
    retryable: false,
    occurredAt: new Date().toISOString(),
    references: [],
  };
};

export const isConfirmationInvalidationError = (error: SafeHttpErrorV1): boolean =>
  error.code === "STALE_VERSION" || error.code === "IDEMPOTENCY_CONFLICT";

export const finishConfirmation = <TRequest>(
  state: ConfirmationStateV1<TRequest>,
  result:
    | { readonly kind: "succeeded"; readonly result: CommandConfirmationResultV1 }
    | {
        readonly kind: "failed";
        readonly error: SafeHttpErrorV1;
      },
): ConfirmationStateV1<TRequest> => {
  if (result.kind === "succeeded") {
    if (result.result.kind === "batch-result") {
      const failures = result.result.items.flatMap((item) =>
        item.outcome.kind === "failed" ? [item.outcome.error] : [],
      );
      const error =
        failures.find(isConfirmationInvalidationError) ??
        failures.find((failure) => failure.retryable) ??
        failures[0];
      if (error !== undefined) return finishConfirmation(state, { kind: "failed", error });
    }
    return Object.freeze(result);
  }
  if (isConfirmationInvalidationError(result.error))
    return Object.freeze({ kind: "terminal-failure", error: result.error });
  if (state.kind !== "submitting" && state.kind !== "retryable-failure") return state;
  return result.error.retryable
    ? Object.freeze({ kind: "retryable-failure", plan: state.plan, error: result.error })
    : Object.freeze({ kind: "terminal-failure", error: result.error });
};

/**
 * 上下文切换、撤权或版本过期时清除计划。
 *
 * CH-2 D-09：只比较判别作用域本身，不再重复接收 context 与 project 摘要。
 * retryable-failure 同样参加失效——旧计划在上下文已变时不得继续重试。
 */
export const invalidateConfirmation = <TRequest>(
  state: ConfirmationStateV1<TRequest>,
  currentScope: CommandConfirmationScopeV1 | undefined,
): ConfirmationStateV1<TRequest> => {
  if (
    state.kind !== "reviewing" &&
    state.kind !== "submitting" &&
    state.kind !== "retryable-failure"
  )
    return state;
  const scope = state.plan.scope;
  if (currentScope === undefined) return { kind: "closed" };
  if (scope.kind !== currentScope.kind) return { kind: "closed" };
  if (scope.kind === "project" && currentScope.kind === "project") {
    return scope.projectId === currentScope.projectId &&
      scope.contextRevision === currentScope.contextRevision &&
      scope.sessionRef.entityId === currentScope.sessionRef.entityId &&
      scope.sessionRef.versionId === currentScope.sessionRef.versionId
      ? state
      : { kind: "closed" };
  }
  if (scope.kind === "system" && currentScope.kind === "system") {
    return scope.accountRef.entityId === currentScope.accountRef.entityId &&
      scope.accountRef.versionId === currentScope.accountRef.versionId &&
      scope.sessionRef.entityId === currentScope.sessionRef.entityId &&
      scope.sessionRef.versionId === currentScope.sessionRef.versionId
      ? state
      : { kind: "closed" };
  }
  return { kind: "closed" };
};

export type ConfirmationControllerV1<TRequest> = Readonly<{
  getState: () => ConfirmationStateV1<TRequest>;
  open: (
    plan: CommandConfirmationPlanV1<TRequest>,
    availability: WebActionAvailabilityV1,
  ) => boolean;
  acknowledge: () => boolean;
  confirm: (
    submit: (plan: CommandConfirmationPlanV1<TRequest>) => Promise<CommandConfirmationResultV1>,
  ) => Promise<boolean>;
  retry: (
    submit: (plan: CommandConfirmationPlanV1<TRequest>) => Promise<CommandConfirmationResultV1>,
  ) => Promise<boolean>;
  cancel: () => void;
  invalidate: (currentScope: CommandConfirmationScopeV1 | undefined) => void;
}>;

export const createConfirmationController = <TRequest>(): ConfirmationControllerV1<TRequest> => {
  let state: ConfirmationStateV1<TRequest> = { kind: "closed" };
  let submitting = false;
  // 代次：打开计划、取消、失效与卸载都推进它，迟到的异步完成按代次校验后才写回。
  let generation = 0;
  return Object.freeze({
    getState: () => state,
    open: (plan: CommandConfirmationPlanV1<TRequest>, availability: WebActionAvailabilityV1) => {
      const next = openConfirmation(plan, availability);
      if (next.kind === "closed") return false;
      generation += 1;
      state = next;
      return true;
    },
    acknowledge: () => {
      if (state.kind !== "reviewing" || state.plan.impact !== "high") return false;
      state = acknowledgeConfirmation(state);
      return true;
    },
    confirm: async (
      submit: (plan: CommandConfirmationPlanV1<TRequest>) => Promise<CommandConfirmationResultV1>,
    ) => {
      // 提交中双击与重试共用单在途：旧请求仍在途时不交错发第二条。
      if (submitting) return false;
      const next = beginConfirmationSubmit(state);
      if (next.kind !== "submitting") return false;
      const token = generation;
      submitting = true;
      state = next;
      try {
        const result = await submit(next.plan);
        // 取消、失效或换计划后到达的成功不得覆盖后来状态。
        if (token !== generation) return false;
        state = finishConfirmation(state, { kind: "succeeded", result });
        return state.kind === "succeeded";
      } catch (error) {
        if (token !== generation) return false;
        state = finishConfirmation(state, { kind: "failed", error: fallbackError(error) });
        return false;
      } finally {
        submitting = false;
      }
    },
    retry: async (
      submit: (plan: CommandConfirmationPlanV1<TRequest>) => Promise<CommandConfirmationResultV1>,
    ) => {
      if (state.kind !== "retryable-failure") return false;
      if (submitting) return false;
      const plan = state.plan;
      // 重试复用同一身份与同一份冻结载荷；响应丢失只重发原字节请求。
      state = { kind: "reviewing", plan, acknowledged: true };
      const next = beginConfirmationSubmit(state);
      if (next.kind !== "submitting") return false;
      const token = generation;
      submitting = true;
      state = next;
      try {
        const result = await submit(plan);
        if (token !== generation) return false;
        state = finishConfirmation(state, { kind: "succeeded", result });
        return state.kind === "succeeded";
      } catch (error) {
        if (token !== generation) return false;
        state = finishConfirmation(state, { kind: "failed", error: fallbackError(error) });
        return false;
      } finally {
        submitting = false;
      }
    },
    cancel: () => {
      // 已送达的事实不能被 UI 宣称撤销：提交中只放行收尾，不改写后端事实。
      if (state.kind === "submitting") return;
      generation += 1;
      state = { kind: "closed" };
    },
    invalidate: (currentScope) => {
      const next = invalidateConfirmation(state, currentScope);
      if (next.kind === "closed" && state.kind !== "closed") generation += 1;
      state = next;
    },
  });
};
