import { defineConfig, devices } from "@playwright/test";

/**
 * C36 跨页面真实浏览器验收（D-07）：只启用 Chromium、有限重试与失败保留 trace。
 * 服务由 `apps/web/test/browser/server.mjs` 在测试内启动（生产构建 + 真实 HTTP/授权/投影接缝），
 * 不使用 Mock 浏览器、Mock 后端或开发服务器。
 */
export default defineConfig({
  testDir: "apps/web/test/browser",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: "test-results/quality-browser",
  use: {
    ...devices["Desktop Chrome"],
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], browserName: "chromium" },
    },
  ],
});
