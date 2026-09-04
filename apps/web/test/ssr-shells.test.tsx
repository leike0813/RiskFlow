import { renderToStaticMarkup } from "react-dom/server";
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
import { RightDock } from "../src/shell/dock/RightDock.js";

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
        requiredCapability="test.command"
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
  });
});
