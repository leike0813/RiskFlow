/**
 * Agent 停靠栏全局开关状态（模块级单例）。
 * 停靠栏组件挂在 AppShell 内，路由切换时页面重建，
 * 开关状态保存在模块作用域，跨导航不丢失。
 */
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function toggleAgentDock() {
  open = !open;
  emit();
}

export function setAgentDock(next: boolean) {
  if (open !== next) {
    open = next;
    emit();
  }
}

export function useAgentDockOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => open,
  );
}
