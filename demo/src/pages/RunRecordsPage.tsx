import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { PageStateView } from '../components/PageStateView'
import { SectionTabs } from '../components/SectionTabs'
import { StatusTag } from '../components/StatusTag'
import { useEngineering, usePageQuery, useProjectPath } from '../api/context'
import {
  listIdentificationRuns,
  readRiskOverviewRuns,
  type IdentificationRunListPageView,
  type KindRef,
  type RunSummaryItemView,
} from '../api/operations'
import { RunStatusTag, STAGE_LABEL } from './identificationShared'
import './RunRecordsPage.css'

const reviewTabs = [
  { to: '/review', label: '复核队列' },
  { to: '/review/trace', label: '证据追溯' },
  { to: '/review/runs', label: '运行记录' },
]

/** 识别运行表：行可跳识别运行详情；触发原因仅在服务端返回登记事实时呈现。 */
function IdentificationRunsSection() {
  const projectPath = useProjectPath()
  const { state, retry } = usePageQuery<IdentificationRunListPageView>(
    (projectId, signal) => listIdentificationRuns(projectId, {}, signal),
    [],
  )

  const columns: DataTableColumn[] = [
    {
      key: 'runRef',
      title: '运行标识',
      width: 210,
      render: (row) => {
        const entityId = (row.runRef as KindRef).reference.entityId
        return (
          <Link to={projectPath(`/identification/runs/${encodeURIComponent(entityId)}`)} className="mono">
            {entityId}
          </Link>
        )
      },
    },
    {
      key: 'type',
      title: '类型',
      width: 80,
      render: () => <StatusTag tone="neutral">识别</StatusTag>,
    },
    {
      key: 'status',
      title: '状态',
      width: 110,
      render: (row) => <RunStatusTag status={row.status as string} />,
    },
    {
      key: 'stage',
      title: '阶段',
      width: 190,
      render: (row) => {
        const stage = row.stage as string
        const label = STAGE_LABEL[stage]
        return (
          <span>
            <span className="mono">{stage}</span>
            {label !== undefined && <span className="rr-dim"> · {label}</span>}
          </span>
        )
      },
    },
    { key: 'startedBy', title: '启动者', width: 130 },
    {
      key: 'startedAt',
      title: '启动时间',
      width: 200,
      render: (row) => <span className="mono">{row.startedAt as string}</span>,
    },
    {
      key: 'triggerReason',
      title: '触发原因',
      render: (row) => {
        const reason = row.triggerReason as string | undefined
        return reason === undefined ? <span className="rr-dim">—</span> : <span>{reason}</span>
      },
    },
  ]

  return (
    <PageStateView
      state={state}
      title="识别运行"
      emptyMessage="当前工程暂无识别运行"
      forbiddenHint="当前角色不具备识别运行的读取权限"
      onRetry={retry}
    >
      {(page) => (
        <Card title="识别运行" extra={<span>来源：risk-identification.run-list · 行点击进入详情</span>}>
          {page.items.length === 0 ? (
            <div className="rr-dim">当前工程暂无识别运行</div>
          ) : (
            <DataTable columns={columns} rows={page.items.map((item) => ({ ...item }))} />
          )}
          {page.nextCursor !== undefined && (
            <div className="rr-dim">结果按游标分页，当前呈现第一页</div>
          )}
        </Card>
      )}
    </PageStateView>
  )
}

type ChainRunsResult =
  | { readonly kind: 'no-revision' }
  | { readonly kind: 'page'; readonly items: RunSummaryItemView[] }

/** 评估/处置链运行表：risk-overview 投影 run-summary 条目；条目不含启动时间/操作者，不编造。 */
function ChainRunsSection() {
  const { state: engineeringState } = useEngineering()
  const revisionRef =
    engineeringState.kind === 'ready' ? engineeringState.value.currentProjectRevisionRef : undefined
  const { state, retry } = usePageQuery<ChainRunsResult>(
    async (projectId, signal) => {
      if (revisionRef === undefined) return { kind: 'no-revision' }
      return { kind: 'page', items: await readRiskOverviewRuns(projectId, revisionRef, signal) }
    },
    [revisionRef?.reference.entityId, revisionRef?.reference.versionId],
  )

  const columns: DataTableColumn[] = [
    {
      key: 'workflowRunRef',
      title: '运行标识',
      width: 210,
      render: (row) => (
        <span className="mono">{(row.workflowRunRef as KindRef).reference.entityId}</span>
      ),
    },
    {
      key: 'type',
      title: '类型',
      width: 80,
      render: () => <StatusTag tone="neutral">链运行</StatusTag>,
    },
    {
      key: 'status',
      title: '状态',
      width: 110,
      render: (row) => <RunStatusTag status={row.status as string} />,
    },
    {
      key: 'entryIdentity',
      title: '入口身份',
      render: (row) => (
        <span className="mono">
          {(row.entryIdentity as { entityId: string; versionId: string }).entityId}
        </span>
      ),
    },
    {
      key: 'parentRunRef',
      title: '父运行',
      width: 210,
      render: (row) => {
        const parent = row.parentRunRef as KindRef | undefined
        return parent === undefined ? (
          <span className="rr-dim">—</span>
        ) : (
          <span className="mono">{parent.reference.entityId}</span>
        )
      },
    },
  ]

  return (
    <PageStateView
      state={state}
      title="评估与处置链运行"
      emptyMessage="当前工程修订暂无链运行投影"
      forbiddenHint="暂无可证明的链运行摘要，或当前角色不具备投影读取权限"
      onRetry={retry}
    >
      {(result) => (
        <Card title="评估与处置链运行" extra={<span>来源：risk-overview 投影 · 只读</span>}>
          {result.kind === 'no-revision' ? (
            <div className="rr-dim">工程修订尚未就绪，链运行摘要暂不可用</div>
          ) : result.items.length === 0 ? (
            <div className="rr-dim">当前工程修订暂无链运行投影</div>
          ) : (
            <DataTable columns={columns} rows={result.items.map((item) => ({ ...item }))} />
          )}
        </Card>
      )}
    </PageStateView>
  )
}

export default function RunRecordsPage() {
  return (
    <AppShell activeNav="review" agentContext={['运行记录']}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">运行记录</h1>
            <p className="page-subtitle">识别运行与评估/处置链运行的只读聚合视图</p>
          </div>
        </header>

        <SectionTabs items={reviewTabs} />

        <IdentificationRunsSection />
        <div style={{ marginTop: 16 }}>
          <ChainRunsSection />
        </div>
      </div>
    </AppShell>
  )
}
