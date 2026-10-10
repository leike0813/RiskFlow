import type { ContractReferenceV1 } from "@riskflow/contracts/ports";
import type { VersionReference as VersionReferenceV1 } from "@riskflow/contracts/common";
import type { C37SystemOperationIdV1 } from "../api/http.js";

import type { C09OperationIdV1 } from "../api/http.js";
import type { SafeHttpErrorV1 } from "../api/errors.js";
import type { WebContextV1 } from "../app/state.js";
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
    }>
  | Readonly<{
      kind: "system";
      /** 管理上下文的版本引用；系统命令没有工程上下文可借。 */
      administrationContextRef: VersionReferenceV1;
      sessionRevision: number;
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
    }>;

export type CommandConfirmationPlanV1<TRequest> = Readonly<{
  confirmationId: string;
  operationId: C09OperationIdV1 | C37SystemOperationIdV1;
  scope: CommandConfirmationScopeV1;
  projectId: string;
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

const freezePlan = <TRequest>(
  plan: CommandConfirmationPlanV1<TRequest>,
): CommandConfirmationPlanV1<TRequest> => {
  // 深冻结请求：确认打开后载荷不可被调用方改写，重试复用同一份。
  Object.freeze(plan.scope);
  Object.freeze(plan.request);
  Object.freeze(plan.targets);
  Object.freeze(plan.inputVersions);
  Object.freeze(plan.expectedFacts);
  Object.freeze(plan.externalEffects);
  return Object.freeze(plan);
};

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
        plan: freezePlan(plan),
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
  if (result.kind === "succeeded") return Object.freeze(result);
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
 * 工程命令按 projectId + context revision 判定；系统命令没有工程上下文，
 * 只能按管理 context ref 与会话修订判定，不能借用工程上下文做判断。
 */
export const invalidateConfirmation = <TRequest>(
  state: ConfirmationStateV1<TRequest>,
  context: WebContextV1,
  currentScope: {
    readonly project: Pick<WebContextV1, "revision" | "projectId"> | undefined;
    readonly system:
      | {
          readonly administrationContextRef: VersionReferenceV1;
          readonly sessionRevision: number;
        }
      | undefined;
  },
): ConfirmationStateV1<TRequest> => {
  if (state.kind !== "reviewing" && state.kind !== "submitting") return state;
  const scope = state.plan.scope;
  if (scope.kind === "project") {
    if (currentScope.project === undefined) return { kind: "closed" };
    return context.revision === scope.contextRevision &&
      currentScope.project.projectId === scope.projectId
      ? state
      : { kind: "closed" };
  }
  if (currentScope.system === undefined) return { kind: "closed" };
  const ref = currentScope.system.administrationContextRef;
  return ref.entityId === scope.administrationContextRef.entityId &&
    ref.versionId === scope.administrationContextRef.versionId &&
    currentScope.system.sessionRevision === scope.sessionRevision
    ? state
    : { kind: "closed" };
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
  invalidate: (
    context: WebContextV1,
    currentScope: {
      readonly project: Pick<WebContextV1, "revision" | "projectId"> | undefined;
      readonly system:
        | {
            readonly administrationContextRef: VersionReferenceV1;
            readonly sessionRevision: number;
          }
        | undefined;
    },
  ) => void;
}>;

export const createConfirmationController = <TRequest>(): ConfirmationControllerV1<TRequest> => {
  let state: ConfirmationStateV1<TRequest> = { kind: "closed" };
  let submitting = false;
  return Object.freeze({
    getState: () => state,
    open: (plan: CommandConfirmationPlanV1<TRequest>, availability: WebActionAvailabilityV1) => {
      const next = openConfirmation(plan, availability);
      if (next.kind === "closed") return false;
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
      if (submitting) return false;
      const next = beginConfirmationSubmit(state);
      if (next.kind !== "submitting") return false;
      submitting = true;
      state = next;
      try {
        state = finishConfirmation(state, {
          kind: "succeeded",
          result: await submit(next.plan),
        });
        return state.kind === "succeeded";
      } catch (error) {
        state = finishConfirmation(state, {
          kind: "failed",
          error: fallbackError(error),
        });
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
      state = {
        kind: "reviewing",
        plan,
        acknowledged: true,
      };
      return (async () => {
        const next = beginConfirmationSubmit(state);
        if (next.kind !== "submitting") return false;
        submitting = true;
        state = next;
        try {
          state = finishConfirmation(state, { kind: "succeeded", result: await submit(plan) });
          return state.kind === "succeeded";
        } catch (error) {
          state = finishConfirmation(state, { kind: "failed", error: fallbackError(error) });
          return false;
        } finally {
          submitting = false;
        }
      })();
    },
    cancel: () => {
      if (state.kind !== "submitting") state = { kind: "closed" };
    },
    invalidate: (context, currentScope) => {
      state = invalidateConfirmation(state, context, currentScope);
    },
  });
};
