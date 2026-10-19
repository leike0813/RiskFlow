import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { App } from "../src/app/App.js";
import { makeSafeHttpError } from "../src/api/http.js";
import { CommandConfirmationDialog } from "../src/shared/CommandConfirmationDialog.js";
import { PageFrame } from "../src/shared/page-shells/PageFrame.js";
import {
  DetailPageShell,
  GovernancePageShell,
  ListPageShell,
  ReviewWorkbenchShell,
  RunPageShell,
} from "../src/shared/page-shells/index.js";
import type { ConfirmationStateV1 } from "../src/shared/confirmation.js";
import type { WebActionV1 } from "../src/shared/actions.js";
import { WEB_NAVIGATION_V1 } from "../src/shell/navigation.js";
import { dockContributionsV1, isEvidenceStale, RightDock } from "../src/shell/dock/RightDock.js";
import { AgentDockContent, type AgentDockViewV1 } from "../src/agent/AgentDock.js";
import type { AgentTaskRefView } from "../src/api/agentAuditOperations.js";

const metadata = {
  schemaVersion: "1" as const,
  sessionRef: { entityId: "session-1", versionId: "v1" },
  accountRef: { entityId: "account-1", versionId: "v1" },
  passwordChangeRequired: false,
  restricted: false,
  expiresAt: "2026-01-01T00:00:00.000Z",
};

const context = {
  revision: 1,
  projectId: "project-1",
  spatialScopeRef: null,
  processNodeId: null,
} as const;

const availableCapabilities = WEB_NAVIGATION_V1.map((item) => item.requiredCapability);

const action = (label: string, availability: WebActionV1["availability"]): WebActionV1 => ({
  actionId: label,
  label,
  availability,
  impact: "standard",
  invoke: () => undefined,
});

describe("C10 Web shell SSR 结构", () => {
  it("renders seven navigation entries and semantic landmarks only for authenticated users", () => {
    const authenticated = renderToStaticMarkup(
      <App
        pathname="/overview"
        session={{ kind: "authenticated", metadata }}
        context={context}
        capabilities={availableCapabilities}
      />,
    );
    expect((authenticated.match(/data-navigation=/g) ?? []).length).toBe(7);
    expect(authenticated).toContain('aria-label="业务导航"');
    expect(authenticated).toContain('aria-label="上下文与 Agent 停靠区"');
    expect((authenticated.match(/id="main-heading"/g) ?? []).length).toBe(1);
    expect(authenticated).toContain('data-page-state="unavailable"');
    expect(authenticated).not.toContain("Mock");

    const anonymous = renderToStaticMarkup(
      <App pathname="/overview" session={{ kind: "anonymous" }} />,
    );
    expect(anonymous).not.toContain("data-navigation=");
    expect(anonymous).toContain('autoComplete="username"');

    const restricted = renderToStaticMarkup(
      <App pathname="/overview" session={{ kind: "restricted", metadata }} />,
    );
    expect(restricted).not.toContain("data-navigation=");
    expect(restricted).not.toContain("context-bar");
  });

  it("separates missing context, forbidden capability and unavailable route states", () => {
    const noProject = renderToStaticMarkup(
      <App
        pathname="/overview"
        session={{ kind: "authenticated", metadata }}
        capabilities={availableCapabilities}
      />,
    );
    expect(noProject).toContain('data-page-state="empty"');

    const forbidden = renderToStaticMarkup(
      <App
        pathname="/overview"
        session={{ kind: "authenticated", metadata }}
        context={context}
        capabilities={[]}
      />,
    );
    expect(forbidden).toContain('data-page-state="forbidden"');
    expect(forbidden).not.toContain("route-missing");

    const notFound = renderToStaticMarkup(
      <App
        pathname="/outside"
        session={{ kind: "authenticated", metadata }}
        context={context}
        capabilities={availableCapabilities}
      />,
    );
    expect(notFound).toContain('data-page-state="unavailable"');
    expect(notFound).toContain("not-found");
  });

  it("shares seven page states across all five single-region shells", () => {
    const states = [
      { kind: "idle" as const },
      { kind: "loading" as const, previous: null },
      { kind: "ready" as const, value: "value" },
      { kind: "empty" as const },
      { kind: "error" as const, error: makeSafeHttpError({ requestId: "safe-id" }) },
      { kind: "forbidden" as const, requiredCapability: "projection.query" as const },
      { kind: "unavailable" as const, reasons: [{ code: "route-missing" }] },
    ];
    const shells = [
      (state: (typeof states)[number]) => <ListPageShell title="列表" state={state} />,
      (state: (typeof states)[number]) => <DetailPageShell title="详情" state={state} />,
      (state: (typeof states)[number]) => <RunPageShell title="运行" state={state} />,
      (state: (typeof states)[number]) => <GovernancePageShell title="治理" state={state} />,
      (state: (typeof states)[number]) => <ReviewWorkbenchShell title="复核" state={state} />,
    ];
    for (const state of states) {
      for (const shell of shells) {
        const html = renderToStaticMarkup(shell(state));
        expect(html).toContain(`data-page-state="${state.kind}"`);
      }
    }
    const loading = renderToStaticMarkup(
      <PageFrame
        title="列表"
        state={{ kind: "loading", previous: null }}
        regions={[{ descriptor: { key: "list", kind: "list" }, content: "ready-body" }]}
      />,
    );
    expect(loading).toContain("page-skeleton");
    expect(loading).not.toContain("暂无可显示内容");
    // 加载占位不先渲染旧区域内容，避免先闪现为空态或旧数据。
    expect(loading).not.toContain("ready-body");
    const empty = renderToStaticMarkup(
      <PageFrame
        title="列表"
        state={{ kind: "empty" }}
        regions={[{ descriptor: { key: "list", kind: "list" }, content: "ready-body" }]}
        actions={[
          action("allowed-action", { kind: "allowed" }),
          action("forbidden-action", {
            kind: "forbidden",
            requiredPermission: { kind: "business", capability: "projection.query" },
          }),
          action("hidden-action", { kind: "hidden" }),
        ]}
      />,
    );
    expect(empty).toContain("allowed-action");
    expect(empty).not.toContain("forbidden-action");
    // hidden 完全不渲染，不用 disabled 透露目标存在。
    expect(empty).not.toContain("hidden-action");
    expect(empty).not.toContain("ready-body");
    const secret = renderToStaticMarkup(
      <PageFrame
        title="错误"
        state={{
          kind: "error",
          error: makeSafeHttpError({ requestId: "safe-id" }),
        }}
        regions={[{ descriptor: { key: "list", kind: "list" }, content: "ready-body" }]}
      />,
    );
    expect(secret).not.toContain("database password");
    // 页面级失败不保留任何旧区域。
    expect(secret).not.toContain("ready-body");
  });

  it("按序输出多个区域组合，区域顺序与失败互不掩盖", () => {
    const html = renderToStaticMarkup(
      <PageFrame
        title="风险态势"
        state={{ kind: "ready", value: { recorded: 3 } }}
        regions={[
          {
            descriptor: { key: "summary", kind: "detail" },
            content: (value: { recorded: number }) => <p>已入库 {value.recorded}</p>,
          },
          {
            descriptor: { key: "distribution", kind: "list" },
            content: <p>分布表</p>,
          },
          {
            descriptor: { key: "trend", kind: "chart", variant: "trend" },
            content: <p>趋势</p>,
          },
          { descriptor: { key: "actions", kind: "action" }, content: <p>动作</p> },
        ]}
      />,
    );
    // 单一 h1：区域组合不再叠加骨架标题。
    expect(html.match(/<h1/g)).toHaveLength(1);
    const order = ["summary", "distribution", "trend", "actions"].map((key) =>
      html.indexOf(
        `page-region-${key === "summary" ? "detail" : key === "trend" ? "chart" : key === "actions" ? "action" : "list"}`,
      ),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
    expect(html).toContain('data-region-variant="trend"');
    // 非 chart 区域不带 variant：描述符不是自由字典。
    expect(html.match(/data-region-variant/g)).toHaveLength(1);
    expect(html).toContain("已入库 3");
  });

  it("停靠贡献按入口资格独立筛选，不要求两类能力交集", () => {
    // 未知资格：保留两个位置与原因，而不是假装无权。
    expect(dockContributionsV1(undefined)).toEqual(["context", "agent"]);
    // 只授予助手：待办入口未交付，因此只有助手位置；两者互不依赖。
    expect(dockContributionsV1(["agent-task.read"])).toEqual(["context", "agent"]);
    // 只授予待办入口：助手页签不再提供，上下文证据槽仍保留。
    expect(dockContributionsV1(["review-todo.read"])).toEqual(["context"]);
    // 两个入口权都没有：只保留上下文位置，不渲染空待办或假计数。
    expect(dockContributionsV1([])).toEqual(["context"]);

    const denied = renderToStaticMarkup(
      <RightDock
        initialPanel="agent"
        capabilities={[]}
        agentContribution={{ kind: "ready", slot: () => <span>agent-body</span> }}
      />,
    );
    // 被拒的助手页签既不出现，也不显示其内容。
    expect(denied).not.toContain("agent-body");
    expect(denied).not.toContain('role="tab"');
    expect(denied).toContain("打开停靠区");
  });

  it("renders typed confirmation semantics without exposing arbitrary payload text", () => {
    const state: ConfirmationStateV1<{ projectId: string }> = {
      kind: "reviewing",
      plan: {
        confirmationId: "confirmation-1",
        operationId: "test.command",
        scope: {
          kind: "project",
          projectId: "project-1",
          contextRevision: 1,
          sessionRef: { entityId: "session-1", versionId: "1" },
        },
        targets: [
          { kind: "project-revision", reference: { entityId: "project-1", versionId: "v1" } },
        ],
        inputVersions: [{ entityId: "source-1", versionId: "v1" }],
        expectedFacts: ["fact-ref"],
        externalEffects: ["external-effect"],
        impact: "high",
        commandId: "command-1",
        idempotencyKey: "idempotency-1",
        request: { projectId: "project-1" },
      },
      acknowledged: false,
    };
    const html = renderToStaticMarkup(
      <CommandConfirmationDialog
        state={state}
        availability={{ kind: "allowed" }}
        requiredPermission={{ kind: "business", capability: "projection.query" }}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain("<dialog");
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("fact-ref");
    expect(html).not.toContain("raw-model-output");
  });

  it("keeps evidence and Agent in the shared dock without exposing redacted body", () => {
    const redacted = renderToStaticMarkup(
      <RightDock
        initialPanel="context"
        contextRevision={2}
        evidenceContextRevision={2}
        evidence={{
          kind: "redacted",
          sourceName: "source-name",
          chapterPath: "chapter/path",
          sourceSegmentId: "source-1-chapter-1-segment-1",
        }}
        agentContribution={{ kind: "unavailable" }}
      />,
    );
    expect(redacted).toContain('data-evidence-kind="redacted"');
    expect(redacted).not.toContain("secret source body");
    expect(redacted).toContain('role="tablist"');
    const agent = renderToStaticMarkup(
      <RightDock initialPanel="agent" agentContribution={{ kind: "unavailable" }} />,
    );
    expect(agent).toContain('data-dock-state="unavailable"');
    const readyAgent = renderToStaticMarkup(
      <RightDock
        initialPanel="agent"
        agentContribution={{
          kind: "ready",
          slot: () => <span data-agent-task="agent-task">已审计任务</span>,
        }}
      />,
    );
    expect(readyAgent).toContain('data-agent-task="agent-task"');
    const full = renderToStaticMarkup(
      <RightDock
        initialPanel="context"
        evidenceContextRevision={1}
        contextRevision={2}
        evidence={{
          kind: "full",
          sourceName: "source-name",
          chapterPath: "chapter/path",
          sourceSegmentId: "source-1-chapter-1-segment-1",
          body: "secret source body",
        }}
      />,
    );
    expect(full).not.toContain("secret source body");
    const unscoped = renderToStaticMarkup(
      <RightDock
        initialPanel="context"
        contextRevision={2}
        evidence={{
          kind: "full",
          sourceName: "source-name",
          chapterPath: "chapter/path",
          sourceSegmentId: "source-1-chapter-1-segment-1",
          body: "unscoped source body",
        }}
      />,
    );
    expect(unscoped).not.toContain("unscoped source body");
  });
});

describe("C10 Web 会话恢复外壳", () => {
  it("keeps the shell on the original deep link while the session is being restored", () => {
    const checking = renderToStaticMarkup(
      <App
        pathname="/quality/assessment?project=project-1&revision=project-1@rev-1"
        session={{ kind: "checking" }}
        context={context}
        capabilities={availableCapabilities}
        onRetrySessionRestore={() => undefined}
      />,
    );
    expect(checking).toContain('data-session-state="checking"');
    // 恢复完成前既不跳登录页，也不发业务查询：没有导航、没有工程门禁结果。
    expect(checking).not.toContain("data-navigation=");
    expect(checking).not.toContain('autoComplete="username"');
    expect(checking).not.toContain('data-page-state="');
  });

  it("offers a restore retry on restore failure instead of falling back to anonymous", () => {
    const failed = renderToStaticMarkup(
      <App
        pathname="/quality/assessment?project=project-1&revision=project-1@rev-1"
        session={{ kind: "failed", error: makeSafeHttpError({ code: "TRANSIENT_FAILURE" }) }}
        onRetrySessionRestore={() => undefined}
      />,
    );
    expect(failed).toContain('data-session-state="failed"');
    expect(failed).toContain('data-session-retry="restore"');
    expect(failed).not.toContain("disabled");
    // 技术故障不得当匿名：既不给登录表单，也不给业务外壳。
    expect(failed).not.toContain('autoComplete="username"');
    expect(failed).not.toContain("data-navigation=");

    const withoutRetry = renderToStaticMarkup(
      <App pathname="/overview" session={{ kind: "failed", error: makeSafeHttpError({}) }} />,
    );
    expect(withoutRetry).toContain('data-session-state="failed"');
    expect(withoutRetry).toContain("disabled");
  });

  it("routes a restored session that still must change password to the change password form", () => {
    const mustChange = renderToStaticMarkup(
      <App
        pathname="/quality/assessment?project=project-1&revision=project-1@rev-1"
        session={{ kind: "restricted", metadata: { ...metadata, passwordChangeRequired: true } }}
        context={context}
        capabilities={availableCapabilities}
        onChangePassword={() => undefined}
      />,
    );
    expect(mustChange).toContain('autoComplete="new-password"');
    expect(mustChange).not.toContain("data-navigation=");
    expect(mustChange).not.toContain('data-session-state="restricted"');

    const restrictedOnly = renderToStaticMarkup(
      <App
        pathname="/overview"
        session={{ kind: "restricted", metadata: { ...metadata, restricted: true } }}
        context={context}
        capabilities={availableCapabilities}
      />,
    );
    expect(restrictedOnly).toContain('data-session-state="restricted"');
    expect(restrictedOnly).not.toContain("data-navigation=");
  });
});

/** 停靠区 Agent 标签的真实内容：与工作台、任务详情读同一份共享任务事实。 */
describe("停靠区 Agent 内容槽", () => {
  const taskRef: AgentTaskRefView = {
    kind: "agent-task",
    reference: { entityId: "agent-task-1", versionId: "v1" },
    taskType: "data-cleaning",
    triggerMode: "embedded",
    modelDeploymentRef: { entityId: "model-1", versionId: "v1" },
    promptTemplateRef: { entityId: "prompt-1", versionId: "v1" },
    toolPolicyRef: { entityId: "tools-1", versionId: "v1" },
    budgetPolicyRef: { entityId: "budget-1", versionId: "v1" },
    incrementSchemaRef: { entityId: "increment-1", versionId: "v1" },
    validationPolicyRef: { entityId: "validation-1", versionId: "v1" },
  };

  const renderDock = (view: AgentDockViewV1): string =>
    renderToStaticMarkup(
      <MemoryRouter>
        <AgentDockContent view={view} projectPath={(path) => path} onSelectTask={() => undefined} />
      </MemoryRouter>,
    );

  it("未选任务时列出当前工程的真实任务并保留工作台入口", () => {
    const html = renderDock({
      list: {
        asOfRecordedAt: "2026-10-15T00:00:00.000Z",
        items: [
          {
            agentTaskRef: taskRef,
            status: "completed",
            taskVersion: 3,
            initiatorActorId: "account-1",
            parentRunRef: {
              kind: "workflow-run",
              reference: { entityId: "run-1", versionId: "v1" },
            },
            frozenInputRef: {
              kind: "cleaning-input",
              reference: { entityId: "input-1", versionId: "v1" },
            },
            createdAt: "2026-10-14T00:00:00.000Z",
            updatedAt: "2026-10-15T00:00:00.000Z",
          },
        ],
      },
      taskRef: undefined,
      detail: undefined,
      loading: false,
      error: "",
    });
    expect(html).toContain("agent-task-1");
    expect(html).toContain("已完成");
    expect(html).toContain("数据清洗与部分可用判断");
    expect(html).toContain('href="/agent"');
  });

  it("当前工程没有任务时呈现诚实空态，不伪造任务", () => {
    const html = renderDock({
      list: { asOfRecordedAt: "2026-10-15T00:00:00.000Z", items: [] },
      taskRef: undefined,
      detail: undefined,
      loading: false,
      error: undefined,
    });
    expect(html).toContain("当前工程暂无 Agent 任务。");
    expect(html).not.toContain("agent-task-1");
  });

  it("没有证据不触发自动关闭，只有证据确实过期才收起", () => {
    // 业务页本来就没有证据，收起面板会连 Agent 标签一起挡住。
    expect(isEvidenceStale(undefined, false)).toBe(false);
    expect(isEvidenceStale(undefined, true)).toBe(false);
    const evidence = {
      kind: "redacted" as const,
      sourceName: "source-name",
      chapterPath: "chapter/path",
      sourceSegmentId: "source-1-chapter-1-segment-1",
    };
    expect(isEvidenceStale(evidence, true)).toBe(false);
    expect(isEvidenceStale(evidence, false)).toBe(true);
  });
});
