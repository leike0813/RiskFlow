/**
 * P-AG-03 Agent 任务详情（design D-01/D-03/D-04/D-05）。
 *
 * 分区沿 v2 任务详情：运行头部 + 任务信封全貌 + 工具行动 + Agent 增量与逐项确定性校验 +
 * 资源消耗与预算对照 + 失败与正式结果引用。事实全部来自共享的 `useAgentTask()`：
 * 列表/详情/启动上下文由 Provider 单在途刷新，行动、候选与校验在用户打开本视图后按游标分页读取，
 * 不再建立第二套轮询或第二份缓存。
 *
 * 深链按 URL 的精确身份（实体标识 + 身份版本）定位，不做「最新」查找；
 * 身份在当前任务列表页内不存在时呈现诚实缺席态，不用其它任务的事实填充。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import AppShell from "../components/AppShell";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { Icon } from "../components/icons";
import { useEngineering, usePageQuery, useProjectPath } from "../api/engineering";
import {
  readAgentCandidateValidation,
  readAgentTaskActions,
  readAgentTaskCandidates,
  type AgentLaunchContextView,
  type AgentTaskDetailView,
  type AgentTaskRefView,
  type AgentTaskSummaryView,
} from "../api/agentAuditOperations";
import { useAgentTask } from "../agent/AgentTaskProvider";
import {
  AGENT_ACTION_STATUS_LABELS,
  AGENT_CANDIDATE_DISPOSITION_LABELS,
  AGENT_REJECTION_CLASS_LABELS,
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
} from "../agent/agentShared";
// Agent 域共享分区样式与停靠栏同源，全应用只保留一份。
import "../agent/AgentDock.css";
import "./AgentWorkbenchPage.css";

const label = (labels: Readonly<Record<string, string>>, value: string): string =>
  labels[value] ?? value;

export default function AgentTaskDetailPage() {
  const params = useParams<{ taskId: string }>();
  const [searchParams] = useSearchParams();
  const { selector } = useEngineering();
  const projectPath = useProjectPath();
  const taskId = params.taskId ?? "";
  const taskVersion = searchParams.get("taskVersion") ?? "";
  const { list, taskRef, detail, launchContext, openTask, refreshNow, error, loading } =
    useAgentTask();

  // 精确身份：实体标识与身份版本同时相等才算命中，命中后才把该任务设为共享选择。
  const exact: AgentTaskSummaryView | undefined = useMemo(
    () =>
      list?.items.find(
        (item) =>
          item.agentTaskRef.reference.entityId === taskId &&
          item.agentTaskRef.reference.versionId === taskVersion,
      ),
    [list, taskId, taskVersion],
  );

  useEffect(() => {
    if (exact === undefined) return;
    if (
      taskRef !== undefined &&
      taskRef.reference.entityId === exact.agentTaskRef.reference.entityId &&
      taskRef.reference.versionId === exact.agentTaskRef.reference.versionId
    ) {
      return;
    }
    openTask(exact.agentTaskRef);
  }, [exact, openTask, taskRef]);

  const selected: AgentTaskRefView | undefined =
    exact !== undefined &&
    taskRef !== undefined &&
    taskRef.reference.entityId === exact.agentTaskRef.reference.entityId &&
    taskRef.reference.versionId === exact.agentTaskRef.reference.versionId
      ? taskRef
      : undefined;

  // 详情必须属于深链指向的精确身份：切换选择后 Provider 重新读取期间，迟到或上一任务的
  // 详情不得被当作当前任务的事实呈现。
  const currentDetail: AgentTaskDetailView | undefined =
    detail !== undefined &&
    detail.summary.agentTaskRef.reference.entityId === taskId &&
    detail.summary.agentTaskRef.reference.versionId === taskVersion
      ? detail
      : undefined;

  // 分区读取的作废键：任务身份或可变 state 版本变化后，行动/候选/校验重新按当前任务读取。
  const pagingKey =
    currentDetail === undefined
      ? ""
      : `${currentDetail.summary.agentTaskRef.reference.entityId}|${currentDetail.summary.agentTaskRef.reference.versionId}|${currentDetail.summary.taskVersion}`;

  const projectId = selector.projectId;

  return (
    <AppShell
      activeNav={null}
      agentContext={
        projectId === null
          ? []
          : [projectId, ...(selected === undefined ? [] : [selected.reference.entityId])]
      }
    >
      <div className="page agd-page">
        <header className="page-header">
          <div>
            <h1 className="page-title">Agent 任务详情</h1>
            <p className="page-subtitle mono">{`${taskId} · ${taskVersion}`}</p>
          </div>
          <div className="agd-header-actions">
            <button type="button" className="agd-refresh" onClick={refreshNow} disabled={loading}>
              {loading ? "刷新中…" : "立即刷新"}
            </button>
            <Link className="agd-back" to={projectPath("/agent")}>
              返回工作台
              <Icon name="arrowRight" size={14} />
            </Link>
          </div>
        </header>

        {taskId === "" || taskVersion === "" ? (
          <AgentCard title="任务引用">
            <AgentEmpty>深链缺少任务标识或身份版本，无法定位精确任务。</AgentEmpty>
          </AgentCard>
        ) : exact === undefined ? (
          <AgentCard title="任务引用">
            {list === undefined ? (
              <AgentEmpty>正在读取当前工程的 Agent 任务列表…</AgentEmpty>
            ) : (
              <AgentEmpty>
                当前任务列表页内没有该精确引用（{taskId} · {taskVersion}）。本列表按游标分页，
                该任务不在当前已读取的一页中，请返回工作台重新选择。
              </AgentEmpty>
            )}
          </AgentCard>
        ) : currentDetail === undefined ? (
          <AgentCard title="任务详情">
            <AgentEmpty>
              {error !== undefined ? `读取任务详情失败（${error}）。` : "正在读取任务详情…"}
            </AgentEmpty>
          </AgentCard>
        ) : (
          <TaskContent
            detail={currentDetail}
            projectId={projectId ?? ""}
            launchContext={selected === undefined ? undefined : launchContext}
            pagingKey={pagingKey}
            onLaunched={refreshNow}
          />
        )}
      </div>
    </AppShell>
  );
}

function TaskContent({
  detail,
  projectId,
  launchContext,
  pagingKey,
  onLaunched,
}: {
  readonly detail: AgentTaskDetailView;
  readonly projectId: string;
  readonly launchContext?: AgentLaunchContextView | undefined;
  readonly pagingKey: string;
  readonly onLaunched: () => void;
}) {
  const { summary, budget, actions, currentProposal, resultRef, safeError } = detail;
  const ref = summary.agentTaskRef;

  return (
    <div className="agd-sections">
      <AgentCard title="运行头部">
        <AgentFields>
          <AgentField label="任务标识">
            <span className="mono">
              {ref.reference.entityId} · {ref.reference.versionId}
            </span>
          </AgentField>
          <AgentField label="状态">
            <TaskStatusChip status={summary.status} />
          </AgentField>
          <AgentField label="任务类型">{label(AGENT_TASK_TYPE_LABELS, ref.taskType)}</AgentField>
          <AgentField label="触发方式">
            {label(AGENT_TRIGGER_MODE_LABELS, ref.triggerMode)}
          </AgentField>
          <AgentField label="发起者">
            <span className="mono">{summary.initiatorActorId}</span>
          </AgentField>
          <AgentField label="创建时间">
            <span className="mono">{summary.createdAt}</span>
          </AgentField>
          <AgentField label="更新时间">
            <span className="mono">{summary.updatedAt}</span>
          </AgentField>
          <AgentField label="可变状态版本">
            <span className="mono">{summary.taskVersion}</span>
          </AgentField>
        </AgentFields>
      </AgentCard>

      <AgentCard title="任务信封">
        <AgentFields>
          <AgentField label="上游工作流运行">
            <span className="mono">
              {summary.parentRunRef.kind} {summary.parentRunRef.reference.entityId} ·{" "}
              {summary.parentRunRef.reference.versionId}
            </span>
          </AgentField>
          <AgentField label="冻结输入">
            <span className="mono">
              {summary.frozenInputRef.kind} {summary.frozenInputRef.reference.entityId} ·{" "}
              {summary.frozenInputRef.reference.versionId}
            </span>
          </AgentField>
        </AgentFields>
        <div className="agd-refs">
          <VersionRefText label="模型部署" reference={ref.modelDeploymentRef} />
          <VersionRefText label="提示模板" reference={ref.promptTemplateRef} />
          <VersionRefText label="工具策略" reference={ref.toolPolicyRef} />
          <VersionRefText label="预算策略" reference={ref.budgetPolicyRef} />
          <VersionRefText label="增量类型 Schema" reference={ref.incrementSchemaRef} />
          <VersionRefText label="校验策略" reference={ref.validationPolicyRef} />
        </div>
        <p className="ag-note">
          任务创建时上述要素全部固定；Agent 只能调用工具策略白名单内的版本化领域工具，
          增量必须是类型化领域操作。
        </p>
      </AgentCard>

      <AgentCard title="工具行动">
        <ActionSection taskRef={ref} pagingKey={pagingKey} />
      </AgentCard>

      <AgentCard title="Agent 增量与确定性校验">
        <CandidateSection taskRef={ref} pagingKey={pagingKey} />
      </AgentCard>

      <AgentCard title="资源消耗" extra={<span className="ag-muted">原策略上限 / 原台账用量</span>}>
        <AgentBudgetCompare budget={budget} />
        <div className="agd-refs">
          <VersionRefText label="预算策略" reference={ref.budgetPolicyRef} />
        </div>
      </AgentCard>

      <AgentCard title="失败与结果引用">
        {safeError !== undefined ? (
          <AgentFields>
            <AgentField label="错误码">
              <span className="mono">{safeError.code}</span>
            </AgentField>
            <AgentField label="错误类别">
              <span className="mono">{safeError.category}</span>
            </AgentField>
            <AgentField label="是否可重试">
              {safeError.retryable ? "可重试" : "不可重试"}
            </AgentField>
            <AgentField label="失败阶段">
              <span className="mono">{safeError.stage}</span>
            </AgentField>
            <AgentField label="发生时间">
              <span className="mono">{safeError.occurredAt}</span>
            </AgentField>
          </AgentFields>
        ) : resultRef !== undefined ? (
          <AgentFields>
            <AgentField label="正式结果引用">
              <span className="mono">
                {resultRef.kind} {resultRef.reference.entityId} · {resultRef.reference.versionId}
              </span>
            </AgentField>
          </AgentFields>
        ) : (
          <AgentEmpty>当前任务尚未产生失败或正式结果引用。</AgentEmpty>
        )}
        <p className="ag-note">失败正文与模型输出留在受保护工件里，页面只呈现结构化安全错误。</p>
      </AgentCard>

      <AgentCard title="当前提案">
        <AgentProposalPanel proposal={currentProposal} />
      </AgentCard>

      <AgentCard title="任务动作可用性">
        <AgentActionAvailabilityList actions={actions} />
        <div className="agd-launch">
          {launchContext === undefined ? (
            <AgentEmpty>正在读取启动上下文…</AgentEmpty>
          ) : (
            <AgentLaunchPanel
              projectId={projectId}
              taskRef={ref}
              launchContext={launchContext}
              onStarted={onLaunched}
            />
          )}
        </div>
        <p className="ag-note">
          只读授权不等于写权：恢复、取消与提案确认的可用性由服务端按任务当前状态判定，
          界面按返回的真实原因呈现，不提供绕过确认或补回预算的入口。
        </p>
      </AgentCard>
    </div>
  );
}

const actionColumns: DataTableColumn[] = [
  { key: "sequence", title: "序号", width: 64, align: "right" },
  {
    key: "actionId",
    title: "行动标识",
    width: 190,
    render: (row) => <span className="mono">{row.actionId as string}</span>,
  },
  { key: "actionType", title: "行动类型", width: 150 },
  {
    key: "status",
    title: "状态",
    width: 110,
    render: (row) => <span>{label(AGENT_ACTION_STATUS_LABELS, row.status as string)}</span>,
  },
  {
    key: "intentArtifactRef",
    title: "意图工件",
    render: (row) => {
      const intent = (
        row.intentArtifactRef as { reference: { entityId: string; versionId: string } }
      ).reference;
      return (
        <span className="mono">
          {intent.entityId} · {intent.versionId}
        </span>
      );
    },
  },
  {
    key: "errorCode",
    title: "错误码",
    width: 130,
    render: (row) => <span className="mono">{(row.errorCode as string | undefined) ?? "—"}</span>,
  },
  {
    key: "recordedAt",
    title: "记录时间",
    width: 190,
    render: (row) => <span className="mono">{row.recordedAt as string}</span>,
  },
];

function ActionSection({
  taskRef,
  pagingKey,
}: {
  readonly taskRef: AgentTaskRefView;
  readonly pagingKey: string;
}) {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [pageIndex, setPageIndex] = useState(0);
  const actions = usePageQuery(
    (projectId, signal) =>
      readAgentTaskActions(
        projectId,
        taskRef,
        { ...(cursor === undefined ? {} : { cursor }) },
        signal,
      ),
    [pagingKey, cursor],
  );
  if (actions.state.kind !== "ready") {
    return (
      <AgentEmpty>
        {actions.state.kind === "error"
          ? `读取工具行动失败（${actions.state.error.code}）。`
          : actions.state.kind === "forbidden"
            ? "当前角色不具备读取该任务工具行动的权限。"
            : "正在读取工具行动…"}
      </AgentEmpty>
    );
  }
  const page = actions.state.value;
  return (
    <>
      {page.items.length === 0 ? (
        <AgentEmpty>该任务当前没有已登记的工具行动。</AgentEmpty>
      ) : (
        <DataTable columns={actionColumns} rows={page.items.map((item) => ({ ...item }))} />
      )}
      <div className="ag-paging">
        <button
          type="button"
          className="ag-page-btn"
          onClick={() => {
            setPageIndex((index) => Math.max(0, index - 1));
            setCursor(undefined);
          }}
          disabled={pageIndex === 0}
        >
          上一页
        </button>
        <span className="ag-muted">第 {pageIndex + 1} 页</span>
        <button
          type="button"
          className="ag-page-btn"
          onClick={() => {
            setPageIndex((index) => index + 1);
            setCursor(page.nextCursor);
          }}
          disabled={page.nextCursor === undefined}
        >
          下一页
        </button>
      </div>
    </>
  );
}

function CandidateSection({
  taskRef,
  pagingKey,
}: {
  readonly taskRef: AgentTaskRefView;
  readonly pagingKey: string;
}) {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [pageIndex, setPageIndex] = useState(0);
  const [candidateVersion, setCandidateVersion] = useState<number | undefined>(undefined);
  const candidates = usePageQuery(
    (projectId, signal) =>
      readAgentTaskCandidates(
        projectId,
        taskRef,
        { ...(cursor === undefined ? {} : { cursor }) },
        signal,
      ),
    [pagingKey, cursor],
  );

  if (candidates.state.kind !== "ready") {
    return (
      <AgentEmpty>
        {candidates.state.kind === "error"
          ? `读取候选失败（${candidates.state.error.code}）。`
          : candidates.state.kind === "forbidden"
            ? "当前角色不具备读取该任务候选的权限。"
            : "正在读取候选…"}
      </AgentEmpty>
    );
  }
  const page = candidates.state.value;
  return (
    <>
      {page.items.length === 0 ? (
        <AgentEmpty>该任务尚未产出增量候选。</AgentEmpty>
      ) : (
        <DataTable
          columns={[
            { key: "candidateVersion", title: "候选版本", width: 90, align: "right" },
            { key: "parentCandidateVersion", title: "父候选版本", width: 100, align: "right" },
            {
              key: "candidateArtifactRef",
              title: "候选工件",
              render: (row) => <ArtifactRefText value={row.candidateArtifactRef} />,
            },
            {
              key: "incrementArtifactRef",
              title: "增量工件",
              render: (row) => <ArtifactRefText value={row.incrementArtifactRef} />,
            },
            {
              key: "disposition",
              title: "处置",
              width: 100,
              render: (row) => (
                <span>{label(AGENT_CANDIDATE_DISPOSITION_LABELS, row.disposition as string)}</span>
              ),
            },
            {
              key: "createdAt",
              title: "生成时间",
              width: 190,
              render: (row) => <span className="mono">{row.createdAt as string}</span>,
            },
            {
              key: "select",
              title: "逐项校验",
              width: 110,
              render: (row) => (
                <button
                  type="button"
                  className="ag-page-btn"
                  onClick={() => setCandidateVersion(row.candidateVersion as number)}
                >
                  查看校验
                </button>
              ),
            },
          ]}
          rows={page.items.map((item) => ({ ...item }))}
        />
      )}
      <div className="ag-paging">
        <button
          type="button"
          className="ag-page-btn"
          onClick={() => {
            setPageIndex((index) => Math.max(0, index - 1));
            setCursor(undefined);
          }}
          disabled={pageIndex === 0}
        >
          上一页
        </button>
        <span className="ag-muted">第 {pageIndex + 1} 页</span>
        <button
          type="button"
          className="ag-page-btn"
          onClick={() => {
            setPageIndex((index) => index + 1);
            setCursor(page.nextCursor);
          }}
          disabled={page.nextCursor === undefined}
        >
          下一页
        </button>
      </div>
      {candidateVersion !== undefined && (
        <ValidationSection
          taskRef={taskRef}
          pagingKey={pagingKey}
          candidateVersion={candidateVersion}
          onClose={() => setCandidateVersion(undefined)}
        />
      )}
    </>
  );
}

function ArtifactRefText({ value }: { readonly value: unknown }) {
  const ref = value as { reference: { entityId: string; versionId: string } };
  return (
    <span className="mono">
      {ref.reference.entityId} · {ref.reference.versionId}
    </span>
  );
}

function ValidationSection({
  taskRef,
  pagingKey,
  candidateVersion,
  onClose,
}: {
  readonly taskRef: AgentTaskRefView;
  readonly pagingKey: string;
  readonly candidateVersion: number;
  readonly onClose: () => void;
}) {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [pageIndex, setPageIndex] = useState(0);
  const checks = usePageQuery(
    (projectId, signal) =>
      readAgentCandidateValidation(
        projectId,
        taskRef,
        candidateVersion,
        { ...(cursor === undefined ? {} : { cursor }) },
        signal,
      ),
    [pagingKey, candidateVersion, cursor],
  );
  return (
    <section className="ag-subsection" aria-label={`候选 ${candidateVersion} 的逐项校验`}>
      <header className="ag-subsection-head">
        <h4 className="ag-subsection-title">候选 {candidateVersion} 的逐项确定性校验</h4>
        <button type="button" className="ag-page-btn" onClick={onClose}>
          收起
        </button>
      </header>
      {checks.state.kind !== "ready" ? (
        <AgentEmpty>
          {checks.state.kind === "error"
            ? `读取逐项校验失败（${checks.state.error.code}）。`
            : checks.state.kind === "forbidden"
              ? "当前角色不具备读取该校验记录的权限。"
              : "正在读取逐项校验…"}
        </AgentEmpty>
      ) : checks.state.value.items.length === 0 ? (
        <AgentEmpty>该候选没有登记校验项。</AgentEmpty>
      ) : (
        <DataTable
          columns={[
            {
              key: "checkId",
              title: "校验项",
              width: 200,
              render: (row) => <span className="mono">{row.checkId as string}</span>,
            },
            {
              key: "disposition",
              title: "处置",
              width: 100,
              render: (row) => (
                <span
                  className={`ag-chip ag-chip--${row.disposition === "accepted" ? "pass" : "fail"}`}
                >
                  {row.disposition === "accepted" ? "接受" : "拒绝"}
                </span>
              ),
            },
            {
              key: "rejectionClass",
              title: "拒绝类别",
              width: 110,
              render: (row) => (
                <span>
                  {label(AGENT_REJECTION_CLASS_LABELS, (row.rejectionClass as string) ?? "")}
                </span>
              ),
            },
            {
              key: "reasonCode",
              title: "原因码",
              render: (row) => <span className="mono">{row.reasonCode as string}</span>,
            },
          ]}
          rows={checks.state.value.items.map((item) => ({ ...item }))}
        />
      )}
      {checks.state.kind === "ready" && (
        <div className="ag-paging">
          <button
            type="button"
            className="ag-page-btn"
            onClick={() => {
              setPageIndex((index) => Math.max(0, index - 1));
              setCursor(undefined);
            }}
            disabled={pageIndex === 0}
          >
            上一页
          </button>
          <span className="ag-muted">第 {pageIndex + 1} 页</span>
          <button
            type="button"
            className="ag-page-btn"
            onClick={() => {
              setPageIndex((index) => index + 1);
              setCursor(checks.state.kind === "ready" ? checks.state.value.nextCursor : undefined);
            }}
            disabled={checks.state.kind !== "ready" || checks.state.value.nextCursor === undefined}
          >
            下一页
          </button>
        </div>
      )}
    </section>
  );
}
