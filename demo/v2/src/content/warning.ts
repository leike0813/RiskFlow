// 预警域 fixture（P-WR-01～P-WR-04）。
// 字段形状以 packages/contracts 为准（G2 校正），语义参照 v1 demo/src/content/response.ts：
// - WarningRecord：packages/contracts/src/records/index.ts:227-238
// - TriggerIndicator：同文件 :197-202，triggerType 为单值枚举
//   （packages/contracts/src/vocabulary/index.ts:79-84），多类触发经
//   triggerIndicators 逐项的结构化字段表达，不使用数组 triggerTypes；
// - EvidenceReference / AuditInfo / VersionReference：
//   packages/contracts/src/common/index.ts:11-15、62-79；
// - 预警开立的策略引用（预警聚合策略 / 通知策略）：
//   packages/contracts/src/ports/index.ts:1477-1488 OpenWarningCommandV1 payload。
// 契约未覆盖的展示字段（阈值快照、处置任务状态机等）已在 docs/gap-inbox/warning.md 登记。

/** 对齐 common/index.ts VersionReferenceSchema。 */
export interface VersionReference {
  readonly entityId: string;
  readonly versionId: string;
}

/** 对齐 common/index.ts EvidenceReferenceSchema。 */
export interface EvidenceReference {
  readonly locator: { readonly sourceSegmentId: string };
  readonly sourceVersion: VersionReference;
}

/** 对齐 common/index.ts AuditInfoSchema。 */
export interface AuditInfo {
  readonly actorId: string;
  readonly action: string;
  readonly recordedAt: string;
  readonly reason?: string;
}

/** 预警触发类型取值：vocabulary/index.ts WARNING_TRIGGER_TYPE_VALUES，单值语义。 */
export const WARNING_TRIGGER_TYPES = [
  '风险等级超过风险可接受阈值',
  '监测指标越限',
  '趋势/加速度/异常评分越限',
  '多指标联合规则命中',
] as const;

export type WarningTriggerType = (typeof WARNING_TRIGGER_TYPES)[number];

/** 预警等级刻度（数据驱动，等级色仅经 riskLevel 通道进入图表与等级 chip）。 */
export const WARNING_LEVELS = [
  { id: 'I', label: 'I 级预警', riskLevel: 1 },
  { id: 'II', label: 'II 级预警', riskLevel: 2 },
  { id: 'III', label: 'III 级预警', riskLevel: 3 },
  { id: 'IV', label: 'IV 级预警', riskLevel: 4 },
] as const;

export type WarningLevelId = (typeof WARNING_LEVELS)[number]['id'];

/** 预警处置任务状态机：对齐 warning-response 各 record 分支的推进次序。
 *  确认不关闭任务、不解除风险（openspec 主规格 module-interfaces-events-workflows §预警确认）。 */
export const WARNING_TASK_STATUSES = [
  { id: 'open', label: '待确认' },
  { id: 'acknowledged', label: '已确认' },
  { id: 'adopted', label: '建议已采纳' },
  { id: 'executing', label: '处置执行中' },
  { id: 'feedback', label: '反馈已登记' },
  { id: 'closed', label: '已闭环' },
] as const;

export type WarningTaskStatusId = (typeof WARNING_TASK_STATUSES)[number]['id'];

/**
 * 触发指标展示项。契约字段：indicatorItem / triggerType / actualValue
 * （TriggerIndicatorSchema，actualValue 为 ScalarValue，此处取数值型监测量）。
 * threshold / exceedDirection / unit 为展示用阈值快照，事实源是
 * 监测预警阈值版本（monitoringWarningThresholdRef），契约是否随触发指标
 * 固化阈值快照见 GAP-WR-02。
 */
export interface WarningTriggerIndicatorView {
  readonly indicatorItem: string;
  readonly triggerType: WarningTriggerType;
  readonly actualValue: number;
  readonly unit: string;
  readonly threshold: string;
  readonly exceedDirection: 'above' | 'below';
  readonly evidenceReferences: readonly EvidenceReference[];
}

/** 通知意图展示项（契约仅有 NotificationIntentRefV1，字段预设见 GAP-WR-04）。 */
export interface NotificationIntentView {
  readonly notificationIntentId: string;
  readonly channel: string;
  readonly recipientRole: string;
  readonly status: string;
}

export interface WarningRecordView {
  // —— 契约字段（WarningRecordSchema）——
  readonly warningRecordId: string;
  readonly assessmentRecordId: string;
  readonly warningLevel: WarningLevelId;
  /** 单值（G2 校正）；v1 的数组 triggerTypes 经 triggerIndicators 逐项表达。 */
  readonly triggerType: WarningTriggerType;
  readonly triggerIndicators: readonly WarningTriggerIndicatorView[];
  readonly evidenceReferences: readonly EvidenceReference[];
  readonly recommendedResponseDirection: string;
  readonly notificationStatus: string;
  readonly audit: AuditInfo;
  // —— 展示补充：追溯链上游标识与开立命令策略引用 ——
  readonly riskRecordId: string;
  readonly riskEventSummary: string;
  readonly warningAggregationPolicyRef: VersionReference;
  readonly notificationPolicyRef: VersionReference;
  readonly monitoringWarningThresholdRef: VersionReference;
  readonly notificationIntents: readonly NotificationIntentView[];
  readonly warningResponseTaskId: string;
  readonly openedAt: string;
}

export interface TaskTimelineEvent {
  readonly at: string;
  readonly actorLabel: string;
  readonly action: string;
}

export interface WarningResponseTaskView {
  readonly warningResponseTaskId: string;
  readonly title: string;
  readonly warningRecordIds: readonly string[];
  readonly riskRecordId: string;
  readonly status: WarningTaskStatusId;
  /** 责任角色：contract-mirror 五角色键。 */
  readonly ownerRole: 'project-risk-manager' | 'field-responder';
  readonly acknowledgedBy: { readonly actorId: string; readonly actorLabel: string; readonly at: string } | null;
  readonly recommendationId: string | null;
  readonly highestWarningLevel: WarningLevelId;
  readonly openedAt: string;
  readonly timeline: readonly TaskTimelineEvent[];
}

const CANONICAL_EVIDENCE: EvidenceReference = {
  locator: { sourceSegmentId: 'DOC2026001-S32-SEG007' },
  sourceVersion: { entityId: 'DOC2026001', versionId: 'v1.0' },
};

const MONITORING_SNAPSHOT_EVIDENCE: EvidenceReference = {
  locator: { sourceSegmentId: 'MON-2026-0827-0900' },
  sourceVersion: { entityId: 'MON-BATCH-2026-0827', versionId: 'v2026.08' },
};

const THRESHOLD_REF: VersionReference = { entityId: 'MWT-001', versionId: 'v2026.08' };
const AGGREGATION_POLICY_REF: VersionReference = { entityId: 'WAP-001', versionId: 'v2026.09' };
const NOTIFICATION_POLICY_REF: VersionReference = { entityId: 'NP-001', versionId: 'v2026.09' };

export const WARNING_RECORDS: readonly WarningRecordView[] = [
  {
    warningRecordId: 'WARN-2026-001',
    assessmentRecordId: 'ASSESS-2026-001',
    warningLevel: 'I',
    triggerType: '多指标联合规则命中',
    triggerIndicators: [
      {
        indicatorItem: '地表沉降',
        triggerType: '监测指标越限',
        actualValue: 13.6,
        unit: 'mm',
        threshold: '12.0 mm',
        exceedDirection: 'above',
        evidenceReferences: [MONITORING_SNAPSHOT_EVIDENCE],
      },
      {
        indicatorItem: '地表沉降短期斜率',
        triggerType: '趋势/加速度/异常评分越限',
        actualValue: 2.3,
        unit: 'mm/d',
        threshold: '2.0 mm/d',
        exceedDirection: 'above',
        evidenceReferences: [MONITORING_SNAPSHOT_EVIDENCE],
      },
      {
        indicatorItem: '支护结构变形',
        triggerType: '监测指标越限',
        actualValue: 8.4,
        unit: 'mm',
        threshold: '8.0 mm',
        exceedDirection: 'above',
        evidenceReferences: [MONITORING_SNAPSHOT_EVIDENCE],
      },
      {
        indicatorItem: '注浆压力',
        triggerType: '监测指标越限',
        actualValue: 0.18,
        unit: 'MPa',
        threshold: '0.20–0.25 MPa',
        exceedDirection: 'below',
        evidenceReferences: [MONITORING_SNAPSHOT_EVIDENCE],
      },
    ],
    evidenceReferences: [CANONICAL_EVIDENCE, MONITORING_SNAPSHOT_EVIDENCE],
    recommendedResponseDirection: '现场确认与处置',
    notificationStatus: '通知已送达',
    audit: {
      actorId: 'system',
      action: 'warning-response.open',
      recordedAt: '2026-08-27T09:22:00+08:00',
    },
    riskRecordId: 'RISK-2026-001',
    riskEventSummary: '变径空间扩挖引发过挖与地表沉降超限',
    warningAggregationPolicyRef: AGGREGATION_POLICY_REF,
    notificationPolicyRef: NOTIFICATION_POLICY_REF,
    monitoringWarningThresholdRef: THRESHOLD_REF,
    notificationIntents: [
      {
        notificationIntentId: 'NTI-2026-001',
        channel: '站内通知',
        recipientRole: 'project-risk-manager',
        status: '已送达',
      },
      {
        notificationIntentId: 'NTI-2026-002',
        channel: '短信',
        recipientRole: 'field-responder',
        status: '已送达',
      },
    ],
    warningResponseTaskId: 'WRT-2026-001',
    openedAt: '2026-08-27 09:22',
  },
  {
    warningRecordId: 'WARN-2026-002',
    assessmentRecordId: 'ASSESS-2026-003',
    warningLevel: 'II',
    triggerType: '监测指标越限',
    triggerIndicators: [
      {
        indicatorItem: '同步注浆量',
        triggerType: '监测指标越限',
        actualValue: 3.2,
        unit: 'm³/环',
        threshold: '4.0 m³/环',
        exceedDirection: 'below',
        evidenceReferences: [MONITORING_SNAPSHOT_EVIDENCE],
      },
    ],
    evidenceReferences: [MONITORING_SNAPSHOT_EVIDENCE],
    recommendedResponseDirection: '注浆参数复核与补注浆',
    notificationStatus: '通知已送达',
    audit: {
      actorId: 'system',
      action: 'warning-response.open',
      recordedAt: '2026-08-27T08:47:00+08:00',
    },
    riskRecordId: 'RISK-2026-002',
    riskEventSummary: '扩挖段同步注浆不密实导致地层损失',
    warningAggregationPolicyRef: AGGREGATION_POLICY_REF,
    notificationPolicyRef: NOTIFICATION_POLICY_REF,
    monitoringWarningThresholdRef: THRESHOLD_REF,
    notificationIntents: [
      {
        notificationIntentId: 'NTI-2026-003',
        channel: '站内通知',
        recipientRole: 'project-risk-manager',
        status: '已送达',
      },
    ],
    warningResponseTaskId: 'WRT-2026-002',
    openedAt: '2026-08-27 08:47',
  },
  {
    warningRecordId: 'WARN-2026-003',
    assessmentRecordId: 'ASSESS-2026-002',
    warningLevel: 'II',
    triggerType: '趋势/加速度/异常评分越限',
    triggerIndicators: [
      {
        indicatorItem: '拱顶沉降短期速率',
        triggerType: '趋势/加速度/异常评分越限',
        actualValue: 2.6,
        unit: 'mm/d',
        threshold: '2.0 mm/d',
        exceedDirection: 'above',
        evidenceReferences: [MONITORING_SNAPSHOT_EVIDENCE],
      },
    ],
    evidenceReferences: [MONITORING_SNAPSHOT_EVIDENCE],
    recommendedResponseDirection: '加强监测频次与支护参数复核',
    notificationStatus: '通知已送达',
    audit: {
      actorId: 'system',
      action: 'warning-response.open',
      recordedAt: '2026-08-27T08:12:00+08:00',
    },
    riskRecordId: 'RISK-2026-001',
    riskEventSummary: '变径空间扩挖段拱顶沉降速率加快',
    warningAggregationPolicyRef: AGGREGATION_POLICY_REF,
    notificationPolicyRef: NOTIFICATION_POLICY_REF,
    monitoringWarningThresholdRef: THRESHOLD_REF,
    notificationIntents: [
      {
        notificationIntentId: 'NTI-2026-004',
        channel: '站内通知',
        recipientRole: 'project-risk-manager',
        status: '已送达',
      },
    ],
    warningResponseTaskId: 'WRT-2026-003',
    openedAt: '2026-08-27 08:12',
  },
  {
    warningRecordId: 'WARN-2026-004',
    assessmentRecordId: 'ASSESS-2026-004',
    warningLevel: 'II',
    triggerType: '多指标联合规则命中',
    triggerIndicators: [
      {
        indicatorItem: '支护结构变形',
        triggerType: '监测指标越限',
        actualValue: 9.1,
        unit: 'mm',
        threshold: '8.0 mm',
        exceedDirection: 'above',
        evidenceReferences: [MONITORING_SNAPSHOT_EVIDENCE],
      },
      {
        indicatorItem: '钢支撑轴力',
        triggerType: '监测指标越限',
        actualValue: 78,
        unit: 'kN',
        threshold: '65 kN',
        exceedDirection: 'above',
        evidenceReferences: [MONITORING_SNAPSHOT_EVIDENCE],
      },
    ],
    evidenceReferences: [MONITORING_SNAPSHOT_EVIDENCE],
    recommendedResponseDirection: '支护参数复核与加强监测',
    notificationStatus: '预警已入库',
    audit: {
      actorId: 'system',
      action: 'warning-response.open',
      recordedAt: '2026-08-26T17:36:00+08:00',
    },
    riskRecordId: 'RISK-2026-003',
    riskEventSummary: '变径段围护结构变形超限',
    warningAggregationPolicyRef: AGGREGATION_POLICY_REF,
    notificationPolicyRef: NOTIFICATION_POLICY_REF,
    monitoringWarningThresholdRef: THRESHOLD_REF,
    notificationIntents: [
      {
        notificationIntentId: 'NTI-2026-005',
        channel: '站内通知',
        recipientRole: 'project-risk-manager',
        status: '待投递',
      },
    ],
    warningResponseTaskId: 'WRT-2026-004',
    openedAt: '2026-08-26 17:36',
  },
];

export const WARNING_RESPONSE_TASKS: readonly WarningResponseTaskView[] = [
  {
    warningResponseTaskId: 'WRT-2026-001',
    title: '变径空间扩挖 I 级风险处置任务',
    warningRecordIds: ['WARN-2026-001'],
    riskRecordId: 'RISK-2026-001',
    status: 'feedback',
    ownerRole: 'field-responder',
    acknowledgedBy: {
      actorId: 'U-PRM-001',
      actorLabel: '项目风险负责人',
      at: '2026-08-27 09:35',
    },
    recommendationId: 'RESP-2026-001',
    highestWarningLevel: 'I',
    openedAt: '2026-08-27 09:22',
    timeline: [
      { at: '2026-08-27 09:22', actorLabel: '系统', action: '预警入库并开立处置任务' },
      { at: '2026-08-27 09:23', actorLabel: '系统', action: '通知意图 NTI-2026-001 / NTI-2026-002 送达' },
      { at: '2026-08-27 09:35', actorLabel: '项目风险负责人', action: '确认预警，接管处置任务' },
      { at: '2026-08-27 09:48', actorLabel: '系统', action: '处置建议 RESP-2026-001 记录，三项校验通过' },
      { at: '2026-08-27 09:52', actorLabel: '项目风险负责人', action: '登记采纳决定 RD-2026-001（采纳）' },
      { at: '2026-08-27 10:40', actorLabel: '现场处置员', action: '登记现场处置执行 EXE-2026-001' },
      { at: '2026-08-29 16:05', actorLabel: '现场处置员', action: '登记处置反馈 FBK-2026-001' },
    ],
  },
  {
    warningResponseTaskId: 'WRT-2026-002',
    title: '变径空间扩挖同步注浆不密实处置任务',
    warningRecordIds: ['WARN-2026-002'],
    riskRecordId: 'RISK-2026-002',
    status: 'open',
    ownerRole: 'field-responder',
    acknowledgedBy: null,
    recommendationId: null,
    highestWarningLevel: 'II',
    openedAt: '2026-08-27 08:47',
    timeline: [
      { at: '2026-08-27 08:47', actorLabel: '系统', action: '预警入库并开立处置任务' },
      { at: '2026-08-27 08:48', actorLabel: '系统', action: '通知意图 NTI-2026-003 送达' },
    ],
  },
  {
    warningResponseTaskId: 'WRT-2026-003',
    title: '拱顶沉降速率超限处置任务',
    warningRecordIds: ['WARN-2026-003'],
    riskRecordId: 'RISK-2026-001',
    status: 'executing',
    ownerRole: 'field-responder',
    acknowledgedBy: {
      actorId: 'U-PRM-001',
      actorLabel: '项目风险负责人',
      at: '2026-08-27 08:30',
    },
    recommendationId: null,
    highestWarningLevel: 'II',
    openedAt: '2026-08-27 08:12',
    timeline: [
      { at: '2026-08-27 08:12', actorLabel: '系统', action: '预警入库并开立处置任务' },
      { at: '2026-08-27 08:13', actorLabel: '系统', action: '通知意图 NTI-2026-004 送达' },
      { at: '2026-08-27 08:30', actorLabel: '项目风险负责人', action: '确认预警，接管处置任务' },
      { at: '2026-08-27 09:05', actorLabel: '现场处置员', action: '登记独立处置行动：加密沉降监测与支护核查' },
    ],
  },
  {
    warningResponseTaskId: 'WRT-2026-004',
    title: '围护结构变形超限处置任务',
    warningRecordIds: ['WARN-2026-004'],
    riskRecordId: 'RISK-2026-003',
    status: 'acknowledged',
    ownerRole: 'field-responder',
    acknowledgedBy: {
      actorId: 'U-PRM-002',
      actorLabel: '项目风险负责人',
      at: '2026-08-26 18:02',
    },
    recommendationId: null,
    highestWarningLevel: 'II',
    openedAt: '2026-08-26 17:36',
    timeline: [
      { at: '2026-08-26 17:36', actorLabel: '系统', action: '预警入库并开立处置任务' },
      { at: '2026-08-26 18:02', actorLabel: '项目风险负责人', action: '确认预警，接管处置任务' },
    ],
  },
];

export function warningById(warningRecordId: string): WarningRecordView | undefined {
  return WARNING_RECORDS.find((warning) => warning.warningRecordId === warningRecordId);
}

export function warningTaskById(taskId: string): WarningResponseTaskView | undefined {
  return WARNING_RESPONSE_TASKS.find((task) => task.warningResponseTaskId === taskId);
}

export function warningTaskForWarning(
  warningRecordId: string,
): WarningResponseTaskView | undefined {
  return WARNING_RESPONSE_TASKS.find((task) => task.warningRecordIds.includes(warningRecordId));
}

export function warningLevelById(levelId: WarningLevelId) {
  return WARNING_LEVELS.find((level) => level.id === levelId) ?? WARNING_LEVELS[1];
}

export function taskStatusById(statusId: WarningTaskStatusId) {
  return WARNING_TASK_STATUSES.find((status) => status.id === statusId) ?? WARNING_TASK_STATUSES[0];
}

/** 触发摘要：指标项名称去重拼接 + 触发项计数。 */
export function triggerSummaryOf(warning: WarningRecordView): string {
  const items = [...new Set(warning.triggerIndicators.map((indicator) => indicator.indicatorItem))];
  const head = items.slice(0, 3).join('、');
  return `${head}等 ${warning.triggerIndicators.length} 项触发`;
}
