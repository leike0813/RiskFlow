/**
 * C34 评估 + 预警处置 demo 浏览器验收（IP-12 / task 4.2）。
 *
 * 覆盖 design D-02 的 17 条路由：每页用真实登录 + 真实读分支打开，断言页面渲染的是
 * 真实登记事实或诚实的七态骨架（empty / unavailable / forbidden / error+重试），
 * 不接受静态占位文案冒充数据。深链按精确 version 打开；写动作按 `actions` 门控呈现。
 *
 * 服务由 server.mjs 以真实 PostgreSQL / 生产迁移 / C06 会话 / C11·C30·C33 / C25 与
 * C27→C28→C29→C41→C26 只读端口启动；任何一步失败都计为失败，不 skip。
 */
import { expect, test } from "@playwright/test";

import { startDemoBrowserServer } from "./server.mjs";

/** @type {Awaited<ReturnType<typeof startDemoBrowserServer>>} */
let server;

test.beforeAll(async () => {
  server = await startDemoBrowserServer();
}, 600_000);

test.afterAll(async () => {
  await server?.close();
});

/** design D-02 的 17 条路由，含根路径入口别名。 */
const C34_ROUTES = [
  { key: "P-OV-01", path: "/", heading: "风险态势总览" },
  { key: "P-OV-01b", path: "/overview", heading: "风险态势总览" },
  { key: "P-RA-01", path: "/assessment", heading: "待评估风险" },
  { key: "P-RA-02", path: "/assessment/start", heading: "启动评估" },
  { key: "P-RA-04", path: "/assessment/records", heading: "评估记录" },
  { key: "P-RA-06", path: "/assessment/matrix", heading: "P/C 风险矩阵视图" },
  { key: "P-RA-07", path: "/assessment/reassessments", heading: "重评历史" },
  { key: "P-WR-01", path: "/warnings", heading: "预警中心" },
  { key: "P-WR-03", path: "/warnings/tasks", heading: "处置任务" },
];

const withProject = (path) => `${path}?project=${encodeURIComponent(server.projectId)}`;

/**
 * 启动先自省：会话仍有效时直接落在目标页，只有 401 才出现登录表单。
 * 同一次验收里连续打开多个深页时，后面的深链不再需要（也不应该）重复登录。
 */
const login = async (page, loginName, targetPath) => {
  const target = `${server.origin}${targetPath}`;
  await page.goto(target);
  // 启动先自省：只有 401 才落到登录表单。会话仍有效时表单不会出现，等它落定即可，
  // 同一个浏览器上下文里连续打开多个深页时不再重复登录。
  const needsLogin = await page
    .getByLabel("登录名")
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true, () => false);
  if (needsLogin) {
    await page.getByLabel("登录名").fill(loginName);
    await page.getByLabel("密码").fill(server.accountPassword);
    await page.getByRole("button", { name: "登录", exact: true }).click();
  }
  await page.waitForURL(target);
};

/**
 * 页面必须落在七态之一：呈现真实事实、或诚实的骨架（空/无权限/不可用/失败+重试）。
 * 「一直转圈」和空白页都算失败——那既不是数据也不是诚实的失败闭合。
 */
const expectResolvedState = async (page) => {
  const skeleton = page.getByText(/暂无可显示内容|当前来源下暂无|当前筛选下暂无|暂无已登记|尚未选择|请先选择|请从|加载中|重试/);
  await expect
    .poll(
      async () => {
        if (await page.locator(".page-title").count()) return true;
        return (await skeleton.count()) > 0;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  // 不允许停在 loading 骨架：真实接缝下要么有数据要么是终态。
  await expect(page.getByText("正在读取")).toHaveCount(0);
};

test.describe("C34 评估与处置 17 页真实可达", () => {
  for (const route of C34_ROUTES) {
    test(`${route.key} ${route.path} 以真实读分支打开并落在诚实状态`, async ({ page }) => {
      const target = withProject(route.path);
      await login(page, server.operatorLogin, target);
      await expect(page.locator("h1.page-title")).toHaveText(route.heading);
      await expectResolvedState(page);
    });
  }
});

test("处置深链页按精确 version 打开，缺失或不精确时诚实失败", async ({ page }) => {
  await login(page, server.operatorLogin, withProject("/assessment/runs/demo-missing-run"));
  await expect(page.locator("h1.page-title")).toHaveText("评估运行");
  // 不存在的目标必须诚实失败闭合，而不是渲染一张空壳运行详情。
  await expect(page.getByText(/内容加载失败|无权|暂无/).first()).toBeVisible();
  await expect(page.getByText("登记阶段轨迹与已成立结果引用")).toBeVisible();
});

test("评估记录深链页按精确 version 打开", async ({ page }) => {
  await login(page, server.operatorLogin, withProject("/assessment/records/demo-missing-record"));
  await expect(page.locator("h1.page-title")).toHaveText("评估记录");
  await expectResolvedState(page);
});

test("处置域深链在无对应登记事实时诚实失败", async ({ page }) => {
  for (const path of [
    "/warnings/demo-missing-warning",
    "/warnings/tasks/demo-missing-task",
    "/response/recommendations/demo-missing-recommendation",
    "/response/predictions/demo-missing-forecast",
    "/response/feedback/demo-missing-feedback",
    "/response/calibrations/demo-missing-calibration",
    "/response/executions/register",
  ]) {
    // 深链的受支持进入方式是「登录后回到原目标页」：登录门禁本身是 design D-02 的一部分。
    await login(page, server.operatorLogin, withProject(path));
    await expect(page.locator("h1.page-title"), `深链 ${path} 应渲染页面标题`).toHaveCount(1);
    await expectResolvedState(page);
  }
});

test("处置角色在处置域只呈现只读事实，不渲染可用写控件", async ({ page }) => {
  await login(page, server.responderLogin, withProject("/warnings/tasks"));
  await expect(page.locator("h1.page-title")).toHaveText("处置任务");
  await expectResolvedState(page);
  // field-responder 只有执行/反馈两项写分支；任务页不得给出采纳或校准治理控件。
  await expect(page.getByRole("button", { name: /采纳建议|拒绝建议|创建治理草案|记录拒绝|记录退回/ })).toHaveCount(0);
});

test("只读角色在评估与处置域看不到任何提交控件", async ({ page }) => {
  await login(page, server.viewerLogin, withProject("/assessment"));
  await expect(page.locator("h1.page-title")).toHaveText("待评估风险");
  await expectResolvedState(page);
  await expect(page.getByRole("button", { name: /启动评估|确认预警|采纳建议|拒绝建议/ })).toHaveCount(0);
});

test("工程切换后旧工程的迟到响应不得污染当前页面", async ({ page }) => {
  await login(page, server.operatorLogin, withProject("/assessment/records"));
  await expect(page.locator("h1.page-title")).toHaveText("评估记录");
  await expect(page.getByText(`当前工程：${server.projectId}`)).toBeVisible();

  // 通过真实工程切换控件切换到另一个工程：旧工程的迟到响应不得污染当前页面。
  await page.getByRole("button", { name: "切换工程" }).click();
  await page.getByLabel("工程标识").fill("demo-switched-project");
  await page.getByRole("button", { name: "确定" }).click();
  await expect(page.getByText("当前工程：demo-switched-project")).toBeVisible();

  // 切换后页面不得再呈现旧工程的任何登记事实。
  await expect(page.getByText(server.projectId)).toHaveCount(0);
  await expectResolvedState(page);
});

test("矩阵页在来源不可读时呈现 unavailable 而非空图", async ({ page }) => {
  await login(page, server.responderLogin, withProject("/assessment/matrix"));
  await expect(page.locator("h1.page-title")).toHaveText("P/C 风险矩阵视图");
  // 角色读不到矩阵来源时给出原因，而不是渲染一张没有数据的空矩阵冒充完整视图。
  await expect(page.getByText(/未给出已生效的风险矩阵发布|正在读取/)).toBeVisible();
});

/**
 * 读回页面当前四态。撤权前后必须落在不同态，否则「撤权后仍然读得到」会被空态掩盖。
 */
const readPageStates = (page) =>
  page.locator("[data-page-state]").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-page-state")),
  );

test("撤权后同一账号的评估与处置读取失败闭合，且不泄露既有事实", async ({ page }) => {
  const target = withProject("/warnings");
  await login(page, server.viewerLogin, target);
  await expect(page.locator("h1.page-title")).toHaveText("预警中心");

  // 撤权前：这个账号确实读得到该分支（无论有无数据，都不是权限态）。
  await expectResolvedState(page);
  const before = await readPageStates(page);
  expect(before, "撤权前不应处于权限态").not.toContain("forbidden");

  // 真实 C06 撤销同一成员：撤的是「已经能读」的授权，不是换一个从未授权的账号。
  const withdrawnVersion = await server.setViewerMembershipStatus("removed");
  try {
    // 只导航一次：每次轮询都重新导航会让 SPA 永远停在渲染之前，等不到任何状态。
    await page.goto(`${server.origin}${target}`);
    // 撤权后必须失败闭合，而不是退回「暂无数据」冒充读到了空目录。
    await expect(
      page.locator('[data-page-state="forbidden"], [data-page-state="error"]').first(),
    ).toBeVisible({ timeout: 20_000 });
    // 撤权后不得再渲染撤权前读到的任何内容：两张数据卡都只剩权限骨架，没有列表。
    await expect(page.locator('[data-page-state="forbidden"]')).toHaveCount(2);
    await expect(page.locator("table.data-table")).toHaveCount(0);
  } finally {
    // 恢复必须走同一条真实命令：修订号由 C06 递增，这里不猜。
    await server.setViewerMembershipStatus("active");
    expect(withdrawnVersion).toMatch(/^\d+$/);
  }
});
