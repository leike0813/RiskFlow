/**
 * CH-2 D-02/SH-S06 原生桌面缩放取证（IP-07）。
 *
 * 只用真实 Chromium 外窗口 + 原生 Ctrl+0 / Ctrl+plus 缩放：不用模拟 viewport、
 * CSS zoom、deviceScaleFactor 或 pageScaleFactor 代替真实 200%。每个组合实际完成
 * 导航、左右栏折叠、已有确认与取消、以及焦点恢复；有二维溢出时实际改变 scrollLeft。
 *
 * 结果按 CH-1 `evidence/native-zoom.json` 的形态记录：窗口外尺寸与 CSS 视口分开写，
 * 不把 1920 的无溢出记成发生滚动。工具不可用时明确失败，不靠 viewport 近似。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { startBusinessBrowserServer } from "./business-server.mjs";

const CHANGE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../openspec/changes/prepare-web-shell-route-and-access-seams",
);
const EVIDENCE_DIR = resolve(CHANGE_ROOT, "evidence");
const SHOT_DIR = resolve(EVIDENCE_DIR, "native-zoom");

/** 三种桌面外窗口；每种都实际跑 100% 与原生 200%。 */
const WINDOWS = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

/** Chromium 原生 200% 需要五次 Ctrl+plus（100→110→125→150→175→200）。 */
const ZOOMS = [
  { percent: 100, steps: 0 },
  { percent: 200, steps: 5 },
];

const xdotool = (...args) => execFileSync("xdotool", args, { encoding: "utf8" }).trim();

const chromiumWindowId = () => {
  const found = xdotool("search", "--onlyvisible", "--class", "chrome").split("\n").filter(Boolean);
  if (found.length === 0) throw new Error("NATIVE_ZOOM_WINDOW_NOT_FOUND");
  return found[0];
};

/** 用 CDP 设置真实浏览器外窗口；不使用 Playwright 的 viewport 模拟。 */
const setOuterWindow = async (cdp, width, height) => {
  const { windowId } = await cdp.send("Browser.getWindowForTarget");
  await cdp.send("Browser.setWindowBounds", {
    windowId,
    bounds: { windowState: "normal", left: 0, top: 0, width, height },
  });
};

const applyNativeZoom = async (xWindowId, steps) => {
  // 专用 Xvfb 没有窗口管理器：windowactivate 会因不支持 _NET_ACTIVE_WINDOW 失败，
  // 因此只用 windowfocus 把输入焦点交给目标窗口。缩放键必须走 XTEST
  // （不带 --window），Chromium 忽略 XSendEvent 合成事件。
  xdotool("windowfocus", String(xWindowId));
  xdotool("key", "ctrl+0");
  for (let index = 0; index < steps; index += 1) {
    xdotool("key", "ctrl+plus");
  }
  // 让原生缩放落到布局：下一次读取前给浏览器一次提交帧的机会。
  await new Promise((done) => globalThis.setTimeout(done, 600));
};

/** 二维溢出与实际滚动：只有真的能改 scrollLeft 才记为发生滚动。 */
const measureOverflow = async (page) =>
  page.evaluate(() => {
    const scroller =
      globalThis.globalThis.document.querySelector(".app-main") ??
      globalThis.document.scrollingElement;
    const overflow =
      globalThis.document.documentElement.scrollWidth >
      globalThis.document.documentElement.clientWidth;
    const before = scroller.scrollLeft;
    scroller.scrollLeft = before + 240;
    const after = scroller.scrollLeft;
    const vertical = scroller.scrollHeight > scroller.clientHeight;
    const verticalBefore = scroller.scrollTop;
    scroller.scrollTop = verticalBefore + 240;
    const scrolledVertical = scroller.scrollTop > verticalBefore;
    scroller.scrollLeft = before;
    scroller.scrollTop = verticalBefore;
    return {
      overflow,
      scrolled: after > before,
      localVerticalScroll: vertical && scrolledVertical,
    };
  });

/** 焦点可见：用 :focus-visible 的实际 outline 判定，不看类名或文案。 */
const focusIsVisible = async (page) =>
  page.evaluate(() => {
    const active = globalThis.document.activeElement;
    if (active === null || active === globalThis.document.body) return false;
    const style = globalThis.getComputedStyle(active);
    return style.outlineStyle !== "none" && parseFloat(style.outlineWidth || "0") > 0;
  });

const errorIsVisible = async (page) =>
  page.evaluate(() => {
    const error = globalThis.document.querySelector('[data-confirmation-state="error"]');
    if (error === null) return { visible: false, color: null };
    const style = globalThis.getComputedStyle(error);
    return {
      visible: style.display !== "none" && style.visibility !== "hidden",
      color: style.color,
    };
  });

const login = async (page, server) => {
  await page.goto(`${server.origin}/login?project=${server.projectId}`);
  await page.locator('input[name="loginName"]').fill(server.operatorLogin);
  await page.getByLabel("密码").fill(server.accountPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".app-shell").waitFor({ state: "visible", timeout: 60_000 });
};

const runCombination = async ({ page, server, windowSize, zoom }) => {
  await page.goto(`${server.origin}/review-audit?project=${server.projectId}`);
  await page.locator(".app-shell").waitFor({ state: "visible", timeout: 60_000 });

  // 左栏折叠：只改布局与文字呈现，导航条目不卸载、焦点不丢。
  const collapse = page.getByRole("button", { name: "收起导航" });
  const navCollapsible = (await collapse.count()) > 0;
  if (navCollapsible) {
    await collapse.click();
    await page.getByRole("button", { name: "展开导航" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "展开导航" }).click();
    await collapse.waitFor({ state: "visible" });
  }
  const navigationSurvivesCollapse = (await page.locator("[data-navigation]").count()) > 0;

  // 右栏停靠：显式折叠不丢失已获准贡献。
  await page.getByRole("button", { name: "打开停靠区" }).click();
  const dockPanel = page.locator(".right-dock .dock-panel");
  await dockPanel.waitFor({ state: "visible", timeout: 30_000 });
  const dockOpened = (await dockPanel.count()) > 0;
  if (dockOpened) await page.getByRole("button", { name: "关闭停靠区" }).click();

  const navigationFocus = await focusIsVisible(page);
  const slug = `ch2-${windowSize.width}x${windowSize.height}-${zoom.percent}`;
  await mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: resolve(SHOT_DIR, `${slug}-layout.png`) });

  // 已有确认：焦点落在取消，提交被传输层拦下后错误可见，Escape 关闭并归还焦点。
  // 已取代目标的行按钮是 disabled 的陈旧占位；只取真正可执行的确认入口。
  const trigger = page.locator("button:not([disabled])", { hasText: /^通过$/ }).first();
  const hasConfirm = (await trigger.count()) > 0;
  let confirmFocusAtCancel = false;
  let cancelled = false;
  let focusRestored = false;
  let failedRequests = 0;
  if (hasConfirm) {
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 30_000 });
    confirmFocusAtCancel = await page
      .getByRole("button", { name: "取消", exact: true })
      .evaluate((element) => element === globalThis.document.activeElement);
    await dialog.getByRole("button", { name: "确认提交" }).click();
    const { visible, color } = await errorIsVisible(page);
    failedRequests = visible ? 1 : 0;
    const errorColor = color;
    await page.screenshot({ path: resolve(SHOT_DIR, `${slug}-error.png`) });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 30_000 });
    cancelled = (await page.getByRole("dialog").count()) === 0;
    focusRestored = await trigger.evaluate(
      (element) => element === globalThis.document.activeElement,
    );
    var errorColorObserved = errorColor;
  }

  const metrics = await page.evaluate(() => ({
    outerWidth: globalThis.outerWidth,
    outerHeight: globalThis.outerHeight,
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
    dpr: globalThis.devicePixelRatio,
  }));
  const overflowResult = await measureOverflow(page);

  return {
    width: windowSize.width,
    height: windowSize.height,
    zoom: zoom.percent,
    outer: [metrics.outerWidth, metrics.outerHeight],
    inner: [metrics.innerWidth, metrics.innerHeight],
    dpr: metrics.dpr,
    ...overflowResult,
    navCollapsible,
    navigationSurvivesCollapse,
    dockOpened,
    navigationFocus,
    confirmFocusAtCancel,
    cancelled,
    focusRestored,
    errorVisible: failedRequests > 0,
    errorColor: hasConfirm ? errorColorObserved : null,
    failedRequests,
    screenshots: [
      `native-zoom/ch2-${windowSize.width}x${windowSize.height}-${zoom.percent}-layout.png`,
      `native-zoom/ch2-${windowSize.width}x${windowSize.height}-${zoom.percent}-error.png`,
    ],
  };
};

export const runNativeZoomEvidence = async () => {
  const server = await startBusinessBrowserServer();
  // 非 headless + viewport:null：Chromium 自带窗口，CDP 改的是真实外窗口。
  const browser = await chromium.launch({ headless: false, args: ["--start-maximized=false"] });
  const results = [];
  try {
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    // 每组合拦截一次写请求作为传输失败，不向服务端提交业务命令。
    await page.route("**/api/v1/projects/*/commands/**", (route) => route.abort("failed"));
    await login(page, server);
    for (const windowSize of WINDOWS) {
      for (const zoom of ZOOMS) {
        await setOuterWindow(cdp, windowSize.width, windowSize.height);
        const xWindowId = chromiumWindowId();
        await applyNativeZoom(xWindowId, zoom.steps);
        results.push(await runCombination({ page, server, windowSize, zoom }));
      }
    }
    await context.close();
  } finally {
    await browser.close();
    await server.close?.();
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const record = {
    change: "prepare-web-shell-route-and-access-seams",
    date: new Date().toISOString().slice(0, 10),
    browser: browser.version(),
    method: {
      window: "CDP Browser.setWindowBounds 设置真实浏览器外窗口；未设置模拟 viewport",
      zoom: "xdotool 向 Chromium 原生窗口发送 Ctrl+0 与五次 Ctrl+plus；未使用 CSS zoom 或 deviceScaleFactor 模拟",
      checks: "实际折叠左栏与右栏、打开已有确认、取消与焦点恢复；有二维溢出时实际改变 scrollLeft",
      requestBoundary: "每组合拦截一次写请求作为传输失败，不向服务端提交业务命令",
    },
    results,
  };
  writeFileSync(resolve(EVIDENCE_DIR, "native-zoom.json"), `${JSON.stringify(record, null, 2)}\n`);
  return record;
};

// 直接执行本文件即取证：需要专用 Xvfb 与 xdotool，缺任一即非零退出。
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runNativeZoomEvidence().then(
    (record) => process.stdout.write(`${JSON.stringify(record.results, null, 2)}\n`),
    (error) => {
      process.stderr.write(`NATIVE_ZOOM_FAILED:${String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
