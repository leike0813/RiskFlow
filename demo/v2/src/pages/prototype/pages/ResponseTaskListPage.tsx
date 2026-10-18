// PROTOTYPE · THROWAWAY — 票 05 第 18 页：处置任务列表

import {
  WARNING_RECORDS,
  WARNING_RESPONSE_TASKS,
  WARNING_TASK_STATUSES,
  taskStatusById,
  warningLevelById,
  type WarningResponseTaskView,
} from '../../../content/warning';
import { AgentNote, Ids, RiskBadge, Section, Stats, Tag } from '../parts';

/** 归集口径：一个风险记录下的全部预警开立一个处置任务，任务下再走七类关系对象。 */
const RISK_INPUTS: readonly { riskRecordId: string; summary: string }[] = [
  ...new Set(
    WARNING_RESPONSE_TASKS.map((task) => ({
      riskRecordId: task.riskRecordId,
      summary:
        WARNING_RECORDS.find((warning) => warning.riskRecordId === task.riskRecordId)
          ?.riskEventSummary ?? '',
    })),
  ),
];

function TaskRows({ tasks }: { tasks: readonly WarningResponseTaskView[] }) {
  return (
    <table className="dl-table">
      <thead>
        <tr>
          <th>处置任务</th>
          <th>归集的预警</th>
          <th>最高预警等级</th>
          <th>状态</th>
          <th>确认记录</th>
          <th>处置建议</th>
          <th>最近进展</th>
          <th className="is-right">操作</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => {
          const level = warningLevelById(task.highestWarningLevel);
          const last = task.timeline[task.timeline.length - 1];
          return (
            <tr key={task.warningResponseTaskId}>
              <td>
                <div>{task.title}</div>
                <div className="dl-xs dl-faint">开立 {task.openedAt}</div>
              </td>
              <td className="dl-mono dl-xs">{task.warningRecordIds.join('、')}</td>
              <td>
                <RiskBadge levelId={`level-${level.riskLevel}`} label={level.label} />
              </td>
              <td>
                <Tag>{taskStatusById(task.status).label}</Tag>
              </td>
              <td className="dl-muted">
                {task.acknowledgedBy
                  ? `${task.acknowledgedBy.actorLabel} · ${task.acknowledgedBy.at}`
                  : '未确认'}
              </td>
              <td className="dl-mono dl-xs">{task.recommendationId ?? '尚未生成'}</td>
              <td className="dl-muted">
                <div>{last?.action}</div>
                <div className="dl-xs dl-faint">
                  {last?.at} · {last?.actorLabel}
                </div>
              </td>
              <td className="is-right">
                <button className="dl-btn dl-btn--sm" type="button">
                  {task.status === 'open' ? '确认并接管' : '查看闭环'}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ResponseTaskListPage() {
  const byStatus = WARNING_TASK_STATUSES.map((status) => ({
    status,
    count: WARNING_RESPONSE_TASKS.filter((task) => task.status === status.id).length,
  }));
  const waiting = WARNING_RESPONSE_TASKS.filter((task) => task.status === 'open');
  const withoutPlan = WARNING_RESPONSE_TASKS.filter(
    (task) => task.status === 'acknowledged' && !task.recommendationId,
  );

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">预警与处置 / 处置任务</div>
          <h1 className="dl-h1">处置任务</h1>
          <div className="dl-head-meta">
            <span className="dl-xs dl-faint">
              按风险输入归集 · 一个风险记录下的预警合并为一个处置任务
            </span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn" type="button">责任角色筛选</button>
          <button className="dl-btn" type="button">状态筛选</button>
          <button className="dl-btn dl-btn--primary" type="button">登记执行</button>
        </div>
      </header>

      <Stats
        items={[
          { label: '处置任务', value: WARNING_RESPONSE_TASKS.length },
          { label: '待确认', value: byStatus.find((s) => s.status.id === 'open')?.count ?? 0 },
          { label: '处置执行中', value: byStatus.find((s) => s.status.id === 'executing')?.count ?? 0 },
          { label: '待人工决定', value: waiting.length + withoutPlan.length },
        ]}
      />

      <AgentNote
        why="确认不关闭任务、不解除风险；采纳、执行、关闭都是人的决定，本页不呈现自动生效语义。"
        actions={
          <button className="dl-btn dl-btn--sm" type="button">只看待办</button>
        }
      >
        {waiting.length} 个任务尚未确认（{waiting.map((task) => task.title).join('、')}）；
        {withoutPlan.length} 个任务已确认但还没有正式处置建议（
        {withoutPlan.map((task) => task.title).join('、')}）。这两类都要你先推进。
      </AgentNote>

      <Section title="按风险输入归集" flush>
        {RISK_INPUTS.map((riskInput) => {
          const tasks = WARNING_RESPONSE_TASKS.filter(
            (task) => task.riskRecordId === riskInput.riskRecordId,
          );
          return (
            <div key={riskInput.riskRecordId}>
              <div
                className="dl-xs"
                style={{
                  padding: 'var(--dl-s2) var(--dl-s4)',
                  background: 'var(--dl-surface-2)',
                  borderBottom: '1px solid var(--dl-border)',
                }}
              >
                <strong>{riskInput.summary}</strong>
                <span className="dl-faint dl-mono"> {riskInput.riskRecordId}</span>
                <span className="dl-faint"> · 归集 {tasks.length} 个处置任务</span>
              </div>
              <TaskRows tasks={tasks} />
            </div>
          );
        })}
      </Section>

      <Section title="任务状态口径">
        <table className="dl-table">
          <thead>
            <tr>
              <th>状态</th>
              <th className="is-right">任务数</th>
              <th>含义</th>
            </tr>
          </thead>
          <tbody>
            {byStatus.map(({ status, count }) => (
              <tr key={status.id}>
                <td>
                  <Tag>{status.label}</Tag>
                </td>
                <td className="is-right is-num">{count}</td>
                <td className="dl-muted">
                  {status.id === 'open'
                    ? '预警已入库，等人确认接管'
                    : status.id === 'acknowledged'
                      ? '已确认接管，处置建议尚未生成'
                      : status.id === 'adopted'
                        ? '处置建议已由人采纳，等待现场执行'
                        : status.id === 'executing'
                          ? '现场处置执行中'
                          : status.id === 'feedback'
                            ? '反馈已登记，偏差进入比对口径'
                            : '偏差与校准建议均已人工处理'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Ids
        pairs={[
          ['处置任务', WARNING_RESPONSE_TASKS.map((task) => task.warningResponseTaskId).join(' ')],
          ['预警', WARNING_RECORDS.map((warning) => warning.warningRecordId).join(' ')],
          ['风险记录', RISK_INPUTS.map((risk) => risk.riskRecordId).join(' ')],
        ]}
      />
    </div>
  );
}
