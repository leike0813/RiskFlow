// 页面框架：七态渲染。行为对齐生产 apps/web/src/shared/page-shells/PageFrame.tsx：
// error 只展示安全字段（code / retryable / requestId / references.kind）；
// forbidden 置灰并提示所需能力；unavailable 区分「路由未接入」与「权限检查中」；
// loading 按页面骨架种类渲染骨架屏。

import { useId, type ReactNode } from 'react';
import type { PageLoadState, SafePageError, SafeReason } from '../app/state';
import { SkeletonView } from '../shell/skeletons/SkeletonView';
import type { SkeletonKind } from '../shell/skeletons/skeletons';
import './page-frame.css';

export interface PageFrameProps {
  readonly title: string;
  readonly state: PageLoadState<unknown>;
  readonly skeleton?: SkeletonKind;
  readonly content?: ReactNode;
  readonly emptyMessage?: string;
  readonly className?: string;
}

const UNAVAILABLE_REASON_LABELS: Readonly<Record<string, string>> = {
  'route-not-integrated': '路由未接入',
  'capability-check-pending': '权限检查中',
};

export function SafeErrorFields({ error }: { error: SafePageError }) {
  return (
    <span className="safe-error-fields">
      <code>{error.code}</code>
      <span>{error.retryable ? '可重试' : '不可重试'}</span>
      {error.requestId === null ? null : <code>{error.requestId}</code>}
      {error.references.length > 0 ? (
        <span>{error.references.map((reference) => reference.kind).join(', ')}</span>
      ) : null}
    </span>
  );
}

function UnavailableReasons({ reasons }: { reasons: readonly SafeReason[] }) {
  return (
    <ul className="page-unavailable-reasons">
      {reasons.map((reason) => (
        <li key={reason.code}>
          <span>{UNAVAILABLE_REASON_LABELS[reason.code] ?? '当前不可用'}</span>
          <code>{reason.code}</code>
        </li>
      ))}
    </ul>
  );
}

export function PageFrame({
  title,
  state,
  skeleton = 'B',
  content,
  emptyMessage = '暂无可显示内容',
  className,
}: PageFrameProps) {
  const headingId = useId();
  const busy = state.kind === 'loading';
  let body: ReactNode;
  if (state.kind === 'ready') {
    body = content;
  } else if (state.kind === 'loading') {
    body = <SkeletonView kind={skeleton} />;
  } else if (state.kind === 'empty') {
    body = (
      <div className="page-empty">
        <p>{emptyMessage}</p>
      </div>
    );
  } else if (state.kind === 'error') {
    body = (
      <p data-page-state="error">
        <SafeErrorFields error={state.error} />
      </p>
    );
  } else if (state.kind === 'forbidden') {
    body = (
      <p data-page-state="forbidden">
        <span>无权访问本页，需要能力</span> <code>{state.requiredCapability}</code>
      </p>
    );
  } else if (state.kind === 'unavailable') {
    body = (
      <div data-page-state="unavailable">
        <p>当前不可用</p>
        <UnavailableReasons reasons={state.reasons} />
      </div>
    );
  } else {
    body = <p data-page-state="idle">等待加载</p>;
  }
  return (
    <section
      className={['page-frame', className ?? ''].filter(Boolean).join(' ')}
      aria-labelledby={headingId}
      aria-busy={busy}
      data-page-state={state.kind}
    >
      <header className="page-frame-header">
        <h2 id={headingId}>{title}</h2>
      </header>
      <div className="page-frame-body">{body}</div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {state.kind}
      </p>
    </section>
  );
}
