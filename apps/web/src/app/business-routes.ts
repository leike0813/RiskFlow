import { createElement, lazy, type ComponentType, type ReactNode } from "react";

import {
  createWebRouteRegistry,
  type WebRouteContributionV1,
  type WebRouteRegistryV1,
} from "./routes.js";
import type { ModuleCapabilityV1 } from "@riskflow/contracts/ports";

/**
 * C37 D-17：完整业务界面的生产路由注册表。
 *
 * 这是 C32–C35 全部页面在 `apps/web` 中的**唯一**可达路径：
 * 每条路由都对应真实服务读，主导航仍只有七项；Agent 与系统管理从辅助入口进入。
 * 页面按需加载，避免一次性把全部业务界面打进首屏。
 */

/**
 * C37 D-17：业务路由不声明客户端侧 `requiredViewCapability`。
 *
 * 会话自省只返回会话元数据，不携带能力清单；客户端无从判断时把页面卡在
 * 「权限检查中」是假事实。授权由服务端在每条查询上判定，页面据此呈现
 * 无权/不存在同形状态。若将来会话确实返回能力清单，再逐条回填此字段。
 */
interface BusinessRouteSeedV1 {
  /** 稳定路由标识：与路径解耦，便于验收逐条核对，且必须匹配路由 id 安全规则。 */
  readonly routeId: string;
  readonly path: string;
  readonly title: string;
  readonly section: WebRouteContributionV1["section"];
  readonly shellKind: WebRouteContributionV1["shellKind"];
  readonly contextRequirement: WebRouteContributionV1["contextRequirement"];
  readonly requiredViewCapability: ModuleCapabilityV1 | null;
  readonly load: () => Promise<{ default: ComponentType }>;
}

/**
 * 路由元数据。`render` 使用懒加载包装，真实组件在悬停/导航时才下载。
 */
const BUSINESS_ROUTE_SEEDS_V1 = Object.freeze<BusinessRouteSeedV1[]>([
  // 会话门禁：登录与首次改密共用同一份表单，仍经唯一 C09 客户端与 Cookie 会话。
  {
    routeId: "session.login",
    path: "/login",
    title: "登录",
    section: null,
    shellKind: "custom",
    contextRequirement: "none",
    requiredViewCapability: null,
    load: () => import("../pages/LoginPage.js"),
  },
  {
    routeId: "session.change-password",
    path: "/change-password",
    title: "修改密码",
    section: null,
    shellKind: "custom",
    contextRequirement: "none",
    requiredViewCapability: null,
    load: () => import("../pages/ChangePasswordPage.js"),
  },

  // 概览与工程
  {
    routeId: "overview.root",
    path: "/overview",
    title: "风险态势",
    section: "overview",
    shellKind: "detail",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/RiskOverviewPage.js"),
  },
  {
    routeId: "projects.root",
    path: "/projects",
    title: "工程项目",
    section: "projects",
    shellKind: "detail",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/ProjectOverviewPage.js"),
  },
  {
    routeId: "business.projects.documents",
    path: "/projects/documents",
    title: "工程资料",
    section: "projects",
    shellKind: "list",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/DocumentListPage.js"),
  },
  {
    routeId: "business.projects.documentsparam",
    path: "/projects/documents/:docId",
    title: "资料详情",
    section: "projects",
    shellKind: "detail",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/DocumentDetailPage.js"),
  },
  {
    routeId: "business.projects.monitoring",
    path: "/projects/monitoring",
    title: "监测数据",
    section: "projects",
    shellKind: "list",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/MonitoringDetailPage.js"),
  },
  {
    routeId: "business.projects.monitoringparam",
    path: "/projects/monitoring/:seriesId",
    title: "监测序列",
    section: "projects",
    shellKind: "detail",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/MonitoringDetailPage.js"),
  },

  // 风险识别
  {
    routeId: "identification.root",
    path: "/identification",
    title: "识别运行",
    section: "identification",
    shellKind: "list",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/IdentificationRunsPage.js"),
  },
  {
    routeId: "business.identification.runsparam",
    path: "/identification/runs/:runId",
    title: "识别运行详情",
    section: "identification",
    shellKind: "run",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/IdentificationRunPage.js"),
  },
  {
    routeId: "business.identification.records",
    path: "/identification/records",
    title: "风险记录",
    section: "identification",
    shellKind: "list",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/RiskRecordListPage.js"),
  },
  {
    routeId: "business.identification.recordsparam",
    path: "/identification/records/:recordId",
    title: "风险记录详情",
    section: "identification",
    shellKind: "detail",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/RiskDetailPage.js"),
  },
  {
    routeId: "business.identification.graph",
    path: "/identification/graph",
    title: "关联图谱",
    section: "identification",
    shellKind: "detail",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/AssociationGraphPage.js"),
  },
  {
    routeId: "business.identification.process.model",
    path: "/identification/process-model",
    title: "工序模型",
    section: "identification",
    shellKind: "governance",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/ProcessModelPage.js"),
  },

  // 风险评估
  {
    routeId: "assessment.root",
    path: "/assessment",
    title: "待评估",
    section: "assessment",
    shellKind: "list",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/PendingAssessmentPage.js"),
  },
  {
    routeId: "business.assessment.start",
    path: "/assessment/start",
    title: "发起评估",
    section: "assessment",
    shellKind: "run",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/StartAssessmentPage.js"),
  },
  {
    routeId: "business.assessment.runsparam",
    path: "/assessment/runs/:runId",
    title: "评估运行",
    section: "assessment",
    shellKind: "run",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/AssessmentRunPage.js"),
  },
  {
    routeId: "business.assessment.records",
    path: "/assessment/records",
    title: "评估记录",
    section: "assessment",
    shellKind: "list",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/AssessmentRecordsPage.js"),
  },
  {
    routeId: "business.assessment.recordsparam",
    path: "/assessment/records/:recordId",
    title: "评估记录详情",
    section: "assessment",
    shellKind: "detail",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/AssessmentRecordPage.js"),
  },
  {
    routeId: "business.assessment.matrix",
    path: "/assessment/matrix",
    title: "风险矩阵",
    section: "assessment",
    shellKind: "governance",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/AssessmentMatrixPage.js"),
  },
  {
    routeId: "business.assessment.reassessments",
    path: "/assessment/reassessments",
    title: "重评估",
    section: "assessment",
    shellKind: "list",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/ReassessmentsPage.js"),
  },

  // 预警与处置
  {
    routeId: "warnings.root",
    path: "/warnings",
    title: "预警中心",
    section: "warnings",
    shellKind: "list",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/WarningCenterPage.js"),
  },
  {
    routeId: "business.warnings.tasks",
    path: "/warnings/tasks",
    title: "处置任务",
    section: "warnings",
    shellKind: "list",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/ResponseTasksPage.js"),
  },
  {
    routeId: "business.warnings.tasksparam",
    path: "/warnings/tasks/:taskId",
    title: "处置任务详情",
    section: "warnings",
    shellKind: "detail",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/WarningTaskPage.js"),
  },
  {
    routeId: "business.warningsparam",
    path: "/warnings/:warningId",
    title: "预警详情",
    section: "warnings",
    shellKind: "detail",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/WarningDetailPage.js"),
  },
  {
    routeId: "business.response.recommendationsparam",
    path: "/response/recommendations/:recommendationId",
    title: "处置建议",
    section: "warnings",
    shellKind: "detail",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/RecommendationDetailPage.js"),
  },
  {
    routeId: "business.response.executions.register",
    path: "/response/executions/register",
    title: "执行登记",
    section: "warnings",
    shellKind: "list",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/ExecutionRegisterPage.js"),
  },
  {
    routeId: "business.response.predictionsparam",
    path: "/response/predictions/:predictionId",
    title: "效果预测",
    section: "warnings",
    shellKind: "detail",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/PredictionDetailPage.js"),
  },
  {
    routeId: "business.response.feedbackparam",
    path: "/response/feedback/:feedbackId",
    title: "执行反馈",
    section: "warnings",
    shellKind: "detail",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/FeedbackDetailPage.js"),
  },
  {
    routeId: "business.response.calibrationsparam",
    path: "/response/calibrations/:suggestionId",
    title: "偏差校准",
    section: "warnings",
    shellKind: "detail",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/CalibrationDetailPage.js"),
  },

  // 知识治理
  {
    routeId: "business.knowledge.mechanisms",
    path: "/knowledge/mechanisms",
    title: "机理库",
    section: "knowledge",
    shellKind: "governance",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/MechanismLibraryPage.js"),
  },
  {
    routeId: "business.knowledge.rules",
    path: "/knowledge/rules",
    title: "规则集",
    section: "knowledge",
    shellKind: "governance",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/RuleSetsPage.js"),
  },
  {
    routeId: "business.knowledge.matrix",
    path: "/knowledge/matrix",
    title: "风险矩阵定义",
    section: "knowledge",
    shellKind: "governance",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/RiskMatrixPage.js"),
  },
  {
    routeId: "business.knowledge.measures",
    path: "/knowledge/measures",
    title: "指标库",
    section: "knowledge",
    shellKind: "governance",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/MeasureLibraryPage.js"),
  },
  {
    routeId: "business.knowledge.retrieval.result",
    path: "/knowledge/retrieval-result",
    title: "检索结果",
    section: "knowledge",
    shellKind: "detail",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/RetrievalResultPage.js"),
  },

  // 复核与审计
  {
    routeId: "review-audit.root",
    path: "/review-audit",
    title: "复核队列",
    section: "reviews",
    shellKind: "review",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/ReviewQueuePage.js"),
  },
  {
    routeId: "business.review.audit.tasksparam",
    path: "/review-audit/tasks/:taskId",
    title: "复核详情",
    section: "reviews",
    shellKind: "review",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/ReviewDetailPage.js"),
  },
  {
    routeId: "business.review.audit.identificationparam",
    path: "/review-audit/identification/:taskId",
    title: "识别复核",
    section: "reviews",
    shellKind: "review",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/IdentificationReviewPage.js"),
  },
  {
    routeId: "business.review.audit.audit",
    path: "/review-audit/audit",
    title: "审计日志",
    section: "reviews",
    shellKind: "list",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/AuditLogPage.js"),
  },
  {
    routeId: "business.review.audit.trace",
    path: "/review-audit/trace",
    title: "证据追溯",
    section: "reviews",
    shellKind: "detail",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/EvidenceTracePage.js"),
  },
  {
    routeId: "business.review.audit.runs",
    path: "/review-audit/runs",
    title: "运行记录",
    section: "reviews",
    shellKind: "list",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/RunRecordsPage.js"),
  },
  {
    routeId: "business.report.export",
    path: "/report/export",
    title: "报告导出",
    section: "reviews",
    shellKind: "list",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/ReportExportPage.js"),
  },

  // Agent 工作台（辅助入口，不占主导航）
  {
    routeId: "business.agent",
    path: "/agent",
    title: "Agent 工作台",
    section: null,
    shellKind: "run",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/AgentWorkbenchPage.js"),
  },
  {
    routeId: "business.agent.tasksparam",
    path: "/agent/tasks/:taskId",
    title: "Agent 任务详情",
    section: null,
    shellKind: "detail",
    contextRequirement: "project",
    requiredViewCapability: null,
    load: () => import("../pages/AgentTaskDetailPage.js"),
  },

  // 系统管理（辅助入口，不占主导航）
  {
    routeId: "business.ops.access",
    path: "/ops/access",
    title: "账号与权限",
    section: null,
    shellKind: "list",
    contextRequirement: "none",
    requiredViewCapability: null,
    load: () => import("../pages/ops/AccessPage.js"),
  },
  {
    routeId: "business.ops.data.sources",
    path: "/ops/data-sources",
    title: "数据来源",
    section: null,
    shellKind: "list",
    contextRequirement: "none",
    requiredViewCapability: null,
    load: () => import("../pages/ops/DataSourcesPage.js"),
  },
  {
    routeId: "business.ops.health",
    path: "/ops/health",
    title: "系统健康",
    section: null,
    shellKind: "list",
    contextRequirement: "none",
    requiredViewCapability: null,
    load: () => import("../pages/ops/HealthPage.js"),
  },
  {
    routeId: "business.ops.model.versions",
    path: "/ops/model-versions",
    title: "模型版本",
    section: null,
    shellKind: "list",
    contextRequirement: "none",
    requiredViewCapability: null,
    load: () => import("../pages/ops/ModelVersionsPage.js"),
  },
  {
    routeId: "business.ops.backup",
    path: "/ops/backup",
    title: "备份",
    section: null,
    shellKind: "list",
    contextRequirement: "none",
    requiredViewCapability: null,
    load: () => import("../pages/ops/BackupPage.js"),
  },
]);

/** 已登记的业务路由路径；用于验收核对深链覆盖。 */
export const BUSINESS_ROUTE_PATHS_V1: readonly string[] = Object.freeze(
  BUSINESS_ROUTE_SEEDS_V1.map((seed) => seed.path),
);

const lazyRoutes = BUSINESS_ROUTE_SEEDS_V1.map((seed): WebRouteContributionV1 => {
  const Component = lazy(seed.load);
  return Object.freeze({
    routeId: seed.routeId,
    path: seed.path,
    title: seed.title,
    section: seed.section,
    shellKind: seed.shellKind,
    contextRequirement: seed.contextRequirement,
    requiredViewCapability: seed.requiredViewCapability,
    render: (): ReactNode => createElement(Component),
  });
});

/**
 * 业务路由注册表：base 七项 + 全部业务页面。
 * `/assessment/quality` 由 C36 质量 contribution 另行注册，不在此重复。
 */
export const createBusinessRouteRegistryV1 = (
  extra: readonly WebRouteContributionV1[] = [],
): WebRouteRegistryV1 => createWebRouteRegistry([...lazyRoutes, ...extra]);

export const BUSINESS_ROUTE_REGISTRY_V1 = createBusinessRouteRegistryV1();
