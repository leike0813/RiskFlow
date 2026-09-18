// 复核与审计域 fixtures（P-RV-01～P-RV-06，C33/C35）。
// 字段形状以 packages/contracts 为准：
// - 复核类型 / 复核目标引用 / 复核任务引用：packages/contracts/src/ports/index.ts
//   ReviewTypeV1Schema（:285-292）、ReviewTargetRefV1Schema（:294-303）、
//   ReviewTaskRefV1Schema（:336-363）；
// - 复核任务状态：packages/core/src/review-audit/schema.ts
//   ReviewTaskStateV1Schema（status: pending / decided / superseded）；
// - 复核决定：packages/contracts/src/ports/index.ts ReviewDecisionV1Schema（:1919-1926），
//   各复核类型的决定种类按 :1845-1917 的分类型枚举取值；
// - 审计投影：packages/core/src/review-audit/schema.ts ReviewActivityProjectionV1Schema
//   （sourceType 四类 + occurredAt / recordedAt / persistedAt 三时点）；
// - 版本引用 / 证据引用 / 审计信息：packages/contracts/src/common/index.ts
//   VersionReferenceSchema、EvidenceReferenceSchema、AuditInfoSchema。
// 跨域标识沿典范追溯链：DOC2026001-S32-SEG007 → PN-VDS-04 → MEC-VDS-017 →
// RISK-2026-001 → RUN-A-2026-001 / ASSESS-2026-001 → WARN-2026-001 →
// RESP-2026-001 → DEV-2026-001 / CAL-2026-001；识别运行 RUN-20260827-001。

import {
  ASSESSMENT_BASIS_VERSIONS,
  ASSESSMENT_RUNS,
  ASSESSMENT_STAGE_LABELS,
  ENTRY_MODE_LABELS,
  TRIGGER_REASON_LABELS,
  matrixLevelAt,
  type AssessmentRunFixture,
  type StageStatus,
} from './assessment';

/** 对齐 contracts VersionReferenceSchema。 */
export interface VersionReference {
  readonly entityId: string;
  readonly versionId: string;
}

/** 对齐 contracts EvidenceReferenceSchema。 */
export interface EvidenceReference {
  readonly locator: { readonly sourceSegmentId: string };
  readonly sourceVersion: VersionReference;
}

/** 契约命名引用（ContractReferenceV1 的通用形状：kind + 版本引用）。 */
export interface ContractRef {
  readonly kind: string;
  readonly reference: VersionReference;
}

// ---------------------------------------------------------------------------
// 复核任务（P-RV-01 / P-RV-02）
// ---------------------------------------------------------------------------

/** 复核类型：取值对齐 ReviewTypeV1Schema 五个枚举。 */
export const REVIEW_TYPES = [
  'identification-group',
  'knowledge-revision',
  'rule-conflict',
  'response-candidate',
  'calibration-suggestion',
] as const;

export type ReviewType = (typeof REVIEW_TYPES)[number];

export const REVIEW_TYPE_LABELS: Readonly<Record<ReviewType, string>> = {
  'identification-group': '识别分组复核',
  'knowledge-revision': '知识修订复核',
  'rule-conflict': '规则冲突复核',
  'response-candidate': '处置候选复核',
  'calibration-suggestion': '校准建议复核',
};

/** 复核任务状态：取值对齐 ReviewTaskStatusV1Schema。 */
export const REVIEW_TASK_STATUSES = ['pending', 'decided', 'superseded'] as const;

export type ReviewTaskStatus = (typeof REVIEW_TASK_STATUSES)[number];

export const REVIEW_TASK_STATUS_LABELS: Readonly<Record<ReviewTaskStatus, string>> = {
  pending: '待复核',
  decided: '已决定',
  superseded: '已被替代',
};

/** 复核策略版本（复核任务的 reviewPolicyRef）。 */
export const REVIEW_POLICY_REF: VersionReference = {
  entityId: 'RVP-001',
  versionId: 'v2026.08',
};

export interface ReviewTaskFixture {
  /** 复核任务标识（reviewTaskRef.reference.entityId）。 */
  readonly reviewTaskId: string;
  /** 复核任务版本（reviewTaskRef.reference.versionId；决定命令按版本匹配，过期拒绝）。 */
  readonly taskVersionId: string;
  readonly reviewType: ReviewType;
  /** 复核对象命名引用（ReviewTargetRefV1）。 */
  readonly targetRef: ContractRef;
  /** 复核对象展示名。 */
  readonly targetLabel: string;
  /** 复核对象详情深链（无对应页面则为 null）。 */
  readonly targetHref: string | null;
  /** 触发复核的原因（验收路由 / 一致性校验 / 偏差超限等）。 */
  readonly triggerReason: string;
  /** 等待本复核决定恢复的运行（ReviewTaskRefV1.waitingRunRef）。 */
  readonly waitingRunRef: ContractRef;
  readonly waitingRunHref: string | null;
  /** 确定性校验快照引用。 */
  readonly validationSnapshotRef: ContractRef;
  /** 证据快照引用。 */
  readonly evidenceSnapshotRef: ContractRef;
  readonly reviewPolicyRef: VersionReference;
  readonly status: ReviewTaskStatus;
  readonly requestedById: string;
  readonly requestedByLabel: string;
  readonly requestedAt: string;
  readonly decidedAt?: string;
  readonly decisionId?: string;
  readonly supersededAt?: string;
  readonly supersededByCommandId?: string;
  readonly evidenceReferences: readonly EvidenceReference[];
}

const DOC_SOURCE_VERSION: VersionReference = { entityId: 'DOC2026001', versionId: 'v2026.08.27' };

function docEvidence(sourceSegmentId: string): EvidenceReference {
  return { locator: { sourceSegmentId }, sourceVersion: DOC_SOURCE_VERSION };
}

function workflowRunRef(runId: string, versionId: string): ContractRef {
  return { kind: 'workflow-run', reference: { entityId: runId, versionId } };
}

function snapshotRef(kind: string, entityId: string, versionId: string): ContractRef {
  return { kind, reference: { entityId, versionId } };
}

export const REVIEW_TASKS: readonly ReviewTaskFixture[] = [
  {
    reviewTaskId: 'RVW-001',
    taskVersionId: 'v1.0',
    reviewType: 'identification-group',
    targetRef: snapshotRef('identification-group', 'IG-2026-007', 'v1.0'),
    targetLabel: '识别分组 IG-2026-007（变径空间扩挖段拱顶沉降候选）',
    targetHref: null,
    triggerReason: '综合置信度 0.72 低于自动验收阈值，验收路由转入人工复核',
    waitingRunRef: workflowRunRef('RUN-20260827-001', 'v1.0'),
    waitingRunHref: '#/identification/runs/RUN-20260827-001',
    validationSnapshotRef: snapshotRef('validation-snapshot', 'VS-20260827-007', 'v1.0'),
    evidenceSnapshotRef: snapshotRef('evidence-snapshot', 'ES-20260827-007', 'v1.0'),
    reviewPolicyRef: REVIEW_POLICY_REF,
    status: 'pending',
    requestedById: 'system',
    requestedByLabel: '系统（验收路由）',
    requestedAt: '2026-08-27T09:15:30+08:00',
    evidenceReferences: [docEvidence('DOC2026001-S32-SEG007')],
  },
  {
    reviewTaskId: 'RVW-002',
    taskVersionId: 'v1.0',
    reviewType: 'knowledge-revision',
    targetRef: snapshotRef('knowledge-revision', 'KR-MEC-VDS-011', 'v1.2-review'),
    targetLabel: '机理条目 MEC-VDS-011 修订 v1.2-review（掌子面稳定性失效）',
    targetHref: '#/knowledge/mechanisms',
    triggerReason: '知识编制 Agent 提交机理条目修订，按治理流程提请审核',
    waitingRunRef: workflowRunRef('RUN-KM-20260915-001', 'v1.0'),
    waitingRunHref: null,
    validationSnapshotRef: snapshotRef('validation-snapshot', 'VS-20260915-011', 'v1.0'),
    evidenceSnapshotRef: snapshotRef('evidence-snapshot', 'ES-20260915-011', 'v1.0'),
    reviewPolicyRef: REVIEW_POLICY_REF,
    status: 'pending',
    requestedById: 'U-RM-01',
    requestedByLabel: '项目风险经理',
    requestedAt: '2026-09-15T14:00:00+08:00',
    evidenceReferences: [docEvidence('DOC2026001-S61-SEG011')],
  },
  {
    reviewTaskId: 'RVW-003',
    taskVersionId: 'v1.0',
    reviewType: 'rule-conflict',
    targetRef: snapshotRef('rule-conflict', 'RC-2026-002', 'v1.0'),
    targetLabel: '规则冲突 RC-2026-002（RULE-EXPAND-05 与 RULE-EXPAND-02 区间重叠）',
    targetHref: '#/knowledge/rule-sets',
    triggerReason: '规则一致性校验未通过：阈值区间覆盖重叠',
    waitingRunRef: workflowRunRef('RUN-KM-20260826-002', 'v1.0'),
    waitingRunHref: null,
    validationSnapshotRef: snapshotRef('validation-snapshot', 'VS-20260826-002', 'v1.0'),
    evidenceSnapshotRef: snapshotRef('evidence-snapshot', 'ES-20260826-002', 'v1.0'),
    reviewPolicyRef: REVIEW_POLICY_REF,
    status: 'pending',
    requestedById: 'system',
    requestedByLabel: '系统（一致性校验）',
    requestedAt: '2026-08-26T16:40:00+08:00',
    evidenceReferences: [docEvidence('DOC2026001-S32-SEG008')],
  },
  {
    reviewTaskId: 'RVW-004',
    taskVersionId: 'v1.0',
    reviewType: 'calibration-suggestion',
    targetRef: snapshotRef('calibration-suggestion', 'CAL-2026-001', 'v1.0'),
    targetLabel: '校准建议 CAL-2026-001（注浆压力评分区间校准）',
    targetHref: '#/response/calibrations/CAL-2026-001',
    triggerReason: '偏差记录 DEV-2026-001 超过偏差阈值，校准建议候选待人工确认',
    waitingRunRef: workflowRunRef('RUN-WR-20260912-001', 'v1.0'),
    waitingRunHref: null,
    validationSnapshotRef: snapshotRef('validation-snapshot', 'VS-20260912-001', 'v1.0'),
    evidenceSnapshotRef: snapshotRef('evidence-snapshot', 'ES-20260912-001', 'v1.0'),
    reviewPolicyRef: REVIEW_POLICY_REF,
    status: 'pending',
    requestedById: 'system',
    requestedByLabel: '系统（偏差监视）',
    requestedAt: '2026-09-12T11:26:00+08:00',
    evidenceReferences: [docEvidence('DOC2026001-S32-SEG007')],
  },
  {
    reviewTaskId: 'RVW-005',
    taskVersionId: 'v1.0',
    reviewType: 'response-candidate',
    targetRef: snapshotRef('recommendation-candidate', 'RCAND-2026-009', 'v1.0'),
    targetLabel: '处置建议候选 RCAND-2026-009（预警 WARN-2026-002）',
    targetHref: '#/warnings/WARN-2026-002',
    triggerReason: '处置建议三项约束校验中触发一致性存疑，转人工复核',
    waitingRunRef: workflowRunRef('RUN-A-2026-005', 'v1.0'),
    waitingRunHref: '#/assessment/runs/RUN-A-2026-005',
    validationSnapshotRef: snapshotRef('validation-snapshot', 'VS-20260911-009', 'v1.0'),
    evidenceSnapshotRef: snapshotRef('evidence-snapshot', 'ES-20260911-009', 'v1.0'),
    reviewPolicyRef: REVIEW_POLICY_REF,
    status: 'decided',
    requestedById: 'system',
    requestedByLabel: '系统（三项约束校验）',
    requestedAt: '2026-09-11T17:02:00+08:00',
    decidedAt: '2026-09-11T18:24:00+08:00',
    decisionId: 'DEC-RVW-005-01',
    evidenceReferences: [docEvidence('DOC2026001-S61-SEG011')],
  },
  {
    reviewTaskId: 'RVW-006',
    taskVersionId: 'v1.0',
    reviewType: 'identification-group',
    targetRef: snapshotRef('identification-group', 'IG-2026-001', 'v1.0'),
    targetLabel: '识别分组 IG-2026-001（RISK-2026-001 候选分组）',
    targetHref: '#/identification/records/RISK-2026-001',
    triggerReason: '多来源合并后事件表达存在差异，验收路由转入人工复核',
    waitingRunRef: workflowRunRef('RUN-20260827-001', 'v1.0'),
    waitingRunHref: '#/identification/runs/RUN-20260827-001',
    validationSnapshotRef: snapshotRef('validation-snapshot', 'VS-20260827-001', 'v1.0'),
    evidenceSnapshotRef: snapshotRef('evidence-snapshot', 'ES-20260827-001', 'v1.0'),
    reviewPolicyRef: REVIEW_POLICY_REF,
    status: 'decided',
    requestedById: 'system',
    requestedByLabel: '系统（验收路由）',
    requestedAt: '2026-08-27T09:15:10+08:00',
    decidedAt: '2026-08-27T09:16:40+08:00',
    decisionId: 'DEC-RVW-006-01',
    evidenceReferences: [docEvidence('DOC2026001-S32-SEG007')],
  },
  {
    reviewTaskId: 'RVW-007',
    taskVersionId: 'v1.0',
    reviewType: 'knowledge-revision',
    targetRef: snapshotRef('knowledge-revision', 'KR-STD-MON-003', 'v1.1-review-r0'),
    targetLabel: '监测要求修订 v1.1-review-r0（STD-MON-003）',
    targetHref: '#/knowledge/standards',
    triggerReason: '提请审核：按甲方 9 月来文更新监测频次条款',
    waitingRunRef: workflowRunRef('RUN-KM-20260916-002', 'v1.0'),
    waitingRunHref: null,
    validationSnapshotRef: snapshotRef('validation-snapshot', 'VS-20260916-002', 'v1.0'),
    evidenceSnapshotRef: snapshotRef('evidence-snapshot', 'ES-20260916-002', 'v1.0'),
    reviewPolicyRef: REVIEW_POLICY_REF,
    status: 'superseded',
    requestedById: 'U-RM-01',
    requestedByLabel: '项目风险经理',
    requestedAt: '2026-09-16T10:30:00+08:00',
    supersededAt: '2026-09-16T10:32:00+08:00',
    supersededByCommandId: 'CMD-20260916-0041',
    evidenceReferences: [docEvidence('DOC2026001-S42-SEG009')],
  },
];

export function reviewTaskById(reviewTaskId: string): ReviewTaskFixture | undefined {
  return REVIEW_TASKS.find((task) => task.reviewTaskId === reviewTaskId);
}

export const pendingReviewTasks = (): readonly ReviewTaskFixture[] =>
  REVIEW_TASKS.filter((task) => task.status === 'pending');

export const settledReviewTasks = (): readonly ReviewTaskFixture[] =>
  REVIEW_TASKS.filter((task) => task.status !== 'pending');

// ---------------------------------------------------------------------------
// 复核决定（历史决定区；对齐 ReviewDecisionV1 分类型枚举）
// ---------------------------------------------------------------------------

/** 决定选项：按复核类型给出（PAGE-GUIDE E 骨架「通过 / 修正并通过 / 退回 + 理由」）。 */
export const DECISION_OPTIONS: Readonly<
  Record<ReviewType, readonly { readonly kind: string; readonly label: string }[]>
> = {
  'identification-group': [
    { kind: 'approve-unchanged', label: '通过（候选原样接受）' },
    { kind: 'approve-revised-candidate', label: '修正并通过' },
    { kind: 'return-upstream', label: '退回上游环节' },
    { kind: 'reject', label: '驳回' },
  ],
  'knowledge-revision': [
    { kind: 'approve-publication', label: '通过（批准发布）' },
    { kind: 'return-for-revision', label: '退回修改' },
    { kind: 'reject', label: '驳回' },
  ],
  'rule-conflict': [
    { kind: 'approve-publication', label: '通过（批准发布）' },
    { kind: 'return-for-revision', label: '退回修改' },
    { kind: 'reject', label: '驳回' },
  ],
  'response-candidate': [
    { kind: 'submit-revised-candidate', label: '提交修正候选' },
    { kind: 'return-upstream', label: '退回上游环节' },
    { kind: 'reject', label: '驳回' },
  ],
  'calibration-suggestion': [
    { kind: 'approve-draft-creation', label: '通过（批准生成校准草稿）' },
    { kind: 'return-for-revision', label: '退回修改' },
    { kind: 'reject', label: '驳回' },
  ],
};

export const DECISION_KIND_LABELS: Readonly<Record<string, string>> = {
  'approve-unchanged': '通过（候选原样接受）',
  'approve-revised-candidate': '修正并通过',
  'confirm-merge': '确认合并',
  'keep-separate': '保持拆分',
  'approve-publication': '通过（批准发布）',
  'return-for-revision': '退回修改',
  'submit-revised-candidate': '提交修正候选',
  'return-upstream': '退回上游环节',
  'approve-draft-creation': '通过（批准生成校准草稿）',
  reject: '驳回',
};

export interface ReviewDecisionFixture {
  readonly reviewDecisionId: string;
  readonly reviewTaskId: string;
  readonly reviewType: ReviewType;
  /** ReviewDecisionV1 的 kind 取值。 */
  readonly decisionKind: string;
  readonly reasonCode: string;
  readonly reasonText: string;
  readonly actorId: string;
  readonly actorLabel: string;
  readonly decidedAt: string;
  /** 修正类决定的修正候选版本引用（approve-revised-candidate / submit-revised-candidate）。 */
  readonly revisedCandidateRef?: VersionReference;
  /** 决定作用的复核对象标识（用于按目标聚合历史决定）。 */
  readonly targetEntityId: string;
}

export const REVIEW_DECISIONS: readonly ReviewDecisionFixture[] = [
  {
    reviewDecisionId: 'DEC-RVW-006-01',
    reviewTaskId: 'RVW-006',
    reviewType: 'identification-group',
    decisionKind: 'approve-unchanged',
    reasonCode: 'evidence-sufficient',
    reasonText: '候选与资料段表述一致，多来源差异已在合并计划中说明，原样接受',
    actorId: 'U-EXP-01',
    actorLabel: '复核专家',
    decidedAt: '2026-08-27T09:16:40+08:00',
    targetEntityId: 'IG-2026-001',
  },
  {
    reviewDecisionId: 'DEC-RVW-005-01',
    reviewTaskId: 'RVW-005',
    reviewType: 'response-candidate',
    decisionKind: 'submit-revised-candidate',
    reasonCode: 'measure-order-revised',
    reasonText: '措施实施顺序与现场作业窗口不匹配，调整后提交修正候选',
    actorId: 'U-EXP-02',
    actorLabel: '复核专家',
    decidedAt: '2026-09-11T18:24:00+08:00',
    revisedCandidateRef: { entityId: 'RCAND-2026-009R', versionId: 'v1.1' },
    targetEntityId: 'RCAND-2026-009',
  },
  {
    reviewDecisionId: 'DEC-RVW-H01',
    reviewTaskId: 'RVW-H01',
    reviewType: 'knowledge-revision',
    decisionKind: 'approve-publication',
    reasonCode: 'revision-consistent',
    reasonText: '修订与证据要求一致，批准发布 v1.1',
    actorId: 'U-EXP-01',
    actorLabel: '复核专家',
    decidedAt: '2026-08-20T10:00:00+08:00',
    targetEntityId: 'KR-MEC-VDS-011',
  },
  {
    reviewDecisionId: 'DEC-RVW-H02',
    reviewTaskId: 'RVW-H02',
    reviewType: 'knowledge-revision',
    decisionKind: 'approve-publication',
    reasonCode: 'client-reviewed',
    reasonText: '按甲方复核意见通过，适用规则集 v2026.09 发布依据',
    actorId: 'U-EXP-01',
    actorLabel: '复核专家',
    decidedAt: '2026-09-01T09:40:00+08:00',
    targetEntityId: 'KR-RS-001',
  },
];

export function reviewDecisionById(decisionId: string): ReviewDecisionFixture | undefined {
  return REVIEW_DECISIONS.find((decision) => decision.reviewDecisionId === decisionId);
}

/** 历史决定：按复核对象标识聚合（跨版本）。 */
export function decisionsForTarget(targetEntityId: string): readonly ReviewDecisionFixture[] {
  return REVIEW_DECISIONS.filter((decision) => decision.targetEntityId === targetEntityId);
}

// ---------------------------------------------------------------------------
// 识别复核候选（P-RV-03：修正并通过）
// 字段形状对齐 StandardizedRiskRecordSchema / CompositeConfidenceSchema
// （packages/contracts/src/records/index.ts:26-59）。
// ---------------------------------------------------------------------------

export interface RiskElementRelationView {
  readonly sourceElement: string;
  readonly relation: string;
  readonly targetElement: string;
}

export interface FieldCorrection {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

export interface IdentificationReviewCandidate {
  readonly taskId: string;
  /** 识别分组引用（identification-group）。 */
  readonly groupRef: VersionReference;
  /** 候选集引用（identification-candidate-set）。 */
  readonly candidateSetRef: VersionReference;
  /** 修正后候选集引用（approve-revised-candidate 决定的 revisedCandidateRef）。 */
  readonly revisedCandidateSetRef: VersionReference;
  /** 识别依据版本：机理库 / 识别策略集。 */
  readonly mechanismReleaseRef: VersionReference;
  readonly identificationPolicyRef: VersionReference;
  readonly candidate: {
    readonly processNodeId: string;
    readonly processNodeName: string;
    readonly riskSource: string;
    readonly riskFactor: string;
    readonly riskEvent: string;
    readonly riskElementRelations: readonly RiskElementRelationView[];
    readonly evidenceLocator: { readonly sourceSegmentId: string };
    readonly modelConfidence: number;
    readonly compositeConfidence: { readonly value: number; readonly basis: readonly string[] };
    readonly mechanismEntryId: string;
  };
  /** 字段级修正 diff（修正前 → 修正后）。 */
  readonly fieldCorrections: readonly FieldCorrection[];
}

export const IDENTIFICATION_REVIEW_CANDIDATES: readonly IdentificationReviewCandidate[] = [
  {
    taskId: 'RVW-001',
    groupRef: { entityId: 'IG-2026-007', versionId: 'v1.0' },
    candidateSetRef: { entityId: 'CS-2026-007', versionId: 'v1.0' },
    revisedCandidateSetRef: { entityId: 'CS-2026-007R', versionId: 'v1.1' },
    mechanismReleaseRef: { entityId: 'MEC-LIB-VDS', versionId: 'v2026.08' },
    identificationPolicyRef: { entityId: 'IDP-VDS-001', versionId: 'v2026.08' },
    candidate: {
      processNodeId: 'PN-VDS-04',
      processNodeName: '变径空间扩挖',
      riskSource: '富水软弱地层变径空间扩挖',
      riskFactor: '扩挖进尺偏快',
      riskEvent: '变径空间扩挖引发拱顶沉降',
      riskElementRelations: [
        { sourceElement: '扩挖进尺', relation: '加剧', targetElement: '拱顶沉降' },
        { sourceElement: '支护闭合滞后', relation: '放大', targetElement: '拱顶沉降' },
      ],
      evidenceLocator: { sourceSegmentId: 'DOC2026001-S32-SEG007' },
      modelConfidence: 0.72,
      compositeConfidence: {
        value: 0.72,
        basis: ['模型推理置信度 0.72', '机理条目 MEC-VDS-017 命中', '单一资料段证据'],
      },
      mechanismEntryId: 'MEC-VDS-017',
    },
    fieldCorrections: [
      {
        field: '风险事件',
        before: '变径空间扩挖引发拱顶沉降',
        after: '变径空间扩挖段拱顶沉降超限',
      },
      {
        field: '风险因素',
        before: '扩挖进尺偏快',
        after: '扩挖进尺偏快且支护闭合滞后',
      },
      {
        field: '要素关系',
        before: '扩挖进尺 —加剧→ 拱顶沉降（单条）',
        after: '扩挖进尺 —加剧→ 拱顶沉降；支护闭合滞后 —放大→ 拱顶沉降（两条）',
      },
    ],
  },
];

export function identificationCandidateForTask(
  taskId: string,
): IdentificationReviewCandidate | undefined {
  return IDENTIFICATION_REVIEW_CANDIDATES.find((candidate) => candidate.taskId === taskId);
}

// ---------------------------------------------------------------------------
// 证据追溯链（P-RV-04）：端到端追溯链的集中呈现，沿典范链
// ---------------------------------------------------------------------------

export interface TraceChainNode {
  readonly key: string;
  readonly label: string;
  readonly id: string;
  readonly href: string;
  readonly summary: string;
  /** 节点上的不可变版本引用（可选，多个）。 */
  readonly versionRefs: readonly { readonly kindLabel: string; readonly reference: VersionReference }[];
  readonly fields: readonly { readonly label: string; readonly value: string }[];
}

const matrixLevelMain = matrixLevelAt('P4', 'C4');

export const TRACE_CHAIN: readonly TraceChainNode[] = [
  {
    key: 'source',
    label: '资料',
    id: 'DOC2026001',
    href: '#/projects/sources/DOC2026001',
    summary: '变径盾构隧站一体化建造风险评估资料（甲方提供）',
    versionRefs: [
      { kindLabel: '资料版本', reference: { entityId: 'DOC2026001', versionId: 'v2026.08.27' } },
    ],
    fields: [
      { label: '资料类别', value: '风险评估与专项方案资料' },
      { label: '入库时间', value: '2026-08-27 08:40' },
    ],
  },
  {
    key: 'segment',
    label: '资料段',
    id: 'DOC2026001-S32-SEG007',
    href: '#/projects/sources/DOC2026001',
    summary: '第 32 章第 7 段：变径空间扩挖段地质条件与沉降控制要求',
    versionRefs: [
      { kindLabel: '资料版本', reference: { entityId: 'DOC2026001', versionId: 'v2026.08.27' } },
    ],
    fields: [
      { label: '章节', value: 'S32 变径空间扩挖' },
      { label: '证据要点', value: '围岩 V 级、富水、扩挖跨度比 1.42' },
    ],
  },
  {
    key: 'process-node',
    label: '工序节点',
    id: 'PN-VDS-04',
    href: '#/identification/process-model',
    summary: '变径空间扩挖（项目工序模型必含 5 项之一）',
    versionRefs: [
      { kindLabel: '工序模型', reference: { entityId: 'PM-VDS', versionId: 'v2026.08' } },
    ],
    fields: [
      { label: '监测指标', value: '地表沉降、支护结构变形、注浆压力' },
    ],
  },
  {
    key: 'mechanism',
    label: '风险机理条目',
    id: 'MEC-VDS-017',
    href: '#/knowledge/mechanisms',
    summary: '过挖与地表沉降（富水软弱地层）',
    versionRefs: [
      { kindLabel: '机理条目', reference: { entityId: 'MEC-VDS-017', versionId: 'v1.2' } },
      { kindLabel: '机理库', reference: { entityId: 'MEC-LIB-VDS', versionId: 'v2026.08' } },
    ],
    fields: [
      { label: '触发条件', value: '支护闭合滞后、注浆压力低于生效区间且地表沉降短期斜率超限' },
    ],
  },
  {
    key: 'risk-record',
    label: '标准化风险记录',
    id: 'RISK-2026-001',
    href: '#/identification/records/RISK-2026-001',
    summary: '变径空间扩挖段拱顶沉降超限',
    versionRefs: [],
    fields: [
      { label: '综合置信度', value: '0.86（模型推理 0.84 · 机理条目命中 · 专家复核通过）' },
      { label: '入库运行', value: '识别运行 RUN-20260827-001' },
    ],
  },
  {
    key: 'assessment-run',
    label: '评估运行',
    id: 'RUN-A-2026-001',
    href: '#/assessment/runs/RUN-A-2026-001',
    summary: '首次评估（风险输入就绪后启动）',
    versionRefs: [],
    fields: [
      { label: '幂等键', value: 'IDEMP-A-20260827-0001' },
      { label: '启动时间', value: '2026-08-27 09:04' },
    ],
  },
  {
    key: 'assessment-record',
    label: '风险评估记录',
    id: 'ASSESS-2026-001',
    href: '#/assessment/records/ASSESS-2026-001',
    summary: `P4 × C4，落点等级 ${matrixLevelMain?.label ?? '未定'}`,
    versionRefs: [
      { kindLabel: '适用规则集', reference: ASSESSMENT_BASIS_VERSIONS.applicableRuleSet },
      { kindLabel: '权重', reference: ASSESSMENT_BASIS_VERSIONS.weightSet },
      { kindLabel: '风险矩阵', reference: ASSESSMENT_BASIS_VERSIONS.riskMatrix },
    ],
    fields: [
      { label: '发生可能性 P', value: '4（P4）' },
      { label: '后果严重度 C', value: '4（C4）' },
      { label: '适用性快照', value: '变径盾构法 · 富水软弱地层 · 变径空间扩挖与支护' },
    ],
  },
  {
    key: 'warning',
    label: '预警信息',
    id: 'WARN-2026-001',
    href: '#/warnings/WARN-2026-001',
    summary: 'I 级预警 · 多指标联合规则命中',
    versionRefs: [
      { kindLabel: '监测预警阈值', reference: ASSESSMENT_BASIS_VERSIONS.monitoringWarningThreshold },
    ],
    fields: [
      { label: '触发指标', value: '地表沉降、地表沉降短期斜率、支护结构变形、注浆压力' },
      { label: '处置任务', value: 'WRT-2026-001（已确认）' },
    ],
  },
  {
    key: 'response',
    label: '处置建议',
    id: 'RESP-2026-001',
    href: '#/response/recommendations/RESP-2026-001',
    summary: '注浆调整、参数控制、监测加密（三项约束校验通过）',
    versionRefs: [
      { kindLabel: '措施库', reference: { entityId: 'MSL-VDS-001', versionId: 'v2026.08' } },
    ],
    fields: [{ label: '复核状态', value: '已记录，待采纳' }],
  },
  {
    key: 'deviation',
    label: '偏差记录',
    id: 'DEV-2026-001',
    href: '#/response/feedback/DEV-2026-001',
    summary: '处置后沉降斜率回落慢于预测，偏差值超过偏差阈值',
    versionRefs: [
      { kindLabel: '偏差阈值', reference: { entityId: 'TH-DEV-VDS', versionId: 'v2026.08' } },
    ],
    fields: [{ label: '偏差结论', value: '实际风险回落滞后于预测一个监测周期' }],
  },
  {
    key: 'calibration',
    label: '校准建议',
    id: 'CAL-2026-001',
    href: '#/response/calibrations/CAL-2026-001',
    summary: '注浆压力评分区间校准建议（待人工确认后生成草稿）',
    versionRefs: [],
    fields: [{ label: '复核任务', value: 'RVW-004（待复核）' }],
  },
];

export const TRACE_CHAIN_EVENTS: readonly { readonly at: string; readonly label: string; readonly href?: string }[] = [
  { at: '2026-08-27 08:40', label: '资料 DOC2026001 入库并切段', href: '#/projects/sources/DOC2026001' },
  { at: '2026-08-27 08:52', label: '标准化风险记录 RISK-2026-001 入库', href: '#/identification/records/RISK-2026-001' },
  { at: '2026-08-27 09:04', label: '评估运行 RUN-A-2026-001 启动', href: '#/assessment/runs/RUN-A-2026-001' },
  { at: '2026-08-27 09:21', label: '评估记录 ASSESS-2026-001 入库', href: '#/assessment/records/ASSESS-2026-001' },
  { at: '2026-08-27 09:22', label: '预警 WARN-2026-001 开立', href: '#/warnings/WARN-2026-001' },
  { at: '2026-08-27 09:48', label: '处置建议 RESP-2026-001 记录', href: '#/response/recommendations/RESP-2026-001' },
  { at: '2026-09-12 11:20', label: '偏差 DEV-2026-001 登记（超限）', href: '#/response/feedback/DEV-2026-001' },
  { at: '2026-09-12 11:26', label: '校准建议 CAL-2026-001 提请复核', href: '#/response/calibrations/CAL-2026-001' },
];

/** 证据入口（资料段证据引用，供 P-RV-04 证据区与其他页证据链接共用）。 */
export const TRACE_EVIDENCE_REFERENCES: readonly EvidenceReference[] = [
  docEvidence('DOC2026001-S32-SEG007'),
  docEvidence('DOC2026001-S32-SEG009'),
  docEvidence('DOC2026001-S32-SEG011'),
];

// ---------------------------------------------------------------------------
// 运行记录（P-RV-05）：跨识别 / 评估两类运行的统一运行视图
// ---------------------------------------------------------------------------

export type RunKind = 'identification' | 'assessment';

export const RUN_KIND_LABELS: Readonly<Record<RunKind, string>> = {
  identification: '识别运行',
  assessment: '评估运行',
};

/** I0–I9 阶段语义对齐主规格「识别工作流具有 I0 至 I9 的版本化阶段契约」。 */
export const IDENTIFICATION_STAGE_LABELS: Readonly<Record<string, string>> = {
  I0: '资料准备与输入冻结',
  I1: '知识就绪',
  I2: '工序工作项规划',
  I3: '检索与必经审阅',
  I4: '上下文组装与候选推理',
  I5: '结构修复与确定性校验',
  I6: '重复检测与多来源合并',
  I7: '综合置信度与验收路由',
  I8: '业务入库与评估事件',
  I9: '结果汇总',
};

export type RunStatus = 'completed' | 'running' | 'waiting' | 'terminal-failure';

export const RUN_STATUS_LABELS: Readonly<Record<RunStatus, string>> = {
  completed: '已完成',
  running: '运行中',
  waiting: '等待复核',
  'terminal-failure': '失败终止',
};

export interface RunSubtaskView {
  readonly id: string;
  readonly stage: string;
  readonly name: string;
  readonly status: StageStatus;
  readonly duration?: string;
  readonly result?: string;
}

export interface RunRecordView {
  readonly runId: string;
  readonly kind: RunKind;
  readonly status: RunStatus;
  readonly currentStage: string;
  readonly stageLabels: Readonly<Record<string, string>>;
  readonly triggerReason: string;
  readonly operatorId: string;
  readonly operatorName: string;
  readonly startedAt: string;
  readonly idempotencyKey: string;
  readonly stages: readonly { readonly stage: string; readonly status: StageStatus }[];
  readonly subtasks: readonly RunSubtaskView[];
  readonly summaryItems: readonly { readonly label: string; readonly value: string }[];
  /** 归属域的运行详情页深链。 */
  readonly detailHref: string;
  readonly related: readonly { readonly label: string; readonly href: string }[];
}

const IDENTIFICATION_STAGE_IDS = ['I0', 'I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9'] as const;

function identificationStages(
  doneUpTo: number,
  current: { readonly index: number; readonly status: StageStatus },
): readonly { readonly stage: string; readonly status: StageStatus }[] {
  return IDENTIFICATION_STAGE_IDS.map((stage, index) => {
    let status: StageStatus = 'pending';
    if (index <= doneUpTo) status = 'done';
    if (index === current.index) status = current.status;
    return { stage, status };
  });
}

const IDENTIFICATION_RUNS: readonly RunRecordView[] = [
  {
    runId: 'RUN-20260827-001',
    kind: 'identification',
    status: 'waiting',
    currentStage: 'I8',
    stageLabels: IDENTIFICATION_STAGE_LABELS,
    triggerReason: '资料交付入库触发识别（监测资料更新）',
    operatorId: 'system',
    operatorName: '系统（自动调度）',
    startedAt: '2026-08-27T08:44:00+08:00',
    idempotencyKey: 'IDEMP-I-20260827-0001',
    stages: identificationStages(7, { index: 8, status: 'waiting' }),
    subtasks: [
      { id: 'ST-I-001', stage: 'I0', name: '识别准备快照组装与输入冻结', status: 'done', duration: '4 s', result: '输入快照 SNAP-I-20260827-001' },
      { id: 'ST-I-002', stage: 'I1', name: '识别依据版本集就绪确认', status: 'done', duration: '3 s', result: '机理库 MEC-LIB-VDS · v2026.08' },
      { id: 'ST-I-003', stage: 'I2', name: '工序工作项规划', status: 'done', duration: '2 s', result: '工作项 5 项（必含 5 节点全覆盖）' },
      { id: 'ST-I-004', stage: 'I3', name: '混合检索与必经审阅', status: 'done', duration: '64 s', result: '检索审阅任务完成，增量经确定性收口' },
      { id: 'ST-I-005', stage: 'I4', name: '上下文组装与候选推理', status: 'done', duration: '96 s', result: '候选集 CS-2026-007 等 4 组' },
      { id: 'ST-I-006', stage: 'I5', name: '结构修复与确定性校验', status: 'done', duration: '8 s', result: '校验快照 VS-20260827-001 通过' },
      { id: 'ST-I-007', stage: 'I6', name: '全运行重复检测与多来源合并', status: 'done', duration: '5 s', result: '合并计划 MP-2026-003' },
      { id: 'ST-I-008', stage: 'I7', name: '综合置信度与验收路由', status: 'done', duration: '2 s', result: 'IG-2026-007 转人工复核（RVW-001）' },
      { id: 'ST-I-009', stage: 'I8', name: '业务入库与评估事件', status: 'waiting', result: '已入库 RISK-2026-001 等 3 条；等待 RVW-001 决定' },
    ],
    summaryItems: [
      { label: '入库风险记录', value: '3 条' },
      { label: '待复核分组', value: '1 组（RVW-001）' },
      { label: '证据资料段', value: '11 段' },
    ],
    detailHref: '#/identification/runs/RUN-20260827-001',
    related: [
      { label: '复核任务 RVW-001', href: '#/review-audit/reviews/RVW-001' },
      { label: '风险记录 RISK-2026-001', href: '#/identification/records/RISK-2026-001' },
    ],
  },
  {
    runId: 'RUN-20260826-002',
    kind: 'identification',
    status: 'completed',
    currentStage: 'I9',
    stageLabels: IDENTIFICATION_STAGE_LABELS,
    triggerReason: '手动启动识别（历史资料补录）',
    operatorId: 'U-RM-01',
    operatorName: '刘一鸣',
    startedAt: '2026-08-26T15:02:00+08:00',
    idempotencyKey: 'IDEMP-I-20260826-0002',
    stages: IDENTIFICATION_STAGE_IDS.map((stage) => ({ stage, status: 'done' as const })),
    subtasks: [
      { id: 'ST-I-101', stage: 'I0', name: '识别准备快照组装与输入冻结', status: 'done', duration: '3 s', result: '输入快照 SNAP-I-20260826-002' },
      { id: 'ST-I-102', stage: 'I5', name: '结构修复与确定性校验', status: 'done', duration: '7 s', result: '校验快照 VS-20260826-002 通过' },
      { id: 'ST-I-103', stage: 'I7', name: '综合置信度与验收路由', status: 'done', duration: '2 s', result: '全部候选达自动验收阈值' },
      { id: 'ST-I-104', stage: 'I9', name: '运行结果汇总', status: 'done', duration: '1 s', result: '结果汇总 RR-I-20260826-002' },
    ],
    summaryItems: [
      { label: '入库风险记录', value: '2 条' },
      { label: '待复核分组', value: '0 组' },
      { label: '证据资料段', value: '6 段' },
    ],
    detailHref: '#/identification/runs/RUN-20260826-002',
    related: [],
  },
];

function assessmentRunView(run: AssessmentRunFixture): RunRecordView {
  const summary = run.summary;
  const related: { label: string; href: string }[] = [
    { label: `风险记录 ${run.riskRecordId}`, href: `#/identification/records/${run.riskRecordId}` },
  ];
  if (run.outputs.assessmentRecordId !== null) {
    related.push({
      label: `评估记录 ${run.outputs.assessmentRecordId}`,
      href: `#/assessment/records/${run.outputs.assessmentRecordId}`,
    });
  }
  if (run.outputs.warningRecordId !== null) {
    related.push({
      label: `预警 ${run.outputs.warningRecordId}`,
      href: `#/warnings/${run.outputs.warningRecordId}`,
    });
  }
  return {
    runId: run.runId,
    kind: 'assessment',
    status: run.status,
    currentStage: run.currentStage,
    stageLabels: ASSESSMENT_STAGE_LABELS,
    triggerReason: `${ENTRY_MODE_LABELS[run.entryMode]}；${
      TRIGGER_REASON_LABELS[run.triggerReasonCode] ?? run.triggerReasonCode
    }`,
    operatorId: run.operatorId,
    operatorName: run.operatorName,
    startedAt: run.startedAt,
    idempotencyKey: run.idempotencyKey,
    stages: run.stages,
    subtasks: run.subtasks.map((subtask) => ({
      id: subtask.id,
      stage: subtask.stage,
      name: subtask.name,
      status: subtask.status,
      ...(subtask.duration === undefined ? {} : { duration: subtask.duration }),
      ...(subtask.result === undefined ? {} : { result: subtask.result }),
    })),
    summaryItems: [
      { label: '指标取值', value: `${summary.indicatorValueCount} 项` },
      { label: '适用规则', value: `${summary.appliedRuleCount} 条` },
      { label: '筛除规则', value: `${summary.excludedRuleCount} 条` },
      { label: '命中触发类型', value: `${summary.triggerHitCount} 类` },
    ],
    detailHref: `#/assessment/runs/${run.runId}`,
    related,
  };
}

export const RUN_RECORDS: readonly RunRecordView[] = [
  ...IDENTIFICATION_RUNS,
  ...ASSESSMENT_RUNS.map(assessmentRunView),
];

// ---------------------------------------------------------------------------
// 版本与操作审计（P-RV-06）：审计日志是合同交付物，呈现不可省略
// 条目形状对齐 ReviewActivityProjectionV1（sourceType / activityCode /
// actorRef / 命令与幂等键 / reasonCode / resultCode / occurred-recorded-persisted
// 三时点）；业务审计条目的活动码词汇见 docs/gap-inbox/review.md。
// ---------------------------------------------------------------------------

export type AuditCategory =
  | 'manual-review'
  | 'rule-conflict'
  | 'applicability-exclusion'
  | 'release'
  | 'security';

export const AUDIT_CATEGORY_LABELS: Readonly<Record<AuditCategory, string>> = {
  'manual-review': '人工审核',
  'rule-conflict': '规则冲突',
  'applicability-exclusion': '适用性筛除',
  release: '版本发布与回滚',
  security: '授权校验',
};

/** 对齐 ReviewActivitySourceTypeV1Schema 四类来源。 */
export type AuditSourceType = 'business-audit' | 'review-task' | 'review-rejection' | 'security-audit';

export const AUDIT_SOURCE_TYPE_LABELS: Readonly<Record<AuditSourceType, string>> = {
  'business-audit': '业务审计',
  'review-task': '复核任务',
  'review-rejection': '复核拒绝',
  'security-audit': '安全审计',
};

export interface AuditEntryFixture {
  readonly entryId: string;
  readonly category: AuditCategory;
  readonly sourceType: AuditSourceType;
  readonly activityCode: string;
  readonly summary: string;
  readonly actorLabel: string;
  readonly targetLabel?: string;
  readonly targetHref?: string;
  readonly relatedReviewTaskId?: string;
  readonly commandId?: string;
  readonly idempotencyKey?: string;
  readonly reasonCode?: string;
  readonly resultCode?: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly persistedAt: string;
}

export const AUDIT_ENTRIES: readonly AuditEntryFixture[] = [
  {
    entryId: 'AUD-20260917-0014',
    category: 'security',
    sourceType: 'security-audit',
    activityCode: 'security.authorization-rejected',
    summary: '现场处置员尝试提交复核决定，缺少能力 review-audit.decide，授权校验拒绝',
    actorLabel: '现场处置员',
    targetLabel: '复核任务 RVW-002',
    targetHref: '#/review-audit/reviews/RVW-002',
    relatedReviewTaskId: 'RVW-002',
    resultCode: 'AUTHORIZATION_DENIED',
    occurredAt: '2026-09-17T14:20:11+08:00',
    recordedAt: '2026-09-17T14:20:11+08:00',
    persistedAt: '2026-09-17T14:20:12+08:00',
  },
  {
    entryId: 'AUD-20260916-0031',
    category: 'manual-review',
    sourceType: 'review-rejection',
    activityCode: 'review.decision-rejected',
    summary: '复核决定因任务版本过时被拒绝（决定按 v1.0 提交，任务已更新至 v1.1）',
    actorLabel: '复核专家',
    targetLabel: '复核任务 RVW-002',
    targetHref: '#/review-audit/reviews/RVW-002',
    relatedReviewTaskId: 'RVW-002',
    commandId: 'CMD-20260916-0038',
    resultCode: 'STALE_VERSION',
    reasonCode: 'review-task-version-mismatch',
    occurredAt: '2026-09-16T15:04:02+08:00',
    recordedAt: '2026-09-16T15:04:02+08:00',
    persistedAt: '2026-09-16T15:04:03+08:00',
  },
  {
    entryId: 'AUD-20260916-0029',
    category: 'manual-review',
    sourceType: 'review-task',
    activityCode: 'review.superseded',
    summary: '旧版本复核任务 RVW-007 已被新提请替代',
    actorLabel: '项目风险经理',
    targetLabel: '复核任务 RVW-007',
    targetHref: '#/review-audit/reviews/RVW-007',
    relatedReviewTaskId: 'RVW-007',
    commandId: 'CMD-20260916-0041',
    occurredAt: '2026-09-16T10:32:00+08:00',
    recordedAt: '2026-09-16T10:32:00+08:00',
    persistedAt: '2026-09-16T10:32:01+08:00',
  },
  {
    entryId: 'AUD-20260912-0017',
    category: 'manual-review',
    sourceType: 'review-task',
    activityCode: 'review.requested',
    summary: '校准建议 CAL-2026-001 发起人工复核（偏差超限）',
    actorLabel: '系统（偏差监视）',
    targetLabel: '校准建议 CAL-2026-001',
    targetHref: '#/response/calibrations/CAL-2026-001',
    relatedReviewTaskId: 'RVW-004',
    commandId: 'CMD-20260912-0017',
    idempotencyKey: 'IDEMP-R-20260912-0017',
    occurredAt: '2026-09-12T11:26:00+08:00',
    recordedAt: '2026-09-12T11:26:00+08:00',
    persistedAt: '2026-09-12T11:26:01+08:00',
  },
  {
    entryId: 'AUD-20260911-0022',
    category: 'manual-review',
    sourceType: 'review-task',
    activityCode: 'review.decided',
    summary: '处置候选复核 RVW-005 已决定：提交修正候选 RCAND-2026-009R · v1.1',
    actorLabel: '复核专家',
    targetLabel: '处置建议候选 RCAND-2026-009',
    targetHref: '#/review-audit/reviews/RVW-005',
    relatedReviewTaskId: 'RVW-005',
    commandId: 'CMD-20260911-0022',
    idempotencyKey: 'IDEMP-R-20260911-0022',
    occurredAt: '2026-09-11T18:24:00+08:00',
    recordedAt: '2026-09-11T18:24:00+08:00',
    persistedAt: '2026-09-11T18:24:01+08:00',
  },
  {
    entryId: 'AUD-20260901-0009',
    category: 'release',
    sourceType: 'business-audit',
    activityCode: 'knowledge.release-published',
    summary: '适用规则集 RS-001 · v2026.09 发布（依据复核决定 DEC-RVW-H02）',
    actorLabel: '项目风险经理',
    targetLabel: '适用规则集 RS-001 · v2026.09',
    targetHref: '#/knowledge/rule-sets',
    commandId: 'CMD-20260901-0009',
    idempotencyKey: 'IDEMP-K-20260901-0009',
    occurredAt: '2026-09-01T10:00:00+08:00',
    recordedAt: '2026-09-01T10:00:00+08:00',
    persistedAt: '2026-09-01T10:00:01+08:00',
  },
  {
    entryId: 'AUD-20260901-0010',
    category: 'release',
    sourceType: 'business-audit',
    activityCode: 'knowledge.release-rollback',
    summary: '风险矩阵 RM-VDS-001 · v2026.09 以回滚新版本发布（内容回滚至 v2026.07）',
    actorLabel: '项目风险经理',
    targetLabel: '风险矩阵 RM-VDS-001 · v2026.09',
    targetHref: '#/knowledge/risk-matrices',
    commandId: 'CMD-20260901-0010',
    idempotencyKey: 'IDEMP-K-20260901-0010',
    reasonCode: 'level-mapping-review-failed',
    occurredAt: '2026-09-01T10:00:30+08:00',
    recordedAt: '2026-09-01T10:00:30+08:00',
    persistedAt: '2026-09-01T10:00:31+08:00',
  },
  {
    entryId: 'AUD-20260827-0013',
    category: 'manual-review',
    sourceType: 'review-task',
    activityCode: 'review.requested',
    summary: '识别分组 IG-2026-007 发起人工复核（综合置信度低于自动验收阈值）',
    actorLabel: '系统（验收路由）',
    targetLabel: '复核任务 RVW-001',
    targetHref: '#/review-audit/reviews/RVW-001',
    relatedReviewTaskId: 'RVW-001',
    commandId: 'CMD-20260827-0013',
    idempotencyKey: 'IDEMP-R-20260827-0013',
    occurredAt: '2026-08-27T09:15:30+08:00',
    recordedAt: '2026-08-27T09:15:30+08:00',
    persistedAt: '2026-08-27T09:15:31+08:00',
  },
  {
    entryId: 'AUD-20260827-0014',
    category: 'manual-review',
    sourceType: 'review-task',
    activityCode: 'review.decided',
    summary: '识别分组复核 RVW-006 已决定：通过（候选原样接受），运行 RUN-20260827-001 恢复推进',
    actorLabel: '复核专家',
    targetLabel: '识别分组 IG-2026-001',
    targetHref: '#/review-audit/reviews/RVW-006',
    relatedReviewTaskId: 'RVW-006',
    commandId: 'CMD-20260827-0014',
    idempotencyKey: 'IDEMP-R-20260827-0014',
    occurredAt: '2026-08-27T09:16:40+08:00',
    recordedAt: '2026-08-27T09:16:40+08:00',
    persistedAt: '2026-08-27T09:16:41+08:00',
  },
  {
    entryId: 'AUD-20260827-0007',
    category: 'applicability-exclusion',
    sourceType: 'business-audit',
    activityCode: 'assessment.rule-applicability-excluded',
    summary: '评估运行 RUN-A-2026-001 适用性筛除 3 条评分规则（RULE-VDS-009 / RULE-VDS-014 / RULE-VDS-021）',
    actorLabel: '系统（评估运行）',
    targetLabel: '评估运行 RUN-A-2026-001',
    targetHref: '#/assessment/runs/RUN-A-2026-001',
    occurredAt: '2026-08-27T09:09:12+08:00',
    recordedAt: '2026-08-27T09:09:12+08:00',
    persistedAt: '2026-08-27T09:09:13+08:00',
  },
  {
    entryId: 'AUD-20260826-0019',
    category: 'rule-conflict',
    sourceType: 'business-audit',
    activityCode: 'knowledge.rule-conflict-registered',
    summary: '规则冲突 RC-2026-002 登记：RULE-EXPAND-05 草案与 RULE-EXPAND-02 阈值区间覆盖重叠',
    actorLabel: '系统（一致性校验）',
    targetLabel: '规则冲突 RC-2026-002',
    targetHref: '#/review-audit/reviews/RVW-003',
    relatedReviewTaskId: 'RVW-003',
    occurredAt: '2026-08-26T16:38:45+08:00',
    recordedAt: '2026-08-26T16:38:45+08:00',
    persistedAt: '2026-08-26T16:38:46+08:00',
  },
  {
    entryId: 'AUD-20260820-0006',
    category: 'release',
    sourceType: 'business-audit',
    activityCode: 'knowledge.release-published',
    summary: '监测预警阈值 TH-MON-VDS · v2026.08 发布（经甲方审核）',
    actorLabel: '项目风险经理',
    targetLabel: '监测预警阈值 TH-MON-VDS · v2026.08',
    targetHref: '#/knowledge/indicator-systems',
    commandId: 'CMD-20260820-0006',
    idempotencyKey: 'IDEMP-K-20260820-0006',
    occurredAt: '2026-08-20T10:00:00+08:00',
    recordedAt: '2026-08-20T10:00:00+08:00',
    persistedAt: '2026-08-20T10:00:01+08:00',
  },
];

// ---------------------------------------------------------------------------
// 深链（hash 路由；参数化目标用具体标识）
// ---------------------------------------------------------------------------

export const LINKS = {
  reviewQueue: '#/review-audit',
  reviewDetail: (reviewId: string) => `#/review-audit/reviews/${reviewId}`,
  identificationReview: (reviewId: string) => `#/review-audit/reviews/${reviewId}/identification`,
  evidenceTrace: '#/review-audit/trace',
  runRecords: '#/review-audit/runs',
  auditLog: '#/review-audit/audit-log',
  identificationRecord: (recordId: string) => `#/identification/records/${recordId}`,
  identificationRun: (runId: string) => `#/identification/runs/${runId}`,
  knowledgeMechanisms: '#/knowledge/mechanisms',
  knowledgeRuleSets: '#/knowledge/rule-sets',
  assessmentRun: (runId: string) => `#/assessment/runs/${runId}`,
  assessmentRecord: (recordId: string) => `#/assessment/records/${recordId}`,
  warning: (warningId: string) => `#/warnings/${warningId}`,
  responseRecommendation: (recommendationId: string) =>
    `#/response/recommendations/${recommendationId}`,
  responseCalibration: (suggestionId: string) => `#/response/calibrations/${suggestionId}`,
  projectSource: (sourceId: string) => `#/projects/sources/${sourceId}`,
} as const;
