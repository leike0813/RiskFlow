import { Link, useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { ConfirmButton } from '../components/ConfirmButton'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { EvidenceLink } from '../components/EvidenceLink'
import { StatusTag } from '../components/StatusTag'
import { Timeline } from '../components/Timeline'
import { VersionTag } from '../components/VersionTag'
import { WarningBadge } from '../components/WarningBadge'
import { assessmentRecord, thresholdConfigs, triggerIndicators } from '../content/assessment'
import { projectContext } from '../content/context'
import { auditTimeline } from '../content/evidence'
import { responseRecommendation, responseTask, warningRecord } from '../content/response'
import './WarningDetailPage.css'

const indicatorByName = (name: string) => triggerIndicators.find((i) => i.name === name)!
const settle = indicatorByName('地表沉降累计值')
const slope = indicatorByName('地表沉降短期斜率')
const deform = indicatorByName('支护结构变形')
const grout = indicatorByName('注浆压力')

/** 四类触发类型逐条判定说明（RA-S6，本次全部命中） */
const triggerTypeDescriptions: Record<string, string> = {
  风险等级越限: `评估风险等级 ${assessmentRecord.riskLevel} 级：${thresholdConfigs.riskAcceptance.description}（${thresholdConfigs.riskAcceptance.name} ${thresholdConfigs.riskAcceptance.version}）`,
  监测指标越限: `${settle.name} ${settle.currentValue}（阈值 ${settle.threshold}）；${deform.name} ${deform.currentValue}（阈值 ${deform.threshold}）`,
  趋势越限: `${slope.name} ${slope.currentValue}，超过趋势阈值 ${slope.threshold}`,
  多指标联合规则命中: `${grout.name} ${grout.currentValue} 低于生效区间 ${grout.threshold}，与地表沉降、支护结构变形指标联合命中`,
}

const indicatorColumns: DataTableColumn[] = [
  { key: 'name', title: '触发指标', width: 180 },
  {
    key: 'currentValue',
    title: '当前值',
    width: 120,
    render: (row) => <span className="mono">{row.currentValue as string}</span>,
  },
  {
    key: 'threshold',
    title: '阈值 / 区间',
    width: 160,
    render: (row) => <span className="mono">{row.threshold as string}</span>,
  },
  {
    key: 'status',
    title: '状态',
    width: 110,
    render: (row) => <StatusTag tone="failed">{row.status as string}</StatusTag>,
  },
  {
    key: 'evidence',
    title: '证据定位',
    render: (row) => <EvidenceLink segmentId={row.evidence as string} />,
  },
]

export default function WarningDetailPage() {
  const navigate = useNavigate()

  return (
    <AppShell activeNav="warnings" agentContext={['WARN-2026-001', '红色预警 · 待处置']}>
      <div className="page">
        <Link to="/warnings" className="wd-back">
          ← 返回预警中心
        </Link>
        <header className="page-header">
          <div>
            <h1 className="page-title">预警详情</h1>
            <p className="page-subtitle">
              预警标识 <span className="mono">{warningRecord.id}</span> · 创建时间{' '}
              <span className="mono">{warningRecord.createdAt}</span>
            </p>
          </div>
          <div className="wd-header-actions">
            <WarningBadge text={`${warningRecord.level} · ${warningRecord.status}`} />
            <ConfirmButton
              label="确认预警"
              summary={[
                `工程：${projectContext.project}`,
                `对象：预警信息 ${warningRecord.id}（${warningRecord.level}，关联风险 ${warningRecord.riskRecordId}）`,
                '语义：确认表示已读并接管该预警，不消除预警；误报请走质疑复核',
                `预计结果：预警状态变更为已确认，处置任务 ${responseTask.id} 继续归集跟踪`,
              ]}
            />
            <button
              type="button"
              className="wd-btn-ghost"
              title="质疑该预警并转入复核队列"
              onClick={() => navigate('/review')}
            >
              质疑
            </button>
          </div>
        </header>

        <div className="wd-grid">
          <div className="wd-col">
            <Card title="触发类型" extra={<span>{warningRecord.triggerTypes.length} 类触发全部命中</span>}>
              <div className="wd-trigger-list">
                {warningRecord.triggerTypes.map((t) => (
                  <div key={t} className="wd-trigger">
                    <span className="wd-trigger-dot" />
                    <div>
                      <div className="wd-trigger-name">{t}</div>
                      <div className="wd-trigger-desc">{triggerTypeDescriptions[t]}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="触发指标与证据">
              <DataTable
                columns={indicatorColumns}
                rows={triggerIndicators.map((i) => ({ ...i }))}
              />
            </Card>

            <Card
              title="建议处置方向"
              extra={<VersionTag>建议 {responseRecommendation.version}</VersionTag>}
            >
              <div className="wd-direction">{warningRecord.suggestedDirection}</div>
              <div className="wd-note">
                处置建议 <span className="mono">{responseRecommendation.id}</span>（
                {responseRecommendation.source}），共 {responseRecommendation.measures.length}{' '}
                项措施，当前状态：{responseRecommendation.reviewStatus}。
              </div>
              <div className="wd-checks">
                {responseRecommendation.checks.map((c) => (
                  <div key={c.name} className="wd-check">
                    <span>{c.name}</span>
                    <StatusTag tone="success">{c.result}</StatusTag>
                  </div>
                ))}
              </div>
              <Link to="/warnings/tasks">查看处置任务 {responseTask.id} →</Link>
            </Card>
          </div>

          <div className="wd-col">
            <Card title="关联对象">
              <div className="wd-rel-list">
                <div className="wd-rel">
                  <span className="wd-rel-label">标准化风险记录</span>
                  <Link to={`/risks/${warningRecord.riskRecordId}`} className="mono">
                    {warningRecord.riskRecordId}
                  </Link>
                </div>
                <div className="wd-rel">
                  <span className="wd-rel-label">风险评估记录</span>
                  <Link to={`/assessment/records/${warningRecord.assessmentRecordId}`} className="mono">
                    {warningRecord.assessmentRecordId}
                  </Link>
                </div>
                <div className="wd-rel">
                  <span className="wd-rel-label">预警处置任务</span>
                  <Link to="/warnings/tasks" className="mono">
                    {responseTask.id}
                  </Link>
                </div>
                <div className="wd-rel">
                  <span className="wd-rel-label">处置建议</span>
                  <span className="wd-rel-value">
                    <span className="mono">{responseRecommendation.id}</span>
                    <VersionTag>{responseRecommendation.version}</VersionTag>
                  </span>
                </div>
              </div>
            </Card>

            <Card title="通知状态">
              <StatusTag tone="neutral">{warningRecord.notificationStatus}</StatusTag>
              <div className="wd-note">
                预警记录已可靠入库，应用内通知已按通知策略发送给关联责任人角色（
                {responseTask.ownerRole}）。
              </div>
            </Card>

            <Card title="审计时间线">
              <Timeline
                items={auditTimeline.map((e) => ({
                  time: e.time,
                  title: e.title,
                  actor: e.actor,
                  tone: e.done ? 'done' : 'current',
                }))}
              />
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
