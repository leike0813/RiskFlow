// P-AG-01 Agent 停靠栏（AG 骨架；branch agent-task.start-task；能力位 agent-task.read）。
// 停靠栏内嵌形态：任务摘要头部 + 消息流 + 输入与待确认命令区，容器宽度收敛。
// 写命令提交前必须用户确认；任务详情跳转 P-AG-03。
// 七态：input.pageState 经 PageFrame 承载；会话无任务时落入自然 empty 态。

import type { RouteRenderInput } from '../../app/routes';
import {
  ACTIVE_SESSION_TASK_ID,
  AGENT_LINKS,
  AGENT_SESSION_MESSAGES,
  PENDING_COMMANDS,
  agentTaskById,
} from '../../content/agent';
import { PageFrame } from '../../shared/PageFrame';
import {
  InputArea,
  MessageFlow,
  PendingCommandCard,
  TaskSummaryHeader,
} from './agent-shared';
import './agent.css';

export function AgentDockPage({ input }: { readonly input: RouteRenderInput }) {
  const activeTask = agentTaskById(ACTIVE_SESSION_TASK_ID);
  const state =
    input.pageState.kind === 'ready' && activeTask === undefined
      ? ({ kind: 'empty' } as const)
      : input.pageState;

  return (
    <PageFrame
      title="Agent 停靠栏"
      state={state}
      skeleton="AG"
      emptyMessage="当前没有进行中的 Agent 任务"
      className="ag-page--dock"
      content={
        activeTask === undefined ? null : (
          <div>
            <TaskSummaryHeader task={activeTask} />
            <MessageFlow messages={AGENT_SESSION_MESSAGES} taskHref={AGENT_LINKS.taskDetail} />
            <PendingCommandCard commands={PENDING_COMMANDS} capabilities={input.capabilities} />
            <InputArea capabilities={input.capabilities} />
            <p className="ag-note">
              展开完整会话与任务列表请前往{' '}
              <a href={AGENT_LINKS.workbench}>Agent 全屏工作台</a>；当前任务详情见{' '}
              <a className="mono" href={AGENT_LINKS.taskDetail(activeTask.ref.reference.entityId)}>
                {activeTask.ref.reference.entityId}
              </a>
              。
            </p>
          </div>
        )
      }
    />
  );
}
