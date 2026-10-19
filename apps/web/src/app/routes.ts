import type { ReactNode } from "react";

import type { ModuleCapabilityV1 } from "@riskflow/contracts/ports";

import type { PageRegionDescriptorV1 } from "../shared/page-shells/index.js";

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
  regions: readonly PageRegionDescriptorV1[];
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
  | Readonly<{ kind: "redirect"; from: string; to: string }>
  | Readonly<{ kind: "not-found"; pathname: string }>;

const route = (value: WebRouteContributionV1): WebRouteContributionV1 => Object.freeze(value);

export const BASE_WEB_ROUTE_CONTRIBUTIONS_V1: readonly WebRouteContributionV1[] = Object.freeze([
  route({
    routeId: "session.login",
    path: "/login",
    title: "登录",
    section: null,
    regions: [{ key: "main", kind: "form" }],
    contextRequirement: "none",
    requiredViewCapability: null,
    render: null,
  }),
  route({
    routeId: "session.change-password",
    path: "/change-password",
    title: "修改密码",
    section: null,
    regions: [{ key: "main", kind: "form" }],
    contextRequirement: "none",
    requiredViewCapability: null,
    render: null,
  }),
  route({
    routeId: "overview.root",
    path: "/overview",
    title: "风险态势",
    section: "overview",
    regions: [{ key: "main", kind: "detail" }],
    contextRequirement: "project",
    requiredViewCapability: "projection.query",
    render: null,
  }),
  route({
    routeId: "projects.root",
    path: "/projects",
    title: "工程项目",
    section: "projects",
    regions: [{ key: "main", kind: "list" }],
    contextRequirement: "project",
    requiredViewCapability: "engineering-data.read",
    render: null,
  }),
  route({
    routeId: "identification.root",
    path: "/identification",
    title: "风险识别",
    section: "identification",
    regions: [{ key: "main", kind: "run" }],
    contextRequirement: "project",
    requiredViewCapability: "risk-identification.read",
    render: null,
  }),
  route({
    routeId: "assessment.root",
    path: "/assessment",
    title: "风险评估",
    section: "assessment",
    regions: [{ key: "main", kind: "list" }],
    contextRequirement: "project",
    requiredViewCapability: "risk-assessment.read",
    render: null,
  }),
  route({
    routeId: "warnings.root",
    path: "/warnings",
    title: "预警处置",
    section: "warnings",
    regions: [{ key: "main", kind: "list" }],
    contextRequirement: "project",
    requiredViewCapability: "warning-response.read",
    render: null,
  }),
  route({
    routeId: "knowledge.root",
    path: "/knowledge",
    title: "知识与规则",
    section: "knowledge",
    regions: [{ key: "main", kind: "governance" }],
    contextRequirement: "project",
    requiredViewCapability: "knowledge-modeling.read",
    render: null,
  }),
  route({
    routeId: "review-audit.root",
    path: "/review-audit",
    title: "复核与审计",
    section: "reviews",
    regions: [{ key: "main", kind: "review" }],
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

export type WebRouteCandidateV1 = Readonly<{
  route: WebRouteContributionV1;
  segments: readonly string[];
}>;

export type WebRouteRegistryV1 = Readonly<{
  routes: readonly WebRouteContributionV1[];
  /** 注册期算好的段描述；解析只比较实际同时匹配的候选。 */
  candidates: readonly WebRouteCandidateV1[];
  byId: (routeId: string) => WebRouteContributionV1 | undefined;
  byPath: (path: string) => WebRouteContributionV1 | undefined;
}>;

/**
 * 模板的静态形状：参数段一律规范化为同一占位。
 *
 * CH-2 D-04：形状相同意味着同一批具体路径都能同时匹配两个模板（只有参数名不同），
 * 这种注册在注册期就是歧义，必须拒绝而不是靠注册顺序或字典序静默任选目标。
 */
const staticShapeOf = (path: string): string =>
  path
    .split("/")
    .map((segment) => (segment.startsWith(":") ? ":" : segment))
    .join("/");

export const createWebRouteRegistry = (
  contributions: readonly WebRouteContributionV1[] = [],
): WebRouteRegistryV1 => {
  const byIdMap = new Map<string, WebRouteContributionV1>();
  const byPathMap = new Map<string, WebRouteContributionV1>();
  const byShapeMap = new Map<string, WebRouteContributionV1>();
  for (const item of BASE_WEB_ROUTE_CONTRIBUTIONS_V1) {
    byIdMap.set(item.routeId, item);
    byPathMap.set(item.path, item);
    byShapeMap.set(staticShapeOf(item.path), item);
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
      byShapeMap.set(staticShapeOf(item.path), Object.freeze(item));
      continue;
    }
    const shape = staticShapeOf(item.path);
    const previousByShape = byShapeMap.get(shape);
    if (previousByShape !== undefined) {
      throw new Error(
        `ambiguous web route shape: ${item.path} conflicts with ${previousByShape.path}`,
      );
    }
    byIdMap.set(item.routeId, Object.freeze(item));
    byPathMap.set(item.path, Object.freeze(item));
    byShapeMap.set(shape, Object.freeze(item));
  }
  const routes = Object.freeze(Array.from(byIdMap.values()));
  // 注册期已把段描述算好：解析只比较候选，不再每次导航重排整个注册表。
  const candidates = Object.freeze(
    routes
      .map((route) =>
        Object.freeze({
          route,
          segments: Object.freeze(route.path.split("/").slice(1)),
        }),
      )
      .filter((candidate) => candidate.segments.length > 0),
  );
  return Object.freeze({
    routes,
    candidates,
    byId: (routeId: string) => byIdMap.get(routeId),
    byPath: (path: string) => byPathMap.get(path),
  });
};

/**
 * C37 D-17：旧前缀别名。`/project` → `/projects`、`/review` → `/review-audit`，
 * 重定向时保留 params 与 search；别名不进入导航，只做深链兼容。
 * 安全原因：不得让旧前缀绕过既有能力门禁，因此别名只指向同 section 的目标根。
 */
export const WEB_LEGACY_PATH_ALIASES_V1: Readonly<Record<string, string>> = Object.freeze({
  "/project": "/projects",
  "/review": "/review-audit",
  "/assessment/quality-evaluation": "/assessment/quality",
});

const matchCandidate = (
  candidate: WebRouteCandidateV1,
  actual: readonly string[],
): Readonly<Record<string, string>> | undefined => {
  if (candidate.segments.length !== actual.length) return undefined;
  const params: Record<string, string> = {};
  for (let index = 0; index < candidate.segments.length; index += 1) {
    const expectedSegment = candidate.segments[index]!;
    const actualSegment = actual[index]!;
    if (actualSegment === "") return undefined;
    if (expectedSegment.startsWith(":")) params[expectedSegment.slice(1)] = actualSegment;
    else if (expectedSegment !== actualSegment) return undefined;
  }
  return Object.freeze(params);
};

/** 只读检查：某条路径是否命中当前注册表中的任一模板。别名重定向据此核对目标。 */
const registeredTargetMatches = (pathname: string, registry: WebRouteRegistryV1): boolean =>
  registry.candidates.some(
    (candidate) => matchCandidate(candidate, pathname.split("/").slice(1)) !== undefined,
  );

/**
 * 应用别名：保留 path 末尾的 params 与整个 search；未知路径不产生重定向。
 *
 * CH-2 D-04：别名表本身是已知模板清单——只有登记在册的前缀才可能触发，且必须落在
 * 段边界上；转换后的完整路径还必须在当前注册表里真实命中，因此目标未注入时不会先把
 * 用户送到一个不存在的页面。`applyWebPathAliasV1` 接收注册表，不保留无验证的旧签名。
 */
export const applyWebPathAliasV1 = (
  pathname: string,
  search = "",
  registry: WebRouteRegistryV1 = WEB_ROUTE_REGISTRY_V1,
): string | undefined => {
  for (const [from, to] of Object.entries(WEB_LEGACY_PATH_ALIASES_V1)) {
    const candidate =
      pathname === from
        ? `${to}`
        : pathname.startsWith(`${from}/`)
          ? `${to}${pathname.slice(from.length)}`
          : undefined;
    // 未命中当前注册表的目标不重定向：未知旧后缀直接未找到，而不是落到另一个合法对象。
    if (candidate !== undefined && registeredTargetMatches(candidate, registry)) {
      return `${candidate}${search}`;
    }
  }
  return undefined;
};

export const WEB_ROUTE_REGISTRY_V1 = createWebRouteRegistry();

/**
 * 具体 URL 路径的安全判定。
 *
 * 路由**模板**用 `isSafeWebPathTemplate`；具体请求路径还需允许百分号编码
 * （业务标识常含 `:` 等保留字符，编码后才是合法路径段）。
 * 这里只放行结构良好的 `%XX`，解码后仍不得出现 `/`、`\` 或 `..`，
 * 以免编码绕过段边界与目录穿越。
 */
const isSafeConcretePathV1 = (value: string): boolean => {
  if (value.includes("\\") || value.includes("://") || value.includes("..")) return false;
  if (/%(?![0-9A-Fa-f]{2})/.test(value)) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  if (decoded.includes("..") || decoded.includes("\\") || decoded.includes("://")) return false;
  return decoded.split("/").every((segment) => segment === "" || !/[?#]/.test(segment));
};

const pathnameFor = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.includes("://")) return undefined;
  const path = value.split(/[?#]/, 1)[0];
  if (path === undefined || path === "") return "/";
  return isSafeConcretePathV1(path) ? path : undefined;
};

/**
 * CH-2 D-04：先完整逐段匹配得到真实相交候选，再按首个差异段裁决。
 *
 * 静态段在该段与参数段都能匹配同一具体路径时胜出。判定只看两模板是否在该段
 * 一静一动，不看参数总数、字典序或注册顺序，因此调换注册顺序结果相同。
 */
const pickCandidate = (
  candidates: readonly WebRouteCandidateV1[],
  actual: readonly string[],
): { route: WebRouteContributionV1; params: Readonly<Record<string, string>> } | undefined => {
  let best:
    { candidate: WebRouteCandidateV1; params: Readonly<Record<string, string>> } | undefined;
  for (const candidate of candidates) {
    const params = matchCandidate(candidate, actual);
    if (params === undefined) continue;
    if (best === undefined) {
      best = { candidate, params };
      continue;
    }
    const bestSegments = best.candidate.segments;
    const decisive = candidate.segments.findIndex(
      (segment, index) =>
        segment.startsWith(":") !== bestSegments[index]!.startsWith(":") &&
        (segment.startsWith(":") || bestSegments[index]!.startsWith(":")),
    );
    // 首个差异段上候选是静态、既有是参数时，候选更具体。
    if (decisive !== -1 && !candidate.segments[decisive]!.startsWith(":")) {
      best = { candidate, params };
      continue;
    }
    if (decisive === -1 && bestSegments.length !== candidate.segments.length) {
      // 形状已在注册期保证互斥；这里只兜住外部手工构造的注册表。
      if (candidate.segments.length > bestSegments.length) best = { candidate, params };
    }
  }
  return best === undefined ? undefined : { route: best.candidate.route, params: best.params };
};

export const resolveWebRoute = (
  value: unknown,
  registry: WebRouteRegistryV1 = WEB_ROUTE_REGISTRY_V1,
): WebRouteResolutionV1 => {
  const raw = pathnameFor(value);
  if (raw === undefined) return { kind: "not-found", pathname: "[invalid]" };
  // 旧前缀先做别名重定向，保留 params 与 search；未命中别名再走正常匹配。
  const search =
    typeof value === "string" && value.includes("?") ? value.slice(value.indexOf("?")) : "";
  const aliased = applyWebPathAliasV1(raw, search, registry);
  if (aliased !== undefined) {
    return Object.freeze({ kind: "redirect", from: raw, to: aliased });
  }
  if (raw === "/") return { kind: "redirect", from: "/", to: `/overview${search}` };
  const matched = pickCandidate(registry.candidates, raw.split("/").slice(1));
  if (matched !== undefined) {
    return Object.freeze({
      kind: "matched",
      route: matched.route,
      params: matched.params,
      pathname: raw,
    });
  }
  return Object.freeze({ kind: "not-found", pathname: raw });
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
