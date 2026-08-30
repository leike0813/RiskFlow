/**
 * 复核与运行记录 SSOT。
 * 事实源：prototypes/screenshot-content-inventory.md §4（待人工复核 2 口径）。
 */

/** 复核任务（统一复核队列） */
export interface ReviewTask {
  id: string
  type: string
  targetId: string
  targetName: string
  triggerReason: string
  submittedAt: string
  status: '待复核' | '已完成'
}

export const reviewTasks: ReviewTask[] = [
  {
    id: 'RV-2026-001',
    type: '识别候选复核',
    targetId: 'RISK-2026-007',
    targetName: '刀盘扩径开挖面稳定性下降',
    triggerReason: '模型置信度 0.72 低于自动验收阈值',
    submittedAt: '2026-08-27 09:18',
    status: '待复核',
  },
  {
    id: 'RV-2026-002',
    type: '规则草案复核',
    targetId: 'RULE-EXPAND-05',
    targetName: '地下水位评分规则草案',
    triggerReason: '与 RULE-EXPAND-02 存在覆盖重叠，一致性校验未通过',
    submittedAt: '2026-08-26 16:40',
    status: '待复核',
  },
  {
    id: 'RV-2026-003',
    type: '识别候选复核',
    targetId: 'RISK-2026-004',
    targetName: '盾体扩径阶段钢管片装配连接异常',
    triggerReason: '多来源合并后事件表达存在差异',
    submittedAt: '2026-08-26 10:12',
    status: '已完成',
  },
]

/** LangGraph 运行记录（识别 / 评估 / 预测各至少一条） */
export interface RunRecord {
  runId: string
  type: '识别' | '评估' | '预测'
  graph: string
  graphVersion: string
  status: string
  startedAt: string
  operator: string
  triggerReason: string
}

export const runRecords: RunRecord[] = [
  {
    runId: 'RUN-20260827-001',
    type: '识别',
    graph: 'identificationGraph',
    graphVersion: 'V1',
    status: '已完成',
    startedAt: '2026-08-27 09:14',
    operator: '系统',
    triggerReason: '监测资料更新入库',
  },
  {
    runId: 'RUN-20260827-002',
    type: '评估',
    graph: 'assessmentGraph',
    graphVersion: 'V1',
    status: '已完成',
    startedAt: '2026-08-27 09:19',
    operator: '系统',
    triggerReason: '监测摘要更新',
  },
  {
    runId: 'RUN-20260827-003',
    type: '预测',
    graph: 'assessmentGraph',
    graphVersion: 'V1',
    status: '已完成',
    startedAt: '2026-08-27 09:23',
    operator: '系统',
    triggerReason: '处置效果预测请求',
  },
  {
    runId: 'RUN-20260826-004',
    type: '识别',
    graph: 'identificationGraph',
    graphVersion: 'V1',
    status: '已完成',
    startedAt: '2026-08-26 15:02',
    operator: '风险管理人员',
    triggerReason: '手动启动识别',
  },
]
