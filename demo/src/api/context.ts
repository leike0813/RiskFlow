/**
 * 会话与工程上下文选择器：工程上下文只由 URL `?project=<id>&revision=<versionId>` 表达，
 * 切换工程即改 URL 并停留当前页重新加载；无工程参数时页面呈现引导空态。
 */

export interface EngineeringSelector {
  readonly projectId: string | null;
  readonly revisionId: string | null;
}

export const selectorFromSearch = (search: string): EngineeringSelector => {
  const params = new URLSearchParams(search);
  const projectId = params.get("project");
  const revision = params.get("revision");
  return {
    projectId: projectId !== null && projectId.trim().length > 0 ? projectId : null,
    revisionId:
      revision !== null && revision.includes("@")
        ? (revision.split("@")[1] ?? null)
        : revision !== null && revision.trim().length > 0
          ? revision
          : null,
  };
};

export const searchWithSelector = (
  search: string,
  selector: { readonly project: string; readonly revision?: string | null },
): string => {
  const params = new URLSearchParams(search);
  params.set("project", selector.project);
  if (selector.revision !== undefined && selector.revision !== null) {
    params.set("revision", selector.revision);
  } else {
    params.delete("revision");
  }
  return `?${params.toString()}`;
};

/** 页面统一状态机：NOT_FOUND / AUTHENTICATION_REQUIRED 映射 forbidden/会话，不作普通错误。 */
export type PageState<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: T }
  | { readonly kind: "empty"; readonly message: string }
  | { readonly kind: "error"; readonly code: string; readonly retryable: boolean }
  | { readonly kind: "forbidden" };

// ------------------------------------------------------------------ React 上下文

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiError } from "./client";
import type { EngineeringContextView } from "./operations";
import type { SessionMetadata } from "./session";

/**
 * 会话状态机：启动期先自省，再决定进入业务页、改密还是登录。
 *
 * `restoring` 与 `restore-failed` 是独立状态而不是匿名：技术故障期间界面显示可重试失败，
 * 绝不把一次读失败表述成「没有有效会话」。
 */
export type SessionState =
  | { readonly kind: "restoring" }
  | { readonly kind: "restore-failed" }
  | { readonly kind: "anonymous" }
  | { readonly kind: "authenticated"; readonly session: SessionMetadata };

export interface SessionContextValue {
  readonly state: SessionState;
  readonly login: (loginName: string, password: string) => Promise<boolean>;
  readonly changePassword: (newPassword: string) => Promise<boolean>;
  readonly logout: () => Promise<boolean>;
  readonly logoutPending: boolean;
  readonly logoutFailed: boolean;
  readonly retryRestore: () => void;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export const SessionProvider = (props: { value: SessionContextValue; children: ReactNode }) =>
  createElement(SessionContext.Provider, { value: props.value }, props.children);

export const useSession = (): SessionContextValue => {
  const value = useContext(SessionContext);
  if (value === null) throw new Error("useSession must be used within SessionProvider");
  return value;
};

/** 工程上下文：URL 选择器 + context-read 结果；未选工程为 idle（引导空态）。 */
export type EngineeringContextState = { readonly kind: "idle" } | PageState<EngineeringContextView>;

export interface EngineeringContextValue {
  readonly selector: EngineeringSelector;
  readonly state: EngineeringContextState;
  readonly reload: () => void;
}

export const EngineeringContext = createContext<EngineeringContextValue | null>(null);

export const EngineeringProvider = (props: {
  value: EngineeringContextValue;
  children: ReactNode;
}) => createElement(EngineeringContext.Provider, { value: props.value }, props.children);

export const useEngineering = (): EngineeringContextValue => {
  const value = useContext(EngineeringContext);
  if (value === null) throw new Error("useEngineering must be used within EngineeringProvider");
  return value;
};

/** 工程内跳转目标：把当前工程/版本选择器并入目标路径的查询串，避免详情跳转丢失上下文。 */
export const useProjectPath = (): ((path: string) => string) => {
  const { selector } = useEngineering();
  return (path) => {
    if (selector.projectId === null) return path;
    const queryIndex = path.indexOf("?");
    const pathname = queryIndex === -1 ? path : path.slice(0, queryIndex);
    const params = new URLSearchParams(queryIndex === -1 ? "" : path.slice(queryIndex + 1));
    params.set("project", selector.projectId);
    if (selector.revisionId !== null) params.set("revision", selector.revisionId);
    return `${pathname}?${params.toString()}`;
  };
};

/** 页面查询 hook：无工程时为 idle（引导空态）；依赖变化重建查询；retry 重新发起同一查询。 */
export const usePageQuery = <T>(
  query: (projectId: string, signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): { readonly state: PageState<T> | { readonly kind: "idle" }; readonly retry: () => void } => {
  const { selector } = useEngineering();
  const [state, setState] = useState<PageState<T> | { kind: "idle" }>({ kind: "idle" });
  const [tick, setTick] = useState(0);
  const sequence = useRef(0);

  useEffect(() => {
    if (selector.projectId === null) {
      setState({ kind: "idle" });
      return;
    }
    const projectId = selector.projectId;
    const controller = new AbortController();
    // 迟到的旧响应不得覆盖新查询：取消只能拦住未完成的请求，已 resolve 的仍会回调。
    sequence.current += 1;
    const current = sequence.current;
    const settle = (next: PageState<T>) => {
      if (current === sequence.current) setState(next);
    };
    setState({ kind: "loading" });
    query(projectId, controller.signal)
      .then((value) => settle({ kind: "ready", value }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (
          error instanceof ApiError &&
          (error.code === "NOT_FOUND" || error.code === "AUTHENTICATION_REQUIRED")
        ) {
          settle({ kind: "forbidden" });
          return;
        }
        settle({
          kind: "error",
          code: error instanceof ApiError ? error.code : "TERMINAL_FAILURE",
          retryable: error instanceof ApiError ? error.retryable : false,
        });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selector.projectId, selector.revisionId, tick, ...deps]);

  return { state, retry: () => setTick((value) => value + 1) };
};
