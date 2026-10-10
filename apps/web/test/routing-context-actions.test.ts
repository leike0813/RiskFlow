import { describe, expect, it } from "vitest";

import type { SpatialScopeRefV1 } from "@riskflow/contracts/ports";

import {
  applyWebPathAliasV1,
  BASE_WEB_ROUTE_CONTRIBUTIONS_V1,
  createWebHistoryAdapter,
  createWebRouteRegistry,
  resolveWebRoute,
  routePathFor,
} from "../src/app/routes.js";
import {
  contextMatchesFrozenRun,
  createRequestRevisionGuard,
  freezeRunContext,
  INITIAL_WEB_CONTEXT_V1,
  reduceWebContext,
} from "../src/app/state.js";
import {
  deriveActionAvailability,
  invokeWebAction,
  type WebActionV1,
} from "../src/shared/actions.js";
import { hasExactlySevenBusinessNavigation, WEB_NAVIGATION_V1 } from "../src/shell/navigation.js";

const scope: SpatialScopeRefV1 = {
  kind: "spatial-scope",
  reference: { entityId: "scope-1", versionId: "v1" },
};

describe("C10 路由、上下文与动作原语", () => {
  it("keeps seven fixed navigation entries and rejects unsafe paths", () => {
    expect(hasExactlySevenBusinessNavigation()).toBe(true);
    expect(WEB_NAVIGATION_V1.map((item) => item.id)).toEqual([
      "overview",
      "projects",
      "identification",
      "assessment",
      "warnings",
      "knowledge",
      "reviews",
    ]);
    expect(WEB_NAVIGATION_V1.map((item) => item.path)).toEqual(
      BASE_WEB_ROUTE_CONTRIBUTIONS_V1.filter((item) => item.section !== null).map(
        (item) => item.path,
      ),
    );
    expect(resolveWebRoute("/")).toEqual({ kind: "redirect", from: "/", to: "/overview" });
    expect(resolveWebRoute("/overview?source=history").kind).toBe("matched");
    expect(resolveWebRoute("/unknown").kind).toBe("not-found");
    expect(resolveWebRoute("/overview/%2F").kind).toBe("not-found");
    expect(resolveWebRoute("https://outside.example/overview").kind).toBe("not-found");
  });

  it("accepts direct route contributions without opening arbitrary module loading", () => {
    const contribution = {
      routeId: "projects.detail",
      path: "/projects/:projectId",
      title: "项目详情",
      section: "projects",
      shellKind: "detail",
      contextRequirement: "project",
      requiredViewCapability: "engineering-data.read",
      render: () => null,
    } as const;
    const registry = createWebRouteRegistry([contribution]);
    const resolved = resolveWebRoute("/projects/project-1", registry);
    expect(resolved.kind).toBe("matched");
    if (resolved.kind === "matched") expect(resolved.params).toEqual({ projectId: "project-1" });
    expect(routePathFor("projects.detail", registry)).toBeUndefined();
    expect(() =>
      createWebRouteRegistry([
        { ...contribution, routeId: "projects.bad", path: "https://outside.example" },
      ]),
    ).toThrow();
  });

  it("uses native history for only registered static routes", () => {
    let pathname = "/overview";
    const popListeners = new Set<() => void>();
    const location = {
      get pathname() {
        return pathname;
      },
    };
    const history = {
      pushState: (_state: unknown, _title: string, url?: string | URL | null) => {
        pathname = String(url ?? "/");
      },
      replaceState: (_state: unknown, _title: string, url?: string | URL | null) => {
        pathname = String(url ?? "/");
      },
      back: () => undefined,
      forward: () => undefined,
    } as unknown as Pick<History, "pushState" | "replaceState" | "back" | "forward">;
    const adapter = createWebHistoryAdapter({
      history,
      location,
      addPopStateListener: (listener) => {
        popListeners.add(listener);
        return () => popListeners.delete(listener);
      },
    });
    const seen: string[] = [];
    const unsubscribe = adapter.subscribe((resolution) => {
      if (resolution.kind === "matched") seen.push(resolution.route.routeId);
    });
    expect(adapter.navigate("assessment.root")).toBe(true);
    expect(adapter.current()).toBe("/assessment");
    expect(seen).toEqual(["assessment.root"]);
    expect(adapter.navigate("projects.detail")).toBe(false);
    pathname = "/projects";
    popListeners.forEach((listener) => listener());
    expect(seen.at(-1)).toBe("projects.root");
    unsubscribe();
  });

  it("cascades context changes and drops stale requests", () => {
    const project = reduceWebContext(INITIAL_WEB_CONTEXT_V1, {
      type: "project-selected",
      projectId: "project-1",
    });
    const spatial = reduceWebContext(project, {
      type: "spatial-scope-selected",
      spatialScopeRef: scope,
    });
    const process = reduceWebContext(spatial, {
      type: "process-node-selected",
      processNodeId: "process-1",
    });
    expect(process.revision).toBe(3);
    const switched = reduceWebContext(process, {
      type: "project-selected",
      projectId: "project-2",
    });
    expect(switched).toMatchObject({
      projectId: "project-2",
      spatialScopeRef: null,
      processNodeId: null,
      revision: 4,
    });
    expect(
      reduceWebContext(INITIAL_WEB_CONTEXT_V1, {
        type: "process-node-selected",
        processNodeId: "ignored",
      }),
    ).toBe(INITIAL_WEB_CONTEXT_V1);
    expect(
      reduceWebContext(INITIAL_WEB_CONTEXT_V1, {
        type: "replace",
        context: {
          revision: 1,
          projectId: null,
          spatialScopeRef: null,
          processNodeId: "orphan-process",
        },
      }),
    ).toBe(INITIAL_WEB_CONTEXT_V1);
    const frozen = freezeRunContext(process);
    expect(contextMatchesFrozenRun(process, frozen)).toBe(true);
    expect(contextMatchesFrozenRun(switched, frozen)).toBe(false);

    const guard = createRequestRevisionGuard();
    const first = guard.begin({ revision: process.revision, routeId: "overview.root" });
    const second = guard.begin({ revision: switched.revision, routeId: "overview.root" });
    expect(first.signal.aborted).toBe(true);
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.accept(second)).toBe(true);
    expect(guard.isCurrent(second)).toBe(false);
  });

  it("separates unknown, forbidden, blocked and unavailable actions", () => {
    const common = {
      requiredCapability: "projection.query" as const,
      permission: "allowed" as const,
      business: { kind: "allowed" as const },
      route: "available" as const,
      contextComplete: true as const,
    };
    expect(deriveActionAvailability({ ...common, permission: "unknown" })).toEqual({
      kind: "checking",
    });
    expect(deriveActionAvailability({ ...common, permission: "denied" })).toEqual({
      kind: "forbidden",
      requiredCapability: "projection.query",
    });
    expect(
      deriveActionAvailability({
        ...common,
        business: { kind: "blocked", reasons: [{ code: "version-stale" }] },
      }),
    ).toEqual({ kind: "blocked", reasons: [{ code: "version-stale" }] });
    expect(deriveActionAvailability({ ...common, route: "missing" })).toEqual({
      kind: "unavailable",
      reason: "route-missing",
    });

    let calls = 0;
    const action = (availability: WebActionV1["availability"]): WebActionV1 => ({
      actionId: "test-action",
      label: "测试",
      availability,
      impact: "standard",
      invoke: () => {
        calls += 1;
      },
    });
    expect(invokeWebAction(action({ kind: "blocked", reasons: [] }))).toBe(false);
    expect(invokeWebAction(action({ kind: "allowed" }))).toBe(true);
    expect(calls).toBe(1);
  });
});

describe("C37 旧前缀别名与质量子路径", () => {
  it("旧前缀重定向到新 section 根，并保留 search", () => {
    expect(resolveWebRoute("/project")).toEqual({
      kind: "redirect",
      from: "/project",
      to: "/projects",
    });
    expect(resolveWebRoute("/review")).toEqual({
      kind: "redirect",
      from: "/review",
      to: "/review-audit",
    });
    expect(resolveWebRoute("/project?revision=7").to).toBe("/projects?revision=7");
    expect(resolveWebRoute("/project/risk-1?tab=evidence")).toMatchObject({
      kind: "redirect",
      to: "/projects/risk-1?tab=evidence",
    });
  });

  it("别名只落在段边界上，不误伤既有路径", () => {
    expect(applyWebPathAliasV1("/projects")).toBeUndefined();
    expect(applyWebPathAliasV1("/review-audit")).toBeUndefined();
    expect(applyWebPathAliasV1("/projection")).toBeUndefined();
    expect(resolveWebRoute("/projects").kind).toBe("matched");
  });

  it("质量入口在 /assessment/quality，七项导航数量不变", () => {
    const registry = createWebRouteRegistry([
      {
        routeId: "assessment.quality",
        path: "/assessment/quality",
        title: "质量评估",
        section: "assessment",
        shellKind: "list",
        contextRequirement: "project",
        requiredViewCapability: null,
        render: null,
      },
    ]);
    const resolution = resolveWebRoute("/assessment/quality", registry);
    expect(resolution.kind).toBe("matched");
    if (resolution.kind === "matched") {
      expect(resolution.route.routeId).toBe("assessment.quality");
    }
    // /assessment 仍是 section 根，质量页不占用它。
    expect(resolveWebRoute("/assessment", registry).kind).toBe("matched");
    expect(WEB_NAVIGATION_V1).toHaveLength(7);
    expect(hasExactlySevenBusinessNavigation(WEB_NAVIGATION_V1)).toBe(true);
  });
});
