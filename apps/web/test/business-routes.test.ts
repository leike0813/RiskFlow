import { describe, expect, it } from "vitest";
import { BUSINESS_ROUTE_REGISTRY_V1, BUSINESS_ROUTE_PATHS_V1 } from "../src/app/business-routes.js";
import {
  createWebRouteRegistry,
  resolveWebRoute,
  WEB_LEGACY_PATH_ALIASES_V1,
} from "../src/app/routes.js";
import { WEB_NAVIGATION_V1, hasExactlySevenBusinessNavigation } from "../src/shell/navigation.js";

describe("C37 生产路由注册表", () => {
  it("全部登记业务路由且都能解析", () => {
    expect(BUSINESS_ROUTE_PATHS_V1.length).toBeGreaterThanOrEqual(45);
    for (const path of BUSINESS_ROUTE_PATHS_V1) {
      const probe = path.replace(/:[^/]+/g, "probe-1");
      const resolution = resolveWebRoute(probe, BUSINESS_ROUTE_REGISTRY_V1);
      expect(resolution.kind, `${probe} 应命中已登记路由`).toBe("matched");
    }
  });

  it("主导航仍只有七项，Agent 与系统管理不占导航", () => {
    expect(hasExactlySevenBusinessNavigation(WEB_NAVIGATION_V1)).toBe(true);
    for (const path of ["/agent", "/ops/access", "/ops/health"]) {
      const resolution = resolveWebRoute(path, BUSINESS_ROUTE_REGISTRY_V1);
      expect(resolution.kind).toBe("matched");
      if (resolution.kind === "matched") expect(resolution.route.section).toBeNull();
    }
  });

  it("旧前缀别名指向新路径并保留 search", () => {
    for (const [from, to] of Object.entries(WEB_LEGACY_PATH_ALIASES_V1)) {
      const resolution = resolveWebRoute(`${from}?project=p1`, BUSINESS_ROUTE_REGISTRY_V1);
      // 目标模板未在当前注册表登记时不重定向：别名不得先把用户送到不存在的页面。
      const registered = BUSINESS_ROUTE_REGISTRY_V1.candidates.some(
        (candidate) => candidate.route.path === to,
      );
      if (!registered) {
        expect(resolution.kind, `${from} 的目标未注册时不应重定向`).toBe("not-found");
        continue;
      }
      expect(resolution.kind, `${from} 应重定向`).toBe("redirect");
      if (resolution.kind === "redirect") expect(resolution.to).toBe(`${to}?project=p1`);
    }
  });

  it("未知路径不静态填充", () => {
    expect(resolveWebRoute("/no-such-page", BUSINESS_ROUTE_REGISTRY_V1).kind).toBe("not-found");
  });
});

describe("CH-2 精确模板匹配", () => {
  const contribution = (routeId: string, path: string) => ({
    routeId,
    path,
    title: routeId,
    section: null as const,
    shellKind: "detail" as const,
    contextRequirement: "project" as const,
    requiredViewCapability: null,
    render: null,
  });

  it("真正相交的模板按首个差异段静态优先，与注册顺序无关", () => {
    for (const contributions of [
      [
        contribution("warnings.actions", "/warnings/:warningId/actions"),
        contribution("warnings.task-detail", "/warnings/tasks/:taskId"),
      ],
      [
        contribution("warnings.task-detail", "/warnings/tasks/:taskId"),
        contribution("warnings.actions", "/warnings/:warningId/actions"),
      ],
    ]) {
      const registry = createWebRouteRegistry(contributions);
      const action = resolveWebRoute("/warnings/abc/actions", registry);
      expect(action.kind).toBe("matched");
      if (action.kind === "matched") {
        expect(action.route.routeId).toBe("warnings.actions");
        expect(action.params).toEqual({ warningId: "abc" });
      }
      // `tasks` 是静态段，因此它在这里是 taskId 而不是 warningId。
      const task = resolveWebRoute("/warnings/tasks/actions", registry);
      expect(task.kind).toBe("matched");
      if (task.kind === "matched") {
        expect(task.route.routeId).toBe("warnings.task-detail");
        expect(task.params).toEqual({ taskId: "actions" });
      }
    }
  });

  it("相同静态形状的模板在注册期拒绝，base 同 ID 同路径替换仍可用", () => {
    expect(() =>
      createWebRouteRegistry([
        contribution("warnings.by-warning", "/warnings/:warningId"),
        contribution("warnings.by-id", "/warnings/:id"),
      ]),
    ).toThrow(/ambiguous web route shape/);

    // 生产注册表本身可解析这两个真实模板：静态 `tasks` 与参数 `:warningId` 形状不同。
    expect(
      BUSINESS_ROUTE_REGISTRY_V1.candidates.some((c) => c.route.path === "/warnings/tasks"),
    ).toBe(true);
    expect(
      BUSINESS_ROUTE_REGISTRY_V1.candidates.some((c) => c.route.path === "/warnings/:warningId"),
    ).toBe(true);
    const tasks = resolveWebRoute("/warnings/tasks", BUSINESS_ROUTE_REGISTRY_V1);
    expect(tasks.kind).toBe("matched");
    if (tasks.kind === "matched") expect(tasks.route.routeId).toBe("business.warnings.tasks");
    const warning = resolveWebRoute("/warnings/abc", BUSINESS_ROUTE_REGISTRY_V1);
    expect(warning.kind).toBe("matched");
    if (warning.kind === "matched") {
      expect(warning.route.routeId).toBe("business.warningsparam");
      expect(warning.params).toEqual({ warningId: "abc" });
    }

    // base contribution 的同 ID 同路径精确替换仍然可用。
    expect(() =>
      createWebRouteRegistry([
        { ...contribution("overview.root", "/overview"), render: () => null },
      ]),
    ).not.toThrow();
  });
});
