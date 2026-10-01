import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { PageStateView } from '../components/PageStateView'
import { SectionTabs } from '../components/SectionTabs'
import { StatusTag } from '../components/StatusTag'
import { useEngineering, usePageQuery, useProjectPath } from '../api/context'
import {
  listRiskRecords,
  type RiskRecordCatalogPageView,
} from '../api/operations'
import {
  ACCEPTANCE_KIND_LABEL,
  identificationTabs,
} from './identificationShared'
import './RiskRecordListPage.css'

const acceptanceOptions: { value: string; label: string }[] = [
  { value: '', label: '全部验收方式' },
  { value: 'automatic', label: ACCEPTANCE_KIND_LABEL.automatic ?? '自动验收' },
  { value: 'review', label: ACCEPTANCE_KIND_LABEL.review ?? '人工复核验收' },
]

const columns: DataTableColumn[] = [
  {
    key: 'riskRecordRef',
    title: '记录标识',
    width: 170,
    render: (row) => (
      <span className="mono">
        {(row.riskRecordRef as { reference: { entityId: string } }).reference.entityId}
      </span>
    ),
  },
  {
    key: 'processNodeId',
    title: '工序节点',
    width: 150,
    render: (row) => <span className="mono">{row.processNodeId as string}</span>,
  },
  { key: 'riskEventSummary', title: '风险事件' },
  {
    key: 'compositeConfidence',
    title: '综合置信度',
    width: 110,
    align: 'center',
    render: (row) => (
      <span className="mono">
        {(row.compositeConfidence as { value: number }).value.toFixed(2)}
      </span>
    ),
  },
  {
    key: 'acceptanceKind',
    title: '验收方式',
    width: 140,
    render: (row) => {
      const kind = row.acceptanceKind as string
      return (
        <StatusTag tone={kind === 'review' ? 'review' : 'success'}>
          {ACCEPTANCE_KIND_LABEL[kind] ?? kind}
        </StatusTag>
      )
    },
  },
  {
    key: 'supersededBy',
    title: '当前效力',
    width: 110,
    render: (row) =>
      row.supersededBy === undefined ? (
        <StatusTag tone="neutral">现行</StatusTag>
      ) : (
        <StatusTag tone="failed">已被取代</StatusTag>
      ),
  },
]

export default function RiskRecordListPage() {
  const navigate = useNavigate()
  const { selector } = useEngineering()
  const projectPath = useProjectPath()
  const [processNodeId, setProcessNodeId] = useState('')
  const [acceptanceKind, setAcceptanceKind] = useState('')

  const { state, retry } = usePageQuery<RiskRecordCatalogPageView>(
    (projectId, signal) =>
      listRiskRecords(
        projectId,
        {
          ...(processNodeId.trim().length === 0 ? {} : { processNodeId: processNodeId.trim() }),
          ...(acceptanceKind === '' ? {} : { acceptanceKind }),
        },
        signal,
      ),
    [processNodeId, acceptanceKind],
  )

  return (
    <AppShell
      activeNav="identification"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">标准化风险记录</h1>
            <p className="page-subtitle">当前工程已入库的标准化风险记录</p>
          </div>
        </header>
        <SectionTabs items={identificationTabs} />

        <PageStateView
          state={state}
          title="风险记录"
          emptyMessage="当前筛选下暂无标准化风险记录"
          onRetry={retry}
        >
          {(page) => (
            <Card
              title="风险记录"
              extra={
                <>
                  <input
                    className="records-filter"
                    value={processNodeId}
                    onChange={(e) => setProcessNodeId(e.target.value)}
                    placeholder="工序节点标识"
                    aria-label="按工序节点筛选"
                  />
                  <select
                    className="records-filter"
                    value={acceptanceKind}
                    onChange={(e) => setAcceptanceKind(e.target.value)}
                    aria-label="按验收方式筛选"
                  >
                    {acceptanceOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </>
              }
            >
              {page.items.length === 0 ? (
                <div className="records-dim">当前筛选下暂无标准化风险记录</div>
              ) : (
                <DataTable
                  columns={columns}
                  rows={page.items.map((item) => ({ ...item }))}
                  onRowClick={(row) =>
                    navigate(
                      projectPath(
                        `/identification/records/${encodeURIComponent(
                          (row.riskRecordRef as { reference: { entityId: string } }).reference
                            .entityId,
                        )}`,
                      ),
                    )
                  }
                />
              )}
              {page.nextCursor !== undefined && (
                <div className="records-dim">结果按游标分页，当前呈现第一页</div>
              )}
            </Card>
          )}
        </PageStateView>
      </div>
    </AppShell>
  )
}
