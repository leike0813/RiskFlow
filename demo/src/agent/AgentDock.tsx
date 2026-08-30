import { Link } from 'react-router-dom'
import {
  agentAnswerLines,
  agentInputPlaceholder,
  agentQuestion,
  agentResultCard,
  agentTaskSteps,
} from '../content/agent'
import { Icon } from '../components/icons'
import { RiskBadge } from '../components/RiskBadge'
import { EvidenceLink } from '../components/EvidenceLink'
import { useAgentDockOpen, setAgentDock } from './agentDockStore'
import './AgentDock.css'

/**
 * 全局 Agent 停靠栏：右侧固定 480px 面板，可展开/收起。
 * 挂在 AppShell 内；开关状态由 agentDockStore 持有，跨导航保持。
 * 数据全部来自 src/content/agent.ts。
 */
export function AgentDock({ context }: { context?: string[] }) {
  const open = useAgentDockOpen()

  return (
    <aside className={`agent-dock${open ? ' agent-dock--open' : ''}`} aria-hidden={!open}>
      <header className="agent-dock-header">
        <span className="agent-dock-title">
          <Icon name="agent" size={18} />
          智能 Agent
        </span>
        <button
          type="button"
          className="agent-dock-close"
          onClick={() => setAgentDock(false)}
          aria-label="收起智能 Agent"
        >
          <Icon name="close" size={16} />
        </button>
      </header>

      {context && context.length > 0 && (
        <div className="agent-dock-context">
          {context.map((c) => (
            <span key={c} className="agent-dock-context-tag">
              {c}
            </span>
          ))}
        </div>
      )}

      <div className="agent-dock-body">
        <div className="agent-bubble agent-bubble--user">{agentQuestion}</div>

        <div className="agent-bubble agent-bubble--agent">
          {agentAnswerLines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}

          <div className="agent-result-card">
            <div className="agent-result-head">
              <span className="mono">{agentResultCard.riskRecordId}</span>
              <RiskBadge level="I" />
            </div>
            <div className="agent-result-event">{agentResultCard.riskEvent}</div>
            <div className="agent-result-meta">
              P={agentResultCard.p} · C={agentResultCard.c} · 综合置信度{' '}
              {agentResultCard.compositeConfidence}
            </div>
            <div className="agent-result-section">主要触发指标</div>
            <ul className="agent-result-list">
              {agentResultCard.triggerIndicators.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <div className="agent-result-section">处置建议（前两项）</div>
            <ul className="agent-result-list">
              {agentResultCard.measureSummaries.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <div className="agent-result-section">证据引用</div>
            <div className="agent-result-evidence">
              <EvidenceLink segmentId="SRC-GEO-001-CH04-SEG018" />
              <EvidenceLink segmentId="SRC-PLAN-002-CH06-SEG011" />
              <EvidenceLink segmentId="SRC-MON-003-20260827-SEG036" />
            </div>
          </div>

          <div className="agent-steps">
            {agentTaskSteps.map((s, i) => (
              <div key={i} className="agent-step">
                <Icon name="check" size={13} />
                {s}
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="agent-dock-footer">
        <Link to="/agent" className="agent-expand-link" onClick={() => setAgentDock(false)}>
          展开为全屏工作台
          <Icon name="arrowRight" size={14} />
        </Link>
        <div className="agent-input-row">
          <input className="agent-input" placeholder={agentInputPlaceholder} readOnly />
          <button type="button" className="agent-send" aria-label="发送">
            <Icon name="arrowRight" size={16} />
          </button>
        </div>
      </footer>
    </aside>
  )
}
