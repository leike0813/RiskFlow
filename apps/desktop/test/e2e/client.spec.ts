import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

import { ReportArtifactBodyV1Schema } from "../../../../packages/core/dist/workflow/report.js";
import type {
  SourceVersionRefV1,
  WorkflowRunRefV1,
} from "../../../../packages/contracts/dist/ports/index.js";

import {
  DESKTOP_ACCEPTANCE_ENV_V1,
  DESKTOP_ACCEPTANCE_PROBLEM_V1,
  preflightDesktopAcceptanceV1,
} from "./acceptance.mjs";

/**
 * C38 D-28 / IP-18（承接 C37 D-15 / 13.1）：桌面客户端的真实 Electron 验收。
 *
 * 覆盖：
 *   - 预检：受控输入、同次正式回执、秘密边界与非法输入自检；
 *   - 共享业务对象：两个会话各自过真实登录闸门，落到同一对象；
 *   - 登录：错误口令不建立会话，正确口令建立真实会话；
 *   - 资料：同次 provision/C04/C11 回执登记的正式资料可回查，且不伪造 UI 上传；
 *   - 报告下载：服务端登记的 JSON 工件真实落盘，正文按正式 Schema 复核；
 *   - 原件下载：同次登记的资料原件真实落盘，字节与授权原件一致，越界路径被取消；
 *   - Agent 入口：普通业务页能打开真实任务停靠区并进入工作台；
 *   - 撤权：管理会话在真实运维面修订成员状态，业务会话的同次读取随之关闭；
 *   - TLS 拒绝：不可信证书的 origin 只落到本地连接状态页；
 *   - 越界导航：主框架导航与新窗口被拒绝，页面仍停在批准 origin；
 *   - SSE：按正式游标重连且不重发写命令；
 *   - 关闭窗口后已受理任务继续：重开客户端读到同次运行的正式终态。
 *
 * 客户端是与产品同一份 dist 构建，加载应用服务器同一内网 HTTPS；不用 ignoreHTTPSErrors、
 * 不注入 Cookie、不关闭 sandbox，也不以浏览器模拟代替桌面。
 * 缺目标环境时非零失败：绝不用 skip 或假断言把「没跑」记成通过。
 */
const REPO_ROOT = process.cwd();
const originalUmaskV1 = process.umask(0o077);
const MAIN_PATH = join(REPO_ROOT, "apps", "desktop", "dist", "main.js");
const LOGIN_GATE_V1 = 'input[name="loginName"]';
const SSE_BOUNDED_WAIT_MS_V1 = 20_000;
const RUN_TERMINAL_WAIT_MS_V1 = 120_000;
const MEMBERSHIP_STATUS_LABEL_V1 = { active: "生效", removed: "已移除" } as const;

let acceptanceTarget: Awaited<ReturnType<typeof preflightDesktopAcceptanceV1>>;

test.beforeAll(async () => {
  acceptanceTarget = await preflightDesktopAcceptanceV1(process.env, REPO_ROOT);
});

const tempDirsV1: string[] = [];

/** 临时目录只承载测试宿主输入与会话数据，不写进仓库工作区。 */
const makeTempDirV1 = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirsV1.push(dir);
  return dir;
};

test.afterAll(() => {
  process.umask(originalUmaskV1);
  for (const dir of tempDirsV1) {
    if (!dir.startsWith(tmpdir())) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 会话目录由系统临时目录兜底清理；清理失败不得让验收结果变红。
    }
  }
});

const requireReady = (): void => {
  expect(acceptanceTarget.ready, "桌面验收环境缺失：" + acceptanceTarget.problems.join(", ")).toBe(
    true,
  );
};

/** 受控路径只在环境齐备后解析；缺项由 requireReady 先失败，不用默认 origin 兜底。 */
const envPathV1 = (name: string): string => {
  const value = process.env[name];
  if (value === undefined) throw new Error("missing desktop acceptance env: " + name);
  return value;
};

type DesktopSessionV1 = Readonly<{ app: ElectronApplication; window: Page }>;

/**
 * 每个会话独立 userData：共用 cookie 桶会让两次「独立登录」互相顶替，
 * 也不能用它证明会话隔离。
 */
const launchClientV1 = async (desktopConfigPath: string): Promise<DesktopSessionV1> => {
  const app = await electron.launch({
    executablePath: createRequire(join(REPO_ROOT, "apps", "desktop", "package.json"))("electron"),
    args: [
      join(REPO_ROOT, "apps", "desktop"),
      "--user-data-dir=" + makeTempDirV1("riskflow-desktop-session-"),
    ],
    env: {
      ...Object.fromEntries(
        [
          "PATH",
          "DISPLAY",
          "WAYLAND_DISPLAY",
          "XAUTHORITY",
          "DBUS_SESSION_BUS_ADDRESS",
          "XDG_RUNTIME_DIR",
          "LANG",
          "LC_ALL",
          "HOME",
          "USER",
          "TMPDIR",
        ].flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]])),
      ),
      RISKFLOW_DESKTOP_CONFIG: desktopConfigPath,
    },
  });
  const window = await app.firstWindow();
  return { app, window };
};

/**
 * 真实登录：会话自省 401 之后登录闸门才出现；返回本次是否真的经过登录表单。
 * 不注入 Cookie，也不拿页面外壳当「已登录」信号。
 */
const loginV1 = async (
  window: Page,
  url: string,
  loginName: string,
  password: string,
): Promise<boolean> => {
  await window.goto(url);
  const gate = window.locator(LOGIN_GATE_V1);
  const needsLogin = await gate.waitFor({ state: "visible", timeout: 30_000 }).then(
    () => true,
    () => false,
  );
  if (!needsLogin) return false;
  await gate.fill(loginName);
  await window.getByLabel("密码").fill(password);
  await window.getByRole("button", { name: "登录", exact: true }).click();
  await expect(gate, "登录后闸门必须落下").toHaveCount(0, { timeout: 60_000 });
  if (new URL(url).pathname === "/report/export") {
    await window.getByRole("button", { name: /^资料来源：/ }).click();
    await window
      .getByLabel("资料来源版本")
      .fill(
        JSON.stringify(
          acceptanceTarget.bindings.reportSourceVersionRefs.map((ref) => ref.reference),
        ),
      );
    await window.getByRole("button", { name: "应用来源", exact: true }).click();
  }
  return true;
};

let querySequenceV1 = 0;

/**
 * 真实同源读取：请求由页面自己带会话 cookie 发出，与页面走同一传输、Origin 与授权面，
 * 不额外开旁路、不注入凭据。
 */
const queryV1 = async (
  window: Page,
  projectId: string,
  branch: string,
  payload: unknown,
  sourceVersionRefs: readonly SourceVersionRefV1[] = acceptanceTarget.bindings
    .requestedSourceVersionRefs,
) => {
  querySequenceV1 += 1;
  return window.evaluate(
    async ({ target, body }) => {
      const response = await fetch(target, {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, body: text.length === 0 ? null : JSON.parse(text) };
    },
    {
      target: "/api/v1/projects/" + encodeURIComponent(projectId) + "/queries/" + branch,
      body: {
        schemaVersion: "1",
        queryId: "desktop-" + Date.now() + "-" + querySequenceV1,
        requestedAt: new Date().toISOString(),
        requestedSpatialScopeRefs: acceptanceTarget.bindings.requestedSpatialScopeRefs,
        requestedSourceVersionRefs: sourceVersionRefs,
        payload,
      },
    },
  );
};

type RunStatusProbeV1 = Readonly<{ status: number; runStatus: string | null }>;

/** 同次运行的正式状态：只从 functionalConfigFile 对应同次 run 的查询结果读取。 */
const readRunStatusV1 = async (
  window: Page,
  projectId: string,
  workflowRunRef: WorkflowRunRefV1,
): Promise<RunStatusProbeV1> => {
  const response = await queryV1(window, projectId, "risk-assessment.read", {
    operation: "run-read",
    workflowRunRef,
  });
  if (response.status !== 200) return { status: response.status, runStatus: null };
  const result = response.body?.result;
  const sameRun =
    result?.kind === "run-read" &&
    result.runRef?.kind === workflowRunRef.kind &&
    result.runRef?.reference?.entityId === workflowRunRef.reference.entityId &&
    result.runRef?.reference?.versionId === workflowRunRef.reference.versionId;
  return {
    status: response.status,
    runStatus: sameRun && typeof result.status === "string" ? result.status : null,
  };
};

/** Electron原生下载不发Playwright页面download事件；测试只给已被产品策略放行的下载选保存路径。 */
const captureDownloadV1 = async (app: ElectronApplication, click: () => Promise<void>) => {
  const path = join(makeTempDirV1("riskflow-download-"), "saved-original");
  await app.evaluate(({ session }, path) => {
    const state = { status: "waiting", filename: "" };
    (globalThis as typeof globalThis & { downloadProbe: typeof state }).downloadProbe = state;
    session.defaultSession.once("will-download", (event, item) => {
      if (event.defaultPrevented) {
        state.status = "denied";
        return;
      }
      state.filename = item.getFilename();
      item.setSavePath(path);
      item.once("done", (_event, status) => {
        state.status = status;
      });
    });
  }, path);
  await click();
  const readState = () =>
    app.evaluate(
      () =>
        (globalThis as typeof globalThis & { downloadProbe: { status: string; filename: string } })
          .downloadProbe,
    );
  await expect.poll(async () => (await readState()).status).toBe("completed");
  return { bytes: readFileSync(path), filename: (await readState()).filename };
};

/** 登记下载名的扩展名：只核对保存名保留了登记格式。 */
const extensionOfV1 = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
};

type SseProbeV1 = Readonly<{
  state: string;
  eventIds: readonly string[];
  runIds: readonly string[];
}>;

/** 在真实页面里订阅正式事件流：同源、同会话、同 Origin，不注入 Cookie。 */
const probeRunEventsV1 = async (
  window: Page,
  eventsUrl: string,
  afterEventId: string | undefined,
  bound: number,
): Promise<SseProbeV1> =>
  window.evaluate(
    async ({ target, cursor, limit, eventName, timeoutMs }) => {
      const url =
        cursor === undefined ? target : target + "?afterEventId=" + encodeURIComponent(cursor);
      return await new Promise<{ state: string; eventIds: string[]; runIds: string[] }>(
        (resolve) => {
          const eventIds: string[] = [];
          const runIds: string[] = [];
          const source = new EventSource(url);
          let settled = false;
          const finish = (state: string): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            source.close();
            resolve({ state, eventIds, runIds });
          };
          const timer = setTimeout(() => finish("bounded"), timeoutMs);
          source.addEventListener("error", () => finish("error"));
          source.addEventListener(eventName, (event: MessageEvent) => {
            let data: {
              domainEventRef?: { eventId?: unknown };
              workflowRunRef?: { reference?: { entityId?: unknown; versionId?: unknown } };
            };
            try {
              data = JSON.parse(String(event.data));
            } catch {
              finish("invalid-frame");
              return;
            }
            eventIds.push(String(data?.domainEventRef?.eventId ?? ""));
            runIds.push(
              `${data?.workflowRunRef?.reference?.entityId ?? ""}@${data?.workflowRunRef?.reference?.versionId ?? ""}`,
            );
            if (eventIds.length >= limit) finish("events");
          });
        },
      );
    },
    {
      target: eventsUrl,
      cursor: afterEventId,
      limit: bound,
      eventName: "domain-event-ref.v1",
      timeoutMs: SSE_BOUNDED_WAIT_MS_V1,
    },
  );

const membershipRowV1 = (window: Page, accountId: string) =>
  window
    .locator("tr", { has: window.getByRole("cell", { name: accountId, exact: true }) })
    .filter({ has: window.getByRole("button", { name: "修订", exact: true }) });

/**
 * 管理会话在真实运维面修订成员状态：账号标识从真实账号表读取，状态由正式命令提交，
 * 确认走产品既有的人工确认对话框。
 */
const reviseMembershipV1 = async (
  window: Page,
  projectId: string,
  accountLoginName: string,
  status: "active" | "removed",
): Promise<void> => {
  const accountRow = window.locator("tr", {
    has: window.getByRole("cell", { name: accountLoginName, exact: true }),
  });
  await expect(accountRow, "账号必须精确且唯一").toHaveCount(1);
  await expect(accountRow, "运维面必须列出被授权账号").toBeVisible({ timeout: 60_000 });
  const accountId = (await accountRow.locator("td").first().innerText()).split("\n")[0].trim();
  expect(accountId.length, "账号标识必须从真实账号表读取").toBeGreaterThan(0);

  await window
    .getByRole("group", { name: "按工程选择成员目录" })
    .getByRole("button", { name: projectId })
    .click();
  const row = membershipRowV1(window, accountId);
  await expect(row, "工程成员目录必须登记该账号").toHaveCount(1, { timeout: 60_000 });
  await row.getByRole("button", { name: "修订", exact: true }).click();
  await window.locator("#access-membership-status").selectOption(status);
  await window.getByRole("button", { name: "提交修订", exact: true }).click();
  const confirmation = window.getByRole("group", { name: "管理动作确认", exact: true });
  await confirmation.getByRole("button", { name: "确认执行", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(row.getByText(MEMBERSHIP_STATUS_LABEL_V1[status])).toBeVisible({
    timeout: 60_000,
  });
};

const FIXTURE_APPROVED_ORIGIN_V1 = "https://riskflow.internal.example";

/** 预检边界自检用的合成夹具：只写测试宿主输入，不接触任何真实业务状态。 */
const writeFixtureV1 = () => {
  const dir = makeTempDirV1("riskflow-desktop-preflight-");
  const writeJson = (name: string, value: unknown): string => {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(value));
    return path;
  };

  const desktopConfigPath = writeJson("desktop-config.json", {
    schemaVersion: 1,
    deploymentId: "deployment-c38-fixture",
    publicOrigin: FIXTURE_APPROVED_ORIGIN_V1,
    serverCompatibilityRange: {
      minServerReleaseId: "release-2030-01",
      maxServerReleaseId: "release-2030-09",
    },
  });
  const runConfig = {
    schemaVersion: "1",
    baseUrl: FIXTURE_APPROVED_ORIGIN_V1,
    loginName: "operator-fixture",
    password: "run-config-fixture-password",
    projectId: "project-fixture",
    bindings: {
      workflowRunRef: {
        kind: "workflow-run",
        reference: { entityId: "run-fixture", versionId: "run-fixture-v1" },
      },
      queryResultRef: {
        kind: "query-result",
        reference: { entityId: "result-fixture", versionId: "result-fixture-v1" },
      },
      sourceVersionRef: {
        kind: "source-version",
        reference: { entityId: "source-fixture", versionId: "source-fixture-v1" },
      },
    },
    commands: [
      {
        stepId: "source",
        type: "http",
        operationId: "riskflow_command_engineering-data_register-source-delivery",
        payload: {},
      },
      {
        stepId: "start",
        type: "http",
        operationId: "riskflow_command_workflow_start-run",
        payload: {},
      },
      {
        stepId: "query",
        type: "http",
        operationId: "riskflow_query_projection_query",
        payload: {
          queryType: "risk-overview",
          projectRevisionRef: {
            kind: "project-revision",
            reference: { entityId: "project-fixture", versionId: "1" },
          },
        },
      },
      {
        stepId: "run-view",
        type: "http",
        operationId: "riskflow_query_projection_query",
        payload: {
          queryType: "run-view",
          workflowRunRef: { $result: "start", path: ["workflowRunRef"] },
        },
      },
      {
        stepId: "export",
        type: "http",
        operationId: "riskflow_query_projection_export",
        payload: {
          sourceRef: { $result: "query", path: ["queryResultRef"] },
          exportPolicyRef: { entityId: "report-export", versionId: "1" },
        },
      },
    ],
  };
  writeJson("run-config.json", runConfig);
  const functionalConfig = {
    schemaVersion: "1",
    runConfigFile: "run-config.json",
    observations: [
      {
        stepId: "start",
        operationId: "riskflow_query_projection_result-read",
        payload: { queryResultRef: { $result: "run-view", path: ["queryResultRef"] }, limit: 100 },
        expectedTerminalStatus: "completed",
        requiredReferences: [["items", 0, "latestResultRef"]],
      },
    ],
    pollIntervalMs: 1000,
    timeoutMs: 60_000,
    maxQueries: 10,
  };
  const functionalConfigPath = writeJson("functional-config.json", functionalConfig);
  const operatorSecretPath = join(dir, "operator-password");
  writeFileSync(operatorSecretPath, "fixture-operator-password", { mode: 0o600 });
  const administratorSecretPath = join(dir, "administrator-password");
  writeFileSync(administratorSecretPath, "fixture-administrator-password", { mode: 0o600 });

  const acceptance = {
    schemaVersion: "1",
    releaseId: "release-2030-05",
    projectId: "project-fixture",
    loginName: "operator-fixture",
    passwordSecretFile: operatorSecretPath,
    administratorLoginName: "administrator-fixture",
    administratorPasswordSecretFile: administratorSecretPath,
    functionalConfigFile: functionalConfigPath,
    functionalReportFile: join(dir, "functional.json"),
    sharedObjectUrl:
      FIXTURE_APPROVED_ORIGIN_V1 +
      "/report/export?project=project-fixture&sourceKind=query-result&sourceId=result-fixture&sourceVersion=result-fixture-v1",
    downloadArtifactRef: {
      kind: "content-artifact",
      reference: { entityId: "artifact-fixture", versionId: "sha256:" + "a".repeat(64) },
    },
    invalidCertificateOrigin: "https://self-signed.internal.example",
    unapprovedOrigin: "https://other.internal.example",
  };
  const digest = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  writeJson("functional.json", {
    schemaVersion: "1",
    status: "RUNNING",
    runId: "synthetic-fixture",
    configDigest: digest(functionalConfig),
    runConfigDigest: digest({
      ...runConfig,
      password: createHash("sha256").update(runConfig.password).digest("hex"),
    }),
  });
  mkdirSync(join(dir, "synthetic"));
  const codeCommit = "a".repeat(40);
  writeJson("synthetic/run.json", {
    schemaVersion: "1",
    status: "SUBMITTED",
    runId: "synthetic-fixture",
    codeHead: codeCommit,
    bindings: {},
    steps: [
      {
        stepId: "source",
        operationId: runConfig.commands[0].operationId,
        status: "completed",
        resultRef: { sourceVersionRef: runConfig.bindings.sourceVersionRef },
      },
      {
        stepId: "start",
        operationId: runConfig.commands[1].operationId,
        status: "submitted",
        resultRef: { workflowRunRef: runConfig.bindings.workflowRunRef },
        requestedSourceVersionRefs: [runConfig.bindings.sourceVersionRef],
        requestedSpatialScopeRefs: [],
      },
      {
        stepId: "query",
        operationId: runConfig.commands[2].operationId,
        status: "completed",
        resultRef: { queryResultRef: runConfig.bindings.queryResultRef },
      },
      {
        stepId: "run-view",
        operationId: runConfig.commands[3].operationId,
        status: "completed",
        resultRef: {
          queryResultRef: {
            kind: "query-result",
            reference: { entityId: "run-view-fixture", versionId: "1" },
          },
        },
      },
      {
        stepId: "export",
        operationId: runConfig.commands[4].operationId,
        status: "completed",
        resultRef: {
          exportArtifactRef: {
            kind: "export-artifact",
            reference: acceptance.downloadArtifactRef.reference,
          },
        },
      },
    ],
  });
  const deployment = JSON.parse(
    readFileSync(join(REPO_ROOT, "deployment/config.example.json"), "utf8"),
  );
  deployment.releaseId = acceptance.releaseId;
  const deploymentConfigPath = writeJson("deployment.json", deployment);
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, "deployment/release-manifest.example.json"), "utf8"),
  );
  manifest.releaseId = acceptance.releaseId;
  manifest.codeCommit = codeCommit;
  manifest.finalMigrationVersion = "000059";
  const releaseManifestPath = writeJson("release.json", manifest);
  const acceptanceConfigPath = writeJson("acceptance.json", acceptance);
  return {
    desktopConfigPath,
    acceptanceConfigPath,
    acceptance,
    operatorSecretPath,
    deploymentConfigPath,
    releaseManifestPath,
  };
};

/** 每次用新的合成夹具跑一遍预检，可叠加一处篡改，验证它确实被拒绝。 */
const preflightFixtureV1 = async (
  mutate?: (fixture: ReturnType<typeof writeFixtureV1>) => Record<string, unknown> | undefined,
): Promise<Awaited<ReturnType<typeof preflightDesktopAcceptanceV1>>> => {
  const fixture = writeFixtureV1();
  const patch = mutate?.(fixture);
  if (patch !== undefined) {
    writeFileSync(
      fixture.acceptanceConfigPath,
      JSON.stringify({ ...fixture.acceptance, ...patch }),
    );
  }
  return preflightDesktopAcceptanceV1({
    [DESKTOP_ACCEPTANCE_ENV_V1.buildConfig]: fixture.desktopConfigPath,
    [DESKTOP_ACCEPTANCE_ENV_V1.acceptanceConfig]: fixture.acceptanceConfigPath,
    RISKFLOW_DEPLOYMENT_CONFIG: fixture.deploymentConfigPath,
    RISKFLOW_RELEASE_MANIFEST: fixture.releaseManifestPath,
  });
};

test("预检边界：缺项、错工程/发布、越界链接与非法秘密都被拒绝", async () => {
  const valid = await preflightFixtureV1();
  expect(valid.problems, "合成夹具本身必须齐备").toEqual([]);
  expect(JSON.stringify(valid.problems), "问题码不得回显秘密内容").not.toContain(
    "fixture-operator-password",
  );

  const insecureShared = await preflightFixtureV1(() => ({
    sharedObjectUrl: "http://" + "riskflow.internal.example/report/export",
  }));
  expect(insecureShared.problems).toContain(DESKTOP_ACCEPTANCE_PROBLEM_V1.sharedObjectNotHttps);

  const foreignShared = await preflightFixtureV1(() => ({
    sharedObjectUrl: "https://other.internal.example/report/export",
  }));
  expect(foreignShared.problems).toContain(DESKTOP_ACCEPTANCE_PROBLEM_V1.sharedObjectOutsideOrigin);

  const approvedAsRejectionTarget = await preflightFixtureV1(() => ({
    invalidCertificateOrigin: FIXTURE_APPROVED_ORIGIN_V1 + ":443",
  }));
  expect(approvedAsRejectionTarget.problems).toContain(
    DESKTOP_ACCEPTANCE_PROBLEM_V1.invalidCertificateOriginIsApproved,
  );

  const schemeMissing = await preflightFixtureV1(() => ({
    unapprovedOrigin: "other.internal.example",
  }));
  expect(schemeMissing.problems).toContain(DESKTOP_ACCEPTANCE_PROBLEM_V1.unapprovedOriginNotHttps);

  const wrongProject = await preflightFixtureV1(() => ({ projectId: "project-fixture-2" }));
  expect(wrongProject.problems).toContain(DESKTOP_ACCEPTANCE_PROBLEM_V1.runProjectMismatch);

  const wrongIdentity = await preflightFixtureV1(() => ({ loginName: "operator-other" }));
  expect(wrongIdentity.problems).toContain(DESKTOP_ACCEPTANCE_PROBLEM_V1.runIdentityMismatch);

  const wrongRelease = await preflightFixtureV1(() => ({ releaseId: "release-2031-01" }));
  expect(wrongRelease.problems).toContain(DESKTOP_ACCEPTANCE_PROBLEM_V1.deploymentMismatch);

  const missingField = await preflightFixtureV1(() => ({ downloadArtifactRef: undefined }));
  expect(missingField.problems).toContain(DESKTOP_ACCEPTANCE_PROBLEM_V1.invalidAcceptanceInput);

  const nonDigestArtifact = await preflightFixtureV1(() => ({
    downloadArtifactRef: {
      kind: "content-artifact",
      reference: { entityId: "artifact-fixture", versionId: "artifact-fixture-v1" },
    },
  }));
  expect(nonDigestArtifact.problems).toContain(
    DESKTOP_ACCEPTANCE_PROBLEM_V1.invalidAcceptanceInput,
  );

  const looseSecret = await preflightFixtureV1((fixture) => {
    chmodSync(fixture.operatorSecretPath, 0o644);
    return undefined;
  });
  expect(looseSecret.problems).toContain(DESKTOP_ACCEPTANCE_PROBLEM_V1.unreadableOperatorSecret);

  const missingSecret = await preflightFixtureV1(() => ({
    passwordSecretFile: "/tmp/riskflow-desktop-missing-secret",
  }));
  expect(missingSecret.problems).toContain(DESKTOP_ACCEPTANCE_PROBLEM_V1.unreadableOperatorSecret);

  const wrongReport = await preflightFixtureV1((fixture) => {
    const report = JSON.parse(readFileSync(fixture.acceptance.functionalReportFile, "utf8"));
    writeFileSync(
      fixture.acceptance.functionalReportFile,
      JSON.stringify({ ...report, runId: "another-run" }),
    );
  });
  expect(wrongReport.problems).toContain(DESKTOP_ACCEPTANCE_PROBLEM_V1.reportMismatch);

  const changedConfig = await preflightFixtureV1((fixture) => {
    const path = join(fixture.acceptance.functionalConfigFile, "..", "run-config.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...config, projectId: "another-project" }));
  });
  expect(changedConfig.problems).toContain(DESKTOP_ACCEPTANCE_PROBLEM_V1.reportMismatch);

  const foreignQuery = await preflightFixtureV1((fixture) => ({
    sharedObjectUrl: fixture.acceptance.sharedObjectUrl.replace(
      "result-fixture-v1",
      "other-version",
    ),
  }));
  expect(foreignQuery.problems).toContain(DESKTOP_ACCEPTANCE_PROBLEM_V1.invalidRunBindings);

  for (const invalidBinding of ["run-view-source", "foreign-export-source"]) {
    const rejected = await preflightFixtureV1((fixture) => {
      const configPath = join(fixture.acceptance.functionalConfigFile, "..", "run-config.json");
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      if (invalidBinding === "run-view-source") {
        config.commands.find(
          (step: { stepId: string }) => step.stepId === "query",
        ).payload.queryType = "run-view";
      } else {
        config.commands.find(
          (step: { stepId: string }) => step.stepId === "export",
        ).payload.sourceRef = {
          kind: "query-result",
          reference: { entityId: "foreign-query", versionId: "1" },
        };
      }
      writeFileSync(configPath, JSON.stringify(config));
      const report = JSON.parse(readFileSync(fixture.acceptance.functionalReportFile, "utf8"));
      report.runConfigDigest = createHash("sha256")
        .update(
          JSON.stringify({
            ...config,
            password: createHash("sha256").update(config.password).digest("hex"),
          }),
        )
        .digest("hex");
      writeFileSync(fixture.acceptance.functionalReportFile, JSON.stringify(report));
    });
    expect(rejected.problems).toContain(DESKTOP_ACCEPTANCE_PROBLEM_V1.invalidRunBindings);
  }
});

test("预检：受控输入、同次回执与秘密边界齐备", () => {
  requireReady();
  expect(existsSync(MAIN_PATH), "客户端构建产物缺失").toBe(true);
  expect(acceptanceTarget.publicOrigin).toBe(acceptanceTarget.desktopConfig.publicOrigin);
  expect(acceptanceTarget.bindings?.workflowRunRef.reference.entityId.length).toBeGreaterThan(0);
  expect(acceptanceTarget.credentials?.operator.password.length).toBeGreaterThan(0);
  expect(acceptanceTarget.credentials?.administrator.password.length).toBeGreaterThan(0);
});

test("关闭窗口后已受理任务继续：重开客户端读到同次运行的正式终态", async () => {
  requireReady();
  const projectId = acceptanceTarget.acceptance.projectId;
  const operator = acceptanceTarget.credentials.operator;
  const workflowRunRef = acceptanceTarget.bindings.workflowRunRef;

  const first = await launchClientV1(envPathV1(DESKTOP_ACCEPTANCE_ENV_V1.buildConfig));
  let before: RunStatusProbeV1;
  try {
    await loginV1(
      first.window,
      acceptanceTarget.acceptance.sharedObjectUrl,
      operator.loginName,
      operator.password,
    );
    before = await readRunStatusV1(first.window, projectId, workflowRunRef);
    expect(before.status, "同次运行必须可读").toBe(200);
    if (before.runStatus === "waiting") {
      const agentTaskRef = acceptanceTarget.bindings.pendingAgentTaskRef;
      expect(agentTaskRef, "等待运行必须具有同次启动回执的任务引用").toBeDefined();
      const task = await queryV1(first.window, projectId, "agent-task.read", {
        kind: "detail",
        agentTaskRef,
      });
      expect(task.status).toBe(200);
      expect(["queued", "running"], "关窗前任务必须仍在服务端执行").toContain(
        task.body?.result?.summary?.status,
      );
    } else {
      expect(["pending", "running"], "关窗前必须有已受理且未完成的同次运行").toContain(
        before.runStatus,
      );
    }
  } finally {
    // 关闭客户端窗口：已受理的服务端任务不得因此取消。
    await first.app.close();
  }

  const second = await launchClientV1(envPathV1(DESKTOP_ACCEPTANCE_ENV_V1.buildConfig));
  try {
    await loginV1(
      second.window,
      acceptanceTarget.acceptance.sharedObjectUrl,
      operator.loginName,
      operator.password,
    );
    await expect
      .poll(
        async () => (await readRunStatusV1(second.window, projectId, workflowRunRef)).runStatus,
        {
          timeout: RUN_TERMINAL_WAIT_MS_V1,
          message: "关闭窗口后已受理任务必须继续到正式终态",
        },
      )
      .toBe("completed");
  } finally {
    await second.app.close();
  }
});

test("启动真实客户端并加载批准 origin，加载失败时给出显式重试", async () => {
  requireReady();
  const { app, window } = await launchClientV1(envPathV1(DESKTOP_ACCEPTANCE_ENV_V1.buildConfig));
  try {
    const versions = await app.evaluate(() => ({
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
    }));
    const compatibility = acceptanceTarget.bindings.desktopCompatibility;
    expect(compatibility.supportedElectronVersions).toContain(versions.electron);
    expect(compatibility.supportedChromiumVersions).toContain(versions.chromium);
    expect(compatibility.supportedBundledNodeVersions).toContain(versions.node);
    await test.info().attach("desktop-runtime-identity", {
      body: JSON.stringify({ releaseId: acceptanceTarget.acceptance.releaseId, versions }),
      contentType: "application/json",
    });
    // 客户端首屏必须是批准 origin，而不是任意页面或本地文件。
    const url = new URL(window.url());
    expect(url.protocol).toBe("https:");
    expect(url.origin).toBe(new URL(acceptanceTarget.publicOrigin).origin);
    // 渲染进程拿不到 Node 能力：无 preload、无 require。
    const privileged = await window.evaluate(() => ({
      hasRequire: typeof (window as unknown as { require?: unknown }).require !== "undefined",
      hasProcess: typeof (window as unknown as { process?: unknown }).process !== "undefined",
    }));
    expect(privileged.hasRequire).toBe(false);
    expect(privileged.hasProcess).toBe(false);
  } finally {
    await app.close();
  }
});

test("登录：错误口令不建立会话，正确口令建立真实会话", async () => {
  requireReady();
  const operator = acceptanceTarget.credentials.operator;
  const { app, window } = await launchClientV1(envPathV1(DESKTOP_ACCEPTANCE_ENV_V1.buildConfig));
  try {
    await window.goto(acceptanceTarget.publicOrigin + "/overview");
    const gate = window.locator(LOGIN_GATE_V1);
    await expect(gate, "未登录时必须先过登录闸门").toBeVisible({ timeout: 30_000 });

    // 单次错误口令：只证明口令参与判真，不反复尝试以免触发账号锁定。
    await gate.fill(operator.loginName);
    await window.getByLabel("密码").fill("c38-desktop-wrong-password");
    await window.getByRole("button", { name: "登录", exact: true }).click();
    await expect(window.locator(".login-error"), "错误口令必须如实失败").toBeVisible({
      timeout: 30_000,
    });
    await expect(gate, "错误口令不得建立会话").toBeVisible();

    await gate.fill(operator.loginName);
    await window.getByLabel("密码").fill(operator.password);
    await window.getByRole("button", { name: "登录", exact: true }).click();
    await expect(gate, "正确口令后闸门必须落下").toHaveCount(0, { timeout: 60_000 });
  } finally {
    await app.close();
  }
});

test("共享对象：两个会话各自真实登录并落到同一业务对象", async () => {
  requireReady();
  const sharedObjectUrl = acceptanceTarget.acceptance.sharedObjectUrl;
  const artifactId = acceptanceTarget.acceptance.downloadArtifactRef.reference.entityId;
  const operator = acceptanceTarget.credentials.operator;
  const administrator = acceptanceTarget.credentials.administrator;

  const operatorSession = await launchClientV1(envPathV1(DESKTOP_ACCEPTANCE_ENV_V1.buildConfig));
  const administratorSession = await launchClientV1(
    envPathV1(DESKTOP_ACCEPTANCE_ENV_V1.buildConfig),
  );
  try {
    // 业务会话：共享对象就是同次回执登记的导出面对象。
    expect(
      await loginV1(operatorSession.window, sharedObjectUrl, operator.loginName, operator.password),
      "业务会话必须自己过登录闸门",
    ).toBe(true);
    await expect(
      operatorSession.window.getByRole("heading", { name: "报告导出", level: 1 }),
    ).toBeVisible();
    await expect(operatorSession.window.getByText(artifactId, { exact: true })).toBeVisible();

    // 第二个主体必须有同一对象的业务读取授权，系统管理角色本身不授予业务读取权。
    expect(
      await loginV1(
        administratorSession.window,
        sharedObjectUrl,
        administrator.loginName,
        administrator.password,
      ),
      "管理会话必须自己过登录闸门",
    ).toBe(true);
    await expect(
      administratorSession.window.getByRole("heading", { name: "报告导出", level: 1 }),
    ).toBeVisible();
    await expect(
      administratorSession.window.getByText(artifactId, { exact: true }),
      "两个主体必须读取同一正式业务对象",
    ).toBeVisible({ timeout: 60_000 });
  } finally {
    await operatorSession.app.close();
    await administratorSession.app.close();
  }
});

test("资料：同次正式回执登记的资料可回查，且不伪造 UI 上传", async () => {
  requireReady();
  const projectId = acceptanceTarget.acceptance.projectId;
  const operator = acceptanceTarget.credentials.operator;
  const sourceVersionRef = acceptanceTarget.bindings.sourceVersionRef;
  const { app, window } = await launchClientV1(envPathV1(DESKTOP_ACCEPTANCE_ENV_V1.buildConfig));
  try {
    // 当前 HTTP 没有上传入口：测试也不得伪造上传请求。
    const uploadCalls: string[] = [];
    window.on("request", (request) => {
      if (/upload/i.test(new URL(request.url()).pathname)) uploadCalls.push(request.url());
    });

    await loginV1(
      window,
      acceptanceTarget.publicOrigin + "/overview",
      operator.loginName,
      operator.password,
    );
    const catalog = await queryV1(window, projectId, "engineering-data.source-catalog", {
      pageSize: 50,
    });
    expect(catalog.status, "正式资料目录必须可读").toBe(200);
    const registered = (catalog.body?.result?.items ?? []).find(
      (item: { sourceVersionRef?: { reference?: unknown } }) =>
        JSON.stringify(item?.sourceVersionRef?.reference) ===
        JSON.stringify(sourceVersionRef.reference),
    );
    expect(
      registered,
      "同次回执登记的资料来源版本必须出现在正式资料目录里（不由测试上传）",
    ).toBeDefined();

    await window.goto(
      acceptanceTarget.publicOrigin +
        "/projects/documents?project=" +
        encodeURIComponent(projectId),
    );
    await expect(window.getByRole("heading", { name: "资料目录", level: 1 })).toBeVisible();
    await expect(window.getByText(String(registered.sourceId), { exact: true })).toBeVisible();
    expect(uploadCalls, "资料只由正式 provision/C04/C11 登记").toEqual([]);
  } finally {
    await app.close();
  }
});

test("报告下载：服务端登记的 JSON 工件真实落盘，正文按正式 Schema 复核", async () => {
  requireReady();
  const projectId = acceptanceTarget.acceptance.projectId;
  const operator = acceptanceTarget.credentials.operator;
  const artifactId = acceptanceTarget.acceptance.downloadArtifactRef.reference.entityId;
  const { app, window } = await launchClientV1(envPathV1(DESKTOP_ACCEPTANCE_ENV_V1.buildConfig));
  try {
    await loginV1(
      window,
      acceptanceTarget.acceptance.sharedObjectUrl,
      operator.loginName,
      operator.password,
    );
    await expect(window.getByRole("heading", { name: "报告导出", level: 1 })).toBeVisible();

    const row = window.locator("tr", { hasText: artifactId });
    await expect(row, "同次登记的导出工件必须在导出历史里").toHaveCount(1);
    const download = await captureDownloadV1(app, () =>
      row.getByRole("button", { name: "下载 JSON", exact: true }).click(),
    );
    expect(download.filename.length, "文件名由服务端给定").toBeGreaterThan(0);
    const json = download.bytes.toString("utf8");
    expect("sha256:" + createHash("sha256").update(json).digest("hex")).toBe(
      acceptanceTarget.acceptance.downloadArtifactRef.reference.versionId,
    );
    const body = ReportArtifactBodyV1Schema.parse(JSON.parse(json));
    expect(body.queryResultRef).toEqual(acceptanceTarget.bindings.queryResultRef);
    expect(body.projectId).toBe(projectId);
    expect(body.format).toBe("json");
    expect(body.exportPolicyRef.entityId.length).toBeGreaterThan(0);
    expect(Array.isArray(body.items)).toBe(true);
  } finally {
    await app.close();
  }
});

test("原件下载：同次登记的资料原件真实落盘，字节与授权原件一致", async () => {
  requireReady();
  const projectId = acceptanceTarget.acceptance.projectId;
  const operator = acceptanceTarget.credentials.operator;
  const sourceVersionRef = acceptanceTarget.bindings.sourceVersionRef;
  const sourceId = sourceVersionRef.reference.entityId;
  const versionId = sourceVersionRef.reference.versionId;
  const originalPath =
    "/api/v1/projects/" +
    encodeURIComponent(projectId) +
    "/sources/" +
    encodeURIComponent(sourceId) +
    "/versions/" +
    encodeURIComponent(versionId) +
    "/original";
  const { app, window } = await launchClientV1(envPathV1(DESKTOP_ACCEPTANCE_ENV_V1.buildConfig));
  try {
    await loginV1(
      window,
      acceptanceTarget.publicOrigin +
        "/projects/documents?project=" +
        encodeURIComponent(projectId),
      operator.loginName,
      operator.password,
    );

    // 登记的正式原件事实：名称、类型与字节数来自 C11/C04 精确来源，测试不补造。
    const info = await queryV1(window, projectId, "engineering-data.source-original-read", {
      sourceVersionRef,
    });
    expect(info.status, "同次登记的原件必须可读").toBe(200);
    const original = info.body?.result;
    expect(original?.kind).toBe("source-original");
    expect(original?.byteLength, "原件必须有真实字节").toBeGreaterThan(0);
    expect(String(original?.fileName ?? "").length, "服务端必须给定安全下载名").toBeGreaterThan(0);

    // 目录里必须能看到这份登记资料；精确版本用产品深链指定（列表行只标资料标识，
    // 同一资料的历史版本共用它，无法从行文本区分）。
    await expect(window.locator("tr", { hasText: sourceId }).first()).toBeVisible({
      timeout: 60_000,
    });
    await window.goto(
      acceptanceTarget.publicOrigin +
        "/projects/documents/" +
        encodeURIComponent(sourceId) +
        "?project=" +
        encodeURIComponent(projectId) +
        "&version=" +
        encodeURIComponent(versionId),
    );
    await expect(window.getByText(`${sourceId}@${versionId}`, { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    const originalView = window.locator('section[aria-label="资料原件"]');
    await expect(originalView, "资料详情默认打开原件").toBeVisible({ timeout: 60_000 });

    // 授权原件字节：同源同会话读取同一端点，作为落盘字节的比对基准（服务端按 C04 核验）。
    const baseline = await window.evaluate(async (target) => {
      const response = await fetch(target, { credentials: "same-origin", cache: "no-store" });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      return {
        status: response.status,
        byteLength: bytes.byteLength,
        sha256: Array.from(digest)
          .map((value) => value.toString(16).padStart(2, "0"))
          .join(""),
      };
    }, originalPath + "?disposition=attachment");
    expect(baseline.status, "原件附件必须可读").toBe(200);

    const download = await captureDownloadV1(app, () =>
      originalView.getByRole("link", { name: "下载原件", exact: true }).click(),
    );
    const saved = download.bytes;
    expect(saved.byteLength, "落盘字节数必须与登记一致").toBe(original.byteLength);
    expect(saved.byteLength).toBe(baseline.byteLength);
    expect("sha256:" + createHash("sha256").update(saved).digest("hex")).toBe(
      "sha256:" + baseline.sha256,
    );
    expect(extensionOfV1(download.filename)).toBe(extensionOfV1(String(original.fileName)));

    // 越界路径：批准 origin 上的非登记地址不得产生下载，策略在下载开始前取消。
    await app.evaluate(({ session }) => {
      const probe = { seen: false, allowed: false };
      (
        globalThis as typeof globalThis & { deniedDownloadProbe: typeof probe }
      ).deniedDownloadProbe = probe;
      session.defaultSession.once("will-download", (event) => {
        probe.seen = true;
        probe.allowed = !event.defaultPrevented;
      });
    });
    await window.evaluate(
      (target) => {
        const anchor = document.createElement("a");
        anchor.href = target;
        anchor.download = "desktop-probe";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      },
      acceptanceTarget.publicOrigin +
        "/api/v1/projects/" +
        encodeURIComponent(projectId) +
        "/queries/projection.query",
    );
    await window.waitForTimeout(3_000);
    expect(
      await app.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              deniedDownloadProbe: { seen: boolean; allowed: boolean };
            }
          ).deniedDownloadProbe,
      ),
      "未登记路径的下载必须被取消",
    ).toEqual({ seen: true, allowed: false });
  } finally {
    await app.close();
  }
});

test("Agent 入口：普通业务页可打开真实任务停靠区并进入工作台", async () => {
  requireReady();
  const projectId = acceptanceTarget.acceptance.projectId;
  const operator = acceptanceTarget.credentials.operator;
  const { app, window } = await launchClientV1(envPathV1(DESKTOP_ACCEPTANCE_ENV_V1.buildConfig));
  try {
    // 只从普通业务页自然点击进入，不手工输入内部路由。
    await loginV1(
      window,
      acceptanceTarget.publicOrigin +
        "/projects/documents?project=" +
        encodeURIComponent(projectId),
      operator.loginName,
      operator.password,
    );
    await window.getByRole("button", { name: "打开停靠区", exact: true }).click();
    await window.getByRole("tab", { name: "Agent", exact: true }).click();
    const panel = window.locator('[role="tabpanel"][aria-label="Agent"]');
    await expect(panel, "普通业务页必须能到达 Agent 停靠区").toBeVisible({ timeout: 30_000 });

    // 真实任务事实：要么列出本工程登记任务，要么是真实空态；加载中与读取失败都不算到达。
    const tasks = panel.locator('section[aria-label="当前工程的 Agent 任务"]');
    const taskButton = tasks.locator("button.agent-dock-task").first();
    const emptyState = tasks.getByText("当前工程暂无 Agent 任务。");
    await expect
      .poll(async () => (await taskButton.count()) + (await emptyState.count()), {
        timeout: 60_000,
        message: "Agent 停靠区必须读到登记任务或真实空态",
      })
      .toBeGreaterThan(0);

    if ((await taskButton.count()) > 0) {
      const taskEntityId = (await taskButton.locator("span.agent-dock-task-ref").innerText())
        .split("·")[0]
        .trim();
      await taskButton.click();
      await expect(
        panel.locator('section[aria-label="当前任务摘要"]'),
        "选中后必须与工作台/详情共用同一精确任务",
      ).toContainText(taskEntityId, { timeout: 60_000 });
    }
    await expect(panel.getByRole("link", { name: /打开工作台/ })).toBeVisible();
  } finally {
    await app.close();
  }
});

test("TLS 拒绝：不可信证书的 origin 只落到本地连接状态页", async () => {
  requireReady();
  const dir = makeTempDirV1("riskflow-desktop-tls-");
  const configPath = join(dir, "desktop-config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      ...acceptanceTarget.desktopConfig,
      publicOrigin: acceptanceTarget.acceptance.invalidCertificateOrigin,
    }),
  );

  const { app, window } = await launchClientV1(configPath);
  try {
    const failureCode = await app.evaluate(({ BrowserWindow }, origin) => {
      const target = BrowserWindow.getAllWindows()[0];
      return new Promise<number>((resolve) => {
        target.webContents.once("did-fail-load", (_event, code) => resolve(code));
        void target.loadURL(origin).catch(() => undefined);
      });
    }, acceptanceTarget.acceptance.invalidCertificateOrigin);
    expect(failureCode, "必须是证书拒绝，连接/DNS失败不能替代").toBeLessThanOrEqual(-200);
    expect(failureCode).toBeGreaterThan(-300);
    await expect(
      window.getByRole("heading", { name: "暂时无法连接 RiskFlow" }),
      "证书不可信时必须落到本地连接状态页",
    ).toBeVisible({ timeout: 60_000 });
    const url = new URL(window.url());
    expect(url.protocol).toBe("file:");
    expect(url.pathname.endsWith("connection.html")).toBe(true);
    expect(
      window.url().startsWith(acceptanceTarget.acceptance.invalidCertificateOrigin),
      "客户端不得停在被拒绝的 origin 上",
    ).toBe(false);
    // 连接状态页只保留显式重试目标，且重试目标仍是配置里的 origin。
    expect(url.searchParams.get("message")?.length ?? 0).toBeGreaterThan(0);
    expect(url.searchParams.get("retry")).toBe(
      acceptanceTarget.acceptance.invalidCertificateOrigin,
    );
    expect(await window.locator(LOGIN_GATE_V1).count(), "不得进入业务登录面").toBe(0);
  } finally {
    await app.close();
  }
});

test("越界导航：主框架导航与新窗口被拒绝，页面仍停在批准 origin", async () => {
  requireReady();
  const operator = acceptanceTarget.credentials.operator;
  const unapprovedOrigin = acceptanceTarget.acceptance.unapprovedOrigin;
  const { app, window } = await launchClientV1(envPathV1(DESKTOP_ACCEPTANCE_ENV_V1.buildConfig));
  try {
    const visited: string[] = [];
    window.on("framenavigated", (frame) => {
      if (frame === window.mainFrame()) visited.push(frame.url());
    });
    await loginV1(
      window,
      acceptanceTarget.publicOrigin + "/overview",
      operator.loginName,
      operator.password,
    );

    // 页面自己发起的越界导航（等价于点击外链）。
    await window.evaluate((target) => {
      window.location.href = target;
    }, unapprovedOrigin);
    await window.waitForTimeout(3_000);
    expect(
      visited.some((url) => url.startsWith(unapprovedOrigin)),
      "主框架不得导航到未批准 origin",
    ).toBe(false);
    expect(new URL(window.url()).origin).toBe(new URL(acceptanceTarget.publicOrigin).origin);
    await expect
      .poll(() => window.getByRole("heading", { level: 1 }).isVisible(), {
        message: "越界被拒后页面仍可用",
      })
      .toBe(true);

    // 新窗口一律拒绝：外链不交给系统浏览器，也不产生第二个窗口。
    const denied = await window.evaluate(
      (target) => window.open(target) === null,
      unapprovedOrigin,
    );
    expect(denied, "新窗口必须被拒绝").toBe(true);
    expect(app.windows().length).toBe(1);
  } finally {
    await app.close();
  }
});

test("SSE：按正式游标重连且不重发写命令", async () => {
  requireReady();
  const projectId = acceptanceTarget.acceptance.projectId;
  const operator = acceptanceTarget.credentials.operator;
  const workflowRunRef = acceptanceTarget.bindings.workflowRunRef;
  const { app, window } = await launchClientV1(envPathV1(DESKTOP_ACCEPTANCE_ENV_V1.buildConfig));
  try {
    const commandWrites: string[] = [];
    const streams: Array<{ url: string; status: number; contentType: string }> = [];
    window.on("request", (request) => {
      if (request.method() !== "GET" && request.url().includes("/commands/")) {
        commandWrites.push(request.url());
      }
    });
    window.on("response", (response) => {
      if (response.url().includes("/runs/") && response.url().includes("/events")) {
        streams.push({
          url: response.url(),
          status: response.status(),
          contentType: String(response.headers()["content-type"] ?? ""),
        });
      }
    });

    await loginV1(
      window,
      acceptanceTarget.publicOrigin + "/overview",
      operator.loginName,
      operator.password,
    );
    const eventsUrl =
      acceptanceTarget.publicOrigin +
      "/api/v1/projects/" +
      encodeURIComponent(projectId) +
      "/runs/" +
      Buffer.from(
        JSON.stringify({
          entityId: workflowRunRef.reference.entityId.trim(),
          versionId: workflowRunRef.reference.versionId.trim(),
        }),
      ).toString("base64url") +
      "/events";

    const first = await probeRunEventsV1(window, eventsUrl, undefined, 2);
    expect(
      first.eventIds.length,
      "同次运行的正式事件流必须送出现已登记事件（probe=" + first.state + "）",
    ).toBeGreaterThan(0);
    expect(new Set(first.runIds)).toEqual(
      new Set([`${workflowRunRef.reference.entityId}@${workflowRunRef.reference.versionId}`]),
    );
    const cursor = first.eventIds[first.eventIds.length - 1];

    // 断线重连：从正式游标继续，已收到的标识不得重放。
    const resumed = await probeRunEventsV1(window, eventsUrl, cursor, 2);
    expect(resumed.state, "重连必须实际读到后续正式事件").toBe("events");
    expect(resumed.eventIds.length).toBeGreaterThan(0);
    expect(new Set(resumed.runIds)).toEqual(new Set(first.runIds));
    expect(new Set(resumed.eventIds).size).toBe(resumed.eventIds.length);
    expect(resumed.eventIds, "游标之前的事件不得重发").not.toContain(cursor);
    for (const eventId of resumed.eventIds) {
      expect(first.eventIds).not.toContain(eventId);
    }

    expect(
      streams.some(
        (stream) => stream.status === 200 && stream.contentType.includes("text/event-stream"),
      ),
      "事件流必须来自正式 SSE 端点",
    ).toBe(true);
    expect(commandWrites, "重连不得自动重发写命令").toEqual([]);
  } finally {
    await app.close();
  }
});

test("撤权：管理会话修订成员状态后，业务会话的同次读取立即关闭", async () => {
  requireReady();
  const projectId = acceptanceTarget.acceptance.projectId;
  const operator = acceptanceTarget.credentials.operator;
  const administrator = acceptanceTarget.credentials.administrator;
  const exportArtifactRef = {
    kind: "export-artifact",
    reference: acceptanceTarget.acceptance.downloadArtifactRef.reference,
  };
  const artifactId = acceptanceTarget.acceptance.downloadArtifactRef.reference.entityId;

  const operatorSession = await launchClientV1(envPathV1(DESKTOP_ACCEPTANCE_ENV_V1.buildConfig));
  const administratorSession = await launchClientV1(
    envPathV1(DESKTOP_ACCEPTANCE_ENV_V1.buildConfig),
  );
  let membershipChanged = false;
  try {
    await loginV1(
      operatorSession.window,
      acceptanceTarget.acceptance.sharedObjectUrl,
      operator.loginName,
      operator.password,
    );
    const before = await queryV1(
      operatorSession.window,
      projectId,
      "projection.report-read",
      { kind: "artifact", exportArtifactRef },
      acceptanceTarget.bindings.reportSourceVersionRefs,
    );
    expect(before.status, "撤权前同次读取必须成立").toBe(200);

    await loginV1(
      administratorSession.window,
      acceptanceTarget.publicOrigin + "/ops/access",
      administrator.loginName,
      administrator.password,
    );
    await reviseMembershipV1(administratorSession.window, projectId, operator.loginName, "removed");
    membershipChanged = true;

    const after = await queryV1(
      operatorSession.window,
      projectId,
      "projection.report-read",
      { kind: "artifact", exportArtifactRef },
      acceptanceTarget.bindings.reportSourceVersionRefs,
    );
    expect(after.status, "撤权后同一账号的同次读取必须关闭").toBe(404);
    expect(after.body?.code).toBe("NOT_FOUND");

    // 页面也按同一权限事实闭合：不再呈现已撤销对象的标识。
    await operatorSession.window.goto(acceptanceTarget.acceptance.sharedObjectUrl);
    await expect(
      operatorSession.window.locator('[data-page-state="forbidden"]'),
      "无权时页面必须收口为权限态",
    ).toBeVisible({ timeout: 60_000 });
    await expect(operatorSession.window.getByText(artifactId, { exact: true })).toHaveCount(0);

    await reviseMembershipV1(administratorSession.window, projectId, operator.loginName, "active");
    membershipChanged = false;
  } finally {
    if (membershipChanged) {
      // 断言失败也要把隔离实例恢复原状；恢复失败不得掩盖原失败。
      await reviseMembershipV1(
        administratorSession.window,
        projectId,
        operator.loginName,
        "active",
      );
    }
    await operatorSession.app.close();
    await administratorSession.app.close();
  }
});
