import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { KpiCard } from '../components/KpiCard'
import { RiskBadge } from '../components/RiskBadge'
import { WarningBadge } from '../components/WarningBadge'
import { StatusTag } from '../components/StatusTag'
import { Icon } from '../components/icons'
import { DonutChart } from '../charts/DonutChart'
import { HBars } from '../charts/HBars'
import { TrendLine } from '../charts/TrendLine'
import {
  mainRisk,
  overviewStats,
  processRiskDistribution,
  riskRecords,
  type RiskLevel,
} from '../content/risks'
import { triggerIndicators } from '../content/assessment'
import { monitoringSeries } from '../content/evidence'
import { projectContext } from '../content/context'
import './RiskOverviewPage.css'

const levelOrder: RiskLevel[] = ['I', 'II', 'III', 'IV']
/** 风险等级色（与 theme/tokens.css --risk-1..4 一致，供 ECharts 使用） */
const levelColors: Record<RiskLevel, string> = {
  I: '#d9363e',
  II: '#f97316',
  III: '#e7ac08',
  IV: '#20a464',
}

const settleSeries = monitoringSeries.find((s) => s.id === 'MON-SERIES-SETTLE-01')!
const settleIndicator = triggerIndicators[0]
const slopeIndicator = triggerIndicators[1]
const deformIndicator = triggerIndicators[2]

/** 生效预警对应的四条风险记录（台账中状态含"预警"的记录） */
const warningRisks = riskRecords.filter((r) => r.status.includes('预警'))

const updateTime = projectContext.dataTimestamp.split(' ')[1]

export default function RiskOverviewPage() {
  const donutData = levelOrder.map((lv) => ({
    name: `${lv}级风险`,
    value: overviewStats.levelCounts[lv],
    color: levelColors[lv],
  }))

  return (
    <AppShell activeNav="overview" agentContext={['变径空间扩挖', 'I 级风险 1 项', '生效预警 4 项']}>
      <div className="page ov-page">
        <header className="page-header ov-header">
          <div className="ov-title-row">
            <h1 className="page-title">风险态势总览</h1>
            <p className="page-subtitle">变径空间扩挖阶段风险集中，1 项 I 级风险已触发预警</p>
          </div>
          <StatusTag tone="neutral">数据已更新 · {updateTime}</StatusTag>
        </header>

        <div className="ov-kpi-row">
          <KpiCard
            label="当前风险"
            value={overviewStats.total}
            unit="项"
            tag={`覆盖 ${processRiskDistribution.length} 个工序`}
          />
          <KpiCard
            label="I级风险"
            value={overviewStats.levelCounts.I}
            unit="项"
            tag="已触发红色预警"
            tone="risk"
          />
          <KpiCard
            label="生效预警"
            value={overviewStats.activeWarnings}
            unit="项"
            tag="含红色预警 1 项"
            tone="risk"
          />
          <KpiCard
            label="待处置"
            value={overviewStats.pendingResponse}
            unit="项"
            tag="处置建议待确认"
          />
        </div>

        <div className="ov-row ov-row--level">
          <Card title="风险等级分布" extra={<span>共 {overviewStats.total} 项</span>}>
            <div className="ov-level-body">
              <div className="ov-donut">
                {/* echarts.ts 未注册 TitleComponent，中心标签由页面覆盖层渲染 */}
                <DonutChart data={donutData} centerLabel="" height={216} />
                <div className="ov-donut-center">{overviewStats.total} 项风险</div>
              </div>
              <ul className="ov-legend">
                {levelOrder.map((lv) => {
                  const count = overviewStats.levelCounts[lv]
                  return (
                    <li key={lv} className="ov-legend-item">
                      <span className="ov-legend-dot" style={{ background: levelColors[lv] }} />
                      <span className="ov-legend-name">{lv}级风险</span>
                      <span className="ov-legend-count mono">{count} 项</span>
                      <span className="ov-legend-pct mono">
                        {Math.round((count / overviewStats.total) * 100)}%
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </Card>

          <Card title="五工序风险分布">
            <p className="ov-process-summary">
              风险主要集中在<strong>变径空间扩挖</strong>和<strong>刀盘扩径</strong>阶段
            </p>
            <HBars
              data={processRiskDistribution.map((d) => ({
                name: d.name,
                value: d.count,
                highlight: d.highlight,
              }))}
              height={182}
            />
          </Card>
        </div>

        <div className="ov-row ov-row--bottom">
          <Card title="地表沉降七日趋势" extra={<span>单位：{settleSeries.unit}</span>}>
            <div className="ov-trend-body">
              <TrendLine
                points={settleSeries.points}
                threshold={settleSeries.threshold}
                thresholdLabel={settleSeries.thresholdLabel}
                height={312}
              />
              <div className="ov-trend-metrics">
                {[slopeIndicator, deformIndicator].map((ind) => (
                  <div key={ind.name} className="ov-metric">
                    <span className="ov-metric-label">{ind.name}</span>
                    <span className="ov-metric-value mono">{ind.currentValue}</span>
                    <span className="ov-metric-th">
                      阈值 {ind.threshold}
                      <em className="ov-metric-status"> · {ind.status}</em>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card title="待处置预警" extra={<span>共 {warningRisks.length} 项</span>}>
            <div className="ov-warn-body">
              <Link to={`/risks/${mainRisk.id}`} className="ov-warn-main">
                <div className="ov-warn-main-top">
                  <span className="ov-warn-id mono">{mainRisk.id}</span>
                  <RiskBadge level={mainRisk.level} />
                  <WarningBadge text={mainRisk.status} />
                </div>
                <div className="ov-warn-event">{mainRisk.riskEvent}</div>
                <div className="ov-warn-meta">
                  <span>{mainRisk.processName}</span>
                  <span className="ov-warn-sep" />
                  <span>
                    地表沉降累计值{' '}
                    <b className="ov-warn-value mono">{settleIndicator.currentValue}</b>
                    （阈值 {settleIndicator.threshold}）
                  </span>
                </div>
              </Link>

              <ul className="ov-warn-list">
                {warningRisks.slice(1).map((r) => (
                  <li key={r.id}>
                    <Link to={`/risks/${mainRisk.id}`} className="ov-warn-row">
                      <div className="ov-warn-row-top">
                        <span className="ov-warn-id mono">{r.id}</span>
                        <RiskBadge level={r.level} />
                        <span className="ov-warn-status">
                          <Icon name="alert" size={12} />
                          {r.status}
                        </span>
                        <span className="ov-warn-process">{r.processName}</span>
                      </div>
                      <div className="ov-warn-row-event">{r.riskEvent}</div>
                    </Link>
                  </li>
                ))}
              </ul>

              <Link to={`/risks/${mainRisk.id}`} className="ov-warn-more">
                查看风险详情
                <Icon name="arrowRight" size={14} />
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}
