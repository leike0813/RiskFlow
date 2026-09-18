// 复核与审计域共享界面件：能力三态动作、版本引用文本、状态徽章、
// 字段卡、字段级修正 diff 表、阶段条、业务事件时间线、未找到卡片。

import type { ReactNode } from 'react';
import { capabilityStateFor, type CapabilityState } from '../../app/capabilities';
import { versionedRef } from '../../app/contract-mirror';
import type { VersionReference } from '../../content/review';
import './review.css';

/**
 * 动作级能力门控：allowed 可点；denied 置灰 + aria-disabled + 视觉隐藏原因；
 * unknown 显示「权限检查中」。动作所需能力位由调用方按 branch→能力位映射给出。
 */
export function CapabilityGate({
  capabilities,
  capability,
  href,
  primary = false,
  children,
}: {
  readonly capabilities: ReadonlySet<string> | null;
  readonly capability: string;
  readonly href?: string;
  readonly primary?: boolean;
  readonly children: ReactNode;
}) {
  const state: CapabilityState = capabilityStateFor(capability, capabilities);
  const className = `rv-btn${primary ? ' rv-btn-primary' : ''}`;
  if (state === 'allowed') {
    if (href !== undefined) {
      return (
        <a className={className} href={href}>
          {children}
        </a>
      );
    }
    return (
      <button type="button" className={className}>
        {children}
      </button>
    );
  }
  if (state === 'unknown') {
    return (
      <span className={className} aria-disabled="true">
        权限检查中
      </span>
    );
  }
  return (
    <span className={className} aria-disabled="true">
      {children}
      <span className="visually-hidden">（需要能力 {capability}）</span>
      <span className="rv-action-reason" aria-hidden="true">
        需要能力 <code>{capability}</code>
      </span>
    </span>
  );
}

/** 版本引用呈现：<类别名> <entityId> · <versionId>（等宽，不可变快照语义）。 */
export function VersionedRefText({
  kindLabel,
  reference,
}: {
  readonly kindLabel: string;
  readonly reference: VersionReference;
}) {
  const ref = versionedRef(kindLabel, reference.entityId, reference.versionId);
  return (
    <span className="rv-vref">
      <span className="rv-vref-kind">{ref.kind}</span>{' '}
      <span className="mono">
        {ref.reference.entityId} · {ref.reference.versionId}
      </span>
    </span>
  );
}

export function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="rv-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function FieldCard({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="rv-card" aria-label={title}>
      <h3 className="rv-card-title">{title}</h3>
      {children}
    </section>
  );
}

export function StatusBadge({
  tone,
  children,
}: {
  readonly tone: 'pending' | 'decided' | 'superseded' | 'review' | 'running' | 'done' | 'waiting' | 'failed' | 'neutral';
  readonly children: ReactNode;
}) {
  return <span className={`rv-badge rv-badge-${tone}`}>{children}</span>;
}

/** 字段级修正 diff 表（修正前 → 修正后）。 */
export function DiffTable({
  diffs,
}: {
  readonly diffs: readonly { readonly field: string; readonly before: string; readonly after: string }[];
}) {
  if (diffs.length === 0) {
    return <p className="rv-muted">无字段级差异记录。</p>;
  }
  return (
    <div className="rv-table-wrap">
      <table className="rv-table">
        <thead>
          <tr>
            <th scope="col">字段</th>
            <th scope="col">修正前</th>
            <th scope="col">修正后</th>
          </tr>
        </thead>
        <tbody>
          {diffs.map((diff) => (
            <tr key={diff.field}>
              <td>{diff.field}</td>
              <td className="rv-diff-before">{diff.before}</td>
              <td className="rv-diff-after">{diff.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STAGE_STATUS_LABELS: Readonly<Record<string, string>> = {
  done: '已完成',
  active: '进行中',
  waiting: '等待中',
  pending: '未开始',
  failed: '失败',
};

export function stageStatusLabel(status: string): string {
  return STAGE_STATUS_LABELS[status] ?? status;
}

/** I0–I9 / A0–A9 阶段条。 */
export function StageBar({
  stages,
  labels,
}: {
  readonly stages: readonly { readonly stage: string; readonly status: string }[];
  readonly labels: Readonly<Record<string, string>>;
}) {
  return (
    <ol className="rv-stage-bar" aria-label="运行阶段">
      {stages.map((stage) => (
        <li key={stage.stage} className={`rv-stage rv-stage-${stage.status}`}>
          <span className="rv-stage-id mono">{stage.stage}</span>
          <span className="rv-stage-name">{labels[stage.stage] ?? stage.stage}</span>
          <span className="rv-stage-status">{stageStatusLabel(stage.status)}</span>
        </li>
      ))}
    </ol>
  );
}

/** 业务事件时间线。 */
export function EventTimeline({
  events,
}: {
  readonly events: readonly { readonly at: string; readonly label: string; readonly href?: string }[];
}) {
  return (
    <section className="rv-card" aria-label="业务事件时间线">
      <h3 className="rv-card-title">业务事件时间线</h3>
      <ol className="rv-timeline">
        {events.map((event) => (
          <li key={`${event.at}-${event.label}`}>
            <span className="mono rv-timeline-at">{event.at}</span>
            {event.href === undefined ? (
              <span>{event.label}</span>
            ) : (
              <a href={event.href}>{event.label}</a>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function NotFoundCard({
  kind,
  id,
  backHref,
  backLabel,
}: {
  readonly kind: string;
  readonly id: string;
  readonly backHref: string;
  readonly backLabel: string;
}) {
  return (
    <div className="rv-card rv-not-found">
      <p>
        未找到{kind} <code className="mono">{id}</code>。
      </p>
      <p>
        <a href={backHref}>{backLabel}</a>
      </p>
    </div>
  );
}
