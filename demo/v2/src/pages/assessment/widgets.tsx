// 评估域共享界面件：能力三态动作、版本引用、风险等级徽章、阶段条、字段卡、时间线。
// 等级与颜色全部数据驱动（来自矩阵版本 fixture 的 levels），不硬编码等级文案。

import type { ReactNode } from 'react';
import { capabilityStateFor, type CapabilityState } from '../../app/capabilities';
import type { VersionRef } from '../../content/assessment';
import { matrixLevel } from '../../content/assessment';

/** 动作级能力门控：allowed 可点；denied 置灰并说明所需能力；unknown 显示权限检查中。 */
export function CapabilityAction({
  capabilities,
  capability,
  href,
  children,
}: {
  readonly capabilities: ReadonlySet<string> | null;
  readonly capability: string;
  readonly href: string;
  readonly children: ReactNode;
}) {
  const state: CapabilityState = capabilityStateFor(capability, capabilities);
  if (state === 'allowed') {
    return (
      <a className="ra-action" href={href}>
        {children}
      </a>
    );
  }
  if (state === 'unknown') {
    return (
      <span className="ra-action ra-action-disabled" aria-disabled="true">
        权限检查中
      </span>
    );
  }
  return (
    <span className="ra-action ra-action-disabled" aria-disabled="true">
      {children}
      <span className="visually-hidden">（需要能力 {capability}）</span>
      <span className="ra-action-reason" aria-hidden="true">
        需要能力 <code>{capability}</code>
      </span>
    </span>
  );
}

/** 版本引用呈现：类别 entityId · versionId（等宽，快照语义）。 */
export function VersionRefText({ label, reference }: { readonly label: string; readonly reference: VersionRef }) {
  return (
    <span className="ra-version-ref">
      <span className="ra-version-kind">{label}</span>{' '}
      <span className="mono">
        {reference.entityId} · {reference.versionId}
      </span>
    </span>
  );
}

/** 风险等级徽章：等级文案与配色取自矩阵版本 levels，颜色不作唯一信息载体。 */
export function RiskLevelBadge({ levelKey }: { readonly levelKey: string }) {
  const level = matrixLevel(levelKey);
  if (level === undefined) {
    return <span className="ra-level-badge">等级未定</span>;
  }
  return (
    <span
      className="ra-level-badge"
      style={{ color: level.color, background: level.softColor, borderColor: level.color }}
    >
      {level.label}
    </span>
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

/** A0–A9 阶段条。 */
export function StageBar({
  stages,
  labels,
}: {
  readonly stages: readonly { readonly stage: string; readonly status: string; readonly summary?: string }[];
  readonly labels: Readonly<Record<string, string>>;
}) {
  return (
    <ol className="ra-stage-bar" aria-label="评估阶段">
      {stages.map((stage) => (
        <li key={stage.stage} className={`ra-stage ra-stage-${stage.status}`}>
          <span className="ra-stage-id mono">{stage.stage}</span>
          <span className="ra-stage-name">{labels[stage.stage] ?? stage.stage}</span>
          <span className="ra-stage-status">{stageStatusLabel(stage.status)}</span>
        </li>
      ))}
    </ol>
  );
}

/** 字段分组卡（B 骨架）。 */
export function FieldCard({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="ra-card" aria-label={title}>
      <h3 className="ra-card-title">{title}</h3>
      {children}
    </section>
  );
}

export function FieldRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="ra-field-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** 业务事件时间线（B 骨架底部）。 */
export function EventTimeline({
  events,
}: {
  readonly events: readonly { readonly at: string; readonly label: string; readonly href?: string }[];
}) {
  return (
    <section className="ra-card" aria-label="业务事件时间线">
      <h3 className="ra-card-title">业务事件时间线</h3>
      <ol className="ra-timeline">
        {events.map((event) => (
          <li key={`${event.at}-${event.label}`}>
            <span className="mono ra-timeline-at">{event.at}</span>
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

/** 运行 / 记录状态徽章。 */
export function StatusBadge({ tone, children }: { readonly tone: 'running' | 'done' | 'waiting' | 'neutral' | 'failed'; readonly children: ReactNode }) {
  return <span className={`ra-status-badge ra-status-${tone}`}>{children}</span>;
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
    <div className="ra-card ra-not-found">
      <p>
        未找到{kind} <code className="mono">{id}</code>。
      </p>
      <p>
        <a href={backHref}>{backLabel}</a>
      </p>
    </div>
  );
}
