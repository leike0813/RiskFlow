import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { RiskBadge } from '../components/RiskBadge'
import { SectionTabs } from '../components/SectionTabs'
import { ConfirmButton } from '../components/ConfirmButton'
import { riskRecords, mainRisk, type RiskLevel, type RiskRecord } from '../content/risks'
import { assessmentRecord, reAssessment, assessmentVersions } from '../content/assessment'

const tabs = [
  { to: '/assessment', label: '待评估' },
  { to: '/assessment/records', label: '评估记录' },
]

/** 待评估队列：已入库待评估风险（首行为主线风险） */
const pendingRisks: RiskRecord[] = riskRecords.slice(0, 4)

function startAssessmentSummary(r: RiskRecord) {
  return [
    `评估对象：${r.id} ${r.riskEvent}`,
    `冻结依据：适用性元数据快照 · 监测快照 2026-08-27 批次 · 适用规则集 ${assessmentVersions.applicableRuleSet.version} · ${assessmentVersions.riskMatrix.name} ${assessmentVersions.riskMatrix.version}`,
    '预计结果：生成风险评估记录；命中触发条件时生成预警信息并进入处置流程',
  ]
}

const pendingColumns: DataTableColumn[] = [
  {
    key: 'id',
    title: '风险标识',
    width: 150,
    render: (row) => <span className="mono">{row.id as string}</span>,
  },
  { key: 'processName', title: '工序节点', width: 140 },
  { key: 'riskEvent', title: '风险事件' },
  {
    key: 'level',
    title: '当前等级',
    width: 110,
    render: (row) => <RiskBadge level={row.level as RiskLevel} />,
  },
  {
    key: 'compositeConfidence',
    title: '综合置信度',
    width: 110,
    align: 'center',
    render: (row) => <span className="mono">{(row.compositeConfidence as number).toFixed(2)}</span>,
  },
  { key: 'source', title: '来源', width: 130 },
  {
    key: 'action',
    title: '操作',
    width: 130,
    render: (row) => (
      <ConfirmButton
        label="启动评估"
        summary={startAssessmentSummary(row as unknown as RiskRecord)}
      />
    ),
  },
]

const reassessColumns: DataTableColumn[] = [
  {
    key: 'riskId',
    title: '风险标识',
    width: 150,
    render: (row) => <span className="mono">{row.riskId as string}</span>,
  },
  { key: 'riskEvent', title: '风险事件' },
  { key: 'reason', title: '触发原因', width: 170 },
  { key: 'snapshot', title: '依据快照', width: 190 },
  {
    key: 'lastAssessment',
    title: '上次评估',
    width: 170,
    render: () => (
      <Link to={`/assessment/records/${assessmentRecord.id}`} className="mono">
        {assessmentRecord.id}
      </Link>
    ),
  },
  {
    key: 'action',
    title: '操作',
    width: 140,
    render: () => (
      <ConfirmButton
        label="启动重新评估"
        summary={[
          `评估对象：${mainRisk.id} ${mainRisk.riskEvent}`,
          `触发原因：${reAssessment.reason}（监测批次 2026-08-27）`,
          `冻结依据：适用性元数据快照 · 监测快照 2026-08-27 批次 · 适用规则集 ${assessmentVersions.applicableRuleSet.version} · ${assessmentVersions.riskMatrix.name} ${assessmentVersions.riskMatrix.version}`,
          '预计结果：生成新的风险评估记录，历史记录只追加、不覆盖',
        ]}
      />
    ),
  },
]

export default function PendingAssessmentPage() {
  return (
    <AppShell activeNav="assessment" agentContext={['评估候选队列']}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">待评估风险</h1>
            <p className="page-subtitle">查看评估候选队列并启动风险评估</p>
          </div>
        </header>
        <SectionTabs items={tabs} />

        <Card title="待评估队列" extra={<span>已入库标准化风险记录 · {pendingRisks.length} 项</span>}>
          <DataTable
            columns={pendingColumns}
            rows={pendingRisks.map((r) => ({ ...r, source: '识别入库' }))}
          />
        </Card>

        <Card
          title="待重新评估"
          extra={<span>{reAssessment.note}</span>}
          style={{ marginTop: 16 }}
        >
          <DataTable
            columns={reassessColumns}
            rows={[
              {
                riskId: mainRisk.id,
                riskEvent: mainRisk.riskEvent,
                reason: reAssessment.reason,
                snapshot: '监测批次 2026-08-27',
              },
            ]}
          />
        </Card>
      </div>
    </AppShell>
  )
}
