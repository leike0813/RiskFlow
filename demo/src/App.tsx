import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from 'react-router-dom'
import { ApiError } from './api/client'
import {
  EngineeringProvider,
  SessionProvider,
  selectorFromSearch,
  useSession,
  type EngineeringContextState,
  type SessionContextValue,
  type SessionState,
} from './api/context'
import { readEngineeringContext } from './api/operations'
import {
  changePassword as sessionChangePassword,
  currentSession,
  login as sessionLogin,
  logout as sessionLogout,
} from './api/session'

const RiskOverviewPage = lazy(() => import('./pages/RiskOverviewPage'))
const AgentWorkbenchPage = lazy(() => import('./pages/AgentWorkbenchPage'))
const IdentificationRunsPage = lazy(() => import('./pages/IdentificationRunsPage'))
const IdentificationRunPage = lazy(() => import('./pages/IdentificationRunPage'))
const RiskRecordListPage = lazy(() => import('./pages/RiskRecordListPage'))
const AssociationGraphPage = lazy(() => import('./pages/AssociationGraphPage'))
const ProcessModelPage = lazy(() => import('./pages/ProcessModelPage'))
const ProjectOverviewPage = lazy(() => import('./pages/ProjectOverviewPage'))
const DocumentListPage = lazy(() => import('./pages/DocumentListPage'))
const DocumentDetailPage = lazy(() => import('./pages/DocumentDetailPage'))
const MonitoringDetailPage = lazy(() => import('./pages/MonitoringDetailPage'))
const PendingAssessmentPage = lazy(() => import('./pages/PendingAssessmentPage'))
const StartAssessmentPage = lazy(() => import('./pages/StartAssessmentPage'))
const AssessmentRunPage = lazy(() => import('./pages/AssessmentRunPage'))
const AssessmentRecordsPage = lazy(() => import('./pages/AssessmentRecordsPage'))
const AssessmentRecordPage = lazy(() => import('./pages/AssessmentRecordPage'))
const AssessmentMatrixPage = lazy(() => import('./pages/AssessmentMatrixPage'))
const ReassessmentsPage = lazy(() => import('./pages/ReassessmentsPage'))
const WarningCenterPage = lazy(() => import('./pages/WarningCenterPage'))
const WarningDetailPage = lazy(() => import('./pages/WarningDetailPage'))
const ResponseTasksPage = lazy(() => import('./pages/ResponseTasksPage'))
const WarningTaskPage = lazy(() => import('./pages/WarningTaskPage'))
const RecommendationDetailPage = lazy(() => import('./pages/RecommendationDetailPage'))
const ExecutionRegisterPage = lazy(() => import('./pages/ExecutionRegisterPage'))
const PredictionDetailPage = lazy(() => import('./pages/PredictionDetailPage'))
const FeedbackDetailPage = lazy(() => import('./pages/FeedbackDetailPage'))
const CalibrationDetailPage = lazy(() => import('./pages/CalibrationDetailPage'))
const RiskDetailPage = lazy(() => import('./pages/RiskDetailPage'))
const MechanismLibraryPage = lazy(() => import('./pages/MechanismLibraryPage'))
const RuleSetsPage = lazy(() => import('./pages/RuleSetsPage'))
const RiskMatrixPage = lazy(() => import('./pages/RiskMatrixPage'))
const MeasureLibraryPage = lazy(() => import('./pages/MeasureLibraryPage'))
const RetrievalResultPage = lazy(() => import('./pages/RetrievalResultPage'))
const ReviewQueuePage = lazy(() => import('./pages/ReviewQueuePage'))
const EvidenceTracePage = lazy(() => import('./pages/EvidenceTracePage'))
const RunRecordsPage = lazy(() => import('./pages/RunRecordsPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))

/**
 * 会话门：恢复完成前不跳转、不装载业务页；确认为匿名才进登录页并保留原目标；
 * 受限会话先改密；恢复失败给出可重试入口，而不是伪装成未登录。
 */
function RequireSession({ children }: { children?: ReactNode }) {
  const { state, retryRestore } = useSession()
  const location = useLocation()
  if (state.kind === 'restoring' || state.kind === 'restore-failed') {
    return <SessionGateView failed={state.kind === 'restore-failed'} onRetry={retryRestore} />
  }
  if (state.kind === 'anonymous') {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  if (state.session.restricted) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/change-password?next=${encodeURIComponent(next)}`} replace />
  }
  return <>{children}</>
}

/** 恢复期与恢复失败：只呈现状态与重试，不显示任何业务内容。 */
function SessionGateView(props: { failed: boolean; onRetry: () => void }) {
  return (
    <div className="page">
      <h1>{props.failed ? '会话恢复失败' : '正在恢复会话'}</h1>
      <p>{props.failed ? '无法确认当前会话状态，请重试。' : '正在确认当前会话……'}</p>
      {props.failed ? (
        <button type="button" className="shell-switch-btn" onClick={props.onRetry}>
          重试
        </button>
      ) : null}
    </div>
  )
}

/** 恢复期 /login 同样先呈现检查状态，避免闪现登录表单。已认证且不受限时回到原目标。 */
function LoginRoute() {
  const { state, retryRestore } = useSession()
  const [searchParams] = useSearchParams()
  if (state.kind === 'restoring' || state.kind === 'restore-failed') {
    return <SessionGateView failed={state.kind === 'restore-failed'} onRetry={retryRestore} />
  }
  if (state.kind === 'authenticated' && !state.session.restricted) {
    const next = searchParams.get('next')
    return <Navigate to={next !== null && next.startsWith('/') ? next : '/'} replace />
  }
  return <LoginPage />
}

/** 改密路由：只在受限会话下可达，交给同一份认证表单处理改密模式。 */
function ChangePasswordRoute() {
  const { state, retryRestore } = useSession()
  const [searchParams] = useSearchParams()
  // 刷新改密页会先进入恢复期；改密成功后受限解除。两种情况都必须回到原目标，
  // 否则受限账号会在改密中途被甩到首页。
  if (state.kind === 'restoring' || state.kind === 'restore-failed') {
    return <SessionGateView failed={state.kind === 'restore-failed'} onRetry={retryRestore} />
  }
  if (state.kind === 'authenticated' && !state.session.restricted) {
    const next = searchParams.get('next')
    return <Navigate to={next !== null && next.startsWith('/') ? next : '/'} replace />
  }
  return <LoginPage mode="change-password" />
}

/** 工程上下文门：按 URL ?project=&revision= 选择器加载 context-read，切换即重建查询。 */
function EngineeringGate() {
  const [searchParams] = useSearchParams()
  const selector = useMemo(
    () => selectorFromSearch(`?${searchParams.toString()}`),
    [searchParams],
  )
  const [state, setState] = useState<EngineeringContextState>({ kind: 'idle' })
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (selector.projectId === null) {
      setState({ kind: 'idle' })
      return
    }
    const projectId = selector.projectId
    const controller = new AbortController()
    setState({ kind: 'loading' })
    readEngineeringContext(projectId, controller.signal)
      .then((value) => setState({ kind: 'ready', value }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (
          error instanceof ApiError &&
          (error.code === 'NOT_FOUND' || error.code === 'AUTHENTICATION_REQUIRED')
        ) {
          setState({ kind: 'forbidden' })
          return
        }
        setState({
          kind: 'error',
          code: error instanceof ApiError ? error.code : 'TERMINAL_FAILURE',
          retryable: error instanceof ApiError ? error.retryable : false,
        })
      })
    return () => controller.abort()
  }, [selector.projectId, selector.revisionId, reloadTick])

  const value = useMemo(
    () => ({ selector, state, reload: () => setReloadTick((tick) => tick + 1) }),
    [selector, state],
  )
  return (
    <EngineeringProvider value={value}>
      <Outlet />
    </EngineeringProvider>
  )
}

export default function App() {
  const [sessionState, setSessionState] = useState<SessionState>({ kind: 'restoring' })
  const [logoutFailed, setLogoutFailed] = useState(false)
  const [restoreTick, setRestoreTick] = useState(0)
  /**
   * 认证代次：每次登录、改密、注销或重试恢复都推进一次。
   * 迟到的旧响应携带更小的代次，直接丢弃——它恢复的会话已被更新的操作取代。
   */
  const generation = useRef(0)

  useEffect(() => {
    const current = (generation.current += 1)
    const controller = new AbortController()
    setSessionState({ kind: 'restoring' })
    currentSession(controller.signal)
      .then((session) => {
        if (current !== generation.current) return
        setSessionState(session === null ? { kind: 'anonymous' } : { kind: 'authenticated', session })
      })
      .catch(() => {
        if (current !== generation.current) return
        setSessionState({ kind: 'restore-failed' })
      })
    return () => controller.abort()
  }, [restoreTick])

  const sessionValue: SessionContextValue = useMemo(
    () => ({
      state: sessionState,
      logoutFailed,
      retryRestore: () => {
        setLogoutFailed(false)
        setRestoreTick((value) => value + 1)
      },
      login: async (loginName: string, password: string) => {
        const current = (generation.current += 1)
        const session = await sessionLogin({ loginName, password })
        if (current !== generation.current) return
        setLogoutFailed(false)
        setSessionState({ kind: 'authenticated', session })
      },
      changePassword: async (newPassword: string) => {
        const current = (generation.current += 1)
        const session = await sessionChangePassword({ newPassword })
        if (current !== generation.current) return
        setSessionState({ kind: 'authenticated', session })
      },
      logout: async () => {
        const current = (generation.current += 1)
        try {
          await sessionLogout()
        } catch {
          // 注销失败保持原会话并允许重试：只有成功注销才进入匿名。
          if (current === generation.current) setLogoutFailed(true)
          return
        }
        if (current !== generation.current) return
        setLogoutFailed(false)
        setSessionState({ kind: 'anonymous' })
      },
    }),
    [sessionState, logoutFailed],
  )

  return (
    <SessionProvider value={sessionValue}>
      <Suspense fallback={<div className="page" />}>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/change-password" element={<ChangePasswordRoute />} />
          <Route
            element={
              <RequireSession>
                <EngineeringGate />
              </RequireSession>
            }
          >
            <Route path="/" element={<RiskOverviewPage />} />
            <Route path="/overview" element={<RiskOverviewPage />} />
            <Route path="/agent" element={<AgentWorkbenchPage />} />

            <Route path="/identification" element={<IdentificationRunsPage />} />
            <Route path="/identification/runs/:runId" element={<IdentificationRunPage />} />
            <Route path="/identification/records" element={<RiskRecordListPage />} />
            <Route path="/identification/records/:recordId" element={<RiskDetailPage />} />
            <Route path="/identification/graph" element={<AssociationGraphPage />} />
            <Route path="/identification/process-model" element={<ProcessModelPage />} />

            <Route path="/project" element={<ProjectOverviewPage />} />
            <Route path="/project/documents" element={<DocumentListPage />} />
            <Route path="/project/documents/:docId" element={<DocumentDetailPage />} />
            <Route path="/project/monitoring" element={<MonitoringDetailPage />} />
            <Route path="/project/monitoring/:seriesId" element={<MonitoringDetailPage />} />

            <Route path="/assessment" element={<PendingAssessmentPage />} />
            <Route path="/assessment/start" element={<StartAssessmentPage />} />
            <Route path="/assessment/runs/:runId" element={<AssessmentRunPage />} />
            <Route path="/assessment/records" element={<AssessmentRecordsPage />} />
            <Route path="/assessment/records/:recordId" element={<AssessmentRecordPage />} />
            <Route path="/assessment/matrix" element={<AssessmentMatrixPage />} />
            <Route path="/assessment/reassessments" element={<ReassessmentsPage />} />

            {/* 静态 tasks 路由必须先于 :warningId，否则 /warnings/tasks 会被当作预警标识。 */}
            <Route path="/warnings" element={<WarningCenterPage />} />
            <Route path="/warnings/tasks" element={<ResponseTasksPage />} />
            <Route path="/warnings/tasks/:taskId" element={<WarningTaskPage />} />
            <Route path="/warnings/:warningId" element={<WarningDetailPage />} />

            <Route
              path="/response/recommendations/:recommendationId"
              element={<RecommendationDetailPage />}
            />
            <Route path="/response/executions/register" element={<ExecutionRegisterPage />} />
            <Route path="/response/predictions/:predictionId" element={<PredictionDetailPage />} />
            <Route path="/response/feedback/:feedbackId" element={<FeedbackDetailPage />} />
            <Route path="/response/calibrations/:suggestionId" element={<CalibrationDetailPage />} />

            <Route path="/knowledge" element={<Navigate to="/knowledge/mechanisms" replace />} />
            <Route path="/knowledge/mechanisms" element={<MechanismLibraryPage />} />
            <Route path="/knowledge/rules" element={<RuleSetsPage />} />
            <Route path="/knowledge/matrix" element={<RiskMatrixPage />} />
            <Route path="/knowledge/measures" element={<MeasureLibraryPage />} />
            <Route path="/knowledge/retrieval-result" element={<RetrievalResultPage />} />

            <Route path="/review" element={<ReviewQueuePage />} />
            <Route path="/review/trace" element={<EvidenceTracePage />} />
            <Route path="/review/runs" element={<RunRecordsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </SessionProvider>
  )
}
