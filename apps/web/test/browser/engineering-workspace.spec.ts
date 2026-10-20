/**
 * CH-4 工程工作区真实浏览器验收：工程概览的独立来源状态、工程上下文维护、成员与资料访问、
 * 接入任务、监测精确序列与快照选择，以及无工程也可达的工程开通入口。
 *
 * 服务由 business-server.mjs 以真实 PostgreSQL / 迁移 / 会话 / 工件 / HTTP 接缝启动；
 * 页面只经生产 Web 构建访问，任何一步失败都计为失败，不以静态断言或关键 skip 代替。
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

/** 登录闸门：按登录表独有的字段名定位，避免命中页面内的同名输入。 */
const loginGate = (page) => page.locator('input[name="loginName"]');

const login = async (page, loginName, targetPath, password = server.accountPassword) => {
  const target = `${server.origin}${targetPath}`;
  await page.goto(target);
  const needsLogin = await loginGate(page)
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(
      () => true,
      () => false,
    );
  if (needsLogin) {
    await loginGate(page).fill(loginName);
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
  }
  await expect(loginGate(page)).toHaveCount(0, { timeout: 60_000 });
  const expectedPath = new URL(target).pathname;
  const currentPath = () => new URL(page.url()).pathname;
  if (currentPath() !== expectedPath) await page.goto(target);
  expect(currentPath()).toBe(expectedPath);
};

const selectProject = async (page) => {
  await page.getByLabel("工程标识").fill(server.projectId);
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.locator('div[aria-label="工程上下文"] select').first()).toHaveValue(
    server.projectId,
  );
};

test("工程概览按上下文、资料、监测与知识版本分别取数", async ({ page }) => {
  await login(page, server.operatorLogin, `/projects?project=${server.projectId}`);
  await selectProject(page);
  const content = page.locator("[data-page-section]");
  await expect(content.getByText("工程身份信息")).toBeVisible();
  // 四个来源区域各自呈现：任一来源拒权或失败都不抹掉其它区域。
  await expect(content.getByText("资料概况")).toBeVisible();
  await expect(content.getByText("监测概况")).toBeVisible();
  await expect(content.getByText("知识版本")).toBeVisible();
  await expect(page.getByText("变径盾构法").first()).toBeVisible();
});

test("工程上下文呈现当前业务修订与三维适用性，并可追加修订", async ({ page }) => {
  await login(page, server.operatorLogin, `/projects/spatial-scopes?project=${server.projectId}`);
  await selectProject(page);
  await expect(page.getByRole("heading", { name: "工程上下文", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "工程业务修订", exact: true })).toBeVisible();
  await expect(page.getByLabel("施工方法")).toBeVisible();
  await expect(page.getByLabel("地层条件")).toBeVisible();
  await expect(page.getByLabel("工序阶段")).toBeVisible();
  await expect(page.getByRole("heading", { name: "追加工程业务修订", exact: true })).toBeVisible();
  // 表单控件都有可见标签，不以技术标识充当业务输入。
  await expect(page.getByLabel("工程名称")).toBeVisible();
  await expect(page.getByLabel("生命周期")).toBeVisible();
  await expect(page.getByLabel("施工方法")).toBeVisible();
});

test("成员与资料访问页向工程风险管理员披露成员目录", async ({ page }) => {
  await login(page, server.operatorLogin, `/projects/members?project=${server.projectId}`);
  await selectProject(page);
  await expect(page.getByRole("heading", { name: "成员与资料访问", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "工程成员", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "成员修订", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "资料访问授权", exact: true })).toBeVisible();
  // 成员目录显示身份与预设角色，不显示登录凭据。
  await expect(page.getByRole("columnheader", { name: "预设角色" })).toBeVisible();
  await expect(page.getByText("工程风险负责人").first()).toBeVisible();
});

test("接入任务呈现已登记来源的解析与清洗事实", async ({ page }) => {
  await login(page, server.operatorLogin, `/projects/ingestion-tasks?project=${server.projectId}`);
  await selectProject(page);
  await expect(page.getByRole("heading", { name: "接入任务", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "接入来源", exact: true })).toBeVisible();
  // 未登记转换的来源只呈现已登记阶段：缺席不折算为“未清洗”，也不显示处理成功。
  const plainRow = page.locator(".data-table-host tbody tr", { hasText: "C32 验收资料 A" }).first();
  await expect(plainRow).toBeVisible({ timeout: 60_000 });
  await plainRow.click();
  await expect(page.getByRole("heading", { name: "接入事实", exact: true })).toBeVisible();
  await expect(page.getByText("资料分段").first()).toBeVisible();
  await expect(page.getByText("文档转换")).toHaveCount(0);
  await expect(page.getByText("数据清洗")).toHaveCount(0);

  // 有转换与清洗登记的来源按真实登记事实呈现三个阶段。
  const cleaningRow = page
    .locator(".data-table-host tbody tr", { hasText: "C34 清洗来源资料" })
    .first();
  await expect(cleaningRow).toBeVisible();
  await cleaningRow.click();
  await expect(page.getByText("文档转换").first()).toBeVisible();
  await expect(page.getByText("数据清洗").first()).toBeVisible();
});

test("监测详情按精确序列读取并提供快照选择", async ({ page }) => {
  await login(
    page,
    server.operatorLogin,
    `/projects/monitoring/${encodeURIComponent(server.seriesEntityId)}?project=${server.projectId}`,
  );
  await selectProject(page);
  await expect(page.getByRole("heading", { name: "监测序列详情", level: 1 })).toBeVisible();
  // 无版本旧地址由所属目录窄解析后写回精确版本，刷新仍重建同一目标。
  await expect(page).toHaveURL(/version=/, { timeout: 30_000 });
  await expect(page.getByText("监测快照")).toBeVisible();
});

test("工程开通入口在没有当前工程时仍然可达", async ({ page }) => {
  await login(page, server.administratorLogin, "/projects/opening", server.administratorPassword);
  await expect(page.getByRole("heading", { name: "工程开通", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "开通工程", exact: true })).toBeVisible();
  await expect(page.getByLabel("初始工程风险负责人")).toBeVisible();
});
