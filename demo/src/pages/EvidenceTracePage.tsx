import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { EvidenceLink } from '../components/EvidenceLink'
import { Icon } from '../components/icons'
import { SectionTabs } from '../components/SectionTabs'
import { VersionTag } from '../components/VersionTag'
import { assessmentRecord } from '../content/assessment'
import { processNodes } from '../content/context'
import { evidenceChain, evidenceSegments } from '../content/evidence'
import { applicableRuleSet, mechanismEntries, scoringRules } from '../content/knowledge'
import { warningRecord } from '../content/response'
import { mainRisk } from '../content/risks'
import './EvidenceTracePage.css'

interface TraceNodeExtra {
  name: string
  version?: string
  route: string
  evidenceId: string
}

const segmentOf = (id: string) => evidenceSegments.find((s) => s.segmentId === id)!

const geoSegment = segmentOf(mainRisk.evidence[0])
const planSegment = segmentOf(mainRisk.evidence[1])
const mechanism = mechanismEntries.find((m) => m.id === mainRisk.mechanismId)!
const ruleWithEvidence = scoringRules.find((r) => applicableRuleSet.memberRuleIds.includes(r.ruleId))!
const warningSegment = evidenceSegments.find((s) => s.referencedBy.includes(warningRecord.id))!
const processName = processNodes.find((p) => p.id === mainRisk.processNodeId)?.name

/** 证据链七节点的展示名、版本、跳转路由与就地证据入口（数据均取自内容模块） */
const nodeExtras: Record<string, TraceNodeExtra> = {
  [geoSegment.segmentId]: {
    name: `${geoSegment.name} · ${geoSegment.documentName}`,
    version: geoSegment.version,
    route: `/project/documents/${geoSegment.documentId}`,
    evidenceId: geoSegment.segmentId,
  },
  [mainRisk.processNodeId]: {
    name: `工序节点：${processName}`,
    route: '/identification/process-model',
    evidenceId: planSegment.segmentId,
  },
  [mechanism.id]: {
    name: `机理类型：${mechanism.type}`,
    version: mechanism.version,
    route: '/knowledge/mechanisms',
    evidenceId: mechanism.evidence[0],
  },
  [mainRisk.id]: {
    name: mainRisk.riskEvent,
    route: `/risks/${mainRisk.id}`,
    evidenceId: mainRisk.evidence[0],
  },
  [applicableRuleSet.id]: {
    name: applicableRuleSet.name,
    version: applicableRuleSet.version,
    route: '/knowledge/rules',
    evidenceId: ruleWithEvidence.evidenceLocator,
  },
  [assessmentRecord.id]: {
    name: `P ${assessmentRecord.likelihoodScore} / C ${assessmentRecord.consequenceScore} · ${assessmentRecord.riskLevel} 级风险`,
    route: `/assessment/records/${assessmentRecord.id}`,
    evidenceId: assessmentRecord.evidenceReferences[0],
  },
  [warningRecord.id]: {
    name: `${warningRecord.level} · ${warningRecord.status}`,
    route: `/warnings/${warningRecord.id}`,
    evidenceId: warningSegment.segmentId,
  },
}

const traceNodes = evidenceChain.map((n) => ({ ...n, ...nodeExtras[n.objectId] }))

export default function EvidenceTracePage() {
  const navigate = useNavigate()

  return (
    <AppShell activeNav="review" agentContext={['RISK-2026-001', '端到端证据链']}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">证据追溯</h1>
            <p className="page-subtitle">端到端固定追溯链：资料段标识 → 工序节点 → 风险机理条目 → 标准化风险记录 → 适用规则集 → 风险评估记录 → 预警信息</p>
          </div>
        </header>

        <SectionTabs
          items={[
            { to: '/review', label: '复核队列' },
            { to: '/review/trace', label: '证据追溯' },
            { to: '/review/runs', label: '运行记录' },
          ]}
        />

        <div className="et-intro">
          该链以 <span className="mono">{mainRisk.id}</span> 为主线串联七个业务对象，每个节点保留标识与版本，
          支持从任一结果回溯上游资料段证据。点击节点跳转对应详情页，证据入口就地打开资料段定位。
        </div>

        <div className="et-chain">
          {traceNodes.map((node, i) => (
            <div key={node.objectId}>
              {i > 0 && <div className="et-connector" />}
              <div className="et-node" onClick={() => navigate(node.route)}>
                <div className="et-order">{node.order}</div>
                <div className="et-main">
                  <div className="et-head">
                    <span className="et-kind">{node.kind}</span>
                    <span className="et-id mono">{node.objectId}</span>
                    {node.version && <VersionTag>{node.version}</VersionTag>}
                  </div>
                  <div className="et-name">{node.name}</div>
                  <span onClick={(e) => e.stopPropagation()}>
                    <EvidenceLink segmentId={node.evidenceId} />
                  </span>
                </div>
                <span className="et-go">
                  查看
                  <Icon name="arrowRight" size={14} />
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  )
}
