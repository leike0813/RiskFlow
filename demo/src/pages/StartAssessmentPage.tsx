import { useEffect, useRef, useState } from 'react'
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
 * 精确引用 JSON 数组输入：`[{"kind":"…","reference":{"entityId":"…","versionId":"…"}}]`。
 * 每项都必须显式给出 kind 与完整版本；缺任一项整段不可用。页面不代填版本，也不把同一自由输入
 * 标识同时充当实体与版本（design D-07）。
 */
const parseRefArray = (text: string): { readonly refs: KindRef[]; readonly error: string | null } => {
  const trimmed = text.trim()
  if (trimmed === '') return { refs: [], error: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { refs: [], error: 'JSON 解析失败' }
  }
  if (!Array.isArray(parsed)) return { refs: [], error: '必须是 JSON 数组' }
  if (parsed.length === 0 || parsed.length > 64) return { refs: [], error: '引用数组须包含 1～64 项' }
  const refs: KindRef[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) return { refs: [], error: '每项必须是对象' }
    const record = entry as { kind?: unknown; reference?: unknown }
    if (typeof record.kind !== 'string' || record.kind.length === 0)
      return { refs: [], error: '每项都必须有非空 kind' }
    if (typeof record.reference !== 'object' || record.reference === null)
      return { refs: [], error: '每项都必须有 reference' }
    const reference = record.reference as { entityId?: unknown; versionId?: unknown }
    if (typeof reference.entityId !== 'string' || reference.entityId.length === 0)
      return { refs: [], error: '每项都必须有非空 entityId' }
    if (typeof reference.versionId !== 'string' || reference.versionId.length === 0)
      return { refs: [], error: '每项都必须有非空 versionId' }
    refs.push({
      kind: record.kind,
      reference: { entityId: reference.entityId, versionId: reference.versionId },
    })
  }
  return { refs, error: null }
}

/** 命令身份候选：控件不支持 `crypto.randomUUID` 时退回时间戳随机串。 */
const newCommandId = (): string =>
  globalThis.crypto?.randomUUID !== undefined
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

/**
 * P-RA-02 启动评估向导（design D-02、D-04、D-07）。
 *
 * 全部引用来自精确读：工程修订与空间范围取工程上下文，风险输入取待评估目录的精确引用，
 * 适用性快照与外部风险事件取入口上下文的两个独立候选目录。监测快照与重评变化引用由用户显式
 * 输入完整精确引用（JSON），页面不接受手工拼接的标识，也不在缺少精确版本时代填默认值。
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
  const [previousRecordCursor, setPreviousRecordCursor] = useState<string | undefined>()
  const [reason, setReason] = useState<WorkflowReassessmentReasonV1>('monitoring-snapshot')
  const [monitoringInput, setMonitoringInput] = useState('')
  const [changedInput, setChangedInput] = useState('')

  // 工程或修订变化清空全部 scope-bound 选择：旧工程的候选与引用不得残留到新工程。
  useEffect(() => {
    setScopeEntityId('')
    setRiskInput(null)
    setSnapshot(null)
    setApplicabilityCursor(undefined)
    setExternalEventCursor(undefined)
    setRiskCursor(undefined)
    setEntryMode('assess')
    setPreviousRecord(null)
    setPreviousRecordCursor(undefined)
    setMonitoringInput('')
    setChangedInput('')
  }, [selector.projectId, selector.revisionId, selector.assessmentSources])

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

  // 重评入口：前驱取自已入库评估记录的精确引用，页面不推断“上一次是哪一条”。
  const priorRecords = usePageQuery<RecordCatalogView>(
    (projectId, signal) => readAssessmentRecordCatalog(projectId,
      previousRecordCursor === undefined ? {} : { cursor: previousRecordCursor }, signal),
    [previousRecordCursor],
  )

  // 入口上下文的动作分支是初评/重评两类：按当前入口模式取对应可用性，不用启动命令分支猜测。
  const actionBranch =
    entryMode === 'assess' ? 'risk-assessment.initial' : 'risk-assessment.reassessment'
  const availability =
    entry.state.kind === 'ready' ? actionAvailability(entry.state.value.actions, actionBranch) : null

  const monitoring = parseRefArray(monitoringInput)
  const changed = parseRefArray(changedInput)
  const changedComplete =
    changed.error === null && changed.refs.length >= 1 && changed.refs.length <= 64
  const reassessComplete = entryMode === 'assess' || (previousRecord !== null && changedComplete)
  const missing =
    selectedScope === null ||
    revisionRef === null ||
    riskInput === null ||
    snapshot === null ||
    monitoring.error !== null ||
    !reassessComplete

  const runPolicy =
    entry.state.kind === 'ready' && entry.state.value.runPolicy.kind === 'available'
      ? entry.state.value.runPolicy
      : null
  const runnable = availability === 'allowed' && !missing && runPolicy !== null

  // D-07：同一输入组合重试复用同一身份；任一引用/版本/策略变化即换新身份，不刷新时间蒙混。
  const identity = JSON.stringify({
    assessmentSources: selector.assessmentSources,
    projectId: selector.projectId,
    entryMode,
    graphVersion: runPolicy?.graphVersion ?? null,
    retryPolicyRef: runPolicy?.retryPolicyRef ?? null,
    projectRevisionRef: revisionRef?.reference ?? null,
    spatialScopeRef: selectedScope?.reference ?? null,
    riskInput,
    applicabilityMetadataSnapshotRef: snapshot,
    monitoringSnapshotRefs: monitoring.refs,
    previousAssessmentRecordRef: entryMode === 'reassess' ? previousRecord : null,
    reason: entryMode === 'reassess' ? reason : null,
    changedInputRefs: entryMode === 'reassess' ? changed.refs : [],
  })
  const identityRef = useRef({ identity: '', commandId: '' })
  if (identityRef.current.identity !== identity) {
    identityRef.current = { identity, commandId: `demo-assess-${newCommandId()}` }
  }
  const commandId = identityRef.current.commandId

  const start = async () => {
    const projectId = selector.projectId
    if (projectId === null || selectedScope === null || revisionRef === null) return
    if (riskInput === null || snapshot === null || runPolicy === null) return
    const started = await submitStartAssessment(projectId, {
      commandId,
      graphVersion: runPolicy.graphVersion,
      retryPolicyRef: runPolicy.retryPolicyRef,
      riskInput,
      spatialScopeRef: selectedScope,
      projectRevisionRef: revisionRef,
      applicabilityMetadataSnapshotRef: snapshot,
      ...(monitoring.refs.length === 0 ? {} : { monitoringSnapshotRefs: monitoring.refs }),
      ...(entryMode === 'reassess' && previousRecord !== null
        ? { previousAssessmentRecordRef: previousRecord, reason, changedInputRefs: changed.refs }
        : {}),
    })
    if (identityRef.current.commandId !== commandId) return
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
                      // 空间变化清空全部与该范围关联的选择与输入，避免跨范围残留。
                      setScopeEntityId(event.target.value)
                      setRiskInput(null)
                      setSnapshot(null)
                      setPreviousRecord(null)
                      setApplicabilityCursor(undefined)
                      setExternalEventCursor(undefined)
                      setRiskCursor(undefined)
                      setMonitoringInput('')
                      setChangedInput('')
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
                        const found =
                          priorRecords.state.kind === 'ready'
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
                  {priorRecords.state.kind === 'ready' && <NextPageButton
                    nextCursor={priorRecords.state.value.nextCursor} onContinue={setPreviousRecordCursor} />}
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
                    变化引用（JSON 数组，1～64 项精确引用）
                    <textarea
                      rows={4}
                      value={changedInput}
                      placeholder='[{"kind":"monitoring-snapshot","reference":{"entityId":"…","versionId":"…"}}]'
                      onChange={(event) => setChangedInput(event.target.value)}
                    />
                  </label>
                  {changed.error !== null && (
                    <p className="ar-note">变化引用不可用：{changed.error}。</p>
                  )}
                  <p className="ar-note">
                    前驱、原因与变化集合都是重评入口身份的一部分：同一组合重复提交复用同一运行，
                    任一项变化即换新身份。页面不替你推断“改了什么”。
                  </p>
                </>
              )}
            </Card>

            <Card title="可选监测输入" style={{ marginTop: 16 }}>
              <label className="ar-form-field">
                监测快照引用（可选，JSON 数组；留空表示本次不使用监测输入）
                <textarea
                  rows={4}
                  value={monitoringInput}
                  placeholder='[{"kind":"monitoring-snapshot","reference":{"entityId":"…","versionId":"…"}}]'
                  onChange={(event) => setMonitoringInput(event.target.value)}
                />
              </label>
              {monitoring.error !== null && (
                <p className="ar-note">监测引用不可用：{monitoring.error}。</p>
              )}
            </Card>

            <Card title="提交" style={{ marginTop: 16 }}>
              {availability !== null && availability !== 'allowed' && (
                <p className="ar-note">当前不可启动运行（{availability}）。</p>
              )}
              <ConfirmButton
                label="启动评估"
                resetKey={identity}
                availability={availability === 'allowed' && runnable ? 'allowed' : 'business-unavailable'}
                unavailableReason={
                  missing
                    ? entryMode === 'reassess'
                      ? '缺少工程修订、空间范围、风险输入、适用性快照、前驱记录或 1～64 项合法变化引用'
                      : '缺少工程修订、空间范围、风险输入或适用性快照'
                    : runPolicy === null
                      ? '部署未注入合格的运行策略'
                      : '当前角色无启动评估的权限'
                }
                summary={[
                  `工程：${selector.projectId ?? '—'}`,
                  `工程修订：${revisionRef?.reference.entityId ?? '—'} · ${revisionRef?.reference.versionId ?? '—'}`,
                  `空间范围：${selectedScope.reference.entityId} · ${selectedScope.reference.versionId}`,
                  `风险输入：${riskInput?.reference.entityId ?? '—'} · ${riskInput?.reference.versionId ?? '—'}`,
                  `适用性快照：${snapshot?.reference.entityId ?? '—'} · ${snapshot?.reference.versionId ?? '—'}`,
                  `监测引用（${monitoring.refs.length} 项）：${
                    monitoring.refs
                      .map((ref) => `${ref.kind}/${ref.reference.entityId}@${ref.reference.versionId}`)
                      .join('、') || '—'
                  }`,
                  entryMode === 'reassess'
                    ? `入口模式：重评（reassess）· 原因 ${reason}`
                    : '入口模式：初评（assess）',
                  ...(entryMode === 'reassess'
                    ? [
                        `前驱评估记录：${previousRecord?.reference.entityId ?? '—'} · ${previousRecord?.reference.versionId ?? '—'}`,
                        `变化引用（${changed.refs.length} 项）：${
                          changed.refs
                            .map((ref) => `${ref.kind}/${ref.reference.entityId}@${ref.reference.versionId}`)
                            .join('、') || '—'
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
