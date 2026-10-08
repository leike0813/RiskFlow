/**
 * C35 报告导出读取契约（design D-08/D-09）。
 *
 * 只补实现既有 `projection.export` 的报告用途，不新造 export command，也不扩展
 * `WorkflowGraphArtifactBodyV1Schema` 的 run-state/run-result 联合：报告正文是独立
 * `riskflow-report` 内容正文，由报告服务拥有，不改 Worker 正文解析。
 *
 * 范围由 C31 精确登记的 queryResultRef 固定（工程修订、空间、登记 recordedAt 时点）；
 * 格式、章节与资源上限只能取自已配置的不可变导出策略，不提供任意时间窗语义。
 */
import { z } from "zod";

import {
  ExportArtifactRefV1Schema,
  ProjectRevisionRefV1Schema,
  ProjectionResultItemV1Schema,
  QueryResultRefV1Schema,
  SpatialScopeRefV1Schema,
  createModuleQuerySchemaV1,
  createModuleResultSchemaV1,
} from "@riskflow/contracts/ports";
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";

export const REPORT_EXPORT_PAGE_SIZE_MAX_V1 = 50;
export const REPORT_EXPORT_PAGE_SIZE_DEFAULT_V1 = 25;

const readPageSize = z.number().int().min(1).max(REPORT_EXPORT_PAGE_SIZE_MAX_V1);
const readCursor = z.string().min(1).max(512);

/** 本轮 MVP 只导出已登记的 risk-overview 查询结果。 */
export const REPORT_EXPORT_QUERY_TYPES_V1 = ["risk-overview"] as const;
export const ReportExportQueryTypeV1Schema = z.enum(REPORT_EXPORT_QUERY_TYPES_V1);

/** 三个既有条目族：运行摘要、报告事实与缺席项；策略只能取其非空子集。 */
export const REPORT_EXPORT_SECTIONS_V1 = [
  "run-summary",
  "report-fact",
  "report-absence",
] as const;
export const ReportExportSectionV1Schema = z.enum(REPORT_EXPORT_SECTIONS_V1);

/**
 * 导出策略：全部为技术资源上限，不含甲方评分、矩阵或阈值规则。
 * 策略由部署组合根显式注入；缺省为空集合——没有策略就不提供导出能力。
 */
export const ReportExportPolicyV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  policyRef: VersionReferenceSchema,
  format: z.literal("json"),
  queryTypes: z.array(ReportExportQueryTypeV1Schema).min(1),
  sections: z
    .array(ReportExportSectionV1Schema)
    .min(1)
    .refine((sections) => new Set(sections).size === sections.length),
  maxPages: z.number().int().min(1).max(20),
  maxItems: z.number().int().min(1).max(1000),
  maxBytes: z.number().int().min(1).max(8 * 1024 * 1024),
});
export type ReportExportPolicyV1 = z.infer<typeof ReportExportPolicyV1Schema>;

/** 报告范围：完全取自已登记查询结果，不接受客户端自造范围。 */
export const ReportExportScopeV1Schema = z.strictObject({
  projectRevisionRef: ProjectRevisionRefV1Schema,
  spatialScopeRefs: z.array(SpatialScopeRefV1Schema).min(1),
  asOfRecordedAt: IsoDateTimeSchema,
});
export type ReportExportScopeV1 = z.infer<typeof ReportExportScopeV1Schema>;

export const ReportExportPreviewV1Schema = z.strictObject({
  kind: z.literal("preview"),
  projectId: IdentifierSchema,
  sourceRef: QueryResultRefV1Schema,
  queryType: ReportExportQueryTypeV1Schema,
  scope: ReportExportScopeV1Schema,
  policy: ReportExportPolicyV1Schema,
  /** 预览只给出有界首页条目；引用超过页大小时由用户续页，不扫完整工程。 */
  items: z.array(ProjectionResultItemV1Schema).max(REPORT_EXPORT_PAGE_SIZE_MAX_V1),
  nextCursor: readCursor.optional(),
});
export type ReportExportPreviewV1 = z.infer<typeof ReportExportPreviewV1Schema>;

export const ReportExportPolicyListV1Schema = z.strictObject({
  kind: z.literal("policies"),
  items: z.array(ReportExportPolicyV1Schema).max(64),
});
export type ReportExportPolicyListV1 = z.infer<typeof ReportExportPolicyListV1Schema>;

/**
 * 报告内容正文：独立 bodyKind，不复用运行状态/结果正文。
 * 条目沿原 ProjectionResultItemV1Schema 保持缺席事实，不重读领域正文、不重算分值，
 * 也不把链边数当成风险统计。
 */
export const ReportArtifactBodyV1Schema = z.strictObject({
  bodyKind: z.literal("riskflow-report"),
  schemaVersion: z.literal("1"),
  projectId: IdentifierSchema,
  queryResultRef: QueryResultRefV1Schema,
  exportPolicyRef: VersionReferenceSchema,
  scope: ReportExportScopeV1Schema,
  format: z.literal("json"),
  sections: z.array(ReportExportSectionV1Schema).min(1),
  items: z.array(ProjectionResultItemV1Schema).max(1000),
  generationAuditRef: z.strictObject({
    entityId: IdentifierSchema,
    versionId: IdentifierSchema,
  }),
});
export type ReportArtifactBodyV1 = z.infer<typeof ReportArtifactBodyV1Schema>;

/**
 * 工件读取结果：只返回服务端校验过的安全 JSON 正文与固定 ASCII 文件名。
 * 不接受任意路径或外链，也不提供通用工件下载。
 */
export const ReportArtifactContentV1Schema = z.strictObject({
  kind: z.literal("artifact"),
  exportArtifactRef: ExportArtifactRefV1Schema,
  fileName: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/u),
  byteLength: z.number().int().nonnegative(),
  body: ReportArtifactBodyV1Schema,
});
export type ReportArtifactContentV1 = z.infer<typeof ReportArtifactContentV1Schema>;

/** 历史条目：只来自当前工程/actor 的已完成导出收据与关联审计的有界摘要。 */
export const ReportExportHistoryItemV1Schema = z.strictObject({
  exportArtifactRef: ExportArtifactRefV1Schema,
  sourceRef: QueryResultRefV1Schema,
  exportPolicyRef: VersionReferenceSchema,
  recordedAt: IsoDateTimeSchema,
  result: z.strictObject({
    kind: z.enum(["account", "project", "membership", "spatial-scope", "source-access", "session"]),
    resultRef: z.strictObject({ entityId: IdentifierSchema, versionId: IdentifierSchema }),
    references: z
      .array(z.strictObject({ entityId: IdentifierSchema, versionId: IdentifierSchema }))
      .max(16),
  }),
});
export type ReportExportHistoryItemV1 = z.infer<typeof ReportExportHistoryItemV1Schema>;

export const ReportExportHistoryPageV1Schema = z.strictObject({
  kind: z.literal("history"),
  projectId: IdentifierSchema,
  items: z.array(ReportExportHistoryItemV1Schema).max(REPORT_EXPORT_PAGE_SIZE_MAX_V1),
  nextCursor: readCursor.optional(),
});
export type ReportExportHistoryPageV1 = z.infer<typeof ReportExportHistoryPageV1Schema>;

const policiesPayload = z.strictObject({});
const previewPayload = z.strictObject({
  queryResultRef: QueryResultRefV1Schema,
  exportPolicyRef: VersionReferenceSchema,
});
const artifactPayload = z.strictObject({ exportArtifactRef: ExportArtifactRefV1Schema });
const historyPayload = z.strictObject({
  sourceRef: QueryResultRefV1Schema.optional(),
  cursor: readCursor.optional(),
  pageSize: readPageSize.optional(),
});

export const ProjectionReportReadQueryV1Schema = z.discriminatedUnion("kind", [
  createModuleQuerySchemaV1("policies", policiesPayload, "projection.export"),
  createModuleQuerySchemaV1("preview", previewPayload, "projection.export"),
  createModuleQuerySchemaV1("artifact", artifactPayload, "projection.export"),
  createModuleQuerySchemaV1("history", historyPayload, "projection.export"),
]);
export type ProjectionReportReadQueryV1 = z.infer<typeof ProjectionReportReadQueryV1Schema>;

/**
 * 传输层载荷：只有 `kind` 与该 kind 的真实入参——与上面各 payload 共用同一份字段定义。
 */
export const ProjectionReportReadPayloadV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("policies") }),
  z.strictObject({ kind: z.literal("preview"), ...previewPayload.shape }),
  z.strictObject({ kind: z.literal("artifact"), ...artifactPayload.shape }),
  z.strictObject({ kind: z.literal("history"), ...historyPayload.shape }),
]);
export type ProjectionReportReadPayloadV1 = z.infer<typeof ProjectionReportReadPayloadV1Schema>;

export const ProjectionReportReadSuccessV1Schema = z.discriminatedUnion("kind", [
  ReportExportPolicyListV1Schema,
  ReportExportPreviewV1Schema,
  ReportArtifactContentV1Schema,
  ReportExportHistoryPageV1Schema,
]);
export type ProjectionReportReadSuccessV1 = z.infer<typeof ProjectionReportReadSuccessV1Schema>;

export const ProjectionReportReadResultV1Schema = createModuleResultSchemaV1(
  ProjectionReportReadSuccessV1Schema,
);
export type ProjectionReportReadResultV1 = z.infer<typeof ProjectionReportReadResultV1Schema>;

/**
 * 报告窄读端口：与所属 C31 projection 同一 `projection.export` 能力，
 * 生成走既有 export 契约，本端口只提供策略、预览、工件与历史的读取。
 */
export interface ProjectionReportReadPortV1 {
  read(query: ProjectionReportReadQueryV1): Promise<ProjectionReportReadResultV1>;
}