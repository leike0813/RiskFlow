import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { SectionTabs } from '../components/SectionTabs'
import { StatusTag, type StatusTone } from '../components/StatusTag'
import { VersionTag } from '../components/VersionTag'
import { measureEntries, type MeasureEntry } from '../content/knowledge'
import './MeasureLibraryPage.css'

const knowledgeTabs = [
  { to: '/knowledge/mechanisms', label: '风险机理库' },
  { to: '/knowledge/rules', label: '评分规则' },
  { to: '/knowledge/matrix', label: '风险矩阵' },
  { to: '/knowledge/measures', label: '措施库' },
]

const statusTone = (status: string): StatusTone =>
  status === '已发布' ? 'success' : status === '待审核' ? 'review' : 'neutral'

const columns: DataTableColumn[] = [
  {
    key: 'name',
    title: '措施项',
    width: 190,
    render: (row) => {
      const e = row as unknown as MeasureEntry
      return (
        <span className="kms-measure">
          <span className="kms-measure-name">{e.name}</span>
          <span className="mono kms-measure-id">{e.id}</span>
        </span>
      )
    },
  },
  {
    key: 'applicableEvents',
    title: '适用风险事件',
    render: (row) => (row as unknown as MeasureEntry).applicableEvents,
  },
  {
    key: 'method',
    title: '适用工法',
    width: 130,
    render: (row) => (row as unknown as MeasureEntry).applicability[0],
  },
  {
    key: 'stratum',
    title: '适用地层',
    width: 140,
    render: (row) => (row as unknown as MeasureEntry).applicability[1],
  },
  {
    key: 'stage',
    title: '适用阶段',
    width: 170,
    render: (row) => (row as unknown as MeasureEntry).applicability[2],
  },
  {
    key: 'resources',
    title: '资源约束',
    width: 220,
    render: (row) => (row as unknown as MeasureEntry).resources,
  },
  {
    key: 'status',
    title: '审核状态',
    width: 100,
    render: (row) => {
      const e = row as unknown as MeasureEntry
      return <StatusTag tone={statusTone(e.status)}>{e.status}</StatusTag>
    },
  },
  {
    key: 'version',
    title: '版本',
    width: 80,
    render: (row) => <VersionTag>{(row as unknown as MeasureEntry).version}</VersionTag>,
  },
]

export default function MeasureLibraryPage() {
  return (
    <AppShell activeNav="knowledge" agentContext={['措施库', `${measureEntries.length} 条已发布`]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">措施库</h1>
            <p className="page-subtitle">管理处置措施项及其适用条件</p>
          </div>
        </header>

        <SectionTabs items={knowledgeTabs} />

        <Card title="措施项" extra={`共 ${measureEntries.length} 条`}>
          <DataTable
            columns={columns}
            rows={measureEntries as unknown as Record<string, unknown>[]}
          />
        </Card>
      </div>
    </AppShell>
  )
}
