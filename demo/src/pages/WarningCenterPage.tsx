import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { KpiCard } from '../components/KpiCard'
import { PageStateView } from '../components/PageStateView'
import { SectionTabs } from '../components/SectionTabs'
import { StatusTag } from '../components/StatusTag'
import { WarningBadge } from '../components/WarningBadge'
import { useEngineering, usePageQuery, useProjectPath } from '../api/context'
import {
  readWarningCatalog,
  readWarningResponseOverview,
  type WarningCatalogItemView,
  type WarningCatalogView,
} from '../api/operations'
import './WarningCenterPage.css'

/** 表格行是弱类型记录：引用字段统一由此读出，形状漂移已在解码层挡住。 */
const referenceOf = (value: unknown): { entityId: string; versionId: string } =>
  (value as { readonly reference: { entityId: string; versionId: string } }).reference

/**
 * P-WR-01 预警中心（design D-02、D-05）。
 *
 * 目录条目只取登记的预警事实：等级、触发类型与关联任务都来自同一条记录引用。
 * KPI 取 C26 的独立概览，不用列表长度在页面上推算统计口径。
 */
export default function WarningCenterPage() {
  const { selector } = useEngineering()
  const navigate = useNavigate()
  const projectPath = useProjectPath()
  const [triggerType, setTriggerType] = useState('')
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  const { state, retry } = usePageQuery<WarningCatalogView>(
    (projectId, signal) =>
      readWarningCatalog(
        projectId,
        {
          ...(triggerType === '' ? {} : { triggerType }),
          ...(cursor === undefined ? {} : { cursor }),
        },
        signal,
      ),
    [triggerType, cursor],
  )
  const overview = usePageQuery(
    (projectId, signal) => readWarningResponseOverview(projectId, {}, signal),
    [],
  )
  const columns: DataTableColumn[] = [
    {
      key: 'warningRecordRef',
      title: '预警标识',
      width: 260,
      render: (row) => {
        const reference = referenceOf(row.warningRecordRef)
        return (
          <div className="wc-id-cell">
            <Link className="mono" to={projectPath(`warnings/${reference.entityId}?version=${reference.versionId}`)}>
              {reference.entityId}
            </Link>
            <WarningBadge text={String(row.warningLevel)} />
          </div>
        )
      },
    },
    {
      key: 'warningLevel',
      title: '预警等级',
      width: 110,
      render: (row) => <StatusTag tone="neutral">{String(row.warningLevel)}</StatusTag>,
    },
    {
      key: 'triggerType',
      title: '触发类型',
      width: 180,
      render: (row) => String(row.triggerType),
    },
    {
      key: 'acknowledged',
      title: '确认状态',
      width: 120,
      render: (row) => (
        <StatusTag tone={row.acknowledged === true ? 'success' : 'review'}>
          {row.acknowledged === true ? '已确认' : '待确认'}
        </StatusTag>
      ),
    },
    {
      key: 'occurredAt',
      title: '登记时间',
      width: 200,
      render: (row) => <span className="mono">{String(row.occurredAt)}</span>,
    },
    {
      key: 'taskRef',
      title: '关联任务',
      width: 200,
      render: (row) => {
        const reference = referenceOf(row.taskRef)
        return (
          <Link className="mono" to={projectPath(`warnings/tasks/${reference.entityId}?version=${reference.versionId}`)}>
            {reference.entityId}
          </Link>
        )
      },
    },
  ]

  const triggerTypes: string[] =
    state.kind === 'ready'
      ? [...new Set(state.value.items.map((item: WarningCatalogItemView) => item.triggerType))]
      : []

  return (
    <AppShell activeNav="warnings" agentContext={selector.projectId === null ? [] : [selector.projectId]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">预警中心</h1>
            <p className="page-subtitle">已登记预警、触发类型与关联处置任务</p>
          </div>
        </header>

        <SectionTabs
          items={[
            { to: '/warnings', label: '预警中心' },
            { to: '/warnings/tasks', label: '处置任务' },
          ]}
        />

        <div className="wc-kpis">
          <PageStateView state={overview.state} title="概览" emptyMessage="暂无概览统计">
            {(value) => (
              <>
                <KpiCard label="生效预警" value={value.warningCount} unit="项" />
                <KpiCard label="开放任务" value={value.openTaskCount} unit="项" />
                <KpiCard
                  label="最高等级"
                  value={value.levelCounts[0]?.warningLevel ?? '—'}
                  tag={`共 ${value.levelCounts.length} 个等级`}
                />
                <KpiCard label="统计时点" value={value.asOf.slice(0, 10)} tag="已登记口径" />
              </>
            )}
          </PageStateView>
        </div>

        <PageStateView
          state={state}
          title="预警列表"
          emptyMessage="当前筛选下暂无已登记预警"
          onRetry={retry}
        >
          {(page) => (
            <Card
              title="预警列表"
              extra={
                <div className="wc-filter">
                  <span className="wc-filter-label">触发类型</span>
                  {['', ...triggerTypes].map((value) => (
                    <button
                      key={value === '' ? 'all' : value}
                      type="button"
                      className={`wc-chip${triggerType === value ? ' wc-chip--active' : ''}`}
                      onClick={() => {
                        setTriggerType(value)
                        setCursor(undefined)
                      }}
                    >
                      {value === '' ? '全部' : value}
                    </button>
                  ))}
                </div>
              }
            >
              {page.items.length === 0 ? (
                <div className="wc-dim">当前筛选下暂无已登记预警</div>
              ) : (
                <DataTable
                  columns={columns}
                  rows={page.items.map((item) => ({ ...item }))}
                  onRowClick={(row) => {
                    const reference = referenceOf(row.warningRecordRef)
                    navigate(projectPath(`warnings/${reference.entityId}?version=${reference.versionId}`))
                  }}
                />
              )}
              {page.nextCursor !== undefined && (
                <div className="wc-more">
                  <button type="button" className="wc-chip" onClick={() => setCursor(page.nextCursor)}>
                    续页
                  </button>
                </div>
              )}
            </Card>
          )}
        </PageStateView>
      </div>
    </AppShell>
  )
}
