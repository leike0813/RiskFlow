import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { ConfirmButton } from '../components/ConfirmButton'
import { PageStateView } from '../components/PageStateView'
import { useEngineering, usePageQuery, useProjectPath } from '../api/context'
import {
  actionAvailability,
  readAssessmentEntryContext,
  readAssessmentRecordCatalog,
  readEngineeringContext,
  readPendingRiskCatalog,
  submitStartAssessment,
  type EngineeringContextView,
  type EntryContextView,
  type KindRef,
  type PendingCatalogView,
  type RecordCatalogView,
  type WorkflowReassessmentReasonV1,
  WORKFLOW_REASSESSMENT_REASONS_V1,
} from '../api/operations'
import { FieldCard, FieldRow, NextPageButton, VersionRefText } from './assessmentResponseShared'
import './assessment-response.css'

/**
 * P-RA-02 启动评估向导（design D-02、D-04、D-07）。
 *
 * 全部引用来自精确读：工程修订与空间范围取工程上下文，风险输入取待评估目录的精确引用，
 * 适用性快照与外部风险事件取入口上下文的两个独立候选目录。页面不接受手工拼接的标识，
 * 也不在缺少精确版本时代填默认值。
 */
export default function StartAssessmentPage() {
  const { selector } = useEngineering()
  const navigate = useNavigate()
  const projectPath = useProjectPath()
  const [scopeEntityId, setScopeEntityId] = useState('')
  const [riskInput, setRiskInput] = useState<KindRef | null>(null)
  const [snapshot, setSnapshot] = useState<KindRef | null>(null)
  const [applicabilityCursor, setApplicabilityCursor] = useState<string | undefined>(undefined)
  const [externalEventCursor, setExternalEventCursor] = useState<string | undefined>(undefined)
  const [riskCursor, setRiskCursor] = useState<string | undefined>(undefined)
  const [entryMode, setEntryMode] = useState<'assess' | 'reassess'>('assess')
  const [previousRecord, setPreviousRecord] = useState<KindRef | null>(null)
  const [reason, setReason] = useState<WorkflowReassessmentReasonV1>('monitoring-snapshot')
  const [changedInputs, setChangedInputs] = useState('')

  const context = usePageQuery<EngineeringContextView>(
    (projectId, signal) => readEngineeringContext(projectId, signal),
    [],
  )
  const selectedScope =
    context.state.kind === 'ready'
      ? (context.state.value.spatialScopes.find(
          (scope) => scope.spatialScopeRef.reference.entityId === scopeEntityId,
        )?.spatialScopeRef ?? null)
      : null

  const revisionRef =
    context.state.kind === 'ready'
      ? (context.state.value.currentProjectRevisionRef ?? null)
      : null

  const entry = usePageQuery<EntryContextView>(
    (projectId, signal) =>
      readAssessmentEntryContext(
        projectId,
        {
          projectRevisionRef:
            revisionRef ?? { kind: 'project-revision', reference: { entityId: projectId, versionId: '' } },
          spatialScopeRef:
            selectedScope ?? { kind: 'spatial-scope', reference: { entityId: '', versionId: '' } },
          ...(applicabilityCursor === undefined ? {} : { applicabilityCursor }),
          ...(externalEventCursor === undefined ? {} : { externalEventCursor }),
        },
        signal,
      ),
    [
      revisionRef?.reference.entityId,
      revisionRef?.reference.versionId,
      selectedScope?.reference.entityId,
      selectedScope?.reference.versionId,
      applicabilityCursor,
      externalEventCursor,
    ],
  )

  const pending = usePageQuery<PendingCatalogView>(
    (projectId, signal) =>
      readPendingRiskCatalog(
        projectId,
        { riskInputKind: 'risk-record', ...(riskCursor === undefined ? {} : { cursor: riskCursor }) },
        signal,
      ),
    [riskCursor],
  )

  // 重评入口：前驱取自已入库评估记录的精确引用，页面不推断"上一次是哪一条"。
  const priorRecords = usePageQuery<RecordCatalogView>(
    (projectId, signal) => readAssessmentRecordCatalog(projectId, {}, signal),
    [],
  )

  const availability =
    entry.state.kind === 'ready' ? actionAvailability(entry.state.value.actions, 'workflow.start-run') : null
  const changedInputRefs = changedInputs
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((entityId) => ({ kind: 'monitoring-snapshot', reference: { entityId, versionId: entityId } }))
  const reassessComplete =
    entryMode === 'assess' ||
    (previousRecord !== null && changedInputRefs.length >= 1 && changedInputRefs.length <= 64)
  const missing =
    selectedScope === null ||
    revisionRef === null ||
    riskInput === null ||
    snapshot === null ||
    !reassessComplete
  const runnable =
    availability === 'allowed' &&
    !missing &&
    entry.state.kind === 'ready' &&
    entry.state.value.runPolicy.kind === 'available'

  const start = async () => {
    const projectId = selector.projectId
    if (projectId === null || selectedScope === null || revisionRef === null) return
    if (riskInput === null || snapshot === null) return
    if (entry.state.kind !== 'ready' || entry.state.value.runPolicy.kind !== 'available') return
    const started = await submitStartAssessment(projectId, {
      // 幂等键由本次选中的精确引用决定：同一选择重试复用同一键，任一引用变化即换新身份。
      commandId: [
        'demo-assess',
        entryMode,
        projectId,
        selectedScope.reference.entityId,
        selectedScope.reference.versionId,
        riskInput.reference.entityId,
        riskInput.reference.versionId,
        snapshot.reference.entityId,
        snapshot.reference.versionId,
        previousRecord?.reference.entityId ?? '',
        entryMode === 'reassess' ? reason : '',
        ...(entryMode === 'reassess'
          ? changedInputRefs.map((ref) => ref.reference.entityId)
          : []),
      ].join('-'),
      graphVersion: entry.state.value.runPolicy.graphVersion,
      retryPolicyRef: entry.state.value.runPolicy.retryPolicyRef,
      riskInput,
      spatialScopeRef: selectedScope,
      projectRevisionRef: revisionRef,
      applicabilityMetadataSnapshotRef: snapshot,
      ...(entryMode === 'reassess' && previousRecord !== null
        ? { previousAssessmentRecordRef: previousRecord, reason, changedInputRefs }
        : {}),
    })
    navigate(
      projectPath(
        `assessment/runs/${started.workflowRunRef.reference.entityId}?version=${started.workflowRunRef.reference.versionId}`,
      ),
    )
  }

  return (
    <AppShell activeNav="assessment" agentContext={selector.projectId === null ? [] : [selector.projectId]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">启动评估</h1>
            <p className="page-subtitle">以冻结的评估准备快照提交一次有限评估运行</p>
          </div>
        </header>

        <Card title="入口上下文" style={{ marginBottom: 16 }}>
          <PageStateView state={context.state} title="空间范围" emptyMessage="工程暂无已登记空间范围">
            {(value) => (
              <dl>
                <FieldRow label="工程修订">
                  {revisionRef === null ? (
                    <span className="ar-note">工程尚未登记当前修订，无法构造入口</span>
                  ) : (
                    <VersionRefText reference={revisionRef.reference} />
                  )}
                </FieldRow>
                <FieldRow label="空间范围">
                  <select
                    value={scopeEntityId}
                    onChange={(event) => {
                      setScopeEntityId(event.target.value)
                      setSnapshot(null)
                      setApplicabilityCursor(undefined)
                      setExternalEventCursor(undefined)
                    }}
                  >
                    <option value="">请选择空间</option>
                    {value.spatialScopes.map((scope) => (
                      <option
                        key={scope.spatialScopeRef.reference.entityId}
                        value={scope.spatialScopeRef.reference.entityId}
                      >
                        {scope.name}
                      </option>
                    ))}
                  </select>
                </FieldRow>
              </dl>
            )}
          </PageStateView>
        </Card>

        {selectedScope === null ? (
          <Card title="候选选择">
            <p className="ar-note">请先选择空间范围，候选目录按该空间的有界读取给出。</p>
          </Card>
        ) : (
          <>
            <PageStateView
              state={entry.state}
              title="候选选择"
              emptyMessage="该空间下暂无适用的候选"
              onRetry={entry.retry}
            >
              {(value) => (
                <div className="ar-two-col">
                  <FieldCard title="适用性元数据快照">
                    {value.applicabilityItems.length === 0 ? (
                      <p className="ar-note">该空间下暂无已登记的适用性快照。</p>
                    ) : (
                      <ul className="ar-ref-list">
                        {value.applicabilityItems.map((item) => (
                          <li key={item.snapshotRef.reference.entityId}>
                            <button
                              type="button"
                              className={`ar-chip${
                                snapshot?.reference.entityId === item.snapshotRef.reference.entityId
                                  ? ' ar-chip--active'
                                  : ''
                              }`}
                              onClick={() => setSnapshot(item.snapshotRef)}
                            >
                              {item.snapshotRef.reference.entityId}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <NextPageButton
                      nextCursor={value.applicabilityNextCursor}
                      onContinue={setApplicabilityCursor}
                      label="续页（适用性）"
                    />
                  </FieldCard>

                  <FieldCard title="外部风险事件">
                    {value.externalEventItems.length === 0 ? (
                      <p className="ar-note">该空间下暂无已登记的外部风险事件。</p>
                    ) : (
                      <ul className="ar-ref-list">
                        {value.externalEventItems.map((item) => (
                          <li key={item.riskInput.reference.entityId}>
                            <button
                              type="button"
                              className={`ar-chip${
                                riskInput?.reference.entityId === item.riskInput.reference.entityId
                                  ? ' ar-chip--active'
                                  : ''
                              }`}
                              onClick={() => setRiskInput(item.riskInput)}
                            >
                              {item.riskInput.reference.entityId}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <NextPageButton
                      nextCursor={value.externalEventNextCursor}
                      onContinue={setExternalEventCursor}
                      label="续页（外部事件）"
                    />
                  </FieldCard>

                  <FieldCard title="运行策略">
                    {value.runPolicy.kind === 'available' ? (
                      <dl>
                        <FieldRow label="图版本">
                          <VersionRefText reference={value.runPolicy.graphVersion} />
                        </FieldRow>
                        <FieldRow label="重试策略">
                          <VersionRefText reference={value.runPolicy.retryPolicyRef} />
                        </FieldRow>
                      </dl>
                    ) : (
                      <p className="ar-note">
                        部署未注入合格的运行策略（{value.runPolicy.reasonCode}），当前不能启动运行。
                      </p>
                    )}
                  </FieldCard>
                </div>
              )}
            </PageStateView>

            <Card title="风险输入（标准化风险记录）" style={{ marginTop: 16 }}>
              <PageStateView
                state={pending.state}
                title="待评估风险输入"
                emptyMessage="当前工程暂无待评估的风险输入"
                onRetry={pending.retry}
              >
                {(page) => (
                  <>
                    <ul className="ar-ref-list">
                      {page.items.map((item) => (
                        <li key={item.riskInput.reference.entityId}>
                          <button
                            type="button"
                            className={`ar-chip${
                              riskInput?.reference.entityId === item.riskInput.reference.entityId
                                ? ' ar-chip--active'
                                : ''
                            }`}
                            onClick={() => setRiskInput(item.riskInput)}
                          >
                            {item.riskInput.reference.entityId}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <NextPageButton nextCursor={page.nextCursor} onContinue={setRiskCursor} label="续页（风险输入）" />
                  </>
                )}
              </PageStateView>
            </Card>

            <Card title="入口模式" style={{ marginTop: 16 }}>
              <div className="wc-filter" role="group" aria-label="入口模式">
                <span className="wc-filter-label">入口</span>
                {(
                  [
                    ['assess', '初评'],
                    ['reassess', '重评'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`wc-chip${entryMode === value ? ' wc-chip--active' : ''}`}
                    onClick={() => setEntryMode(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {entryMode === 'reassess' && (
                <>
                  <label className="ar-form-field">
                    前驱评估记录
                    <select
                      value={previousRecord?.reference.entityId ?? ''}
                      onChange={(event) => {
                        const found = priorRecords.state.kind === 'ready'
                          ? priorRecords.state.value.items.find(
                              (item) =>
                                item.assessmentRecordRef.reference.entityId === event.target.value,
                            )?.assessmentRecordRef
                          : undefined
                        setPreviousRecord(found ?? null)
                      }}
                    >
                      <option value="">请选择前驱评估记录</option>
                    {(priorRecords.state.kind === 'ready' ? priorRecords.state.value.items : []).map(
                      (item) => (
                        <option
                          key={item.assessmentRecordRef.reference.entityId}
                          value={item.assessmentRecordRef.reference.entityId}
                        >
                          {item.assessmentRecordRef.reference.entityId}（{item.entryMode}）
                        </option>
                      ),
                    )}
                    </select>
                  </label>
                  <label className="ar-form-field">
                    重评原因
                    <select
                      value={reason}
                      onChange={(event) =>
                        setReason(event.target.value as WorkflowReassessmentReasonV1)
                      }
                    >
                      {WORKFLOW_REASSESSMENT_REASONS_V1.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ar-form-field">
                    变化引用（每行一个精确标识，1～64 项）
                    <textarea
                      rows={3}
                      value={changedInputs}
                      onChange={(event) => setChangedInputs(event.target.value)}
                    />
                  </label>
                  <p className="ar-note">
                    前驱、原因与变化集合都是重评入口身份的一部分：同一组合重复提交复用同一运行，
                    任一项变化即换新身份。页面不替你推断"改了什么"。
                  </p>
                </>
              )}
            </Card>

            <Card title="提交" style={{ marginTop: 16 }}>
              {availability !== null && availability !== 'allowed' && (
                <p className="ar-note">当前不可启动运行（{availability}）。</p>
              )}
              <ConfirmButton
                label="启动评估"
                availability={availability === 'allowed' && runnable ? 'allowed' : 'business-unavailable'}
                unavailableReason={
                  missing
                    ? entryMode === 'reassess'
                      ? '缺少工程修订、空间范围、风险输入、适用性快照、前驱记录或 1～64 项变化引用'
                      : '缺少工程修订、空间范围、风险输入或适用性快照'
                    : entry.state.kind === 'ready' && entry.state.value.runPolicy.kind !== 'available'
                      ? '部署未注入合格的运行策略'
                      : '当前角色无启动评估的权限'
                }
                summary={[
                  `工程：${selector.projectId ?? '—'}`,
                  `工程修订：${revisionRef?.reference.entityId ?? '—'} · ${revisionRef?.reference.versionId ?? '—'}`,
                  `空间范围：${selectedScope.reference.entityId} · ${selectedScope.reference.versionId}`,
                  `风险输入：${riskInput?.reference.entityId ?? '—'} · ${riskInput?.reference.versionId ?? '—'}`,
                  `适用性快照：${snapshot?.reference.entityId ?? '—'} · ${snapshot?.reference.versionId ?? '—'}`,
                  entryMode === 'reassess'
                    ? `入口模式：重评（reassess）· 原因 ${reason}`
                    : '入口模式：初评（assess）',
                  ...(entryMode === 'reassess'
                    ? [
                        `前驱评估记录：${previousRecord?.reference.entityId ?? '—'}`,
                        `变化引用（${changedInputRefs.length} 项）：${
                          changedInputRefs.map((ref) => ref.reference.entityId).join('、') || '—'
                        }`,
                      ]
                    : []),
                  '预计结果：登记一次有限评估运行；评估依据在运行内冻结',
                ]}
                onConfirm={start}
              />
            </Card>
          </>
        )}
      </div>
    </AppShell>
  )
}
