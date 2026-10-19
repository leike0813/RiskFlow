/**
 * Agent 域共享界面件（design D-01/D-03/D-04/D-05）。
 *
 * 停靠栏、全屏工作台与任务详情共用这一组展示件，三者读同一份 `useAgentTask()` 任务事实。
 * 规则：
 * - 引用一律呈现 `entityId · versionId`，深链必须同时带实体标识与身份版本，不做「最新」查找；
 * - 预算按原策略上限与原台账用量分列呈现，不合并成任何「总预算」之类的虚构数字；
 * - 写动作只按服务端返回的四值可用性呈现，`business-unavailable` 置灰并给出真实 reasonCode，
 *   页面不据自身推断任何写动作已获授权；
 * - 事实缺席时呈现诚实空态并说明原因，不用原型内容填充。
 */
import type { ReactNode } from "react";

import { Card } from "../components/Card";
import { ConfirmButton, useProjectConfirmationScope } from "../components/ConfirmButton";
import { clientError, prepareCommand, sendPreparedCommand, unwrapQueryResult } from "../api/client";
import { asContractReference } from "../api/operations";
import type { CommandConfirmationScopeV1 } from "../shared/confirmation.js";
import type {
  ActionAvailabilityView,
  AgentBudgetView,
  AgentLaunchContextView,
  AgentTaskRefView,
  KindRef,
  VersionRef,
} from "../api/agentAuditOperations";

// ------------------------------------------------------------------ 领域枚举显示映射

export const AGENT_TASK_TYPE_LABELS: Readonly<Record<string, string>> = {
  "data-cleaning": "数据清洗与部分可用判断",
  "knowledge-authoring": "非结构化知识编制",
  "retrieval-review": "识别检索审阅与有界补搜",
  "response-recommendation": "处置建议组合排序",
  "calibration-suggestion": "偏差超限后的校准建议候选",
};

export const AGENT_TRIGGER_MODE_LABELS: Readonly<Record<string, string>> = {
  embedded: "内嵌必经",
  interactive: "交互发起",
};

export const AGENT_TASK_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: "待执行",
  running: "执行中",
  waiting: "等待人工确认",
  completed: "已完成",
  failed: "已失败",
  cancelled: "已取消",
};

export const AGENT_ACTION_STATUS_LABELS: Readonly<Record<string, string>> = {
  reserved: "已预留",
  started: "执行中",
  completed: "已完成",
  failed: "失败",
  uncertain: "结果不确定",
};

export const AGENT_CANDIDATE_DISPOSITION_LABELS: Readonly<Record<string, string>> = {
  pending: "待校验",
  accepted: "接受",
  rejected: "拒绝",
  completed: "已完成",
};

export const AGENT_REJECTION_CLASS_LABELS: Readonly<Record<string, string>> = {
  repairable: "可修复",
  terminal: "终局拒绝",
};

const AGENT_BRANCH_LABELS: Readonly<Record<string, string>> = {
  "agent-task.start-task": "启动交互任务",
  "agent-task.resume-task": "恢复任务",
  "agent-task.cancel-task": "取消任务",
  "agent-task.confirm-command": "确认或驳回当前提案",
};

/** 稳定渲染顺序：四个既有写分支，与服务端返回顺序无关。 */
export const AGENT_ACTION_BRANCHES = [
  "agent-task.start-task",
  "agent-task.resume-task",
  "agent-task.cancel-task",
  "agent-task.confirm-command",
] as const;

/** 枚举值缺映射时原样显示标识，不猜测语义。 */
const label = (labels: Readonly<Record<string, string>>, value: string): string =>
  labels[value] ?? value;

// ------------------------------------------------------------------ 基础展示件

export function TaskStatusChip({ status }: { readonly status: string }) {
  return (
    <span className={`ag-chip ag-chip--${agentStatusTone(status)}`}>
      {label(AGENT_TASK_STATUS_LABELS, status)}
    </span>
  );
}

function agentStatusTone(status: string): string {
  if (status === "completed") return "pass";
  if (status === "failed" || status === "cancelled") return "fail";
  if (status === "waiting") return "waiting";
  return "status";
}

/** 版本引用：等宽呈现 `entityId · versionId`，不可变快照语义。 */
export function VersionRefText({
  label: kind,
  reference,
}: {
  readonly label?: string;
  readonly reference: VersionRef;
}) {
  return (
    <p className="ag-version-ref">
      {kind !== undefined && <span className="ag-ref-kind">{kind}</span>}
      <span className="mono">
        {reference.entityId} · {reference.versionId}
      </span>
    </p>
  );
}

/** 类别引用：类别 + 精确版本，等同服务端 KindRef 原样呈现。 */
export function KindRefText({
  kind,
  reference,
}: {
  readonly kind: string;
  readonly reference: VersionRef;
}) {
  return <VersionRefText label={kind} reference={reference} />;
}

export function AgentField({
  label: name,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="ag-field">
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function AgentFields({ children }: { readonly children: ReactNode }) {
  return <dl className="ag-fields">{children}</dl>;
}

/** 分区卡：与页面其它卡片同一视觉层级。 */
export function AgentCard({
  title,
  extra,
  children,
}: {
  readonly title: string;
  readonly extra?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Card title={title} extra={extra}>
      {children}
    </Card>
  );
}

/** 诚实空态：只说明缺席事实与真实原因，不用原型内容填充。 */
export function AgentEmpty({ children }: { readonly children: ReactNode }) {
  return <p className="ag-muted ag-empty">{children}</p>;
}

// ------------------------------------------------------------------ 预算

/**
 * 预算对照：左列原策略上限、右列原台账用量，逐项成对呈现。
 * 输入/输出/上下文 Token 不合并；台账不重算、不折算成单一「总预算」。
 */
export function AgentBudgetCompare({ budget }: { readonly budget: AgentBudgetView }) {
  // 逐项对照原 C08 策略上限与原台账：输入/输出/上下文 Token 不合并，台账不重算。
  // 已用与已预留并排——预留不是已用，两者都来自原台账。
  const rows: readonly {
    readonly label: string;
    readonly limit: number | undefined;
    readonly used: number;
    readonly reserved: number;
  }[] = [
    {
      label: "模型调用",
      limit: budget.policy.maxModelInvocations,
      used: budget.ledger.used.modelInvocations,
      reserved: budget.ledger.reserved.modelInvocations,
    },
    {
      label: "工具调用",
      limit: budget.policy.maxToolInvocations,
      used: budget.ledger.used.toolInvocations,
      reserved: budget.ledger.reserved.toolInvocations,
    },
    {
      label: "输入 Token",
      limit: budget.policy.maxInputTokens,
      used: budget.ledger.used.inputTokens,
      reserved: budget.ledger.reserved.inputTokens,
    },
    {
      label: "输出 Token",
      limit: budget.policy.maxOutputTokens,
      used: budget.ledger.used.outputTokens,
      reserved: budget.ledger.reserved.outputTokens,
    },
    {
      label: "上下文 Token",
      limit: budget.policy.maxContextTokens,
      used: budget.ledger.used.contextTokens,
      reserved: budget.ledger.reserved.contextTokens,
    },
    {
      label: "输入字节",
      limit: budget.policy.maxInputBytes,
      used: budget.ledger.used.inputBytes,
      reserved: budget.ledger.reserved.inputBytes,
    },
    {
      label: "输出字节",
      limit: budget.policy.maxOutputBytes,
      used: budget.ledger.used.outputBytes,
      reserved: budget.ledger.reserved.outputBytes,
    },
    {
      label: "候选数",
      limit: budget.policy.maxCandidates,
      used: budget.ledger.used.candidates,
      reserved: budget.ledger.reserved.candidates,
    },
    {
      label: "对象数",
      limit: budget.policy.maxObjects,
      used: budget.ledger.used.objects,
      reserved: budget.ledger.reserved.objects,
    },
    {
      label: "补充检索",
      limit: budget.policy.maxSupplementarySearches,
      used: budget.ledger.used.supplementarySearches,
      reserved: budget.ledger.reserved.supplementarySearches,
    },
    {
      label: "修正次数",
      limit: budget.policy.maxCorrections,
      used: budget.ledger.used.corrections,
      reserved: budget.ledger.reserved.corrections,
    },
    {
      label: "瞬时重试",
      limit: budget.policy.maxTransientRetries,
      used: budget.ledger.used.transientRetries,
      reserved: budget.ledger.reserved.transientRetries,
    },
    {
      label: "墙钟时间（毫秒）",
      limit: budget.policy.maxWallClockMs,
      used: budget.ledger.activeWallClockMs,
      reserved: 0,
    },
  ];
  return (
    <>
      <div className="ag-table-wrap">
        <table className="ag-table">
          <thead>
            <tr>
              <th>资源项</th>
              <th>策略上限</th>
              <th>台账已用</th>
              <th>台账已预留</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="mono">{row.limit ?? "不限"}</td>
                <td className="mono">{row.used}</td>
                <td className="mono">{row.reserved}</td>
              </tr>
            ))}
            <tr>
              <td>当前并发</td>
              <td className="mono">{budget.policy.maxConcurrentActions}</td>
              <td className="mono">{budget.ledger.currentConcurrency}</td>
              <td className="mono">—</td>
            </tr>
            <tr>
              <td>台账版本</td>
              <td className="mono">—</td>
              <td className="mono">{budget.ledger.ledgerVersion}</td>
              <td className="mono">{budget.ledger.changedAt}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="ag-note">
        预算是系统强制执行的版本化硬上限，按原策略与原台账分别呈现；预算耗尽或任务失败不静默跳过、
        不扩容、不换模型，界面也不提供任何放宽上限的入口。
      </p>
    </>
  );
}

// ------------------------------------------------------------------ 动作可用性

/** 动作可用性沿既有四值语义；只读面上只可能出现业务不可用，授权判定不在此推断。 */
const AGENT_ACTION_AVAILABILITIES = [
  "allowed",
  "denied",
  "business-unavailable",
  "hidden",
] as const;
type AgentActionAvailability = (typeof AGENT_ACTION_AVAILABILITIES)[number];

const agentActionAvailability = (
  actions: readonly ActionAvailabilityView[],
  branch: string,
): AgentActionAvailability | string | null => {
  const found = actions.find((action) => action.branch === branch);
  if (found === undefined) return null;
  return (AGENT_ACTION_AVAILABILITIES as readonly string[]).includes(found.availability)
    ? (found.availability as AgentActionAvailability)
    : found.availability;
};

/**
 * 写动作可用性：逐项呈现服务端返回的真实状态。
 * `business-unavailable` 置灰并显示真实 reasonCode；`hidden` 不呈现；
 * 只读授权不等于写权，页面不据自身推断任何动作已获授权。
 */
export function AgentActionAvailabilityList({
  actions,
}: {
  readonly actions: readonly ActionAvailabilityView[];
}) {
  return (
    <ul className="ag-availability">
      {AGENT_ACTION_BRANCHES.map((branch) => {
        const availability = agentActionAvailability(actions, branch);
        const reasonCode = actions.find((action) => action.branch === branch)?.reasonCode;
        return (
          <li key={branch} className="ag-availability-row" data-action-branch={branch}>
            <span className="ag-availability-name">{AGENT_BRANCH_LABELS[branch] ?? branch}</span>
            <AvailabilityBadge availability={availability} />
            {reasonCode !== undefined && (
              <span className="mono ag-availability-reason">{reasonCode}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function AvailabilityBadge({
  availability,
}: {
  readonly availability: AgentActionAvailability | string | null;
}) {
  if (availability === null) {
    return <span className="ag-chip ag-chip--status">服务端未报告业务不可用</span>;
  }
  if (availability === "hidden") return null;
  if (availability === "allowed") return <span className="ag-chip ag-chip--pass">业务可执行</span>;
  if (availability === "denied") return <span className="ag-chip ag-chip--fail">无权限</span>;
  if (availability === "business-unavailable")
    return <span className="ag-chip ag-chip--fail">业务不可用</span>;
  return <span className="ag-chip ag-chip--status">{availability}</span>;
}

// ------------------------------------------------------------------ 深链

/**
 * 任务详情深链：路径带实体标识，查询串带身份版本。
 * 版本取 `reference.versionId`（任务身份版本），不冒充可变 state 版本。
 */
export const agentTaskDetailPath = (taskRef: AgentTaskRefView): string =>
  `/agent/tasks/${encodeURIComponent(taskRef.reference.entityId)}?taskVersion=${encodeURIComponent(
    taskRef.reference.versionId,
  )}`;

// ------------------------------------------------------------------ 启动上下文

/**
 * 启动上下文：只有服务端确认定义支持交互启动时才给出入口。
 * 载荷逐项按服务端原值呈现，不在页面补模型、工具、提示模板或预算选择。
 */
export function AgentLaunchPanel({
  projectId,
  taskRef,
  launchContext,
  onStarted,
}: {
  readonly projectId: string;
  readonly taskRef: AgentTaskRefView;
  readonly launchContext?: AgentLaunchContextView;
  readonly onStarted: () => void;
}) {
  if (launchContext === undefined) return <AgentEmpty>正在读取启动上下文…</AgentEmpty>;
  if (!launchContext.supported) {
    return (
      <div className="ag-launch">
        <AgentEmpty>
          当前任务定义的启动上下文不可用（{launchContext.reasonCode ?? "未返回原因码"}
          ），不提供交互启动入口。
        </AgentEmpty>
      </div>
    );
  }
  const payload = launchContext.payload ?? {};
  const scope = useProjectConfirmationScope();
  return (
    <div className="ag-launch">
      <ConfirmButton
        label="启动交互任务"
        availability={{ kind: "allowed" }}
        requiredPermission={{ kind: "business", capability: "agent-task.start" }}
        scope={scope}
        intentRevision={`${projectId}|${taskRef.reference.entityId}|${taskRef.reference.versionId}`}
        createPlan={() => {
          // CH-2 D-10：启动载荷在打开确认这一刻定型，确认后由原启动端口复验定义与预算。
          if (scope === undefined || scope.kind !== "project")
            throw clientError("CONTRACT_INVALID");
          const request = prepareCommand({
            projectId: scope.projectId,
            branch: "agent-task.start-task",
            payload: payload as Record<string, unknown>,
          });
          const plan: CommandConfirmationScopeV1 = scope;
          return {
            confirmationId: `confirm-${request.envelope.commandId}`,
            operationId: "agent-task.start-task",
            scope: plan,
            targets: [asContractReference(taskRef)],
            inputVersions: [
              {
                entityId: taskRef.reference.entityId,
                versionId: taskRef.reference.versionId,
              },
            ],
            expectedFacts: [`agent-task:${taskRef.reference.entityId}`],
            externalEffects: ["按冻结定义启动一次交互 Agent 任务"],
            impact: "standard",
            commandId: request.envelope.commandId,
            idempotencyKey: request.envelope.idempotencyKey,
            request,
          };
        }}
        submit={async (plan) => {
          unwrapQueryResult(await sendPreparedCommand(plan.request));
          return { kind: "command-result", result: { kind: "agent-task-started" } };
        }}
        onSucceeded={onStarted}
      />
      <p className="ag-note">
        启动载荷由服务端按已登记定义与来源任务的冻结输入生成，确认后仍由原启动端口复验定义、上下文与预算。
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ 提案与结果

export function AgentProposalPanel({
  proposal,
  targetRefLabel = "目标",
}: {
  readonly proposal?:
    | {
        readonly commandProposalRef: KindRef;
        readonly targetRef: KindRef;
        readonly expectedTargetVersion: VersionRef;
        readonly expectedEffect: string;
        readonly proposedAt: string;
      }
    | undefined;
  readonly targetRefLabel?: string;
}) {
  if (proposal === undefined) {
    return <AgentEmpty>当前任务没有待确认的交互提案。</AgentEmpty>;
  }
  return (
    <AgentFields>
      <AgentField label="提案标识">
        <span className="mono">
          {proposal.commandProposalRef.reference.entityId} ·{" "}
          {proposal.commandProposalRef.reference.versionId}
        </span>
      </AgentField>
      <AgentField label={targetRefLabel}>
        <span className="mono">
          {proposal.targetRef.reference.entityId} · {proposal.targetRef.reference.versionId}
        </span>
      </AgentField>
      <AgentField label="目标预期版本">
        <span className="mono">
          {proposal.expectedTargetVersion.entityId} · {proposal.expectedTargetVersion.versionId}
        </span>
      </AgentField>
      <AgentField label="预期效果">
        <span className="mono">{proposal.expectedEffect}</span>
      </AgentField>
      <AgentField label="提出时间">
        <span className="mono">{proposal.proposedAt}</span>
      </AgentField>
    </AgentFields>
  );
}
