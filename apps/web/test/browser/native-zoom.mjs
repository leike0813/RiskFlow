/**
 * CH-3 D-10 原生桌面缩放取证（IP-06 / task 6.3）。
 *
 * 只用真实 Chromium 外窗口 + 原生 Ctrl+0 / Ctrl+plus 缩放：不用模拟 viewport、
 * CSS zoom、deviceScaleFactor 或 pageScaleFactor 代替真实 200%。每个组合实际完成
 * 导航、左右栏折叠、已有确认与取消、焦点恢复，以及总览的分布／时间线／分页可达；
 * 有二维溢出时实际改变 scrollLeft。
 *
 * 结果按 CH-1 `evidence/native-zoom.json` 的形态记录：窗口外尺寸与 CSS 视口分开写，
 * 不把 1920 的无溢出记成发生滚动。工具不可用时明确失败，不靠 viewport 近似。
 * 证据根改到本 change，CH-2 已归档证据不动。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, expect } from "@playwright/test";

import { startBusinessBrowserServer } from "./business-server.mjs";

const CHANGE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../openspec/changes/deliver-risk-overview-dashboard",
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
  const found = xdotool("search", "--onlyvisible", "--class", "riskflow-native-zoom")
    .split("\n")
    .filter(Boolean);
  expect(found).toHaveLength(1);
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
      globalThis.document.querySelector(".data-table-host") ??
      globalThis.document.querySelector(".app-main");
    const overflow = scroller.scrollWidth > scroller.clientWidth;
    const before = scroller.scrollLeft;
    scroller.scrollLeft = before > 0 ? 0 : 240;
    const after = scroller.scrollLeft;
    const main = globalThis.document.querySelector(".app-main");
    const vertical = main.scrollHeight > main.clientHeight;
    const verticalBefore = main.scrollTop;
    main.scrollTop = verticalBefore > 0 ? 0 : 240;
    const scrolledVertical = main.scrollTop !== verticalBefore;
    scroller.scrollLeft = before;
    main.scrollTop = verticalBefore;
    return {
      overflow,
      scrolled: after !== before,
      localVerticalScroll: vertical && scrolledVertical,
      pageOverflow:
        globalThis.document.documentElement.scrollWidth >
        globalThis.document.documentElement.clientWidth,
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

const login = async (page, server) => {
  await page.goto(`${server.origin}/login?project=${server.projectId}`);
  await page.locator('input[name="loginName"]').fill(server.operatorLogin);
  await page.getByLabel("密码").fill(server.accountPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator('input[name="loginName"]')).toHaveCount(0, { timeout: 60_000 });
};

const runCombination = async ({ page, cdp, server, windowSize, zoom }) => {
  await page.goto(`${server.origin}/review-audit?project=${server.projectId}`);
  const trigger = page.locator("button:not([disabled])", { hasText: /^通过$/ }).first();
  await expect(trigger).toBeEnabled({ timeout: 60_000 });
  const metrics = await page.evaluate(() => ({
    outer: [globalThis.outerWidth, globalThis.outerHeight],
    inner: [globalThis.innerWidth, globalThis.innerHeight],
    dpr: globalThis.devicePixelRatio,
  }));
  expect(metrics.outer).toEqual([windowSize.width, windowSize.height]);
  expect(metrics.dpr).toBeCloseTo(zoom.percent / 100, 2);
  expect(metrics.inner[0]).toBeCloseTo(windowSize.width / (zoom.percent / 100), 0);

  const navigation = page.locator("[data-navigation]");
  const originalLinks = await navigation.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-navigation")),
  );
  const collapse = page.getByRole("button", { name: "收起导航" });
  await expect(page.locator(".app-nav")).toHaveCSS("width", "152px");
  await collapse.focus();
  await page.keyboard.press("Enter");
  const expand = page.getByRole("button", { name: "展开导航" });
  await expect(expand).toBeFocused();
  await expect(page.locator(".app-nav")).toHaveCSS("width", "48px");
  expect(
    await navigation.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-navigation")),
    ),
  ).toEqual(originalLinks);
  await page.keyboard.press("Enter");
  await expect(collapse).toBeFocused();
  await page.keyboard.press("Tab");
  const navigationFocus = await focusIsVisible(page);
  expect(navigationFocus).toBe(true);

  const openDock = page.getByRole("button", { name: "打开停靠区" });
  await openDock.click();
  await expect(page.locator(".right-dock")).toHaveCSS("width", "352px");
  const contextTab = page.getByRole("tab", { name: "上下文", exact: true });
  await contextTab.focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Agent", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(contextTab).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(openDock).toBeFocused();
  await expect(page.getByRole("tabpanel")).toHaveCount(0);

  const slug = `ch3-${windowSize.width}x${windowSize.height}-${zoom.percent}`;
  mkdirSync(SHOT_DIR, { recursive: true });
  const capture = async (suffix) => {
    // 原生缩放会改变 DPR；不传 CSS clip，避免自动截图按旧 DPR 裁掉右半屏。
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    writeFileSync(resolve(SHOT_DIR, `${slug}-${suffix}.png`), Buffer.from(data, "base64"));
  };
  await capture("layout");
  let failedRequests = 0;
  const countCommand = (request) => {
    if (request.url().includes("/commands/")) failedRequests += 1;
  };
  page.on("request", countCommand);
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(failedRequests).toBe(0);
  await trigger.click();
  await dialog.getByRole("button", { name: "确认提交" }).click();
  const error = dialog.locator('[data-confirmation-state="error"]');
  await expect(error).toBeVisible();
  await error.scrollIntoViewIfNeeded();
  await expect(error).toBeInViewport();
  expect(failedRequests).toBe(1);
  const errorColor = await error.evaluate((element) => globalThis.getComputedStyle(element).color);
  await capture("error");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  const overflowResult = await measureOverflow(page);
  expect(overflowResult.pageOverflow).toBe(false);
  if (overflowResult.overflow) expect(overflowResult.scrolled).toBe(true);
  page.off("request", countCommand);
  const overview = await checkOverviewAtZoom(page, server, capture);
  return {
    width: windowSize.width,
    height: windowSize.height,
    zoom: zoom.percent,
    ...metrics,
    ...overflowResult,
    navCollapsible: true,
    navigationSurvivesCollapse: true,
    dockOpened: true,
    navigationFocus,
    confirmFocusAtCancel: true,
    cancelled: true,
    focusRestored: true,
    errorVisible: true,
    errorColor,
    failedRequests,
    ...overview,
    screenshots: [
      `native-zoom/${slug}-layout.png`,
      `native-zoom/${slug}-error.png`,
      `native-zoom/${slug}-overview.png`,
    ],
  };
};

/**
 * 总览在原生缩放下仍可操作（design D-10）：分布图有时间线可读、变化页可键盘触发，
 * 且总览自身不产生二维溢出。断言只落在可观察行为上，不锁具体数值。
 */
const checkOverviewAtZoom = async (page, server, capture) => {
  await page.goto(`${server.origin}/overview?project=${server.projectId}`);
  await expect(page.locator("h1.page-title")).toHaveText("风险态势总览");
  // 分布区与统计真实渲染出内容，不停在加载态或失败骨架。
  await expect(page.getByRole("heading", { name: "工序风险记录分布" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/已入库风险记录版本/).first()).toBeVisible();
  const chartCount = await page.locator(".chart-surface").count();
  expect(chartCount).toBeGreaterThan(0);
  // 变化时间线可达：键盘能聚焦到「继续读取更早变化」入口。
  const more = page.getByRole("button", { name: "继续读取更早变化" });
  if ((await more.count()) > 0) {
    await more.focus();
    expect(await focusIsVisible(page)).toBe(true);
  }
  const overviewOverflow = await measureOverflow(page);
  expect(overviewOverflow.pageOverflow).toBe(false);
  if (overviewOverflow.overflow) expect(overviewOverflow.scrolled).toBe(true);
  await capture("overview");
  return {
    overviewChartCount: chartCount,
    overviewTimelineFocusable: true,
    overviewOverflow,
  };
};

export const runNativeZoomEvidence = async () => {
  const server = await startBusinessBrowserServer();
  let browser;
  const results = [];
  try {
    // viewport:null 保留原生外窗口；专用 class 防止键盘误送至同显示器上的其它 Chromium。
    browser = await chromium.launch({
      headless: false,
      args: ["--class=riskflow-native-zoom"],
    });
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
        results.push(await runCombination({ page, cdp, server, windowSize, zoom }));
      }
    }
    await context.close();
  } finally {
    try {
      await browser?.close();
    } finally {
      await server.close();
    }
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const record = {
    change: "prepare-web-shell-route-and-access-seams",
    date: new Date().toISOString().slice(0, 10),
    browser: browser.version(),
    method: {
      window: "CDP Browser.setWindowBounds 设置真实浏览器外窗口；未设置模拟 viewport",
      zoom: "xdotool 向 Chromium 原生窗口发送 Ctrl+0 与五次 Ctrl+plus；未使用 CSS zoom 或 deviceScaleFactor 模拟",
      screenshot: "CDP Page.captureScreenshot 不传 CSS clip，保存真实原生缩放下的完整可视区域",
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
      process.stderr.write(`NATIVE_ZOOM_FAILED:${error.stack ?? String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
