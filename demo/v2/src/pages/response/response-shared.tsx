// 处置域页内共用件：能力三态动作门控、字段卡、版本引用行、校验结果、风险状态、
// 追溯链与业务事件时间线。动作能力位取该动作对应 branch 在 contract-mirror 的映射
// （PAGE-GUIDE §4）；风险等级文案与配色取自矩阵版本 fixture，颜色不作唯一信息载体。

import type { ReactNode } from 'react';
import { capabilityStateFor } from '../../app/capabilities';
import {
  BRANCH_CAPABILITY,
  versionedRef,
  type ModuleBranch,
} from '../../app/contract-mirror';
import { matrixLevel } from '../../content/assessment';
import {
  REVIEW_STATUS_LABELS,
  type EvidenceRef,
  type ReviewStatus,
  type RiskStateView,
  type TimelineEvent,
  type VersionRef,
} from '../../content/response';

/** 动作级能力门控：allowed 可点；denied 置灰并说明所需能力；unknown 显示权限检查中。 */
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
      <button type="button" className="rs-btn" disabled>
        权限检查中
      </button>
    );
  }
  if (state === 'denied') {
    return (
      <button type="button" className="rs-btn" disabled aria-disabled="true">
        {label}
        <span className="visually-hidden">需要能力 {required}</span>
      </button>
    );
  }
  if (href !== undefined) {
    return (
      <a className="rs-btn rs-btn--primary" href={href}>
        {label}
      </a>
    );
  }
  return (
    <button type="button" className="rs-btn rs-btn--primary">
      {label}
    </button>
  );
}

/** 字段分组卡（B 骨架必备区域）。 */
export function FieldCard({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="rs-card" aria-label={title}>
      <h3 className="rs-card-title">{title}</h3>
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="rs-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** 版本引用行：「类别 entityId · versionId」，等宽字体，不可变快照语义（PAGE-GUIDE §5）。 */
export function VersionRefLine({
  kind,
  reference,
}: {
  readonly kind: string;
  readonly reference: VersionRef;
}) {
  const ref = versionedRef(kind, reference.entityId, reference.versionId);
  return (
    <p className="rs-version-ref">
      <span>{ref.kind}</span>{' '}
      <span className="mono">
        {ref.reference.entityId} · {ref.reference.versionId}
      </span>
    </p>
  );
}

/** 复核状态徽章。 */
export function ReviewStatusChip({ status }: { readonly status: ReviewStatus }) {
  const tone =
    status === 'approved' ? 'rs-chip--pass' : status === 'rejected' ? 'rs-chip--fail' : 'rs-chip--status';
  return <span className={`rs-chip ${tone}`}>{REVIEW_STATUS_LABELS[status]}</span>;
}

/** 校验结果徽章（ValidationResult.passed + issues）。 */
export function ValidationChip({ passed }: { readonly passed: boolean }) {
  return (
    <span className={`rs-chip ${passed ? 'rs-chip--pass' : 'rs-chip--fail'}`}>
      {passed ? '通过' : '未通过'}
    </span>
  );
}

/** 风险等级徽章：等级文案与配色取自评估矩阵版本 levels（数据驱动）。 */
export function RiskLevelBadge({ levelKey }: { readonly levelKey: string }) {
  const level = matrixLevel(levelKey);
  if (level === undefined) {
    return <span className="rs-chip rs-chip--status">等级未定</span>;
  }
  return (
    <span
      className="rs-level-badge"
      style={{ color: level.color, background: level.softColor, borderColor: level.color }}
    >
      {level.label}
    </span>
  );
}

/** 风险状态块：P / C 分值与矩阵映射等级分列。 */
export function RiskStateFields({ state }: { readonly state: RiskStateView }) {
  return (
    <dl className="rs-fields">
      <Field label="发生可能性 P">
        <span className="mono">{state.likelihoodScore}</span>
      </Field>
      <Field label="后果严重度 C">
        <span className="mono">{state.consequenceScore}</span>
      </Field>
      <Field label="风险等级（矩阵映射）">
        <RiskLevelBadge levelKey={state.riskLevel} />
      </Field>
    </dl>
  );
}

/** 证据入口：资料段标识链接到证据追溯（P-RV-04）。 */
export function EvidenceLinks({ evidence }: { readonly evidence: readonly EvidenceRef[] }) {
  return (
    <span className="rs-evidence-list">
      {evidence.map((item) => (
        <a
          key={item.locator.sourceSegmentId}
          className="mono"
          href="#/review-audit/trace"
          title={`${item.sourceVersion.entityId} · ${item.sourceVersion.versionId}`}
        >
          {item.locator.sourceSegmentId}
        </a>
      ))}
    </span>
  );
}

/** 追溯链卡片：每页回答自己落在链上哪一环。 */
export function TraceCard({
  items,
}: {
  readonly items: readonly {
    readonly label: string;
    readonly id: string;
    readonly href?: string;
    readonly current?: boolean;
    readonly note?: string;
  }[];
}) {
  return (
    <FieldCard title="追溯链">
      <ul className="rs-trace-list">
        {items.map((item) => (
          <li key={`${item.label}-${item.id}`}>
            {item.label}{' '}
            {item.href === undefined ? (
              <span className="mono">{item.id}</span>
            ) : (
              <a className="mono" href={item.href}>
                {item.id}
              </a>
            )}
            {item.current === true ? <span className="rs-muted">（当前页）</span> : null}
            {item.note === undefined ? null : <span className="rs-muted">（{item.note}）</span>}
          </li>
        ))}
      </ul>
    </FieldCard>
  );
}

/** B 骨架底部业务事件时间线。 */
export function BusinessTimeline({ events }: { readonly events: readonly TimelineEvent[] }) {
  return (
    <FieldCard title="业务事件时间线">
      <ol className="rs-timeline">
        {events.map((event) => (
          <li key={`${event.at}-${event.action}`} className="rs-timeline-item">
            <span className="rs-timeline-dot" aria-hidden />
            <span className="mono rs-timeline-at">{event.at}</span>
            <span className="rs-timeline-actor">{event.actorLabel}</span>
            <span>{event.action}</span>
          </li>
        ))}
      </ol>
    </FieldCard>
  );
}
