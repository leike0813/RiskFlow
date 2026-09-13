import { z } from "zod";

import type { DomainEventV1 } from "@riskflow/contracts/events";
import { IdentifierSchema, VersionReferenceSchema } from "@riskflow/contracts/common";
import type { VersionReference } from "@riskflow/contracts/common";
import {
  type AgentTaskResultRefV1,
  type AuthorizationContextRefV1,
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type KnowledgeReleaseRefV1,
  type KnowledgeRevisionRefV1,
  type ModuleErrorV1,
  type ProjectRevisionRefV1,
  type WaitingRefV1,
} from "@riskflow/contracts/ports";

import {
  AgentTaskDefinitionMetadataV1Schema,
  AgentValidationResultV1Schema,
  type AgentDomainToolExecutionContextV1,
  type AgentDomainToolResultV1,
  type AgentTaskDefinitionV1,
  type AgentTaskSnapshotV1,
} from "../agent-runtime/index.js";
import type { ArtifactRefV1 } from "../artifacts/index.js";
import type { TransactionContextV1 } from "../persistence/index.js";
import {
  ScoringRuleActionV1Schema,
  ScoringRuleAuthoringCandidateV1Schema,
  ScoringRuleAuthoringIncrementV1Schema,
  ScoringRuleIndicatorCatalogSliceRequestV1Schema,
  ScoringRuleStandardSegmentSliceRequestV1Schema,
  SCORING_RULE_AUTHORING_TASK_TYPE_V1,
  type AssessmentBasisReleaseSetReadResultV1,
  type ReadAssessmentBasisReleaseSetV1,
  type ScoringRuleAuthoringCandidateV1,
  type ScoringRuleAuthoringManifestV1,
  type ScoringRuleIndicatorCatalogSliceRequestV1,
  type ScoringRuleStandardSegmentSliceRequestV1,
  type ScoringRuleValidationViewV1,
  type ScoringRulesPolicyV1,
} from "./schema.js";
import type { ScoringRuleRelationTemplateSnapshotV1 } from "./validation.js";

/* -------------------------------------------------------------------------- */
/* C19 governance policy seam (D-08)                                          */
/* -------------------------------------------------------------------------- */

export const SCORING_RULE_DEFINITION_TYPE_V1 = "structured-scoring-rule" as const;
export const APPLICABLE_RULE_SET_DEFINITION_TYPE_V1 = "applicable-rule-set" as const;

export type ScoringRulesDefinitionTypeV1 =
  typeof SCORING_RULE_DEFINITION_TYPE_V1 | typeof APPLICABLE_RULE_SET_DEFINITION_TYPE_V1;

export const isScoringRulesDefinitionTypeV1 = (
  value: unknown,
): value is ScoringRulesDefinitionTypeV1 =>
  value === SCORING_RULE_DEFINITION_TYPE_V1 || value === APPLICABLE_RULE_SET_DEFINITION_TYPE_V1;

export interface SubmitScoringRuleRevisionV1 {
  readonly projectId: string;
  readonly definitionType: ScoringRulesDefinitionTypeV1;
  readonly candidateArtifactRef: ContentArtifactRefV1;
  readonly authorization: AuthorizationContextV1;
  /** C16 命令声明的精确比较基线；缺省表示按当前有效发布解析。 */
  readonly baseReleaseRef?: KnowledgeReleaseRefV1;
}

/** C04 校验后冻结的内容摘要；正文只存在于工件中。 */
export interface PreparedScoringRuleV1 {
  readonly definitionType: ScoringRulesDefinitionTypeV1;
  readonly projectRevisionRef: ProjectRevisionRefV1;
  readonly compatibilityRef: VersionReference;
  readonly contentDigest: string;
  readonly itemCount: number;
  /** `structured-scoring-rule` 的发布前冲突/重叠快照；该类型之外为空。 */
  readonly relationSnapshot?: ScoringRuleRelationTemplateSnapshotV1;
}

export interface ScoringRuleRevisionAppendV1 {
  readonly revisionRef: KnowledgeRevisionRefV1;
  readonly commandId: string;
  readonly projectId: string;
  readonly definitionType: ScoringRulesDefinitionTypeV1;
  readonly candidateArtifactRef: ContentArtifactRefV1;
  readonly prepared: PreparedScoringRuleV1;
  readonly auditEntryId: string;
  readonly persistedAt: string;
}

export interface ScoringRuleRevisionMetadataAssertionV1 {
  readonly projectId: string;
  readonly revisionRef: KnowledgeRevisionRefV1;
  readonly authorization: AuthorizationContextV1;
  /** C16 revision 行上精确的比较基线；C19 用它核对检测快照的基线。 */
  readonly baseReleaseRef?: KnowledgeReleaseRefV1;
  readonly baseRevisionRef?: KnowledgeRevisionRefV1;
}

export interface PublishOrRollbackScoringRuleV1 {
  readonly kind: "publish-approved-release" | "rollback-by-new-release";
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly issuedAt: string;
  readonly authorizationContextRef: AuthorizationContextRefV1;
  /** 已由 C16 按当前事实复验的授权：仅用于发布门禁内的 C07 决定读取。 */
  readonly authorization: AuthorizationContextV1;
  /** C16 revision 行上精确的比较基线；C19 用它核对检测快照的基线。 */
  readonly baseReleaseRef?: KnowledgeReleaseRefV1;
  readonly baseRevisionRef?: KnowledgeRevisionRefV1;
}

export interface ScoringRuleReleaseAppendV1 {
  readonly command: PublishOrRollbackScoringRuleV1;
  readonly revisionRef: KnowledgeRevisionRefV1;
  readonly definitionType: ScoringRulesDefinitionTypeV1;
  readonly candidateArtifactRef: ContentArtifactRefV1;
  readonly releaseRef: KnowledgeReleaseRefV1;
  readonly audit: {
    readonly auditEntryId: string;
    readonly version: VersionReference;
  };
  readonly recordedAt: string;
}

export interface ScoringRulesGovernancePolicyV1 {
  prepareRevision(command: SubmitScoringRuleRevisionV1): Promise<PreparedScoringRuleV1>;
  appendPreparedRevision(
    context: TransactionContextV1,
    input: ScoringRuleRevisionAppendV1,
  ): Promise<void>;
  assertRevisionMetadata(input: ScoringRuleRevisionMetadataAssertionV1): Promise<void>;
  appendRelease(
    context: TransactionContextV1,
    input: ScoringRuleReleaseAppendV1,
  ): Promise<DomainEventV1[]>;
}

/* -------------------------------------------------------------------------- */
/* Bounded authoring task seam                                                */
/* -------------------------------------------------------------------------- */

export interface ScoringRuleAuthoringTaskPortV1 {
  loadAuthoringManifest(task: AgentTaskSnapshotV1): Promise<{
    readonly manifest: ScoringRuleAuthoringManifestV1;
    readonly manifestArtifactRef: ContentArtifactRefV1;
    readonly manifestDigest: string;
  }>;
  readStandardSegmentSlice(
    input: ScoringRuleStandardSegmentSliceRequestV1,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1>;
  readIndicatorCatalogSlice(
    input: ScoringRuleIndicatorCatalogSliceRequestV1,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1>;
  validateAuthoringCandidate(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: ScoringRuleAuthoringCandidateV1;
  }): Promise<{
    readonly validation: ScoringRuleValidationViewV1;
    readonly validationArtifactRef: ArtifactRefV1;
  }>;
  finalizeAuthoringCandidate(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: ScoringRuleAuthoringCandidateV1;
  }): Promise<AgentTaskResultRefV1>;
}

export interface CreateScoringRuleAuthoringTaskDefinitionOptionsV1 {
  readonly policy: ScoringRulesPolicyV1;
  readonly port: ScoringRuleAuthoringTaskPortV1;
  readonly now?: () => Date;
}

/**
 * 组装 `knowledge-authoring` 的 C19 任务定义：白名单只含两个有界只读领域工具，
 * 候选只允许规则级 add/replace，正式修订由注入端口提交 C16。
 */
export const createScoringRuleAuthoringTaskDefinition = (
  options: CreateScoringRuleAuthoringTaskDefinitionOptionsV1,
): AgentTaskDefinitionV1 => {
  const policy = options.policy;
  const port = options.port;
  const now = options.now ?? (() => new Date());

  return {
    metadata: AgentTaskDefinitionMetadataV1Schema.parse({
      schemaVersion: "1",
      definitionRef: policy.agent.definitionRef,
      taskType: SCORING_RULE_AUTHORING_TASK_TYPE_V1,
      toolPolicyRef: policy.agent.toolPolicyRef,
      incrementSchemaRef: policy.agent.incrementSchemaRef,
      validationPolicyRef: policy.agent.validationPolicyRef,
      supportedTriggerModes: ["embedded", "interactive"],
      allowedToolRefs: [policy.tools.standardSegmentToolRef, policy.tools.indicatorCatalogToolRef],
      resultFamilies: ["knowledge-revision"],
    }),
    budgetPolicy: policy.agent.budgetPolicy,
    actionSchema: ScoringRuleActionV1Schema,
    incrementSchema: ScoringRuleAuthoringIncrementV1Schema,
    candidateSchema: ScoringRuleAuthoringCandidateV1Schema,
    tools: [
      {
        toolRef: policy.tools.standardSegmentToolRef,
        budgetUsage: {},
        execute: (input, context) =>
          port.readStandardSegmentSlice(
            ScoringRuleStandardSegmentSliceRequestV1Schema.parse(input),
            context,
          ),
      },
      {
        toolRef: policy.tools.indicatorCatalogToolRef,
        budgetUsage: {},
        execute: (input, context) =>
          port.readIndicatorCatalogSlice(
            ScoringRuleIndicatorCatalogSliceRequestV1Schema.parse(input),
            context,
          ),
      },
    ],
    measureCandidateUsage: (candidate) => {
      const typed = ScoringRuleAuthoringCandidateV1Schema.parse(candidate);
      return { candidates: 1, objects: typed.operations.length };
    },
    validateCandidate: async (candidate, context) => {
      const typed = ScoringRuleAuthoringCandidateV1Schema.parse(candidate);
      const { validation, validationArtifactRef } = await port.validateAuthoringCandidate({
        task: context,
        candidate: typed,
      });
      return AgentValidationResultV1Schema.parse({
        schemaVersion: "1",
        items: validation.items,
        disposition: validation.disposition,
        ...(validation.rejectionClass === undefined
          ? {}
          : { rejectionClass: validation.rejectionClass }),
        validationArtifactRef,
        validatedAt: now().toISOString(),
      });
    },
    finalizeCandidate: async (candidate, context) =>
      port.finalizeAuthoringCandidate({
        task: context,
        candidate: ScoringRuleAuthoringCandidateV1Schema.parse(candidate),
      }),
  };
};

/* -------------------------------------------------------------------------- */
/* Injected preparation snapshot reader (D-10)                                */
/* -------------------------------------------------------------------------- */

/**
 * C25 拥有的评估准备快照在 C19 侧的严格投影：只含装配与冻结所需的精确字段。
 * 该投影由注入的 `AssessmentPreparationSnapshotReaderV1` 提供，C19 不实现其存储。
 */
export const AssessmentPreparationProjectionV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  preparationSnapshotRef: z.strictObject({
    kind: z.literal("assessment-preparation-snapshot"),
    reference: VersionReferenceSchema,
  }),
  projectId: IdentifierSchema,
  projectRevisionRef: z.strictObject({
    kind: z.literal("project-revision"),
    reference: VersionReferenceSchema,
  }),
  applicabilitySnapshotRef: z.strictObject({
    kind: z.literal("applicability-metadata-snapshot"),
    reference: VersionReferenceSchema,
  }),
  applicability: z.strictObject({
    constructionMethod: IdentifierSchema,
    stratumCondition: IdentifierSchema,
    engineeringStage: IdentifierSchema,
  }),
  cleaningResultArtifactRef: z.strictObject({
    kind: z.literal("content-artifact"),
    reference: VersionReferenceSchema,
  }),
  dataCleaningTaskRef: z.strictObject({
    kind: z.literal("agent-task"),
    reference: VersionReferenceSchema,
    taskType: z.literal("data-cleaning"),
    triggerMode: z.enum(["embedded", "interactive"]),
    modelDeploymentRef: VersionReferenceSchema,
    promptTemplateRef: VersionReferenceSchema,
    toolPolicyRef: VersionReferenceSchema,
    budgetPolicyRef: VersionReferenceSchema,
    incrementSchemaRef: VersionReferenceSchema,
    validationPolicyRef: VersionReferenceSchema,
  }),
  configurationSetRef: VersionReferenceSchema,
  compatibilityRef: VersionReferenceSchema,
  requiredAt: IdentifierSchema,
  asOfRecordedAt: IdentifierSchema,
});
export type AssessmentPreparationProjectionV1 = z.infer<
  typeof AssessmentPreparationProjectionV1Schema
>;

export interface AssessmentPreparationSnapshotReaderV1 {
  readAssessmentPreparationSnapshot(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestId: string;
    readonly idempotencyKey: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly preparationSnapshotRef: {
      readonly kind: string;
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
    readonly requiredAt: string;
  }): Promise<
    | { readonly kind: "succeeded"; readonly projection: AssessmentPreparationProjectionV1 }
    | { readonly kind: "waiting"; readonly waiting: WaitingRefV1 }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  >;
}

/** 进程内消费方（C25 等）注入的狭窄成员读取入口。 */
export interface AssessmentBasisReleaseSetReaderV1 {
  readAssessmentBasisReleaseSet(
    input: ReadAssessmentBasisReleaseSetV1,
  ): Promise<AssessmentBasisReleaseSetReadResultV1>;
}
