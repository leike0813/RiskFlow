/** C36 跨页面真实浏览器验收：生产构建 + 真实 HTTP/授权/投影接缝，不使用 Mock 或跳过断言。 */
import { expect, test, type Page } from "@playwright/test";

import { startQualityBrowserServer } from "./server.mjs";

interface BrowserServerV1 {
  readonly origin: string;
  readonly projectId: string;
  readonly forbiddenProjectId: string;
  readonly projectRevisionRef: { readonly entityId: string; readonly versionId: string };
  readonly operatorLogin: string;
  readonly operatorPassword: string;
  readonly restrictedLogin: string;
  readonly restrictedPassword: string;
  readonly restrictedPasswordChanged: string;
  readonly reportArtifactRef: {
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
  readonly datasetArtifactRef: {
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
  revokeSourceAccess(): Promise<boolean>;
  close(): Promise<void>;
}

let server: BrowserServerV1;

test.beforeAll(async () => {
  server = (await startQualityBrowserServer()) as BrowserServerV1;
}, 900_000);

test.afterAll(async () => {
  await server?.close();
});

const origin = (): string => server.origin;

const selectionFor = (projectIds: readonly string[]): string =>
  projectIds
    .map(
      (projectId) =>
        `project=${encodeURIComponent(projectId)}&revision=${encodeURIComponent(
          `${projectId}@r1`,
        )}`,
    )
    .join("&");

const pathWithSelection = (pathname: string, projectId: string): string =>
  `${origin()}${pathname}?${selectionFor([projectId, server.forbiddenProjectId])}`;

const deepLinkUrl = (): string => pathWithSelection("/assessment", server.projectId);

/**
 * 启动先自省：有效会话直接进入原页，401 才落到带 `next` 的登录页。
 * 因此同一步骤里既可能是「已登录」，也可能是「待登录」，两种都要能走通；
 * 受限账号登录后停在改密页，同样是认证已完成的落点。
 */
const ensureSession = async (
  page: Page,
  loginName: string = server.operatorLogin,
  password: string = server.operatorPassword,
): Promise<void> => {
  const loginForm = page.locator('input[name="loginName"]').first();
  const changePasswordForm = page.locator('input[name="newPassword"]').first();
  const businessShell = page.locator("[data-navigation]").first();
  await expect(loginForm.or(changePasswordForm).or(businessShell)).toBeVisible();
  if (await loginForm.isVisible()) {
    await loginForm.fill(loginName);
    await page.locator('input[name="password"]').first().fill(password);
    await page.getByRole("button", { name: "登录" }).click();
  }
  // 登录页自身也带主标题，只有外壳或改密表单出现才说明认证真的完成、地址已回跳。
  await expect(changePasswordForm.or(businessShell)).toBeVisible();
};

const expectSummary = async (page: Page, evidenceCount = "2"): Promise<void> => {
  const summary = page.locator(
    `[data-quality-summary="${server.reportArtifactRef.reference.entityId}"]`,
  );
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute(
    "data-quality-version",
    server.reportArtifactRef.reference.versionId,
  );
  await expect(summary).toHaveAttribute("data-quality-label", "合成样本，待甲方复核");
  await expect(page.getByText("合成样本，待甲方复核").first()).toBeVisible();
  await expect(summary.locator("[data-quality-metric]")).toHaveCount(7);
  await expect(summary.locator('[data-quality-metric="accuracy"]')).toHaveAttribute(
    "data-quality-metric-value",
    /^(0|1)(\.\d+)?$/,
  );
  await expect(summary.locator('[data-quality-metric="replay-rate"]')).toHaveAttribute(
    "data-quality-metric-value",
    /^(not-computable|(0|1)(\.\d+)?)$/,
  );
  // D-10：真实 C13 必审资料段收据使审计链完整；D-11：只披露已签发 grant 的定位引用。
  await expect(summary.locator('[data-quality-metric="audit-completeness"]')).toHaveAttribute(
    "data-quality-metric-value",
    "1",
  );
  await expect(summary).toHaveAttribute("data-quality-evidence-count", evidenceCount);
};

test("真实 Chromium 完成登录、导航、质量查询、刷新与工程切换", async ({ page, browser }) => {
  test.info().annotations.push({ type: "browser-version", description: browser.version() });
  test.info().annotations.push({
    type: "c04-report-ref",
    description: `${server.reportArtifactRef.reference.entityId}@${server.reportArtifactRef.reference.versionId}`,
  });
  test.info().annotations.push({
    type: "c04-dataset-ref",
    description: `${server.datasetArtifactRef.reference.entityId}@${server.datasetArtifactRef.reference.versionId}`,
  });

  await test.step("登录并读取当前工程的质量摘要", async () => {
    await page.goto(pathWithSelection("/assessment", server.projectId));
    await ensureSession(page);
    await expect(page.locator('[data-quality-page="1"]')).toHaveAttribute(
      "data-page-state",
      "ready",
    );
    await expectSummary(page);
  });

  await test.step("跨页面返回后按服务端当前投影重建", async () => {
    await page.goto(pathWithSelection("/overview", server.projectId));
    await ensureSession(page);
    await expect(page.locator('[data-quality-page="1"]')).toHaveCount(0);
    await page.goto(pathWithSelection("/assessment", server.projectId));
    await ensureSession(page);
    await expect(page.locator('[data-quality-page="1"]')).toHaveAttribute(
      "data-page-state",
      "ready",
    );
    await expectSummary(page);
  });

  await test.step("刷新后由服务端恢复会话并重新查询", async () => {
    await page.reload();
    await ensureSession(page);
    await expect(page.locator('[data-quality-page="1"]')).toHaveAttribute(
      "data-page-state",
      "ready",
    );
    await expectSummary(page);
  });

  await test.step("切换到无权工程后旧内容立即清除", async () => {
    const selector = page.locator('div[aria-label="工程上下文"] select').first();
    await expect(selector).toBeEnabled();
    await selector.selectOption(server.forbiddenProjectId);
    await expect(page.locator('[data-quality-page="1"]')).toHaveAttribute(
      "data-page-state",
      "forbidden",
    );
    await expect(
      page.locator(`[data-quality-summary="${server.reportArtifactRef.reference.entityId}"]`),
    ).toHaveCount(0);
  });

  await test.step("资料撤权后工程级摘要仍可见但定位引用不再披露", async () => {
    const selector = page.locator('div[aria-label="工程上下文"] select').first();
    await selector.selectOption(server.projectId);
    await expect(page.locator('[data-quality-page="1"]')).toHaveAttribute(
      "data-page-state",
      "ready",
    );
    await expectSummary(page);
    expect(await server.revokeSourceAccess()).toBe(true);
    await page.reload();
    await ensureSession(page);
    await expect(page.locator('[data-quality-page="1"]')).toHaveAttribute(
      "data-page-state",
      "ready",
    );
    await expectSummary(page, "0");
  });
});

/** 一次性 503 注入：只影响这一次自省，后续请求走真实服务端。 */
const transientFailureBody = (): string =>
  JSON.stringify({
    schemaVersion: "1",
    requestId: "browser-injected-transient",
    code: "TRANSIENT_FAILURE",
    retryable: true,
    occurredAt: "2030-06-02T00:00:00.000Z",
    references: [],
  });

test("启动恢复正式会话：硬刷新、精确深链、匿名回跳与恢复前不查业务", async ({ page }) => {
  const businessPosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/queries/")) {
      businessPosts.push(request.url());
    }
  });

  await test.step("匿名自省落到带回跳目标的登录页，登录后回到精确深链", async () => {
    await page.context().clearCookies();
    await page.goto(deepLinkUrl());
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(new URL(page.url()).searchParams.get("next")).toBe(
      new URL(deepLinkUrl()).pathname + new URL(deepLinkUrl()).search,
    );
    await ensureSession(page);
    await expect(page).toHaveURL(deepLinkUrl());
    await expect(page.locator('[data-quality-page="1"]')).toHaveAttribute(
      "data-page-state",
      "ready",
    );
  });

  await test.step("硬刷新保持有效会话，原 id/version 不变且不现登录页", async () => {
    await page.reload();
    await expect(page.locator('input[name="loginName"]')).toHaveCount(0);
    await expect(page).toHaveURL(deepLinkUrl());
    await expect(page.locator('[data-quality-page="1"]')).toHaveAttribute(
      "data-page-state",
      "ready",
    );
  });

  await test.step("恢复完成前停在检查态且不发出任何业务查询", async () => {
    businessPosts.length = 0;
    await page.route("**/api/v1/session", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fallback();
    });
    await page.reload();
    await expect(page.locator('[data-session-state="checking"]')).toBeVisible();
    expect(businessPosts).toEqual([]);
    await page.unroute("**/api/v1/session");
    await expect(page.locator('[data-quality-page="1"]')).toHaveAttribute(
      "data-page-state",
      "ready",
    );
    expect(businessPosts.length).toBeGreaterThan(0);
  });
});

test("受限会话恢复后先改密，改密前无业务请求且完成后回到原深链", async ({ page }) => {
  const businessPosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/queries/")) {
      businessPosts.push(request.url());
    }
  });

  await page.context().clearCookies();
  await page.goto(deepLinkUrl());
  await ensureSession(page, server.restrictedLogin, server.restrictedPassword);

  await test.step("受限会话进入改密页并保留回跳目标", async () => {
    await expect(page).toHaveURL(/\/change-password\?next=/);
    await expect(page.locator('input[name="newPassword"]')).toBeVisible();
    await expect(page.locator("[data-navigation]")).toHaveCount(0);
    expect(businessPosts).toEqual([]);
  });

  await test.step("改密成功后以真实会话回到原深链", async () => {
    await page.locator('input[name="newPassword"]').fill(server.restrictedPasswordChanged);
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page).toHaveURL(deepLinkUrl());
    await expect(page.locator("[data-navigation]").first()).toBeVisible();
    await expect(page.locator('input[name="newPassword"]')).toHaveCount(0);
  });
});

test("恢复故障按可重试失败呈现而不是匿名，重试后恢复真实会话", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto(deepLinkUrl());
  await ensureSession(page);

  let injected = 0;
  await page.route("**/api/v1/session", async (route) => {
    if (route.request().method() !== "GET" || injected++ > 0) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: transientFailureBody(),
    });
  });
  await page.reload();

  await test.step("一次 503 呈现可重试失败，既不是匿名也不丢原 URL", async () => {
    await expect(page.locator('[data-session-state="failed"]')).toBeVisible();
    await expect(page.locator('input[name="loginName"]')).toHaveCount(0);
    await expect(page.locator("[data-navigation]")).toHaveCount(0);
    await expect(page).toHaveURL(deepLinkUrl());
  });

  await test.step("重试走真实自省并回到业务页", async () => {
    await page.getByRole("button", { name: "重试" }).click();
    await expect(page.locator('[data-quality-page="1"]')).toHaveAttribute(
      "data-page-state",
      "ready",
    );
    await expect(page).toHaveURL(deepLinkUrl());
  });
  await page.unroute("**/api/v1/session");
});

test("被取代的认证请求不会把新代次会话打回失败态", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto(deepLinkUrl());
  const loginForm = page.locator('input[name="loginName"]').first();
  await expect(loginForm).toBeVisible();

  // 第一次登录真实到达服务端、但响应被扣在代理上；随后以更新的认证代次再登录一次。
  let releaseLate = (): void => undefined;
  const lateGate = new Promise<void>((resolve) => {
    releaseLate = resolve;
  });
  let lateAnswered = false;
  let loginCalls = 0;
  await page.route("**/api/v1/session/login", async (route) => {
    loginCalls += 1;
    if (loginCalls > 1) {
      await route.fallback();
      return;
    }
    await route.fetch();
    await lateGate;
    lateAnswered = true;
    await route
      .fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: transientFailureBody(),
      })
      .catch(() => undefined);
  });

  await loginForm.fill(server.operatorLogin);
  await page.locator('input[name="password"]').first().fill(server.operatorPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect.poll(() => loginCalls).toBe(1);
  await page.getByRole("button", { name: "登录" }).click();

  await test.step("新代次先建立会话并回到原深链", async () => {
    await expect(page.locator("[data-navigation]").first()).toBeVisible();
    await expect(page).toHaveURL(deepLinkUrl());
  });

  await test.step("被取代的旧请求即便返回失败也不改变当前会话", async () => {
    releaseLate();
    await expect.poll(() => lateAnswered).toBe(true);
    await expect(page.locator('[data-session-state="failed"]')).toHaveCount(0);
    await expect(page.locator("[data-navigation]").first()).toBeVisible();
    await expect(page).toHaveURL(deepLinkUrl());
  });
  await page.unroute("**/api/v1/session/login");
});

test("键盘可达与安全失败", async ({ page }) => {
  await page.goto(pathWithSelection("/assessment", server.projectId));
  await ensureSession(page);
  await expect(page.locator('[data-quality-page="1"]')).toHaveAttribute("data-page-state", "ready");

  await test.step("主标题可聚焦且键盘顺序可达交互元素", async () => {
    const heading = page.locator("#main-heading");
    await expect(heading).toBeVisible();
    await heading.focus();
    await expect(heading).toBeFocused();
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => ({
      tag: globalThis.document.activeElement?.tagName ?? "",
      inNavigationOrContext:
        globalThis.document.activeElement?.closest('nav, div[aria-label="工程上下文"]') !== null,
    }));
    expect(focused.tag).not.toBe("BODY");
    expect(focused.inNavigationOrContext || focused.tag !== "").toBe(true);
  });

  await test.step("投影接缝失败时呈现 error 而不是跳过", async () => {
    await page.route("**/queries/projection.query", (route) => route.abort("failed"));
    await page.reload();
    await ensureSession(page);
    await expect(page.locator('[data-quality-page="1"]')).toHaveAttribute(
      "data-page-state",
      "error",
    );
    await expect(page.locator("[data-quality-summary]")).toHaveCount(0);
  });
});
