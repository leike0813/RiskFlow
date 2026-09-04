import { useId, type ReactNode } from "react";

import type { SafeHttpErrorV1 } from "../../api/errors.js";
import type { PageLoadStateV1, SafeReasonV1 } from "../../app/state.js";
import { actionDisabledReason, invokeWebAction, type WebActionV1 } from "../actions.js";

export type PageFrameVariantV1 = "list" | "detail" | "run" | "governance" | "review";

export type PageFramePropsV1<T> = Readonly<{
  title: string;
  state: PageLoadStateV1<T>;
  variant?: PageFrameVariantV1;
  content?: ReactNode | ((value: T) => ReactNode);
  actions?: readonly WebActionV1[];
  emptyMessage?: string;
  className?: string;
}>;

export const safeErrorFields = (error: SafeHttpErrorV1): ReactNode => (
  <span className="safe-error-fields">
    <code>{error.code}</code>
    <span>{error.retryable ? "可重试" : "不可重试"}</span>
    <span>{error.requestId}</span>
    {error.references.length > 0 ? (
      <span>{error.references.map((reference) => reference.kind).join(", ")}</span>
    ) : null}
  </span>
);

const reasonCodes = (reasons: readonly SafeReasonV1[]): ReactNode => (
  <ul>
    {reasons.map((reason) => (
      <li key={reason.code}>
        <code>{reason.code}</code>
      </li>
    ))}
  </ul>
);

const renderAction = (action: WebActionV1, index: number): ReactNode => {
  const reason = actionDisabledReason(action.availability);
  const reasonId = `${action.actionId}-reason-${index}`;
  return (
    <span className="page-action" key={action.actionId}>
      <button
        type="button"
        disabled={!action.availability || action.availability.kind !== "allowed"}
        aria-disabled={action.availability.kind === "allowed" ? undefined : true}
        aria-describedby={reason === undefined ? undefined : reasonId}
        onClick={() => {
          invokeWebAction(action);
        }}
      >
        {action.label}
      </button>
      {reason === undefined ? null : (
        <span id={reasonId} className="visually-hidden">
          {reason}
        </span>
      )}
    </span>
  );
};

const renderContent = <T,>(content: PageFramePropsV1<T>["content"], value: T): ReactNode =>
  typeof content === "function" ? content(value) : content;

export const PageFrame = <T,>({
  title,
  state,
  variant,
  content,
  actions = [],
  emptyMessage = "暂无可显示内容",
  className,
}: PageFramePropsV1<T>): ReactNode => {
  const headingId = useId();
  const stateId = useId();
  const busy = state.kind === "loading";
  const visibleActions =
    state.kind === "empty"
      ? actions.filter((action) => action.availability.kind === "allowed")
      : actions;
  const headerActions = state.kind === "empty" ? [] : visibleActions;
  let body: ReactNode;
  if (state.kind === "ready") body = renderContent(content, state.value);
  else if (state.kind === "loading") {
    body =
      state.previous === null ? (
        <div className="page-skeleton" aria-hidden="true" />
      ) : (
        renderContent(content, state.previous)
      );
  } else if (state.kind === "empty") {
    body = (
      <div className="page-empty">
        <p>{emptyMessage}</p>
        <div className="page-actions">{headerActions.map(renderAction)}</div>
      </div>
    );
  } else if (state.kind === "error") {
    body = <p data-page-state="error">{safeErrorFields(state.error)}</p>;
  } else if (state.kind === "forbidden") {
    body = (
      <p data-page-state="forbidden">
        <span>无权访问</span> <code>{state.requiredCapability}</code>
      </p>
    );
  } else if (state.kind === "unavailable") {
    body = (
      <div data-page-state="unavailable">
        <p>当前不可用</p>
        {reasonCodes(state.reasons)}
      </div>
    );
  } else {
    body = <p data-page-state="idle">等待加载</p>;
  }
  return (
    <section
      className={[
        "page-frame",
        variant === undefined ? "" : `page-frame-${variant}`,
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-labelledby={headingId}
      aria-busy={busy}
      data-page-state={state.kind}
    >
      <header className="page-frame-header">
        <h2 id={headingId}>{title}</h2>
        <div className="page-actions">{visibleActions.map(renderAction)}</div>
      </header>
      <div id={stateId} className="page-frame-body">
        {body}
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {state.kind}
      </p>
    </section>
  );
};
