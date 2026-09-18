// 报告导出 fixture（P-AU-01，C34/C35 待定）。
// 字段形状以 packages/contracts 为准：
// - 导出请求：ports/index.ts:1833-1843 ProjectionExportRequestV1（querySchema 'export'，
//   payload 为 sourceRef（query-result 或任意命名引用）+ exportPolicyRef）；
// - 导出成功结果：ports/index.ts:2304-2307（exportArtifactRef，export-artifact 版本引用）；
// - 版本引用 / 命名引用：common/index.ts VersionReferenceSchema。
// 报告范围（时间窗 / 章节组成）与导出产物清单在契约 payload 中无对应字段，
// 导出历史无记录 schema，均见 docs/gap-inbox/report.md。
// 版本引用清单从既有域 fixture 的事实源导入（识别依据 / 评估依据），不复制版本号。

import {
  ASSESSMENT_BASIS_VERSIONS,
  BASIS_VERSION_LABELS,
  type VersionRef,
} from './assessment';
import {
  IDENTIFICATION_BASIS_LABELS,
  IDENTIFICATION_BASIS_VERSIONS,
} from './identification';
import { REVIEW_POLICY_REF } from './review';

/** 命名引用（对齐 ContractReferenceV1 的通用形状：kind + 版本引用）。 */
export interface ContractRef {
  readonly kind: string;
  readonly reference: VersionRef;
}

// ---------------------------------------------------------------------------
// 报告范围：章节组成与时间窗（fixture 即页面默认值）
// ---------------------------------------------------------------------------

export const REPORT_SECTIONS = [
  { id: 'identification', label: '识别结果', hint: '标准化风险记录与证据链' },
  { id: 'assessment', label: '评估记录', hint: 'P/C 评分、矩阵落点与适用性快照' },
  { id: 'warning-response', label: '预警与处置', hint: '预警触发、处置任务与执行反馈' },
  { id: 'audit', label: '审计摘要', hint: '复核决定、版本发布与授权审计条目' },
] as const;

export type ReportSectionId = (typeof REPORT_SECTIONS)[number]['id'];

export const DEFAULT_REPORT_WINDOW = {
  from: '2026-08-01',
  to: '2026-09-18',
} as const;

/** 导出策略版本（exportPolicyRef，对齐 ProjectionExportRequestV1 payload）。 */
export const EXPORT_POLICY_REF: VersionRef = { entityId: 'EXP-POLICY-001', versionId: 'v2026.08' };

/** 报告数据来源：风险态势查询结果引用（risk-overview 投影的 queryResultRef）。 */
export const REPORT_SOURCE_REF: ContractRef = {
  kind: 'query-result',
  reference: { entityId: 'QR-RISK-OVERVIEW-20260918', versionId: 'v1' },
};

// ---------------------------------------------------------------------------
// 导出格式与产物清单（导出即一等公民：系统内生成导出工件，不经浏览器打印）
// ---------------------------------------------------------------------------

export const EXPORT_FORMATS = [
  {
    id: 'pdf',
    label: 'PDF 报告',
    description: '定稿版式，适合评审与归档',
    artifactHint: '正文 PDF × 1',
  },
  {
    id: 'docx',
    label: 'DOCX 可编辑稿',
    description: '供甲方批注与二次编辑',
    artifactHint: '正文 DOCX × 1',
  },
  {
    id: 'json',
    label: '数据快照 JSON',
    description: '结构化数据与版本引用，供第三方重放',
    artifactHint: '数据快照 JSON × 1 + 追溯清单 × 1',
  },
] as const;

export type ExportFormatId = (typeof EXPORT_FORMATS)[number]['id'];

// ---------------------------------------------------------------------------
// 版本引用清单预览：报告所引规则 / 矩阵 / 权重 / 阈值版本（不可变快照语义）
// ---------------------------------------------------------------------------

export const REPORT_VERSION_REFS = [
  { label: IDENTIFICATION_BASIS_LABELS.riskMechanismRelease, reference: IDENTIFICATION_BASIS_VERSIONS.riskMechanismRelease },
  { label: IDENTIFICATION_BASIS_LABELS.identificationPolicySet, reference: IDENTIFICATION_BASIS_VERSIONS.identificationPolicySet },
  { label: BASIS_VERSION_LABELS.indicatorSystem, reference: ASSESSMENT_BASIS_VERSIONS.indicatorSystem },
  { label: BASIS_VERSION_LABELS.applicableRuleSet, reference: ASSESSMENT_BASIS_VERSIONS.applicableRuleSet },
  { label: BASIS_VERSION_LABELS.weightSet, reference: ASSESSMENT_BASIS_VERSIONS.weightSet },
  { label: BASIS_VERSION_LABELS.riskMatrix, reference: ASSESSMENT_BASIS_VERSIONS.riskMatrix },
  { label: BASIS_VERSION_LABELS.riskAcceptanceThreshold, reference: ASSESSMENT_BASIS_VERSIONS.riskAcceptanceThreshold },
  { label: BASIS_VERSION_LABELS.monitoringWarningThreshold, reference: ASSESSMENT_BASIS_VERSIONS.monitoringWarningThreshold },
  { label: '复核策略', reference: REVIEW_POLICY_REF },
] as const;

// ---------------------------------------------------------------------------
// 导出历史（契约无导出记录 schema，展示形状见 docs/gap-inbox/report.md）
// ---------------------------------------------------------------------------

export type ExportRecordStatus = 'completed' | 'failed';

export const EXPORT_STATUS_LABELS: Readonly<Record<ExportRecordStatus, string>> = {
  completed: '已完成',
  failed: '失败',
};

export interface ExportRecordView {
  readonly exportId: string;
  /** 导出产物引用（对齐 ProjectionExportSuccessV1.exportArtifactRef）。 */
  readonly exportArtifactRef: ContractRef | null;
  readonly sourceRef: ContractRef;
  readonly exportPolicyRef: VersionRef;
  readonly sections: readonly ReportSectionId[];
  readonly format: ExportFormatId;
  readonly windowLabel: string;
  readonly status: ExportRecordStatus;
  /** 失败时的错误码与可重试标记（对齐 ModuleErrorV1 安全字段口径）。 */
  readonly errorCode?: string;
  readonly retryable?: boolean;
  readonly requestedByLabel: string;
  readonly requestedAt: string;
  readonly completedAt?: string;
}

const qr = (entityId: string, versionId: string): ContractRef => ({
  kind: 'query-result',
  reference: { entityId, versionId },
});

export const EXPORT_HISTORY: readonly ExportRecordView[] = [
  {
    exportId: 'EXP-2026-003',
    exportArtifactRef: { kind: 'export-artifact', reference: { entityId: 'EXP-ART-2026-003', versionId: 'v1' } },
    sourceRef: qr('QR-RISK-OVERVIEW-20260910', 'v1'),
    exportPolicyRef: EXPORT_POLICY_REF,
    sections: ['identification', 'assessment', 'warning-response', 'audit'],
    format: 'pdf',
    windowLabel: '2026-08-01 至 2026-09-10',
    status: 'completed',
    requestedByLabel: '项目风险经理',
    requestedAt: '2026-09-10T15:40:00+08:00',
    completedAt: '2026-09-10T15:41:12+08:00',
  },
  {
    exportId: 'EXP-2026-002',
    exportArtifactRef: { kind: 'export-artifact', reference: { entityId: 'EXP-ART-2026-002', versionId: 'v1' } },
    sourceRef: qr('QR-RISK-OVERVIEW-20260905', 'v1'),
    exportPolicyRef: EXPORT_POLICY_REF,
    sections: ['assessment', 'warning-response'],
    format: 'docx',
    windowLabel: '2026-08-20 至 2026-09-05',
    status: 'completed',
    requestedByLabel: '项目风险经理',
    requestedAt: '2026-09-05T10:12:00+08:00',
    completedAt: '2026-09-05T10:13:05+08:00',
  },
  {
    exportId: 'EXP-2026-001',
    exportArtifactRef: null,
    sourceRef: qr('QR-RISK-OVERVIEW-20260828', 'v1'),
    exportPolicyRef: EXPORT_POLICY_REF,
    sections: ['identification', 'assessment', 'warning-response', 'audit'],
    format: 'pdf',
    windowLabel: '2026-08-01 至 2026-08-28',
    status: 'failed',
    errorCode: 'TRANSIENT_FAILURE',
    retryable: true,
    requestedByLabel: '项目风险经理',
    requestedAt: '2026-08-28T09:30:00+08:00',
  },
];
