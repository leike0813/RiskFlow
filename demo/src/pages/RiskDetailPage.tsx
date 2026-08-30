import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { ConfirmButton } from '../components/ConfirmButton'
import { EvidenceLink } from '../components/EvidenceLink'
import { Icon } from '../components/icons'
import { RiskBadge } from '../components/RiskBadge'
import { StatusTag } from '../components/StatusTag'
import { Timeline, type TimelineItem } from '../components/Timeline'
import { VersionTag } from '../components/VersionTag'
import { WarningBadge } from '../components/WarningBadge'
import { agentRunSummary } from '../content/agent'
import { assessmentVersions, triggerIndicators } from '../content/assessment'
import { projectContext } from '../content/context'
import { auditTimeline, evidenceChain } from '../content/evidence'
import { applicableRuleSet, mechanismEntries } from '../content/knowledge'
import { responseRecommendation, warningRecord } from '../content/response'
import { mainRisk } from '../content/risks'
import './RiskDetailPage.css'

const mechanism = mechanismEntries.find((m) => m.id === mainRisk.mechanismId)

/** 证据链节点的补充展示：名称与风险/预警小标签 */
const chainExtras: Record<string, { name?: string; tag?: ReactNode }> = {
  'PN-EXPAND-02': { name: mainRisk.processName },
  'RM-SETTLE-004': { name: mainRisk.mechanismType },
  'RISK-2026-001': { tag: <RiskBadge level={mainRisk.level} /> },
  'WARN-2026-001': { tag: <WarningBadge /> },
}

/** 版本快照（全部中性色版本标签） */
const versionItems = [
  { label: '推理模型', value: agentRunSummary.model },
  { label: '提示模板', value: 'risk-identification-v1' },
  { label: '流程图版本', value: `${agentRunSummary.graph} ${agentRunSummary.graphVersion}` },
  { label: '风险机理库', value: `机理库 ${mechanism?.version ?? ''}` },
  { label: '适用规则集', value: `规则集 ${applicableRuleSet.version}` },
  { label: '风险矩阵', value: `矩阵 ${assessmentVersions.riskMatrix.version}` },
]

const auditItems: TimelineItem[] = auditTimeline.map((e) => ({
  time: e.time,
  title: e.title,
  actor: e.actor,
  tone: e.done ? 'done' : 'current',
}))

const confirmSummary = [
  `工程：${projectContext.project} · ${projectContext.section}`,
  `对象：${responseRecommendation.id}（关联 ${mainRisk.id} / ${warningRecord.id}）`,
  `版本：处置建议 ${responseRecommendation.version} · 适用规则集 ${applicableRuleSet.version} · 风险矩阵 ${assessmentVersions.riskMatrix.version}`,
  '预计结果：四步措施进入现场确认流程，处置进展回写审计记录',
]

export default function RiskDetailPage() {
  return (
    <AppShell activeNav="warnings" agentContext={[mainRisk.id, mainRisk.processNodeId]}>
      <div className="page rdp">
        <header className="page-header">
          <div>
            <h1 className="page-title">风险详情</h1>
            <p className="page-subtitle">
              <span className="mono">{mainRisk.id}</span>
              {' · '}
              <span className="mono">{mainRisk.processNodeId}</span>
            </p>
          </div>
          <div className="rdp-actions">
            <RiskBadge level={mainRisk.level} />
            <WarningBadge text={`${warningRecord.level} · ${warningRecord.status}`} />
            <Link to="/review" className="rdp-btn-ghost">
              发起复核
            </Link>
            <ConfirmButton label="确认处置方案" summary={confirmSummary} />
          </div>
        </header>

        <div className="rdp-grid">
          {/* 风险关系摘要：风险源 → 风险因素 → 风险事件 + 评估与预警 */}
          <Card>
            <div className="rdp-rel">
              <div className="rdp-rel-nodes">
                <div className="rdp-rel-node">
                  <div className="rdp-rel-label">风险源</div>
                  <div className="rdp-rel-text">{mainRisk.riskSource}</div>
                </div>
                <Icon name="arrowRight" size={18} style={{ flex: 'none', color: 'var(--bluegray)' }} />
                <div className="rdp-rel-node">
                  <div className="rdp-rel-label">风险因素</div>
                  <div className="rdp-rel-text">{mainRisk.riskFactor}</div>
                </div>
                <Icon name="arrowRight" size={18} style={{ flex: 'none', color: 'var(--bluegray)' }} />
                <div className="rdp-rel-node rdp-rel-node--event">
                  <div className="rdp-rel-label">风险事件</div>
                  <div className="rdp-rel-text">{mainRisk.riskEvent}</div>
                </div>
              </div>
              <div className="rdp-rel-side">
                <div className="rdp-stats">
                  <div className="rdp-stat">
                    <span className="rdp-stat-label">发生可能性</span>
                    <span className="rdp-stat-value mono">P = {mainRisk.p}</span>
                  </div>
                  <div className="rdp-stat">
                    <span className="rdp-stat-label">后果严重性</span>
                    <span className="rdp-stat-value mono">C = {mainRisk.c}</span>
                  </div>
                  <div className="rdp-stat">
                    <span className="rdp-stat-label">综合置信度</span>
                    <span className="rdp-stat-value mono">{mainRisk.compositeConfidence.toFixed(2)}</span>
                  </div>
                </div>
                <div className="rdp-triggers">
                  {triggerIndicators.map((t) => (
                    <span key={t.name} className="rdp-trigger" title={`${t.name} ${t.currentValue}（阈值 ${t.threshold}）`}>
                      {t.name} <span className="mono">{t.currentValue}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <div className="rdp-row-main">
            {/* 处置建议（RESP-2026-001 四步措施） */}
            <Card
              title="处置建议"
              extra={
                <>
                  <span className="mono rdp-resp-id">{responseRecommendation.id}</span>
                  <VersionTag>{responseRecommendation.version}</VersionTag>
                  <StatusTag tone="neutral">{responseRecommendation.source}</StatusTag>
                </>
              }
            >
              <div className="rdp-resp">
                <div className="rdp-resp-head">
                  <span />
                  <span>措施项</span>
                  <span>资源需求</span>
                  <span>目标指标</span>
                  <span>状态</span>
                </div>
                {responseRecommendation.measures.map((m) => (
                  <div
                    key={m.order}
                    className={`rdp-resp-row${m.order === 1 ? ' rdp-resp-row--first' : ''}`}
                  >
                    <span className="rdp-resp-order">{m.order}</span>
                    <span className="rdp-resp-measure">{m.measure}</span>
                    <span className="rdp-resp-cell">{m.resources}</span>
                    <span className="rdp-resp-cell rdp-resp-target">{m.targetIndicator}</span>
                    <span>
                      <StatusTag tone="running">{m.status}</StatusTag>
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {/* 纵向证据链：资料段 → … → 预警信息 */}
            <Card
              title="端到端证据链"
              extra={
                <Link to="/review/trace" className="rdp-chain-link">
                  查看完整证据链
                  <Icon name="arrowRight" size={14} />
                </Link>
              }
            >
              <ol className="rdp-chain">
                {evidenceChain.map((node) => {
                  const extra = chainExtras[node.objectId]
                  const current = node.objectId === warningRecord.id
                  return (
                    <li
                      key={node.objectId}
                      className={`rdp-chain-item${current ? ' rdp-chain-item--current' : ''}`}
                    >
                      <span className="rdp-chain-dot" />
                      <div className="rdp-chain-body">
                        <span className="rdp-chain-kind">{node.kind}</span>
                        {node.kind === '资料段' ? (
                          <EvidenceLink segmentId={node.objectId} name="地层与地下水条件" />
                        ) : (
                          <span className="rdp-chain-id mono">{node.objectId}</span>
                        )}
                        {extra?.name && <span className="rdp-chain-name">{extra.name}</span>}
                        {node.version && <VersionTag>{node.version}</VersionTag>}
                        {extra?.tag}
                      </div>
                    </li>
                  )
                })}
              </ol>
            </Card>
          </div>

          <div className="rdp-row-bottom">
            {/* 三重校验 */}
            <Card title="三重校验">
              <div className="rdp-checks">
                {responseRecommendation.checks.map((c) => (
                  <div key={c.name} className="rdp-check-row">
                    <span className="rdp-check-icon">
                      <Icon name="check" size={13} />
                    </span>
                    <span className="rdp-check-name">{c.name}</span>
                    <StatusTag tone="success">{c.result}</StatusTag>
                  </div>
                ))}
              </div>
            </Card>

            {/* 版本快照 */}
            <Card title="版本快照">
              <div className="rdp-versions">
                {versionItems.map((v) => (
                  <div key={v.label} className="rdp-version-cell">
                    <span className="rdp-version-label">{v.label}</span>
                    <span>
                      <VersionTag>{v.value}</VersionTag>
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {/* 审计时间线 */}
            <Card title="审计时间线">
              <div className="rdp-audit">
                <Timeline items={auditItems} />
              </div>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
