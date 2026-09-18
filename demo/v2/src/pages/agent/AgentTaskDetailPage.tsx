// P-AG-03 Agent 任务详情（C 运行骨架；branch agent-task.read-failure-evidence；
// 能力位 agent-task.read）。运行头部（任务标识 / 状态 / 任务类型 / 触发方式 / 发起者 /
// 启动时间 / 幂等键）+ 任务信封全貌 + 工具行动列表 + Agent 增量与确定性校验逐项决定 +
// 资源消耗与预算对比 + 失败与正式结果引用。任务记录不保存、不展示模型内部思维链。
// 七态：input.pageState 经 PageFrame 承载；路由标识未命中 fixture 时落入自然 empty 态。

import type { RouteRenderInput } from '../../app/routes';
import {
  AGENT_LINKS,
  AGENT_TASK_TYPE_LABELS,
  AGENT_TRIGGER_MODE_LABELS,
  agentTaskById,
  type AgentTaskView,
} from '../../content/agent';
import { PageFrame } from '../../shared/PageFrame';
import {
  BudgetFields,
  Field,
  FieldCard,
  GatedAction,
  TaskStatusChip,
  VersionRefLine,
} from './agent-shared';
import './agent.css';

const INCREMENT_DECISION_LABELS = {
  accepted: '接受',
  rejected: '拒绝',
} as const;

const TOOL_OUTCOME_LABELS = {
  succeeded: '成功',
  blocked: '已拦截',
} as const;

function RunHeader({ task }: { readonly task: AgentTaskView }) {
  return (
    <FieldCard title="运行头部">
      <dl className="ag-fields">
        <Field label="任务标识">
          <span className="mono">
            {task.ref.reference.entityId} · {task.ref.reference.versionId}
          </span>
        </Field>
        <Field label="状态">
          <TaskStatusChip status={task.status} />
        </Field>
        <Field label="任务类型">{AGENT_TASK_TYPE_LABELS[task.ref.taskType]}</Field>
        <Field label="触发方式">{AGENT_TRIGGER_MODE_LABELS[task.ref.triggerMode]}</Field>
        <Field label="发起者">
          {task.initiatorLabel}（<span className="mono">{task.initiatorActorId}</span>）
        </Field>
        <Field label="启动时间">
          <span className="mono">{task.startedAt}</span>
        </Field>
        <Field label="幂等键">
          <span className="mono">{task.idempotencyKey}</span>
        </Field>
      </dl>
      <p className="ag-note">{task.summary}</p>
    </FieldCard>
  );
}

function EnvelopeCard({ task }: { readonly task: AgentTaskView }) {
  return (
    <FieldCard title="任务信封">
      <dl className="ag-fields">
        <Field label="发起者">
          {task.initiatorLabel}（<span className="mono">{task.initiatorActorId}</span>）
        </Field>
        <Field label="工程">
          {task.projectLabel}（<span className="mono">{task.projectId}</span>）
        </Field>
        <Field label="输入版本">
          {task.frozenInputKindLabel}{' '}
          <span className="mono">
            {task.frozenInputRef.entityId} · {task.frozenInputRef.versionId}
          </span>
        </Field>
        <Field label="上游工作流运行">
          {task.parentRunLabel}{' '}
          <span className="mono">
            {task.parentRunRef.entityId} · {task.parentRunRef.versionId}
          </span>
        </Field>
      </dl>
      <div style={{ marginTop: 'var(--space-3)' }}>
        <VersionRefLine kind="模型部署" reference={task.ref.modelDeploymentRef} />
        <VersionRefLine kind="提示模板" reference={task.ref.promptTemplateRef} />
        <VersionRefLine kind="工具策略" reference={task.ref.toolPolicyRef} />
        <VersionRefLine kind="预算策略" reference={task.ref.budgetPolicyRef} />
        <VersionRefLine kind="增量类型 Schema" reference={task.ref.incrementSchemaRef} />
        <VersionRefLine kind="校验策略" reference={task.ref.validationPolicyRef} />
      </div>
      <p className="ag-note">
        任务创建时上述要素全部固定；Agent 只能调用工具策略白名单内的版本化领域工具，
        增量必须是类型化领域操作。
      </p>
    </FieldCard>
  );
}

function ToolActionsCard({ task }: { readonly task: AgentTaskView }) {
  return (
    <FieldCard title="工具行动">
      <div className="ag-table-wrap">
        <table className="ag-table">
          <thead>
            <tr>
              <th>行动标识</th>
              <th>工具</th>
              <th>说明</th>
              <th>结果</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {task.toolActions.map((action) => (
              <tr key={action.actionId}>
                <td className="mono">{action.actionId}</td>
                <td>
                  {action.toolLabel}
                  <br />
                  <span className="mono ag-muted">{action.toolName}</span>
                </td>
                <td>{action.summary}</td>
                <td>
                  <span
                    className={`ag-chip ${
                      action.outcome === 'succeeded' ? 'ag-chip--pass' : 'ag-chip--fail'
                    }`}
                  >
                    {TOOL_OUTCOME_LABELS[action.outcome]}
                  </span>
                </td>
                <td>{action.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </FieldCard>
  );
}

function IncrementsCard({ task }: { readonly task: AgentTaskView }) {
  return (
    <FieldCard title="Agent 增量与确定性校验">
      {task.increments.length === 0 ? (
        <p className="ag-muted" style={{ margin: 0 }}>
          本任务未产出增量
        </p>
      ) : (
        <div className="ag-table-wrap">
          <table className="ag-table">
            <thead>
              <tr>
                <th>增量项</th>
                <th>操作类型</th>
                <th>内容摘要</th>
                <th>校验决定</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              {task.increments.map((increment) => (
                <tr key={increment.incrementItemId}>
                  <td className="mono">{increment.incrementItemId}</td>
                  <td className="mono">{increment.operationType}</td>
                  <td>{increment.summary}</td>
                  <td>
                    <span
                      className={`ag-chip ${
                        increment.decision === 'accepted' ? 'ag-chip--pass' : 'ag-chip--fail'
                      }`}
                    >
                      {INCREMENT_DECISION_LABELS[increment.decision]}
                    </span>
                  </td>
                  <td>{increment.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="ag-note">
        确定性校验逐项记录接受、拒绝及原因；Agent 无权修改已发布定义、评分、矩阵、阈值或人工决定。
        本页不展示模型内部思维链，仅呈现可重建输入、工具行动、增量与校验决定。
      </p>
    </FieldCard>
  );
}

function OutcomeCard({
  task,
  input,
}: {
  readonly task: AgentTaskView;
  readonly input: RouteRenderInput;
}) {
  if (task.status === 'failed' && task.failure !== null) {
    const failure = task.failure;
    return (
      <FieldCard title="失败与结果引用">
        <dl className="ag-fields">
          <Field label="错误码">
            <span className="mono">{failure.errorCode}</span>
          </Field>
          <Field label="可重试">{failure.retryable ? '可重试' : '不可重试'}</Field>
          <Field label="失败阶段">
            <span className="mono">{failure.stageCode}</span>
          </Field>
          <Field label="发生时间">
            <span className="mono">{failure.occurredAt}</span>
          </Field>
          <Field label="失败引用">
            <span className="mono">
              {failure.errorRef.entityId} · {failure.errorRef.versionId}
            </span>
          </Field>
          <Field label="诊断工件">
            <span className="mono">
              {failure.diagnosticRef.entityId} · {failure.diagnosticRef.versionId}
            </span>
          </Field>
        </dl>
        <p className="ag-note">{failure.summary}</p>
        {failure.retryable ? (
          <div className="ag-btn-row">
            <GatedAction
              label="恢复任务"
              branch="agent-task.resume-task"
              capabilities={input.capabilities}
            />
          </div>
        ) : null}
      </FieldCard>
    );
  }
  if (task.status === 'waiting') {
    return (
      <FieldCard title="失败与结果引用">
        <p style={{ margin: 0 }}>{task.waitingNote}</p>
        <div className="ag-btn-row">
          <GatedAction
            label="前往确认"
            branch="agent-task.confirm-command"
            capabilities={input.capabilities}
            href={AGENT_LINKS.workbench}
          />
          <GatedAction
            label="取消任务"
            branch="agent-task.cancel-task"
            capabilities={input.capabilities}
          />
        </div>
      </FieldCard>
    );
  }
  if (task.outcome !== null) {
    const outcome = task.outcome;
    return (
      <FieldCard title="失败与结果引用">
        <dl className="ag-fields">
          <Field label={outcome.candidateLabel}>
            <a className="mono" href={outcome.candidateHref}>
              {outcome.candidateRef.entityId} · {outcome.candidateRef.versionId}
            </a>
          </Field>
          <Field label="校验快照">
            <span className="mono">
              {outcome.validationRef.entityId} · {outcome.validationRef.versionId}
            </span>
          </Field>
        </dl>
        <p className="ag-note">{outcome.formalResultNote}</p>
      </FieldCard>
    );
  }
  return (
    <FieldCard title="失败与结果引用">
      <p className="ag-muted" style={{ margin: 0 }}>
        任务尚未产生结果引用
      </p>
    </FieldCard>
  );
}

function TaskContent({
  task,
  input,
}: {
  readonly task: AgentTaskView;
  readonly input: RouteRenderInput;
}) {
  return (
    <div>
      <RunHeader task={task} />
      <EnvelopeCard task={task} />
      <ToolActionsCard task={task} />
      <IncrementsCard task={task} />
      <FieldCard title="资源消耗">
        <BudgetFields budget={task.budget} />
        <div style={{ marginTop: 'var(--space-3)' }}>
          <VersionRefLine kind="预算策略" reference={task.ref.budgetPolicyRef} />
        </div>
        <p className="ag-note">
          预算为系统强制执行的版本化硬上限；预算耗尽或任务失败不静默跳过、不扩容、不换模型。
        </p>
      </FieldCard>
      <OutcomeCard task={task} input={input} />

      <FieldCard title="追溯链">
        <ul className="ag-trace-list">
          <li>
            资料段标识{' '}
            <a className="mono" href={AGENT_LINKS.evidenceTrace}>
              DOC2026001-S32-SEG007
            </a>
          </li>
          <li>
            工序节点 <span className="mono">PN-VDS-04</span>
            <span className="ag-muted">（变径段扩挖）</span>
          </li>
          <li>
            风险机理条目{' '}
            <a className="mono" href={AGENT_LINKS.knowledgeMechanisms}>
              MEC-VDS-017
            </a>
          </li>
          <li>
            Agent 任务 <span className="mono">{task.ref.reference.entityId}</span>
            <span className="ag-muted">（当前页）</span>
          </li>
          {task.ref.taskType === 'calibration-suggestion' ? (
            <>
              <li>
                偏差记录{' '}
                <a className="mono" href={AGENT_LINKS.responseFeedback('FBK-2026-001')}>
                  DEV-2026-001
                </a>
              </li>
              <li>
                校准建议{' '}
                <a className="mono" href={AGENT_LINKS.responseCalibration('CAL-2026-001')}>
                  CAL-2026-001
                </a>
              </li>
              <li>
                复核任务{' '}
                <a className="mono" href={AGENT_LINKS.reviewTask('RVT-2026-001')}>
                  RVT-2026-001
                </a>
              </li>
            </>
          ) : null}
          {task.ref.taskType === 'response-recommendation' ? (
            <li>
              处置建议{' '}
              <a className="mono" href={AGENT_LINKS.responseRecommendation('RESP-2026-001')}>
                RESP-2026-001
              </a>
            </li>
          ) : null}
          {task.ref.taskType === 'retrieval-review' ? (
            <li>
              识别运行{' '}
              <a className="mono" href={AGENT_LINKS.identificationRun('RUN-20260827-001')}>
                RUN-20260827-001
              </a>
            </li>
          ) : null}
        </ul>
      </FieldCard>

      <FieldCard title="业务事件时间线">
        <ol className="ag-timeline">
          {task.timeline.map((event) => (
            <li key={`${event.at}-${event.action}`} className="ag-timeline-item">
              <span className="ag-timeline-dot" aria-hidden />
              <span className="mono ag-timeline-at">{event.at}</span>
              <span className="ag-timeline-actor">{event.actorLabel}</span>
              <span>{event.action}</span>
            </li>
          ))}
        </ol>
      </FieldCard>
    </div>
  );
}

export function AgentTaskDetailPage({ input }: { readonly input: RouteRenderInput }) {
  const taskId = input.params.taskId ?? '';
  const task = agentTaskById(taskId);
  const state =
    input.pageState.kind === 'ready' && task === undefined
      ? ({ kind: 'empty' } as const)
      : input.pageState;

  return (
    <PageFrame
      title={`Agent 任务详情 ${taskId}`}
      state={state}
      skeleton="C"
      emptyMessage="未找到该 Agent 任务"
      content={
        task === undefined ? null : <TaskContent task={task} input={input} />
      }
    />
  );
}
