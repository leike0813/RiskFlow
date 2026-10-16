import { z } from "zod";

import {
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import {
  AgentTaskRefV1Schema,
  ContentArtifactRefV1Schema,
  MonitoringSeriesRefV1Schema,
  MonitoringSnapshotRefV1Schema,
  ProjectRevisionRefV1Schema,
  SourceSegmentSetRefV1Schema,
  SourceVersionRefV1Schema,
  SpatialScopeRefV1Schema,
  StructuredDocumentConversionRefV1Schema,
} from "@riskflow/contracts/ports";
import { AgentTaskBudgetPolicyV1Schema } from "../../agent-runtime/schema.js";
import {
  SourceSegmentIdV1Schema,
  SourceSegmentKindV1Schema,
  SourceSegmentLocatorV1Schema,
} from "../context-source/schema.js";
import { DocumentInputKindV1Schema } from "../document-conversion/schema.js";
import {
  MonitoringAvailabilityV1Schema,
  MonitoringSamplePointStatusV1Schema,
  MonitoringSampleVersionRefV1Schema,
} from "../monitoring/schema.js";

export const DATA_CLEANING_SCHEMA_VERSION_V1 = "1" as const;
export const DATA_CLEANING_MAX_CANDIDATE_EXCLUSIONS = 2_000;
export const DATA_CLEANING_MAX_OBSERVATIONS = 32;
export const DATA_CLEANING_MAX_EVIDENCE_REFERENCES = 16;
export const DATA_CLEANING_MAX_OBSERVATION_TEXT = 512;
export const DATA_CLEANING_MAX_SUMMARY_REASONS = 32;

const safeInteger = z.number().int().safe();
const positiveInteger = safeInteger.positive();
const nonNegativeInteger = safeInteger.nonnegative();
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const ratioSchema = z.number().finite().min(0).max(1);
const boundedText = z.string().trim().min(1).max(DATA_CLEANING_MAX_OBSERVATION_TEXT);

export const DataCleaningAvailabilityV1Schema = z.enum(["available", "partial", "unavailable"]);
export type DataCleaningAvailabilityV1 = z.infer<typeof DataCleaningAvailabilityV1Schema>;

export const DataCleaningDispositionV1Schema = z.enum(["accepted", "rejected"]);
export type DataCleaningDispositionV1 = z.infer<typeof DataCleaningDispositionV1Schema>;

export const DataCleaningRejectionClassV1Schema = z.enum(["repairable", "terminal"]);
export type DataCleaningRejectionClassV1 = z.infer<typeof DataCleaningRejectionClassV1Schema>;

export const DataCleaningInputKindV1Schema = z.union([
  DocumentInputKindV1Schema,
  z.literal("monitoring-snapshot"),
]);
export type DataCleaningInputKindV1 = z.infer<typeof DataCleaningInputKindV1Schema>;

export const DataCleaningDocumentInputV1Schema = z.strictObject({
  sourceVersionRef: SourceVersionRefV1Schema,
  conversionRef: StructuredDocumentConversionRefV1Schema,
  jsonLdArtifactRef: ContentArtifactRefV1Schema,
  sourceSegmentSetRef: SourceSegmentSetRefV1Schema,
  inputKind: DocumentInputKindV1Schema,
});
export type DataCleaningDocumentInputV1 = z.infer<typeof DataCleaningDocumentInputV1Schema>;

export const DataCleaningMonitoringSelectionReasonV1Schema = z.enum([
  "latest-valid",
  "correction",
  "supplement",
  "original",
]);
export type DataCleaningMonitoringSelectionReasonV1 = z.infer<
  typeof DataCleaningMonitoringSelectionReasonV1Schema
>;

export const DataCleaningMonitoringInputV1Schema = z.strictObject({
  monitoringSnapshotRef: MonitoringSnapshotRefV1Schema,
  monitoringSeriesRef: MonitoringSeriesRefV1Schema,
  availability: MonitoringAvailabilityV1Schema,
});
export type DataCleaningMonitoringInputV1 = z.infer<typeof DataCleaningMonitoringInputV1Schema>;

/**
 * 冻结的数据清洗准备清单：只保存引用、版本与顺序，不保存正文、监测值或 Agent 观察内容。
 * 同一命令重放时必须生成逐字节相同的清单，因此不得包含时间戳或授权上下文。
 */
export const CleaningPreparationManifestV1Schema = z
  .strictObject({
    schemaVersion: z.literal(DATA_CLEANING_SCHEMA_VERSION_V1),
    commandId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
    projectId: IdentifierSchema,
    actorId: IdentifierSchema,
    projectRevisionRef: ProjectRevisionRefV1Schema,
    spatialScopeRefs: z.array(SpatialScopeRefV1Schema).min(1),
    dataProcessingPolicyRef: VersionReferenceSchema,
    documents: z.array(DataCleaningDocumentInputV1Schema).min(1),
    monitoring: DataCleaningMonitoringInputV1Schema.optional(),
  })
  .superRefine((manifest, context) => {
    const versions = new Set<string>();
    const conversions = new Set<string>();
    const segmentSets = new Set<string>();
    for (const [index, document] of manifest.documents.entries()) {
      const versionKey = `${document.sourceVersionRef.reference.entityId}:${document.sourceVersionRef.reference.versionId}`;
      if (versions.has(versionKey)) {
        context.addIssue({
          code: "custom",
          path: ["documents", index, "sourceVersionRef"],
          message: "source version must be unique within a preparation",
        });
      }
      versions.add(versionKey);
      const conversionKey = `${document.conversionRef.reference.entityId}:${document.conversionRef.reference.versionId}`;
      if (conversions.has(conversionKey)) {
        context.addIssue({
          code: "custom",
          path: ["documents", index, "conversionRef"],
          message: "conversion must be unique within a preparation",
        });
      }
      conversions.add(conversionKey);
      const setKey = `${document.sourceSegmentSetRef.reference.entityId}:${document.sourceSegmentSetRef.reference.versionId}`;
      if (segmentSets.has(setKey)) {
        context.addIssue({
          code: "custom",
          path: ["documents", index, "sourceSegmentSetRef"],
          message: "source segment set must be unique within a preparation",
        });
      }
      segmentSets.add(setKey);
    }
  });
export type CleaningPreparationManifestV1 = z.infer<typeof CleaningPreparationManifestV1Schema>;

const dataCleaningExclusionBase = {
  reasonCode: IdentifierSchema,
  evidenceReferences: z
    .array(EvidenceReferenceSchema)
    .min(1)
    .max(DATA_CLEANING_MAX_EVIDENCE_REFERENCES),
};

export const DataCleaningDocumentExclusionV1Schema = z.strictObject({
  targetKind: z.literal("document-segment"),
  sourceVersionRef: SourceVersionRefV1Schema,
  sourceSegmentId: SourceSegmentIdV1Schema,
  ...dataCleaningExclusionBase,
});
export type DataCleaningDocumentExclusionV1 = z.infer<typeof DataCleaningDocumentExclusionV1Schema>;

export const DataCleaningMonitoringExclusionV1Schema = z.strictObject({
  targetKind: z.literal("monitoring-sample"),
  monitoringSnapshotRef: MonitoringSnapshotRefV1Schema,
  sampleVersionRef: MonitoringSampleVersionRefV1Schema,
  ...dataCleaningExclusionBase,
});
export type DataCleaningMonitoringExclusionV1 = z.infer<
  typeof DataCleaningMonitoringExclusionV1Schema
>;

/** 判别联合只允许“引用级排除”，从结构上排除正文、数值、补丁与整对象覆盖。 */
export const DataCleaningExclusionV1Schema = z.discriminatedUnion("targetKind", [
  DataCleaningDocumentExclusionV1Schema,
  DataCleaningMonitoringExclusionV1Schema,
]);
export type DataCleaningExclusionV1 = z.infer<typeof DataCleaningExclusionV1Schema>;

export const DataCleaningObservationV1Schema = z.strictObject({
  observationCode: IdentifierSchema,
  summaryText: boundedText,
});
export type DataCleaningObservationV1 = z.infer<typeof DataCleaningObservationV1Schema>;

export const DataCleaningCandidateV1Schema = z.strictObject({
  schemaVersion: z.literal(DATA_CLEANING_SCHEMA_VERSION_V1),
  candidateVersion: positiveInteger,
  observations: z.array(DataCleaningObservationV1Schema).max(DATA_CLEANING_MAX_OBSERVATIONS),
  exclusions: z.array(DataCleaningExclusionV1Schema).max(DATA_CLEANING_MAX_CANDIDATE_EXCLUSIONS),
});
export type DataCleaningCandidateV1 = z.infer<typeof DataCleaningCandidateV1Schema>;

export const DataCleaningIncrementV1Schema = DataCleaningCandidateV1Schema;
export type DataCleaningIncrementV1 = DataCleaningCandidateV1;

export const DataCleaningDocumentSliceRequestV1Schema = z.strictObject({
  kind: z.literal("read-document-segment-slice"),
  sourceVersionRef: SourceVersionRefV1Schema,
  sourceSegmentIds: z.array(SourceSegmentIdV1Schema).min(1),
});
export type DataCleaningDocumentSliceRequestV1 = z.infer<
  typeof DataCleaningDocumentSliceRequestV1Schema
>;

export const DataCleaningMonitoringSliceRequestV1Schema = z.strictObject({
  kind: z.literal("read-monitoring-snapshot-slice"),
  monitoringSnapshotRef: MonitoringSnapshotRefV1Schema,
  sampleVersionRefs: z.array(MonitoringSampleVersionRefV1Schema).min(1),
});
export type DataCleaningMonitoringSliceRequestV1 = z.infer<
  typeof DataCleaningMonitoringSliceRequestV1Schema
>;

/** 分页定位只列冻结资料内的精确段身份，页大小沿用原 maxSegmentsPerRead，不新增预算。 */
export const DataCleaningPreparationCatalogSliceRequestV1Schema = z.strictObject({
  kind: z.literal("read-cleaning-preparation-catalog-slice"),
  sourceVersionRef: SourceVersionRefV1Schema,
  offset: nonNegativeInteger,
});
export type DataCleaningPreparationCatalogSliceRequestV1 = z.infer<
  typeof DataCleaningPreparationCatalogSliceRequestV1Schema
>;

export const DataCleaningCandidateSubmissionV1Schema = z.strictObject({
  kind: z.literal("submit-cleaning-candidate"),
  candidate: DataCleaningCandidateV1Schema,
});
export type DataCleaningCandidateSubmissionV1 = z.infer<
  typeof DataCleaningCandidateSubmissionV1Schema
>;

/** C08 动作协议：模型只可能请求有界只读切片、有界定位分页或提交清洗候选。 */
export const DataCleaningActionV1Schema = z.discriminatedUnion("kind", [
  DataCleaningDocumentSliceRequestV1Schema,
  DataCleaningMonitoringSliceRequestV1Schema,
  DataCleaningPreparationCatalogSliceRequestV1Schema,
  DataCleaningCandidateSubmissionV1Schema,
]);
export type DataCleaningActionV1 = z.infer<typeof DataCleaningActionV1Schema>;

export const DataCleaningToolPolicyV1Schema = z
  .strictObject({
    documentSegmentToolRef: VersionReferenceSchema,
    monitoringSnapshotToolRef: VersionReferenceSchema,
    /** 只有显式登记该引用的策略版本注册分页定位工具，其余版本保持原全定位视图。 */
    preparationCatalogToolRef: VersionReferenceSchema.optional(),
    maxSegmentsPerRead: positiveInteger,
    maxMonitoringItemsPerRead: positiveInteger,
  })
  .superRefine((policy, context) => {
    const declared = [
      ["documentSegmentToolRef", policy.documentSegmentToolRef],
      ["monitoringSnapshotToolRef", policy.monitoringSnapshotToolRef],
      ...(policy.preparationCatalogToolRef === undefined
        ? []
        : [["preparationCatalogToolRef", policy.preparationCatalogToolRef] as const]),
    ] as const;
    const declaredByRef = new Map<string, string>();
    for (const [field, ref] of declared) {
      const key = `${ref.entityId}:${ref.versionId}`;
      const first = declaredByRef.get(key);
      if (first === undefined) {
        declaredByRef.set(key, field);
        continue;
      }
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${field} must not reuse the ${first} tool reference`,
      });
    }
  });
export type DataCleaningToolPolicyV1 = z.infer<typeof DataCleaningToolPolicyV1Schema>;

export const DataCleaningAgentPolicyV1Schema = z
  .strictObject({
    definitionRef: VersionReferenceSchema,
    modelDeploymentRef: VersionReferenceSchema,
    promptTemplateRef: VersionReferenceSchema,
    toolPolicyRef: VersionReferenceSchema,
    budgetPolicyRef: VersionReferenceSchema,
    incrementSchemaRef: VersionReferenceSchema,
    validationPolicyRef: VersionReferenceSchema,
    budgetPolicy: AgentTaskBudgetPolicyV1Schema,
  })
  .superRefine((policy, context) => {
    const pairs = [
      ["modelDeploymentRef", policy.modelDeploymentRef, policy.budgetPolicy.modelDeploymentRef],
      ["promptTemplateRef", policy.promptTemplateRef, policy.budgetPolicy.promptTemplateRef],
      ["toolPolicyRef", policy.toolPolicyRef, policy.budgetPolicy.toolPolicyRef],
      ["budgetPolicyRef", policy.budgetPolicyRef, policy.budgetPolicy.policyRef],
    ] as const;
    for (const [field, value, expected] of pairs) {
      if (value.entityId !== expected.entityId || value.versionId !== expected.versionId) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} must match the frozen budget policy`,
        });
      }
    }
  });
export type DataCleaningAgentPolicyV1 = z.infer<typeof DataCleaningAgentPolicyV1Schema>;

/**
 * 版本化数据处理策略。由组合根在启动时注入并冻结；命令的 `dataProcessingPolicyRef`
 * 必须与本对象的 `policyRef` 完全一致，禁止按引用猜测“最新版”。
 */
export const DataCleaningPolicyV1Schema = z
  .strictObject({
    schemaVersion: z.literal(DATA_CLEANING_SCHEMA_VERSION_V1),
    policyRef: VersionReferenceSchema,
    allowedConversionPolicyRefs: z.array(VersionReferenceSchema).min(1),
    allowedQualityPolicyRefs: z.array(VersionReferenceSchema).min(1),
    allowedConverterDeploymentRefs: z.array(VersionReferenceSchema).min(1),
    allowedExclusionReasonCodes: z.array(IdentifierSchema).min(1),
    protectedSegmentKinds: z.array(SourceSegmentKindV1Schema),
    requiredSegmentKinds: z.array(SourceSegmentKindV1Schema).min(1),
    protectedMonitoringSelectionReasons: z
      .array(DataCleaningMonitoringSelectionReasonV1Schema)
      .min(1),
    minimumRetainedSegmentRatio: ratioSchema,
    minimumRetainedSampleRatio: ratioSchema,
    minimumDocumentCoverageRatio: ratioSchema,
    monitoring: z
      .strictObject({
        monitoringSeriesRef: MonitoringSeriesRefV1Schema,
        availabilityPolicyRef: VersionReferenceSchema,
      })
      .optional(),
    tools: DataCleaningToolPolicyV1Schema,
    agent: DataCleaningAgentPolicyV1Schema,
  })
  .superRefine((policy, context) => {
    if (
      new Set(policy.allowedExclusionReasonCodes).size !== policy.allowedExclusionReasonCodes.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["allowedExclusionReasonCodes"],
        message: "reason codes must be unique",
      });
    }
    if (new Set(policy.requiredSegmentKinds).size !== policy.requiredSegmentKinds.length) {
      context.addIssue({
        code: "custom",
        path: ["requiredSegmentKinds"],
        message: "required kinds must be unique",
      });
    }
    if (new Set(policy.protectedSegmentKinds).size !== policy.protectedSegmentKinds.length) {
      context.addIssue({
        code: "custom",
        path: ["protectedSegmentKinds"],
        message: "protected kinds must be unique",
      });
    }
  });
export type DataCleaningPolicyV1 = z.infer<typeof DataCleaningPolicyV1Schema>;

export const DataCleaningPolicyV2Schema = z
  .strictObject(DataCleaningPolicyV1Schema.shape)
  .omit({
    schemaVersion: true,
    allowedConversionPolicyRefs: true,
    allowedQualityPolicyRefs: true,
    allowedConverterDeploymentRefs: true,
    requiredSegmentKinds: true,
    minimumRetainedSegmentRatio: true,
  })
  .extend({
    schemaVersion: z.literal("2"),
    documentRules: z
      .array(
        z.strictObject({
          inputKind: DocumentInputKindV1Schema,
          requiredSegmentKinds: z.array(SourceSegmentKindV1Schema).min(1),
        }),
      )
      .min(1),
  })
  .superRefine((policy, context) => {
    const kinds = new Set<string>();
    for (const [index, rule] of policy.documentRules.entries()) {
      if (kinds.has(rule.inputKind))
        context.addIssue({
          code: "custom",
          path: ["documentRules", index, "inputKind"],
          message: "input kind must be unique",
        });
      kinds.add(rule.inputKind);
      if (new Set(rule.requiredSegmentKinds).size !== rule.requiredSegmentKinds.length)
        context.addIssue({
          code: "custom",
          path: ["documentRules", index, "requiredSegmentKinds"],
          message: "required kinds must be unique",
        });
    }
    for (const key of ["allowedExclusionReasonCodes", "protectedSegmentKinds"] as const) {
      if (new Set(policy[key]).size !== policy[key].length)
        context.addIssue({ code: "custom", path: [key], message: "values must be unique" });
    }
  });
export type DataCleaningPolicyV2 = z.infer<typeof DataCleaningPolicyV2Schema>;
export const DataCleaningPolicySchema = z.discriminatedUnion("schemaVersion", [
  DataCleaningPolicyV1Schema,
  DataCleaningPolicyV2Schema,
]);
export type DataCleaningPolicy = z.infer<typeof DataCleaningPolicySchema>;

export const DataCleaningFrozenSegmentV1Schema = z.strictObject({
  sourceSegmentId: SourceSegmentIdV1Schema,
  kind: SourceSegmentKindV1Schema,
  locator: SourceSegmentLocatorV1Schema,
  textBlockIds: z.array(IdentifierSchema).min(1),
  parsedFingerprint: hashSchema,
});
export type DataCleaningFrozenSegmentV1 = z.infer<typeof DataCleaningFrozenSegmentV1Schema>;

export const DataCleaningFrozenDocumentV1Schema = z
  .strictObject({
    sourceVersionRef: SourceVersionRefV1Schema,
    conversionRef: StructuredDocumentConversionRefV1Schema,
    jsonLdArtifactRef: ContentArtifactRefV1Schema,
    sourceSegmentSetRef: SourceSegmentSetRefV1Schema,
    inputKind: DocumentInputKindV1Schema,
    jsonLdFingerprint: hashSchema,
    unrecognizedTableImageCount: nonNegativeInteger.optional(),
    segments: z.array(DataCleaningFrozenSegmentV1Schema).min(1),
  })
  .superRefine((document, context) => {
    const ids = new Set<string>();
    for (const [index, segment] of document.segments.entries()) {
      if (ids.has(segment.sourceSegmentId)) {
        context.addIssue({
          code: "custom",
          path: ["segments", index, "sourceSegmentId"],
          message: "segment id must be unique",
        });
      }
      ids.add(segment.sourceSegmentId);
    }
  });
export type DataCleaningFrozenDocumentV1 = z.infer<typeof DataCleaningFrozenDocumentV1Schema>;

export const DataCleaningFrozenMonitoringV1Schema = z.strictObject({
  monitoringSnapshotRef: MonitoringSnapshotRefV1Schema,
  monitoringSeriesRef: MonitoringSeriesRefV1Schema,
  availability: MonitoringAvailabilityV1Schema,
  coverageRatio: ratioSchema,
  availabilityReasons: z.array(IdentifierSchema).max(DATA_CLEANING_MAX_SUMMARY_REASONS),
  members: z.array(
    z.strictObject({
      memberIndex: nonNegativeInteger,
      sampleVersionRef: MonitoringSampleVersionRefV1Schema,
      selectionReason: DataCleaningMonitoringSelectionReasonV1Schema,
    }),
  ),
  pointStatuses: z.array(
    z.strictObject({
      sampledAt: IsoDateTimeSchema,
      status: MonitoringSamplePointStatusV1Schema,
      sampleVersionRefs: z.array(MonitoringSampleVersionRefV1Schema).max(4),
    }),
  ),
  snapshotFingerprint: hashSchema,
});
export type DataCleaningFrozenMonitoringV1 = z.infer<typeof DataCleaningFrozenMonitoringV1Schema>;

/** 冻结输入由清单与 C12/C11/C14 只读事实确定性推导，不额外持久化第二份事实。 */
export const DataCleaningFrozenInputV1Schema = z.strictObject({
  schemaVersion: z.literal(DATA_CLEANING_SCHEMA_VERSION_V1),
  manifestArtifactRef: ContentArtifactRefV1Schema,
  manifestDigest: hashSchema,
  agentTaskRef: AgentTaskRefV1Schema,
  policyRef: VersionReferenceSchema,
  documents: z.array(DataCleaningFrozenDocumentV1Schema).min(1),
  monitoring: DataCleaningFrozenMonitoringV1Schema.optional(),
});
export type DataCleaningFrozenInputV1 = z.infer<typeof DataCleaningFrozenInputV1Schema>;

export const DataCleaningExclusionDecisionV1Schema = z.strictObject({
  decisionId: IdentifierSchema,
  targetKind: z.enum(["document-segment", "monitoring-sample"]),
  reasonCode: IdentifierSchema,
  disposition: DataCleaningDispositionV1Schema,
  rejectionClass: DataCleaningRejectionClassV1Schema.optional(),
  evidenceReferences: z
    .array(EvidenceReferenceSchema)
    .min(1)
    .max(DATA_CLEANING_MAX_EVIDENCE_REFERENCES),
  sourceVersionRef: SourceVersionRefV1Schema.optional(),
  sourceSegmentId: SourceSegmentIdV1Schema.optional(),
  monitoringSnapshotRef: MonitoringSnapshotRefV1Schema.optional(),
  sampleVersionRef: MonitoringSampleVersionRefV1Schema.optional(),
});
export type DataCleaningExclusionDecisionV1 = z.infer<typeof DataCleaningExclusionDecisionV1Schema>;

export const DataCleaningInputStatusV1Schema = z.strictObject({
  inputKey: IdentifierSchema,
  inputKind: DataCleaningInputKindV1Schema,
  availability: DataCleaningAvailabilityV1Schema,
  baselineAvailability: DataCleaningAvailabilityV1Schema,
  totalCount: nonNegativeInteger,
  retainedCount: nonNegativeInteger,
  retainedRatio: ratioSchema,
  retainedSegmentIds: z.array(SourceSegmentIdV1Schema),
  excludedSegmentIds: z.array(SourceSegmentIdV1Schema),
  retainedSampleVersionRefs: z.array(MonitoringSampleVersionRefV1Schema),
  excludedSampleVersionRefs: z.array(MonitoringSampleVersionRefV1Schema),
  missingRequiredSegmentKinds: z.array(SourceSegmentKindV1Schema),
  protectedRetained: z.boolean(),
  reasonCodes: z.array(IdentifierSchema).max(DATA_CLEANING_MAX_SUMMARY_REASONS),
  sourceVersionRef: SourceVersionRefV1Schema.optional(),
  monitoringSnapshotRef: MonitoringSnapshotRefV1Schema.optional(),
});
export type DataCleaningInputStatusV1 = z.infer<typeof DataCleaningInputStatusV1Schema>;

/** `settleDataCleaningCandidate` 的确定性收口结果，不含任何 Agent 提供的可用性字段。 */
export const DataCleaningSettlementV1Schema = z.strictObject({
  exclusions: z.array(DataCleaningExclusionDecisionV1Schema),
  inputs: z.array(DataCleaningInputStatusV1Schema).min(1),
  overallAvailability: DataCleaningAvailabilityV1Schema,
  overallCoverageRatio: ratioSchema,
  reasonCodes: z.array(IdentifierSchema).max(DATA_CLEANING_MAX_SUMMARY_REASONS),
  requiredDocumentRetentionSatisfied: z.boolean(),
});
export type DataCleaningSettlementV1 = z.infer<typeof DataCleaningSettlementV1Schema>;

export const DataCleaningValidationViewV1Schema = z.strictObject({
  disposition: DataCleaningDispositionV1Schema,
  rejectionClass: DataCleaningRejectionClassV1Schema.optional(),
  items: z.array(
    z.strictObject({
      checkId: IdentifierSchema,
      disposition: DataCleaningDispositionV1Schema,
      rejectionClass: DataCleaningRejectionClassV1Schema.optional(),
      reasonCode: IdentifierSchema,
      evidenceReferences: z.array(EvidenceReferenceSchema),
    }),
  ),
});
export type DataCleaningValidationViewV1 = z.infer<typeof DataCleaningValidationViewV1Schema>;

export const DataCleaningResultV1Schema = z
  .strictObject({
    schemaVersion: z.literal(DATA_CLEANING_SCHEMA_VERSION_V1),
    manifestArtifactRef: ContentArtifactRefV1Schema,
    manifestDigest: hashSchema,
    policyRef: VersionReferenceSchema,
    agentTaskRef: AgentTaskRefV1Schema,
    projectRevisionRef: ProjectRevisionRefV1Schema,
    spatialScopeRefs: z.array(SpatialScopeRefV1Schema).min(1),
    documentConversionRefs: z.array(StructuredDocumentConversionRefV1Schema).min(1),
    sourceSegmentSetRefs: z.array(SourceSegmentSetRefV1Schema).min(1),
    monitoringSnapshotRef: MonitoringSnapshotRefV1Schema.optional(),
    modelDeploymentRef: VersionReferenceSchema,
    promptTemplateRef: VersionReferenceSchema,
    toolPolicyRef: VersionReferenceSchema,
    budgetPolicyRef: VersionReferenceSchema,
    incrementSchemaRef: VersionReferenceSchema,
    validationPolicyRef: VersionReferenceSchema,
    candidateVersion: positiveInteger,
    validationArtifactRef: ContentArtifactRefV1Schema,
    exclusions: z.array(DataCleaningExclusionDecisionV1Schema),
    inputs: z.array(DataCleaningInputStatusV1Schema).min(1),
    overallAvailability: DataCleaningAvailabilityV1Schema,
    overallCoverageRatio: ratioSchema,
    reasonCodes: z.array(IdentifierSchema).max(DATA_CLEANING_MAX_SUMMARY_REASONS),
    formedAt: IsoDateTimeSchema,
  })
  .superRefine((result, context) => {
    if (result.documentConversionRefs.length !== result.sourceSegmentSetRefs.length) {
      context.addIssue({
        code: "custom",
        path: ["sourceSegmentSetRefs"],
        message: "one source segment set reference is required per conversion",
      });
    }
  });
export type DataCleaningResultV1 = z.infer<typeof DataCleaningResultV1Schema>;
