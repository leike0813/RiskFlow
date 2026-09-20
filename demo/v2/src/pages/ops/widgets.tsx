// 运营设施域页面共享件：系统管理动作三态门控、版本引用文本、状态徽标、
// 字段分组卡、业务事件时间线、A 骨架上下文副标题与筛选 chips。
//
// 设施域（ops）页面无业务 branch（manifest 标 null，GAP-012 预设）；系统管理
// 六动作与设施运维动作在 29 个业务能力位中无专属位（docs/gap-inbox/ops.md）。
// 原型期以「能力并集为空集」作为系统管理员身份的判据：五个预设角色中仅
// system-administrator 的能力并集为空（contract-mirror 角色策略镜像）。

import type { ReactNode } from 'react';
import { versionedRef } from '../../app/contract-mirror';
import type { VersionReference } from '../../content/ops';
import './ops.css';

export type SystemActionState = 'allowed' | 'denied' | 'unknown';

/**
 * 设施域动作三态：权限未知 → unknown；能力并集为空（系统管理员）→ allowed；
 * 其余业务角色 → denied。denied 原因文案为「需系统管理员身份」。
 */
export function systemActionState(
  capabilities: ReadonlySet<string> | null,
): SystemActionState {
  if (capabilities === null) return 'unknown';
  return capabilities.size === 0 ? 'allowed' : 'denied';
}

/** 设施域动作按钮（三态门控；动作码以等宽字体随按钮呈现）。 */
export function SystemAction({
  label,
  actionCode,
  capabilities,
  onClick,
  danger = false,
  primary = false,
}: {
  readonly label: string;
  readonly actionCode?: string;
  readonly capabilities: ReadonlySet<string> | null;
  readonly onClick?: () => void;
  readonly danger?: boolean;
  readonly primary?: boolean;
}) {
  const state = systemActionState(capabilities);
  const className = `op-btn${primary ? ' op-btn-primary' : ''}${danger ? ' op-btn-danger' : ''}`;
  if (state === 'allowed') {
    return (
      <span className="op-action">
        <button type="button" className={className} onClick={onClick}>
          {label}
        </button>
        {actionCode === undefined ? null : <code className="op-action-code">{actionCode}</code>}
      </span>
    );
  }
  return (
    <span className="op-action">
      <button type="button" className={className} disabled aria-disabled="true">
        {state === 'unknown' ? '权限检查中' : label}
      </button>
      {actionCode === undefined ? null : <code className="op-action-code">{actionCode}</code>}
      <span className="visually-hidden">
        {state === 'unknown' ? '权限检查中' : '需系统管理员身份'}
      </span>
    </span>
  );
}

/** 版本引用呈现：<类别名> <entityId> · <versionId>，等宽字体（不可变快照语义）。 */
export function VersionRefText({
  kind,
  reference,
}: {
  readonly kind: string;
  readonly reference: VersionReference;
}) {
  const ref = versionedRef(kind, reference.entityId, reference.versionId);
  return (
    <span className="op-vref">
      {ref.kind}{' '}
      <span className="mono">
        {ref.reference.entityId} · {ref.reference.versionId}
      </span>
    </span>
  );
}

export type BadgeTone = 'neutral' | 'blue' | 'success' | 'review' | 'risk-2' | 'risk-3';

/** 文字徽标：颜色不作唯一信息载体，文案必须完整。 */
export function Badge({
  tone = 'neutral',
  children,
}: {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
}) {
  return <span className={`op-badge op-badge-${tone}`}>{children}</span>;
}

export function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="op-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function FieldGroup({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="op-card">
      <h3>{title}</h3>
      <dl className="op-field-grid">{children}</dl>
    </section>
  );
}

export function Card({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="op-card">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/** A 骨架：标题下一行上下文副标题。 */
export function ContextLine({ items }: { readonly items: readonly string[] }) {
  return <p className="op-context">{items.join(' · ')}</p>;
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
    <div className="op-chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`op-chip${value === option.key ? ' op-chip-active' : ''}`}
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
    <div className="op-table-wrap">
      <table className="op-table">
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
    </div>
  );
}

/** 业务事件时间线（B 骨架底部）。 */
export function BusinessTimeline({
  events,
}: {
  readonly events: readonly { readonly at: string; readonly actorLabel: string; readonly action: string }[];
}) {
  return (
    <section className="op-card">
      <h3>业务事件时间线</h3>
      <ol className="op-timeline">
        {events.map((event) => (
          <li key={`${event.at}-${event.action}`}>
            <span className="mono op-timeline-at">{event.at}</span>
            <span className="op-timeline-actor">{event.actorLabel}</span>
            <span>{event.action}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function formatDateTime(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}
