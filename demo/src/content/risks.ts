/**
 * 标准化风险记录 SSOT。
 * 事实源：prototypes/screenshot-content-inventory.md §3.2 / §4；
 * 字段契约：AGENTS.md §2.6（七字段 + 评估侧 P/C、等级、状态扩展）。
 * 统计口径：等级 I1/II3/III5/IV3 共 12；工序分布 1/5/3/2/1。
 */

export type RiskLevel = 'I' | 'II' | 'III' | 'IV'

export interface RiskRecord {
  /** 风险记录标识 */
  id: string
  /** 工序节点标识 */
  processNodeId: string
  /** 工序节点名称 */
  processName: string
  /** 风险源 */
  riskSource: string
  /** 风险因素 */
  riskFactor: string
  /** 风险事件 */
  riskEvent: string
  /** 风险要素关系 */
  riskElementRelations: string
  /** 风险机理类型 */
  mechanismType: string
  /** 风险机理条目标识 */
  mechanismId: string
  /** 风险等级 */
  level: RiskLevel
  /** 发生可能性分值 */
  p: number
  /** 后果严重性分值 */
  c: number
  /** 模型置信度 */
  modelConfidence: number
  /** 综合置信度 */
  compositeConfidence: number
  /** 当前状态 */
  status: string
  /** 证据定位信息（资料段标识列表） */
  evidence: string[]
}

/** 主风险：唯一 I 级风险（五屏统一业务故事主线） */
export const mainRisk: RiskRecord = {
  id: 'RISK-2026-001',
  processNodeId: 'PN-EXPAND-02',
  processName: '变径空间扩挖',
  riskSource: '富水软弱地层中的变径空间扩挖作业面',
  riskFactor: '支护闭合滞后、注浆压力偏低且地表沉降趋势加快',
  riskEvent: '变径空间扩挖引发过挖与地表沉降超限',
  riskElementRelations:
    '变径空间扩挖 → 支护闭合滞后/注浆压力偏低 → 地层损失增大 → 地表沉降超限',
  mechanismType: '过挖与地表沉降',
  mechanismId: 'RM-SETTLE-004',
  level: 'I',
  p: 4,
  c: 4,
  modelConfidence: 0.86,
  compositeConfidence: 0.91,
  status: '红色预警 · 待处置',
  evidence: [
    'SRC-GEO-001-CH04-SEG018',
    'SRC-PLAN-002-CH06-SEG011',
    'SRC-MON-003-20260827-SEG036',
  ],
}

/** 台账次要风险（清单 §4 指定的三条 II 级 + 补齐的八项 II–IV 级风险） */
export const riskRecords: RiskRecord[] = [
  mainRisk,
  {
    id: 'RISK-2026-002',
    processNodeId: 'PN-EXPAND-02',
    processName: '变径空间扩挖',
    riskSource: '变径空间扩挖作业面掌子面',
    riskFactor: '土仓压力波动、掌子面水土压力失衡',
    riskEvent: '变径空间扩挖阶段掌子面局部失稳',
    riskElementRelations: '变径空间扩挖 → 土仓压力波动 → 掌子面水土压力失衡 → 掌子面局部失稳',
    mechanismType: '掌子面稳定性失效',
    mechanismId: 'RM-FACE-001',
    level: 'II',
    p: 3,
    c: 4,
    modelConfidence: 0.81,
    compositeConfidence: 0.85,
    status: '橙色预警 · 待处置',
    evidence: ['SRC-PLAN-002-CH06-SEG011', 'SRC-MON-003-20260827-SEG027'],
  },
  {
    id: 'RISK-2026-003',
    processNodeId: 'PN-EXPAND-03',
    processName: '刀盘扩径',
    riskSource: '刀盘扩径主驱动系统',
    riskFactor: '扩径工况下扭矩与推力同步升高',
    riskEvent: '刀盘扩径阶段主驱动负荷异常',
    riskElementRelations: '刀盘扩径 → 切削断面增大 → 主驱动扭矩升高 → 主驱动负荷异常',
    mechanismType: '施工装备故障',
    mechanismId: 'RM-EQUIP-005',
    level: 'II',
    p: 4,
    c: 3,
    modelConfidence: 0.79,
    compositeConfidence: 0.83,
    status: '橙色预警 · 待处置',
    evidence: ['SRC-EQP-004-CH03-SEG008', 'SRC-PLAN-002-CH07-SEG003'],
  },
  {
    id: 'RISK-2026-004',
    processNodeId: 'PN-EXPAND-04',
    processName: '盾体扩径',
    riskSource: '盾体扩径段钢管片拼装作业',
    riskFactor: '拼装机械臂定位偏差、连接螺栓预紧不足',
    riskEvent: '盾体扩径阶段钢管片装配连接异常',
    riskElementRelations: '盾体扩径 → 拼装定位偏差 → 连接预紧不足 → 钢管片装配连接异常',
    mechanismType: '装配连接失效',
    mechanismId: 'RM-JOINT-006',
    level: 'II',
    p: 3,
    c: 3,
    modelConfidence: 0.77,
    compositeConfidence: 0.82,
    status: '橙色预警 · 已确认',
    evidence: ['SRC-PLAN-002-CH08-SEG009', 'SRC-EQP-004-CH02-SEG005'],
  },
  {
    id: 'RISK-2026-005',
    processNodeId: 'PN-EXPAND-02',
    processName: '变径空间扩挖',
    riskSource: '扩挖段富水砂层',
    riskFactor: '地下水位升高、掌子面渗流通道发育',
    riskEvent: '变径空间扩挖段渗流突涌',
    riskElementRelations: '变径空间扩挖 → 隔水层削薄 → 渗流通道贯通 → 掌子面渗流突涌',
    mechanismType: '渗流突涌',
    mechanismId: 'RM-INRUSH-003',
    level: 'III',
    p: 2,
    c: 3,
    modelConfidence: 0.74,
    compositeConfidence: 0.8,
    status: '已评估 · 跟踪观察',
    evidence: ['SRC-GEO-001-CH05-SEG012', 'SRC-MON-003-20260827-SEG021'],
  },
  {
    id: 'RISK-2026-006',
    processNodeId: 'PN-EXPAND-02',
    processName: '变径空间扩挖',
    riskSource: '扩挖段锚杆与钢管片联合支护',
    riskFactor: '支护施作间隔拉长、锚杆轴力增长',
    riskEvent: '变径空间扩挖段支护结构变形发展',
    riskElementRelations: '变径空间扩挖 → 支护施作滞后 → 锚杆轴力增长 → 支护结构变形发展',
    mechanismType: '支护结构失效',
    mechanismId: 'RM-SUPPORT-002',
    level: 'III',
    p: 4,
    c: 2,
    modelConfidence: 0.76,
    compositeConfidence: 0.81,
    status: '已评估 · 跟踪观察',
    evidence: ['SRC-PLAN-002-CH06-SEG011', 'SRC-MON-003-20260827-SEG035'],
  },
  {
    id: 'RISK-2026-007',
    processNodeId: 'PN-EXPAND-03',
    processName: '刀盘扩径',
    riskSource: '刀盘扩径开挖面',
    riskFactor: '扩径后开挖面直径突变、渣土改良不足',
    riskEvent: '刀盘扩径开挖面稳定性下降',
    riskElementRelations: '刀盘扩径 → 开挖面直径突变 → 支护压力不匹配 → 开挖面稳定性下降',
    mechanismType: '掌子面稳定性失效',
    mechanismId: 'RM-FACE-001',
    level: 'III',
    p: 2,
    c: 2,
    modelConfidence: 0.72,
    compositeConfidence: 0.78,
    status: '已评估',
    evidence: ['SRC-PLAN-002-CH07-SEG003', 'SRC-GEO-001-CH03-SEG007'],
  },
  {
    id: 'RISK-2026-008',
    processNodeId: 'PN-EXPAND-03',
    processName: '刀盘扩径',
    riskSource: '刀盘扩径液压与密封系统',
    riskFactor: '长时间高负荷运转、密封磨损',
    riskEvent: '刀盘扩径装备液压系统故障',
    riskElementRelations: '刀盘扩径 → 高负荷连续运转 → 密封磨损 → 液压系统故障',
    mechanismType: '施工装备故障',
    mechanismId: 'RM-EQUIP-005',
    level: 'III',
    p: 1,
    c: 4,
    modelConfidence: 0.7,
    compositeConfidence: 0.76,
    status: '已评估',
    evidence: ['SRC-EQP-004-CH03-SEG008'],
  },
  {
    id: 'RISK-2026-009',
    processNodeId: 'PN-EXPAND-04',
    processName: '盾体扩径',
    riskSource: '盾体扩径段锚杆连接节点',
    riskFactor: '扩径段受力转换、节点应力集中',
    riskEvent: '盾体扩径段锚杆连接节点松动',
    riskElementRelations: '盾体扩径 → 受力体系转换 → 节点应力集中 → 锚杆连接节点松动',
    mechanismType: '装配连接失效',
    mechanismId: 'RM-JOINT-006',
    level: 'III',
    p: 1,
    c: 3,
    modelConfidence: 0.71,
    compositeConfidence: 0.77,
    status: '已评估',
    evidence: ['SRC-PLAN-002-CH08-SEG009'],
  },
  {
    id: 'RISK-2026-010',
    processNodeId: 'PN-EXPAND-01',
    processName: '扩径准备',
    riskSource: '扩径模块安装与调试作业',
    riskFactor: '模块吊装定位误差、调试窗口不足',
    riskEvent: '扩径准备阶段扩径模块安装偏差',
    riskElementRelations: '扩径准备 → 吊装定位误差 → 模块同轴度不足 → 扩径模块安装偏差',
    mechanismType: '施工装备故障',
    mechanismId: 'RM-EQUIP-005',
    level: 'IV',
    p: 2,
    c: 1,
    modelConfidence: 0.73,
    compositeConfidence: 0.79,
    status: '已评估',
    evidence: ['SRC-PLAN-002-CH04-SEG006', 'SRC-EQP-004-CH02-SEG005'],
  },
  {
    id: 'RISK-2026-011',
    processNodeId: 'PN-EXPAND-02',
    processName: '变径空间扩挖',
    riskSource: '扩挖段局部隔水薄弱带',
    riskFactor: '注浆压力偏低、局部渗水量增大',
    riskEvent: '变径空间扩挖段局部渗水',
    riskElementRelations: '变径空间扩挖 → 注浆压力偏低 → 隔水薄弱带渗水增大 → 局部渗水',
    mechanismType: '渗流突涌',
    mechanismId: 'RM-INRUSH-003',
    level: 'IV',
    p: 1,
    c: 1,
    modelConfidence: 0.69,
    compositeConfidence: 0.74,
    status: '已评估',
    evidence: ['SRC-GEO-001-CH05-SEG012', 'SRC-MON-003-20260827-SEG034'],
  },
  {
    id: 'RISK-2026-012',
    processNodeId: 'PN-EXPAND-05',
    processName: '缩径转换',
    riskSource: '缩径转换段尾盾与钢管片过渡',
    riskFactor: '缩径段支护刚度突变、转换节奏控制不足',
    riskEvent: '缩径转换段支护受力转换异常',
    riskElementRelations: '缩径转换 → 支护刚度突变 → 受力转换不协调 → 支护受力转换异常',
    mechanismType: '支护结构失效',
    mechanismId: 'RM-SUPPORT-002',
    level: 'IV',
    p: 1,
    c: 2,
    modelConfidence: 0.7,
    compositeConfidence: 0.75,
    status: '已评估',
    evidence: ['SRC-PLAN-002-CH09-SEG002'],
  },
]

/** 总览统计口径（清单 §4 固定口径，与 riskRecords 一致） */
export const overviewStats = {
  total: 12,
  levelCounts: { I: 1, II: 3, III: 5, IV: 3 } as Record<RiskLevel, number>,
  activeWarnings: 4,
  pendingResponse: 3,
  pendingReview: 2,
}

/** 按工序的风险分布（按施工顺序） */
export const processRiskDistribution = [
  { processNodeId: 'PN-EXPAND-01', name: '扩径准备', count: 1, highlight: false },
  { processNodeId: 'PN-EXPAND-02', name: '变径空间扩挖', count: 5, highlight: true },
  { processNodeId: 'PN-EXPAND-03', name: '刀盘扩径', count: 3, highlight: false },
  { processNodeId: 'PN-EXPAND-04', name: '盾体扩径', count: 2, highlight: false },
  { processNodeId: 'PN-EXPAND-05', name: '缩径转换', count: 1, highlight: false },
]
