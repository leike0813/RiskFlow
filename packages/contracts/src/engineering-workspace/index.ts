import { z } from "zod";

import {
  AuditInfoSchema,
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "../common/index.js";
import { ApplicabilityMetadataSchema } from "../records/index.js";
import {
  DataCleaningDispositionV1Schema,
  DataCleaningRejectionClassV1Schema,
  PresetRoleV1Schema,
  SourceVisibilityV1Schema,
} from "../vocabulary/index.js";
import {
  DiagnosticArtifactRefV1Schema,
  MonitoringBatchCatalogItemV1Schema,
  MonitoringBatchRefV1Schema,
  MonitoringSeriesCatalogItemV1Schema,
  MonitoringSeriesRefV1Schema,
  MonitoringSnapshotCatalogItemV1Schema,
  MonitoringSnapshotRefV1Schema,
  ProjectRevisionRefV1Schema,
  RouteDecisionRefV1Schema,
  SourceSegmentSetRefV1Schema,
  SourceVersionRefV1Schema,
  SpatialScopeRefV1Schema,
  StructuredDocumentConversionRefV1Schema,
  StructuredDocumentConversionStatisticsV1Schema,
  StructuredDocumentConversionStatusV1Schema,
} from "../ports/index.js";

/* -------------------------------------------------------------------------- */
/* 工程工作区公共契约                                                          */
/*                                                                            */
/* 本模块是工程工作区浏览器可见的严格载荷、成功投影与其 HTTP 信封的唯一事实源。*/
/* 它不依赖 core：内部命令信封、sessionToken、授权快照与失败类型仍由所属领域   */
/* 拥有。纯值 Schema 从 C11/C06 迁入，调用方直接导入本模块，不保留旧位置转发。 */
/* -------------------------------------------------------------------------- */

const boundedText = z.string().trim().min(1).max(200);
const extendedText = z.string().trim().min(1).max(500);
const expectedVersion = z.union([VersionReferenceSchema, z.literal("none")]);

/** 工程工作区有界页大小：默认 25，最大 50，与 C32 只读面同上限。 */
export const ENGINEERING_WORKSPACE_PAGE_SIZE_DEFAULT_V1 = 25;
export const ENGINEERING_WORKSPACE_PAGE_SIZE_MAX_V1 = 50;
const workspacePageSize = z.number().int().min(1).max(ENGINEERING_WORKSPACE_PAGE_SIZE_MAX_V1);
const workspaceCursor = z.string().min(1);

/* -------------------------------------------------------------------------- */
/* C11 纯值：工程业务上下文与空间区段修订                                      */
/* -------------------------------------------------------------------------- */

export const ProjectBusinessLifecycleV1Schema = z.enum([
  "preparing",
  "active",
  "ended",
  "archived",
]);
export type ProjectBusinessLifecycleV1 = z.infer<typeof ProjectBusinessLifecycleV1Schema>;

export const SpatialBusinessStatusV1Schema = z.enum(["active", "inactive"]);
export type SpatialBusinessStatusV1 = z.infer<typeof SpatialBusinessStatusV1Schema>;

export const ChainageRangeV1Schema = z
  .strictObject({ start: z.number().finite(), end: z.number().finite() })
  .superRefine((value, context) => {
    if (value.end <= value.start) {
      context.addIssue({ code: "custom", path: ["end"], message: "end must be later than start" });
    }
  });
export type ChainageRangeV1 = z.infer<typeof ChainageRangeV1Schema>;

export const EffectivePeriodV1Schema = z
  .strictObject({ validFrom: IsoDateTimeSchema, validTo: IsoDateTimeSchema.optional() })
  .superRefine((value, context) => {
    if (value.validTo !== undefined && Date.parse(value.validTo) <= Date.parse(value.validFrom)) {
      context.addIssue({
        code: "custom",
        path: ["validTo"],
        message: "validTo must be later than validFrom",
      });
    }
  });
export type EffectivePeriodV1 = z.infer<typeof EffectivePeriodV1Schema>;

export const SystemTimeV1Schema = z
  .strictObject({ recordedAt: IsoDateTimeSchema, supersededAt: IsoDateTimeSchema.optional() })
  .superRefine((value, context) => {
    if (
      value.supersededAt !== undefined &&
      Date.parse(value.supersededAt) <= Date.parse(value.recordedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["supersededAt"],
        message: "supersededAt must be later than recordedAt",
      });
    }
  });
export type SystemTimeV1 = z.infer<typeof SystemTimeV1Schema>;

export const SpatialApplicabilityOverridesV1Schema = z.strictObject({
  constructionMethod: IdentifierSchema.optional(),
  stratumCondition: IdentifierSchema.optional(),
  engineeringStage: IdentifierSchema.optional(),
});
export type SpatialApplicabilityOverridesV1 = z.infer<typeof SpatialApplicabilityOverridesV1Schema>;

export const ProjectBusinessRevisionV1Schema = z.strictObject({
  projectRevisionRef: ProjectRevisionRefV1Schema,
  name: boundedText,
  lifecycle: ProjectBusinessLifecycleV1Schema,
  applicabilityMetadata: ApplicabilityMetadataSchema,
  effectivePeriod: EffectivePeriodV1Schema,
  systemTime: SystemTimeV1Schema,
  previousRevisionRef: ProjectRevisionRefV1Schema.optional(),
  audit: AuditInfoSchema,
});
export type ProjectBusinessRevisionV1 = z.infer<typeof ProjectBusinessRevisionV1Schema>;

export const SpatialBusinessRevisionV1Schema = z.strictObject({
  spatialScopeRef: SpatialScopeRefV1Schema,
  projectRevisionRef: ProjectRevisionRefV1Schema,
  parentScopeRef: SpatialScopeRefV1Schema.optional(),
  name: boundedText,
  worksiteLocation: extendedText,
  chainage: ChainageRangeV1Schema.optional(),
  applicabilityOverrides: SpatialApplicabilityOverridesV1Schema,
  status: SpatialBusinessStatusV1Schema,
  effectivePeriod: EffectivePeriodV1Schema,
  systemTime: SystemTimeV1Schema,
  previousRevisionRef: SpatialScopeRefV1Schema.optional(),
  audit: AuditInfoSchema,
});
export type SpatialBusinessRevisionV1 = z.infer<typeof SpatialBusinessRevisionV1Schema>;

/**
 * 资料段身份：段标识由来源、章节与段三段组成，公开投影与正式记录共用同一形状。
 */
export const SourceSegmentIdV1Schema = z
  .string()
  .regex(/^[A-Za-z0-9_]+-[A-Za-z0-9_]+-[A-Za-z0-9_]+$/u)
  .brand<"SourceSegmentIdV1">();
export type SourceSegmentIdV1 = z.infer<typeof SourceSegmentIdV1Schema>;

/** 监测样本版本引用：清洗排除项按样本精确定位时使用。 */
export const MonitoringSampleVersionRefV1Schema = z.strictObject({
  kind: z.literal("monitoring-sample-version"),
  reference: VersionReferenceSchema,
});
export type MonitoringSampleVersionRefV1 = z.infer<typeof MonitoringSampleVersionRefV1Schema>;

/* -------------------------------------------------------------------------- */
/* 工程工作区修订命令载荷（不含所有者信封）                                     */
/* -------------------------------------------------------------------------- */

export const EngineeringWorkspaceCommandPayloadV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("project"),
    expectedVersion,
    name: boundedText,
    lifecycle: ProjectBusinessLifecycleV1Schema,
    applicabilityMetadata: ApplicabilityMetadataSchema,
    effectivePeriod: EffectivePeriodV1Schema,
  }),
  z.strictObject({
    kind: z.literal("spatial"),
    spatialScopeRef: SpatialScopeRefV1Schema,
    projectRevisionRef: ProjectRevisionRefV1Schema,
    expectedVersion,
    parentScopeRef: SpatialScopeRefV1Schema.optional(),
    name: boundedText,
    worksiteLocation: extendedText,
    chainage: ChainageRangeV1Schema.optional(),
    applicabilityOverrides: SpatialApplicabilityOverridesV1Schema,
    status: SpatialBusinessStatusV1Schema,
    effectivePeriod: EffectivePeriodV1Schema,
  }),
]);
export type EngineeringWorkspaceCommandPayloadV1 = z.infer<
  typeof EngineeringWorkspaceCommandPayloadV1Schema
>;

/* -------------------------------------------------------------------------- */
/* 工程工作区读取载荷                                                           */
/* -------------------------------------------------------------------------- */

export const EngineeringWorkspaceReadSubjectV1Schema = z.union([
  SourceVersionRefV1Schema,
  MonitoringSeriesRefV1Schema,
]);
export type EngineeringWorkspaceReadSubjectV1 = z.infer<
  typeof EngineeringWorkspaceReadSubjectV1Schema
>;

export const EngineeringWorkspaceContextReadPayloadV1Schema = z
  .strictObject({
    kind: z.literal("context"),
    /** 精确工程业务修订；缺席时读取当前修订。 */
    projectRevisionRef: ProjectRevisionRefV1Schema.optional(),
    /** 稳定空间身份：读取该空间的当前业务修订。 */
    scopeId: IdentifierSchema.optional(),
    /** 精确空间业务修订：与 scopeId 互斥。 */
    spatialScopeRef: SpatialScopeRefV1Schema.optional(),
  })
  .superRefine((payload, context) => {
    if (payload.scopeId !== undefined && payload.spatialScopeRef !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["spatialScopeRef"],
        message: "scope identity and exact spatial revision are mutually exclusive",
      });
    }
  });
export type EngineeringWorkspaceContextReadPayloadV1 = z.infer<
  typeof EngineeringWorkspaceContextReadPayloadV1Schema
>;

export const EngineeringWorkspaceReadPayloadV1Schema = z.discriminatedUnion("kind", [
  EngineeringWorkspaceContextReadPayloadV1Schema,
  z.strictObject({
    kind: z.literal("ingestion"),
    subject: EngineeringWorkspaceReadSubjectV1Schema,
    cursor: workspaceCursor.optional(),
    pageSize: workspacePageSize.optional(),
  }),
  z.strictObject({
    kind: z.literal("resolve-monitoring"),
    seriesId: IdentifierSchema,
  }),
  z.strictObject({
    kind: z.literal("monitoring-snapshots"),
    monitoringSeriesRef: MonitoringSeriesRefV1Schema,
    cursor: workspaceCursor.optional(),
    pageSize: workspacePageSize.optional(),
  }),
  z.strictObject({
    kind: z.literal("cleaning-exclusions"),
    resultRef: RouteDecisionRefV1Schema,
    subject: EngineeringWorkspaceReadSubjectV1Schema,
    cursor: workspaceCursor.optional(),
    pageSize: workspacePageSize.optional(),
  }),
  z.strictObject({
    kind: z.literal("conversion-failure"),
    conversionRef: StructuredDocumentConversionRefV1Schema,
  }),
]);
export type EngineeringWorkspaceReadPayloadV1 = z.infer<
  typeof EngineeringWorkspaceReadPayloadV1Schema
>;

/* -------------------------------------------------------------------------- */
/* 接入事实投影                                                                 */
/* -------------------------------------------------------------------------- */

export const ENGINEERING_WORKSPACE_INGESTION_STAGE_V1_VALUES = [
  "conversion",
  "segments",
  "cleaning",
  "monitoring-batch",
  "monitoring-snapshot",
] as const;
export const EngineeringWorkspaceIngestionStageV1Schema = z.enum(
  ENGINEERING_WORKSPACE_INGESTION_STAGE_V1_VALUES,
);
export type EngineeringWorkspaceIngestionStageV1 = z.infer<
  typeof EngineeringWorkspaceIngestionStageV1Schema
>;

export const EngineeringWorkspaceIngestionItemV1Schema = z.discriminatedUnion("stage", [
  z.strictObject({
    stage: z.literal("conversion"),
    recordRef: StructuredDocumentConversionRefV1Schema,
    recordedAt: IsoDateTimeSchema,
    conversionRef: StructuredDocumentConversionRefV1Schema,
    status: StructuredDocumentConversionStatusV1Schema,
    statistics: StructuredDocumentConversionStatisticsV1Schema,
    sourceSegmentSetRef: SourceSegmentSetRefV1Schema.optional(),
    diagnosticRef: DiagnosticArtifactRefV1Schema.optional(),
    completedAt: IsoDateTimeSchema,
  }),
  z.strictObject({
    stage: z.literal("segments"),
    recordRef: SourceSegmentSetRefV1Schema,
    recordedAt: IsoDateTimeSchema,
    sourceSegmentSetRef: SourceSegmentSetRefV1Schema,
    segmentCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    stage: z.literal("cleaning"),
    recordRef: RouteDecisionRefV1Schema,
    recordedAt: IsoDateTimeSchema,
    resultRef: RouteDecisionRefV1Schema,
    policyRef: VersionReferenceSchema,
    availability: z.enum(["available", "partial", "unavailable"]),
    baselineAvailability: z.enum(["available", "partial", "unavailable"]),
    totalCount: z.number().int().nonnegative(),
    retainedCount: z.number().int().nonnegative(),
    retainedRatio: z.number().finite().min(0).max(1),
    reasonCodes: z.array(IdentifierSchema).max(32),
  }),
  z.strictObject({
    stage: z.literal("monitoring-batch"),
    recordRef: MonitoringBatchRefV1Schema,
    recordedAt: IsoDateTimeSchema,
    batch: MonitoringBatchCatalogItemV1Schema,
  }),
  z.strictObject({
    stage: z.literal("monitoring-snapshot"),
    recordRef: MonitoringSnapshotRefV1Schema,
    recordedAt: IsoDateTimeSchema,
    snapshot: MonitoringSnapshotCatalogItemV1Schema,
  }),
]);
export type EngineeringWorkspaceIngestionItemV1 = z.infer<
  typeof EngineeringWorkspaceIngestionItemV1Schema
>;

export const EngineeringWorkspaceCleaningExclusionV1Schema = z.strictObject({
  decisionId: IdentifierSchema,
  targetKind: z.enum(["document-segment", "monitoring-sample"]),
  reasonCode: IdentifierSchema,
  disposition: DataCleaningDispositionV1Schema,
  rejectionClass: DataCleaningRejectionClassV1Schema.optional(),
  sourceSegmentId: SourceSegmentIdV1Schema.optional(),
  sampleVersionRef: MonitoringSampleVersionRefV1Schema.optional(),
  evidenceReferences: z.array(EvidenceReferenceSchema).min(1).max(16),
});
export type EngineeringWorkspaceCleaningExclusionV1 = z.infer<
  typeof EngineeringWorkspaceCleaningExclusionV1Schema
>;

/* -------------------------------------------------------------------------- */
/* 工程工作区读取成功投影                                                       */
/* -------------------------------------------------------------------------- */

export const EngineeringWorkspaceReadSuccessV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("context"),
    projectId: IdentifierSchema,
    project: ProjectBusinessRevisionV1Schema.nullable(),
    spatial: SpatialBusinessRevisionV1Schema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("ingestion"),
    projectId: IdentifierSchema,
    subject: EngineeringWorkspaceReadSubjectV1Schema,
    items: z
      .array(EngineeringWorkspaceIngestionItemV1Schema)
      .max(ENGINEERING_WORKSPACE_PAGE_SIZE_MAX_V1),
    nextCursor: workspaceCursor.optional(),
  }),
  z.strictObject({
    kind: z.literal("resolve-monitoring"),
    series: MonitoringSeriesCatalogItemV1Schema,
  }),
  z.strictObject({
    kind: z.literal("monitoring-snapshots"),
    items: z
      .array(MonitoringSnapshotCatalogItemV1Schema)
      .max(ENGINEERING_WORKSPACE_PAGE_SIZE_MAX_V1),
    nextCursor: workspaceCursor.optional(),
  }),
  z.strictObject({
    kind: z.literal("cleaning-exclusions"),
    items: z
      .array(EngineeringWorkspaceCleaningExclusionV1Schema)
      .max(ENGINEERING_WORKSPACE_PAGE_SIZE_MAX_V1),
    nextCursor: workspaceCursor.optional(),
  }),
  z.strictObject({
    kind: z.literal("conversion-failure"),
    conversionRef: StructuredDocumentConversionRefV1Schema,
    reasonCode: IdentifierSchema,
    sourceSegmentId: SourceSegmentIdV1Schema.optional(),
  }),
]);
export type EngineeringWorkspaceReadSuccessV1 = z.infer<
  typeof EngineeringWorkspaceReadSuccessV1Schema
>;

/* -------------------------------------------------------------------------- */
/* 工程工作区 HTTP 信封                                                         */
/* -------------------------------------------------------------------------- */

export const EngineeringWorkspaceReadRequestV1Schema = z.strictObject({
  queryId: IdentifierSchema,
  requestedAt: IsoDateTimeSchema,
  payload: EngineeringWorkspaceReadPayloadV1Schema,
});
export type EngineeringWorkspaceReadRequestV1 = z.infer<
  typeof EngineeringWorkspaceReadRequestV1Schema
>;

export const EngineeringWorkspaceCommandRequestV1Schema = z.strictObject({
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  issuedAt: IsoDateTimeSchema,
  payload: EngineeringWorkspaceCommandPayloadV1Schema,
});
export type EngineeringWorkspaceCommandRequestV1 = z.infer<
  typeof EngineeringWorkspaceCommandRequestV1Schema
>;

/* -------------------------------------------------------------------------- */
/* C06 工程访问维护：公开载荷与成功投影                                          */
/* -------------------------------------------------------------------------- */

export const AccessReferenceV1Schema = z.strictObject({
  entityId: IdentifierSchema,
  versionId: IdentifierSchema,
});
export type AccessReferenceV1 = z.infer<typeof AccessReferenceV1Schema>;

export const AccessCommandResultKindV1Schema = z.enum([
  "account",
  "project",
  "membership",
  "spatial-scope",
  "source-access",
  "session",
]);
export type AccessCommandResultKindV1 = z.infer<typeof AccessCommandResultKindV1Schema>;

export const AccessCommandResultV1Schema = z.strictObject({
  kind: AccessCommandResultKindV1Schema,
  resultRef: AccessReferenceV1Schema,
  references: z.array(AccessReferenceV1Schema).max(16),
});
export type AccessCommandResultV1 = z.infer<typeof AccessCommandResultV1Schema>;

/** 预设角色集合：成员最多四个角色且不得重复。 */
export const RoleSetV1Schema = z
  .array(PresetRoleV1Schema)
  .min(1)
  .max(4)
  .refine((values) => new Set(values).size === values.length, "roles must not repeat");
export type RoleSetV1 = z.infer<typeof RoleSetV1Schema>;

/** 空间范围集合：成员至少绑定一个空间范围且不得重复。 */
export const SpatialScopeRefSetV1Schema = z
  .array(SpatialScopeRefV1Schema)
  .min(1)
  .max(128)
  .refine(
    (values) => new Set(values.map((value) => JSON.stringify(value))).size === values.length,
    "spatial scope references must not repeat",
  );
export type SpatialScopeRefSetV1 = z.infer<typeof SpatialScopeRefSetV1Schema>;

export const ProjectWorkspaceAccessReadPayloadV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("memberships"),
    queryId: IdentifierSchema,
    requestedAt: IsoDateTimeSchema,
    projectId: IdentifierSchema,
    pageSize: workspacePageSize.optional(),
    cursor: workspaceCursor.optional(),
  }),
  z.strictObject({
    kind: z.literal("spatial-scopes"),
    queryId: IdentifierSchema,
    requestedAt: IsoDateTimeSchema,
    projectId: IdentifierSchema,
    pageSize: workspacePageSize.optional(),
    cursor: workspaceCursor.optional(),
  }),
  z.strictObject({
    kind: z.literal("source-access"),
    queryId: IdentifierSchema,
    requestedAt: IsoDateTimeSchema,
    projectId: IdentifierSchema,
    sourceVersionRef: SourceVersionRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("member-options"),
    queryId: IdentifierSchema,
    requestedAt: IsoDateTimeSchema,
    projectId: IdentifierSchema,
    pageSize: workspacePageSize.optional(),
    cursor: workspaceCursor.optional(),
  }),
]);
export type ProjectWorkspaceAccessReadPayloadV1 = z.infer<
  typeof ProjectWorkspaceAccessReadPayloadV1Schema
>;

export const ProjectWorkspaceAccessCommandPayloadV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("revise-membership"),
    expectedVersion,
    membershipId: IdentifierSchema,
    accountId: IdentifierSchema,
    roles: RoleSetV1Schema,
    spatialScopeRefs: SpatialScopeRefSetV1Schema,
    status: z.enum(["active", "removed"]),
  }),
  z.strictObject({
    kind: z.literal("create-spatial-scope"),
    expectedVersion: z.literal("none"),
    scopeId: IdentifierSchema,
    parentScopeRef: SpatialScopeRefV1Schema,
  }),
  z.strictObject({
    kind: z.literal("revise-spatial-scope"),
    expectedVersion,
    scopeId: IdentifierSchema,
    status: z.enum(["active", "inactive"]),
    parentScopeRef: SpatialScopeRefV1Schema.optional(),
  }),
  z.strictObject({
    kind: z.literal("revise-source-access"),
    expectedVersion,
    sourceVersionRef: SourceVersionRefV1Schema,
    visibility: SourceVisibilityV1Schema,
    allowedAccountIds: z.array(IdentifierSchema).max(512),
    spatialScopeRefs: z.array(SpatialScopeRefV1Schema).max(128),
  }),
]);
export type ProjectWorkspaceAccessCommandPayloadV1 = z.infer<
  typeof ProjectWorkspaceAccessCommandPayloadV1Schema
>;

export const ProjectWorkspaceAccessReadSuccessV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("memberships"),
    items: z
      .array(
        z.strictObject({
          membershipRef: AccessReferenceV1Schema,
          accountRef: AccessReferenceV1Schema,
          displayName: z.string().trim().min(1).max(200),
          roles: RoleSetV1Schema,
          spatialScopeRefs: z.array(SpatialScopeRefV1Schema).max(128),
          status: z.enum(["active", "removed"]),
        }),
      )
      .max(ENGINEERING_WORKSPACE_PAGE_SIZE_MAX_V1),
    nextCursor: workspaceCursor.optional(),
  }),
  z.strictObject({
    kind: z.literal("spatial-scopes"),
    items: z
      .array(
        z.strictObject({
          scopeRef: AccessReferenceV1Schema,
          parentScopeRef: AccessReferenceV1Schema.optional(),
          status: z.enum(["active", "inactive"]),
        }),
      )
      .max(ENGINEERING_WORKSPACE_PAGE_SIZE_MAX_V1),
    nextCursor: workspaceCursor.optional(),
  }),
  z.strictObject({
    kind: z.literal("source-access"),
    sourceGrantRef: AccessReferenceV1Schema,
    visibility: SourceVisibilityV1Schema,
    allowedAccountIds: z.array(IdentifierSchema).max(512),
    spatialScopeRefs: z.array(SpatialScopeRefV1Schema).max(128),
    registeredByAccountId: IdentifierSchema,
  }),
  z.strictObject({
    kind: z.literal("member-options"),
    items: z
      .array(
        z.strictObject({
          accountRef: AccessReferenceV1Schema,
          displayName: z.string().trim().min(1).max(200),
        }),
      )
      .max(ENGINEERING_WORKSPACE_PAGE_SIZE_MAX_V1),
    nextCursor: workspaceCursor.optional(),
  }),
]);
export type ProjectWorkspaceAccessReadSuccessV1 = z.infer<
  typeof ProjectWorkspaceAccessReadSuccessV1Schema
>;

export const ProjectWorkspaceAccessCommandRequestV1Schema = z.strictObject({
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  issuedAt: IsoDateTimeSchema,
  payload: ProjectWorkspaceAccessCommandPayloadV1Schema,
});
export type ProjectWorkspaceAccessCommandRequestV1 = z.infer<
  typeof ProjectWorkspaceAccessCommandRequestV1Schema
>;
