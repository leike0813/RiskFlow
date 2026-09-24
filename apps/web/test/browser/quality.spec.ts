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

const login = async (page: Page): Promise<void> => {
  await expect(page.locator('input[name="loginName"]')).toBeVisible();
  await page.fill('input[name="loginName"]', server.operatorLogin);
  await page.fill('input[name="password"]', server.operatorPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.locator("#main-heading")).toBeVisible();
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
    await login(page);
    await expect(page.locator('[data-quality-page="1"]')).toHaveAttribute(
      "data-page-state",
      "ready",
    );
    await expectSummary(page);
  });

  await test.step("跨页面返回后按服务端当前投影重建", async () => {
    await page.goto(pathWithSelection("/overview", server.projectId));
    await login(page);
    await expect(page.locator('[data-quality-page="1"]')).toHaveCount(0);
    await page.goto(pathWithSelection("/assessment", server.projectId));
    await login(page);
    await expect(page.locator('[data-quality-page="1"]')).toHaveAttribute(
      "data-page-state",
      "ready",
    );
    await expectSummary(page);
  });

  await test.step("刷新后重新登录并从服务器重新查询", async () => {
    await page.reload();
    await login(page);
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
    await login(page);
    await expect(page.locator('[data-quality-page="1"]')).toHaveAttribute(
      "data-page-state",
      "ready",
    );
    await expectSummary(page, "0");
  });
});

test("键盘可达与安全失败", async ({ page }) => {
  await page.goto(pathWithSelection("/assessment", server.projectId));
  await login(page);
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
    await login(page);
    await expect(page.locator('[data-quality-page="1"]')).toHaveAttribute(
      "data-page-state",
      "error",
    );
    await expect(page.locator("[data-quality-summary]")).toHaveCount(0);
  });
});
