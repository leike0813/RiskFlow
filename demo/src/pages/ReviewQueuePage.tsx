import { useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { ConfirmButton } from '../components/ConfirmButton'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { PageStateView } from '../components/PageStateView'
import { SectionTabs } from '../components/SectionTabs'
import { StatusTag } from '../components/StatusTag'
import { VersionTag } from '../components/VersionTag'
import { useEngineering, usePageQuery, useProjectPath } from '../api/context'
import {
  readReviewQueue,
  type ReviewQueueItemView,
  type ReviewQueuePageView,
} from '../api/operations'
import {
  REVIEW_STATUS_LABEL,
  REVIEW_STATUS_TONE,
  REVIEW_TYPE_LABEL,
  reviewDecisionOptions,
  reviewTabs,
  submitReviewTaskDecision,
  type ReviewDecisionOption,
} from './ReviewDetailPage'
import './ReviewQueuePage.css'

/**
 * 逐项「通过」选项：取该复核类型在契约联合中的原样通过分支。
 * 需要候选集引用的修正分支不进入批量原样通过（响应-candidate 也没有原样通过形态）。
 */
const approveOptionOf = (reviewType: string): ReviewDecisionOption | undefined =>
  reviewDecisionOptions(reviewType).find(
    (option) => !option.requiresCandidateRef && option.kind.startsWith('approve'),
  )

const rejectOptionOf = (reviewType: string): ReviewDecisionOption | undefined =>
  reviewDecisionOptions(reviewType).find((option) => option.kind === 'reject')

const taskEntityId = (item: ReviewQueueItemView) => item.reviewTaskRef.reviewTaskRef.reference.entityId

const taskVersionId = (item: ReviewQueueItemView) => item.reviewTaskRef.reviewTaskRef.reference.versionId

const targetLabel = (item: ReviewQueueItemView) =>
  `${item.reviewTaskRef.targetRef.kind} · ${item.reviewTaskRef.targetRef.reference.entityId}`

interface DecisionOutcome {
  readonly entityId: string
  readonly decisionLabel: string
  readonly ok: boolean
  readonly code?: string
  readonly decisionRefId?: string
  readonly waitingRunId?: string
}

export default function ReviewQueuePage() {
  const { selector } = useEngineering()
  const projectPath = useProjectPath()
  const [typeFilter, setTypeFilter] = useState<string>('全部')
  const [statusFilter, setStatusFilter] = useState<string>('全部')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [outcomes, setOutcomes] = useState<DecisionOutcome[]>([])

  const { state, retry } = usePageQuery<ReviewQueuePageView>(
    (projectId, signal) =>
      readReviewQueue(
        projectId,
        {
          ...(typeFilter === '全部' ? {} : { reviewType: typeFilter }),
          ...(statusFilter === '全部' ? {} : { status: statusFilter }),
        },
        signal,
      ),
    [typeFilter, statusFilter],
  )

  const submitDecision = async (item: ReviewQueueItemView, option: ReviewDecisionOption) => {
    const projectId = selector.projectId
    if (projectId === null) return
    try {
      const decisionRefId = await submitReviewTaskDecision({
        projectId,
        reviewTaskRef: item.reviewTaskRef,
        reviewType: item.reviewTaskRef.reviewType,
        option,
      })
      setOutcomes((prev) => [
        {
          entityId: taskEntityId(item),
          decisionLabel: option.label,
          ok: true,
          decisionRefId,
          waitingRunId: item.reviewTaskRef.waitingRunRef.reference.entityId,
        },
        ...prev,
      ])
      retry()
    } catch (error) {
      setOutcomes((prev) => [
        {
          entityId: taskEntityId(item),
          decisionLabel: option.label,
          ok: false,
          code: error instanceof Error ? error.message : 'TERMINAL_FAILURE',
        },
        ...prev,
      ])
      throw error
    }
  }

  const confirmSummary = (item: ReviewQueueItemView, decisionLabel: string, result: string) => [
    `工程：${selector.projectId ?? ''}`,
    `对象：${REVIEW_TYPE_LABEL[item.reviewTaskRef.reviewType] ?? item.reviewTaskRef.reviewType} ${targetLabel(item)}`,
    `精确版本：${item.reviewTaskRef.targetRef.reference.versionId}`,
    `预计结果：${decisionLabel}，${result}`,
    '副作用：决定写入审计日志且不可撤销；命令携带幂等键，重复提交同一决定不重复生效',
  ]

  const columns: DataTableColumn[] = [
    {
      key: 'select',
      title: '',
      width: 40,
      render: (row) => {
        const item = row as unknown as ReviewQueueItemView
        if (item.status !== 'pending' || item.stale) return null
        const id = taskEntityId(item)
        return (
          <input
            type="checkbox"
            className="rq-check"
            checked={selected.has(id)}
            onChange={() =>
              setSelected((prev) => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })
            }
            aria-label={`选择 ${id}`}
          />
        )
      },
    },
    {
      key: 'task',
      title: '任务标识',
      width: 200,
      render: (row) => {
        const item = row as unknown as ReviewQueueItemView
        return (
          <span className="rq-target">
            <Link
              className="mono"
              to={projectPath(
                `/review/tasks/${encodeURIComponent(taskEntityId(item))}?version=${encodeURIComponent(taskVersionId(item))}`,
              )}
            >
              {taskEntityId(item)}
            </Link>
            <VersionTag>{taskVersionId(item)}</VersionTag>
          </span>
        )
      },
    },
    {
      key: 'reviewType',
      title: '类型',
      width: 130,
      render: (row) => {
        const reviewType = (row as unknown as ReviewQueueItemView).reviewTaskRef.reviewType
        return <span>{REVIEW_TYPE_LABEL[reviewType] ?? reviewType}</span>
      },
    },
    {
      key: 'target',
      title: '复核对象',
      render: (row) => {
        const item = row as unknown as ReviewQueueItemView
        return (
          <div className="rq-target">
            <span className="mono">{targetLabel(item)}</span>
            <span className="rq-target-id mono">
              {item.reviewTaskRef.targetRef.reference.versionId}
            </span>
          </div>
        )
      },
    },
    {
      key: 'triggerReason',
      title: '触发原因',
      width: 170,
      render: (row) => {
        const reason = (row as unknown as ReviewQueueItemView).triggerReason
        return reason === undefined ? <span className="rq-target-id">—</span> : <span>{reason}</span>
      },
    },
    {
      key: 'submittedAt',
      title: '提交时间',
      width: 200,
      render: (row) => (
        <span className="mono">{(row as unknown as ReviewQueueItemView).submittedAt}</span>
      ),
    },
    {
      key: 'status',
      title: '状态',
      width: 130,
      render: (row) => {
        const item = row as unknown as ReviewQueueItemView
        return (
          <span className="rq-target">
            <StatusTag tone={REVIEW_STATUS_TONE[item.status] ?? 'neutral'}>
              {REVIEW_STATUS_LABEL[item.status] ?? item.status}
            </StatusTag>
            {item.stale && <StatusTag tone="failed">已过期</StatusTag>}
          </span>
        )
      },
    },
    {
      key: 'actions',
      title: '操作',
      width: 250,
      render: (row) => {
        const item = row as unknown as ReviewQueueItemView
        if (item.status !== 'pending') return null
        if (item.stale) {
          return (
            <div className="rq-row-actions">
              <button type="button" className="rq-btn-disabled rq-btn-disabled--row" disabled>
                通过
              </button>
              <button type="button" className="rq-btn-disabled rq-btn-disabled--row" disabled>
                拒绝
              </button>
              <span className="rq-target-id">目标版本已被取代，请重新领取</span>
              <Link
                className="rq-link-action"
                to={projectPath(
                  `/review/tasks/${encodeURIComponent(taskEntityId(item))}?version=${encodeURIComponent(taskVersionId(item))}`,
                )}
              >
                详情
              </Link>
            </div>
          )
        }
        const approveOption = approveOptionOf(item.reviewTaskRef.reviewType)
        const rejectOption = rejectOptionOf(item.reviewTaskRef.reviewType)
        return (
          <div className="rq-row-actions">
            {approveOption !== undefined && (
              <ConfirmButton
                label="通过"
                summary={confirmSummary(item, '按原样通过', '等待中的运行据此恢复后续流程')}
                onConfirm={() => submitDecision(item, approveOption)}
              />
            )}
            {rejectOption !== undefined && (
              <ConfirmButton
                label="拒绝"
                summary={confirmSummary(item, '拒绝该任务', '目标对象保持待处理状态并记录决定')}
                onConfirm={() => submitDecision(item, rejectOption)}
              />
            )}
            <Link
              className="rq-link-action"
              to={projectPath(
                `/review/tasks/${encodeURIComponent(taskEntityId(item))}?version=${encodeURIComponent(taskVersionId(item))}`,
              )}
            >
              详情
            </Link>
          </div>
        )
      },
    },
  ]

  return (
    <AppShell activeNav="review" agentContext={selector.projectId === null ? [] : [selector.projectId]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">复核队列</h1>
            <p className="page-subtitle">识别候选、知识草案等类型化复核任务的统一队列</p>
          </div>
        </header>

        <SectionTabs items={reviewTabs} />

        {outcomes.length > 0 && (
          <Card title="决定提交结果" style={{ marginBottom: 16 }}>
            <ul className="rq-outcomes">
              {outcomes.map((outcome, index) => (
                <li key={index}>
                  {outcome.ok ? (
                    <>
                      <span className="mono">{outcome.entityId}</span> {outcome.decisionLabel}
                      已登记（决定 {outcome.decisionRefId}）
                      {outcome.waitingRunId !== undefined && (
                        <>
                          {' · '}
                          <Link
                            to={projectPath(
                              `/identification/runs/${encodeURIComponent(outcome.waitingRunId)}`,
                            )}
                          >
                            查看等待运行
                          </Link>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="mono">{outcome.entityId}</span> {outcome.decisionLabel}
                      失败（{outcome.code}）
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <PageStateView
          state={state}
          title="复核队列"
          emptyMessage="当前筛选下暂无复核任务"
          forbiddenHint="当前角色不具备复核队列的读取权限"
          onRetry={retry}
        >
          {(page) => {
            const pendingActionable = page.items.filter(
              (item) => item.status === 'pending' && !item.stale,
            )
            const selectedItems = pendingActionable.filter((item) =>
              selected.has(taskEntityId(item)),
            )
            const batchApprovable =
              selectedItems.length > 0 &&
              selectedItems.every((item) => approveOptionOf(item.reviewTaskRef.reviewType) !== undefined)
            const batchSummary = [
              `工程：${selector.projectId ?? ''}`,
              `对象：${selectedItems.length} 项（${selectedItems
                .map((item) => taskEntityId(item))
                .join('、')}）`,
              `精确版本：${selectedItems
                .map((item) => item.reviewTaskRef.targetRef.reference.versionId)
                .join('、')}`,
              '预计结果：所选任务逐项按原样通过，对应等待运行据此恢复后续流程',
              '副作用：每项决定写入审计日志且不可撤销；各命令携带幂等键，重复提交不重复生效',
            ]
            const submitBatch = async () => {
              let firstError: unknown = null
              for (const item of selectedItems) {
                const option = approveOptionOf(item.reviewTaskRef.reviewType)
                if (option === undefined) continue
                try {
                  await submitDecision(item, option)
                } catch (error) {
                  if (firstError === null) firstError = error
                }
              }
              setSelected(new Set())
              if (firstError !== null) throw firstError
            }
            return (
              <Card
                title="复核任务"
                extra={
                  <span>
                    待决定 {page.items.filter((item) => item.status === 'pending').length} 项 · 本页{' '}
                    {page.items.length} 项
                  </span>
                }
              >
                <div className="rq-filter">
                  <span className="rq-filter-label">类型</span>
                  {['全部', ...Object.keys(REVIEW_TYPE_LABEL)].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`rq-chip${typeFilter === value ? ' rq-chip--active' : ''}`}
                      onClick={() => {
                        setTypeFilter(value)
                        setSelected(new Set())
                      }}
                    >
                      {value === '全部' ? value : REVIEW_TYPE_LABEL[value]}
                    </button>
                  ))}
                  <span className="rq-filter-label">状态</span>
                  {['全部', 'pending', 'decided', 'superseded'].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`rq-chip${statusFilter === value ? ' rq-chip--active' : ''}`}
                      onClick={() => {
                        setStatusFilter(value)
                        setSelected(new Set())
                      }}
                    >
                      {value === '全部' ? value : REVIEW_STATUS_LABEL[value]}
                    </button>
                  ))}
                </div>

                <div className="rq-toolbar">
                  <span className="rq-toolbar-info">
                    已选 {selectedItems.length} / {pendingActionable.length} 项可决定任务
                    {selected.size > 0 && (
                      <button
                        type="button"
                        className="rq-link-btn"
                        onClick={() => setSelected(new Set())}
                      >
                        清空选择
                      </button>
                    )}
                    {selectedItems.length === 0 && pendingActionable.length > 0 && (
                      <button
                        type="button"
                        className="rq-link-btn"
                        onClick={() =>
                          setSelected(new Set(pendingActionable.map((item) => taskEntityId(item))))
                        }
                      >
                        全选可决定
                      </button>
                    )}
                  </span>
                  {selectedItems.length === 0 ? (
                    <button type="button" className="rq-btn-disabled" disabled>
                      批量通过
                    </button>
                  ) : batchApprovable ? (
                    <ConfirmButton
                      label="批量通过"
                      summary={batchSummary}
                      onConfirm={submitBatch}
                    />
                  ) : (
                    <button
                      type="button"
                      className="rq-btn-disabled"
                      disabled
                      title="所选含不支持原样通过的复核类型"
                    >
                      批量通过
                    </button>
                  )}
                </div>

                {page.items.length === 0 ? (
                  <div className="rq-target-id">当前筛选下暂无复核任务</div>
                ) : (
                  <DataTable columns={columns} rows={page.items.map((item) => ({ ...item }))} />
                )}
                {page.nextCursor !== undefined && (
                  <div className="rq-target-id">结果按游标分页，当前呈现第一页</div>
                )}
              </Card>
            )
          }}
        </PageStateView>
      </div>
    </AppShell>
  )
}
