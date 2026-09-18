// 处置域 fixture（P-RS-01～P-RS-05，归属 C34）。
// 字段形状以 packages/contracts 为准（G2 校正）：
// - 处置建议 ResponseRecommendation：src/records/index.ts:252-266（measureItems /
//   implementationOrder / resourceRequirements / targetIndicators / 三项校验
//   ValidationResult / reviewStatus / version / audit）；
// - 偏差记录 DeviationRecord：src/records/index.ts:275-288（predictedRiskChange /
//   actualRiskChange / deviationValue / deviationThresholdVersion / calibrationRecommendation）；
// - 执行登记 / 反馈登记字段：src/ports/index.ts:1542-1562（record-execution /
//   record-feedback 命令 payload，含 ActionSource 判别联合）；
// - 效果预测输入快照：src/workflows/index.ts:176-188（ResponseForecastInputSnapshotV1Schema）；
// - 校准建议创建命令与成功结果：src/ports/index.ts:1572-1580、:2221-2225
//   （成功结果含复核任务引用）。
// 效果预测 / 执行记录 / 反馈记录 / 校准建议在契约中仅有引用类型、无记录 Schema，
// 相应展示字段为预设，已在 docs/gap-inbox/response.md 登记（GAP-RS-01～03）。
// 语义红线：三项校验通过仅使建议成为正式建议；采纳与执行由人决定，本域页面不呈现
// 自动生效语义；校准生效必须人工确认。
// 跨域标识沿典范追溯链：DOC2026001-S32-SEG007 → PN-VDS-04 → MEC-VDS-017 →
// RISK-2026-001 → RUN-A-2026-001 / ASSESS-2026-001 → WARN-2026-001 → RESP-2026-001 →
// EXE-2026-001 → FBK-2026-001 → DEV-2026-001 → CAL-2026-001（处置任务 WRT-2026-001）。

import type { TrendSeries, TrendThreshold } from '../charts';

/** 对齐 contracts VersionReferenceSchema。 */
export interface VersionRef {
  readonly entityId: string;
  readonly versionId: string;
}

/** 对齐 contracts EvidenceReferenceSchema。 */
export interface EvidenceRef {
  readonly locator: { readonly sourceSegmentId: string };
  readonly sourceVersion: VersionRef;
}

/** 对齐 contracts AuditInfoSchema。 */
export interface AuditInfo {
  readonly actorId: string;
  readonly action: string;
  readonly recordedAt: string;
  readonly reason?: string;
}

/** 对齐 contracts ReviewStatusSchema。 */
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export const REVIEW_STATUS_LABELS: Readonly<Record<ReviewStatus, string>> = {
  pending: '待复核确认',
  approved: '已通过',
  rejected: '已退回',
};

/** 对齐 contracts ValidationResultSchema。 */
export interface ValidationResultView {
  readonly passed: boolean;
  readonly issues: readonly string[];
}

/** 对齐 contracts RiskStateSchema；riskLevel 为矩阵版本 levels 的 key。 */
export interface RiskStateView {
  readonly likelihoodScore: number;
  readonly consequenceScore: number;
  readonly riskLevel: string;
}

/** 对齐 contracts VersionedRecordInfoSchema。 */
export interface VersionedRecordInfoView {
  readonly reference: VersionRef;
  readonly effectivePeriod: { readonly validFrom: string; readonly validTo?: string };
  readonly systemTime: { readonly recordedAt: string; readonly supersededAt?: string };
}

export interface TimelineEvent {
  readonly at: string;
  readonly actorLabel: string;
  readonly action: string;
}

// ---------------------------------------------------------------------------
// 版本引用（不可变快照；页面呈现格式「类别 entityId · versionId」）
// ---------------------------------------------------------------------------

/** 措施库版本与知识域 fixture（knowledge.ts MEASURE_LIBRARY_REF）一致。 */
export const MEASURE_LIBRARY_REF: VersionRef = { entityId: 'MSL-VDS-001', versionId: 'v2026.08' };

export const RESPONSE_POLICY_REFS = {
  /** 处置生成策略（create-candidate payload responseGenerationPolicyRef）。 */
  generationPolicy: { entityId: 'RGP-001', versionId: 'v2026.08' },
  /** 处置校验策略（validate-and-record payload responseValidationPolicyRef）。 */
  validationPolicy: { entityId: 'RVP-001', versionId: 'v2026.08' },
  /** 现场条件快照（validate-and-record payload siteContextRef）。 */
  siteContext: { entityId: 'SITE-CTX-2026-08', versionId: 'v2026.08' },
  /** 处置效果预测策略（forecast 输入快照 forecastPolicyRef）。 */
  forecastPolicy: { entityId: 'FCP-001', versionId: 'v2026.08' },
  /** 偏差判定策略（反馈输入快照 deviationPolicyRef）。 */
  deviationPolicy: { entityId: 'DVP-001', versionId: 'v2026.08' },
  /** 校准校验策略（create-calibration-suggestion payload calibrationValidationPolicyRef）。 */
  calibrationValidationPolicy: { entityId: 'CVP-001', versionId: 'v2026.08' },
} as const satisfies Readonly<Record<string, VersionRef>>;

/** 冻结的评估依据输入快照（forecast / deviation 命令的 frozenAssessmentBasisRef）。 */
export const FROZEN_ASSESSMENT_BASIS_REF: VersionRef = {
  entityId: 'AIS-A-20260827-001',
  versionId: 'v1',
};

/** 偏差阈值版本（DeviationRecord.deviationThresholdVersion）。 */
export const DEVIATION_THRESHOLD_REF: VersionRef = { entityId: 'DVT-001', versionId: 'v2026.08' };

// ---------------------------------------------------------------------------
// 证据与审计公共件
// ---------------------------------------------------------------------------

const DOC_SOURCE_VERSION: VersionRef = { entityId: 'DOC2026001', versionId: 'v1.0' };
const MON_SOURCE_VERSION: VersionRef = { entityId: 'MON-BATCH-2026-0829', versionId: 'v2026.08' };

function evidence(sourceSegmentId: string, sourceVersion: VersionRef = DOC_SOURCE_VERSION): EvidenceRef {
  return { locator: { sourceSegmentId }, sourceVersion };
}

/** 典范链资料段证据（与预警域 fixture 一致）。 */
export const CANONICAL_EVIDENCE: EvidenceRef = evidence('DOC2026001-S32-SEG007');

/** 处置后监测快照证据。 */
export const POST_ACTION_MONITORING_EVIDENCE: EvidenceRef = evidence(
  'MON-2026-0829-1600',
  MON_SOURCE_VERSION,
);

/** 现场处置记录段证据。 */
export const FIELD_LOG_EVIDENCE: EvidenceRef = evidence('DOC2026001-S61-SEG014');

// ---------------------------------------------------------------------------
// P-RS-01 处置建议（对齐 ResponseRecommendationSchema）
// ---------------------------------------------------------------------------

/** 对齐 contracts MeasureItemSchema。 */
export interface MeasureItemView {
  readonly measureId: string;
  readonly content: string;
}

/** 对齐 contracts TargetIndicatorSchema。 */
export interface TargetIndicatorView {
  readonly indicatorItem: string;
  readonly targetValue: string;
}

/** 三项校验的呈现顺序与标签（字段名对齐契约，标签为展示文案）。 */
export const VALIDATION_LABELS = {
  triggerConsistencyValidation: '触发指标一致性校验',
  standardsComplianceValidation: '规范符合性校验',
  siteFeasibilityValidation: '现场资源与工序约束可执行性校验',
} as const;

export type ValidationKey = keyof typeof VALIDATION_LABELS;

/** 采纳决定（adopt-recommendation 命令 payload：decision / reasonCode + 路由决定引用）。 */
export interface AdoptionDecisionView {
  readonly decisionRef: VersionRef;
  readonly decision: 'adopted' | 'declined';
  readonly decidedByActorId: string;
  readonly decidedByLabel: string;
  readonly decidedAt: string;
  readonly reasonCode: string;
}

export interface ResponseRecommendationView {
  // —— 契约字段（ResponseRecommendationSchema）——
  readonly responseRecommendationId: string;
  readonly warningRecordId: string;
  readonly measureItems: readonly MeasureItemView[];
  readonly implementationOrder: readonly string[];
  readonly resourceRequirements: readonly string[];
  readonly targetIndicators: readonly TargetIndicatorView[];
  readonly triggerConsistencyValidation: ValidationResultView;
  readonly standardsComplianceValidation: ValidationResultView;
  readonly siteFeasibilityValidation: ValidationResultView;
  readonly reviewStatus: ReviewStatus;
  readonly version: VersionedRecordInfoView;
  readonly audit: AuditInfo;
  // —— 展示补充：候选来源、版本引用与采纳决定 ——
  readonly warningResponseTaskId: string;
  readonly riskRecordId: string;
  readonly assessmentRecordId: string;
  readonly measureLibraryRef: VersionRef;
  readonly generationPolicyRef: VersionRef;
  readonly validationPolicyRef: VersionRef;
  readonly siteContextRef: VersionRef;
  /** 候选来源（create-candidate 成功结果：候选引用；措施检索结果引用）。 */
  readonly candidateRef: VersionRef;
  readonly measureQueryResultRef: VersionRef;
  /** 排序依据说明：implementationOrder 只有顺序数组，理由为展示预设（见 GAP-RS-04）。 */
  readonly orderingBasis: string;
  readonly adoptionDecision: AdoptionDecisionView | null;
  readonly timeline: readonly TimelineEvent[];
}

export const RESPONSE_RECOMMENDATIONS: readonly ResponseRecommendationView[] = [
  {
    responseRecommendationId: 'RESP-2026-001',
    warningRecordId: 'WARN-2026-001',
    measureItems: [
      {
        measureId: 'MS-PARAM-02',
        content: '复核当前扩挖进尺与支护闭合状态，按已审批方案控制作业节奏',
      },
      {
        measureId: 'MS-GROUT-01',
        content: '复核注浆压力与注浆量，使其恢复至生效规则允许区间',
      },
      {
        measureId: 'MS-SUPPORT-03',
        content: '检查伸缩帽檐、钢管片与锚杆支护状态，必要时执行经审批的加固措施',
      },
      {
        measureId: 'MS-MON-05',
        content: '按预警响应等级加密地表沉降和支护结构变形监测',
      },
    ],
    implementationOrder: ['MS-PARAM-02', 'MS-GROUT-01', 'MS-SUPPORT-03', 'MS-MON-05'],
    resourceRequirements: [
      '现场负责人',
      '技术负责人',
      '注浆班组',
      '注浆设备与材料',
      '支护班组',
      '加固材料',
      '监测人员',
      '监测设备',
    ],
    targetIndicators: [
      { indicatorItem: '支护结构变形', targetValue: '变形速率不再加速' },
      { indicatorItem: '注浆压力', targetValue: '恢复至 0.20–0.25 MPa' },
      { indicatorItem: '地表沉降短期斜率', targetValue: '回落至 ≤2.0 mm/d' },
    ],
    triggerConsistencyValidation: { passed: true, issues: [] },
    standardsComplianceValidation: { passed: true, issues: [] },
    siteFeasibilityValidation: { passed: true, issues: [] },
    reviewStatus: 'approved',
    version: {
      reference: { entityId: 'RESP-2026-001', versionId: 'v1.0' },
      effectivePeriod: { validFrom: '2026-08-27T09:48:00+08:00' },
      systemTime: { recordedAt: '2026-08-27T09:48:00+08:00' },
    },
    audit: {
      actorId: 'system',
      action: 'warning-response.validate-and-record',
      recordedAt: '2026-08-27T09:48:00+08:00',
    },
    warningResponseTaskId: 'WRT-2026-001',
    riskRecordId: 'RISK-2026-001',
    assessmentRecordId: 'ASSESS-2026-001',
    measureLibraryRef: MEASURE_LIBRARY_REF,
    generationPolicyRef: RESPONSE_POLICY_REFS.generationPolicy,
    validationPolicyRef: RESPONSE_POLICY_REFS.validationPolicy,
    siteContextRef: RESPONSE_POLICY_REFS.siteContext,
    candidateRef: { entityId: 'RC-2026-001', versionId: 'v1' },
    measureQueryResultRef: { entityId: 'KQR-2026-001', versionId: 'v1' },
    orderingBasis:
      '由处置生成策略对措施库候选作约束组合：先控制作业节奏与参数恢复，再结构核查加固，最后监测加密',
    adoptionDecision: {
      decisionRef: { entityId: 'RD-2026-001', versionId: 'v1' },
      decision: 'adopted',
      decidedByActorId: 'U-PRM-001',
      decidedByLabel: '项目风险负责人',
      decidedAt: '2026-08-27 09:52',
      reasonCode: '三项校验通过，现场具备执行条件',
    },
    timeline: [
      { at: '2026-08-27 09:22', actorLabel: '系统', action: '预警 WARN-2026-001 入库并开立处置任务' },
      { at: '2026-08-27 09:44', actorLabel: '系统', action: '措施库检索完成，处置建议 Agent 任务生成候选 RC-2026-001' },
      { at: '2026-08-27 09:48', actorLabel: '系统', action: '三项校验通过，处置建议 RESP-2026-001 入库成为正式建议' },
      { at: '2026-08-27 09:52', actorLabel: '项目风险负责人', action: '登记采纳决定 RD-2026-001（采纳）' },
      { at: '2026-08-27 10:40', actorLabel: '现场处置员', action: '登记现场处置执行 EXE-2026-001' },
    ],
  },
];

export function recommendationById(
  recommendationId: string,
): ResponseRecommendationView | undefined {
  return RESPONSE_RECOMMENDATIONS.find(
    (recommendation) => recommendation.responseRecommendationId === recommendationId,
  );
}

// ---------------------------------------------------------------------------
// P-RS-02 现场处置执行登记（字段对齐 record-execution 命令 payload）
// ---------------------------------------------------------------------------

/** 执行来源（对齐 ActionSourceV1 判别联合）。 */
export type ActionSourceView =
  | { readonly kind: 'adopted-recommendation'; readonly responseRecommendationRef: VersionRef }
  | { readonly kind: 'independent-action'; readonly measureReleaseRefs: readonly VersionRef[] };

export const ACTION_SOURCE_LABELS: Readonly<Record<ActionSourceView['kind'], string>> = {
  'adopted-recommendation': '已采纳的处置建议',
  'independent-action': '独立处置行动',
};

/** 执行记录展示视图（契约仅有 ExecutionRecordRefV1，本体字段见 GAP-RS-02）。 */
export interface ExecutionRecordView {
  readonly executionRecordId: string;
  readonly actionSource: ActionSourceView;
  readonly executedByActorId: string;
  readonly executedByLabel: string;
  readonly recordedByActorId: string;
  readonly occurredAt: string;
  readonly evidenceReferences: readonly EvidenceRef[];
  /** 已执行的措施项（按建议 implementationOrder 的子集）。 */
  readonly executedMeasureIds: readonly string[];
  /** 未执行措施说明（现场核查结论）。 */
  readonly skippedMeasureNote: string | null;
  readonly audit: AuditInfo;
}

export const EXECUTION_RECORDS: readonly ExecutionRecordView[] = [
  {
    executionRecordId: 'EXE-2026-001',
    actionSource: {
      kind: 'adopted-recommendation',
      responseRecommendationRef: { entityId: 'RESP-2026-001', versionId: 'v1.0' },
    },
    executedByActorId: 'U-FR-001',
    executedByLabel: '现场处置员',
    recordedByActorId: 'U-FR-001',
    occurredAt: '2026-08-27T10:40:00+08:00',
    evidenceReferences: [FIELD_LOG_EVIDENCE, POST_ACTION_MONITORING_EVIDENCE],
    executedMeasureIds: ['MS-PARAM-02', 'MS-GROUT-01', 'MS-MON-05'],
    skippedMeasureNote: 'MS-SUPPORT-03 经现场核查暂不执行（支护结构变形未继续发展）',
    audit: {
      actorId: 'U-FR-001',
      action: 'warning-response.record-execution',
      recordedAt: '2026-08-27T10:45:00+08:00',
    },
  },
];

export function executionById(executionRecordId: string): ExecutionRecordView | undefined {
  return EXECUTION_RECORDS.find((record) => record.executionRecordId === executionRecordId);
}

/** 执行登记表单预置（P-RS-02）：默认登记对象为已采纳建议，证据引用随表单给出。 */
export interface ExecutionRegisterFormView {
  readonly warningResponseTaskId: string;
  readonly recommendationId: string;
  readonly defaultOccurredAt: string;
  readonly executedByActorId: string;
  readonly executedByLabel: string;
  readonly recordedByActorId: string;
  readonly evidenceOptions: readonly EvidenceRef[];
  readonly timeline: readonly TimelineEvent[];
}

export const EXECUTION_REGISTER_FORM: ExecutionRegisterFormView = {
  warningResponseTaskId: 'WRT-2026-001',
  recommendationId: 'RESP-2026-001',
  defaultOccurredAt: '2026-08-27 10:40',
  executedByActorId: 'U-FR-001',
  executedByLabel: '现场处置员',
  recordedByActorId: 'U-FR-001',
  evidenceOptions: [FIELD_LOG_EVIDENCE, POST_ACTION_MONITORING_EVIDENCE, CANONICAL_EVIDENCE],
  timeline: [
    { at: '2026-08-27 09:52', actorLabel: '项目风险负责人', action: '采纳处置建议 RESP-2026-001' },
    { at: '2026-08-27 10:40', actorLabel: '现场处置员', action: '现场执行注浆参数复核与监测加密' },
    { at: '2026-08-27 10:45', actorLabel: '现场处置员', action: '登记执行记录 EXE-2026-001' },
    { at: '2026-08-29 16:05', actorLabel: '现场处置员', action: '登记处置反馈 FBK-2026-001' },
  ],
};

// ---------------------------------------------------------------------------
// P-RS-03 处置效果预测（输入快照对齐 ResponseForecastInputSnapshotV1Schema）
// ---------------------------------------------------------------------------

/** 效果预测展示视图（契约仅有 EffectForecastRefV1，本体字段见 GAP-RS-01）。 */
export interface EffectForecastView {
  readonly forecastId: string;
  readonly responseRecommendationId: string;
  readonly adoptionDecisionRef: VersionRef;
  readonly preActionMonitoringSnapshotRef: VersionRef;
  readonly frozenAssessmentBasisRef: VersionRef;
  readonly forecastPolicyRef: VersionRef;
  readonly predictionWindow: string;
  /** 预测依据说明（含类比案例引用）。 */
  readonly basisNotes: readonly string[];
  readonly predictedRiskChange: RiskStateView;
  /** 逐指标预测（指标项 / 处置前取值 / 预测取值 / 目标口径）。 */
  readonly predictedIndicators: readonly {
    readonly indicatorItem: string;
    readonly unit: string;
    readonly beforeValue: number;
    readonly predictedValue: number;
    readonly targetValue: string;
  }[];
  /** 预测趋势曲线（图表数据，主键指标为地表沉降短期斜率）。 */
  readonly trend: {
    readonly yUnit: string;
    readonly series: readonly TrendSeries[];
    readonly thresholds: readonly TrendThreshold[];
  };
  readonly audit: AuditInfo;
  readonly timeline: readonly TimelineEvent[];
}

export const EFFECT_FORECASTS: readonly EffectForecastView[] = [
  {
    forecastId: 'FRC-2026-001',
    responseRecommendationId: 'RESP-2026-001',
    adoptionDecisionRef: { entityId: 'RD-2026-001', versionId: 'v1' },
    preActionMonitoringSnapshotRef: { entityId: 'SNAP-MON-20260827-0900', versionId: 'v1' },
    frozenAssessmentBasisRef: FROZEN_ASSESSMENT_BASIS_REF,
    forecastPolicyRef: RESPONSE_POLICY_REFS.forecastPolicy,
    predictionWindow: '处置执行后 48 小时',
    basisNotes: [
      '冻结评估依据快照 AIS-A-20260827-001 · v1 与处置前监测快照联合重估',
      '类比案例 CASE-2023-001：注浆参数调整与监测加密后沉降速率回落',
      '目标指标以处置建议 RESP-2026-001 · v1.0 为准',
    ],
    predictedRiskChange: { likelihoodScore: 2, consequenceScore: 4, riskLevel: 'II' },
    predictedIndicators: [
      {
        indicatorItem: '地表沉降短期斜率',
        unit: 'mm/d',
        beforeValue: 2.3,
        predictedValue: 1.4,
        targetValue: '回落至 ≤2.0 mm/d',
      },
      {
        indicatorItem: '注浆压力',
        unit: 'MPa',
        beforeValue: 0.18,
        predictedValue: 0.22,
        targetValue: '恢复至 0.20–0.25 MPa',
      },
      {
        indicatorItem: '支护结构变形',
        unit: 'mm',
        beforeValue: 8.4,
        predictedValue: 8.6,
        targetValue: '变形速率不再加速',
      },
    ],
    trend: {
      yUnit: 'mm/d',
      series: [
        {
          key: 'predicted-settle-rate',
          label: '预测沉降短期斜率',
          kind: 'main',
          points: [
            { x: '处置前', y: 2.3, exceeded: true },
            { x: '+12h', y: 2.0 },
            { x: '+24h', y: 1.7 },
            { x: '+36h', y: 1.5 },
            { x: '+48h', y: 1.4 },
          ],
        },
      ],
      thresholds: [{ value: 2.0, label: '处置目标 ≤2.0 mm/d' }],
    },
    audit: {
      actorId: 'system',
      action: 'workflow.forecast-response',
      recordedAt: '2026-08-27T10:05:00+08:00',
    },
    timeline: [
      { at: '2026-08-27 09:52', actorLabel: '项目风险负责人', action: '采纳处置建议 RESP-2026-001' },
      { at: '2026-08-27 10:05', actorLabel: '系统', action: '效果预测 FRC-2026-001 生成（预测窗口 48 小时）' },
      { at: '2026-08-29 16:20', actorLabel: '系统', action: '偏差记录 DEV-2026-001 形成，预测值进入比对口径' },
    ],
  },
];

export function forecastById(forecastId: string): EffectForecastView | undefined {
  return EFFECT_FORECASTS.find((forecast) => forecast.forecastId === forecastId);
}

// ---------------------------------------------------------------------------
// P-RS-04 处置反馈与偏差记录（偏差记录对齐 DeviationRecordSchema）
// ---------------------------------------------------------------------------

/** 反馈记录展示视图（契约仅有 FeedbackRefV1，本体字段见 GAP-RS-02）。 */
export interface FeedbackRecordView {
  readonly feedbackId: string;
  readonly executionRecordId: string;
  readonly responseRecommendationId: string;
  readonly warningResponseTaskId: string;
  readonly postActionMonitoringSnapshotRef: VersionRef;
  readonly feedbackArtifactRef: VersionRef;
  readonly occurredAt: string;
  readonly summary: string;
  /** 处置后实测指标。 */
  readonly observedIndicators: readonly {
    readonly indicatorItem: string;
    readonly unit: string;
    readonly value: number;
    readonly note: string;
  }[];
  readonly evidenceReferences: readonly EvidenceRef[];
  readonly forecastId: string;
  readonly deviationRecordId: string;
  readonly audit: AuditInfo;
}

/** 偏差记录（对齐 DeviationRecordSchema；口径说明为展示预设）。 */
export interface DeviationRecordView {
  readonly deviationRecordId: string;
  readonly responseRecommendationId: string;
  readonly predictedRiskChange: RiskStateView;
  readonly actualRiskChange: RiskStateView;
  readonly deviationValue: number;
  readonly deviationThresholdVersion: VersionRef;
  readonly evidenceReferences: readonly EvidenceRef[];
  readonly calibrationRecommendation: string;
  readonly reviewStatus: ReviewStatus;
  readonly version: VersionedRecordInfoView;
  readonly audit: AuditInfo;
  // —— 展示补充 ——
  readonly feedbackId: string;
  readonly forecastId: string;
  /** 偏差计算口径：数据驱动呈现 ΔP / ΔC 与冻结阈值。 */
  readonly deviationBasis: string;
  readonly deviationThresholdValue: number;
  readonly exceeded: boolean;
  readonly timeline: readonly TimelineEvent[];
}

export const FEEDBACK_RECORDS: readonly FeedbackRecordView[] = [
  {
    feedbackId: 'FBK-2026-001',
    executionRecordId: 'EXE-2026-001',
    responseRecommendationId: 'RESP-2026-001',
    warningResponseTaskId: 'WRT-2026-001',
    postActionMonitoringSnapshotRef: { entityId: 'SNAP-MON-20260829-1600', versionId: 'v1' },
    feedbackArtifactRef: { entityId: 'ART-FBK-2026-001', versionId: 'v1.0' },
    occurredAt: '2026-08-29T16:05:00+08:00',
    summary:
      '注浆压力恢复至 0.21 MPa；地表沉降短期斜率回落至 1.6 mm/d，回落幅度不及预测的 1.4 mm/d',
    observedIndicators: [
      {
        indicatorItem: '注浆压力',
        unit: 'MPa',
        value: 0.21,
        note: '恢复至生效区间 0.20–0.25 MPa',
      },
      {
        indicatorItem: '地表沉降短期斜率',
        unit: 'mm/d',
        value: 1.6,
        note: '已回落至处置目标内，未达到预测值 1.4 mm/d',
      },
      {
        indicatorItem: '支护结构变形',
        unit: 'mm',
        value: 8.6,
        note: '增速放缓，变形速率不再加速',
      },
    ],
    evidenceReferences: [POST_ACTION_MONITORING_EVIDENCE, FIELD_LOG_EVIDENCE],
    forecastId: 'FRC-2026-001',
    deviationRecordId: 'DEV-2026-001',
    audit: {
      actorId: 'U-FR-001',
      action: 'warning-response.record-feedback',
      recordedAt: '2026-08-29T16:05:00+08:00',
    },
  },
];

export const DEVIATION_RECORDS: readonly DeviationRecordView[] = [
  {
    deviationRecordId: 'DEV-2026-001',
    responseRecommendationId: 'RESP-2026-001',
    predictedRiskChange: { likelihoodScore: 2, consequenceScore: 4, riskLevel: 'II' },
    actualRiskChange: { likelihoodScore: 3, consequenceScore: 4, riskLevel: 'II' },
    deviationValue: 1,
    deviationThresholdVersion: DEVIATION_THRESHOLD_REF,
    evidenceReferences: [POST_ACTION_MONITORING_EVIDENCE],
    calibrationRecommendation: 'CAL-2026-001',
    reviewStatus: 'approved',
    version: {
      reference: { entityId: 'DEV-2026-001', versionId: 'v1.0' },
      effectivePeriod: { validFrom: '2026-08-29T16:20:00+08:00' },
      systemTime: { recordedAt: '2026-08-29T16:20:00+08:00' },
    },
    audit: {
      actorId: 'system',
      action: 'warning-response.calculate-deviation',
      recordedAt: '2026-08-29T16:20:00+08:00',
    },
    feedbackId: 'FBK-2026-001',
    forecastId: 'FRC-2026-001',
    deviationBasis:
      'ΔP = |3 − 2| = 1，ΔC = |4 − 4| = 0；偏差值 = ΔP + ΔC = 1.0，超过冻结阈值 0.5，判定偏差超限',
    deviationThresholdValue: 0.5,
    exceeded: true,
    timeline: [
      { at: '2026-08-27 10:40', actorLabel: '现场处置员', action: '登记执行记录 EXE-2026-001' },
      { at: '2026-08-29 16:05', actorLabel: '现场处置员', action: '登记处置反馈 FBK-2026-001' },
      { at: '2026-08-29 16:20', actorLabel: '系统', action: '偏差记录 DEV-2026-001 形成，偏差值 1.0 超过冻结阈值 0.5' },
      { at: '2026-08-29 16:35', actorLabel: '系统', action: '创建校准建议 CAL-2026-001 与复核任务 RVT-2026-001' },
    ],
  },
];

export function feedbackById(feedbackId: string): FeedbackRecordView | undefined {
  return FEEDBACK_RECORDS.find((feedback) => feedback.feedbackId === feedbackId);
}

export function deviationById(deviationRecordId: string): DeviationRecordView | undefined {
  return DEVIATION_RECORDS.find((deviation) => deviation.deviationRecordId === deviationRecordId);
}

// ---------------------------------------------------------------------------
// P-RS-05 校准建议（契约仅有 CalibrationSuggestionRefV1，本体字段见 GAP-RS-03）
// ---------------------------------------------------------------------------

/** 校准建议展示视图：Agent 候选经确定性校验后的产物，生效必须人工确认。 */
export interface CalibrationSuggestionView {
  readonly calibrationSuggestionId: string;
  readonly deviationRecordId: string;
  readonly suggestionSummary: string;
  /** 校准目标：知识对象当前版本与建议调整内容。 */
  readonly targetKnowledge: readonly {
    readonly label: string;
    readonly ref: VersionRef;
    readonly change: string;
  }[];
  /** 生成来源：校准建议 Agent 任务（任务类型 calibration-suggestion，内嵌触发）。 */
  readonly agentTask: {
    readonly agentTaskRef: VersionRef;
    readonly taskTypeLabel: string;
    readonly triggerModeLabel: string;
    readonly modelDeploymentRef: VersionRef;
    readonly promptTemplateRef: VersionRef;
    readonly toolPolicyRef: VersionRef;
    readonly budgetPolicyRef: VersionRef;
  };
  readonly calibrationValidationPolicyRef: VersionRef;
  readonly validationResult: ValidationResultView;
  readonly reviewStatus: ReviewStatus;
  /** 创建成功即生成的复核任务引用（CalibrationSuggestionCreated 事件载荷）。 */
  readonly reviewTaskRef: VersionRef;
  readonly version: VersionedRecordInfoView;
  readonly audit: AuditInfo;
  readonly timeline: readonly TimelineEvent[];
}

export const CALIBRATION_SUGGESTIONS: readonly CalibrationSuggestionView[] = [
  {
    calibrationSuggestionId: 'CAL-2026-001',
    deviationRecordId: 'DEV-2026-001',
    suggestionSummary:
      '建议修订评分规则 RULE-EXPAND-02（地表沉降短期斜率）分档：将由注浆压力恢复主导的回落区间 1.4–2.0 mm/d 的得分由 3 调整为 2，并随适用规则集下一版本复核发布',
    targetKnowledge: [
      {
        label: '结构化评分规则',
        ref: { entityId: 'RULE-EXPAND-02', versionId: 'v1.3' },
        change: '分档区间 1.4–2.0 mm/d 的得分由 3 调整为 2',
      },
    ],
    agentTask: {
      agentTaskRef: { entityId: 'AGT-001', versionId: 'v1' },
      taskTypeLabel: '校准建议',
      triggerModeLabel: '内嵌',
      modelDeploymentRef: { entityId: 'MDL-VDS-001', versionId: 'v2026.08' },
      promptTemplateRef: { entityId: 'PT-CAL-001', versionId: 'v2026.08' },
      toolPolicyRef: { entityId: 'TP-CAL-001', versionId: 'v2026.08' },
      budgetPolicyRef: { entityId: 'BP-CAL-001', versionId: 'v2026.08' },
    },
    calibrationValidationPolicyRef: RESPONSE_POLICY_REFS.calibrationValidationPolicy,
    validationResult: { passed: true, issues: [] },
    reviewStatus: 'pending',
    reviewTaskRef: { entityId: 'RVT-2026-001', versionId: 'v1' },
    version: {
      reference: { entityId: 'CAL-2026-001', versionId: 'v1.0' },
      effectivePeriod: { validFrom: '2026-08-29T16:35:00+08:00' },
      systemTime: { recordedAt: '2026-08-29T16:35:00+08:00' },
    },
    audit: {
      actorId: 'system',
      action: 'warning-response.create-calibration-suggestion',
      recordedAt: '2026-08-29T16:35:00+08:00',
    },
    timeline: [
      { at: '2026-08-29 16:20', actorLabel: '系统', action: '偏差记录 DEV-2026-001 判定超限' },
      { at: '2026-08-29 16:32', actorLabel: '系统', action: '校准建议 Agent 任务 AGT-001 完成并产出候选' },
      { at: '2026-08-29 16:35', actorLabel: '系统', action: '确定性校验通过，校准建议 CAL-2026-001 入库并创建复核任务 RVT-2026-001' },
    ],
  },
];

export function calibrationById(suggestionId: string): CalibrationSuggestionView | undefined {
  return CALIBRATION_SUGGESTIONS.find(
    (suggestion) => suggestion.calibrationSuggestionId === suggestionId,
  );
}

// ---------------------------------------------------------------------------
// 深链（hash 路由；参数化目标用具体标识）
// ---------------------------------------------------------------------------

export const LINKS = {
  identificationRecord: (recordId: string) => `#/identification/records/${recordId}`,
  identificationProcessModel: '#/identification/process-model',
  knowledgeMechanisms: '#/knowledge/mechanisms',
  knowledgeMeasures: '#/knowledge/measures',
  knowledgeCases: '#/knowledge/cases',
  knowledgeRuleSets: '#/knowledge/rule-sets',
  assessmentRecord: (recordId: string) => `#/assessment/records/${recordId}`,
  warning: (warningId: string) => `#/warnings/${warningId}`,
  warningTask: (taskId: string) => `#/warnings/tasks/${taskId}`,
  evidenceTrace: '#/review-audit/trace',
  responseRecommendation: (recommendationId: string) =>
    `#/response/recommendations/${recommendationId}`,
  responseExecutionRegister: '#/response/executions/register',
  responsePrediction: (forecastId: string) => `#/response/predictions/${forecastId}`,
  responseFeedback: (feedbackId: string) => `#/response/feedback/${feedbackId}`,
  responseCalibration: (suggestionId: string) => `#/response/calibrations/${suggestionId}`,
  reviewTask: (reviewTaskId: string) => `#/review-audit/reviews/${reviewTaskId}`,
} as const;
