import { useState } from 'react'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { ConfirmButton } from '../components/ConfirmButton'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { SectionTabs } from '../components/SectionTabs'
import { StatusTag } from '../components/StatusTag'
import { projectContext } from '../content/context'
import { reviewTasks, type ReviewTask } from '../content/review'
import './ReviewQueuePage.css'

const typeFilters = ['全部', ...new Set(reviewTasks.map((t) => t.type))]

/** 统计选中任务的字段分布，如"识别候选复核 2 项；规则草案复核 1 项" */
const distribution = (items: string[]) => {
  const counts = new Map<string, number>()
  items.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1))
  return [...counts].map(([k, v]) => `${k} ${v} 项`).join('；')
}

const rowSummary = (task: ReviewTask, decision: string, result: string) => [
  `工程：${projectContext.project}`,
  `对象：${task.type} ${task.targetId}（${task.targetName}）`,
  `触发原因：${task.triggerReason}`,
  `预计结果：${decision}，${result}`,
]

export default function ReviewQueuePage() {
  const [typeFilter, setTypeFilter] = useState('全部')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const pendingTasks = reviewTasks.filter((t) => t.status === '待复核')
  const rows = reviewTasks.filter((t) => typeFilter === '全部' || t.type === typeFilter)
  const selectedTasks = pendingTasks.filter((t) => selected.has(t.id))

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const columns: DataTableColumn[] = [
    {
      key: 'select',
      title: '',
      width: 40,
      render: (row) =>
        row.status === '待复核' ? (
          <input
            type="checkbox"
            className="rq-check"
            checked={selected.has(row.id as string)}
            onChange={() => toggle(row.id as string)}
            aria-label={`选择 ${row.id as string}`}
          />
        ) : null,
    },
    {
      key: 'id',
      title: '任务标识',
      width: 130,
      render: (row) => <span className="mono">{row.id as string}</span>,
    },
    { key: 'type', title: '类型', width: 130 },
    { key: 'project', title: '工程', width: 210, render: () => projectContext.project },
    {
      key: 'targetName',
      title: '复核对象',
      render: (row) => (
        <div className="rq-target">
          <span>{row.targetName as string}</span>
          <span className="rq-target-id mono">{row.targetId as string}</span>
        </div>
      ),
    },
    { key: 'triggerReason', title: '触发原因' },
    {
      key: 'submittedAt',
      title: '提交时间',
      width: 170,
      render: (row) => <span className="mono">{row.submittedAt as string}</span>,
    },
    {
      key: 'status',
      title: '状态',
      width: 100,
      render: (row) => (
        <StatusTag tone={row.status === '已完成' ? 'success' : 'review'}>
          {row.status as string}
        </StatusTag>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 170,
      render: (row) => {
        const task = row as unknown as ReviewTask
        if (task.status !== '待复核') return null
        return (
          <div className="rq-row-actions">
            <ConfirmButton
              label="通过"
              summary={rowSummary(task, '按原样通过', '目标对象恢复后续流程')}
            />
            <ConfirmButton
              label="拒绝"
              summary={rowSummary(task, '拒绝该任务', '目标对象保持待处理状态并记录决定')}
            />
          </div>
        )
      },
    },
  ]

  return (
    <AppShell activeNav="review" agentContext={['待人工复核 2 项']}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">复核队列</h1>
            <p className="page-subtitle">识别候选、规则草案等类型化复核任务的统一队列</p>
          </div>
        </header>

        <SectionTabs
          items={[
            { to: '/review', label: '复核队列' },
            { to: '/review/trace', label: '证据追溯' },
            { to: '/review/runs', label: '运行记录' },
          ]}
        />

        <Card
          title="待复核任务"
          extra={<span>待复核 {pendingTasks.length} 项 · 已完成 {reviewTasks.length - pendingTasks.length} 项</span>}
        >
          <div className="rq-filter">
            <span className="rq-filter-label">类型</span>
            {typeFilters.map((t) => (
              <button
                key={t}
                type="button"
                className={`rq-chip${typeFilter === t ? ' rq-chip--active' : ''}`}
                onClick={() => setTypeFilter(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="rq-toolbar">
            <span className="rq-toolbar-info">
              已选 {selected.size} / {pendingTasks.length} 项待复核任务
              {selected.size > 0 && (
                <button type="button" className="rq-link-btn" onClick={() => setSelected(new Set())}>
                  清空选择
                </button>
              )}
              {selected.size === 0 && pendingTasks.length > 0 && (
                <button
                  type="button"
                  className="rq-link-btn"
                  onClick={() => setSelected(new Set(pendingTasks.map((t) => t.id)))}
                >
                  全选待复核
                </button>
              )}
            </span>
            {selected.size > 0 ? (
              <ConfirmButton
                label="批量通过"
                summary={[
                  `工程：${projectContext.project}`,
                  `任务数量：${selected.size} 项（${distribution(selectedTasks.map((t) => t.type))}）`,
                  `触发原因分布：${distribution(selectedTasks.map((t) => t.triggerReason))}`,
                  '预计结果：所选任务逐项按原样通过，对应对象恢复后续流程',
                ]}
              />
            ) : (
              <button type="button" className="rq-btn-disabled" disabled>
                批量通过
              </button>
            )}
          </div>

          <DataTable columns={columns} rows={rows.map((t) => ({ ...t }))} />
        </Card>
      </div>
    </AppShell>
  )
}
