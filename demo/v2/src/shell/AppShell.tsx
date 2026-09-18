// 应用外壳：三列（16rem 导航 + 主区 + 22rem 停靠区），≤64rem 塌两列。
// 结构与 a11y 对齐生产 apps/web/src/shell/AppShell.tsx：
// skip-link、focusMainHeading、aria-live 状态播报、能力三态导航。
// 顶部通栏预留 Electron 可拖拽安全区样式钩子（data-drag-region）。

import { useEffect, useState, type ReactNode } from 'react';
import { capabilityStateFor } from '../app/capabilities';
import type { NavigationId } from '../app/routes';
import type { ShellContext } from '../app/state';
import { Icon } from '../components/icons';
import {
  SHELL_PROCESS_OPTIONS,
  SHELL_PROJECT_OPTIONS,
  SHELL_SPATIAL_OPTIONS,
} from '../content/shell-context';
import { focusMainHeading } from '../shared/focus';
import { RightDock, type DockPanel } from './dock/RightDock';
import { NAVIGATION_ITEMS } from './navigation';
import './AppShell.css';

export interface ContextSelection {
  readonly projectId: string | null;
  readonly spatialScopeRef: string | null;
  readonly processNodeId: string | null;
}

export interface AppShellProps {
  readonly pathname: string;
  readonly title: string;
  readonly activeSection: NavigationId | null;
  /** null 表示权限检查结果未知（导航渲染 unknown 态）。 */
  readonly capabilities: ReadonlySet<string> | null;
  readonly context: ShellContext;
  readonly onContextChange: (selection: ContextSelection) => void;
  readonly onNavigate: (path: string) => void;
  readonly children: ReactNode;
}

function NavigationList({
  activeSection,
  capabilities,
  onNavigate,
}: Pick<AppShellProps, 'activeSection' | 'capabilities' | 'onNavigate'>) {
  return (
    <ul>
      {NAVIGATION_ITEMS.map((item) => {
        const permission = capabilityStateFor(item.requiredCapability, capabilities);
        const active = activeSection === item.id;
        if (permission !== 'allowed') {
          return (
            <li key={item.id}>
              <span
                role="link"
                aria-disabled="true"
                tabIndex={0}
                data-navigation={item.id}
                data-navigation-state={permission}
                aria-describedby={`nav-reason-${item.id}`}
              >
                <Icon name={item.icon} size={18} />
                {item.label}
              </span>
              <span id={`nav-reason-${item.id}`} className="visually-hidden">
                {permission === 'unknown' ? '权限检查中' : `需要能力 ${item.requiredCapability}`}
              </span>
            </li>
          );
        }
        return (
          <li key={item.id}>
            <a
              href={`#${item.path}`}
              aria-current={active ? 'page' : undefined}
              data-navigation={item.id}
              data-navigation-state="allowed"
              onClick={(event) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                onNavigate(item.path);
              }}
            >
              <Icon name={item.icon} size={18} />
              {item.label}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function ContextSelectors({
  context,
  onContextChange,
}: Pick<AppShellProps, 'context' | 'onContextChange'>) {
  return (
    <div className="context-bar" aria-label="工程上下文">
      <label>
        工程
        <select
          value={context.projectId ?? ''}
          onChange={(event) =>
            onContextChange({
              projectId: event.currentTarget.value || null,
              spatialScopeRef: null,
              processNodeId: null,
            })
          }
        >
          <option value="">未选择工程</option>
          {SHELL_PROJECT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        空间区段
        <select
          value={context.spatialScopeRef ?? ''}
          disabled={context.projectId === null}
          onChange={(event) =>
            onContextChange({
              projectId: context.projectId,
              spatialScopeRef: event.currentTarget.value || null,
              processNodeId: null,
            })
          }
        >
          <option value="">未选择空间区段</option>
          {SHELL_SPATIAL_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        工序节点
        <select
          value={context.processNodeId ?? ''}
          disabled={context.projectId === null}
          onChange={(event) =>
            onContextChange({
              projectId: context.projectId,
              spatialScopeRef: context.spatialScopeRef,
              processNodeId: event.currentTarget.value || null,
            })
          }
        >
          <option value="">未选择工序节点</option>
          {SHELL_PROCESS_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function AppShell({
  pathname,
  title,
  activeSection,
  capabilities,
  context,
  onContextChange,
  onNavigate,
  children,
}: AppShellProps) {
  const [dockPanel, setDockPanel] = useState<DockPanel>('closed');

  useEffect(() => {
    focusMainHeading();
  }, [pathname, context.revision]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主内容
      </a>
      <header className="app-header" data-drag-region="true">
        <div className="app-header-brand">
          <p className="app-header-title">RiskFlow</p>
          <p className="app-header-subtitle">风险智能识别与评估系统</p>
        </div>
        <ContextSelectors context={context} onContextChange={onContextChange} />
        <div className="app-header-meta" aria-label="用户入口">
          <button type="button" className="app-header-icon-btn" disabled aria-disabled="true" aria-label="通知">
            <Icon name="bell" size={18} />
          </button>
          <button
            type="button"
            className="app-header-agent-btn"
            aria-pressed={dockPanel === 'agent'}
            onClick={() => setDockPanel(dockPanel === 'agent' ? 'closed' : 'agent')}
          >
            <Icon name="agent" size={16} />
            智能 Agent
          </button>
          <button type="button" className="app-header-icon-btn" disabled aria-disabled="true">
            用户
          </button>
        </div>
      </header>
      <nav className="app-nav" aria-label="业务导航">
        <NavigationList
          activeSection={activeSection}
          capabilities={capabilities}
          onNavigate={onNavigate}
        />
      </nav>
      <main id="main-content" className="app-main" aria-labelledby="main-heading">
        <h1 id="main-heading" tabIndex={-1}>
          {title}
        </h1>
        <p className="visually-hidden" role="status" aria-live="polite">
          {title}
        </p>
        {children}
      </main>
      <RightDock
        panel={dockPanel}
        onPanelChange={setDockPanel}
        contextContent={
          <dl className="dock-context-summary">
            <div>
              <dt>工程</dt>
              <dd>{context.projectId ?? '未选择'}</dd>
            </div>
            <div>
              <dt>空间区段</dt>
              <dd>{context.spatialScopeRef ?? '未选择'}</dd>
            </div>
            <div>
              <dt>工序节点</dt>
              <dd>{context.processNodeId ?? '未选择'}</dd>
            </div>
            <div>
              <dt>上下文版本</dt>
              <dd className="mono">{context.revision}</dd>
            </div>
          </dl>
        }
        agentContent={
          <div className="dock-agent-summary">
            <p>Agent 任务摘要</p>
            <p className="mono">agent-task · AGT-001</p>
            <p>当前没有进行中的 Agent 任务。任务发起后在此跟踪进度与待确认命令。</p>
          </div>
        }
      />
    </div>
  );
}
