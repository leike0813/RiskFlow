import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
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
import { login as sessionLogin, logout as sessionLogout } from './api/session'

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
const AssessmentRecordsPage = lazy(() => import('./pages/AssessmentRecordsPage'))
const AssessmentRecordPage = lazy(() => import('./pages/AssessmentRecordPage'))
const WarningCenterPage = lazy(() => import('./pages/WarningCenterPage'))
const WarningDetailPage = lazy(() => import('./pages/WarningDetailPage'))
const ResponseTasksPage = lazy(() => import('./pages/ResponseTasksPage'))
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

/** 会话门：未认证访问业务页一律跳转登录页，登录后回到原目标页。 */
function RequireSession({ children }: { children?: ReactNode }) {
  const { state } = useSession()
  const location = useLocation()
  if (state.kind !== 'authenticated') {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  return <>{children}</>
}

/** 已认证用户访问 /login 时回到原目标或首页。 */
function LoginRoute() {
  const { state } = useSession()
  const [searchParams] = useSearchParams()
  if (state.kind === 'authenticated') {
    const next = searchParams.get('next')
    return <Navigate to={next !== null && next.startsWith('/') ? next : '/'} replace />
  }
  return <LoginPage />
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
  const [sessionState, setSessionState] = useState<SessionState>({ kind: 'anonymous' })
  const sessionValue: SessionContextValue = useMemo(
    () => ({
      state: sessionState,
      login: async (loginName: string, password: string) => {
        const session = await sessionLogin({ loginName, password })
        setSessionState({ kind: 'authenticated', session })
      },
      logout: async () => {
        await sessionLogout().catch(() => undefined)
        setSessionState({ kind: 'anonymous' })
      },
    }),
    [sessionState],
  )

  return (
    <SessionProvider value={sessionValue}>
      <Suspense fallback={<div className="page" />}>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            element={
              <RequireSession>
                <EngineeringGate />
              </RequireSession>
            }
          >
            <Route path="/" element={<RiskOverviewPage />} />
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
            <Route path="/assessment/records" element={<AssessmentRecordsPage />} />
            <Route path="/assessment/records/ASSESS-2026-001" element={<AssessmentRecordPage />} />

            <Route path="/warnings" element={<WarningCenterPage />} />
            <Route path="/warnings/WARN-2026-001" element={<WarningDetailPage />} />
            <Route path="/warnings/tasks" element={<ResponseTasksPage />} />

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
