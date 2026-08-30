import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { EvidenceLink } from '../components/EvidenceLink'
import { Icon } from '../components/icons'
import { KpiCard } from '../components/KpiCard'
import { RiskBadge } from '../components/RiskBadge'
import { StatusTag } from '../components/StatusTag'
import { VersionTag } from '../components/VersionTag'
import { WarningBadge } from '../components/WarningBadge'
import { RiskMatrix5x5 } from '../charts/RiskMatrix5x5'
import {
  applicabilityMetadataSnapshot,
  assessmentRecord,
  assessmentVersions,
  cWeightGroups,
  cWeightedResult,
  matrixHighlight,
  pWeightGroups,
  pWeightedResult,
  reAssessment,
  riskMatrixGrid,
  thresholdConfigs,
  triggerIndicators,
  triggerTypes,
  type WeightGroup,
} from '../content/assessment'
import { mainRisk } from '../content/risks'
import './AssessmentRecordPage.css'

/** 指标评分明细列：当前值、阈值/区间、状态、证据入口 */
const indicatorColumns: DataTableColumn[] = [
  { key: 'name', title: '指标', width: 140 },
  {
    key: 'currentValue',
    title: '当前值',
    width: 84,
    render: (row) => <span className="mono arp-cur">{row.currentValue as string}</span>,
  },
  {
    key: 'threshold',
    title: '阈值 / 区间',
    width: 122,
    render: (row) => <span className="mono">{row.threshold as string}</span>,
  },
  {
    key: 'status',
    title: '状态',
    width: 78,
    render: (row) => <span className="arp-over">{row.status as string}</span>,
  },
  {
    key: 'evidence',
    title: '证据',
    render: (row) => <EvidenceLink segmentId={row.evidence as string} />,
  },
]

const indicatorRows = triggerIndicators.map((ind) => ({ ...ind }))

/** P 侧 / C 侧权重贡献条：组名 + 权重条 + 加权结果 → 等级 */
function WeightContribution({
  title,
  groups,
  result,
  tone,
}: {
  title: string
  groups: WeightGroup[]
  result: string
  tone: 'p' | 'c'
}) {
  const max = Math.max(...groups.map((g) => g.weight))
  return (
    <div className="arp-weight">
      <div className="arp-weight-head">
        <span className="arp-weight-title">{title}</span>
        <span className="arp-weight-result mono">{result}</span>
      </div>
      {groups.map((g) => (
        <div className="arp-weight-row" key={g.group}>
          <span className="arp-weight-name">{g.group}</span>
          <span className="arp-weight-track">
            <span
              className={`arp-weight-bar arp-weight-bar--${tone}`}
              style={{ width: `${(g.weight / max) * 100}%` }}
            />
          </span>
          <span className="arp-weight-val mono">{g.weight}%</span>
        </div>
      ))}
    </div>
  )
}

/** 监测预警阈值条目："指标名 数值" 拆为两列展示 */
function ThresholdItem({ text }: { text: string }) {
  const sep = text.indexOf(' ')
  return (
    <div className="arp-threshold-item">
      <span>{text.slice(0, sep)}</span>
      <span className="mono">{text.slice(sep + 1)}</span>
    </div>
  )
}

export default function AssessmentRecordPage() {
  const meta = applicabilityMetadataSnapshot

  return (
    <AppShell activeNav="assessment" agentContext={['ASSESS-2026-001', 'RISK-2026-001']}>
      <div className="page arp">
        <header className="page-header arp-header">
          <div className="arp-header-left">
            <h1 className="page-title">风险评估与预警中心</h1>
            <p className="page-subtitle">
              <span className="mono">{assessmentRecord.riskRecordId}</span>
              {` · ${mainRisk.riskEvent}`}
            </p>
          </div>
          <div className="arp-meta-tags">
            <span className="arp-meta-tag">{meta.constructionMethod}</span>
            <span className="arp-meta-tag">{meta.stratumCondition}</span>
            <span className="arp-meta-tag">{meta.engineeringStage}</span>
          </div>
        </header>

        <div className="arp-kpis">
          <div className="arp-kpi arp-kpi--pc">
            <KpiCard
              label="发生可能性 P"
              value={`P = ${assessmentRecord.likelihoodScore}`}
              tag={`加权结果 ${pWeightedResult}`}
            />
          </div>
          <div className="arp-kpi arp-kpi--pc">
            <KpiCard
              label="后果严重性 C"
              value={`C = ${assessmentRecord.consequenceScore}`}
              tag={`加权结果 ${cWeightedResult}`}
            />
          </div>
          <div className="arp-kpi">
            <KpiCard label="风险等级" value="I级风险" tag="矩阵落点 P4 × C4" tone="risk" />
          </div>
          <div className="arp-kpi">
            <KpiCard label="预警状态" value="红色预警" tag="待处置" tone="risk" />
          </div>
        </div>

        <div className="arp-main">
          <Card title="5×5 风险矩阵" extra={<RiskBadge level={assessmentRecord.riskLevel} />}>
            <div className="arp-matrix">
              <RiskMatrix5x5 grid={riskMatrixGrid} highlight={matrixHighlight} />
              <div className="arp-matrix-foot">
                <VersionTag>风险矩阵 {assessmentVersions.riskMatrix.version}</VersionTag>
                <span className="arp-matrix-note">
                  风险可接受阈值与监测预警阈值为不同配置，分别追溯
                </span>
              </div>
            </div>
          </Card>

          <Card
            title="指标评分明细"
            extra={<VersionTag>量化标准 {assessmentVersions.quantStandard.version}</VersionTag>}
          >
            <DataTable columns={indicatorColumns} rows={indicatorRows} />
            <div className="arp-weights">
              <WeightContribution
                title="发生可能性 P · 权重贡献"
                groups={pWeightGroups}
                result={`加权结果 ${pWeightedResult} → P = ${assessmentRecord.likelihoodScore}`}
                tone="p"
              />
              <WeightContribution
                title="后果严重性 C · 权重贡献"
                groups={cWeightGroups}
                result={`加权结果 ${cWeightedResult} → C = ${assessmentRecord.consequenceScore}`}
                tone="c"
              />
            </div>
          </Card>

          <Card title="预警触发" extra={<WarningBadge />}>
            <div className="arp-warn">
              <div className="arp-warn-id">
                <Link to="/warnings/WARN-2026-001" className="mono arp-warn-link">
                  WARN-2026-001
                </Link>
                <span className="arp-warn-state">红色预警 · 待处置</span>
              </div>

              <div className="arp-triggers">
                {triggerTypes.map((t) => (
                  <div className="arp-trigger" key={t}>
                    <Icon name="check" size={14} style={{ color: 'var(--success)' }} />
                    {t}
                  </div>
                ))}
              </div>

              <div className="arp-thresholds">
                <div className="arp-threshold">
                  <div className="arp-threshold-head">
                    <span className="arp-threshold-name">{thresholdConfigs.riskAcceptance.name}</span>
                    <VersionTag>{thresholdConfigs.riskAcceptance.version}</VersionTag>
                  </div>
                  <p className="arp-threshold-desc">
                    {thresholdConfigs.riskAcceptance.description}
                  </p>
                </div>
                <div className="arp-threshold">
                  <div className="arp-threshold-head">
                    <span className="arp-threshold-name">{thresholdConfigs.monitoring.name}</span>
                    <VersionTag>{thresholdConfigs.monitoring.version}</VersionTag>
                  </div>
                  <div className="arp-threshold-items">
                    {thresholdConfigs.monitoring.items.map((item) => (
                      <ThresholdItem key={item} text={item} />
                    ))}
                  </div>
                </div>
              </div>

              <div className="arp-warn-foot">
                <StatusTag tone="success">预警已入库</StatusTag>
                <Link to="/warnings/WARN-2026-001" className="arp-warn-detail">
                  查看预警详情
                  <Icon name="arrowRight" size={14} />
                </Link>
              </div>
            </div>
          </Card>
        </div>

        <div className="arp-bottom">
          <Card title="规则与版本">
            <div className="arp-versions">
              <div className="arp-ver-item">
                <div className="arp-ver-head">
                  <span className="arp-ver-name">适用规则集</span>
                  <StatusTag tone="success">已发布</StatusTag>
                </div>
                <div className="arp-ver-meta">
                  <VersionTag>规则集 {assessmentVersions.applicableRuleSet.version}</VersionTag>
                  <span className="arp-ver-sub">{assessmentVersions.applicableRuleSet.name}</span>
                </div>
                <EvidenceLink segmentId="SRC-STD-007-CH02-SEG004" />
              </div>
              <div className="arp-ver-item">
                <div className="arp-ver-head">
                  <span className="arp-ver-name">量化标准</span>
                  <StatusTag tone="success">已冻结</StatusTag>
                </div>
                <div className="arp-ver-meta">
                  <VersionTag>标准 {assessmentVersions.quantStandard.version}</VersionTag>
                  <span className="arp-ver-sub">{assessmentVersions.quantStandard.name}</span>
                </div>
                <EvidenceLink segmentId="SRC-STD-007-CH02-SEG006" />
              </div>
              <div className="arp-ver-item">
                <div className="arp-ver-head">
                  <span className="arp-ver-name">风险矩阵</span>
                  <StatusTag tone="success">已冻结</StatusTag>
                </div>
                <div className="arp-ver-meta">
                  <VersionTag>矩阵 {assessmentVersions.riskMatrix.version}</VersionTag>
                  <span className="arp-ver-sub">{assessmentVersions.riskMatrix.name}</span>
                </div>
                <EvidenceLink segmentId="SRC-STD-007-CH02-SEG007" />
              </div>
              <div className="arp-ver-item">
                <div className="arp-ver-head">
                  <span className="arp-ver-name">适用性元数据快照</span>
                  <StatusTag tone="success">已冻结</StatusTag>
                </div>
                <div className="arp-ver-snapshot">
                  <span>
                    {meta.constructionMethod} / {meta.stratumCondition}
                  </span>
                  <span>{meta.engineeringStage}</span>
                </div>
                <EvidenceLink segmentId="SRC-GEO-001-CH04-SEG018" />
              </div>
            </div>
          </Card>

          <Card
            title="重新评估"
            extra={<StatusTag tone="success">{reAssessment.status}</StatusTag>}
          >
            <div className="arp-re">
              <div className="arp-re-row">
                <span className="arp-re-label">触发原因</span>
                <span>{reAssessment.reason}</span>
              </div>
              <div className="arp-re-row">
                <span className="arp-re-label">生成记录</span>
                <span className="mono">{reAssessment.generatedRecordId}</span>
              </div>
              <div className="arp-re-row">
                <span className="arp-re-label">评估时间</span>
                <span className="mono">
                  {assessmentRecord.audit.createdAt} · {assessmentRecord.audit.createdBy}
                </span>
              </div>
              <p className="arp-re-note">{reAssessment.note}</p>
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}
