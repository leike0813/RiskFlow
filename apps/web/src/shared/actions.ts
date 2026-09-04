import type { ModuleCapabilityV1 } from "@riskflow/contracts/ports";

import type { SafeReasonV1 } from "../app/state.js";

export type WebActionAvailabilityV1 =
  | Readonly<{ kind: "checking" }>
  | Readonly<{ kind: "allowed" }>
  | Readonly<{ kind: "forbidden"; requiredCapability: ModuleCapabilityV1 }>
  | Readonly<{ kind: "blocked"; reasons: readonly SafeReasonV1[] }>
  | Readonly<{ kind: "unavailable"; reason: "route-missing" | "context-incomplete" }>;

export type ActionPermissionStateV1 = "unknown" | "allowed" | "denied";
export type ActionRouteStateV1 = "unknown" | "available" | "missing";
export type ActionBusinessStateV1 =
  | Readonly<{ kind: "unknown" }>
  | Readonly<{ kind: "allowed" }>
  | Readonly<{ kind: "blocked"; reasons: readonly SafeReasonV1[] }>;

export type WebActionV1 = Readonly<{
  actionId: string;
  label: string;
  availability: WebActionAvailabilityV1;
  impact: "standard" | "high";
  invoke: () => void;
}>;

export const deriveActionAvailability = (input: {
  permission: ActionPermissionStateV1;
  business: ActionBusinessStateV1;
  route: ActionRouteStateV1;
  contextComplete: boolean | "unknown";
  requiredCapability: ModuleCapabilityV1;
}): WebActionAvailabilityV1 => {
  if (
    input.permission === "unknown" ||
    input.business.kind === "unknown" ||
    input.route === "unknown" ||
    input.contextComplete === "unknown"
  )
    return { kind: "checking" };
  if (input.permission === "denied")
    return { kind: "forbidden", requiredCapability: input.requiredCapability };
  if (input.business.kind === "blocked")
    return { kind: "blocked", reasons: input.business.reasons };
  if (input.route === "missing") return { kind: "unavailable", reason: "route-missing" };
  if (!input.contextComplete) return { kind: "unavailable", reason: "context-incomplete" };
  return { kind: "allowed" };
};

export const isActionInvocable = (action: Pick<WebActionV1, "availability">): boolean =>
  action.availability.kind === "allowed";

export const invokeWebAction = (action: WebActionV1): boolean => {
  if (!isActionInvocable(action)) return false;
  action.invoke();
  return true;
};

export const createWebAction = (input: WebActionV1): WebActionV1 => Object.freeze(input);

export const actionDisabledReason = (availability: WebActionAvailabilityV1): string | undefined => {
  if (availability.kind === "forbidden") return `requires:${availability.requiredCapability}`;
  if (availability.kind === "blocked") return availability.reasons[0]?.code ?? "business-blocked";
  if (availability.kind === "unavailable") return availability.reason;
  if (availability.kind === "checking") return "checking";
  return undefined;
};
