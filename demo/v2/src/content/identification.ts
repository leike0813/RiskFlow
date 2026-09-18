// 风险识别域 fixtures（P-RI，C33）。
// 字段形状以 packages/contracts 为准（G2 校正已落实）：
// - 标准化风险记录：records/index.ts:38-59（StandardizedRiskRecordSchema /
//   StandardizedRiskRecordEnvelopeSchema / CompositeConfidenceSchema { value, basis }）；
// - 风险要素关系三元组：records/index.ts:17-24（RiskElementRelationSchema，
//   契约字段名 sourceElement / relation / targetElement；PAGE-GUIDE §3 的
//   subject/predicate/object 是三元组概念描述，命名差异见 gap-inbox）；
// - 风险输入标识：records/index.ts:171-185（riskRecordId 与 externalRiskEventId
//   二选一且仅一个的判别联合），本域以判别联合类型落实；
// - 识别运行：workflows/index.ts:220-328（I0–I9 阶段契约与阶段结果引用）；
// - 触发方式：ports/index.ts:1596-1602（WorkflowRunTriggerTypeV1 四值）。
// 跨域标识沿典范追溯链：DOC2026001 → DOC2026001-S32-SEG007 → PN-VDS-04 →
// MEC-VDS-017 → RISK-2026-001 → RUN-A-2026-001 / ASSESS-2026-001 →
// WARN-2026-001 → RESP-2026-001；识别运行 RUN-20260827-001。
// RISK-2026-001～004 的事件文本、综合置信度与下游评估引用对齐第一波
// content/assessment.ts 的 PENDING_RISKS / ASSESSMENT_RECORDS；资料版本对齐
// content/project.ts 的资料登记（DOC2026001 · v2026.06）。warning.ts 与
// assessment.ts 之间的跨域漂移已登记 gap-inbox，不在本域fixture内消化。

/** 版本引用（对齐 contracts VersionReferenceSchema）。 */
export interface VersionRef {
  readonly entityId: string;
  readonly versionId: string;
}

/** 证据引用（对齐 contracts EvidenceReferenceSchema）。 */
export interface EvidenceRef {
  readonly locator: { readonly sourceSegmentId: string };
  readonly sourceVersion: VersionRef;
}

/** 审计信息（对齐 contracts AuditInfoSchema）。 */
export interface AuditInfo {
  readonly actorId: string;
  readonly action: string;
  readonly recordedAt: string;
  readonly reason?: string;
}

/** 版本化记录信息（对齐 contracts VersionedRecordInfoSchema）。 */
export interface VersionedRecordInfo {
  readonly reference: VersionRef;
  readonly effectivePeriod: { readonly validFrom: string; readonly validTo?: string };
  readonly systemTime: { readonly recordedAt: string; readonly supersededAt?: string };
}

// ---------------------------------------------------------------------------
// 识别依据版本（识别输入快照锁定的不可变版本；页面呈现「类别 entityId · versionId」）
// 工序模型与机理库版本与 content/knowledge.ts 的发布引用一致。
// ---------------------------------------------------------------------------

export const IDENTIFICATION_BASIS_VERSIONS = {
  processModelRelease: { entityId: 'PM-VDS', versionId: 'v2026.08' },
  riskMechanismRelease: { entityId: 'MEC-LIB-VDS', versionId: 'v2026.08' },
  retrievalEvidenceBaseRelease: { entityId: 'REB-VDS-001', versionId: 'v2026.08' },
  identificationPolicySet: { entityId: 'IDP-VDS-001', versionId: 'v2026.08' },
  promptTemplate: { entityId: 'PT-RI-001', versionId: 'v2026.08' },
  modelDeployment: { entityId: 'MDL-RI-001', versionId: 'v2026.06' },
} as const satisfies Readonly<Record<string, VersionRef>>;

export const IDENTIFICATION_BASIS_LABELS: Readonly<
  Record<keyof typeof IDENTIFICATION_BASIS_VERSIONS, string>
> = {
  processModelRelease: '项目工序模型',
  riskMechanismRelease: '风险机理库',
  retrievalEvidenceBaseRelease: '检索证据基座',
  identificationPolicySet: '识别策略集',
  promptTemplate: '提示模板',
  modelDeployment: '模型部署',
};

// ---------------------------------------------------------------------------
// 识别运行（C 骨架：头部七字段 + I0–I9 阶段条 + 子任务表 + 结果汇总）
// ---------------------------------------------------------------------------

export type IdentificationStageId =
  | 'I0'
  | 'I1'
  | 'I2'
  | 'I3'
  | 'I4'
  | 'I5'
  | 'I6'
  | 'I7'
  | 'I8'
  | 'I9';

/** 阶段语义对齐契约阶段结果引用（workflows/index.ts:269-327）。 */
export const IDENTIFICATION_STAGE_LABELS: Readonly<Record<IdentificationStageId, string>> = {
  I0: '识别准备快照组装',
  I1: '识别输入冻结',
  I2: '识别工作计划生成',
  I3: '检索与有界补搜',
  I4: '机理驱动推理与候选生成',
  I5: '候选校验与复核',
  I6: '候选合并',
  I7: '验收路由',
  I8: '标准化风险记录入库',
  I9: '运行结果汇总',
};

export const IDENTIFICATION_STAGE_IDS: readonly IdentificationStageId[] = [
  'I0',
  'I1',
  'I2',
  'I3',
  'I4',
  'I5',
  'I6',
  'I7',
  'I8',
  'I9',
];

/** 运行触发方式（对齐 WorkflowRunTriggerTypeV1 四值）。 */
export type RunTriggerType = 'manual' | 'domain-event' | 'scheduled' | 'resume';

export const RUN_TRIGGER_TYPE_LABELS: Readonly<Record<RunTriggerType, string>> = {
  manual: '手动启动',
  'domain-event': '领域事件触发',
  scheduled: '定时触发',
  resume: '恢复运行',
};

/** 识别运行触发原因码（triggerReasonCode 为自由标识，页面给可读文案）。 */
export const IDENTIFICATION_TRIGGER_REASON_LABELS: Readonly<Record<string, string>> = {
  'initial-identification': '首次识别（资料与知识就绪后启动）',
  'source-delivery': '资料交付事件（新资料版本接入）',
  'monitoring-batch': '监测批次更新',
  'knowledge-release': '机理库或工序模型版本发布',
};

export type IdentificationRunStatus = 'completed' | 'running' | 'waiting' | 'terminal-failure';

export const RUN_STATUS_LABELS: Readonly<Record<IdentificationRunStatus, string>> = {
  completed: '已完成',
  running: '运行中',
  waiting: '等待中',
  'terminal-failure': '失败终止',
};

export type StageStatus = 'done' | 'active' | 'waiting' | 'pending' | 'failed';

export interface RunStageFixture {
  readonly stage: IdentificationStageId;
  readonly status: StageStatus;
  readonly summary?: string;
}

export interface RunSubtaskFixture {
  readonly id: string;
  readonly stage: IdentificationStageId;
  readonly name: string;
  readonly status: StageStatus;
  readonly duration?: string;
  readonly result?: string;
}

export interface IdentificationRunFixture {
  readonly runId: string;
  readonly status: IdentificationRunStatus;
  readonly currentStage: IdentificationStageId;
  readonly triggerType: RunTriggerType;
  readonly triggerReasonCode: string;
  readonly operatorId: string;
  readonly operatorName: string;
  readonly startedAt: string;
  readonly idempotencyKey: string;
  readonly stages: readonly RunStageFixture[];
  readonly subtasks: readonly RunSubtaskFixture[];
  /** 等待中运行的等待原因（waiting 语义对应 I1 等待知识就绪等）。 */
  readonly waitingReason?: string;
  readonly outputs: {
    readonly acceptedRiskRecordIds: readonly string[];
  };
  readonly summary: {
    readonly plannedWorkItemCount: number;
    readonly excludedWorkItemCount: number;
    readonly candidateCount: number;
    readonly validatedCandidateCount: number;
    readonly acceptedRecordCount: number;
  };
}

function stagesUpTo(currentIndex: number, waitingAt?: number): readonly RunStageFixture[] {
  return IDENTIFICATION_STAGE_IDS.map((stage, index) => {
    let status: StageStatus = 'pending';
    if (index < currentIndex) status = 'done';
    else if (index === currentIndex) status = waitingAt === index ? 'waiting' : 'active';
    return { stage, status };
  });
}

const ALL_STAGES_DONE: readonly RunStageFixture[] = IDENTIFICATION_STAGE_IDS.map((stage) => ({
  stage,
  status: 'done' as const,
}));

export const IDENTIFICATION_RUNS: readonly IdentificationRunFixture[] = [
  {
    runId: 'RUN-20260827-001',
    status: 'completed',
    currentStage: 'I9',
    triggerType: 'manual',
    triggerReasonCode: 'initial-identification',
    operatorId: 'ACCT-001',
    operatorName: '张工',
    startedAt: '2026-08-27T08:31:00+08:00',
    idempotencyKey: 'IDEMP-I-20260827-0001',
    stages: ALL_STAGES_DONE,
    subtasks: [
      { id: 'ST-I-001', stage: 'I0', name: '识别准备快照组装', status: 'done', duration: '4 s', result: '准备快照 SNAP-I-20260827-001' },
      { id: 'ST-I-002', stage: 'I1', name: '识别输入冻结', status: 'done', duration: '1 s', result: '输入快照 SNAP-I-20260827-002' },
      { id: 'ST-I-003', stage: 'I2', name: '识别工作计划生成', status: 'done', duration: '3 s', result: '计划工作项 12 项，部分可用筛除 2 项' },
      { id: 'ST-I-004', stage: 'I3', name: '检索与有界补搜（含检索审阅任务）', status: 'done', duration: '126 s', result: '检索工件 3 组，审阅任务 2 项全部完成' },
      { id: 'ST-I-005', stage: 'I4', name: '机理驱动推理与候选生成', status: 'done', duration: '214 s', result: '风险候选 6 条' },
      { id: 'ST-I-006', stage: 'I5', name: '候选确定性校验与复核', status: 'done', duration: '58 s', result: '校验通过 5 条，1 条因证据不足退回' },
      { id: 'ST-I-007', stage: 'I6', name: '候选合并', status: 'done', duration: '6 s', result: '合并方案 4 组' },
      { id: 'ST-I-008', stage: 'I7', name: '验收路由', status: 'done', duration: '2 s', result: '自动验收 3 条，复核后验收 1 条' },
      { id: 'ST-I-009', stage: 'I8', name: '标准化风险记录入库', status: 'done', duration: '2 s', result: 'RISK-2026-001～004 入库' },
      { id: 'ST-I-010', stage: 'I9', name: '运行结果汇总', status: 'done', duration: '1 s', result: '结果汇总 RR-I-2026-001' },
    ],
    outputs: {
      acceptedRiskRecordIds: ['RISK-2026-001', 'RISK-2026-002', 'RISK-2026-003', 'RISK-2026-004'],
    },
    summary: {
      plannedWorkItemCount: 12,
      excludedWorkItemCount: 2,
      candidateCount: 6,
      validatedCandidateCount: 5,
      acceptedRecordCount: 4,
    },
  },
  {
    runId: 'RUN-20260918-001',
    status: 'running',
    currentStage: 'I4',
    triggerType: 'domain-event',
    triggerReasonCode: 'source-delivery',
    operatorId: 'ACCT-001',
    operatorName: '张工',
    startedAt: '2026-09-18T10:05:00+08:00',
    idempotencyKey: 'IDEMP-I-20260918-0001',
    stages: stagesUpTo(4),
    subtasks: [
      { id: 'ST-I-101', stage: 'I0', name: '识别准备快照组装（含 DOC2026005 补充交付）', status: 'done', duration: '5 s', result: '准备快照 SNAP-I-20260918-001' },
      { id: 'ST-I-102', stage: 'I1', name: '识别输入冻结', status: 'done', duration: '1 s', result: '输入快照 SNAP-I-20260918-002' },
      { id: 'ST-I-103', stage: 'I2', name: '识别工作计划生成', status: 'done', duration: '3 s', result: '计划工作项 4 项' },
      { id: 'ST-I-104', stage: 'I3', name: '检索与有界补搜', status: 'done', duration: '47 s', result: '检索工件 1 组' },
      { id: 'ST-I-105', stage: 'I4', name: '机理驱动推理与候选生成', status: 'active', result: '已生成候选 2 条' },
    ],
    outputs: { acceptedRiskRecordIds: [] },
    summary: {
      plannedWorkItemCount: 4,
      excludedWorkItemCount: 0,
      candidateCount: 2,
      validatedCandidateCount: 0,
      acceptedRecordCount: 0,
    },
  },
  {
    runId: 'RUN-20260918-002',
    status: 'waiting',
    currentStage: 'I1',
    triggerType: 'manual',
    triggerReasonCode: 'monitoring-batch',
    operatorId: 'ACCT-001',
    operatorName: '张工',
    startedAt: '2026-09-18T14:20:00+08:00',
    idempotencyKey: 'IDEMP-I-20260918-0002',
    stages: stagesUpTo(1, 1),
    waitingReason: '等待知识就绪：工序模型 v2026.09-review 尚在审核，输入冻结挂起',
    subtasks: [
      { id: 'ST-I-201', stage: 'I0', name: '识别准备快照组装', status: 'done', duration: '4 s', result: '准备快照 SNAP-I-20260918-003' },
      { id: 'ST-I-202', stage: 'I1', name: '识别输入冻结', status: 'waiting', result: '等待工序模型审核完成后冻结' },
    ],
    outputs: { acceptedRiskRecordIds: [] },
    summary: {
      plannedWorkItemCount: 0,
      excludedWorkItemCount: 0,
      candidateCount: 0,
      validatedCandidateCount: 0,
      acceptedRecordCount: 0,
    },
  },
];

export function identificationRunById(runId: string): IdentificationRunFixture | undefined {
  return IDENTIFICATION_RUNS.find((run) => run.runId === runId);
}

// ---------------------------------------------------------------------------
// 标准化风险记录（G2 校正：判别联合标识、compositeConfidence 对象、
// 三元组齐备、evidenceReferences 投影与 audit）
// ---------------------------------------------------------------------------

/** 风险输入标识：riskRecordId 与 externalRiskEventId 二选一且仅一个。 */
export type RiskRecordIdentity =
  | { readonly kind: 'standardized-risk-record'; readonly riskRecordId: string }
  | { readonly kind: 'external-risk-event'; readonly externalRiskEventId: string };

/** 风险要素关系三元组（对齐 RiskElementRelationSchema 字段名）。 */
export interface RiskElementRelation {
  readonly sourceElement: string;
  readonly relation: string;
  readonly targetElement: string;
}

/** 标准化风险记录本体（对齐 StandardizedRiskRecordSchema）。 */
export interface StandardizedRiskRecord {
  readonly processNodeId: string;
  readonly riskSource: string;
  readonly riskFactor: string;
  readonly riskEvent: string;
  readonly riskElementRelations: readonly RiskElementRelation[];
  readonly evidenceLocator: { readonly sourceSegmentId: string };
  readonly modelConfidence: number;
}

/** 验收路由方式（I7 输出，展示用）。 */
export type AcceptanceRoute = 'auto' | 'review';

export const ACCEPTANCE_ROUTE_LABELS: Readonly<Record<AcceptanceRoute, string>> = {
  auto: '自动验收入库',
  review: '复核后验收入库',
};

/**
 * 标准化风险记录视图：契约封套字段 + 页面展示投影。
 * evidenceReferences 为展示投影：由 record.evidenceLocator 与 sourceIds 对应
 * 资料版本展开（封套本身不存该字段，见 gap-inbox GAP-RI-02）。
 */
export interface RiskRecordView {
  readonly identity: RiskRecordIdentity;
  readonly record: StandardizedRiskRecord;
  readonly riskMechanismEntryIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly compositeConfidence: { readonly value: number; readonly basis: readonly string[] };
  readonly version: VersionedRecordInfo;
  readonly audit: AuditInfo;
  readonly evidenceReferences: readonly EvidenceRef[];
  /** 展示补充：工序节点名称、验收路由、来源识别运行与下游追溯引用。 */
  readonly processNodeName: string;
  readonly acceptanceRoute: AcceptanceRoute;
  readonly producedByRunId: string;
  readonly downstream: {
    readonly assessmentRecordIds: readonly string[];
    readonly activeAssessmentRunId: string | null;
    readonly warningResponseTaskId: string | null;
    readonly responseRecommendationId: string | null;
  };
}

/** 记录标识取值（判别联合二选一）。 */
export function riskRecordKey(view: RiskRecordView): string {
  return view.identity.kind === 'standardized-risk-record'
    ? view.identity.riskRecordId
    : view.identity.externalRiskEventId;
}

const DOC_SOURCE_VERSION: VersionRef = { entityId: 'DOC2026001', versionId: 'v2026.06' };
const GEO_SOURCE_VERSION: VersionRef = { entityId: 'DOC2026002', versionId: 'v2026.03' };
const MON_SOURCE_VERSION: VersionRef = { entityId: 'DOC2026003', versionId: 'v2026.08' };

function docEvidence(sourceSegmentId: string): EvidenceRef {
  return { locator: { sourceSegmentId }, sourceVersion: DOC_SOURCE_VERSION };
}

function geoEvidence(sourceSegmentId: string): EvidenceRef {
  return { locator: { sourceSegmentId }, sourceVersion: GEO_SOURCE_VERSION };
}

function monEvidence(sourceSegmentId: string): EvidenceRef {
  return { locator: { sourceSegmentId }, sourceVersion: MON_SOURCE_VERSION };
}

function recordVersion(recordId: string, recordedAt: string): VersionedRecordInfo {
  return {
    reference: { entityId: recordId, versionId: 'v1' },
    effectivePeriod: { validFrom: recordedAt },
    systemTime: { recordedAt },
  };
}

const RECORDED_AT = '2026-08-27T08:52:00+08:00';

export const RISK_RECORDS: readonly RiskRecordView[] = [
  {
    identity: { kind: 'standardized-risk-record', riskRecordId: 'RISK-2026-001' },
    record: {
      processNodeId: 'PN-VDS-04',
      riskSource: '富水软弱地层中的变径空间扩挖作业面',
      riskFactor: '支护闭合滞后、注浆压力偏低且地表沉降趋势加快',
      riskEvent: '变径空间扩挖引发过挖与地表沉降超限',
      riskElementRelations: [
        { sourceElement: '变径空间扩挖', relation: '伴生', targetElement: '支护闭合滞后' },
        { sourceElement: '支护闭合滞后', relation: '加剧', targetElement: '地层损失' },
        { sourceElement: '注浆压力偏低', relation: '加剧', targetElement: '地层损失' },
        { sourceElement: '地层损失', relation: '引发', targetElement: '地表沉降超限' },
      ],
      evidenceLocator: { sourceSegmentId: 'DOC2026001-S32-SEG007' },
      modelConfidence: 0.84,
    },
    riskMechanismEntryIds: ['MEC-VDS-017'],
    sourceIds: ['DOC2026001', 'DOC2026002', 'DOC2026003'],
    compositeConfidence: {
      value: 0.86,
      basis: ['模型推理置信度 0.84', '机理条目命中', '专家复核通过'],
    },
    version: recordVersion('RISK-2026-001', RECORDED_AT),
    audit: {
      actorId: 'ACCT-001',
      action: 'risk-identification.accept-groups',
      recordedAt: RECORDED_AT,
      reason: '验收路由：复核后验收入库',
    },
    evidenceReferences: [
      docEvidence('DOC2026001-S32-SEG007'),
      geoEvidence('DOC2026002-C04-SEG018'),
      monEvidence('DOC2026003-M001-SEG021'),
    ],
    processNodeName: '变径空间扩挖',
    acceptanceRoute: 'review',
    producedByRunId: 'RUN-20260827-001',
    downstream: {
      assessmentRecordIds: ['ASSESS-2026-001', 'ASSESS-2026-002'],
      activeAssessmentRunId: null,
      warningResponseTaskId: 'WRT-2026-001',
      responseRecommendationId: 'RESP-2026-001',
    },
  },
  {
    identity: { kind: 'standardized-risk-record', riskRecordId: 'RISK-2026-002' },
    record: {
      processNodeId: 'PN-VDS-04',
      riskSource: '变径空间扩挖段同步注浆体系',
      riskFactor: '注浆压力偏离生效区间、注浆量不足',
      riskEvent: '扩挖段同步注浆不密实导致地层损失',
      riskElementRelations: [
        { sourceElement: '变径空间扩挖', relation: '伴生', targetElement: '同步注浆不密实' },
        { sourceElement: '同步注浆不密实', relation: '引发', targetElement: '地层损失' },
        { sourceElement: '地层损失', relation: '加剧', targetElement: '地表沉降' },
      ],
      evidenceLocator: { sourceSegmentId: 'DOC2026001-S32-SEG015' },
      modelConfidence: 0.79,
    },
    riskMechanismEntryIds: ['MEC-VDS-017'],
    sourceIds: ['DOC2026001'],
    compositeConfidence: {
      value: 0.78,
      basis: ['模型推理置信度 0.79', '类比案例佐证'],
    },
    version: recordVersion('RISK-2026-002', RECORDED_AT),
    audit: {
      actorId: 'ACCT-001',
      action: 'risk-identification.accept-groups',
      recordedAt: RECORDED_AT,
      reason: '验收路由：自动验收入库',
    },
    evidenceReferences: [docEvidence('DOC2026001-S32-SEG015')],
    processNodeName: '变径空间扩挖',
    acceptanceRoute: 'auto',
    producedByRunId: 'RUN-20260827-001',
    downstream: {
      assessmentRecordIds: ['ASSESS-2026-003'],
      activeAssessmentRunId: null,
      warningResponseTaskId: null,
      responseRecommendationId: null,
    },
  },
  {
    identity: { kind: 'standardized-risk-record', riskRecordId: 'RISK-2026-003' },
    record: {
      processNodeId: 'PN-VDS-04',
      riskSource: '变径段扩挖临空面围护结构',
      riskFactor: '支护施作滞后于开挖进尺、钢管片拼装受力转换集中',
      riskEvent: '变径段围护结构变形超限',
      riskElementRelations: [
        { sourceElement: '变径空间扩挖', relation: '扰动', targetElement: '围护结构受力体系' },
        { sourceElement: '支护施作滞后', relation: '削弱', targetElement: '围护结构受力体系' },
        { sourceElement: '围护结构受力体系', relation: '恶化', targetElement: '围护结构变形超限' },
      ],
      evidenceLocator: { sourceSegmentId: 'DOC2026001-S32-SEG017' },
      modelConfidence: 0.83,
    },
    riskMechanismEntryIds: ['MEC-VDS-017'],
    sourceIds: ['DOC2026001', 'DOC2026003'],
    compositeConfidence: {
      value: 0.81,
      basis: ['模型推理置信度 0.83', '监测证据佐证'],
    },
    version: recordVersion('RISK-2026-003', RECORDED_AT),
    audit: {
      actorId: 'ACCT-001',
      action: 'risk-identification.accept-groups',
      recordedAt: RECORDED_AT,
      reason: '验收路由：自动验收入库',
    },
    evidenceReferences: [
      docEvidence('DOC2026001-S32-SEG017'),
      monEvidence('DOC2026003-M002-SEG035'),
    ],
    processNodeName: '变径空间扩挖',
    acceptanceRoute: 'auto',
    producedByRunId: 'RUN-20260827-001',
    downstream: {
      assessmentRecordIds: [],
      activeAssessmentRunId: 'RUN-A-2026-003',
      warningResponseTaskId: null,
      responseRecommendationId: null,
    },
  },
  {
    identity: { kind: 'standardized-risk-record', riskRecordId: 'RISK-2026-004' },
    record: {
      processNodeId: 'PN-VDS-04',
      riskSource: '富水砂层中的扩挖掌子面与支护间隙',
      riskFactor: '隔水层削薄、注浆压力低于生效区间',
      riskEvent: '富水地层扩挖涌水涌砂',
      riskElementRelations: [
        { sourceElement: '变径空间扩挖', relation: '扰动', targetElement: '富水砂层' },
        { sourceElement: '注浆压力偏低', relation: '诱发', targetElement: '渗流通道发育' },
        { sourceElement: '渗流通道发育', relation: '引发', targetElement: '涌水涌砂' },
      ],
      evidenceLocator: { sourceSegmentId: 'DOC2026001-S32-SEG019' },
      modelConfidence: 0.72,
    },
    riskMechanismEntryIds: ['MEC-VDS-017'],
    sourceIds: ['DOC2026001'],
    compositeConfidence: {
      value: 0.74,
      basis: ['模型推理置信度 0.72', '机理条目命中'],
    },
    version: recordVersion('RISK-2026-004', RECORDED_AT),
    audit: {
      actorId: 'ACCT-001',
      action: 'risk-identification.accept-groups',
      recordedAt: RECORDED_AT,
      reason: '验收路由：自动验收入库',
    },
    evidenceReferences: [docEvidence('DOC2026001-S32-SEG019')],
    processNodeName: '变径空间扩挖',
    acceptanceRoute: 'auto',
    producedByRunId: 'RUN-20260827-001',
    downstream: {
      assessmentRecordIds: [],
      activeAssessmentRunId: null,
      warningResponseTaskId: null,
      responseRecommendationId: null,
    },
  },
];

export function riskRecordById(recordId: string): RiskRecordView | undefined {
  return RISK_RECORDS.find((view) => riskRecordKey(view) === recordId);
}

export function riskRecordsByProcessNode(processNodeId: string): readonly RiskRecordView[] {
  return RISK_RECORDS.filter((view) => view.record.processNodeId === processNodeId);
}

// ---------------------------------------------------------------------------
// 工序风险关联图谱（P-RI-07）：节点/边与布局种子全部入 fixture，
// 同种子同布局、评审可复现；tone 'risk' 的边一律带 label（等级依据入图例）。
// ---------------------------------------------------------------------------

export const GRAPH_SEED = 20260827;

export interface GraphNodeFixture {
  readonly id: string;
  readonly label: string;
  readonly kind: '工序节点' | '机理条目' | '风险记录' | '资料段';
  readonly tone?: 'default' | 'active' | 'risk';
  readonly riskLevel?: 1 | 2 | 3 | 4;
}

export interface GraphEdgeFixture {
  readonly source: string;
  readonly target: string;
  readonly label: string;
  readonly tone?: 'default' | 'risk';
  readonly riskLevel?: 1 | 2 | 3 | 4;
}

export const GRAPH_NODES: readonly GraphNodeFixture[] = [
  { id: 'PN-VDS-01', label: '扩径准备', kind: '工序节点' },
  { id: 'PN-VDS-02', label: '刀盘扩径', kind: '工序节点' },
  { id: 'PN-VDS-03', label: '盾体扩径', kind: '工序节点' },
  { id: 'PN-VDS-04', label: '变径空间扩挖', kind: '工序节点', tone: 'active' },
  { id: 'PN-VDS-05', label: '缩径转换', kind: '工序节点' },
  { id: 'MEC-VDS-017', label: '过挖与地表沉降', kind: '机理条目' },
  { id: 'RISK-2026-001', label: 'RISK-2026-001', kind: '风险记录', tone: 'risk', riskLevel: 1 },
  { id: 'RISK-2026-002', label: 'RISK-2026-002', kind: '风险记录', tone: 'risk', riskLevel: 3 },
  { id: 'RISK-2026-003', label: 'RISK-2026-003', kind: '风险记录', tone: 'risk', riskLevel: 2 },
  { id: 'RISK-2026-004', label: 'RISK-2026-004', kind: '风险记录' },
  { id: 'DOC2026001-S32-SEG007', label: '资料段 SEG007', kind: '资料段' },
];

export const GRAPH_EDGES: readonly GraphEdgeFixture[] = [
  { source: 'MEC-VDS-017', target: 'PN-VDS-04', label: '适用工序' },
  { source: 'MEC-VDS-017', target: 'PN-VDS-02', label: '适用工序' },
  { source: 'PN-VDS-04', target: 'RISK-2026-001', label: '识别产出 · I 级', tone: 'risk', riskLevel: 1 },
  { source: 'PN-VDS-04', target: 'RISK-2026-002', label: '识别产出 · III 级', tone: 'risk', riskLevel: 3 },
  { source: 'PN-VDS-04', target: 'RISK-2026-003', label: '识别产出 · II 级', tone: 'risk', riskLevel: 2 },
  { source: 'PN-VDS-04', target: 'RISK-2026-004', label: '识别产出 · 待评估' },
  { source: 'RISK-2026-001', target: 'MEC-VDS-017', label: '机理命中' },
  { source: 'RISK-2026-002', target: 'MEC-VDS-017', label: '机理命中' },
  { source: 'RISK-2026-003', target: 'MEC-VDS-017', label: '机理命中' },
  { source: 'RISK-2026-004', target: 'MEC-VDS-017', label: '机理命中' },
  { source: 'DOC2026001-S32-SEG007', target: 'RISK-2026-001', label: '证据' },
];

// ---------------------------------------------------------------------------
// 深链（hash 路由；参数化目标用具体标识）
// ---------------------------------------------------------------------------

export const LINKS = {
  identificationRuns: '#/identification',
  identificationStart: '#/identification/start',
  identificationRun: (runId: string) => `#/identification/runs/${runId}`,
  identificationRecords: '#/identification/records',
  identificationRecord: (recordId: string) => `#/identification/records/${recordId}`,
  identificationProcessModel: '#/identification/process-model',
  graph: '#/identification/graph',
  knowledgeProcessModels: '#/knowledge/process-models',
  knowledgeMechanisms: '#/knowledge/mechanisms',
  projectSource: (sourceId: string) => `#/projects/sources/${sourceId}`,
  evidenceTrace: '#/review-audit/trace',
  assessmentRoot: '#/assessment',
  assessmentRun: (runId: string) => `#/assessment/runs/${runId}`,
  assessmentRecord: (recordId: string) => `#/assessment/records/${recordId}`,
  warningTask: (taskId: string) => `#/warnings/tasks/${taskId}`,
  responseRecommendation: (recommendationId: string) =>
    `#/response/recommendations/${recommendationId}`,
} as const;
