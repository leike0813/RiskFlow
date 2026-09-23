import { z } from "zod";

import {
  IdentifierSchema,
  VersionReferenceSchema,
  type VersionReference,
} from "@riskflow/contracts/common";
import {
  type AgentTaskDefinitionV1,
  type AgentTaskSnapshotV1,
  type AgentValidationResultV1,
  AgentTaskDefinitionMetadataV1Schema,
  AgentTaskBudgetPolicyV1Schema,
  AgentValidationResultV1Schema,
  buildCompletedAgentTaskResult,
} from "../agent-runtime/index.js";
import {
  AssessmentConfigurationDocumentV1Schema,
  DeviationPolicyDocumentV1Schema,
  MonitoringWarningThresholdDocumentV1Schema,
  RiskAcceptanceThresholdDocumentV1Schema,
  RiskMatrixDocumentV1Schema,
  WeightSetDocumentV1Schema,
  validateAssessmentConfigurationDocument,
  type AssessmentConfigurationDocumentV1,
} from "../assessment-config/index.js";
import {
  AgentTaskResultRefV1Schema,
  type AgentTaskRefV1,
  type AgentTaskResultRefV1,
  type AssessmentBasisReleaseSetRefV1,
  type AuthorizationContextV1,
  type CalibrationSuggestionRefV1,
  type ContentArtifactRefV1,
  type DeviationRecordRefV1,
  type KnowledgeReleaseRefV1,
  type KnowledgeRevisionRefV1,
  type ModuleErrorV1,
  type ValidationSnapshotRefV1,
  type WarningResponseRecordCommandV1,
  type WarningResponseRecordResultV1,
} from "@riskflow/contracts/ports";
import type { ResponseDeviationFactRefV1 } from "../response-lifecycle/index.js";
import { sha256CanonicalJson } from "../persistence/index.js";
import {
  ScoringThresholdSchema,
  type GradeInterval,
  type ScoringThreshold,
  type StructuredScoringRule,
} from "@riskflow/contracts/records";
import {
  StructuredScoringRuleDocumentV1Schema,
  structuredScoringRuleDocumentDigest,
  type StructuredScoringRuleDocumentV1,
} from "../scoring-rules/index.js";
import {
  CALIBRATION_SCHEMA_VERSION_V1,
  CalibrationCandidateV1Schema,
  CalibrationCandidateValidationV1Schema,
  CalibrationOperationV1Schema,
  type CalibrationCandidateV1,
  type CalibrationCandidateValidationV1,
  type CalibrationOperationV1,
  type CalibrationRejectionClassV1,
  type CalibrationInputSnapshotRefV1,
  type CalibrationReasonCodeV1,
  type CalibrationReviewOutcomeCommandV1,
  type CalibrationTargetDefinitionTypeV1,
  type CalibrationValidationItemV1,
} from "./schema.js";

/** C29 校准目标定义文档的两种 SSOT 形态：C18 配置文档或 C19 结构化评分规则文档。 */
export type CalibrationTargetDocumentV1 =
  AssessmentConfigurationDocumentV1 | StructuredScoringRuleDocumentV1;

export const CALIBRATION_AGENT_TASK_TYPE_V1 = "calibration-suggestion" as const;

export type { CalibrationSuggestionRefV1 };

/* -------------------------------------------------------------------------- */
/* D-02：稳定派生身份                                                          */
/* -------------------------------------------------------------------------- */

/** 建议精确版本：`{deviationRecordRef, agentTaskResultRef, validationPolicyRef, candidateDigest}`。 */
export const deriveCalibrationSuggestionRef = (input: {
  readonly deviationRecordRef: VersionReference;
  readonly agentTaskResultRef: VersionReference;
  readonly calibrationValidationPolicyRef: VersionReference;
  readonly candidateDigest: string;
}): { readonly kind: "calibration-suggestion"; readonly reference: VersionReference } => ({
  kind: "calibration-suggestion",
  reference: {
    entityId: `calibration-suggestion-${sha256CanonicalJson(input).slice(0, 32)}`,
    versionId: "1",
  },
});

/** 退回决定预留后继版本；身份只由精确前驱与精确决定决定。 */
export const deriveSuccessorCalibrationSuggestionRef = (input: {
  readonly predecessorSuggestionRef: VersionReference;
  readonly reviewDecisionRef: VersionReference;
}): { readonly kind: "calibration-suggestion"; readonly reference: VersionReference } => {
  const predecessorVersion = Number.parseInt(input.predecessorSuggestionRef.versionId, 10);
  if (!Number.isSafeInteger(predecessorVersion) || predecessorVersion < 1) {
    throw new TypeError("calibration suggestion version must be a positive integer");
  }
  return {
    kind: "calibration-suggestion",
    reference: {
      entityId: `calibration-suggestion-${sha256CanonicalJson(input).slice(0, 32)}`,
      versionId: String(predecessorVersion + 1),
    },
  };
};

/** 公共偏差记录身份只由工程与精确 C28 偏差事实派生；首版固定为 `1`。 */
export const deriveDeviationRecordRef = (input: {
  readonly projectId: string;
  readonly deviationFactRef: VersionReference;
}): { readonly kind: "deviation-record"; readonly reference: VersionReference } => ({
  kind: "deviation-record",
  reference: {
    entityId: `deviation-record-${sha256CanonicalJson(input).slice(0, 32)}`,
    versionId: "1",
  },
});

/** 冻结输入工件身份由工程、偏差事实与目标发布共同决定，重试得到同一工件。 */
export const deriveCalibrationInputSnapshotRef = (input: {
  readonly projectId: string;
  readonly deviationFactRef: VersionReference;
  readonly targetReleaseRef: VersionReference;
  readonly calibrationValidationPolicyRef: VersionReference;
}): { readonly kind: "calibration-input-snapshot"; readonly reference: VersionReference } => ({
  kind: "calibration-input-snapshot",
  reference: {
    entityId: `calibration-input-${sha256CanonicalJson(input).slice(0, 32)}`,
    versionId: "1",
  },
});

/* -------------------------------------------------------------------------- */
/* D-04：类型化操作应用与完整文档校验                                           */
/* -------------------------------------------------------------------------- */

const byKey =
  <T>(key: (value: T) => string) =>
  (left: T, right: T): number => {
    const leftKey = key(left);
    const rightKey = key(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  };

interface PreparedOperationV1 {
  readonly operation: CalibrationOperationV1;
  readonly document?: CalibrationTargetDocumentV1;
  readonly reasonCode?: string;
  readonly rejectionClass?: CalibrationRejectionClassV1;
}

const selectorMissing = (operation: CalibrationOperationV1): PreparedOperationV1 => ({
  operation,
  reasonCode: "calibration-operation-selector-missing",
  rejectionClass: "repairable",
});

const definitionMismatch = (operation: CalibrationOperationV1): PreparedOperationV1 => ({
  operation,
  reasonCode: "calibration-operation-definition-mismatch",
  rejectionClass: "terminal",
});

/**
 * 逐项应用单一定义上的类型化操作。选择器缺失或类型错配转为稳定拒绝原因；
 * 应用结果不在此处做完整文档校验，由调用方以 C18/C19 完整文档 Schema 收口。
 */
const applyOperation = (
  definitionType: CalibrationTargetDefinitionTypeV1,
  document: CalibrationTargetDocumentV1,
  operation: CalibrationOperationV1,
): PreparedOperationV1 => {
  if (operation.definitionType !== definitionType) return definitionMismatch(operation);
  switch (operation.kind) {
    case "replace-weight-entry": {
      const weightSet = WeightSetDocumentV1Schema.parse(document);
      const field = operation.axis === "possibility" ? "possibilityWeights" : "consequenceWeights";
      const entries = [...weightSet.content[field]];
      const index = entries.findIndex((entry) => entry.indicatorId === operation.entry.indicatorId);
      if (index < 0) return selectorMissing(operation);
      entries[index] = operation.entry;
      entries.sort(byKey((entry) => entry.indicatorId));
      // 中间文档只做结构组装；完整文档合法性统一由调用方的 strict 复验收口。
      return {
        operation,
        document: { ...weightSet, content: { ...weightSet.content, [field]: entries } },
      };
    }
    case "replace-risk-matrix-band": {
      const matrix = RiskMatrixDocumentV1Schema.parse(document);
      const axis = operation.axis === "possibility" ? "possibilityAxis" : "consequenceAxis";
      const bands = [...matrix.content[axis].bands];
      const index = bands.findIndex((band) => band.bandId === operation.band.bandId);
      if (index < 0) return selectorMissing(operation);
      bands[index] = operation.band;
      return {
        operation,
        document: { ...matrix, content: { ...matrix.content, [axis]: { bands } } },
      };
    }
    case "replace-risk-acceptance-threshold": {
      const thresholds = RiskAcceptanceThresholdDocumentV1Schema.parse(document);
      const items = [...thresholds.content.thresholds];
      const index = items.findIndex((item) => item.thresholdId === operation.threshold.thresholdId);
      if (index < 0) return selectorMissing(operation);
      items[index] = operation.threshold;
      return {
        operation,
        document: {
          ...thresholds,
          content: {
            ...thresholds.content,
            thresholds: items.sort(byKey((item) => item.thresholdId)),
          },
        },
      };
    }
    case "replace-monitoring-warning-threshold": {
      const thresholds = MonitoringWarningThresholdDocumentV1Schema.parse(document);
      const items = [...thresholds.content.thresholds];
      const index = items.findIndex((item) => item.thresholdId === operation.threshold.thresholdId);
      if (index < 0) return selectorMissing(operation);
      items[index] = operation.threshold;
      return {
        operation,
        document: {
          ...thresholds,
          content: {
            ...thresholds.content,
            thresholds: items.sort(byKey((item) => item.thresholdId)),
          },
        },
      };
    }
    case "replace-deviation-policy": {
      const policies = DeviationPolicyDocumentV1Schema.parse(document);
      const items = [...policies.content.policies];
      const index = items.findIndex((item) => item.policyId === operation.policy.policyId);
      if (index < 0) return selectorMissing(operation);
      items[index] = operation.policy;
      return {
        operation,
        document: {
          ...policies,
          content: { ...policies.content, policies: items.sort(byKey((item) => item.policyId)) },
        },
      };
    }
    case "replace-scoring-rule-interval": {
      const rules = StructuredScoringRuleDocumentV1Schema.parse(document);
      const index = rules.members.findIndex((member) => member.rule.ruleId === operation.ruleId);
      if (index < 0) return selectorMissing(operation);
      const member = rules.members[index]!;
      const rule: StructuredScoringRule = member.rule;
      const replacement = operation.replacement;
      let nextRule: StructuredScoringRule;
      if (replacement.kind === "threshold") {
        const thresholds = [...rule.scoringThresholds];
        const thresholdIndex = thresholds.findIndex(
          (threshold: ScoringThreshold) =>
            threshold.thresholdId === replacement.threshold.thresholdId,
        );
        if (thresholdIndex < 0) return selectorMissing(operation);
        thresholds[thresholdIndex] = replacement.threshold;
        nextRule = { ...rule, scoringThresholds: thresholds };
      } else {
        const intervals = [...rule.gradeIntervals];
        const intervalIndex = intervals.findIndex(
          (interval: GradeInterval) => interval.grade === replacement.interval.grade,
        );
        if (intervalIndex < 0) return selectorMissing(operation);
        intervals[intervalIndex] = replacement.interval;
        nextRule = { ...rule, gradeIntervals: intervals };
      }
      const members = [...rules.members];
      members[index] = { ...member, rule: nextRule };
      return { operation, document: { ...rules, members } };
    }
  }
};

const strictParse = (
  definitionType: CalibrationTargetDefinitionTypeV1,
  document: CalibrationTargetDocumentV1,
):
  | { readonly success: true; readonly document: CalibrationTargetDocumentV1 }
  | { readonly success: false } => {
  if (definitionType === "structured-scoring-rule") {
    const parsed = StructuredScoringRuleDocumentV1Schema.safeParse(document);
    return parsed.success
      ? { success: true, document: parsed.data as CalibrationTargetDocumentV1 }
      : { success: false };
  }
  const parsed = AssessmentConfigurationDocumentV1Schema.safeParse(document);
  if (!parsed.success) return { success: false };
  try {
    // C18 语义约束（矩阵完整性、阈值覆盖、权重总量）不在 strict Schema 内。
    validateAssessmentConfigurationDocument(parsed.data);
    return { success: true, document: parsed.data as CalibrationTargetDocumentV1 };
  } catch {
    return { success: false };
  }
};

/**
 * 按 Agent 给出的顺序应用全部操作，只对**最终**候选文档跑一次 C18/C19 完整 Schema 与
 * C18 语义校验。逐项处置只表达操作自身的种类与选择器合法性，因此成对等量调整
 * （例如权重总量守恒）不会被中间态误判。
 */
const applyOperations = (
  definitionType: CalibrationTargetDefinitionTypeV1,
  document: CalibrationTargetDocumentV1,
  operations: readonly CalibrationOperationV1[],
): {
  readonly items: readonly CalibrationValidationItemV1[];
  readonly document?: CalibrationTargetDocumentV1;
} => {
  const items: CalibrationValidationItemV1[] = [];
  let current = document;
  for (const [index, operation] of operations.entries()) {
    const parsedOperation = CalibrationOperationV1Schema.parse(operation);
    const prepared = applyOperation(definitionType, current, parsedOperation);
    if (prepared.reasonCode !== undefined) {
      items.push({
        operationIndex: index,
        operationKind: parsedOperation.kind,
        disposition: "rejected",
        reasonCode: prepared.reasonCode,
      });
      return { items };
    }
    items.push({
      operationIndex: index,
      operationKind: parsedOperation.kind,
      disposition: "accepted",
    });
    current = prepared.document!;
  }
  const strict = strictParse(definitionType, current);
  if (!strict.success) {
    const lastAccepted = items.findLastIndex((item) => item.disposition === "accepted");
    const target = items[lastAccepted];
    if (target !== undefined) {
      items[lastAccepted] = {
        ...target,
        disposition: "rejected",
        reasonCode: "calibration-document-invalid",
      };
    }
    return { items };
  }
  return { items, document: strict.document };
};

/* -------------------------------------------------------------------------- */
/* 候选收口                                                                    */
/* -------------------------------------------------------------------------- */

export interface CalibrationCandidateValidationOutcomeV1 {
  readonly validation: CalibrationCandidateValidationV1;
  readonly document?: CalibrationTargetDocumentV1;
  readonly contentDigest?: string;
}

/**
 * 确定性候选收口：逐项验证操作种类与目标定义相容、选择器唯一存在、完整文档合法，
 * 再计算 canonical 摘要。任何越界或文档非法都只产生稳定拒绝原因，不修改输入。
 */
export const validateCalibrationCandidate = (input: {
  readonly definitionType: CalibrationTargetDefinitionTypeV1;
  readonly document: CalibrationTargetDocumentV1;
  readonly candidate: CalibrationCandidateV1;
}): CalibrationCandidateValidationOutcomeV1 => {
  const candidate = CalibrationCandidateV1Schema.parse(input.candidate);
  const applied = applyOperations(input.definitionType, input.document, candidate.operations);
  const rejected = applied.items.find((item) => item.disposition === "rejected");
  if (rejected !== undefined || applied.document === undefined) {
    const rejectionClass = rejectionClassFor(rejected);
    return {
      validation: CalibrationCandidateValidationV1Schema.parse({
        schemaVersion: CALIBRATION_SCHEMA_VERSION_V1,
        disposition: "rejected",
        rejectionClass,
        items: applied.items,
      }),
    };
  }
  const contentDigest = digestDocument(input.definitionType, applied.document);
  return {
    validation: CalibrationCandidateValidationV1Schema.parse({
      schemaVersion: CALIBRATION_SCHEMA_VERSION_V1,
      disposition: "accepted",
      items: applied.items,
      candidateDigest: contentDigest,
    }),
    document: applied.document,
    contentDigest,
  };
};

/** 只有字段、格式、引用或候选越界可修复；其余越出冻结边界必须直接关闭。 */
const rejectionClassFor = (
  rejected: CalibrationValidationItemV1 | undefined,
): CalibrationRejectionClassV1 =>
  rejected?.reasonCode === "calibration-operation-definition-mismatch" ? "terminal" : "repairable";

export const digestDocument = (
  definitionType: CalibrationTargetDefinitionTypeV1,
  document: CalibrationTargetDocumentV1,
): string =>
  definitionType === "structured-scoring-rule"
    ? structuredScoringRuleDocumentDigest(StructuredScoringRuleDocumentV1Schema.parse(document))
    : sha256CanonicalJson(AssessmentConfigurationDocumentV1Schema.parse(document));

/**
 * 精确重放：第三方持有冻结基准文档、已批准类型化操作与校验策略时，
 * 必须能重建同一完整候选文档与同一摘要。
 */
export const applyCalibrationOperations = (input: {
  readonly definitionType: CalibrationTargetDefinitionTypeV1;
  readonly document: CalibrationTargetDocumentV1;
  readonly operations: readonly CalibrationOperationV1[];
}): { readonly document: CalibrationTargetDocumentV1; readonly contentDigest: string } => {
  const applied = applyOperations(input.definitionType, input.document, input.operations);
  if (applied.document === undefined) {
    throw new TypeError("calibration operations were rejected");
  }
  return {
    document: applied.document,
    contentDigest: digestDocument(input.definitionType, applied.document),
  };
};

export const calibrationCandidateDigest = (candidate: CalibrationCandidateV1): string =>
  sha256CanonicalJson(CalibrationCandidateV1Schema.parse(candidate));

/* -------------------------------------------------------------------------- */
/* D-05：有界 Agent 任务定义                                                    */
/* -------------------------------------------------------------------------- */

/** C08 校准任务的确定性收口接缝：由部署注入实现，测试夹具不得用于生产。 */
export interface CalibrationSuggestionTaskPortV1 {
  validateIncrement(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: CalibrationCandidateV1;
  }): Promise<AgentValidationResultV1> | AgentValidationResultV1;
  finalizeIncrement(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: CalibrationCandidateV1;
  }): Promise<AgentTaskResultRefV1> | AgentTaskResultRefV1;
}

/**
 * 组装 `calibration-suggestion` 定义：只支持内嵌触发、无任意工具白名单，
 * 增量只表达冻结基准上的闭合类型化操作；正式建议仍由确定性校验与人工复核决定。
 */
export const createCalibrationSuggestionTaskDefinition = (options: {
  readonly policy: {
    readonly definitionRef: VersionReference;
    readonly toolPolicyRef: VersionReference;
    readonly incrementSchemaRef: VersionReference;
    readonly validationPolicyRef: VersionReference;
    readonly budgetPolicy: z.infer<typeof AgentTaskBudgetPolicyV1Schema>;
    readonly evidenceRequirementCount: number;
    readonly maxOperations: number;
  };
  readonly port: CalibrationSuggestionTaskPortV1;
}): AgentTaskDefinitionV1<CalibrationCandidateV1, CalibrationCandidateV1> => {
  const candidateSchema = CalibrationCandidateV1Schema.superRefine((candidate, context) => {
    if (candidate.evidenceReferences.length < options.policy.evidenceRequirementCount) {
      context.addIssue({
        code: "custom",
        path: ["evidenceReferences"],
        message: "insufficient evidence",
      });
    }
    if (candidate.operations.length > options.policy.maxOperations) {
      context.addIssue({ code: "custom", path: ["operations"], message: "too many operations" });
    }
  });
  return {
    metadata: AgentTaskDefinitionMetadataV1Schema.parse({
      schemaVersion: "1",
      definitionRef: options.policy.definitionRef,
      taskType: CALIBRATION_AGENT_TASK_TYPE_V1,
      toolPolicyRef: options.policy.toolPolicyRef,
      incrementSchemaRef: options.policy.incrementSchemaRef,
      validationPolicyRef: options.policy.validationPolicyRef,
      supportedTriggerModes: ["embedded"],
      allowedToolRefs: [],
      resultFamilies: ["calibration-suggestion"],
    }),
    budgetPolicy: AgentTaskBudgetPolicyV1Schema.parse(options.policy.budgetPolicy),
    actionSchema: candidateSchema,
    incrementSchema: candidateSchema,
    candidateSchema,
    tools: [],
    measureCandidateUsage: (candidate) => {
      const typed = candidateSchema.parse(candidate);
      return { candidates: 1, objects: typed.operations.length };
    },
    validateCandidate: async (candidate, context) =>
      AgentValidationResultV1Schema.parse(
        await options.port.validateIncrement({
          task: context,
          candidate: candidateSchema.parse(candidate),
        }),
      ),
    finalizeCandidate: async (candidate, context) => {
      const typed = candidateSchema.parse(candidate);
      return AgentTaskResultRefV1Schema.parse(
        await options.port.finalizeIncrement({ task: context, candidate: typed }),
      );
    },
  };
};

/** 保留 C08 公共结果构造入口，供实现方在 finalize 时生成 `candidateRef`。 */
export const calibrationCandidateResultRef = (input: {
  readonly taskRef: AgentTaskRefV1;
  readonly candidateRef: CalibrationSuggestionRefV1;
  readonly validationRef?: ValidationSnapshotRefV1;
}): AgentTaskResultRefV1 =>
  buildCompletedAgentTaskResult(input.taskRef, input.candidateRef, input.validationRef);

/* -------------------------------------------------------------------------- */
/* 校验策略与执行策略的解析结果                                                 */
/* -------------------------------------------------------------------------- */

/** 版本化校验策略：固定工具白名单、预算与拒绝分类，由调用方按 ref 解析后注入。 */
export const CalibrationValidationPolicyV1Schema = z
  .strictObject({
    schemaVersion: z.literal(CALIBRATION_SCHEMA_VERSION_V1),
    policyRef: VersionReferenceSchema,
    projectId: IdentifierSchema,
    definitionRef: VersionReferenceSchema,
    toolPolicyRef: VersionReferenceSchema,
    incrementSchemaRef: VersionReferenceSchema,
    validationPolicyRef: VersionReferenceSchema,
    budgetPolicy: AgentTaskBudgetPolicyV1Schema,
    evidenceRequirementCount: z.number().int().positive(),
    maxOperations: z.number().int().positive(),
  })
  .superRefine((policy, context) => {
    if (
      policy.toolPolicyRef.entityId !== policy.budgetPolicy.toolPolicyRef.entityId ||
      policy.toolPolicyRef.versionId !== policy.budgetPolicy.toolPolicyRef.versionId
    ) {
      context.addIssue({
        code: "custom",
        path: ["toolPolicyRef"],
        message: "tool policy mismatch",
      });
    }
    if (policy.maxOperations > policy.budgetPolicy.maxObjects) {
      context.addIssue({
        code: "custom",
        path: ["maxOperations"],
        message: "operation budget exceeded",
      });
    }
  });
export type CalibrationValidationPolicyV1 = z.infer<typeof CalibrationValidationPolicyV1Schema>;

export { ScoringThresholdSchema };

/* -------------------------------------------------------------------------- */
/* D-01：四个窄用例                                                            */
/* -------------------------------------------------------------------------- */

export type CreateCalibrationSuggestionCommandV1 = Extract<
  WarningResponseRecordCommandV1,
  { kind: "create-calibration-suggestion" }
>;

/** `prepareInput` 的私有入参：当前授权、精确 C28 偏差事实、冻结依据内目标发布与校验策略。 */
export interface CalibrationPrepareInputCommandV1 {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly authorization: AuthorizationContextV1;
  readonly deviationFactRef: ResponseDeviationFactRefV1;
  readonly basisReleaseSetRef: AssessmentBasisReleaseSetRefV1;
  readonly targetReleaseRef: KnowledgeReleaseRefV1;
  readonly calibrationValidationPolicyRef: VersionReference;
  /** 冻结的 C08 执行策略：模型、提示、工具与预算都由调用方按精确 ref 解析后注入。 */
  readonly agentPolicy: CalibrationValidationPolicyV1;
}

export interface CalibrationPrepareInputSuccessV1 {
  readonly frozenInputRef: ContentArtifactRefV1;
  readonly inputSnapshotRef: CalibrationInputSnapshotRefV1;
  readonly deviationRecordRef: DeviationRecordRefV1;
  readonly targetDefinitionType: CalibrationTargetDefinitionTypeV1;
}

export type CalibrationPrepareInputResultV1 =
  | { readonly kind: "succeeded"; readonly result: CalibrationPrepareInputSuccessV1 }
  | { readonly kind: "not-applicable"; readonly reasonCode: CalibrationReasonCodeV1 }
  | { readonly kind: "failed"; readonly error: ModuleErrorV1 };

/** `recordReviewOutcome`：只推进对应建议版本，不创建草案。 */
export interface CalibrationReviewOutcomeSuccessV1 {
  readonly calibrationSuggestionRef: CalibrationSuggestionRefV1;
  readonly outcome: "rejected" | "returned" | "approved-for-draft";
  readonly deviationRecordRef: DeviationRecordRefV1;
  readonly deviationRecordVersionId: string;
}

export type CalibrationReviewOutcomeResultV1 =
  | { readonly kind: "succeeded"; readonly result: CalibrationReviewOutcomeSuccessV1 }
  | { readonly kind: "failed"; readonly error: ModuleErrorV1 };

/** `createGovernanceDraft`：证明门禁通过后创建一项未发布 C16 修订。 */
export interface CalibrationGovernanceDraftSuccessV1 {
  readonly governanceDraftRef: VersionReference;
  readonly knowledgeRevisionRef: KnowledgeRevisionRefV1;
  readonly candidateArtifactRef: ContentArtifactRefV1;
  readonly deviationRecordRef: DeviationRecordRefV1;
  readonly deviationRecordVersionId: string;
}

export type CalibrationGovernanceDraftResultV1 =
  | { readonly kind: "succeeded"; readonly result: CalibrationGovernanceDraftSuccessV1 }
  | { readonly kind: "failed"; readonly error: ModuleErrorV1 };

/**
 * C29 用例接口：实现方是 `packages/adapters` 的 PostgreSQL adapter，
 * 只暴露校准入口、建议创建、决定收口与草案创建，不宣称完整 `WarningResponsePortV1`。
 */
export interface CalibrationServiceV1 {
  prepareInput(command: CalibrationPrepareInputCommandV1): Promise<CalibrationPrepareInputResultV1>;
  createSuggestion(
    command: CreateCalibrationSuggestionCommandV1,
  ): Promise<WarningResponseRecordResultV1>;
  recordReviewOutcome(
    command: CalibrationReviewOutcomeCommandV1,
  ): Promise<CalibrationReviewOutcomeResultV1>;
  createGovernanceDraft(
    command: CalibrationReviewOutcomeCommandV1,
  ): Promise<CalibrationGovernanceDraftResultV1>;
}
