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

/** 事实单元格：页面为关键业务值标注稳定 data-fact，测试按语义取值而非整页文本。 */
const factValue = (root, label) => root.locator(`[data-fact="${label}"]`).first();

const dialog = (page) => page.getByRole("dialog");

/** 以页面现有 Cookie 直接调用正式 HTTP 接缝：只用于真实合成范围/数据准备与读回核对。 */
const postJson = async (page, path, body) =>
  page.evaluate(
    async ({ path, body }) => {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      let parsed;
      try {
        parsed = text === "" ? null : JSON.parse(text);
      } catch {
        parsed = text;
      }
      return { status: response.status, body: parsed };
    },
    { path, body },
  );

let rawSequence = 0;
const accessQuery = (page, payload) =>
  postJson(page, `/api/v1/projects/${server.projectId}/access/queries`, {
    ...payload,
    queryId: `spec-access-${Date.now().toString(36)}-${++rawSequence}`,
    requestedAt: new Date().toISOString(),
    projectId: server.projectId,
  });

const readAllAccess = async (page, kind) => {
  const items = [];
  let cursor;
  do {
    const response = await accessQuery(page, {
      kind,
      pageSize: 50,
      ...(cursor === undefined ? {} : { cursor }),
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    items.push(...response.body.result.items);
    cursor = response.body.result.nextCursor;
  } while (cursor !== undefined);
  return items;
};

const readAllScopes = (page) => readAllAccess(page, "spatial-scopes");

/** 正式工作区读面：按稳定空间身份读回当前业务修订，不复用页面展示文本。 */
const readSpatialRevision = async (page, scopeId) => {
  const response = await postJson(
    page,
    `/api/v1/projects/${server.projectId}/engineering-workspace/queries`,
    {
      queryId: `spec-workspace-${Date.now().toString(36)}-${++rawSequence}`,
      requestedAt: new Date().toISOString(),
      payload: { kind: "context", scopeId },
    },
  );
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.body.kind, JSON.stringify(response.body)).toBe("succeeded");
  expect(response.body.result.kind).toBe("context");
  expect(response.body.result.spatial, "空间业务修订必须已登记").not.toBeNull();
  return response.body.result.spatial;
};

/** 资料访问授权正式读面：登记人、指定账号与空间范围都按服务端事实核对。 */
const readSourceAccessFact = async (page, sourceVersionRef) => {
  const response = await accessQuery(page, { kind: "source-access", sourceVersionRef });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.body.kind, JSON.stringify(response.body)).toBe("succeeded");
  expect(response.body.result.kind).toBe("source-access");
  return response.body.result;
};

/**
 * 在点击前挂起正式命令响应，到达即按真实 JSON 断言成功。
 *
 * 成功后的刷新会更新版本/意图并可能自动卸载 ConfirmButton 与对话框，
 * 因此不依赖“命令已提交”文案或取消按钮是否仍挂载，后续事实仍需正式读面读回。
 */
const submitCommand = async (page, suffix, confirm) => {
  const expectedPath = `/api/v1/projects/${server.projectId}/${suffix}`;
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" && new URL(candidate.url()).pathname === expectedPath,
    { timeout: 60_000 },
  );
  await confirm();
  const settled = await response;
  const body = await settled.json();
  expect(settled.status(), JSON.stringify(body)).toBe(200);
  expect(body.kind, JSON.stringify(body)).toBe("succeeded");
  return body.result;
};

/**
 * 合成「目录页外」的授权空间：真实 C06 命令逐条创建在根空间之下。
 *
 * 只准备数据，不改变页面读取方式；页面必须经自己的有界目录与显式续页才能选中这些空间。
 */
const seedOffPageScopes = async (page, count) => {
  const root = (await readAllScopes(page)).find((item) => item.parentScopeRef === undefined);
  expect(root, "工程根空间必须存在").toBeTruthy();
  const runId = Date.now().toString(36);
  const ids = [];
  for (let index = 1; index <= count; index += 1) {
    const scopeId = `zz-spec-${runId}-${index}`;
    const commandId = `spec-create-scope-${scopeId}`;
    const response = await postJson(page, `/api/v1/projects/${server.projectId}/access/commands`, {
      commandId,
      idempotencyKey: commandId,
      issuedAt: new Date().toISOString(),
      payload: {
        kind: "create-spatial-scope",
        expectedVersion: "none",
        scopeId,
        parentScopeRef: { kind: "spatial-scope", reference: root.scopeRef },
      },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    ids.push(scopeId);
  }
  return ids;
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

test("工程上下文可取消、按当前输入确认追加并保留真实版本", async ({ page }) => {
  await login(page, server.operatorLogin, `/projects/spatial-scopes?project=${server.projectId}`);
  await selectProject(page);
  await expect(page.getByRole("heading", { name: "工程上下文", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "工程业务修订", exact: true })).toBeVisible();

  const projectFacts = page.locator(".pjwf-facts", { hasText: "工程名称" }).first();
  await expect(factValue(projectFacts, "业务版本")).toContainText("@");
  const initialVersion = await factValue(projectFacts, "业务版本").innerText();
  const initialName = await factValue(projectFacts, "工程名称").innerText();
  await expect(page.getByLabel("工程名称", { exact: true })).toHaveValue(initialName);

  // 取消不发送任何命令：旧计划不得在未确认时提交。
  const commands = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/engineering-workspace/commands")) {
      commands.push(request.url());
    }
  });
  await page.getByRole("button", { name: "确认追加工程业务修订", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(commands).toHaveLength(0);
  await expect(factValue(projectFacts, "业务版本")).toHaveText(initialVersion);

  // 改动输入后重新确认：确认计划冻结的是当前输入，而不是被取消的旧计划。
  const appendedName = `浏览器验收工程修订-${Date.now().toString(36)}`;
  const initialVersionId = initialVersion.slice(initialVersion.lastIndexOf("@") + 1);
  await page.getByLabel("工程名称", { exact: true }).fill(appendedName);
  await page.getByRole("button", { name: "确认追加工程业务修订", exact: true }).click();
  await expect(dialog(page)).toContainText(appendedName);
  // 成功后 onSucceeded 刷新版本/意图，确认框可能自动卸载；只认正式命令响应与事实读回。
  const result = await submitCommand(page, "engineering-workspace/commands", () =>
    dialog(page).getByRole("button", { name: "确认提交", exact: true }).click(),
  );
  expect(result.kind).toBe("project-revision");
  const revision = result.revision;
  expect(revision.projectRevisionRef.reference.entityId).toBe(server.projectId);
  expect(revision.projectRevisionRef.reference.versionId).not.toBe(initialVersionId);
  expect(revision.name).toBe(appendedName);

  // 页面刷新后的事实必须来自服务端新修订，版本由服务端递增而不是页面计算。
  await expect(factValue(projectFacts, "工程名称")).toHaveText(appendedName, { timeout: 30_000 });
  await expect(factValue(projectFacts, "业务版本")).toHaveText(
    `${server.projectId}@${revision.projectRevisionRef.reference.versionId}`,
    { timeout: 30_000 },
  );
  expect(commands.length).toBeGreaterThan(0);
});

test("工程上下文按历史 URL 精确读取且只读，scope 无版本时读取当前", async ({ page }) => {
  const revisionParam = encodeURIComponent(`${server.projectId}@1`);
  await login(
    page,
    server.operatorLogin,
    `/projects/spatial-scopes?project=${server.projectId}&revision=${revisionParam}`,
  );
  await selectProject(page);
  await expect(page.getByRole("heading", { name: "工程上下文", level: 1 })).toBeVisible();

  const projectFacts = page.locator(".pjwf-facts", { hasText: "工程名称" }).first();
  // 历史修订按 URL 读取，绝不显示当前修订或回退成当前。
  await expect(factValue(projectFacts, "业务版本")).toHaveText(`${server.projectId}@1`);
  await expect(factValue(projectFacts, "工程名称")).toHaveText("C32 验收工程");
  await expect(page.getByRole("button", { name: "确认追加工程业务修订", exact: true })).toHaveCount(
    0,
  );

  // 空间区段没有版本参数时读取当前业务修订，可写；精确 scopeVersion 时只读。
  const spatialFacts = page.locator(".pjwf-facts", { hasText: "当前区段业务版本" });
  await expect(spatialFacts).toBeVisible({ timeout: 30_000 });
  const spatialVersionText = await factValue(spatialFacts, "当前区段业务版本").innerText();
  const at = spatialVersionText.lastIndexOf("@");
  const scopeId = at > 0 ? spatialVersionText.slice(0, at) : "";
  const scopeVersion = at > 0 ? spatialVersionText.slice(at + 1) : "";
  expect(scopeId).toBeTruthy();
  expect(scopeVersion).toBeTruthy();

  const scopeUrl = `/projects/spatial-scopes?project=${server.projectId}&revision=${revisionParam}&scope=${encodeURIComponent(
    scopeId,
  )}&scopeVersion=${encodeURIComponent(scopeVersion)}`;
  await page.goto(`${server.origin}${scopeUrl}`);
  await expect(page.getByRole("heading", { name: "工程上下文", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认追加空间区段修订", exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator("#pjwf-scope-select")).toBeDisabled();
});

test("空间业务修订连续追加两次，C06 授权版本与 C11 业务版本互不混用", async ({ page }) => {
  await login(page, server.operatorLogin, `/projects/spatial-scopes?project=${server.projectId}`);
  await selectProject(page);
  await expect(page.getByRole("heading", { name: "工程上下文", level: 1 })).toBeVisible();

  const spatialFacts = page.locator(".pjwf-facts", { hasText: "当前区段业务版本" });
  await expect(spatialFacts).toBeVisible({ timeout: 30_000 });
  const initialVersion = await factValue(spatialFacts, "当前区段业务版本").innerText();
  const at = initialVersion.lastIndexOf("@");
  expect(at).toBeGreaterThan(0);
  const scopeId = initialVersion.slice(0, at);
  const scopeCatalog = (await readAllScopes(page)).find(
    (item) => item.scopeRef.entityId === scopeId,
  );
  if (scopeCatalog === undefined) throw new Error("当前空间必须出现在正式授权目录中");

  const append = async (label) => {
    const confirm = page.getByRole("button", { name: "确认追加空间区段修订", exact: true });
    await expect(confirm).toBeEnabled({ timeout: 30_000 });
    await page.getByLabel("区段名称", { exact: true }).fill(label);
    const worksite = page.getByLabel("工点位置", { exact: true });
    if ((await worksite.inputValue()).trim() === "") await worksite.fill("连续修订工点");
    await confirm.click();
    const result = await submitCommand(page, "engineering-workspace/commands", () =>
      dialog(page).getByRole("button", { name: "确认提交", exact: true }).click(),
    );
    expect(result.kind).toBe("spatial-revision");
    // 空间页刷新时 ConfirmButton 仍挂载，成功框可能保留；已按正式响应确认成功后关闭以继续输入。
    if (await dialog(page).isVisible()) {
      await dialog(page).getByRole("button", { name: "取消", exact: true }).click();
    }
    return result.revision;
  };

  const firstLabel = `连续空间修订A-${Date.now().toString(36)}`;
  const first = await append(firstLabel);
  expect(first.spatialScopeRef.reference.entityId).toBe(scopeId);
  expect(first.name).toBe(firstLabel);
  // 首次追加后 C11 业务版本与 C06 授权版本已分离。
  expect(first.spatialScopeRef.reference.versionId).not.toBe(scopeCatalog.scopeRef.versionId);
  await expect(factValue(spatialFacts, "当前区段业务版本")).toHaveText(
    `${scopeId}@${first.spatialScopeRef.reference.versionId}`,
    { timeout: 30_000 },
  );
  // 页面重填完成后再进行第二次修订，避免用刷新前的输入覆盖。
  await expect(page.getByLabel("区段名称", { exact: true })).toHaveValue(firstLabel, {
    timeout: 30_000,
  });
  const firstRead = await readSpatialRevision(page, scopeId);
  expect(firstRead.spatialScopeRef).toEqual(first.spatialScopeRef);
  expect(firstRead.name).toBe(firstLabel);

  const secondLabel = `连续空间修订B-${Date.now().toString(36)}`;
  const second = await append(secondLabel);
  expect(second.spatialScopeRef.reference.entityId).toBe(scopeId);
  expect(second.spatialScopeRef.reference.versionId).not.toBe(
    first.spatialScopeRef.reference.versionId,
  );
  expect(second.spatialScopeRef.reference.versionId).not.toBe(scopeCatalog.scopeRef.versionId);
  expect(second.name).toBe(secondLabel);
  await expect(factValue(spatialFacts, "当前区段业务版本")).toHaveText(
    `${scopeId}@${second.spatialScopeRef.reference.versionId}`,
    { timeout: 30_000 },
  );
  const secondRead = await readSpatialRevision(page, scopeId);
  expect(secondRead.spatialScopeRef).toEqual(second.spatialScopeRef);
  expect(secondRead.name).toBe(secondLabel);

  // 两次业务修订都成功，C06 授权目录里的精确版本与状态保持原样。
  const catalogAfter = (await readAllScopes(page)).find(
    (item) => item.scopeRef.entityId === scopeId,
  );
  expect(catalogAfter).toEqual(scopeCatalog);
});

test("成员修订保留真实空间范围并按精确版本真实提交", async ({ page }) => {
  await login(page, server.operatorLogin, `/projects/members?project=${server.projectId}`);
  await selectProject(page);
  await expect(page.getByRole("heading", { name: "成员与资料访问", level: 1 })).toBeVisible();

  const row = page.locator(".data-table-host tbody tr", { hasText: "业务查看（验收）" }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  const scopeCell = row.locator("td").nth(3);
  const originalScope = await scopeCell.innerText();
  expect(originalScope).not.toBe("—");

  const viewerMembership = await page
    .locator("#pjwf-membership option", { hasText: "业务查看（验收）" })
    .first()
    .getAttribute("value");
  if (viewerMembership === null) throw new Error("viewer membership option is missing");
  const originalMembership = (await readAllAccess(page, "memberships")).find(
    (item) => item.membershipRef.entityId === viewerMembership,
  );
  if (originalMembership === undefined) throw new Error("viewer membership read is missing");
  await page.locator("#pjwf-membership").selectOption(viewerMembership);
  // 真实成员范围逐项带入，不能初始填首空间重写权限。
  const selectedScopes = await page
    .locator("#pjwf-scopes")
    .evaluate((element) =>
      Array.from((element as HTMLSelectElement).selectedOptions, (option) => option.value),
    );
  expect(selectedScopes).toEqual(originalScope.split("、"));

  await page.locator("#pjwf-roles").selectOption(["business-viewer", "reviewer"]);
  await page.getByRole("button", { name: "提交成员修订", exact: true }).click();
  await page.getByRole("button", { name: "确认提交成员修订", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  // 原成员版本来自目录读面，原样作为预期版本；无并发时不得被判陈旧。
  const result = await submitCommand(page, "access/commands", () =>
    dialog(page).getByRole("button", { name: "确认提交", exact: true }).click(),
  );
  expect(result.kind).toBe("membership");
  expect(result.resultRef.entityId).toBe(viewerMembership);

  await expect(row).toContainText("复核人", { timeout: 30_000 });
  expect(await scopeCell.innerText()).toBe(originalScope);

  // 正式成员目录读回：角色与空间范围来自新成员版本，原空间范围没有被改写。
  const updatedMembership = (await readAllAccess(page, "memberships")).find(
    (item) => item.membershipRef.entityId === viewerMembership,
  );
  if (updatedMembership === undefined) throw new Error("viewer membership readback is missing");
  expect(updatedMembership.membershipRef.versionId).not.toBe(
    originalMembership.membershipRef.versionId,
  );
  expect([...updatedMembership.roles].sort()).toEqual(["business-viewer", "reviewer"]);
  expect(updatedMembership.status).toBe("active");
  expect(updatedMembership.spatialScopeRefs.map((ref) => ref.reference.entityId).sort()).toEqual(
    [...originalScope.split("、")].sort(),
  );
});

test("资料访问授权可收窄到本工程有效成员并读回新授权", async ({ page }) => {
  await login(page, server.operatorLogin, `/projects/members?project=${server.projectId}`);
  await selectProject(page);

  const sourceOption = await page
    .locator("#pjwf-source option", { hasText: "C32 验收资料 B" })
    .first()
    .getAttribute("value");
  if (sourceOption === null) throw new Error("source option is missing");
  await page.locator("#pjwf-source").selectOption(sourceOption);
  const editor = page.locator('[data-form="source-access"]');
  await expect(editor).toBeVisible({ timeout: 60_000 });
  const registeredBy = await factValue(editor, "来源登记人").innerText();
  expect(registeredBy.trim()).not.toBe("");
  const grantBefore = await factValue(editor, "授权引用").innerText();
  const sourceAt = sourceOption.lastIndexOf("@");
  const sourceVersionRef = {
    kind: "source-version",
    reference: {
      entityId: sourceOption.slice(0, sourceAt),
      versionId: sourceOption.slice(sourceAt + 1),
    },
  };
  const accessBefore = await readSourceAccessFact(page, sourceVersionRef);
  expect(registeredBy.trim()).toBe(accessBefore.registeredByAccountId);
  expect(grantBefore).toBe(
    `${accessBefore.sourceGrantRef.entityId}@${accessBefore.sourceGrantRef.versionId}`,
  );
  await expect(page.locator("#pjwf-source-visibility")).toHaveValue("restricted");

  // 指定账号只从本工程有效成员选择；登记人来自服务端来源事实，不是输入。
  await expect(page.locator("#pjwf-source-accounts")).toBeVisible();
  await page.locator("#pjwf-source-accounts").selectOption([server.operatorAccountId]);
  await page.getByRole("button", { name: "确认修订资料访问授权", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  // 来源权限收窄属于高影响操作，必须显式确认。
  await dialog(page).getByLabel("我已确认高影响操作").check();
  const result = await submitCommand(page, "access/commands", () =>
    dialog(page).getByRole("button", { name: "确认提交", exact: true }).click(),
  );
  expect(result.kind).toBe("source-access");
  expect(result.resultRef.entityId).toBe(accessBefore.sourceGrantRef.entityId);

  // 正式读面核对：新授权版本生效；原 C06 语义下登记人始终保留，不能因收窄被移除或伪造。
  const accessAfter = await readSourceAccessFact(page, sourceVersionRef);
  expect(accessAfter.sourceGrantRef.versionId).not.toBe(accessBefore.sourceGrantRef.versionId);
  expect(accessAfter.visibility).toBe("restricted");
  expect(accessAfter.registeredByAccountId).toBe(accessBefore.registeredByAccountId);
  const expectedAccounts = [server.operatorAccountId, accessBefore.registeredByAccountId].sort();
  expect([...accessAfter.allowedAccountIds].sort()).toEqual(expectedAccounts);
  expect(accessAfter.spatialScopeRefs.map((ref) => ref.reference.entityId).sort()).toEqual(
    accessBefore.spatialScopeRefs.map((ref) => ref.reference.entityId).sort(),
  );

  await expect(factValue(editor, "授权引用")).not.toHaveText(grantBefore, { timeout: 30_000 });
  const allowedAccounts = await page
    .locator("#pjwf-source-accounts")
    .evaluate((element) =>
      Array.from((element as HTMLSelectElement).selectedOptions, (option) => option.value),
    );
  expect([...allowedAccounts].sort()).toEqual(expectedAccounts);
  const operatorOption = await page
    .locator(`#pjwf-source-accounts option[value="${server.operatorAccountId}"]`)
    .innerText();
  expect(operatorOption).toContain("工程经理");
});

test("授权空间可新建与修订，并能选择目录页外的真实空间", async ({ page }) => {
  await login(page, server.operatorLogin, `/projects/members?project=${server.projectId}`);
  await selectProject(page);

  // 目录页外空间：只经真实命令准备，之后必须由页面自己的游标续页选中。
  const seededIds = await seedOffPageScopes(page, 51);
  await page.reload();
  await selectProject(page);
  const reviseSelect = page.locator("#pjwf-revise-scope");
  await expect(reviseSelect).toBeVisible({ timeout: 60_000 });

  // 新建子空间：身份一次生成，父范围来自真实授权目录；先新建，避免后续目录刷新重生成身份。
  const createId = (await page.locator("#pjwf-create-id").inputValue()).trim();
  expect(createId).not.toBe("");
  const parentSelect = page.locator("#pjwf-create-parent");
  const parentValue = await parentSelect.evaluate(
    (element) =>
      Array.from((element as HTMLSelectElement).options).find((option) => option.value !== "")
        ?.value ?? "",
  );
  expect(parentValue).not.toBe("");
  await parentSelect.selectOption(parentValue);
  await page.getByRole("button", { name: "确认新建授权空间", exact: true }).click();
  const created = await submitCommand(page, "access/commands", () =>
    dialog(page).getByRole("button", { name: "确认提交", exact: true }).click(),
  );
  expect(created.kind).toBe("spatial-scope");
  expect(created.resultRef.entityId).toBe(createId);
  await expect
    .poll(
      async () => (await readAllScopes(page)).some((item) => item.scopeRef.entityId === createId),
      { timeout: 30_000 },
    )
    .toBe(true);
  // 新建触发目录刷新：等新空间出现在真实目录页后再取首页选项与续页。
  await expect
    .poll(
      async () =>
        reviseSelect.evaluate(
          (element, expectedId) =>
            Array.from((element as HTMLSelectElement).options, (option) => option.value).includes(
              expectedId,
            ),
          createId,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);

  const firstPage = await reviseSelect.evaluate((element) =>
    Array.from((element as HTMLSelectElement).options, (option) => option.value).filter(
      (value) => value !== "",
    ),
  );
  const offPageScopeId = seededIds.find((id) => !firstPage.includes(id));
  if (offPageScopeId === undefined) throw new Error("off-page scope is missing");
  const offPageOption = reviseSelect.locator(`option[value="${offPageScopeId}"]`);
  await expect(offPageOption).toHaveCount(0);
  await page.getByRole("button", { name: "加载更多空间范围", exact: true }).click();
  await expect(offPageOption).toHaveCount(1);
  await expect(page.getByRole("button", { name: "加载更多空间范围", exact: true })).toHaveCount(0);
  await reviseSelect.selectOption(offPageScopeId);
  await page.locator("#pjwf-revise-status").selectOption("inactive");
  const scopeBefore = (await readAllScopes(page)).find(
    (item) => item.scopeRef.entityId === offPageScopeId,
  );
  if (scopeBefore === undefined) throw new Error("off-page scope read is missing");
  await page.getByRole("button", { name: "确认修订授权空间", exact: true }).click();
  await dialog(page).getByLabel("我已确认高影响操作").check();
  const revised = await submitCommand(page, "access/commands", () =>
    dialog(page).getByRole("button", { name: "确认提交", exact: true }).click(),
  );
  expect(revised.kind).toBe("spatial-scope");
  expect(revised.resultRef.entityId).toBe(offPageScopeId);
  await expect
    .poll(
      async () =>
        (await readAllScopes(page)).find((item) => item.scopeRef.entityId === offPageScopeId)
          ?.status,
      { timeout: 30_000 },
    )
    .toBe("inactive");
  const scopeAfter = (await readAllScopes(page)).find(
    (item) => item.scopeRef.entityId === offPageScopeId,
  );
  if (scopeAfter === undefined) throw new Error("off-page scope readback is missing");
  // 停用提交新的 C06 授权版本；父子身份与选定空间保持同一实体。
  expect(scopeAfter.status).toBe("inactive");
  expect(scopeAfter.scopeRef).not.toEqual(scopeBefore.scopeRef);
});

test("接入任务呈现已登记来源的解析与清洗事实", async ({ page }) => {
  await login(page, server.operatorLogin, `/projects/ingestion-tasks?project=${server.projectId}`);
  await selectProject(page);
  await expect(page.getByRole("heading", { name: "接入任务", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "接入来源", exact: true })).toBeVisible();
  // 「接入事实」卡片内的阶段项才代表该来源的登记关系；页面下方的 Agent 清洗任务区
  // 同样含“数据清洗”字样，不能把那段合法区域计入来源事实。
  // 未登记转换的来源只呈现已登记阶段：缺席不折算为“未清洗”，也不显示处理成功。
  const plainRow = page.locator(".data-table-host tbody tr", { hasText: "C32 验收资料 A" }).first();
  const factsCard = page.locator("section.card", {
    has: page.getByRole("heading", { name: "接入事实", exact: true }),
  });
  await expect(plainRow).toBeVisible({ timeout: 60_000 });
  await plainRow.click();
  await expect(page.getByRole("heading", { name: "接入事实", exact: true })).toBeVisible();
  await expect(factsCard.getByRole("listitem", { name: "资料分段" })).toHaveCount(1);
  await expect(factsCard.getByRole("listitem", { name: "文档转换" })).toHaveCount(0);
  await expect(factsCard.getByRole("listitem", { name: "数据清洗" })).toHaveCount(0);

  // 有转换与清洗登记的来源按真实登记事实呈现三个阶段。
  const cleaningRow = page
    .locator(".data-table-host tbody tr", { hasText: "C34 清洗来源资料" })
    .first();
  await expect(cleaningRow).toBeVisible();
  await cleaningRow.click();
  const conversionStage = factsCard.getByRole("listitem", { name: "文档转换" });
  const cleaningStage = factsCard.getByRole("listitem", { name: "数据清洗" });
  await expect(conversionStage).toHaveCount(1);
  await expect(cleaningStage).toHaveCount(1);
  // 阶段呈现真实登记的转换/清洗引用，而不是页面文案猜测。
  await expect(conversionStage.locator(".pjwf-fact-ref").first()).toContainText("@");
  await expect(cleaningStage.locator(".pjwf-fact-ref").first()).toContainText("@");
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
