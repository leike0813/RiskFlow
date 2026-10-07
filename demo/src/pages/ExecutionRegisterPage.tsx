import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
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
 * 每种被引用实体都分「标识 + 版本」两个输入，页面不拿标识冒充版本、也不猜最新版本。
 * 采纳来源取所选任务下已成立的正式建议；独立行动按已发布措施登记，两类都不生成建议或预测。
 * 执行登记成功后就地把真实精确执行引用写回地址，反馈区因此读到权威版本而不是 ID 代填。
 * 反馈成立后进入反馈详情；偏差由领域侧按冻结策略计算，页面不提交 P/C 或偏差数值。
 */

interface ExecutionFormState {
  mode: 'adopted-recommendation' | 'independent-action'
  recommendationId: string
  recommendationVersion: string
  executedAt: string
  evidenceSegment: string
  evidenceSourceId: string
  evidenceSourceVersion: string
  measureRefs: { id: string; version: string }[]
}

interface FeedbackFormState {
  feedbackArtifactId: string
  feedbackArtifactVersion: string
  postActionSnapshotId: string
  postActionSnapshotVersion: string
  actualAssessmentId: string
  actualAssessmentVersion: string
  feedbackAt: string
}

const emptyExecutionForm = (): ExecutionFormState => ({
  mode: 'adopted-recommendation',
  recommendationId: '',
  recommendationVersion: '',
  executedAt: '',
  evidenceSegment: '',
  evidenceSourceId: '',
  evidenceSourceVersion: '',
  measureRefs: [{ id: '', version: '' }],
})

const emptyFeedbackForm = (): FeedbackFormState => ({
  feedbackArtifactId: '',
  feedbackArtifactVersion: '',
  postActionSnapshotId: '',
  postActionSnapshotVersion: '',
  actualAssessmentId: '',
  actualAssessmentVersion: '',
  feedbackAt: '',
})

/** 每个完整输入对应一个稳定命令身份：同载荷重试复用同一 UUID，改任一输入即新身份。 */
const useStableCommandId = () => {
  const ids = useRef(new Map<string, { key: string; id: string }>())
  return (prefix: string, input: unknown): string => {
    const key = `${prefix}:${JSON.stringify(input)}`
    const existing = ids.current.get(prefix)
    if (existing?.key === key) return existing.id
    const id = `${prefix}-${crypto.randomUUID()}`
    ids.current.set(prefix, { key, id })
    return id
  }
}

export default function ExecutionRegisterPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { selector } = useEngineering()
  const projectPath = useProjectPath()
  const stableCommandId = useStableCommandId()
  const taskId = searchParams.get('task') ?? ''
  const taskVersion = searchParams.get('taskVersion') ?? ''
  const executionId = searchParams.get('execution') ?? ''
  const executionVersion = searchParams.get('version') ?? ''
  const contextKey = JSON.stringify([selector.projectId, selector.revisionId, selector.assessmentSources,
    taskId, taskVersion, executionId, executionVersion])
  const currentContext = useRef(contextKey)
  currentContext.current = contextKey

  const [execForm, setExecForm] = useState<ExecutionFormState>(emptyExecutionForm)
  const [feedbackForm, setFeedbackForm] = useState<FeedbackFormState>(emptyFeedbackForm)
  const [feedbackCursor, setFeedbackCursor] = useState<string | undefined>(undefined)
  const [tick, setTick] = useState(0)

  // 工程上下文切换时清空仍在编辑的录入状态：新工程不得继承旧工程的表单与失败残留。
  useEffect(() => {
    setExecForm(emptyExecutionForm())
    setFeedbackForm(emptyFeedbackForm())
    setFeedbackCursor(undefined)
  }, [contextKey])

  const task = usePageQuery<WarningTaskView>(
    (projectId, signal) =>
      taskId === ''
        ? Promise.reject(new Error('no-task'))
        : readWarningTask(
            projectId,
            {
              kind: 'warning-response-task',
              reference: { entityId: taskId, versionId: taskVersion },
            },
            {},
            signal,
          ),
    [taskId, taskVersion],
  )

  const taskRecommendationRef: KindRef | null =
    task.state.kind === 'ready' ? (task.state.value.relations.recommendationRefs[0] ?? null) : null

  // 任务读回后把权威建议引用填入两个输入：来源仍是精确引用，不拿标识冒充版本。
  useEffect(() => {
    if (taskRecommendationRef === null) return
    setExecForm((form) =>
      form.recommendationId !== '' || form.recommendationVersion !== ''
        ? form
        : {
            ...form,
            recommendationId: taskRecommendationRef.reference.entityId,
            recommendationVersion: taskRecommendationRef.reference.versionId,
          },
    )
  }, [taskRecommendationRef?.reference.entityId, taskRecommendationRef?.reference.versionId])

  const executionRef: KindRef | null =
    executionId === '' || executionVersion === ''
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

  const actorId = task.state.kind === 'ready' ? task.state.value.actorId : ''
  const executionAvailability =
    task.state.kind === 'ready'
      ? actionAvailability(task.state.value.actions, 'warning-response.record-execution')
      : null
  const feedbackAvailability =
    execution.state.kind === 'ready'
      ? actionAvailability(execution.state.value.actions, 'warning-response.record-feedback')
      : null

  const measureRefs = execForm.measureRefs.filter((ref) => ref.id !== '' && ref.version !== '')
  const executionInputComplete =
    execForm.executedAt !== '' &&
    execForm.evidenceSegment !== '' &&
    execForm.evidenceSourceId !== '' &&
    execForm.evidenceSourceVersion !== '' &&
    (execForm.mode === 'adopted-recommendation'
      ? execForm.recommendationId !== '' && execForm.recommendationVersion !== ''
      : measureRefs.length > 0 && measureRefs.length === execForm.measureRefs.length)
  const feedbackInputComplete =
    feedbackForm.feedbackArtifactId !== '' &&
    feedbackForm.feedbackArtifactVersion !== '' &&
    feedbackForm.postActionSnapshotId !== '' &&
    feedbackForm.postActionSnapshotVersion !== '' &&
    feedbackForm.actualAssessmentId !== '' &&
    feedbackForm.actualAssessmentVersion !== '' &&
    feedbackForm.feedbackAt !== ''

  const registerExecution = async () => {
    if (selector.projectId === null || task.state.kind !== 'ready') return
    const submittedContext = contextKey
    const actionSource =
      execForm.mode === 'adopted-recommendation'
        ? ({
            kind: 'adopted-recommendation' as const,
            responseRecommendationRef: {
              kind: 'response-recommendation' as const,
              reference: {
                entityId: execForm.recommendationId,
                versionId: execForm.recommendationVersion,
              },
            },
          })
        : ({
            kind: 'independent-action' as const,
            measureReleaseRefs: measureRefs.map((ref) => ({
              kind: 'measure-library-release' as const,
              reference: { entityId: ref.id, versionId: ref.version },
            })),
          })
    const evidenceReferences = [
      {
        locator: { sourceSegmentId: execForm.evidenceSegment },
        sourceVersion: {
          entityId: execForm.evidenceSourceId,
          versionId: execForm.evidenceSourceVersion,
        },
      },
    ]
    const ref = await submitExecutionRecord(selector.projectId, {
      commandId: stableCommandId('demo-exec', {
        contextKey,
        actionSource,
        executor: actorId,
        occurredAt: execForm.executedAt,
        evidenceReferences,
      }),
      actionSource,
      executedByActorId: actorId,
      occurredAt: new Date(execForm.executedAt).toISOString(),
      evidenceReferences,
    })
    if (currentContext.current !== submittedContext) return
    // 真实精确执行引用写回地址：反馈区据此读取权威版本，而不是复用录入标识。
    const next = new URLSearchParams(searchParams)
    next.set('execution', ref.executionRecordRef.reference.entityId)
    next.set('version', ref.executionRecordRef.reference.versionId)
    setSearchParams(next)
    setTick((value) => value + 1)
  }

  const registerFeedback = async () => {
    if (selector.projectId === null || execution.state.kind !== 'ready') return
    const submittedContext = contextKey
    const executionRecordRef = execution.state.value.executionRecordRef
    const postActionMonitoringSnapshotRef = {
      kind: 'monitoring-snapshot' as const,
      reference: {
        entityId: feedbackForm.postActionSnapshotId,
        versionId: feedbackForm.postActionSnapshotVersion,
      },
    }
    const feedbackArtifactRef = {
      kind: 'content-artifact' as const,
      reference: {
        entityId: feedbackForm.feedbackArtifactId,
        versionId: feedbackForm.feedbackArtifactVersion,
      },
    }
    const actualAssessmentRecordRef = {
      kind: 'risk-assessment-record' as const,
      reference: {
        entityId: feedbackForm.actualAssessmentId,
        versionId: feedbackForm.actualAssessmentVersion,
      },
    }
    const result = await submitResponseFeedback(selector.projectId, {
      commandId: stableCommandId('demo-feedback', {
        contextKey,
        executionRecordRef,
        postActionMonitoringSnapshotRef,
        feedbackArtifactRef,
        actualAssessmentRecordRef,
        occurredAt: feedbackForm.feedbackAt,
      }),
      executionRecordRef,
      postActionMonitoringSnapshotRef,
      feedbackArtifactRef,
      occurredAt: new Date(feedbackForm.feedbackAt).toISOString(),
      actualAssessmentRecordRef,
    })
    if (currentContext.current !== submittedContext) return
    navigate(
      projectPath(
        `response/feedback/${result.feedbackRef.reference.entityId}?version=${result.feedbackRef.reference.versionId}`,
      ),
    )
  }

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
            采纳来源取所选任务下已成立的正式建议；独立行动按已发布措施登记。每个引用都分别填写
            标识与版本，页面不拿标识冒充版本，也不用建议替代执行记录。
          </p>
          <PageStateView
            state={task.state}
            title="任务与建议"
            emptyMessage="请从处置任务详情页进入，或在地址中给出任务标识与版本"
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
                    {taskRecommendationRef === null ? (
                      <span className="ar-note">该任务下暂无已成立的正式建议</span>
                    ) : (
                      <Link
                        className="mono"
                        to={projectPath(
                          `response/recommendations/${taskRecommendationRef.reference.entityId}?version=${taskRecommendationRef.reference.versionId}`,
                        )}
                      >
                        {taskRecommendationRef.reference.entityId}
                      </Link>
                    )}
                  </FieldRow>
                </dl>

                <div className="ar-two-col">
                  <FieldCard title="输入">
                    <label className="ar-form-field">
                      执行来源
                      <select
                        value={execForm.mode}
                        onChange={(event) =>
                          setExecForm((form) => ({
                            ...form,
                            mode: event.target.value as ExecutionFormState['mode'],
                          }))
                        }
                      >
                        <option value="adopted-recommendation">已采纳建议</option>
                        <option value="independent-action">独立行动（已发布措施）</option>
                      </select>
                    </label>
                    {execForm.mode === 'adopted-recommendation' ? (
                      <div className="ar-two-col">
                        <label className="ar-form-field">
                          建议标识
                          <input
                            type="text"
                            value={execForm.recommendationId}
                            onChange={(event) =>
                              setExecForm((form) => ({ ...form, recommendationId: event.target.value.trim() }))
                            }
                          />
                        </label>
                        <label className="ar-form-field">
                          建议版本
                          <input
                            type="text"
                            value={execForm.recommendationVersion}
                            onChange={(event) =>
                              setExecForm((form) => ({
                                ...form,
                                recommendationVersion: event.target.value.trim(),
                              }))
                            }
                          />
                        </label>
                      </div>
                    ) : (
                      <>
                        <p className="ar-note">措施发布引用（标识 + 版本），至少一项。</p>
                        {execForm.measureRefs.map((ref, index) => (
                          <div className="ar-two-col" key={index}>
                            <label className="ar-form-field">
                              措施发布标识
                              <input
                                type="text"
                                value={ref.id}
                                onChange={(event) =>
                                  setExecForm((form) => ({
                                    ...form,
                                    measureRefs: form.measureRefs.map((item, i) =>
                                      i === index ? { ...item, id: event.target.value.trim() } : item,
                                    ),
                                  }))
                                }
                              />
                            </label>
                            <label className="ar-form-field">
                              措施发布版本
                              <input
                                type="text"
                                value={ref.version}
                                onChange={(event) =>
                                  setExecForm((form) => ({
                                    ...form,
                                    measureRefs: form.measureRefs.map((item, i) =>
                                      i === index ? { ...item, version: event.target.value.trim() } : item,
                                    ),
                                  }))
                                }
                              />
                            </label>
                            {execForm.measureRefs.length > 1 && (
                              <button
                                type="button"
                                className="ar-chip"
                                onClick={() =>
                                  setExecForm((form) => ({
                                    ...form,
                                    measureRefs: form.measureRefs.filter((_, i) => i !== index),
                                  }))
                                }
                              >
                                移除
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          className="ar-chip"
                          onClick={() =>
                            setExecForm((form) => ({
                              ...form,
                              measureRefs: [...form.measureRefs, { id: '', version: '' }],
                            }))
                          }
                        >
                          添加措施发布
                        </button>
                      </>
                    )}
                    <label className="ar-form-field">
                      执行发生时间
                      <input
                        type="datetime-local"
                        value={execForm.executedAt}
                        onChange={(event) =>
                          setExecForm((form) => ({ ...form, executedAt: event.target.value }))
                        }
                      />
                    </label>
                    <label className="ar-form-field">
                      证据来源段标识
                      <input
                        type="text"
                        value={execForm.evidenceSegment}
                        onChange={(event) =>
                          setExecForm((form) => ({ ...form, evidenceSegment: event.target.value.trim() }))
                        }
                      />
                    </label>
                    <div className="ar-two-col">
                      <label className="ar-form-field">
                        证据来源版本标识
                        <input
                          type="text"
                          value={execForm.evidenceSourceId}
                          onChange={(event) =>
                            setExecForm((form) => ({
                              ...form,
                              evidenceSourceId: event.target.value.trim(),
                            }))
                          }
                        />
                      </label>
                      <label className="ar-form-field">
                        证据来源版本号
                        <input
                          type="text"
                          value={execForm.evidenceSourceVersion}
                          onChange={(event) =>
                            setExecForm((form) => ({
                              ...form,
                              evidenceSourceVersion: event.target.value.trim(),
                            }))
                          }
                        />
                      </label>
                    </div>
                    <p className="ar-note">
                      证据引用必须使用已登记的精确来源段与来源版本；本轮不引入文件上传或自由 URL。
                    </p>
                  </FieldCard>

                  <FieldCard title="登记">
                    <p className="ar-note">执行身份取当前已核实主体，不可自由编辑。</p>
                    <ConfirmButton
                      label="登记执行"
                      resetKey={contextKey + JSON.stringify(execForm)}
                      availability={
                        executionAvailability === 'allowed' && executionInputComplete
                          ? 'allowed'
                          : 'business-unavailable'
                      }
                      unavailableReason={
                        executionAvailability !== 'allowed'
                          ? '当前角色无登记执行的权限'
                          : execForm.mode === 'independent-action'
                            ? '措施发布引用、发生时间与证据来源均必填'
                            : '建议引用、发生时间与证据来源均必填'
                      }
                      summary={[
                        `工程：${selector.projectId ?? '—'}`,
                        execForm.mode === 'adopted-recommendation'
                          ? `来源建议：${execForm.recommendationId || '—'} · ${execForm.recommendationVersion || '—'}`
                          : `措施发布：${measureRefs.map((ref) => `${ref.id} · ${ref.version}`).join('；') || '—'}`,
                        `执行时间：${execForm.executedAt || '—'}`,
                        `证据来源段：${execForm.evidenceSegment || '—'} · ${execForm.evidenceSourceId || '—'} · ${execForm.evidenceSourceVersion || '—'}`,
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
            state={executionRef === null ? { kind: 'empty', message: '请选择一条已登记的执行记录' } : execution.state}
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
                    <div className="ar-two-col">
                      <label className="ar-form-field">
                        反馈工件标识
                        <input
                          type="text"
                          value={feedbackForm.feedbackArtifactId}
                          onChange={(event) =>
                            setFeedbackForm((form) => ({
                              ...form,
                              feedbackArtifactId: event.target.value.trim(),
                            }))
                          }
                        />
                      </label>
                      <label className="ar-form-field">
                        反馈工件版本
                        <input
                          type="text"
                          value={feedbackForm.feedbackArtifactVersion}
                          onChange={(event) =>
                            setFeedbackForm((form) => ({
                              ...form,
                              feedbackArtifactVersion: event.target.value.trim(),
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div className="ar-two-col">
                      <label className="ar-form-field">
                        处置后监测快照标识
                        <input
                          type="text"
                          value={feedbackForm.postActionSnapshotId}
                          onChange={(event) =>
                            setFeedbackForm((form) => ({
                              ...form,
                              postActionSnapshotId: event.target.value.trim(),
                            }))
                          }
                        />
                      </label>
                      <label className="ar-form-field">
                        处置后监测快照版本
                        <input
                          type="text"
                          value={feedbackForm.postActionSnapshotVersion}
                          onChange={(event) =>
                            setFeedbackForm((form) => ({
                              ...form,
                              postActionSnapshotVersion: event.target.value.trim(),
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div className="ar-two-col">
                      <label className="ar-form-field">
                        实际评估记录标识
                        <input
                          type="text"
                          value={feedbackForm.actualAssessmentId}
                          onChange={(event) =>
                            setFeedbackForm((form) => ({
                              ...form,
                              actualAssessmentId: event.target.value.trim(),
                            }))
                          }
                        />
                      </label>
                      <label className="ar-form-field">
                        实际评估记录版本
                        <input
                          type="text"
                          value={feedbackForm.actualAssessmentVersion}
                          onChange={(event) =>
                            setFeedbackForm((form) => ({
                              ...form,
                              actualAssessmentVersion: event.target.value.trim(),
                            }))
                          }
                        />
                      </label>
                    </div>
                    <label className="ar-form-field">
                      反馈发生时间
                      <input
                        type="datetime-local"
                        value={feedbackForm.feedbackAt}
                        onChange={(event) =>
                          setFeedbackForm((form) => ({ ...form, feedbackAt: event.target.value }))
                        }
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
                      反馈必须引用已成立的执行记录、已登记反馈工件、处置后监测快照与实际评估记录；
                      页面不提交 P/C，偏差由领域侧按冻结策略计算。
                    </p>
                    <ConfirmButton
                      label="登记反馈"
                      resetKey={contextKey + JSON.stringify(feedbackForm)}
                      availability={
                        feedbackAvailability === 'allowed' && feedbackInputComplete
                          ? 'allowed'
                          : 'business-unavailable'
                      }
                      unavailableReason={
                        feedbackAvailability !== 'allowed'
                          ? '当前角色无登记反馈的权限'
                          : '反馈工件、处置后监测快照、实际评估记录的标识与版本及发生时间均必填'
                      }
                      summary={[
                        `工程：${selector.projectId ?? '—'}`,
                        `执行记录：${value.executionRecordRef.reference.entityId} · ${value.executionRecordRef.reference.versionId}`,
                        `反馈工件：${feedbackForm.feedbackArtifactId || '—'} · ${feedbackForm.feedbackArtifactVersion || '—'}`,
                        `处置后监测快照：${feedbackForm.postActionSnapshotId || '—'} · ${feedbackForm.postActionSnapshotVersion || '—'}`,
                        `实际评估记录：${feedbackForm.actualAssessmentId || '—'} · ${feedbackForm.actualAssessmentVersion || '—'}`,
                        '预计结果：登记正式反馈事实并进入反馈详情；偏差按冻结偏差策略计算',
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
