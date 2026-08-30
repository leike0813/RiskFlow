/**
 * 风险评估 SSOT（评估专利 RA-S1–RA-S5）。
 * 事实源：prototypes/screenshot-content-inventory.md §3.2 / §3.3 / §3.4；
 * 字段契约：AGENTS.md §2.7。
 */

import type { RiskLevel } from './risks'

/** 触发指标（RA-S6） */
export interface TriggerIndicator {
  name: string
  currentValue: string
  threshold: string
  status: '越限' | '趋势越限' | '低于区间'
  evidence: string
}

export const triggerIndicators: TriggerIndicator[] = [
  {
    name: '地表沉降累计值',
    currentValue: '13.6 mm',
    threshold: '12.0 mm',
    status: '越限',
    evidence: 'SRC-MON-003-20260827-SEG036',
  },
  {
    name: '地表沉降短期斜率',
    currentValue: '2.3 mm/d',
    threshold: '2.0 mm/d',
    status: '趋势越限',
    evidence: 'SRC-MON-003-20260827-SEG036',
  },
  {
    name: '支护结构变形',
    currentValue: '8.4 mm',
    threshold: '8.0 mm',
    status: '越限',
    evidence: 'SRC-MON-003-20260827-SEG035',
  },
  {
    name: '注浆压力',
    currentValue: '0.18 MPa',
    threshold: '0.20–0.25 MPa',
    status: '低于区间',
    evidence: 'SRC-MON-003-20260827-SEG034',
  },
]

/** 指标权重组（P 侧 / C 侧） */
export interface WeightGroup {
  group: string
  weight: number
}

export const pWeightGroups: WeightGroup[] = [
  { group: '地质与围岩条件', weight: 25 },
  { group: '地下水与渗透条件', weight: 20 },
  { group: '开挖与支护参数', weight: 25 },
  { group: '监测量测与周边环境', weight: 30 },
]

export const cWeightGroups: WeightGroup[] = [
  { group: '人员影响', weight: 30 },
  { group: '经济影响', weight: 20 },
  { group: '工期影响', weight: 20 },
  { group: '社会与环境影响', weight: 30 },
]

/** 加权结果（映射为 P=4 / C=4） */
export const pWeightedResult = 4.3
export const cWeightedResult = 3.8

/**
 * 5×5 风险矩阵格（V1.0，行 = P5→P1，列 = C1→C5）。
 * 事实源：prototypes/report-screenshot-design.md §7.2 固定格。
 */
export const riskMatrixGrid: RiskLevel[][] = [
  ['III', 'II', 'II', 'I', 'I'],
  ['III', 'III', 'II', 'I', 'I'],
  ['IV', 'III', 'II', 'II', 'I'],
  ['IV', 'III', 'III', 'II', 'II'],
  ['IV', 'IV', 'III', 'III', 'II'],
]

/** 本次评估矩阵落点 */
export const matrixHighlight = { p: 4, c: 4 }

/** 预警触发类型（RA-S6，本次全部命中） */
export const triggerTypes = [
  '风险等级越限',
  '监测指标越限',
  '趋势越限',
  '多指标联合规则命中',
]

/** 两类阈值配置（风险可接受阈值与监测预警阈值必须分开呈现） */
export const thresholdConfigs = {
  riskAcceptance: {
    name: '风险可接受阈值',
    version: 'V1.0',
    description: 'I 级与 II 级风险超出项目风险接受准则，必须进入处置流程',
  },
  monitoring: {
    name: '监测预警阈值',
    version: 'V1.0',
    items: [
      '地表沉降累计值 12.0 mm',
      '地表沉降短期斜率 2.0 mm/d',
      '支护结构变形 8.0 mm',
      '注浆压力 0.20–0.25 MPa',
    ],
  },
}

/** 评估依据版本引用 */
export const assessmentVersions = {
  applicableRuleSet: { id: 'RULESET-EXPAND-01', name: '变径空间扩挖规则集', version: 'V1.3' },
  quantStandard: { id: 'QUANT-STD-01', name: '项目风险评估量化标准', version: 'V1.0' },
  riskMatrix: { id: 'MATRIX-5X5-01', name: '5×5 风险矩阵', version: 'V1.0' },
}

/** 适用性元数据快照（RA-S1 三个必含维度） */
export const applicabilityMetadataSnapshot = {
  constructionMethod: '变径盾构法',
  stratumCondition: '富水软弱地层',
  engineeringStage: '变径空间扩挖与支护',
}

/** 主风险评估记录（RA-S5 字段契约） */
export const assessmentRecord = {
  id: 'ASSESS-2026-001',
  riskRecordId: 'RISK-2026-001',
  applicabilityMetadataSnapshot,
  likelihoodScore: 4,
  consequenceScore: 4,
  riskLevel: 'I' as RiskLevel,
  triggerIndicators,
  applicableRuleSetVersion: 'V1.3',
  riskMatrixVersion: 'V1.0',
  evidenceReferences: [
    'SRC-GEO-001-CH04-SEG018',
    'SRC-PLAN-002-CH06-SEG011',
    'SRC-MON-003-20260827-SEG034',
    'SRC-MON-003-20260827-SEG035',
    'SRC-MON-003-20260827-SEG036',
  ],
  audit: {
    createdAt: '2026-08-27 09:21',
    createdBy: '系统',
    status: '已完成',
  },
}

/** 重新评估信息 */
export const reAssessment = {
  reason: '监测摘要更新',
  generatedRecordId: 'ASSESS-2026-001',
  status: '已完成',
  note: '历史评估记录只追加、不覆盖',
}
