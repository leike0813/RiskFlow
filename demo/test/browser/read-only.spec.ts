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

const login = async (page, loginName, targetPath) => {
  await page.goto(`${server.origin}${targetPath}`);
  await page.waitForURL(/\/login\?next=/);
  await expect(page.getByText("RiskFlow", { exact: true }).first()).toBeVisible();
  await page.getByLabel("登录名").fill(loginName);
  await page.getByLabel("密码").fill(server.accountPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(`${server.origin}${targetPath}`);
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
  await login(
    page,
    server.operatorLogin,
    `/project/documents?project=${server.projectId}`,
  );
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
    .getByRole("button", { name: new RegExp(`${server.sourceAVersionEntityId}-chapter_1-segment_1`) })
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

test("无知识读能力角色打开机理库页呈现权限骨架", async ({ page }) => {
  await login(page, server.responderLogin, `/knowledge/mechanisms?project=${server.projectId}`);
  await expect(page.getByText("当前角色不具备知识库读取权限")).toBeVisible();
  await expect(page.getByText("MEC-VDS-017")).toHaveCount(0);
});

test("viewer 可查看知识治理页但不具备追溯投影权限", async ({ page }) => {
  await login(page, server.viewerLogin, `/knowledge/mechanisms?project=${server.projectId}`);
  await expect(page.getByText("MEC-VDS-017").first()).toBeVisible();
  await expect(page.getByText("关联对象").first()).toBeVisible();
  await expect(
    page.getByText(/暂无关联对象|当前角色不具备追溯投影的读取权限/).first(),
  ).toBeVisible();
});
