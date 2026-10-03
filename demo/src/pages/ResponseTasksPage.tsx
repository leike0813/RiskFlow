import { useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { PageStateView } from '../components/PageStateView'
import { SectionTabs } from '../components/SectionTabs'
import { StatusTag } from '../components/StatusTag'
import { useEngineering, usePageQuery, useProjectPath } from '../api/context'
import {
  readWarningTaskCatalog,
  type WarningTaskCatalogItemView,
  type WarningTaskCatalogView,
} from '../api/operations'
import { NextPageButton, tableRow } from './assessmentResponseShared'
import './assessment-response.css'

const WARNING_TABS = [
  { to: '/warnings', label: '预警中心' },
  { to: '/warnings/tasks', label: '处置任务' },
]

/**
 * P-WR-03 处置任务目录（design D-02、D-05）。
 *
 * 条目只含所属登记事实：状态、风险输入、空间范围与预警计数由 C26 给出，
 * 页面不按预警数量推断任务是否闭环。
 */
export default function ResponseTasksPage() {
  const { selector } = useEngineering()
  const projectPath = useProjectPath()
  const [status, setStatus] = useState('')
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  const { state, retry } = usePageQuery<WarningTaskCatalogView>(
    (projectId, signal) =>
      readWarningTaskCatalog(
        projectId,
        { ...(status === '' ? {} : { status }), ...(cursor === undefined ? {} : { cursor }) },
        signal,
      ),
    [status, cursor],
  )

  const columns: DataTableColumn[] = [
    {
      key: 'taskRef',
      title: '任务标识',
      width: 220,
      render: (row) => {
        const ref = tableRow<WarningTaskCatalogItemView>(row).taskRef
        return (
          <Link
            className="mono"
            to={projectPath(`warnings/tasks/${ref.reference.entityId}?version=${ref.reference.versionId}`)}
          >
            {ref.reference.entityId}
          </Link>
        )
      },
    },
    {
      key: 'status',
      title: '状态',
      width: 110,
      render: (row) => {
        const value = tableRow<WarningTaskCatalogItemView>(row).status
        return <StatusTag tone={value === 'open' ? 'review' : 'success'}>{value}</StatusTag>
      },
    },
    {
      key: 'riskInput',
      title: '风险输入',
      width: 220,
      render: (row) => {
        const ref = tableRow<WarningTaskCatalogItemView>(row).riskInput
        return (
          <span className="mono">
            {ref.reference.entityId} · {ref.kind}
          </span>
        )
      },
    },
    {
      key: 'spatialScopeRef',
      title: '空间范围',
      width: 190,
      render: (row) => (
        <span className="mono">
          {tableRow<WarningTaskCatalogItemView>(row).spatialScopeRef.reference.entityId}
        </span>
      ),
    },
    {
      key: 'warningCount',
      title: '关联预警',
      width: 100,
      align: 'center',
      render: (row) => <span className="mono">{tableRow<WarningTaskCatalogItemView>(row).warningCount}</span>,
    },
    {
      key: 'occurredAt',
      title: '登记时间',
      width: 190,
      render: (row) => <span className="mono">{tableRow<WarningTaskCatalogItemView>(row).occurredAt}</span>,
    },
  ]

  return (
    <AppShell activeNav="warnings" agentContext={selector.projectId === null ? [] : [selector.projectId]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">处置任务</h1>
            <p className="page-subtitle">按风险输入归集的预警处置任务</p>
          </div>
        </header>
        <SectionTabs items={WARNING_TABS} />

        <PageStateView
          state={state}
          title="处置任务"
          emptyMessage="当前筛选下暂无已登记处置任务"
          onRetry={retry}
        >
          {(page) => (
            <Card
              title="处置任务"
              extra={
                <div className="wc-filter">
                  <span className="wc-filter-label">状态</span>
                  {['', 'open', 'closed'].map((value) => (
                    <button
                      key={value === '' ? 'all' : value}
                      type="button"
                      className={`wc-chip${status === value ? ' wc-chip--active' : ''}`}
                      onClick={() => {
                        setStatus(value)
                        setCursor(undefined)
                      }}
                    >
                      {value === '' ? '全部' : value}
                    </button>
                  ))}
                </div>
              }
            >
              <DataTable columns={columns} rows={page.items.map((item) => ({ ...item }))} />
              <NextPageButton nextCursor={page.nextCursor} onContinue={setCursor} />
            </Card>
          )}
        </PageStateView>
      </div>
    </AppShell>
  )
}
