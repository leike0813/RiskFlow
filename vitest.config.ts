import { configDefaults, defineConfig } from "vitest/config";

// PostgreSQL 集成测试用 Testcontainers 起独立容器；全量并发会触发 Docker
// 资源竞争导致偶发失败。限制 worker 数换取可重复的稳定验证；真实
// LangGraph/PostgreSQL 集成用例单条耗时可达数十秒，故统一放宽默认超时，
// 避免与并发无关的实现缺陷被 5 秒默认值误判为失败。
// `apps/web/test/browser/` 与 `demo/test/browser/` 由 Playwright 驱动真实 Chromium，
// 不进 vitest 进程。
export default defineConfig({
  test: {
    maxWorkers: 2,
    minWorkers: 1,
    exclude: [
      ...configDefaults.exclude,
      "apps/web/test/browser/**",
      "demo/test/browser/**",
      "apps/desktop/test/e2e/**",
    ],
    testTimeout: 30_000,
  },
});
