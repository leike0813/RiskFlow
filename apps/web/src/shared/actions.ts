import type { ModuleCapabilityV1 } from "@riskflow/contracts/ports";

import type { SafeReasonV1 } from "../app/state.js";

/**
 * CH-2 D-09：唯一权限描述。
 *
 * 业务命令用所属领域能力，系统管理用原六项管理动作——管理动作不是新业务能力，
 * 也不该在界面上被显示成某个业务 capability。
 */
export type WebActionPermissionV1 =
  | Readonly<{ kind: "business"; capability: ModuleCapabilityV1 }>
  | Readonly<{ kind: "system"; action: string }>;

export type WebActionAvailabilityV1 =
  | Readonly<{ kind: "checking" }>
  | Readonly<{ kind: "allowed" }>
  /** 已确认无权：按可访问方式说明所需权限，但目标本身不因此泄露。 */
  | Readonly<{ kind: "forbidden"; requiredPermission: WebActionPermissionV1 }>
  /** 权限未知且业务目标不可用：完全不渲染，不用 disabled 透露目标存在。 */
  | Readonly<{ kind: "hidden" }>
  | Readonly<{ kind: "blocked"; reasons: readonly SafeReasonV1[] }>
  | Readonly<{ kind: "unavailable"; reason: "route-missing" | "context-incomplete" }>;

export type ActionPermissionStateV1 = "unknown" | "allowed" | "denied" | "hidden";
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
  requiredPermission: WebActionPermissionV1;
}): WebActionAvailabilityV1 => {
  // hidden 优先：调用方已声明目标不可披露时不留任何痕迹，也不用 disabled 透露存在。
  if (input.permission === "hidden") return { kind: "hidden" };
  if (input.permission === "denied")
    return { kind: "forbidden", requiredPermission: input.requiredPermission };
  if (
    input.permission === "unknown" ||
    input.business.kind === "unknown" ||
    input.route === "unknown" ||
    input.contextComplete === "unknown"
  )
    return { kind: "checking" };
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

export const permissionLabel = (permission: WebActionPermissionV1): string =>
  permission.kind === "business" ? permission.capability : permission.action;

export const actionDisabledReason = (availability: WebActionAvailabilityV1): string | undefined => {
  if (availability.kind === "forbidden")
    return `requires:${permissionLabel(availability.requiredPermission)}`;
  if (availability.kind === "blocked") return availability.reasons[0]?.code ?? "business-blocked";
  if (availability.kind === "unavailable") return availability.reason;
  if (availability.kind === "checking") return "checking";
  return undefined;
};

/**
 * 业务读面返回的动作可用性到统一可用性的唯一映射。
 *
 * 服务端只给出"允许／拒绝／本域未就绪"三种事实；页面不另判一套，
 * 所需权限描述由调用方声明（业务能力位或系统管理动作）。
 */
export const availabilityFromBusiness = (
  availability: "allowed" | "denied" | "business-unavailable" | "hidden" | null | undefined,
  requiredPermission: WebActionPermissionV1,
): WebActionAvailabilityV1 =>
  availability === "allowed"
    ? { kind: "allowed" }
    : availability === "denied"
      ? { kind: "forbidden", requiredPermission }
      : availability === "hidden"
        ? { kind: "hidden" }
        : { kind: "unavailable", reason: "context-incomplete" };
