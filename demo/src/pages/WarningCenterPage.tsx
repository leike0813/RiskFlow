import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { KpiCard } from '../components/KpiCard'
import { RiskBadge } from '../components/RiskBadge'
import { SectionTabs } from '../components/SectionTabs'
import { StatusTag } from '../components/StatusTag'
import { WarningBadge } from '../components/WarningBadge'
import { projectContext } from '../content/context'
import { warningList, warningRecord } from '../content/response'
import { mainRisk, overviewStats, riskRecords } from '../content/risks'
import './WarningCenterPage.css'

const triggerTypeFilters = ['全部', ...warningRecord.triggerTypes]

const riskLevelById = new Map(riskRecords.map((r) => [r.id, r.level]))

const warningRows = warningList.map((w) => ({
  id: w.id,
  level: w.level,
  status: w.status,
  riskLevel: riskLevelById.get(w.riskRecordId) ?? mainRisk.level,
  riskEvent: w.riskEvent,
  triggerTypes: w.triggerTypes.join('、'),
  triggerSummary: w.triggerSummary,
  section: projectContext.section,
  notificationStatus: w.notificationStatus,
  taskId: w.taskId,
  types: w.triggerTypes,
}))

export default function WarningCenterPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState('全部')

  const rows =
    filter === '全部' ? warningRows : warningRows.filter((r) => r.types.includes(filter))

  const columns: DataTableColumn[] = [
    {
      key: 'id',
      title: '预警标识',
      width: 260,
      render: (row) => (
        <div className="wc-id-cell">
          <span className="mono">{row.id as string}</span>
          <WarningBadge text={`${row.level} · ${row.status}`} />
        </div>
      ),
    },
    {
      key: 'riskLevel',
      title: '等级',
      width: 100,
      render: (row) => <RiskBadge level={row.riskLevel as typeof mainRisk.level} />,
    },
    { key: 'riskEvent', title: '风险事件' },
    { key: 'triggerTypes', title: '触发类型', width: 220 },
    { key: 'triggerSummary', title: '触发指标摘要', width: 240 },
    { key: 'section', title: '区段', width: 170 },
    {
      key: 'notificationStatus',
      title: '通知状态',
      width: 130,
      render: (row) => <StatusTag tone="neutral">{row.notificationStatus as string}</StatusTag>,
    },
    {
      key: 'taskId',
      title: '关联任务',
      width: 160,
      render: (row) => (
        <Link to="/warnings/tasks" className="mono" onClick={(e) => e.stopPropagation()}>
          {row.taskId as string}
        </Link>
      ),
    },
  ]

  return (
    <AppShell activeNav="warnings" agentContext={['生效预警 4 项', '待处置 3 项']}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">预警中心</h1>
            <p className="page-subtitle">预警信息列表、触发类型与通知状态，点击行进入预警详情</p>
          </div>
        </header>

        <SectionTabs
          items={[
            { to: '/warnings', label: '预警中心' },
            { to: '/warnings/tasks', label: '处置任务' },
          ]}
        />

        <div className="wc-kpis">
          <KpiCard label="生效预警" value={overviewStats.activeWarnings} unit="项" tag="应用内通知" />
          <KpiCard
            label="待处置"
            value={overviewStats.pendingResponse}
            unit="项"
            tag={`含红色预警 ${overviewStats.levelCounts.I} 项`}
            tone="risk"
          />
          <KpiCard
            label="已确认"
            value={overviewStats.activeWarnings - overviewStats.pendingResponse}
            unit="项"
          />
          <KpiCard label="最高预警等级" value={warningRecord.level} tag="I 级风险" tone="risk" />
        </div>

        <Card title="预警信息列表" extra={<span>数据时点 {projectContext.dataTimestamp}</span>}>
          <div className="wc-filter">
            <span className="wc-filter-label">触发类型</span>
            {triggerTypeFilters.map((t) => (
              <button
                key={t}
                type="button"
                className={`wc-chip${filter === t ? ' wc-chip--active' : ''}`}
                onClick={() => setFilter(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {rows.length > 0 ? (
            <DataTable
              columns={columns}
              rows={rows}
              onRowClick={(row) => {
                if (row.id === warningRecord.id) navigate(`/warnings/${row.id as string}`)
              }}
            />
          ) : (
            <div className="wc-empty">当前触发类型筛选下无预警信息</div>
          )}
        </Card>
      </div>
    </AppShell>
  )
}
