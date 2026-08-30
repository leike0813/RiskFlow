import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { StageBar, type StageItem } from '../components/StageBar'
import { StatusTag } from '../components/StatusTag'
import { VersionTag } from '../components/VersionTag'
import { EvidenceLink } from '../components/EvidenceLink'
import { RiskBadge } from '../components/RiskBadge'
import { GraphLegend } from '../components/GraphLegend'
import { GraphView } from '../charts/GraphView'
import { mainRisk } from '../content/risks'
import { evidenceSegments } from '../content/evidence'
import { mechanismEntries } from '../content/knowledge'
import { agentRunSummary } from '../content/agent'
import './IdentificationRunPage.css'

/** RI-S1–RI-S6 阶段条：全部完成，RI-S5（机理驱动推理）在样式上以工程蓝描边强调 */
const stages: StageItem[] = [
  { id: 'RI-S1', label: '资料接入', hint: '多源资料分段登记', status: 'done' },
  { id: 'RI-S2', label: '格式化校验', hint: '结构保留与合规校验', status: 'done' },
  { id: 'RI-S3', label: '工序模型', hint: '工序节点与依赖关系', status: 'done' },
  { id: 'RI-S4', label: '机理库', hint: '机理条目关联与覆盖校验', status: 'done' },
  { id: 'RI-S5', label: '机理驱动推理', hint: '混合检索与结构化输出', status: 'done' },
  { id: 'RI-S6', label: '校验与入库', hint: '完整性检查与关联入库', status: 'done' },
]

/** 工序风险关联图谱：10 节点 / 10 边（规格上限 9–11 节点、≤14 边） */
const graphNodes = [
  { id: 'proc', name: '变径空间扩挖', category: '工序' },
  { id: 'geo', name: '地质资料', category: '资料证据' },
  { id: 'plan', name: '专项方案', category: '资料证据' },
  { id: 'mon', name: '监测摘要', category: '资料证据' },
  { id: 'arm', name: '扩挖机构', category: '装备构件' },
  { id: 'brim', name: '伸缩帽檐', category: '装备构件' },
  { id: 'mechanism', name: '过挖与\n地表沉降', category: '机理' },
  { id: 'source', name: '风险源', category: '风险要素' },
  { id: 'factor', name: '风险因素', category: '风险要素' },
  { id: 'event', name: '风险事件\nI级风险', category: '风险事件' },
]

const graphEdges = [
  { source: 'geo', target: 'proc', label: '来源' },
  { source: 'plan', target: 'proc', label: '来源' },
  { source: 'mon', target: 'proc', label: '来源' },
  { source: 'arm', target: 'proc', label: '作用' },
  { source: 'brim', target: 'proc', label: '作用' },
  { source: 'proc', target: 'mechanism', label: '关联机理' },
  { source: 'proc', target: 'source', label: '触发' },
  { source: 'source', target: 'factor', label: '导致' },
  { source: 'factor', target: 'event', label: '导致' },
  { source: 'mon', target: 'event', label: '证据支持' },
]

export default function IdentificationRunPage() {
  const mechanism = mechanismEntries.find((m) => m.id === mainRisk.mechanismId)
  const evidenceHits = mainRisk.evidence.map((id) => {
    const seg = evidenceSegments.find((s) => s.segmentId === id)
    return { segmentId: id, name: seg?.name ?? '', type: seg?.documentType ?? '' }
  })

  return (
    <AppShell
      activeNav="identification"
      agentContext={['RUN-20260827-001', '工序 PN-EXPAND-02']}
    >
      <div className="page idrun-page">
        <header className="page-header idrun-header">
          <div>
            <h1 className="page-title">LangGraph 智能识别中心</h1>
            <p className="page-subtitle">
              运行 <span className="mono">{agentRunSummary.runId}</span> · 工序{' '}
              <span className="mono">{mainRisk.processNodeId}</span>
            </p>
          </div>
          <div className="idrun-header-tags">
            <StatusTag tone="success">{agentRunSummary.status}</StatusTag>
            <StatusTag tone="neutral">无需人工复核</StatusTag>
          </div>
        </header>

        <Card title="识别运行阶段" style={{ flex: 'none' }}>
          <div className="idrun-stage">
            <StageBar stages={stages} />
          </div>
        </Card>

        <div className="idrun-mid">
          <Card title="工序风险关联图谱" extra={<GraphLegend />}>
            <GraphView nodes={graphNodes} edges={graphEdges} height={430} />
          </Card>

          <Card
            title="标准化风险记录"
            extra={
              <>
                <span className="mono idrun-record-id">{mainRisk.id}</span>
                <span className="idrun-record-conf">
                  模型置信度 {mainRisk.modelConfidence.toFixed(2)}
                </span>
              </>
            }
          >
            <dl className="idrun-fields">
              <div className="idrun-field">
                <dt>工序节点标识</dt>
                <dd>
                  <span className="mono">{mainRisk.processNodeId}</span> · {mainRisk.processName}
                </dd>
              </div>
              <div className="idrun-field">
                <dt>风险源</dt>
                <dd className="idrun-clamp2">{mainRisk.riskSource}</dd>
              </div>
              <div className="idrun-field">
                <dt>风险因素</dt>
                <dd className="idrun-clamp2">{mainRisk.riskFactor}</dd>
              </div>
              <div className="idrun-field">
                <dt>风险事件</dt>
                <dd className="idrun-clamp2">
                  {mainRisk.riskEvent} <RiskBadge level={mainRisk.level} />
                </dd>
              </div>
              <div className="idrun-field">
                <dt>风险要素关系</dt>
                <dd className="idrun-clamp2">{mainRisk.riskElementRelations}</dd>
              </div>
              <div className="idrun-field">
                <dt>证据定位信息</dt>
                <dd className="idrun-field-ev">
                  {evidenceHits.map((e) => (
                    <EvidenceLink key={e.segmentId} segmentId={e.segmentId} name={e.name} />
                  ))}
                </dd>
              </div>
              <div className="idrun-field">
                <dt>模型置信度</dt>
                <dd className="idrun-conf">{mainRisk.modelConfidence.toFixed(2)}</dd>
              </div>
            </dl>
            <footer className="idrun-record-checks">
              <StatusTag tone="success">结构化校验通过</StatusTag>
              <StatusTag tone="success">完整性检查通过</StatusTag>
            </footer>
          </Card>
        </div>

        <div className="idrun-bottom">
          <Card title="证据命中">
            <div className="idrun-hits">
              {evidenceHits.map((e) => (
                <div key={e.segmentId} className="idrun-hit">
                  <EvidenceLink segmentId={e.segmentId} name={e.name} />
                  <span className="idrun-hit-type">{e.type}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="综合置信度">
            <div className="idrun-comp">
              <span className="idrun-comp-num">{mainRisk.compositeConfidence.toFixed(2)}</span>
              <span className="idrun-comp-cap">综合四项形成依据</span>
            </div>
            <div className="idrun-basis">
              <div className="idrun-basis-item">
                <span className="idrun-basis-label">模型置信度</span>
                <span className="idrun-basis-value">{mainRisk.modelConfidence.toFixed(2)}</span>
              </div>
              <div className="idrun-basis-item">
                <span className="idrun-basis-label">规则一致性校验</span>
                <StatusTag tone="success">通过</StatusTag>
              </div>
              <div className="idrun-basis-item">
                <span className="idrun-basis-label">约束校验</span>
                <StatusTag tone="success">通过</StatusTag>
              </div>
              <div className="idrun-basis-item">
                <span className="idrun-basis-label">多来源证据合并</span>
                <StatusTag tone="success">已合并</StatusTag>
              </div>
            </div>
          </Card>

          <Card title="运行与复核">
            <div className="idrun-run">
              <div className="idrun-run-row">
                <span className="idrun-run-key">运行标识</span>
                <span className="mono">{agentRunSummary.runId}</span>
              </div>
              <div className="idrun-run-row">
                <span className="idrun-run-key">识别图</span>
                <span className="idrun-run-value">
                  {agentRunSummary.graph}
                  <VersionTag>{agentRunSummary.graphVersion}</VersionTag>
                </span>
              </div>
              <div className="idrun-run-row">
                <span className="idrun-run-key">提示模板</span>
                <span className="mono">risk-identification-v1</span>
              </div>
              <div className="idrun-run-row">
                <span className="idrun-run-key">风险机理库</span>
                <span className="idrun-run-value">
                  <VersionTag>{mechanism?.version}</VersionTag>
                  {mechanism?.status}
                </span>
              </div>
              <div className="idrun-run-row">
                <span className="idrun-run-key">人工复核</span>
                <StatusTag tone="neutral">无需复核</StatusTag>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}
