import { useNavigate, Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { RiskBadge } from '../components/RiskBadge'
import { SectionTabs } from '../components/SectionTabs'
import { VersionTag } from '../components/VersionTag'
import { mainRisk } from '../content/risks'
import {
  assessmentRecord,
  reAssessment,
  assessmentVersions,
  applicabilityMetadataSnapshot,
} from '../content/assessment'
import './AssessmentRecordsPage.css'

const tabs = [
  { to: '/assessment', label: '待评估' },
  { to: '/assessment/records', label: '评估记录' },
]

const versionRefs = [
  assessmentVersions.applicableRuleSet,
  assessmentVersions.quantStandard,
  assessmentVersions.riskMatrix,
]

export default function AssessmentRecordsPage() {
  const navigate = useNavigate()

  const columns: DataTableColumn[] = [
    {
      key: 'id',
      title: '记录标识',
      width: 170,
      render: (row) => <span className="mono">{row.id as string}</span>,
    },
    {
      key: 'risk',
      title: '风险',
      render: (row) => (
        <span>
          <span className="mono assessment-risk-id">{mainRisk.id}</span>
          {row.riskEvent as string}
        </span>
      ),
    },
    { key: 'p', title: 'P', width: 60, align: 'center' },
    { key: 'c', title: 'C', width: 60, align: 'center' },
    {
      key: 'level',
      title: '等级',
      width: 100,
      render: (row) => <RiskBadge level={row.level as typeof mainRisk.level} />,
    },
    { key: 'triggers', title: '触发指标数', width: 100, align: 'center' },
    {
      key: 'versions',
      title: '规则集 / 矩阵版本',
      width: 220,
      render: () => (
        <span className="assessment-versions">
          <VersionTag>规则集 {assessmentRecord.applicableRuleSetVersion}</VersionTag>
          <VersionTag>矩阵 {assessmentRecord.riskMatrixVersion}</VersionTag>
        </span>
      ),
    },
    {
      key: 'createdAt',
      title: '评估时间',
      width: 160,
      render: (row) => <span className="mono">{row.createdAt as string}</span>,
    },
  ]

  const rows = [
    {
      id: assessmentRecord.id,
      riskEvent: mainRisk.riskEvent,
      p: assessmentRecord.likelihoodScore,
      c: assessmentRecord.consequenceScore,
      level: assessmentRecord.riskLevel,
      triggers: assessmentRecord.triggerIndicators.length,
      createdAt: assessmentRecord.audit.createdAt,
    },
  ]

  return (
    <AppShell activeNav="assessment" agentContext={['风险评估记录']}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">风险评估记录</h1>
            <p className="page-subtitle">查看风险评估记录及其 P/C、风险等级与版本引用</p>
          </div>
        </header>
        <SectionTabs items={tabs} />

        <Card title="评估记录" extra={<span>历史记录只追加、不覆盖</span>}>
          <DataTable
            columns={columns}
            rows={rows}
            onRowClick={() => navigate(`/assessment/records/${assessmentRecord.id}`)}
          />
        </Card>

        <div className="assessment-bottom">
          <Card title="重新评估历史">
            <ul className="assessment-history">
              <li className="assessment-history-item">
                <span className="assessment-history-label">触发原因</span>
                <span>{reAssessment.reason}</span>
              </li>
              <li className="assessment-history-item">
                <span className="assessment-history-label">生成记录</span>
                <Link to={`/assessment/records/${assessmentRecord.id}`} className="mono">
                  {reAssessment.generatedRecordId}
                </Link>
              </li>
              <li className="assessment-history-item">
                <span className="assessment-history-label">状态</span>
                <span>{reAssessment.status}</span>
              </li>
              <li className="assessment-history-item">
                <span className="assessment-history-label">适用性元数据快照</span>
                <span>
                  {applicabilityMetadataSnapshot.constructionMethod} ·{' '}
                  {applicabilityMetadataSnapshot.stratumCondition} ·{' '}
                  {applicabilityMetadataSnapshot.engineeringStage}
                </span>
              </li>
            </ul>
          </Card>

          <Card title="评估依据版本">
            <ul className="assessment-history">
              {versionRefs.map((v) => (
                <li key={v.id} className="assessment-history-item">
                  <span className="assessment-history-label">{v.name}</span>
                  <span className="assessment-version-ref">
                    <span className="mono assessment-risk-id">{v.id}</span>
                    <VersionTag>{v.version}</VersionTag>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}
