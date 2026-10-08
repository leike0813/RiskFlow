/**
 * C35 前端接线（design D-05/D-10/D-12）。
 *
 * 三条业务窄读与四条系统面路由都只经这一处调用：Agent 任务、统一复核/活动与报告读取
 * 复用既有 `submitQuery`；系统身份、目录、六项管理命令与运维查询复用 `getRaw`/`postRaw`
 * 并依赖同一枚安全 Cookie——请求体里不放会话 token，也不放管理授权引用。
 *
 * 解码只提取契约内页面所需字段，形状漂移统一收敛为 TERMINAL_FAILURE。
 * 管理密码只出现在调用参数里，不进入任何缓存、冻结命令表或 store。
 */
import { ApiError, getRaw, postRaw, submitQuery, unwrapQueryResult } from './client'

// ------------------------------------------------------------------ 解码工具

const drift = (): ApiError => new ApiError('TERMINAL_FAILURE')

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw drift()
  return value as Record<string, unknown>
}

const asArray = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw drift()
  return value
}

const asString = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0) throw drift()
  return value
}

const asOptionalString = (value: unknown): string | undefined =>
  value === undefined || value === null ? undefined : asString(value)

const asNumber = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw drift()
  return value
}

const asBoolean = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw drift()
  return value
}

const asStringArray = (value: unknown): string[] => asArray(value).map(asString)

export interface VersionRef {
  readonly entityId: string
  readonly versionId: string
}

const asVersionRef = (value: unknown): VersionRef => {
  const record = asRecord(value)
  return { entityId: asString(record.entityId), versionId: asString(record.versionId) }
}

export interface KindRef {
  readonly kind: string
  readonly reference: VersionRef
}

const asKindRef = (value: unknown): KindRef => {
  const record = asRecord(value)
  return { kind: asString(record.kind), reference: asVersionRef(record.reference) }
}

// ------------------------------------------------------------------ Agent 任务读取

/** 分支名即路径段：三条窄读共用既有 `/projects/:projectId/queries/<branch>`。 */
export const AGENT_TASK_READ_BRANCH = 'agent-task.read'
export const REVIEW_AUDIT_READ_BRANCH = 'review-audit.read'
export const PROJECTION_REPORT_READ_BRANCH = 'projection.report-read'

export interface AgentTaskRefView {
  readonly kind: 'agent-task'
  readonly reference: VersionRef
  readonly taskType: string
  readonly triggerMode: string
  readonly modelDeploymentRef: VersionRef
  readonly promptTemplateRef: VersionRef
  readonly toolPolicyRef: VersionRef
  readonly budgetPolicyRef: VersionRef
  readonly incrementSchemaRef: VersionRef
  readonly validationPolicyRef: VersionRef
}

const asAgentTaskRef = (value: unknown): AgentTaskRefView => {
  const record = asRecord(value)
  const kind = asString(record.kind)
  if (kind !== 'agent-task') throw drift()
  return {
    kind,
    reference: asVersionRef(record.reference),
    taskType: asString(record.taskType),
    triggerMode: asString(record.triggerMode),
    modelDeploymentRef: asVersionRef(record.modelDeploymentRef),
    promptTemplateRef: asVersionRef(record.promptTemplateRef),
    toolPolicyRef: asVersionRef(record.toolPolicyRef),
    budgetPolicyRef: asVersionRef(record.budgetPolicyRef),
    incrementSchemaRef: asVersionRef(record.incrementSchemaRef),
    validationPolicyRef: asVersionRef(record.validationPolicyRef),
  }
}

export interface AgentTaskSummaryView {
  readonly agentTaskRef: AgentTaskRefView
  readonly status: string
  readonly taskVersion: number
  readonly initiatorActorId: string
  readonly parentRunRef: KindRef
  readonly frozenInputRef: KindRef
  readonly createdAt: string
  readonly updatedAt: string
}

const asAgentTaskSummary = (value: unknown): AgentTaskSummaryView => {
  const record = asRecord(value)
  return {
    agentTaskRef: asAgentTaskRef(record.agentTaskRef),
    status: asString(record.status),
    taskVersion: asNumber(record.taskVersion),
    initiatorActorId: asString(record.initiatorActorId),
    parentRunRef: asKindRef(record.parentRunRef),
    frozenInputRef: asKindRef(record.frozenInputRef),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
  }
}

export interface AgentTaskListView {
  readonly items: readonly AgentTaskSummaryView[]
  readonly asOfRecordedAt: string
  readonly nextCursor?: string
}

export const readAgentTaskList = async (
  projectId: string,
  filters: {
    readonly taskType?: string
    readonly status?: string
    readonly parentRunRef?: KindRef
    readonly cursor?: string
  } = {},
  signal?: AbortSignal,
): Promise<AgentTaskListView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: AGENT_TASK_READ_BRANCH,
      payload: {
        kind: 'list',
        pageSize: 25,
        ...(filters.taskType === undefined ? {} : { taskType: filters.taskType }),
        ...(filters.status === undefined ? {} : { status: filters.status }),
        ...(filters.parentRunRef === undefined ? {} : { parentRunRef: filters.parentRunRef }),
        ...(filters.cursor === undefined ? {} : { cursor: filters.cursor }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'list') throw drift()
  return {
    items: asArray(result.items).map(asAgentTaskSummary),
    asOfRecordedAt: asString(result.asOfRecordedAt),
    ...(result.nextCursor === undefined ? {} : { nextCursor: asString(result.nextCursor) }),
  }
}

/**
 * 动作可用性沿既有四值语义：`business-unavailable` 只表示任务自身状态不允许，
 * 授权层面的允许/拒绝不在只读面上推断，界面据此如实呈现。
 */
export interface ActionAvailabilityView {
  readonly branch: string
  readonly availability: string
  readonly reasonCode?: string
}

const asActionAvailability = (value: unknown): ActionAvailabilityView => {
  const record = asRecord(value)
  return {
    branch: asString(record.branch),
    availability: asString(record.availability),
    ...(record.reasonCode === undefined ? {} : { reasonCode: asString(record.reasonCode) }),
  }
}

/** 资源用量：原 C08 AgentBudgetUsageV1 的逐项字段，缺一不可。 */
export interface AgentBudgetUsageView {
  readonly modelInvocations: number
  readonly toolInvocations: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly contextTokens: number
  readonly inputBytes: number
  readonly outputBytes: number
  readonly candidates: number
  readonly objects: number
  readonly supplementarySearches: number
  readonly corrections: number
  readonly transientRetries: number
}

const asBudgetUsage = (value: unknown): AgentBudgetUsageView => {
  const record = asRecord(value)
  return {
    modelInvocations: asNumber(record.modelInvocations),
    toolInvocations: asNumber(record.toolInvocations),
    inputTokens: asNumber(record.inputTokens),
    outputTokens: asNumber(record.outputTokens),
    contextTokens: asNumber(record.contextTokens),
    inputBytes: asNumber(record.inputBytes),
    outputBytes: asNumber(record.outputBytes),
    candidates: asNumber(record.candidates),
    objects: asNumber(record.objects),
    supplementarySearches: asNumber(record.supplementarySearches),
    corrections: asNumber(record.corrections),
    transientRetries: asNumber(record.transientRetries),
  }
}

/** 原 C08 预算策略的上限：逐项原样呈现，不合并、不换算成"总 token"之类的虚构数字。 */
export interface AgentBudgetPolicyView {
  readonly policyRef: VersionRef
  readonly maxModelInvocations: number
  readonly maxToolInvocations: number
  readonly maxContextTokens: number
  readonly maxInputTokens?: number
  readonly maxOutputTokens?: number
  readonly maxInputBytes: number
  readonly maxOutputBytes: number
  readonly maxCandidates: number
  readonly maxObjects: number
  readonly maxSupplementarySearches: number
  readonly maxCorrections: number
  readonly maxTransientRetries: number
  readonly maxConcurrentActions: number
  readonly maxWallClockMs: number
}

const asOptionalNumber = (value: unknown): number | undefined =>
  value === undefined ? undefined : asNumber(value)

const asBudgetPolicy = (value: unknown): AgentBudgetPolicyView => {
  const record = asRecord(value)
  const maxInputTokens = asOptionalNumber(record.maxInputTokens)
  const maxOutputTokens = asOptionalNumber(record.maxOutputTokens)
  return {
    policyRef: asVersionRef(record.policyRef),
    maxModelInvocations: asNumber(record.maxModelInvocations),
    maxToolInvocations: asNumber(record.maxToolInvocations),
    maxContextTokens: asNumber(record.maxContextTokens),
    ...(maxInputTokens === undefined ? {} : { maxInputTokens }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    maxInputBytes: asNumber(record.maxInputBytes),
    maxOutputBytes: asNumber(record.maxOutputBytes),
    maxCandidates: asNumber(record.maxCandidates),
    maxObjects: asNumber(record.maxObjects),
    maxSupplementarySearches: asNumber(record.maxSupplementarySearches),
    maxCorrections: asNumber(record.maxCorrections),
    maxTransientRetries: asNumber(record.maxTransientRetries),
    maxConcurrentActions: asNumber(record.maxConcurrentActions),
    maxWallClockMs: asNumber(record.maxWallClockMs),
  }
}

/**
 * 预算视图：原策略上限与原台账的 used / reserved / 墙钟 / 并发分别呈现。
 * 台账是唯一实际消耗事实——没有 `exhausted` 这种派生标志就不造一个。
 */
export interface AgentBudgetView {
  readonly policy: AgentBudgetPolicyView
  readonly ledger: {
    readonly used: AgentBudgetUsageView
    readonly reserved: AgentBudgetUsageView
    readonly activeWallClockMs: number
    readonly currentConcurrency: number
    readonly ledgerVersion: number
    readonly changedAt: string
  }
}

const asBudgetView = (value: unknown): AgentBudgetView => {
  const record = asRecord(value)
  const ledger = asRecord(record.ledger)
  return {
    policy: asBudgetPolicy(record.policy),
    ledger: {
      used: asBudgetUsage(ledger.used),
      reserved: asBudgetUsage(ledger.reserved),
      activeWallClockMs: asNumber(ledger.activeWallClockMs),
      currentConcurrency: asNumber(ledger.currentConcurrency),
      ledgerVersion: asNumber(ledger.ledgerVersion),
      changedAt: asString(ledger.changedAt),
    },
  }
}

export interface AgentProposalSummaryView {
  readonly commandProposalRef: KindRef
  readonly taskRef: AgentTaskRefView
  readonly targetRef: KindRef
  readonly expectedTargetVersion: VersionRef
  readonly expectedEffect: string
  readonly proposedAt: string
}

const asProposalSummary = (value: unknown): AgentProposalSummaryView => {
  const record = asRecord(value)
  return {
    commandProposalRef: asKindRef(record.commandProposalRef),
    taskRef: asAgentTaskRef(record.taskRef),
    targetRef: asKindRef(record.targetRef),
    expectedTargetVersion: asVersionRef(record.expectedTargetVersion),
    expectedEffect: asString(record.expectedEffect),
    proposedAt: asString(record.proposedAt),
  }
}

export interface AgentTaskDetailView {
  readonly summary: AgentTaskSummaryView
  readonly budget: AgentBudgetView
  readonly actions: readonly ActionAvailabilityView[]
  readonly currentProposal?: AgentProposalSummaryView
  readonly resultRef?: KindRef
  readonly safeError?: {
    readonly code: string
    readonly category: string
    readonly retryable: boolean
    readonly stage: string
    readonly occurredAt: string
    readonly reasonCode?: string
    /** 恢复所依据的真实诊断工件引用；没有就不编一个。 */
    readonly diagnosticRef?: KindRef
  }
}

export const readAgentTaskDetail = async (
  projectId: string,
  agentTaskRef: AgentTaskRefView,
  signal?: AbortSignal,
): Promise<AgentTaskDetailView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: AGENT_TASK_READ_BRANCH,
      payload: { kind: 'detail', agentTaskRef },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'detail') throw drift()
  const safeError = result.safeError === undefined ? undefined : asRecord(result.safeError)
  const safeErrorReasonCode =
    safeError === undefined ? undefined : asOptionalString(safeError.reasonCode)
  const safeErrorDiagnosticRef =
    safeError === undefined || safeError.diagnosticRef === undefined
      ? undefined
      : asKindRef(safeError.diagnosticRef)
  return {
    summary: asAgentTaskSummary(result.summary),
    budget: asBudgetView(result.budget),
    actions: asArray(result.actions).map(asActionAvailability),
    ...(result.currentProposal === undefined
      ? {}
      : { currentProposal: asProposalSummary(result.currentProposal) }),
    ...(result.resultRef === undefined ? {} : { resultRef: asKindRef(result.resultRef) }),
    ...(safeError === undefined
      ? {}
      : {
          safeError: {
            code: asString(safeError.code),
            category: asString(safeError.category),
            retryable: asBoolean(safeError.retryable),
            stage: asString(safeError.stage),
            occurredAt: asString(safeError.occurredAt),
            ...(safeErrorReasonCode === undefined ? {} : { reasonCode: safeErrorReasonCode }),
            ...(safeErrorDiagnosticRef === undefined
              ? {}
              : { diagnosticRef: safeErrorDiagnosticRef }),
          },
        }),
  }
}

export interface AgentActionEntryView {
  readonly actionId: string
  readonly sequence: number
  readonly actionType: string
  readonly status: string
  readonly intentArtifactRef: KindRef
  readonly errorCode?: string
  readonly recordedAt: string
}

export interface AgentActionPageView {
  readonly items: readonly AgentActionEntryView[]
  readonly nextCursor?: string
}

/** 行动只呈现引用、类型、状态与实际用量；命令正文与模型输出不在读面上。 */
export const readAgentTaskActions = async (
  projectId: string,
  agentTaskRef: AgentTaskRefView,
  options: { readonly cursor?: string } = {},
  signal?: AbortSignal,
): Promise<AgentActionPageView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: AGENT_TASK_READ_BRANCH,
      payload: {
        kind: 'actions',
        agentTaskRef,
        pageSize: 25,
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'actions') throw drift()
  return {
    items: asArray(result.items).map((item) => {
      const record = asRecord(item)
      return {
        actionId: asString(record.actionId),
        sequence: asNumber(record.sequence),
        actionType: asString(record.actionType),
        status: asString(record.status),
        intentArtifactRef: asKindRef(record.intentArtifactRef),
        ...(record.errorCode === undefined ? {} : { errorCode: asString(record.errorCode) }),
        recordedAt: asString(record.recordedAt),
      }
    }),
    ...(result.nextCursor === undefined ? {} : { nextCursor: asString(result.nextCursor) }),
  }
}

export interface AgentCandidateEntryView {
  readonly candidateVersion: number
  readonly parentCandidateVersion: number
  readonly candidateArtifactRef: KindRef
  readonly incrementArtifactRef: KindRef
  readonly disposition: string
  readonly createdAt: string
}

export interface AgentCandidatePageView {
  readonly items: readonly AgentCandidateEntryView[]
  readonly nextCursor?: string
}

export const readAgentTaskCandidates = async (
  projectId: string,
  agentTaskRef: AgentTaskRefView,
  options: { readonly cursor?: string } = {},
  signal?: AbortSignal,
): Promise<AgentCandidatePageView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: AGENT_TASK_READ_BRANCH,
      payload: {
        kind: 'candidates',
        agentTaskRef,
        pageSize: 25,
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'candidates') throw drift()
  return {
    items: asArray(result.items).map((item) => {
      const record = asRecord(item)
      return {
        candidateVersion: asNumber(record.candidateVersion),
        parentCandidateVersion: asNumber(record.parentCandidateVersion),
        candidateArtifactRef: asKindRef(record.candidateArtifactRef),
        incrementArtifactRef: asKindRef(record.incrementArtifactRef),
        disposition: asString(record.disposition),
        createdAt: asString(record.createdAt),
      }
    }),
    ...(result.nextCursor === undefined ? {} : { nextCursor: asString(result.nextCursor) }),
  }
}

export interface AgentValidationCheckView {
  readonly checkId: string
  readonly disposition: string
  readonly rejectionClass?: string
  readonly reasonCode: string
}

export interface AgentValidationPageView {
  readonly candidateVersion: number
  readonly items: readonly AgentValidationCheckView[]
  readonly nextCursor?: string
}

export const readAgentCandidateValidation = async (
  projectId: string,
  agentTaskRef: AgentTaskRefView,
  candidateVersion: number,
  options: { readonly cursor?: string } = {},
  signal?: AbortSignal,
): Promise<AgentValidationPageView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: AGENT_TASK_READ_BRANCH,
      payload: {
        kind: 'validation',
        agentTaskRef,
        candidateVersion,
        pageSize: 25,
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'validation') throw drift()
  return {
    candidateVersion: asNumber(result.candidateVersion),
    items: asArray(result.items).map((item) => {
      const record = asRecord(item)
      return {
        checkId: asString(record.checkId),
        disposition: asString(record.disposition),
        ...(record.rejectionClass === undefined
          ? {}
          : { rejectionClass: asString(record.rejectionClass) }),
        reasonCode: asString(record.reasonCode),
      }
    }),
    ...(result.nextCursor === undefined ? {} : { nextCursor: asString(result.nextCursor) }),
  }
}

/**
 * 启动上下文：只有来源任务仍可启动、定义仍注册且支持 interactive 时才拿到完整载荷。
 * 缺失定义或不支持时按稳定 reasonCode 呈现，界面不自行拼一份"看起来像"的启动参数。
 */
export interface AgentLaunchContextView {
  readonly supported: boolean
  readonly reasonCode?: string
  readonly payload?: Readonly<Record<string, unknown>>
}

export const readAgentLaunchContext = async (
  projectId: string,
  sourceAgentTaskRef: AgentTaskRefView,
  signal?: AbortSignal,
): Promise<AgentLaunchContextView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: AGENT_TASK_READ_BRANCH,
      payload: { kind: 'launch-context', sourceAgentTaskRef },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'launch-context') throw drift()
  const launchContext = asRecord(result.launchContext)
  const supported = asBoolean(launchContext.supported)
  if (!supported)
    return {
      supported,
      ...(launchContext.reasonCode === undefined
        ? {}
        : { reasonCode: asString(launchContext.reasonCode) }),
    }
  return { supported, payload: asRecord(launchContext.payload) }
}

// ------------------------------------------------------------------ 复核详情与活动

export interface ReviewTaskRefView {
  readonly kind: 'review-task'
  readonly reference: VersionRef
  readonly reviewType: string
  readonly targetRef: KindRef
  readonly waitingRunRef?: KindRef
}

const asReviewTaskRef = (value: unknown): ReviewTaskRefView => {
  const record = asRecord(value)
  const kind = asString(record.kind)
  if (kind !== 'review-task') throw drift()
  return {
    kind,
    reference: asVersionRef(record.reference),
    reviewType: asString(record.reviewType),
    targetRef: asKindRef(record.targetRef),
    ...(record.waitingRunRef === undefined ? {} : { waitingRunRef: asKindRef(record.waitingRunRef) }),
  }
}

export interface ReviewTaskDetailView {
  readonly reviewTaskRef: ReviewTaskRefView
  readonly projectId: string
  readonly reviewType: string
  readonly status: string
  readonly targetRef: KindRef
  readonly requestedBy: string
  readonly requestedAt: string
  readonly decidedAt?: string
  readonly supersededAt?: string
  readonly actions: readonly ActionAvailabilityView[]
  /** 完整候选集引用（实体 + 身份版本）：没有身份版本就构造不出精确修正决定。 */
  readonly revisedCandidateRefs: readonly KindRef[]
  readonly decision?: {
    readonly reviewDecisionRef: KindRef
    readonly decision: Readonly<Record<string, unknown>>
    readonly reasonCode: string
    readonly actorRef: string
    readonly decidedAt: string
  }
}

export const readReviewTaskDetail = async (
  projectId: string,
  reviewTaskRef: ReviewTaskRefView,
  signal?: AbortSignal,
): Promise<ReviewTaskDetailView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: REVIEW_AUDIT_READ_BRANCH,
      payload: { kind: 'task-detail', reviewTaskRef },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'task-detail') throw drift()
  const decision = result.decision === undefined ? undefined : asRecord(result.decision)
  return {
    reviewTaskRef: asReviewTaskRef(result.reviewTaskRef),
    projectId: asString(result.projectId),
    reviewType: asString(result.reviewType),
    status: asString(result.status),
    targetRef: asKindRef(result.targetRef),
    requestedBy: asString(result.requestedBy),
    requestedAt: asString(result.requestedAt),
    ...(result.decidedAt === undefined ? {} : { decidedAt: asString(result.decidedAt) }),
    ...(result.supersededAt === undefined
      ? {}
      : { supersededAt: asString(result.supersededAt) }),
    actions: asArray(result.actions).map(asActionAvailability),
    revisedCandidateRefs:
      result.revisedCandidateRefs === undefined
        ? []
        : asArray(result.revisedCandidateRefs).map(asKindRef),
    ...(decision === undefined
      ? {}
      : {
          decision: {
            reviewDecisionRef: asKindRef(decision.reviewDecisionRef),
            decision: asRecord(decision.decision),
            reasonCode: asString(decision.reasonCode),
            actorRef: asString(decision.actorRef),
            decidedAt: asString(decision.decidedAt),
          },
        }),
  }
}

export interface ReviewActivityView {
  readonly activityId: string
  readonly sourceType: string
  readonly activityCode: string
  readonly actionCode?: string
  readonly actorRef?: string
  readonly resultCode?: string
  readonly reasonCode?: string
  readonly occurredAt: string
  readonly recordedAt: string
}

export interface ReviewActivityPageView {
  readonly items: readonly ReviewActivityView[]
  readonly asOfRecordedAt: string
  readonly nextCursor?: string
}

export const readReviewActivities = async (
  projectId: string,
  options: {
    readonly subjectRef?: KindRef
    readonly sourceType?: string
    readonly resultCode?: string
    readonly cursor?: string
  } = {},
  signal?: AbortSignal,
): Promise<ReviewActivityPageView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: REVIEW_AUDIT_READ_BRANCH,
      payload: {
        kind: 'activities',
        pageSize: 25,
        ...(options.subjectRef === undefined ? {} : { subjectRef: options.subjectRef }),
        ...(options.sourceType === undefined ? {} : { sourceType: options.sourceType }),
        ...(options.resultCode === undefined ? {} : { resultCode: options.resultCode }),
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'activities') throw drift()
  return {
    items: asArray(result.items).map((item) => {
      const record = asRecord(item)
      const actorRef = asOptionalString(record.actorRef)
      const actionCode = asOptionalString(record.actionCode)
      const resultCode = asOptionalString(record.resultCode)
      const reasonCode = asOptionalString(record.reasonCode)
      return {
        activityId: asString(record.activityId),
        sourceType: asString(record.sourceType),
        activityCode: asString(record.activityCode),
        ...(actionCode === undefined ? {} : { actionCode }),
        ...(actorRef === undefined ? {} : { actorRef }),
        ...(resultCode === undefined ? {} : { resultCode }),
        ...(reasonCode === undefined ? {} : { reasonCode }),
        occurredAt: asString(record.occurredAt),
        recordedAt: asString(record.recordedAt),
      }
    }),
    asOfRecordedAt: asString(result.asOfRecordedAt),
    ...(result.nextCursor === undefined ? {} : { nextCursor: asString(result.nextCursor) }),
  }
}

// ------------------------------------------------------------------ 报告导出

export interface ReportPolicyView {
  readonly policyRef: VersionRef
  readonly queryTypes: readonly string[]
  readonly sections: readonly string[]
  readonly maxPages: number
  readonly maxItems: number
  readonly maxBytes: number
}

export const readReportPolicies = async (
  projectId: string,
  signal?: AbortSignal,
): Promise<readonly ReportPolicyView[]> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: PROJECTION_REPORT_READ_BRANCH,
      payload: { kind: 'policies' },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'policies') throw drift()
  return asArray(result.items).map((item) => {
    const record = asRecord(item)
    return {
      policyRef: asVersionRef(record.policyRef),
      queryTypes: asStringArray(record.queryTypes),
      sections: asStringArray(record.sections),
      maxPages: asNumber(record.maxPages),
      maxItems: asNumber(record.maxItems),
      maxBytes: asNumber(record.maxBytes),
    }
  })
}

export interface ReportPreviewView {
  readonly sourceRef: KindRef
  readonly queryType: string
  readonly itemCount: number
  readonly nextCursor?: string
}

export const readReportPreview = async (
  projectId: string,
  input: {
    readonly queryResultRef: KindRef
    readonly exportPolicyRef: VersionRef
  },
  signal?: AbortSignal,
): Promise<ReportPreviewView> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: PROJECTION_REPORT_READ_BRANCH,
      payload: {
        kind: 'preview',
        queryResultRef: input.queryResultRef,
        exportPolicyRef: input.exportPolicyRef,
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'preview') throw drift()
  return {
    sourceRef: asKindRef(result.sourceRef),
    queryType: asString(result.queryType),
    itemCount: asArray(result.items).length,
    ...(result.nextCursor === undefined ? {} : { nextCursor: asString(result.nextCursor) }),
  }
}

export interface ReportArtifactDownload {
  readonly fileName: string
  readonly byteLength: number
  readonly json: string
  readonly revoke: () => void
}

/**
 * 真实 JSON 下载：正文只来自服务端校验过的工件读，文件名由服务端给定。
 * 对象 URL 用后立即撤销，不留下长期可访问的本地句柄。
 */
export const downloadReportArtifact = async (
  projectId: string,
  exportArtifactRef: KindRef,
  signal?: AbortSignal,
): Promise<ReportArtifactDownload> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: PROJECTION_REPORT_READ_BRANCH,
      payload: { kind: 'artifact', exportArtifactRef },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'artifact') throw drift()
  const fileName = asString(result.fileName)
  const json = JSON.stringify(asRecord(result.body))
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  return {
    fileName,
    byteLength: asNumber(result.byteLength),
    json,
    revoke: () => URL.revokeObjectURL(url),
  }
}

export interface ReportHistoryItemView {
  readonly exportArtifactRef: KindRef
  readonly sourceRef: KindRef
  readonly recordedAt: string
}

export const readReportHistory = async (
  projectId: string,
  options: { readonly sourceRef?: KindRef; readonly cursor?: string } = {},
  signal?: AbortSignal,
): Promise<{ readonly items: readonly ReportHistoryItemView[]; readonly nextCursor?: string }> => {
  const result = asRecord(
    await submitQuery({
      projectId,
      branch: PROJECTION_REPORT_READ_BRANCH,
      payload: {
        kind: 'history',
        pageSize: 25,
        ...(options.sourceRef === undefined ? {} : { sourceRef: options.sourceRef }),
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (result.kind !== 'history') throw drift()
  return {
    items: asArray(result.items).map((item) => {
      const record = asRecord(item)
      return {
        exportArtifactRef: asKindRef(record.exportArtifactRef),
        sourceRef: asKindRef(record.sourceRef),
        recordedAt: asString(record.recordedAt),
      }
    }),
    ...(result.nextCursor === undefined ? {} : { nextCursor: asString(result.nextCursor) }),
  }
}

// ------------------------------------------------------------------ 独立系统管理面

/** 系统面请求体只有身份与调用标识：会话由同一枚安全 Cookie 承担。 */
const systemEnvelope = () => ({
  schemaVersion: '1' as const,
  queryId: `demo-system-${Date.now().toString(36)}`,
  requestedAt: new Date().toISOString(),
})

export interface SystemIdentityView {
  readonly isSystemAdministrator: boolean
  readonly accountRef?: VersionRef
  readonly allowedActions: readonly string[]
}

export const readSystemIdentity = async (
  signal?: AbortSignal,
): Promise<SystemIdentityView> => {
  const body = asRecord(
    await getRaw({ path: '/api/v1/administration', ...(signal === undefined ? {} : { signal }) }),
  )
  if (body.kind !== 'succeeded') throw drift()
  const result = asRecord(body.result)
  if (result.kind !== 'identity') throw drift()
  return {
    isSystemAdministrator: asBoolean(result.isSystemAdministrator),
    ...(result.accountRef === undefined ? {} : { accountRef: asVersionRef(result.accountRef) }),
    allowedActions: asStringArray(result.allowedActions),
  }
}

export interface SystemAccountView {
  readonly accountRef: VersionRef
  readonly loginName: string
  readonly displayName: string
  readonly status: string
  readonly passwordChangeRequired: boolean
}

export interface SystemProjectView {
  readonly projectId: string
  readonly status: string
  readonly accessRevisionRef: VersionRef
}

export interface SystemMembershipView {
  readonly membershipRef: VersionRef
  readonly accountRef: VersionRef
  readonly roles: readonly string[]
  readonly spatialScopeRefs: readonly KindRef[]
  readonly status: string
}

export interface SystemSpatialScopeView {
  readonly scopeId: string
  readonly scopeRef: KindRef
  readonly parentScopeRef?: KindRef
  readonly status: string
}

const administrationQuery = async (
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> => {
  const body = asRecord(
    await postRaw({
      path: '/api/v1/administration/queries',
      body: { ...systemEnvelope(), payload },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (body.kind !== 'succeeded') throw drift()
  return asRecord(body.result)
};

export const listSystemAccounts = async (
  signal?: AbortSignal,
): Promise<readonly SystemAccountView[]> => {
  const result = await administrationQuery({ kind: 'accounts', pageSize: 25 }, signal)
  if (result.kind !== 'accounts') throw drift()
  return asArray(result.items).map((item) => {
    const record = asRecord(item)
    return {
      accountRef: asVersionRef(record.accountRef),
      loginName: asString(record.loginName),
      displayName: asString(record.displayName),
      status: asString(record.status),
      passwordChangeRequired: asBoolean(record.passwordChangeRequired),
    }
  })
};

export const listSystemProjects = async (
  signal?: AbortSignal,
): Promise<readonly SystemProjectView[]> => {
  const result = await administrationQuery({ kind: 'projects', pageSize: 25 }, signal)
  if (result.kind !== 'projects') throw drift()
  return asArray(result.items).map((item) => {
    const record = asRecord(item)
    return {
      projectId: asString(record.projectId),
      status: asString(record.status),
      accessRevisionRef: asVersionRef(record.accessRevisionRef),
    }
  })
};

export const listSystemMemberships = async (
  projectId: string,
  signal?: AbortSignal,
): Promise<readonly SystemMembershipView[]> => {
  const result = await administrationQuery({ kind: 'memberships', projectId, pageSize: 25 }, signal)
  if (result.kind !== 'memberships') throw drift()
  return asArray(result.items).map((item) => {
    const record = asRecord(item)
    return {
      membershipRef: asVersionRef(record.membershipRef),
      accountRef: asVersionRef(record.accountRef),
      roles: asStringArray(record.roles),
      spatialScopeRefs: asArray(record.spatialScopeRefs).map(asKindRef),
      status: asString(record.status),
    }
  })
};

export const listSystemSpatialScopes = async (
  projectId: string,
  signal?: AbortSignal,
): Promise<readonly SystemSpatialScopeView[]> => {
  const result = await administrationQuery(
    { kind: 'spatial-scopes', projectId, pageSize: 25 },
    signal,
  )
  if (result.kind !== 'spatial-scopes') throw drift()
  return asArray(result.items).map((item) => {
    const record = asRecord(item)
    return {
      scopeId: asString(record.scopeId),
      scopeRef: asKindRef(record.scopeRef),
      ...(record.parentScopeRef === undefined
        ? {}
        : { parentScopeRef: asKindRef(record.parentScopeRef) }),
      status: asString(record.status),
    }
  })
};

/**
 * 密码只在这一次调用里出现：不写入 store、不进冻结命令表、也不随目录查询回传。
 * commandId 与 idempotencyKey 同时给出，因此网络重放不会重复建号。
 */
const administrationCommand = async (
  payload: Record<string, unknown>,
  commandId: string,
  signal?: AbortSignal,
): Promise<{ readonly resultRef: VersionRef }> => {
  const body = asRecord(
    await postRaw({
      path: '/api/v1/administration/commands',
      body: {
        schemaVersion: '1',
        commandId,
        idempotencyKey: commandId,
        issuedAt: new Date().toISOString(),
        payload,
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (body.kind !== 'succeeded') throw drift()
  const result = asRecord(body.result)
  return { resultRef: asVersionRef(result.resultRef) }
};

let administrationCommandSequence = 0
const nextAdministrationCommandId = (action: string): string => {
  administrationCommandSequence += 1
  return `demo-${action}-${Date.now().toString(36)}-${administrationCommandSequence}`
};

export const createSystemAccount = async (input: {
  readonly loginName: string
  readonly displayName: string
  readonly password: string
  readonly commandId?: string
}): Promise<{ readonly resultRef: VersionRef }> =>
  administrationCommand(
    {
      kind: 'create-account',
      expectedVersion: 'none',
      loginName: input.loginName,
      displayName: input.displayName,
      password: input.password,
    },
    input.commandId ?? nextAdministrationCommandId('create-account'),
  );

export const disableSystemAccount = async (input: {
  readonly accountId: string
  readonly expectedVersion: VersionRef
  readonly commandId?: string
}): Promise<{ readonly resultRef: VersionRef }> =>
  administrationCommand(
    {
      kind: 'disable-account',
      expectedVersion: input.expectedVersion,
      accountId: input.accountId,
    },
    input.commandId ?? nextAdministrationCommandId('disable-account'),
  );

/** 重置口令：密码随本次请求一次性提交，服务端不会回传派生值。 */
export const resetSystemAccountPassword = async (input: {
  readonly accountId: string
  readonly expectedVersion: VersionRef
  readonly password: string
  readonly commandId?: string
}): Promise<{ readonly resultRef: VersionRef }> =>
  administrationCommand(
    {
      kind: 'reset-password',
      expectedVersion: input.expectedVersion,
      accountId: input.accountId,
      password: input.password,
    },
    input.commandId ?? nextAdministrationCommandId('reset-password'),
  );

export const openSystemProject = async (input: {
  readonly projectId: string
  readonly initialRiskManagerAccountId: string
  readonly commandId?: string
}): Promise<{ readonly resultRef: VersionRef }> =>
  administrationCommand(
    {
      kind: 'open-project',
      expectedVersion: 'none',
      projectId: input.projectId,
      initialRiskManagerAccountId: input.initialRiskManagerAccountId,
    },
    input.commandId ?? nextAdministrationCommandId('open-project'),
  );

export const suspendSystemProject = async (input: {
  readonly projectId: string
  readonly expectedVersion: VersionRef
  readonly commandId?: string
}): Promise<{ readonly resultRef: VersionRef }> =>
  administrationCommand(
    {
      kind: 'suspend-project',
      expectedVersion: input.expectedVersion,
      projectId: input.projectId,
    },
    input.commandId ?? nextAdministrationCommandId('suspend-project'),
  );

export const reviseSystemMembership = async (input: {
  readonly projectId: string
  readonly membershipId: string
  readonly expectedVersion: VersionRef
  readonly accountId: string
  readonly roles: readonly string[]
  readonly spatialScopeRefs: readonly KindRef[]
  readonly status: string
  readonly commandId?: string
}): Promise<{ readonly resultRef: VersionRef }> =>
  administrationCommand(
    {
      kind: 'revise-membership',
      expectedVersion: input.expectedVersion,
      projectId: input.projectId,
      membershipId: input.membershipId,
      accountId: input.accountId,
      roles: input.roles,
      spatialScopeRefs: input.spatialScopeRefs,
      status: input.status,
    },
    input.commandId ?? nextAdministrationCommandId('revise-membership'),
  );

// ------------------------------------------------------------------ 运维输出

export interface SystemHealthView {
  readonly capturedAt: string
  readonly components: readonly {
    readonly componentId: string
    readonly status: string
    readonly reasonCode?: string
  }[]
}

export interface SystemModelVersionView {
  readonly taskType: string
  readonly deploymentRef: VersionRef
  readonly modelVersionRef: VersionRef
  readonly serverBuildRef?: VersionRef
  readonly promptTemplateRef: VersionRef
  readonly toolPolicyRef: VersionRef
  readonly budgetPolicyRef: VersionRef
  readonly supportedTriggerModes: readonly string[]
}

const operationsQuery = async (
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> => {
  const body = asRecord(
    await postRaw({
      path: '/api/v1/operations/queries',
      body: { ...systemEnvelope(), payload },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  if (body.kind !== 'succeeded') throw drift()
  return asRecord(body.result)
};

export const readSystemHealth = async (signal?: AbortSignal): Promise<SystemHealthView> => {
  const result = await operationsQuery({ kind: 'health' }, signal)
  if (result.kind !== 'health') throw drift()
  return {
    capturedAt: asString(result.capturedAt),
    components: asArray(result.components).map((item) => {
      const record = asRecord(item)
      const reasonCode = asOptionalString(record.reasonCode)
      return {
        componentId: asString(record.componentId),
        status: asString(record.status),
        ...(reasonCode === undefined ? {} : { reasonCode }),
      }
    }),
  }
};

export const readSystemModelVersions = async (
  signal?: AbortSignal,
): Promise<readonly SystemModelVersionView[]> => {
  const result = await operationsQuery({ kind: 'model-versions' }, signal)
  if (result.kind !== 'model-versions') throw drift()
  return asArray(result.items).map((item) => {
    const record = asRecord(item)
    const serverBuildRef = asOptionalString(record.serverBuildRef)
    return {
      taskType: asString(record.taskType),
      deploymentRef: asVersionRef(record.deploymentRef),
      modelVersionRef: asVersionRef(record.modelVersionRef),
      ...(serverBuildRef === undefined ? {} : { serverBuildRef: asVersionRef(record.serverBuildRef) }),
      promptTemplateRef: asVersionRef(record.promptTemplateRef),
      toolPolicyRef: asVersionRef(record.toolPolicyRef),
      budgetPolicyRef: asVersionRef(record.budgetPolicyRef),
      supportedTriggerModes: asStringArray(record.supportedTriggerModes),
    }
  })
};

export { unwrapQueryResult }