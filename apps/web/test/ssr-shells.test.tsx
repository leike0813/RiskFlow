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
import { isEvidenceStale, RightDock } from "../src/shell/dock/RightDock.js";
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

  it("shares seven page states across all five shell variants", () => {
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
      <PageFrame title="列表" state={{ kind: "loading", previous: null }} />,
    );
    expect(loading).toContain("page-skeleton");
    expect(loading).not.toContain("暂无可显示内容");
    const empty = renderToStaticMarkup(
      <PageFrame
        title="列表"
        state={{ kind: "empty" }}
        actions={[
          action("allowed-action", { kind: "allowed" }),
          action("forbidden-action", { kind: "forbidden", requiredCapability: "projection.query" }),
        ]}
      />,
    );
    expect(empty).toContain("allowed-action");
    expect(empty).not.toContain("forbidden-action");
    const secret = renderToStaticMarkup(
      <PageFrame
        title="错误"
        state={{
          kind: "error",
          error: makeSafeHttpError({ requestId: "safe-id" }),
        }}
      />,
    );
    expect(secret).not.toContain("database password");
  });

  it("renders typed confirmation semantics without exposing arbitrary payload text", () => {
    const state: ConfirmationStateV1<{ projectId: string }> = {
      kind: "reviewing",
      plan: {
        confirmationId: "confirmation-1",
        operationId: "test.command",
        projectId: "project-1",
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
        requiredCapability="projection.query"
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
