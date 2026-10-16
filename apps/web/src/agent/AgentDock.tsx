import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { Icon } from "../components/icons";
import { useProjectPath } from "../api/engineering";
import type {
  AgentTaskDetailView,
  AgentTaskListView,
  AgentTaskRefView,
} from "../api/agentAuditOperations";
import type { AgentContributionV1 } from "../shell/dock/RightDock";
import { useAgentTask, useAgentTaskOptional } from "./AgentTaskProvider";
import {
  AGENT_TASK_TYPE_LABELS,
  AGENT_TRIGGER_MODE_LABELS,
  AgentActionAvailabilityList,
  AgentBudgetCompare,
  AgentEmpty,
  AgentField,
  AgentFields,
  AgentProposalPanel,
  TaskStatusChip,
  agentTaskDetailPath,
} from "./agentShared";
import "./AgentDock.css";

const label = (labels: Readonly<Record<string, string>>, value: string): string =>
  labels[value] ?? value;

/** Provider 用空串表示「没有错误」；空串不是一条失败事实。 */
const failureText = (error: string | undefined): string | undefined =>
  error === undefined || error === "" ? undefined : error;

/** 内容读的共享任务事实：与工作台、任务详情同源，这里不另发轮询也不另存缓存。 */
export type AgentDockViewV1 = Readonly<{
  list: AgentTaskListView | undefined;
  taskRef: AgentTaskRefView | undefined;
  detail: AgentTaskDetailView | undefined;
  loading: boolean;
  error: string | undefined;
}>;

/**
 * Agent 内容槽：RightDock 的「Agent」标签里呈现的真实任务事实。
 *
 * 开合由 RightDock 的面板状态唯一拥有，这里没有第二套开关；未选任务时列出当前工程的
 * 已登记任务并可选中，选中后与工作台、任务详情共用同一份精确任务、预算台账与动作可用性。
 * 不含自由输入区，也不在浏览器里执行任何工具。
 */
export function AgentDockContent({
  view,
  projectPath,
  onSelectTask,
}: {
  readonly view: AgentDockViewV1;
  readonly projectPath: (path: string) => string;
  readonly onSelectTask: (taskRef: AgentTaskRefView) => void;
}): ReactNode {
  const { list, taskRef, detail, loading } = view;
  const failure = failureText(view.error);
  const workbenchLink = (
    <Link to={projectPath("/agent")} className="agent-expand-link">
      打开工作台
      <Icon name="arrowRight" size={14} />
    </Link>
  );

  if (taskRef === undefined || detail === undefined)
    return (
      <>
        <div className="agent-dock-body">
          <section className="ag-card" aria-label="当前工程的 Agent 任务">
            <h3 className="ag-card-title">当前工程的 Agent 任务</h3>
            {failure !== undefined ? (
              <AgentEmpty>{`读取任务失败（${failure}）。`}</AgentEmpty>
            ) : taskRef !== undefined ? (
              <AgentEmpty>正在读取任务详情…</AgentEmpty>
            ) : list === undefined ? (
              <AgentEmpty>
                {loading ? "正在读取当前工程的 Agent 任务…" : "尚未读取到任务列表。"}
              </AgentEmpty>
            ) : list.items.length === 0 ? (
              <AgentEmpty>当前工程暂无 Agent 任务。</AgentEmpty>
            ) : (
              <ul className="agent-dock-tasks">
                {list.items.map((item) => (
                  <li
                    key={`${item.agentTaskRef.reference.entityId}:${item.agentTaskRef.reference.versionId}`}
                  >
                    <button
                      type="button"
                      className="agent-dock-task"
                      onClick={() => onSelectTask(item.agentTaskRef)}
                    >
                      <span className="agent-dock-task-ref mono">
                        {item.agentTaskRef.reference.entityId} ·{" "}
                        {item.agentTaskRef.reference.versionId}
                      </span>
                      <span className="agent-dock-task-meta">
                        {label(AGENT_TASK_TYPE_LABELS, item.agentTaskRef.taskType)} ·{" "}
                        {label(AGENT_TRIGGER_MODE_LABELS, item.agentTaskRef.triggerMode)}
                      </span>
                      <TaskStatusChip status={item.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {list?.nextCursor === undefined ? null : (
              <p className="ag-note">本列表按游标分页；工作台可继续读取后续页。</p>
            )}
          </section>
        </div>
        <footer className="agent-dock-footer">{workbenchLink}</footer>
      </>
    );

  return (
    <>
      <div className="agent-dock-body">
        <section className="ag-card ag-task-summary" aria-label="当前任务摘要">
          <div className="ag-task-summary-main">
            <p className="ag-task-summary-id">
              <span className="mono">{taskRef.reference.entityId}</span>
              <TaskStatusChip status={detail.summary.status} />
            </p>
            <p className="ag-task-summary-meta">
              {label(AGENT_TASK_TYPE_LABELS, taskRef.taskType)} ·{" "}
              {label(AGENT_TRIGGER_MODE_LABELS, taskRef.triggerMode)}
            </p>
            <p className="ag-task-summary-text mono">
              {taskRef.reference.entityId} · {taskRef.reference.versionId}
            </p>
          </div>
        </section>

        <section className="ag-card" aria-label="任务上下文">
          <h3 className="ag-card-title">任务上下文</h3>
          <AgentFields>
            <AgentField label="发起者">
              <span className="mono">{detail.summary.initiatorActorId}</span>
            </AgentField>
            <AgentField label="上游工作流运行">
              <span className="mono">
                {detail.summary.parentRunRef.reference.entityId} ·{" "}
                {detail.summary.parentRunRef.reference.versionId}
              </span>
            </AgentField>
            <AgentField label="冻结输入">
              <span className="mono">
                {detail.summary.frozenInputRef.reference.entityId} ·{" "}
                {detail.summary.frozenInputRef.reference.versionId}
              </span>
            </AgentField>
          </AgentFields>
        </section>

        <section className="ag-card" aria-label="资源消耗">
          <h3 className="ag-card-title">资源消耗</h3>
          <AgentBudgetCompare budget={detail.budget} />
        </section>

        <section className="ag-card" aria-label="当前提案">
          <h3 className="ag-card-title">当前提案</h3>
          <AgentProposalPanel
            {...(detail.currentProposal === undefined ? {} : { proposal: detail.currentProposal })}
          />
        </section>

        <section className="ag-card" aria-label="任务动作可用性">
          <h3 className="ag-card-title">任务动作可用性</h3>
          <AgentActionAvailabilityList actions={detail.actions} />
        </section>
        {detail.resultRef === undefined ? null : (
          <section className="ag-card" aria-label="正式结果">
            <h3 className="ag-card-title">正式结果</h3>
            <p className="mono">
              {detail.resultRef.kind} · {detail.resultRef.reference.entityId} ·{" "}
              {detail.resultRef.reference.versionId}
            </p>
          </section>
        )}
      </div>

      <footer className="agent-dock-footer">
        {workbenchLink}
        <Link to={projectPath(agentTaskDetailPath(taskRef))} className="agent-expand-link">
          查看任务详情
          <Icon name="arrowRight" size={14} />
        </Link>
      </footer>
    </>
  );
}

/** 把共享任务事实接进内容槽；切工程与注销由 Provider 负责清空。 */
export function AgentDock(): ReactNode {
  const { list, taskRef, detail, loading, error, openTask } = useAgentTask();
  const projectPath = useProjectPath();
  return (
    <AgentDockContent
      view={{ list, taskRef, detail, loading, error }}
      projectPath={projectPath}
      onSelectTask={openTask}
    />
  );
}

/**
 * RightDock 的 Agent 贡献槽：只有真实共享任务 Provider 在树内时才提供；
 * 脱离 Provider 的宿主保持「不可用」，不伪造一份任务事实。
 */
export const useAgentDockContribution = (): AgentContributionV1 => {
  const available = useAgentTaskOptional() !== null;
  return useMemo(
    () => (available ? { kind: "ready", slot: () => <AgentDock /> } : { kind: "unavailable" }),
    [available],
  );
};
