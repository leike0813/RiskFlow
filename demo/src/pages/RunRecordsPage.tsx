import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { ConfirmButton } from '../components/ConfirmButton'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { KpiCard } from '../components/KpiCard'
import { SectionTabs } from '../components/SectionTabs'
import { StatusTag } from '../components/StatusTag'
import { VersionTag } from '../components/VersionTag'
import { runRecords, type RunRecord } from '../content/review'
import './RunRecordsPage.css'

const countByType = (type: RunRecord['type']) => runRecords.filter((r) => r.type === type).length

const replaySummary = (run: RunRecord) => [
  `对象：${run.type}运行 ${run.runId}（${run.graph} ${run.graphVersion}）`,
  `输入快照：${run.triggerReason}（启动时间 ${run.startedAt}）`,
  '审计重放使用冻结的输入快照与版本引用复算运行过程，不重新调用模型',
  '重放不产生新业务事实，结果仅用于审计核对',
]

const columns: DataTableColumn[] = [
  {
    key: 'runId',
    title: '运行标识',
    width: 190,
    render: (row) =>
      row.runId === 'RUN-20260827-001' ? (
        <Link to={`/identification/runs/${row.runId as string}`} className="mono">
          {row.runId as string}
        </Link>
      ) : (
        <span className="mono">{row.runId as string}</span>
      ),
  },
  {
    key: 'type',
    title: '类型',
    width: 90,
    render: (row) => <StatusTag tone="neutral">{row.type as string}</StatusTag>,
  },
  {
    key: 'graph',
    title: '图',
    width: 180,
    render: (row) => <span className="mono">{row.graph as string}</span>,
  },
  {
    key: 'graphVersion',
    title: '图版本',
    width: 90,
    render: (row) => <VersionTag>{row.graphVersion as string}</VersionTag>,
  },
  {
    key: 'status',
    title: '状态',
    width: 100,
    render: (row) => <StatusTag tone="success">{row.status as string}</StatusTag>,
  },
  { key: 'triggerReason', title: '输入快照（触发原因）' },
  {
    key: 'startedAt',
    title: '启动时间',
    width: 170,
    render: (row) => <span className="mono">{row.startedAt as string}</span>,
  },
  { key: 'operator', title: '操作者', width: 120 },
  {
    key: 'actions',
    title: '操作',
    width: 120,
    render: (row) => {
      const run = row as unknown as RunRecord
      return (
        <div className="rr-actions">
          <ConfirmButton label="审计重放" summary={replaySummary(run)} />
        </div>
      )
    },
  },
]

export default function RunRecordsPage() {
  return (
    <AppShell activeNav="review" agentContext={['LangGraph 运行记录']}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">运行记录</h1>
            <p className="page-subtitle">全部 LangGraph 运行的状态、图版本、输入快照与审计入口</p>
          </div>
        </header>

        <SectionTabs
          items={[
            { to: '/review', label: '复核队列' },
            { to: '/review/trace', label: '证据追溯' },
            { to: '/review/runs', label: '运行记录' },
          ]}
        />

        <div className="rr-kpis">
          <KpiCard label="运行总数" value={runRecords.length} unit="次" />
          <KpiCard label="识别运行" value={countByType('识别')} unit="次" tag="identificationGraph" />
          <KpiCard label="评估运行" value={countByType('评估')} unit="次" tag="assessmentGraph" />
          <KpiCard label="预测运行" value={countByType('预测')} unit="次" tag="assessmentGraph" />
        </div>

        <Card title="运行列表" extra={<span>审计重放与重新运行为不同命令</span>}>
          <DataTable columns={columns} rows={runRecords.map((r) => ({ ...r }))} />
        </Card>
      </div>
    </AppShell>
  )
}
