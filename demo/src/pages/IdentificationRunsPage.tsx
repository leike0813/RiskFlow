import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { KpiCard } from '../components/KpiCard'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { StatusTag } from '../components/StatusTag'
import { SectionTabs } from '../components/SectionTabs'
import { ConfirmButton } from '../components/ConfirmButton'
import { runRecords, reviewTasks } from '../content/review'
import { riskRecords, overviewStats } from '../content/risks'
import { documentCatalog } from '../content/evidence'
import { agentRunSummary } from '../content/agent'
import { projectContext } from '../content/context'
import './IdentificationRunsPage.css'

const tabs = [
  { to: '/identification', label: '识别任务' },
  { to: '/identification/records', label: '风险记录' },
  { to: '/identification/graph', label: '关联图谱' },
  { to: '/identification/process-model', label: '工序模型' },
]

const DETAIL_RUN_ID = 'RUN-20260827-001'

export default function IdentificationRunsPage() {
  const navigate = useNavigate()
  const runs = runRecords.filter((r) => r.type === '识别')
  const reviewCount = reviewTasks.filter((t) => t.type === '识别候选复核').length

  const columns: DataTableColumn[] = [
    {
      key: 'runId',
      title: '运行标识',
      width: 190,
      render: (row) => <span className="mono">{row.runId as string}</span>,
    },
    {
      key: 'status',
      title: '状态',
      width: 110,
      render: (row) => <StatusTag tone="success">{row.status as string}</StatusTag>,
    },
    { key: 'stage', title: '阶段', width: 170 },
    { key: 'triggerReason', title: '触发原因', width: 180 },
    { key: 'operator', title: '启动者', width: 130 },
    {
      key: 'acceptReview',
      title: '验收 / 复核',
      width: 120,
      align: 'center',
      render: (row) =>
        row.runId === DETAIL_RUN_ID ? (
          <span className="mono">{`${riskRecords.length} / ${reviewCount}`}</span>
        ) : (
          <span className="runs-dim">—</span>
        ),
    },
    {
      key: 'startedAt',
      title: '启动时间',
      render: (row) => <span className="mono">{row.startedAt as string}</span>,
    },
  ]

  const rows = runs.map((r) => ({
    ...r,
    stage: '校验与入库（I6–I9）',
  }))

  return (
    <AppShell activeNav="identification" agentContext={['变径空间扩挖', 'identificationGraph V1']}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">识别任务</h1>
            <p className="page-subtitle">查看与管理 LangGraph 风险识别运行</p>
          </div>
          <ConfirmButton
            label="启动识别"
            summary={[
              `工程：${projectContext.project} · ${projectContext.section}`,
              `资料范围：全部业务可用资料 ${documentCatalog.length} 份（含监测数据 2026-08-27 批次）`,
              `待用版本：工序模型 V1.0 · 风险机理库 6 条已发布 · identificationGraph ${agentRunSummary.graphVersion} · 模型 ${agentRunSummary.model}`,
              '预计结果：生成标准化风险记录并入库，低置信度候选进入人工复核队列',
            ]}
          />
        </header>
        <SectionTabs items={tabs} />

        <div className="runs-kpis">
          <KpiCard label="识别运行" value={runs.length} unit="次" tag="identificationGraph V1" />
          <KpiCard label="标准化风险记录" value={overviewStats.total} unit="项" tag="已入库" />
          <KpiCard
            label="待人工复核"
            value={overviewStats.pendingReview}
            unit="项"
            tag="复核队列"
          />
        </div>

        <Card title="识别运行列表" extra={<span>行点击进入运行详情</span>} style={{ marginTop: 16 }}>
          <DataTable
            columns={columns}
            rows={rows}
            onRowClick={(row) => {
              if (row.runId === DETAIL_RUN_ID) navigate(`/identification/runs/${DETAIL_RUN_ID}`)
            }}
          />
        </Card>
      </div>
    </AppShell>
  )
}
