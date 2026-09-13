import {
  ContractReferenceV1Schema,
  type AgentTaskRefV1,
  type ContractReferenceV1,
  type KnowledgeReleaseRefV1,
  type KnowledgeRevisionRefV1,
  type ProjectRevisionRefV1,
} from "@riskflow/contracts/ports";
import {
  type ApplicabilityMetadata,
  type GradeInterval,
  type ScalarValue,
  type ScoringThreshold,
  type StructuredScoringRule,
} from "@riskflow/contracts/records";
import type { VersionReference } from "@riskflow/contracts/common";

import { sha256CanonicalJson } from "../persistence/index.js";
import {
  ApplicableRuleSetDocumentV1Schema,
  ApplicableRuleSetIncludedMemberV1Schema,
  AssessmentBasisReleaseSetMembersV1Schema,
  buildScoringRuleRelationIdentity,
  ScoringRuleAuthoringCandidateV1Schema,
  ScoringRuleOverlapDomainV1Schema,
  ScoringRuleOperationV1Schema,
  ScoringRuleRelationV1Schema,
  ScoringRuleValidationItemV1Schema,
  StructuredScoringRuleDocumentV1Schema,
  ScoringRuleEvaluationResultV1Schema,
  NormalizedGradeIntervalV1Schema,
  NormalizedScoringThresholdV1Schema,
  SCORING_RULES_MAX_RELATION_EVIDENCE_V1,
  SCORING_RULES_MAX_RULES_V1,
  scoringRuleIdentityKey,
  ScoringRuleRelationSnapshotV1Schema,
  type ApplicableRuleSetDecisionV1,
  type ApplicableRuleSetDocumentV1,
  type ApplicableRuleSetIncludedMemberV1,
  type AssessmentBasisConfigurationMemberV1,
  type AssessmentBasisReleaseSetMemberV1,
  type AssessmentBasisReleaseSetMembersV1,
  type NormalizedGradeIntervalV1,
  type NormalizedScoringThresholdV1,
  type ScoringRuleAuthoringCandidateV1,
  type ScoringRuleAuthoringManifestV1,
  type ScoringRuleEvaluationResultV1,
  type ScoringRuleExclusionReasonV1,
  type ScoringRuleOperationV1,
  type ScoringRuleOverlapDomainV1,
  type ScoringRuleRelationKindV1,
  type ScoringRuleRelationSnapshotV1,
  type ScoringRuleRelationV1,
  type ScoringRuleSourceBindingV1,
  type ScoringRuleValidationItemV1,
  type ScoringRuleValidationViewV1,
  type ScoringRulesPolicyV1,
  type StructuredScoringRuleDocumentV1,
  type StructuredScoringRuleMemberV1,
} from "./schema.js";

export type ScoringRulesErrorCodeV1 =
  | "AUTHORIZATION_DENIED"
  | "ENTITY_NOT_FOUND"
  | "STALE_VERSION"
  | "BUSINESS_BLOCKED"
  | "IDEMPOTENCY_CONFLICT"
  | "TRANSIENT_FAILURE"
  | "TERMINAL_FAILURE"
  | "UNSUPPORTED_CONTRACT";

export type ScoringRulesReasonCodeV1 =
  | "scoring-rule-request-invalid"
  | "scoring-rule-project-mismatch"
  | "scoring-rule-capability-required"
  | "scoring-rule-source-unavailable"
  | "scoring-rule-source-excluded"
  | "scoring-rule-source-kind-invalid"
  | "scoring-rule-cleaning-task-incomplete"
  | "scoring-rule-cleaning-result-mismatch"
  | "scoring-rule-content-invalid"
  | "scoring-rule-review-status-not-pending"
  | "scoring-rule-applicability-incomplete"
  | "scoring-rule-indicator-unknown"
  | "scoring-rule-threshold-invalid"
  | "scoring-rule-grade-invalid"
  | "scoring-rule-exception-unknown"
  | "scoring-rule-evidence-unverified"
  | "scoring-rule-base-version-conflict"
  | "scoring-rule-operation-invalid"
  | "scoring-rule-target-unknown"
  | "scoring-rule-conflict-detected"
  | "scoring-rule-relation-unresolved"
  | "scoring-rule-compatibility-mismatch"
  | "scoring-rule-configuration-incompatible"
  | "scoring-rule-configuration-incomplete"
  | "scoring-rule-applicability-mismatch"
  | "scoring-rule-policy-mismatch"
  | "scoring-rule-policy-required"
  | "scoring-rule-revision-unverified"
  | "scoring-rule-set-incomplete"
  | "scoring-rule-artifact-mismatch"
  | "scoring-rule-artifact-unavailable"
  | "scoring-rule-size-exceeded"
  | "scoring-rule-media-type-invalid"
  | "scoring-rule-basis-unavailable"
  | "scoring-rule-basis-enumeration-denied";

export interface ScoringRuleFailureV1 {
  readonly code: ScoringRulesErrorCodeV1;
  readonly reasonCode: ScoringRulesReasonCodeV1;
  readonly targetRef: ContractReferenceV1;
}

export class ScoringRuleError extends Error {
  readonly failure: ScoringRuleFailureV1;

  constructor(failure: ScoringRuleFailureV1) {
    super(failure.code);
    this.name = "ScoringRuleError";
    this.failure = failure;
  }
}

export function failScoringRule(
  reasonCode: ScoringRulesReasonCodeV1,
  targetRef: ContractReferenceV1,
  code: ScoringRulesErrorCodeV1 = "BUSINESS_BLOCKED",
): never {
  throw new ScoringRuleError({ code, reasonCode, targetRef });
}

/** Recover a C19 failure from a raw error or an adapter-wrapped error. */
export const scoringRuleFailureFrom = (error: unknown): ScoringRuleFailureV1 | undefined => {
  if (error instanceof ScoringRuleError) return error.failure;
  if (error instanceof Error && "scoringRuleFailure" in error) {
    const failure = (error as Error & { scoringRuleFailure?: unknown }).scoringRuleFailure;
    return typeof failure === "object" && failure !== null
      ? (failure as ScoringRuleFailureV1)
      : undefined;
  }
  return undefined;
};

const scoringRuleTargetRef = (entityId: string, versionId = "1"): ContractReferenceV1 =>
  ContractReferenceV1Schema.parse({
    kind: "knowledge-revision",
    reference: { entityId: `scoring-rule:${entityId}`, versionId },
  });

export const SCORING_RULES_AUTHORING_TARGET_REF_V1: ContractReferenceV1 =
  scoringRuleTargetRef("authoring");

export const SCORING_RULES_ASSEMBLY_TARGET_REF_V1: ContractReferenceV1 =
  scoringRuleTargetRef("applicable-set");

export const SCORING_RULES_BASIS_TARGET_REF_V1: ContractReferenceV1 = scoringRuleTargetRef("basis");

export const structuredScoringRuleDocumentDigest = (
  document: StructuredScoringRuleDocumentV1,
): string => sha256CanonicalJson(document);

export const applicableRuleSetDocumentDigest = (document: ApplicableRuleSetDocumentV1): string =>
  sha256CanonicalJson(document);

const parseDocument = (
  value: unknown,
  reasonCode: ScoringRulesReasonCodeV1,
  targetRef: ContractReferenceV1 = SCORING_RULES_AUTHORING_TARGET_REF_V1,
): StructuredScoringRuleDocumentV1 => {
  const parsed = StructuredScoringRuleDocumentV1Schema.safeParse(value);
  if (!parsed.success) failScoringRule(reasonCode, targetRef, "TERMINAL_FAILURE");
  return parsed.data as StructuredScoringRuleDocumentV1;
};

export const parseScoringRuleDocument = (
  value: unknown,
  targetRef: ContractReferenceV1 = SCORING_RULES_AUTHORING_TARGET_REF_V1,
): StructuredScoringRuleDocumentV1 =>
  parseDocument(value, "scoring-rule-content-invalid", targetRef);

export const parseApplicableRuleSetDocument = (
  value: unknown,
  targetRef: ContractReferenceV1 = SCORING_RULES_ASSEMBLY_TARGET_REF_V1,
): ApplicableRuleSetDocumentV1 => {
  const parsed = ApplicableRuleSetDocumentV1Schema.safeParse(value);
  if (!parsed.success)
    failScoringRule("scoring-rule-content-invalid", targetRef, "TERMINAL_FAILURE");
  return parsed.data as ApplicableRuleSetDocumentV1;
};

/* -------------------------------------------------------------------------- */
/* Boundary normalisation and evaluation (D-06)                               */
/* -------------------------------------------------------------------------- */

interface IntervalShape {
  readonly lower: number | null;
  readonly lowerInclusive: boolean;
  readonly upper: number | null;
  readonly upperInclusive: boolean;
}

const sortByLower = <T extends IntervalShape>(values: readonly T[]): readonly T[] =>
  [...values].sort((left, right) => {
    const leftLower = left.lower ?? Number.NEGATIVE_INFINITY;
    const rightLower = right.lower ?? Number.NEGATIVE_INFINITY;
    if (leftLower !== rightLower) return leftLower - rightLower;
    return (left.upper ?? Number.POSITIVE_INFINITY) - (right.upper ?? Number.POSITIVE_INFINITY);
  });

/** `-∞/+∞` 用 `null` 表示；`eq` 数值形式固定为闭合单点。 */
const normalizeThreshold = (threshold: ScoringThreshold): NormalizedScoringThresholdV1 => {
  const base = { thresholdId: threshold.thresholdId, score: threshold.score };
  if (threshold.operator === "between") {
    return NormalizedScoringThresholdV1Schema.parse({
      ...base,
      kind: "numeric",
      operator: "between",
      lower: threshold.value,
      lowerInclusive: true,
      upper: threshold.upperValue,
      upperInclusive: false,
    });
  }
  switch (threshold.operator) {
    case "lt":
      return NormalizedScoringThresholdV1Schema.parse({
        ...base,
        kind: "numeric",
        operator: "lt",
        lower: null,
        lowerInclusive: false,
        upper: threshold.value as number,
        upperInclusive: false,
      });
    case "lte":
      return NormalizedScoringThresholdV1Schema.parse({
        ...base,
        kind: "numeric",
        operator: "lte",
        lower: null,
        lowerInclusive: false,
        upper: threshold.value as number,
        upperInclusive: true,
      });
    case "gte":
      return NormalizedScoringThresholdV1Schema.parse({
        ...base,
        kind: "numeric",
        operator: "gte",
        lower: threshold.value as number,
        lowerInclusive: true,
        upper: null,
        upperInclusive: false,
      });
    case "gt":
      return NormalizedScoringThresholdV1Schema.parse({
        ...base,
        kind: "numeric",
        operator: "gt",
        lower: threshold.value as number,
        lowerInclusive: false,
        upper: null,
        upperInclusive: false,
      });
    default: {
      if (typeof threshold.value !== "number") {
        return NormalizedScoringThresholdV1Schema.parse({
          ...base,
          kind: "discrete",
          operator: "eq",
          value: threshold.value,
        });
      }
      return NormalizedScoringThresholdV1Schema.parse({
        ...base,
        kind: "numeric",
        operator: "eq",
        lower: threshold.value,
        lowerInclusive: true,
        upper: threshold.value,
        upperInclusive: true,
      });
    }
  }
};

const intervalsOverlap = (left: IntervalShape, right: IntervalShape): boolean => {
  const leftLower = left.lower ?? Number.NEGATIVE_INFINITY;
  const rightLower = right.lower ?? Number.NEGATIVE_INFINITY;
  const leftUpper = left.upper ?? Number.POSITIVE_INFINITY;
  const rightUpper = right.upper ?? Number.POSITIVE_INFINITY;
  const lower = Math.max(leftLower, rightLower);
  const upper = Math.min(leftUpper, rightUpper);
  if (lower < upper) return true;
  if (lower > upper) return false;
  const lowerInclusive =
    (lower === leftLower && left.lowerInclusive) || (lower === rightLower && right.lowerInclusive);
  const upperInclusive =
    (upper === leftUpper && left.upperInclusive) || (upper === rightUpper && right.upperInclusive);
  return lowerInclusive && upperInclusive;
};

const intervalsTouch = (left: IntervalShape, right: IntervalShape): boolean => {
  const leftUpper = left.upper ?? Number.POSITIVE_INFINITY;
  const rightLower = right.lower ?? Number.NEGATIVE_INFINITY;
  if (leftUpper !== rightLower) return false;
  return left.upperInclusive || right.lowerInclusive;
};

/**
 * 数值阈值规范排序后的唯一归一结果；重叠、内部空洞与非数值 `eq` 重复都在此拒绝。
 * 生命周期内不得另写端点分支。
 */
export const normalizeScoringThresholds = (
  thresholds: readonly ScoringThreshold[],
  targetRef: ContractReferenceV1 = SCORING_RULES_AUTHORING_TARGET_REF_V1,
): readonly NormalizedScoringThresholdV1[] => {
  const normalized = thresholds.map(normalizeThreshold);
  const numeric = sortByLower(normalized.filter((value) => value.kind === "numeric"));
  for (let index = 1; index < numeric.length; index += 1) {
    const previous = numeric[index - 1]!;
    const current = numeric[index]!;
    if (intervalsOverlap(previous, current)) {
      failScoringRule("scoring-rule-threshold-invalid", targetRef);
    }
    if (!intervalsTouch(previous, current)) {
      failScoringRule("scoring-rule-threshold-invalid", targetRef);
    }
  }
  const discrete = normalized.filter((value) => value.kind === "discrete");
  const seen = new Set<string>();
  for (const value of discrete) {
    const key = `${typeof value.value}:${String(value.value)}`;
    if (seen.has(key)) failScoringRule("scoring-rule-threshold-invalid", targetRef);
    seen.add(key);
  }
  const ids = new Set(normalized.map((value) => value.thresholdId));
  if (ids.size !== normalized.length) {
    failScoringRule("scoring-rule-threshold-invalid", targetRef);
  }
  return [...numeric, ...discrete];
};

/** 等级区间固定左闭右开；缺下界/上界分别映射 −∞/＋∞，首尾相接且无内部空洞。 */
export const normalizeGradeIntervals = (
  intervals: readonly GradeInterval[],
  targetRef: ContractReferenceV1 = SCORING_RULES_AUTHORING_TARGET_REF_V1,
): readonly NormalizedGradeIntervalV1[] => {
  const normalized = intervals.map((interval) =>
    NormalizedGradeIntervalV1Schema.parse({
      grade: interval.grade,
      lower: interval.lowerBound ?? null,
      upper: interval.upperBound ?? null,
      lowerInclusive: true,
      upperInclusive: false,
    }),
  );
  if (new Set(normalized.map((value) => value.grade)).size !== normalized.length) {
    failScoringRule("scoring-rule-grade-invalid", targetRef);
  }
  const ordered = sortByLower(normalized);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (intervalsOverlap(previous, current)) {
      failScoringRule("scoring-rule-grade-invalid", targetRef);
    }
    if (!intervalsTouch(previous, current)) {
      failScoringRule("scoring-rule-grade-invalid", targetRef);
    }
  }
  return ordered;
};

const numericThresholdMatches = (
  threshold: NormalizedScoringThresholdV1 & { kind: "numeric" },
  value: number,
): boolean => {
  if (value < (threshold.lower ?? Number.NEGATIVE_INFINITY)) return false;
  if (value > (threshold.upper ?? Number.POSITIVE_INFINITY)) return false;
  if (value === threshold.lower && !threshold.lowerInclusive) return false;
  if (value === threshold.upper && !threshold.upperInclusive) return false;
  return true;
};

const gradeFor = (
  intervals: readonly NormalizedGradeIntervalV1[],
  value: number,
): string | undefined =>
  intervals.find(
    (interval) =>
      value >= (interval.lower ?? Number.NEGATIVE_INFINITY) &&
      value < (interval.upper ?? Number.POSITIVE_INFINITY),
  )?.grade;

/**
 * 唯一求值入口：端点、无穷边界与越界失败由同一归一结果解释，冲突检测与下游评分必须复用。
 */
export const evaluateScoringRule = (
  rule: StructuredScoringRule,
  actualValue: ScalarValue,
): ScoringRuleEvaluationResultV1 => {
  const targetRef = scoringRuleTargetRef(rule.ruleId, rule.ruleVersion.versionId);
  const thresholds = normalizeScoringThresholds(rule.scoringThresholds, targetRef);
  const grades = normalizeGradeIntervals(rule.gradeIntervals, targetRef);
  if (typeof actualValue === "number") {
    const numeric = thresholds.filter(
      (threshold): threshold is NormalizedScoringThresholdV1 & { kind: "numeric" } =>
        threshold.kind === "numeric",
    );
    if (numeric.length === 0) {
      return ScoringRuleEvaluationResultV1Schema.parse({
        kind: "rejected",
        reasonCode: "scoring-value-type-mismatch",
      });
    }
    const matched = numeric.find((threshold) => numericThresholdMatches(threshold, actualValue));
    if (matched === undefined) {
      return ScoringRuleEvaluationResultV1Schema.parse({
        kind: "rejected",
        reasonCode: "scoring-value-out-of-range",
      });
    }
    const grade = gradeFor(grades, actualValue);
    if (grade === undefined) {
      return ScoringRuleEvaluationResultV1Schema.parse({
        kind: "rejected",
        reasonCode: "scoring-value-out-of-range",
      });
    }
    return ScoringRuleEvaluationResultV1Schema.parse({
      kind: "evaluated",
      thresholdId: matched.thresholdId,
      score: matched.score,
      grade,
    });
  }
  const discrete = thresholds.filter(
    (threshold): threshold is NormalizedScoringThresholdV1 & { kind: "discrete" } =>
      threshold.kind === "discrete",
  );
  const sameType = discrete.filter((threshold) => threshold.value === actualValue);
  if (discrete.length === 0) {
    return ScoringRuleEvaluationResultV1Schema.parse({
      kind: "rejected",
      reasonCode: "scoring-value-type-mismatch",
    });
  }
  if (sameType.length === 0) {
    return ScoringRuleEvaluationResultV1Schema.parse({
      kind: "rejected",
      reasonCode: "scoring-value-out-of-range",
    });
  }
  const matched = sameType[0]!;
  const grade = grades.find(
    (interval) => interval.lower === null && interval.upper === null,
  )?.grade;
  if (grade === undefined) {
    return ScoringRuleEvaluationResultV1Schema.parse({
      kind: "rejected",
      reasonCode: "scoring-value-out-of-range",
    });
  }
  return ScoringRuleEvaluationResultV1Schema.parse({
    kind: "evaluated",
    thresholdId: matched.thresholdId,
    score: matched.score,
    grade,
  });
};

/* -------------------------------------------------------------------------- */
/* Deterministic validation and materialization (D-06, D-09)                  */
/* -------------------------------------------------------------------------- */

export interface ScoringRuleValidationInputV1 {
  readonly manifest: ScoringRuleAuthoringManifestV1;
  readonly policy: ScoringRulesPolicyV1;
  readonly agentTaskRef: AgentTaskRefV1;
  readonly baseDocument?: StructuredScoringRuleDocumentV1;
  readonly candidate: ScoringRuleAuthoringCandidateV1;
  readonly indicatorIds: readonly string[];
  readonly configurationSetRef: VersionReference;
  readonly compatibilityRef: VersionReference;
  readonly existingRules?: readonly StructuredScoringRule[];
}

export interface ScoringRuleValidationOutcomeV1 {
  readonly disposition: "accepted" | "rejected";
  readonly rejectionClass?: "repairable" | "terminal";
  readonly validation: ScoringRuleValidationViewV1;
  readonly acceptedMembers: readonly StructuredScoringRuleMemberV1[];
}

const repairableReasons: Readonly<Record<string, true>> = {
  "scoring-rule-content-invalid": true,
  "scoring-rule-review-status-not-pending": true,
  "scoring-rule-applicability-incomplete": true,
  "scoring-rule-indicator-unknown": true,
  "scoring-rule-threshold-invalid": true,
  "scoring-rule-grade-invalid": true,
  "scoring-rule-exception-unknown": true,
  "scoring-rule-evidence-unverified": true,
  "scoring-rule-operation-invalid": true,
  "scoring-rule-target-unknown": true,
  "scoring-rule-envelope-invalid": true,
  "scoring-rule-limit-exceeded": true,
};

const retryableReasonCodes: Readonly<Record<string, true>> = {
  "scoring-rule-artifact-unavailable": true,
};

export const scoringRuleRejectionClassFor = (
  reasonCode: ScoringRulesReasonCodeV1,
): "repairable" | "terminal" =>
  repairableReasons[reasonCode] === true ? "repairable" : "terminal";

export const isRetryableScoringRuleReason = (reasonCode: ScoringRulesReasonCodeV1): boolean =>
  retryableReasonCodes[reasonCode] === true;

const memberContent = (rule: StructuredScoringRule) => ({
  ruleId: rule.ruleId,
  applicabilityConditions: rule.applicabilityConditions,
  indicatorItem: rule.indicatorItem,
  scoringThresholds: rule.scoringThresholds,
  gradeIntervals: rule.gradeIntervals,
  exceptionClauses: rule.exceptionClauses,
  evidenceLocator: rule.evidenceLocator,
  reviewStatus: rule.reviewStatus,
});

/** 规则版本由 accepted operation 与 base release 规范摘要确定，不接受 Agent 自造版本。 */
export const deriveScoringRuleVersion = (input: {
  readonly rule: StructuredScoringRule;
  readonly baseRuleVersionRef?: {
    readonly entityId: string;
    readonly versionId: string;
  };
}): { readonly entityId: string; readonly versionId: string } => ({
  entityId: input.rule.ruleId,
  versionId: sha256CanonicalJson({
    content: memberContent(input.rule),
    base: input.baseRuleVersionRef ?? null,
  }),
});

const retainedSegmentIndex = (
  manifest: ScoringRuleAuthoringManifestV1,
): Map<string, Set<string>> => {
  const index = new Map<string, Set<string>>();
  for (const entry of manifest.retainedSourceSegments) {
    index.set(
      `${entry.sourceVersionRef.reference.entityId}@${entry.sourceVersionRef.reference.versionId}`,
      new Set(entry.sourceSegmentIds),
    );
  }
  return index;
};

const applicabilityIsCanonical = (rule: StructuredScoringRule): boolean => {
  for (const dimension of [
    rule.applicabilityConditions.constructionMethod,
    rule.applicabilityConditions.stratumCondition,
    rule.applicabilityConditions.engineeringStage,
  ]) {
    if (dimension.length === 0) return false;
    for (let index = 1; index < dimension.length; index += 1) {
      if (dimension[index - 1]! >= dimension[index]!) return false;
    }
  }
  return true;
};

const operationTargetRef = (operation: ScoringRuleOperationV1): ContractReferenceV1 =>
  scoringRuleTargetRef(operation.ruleId);

const buildItem = (
  checkId: string,
  disposition: "accepted" | "rejected",
  reasonCode: ScoringRuleValidationItemV1["reasonCode"],
  evidenceReferences: readonly {
    readonly locator: { readonly sourceSegmentId: string };
    readonly sourceVersion: { readonly entityId: string; readonly versionId: string };
  }[] = [],
): ScoringRuleValidationItemV1 =>
  ScoringRuleValidationItemV1Schema.parse({
    checkId,
    disposition,
    reasonCode,
    evidenceReferences: [...evidenceReferences].slice(0, 16),
    ...(disposition === "rejected"
      ? { rejectionClass: scoringRuleRejectionClassFor(reasonCode as ScoringRulesReasonCodeV1) }
      : {}),
  });

/** 校验项只保留 C08 允许的字段；来源证据随项一起保留。 */
const operationCheckId = (ruleId: string | undefined, index: number): string =>
  `${ruleId ?? "candidate"}:${index}`;

/**
 * 逐项决定：先 schema、reviewStatus、三维、指标、阈值/区间、例外、证据与 base 版本；
 * 可修复错误留在原预算内修正，来源/权限/版本/冲突失败不可绕过。
 */
export const validateScoringRuleOperations = (
  input: ScoringRuleValidationInputV1,
): ScoringRuleValidationOutcomeV1 => {
  const candidate = ScoringRuleAuthoringCandidateV1Schema.safeParse(input.candidate);
  if (!candidate.success) {
    const item = buildItem("candidate-envelope", "rejected", "scoring-rule-envelope-invalid");
    return {
      disposition: "rejected",
      rejectionClass: "repairable",
      validation: { disposition: "rejected", rejectionClass: "repairable", items: [item] },
      acceptedMembers: [],
    };
  }
  const indicatorIds = new Set(input.indicatorIds);
  const segments = retainedSegmentIndex(input.manifest);
  const baseById = new Map(
    (input.baseDocument?.members ?? []).map((member) => [member.rule.ruleId, member] as const),
  );
  const existingIds = new Set((input.existingRules ?? []).map((rule) => rule.ruleId));
  const items: ScoringRuleValidationItemV1[] = [];
  const applied = new Map(baseById);
  const acceptedMembers: StructuredScoringRuleMemberV1[] = [];

  for (const [index, operationValue] of candidate.data.operations.entries()) {
    const operation = ScoringRuleOperationV1Schema.safeParse(operationValue);
    if (!operation.success) {
      items.push(
        buildItem(operationCheckId(undefined, index), "rejected", "scoring-rule-operation-invalid"),
      );
      continue;
    }
    const typed = operation.data as ScoringRuleOperationV1;
    const reject = (reasonCode: ScoringRuleValidationItemV1["reasonCode"]): void => {
      items.push(
        buildItem(
          operationCheckId(typed.ruleId, index),
          "rejected",
          reasonCode,
          typed.evidenceReferences,
        ),
      );
    };
    if (typed.rule.ruleId !== typed.ruleId) {
      reject("scoring-rule-content-invalid");
      continue;
    }
    if (typed.rule.reviewStatus !== "pending") {
      reject("scoring-rule-review-status-not-pending");
      continue;
    }
    if (!applicabilityIsCanonical(typed.rule)) {
      reject("scoring-rule-applicability-incomplete");
      continue;
    }
    if (!indicatorIds.has(typed.rule.indicatorItem)) {
      reject("scoring-rule-indicator-unknown");
      continue;
    }
    if (typed.rule.exceptionClauses.some((clause) => !existingIds.has(clause))) {
      reject("scoring-rule-exception-unknown");
      continue;
    }
    const retained = segments.get(
      `${typed.sourceVersionRef.reference.entityId}@${typed.sourceVersionRef.reference.versionId}`,
    );
    if (retained === undefined) {
      reject("scoring-rule-source-unavailable");
      continue;
    }
    if (!retained.has(typed.rule.evidenceLocator.sourceSegmentId)) {
      reject("scoring-rule-evidence-unverified");
      continue;
    }
    if (
      typed.evidenceReferences.some(
        (reference) =>
          reference.sourceVersion.entityId !== typed.sourceVersionRef.reference.entityId ||
          reference.sourceVersion.versionId !== typed.sourceVersionRef.reference.versionId ||
          !retained.has(reference.locator.sourceSegmentId),
      )
    ) {
      reject("scoring-rule-evidence-unverified");
      continue;
    }
    try {
      normalizeScoringThresholds(typed.rule.scoringThresholds, operationTargetRef(typed));
      normalizeGradeIntervals(typed.rule.gradeIntervals, operationTargetRef(typed));
    } catch (error) {
      const failure = scoringRuleFailureFrom(error);
      reject(
        failure?.reasonCode === "scoring-rule-grade-invalid"
          ? "scoring-rule-grade-invalid"
          : "scoring-rule-threshold-invalid",
      );
      continue;
    }
    if (typed.kind === "add-rule") {
      if (baseById.has(typed.ruleId)) {
        reject("scoring-rule-base-version-conflict");
        continue;
      }
    } else {
      const base = baseById.get(typed.ruleId);
      if (
        base === undefined ||
        base.rule.ruleVersion.entityId !== typed.baseRuleVersion.entityId ||
        base.rule.ruleVersion.versionId !== typed.baseRuleVersion.versionId
      ) {
        reject("scoring-rule-base-version-conflict");
        continue;
      }
      if (applied.get(typed.ruleId) !== base) {
        reject("scoring-rule-base-version-conflict");
        continue;
      }
    }
    const binding: ScoringRuleSourceBindingV1 = {
      sourceVersionRef: typed.sourceVersionRef,
      cleaningResultArtifactRef: input.manifest.cleaningResultArtifactRef,
      evidenceReferences: typed.evidenceReferences,
      agentTaskRef: input.agentTaskRef,
    };
    const member: StructuredScoringRuleMemberV1 = {
      rule: { ...typed.rule, ruleVersion: deriveScoringRuleVersion({ rule: typed.rule }) },
      binding,
    };
    applied.set(typed.ruleId, member);
    acceptedMembers.push(member);
    items.push(
      buildItem(
        operationCheckId(typed.ruleId, index),
        "accepted",
        "scoring-rule-content-valid",
        typed.evidenceReferences,
      ),
    );
  }

  const rejectedItems = items.filter((item) => item.disposition === "rejected");
  if (rejectedItems.length > 0) {
    const rejectionClass = rejectedItems.some((item) => item.rejectionClass === "terminal")
      ? "terminal"
      : "repairable";
    return {
      disposition: "rejected",
      rejectionClass,
      validation: { disposition: "rejected", rejectionClass, items },
      acceptedMembers: [],
    };
  }
  return {
    disposition: "accepted",
    validation: { disposition: "accepted", items },
    acceptedMembers,
  };
};

export const materializeScoringRuleDocument = (input: {
  readonly manifest: ScoringRuleAuthoringManifestV1;
  readonly agentTaskRef: AgentTaskRefV1;
  readonly members: readonly StructuredScoringRuleMemberV1[];
}): StructuredScoringRuleDocumentV1 => {
  const deduped = new Map(input.members.map((member) => [member.rule.ruleId, member] as const));
  const members = [...deduped.values()].sort((left, right) =>
    left.rule.ruleId < right.rule.ruleId ? -1 : 1,
  );
  if (members.length === 0 || members.length > SCORING_RULES_MAX_RULES_V1) {
    failScoringRule("scoring-rule-set-incomplete", SCORING_RULES_AUTHORING_TARGET_REF_V1);
  }
  return StructuredScoringRuleDocumentV1Schema.parse({
    schemaVersion: "1",
    projectRevisionRef: input.manifest.projectRevisionRef,
    configurationSetRef: input.manifest.configurationSetRef,
    compatibilityRef: input.manifest.compatibilityRef,
    scoringPolicyRef: input.manifest.scoringPolicyRef,
    cleaningResultArtifactRef: input.manifest.cleaningResultArtifactRef,
    agentTaskRef: input.agentTaskRef,
    members,
  });
};

/* -------------------------------------------------------------------------- */
/* Conflict and overlap detection (D-07)                                      */
/* -------------------------------------------------------------------------- */

export interface ScoringRuleRelationCandidateV1 {
  readonly rule: StructuredScoringRule;
  readonly sourceVersionRef: {
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
  readonly standardKind?: string;
}

export type ScoringRuleRelationTemplateV1 = Omit<ScoringRuleRelationV1, "relationId">;

export interface ScoringRuleRelationTemplateSnapshotV1 {
  readonly policyRef: VersionReference;
  readonly candidateContentDigest: string;
  readonly baseReleaseRef?: KnowledgeReleaseRefV1;
  readonly baseRevisionRef?: KnowledgeRevisionRefV1;
  readonly relations: readonly ScoringRuleRelationTemplateV1[];
}

const applicabilityIntersects = (
  left: StructuredScoringRule,
  right: StructuredScoringRule,
): boolean => {
  const dims = [
    [
      left.applicabilityConditions.constructionMethod,
      right.applicabilityConditions.constructionMethod,
    ],
    [left.applicabilityConditions.stratumCondition, right.applicabilityConditions.stratumCondition],
    [left.applicabilityConditions.engineeringStage, right.applicabilityConditions.engineeringStage],
  ] as const;
  return dims.every(([leftValues, rightValues]) =>
    leftValues.some((value) => rightValues.includes(value)),
  );
};

const intersectIntervals = (values: readonly IntervalShape[]): IntervalShape | undefined => {
  const lowerValue = Math.max(...values.map((value) => value.lower ?? Number.NEGATIVE_INFINITY));
  const upperValue = Math.min(...values.map((value) => value.upper ?? Number.POSITIVE_INFINITY));
  const lowerInclusive = values.every(
    (value) => (value.lower ?? Number.NEGATIVE_INFINITY) !== lowerValue || value.lowerInclusive,
  );
  const upperInclusive = values.every(
    (value) => (value.upper ?? Number.POSITIVE_INFINITY) !== upperValue || value.upperInclusive,
  );
  if (
    lowerValue > upperValue ||
    (lowerValue === upperValue && !(lowerInclusive && upperInclusive))
  ) {
    return undefined;
  }
  return {
    lower: Number.isFinite(lowerValue) ? lowerValue : null,
    lowerInclusive,
    upper: Number.isFinite(upperValue) ? upperValue : null,
    upperInclusive,
  };
};

const mergeIds = (left: readonly string[], right: readonly string[]): string[] =>
  [...new Set([...left, ...right])].sort();

const unionIntervals = (left: IntervalShape, right: IntervalShape): IntervalShape => {
  const leftUpper = left.upper ?? Number.POSITIVE_INFINITY;
  const rightUpper = right.upper ?? Number.POSITIVE_INFINITY;
  if (rightUpper > leftUpper) {
    return { ...left, upper: right.upper, upperInclusive: right.upperInclusive };
  }
  if (rightUpper === leftUpper) {
    return { ...left, upperInclusive: left.upperInclusive || right.upperInclusive };
  }
  return left;
};

const versionKey = (value: VersionReference): string =>
  JSON.stringify([value.entityId, value.versionId]);

const sameRuleIdentity = (
  left: ScoringRuleRelationCandidateV1,
  right: ScoringRuleRelationCandidateV1,
): boolean =>
  scoringRuleIdentityKey(left.rule.ruleId, left.rule.ruleVersion) ===
  scoringRuleIdentityKey(right.rule.ruleId, right.rule.ruleVersion);

const assertUniqueRuleIdentities = (
  candidates: readonly ScoringRuleRelationCandidateV1[],
): void => {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.rule.ruleId !== candidate.rule.ruleVersion.entityId) {
      failScoringRule("scoring-rule-content-invalid", scoringRuleTargetRef(candidate.rule.ruleId));
    }
    const key = scoringRuleIdentityKey(candidate.rule.ruleId, candidate.rule.ruleVersion);
    if (seen.has(key)) {
      failScoringRule("scoring-rule-content-invalid", scoringRuleTargetRef(candidate.rule.ruleId));
    }
    seen.add(key);
  }
};

interface RelationContribution {
  readonly domainType: "numeric" | "discrete";
  readonly discreteValue?: ScalarValue;
  readonly relationKind: ScoringRuleRelationKindV1;
  readonly conclusionDigest: string;
  readonly overlap: ScoringRuleOverlapDomainV1;
}

const relationContributions = (input: {
  readonly left: StructuredScoringRule;
  readonly right: StructuredScoringRule;
  readonly exceptionsConflict: boolean;
}): RelationContribution[] => {
  const leftRef = scoringRuleTargetRef(input.left.ruleId, input.left.ruleVersion.versionId);
  const rightRef = scoringRuleTargetRef(input.right.ruleId, input.right.ruleVersion.versionId);
  const leftThresholds = normalizeScoringThresholds(input.left.scoringThresholds, leftRef);
  const rightThresholds = normalizeScoringThresholds(input.right.scoringThresholds, rightRef);
  const leftGrades = normalizeGradeIntervals(input.left.gradeIntervals, leftRef);
  const rightGrades = normalizeGradeIntervals(input.right.gradeIntervals, rightRef);
  const contributions: RelationContribution[] = [];
  const leftNumeric = leftThresholds.filter(
    (value): value is NormalizedScoringThresholdV1 & { kind: "numeric" } =>
      value.kind === "numeric",
  );
  const rightNumeric = rightThresholds.filter(
    (value): value is NormalizedScoringThresholdV1 & { kind: "numeric" } =>
      value.kind === "numeric",
  );
  for (const leftThreshold of leftNumeric) {
    for (const rightThreshold of rightNumeric) {
      if (!intervalsOverlap(leftThreshold, rightThreshold)) continue;
      for (const leftGrade of leftGrades) {
        for (const rightGrade of rightGrades) {
          const domain = intersectIntervals([leftThreshold, rightThreshold, leftGrade, rightGrade]);
          if (domain === undefined) continue;
          const relationKind =
            input.exceptionsConflict ||
            leftThreshold.score !== rightThreshold.score ||
            leftGrade.grade !== rightGrade.grade
              ? "conflict"
              : "overlap";
          contributions.push({
            domainType: "numeric",
            relationKind,
            conclusionDigest: sha256CanonicalJson({
              leftScore: leftThreshold.score,
              leftGrade: leftGrade.grade,
              rightScore: rightThreshold.score,
              rightGrade: rightGrade.grade,
            }),
            overlap: ScoringRuleOverlapDomainV1Schema.parse({
              indicatorItem: input.left.indicatorItem,
              ...domain,
              leftThresholdIds: [leftThreshold.thresholdId],
              rightThresholdIds: [rightThreshold.thresholdId],
              leftGradeIds: [leftGrade.grade],
              rightGradeIds: [rightGrade.grade],
            }),
          });
        }
      }
    }
  }
  const leftDiscrete = leftThresholds.filter(
    (value): value is NormalizedScoringThresholdV1 & { kind: "discrete" } =>
      value.kind === "discrete",
  );
  const rightDiscrete = rightThresholds.filter(
    (value): value is NormalizedScoringThresholdV1 & { kind: "discrete" } =>
      value.kind === "discrete",
  );
  const leftDiscreteGrade = leftGrades.find(
    (grade) => grade.lower === null && grade.upper === null,
  );
  const rightDiscreteGrade = rightGrades.find(
    (grade) => grade.lower === null && grade.upper === null,
  );
  if (leftDiscreteGrade !== undefined && rightDiscreteGrade !== undefined) {
    for (const leftThreshold of leftDiscrete) {
      for (const rightThreshold of rightDiscrete) {
        if (leftThreshold.value !== rightThreshold.value) continue;
        contributions.push({
          domainType: "discrete",
          discreteValue: leftThreshold.value,
          relationKind:
            input.exceptionsConflict ||
            leftThreshold.score !== rightThreshold.score ||
            leftDiscreteGrade.grade !== rightDiscreteGrade.grade
              ? "conflict"
              : "overlap",
          conclusionDigest: sha256CanonicalJson({
            leftScore: leftThreshold.score,
            leftGrade: leftDiscreteGrade.grade,
            rightScore: rightThreshold.score,
            rightGrade: rightDiscreteGrade.grade,
          }),
          overlap: ScoringRuleOverlapDomainV1Schema.parse({
            indicatorItem: input.left.indicatorItem,
            lower: null,
            lowerInclusive: false,
            upper: null,
            upperInclusive: false,
            leftThresholdIds: [leftThreshold.thresholdId],
            rightThresholdIds: [rightThreshold.thresholdId],
            leftGradeIds: [leftDiscreteGrade.grade],
            rightGradeIds: [rightDiscreteGrade.grade],
          }),
        });
      }
    }
  }
  return contributions;
};

const mergeRelationContributions = (
  contributions: readonly RelationContribution[],
): RelationContribution[] => {
  const ordered = [...contributions].sort((left, right) => {
    if (left.domainType !== right.domainType) return left.domainType < right.domainType ? -1 : 1;
    if (left.domainType === "discrete") {
      return sha256CanonicalJson(left.discreteValue) < sha256CanonicalJson(right.discreteValue)
        ? -1
        : 1;
    }
    const leftLower = left.overlap.lower ?? Number.NEGATIVE_INFINITY;
    const rightLower = right.overlap.lower ?? Number.NEGATIVE_INFINITY;
    return leftLower - rightLower;
  });
  const merged: RelationContribution[] = [];
  for (const contribution of ordered) {
    const previous = merged.at(-1);
    const sameSemantics =
      previous?.relationKind === contribution.relationKind &&
      previous.conclusionDigest === contribution.conclusionDigest;
    if (
      previous !== undefined &&
      sameSemantics &&
      previous.domainType === "numeric" &&
      contribution.domainType === "numeric" &&
      (intervalsOverlap(previous.overlap, contribution.overlap) ||
        intervalsTouch(previous.overlap, contribution.overlap))
    ) {
      const union = unionIntervals(previous.overlap, contribution.overlap);
      merged[merged.length - 1] = {
        domainType: "numeric",
        relationKind: previous.relationKind,
        conclusionDigest: previous.conclusionDigest,
        overlap: ScoringRuleOverlapDomainV1Schema.parse({
          ...previous.overlap,
          ...union,
          leftThresholdIds: mergeIds(
            previous.overlap.leftThresholdIds,
            contribution.overlap.leftThresholdIds,
          ),
          rightThresholdIds: mergeIds(
            previous.overlap.rightThresholdIds,
            contribution.overlap.rightThresholdIds,
          ),
          leftGradeIds: mergeIds(previous.overlap.leftGradeIds, contribution.overlap.leftGradeIds),
          rightGradeIds: mergeIds(
            previous.overlap.rightGradeIds,
            contribution.overlap.rightGradeIds,
          ),
        }),
      };
      continue;
    }
    merged.push(contribution);
  }
  return merged;
};

const closeRelationTemplates = (
  relations: readonly ScoringRuleRelationTemplateV1[],
): ScoringRuleRelationTemplateV1[] => {
  const byDomain = new Map<string, ScoringRuleRelationTemplateV1>();
  for (const relation of relations) {
    const domainKey = sha256CanonicalJson({
      policyRef: relation.policyRef,
      leftRuleId: relation.leftRuleId,
      leftRuleVersion: relation.leftRuleVersion,
      rightRuleId: relation.rightRuleId,
      rightRuleVersion: relation.rightRuleVersion,
      overlapDigest: relation.overlapDigest,
    });
    const existing = byDomain.get(domainKey);
    if (existing === undefined) {
      byDomain.set(domainKey, relation);
      continue;
    }
    if (
      existing.relationKind !== relation.relationKind ||
      versionKey(existing.retainedRuleVersionRef) !== versionKey(relation.retainedRuleVersionRef) ||
      versionKey(existing.excludedRuleVersionRef) !== versionKey(relation.excludedRuleVersionRef) ||
      sha256CanonicalJson(existing.overlap) !== sha256CanonicalJson(relation.overlap)
    ) {
      failScoringRule("scoring-rule-content-invalid", SCORING_RULES_AUTHORING_TARGET_REF_V1);
    }
    byDomain.set(domainKey, {
      ...existing,
      evidenceReferences: [...existing.evidenceReferences, ...relation.evidenceReferences]
        .filter(
          (reference, index, all) =>
            all.findIndex(
              (candidate) => sha256CanonicalJson(candidate) === sha256CanonicalJson(reference),
            ) === index,
        )
        .sort((left, right) => (sha256CanonicalJson(left) < sha256CanonicalJson(right) ? -1 : 1))
        .slice(0, SCORING_RULES_MAX_RELATION_EVIDENCE_V1),
    });
  }
  return [...byDomain.values()].sort((left, right) => {
    const leftKey = sha256CanonicalJson(left);
    const rightKey = sha256CanonicalJson(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
};

/** 关系快照摘要：候选正文、精确比较基线与全部关系事实的唯一身份。 */
export const scoringRuleRelationSnapshotDigest = (input: {
  readonly policyRef: VersionReference;
  readonly candidateContentDigest: string;
  readonly baseReleaseRef?: KnowledgeReleaseRefV1;
  readonly baseRevisionRef?: KnowledgeRevisionRefV1;
  readonly relations: readonly ScoringRuleRelationV1[];
}): string =>
  sha256CanonicalJson({
    policyRef: input.policyRef,
    candidateContentDigest: input.candidateContentDigest,
    baseReleaseRef: input.baseReleaseRef ?? null,
    baseRevisionRef: input.baseRevisionRef ?? null,
    relations: input.relations,
  });

export interface ScoringRuleRelationDetectionInputV1 {
  readonly policyRef: VersionReference;
  /** 候选正文规范摘要；快照必须绑定被检测的那一份正文。 */
  readonly candidateContentDigest: string;
  readonly candidates: readonly ScoringRuleRelationCandidateV1[];
  /** 精确比较基线的已发布规则；只与候选比较，不互相比较。 */
  readonly baseline?: readonly ScoringRuleRelationCandidateV1[];
  readonly baseReleaseRef?: KnowledgeReleaseRefV1;
  readonly baseRevisionRef?: KnowledgeRevisionRefV1;
  readonly standardKindRank?: readonly string[];
  readonly evidenceReferences?: readonly {
    readonly locator: { readonly sourceSegmentId: string };
    readonly sourceVersion: { readonly entityId: string; readonly versionId: string };
  }[];
}

/**
 * 同一工程、兼容集合、指标与相交三维域内检测：结论不同或例外互否为 conflict，其余相交为 overlap。
 * 复用 `normalizeScoringThresholds`/`normalizeGradeIntervals`/`evaluateScoringRule` 的语义，
 * 输出绑定候选正文摘要、比较基线发布与全部关系事实的完整快照。
 */
export const detectRuleRelations = (
  input: ScoringRuleRelationDetectionInputV1,
): ScoringRuleRelationTemplateSnapshotV1 => {
  assertUniqueRuleIdentities(input.candidates);
  assertUniqueRuleIdentities(input.baseline ?? []);
  const rankOf = (candidate: ScoringRuleRelationCandidateV1): number => {
    const rank = input.standardKindRank?.indexOf(candidate.standardKind ?? "");
    return rank === undefined || rank < 0 ? Number.MAX_SAFE_INTEGER : rank;
  };
  const relations: ScoringRuleRelationTemplateV1[] = [];
  const compare = (
    firstCandidate: ScoringRuleRelationCandidateV1,
    secondCandidate: ScoringRuleRelationCandidateV1,
  ): void => {
    if (sameRuleIdentity(firstCandidate, secondCandidate)) {
      if (sha256CanonicalJson(firstCandidate.rule) !== sha256CanonicalJson(secondCandidate.rule)) {
        failScoringRule(
          "scoring-rule-content-invalid",
          scoringRuleTargetRef(firstCandidate.rule.ruleId),
        );
      }
      return;
    }
    const [leftCandidate, rightCandidate] = [firstCandidate, secondCandidate].sort((left, right) =>
      scoringRuleIdentityKey(left.rule.ruleId, left.rule.ruleVersion) <
      scoringRuleIdentityKey(right.rule.ruleId, right.rule.ruleVersion)
        ? -1
        : 1,
    );
    const left = leftCandidate!.rule;
    const right = rightCandidate!.rule;
    if (left.indicatorItem !== right.indicatorItem) return;
    if (!applicabilityIntersects(left, right)) return;
    const exceptionsConflict =
      left.exceptionClauses.length > 0 &&
      right.exceptionClauses.length > 0 &&
      left.exceptionClauses.every((clause) => !right.exceptionClauses.includes(clause));
    const priority = [leftCandidate!, rightCandidate!]
      .sort((first, second) => {
        const rankDelta = rankOf(first) - rankOf(second);
        if (rankDelta !== 0) return rankDelta;
        const firstKey = `${versionKey(first.sourceVersionRef.reference)}:${scoringRuleIdentityKey(first.rule.ruleId, first.rule.ruleVersion)}`;
        const secondKey = `${versionKey(second.sourceVersionRef.reference)}:${scoringRuleIdentityKey(second.rule.ruleId, second.rule.ruleVersion)}`;
        return firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0;
      })
      .map((candidate) => candidate.rule.ruleVersion);
    const retainedRuleVersionRef = priority[0]!;
    const excludedRuleVersionRef = priority[1]!;
    for (const contribution of mergeRelationContributions(
      relationContributions({ left, right, exceptionsConflict }),
    )) {
      const overlapDigest = sha256CanonicalJson({
        overlap: contribution.overlap,
        ...(contribution.domainType === "discrete"
          ? { discreteValue: contribution.discreteValue }
          : {}),
      });
      relations.push({
        relationKind: contribution.relationKind,
        policyRef: input.policyRef,
        leftRuleVersion: left.ruleVersion,
        rightRuleVersion: right.ruleVersion,
        leftRuleId: left.ruleId,
        rightRuleId: right.ruleId,
        overlap: contribution.overlap,
        overlapDigest,
        retainedRuleVersionRef,
        excludedRuleVersionRef,
        evidenceReferences: [...(input.evidenceReferences ?? [])].slice(
          0,
          SCORING_RULES_MAX_RELATION_EVIDENCE_V1,
        ),
      });
    }
  };
  for (let leftIndex = 0; leftIndex < input.candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < input.candidates.length; rightIndex += 1) {
      compare(input.candidates[leftIndex]!, input.candidates[rightIndex]!);
    }
  }
  for (const candidate of input.candidates) {
    for (const baselineCandidate of input.baseline ?? []) {
      compare(candidate, baselineCandidate);
    }
  }
  const sorted = closeRelationTemplates(relations);
  return {
    policyRef: input.policyRef,
    candidateContentDigest: input.candidateContentDigest,
    ...(input.baseReleaseRef === undefined ? {} : { baseReleaseRef: input.baseReleaseRef }),
    ...(input.baseRevisionRef === undefined ? {} : { baseRevisionRef: input.baseRevisionRef }),
    relations: sorted,
  };
};

export const bindScoringRuleRelationsToRevision = (input: {
  readonly projectId: string;
  readonly candidateRevisionRef: KnowledgeRevisionRefV1;
  readonly snapshot: ScoringRuleRelationTemplateSnapshotV1;
}): ScoringRuleRelationSnapshotV1 => {
  const relations = closeRelationTemplates(input.snapshot.relations)
    .map((relation) =>
      ScoringRuleRelationV1Schema.parse({
        ...relation,
        relationId: buildScoringRuleRelationIdentity({
          projectId: input.projectId,
          candidateRevisionRef: input.candidateRevisionRef,
          relationKind: relation.relationKind,
          policyRef: relation.policyRef,
          leftRuleId: relation.leftRuleId,
          leftRuleVersion: relation.leftRuleVersion,
          rightRuleId: relation.rightRuleId,
          rightRuleVersion: relation.rightRuleVersion,
          overlapDigest: relation.overlapDigest,
          retainedRuleVersionRef: relation.retainedRuleVersionRef,
          excludedRuleVersionRef: relation.excludedRuleVersionRef,
        }),
      }),
    )
    .sort((left, right) => (left.relationId < right.relationId ? -1 : 1));
  return ScoringRuleRelationSnapshotV1Schema.parse({
    ...input.snapshot,
    relations,
    relationDigest: scoringRuleRelationSnapshotDigest({
      ...input.snapshot,
      relations,
    }),
  });
};

/* -------------------------------------------------------------------------- */
/* Assessment basis member projection (D-14)                                  */
/* -------------------------------------------------------------------------- */

const releaseIdentityKey = (member: {
  readonly releaseRef: {
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
}): string => `${member.releaseRef.reference.entityId}@${member.releaseRef.reference.versionId}`;

/**
 * 适用规则集 `included refs` 的规范投影：逐项派生、不合并来源。
 * 成员已由 `ApplicableRuleSetDocumentV1Schema` 保证身份唯一且规范排序。
 */
export const projectApplicableRuleSetMembers = (
  document: ApplicableRuleSetDocumentV1,
): readonly AssessmentBasisReleaseSetMemberV1[] =>
  document.includedMembers
    .map((member) => ({
      releaseRef: member.releaseRef,
      revisionRef: member.revisionRef,
      artifactRef: member.artifactRef,
      contentDigest: member.contentDigest,
    }))
    .sort((left, right) => (releaseIdentityKey(left) < releaseIdentityKey(right) ? -1 : 1));

/** 规则成员重复即整体失败；不提供静默去重路径。 */
const assertUniqueRuleMembers = (members: readonly AssessmentBasisReleaseSetMemberV1[]): void => {
  const seen = new Set<string>();
  for (const member of members) {
    const key = releaseIdentityKey(member);
    if (seen.has(key)) {
      failScoringRule("scoring-rule-basis-unavailable", SCORING_RULES_BASIS_TARGET_REF_V1);
    }
    seen.add(key);
  }
};

export const buildAssessmentBasisMembers = (input: {
  readonly applicableRuleSetMember: AssessmentBasisReleaseSetMemberV1;
  readonly scoringRuleMembers: readonly AssessmentBasisReleaseSetMemberV1[];
  readonly configurationMembers: readonly AssessmentBasisConfigurationMemberV1[];
}): AssessmentBasisReleaseSetMembersV1 => {
  assertUniqueRuleMembers(input.scoringRuleMembers);
  return AssessmentBasisReleaseSetMembersV1Schema.parse({
    applicableRuleSetMember: input.applicableRuleSetMember,
    scoringRuleMembers: [...input.scoringRuleMembers].sort((left, right) =>
      releaseIdentityKey(left) < releaseIdentityKey(right) ? -1 : 1,
    ),
    configurationMembers: [...input.configurationMembers].sort((left, right) =>
      left.definitionType < right.definitionType ? -1 : 1,
    ),
  });
};

export const assessmentBasisMemberDigest = (members: AssessmentBasisReleaseSetMembersV1): string =>
  sha256CanonicalJson(members);

/** 规则集成员与 `included refs` 双向完备；任一缺失、重复或额外成员都整体失败。 */
export const assertScoringRuleMembersMatchApplicableRuleSet = (input: {
  readonly document: ApplicableRuleSetDocumentV1;
  readonly scoringRuleMembers: readonly AssessmentBasisReleaseSetMemberV1[];
}): void => {
  assertUniqueRuleMembers(input.scoringRuleMembers);
  const expected = projectApplicableRuleSetMembers(input.document);
  const actual = [...input.scoringRuleMembers].sort((left, right) =>
    releaseIdentityKey(left) < releaseIdentityKey(right) ? -1 : 1,
  );
  if (expected.length !== actual.length) {
    failScoringRule("scoring-rule-basis-unavailable", SCORING_RULES_BASIS_TARGET_REF_V1);
  }
  for (const [index, member] of actual.entries()) {
    const target = expected[index]!;
    if (
      releaseIdentityKey(member) !== releaseIdentityKey(target) ||
      member.revisionRef.reference.entityId !== target.revisionRef.reference.entityId ||
      member.revisionRef.reference.versionId !== target.revisionRef.reference.versionId ||
      member.artifactRef.reference.entityId !== target.artifactRef.reference.entityId ||
      member.artifactRef.reference.versionId !== target.artifactRef.reference.versionId ||
      member.contentDigest !== target.contentDigest
    ) {
      failScoringRule("scoring-rule-basis-unavailable", SCORING_RULES_BASIS_TARGET_REF_V1);
    }
  }
};

export interface ApplicableRuleSetCandidateV1 {
  readonly member: StructuredScoringRuleMemberV1;
  readonly ruleReleaseRef: KnowledgeReleaseRefV1;
  readonly ruleRevisionRef: KnowledgeRevisionRefV1;
  readonly artifactRef: {
    readonly kind: string;
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
  readonly contentDigest: string;
}

export interface AssembleApplicableRuleSetInputV1 {
  readonly projectRevisionRef: ProjectRevisionRefV1;
  readonly applicabilitySnapshotRef: {
    readonly kind: string;
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
  readonly applicability: ApplicabilityMetadata;
  readonly configurationSetRef: { readonly entityId: string; readonly versionId: string };
  readonly compatibilityRef: { readonly entityId: string; readonly versionId: string };
  readonly policy: ScoringRulesPolicyV1;
  readonly requiredAt: string;
  readonly candidates: readonly ApplicableRuleSetCandidateV1[];
  readonly relations: readonly ScoringRuleRelationV1[];
  readonly resolvedConflicts?: readonly {
    readonly retainedRuleVersionRef: { readonly entityId: string; readonly versionId: string };
    readonly excludedRuleVersionRef: { readonly entityId: string; readonly versionId: string };
  }[];
  readonly applicabilityMatches?: Readonly<
    Record<
      string,
      {
        readonly constructionMethod: boolean;
        readonly stratumCondition: boolean;
        readonly engineeringStage: boolean;
      }
    >
  >;
  readonly exceptionsByRuleId?: Readonly<Record<string, readonly string[]>>;
}

const matchesApplicability = (
  rule: StructuredScoringRule,
  applicability: ApplicabilityMetadata,
): {
  readonly constructionMethod: boolean;
  readonly stratumCondition: boolean;
  readonly engineeringStage: boolean;
} => ({
  constructionMethod: rule.applicabilityConditions.constructionMethod.includes(
    applicability.constructionMethod,
  ),
  stratumCondition: rule.applicabilityConditions.stratumCondition.includes(
    applicability.stratumCondition,
  ),
  engineeringStage: rule.applicabilityConditions.engineeringStage.includes(
    applicability.engineeringStage,
  ),
});

export const assembleApplicableRuleSet = (
  input: AssembleApplicableRuleSetInputV1,
): ApplicableRuleSetDocumentV1 => {
  if (input.candidates.length === 0) {
    failScoringRule("scoring-rule-set-incomplete", SCORING_RULES_ASSEMBLY_TARGET_REF_V1);
  }
  const pendingConflicts = input.relations.filter(
    (relation) => relation.relationKind === "conflict",
  );
  const resolved = new Set(
    (input.resolvedConflicts ?? []).map(
      (entry) =>
        `${entry.excludedRuleVersionRef.entityId}@${entry.excludedRuleVersionRef.versionId}`,
    ),
  );
  const overlapExclusions = new Set(
    input.relations
      .filter((relation) => relation.relationKind === "overlap")
      .map((relation) => versionKey(relation.excludedRuleVersionRef)),
  );
  const decisions: ApplicableRuleSetDecisionV1[] = [];
  const included: ApplicableRuleSetIncludedMemberV1[] = [];
  for (const candidate of input.candidates) {
    const rule = candidate.member.rule;
    const ruleVersionKey = versionKey(rule.ruleVersion);
    const match =
      input.applicabilityMatches?.[rule.ruleId] ?? matchesApplicability(rule, input.applicability);
    const relationRefs = input.relations
      .filter(
        (relation) => relation.leftRuleId === rule.ruleId || relation.rightRuleId === rule.ruleId,
      )
      .map((relation) => ({
        relationId: relation.relationId,
        relationKind: relation.relationKind,
      }));
    const exceptionValues = input.exceptionsByRuleId?.[rule.ruleId] ?? rule.exceptionClauses;
    const exclusionReason: ScoringRuleExclusionReasonV1 | undefined = (() => {
      if (!match.constructionMethod) return "construction-method-mismatch";
      if (!match.stratumCondition) return "stratum-condition-mismatch";
      if (!match.engineeringStage) return "engineering-stage-mismatch";
      if (exceptionValues.length > 0) return "exception-applies";
      const pending = pendingConflicts.find(
        (relation) =>
          (relation.leftRuleVersion.entityId === rule.ruleVersion.entityId &&
            relation.leftRuleVersion.versionId === rule.ruleVersion.versionId) ||
          (relation.rightRuleVersion.entityId === rule.ruleVersion.entityId &&
            relation.rightRuleVersion.versionId === rule.ruleVersion.versionId),
      );
      if (pending !== undefined) {
        const excludedKey = versionKey(pending.excludedRuleVersionRef);
        if (!resolved.has(excludedKey)) return "conflict-unresolved";
        if (excludedKey === ruleVersionKey) return "approved-conflict-resolution";
      }
      if (overlapExclusions.has(ruleVersionKey)) return "superseded-overlap";
      return undefined;
    })();
    const matchedDimensions = (
      [
        ["constructionMethod", "施工工法数据"],
        ["stratumCondition", "地层条件数据"],
        ["engineeringStage", "工程阶段数据"],
      ] as const
    )
      .filter(([key]) => match[key])
      .map(([, dimension]) => dimension);
    if (exclusionReason !== undefined) {
      decisions.push({
        ruleId: rule.ruleId,
        ruleVersion: rule.ruleVersion,
        decision: "excluded",
        reasonCode: exclusionReason,
        matchedDimensions,
        ruleReleaseRef: candidate.ruleReleaseRef,
        ruleRevisionRef: candidate.ruleRevisionRef,
        artifactRef: candidate.artifactRef as never,
        relationRefs,
      });
      continue;
    }
    decisions.push({
      ruleId: rule.ruleId,
      ruleVersion: rule.ruleVersion,
      decision: "included",
      reasonCode: "three-dimensional-match",
      matchedDimensions,
      ruleReleaseRef: candidate.ruleReleaseRef,
      ruleRevisionRef: candidate.ruleRevisionRef,
      artifactRef: candidate.artifactRef as never,
      relationRefs,
    });
    included.push(
      ApplicableRuleSetIncludedMemberV1Schema.parse({
        ruleId: rule.ruleId,
        ruleVersion: rule.ruleVersion,
        releaseRef: candidate.ruleReleaseRef,
        revisionRef: candidate.ruleRevisionRef,
        artifactRef: candidate.artifactRef,
        contentDigest: candidate.contentDigest,
      }),
    );
  }
  if (included.length === 0) {
    failScoringRule("scoring-rule-set-incomplete", SCORING_RULES_ASSEMBLY_TARGET_REF_V1);
  }
  return ApplicableRuleSetDocumentV1Schema.parse({
    schemaVersion: "1",
    projectRevisionRef: input.projectRevisionRef,
    applicabilitySnapshotRef: input.applicabilitySnapshotRef,
    applicability: input.applicability,
    configurationSetRef: input.configurationSetRef,
    compatibilityRef: input.compatibilityRef,
    assemblyPolicyRef: input.policy.assemblyPolicyRef,
    requiredAt: input.requiredAt,
    includedMembers: [...included].sort((left, right) =>
      `${left.releaseRef.reference.entityId}@${left.releaseRef.reference.versionId}` <
      `${right.releaseRef.reference.entityId}@${right.releaseRef.reference.versionId}`
        ? -1
        : 1,
    ),
    decisions: [...decisions].sort((left, right) => (left.ruleId < right.ruleId ? -1 : 1)),
  });
};
