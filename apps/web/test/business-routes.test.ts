import { describe, expect, it } from "vitest";
import { BUSINESS_ROUTE_REGISTRY_V1, BUSINESS_ROUTE_PATHS_V1 } from "../src/app/business-routes.js";
import { resolveWebRoute, WEB_LEGACY_PATH_ALIASES_V1 } from "../src/app/routes.js";
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
      expect(resolution.kind).toBe("redirect");
      if (resolution.kind === "redirect") expect(resolution.to).toBe(`${to}?project=p1`);
    }
  });

  it("未知路径不静态填充", () => {
    expect(resolveWebRoute("/no-such-page", BUSINESS_ROUTE_REGISTRY_V1).kind).toBe("not-found");
  });
});
