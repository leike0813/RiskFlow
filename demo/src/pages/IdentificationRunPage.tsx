import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { PageStateView } from '../components/PageStateView'
import { SectionTabs } from '../components/SectionTabs'
import { StageBar, type StageItem } from '../components/StageBar'
import { StatusTag } from '../components/StatusTag'
import { ApiError } from '../api/client'
import { usePageQuery, useProjectPath } from '../api/context'
import {
  listIdentificationRuns,
  readIdentificationRun,
  type IdentificationRunDetailView,
} from '../api/operations'
import {
  ACCEPTANCE_KIND_LABEL,
  identificationTabs,
  MERGE_GROUP_STATUS_LABEL,
  MERGE_GROUP_STATUS_TONE,
  RunStatusTag,
  STAGE_LABEL,
  TERMINAL_RUN_STATUSES,
} from './identificationShared'
import './IdentificationRunPage.css'

const STAGE_ORDER = ['I0', 'I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9'] as const

const POLL_INTERVAL_MS = 5000

interface RunDetailPageData {
  readonly detail: IdentificationRunDetailView
  readonly startedBy: string
  readonly startedAt: string
  readonly triggerReason?: string
}

const workItemColumns: DataTableColumn[] = [
  { key: 'processNodeId', title: '工序节点', width: 160, render: (row) => <span className="mono">{row.processNodeId as string}</span> },
  {
    key: 'workItemRef',
    title: '工作项标识',
    render: (row) => (
      <span className="mono">
        {(row.workItemRef as { reference: { entityId: string } }).reference.entityId}
      </span>
    ),
  },
  {
    key: 'status',
    title: '状态',
    width: 120,
    render: (row) => <RunStatusTag status={row.status as string} />,
  },
]

const mergeGroupColumns: DataTableColumn[] = [
  {
    key: 'groupRef',
    title: '合并组标识',
    render: (row) => (
      <span className="mono">
        {(row.groupRef as { reference: { entityId: string } }).reference.entityId}
      </span>
    ),
  },
  {
    key: 'status',
    title: '归集状态',
    width: 120,
    render: (row) => {
      const status = row.status as string
      return (
        <StatusTag tone={MERGE_GROUP_STATUS_TONE[status] ?? 'neutral'}>
          {MERGE_GROUP_STATUS_LABEL[status] ?? status}
        </StatusTag>
      )
    },
  },
  {
    key: 'acceptanceKind',
    title: '验收方式',
    width: 140,
    render: (row) => {
      const kind = row.acceptanceKind as string | undefined
      return kind === undefined ? (
        <span className="idrun-dim">—</span>
      ) : (
        <span>{ACCEPTANCE_KIND_LABEL[kind] ?? kind}</span>
      )
    },
  },
]

export default function IdentificationRunPage() {
  const { runId } = useParams<{ runId: string }>()
  const projectPath = useProjectPath()
  const { state, retry } = usePageQuery<RunDetailPageData>(
    async (projectId, signal) => {
      // runRef 需要精确版本：先经 run-list 按实体标识解析出完整引用，再精确读取。
      const list = await listIdentificationRuns(projectId, {}, signal)
      const item = list.items.find((entry) => entry.runRef.reference.entityId === runId)
      if (item === undefined) throw new ApiError('NOT_FOUND')
      const detail = await readIdentificationRun(projectId, item.runRef, signal)
      return {
        detail,
        startedBy: item.startedBy,
        startedAt: item.startedAt,
        ...(item.triggerReason === undefined ? {} : { triggerReason: item.triggerReason }),
      }
    },
    [runId],
  )

  // 运行监控骨架：非终态定间隔轮询，进入终态停止。
  const status = state.kind === 'ready' ? state.value.detail.status : null
  useEffect(() => {
    if (status === null || TERMINAL_RUN_STATUSES.includes(status)) return
    const timer = setInterval(() => retry(), POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [status, retry])

  return (
    <AppShell
      activeNav="identification"
      agentContext={runId === undefined ? [] : [runId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">识别运行详情</h1>
            <p className="page-subtitle">
              运行 <span className="mono">{runId ?? ''}</span>
            </p>
          </div>
          {state.kind === 'ready' && (
            <div className="idrun-header-tags">
              <RunStatusTag status={state.value.detail.status} />
              <StatusTag tone="neutral">
                {state.value.detail.stage} · {STAGE_LABEL[state.value.detail.stage] ?? ''}
              </StatusTag>
            </div>
          )}
        </header>
        <SectionTabs items={identificationTabs} />

        <PageStateView
          state={state}
          title="识别运行详情"
          emptyMessage="未找到该识别运行"
          forbiddenHint="当前角色不具备查看识别运行的权限，或该运行不存在"
          onRetry={retry}
        >
          {({ detail, startedBy, startedAt, triggerReason }) => {
            const stageItems: StageItem[] = STAGE_ORDER.map((stage) => {
              const entry = detail.stageEntries.find((e) => e.stage === stage)
              const label = STAGE_LABEL[stage] ?? ''
              if (entry === undefined) return { id: stage, label, status: 'pending' }
              if (entry.status === 'completed') return { id: stage, label, status: 'done' }
              const failedStage =
                entry.status === 'retryable-failure' || entry.status === 'terminal-failure'
              return {
                id: stage,
                label,
                ...(entry.failureCode === undefined ? {} : { hint: entry.failureCode }),
                status: failedStage ? 'failed' : 'current',
              }
            })
            const failedEntry = detail.stageEntries.find(
              (entry) =>
                entry.status === 'retryable-failure' || entry.status === 'terminal-failure',
            )
            return (
              <>
                {detail.waitingRef !== undefined && (
                  <Card title="当前等待">
                    <div className="idrun-waiting">
                      {detail.waitingRef.kind === 'review'
                        ? '运行暂停，等待人工复核'
                        : `运行暂停，等待 ${detail.waitingRef.kind}`}
                      {detail.waitingRef.ref !== undefined && (
                        <span className="mono idrun-dim">
                          {detail.waitingRef.ref.reference.entityId}
                        </span>
                      )}
                    </div>
                  </Card>
                )}

                <Card title="识别运行阶段（I0–I9）">
                  <div className="idrun-stage">
                    <StageBar stages={stageItems} />
                  </div>
                  {failedEntry !== undefined && (
                    <div className="idrun-failure">
                      阶段 <span className="mono">{failedEntry.stage}</span> 失败
                      {failedEntry.failureCode !== undefined && (
                        <>
                          ，错误码 <span className="mono">{failedEntry.failureCode}</span>
                        </>
                      )}
                      {failedEntry.retryable !== undefined &&
                        `，${failedEntry.retryable ? '可重试' : '不可重试'}`}
                      。失败由运行编排按既有策略处理，本页不提供跳过、换模型或扩预算入口。
                    </div>
                  )}

                  <dl className="idrun-fields idrun-meta">
                    <div className="idrun-field">
                      <dt>启动者</dt>
                      <dd className="mono">{startedBy}</dd>
                    </div>
                    <div className="idrun-field">
                      <dt>启动时间</dt>
                      <dd className="mono">{startedAt}</dd>
                    </div>
                    <div className="idrun-field">
                      <dt>触发原因</dt>
                      <dd>{triggerReason ?? '—'}</dd>
                    </div>
                    <div className="idrun-field">
                      <dt>运行版本</dt>
                      <dd className="mono">{detail.runRef.reference.versionId}</dd>
                    </div>
                  </dl>
                </Card>

                <Card title="工序工作项覆盖">
                  {detail.workItemCoverage.length === 0 ? (
                    <div className="idrun-dim">该运行尚无工作计划登记</div>
                  ) : (
                    <DataTable
                      columns={workItemColumns}
                      rows={detail.workItemCoverage.map((item) => ({ ...item }))}
                    />
                  )}
                </Card>

                <Card title="合并组与验收路由">
                  {detail.mergeGroups.length === 0 ? (
                    <div className="idrun-dim">该运行尚无合并组登记</div>
                  ) : (
                    <DataTable
                      columns={mergeGroupColumns}
                      rows={detail.mergeGroups.map((group) => ({ ...group }))}
                    />
                  )}
                </Card>

                <Card title="关联 Agent 与复核任务">
                  {detail.agentTaskRefs.length === 0 && detail.reviewTaskRefs.length === 0 ? (
                    <div className="idrun-dim">该运行未登记关联任务</div>
                  ) : (
                    <div className="idrun-refs">
                      {detail.agentTaskRefs.map((ref) => (
                        <div key={ref.agentTaskRef.reference.entityId} className="idrun-ref-row">
                          <StatusTag tone="neutral">Agent</StatusTag>
                          <span className="mono">{ref.agentTaskRef.reference.entityId}</span>
                          <span className="idrun-dim">{ref.taskType}</span>
                        </div>
                      ))}
                      {detail.reviewTaskRefs.map((ref) => (
                        <div key={ref.reviewTaskRef.reference.entityId} className="idrun-ref-row">
                          <StatusTag tone="review">复核</StatusTag>
                          <span className="mono">{ref.reviewTaskRef.reference.entityId}</span>
                          <span className="idrun-dim">{ref.reviewType}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {detail.reviewTaskRefs.length > 0 && (
                    <div className="idrun-ref-more">
                      <Link to={projectPath('/review')}>前往复核队列</Link>
                    </div>
                  )}
                </Card>

                <Card title="结果汇总">
                  <dl className="idrun-fields">
                    <div className="idrun-field">
                      <dt>工作项</dt>
                      <dd className="mono">
                        计划 {detail.resultCounts.plannedWorkItemCount} · 完成{' '}
                        {detail.resultCounts.completedWorkItemCount} · 失败{' '}
                        {detail.resultCounts.failedWorkItemCount} · 零结果{' '}
                        {detail.resultCounts.zeroResultCount}
                      </dd>
                    </div>
                    <div className="idrun-field">
                      <dt>候选收口</dt>
                      <dd className="mono">
                        验收 {detail.resultCounts.acceptedCount} · 待复核{' '}
                        {detail.resultCounts.pendingReviewCount} · 拒收{' '}
                        {detail.resultCounts.rejectedCount}
                      </dd>
                    </div>
                  </dl>
                  {detail.acceptedRiskRecordRefs.length > 0 && (
                    <div className="idrun-refs">
                      {detail.acceptedRiskRecordRefs.map((ref) => (
                        <div key={ref.reference.entityId} className="idrun-ref-row">
                          <Link
                            to={projectPath(
                              `/identification/records/${encodeURIComponent(ref.reference.entityId)}`,
                            )}
                            className="mono"
                          >
                            {ref.reference.entityId}
                          </Link>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </>
            )
          }}
        </PageStateView>
      </div>
    </AppShell>
  )
}
