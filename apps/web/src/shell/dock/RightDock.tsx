import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { ContractReferenceV1 } from "@riskflow/contracts/ports";

import { decodeSafeHttpError, type SafeHttpErrorV1 } from "../../api/errors.js";
import { dockTabIndexForKey } from "../../shared/focus.js";

export type DockPanelV1 = "closed" | "context" | "agent";

export type EvidenceDockContentV1 =
  | Readonly<{
      kind: "full";
      sourceName: string;
      chapterPath: string;
      sourceSegmentId: string;
      body: string;
      monitoringSummary?: string | undefined;
    }>
  | Readonly<{
      kind: "redacted";
      sourceName: string;
      chapterPath: string;
      sourceSegmentId: string;
    }>
  | Readonly<{ kind: "error"; error: SafeHttpErrorV1 }>;

export type AgentContributionV1 =
  | Readonly<{ kind: "forbidden" }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{
      kind: "ready";
      taskRef: ContractReferenceV1;
      slot: AgentContributionSlotV1;
    }>;

export type AgentContributionSlotV1 = (
  input: Readonly<{
    taskRef?: ContractReferenceV1 | undefined;
  }>,
) => ReactNode;

export type RightDockPropsV1 = Readonly<{
  initialPanel?: DockPanelV1 | undefined;
  evidence?: EvidenceDockContentV1 | undefined;
  evidenceContextRevision?: number | undefined;
  contextRevision?: number | undefined;
  contextSummary?: ReactNode | undefined;
  versionAuditSummary?: ReactNode | undefined;
  relatedObjects?: ReactNode | undefined;
  agentContribution?: AgentContributionV1 | undefined;
  onPanelChange?: ((panel: DockPanelV1) => void) | undefined;
}>;

export const isEvidenceInContext = (
  evidenceContextRevision: number | undefined,
  contextRevision: number | undefined,
): boolean =>
  evidenceContextRevision === contextRevision &&
  (evidenceContextRevision !== undefined || contextRevision === undefined);

const SafeError = ({ error }: { error: SafeHttpErrorV1 }): ReactNode => {
  const safe = decodeSafeHttpError(error);
  return (
    <p data-dock-state="error">
      <code>{safe.code}</code>
      <span>{safe.retryable ? "可重试" : "不可重试"}</span>
      <span>{safe.requestId}</span>
    </p>
  );
};

const Evidence = ({ content }: { content: EvidenceDockContentV1 }): ReactNode => {
  if (content.kind === "error") return <SafeError error={content.error} />;
  return (
    <div className="dock-evidence" data-evidence-kind={content.kind}>
      <dl>
        <div>
          <dt>资料</dt>
          <dd>{content.sourceName}</dd>
        </div>
        <div>
          <dt>章节</dt>
          <dd>{content.chapterPath}</dd>
        </div>
        <div>
          <dt>资料段标识</dt>
          <dd>{content.sourceSegmentId}</dd>
        </div>
      </dl>
      {content.kind === "redacted" ? (
        <p data-redacted="true">资料正文已脱敏</p>
      ) : (
        <div>
          <p>{content.body}</p>
          {content.monitoringSummary === undefined ? null : <p>{content.monitoringSummary}</p>}
        </div>
      )}
    </div>
  );
};

const AgentPanel = ({
  contribution,
}: {
  contribution: AgentContributionV1 | undefined;
}): ReactNode => {
  if (contribution === undefined || contribution.kind === "unavailable")
    return <p data-dock-state="unavailable">Agent 功能当前不可用</p>;
  if (contribution.kind === "forbidden") return <p data-dock-state="forbidden">无权使用 Agent</p>;
  return (
    <div data-dock-state="ready">
      <p>Agent 任务摘要</p>
      <code>{contribution.taskRef.kind}</code>
      {contribution.slot({ taskRef: contribution.taskRef })}
    </div>
  );
};

export const RightDock = ({
  initialPanel = "closed",
  evidence,
  evidenceContextRevision,
  contextRevision,
  contextSummary,
  versionAuditSummary,
  relatedObjects,
  agentContribution,
  onPanelChange,
}: RightDockPropsV1): ReactNode => {
  const [panel, setPanel] = useState<DockPanelV1>(initialPanel);
  const openButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const previousPanel = useRef(panel);
  const evidenceInContext = isEvidenceInContext(evidenceContextRevision, contextRevision);
  const visibleEvidence = evidenceInContext ? evidence : undefined;
  useEffect(() => {
    if (panel === "closed" && previousPanel.current !== "closed")
      openButtonRef.current?.focus({ preventScroll: true });
    if (panel !== "closed" && previousPanel.current === "closed")
      panelHeadingRef.current?.focus({ preventScroll: true });
    previousPanel.current = panel;
  }, [panel]);
  useEffect(() => {
    if (!evidenceInContext && panel === "context") {
      setPanel("closed");
      onPanelChange?.("closed");
    }
  }, [evidenceInContext, onPanelChange, panel]);
  const changePanel = (next: DockPanelV1): void => {
    setPanel(next);
    onPanelChange?.(next);
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const next = dockTabIndexForKey(index, event.key, 2);
    if (next === undefined) {
      if (event.key === "Escape" && panel !== "closed") {
        event.preventDefault();
        changePanel("closed");
      }
      return;
    }
    event.preventDefault();
    changePanel(next === 0 ? "context" : "agent");
    tabRefs.current[next]?.focus();
  };
  return (
    <aside className="right-dock" aria-label="上下文与 Agent 停靠区" data-panel={panel}>
      {panel === "closed" ? (
        <button
          ref={openButtonRef}
          type="button"
          onClick={() => changePanel("context")}
          aria-controls="dock-panel"
        >
          打开停靠区
        </button>
      ) : (
        <div id="dock-panel" className="dock-panel">
          <h2 ref={panelHeadingRef} tabIndex={-1} id="dock-panel-heading">
            上下文与 Agent 停靠区
          </h2>
          <div className="dock-toolbar">
            <div role="tablist" aria-label="停靠区面板">
              {(["context", "agent"] as const).map((tab, index) => (
                <button
                  key={tab}
                  ref={(element) => {
                    tabRefs.current[index] = element;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={panel === tab}
                  aria-controls={`dock-${tab}`}
                  tabIndex={panel === tab ? 0 : -1}
                  onClick={() => changePanel(tab)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                >
                  {tab === "context" ? "上下文" : "Agent"}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => changePanel("closed")} aria-label="关闭停靠区">
              关闭
            </button>
          </div>
          {panel === "context" ? (
            <section id="dock-context" role="tabpanel" aria-label="上下文" tabIndex={0}>
              {contextSummary}
              {visibleEvidence === undefined ? null : <Evidence content={visibleEvidence} />}
              {versionAuditSummary}
              {relatedObjects}
            </section>
          ) : (
            <section id="dock-agent" role="tabpanel" aria-label="Agent" tabIndex={0}>
              <AgentPanel contribution={agentContribution} />
            </section>
          )}
        </div>
      )}
    </aside>
  );
};

export const ContextDock = RightDock;
