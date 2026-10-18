// PROTOTYPE · THROWAWAY — 票 05 页面注册表。PAGES 的 key 必须与 Shell.NAV 的 key 对齐
// （NAV 是六项一级导航，键：overview/engineering/identification/assessment/response/governance）。
// 各页组件从 ./pages/<Name> 导入，由并行 Agent 按 PAGE_CONTRACT.md 产出。

import type { ComponentType } from 'react';
import { OverviewPage } from './OverviewPage';
import { EngineeringOverviewPage } from './EngineeringOverviewPage';
import { DocumentListPage } from './DocumentListPage';
import { DocumentDetailPage } from './DocumentDetailPage';
import { MonitoringSeriesPage } from './MonitoringSeriesPage';
import { MonitoringSeriesDetailPage } from './MonitoringSeriesDetailPage';
import { IdentificationRunListPage } from './IdentificationRunListPage';
import { IdentificationRunDetailPage } from './IdentificationRunDetailPage';
import { RiskRecordListPage } from './RiskRecordListPage';
import { RiskRecordDetailPage } from './RiskRecordDetailPage';
import { AssociationGraphPage } from './AssociationGraphPage';
import { ProcessModelPage } from './ProcessModelPage';
import { PendingAssessmentPage } from './PendingAssessmentPage';
import { AssessmentRecordListPage } from './AssessmentRecordListPage';
import { AssessmentRecordDetailPage } from './AssessmentRecordDetailPage';
import { AssessmentMatrixPage } from './AssessmentMatrixPage';
import { WarningCenterPage } from './WarningCenterPage';
import { WarningDetailPage } from './WarningDetailPage';
import { ResponseTaskListPage } from './ResponseTaskListPage';
import { ResponseTaskDetailPage } from './ResponseTaskDetailPage';
import { MechanismLibraryPage } from './MechanismLibraryPage';
import { RuleSetPage } from './RuleSetPage';
import { IndicatorSystemPage } from './IndicatorSystemPage';
import { MeasureLibraryPage } from './MeasureLibraryPage';
import { GovernanceRiskMatrixPage } from './GovernanceRiskMatrixPage';
import { AuditLogPage } from './AuditLogPage';
import { ShortcutsPage } from './ShortcutsPage';

export type PrototypePageKey =
  | 'overview'
  | 'engineering'
  | 'identification'
  | 'assessment'
  | 'response'
  | 'governance'
  | 'documentList'
  | 'documentDetail'
  | 'monitoringList'
  | 'monitoringDetail'
  | 'idRunList'
  | 'idRunDetail'
  | 'riskRecordList'
  | 'riskRecordDetail'
  | 'graph'
  | 'processModel'
  | 'pendingAssessment'
  | 'assessmentList'
  | 'assessmentDetail'
  | 'assessmentMatrix'
  | 'warningCenter'
  | 'warningDetail'
  | 'responseTaskList'
  | 'responseTaskDetail'
  | 'mechanism'
  | 'ruleSet'
  | 'indicatorSystem'
  | 'measure'
  | 'governanceMatrix'
  | 'auditLog';

export const PAGES: Readonly<Record<string, ComponentType>> = {
  overview: OverviewPage,
  engineering: EngineeringOverviewPage,
  documentList: DocumentListPage,
  documentDetail: DocumentDetailPage,
  monitoringList: MonitoringSeriesPage,
  monitoringDetail: MonitoringSeriesDetailPage,
  idRunList: IdentificationRunListPage,
  idRunDetail: IdentificationRunDetailPage,
  riskRecordList: RiskRecordListPage,
  riskRecordDetail: RiskRecordDetailPage,
  graph: AssociationGraphPage,
  processModel: ProcessModelPage,
  pendingAssessment: PendingAssessmentPage,
  assessmentList: AssessmentRecordListPage,
  assessmentDetail: AssessmentRecordDetailPage,
  assessmentMatrix: AssessmentMatrixPage,
  warningCenter: WarningCenterPage,
  warningDetail: WarningDetailPage,
  responseTaskList: ResponseTaskListPage,
  responseTaskDetail: ResponseTaskDetailPage,
  mechanism: MechanismLibraryPage,
  ruleSet: RuleSetPage,
  indicatorSystem: IndicatorSystemPage,
  measure: MeasureLibraryPage,
  governanceMatrix: GovernanceRiskMatrixPage,
  auditLog: AuditLogPage,
  // 快捷键面板不在一级导航内，Shell 用 __shortcuts 触发
  __shortcuts: ShortcutsPage,
};

/** 首屏落点 */
export const INDEX_PAGE = { tab: 'overview' as const };

/**
 * 一级导航 → 落地页。NAV 的键是六个一级导航，PAGES 的键是叶子页，两者不同域，
 * 没有这张映射的话六个导航里有四个点不动。
 */
export const NAV_LANDING: Readonly<Record<string, string>> = {
  overview: 'overview',
  engineering: 'engineering',
  identification: 'idRunList',
  assessment: 'assessmentList',
  response: 'responseTaskList',
  governance: 'mechanism',
};
