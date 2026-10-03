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
  readAssessmentRecordCatalog,
  type AssessmentRecordCatalogItemView,
  type RecordCatalogView,
} from '../api/operations'
import { NextPageButton, tableRow } from './assessmentResponseShared'
import './assessment-response.css'

const ASSESSMENT_TABS = [
  { to: '/assessment', label: '待评估' },
  { to: '/assessment/records', label: '评估记录' },
  { to: '/assessment/reassessments', label: '重评历史' },
  { to: '/assessment/matrix', label: '风险矩阵' },
]

/**
 * P-RA-04 评估记录目录（design D-02、D-04）。
 *
 * 条目只含摘要与冻结落点：P/C 分值、风险状态与矩阵落点都取自该记录保存的决策工件，
 * 页面不按当前矩阵版本重新解释历史记录。
 */
export default function AssessmentRecordsPage() {
  const { selector } = useEngineering()
  const projectPath = useProjectPath()
  const [entryMode, setEntryMode] = useState('')
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  const { state, retry } = usePageQuery<RecordCatalogView>(
    (projectId, signal) =>
      readAssessmentRecordCatalog(
        projectId,
        { ...(entryMode === '' ? {} : { entryMode }), ...(cursor === undefined ? {} : { cursor }) },
        signal,
      ),
    [entryMode, cursor],
  )

  const columns: DataTableColumn[] = [
    {
      key: 'assessmentRecordRef',
      title: '评估记录',
      width: 220,
      render: (row) => {
        const ref = tableRow<AssessmentRecordCatalogItemView>(row).assessmentRecordRef
        return (
          <Link
            className="mono"
            to={projectPath(
              `assessment/records/${ref.reference.entityId}?version=${ref.reference.versionId}`,
            )}
          >
            {ref.reference.entityId}
          </Link>
        )
      },
    },
    {
      key: 'riskInput',
      title: '风险输入',
      width: 200,
      render: (row) => {
        const ref = tableRow<AssessmentRecordCatalogItemView>(row).riskInput
        return (
          <span className="mono">
            {ref.reference.entityId} · {ref.kind}
          </span>
        )
      },
    },
    {
      key: 'entryMode',
      title: '入口模式',
      width: 130,
      render: (row) => <span className="mono">{tableRow<AssessmentRecordCatalogItemView>(row).entryMode}</span>,
    },
    {
      key: 'previousAssessmentRecordRef',
      title: '前驱记录',
      width: 180,
      render: (row) => {
        const ref = tableRow<AssessmentRecordCatalogItemView>(row).previousAssessmentRecordRef
        if (ref === undefined) return <span className="ar-note">无前驱</span>
        return (
          <Link
            className="mono"
            to={projectPath(
              `assessment/records/${ref.reference.entityId}?version=${ref.reference.versionId}`,
            )}
          >
            {ref.reference.entityId}
          </Link>
        )
      },
    },
    {
      key: 'scores',
      title: 'P / C',
      width: 110,
      align: 'center',
      render: (row) => {
        const item = tableRow<AssessmentRecordCatalogItemView>(row)
        return (
          <span className="mono">
            {item.likelihoodScore.toFixed(2)} / {item.consequenceScore.toFixed(2)}
          </span>
        )
      },
    },
    {
      key: 'riskState',
      title: '风险状态',
      width: 110,
      render: (row) => (
        <StatusTag tone="neutral">{tableRow<AssessmentRecordCatalogItemView>(row).riskState}</StatusTag>
      ),
    },
    {
      key: 'matrixPlot',
      title: '矩阵落点',
      width: 220,
      render: (row) => {
        const plot = tableRow<AssessmentRecordCatalogItemView>(row).matrixPlot
        return (
          <span className="ar-note">
            <span className="mono">
              {plot.riskMatrixRef.entityId} · {plot.riskMatrixRef.versionId}
            </span>
            <br />
            {plot.possibilityBandId} × {plot.consequenceBandId} → {plot.riskLevelId}（序 {plot.riskLevelOrdinal}）
          </span>
        )
      },
    },
    {
      key: 'occurredAt',
      title: '登记时间',
      width: 190,
      render: (row) => <span className="mono">{tableRow<AssessmentRecordCatalogItemView>(row).occurredAt}</span>,
    },
  ]

  return (
    <AppShell activeNav="assessment" agentContext={selector.projectId === null ? [] : [selector.projectId]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">评估记录</h1>
            <p className="page-subtitle">已入库评估记录版本与其冻结落点</p>
          </div>
        </header>
        <SectionTabs items={ASSESSMENT_TABS} />

        <PageStateView
          state={state}
          title="评估记录"
          emptyMessage="当前筛选下暂无已入库评估记录"
          onRetry={retry}
        >
          {(page) => (
            <Card
              title="评估记录"
              extra={
                <div className="wc-filter">
                  <span className="wc-filter-label">入口模式</span>
                  {['', 'assess', 'reassess', 'historical-backfill'].map((value) => (
                    <button
                      key={value === '' ? 'all' : value}
                      type="button"
                      className={`wc-chip${entryMode === value ? ' wc-chip--active' : ''}`}
                      onClick={() => {
                        setEntryMode(value)
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
