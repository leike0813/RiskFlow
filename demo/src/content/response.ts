/**
 * 预警与处置 SSOT（评估专利 RA-S6 / RA-S7）。
 * 事实源：prototypes/screenshot-content-inventory.md §3.2 / §3.5；
 * 约束：处置建议统一状态"待现场确认"，三项校验通过，不显示已实施。
 */

/** 预警信息（RA-S6 字段契约） */
export const warningRecord = {
  id: 'WARN-2026-001',
  level: '红色预警',
  status: '待处置',
  assessmentRecordId: 'ASSESS-2026-001',
  riskRecordId: 'RISK-2026-001',
  triggerTypes: ['风险等级越限', '监测指标越限', '趋势越限', '多指标联合规则命中'],
  triggerIndicators: [
    '地表沉降累计值 13.6 mm（阈值 12.0 mm）',
    '地表沉降短期斜率 2.3 mm/d（阈值 2.0 mm/d）',
    '支护结构变形 8.4 mm（阈值 8.0 mm）',
    '注浆压力 0.18 MPa（区间 0.20–0.25 MPa）',
  ],
  suggestedDirection: '现场确认与处置',
  notificationStatus: '预警已入库',
  createdAt: '2026-08-27 09:22',
}

/** 处置建议措施项（RESP-2026-001 四步） */
export interface ResponseMeasure {
  order: number
  measure: string
  resources: string
  targetIndicator: string
  status: string
}

export const responseMeasures: ResponseMeasure[] = [
  {
    order: 1,
    measure: '复核当前扩挖进尺与支护闭合状态，按已审批方案控制作业节奏',
    resources: '现场负责人、技术负责人',
    targetIndicator: '阻止支护变形继续加速',
    status: '待现场确认',
  },
  {
    order: 2,
    measure: '复核注浆压力与注浆量，使其恢复至生效规则允许区间',
    resources: '注浆班组、注浆设备与材料',
    targetIndicator: '注浆压力恢复至 0.20–0.25 MPa',
    status: '待现场确认',
  },
  {
    order: 3,
    measure: '检查伸缩帽檐、钢管片与锚杆支护状态，必要时执行经审批的加固措施',
    resources: '支护班组、加固材料',
    targetIndicator: '支护结构变形趋势稳定',
    status: '待现场确认',
  },
  {
    order: 4,
    measure: '按预警响应等级加密地表沉降和支护结构变形监测',
    resources: '监测人员、监测设备',
    targetIndicator: '地表沉降短期斜率回落至 ≤2.0 mm/d',
    status: '待现场确认',
  },
]

/** 处置建议（RA-S7 字段契约） */
export const responseRecommendation = {
  id: 'RESP-2026-001',
  warningId: 'WARN-2026-001',
  source: '措施库候选已约束组合',
  measures: responseMeasures,
  checks: [
    { name: '触发指标一致性校验', result: '通过' },
    { name: '规范合规性校验', result: '通过' },
    { name: '现场资源与工序约束可执行性校验', result: '通过' },
  ],
  reviewStatus: '待现场确认',
  version: 'V1.0',
  audit: { createdAt: '2026-08-27 09:24', createdBy: '系统' },
}

/** 预警处置任务归集信息 */
export const responseTask = {
  id: 'TASK-2026-001',
  title: '变径空间扩挖 I 级风险处置任务',
  warningIds: ['WARN-2026-001'],
  openWarningCount: 1,
  highestLevel: 'I',
  ownerRole: '现场处置人员',
  progress: '处置建议待确认',
  relatedResponseId: 'RESP-2026-001',
}

/** 预警中心列表（与总览口径一致：生效预警 4、待处置 3、已确认 1） */
export interface WarningListItem {
  id: string
  level: string
  status: string
  riskRecordId: string
  riskEvent: string
  triggerTypes: string[]
  triggerSummary: string
  notificationStatus: string
  taskId: string
  createdAt: string
}

export const warningList: WarningListItem[] = [
  {
    id: warningRecord.id,
    level: warningRecord.level,
    status: warningRecord.status,
    riskRecordId: warningRecord.riskRecordId,
    riskEvent: '变径空间扩挖引发过挖与地表沉降超限',
    triggerTypes: warningRecord.triggerTypes,
    triggerSummary: '地表沉降、支护结构变形、注浆压力等 4 项越限',
    notificationStatus: warningRecord.notificationStatus,
    taskId: responseTask.id,
    createdAt: warningRecord.createdAt,
  },
  {
    id: 'WARN-2026-002',
    level: '橙色预警',
    status: '待处置',
    riskRecordId: 'RISK-2026-002',
    riskEvent: '变径空间扩挖阶段掌子面局部失稳',
    triggerTypes: ['监测指标越限'],
    triggerSummary: '泥水压力波动越限',
    notificationStatus: '预警已入库',
    taskId: 'TASK-2026-002',
    createdAt: '2026-08-27 08:47',
  },
  {
    id: 'WARN-2026-003',
    level: '橙色预警',
    status: '待处置',
    riskRecordId: 'RISK-2026-003',
    riskEvent: '刀盘扩径阶段主驱动负荷异常',
    triggerTypes: ['监测指标越限', '趋势越限'],
    triggerSummary: '主驱动负荷趋势越限',
    notificationStatus: '预警已入库',
    taskId: 'TASK-2026-003',
    createdAt: '2026-08-27 08:12',
  },
  {
    id: 'WARN-2026-004',
    level: '橙色预警',
    status: '已确认',
    riskRecordId: 'RISK-2026-004',
    riskEvent: '盾体扩径阶段钢管片装配连接异常',
    triggerTypes: ['多指标联合规则命中'],
    triggerSummary: '装配连接多指标联合规则命中',
    notificationStatus: '预警已入库',
    taskId: 'TASK-2026-004',
    createdAt: '2026-08-26 17:36',
  },
]

/** 预警处置任务列表（归集键：工程 + 风险稳定身份 + 处置空间范围） */
export interface ResponseTaskItem {
  id: string
  title: string
  riskRecordId: string
  warningIds: string[]
  openWarningCount: number
  highestLevel: string
  ownerRole: string
  progress: string
}

export const responseTaskList: ResponseTaskItem[] = [
  {
    id: responseTask.id,
    title: responseTask.title,
    riskRecordId: warningRecord.riskRecordId,
    warningIds: responseTask.warningIds,
    openWarningCount: responseTask.openWarningCount,
    highestLevel: responseTask.highestLevel,
    ownerRole: responseTask.ownerRole,
    progress: responseTask.progress,
  },
  {
    id: 'TASK-2026-002',
    title: '变径空间扩挖掌子面失稳处置任务',
    riskRecordId: 'RISK-2026-002',
    warningIds: ['WARN-2026-002'],
    openWarningCount: 1,
    highestLevel: 'II',
    ownerRole: '现场处置人员',
    progress: '待现场确认',
  },
  {
    id: 'TASK-2026-003',
    title: '刀盘扩径装备异常处置任务',
    riskRecordId: 'RISK-2026-003',
    warningIds: ['WARN-2026-003'],
    openWarningCount: 1,
    highestLevel: 'II',
    ownerRole: '现场处置人员',
    progress: '现场核查中',
  },
  {
    id: 'TASK-2026-004',
    title: '盾体扩径装配连接异常处置任务',
    riskRecordId: 'RISK-2026-004',
    warningIds: ['WARN-2026-004'],
    openWarningCount: 1,
    highestLevel: 'II',
    ownerRole: '现场处置人员',
    progress: '预警已确认',
  },
]
