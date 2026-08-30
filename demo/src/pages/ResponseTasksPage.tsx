import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { KpiCard } from '../components/KpiCard'
import { RiskBadge } from '../components/RiskBadge'
import { SectionTabs } from '../components/SectionTabs'
import { StatusTag } from '../components/StatusTag'
import { projectContext } from '../content/context'
import { responseRecommendation, responseTaskList } from '../content/response'
import type { RiskLevel } from '../content/risks'
import './ResponseTasksPage.css'

const taskRows = responseTaskList.map((t) => ({
  id: t.id,
  title: t.title,
  project: projectContext.project,
  riskId: t.riskRecordId,
  scope: projectContext.section,
  warningIds: t.warningIds.join('、'),
  openWarningCount: t.openWarningCount,
  highestLevel: t.highestLevel,
  ownerRole: t.ownerRole,
  progress: t.progress,
}))

const totalOpenWarnings = responseTaskList.reduce((sum, t) => sum + t.openWarningCount, 0)

const columns: DataTableColumn[] = [
  {
    key: 'id',
    title: '任务标识',
    width: 300,
    render: (row) => (
      <div className="rt-id-cell">
        <div className="rt-title">{row.title as string}</div>
        <div className="rt-sub mono">{row.id as string}</div>
      </div>
    ),
  },
  { key: 'project', title: '工程' },
  {
    key: 'riskId',
    title: '风险稳定身份',
    width: 160,
    render: (row) => <span className="mono">{row.riskId as string}</span>,
  },
  { key: 'scope', title: '空间范围', width: 170 },
  {
    key: 'warningIds',
    title: '归集预警',
    width: 150,
    render: (row) => <span className="mono">{row.warningIds as string}</span>,
  },
  { key: 'openWarningCount', title: '未关闭预警', width: 100, align: 'center' },
  {
    key: 'highestLevel',
    title: '最高等级',
    width: 100,
    render: (row) => <RiskBadge level={row.highestLevel as RiskLevel} />,
  },
  { key: 'ownerRole', title: '责任人角色', width: 120 },
  {
    key: 'progress',
    title: '执行进度',
    width: 150,
    render: (row) => <StatusTag tone="running">{row.progress as string}</StatusTag>,
  },
]

export default function ResponseTasksPage() {
  const navigate = useNavigate()

  return (
    <AppShell activeNav="warnings" agentContext={['预警处置任务']}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">预警处置任务</h1>
            <p className="page-subtitle">按工程 + 风险稳定身份 + 处置空间范围归集的处置闭环任务</p>
          </div>
        </header>

        <SectionTabs
          items={[
            { to: '/warnings', label: '预警中心' },
            { to: '/warnings/tasks', label: '处置任务' },
          ]}
        />

        <div className="rt-kpis">
          <KpiCard label="归集处置任务" value={responseTaskList.length} unit="项" />
          <KpiCard
            label="未关闭预警"
            value={totalOpenWarnings}
            unit="项"
            tag="含红色预警"
            tone="risk"
          />
          <KpiCard label="任务最高等级" value="I 级" tone="risk" />
          <KpiCard
            label="关联处置建议"
            value={responseRecommendation.version}
            tag={responseRecommendation.reviewStatus}
          />
        </div>

        <Card title="处置任务列表" extra={<span>首行任务可进入风险详情与处置闭环</span>}>
          <DataTable
            columns={columns}
            rows={taskRows}
            onRowClick={(row) => {
              if (row.riskId === 'RISK-2026-001') navigate(`/risks/${row.riskId as string}`)
            }}
          />
        </Card>
      </div>
    </AppShell>
  )
}
