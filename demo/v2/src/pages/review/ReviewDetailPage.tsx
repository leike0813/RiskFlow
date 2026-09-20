// P-RV-02 复核详情（E 复核骨架）。
// 骨架：E 复核（任务头部 + 证据对照区 + 决定表单 + 历史决定区）。
// 数据 branch：review-audit.decide-review；页面级能力位：review-audit.read（框架层门控）。
// 动作级：「提交复核决定」需 review-audit.decide（branch review-audit.decide-review 映射）；
// 决定选项按复核类型取 ReviewDecisionV1 的分类型枚举。
// 七态：非 ready 态由 PageFrame 承载；路由参数未命中时给出自然「未找到」卡片。

import { useState } from 'react';
import { BRANCH_CAPABILITY } from '../../app/contract-mirror';
import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import {
  DECISION_KIND_LABELS,
  DECISION_OPTIONS,
  LINKS,
  REVIEW_TASK_STATUS_LABELS,
  REVIEW_TYPE_LABELS,
  decisionsForTarget,
  reviewDecisionById,
  reviewTaskById,
  type ReviewTaskFixture,
} from '../../content/review';
import {
  CapabilityGate,
  EventTimeline,
  Field,
  FieldCard,
  NotFoundCard,
  StatusBadge,
  VersionedRefText,
} from './widgets';

const DECIDE_CAPABILITY = BRANCH_CAPABILITY['review-audit.decide-review'];

function DecisionHistory({ task }: { readonly task: ReviewTaskFixture }) {
  const decisions = decisionsForTarget(task.targetRef.reference.entityId).filter(
    (decision) => decision.reviewTaskId !== task.reviewTaskId,
  );
  return (
    <FieldCard title="历史决定">
      {decisions.length === 0 ? (
        <p className="rv-muted">本复核对象暂无历史决定。</p>
      ) : (
        <ul className="rv-decision-list">
          {decisions.map((decision) => (
            <li key={decision.reviewDecisionId} className="rv-decision-item">
              <span>
                <span className="mono">{decision.reviewDecisionId}</span> ·{' '}
                {DECISION_KIND_LABELS[decision.decisionKind] ?? decision.decisionKind}
              </span>
              <span className="rv-muted">
                {decision.actorLabel} · {decision.decidedAt.slice(0, 16).replace('T', ' ')} · 理由码{' '}
                <span className="mono">{decision.reasonCode}</span>
              </span>
              <span>{decision.reasonText}</span>
            </li>
          ))}
        </ul>
      )}
    </FieldCard>
  );
}

function DecisionForm({ task, capabilities }: { readonly task: ReviewTaskFixture; readonly capabilities: ReadonlySet<string> | null }) {
  const options = DECISION_OPTIONS[task.reviewType];
  const [selectedKind, setSelectedKind] = useState(options[0]?.kind ?? '');
  const isIdentification = task.reviewType === 'identification-group';

  if (task.status === 'decided') {
    const decision =
      task.decisionId === undefined ? undefined : reviewDecisionById(task.decisionId);
    return (
      <FieldCard title="决定记录">
        {decision === undefined ? null : (
          <dl className="rv-field-grid">
            <Field label="决定">
              {DECISION_KIND_LABELS[decision.decisionKind] ?? decision.decisionKind}
            </Field>
            <Field label="决定标识">
              <span className="mono">{decision.reviewDecisionId}</span>
            </Field>
            <Field label="决定人">{decision.actorLabel}</Field>
            <Field label="决定时间">
              <span className="mono">{decision.decidedAt.slice(0, 16).replace('T', ' ')}</span>
            </Field>
            <Field label="理由码">
              <span className="mono">{decision.reasonCode}</span>
            </Field>
            <Field label="理由">{decision.reasonText}</Field>
            {decision.revisedCandidateRef === undefined ? null : (
              <Field label="修正候选">
                <VersionedRefText kindLabel="修正候选集" reference={decision.revisedCandidateRef} />
              </Field>
            )}
          </dl>
        )}
      </FieldCard>
    );
  }

  if (task.status === 'superseded') {
    return (
      <FieldCard title="决定表单">
        <p className="rv-muted">
          本复核任务已被替代（替代命令{' '}
          <span className="mono">{task.supersededByCommandId ?? ''}</span>），不能再提交决定。
        </p>
      </FieldCard>
    );
  }

  return (
    <FieldCard title="决定表单">
      <div className="rv-decision-form">
        <fieldset className="rv-decision-form" style={{ border: 'none', margin: 0, padding: 0 }}>
          <legend className="visually-hidden">复核决定</legend>
          {options.map((option) => (
            <label key={option.kind} className="rv-radio-row">
              <input
                type="radio"
                name="decision-kind"
                checked={selectedKind === option.kind}
                onChange={() => setSelectedKind(option.kind)}
              />
              <span>{option.label}</span>
              <span className="rv-muted mono">{option.kind}</span>
            </label>
          ))}
        </fieldset>
        {isIdentification && selectedKind === 'approve-revised-candidate' ? (
          <p className="rv-muted">
            「修正并通过」需在识别复核页完成字段级修正：
            <a href={LINKS.identificationReview(task.reviewTaskId)}>前往识别复核·修正并通过</a>
          </p>
        ) : null}
        <label className="rv-decision-form">
          <span>理由（必填，随决定记录留痕）</span>
          <textarea rows={3} defaultValue="" aria-label="复核理由" />
        </label>
        <div className="rv-form-footer">
          <CapabilityGate capabilities={capabilities} capability={DECIDE_CAPABILITY} primary>
            提交复核决定
          </CapabilityGate>
        </div>
      </div>
    </FieldCard>
  );
}

function ReviewDetailContent({ task, capabilities }: { readonly task: ReviewTaskFixture; readonly capabilities: ReadonlySet<string> | null }) {
  return (
    <div className="rv-page">
      <FieldCard title="复核任务">
        <dl className="rv-field-grid">
          <Field label="复核任务">
            <VersionedRefText
              kindLabel="复核任务"
              reference={{ entityId: task.reviewTaskId, versionId: task.taskVersionId }}
            />
          </Field>
          <Field label="复核类型">
            <StatusBadge tone="review">{REVIEW_TYPE_LABELS[task.reviewType]}</StatusBadge>
          </Field>
          <Field label="状态">
            <StatusBadge tone={task.status}>{REVIEW_TASK_STATUS_LABELS[task.status]}</StatusBadge>
          </Field>
          <Field label="提请">
            {task.requestedByLabel}（<span className="mono">{task.requestedById}</span>）·{' '}
            <span className="mono">{task.requestedAt.slice(0, 16).replace('T', ' ')}</span>
          </Field>
          <Field label="触发原因">{task.triggerReason}</Field>
          <Field label="等待恢复的运行">
            {task.waitingRunHref === null ? (
              <span className="mono">{task.waitingRunRef.reference.entityId}</span>
            ) : (
              <a className="mono" href={task.waitingRunHref}>
                {task.waitingRunRef.reference.entityId}
              </a>
            )}
          </Field>
          <Field label="复核策略">
            <VersionedRefText kindLabel="复核策略" reference={task.reviewPolicyRef} />
          </Field>
          <Field label="校验快照">
            <span className="mono">
              {task.validationSnapshotRef.reference.entityId} ·{' '}
              {task.validationSnapshotRef.reference.versionId}
            </span>
          </Field>
          <Field label="证据快照">
            <span className="mono">
              {task.evidenceSnapshotRef.reference.entityId} ·{' '}
              {task.evidenceSnapshotRef.reference.versionId}
            </span>
          </Field>
        </dl>
        <p className="rv-muted" style={{ marginTop: 'var(--space-3)' }}>
          复核对象：{task.targetLabel}
          {task.targetHref === null ? null : (
            <>
              {' '}
              <a className="mono" href={task.targetHref}>
                {task.targetRef.reference.entityId} · {task.targetRef.reference.versionId}
              </a>
            </>
          )}
        </p>
      </FieldCard>

      <FieldCard title="证据对照">
        <div className="rv-table-wrap">
          <table className="rv-table">
            <thead>
              <tr>
                <th scope="col">资料段</th>
                <th scope="col">资料版本</th>
                <th scope="col">证据入口</th>
              </tr>
            </thead>
            <tbody>
              {task.evidenceReferences.map((evidence) => (
                <tr key={evidence.locator.sourceSegmentId}>
                  <td className="mono">{evidence.locator.sourceSegmentId}</td>
                  <td>
                    <VersionedRefText kindLabel="资料" reference={evidence.sourceVersion} />
                  </td>
                  <td>
                    <a href={LINKS.evidenceTrace}>证据追溯</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FieldCard>

      <DecisionForm task={task} capabilities={capabilities} />
      <DecisionHistory task={task} />

      <EventTimeline
        events={[
          {
            at: task.requestedAt.slice(0, 16).replace('T', ' '),
            label: `复核任务 ${task.reviewTaskId} 创建（${REVIEW_TYPE_LABELS[task.reviewType]}）`,
          },
          ...(task.decidedAt === undefined
            ? []
            : [
                {
                  at: task.decidedAt.slice(0, 16).replace('T', ' '),
                  label: `复核决定 ${task.decisionId ?? ''} 提交`,
                },
              ]),
          ...(task.supersededAt === undefined
            ? []
            : [
                {
                  at: task.supersededAt.slice(0, 16).replace('T', ' '),
                  label: `复核任务被替代（命令 ${task.supersededByCommandId ?? ''}）`,
                },
              ]),
        ]}
      />
    </div>
  );
}

export function ReviewDetailPage({ input }: { readonly input: RouteRenderInput }) {
  const reviewId = input.params['reviewId'] ?? '';
  const task = reviewTaskById(reviewId);
  return (
    <PageFrame
      title="复核详情"
      state={input.pageState}
      skeleton="E"
      emptyMessage="当前没有复核任务"
      content={
        task === undefined ? (
          <NotFoundCard
            kind="复核任务"
            id={reviewId}
            backHref={LINKS.reviewQueue}
            backLabel="返回待复核队列"
          />
        ) : (
          <ReviewDetailContent task={task} capabilities={input.capabilities} />
        )
      }
    />
  );
}
