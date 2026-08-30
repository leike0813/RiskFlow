import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { navItems, notificationCount, projectContext, type NavKey } from '../content/context'
import { Icon, type IconName } from './icons'
import { EvidenceProvider } from './EvidenceDrawer'
import { AgentDock } from '../agent/AgentDock'
import { toggleAgentDock, useAgentDockOpen } from '../agent/agentDockStore'
import './AppShell.css'

const navIcons: Record<NavKey, IconName> = {
  overview: 'overview',
  project: 'project',
  identification: 'identification',
  assessment: 'assessment',
  warnings: 'warnings',
  knowledge: 'knowledge',
  review: 'review',
}

/**
 * 全局应用框架：左侧导航（224px）+ 顶部工程上下文栏（68px）+ 主工作区。
 * 内部挂载证据抽屉（EvidenceProvider）与 Agent 停靠栏（AgentDock）。
 *
 * @param activeNav 当前一级导航；/agent 全屏工作台传 null
 * @param agentContext 传入 Agent 停靠栏头部的上下文标签
 */
export default function AppShell({
  activeNav,
  agentContext,
  children,
}: {
  activeNav: NavKey | null
  agentContext?: string[]
  children: ReactNode
}) {
  const dockOpen = useAgentDockOpen()
  const location = useLocation()
  const agentActive = dockOpen || location.pathname === '/agent'

  return (
    <EvidenceProvider>
      <div className="shell">
        <aside className="shell-nav">
          <div className="shell-brand">
            <div className="shell-brand-name">RiskFlow</div>
            <div className="shell-brand-sub">风险智能识别与评估系统</div>
          </div>
          <nav className="shell-menu">
            {navItems.map((item) => (
              <Link
                key={item.key}
                to={item.to}
                className={`shell-menu-item${activeNav === item.key ? ' shell-menu-item--active' : ''}`}
              >
                <Icon name={navIcons[item.key]} size={18} />
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>

        <header className="shell-topbar">
          <div className="shell-context">
            <span className="shell-context-item">当前工程：{projectContext.project}</span>
            <span className="shell-context-item">当前区段：{projectContext.section}</span>
            <span className="shell-context-item">当前工序：{projectContext.process}</span>
            <span className="shell-context-item mono">数据时点：{projectContext.dataTimestamp}</span>
          </div>
          <div className="shell-actions">
            <button type="button" className="shell-icon-btn" aria-label="通知">
              <Icon name="bell" size={18} />
              <span className="shell-badge">{notificationCount}</span>
            </button>
            <button
              type="button"
              className={`shell-agent-btn${agentActive ? ' shell-agent-btn--active' : ''}`}
              onClick={toggleAgentDock}
            >
              <Icon name="agent" size={16} />
              智能 Agent
            </button>
          </div>
        </header>

        <main className="shell-main">{children}</main>

        <AgentDock context={agentContext} />
      </div>
    </EvidenceProvider>
  )
}
