import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { ConfirmButton } from '../components/ConfirmButton'
import { PageStateView } from '../components/PageStateView'
import { StatusTag } from '../components/StatusTag'
import { WarningBadge } from '../components/WarningBadge'
import { useEngineering, usePageQuery, useProjectPath } from '../api/context'
import {
  actionAvailability,
  readAssessmentRecord,
  readWarningRecord,
  readWarningResponseResolve,
  submitWarningAcknowledgement,
  type AssessmentRecordView,
  type KindRef,
  type WarningRecordView,
  type WarningResponseResolveView,
} from '../api/operations'
import { FieldCard, FieldRow, NextPageButton, VersionRefText } from './assessmentResponseShared'
import './assessment-response.css'

/**
 * P-WR-02 预警详情（design D-02、D-05、D-06）。
 *
 * 触发阈值解释来自该预警关联评估记录保存的冻结触发事实，页面独立读取该记录，不引用
 * 当前阈值配置；通知按登记事实区分"已记录意图"与"已登记投递"，未投递不补送达时间。
 * 确认只形成确认事实，处置任务状态不变。
 */
export default function WarningDetailPage() {
  const { warningId } = useParams<{ warningId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { selector } = useEngineering()
  const projectPath = useProjectPath()
  const version = searchParams.get('version')
  const [notificationCursor, setNotificationCursor] = useState<string | undefined>(undefined)
  const [tick, setTick] = useState(0)

  const warningRef: KindRef | null =
    warningId === undefined
      ? null
      : { kind: 'warning-record', reference: { entityId: warningId, versionId: version ?? '' } }

  const warning = usePageQuery<WarningRecordView>(
    (projectId, signal) =>
      warningRef === null
        ? Promise.reject(new Error('missing warning'))
        : readWarningRecord(
            projectId,
            warningRef,
            notificationCursor === undefined ? {} : { notificationCursor },
            signal,
          ),
    [warningId, version, notificationCursor, tick],
  )

  const resolve = usePageQuery<WarningResponseResolveView>(
    (projectId, signal) =>
      warningId === undefined
        ? Promise.reject(new Error('missing warning'))
        : readWarningResponseResolve(
            projectId,
            { entityId: warningId, targetKind: 'warning', ...(version === null ? {} : { versionId: version }) },
            signal,
          ),
    [warningId, version],
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

  const assessmentRef: KindRef | null =
    warning.state.kind === 'ready' ? warning.state.value.assessmentRecordRef : null
  const assessment = usePageQuery<AssessmentRecordView>(
    (projectId, signal) =>
      assessmentRef === null
        ? Promise.reject(new Error('no-assessment-record'))
        : readAssessmentRecord(projectId, assessmentRef, signal),
    [assessmentRef?.reference.entityId, assessmentRef?.reference.versionId],
  )

  const acknowledge = async () => {
    if (warning.state.kind !== 'ready' || selector.projectId === null) return
    await submitWarningAcknowledgement(selector.projectId, {
      commandId: `demo-ack-${warning.state.value.warningRecordRef.reference.entityId}-${warning.state.value.warningRecordRef.reference.versionId}`,
      warningRecordRef: warning.state.value.warningRecordRef,
      warningResponseTaskRef: warning.state.value.taskRef,
    })
    setTick((value) => value + 1)
  }

  const availability =
    warning.state.kind === 'ready'
      ? actionAvailability(warning.state.value.actions, 'warning-response.acknowledge')
      : null

  return (
    <AppShell activeNav="warnings" agentContext={selector.projectId === null ? [] : [selector.projectId]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">预警详情</h1>
            <p className="page-subtitle">登记触发事实、通知意图与确认记录</p>
          </div>
          <div className="wd-header-actions">
            {warning.state.kind === 'ready' && (
              <WarningBadge
                text={
                  warning.state.value.acknowledgement === undefined ? '待确认' : '已确认'
                }
              />
            )}
            <ConfirmButton
              label="确认预警"
              availability={availability === 'allowed' ? 'allowed' : (availability ?? 'business-unavailable')}
              unavailableReason={
                warning.state.kind === 'ready' && warning.state.value.acknowledgement !== undefined
                  ? '该预警已确认'
                  : '当前不可执行确认'
              }
              summary={[
                `工程：${selector.projectId ?? '—'}`,
                `预警：${warning.state.kind === 'ready' ? warning.state.value.warningRecordRef.reference.entityId : '—'}`,
                '语义：确认表示已读并接管该预警，不消除预警',
                '预计结果：登记一条确认事实；处置任务状态不变',
              ]}
              onConfirm={acknowledge}
            />
          </div>
        </header>

        <PageStateView
          state={warning.state}
          title="预警详情"
          emptyMessage="该预警暂无登记事实"
          onRetry={warning.retry}
        >
          {(value) => (
            <>
              <Card title="预警登记">
                <dl>
                  <FieldRow label="预警引用">
                    <VersionRefText reference={value.warningRecordRef.reference} />
                  </FieldRow>
                  <FieldRow label="关联评估记录">
                    <Link
                      className="mono"
                      to={projectPath(
                        `assessment/records/${value.assessmentRecordRef.reference.entityId}?version=${value.assessmentRecordRef.reference.versionId}`,
                      )}
                    >
                      {value.assessmentRecordRef.reference.entityId}
                    </Link>
                  </FieldRow>
                  <FieldRow label="关联处置任务">
                    <Link
                      className="mono"
                      to={projectPath(
                        `warnings/tasks/${value.taskRef.reference.entityId}?version=${value.taskRef.reference.versionId}`,
                      )}
                    >
                      {value.taskRef.reference.entityId}
                    </Link>
                  </FieldRow>
                  {assessment.state.kind === 'ready' && (
                    <FieldRow label="矩阵落点">
                      <span className="mono">
                        {assessment.state.value.matrixPlot.possibilityBandId} ×{' '}
                        {assessment.state.value.matrixPlot.consequenceBandId} →{' '}
                        {assessment.state.value.matrixPlot.riskLevelId}（序{' '}
                        {assessment.state.value.matrixPlot.riskLevelOrdinal}）
                      </span>
                    </FieldRow>
                  )}
                  <FieldRow label="确认记录">
                    {value.acknowledgement === undefined ? (
                      <StatusTag tone="review">待确认</StatusTag>
                    ) : (
                      <span>
                        <StatusTag tone="success">已确认</StatusTag>{' '}
                        <span className="mono">
                          {value.acknowledgement.actorId} · {value.acknowledgement.acknowledgedAt}
                        </span>
                      </span>
                    )}
                  </FieldRow>
                  {value.acknowledgement !== undefined && (
                    <FieldRow label="确认审计">
                      <VersionRefText reference={value.acknowledgement.auditTrailRef.reference} />
                    </FieldRow>
                  )}
                </dl>
              </Card>

              <div className="ar-two-col" style={{ marginTop: 16 }}>
                <FieldCard title="触发事实（冻结）">
                  {assessment.state.kind === 'ready' ? (
                    assessment.state.value.triggerFacts.length === 0 ? (
                      <p className="ar-note">关联评估记录未登记触发事实。</p>
                    ) : (
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>类型</th>
                            <th>指标</th>
                            <th>阈值</th>
                          </tr>
                        </thead>
                        <tbody>
                          {assessment.state.value.triggerFacts.map((fact, index) => (
                            <tr key={`${fact.triggerType}-${index}`}>
                              <td className="mono">{fact.triggerType}</td>
                              <td className="mono">{fact.indicatorItem}</td>
                              <td className="mono">
                                {fact.thresholdId ?? '—'}
                                {fact.thresholdValue === undefined ? '' : ` = ${fact.thresholdValue}`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  ) : (
                    <p className="ar-note">
                      冻结阈值解释当前不可用
                      {assessment.state.kind === 'error' ? `（${assessment.state.code}）` : ''}
                      。页面不以当前阈值配置补齐。
                    </p>
                  )}
                  <p className="ar-note">阈值取该评估记录保存的触发事实，不引用当前配置。</p>
                </FieldCard>

                <FieldCard title="通知登记">
                  {value.notifications.length === 0 ? (
                    <p className="ar-note">暂无已登记通知。</p>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>接收主体</th>
                          <th>渠道</th>
                          <th>记录时间</th>
                          <th>投递时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {value.notifications.map((notification) => (
                          <tr key={`${notification.intentRef.reference.entityId}-${notification.recipientActorId}`}>
                            <td className="mono">{notification.recipientActorId}</td>
                            <td className="mono">{notification.channel}</td>
                            <td className="mono">{notification.recordedAt}</td>
                            <td className="mono">
                              {notification.deliveredAt ?? '未登记投递'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <NextPageButton
                    nextCursor={value.notificationsNextCursor}
                    onContinue={setNotificationCursor}
                  />
                  <p className="ar-note">通知意图不等于已送达；未登记投递时按登记事实呈现。</p>
                </FieldCard>
              </div>
            </>
          )}
        </PageStateView>
      </div>
    </AppShell>
  )
}
