// 风险评估域 fixtures（C34）。
// 字段形状以 packages/contracts/src/records/index.ts、packages/contracts/src/workflows/index.ts
// 为准（G2 校正已落实）：评估记录含 weightVersion / indicatorResults / 四类版本引用与
// 适用性元数据快照；P、C 分值与风险等级分列，等级由矩阵版本映射得出；版本引用均为
// { entityId, versionId } 不可变快照。跨域标识沿典范追溯链对齐。

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

/** 适用性元数据快照（RA-S1 三个必含维度，对齐 ApplicabilityMetadataSchema）。 */
export interface ApplicabilitySnapshot {
  readonly constructionMethod: string;
  readonly stratumCondition: string;
  readonly engineeringStage: string;
}

/** 审计信息（对齐 AuditInfoSchema）。 */
export interface AuditInfo {
  readonly actorId: string;
  readonly action: string;
  readonly recordedAt: string;
  readonly reason?: string;
}

/** 评估入口模式（对齐 WorkflowEntryModeV1 中评估相关取值）。 */
export type AssessmentEntryMode = 'assess' | 'reassess' | 'historical-backfill';

export const ENTRY_MODE_LABELS: Readonly<Record<AssessmentEntryMode, string>> = {
  assess: '首次评估',
  reassess: '重新评估',
  'historical-backfill': '历史回溯评估',
};

/** 重评估触发原因（对齐 AssessmentPreparationCommandV1 reassessment.reason 枚举）。 */
export const TRIGGER_REASON_LABELS: Readonly<Record<string, string>> = {
  'initial-assessment': '首次评估（风险输入就绪后启动）',
  'monitoring-snapshot': '监测快照更新',
  'applicability-metadata': '适用性元数据变化',
  'applicable-rule-set': '适用规则集版本更新',
  'weight-or-strategy': '权重或评分策略版本更新',
  'risk-matrix': '风险矩阵版本更新',
  'historical-backfill': '历史资料回溯补评',
};

// ---------------------------------------------------------------------------
// 评估依据版本（不可变快照；页面呈现格式「类别 entityId · versionId」）
// ---------------------------------------------------------------------------

export const ASSESSMENT_BASIS_VERSIONS = {
  indicatorSystem: { entityId: 'QS-VDS', versionId: 'v2026.06' },
  applicableRuleSet: { entityId: 'RS-VDS-EXPAND', versionId: 'v2026.09.1' },
  weightSet: { entityId: 'WS-VDS-PC', versionId: 'v2026.08' },
  riskMatrix: { entityId: 'RM-5X5-VDS', versionId: 'v2026.06' },
  riskAcceptanceThreshold: { entityId: 'TH-ACC-VDS', versionId: 'v2026.06' },
  monitoringWarningThreshold: { entityId: 'TH-MON-VDS', versionId: 'v2026.08' },
} as const satisfies Readonly<Record<string, VersionRef>>;

export const BASIS_VERSION_LABELS: Readonly<Record<keyof typeof ASSESSMENT_BASIS_VERSIONS, string>> = {
  indicatorSystem: '指标体系与量化标准',
  applicableRuleSet: '适用规则集',
  weightSet: '权重',
  riskMatrix: '风险矩阵',
  riskAcceptanceThreshold: '风险可接受阈值',
  monitoringWarningThreshold: '监测预警阈值',
};

// ---------------------------------------------------------------------------
// 指标元数据：逐指标 P/C 归属由指标体系给出（不在评估记录上重复存储）。
// side: 'P' 计入发生可能性（likelihoodScore）；'C' 计入后果严重度（consequenceScore）。
// ---------------------------------------------------------------------------

export interface IndicatorItemMeta {
  readonly indicatorItem: string;
  readonly label: string;
  readonly side: 'P' | 'C';
  readonly unit: string | null;
}

export const INDICATOR_ITEMS: readonly IndicatorItemMeta[] = [
  { indicatorItem: 'IND-P-GEO', label: '围岩等级', side: 'P', unit: null },
  { indicatorItem: 'IND-P-GW', label: '地下水富水性', side: 'P', unit: null },
  { indicatorItem: 'IND-P-SPAN', label: '扩挖跨度比', side: 'P', unit: null },
  { indicatorItem: 'IND-P-SETTLE-RATE', label: '地表沉降短期斜率', side: 'P', unit: 'mm/d' },
  { indicatorItem: 'IND-C-PEOPLE', label: '人员暴露密度', side: 'C', unit: null },
  { indicatorItem: 'IND-C-ECON', label: '直接经济损失预估', side: 'C', unit: '万元' },
  { indicatorItem: 'IND-C-SCHEDULE', label: '工期影响', side: 'C', unit: '天' },
  { indicatorItem: 'IND-C-ENV', label: '周边环境影响', side: 'C', unit: null },
];

export function indicatorMeta(indicatorItem: string): IndicatorItemMeta | undefined {
  return INDICATOR_ITEMS.find((item) => item.indicatorItem === indicatorItem);
}

// ---------------------------------------------------------------------------
// 风险矩阵版本化配置（RiskMatrixVersionChart 直接消费；颜色只走令牌变量）。
// 行 = 发生可能性 P（P1 在底部），列 = 后果严重度 C；可接受区 = III / IV 级格。
// ---------------------------------------------------------------------------

export interface RiskMatrixLevelFixture {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly softColor: string;
}

export const RISK_MATRIX_CONFIG = {
  entityId: ASSESSMENT_BASIS_VERSIONS.riskMatrix.entityId,
  versionId: ASSESSMENT_BASIS_VERSIONS.riskMatrix.versionId,
  probability: { label: '发生可能性 P', ticks: ['P1', 'P2', 'P3', 'P4', 'P5'] },
  consequence: { label: '后果严重度 C', ticks: ['C1', 'C2', 'C3', 'C4', 'C5'] },
  levels: [
    { key: 'I', label: 'I 级（重大）', color: 'var(--risk-1)', softColor: 'var(--risk-1-soft)' },
    { key: 'II', label: 'II 级（较大）', color: 'var(--risk-2)', softColor: 'var(--risk-2-soft)' },
    { key: 'III', label: 'III 级（一般）', color: 'var(--risk-3)', softColor: 'var(--risk-3-soft)' },
    { key: 'IV', label: 'IV 级（较小）', color: 'var(--risk-4)', softColor: 'var(--risk-4-soft)' },
  ],
  cellLevels: [
    ['IV', 'IV', 'III', 'III', 'II'],
    ['IV', 'III', 'III', 'II', 'II'],
    ['IV', 'III', 'II', 'II', 'I'],
    ['III', 'III', 'II', 'I', 'I'],
    ['III', 'II', 'II', 'I', 'I'],
  ],
  acceptable: [
    [true, true, true, true, false],
    [true, true, true, false, false],
    [true, true, false, false, false],
    [true, true, false, false, false],
    [true, false, false, false, false],
  ],
  thresholdVersion: ASSESSMENT_BASIS_VERSIONS.riskAcceptanceThreshold.versionId,
} as const;

export function matrixLevel(levelKey: string): RiskMatrixLevelFixture | undefined {
  return RISK_MATRIX_CONFIG.levels.find((level) => level.key === levelKey);
}

/** 由落点查矩阵等级（数据驱动，不预存等级文案）。 */
export function matrixLevelAt(pTick: string, cTick: string): RiskMatrixLevelFixture | undefined {
  const pTicks: readonly string[] = RISK_MATRIX_CONFIG.probability.ticks;
  const cTicks: readonly string[] = RISK_MATRIX_CONFIG.consequence.ticks;
  const p = pTicks.indexOf(pTick);
  const c = cTicks.indexOf(cTick);
  if (p < 0 || c < 0) return undefined;
  const row = RISK_MATRIX_CONFIG.cellLevels[p];
  if (row === undefined) return undefined;
  const key = row[c];
  return key === undefined ? undefined : matrixLevel(key);
}

// ---------------------------------------------------------------------------
// 逐指标结果 / 触发指标（对齐 IndicatorResultSchema / TriggerIndicatorSchema）
// ---------------------------------------------------------------------------

export interface IndicatorResultFixture {
  readonly indicatorItem: string;
  readonly actualValue: string | number;
  readonly baseScore: number;
  readonly weightedScore: number;
  readonly ruleVersion: VersionRef;
  readonly evidenceReferences: readonly EvidenceRef[];
}

export interface TriggerIndicatorFixture {
  readonly indicatorItem: string;
  /** 取值对齐 WarningTriggerTypeSchema 四类触发类型。 */
  readonly triggerType: string;
  readonly actualValue?: string | number;
}

// ---------------------------------------------------------------------------
// 风险评估记录（对齐 RiskAssessmentRecordSchema；kind 为风险输入判别字段）
// ---------------------------------------------------------------------------

export interface AssessmentRecordFixture {
  readonly assessmentRecordId: string;
  readonly kind: 'standardized-risk-record';
  readonly riskRecordId: string;
  /** 入口类别由产生本记录的评估运行准备快照 entryMode 给出（记录本身不存储）。 */
  readonly entryMode: AssessmentEntryMode;
  readonly applicabilityMetadataSnapshot: ApplicabilitySnapshot;
  /** 发生可能性得分（P）。 */
  readonly likelihoodScore: number;
  /** 后果严重度得分（C）。 */
  readonly consequenceScore: number;
  /** 风险等级 key，由所引矩阵版本映射得出。 */
  readonly riskLevel: string;
  /** 矩阵落点刻度取值（probability / consequence ticks 中的取值）。 */
  readonly matrixPlot: { readonly p: string; readonly c: string };
  readonly indicatorResults: readonly IndicatorResultFixture[];
  readonly triggerIndicators: readonly TriggerIndicatorFixture[];
  readonly evidenceReferences: readonly EvidenceRef[];
  readonly applicableRuleSetVersion: VersionRef;
  readonly weightVersion: VersionRef;
  readonly riskMatrixVersion: VersionRef;
  /** 产生本记录的评估运行。 */
  readonly producedByRunId: string;
  /** 重评估版本链：前次评估记录。 */
  readonly previousAssessmentRecordId?: string;
  /** 触发的预警记录（未触发则为 null）。 */
  readonly warningRecordId: string | null;
  readonly audit: AuditInfo;
}

const DOC_SOURCE_VERSION: VersionRef = { entityId: 'DOC2026001', versionId: 'v2026.06' };
const MON_SOURCE_VERSION: VersionRef = { entityId: 'SRC-MON-003', versionId: 'v2026.09.10' };

function docEvidence(sourceSegmentId: string): EvidenceRef {
  return { locator: { sourceSegmentId }, sourceVersion: DOC_SOURCE_VERSION };
}

function monEvidence(sourceSegmentId: string): EvidenceRef {
  return { locator: { sourceSegmentId }, sourceVersion: MON_SOURCE_VERSION };
}

const SNAPSHOT_VDS: ApplicabilitySnapshot = {
  constructionMethod: '变径盾构法',
  stratumCondition: '富水软弱地层',
  engineeringStage: '变径空间扩挖与支护',
};

const RULE_VERSION = ASSESSMENT_BASIS_VERSIONS.applicableRuleSet;

const INDICATOR_RESULTS_MAIN: readonly IndicatorResultFixture[] = [
  {
    indicatorItem: 'IND-P-GEO',
    actualValue: 'V 级（强风化泥质粉砂岩）',
    baseScore: 4,
    weightedScore: 1.0,
    ruleVersion: RULE_VERSION,
    evidenceReferences: [docEvidence('DOC2026001-S32-SEG007')],
  },
  {
    indicatorItem: 'IND-P-GW',
    actualValue: '富水（渗透系数 8.6×10⁻⁵ cm/s）',
    baseScore: 4,
    weightedScore: 0.8,
    ruleVersion: RULE_VERSION,
    evidenceReferences: [docEvidence('DOC2026001-S32-SEG007')],
  },
  {
    indicatorItem: 'IND-P-SPAN',
    actualValue: 1.42,
    baseScore: 5,
    weightedScore: 1.25,
    ruleVersion: RULE_VERSION,
    evidenceReferences: [docEvidence('DOC2026001-S32-SEG009')],
  },
  {
    indicatorItem: 'IND-P-SETTLE-RATE',
    actualValue: 2.3,
    baseScore: 5,
    weightedScore: 1.25,
    ruleVersion: RULE_VERSION,
    evidenceReferences: [monEvidence('SRC-MON-003-20260827-SEG036')],
  },
  {
    indicatorItem: 'IND-C-PEOPLE',
    actualValue: '高（三班连续作业，单班 46 人）',
    baseScore: 5,
    weightedScore: 1.5,
    ruleVersion: RULE_VERSION,
    evidenceReferences: [docEvidence('DOC2026001-S32-SEG011')],
  },
  {
    indicatorItem: 'IND-C-ECON',
    actualValue: 860,
    baseScore: 4,
    weightedScore: 0.8,
    ruleVersion: RULE_VERSION,
    evidenceReferences: [docEvidence('DOC2026001-S32-SEG011')],
  },
  {
    indicatorItem: 'IND-C-SCHEDULE',
    actualValue: 42,
    baseScore: 3,
    weightedScore: 0.6,
    ruleVersion: RULE_VERSION,
    evidenceReferences: [docEvidence('DOC2026001-S32-SEG011')],
  },
  {
    indicatorItem: 'IND-C-ENV',
    actualValue: '邻近运营地铁区间 12 m',
    baseScore: 4,
    weightedScore: 1.2,
    ruleVersion: RULE_VERSION,
    evidenceReferences: [docEvidence('DOC2026001-S32-SEG013')],
  },
];

export const ASSESSMENT_RECORDS: readonly AssessmentRecordFixture[] = [
  {
    assessmentRecordId: 'ASSESS-2026-001',
    kind: 'standardized-risk-record',
    riskRecordId: 'RISK-2026-001',
    entryMode: 'assess',
    applicabilityMetadataSnapshot: SNAPSHOT_VDS,
    likelihoodScore: 4,
    consequenceScore: 4,
    riskLevel: 'I',
    matrixPlot: { p: 'P4', c: 'C4' },
    indicatorResults: INDICATOR_RESULTS_MAIN,
    triggerIndicators: [
      { indicatorItem: '风险等级', triggerType: '风险等级超过风险可接受阈值', actualValue: 'I 级' },
      { indicatorItem: '地表沉降累计值', triggerType: '监测指标越限', actualValue: '13.6 mm' },
      { indicatorItem: '地表沉降短期斜率', triggerType: '趋势/加速度/异常评分越限', actualValue: '2.3 mm/d' },
      { indicatorItem: '支护结构变形 × 注浆压力', triggerType: '多指标联合规则命中', actualValue: '8.4 mm × 0.18 MPa' },
    ],
    evidenceReferences: [
      docEvidence('DOC2026001-S32-SEG007'),
      docEvidence('DOC2026001-S32-SEG009'),
      docEvidence('DOC2026001-S32-SEG011'),
      monEvidence('SRC-MON-003-20260827-SEG036'),
    ],
    applicableRuleSetVersion: ASSESSMENT_BASIS_VERSIONS.applicableRuleSet,
    weightVersion: ASSESSMENT_BASIS_VERSIONS.weightSet,
    riskMatrixVersion: ASSESSMENT_BASIS_VERSIONS.riskMatrix,
    producedByRunId: 'RUN-A-2026-001',
    warningRecordId: 'WARN-2026-001',
    audit: {
      actorId: 'U-RM-01',
      action: 'assessment.record.save',
      recordedAt: '2026-08-27T09:21:00+08:00',
    },
  },
  {
    assessmentRecordId: 'ASSESS-2026-002',
    kind: 'standardized-risk-record',
    riskRecordId: 'RISK-2026-001',
    entryMode: 'reassess',
    applicabilityMetadataSnapshot: SNAPSHOT_VDS,
    likelihoodScore: 3,
    consequenceScore: 4,
    riskLevel: 'II',
    matrixPlot: { p: 'P3', c: 'C4' },
    indicatorResults: INDICATOR_RESULTS_MAIN.map((result) =>
      result.indicatorItem === 'IND-P-SETTLE-RATE'
        ? {
            ...result,
            actualValue: 1.6,
            baseScore: 3,
            weightedScore: 0.75,
            evidenceReferences: [monEvidence('SRC-MON-003-20260910-SEG012')],
          }
        : result,
    ),
    triggerIndicators: [
      { indicatorItem: '风险等级', triggerType: '风险等级超过风险可接受阈值', actualValue: 'II 级' },
    ],
    evidenceReferences: [
      docEvidence('DOC2026001-S32-SEG007'),
      monEvidence('SRC-MON-003-20260910-SEG012'),
    ],
    applicableRuleSetVersion: ASSESSMENT_BASIS_VERSIONS.applicableRuleSet,
    weightVersion: ASSESSMENT_BASIS_VERSIONS.weightSet,
    riskMatrixVersion: ASSESSMENT_BASIS_VERSIONS.riskMatrix,
    producedByRunId: 'RUN-A-2026-002',
    previousAssessmentRecordId: 'ASSESS-2026-001',
    warningRecordId: 'WARN-2026-001',
    audit: {
      actorId: 'U-RM-01',
      action: 'assessment.record.save',
      recordedAt: '2026-09-10T10:05:00+08:00',
      reason: '监测快照更新触发重新评估',
    },
  },
  {
    assessmentRecordId: 'ASSESS-2026-003',
    kind: 'standardized-risk-record',
    riskRecordId: 'RISK-2026-002',
    entryMode: 'historical-backfill',
    applicabilityMetadataSnapshot: SNAPSHOT_VDS,
    likelihoodScore: 2,
    consequenceScore: 3,
    riskLevel: 'III',
    matrixPlot: { p: 'P2', c: 'C3' },
    indicatorResults: [
      {
        indicatorItem: 'IND-P-GEO',
        actualValue: 'IV 级（中风化砂岩）',
        baseScore: 3,
        weightedScore: 0.75,
        ruleVersion: RULE_VERSION,
        evidenceReferences: [docEvidence('DOC2026001-S32-SEG015')],
      },
      {
        indicatorItem: 'IND-P-GW',
        actualValue: '弱富水',
        baseScore: 2,
        weightedScore: 0.4,
        ruleVersion: RULE_VERSION,
        evidenceReferences: [docEvidence('DOC2026001-S32-SEG015')],
      },
      {
        indicatorItem: 'IND-C-ECON',
        actualValue: 260,
        baseScore: 3,
        weightedScore: 0.6,
        ruleVersion: RULE_VERSION,
        evidenceReferences: [docEvidence('DOC2026001-S32-SEG015')],
      },
      {
        indicatorItem: 'IND-C-SCHEDULE',
        actualValue: 14,
        baseScore: 2,
        weightedScore: 0.4,
        ruleVersion: RULE_VERSION,
        evidenceReferences: [docEvidence('DOC2026001-S32-SEG015')],
      },
    ],
    triggerIndicators: [],
    evidenceReferences: [docEvidence('DOC2026001-S32-SEG015')],
    applicableRuleSetVersion: ASSESSMENT_BASIS_VERSIONS.applicableRuleSet,
    weightVersion: ASSESSMENT_BASIS_VERSIONS.weightSet,
    riskMatrixVersion: ASSESSMENT_BASIS_VERSIONS.riskMatrix,
    producedByRunId: 'RUN-A-2026-004',
    warningRecordId: null,
    audit: {
      actorId: 'U-RM-01',
      action: 'assessment.record.save',
      recordedAt: '2026-09-15T16:40:00+08:00',
      reason: '历史资料回溯补评，生效时间 2026-06-30',
    },
  },
  {
    assessmentRecordId: 'ASSESS-2026-004',
    kind: 'standardized-risk-record',
    riskRecordId: 'RISK-2026-003',
    entryMode: 'assess',
    applicabilityMetadataSnapshot: SNAPSHOT_VDS,
    likelihoodScore: 3,
    consequenceScore: 4,
    riskLevel: 'II',
    matrixPlot: { p: 'P3', c: 'C4' },
    indicatorResults: [
      {
        indicatorItem: 'IND-P-GEO',
        actualValue: 'V 级（强风化泥质粉砂岩）',
        baseScore: 4,
        weightedScore: 1.0,
        ruleVersion: RULE_VERSION,
        evidenceReferences: [docEvidence('DOC2026001-S32-SEG017')],
      },
      {
        indicatorItem: 'IND-P-SPAN',
        actualValue: 1.38,
        baseScore: 4,
        weightedScore: 1.0,
        ruleVersion: RULE_VERSION,
        evidenceReferences: [docEvidence('DOC2026001-S32-SEG017')],
      },
      {
        indicatorItem: 'IND-C-PEOPLE',
        actualValue: '高（单班 38 人）',
        baseScore: 4,
        weightedScore: 1.2,
        ruleVersion: RULE_VERSION,
        evidenceReferences: [docEvidence('DOC2026001-S32-SEG017')],
      },
      {
        indicatorItem: 'IND-C-ENV',
        actualValue: '邻近运营地铁区间 12 m',
        baseScore: 4,
        weightedScore: 1.2,
        ruleVersion: RULE_VERSION,
        evidenceReferences: [docEvidence('DOC2026001-S32-SEG013')],
      },
    ],
    triggerIndicators: [
      { indicatorItem: '风险等级', triggerType: '风险等级超过风险可接受阈值', actualValue: 'II 级' },
    ],
    evidenceReferences: [
      docEvidence('DOC2026001-S32-SEG017'),
      docEvidence('DOC2026001-S32-SEG013'),
    ],
    applicableRuleSetVersion: ASSESSMENT_BASIS_VERSIONS.applicableRuleSet,
    weightVersion: ASSESSMENT_BASIS_VERSIONS.weightSet,
    riskMatrixVersion: ASSESSMENT_BASIS_VERSIONS.riskMatrix,
    producedByRunId: 'RUN-A-2026-003',
    warningRecordId: null,
    audit: {
      actorId: 'U-RM-01',
      action: 'assessment.record.save',
      recordedAt: '2026-09-18T11:20:00+08:00',
    },
  },
];

export function assessmentRecordById(recordId: string): AssessmentRecordFixture | undefined {
  return ASSESSMENT_RECORDS.find((record) => record.assessmentRecordId === recordId);
}

// ---------------------------------------------------------------------------
// 评估运行（C 骨架：头部七字段 + A0–A9 阶段条 + 子任务表 + 结果汇总）
// ---------------------------------------------------------------------------

export type AssessmentStageId =
  | 'A0'
  | 'A1'
  | 'A2'
  | 'A3'
  | 'A4'
  | 'A5'
  | 'A6'
  | 'A7'
  | 'A8'
  | 'A9';

/** 阶段语义对齐主规格「评估工作流具有 A0 至 A9 的版本化阶段契约」。 */
export const ASSESSMENT_STAGE_LABELS: Readonly<Record<AssessmentStageId, string>> = {
  A0: '输入准备',
  A1: '知识就绪',
  A2: '输入冻结',
  A3: '指标取值',
  A4: '确定性评分与触发判定',
  A5: '评估入库',
  A6: '预警入库与任务归集',
  A7: '处置建议候选',
  A8: '三项约束校验与建议入库',
  A9: '结果汇总',
};

export const ASSESSMENT_STAGE_IDS: readonly AssessmentStageId[] = [
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
  'A7',
  'A8',
  'A9',
];

export type StageStatus = 'done' | 'active' | 'waiting' | 'pending' | 'failed';

export interface RunStageFixture {
  readonly stage: AssessmentStageId;
  readonly status: StageStatus;
  readonly summary?: string;
}

export interface RunSubtaskFixture {
  readonly id: string;
  readonly stage: AssessmentStageId;
  readonly name: string;
  readonly status: StageStatus;
  readonly duration?: string;
  readonly result?: string;
}

export interface ApplicabilityExclusionFixture {
  readonly ruleId: string;
  readonly ruleName: string;
  /** 筛除维度：适用性元数据三维度之一。 */
  readonly dimension: '施工工法' | '地层条件' | '工程阶段';
  readonly reason: string;
}

export interface AssessmentRunFixture {
  readonly runId: string;
  readonly status: 'completed' | 'running' | 'waiting' | 'terminal-failure';
  readonly currentStage: AssessmentStageId;
  readonly entryMode: AssessmentEntryMode;
  readonly triggerReasonCode: string;
  readonly operatorId: string;
  readonly operatorName: string;
  readonly startedAt: string;
  readonly idempotencyKey: string;
  readonly riskRecordId: string;
  /** 因果链上游：识别运行。 */
  readonly causalIdentificationRunId: string;
  readonly previousAssessmentRecordId?: string;
  readonly stages: readonly RunStageFixture[];
  readonly subtasks: readonly RunSubtaskFixture[];
  readonly applicabilityExclusions: readonly ApplicabilityExclusionFixture[];
  readonly outputs: {
    readonly assessmentRecordId: string | null;
    readonly warningRecordId: string | null;
    readonly responseRecommendationId: string | null;
  };
  readonly summary: {
    readonly indicatorValueCount: number;
    readonly appliedRuleCount: number;
    readonly excludedRuleCount: number;
    readonly triggerHitCount: number;
  };
}

function stagesUpTo(currentIndex: number, waitingAt?: number): readonly RunStageFixture[] {
  return ASSESSMENT_STAGE_IDS.map((stage, index) => {
    let status: StageStatus = 'pending';
    if (index < currentIndex) status = 'done';
    else if (index === currentIndex) status = waitingAt === index ? 'waiting' : 'active';
    return { stage, status };
  });
}

const ALL_STAGES_DONE: readonly RunStageFixture[] = ASSESSMENT_STAGE_IDS.map((stage) => ({
  stage,
  status: 'done' as const,
}));

const EXCLUSIONS_MAIN: readonly ApplicabilityExclusionFixture[] = [
  {
    ruleId: 'RULE-VDS-009',
    ruleName: '硬岩段扩挖超挖控制评分规则',
    dimension: '地层条件',
    reason: '规则适用于硬岩地层；当前适用性快照为富水软弱地层',
  },
  {
    ruleId: 'RULE-VDS-014',
    ruleName: '矿山法联络通道开挖评分规则',
    dimension: '施工工法',
    reason: '规则适用于矿山法；当前适用性快照为变径盾构法',
  },
  {
    ruleId: 'RULE-VDS-021',
    ruleName: '竣工验收阶段沉降控制评分规则',
    dimension: '工程阶段',
    reason: '规则适用于竣工验收阶段；当前适用性快照为变径空间扩挖与支护',
  },
];

export const ASSESSMENT_RUNS: readonly AssessmentRunFixture[] = [
  {
    runId: 'RUN-A-2026-001',
    status: 'completed',
    currentStage: 'A9',
    entryMode: 'assess',
    triggerReasonCode: 'initial-assessment',
    operatorId: 'U-RM-01',
    operatorName: '刘一鸣',
    startedAt: '2026-08-27T09:04:00+08:00',
    idempotencyKey: 'IDEMP-A-20260827-0001',
    riskRecordId: 'RISK-2026-001',
    causalIdentificationRunId: 'RUN-20260827-001',
    stages: ALL_STAGES_DONE,
    subtasks: [
      { id: 'ST-001', stage: 'A0', name: '评估准备快照组装', status: 'done', duration: '2 s', result: '准备快照 SNAP-A-20260827-001' },
      { id: 'ST-002', stage: 'A1', name: '评估依据版本集就绪确认', status: 'done', duration: '3 s', result: '规则集 / 权重 / 矩阵版本锁定' },
      { id: 'ST-003', stage: 'A2', name: '评估输入冻结', status: 'done', duration: '1 s', result: '输入快照 SNAP-A-20260827-002' },
      { id: 'ST-004', stage: 'A3', name: '逐指标实际取值（8 项）', status: 'done', duration: '41 s', result: '8 项取值齐备' },
      { id: 'ST-005', stage: 'A4', name: '确定性评分与触发判定', status: 'done', duration: '6 s', result: 'P=4 · C=4，命中 4 类触发' },
      { id: 'ST-006', stage: 'A5', name: '评估记录入库', status: 'done', duration: '1 s', result: 'ASSESS-2026-001' },
      { id: 'ST-007', stage: 'A6', name: '预警入库与处置任务归集', status: 'done', duration: '2 s', result: 'WARN-2026-001' },
      { id: 'ST-008', stage: 'A7', name: '处置建议候选生成', status: 'done', duration: '96 s', result: '候选 3 项' },
      { id: 'ST-009', stage: 'A8', name: '三项约束校验与建议入库', status: 'done', duration: '4 s', result: 'RESP-2026-001' },
      { id: 'ST-010', stage: 'A9', name: '运行结果汇总', status: 'done', duration: '1 s', result: '结果汇总 RR-A-2026-001' },
    ],
    applicabilityExclusions: EXCLUSIONS_MAIN,
    outputs: {
      assessmentRecordId: 'ASSESS-2026-001',
      warningRecordId: 'WARN-2026-001',
      responseRecommendationId: 'RESP-2026-001',
    },
    summary: { indicatorValueCount: 8, appliedRuleCount: 14, excludedRuleCount: 3, triggerHitCount: 4 },
  },
  {
    runId: 'RUN-A-2026-002',
    status: 'completed',
    currentStage: 'A9',
    entryMode: 'reassess',
    triggerReasonCode: 'monitoring-snapshot',
    operatorId: 'U-RM-01',
    operatorName: '刘一鸣',
    startedAt: '2026-09-10T09:52:00+08:00',
    idempotencyKey: 'IDEMP-A-20260910-0001',
    riskRecordId: 'RISK-2026-001',
    causalIdentificationRunId: 'RUN-20260827-001',
    previousAssessmentRecordId: 'ASSESS-2026-001',
    stages: ALL_STAGES_DONE,
    subtasks: [
      { id: 'ST-101', stage: 'A0', name: '评估准备快照组装（含监测快照引用）', status: 'done', duration: '2 s', result: '准备快照 SNAP-A-20260910-001' },
      { id: 'ST-102', stage: 'A2', name: '评估输入冻结', status: 'done', duration: '1 s', result: '输入快照 SNAP-A-20260910-002' },
      { id: 'ST-103', stage: 'A3', name: '逐指标实际取值（8 项）', status: 'done', duration: '38 s', result: '沉降斜率回落至 1.6 mm/d' },
      { id: 'ST-104', stage: 'A4', name: '确定性评分与触发判定', status: 'done', duration: '5 s', result: 'P=3 · C=4，命中 1 类触发' },
      { id: 'ST-105', stage: 'A5', name: '评估记录入库', status: 'done', duration: '1 s', result: 'ASSESS-2026-002' },
      { id: 'ST-106', stage: 'A6', name: '预警任务归集', status: 'done', duration: '2 s', result: '归集至 WARN-2026-001' },
      { id: 'ST-107', stage: 'A9', name: '运行结果汇总', status: 'done', duration: '1 s', result: '结果汇总 RR-A-2026-002' },
    ],
    applicabilityExclusions: EXCLUSIONS_MAIN,
    outputs: {
      assessmentRecordId: 'ASSESS-2026-002',
      warningRecordId: 'WARN-2026-001',
      responseRecommendationId: null,
    },
    summary: { indicatorValueCount: 8, appliedRuleCount: 14, excludedRuleCount: 3, triggerHitCount: 1 },
  },
  {
    runId: 'RUN-A-2026-003',
    status: 'running',
    currentStage: 'A3',
    entryMode: 'assess',
    triggerReasonCode: 'initial-assessment',
    operatorId: 'U-RM-01',
    operatorName: '刘一鸣',
    startedAt: '2026-09-18T08:40:00+08:00',
    idempotencyKey: 'IDEMP-A-20260918-0001',
    riskRecordId: 'RISK-2026-003',
    causalIdentificationRunId: 'RUN-20260827-001',
    stages: stagesUpTo(3),
    subtasks: [
      { id: 'ST-201', stage: 'A0', name: '评估准备快照组装', status: 'done', duration: '2 s', result: '准备快照 SNAP-A-20260918-001' },
      { id: 'ST-202', stage: 'A1', name: '评估依据版本集就绪确认', status: 'done', duration: '3 s', result: '版本集与 RUN-A-2026-001 相同' },
      { id: 'ST-203', stage: 'A2', name: '评估输入冻结', status: 'done', duration: '1 s', result: '输入快照 SNAP-A-20260918-002' },
      { id: 'ST-204', stage: 'A3', name: '逐指标实际取值（4 项）', status: 'active', result: '已取值 3 / 4 项' },
    ],
    applicabilityExclusions: EXCLUSIONS_MAIN,
    outputs: {
      assessmentRecordId: null,
      warningRecordId: null,
      responseRecommendationId: null,
    },
    summary: { indicatorValueCount: 4, appliedRuleCount: 14, excludedRuleCount: 3, triggerHitCount: 0 },
  },
  {
    runId: 'RUN-A-2026-004',
    status: 'completed',
    currentStage: 'A9',
    entryMode: 'historical-backfill',
    triggerReasonCode: 'historical-backfill',
    operatorId: 'U-RM-01',
    operatorName: '刘一鸣',
    startedAt: '2026-09-15T16:32:00+08:00',
    idempotencyKey: 'IDEMP-A-20260915-0001',
    riskRecordId: 'RISK-2026-002',
    causalIdentificationRunId: 'RUN-20260827-001',
    stages: ALL_STAGES_DONE,
    subtasks: [
      { id: 'ST-301', stage: 'A0', name: '评估准备快照组装（生效时间 2026-06-30）', status: 'done', duration: '2 s', result: '准备快照 SNAP-A-20260915-001' },
      { id: 'ST-302', stage: 'A3', name: '逐指标实际取值（4 项）', status: 'done', duration: '22 s', result: '4 项取值齐备' },
      { id: 'ST-303', stage: 'A4', name: '确定性评分与触发判定', status: 'done', duration: '4 s', result: 'P=2 · C=3，未命中触发' },
      { id: 'ST-304', stage: 'A5', name: '评估记录入库', status: 'done', duration: '1 s', result: 'ASSESS-2026-003' },
      { id: 'ST-305', stage: 'A9', name: '运行结果汇总', status: 'done', duration: '1 s', result: '结果汇总 RR-A-2026-004' },
    ],
    applicabilityExclusions: EXCLUSIONS_MAIN,
    outputs: {
      assessmentRecordId: 'ASSESS-2026-003',
      warningRecordId: null,
      responseRecommendationId: null,
    },
    summary: { indicatorValueCount: 4, appliedRuleCount: 11, excludedRuleCount: 3, triggerHitCount: 0 },
  },
];

export function assessmentRunById(runId: string): AssessmentRunFixture | undefined {
  return ASSESSMENT_RUNS.find((run) => run.runId === runId);
}

// ---------------------------------------------------------------------------
// 待评估风险队列（P-RA-01）：识别域已入库、等待或正在评估的风险输入
// ---------------------------------------------------------------------------

export type PendingRiskStatus = 'pending' | 'in-run' | 'assessed';

export const PENDING_STATUS_LABELS: Readonly<Record<PendingRiskStatus, string>> = {
  pending: '待评估',
  'in-run': '评估中',
  assessed: '已评估',
};

export interface PendingRiskFixture {
  readonly riskRecordId: string;
  readonly riskEvent: string;
  readonly processNodeId: string;
  readonly processNodeName: string;
  readonly mechanismEntryId: string;
  /** 综合置信度（对齐 CompositeConfidenceSchema：值 + 依据构成）。 */
  readonly compositeConfidence: { readonly value: number; readonly basis: readonly string[] };
  readonly sourceSegmentId: string;
  readonly status: PendingRiskStatus;
  readonly latestAssessmentRecordId?: string;
  readonly activeRunId?: string;
}

export const PENDING_RISKS: readonly PendingRiskFixture[] = [
  {
    riskRecordId: 'RISK-2026-001',
    riskEvent: '变径空间扩挖段拱顶沉降超限',
    processNodeId: 'PN-VDS-04',
    processNodeName: '变径空间扩挖',
    mechanismEntryId: 'MEC-VDS-017',
    compositeConfidence: {
      value: 0.86,
      basis: ['模型推理置信度 0.84', '机理条目命中', '专家复核通过'],
    },
    sourceSegmentId: 'DOC2026001-S32-SEG007',
    status: 'assessed',
    latestAssessmentRecordId: 'ASSESS-2026-002',
  },
  {
    riskRecordId: 'RISK-2026-002',
    riskEvent: '扩挖段同步注浆不密实导致地层损失',
    processNodeId: 'PN-VDS-04',
    processNodeName: '变径空间扩挖',
    mechanismEntryId: 'MEC-VDS-017',
    compositeConfidence: {
      value: 0.78,
      basis: ['模型推理置信度 0.79', '类比案例佐证'],
    },
    sourceSegmentId: 'DOC2026001-S32-SEG015',
    status: 'assessed',
    latestAssessmentRecordId: 'ASSESS-2026-003',
  },
  {
    riskRecordId: 'RISK-2026-003',
    riskEvent: '变径段围护结构变形超限',
    processNodeId: 'PN-VDS-04',
    processNodeName: '变径空间扩挖',
    mechanismEntryId: 'MEC-VDS-017',
    compositeConfidence: {
      value: 0.81,
      basis: ['模型推理置信度 0.83', '监测证据佐证'],
    },
    sourceSegmentId: 'DOC2026001-S32-SEG017',
    status: 'in-run',
    activeRunId: 'RUN-A-2026-003',
  },
  {
    riskRecordId: 'RISK-2026-004',
    riskEvent: '富水地层扩挖涌水涌砂',
    processNodeId: 'PN-VDS-04',
    processNodeName: '变径空间扩挖',
    mechanismEntryId: 'MEC-VDS-017',
    compositeConfidence: {
      value: 0.74,
      basis: ['模型推理置信度 0.72', '机理条目命中'],
    },
    sourceSegmentId: 'DOC2026001-S32-SEG019',
    status: 'pending',
  },
];

// ---------------------------------------------------------------------------
// 深链（hash 路由；参数化目标用具体标识）
// ---------------------------------------------------------------------------

export const LINKS = {
  identificationRecord: (recordId: string) => `#/identification/records/${recordId}`,
  identificationRun: (runId: string) => `#/identification/runs/${runId}`,
  identificationProcessModel: '#/identification/process-model',
  knowledgeMechanisms: '#/knowledge/mechanisms',
  knowledgeRuleSets: '#/knowledge/rule-sets',
  knowledgeRiskMatrices: '#/knowledge/risk-matrices',
  knowledgeIndicatorSystems: '#/knowledge/indicator-systems',
  evidenceTrace: '#/review-audit/trace',
  assessmentStart: '#/assessment/start',
  assessmentRun: (runId: string) => `#/assessment/runs/${runId}`,
  assessmentRecord: (recordId: string) => `#/assessment/records/${recordId}`,
  assessmentRecords: '#/assessment/records',
  assessmentMatrix: '#/assessment/matrix',
  assessmentReassessments: '#/assessment/reassessments',
  warning: (warningId: string) => `#/warnings/${warningId}`,
  responseRecommendation: (recommendationId: string) =>
    `#/response/recommendations/${recommendationId}`,
  responseFeedback: (feedbackId: string) => `#/response/feedback/${feedbackId}`,
  responseCalibration: (suggestionId: string) => `#/response/calibrations/${suggestionId}`,
} as const;
