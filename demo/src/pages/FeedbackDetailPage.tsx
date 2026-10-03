import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { PageStateView } from '../components/PageStateView'
import { StatusTag } from '../components/StatusTag'
import { useEngineering, usePageQuery, useProjectPath } from '../api/context'
import {
  readFeedbackRecord,
  readWarningResponseResolve,
  type FeedbackView,
  type KindRef,
  type WarningResponseResolveView,
} from '../api/operations'
import { FieldCard, FieldRow, VersionRefText } from './assessmentResponseShared'
import './assessment-response.css'

/** 私有计算偏差是只读解释，不是公共偏差记录；两者分别呈现，不互相冒充。 */
const deviationSummary = (deviation: unknown): { readonly key: string; readonly value: string }[] => {
  if (typeof deviation !== 'object' || deviation === null) return []
  const record = deviation as Record<string, unknown>
  return Object.entries(record).map(([key, value]) => ({
    key,
    value: typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value),
  }))
}

/**
 * P-RS-04 反馈详情（design D-02、D-05）。
 *
 * 公共偏差记录（C29 登记）与私有计算偏差解释分别给出：公共记录带精确引用与版本，
 * 私有解释只作只读呈现。预测不可用时不补数值、未越限时页面不显示越限结论。
 * 偏差阈值正文需另行取得冻结的偏差策略发布，页面不引用当前阈值。
 */
export default function FeedbackDetailPage() {
  const { feedbackId } = useParams<{ feedbackId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { selector } = useEngineering()
  const projectPath = useProjectPath()
  const version = searchParams.get('version')
  const [calibrationCursor, setCalibrationCursor] = useState<string | undefined>(undefined)

  const feedbackRef: KindRef | null =
    feedbackId === undefined
      ? null
      : { kind: 'feedback-record', reference: { entityId: feedbackId, versionId: version ?? '' } }

  const feedback = usePageQuery<FeedbackView>(
    (projectId, signal) =>
      feedbackRef === null
        ? Promise.reject(new Error('missing feedback'))
        : readFeedbackRecord(
            projectId,
            feedbackRef,
            calibrationCursor === undefined ? {} : { calibrationCursor },
            signal,
          ),
    [feedbackId, version, calibrationCursor],
  )

  const resolve = usePageQuery<WarningResponseResolveView>(
    (projectId, signal) =>
      feedbackId === undefined
        ? Promise.reject(new Error('missing feedback'))
        : readWarningResponseResolve(
            projectId,
            { entityId: feedbackId, targetKind: 'feedback', ...(version === null ? {} : { versionId: version }) },
            signal,
          ),
    [feedbackId, version],
  )

  useEffect(() => {
    if (version !== null || resolve.state.kind !== 'ready') return
    const ref = resolve.state.value.refs[0]
    if (ref === undefined) return
    const next = new URLSearchParams(searchParams)
    next.set('version', ref.reference.versionId)
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolve.state, version])

  return (
    <AppShell activeNav="warnings" agentContext={selector.projectId === null ? [] : [selector.projectId]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">处置反馈</h1>
            <p className="page-subtitle">反馈事实、实际评估与偏差解释</p>
          </div>
        </header>

        <PageStateView
          state={feedback.state}
          title="反馈详情"
          emptyMessage="该反馈暂无登记事实"
          onRetry={feedback.retry}
        >
          {(value) => (
            <>
              <Card title="反馈登记">
                <dl>
                  <FieldRow label="反馈引用">
                    <VersionRefText reference={value.feedbackRef.reference} />
                  </FieldRow>
                  <FieldRow label="执行记录">
                    <Link
                      className="mono"
                      to={projectPath(
                        `response/executions/register?execution=${value.executionRef.reference.entityId}&version=${value.executionRef.reference.versionId}`,
                      )}
                    >
                      {value.executionRef.reference.entityId}
                    </Link>
                  </FieldRow>
                  <FieldRow label="处置后监测快照">
                    <VersionRefText reference={value.postActionMonitoringSnapshotRef.reference} />
                  </FieldRow>
                  <FieldRow label="反馈工件">
                    <VersionRefText reference={value.feedbackArtifactRef.reference} />
                  </FieldRow>
                  <FieldRow label="实际评估记录">
                    <Link
                      className="mono"
                      to={projectPath(
                        `assessment/records/${value.actualAssessmentRecordRef.reference.entityId}?version=${value.actualAssessmentRecordRef.reference.versionId}`,
                      )}
                    >
                      {value.actualAssessmentRecordRef.reference.entityId}
                    </Link>
                  </FieldRow>
                  <FieldRow label="反馈时间">
                    <span className="mono">{value.occurredAt}</span>
                  </FieldRow>
                  <FieldRow label="预测可用性">
                    {value.forecastAvailability.kind === 'available' ? (
                      <StatusTag tone="success">预测已给出取值</StatusTag>
                    ) : (
                      <StatusTag tone="review">预测不可用（{value.forecastAvailability.reasonCode}）</StatusTag>
                    )}
                  </FieldRow>
                </dl>
              </Card>

              <div className="ar-two-col" style={{ marginTop: 16 }}>
                <FieldCard title="公共偏差记录">
                  {value.deviationRecordRef === undefined ? (
                    <p className="ar-note">尚未形成公共偏差记录。</p>
                  ) : (
                    <dl>
                      <FieldRow label="偏差记录引用">
                        <VersionRefText reference={value.deviationRecordRef.reference} />
                      </FieldRow>
                      {value.deviationRecord !== undefined && (
                        <FieldRow label="记录正文">
                          <pre className="ar-record-body">{JSON.stringify(value.deviationRecord, null, 2)}</pre>
                        </FieldRow>
                      )}
                    </dl>
                  )}
                </FieldCard>

                <FieldCard title="计算偏差解释（只读）">
                  {value.deviation === undefined ? (
                    <p className="ar-note">暂无已登记的偏差解释。</p>
                  ) : (
                    <dl>
                      {deviationSummary(value.deviation).map((entry) => (
                        <FieldRow key={entry.key} label={entry.key}>
                          <span className="mono">{entry.value}</span>
                        </FieldRow>
                      ))}
                    </dl>
                  )}
                  <p className="ar-note">
                    这是领域侧按冻结偏差策略计算的只读解释，不是公共偏差记录；阈值正文需另行取得
                    冻结的偏差策略发布，页面不引用当前阈值。
                  </p>
                </FieldCard>
              </div>

              <Card title="校准建议" style={{ marginTop: 16 }}>
                {value.calibrationRefs.length === 0 ? (
                  <p className="ar-note">该反馈下暂无已登记的校准建议。</p>
                ) : (
                  <ul className="ar-ref-list">
                    {value.calibrationRefs.map((ref) => (
                      <li key={ref.reference.entityId}>
                        <Link
                          className="mono"
                          to={projectPath(
                            `response/calibrations/${ref.reference.entityId}?version=${ref.reference.versionId}`,
                          )}
                        >
                          {ref.reference.entityId}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {value.nextCursor !== undefined && (
                  <div className="ar-next-page">
                    <button
                      type="button"
                      className="ar-chip"
                      onClick={() => setCalibrationCursor(value.nextCursor)}
                    >
                      续页（校准）
                    </button>
                  </div>
                )}
              </Card>
            </>
          )}
        </PageStateView>
      </div>
    </AppShell>
  )
}
