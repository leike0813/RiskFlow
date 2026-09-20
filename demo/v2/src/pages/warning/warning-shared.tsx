// 预警域页内共用件：动作三态门控、等级/状态 chip、版本引用行、业务事件时间线。
// 动作能力位取该动作对应 branch 在 contract-mirror 的映射（PAGE-GUIDE §4）。

import type { ReactNode } from 'react';
import { capabilityStateFor } from '../../app/capabilities';
import {
  BRANCH_CAPABILITY,
  versionedRef,
  type ModuleBranch,
} from '../../app/contract-mirror';
import {
  warningLevelById,
  type TaskTimelineEvent,
  type WarningLevelId,
} from '../../content/warning';

export function GatedAction({
  label,
  branch,
  capabilities,
  href,
}: {
  readonly label: string;
  readonly branch: ModuleBranch;
  readonly capabilities: ReadonlySet<string> | null;
  readonly href?: string;
}) {
  const required = BRANCH_CAPABILITY[branch];
  const state = capabilityStateFor(required, capabilities);
  if (state === 'unknown') {
    return (
      <button type="button" className="wr-btn" disabled>
        权限检查中
      </button>
    );
  }
  if (state === 'denied') {
    return (
      <button type="button" className="wr-btn" disabled aria-disabled="true">
        {label}
        <span className="visually-hidden">需要能力 {required}</span>
      </button>
    );
  }
  if (href !== undefined) {
    return (
      <a className="wr-btn wr-btn--primary" href={href}>
        {label}
      </a>
    );
  }
  return (
    <button type="button" className="wr-btn wr-btn--primary">
      {label}
    </button>
  );
}

export function WarningLevelChip({ levelId }: { readonly levelId: WarningLevelId }) {
  const level = warningLevelById(levelId);
  return (
    <span className={`wr-chip wr-chip--r${level.riskLevel}`}>
      <span className="wr-chip-dot" aria-hidden />
      {level.label}
    </span>
  );
}

export function StatusChip({ label }: { readonly label: string }) {
  return <span className="wr-chip wr-chip--status">{label}</span>;
}

/** 版本引用行：「类别名 entityId · versionId」，等宽字体（PAGE-GUIDE §5）。 */
export function VersionRefLine({
  kind,
  entityId,
  versionId,
}: {
  readonly kind: string;
  readonly entityId: string;
  readonly versionId: string;
}) {
  const ref = versionedRef(kind, entityId, versionId);
  return (
    <p className="wr-version-ref">
      <span>{ref.kind}</span>{' '}
      <span className="mono">
        {ref.reference.entityId} · {ref.reference.versionId}
      </span>
    </p>
  );
}

/** B 骨架底部业务事件时间线。 */
export function BusinessTimeline({ events }: { readonly events: readonly TaskTimelineEvent[] }) {
  return (
    <section className="wr-card" aria-label="业务事件时间线">
      <h3 className="wr-card-title">业务事件时间线</h3>
      <ol className="wr-timeline">
        {events.map((event) => (
          <li key={`${event.at}-${event.action}`} className="wr-timeline-item">
            <span className="wr-timeline-dot" aria-hidden />
            <span className="mono wr-timeline-at">{event.at}</span>
            <span className="wr-timeline-actor">{event.actorLabel}</span>
            <span>{event.action}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="wr-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
