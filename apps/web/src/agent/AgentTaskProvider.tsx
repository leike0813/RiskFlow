import type { ReactElement } from "react";
/**
 * C35 共享 Agent 任务状态（design D-05/D-12）。
 *
 * 全应用只有这一个 Provider：停靠栏、工作台与任务详情读同一份任务事实，
 * 不允许各自再发一套轮询或各自缓存一份列表。
 *
 * 刷新契约：5 秒节拍、同一时刻最多一个在途请求；切工程或注销先清内容并取消在途与计时，
 * 新一轮响应只在代际匹配时才被接收——迟到的旧响应被丢弃而不是覆盖新工程的内容。
 * 浏览器关闭只停止界面请求，不取消任何耐久任务。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  agentReadFailureOf,
  readAgentTaskDetail,
  readAgentLaunchContext,
  readAgentTaskList,
  type AgentReadFailureView,
  type AgentLaunchContextView,
  type AgentTaskDetailView,
  type AgentTaskListView,
  type AgentTaskRefView,
  type KindRef,
} from "../api/agentAuditOperations";

/** 单在途刷新的节拍；慢读期间不会堆积请求。 */
export const AGENT_TASK_REFRESH_INTERVAL_MS_V1 = 5_000;

export interface AgentTaskFilters {
  readonly taskType?: string;
  readonly status?: string;
  readonly parentRunRef?: KindRef;
}

export interface AgentTaskSnapshot {
  /** 当前代际：工程切换或注销会自增，旧响应因此无法回写。 */
  readonly generation: number;
  readonly taskRef?: AgentTaskRefView;
  readonly list?: AgentTaskListView;
  readonly detail?: AgentTaskDetailView;
  readonly launchContext?: AgentLaunchContextView;
  readonly loading: boolean;
  /** 既有外壳契约：失败时是错误码字符串，没有失败是空串。 */
  readonly error?: string;
  /** 同一失败的真实技术映射：码、可重试性与诊断引用。 */
  readonly failure?: AgentReadFailureView | undefined;
  readonly lastUpdatedAt?: string;
}

export interface AgentTaskContextValue extends AgentTaskSnapshot {
  readonly allowed: boolean;
  setFilters: (next: AgentTaskFilters) => void;
  openTask: (taskRef: Pick<AgentTaskRefView, "kind" | "reference">) => void;
  closeTask: () => void;
  refreshNow: () => void;
}

const EMPTY_SNAPSHOT: AgentTaskSnapshot = { generation: 0, loading: false };

/** 单次窄读的收口结果：要么是值，要么是一次带真实技术映射的失败。 */
interface AgentReadOutcome<T> {
  readonly value?: T;
  readonly failure?: AgentReadFailureView;
}

const AgentTaskContext = createContext<AgentTaskContextValue | null>(null);

export function useAgentTask(): AgentTaskContextValue {
  const value = useContext(AgentTaskContext);
  if (value === null) throw new Error("AgentTaskProvider is missing");
  return value;
}

/**
 * 外壳 chrome 用的可空读取：生产外壳挂在 Provider 内；脱离 Provider 的宿主
 * （如 SSR 结构测试）渲染「Agent 不可用」而不是崩掉。页面仍用会抛错的 `useAgentTask`，
 * 免得缺 Provider 被静默当成没有任务。
 */
export const useAgentTaskOptional = (): AgentTaskContextValue | null =>
  useContext(AgentTaskContext);

export function AgentTaskProvider(props: {
  readonly projectId?: string;
  /**
   * CH-2 D-08：助手入口资格。为 false 时不发起任何 list/detail 读取，也不安排轮询。
   *
   * 未取得 `agent-task.read` 的角色仍保留原复核入口与精确详情——本 Provider 只拥有
   * Agent 事实，缺席不得被解释成"本域也没有复核能力"。
   */
  readonly allowed?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const allowed = props.allowed !== false;
  const [snapshot, setSnapshot] = useState<AgentTaskSnapshot>(EMPTY_SNAPSHOT);
  const [filters, setFiltersState] = useState<AgentTaskFilters>({});
  const [taskRef, setTaskRef] = useState<Pick<AgentTaskRefView, "kind" | "reference"> | undefined>(
    undefined,
  );

  // 代际、计时器与在途请求都放在 ref：切工程/注销时先自增代际并中止，
  // 任何在途响应回来时对不上代际就直接丢弃。
  const generationRef = useRef(0);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);

  const clearPending = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = undefined;
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  // 清空快照须同步当前代际，后续真实响应才能回写。
  useEffect(() => {
    clearPending();
    setSnapshot({ generation: generationRef.current, loading: false });
    setTaskRef(undefined);
    setFiltersState({});
  }, [props.projectId, clearPending]);

  useEffect(() => () => clearPending(), [clearPending]);

  // 资格被拒或工程变化时清空 Agent 事实并停止刷新；服务端继续拥有任务事实本身。
  useEffect(() => {
    if (allowed) return;
    clearPending();
    setSnapshot({ generation: generationRef.current, loading: false });
    setTaskRef(undefined);
    setFiltersState({});
  }, [allowed, clearPending]);

  const load = useCallback(
    async (generation: number) => {
      const projectId = props.projectId;
      if (!allowed || projectId === undefined || inFlightRef.current) return;
      inFlightRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      setSnapshot((current) =>
        current.generation === generation ? { ...current, loading: true } : current,
      );
      // 每次窄读独立收口：目录读失败不再跳过目标任务的详情读取，
      // 失败按真实错误码与诊断引用呈现，不折成权限拒绝。
      const read = async <T,>(run: () => Promise<T>): Promise<AgentReadOutcome<T>> => {
        try {
          return { value: await run() };
        } catch (error) {
          if (controller.signal.aborted) return {};
          return { failure: agentReadFailureOf(error) };
        }
      };
      try {
        const listed = await read(() =>
          readAgentTaskList(
            projectId,
            {
              ...(filters.taskType === undefined ? {} : { taskType: filters.taskType }),
              ...(filters.status === undefined ? {} : { status: filters.status }),
              ...(filters.parentRunRef === undefined ? {} : { parentRunRef: filters.parentRunRef }),
            },
            controller.signal,
          ),
        );
        const selected = taskRef;
        const detailed: AgentReadOutcome<AgentTaskDetailView> =
          selected === undefined
            ? {}
            : await read(() => readAgentTaskDetail(projectId, selected, controller.signal));
        const selectedRef = detailed.value?.summary.agentTaskRef;
        const launched: AgentReadOutcome<AgentLaunchContextView> =
          selectedRef === undefined
            ? {}
            : await read(() => readAgentLaunchContext(projectId, selectedRef, controller.signal));
        // 代际不匹配说明工程已切换或会话已注销；中止的读同样不写回。
        if (generation !== generationRef.current || controller.signal.aborted) return;
        const failure = listed.failure ?? detailed.failure ?? launched.failure;
        const lastUpdatedAt = new Date().toISOString();
        if (failure !== undefined) {
          // 失败如实结束加载并保留已读到的事实；下一轮节拍或重试再读。
          setSnapshot((current) =>
            current.generation === generation
              ? {
                  ...current,
                  generation,
                  ...(listed.value === undefined ? {} : { list: listed.value }),
                  ...(detailed.value === undefined ? {} : { detail: detailed.value }),
                  ...(launched.value === undefined ? {} : { launchContext: launched.value }),
                  loading: false,
                  error: failure.code,
                  failure,
                  lastUpdatedAt,
                }
              : current,
          );
          return;
        }
        setSnapshot((current) =>
          current.generation === generation
            ? {
                generation,
                ...(selectedRef === undefined ? {} : { taskRef: selectedRef }),
                ...(listed.value === undefined ? {} : { list: listed.value }),
                ...(detailed.value === undefined ? {} : { detail: detailed.value }),
                ...(launched.value === undefined ? {} : { launchContext: launched.value }),
                loading: false,
                error: "",
                failure: undefined,
                lastUpdatedAt,
              }
            : current,
        );
      } finally {
        inFlightRef.current = false;
        if (abortRef.current === controller) abortRef.current = undefined;
      }
    },
    [allowed, props.projectId, filters.taskType, filters.status, filters.parentRunRef, taskRef],
  );

  // 单在途节拍刷新：上一轮结束（或超时）后才安排下一轮，慢读不会堆叠请求。
  useEffect(() => {
    if (!allowed || props.projectId === undefined) return undefined;
    const generation = generationRef.current;
    const tick = () => {
      void load(generation).finally(() => {
        if (generation !== generationRef.current) return;
        timerRef.current = setTimeout(tick, AGENT_TASK_REFRESH_INTERVAL_MS_V1);
      });
    };
    timerRef.current = setTimeout(tick, AGENT_TASK_REFRESH_INTERVAL_MS_V1);
    return () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };
  }, [allowed, load, props.projectId]);

  const value = useMemo<AgentTaskContextValue>(
    () => ({
      ...snapshot,
      allowed,
      setFilters: (next) => setFiltersState(next),
      openTask: (next) => setTaskRef(next),
      closeTask: () => setTaskRef(undefined),
      refreshNow: () => {
        void load(generationRef.current);
      },
    }),
    [allowed, snapshot, load],
  );

  return <AgentTaskContext.Provider value={value}>{props.children}</AgentTaskContext.Provider>;
}
