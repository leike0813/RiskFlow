import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { C09HttpError, makeSafeHttpError } from "./http.js";
import {
  projectPathWithSelector,
  selectorFromSearch,
  type EngineeringSelector,
} from "./context.js";
import type { PageLoadStateV1, WebContextV1 } from "../app/state.js";
import type { EngineeringContextView } from "./operations.js";

/**
 * C37 D-17：工程上下文接入既有 Web 宿主。
 *
 * 会话与工程状态由 `app/state.ts` 的 `WebContextV1` 唯一拥有，这里只做两件事：
 * 把 URL 选择器接上该上下文，并把页面查询结果收敛到既有七态之一。
 * 不新建第二套会话、HTTP 客户端或错误模型。
 */

export interface EngineeringContextValue {
  readonly selector: EngineeringSelector;
  readonly context: WebContextV1;
  /**
   * 工程 context-read 的结果。
   * 它由宿主的工程查询注入；页面据此呈现工程阶段与当前修订，不另发一次读取。
   */
  readonly state: EngineeringPageState<EngineeringContextReadViewV1>;
  readonly reload: () => void;
}

export type EngineeringContextReadViewV1 = EngineeringContextView;

const EngineeringContext = createContext<EngineeringContextValue | null>(null);

export const EngineeringProvider = (props: {
  value: EngineeringContextValue;
  children: ReactNode;
}) => createElement(EngineeringContext.Provider, { value: props.value }, props.children);

export const useEngineering = (): EngineeringContextValue => {
  const value = useContext(EngineeringContext);
  if (value === null) {
    throw new Error("useEngineering must be used within EngineeringProvider");
  }
  return value;
};

/**
 * 外壳 chrome 用的可空读取：外壳还渲染在没有工程门禁的场景（如 SSR 结构测试），
 * 那里没有 Provider。页面仍用会抛错的 `useEngineering`，免得缺门禁被静默当成空工程。
 */
export const useEngineeringOptional = (): EngineeringContextValue | null =>
  useContext(EngineeringContext);

/** 工程内跳转目标；与 URL 选择器共用同一份工程上下文。 */
export const useProjectPath = (): ((path: string) => string) => {
  const { selector } = useEngineering();
  return useMemo(() => (path: string) => projectPathWithSelector(path, selector), [selector]);
};

export type EngineeringPageState<T> = PageLoadStateV1<T>;

/**
 * 迁入页面沿用的页面状态别名。
 * 它就是 Web 既有七态，不引入第二套状态机。
 */
export type PageState<T> = EngineeringPageState<T>;

/**
 * 无权态只呈现「需要哪项能力」，不透露对象是否存在。
 * 该能力来自页面自身分支，不从服务端错误推断。
 */
const FORBIDDEN_CAPABILITY = "engineering-data.read" as const;

/**
 * 页面查询 hook。
 *
 * - 无工程时为 idle（引导空态），不发请求；
 * - 工程或依赖变化即取消在途请求并重建查询；
 * - 迟到的旧响应不得覆盖新上下文（用序列号判定）；
 * - `NOT_FOUND` 与认证类失败收口为 forbidden，不当作普通错误。
 */
export const usePageQuery = <T>(
  query: (projectId: string, signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): { readonly state: EngineeringPageState<T>; readonly retry: () => void } => {
  const { selector } = useEngineering();
  const queryKey = JSON.stringify([
    selector.projectId,
    selector.revisionId,
    selector.assessmentSources,
    ...deps,
  ]);
  const [settled, setSettled] = useState<{ key: string; state: EngineeringPageState<T> }>({
    key: queryKey,
    state: { kind: "idle" },
  });
  const [tick, setTick] = useState(0);
  const sequence = useRef(0);

  useEffect(() => {
    if (selector.projectId === null) {
      sequence.current += 1;
      setSettled({ key: queryKey, state: { kind: "idle" } });
      return;
    }
    const projectId = selector.projectId;
    const controller = new AbortController();
    // 取消只能拦住未完成请求；已 resolve 的迟到响应由序列号挡住。
    sequence.current += 1;
    const current = sequence.current;
    const settle = (next: EngineeringPageState<T>) => {
      if (current === sequence.current) setSettled({ key: queryKey, state: next });
    };
    settle({ kind: "loading", previous: null });
    query(projectId, controller.signal).then(
      (value) => settle({ kind: "ready", value }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        const code = error instanceof C09HttpError ? error.error.code : "TERMINAL_FAILURE";
        // 无权与不存在一律收口为 forbidden，不区分二者以免泄露存在性。
        if (code === "NOT_FOUND" || code === "AUTHENTICATION_REQUIRED") {
          settle({ kind: "forbidden", requiredCapability: FORBIDDEN_CAPABILITY });
          return;
        }
        settle({
          kind: "error",
          error: makeSafeHttpError({
            code,
            retryable: error instanceof C09HttpError ? error.error.retryable : false,
          }),
        });
      },
    );
    return () => {
      sequence.current += 1;
      controller.abort();
    };
  }, [selector.projectId, selector.revisionId, selector.assessmentSources, tick, ...deps]);

  return {
    state:
      settled.key === queryKey
        ? settled.state
        : selector.projectId === null
          ? { kind: "idle" }
          : { kind: "loading", previous: null },
    retry: () => setTick((value) => value + 1),
  };
};

/** 从 URL 选择器构造工程上下文值，供宿主注入。 */
export const engineeringContextValueFrom = (
  context: WebContextV1,
  reload: () => void,
  state: EngineeringPageState<EngineeringContextReadViewV1> = { kind: "idle" },
  search?: string,
): EngineeringContextValue => {
  // 工程有两条来源：URL 自带 `?project=`，以及用户在上下文栏按标识直接进入。
  // 上下文状态优先——否则「按标识进入」后 URL 仍为空，页面会一直停在引导态。
  const fromSearch = search === undefined ? undefined : selectorFromSearch(search);
  // 同一工程保留 URL 的精确修订；切到别的工程时旧修订必须清除，不能拿来读新工程。
  const sameProject = context.projectId !== null && fromSearch?.projectId === context.projectId;
  const selector =
    context.projectId === null
      ? { projectId: fromSearch?.projectId ?? null, revisionId: fromSearch?.revisionId ?? null }
      : {
          projectId: context.projectId,
          revisionId: sameProject ? (fromSearch?.revisionId ?? null) : null,
        };
  // 资料来源由用户在 URL 上声明。工程内跳转靠 `projectPathWithSelector` 带上它，
  // 少了这一份来源，深链读会被按「未声明来源」拒绝——这正是运行详情页读不回来的原因。
  // 上下文工程与 URL 工程不一致（用户在上下文栏切了工程）时来源属于旧工程，不继承。
  const sources =
    fromSearch !== undefined &&
    (context.projectId === null || context.projectId === fromSearch.projectId)
      ? fromSearch.assessmentSources
      : undefined;
  return Object.freeze({
    selector: sources === undefined ? selector : { ...selector, assessmentSources: sources },
    context,
    state,
    reload,
  });
};
