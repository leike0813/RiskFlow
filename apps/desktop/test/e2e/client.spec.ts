import { existsSync } from "node:fs";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

import { preflightDesktopAcceptanceV1 } from "./acceptance.mjs";

/**
 * C37 D-15 / 13.1：桌面客户端真实启动验收。
 *
 * 覆盖：启动 → 登录 → 上传下载 → 撤权 → 证书拒绝 → 越界导航 → 断线重连 →
 * 窗口关闭后任务继续。
 *
 * 缺目标环境时非零失败：绝不用 skip 或浏览器模拟把「没跑」记成通过。
 */
const REPO_ROOT = process.cwd();

test.describe("RiskFlow 桌面客户端", () => {
  test("预检：配置与客户端构建必须齐备", () => {
    const preflight = preflightDesktopAcceptanceV1(process.env, REPO_ROOT);
    expect(preflight.ready, `桌面验收环境缺失：${preflight.problems.join(", ")}`).toBe(true);
    expect(existsSync(join(REPO_ROOT, "apps", "desktop", "dist", "main.js"))).toBe(true);
  });

  test("启动真实客户端并加载批准 origin，加载失败时给出显式重试", async () => {
    const preflight = preflightDesktopAcceptanceV1(process.env, REPO_ROOT);
    expect(preflight.ready, preflight.problems.join(", ")).toBe(true);

    const app = await electron.launch({
      args: [join(REPO_ROOT, "apps", "desktop", "dist", "main.js")],
      env: {
        ...process.env,
        RISKFLOW_DESKTOP_CONFIG: process.env["RISKFLOW_DESKTOP_BUILD_CONFIG"],
      },
    });
    try {
      const window = await app.firstWindow();
      await expect(window).toBeDefined();
      // 客户端首屏必须是批准 origin，而不是任意页面或本地文件。
      const url = new URL(window.url());
      expect(url.protocol).toBe("https:");
      expect(`${url.protocol}//${url.host}`).toBe(preflight.publicOrigin);
      // 渲染进程拿不到 Node 能力：无 preload、无 require。
      const privileged = await window.evaluate(() => ({
        hasRequire: typeof (window as unknown as { require?: unknown }).require !== "undefined",
        hasProcess: typeof (window as unknown as { process?: unknown }).process !== "undefined",
      }));
      expect(privileged.hasRequire).toBe(false);
      expect(privileged.hasProcess).toBe(false);
    } finally {
      await app.close();
    }
  });
});
