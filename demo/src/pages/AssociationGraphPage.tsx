import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { RiskBadge } from '../components/RiskBadge'
import { SectionTabs } from '../components/SectionTabs'
import { GraphLegend } from '../components/GraphLegend'
import { GraphView } from '../charts/GraphView'
import { processNodes } from '../content/context'
import { mechanismEntries } from '../content/knowledge'
import { riskRecords, mainRisk, type RiskLevel } from '../content/risks'
import { evidenceSegments } from '../content/evidence'
import './AssociationGraphPage.css'

const tabs = [
  { to: '/identification', label: '识别任务' },
  { to: '/identification/records', label: '风险记录' },
  { to: '/identification/graph', label: '关联图谱' },
  { to: '/identification/process-model', label: '工序模型' },
]

const levelOrder: RiskLevel[] = ['I', 'II', 'III', 'IV']

/** 图数据：工序 × 机理 × 风险事件，主线风险附风险源 / 风险因素 / 证据定位 */
function buildGraph() {
  const nodes: { id: string; name: string; category: string }[] = []
  const edges: { source: string; target: string; label?: string }[] = []

  for (const p of processNodes) {
    nodes.push({ id: p.id, name: p.name, category: '工序' })
  }
  for (const m of mechanismEntries) {
    nodes.push({ id: m.id, name: m.type, category: '机理' })
    for (const procName of m.applicableProcesses) {
      const pn = processNodes.find((p) => p.name === procName)
      if (pn) edges.push({ source: m.id, target: pn.id })
    }
  }
  for (const r of riskRecords) {
    nodes.push({ id: r.id, name: r.riskEvent, category: '风险事件' })
    edges.push({ source: r.processNodeId, target: r.id })
    edges.push({ source: r.mechanismId, target: r.id })
  }

  nodes.push({ id: 'RS-MAIN', name: mainRisk.riskSource, category: '风险要素' })
  nodes.push({ id: 'RF-MAIN', name: mainRisk.riskFactor, category: '风险要素' })
  edges.push({ source: 'RS-MAIN', target: 'RF-MAIN', label: '致险' })
  edges.push({ source: 'RF-MAIN', target: mainRisk.id, label: '引发' })

  for (const segId of mainRisk.evidence) {
    const seg = evidenceSegments.find((s) => s.segmentId === segId)
    nodes.push({ id: segId, name: seg?.name ?? segId, category: '资料证据' })
    edges.push({ source: segId, target: mainRisk.id, label: '证据' })
  }

  return { nodes, edges }
}

const graph = buildGraph()

/** 按工序分组的风险简表 */
const groups = processNodes.map((p) => {
  const rs = riskRecords.filter((r) => r.processNodeId === p.id)
  const highest = levelOrder.find((lv) => rs.some((r) => r.level === lv)) ?? 'IV'
  return { processName: p.name, count: rs.length, highest, records: rs }
})

export default function AssociationGraphPage() {
  return (
    <AppShell activeNav="identification" agentContext={['工序风险关联图谱', '变径空间扩挖']}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">工序风险关联图谱</h1>
            <p className="page-subtitle">按工序节点、机理条目与风险要素浏览关联关系</p>
          </div>
        </header>
        <SectionTabs items={tabs} />

        <Card
          title="图谱视图"
          extra={<GraphLegend categories={['工序', '机理', '风险事件', '风险要素', '资料证据']} />}
        >
          <p className="graph-hint">
            节点可拖动、滚轮缩放；主线风险 {mainRisk.id}（{mainRisk.riskEvent}
            ）已连接风险源、风险因素与三段证据定位。
          </p>
          <GraphView nodes={graph.nodes} edges={graph.edges} height={480} />
        </Card>

        <Card title="按工序分组的风险" style={{ marginTop: 16 }}>
          <div className="graph-groups">
            {groups.map((g) => (
              <div key={g.processName} className="graph-group">
                <div className="graph-group-head">
                  <span className="graph-group-name">{g.processName}</span>
                  <span className="graph-group-count mono">{g.count}</span>
                  <RiskBadge level={g.highest} />
                </div>
                <ul className="graph-group-events">
                  {g.records.map((r) => (
                    <li key={r.id}>
                      <span className="mono graph-event-id">{r.id}</span>
                      {r.riskEvent}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppShell>
  )
}
