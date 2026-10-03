import { useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { KpiCard } from '../components/KpiCard'
import { PageStateView } from '../components/PageStateView'
import { StatusTag } from '../components/StatusTag'
import { useEngineering, usePageQuery, useProjectPath } from '../api/context'
import {
  readAssessmentOverview,
  readEngineeringContext,
  readRiskOverviewRunPage,
  readWarningResponseOverview,
  type AssessmentOverviewView,
  type EngineeringContextView,
  type KindRef,
  type QueryResultRefView,
  type RiskOverviewRunPageView,
  type WarningResponseOverviewView,
} from '../api/operations'
import { NextPageButton, VersionRefText, stateTone } from './assessmentResponseShared'
import './RiskOverviewPage.css'
import './assessment-response.css'

/**
 * P-OV-01 风险态势总览（design D-02、D-10）。
 *
 * 两套口径各自独立呈现，互不替代：上方摘要是 C34 的有界所属摘要（评估记录数、开放任务、
 * 预警等级分布，各自标注 asOf）；下方是原 C31 投影的运行摘要按页追溯，保留原
 * queryResultRef 与游标，不在页面上把两者相加或用一方失败冒充另一方。
 */
export default function RiskOverviewPage() {
  const { selector } = useEngineering()
  const projectPath = useProjectPath()
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [runQueryRef, setRunQueryRef] = useState<QueryResultRefView | undefined>(undefined)

  const context = usePageQuery<EngineeringContextView>(
    (projectId, signal) => readEngineeringContext(projectId, signal),
    [],
  )
  const revisionRef: KindRef | null =
    context.state.kind === 'ready' ? (context.state.value.currentProjectRevisionRef ?? null) : null

  const assessment = usePageQuery<AssessmentOverviewView>(
    (projectId, signal) =>
      revisionRef === null
        ? Promise.reject(new Error('no-project-revision'))
        : readAssessmentOverview(projectId, { projectRevisionRef: revisionRef }, signal),
    [revisionRef?.reference.entityId, revisionRef?.reference.versionId],
  )
  const warning = usePageQuery<WarningResponseOverviewView>(
    (projectId, signal) => readWarningResponseOverview(projectId, {}, signal),
    [],
  )
  const runs = usePageQuery<RiskOverviewRunPageView>(
    (projectId, signal) =>
      revisionRef === null
        ? Promise.reject(new Error('no-project-revision'))
        : readRiskOverviewRunPage(
            projectId,
            revisionRef,
            {
              ...(runQueryRef === undefined ? {} : { queryResultRef: runQueryRef }),
              ...(cursor === undefined ? {} : { cursor }),
            },
            signal,
          ),
    [revisionRef?.reference.entityId, revisionRef?.reference.versionId, runQueryRef, cursor],
  )

  if (runs.state.kind === 'ready' && runQueryRef === undefined) {
    setRunQueryRef(runs.state.value.queryResultRef)
  }

  return (
    <AppShell activeNav="overview" agentContext={selector.projectId === null ? [] : [selector.projectId]}>
      <div className="page ov-page">
        <header className="page-header ov-header">
          <div className="ov-title-row">
            <h1 className="page-title">风险态势总览</h1>
            <p className="page-subtitle">按已入库记录统计的评估与预警态势</p>
          </div>
          {revisionRef !== null && (
            <StatusTag tone="neutral">
              工程修订 {revisionRef.reference.versionId}
            </StatusTag>
          )}
        </header>

        <div className="ov-kpi-row">
          <PageStateView state={assessment.state} title="评估摘要" emptyMessage="暂无评估摘要">
            {(value) => (
              <>
                <KpiCard label="已入库评估记录" value={value.recordedAssessmentCount} unit="条" />
                <KpiCard
                  label="风险状态分布"
                  value={value.riskLevelCounts.length}
                  unit="类"
                  tag={`asOf ${value.asOf.slice(0, 10)}`}
                />
              </>
            )}
          </PageStateView>
          <PageStateView state={warning.state} title="预警摘要" emptyMessage="暂无预警摘要">
            {(value) => (
              <>
                <KpiCard label="开放处置任务" value={value.openTaskCount} unit="项" />
                <KpiCard
                  label="生效预警"
                  value={value.warningCount}
                  unit="项"
                  tag={`asOf ${value.asOf.slice(0, 10)}`}
                  tone="risk"
                />
              </>
            )}
          </PageStateView>
        </div>

        <Card title="风险状态分布" style={{ marginTop: 16 }}>
          <PageStateView state={assessment.state} title="风险状态分布" emptyMessage="暂无已入库评估记录">
            {(value) =>
              value.riskLevelCounts.length === 0 ? (
                <p className="ar-note">当前统计范围内暂无已入库的评估记录。</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>风险状态</th>
                      <th>记录数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {value.riskLevelCounts.map((entry) => (
                      <tr key={entry.riskLevel}>
                        <td className="mono">{entry.riskLevel}</td>
                        <td className="mono">{entry.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </PageStateView>
        </Card>

        <Card title="预警等级分布" style={{ marginTop: 16 }}>
          <PageStateView state={warning.state} title="预警等级分布" emptyMessage="暂无已登记预警">
            {(value) =>
              value.levelCounts.length === 0 ? (
                <p className="ar-note">开放任务下暂无已登记的预警。</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>预警等级</th>
                      <th>数量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {value.levelCounts.map((entry) => (
                      <tr key={entry.warningLevel}>
                        <td className="mono">{entry.warningLevel}</td>
                        <td className="mono">{entry.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </PageStateView>
        </Card>

        <Card title="运行摘要（原投影追溯）" style={{ marginTop: 16 }}>
          <p className="ar-note">
            本区来自既有投影查询，按页读取；与上方摘要口径不同，不合并统计。
          </p>
          <PageStateView
            state={runs.state}
            title="运行摘要"
            emptyMessage="当前工程修订暂无运行投影"
            onRetry={runs.retry}
          >
            {(page) => (
              <>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>运行标识</th>
                      <th>状态</th>
                      <th>入口身份</th>
                      <th>父运行</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((item) => (
                      <tr key={item.workflowRunRef.reference.entityId}>
                        <td>
                          <Link
                            className="mono"
                            to={projectPath(
                              `assessment/runs/${item.workflowRunRef.reference.entityId}?version=${item.workflowRunRef.reference.versionId}`,
                            )}
                          >
                            {item.workflowRunRef.reference.entityId}
                          </Link>
                        </td>
                        <td>
                          <StatusTag tone={stateTone(item.status)}>{item.status}</StatusTag>
                        </td>
                        <td className="mono">
                          <VersionRefText reference={item.entryIdentity} />
                        </td>
                        <td className="mono">{item.parentRunRef?.reference.entityId ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <NextPageButton nextCursor={page.nextCursor} onContinue={setCursor} />
                <p className="ar-note">
                  投影结果引用：<VersionRefText reference={page.queryResultRef.reference} />
                </p>
              </>
            )}
          </PageStateView>
        </Card>
      </div>
    </AppShell>
  )
}
