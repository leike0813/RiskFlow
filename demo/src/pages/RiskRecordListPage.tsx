import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { RiskBadge } from '../components/RiskBadge'
import { StatusTag } from '../components/StatusTag'
import { SectionTabs } from '../components/SectionTabs'
import { riskRecords, mainRisk, type RiskLevel } from '../content/risks'
import { reviewTasks } from '../content/review'
import './RiskRecordListPage.css'

const tabs = [
  { to: '/identification', label: '识别任务' },
  { to: '/identification/records', label: '风险记录' },
  { to: '/identification/graph', label: '关联图谱' },
  { to: '/identification/process-model', label: '工序模型' },
]

const levelOptions: { value: string; label: string }[] = [
  { value: 'all', label: '全部等级' },
  { value: 'I', label: 'I 级' },
  { value: 'II', label: 'II 级' },
  { value: 'III', label: 'III 级' },
  { value: 'IV', label: 'IV 级' },
]

/** 验收方式：复核队列中的识别候选为人工验收，其余按自动验收 */
function acceptanceOf(riskId: string) {
  const task = reviewTasks.find((t) => t.type === '识别候选复核' && t.targetId === riskId)
  if (!task) return <span className="records-dim">自动验收</span>
  return task.status === '待复核' ? (
    <StatusTag tone="review">人工复核 · 待复核</StatusTag>
  ) : (
    <StatusTag tone="success">人工复核 · 已通过</StatusTag>
  )
}

export default function RiskRecordListPage() {
  const navigate = useNavigate()
  const [level, setLevel] = useState('all')

  const records = level === 'all' ? riskRecords : riskRecords.filter((r) => r.level === level)

  const columns: DataTableColumn[] = [
    {
      key: 'id',
      title: '记录标识',
      width: 150,
      render: (row) => <span className="mono">{row.id as string}</span>,
    },
    { key: 'processName', title: '工序节点', width: 130 },
    { key: 'riskEvent', title: '风险事件' },
    { key: 'mechanismType', title: '机理类型', width: 150 },
    {
      key: 'level',
      title: '等级',
      width: 100,
      render: (row) => <RiskBadge level={row.level as RiskLevel} />,
    },
    {
      key: 'compositeConfidence',
      title: '综合置信度',
      width: 110,
      align: 'center',
      render: (row) => <span className="mono">{(row.compositeConfidence as number).toFixed(2)}</span>,
    },
    {
      key: 'acceptance',
      title: '验收方式',
      width: 170,
      render: (row) => acceptanceOf(row.id as string),
    },
  ]

  return (
    <AppShell activeNav="identification" agentContext={['标准化风险记录 12 项']}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">标准化风险记录</h1>
            <p className="page-subtitle">查看全部标准化风险记录及其综合置信度与验收状态</p>
          </div>
        </header>
        <SectionTabs items={tabs} />

        <Card
          title="风险记录"
          extra={
            <>
              <span>共 {records.length} 项</span>
              <select
                className="records-filter"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                aria-label="按等级筛选"
              >
                {levelOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </>
          }
        >
          <DataTable
            columns={columns}
            rows={records.map((r) => ({ ...r }))}
            onRowClick={(row) => {
              if (row.id === mainRisk.id) navigate(`/risks/${mainRisk.id}`)
            }}
          />
        </Card>
      </div>
    </AppShell>
  )
}
