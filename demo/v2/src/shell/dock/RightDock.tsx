// 右侧停靠区：上下文 / Agent 互斥双面板。
// 交互对齐生产 apps/web/src/shell/dock/RightDock.tsx：
// Esc 关闭、打开时焦点进入面板标题、关闭后焦点回到触发按钮、标签 roving tabindex。

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { dockTabIndexForKey } from '../../shared/focus';
import { Icon } from '../../components/icons';

export type DockPanel = 'closed' | 'context' | 'agent';

export interface RightDockProps {
  readonly panel: DockPanel;
  readonly onPanelChange: (panel: DockPanel) => void;
  readonly contextContent?: ReactNode;
  readonly agentContent?: ReactNode;
}

const TABS = ['context', 'agent'] as const;
type DockTab = (typeof TABS)[number];

const TAB_LABELS: Readonly<Record<DockTab, string>> = {
  context: '上下文',
  agent: 'Agent',
};

export function RightDock({ panel, onPanelChange, contextContent, agentContent }: RightDockProps) {
  const openButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const previousPanel = useRef(panel);

  useEffect(() => {
    if (panel === 'closed' && previousPanel.current !== 'closed') {
      openButtonRef.current?.focus({ preventScroll: true });
    }
    if (panel !== 'closed' && previousPanel.current === 'closed') {
      panelHeadingRef.current?.focus({ preventScroll: true });
    }
    previousPanel.current = panel;
  }, [panel]);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const next = dockTabIndexForKey(index, event.key, TABS.length);
    if (next === undefined) return;
    event.preventDefault();
    onPanelChange(TABS[next]);
    tabRefs.current[next]?.focus();
  };

  const onAsideKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape' && panel !== 'closed') {
      event.preventDefault();
      onPanelChange('closed');
    }
  };

  return (
    <aside
      className="right-dock"
      aria-label="上下文与 Agent 停靠区"
      data-panel={panel}
      onKeyDown={onAsideKeyDown}
    >
      {panel === 'closed' ? (
        <button
          ref={openButtonRef}
          type="button"
          className="dock-open-btn"
          onClick={() => onPanelChange('context')}
          aria-controls="dock-panel"
        >
          打开停靠区
        </button>
      ) : (
        <div id="dock-panel" className="dock-panel">
          <h2 ref={panelHeadingRef} tabIndex={-1} className="dock-panel-heading">
            上下文与 Agent 停靠区
          </h2>
          <div className="dock-toolbar">
            <div role="tablist" aria-label="停靠区面板">
              {TABS.map((tab, index) => (
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
                  onClick={() => onPanelChange(tab)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                >
                  {TAB_LABELS[tab]}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="dock-close-btn"
              onClick={() => onPanelChange('closed')}
              aria-label="关闭停靠区"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
          {panel === 'context' ? (
            <section id="dock-context" role="tabpanel" aria-label="上下文" tabIndex={0}>
              {contextContent}
            </section>
          ) : (
            <section id="dock-agent" role="tabpanel" aria-label="Agent" tabIndex={0}>
              {agentContent}
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
