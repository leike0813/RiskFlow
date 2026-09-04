import type { ReactNode } from "react";

import type { ModuleCapabilityV1 } from "@riskflow/contracts/ports";

export type WebNavigationIdV1 =
  "overview" | "projects" | "identification" | "assessment" | "warnings" | "knowledge" | "reviews";

export type WebRouteIdV1 =
  | "session.login"
  | "session.change-password"
  | "overview.root"
  | "projects.root"
  | "identification.root"
  | "assessment.root"
  | "warnings.root"
  | "knowledge.root"
  | "review-audit.root"
  | (string & {});

export type WebPathTemplateV1 =
  | "/login"
  | "/change-password"
  | "/overview"
  | "/projects"
  | "/identification"
  | "/assessment"
  | "/warnings"
  | "/knowledge"
  | "/review-audit"
  | (string & {});

export type WebShellKindV1 = "list" | "detail" | "run" | "governance" | "review" | "custom";
export type WebContextRequirementV1 = "none" | "project" | "spatial" | "process";

export type WebRouteRenderInputV1 = Readonly<{
  route: WebRouteContributionV1;
  params: Readonly<Record<string, string>>;
  pathname: string;
}>;

export type WebRouteRendererV1 = (input: WebRouteRenderInputV1) => ReactNode;

export type WebRouteContributionV1 = Readonly<{
  routeId: WebRouteIdV1;
  path: WebPathTemplateV1;
  title: string;
  section: WebNavigationIdV1 | null;
  shellKind: WebShellKindV1;
  contextRequirement: WebContextRequirementV1;
  requiredViewCapability: ModuleCapabilityV1 | null;
  render: WebRouteRendererV1 | null;
}>;

export type WebRouteMatchV1 = Readonly<{
  kind: "matched";
  route: WebRouteContributionV1;
  params: Readonly<Record<string, string>>;
  pathname: string;
}>;

export type WebRouteResolutionV1 =
  | WebRouteMatchV1
  | Readonly<{ kind: "redirect"; from: "/"; to: "/overview" }>
  | Readonly<{ kind: "not-found"; pathname: string }>;

const route = (value: WebRouteContributionV1): WebRouteContributionV1 => Object.freeze(value);

export const BASE_WEB_ROUTE_CONTRIBUTIONS_V1: readonly WebRouteContributionV1[] = Object.freeze([
  route({
    routeId: "session.login",
    path: "/login",
    title: "登录",
    section: null,
    shellKind: "custom",
    contextRequirement: "none",
    requiredViewCapability: null,
    render: null,
  }),
  route({
    routeId: "session.change-password",
    path: "/change-password",
    title: "修改密码",
    section: null,
    shellKind: "custom",
    contextRequirement: "none",
    requiredViewCapability: null,
    render: null,
  }),
  route({
    routeId: "overview.root",
    path: "/overview",
    title: "风险态势",
    section: "overview",
    shellKind: "detail",
    contextRequirement: "project",
    requiredViewCapability: "projection.query",
    render: null,
  }),
  route({
    routeId: "projects.root",
    path: "/projects",
    title: "工程项目",
    section: "projects",
    shellKind: "list",
    contextRequirement: "project",
    requiredViewCapability: "engineering-data.read",
    render: null,
  }),
  route({
    routeId: "identification.root",
    path: "/identification",
    title: "风险识别",
    section: "identification",
    shellKind: "run",
    contextRequirement: "project",
    requiredViewCapability: "risk-identification.read",
    render: null,
  }),
  route({
    routeId: "assessment.root",
    path: "/assessment",
    title: "风险评估",
    section: "assessment",
    shellKind: "list",
    contextRequirement: "project",
    requiredViewCapability: "risk-assessment.read",
    render: null,
  }),
  route({
    routeId: "warnings.root",
    path: "/warnings",
    title: "预警处置",
    section: "warnings",
    shellKind: "list",
    contextRequirement: "project",
    requiredViewCapability: "warning-response.read",
    render: null,
  }),
  route({
    routeId: "knowledge.root",
    path: "/knowledge",
    title: "知识与规则",
    section: "knowledge",
    shellKind: "governance",
    contextRequirement: "project",
    requiredViewCapability: "knowledge-modeling.read",
    render: null,
  }),
  route({
    routeId: "review-audit.root",
    path: "/review-audit",
    title: "复核与审计",
    section: "reviews",
    shellKind: "review",
    contextRequirement: "project",
    requiredViewCapability: "review-audit.read",
    render: null,
  }),
]);

const knownRouteId = (value: string): boolean =>
  /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(value) && !value.includes("..") && !value.includes("--");

export const isSafeWebPathTemplate = (value: unknown): value is WebPathTemplateV1 => {
  if (
    typeof value !== "string" ||
    value.length < 2 ||
    !value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("%") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("://") ||
    value.includes("//") ||
    value.includes("..")
  )
    return false;
  return value
    .split("/")
    .slice(1)
    .every((segment) =>
      segment.startsWith(":")
        ? /^:[A-Za-z][A-Za-z0-9_]*$/.test(segment)
        : /^[A-Za-z0-9._-]+$/.test(segment),
    );
};

const assertContribution = (value: WebRouteContributionV1): void => {
  if (!knownRouteId(value.routeId)) throw new Error("unsafe web route id");
  if (!isSafeWebPathTemplate(value.path)) throw new Error("unsafe web route path");
  if (typeof value.render !== "function" && value.render !== null)
    throw new Error("web route renderer must be a direct function");
};

export type WebRouteRegistryV1 = Readonly<{
  routes: readonly WebRouteContributionV1[];
  byId: (routeId: string) => WebRouteContributionV1 | undefined;
  byPath: (path: string) => WebRouteContributionV1 | undefined;
}>;

export const createWebRouteRegistry = (
  contributions: readonly WebRouteContributionV1[] = [],
): WebRouteRegistryV1 => {
  const byIdMap = new Map<string, WebRouteContributionV1>();
  const byPathMap = new Map<string, WebRouteContributionV1>();
  for (const item of BASE_WEB_ROUTE_CONTRIBUTIONS_V1) {
    byIdMap.set(item.routeId, item);
    byPathMap.set(item.path, item);
  }
  for (const item of contributions) {
    assertContribution(item);
    const previousById = byIdMap.get(item.routeId);
    const previousByPath = byPathMap.get(item.path);
    if (previousById !== undefined || previousByPath !== undefined) {
      const replacesBase =
        previousById !== undefined &&
        previousByPath !== undefined &&
        BASE_WEB_ROUTE_CONTRIBUTIONS_V1.includes(previousById) &&
        previousById.path === item.path;
      if (!replacesBase) throw new Error("duplicate web route contribution");
      byIdMap.set(item.routeId, Object.freeze(item));
      byPathMap.set(item.path, Object.freeze(item));
      continue;
    }
    byIdMap.set(item.routeId, Object.freeze(item));
    byPathMap.set(item.path, Object.freeze(item));
  }
  const routes = Object.freeze(Array.from(byIdMap.values()));
  return Object.freeze({
    routes,
    byId: (routeId: string) => byIdMap.get(routeId),
    byPath: (path: string) => byPathMap.get(path),
  });
};

export const WEB_ROUTE_REGISTRY_V1 = createWebRouteRegistry();

const pathnameFor = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.includes("://")) return undefined;
  const path = value.split(/[?#]/, 1)[0];
  if (path === undefined || path === "") return "/";
  return isSafeWebPathTemplate(path) || path === "/" ? path : undefined;
};

const matchTemplate = (
  template: string,
  pathname: string,
): Readonly<Record<string, string>> | undefined => {
  const expected = template.split("/").slice(1);
  const actual = pathname.split("/").slice(1);
  if (expected.length !== actual.length) return undefined;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const expectedSegment = expected[index];
    const actualSegment = actual[index];
    if (expectedSegment === undefined || actualSegment === undefined || actualSegment === "")
      return undefined;
    if (expectedSegment.startsWith(":")) {
      params[expectedSegment.slice(1)] = actualSegment;
    } else if (expectedSegment !== actualSegment) {
      return undefined;
    }
  }
  return Object.freeze(params);
};

export const resolveWebRoute = (
  value: unknown,
  registry: WebRouteRegistryV1 = WEB_ROUTE_REGISTRY_V1,
): WebRouteResolutionV1 => {
  const pathname = pathnameFor(value);
  if (pathname === undefined) return { kind: "not-found", pathname: "[invalid]" };
  if (pathname === "/") return { kind: "redirect", from: "/", to: "/overview" };
  const routes = [...registry.routes].sort((left, right) => {
    const leftParams = (left.path.match(/:/g) ?? []).length;
    const rightParams = (right.path.match(/:/g) ?? []).length;
    return leftParams - rightParams;
  });
  for (const item of routes) {
    const params = matchTemplate(item.path, pathname);
    if (params !== undefined)
      return Object.freeze({ kind: "matched", route: item, params, pathname });
  }
  return Object.freeze({ kind: "not-found", pathname });
};

export const routePathFor = (
  routeId: string,
  registry: WebRouteRegistryV1 = WEB_ROUTE_REGISTRY_V1,
): string | undefined => {
  const item = registry.byId(routeId);
  if (item === undefined || item.path.includes(":")) return undefined;
  return item.path;
};

export type WebHistoryAdapterV1 = Readonly<{
  current: () => string;
  navigate: (routeId: string) => boolean;
  replace: (routeId: string) => boolean;
  subscribe: (listener: (resolution: WebRouteResolutionV1) => void) => () => void;
}>;

type HistoryLikeV1 = Pick<History, "pushState" | "replaceState" | "back" | "forward">;
type LocationLikeV1 = Readonly<{ pathname: string }>;

export const createWebHistoryAdapter = (input?: {
  readonly history?: HistoryLikeV1;
  readonly location?: LocationLikeV1;
  readonly registry?: WebRouteRegistryV1;
  readonly addPopStateListener?: (listener: () => void) => () => void;
}): WebHistoryAdapterV1 => {
  const registry = input?.registry ?? WEB_ROUTE_REGISTRY_V1;
  const history = input?.history ?? (typeof window === "undefined" ? undefined : window.history);
  const location =
    input?.location ?? (typeof window === "undefined" ? { pathname: "/" } : window.location);
  const addPopStateListener =
    input?.addPopStateListener ??
    ((listener: () => void) => {
      if (typeof window === "undefined") return () => undefined;
      window.addEventListener("popstate", listener);
      return () => window.removeEventListener("popstate", listener);
    });
  let currentPath = location.pathname;
  const listeners = new Set<(resolution: WebRouteResolutionV1) => void>();
  const notify = (nextPath = location.pathname): void => {
    currentPath = nextPath;
    const resolution = resolveWebRoute(currentPath, registry);
    for (const listener of listeners) listener(resolution);
  };
  const move = (routeId: string, replace: boolean): boolean => {
    const path = routePathFor(routeId, registry);
    if (path === undefined || history === undefined) return false;
    (replace ? history.replaceState : history.pushState).call(history, {}, "", path);
    currentPath = path;
    notify(path);
    return true;
  };
  return Object.freeze({
    current: () => currentPath,
    navigate: (routeId: string) => move(routeId, false),
    replace: (routeId: string) => move(routeId, true),
    subscribe: (listener: (resolution: WebRouteResolutionV1) => void) => {
      listeners.add(listener);
      const removePopState = addPopStateListener(notify);
      return () => {
        listeners.delete(listener);
        removePopState();
      };
    },
  });
};

export const matchWebRoute = resolveWebRoute;
