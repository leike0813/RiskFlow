/**
 * CH-5 识别工作区原生桌面缩放取证（IP-06 / task 6.2）。
 *
 * 只用真实 Chromium 外窗口 + 原生 Ctrl+0 / Ctrl+plus 缩放：不用模拟 viewport、
 * CSS zoom、deviceScaleFactor 或 pageScaleFactor 代替真实 200%。每个组合实际完成
 * 识别任务、风险记录、详情追溯页签、关联图与工序模型的导航、页签、分页、错误与
 * 焦点操作；有二维溢出时实际改变 scrollLeft。
 *
 * 结果按既有 `evidence/native-zoom.json` 的形态记录：窗口外尺寸与 CSS 视口分开写，
 * 不把 1920 的无溢出记成发生滚动。工具不可用时明确失败，不靠 viewport 近似。
 * 场景取本 change 的识别工作区承载；证据根指向本 change，已归档证据不动。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, expect } from "@playwright/test";

import { startBusinessBrowserServer } from "./business-server.mjs";

const CHANGE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../openspec/changes/redesign-identification-workspace",
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
  const ids = server.identification;
  // 识别任务目录：真实业务事实与筛选控件在原生缩放下可达。
  await page.goto(`${server.origin}/identification?project=${server.projectId}`);
  await expect(page.locator("h1.page-title")).toHaveText("识别任务");
  await expect(page.getByText(ids.completedRunId)).toBeVisible({ timeout: 60_000 });
  const metrics = await page.evaluate(() => ({
    outer: [globalThis.outerWidth, globalThis.outerHeight],
    inner: [globalThis.innerWidth, globalThis.innerHeight],
    dpr: globalThis.devicePixelRatio,
  }));
  expect(metrics.outer).toEqual([windowSize.width, windowSize.height]);
  expect(metrics.dpr).toBeCloseTo(zoom.percent / 100, 2);
  expect(metrics.inner[0]).toBeCloseTo(windowSize.width / (zoom.percent / 100), 0);

  // 左栏折叠与焦点恢复：键盘可达，导航项不因折叠丢失。
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
  // 识别域控件键盘可达：筛选器之后焦点继续移动到下一个控件，焦点环真实可见。
  const statusFilter = page.getByLabel("按状态筛选");
  await statusFilter.focus();
  await page.keyboard.press("Tab");
  const keyboardNavigationContinues = await page.evaluate(
    () =>
      globalThis.document.activeElement !== null &&
      globalThis.document.activeElement !== globalThis.document.body,
  );
  expect(keyboardNavigationContinues).toBe(true);
  const focusRingVisible = await focusIsVisible(page);
  expect(focusRingVisible).toBe(true);

  // 右栏停靠区可开合，页签键盘可达。
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

  const slug = `ch5-${windowSize.width}x${windowSize.height}-${zoom.percent}`;
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

  // 风险记录目录：分页控件真实存在，并按当前页状态如实可用/禁用。
  await page.goto(`${server.origin}/identification/records?project=${server.projectId}`);
  await expect(page.locator("h1.page-title")).toHaveText("风险记录");
  await expect(page.getByText(ids.recordAutoId)).toBeVisible({ timeout: 60_000 });
  const nextPage = page.getByRole("button", { name: "下一页" });
  await expect(nextPage).toBeVisible();
  await nextPage.focus();
  expect(await focusIsVisible(page)).toBe(true);
  // 续页读到真实的后续页，返回首屏再回到第一页。
  const backToFirst = page.getByRole("button", { name: "返回首屏" });
  await expect(backToFirst).toBeDisabled();
  // 续页读到真实的后续页，返回首屏再回到第一页：以记录标识区分两页内容。
  const idCell = page.locator(".data-table-host tbody tr").first().locator("td").last();
  const firstCellText = await idCell.textContent();
  await nextPage.click();
  await expect(backToFirst).toBeEnabled();
  await expect(
    page.locator(".data-table-host tbody tr").first().locator("td").last(),
  ).not.toHaveText(firstCellText);
  await backToFirst.click();
  await expect(page.locator(".data-table-host tbody tr").first().locator("td").last()).toHaveText(
    firstCellText,
  );

  // 风险记录详情：页签键盘可达，追溯区域独立呈现。
  await page.goto(
    `${server.origin}/identification/records/${encodeURIComponent(ids.recordAutoId)}?project=${server.projectId}`,
  );
  await expect(page.locator("h1.page-title")).toHaveText("风险记录详情");
  const traceTab = page.getByRole("tab", { name: "追溯链" });
  await traceTab.focus();
  expect(await focusIsVisible(page)).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "端到端追溯链" })).toBeVisible({
    timeout: 60_000,
  });

  // 错误态：查询中断后如实呈现结构化错误与重试入口；恢复后重试读回真实数据。
  await page.route("**/queries/risk-identification.run-list", (route) => route.abort());
  await page.goto(`${server.origin}/identification?project=${server.projectId}`);
  await expect(page.getByText(/内容加载失败/)).toBeVisible({ timeout: 60_000 });
  await capture("error");
  await page.unroute("**/queries/risk-identification.run-list");
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByText(ids.completedRunId)).toBeVisible({ timeout: 60_000 });

  const overflowResult = await measureOverflow(page);
  expect(overflowResult.pageOverflow).toBe(false);
  if (overflowResult.overflow) expect(overflowResult.scrolled).toBe(true);
  const workspace = await checkIdentificationWorkspaceAtZoom(page, server, capture);
  return {
    width: windowSize.width,
    height: windowSize.height,
    zoom: zoom.percent,
    ...metrics,
    ...overflowResult,
    navCollapsible: true,
    navigationSurvivesCollapse: true,
    dockOpened: true,
    keyboardNavigationContinues,
    focusRingVisible,
    focusRestored: true,
    errorVisible: true,
    errorRetryable: true,
    ...workspace,
    screenshots: [
      `native-zoom/${slug}-layout.png`,
      `native-zoom/${slug}-error.png`,
      `native-zoom/${slug}-overview.png`,
    ],
  };
};

/**
 * 识别工作区在原生缩放下仍可操作：关联图的真实主体选择、工序模型的节点与依赖、
 * 风险详情的证据抽屉都可达。断言只落在可观察行为上，不锁具体数值。
 */
const checkIdentificationWorkspaceAtZoom = async (page, server, capture) => {
  const ids = server.identification;
  await page.goto(`${server.origin}/identification/graph?project=${server.projectId}`);
  await expect(page.locator("h1.page-title")).toHaveText("关联图谱");
  await expect(page.getByLabel("选择关联图主体")).toBeVisible({ timeout: 60_000 });

  await page.goto(`${server.origin}/identification/process-model?project=${server.projectId}`);
  await expect(page.locator("h1.page-title")).toHaveText("工序模型");
  await expect(page.getByText("变径空间扩挖", { exact: true })).toBeVisible({ timeout: 60_000 });

  await page.goto(
    `${server.origin}/identification/records/${encodeURIComponent(ids.recordAutoId)}?project=${server.projectId}`,
  );
  await expect(page.getByText("标准化风险记录", { exact: true })).toBeVisible({ timeout: 60_000 });
  const evidenceButton = page.getByRole("button", { name: /chapter_1-segment_1/ }).first();
  await evidenceButton.focus();
  expect(await focusIsVisible(page)).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.locator(".evidence-drawer-title")).toBeVisible();
  await page.getByRole("button", { name: "关闭证据抽屉" }).click();
  await expect(page.locator(".evidence-drawer")).toHaveCount(0);
  const workspaceOverflow = await measureOverflow(page);
  expect(workspaceOverflow.pageOverflow).toBe(false);
  if (workspaceOverflow.overflow) expect(workspaceOverflow.scrolled).toBe(true);
  await capture("overview");
  return {
    workspaceRegionsVisible: true,
    workspaceFocusable: true,
    overviewOverflow: workspaceOverflow,
  };
};

export const runNativeZoomEvidence = async () => {
  const server = await startBusinessBrowserServer({ dashboardAcceptance: true });
  let browser;
  const results = [];
  try {
    // viewport:null 保留原生外窗口；专用 class 防止键盘误送至同显示器上的其它 Chromium。
    browser = await chromium.launch({
      headless: false,
      args: ["--class=riskflow-native-zoom"],
    });
    // 服务是真实 HTTPS（自签 loopback 证书）；只忽略证书信任，不模拟页面或降低 Secure Cookie 语义。
    const context = await browser.newContext({ viewport: null, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
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
    change: "redesign-identification-workspace",
    date: new Date().toISOString().slice(0, 10),
    qualification: "合成样本，待甲方复核",
    projectId: server.projectId,
    projectRevisionRef: server.projectRevisionRef,
    sourceVersionRefs: server.assessmentSourceVersionRefs,
    browser: browser.version(),
    method: {
      window: "CDP Browser.setWindowBounds 设置真实浏览器外窗口；未设置模拟 viewport",
      zoom: "xdotool 向 Chromium 原生窗口发送 Ctrl+0 与五次 Ctrl+plus；未使用 CSS zoom 或 deviceScaleFactor 模拟",
      screenshot: "CDP Page.captureScreenshot 不传 CSS clip，保存真实原生缩放下的完整可视区域",
      checks:
        "实际折叠左栏与右栏、浏览识别任务与风险记录目录、切换详情追溯页签、打开证据抽屉、触发并恢复查询错误；有二维溢出时实际改变 scrollLeft",
      requestBoundary: "错误场景拦截一次识别读查询；不向服务端提交业务命令",
      transport:
        "浏览器访问真实 HTTPS loopback（自签证书仅忽略信任）；Secure/SameSite Cookie 与业务请求未经伪 scheme 或忽略语义处理",
      display:
        "需要至少 2560x1440 的专用 Xvfb；外窗口尺寸由 CDP 设置并严格断言，显示不足会失败而不是裁剪后计为通过",
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
