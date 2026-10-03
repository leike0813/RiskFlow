import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { ConfirmButton } from '../components/ConfirmButton'
import { PageStateView } from '../components/PageStateView'
import { StatusTag } from '../components/StatusTag'
import { useEngineering, usePageQuery, useProjectPath } from '../api/context'
import {
  actionAvailability,
  readResponseRecommendation,
  readWarningResponseResolve,
  submitRecommendationDecision,
  type KindRef,
  type RecommendationView,
  type WarningResponseResolveView,
} from '../api/operations'
import { FieldCard, FieldRow, VersionRefText } from './assessmentResponseShared'
import './assessment-response.css'

/**
 * P-RS-01 正式建议详情（design D-02、D-05、D-07）。
 *
 * 候选不能被采纳：这里读的是 C27 已成立的正式建议。采纳必须选择执行前监测快照的
 * 精确引用，页面不提交"最新监测"；拒绝不启动预测。两个动作分别确认，不合并为一个按钮。
 */
export default function RecommendationDetailPage() {
  const { recommendationId } = useParams<{ recommendationId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { selector } = useEngineering()
  const projectPath = useProjectPath()
  const version = searchParams.get('version')
  const preActionSnapshot = searchParams.get('preActionSnapshot') ?? ''
  const preActionSnapshotVersion = searchParams.get('preActionSnapshotVersion') ?? ''
  const [tick, setTick] = useState(0)

  const recommendationRef: KindRef | null =
    recommendationId === undefined
      ? null
      : {
          kind: 'response-recommendation',
          reference: { entityId: recommendationId, versionId: version ?? '' },
        }

  const recommendation = usePageQuery<RecommendationView>(
    (projectId, signal) =>
      recommendationRef === null
        ? Promise.reject(new Error('missing recommendation'))
        : readResponseRecommendation(projectId, recommendationRef, signal),
    [recommendationId, version, tick],
  )

  const resolve = usePageQuery<WarningResponseResolveView>(
    (projectId, signal) =>
      recommendationId === undefined
        ? Promise.reject(new Error('missing recommendation'))
        : readWarningResponseResolve(
            projectId,
            {
              entityId: recommendationId,
              targetKind: 'recommendation',
              ...(version === null ? {} : { versionId: version }),
            },
            signal,
          ),
    [recommendationId, version],
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

  const decide = async (decision: 'adopted' | 'declined') => {
    if (recommendation.state.kind !== 'ready' || selector.projectId === null) return
    const ref = recommendation.state.value.responseRecommendationRef
    await submitRecommendationDecision(selector.projectId, {
      commandId: `demo-decide-${decision}-${ref.reference.entityId}-${ref.reference.versionId}`,
      responseRecommendationRef: ref,
      decision,
      reasonCode: decision === 'adopted' ? 'adopt-per-response-plan' : 'decline-per-response-plan',
      ...(decision === 'adopted' && preActionSnapshot !== ''
        ? {
            preActionMonitoringSnapshotRef: {
              kind: 'monitoring-snapshot',
              reference: {
                entityId: preActionSnapshot,
                versionId: preActionSnapshotVersion === '' ? preActionSnapshot : preActionSnapshotVersion,
              },
            },
          }
        : {}),
    })
    setTick((value) => value + 1)
  }

  const actions = recommendation.state.kind === 'ready' ? recommendation.state.value.actions : []
  const decideAvailability = actionAvailability(actions, 'warning-response.adopt-recommendation')
  const decided = recommendation.state.kind === 'ready' ? recommendation.state.value.decision : undefined
  const monitorSnapshotRef: KindRef | null =
    preActionSnapshot === ''
      ? null
      : {
          kind: 'monitoring-snapshot',
          reference: {
            entityId: preActionSnapshot,
            versionId: preActionSnapshotVersion === '' ? preActionSnapshot : preActionSnapshotVersion,
          },
        }

  return (
    <AppShell activeNav="warnings" agentContext={selector.projectId === null ? [] : [selector.projectId]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">正式建议</h1>
            <p className="page-subtitle">正式建议、验证结果与人工决定</p>
          </div>
        </header>

        <PageStateView
          state={recommendation.state}
          title="建议详情"
          emptyMessage="该建议暂无登记事实"
          onRetry={recommendation.retry}
        >
          {(value) => (
            <>
              <Card title="建议登记">
                <dl>
                  <FieldRow label="建议引用">
                    <VersionRefText reference={value.responseRecommendationRef.reference} />
                  </FieldRow>
                  <FieldRow label="冻结任务">
                    <Link
                      className="mono"
                      to={projectPath(
                        `warnings/tasks/${value.taskRef.reference.entityId}?version=${value.taskRef.reference.versionId}`,
                      )}
                    >
                      {value.taskRef.reference.entityId}
                    </Link>
                  </FieldRow>
                  <FieldRow label="生成策略">
                    <VersionRefText reference={value.generationPolicyRef} />
                  </FieldRow>
                  <FieldRow label="验证策略">
                    <VersionRefText reference={value.validationPolicyRef} />
                  </FieldRow>
                  <FieldRow label="措施发布">
                    {value.measureReleaseRefs.length === 0 ? (
                      <span className="ar-note">未关联措施发布引用</span>
                    ) : (
                      <ul className="ar-ref-list">
                        {value.measureReleaseRefs.map((ref) => (
                          <li key={ref.reference.entityId}>
                            <VersionRefText label={ref.kind} reference={ref.reference} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </FieldRow>
                </dl>
              </Card>

              <div className="ar-two-col" style={{ marginTop: 16 }}>
                <FieldCard title="验证结果">
                  {value.validationResults.length === 0 ? (
                    <p className="ar-note">暂无验证结果。</p>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>检查项</th>
                          <th>结论</th>
                          <th>原因码</th>
                          <th>证据</th>
                        </tr>
                      </thead>
                      <tbody>
                        {value.validationResults.map((check) => (
                          <tr key={check.checkId}>
                            <td className="mono">{check.checkId}</td>
                            <td>
                              <StatusTag tone={check.pass ? 'success' : 'failed'}>
                                {check.pass ? '通过' : '未通过'}
                              </StatusTag>
                            </td>
                            <td className="mono">{check.reasonCode ?? '—'}</td>
                            <td className="mono">{check.evidenceReferences.length}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </FieldCard>

                <FieldCard title="人工决定">
                  {decided === undefined ? (
                    <p className="ar-note">尚未形成人工决定。</p>
                  ) : (
                    <dl>
                      <FieldRow label="结论">
                        <StatusTag tone={decided.state === 'adopted' ? 'success' : 'failed'}>
                          {decided.state === 'adopted' ? '已采纳' : '已拒绝'}
                        </StatusTag>
                      </FieldRow>
                      <FieldRow label="决定引用">
                        <VersionRefText reference={decided.decisionRef.reference} />
                      </FieldRow>
                      <FieldRow label="决定主体">
                        <span className="mono">{decided.actorId}</span>
                      </FieldRow>
                      <FieldRow label="决定时间">
                        <span className="mono">{decided.decidedAt}</span>
                      </FieldRow>
                      <FieldRow label="原因码">
                        <span className="mono">{decided.reasonCode}</span>
                      </FieldRow>
                      {decided.forecastRunRef !== undefined && (
                        <FieldRow label="预测运行">
                          <VersionRefText reference={decided.forecastRunRef.reference} />
                        </FieldRow>
                      )}
                    </dl>
                  )}
                </FieldCard>
              </div>

              <Card title="采纳 / 拒绝" style={{ marginTop: 16 }}>
                <label className="ar-form-field">
                  执行前监测快照标识
                  <input
                    type="text"
                    value={preActionSnapshot}
                    onChange={(event) => {
                      const next = new URLSearchParams(searchParams)
                      if (event.target.value === '') next.delete('preActionSnapshot')
                      else next.set('preActionSnapshot', event.target.value)
                      setSearchParams(next)
                    }}
                    placeholder="采纳时必填：采纳路径据此建立真实等待运行"
                  />
                </label>
                <p className="ar-note">
                  采纳必须给出执行前监测快照的精确引用；缺省时由服务端在唯一合格候选下选择，
                  候选不唯一即安全失败。
                </p>
                <div className="wd-header-actions">
                  <ConfirmButton
                    label="采纳建议"
                    availability={decided === undefined && decideAvailability === 'allowed' ? 'allowed' : 'business-unavailable'}
                    unavailableReason={
                      decided !== undefined ? '该建议已有终局决定' : '当前角色无采纳权限'
                    }
                    summary={[
                      `工程：${selector.projectId ?? '—'}`,
                      `建议：${value.responseRecommendationRef.reference.entityId}`,
                      `执行前监测快照：${monitorSnapshotRef?.reference.entityId ?? '未指定（由服务端在唯一合格候选下选择）'}`,
                      '预计结果：登记人工采纳并建立真实等待运行；只有预测运行成立后才提交决定',
                    ]}
                    onConfirm={() => decide('adopted')}
                  />
                  <ConfirmButton
                    label="拒绝建议"
                    tone="danger"
                    availability={decided === undefined && decideAvailability === 'allowed' ? 'allowed' : 'business-unavailable'}
                    unavailableReason={decided !== undefined ? '该建议已有终局决定' : '当前角色无决定权限'}
                    summary={[
                      `工程：${selector.projectId ?? '—'}`,
                      `建议：${value.responseRecommendationRef.reference.entityId}`,
                      '语义：拒绝终止该建议的处置路径',
                      '预计结果：登记拒绝事实；不启动预测运行',
                    ]}
                    onConfirm={() => decide('declined')}
                  />
                </div>
              </Card>
            </>
          )}
        </PageStateView>
      </div>
    </AppShell>
  )
}
