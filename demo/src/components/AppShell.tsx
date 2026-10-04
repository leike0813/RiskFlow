import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { navItems, type NavKey } from '../content/context'
import { searchWithSelector, useEngineering, useSession } from '../api/context'
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

const CONTEXT_STATUS_LABEL: Record<string, string> = {
  preparing: '上下文准备中',
  active: '上下文已生效',
}

/** 顶栏工程切换：手输工程标识写回 URL 参数，页面停留原地按新工程重新加载。 */
function EngineeringSwitcher() {
  const { selector } = useEngineering()
  const [searchParams, setSearchParams] = useSearchParams()
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const project = draft.trim()
    if (project.length === 0) return
    setSearchParams(searchWithSelector(`?${searchParams.toString()}`, { project }))
    setEditing(false)
    setDraft('')
  }

  if (!editing) {
    return (
      <button type="button" className="shell-switch-btn" onClick={() => setEditing(true)}>
        {selector.projectId === null ? '选择工程' : '切换工程'}
      </button>
    )
  }
  return (
    <form className="shell-switch-form" onSubmit={onSubmit}>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="工程标识"
        aria-label="工程标识"
      />
      <button type="submit" className="shell-switch-btn">
        确定
      </button>
    </form>
  )
}

/**
 * 全局应用框架：左侧导航（224px）+ 顶部工程上下文栏（68px）+ 主工作区。
 * 顶栏工程事实由 context-read 驱动；内部挂载证据抽屉（EvidenceProvider）与 Agent 停靠栏。
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
  const { state: sessionState, logout, logoutFailed } = useSession()
  const { selector, state: engineering } = useEngineering()

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
                to={{ pathname: item.to, search: location.search }}
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
            {selector.projectId === null ? (
              <span className="shell-context-item">未选择工程</span>
            ) : (
              <>
                <span className="shell-context-item">当前工程：{selector.projectId}</span>
                {engineering.kind === 'ready' && (
                  <>
                    <span className="shell-context-item">
                      {CONTEXT_STATUS_LABEL[engineering.value.contextStatus] ??
                        engineering.value.contextStatus}
                    </span>
                    {engineering.value.currentProjectRevisionRef !== undefined && (
                      <span className="shell-context-item mono">
                        修订：{engineering.value.currentProjectRevisionRef.reference.versionId}
                      </span>
                    )}
                  </>
                )}
                {engineering.kind === 'loading' && (
                  <span className="shell-context-item">上下文加载中…</span>
                )}
                {engineering.kind === 'error' && (
                  <span className="shell-context-item">工程上下文加载失败</span>
                )}
                {engineering.kind === 'forbidden' && (
                  <span className="shell-context-item">无权访问该工程</span>
                )}
              </>
            )}
          </div>
          <div className="shell-actions">
            <EngineeringSwitcher />
            {sessionState.kind === 'authenticated' && (
              <>
                <span className="shell-context-item mono">
                  {sessionState.session.accountRef.entityId}
                </span>
                <button
                  type="button"
                  className="shell-switch-btn"
                  onClick={() => void logout()}
                >
                  登出
                </button>
                {/* 注销失败保持原会话并允许重试：只有成功注销才进入匿名。 */}
                {logoutFailed ? (
                  <button
                    type="button"
                    className="shell-switch-btn shell-switch-btn--warn"
                    onClick={() => void logout()}
                  >
                    重试登出
                  </button>
                ) : null}
              </>
            )}
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
