import type { z } from "zod";

import type {
  AuthorizationContextV1,
  KnowledgeRetrievalQueryV1,
  KnowledgeRetrievalResultV1,
  MeasureLibraryReleaseRefV1,
  RecommendationCommandV1,
  RecommendationResultV1,
  ResponseRecommendationRefV1,
  RiskInputVersionRefV1,
  SpatialScopeRefV1,
  WarningRecordRefV1,
  WarningResponseTaskRefV1,
  ContractReferenceV1,
  AgentTaskResultRefV1,
} from "@riskflow/contracts/ports";
import type { MeasureItem, TargetIndicator } from "@riskflow/contracts/records";
import { ResponseRecommendationSchema } from "@riskflow/contracts/records";
import type { AuditInfo, VersionedRecordInfo, VersionReference } from "@riskflow/contracts/common";
import type { WarningTriggerType } from "@riskflow/contracts/vocabulary";

import {
  AgentTaskDefinitionMetadataV1Schema,
  AgentValidationResultV1Schema,
  type AgentTaskDefinitionV1,
  type AgentTaskSnapshotV1,
  type AgentValidationResultV1,
} from "../agent-runtime/index.js";
import {
  MeasureLibraryContentV1Schema,
  selectMeasureCandidates,
  type ApplicabilityConditionV1,
  type MeasureLibraryContentV1,
} from "../assessment-config/index.js";
import { sha256CanonicalJson } from "../persistence/index.js";
import {
  MeasureCandidateSetV1Schema,
  RECOMMENDATION_TASK_TYPE_V1,
  ResponseRecommendationIncrementV1Schema,
  failRecommendation,
  recommendationValidationPassed,
  type MeasureCandidateSetV1,
  type MeasureCandidateV1,
  type RecommendationCandidateV1,
  type RecommendationFrozenWarningV1,
  type RecommendationSiteContextV1,
  type RecommendationValidationEvidenceV1,
  type RecommendationValidationResultsV1,
  type ResponseAgentPolicyV1,
  type ResponseGenerationPolicyV1,
  type ResponseRecommendationIncrementV1,
  type ResponseValidationPolicyV1,
} from "./schema.js";

/* -------------------------------------------------------------------------- */
/* 冻结候选：按预警逐项求交并合并（D-03）                                       */
/* -------------------------------------------------------------------------- */

export interface SelectFrozenMeasuresInputV1 {
  readonly library: MeasureLibraryContentV1;
  readonly riskEventCategory: string;
  readonly applicability: readonly ApplicabilityConditionV1[];
  readonly warnings: readonly {
    readonly warningRecordRef: WarningRecordRefV1;
    readonly triggerType: WarningTriggerType;
  }[];
}

/**
 * 纯合并：逐条预警调用 C18 已归档筛选，再按措施身份合并触发关系。
 * 同一措施可关联多条预警；结果按措施 ID 排序，不补默认措施，不做宽松匹配。
 */
export const selectFrozenMeasures = (
  input: SelectFrozenMeasuresInputV1,
): readonly MeasureCandidateV1[] => {
  const library = MeasureLibraryContentV1Schema.parse(input.library);
  const byMeasureId = new Map<string, MeasureCandidateV1>();
  for (const warning of input.warnings) {
    const measureIds = selectMeasureCandidates({
      library,
      riskEventCategory: input.riskEventCategory,
      applicability: input.applicability,
      triggerType: warning.triggerType,
    });
    for (const measureId of measureIds) {
      const measure = library.measures.find((candidate) => candidate.measureId === measureId);
      if (measure === undefined) continue;
      const existing = byMeasureId.get(measureId);
      if (existing === undefined) {
        byMeasureId.set(measureId, {
          measure,
          triggerTypes: [warning.triggerType],
          warningRecordRefs: [warning.warningRecordRef],
        });
        continue;
      }
      byMeasureId.set(measureId, {
        measure: existing.measure,
        triggerTypes: [...new Set([...existing.triggerTypes, warning.triggerType])].sort(),
        warningRecordRefs: [...existing.warningRecordRefs, warning.warningRecordRef].sort(
          (left, right) =>
            left.reference.entityId < right.reference.entityId
              ? -1
              : left.reference.entityId > right.reference.entityId
                ? 1
                : left.reference.versionId < right.reference.versionId
                  ? -1
                  : 1,
        ),
      });
    }
  }
  return [...byMeasureId.values()].sort((left, right) =>
    left.measure.measureId < right.measure.measureId ? -1 : 1,
  );
};

/** 冻结输入摘要：同一工程/任务版本/措施发布/输入对应同一逻辑候选集。 */
export const measureCandidateInputDigest = (input: {
  readonly projectId: string;
  readonly warningResponseTaskRef: WarningResponseTaskRefV1;
  readonly riskInputRef: RiskInputVersionRefV1;
  readonly measureLibraryReleaseRef: MeasureLibraryReleaseRefV1;
  readonly generationPolicyRef: VersionReference;
  readonly riskEventCategory: string;
  readonly warnings: readonly RecommendationFrozenWarningV1[];
}): string =>
  sha256CanonicalJson({
    projectId: input.projectId,
    warningResponseTaskRef: input.warningResponseTaskRef,
    riskInputRef: input.riskInputRef,
    measureLibraryReleaseRef: input.measureLibraryReleaseRef,
    generationPolicyRef: input.generationPolicyRef,
    riskEventCategory: input.riskEventCategory,
    warnings: input.warnings.map((warning) => ({
      warningRecordRef: warning.warningRecordRef,
      triggerType: warning.triggerType,
      assessmentRecordRef: warning.assessmentRecordRef,
      assessmentInputSnapshotRef: warning.assessmentInputSnapshotRef,
      preparationSnapshotRef: warning.preparationSnapshotRef,
    })),
  });

/** 主预警引用：规范选择预警引用排序后的首条；公共记录只能承载单值。 */
export const primaryWarningRecordRef = (
  warnings: readonly RecommendationFrozenWarningV1[],
): WarningRecordRefV1 => {
  const ordered = [...warnings].sort((left, right) =>
    left.warningRecordRef.reference.entityId < right.warningRecordRef.reference.entityId
      ? -1
      : left.warningRecordRef.reference.entityId > right.warningRecordRef.reference.entityId
        ? 1
        : left.warningRecordRef.reference.versionId < right.warningRecordRef.reference.versionId
          ? -1
          : 1,
  );
  const primary = ordered[0];
  if (primary === undefined) {
    throw new Error("recommendation requires at least one frozen warning");
  }
  return primary.warningRecordRef;
};

/* -------------------------------------------------------------------------- */
/* 三项确定性校验（D-07）                                                      */
/* -------------------------------------------------------------------------- */

export const RECOMMENDATION_CHECK_IDS_V1 = [
  "trigger-consistency",
  "standards-compliance",
  "site-feasibility",
] as const;
export type RecommendationCheckIdV1 = (typeof RECOMMENDATION_CHECK_IDS_V1)[number];

export interface RecommendationDiagnosticV1 {
  readonly checkId: RecommendationCheckIdV1;
  readonly reasonCode: string;
  readonly passed: boolean;
  readonly references: readonly ContractReferenceV1[];
}

export interface RecommendationValidationOutcomeV1 {
  readonly results: RecommendationValidationResultsV1;
  readonly diagnostics: readonly RecommendationDiagnosticV1[];
  readonly selections: readonly {
    readonly measureId: string;
    readonly order: number;
    readonly measure: MeasureCandidateV1;
  }[];
  readonly targetIndicators: readonly TargetIndicator[];
  readonly resourceRequirements: readonly string[];
  readonly measureItems: readonly MeasureItem[];
  readonly implementationOrder: readonly string[];
}

export interface ValidateRecommendationCandidateInputV1 {
  readonly candidateSet: MeasureCandidateSetV1;
  readonly selections: readonly { readonly measureId: string; readonly order: number }[];
  readonly validationPolicy: ResponseValidationPolicyV1;
  readonly siteContext: RecommendationSiteContextV1;
}

const issue = (reasonCode: string, detail: string): string => `${reasonCode}: ${detail}`;

const sameWarning = (left: WarningRecordRefV1, right: WarningRecordRefV1): boolean =>
  left.reference.entityId === right.reference.entityId &&
  left.reference.versionId === right.reference.versionId;

const targetValueByIndicator = (
  policy: ResponseValidationPolicyV1,
): ReadonlyMap<string, string | number | boolean> =>
  new Map(policy.targetIndicators.map((entry) => [entry.indicatorItem, entry.targetValue]));

const reviewedEvidenceFor = (
  policy: ResponseValidationPolicyV1,
  measureId: string,
): ReadonlySet<string> =>
  new Set(
    policy.reviewedStandardEvidence
      .filter((entry) => entry.measureId === measureId)
      .map((entry) => entry.evidenceItem),
  );

const activeContraindications = (
  policy: ResponseValidationPolicyV1,
  triggerTypes: readonly WarningTriggerType[],
): ReadonlySet<string> =>
  new Set(
    policy.contraindicationRules
      .filter((rule) => rule.triggerTypes.some((triggerType) => triggerTypes.includes(triggerType)))
      .map((rule) => rule.contraindicationId),
  );

/**
 * 纯确定性顺序校验：触发指标一致性 → 规范合规性 → 现场资源与工序可执行性。
 * 三步都执行以留下完整诊断；任一失败不生成正式记录，也不做宽松兜底。
 */
export const validateRecommendationCandidate = (
  input: ValidateRecommendationCandidateInputV1,
): RecommendationValidationOutcomeV1 => {
  const candidateSet = MeasureCandidateSetV1Schema.parse(input.candidateSet);
  const policy = input.validationPolicy;
  const siteContext = input.siteContext;
  const measureById = new Map(
    candidateSet.candidates.map((candidate) => [candidate.measure.measureId, candidate]),
  );
  const selections = [...input.selections]
    .sort((left, right) => left.order - right.order)
    .flatMap((selection) => {
      const candidate = measureById.get(selection.measureId);
      return candidate === undefined
        ? []
        : [{ measureId: selection.measureId, order: selection.order, measure: candidate }];
    });

  const diagnostics: RecommendationDiagnosticV1[] = [];
  const targetValues = targetValueByIndicator(policy);

  /* 1) 触发指标一致性：目标值只取甲方审核策略，且匹配预警的触发指标必须被覆盖。 */
  const triggerIssues: string[] = [];
  for (const selection of selections) {
    for (const indicatorItem of selection.measure.measure.targetIndicatorIds) {
      if (!targetValues.has(indicatorItem)) {
        triggerIssues.push(
          issue("target-indicator-unavailable", `${selection.measureId}/${indicatorItem}`),
        );
        diagnostics.push({
          checkId: "trigger-consistency",
          reasonCode: "target-indicator-unavailable",
          passed: false,
          references: [...selection.measure.warningRecordRefs],
        });
      }
    }
    for (const warning of candidateSet.warnings) {
      const matched = selection.measure.warningRecordRefs.some((ref) =>
        sameWarning(ref, warning.warningRecordRef),
      );
      if (!matched) continue;
      for (const trigger of warning.triggerIndicators) {
        if (!targetValues.has(trigger.indicatorItem)) {
          triggerIssues.push(
            issue(
              "trigger-indicator-uncovered",
              `${selection.measureId}/${warning.warningRecordRef.reference.entityId}/${trigger.indicatorItem}`,
            ),
          );
          diagnostics.push({
            checkId: "trigger-consistency",
            reasonCode: "trigger-indicator-uncovered",
            passed: false,
            references: [warning.warningRecordRef],
          });
        }
      }
    }
  }

  /* 2) 规范合规性：规范证据必须被已审核许可覆盖，且已触发禁忌不得命中。 */
  const standardIssues: string[] = [];
  for (const selection of selections) {
    const reviewed = reviewedEvidenceFor(policy, selection.measureId);
    for (const evidenceItem of selection.measure.measure.evidenceRequirements) {
      if (!reviewed.has(evidenceItem)) {
        standardIssues.push(
          issue("standard-evidence-unavailable", `${selection.measureId}/${evidenceItem}`),
        );
      }
    }
    const active = activeContraindications(policy, selection.measure.triggerTypes);
    for (const contraindication of selection.measure.measure.contraindications) {
      if (active.has(contraindication)) {
        standardIssues.push(
          issue("contraindication-triggered", `${selection.measureId}/${contraindication}`),
        );
      }
    }
  }

  /* 3) 现场资源与工序可执行性：资源、工序状态与现场约束都必须满足。 */
  const siteIssues: string[] = [];
  const availableResources = new Set(siteContext.availableResources);
  for (const selection of selections) {
    for (const resource of selection.measure.measure.resourceRequirements) {
      if (!availableResources.has(resource)) {
        siteIssues.push(issue("resource-unavailable", `${selection.measureId}/${resource}`));
      }
    }
  }
  if (!policy.executableProcessStatuses.includes(siteContext.processStatus)) {
    siteIssues.push(issue("process-not-executable", siteContext.processStatus));
  }
  const siteConstraints = new Set(siteContext.constraints);
  for (const selection of selections) {
    for (const contraindication of selection.measure.measure.contraindications) {
      if (siteConstraints.has(contraindication)) {
        siteIssues.push(issue("site-constraint-hit", `${selection.measureId}/${contraindication}`));
      }
    }
  }

  const results: RecommendationValidationResultsV1 = {
    triggerConsistency: { passed: triggerIssues.length === 0, issues: triggerIssues },
    standardsCompliance: { passed: standardIssues.length === 0, issues: standardIssues },
    siteFeasibility: { passed: siteIssues.length === 0, issues: siteIssues },
  };

  const resourceRequirements = [
    ...new Set(selections.flatMap((selection) => selection.measure.measure.resourceRequirements)),
  ].sort();
  const measureItems = selections.map((selection) => ({
    measureId: selection.measureId,
    content: [...selection.measure.measure.steps]
      .sort((left, right) => left.stepOrdinal - right.stepOrdinal)
      .map((step) => step.instruction)
      .join(" "),
  }));
  const coveredIndicators = new Set(
    selections.flatMap((selection) => selection.measure.measure.targetIndicatorIds),
  );
  const targetIndicators = policy.targetIndicators
    .filter((entry) => coveredIndicators.has(entry.indicatorItem))
    .map((entry) => ({ indicatorItem: entry.indicatorItem, targetValue: entry.targetValue }));

  return {
    results,
    diagnostics,
    selections,
    targetIndicators,
    resourceRequirements,
    measureItems,
    implementationOrder: selections.map((selection) => selection.measureId),
  };
};

/** 校验证据快照：三项独立结果、目标值、资源与完整诊断。 */
export const buildRecommendationValidationEvidence = (input: {
  readonly projectId: string;
  readonly candidate: RecommendationCandidateV1;
  readonly validationPolicyRef: VersionReference;
  readonly siteContextRef: VersionReference;
  readonly outcome: RecommendationValidationOutcomeV1;
  readonly validatedBy: string;
  readonly validatedAt: string;
}): RecommendationValidationEvidenceV1 => ({
  schemaVersion: "1",
  projectId: input.projectId,
  candidateRef: input.candidate.candidateRef,
  validationPolicyRef: input.validationPolicyRef,
  siteContextRef: input.siteContextRef,
  targetIndicators: input.outcome.targetIndicators.map((entry) => ({ ...entry })),
  resourceRequirements: [...input.outcome.resourceRequirements],
  results: input.outcome.results,
  diagnostics: input.outcome.diagnostics.map((diagnostic) => ({
    checkId: diagnostic.checkId,
    reasonCode: diagnostic.reasonCode,
    passed: diagnostic.passed,
    references: [...diagnostic.references],
  })),
  validatedBy: input.validatedBy,
  validatedAt: input.validatedAt,
});

/** 公共正式记录正文：只接受三项全过的校验结果，不补占位值。 */
export const buildResponseRecommendationRecord = (input: {
  readonly recommendationRef: ResponseRecommendationRefV1;
  readonly primaryWarningRecordRef: WarningRecordRefV1;
  readonly outcome: RecommendationValidationOutcomeV1;
  readonly actorId: string;
  readonly recordedAt: string;
}): z.infer<typeof ResponseRecommendationSchema> => {
  if (!recommendationValidationPassed(input.outcome.results)) {
    failRecommendation("recommendation-validation-rejected", input.recommendationRef);
  }
  const version: VersionedRecordInfo = {
    reference: input.recommendationRef.reference,
    effectivePeriod: { validFrom: input.recordedAt },
    systemTime: { recordedAt: input.recordedAt },
  };
  const audit: AuditInfo = {
    actorId: input.actorId,
    action: "warning-response.validate-and-record",
    recordedAt: input.recordedAt,
  };
  return ResponseRecommendationSchema.parse({
    responseRecommendationId: input.recommendationRef.reference.entityId,
    warningRecordId: input.primaryWarningRecordRef.reference.entityId,
    measureItems: input.outcome.measureItems,
    implementationOrder: input.outcome.implementationOrder,
    resourceRequirements: input.outcome.resourceRequirements,
    targetIndicators: input.outcome.targetIndicators,
    triggerConsistencyValidation: input.outcome.results.triggerConsistency,
    standardsComplianceValidation: input.outcome.results.standardsCompliance,
    siteFeasibilityValidation: input.outcome.results.siteFeasibility,
    reviewStatus: "pending",
    version,
    audit,
  });
};

export const recommendationValidationPassedAll = recommendationValidationPassed;

/* -------------------------------------------------------------------------- */
/* 上游读取与策略提供者接缝（D-02/D-06）                                        */
/* -------------------------------------------------------------------------- */

/** 精确冻结上下文：任务版本、关联预警、C25 评估/快照、C19 成员与 C04 已授权措施正文。 */
export interface RecommendationFrozenContextV1 {
  readonly projectId: string;
  readonly warningResponseTaskRef: WarningResponseTaskRefV1;
  readonly riskInputRef: RiskInputVersionRefV1;
  readonly spatialScopeRef: SpatialScopeRefV1;
  readonly applicableRuleSetRef: VersionReference;
  readonly basisReleaseSetRef: {
    readonly kind: "assessment-basis-release-set";
    readonly reference: VersionReference;
  };
  readonly measureLibraryReleaseRef: MeasureLibraryReleaseRefV1;
  readonly measureArtifactRef: {
    readonly kind: "content-artifact";
    readonly reference: VersionReference;
  };
  readonly measureContentDigest: string;
  readonly measureLibrary: MeasureLibraryContentV1;
  readonly applicability: readonly ApplicabilityConditionV1[];
  readonly warnings: readonly RecommendationFrozenWarningV1[];
  readonly generationPolicyRef: VersionReference;
  readonly validationPolicyRef: VersionReference;
  readonly agentPolicyRef: VersionReference;
  readonly reviewPolicyRef: VersionReference;
}

export interface RecommendationContextReaderV1 {
  readFrozenContext(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly warningResponseTaskRef: WarningResponseTaskRefV1;
    readonly measureLibraryReleaseRef: MeasureLibraryReleaseRefV1;
  }): Promise<RecommendationFrozenContextV1>;
}

/** 部署注入的版本化策略与现场上下文：只按精确引用解析，不提供 latest 或默认值。 */
export interface RecommendationPolicyProviderV1 {
  readGenerationPolicy(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly generationPolicyRef: VersionReference;
  }): Promise<ResponseGenerationPolicyV1>;
  readValidationContext(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly validationPolicyRef: VersionReference;
    readonly siteContextRef: VersionReference;
  }): Promise<{
    readonly validationPolicy: ResponseValidationPolicyV1;
    readonly siteContext: RecommendationSiteContextV1;
  }>;
  readAgentPolicy(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly agentPolicyRef: VersionReference;
  }): Promise<ResponseAgentPolicyV1>;
}

/* -------------------------------------------------------------------------- */
/* 处置 Agent 任务定义（D-04）                                                 */
/* -------------------------------------------------------------------------- */

export interface ResponseRecommendationTaskPortV1 {
  validateIncrement(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: ResponseRecommendationIncrementV1;
  }): Promise<AgentValidationResultV1> | AgentValidationResultV1;
  finalizeIncrement(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: ResponseRecommendationIncrementV1;
  }): Promise<AgentTaskResultRefV1> | AgentTaskResultRefV1;
}

export interface CreateResponseRecommendationTaskDefinitionOptionsV1 {
  readonly policy: ResponseAgentPolicyV1;
  readonly port: ResponseRecommendationTaskPortV1;
}

/**
 * 组装 `response-recommendation` 的定义：只支持内嵌触发、无任意工具白名单，
 * 增量只表达冻结候选的选择与顺序，正式建议仍由确定性三项校验与人工采纳边界决定。
 */
export const createResponseRecommendationTaskDefinition = (
  options: CreateResponseRecommendationTaskDefinitionOptionsV1,
): AgentTaskDefinitionV1<ResponseRecommendationIncrementV1, ResponseRecommendationIncrementV1> => {
  const policy = options.policy;
  return {
    metadata: AgentTaskDefinitionMetadataV1Schema.parse({
      schemaVersion: "1",
      definitionRef: policy.definitionRef,
      taskType: RECOMMENDATION_TASK_TYPE_V1,
      toolPolicyRef: policy.toolPolicyRef,
      incrementSchemaRef: policy.incrementSchemaRef,
      validationPolicyRef: policy.validationPolicyRef,
      supportedTriggerModes: ["embedded"],
      allowedToolRefs: [],
      resultFamilies: ["recommendation-candidate"],
    }),
    budgetPolicy: policy.budgetPolicy,
    actionSchema: ResponseRecommendationIncrementV1Schema,
    incrementSchema: ResponseRecommendationIncrementV1Schema,
    candidateSchema: ResponseRecommendationIncrementV1Schema,
    tools: [],
    measureCandidateUsage: (candidate) => {
      const typed = ResponseRecommendationIncrementV1Schema.parse(candidate);
      return { candidates: 1, objects: typed.selections.length };
    },
    validateCandidate: async (candidate, context) =>
      AgentValidationResultV1Schema.parse(
        await options.port.validateIncrement({
          task: context,
          candidate: ResponseRecommendationIncrementV1Schema.parse(candidate),
        }),
      ),
    finalizeCandidate: async (candidate, context) =>
      options.port.finalizeIncrement({
        task: context,
        candidate: ResponseRecommendationIncrementV1Schema.parse(candidate),
      }),
  };
};

/* -------------------------------------------------------------------------- */
/* 用例接口                                                                    */
/* -------------------------------------------------------------------------- */

export type CreateCandidateCommandV1 = Extract<
  RecommendationCommandV1,
  { kind: "create-candidate" }
>;
export type ValidateAndRecordCommandV1 = Extract<
  RecommendationCommandV1,
  { kind: "validate-and-record" }
>;

/**
 * C27 用例接口：实现方是 `packages/adapters` 的 PostgreSQL adapter，
 * 只暴露 C27 拥有的两个 `recommend` 分支与 `measure-candidates` 读取，不宣称完整 `WarningResponsePortV1`。
 */
export interface RecommendationServiceV1 {
  measureCandidates(query: KnowledgeRetrievalQueryV1): Promise<KnowledgeRetrievalResultV1>;
  createCandidate(command: CreateCandidateCommandV1): Promise<RecommendationResultV1>;
  validateAndRecord(command: ValidateAndRecordCommandV1): Promise<RecommendationResultV1>;
}
