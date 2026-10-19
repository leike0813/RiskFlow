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

import { startBusinessBrowserServer } from "./business-server.mjs";

/** @type {Awaited<ReturnType<typeof startBusinessBrowserServer>>} */
let server;

test.beforeAll(async () => {
  server = await startBusinessBrowserServer();
}, 600_000);

test.afterAll(async () => {
  await server?.close();
});

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(20_000);
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

/** 宿主上下文栏里的工程下拉取值：这是工程切换的真实可观察面。 */
const selectedProjectValue = (page) =>
  page.locator('div[aria-label="工程上下文"] select').first().inputValue();
// inputValue() 是异步的：不 await 会把 Promise 当成取值断言，等于什么都没验。
const expectSelectedProject = (page, expected) =>
  expect.poll(() => selectedProjectValue(page), { timeout: 20_000 }).toBe(expected);

const withProject = (path, extraParams = {}) => {
  const [base, existing = ""] = path.split("?");
  // 工程参数放首位：页面按 URL 自省工程上下文，深链的 version 只能跟在后面。
  const params = new URLSearchParams({ project: server.projectId });
  for (const [key, value] of new URLSearchParams(existing)) params.set(key, value);
  for (const [key, value] of Object.entries(extraParams)) params.set(key, value);
  params.set(
    "assessmentSources",
    JSON.stringify({
      projectId: server.projectId,
      revisionId: params.get("revision")?.split("@").at(-1) ?? null,
      refs: server.assessmentSourceVersionRefs,
    }),
  );
  return `${base}?${params.toString()}`;
};

/**
 * 表单里录入的发生时间取「下一个整分钟」。
 *
 * `datetime-local` 只接受分钟精度的本地时间值，带秒会被判 Malformed value，所以只能截到
 * 分钟；但向下截会落到提交之前，而 C28 要求「发生时间不得早于采纳决定」——采纳决定的
 * `decidedAt` 由应用按秒级 ISO 落库，截到分钟的取值在同一分钟内总比它早，写命令于是按
 * `response-execution-source-invalid` 关闭。向上取整则稳定落在决定之后。
 */
const localDateTimeNow = (page) =>
  page.evaluate(() => {
    const next = new Date(Math.ceil(Date.now() / 60_000) * 60_000);
    return new Date(next.getTime() - next.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });

/** 唯一确认对话框是原生 `<dialog>`：按对话框角色定位，不再依赖任何自定义类名。 */
const confirmationDialog = (page) => page.getByRole("dialog");

/**
 * 收口成功态对话框：提交成功后原生 dialog 仍留在页面上（只呈现「命令已提交」），
 * 若调用方随成功刷新或导航而卸载了触发组件，对话框随之消失。两条路都收口到「对话框不存在」。
 */
const closeConfirmationDialog = async (page) => {
  const dialog = confirmationDialog(page);
  // 提交成功后对话框有两种归宿：触发组件随刷新或导航卸载，或仍以成功态停留。
  // 两种都收口到「对话框不再存在」——还在就按取消，仍在提交中就等它落定。
  await expect(async () => {
    if (!(await dialog.isVisible().catch(() => false))) return;
    const cancel = dialog.getByRole("button", { name: "取消", exact: true });
    if (!(await cancel.isEnabled().catch(() => false))) return;
    await cancel.click({ timeout: 2_000 });
    await expect(dialog).toHaveCount(0);
  }).toPass({ timeout: 30_000 });
  await expect(dialog).toHaveCount(0);
};

test("资料来源由用户声明，修改范围重新读取，切换工程清除来源", async ({ page }) => {
  await login(page, server.operatorLogin, `/assessment/records?project=${server.projectId}`);
  await expect(page.getByRole("button", { name: "资料来源：未选择" })).toBeVisible();
  await page.getByRole("button", { name: "资料来源：未选择" }).click();
  await page.getByLabel("资料来源版本").fill(JSON.stringify(server.assessmentSourceVersionRefs));
  const request = page.waitForRequest(
    (req) =>
      req.url().endsWith("/queries/risk-assessment.read") &&
      req.postDataJSON().payload.operation === "record-catalog" &&
      req.postDataJSON().requestedSourceVersionRefs.length > 0,
  );
  const response = page.waitForResponse(
    (res) =>
      res.url().endsWith("/queries/risk-assessment.read") &&
      res.request().postDataJSON().payload.operation === "record-catalog" &&
      res.request().postDataJSON().requestedSourceVersionRefs.length > 0,
  );
  await page.getByRole("button", { name: "应用来源", exact: true }).click();
  expect((await request).postDataJSON().requestedSourceVersionRefs).toEqual(
    server.assessmentSourceVersionRefs.map((reference) => ({ kind: "source-version", reference })),
  );
  expect((await response).status()).toBe(200);
  await page.getByLabel("工程标识").fill("demo-other-project");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.getByRole("button", { name: "资料来源：未选择" })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("assessmentSources")).toBe(false);
});

/**
 * 启动先自省：会话仍有效时直接落在目标页，只有 401 才出现登录表单。
 * 同一次验收里连续打开多个深页时，后面的深链不再需要（也不应该）重复登录。
 */
/**
 * 登录闸门的稳定定位。
 *
 * `getByLabel("登录名")` 在账号与权限页会命中「新建账号」表单里的同名字段——运维面登录后
 * 页面上仍有一个登录名输入，闸门判定就永远不成立。按登录表单独有的字段名定位。
 */
const loginGate = (page) => page.locator('input[name="loginName"]');

const login = async (page, loginName, targetPath) => {
  const target = `${server.origin}${targetPath}`;
  await page.goto(target);
  // 启动先自省：只有 401 才落到登录表单。会话仍有效时表单不会出现，等它落定即可，
  // 同一个浏览器上下文里连续打开多个深页时不再重复登录。
  // 登录闸门落得比首屏慢：会话自省 401 之后表单才出现。
  // 原来只等 5 秒，慢启动时会把「还没落定」误判成「会话仍有效」，随后表单才出现、登录被跳过。
  // 不能拿页壳当「已登录」的信号——登录闸门本身也渲染页壳。
  const needsLogin = await loginGate(page)
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(
      () => true,
      () => false,
    );
  if (needsLogin) {
    // 提交最多两次：整页重载后首次点击偶尔落在控件接管之前，表单留在原地，
    // 看着像登录失败，其实是提交没发出去。重填重发一次，仍不落下就如实判失败。
    for (let attempt = 0; attempt < 2 && (await loginGate(page).count()) > 0; attempt += 1) {
      await loginGate(page).fill(loginName);
      await page.getByLabel("密码").fill(server.accountPassword);
      await page.getByRole("button", { name: "登录", exact: true }).click();
      if (attempt === 0)
        await Promise.race([
          loginGate(page).waitFor({ state: "detached", timeout: 10_000 }),
          page.waitForTimeout(10_000),
        ]);
    }
  }
  // 等登录闸门落下，再确认落在目标路由上。
  // 只比路由，不比整串查询串：查询串由页面自己收口，运行页在 resolve 后会换成带 version 的深链。
  // 根路径是 /overview 的入口别名，应用把地址规范化到 /overview，两者都算落定。
  // 深链由应用在登录后自己导航过去；那种情况地址此刻还没到位，重放一次导航让判定落在确定地址上。
  await expect(loginGate(page)).toHaveCount(0, { timeout: 60_000 });
  const expectedPath = new URL(target).pathname;
  const settled = (path) => path === expectedPath || (expectedPath === "/" && path === "/overview");
  const currentPath = () => new URL(page.url()).pathname;
  if (!settled(currentPath())) {
    // 深链由应用在登录后自己导航过去；那种情况地址此刻还没到位，重放一次导航让判定落在确定地址上。
    await page.goto(target);
  }
  expect(settled(currentPath())).toBe(true);
};

/**
 * 页面必须落在七态之一：呈现真实事实、或诚实的骨架（空/无权限/不可用/失败+重试）。
 * 「一直转圈」和空白页都算失败——那既不是数据也不是诚实的失败闭合。
 */
const expectResolvedState = async (page) => {
  const skeleton = page.getByText(
    /暂无可显示内容|当前来源下暂无|当前筛选下暂无|暂无已登记|尚未选择|请先选择|请从|加载中|重试/,
  );
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
  // 七个深链逐个登录打开，每个都走一次完整首屏读取，120 秒不够。
  test.setTimeout(300_000);
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
  await expect(
    page.getByRole("button", { name: /采纳建议|拒绝建议|创建治理草案|记录拒绝|记录退回/ }),
  ).toHaveCount(0);
});

test("只读角色在评估与处置域看不到任何提交控件", async ({ page }) => {
  await login(page, server.viewerLogin, withProject("/assessment"));
  await expect(page.locator("h1.page-title")).toHaveText("待评估风险");
  await expectResolvedState(page);
  await expect(
    page.getByRole("button", { name: /启动评估|确认预警|采纳建议|拒绝建议/ }),
  ).toHaveCount(0);
});

test("工程切换后旧工程的迟到响应不得污染当前页面", async ({ page }) => {
  await login(page, server.operatorLogin, withProject("/assessment/records"));
  await expect(page.locator("h1.page-title")).toHaveText("评估记录");
  await expectSelectedProject(page, server.projectId);

  // 通过真实工程切换控件切换到另一个工程：旧工程的迟到响应不得污染当前页面。
  await page.getByLabel("工程标识").fill("demo-switched-project");
  await page.getByRole("button", { name: "确定" }).click();
  await expectSelectedProject(page, "demo-switched-project");

  // 切换后页面不得再呈现旧工程的任何登记事实。工程下拉里仍列着可选工程，那是工程目录
  // 本身而不是旧工程的事实，所以断言只落在页面主体上。
  await expect(page.locator("[data-page-section]").getByText(server.projectId)).toHaveCount(0);
  await expectResolvedState(page);
});

test("矩阵来源请求失败时安全收口且不绘制空图", async ({ page }) => {
  await page.route("**/queries/knowledge-modeling.governance-read", (route) =>
    route.abort("failed"),
  );
  await login(page, server.responderLogin, withProject("/assessment/matrix"));
  await expect(page.locator("h1.page-title")).toHaveText("P/C 风险矩阵视图");
  await expect(page.locator('[data-page-state="error"]')).toBeVisible();
  await expect(page.getByRole("img", { name: "P/C 风险矩阵" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重试", exact: true })).toBeEnabled();
});

/**
 * 读回页面当前四态。撤权前后必须落在不同态，否则「撤权后仍然读得到」会被空态掩盖。
 */
const readPageStates = (page) =>
  page
    .locator("[data-page-state]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-page-state")));

/**
 * CH-3 仪表盘单来源故障：故障在真实 Adapter 之外注入，其余来源仍走真实读。
 * 观察走正式 dashboard HTTP，页面必须只让故障来源进入失败闭合，
 * 其它来源保留自己的统计、范围与时点，且不把缺权／失败折算成零值。
 */
for (const failedSource of ["assessments", "warnings", "documents"]) {
  test(`仪表盘来源 ${failedSource} 失败时其它来源保留独立统计与时点`, async ({ page }) => {
    server.setDashboardSourceFailure(failedSource);
    try {
      await login(page, server.operatorLogin, withProject("/overview"));
      // 失败来源显示安全失败与重试入口，不显示零值。
      // 同一来源可能承载多张卡片（预警同时供待复核与开放任务区），因此只断言失败态存在。
      const failed = page.locator('[data-source-state="failed"]');
      await expect(failed.first()).toBeVisible();
      await expect(failed.first().getByRole("button", { name: "重试" })).toBeEnabled();
      // 其它来源仍呈现真实统计：风险记录来源与本用例的故障来源无关。
      await expect(page.getByRole("heading", { name: "工序风险记录分布" })).toBeVisible();
      await expect(page.getByText(/asOf/).first()).toBeVisible();
      // 历史运行区不被仪表盘单来源失败遮住。
      await expect(page.getByText(server.overviewRuns[0].entryVersionId)).toBeVisible();

      // 切工程后旧上下文的统计与事件都不再呈现。
      await page.getByLabel("工程标识").fill("demo-switched-project");
      await page.getByRole("button", { name: "确定" }).click();
      await expectSelectedProject(page, "demo-switched-project");
      await expect(page.getByText(server.overviewRuns[0].entryVersionId)).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "工序风险记录分布" })).toHaveCount(0);
    } finally {
      server.setDashboardSourceFailure(null);
    }
  });
}

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
  const resultRef = page.locator(".ar-note", { hasText: "投影结果引用" }).locator(".ar-ref .mono");
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
  // 总览现在同时承载识别运行与链运行两张表，断言只落在链运行那张。
  const chainRunsTable = page
    .locator(".data-table-host table")
    .filter({ hasText: server.overviewRuns[0].entryVersionId });
  const parentCell = chainRunsTable.locator("tbody tr td:last-child").first();
  await expect(parentCell).toHaveText(server.identification.completedRunId);

  // 续到第二页后父运行不变：兄弟运行共享父级，但入口身份必须区分开。
  await page.getByRole("button", { name: "续页" }).click();
  await expect(page.getByText(server.overviewRuns[1].entryVersionId)).toBeVisible();
  await expect(
    page
      .locator(".data-table-host table")
      .filter({ hasText: server.overviewRuns[1].entryVersionId })
      .locator("tbody tr td:last-child")
      .first(),
  ).toHaveText(server.identification.completedRunId);
});

/**
 * 直接打真实 HTTP 读分支。走页面内 fetch 而不是 Node 侧直连：会话 Cookie 只在真实
 * 浏览器上下文里才有，另起一个探针会退化成「用另一种方式重新登录」。
 */
const postResultRead = (page, envelope) =>
  page.evaluate(
    async (body) => {
      const response = await fetch(
        `/api/v1/projects/${encodeURIComponent(body.projectId)}/queries/projection.result-read`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body.envelope),
        },
      );
      return { status: response.status, body: await response.json() };
    },
    { projectId: server.projectId, envelope },
  );

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
        reference: {
          ...queryResultRef.reference,
          versionId: `${queryResultRef.reference.versionId}-stale`,
        },
      },
    }),
  );
  expect(stale.status, `陈旧版本应被拒，实际 ${JSON.stringify(stale.body)}`).toBe(404);

  // 伪造游标：游标不是本服务签发的，必须整页失败，不得返回别的运行的条目。
  const forged = await postResultRead(
    page,
    envelopeFor({ queryResultRef, cursor: "forged-cursor-not-issued-by-this-service" }),
  );
  expect(
    forged.status,
    `伪造游标应被拒，实际 ${JSON.stringify(forged.body)}`,
  ).toBeGreaterThanOrEqual(400);

  // 精确引用可被重复读取：第二次读取与页面自身那次逐字相同请求仍须成功（design D1 回归）。
  const exact = await postResultRead(page, envelopeFor({ queryResultRef }));
  expect(exact.body.kind, `精确引用应可读，实际 ${JSON.stringify(exact.body)}`).toBe("succeeded");
  expect(JSON.stringify(exact.body)).toContain(server.overviewRuns[0].runId);
});

/**
 * 走页面内 fetch 打真实 HTTP 命令/查询。浏览器上下文里才有会话 Cookie，另起探针会
 * 退化成「用另一种方式重新登录」。
 */
const postBranch = (page, branch, envelope, kind) =>
  page.evaluate(
    async ({ branch: targetBranch, envelope: body, kind: envelopeKind }) => {
      const response = await fetch(
        `/api/v1/projects/${encodeURIComponent(body.projectId)}/${envelopeKind}/${targetBranch}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body.envelope),
        },
      );
      return { status: response.status, body: await response.json() };
    },
    {
      branch,
      kind,
      // 工程只在 URL 上；信封是 strict 的，多带 projectId 会被 C30 判为契约不符。
      envelope: { projectId: server.projectId, envelope },
    },
  );

/** 真实跑一次初评并取回该次评估真实开立的预警与任务引用。 */
const startRealAssessmentAndReadWarnings = async (page, suffix, options = {}) => {
  const commandId = `spec-real-assess-${suffix}`;
  const started = await postBranch(
    page,
    "workflow.start-run",
    {
      schemaVersion: "1",
      commandId,
      idempotencyKey: commandId,
      issuedAt: new Date().toISOString(),
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      payload: { ...server.assessStartInput, ...options.startInput, entryMode: "assess" },
    },
    "commands",
  );
  expect(started.status, `真实初评应被受理，实际 ${JSON.stringify(started.body)}`).toBe(200);

  const catalog = await postBranch(
    page,
    "warning-response.read",
    {
      schemaVersion: "1",
      queryId: `spec-real-warnings-${suffix}`,
      requestedAt: new Date().toISOString(),
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      payload: { operation: "warning-catalog", pageSize: 10 },
    },
    "queries",
  );
  expect(catalog.status, `预警目录应可读，实际 ${JSON.stringify(catalog.body)}`).toBe(200);
  const items = catalog.body.result.items;
  expect(Array.isArray(items) && items.length > 0, "真实初评应开立预警").toBe(true);
  // 目录里同时混有播种链登记的预警引用：那些在 C26 自有表里没有行，正文读会返回
  // 不可用（HTTP 200 + unavailable 信封）。只认真正读得出正文的那条，不按标识形态猜。
  for (const item of items) {
    const record = await postBranch(
      page,
      "warning-response.read",
      {
        schemaVersion: "1",
        queryId: `spec-real-warning-record-${suffix}-${item.warningRecordRef.reference.entityId}`,
        requestedAt: new Date().toISOString(),
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        payload: { operation: "warning-read", warningRecordRef: item.warningRecordRef },
      },
      "queries",
    );
    if (record.status !== 200 || record.body?.kind !== "succeeded") continue;
    // 同一条风险记录在同一触发类型下复用同一条预警记录：早先场景成立的确认事实会跟着这条
    // 记录一起被读到。需要「待确认」的场景必须显式排除，否则断言随场景顺序漂移。
    if (options.requirePending === true && record.body.result.acknowledgement !== undefined) {
      continue;
    }
    return record.body.result;
  }
  throw new Error("真实初评开立的预警都读不出正文");
};

test("响应丢失后重试逐字节复用首次冻结的完整信封，服务端只登记一次确认事实", async ({ page }) => {
  test.setTimeout(180_000);
  // 用真实初评开立的预警，不用播种链：确认动作要在 C26 自有行上成立，播种事实没有
  // 可确认的预警，按钮只会呈现不可用。
  await login(page, server.operatorLogin, withProject("/warnings"));
  // 本场景要断言的是「重试后仍待确认」，因此必须挑一条确定未被确认的预警：同一条风险记录
  // 在同一触发类型下复用同一条预警记录，早先场景成立的确认事实会跟着被读到。
  const real = await startRealAssessmentAndReadWarnings(page, "ack-retry", {
    requirePending: true,
  });

  // 深链同时带工程与精确 version：查询参数要合并，拼成 `version=1?project=…` 会让页面
  // 解析不出工程，读不到预警事实，动作可用性自然是 null。进入方式与其它深链场景一致：
  // 经登录门禁直接落在目标页，而不是先停在别处再整页跳转。
  const target = withProject(
    `/warnings/${encodeURIComponent(real.warningRecordRef.reference.entityId)}`,
    { version: real.warningRecordRef.reference.versionId },
  );
  const readWarning = async (suffix) => {
    const result = await postBranch(
      page,
      "warning-response.read",
      {
        schemaVersion: "1",
        queryId: `spec-ack-read-${suffix}`,
        requestedAt: new Date().toISOString(),
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        payload: { operation: "warning-read", warningRecordRef: real.warningRecordRef },
      },
      "queries",
    );
    return result.body?.kind === "succeeded" ? result.body.result : undefined;
  };

  await login(page, server.operatorLogin, target);
  await expect(page.locator("h1.page-title")).toHaveText("预警详情");
  await expect(page.locator(".wd-header-actions")).toContainText("待确认");

  // 故障注入：首次请求用 `route.fetch()` 真实送到服务端执行，再把应答掐断——这才是
  // 「服务端已提交、响应丢失」。此前用 `route.abort()` 直接掐在转发之前，请求根本没
  // 到达服务端，测的是网络失败而不是响应丢失。
  const envelopes: string[] = [];
  const handlerLog: string[] = [];
  const firstServerResult: { status?: number; body?: unknown } = {};
  const replayed = [];
  page.on("response", async (response) => {
    // 599 是本场景注入的「响应丢失」，不计入重放结果。
    if (
      response.url().endsWith("/commands/warning-response.acknowledge") &&
      response.status() !== 599
    ) {
      replayed.push({ status: response.status(), body: await response.text().catch(() => "") });
    }
  });
  let dropped = false;
  await page.route("**/commands/warning-response.acknowledge", async (route) => {
    const envelope = route.request().postData() ?? "";
    envelopes.push(envelope);
    handlerLog.push(`invoked dropped=${String(dropped)}`);
    if (!dropped) {
      dropped = true;
      // 「服务端已提交、响应丢失」：用同一份信封真实打一次服务端（`page.request` 与页面
      // 共享会话），再让页面这边收到一个网络层失败，用户因此不知道提交结果。
      const direct = await page.request.post(route.request().url(), {
        headers: { ...route.request().headers(), origin: server.origin },
        data: envelope,
      });
      firstServerResult.body = await direct.json();
      firstServerResult.status = direct.status();
      await route.fulfill({ status: 599, contentType: "text/plain", body: "response dropped" });
      return;
    }
    await route.continue();
  });

  // 首次确认的应答被掐断时，对话框留在原处等重试：因此这里先看对话框是否已开，
  // 已开就直接复用，不再去点触发按钮（否则会同时命中按钮与对话框里的确认）。
  const confirm = async () => {
    const dialog = confirmationDialog(page);
    if (!(await dialog.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "确认预警", exact: true }).click();
      await expect(dialog).toBeVisible();
    }
    // 首次提交走「确认提交」；可重试失败态下对话框只给「重试」，两者重发同一份冻结信封。
    const retry = dialog.getByRole("button", { name: "重试", exact: true });
    if (await retry.isVisible().catch(() => false)) await retry.click();
    else await dialog.getByRole("button", { name: "确认提交" }).click();
  };

  await confirm();
  // 轮询服务端结果本身：路由处理器在捕获信封后才真正发请求，直接读状态会与它竞态。
  await expect.poll(() => firstServerResult.status, { timeout: 30_000 }).toBe(200);
  expect(
    firstServerResult.body,
    `首次请求必须真的执行到服务端，路由日志 ${JSON.stringify(handlerLog)}`,
  ).toMatchObject({ kind: "succeeded", result: { status: "acknowledged" } });

  // 服务端侧证据：确认事实在应答丢失之前就已落库，重试之前就能读到。
  await expect
    .poll(async () => (await readWarning("after-first"))?.acknowledgement?.actorId, {
      timeout: 30_000,
    })
    .toBeTruthy();

  // 失败态如实呈现安全错误字段：网络层失败闭合为可重试的 TRANSIENT_FAILURE，不是原始响应。
  const dialog = confirmationDialog(page);
  const failure = dialog.locator("[data-confirmation-state='error']");
  await expect(failure).toContainText("TRANSIENT_FAILURE");
  await expect(failure).toContainText("可重试");
  await expect(failure.locator("code")).toHaveText("TRANSIENT_FAILURE");
  const failureColor = await failure.evaluate((element) => getComputedStyle(element).color);
  const expectedColor = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--error)";
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
  expect(failureColor).toBe(expectedColor);

  // 响应丢失：用户按同一意图再次确认，必须复用同一冻结信封而不是生成新时间的新命令。
  await confirm();
  await expect.poll(() => envelopes.length, { timeout: 30_000 }).toBe(2);

  expect(envelopes[1], "重试必须逐字节复用首次冻结的完整信封").toBe(envelopes[0]);
  const parsed = JSON.parse(envelopes[0]) as {
    commandId: string;
    idempotencyKey: string;
    issuedAt: string;
    payload: { warningRecordRef: { reference: { entityId: string } } };
  };
  expect(parsed.idempotencyKey).toBe(parsed.commandId);
  expect(parsed.issuedAt, "绑定摘要含签发时刻，重试不得刷新").toBeTruthy();
  expect(parsed.payload.warningRecordRef.reference.entityId).toBe(
    real.warningRecordRef.reference.entityId,
  );

  // 重试按同一命令身份重放：返回成功而不是同键异载荷冲突，也不新建第二条确认事实。
  await expect.poll(() => replayed.length, { timeout: 30_000 }).toBe(1);
  expect(replayed[0].status, `重放应成功，实际 ${replayed[0].body}`).toBe(200);
  const after = await readWarning("after-retry");
  expect(after?.acknowledgement?.acknowledgedAt, "确认事实只有一条且未被覆盖").toBeTruthy();
});

test("取消确认不发出任何写命令，也不留下确认事实", async ({ page }) => {
  test.setTimeout(180_000);
  // 用真实初评开立的预警：确认动作要在 C26 自有行上成立，播种事实没有可确认的预警。
  await login(page, server.operatorLogin, withProject("/warnings"));
  const real = await startRealAssessmentAndReadWarnings(page, "ack-cancel", {
    requirePending: true,
  });
  const target = withProject(
    `/warnings/${encodeURIComponent(real.warningRecordRef.reference.entityId)}`,
    { version: real.warningRecordRef.reference.versionId },
  );

  // 任何写命令都记下来：取消必须一个请求都不发。
  const commands: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/commands/")) commands.push(request.url().split("/commands/")[1]);
  });
  await login(page, server.operatorLogin, target);
  await expect(page.locator(".wd-header-actions")).toContainText("待确认");

  // 页头先于写控件区渲染：先等按钮可点，再点，不靠一次 click 的时序。
  const confirm = page.getByRole("button", { name: "确认预警", exact: true });
  await expect(confirm).toBeVisible();
  await confirm.click();
  const dialog = confirmationDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "确认命令" })).toBeVisible();
  // 焦点落在对话框内，取消可达；关闭后对话框消失，页面仍停在未确认。
  await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // 关闭后焦点归还触发按钮，对话框不再截获后续键盘操作。
  await expect(confirm).toBeFocused();
  expect(commands, "取消不得发出任何写命令").toHaveLength(0);

  const after = await postBranch(
    page,
    "warning-response.read",
    {
      schemaVersion: "1",
      queryId: "spec-cancel-read-1",
      requestedAt: new Date().toISOString(),
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      payload: { operation: "warning-read", warningRecordRef: real.warningRecordRef },
    },
    "queries",
  );
  expect(after.body?.result?.acknowledgement, "取消后不得出现确认事实").toBeUndefined();
  await expect(page.locator(".wd-header-actions")).toContainText("待确认");
});

/**
 * 校准闭环的真实证明（design D-03/D-08、IP-12 task 4.2）。
 *
 * 走完整条真实链路：真实初评开立预警 → 确认预警 → 人工采纳建议（C41 内含预测运行）
 * → 登记执行 → 登记正式反馈 → 带 `forecastRef` 重跑 `record-response-feedback` 分段
 * （A2 偏差 + A4 校准：真实 C08 校准任务、增量工件与 `createSuggestion`）→ 校准页读到
 * 真实偏差/操作/校验/Agent 引用 → 页上批准草案创建后只有未发布草案、没有已发布事实。
 *
 * 每一步都经真实 HTTP 命令与真实领域适配器，断言只锁结构化引用、状态枚举与命令回执，
 * 不锁 UI 文案。任何一步没跑通都计为失败，不 skip、不用播种事实冒充命令执行。
 */
test("运行结果与复核任务独立有界续页，终态保留引用", async ({ page }) => {
  await login(page, server.operatorLogin, withProject("/warnings"));
  const read = (payload) =>
    postBranch(
      page,
      "risk-assessment.read",
      {
        schemaVersion: "1",
        queryId: `run-page-${crypto.randomUUID()}`,
        requestedAt: new Date().toISOString(),
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: server.assessmentSourceVersionRefs.map((reference) => ({
          kind: "source-version",
          reference,
        })),
        payload: { operation: "run-read", workflowRunRef: server.paginatedRunRef, ...payload },
      },
      "queries",
    );
  const first = await read({});
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect(first.body.result.resultRefs).toHaveLength(50);
  expect(first.body.result.reviewTaskRefs).toHaveLength(50);
  const second = await read({ resultCursor: first.body.result.nextCursor });
  expect(second.status, JSON.stringify(second.body)).toBe(200);
  expect(second.body.result.resultRefs).toHaveLength(5);
  expect(second.body.result.reviewTaskRefs).toHaveLength(50);
  const third = await read({ resultCursor: second.body.result.nextCursor });
  expect(third.status, JSON.stringify(third.body)).toBe(200);
  expect(third.body.result.resultRefs).toEqual([]);
  expect(third.body.result.reviewTaskRefs).toHaveLength(5);
  expect(third.body.result.nextCursor).toBeUndefined();
  const foreign = await read({
    workflowRunRef: server.terminalRunRef,
    resultCursor: first.body.result.nextCursor,
  });
  expect(foreign.status).toBeGreaterThanOrEqual(400);
  expect(
    new Set(
      [...first.body.result.resultRefs, ...second.body.result.resultRefs].map(
        (ref) => ref.reference.entityId,
      ),
    ).size,
  ).toBe(55);
  expect(
    new Set(
      [
        ...first.body.result.reviewTaskRefs,
        ...second.body.result.reviewTaskRefs,
        ...third.body.result.reviewTaskRefs,
      ].map((ref) => ref.reference.entityId),
    ).size,
  ).toBe(105);
  await page.goto(
    `${server.origin}${withProject(
      `/assessment/runs/${server.paginatedRunRef.reference.entityId}`,
      {
        version: server.paginatedRunRef.reference.versionId,
      },
    )}`,
  );
  await expect(page.getByRole("button", { name: "续页" })).toBeVisible();
  await page.getByRole("button", { name: "续页" }).click();
  await expect(page.locator(".ar-two-col li")).toHaveCount(55);
  await page.getByRole("button", { name: "续页" }).click();
  await expect(page.getByRole("button", { name: "续页" })).toHaveCount(0);
  await expect(page.locator(".ar-two-col li")).toHaveCount(5);
});

test("业务准备等待显示缺项，继续提交原准备引用并刷新状态", async ({ page }) => {
  const preparationRef = {
    kind: "workflow-run",
    reference: { entityId: "preparation-ui", versionId: "1" },
  };
  let reads = 0;
  let submission;
  let stateVersion;
  await page.route("**/queries/risk-assessment.read", async (route) => {
    if (route.request().postDataJSON().payload.operation !== "run-read") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    reads += 1;
    stateVersion = body.result.stateVersion.versionId;
    body.result.status = "waiting";
    body.result.waitingRef = {
      kind: "business-preparation",
      stage: "A1",
      preparationRef,
      missingKinds: ["scoring-configuration"],
    };
    body.result.actions = [{ branch: "workflow.resume-run", availability: "allowed" }];
    await route.fulfill({ response, json: body });
  });
  await page.route("**/commands/workflow.resume-run", async (route) => {
    submission = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        kind: "waiting",
        waiting: {
          kind: "business-preparation",
          stage: "A1",
          preparationRef,
          missingKinds: ["scoring-configuration"],
        },
      },
    });
  });
  await login(
    page,
    server.operatorLogin,
    withProject(`/assessment/runs/${server.paginatedRunRef.reference.entityId}`, {
      version: server.paginatedRunRef.reference.versionId,
    }),
  );
  await expect(page.getByText("评分配置", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "准备完成，继续", exact: true }).click();
  const before = reads;
  const dialog = confirmationDialog(page);
  await expect(dialog).toBeVisible();
  // 缺项已在页面上如实列出；确认摘要按精确输入版本绑定当前状态版本，而不是重新取一个。
  await expect(dialog.locator("section[aria-label='输入版本']")).toContainText(
    `${server.paginatedRunRef.reference.entityId}@${stateVersion}`,
  );
  await dialog.getByRole("button", { name: "确认提交" }).click();
  await closeConfirmationDialog(page);
  // 刷新只在 onSucceeded 里发生：等待终局被判成终态失败时不会重读，
  // 因此重读发生即证明恢复运行的 waiting 终局走了成功分支。
  await expect.poll(() => reads).toBeGreaterThan(before);
  // 提交仍带原准备引用与读到的状态版本：继续动作不重造准备事实。
  expect(submission.payload).toEqual({
    workflowRunRef: server.paginatedRunRef,
    expectedStateVersion: stateVersion,
    resumeCause: { kind: "business-preparation-ready", preparationRef },
  });
});

test("慢读取保持单在途轮询，隐藏、终态和卸载停止刷新", async ({ page }) => {
  test.setTimeout(90_000);
  let count = 0;
  let active = 0;
  let maxActive = 0;
  await page.route("**/queries/risk-assessment.read", async (route) => {
    if (route.request().postDataJSON().payload.operation !== "run-read") return route.continue();
    count += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      const response = await route.fetch();
      if (count === 2) await new Promise((resolve) => setTimeout(resolve, 6100));
      await route.fulfill({ response });
    } finally {
      active -= 1;
    }
  });
  await login(
    page,
    server.operatorLogin,
    withProject(`/assessment/runs/${server.paginatedRunRef.reference.entityId}`, {
      version: server.paginatedRunRef.reference.versionId,
    }),
  );
  await expect(page.getByText("waiting", { exact: true }).first()).toBeVisible();
  await expect.poll(() => count, { timeout: 15_000 }).toBe(2);
  await page.waitForTimeout(6500);
  expect(count).toBe(2);
  expect(maxActive).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(5500);
  expect(count).toBe(2);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => count, { timeout: 10_000 }).toBe(3);
  await page.goto(
    `${server.origin}${withProject(`/assessment/runs/${server.terminalRunRef.reference.entityId}`, {
      version: server.terminalRunRef.reference.versionId,
    })}`,
  );
  await expect(page.getByText("terminal-failure", { exact: true }).first()).toBeVisible();
  const terminalCount = count;
  await page.waitForTimeout(5500);
  expect(count).toBe(terminalCount);
  await page.goto(`${server.origin}${withProject("/warnings")}`);
  await page.waitForTimeout(5500);
  expect(count).toBe(terminalCount);
});

test("独立行动使用真实已发布措施，执行与反馈不产生预测或校准", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, server.operatorLogin, withProject("/warnings"));
  const real = await startRealAssessmentAndReadWarnings(page, "independent-action");
  await page.goto(
    `${server.origin}${withProject("/response/executions/register", {
      task: real.taskRef.reference.entityId,
      taskVersion: real.taskRef.reference.versionId,
    })}`,
  );
  await page.getByLabel("执行来源").selectOption("independent-action");
  await page.getByLabel("措施发布标识").fill(server.measureLibraryReleaseRef.entityId);
  await page.getByLabel("措施发布版本").fill(server.measureLibraryReleaseRef.versionId);
  await page.getByLabel("执行发生时间").fill(await localDateTimeNow(page));
  await page.getByLabel("证据来源段标识").fill(server.sourceA.segmentIds[0]);
  await page
    .getByLabel("证据来源版本标识")
    .fill(server.sourceA.sourceVersionRef.reference.entityId);
  await page.getByLabel("证据来源版本号").fill(server.sourceA.sourceVersionRef.reference.versionId);
  await page.getByLabel("措施发布版本").fill("unregistered-version");
  await page.getByRole("button", { name: "登记执行", exact: true }).click();
  const invalidExecution = page.waitForResponse((response) =>
    response.url().endsWith("/commands/warning-response.record-execution"),
  );
  await confirmationDialog(page).getByRole("button", { name: "确认提交" }).click();
  const invalidHttp = await invalidExecution;
  expect(invalidHttp.status()).toBeGreaterThanOrEqual(400);
  expect((await invalidHttp.json()).code).toBe("BUSINESS_BLOCKED");
  expect(new URL(page.url()).searchParams.get("execution")).toBeNull();
  // 终止失败：对话框如实给出安全错误摘要，只保留取消，计划不得被重试。
  // 服务端错误码由上面的真实应答断言；此处锁确认层对终止失败的处理。
  const blockedFailure = confirmationDialog(page).locator("[data-confirmation-state='error']");
  await expect(blockedFailure).toContainText("不可重试");
  await expect(confirmationDialog(page).getByRole("button", { name: "重试" })).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  await page.getByLabel("措施发布版本").fill(server.measureLibraryReleaseRef.versionId);
  let releaseResponse;
  let recordSubmitted;
  const responseGate = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  const submitted = new Promise((resolve) => {
    recordSubmitted = resolve;
  });
  await page.route("**/commands/warning-response.record-execution", async (route) => {
    const response = await route.fetch();
    recordSubmitted({ response, body: await response.json() });
    await responseGate;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "登记执行", exact: true }).click();
  const executionResponse = page.waitForResponse((response) =>
    response.url().endsWith("/commands/warning-response.record-execution"),
  );
  await confirmationDialog(page).getByRole("button", { name: "确认提交" }).click();
  const { response: executionHttp, body: execution } = await submitted;
  try {
    expect(executionHttp.status(), JSON.stringify(execution)).toBe(200);
    // 提交对话框锁住页面控件；用浏览器历史导航触发同一 SPA 的工程上下文变化。
    await page.evaluate(() => {
      const target = new URL(location.href);
      target.searchParams.set("project", "demo-switched-project");
      target.searchParams.delete("assessmentSources");
      history.pushState({}, "", target);
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await expectSelectedProject(page, "demo-switched-project");
  } finally {
    releaseResponse();
  }
  await executionResponse;
  await page.waitForTimeout(200);
  expect(new URL(page.url()).searchParams.get("execution")).toBeNull();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const executionRef = execution.result.executionRecordRef;
  await page.goto(
    `${server.origin}${withProject("/response/executions/register", {
      task: real.taskRef.reference.entityId,
      taskVersion: real.taskRef.reference.versionId,
      execution: executionRef.reference.entityId,
      version: executionRef.reference.versionId,
    })}`,
  );
  await expect
    .poll(() => new URL(page.url()).searchParams.get("version"))
    .toBe(executionRef.reference.versionId);
  await page.getByLabel("反馈工件标识").fill(server.feedbackArtifactRef.reference.entityId);
  await page.getByLabel("反馈工件版本").fill(server.feedbackArtifactRef.reference.versionId);
  await page
    .getByLabel("处置后监测快照标识")
    .fill(server.settlementMonitoringSnapshotRef.reference.entityId);
  await page
    .getByLabel("处置后监测快照版本")
    .fill(server.settlementMonitoringSnapshotRef.reference.versionId);
  await page.getByLabel("实际评估记录标识").fill(real.assessmentRecordRef.reference.entityId);
  await page.getByLabel("实际评估记录版本").fill(real.assessmentRecordRef.reference.versionId);
  await page.getByLabel("反馈发生时间").fill(await localDateTimeNow(page));
  await page.getByRole("button", { name: "登记反馈", exact: true }).click();
  const feedbackResponse = page.waitForResponse((response) =>
    response.url().endsWith("/commands/warning-response.record-feedback"),
  );
  await confirmationDialog(page).getByRole("button", { name: "确认提交" }).click();
  const feedbackHttp = await feedbackResponse;
  const feedback = await feedbackHttp.json();
  expect(feedbackHttp.status(), JSON.stringify(feedback)).toBe(200);
  await expect(page.locator("h1.page-title")).toHaveText("处置反馈");
  const read = await postBranch(
    page,
    "warning-response.read",
    {
      schemaVersion: "1",
      queryId: `independent-read-${crypto.randomUUID()}`,
      requestedAt: new Date().toISOString(),
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: server.assessmentSourceVersionRefs.map((reference) => ({
        kind: "source-version",
        reference,
      })),
      payload: { operation: "feedback-read", feedbackRef: feedback.result.feedbackRef },
    },
    "queries",
  );
  expect(read.status, JSON.stringify(read.body)).toBe(200);
  expect(read.body.result.executionRef).toEqual(executionRef);
  expect(read.body.result.forecastAvailability.kind).toBe("unavailable");
  expect(read.body.result.deviation).toBeUndefined();
  expect(read.body.result.deviationRecord).toBeUndefined();
  expect(read.body.result.calibrationRefs).toEqual([]);
});

test("采纳、执行与反馈成立真实事实后，偏差驱动出校准建议，批准只生成未发布草案", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await login(page, server.operatorLogin, withProject("/warnings"));
  // 本场景要断言的是「确认成立」，因此必须挑一条确定未被确认的预警：同一条风险记录
  // 在同一触发类型下复用同一条预警记录，前两个场景成立的确认事实会跟着这条记录被读到。
  const real = await startRealAssessmentAndReadWarnings(page, "calibration", {
    requirePending: true,
  });

  // ---- 1. 真实初评开立真实预警：正文、评估记录与任务引用都在 C26/C25 自有行上 ----
  expect(real.warningRecord?.kind ?? "warning-record", `实际 ${JSON.stringify(real)}`).toBe(
    "warning-record",
  );
  expect(real.assessmentRecordRef, "预警必须绑定真实评估记录").toBeTruthy();
  expect(real.taskRef, "预警必须绑定真实处置任务").toBeTruthy();

  // ---- 2. 确认预警（真实 acknowledge 命令，status=acknowledged）----
  const acknowledged = await postBranch(
    page,
    "warning-response.acknowledge",
    {
      schemaVersion: "1",
      commandId: `spec-cal-ack-${real.warningRecordRef.reference.entityId}`,
      idempotencyKey: `spec-cal-ack-${real.warningRecordRef.reference.entityId}`,
      issuedAt: new Date().toISOString(),
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      payload: {
        warningRecordRef: real.warningRecordRef,
        warningResponseTaskRef: real.taskRef,
      },
    },
    "commands",
  );
  expect(acknowledged.status, `确认预警应成立，实际 ${JSON.stringify(acknowledged.body)}`).toBe(
    200,
  );
  expect(
    acknowledged.body?.result?.status,
    `确认回执应为 acknowledged，实际 ${JSON.stringify(acknowledged.body)}`,
  ).toBe("acknowledged");

  // ---- 3. 取真实处置任务关系里的正式建议与采纳前监测快照 ----
  const taskRead = await postBranch(
    page,
    "warning-response.read",
    {
      schemaVersion: "1",
      queryId: `spec-cal-task-${real.taskRef.reference.entityId}`,
      requestedAt: new Date().toISOString(),
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      payload: { operation: "task-read", warningResponseTaskRef: real.taskRef },
    },
    "queries",
  );
  expect(taskRead.status, `任务应可读，实际 ${JSON.stringify(taskRead.body)}`).toBe(200);
  const relations = taskRead.body?.result?.relations;
  const recommendationRefs = relations?.recommendationRefs ?? [];
  expect(
    recommendationRefs.length,
    `真实初评应产出正式建议，实际 ${JSON.stringify(relations)}`,
  ).toBeGreaterThan(0);
  const recommendationRef = recommendationRefs[0];

  // ---- 4. 人工采纳正式建议（C41：真实 routeDecisionRef + 内部起并恢复预测运行）----
  await page.goto(
    `${server.origin}${withProject(`/response/recommendations/${recommendationRef.reference.entityId}`, { version: recommendationRef.reference.versionId })}`,
  );
  await page
    .getByLabel("执行前监测快照标识")
    .fill(server.settlementMonitoringSnapshotRef.reference.entityId);
  await expect(page.getByRole("button", { name: "采纳建议", exact: true })).toBeDisabled();
  await page
    .getByLabel("执行前监测快照版本")
    .fill(server.settlementMonitoringSnapshotRef.reference.versionId);
  await page.getByRole("button", { name: "采纳建议", exact: true }).click();
  const adoptionResponse = page.waitForResponse((response) =>
    response.url().includes("/commands/warning-response.adopt-recommendation"),
  );
  await confirmationDialog(page).getByRole("button", { name: "确认提交" }).click();
  const adoptionHttp = await adoptionResponse;
  const adopted = { status: adoptionHttp.status(), body: await adoptionHttp.json() };
  expect(adopted.status, `采纳应成立，实际 ${JSON.stringify(adopted.body)}`).toBe(200);
  await closeConfirmationDialog(page);
  await expect(page.getByText("已采纳", { exact: true })).toBeVisible();
  const adoption = adopted.body?.result;
  // 结果判别式本身就是决定事实：`adoption` 表示已采纳并已产生真实预测运行绑定，
  // `decline` 表示终局拒绝且不返回运行引用。不另造一个与判别式重复的字段来断言。
  expect(adoption?.kind, `采纳回执应为 adoption，实际 ${JSON.stringify(adopted.body)}`).toBe(
    "adoption",
  );
  expect(adoption?.routeDecisionRef, "采纳必须产生真实 routeDecisionRef").toBeTruthy();

  // ---- 5. 采纳已真实跑通预测运行：回读任务关系拿到真实 effectForecastRef ----
  const forecastRead = await postBranch(
    page,
    "warning-response.read",
    {
      schemaVersion: "1",
      queryId: `spec-cal-forecast-${real.taskRef.reference.entityId}`,
      requestedAt: new Date().toISOString(),
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      payload: { operation: "task-read", warningResponseTaskRef: real.taskRef },
    },
    "queries",
  );
  const forecastRefs = forecastRead.body?.result?.relations?.forecastRefs ?? [];
  expect(
    forecastRefs.length,
    `采纳应真实产出效果预测，实际 ${JSON.stringify(forecastRead.body)}`,
  ).toBeGreaterThan(0);
  // 预测引用已在上一步断言存在；此处只登记，不参与后续写命令。
  void forecastRefs[0];

  // ---- 6. 登记执行（正式建议来源 + 真实来源段证据）----
  await page.goto(
    `${server.origin}${withProject("/response/executions/register", {
      task: real.taskRef.reference.entityId,
      taskVersion: real.taskRef.reference.versionId,
    })}`,
  );
  await page.getByLabel("建议标识", { exact: true }).fill(recommendationRef.reference.entityId);
  await page.getByLabel("建议版本", { exact: true }).fill(recommendationRef.reference.versionId);
  await page.getByLabel("执行发生时间").fill(await localDateTimeNow(page));
  await page.getByLabel("证据来源段标识").fill(server.sourceA.segmentIds[0]);
  await page
    .getByLabel("证据来源版本标识")
    .fill(server.sourceA.sourceVersionRef.reference.entityId);
  await expect(page.getByRole("button", { name: "登记执行", exact: true })).toBeDisabled();
  await page.getByLabel("证据来源版本号").fill(server.sourceA.sourceVersionRef.reference.versionId);
  await page.getByRole("button", { name: "登记执行", exact: true }).click();
  const executionResponse = page.waitForResponse((response) =>
    response.url().endsWith("/commands/warning-response.record-execution"),
  );
  await confirmationDialog(page).getByRole("button", { name: "确认提交" }).click();
  const executionHttp = await executionResponse;
  const execution = { status: executionHttp.status(), body: await executionHttp.json() };
  expect(execution.status, JSON.stringify(execution.body)).toBe(200);
  const executionRef = execution.body.result.executionRecordRef;
  await closeConfirmationDialog(page);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("version"))
    .toBe(executionRef.reference.versionId);

  // ---- 7. 通过页面登记正式反馈：所有输入都是真实精确引用 ----
  await page.getByLabel("反馈工件标识").fill(server.feedbackArtifactRef.reference.entityId);
  await page.getByLabel("反馈工件版本").fill(server.feedbackArtifactRef.reference.versionId);
  await page
    .getByLabel("处置后监测快照标识")
    .fill(server.settlementMonitoringSnapshotRef.reference.entityId);
  await page
    .getByLabel("处置后监测快照版本")
    .fill(server.settlementMonitoringSnapshotRef.reference.versionId);
  await page.getByLabel("实际评估记录标识").fill(real.assessmentRecordRef.reference.entityId);
  await page.getByLabel("实际评估记录版本").fill(real.assessmentRecordRef.reference.versionId);
  await expect(page.getByRole("button", { name: "登记反馈", exact: true })).toBeDisabled();
  await page.getByLabel("反馈发生时间").fill(await localDateTimeNow(page));
  await page.getByRole("button", { name: "登记反馈", exact: true }).click();
  const feedbackResponse = page.waitForResponse((response) =>
    response.url().endsWith("/commands/warning-response.record-feedback"),
  );
  await confirmationDialog(page).getByRole("button", { name: "确认提交" }).click();
  const feedbackHttp = await feedbackResponse;
  const feedback = { status: feedbackHttp.status(), body: await feedbackHttp.json() };
  expect(feedback.status, JSON.stringify(feedback.body)).toBe(200);
  const feedbackRef = feedback.body.result.feedbackRef;
  await expect(page.locator("h1.page-title")).toHaveText("处置反馈");

  // ---- 8. 反馈分段由 C41 在登记反馈的同一命令内启动 ----
  //
  // 分段入口冻结的效果预测来自 C28 记录反馈时解析出的真实预测（C41 冻结行随提交落库），
  // 因此 A2/A3/A4 会真正推进偏差与校准；测试不再手工补跑第二条分段。

  // ---- 9. 从反馈读回真实偏差与校准建议引用 ----
  const feedbackRead = await postBranch(
    page,
    "warning-response.read",
    {
      schemaVersion: "1",
      queryId: `spec-cal-feedback-read-${feedbackRef.reference.entityId}`,
      requestedAt: new Date().toISOString(),
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      payload: { operation: "feedback-read", feedbackRef },
    },
    "queries",
  );
  expect(feedbackRead.status, `反馈应可读，实际 ${JSON.stringify(feedbackRead.body)}`).toBe(200);
  const feedbackView = feedbackRead.body?.result;
  expect(
    feedbackView?.deviationRecord,
    `真实偏差应成立，实际 ${JSON.stringify(feedbackRead.body)}`,
  ).toBeTruthy();
  const calibrationRefs = feedbackView?.calibrationRefs ?? [];
  expect(
    calibrationRefs.length,
    `偏差应驱动出校准建议，实际 ${JSON.stringify(feedbackRead.body)}`,
  ).toBeGreaterThan(0);
  const calibrationSuggestionRef = calibrationRefs[0];

  // ---- 10. 校准页读到真实偏差/操作/校验/状态，页面不显示已发布知识 ----
  const calibrationPage = withProject(
    `/response/calibrations/${encodeURIComponent(calibrationSuggestionRef.reference.entityId)}`,
    { version: calibrationSuggestionRef.reference.versionId },
  );
  await login(page, server.operatorLogin, calibrationPage);
  await expect(page.locator("h1.page-title")).toHaveText("校准建议");
  // 精确读取校准建议：状态为待复核、操作是放宽风险可接受阈值一档，且未发布为知识。
  const calibrationRead = await postBranch(
    page,
    "warning-response.read",
    {
      schemaVersion: "1",
      queryId: `spec-cal-read-${calibrationSuggestionRef.reference.entityId}`,
      requestedAt: new Date().toISOString(),
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      payload: { operation: "calibration-read", calibrationSuggestionRef },
    },
    "queries",
  );
  expect(
    calibrationRead.status,
    `校准建议应可读，实际 ${JSON.stringify(calibrationRead.body)}`,
  ).toBe(200);
  const calibrationView = calibrationRead.body?.result;
  expect(calibrationView?.status, `实际 ${JSON.stringify(calibrationRead.body)}`).toBeTruthy();
  // 逐项校验条目按 { operation, valid } 包装，变化摘要在 operation 之下。
  expect(
    calibrationView?.operations?.some(
      (entry) => entry.operation?.kind === "replace-risk-acceptance-threshold" && entry.valid,
    ),
    `校准操作应为放宽风险可接受阈值，实际 ${JSON.stringify(calibrationView?.operations)}`,
  ).toBe(true);
  expect(
    calibrationView?.knowledgeRevisionRef,
    "尚未批准草案时不得存在已发布知识修订",
  ).toBeUndefined();
  // ---- 11. C07 真实批准后，以精确决定通过页面创建 C29/C16 未发布草案 ----
  const queue = await postBranch(
    page,
    "review-audit.queue-read",
    {
      schemaVersion: "1",
      queryId: `spec-cal-review-${crypto.randomUUID()}`,
      requestedAt: new Date().toISOString(),
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      payload: { reviewType: "calibration-suggestion", status: "pending", pageSize: 50 },
    },
    "queries",
  );
  expect(queue.status, JSON.stringify(queue.body)).toBe(200);
  const reviewTask = queue.body.result.items.find(
    (item) =>
      item.reviewTaskRef.targetRef.reference.entityId ===
      calibrationSuggestionRef.reference.entityId,
  );
  expect(reviewTask).toBeTruthy();
  const decisionId = `spec-cal-approve-${crypto.randomUUID()}`;
  const approved = await postBranch(
    page,
    "review-audit.decide-review",
    {
      schemaVersion: "1",
      commandId: decisionId,
      idempotencyKey: decisionId,
      issuedAt: new Date().toISOString(),
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      payload: {
        reviewTaskRef: reviewTask.reviewTaskRef,
        targetRef: reviewTask.reviewTaskRef.targetRef,
        decision: { reviewType: "calibration-suggestion", kind: "approve-draft-creation" },
        reasonCode: "calibration-verification",
      },
    },
    "commands",
  );
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  const reviewDecisionRef = approved.body.result.reviewDecisionRef;
  await page.reload();
  await page.getByLabel("复核决定标识").fill(reviewDecisionRef.reference.entityId);
  await page.getByLabel("复核决定版本").fill(reviewDecisionRef.reference.versionId);
  await page.getByRole("button", { name: "创建治理草案", exact: true }).click();
  const draftResponse = page.waitForResponse((response) =>
    response.url().includes("/commands/warning-response.calibration-governance-draft"),
  );
  await confirmationDialog(page).getByRole("button", { name: "确认提交" }).click();
  const draftHttp = await draftResponse;
  const draftBody = await draftHttp.json();
  expect(draftHttp.status(), JSON.stringify(draftBody)).toBe(200);
  expect(draftBody.result.knowledgeRevisionRef).toBeTruthy();
  await closeConfirmationDialog(page);
  await expect(
    page.getByText(draftBody.result.knowledgeRevisionRef.reference.entityId, { exact: false }),
  ).toBeVisible();
  const reread = await postBranch(
    page,
    "warning-response.read",
    {
      schemaVersion: "1",
      queryId: `spec-cal-draft-${crypto.randomUUID()}`,
      requestedAt: new Date().toISOString(),
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      payload: { operation: "calibration-read", calibrationSuggestionRef },
    },
    "queries",
  );
  expect(reread.body.result.status).toBe("approved-for-draft");
  expect(reread.body.result.knowledgeRevisionRef).toEqual(draftBody.result.knowledgeRevisionRef);
});

/**
 * C34 启动向导真实 UI 验收（IP-10/IP-12）。
 *
 * 断言页面用完整精确引用（不伪造版本）经真实 HTTP 命令启动运行，并在真实 PostgreSQL 上
 * 取得可读运行事实；缺输入、取消、键盘焦点、空间/工程切换清空按真实行为验收。
 */

/** 打开启动向导并填入全部精确引用（空间/适用性快照/风险输入/可选监测），返回所用真实引用。 */
const openStartWizard = async (page, options = {}) => {
  const monitoring = options.monitoring ?? server.assessStartInput.monitoringSnapshotRefs;
  const scope = server.assessStartInput.spatialScopeRef;
  const snapshot = server.assessStartInput.applicabilityMetadataSnapshotRef;
  const riskInput = server.assessStartInput.riskInput;
  await login(page, server.operatorLogin, withProject("/assessment/start"));
  await expect(page.locator("h1.page-title")).toHaveText("启动评估");
  await page
    .locator("[data-page-section]")
    .getByRole("combobox")
    .first()
    .selectOption(scope.reference.entityId);
  const snapshotChip = page.getByRole("button", { name: snapshot.reference.entityId, exact: true });
  const riskChip = page.getByRole("button", { name: riskInput.reference.entityId, exact: true });
  await expect(snapshotChip, "适用性快照候选应来自入口上下文精确读").toBeVisible({
    timeout: 20_000,
  });
  await expect(riskChip, "风险输入候选应来自待评估目录精确读").toBeVisible({ timeout: 20_000 });
  await snapshotChip.click();
  await riskChip.click();
  await page.getByLabel(/监测快照引用/).fill(JSON.stringify(monitoring));
  return { scope, snapshot, riskInput, monitoring };
};

test("启动向导按精确引用门控：缺输入不提交、取消与 Escape 无副作用、键盘焦点受约束", async ({
  page,
}) => {
  await login(page, server.operatorLogin, withProject("/assessment/start"));
  await expect(page.locator("h1.page-title")).toHaveText("启动评估");
  // 未选空间前不渲染提交控件，也不伪造默认引用。
  await expect(page.getByText("请先选择空间范围")).toBeVisible();
  await expect(page.getByRole("button", { name: "启动评估", exact: true })).toHaveCount(0);

  const commands = [];
  page.on("request", (request) => {
    if (request.url().includes("/commands/")) commands.push(request.url());
  });

  const scope = server.assessStartInput.spatialScopeRef;
  const snapshot = server.assessStartInput.applicabilityMetadataSnapshotRef;
  const riskInput = server.assessStartInput.riskInput;
  await page
    .locator("[data-page-section]")
    .getByRole("combobox")
    .first()
    .selectOption(scope.reference.entityId);
  const trigger = page.getByRole("button", { name: "启动评估", exact: true });
  await expect(trigger).toBeDisabled();
  await page.getByRole("button", { name: snapshot.reference.entityId, exact: true }).click();
  await page.getByRole("button", { name: riskInput.reference.entityId, exact: true }).click();
  await expect(trigger).toBeEnabled();

  // 缺版本的监测引用（自由标识冒充版本）不可用，不能用来提交。
  await page
    .getByLabel(/监测快照引用/)
    .fill('[{"kind":"monitoring-snapshot","reference":{"entityId":"x"}}]');
  await expect(page.getByText(/监测引用不可用/)).toBeVisible();
  await expect(trigger).toBeDisabled();

  await page
    .getByLabel(/监测快照引用/)
    .fill(JSON.stringify([server.settlementMonitoringSnapshotRef]));
  await expect(trigger).toBeEnabled();

  // 确认对话框：焦点落到取消、Escape 关闭、取消不发出任何写命令、关闭后焦点归还触发按钮。
  await trigger.click();
  const dialog = confirmationDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "确认命令" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(commands, "取消不得发出任何写命令").toHaveLength(0);
});

test("启动向导空间变化清空关联选择，工程切换不残留旧工程选择", async ({ page }) => {
  const scope = server.assessStartInput.spatialScopeRef;
  const snapshot = server.assessStartInput.applicabilityMetadataSnapshotRef;
  const riskInput = server.assessStartInput.riskInput;
  await login(page, server.operatorLogin, withProject("/assessment/start"));
  await expect(page.locator("h1.page-title")).toHaveText("启动评估");
  await page
    .locator("[data-page-section]")
    .getByRole("combobox")
    .first()
    .selectOption(scope.reference.entityId);
  await page.getByRole("button", { name: snapshot.reference.entityId, exact: true }).click();
  await page.getByRole("button", { name: riskInput.reference.entityId, exact: true }).click();
  await expect(page.locator(".ar-chip--active")).toHaveCount(2);

  // 空间恢复为空：候选区收回，关联选择清空。
  await page.locator("[data-page-section]").getByRole("combobox").first().selectOption("");
  await expect(page.getByText("请先选择空间范围")).toBeVisible();
  await expect(page.getByRole("button", { name: "启动评估", exact: true })).toHaveCount(0);

  // 重新选择同一空间：此前选中的快照/风险输入不得残留为活动选择。
  await page
    .locator("[data-page-section]")
    .getByRole("combobox")
    .first()
    .selectOption(scope.reference.entityId);
  await expect(
    page.getByRole("button", { name: snapshot.reference.entityId, exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".ar-chip--active")).toHaveCount(0);

  await page.getByRole("button", { name: snapshot.reference.entityId, exact: true }).click();
  await page.getByRole("button", { name: riskInput.reference.entityId, exact: true }).click();
  await page
    .getByLabel(/监测快照引用/)
    .fill(JSON.stringify([server.settlementMonitoringSnapshotRef]));
  await expect(page.locator(".ar-chip--active")).toHaveCount(2);

  // 切换工程：旧工程的 scope-bound 选择必须清空，不残留到新工程。
  await page.getByLabel("工程标识").fill("demo-switched-project");
  await page.getByRole("button", { name: "确定" }).click();
  await expectSelectedProject(page, "demo-switched-project");
  await expect(page.locator(".ar-chip--active")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "启动评估", exact: true })).toHaveCount(0);
});

test("启动向导以完整精确引用提交初评，命令载荷精确且返回真实运行", async ({ page }) => {
  test.setTimeout(240_000);
  const refs = await openStartWizard(page);
  const sentEnvelopes = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/commands/workflow.start-run")) {
      try {
        sentEnvelopes.push(JSON.parse(request.postData() ?? "null"));
      } catch {
        sentEnvelopes.push(null);
      }
    }
  });

  await page.getByRole("button", { name: "启动评估", exact: true }).click();
  const startDialog = confirmationDialog(page);
  await expect(startDialog).toBeVisible();
  // 确认摘要如实给出入口模式与用户选定的精确引用，不伪造默认版本。
  await expect(startDialog.locator("section[aria-label='预计事实']")).toContainText(
    "workflow-assessment:v1",
  );
  await expect(startDialog.locator("section[aria-label='目标对象']")).toContainText(
    refs.scope.reference.entityId,
  );
  await expect(startDialog.locator("section[aria-label='目标对象']")).toContainText(
    refs.riskInput.reference.entityId,
  );
  await startDialog.getByRole("button", { name: "确认提交" }).click();
  await page.waitForURL(/assessment\/runs\/[^?]+\?.*version=/, { timeout: 60_000 });

  // 命令载荷逐项精确：监测/风险输入/适用性快照/空间与工作流策略都取用户选定与已读事实，不伪造版本。
  await expect.poll(() => sentEnvelopes.length, { timeout: 30_000 }).toBeGreaterThan(0);
  const sent = sentEnvelopes[0];
  expect(sent.payload.monitoringSnapshotRefs).toEqual(refs.monitoring);
  expect(sent.payload.riskInput).toEqual(refs.riskInput);
  expect(sent.payload.applicabilityMetadataSnapshotRef).toEqual(refs.snapshot);
  expect(sent.payload.spatialScopeRef).toEqual(refs.scope);
  expect(sent.payload.graphVersion).toEqual(server.assessStartInput.graphVersion);
  expect(sent.payload.entryMode).toBe("assess");
  expect(sent.commandId).toBeTruthy();
  expect(sent.idempotencyKey).toBe(sent.commandId);

  // 真实运行深链 + 运行页读回真实登记事实（入口模式为 assess）。
  const runId = new URL(page.url()).pathname.split("/assessment/runs/")[1];
  expect(runId, "真实启动必须返回运行深链").toBeTruthy();
  await expect(page.locator("h1.page-title")).toHaveText("评估运行");
  await expect(page.locator("dt", { hasText: "运行引用" }).locator("..")).toContainText(runId);
  await expect(page.locator("dt", { hasText: "入口模式" }).locator("..")).toContainText("assess");
});

test("启动向导响应丢失后按原身份原载荷重试，取得同一运行", async ({ page }) => {
  test.setTimeout(240_000);
  await openStartWizard(page);
  const envelopes = [];
  let dropped = false;
  await page.route("**/commands/workflow.start-run", async (route) => {
    const envelope = route.request().postData() ?? "";
    envelopes.push(envelope);
    if (!dropped) {
      dropped = true;
      // 服务端已提交、响应丢失：真实打一次服务端，再让页面收到网络失败。
      const direct = await page.request.post(route.request().url(), {
        headers: { ...route.request().headers(), origin: server.origin },
        data: envelope,
      });
      expect(direct.status()).toBe(200);
      await route.fulfill({ status: 599, contentType: "text/plain", body: "response dropped" });
      return;
    }
    await route.continue();
  });

  const dialog = confirmationDialog(page);
  await page.getByRole("button", { name: "启动评估", exact: true }).click();
  await dialog.getByRole("button", { name: "确认提交" }).click();
  // 首次应答被掐断：对话框留在原处等重试，且只给「重试」——重试复用同一冻结计划。
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-confirmation-state='error']")).toContainText(
    "TRANSIENT_FAILURE",
  );
  await expect(dialog.getByRole("button", { name: "确认提交" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "重试" }).click();
  await expect.poll(() => envelopes.length, { timeout: 60_000 }).toBe(2);
  expect(envelopes[1], "重试必须逐字节复用首次冻结的完整信封").toBe(envelopes[0]);
  await page.waitForURL(/assessment\/runs\/[^?]+\?.*version=/, { timeout: 60_000 });
});

test("启动向导以完整精确引用提交重评，返回真实重评运行", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1024, height: 600 });
  // 重评需要真实前驱：先经真实 UI 初评落一条评估记录。
  await openStartWizard(page);
  await page.getByRole("button", { name: "启动评估", exact: true }).click();
  await confirmationDialog(page).getByRole("button", { name: "确认提交" }).click();
  await page.waitForURL(/assessment\/runs\//, { timeout: 60_000 });

  await login(page, server.operatorLogin, withProject("/assessment/start"));
  await expect(page.locator("h1.page-title")).toHaveText("启动评估");
  const scope = server.assessStartInput.spatialScopeRef;
  const snapshot = server.assessStartInput.applicabilityMetadataSnapshotRef;
  const riskInput = server.assessStartInput.riskInput;
  await page
    .locator("[data-page-section]")
    .getByRole("combobox")
    .first()
    .selectOption(scope.reference.entityId);
  await page.getByRole("button", { name: snapshot.reference.entityId, exact: true }).click();
  await page.getByRole("button", { name: riskInput.reference.entityId, exact: true }).click();
  await page.getByRole("button", { name: "重评", exact: true }).click();

  const priorSelect = page.getByLabel(/前驱评估记录/);
  await expect
    .poll(async () => priorSelect.locator("option").count(), { timeout: 20_000 })
    .toBeGreaterThan(1);
  await priorSelect.selectOption({ index: 1 });
  await page
    .getByLabel(/变化引用/)
    .fill(
      JSON.stringify([
        server.settlementMonitoringSnapshotRef,
        server.reassessmentSettlementMonitoringSnapshotRef,
      ]),
    );
  await page
    .getByLabel(/监测快照引用/)
    .fill(
      JSON.stringify([
        server.reassessmentSettlementMonitoringSnapshotRef,
        server.slurryPressureMonitoringSnapshotRef,
      ]),
    );

  const trigger = page.getByRole("button", { name: "启动评估", exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const reassessDialog = confirmationDialog(page);
  await expect(reassessDialog).toBeVisible();
  // 重评入口如实标注为 reassess，并绑定前驱评估记录与用户选定的前驱监测快照。
  await expect(reassessDialog.locator("section[aria-label='预计事实']")).toContainText(
    "workflow-reassessment:v1",
  );
  await expect(reassessDialog.locator("section[aria-label='目标对象']")).toContainText(
    server.assessStartInput.riskInput.reference.entityId,
  );
  await reassessDialog.getByRole("button", { name: "确认提交" }).click();
  await page.waitForURL(/assessment\/runs\/[^?]+\?.*version=/, { timeout: 60_000 });
  await expect(page.locator("h1.page-title")).toHaveText("评估运行");
  await expect(page.locator("dt", { hasText: "入口模式" }).locator("..")).toContainText("reassess");
});

test("同一定义发布新矩阵后历史落点按两个冻结版本分组", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, server.operatorLogin, withProject("/warnings"));
  const real = await startRealAssessmentAndReadWarnings(page, "historical-matrix");
  const readMatrixGroup = async (group) => {
    await expect(group).toHaveCount(1);
    return group.locator("svg[role='img']").evaluate((svg) => ({
      axes: [...svg.querySelectorAll(":scope > text")].map((node) => node.textContent),
      cells: [...svg.querySelectorAll(":scope > rect")].map((node) => ({
        position: [node.getAttribute("x"), node.getAttribute("y")],
        level: node.querySelector("title")?.textContent,
        color: getComputedStyle(node).fill,
      })),
      plots: [...svg.querySelectorAll(":scope > g")].map((node) => ({
        position: [
          node.querySelector("circle")?.getAttribute("cx"),
          node.querySelector("circle")?.getAttribute("cy"),
        ],
        count: node.querySelector("text")?.textContent ?? "1",
      })),
    }));
  };
  await page.goto(`${server.origin}${withProject("/assessment/matrix")}`);
  await expect(page.getByRole("img", { name: "P/C 风险矩阵" })).toHaveCount(1);
  const originalGroup = page
    .getByRole("img", { name: "P/C 风险矩阵" })
    .locator("xpath=ancestor::section[1]");
  const before = await readMatrixGroup(originalGroup);
  const refs = await server.publishNextRiskMatrix();
  await startRealAssessmentAndReadWarnings(page, "historical-matrix-new", {
    startInput: {
      monitoringSnapshotRefs: [
        server.reassessmentSettlementMonitoringSnapshotRef,
        server.slurryPressureMonitoringSnapshotRef,
      ],
    },
  });
  const startedAt = Date.now();
  await page.goto(`${server.origin}${withProject("/assessment/matrix")}`);
  await expect(page.getByRole("img", { name: "P/C 风险矩阵" })).toHaveCount(2);
  for (const ref of [refs.oldReleaseRef, refs.newReleaseRef]) {
    await expect(
      page
        .getByText(`${ref.reference.entityId} · ${ref.reference.versionId}`, { exact: true })
        .first(),
    ).toBeVisible();
  }
  const groupFor = (releaseRef) =>
    page.locator("section.ar-card").filter({
      has: page.getByText(`${releaseRef.reference.entityId} · ${releaseRef.reference.versionId}`, {
        exact: true,
      }),
    });
  const historical = await readMatrixGroup(groupFor(refs.oldReleaseRef));
  expect(historical.axes).toEqual(before.axes);
  expect(historical.cells).toEqual(before.cells);
  expect(historical.plots).toEqual(before.plots);
  const ids = await page.locator("tbody tr td:first-child a").allTextContents();
  expect(ids.join(" ")).toContain(real.assessmentRecordRef.reference.entityId);
  expect(new Set(ids).size).toBeGreaterThanOrEqual(2);
  console.info("C34 historical matrix page", {
    elapsedMs: Date.now() - startedAt,
    groups: await page.getByRole("img", { name: "P/C 风险矩阵" }).count(),
    domNodes: await page.locator("*").count(),
  });
});

/**
 * CH-1 受控风险等级呈现在正式页面上的真实取证（DS-S03 / DS-S04 / DS-S05 / DS-S06）。
 */

/** 预警中心的等级徽章只有标识没有顺序，必须中性呈现而不是补一个默认红色。 */
test("预警等级徽章保留实际标识并中性呈现，不冒充风险等级", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, server.operatorLogin, withProject("/warnings"));
  await startRealAssessmentAndReadWarnings(page, "risk-badge");
  await expectResolvedState(page);
  await expect(page.locator(".risk-badge").first()).toBeVisible();

  const badge = page.locator(".risk-badge").first();
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("data-risk-mapped", "false");
  // 徽章与同一行的「预警等级」列给出同一个实际标识，不按字符串猜等级。
  const row = page.locator(".data-table-host tbody tr").filter({ has: badge }).first();
  const levelColumn = row.getByRole("cell").nth(1);
  const levelText = (await levelColumn.textContent())?.trim() ?? "";
  expect(levelText.length).toBeGreaterThan(0);
  const badgeText = (await badge.textContent())?.trim() ?? "";
  expect(badgeText).toContain(levelText);

  const colors = await badge.evaluate((node) => {
    const style = getComputedStyle(node);
    return { color: style.color, background: style.backgroundColor };
  });
  const rootStyles = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      text: styles.getPropertyValue("--text").trim(),
      neutralSoft: styles.getPropertyValue("--bluegray-soft").trim(),
      // 最高风险红：不可映射等级绝不能借用它。
      risk1: styles.getPropertyValue("--risk-1").trim(),
    };
  });
  const toRgb = (hex) => {
    const value = hex.replace("#", "");
    const full =
      value.length === 3
        ? value
            .split("")
            .map((c) => c + c)
            .join("")
        : value;
    return `rgb(${parseInt(full.slice(0, 2), 16)}, ${parseInt(full.slice(2, 4), 16)}, ${parseInt(full.slice(4, 6), 16)})`;
  };
  expect(colors.background).toBe(toRgb(rootStyles.neutralSoft));
  expect(colors.color).toBe(toRgb(rootStyles.text));
  expect(colors.background).not.toBe(toRgb(rootStyles.risk1));
  // 实际标识照原样显示，并给出不可映射的可读说明。
  await expect(badge).toContainText("该等级配色未定义");
});

/** 预警详情的确认状态是处置进度，只用 StatusTag，不混进等级徽章。 */
test("预警确认状态使用状态标签而不是风险等级徽章", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, server.operatorLogin, withProject("/warnings"));
  const real = await startRealAssessmentAndReadWarnings(page, "ack-status-tag");
  const target = withProject(
    `/warnings/${encodeURIComponent(real.warningRecordRef.reference.entityId)}`,
    { version: real.warningRecordRef.reference.versionId },
  );
  await login(page, server.operatorLogin, target);

  // 页头存在确认状态：它是状态标签，没有被渲染成风险等级徽章。
  await expect(page.locator(".wd-header-actions .status-tag")).toBeVisible();
  await expect(page.locator(".wd-header-actions .warning-badge")).toHaveCount(0);
  await expect(page.locator(".wd-header-actions .status-tag")).toContainText("待确认");
});

/** 矩阵图例与格子共用同一份受控等级配色，不出现第二套取模结果。 */
test("矩阵等级图例与格子共用同一受控配色", async ({ page }) => {
  await login(page, server.operatorLogin, withProject("/assessment/matrix"));
  await expect(page.locator("h1.page-title")).toHaveText("P/C 风险矩阵视图");
  await expectResolvedState(page);

  const matrix = page.getByRole("img", { name: "P/C 风险矩阵" }).first();
  await expect(matrix).toBeVisible();

  const { cells, legend } = await page.evaluate(() => {
    const svg = document.querySelector("figure.chart-surface svg");
    const cellFills = [...svg.querySelectorAll("rect > title")].map((title) => {
      const rect = title.parentElement;
      return { fill: rect.getAttribute("fill"), level: title.textContent };
    });
    const swatches = [...document.querySelectorAll(".chart-legend rect")].map((node) =>
      node.getAttribute("fill"),
    );
    return { cells: cellFills, legend: swatches };
  });

  expect(cells.length).toBeGreaterThan(0);
  expect(legend.length).toBeGreaterThan(0);
  // 每个已映射等级的格子底色都能在图例里找到同一取值。
  for (const cell of cells) {
    if (!cell.fill) continue;
    expect(legend, `格子等级 ${cell.level} 的底色不在图例中`).toContain(cell.fill);
  }
});
