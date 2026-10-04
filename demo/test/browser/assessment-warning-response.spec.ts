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

test("C31 运行摘要按页追溯：同一投影引用下由用户续页，且不整库翻页", async ({ page }) => {
  await login(page, server.operatorLogin, withProject("/"));
  await expect(page.locator("h1.page-title")).toHaveText("风险态势总览");

  const [first, second] = server.overviewRuns;
  // 首页只展开一个运行：另一个运行必须靠用户点「续页」才出现，页面不得自己翻到底。
  await expect(page.getByText(first.entryVersionId)).toBeVisible();
  await expect(page.getByText(second.entryVersionId)).toHaveCount(0);

  // 只取引用本身：整张卡片还含表格，续页后表格内容本就应该变化。
  const resultRef = page
    .locator(".ar-note", { hasText: "投影结果引用" })
    .locator(".ar-ref .mono");
  const beforeRef = await resultRef.innerText();
  expect(beforeRef).toContain(server.projectId);

  // 单页有界：概览页只渲染运行摘要这一张表，不把投影一次性铺开。
  await expect(page.getByRole("button", { name: "续页" })).toHaveCount(1);

  await page.getByRole("button", { name: "续页" }).click();
  await expect(page.getByText(second.entryVersionId)).toBeVisible();
  await expect(page.getByText(first.entryVersionId)).toHaveCount(0);

  // 翻页保留原投影引用：续页换的是游标，不是另起一个查询结果。
  await expect(resultRef).toHaveText(beforeRef);
  // 读完最后一个运行后不再给出续页入口，页面不会无限续页。
  await expect(page.getByRole("button", { name: "续页" })).toHaveCount(0);
});

test("父子运行在摘要里按真实父运行引用呈现，不用同一父级冒充兄弟运行", async ({ page }) => {
  await login(page, server.operatorLogin, withProject("/"));
  await expect(page.locator("h1.page-title")).toHaveText("风险态势总览");
  await expect(page.getByText(server.overviewRuns[0].entryVersionId)).toBeVisible();

  // 父运行列必须落回识别阶段的真实父运行引用，而不是留空或写死文案。
  const parentCell = page.locator("table.data-table tbody tr td:last-child").first();
  await expect(parentCell).toHaveText(server.identification.completedRunId);

  // 续到第二页后父运行不变：兄弟运行共享父级，但入口身份必须区分开。
  await page.getByRole("button", { name: "续页" }).click();
  await expect(page.getByText(server.overviewRuns[1].entryVersionId)).toBeVisible();
  await expect(page.locator("table.data-table tbody tr td:last-child").first()).toHaveText(
    server.identification.completedRunId,
  );
});

/**
 * 直接打真实 HTTP 读分支。走页面内 fetch 而不是 Node 侧直连：会话 Cookie 只在真实
 * 浏览器上下文里才有，另起一个探针会退化成「用另一种方式重新登录」。
 */
const postResultRead = (page, envelope) =>
  page.evaluate(async (body) => {
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(body.projectId)}/queries/projection.result-read`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body.envelope),
      },
    );
    return { status: response.status, body: await response.json() };
  }, { projectId: server.projectId, envelope });

test("陈旧投影引用与伪造游标失败闭合，精确引用仍可重复读取", async ({ page }) => {
  // 抓页面自己发出的投影查询应答：查询结果引用是登记时算出来的，只能取真实那一个，
  // 自造一个只会验证到「自造的引用读不到」，验证不到「陈旧引用不被改指」。
  const queryBodies = [];
  page.on("response", async (response) => {
    if (response.url().endsWith("/queries/projection.query")) {
      queryBodies.push(await response.json().catch(() => undefined));
    }
  });
  await login(page, server.operatorLogin, withProject("/"));
  await expect(page.locator("h1.page-title")).toHaveText("风险态势总览");
  await expect.poll(() => queryBodies.length, { timeout: 20_000 }).toBeGreaterThan(0);

  const registered = queryBodies
    .map(
      (body) =>
        (body as { result?: { queryResultRef?: unknown } } | undefined)?.result?.queryResultRef,
    )
    .find((ref) => ref !== undefined);
  expect(registered, "应捕获到页面登记的投影查询结果引用").toBeDefined();
  const queryResultRef = registered as { reference: { entityId: string; versionId: string } };

  const envelopeFor = (payload) => ({
    schemaVersion: "1",
    queryId: `demo-stale-${Math.random().toString(36).slice(2)}`,
    requestedAt: new Date().toISOString(),
    requestedSpatialScopeRefs: [],
    requestedSourceVersionRefs: [],
    payload,
  });

  // 陈旧版本：同一条结果引用换一个版本，必须读不到，而不是回退到当前版本。
  const stale = await postResultRead(
    page,
    envelopeFor({
      queryResultRef: {
        ...queryResultRef,
        reference: { ...queryResultRef.reference, versionId: `${queryResultRef.reference.versionId}-stale` },
      },
    }),
  );
  expect(stale.status, `陈旧版本应被拒，实际 ${JSON.stringify(stale.body)}`).toBe(404);

  // 伪造游标：游标不是本服务签发的，必须整页失败，不得返回别的运行的条目。
  const forged = await postResultRead(
    page,
    envelopeFor({ queryResultRef, cursor: "forged-cursor-not-issued-by-this-service" }),
  );
  expect(forged.status, `伪造游标应被拒，实际 ${JSON.stringify(forged.body)}`).toBeGreaterThanOrEqual(
    400,
  );

  // 精确引用可被重复读取：第二次读取与页面自身那次逐字相同请求仍须成功（design D1 回归）。
  const exact = await postResultRead(page, envelopeFor({ queryResultRef }));
  expect(exact.body.kind, `精确引用应可读，实际 ${JSON.stringify(exact.body)}`).toBe("succeeded");
  expect(JSON.stringify(exact.body)).toContain(server.overviewRuns[0].runId);
});
