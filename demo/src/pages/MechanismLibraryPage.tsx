import { useState } from 'react'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { ConfirmButton } from '../components/ConfirmButton'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { EvidenceLink } from '../components/EvidenceLink'
import { SectionTabs } from '../components/SectionTabs'
import { StatusTag, type StatusTone } from '../components/StatusTag'
import { VersionTag } from '../components/VersionTag'
import { mechanismEntries, type MechanismEntry } from '../content/knowledge'
import './MechanismLibraryPage.css'

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
    key: 'id',
    title: '标识',
    width: 150,
    render: (row) => {
      const e = row as unknown as MechanismEntry
      return <span className="mono">{e.id}</span>
    },
  },
  { key: 'type', title: '机理类型', width: 140 },
  {
    key: 'applicableProcesses',
    title: '适用工序',
    width: 160,
    render: (row) => (row as unknown as MechanismEntry).applicableProcesses.join('、'),
  },
  {
    key: 'triggerCondition',
    title: '触发条件摘要',
    render: (row) => (
      <span className="kme-ellipsis">
        {(row as unknown as MechanismEntry).triggerCondition}
      </span>
    ),
  },
  {
    key: 'monitoringSigns',
    title: '监测征兆摘要',
    width: 190,
    render: (row) => (row as unknown as MechanismEntry).monitoringSigns.join('、'),
  },
  {
    key: 'status',
    title: '审核状态',
    width: 100,
    render: (row) => {
      const e = row as unknown as MechanismEntry
      return <StatusTag tone={statusTone(e.status)}>{e.status}</StatusTag>
    },
  },
  {
    key: 'version',
    title: '版本',
    width: 80,
    render: (row) => <VersionTag>{(row as unknown as MechanismEntry).version}</VersionTag>,
  },
]

export default function MechanismLibraryPage() {
  const [selectedId, setSelectedId] = useState(mechanismEntries[0].id)
  const selected =
    mechanismEntries.find((e) => e.id === selectedId) ?? mechanismEntries[0]

  return (
    <AppShell activeNav="knowledge" agentContext={['风险机理库', `${mechanismEntries.length} 条已发布`]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">风险机理库</h1>
            <p className="page-subtitle">管理风险机理条目及其与工序、监测指标的关联</p>
          </div>
          <ConfirmButton
            label="新建机理条目"
            summary={[
              '新建条目登记为草稿版本，不影响当前已发布内容',
              '送审后进入复核队列，由复核人做出审核决定',
              '发布前需通过触发条件可解析、证据可定位与关键工序覆盖校验',
            ]}
          />
        </header>

        <SectionTabs items={knowledgeTabs} />

        <div className="kme-layout">
          <Card title="机理条目" extra={`共 ${mechanismEntries.length} 条`}>
            <DataTable
              columns={columns}
              rows={mechanismEntries as unknown as Record<string, unknown>[]}
              onRowClick={(row) => setSelectedId((row as unknown as MechanismEntry).id)}
            />
          </Card>

          <Card
            title={`${selected.id} · ${selected.type}`}
            extra={
              <>
                <StatusTag tone={statusTone(selected.status)}>{selected.status}</StatusTag>
                <VersionTag>{selected.version}</VersionTag>
              </>
            }
          >
            <div className="kme-detail-grid">
              <div className="kme-field">
                <div className="kme-field-label">适用工序</div>
                <div className="kme-tags">
                  {selected.applicableProcesses.map((p) => (
                    <span key={p} className="kme-tag">{p}</span>
                  ))}
                </div>
              </div>
              <div className="kme-field">
                <div className="kme-field-label">地质水文适用</div>
                <div className="kme-field-value">{selected.geologicConditions}</div>
              </div>
              <div className="kme-field kme-field--full">
                <div className="kme-field-label">触发条件表达</div>
                <div className="kme-field-value">{selected.triggerCondition}</div>
              </div>
              <div className="kme-field">
                <div className="kme-field-label">监测征兆表达</div>
                <div className="kme-tags">
                  {selected.monitoringSigns.map((s) => (
                    <span key={s} className="kme-tag">{s}</span>
                  ))}
                </div>
              </div>
              <div className="kme-field">
                <div className="kme-field-label">风险事件表达</div>
                <div className="kme-field-value">{selected.riskEventExpression}</div>
              </div>
              <div className="kme-field kme-field--full">
                <div className="kme-field-label">证据需求</div>
                <div className="kme-field-value">{selected.evidenceRequirement}</div>
              </div>
              <div className="kme-field kme-field--full">
                <div className="kme-field-label">证据定位</div>
                <div className="kme-evidence-list">
                  {selected.evidence.map((seg) => (
                    <EvidenceLink key={seg} segmentId={seg} />
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}
