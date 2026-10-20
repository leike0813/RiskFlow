/**
 * C32 demo 只读链路真实浏览器验收：登录 → 工程选择 → 工程概览 → 资料目录/详情 →
 * 监测详情 → 知识治理四页 → 证据脱敏两态 → 检索深链 → 权限降级。
 * 服务由 server.mjs 以真实 PostgreSQL/迁移/会话/工件接缝启动；任何一步失败都计为失败。
 */
import { expect, request, test } from "@playwright/test";

import { startBusinessBrowserServer } from "./business-server.mjs";
import { HTTP_COOKIE_NAME_V1 } from "../../../../apps/api/dist/http.js";

/** @type {Awaited<ReturnType<typeof startBusinessBrowserServer>>} */
let server;

test.beforeAll(async () => {
  // 分页验收登记 51 条真实资料与序列（第二页只在显式开启时出现），供消费者续页用例使用。
  server = await startBusinessBrowserServer({ paginationAcceptance: true });
}, 600_000);

test.afterAll(async () => {
  await server?.close();
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

const login = async (page, loginName, targetPath, password = server.accountPassword) => {
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
    await expect(page.getByText("RiskFlow", { exact: true }).first()).toBeVisible();
    // 提交最多两次：整页重载后首次点击偶尔落在控件接管之前，表单留在原地，
    // 看着像登录失败，其实是提交没发出去。重填重发一次，仍不落下就如实判失败。
    for (let attempt = 0; attempt < 2 && (await loginGate(page).count()) > 0; attempt += 1) {
      await loginGate(page).fill(loginName);
      await page.getByLabel("密码").fill(password);
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

const selectProject = async (page) => {
  // C37 D-17：工程选择由 Web 宿主的上下文栏统一持有。服务端没有工程全量枚举分支，
  // 因此宿主除下拉外还提供按标识直接进入工程的入口；这里驱动该真实控件。
  await page.getByLabel("工程标识").fill(server.projectId);
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.locator('div[aria-label="工程上下文"] select').first()).toHaveValue(
    server.projectId,
  );
};

test("未登录跳转登录页，登录后回到原目标页", async ({ page }) => {
  await login(page, server.operatorLogin, `/projects?project=${server.projectId}`);
  await expect(page.getByRole("heading", { name: "工程概览", level: 1 })).toBeVisible();
  expect(new URL(page.url()).protocol).toBe("https:");
  const cookie = (await page.context().cookies()).find((item) => item.name === HTTP_COOKIE_NAME_V1);
  expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: "Strict", path: "/" });
  expect(await page.evaluate(() => document.cookie)).not.toContain(HTTP_COOKIE_NAME_V1);
  const session = await page.request.get(`${server.origin}/api/v1/session`);
  expect(session.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("heading", { name: "工程概览", level: 1 })).toBeVisible();
});

test("工程概览呈现真实上下文、适用性三维与发布集合", async ({ page }) => {
  await login(page, server.operatorLogin, "/projects");
  await selectProject(page);
  // 页面事实与外壳 chrome 都要出现在同一工程上；断言限定在页面内容区，
  // 否则会先命中上下文栏里同名的 <option>。
  const content = page.locator("[data-page-section]");
  await expect(content.getByText("工程身份信息")).toBeVisible();
  await expect(content.getByText(server.projectId).first()).toBeVisible();
  await expect(page.getByText("变径盾构法")).toBeVisible();
  await expect(page.getByText("富水软弱地层")).toBeVisible();
  await expect(page.getByText("变径空间扩挖").first()).toBeVisible();
  await expect(page.getByText("站隧一体化试验区段")).toBeVisible();
  await expect(page.getByRole("heading", { name: "发布集合版本引用" })).toBeVisible();
  await expect(page.getByText("风险矩阵").first()).toBeVisible();
});

test("资料目录与详情呈现登记事实，证据抽屉呈现定位", async ({ page }) => {
  await login(page, server.operatorLogin, `/projects/documents?project=${server.projectId}`);
  await expect(page.getByText("工程资料版本列表")).toBeVisible();
  await expect(
    page.getByText(server.sourceAVersionEntityId, { exact: false }).first(),
  ).toBeVisible();
  // 无写操作入口
  await expect(page.getByRole("button", { name: "登记资料" })).toHaveCount(0);

  await page.getByText(server.sourceAVersionEntityId, { exact: false }).first().click();
  await page.waitForURL(/\/projects\/documents\//);
  await expect(page.getByRole("tab", { name: "原件", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("link", { name: "下载原件" })).toBeVisible();
  const original = await page.getByRole("link", { name: "下载原件" }).getAttribute("href");
  const authorized = await page.evaluate(async (href) => {
    const response = await fetch(href, { credentials: "same-origin" });
    return { status: response.status, byteLength: (await response.arrayBuffer()).byteLength };
  }, original!);
  expect(authorized.status).toBe(200);
  expect(authorized.byteLength).toBeGreaterThan(0);
  // 独立 API 上下文不继承浏览器上下文的 ignoreHTTPSErrors；loopback 自签证书需显式允许。
  const anonymousContext = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    const anonymous = await anonymousContext.get(new URL(original!, page.url()).href);
    expect(anonymous.status()).toBe(401);
  } finally {
    await anonymousContext.dispose();
  }
  await page.getByRole("tab", { name: "解析与清洗" }).click();
  await expect(page.getByText("资料元数据")).toBeVisible();
  await expect(page.getByText("章节结构与资料段")).toBeVisible();

  await page
    .getByRole("button", {
      name: new RegExp(`${server.sourceAVersionEntityId}-chapter_1-segment_1`),
    })
    .first()
    .click();
  await expect(page.locator(".evidence-drawer-title")).toBeVisible();
  await expect(page.getByText("验收章节")).toBeVisible();
});

test("监测序列详情呈现冻结快照统计与批次事实", async ({ page }) => {
  // 该序列登记了两个真实批次（两个快照各一批），批次标识由服务端生成；按详情读面返回的
  // 精确批次引用核对表格与统计，既不假设只有一批，也不删掉任何一批。
  await login(page, server.operatorLogin, `/projects/monitoring?project=${server.projectId}`);
  await expect(page.getByText("监测序列", { exact: true }).first()).toBeVisible();
  const detailResponse = page.waitForResponse((response) => {
    if (!response.url().endsWith("/queries/engineering-data.monitoring-catalog")) return false;
    const payload = response.request().postDataJSON().payload;
    return (
      payload.monitoringSeriesRef?.reference?.entityId === server.seriesEntityId &&
      payload.monitoringSeriesRef?.reference?.versionId === server.seriesVersionId
    );
  });
  await page.getByText("地表沉降监测点").click();
  await page.waitForURL(new RegExp(`/projects/monitoring/${server.seriesEntityId}`));
  // CH-4：快照必须由用户选定；未选定时不擅自改成最新。
  await expect(page.getByRole("heading", { name: "快照目录", exact: true })).toBeVisible();
  const snapshotChoice = page.locator(".pjmon-snapshots button").first();
  await expect(snapshotChoice).toBeVisible();
  await snapshotChoice.click();
  await expect(page).toHaveURL(/snapshot=/);
  await expect(page.getByText("短期斜率")).toBeVisible();
  await expect(page.getByText("批次与快照登记事实")).toBeVisible();

  const batches = (await (await detailResponse).json()).result.batches;
  expect(batches.length).toBeGreaterThan(1);
  const relationLabel: Record<string, string> = {
    original: "原始批次",
    correction: "更正批次",
    supplement: "补充批次",
  };
  const batchCard = page
    .locator("section.card")
    .filter({ has: page.getByRole("heading", { name: "批次与快照登记事实" }) });
  const batchRows = batchCard.locator("tbody tr.ant-table-row");
  await expect(batchRows).toHaveCount(batches.length);
  expect(
    await batchRows.evaluateAll((rows) => rows.map((row) => row.children[0].textContent)),
  ).toEqual(batches.map((batch) => batch.monitoringBatchRef.reference.entityId));
  expect(
    await batchRows.evaluateAll((rows) => rows.map((row) => row.children[1].textContent)),
  ).toEqual(batches.map((batch) => relationLabel[batch.relation] ?? batch.relation));
  expect(
    await batchRows.evaluateAll((rows) => rows.map((row) => Number(row.children[3].textContent))),
  ).toEqual(batches.map((batch) => batch.sampleCount));
  expect(
    await batchRows.evaluateAll((rows) => rows.map((row) => row.children[4].textContent)),
  ).toEqual(batches.map((batch) => batch.occurredAt));
});

test("知识治理四页呈现真实发布事实且无写入口", async ({ page }) => {
  await login(page, server.operatorLogin, `/knowledge/mechanisms?project=${server.projectId}`);
  await expect(page.getByText("MEC-VDS-017").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "新建机理条目" })).toHaveCount(0);

  await page.getByRole("link", { name: "评分规则" }).click();
  await page.waitForURL(/\/knowledge\/rules/);
  await expect(page.getByText("适用规则集", { exact: false }).first()).toBeVisible();
  // 规则来自 C19 真实编制并发布的那份，标识是 C18 指标派生出来的，不再是早期播种夹具里的
  // `RULE-SETTLE-001`——那个标识在源码里没有任何登记来源。
  await expect(page.getByText("RULE-demo-indicator-settlement").first()).toBeVisible();

  await page.getByRole("link", { name: "风险矩阵" }).click();
  await page.waitForURL(/\/knowledge\/matrix/);
  await expect(page.getByText("demo-c32-matrix")).toBeVisible();
  await expect(page.getByText("2026.06")).toBeVisible();

  await page.getByRole("link", { name: "措施库" }).click();
  await page.waitForURL(/\/knowledge\/measures/);
  // 措施同样取 C18 真实发布的那条；断言步骤的关键语义，不锁死整段文案。
  await expect(page.getByText("demo-measure-settlement").first()).toBeVisible();
  await expect(page.getByText(/降低推进速率.*同步注浆/)).toBeVisible();
});

test("工序模型页呈现已发布模型的节点、监测指标与依赖关系", async ({ page }) => {
  await login(
    page,
    server.operatorLogin,
    `/identification/process-model?project=${server.projectId}`,
  );
  // 五个必含工序节点按真实发布模型呈现。
  for (const kind of ["扩径准备", "变径空间扩挖", "刀盘扩径", "盾体扩径", "缩径转换"]) {
    await expect(page.getByText(kind, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("PN-EXPAND-02").first()).toBeVisible();
  // 节点的业务字段来自发布正文：监测指标与装备构件都真实呈现。
  await expect(page.getByText("地表沉降").first()).toBeVisible();
  await expect(page.getByText("扩径模块", { exact: true }).first()).toBeVisible();
  // 依赖关系直接来自登记的依赖边。
  await expect(page.getByText("PN-EXPAND-01 → PN-EXPAND-02")).toBeVisible();
});

test("工序模型：显式发布版本与节点定位不被当前集合替换", async ({ page }) => {
  const release = server.identification.processModelRelease;
  const base = `/identification/process-model?project=${server.projectId}&release=${encodeURIComponent(release.entityId)}&releaseVersion=${encodeURIComponent(release.versionId)}`;
  await login(page, server.operatorLogin, `${base}&node=PN-EXPAND-03`);
  // 所选发布版本的真实节点呈现：定位到第三个工序节点。
  await expect(page.getByText("PN-EXPAND-03").first()).toBeVisible();
  await expect(page.getByText("刀盘扩径", { exact: true })).toBeVisible();
  // 依赖边仍来自该发布版本的登记事实。
  await expect(page.getByText("PN-EXPAND-01 → PN-EXPAND-02")).toBeVisible();

  // 不存在的节点如实说明无法定位，不自动改选首节点。
  await page.goto(`${server.origin}${base}&node=PN-NOT-EXIST`);
  await expect(page.getByText(/没有节点/)).toBeVisible();
});

test("无资料授权时证据抽屉呈现固定脱敏提示", async ({ page }) => {
  await login(page, server.operatorLogin, `/knowledge/mechanisms?project=${server.projectId}`);
  await expect(page.getByText("MEC-VDS-017").first()).toBeVisible();
  // 机理详情的第二条证据指向受限资料 B：只呈现定位摘要与固定脱敏提示。
  const restrictedSegment = page.getByRole("button", {
    name: new RegExp(`${server.sourceBVersionEntityId ?? ""}-chapter_1-segment_1`),
  });
  const deniedResponse = page.waitForResponse((response) =>
    response.url().endsWith("/queries/engineering-data.evidence-access"),
  );
  await restrictedSegment.first().click();
  await expect(page.locator(".evidence-drawer-title")).toBeVisible();
  const denied = await deniedResponse;
  expect(denied.status()).toBe(404);
  const deniedBody = await denied.json();
  expect(deniedBody.code).toBe("NOT_FOUND");
  expect(deniedBody).not.toHaveProperty("result");
  const drawer = page.locator(".evidence-drawer");
  await expect(drawer.locator(".evidence-field-label")).toHaveText([
    "资料段标识",
    "定位摘要",
    "引用该证据的业务对象",
  ]);
  await expect(drawer.locator(".evidence-field-value").first()).toHaveText(
    `${server.sourceBVersionEntityId}-chapter_1-segment_1`,
  );
  // 无授权响应没有段对象；抽屉只保留定位摘要，不能生成正文或资料跳转。
  await expect(drawer.getByRole("link")).toHaveCount(0);
  await expect(drawer.locator(".evidence-field")).toHaveCount(3);
  await expect(drawer.getByText(/无该资料来源版本的访问授权/)).toBeVisible();
});

test("检索结果深链呈现关系上下文；viewer 无检索读取权限", async ({ page }) => {
  const deepLink = `/knowledge/retrieval-result?project=${server.projectId}&result=${encodeURIComponent(
    server.relationshipResult.entityId,
  )}&version=${encodeURIComponent(server.relationshipResult.versionId)}`;
  await login(page, server.operatorLogin, deepLink);
  await expect(page.getByText("当前工序节点：PN-EXPAND-02")).toBeVisible();
  await expect(page.getByText("MEC-VDS-017").first()).toBeVisible();
  await expect(page.getByText("MEC-VDS-018")).toBeVisible();
  // 检索页没有临时检索入口。断言限定在页面内容区：C37 之后工程上下文栏由宿主持有，
  // 其中「工程标识」输入是外壳 chrome，不是页面提供的检索入口。
  await expect(page.locator("[data-page-section]").getByRole("textbox")).toHaveCount(0);
});

test("viewer 无检索读取权限时呈现权限骨架", async ({ page }) => {
  const deepLink = `/knowledge/retrieval-result?project=${server.projectId}&result=${encodeURIComponent(
    server.relationshipResult.entityId,
  )}&version=${encodeURIComponent(server.relationshipResult.versionId)}`;
  await login(page, server.viewerLogin, deepLink);
  await expect(page.getByText("无权访问该检索结果，或结果引用不存在")).toBeVisible();
});

test("处置角色已获知识读面、可读取机理条目", async ({ page }) => {
  // 本 change 的 task 1.2（design D-06）给 field-responder 补齐了知识治理读取面，
  // 使处置角色能读风险解释与终局结果；原先「处置角色无知识读能力」的预期已随该
  // 授权变更失效。此处按现行授权断言可读，治理写权仍不在该角色上。
  await login(page, server.responderLogin, `/knowledge/mechanisms?project=${server.projectId}`);
  await expect(page.getByText("MEC-VDS-017").first()).toBeVisible();
});

test("viewer 可查看知识治理页但不具备追溯投影权限", async ({ page }) => {
  await login(page, server.viewerLogin, `/knowledge/mechanisms?project=${server.projectId}`);
  await expect(page.getByText("MEC-VDS-017").first()).toBeVisible();
  await expect(page.getByText("关联对象").first()).toBeVisible();
  await expect(
    page.getByText(/暂无关联对象|当前角色不具备追溯投影的读取权限/).first(),
  ).toBeVisible();
});

/** 一次性故障注入：只影响这一次请求，后续走真实服务端。 */
const transientFailureBody = () =>
  JSON.stringify({
    schemaVersion: "1",
    requestId: "demo-injected-transient",
    code: "TRANSIENT_FAILURE",
    retryable: true,
    occurredAt: "2030-06-02T00:00:00.000Z",
    references: [],
  });

const fulfillTransient = (route) =>
  route.fulfill({
    status: 503,
    contentType: "application/json",
    headers: { "cache-control": "no-store" },
    body: transientFailureBody(),
  });

test("启动恢复正式会话：硬刷新保持会话且恢复前不装载业务页", async ({ page }) => {
  const deepLink = `/projects?project=${server.projectId}#evidence`;
  await login(page, server.operatorLogin, deepLink);

  await test.step("硬刷新停在恢复检查态，恢复完成前不装载业务页", async () => {
    await page.route("**/api/v1/session", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fallback();
    });
    await page.reload();
    await expect(page.locator('[data-session-state="checking"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "工程概览", level: 1 })).toHaveCount(0);
    await expect(page).toHaveURL(`${server.origin}${deepLink}`);
    await page.unroute("**/api/v1/session");
    await expect(page.getByRole("heading", { name: "工程概览", level: 1 })).toBeVisible();
    await expect(page.getByText("工程身份信息")).toBeVisible();
    await expect(page.getByRole("button", { name: "登出", exact: true })).toBeVisible();
  });
});

test("受限会话恢复后先改密，改密前无业务请求且完成后回到原深链", async ({ page }) => {
  const deepLink = `/projects?project=${server.projectId}#evidence`;
  await page.context().clearCookies();
  await page.goto(`${server.origin}${deepLink}`);
  await page.waitForURL(/\/login\?next=/);
  await loginGate(page).fill(server.restrictedLogin);
  await page.getByLabel("密码").fill(server.restrictedAccountPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();

  await test.step("受限会话被送入改密页并保留回跳目标", async () => {
    await page.waitForURL(/\/change-password\?next=/);
    await expect(page.getByRole("heading", { name: "修改密码", level: 1 })).toBeVisible();
    await expect(page.getByText("工程概览")).toHaveCount(0);
  });

  await test.step("刷新后仍在改密页，改密成功后回到原深链", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { name: "修改密码", level: 1 })).toBeVisible();
    await expect(page.getByLabel("新密码")).toBeVisible();
    await page.getByLabel("新密码").fill(server.restrictedPasswordChanged);
    // 改密动作名沿用宿主既有契约「保存」（与 C36 质量验收一致）。
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForURL(`${server.origin}${deepLink}`);
    await expect(page.getByRole("heading", { name: "工程概览", level: 1 })).toBeVisible();
  });
});

test("恢复故障按可重试失败呈现而不是匿名，重试后恢复真实会话", async ({ page }) => {
  const deepLink = `/projects?project=${server.projectId}`;
  await login(page, server.operatorLogin, deepLink);

  let injected = 0;
  await page.route("**/api/v1/session", async (route) => {
    if (route.request().method() !== "GET" || injected++ > 0) {
      await route.fallback();
      return;
    }
    await fulfillTransient(route);
  });
  await page.reload();

  await test.step("一次 503 呈现可重试恢复失败，既不是匿名也不丢原 URL", async () => {
    await expect(page.locator('[data-session-state="failed"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "重试", exact: true })).toBeVisible();
    await expect(page.getByText("RiskFlow", { exact: true }).first()).toHaveCount(0);
    await expect(page).toHaveURL(`${server.origin}${deepLink}`);
  });

  await test.step("重试走真实自省并回到工程概览", async () => {
    await page.unroute("**/api/v1/session");
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(page.getByRole("heading", { name: "工程概览", level: 1 })).toBeVisible();
  });
});

test("会话自省严格拒绝畸形响应，真实确认失效的注销进入匿名", async ({ page }) => {
  const deepLink = `/projects?project=${server.projectId}#evidence`;
  await login(page, server.operatorLogin, deepLink);

  const validMetadata = {
    schemaVersion: "1",
    sessionRef: { entityId: "session", versionId: "1" },
    accountRef: { entityId: "account", versionId: "1" },
    passwordChangeRequired: false,
    restricted: false,
    expiresAt: "2030-06-02T00:00:00.000Z",
  };
  const malformedMetadata = [
    { ...validMetadata, restricted: undefined },
    { ...validMetadata, sessionToken: "unexpected" },
    { ...validMetadata, sessionRef: { ...validMetadata.sessionRef, token: "unexpected" } },
    { ...validMetadata, expiresAt: "1" },
    { ...validMetadata, expiresAt: "2030-02-30T00:00:00.000Z" },
  ];
  for (const body of malformedMetadata) {
    let firstRead = true;
    await page.route("**/api/v1/session", async (route) => {
      if (route.request().method() === "GET" && firstRead) {
        firstRead = false;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "cache-control": "no-store" },
          body: JSON.stringify(body),
        });
        return;
      }
      await route.fallback();
    });
    await page.reload();
    await expect(page.locator('[data-session-state="failed"]')).toBeVisible();
    await expect(page).toHaveURL(`${server.origin}${deepLink}`);
    await page.unroute("**/api/v1/session");
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(page.getByRole("heading", { name: "工程概览", level: 1 })).toBeVisible();
  }

  let firstLogout = true;
  await page.route("**/api/v1/session/logout", async (route) => {
    if (!firstLogout) {
      await route.fallback();
      return;
    }
    firstLogout = false;
    // 真实服务端先完成注销，再模拟响应在网络中丢失；重试时服务端真实返回 401。
    await route.fetch();
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: transientFailureBody(),
    });
  });
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(page.getByRole("button", { name: "重试登出", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重试登出", exact: true }).click();
  await page.waitForURL(/\/login\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(deepLink);
  await page.unroute("**/api/v1/session/logout");
});

test("注销失败保持现有会话并可重试，真实注销后才进入匿名", async ({ page }) => {
  const deepLink = `/projects?project=${server.projectId}`;
  await login(page, server.operatorLogin, deepLink);
  // C37 D-17：会话是否保持，由宿主真实可观察面判断——登出入口与业务页标题都还在。
  const accountId = null;

  let injected = 0;
  await page.route("**/api/v1/session/logout", async (route) => {
    if (injected++ > 0) {
      await route.fallback();
      return;
    }
    await fulfillTransient(route);
  });

  await test.step("一次 503 保留会话并给出重试入口", async () => {
    await page.getByRole("button", { name: "登出", exact: true }).click();
    await expect(page.getByRole("button", { name: "重试登出", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "工程概览", level: 1 })).toBeVisible();
    expect(accountId).toBeNull();
    await expect(page.getByRole("button", { name: "登出", exact: true })).toBeVisible();
  });

  await test.step("真实注销成功后进入匿名", async () => {
    await page.unroute("**/api/v1/session/logout");
    await page.getByRole("button", { name: "重试登出", exact: true }).click();
    await page.waitForURL(/\/login\?next=/);
    await expect(page.getByRole("heading", { name: "工程概览", level: 1 })).toHaveCount(0);
  });
});

test("注销进行中不重复提交，延迟成功响应只结束一次会话", async ({ page }) => {
  const deepLink = `/projects?project=${server.projectId}`;
  await login(page, server.operatorLogin, deepLink);

  // 第一次注销挂起；第二次以更新代次立即失败，使「会话保留 + 重试入口」成为可见基线。
  let releaseLate;
  const lateGate = new Promise((resolve) => {
    releaseLate = resolve;
  });
  let calls = 0;
  await page.route("**/api/v1/session/logout", async (route) => {
    calls += 1;
    await lateGate;
    await route.fallback();
  });

  try {
    const logoutButton = page.getByRole("button", { name: "登出", exact: true });
    await logoutButton.click();
    await expect(logoutButton).toBeDisabled();
    await expect.poll(() => calls).toBe(1);
    // 程序化事件绕过 Playwright 对 disabled 控件的 actionability 等待，验证不会重复提交。
    await logoutButton.dispatchEvent("click");
    expect(calls).toBe(1);
  } finally {
    // 即使上面的断言失败，也释放挂起响应，避免把测试超时误报成注销竞态。
    releaseLate();
  }
  await test.step("唯一注销请求完成后进入匿名", async () => {
    await page.waitForURL(/\/login\?next=/);
    expect(calls).toBe(1);
  });
});

/**
 * CH-1 设计系统在正式生产页面上的真实消费取证（DS-S01 / DS-S09 / DS-S11 / DS-S12 / DS-S13）。
 * 这些事实只能在真实浏览器里证明：计算后的颜色、实际资源请求、焦点与局部滚动。
 */

test("生产页面取统一令牌着色，且不请求原型目录或外部 CDN", async ({ page }) => {
  const foreign = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== server.origin) foreign.push(request.url());
  });

  await login(page, server.operatorLogin, `/projects/documents?project=${server.projectId}`);
  await selectProject(page);
  await expect(page.getByText("工程资料版本列表")).toBeVisible();

  const theme = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const token = (name) => styles.getPropertyValue(name).trim();
    return {
      blue: token("--blue"),
      error: token("--error"),
      card: token("--card"),
      navWidth: token("--nav-width"),
      navWidthCompact: token("--nav-width-compact"),
      dockWidth: token("--dock-width"),
    };
  });
  // 目标尺寸令牌已发布；壳层本身尚未切换导航结构。
  expect(theme.navWidth).toBe("152px");
  expect(theme.navWidthCompact).toBe("48px");
  expect(theme.dockWidth).toBe("22rem");
  expect(theme.blue).not.toBe("");
  expect(theme.error).not.toBe(theme.blue);

  // AntD 默认主蓝不得成为第二套强调色：页面上不应出现该默认色。
  const antdDefaultBlue = await page.evaluate(() => {
    const matches = [];
    for (const element of document.querySelectorAll("*")) {
      const color = getComputedStyle(element).color;
      const background = getComputedStyle(element).backgroundColor;
      if (color === "rgb(22, 119, 255)" || background === "rgb(22, 119, 255)")
        matches.push(element.tagName);
    }
    return matches;
  });
  expect(antdDefaultBlue).toEqual([]);

  // 探针只归一化根令牌；所有断言对象都是真实生产控件。
  const colors = await page.evaluate(() => {
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const result = {};
    for (const name of ["--blue", "--text", "--card", "--focus-ring"]) {
      probe.style.color = `var(${name})`;
      result[name] = getComputedStyle(probe).color;
    }
    probe.remove();

    return result;
  });
  const selectedNav = page.locator('.app-nav a[aria-current="page"]');
  await expect(selectedNav).toHaveCSS("background-color", colors["--blue"]);
  const selectedTab = page.locator(".section-tab--active");
  await expect(selectedTab).toHaveCSS("color", colors["--blue"]);
  await expect(selectedTab).toHaveCSS("border-bottom-color", colors["--blue"]);
  const cell = page.locator(".data-table-host .ant-table-tbody td").first();
  await expect(cell).toHaveCSS("color", colors["--text"]);
  await expect(page.locator(".data-table-host .ant-table-thead th").first()).toHaveCSS(
    "background-color",
    colors["--card"],
  );
  await selectedTab.focus();
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus-visible");
  await expect(focused).toHaveCount(1);
  await expect(focused).toHaveCSS("outline-color", colors["--focus-ring"]);
  expect(
    await focused.evaluate((node) => parseFloat(getComputedStyle(node).outlineWidth)),
  ).toBeGreaterThan(0);

  expect(foreign, `外部或非部署 origin 请求：${foreign.join(", ")}`).toEqual([]);
});

test("共享表格保留当前页全部行与行身份，且不引入第二套客户端分页", async ({ page }) => {
  const catalogResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/queries/engineering-data.source-catalog") &&
      response.ok() &&
      response.request().postDataJSON().requestedSourceVersionRefs.length === 0,
  );
  await login(page, server.operatorLogin, `/projects/documents?project=${server.projectId}`);
  await selectProject(page);
  await expect(page.getByText("工程资料版本列表")).toBeVisible();

  const host = page.locator(".data-table-host").first();
  await expect(host).toBeVisible();
  // 分页归原查询所有：组件内不得再出现分页器。
  await expect(page.locator(".ant-pagination")).toHaveCount(0);

  const catalog = (await (await catalogResponse).json()).result;
  const rows = host.locator("tbody tr.ant-table-row");
  await expect(rows).toHaveCount(catalog.items.length);
  expect(
    await rows.evaluateAll((nodes) => nodes.map((node) => node.children[1].textContent)),
  ).toEqual(catalog.items.map((item) => item.sourceId));
  for (const [index, item] of catalog.items.entries()) {
    const cells = rows.nth(index).locator("td");
    await expect(cells.nth(0)).toHaveText(item.sourceName ?? item.sourceId);
    await expect(cells.nth(2)).toHaveText(item.documentType ?? "—");
    await expect(cells.nth(3)).toHaveText(item.formedAt ?? "—");
    await expect(cells.nth(4)).toHaveText(item.sourceOrganization ?? "—");
    await expect(cells.nth(5)).toHaveText(item.externalVersion ?? "—");
    await rows.nth(index).focus();
    await page.keyboard.press(index % 2 === 0 ? "Enter" : "Space");
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === `/projects/documents/${item.sourceVersionRef.reference.entityId}` &&
        url.searchParams.get("version") === item.sourceVersionRef.reference.versionId,
    );
    await page.goBack();
    await expect(rows).toHaveCount(catalog.items.length);
  }
});

test("可点击行可用键盘聚焦并触发行操作", async ({ page }) => {
  await login(page, server.operatorLogin, `/projects/documents?project=${server.projectId}`);
  await selectProject(page);
  await expect(page.getByText("工程资料版本列表")).toBeVisible();

  const clickable = page.locator(".data-table-host tbody tr.data-table-row--clickable").first();
  await expect(clickable).toHaveAttribute("tabindex", "0");

  await clickable.focus();
  await expect(clickable).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\/documents\/[^/]+/);
});

test("减弱动态效果时非必要动画停用且状态仍可读", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page, server.operatorLogin, `/projects/monitoring?project=${server.projectId}`);
  await selectProject(page);
  await expect(page.getByText("监测序列", { exact: true }).first()).toBeVisible();

  const { promise: requestGate, resolve: releaseRequest } = Promise.withResolvers();
  let failedDetail = false;
  await page.route("**/queries/engineering-data.monitoring-catalog", async (route) => {
    if (failedDetail || route.request().postDataJSON().payload.monitoringSeriesRef === undefined) {
      await route.fallback();
      return;
    }
    failedDetail = true;
    await requestGate;
    await route.abort("failed");
  });
  await page.locator("tbody tr.data-table-row--clickable").first().focus();
  await page.keyboard.press("Enter");
  const loading = page.locator('[data-page-state="loading"]');
  try {
    await expect(loading).toBeVisible();
    await expect(loading).toContainText(/加载/);
  } finally {
    releaseRequest();
  }
  const error = page.locator('[data-page-state="error"]');
  await expect(error).toBeVisible();
  const retry = error.getByRole("button", { name: "重试", exact: true });
  await expect(retry).toBeEnabled();
  await retry.focus();
  await expect(retry).toBeFocused();
  expect(failedDetail).toBe(true);
  await expect(retry).toHaveCSS("scroll-behavior", "auto");
  expect(
    await retry.evaluate((node) => parseFloat(getComputedStyle(node).transitionDuration)),
  ).toBeLessThanOrEqual(0.001);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "快照目录", exact: true })).toBeVisible();
  const snapshotChoice = page.locator(".pjmon-snapshots button").first();
  await expect(snapshotChoice).toBeVisible();
  await snapshotChoice.click();
  await expect(page.getByText("短期斜率")).toBeVisible();
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  expect(
    await canvas.evaluate((node) => {
      const pixels = node.getContext("2d").getImageData(0, 0, node.width, node.height).data;
      let painted = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] > 0) painted += 1;
      }
      return painted;
    }),
  ).toBeGreaterThan(50);
  const stable = await canvas.evaluate(async (node) => {
    const initial = node.toDataURL();
    for (let frame = 0; frame < 24; frame += 1) {
      const { promise, resolve } = Promise.withResolvers();
      requestAnimationFrame(resolve);
      await promise;
      if (node.toDataURL() !== initial) return false;
    }
    return true;
  });
  expect(stable).toBe(true);
});

test("缩小视口时二维表格在自身区域滚动，操作控件不被裁掉", async ({ page }) => {
  await login(page, server.operatorLogin, `/projects/documents?project=${server.projectId}`);
  await selectProject(page);
  await expect(page.getByText("工程资料版本列表")).toBeVisible();

  // 仅模拟较窄 CSS 视口；不作为真实浏览器 200% 缩放证据。
  await page.setViewportSize({ width: 640, height: 360 });
  await expect(page.getByText("工程资料版本列表")).toBeVisible();

  const host = page.locator(".data-table-host").first();
  const overflow = await host.evaluate((node) => {
    const before = node.scrollLeft;
    node.scrollLeft = node.scrollWidth;
    return {
      scrollable: node.scrollWidth > node.clientWidth,
      moved: node.scrollLeft > before,
      overflowX: getComputedStyle(node).overflowX,
    };
  });
  expect(["auto", "scroll"]).toContain(overflow.overflowX);
  // 页面正文不被二维内容撑开：主区宽度不超过视口。
  const mainWidth = await page
    .locator("main, .app-main")
    .first()
    .evaluate((node) => node.clientWidth);
  expect(mainWidth).toBeLessThanOrEqual(640);
  expect(overflow.scrollable).toBe(true);
  expect(overflow.moved).toBe(true);
  const row = host.locator("tbody tr.data-table-row--clickable").first();
  const sourceId = await row.locator("td").nth(1).textContent();
  await row.focus();
  await expect(row).toBeFocused();
  const visible = await row.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const hostBounds = node.closest(".data-table-host").getBoundingClientRect();
    const x = Math.max(bounds.left, hostBounds.left, 0) + 8;
    const y = Math.max(bounds.top, hostBounds.top, 0) + 8;
    return (
      y < Math.min(bounds.bottom, hostBounds.bottom, innerHeight) &&
      node.contains(document.elementFromPoint(x, y))
    );
  });
  expect(visible).toBe(true);
  await page.keyboard.press("Space");
  await expect(page).toHaveURL(/\/projects\/documents\/[^/]+/);
  await expect(page.getByText(sourceId, { exact: false }).first()).toBeVisible();
});

test("工程入口能力随路由与前台更新，同代在途合并且故障可重试", async ({ page }) => {
  await login(page, server.operatorLogin, `/projects?project=${server.projectId}`);
  await expect(page.locator('[data-navigation="projects"]')).toHaveAttribute("href", "/projects");
  let reads = 0;
  let release: (() => void) | undefined;
  let failNext = false;
  await page.route("**/api/v1/projects/*/access", async (route) => {
    reads += 1;
    if (failNext) {
      failNext = false;
      await route.abort("failed");
      return;
    }
    if (reads === 1) await new Promise<void>((resolve) => (release = resolve));
    await route.continue();
  });
  await page.locator('[data-navigation="knowledge"]').click();
  await expect.poll(() => reads).toBe(1);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
  });
  expect(reads).toBe(1);
  const completed = page.waitForResponse("**/api/v1/projects/*/access");
  release!();
  await completed;
  failNext = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByRole("button", { name: "打开停靠区" }).click();
  const failure = page.locator('[data-dock-state="capability-failed"]');
  await expect(failure).toBeVisible();
  await failure.getByRole("button", { name: "重试", exact: true }).click();
  await expect(failure).toHaveCount(0);
  expect(reads).toBe(3);
  await expect(page.locator('[data-navigation="projects"]')).toHaveAttribute("href", "/projects");
});

/**
 * CH-4 修复验收（F-05/F-09/F-10/W-01）：监测精确版本与历史快照、阈值独立状态、
 * 接入 URL 恢复与正式排除范围、服务端续页，以及无 Agent 权时不请求也不呈现。
 * 夹具引用全部来自 business-server 真实登记；任何一步失败都计为失败。
 */

const monitoringDetailLink = ({ version = server.seriesVersionId, snapshot, snapshotVersion }) => {
  const params = new URLSearchParams({
    project: server.projectId,
    version,
  });
  if (snapshot !== undefined) params.set("snapshot", snapshot);
  if (snapshotVersion !== undefined) params.set("snapshotVersion", snapshotVersion);
  return `/projects/monitoring/${encodeURIComponent(server.seriesEntityId)}?${params.toString()}`;
};

test("监测精确版本直达直接读该版本，非最新历史快照不被改写", async ({ page }) => {
  const catalogPayloads = [];
  const workspaceKinds = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    if (!request.url().endsWith("/queries/engineering-data.monitoring-catalog")) return;
    catalogPayloads.push(request.postDataJSON().payload);
  });
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    if (!request.url().endsWith("/engineering-workspace/queries")) return;
    workspaceKinds.push(request.postDataJSON().payload.kind);
  });

  const prior = server.priorSettlementSnapshotRef;
  const catalogResponse = page.waitForResponse((response) => {
    if (!response.url().endsWith("/engineering-workspace/queries")) return false;
    return response.request().postDataJSON().payload.kind === "monitoring-snapshots";
  });
  await login(
    page,
    server.operatorLogin,
    monitoringDetailLink({
      snapshot: prior.entityId,
      snapshotVersion: prior.versionId,
    }),
  );
  await selectProject(page);
  await catalogResponse;

  await expect(page.getByRole("heading", { name: "监测序列详情", level: 1 })).toBeVisible();
  // 元数据取自该精确版本：不再是空名称/空指标/空单位，也不经窄解析拼装。
  await expect(page.getByText("地表沉降监测点")).toBeVisible();
  await expect(page.getByText(/地表沉降 · 单位 mm/)).toBeVisible();
  // 选择的是历史（非最新）快照：标签与统计都按该快照版本呈现。
  await expect(page.getByText(`快照 ${prior.versionId}`, { exact: true })).toBeVisible();
  await expect(page.getByText("短期斜率")).toBeVisible();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("version") === server.seriesVersionId &&
      url.searchParams.get("snapshot") === prior.entityId &&
      url.searchParams.get("snapshotVersion") === prior.versionId,
  );
  // 精确详情不读目录列表页、不做无版本窄解析；快照目录走所属序列的精确分页读面。
  expect(catalogPayloads.length).toBeGreaterThan(0);
  expect(catalogPayloads.every((payload) => payload.monitoringSeriesRef !== undefined)).toBe(true);
  expect(workspaceKinds).not.toContain("resolve-monitoring");
  expect(workspaceKinds).toContain("monitoring-snapshots");
});

test("快照参数不成套或跨序列错配时保持安全状态", async ({ page }) => {
  const lone = server.priorSettlementSnapshotRef;
  await login(page, server.operatorLogin, monitoringDetailLink({ snapshot: lone.entityId }));
  await selectProject(page);
  await expect(page.getByText(/快照参数必须成套给出/)).toBeVisible();
  await expect(page.getByText("短期斜率")).toHaveCount(0);
  await expect(page).toHaveURL((url) => url.searchParams.get("snapshotVersion") === null);

  const wrong = server.slurryPressureSnapshotRef;
  await page.goto(
    `${server.origin}${monitoringDetailLink({
      snapshot: wrong.entityId,
      snapshotVersion: wrong.versionId,
    })}`,
  );
  // 另一序列的真实快照不满足所选序列版本：明确拒绝，不回落最新或“未选择”。
  await expect(page.getByText(/不属于该序列版本|所选快照不存在或当前会话无权访问/)).toBeVisible();
  await expect(page.getByText("短期斜率")).toHaveCount(0);
});

test("当前阈值读取失败不抹掉快照统计与批次登记事实", async ({ page }) => {
  const current = server.settlementSnapshotRef;
  await login(
    page,
    server.operatorLogin,
    monitoringDetailLink({
      snapshot: current.entityId,
      snapshotVersion: current.versionId,
    }),
  );
  await selectProject(page);
  await expect(page.getByText("短期斜率")).toBeVisible();

  // 阈值读取走独立读面。用传输失败注入技术故障（客户端会把 fetch 失败归为
  // TRANSIENT_FAILURE），页面必须保留已获准的快照与批次，而不是整页失败。
  await page.route("**/queries/knowledge-modeling.governance-read", (route) =>
    route.abort("failed"),
  );
  await page.reload();
  await expect(page.getByText(/当前知识阈值读取失败/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("短期斜率")).toBeVisible();
  await expect(page.getByText("批次与快照登记事实")).toBeVisible();
  // 批次登记事实仍然可读；该序列有两个真实批次，不能因为在同一页面上而丢失。
  await expect(page.getByText("原始批次").first()).toBeVisible();

  await page.unroute("**/queries/knowledge-modeling.governance-read");
  await page.getByRole("button", { name: "重试读取阈值" }).click();
  await expect(page.getByText(/当前阈值版本/)).toBeVisible();
});

test("接入任务按 URL 恢复精确来源，排除范围引用正式清洗结果", async ({ page }) => {
  const c34 = server.c34SourceVersionRef;
  const queries = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    if (!request.url().endsWith("/engineering-workspace/queries")) return;
    queries.push(request.postDataJSON().payload);
  });

  const target = `/projects/ingestion-tasks?project=${server.projectId}&kind=document&source=${encodeURIComponent(c34.reference.entityId)}&version=${encodeURIComponent(c34.reference.versionId)}`;
  await login(page, server.operatorLogin, target);
  await expect(page.getByRole("heading", { name: "接入事实", exact: true })).toBeVisible();
  // 接入事实与 Agent 任务列表是两个独立区域：后者是已登记的清洗任务清单，允许合法出现
  // 「数据清洗」字样；来源清理事实只以接入事实区的阶段项判断。
  const factsCard = page
    .locator("section.card")
    .filter({ has: page.getByRole("heading", { name: "接入事实", exact: true }) });
  const agentCard = page
    .locator("section.card")
    .filter({ has: page.getByRole("heading", { name: "可选清洗任务（Agent）" }) });
  await expect(factsCard.locator('li[aria-label="文档转换"]').first()).toBeVisible();
  await expect(factsCard.locator('li[aria-label="数据清洗"]').first()).toBeVisible();
  await expect(agentCard.getByRole("link", { name: "打开任务详情" }).first()).toBeVisible();

  // 刷新仍按 URL 的同一来源版本重建，不需要再点列表。
  await page.reload();
  await expect(factsCard.locator('li[aria-label="数据清洗"]').first()).toBeVisible();
  const ingestionQueries = queries.filter((payload) => payload.kind === "ingestion");
  const ingestion = ingestionQueries.at(-1);
  expect(ingestion.subject.reference).toEqual({
    entityId: c34.reference.entityId,
    versionId: c34.reference.versionId,
  });

  // 正式结果引用只从 cleaning 条目取得，未展开前不发排除项请求。
  expect(queries.filter((payload) => payload.kind === "cleaning-exclusions")).toEqual([]);
  const exclusionResponse = page.waitForResponse((response) => {
    if (!response.url().endsWith("/engineering-workspace/queries")) return false;
    return response.request().postDataJSON().payload.kind === "cleaning-exclusions";
  });
  await page.getByRole("button", { name: "核对正式排除范围" }).first().click();
  const response = await exclusionResponse;
  expect(response.status()).toBe(200);
  const payload = response.request().postDataJSON().payload;
  expect(payload.resultRef.kind).toBe("route-decision");
  expect(payload.subject.reference).toEqual({
    entityId: c34.reference.entityId,
    versionId: c34.reference.versionId,
  });
  expect(queries.filter((candidate) => candidate.kind === "cleaning-exclusions")).toHaveLength(1);

  // 切到监测来源会清掉 URL 的来源与版本，接入事实区不再保留旧资料 subject；
  // 已登记的 Agent 清洗任务列表不受来源切换影响，必须仍然可见。
  const ingestionCount = ingestionQueries.length;
  await page.getByRole("button", { name: "监测", exact: true }).click();
  await expect(factsCard.locator('li[aria-label="数据清洗"]')).toHaveCount(0);
  await expect(factsCard.getByText(/尚未选择来源/)).toBeVisible();
  await expect(agentCard.getByRole("link", { name: "打开任务详情" }).first()).toBeVisible();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("kind") === "monitoring" &&
      url.searchParams.get("source") === null &&
      url.searchParams.get("version") === null,
  );
  // 切换只清空本页 subject，不按旧资料来源补发接入或排除请求。
  expect(queries.filter((candidate) => candidate.kind === "ingestion")).toHaveLength(
    ingestionCount,
  );
  expect(
    queries
      .filter((candidate) => candidate.kind === "ingestion")
      .every(
        (candidate) =>
          candidate.subject.reference.entityId === c34.reference.entityId &&
          candidate.subject.reference.versionId === c34.reference.versionId,
      ),
  ).toBe(true);
  expect(queries.filter((candidate) => candidate.kind === "cleaning-exclusions")).toHaveLength(1);
});

test("接入任务监测来源呈现已登记批次与快照阶段", async ({ page }) => {
  const target = `/projects/ingestion-tasks?project=${server.projectId}&kind=monitoring&source=${encodeURIComponent(server.seriesEntityId)}&version=${encodeURIComponent(server.seriesVersionId)}`;
  await login(page, server.operatorLogin, target);
  await expect(page.getByText("监测批次").first()).toBeVisible();
  await expect(page.getByText("监测快照").first()).toBeVisible();
});

test("接入来源与监测目录按服务端游标续页，续页行仍按真实标识打开", async ({ page }) => {
  await login(
    page,
    server.operatorLogin,
    `/projects/ingestion-tasks?project=${server.projectId}&kind=document`,
  );
  await expect(page.getByText(/共 \d+ 条 · 当前页 \d+ 条/)).toBeVisible();
  const sourcePage = page.waitForResponse((response) => {
    if (!response.url().endsWith("/queries/engineering-data.source-catalog")) return false;
    return typeof response.request().postDataJSON().payload?.cursor === "string";
  });
  await page.getByRole("button", { name: "继续读取后续页" }).click();
  await sourcePage;
  await expect(page.getByText(server.secondPageSourceId, { exact: false }).first()).toBeVisible();

  await page.goto(`${server.origin}/projects/monitoring?project=${server.projectId}`);
  await expect(page.getByRole("heading", { name: "监测数据", level: 1 })).toBeVisible();
  const seriesPage = page.waitForResponse((response) => {
    if (!response.url().endsWith("/queries/engineering-data.monitoring-catalog")) return false;
    return typeof response.request().postDataJSON().payload?.cursor === "string";
  });
  await page.getByRole("button", { name: "继续读取后续页" }).click();
  await seriesPage;
  const secondPageSeries = page
    .locator(".data-table-host tbody tr", { hasText: server.secondPageSeriesId })
    .first();
  await expect(secondPageSeries).toBeVisible();
  // 续页行按真实标识打开精确序列版本；合成序列没有批次/快照，呈现真实空态而不是样例。
  await secondPageSeries.click();
  await page.waitForURL(new RegExp(`/projects/monitoring/${server.secondPageSeriesId}(\\?|$)`));
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("version") === server.secondPageSeriesVersionId,
  );
  await expect(page.getByText(/该序列尚无冻结快照/)).toBeVisible();
});

test("无 Agent 读取权限时不请求也不呈现清洗任务", async ({ page }) => {
  let agentReads = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/queries/agent-task.read")) agentReads += 1;
  });
  await login(
    page,
    server.viewerLogin,
    `/projects/ingestion-tasks?project=${server.projectId}&kind=document`,
  );
  await expect(page.getByRole("heading", { name: "接入任务", level: 1 })).toBeVisible();
  await expect(page.getByText(/共 \d+ 条 · 当前页 \d+ 条/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "可选清洗任务（Agent）" })).toHaveCount(0);
  expect(agentReads).toBe(0);
});

test("获准 Agent 读取时独立列出数据清洗任务并给出精确链接", async ({ page }) => {
  await login(
    page,
    server.operatorLogin,
    `/projects/ingestion-tasks?project=${server.projectId}&kind=document`,
  );
  await expect(page.getByRole("heading", { name: "可选清洗任务（Agent）" })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开任务详情" }).first()).toHaveAttribute(
    "href",
    /\/agent\/tasks\/[^?]+\?[^#]*taskVersion=/,
  );
});
