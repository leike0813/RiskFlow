import { useParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { EvidenceLink } from '../components/EvidenceLink'
import { KpiCard } from '../components/KpiCard'
import { StatusTag } from '../components/StatusTag'
import { VersionTag } from '../components/VersionTag'
import { TrendLine } from '../charts/TrendLine'
import { projectContext } from '../content/context'
import { documentCatalog, evidenceSegments, monitoringSeries } from '../content/evidence'
import { thresholdConfigs } from '../content/assessment'
import './MonitoringDetailPage.css'

/** 监测序列 → 对应监测摘要资料段 */
const summarySegmentBySeries: Record<string, string> = {
  'MON-SERIES-SETTLE-01': 'SRC-MON-003-20260827-SEG036',
  'MON-SERIES-DEFORM-01': 'SRC-MON-003-20260827-SEG035',
  'MON-SERIES-GROUT-01': 'SRC-MON-003-20260827-SEG034',
}

const settleSeries = monitoringSeries.find((s) => s.id === 'MON-SERIES-SETTLE-01')!
const deformSeries = monitoringSeries.find((s) => s.id === 'MON-SERIES-DEFORM-01')!
const groutSeries = monitoringSeries.find((s) => s.id === 'MON-SERIES-GROUT-01')!
const monitorDoc = documentCatalog.find((d) => d.id === 'SRC-MON-003')!

/** 地表沉降短期斜率实际取值与阈值（取自监测摘要资料段） */
const settleSummary = evidenceSegments.find(
  (s) => s.segmentId === 'SRC-MON-003-20260827-SEG036',
)!.summary
const slopeMatch = settleSummary.match(/短期斜率 ([\d.]+) mm\/d，超过 ([\d.]+) mm\/d/)
const slopeValue = slopeMatch?.[1] ?? '—'
const slopeThreshold =
  thresholdConfigs.monitoring.items
    .find((i) => i.includes('短期斜率'))
    ?.match(/([\d.]+) mm\/d/)?.[1] ?? '—'

/** 注浆压力生效区间（取自版本化监测预警阈值配置） */
const groutInterval =
  thresholdConfigs.monitoring.items
    .find((i) => i.startsWith('注浆压力'))
    ?.replace(/^注浆压力\s*/, '') ?? ''

const snapshotColumns: DataTableColumn[] = [
  { key: 'date', title: '日期', width: 120 },
  { key: 'value', title: '累计值', width: 120, align: 'right' },
  { key: 'delta', title: '较上日', width: 100, align: 'right' },
  {
    key: 'status',
    title: '状态',
    width: 100,
    render: (row) =>
      row.exceeded ? (
        <StatusTag tone="failed">越限</StatusTag>
      ) : (
        <StatusTag tone="neutral">未越限</StatusTag>
      ),
  },
]

export default function MonitoringDetailPage() {
  const { seriesId } = useParams<{ seriesId: string }>()
  const series = monitoringSeries.find((s) => s.id === seriesId) ?? settleSeries
  const summarySegmentId = summarySegmentBySeries[series.id]

  const snapshots = series.points.map((p, i) => ({
    date: `2026-${p.date}`,
    value: `${p.value.toFixed(1)} ${series.unit}`,
    delta: i > 0 ? `+${(p.value - series.points[i - 1].value).toFixed(1)}` : '—',
    exceeded: p.value >= series.threshold,
  }))

  return (
    <AppShell activeNav="project" agentContext={[projectContext.project, series.name]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">{series.name}</h1>
            <p className="page-subtitle">
              {monitorDoc.name} · {monitorDoc.version} · 来源单位：{monitorDoc.sourceUnit}
            </p>
          </div>
          {series.status !== '未越限' && <StatusTag tone="failed">{series.status}</StatusTag>}
        </header>

        <div className="pjmon-chart-row">
          <Card
            title={`${series.name}趋势（近七日）`}
            extra={
              <>
                <VersionTag>监测预警阈值 {thresholdConfigs.monitoring.version}</VersionTag>
                {summarySegmentId && <EvidenceLink segmentId={summarySegmentId} name="监测摘要" />}
              </>
            }
          >
            <TrendLine
              points={series.points}
              threshold={series.threshold}
              thresholdLabel={series.thresholdLabel}
              height={220}
            />
          </Card>
        </div>

        <div className="pjmon-kpis">
          <KpiCard
            label="地表沉降累计值"
            value={settleSeries.currentValue}
            unit={settleSeries.unit}
            tag={`阈值 ${settleSeries.threshold.toFixed(1)} mm · 已越限`}
            tone="risk"
          />
          <KpiCard
            label="地表沉降短期斜率"
            value={slopeValue}
            unit="mm/d"
            tag={`阈值 ${slopeThreshold} mm/d · 已越限`}
            tone="risk"
          />
          <KpiCard
            label="支护结构变形"
            value={deformSeries.currentValue}
            unit={deformSeries.unit}
            tag={`阈值 ${deformSeries.threshold.toFixed(1)} mm · 已越限`}
            tone="risk"
          />
          <KpiCard
            label="注浆压力"
            value={groutSeries.currentValue}
            unit={groutSeries.unit}
            tag={`生效区间 ${groutInterval} · 低于区间`}
            tone="risk"
          />
        </div>

        <Card title="批次与监测快照">
          <DataTable columns={snapshotColumns} rows={snapshots} />
        </Card>
      </div>
    </AppShell>
  )
}
