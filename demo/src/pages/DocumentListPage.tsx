import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { ConfirmButton } from '../components/ConfirmButton'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { KpiCard } from '../components/KpiCard'
import { SectionTabs } from '../components/SectionTabs'
import { StatusTag } from '../components/StatusTag'
import { VersionTag } from '../components/VersionTag'
import { projectContext } from '../content/context'
import { documentCatalog } from '../content/evidence'
import './DocumentListPage.css'

const sectionTabs = [
  { to: '/project', label: '工程概览' },
  { to: '/project/documents', label: '资料目录' },
  { to: '/project/monitoring/SRC-MON-003', label: '监测数据' },
]

const columns: DataTableColumn[] = [
  {
    key: 'id',
    title: '资料标识',
    width: 140,
    render: (row) => <span className="mono">{row.id as string}</span>,
  },
  { key: 'name', title: '资料名称' },
  { key: 'type', title: '类型', width: 120 },
  { key: 'formedAt', title: '形成时间', width: 110 },
  { key: 'sourceUnit', title: '来源单位', width: 140 },
  {
    key: 'version',
    title: '版本',
    width: 130,
    render: (row) => <VersionTag>{row.version as string}</VersionTag>,
  },
  {
    key: 'parseStatus',
    title: '解析状态',
    width: 110,
    render: (row) => <StatusTag tone="success">{row.parseStatus as string}</StatusTag>,
  },
  { key: 'segmentCount', title: '资料段', width: 80, align: 'right' },
]

export default function DocumentListPage() {
  const navigate = useNavigate()
  const segmentTotal = documentCatalog.reduce((sum, d) => sum + d.segmentCount, 0)
  const parsedCount = documentCatalog.filter((d) => d.parseStatus === '解析通过').length

  return (
    <AppShell
      activeNav="project"
      agentContext={[projectContext.project, projectContext.section]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">资料目录</h1>
            <p className="page-subtitle">工程资料版本清单、来源单位与解析状态</p>
          </div>
          <ConfirmButton
            label="登记资料"
            summary={[
              `工程：${projectContext.project}（${projectContext.section}）`,
              '对象：新登记工程资料，按元数据字段（类型、形成时间、工点位置、来源单位、版本号）逐项校验',
              '版本：登记后生成初始版本，记录操作者、时间戳与变更日志',
              '预计结果：资料进入资料目录并启动解析，按章节与表格切分资料段后逐项合规性校验',
            ]}
          />
        </header>

        <SectionTabs items={sectionTabs} />

        <div className="pjdl-kpis">
          <KpiCard label="登记资料" value={documentCatalog.length} unit="份" />
          <KpiCard label="解析通过" value={parsedCount} unit="份" />
          <KpiCard label="资料段合计" value={segmentTotal} unit="段" />
        </div>

        <Card title="工程资料版本列表">
          <DataTable
            columns={columns}
            rows={documentCatalog as unknown as Record<string, unknown>[]}
            onRowClick={(row) => navigate(`/project/documents/${row.id as string}`)}
          />
        </Card>
      </div>
    </AppShell>
  )
}
