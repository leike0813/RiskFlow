/**
 * 智能 Agent SSOT：停靠栏与全屏工作台共用的会话、任务步骤、运行摘要与引用。
 * 事实源：prototypes/screenshot-content-inventory.md §5.2；
 * 约束：只展示可审计任务步骤，不出现思维链与未经验证的性能宣传。
 */

/** 用户固定问题 */
export const agentQuestion =
  '请结合当前监测和适用规则，分析变径空间扩挖工序的主要风险，并给出处置建议和证据。'

/** Agent 回答（开头两句结论） */
export const agentAnswerLines = [
  '当前工序识别到 1 项 I 级风险。',
  '地表沉降、支护结构变形和注浆压力共同满足预警条件，建议进入现场确认与处置。',
]

/** 内嵌结构化结果摘要卡 */
export const agentResultCard = {
  riskRecordId: 'RISK-2026-001',
  riskEvent: '变径空间扩挖引发过挖与地表沉降超限',
  mechanism: '过挖与地表沉降',
  p: 4,
  c: 4,
  level: 'I',
  compositeConfidence: 0.91,
  triggerIndicators: [
    '地表沉降累计值 13.6 mm（阈值 12.0 mm）',
    '地表沉降短期斜率 2.3 mm/d（阈值 2.0 mm/d）',
    '支护结构变形 8.4 mm（阈值 8.0 mm）',
  ],
  measureSummaries: [
    '复核当前扩挖进尺与支护闭合状态，按已审批方案控制作业节奏',
    '复核注浆压力与注浆量，使其恢复至生效规则允许区间',
  ],
  links: [
    { label: '查看识别记录', to: '/identification/runs/RUN-20260827-001' },
    { label: '查看评估记录', to: '/assessment/records/ASSESS-2026-001' },
    { label: '查看完整证据链', to: '/review/trace' },
  ],
}

/** 可审计任务步骤（五步，全部为完成态） */
export const agentTaskSteps = [
  '已加载工程、区段、工序和监测上下文',
  'identificationGraph 已完成风险识别与证据校验',
  'assessmentGraph 已完成适用规则匹配和 P/C 计算',
  '已生成预警信息与待确认处置建议',
  '结果、证据和运行记录已关联入库',
]

/** 运行摘要 */
export const agentRunSummary = {
  runId: 'RUN-20260827-001',
  status: '已完成',
  graph: 'riskFlowGraph',
  graphVersion: 'V1',
  model: 'Qwen3.8-27B',
  inference: '本地推理',
}

/** 证据引用（三个资料段） */
export const agentEvidenceRefs = [
  { segmentId: 'SRC-GEO-001-CH04-SEG018', name: '地层与地下水条件' },
  { segmentId: 'SRC-PLAN-002-CH06-SEG011', name: '变径空间扩挖与支护工序' },
  { segmentId: 'SRC-MON-003-20260827-SEG036', name: '地表沉降趋势' },
]

/** 记录引用 */
export const agentRecordRefs = [
  { id: 'RISK-2026-001', label: '标准化风险记录', to: '/risks/RISK-2026-001' },
  { id: 'ASSESS-2026-001', label: '风险评估记录', to: '/assessment/records/ASSESS-2026-001' },
  { id: 'WARN-2026-001', label: '预警信息', to: '/warnings/WARN-2026-001' },
]

/** 近期任务（会话列表） */
export interface AgentTask {
  id: string
  title: string
  tag?: string
  current?: boolean
}

export const agentRecentTasks: AgentTask[] = [
  { id: 'AGT-001', title: '变径空间扩挖风险分析', tag: 'I级风险', current: true },
  { id: 'AGT-002', title: '刀盘扩径主驱动负荷复核' },
  { id: 'AGT-003', title: '盾体扩径装配状态核查' },
  { id: 'AGT-004', title: '缩径转换准备风险评估' },
]

/** 输入框占位文案 */
export const agentInputPlaceholder = '继续询问当前风险…'
