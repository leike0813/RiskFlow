// Agent 域 fixture（P-AG-01～P-AG-03，归属 C35）。
// 字段形状以 packages/contracts 为准（G2 校正）：
// - 任务引用 AgentTaskRefV1：src/ports/index.ts:316-328（taskType / triggerMode /
//   modelDeploymentRef / promptTemplateRef / toolPolicyRef / budgetPolicyRef /
//   incrementSchemaRef / validationPolicyRef）；
// - 启动命令 payload：src/ports/index.ts:1722-1740（parentRunRef / frozenInputRef 等）；
// - 任务状态 AgentTaskStatusV1：src/ports/index.ts:275-283；
// - 结果引用 AgentTaskResultRefV1：src/ports/index.ts:684-791（completed 三类主输出
//   引用互斥且至少其一；failed 携带 errorRef）；
// - 待确认命令：CommandProposalRefV1 / UserConfirmationRefV1（src/ports/index.ts:229-233）。
// 工具行动、Agent 增量逐项校验决定、资源消耗计数在契约中无记录 Schema，为展示预设，
// 已在 docs/gap-inbox/agent.md 登记（GAP-AG-01～03）。
// 语义红线：任务信封固定发起者 / 工程 / 输入版本 / 模型与提示模板 / 工具策略 / 资源预算 /
// Agent 增量 / 终态；工具调用限于按任务类型版本化的白名单；增量为类型化领域操作，
// 确定性校验逐项记录接受、拒绝及原因；失败不静默跳过；不保存、不展示模型内部思维链。
// 跨域标识沿典范追溯链：DOC2026001-S32-SEG007 → PN-VDS-04 → MEC-VDS-017 →
// RISK-2026-001 → RUN-A-2026-001 / ASSESS-2026-001 → WARN-2026-001 → RESP-2026-001 →
// EXE-2026-001 → FBK-2026-001 → DEV-2026-001 → AGT-001 → CAL-2026-001 → RVT-2026-001。

/** 对齐 contracts VersionReferenceSchema。 */
export interface VersionRef {
  readonly entityId: string;
  readonly versionId: string;
}

/** 对齐 contracts AgentTaskTypeV1Schema（五类必经内嵌任务类型）。 */
export type AgentTaskType =
  | 'data-cleaning'
  | 'knowledge-authoring'
  | 'retrieval-review'
  | 'response-recommendation'
  | 'calibration-suggestion';

export const AGENT_TASK_TYPE_LABELS: Readonly<Record<AgentTaskType, string>> = {
  'data-cleaning': '数据清洗与部分可用判断',
  'knowledge-authoring': '非结构化知识编制',
  'retrieval-review': '识别检索审阅与有界补搜',
  'response-recommendation': '处置建议组合排序',
  'calibration-suggestion': '校准建议候选',
};

/** 对齐 contracts AgentTriggerModeV1Schema。 */
export type AgentTriggerMode = 'embedded' | 'interactive';

export const AGENT_TRIGGER_MODE_LABELS: Readonly<Record<AgentTriggerMode, string>> = {
  embedded: '内嵌',
  interactive: '交互',
};

/** 对齐 contracts AgentTaskStatusV1Schema。 */
export type AgentTaskStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const AGENT_TASK_STATUS_LABELS: Readonly<Record<AgentTaskStatus, string>> = {
  pending: '待启动',
  running: '运行中',
  waiting: '等待确认',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

/** 对齐 contracts AgentTaskRefV1（kind 字面量在页面层省略）。 */
export interface AgentTaskRefView {
  readonly reference: VersionRef;
  readonly taskType: AgentTaskType;
  readonly triggerMode: AgentTriggerMode;
  readonly modelDeploymentRef: VersionRef;
  readonly promptTemplateRef: VersionRef;
  readonly toolPolicyRef: VersionRef;
  readonly budgetPolicyRef: VersionRef;
  readonly incrementSchemaRef: VersionRef;
  readonly validationPolicyRef: VersionRef;
}

/** 工具行动：白名单内领域工具逐项调用；白名单外调用被拦截并记录。 */
export interface ToolActionView {
  readonly actionId: string;
  readonly toolName: string;
  readonly toolLabel: string;
  readonly summary: string;
  readonly outcome: 'succeeded' | 'blocked';
  readonly note: string;
}

/** Agent 增量项：类型化领域操作 + 确定性校验逐项决定（接受 / 拒绝及原因）。 */
export interface AgentIncrementView {
  readonly incrementItemId: string;
  readonly operationType: string;
  readonly summary: string;
  readonly decision: 'accepted' | 'rejected';
  readonly reason: string;
}

/** 资源消耗与版本化硬预算对比（token / 工具调用 / 候选规模 / 墙钟时间）。 */
export interface BudgetConsumptionView {
  readonly tokensUsed: number;
  readonly tokensLimit: number;
  readonly toolCallsUsed: number;
  readonly toolCallsLimit: number;
  readonly candidatesUsed: number;
  readonly candidatesLimit: number;
  readonly wallClockSeconds: number;
  readonly wallClockLimitSeconds: number;
}

/** 失败证据（对齐 ModuleErrorV1 的 TRANSIENT_FAILURE / TERMINAL_FAILURE 形状子集）。 */
export interface AgentTaskFailureView {
  readonly errorCode: 'TRANSIENT_FAILURE' | 'TERMINAL_FAILURE';
  readonly retryable: boolean;
  readonly stageCode: string;
  readonly occurredAt: string;
  readonly errorRef: VersionRef;
  readonly diagnosticRef: VersionRef;
  readonly summary: string;
}

/** 完成结果引用（completed：candidateRef + validationRef；formalResult 由下游记录承载）。 */
export interface AgentTaskOutcomeView {
  readonly candidateRef: VersionRef;
  readonly candidateLabel: string;
  readonly candidateHref: string;
  readonly validationRef: VersionRef;
  readonly formalResultNote: string;
}

export interface AgentTimelineEvent {
  readonly at: string;
  readonly actorLabel: string;
  readonly action: string;
}

/** Agent 任务视图：运行头部 + 任务信封 + 工具行动 + 增量校验 + 预算 + 结果。 */
export interface AgentTaskView {
  readonly ref: AgentTaskRefView;
  readonly status: AgentTaskStatus;
  readonly initiatorLabel: string;
  readonly initiatorActorId: string;
  readonly projectLabel: string;
  readonly projectId: string;
  readonly parentRunRef: VersionRef;
  readonly parentRunLabel: string;
  readonly frozenInputKindLabel: string;
  readonly frozenInputRef: VersionRef;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly idempotencyKey: string;
  readonly summary: string;
  readonly toolActions: readonly ToolActionView[];
  readonly increments: readonly AgentIncrementView[];
  readonly budget: BudgetConsumptionView;
  readonly outcome: AgentTaskOutcomeView | null;
  readonly failure: AgentTaskFailureView | null;
  /** waiting 状态的等待对象说明（如待确认命令）。 */
  readonly waitingNote: string | null;
  readonly timeline: readonly AgentTimelineEvent[];
}

// ---------------------------------------------------------------------------
// 版本引用（不可变快照；与处置域 fixture 同口径）
// ---------------------------------------------------------------------------

const MODEL_DEPLOYMENT_REF: VersionRef = { entityId: 'MDL-VDS-001', versionId: 'v2026.08' };

/** 偏差记录（处置域 fixture DEV-2026-001 · v1.0）。 */
const DEVIATION_RECORD_REF: VersionRef = { entityId: 'DEV-2026-001', versionId: 'v1.0' };

// ---------------------------------------------------------------------------
// 五个 Agent 任务（覆盖五类必经内嵌任务类型 + 交互任务）
// ---------------------------------------------------------------------------

export const AGENT_TASKS: readonly AgentTaskView[] = [
  {
    ref: {
      reference: { entityId: 'AGT-001', versionId: 'v1' },
      taskType: 'calibration-suggestion',
      triggerMode: 'embedded',
      modelDeploymentRef: MODEL_DEPLOYMENT_REF,
      promptTemplateRef: { entityId: 'PT-CAL-001', versionId: 'v2026.08' },
      toolPolicyRef: { entityId: 'TP-CAL-001', versionId: 'v2026.08' },
      budgetPolicyRef: { entityId: 'BP-CAL-001', versionId: 'v2026.08' },
      incrementSchemaRef: { entityId: 'ISC-CAL-001', versionId: 'v2026.08' },
      validationPolicyRef: { entityId: 'CVP-001', versionId: 'v2026.08' },
    },
    status: 'completed',
    initiatorLabel: '系统（偏差记录 DEV-2026-001 判定超限触发）',
    initiatorActorId: 'system',
    projectLabel: '示例工程 · 站隧一体化标',
    projectId: 'PRJ-001',
    parentRunRef: { entityId: 'WFR-2026-029', versionId: 'v1' },
    parentRunLabel: '处置反馈工作流运行',
    frozenInputKindLabel: '偏差记录',
    frozenInputRef: DEVIATION_RECORD_REF,
    startedAt: '2026-08-29T16:28:00+08:00',
    completedAt: '2026-08-29T16:32:00+08:00',
    idempotencyKey: 'AGT-START-20260829-CAL-001',
    summary:
      '针对偏差记录 DEV-2026-001（偏差值 1.0 超过冻结阈值 0.5）生成校准建议候选：修订评分规则 RULE-EXPAND-02 分档得分',
    toolActions: [
      {
        actionId: 'ACT-001-01',
        toolName: 'deviation-record.read',
        toolLabel: '偏差记录读取',
        summary: '读取偏差记录 DEV-2026-001 · v1.0 及预测 / 实测风险状态',
        outcome: 'succeeded',
        note: '白名单内工具',
      },
      {
        actionId: 'ACT-001-02',
        toolName: 'knowledge.scoring-rule.read',
        toolLabel: '评分规则读取',
        summary: '读取结构化评分规则 RULE-EXPAND-02 · v1.3 分档定义',
        outcome: 'succeeded',
        note: '白名单内工具',
      },
      {
        actionId: 'ACT-001-03',
        toolName: 'knowledge.rule-set.read',
        toolLabel: '适用规则集读取',
        summary: '读取适用规则集 RS-VDS-EXPAND · v2026.09.1 成员规则',
        outcome: 'succeeded',
        note: '白名单内工具',
      },
      {
        actionId: 'ACT-001-04',
        toolName: 'monitoring.snapshot.read',
        toolLabel: '监测快照读取',
        summary: '读取处置后监测快照 SNAP-MON-20260829-1600 · v1 实测指标',
        outcome: 'succeeded',
        note: '白名单内工具',
      },
      {
        actionId: 'ACT-001-05',
        toolName: 'knowledge.case.query',
        toolLabel: '案例检索',
        summary: '检索类比案例 CASE-2023-001（注浆参数调整后沉降回落）',
        outcome: 'succeeded',
        note: '白名单内工具',
      },
      {
        actionId: 'ACT-001-06',
        toolName: 'generic-sql.query',
        toolLabel: '通用数据库查询',
        summary: '尝试直接查询规则库底层存储',
        outcome: 'blocked',
        note: '不在工具策略 TP-CAL-001 · v2026.08 白名单内，已拦截未执行',
      },
    ],
    increments: [
      {
        incrementItemId: 'INC-001-01',
        operationType: 'propose-scoring-rule-calibration',
        summary:
          '评分规则 RULE-EXPAND-02 分档区间 1.4–2.0 mm/d 的得分由 3 调整为 2（由注浆压力恢复主导的回落区间）',
        decision: 'accepted',
        reason: '校验通过：操作类型属于本任务类型化增量范围，目标规则在适用规则集 RS-VDS-EXPAND · v2026.09.1 内',
      },
      {
        incrementItemId: 'INC-001-02',
        operationType: 'propose-weight-adjustment',
        summary: '同步调整权重集 WSET-VDS-001 中地表沉降短期斜率权重',
        decision: 'rejected',
        reason: '拒绝：权重调整超出校准建议任务的类型化增量范围（仅允许评分规则分档修订候选），不得以循环尝试绕过',
      },
    ],
    budget: {
      tokensUsed: 18240,
      tokensLimit: 60000,
      toolCallsUsed: 6,
      toolCallsLimit: 20,
      candidatesUsed: 2,
      candidatesLimit: 5,
      wallClockSeconds: 214,
      wallClockLimitSeconds: 600,
    },
    outcome: {
      candidateRef: { entityId: 'CAL-2026-001', versionId: 'v1.0' },
      candidateLabel: '校准建议候选',
      candidateHref: '#/response/calibrations/CAL-2026-001',
      validationRef: { entityId: 'VS-2026-014', versionId: 'v1' },
      formalResultNote:
        '确定性校验通过后入库为校准建议 CAL-2026-001 · v1.0 并创建复核任务 RVT-2026-001 · v1；校准生效必须人工确认，系统不自动修改规则、权重、阈值或矩阵版本',
    },
    failure: null,
    waitingNote: null,
    timeline: [
      { at: '2026-08-29 16:20', actorLabel: '系统', action: '偏差记录 DEV-2026-001 判定超限' },
      { at: '2026-08-29 16:28', actorLabel: '系统', action: '校准建议 Agent 任务 AGT-001 启动（内嵌触发）' },
      { at: '2026-08-29 16:32', actorLabel: '系统', action: '候选产出，确定性校验逐项完成（接受 1 项、拒绝 1 项）' },
      { at: '2026-08-29 16:35', actorLabel: '系统', action: '校准建议 CAL-2026-001 入库并创建复核任务 RVT-2026-001' },
    ],
  },
  {
    ref: {
      reference: { entityId: 'AGT-002', versionId: 'v1' },
      taskType: 'retrieval-review',
      triggerMode: 'embedded',
      modelDeploymentRef: MODEL_DEPLOYMENT_REF,
      promptTemplateRef: { entityId: 'PT-RR-001', versionId: 'v2026.08' },
      toolPolicyRef: { entityId: 'TP-RR-001', versionId: 'v2026.08' },
      budgetPolicyRef: { entityId: 'BP-RR-001', versionId: 'v2026.08' },
      incrementSchemaRef: { entityId: 'ISC-RR-001', versionId: 'v2026.08' },
      validationPolicyRef: { entityId: 'RVP-ID-001', versionId: 'v2026.08' },
    },
    status: 'completed',
    initiatorLabel: '系统（识别运行 RUN-20260827-001 检索阶段触发）',
    initiatorActorId: 'system',
    projectLabel: '示例工程 · 站隧一体化标',
    projectId: 'PRJ-001',
    parentRunRef: { entityId: 'RUN-20260827-001', versionId: 'v1' },
    parentRunLabel: '风险识别运行',
    frozenInputKindLabel: '识别工作项',
    frozenInputRef: { entityId: 'IWI-20260827-004', versionId: 'v1' },
    startedAt: '2026-08-27T08:41:00+08:00',
    completedAt: '2026-08-27T08:44:00+08:00',
    idempotencyKey: 'AGT-START-20260827-RR-002',
    summary:
      '识别检索审阅与有界补搜：工序节点 PN-VDS-04 扩挖段的机理条目检索证据不足，按任务边界完成一轮有界补搜',
    toolActions: [
      {
        actionId: 'ACT-002-01',
        toolName: 'knowledge.hybrid-evidence.query',
        toolLabel: '混合证据检索',
        summary: '向量库 + BM25 双索引检索机理条目 MEC-VDS-017 相关证据',
        outcome: 'succeeded',
        note: '白名单内工具',
      },
      {
        actionId: 'ACT-002-02',
        toolName: 'source.segment.read',
        toolLabel: '资料段读取',
        summary: '补搜资料段 DOC2026001-S32-SEG007 原文片段',
        outcome: 'succeeded',
        note: '白名单内工具',
      },
    ],
    increments: [
      {
        incrementItemId: 'INC-002-01',
        operationType: 'append-retrieval-evidence',
        summary: '补搜证据 2 条并入检索工件集（资料段 DOC2026001-S32-SEG007）',
        decision: 'accepted',
        reason: '校验通过：证据引用齐备，来源资料段在已授权访问范围内',
      },
    ],
    budget: {
      tokensUsed: 9640,
      tokensLimit: 40000,
      toolCallsUsed: 2,
      toolCallsLimit: 10,
      candidatesUsed: 1,
      candidatesLimit: 3,
      wallClockSeconds: 168,
      wallClockLimitSeconds: 300,
    },
    outcome: {
      candidateRef: { entityId: 'RAS-2026-004', versionId: 'v1' },
      candidateLabel: '检索工件集增量',
      candidateHref: '#/identification/runs/RUN-20260827-001',
      validationRef: { entityId: 'VS-2026-009', versionId: 'v1' },
      formalResultNote: '检索增量按确定性收口自动生效，并入识别运行 RUN-20260827-001 的检索工件集',
    },
    failure: null,
    waitingNote: null,
    timeline: [
      { at: '2026-08-27 08:41', actorLabel: '系统', action: '检索审阅 Agent 任务 AGT-002 启动（内嵌触发）' },
      { at: '2026-08-27 08:44', actorLabel: '系统', action: '有界补搜完成，检索增量生效' },
    ],
  },
  {
    ref: {
      reference: { entityId: 'AGT-003', versionId: 'v1' },
      taskType: 'response-recommendation',
      triggerMode: 'embedded',
      modelDeploymentRef: MODEL_DEPLOYMENT_REF,
      promptTemplateRef: { entityId: 'PT-RSP-001', versionId: 'v2026.08' },
      toolPolicyRef: { entityId: 'TP-RSP-001', versionId: 'v2026.08' },
      budgetPolicyRef: { entityId: 'BP-RSP-001', versionId: 'v2026.08' },
      incrementSchemaRef: { entityId: 'ISC-RSP-001', versionId: 'v2026.08' },
      validationPolicyRef: { entityId: 'RVP-001', versionId: 'v2026.08' },
    },
    status: 'completed',
    initiatorLabel: '系统（预警处置任务 WRT-2026-001 开立触发）',
    initiatorActorId: 'system',
    projectLabel: '示例工程 · 站隧一体化标',
    projectId: 'PRJ-001',
    parentRunRef: { entityId: 'WFR-2026-027', versionId: 'v1' },
    parentRunLabel: '处置建议工作流运行',
    frozenInputKindLabel: '预警处置任务',
    frozenInputRef: { entityId: 'WRT-2026-001', versionId: 'v1' },
    startedAt: '2026-08-27T09:40:00+08:00',
    completedAt: '2026-08-27T09:44:00+08:00',
    idempotencyKey: 'AGT-START-20260827-RSP-003',
    summary:
      '处置建议组合排序：对措施库检索候选作约束组合与排序，产出处置建议候选 RC-2026-001',
    toolActions: [
      {
        actionId: 'ACT-003-01',
        toolName: 'knowledge.measure-candidates.query',
        toolLabel: '措施候选检索',
        summary: '按评估记录 ASSESS-2026-001 与处置任务检索措施库 MSL-VDS-001 · v2026.08 候选',
        outcome: 'succeeded',
        note: '白名单内工具',
      },
      {
        actionId: 'ACT-003-02',
        toolName: 'site-context.read',
        toolLabel: '现场条件读取',
        summary: '读取现场条件快照 SITE-CTX-2026-08 · v2026.08',
        outcome: 'succeeded',
        note: '白名单内工具',
      },
    ],
    increments: [
      {
        incrementItemId: 'INC-003-01',
        operationType: 'propose-response-candidate',
        summary:
          '候选 RC-2026-001：先控制作业节奏与参数恢复，再结构核查加固，最后监测加密（4 项措施）',
        decision: 'accepted',
        reason: '校验通过：措施均来自措施库当前生效版本，排序依据由处置生成策略 RGP-001 · v2026.08 给出',
      },
    ],
    budget: {
      tokensUsed: 12110,
      tokensLimit: 50000,
      toolCallsUsed: 2,
      toolCallsLimit: 12,
      candidatesUsed: 1,
      candidatesLimit: 4,
      wallClockSeconds: 232,
      wallClockLimitSeconds: 480,
    },
    outcome: {
      candidateRef: { entityId: 'RC-2026-001', versionId: 'v1' },
      candidateLabel: '处置建议候选',
      candidateHref: '#/response/recommendations/RESP-2026-001',
      validationRef: { entityId: 'VS-2026-011', versionId: 'v1' },
      formalResultNote:
        '三项校验通过后入库为处置建议 RESP-2026-001 · v1.0 成为正式建议；采纳与执行由人决定',
    },
    failure: null,
    waitingNote: null,
    timeline: [
      { at: '2026-08-27 09:22', actorLabel: '系统', action: '预警 WARN-2026-001 入库并开立处置任务 WRT-2026-001' },
      { at: '2026-08-27 09:40', actorLabel: '系统', action: '处置建议 Agent 任务 AGT-003 启动（内嵌触发）' },
      { at: '2026-08-27 09:44', actorLabel: '系统', action: '候选 RC-2026-001 产出并进入三项校验' },
    ],
  },
  {
    ref: {
      reference: { entityId: 'AGT-004', versionId: 'v1' },
      taskType: 'data-cleaning',
      triggerMode: 'embedded',
      modelDeploymentRef: MODEL_DEPLOYMENT_REF,
      promptTemplateRef: { entityId: 'PT-DC-001', versionId: 'v2026.08' },
      toolPolicyRef: { entityId: 'TP-DC-001', versionId: 'v2026.08' },
      budgetPolicyRef: { entityId: 'BP-DC-001', versionId: 'v2026.08' },
      incrementSchemaRef: { entityId: 'ISC-DC-001', versionId: 'v2026.08' },
      validationPolicyRef: { entityId: 'DQP-001', versionId: 'v2026.08' },
    },
    status: 'failed',
    initiatorLabel: '系统（监测批次 MON-BATCH-2026-0829 登记触发）',
    initiatorActorId: 'system',
    projectLabel: '示例工程 · 站隧一体化标',
    projectId: 'PRJ-001',
    parentRunRef: { entityId: 'WFR-2026-030', versionId: 'v1' },
    parentRunLabel: '监测数据接入工作流运行',
    frozenInputKindLabel: '监测批次',
    frozenInputRef: { entityId: 'MON-BATCH-2026-0829', versionId: 'v2026.08' },
    startedAt: '2026-08-30T09:05:00+08:00',
    completedAt: null,
    idempotencyKey: 'AGT-START-20260830-DC-004',
    summary:
      '数据清洗与部分可用判断：监测批次 MON-BATCH-2026-0829 两条序列字段映射缺失，清洗中断',
    toolActions: [
      {
        actionId: 'ACT-004-01',
        toolName: 'monitoring.batch.read',
        toolLabel: '监测批次读取',
        summary: '读取监测批次样本工件与字段映射',
        outcome: 'succeeded',
        note: '白名单内工具',
      },
      {
        actionId: 'ACT-004-02',
        toolName: 'indicator.field-mapping.read',
        toolLabel: '指标字段映射读取',
        summary: '读取指标字段映射版本，两条序列无映射条目',
        outcome: 'succeeded',
        note: '白名单内工具',
      },
    ],
    increments: [],
    budget: {
      tokensUsed: 3120,
      tokensLimit: 30000,
      toolCallsUsed: 2,
      toolCallsLimit: 8,
      candidatesUsed: 0,
      candidatesLimit: 2,
      wallClockSeconds: 96,
      wallClockLimitSeconds: 240,
    },
    outcome: null,
    failure: {
      errorCode: 'TRANSIENT_FAILURE',
      retryable: true,
      stageCode: 'data-cleaning',
      occurredAt: '2026-08-30T09:12:00+08:00',
      errorRef: { entityId: 'WERR-2026-007', versionId: 'v1' },
      diagnosticRef: { entityId: 'DIA-2026-007', versionId: 'v1' },
      summary:
        '两条监测序列缺少指标字段映射，清洗在部分可用判断阶段中断；失败不静默跳过，可在映射补齐后按原预算恢复任务',
    },
    waitingNote: null,
    timeline: [
      { at: '2026-08-30 09:05', actorLabel: '系统', action: '数据清洗 Agent 任务 AGT-004 启动（内嵌触发）' },
      { at: '2026-08-30 09:12', actorLabel: '系统', action: '字段映射缺失，任务失败（可重试），诊断工件 DIA-2026-007 归档' },
    ],
  },
  {
    ref: {
      reference: { entityId: 'AGT-005', versionId: 'v1' },
      taskType: 'knowledge-authoring',
      triggerMode: 'interactive',
      modelDeploymentRef: MODEL_DEPLOYMENT_REF,
      promptTemplateRef: { entityId: 'PT-KA-001', versionId: 'v2026.08' },
      toolPolicyRef: { entityId: 'TP-KA-001', versionId: 'v2026.08' },
      budgetPolicyRef: { entityId: 'BP-KA-001', versionId: 'v2026.08' },
      incrementSchemaRef: { entityId: 'ISC-KA-001', versionId: 'v2026.08' },
      validationPolicyRef: { entityId: 'KVP-001', versionId: 'v2026.08' },
    },
    status: 'waiting',
    initiatorLabel: '项目风险负责人',
    initiatorActorId: 'U-PRM-001',
    projectLabel: '示例工程 · 站隧一体化标',
    projectId: 'PRJ-001',
    parentRunRef: { entityId: 'WFR-2026-031', versionId: 'v1' },
    parentRunLabel: '交互会话工作流运行',
    frozenInputKindLabel: '资料段',
    frozenInputRef: { entityId: 'DOC2026001-S32-SEG007', versionId: 'v1.0' },
    startedAt: '2026-09-18T14:02:00+08:00',
    completedAt: null,
    idempotencyKey: 'AGT-START-20260918-KA-005',
    summary:
      '非结构化知识编制：依据资料段 DOC2026001-S32-SEG007 为机理条目 MEC-VDS-017 起草证据补强修订，待用户确认提交',
    toolActions: [
      {
        actionId: 'ACT-005-01',
        toolName: 'source.segment.read',
        toolLabel: '资料段读取',
        summary: '读取资料段 DOC2026001-S32-SEG007（DOC2026001 · v1.0）',
        outcome: 'succeeded',
        note: '白名单内工具',
      },
      {
        actionId: 'ACT-005-02',
        toolName: 'knowledge.mechanism.read',
        toolLabel: '机理条目读取',
        summary: '读取机理条目 MEC-VDS-017 当前生效版本',
        outcome: 'succeeded',
        note: '白名单内工具',
      },
    ],
    increments: [
      {
        incrementItemId: 'INC-005-01',
        operationType: 'propose-knowledge-revision-draft',
        summary: '机理条目 MEC-VDS-017 修订草稿：补充资料段证据与诱发条件描述',
        decision: 'accepted',
        reason: '校验通过：草稿引用资料段齐备，未触碰已发布定义',
      },
    ],
    budget: {
      tokensUsed: 7480,
      tokensLimit: 40000,
      toolCallsUsed: 2,
      toolCallsLimit: 10,
      candidatesUsed: 1,
      candidatesLimit: 3,
      wallClockSeconds: 305,
      wallClockLimitSeconds: 900,
    },
    outcome: null,
    failure: null,
    waitingNote: '等待用户确认写命令 CP-2026-003（提交知识修订草稿）；确认前不提交',
    timeline: [
      { at: '2026-09-18 14:02', actorLabel: '项目风险负责人', action: '发起交互任务 AGT-005' },
      { at: '2026-09-18 14:07', actorLabel: '系统', action: '修订草稿候选产出并通过确定性校验' },
      { at: '2026-09-18 14:07', actorLabel: '系统', action: '写命令 CP-2026-003 进入待确认，任务等待用户确认' },
    ],
  },
];

export function agentTaskById(taskId: string): AgentTaskView | undefined {
  return AGENT_TASKS.find((task) => task.ref.reference.entityId === taskId);
}

// ---------------------------------------------------------------------------
// 会话消息流与待确认命令（P-AG-01 停靠栏 / P-AG-02 全屏工作台共用）
// ---------------------------------------------------------------------------

export type AgentMessageKind = 'user' | 'agent' | 'system';

export interface AgentMessageView {
  readonly messageId: string;
  readonly kind: AgentMessageKind;
  readonly at: string;
  readonly actorLabel: string;
  readonly text: string;
  readonly relatedTaskId: string | null;
}

export const AGENT_SESSION_MESSAGES: readonly AgentMessageView[] = [
  {
    messageId: 'MSG-001',
    kind: 'system',
    at: '2026-09-18 14:02',
    actorLabel: '系统',
    text: '交互 Agent 任务 AGT-005 已按统一任务契约创建：发起者、工程、输入版本、模型与提示模板、工具策略、资源预算均已固定。',
    relatedTaskId: 'AGT-005',
  },
  {
    messageId: 'MSG-002',
    kind: 'user',
    at: '2026-09-18 14:02',
    actorLabel: '项目风险负责人',
    text: '依据资料段 DOC2026001-S32-SEG007，为机理条目 MEC-VDS-017 起草一份证据补强修订。',
    relatedTaskId: 'AGT-005',
  },
  {
    messageId: 'MSG-003',
    kind: 'agent',
    at: '2026-09-18 14:07',
    actorLabel: 'Agent（知识编制）',
    text: '已读取资料段与机理条目当前生效版本，起草修订草稿：补充诱发条件描述与资料段证据引用。草稿通过确定性校验，未触碰已发布定义。',
    relatedTaskId: 'AGT-005',
  },
  {
    messageId: 'MSG-004',
    kind: 'agent',
    at: '2026-09-18 14:07',
    actorLabel: 'Agent（知识编制）',
    text: '提交该修订草稿需要执行写命令「提交知识修订」。按约定，写命令提交前必须由你确认；确认后草稿进入知识治理审核与发布流程。',
    relatedTaskId: 'AGT-005',
  },
  {
    messageId: 'MSG-005',
    kind: 'system',
    at: '2026-08-29 16:35',
    actorLabel: '系统',
    text: '校准建议 Agent 任务 AGT-001 已完成：候选经确定性校验入库为 CAL-2026-001，复核任务 RVT-2026-001 待复核。',
    relatedTaskId: 'AGT-001',
  },
];

/** 待确认写命令（对齐 CommandProposalRefV1 + confirm-command 命令语义）。 */
export interface PendingCommandView {
  readonly proposalRef: VersionRef;
  readonly agentTaskId: string;
  readonly commandKindLabel: string;
  readonly summary: string;
  readonly targetRef: VersionRef;
  readonly state: 'pending';
}

export const PENDING_COMMANDS: readonly PendingCommandView[] = [
  {
    proposalRef: { entityId: 'CP-2026-003', versionId: 'v1' },
    agentTaskId: 'AGT-005',
    commandKindLabel: '提交知识修订',
    summary: '提交机理条目 MEC-VDS-017 证据补强修订草稿，进入知识治理审核',
    targetRef: { entityId: 'KREV-DRAFT-2026-011', versionId: 'v1' },
    state: 'pending',
  },
];

/** 当前会话聚焦任务（停靠栏与工作台的任务摘要头部）。 */
export const ACTIVE_SESSION_TASK_ID = 'AGT-005';

// ---------------------------------------------------------------------------
// 深链（hash 路由；参数化目标用具体标识）
// ---------------------------------------------------------------------------

export const AGENT_LINKS = {
  dock: '#/agent/dock',
  workbench: '#/agent',
  taskDetail: (taskId: string) => `#/agent/tasks/${taskId}`,
  responseCalibration: (suggestionId: string) => `#/response/calibrations/${suggestionId}`,
  responseRecommendation: (recommendationId: string) =>
    `#/response/recommendations/${recommendationId}`,
  responseFeedback: (feedbackId: string) => `#/response/feedback/${feedbackId}`,
  identificationRun: (runId: string) => `#/identification/runs/${runId}`,
  knowledgeMechanisms: '#/knowledge/mechanisms',
  knowledgeRuleSets: '#/knowledge/rule-sets',
  reviewTask: (reviewTaskId: string) => `#/review-audit/reviews/${reviewTaskId}`,
  evidenceTrace: '#/review-audit/trace',
} as const;
