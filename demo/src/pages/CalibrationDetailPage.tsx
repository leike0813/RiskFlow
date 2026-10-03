import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { ConfirmButton } from '../components/ConfirmButton'
import { PageStateView } from '../components/PageStateView'
import { StatusTag } from '../components/StatusTag'
import { useEngineering, usePageQuery } from '../api/context'
import {
  actionAvailability,
  readCalibrationSuggestion,
  readWarningResponseResolve,
  submitCalibrationGovernanceDraft,
  submitCalibrationReviewOutcome,
  type CalibrationView,
  type KindRef,
  type WarningResponseResolveView,
} from '../api/operations'
import { FieldCard, FieldRow, VersionRefText, stateTone } from './assessmentResponseShared'
import './assessment-response.css'

/**
 * P-RS-05 校准建议与治理（design D-02、D-08）。
 *
 * 状态取当前偏差记录版本，不是不可变的建议行。收口（拒绝/退回）与创建草案是两个独立
 * 分支、各自确认：批准只生成未发布修订，页面不显示为已发布知识，也不代专家作决定。
 */
export default function CalibrationDetailPage() {
  const { suggestionId } = useParams<{ suggestionId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { selector } = useEngineering()
  const version = searchParams.get('version')
  const [tick, setTick] = useState(0)

  const suggestionRef: KindRef | null =
    suggestionId === undefined
      ? null
      : { kind: 'calibration-suggestion', reference: { entityId: suggestionId, versionId: version ?? '' } }

  const calibration = usePageQuery<CalibrationView>(
    (projectId, signal) =>
      suggestionRef === null
        ? Promise.reject(new Error('missing suggestion'))
        : readCalibrationSuggestion(projectId, suggestionRef, signal),
    [suggestionId, version, tick],
  )

  const resolve = usePageQuery<WarningResponseResolveView>(
    (projectId, signal) =>
      suggestionId === undefined
        ? Promise.reject(new Error('missing suggestion'))
        : readWarningResponseResolve(
            projectId,
            { entityId: suggestionId, targetKind: 'calibration', ...(version === null ? {} : { versionId: version }) },
            signal,
          ),
    [suggestionId, version],
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

  const submit = async (outcome: 'reject' | 'return-for-revision' | 'approve-draft-creation') => {
    if (calibration.state.kind !== 'ready' || selector.projectId === null) return
    const value = calibration.state.value
    if (value.reviewDecisionRef === undefined) return
    const base = {
      calibrationSuggestionRef: value.calibrationSuggestionRef,
      reviewDecisionRef: value.reviewDecisionRef,
    }
    const commandId = `demo-cal-${outcome}-${value.calibrationSuggestionRef.reference.entityId}-${value.calibrationSuggestionRef.reference.versionId}`
    if (outcome === 'approve-draft-creation') {
      await submitCalibrationGovernanceDraft(selector.projectId, { commandId, ...base })
    } else {
      await submitCalibrationReviewOutcome(selector.projectId, { commandId, ...base, outcome })
    }
    setTick((value) => value + 1)
  }

  const actions = calibration.state.kind === 'ready' ? calibration.state.value.actions : []
  const outcomeAvailability = actionAvailability(actions, 'warning-response.calibration-review-outcome')
  const draftAvailability = actionAvailability(actions, 'warning-response.calibration-governance-draft')

  return (
    <AppShell activeNav="warnings" agentContext={selector.projectId === null ? [] : [selector.projectId]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">校准建议</h1>
            <p className="page-subtitle">类型化变化摘要、校验结果与治理动作</p>
          </div>
        </header>

        <PageStateView
          state={calibration.state}
          title="校准详情"
          emptyMessage="该校准建议暂无登记事实"
          onRetry={calibration.retry}
        >
          {(value) => (
            <>
              <Card title="建议登记">
                <dl>
                  <FieldRow label="建议引用">
                    <VersionRefText reference={value.calibrationSuggestionRef.reference} />
                  </FieldRow>
                  <FieldRow label="目标类型">
                    <span className="mono">{value.targetKind}</span>
                  </FieldRow>
                  <FieldRow label="目标发布">
                    <VersionRefText reference={value.targetReleaseRef.reference} />
                  </FieldRow>
                  <FieldRow label="冻结输入">
                    <VersionRefText reference={value.inputSnapshotRef.reference} />
                  </FieldRow>
                  <FieldRow label="校验策略">
                    <VersionRefText reference={value.validationPolicyRef} />
                  </FieldRow>
                  <FieldRow label="状态">
                    <StatusTag tone={stateTone(value.status)}>{value.status}</StatusTag>
                  </FieldRow>
                  <FieldRow label="偏差记录">
                    <VersionRefText
                      reference={value.deviationRecordRef.reference}
                    />
                    <span className="ar-note"> · 版本 {value.deviationRecordVersionId}</span>
                  </FieldRow>
                  {value.reviewTaskRef !== undefined && (
                    <FieldRow label="复核任务">
                      <VersionRefText reference={value.reviewTaskRef.reference} />
                    </FieldRow>
                  )}
                  {value.reviewDecisionRef !== undefined && (
                    <FieldRow label="复核决定">
                      <VersionRefText reference={value.reviewDecisionRef.reference} />
                    </FieldRow>
                  )}
                  {value.candidateArtifactRef !== undefined && (
                    <FieldRow label="候选工件">
                      <VersionRefText reference={value.candidateArtifactRef.reference} />
                    </FieldRow>
                  )}
                  {value.knowledgeRevisionRef !== undefined && (
                    <FieldRow label="知识修订">
                      <VersionRefText reference={value.knowledgeRevisionRef.reference} />
                      <span className="ar-note"> · 未发布草案，发布由知识治理负责</span>
                    </FieldRow>
                  )}
                </dl>
              </Card>

              <Card title="类型化变化摘要" style={{ marginTop: 16 }}>
                {value.operations.length === 0 ? (
                  <p className="ar-note">暂无变化摘要。</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>操作</th>
                        <th>校验</th>
                        <th>原因码</th>
                      </tr>
                    </thead>
                    <tbody>
                      {value.operations.map((operation, index) => (
                        <tr key={index}>
                          <td>
                            <pre className="ar-record-body">
                              {JSON.stringify(operation.operation, null, 2)}
                            </pre>
                          </td>
                          <td>
                            <StatusTag tone={operation.valid ? 'success' : 'failed'}>
                              {operation.valid ? '通过' : '未通过'}
                            </StatusTag>
                          </td>
                          <td className="mono">{operation.reasonCode ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="ar-note">
                  摘要只用于呈现，完整重建入口是候选工件引用；摘要不能作为写命令载荷。
                </p>
              </Card>

              <div className="ar-two-col" style={{ marginTop: 16 }}>
                <FieldCard title="记录拒绝 / 退回">
                  <p className="ar-note">
                    两条收口分支各走各自的公共命令。收口成功输出偏差记录引用与版本；
                    不创建后继候选。
                  </p>
                  <ConfirmButton
                    label="记录拒绝"
                    tone="danger"
                    availability={
                      outcomeAvailability === 'allowed' && value.reviewDecisionRef !== undefined
                        ? 'allowed'
                        : 'business-unavailable'
                    }
                    unavailableReason={
                      outcomeAvailability !== 'allowed'
                        ? '当前角色无校准收口权限'
                        : '尚未形成复核决定引用'
                    }
                    summary={[
                      `工程：${selector.projectId ?? '—'}`,
                      `建议：${value.calibrationSuggestionRef.reference.entityId}`,
                      `复核决定：${value.reviewDecisionRef?.reference.entityId ?? '—'}`,
                      '预计结果：收口为 rejected 并登记偏差记录版本',
                    ]}
                    onConfirm={() => submit('reject')}
                  />
                  <ConfirmButton
                    label="记录退回"
                    availability={
                      outcomeAvailability === 'allowed' && value.reviewDecisionRef !== undefined
                        ? 'allowed'
                        : 'business-unavailable'
                    }
                    unavailableReason={
                      outcomeAvailability !== 'allowed'
                        ? '当前角色无校准收口权限'
                        : '尚未形成复核决定引用'
                    }
                    summary={[
                      `工程：${selector.projectId ?? '—'}`,
                      `建议：${value.calibrationSuggestionRef.reference.entityId}`,
                      `复核决定：${value.reviewDecisionRef?.reference.entityId ?? '—'}`,
                      '预计结果：收口为 returned 并登记偏差记录版本；不发布任何知识',
                    ]}
                    onConfirm={() => submit('return-for-revision')}
                  />
                </FieldCard>

                <FieldCard title="创建治理草案">
                  <p className="ar-note">
                    批准只生成未发布修订：草案、知识修订与候选工件按精确引用登记，
                    发布仍由既有知识治理负责。
                  </p>
                  <ConfirmButton
                    label="创建治理草案"
                    availability={
                      draftAvailability === 'allowed' && value.reviewDecisionRef !== undefined
                        ? 'allowed'
                        : 'business-unavailable'
                    }
                    unavailableReason={
                      draftAvailability !== 'allowed'
                        ? '当前角色无创建草案的权限'
                        : '尚未形成复核决定引用'
                    }
                    summary={[
                      `工程：${selector.projectId ?? '—'}`,
                      `建议：${value.calibrationSuggestionRef.reference.entityId}`,
                      `复核决定：${value.reviewDecisionRef?.reference.entityId ?? '—'}`,
                      '预计结果：创建未发布草案修订；页面不显示为已发布知识',
                    ]}
                    onConfirm={() => submit('approve-draft-creation')}
                  />
                </FieldCard>
              </div>
            </>
          )}
        </PageStateView>
      </div>
    </AppShell>
  )
}
