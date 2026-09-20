// P-AG-02 Agent 全屏工作台（AG 骨架；branch agent-task.start-task；能力位 agent-task.read）。
// 与停靠栏共用 AG 骨架：会话任务列表（任务类型 / 状态 / 预算消耗）+ 任务摘要头部 +
// 消息流 + 输入与待确认命令区，全屏形态增加任务列表与五类必经内嵌任务说明。
// 七态：input.pageState 经 PageFrame 承载；无任务时落入自然 empty 态。

import type { RouteRenderInput } from '../../app/routes';
import {
  ACTIVE_SESSION_TASK_ID,
  AGENT_LINKS,
  AGENT_SESSION_MESSAGES,
  AGENT_TASKS,
  AGENT_TASK_TYPE_LABELS,
  AGENT_TRIGGER_MODE_LABELS,
  PENDING_COMMANDS,
  agentTaskById,
} from '../../content/agent';
import { PageFrame } from '../../shared/PageFrame';
import {
  InputArea,
  MessageFlow,
  PendingCommandCard,
  TaskStatusChip,
  TaskSummaryHeader,
} from './agent-shared';
import './agent.css';

export function AgentWorkbenchPage({ input }: { readonly input: RouteRenderInput }) {
  const activeTask = agentTaskById(ACTIVE_SESSION_TASK_ID);
  const state =
    input.pageState.kind === 'ready' && AGENT_TASKS.length === 0
      ? ({ kind: 'empty' } as const)
      : input.pageState;

  return (
    <PageFrame
      title="Agent 全屏工作台"
      state={state}
      skeleton="AG"
      emptyMessage="当前没有 Agent 任务"
      content={
        <div>
          <section className="ag-card" aria-label="会话任务">
            <h3 className="ag-card-title">会话任务</h3>
            <div className="ag-table-wrap">
              <table className="ag-table">
                <thead>
                  <tr>
                    <th>任务标识</th>
                    <th>任务类型</th>
                    <th>触发方式</th>
                    <th>状态</th>
                    <th>预算消耗（Token / 工具调用）</th>
                  </tr>
                </thead>
                <tbody>
                  {AGENT_TASKS.map((task) => (
                    <tr key={task.ref.reference.entityId}>
                      <td>
                        <a
                          className="mono"
                          href={AGENT_LINKS.taskDetail(task.ref.reference.entityId)}
                        >
                          {task.ref.reference.entityId}
                        </a>
                      </td>
                      <td>{AGENT_TASK_TYPE_LABELS[task.ref.taskType]}</td>
                      <td>{AGENT_TRIGGER_MODE_LABELS[task.ref.triggerMode]}</td>
                      <td>
                        <TaskStatusChip status={task.status} />
                      </td>
                      <td className="mono">
                        {task.budget.tokensUsed} / {task.budget.tokensLimit} ·{' '}
                        {task.budget.toolCallsUsed} / {task.budget.toolCallsLimit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ag-note">
              内嵌任务固定为五类必经类型：数据清洗与部分可用判断、非结构化知识编制、
              识别检索审阅与有界补搜、处置建议组合排序、偏差超限后的校准建议候选；
              每个任务固定发起者、工程、输入版本、模型与提示模板、工具策略、资源预算、
              增量类型与终态。
            </p>
          </section>

          {activeTask === undefined ? null : <TaskSummaryHeader task={activeTask} />}
          <MessageFlow messages={AGENT_SESSION_MESSAGES} taskHref={AGENT_LINKS.taskDetail} />
          <PendingCommandCard commands={PENDING_COMMANDS} capabilities={input.capabilities} />
          <InputArea capabilities={input.capabilities} />
        </div>
      }
    />
  );
}
