// Agent 域页内共用件：能力三态动作门控、字段卡、版本引用行、任务状态徽章、
// 任务摘要头部、消息流、输入与待确认命令区。动作能力位取该动作对应 branch 在
// contract-mirror 的映射（PAGE-GUIDE §4）；版本引用为不可变快照语义（PAGE-GUIDE §5）。

import type { ReactNode } from 'react';
import { capabilityStateFor } from '../../app/capabilities';
import {
  BRANCH_CAPABILITY,
  versionedRef,
  type ModuleBranch,
} from '../../app/contract-mirror';
import {
  AGENT_TASK_STATUS_LABELS,
  AGENT_TASK_TYPE_LABELS,
  type AgentMessageView,
  type AgentTaskView,
  type BudgetConsumptionView,
  type PendingCommandView,
  type VersionRef,
} from '../../content/agent';

/** 动作级能力门控：allowed 可点；denied 置灰并说明所需能力；unknown 显示权限检查中。 */
export function GatedAction({
  label,
  branch,
  capabilities,
  href,
}: {
  readonly label: string;
  readonly branch: ModuleBranch;
  readonly capabilities: ReadonlySet<string> | null;
  readonly href?: string;
}) {
  const required = BRANCH_CAPABILITY[branch];
  const state = capabilityStateFor(required, capabilities);
  if (state === 'unknown') {
    return (
      <button type="button" className="ag-btn" disabled>
        权限检查中
      </button>
    );
  }
  if (state === 'denied') {
    return (
      <button type="button" className="ag-btn" disabled aria-disabled="true">
        {label}
        <span className="visually-hidden">需要能力 {required}</span>
      </button>
    );
  }
  if (href !== undefined) {
    return (
      <a className="ag-btn ag-btn--primary" href={href}>
        {label}
      </a>
    );
  }
  return (
    <button type="button" className="ag-btn ag-btn--primary">
      {label}
    </button>
  );
}

/** 字段分组卡。 */
export function FieldCard({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="ag-card" aria-label={title}>
      <h3 className="ag-card-title">{title}</h3>
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="ag-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** 版本引用行：「类别 entityId · versionId」，等宽字体，不可变快照语义。 */
export function VersionRefLine({
  kind,
  reference,
}: {
  readonly kind: string;
  readonly reference: VersionRef;
}) {
  const ref = versionedRef(kind, reference.entityId, reference.versionId);
  return (
    <p className="ag-version-ref">
      <span>{ref.kind}</span>{' '}
      <span className="mono">
        {ref.reference.entityId} · {ref.reference.versionId}
      </span>
    </p>
  );
}

/** 任务状态徽章。 */
export function TaskStatusChip({ status }: { readonly status: AgentTaskView['status'] }) {
  const tone =
    status === 'completed'
      ? 'ag-chip--pass'
      : status === 'failed'
        ? 'ag-chip--fail'
        : status === 'waiting'
          ? 'ag-chip--waiting'
          : 'ag-chip--status';
  return <span className={`ag-chip ${tone}`}>{AGENT_TASK_STATUS_LABELS[status]}</span>;
}

/** 任务摘要头部（AG 骨架必备区域）：任务标识 / 类型 / 状态 / 预算消耗概要。 */
export function TaskSummaryHeader({ task }: { readonly task: AgentTaskView }) {
  return (
    <section className="ag-card ag-task-summary" aria-label="任务摘要">
      <div className="ag-task-summary-main">
        <p className="ag-task-summary-id">
          <span className="mono">{task.ref.reference.entityId}</span>{' '}
          <TaskStatusChip status={task.status} />
        </p>
        <p className="ag-task-summary-meta">
          {AGENT_TASK_TYPE_LABELS[task.ref.taskType]} · 发起者 {task.initiatorLabel}
        </p>
        <p className="ag-task-summary-text">{task.summary}</p>
      </div>
      <dl className="ag-task-summary-budget" aria-label="预算消耗">
        <div>
          <dt>Token</dt>
          <dd className="mono">
            {task.budget.tokensUsed} / {task.budget.tokensLimit}
          </dd>
        </div>
        <div>
          <dt>工具调用</dt>
          <dd className="mono">
            {task.budget.toolCallsUsed} / {task.budget.toolCallsLimit}
          </dd>
        </div>
        <div>
          <dt>墙钟时间</dt>
          <dd className="mono">
            {task.budget.wallClockSeconds}s / {task.budget.wallClockLimitSeconds}s
          </dd>
        </div>
      </dl>
    </section>
  );
}

const MESSAGE_KIND_LABELS: Readonly<Record<AgentMessageView['kind'], string>> = {
  user: '用户指令',
  agent: 'Agent 回复',
  system: '系统提示',
};

/** 消息流（AG 骨架必备区域）：用户指令 / Agent 回复 / 系统提示分层呈现。 */
export function MessageFlow({
  messages,
  taskHref,
}: {
  readonly messages: readonly AgentMessageView[];
  readonly taskHref: (taskId: string) => string;
}) {
  return (
    <section className="ag-card" aria-label="消息流">
      <h3 className="ag-card-title">消息流</h3>
      <ol className="ag-messages">
        {messages.map((message) => (
          <li
            key={message.messageId}
            className={`ag-message ag-message--${message.kind}`}
          >
            <p className="ag-message-meta">
              <span className="ag-message-kind">{MESSAGE_KIND_LABELS[message.kind]}</span>
              <span>{message.actorLabel}</span>
              <span className="mono">{message.at}</span>
              {message.relatedTaskId === null ? null : (
                <a className="mono" href={taskHref(message.relatedTaskId)}>
                  {message.relatedTaskId}
                </a>
              )}
            </p>
            <p className="ag-message-text">{message.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** 待确认命令卡：交互任务的写命令提交前必须用户确认。 */
export function PendingCommandCard({
  commands,
  capabilities,
}: {
  readonly commands: readonly PendingCommandView[];
  readonly capabilities: ReadonlySet<string> | null;
}) {
  return (
    <section className="ag-card" aria-label="待确认命令">
      <h3 className="ag-card-title">待确认命令</h3>
      {commands.length === 0 ? (
        <p className="ag-muted" style={{ margin: 0 }}>
          当前没有待确认的写命令
        </p>
      ) : (
        <ul className="ag-pending-list">
          {commands.map((command) => (
            <li key={command.proposalRef.entityId} className="ag-pending-item">
              <p className="ag-pending-head">
                <span className="mono">
                  {command.proposalRef.entityId} · {command.proposalRef.versionId}
                </span>{' '}
                <span className="ag-chip ag-chip--waiting">待确认</span>
              </p>
              <p className="ag-pending-summary">
                {command.commandKindLabel}：{command.summary}
              </p>
              <p className="ag-pending-meta">
                来源任务 <span className="mono">{command.agentTaskId}</span> · 目标{' '}
                <span className="mono">
                  {command.targetRef.entityId} · {command.targetRef.versionId}
                </span>
              </p>
              <div className="ag-btn-row">
                <GatedAction
                  label="确认提交"
                  branch="agent-task.confirm-command"
                  capabilities={capabilities}
                />
                <GatedAction
                  label="驳回"
                  branch="agent-task.confirm-command"
                  capabilities={capabilities}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="ag-note">
        写命令提交前必须用户确认；确认或驳回均由人决定，系统不自动提交。
      </p>
    </section>
  );
}

/** 输入区（AG 骨架必备区域）：发起新指令。 */
export function InputArea({
  capabilities,
}: {
  readonly capabilities: ReadonlySet<string> | null;
}) {
  return (
    <section className="ag-card" aria-label="输入区">
      <h3 className="ag-card-title">输入区</h3>
      <label className="ag-input-label" htmlFor="ag-input">
        新指令
      </label>
      <textarea
        id="ag-input"
        className="ag-input"
        rows={3}
        placeholder="输入指令，例如：依据资料段起草知识修订草稿"
      />
      <div className="ag-btn-row">
        <GatedAction
          label="发起任务"
          branch="agent-task.start-task"
          capabilities={capabilities}
        />
      </div>
      <p className="ag-note">
        发起即创建有界 Agent 任务：发起者、工程、输入版本、模型与提示模板、工具策略与资源预算在创建时固定。
      </p>
    </section>
  );
}

/** 资源消耗与预算对比。 */
export function BudgetFields({ budget }: { readonly budget: BudgetConsumptionView }) {
  return (
    <dl className="ag-fields">
      <Field label="Token 消耗 / 上限">
        <span className="mono">
          {budget.tokensUsed} / {budget.tokensLimit}
        </span>
      </Field>
      <Field label="工具调用 / 上限">
        <span className="mono">
          {budget.toolCallsUsed} / {budget.toolCallsLimit}
        </span>
      </Field>
      <Field label="候选规模 / 上限">
        <span className="mono">
          {budget.candidatesUsed} / {budget.candidatesLimit}
        </span>
      </Field>
      <Field label="墙钟时间 / 上限">
        <span className="mono">
          {budget.wallClockSeconds}s / {budget.wallClockLimitSeconds}s
        </span>
      </Field>
    </dl>
  );
}
