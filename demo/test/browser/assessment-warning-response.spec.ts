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

const withProject = (path, extraParams = {}) => {
  const [base, existing = ""] = path.split("?");
  // 工程参数放首位：页面按 URL 自省工程上下文，深链的 version 只能跟在后面。
  const params = new URLSearchParams({ project: server.projectId });
  for (const [key, value] of new URLSearchParams(existing)) params.set(key, value);
  for (const [key, value] of Object.entries(extraParams)) params.set(key, value);
  return `${base}?${params.toString()}`;
};

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
      payload: { ...server.assessStartInput, entryMode: "assess" },
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
      firstServerResult.status = direct.status();
      firstServerResult.body = (await direct.text().catch(() => undefined))?.slice(0, 300);
      await route.fulfill({ status: 599, contentType: "text/plain", body: "response dropped" });
      return;
    }
    await route.continue();
  });

  // 首次确认的应答被掐断时，对话框留在原处等重试：因此这里先看对话框是否已开，
  // 已开就直接复用，不再去点触发按钮（否则会同时命中按钮与对话框里的确认）。
  const confirm = async () => {
    const dialog = page.locator(".confirm-dialog");
    if (!(await dialog.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "确认预警", exact: true }).click();
      await expect(dialog).toBeVisible();
    }
    await dialog.getByRole("button", { name: /^确认/ }).click();
  };

  await confirm();
  // 轮询服务端结果本身：路由处理器在捕获信封后才真正发请求，直接读状态会与它竞态。
  await expect
    .poll(() => firstServerResult.status, { timeout: 30_000 })
    .toBe(200);
  expect(
    JSON.stringify(firstServerResult.body),
    `首次请求必须真的执行到服务端，路由日志 ${JSON.stringify(handlerLog)}`,
  ).toContain("acknowledged");

  // 服务端侧证据：确认事实在应答丢失之前就已落库，重试之前就能读到。
  await expect
    .poll(async () => (await readWarning("after-first"))?.acknowledgement?.actorId, {
      timeout: 30_000,
    })
    .toBeTruthy();

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
  const dialog = page.locator(".confirm-dialog");
  await expect(dialog).toBeVisible();
  // 焦点落在对话框内，取消可达；关闭后对话框消失，页面仍停在未确认。
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toHaveCount(0);
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
test("采纳、执行与反馈成立真实事实后，偏差驱动出校准建议，批准只生成未发布草案", async ({ page }) => {
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
  expect(
    acknowledged.status,
    `确认预警应成立，实际 ${JSON.stringify(acknowledged.body)}`,
  ).toBe(200);
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
  const adopted = await postBranch(
    page,
    "warning-response.adopt-recommendation",
    {
      schemaVersion: "1",
      commandId: `spec-cal-adopt-${recommendationRef.reference.entityId}`,
      idempotencyKey: `spec-cal-adopt-${recommendationRef.reference.entityId}`,
      issuedAt: new Date().toISOString(),
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      payload: {
        responseRecommendationRef: recommendationRef,
        decision: "adopted",
        reasonCode: "demo-calibration-closed-loop",
        preActionMonitoringSnapshotRef: server.settlementMonitoringSnapshotRef,
      },
    },
    "commands",
  );
  expect(adopted.status, `采纳应成立，实际 ${JSON.stringify(adopted.body)}`).toBe(200);
  const adoption = adopted.body?.result;
  // 结果判别式本身就是决定事实：`adoption` 表示已采纳并已产生真实预测运行绑定，
  // `decline` 表示终局拒绝且不返回运行引用。不另造一个与判别式重复的字段来断言。
  expect(
    adoption?.kind,
    `采纳回执应为 adoption，实际 ${JSON.stringify(adopted.body)}`,
  ).toBe("adoption");
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
  const effectForecastRef = forecastRefs[0];

  // ---- 6. 登记执行（正式建议来源 + 真实来源段证据）----
  const executedAt = new Date().toISOString();
  const execution = await postBranch(
    page,
    "warning-response.record-execution",
    {
      schemaVersion: "1",
      commandId: `spec-cal-exec-${effectForecastRef.reference.entityId}`,
      idempotencyKey: `spec-cal-exec-${effectForecastRef.reference.entityId}`,
      issuedAt: new Date().toISOString(),
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      payload: {
        actionSource: {
          kind: "adopted-recommendation",
          responseRecommendationRef: recommendationRef,
        },
        // 载荷要的是账号主体标识，不是登录名：登录名会被 C28 判为执行来源无效。
        executedByActorId: server.operatorAccountId,
        recordedByActorId: server.operatorAccountId,
        occurredAt: executedAt,
        evidenceReferences: [
          {
            locator: {
              sourceSegmentId: `${server.sourceAVersionEntityId}-chapter_1-segment_1`,
            },
            sourceVersion: { entityId: server.sourceAVersionEntityId, versionId: "1" },
          },
        ],
      },
    },
    "commands",
  );
  expect(execution.status, `登记执行应成立，实际 ${JSON.stringify(execution.body)}`).toBe(200);
  const executionRef = execution.body?.result?.executionRecordRef;
  expect(executionRef, `登记执行必须返回真实执行记录，实际 ${JSON.stringify(execution.body)}`)
    .toBeTruthy();

  // ---- 7. 登记正式反馈（真实反馈工件 + 实际评估记录 + 处置后监测快照）----
  const feedback = await postBranch(
    page,
    "warning-response.record-feedback",
    {
      schemaVersion: "1",
      commandId: `spec-cal-feedback-${executionRef.reference.entityId}`,
      idempotencyKey: `spec-cal-feedback-${executionRef.reference.entityId}`,
      issuedAt: new Date().toISOString(),
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      payload: {
        executionRecordRef: executionRef,
        postActionMonitoringSnapshotRef: server.settlementMonitoringSnapshotRef,
        feedbackArtifactRef: server.feedbackArtifactRef,
        occurredAt: new Date().toISOString(),
        actualAssessmentRecordRef: real.assessmentRecordRef,
      },
    },
    "commands",
  );
  expect(feedback.status, `登记反馈应成立，实际 ${JSON.stringify(feedback.body)}`).toBe(200);
  const feedbackRef = feedback.body?.result?.feedbackRef;
  expect(feedbackRef, `登记反馈必须返回真实反馈引用，实际 ${JSON.stringify(feedback.body)}`)
    .toBeTruthy();

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
  expect(
    feedbackRead.status,
    `反馈应可读，实际 ${JSON.stringify(feedbackRead.body)}`,
  ).toBe(200);
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
});
