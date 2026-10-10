import type { ReactNode } from "react";
import { Card } from "./Card";
import type { PageState } from "../api/engineering";
import "./PageStateView.css";

/**
 * 页面四态骨架：loading 骨架占位、empty 引导、error 结构化摘要+重试、forbidden 权限骨架
 * （不披露目标存在性，只提示所需能力语义）。所有只读页面共用，避免逐页分叉。
 */
export function PageStateView<T>({
  state,
  title,
  emptyMessage,
  idleMessage = "尚未选择工程。请通过顶栏「选择工程」输入工程标识后查看。",
  forbiddenHint = "当前角色不具备查看该内容的权限",
  onRetry,
  children,
}: {
  state: PageState<T> | { readonly kind: "idle" } | { readonly kind: "empty"; message: string };
  title: string;
  emptyMessage?: string;
  idleMessage?: string;
  forbiddenHint?: string;
  onRetry?: () => void;
  children: (value: T) => ReactNode;
}) {
  if (state.kind === "ready") return <>{children(state.value)}</>;
  return (
    <Card title={title}>
      <div className={`psv psv-${state.kind}`} data-page-state={state.kind}>
        {state.kind === "idle" && <span>{idleMessage}</span>}
        {state.kind === "loading" && <span>加载中…</span>}
        {state.kind === "empty" && <span>{emptyMessage ?? "当前条件下暂无数据"}</span>}
        {state.kind === "forbidden" && <span>{forbiddenHint}</span>}
        {state.kind === "error" && (
          <>
            <span>内容加载失败（{state.error.code}）</span>
            {onRetry !== undefined && (
              <button type="button" className="psv-retry" onClick={onRetry}>
                重试
              </button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
