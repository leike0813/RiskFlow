// 工程域页面共享件：版本引用文本、动作级能力门控按钮、字段网格、
// 状态徽标、业务事件时间线、A 骨架上下文副标题与筛选 chips。

import type { ReactNode } from 'react';
import { capabilityStateFor } from '../../app/capabilities';
import type { VersionedEntityRef } from '../../content/project';
import './project.css';

/** 版本引用呈现：<类别名> <entityId> · <versionId>（不可变快照语义）。 */
export function VersionedRefText({
  label,
  reference,
}: {
  readonly label: string;
  readonly reference: VersionedEntityRef | { readonly entityId: string; readonly versionId: string };
}) {
  const ref = 'reference' in reference ? reference.reference : reference;
  return (
    <span className="pj-vref">
      {label}{' '}
      <span className="mono">
        {ref.entityId} · {ref.versionId}
      </span>
    </span>
  );
}

/**
 * 动作级能力门控：allowed 可点；denied 置灰 + aria-disabled + 视觉隐藏原因；
 * unknown 显示「权限检查中」。动作所需能力位由调用方按 branch→能力位映射给出。
 */
export function GatedAction({
  capability,
  capabilities,
  label,
  actionCode,
  href,
  primary = false,
}: {
  readonly capability: string;
  readonly capabilities: ReadonlySet<string> | null;
  readonly label: string;
  readonly actionCode?: string;
  readonly href?: string;
  readonly primary?: boolean;
}) {
  const state = capabilityStateFor(capability, capabilities);
  const className = `pj-btn${primary ? ' pj-btn-primary' : ''}`;
  if (state === 'allowed' && href !== undefined) {
    return (
      <span className="pj-action">
        <a className={className} href={`#${href}`}>
          {label}
        </a>
        {actionCode === undefined ? null : <code className="pj-action-code">{actionCode}</code>}
      </span>
    );
  }
  if (state === 'allowed') {
    return (
      <span className="pj-action">
        <button type="button" className={className}>
          {label}
        </button>
        {actionCode === undefined ? null : <code className="pj-action-code">{actionCode}</code>}
      </span>
    );
  }
  const reasonId = `pj-gate-${actionCode ?? label}`;
  return (
    <span className="pj-action">
      <button type="button" className={className} disabled aria-disabled="true" aria-describedby={reasonId}>
        {state === 'unknown' ? '权限检查中' : label}
      </button>
      {actionCode === undefined ? null : <code className="pj-action-code">{actionCode}</code>}
      <span id={reasonId} className="visually-hidden">
        {state === 'unknown' ? '权限检查中' : `需要能力 ${capability}`}
      </span>
    </span>
  );
}

export type BadgeTone = 'neutral' | 'blue' | 'success' | 'review' | 'risk-1' | 'risk-2' | 'risk-3' | 'risk-4';

/** 文字徽标：颜色不作唯一信息载体，文案必须完整。 */
export function Badge({ tone = 'neutral', children }: { readonly tone?: BadgeTone; readonly children: ReactNode }) {
  return <span className={`pj-badge pj-badge-${tone}`}>{children}</span>;
}

export function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="pj-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function FieldGroup({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="pj-card">
      <h3>{title}</h3>
      <dl className="pj-field-grid">{children}</dl>
    </section>
  );
}

/** B 骨架底部业务事件时间线。 */
export function BusinessTimeline({
  events,
}: {
  readonly events: readonly { readonly time: string; readonly title: string; readonly actor: string; readonly ref?: { readonly label: string; readonly path: string } }[];
}) {
  return (
    <section className="pj-card">
      <h3>业务事件时间线</h3>
      <ol className="pj-timeline">
        {events.map((event) => (
          <li key={`${event.time}-${event.title}`}>
            <span className="mono pj-timeline-time">{event.time.slice(0, 16).replace('T', ' ')}</span>
            <span>{event.title}</span>
            <span className="pj-timeline-actor">{event.actor}</span>
            {event.ref === undefined ? null : (
              <a href={`#${event.ref.path}`} className="mono">
                {event.ref.label}
              </a>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A 骨架：标题下一行上下文副标题（工程 / 区段 / 数据时点）。 */
export function ContextSubtitle({ items }: { readonly items: readonly string[] }) {
  return <p className="pj-context-subtitle">{items.join(' · ')}</p>;
}

/** 筛选 chips（客户端筛选，不读 URL）。 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  readonly options: readonly { readonly key: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly label: string;
}) {
  return (
    <div className="pj-chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`pj-chip${value === option.key ? ' pj-chip-active' : ''}`}
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function DataTable({
  caption,
  head,
  children,
}: {
  readonly caption: string;
  readonly head: readonly string[];
  readonly children: ReactNode;
}) {
  return (
    <table className="pj-table">
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          {head.map((cell) => (
            <th key={cell} scope="col">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

export function formatDateTime(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  return `${(ms / 60_000).toFixed(1)} 分钟`;
}
