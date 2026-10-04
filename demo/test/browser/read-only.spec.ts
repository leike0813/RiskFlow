/**
 * C32 demo 只读链路真实浏览器验收：登录 → 工程选择 → 工程概览 → 资料目录/详情 →
 * 监测详情 → 知识治理四页 → 证据脱敏两态 → 检索深链 → 权限降级。
 * 服务由 server.mjs 以真实 PostgreSQL/迁移/会话/工件接缝启动；任何一步失败都计为失败。
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

/**
 * 启动先自省：会话仍有效时直接落在目标页，只有 401 才出现登录表单。
 * 同一次验收里连续打开多个深页时，后面的深链不再需要（也不应该）重复登录。
 */
const login = async (page, loginName, targetPath, password = server.accountPassword) => {
  const target = `${server.origin}${targetPath}`;
  await page.goto(target);
  // 启动先自省：只有 401 才落到登录表单。会话仍有效时表单不会出现，等它落定即可，
  // 同一个浏览器上下文里连续打开多个深页时不再重复登录。
  const needsLogin = await page
    .getByLabel("登录名")
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(
      () => true,
      () => false,
    );
  if (needsLogin) {
    await expect(page.getByText("RiskFlow", { exact: true }).first()).toBeVisible();
    await page.getByLabel("登录名").fill(loginName);
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
  }
  await page.waitForURL(target);
};

const selectProject = async (page) => {
  await page.getByRole("button", { name: "选择工程" }).click();
  await page.getByLabel("工程标识").fill(server.projectId);
  await page.getByRole("button", { name: "确定" }).click();
  await expect(page.getByText(`当前工程：${server.projectId}`)).toBeVisible();
};

test("未登录跳转登录页，登录后回到原目标页", async ({ page }) => {
  await login(page, server.operatorLogin, `/project?project=${server.projectId}`);
  await expect(page.getByRole("heading", { name: "工程概览", level: 1 })).toBeVisible();
});

test("工程概览呈现真实上下文、适用性三维与发布集合", async ({ page }) => {
  await login(page, server.operatorLogin, "/project");
  await selectProject(page);
  await expect(page.getByText("工程身份信息")).toBeVisible();
  await expect(page.getByText(server.projectId).first()).toBeVisible();
  await expect(page.getByText("变径盾构法")).toBeVisible();
  await expect(page.getByText("富水软弱地层")).toBeVisible();
  await expect(page.getByText("变径空间扩挖").first()).toBeVisible();
  await expect(page.getByText("站隧一体化试验区段")).toBeVisible();
  await expect(page.getByRole("heading", { name: "发布集合版本引用" })).toBeVisible();
  await expect(page.getByText("风险矩阵").first()).toBeVisible();
});

test("资料目录与详情呈现登记事实，证据抽屉呈现定位", async ({ page }) => {
  await login(page, server.operatorLogin, `/project/documents?project=${server.projectId}`);
  await expect(page.getByText("工程资料版本列表")).toBeVisible();
  await expect(
    page.getByText(server.sourceAVersionEntityId, { exact: false }).first(),
  ).toBeVisible();
  // 无写操作入口
  await expect(page.getByRole("button", { name: "登记资料" })).toHaveCount(0);

  await page.getByText(server.sourceAVersionEntityId, { exact: false }).first().click();
  await page.waitForURL(/\/project\/documents\//);
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
  await login(page, server.operatorLogin, `/project/monitoring?project=${server.projectId}`);
  await expect(page.getByText("监测序列", { exact: true }).first()).toBeVisible();
  await page.getByText("地表沉降监测点").click();
  await page.waitForURL(new RegExp(`/project/monitoring/${server.seriesEntityId}`));
  await expect(page.getByText("短期斜率")).toBeVisible();
  await expect(page.getByText("批次与快照登记事实")).toBeVisible();
  await expect(page.getByText("原始批次")).toBeVisible();
});

test("知识治理四页呈现真实发布事实且无写入口", async ({ page }) => {
  await login(page, server.operatorLogin, `/knowledge/mechanisms?project=${server.projectId}`);
  await expect(page.getByText("MEC-VDS-017").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "新建机理条目" })).toHaveCount(0);

  await page.getByRole("link", { name: "评分规则" }).click();
  await page.waitForURL(/\/knowledge\/rules/);
  await expect(page.getByText("适用规则集", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("RULE-SETTLE-001").first()).toBeVisible();

  await page.getByRole("link", { name: "风险矩阵" }).click();
  await page.waitForURL(/\/knowledge\/matrix/);
  await expect(page.getByText("demo-c32-matrix")).toBeVisible();
  await expect(page.getByText("2026.06")).toBeVisible();

  await page.getByRole("link", { name: "措施库" }).click();
  await page.waitForURL(/\/knowledge\/measures/);
  await expect(page.getByText("MS-001").first()).toBeVisible();
  await expect(page.getByText("加强同步注浆并复测")).toBeVisible();
});

test("工序模型页呈现已发布模型与必含五节点覆盖", async ({ page }) => {
  await login(
    page,
    server.operatorLogin,
    `/identification/process-model?project=${server.projectId}`,
  );
  await expect(page.getByText("PN-EXPAND-02").first()).toBeVisible();
  await expect(page.getByText("变径空间扩挖").first()).toBeVisible();
  await expect(page.getByText(/必含五节点覆盖：全部覆盖/)).toBeVisible();
});

test("无资料授权时证据抽屉呈现固定脱敏提示", async ({ page }) => {
  await login(page, server.operatorLogin, `/knowledge/mechanisms?project=${server.projectId}`);
  await expect(page.getByText("MEC-VDS-017").first()).toBeVisible();
  // 机理详情的第二条证据指向受限资料 B：只呈现定位摘要与固定脱敏提示。
  const restrictedSegment = page.getByRole("button", {
    name: new RegExp(`${server.sourceBVersionEntityId ?? ""}-chapter_1-segment_1`),
  });
  await restrictedSegment.first().click();
  await expect(page.locator(".evidence-drawer-title")).toBeVisible();
  await expect(
    page.getByText("当前会话无该资料来源版本的访问授权，仅呈现定位摘要，不提供段正文。"),
  ).toBeVisible();
});

test("检索结果深链呈现关系上下文；viewer 无检索读取权限", async ({ page }) => {
  const deepLink = `/knowledge/retrieval-result?project=${server.projectId}&result=${encodeURIComponent(
    server.relationshipResult.entityId,
  )}&version=${encodeURIComponent(server.relationshipResult.versionId)}`;
  await login(page, server.operatorLogin, deepLink);
  await expect(page.getByText("当前工序节点：PN-EXPAND-02")).toBeVisible();
  await expect(page.getByText("MEC-VDS-017").first()).toBeVisible();
  await expect(page.getByText("MEC-VDS-018")).toBeVisible();
  // 检索页没有临时检索入口
  await expect(page.getByRole("textbox")).toHaveCount(0);
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
  const deepLink = `/project?project=${server.projectId}#evidence`;
  await login(page, server.operatorLogin, deepLink);

  await test.step("硬刷新停在恢复检查态，恢复完成前不装载业务页", async () => {
    await page.route("**/api/v1/session", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fallback();
    });
    await page.reload();
    await expect(page.getByText("正在恢复会话")).toBeVisible();
    await expect(page.getByRole("heading", { name: "工程概览", level: 1 })).toHaveCount(0);
    await expect(page).toHaveURL(`${server.origin}${deepLink}`);
    await page.unroute("**/api/v1/session");
    await expect(page.getByRole("heading", { name: "工程概览", level: 1 })).toBeVisible();
    await expect(page.getByText("工程身份信息")).toBeVisible();
    await expect(page.getByRole("button", { name: "登出", exact: true })).toBeVisible();
  });
});

test("受限会话恢复后先改密，改密前无业务请求且完成后回到原深链", async ({ page }) => {
  const deepLink = `/project?project=${server.projectId}#evidence`;
  await page.context().clearCookies();
  await page.goto(`${server.origin}${deepLink}`);
  await page.waitForURL(/\/login\?next=/);
  await page.getByLabel("登录名").fill(server.restrictedLogin);
  await page.getByLabel("密码").fill(server.restrictedAccountPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();

  await test.step("受限会话被送入改密页并保留回跳目标", async () => {
    await page.waitForURL(/\/change-password\?next=/);
    await expect(page.getByText("首次登录需要修改初始密码")).toBeVisible();
    await expect(page.getByText("工程概览")).toHaveCount(0);
  });

  await test.step("刷新后仍在改密页，改密成功后回到原深链", async () => {
    await page.reload();
    await expect(page.getByText("首次登录需要修改初始密码")).toBeVisible();
    await expect(page.getByLabel("新密码")).toBeVisible();
    await page.getByLabel("新密码").fill(server.restrictedPasswordChanged);
    await page.getByRole("button", { name: "提交", exact: true }).click();
    await page.waitForURL(`${server.origin}${deepLink}`);
    await expect(page.getByRole("heading", { name: "工程概览", level: 1 })).toBeVisible();
  });
});

test("恢复故障按可重试失败呈现而不是匿名，重试后恢复真实会话", async ({ page }) => {
  const deepLink = `/project?project=${server.projectId}`;
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
    await expect(page.getByText("会话恢复失败")).toBeVisible();
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
  const deepLink = `/project?project=${server.projectId}#evidence`;
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
    await expect(page.getByText("会话恢复失败")).toBeVisible();
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
  const deepLink = `/project?project=${server.projectId}`;
  await login(page, server.operatorLogin, deepLink);
  const accountId = await page.locator(".shell-context-item").first().textContent();

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
    expect(await page.locator(".shell-context-item").first().textContent()).toBe(accountId);
  });

  await test.step("真实注销成功后进入匿名", async () => {
    await page.unroute("**/api/v1/session/logout");
    await page.getByRole("button", { name: "重试登出", exact: true }).click();
    await page.waitForURL(/\/login\?next=/);
    await expect(page.getByRole("heading", { name: "工程概览", level: 1 })).toHaveCount(0);
  });
});

test("注销进行中不重复提交，延迟成功响应只结束一次会话", async ({ page }) => {
  const deepLink = `/project?project=${server.projectId}`;
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
