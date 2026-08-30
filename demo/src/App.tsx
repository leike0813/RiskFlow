import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

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
const ReviewQueuePage = lazy(() => import('./pages/ReviewQueuePage'))
const EvidenceTracePage = lazy(() => import('./pages/EvidenceTracePage'))
const RunRecordsPage = lazy(() => import('./pages/RunRecordsPage'))

export default function App() {
  return (
    <Suspense fallback={<div className="page" />}>
      <Routes>
        <Route path="/" element={<RiskOverviewPage />} />
        <Route path="/agent" element={<AgentWorkbenchPage />} />

        <Route path="/identification" element={<IdentificationRunsPage />} />
        <Route path="/identification/runs/RUN-20260827-001" element={<IdentificationRunPage />} />
        <Route path="/identification/records" element={<RiskRecordListPage />} />
        <Route path="/identification/graph" element={<AssociationGraphPage />} />
        <Route path="/identification/process-model" element={<ProcessModelPage />} />

        <Route path="/project" element={<ProjectOverviewPage />} />
        <Route path="/project/documents" element={<DocumentListPage />} />
        <Route path="/project/documents/:docId" element={<DocumentDetailPage />} />
        <Route path="/project/monitoring/:seriesId" element={<MonitoringDetailPage />} />

        <Route path="/assessment" element={<PendingAssessmentPage />} />
        <Route path="/assessment/records" element={<AssessmentRecordsPage />} />
        <Route path="/assessment/records/ASSESS-2026-001" element={<AssessmentRecordPage />} />

        <Route path="/warnings" element={<WarningCenterPage />} />
        <Route path="/warnings/WARN-2026-001" element={<WarningDetailPage />} />
        <Route path="/warnings/tasks" element={<ResponseTasksPage />} />

        <Route path="/risks/RISK-2026-001" element={<RiskDetailPage />} />

        <Route path="/knowledge" element={<Navigate to="/knowledge/mechanisms" replace />} />
        <Route path="/knowledge/mechanisms" element={<MechanismLibraryPage />} />
        <Route path="/knowledge/rules" element={<RuleSetsPage />} />
        <Route path="/knowledge/matrix" element={<RiskMatrixPage />} />
        <Route path="/knowledge/measures" element={<MeasureLibraryPage />} />

        <Route path="/review" element={<ReviewQueuePage />} />
        <Route path="/review/trace" element={<EvidenceTracePage />} />
        <Route path="/review/runs" element={<RunRecordsPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
