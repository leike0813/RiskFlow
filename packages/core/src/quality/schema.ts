import { z } from "zod";

import {
  ApplicabilityMetadataSnapshotRefV1Schema,
  AssessmentInputSnapshotRefV1Schema,
  ContentArtifactRefV1Schema,
  IdentificationInputSnapshotRefV1Schema,
  ProjectRevisionRefV1Schema,
  QUALITY_EVALUATION_METRIC_CODES_V1 as QUALITY_METRIC_CODES_V1,
  QUALITY_EVALUATION_METRIC_STATUSES_V1 as QUALITY_METRIC_STATUSES_V1,
  QUALITY_EVALUATION_REASON_CODES_V1 as QUALITY_REASON_CODES_V1,
  QUALITY_EVALUATION_SAMPLE_KINDS_V1 as QUALITY_SAMPLE_KINDS_V1,
  QUALITY_EVALUATION_SYNTHETIC_LABEL_V1 as QUALITY_SYNTHETIC_SAMPLE_LABEL_V1,
  QualityEvaluationMetricCodeV1Schema as QualityMetricCodeV1Schema,
  QualityEvaluationMetricStatusV1Schema as QualityMetricStatusV1Schema,
  QualityEvaluationMetricV1Schema as QualityMetricV1Schema,
  QualityEvaluationReasonCodeV1Schema as QualityReasonCodeV1Schema,
  QualityEvaluationSampleKindV1Schema as QualitySampleKindV1Schema,
  RiskAssessmentRecordRefV1Schema,
  SpatialScopeRefV1Schema,
  StandardizedRiskRecordRefV1Schema,
  WorkflowRunRefV1Schema,
  type QualityEvaluationMetricCodeV1 as QualityMetricCodeV1,
  type QualityEvaluationMetricStatusV1 as QualityMetricStatusV1,
  type QualityEvaluationMetricV1 as QualityMetricV1,
  type QualityEvaluationReasonCodeV1 as QualityReasonCodeV1,
  type QualityEvaluationSampleKindV1 as QualitySampleKindV1,
} from "@riskflow/contracts/ports";
import {
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import {
  StandardizedRiskRecordEnvelopeSchema,
  type StandardizedRiskRecordEnvelope,
} from "@riskflow/contracts/records";

import {
  AssessmentDecisionArtifactV1Schema,
  type AssessmentDecisionArtifactV1,
} from "../risk-assessment/engine/schema.js";
import type { AssessmentEngineContextV1 } from "../risk-assessment/engine/engine.js";

/**
 * C36 私有 schema：只描述冻结质量数据集、确定性指标与可复核报告。
 * 公共 C02 查询类型与页面摘要只从 `@riskflow/contracts/ports` 消费，不在此复制字段。
 */
export const QUALITY_SCHEMA_VERSION_V1 = "1" as const;

/** C04 工件身份：数据集与报告都只以内容工件冻结，正文由拥有方保存。 */
export const QUALITY_EVALUATION_DATASET_MEDIA_TYPE_V1 =
  "application/vnd.riskflow.quality-evaluation-dataset+json" as const;
export const QUALITY_EVALUATION_DATASET_PURPOSE_CODE_V1 = "quality-evaluation.dataset" as const;
export const QUALITY_EVALUATION_REPORT_MEDIA_TYPE_V1 =
  "application/vnd.riskflow.quality-evaluation-report+json" as const;
export const QUALITY_EVALUATION_REPORT_PURPOSE_CODE_V1 = "quality-evaluation.report" as const;

/** 数据集工件身份由数据集版本决定；同一版本不同摘要必须报冲突，不静默覆盖。 */
export const qualityDatasetArtifactId = (input: {
  readonly datasetId: string;
  readonly datasetVersion: string;
}): string => `quality-dataset-${input.datasetId}@${input.datasetVersion}`;

const evidenceReferenceKey = (value: {
  readonly locator: { readonly sourceSegmentId: string };
  readonly sourceVersion: { readonly entityId: string; readonly versionId: string };
}): string =>
  `${value.locator.sourceSegmentId}\u0000${value.sourceVersion.entityId}\u0000${value.sourceVersion.versionId}`;

export {
  QUALITY_METRIC_CODES_V1,
  QUALITY_METRIC_STATUSES_V1,
  QUALITY_REASON_CODES_V1,
  QUALITY_SAMPLE_KINDS_V1,
  QUALITY_SYNTHETIC_SAMPLE_LABEL_V1,
  QualityMetricCodeV1Schema,
  QualityMetricStatusV1Schema,
  QualityMetricV1Schema,
  QualityReasonCodeV1Schema,
  QualitySampleKindV1Schema,
  type QualityMetricCodeV1,
  type QualityMetricStatusV1,
  type QualityMetricV1,
  type QualityReasonCodeV1,
  type QualitySampleKindV1,
};

export const qualitySyntheticLabelFor = (sampleKind: QualitySampleKindV1): string =>
  sampleKind === "synthetic" ? QUALITY_SYNTHETIC_SAMPLE_LABEL_V1 : "";

export const QUALITY_FAILURE_CODES_V1 = [
  "CONTRACT_INVALID",
  "AUTHORIZATION_DENIED",
  "ENTITY_NOT_FOUND",
  "STALE_VERSION",
  "IDEMPOTENCY_CONFLICT",
  "UNSUPPORTED_CONTRACT",
  "TERMINAL_FAILURE",
  "TRANSIENT_FAILURE",
] as const;
export const QualityFailureCodeV1Schema = z.enum(QUALITY_FAILURE_CODES_V1);
export type QualityFailureCodeV1 = z.infer<typeof QualityFailureCodeV1Schema>;

export interface QualityFailureV1 {
  readonly code: QualityFailureCodeV1;
  readonly reasonCode: QualityReasonCodeV1;
  readonly targetRef: { readonly entityId: string; readonly versionId: string };
}

export class QualityError extends Error {
  readonly failure: QualityFailureV1;

  constructor(failure: QualityFailureV1) {
    super(failure.reasonCode);
    this.name = "QualityError";
    this.failure = failure;
  }
}

export const qualityFailureFrom = (error: unknown): QualityFailureV1 | undefined =>
  error instanceof QualityError ? error.failure : undefined;

export const failQuality = (
  code: QualityFailureCodeV1,
  reasonCode: QualityReasonCodeV1,
  targetRef: QualityFailureV1["targetRef"],
): never => {
  throw new QualityError({ code, reasonCode, targetRef });
};

/* -------------------------------------------------------------------------- */
/* D-01：冻结数据集                                                             */
/* -------------------------------------------------------------------------- */

/**
 * 每个样例固定引用识别知识/策略、规则集、权重、矩阵、模型/提示与审核配置的精确版本；
 * 缺失任一版本即拒绝数据集，不在执行时回退到 latest。
 */
export const QualitySampleVersionRefsV1Schema = z.strictObject({
  identificationKnowledgeReleaseRef: VersionReferenceSchema,
  identificationPolicySetRef: VersionReferenceSchema,
  indicatorSystemRef: VersionReferenceSchema,
  indicatorFieldMappingRef: VersionReferenceSchema,
  applicableRuleSetRef: VersionReferenceSchema,
  weightSetRef: VersionReferenceSchema,
  riskMatrixRef: VersionReferenceSchema,
  modelDeploymentRef: VersionReferenceSchema,
  promptTemplateRef: VersionReferenceSchema,
  reviewPolicyRef: VersionReferenceSchema,
});
export type QualitySampleVersionRefsV1 = z.infer<typeof QualitySampleVersionRefsV1Schema>;

/**
 * 一个必评项：即使生产结果缺失也显式列出并保留在分母。
 * `expectedPositive` 与 `expectedEventKey` 来自已审核标签，不由模型或质量模块推断。
 */
export const QualitySampleV1Schema = z
  .strictObject({
    sampleId: IdentifierSchema,
    spatialScopeRef: SpatialScopeRefV1Schema,
    processNodeId: IdentifierSchema,
    sourceSegmentRefs: z.array(EvidenceReferenceSchema).min(1),
    applicabilitySnapshotRef: ApplicabilityMetadataSnapshotRefV1Schema,
    identificationInputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
    assessmentInputSnapshotRef: AssessmentInputSnapshotRefV1Schema,
    riskRecordRef: StandardizedRiskRecordRefV1Schema.optional(),
    standardizedRiskRecordSnapshotArtifactRef: ContentArtifactRefV1Schema.optional(),
    assessmentRecordRef: RiskAssessmentRecordRefV1Schema.optional(),
    assessmentDecisionArtifactRef: ContentArtifactRefV1Schema.optional(),
    assessmentReplayContextArtifactRef: ContentArtifactRefV1Schema.optional(),
    expectedEventKey: IdentifierSchema,
    expectedPositive: z.boolean(),
    expectedRiskLevelId: IdentifierSchema.optional(),
    comparisonGroupId: IdentifierSchema.optional(),
    requiredEvidenceRefs: z.array(EvidenceReferenceSchema).min(1),
    versionRefs: QualitySampleVersionRefsV1Schema,
  })
  .superRefine((sample, context) => {
    if (
      sample.assessmentRecordRef !== undefined &&
      (sample.assessmentDecisionArtifactRef === undefined ||
        sample.assessmentReplayContextArtifactRef === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["assessmentRecordRef"],
        message: "a declared assessment record requires its frozen decision and replay context",
      });
    }
    // 必审引用必须落在样例自己明列的资料段内，否则审计链无法在授权范围内解析。
    const declaredSegments = new Set(
      sample.sourceSegmentRefs.map((reference) => evidenceReferenceKey(reference)),
    );
    for (const [index, required] of sample.requiredEvidenceRefs.entries()) {
      if (declaredSegments.has(evidenceReferenceKey(required))) continue;
      context.addIssue({
        code: "custom",
        path: ["requiredEvidenceRefs", index],
        message: "required evidence must be declared by the sample source segments",
      });
    }
  });
export type QualitySampleV1 = z.infer<typeof QualitySampleV1Schema>;

export const QualityDatasetV1Schema = z
  .strictObject({
    schemaVersion: z.literal(QUALITY_SCHEMA_VERSION_V1),
    datasetId: IdentifierSchema,
    datasetVersion: IdentifierSchema,
    sampleKind: QualitySampleKindV1Schema,
    sourceQualificationRef: VersionReferenceSchema.nullable(),
    sourceQualificationMissingReasonCode: IdentifierSchema.optional(),
    projectId: IdentifierSchema,
    projectRevisionRef: ProjectRevisionRefV1Schema,
    labelPolicyRef: VersionReferenceSchema,
    createdAt: IsoDateTimeSchema,
    samples: z.array(QualitySampleV1Schema).min(1),
  })
  .superRefine((dataset, context) => {
    if (dataset.sampleKind === "synthetic") {
      if (dataset.sourceQualificationRef !== null) {
        context.addIssue({
          code: "custom",
          path: ["sourceQualificationRef"],
          message: "synthetic datasets must not claim a de-identification qualification",
        });
      }
      if (dataset.sourceQualificationMissingReasonCode === undefined) {
        context.addIssue({
          code: "custom",
          path: ["sourceQualificationMissingReasonCode"],
          message: "synthetic datasets must state why the qualification is missing",
        });
      }
    } else if (dataset.sourceQualificationRef === null) {
      context.addIssue({
        code: "custom",
        path: ["sourceQualificationRef"],
        message: "de-identified real samples require a source qualification reference",
      });
    } else if (dataset.sourceQualificationMissingReasonCode !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["sourceQualificationMissingReasonCode"],
        message: "a qualified dataset must not carry a missing reason",
      });
    }
    const sampleIds = new Set<string>();
    const groupLabels = new Map<string, QualitySampleLabelKeyV1>();
    for (const [index, sample] of dataset.samples.entries()) {
      if (sampleIds.has(sample.sampleId)) {
        context.addIssue({
          code: "custom",
          path: ["samples", index, "sampleId"],
          message: "sample identifiers must be unique inside a dataset version",
        });
      }
      sampleIds.add(sample.sampleId);
      if (sample.comparisonGroupId === undefined) continue;
      const declared = {
        expectedPositive: sample.expectedPositive,
        expectedEventKey: sample.expectedEventKey,
      };
      const previous = groupLabels.get(sample.comparisonGroupId);
      if (previous === undefined) {
        groupLabels.set(sample.comparisonGroupId, declared);
        continue;
      }
      if (
        previous.expectedPositive !== declared.expectedPositive ||
        previous.expectedEventKey !== declared.expectedEventKey
      ) {
        context.addIssue({
          code: "custom",
          path: ["samples", index, "comparisonGroupId"],
          message: "a comparable source group must describe one labelled risk event",
        });
      }
    }
  });
export type QualityDatasetV1 = z.infer<typeof QualityDatasetV1Schema>;

interface QualitySampleLabelKeyV1 {
  readonly expectedPositive: boolean;
  readonly expectedEventKey: string;
}

/* -------------------------------------------------------------------------- */
/* D-02：确定性指标与逐项诊断                                                   */
/* -------------------------------------------------------------------------- */

export const QUALITY_SAMPLE_CLASSIFICATIONS_V1 = [
  "true-positive",
  "true-negative",
  "false-positive",
  "false-negative",
  "undetermined",
] as const;
export const QualitySampleClassificationV1Schema = z.enum(QUALITY_SAMPLE_CLASSIFICATIONS_V1);
export type QualitySampleClassificationV1 = z.infer<typeof QualitySampleClassificationV1Schema>;

/** 逐项诊断：TP/TN/FP/FN 与缺失/错版/拒权原因，不把失败样例丢出分母。 */
export const QualitySampleOutcomeV1Schema = z.strictObject({
  sampleId: IdentifierSchema,
  expectedEventKey: IdentifierSchema,
  expectedPositive: z.boolean(),
  classification: QualitySampleClassificationV1Schema,
  reasonCodes: z.array(QualityReasonCodeV1Schema),
  riskRecordId: IdentifierSchema.optional(),
  riskRecordVersionId: IdentifierSchema.optional(),
  recordIdentityVerified: z.boolean(),
  recordKeyMatched: z.boolean(),
  evidenceVerified: z.boolean(),
  replayConsistent: z.boolean().nullable(),
  expectedRiskLevelId: IdentifierSchema.optional(),
  actualRiskLevelId: IdentifierSchema.optional(),
});
export type QualitySampleOutcomeV1 = z.infer<typeof QualitySampleOutcomeV1Schema>;

export const QualityEnvironmentV1Schema = z.strictObject({
  nodeVersion: IdentifierSchema,
  platform: IdentifierSchema.optional(),
  browserVersion: IdentifierSchema.optional(),
});
export type QualityEnvironmentV1 = z.infer<typeof QualityEnvironmentV1Schema>;

/** 报告正文：冻结数据集/输出/配置 refs、逐项诊断、实际命令、代码 HEAD、环境与证据链状态。 */
export const QualityEvaluationReportV1Schema = z
  .strictObject({
    schemaVersion: z.literal(QUALITY_SCHEMA_VERSION_V1),
    projectId: IdentifierSchema,
    projectRevisionRef: ProjectRevisionRefV1Schema,
    datasetArtifactRef: ContentArtifactRefV1Schema,
    datasetId: IdentifierSchema,
    datasetVersion: IdentifierSchema,
    labelPolicyRef: VersionReferenceSchema,
    sampleKind: QualitySampleKindV1Schema,
    label: z.string(),
    runRefs: z.array(WorkflowRunRefV1Schema),
    metrics: z.array(QualityMetricV1Schema).length(QUALITY_METRIC_CODES_V1.length),
    samples: z.array(QualitySampleOutcomeV1Schema).min(1),
    commands: z.array(IdentifierSchema).min(1),
    codeHead: IdentifierSchema,
    environment: QualityEnvironmentV1Schema,
    evidenceChainStatus: z.enum(["complete", "partial"]),
    generatedAt: IsoDateTimeSchema,
    actorId: IdentifierSchema,
    commandId: IdentifierSchema,
  })
  .superRefine((report, context) => {
    if (
      new Set(report.metrics.map((metric) => metric.metricCode)).size !==
      QUALITY_METRIC_CODES_V1.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["metrics"],
        message: "a report must carry every metric exactly once",
      });
    }
    if (report.label !== qualitySyntheticLabelFor(report.sampleKind)) {
      context.addIssue({
        code: "custom",
        path: ["label"],
        message: "only synthetic reports may carry the fixed review label",
      });
    }
  });
export type QualityEvaluationReportV1 = z.infer<typeof QualityEvaluationReportV1Schema>;

/* -------------------------------------------------------------------------- */
/* 已授权读取证据：由 C36 adapter 有界读取并完整消费 C04 `verified` 后注入       */
/* -------------------------------------------------------------------------- */

/** C22 公开窄读结果；缺少它即身份不可核对，记证据失败而不计命中。 */
export interface QualityRecordIdentityV1 {
  readonly riskRecordId: string;
  readonly versionId: string;
  readonly requestDigest: string;
}

/** C22 正式记录快照（C04 冻结工件正文）；只有通过 C04 完整性校验才可能出现在证据包里。 */
export interface QualityRecordSnapshotV1 {
  readonly artifactRef: z.infer<typeof ContentArtifactRefV1Schema>;
  readonly envelope: StandardizedRiskRecordEnvelope;
}

/** C36 冻结的重放上下文工件正文：原版本化引擎上下文与原始审计元数据。 */
export const QualityReplayContextArtifactV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  context: z.unknown(),
  audit: z.strictObject({
    actorId: IdentifierSchema,
    recordedAt: IsoDateTimeSchema,
  }),
});
export type QualityReplayContextArtifactV1 = z.infer<typeof QualityReplayContextArtifactV1Schema>;

/** C29 正式输出：冻结决策工件正文、精确摘要与冻结重放上下文。 */
export interface QualityAssessmentEvidenceV1 {
  readonly decisionArtifactRef: z.infer<typeof ContentArtifactRefV1Schema>;
  readonly decision: AssessmentDecisionArtifactV1;
  readonly decisionDigest: string;
  readonly replay?: QualityReplayEvidenceV1;
}

export interface QualityReplayEvidenceV1 {
  readonly artifactRef: z.infer<typeof ContentArtifactRefV1Schema>;
  readonly context: AssessmentEngineContextV1;
  readonly audit: { readonly actorId: string; readonly recordedAt: string };
}

/** 单个样例的已授权证据包；任一缺项都以稳定原因码保留在分母。 */
export interface QualitySampleEvidenceV1 {
  readonly sampleId: string;
  readonly recordSnapshot?: QualityRecordSnapshotV1;
  readonly recordIdentity?: QualityRecordIdentityV1;
  readonly assessment?: QualityAssessmentEvidenceV1;
  /** 本次读取中通过 C04 `verified` 的精确工件引用。 */
  readonly verifiedEvidenceRefs: readonly z.infer<typeof ContentArtifactRefV1Schema>[];
}

export { AssessmentDecisionArtifactV1Schema, StandardizedRiskRecordEnvelopeSchema };
export type { AssessmentDecisionArtifactV1, AssessmentEngineContextV1 };
