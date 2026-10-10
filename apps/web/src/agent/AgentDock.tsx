import { Link } from "react-router-dom";

import { Icon } from "../components/icons";
import { useProjectPath } from "../api/engineering";
import { useAgentTask } from "./AgentTaskProvider";
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
import { useAgentDockOpen, setAgentDock } from "./agentDockStore";
import "./AgentDock.css";

const label = (labels: Readonly<Record<string, string>>, value: string): string =>
  labels[value] ?? value;

/**
 * 全局 Agent 停靠栏：右侧固定面板，可展开/收起，挂在 AppShell 内。
 * 与全屏工作台、任务详情读同一份 `useAgentTask()` 任务事实：
 * 呈现当前精确任务的真实上下文、预算台账、动作可用性与提案，不含自由聊天输入，
 * 也不在浏览器里执行任何工具。
 */
export function AgentDock({ context }: { context?: string[] }) {
  const open = useAgentDockOpen();
  const projectPath = useProjectPath();
  const { taskRef, detail, error, loading } = useAgentTask();

  return (
    <aside className={`agent-dock${open ? " agent-dock--open" : ""}`} aria-hidden={!open}>
      <header className="agent-dock-header">
        <span className="agent-dock-title">
          <Icon name="agent" size={18} />
          智能 Agent
        </span>
        <button
          type="button"
          className="agent-dock-close"
          onClick={() => setAgentDock(false)}
          aria-label="收起智能 Agent"
        >
          <Icon name="close" size={16} />
        </button>
      </header>

      {context !== undefined && context.length > 0 && (
        <div className="agent-dock-context">
          {context.map((c) => (
            <span key={c} className="agent-dock-context-tag">
              {c}
            </span>
          ))}
        </div>
      )}

      <div className="agent-dock-body">
        {taskRef === undefined || detail === undefined ? (
          <AgentEmpty>
            {error !== undefined
              ? `读取任务详情失败（${error}）。`
              : loading
                ? "正在读取任务…"
                : "尚未选择 Agent 任务。"}
          </AgentEmpty>
        ) : (
          <>
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
                {...(detail.currentProposal === undefined
                  ? {}
                  : { proposal: detail.currentProposal })}
              />
            </section>

            <section className="ag-card" aria-label="任务动作可用性">
              <h3 className="ag-card-title">任务动作可用性</h3>
              <AgentActionAvailabilityList actions={detail.actions} />
              <p className="ag-note">只读授权不等于写权；界面不提供放宽预算或绕过确认的入口。</p>
            </section>
          </>
        )}
      </div>

      <footer className="agent-dock-footer">
        <Link
          to={projectPath("/agent")}
          className="agent-expand-link"
          onClick={() => setAgentDock(false)}
        >
          展开为全屏工作台
          <Icon name="arrowRight" size={14} />
        </Link>
        {taskRef !== undefined && (
          <Link
            to={projectPath(agentTaskDetailPath(taskRef))}
            className="agent-expand-link"
            onClick={() => setAgentDock(false)}
          >
            查看任务详情
            <Icon name="arrowRight" size={14} />
          </Link>
        )}
      </footer>
    </aside>
  );
}
