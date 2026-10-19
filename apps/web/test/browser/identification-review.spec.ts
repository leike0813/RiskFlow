/**
 * C33 识别 + 复核 demo 浏览器验收（IP-10）：识别运行列表/详情、风险记录列表/详情、
 * 关联图、复核队列、证据追溯、运行记录八页的真实浏览器验收——登录门禁、真实事实渲染、
 * 四态骨架、图/链失败闭合、证据抽屉脱敏两态、深链穿透、复核决定（通过/拒绝/批量）与
 * 重复提交幂等、过期禁决定、viewer/responder 降级。
 * 服务由 server.mjs 以真实 PostgreSQL/迁移/会话/工件接缝启动；任何一步失败都计为失败。
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

const withProject = (path) => `${path}?project=${server.projectId}`;

/**
 * SPA 内跳转：demo 会话只保存在 React 状态（无服务端会话恢复引导），整页刷新即回登录页，
 * 登录后不得再用 page.goto；pushState + popstate 事件驱动 React Router 换路由。
 */
const gotoSpa = async (page, path) => {
  await page.evaluate((url) => {
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
};

const ids = () => server.identification;

test("识别域页面未登录跳转登录页，登录后回到原目标页", async ({ page }) => {
  await login(page, server.operatorLogin, withProject("/identification"));
  await expect(page.getByRole("heading", { name: "识别任务", level: 1 })).toBeVisible();
});

test("识别运行列表呈现真实运行事实，行点击进入详情", async ({ page }) => {
  await login(page, server.operatorLogin, withProject("/identification"));
  await expect(page.getByText("识别运行列表")).toBeVisible();
  // 三条播种运行：完成 / 等待复核 / 可重试失败，触发原因缺省如实呈现「—」。
  await expect(page.getByText(ids().completedRunId)).toBeVisible();
  await expect(page.getByText(ids().waitingRunId)).toBeVisible();
  await expect(page.getByText(ids().failedRunId)).toBeVisible();
  await expect(page.getByText("已完成", { exact: true })).toBeVisible();
  await expect(page.getByText("等待复核", { exact: true })).toBeVisible();
  await expect(page.getByText("可重试失败", { exact: true })).toBeVisible();
  await expect(page.getByText("I9 · 结果汇总")).toBeVisible();
  await expect(page.getByText("I5 · 结构修复与校验")).toBeVisible();
  await expect(page.getByText("I3 · 检索与 Agent 审阅")).toBeVisible();
  await expect(page.getByText("2 / 0 / 1")).toBeVisible();
  await expect(page.getByText("0 / 1 / 0")).toBeVisible();

  await page.getByText(ids().completedRunId).click();
  await page.waitForURL(new RegExp(`/identification/runs/`));
  await expect(page.getByRole("heading", { name: "识别运行详情", level: 1 })).toBeVisible();
});

test("完成态运行详情呈现阶段、覆盖、合并组与结果汇总，并深链到风险记录", async ({ page }) => {
  await login(
    page,
    server.operatorLogin,
    withProject(`/identification/runs/${encodeURIComponent(ids().completedRunId)}`),
  );
  await expect(page.getByText("识别运行阶段（I0–I9）")).toBeVisible();
  await expect(page.getByText("工序工作项覆盖")).toBeVisible();
  await expect(page.getByText("PN-EXPAND-02").first()).toBeVisible();
  // 合并组与验收路由：自动验收 + 人工复核验收 + 拒收。
  await expect(page.getByText("合并组与验收路由")).toBeVisible();
  await expect(page.getByText("自动验收", { exact: true })).toBeVisible();
  await expect(page.getByText("人工复核验收", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("已拒收", { exact: true })).toBeVisible();
  // 关联任务与复核队列入口。
  await expect(page.getByText("关联 Agent 与复核任务")).toBeVisible();
  await expect(page.getByText("retrieval-review").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "前往复核队列" })).toBeVisible();
  // 结果汇总：验收 2 · 待复核 0 · 拒收 1，验收记录可深链。
  await expect(page.getByText(/验收 2 · 待复核 0 · 拒收 1/)).toBeVisible();
  await page.getByRole("link", { name: ids().recordAutoId }).click();
  await page.waitForURL(new RegExp(`/identification/records/`));
  await expect(page.getByRole("heading", { name: "风险记录详情", level: 1 })).toBeVisible();
});

test("等待与失败运行详情如实呈现暂停与可重试失败", async ({ page }) => {
  await login(
    page,
    server.operatorLogin,
    withProject(`/identification/runs/${encodeURIComponent(ids().waitingRunId)}`),
  );
  await expect(page.getByText("当前等待")).toBeVisible();
  await expect(page.getByText("运行暂停，等待人工复核")).toBeVisible();
  await expect(page.getByText(ids().pendingTask.reference.entityId).first()).toBeVisible();
  await expect(page.getByText("前往复核队列")).toBeVisible();

  await gotoSpa(page, withProject(`/identification/runs/${encodeURIComponent(ids().failedRunId)}`));
  await expect(
    page.getByText(/阶段\s*I3\s*失败，错误码\s*RETRYABLE_INFRASTRUCTURE_FAILURE，可重试/),
  ).toBeVisible();
});

test("风险记录列表支持工序节点与验收方式筛选，行点击进入详情", async ({ page }) => {
  await login(page, server.operatorLogin, withProject("/identification/records"));
  await expect(page.getByText(ids().recordAutoId)).toBeVisible();
  await expect(page.getByText(ids().recordReviewId)).toHaveCount(0);
  await expect(page.getByText("0.80")).toBeVisible();
  await expect(page.getByText("0.50")).toHaveCount(0);
  await expect(page.getByText("现行", { exact: true }).first()).toBeVisible();

  await page.getByLabel("按工序节点筛选").fill("PN-EXPAND-03");
  await expect(page.getByText(ids().recordReviewId)).toHaveCount(0);
  await expect(page.getByText(ids().recordAutoId)).toHaveCount(0);

  await page.getByLabel("按工序节点筛选").fill("");
  await page.getByLabel("按验收方式筛选").selectOption("automatic");
  await expect(page.getByText(ids().recordAutoId)).toBeVisible();
  await expect(page.getByText(ids().recordReviewId)).toHaveCount(0);

  await page.getByLabel("按验收方式筛选").selectOption("review");
  await expect(page.getByText(ids().recordAutoId)).toHaveCount(0);
  await expect(page.getByText(ids().recordReviewId)).toHaveCount(0);
  await page.getByLabel("按验收方式筛选").selectOption("");
  await page.getByText(ids().recordAutoId).click();
  await page.waitForURL(
    new RegExp(`/identification/records/${encodeURIComponent(ids().recordAutoId)}`),
  );
  await expect(page.getByText("标准化风险记录", { exact: true })).toBeVisible();
});

test("风险记录详情呈现契约字段与真实定位，受限来源记录失败关闭", async ({ page }) => {
  await login(
    page,
    server.operatorLogin,
    withProject(`/identification/records/${encodeURIComponent(ids().recordAutoId)}`),
  );
  // 记录七字段与信封事实。
  await expect(page.getByText("工序节点标识")).toBeVisible();
  await expect(page.getByText("PN-EXPAND-02").first()).toBeVisible();
  await expect(page.getByText("过挖导致地表沉降超限")).toBeVisible();
  await expect(page.getByText("土仓压力不足")).toBeVisible();
  await expect(page.getByText("MEC-VDS-017").first()).toBeVisible();
  await expect(page.getByText("综合置信度", { exact: true })).toBeVisible();
  await expect(page.getByText("自动路由决定")).toBeVisible();
  await expect(page.getByRole("link", { name: ids().completedRunId })).toBeVisible();
  await expect(page.getByRole("link", { name: "查看端到端追溯链" })).toBeVisible();

  // 共享资料 A 段：真实 evidence-access 定位（章节路径 + 资料版本 + 资料详情深链）。
  await page
    .getByRole("button", {
      name: new RegExp(`${server.sourceAVersionEntityId}-chapter_1-segment_1`),
    })
    .first()
    .click();
  await expect(page.locator(".evidence-drawer-title")).toBeVisible();
  await expect(page.locator(".evidence-drawer").getByText("验收章节")).toBeVisible();
  await expect(
    page.locator(".evidence-drawer").getByText(`${server.sourceAVersionEntityId} · 1`),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "打开资料详情并定位该段" })).toBeVisible();
  await page.getByRole("button", { name: "关闭证据抽屉" }).click();

  // B 资料没有当前授权，派生记录正文与证据按钮也不得披露。
  const catalogRead = page.waitForResponse((response) =>
    response.url().endsWith("/queries/risk-identification.record-catalog"),
  );
  await gotoSpa(
    page,
    withProject(`/identification/records/${encodeURIComponent(ids().recordReviewId)}`),
  );
  const catalog = await (await catalogRead).json();
  expect(
    catalog.result.items.some(
      (item) => item.riskRecordRef.reference.entityId === ids().recordReviewId,
    ),
  ).toBe(false);
  const denied = await page.evaluate(
    async ({ projectId, recordId }) => {
      const response = await fetch(
        `/api/v1/projects/${encodeURIComponent(projectId)}/queries/risk-identification.record-read`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: "1",
            queryId: `browser-denied-record-${Date.now()}`,
            requestedAt: new Date().toISOString(),
            requestedSpatialScopeRefs: [],
            requestedSourceVersionRefs: [],
            payload: {
              riskRecordRef: {
                kind: "standardized-risk-record",
                reference: { entityId: recordId, versionId: "1" },
              },
            },
          }),
        },
      );
      return { status: response.status, body: await response.json() };
    },
    { projectId: server.projectId, recordId: ids().recordReviewId },
  );
  expect(denied.status).toBe(404);
  expect(denied.body.code).toBe("NOT_FOUND");
  await expect(page.getByText("刀盘扩径卡顿导致围岩扰动")).toHaveCount(0);
  await expect(
    page
      .getByRole("button", {
        name: new RegExp(`${server.sourceBVersionEntityId}-chapter_1-segment_1`),
      })
      .first(),
  ).toHaveCount(0);
});

test("关联图无主体时呈现引导与按工序分组降级视图；带主体时呈现可证明关联边", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page, server.operatorLogin, withProject("/identification/graph"));
  await expect(page.getByText(/在下方「按工序分组的风险记录」中选择一条记录/)).toBeVisible();
  // 降级视图只呈现当前可见记录，受限 B 不进入分组。
  await expect(page.getByText("按工序分组的风险记录").first()).toBeVisible();
  await expect(page.getByText("过挖导致地表沉降超限")).toBeVisible();
  await expect(page.getByText("刀盘扩径卡顿导致围岩扰动")).toHaveCount(0);

  await page.getByRole("button", { name: "过挖导致地表沉降超限" }).click();
  await page.waitForURL(new RegExp(`/identification/graph\\?.*subject=`));
  // 投影复验正向闭合：主体提示与可证明关联边的节点列表真实呈现。
  const graphHint = page.locator(".graph-hint", { hasText: "的可证明关联边" });
  await expect(graphHint).toBeVisible();
  await expect(graphHint.locator(".mono")).toHaveText(ids().recordAutoId);
  const nodeLinks = page.locator(".graph-node-links");
  await expect(nodeLinks).toContainText(`risk-assessment-record:${ids().completedRunId}:1`);
  await expect(nodeLinks).toContainText(`calibration-suggestion:${ids().completedRunId}:1`);
  const canvas = page.locator(".page canvas").first();
  await expect(canvas).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const expectStableGraph = async () => {
    const rendered = await canvas.evaluate(async (element) => {
      const context = element.getContext("2d");
      const pixels = context.getImageData(0, 0, element.width, element.height).data;
      // Read the real Canvas fill, not the legend or a forwarded option.
      const swatch = document.createElement("canvas").getContext("2d");
      swatch.fillStyle = getComputedStyle(document.documentElement)
        .getPropertyValue("--bluegray-soft")
        .trim();
      swatch.fillRect(0, 0, 1, 1);
      const expected = swatch.getImageData(0, 0, 1, 1).data;
      let themedPixels = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (
          pixels[i] === expected[0] &&
          pixels[i + 1] === expected[1] &&
          pixels[i + 2] === expected[2] &&
          pixels[i + 3] === 255
        )
          themedPixels += 1;
      }
      const initial = element.toDataURL();
      for (let frame = 0; frame < 24; frame += 1) {
        const { promise, resolve } = Promise.withResolvers();
        requestAnimationFrame(resolve);
        await promise;
        if (element.toDataURL() !== initial) return { stable: false, themedPixels };
      }
      return { stable: true, themedPixels };
    });
    expect(rendered.themedPixels).toBeGreaterThan(50);
    expect(rendered.stable).toBe(true);
  };
  await expectStableGraph();
  // Switching both ways must replace the renderer, then retain a usable, stable graph.
  const reducedCanvas = await canvas.elementHandle();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(() => reducedCanvas.evaluate((element) => element.isConnected)).toBe(false);
  await expect(canvas).toBeVisible();
  const animatedCanvas = await canvas.elementHandle();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => animatedCanvas.evaluate((element) => element.isConnected)).toBe(false);
  await expect(canvas).toBeVisible();
  await expectStableGraph();
  // 降级视图不受投影结果影响，仍基于目录事实呈现。
  await expect(page.getByText("按工序分组的风险记录").first()).toBeVisible();
  await nodeLinks.getByRole("link", { name: ids().recordAutoId, exact: true }).click();
  await expect(page).toHaveURL(
    (url) => decodeURIComponent(url.pathname) === `/identification/records/${ids().recordAutoId}`,
  );
});

test("复核队列呈现真实任务、过期禁决定与筛选空态", async ({ page }) => {
  await login(page, server.operatorLogin, withProject("/review"));
  await expect(page.getByText("复核任务", { exact: true })).toBeVisible();
  await expect(page.getByText(ids().pendingTask.reference.entityId)).toBeVisible();
  await expect(page.getByText("识别候选复核").first()).toBeVisible();
  // 触发原因缺省呈现「—」，不伪造。
  await expect(page.getByText("—").first()).toBeVisible();

  // 过期任务：按钮禁用并提示目标版本已被取代。
  const staleRow = page.locator("tr", { hasText: ids().staleTask.reference.entityId });
  await expect(staleRow.getByText("已过期")).toBeVisible();
  await expect(staleRow.getByRole("button", { name: "通过" })).toBeDisabled();
  await expect(staleRow.getByRole("button", { name: "拒绝" })).toBeDisabled();
  await expect(staleRow.getByText("目标版本已被取代，请重新领取")).toBeVisible();

  // 类型筛选空态：校准建议复核无任务。
  await page.getByRole("button", { name: "校准建议复核" }).click();
  await expect(page.getByText("当前筛选下暂无复核任务")).toBeVisible();
});

test("复核决定：通过、拒绝、批量通过与重复提交幂等", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, server.operatorLogin, withProject("/review"));
  await expect(page.getByText(ids().pendingTask.reference.entityId)).toBeVisible();

  // 通过：确认对话框呈现工程/对象/精确版本/预计结果/副作用。
  // 同时拦截并原样留存命令信封，供下方同幂等键重放（逐字节一致才构成服务端重放）。
  let approveRequestBody = "";
  await page.route("**/commands/review-audit.decide-review", async (route) => {
    approveRequestBody = route.request().postData() ?? "";
    await route.continue();
  });
  const pendingRow = page.locator("tr", { hasText: ids().pendingTask.reference.entityId });
  await pendingRow.getByRole("button", { name: "通过" }).click();
  await expect(page.locator(".confirm-dialog")).toBeVisible();
  await expect(
    page.locator(".confirm-dialog").getByText(`工程：${server.projectId}`),
  ).toBeVisible();
  await expect(page.locator(".confirm-dialog").getByText(/预计结果：按原样通过/)).toBeVisible();
  await expect(page.locator(".confirm-dialog").getByText(/副作用：决定写入审计日志/)).toBeVisible();
  await page.locator(".confirm-dialog").getByRole("button", { name: "确认通过" }).click();
  const approveOutcome = page.locator(".rq-outcomes li", {
    hasText: ids().pendingTask.reference.entityId,
  });
  await expect(approveOutcome.getByText(/已登记（决定 /)).toBeVisible();
  const outcomeText = (await approveOutcome.textContent()) ?? "";
  const decisionRefId = /决定 ([^）]+)）/.exec(outcomeText)?.[1];
  expect(decisionRefId).toBeTruthy();
  // 「查看等待运行」深链穿透到等待运行详情。
  await approveOutcome.getByRole("link", { name: "查看等待运行" }).click();
  await page.waitForURL(
    new RegExp(`/identification/runs/${encodeURIComponent(ids().waitingRunId)}`),
  );
  await expect(page.getByText("运行暂停，等待人工复核")).toBeVisible();
  await page.goBack();
  await expect(page.getByText("复核任务", { exact: true })).toBeVisible();
  await page.unroute("**/commands/review-audit.decide-review");
  expect(approveRequestBody.length).toBeGreaterThan(0);

  // 重复提交同一幂等键（逐字节同一信封）：服务端重放同一决定，不产生新业务事实。
  const replay = await page.evaluate(
    async ({ projectId, body }) => {
      const response = await fetch(
        `/api/v1/projects/${encodeURIComponent(projectId)}/commands/review-audit.decide-review`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        },
      );
      return { status: response.status, body: await response.json() };
    },
    { projectId: server.projectId, body: approveRequestBody },
  );
  expect(replay.status).toBe(200);
  expect(replay.body.result.reviewDecisionRef.reference.entityId).toBe(decisionRefId);

  // 拒绝：freshTask（stale 系列的现行版本）。
  const freshRow = page.locator("tr", { hasText: ids().freshTask.reference.entityId });
  await freshRow.getByRole("button", { name: "拒绝" }).click();
  await page.locator(".confirm-dialog").getByRole("button", { name: "确认拒绝" }).click();
  await expect(
    page
      .locator(".rq-outcomes li", { hasText: ids().freshTask.reference.entityId })
      .getByText(/已登记（决定 /),
  ).toBeVisible();

  // 批量通过：勾选两个可决定任务，逐项原样通过。
  for (const task of ids().batchTasks) {
    await page.getByLabel(`选择 ${task.reference.entityId}`).check();
  }
  await page.getByRole("button", { name: "批量通过" }).click();
  await expect(page.locator(".confirm-dialog").getByText(/对象：2 项/)).toBeVisible();
  await page.locator(".confirm-dialog").getByRole("button", { name: "确认批量通过" }).click();
  for (const task of ids().batchTasks) {
    await expect(
      page
        .locator(".rq-outcomes li", { hasText: task.reference.entityId })
        .getByText(/已登记（决定 /),
    ).toBeVisible();
  }
  // 已决定任务不再呈现操作按钮；队列如实刷新为已决定。
  for (const task of ids().batchTasks) {
    const row = page.locator("tr", { hasText: task.reference.entityId });
    await expect(row.getByText("已决定")).toBeVisible();
    await expect(row.getByRole("button", { name: "通过" })).toHaveCount(0);
  }
});

test("viewer 可读复核队列但决定失败闭合", async ({ page }) => {
  await login(page, server.viewerLogin, withProject("/review"));
  await expect(page.getByText(ids().viewerTask.reference.entityId)).toBeVisible();
  const row = page.locator("tr", { hasText: ids().viewerTask.reference.entityId });
  await row.getByRole("button", { name: "通过" }).click();
  await page.locator(".confirm-dialog").getByRole("button", { name: "确认通过" }).click();
  // 无 decide-review 分支：服务端失败闭合（无权与不存在同形），就地呈现错误码。
  await expect(page.locator(".confirm-dialog").getByText(/提交失败（NOT_FOUND）/)).toBeVisible();
  await page.locator(".confirm-dialog").getByRole("button", { name: "取消" }).click();
  await expect(
    page
      .locator(".rq-outcomes li", { hasText: ids().viewerTask.reference.entityId })
      .getByText(/失败（NOT_FOUND）/),
  ).toBeVisible();
});

test("responder 无复核队列读取权限，但识别运行列表可读（降级按分支粒度）", async ({ page }) => {
  await login(page, server.responderLogin, withProject("/review"));
  await expect(page.getByText("当前角色不具备复核队列的读取权限")).toBeVisible();
  // responder 仍具备识别只读分支：识别运行列表正常呈现。
  await gotoSpa(page, withProject("/identification"));
  await expect(page.getByText(ids().completedRunId)).toBeVisible();
});

test("证据追溯页：无主体引导；带主体时呈现端到端固定追溯链", async ({ page }) => {
  await login(page, server.operatorLogin, withProject("/review/trace"));
  await expect(page.getByText(/未指定追溯主体/)).toBeVisible();

  await gotoSpa(
    page,
    `${withProject("/review/trace")}&subject=${encodeURIComponent(ids().recordAutoId)}`,
  );
  // trace-chain 投影正向闭合（D7）：1–5 号节点（资料段→工序→机理→记录→评估记录）呈现
  // 真实引用；trace-chain 归档语义只返回主体相邻边，6–8 号节点按投影缺席事实如实呈现。
  const intro = page.locator(".et-intro", { hasText: "为主体串联固定追溯链" });
  await expect(intro).toBeVisible();
  await expect(intro.locator(".mono")).toHaveText(ids().recordAutoId);
  await expect(
    page.locator(".et-node", { hasText: "资料段标识" }).locator(".evidence-link-id"),
  ).toContainText("chapter_1-segment_1");
  await expect(page.locator(".et-node", { hasText: "工序节点" })).toContainText("PN-EXPAND-02");
  await expect(page.locator(".et-node", { hasText: "风险机理条目" })).toContainText("MEC-VDS-017");
  const recordNode = page.locator(".et-node", { hasText: "标准化风险记录" });
  await expect(recordNode).toContainText(ids().recordAutoId);
  await expect(recordNode).toContainText("过挖导致地表沉降超限");
  await expect(page.locator(".et-node", { hasText: "风险评估记录" })).toContainText(
    `risk-assessment-record:${ids().completedRunId}:1`,
  );
  for (const kind of ["预警信息", "处置建议", "偏差/校准"]) {
    await expect(page.locator(".et-node--absent", { hasText: kind })).toHaveCount(1);
  }
  await expect(page.getByText("投影暂无该环节事实")).toHaveCount(3);
});

test("运行记录页：识别运行组与评估处置链运行组均呈现真实运行", async ({ page }) => {
  await login(page, server.operatorLogin, withProject("/review/runs"));
  await expect(page.getByText("识别运行", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: ids().completedRunId })).toBeVisible();
  await expect(page.getByRole("link", { name: ids().waitingRunId })).toBeVisible();
  // risk-overview 投影正向闭合：链运行组呈现所播种运行的 run-summary 行。
  await expect(page.getByText("评估与处置链运行").first()).toBeVisible();
  const chainRow = page.locator("tr", { hasText: ids().chainRunId });
  await expect(chainRow).toBeVisible();
  await expect(chainRow.getByText("已完成", { exact: true })).toBeVisible();
  await expect(chainRow.getByText(ids().completedRunId)).toBeVisible();
});

test("四态骨架：loading 与 error（重试恢复）在真实接缝下可观察", async ({ page }) => {
  await login(page, server.operatorLogin, withProject("/identification"));
  await expect(page.getByText(ids().completedRunId)).toBeVisible();

  // loading：延迟 run-list 应答，骨架可见且数据随后真实到达。
  await page.route("**/queries/risk-identification.run-list", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await gotoSpa(page, withProject("/identification/records"));
  await expect(page.getByText(ids().recordAutoId)).toBeVisible();
  await gotoSpa(page, withProject("/identification"));
  await expect(page.locator('[data-page-state="loading"]')).toBeVisible();
  await expect(page.getByText(ids().completedRunId)).toBeVisible();
  await page.unroute("**/queries/risk-identification.run-list");

  // error：中止查询 → 结构化错误码 + 重试；解除后重试恢复真实数据。
  await page.route("**/queries/risk-identification.run-list", (route) => route.abort());
  await gotoSpa(page, withProject("/identification/records"));
  await gotoSpa(page, withProject("/identification"));
  await expect(page.getByText("内容加载失败（TRANSIENT_FAILURE）")).toBeVisible();
  await page.unroute("**/queries/risk-identification.run-list");
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByText(ids().completedRunId)).toBeVisible();
});
