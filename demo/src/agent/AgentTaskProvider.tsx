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
} from 'react'

import {
  readAgentTaskDetail,
  readAgentLaunchContext,
  readAgentTaskList,
  type AgentLaunchContextView,
  type AgentTaskDetailView,
  type AgentTaskListView,
  type AgentTaskRefView,
  type KindRef,
} from '../api/agentAuditOperations'

/** 单在途刷新的节拍；慢读期间不会堆积请求。 */
export const AGENT_TASK_REFRESH_INTERVAL_MS_V1 = 5_000

export interface AgentTaskFilters {
  readonly taskType?: string
  readonly status?: string
  readonly parentRunRef?: KindRef
}

export interface AgentTaskSnapshot {
  /** 当前代际：工程切换或注销会自增，旧响应因此无法回写。 */
  readonly generation: number
  readonly taskRef?: AgentTaskRefView
  readonly list?: AgentTaskListView
  readonly detail?: AgentTaskDetailView
  readonly launchContext?: AgentLaunchContextView
  readonly loading: boolean
  readonly error?: string
  readonly lastUpdatedAt?: string
}

export interface AgentTaskContextValue extends AgentTaskSnapshot {
  setFilters: (next: AgentTaskFilters) => void
  openTask: (taskRef: AgentTaskRefView) => void
  closeTask: () => void
  refreshNow: () => void
}

const EMPTY_SNAPSHOT: AgentTaskSnapshot = { generation: 0, loading: false }

const AgentTaskContext = createContext<AgentTaskContextValue | null>(null)

export function useAgentTask(): AgentTaskContextValue {
  const value = useContext(AgentTaskContext)
  if (value === null) throw new Error('AgentTaskProvider is missing')
  return value
}

export function AgentTaskProvider(props: {
  readonly projectId?: string
  readonly children: ReactNode
}): JSX.Element {
  const [snapshot, setSnapshot] = useState<AgentTaskSnapshot>(EMPTY_SNAPSHOT)
  const [filters, setFiltersState] = useState<AgentTaskFilters>({})
  const [taskRef, setTaskRef] = useState<AgentTaskRefView | undefined>(undefined)

  // 代际、计时器与在途请求都放在 ref：切工程/注销时先自增代际并中止，
  // 任何在途响应回来时对不上代际就直接丢弃。
  const generationRef = useRef(0)
  const inFlightRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const abortRef = useRef<AbortController | undefined>(undefined)

  const clearPending = useCallback(() => {
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = undefined
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
  }, [])

  // 工程切换或注销：先清内容，再取消在途与计时。
  useEffect(() => {
    clearPending()
    setSnapshot(EMPTY_SNAPSHOT)
    setTaskRef(undefined)
    setFiltersState({})
  }, [props.projectId, clearPending])

  useEffect(() => () => clearPending(), [clearPending])

  const load = useCallback(
    async (generation: number) => {
      const projectId = props.projectId
      if (projectId === undefined || inFlightRef.current) return
      inFlightRef.current = true
      const controller = new AbortController()
      abortRef.current = controller
      setSnapshot((current) =>
        current.generation === generation ? { ...current, loading: true } : current,
      )
      try {
        const list = await readAgentTaskList(
          projectId,
          {
            ...(filters.taskType === undefined ? {} : { taskType: filters.taskType }),
            ...(filters.status === undefined ? {} : { status: filters.status }),
            ...(filters.parentRunRef === undefined ? {} : { parentRunRef: filters.parentRunRef }),
          },
          controller.signal,
        )
        const selected = taskRef
        const detail = selected === undefined ? undefined : await readAgentTaskDetail(projectId, selected, controller.signal)
        const launchContext =
          selected === undefined
            ? undefined
            : await readAgentLaunchContext(projectId, selected, controller.signal)
        // 代际不匹配说明工程已切换或会话已注销：迟到响应一律丢弃。
        if (generation !== generationRef.current) return
        setSnapshot((current) =>
          current.generation === generation
            ? {
                generation,
                ...(taskRef === undefined ? {} : { taskRef }),
                list,
                ...(detail === undefined ? {} : { detail }),
                ...(launchContext === undefined ? {} : { launchContext }),
                loading: false,
                error: undefined,
                lastUpdatedAt: new Date().toISOString(),
              }
            : current,
        )
      } catch (error) {
        if (generation !== generationRef.current) return
        setSnapshot((current) =>
          current.generation === generation
            ? {
                ...current,
                generation,
                loading: false,
                error: error instanceof Error ? error.message : 'read-failed',
                lastUpdatedAt: new Date().toISOString(),
              }
            : current,
        )
      } finally {
        inFlightRef.current = false
        if (abortRef.current === controller) abortRef.current = undefined
      }
    },
    [props.projectId, filters.taskType, filters.status, filters.parentRunRef, taskRef],
  )

  // 单在途节拍刷新：上一轮结束（或超时）后才安排下一轮，慢读不会堆叠请求。
  useEffect(() => {
    if (props.projectId === undefined) return undefined
    const generation = generationRef.current
    const tick = () => {
      void load(generation).finally(() => {
        if (generation !== generationRef.current) return
        timerRef.current = setTimeout(tick, AGENT_TASK_REFRESH_INTERVAL_MS_V1)
      })
    }
    timerRef.current = setTimeout(tick, AGENT_TASK_REFRESH_INTERVAL_MS_V1)
    return () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
    }
  }, [load, props.projectId])

  const value = useMemo<AgentTaskContextValue>(
    () => ({
      ...snapshot,
      setFilters: (next) => setFiltersState(next),
      openTask: (next) => setTaskRef(next),
      closeTask: () => setTaskRef(undefined),
      refreshNow: () => {
        void load(generationRef.current)
      },
    }),
    [snapshot, load],
  )

  return <AgentTaskContext.Provider value={value}>{props.children}</AgentTaskContext.Provider>
}