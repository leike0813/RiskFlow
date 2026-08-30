import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { Icon } from '../components/icons'
import { RiskBadge } from '../components/RiskBadge'
import { StatusTag } from '../components/StatusTag'
import { VersionTag } from '../components/VersionTag'
import { EvidenceLink } from '../components/EvidenceLink'
import {
  agentAnswerLines,
  agentEvidenceRefs,
  agentInputPlaceholder,
  agentQuestion,
  agentRecentTasks,
  agentRecordRefs,
  agentResultCard,
  agentRunSummary,
  agentTaskSteps,
} from '../content/agent'
import { projectContext } from '../content/context'
import './AgentWorkbenchPage.css'

/** 对话列顶部工程上下文标签（与 AgentDock 头部上下文一致） */
const contextTags = [projectContext.process, projectContext.stratumCondition, '监测摘要已更新']

/**
 * 结果卡底部三个文字入口。
 * 「查看识别记录」按汇报口径指向本次运行详情页（RUN-20260827-001），
 * 其余两项与 src/content/agent.ts 保持一致。
 */
const resultLinks = [
  { label: agentResultCard.links[0].label, to: `/identification/runs/${agentRunSummary.runId}` },
  { label: agentResultCard.links[1].label, to: agentResultCard.links[1].to },
  { label: agentResultCard.links[2].label, to: agentResultCard.links[2].to },
]

/**
 * 智能 Agent 全屏工作台（/agent，P-AG-02）。
 * 与全局 AgentDock 共用 src/content/agent.ts 数据，布局独立实现：
 * 会话与任务 288 / 对话与结构化结果 800 / 运行与证据 528。
 */
export default function AgentWorkbenchPage() {
  return (
    <AppShell activeNav={null} agentContext={contextTags}>
      <div className="page awb-page">
        <header className="page-header">
          <div>
            <h1 className="page-title">智能 Agent</h1>
            <p className="page-subtitle">
              通过工程问题调用风险识别、评估与预警处置能力，结果与证据全程可追溯
            </p>
          </div>
        </header>

        <div className="awb-grid">
          {/* 会话与任务列 */}
          <div className="awb-col">
            <Card title="会话与任务">
              <button type="button" className="awb-new-task">
                <span className="awb-new-task-plus">+</span>
                新建任务
              </button>
              <div className="awb-task-list">
                {agentRecentTasks.map((t) => (
                  <div key={t.id} className={`awb-task${t.current ? ' awb-task--current' : ''}`}>
                    <div className="awb-task-head">
                      <span className="awb-task-title">{t.title}</span>
                      {t.tag === 'I级风险' && <RiskBadge level="I" />}
                    </div>
                    <div className="awb-task-meta mono">{t.id}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* 对话与结构化结果列 */}
          <div className="awb-col awb-chat">
            <div className="awb-context-bar">
              <div className="awb-context-tags">
                {contextTags.map((tag) => (
                  <span key={tag} className="awb-context-tag">
                    {tag}
                  </span>
                ))}
              </div>
              <span className="awb-context-source">
                <Icon name="doc" size={14} />
                上下文来源 {contextTags.length} 项
              </span>
            </div>

            <section className="awb-conv">
              <div className="awb-bubble-user">{agentQuestion}</div>

              <div className="awb-answer">
                <span className="awb-avatar">
                  <Icon name="agent" size={16} />
                </span>
                <div className="awb-answer-body">
                  {agentAnswerLines.map((line) => (
                    <p key={line} className="awb-answer-line">
                      {line}
                    </p>
                  ))}

                  <div className="awb-result">
                    <div className="awb-result-head">
                      <span className="awb-result-id mono">{agentResultCard.riskRecordId}</span>
                      <RiskBadge level="I" />
                    </div>
                    <div className="awb-result-event">{agentResultCard.riskEvent}</div>

                    <div className="awb-result-stats">
                      <div className="awb-stat">
                        <span className="awb-stat-label">发生可能性</span>
                        <span className="awb-stat-value awb-stat-value--blue">
                          P={agentResultCard.p}
                        </span>
                      </div>
                      <div className="awb-stat">
                        <span className="awb-stat-label">后果严重性</span>
                        <span className="awb-stat-value awb-stat-value--blue">
                          C={agentResultCard.c}
                        </span>
                      </div>
                      <div className="awb-stat">
                        <span className="awb-stat-label">综合置信度</span>
                        <span className="awb-stat-value">
                          {agentResultCard.compositeConfidence}
                        </span>
                      </div>
                    </div>

                    <div className="awb-result-section">主要触发指标</div>
                    <ul className="awb-trigger-list">
                      {agentResultCard.triggerIndicators.map((t) => (
                        <li key={t}>
                          <Icon name="alert" size={13} />
                          {t}
                        </li>
                      ))}
                    </ul>

                    <div className="awb-result-section">处置建议（前两项）</div>
                    <ul className="awb-measure-list">
                      {agentResultCard.measureSummaries.map((m, i) => (
                        <li key={m}>
                          <span className="awb-measure-index">{i + 1}</span>
                          {m}
                        </li>
                      ))}
                    </ul>

                    <div className="awb-result-links">
                      {resultLinks.map((l) => (
                        <Link key={l.label} to={l.to} className="awb-result-link">
                          {l.label}
                          <Icon name="arrowRight" size={13} />
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <div className="awb-input-bar">
              <input className="awb-input" placeholder={agentInputPlaceholder} readOnly />
              <button type="button" className="awb-send" aria-label="发送">
                <Icon name="arrowRight" size={16} />
              </button>
            </div>
          </div>

          {/* 运行与证据列 */}
          <div className="awb-col awb-side">
            <Card
              title="运行摘要"
              extra={<StatusTag tone="success">{agentRunSummary.status}</StatusTag>}
            >
              <div className="awb-run-rows">
                <div className="awb-run-row">
                  <span className="awb-field-label">运行标识</span>
                  <span className="awb-run-id mono">{agentRunSummary.runId}</span>
                </div>
                <div className="awb-run-row">
                  <span className="awb-field-label">推理模型</span>
                  <span>
                    {agentRunSummary.model}（{agentRunSummary.inference}）
                  </span>
                </div>
                <div className="awb-run-row">
                  <span className="awb-field-label">执行图</span>
                  <span className="awb-run-graph">
                    {agentRunSummary.graph}
                    <VersionTag>{agentRunSummary.graphVersion}</VersionTag>
                  </span>
                </div>
              </div>
            </Card>

            <div className="awb-side-grow">
              <Card title="任务步骤">
                <div className="awb-steps">
                  {agentTaskSteps.map((s, i) => (
                    <div key={s} className="awb-step">
                      <span className="awb-step-check">
                        <Icon name="check" size={12} />
                      </span>
                      <span className="awb-step-text">{s}</span>
                      {i < agentTaskSteps.length - 1 && <span className="awb-step-line" />}
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <Card title="证据引用" extra={`${agentEvidenceRefs.length} 项资料段`}>
              <div className="awb-evi-list">
                {agentEvidenceRefs.map((e) => (
                  <div key={e.segmentId} className="awb-evi-row">
                    <div className="awb-evi-name">{e.name}</div>
                    <EvidenceLink segmentId={e.segmentId} />
                  </div>
                ))}
              </div>
            </Card>

            <Card title="记录引用">
              <div className="awb-rec-list">
                {agentRecordRefs.map((r) => (
                  <Link key={r.id} to={r.to} className="awb-rec-row">
                    <span className="awb-rec-id mono">{r.id}</span>
                    <span className="awb-rec-label">{r.label}</span>
                    <Icon name="arrowRight" size={13} />
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
