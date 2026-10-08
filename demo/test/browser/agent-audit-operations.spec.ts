/**
 * C35 Agent 工作台 + 复核与审计 + 报告导出 + 运维面的真实浏览器验收（IP-11，task 4.1/4.2）。
 *
 * 覆盖 design §6 的 Web Scenario：
 *   - 三条业务窄读（Agent 任务、复核与审计、报告导出）对有权主体成立、对纯系统管理员同形失败；
 *   - 六项系统管理动作逐项在浏览器里真实执行并回到目录核对；
 *   - 确认对话框的键盘焦点与零写副作用；
 *   - 授权撤销在同一个账号上关闭已成立的读取；
 *   - Agent 任务读的有界单在途刷新与工程切换后的代次守卫；
 *   - 报告导出的真实 JSON 下载与对象 URL 释放；
 *   - 备份面如实缺席且零恢复请求；
 *   - 健康与模型版本面按真实事实与缺席原因呈现。
 *
 * 服务由 server.mjs 以同一个真实 PostgreSQL 启动：五条 C35 端口全部指向生产代码，
 * 不存在第二个数据库、假事务或替身端口。任何一步失败都计为失败，跳过不计通过。
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
 * 口令按账号取：管理员与业务账号的初始口令不同，均由装配登记。
 */
const login = async (page, loginName, password, targetPath) => {
  const target = `${server.origin}${targetPath}`;
  await page.goto(target);
  const needsLogin = await page
    .getByLabel("登录名")
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true, () => false);
  if (needsLogin) {
    await page.getByLabel("登录名").fill(loginName);
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
  }
  await page.waitForURL(target);
};

const loginOperator = (page, targetPath) =>
  login(page, server.operatorLogin, server.accountPassword, targetPath);

const loginAdministrator = (page, targetPath) =>
  login(page, server.administratorLogin, server.administratorPassword, targetPath);

const loginViewer = (page, targetPath) =>
  login(page, server.viewerLogin, server.accountPassword, targetPath);

/** 深链必须带工程与可选参数：直接字符串拼接会在已有查询串后接出 `?a=1?project=…` 这种坏 URL。 */
const withProject = (path, params = {}) =>
  `${path}?${new URLSearchParams({ project: server.projectId, ...params }).toString()}`;

/**
 * SPA 内跳转：demo 会话只在 React 状态里，整页刷新即回登录页，
 * 登录后不得再用 page.goto；pushState + popstate 驱动 React Router 换路由。
 */
const gotoSpa = async (page, path) => {
  await page.evaluate((url) => {
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
};

/**
 * 会话 cookie 是 `__Host-` 前缀的 Secure cookie：只在真实浏览器上下文里随同源请求携带，
 * Playwright 的独立请求上下文按 HTTP 语义拒绝携带它。因此这些断言性请求一律由页面自己
 * 在同源 fetch 发出——走的是与页面完全相同的传输路径、Origin 与会话，不额外开旁路。
 */
const apiRequest = async (page, method, path, body) =>
  page.evaluate(
    async ({ verb, target, payload }) => {
      const response = await fetch(target, {
        method: verb,
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          ...(payload === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      const text = await response.text();
      return { status: response.status, body: text.length === 0 ? null : JSON.parse(text) };
    },
    { verb: method, target: path, payload: body },
  );

/** 查询身份必须唯一：同 queryId 的重复登记会被 C31 当成同一次查询。 */
let querySequence = 0;
const submitQueryRequest = async (page, branch, payload) => {
  querySequence += 1;
  return apiRequest(page, "POST", `/api/v1/projects/${server.projectId}/queries/${branch}`, {
    schemaVersion: "1",
    queryId: `ip11-${branch.replaceAll(".", "-")}-${querySequence}`,
    requestedAt: new Date().toISOString(),
    requestedSpatialScopeRefs: [],
    requestedSourceVersionRefs: [],
    payload,
  });
};

const audit = () => server.agentAudit;

/**
 * 系统管理查询与命令：走真实传输层，带真实会话 cookie、真实 Origin 与真实授权面。
 * 管理面是独立入口（`/api/v1/administration/*`），不挂在工程上下文下。
 */
let administrationSequence = 0;
const administrationQuery = async (page, payload) => {
  administrationSequence += 1;
  return apiRequest(page, "POST", "/api/v1/administration/queries", {
    schemaVersion: "1",
    queryId: `ip11-administration-q-${administrationSequence}`,
    requestedAt: new Date().toISOString(),
    payload,
  });
};

const administrationCommand = async (page, commandId, payload) =>
  apiRequest(page, "POST", "/api/v1/administration/commands", {
    schemaVersion: "1",
    commandId,
    idempotencyKey: commandId,
    issuedAt: new Date().toISOString(),
    payload,
  });

test("三条业务窄读对工程成员成立：Agent 任务、复核与审计、报告导出均返回真实事实", async ({
  page,
}) => {
  await loginOperator(page, withProject("/agent"));

  const taskList = await submitQueryRequest(page, "agent-task.read", {
    kind: "list",
    pageSize: 25,
  });
  expect(taskList.status).toBe(200);
  expect(taskList.body.kind).toBe("succeeded");
  expect(taskList.body.result.kind).toBe("list");
  const taskIds = taskList.body.result.items.map((item) => item.agentTaskRef.reference.entityId);
  expect(taskIds).toContain(audit().agentTask.entityId);

  // 活动流按登记时点倒序返回真实条目：本次装配刚发生的报告导出命令必须在其中，
  // 证明读的是同一份审计事实，而不是空壳或占位。
  const activities = await submitQueryRequest(page, "review-audit.read", {
    kind: "activities",
    pageSize: 25,
  });
  expect(activities.status).toBe(200);
  expect(activities.body.kind).toBe("succeeded");
  expect(activities.body.result.kind).toBe("activities");
  expect(activities.body.result.items.length).toBeGreaterThan(0);
  for (const item of activities.body.result.items) {
    expect(typeof item.occurredAt).toBe("string");
    expect(typeof item.sourceType).toBe("string");
  }
  expect(
    activities.body.result.items.some((item) => item.commandId === "demo-c35-report-export"),
    "刚完成的真实报告导出命令必须出现在审计活动里",
  ).toBe(true);

  const policies = await submitQueryRequest(page, "projection.report-read", {
    kind: "policies",
  });
  expect(policies.status).toBe(200);
  expect(policies.body.kind).toBe("succeeded");
  expect(
    policies.body.result.items.map((item) => item.policyRef.entityId),
  ).toContain(audit().reportExportPolicyRef.entityId);
});

test("纯系统管理员在三条业务窄读口同形失败，在运维面照常可用", async ({ page }) => {
  await loginAdministrator(page, "/ops/access");

  // 管理身份成立，且被服务端明确判定为系统管理员（不是客户端推断）。
  const identity = await apiRequest(page, "GET", "/api/v1/administration");
  expect(identity.status).toBe(200);
  const identityBody = identity.body;
  expect(identityBody.result.isSystemAdministrator).toBe(true);
  expect(identityBody.result.allowedActions).toEqual(
    expect.arrayContaining([
      "create-account",
      "disable-account",
      "reset-password",
      "open-project",
      "suspend-project",
      "revise-membership",
    ]),
  );

  // 同一工程上，纯管理员的三条业务窄读一律按「无权与不存在同形」收口（HTTP 404 NOT_FOUND），
  // 而不是回一个说明存在性的 403。
  for (const [branch, payload] of [
    ["agent-task.read", { kind: "list", pageSize: 5 }],
    ["review-audit.read", { kind: "activities", pageSize: 5 }],
    ["projection.report-read", { kind: "policies" }],
  ]) {
    const response = await submitQueryRequest(page, branch, payload);
    expect(response.status, `${branch} 应按同形失败收口`).toBe(404);
    expect(response.body.code).toBe("NOT_FOUND");
  }

  // 业务页按无权呈现：顶栏明确本工程无权，业务页不泄露任何队列或任务内容。
  await gotoSpa(page, withProject("/review"));
  await expect(page.getByText("无权访问该工程")).toBeVisible();
  await expect(page.getByText("当前角色不具备复核队列的读取权限")).toBeVisible();
  await expect(page.getByText(audit().reviewTask.entityId)).toHaveCount(0);
});

test("Agent 任务窄读按精确引用返回真实任务事实", async ({ page }) => {
  await loginOperator(page, withProject("/agent"));
  await expect(page.getByRole("heading", { name: "智能 Agent", level: 1 })).toBeVisible();

  // 先用窄读口取回真实的任务信封，再拿这个逐字相同的信封去读详情与行动：断言的是
  // 服务端登记事实本身，页面渲染另由工作台/详情页各自的用例承担。
  const list = await submitQueryRequest(page, "agent-task.read", { kind: "list", pageSize: 25 });
  expect(list.status).toBe(200);
  expect(list.body.result.kind).toBe("list");
  const envelope = list.body.result.items.find(
    (item) => item.agentTaskRef.reference.entityId === audit().agentTask.entityId,
  )?.agentTaskRef;
  expect(envelope, "列表读必须包含夹具播种的清洗任务").toBeDefined();
  expect(envelope.modelDeploymentRef.entityId).toBe("demo-c15-cleaning-model");

  const detail = await submitQueryRequest(page, "agent-task.read", {
    kind: "detail",
    agentTaskRef: envelope,
  });
  expect(detail.status).toBe(200);
  expect(detail.body.result.summary.status).toBe("completed");
  expect(detail.body.result.summary.agentTaskRef.reference.entityId).toBe(
    audit().agentTask.entityId,
  );
  // 任务详情只给预算台账与正式结果引用，行动与候选各自按分区读，不混进详情。
  expect(detail.body.result.summary.taskVersion).toBeGreaterThan(0);

  const actions = await submitQueryRequest(page, "agent-task.read", {
    kind: "actions",
    agentTaskRef: envelope,
    pageSize: 25,
  });
  expect(actions.status).toBe(200);
  expect(actions.body.result.kind).toBe("actions");
  expect(actions.body.result.items.length).toBeGreaterThan(0);
  for (const action of actions.body.result.items) {
    // 行动标识必须是任务作用域内的真实标识，且每条都带真实登记的行动类型与用量。
    expect(action.actionId).toContain(audit().agentTask.entityId);
    expect(typeof action.actionType).toBe("string");
    expect(action.usage.toolInvocations).toBeGreaterThanOrEqual(0);
  }

  // 候选分区按服务端真实结果呈现：有候选的给候选表，没有的给空态，不允许用占位候选冒充。
  const pendingEnvelope = list.body.result.items.find(
    (item) => item.status === "pending" && item.agentTaskRef.taskType !== envelope.taskType,
  )?.agentTaskRef;
  expect(pendingEnvelope, "工作台须至少有一个待决任务").toBeDefined();
  const pendingCandidates = await submitQueryRequest(page, "agent-task.read", {
    kind: "candidates",
    agentTaskRef: pendingEnvelope,
    pageSize: 25,
  });
  expect(pendingCandidates.status).toBe(200);
  expect(pendingCandidates.body.result.kind).toBe("candidates");
});

test("确认对话框：焦点移入取消、Tab 环绕、Escape 归还焦点，且取消零写", async ({ page }) => {
  const decideCalls = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/commands/review-audit.decide-review")) {
      decideCalls.push(request.url());
    }
  });

  // 决定从复核队列行发起（详情页的分支按读面判定的动作清单呈现，两者都是真实读面）。
  await loginOperator(page, withProject("/review"));
  const pendingRow = page.locator("tr", { hasText: audit().reviewTask.entityId });
  await expect(pendingRow).toBeVisible();
  const trigger = pendingRow.getByRole("button", { name: "通过", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // 打开即把焦点移到取消按钮：默认落点是撤销而不是执行。
  await expect(page.getByRole("button", { name: "取消", exact: true })).toBeFocused();

  // Tab 环绕：从最后一个可聚焦元素继续 Tab 回到第一个，Shift+Tab 反向同理。
  await page.getByRole("button", { name: "确认通过", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "关闭" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "确认通过", exact: true })).toBeFocused();

  // Escape 关闭并把焦点归还触发按钮；此前后端一个写请求都不该发生。
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(decideCalls).toEqual([]);

  // 再开一次并点取消：仍然零写。
  await trigger.click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(decideCalls).toEqual([]);
});

test("识别分组复核：按类型呈现分支、不自造候选，决定经队列落库后可见", async ({ page }) => {
  await loginOperator(
    page,
    withProject(`/review/identification/${encodeURIComponent(audit().reviewTask.entityId)}`, { version: audit().reviewTask.versionId }),
  );
  await expect(page.getByRole("heading", { name: "识别候选复核", level: 1 })).toBeVisible();
  await expect(page.getByText(audit().reviewTask.entityId).first()).toBeVisible();

  // 「修正并通过」只接受所属模块给出的候选集身份版本。复核详情未返回候选引用时它
  // 按业务不可用呈现，页面不得自造候选，也不得把候选输入框摆在决定之前。
  await expect(
    page.getByText("复核详情未返回修正候选引用，「修正并通过」在当前候选集下业务不可用。"),
  ).toBeVisible();
  const revised = page.getByRole("button", { name: "修正并通过", exact: true });
  await expect(revised).toBeVisible();
  await expect(revised).toBeDisabled();

  // 真实提交一次按原样通过：决定经 C07 命令落库，并在队列页按精确引用回显。
  await gotoSpa(page, withProject("/review"));
  const row = page.locator("tr", { hasText: audit().reviewTask.entityId });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "通过", exact: true }).click();
  await page.getByRole("button", { name: "确认通过", exact: true }).click();
  const outcome = page.locator("li", { hasText: audit().reviewTask.entityId }).first();
  await expect(outcome.getByText(/已登记（决定 review-decision-/)).toBeVisible();

  // 决定之后该任务不再是待决：队列行不再给出决定入口。
  const decidedRow = page.locator("tr", { hasText: audit().reviewTask.entityId });
  await expect(decidedRow.getByRole("button", { name: "通过", exact: true })).toHaveCount(0);
});

test("授权撤销在同一个账号上关闭已成立的读取", async ({ page }) => {
  await loginViewer(page, withProject("/review/audit"));
  const beforeRevoke = await submitQueryRequest(page, "review-audit.read", {
    kind: "activities",
    pageSize: 25,
  });
  expect(beforeRevoke.status).toBe(200);

  // 真实 C06 成员状态改写：同一个账号、同一个成员，从 active 置为 removed。
  const removedVersion = await server.setViewerMembershipStatus("removed");
  expect(typeof removedVersion).toBe("string");
  try {
    const afterRevoke = await submitQueryRequest(page, "review-audit.read", {
      kind: "activities",
      pageSize: 25,
    });
    expect(afterRevoke.status).toBe(404);
    expect(afterRevoke.body.code).toBe("NOT_FOUND");

    // 页面也按同一权限事实失败闭合：点刷新首屏触发重读，读取被授权面关闭后不再呈现旧内容。
    await page.getByRole("button", { name: "刷新首屏" }).click();
    await expect(page.getByText("当前角色不具备审计活动读取权限")).toBeVisible();
    await expect(page.getByText(/已加载 \d+ 条/)).toHaveCount(0);
  } finally {
    await server.setViewerMembershipStatus("active");
  }

  // 恢复授权后同一账号立刻恢复读取：证明关闭来自撤销本身。
  const restored = await submitQueryRequest(page, "review-audit.read", {
    kind: "activities",
    pageSize: 25,
  });
  expect(restored.status).toBe(200);
});

test("Agent 任务读在慢读下最多一个在途请求，切工程立刻中止在途并停止刷新", async ({ page }) => {
  // 有界单在途与代次守卫都发生在请求层，这里直接在请求层观测：并发峰值、请求计数，
  // 以及切工程后在途请求是否被中止、节拍是否停掉。慢读由路由层施加，不改服务端。
  let inFlight = 0;
  let peakInFlight = 0;
  let started = 0;
  const pending = new Set();
  const aborted = [];
  page.on("requestfailed", (request) => {
    if (request.url().includes("/queries/agent-task.read")) {
      aborted.push(request.failure()?.errorText ?? "failed");
      pending.delete(request);
    }
  });
  await page.route("**/queries/agent-task.read", async (route) => {
    const request = route.request();
    started += 1;
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    pending.add(request);
    // 8 秒慢读：跨越两个以上刷新节拍（5 秒一个），慢读期间不得堆积第二个请求。
    await new Promise((resolve) => setTimeout(resolve, 8_000));
    if (pending.delete(request)) inFlight -= 1;
    try {
      await route.continue();
    } catch {
      // 页面已切工程并中止在途请求时路由放行会失败：这正是代次守卫要拦的场景。
    }
  });

  await loginOperator(page, withProject("/agent"));
  // 26 秒覆盖三个 5 秒节拍：慢读期间发出的新请求不得与在途请求重叠。
  await page.waitForTimeout(26_000);
  expect(started, "慢读期间至少完成两轮单在途读取").toBeGreaterThanOrEqual(2);
  expect(peakInFlight, "任何时刻最多一个在途请求").toBe(1);

  // 切到没有工程上下文的工程标识：在途读取被中止，本工程的事实立即清空、不再节拍刷新。
  const beforeSwitch = started;
  await gotoSpa(page, "/agent?project=demo-c35-unknown-project");
  await page.waitForTimeout(2_000);
  expect(aborted.length, "切工程必须中止在途读取").toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(15_000);
  expect(started, "切工程后不得再向旧工程发起刷新").toBe(beforeSwitch);
});

test("报告导出：登记策略、范围预览与真实 JSON 下载，下载后对象 URL 被释放", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const created = [];
    const revoked = [];
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (value) => {
      const url = create(value);
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      revoked.push(url);
      return revoke(url);
    };
    window.__objectUrls = { created, revoked };
  });

  await loginOperator(
    page,
    withProject('/report/export', {
      sourceKind: 'query-result',
      sourceId: audit().reportQueryResultRef.entityId,
      sourceVersion: audit().reportQueryResultRef.versionId,
    }),
  );
  await expect(page.getByRole("heading", { name: "报告导出", level: 1 })).toBeVisible();
  // 已登记的版本化导出策略真实呈现。
  await expect(page.getByText(audit().reportExportPolicyRef.entityId, { exact: true })).toBeVisible();
  // 真实登记的导出工件出现在导出历史里，来源引用是同一次 risk-overview 登记。
  await expect(
    page.getByText(audit().reportExportArtifactRef.reference.entityId, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(audit().reportQueryResultRef.entityId, { exact: true }),
  ).toBeVisible();

  // 范围预览按登记引用发起：真实读取服务端登记的查询结果，不扫全工程。
  await page.getByRole("button", { name: "预览已登记范围" }).click();
  const preview = page.getByRole("region", { name: "导出范围预览" });
  await expect(preview.getByText("本页条目数")).toBeVisible();
  await expect(preview.getByText("risk-overview")).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 JSON" }).click();
  const file = await download;
  expect(file.suggestedFilename().length).toBeGreaterThan(0);
  const failure = await file
    .createReadStream()
    .then(
      (stream) =>
        new Promise((resolve, reject) => {
          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
          stream.on("error", reject);
        }),
    );
  // 下载正文是服务端登记的 JSON 工件原样落地：能解析，且带导出身份。
  const body = JSON.parse(failure);
  expect(body.format).toBe("json");
  expect(body.queryResultRef.reference.entityId).toBe(audit().reportQueryResultRef.entityId);

  // 下载期间页面持有的对象 URL 尚未撤销（否则浏览器取不到文件），
  // 离开页面时必须被释放。
  const heldAfterDownload = await page.evaluate(() => ({
    created: window.__objectUrls.created.length,
    revoked: window.__objectUrls.revoked.length,
  }));
  expect(heldAfterDownload.created).toBeGreaterThanOrEqual(1);
  expect(heldAfterDownload.revoked).toBeLessThan(heldAfterDownload.created);

  // SPA 切换到另一页：同一文档内才能观测对象 URL 是否随卸载释放
  //（整页跳转会重建 JS  realm，前一页创建的 URL 记录会随之消失）。
  await gotoSpa(page, withProject("/agent"));
  // 等到目标页真正提交（旧页随之卸载并执行清理），再核对释放计数。
  await expect(page.getByRole("heading", { name: "智能 Agent", level: 1 })).toBeVisible();
  const afterLeave = await page.evaluate(() => window.__objectUrls);
  expect(afterLeave.revoked.length).toBeGreaterThanOrEqual(afterLeave.created.length);
  expect(afterLeave.created.length).toBeGreaterThanOrEqual(1);
});

test("备份与恢复未接入：路由不存在、页面零恢复请求、零可触发动作", async ({ page }) => {
  const recoveryCalls = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/(backup|recover|restore|recovery)/iu.test(path)) {
      recoveryCalls.push(`${request.method()} ${path}`);
    }
  });

  await loginOperator(page, "/ops/backup");
  await page.waitForTimeout(1_000);

  // 备份/恢复能力整项缺席：传输层没有对应路由（404），因此不存在可被调用的恢复入口。
  for (const path of ["/api/v1/backup", "/api/v1/backup/restore", "/api/v1/operations/recovery"]) {
    const response = await apiRequest(page, "POST", path, { schemaVersion: "1" });
    expect(response.status, `${path} 不得存在`).toBe(404);
  }

  // 上面的 404 探测与首次整页导航是测试自己发出的请求，不计入页面行为：
  // 清零后只观测页面在运维区内是否自发发出备份/恢复请求。
  recoveryCalls.length = 0;

  // 页面在整个运维区内不发任何备份/恢复请求，也没有可触发恢复的控件。
  for (const path of ["/ops/backup", "/ops/health", "/ops/model-versions"]) {
    await gotoSpa(page, path);
    await page.waitForTimeout(500);
  }
  expect(recoveryCalls).toEqual([]);
  expect(await page.getByRole("button", { name: /恢复|还原|回滚/u }).count()).toBe(0);
});
test("运维读取面按真实事实呈现：健康给出组件状态与缺席原因，模型版本只列已登记引用", async ({
  page,
}) => {
  await loginAdministrator(page, "/ops/health");

  const health = await apiRequest(page, "POST", "/api/v1/operations/queries", {
    schemaVersion: "1",
    queryId: "ip11-health-1",
    requestedAt: new Date().toISOString(),
    payload: { kind: "health" },
  });
  expect(health.status).toBe(200);
  expect(health.body.kind).toBe("succeeded");
  expect(health.body.result.kind).toBe("health");
  expect(typeof health.body.result.capturedAt).toBe("string");
  const components = Object.fromEntries(
    health.body.result.components.map((item) => [item.componentId, item]),
  );
  // 四个登记组件逐个有结论：本装配真实有窄探针的两个按可用呈现，
  // 没有窄探针与未接线的如实呈现未知与稳定原因码，不谎报可用。
  expect(Object.keys(components).sort()).toEqual([
    "api",
    "artifact-store",
    "model-gateway",
    "postgresql",
  ]);
  expect(components.postgresql.status).toBe("available");
  expect(components["artifact-store"].status).toBe("available");
  expect(components.api.status).toBe("unknown");
  expect(components.api.reasonCode).toBe("PROBE_NOT_CONFIGURED");
  expect(components["model-gateway"].status).toBe("unknown");
  expect(components["model-gateway"].reasonCode).toBe("MODEL_DEPLOYMENT_NOT_CONFIGURED");

  const versions = await apiRequest(page, "POST", "/api/v1/operations/queries", {
    schemaVersion: "1",
    queryId: "ip11-model-versions-1",
    requestedAt: new Date().toISOString(),
    payload: { kind: "model-versions" },
  });
  expect(versions.status).toBe(200);
  expect(versions.body.result.kind).toBe("model-versions");
  const items = versions.body.result.items;
  // 真实注册进 C08 注册表的四类任务定义逐项列出，引用全部取自已登记部署配置。
  expect(items.map((item) => item.taskType).sort()).toEqual(
    [...audit().modelVersionTaskTypes].sort(),
  );
  for (const item of items) {
    expect(item.modelVersionRef.entityId).toMatch(/^demo-model-/u);
    expect(item.modelVersionRef.versionId).toBe("1");
    expect(item.promptTemplateRef.versionId).toBe("1");
    expect(item.budgetPolicyRef.versionId).toBe("1");
    expect(item.supportedTriggerModes.length).toBeGreaterThan(0);
    // 服务地址、别名、权重路径与提示正文不在这一读面披露。
    expect(item.baseUrl).toBeUndefined();
    expect(item.modelAlias).toBeUndefined();
  }
});

test("六项系统管理动作在系统管理员会话里逐项真实执行并回到目录核对", async ({ page }) => {
  await loginAdministrator(page, "/ops/access");

  const stamp = `ip11-${Date.now().toString(36)}`;
  const loginName = `${stamp}-admin`;
  const projectId = `${stamp}-project`;
  const password = "Riskflow-Ip11-2030!";

  // 1) 创建账号：命令携带幂等键，成功回执给出真实账号引用。
  const created = await administrationCommand(page, `${stamp}-create`, {
    kind: "create-account",
    expectedVersion: "none",
    loginName,
    displayName: "IP-11 管理动作验收",
    password,
  });
  expect(created.status).toBe(200);
  expect(created.body.kind).toBe("succeeded");
  const accountId = created.body.result.resultRef.entityId;
  expect(typeof accountId).toBe("string");

  // 目录回读：新账号按登录名出现，状态正常且需改密。
  let accounts = await administrationQuery(page, { kind: "accounts", pageSize: 25 });
  let account = accounts.body.result.items.find((item) => item.loginName === loginName);
  expect(account, "创建后账号必须出现在系统目录里").toBeDefined();
  expect(account.accountRef.entityId).toBe(accountId);
  expect(account.status).toBe("active");
  expect(account.passwordChangeRequired).toBe(true);

  // 2) 重置口令：命令携带目录里的当前账号版本（创建后为 v1），成功且目录不回传任何派生口令。
  const reset = await administrationCommand(page, `${stamp}-reset`, {
    kind: "reset-password",
    expectedVersion: account.accountRef,
    accountId,
    password: "Riskflow-Ip11-Reset-2030!",
  });
  expect(reset.status).toBe(200);
  expect(reset.body.kind).toBe("succeeded");
  expect(JSON.stringify(accounts.body)).not.toContain("Riskflow");

  // 3) 停用账号：重置已推进安全版本，先从目录取回当前版本再提交；目录状态改写为已停用。
  accounts = await administrationQuery(page, { kind: "accounts", pageSize: 25 });
  const beforeDisable = accounts.body.result.items.find((item) => item.loginName === loginName);
  const disabled = await administrationCommand(page, `${stamp}-disable`, {
    kind: "disable-account",
    expectedVersion: beforeDisable.accountRef,
    accountId,
  });
  expect(disabled.status).toBe(200);
  expect(disabled.body.kind, JSON.stringify(disabled.body)).toBe("succeeded");
  accounts = await administrationQuery(page, { kind: "accounts", pageSize: 25 });
  account = accounts.body.result.items.find((item) => item.loginName === loginName);
  expect(account.status).toBe("disabled");

  // 4) 开通工程：初始风险负责人是目录里真实存在的工程管理员账号。
  accounts = await administrationQuery(page, { kind: "accounts", pageSize: 25 });
  const operatorAccount = accounts.body.result.items.find(
    (item) => item.loginName === server.operatorLogin,
  );
  expect(operatorAccount).toBeDefined();
  const opened = await administrationCommand(page, `${stamp}-open`, {
    kind: "open-project",
    expectedVersion: "none",
    projectId,
    initialRiskManagerAccountId: operatorAccount.accountRef.entityId,
  });
  expect(opened.status).toBe(200);
  expect(opened.body.kind, JSON.stringify(opened.body)).toBe("succeeded");
  const projects = await administrationQuery(page, { kind: "projects", pageSize: 25 });
  let project = projects.body.result.items.find((item) => item.projectId === projectId);
  expect(project, "开通后工程必须出现在系统目录里").toBeDefined();
  expect(project.status).toBe("active");

  // 5) 修订成员：按目录里的真实成员引用与当前版本修订角色集合。
  // 不能移除唯一风险负责人（领域不变量），因此本步做加法式角色修订并回读核对。
  const memberships = await administrationQuery(page, {
    kind: "memberships",
    projectId,
    pageSize: 25,
  });
  const membership = memberships.body.result.items.find(
    (item) => item.accountRef.entityId === operatorAccount.accountRef.entityId,
  );
  expect(membership, "新工程应有初始风险负责人成员").toBeDefined();
  expect(membership.status).toBe("active");
  const revised = await administrationCommand(page, `${stamp}-revise`, {
    kind: "revise-membership",
    expectedVersion: membership.membershipRef,
    projectId,
    membershipId: membership.membershipRef.entityId,
    accountId: operatorAccount.accountRef.entityId,
    roles: [...membership.roles, "reviewer"],
    spatialScopeRefs: membership.spatialScopeRefs,
    status: "active",
  });
  expect(revised.status).toBe(200);
  expect(revised.body.kind, JSON.stringify(revised.body)).toBe("succeeded");
  const afterRevise = await administrationQuery(page, {
    kind: "memberships",
    projectId,
    pageSize: 25,
  });
  const revisedItem = afterRevise.body.result.items.find(
    (item) => item.accountRef.entityId === operatorAccount.accountRef.entityId,
  );
  expect([...revisedItem.roles].sort()).toEqual(
    [...membership.roles, "reviewer"].sort(),
  );

  // 6) 暂停工程：携带目录披露的当前访问修订，目录状态改写为已暂停。
  const suspendPayload = {
    kind: "suspend-project",
    expectedVersion: project.accessRevisionRef,
    projectId,
  };
  const suspended = await administrationCommand(page, `${stamp}-suspend`, suspendPayload);
  expect(suspended.status).toBe(200);
  expect(suspended.body.kind, JSON.stringify(suspended.body)).toBe("succeeded");
  const afterSuspend = await administrationQuery(page, { kind: "projects", pageSize: 25 });
  project = afterSuspend.body.result.items.find((item) => item.projectId === projectId);
  expect(project.status).toBe("suspended");

  // 幂等：同一 commandId 重放不重复产生业务事实，回执版本不前进。
  const replay = await administrationCommand(page, `${stamp}-suspend`, suspendPayload);
  expect(replay.status).toBe(200);
  expect(replay.body.result.resultRef).toEqual(suspended.body.result.resultRef);
});

test("非系统管理员在系统管理面按无权与不存在同形收口", async ({ page }) => {
  await loginOperator(page, "/ops/access");

  // D-10：普通有效会话的 identity 读取成功返回 false，不披露任何系统对象；
  // 目录、写入与运维查询才按无权与不存在同形收口。
  const identity = await apiRequest(page, "GET", "/api/v1/administration");
  expect(identity.status).toBe(200);
  expect(identity.body.kind).toBe("succeeded");
  expect(identity.body.result.isSystemAdministrator).toBe(false);

  const accounts = await administrationQuery(page, { kind: "accounts", pageSize: 25 });
  expect(accounts.status).toBe(404);
  expect(accounts.body.code).toBe("NOT_FOUND");

  // 管理命令同样无权：不因会话有效就放行。
  const attempt = await administrationCommand(page, "ip11-unauthorized-command", {
    kind: "open-project",
    expectedVersion: "none",
    projectId: `ip11-unauthorized-${Date.now().toString(36)}`,
    initialRiskManagerAccountId: server.operatorAccountId,
  });
  expect(attempt.status).toBe(404);
  expect(attempt.body.code).toBe("NOT_FOUND");

  // 运维读取面同样只向系统管理员披露。
  const health = await apiRequest(page, "POST", "/api/v1/operations/queries", {
    schemaVersion: "1",
    queryId: "ip11-unauthorized-health",
    requestedAt: new Date().toISOString(),
    payload: { kind: "health" },
  });
  expect(health.status).toBe(404);
});