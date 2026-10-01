/**
 * 证据与资料 SSOT：资料段详情（C34/C35 域证据抽屉遗留路径）、监测序列（C34 域）
 * 与审计时间线（C35 域）。资料目录与端到端证据链已由 C33 真实查询替换并移除。
 * 事实源：prototypes/screenshot-content-inventory.md §3.3 / §3.4 / §4；
 * 资料段标识格式：资料ID-章节ID-资料段ID（识别专利 RI-S13）。
 */

/** 资料段详情（证据抽屉数据源） */
export interface EvidenceSegment {
  segmentId: string
  name: string
  documentId: string
  documentName: string
  documentType: string
  version: string
  chapterPath: string
  page: string
  summary: string
  referencedBy: string[]
}

export const evidenceSegments: EvidenceSegment[] = [
  {
    segmentId: 'SRC-GEO-001-CH04-SEG018',
    name: '地层与地下水条件',
    documentId: 'SRC-GEO-001',
    documentName: '工程地质勘察报告',
    documentType: '地质资料',
    version: 'V2.0',
    chapterPath: '第 4 章 水文地质与工程地质条件',
    page: '第 42 页',
    summary: '试验区段为富水软弱地层，地下水位埋深浅，砂层发育，开挖扰动下易发生地层损失与渗流。',
    referencedBy: ['RISK-2026-001', 'RM-SETTLE-004', 'ASSESS-2026-001'],
  },
  {
    segmentId: 'SRC-GEO-001-CH03-SEG007',
    name: '岩土力学参数',
    documentId: 'SRC-GEO-001',
    documentName: '工程地质勘察报告',
    documentType: '地质资料',
    version: 'V2.0',
    chapterPath: '第 3 章 岩土工程特性',
    page: '第 28 页',
    summary: '给出试验区段各土层强度、变形与渗透参数建议值，作为开挖面稳定性评估输入。',
    referencedBy: ['RISK-2026-007'],
  },
  {
    segmentId: 'SRC-GEO-001-CH05-SEG012',
    name: '水文地质条件',
    documentId: 'SRC-GEO-001',
    documentName: '工程地质勘察报告',
    documentType: '地质资料',
    version: 'V2.0',
    chapterPath: '第 5 章 地下水与渗流分析',
    page: '第 55 页',
    summary: '扩挖段局部存在隔水薄弱带，注浆压力不足时渗流通道易发育。',
    referencedBy: ['RISK-2026-005', 'RISK-2026-011', 'RM-INRUSH-003'],
  },
  {
    segmentId: 'SRC-PLAN-002-CH04-SEG006',
    name: '扩径准备工序',
    documentId: 'SRC-PLAN-002',
    documentName: '变径空间扩挖与支护专项施工方案',
    documentType: '专项施工方案',
    version: 'V3.1',
    chapterPath: '第 4 章 扩径准备',
    page: '第 18 页',
    summary: '规定扩径模块吊装、定位与调试的作业顺序和验收要点。',
    referencedBy: ['RISK-2026-010'],
  },
  {
    segmentId: 'SRC-PLAN-002-CH06-SEG011',
    name: '变径空间扩挖与支护工序',
    documentId: 'SRC-PLAN-002',
    documentName: '变径空间扩挖与支护专项施工方案',
    documentType: '专项施工方案',
    version: 'V3.1',
    chapterPath: '第 6 章 变径空间扩挖与支护',
    page: '第 34 页',
    summary: '明确扩挖进尺、支护闭合时限与注浆参数控制要求，是主风险识别与评估的核心工序依据。',
    referencedBy: ['RISK-2026-001', 'RISK-2026-002', 'RISK-2026-006', 'RM-SETTLE-004', 'ASSESS-2026-001'],
  },
  {
    segmentId: 'SRC-PLAN-002-CH07-SEG003',
    name: '刀盘扩径工序',
    documentId: 'SRC-PLAN-002',
    documentName: '变径空间扩挖与支护专项施工方案',
    documentType: '专项施工方案',
    version: 'V3.1',
    chapterPath: '第 7 章 刀盘扩径',
    page: '第 47 页',
    summary: '规定刀盘扩径工况下的扭矩、推力与渣土改良控制要求。',
    referencedBy: ['RISK-2026-003', 'RISK-2026-007', 'RM-EQUIP-005'],
  },
  {
    segmentId: 'SRC-PLAN-002-CH08-SEG009',
    name: '盾体扩径工序',
    documentId: 'SRC-PLAN-002',
    documentName: '变径空间扩挖与支护专项施工方案',
    documentType: '专项施工方案',
    version: 'V3.1',
    chapterPath: '第 8 章 盾体扩径',
    page: '第 58 页',
    summary: '规定盾体扩径段钢管片拼装与锚杆连接的质量控制要点。',
    referencedBy: ['RISK-2026-004', 'RISK-2026-009', 'RM-JOINT-006'],
  },
  {
    segmentId: 'SRC-PLAN-002-CH09-SEG002',
    name: '缩径转换工序',
    documentId: 'SRC-PLAN-002',
    documentName: '变径空间扩挖与支护专项施工方案',
    documentType: '专项施工方案',
    version: 'V3.1',
    chapterPath: '第 9 章 缩径转换',
    page: '第 66 页',
    summary: '规定缩径转换段支护刚度过渡与受力转换控制要求。',
    referencedBy: ['RISK-2026-012'],
  },
  {
    segmentId: 'SRC-MON-003-20260827-SEG021',
    name: '地下水位监测摘要',
    documentId: 'SRC-MON-003',
    documentName: '站隧一体化试验区段监测数据集',
    documentType: '监测数据',
    version: '2026-08-27 批次',
    chapterPath: '地下水位监测序列',
    page: '2026-08-27 监测摘要',
    summary: '扩挖段地下水位小幅抬升，局部渗水量增大，需结合注浆压力联合研判。',
    referencedBy: ['RISK-2026-005', 'RM-INRUSH-003'],
  },
  {
    segmentId: 'SRC-MON-003-20260827-SEG027',
    name: '盾构姿态与压力监测摘要',
    documentId: 'SRC-MON-003',
    documentName: '站隧一体化试验区段监测数据集',
    documentType: '监测数据',
    version: '2026-08-27 批次',
    chapterPath: '盾构姿态与压力监测序列',
    page: '2026-08-27 监测摘要',
    summary: '土仓压力波动幅度增大，掌子面水土压力平衡需持续关注。',
    referencedBy: ['RISK-2026-002', 'RM-FACE-001'],
  },
  {
    segmentId: 'SRC-MON-003-20260827-SEG034',
    name: '注浆压力监测摘要',
    documentId: 'SRC-MON-003',
    documentName: '站隧一体化试验区段监测数据集',
    documentType: '监测数据',
    version: '2026-08-27 批次',
    chapterPath: '注浆参数监测序列',
    page: '2026-08-27 监测摘要',
    summary: '注浆压力降至 0.18 MPa，低于生效区间 0.20–0.25 MPa 下限。',
    referencedBy: ['RISK-2026-001', 'RISK-2026-011', 'ASSESS-2026-001', 'WARN-2026-001'],
  },
  {
    segmentId: 'SRC-MON-003-20260827-SEG035',
    name: '支护结构变形监测摘要',
    documentId: 'SRC-MON-003',
    documentName: '站隧一体化试验区段监测数据集',
    documentType: '监测数据',
    version: '2026-08-27 批次',
    chapterPath: '支护结构变形监测序列',
    page: '2026-08-27 监测摘要',
    summary: '支护结构变形累计 8.4 mm，超过监测预警阈值 8.0 mm。',
    referencedBy: ['RISK-2026-001', 'RISK-2026-006', 'RM-SUPPORT-002', 'ASSESS-2026-001', 'WARN-2026-001'],
  },
  {
    segmentId: 'SRC-MON-003-20260827-SEG036',
    name: '地表沉降监测摘要',
    documentId: 'SRC-MON-003',
    documentName: '站隧一体化试验区段监测数据集',
    documentType: '监测数据',
    version: '2026-08-27 批次',
    chapterPath: '地表沉降监测序列',
    page: '2026-08-27 监测摘要',
    summary: '地表沉降累计 13.6 mm，超过监测预警阈值 12.0 mm；短期斜率 2.3 mm/d，超过 2.0 mm/d。',
    referencedBy: ['RISK-2026-001', 'RM-SETTLE-004', 'ASSESS-2026-001', 'WARN-2026-001'],
  },
  {
    segmentId: 'SRC-EQP-004-CH02-SEG005',
    name: '扩挖机构与拼装系统设计参数',
    documentId: 'SRC-EQP-004',
    documentName: '变径盾构装备设计资料',
    documentType: '装备设计资料',
    version: 'V1.4',
    chapterPath: '第 2 章 扩挖机构与拼装机械臂',
    page: '第 12 页',
    summary: '给出扩挖机构行程、拼装机械臂定位精度与伸缩帽檐结构参数。',
    referencedBy: ['RISK-2026-004', 'RISK-2026-010', 'RM-JOINT-006'],
  },
  {
    segmentId: 'SRC-EQP-004-CH03-SEG008',
    name: '主驱动与液压系统设计参数',
    documentId: 'SRC-EQP-004',
    documentName: '变径盾构装备设计资料',
    documentType: '装备设计资料',
    version: 'V1.4',
    chapterPath: '第 3 章 主驱动与液压系统',
    page: '第 21 页',
    summary: '给出主驱动额定扭矩、推力与液压系统额定负荷区间。',
    referencedBy: ['RISK-2026-003', 'RISK-2026-008', 'RM-EQUIP-005'],
  },
  {
    segmentId: 'SRC-STD-007-CH02-SEG004',
    name: '地表沉降累计值量化区间',
    documentId: 'SRC-STD-007',
    documentName: '项目风险评估量化标准',
    documentType: '标准文件',
    version: 'V1.0',
    chapterPath: '第 2 章 发生可能性量化标准',
    page: '第 6 页',
    summary: '规定地表沉降累计值的五档评分区间与阈值来源。',
    referencedBy: ['RULE-EXPAND-01', 'RULESET-EXPAND-01'],
  },
  {
    segmentId: 'SRC-STD-007-CH02-SEG005',
    name: '地表沉降短期斜率量化区间',
    documentId: 'SRC-STD-007',
    documentName: '项目风险评估量化标准',
    documentType: '标准文件',
    version: 'V1.0',
    chapterPath: '第 2 章 发生可能性量化标准',
    page: '第 7 页',
    summary: '规定地表沉降短期斜率的五档评分区间与趋势判定口径。',
    referencedBy: ['RULE-EXPAND-02', 'RULESET-EXPAND-01'],
  },
  {
    segmentId: 'SRC-STD-007-CH02-SEG006',
    name: '支护结构变形量化区间',
    documentId: 'SRC-STD-007',
    documentName: '项目风险评估量化标准',
    documentType: '标准文件',
    version: 'V1.0',
    chapterPath: '第 2 章 发生可能性量化标准',
    page: '第 8 页',
    summary: '规定支护结构变形的五档评分区间。',
    referencedBy: ['RULE-EXPAND-03', 'RULESET-EXPAND-01'],
  },
  {
    segmentId: 'SRC-STD-007-CH02-SEG007',
    name: '注浆压力量化区间',
    documentId: 'SRC-STD-007',
    documentName: '项目风险评估量化标准',
    documentType: '标准文件',
    version: 'V1.0',
    chapterPath: '第 2 章 发生可能性量化标准',
    page: '第 9 页',
    summary: '规定注浆压力偏离生效区间的分档评分口径。',
    referencedBy: ['RULE-EXPAND-04', 'RULESET-EXPAND-01'],
  },
]

/** 监测序列（趋势图数据源） */
export interface MonitoringSeries {
  id: string
  name: string
  unit: string
  threshold: number
  thresholdLabel: string
  currentValue: number
  status: string
  points: { date: string; value: number }[]
}

export const monitoringSeries: MonitoringSeries[] = [
  {
    id: 'MON-SERIES-SETTLE-01',
    name: '地表沉降累计值',
    unit: 'mm',
    threshold: 12.0,
    thresholdLabel: '监测预警阈值 12.0 mm',
    currentValue: 13.6,
    status: '越限',
    points: [
      { date: '08-21', value: 8.2 },
      { date: '08-22', value: 8.8 },
      { date: '08-23', value: 9.5 },
      { date: '08-24', value: 10.1 },
      { date: '08-25', value: 11.0 },
      { date: '08-26', value: 12.2 },
      { date: '08-27', value: 13.6 },
    ],
  },
  {
    id: 'MON-SERIES-DEFORM-01',
    name: '支护结构变形',
    unit: 'mm',
    threshold: 8.0,
    thresholdLabel: '监测预警阈值 8.0 mm',
    currentValue: 8.4,
    status: '越限',
    points: [
      { date: '08-21', value: 5.1 },
      { date: '08-22', value: 5.6 },
      { date: '08-23', value: 6.0 },
      { date: '08-24', value: 6.5 },
      { date: '08-25', value: 7.1 },
      { date: '08-26', value: 7.8 },
      { date: '08-27', value: 8.4 },
    ],
  },
  {
    id: 'MON-SERIES-GROUT-01',
    name: '注浆压力',
    unit: 'MPa',
    threshold: 0.2,
    thresholdLabel: '生效区间下限 0.20 MPa',
    currentValue: 0.18,
    status: '低于区间',
    points: [
      { date: '08-21', value: 0.23 },
      { date: '08-22', value: 0.23 },
      { date: '08-23', value: 0.22 },
      { date: '08-24', value: 0.22 },
      { date: '08-25', value: 0.21 },
      { date: '08-26', value: 0.2 },
      { date: '08-27', value: 0.18 },
    ],
  },
]

/** 审计时间线（操作者统一为"系统"/"风险管理人员"） */
export interface AuditEvent {
  time: string
  title: string
  actor: string
  done: boolean
}

export const auditTimeline: AuditEvent[] = [
  { time: '09:12', title: '监测资料更新入库', actor: '系统', done: true },
  { time: '09:18', title: '风险识别完成', actor: '系统', done: true },
  { time: '09:21', title: '风险评估完成', actor: '系统', done: true },
  { time: '09:22', title: '预警信息入库', actor: '系统', done: true },
  { time: '09:24', title: '处置建议待确认', actor: '风险管理人员', done: false },
]
