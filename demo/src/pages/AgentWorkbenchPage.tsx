/**
 * 智能 Agent 全屏工作台（/agent，design D-01/D-03/D-04/D-05）。
 *
 * 三列沿 v2 的会话与任务 / 当前任务 / 信封与预算分区，事实全部来自共享的 `useAgentTask()`：
 * 与停靠栏、任务详情指向同一个精确任务版本，不另发轮询、也不各自缓存一份列表。
 * 页面不含自由输入区、不含客户端工具执行、不含任何原型问答或样例结果。
 */
import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import AppShell from '../components/AppShell'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { Icon } from '../components/icons'
import { useEngineering, useProjectPath } from '../api/context'
import { useAgentTask } from '../agent/AgentTaskProvider'
import {
  AGENT_TASK_TYPE_LABELS,
  AGENT_TRIGGER_MODE_LABELS,
  AgentActionAvailabilityList,
  AgentBudgetCompare,
  AgentCard,
  AgentEmpty,
  AgentField,
  AgentFields,
  AgentLaunchPanel,
  AgentProposalPanel,
  TaskStatusChip,
  VersionRefText,
  agentTaskDetailPath,
} from '../agent/agentShared'
// Agent 域共享分区样式与停靠栏同源，全应用只保留一份。
import '../agent/AgentDock.css'
import './AgentWorkbenchPage.css'

const label = (labels: Readonly<Record<string, string>>, value: string): string => labels[value] ?? value

const taskColumns: DataTableColumn[] = [
  {
    key: 'ref',
    title: '任务标识',
    width: 210,
    render: (row) => (
      <span className="mono">
        {(row.ref as { entityId: string }).entityId} · {(row.ref as { versionId: string }).versionId}
      </span>
    ),
  },
  {
    key: 'taskType',
    title: '任务类型',
    width: 190,
    render: (row) => <span>{label(AGENT_TASK_TYPE_LABELS, row.taskType as string)}</span>,
  },
  {
    key: 'triggerMode',
    title: '触发方式',
    width: 100,
    render: (row) => <span>{label(AGENT_TRIGGER_MODE_LABELS, row.triggerMode as string)}</span>,
  },
  {
    key: 'status',
    title: '状态',
    width: 120,
    render: (row) => <TaskStatusChip status={row.status as string} />,
  },
  {
    key: 'frozenInput',
    title: '冻结输入',
    render: (row) => {
      const frozen = row.frozenInputRef as { kind: string; reference: { entityId: string; versionId: string } }
      return (
        <span className="mono">
          {frozen.reference.entityId} · {frozen.reference.versionId}
        </span>
      )
    },
  },
  {
    key: 'updatedAt',
    title: '更新时间',
    width: 190,
    render: (row) => <span className="mono">{row.updatedAt as string}</span>,
  },
]

export default function AgentWorkbenchPage() {
  const navigate = useNavigate()
  const { selector } = useEngineering()
  const projectPath = useProjectPath()
  const { list, taskRef, detail, launchContext, openTask, refreshNow, error, loading, lastUpdatedAt } =
    useAgentTask()
  const projectId = selector.projectId

  // 首次进入工作台且尚未选择任务时，把当前任务列表页的第一条设为共享选择：
  // 选择来自服务端返回的精确引用，不在前端另造身份。
  useEffect(() => {
    if (taskRef !== undefined) return
    const first = list?.items[0]
    if (first !== undefined) openTask(first.agentTaskRef)
  }, [list, openTask, taskRef])

  const rows = (list?.items ?? []).map((item) => ({
    ref: item.agentTaskRef.reference,
    taskType: item.agentTaskRef.taskType,
    triggerMode: item.agentTaskRef.triggerMode,
    status: item.status,
    frozenInputRef: item.frozenInputRef,
    updatedAt: item.updatedAt,
    agentTaskRef: item.agentTaskRef,
  }))

  const selectTask = (row: Record<string, unknown>) => {
    const selected = row.agentTaskRef as Parameters<typeof openTask>[0]
    openTask(selected)
    navigate(projectPath(agentTaskDetailPath(selected)))
  }

  return (
    <AppShell
      activeNav={null}
      agentContext={
        projectId === null ? [] : [projectId, ...(taskRef === undefined ? [] : [taskRef.reference.entityId])]
      }
    >
      <div className="page awb-page">
        <header className="page-header">
          <div>
            <h1 className="page-title">智能 Agent</h1>
            <p className="page-subtitle">
              当前工程的 Agent 任务、预算台账、工具行动与确定性校验，全部取自服务端真实事实
            </p>
          </div>
          <button type="button" className="agd-refresh" onClick={refreshNow} disabled={loading}>
            {loading ? '刷新中…' : '立即刷新'}
          </button>
        </header>

        <div className="awb-grid">
          <div className="awb-col awb-col--wide">
            <AgentCard
              title="会话与任务"
              extra={
                <span className="ag-muted">
                  {list === undefined ? '' : `${list.items.length} 项`}
                  {list?.nextCursor !== undefined ? ' · 后续页需按游标续读' : ''}
                </span>
              }
            >
              {list === undefined ? (
                <AgentEmpty>
                  {error !== undefined ? `读取任务列表失败（${error}）。` : '正在读取当前工程的 Agent 任务…'}
                </AgentEmpty>
              ) : rows.length === 0 ? (
                <AgentEmpty>当前工程暂无 Agent 任务。</AgentEmpty>
              ) : (
                <DataTable columns={taskColumns} rows={rows} onRowClick={selectTask} />
              )}
              <p className="ag-note">
                内嵌必经任务固定为五类：数据清洗与部分可用判断、非结构化知识编制、识别检索审阅与有界补搜、
                处置建议组合排序、偏差超限后的校准建议候选。行点击按精确身份打开任务详情。
              </p>
            </AgentCard>
          </div>

          <div className="awb-col awb-col--side">
            {taskRef === undefined || detail === undefined ? (
              <AgentCard title="当前任务">
                <AgentEmpty>
                  {taskRef === undefined
                    ? '尚未选择任务。'
                    : error !== undefined
                      ? `读取任务详情失败（${error}）。`
                      : '正在读取任务详情…'}
                </AgentEmpty>
              </AgentCard>
            ) : (
              <>
                <AgentCard title="当前任务">
                  <div className="awb-task-head">
                    <span className="mono">
                      {taskRef.reference.entityId} · {taskRef.reference.versionId}
                    </span>
                    <TaskStatusChip status={detail.summary.status} />
                  </div>
                  <AgentFields>
                    <AgentField label="任务类型">{label(AGENT_TASK_TYPE_LABELS, taskRef.taskType)}</AgentField>
                    <AgentField label="触发方式">{label(AGENT_TRIGGER_MODE_LABELS, taskRef.triggerMode)}</AgentField>
                    <AgentField label="发起者">
                      <span className="mono">{detail.summary.initiatorActorId}</span>
                    </AgentField>
                    <AgentField label="上游工作流运行">
                      <span className="mono">
                        {detail.summary.parentRunRef.reference.entityId} ·{' '}
                        {detail.summary.parentRunRef.reference.versionId}
                      </span>
                    </AgentField>
                    <AgentField label="冻结输入">
                      <span className="mono">
                        {detail.summary.frozenInputRef.reference.entityId} ·{' '}
                        {detail.summary.frozenInputRef.reference.versionId}
                      </span>
                    </AgentField>
                  </AgentFields>
                  <div className="ag-btn-row">
                    <Link className="ag-btn ag-btn--primary" to={projectPath(agentTaskDetailPath(taskRef))}>
                      打开任务详情
                      <Icon name="arrowRight" size={13} />
                    </Link>
                  </div>
                </AgentCard>

                <AgentCard title="资源消耗" extra={<span className="ag-muted">原策略上限 / 原台账用量</span>}>
                  <AgentBudgetCompare budget={detail.budget} />
                  <div className="agd-refs">
                    <VersionRefText label="预算策略" reference={taskRef.budgetPolicyRef} />
                    <VersionRefText label="工具策略" reference={taskRef.toolPolicyRef} />
                    <VersionRefText label="校验策略" reference={taskRef.validationPolicyRef} />
                  </div>
                </AgentCard>

                <AgentCard title="当前提案">
                  <AgentProposalPanel proposal={detail.currentProposal} />
                </AgentCard>
              </>
            )}
          </div>

          <div className="awb-col awb-col--side">
            <AgentCard title="任务动作可用性">
              {detail === undefined ? (
                <AgentEmpty>选择任务后呈现服务端判定的动作可用性。</AgentEmpty>
              ) : (
                <AgentActionAvailabilityList actions={detail.actions} />
              )}
              <div className="awb-launch">
                {taskRef === undefined || projectId === null || launchContext === undefined ? (
                  <AgentEmpty>选择任务后按已登记定义判断是否可启动交互任务。</AgentEmpty>
                ) : (
                  <AgentLaunchPanel
                    projectId={projectId}
                    taskRef={taskRef}
                    launchContext={launchContext}
                    onStarted={refreshNow}
                  />
                )}
              </div>
            </AgentCard>

            <AgentCard title="失败与结果引用">
              {detail === undefined ? (
                <AgentEmpty>选择任务后呈现结构化安全错误与正式结果引用。</AgentEmpty>
              ) : detail.safeError !== undefined ? (
                <AgentFields>
                  <AgentField label="错误码">
                    <span className="mono">{detail.safeError.code}</span>
                  </AgentField>
                  <AgentField label="是否可重试">
                    {detail.safeError.retryable ? '可重试' : '不可重试'}
                  </AgentField>
                  <AgentField label="失败阶段">
                    <span className="mono">{detail.safeError.stage}</span>
                  </AgentField>
                </AgentFields>
              ) : detail.resultRef !== undefined ? (
                <AgentFields>
                  <AgentField label="正式结果引用">
                    <span className="mono">
                      {detail.resultRef.reference.entityId} · {detail.resultRef.reference.versionId}
                    </span>
                  </AgentField>
                </AgentFields>
              ) : (
                <AgentEmpty>当前任务尚未产生失败或正式结果引用。</AgentEmpty>
              )}
            </AgentCard>

            <AgentCard title="读取状态">
              <AgentFields>
                <AgentField label="最近刷新">
                  <span className="mono">{lastUpdatedAt ?? '尚未刷新'}</span>
                </AgentField>
                <AgentField label="工程">
                  <span className="mono">{projectId ?? '尚未选择工程'}</span>
                </AgentField>
              </AgentFields>
              <p className="ag-note">
                停靠栏、工作台与任务详情共用同一份任务事实，刷新单在途且按固定节拍进行；
                切换工程或注销立即清除任务、提案与证据。
              </p>
            </AgentCard>
          </div>
        </div>
      </div>
    </AppShell>
  )
}