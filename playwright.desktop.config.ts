import { defineConfig } from "@playwright/test";

/**
 * C37 D-22 / 13.1：Electron 桌面验收的独立 Playwright 配置。
 *
 * 与 Web 浏览器验收分离：这里用 `_electron.launch` 启动真实客户端，
 * 不复用开发服务器、不加载 Web 源码副本，也不用浏览器模拟桌面。
 *
 * 缺目标环境（未构建的客户端或缺失验收配置）必须非零失败，不允许 skip 后计作通过。
 */
export default defineConfig({
  testDir: "apps/desktop/test/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // 桌面启动包含真实 Electron 与内网 HTTPS，给足时限。
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  outputDir: "test-results/desktop-e2e",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
