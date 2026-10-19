import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { ModuleCapabilityV1 } from "@riskflow/contracts/ports";

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
  | Readonly<{ kind: "ready"; slot: AgentContributionSlotV1 }>;

/**
 * Agent 内容槽：Agent 域自己读共享任务事实，外壳只负责把它放进停靠区。
 * 外壳因此不需要认识任务身份——任务引用只有一份来源，不在外壳里复制。
 */
export type AgentContributionSlotV1 = () => ReactNode;

export type RightDockPropsV1 = Readonly<{
  initialPanel?: DockPanelV1 | undefined;
  evidence?: EvidenceDockContentV1 | undefined;
  evidenceContextRevision?: number | undefined;
  contextRevision?: number | undefined;
  contextSummary?: ReactNode | undefined;
  versionAuditSummary?: ReactNode | undefined;
  relatedObjects?: ReactNode | undefined;
  agentContribution?: AgentContributionV1 | undefined;
  /** 当前工程入口能力；未就绪时为 undefined，表示资格未知而不是无权。 */
  capabilities?: readonly ModuleCapabilityV1[] | undefined;
  /** 入口能力读取的技术故障：已获准位置保留并给出重试，不解释为零事项。 */
  capabilityFailure?: Readonly<{ error: SafeHttpErrorV1; retry: () => void }> | undefined;
  onPanelChange?: ((panel: DockPanelV1) => void) | undefined;
}>;

export const isEvidenceInContext = (
  evidenceContextRevision: number | undefined,
  contextRevision: number | undefined,
): boolean =>
  evidenceContextRevision === contextRevision &&
  (evidenceContextRevision !== undefined || contextRevision === undefined);

/**
 * 证据确实过期：面板里持有一份证据，而它的上下文修订已与当前上下文对不上。
 *
 * 手里的证据为空时不算过期——业务页本来就没有证据可失效，停靠区据此收起会让
 * 「上下文」面板在每次打开时立刻关闭，连带 Agent 标签也变得难以到达。
 */
export const isEvidenceStale = (
  evidence: EvidenceDockContentV1 | undefined,
  evidenceInContext: boolean,
): boolean => evidence !== undefined && !evidenceInContext;

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
  return <div data-dock-state="ready">{contribution.slot()}</div>;
};

/**
 * CH-2 D-08：停靠贡献按入口资格独立筛选。
 *
 * 每一类贡献声明自己的入口能力位——待办读 `review-todo.read`、助手读 `agent-task.read`，
 * 上下文沿获准证据槽。两类入口权相互独立：不要求交集，单页签被拒不影响另一类。
 * 能力未知（尚未读取）保留位置与原因；已被当前工程确认拒绝时不再提供该页签。
 */
export const dockContributionsV1 = (capabilities: readonly ModuleCapabilityV1[] | undefined) =>
  (
    [
      { id: "context", requiredCapability: null },
      { id: "agent", requiredCapability: "agent-task.read" },
    ] as const
  )
    .filter(
      (contribution) =>
        contribution.requiredCapability === null ||
        capabilities === undefined ||
        capabilities.includes(contribution.requiredCapability),
    )
    .map((contribution) => contribution.id);

export const RightDock = ({
  initialPanel = "closed",
  evidence,
  evidenceContextRevision,
  contextRevision,
  contextSummary,
  versionAuditSummary,
  relatedObjects,
  agentContribution,
  capabilities,
  capabilityFailure,
  onPanelChange,
}: RightDockPropsV1): ReactNode => {
  const contributions = dockContributionsV1(capabilities);
  const [panel, setPanel] = useState<DockPanelV1>(initialPanel);
  // 已确认被拒的位置不再出现在页签里；当前页签若因此消失则回到关闭态。
  const allowedPanel = panel === "closed" || contributions.includes(panel) ? panel : "closed";
  const openButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const previousPanel = useRef(panel);
  const evidenceInContext = isEvidenceInContext(evidenceContextRevision, contextRevision);
  const visibleEvidence = evidenceInContext ? evidence : undefined;
  const staleEvidence = isEvidenceStale(evidence, evidenceInContext);
  useEffect(() => {
    if (allowedPanel === "closed" && previousPanel.current !== "closed")
      openButtonRef.current?.focus({ preventScroll: true });
    if (allowedPanel !== "closed" && previousPanel.current === "closed")
      panelHeadingRef.current?.focus({ preventScroll: true });
    previousPanel.current = allowedPanel;
  }, [allowedPanel]);
  useEffect(() => {
    if (staleEvidence && allowedPanel === "context") {
      setPanel("closed");
      onPanelChange?.("closed");
    }
  }, [staleEvidence, onPanelChange, allowedPanel]);
  const changePanel = (next: DockPanelV1): void => {
    if (next !== "closed" && !contributions.includes(next)) return;
    setPanel(next);
    onPanelChange?.(next);
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const next = dockTabIndexForKey(index, event.key, contributions.length);
    if (next === undefined) {
      if (event.key === "Escape" && panel !== "closed") {
        event.preventDefault();
        changePanel("closed");
      }
      return;
    }
    event.preventDefault();
    changePanel(contributions[next] ?? "closed");
    tabRefs.current[next]?.focus();
  };
  return (
    <aside className="right-dock" aria-label="上下文与 Agent 停靠区" data-panel={allowedPanel}>
      {allowedPanel === "closed" ? (
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
          {capabilityFailure === undefined ? null : (
            <p data-dock-state="capability-failed">
              入口能力读取失败（{capabilityFailure.error.code}）
              <button type="button" onClick={capabilityFailure.retry}>
                重试
              </button>
            </p>
          )}
          <div className="dock-toolbar">
            <div role="tablist" aria-label="停靠区面板">
              {contributions.map((tab, index) => (
                <button
                  key={tab}
                  ref={(element) => {
                    tabRefs.current[index] = element;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={allowedPanel === tab}
                  aria-controls={`dock-${tab}`}
                  tabIndex={allowedPanel === tab ? 0 : -1}
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
          {allowedPanel === "context" ? (
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
