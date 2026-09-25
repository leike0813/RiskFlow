/**
 * 知识与规则 SSOT：风险机理库、结构化评分规则与适用规则集、措施库。
 * 事实源：prototypes/screenshot-content-inventory.md §3.4；
 * 约束：不编造国家标准编号，统一使用项目内部规则标识。
 */

/** 风险机理条目（RI-S41 字段） */
export interface MechanismEntry {
  id: string
  type: string
  version: string
  status: string
  applicableProcesses: string[]
  geologicConditions: string
  triggerCondition: string
  monitoringSigns: string[]
  riskEventExpression: string
  evidenceRequirement: string
  evidence: string[]
}

export const mechanismEntries: MechanismEntry[] = [
  {
    id: 'RM-SETTLE-004',
    type: '过挖与地表沉降',
    version: 'V1.2',
    status: '已发布',
    applicableProcesses: ['变径空间扩挖', '刀盘扩径'],
    geologicConditions: '富水软弱地层、高灵敏度软土',
    triggerCondition: '支护闭合滞后、注浆压力低于生效区间且地表沉降短期斜率超限',
    monitoringSigns: ['地表沉降', '支护结构变形', '注浆压力'],
    riskEventExpression: '变径空间扩挖引发过挖与地表沉降超限',
    evidenceRequirement: '地质资料、专项施工方案、监测摘要各至少一段',
    evidence: ['SRC-GEO-001-CH04-SEG018', 'SRC-PLAN-002-CH06-SEG011', 'SRC-MON-003-20260827-SEG036'],
  },
  {
    id: 'RM-FACE-001',
    type: '掌子面稳定性失效',
    version: 'V1.1',
    status: '已发布',
    applicableProcesses: ['变径空间扩挖', '刀盘扩径'],
    geologicConditions: '软弱地层、砂性土层',
    triggerCondition: '土仓/泥水压力波动超出允许幅度，掌子面水土压力失衡',
    monitoringSigns: ['泥水压力', '盾构姿态参数', '地表沉降'],
    riskEventExpression: '开挖面局部失稳或坍塌',
    evidenceRequirement: '专项施工方案与监测摘要各至少一段',
    evidence: ['SRC-PLAN-002-CH06-SEG011', 'SRC-MON-003-20260827-SEG027'],
  },
  {
    id: 'RM-SUPPORT-002',
    type: '支护结构失效',
    version: 'V1.0',
    status: '已发布',
    applicableProcesses: ['变径空间扩挖', '盾体扩径', '缩径转换'],
    geologicConditions: '富水软弱地层',
    triggerCondition: '支护施作滞后于开挖进尺，支护结构变形持续增长',
    monitoringSigns: ['支护结构变形', '地表沉降'],
    riskEventExpression: '支护结构变形超限或局部破坏',
    evidenceRequirement: '专项施工方案与支护变形监测摘要',
    evidence: ['SRC-PLAN-002-CH06-SEG011', 'SRC-MON-003-20260827-SEG035'],
  },
  {
    id: 'RM-INRUSH-003',
    type: '渗流突涌',
    version: 'V1.0',
    status: '已发布',
    applicableProcesses: ['变径空间扩挖', '扩径准备'],
    geologicConditions: '富水砂层、承压水地层',
    triggerCondition: '隔水层削薄或注浆压力低于区间，渗流通道发育',
    monitoringSigns: ['地下水位', '注浆压力'],
    riskEventExpression: '掌子面或支护间隙渗流突涌',
    evidenceRequirement: '水文地质资料与地下水位监测摘要',
    evidence: ['SRC-GEO-001-CH05-SEG012', 'SRC-MON-003-20260827-SEG021'],
  },
  {
    id: 'RM-EQUIP-005',
    type: '施工装备故障',
    version: 'V1.1',
    status: '已发布',
    applicableProcesses: ['扩径准备', '刀盘扩径'],
    geologicConditions: '不限',
    triggerCondition: '扩径工况下主驱动扭矩、推力或液压负荷持续超出额定区间',
    monitoringSigns: ['盾构姿态参数'],
    riskEventExpression: '扩径模块、主驱动或液压系统故障导致停机',
    evidenceRequirement: '装备设计资料与专项施工方案',
    evidence: ['SRC-EQP-004-CH03-SEG008', 'SRC-PLAN-002-CH07-SEG003'],
  },
  {
    id: 'RM-JOINT-006',
    type: '装配连接失效',
    version: 'V1.0',
    status: '已发布',
    applicableProcesses: ['盾体扩径', '缩径转换'],
    geologicConditions: '不限',
    triggerCondition: '拼装定位偏差超限或连接预紧不足，受力转换期节点应力集中',
    monitoringSigns: ['支护结构变形', '盾构姿态参数'],
    riskEventExpression: '钢管片或锚杆装配连接异常',
    evidenceRequirement: '专项施工方案与装备设计资料',
    evidence: ['SRC-PLAN-002-CH08-SEG009', 'SRC-EQP-004-CH02-SEG005'],
  },
]

/** 结构化评分规则（RA-S3 字段契约） */
export interface ScoringRule {
  ruleId: string
  name: string
  applicabilityConditions: string[]
  indicatorItem: string
  scoringThresholds: string
  gradeIntervals: string
  exceptionClauses: string
  evidenceLocator: string
  ruleVersion: string
  reviewStatus: string
  source: string
}

export const scoringRules: ScoringRule[] = [
  {
    ruleId: 'RULE-EXPAND-01',
    name: '地表沉降累计值评分规则',
    applicabilityConditions: ['变径盾构法', '富水软弱地层', '变径空间扩挖与支护'],
    indicatorItem: '地表沉降累计值',
    scoringThresholds: '≤6.0 mm 记 1 分；6.0–9.0 mm 记 2 分；9.0–12.0 mm 记 3 分；12.0–15.0 mm 记 4 分；>15.0 mm 记 5 分',
    gradeIntervals: '五档等距区间',
    exceptionClauses: '经复核确认为监测设备异常的数据不参与评分',
    evidenceLocator: 'SRC-STD-007-CH02-SEG004',
    ruleVersion: 'V1.3',
    reviewStatus: '已发布',
    source: '项目风险评估量化标准 V1.0',
  },
  {
    ruleId: 'RULE-EXPAND-02',
    name: '地表沉降短期斜率评分规则',
    applicabilityConditions: ['变径盾构法', '富水软弱地层', '变径空间扩挖与支护'],
    indicatorItem: '地表沉降短期斜率',
    scoringThresholds: '≤0.8 mm/d 记 1 分；0.8–1.4 mm/d 记 2 分；1.4–2.0 mm/d 记 3 分；2.0–2.6 mm/d 记 4 分；>2.6 mm/d 记 5 分',
    gradeIntervals: '五档等距区间',
    exceptionClauses: '降雨等环境扰动经确认后可在备注中说明',
    evidenceLocator: 'SRC-STD-007-CH02-SEG005',
    ruleVersion: 'V1.3',
    reviewStatus: '已发布',
    source: '项目风险评估量化标准 V1.0',
  },
  {
    ruleId: 'RULE-EXPAND-03',
    name: '支护结构变形评分规则',
    applicabilityConditions: ['变径盾构法', '富水软弱地层', '变径空间扩挖与支护'],
    indicatorItem: '支护结构变形',
    scoringThresholds: '≤3.0 mm 记 1 分；3.0–5.0 mm 记 2 分；5.0–8.0 mm 记 3 分；8.0–11.0 mm 记 4 分；>11.0 mm 记 5 分',
    gradeIntervals: '五档等距区间',
    exceptionClauses: '支护拆改期间的数据按专项说明处理',
    evidenceLocator: 'SRC-STD-007-CH02-SEG006',
    ruleVersion: 'V1.3',
    reviewStatus: '已发布',
    source: '项目风险评估量化标准 V1.0',
  },
  {
    ruleId: 'RULE-EXPAND-04',
    name: '注浆压力评分规则',
    applicabilityConditions: ['变径盾构法', '富水软弱地层', '变径空间扩挖与支护'],
    indicatorItem: '注浆压力',
    scoringThresholds: '处于 0.20–0.25 MPa 记 1 分；偏离区间每 0.02 MPa 加记 1 分，最高 5 分',
    gradeIntervals: '按偏离幅度分档',
    exceptionClauses: '注浆设备检修窗口期经确认后不计分',
    evidenceLocator: 'SRC-STD-007-CH02-SEG007',
    ruleVersion: 'V1.3',
    reviewStatus: '已发布',
    source: '项目风险评估量化标准 V1.0',
  },
]

/** 适用规则集（RA-S4，版本化冻结） */
export const applicableRuleSet = {
  id: 'RULESET-EXPAND-01',
  name: '变径空间扩挖规则集',
  version: 'V1.3',
  status: '已发布',
  publishedAt: '2026-08-20 10:00',
  metadataSnapshot: ['变径盾构法', '富水软弱地层', '变径空间扩挖与支护'],
  memberRuleIds: scoringRules.map((r) => r.ruleId),
}
