import { useState } from 'react'
import AppShell from '../components/AppShell'
import { AssociatedObjects } from '../components/AssociatedObjects'
import { Card } from '../components/Card'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { PageStateView } from '../components/PageStateView'
import { SectionTabs } from '../components/SectionTabs'
import { VersionTag } from '../components/VersionTag'
import { useEngineering, usePageQuery } from '../api/context'
import {
  listKnowledgeDefinitions,
  type GovernanceLifecycleStatus,
  type GovernanceListPageView,
  type GovernanceReleaseView,
  type GovernanceRevisionView,
  type MeasureView,
} from '../api/operations'
import {
  LifecycleFilters,
  LifecycleTag,
  knowledgeTabs,
  lifecycleStatusOf,
  readGovernanceDetail,
} from './knowledgeShared'
import './MeasureLibraryPage.css'

const columns: DataTableColumn[] = [
  {
    key: 'definitionRef',
    title: '定义标识',
    render: (row) => (
      <span className="mono">
        {(row.definitionRef as { reference: { entityId: string } }).reference.entityId}
      </span>
    ),
  },
  {
    key: 'lifecycleStatus',
    title: '审核状态',
    width: 100,
    render: (row) => (
      <LifecycleTag status={row.lifecycleStatus as GovernanceLifecycleStatus} />
    ),
  },
  {
    key: 'currentReleaseRef',
    title: '当前发布',
    width: 140,
    render: (row) => {
      const release = row.currentReleaseRef as
        | { reference: { entityId: string; versionId: string } }
        | undefined
      return release === undefined ? '—' : <VersionTag>{release.reference.versionId}</VersionTag>
    },
  },
  { key: 'updatedAt', title: '更新时间', width: 170 },
]

const DIMENSION_LABEL: Record<string, string> = {
  施工工法数据: '工法',
  地层条件数据: '地层',
  工程阶段数据: '阶段',
}

type GovernanceDetail = GovernanceReleaseView | GovernanceRevisionView

export default function MeasureLibraryPage() {
  const { selector } = useEngineering()
  const [statusFilter, setStatusFilter] = useState<GovernanceLifecycleStatus | undefined>(
    undefined,
  )

  const list = usePageQuery<GovernanceListPageView>(
    (projectId, signal) =>
      listKnowledgeDefinitions(
        projectId,
        {
          definitionType: 'measure-library',
          ...(statusFilter === undefined ? {} : { lifecycleStatus: statusFilter }),
        },
        signal,
      ),
    [statusFilter],
  )

  const firstItem = list.state.kind === 'ready' ? list.state.value.items[0] : undefined

  const detail = usePageQuery<GovernanceDetail | null>(
    (projectId, signal) =>
      firstItem === undefined
        ? Promise.resolve(null)
        : readGovernanceDetail(projectId, firstItem, signal),
    [
      firstItem?.definitionRef.reference.entityId,
      firstItem?.currentReleaseRef?.reference.versionId,
      firstItem?.currentRevisionRef?.reference.versionId,
    ],
  )

  return (
    <AppShell
      activeNav="knowledge"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">措施库</h1>
            <p className="page-subtitle">处置措施项及其适用条件（只读）</p>
          </div>
        </header>

        <SectionTabs items={knowledgeTabs} />

        <LifecycleFilters
          value={statusFilter}
          onChange={setStatusFilter}
          className="kme-filters"
        />

        <PageStateView
          state={list.state}
          title="措施库"
          emptyMessage="当前筛选下无措施库定义"
          forbiddenHint="当前角色不具备知识库读取权限"
          onRetry={list.retry}
        >
          {(page) => (
            <>
              <Card title="措施库定义" extra={`共 ${page.totalCount} 项`}>
                <DataTable columns={columns} rows={page.items.map((item) => ({ ...item }))} />
              </Card>

              <PageStateView
                state={detail.state}
                title="措施项"
                emptyMessage="该定义暂无可读版本"
                onRetry={detail.retry}
              >
                {(value) =>
                  value === null ? (
                    <Card title="措施项">
                      <div className="kms-empty">该定义暂无可读版本</div>
                    </Card>
                  ) : (
                    <MeasureDetail detail={value} />
                  )
                }
              </PageStateView>
            </>
          )}
        </PageStateView>
      </div>
    </AppShell>
  )
}

function MeasureDetail({ detail }: { detail: GovernanceDetail }) {
  const versionRef = 'releaseRef' in detail ? detail.releaseRef : detail.revisionRef
  const measures = detail.body.definitionType === 'measure-library' ? detail.body.measures : []
  return (
    <>
      <Card
        title="措施项"
        extra={
          <>
            <LifecycleTag status={lifecycleStatusOf(detail)} />
            <VersionTag>{versionRef.reference.versionId}</VersionTag>
          </>
        }
      >
        {measures.length === 0 ? (
          <div className="kms-empty">该版本不含措施项</div>
        ) : (
          <DataTable columns={measureColumns} rows={measures.map((m) => ({ ...m }))} />
        )}
      </Card>
      <AssociatedObjects subjectRef={versionRef} />
    </>
  )
}

const measureColumns: DataTableColumn[] = [
  {
    key: 'measureId',
    title: '措施项',
    width: 150,
    render: (row) => <span className="mono">{row.measureId as string}</span>,
  },
  { key: 'riskEventCategory', title: '适用风险事件', width: 160 },
  {
    key: 'applicabilityConditions',
    title: '适用条件（工法/地层/阶段）',
    render: (row) => {
      const conditions = row.applicabilityConditions as MeasureView['applicabilityConditions']
      return conditions
        .map(
          (condition) =>
            `${DIMENSION_LABEL[condition.dimension] ?? condition.dimension}：${condition.values.join('、')}`,
        )
        .join('；')
    },
  },
  {
    key: 'triggerTypes',
    title: '触发类型',
    width: 140,
    render: (row) => (row.triggerTypes as string[]).join('、'),
  },
  {
    key: 'steps',
    title: '处置步骤',
    render: (row) =>
      (row.steps as MeasureView['steps'])
        .map((step) => `${step.stepOrdinal}. ${step.instruction}`)
        .join('；'),
  },
  {
    key: 'resourceRequirements',
    title: '资源约束',
    width: 160,
    render: (row) => (row.resourceRequirements as string[]).join('、'),
  },
]
