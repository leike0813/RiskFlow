import type { ContractReferenceV1 } from "@riskflow/contracts/ports";

import type { C09OperationIdV1 } from "../api/http.js";
import type { SafeHttpErrorV1 } from "../api/errors.js";
import type { WebContextV1 } from "../app/state.js";
import type { WebActionAvailabilityV1 } from "./actions.js";

export type CommandConfirmationPlanV1<TRequest> = Readonly<{
  confirmationId: string;
  operationId: C09OperationIdV1;
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
  | Readonly<{ kind: "succeeded"; resultRef: ContractReferenceV1 }>;

export const CLOSED_CONFIRMATION_STATE_V1: ConfirmationStateV1<never> = Object.freeze({
  kind: "closed",
});

const freezePlan = <TRequest>(
  plan: CommandConfirmationPlanV1<TRequest>,
): CommandConfirmationPlanV1<TRequest> => {
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
    | { readonly kind: "succeeded"; readonly resultRef: ContractReferenceV1 }
    | {
        readonly kind: "failed";
        readonly error: SafeHttpErrorV1;
      },
): ConfirmationStateV1<TRequest> => {
  if (result.kind === "succeeded") return Object.freeze(result);
  if (isConfirmationInvalidationError(result.error)) return { kind: "closed" };
  if (state.kind !== "submitting" && state.kind !== "retryable-failure") return state;
  return result.error.retryable
    ? Object.freeze({ kind: "retryable-failure", plan: state.plan, error: result.error })
    : Object.freeze({ kind: "terminal-failure", error: result.error });
};

export const invalidateConfirmation = <TRequest>(
  state: ConfirmationStateV1<TRequest>,
  context: WebContextV1,
  planContext: Pick<WebContextV1, "revision" | "projectId"> | undefined,
): ConfirmationStateV1<TRequest> => {
  if (planContext === undefined) return state;
  if (context.revision !== planContext.revision || context.projectId !== planContext.projectId)
    return { kind: "closed" };
  return state;
};

export type ConfirmationControllerV1<TRequest> = Readonly<{
  getState: () => ConfirmationStateV1<TRequest>;
  open: (
    plan: CommandConfirmationPlanV1<TRequest>,
    availability: WebActionAvailabilityV1,
  ) => boolean;
  acknowledge: () => boolean;
  confirm: (
    submit: (plan: CommandConfirmationPlanV1<TRequest>) => Promise<ContractReferenceV1>,
  ) => Promise<boolean>;
  retry: (
    submit: (plan: CommandConfirmationPlanV1<TRequest>) => Promise<ContractReferenceV1>,
  ) => Promise<boolean>;
  cancel: () => void;
  invalidate: () => void;
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
      submit: (plan: CommandConfirmationPlanV1<TRequest>) => Promise<ContractReferenceV1>,
    ) => {
      if (submitting) return false;
      const next = beginConfirmationSubmit(state);
      if (next.kind !== "submitting") return false;
      submitting = true;
      state = next;
      try {
        state = finishConfirmation(state, {
          kind: "succeeded",
          resultRef: await submit(next.plan),
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
      submit: (plan: CommandConfirmationPlanV1<TRequest>) => Promise<ContractReferenceV1>,
    ) => {
      if (state.kind !== "retryable-failure") return false;
      if (submitting) return false;
      const plan = state.plan;
      state = {
        kind: "reviewing",
        plan,
        acknowledged: plan.impact !== "high",
      };
      return (async () => {
        const next = beginConfirmationSubmit(state);
        if (next.kind !== "submitting") return false;
        submitting = true;
        state = next;
        try {
          state = finishConfirmation(state, { kind: "succeeded", resultRef: await submit(plan) });
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
    invalidate: () => {
      if (state.kind !== "closed") state = { kind: "closed" };
    },
  });
};
