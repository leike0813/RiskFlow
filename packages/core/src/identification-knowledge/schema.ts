import { z } from "zod";

import type { DomainEventV1 } from "@riskflow/contracts/events";

import {
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import {
  AgentTaskRefV1Schema,
  ContentArtifactRefV1Schema,
  DiagnosticArtifactRefV1Schema,
  IdentificationPreparationSnapshotRefV1Schema,
  KnowledgeReleaseRefV1Schema,
  KnowledgeRevisionRefV1Schema,
  ProcessModelReleaseRefV1Schema,
  RiskMechanismReleaseRefV1Schema,
  SourceSegmentSetRefV1Schema,
  SourceVersionRefV1Schema,
  WorkflowRunRefV1Schema,
  type AgentTaskRefV1,
  type AuthorizationContextRefV1,
  type AuthorizationContextV1,
  type IdentificationPreparationSnapshotRefV1,
  type IdentificationPolicySetRefV1,
  type KnowledgeRevisionRefV1,
  type KnowledgeReleaseRefV1,
  type ModuleErrorV1,
} from "@riskflow/contracts/ports";
import { ApplicabilityConditionsSchema } from "@riskflow/contracts/records";
import {
  IdentificationPreparationSnapshotV1Schema,
  type IdentificationPreparationSnapshotV1,
} from "@riskflow/contracts/workflows";
import {
  EquipmentComponentSchema,
  MonitoringIndicatorSchema,
  ProcessDependencyRelationTypeSchema,
  ProcessNodeSchema,
  RiskMechanismTypeSchema,
  StateParameterDescriptionSchema,
  StructuralComponentSchema,
} from "@riskflow/contracts/vocabulary";

import {
  AgentTaskBudgetPolicyV1Schema,
  AgentBudgetUsageV1Schema,
} from "../agent-runtime/schema.js";
import type { DataCleaningResultV1 } from "../engineering-data/cleaning/schema.js";
import type { TransactionContextV1 } from "../persistence/index.js";

export const IDENTIFICATION_KNOWLEDGE_SCHEMA_VERSION_V1 = "1" as const;
export const IDENTIFICATION_KNOWLEDGE_MAX_ENTRIES_V1 = 512;
export const IDENTIFICATION_KNOWLEDGE_MAX_EVIDENCE_PER_ENTRY_V1 = 16;
export const IDENTIFICATION_KNOWLEDGE_MAX_OPERATIONS_V1 = 64;

/** C17 拥有的五类识别知识定义身份；与 C02 知识定义类型词汇同源，不新建类型表。 */
export const IDENTIFICATION_KNOWLEDGE_DEFINITION_TYPES_V1 = [
  "process-model",
  "risk-mechanism",
  "standard-library",
  "case-library",
  "retrieval-evidence-base",
] as const;
export const IdentificationKnowledgeDefinitionTypeV1Schema = z.enum(
  IDENTIFICATION_KNOWLEDGE_DEFINITION_TYPES_V1,
);
export type IdentificationKnowledgeDefinitionTypeV1 = z.infer<
  typeof IdentificationKnowledgeDefinitionTypeV1Schema
>;

const identificationDefinitionTypeIndex: Readonly<Record<string, true>> = Object.fromEntries(
  IDENTIFICATION_KNOWLEDGE_DEFINITION_TYPES_V1.map((value) => [value, true]),
);

export const isIdentificationKnowledgeDefinitionTypeV1 = (
  value: unknown,
): value is IdentificationKnowledgeDefinitionTypeV1 =>
  typeof value === "string" && identificationDefinitionTypeIndex[value] === true;

/** 规范层级只允许国家、行业、企业三类；具体允许集合仍由版本身份校验策略给出。 */
export const STANDARD_LIBRARY_LEVEL_VALUES_V1 = ["national", "industry", "enterprise"] as const;
export const StandardLibraryLevelV1Schema = z.enum(STANDARD_LIBRARY_LEVEL_VALUES_V1);
export type StandardLibraryLevelV1 = z.infer<typeof StandardLibraryLevelV1Schema>;

/** 检索证据库组合固定且仅有的三个成员定义类型。 */
export const RETRIEVAL_EVIDENCE_BASE_MEMBER_DEFINITION_TYPES_V1 = [
  "risk-mechanism",
  "standard-library",
  "case-library",
] as const;

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const evidenceListSchema = z
  .array(EvidenceReferenceSchema)
  .min(1)
  .max(IDENTIFICATION_KNOWLEDGE_MAX_EVIDENCE_PER_ENTRY_V1);

const packageHeaderShape = {
  schemaVersion: z.literal(IDENTIFICATION_KNOWLEDGE_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  validationPolicyRef: VersionReferenceSchema,
  preparationSnapshotRef: IdentificationPreparationSnapshotRefV1Schema,
  generatedAt: IsoDateTimeSchema,
};

// ------------------------------------------------------------------ process model

export const ProcessModelNodeV1Schema = z.strictObject({
  nodeId: IdentifierSchema,
  processKind: ProcessNodeSchema,
  inputs: z.array(IdentifierSchema).min(1),
  outputs: z.array(IdentifierSchema).min(1),
  equipmentRefs: z.array(EquipmentComponentSchema),
  structuralComponentRefs: z.array(StructuralComponentSchema),
  stateParameters: z.array(StateParameterDescriptionSchema),
  monitoringIndicators: z.array(MonitoringIndicatorSchema),
  applicability: ApplicabilityConditionsSchema,
  evidence: evidenceListSchema,
});
export type ProcessModelNodeV1 = z.infer<typeof ProcessModelNodeV1Schema>;

export const ProcessModelDependencyEdgeV1Schema = z.strictObject({
  edgeId: IdentifierSchema,
  fromNodeId: IdentifierSchema,
  toNodeId: IdentifierSchema,
  relationType: ProcessDependencyRelationTypeSchema,
  evidence: evidenceListSchema,
});
export type ProcessModelDependencyEdgeV1 = z.infer<typeof ProcessModelDependencyEdgeV1Schema>;

export const ProcessModelPackageV1Schema = z.strictObject({
  ...packageHeaderShape,
  definitionType: z.literal("process-model"),
  nodes: z.array(ProcessModelNodeV1Schema).min(1).max(IDENTIFICATION_KNOWLEDGE_MAX_ENTRIES_V1),
  dependencyEdges: z
    .array(ProcessModelDependencyEdgeV1Schema)
    .max(IDENTIFICATION_KNOWLEDGE_MAX_ENTRIES_V1),
});
export type ProcessModelPackageV1 = z.infer<typeof ProcessModelPackageV1Schema>;

// ---------------------------------------------------------------- risk mechanism

export const RiskMechanismEntryV1Schema = z.strictObject({
  mechanismId: IdentifierSchema,
  mechanismType: RiskMechanismTypeSchema,
  nodeIds: z.array(IdentifierSchema).min(1),
  stateParameters: z.array(StateParameterDescriptionSchema),
  monitoringIndicators: z.array(MonitoringIndicatorSchema),
  applicability: ApplicabilityConditionsSchema,
  preconditions: z.array(IdentifierSchema).min(1),
  triggeringFactors: z.array(IdentifierSchema).min(1),
  evolutionPath: z.array(IdentifierSchema).min(1),
  consequences: z.array(IdentifierSchema).min(1),
  evidence: evidenceListSchema,
});
export type RiskMechanismEntryV1 = z.infer<typeof RiskMechanismEntryV1Schema>;

export const RiskMechanismPackageV1Schema = z.strictObject({
  ...packageHeaderShape,
  definitionType: z.literal("risk-mechanism"),
  processModelReleaseRef: ProcessModelReleaseRefV1Schema,
  mechanisms: z
    .array(RiskMechanismEntryV1Schema)
    .min(1)
    .max(IDENTIFICATION_KNOWLEDGE_MAX_ENTRIES_V1),
});
export type RiskMechanismPackageV1 = z.infer<typeof RiskMechanismPackageV1Schema>;

// --------------------------------------------------------------- standard, case

export const StandardLibraryEntryV1Schema = z.strictObject({
  entryId: IdentifierSchema,
  level: StandardLibraryLevelV1Schema,
  standardIdentity: IdentifierSchema,
  standardVersion: IdentifierSchema,
  clauseRefs: z.array(IdentifierSchema).min(1),
  applicability: ApplicabilityConditionsSchema,
  evidence: evidenceListSchema,
});
export type StandardLibraryEntryV1 = z.infer<typeof StandardLibraryEntryV1Schema>;

export const StandardLibraryPackageV1Schema = z.strictObject({
  ...packageHeaderShape,
  definitionType: z.literal("standard-library"),
  entries: z
    .array(StandardLibraryEntryV1Schema)
    .min(1)
    .max(IDENTIFICATION_KNOWLEDGE_MAX_ENTRIES_V1),
});
export type StandardLibraryPackageV1 = z.infer<typeof StandardLibraryPackageV1Schema>;

export const CaseLibraryEntryV1Schema = z.strictObject({
  entryId: IdentifierSchema,
  constructionMethod: IdentifierSchema,
  engineeringConditions: z.array(IdentifierSchema).min(1),
  process: z.array(IdentifierSchema).min(1),
  events: z.array(IdentifierSchema).min(1),
  outcomes: z.array(IdentifierSchema).min(1),
  treatments: z.array(IdentifierSchema).min(1),
  applicability: ApplicabilityConditionsSchema,
  evidence: evidenceListSchema,
});
export type CaseLibraryEntryV1 = z.infer<typeof CaseLibraryEntryV1Schema>;

export const CaseLibraryPackageV1Schema = z.strictObject({
  ...packageHeaderShape,
  definitionType: z.literal("case-library"),
  entries: z.array(CaseLibraryEntryV1Schema).min(1).max(IDENTIFICATION_KNOWLEDGE_MAX_ENTRIES_V1),
});
export type CaseLibraryPackageV1 = z.infer<typeof CaseLibraryPackageV1Schema>;

// ------------------------------------------------------- retrieval evidence base

export const RetrievalEvidenceBasePackageV1Schema = z.strictObject({
  ...packageHeaderShape,
  definitionType: z.literal("retrieval-evidence-base"),
  riskMechanismReleaseRef: RiskMechanismReleaseRefV1Schema,
  standardLibraryReleaseRef: KnowledgeReleaseRefV1Schema,
  caseLibraryReleaseRef: KnowledgeReleaseRefV1Schema,
});
export type RetrievalEvidenceBasePackageV1 = z.infer<typeof RetrievalEvidenceBasePackageV1Schema>;

export const IdentificationKnowledgePackageV1Schema = z.discriminatedUnion("definitionType", [
  ProcessModelPackageV1Schema,
  RiskMechanismPackageV1Schema,
  StandardLibraryPackageV1Schema,
  CaseLibraryPackageV1Schema,
  RetrievalEvidenceBasePackageV1Schema,
]);
export type IdentificationKnowledgePackageV1 = z.infer<
  typeof IdentificationKnowledgePackageV1Schema
>;

// ------------------------------------------------------------------ validation

export const IDENTIFICATION_KNOWLEDGE_CHECK_TARGET_KINDS_V1 = [
  "package",
  "node",
  "edge",
  "mechanism",
  "standard-entry",
  "case-entry",
  "composite-member",
] as const;
export const IdentificationKnowledgeCheckTargetKindV1Schema = z.enum(
  IDENTIFICATION_KNOWLEDGE_CHECK_TARGET_KINDS_V1,
);

export const IdentificationKnowledgeValidationItemV1Schema = z.strictObject({
  checkId: IdentifierSchema,
  targetKind: IdentificationKnowledgeCheckTargetKindV1Schema,
  targetId: IdentifierSchema,
  disposition: z.enum(["accepted", "rejected"]),
  rejectionClass: z.enum(["repairable", "terminal"]).optional(),
  reasonCode: IdentifierSchema,
  evidenceReferences: z.array(EvidenceReferenceSchema),
});
export type IdentificationKnowledgeValidationItemV1 = z.infer<
  typeof IdentificationKnowledgeValidationItemV1Schema
>;

export const IdentificationKnowledgeValidationReceiptV1Schema = z.strictObject({
  schemaVersion: z.literal(IDENTIFICATION_KNOWLEDGE_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  definitionType: IdentificationKnowledgeDefinitionTypeV1Schema,
  packageDigest: digestSchema,
  validationPolicyRef: VersionReferenceSchema,
  preparationSnapshotRef: IdentificationPreparationSnapshotRefV1Schema,
  items: z.array(IdentificationKnowledgeValidationItemV1Schema).min(1),
  disposition: z.enum(["accepted", "rejected"]),
  rejectionClass: z.enum(["repairable", "terminal"]).optional(),
  validationArtifactRef: ContentArtifactRefV1Schema,
  validatedAt: IsoDateTimeSchema,
});
export type IdentificationKnowledgeValidationReceiptV1 = z.infer<
  typeof IdentificationKnowledgeValidationReceiptV1Schema
>;

// ------------------------------------------------------------------- bindings

export const IDENTIFICATION_KNOWLEDGE_BINDING_KINDS_V1 = [
  "validated",
  "failure-review-only",
] as const;
export const IdentificationKnowledgeBindingKindV1Schema = z.enum(
  IDENTIFICATION_KNOWLEDGE_BINDING_KINDS_V1,
);

export const IdentificationKnowledgeRevisionBindingV1Schema = z.strictObject({
  schemaVersion: z.literal(IDENTIFICATION_KNOWLEDGE_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  definitionType: IdentificationKnowledgeDefinitionTypeV1Schema,
  revisionRef: KnowledgeRevisionRefV1Schema,
  bindingKind: IdentificationKnowledgeBindingKindV1Schema,
  validationArtifactRef: ContentArtifactRefV1Schema.optional(),
  packageDigest: digestSchema.optional(),
  authoringTaskRef: AgentTaskRefV1Schema.optional(),
  failureArtifactRef: DiagnosticArtifactRefV1Schema.optional(),
});
export type IdentificationKnowledgeRevisionBindingV1 = z.infer<
  typeof IdentificationKnowledgeRevisionBindingV1Schema
>;

export const IdentificationKnowledgeReleaseBindingV1Schema = z.strictObject({
  schemaVersion: z.literal(IDENTIFICATION_KNOWLEDGE_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  definitionType: IdentificationKnowledgeDefinitionTypeV1Schema,
  releaseRef: KnowledgeReleaseRefV1Schema,
  revisionRef: KnowledgeRevisionRefV1Schema,
  candidateArtifactRef: ContentArtifactRefV1Schema,
  compositeMemberReleaseRefs: z.array(KnowledgeReleaseRefV1Schema).length(3).optional(),
  boundAt: IsoDateTimeSchema,
});
export type IdentificationKnowledgeReleaseBindingV1 = z.infer<
  typeof IdentificationKnowledgeReleaseBindingV1Schema
>;

// ------------------------------------------------------------------- authoring

/**
 * D-08 编制清单的冻结成员：正式准备快照的每个来源版本与其保留资料段集合一一对应，
 * 保留/排除资料段标识取自正式清洗结果，后续工具请求只能落在这些成员之内。
 */
export const KnowledgeAuthoringManifestMemberV1Schema = z.strictObject({
  sourceVersionRef: SourceVersionRefV1Schema,
  sourceSegmentSetRef: SourceSegmentSetRefV1Schema,
  retainedSegmentIds: z.array(IdentifierSchema),
  excludedSegmentIds: z.array(IdentifierSchema),
});
export type KnowledgeAuthoringManifestMemberV1 = z.infer<
  typeof KnowledgeAuthoringManifestMemberV1Schema
>;

export const KnowledgeAuthoringManifestV1Schema = z.strictObject({
  schemaVersion: z.literal(IDENTIFICATION_KNOWLEDGE_SCHEMA_VERSION_V1),
  manifestId: IdentifierSchema,
  projectId: IdentifierSchema,
  targetDefinitionType: IdentificationKnowledgeDefinitionTypeV1Schema,
  preparationSnapshotRef: IdentificationPreparationSnapshotRefV1Schema,
  /** D-08：冻结 D-04 读到的 strict 准备快照与正式清洗结果工件，正文不进清单。 */
  preparation: IdentificationPreparationSnapshotV1Schema,
  cleaningResultArtifactRef: ContentArtifactRefV1Schema,
  members: z.array(KnowledgeAuthoringManifestMemberV1Schema).min(1),
  validationPolicyRef: VersionReferenceSchema,
  baseReleaseRef: KnowledgeReleaseRefV1Schema.optional(),
  baseArtifactRef: ContentArtifactRefV1Schema.optional(),
  parentRunRef: WorkflowRunRefV1Schema,
  authorizationContextRef: z.strictObject({
    kind: z.literal("authorization-context"),
    reference: VersionReferenceSchema,
  }),
  agent: z.strictObject({
    definitionRef: VersionReferenceSchema,
    modelDeploymentRef: VersionReferenceSchema,
    promptTemplateRef: VersionReferenceSchema,
    toolPolicyRef: VersionReferenceSchema,
    budgetPolicyRef: VersionReferenceSchema,
    incrementSchemaRef: VersionReferenceSchema,
    validationPolicyRef: VersionReferenceSchema,
  }),
  createdBy: IdentifierSchema,
  createdAt: IsoDateTimeSchema,
});
export type KnowledgeAuthoringManifestV1 = z.infer<typeof KnowledgeAuthoringManifestV1Schema>;

const authoringOperationBase = {
  expectedBaselineDigest: digestSchema,
  reasonCode: IdentifierSchema,
  evidence: evidenceListSchema,
};

const declareNodeOperation = z.strictObject({
  operation: z.literal("declare-node"),
  ...authoringOperationBase,
  node: ProcessModelNodeV1Schema,
});
const retireNodeOperation = z.strictObject({
  operation: z.literal("retire-node"),
  ...authoringOperationBase,
  nodeId: IdentifierSchema,
});
const declareEdgeOperation = z.strictObject({
  operation: z.literal("declare-edge"),
  ...authoringOperationBase,
  edge: ProcessModelDependencyEdgeV1Schema,
});
const retireEdgeOperation = z.strictObject({
  operation: z.literal("retire-edge"),
  ...authoringOperationBase,
  edgeId: IdentifierSchema,
});
const processModelOperationSchema = z.discriminatedUnion("operation", [
  declareNodeOperation,
  retireNodeOperation,
  declareEdgeOperation,
  retireEdgeOperation,
]);

const declareMechanismOperation = z.strictObject({
  operation: z.literal("declare-mechanism"),
  ...authoringOperationBase,
  mechanism: RiskMechanismEntryV1Schema,
});
const retireMechanismOperation = z.strictObject({
  operation: z.literal("retire-mechanism"),
  ...authoringOperationBase,
  mechanismId: IdentifierSchema,
});
const riskMechanismOperationSchema = z.discriminatedUnion("operation", [
  declareMechanismOperation,
  retireMechanismOperation,
]);

const citeClauseOperation = z.strictObject({
  operation: z.literal("cite-clause"),
  ...authoringOperationBase,
  entry: StandardLibraryEntryV1Schema,
});
const retireClauseOperation = z.strictObject({
  operation: z.literal("retire-clause"),
  ...authoringOperationBase,
  entryId: IdentifierSchema,
});
const standardLibraryOperationSchema = z.discriminatedUnion("operation", [
  citeClauseOperation,
  retireClauseOperation,
]);

const citeCaseOperation = z.strictObject({
  operation: z.literal("cite-case"),
  ...authoringOperationBase,
  entry: CaseLibraryEntryV1Schema,
});
const retireCaseOperation = z.strictObject({
  operation: z.literal("retire-case"),
  ...authoringOperationBase,
  entryId: IdentifierSchema,
});
const caseLibraryOperationSchema = z.discriminatedUnion("operation", [
  citeCaseOperation,
  retireCaseOperation,
]);

const selectMemberOperation = z.strictObject({
  operation: z.literal("select-member"),
  ...authoringOperationBase,
  memberDefinitionType: z.enum(RETRIEVAL_EVIDENCE_BASE_MEMBER_DEFINITION_TYPES_V1),
  memberReleaseRef: KnowledgeReleaseRefV1Schema,
});
const retrievalEvidenceBaseOperationSchema = z.discriminatedUnion("operation", [
  selectMemberOperation,
]);

/** 目标类型限定的封闭操作联合；禁止 JSON Patch、整对象覆盖和发布动作。 */
export const KnowledgeAuthoringOperationV1Schema = z.discriminatedUnion("operation", [
  declareNodeOperation,
  retireNodeOperation,
  declareEdgeOperation,
  retireEdgeOperation,
  declareMechanismOperation,
  retireMechanismOperation,
  citeClauseOperation,
  retireClauseOperation,
  citeCaseOperation,
  retireCaseOperation,
  selectMemberOperation,
]);
export type KnowledgeAuthoringOperationV1 = z.infer<typeof KnowledgeAuthoringOperationV1Schema>;

const authoringIncrementBase = {
  schemaVersion: z.literal(IDENTIFICATION_KNOWLEDGE_SCHEMA_VERSION_V1),
  candidateVersion: z.number().int().positive(),
};

export const KnowledgeAuthoringIncrementV1Schema = z.discriminatedUnion("definitionType", [
  z.strictObject({
    ...authoringIncrementBase,
    definitionType: z.literal("process-model"),
    operations: z
      .array(processModelOperationSchema)
      .min(1)
      .max(IDENTIFICATION_KNOWLEDGE_MAX_OPERATIONS_V1),
  }),
  z.strictObject({
    ...authoringIncrementBase,
    definitionType: z.literal("risk-mechanism"),
    operations: z
      .array(riskMechanismOperationSchema)
      .min(1)
      .max(IDENTIFICATION_KNOWLEDGE_MAX_OPERATIONS_V1),
  }),
  z.strictObject({
    ...authoringIncrementBase,
    definitionType: z.literal("standard-library"),
    operations: z
      .array(standardLibraryOperationSchema)
      .min(1)
      .max(IDENTIFICATION_KNOWLEDGE_MAX_OPERATIONS_V1),
  }),
  z.strictObject({
    ...authoringIncrementBase,
    definitionType: z.literal("case-library"),
    operations: z
      .array(caseLibraryOperationSchema)
      .min(1)
      .max(IDENTIFICATION_KNOWLEDGE_MAX_OPERATIONS_V1),
  }),
  z.strictObject({
    ...authoringIncrementBase,
    definitionType: z.literal("retrieval-evidence-base"),
    operations: z
      .array(retrievalEvidenceBaseOperationSchema)
      .length(RETRIEVAL_EVIDENCE_BASE_MEMBER_DEFINITION_TYPES_V1.length),
  }),
]);
export type KnowledgeAuthoringIncrementV1 = z.infer<typeof KnowledgeAuthoringIncrementV1Schema>;
export const KnowledgeAuthoringCandidateV1Schema = KnowledgeAuthoringIncrementV1Schema;
export type KnowledgeAuthoringCandidateV1 = KnowledgeAuthoringIncrementV1;

export const KnowledgeAuthoringFailureV1Schema = z.strictObject({
  schemaVersion: z.literal(IDENTIFICATION_KNOWLEDGE_SCHEMA_VERSION_V1),
  projectId: IdentifierSchema,
  targetDefinitionType: IdentificationKnowledgeDefinitionTypeV1Schema,
  preparationSnapshotRef: IdentificationPreparationSnapshotRefV1Schema,
  manifestArtifactRef: ContentArtifactRefV1Schema,
  taskRef: AgentTaskRefV1Schema.refine(
    (taskRef) => taskRef.taskType === "knowledge-authoring",
    "authoring failure requires a knowledge-authoring task",
  ),
  terminalStatus: z.enum(["terminal-failure", "cancelled"]),
  errorCodes: z.array(IdentifierSchema).min(1),
  actionRefs: z.array(VersionReferenceSchema),
  candidateRefs: z.array(ContentArtifactRefV1Schema),
  validationRefs: z.array(VersionReferenceSchema),
  usage: AgentBudgetUsageV1Schema,
  diagnosticArtifactRef: DiagnosticArtifactRefV1Schema,
  occurredAt: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
});
export type KnowledgeAuthoringFailureV1 = z.infer<typeof KnowledgeAuthoringFailureV1Schema>;

/** C08 动作协议：只允许有界只读切片、精确基线读取或提交类型化候选。 */
export const KnowledgeAuthoringSegmentSliceRequestV1Schema = z.strictObject({
  kind: z.literal("read-knowledge-segment-slice"),
  sourceSegmentSetRef: SourceSegmentSetRefV1Schema,
  sourceSegmentIds: z.array(IdentifierSchema).min(1),
  limit: z.number().int().positive(),
});
export type KnowledgeAuthoringSegmentSliceRequestV1 = z.infer<
  typeof KnowledgeAuthoringSegmentSliceRequestV1Schema
>;

export const KnowledgeAuthoringBaselineReadRequestV1Schema = z.strictObject({
  kind: z.literal("read-exact-knowledge"),
  definitionType: IdentificationKnowledgeDefinitionTypeV1Schema,
  releaseRef: KnowledgeReleaseRefV1Schema,
});
export type KnowledgeAuthoringBaselineReadRequestV1 = z.infer<
  typeof KnowledgeAuthoringBaselineReadRequestV1Schema
>;

export const KnowledgeAuthoringCandidateSubmissionV1Schema = z.strictObject({
  kind: z.literal("submit-knowledge-candidate"),
  candidate: KnowledgeAuthoringCandidateV1Schema,
});
export type KnowledgeAuthoringCandidateSubmissionV1 = z.infer<
  typeof KnowledgeAuthoringCandidateSubmissionV1Schema
>;

export const KnowledgeAuthoringActionV1Schema = z.discriminatedUnion("kind", [
  KnowledgeAuthoringSegmentSliceRequestV1Schema,
  KnowledgeAuthoringBaselineReadRequestV1Schema,
  KnowledgeAuthoringCandidateSubmissionV1Schema,
]);
export type KnowledgeAuthoringActionV1 = z.infer<typeof KnowledgeAuthoringActionV1Schema>;

/** C16 发布事务内由 C17 提供的治理接缝：与 C18 `appendRelease(context, input)` 同构。 */
export interface IdentificationKnowledgeGovernancePolicyV1 {
  appendRelease(
    context: TransactionContextV1,
    input: IdentificationKnowledgeReleaseAppendV1,
  ): Promise<readonly DomainEventV1[]>;
}

export interface IdentificationKnowledgeReleaseAppendV1 {
  readonly command: {
    readonly kind: "publish-approved-release" | "rollback-by-new-release";
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly authorizationContextRef: AuthorizationContextRefV1;
  };
  readonly revision: {
    readonly projectId: string;
    readonly definitionType: IdentificationKnowledgeDefinitionTypeV1;
    readonly revisionRef: KnowledgeRevisionRefV1;
    readonly candidateArtifactRef: ContentArtifactRefV1;
  };
  readonly releaseRef: KnowledgeReleaseRefV1;
  readonly audit: { readonly auditEntryId: string };
  readonly recordedAt: string;
  /** 发布要求的业务时刻：`publish` 用 `effectiveFrom`，`rollback` 用命令时刻。 */
  readonly requiredAt: string;
  /** 发布命令的 C06 上下文：策略只用于按发布引用复读已冻结内容与解析组合成员。 */
  readonly authorization: AuthorizationContextV1;
}

// ------------------------------------------------------- injected policy inputs
export const IdentificationKnowledgeCoverageRuleV1Schema = z.strictObject({
  processKind: ProcessNodeSchema,
  minimumMechanisms: z.number().int().nonnegative(),
  minimumEvidence: z.number().int().nonnegative(),
});
export type IdentificationKnowledgeCoverageRuleV1 = z.infer<
  typeof IdentificationKnowledgeCoverageRuleV1Schema
>;

/**
 * 版本化知识校验策略：关键工序覆盖门槛、允许层级/方法、条目上限和 C08 编制
 * 引用均由组合根以完整对象注入，禁止在业务逻辑中硬编码。
 */
export const IdentificationKnowledgeValidationPolicyV1Schema = z.strictObject({
  schemaVersion: z.literal(IDENTIFICATION_KNOWLEDGE_SCHEMA_VERSION_V1),
  policyRef: VersionReferenceSchema,
  criticalProcessKinds: z.array(ProcessNodeSchema).min(1),
  coverage: z.array(IdentificationKnowledgeCoverageRuleV1Schema).min(1),
  allowedStandardLevels: z.array(StandardLibraryLevelV1Schema).min(1),
  allowedCaseConstructionMethods: z.array(IdentifierSchema).min(1),
  maxEntriesPerPackage: z.number().int().positive().max(IDENTIFICATION_KNOWLEDGE_MAX_ENTRIES_V1),
  tools: z.strictObject({
    segmentSliceToolRef: VersionReferenceSchema,
    baselineKnowledgeToolRef: VersionReferenceSchema,
  }),
  agent: z.strictObject({
    definitionRef: VersionReferenceSchema,
    modelDeploymentRef: VersionReferenceSchema,
    promptTemplateRef: VersionReferenceSchema,
    toolPolicyRef: VersionReferenceSchema,
    budgetPolicyRef: VersionReferenceSchema,
    incrementSchemaRef: VersionReferenceSchema,
    validationPolicyRef: VersionReferenceSchema,
    budgetPolicy: AgentTaskBudgetPolicyV1Schema,
  }),
});
export type IdentificationKnowledgeValidationPolicyV1 = z.infer<
  typeof IdentificationKnowledgeValidationPolicyV1Schema
>;

/** 由 C21/C24 拥有并由组合根注入的识别策略集提供者；C17 不定义策略内容或默认值。 */
export interface IdentificationPolicySetProviderV1 {
  resolveExact(input: {
    readonly projectId: string;
    readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
    readonly requiredAt: string;
    readonly asOfRecordedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<IdentificationPolicySetRefV1 | undefined>;
}

/**
 * D-04 精确准备读取结果：与 C15 公开窄读 `readExactPreparation` 同形的 strict 聚合
 * （strict 准备快照、绑定任务、正式清洗结果与结果工件引用），错误已是 C17 领域错误。
 */
export type IdentificationPreparationExactReadV1 =
  | {
      readonly kind: "ok";
      readonly snapshot: IdentificationPreparationSnapshotV1;
      readonly agentTaskRef: AgentTaskRefV1;
      readonly result: DataCleaningResultV1;
      readonly resultArtifactRef: ContentArtifactRefV1;
    }
  | { readonly kind: "error"; readonly error: ModuleErrorV1 };

export interface IdentificationEvidenceDecisionV1 {
  readonly evidenceReference: EvidenceReferenceV1;
  readonly disposition: "eligible" | "rejected";
  readonly reasonCode: string;
}

/** C17 本地窄读接口：只组合 C15 精确准备窄读、C02 查询结果引用、切片和证据资格（D-04）。 */
export interface IdentificationPreparationKnowledgeReaderV1 {
  readExactPreparation(input: {
    readonly taskRef?: AgentTaskRefV1;
    readonly projectId: string;
    readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
    readonly actorId: string;
    readonly requestId: string;
    readonly requestedAt: string;
  }): Promise<IdentificationPreparationExactReadV1>;
  readSegmentSlice(input: {
    readonly taskRef?: AgentTaskRefV1;
    readonly projectId: string;
    readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
    readonly sourceSegmentSetRef: SourceSegmentSetRefV1;
    readonly segmentIds: readonly string[];
    readonly limit: number;
    readonly actorId: string;
    readonly requestId: string;
    readonly requestedAt: string;
  }): Promise<
    | { readonly kind: "succeeded"; readonly observation: JsonObjectV1 }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  >;
  checkEvidence(input: {
    readonly taskRef?: AgentTaskRefV1;
    readonly projectId: string;
    readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
    readonly evidenceReferences: readonly EvidenceReferenceV1[];
    readonly purposeCode: string;
    readonly actorId: string;
    readonly requestId: string;
    readonly requestedAt: string;
  }): Promise<
    | {
        readonly kind: "succeeded";
        readonly items: readonly IdentificationEvidenceDecisionV1[];
      }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  >;
}

/** C20/C24 的唯一消费面：按精确发布引用返回不可变包与治理元数据（D-12）。 */
export interface IdentificationKnowledgeReleaseReaderV1 {
  readExact(input: {
    readonly projectId: string;
    readonly releaseRef: KnowledgeReleaseRefV1;
    readonly actorId: string;
    readonly requestedAt: string;
    /** C06 调用身份；省略时使用由发布引用派生的稳定身份。 */
    readonly invocationId?: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<
    | { readonly kind: "succeeded"; readonly read: IdentificationKnowledgeExactReadV1 }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  >;
}

export interface IdentificationKnowledgeExactReadV1 {
  readonly package: IdentificationKnowledgePackageV1;
  readonly validation: IdentificationKnowledgeValidationReceiptV1;
  readonly releaseBinding: IdentificationKnowledgeReleaseBindingV1;
}

type SourceSegmentSetRefV1 = z.infer<typeof SourceSegmentSetRefV1Schema>;
type EvidenceReferenceV1 = z.infer<typeof EvidenceReferenceSchema>;
type ContentArtifactRefV1 = z.infer<typeof ContentArtifactRefV1Schema>;
type JsonObjectV1 = { readonly [key: string]: unknown };
