import type { ModuleCapabilityV1 } from "@riskflow/contracts/ports";

import type { WebNavigationIdV1, WebRouteIdV1 } from "../app/routes.js";

export type NavigationPermissionStateV1 = "unknown" | "allowed" | "denied";

export type WebNavigationItemV1 = Readonly<{
  id: WebNavigationIdV1;
  label: string;
  routeId: WebRouteIdV1;
  path: string;
  requiredCapability: ModuleCapabilityV1;
}>;

export const WEB_NAVIGATION_V1: readonly WebNavigationItemV1[] = Object.freeze([
  Object.freeze({
    id: "overview" as const,
    label: "风险态势",
    routeId: "overview.root" as const,
    path: "/overview",
    requiredCapability: "projection.query" as const,
  }),
  Object.freeze({
    id: "projects" as const,
    label: "工程项目",
    routeId: "projects.root" as const,
    path: "/projects",
    requiredCapability: "engineering-data.read" as const,
  }),
  Object.freeze({
    id: "identification" as const,
    label: "风险识别",
    routeId: "identification.root" as const,
    path: "/identification",
    requiredCapability: "risk-identification.read" as const,
  }),
  Object.freeze({
    id: "assessment" as const,
    label: "风险评估",
    routeId: "assessment.root" as const,
    path: "/assessment",
    requiredCapability: "risk-assessment.read" as const,
  }),
  Object.freeze({
    id: "warnings" as const,
    label: "预警处置",
    routeId: "warnings.root" as const,
    path: "/warnings",
    requiredCapability: "warning-response.read" as const,
  }),
  Object.freeze({
    id: "knowledge" as const,
    label: "知识与规则",
    routeId: "knowledge.root" as const,
    path: "/knowledge",
    requiredCapability: "knowledge-modeling.read" as const,
  }),
  Object.freeze({
    id: "reviews" as const,
    label: "复核与审计",
    routeId: "review-audit.root" as const,
    path: "/review-audit",
    requiredCapability: "review-audit.read" as const,
  }),
]);

export const navigationForRoute = (routeId: string): WebNavigationItemV1 | undefined =>
  WEB_NAVIGATION_V1.find((item) => item.routeId === routeId);

export const navigationPermission = (
  item: WebNavigationItemV1,
  capabilities: readonly ModuleCapabilityV1[] | undefined,
): NavigationPermissionStateV1 => {
  if (capabilities === undefined) return "unknown";
  return capabilities.includes(item.requiredCapability) ? "allowed" : "denied";
};

export const hasExactlySevenBusinessNavigation = (): boolean => WEB_NAVIGATION_V1.length === 7;
