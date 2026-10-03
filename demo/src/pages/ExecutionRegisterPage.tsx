import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { ConfirmButton } from '../components/ConfirmButton'
import { PageStateView } from '../components/PageStateView'
import { useEngineering, usePageQuery, useProjectPath } from '../api/context'
import {
  actionAvailability,
  readExecutionRecord,
  readWarningTask,
  submitExecutionRecord,
  submitResponseFeedback,
  type ExecutionView,
  type KindRef,
  type WarningTaskView,
} from '../api/operations'
import { FieldCard, FieldRow, VersionRefText } from './assessmentResponseShared'
import './assessment-response.css'

/**
 * P-RS-02 执行登记与反馈（design D-02、D-07）。
 *
 * 两段是两个独立的人工动作：登记执行只提交来源、执行时间与证据引用；登记反馈必须引用
 * 已成立的执行记录、反馈工件与实际评估记录，页面不提交 P/C 或偏差数值，也不从反馈表单
 * 反推偏差。采纳路径的建议不是执行记录，页面不会用它替代执行登记。
 */
export default function ExecutionRegisterPage() {
  const [searchParams] = useSearchParams()
  const { selector } = useEngineering()
  const projectPath = useProjectPath()
  const taskId = searchParams.get('task') ?? ''
  const executionId = searchParams.get('execution') ?? ''
  const executionVersion = searchParams.get('version') ?? ''

  const [executedAt, setExecutedAt] = useState('')
  const [evidenceSegment, setEvidenceSegment] = useState('')
  const [evidenceSourceVersion, setEvidenceSourceVersion] = useState('')
  const [feedbackArtifact, setFeedbackArtifact] = useState('')
  const [postActionSnapshot, setPostActionSnapshot] = useState('')
  const [actualAssessmentRecord, setActualAssessmentRecord] = useState('')
  const [feedbackAt, setFeedbackAt] = useState('')
  const [feedbackCursor, setFeedbackCursor] = useState<string | undefined>(undefined)
  const [tick, setTick] = useState(0)

  const task = usePageQuery<WarningTaskView>(
    (projectId, signal) =>
      taskId === ''
        ? Promise.reject(new Error('no-task'))
        : readWarningTask(
            projectId,
            { kind: 'warning-response-task', reference: { entityId: taskId, versionId: taskId } },
            {},
            signal,
          ),
    [taskId],
  )

  const recommendationRef: KindRef | null =
    task.state.kind === 'ready' ? (task.state.value.relations.recommendationRefs[0] ?? null) : null

  const executionRef: KindRef | null =
    executionId === ''
      ? null
      : { kind: 'execution-record', reference: { entityId: executionId, versionId: executionVersion } }

  const execution = usePageQuery<ExecutionView>(
    (projectId, signal) =>
      executionRef === null
        ? Promise.reject(new Error('no-execution'))
        : readExecutionRecord(
            projectId,
            executionRef,
            feedbackCursor === undefined ? {} : { feedbackCursor },
            signal,
          ),
    [executionId, executionVersion, feedbackCursor, tick],
  )

  const registerExecution = async () => {
    if (selector.projectId === null || recommendationRef === null) return
    await submitExecutionRecord(selector.projectId, {
      commandId: `demo-exec-${selector.projectId}-${recommendationRef.reference.entityId}-${executedAt}-${evidenceSegment}`,
      actionSource: {
        kind: 'adopted-recommendation',
        responseRecommendationRef: recommendationRef,
      },
      executedByActorId: task.state.kind === 'ready' ? task.state.value.actorId : '',
      occurredAt: new Date(executedAt).toISOString(),
      evidenceReferences: [
        {
          locator: { sourceSegmentId: evidenceSegment },
          sourceVersion: { entityId: evidenceSourceVersion, versionId: evidenceSourceVersion },
        },
      ],
    })
    setTick((value) => value + 1)
  }

  const registerFeedback = async () => {
    if (selector.projectId === null || execution.state.kind !== 'ready') return
    await submitResponseFeedback(selector.projectId, {
      commandId: `demo-feedback-${selector.projectId}-${executionId}-${feedbackAt}-${postActionSnapshot}`,
      executionRecordRef: execution.state.value.executionRecordRef,
      postActionMonitoringSnapshotRef: {
        kind: 'monitoring-snapshot',
        reference: { entityId: postActionSnapshot, versionId: postActionSnapshot },
      },
      feedbackArtifactRef: {
        kind: 'content-artifact',
        reference: { entityId: feedbackArtifact, versionId: feedbackArtifact },
      },
      occurredAt: new Date(feedbackAt).toISOString(),
      actualAssessmentRecordRef: {
        kind: 'risk-assessment-record',
        reference: { entityId: actualAssessmentRecord, versionId: actualAssessmentRecord },
      },
    })
    setTick((value) => value + 1)
  }

  const executionAvailability =
    task.state.kind === 'ready'
      ? actionAvailability(task.state.value.actions, 'warning-response.record-execution')
      : null
  const feedbackAvailability =
    execution.state.kind === 'ready'
      ? actionAvailability(execution.state.value.actions, 'warning-response.record-feedback')
      : null

  return (
    <AppShell activeNav="warnings" agentContext={selector.projectId === null ? [] : [selector.projectId]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">执行登记</h1>
            <p className="page-subtitle">登记处置执行事实与正式反馈</p>
          </div>
        </header>

        <Card title="登记执行">
          <p className="ar-note">
            执行来源取所选任务下已成立的正式建议。采纳路径的建议本身不是执行记录，
            页面不会用它替代执行登记；独立行动路径另由领域侧按措施发布登记。
          </p>
          <PageStateView
            state={task.state}
            title="任务与建议"
            emptyMessage="请从处置任务详情页进入，或在地址中给出任务标识"
            onRetry={task.retry}
          >
            {(value) => (
              <>
                <dl>
                  <FieldRow label="处置任务">
                    <VersionRefText reference={value.taskRef.reference} />
                  </FieldRow>
                  <FieldRow label="当前任务主体">
                    <span className="mono">{value.actorId}</span>
                  </FieldRow>
                  <FieldRow label="正式建议">
                    {recommendationRef === null ? (
                      <span className="ar-note">该任务下暂无已成立的正式建议</span>
                    ) : (
                      <Link
                        className="mono"
                        to={projectPath(
                          `response/recommendations/${recommendationRef.reference.entityId}?version=${recommendationRef.reference.versionId}`,
                        )}
                      >
                        {recommendationRef.reference.entityId}
                      </Link>
                    )}
                  </FieldRow>
                </dl>

                <div className="ar-two-col">
                  <FieldCard title="输入">
                    <label className="ar-form-field">
                      执行发生时间
                      <input
                        type="datetime-local"
                        value={executedAt}
                        onChange={(event) => setExecutedAt(event.target.value)}
                      />
                    </label>
                    <label className="ar-form-field">
                      证据来源段标识
                      <input
                        type="text"
                        value={evidenceSegment}
                        onChange={(event) => setEvidenceSegment(event.target.value.trim())}
                      />
                    </label>
                    <label className="ar-form-field">
                      证据来源版本标识
                      <input
                        type="text"
                        value={evidenceSourceVersion}
                        onChange={(event) => setEvidenceSourceVersion(event.target.value.trim())}
                      />
                    </label>
                    <p className="ar-note">
                      证据引用必须使用已登记的精确来源段与来源版本；本轮不引入文件上传或自由 URL。
                    </p>
                  </FieldCard>

                  <FieldCard title="登记">
                    <p className="ar-note">
                      执行身份取当前已核实主体，不可自由编辑。
                    </p>
                    <ConfirmButton
                      label="登记执行"
                      availability={
                        executionAvailability === 'allowed' &&
                        recommendationRef !== null &&
                        executedAt !== '' &&
                        evidenceSegment !== '' &&
                        evidenceSourceVersion !== ''
                          ? 'allowed'
                          : 'business-unavailable'
                      }
                      unavailableReason={
                        executionAvailability !== 'allowed'
                          ? '当前角色无登记执行的权限'
                          : recommendationRef === null
                            ? '该任务下暂无已成立的正式建议'
                            : '发生时间与证据来源段、来源版本均必填'
                      }
                      summary={[
                        `工程：${selector.projectId ?? '—'}`,
                        `来源建议：${recommendationRef?.reference.entityId ?? '—'}`,
                        `执行时间：${executedAt || '—'}`,
                        `证据来源段：${evidenceSegment || '—'} · ${evidenceSourceVersion || '—'}`,
                        '执行身份：当前已核实主体，不可自由编辑',
                      ]}
                      onConfirm={registerExecution}
                    />
                  </FieldCard>
                </div>
              </>
            )}
          </PageStateView>
        </Card>

        <Card title="执行记录与反馈" style={{ marginTop: 16 }}>
          <PageStateView
            state={executionId === '' ? { kind: 'empty', message: '请选择一条已登记的执行记录' } : execution.state}
            title="执行记录"
            emptyMessage="该执行记录暂无登记事实"
            onRetry={execution.retry}
          >
            {(value) => (
              <>
                <dl>
                  <FieldRow label="执行引用">
                    <VersionRefText reference={value.executionRecordRef.reference} />
                  </FieldRow>
                  <FieldRow label="来源">
                    {value.source.sourceKind === 'adopted-recommendation' ? (
                      <VersionRefText reference={value.source.recommendationRef.reference} />
                    ) : (
                      <ul className="ar-ref-list">
                        {value.source.measureReleaseRefs.map((ref) => (
                          <li key={ref.reference.entityId}>
                            <VersionRefText reference={ref.reference} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </FieldRow>
                  <FieldRow label="执行 / 登记主体">
                    <span className="mono">
                      {value.executedByActorId} / {value.recordedByActorId}
                    </span>
                  </FieldRow>
                  <FieldRow label="发生时间">
                    <span className="mono">{value.occurredAt}</span>
                  </FieldRow>
                  <FieldRow label="证据引用">
                    <ul className="ar-ref-list">
                      {value.evidenceReferences.map((reference) => (
                        <li key={reference.sourceSegmentId} className="mono">
                          {reference.sourceSegmentId} · {reference.sourceVersionRef.versionId}
                        </li>
                      ))}
                    </ul>
                  </FieldRow>
                </dl>

                <div className="ar-two-col" style={{ marginTop: 14 }}>
                  <FieldCard title="登记反馈输入">
                    <label className="ar-form-field">
                      反馈工件标识
                      <input
                        type="text"
                        value={feedbackArtifact}
                        onChange={(event) => setFeedbackArtifact(event.target.value.trim())}
                      />
                    </label>
                    <label className="ar-form-field">
                      处置后监测快照标识
                      <input
                        type="text"
                        value={postActionSnapshot}
                        onChange={(event) => setPostActionSnapshot(event.target.value.trim())}
                      />
                    </label>
                    <label className="ar-form-field">
                      实际评估记录标识
                      <input
                        type="text"
                        value={actualAssessmentRecord}
                        onChange={(event) => setActualAssessmentRecord(event.target.value.trim())}
                      />
                    </label>
                    <label className="ar-form-field">
                      反馈发生时间
                      <input
                        type="datetime-local"
                        value={feedbackAt}
                        onChange={(event) => setFeedbackAt(event.target.value)}
                      />
                    </label>
                  </FieldCard>

                  <FieldCard title="已登记反馈">
                    {value.feedbackRefs.length === 0 ? (
                      <p className="ar-note">该执行记录下暂无已登记反馈。</p>
                    ) : (
                      <ul className="ar-ref-list">
                        {value.feedbackRefs.map((ref) => (
                          <li key={ref.reference.entityId}>
                            <Link
                              className="mono"
                              to={projectPath(
                                `response/feedback/${ref.reference.entityId}?version=${ref.reference.versionId}`,
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
                          onClick={() => setFeedbackCursor(value.nextCursor)}
                        >
                          续页（反馈）
                        </button>
                      </div>
                    )}
                    <p className="ar-note">
                      反馈必须引用已成立的执行记录与实际评估记录；页面不提交 P/C，偏差由领域侧按冻结策略计算。
                    </p>
                    <ConfirmButton
                      label="登记反馈"
                      availability={
                        feedbackAvailability === 'allowed' &&
                        feedbackArtifact !== '' &&
                        postActionSnapshot !== '' &&
                        actualAssessmentRecord !== '' &&
                        feedbackAt !== ''
                          ? 'allowed'
                          : 'business-unavailable'
                      }
                      unavailableReason={
                        feedbackAvailability !== 'allowed'
                          ? '当前角色无登记反馈的权限'
                          : '反馈工件、处置后监测快照、实际评估记录与发生时间均必填'
                      }
                      summary={[
                        `工程：${selector.projectId ?? '—'}`,
                        `执行记录：${value.executionRecordRef.reference.entityId}`,
                        `反馈工件：${feedbackArtifact || '—'}`,
                        `处置后监测快照：${postActionSnapshot || '—'}`,
                        `实际评估记录：${actualAssessmentRecord || '—'}`,
                        '预计结果：登记正式反馈事实；偏差按冻结偏差策略计算',
                      ]}
                      onConfirm={registerFeedback}
                    />
                  </FieldCard>
                </div>
              </>
            )}
          </PageStateView>
        </Card>
      </div>
    </AppShell>
  )
}
