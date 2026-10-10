import type { ReactNode } from "react";

/**
 * C37 D-17：迁入页面的宿主透传。
 *
 * 完整业务界面由 `shell/AppShell` 唯一渲染；这里的同名组件只保留页面原有的
 * `activeNav` / `agentContext` 记号，供验收与既有页面结构继续按原样书写。
 * 它**不再**创建第二个壳——嵌套壳会重复导航、会话与标题，破坏唯一宿主语义。
 */

export type NavKey =
  "overview" | "project" | "identification" | "assessment" | "warnings" | "knowledge" | "review";

export interface AppShellPropsV1 {
  readonly activeNav: NavKey | null;
  /** Agent 停靠栏的上下文标签；只作展示，不参与授权。 */
  readonly agentContext?: readonly string[];
  readonly children: ReactNode;
}

export default function AppShell({ activeNav, agentContext, children }: AppShellPropsV1) {
  return (
    <div data-page-section={activeNav ?? "none"}>
      {agentContext !== undefined && agentContext.length > 0 ? (
        <span data-agent-context={agentContext.join(",")} hidden />
      ) : null}
      {children}
    </div>
  );
}
