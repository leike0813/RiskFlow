// P-RV-01 待复核队列（E 复核骨架）。
// 骨架：E 复核（批量确认摘要条 + 证据对照列 + 历史决定区；决定表单在复核详情页）。
// 数据 branch：review-audit.request-review；页面级能力位：review-audit.read（框架层门控）。
// 动作级：「批量通过」需 review-audit.decide（branch review-audit.decide-review 映射）；
// 契约无批量决定命令，批量确认按逐项提交复核决定命令表达（见 gap-inbox/review.md）。
// 七态：非 ready 态由 PageFrame 承载；empty 态说明「当前没有待复核事项」。

import { useState } from 'react';
import { BRANCH_CAPABILITY } from '../../app/contract-mirror';
import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import {
  LINKS,
  REVIEW_TASK_STATUS_LABELS,
  REVIEW_TYPE_LABELS,
  REVIEW_TYPES,
  pendingReviewTasks,
  reviewDecisionById,
  settledReviewTasks,
  type ReviewTaskFixture,
  type ReviewTaskStatus,
  type ReviewType,
} from '../../content/review';
import { CapabilityGate, StatusBadge } from './widgets';

const DECIDE_CAPABILITY = BRANCH_CAPABILITY['review-audit.decide-review'];

const TYPE_FILTER_OPTIONS: readonly { readonly key: ReviewType | 'all'; readonly label: string }[] = [
  { key: 'all', label: '全部类型' },
  ...REVIEW_TYPES.map((type) => ({ key: type, label: REVIEW_TYPE_LABELS[type] })),
];

function taskStatusTone(status: ReviewTaskStatus): 'pending' | 'decided' | 'superseded' {
  return status;
}

function QueueRow({
  task,
  selected,
  onToggle,
}: {
  readonly task: ReviewTaskFixture;
  readonly selected: boolean;
  readonly onToggle: (taskId: string) => void;
}) {
  return (
    <tr>
      <td>
        <input
          type="checkbox"
          aria-label={`选择复核任务 ${task.reviewTaskId}`}
          checked={selected}
          onChange={() => onToggle(task.reviewTaskId)}
        />
      </td>
      <td>
        <a className="mono" href={LINKS.reviewDetail(task.reviewTaskId)}>
          {task.reviewTaskId}
        </a>
      </td>
      <td>
        <StatusBadge tone="review">{REVIEW_TYPE_LABELS[task.reviewType]}</StatusBadge>
      </td>
      <td>
        <div className="rv-cell-stack">
          <span>{task.targetLabel}</span>
          <span className="rv-muted mono">
            {task.targetRef.kind} {task.targetRef.reference.entityId} ·{' '}
            {task.targetRef.reference.versionId}
          </span>
        </div>
      </td>
      <td>{task.triggerReason}</td>
      <td>
        <div className="rv-cell-stack">
          <span>{task.requestedByLabel}</span>
          <span className="rv-muted mono">{task.requestedAt.slice(0, 16).replace('T', ' ')}</span>
        </div>
      </td>
      <td>
        <div className="rv-cell-stack">
          {task.evidenceReferences.map((evidence) => (
            <a
              key={evidence.locator.sourceSegmentId}
              className="mono"
              href={LINKS.evidenceTrace}
            >
              {evidence.locator.sourceSegmentId}
            </a>
          ))}
        </div>
      </td>
      <td>
        <a href={LINKS.reviewDetail(task.reviewTaskId)}>打开复核</a>
      </td>
    </tr>
  );
}

function SettledRow({ task }: { readonly task: ReviewTaskFixture }) {
  const decision = task.decisionId === undefined ? undefined : reviewDecisionById(task.decisionId);
  return (
    <tr>
      <td>
        <a className="mono" href={LINKS.reviewDetail(task.reviewTaskId)}>
          {task.reviewTaskId}
        </a>
      </td>
      <td>
        <StatusBadge tone="review">{REVIEW_TYPE_LABELS[task.reviewType]}</StatusBadge>
      </td>
      <td>{task.targetLabel}</td>
      <td>
        <StatusBadge tone={taskStatusTone(task.status)}>
          {REVIEW_TASK_STATUS_LABELS[task.status]}
        </StatusBadge>
      </td>
      <td>
        {decision === undefined ? (
          <span className="rv-muted">
            {task.status === 'superseded'
              ? `被命令 ${task.supersededByCommandId ?? ''} 替代`
              : '—'}
          </span>
        ) : (
          <div className="rv-cell-stack">
            <span>
              {decision.actorLabel} · {decision.reasonText}
            </span>
            <span className="rv-muted mono">
              {decision.reviewDecisionId} · {decision.decidedAt.slice(0, 16).replace('T', ' ')}
            </span>
          </div>
        )}
      </td>
    </tr>
  );
}

export function ReviewQueuePage({ input }: { readonly input: RouteRenderInput }) {
  const [typeFilter, setTypeFilter] = useState<ReviewType | 'all'>('all');
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);

  const pending = pendingReviewTasks();
  const rows = typeFilter === 'all' ? pending : pending.filter((task) => task.reviewType === typeFilter);
  const settled = settledReviewTasks();

  const toggle = (taskId: string) =>
    setSelectedIds((current) =>
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId],
    );

  return (
    <PageFrame
      title="待复核队列"
      state={input.pageState}
      skeleton="E"
      emptyMessage="当前没有待复核事项；识别记录、知识修订与校准建议转人工复核后在此入队。"
      content={
        <div className="rv-page">
          <p className="rv-context-subtitle">
            示例工程 · 站隧一体化标；队列统一呈现待复核对象（识别分组 / 知识修订 / 规则冲突 /
            处置候选 / 校准建议）。
          </p>

          <div className="rv-batch-bar" aria-label="批量确认摘要">
            <div className="rv-batch-summary">
              <span>
                待复核 <span className="rv-batch-count">{pending.length}</span> 项
              </span>
              <span>已选 {selectedIds.length} 项</span>
            </div>
            <div className="rv-batch-summary">
              <CapabilityGate
                capabilities={input.capabilities}
                capability={DECIDE_CAPABILITY}
                primary
              >
                批量通过
              </CapabilityGate>
            </div>
            <p className="rv-batch-note">
              批量确认将逐项提交复核决定命令（decide-review），逐项记录决定与理由；
              单条复核请进入复核详情。
            </p>
          </div>

          <div className="rv-chips" role="group" aria-label="按复核类型筛选">
            {TYPE_FILTER_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`rv-chip${typeFilter === option.key ? ' rv-chip-active' : ''}`}
                aria-pressed={typeFilter === option.key}
                onClick={() => setTypeFilter(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="rv-table-wrap">
            <table className="rv-table">
              <thead>
                <tr>
                  <th scope="col">选择</th>
                  <th scope="col">复核任务</th>
                  <th scope="col">复核类型</th>
                  <th scope="col">复核对象</th>
                  <th scope="col">触发原因</th>
                  <th scope="col">提请</th>
                  <th scope="col">证据</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((task) => (
                  <QueueRow
                    key={task.reviewTaskId}
                    task={task}
                    selected={selectedIds.includes(task.reviewTaskId)}
                    onToggle={toggle}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 ? (
            <p className="rv-muted">当前筛选下没有待复核事项。</p>
          ) : null}

          <section className="rv-card" aria-label="历史决定">
            <h3 className="rv-card-title">历史决定</h3>
            <div className="rv-table-wrap">
              <table className="rv-table">
                <thead>
                  <tr>
                    <th scope="col">复核任务</th>
                    <th scope="col">复核类型</th>
                    <th scope="col">复核对象</th>
                    <th scope="col">状态</th>
                    <th scope="col">决定记录</th>
                  </tr>
                </thead>
                <tbody>
                  {settled.map((task) => (
                    <SettledRow key={task.reviewTaskId} task={task} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="rv-muted" style={{ marginTop: 'var(--space-3)' }}>
              完整操作留痕见 <a href={LINKS.auditLog}>版本与操作审计</a>。
            </p>
          </section>
        </div>
      }
    />
  );
}
