import { useId, type ReactNode } from "react";

import type { SafeHttpErrorV1 } from "../../api/errors.js";
import type { PageLoadStateV1, SafeReasonV1 } from "../../app/state.js";
import { actionDisabledReason, invokeWebAction, type WebActionV1 } from "../actions.js";

export type PageRegionKindV1 =
  | "list"
  | "detail"
  | "form"
  | "chart"
  | "timeline"
  | "matrix-grid"
  | "tabs"
  | "run"
  | "governance"
  | "review"
  | "agent"
  | "action";

export type PageChartVariantV1 = "donut" | "hbars" | "trend" | "graph" | "matrix";

/**
 * CH-2 D-03：页面区域描述符。
 *
 * 只有稳定 `key` 与呈现 kind，没有任何 URL、端口、数据选择器、领域 DTO 或动作配置——
 * 区域组合是 JSX 结构，不是页面引擎。chart 必带 variant，其它 kind 不带该字段。
 */
export type PageRegionDescriptorV1 =
  | Readonly<{ key: string; kind: Exclude<PageRegionKindV1, "chart"> }>
  | Readonly<{ key: string; kind: "chart"; variant: PageChartVariantV1 }>;

export type PageRegionV1<T> = Readonly<{
  descriptor: PageRegionDescriptorV1;
  content: ReactNode | ((value: T) => ReactNode);
}>;

export type PageFramePropsV1<T> = Readonly<{
  title: string;
  state: PageLoadStateV1<T>;
  /** 有序区域块；页面级失败不显示任何旧区域。 */
  regions: readonly PageRegionV1<T>[];
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
  // CH-2 D-09：hidden 完全不渲染，不用 disabled 透露目标存在。
  if (action.availability.kind === "hidden") return null;
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

const renderRegion = <T,>(region: PageRegionV1<T>, value: T): ReactNode => (
  <div
    key={region.descriptor.key}
    className={`page-region page-region-${region.descriptor.kind}`}
    data-region-kind={region.descriptor.kind}
    {...("variant" in region.descriptor
      ? { "data-region-variant": region.descriptor.variant }
      : {})}
  >
    {typeof region.content === "function" ? region.content(value) : region.content}
  </div>
);

const renderRegions = <T,>(regions: readonly PageRegionV1<T>[], value: T): ReactNode => (
  <>{regions.map((region) => renderRegion(region, value))}</>
);

/**
 * 自行布局页面的区域渲染出口。
 *
 * PageFrame 自己承担 h1 与七态；已经拥有自己的标题与取数状态的业务页只借用区域
 * 结构与顺序，不套第二层 Frame——那会产生两个 level-1 标题。
 */
export const PageRegions = <T,>({
  regions,
  value,
}: {
  readonly regions: readonly PageRegionV1<T>[];
  readonly value: T;
}): ReactNode => renderRegions(regions, value);

export const PageFrame = <T,>({
  title,
  state,
  regions,
  actions = [],
  emptyMessage = "暂无可显示内容",
  className,
}: PageFramePropsV1<T>): ReactNode => {
  const headingId = useId();
  const stateId = useId();
  const busy = state.kind === "loading";
  const visible = (action: WebActionV1): boolean => action.availability.kind !== "hidden";
  const visibleActions =
    state.kind === "empty"
      ? actions.filter((action) => visible(action) && action.availability.kind === "allowed")
      : actions;
  const headerActions = state.kind === "empty" ? [] : visibleActions.filter(visible);
  let body: ReactNode;
  if (state.kind === "ready") body = renderRegions(regions, state.value);
  else if (state.kind === "loading") {
    body =
      state.previous === null ? (
        <div className="page-skeleton" aria-hidden="true" />
      ) : (
        renderRegions(regions, state.previous)
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
      className={["page-frame", className ?? ""].filter(Boolean).join(" ")}
      aria-labelledby={headingId}
      aria-busy={busy}
      data-page-state={state.kind}
    >
      <header className="page-frame-header">
        {/*
          C37 D-17：页面标题是本页唯一的一级标题。应用外壳只保留跳转目标文本，
          由这里承担 h1，避免同页出现两个 level-1 标题。
        */}
        <h1 id={headingId}>{title}</h1>
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
