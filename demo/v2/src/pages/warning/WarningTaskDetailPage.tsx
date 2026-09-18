// P-WR-04 预警处置任务详情（骨架 B 详情；branch warning-response.record-execution；
// 能力位 warning-response.read）。状态机步骤条 + 基本信息 + 关联预警 + 处置建议深链
// （RESP-2026-001 → P-RS-01，本页只作跳转落点）+ 执行/反馈登记动作三态门控 + 时间线。
// 七态：input.pageState 经 PageFrame 承载；路由标识未命中 fixture 时落入自然 empty 态。

import type { RouteRenderInput } from '../../app/routes';
import { ROLE_LABELS } from '../../app/contract-mirror';
import {
  WARNING_TASK_STATUSES,
  taskStatusById,
  triggerSummaryOf,
  warningById,
  warningTaskById,
} from '../../content/warning';
import { PageFrame } from '../../shared/PageFrame';
import {
  BusinessTimeline,
  Field,
  GatedAction,
  StatusChip,
  WarningLevelChip,
} from './warning-shared';
import './warning.css';

export function WarningTaskDetailPage({ input }: { readonly input: RouteRenderInput }) {
  const taskId = input.params.taskId ?? '';
  const task = warningTaskById(taskId);
  const state =
    input.pageState.kind === 'ready' && task === undefined
      ? ({ kind: 'empty' } as const)
      : input.pageState;

  const currentStepIndex =
    task === undefined
      ? -1
      : WARNING_TASK_STATUSES.findIndex((status) => status.id === task.status);

  return (
    <PageFrame
      title={`预警处置任务详情 ${taskId}`}
      state={state}
      skeleton="B"
      emptyMessage="未找到该预警处置任务"
      content={
        task === undefined ? null : (
          <div>
            <section className="wr-card" aria-label="任务状态">
              <h3 className="wr-card-title">任务状态</h3>
              <ol className="wr-steps" aria-label={`当前状态：${taskStatusById(task.status).label}`}>
                {WARNING_TASK_STATUSES.map((status, index) => (
                  <li
                    key={status.id}
                    className={
                      index === currentStepIndex
                        ? 'wr-step wr-step--current'
                        : index < currentStepIndex
                          ? 'wr-step wr-step--done'
                          : 'wr-step'
                    }
                    aria-current={index === currentStepIndex ? 'step' : undefined}
                  >
                    {status.label}
                  </li>
                ))}
              </ol>
              <dl className="wr-fields">
                <Field label="任务标识">
                  <span className="mono">{task.warningResponseTaskId}</span>
                </Field>
                <Field label="任务名称">{task.title}</Field>
                <Field label="当前状态">
                  <StatusChip label={taskStatusById(task.status).label} />
                </Field>
                <Field label="最高预警等级">
                  <WarningLevelChip levelId={task.highestWarningLevel} />
                </Field>
                <Field label="责任角色">{ROLE_LABELS[task.ownerRole]}</Field>
                <Field label="确认人">
                  {task.acknowledgedBy === null ? (
                    <span className="wr-muted">待确认</span>
                  ) : (
                    <>
                      {task.acknowledgedBy.actorLabel}{' '}
                      <span className="mono wr-muted">{task.acknowledgedBy.at}</span>
                    </>
                  )}
                </Field>
                <Field label="开立时间">
                  <span className="mono">{task.openedAt}</span>
                </Field>
              </dl>
              <div className="wr-btn-row" style={{ marginTop: 'var(--space-4)' }}>
                {task.status === 'open' ? (
                  <GatedAction
                    label="确认预警"
                    branch="warning-response.acknowledge"
                    capabilities={input.capabilities}
                  />
                ) : null}
                <GatedAction
                  label="登记执行"
                  branch="warning-response.record-execution"
                  capabilities={input.capabilities}
                  href="#/response/executions/register"
                />
                <GatedAction
                  label="登记反馈"
                  branch="warning-response.record-feedback"
                  capabilities={input.capabilities}
                />
              </div>
            </section>

            <section className="wr-card" aria-label="关联预警">
              <h3 className="wr-card-title">关联预警</h3>
              <div className="wr-table-wrap">
                <table className="wr-table">
                  <thead>
                    <tr>
                      <th>预警标识</th>
                      <th>等级</th>
                      <th>风险事件</th>
                      <th>触发摘要</th>
                      <th>通知状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {task.warningRecordIds.map((warningId) => {
                      const warning = warningById(warningId);
                      if (warning === undefined) return null;
                      return (
                        <tr key={warningId}>
                          <td>
                            <a className="mono" href={`#/warnings/${warningId}`}>
                              {warningId}
                            </a>
                          </td>
                          <td>
                            <WarningLevelChip levelId={warning.warningLevel} />
                          </td>
                          <td>{warning.riskEventSummary}</td>
                          <td>{triggerSummaryOf(warning)}</td>
                          <td>{warning.notificationStatus}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="wr-card" aria-label="处置建议">
              <h3 className="wr-card-title">处置建议</h3>
              {task.recommendationId === null ? (
                <p className="wr-muted" style={{ margin: 0 }}>
                  处置建议尚未记录
                </p>
              ) : (
                <p style={{ margin: 0 }}>
                  处置建议{' '}
                  <a
                    className="mono"
                    href={`#/response/recommendations/${task.recommendationId}`}
                  >
                    {task.recommendationId}
                  </a>
                  <span className="wr-muted">（三项校验通过，待采纳；详情见处置建议页）</span>
                </p>
              )}
            </section>

            <section className="wr-card" aria-label="追溯链">
              <h3 className="wr-card-title">追溯链</h3>
              <ul className="wr-trace-list">
                <li>
                  标准化风险记录{' '}
                  <a className="mono" href={`#/identification/records/${task.riskRecordId}`}>
                    {task.riskRecordId}
                  </a>
                </li>
                <li>
                  处置任务 <span className="mono">{task.warningResponseTaskId}</span>
                  <span className="wr-muted">（当前页）</span>
                </li>
                <li>
                  处置建议{' '}
                  {task.recommendationId === null ? (
                    <span className="wr-muted">尚未记录</span>
                  ) : (
                    <a
                      className="mono"
                      href={`#/response/recommendations/${task.recommendationId}`}
                    >
                      {task.recommendationId}
                    </a>
                  )}
                </li>
                <li>
                  证据追溯{' '}
                  <a className="mono" href="#/review-audit/trace">
                    DOC2026001-S32-SEG007
                  </a>
                </li>
              </ul>
            </section>

            <BusinessTimeline events={task.timeline} />
          </div>
        )
      }
    />
  );
}
