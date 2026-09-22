import { randomUUID } from "node:crypto";

import type { VersionReference } from "@riskflow/contracts/common";
import { DomainEventV1Schema, type DomainEventV1 } from "@riskflow/contracts/events";
import {
  IdentificationAnalysisCommandV1Schema,
  IdentificationAnalysisResultV1Schema,
  IdentificationFinalizationCommandV1Schema,
  IdentificationFinalizationResultV1Schema,
  ModuleErrorV1Schema,
  ReviewRequestV1Schema,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type IdentificationAnalysisCommandV1,
  type IdentificationAnalysisResultV1,
  type IdentificationAnalysisSuccessV1,
  type IdentificationFinalizationCommandV1,
  type IdentificationFinalizationResultV1,
  type IdentificationFinalizationSuccessV1,
  type DomainEventRefV1,
  type ModuleErrorV1,
  type ModuleBranchV1,
  type ModuleCapabilityV1,
  type ReviewTaskRefV1,
} from "@riskflow/contracts/ports";
import type {
  ModelOutputResult,
  StandardizedRiskRecordEnvelope,
} from "@riskflow/contracts/records";
import { StandardizedRiskRecordEnvelopeSchema } from "@riskflow/contracts/records";

import { ArtifactPutCommandV1Schema } from "../../artifacts/index.js";
import {
  AtomicCommandV1Schema,
  sha256CanonicalJson,
  type AtomicCommitV1,
  type AtomicCommandV1,
  type TransactionContextV1,
} from "../../persistence/index.js";
import { authorizationScopeDigest } from "../../retrieval/service.js";
import type { ModelContextPayloadV1 } from "../context/schema.js";

import {
  CANDIDATE_REPAIRABLE_REASON_CODES_V1,
  CANDIDATE_VALIDATION_CHECK_IDS_V1,
  CANDIDATE_VALIDATION_REASON_CODES_V1,
  FORCED_REVIEW_REASON_CODES_V1,
  MERGE_SKIP_REASON_CODE_V1,
  RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1,
  RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
  RiskCandidateFinalizationResultRowV1Schema,
  acceptanceRouteSetRefFor,
  assertCompositeConfidenceWeights,
  assertMergePolicyWeights,
  candidateSetEntityIdFor,
  candidateSetRefFor,
  evidenceSnapshotRefFor,
  identificationGroupRefFor,
  identificationRunRefFor,
  mergePlanRefFor,
  modelContextResultIdFor,
  routeDecisionRefFor,
  validatedCandidateSetRefFor,
  validationSnapshotRefFor,
  type AcceptanceRouteSetV1,
  type AcceptanceRouteV1,
  type AutomaticAcceptanceDecisionV1,
  type CandidateValidationCheckV1,
  type CandidateValidationEntryV1,
  type CandidateValidationSetV1,
  type CompositeConfidenceBasisV1,
  type CompositeConfidencePolicyV1,
  type GroupCompositeConfidenceV1,
  type GroupMergeEvidenceV1,
  type IdentificationGroupMemberV1,
  type IdentificationGroupV1,
  type IdentificationSnapshotEntryV1,
  type IdentificationSnapshotV1,
  type MergePlanV1,
  type RiskCandidateFinalizationResultRowV1,
  type RiskCandidateGenerationPolicyV1,
  type RiskCandidateMergePolicyV1,
  type RiskCandidateSetV1,
  type RiskCandidateV1,
  type RiskCandidateValidationPolicyV1,
  type StandardizedRiskRecordWriteV1,
} from "./schema.js";
import type {
  IdentificationGroupDecisionReadV1,
  RiskCandidateFinalizationServiceOptionsV1,
  RiskCandidateRepairFeedbackV1,
} from "./ports.js";

const MAX_ARTIFACT_BYTES_V1 = 8 * 1024 * 1024;
const STAGE_PREFIX = "identification-candidate-finalization";
const CONTENT_REF_KIND = "content-artifact";

const CANDIDATE_NON_BLANK_FIELDS = ["riskSource", "riskFactor", "riskEvent"] as const;

const diagnosticRef = (stage: string) => ({
  kind: "diagnostic-artifact" as const,
  reference: { entityId: `${STAGE_PREFIX}-${stage}`, versionId: "v1" },
});

const authorizationDenied = (input: {
  readonly causalRunId: string;
  readonly occurredAt: string;
  readonly capability: ModuleCapabilityV1;
  readonly policyRef: VersionReference;
}): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    stageCode: `${STAGE_PREFIX}.authorization`,
    occurredAt: input.occurredAt,
    causalRunId: input.causalRunId,
    code: "AUTHORIZATION_DENIED",
    category: "authorization",
    retryable: false,
    requiredCapability: input.capability,
    authorizationPolicyRef: input.policyRef,
  });

const blocked = (input: {
  readonly causalRunId: string;
  readonly occurredAt: string;
  readonly blockerKind: string;
  readonly blockerRef: ContractReferenceV1;
}): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    stageCode: `${STAGE_PREFIX}.${input.blockerKind}`,
    occurredAt: input.occurredAt,
    causalRunId: input.causalRunId,
    code: "BUSINESS_BLOCKED",
    category: "business-blocked",
    retryable: false,
    blockerKind: input.blockerKind,
    blockerRef: input.blockerRef,
  });

const terminalFailure = (input: {
  readonly causalRunId: string;
  readonly occurredAt: string;
  readonly stage: string;
}): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    stageCode: `${STAGE_PREFIX}.${input.stage}`,
    occurredAt: input.occurredAt,
    causalRunId: input.causalRunId,
    code: "TERMINAL_FAILURE",
    category: "technical",
    retryable: false,
    diagnosticRef: diagnosticRef(input.stage),
  });

const idempotencyConflict = (input: {
  readonly causalRunId: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly priorCommandId: string;
}): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    stageCode: `${STAGE_PREFIX}.idempotency`,
    occurredAt: input.occurredAt,
    causalRunId: input.causalRunId,
    code: "IDEMPOTENCY_CONFLICT",
    category: "idempotency",
    retryable: false,
    idempotencyKey: input.idempotencyKey,
    priorCommandId: input.priorCommandId,
  });

const unsupportedContract = (causalRunId: string, occurredAt: string): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    stageCode: `${STAGE_PREFIX}.contract`,
    occurredAt,
    causalRunId,
    code: "UNSUPPORTED_CONTRACT",
    category: "technical",
    retryable: false,
    schemaVersion: RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
  });

/** 调用方按 `ModuleErrorV1` 收口的结构化错误；不携带任何正文或成员存在性。 */
export class RiskCandidateFinalizationError extends Error {
  readonly details: ModuleErrorV1;

  constructor(details: ModuleErrorV1) {
    super(details.code);
    this.name = "RiskCandidateFinalizationError";
    this.details = details;
  }
}

/** 事务内回退哨兵：抛出即整体回滚，不写登记行、审计或事件。 */
class FinalizationTransactionAbort extends Error {
  constructor() {
    super(`${STAGE_PREFIX}.transaction-abort`);
    this.name = "FinalizationTransactionAbort";
  }
}

const sameRef = (left: VersionReference, right: VersionReference): boolean =>
  left.entityId === right.entityId && left.versionId === right.versionId;

const referenceKey = (reference: VersionReference): string =>
  `${reference.entityId}\u0000${reference.versionId}`;

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const unit = (value: number): number => Math.min(1, Math.max(0, value));

const generationBudgetExceeded = (input: {
  readonly candidateCount: number;
  readonly usage: RiskCandidateSetV1["usage"];
  readonly policy: RiskCandidateGenerationPolicyV1;
}): boolean =>
  input.candidateCount > input.policy.budget.maxCandidates ||
  input.usage.totalTokens > input.policy.budget.maxTotalTokens ||
  input.usage.outputBytes > input.policy.budget.maxOutputBytes ||
  input.usage.elapsedMs > input.policy.budget.maxWallClockMs;

const asContentRef = (reference: VersionReference): ContractReferenceV1 => ({
  kind: CONTENT_REF_KIND,
  reference,
});

export { authorizationScopeDigest };

// ------------------------------------------------------------ RI-S58 证据索引

export interface VisibleEvidenceV1 {
  readonly sourceSegmentId: string;
  readonly sourceVersion: VersionReference;
  readonly mechanismEntryId?: string;
  readonly mechanismType?: string;
}

export interface VisibleEvidenceIndexV1 {
  readonly entries: readonly VisibleEvidenceV1[];
  readonly sourceVersionKeys: readonly string[];
}

/**
 * 由五项上下文构造确定性证据索引。候选没有机理字段，因此“机理条目适用性”只能由证据定位
 * 能否追溯到上下文机理条目裁定，这正是设计 D-05 的“机理引用来自同一发布且适用于节点”。
 */
export const buildVisibleEvidenceIndex = (
  modelContext: ModelContextPayloadV1,
): VisibleEvidenceIndexV1 => {
  const entries: VisibleEvidenceV1[] = [];
  const pushEvidence = (
    evidence: readonly {
      readonly locator: { readonly sourceSegmentId: string };
      readonly sourceVersion: VersionReference;
    }[],
    mechanism?: { readonly mechanismId: string; readonly mechanismType: string },
  ): void => {
    for (const item of evidence) {
      entries.push({
        sourceSegmentId: item.locator.sourceSegmentId,
        sourceVersion: item.sourceVersion,
        ...(mechanism === undefined
          ? {}
          : { mechanismEntryId: mechanism.mechanismId, mechanismType: mechanism.mechanismType }),
      });
    }
  };
  pushEvidence(modelContext.processNode.evidence);
  pushEvidence(modelContext.stateParameters.evidence);
  for (const dependency of modelContext.forceDependencies) pushEvidence(dependency.evidence);
  for (const mechanism of modelContext.mechanisms) {
    pushEvidence(mechanism.evidence, {
      mechanismId: mechanism.mechanismId,
      mechanismType: mechanism.mechanismType,
    });
  }
  for (const retrieval of modelContext.retrievalEvidence) pushEvidence(retrieval.evidence);
  return {
    entries,
    sourceVersionKeys: [
      ...new Set(
        entries.map(
          (entry) => `${entry.sourceVersion.entityId}\u0000${entry.sourceVersion.versionId}`,
        ),
      ),
    ].sort(),
  };
};

// ------------------------------------------------------ RI-S58～S59 确定性校验

export interface CandidateEvaluationInputV1 {
  readonly candidateSet: RiskCandidateSetV1;
  readonly candidateArtifactRefs: ReadonlyMap<string, VersionReference>;
  readonly modelContext: ModelContextPayloadV1;
  readonly policy: RiskCandidateValidationPolicyV1;
}

export interface CandidateEvaluationV1 {
  readonly entries: readonly CandidateValidationEntryV1[];
  readonly disposition: "accepted" | "repairable" | "terminal";
}

export const candidateEvaluationKey = (candidateId: string, candidateVersion: number): string =>
  `${candidateId}\u0000${candidateVersion}`;

const candidateCheck = (input: {
  readonly checkId: string;
  readonly passed: boolean;
  readonly okReasonCode: string;
  readonly failReasonCode: string;
  readonly evidenceRefs?: CandidateValidationCheckV1["evidenceRefs"];
}): CandidateValidationCheckV1 => ({
  checkId: input.checkId,
  passed: input.passed,
  reasonCode: input.passed ? input.okReasonCode : input.failReasonCode,
  evidenceRefs: [...(input.evidenceRefs ?? [])],
});

/**
 * 逐候选确定性校验（design D-05）。纯函数：只读冻结候选、五项上下文与精确策略版本，
 * 不访问网络、数据库或文件系统，也不调用模型。
 */
export const evaluateCandidate = (input: {
  readonly candidate: RiskCandidateV1;
  readonly candidateRef: VersionReference;
  readonly modelContext: ModelContextPayloadV1;
  readonly visible: VisibleEvidenceIndexV1;
  readonly policy: RiskCandidateValidationPolicyV1;
}): CandidateValidationEntryV1 => {
  const { candidate, modelContext, policy, visible } = input;
  const output = candidate.output;
  const accepted = CANDIDATE_VALIDATION_REASON_CODES_V1.accepted;

  const blankFields = CANDIDATE_NON_BLANK_FIELDS.filter(
    (field) => output[field].trim().length === 0,
  );
  const schemaPassed = blankFields.length === 0;
  const nodeBindingPassed =
    candidate.nodeId === modelContext.nodeId &&
    sameRef(candidate.inputSnapshotRef.reference, modelContext.inputSnapshotRef.reference) &&
    sameRef(candidate.workItemRef.reference, modelContext.workItemRef.reference);

  const matched = visible.entries.filter(
    (entry) => entry.sourceSegmentId === output.evidenceLocator.sourceSegmentId,
  );
  const allowedMechanismTypes = new Set(policy.allowedMechanismTypes);
  const applicableMechanisms = matched.filter(
    (entry) =>
      entry.mechanismType !== undefined &&
      (allowedMechanismTypes.size === 0 || allowedMechanismTypes.has(entry.mechanismType)),
  );
  const coveredMechanismTypes = new Set(
    applicableMechanisms.map((entry) => entry.mechanismType ?? ""),
  );
  const missingMechanismTypes = policy.requiredMechanismTypes.filter(
    (value) => !coveredMechanismTypes.has(value),
  );
  const relationTypes = new Set(output.riskElementRelations.map((entry) => entry.relation));
  const missingRelationTypes = policy.requiredRelationTypes.filter(
    (value) => !relationTypes.has(value),
  );
  const relationPassed =
    output.riskElementRelations.length > 0 &&
    output.riskElementRelations.every(
      (relation) =>
        relation.sourceElement.trim().length > 0 &&
        relation.targetElement.trim().length > 0 &&
        relation.relation.trim().length > 0 &&
        relation.sourceElement !== relation.targetElement,
    );

  const simulationConstraint = policy.simulationConstraint;
  const simulationPassed =
    simulationConstraint === undefined ||
    simulationConstraint.requiredSourceVersionRefs.every((required) =>
      visible.sourceVersionKeys.includes(
        `${required.reference.entityId}\u0000${required.reference.versionId}`,
      ),
    );

  const riskEventPassed =
    output.riskEvent.trim() !== output.riskSource.trim() &&
    output.riskEvent.trim() !== output.riskFactor.trim();

  const checks: CandidateValidationCheckV1[] = [
    candidateCheck({
      checkId: CANDIDATE_VALIDATION_CHECK_IDS_V1.schema,
      passed: schemaPassed,
      okReasonCode: accepted,
      failReasonCode: CANDIDATE_VALIDATION_REASON_CODES_V1.schemaInvalid,
    }),
    candidateCheck({
      checkId: CANDIDATE_VALIDATION_CHECK_IDS_V1.nodeBinding,
      passed: nodeBindingPassed,
      okReasonCode: accepted,
      failReasonCode: CANDIDATE_VALIDATION_REASON_CODES_V1.nodeMismatch,
    }),
    candidateCheck({
      checkId: CANDIDATE_VALIDATION_CHECK_IDS_V1.riskEvent,
      passed: riskEventPassed,
      okReasonCode: accepted,
      failReasonCode: CANDIDATE_VALIDATION_REASON_CODES_V1.schemaInvalid,
    }),
    candidateCheck({
      checkId: CANDIDATE_VALIDATION_CHECK_IDS_V1.relationEndpoints,
      passed: relationPassed,
      okReasonCode: accepted,
      failReasonCode: CANDIDATE_VALIDATION_REASON_CODES_V1.relationEndpointMissing,
    }),
    candidateCheck({
      checkId: CANDIDATE_VALIDATION_CHECK_IDS_V1.evidenceReachability,
      passed: matched.length > 0,
      okReasonCode: accepted,
      failReasonCode: CANDIDATE_VALIDATION_REASON_CODES_V1.evidenceNotFrozen,
      evidenceRefs: matched.map((entry) => ({
        locator: { sourceSegmentId: entry.sourceSegmentId },
        sourceVersion: entry.sourceVersion,
      })),
    }),
    candidateCheck({
      checkId: CANDIDATE_VALIDATION_CHECK_IDS_V1.mechanismApplicability,
      passed: applicableMechanisms.length > 0,
      okReasonCode: accepted,
      failReasonCode: CANDIDATE_VALIDATION_REASON_CODES_V1.mechanismNotApplicable,
      evidenceRefs: applicableMechanisms.map((entry) => ({
        locator: { sourceSegmentId: entry.sourceSegmentId },
        sourceVersion: entry.sourceVersion,
      })),
    }),
    candidateCheck({
      checkId: CANDIDATE_VALIDATION_CHECK_IDS_V1.ruleConsistency,
      passed: missingMechanismTypes.length === 0 && missingRelationTypes.length === 0,
      okReasonCode: accepted,
      failReasonCode: CANDIDATE_VALIDATION_REASON_CODES_V1.ruleConflict,
    }),
    candidateCheck({
      checkId: CANDIDATE_VALIDATION_CHECK_IDS_V1.simulationConstraint,
      passed: simulationPassed,
      okReasonCode: accepted,
      failReasonCode: CANDIDATE_VALIDATION_REASON_CODES_V1.simulationViolation,
    }),
  ];

  const repairableReasonCodes = new Set(policy.repairableReasonCodes);
  const failed = checks.filter((entry) => !entry.passed);
  const disposition: CandidateValidationEntryV1["disposition"] =
    failed.length === 0
      ? "accepted"
      : failed.every((entry) => repairableReasonCodes.has(entry.reasonCode))
        ? "repairable"
        : "terminal";

  return {
    candidateId: candidate.candidateId,
    candidateVersion: candidate.candidateVersion,
    candidateRef: { kind: CONTENT_REF_KIND, reference: input.candidateRef },
    disposition,
    checks,
  };
};

export const evaluateCandidateSet = (input: CandidateEvaluationInputV1): CandidateEvaluationV1 => {
  const visible = buildVisibleEvidenceIndex(input.modelContext);
  const entries = input.candidateSet.candidates.map((candidate) => {
    const reference = input.candidateArtifactRefs.get(
      candidateEvaluationKey(candidate.candidateId, candidate.candidateVersion),
    );
    if (reference === undefined) {
      throw new TypeError("candidate artifact reference is required for every candidate version");
    }
    return evaluateCandidate({
      candidate,
      candidateRef: reference,
      modelContext: input.modelContext,
      visible,
      policy: input.policy,
    });
  });
  return { entries, disposition: summarizeEvaluation(entries) };
};

const summarizeEvaluation = (
  entries: readonly CandidateValidationEntryV1[],
): CandidateEvaluationV1["disposition"] =>
  entries.every((entry) => entry.disposition === "accepted")
    ? "accepted"
    : entries.some((entry) => entry.disposition === "terminal")
      ? "terminal"
      : "repairable";

/** 设计 D-05 封闭集合校验：策略只能收窄，不能把权限/来源/版本/规则失败打开为可修正。 */
export const assertRepairableReasonCodes = (policy: RiskCandidateValidationPolicyV1): void => {
  const allowed = new Set<string>(CANDIDATE_REPAIRABLE_REASON_CODES_V1);
  for (const code of policy.repairableReasonCodes) {
    if (!allowed.has(code)) {
      throw new TypeError("validation policy widens the closed repairable reason set");
    }
  }
};

// ----------------------------------------------------- RI-S61 三信号合并（纯函数）

export interface MergeCandidateInputV1 {
  readonly candidateRef: VersionReference;
  readonly candidateId: string;
  readonly candidateVersion: number;
  readonly nodeId: string;
  readonly riskEvent: string;
  readonly modelConfidence: number;
  readonly sourceSegmentIds: readonly string[];
  readonly mechanismEntryIds: readonly string[];
  readonly sourceVersionKeys: readonly string[];
}

export interface MergeGroupDraftV1 {
  readonly members: readonly MergeCandidateInputV1[];
  readonly disposition: "merged" | "no-duplicate";
  readonly mergeEvidence: GroupMergeEvidenceV1;
}

const cosineSimilarity = (left: readonly number[], right: readonly number[]): number => {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return unit(dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)));
};

const setSimilarity = (left: readonly string[], right: readonly string[]): number => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const value of leftSet) if (rightSet.has(value)) intersection += 1;
  return unit(intersection / union.size);
};

interface MergeMemberViewV1 {
  readonly candidate: MergeCandidateInputV1;
  readonly vector: readonly number[];
}

const mergeNodeConsistency = (
  members: readonly MergeMemberViewV1[],
  policy: RiskCandidateMergePolicyV1,
): boolean => {
  const related = new Set(policy.relatedNodeIds);
  for (const left of members) {
    for (const right of members) {
      const consistent =
        left.candidate.nodeId === right.candidate.nodeId ||
        (related.has(left.candidate.nodeId) && related.has(right.candidate.nodeId));
      if (!consistent) return false;
    }
  }
  return true;
};

const mergeEvidenceOf = (
  members: readonly MergeMemberViewV1[],
  policy: RiskCandidateMergePolicyV1,
): GroupMergeEvidenceV1 => {
  const nodeSatisfied = mergeNodeConsistency(members, policy);
  let riskEvent = 1;
  let evidence = 1;
  for (let left = 0; left < members.length; left += 1) {
    for (let right = left + 1; right < members.length; right += 1) {
      const leftMember = members[left];
      const rightMember = members[right];
      if (leftMember === undefined || rightMember === undefined) continue;
      riskEvent = Math.min(riskEvent, cosineSimilarity(leftMember.vector, rightMember.vector));
      evidence = Math.min(
        evidence,
        setSimilarity(
          leftMember.candidate.sourceSegmentIds,
          rightMember.candidate.sourceSegmentIds,
        ),
      );
    }
  }
  const aggregate = nodeSatisfied
    ? unit(
        policy.weights.processNode +
          policy.weights.riskEvent * riskEvent +
          policy.weights.evidence * evidence,
      )
    : 0;
  const nodeIds = [...new Set(members.map((member) => member.candidate.nodeId))].sort();
  return {
    processNode: {
      signal: "process-node",
      satisfied: nodeSatisfied,
      nodeIds: nodeIds.length === 0 ? [""] : nodeIds,
      allowedNodeIds: [nodeIds[0] ?? "", ...policy.relatedNodeIds].sort(),
    },
    riskEvent: {
      signal: "risk-event",
      value: riskEvent,
      threshold: policy.riskEventCosineThreshold,
      satisfied: riskEvent >= policy.riskEventCosineThreshold,
    },
    evidence: {
      signal: "evidence-locator",
      value: evidence,
      threshold: policy.evidenceSetSimilarityThreshold,
      satisfied: evidence >= policy.evidenceSetSimilarityThreshold,
    },
    aggregate: {
      value: aggregate,
      threshold: policy.groupThreshold,
      satisfied: aggregate >= policy.groupThreshold,
    },
  };
};

/**
 * 全运行重复检测（design D-06）：输入按候选引用稳定排序后贪心形成团，扩展成员时不破坏组级
 * 三信号条件，因此最终组证据必然是稳定的下界证据，相同输入与策略重放得到相同分组。
 */
export const buildMergeGroups = (input: {
  readonly candidates: readonly MergeCandidateInputV1[];
  readonly vectors: readonly (readonly number[])[];
  readonly policy: RiskCandidateMergePolicyV1;
}): readonly MergeGroupDraftV1[] => {
  const policy = assertMergePolicyWeights(input.policy);
  const ordered: MergeMemberViewV1[] = input.candidates
    .map((candidate, index) => ({ candidate, vector: input.vectors[index] ?? [] }))
    .sort((left, right) => {
      const leftKey = referenceKey(left.candidate.candidateRef);
      const rightKey = referenceKey(right.candidate.candidateRef);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  const mergeable = (members: readonly MergeMemberViewV1[]): boolean => {
    if (members.length > policy.maxGroupMembers) return false;
    if (members.length < 2) return true;
    const evidence = mergeEvidenceOf(members, policy);
    return evidence.processNode.satisfied && evidence.aggregate.satisfied;
  };
  const assigned = new Set<string>();
  const groups: MergeGroupDraftV1[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const head = ordered[index];
    if (head === undefined) continue;
    if (assigned.has(referenceKey(head.candidate.candidateRef))) continue;
    const members: MergeMemberViewV1[] = [head];
    for (let candidateIndex = index + 1; candidateIndex < ordered.length; candidateIndex += 1) {
      const candidate = ordered[candidateIndex];
      if (candidate === undefined) continue;
      if (assigned.has(referenceKey(candidate.candidate.candidateRef))) continue;
      const extended = [...members, candidate];
      if (mergeable(extended)) members.push(candidate);
    }
    for (const member of members) assigned.add(referenceKey(member.candidate.candidateRef));
    const mergeEvidence = mergeEvidenceOf(members, policy);
    const disposition: MergeGroupDraftV1["disposition"] =
      members.length > 1 && mergeEvidence.processNode.satisfied && mergeEvidence.aggregate.satisfied
        ? "merged"
        : "no-duplicate";
    groups.push({
      members: members.map((member) => member.candidate),
      disposition,
      mergeEvidence,
    });
  }
  return groups;
};

// ------------------------------------------------ RI-S59/S62 综合置信度（纯函数）

export interface CompositeConfidenceInputV1 {
  readonly memberModelConfidence: readonly number[];
  readonly memberChecks: readonly (readonly CandidateValidationCheckV1[])[];
  readonly simulationConstraintDeclared: boolean;
  readonly simulationConstraintSatisfied: boolean;
  readonly memberCount: number;
  readonly distinctSourceVersionCount: number;
  readonly disposition: "merged" | "no-duplicate";
  readonly policy: CompositeConfidencePolicyV1;
}

export type CompositeConfidenceOutcomeV1 =
  | { readonly kind: "computed"; readonly confidence: GroupCompositeConfidenceV1 }
  | { readonly kind: "blocked"; readonly reasonCode: string };

/**
 * 综合置信度（design D-07）：只组合四类声明依据，权重、缺项语义与舍入全部来自精确策略版本。
 * 检索 RRF 排序分数不进入该公式，模型置信度也不被当作综合置信度。
 */
export const calculateCompositeConfidence = (
  input: CompositeConfidenceInputV1,
): CompositeConfidenceOutcomeV1 => {
  const policy = assertCompositeConfidenceWeights(input.policy);
  const checkTotal = input.memberChecks.reduce((total, checks) => total + checks.length, 0);
  const checkPassed = input.memberChecks.reduce(
    (total, checks) => total + checks.filter((entry) => entry.passed).length,
    0,
  );
  const multiSourceAvailable = input.disposition === "merged" && input.memberCount > 1;
  const raw: readonly {
    readonly source: CompositeConfidenceBasisV1["source"];
    readonly available: boolean;
    readonly value: number;
    readonly weight: number;
  }[] = [
    {
      source: "model-confidence",
      available: input.memberModelConfidence.length > 0,
      value:
        input.memberModelConfidence.length === 0
          ? 0
          : input.memberModelConfidence.reduce((total, value) => total + value, 0) /
            input.memberModelConfidence.length,
      weight: policy.weights.modelConfidence,
    },
    {
      source: "rule-consistency",
      available: checkTotal > 0,
      value: checkTotal === 0 ? 0 : checkPassed / checkTotal,
      weight: policy.weights.ruleConsistency,
    },
    {
      source: "simulation-constraint",
      available: input.simulationConstraintDeclared,
      value: input.simulationConstraintSatisfied ? 1 : 0,
      weight: policy.weights.simulationConstraint,
    },
    {
      source: "multi-source-merge",
      available: multiSourceAvailable,
      value: multiSourceAvailable ? unit(input.distinctSourceVersionCount / input.memberCount) : 0,
      weight: policy.weights.multiSourceMerge,
    },
  ];

  const requiredUnavailable = raw.find(
    (basis) => policy.requiredBasis.includes(basis.source) && !basis.available,
  );
  if (requiredUnavailable !== undefined) {
    return {
      kind: "blocked",
      reasonCode: `required-basis-unavailable:${requiredUnavailable.source}`,
    };
  }
  const unavailable = raw.find((basis) => !basis.available);
  if (unavailable !== undefined && policy.missingBasisBehavior === "block") {
    return { kind: "blocked", reasonCode: `basis-unavailable:${unavailable.source}` };
  }
  const present = raw.filter((basis) => basis.available);
  const totalWeight = present.reduce((total, basis) => total + basis.weight, 0);
  if (present.length === 0 || totalWeight <= 0) {
    return { kind: "blocked", reasonCode: "no-basis-available" };
  }
  const value = roundTo(
    present.reduce((total, basis) => total + basis.weight * basis.value, 0) / totalWeight,
    policy.roundingDecimals,
  );
  return {
    kind: "computed",
    confidence: {
      value: unit(value),
      basis: raw.map((basis) => ({
        source: basis.source,
        available: basis.available,
        value: unit(basis.value),
        weight: basis.weight,
        contribution: basis.available
          ? roundTo(basis.weight / totalWeight, policy.roundingDecimals)
          : 0,
      })),
      policyRef: policy.policyRef,
      missingBasisBehavior: policy.missingBasisBehavior,
      roundingDecimals: policy.roundingDecimals,
    },
  };
};

/** 强制复核判定（design D-07）：阈值与强制条件全部来自精确策略版本。 */
export const forcedReviewReasonFor = (input: {
  readonly confidence: GroupCompositeConfidenceV1;
  readonly mergeEvidence: GroupMergeEvidenceV1;
  readonly disposition: "merged" | "no-duplicate";
  readonly policy: {
    readonly autoAcceptanceThreshold: number;
    readonly forcedReviewReasonCodes: readonly string[];
  };
}): string | undefined => {
  if (input.confidence.value < input.policy.autoAcceptanceThreshold) {
    return FORCED_REVIEW_REASON_CODES_V1.lowConfidence;
  }
  const ambiguous =
    input.disposition === "merged" &&
    (!input.mergeEvidence.riskEvent.satisfied || !input.mergeEvidence.evidence.satisfied);
  if (
    ambiguous &&
    (input.policy.forcedReviewReasonCodes.length === 0 ||
      input.policy.forcedReviewReasonCodes.includes(FORCED_REVIEW_REASON_CODES_V1.mergeAmbiguity))
  ) {
    return FORCED_REVIEW_REASON_CODES_V1.mergeAmbiguity;
  }
  if (input.policy.forcedReviewReasonCodes.includes(FORCED_REVIEW_REASON_CODES_V1.policyFlag)) {
    return FORCED_REVIEW_REASON_CODES_V1.policyFlag;
  }
  return undefined;
};

// ------------------------------------------------- RI-S61～S64 决定语义（纯函数）

export type DecisionDispositionV1 = "continue" | "reroute" | "blocked";

/** 决定语义唯一映射：只有继续入库的决定可以进入标准化风险记录。 */
export const decisionDispositionFor = (kind: string): DecisionDispositionV1 => {
  switch (kind) {
    case "accept-unchanged":
    case "approve-unchanged":
    case "confirm-merge":
      return "continue";
    case "approve-revised-candidate":
    case "keep-separate":
      return "reroute";
    default:
      return "blocked";
  }
};

// --------------------------------------------------------------- 内部请求形状

interface ArtifactPersistRequestV1 {
  readonly row: RiskCandidateFinalizationResultRowV1;
  readonly artifactId: string;
  readonly purposeCode: string;
  readonly value: unknown;
}

type PersistOutcomeV1 =
  | { readonly kind: "succeeded"; readonly eventRefs: readonly { readonly eventId: string }[] }
  | { readonly kind: "replayed" }
  | { readonly kind: "idempotency-conflict"; readonly priorCommandId: string }
  | { readonly kind: "failed"; readonly error: unknown };

interface CandidateSetBuildInputV1 {
  readonly projectId: string;
  readonly workItemRef: RiskCandidateSetV1["workItemRef"];
  readonly modelContextArtifactSetRef: RiskCandidateSetV1["modelContextArtifactSetRef"];
  readonly modelDeploymentRef: VersionReference;
  readonly promptTemplateRef: VersionReference;
  readonly modelContext: ModelContextPayloadV1;
  readonly generationPolicy: RiskCandidateGenerationPolicyV1;
  readonly candidates: readonly RiskCandidateV1[];
  readonly acceptedCandidates: readonly RiskCandidateV1[];
  readonly candidateArtifactRefs: ReadonlyMap<string, VersionReference>;
  readonly round: number;
  readonly parentCandidateSetRef: VersionReference | undefined;
  readonly rawResponseRefs: readonly VersionReference[];
  readonly usage: RiskCandidateSetV1["usage"];
  readonly scopeDigest: string;
  readonly authorizationContextRef: AuthorizationContextV1["authorizationContextRef"];
  readonly generatedAt: string;
}

interface CandidateSetBuildResultV1 {
  readonly value: RiskCandidateSetV1;
  readonly digest: string;
  readonly candidateArtifactRefs: ReadonlyMap<string, VersionReference>;
  readonly candidateSetEntityId: string;
}

// ---------------------------------------------------------------------- 服务

/**
 * C22 深模块：RI-S57～RI-S65 的候选生成、确定性校验、全运行合并、综合置信度、验收路由与
 * 标准化记录入库只经显式端口与既有公共分支完成，不建立第二套任务、记录或事件。
 */
export class RiskCandidateFinalizationService {
  readonly #options: RiskCandidateFinalizationServiceOptionsV1;
  readonly #now: () => Date;

  constructor(options: RiskCandidateFinalizationServiceOptionsV1) {
    const required: readonly (keyof RiskCandidateFinalizationServiceOptionsV1)[] = [
      "modelContextReader",
      "workPlanReader",
      "policyProvider",
      "reviewDecisionReader",
      "authorization",
      "resultStore",
      "recordStore",
      "model",
      "artifactStore",
      "transactionUnit",
      "review",
    ];
    for (const key of required) {
      if (options[key] === undefined) {
        throw new TypeError(`risk candidate finalization requires dependency ${key}`);
      }
    }
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
  }

  async analyze(command: IdentificationAnalysisCommandV1): Promise<IdentificationAnalysisResultV1> {
    const parsed = IdentificationAnalysisCommandV1Schema.safeParse(command);
    if (!parsed.success) {
      return IdentificationAnalysisResultV1Schema.parse({
        kind: "failed",
        error: unsupportedContract("identification-analysis-command", this.#now().toISOString()),
      });
    }
    try {
      const result =
        parsed.data.kind === "assemble-and-infer"
          ? await this.#assembleAndInfer(parsed.data)
          : await this.#repairAndValidate(parsed.data);
      return IdentificationAnalysisResultV1Schema.parse({ kind: "succeeded", result });
    } catch (error: unknown) {
      if (error instanceof RiskCandidateFinalizationError) {
        return IdentificationAnalysisResultV1Schema.parse({ kind: "failed", error: error.details });
      }
      throw error;
    }
  }

  async finalize(
    command: IdentificationFinalizationCommandV1,
  ): Promise<IdentificationFinalizationResultV1> {
    const parsed = IdentificationFinalizationCommandV1Schema.safeParse(command);
    if (!parsed.success) {
      return IdentificationFinalizationResultV1Schema.parse({
        kind: "failed",
        error: unsupportedContract(
          "identification-finalization-command",
          this.#now().toISOString(),
        ),
      });
    }
    try {
      const result =
        parsed.data.kind === "merge-run-candidates"
          ? await this.#mergeRunCandidates(parsed.data)
          : parsed.data.kind === "route-acceptance"
            ? await this.#routeAcceptance(parsed.data)
            : await this.#acceptGroups(parsed.data);
      return IdentificationFinalizationResultV1Schema.parse({ kind: "succeeded", result });
    } catch (error: unknown) {
      if (error instanceof RiskCandidateFinalizationError) {
        return IdentificationFinalizationResultV1Schema.parse({
          kind: "failed",
          error: error.details,
        });
      }
      throw error;
    }
  }

  // ------------------------------------------------------------- 授权与持久化

  async #requireCurrent(input: {
    readonly authorization: AuthorizationContextV1;
    readonly branch: ModuleBranchV1;
    readonly causalRunId: string;
    readonly policyRef: VersionReference;
    readonly capability: ModuleCapabilityV1;
  }): Promise<AuthorizationContextV1> {
    const verified = await this.#options.authorization.verifyCurrent({
      authorization: input.authorization,
      invocationId: input.causalRunId,
      branch: input.branch,
      requestedSpatialScopeRefs: [...input.authorization.spatialScopeRefs],
      requestedSourceVersionRefs: [],
    });
    if (verified === undefined) {
      throw new RiskCandidateFinalizationError(
        authorizationDenied({
          causalRunId: input.causalRunId,
          occurredAt: this.#now().toISOString(),
          capability: input.capability,
          policyRef: input.policyRef,
        }),
      );
    }
    return verified;
  }

  async #putArtifact(input: {
    readonly artifactId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly purposeCode: string;
    readonly authorization: AuthorizationContextV1;
    readonly value: unknown;
    readonly commandId: string;
  }): Promise<VersionReference> {
    const requiredCapability = input.authorization.grantedCapabilities[0];
    if (requiredCapability === undefined) {
      throw new RiskCandidateFinalizationError(
        authorizationDenied({
          causalRunId: input.artifactId,
          occurredAt: this.#now().toISOString(),
          capability: "risk-identification.read",
          policyRef: input.authorization.authorizationPolicyRef,
        }),
      );
    }
    const result = await this.#options.artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: "1",
        commandId: input.commandId,
        idempotencyKey: input.commandId,
        projectId: input.projectId,
        actorId: input.actorId,
        issuedAt: input.issuedAt,
        authorization: input.authorization,
        requiredCapability,
        artifactId: input.artifactId,
        artifactKind: "content",
        purposeCode: input.purposeCode,
        mediaType: "application/json",
        parentArtifactRefs: [],
        evidenceReferences: [],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      }),
      (async function* () {
        yield new TextEncoder().encode(JSON.stringify(input.value));
      })(),
    );
    return result.artifactRef.reference;
  }

  async #readArtifactJson(input: {
    readonly artifactRef: VersionReference;
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly purposeCode: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<unknown> {
    const readId = `${STAGE_PREFIX}-read-${randomUUID()}`;
    const requiredCapability = input.authorization.grantedCapabilities[0];
    if (requiredCapability === undefined) {
      throw new RiskCandidateFinalizationError(
        authorizationDenied({
          causalRunId: input.artifactRef.entityId,
          occurredAt: this.#now().toISOString(),
          capability: "risk-identification.read",
          policyRef: input.authorization.authorizationPolicyRef,
        }),
      );
    }
    const handle = await this.#options.artifactStore.open({
      schemaVersion: "1",
      requestId: readId,
      idempotencyKey: readId,
      artifactRef: { kind: CONTENT_REF_KIND, reference: input.artifactRef },
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      purposeCode: input.purposeCode,
      requiredCapability,
      authorization: input.authorization,
    });
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of handle.content) {
      size += chunk.byteLength;
      if (size > MAX_ARTIFACT_BYTES_V1) throw new RangeError("artifact exceeds the bounded read");
      chunks.push(chunk);
    }
    await handle.verified;
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
  }

  async #readRegistered<T>(input: {
    readonly row: RiskCandidateFinalizationResultRowV1;
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly purposeCode: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<T> {
    const value = await this.#readArtifactJson({
      artifactRef: input.row.artifactRef.reference,
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      purposeCode: input.purposeCode,
      authorization: input.authorization,
    });
    return value as T;
  }

  /**
   * 正文先入 C04，再以单个 C03 事务登记全部引用行、命令回执、一条事实审计与调用方给定事件；
   * 任一步失败整体回滚，不返回可消费引用，也不留下半份登记。
   */
  async #persistRows(input: {
    readonly requests: readonly ArtifactPersistRequestV1[];
    readonly occurredAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly actorId: string;
    readonly commandKind: string;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly resultRef: ContractReferenceV1;
    readonly events?: (input: {
      readonly auditEntryId: string;
      readonly auditVersionId: string;
      readonly recordedAt: string;
    }) => readonly DomainEventV1[];
  }): Promise<PersistOutcomeV1> {
    const resolved: RiskCandidateFinalizationResultRowV1[] = [];
    for (const request of input.requests) {
      const reference = await this.#putArtifact({
        artifactId: request.artifactId,
        projectId: request.row.projectId,
        actorId: input.actorId,
        issuedAt: input.occurredAt,
        purposeCode: request.purposeCode,
        authorization: input.authorization,
        value: request.value,
        commandId: `${request.artifactId}:put`,
      });
      resolved.push(
        RiskCandidateFinalizationResultRowV1Schema.parse({
          ...request.row,
          artifactRef: { kind: CONTENT_REF_KIND, reference },
        }),
      );
    }
    const primary = resolved[0];
    if (primary === undefined) throw new TypeError("at least one result row is required");
    const command: AtomicCommandV1 = AtomicCommandV1Schema.parse({
      projectId: primary.projectId,
      commandKind: input.commandKind,
      commandId: input.commandId,
      idempotencyKey: input.idempotencyKey,
      payload: {
        results: resolved.map((row) => ({
          resultKind: row.resultKind,
          resultId: row.resultId,
          resultVersionId: row.resultVersionId,
          requestDigest: row.requestDigest,
        })),
      },
      actorRef: primary.actorRef,
      authorizationContextRef: input.authorization.authorizationContextRef,
      issuedAt: input.occurredAt,
    });
    const auditEntryId = `${input.commandId}:audit`;
    let aborted = false;
    try {
      const receipt = await this.#options.transactionUnit.execute(
        command,
        async (context: TransactionContextV1): Promise<AtomicCommitV1> => {
          const registration = await this.#options.resultStore.registerResults(
            { rows: resolved, occurredAt: input.occurredAt },
            context,
          );
          if (registration.kind === "idempotency-conflict") {
            aborted = true;
            throw new FinalizationTransactionAbort();
          }
          const recordedAt = this.#now().toISOString();
          return {
            resultRef: input.resultRef,
            audit: {
              auditEntryId,
              projectId: primary.projectId,
              action: input.commandKind,
              targetRef: input.resultRef,
              actorRef: primary.actorRef,
              authorizationContextRef: input.authorization.authorizationContextRef,
              occurredAt: input.occurredAt,
              recordedAt,
              version: { entityId: primary.resultId, versionId: primary.resultVersionId },
              commandId: input.commandId,
              idempotencyKey: input.idempotencyKey,
            },
            events: [
              ...(input.events?.({
                auditEntryId,
                auditVersionId: primary.resultVersionId,
                recordedAt,
              }) ?? []),
            ],
          };
        },
      );
      if (receipt.replayed) return { kind: "replayed" };
      return {
        kind: "succeeded",
        eventRefs: receipt.eventRefs.map((ref) => ({ eventId: ref.eventId })),
      };
    } catch (error: unknown) {
      if (aborted) return { kind: "idempotency-conflict", priorCommandId: input.commandId };
      return { kind: "failed", error };
    }
  }

  #rowBase(input: {
    readonly resultKind: RiskCandidateFinalizationResultRowV1["resultKind"];
    readonly commandId: string;
    readonly projectId: string;
    readonly resultId: string;
    readonly resultVersionId: string;
    readonly requestDigest: string;
    readonly inputSnapshotRef: {
      readonly kind: "identification-input-snapshot";
      readonly reference: VersionReference;
    };
    readonly authorizationScopeDigest: string;
    readonly actorId: string;
    readonly authorizationContextRef: AuthorizationContextV1["authorizationContextRef"];
  }): Record<string, unknown> {
    return {
      schemaVersion: RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
      commandId: input.commandId,
      resultKind: input.resultKind,
      projectId: input.projectId,
      resultId: input.resultId,
      resultVersionId: input.resultVersionId,
      requestDigest: input.requestDigest,
      // `#persistRows` 在登记前以 C04 返回的内容引用覆盖此值；先保持严格 Schema 可解析，
      // 让所有成功路径都能到达实际工件写入，而不是被空字符串占位提前截断。
      artifactRef: {
        kind: CONTENT_REF_KIND,
        reference: { entityId: input.resultId, versionId: input.resultVersionId },
      },
      inputSnapshotRef: input.inputSnapshotRef,
      authorizationScopeDigest: input.authorizationScopeDigest,
      actorRef: input.actorId,
      authorizationContextRef: input.authorizationContextRef,
    };
  }

  #readRow(input: {
    readonly projectId: string;
    readonly resultKind: RiskCandidateFinalizationResultRowV1["resultKind"];
    readonly resultId: string;
    readonly resultVersionId: string;
  }): Promise<RiskCandidateFinalizationResultRowV1 | undefined> {
    return this.#options.resultStore.readResult(input);
  }

  #artifactID(kind: string, reference: VersionReference): string {
    return `${STAGE_PREFIX}:${kind}:${reference.entityId}:${reference.versionId}`;
  }

  // ----------------------------------------------- RI-S57～S58 候选生成与登记

  #buildCandidates(input: {
    readonly candidateSetEntityId: string;
    readonly projectId: string;
    readonly workItemRef: RiskCandidateSetV1["workItemRef"];
    readonly modelContextArtifactSetRef: VersionReference;
    readonly retrievalArtifactSetRef: VersionReference;
    readonly nodeId: string;
    readonly inputSnapshotRef: RiskCandidateSetV1["inputSnapshotRef"];
    readonly outputs: readonly ModelOutputResult[];
    readonly round: number;
    readonly parentCandidates?: readonly {
      readonly candidateId: string;
      readonly candidateVersion: number;
      readonly candidateRef: VersionReference;
    }[];
    readonly modelDeploymentRef: VersionReference;
    readonly promptTemplateRef: VersionReference;
    readonly generationPolicy: RiskCandidateGenerationPolicyV1;
    readonly rawResponseRef: VersionReference;
    readonly invocationId: string;
    readonly generatedAt: string;
  }): readonly RiskCandidateV1[] {
    return input.outputs.map((output, index) => {
      const parent = input.parentCandidates?.[index];
      return {
        candidateId:
          parent?.candidateId ??
          `${input.candidateSetEntityId}:candidate:${String(index + 1).padStart(3, "0")}`,
        candidateVersion: parent === undefined ? input.round : parent.candidateVersion + 1,
        ...(parent === undefined
          ? {}
          : {
              parentCandidateRef: {
                kind: CONTENT_REF_KIND as "content-artifact",
                reference: parent.candidateRef,
              },
            }),
        projectId: input.projectId,
        inputSnapshotRef: input.inputSnapshotRef,
        workItemRef: input.workItemRef,
        modelContextArtifactSetRef: {
          kind: "model-context-artifact-set" as const,
          reference: input.modelContextArtifactSetRef,
        },
        retrievalArtifactSetRef: input.retrievalArtifactSetRef,
        nodeId: input.nodeId,
        output,
        modelDeploymentRef: input.modelDeploymentRef,
        promptTemplateRef: input.promptTemplateRef,
        outputSchemaRef: input.generationPolicy.outputSchemaRef,
        budgetPolicyRef: input.generationPolicy.budgetPolicyRef,
        rawResponseRef: { kind: "diagnostic-artifact" as const, reference: input.rawResponseRef },
        invocationId: input.invocationId,
        generatedAt: input.generatedAt,
      };
    });
  }

  /** 每个候选单独落一份 C04 正文，使校验条目能引用候选自身的精确内容地址。 */
  async #persistCandidates(input: {
    readonly candidates: readonly RiskCandidateV1[];
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly commandId: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<ReadonlyMap<string, VersionReference>> {
    const refs = new Map<string, VersionReference>();
    for (const candidate of input.candidates) {
      const artifactId = `${STAGE_PREFIX}:candidate:${candidate.candidateId}:v${candidate.candidateVersion}`;
      const reference = await this.#putArtifact({
        artifactId,
        projectId: input.projectId,
        actorId: input.actorId,
        issuedAt: input.issuedAt,
        purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.candidateSet,
        authorization: input.authorization,
        value: candidate,
        commandId: `${input.commandId}:${artifactId}`,
      });
      refs.set(
        candidateEvaluationKey(candidate.candidateId, candidate.candidateVersion),
        reference,
      );
    }
    return refs;
  }

  #assembleCandidateSet(input: CandidateSetBuildInputV1): CandidateSetBuildResultV1 {
    const candidates = [...input.acceptedCandidates, ...input.candidates];
    const digest = sha256CanonicalJson({
      projectId: input.projectId,
      workItemRef: input.workItemRef.reference,
      modelContextArtifactSetRef: input.modelContextArtifactSetRef.reference,
      retrievalArtifactSetRef: input.modelContext.retrievalArtifactSetRef.reference,
      generationPolicyRef: input.generationPolicy.policyRef,
      modelDeploymentRef: input.modelDeploymentRef,
      promptTemplateRef: input.promptTemplateRef,
      outputSchemaRef: input.generationPolicy.outputSchemaRef,
      budgetPolicyRef: input.generationPolicy.budgetPolicyRef,
      round: input.round,
      parent: input.parentCandidateSetRef ?? null,
      authorizationScopeDigest: input.scopeDigest,
      candidates: candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        candidateVersion: candidate.candidateVersion,
        output: candidate.output,
      })),
    });
    const candidateSetEntityId = candidateSetEntityIdFor({
      projectId: input.projectId,
      workItemEntityId: input.workItemRef.reference.entityId,
    });
    return {
      value: {
        schemaVersion: RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
        projectId: input.projectId,
        inputSnapshotRef: input.modelContext.inputSnapshotRef,
        workItemRef: input.workItemRef,
        nodeId: input.modelContext.nodeId,
        modelContextArtifactSetRef: input.modelContextArtifactSetRef,
        retrievalArtifactSetRef: {
          kind: "retrieval-artifact-set",
          reference: input.modelContext.retrievalArtifactSetRef.reference,
        },
        modelContextPayloadDigest: sha256CanonicalJson(input.modelContext),
        policySetRef: input.modelContext.policySetRef,
        generationPolicyRef: input.generationPolicy.policyRef,
        modelDeploymentRef: input.modelDeploymentRef,
        promptTemplateRef: input.promptTemplateRef,
        outputSchemaRef: input.generationPolicy.outputSchemaRef,
        budgetPolicyRef: input.generationPolicy.budgetPolicyRef,
        candidateSetVersion: input.round,
        ...(input.parentCandidateSetRef === undefined
          ? {}
          : {
              parentCandidateSetRef: {
                kind: CONTENT_REF_KIND as "content-artifact",
                reference: input.parentCandidateSetRef,
              },
            }),
        candidates,
        rawResponseRefs: input.rawResponseRefs.map((reference) => ({
          kind: "diagnostic-artifact" as const,
          reference,
        })),
        usage: input.usage,
        authorizationScopeDigest: input.scopeDigest,
        authorizationContextRef: input.authorizationContextRef,
        generatedAt: input.generatedAt,
      },
      digest,
      candidateArtifactRefs: input.candidateArtifactRefs,
      candidateSetEntityId,
    };
  }

  async #assembleAndInfer(
    command: Extract<IdentificationAnalysisCommandV1, { readonly kind: "assemble-and-infer" }>,
  ): Promise<Extract<IdentificationAnalysisSuccessV1, { readonly kind: "assemble-and-infer" }>> {
    const options = this.#options;
    const occurredAt = this.#now().toISOString();
    const current = await this.#requireCurrent({
      authorization: command.authorization,
      branch: "risk-identification.assemble-and-infer",
      causalRunId: command.commandId,
      policyRef: command.authorization.authorizationPolicyRef,
      capability: "risk-identification.run",
    });
    const scopeDigest = authorizationScopeDigest(current);
    const modelContextRead = await options.modelContextReader.readExact({
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: occurredAt,
      workItemRef: command.payload.workItemRef,
      retrievalArtifactSetRef: command.payload.retrievalArtifactSetRef,
      authorization: current,
    });
    if (modelContextRead.kind === "failed") {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt,
          blockerKind: modelContextRead.detailCode,
          blockerRef: command.payload.workItemRef,
        }),
      );
    }
    const modelContext = modelContextRead.read.payload;
    if (
      !sameRef(modelContext.inputSnapshotRef.reference, command.payload.workItemRef.reference) &&
      modelContextResultIdFor({
        projectId: command.projectId,
        workItemEntityId: command.payload.workItemRef.reference.entityId,
        retrievalArtifactSetEntityId: command.payload.retrievalArtifactSetRef.reference.entityId,
      }) === undefined
    ) {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt,
          blockerKind: "model-context-reference-invalid",
          blockerRef: command.payload.retrievalArtifactSetRef,
        }),
      );
    }
    const generationPolicy = await options.policyProvider.resolveGeneration({
      projectId: command.projectId,
      inputSnapshotRef: modelContext.inputSnapshotRef,
      policySetRef: modelContext.policySetRef,
      modelDeploymentRef: command.payload.modelDeploymentRef,
      promptTemplateRef: command.payload.promptTemplateRef,
    });
    if (generationPolicy === undefined) {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt,
          blockerKind: "generation-policy-missing",
          blockerRef: command.payload.workItemRef,
        }),
      );
    }
    const deadlineAt = new Date(
      Date.parse(occurredAt) + generationPolicy.budget.maxWallClockMs,
    ).toISOString();
    const modelOutcome = await options.model.generateCandidates({
      projectId: command.projectId,
      actorId: command.actorId,
      invocationId: `${command.commandId}:generate`,
      requestedAt: occurredAt,
      deadlineAt,
      modelContext,
      modelDeploymentRef: command.payload.modelDeploymentRef,
      promptTemplateRef: command.payload.promptTemplateRef,
      outputSchemaRef: generationPolicy.outputSchemaRef,
      budgetPolicyRef: generationPolicy.budgetPolicyRef,
      budget: generationPolicy.budget,
      maxOutputTokens: generationPolicy.budget.maxTotalTokens,
      authorization: current,
    });
    if (modelOutcome.kind === "failed") {
      throw new RiskCandidateFinalizationError(modelOutcome.error);
    }
    const initialUsage: RiskCandidateSetV1["usage"] = {
      modelInvocations: 1,
      inputTokens: modelOutcome.usage.inputTokens,
      outputTokens: modelOutcome.usage.outputTokens,
      totalTokens: modelOutcome.usage.totalTokens,
      outputBytes: modelOutcome.usage.outputBytes,
      elapsedMs: modelOutcome.elapsedMs,
      repairRounds: 0,
    };
    if (
      generationBudgetExceeded({
        candidateCount: modelOutcome.outputs.length,
        usage: initialUsage,
        policy: generationPolicy,
      })
    ) {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt: this.#now().toISOString(),
          blockerKind: CANDIDATE_VALIDATION_REASON_CODES_V1.budgetExhausted,
          blockerRef: command.payload.workItemRef,
        }),
      );
    }
    const generatedAt = this.#now().toISOString();
    const candidateSetEntityId = candidateSetEntityIdFor({
      projectId: command.projectId,
      workItemEntityId: command.payload.workItemRef.reference.entityId,
    });
    const candidates = this.#buildCandidates({
      candidateSetEntityId,
      projectId: command.projectId,
      workItemRef: command.payload.workItemRef,
      modelContextArtifactSetRef: modelContextRead.read.modelContextArtifactSetRef.reference,
      retrievalArtifactSetRef: command.payload.retrievalArtifactSetRef.reference,
      nodeId: modelContext.nodeId,
      inputSnapshotRef: modelContext.inputSnapshotRef,
      outputs: modelOutcome.outputs,
      round: 1,
      modelDeploymentRef: command.payload.modelDeploymentRef,
      promptTemplateRef: command.payload.promptTemplateRef,
      generationPolicy,
      rawResponseRef: modelOutcome.rawResponseRef.reference,
      invocationId: modelOutcome.invocationId,
      generatedAt,
    });
    const candidateArtifactRefs = await this.#persistCandidates({
      candidates,
      projectId: command.projectId,
      actorId: command.actorId,
      issuedAt: occurredAt,
      commandId: command.commandId,
      authorization: current,
    });
    const assembled = this.#assembleCandidateSet({
      projectId: command.projectId,
      workItemRef: command.payload.workItemRef,
      modelContextArtifactSetRef: modelContextRead.read.modelContextArtifactSetRef,
      modelDeploymentRef: command.payload.modelDeploymentRef,
      promptTemplateRef: command.payload.promptTemplateRef,
      modelContext,
      generationPolicy,
      round: 1,
      parentCandidateSetRef: undefined,
      rawResponseRefs: [modelOutcome.rawResponseRef.reference],
      usage: initialUsage,
      candidates,
      acceptedCandidates: [],
      candidateArtifactRefs,
      scopeDigest,
      authorizationContextRef: current.authorizationContextRef,
      generatedAt,
    });
    const candidateSetRef = candidateSetRefFor({
      projectId: command.projectId,
      workItemEntityId: command.payload.workItemRef.reference.entityId,
      requestDigest: assembled.digest,
    });
    const persisted = await this.#persistRows({
      requests: [
        {
          row: RiskCandidateFinalizationResultRowV1Schema.parse({
            ...this.#rowBase({
              resultKind: "candidate-set",
              commandId: `${command.commandId}:candidate-set`,
              projectId: command.projectId,
              resultId: candidateSetRef.reference.entityId,
              resultVersionId: candidateSetRef.reference.versionId,
              requestDigest: assembled.digest,
              inputSnapshotRef: modelContext.inputSnapshotRef,
              authorizationScopeDigest: scopeDigest,
              actorId: command.actorId,
              authorizationContextRef: current.authorizationContextRef,
            }),
            workItemRef: command.payload.workItemRef,
            modelContextArtifactSetRef: modelContextRead.read.modelContextArtifactSetRef,
            candidateSetRef,
          }),
          artifactId: this.#artifactID("candidate-set", candidateSetRef.reference),
          purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.candidateSet,
          value: assembled.value,
        },
      ],
      occurredAt: generatedAt,
      authorization: current,
      actorId: command.actorId,
      commandKind: "identification.candidate-set.register",
      commandId: `${command.commandId}:candidate-set`,
      idempotencyKey: `${command.commandId}:candidate-set`,
      resultRef: { kind: "identification-candidate-set", reference: candidateSetRef.reference },
    });
    if (persisted.kind === "idempotency-conflict") {
      throw new RiskCandidateFinalizationError(
        idempotencyConflict({
          causalRunId: command.commandId,
          occurredAt: generatedAt,
          idempotencyKey: command.idempotencyKey,
          priorCommandId: persisted.priorCommandId,
        }),
      );
    }
    if (persisted.kind === "failed") {
      throw new RiskCandidateFinalizationError(
        terminalFailure({
          causalRunId: command.commandId,
          occurredAt: generatedAt,
          stage: "candidate-set-register",
        }),
      );
    }
    return {
      kind: "assemble-and-infer",
      modelContextArtifactSetRef: modelContextRead.read.modelContextArtifactSetRef,
      candidateSetRef,
    };
  }

  // ------------------------------------------- RI-S58～S59 有界修正与校验登记

  async #repairAndValidate(
    command: Extract<IdentificationAnalysisCommandV1, { readonly kind: "repair-and-validate" }>,
  ): Promise<Extract<IdentificationAnalysisSuccessV1, { readonly kind: "repair-and-validate" }>> {
    const options = this.#options;
    const occurredAt = this.#now().toISOString();
    const current = await this.#requireCurrent({
      authorization: command.authorization,
      branch: "risk-identification.repair-and-validate",
      causalRunId: command.commandId,
      policyRef: command.authorization.authorizationPolicyRef,
      capability: "risk-identification.run",
    });
    const scopeDigest = authorizationScopeDigest(current);
    const row = await this.#readRow({
      projectId: command.projectId,
      resultKind: "candidate-set",
      resultId: command.payload.candidateSetRef.reference.entityId,
      resultVersionId: command.payload.candidateSetRef.reference.versionId,
    });
    if (row === undefined || row.resultKind !== "candidate-set") {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt,
          blockerKind: "candidate-set-not-found",
          blockerRef: command.payload.candidateSetRef,
        }),
      );
    }
    const initialSet = await this.#readRegistered<RiskCandidateSetV1>({
      row,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: occurredAt,
      purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.candidateSet,
      authorization: current,
    });
    const modelContextRead = await options.modelContextReader.readExact({
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: occurredAt,
      workItemRef: row.workItemRef,
      retrievalArtifactSetRef: { reference: initialSet.retrievalArtifactSetRef.reference },
      authorization: current,
    });
    if (modelContextRead.kind === "failed") {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt,
          blockerKind: modelContextRead.detailCode,
          blockerRef: row.workItemRef,
        }),
      );
    }
    const modelContext = modelContextRead.read.payload;
    if (!sameRef(modelContext.inputSnapshotRef.reference, initialSet.inputSnapshotRef.reference)) {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt,
          blockerKind: "model-context-drift",
          blockerRef: row.workItemRef,
        }),
      );
    }
    const validationPolicy = await options.policyProvider.resolveValidation({
      projectId: command.projectId,
      inputSnapshotRef: initialSet.inputSnapshotRef,
      policySetRef: initialSet.policySetRef,
      repairPolicyRef: command.payload.repairPolicyRef,
    });
    if (validationPolicy === undefined) {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt,
          blockerKind: "validation-policy-missing",
          blockerRef: row.workItemRef,
        }),
      );
    }
    assertRepairableReasonCodes(validationPolicy);
    const generationPolicy = await options.policyProvider.resolveGeneration({
      projectId: command.projectId,
      inputSnapshotRef: initialSet.inputSnapshotRef,
      policySetRef: initialSet.policySetRef,
      modelDeploymentRef: initialSet.modelDeploymentRef,
      promptTemplateRef: initialSet.promptTemplateRef,
    });
    if (generationPolicy === undefined) {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt,
          blockerKind: "generation-policy-missing",
          blockerRef: row.workItemRef,
        }),
      );
    }

    let candidateSet = initialSet;
    let candidateSetRef = command.payload.candidateSetRef;
    let candidateArtifactRefs = await this.#persistCandidates({
      candidates: candidateSet.candidates,
      projectId: command.projectId,
      actorId: command.actorId,
      issuedAt: occurredAt,
      commandId: command.commandId,
      authorization: current,
    });
    let rawResponseRefs = candidateSet.rawResponseRefs.map((ref) => ref.reference);
    let usage = { ...candidateSet.usage };
    let evaluation = evaluateCandidateSet({
      candidateSet,
      candidateArtifactRefs,
      modelContext,
      policy: validationPolicy,
    });

    while (evaluation.disposition !== "accepted") {
      const repairable = evaluation.entries.filter((entry) => entry.disposition === "repairable");
      const terminal = evaluation.entries.find((entry) => entry.disposition === "terminal");
      if (terminal !== undefined) {
        const firstFailure = terminal.checks.find((entry) => !entry.passed);
        throw new RiskCandidateFinalizationError(
          blocked({
            causalRunId: command.commandId,
            occurredAt: this.#now().toISOString(),
            blockerKind:
              firstFailure?.reasonCode ?? CANDIDATE_VALIDATION_REASON_CODES_V1.schemaInvalid,
            blockerRef: terminal.candidateRef,
          }),
        );
      }
      const exhausted =
        usage.repairRounds >= generationPolicy.budget.maxRepairRounds ||
        usage.totalTokens >= generationPolicy.budget.maxTotalTokens ||
        usage.outputBytes >= generationPolicy.budget.maxOutputBytes ||
        usage.elapsedMs >= generationPolicy.budget.maxWallClockMs;
      const firstFailure = evaluation.entries
        .flatMap((entry) => entry.checks)
        .find((entry) => !entry.passed);
      if (repairable.length === 0 || exhausted) {
        throw new RiskCandidateFinalizationError(
          blocked({
            causalRunId: command.commandId,
            occurredAt: this.#now().toISOString(),
            blockerKind: exhausted
              ? CANDIDATE_VALIDATION_REASON_CODES_V1.budgetExhausted
              : (firstFailure?.reasonCode ?? CANDIDATE_VALIDATION_REASON_CODES_V1.schemaInvalid),
            blockerRef: asContentRef(candidateSetRef.reference),
          }),
        );
      }
      // 设计 D-05：每轮修正前复验当前授权，撤权立即终止，不通过循环尝试绕过。
      const revalidated = await this.#requireCurrent({
        authorization: command.authorization,
        branch: "risk-identification.repair-and-validate",
        causalRunId: command.commandId,
        policyRef: command.authorization.authorizationPolicyRef,
        capability: "risk-identification.run",
      });
      const failures: RiskCandidateRepairFeedbackV1["failures"] = repairable.flatMap((entry) =>
        entry.checks
          .filter((checkEntry) => !checkEntry.passed)
          .map((checkEntry) => ({
            candidateId: entry.candidateId,
            candidateVersion: entry.candidateVersion,
            checkId: checkEntry.checkId,
            reasonCode: checkEntry.reasonCode,
          })),
      );
      const accepted = candidateSet.candidates.filter((candidate) =>
        evaluation.entries.some(
          (entry) =>
            entry.disposition === "accepted" &&
            entry.candidateId === candidate.candidateId &&
            entry.candidateVersion === candidate.candidateVersion,
        ),
      );
      const repairParents = repairable.map((entry) => {
        const candidate = candidateSet.candidates.find(
          (value) =>
            value.candidateId === entry.candidateId &&
            value.candidateVersion === entry.candidateVersion,
        );
        const candidateRef = candidateArtifactRefs.get(
          candidateEvaluationKey(entry.candidateId, entry.candidateVersion),
        );
        if (candidate === undefined || candidateRef === undefined) {
          throw new TypeError("repairable candidate and artifact reference are required");
        }
        return {
          candidateId: candidate.candidateId,
          candidateVersion: candidate.candidateVersion,
          candidateRef,
        };
      });
      const round = usage.repairRounds + 1;
      const repairRequestedAt = this.#now().toISOString();
      const modelOutcome = await options.model.generateCandidates({
        projectId: command.projectId,
        actorId: command.actorId,
        invocationId: `${command.commandId}:repair:${round}`,
        requestedAt: repairRequestedAt,
        deadlineAt: new Date(
          Date.parse(repairRequestedAt) +
            Math.max(1, generationPolicy.budget.maxWallClockMs - usage.elapsedMs),
        ).toISOString(),
        modelContext,
        modelDeploymentRef: candidateSet.modelDeploymentRef,
        promptTemplateRef: candidateSet.promptTemplateRef,
        outputSchemaRef: candidateSet.outputSchemaRef,
        budgetPolicyRef: candidateSet.budgetPolicyRef,
        budget: generationPolicy.budget,
        maxOutputTokens: Math.max(1, generationPolicy.budget.maxTotalTokens - usage.totalTokens),
        authorization: revalidated,
        repair: {
          attempt: round,
          parentCandidates: candidateSet.candidates,
          failures,
          previousRawResponseRefs: rawResponseRefs.map((reference) => ({
            kind: "diagnostic-artifact" as const,
            reference,
          })),
        },
      });
      if (modelOutcome.kind === "failed") {
        throw new RiskCandidateFinalizationError(modelOutcome.error);
      }
      if (modelOutcome.outputs.length !== repairParents.length) {
        throw new RiskCandidateFinalizationError(
          terminalFailure({
            causalRunId: command.commandId,
            occurredAt: this.#now().toISOString(),
            stage: "repair-output-arity",
          }),
        );
      }
      usage = {
        modelInvocations: usage.modelInvocations + 1,
        inputTokens: usage.inputTokens + modelOutcome.usage.inputTokens,
        outputTokens: usage.outputTokens + modelOutcome.usage.outputTokens,
        totalTokens: usage.totalTokens + modelOutcome.usage.totalTokens,
        outputBytes: usage.outputBytes + modelOutcome.usage.outputBytes,
        elapsedMs: usage.elapsedMs + modelOutcome.elapsedMs,
        repairRounds: round,
      };
      if (
        generationBudgetExceeded({
          candidateCount: accepted.length + modelOutcome.outputs.length,
          usage,
          policy: generationPolicy,
        })
      ) {
        throw new RiskCandidateFinalizationError(
          blocked({
            causalRunId: command.commandId,
            occurredAt: this.#now().toISOString(),
            blockerKind: CANDIDATE_VALIDATION_REASON_CODES_V1.budgetExhausted,
            blockerRef: asContentRef(candidateSetRef.reference),
          }),
        );
      }
      rawResponseRefs = [...rawResponseRefs, modelOutcome.rawResponseRef.reference];
      const generatedAt = this.#now().toISOString();
      const repairedCandidates = this.#buildCandidates({
        candidateSetEntityId: candidateSetRef.reference.entityId,
        projectId: command.projectId,
        workItemRef: row.workItemRef,
        modelContextArtifactSetRef: candidateSet.modelContextArtifactSetRef.reference,
        retrievalArtifactSetRef: candidateSet.retrievalArtifactSetRef.reference,
        nodeId: candidateSet.nodeId,
        inputSnapshotRef: candidateSet.inputSnapshotRef,
        outputs: modelOutcome.outputs,
        round: round + 1,
        parentCandidates: repairParents,
        modelDeploymentRef: candidateSet.modelDeploymentRef,
        promptTemplateRef: candidateSet.promptTemplateRef,
        generationPolicy,
        rawResponseRef: modelOutcome.rawResponseRef.reference,
        invocationId: modelOutcome.invocationId,
        generatedAt,
      });
      const roundRefs = new Map(candidateArtifactRefs);
      for (const [key, reference] of await this.#persistCandidates({
        candidates: repairedCandidates,
        projectId: command.projectId,
        actorId: command.actorId,
        issuedAt: generatedAt,
        commandId: `${command.commandId}:repair:${round}`,
        authorization: revalidated,
      })) {
        roundRefs.set(key, reference);
      }
      candidateArtifactRefs = roundRefs;
      const assembled = this.#assembleCandidateSet({
        projectId: command.projectId,
        workItemRef: row.workItemRef,
        modelContextArtifactSetRef: candidateSet.modelContextArtifactSetRef,
        modelDeploymentRef: candidateSet.modelDeploymentRef,
        promptTemplateRef: candidateSet.promptTemplateRef,
        modelContext,
        generationPolicy,
        candidates: repairedCandidates,
        acceptedCandidates: accepted,
        candidateArtifactRefs,
        round: round + 1,
        parentCandidateSetRef: candidateSetRef.reference,
        rawResponseRefs,
        usage,
        scopeDigest,
        authorizationContextRef: revalidated.authorizationContextRef,
        generatedAt,
      });
      candidateSet = assembled.value;
      candidateSetRef = candidateSetRefFor({
        projectId: command.projectId,
        workItemEntityId: row.workItemRef.reference.entityId,
        requestDigest: assembled.digest,
      });
      const persistedRound = await this.#persistRows({
        requests: [
          {
            row: RiskCandidateFinalizationResultRowV1Schema.parse({
              ...this.#rowBase({
                resultKind: "candidate-set",
                commandId: `${command.commandId}:candidate-set:${round}`,
                projectId: command.projectId,
                resultId: candidateSetRef.reference.entityId,
                resultVersionId: candidateSetRef.reference.versionId,
                requestDigest: assembled.digest,
                inputSnapshotRef: candidateSet.inputSnapshotRef,
                authorizationScopeDigest: scopeDigest,
                actorId: command.actorId,
                authorizationContextRef: revalidated.authorizationContextRef,
              }),
              workItemRef: row.workItemRef,
              modelContextArtifactSetRef: candidateSet.modelContextArtifactSetRef,
              candidateSetRef,
            }),
            artifactId: this.#artifactID("candidate-set", candidateSetRef.reference),
            purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.candidateSet,
            value: candidateSet,
          },
        ],
        occurredAt: generatedAt,
        authorization: revalidated,
        actorId: command.actorId,
        commandKind: "identification.candidate-set.register",
        commandId: `${command.commandId}:candidate-set:${round}`,
        idempotencyKey: `${command.commandId}:candidate-set:${round}`,
        resultRef: {
          kind: "identification-candidate-set",
          reference: candidateSetRef.reference,
        },
      });
      if (persistedRound.kind !== "succeeded" && persistedRound.kind !== "replayed") {
        throw new RiskCandidateFinalizationError(
          terminalFailure({
            causalRunId: command.commandId,
            occurredAt: generatedAt,
            stage: "candidate-set-register",
          }),
        );
      }
      evaluation = evaluateCandidateSet({
        candidateSet,
        candidateArtifactRefs,
        modelContext,
        policy: validationPolicy,
      });
    }

    const completedAt = this.#now().toISOString();
    const validationDigest = sha256CanonicalJson({
      candidateSetRef: candidateSetRef.reference,
      validationPolicyRef: validationPolicy.policyRef,
      ruleValidationPolicyRef: validationPolicy.ruleValidationPolicyRef,
      simulationConstraintPolicyRef: validationPolicy.simulationConstraint?.policyRef ?? null,
      entries: evaluation.entries.map((entry) => ({
        candidateId: entry.candidateId,
        candidateVersion: entry.candidateVersion,
        candidateRef: entry.candidateRef.reference,
        checks: entry.checks.map((checkEntry) => ({
          checkId: checkEntry.checkId,
          passed: checkEntry.passed,
          reasonCode: checkEntry.reasonCode,
        })),
      })),
    });
    const validatedCandidateSetRef = validatedCandidateSetRefFor({
      projectId: command.projectId,
      candidateSetEntityId: candidateSetRef.reference.entityId,
      requestDigest: validationDigest,
    });
    const validationSet: CandidateValidationSetV1 = {
      schemaVersion: RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
      projectId: command.projectId,
      inputSnapshotRef: candidateSet.inputSnapshotRef,
      workItemRef: row.workItemRef,
      nodeId: candidateSet.nodeId,
      candidateSetRef: { kind: CONTENT_REF_KIND, reference: candidateSetRef.reference },
      candidateSetVersion: candidateSet.candidateSetVersion,
      policySetRef: candidateSet.policySetRef,
      validationPolicyRef: validationPolicy.policyRef,
      ruleValidationPolicyRef: validationPolicy.ruleValidationPolicyRef,
      ...(validationPolicy.simulationConstraint === undefined
        ? {}
        : { simulationConstraintPolicyRef: validationPolicy.simulationConstraint.policyRef }),
      entries: [...evaluation.entries],
      acceptedCandidateRefs: evaluation.entries.map((entry) => entry.candidateRef),
      usage,
      authorizationScopeDigest: scopeDigest,
      authorizationContextRef: current.authorizationContextRef,
      completedAt,
    };
    const persisted = await this.#persistRows({
      requests: [
        {
          row: RiskCandidateFinalizationResultRowV1Schema.parse({
            ...this.#rowBase({
              resultKind: "validated-candidate-set",
              commandId: `${command.commandId}:validated-candidate-set`,
              projectId: command.projectId,
              resultId: validatedCandidateSetRef.reference.entityId,
              resultVersionId: validatedCandidateSetRef.reference.versionId,
              requestDigest: validationDigest,
              inputSnapshotRef: candidateSet.inputSnapshotRef,
              authorizationScopeDigest: scopeDigest,
              actorId: command.actorId,
              authorizationContextRef: current.authorizationContextRef,
            }),
            workItemRef: row.workItemRef,
            candidateSetRef,
            validatedCandidateSetRef,
          }),
          artifactId: this.#artifactID(
            "validated-candidate-set",
            validatedCandidateSetRef.reference,
          ),
          purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.validationSet,
          value: validationSet,
        },
      ],
      occurredAt: completedAt,
      authorization: current,
      actorId: command.actorId,
      commandKind: "identification.validated-candidate-set.register",
      commandId: `${command.commandId}:validated-candidate-set`,
      idempotencyKey: `${command.commandId}:validated-candidate-set`,
      resultRef: {
        kind: "validated-candidate-set",
        reference: validatedCandidateSetRef.reference,
      },
    });
    if (persisted.kind === "idempotency-conflict") {
      throw new RiskCandidateFinalizationError(
        idempotencyConflict({
          causalRunId: command.commandId,
          occurredAt: completedAt,
          idempotencyKey: command.idempotencyKey,
          priorCommandId: persisted.priorCommandId,
        }),
      );
    }
    if (persisted.kind === "failed") {
      throw new RiskCandidateFinalizationError(
        terminalFailure({
          causalRunId: command.commandId,
          occurredAt: completedAt,
          stage: "validated-candidate-set-register",
        }),
      );
    }
    return { kind: "repair-and-validate", validatedCandidateSetRef };
  }

  // -------------------------------------- RI-S61～S62 全运行合并与合并计划登记

  /**
   * 由正式已校验候选集解析合并成员：候选的证据集合与机理条目来自其所属工作项的冻结五项
   * 上下文，不读取任何模块私表，也不使用 latest 或字符串门禁。
   */
  async #resolveMergeMembers(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly validatedRows: readonly Extract<
      RiskCandidateFinalizationResultRowV1,
      { readonly resultKind: "validated-candidate-set" }
    >[];
  }): Promise<
    | {
        readonly kind: "resolved";
        readonly candidates: readonly MergeCandidateInputV1[];
        readonly contextOfCandidate: ReadonlyMap<string, ModelContextPayloadV1>;
        readonly validationOfCandidate: ReadonlyMap<string, readonly CandidateValidationCheckV1[]>;
      }
    | {
        readonly kind: "blocked";
        readonly detailCode: string;
        readonly blockerRef: ContractReferenceV1;
      }
  > {
    const options = this.#options;
    const candidates: MergeCandidateInputV1[] = [];
    const contextOfCandidate = new Map<string, ModelContextPayloadV1>();
    const validationOfCandidate = new Map<string, readonly CandidateValidationCheckV1[]>();
    for (const row of input.validatedRows) {
      const validationSet = await this.#readRegistered<CandidateValidationSetV1>({
        row,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.validationSet,
        authorization: input.authorization,
      });
      const candidateRow = await this.#readRow({
        projectId: input.projectId,
        resultKind: "candidate-set",
        resultId: validationSet.candidateSetRef.reference.entityId,
        resultVersionId: validationSet.candidateSetRef.reference.versionId,
      });
      if (candidateRow === undefined || candidateRow.resultKind !== "candidate-set") {
        return {
          kind: "blocked",
          detailCode: "candidate-set-missing",
          blockerRef: validationSet.candidateSetRef,
        };
      }
      const candidateSet = await this.#readRegistered<RiskCandidateSetV1>({
        row: candidateRow,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.candidateSet,
        authorization: input.authorization,
      });
      const modelContextRead = await options.modelContextReader.readExact({
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        workItemRef: candidateRow.workItemRef,
        retrievalArtifactSetRef: { reference: candidateSet.retrievalArtifactSetRef.reference },
        authorization: input.authorization,
      });
      if (modelContextRead.kind === "failed") {
        return {
          kind: "blocked",
          detailCode: modelContextRead.detailCode,
          blockerRef: candidateRow.workItemRef,
        };
      }
      const modelContext = modelContextRead.read.payload;
      const visible = buildVisibleEvidenceIndex(modelContext);
      for (const entry of validationSet.entries) {
        const reference = entry.candidateRef.reference;
        const candidate = candidateSet.candidates.find(
          (value) =>
            value.candidateId === entry.candidateId &&
            value.candidateVersion === entry.candidateVersion,
        );
        if (candidate === undefined) {
          return {
            kind: "blocked",
            detailCode: "candidate-version-missing",
            blockerRef: asContentRef(reference),
          };
        }
        const locator = candidate.output.evidenceLocator.sourceSegmentId;
        const matchedMechanismIds = new Set(
          visible.entries
            .filter((evidence) => evidence.sourceSegmentId === locator)
            .map((evidence) => evidence.mechanismEntryId)
            .filter((value): value is string => value !== undefined),
        );
        // 资料段集合 = 覆盖该定位的全部机理条目自身的证据集合，避免退化为单元素集合。
        const mechanismEvidence = visible.entries.filter(
          (evidence) =>
            evidence.mechanismEntryId !== undefined &&
            matchedMechanismIds.has(evidence.mechanismEntryId),
        );
        const key = referenceKey(reference);
        contextOfCandidate.set(key, modelContext);
        validationOfCandidate.set(key, entry.checks);
        candidates.push({
          candidateRef: reference,
          candidateId: candidate.candidateId,
          candidateVersion: candidate.candidateVersion,
          nodeId: candidate.nodeId,
          riskEvent: candidate.output.riskEvent,
          modelConfidence: candidate.output.modelConfidence,
          sourceSegmentIds: [
            ...new Set(mechanismEvidence.map((evidence) => evidence.sourceSegmentId)),
          ].sort(),
          mechanismEntryIds: [...matchedMechanismIds].sort(),
          sourceVersionKeys: [
            ...new Set(
              mechanismEvidence.map(
                (evidence) =>
                  `${evidence.sourceVersion.entityId}\u0000${evidence.sourceVersion.versionId}`,
              ),
            ),
          ].sort(),
        });
      }
    }
    return { kind: "resolved", candidates, contextOfCandidate, validationOfCandidate };
  }

  async #mergeRunCandidates(
    command: Extract<
      IdentificationFinalizationCommandV1,
      { readonly kind: "merge-run-candidates" }
    >,
  ): Promise<Extract<IdentificationFinalizationSuccessV1, { readonly kind: "merge" }>> {
    const options = this.#options;
    const occurredAt = this.#now().toISOString();
    const current = await this.#requireCurrent({
      authorization: command.authorization,
      branch: "risk-identification.merge-run-candidates",
      causalRunId: command.commandId,
      policyRef: command.authorization.authorizationPolicyRef,
      capability: "risk-identification.finalize",
    });
    const scopeDigest = authorizationScopeDigest(current);
    const workPlan = await options.workPlanReader.readExact({
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: occurredAt,
      workPlanRef: command.payload.workPlanRef,
      authorization: current,
    });
    if (workPlan.kind === "failed") {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt,
          blockerKind: workPlan.detailCode,
          blockerRef: command.payload.workPlanRef,
        }),
      );
    }
    const expected = [...workPlan.read.validatedCandidateSetRefs]
      .map((ref) => referenceKey(ref.reference))
      .sort();
    const provided = [...command.payload.validatedCandidateSetRefs]
      .map((ref) => referenceKey(ref.reference))
      .sort();
    if (
      expected.length !== provided.length ||
      expected.some((value, index) => value !== provided[index])
    ) {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt,
          blockerKind: "merge-input-incomplete",
          blockerRef: command.payload.workPlanRef,
        }),
      );
    }
    const mergePolicy = await options.policyProvider.resolveMerge({
      projectId: command.projectId,
      inputSnapshotRef: workPlan.read.inputSnapshotRef,
      policySetRef: workPlan.read.inputSnapshot.identificationPolicySetRef,
      mergePolicyRef: command.payload.mergePolicyRef,
    });
    if (mergePolicy === undefined) {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt,
          blockerKind: "merge-policy-missing",
          blockerRef: command.payload.workPlanRef,
        }),
      );
    }
    assertMergePolicyWeights(mergePolicy);
    const validatedRows: Extract<
      RiskCandidateFinalizationResultRowV1,
      { readonly resultKind: "validated-candidate-set" }
    >[] = [];
    for (const ref of command.payload.validatedCandidateSetRefs) {
      const row = await this.#readRow({
        projectId: command.projectId,
        resultKind: "validated-candidate-set",
        resultId: ref.reference.entityId,
        resultVersionId: ref.reference.versionId,
      });
      if (row === undefined || row.resultKind !== "validated-candidate-set") {
        throw new RiskCandidateFinalizationError(
          blocked({
            causalRunId: command.commandId,
            occurredAt,
            blockerKind: "validated-candidate-set-not-found",
            blockerRef: ref,
          }),
        );
      }
      validatedRows.push(row);
    }
    const resolved = await this.#resolveMergeMembers({
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: occurredAt,
      authorization: current,
      validatedRows,
    });
    if (resolved.kind === "blocked") {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt,
          blockerKind: resolved.detailCode,
          blockerRef: resolved.blockerRef,
        }),
      );
    }
    const embedding = await options.model.embedRiskEvents({
      projectId: command.projectId,
      actorId: command.actorId,
      invocationId: `${command.commandId}:embed`,
      requestedAt: occurredAt,
      deadlineAt: new Date(Date.parse(occurredAt) + 60_000).toISOString(),
      projectWorkPlanEntityId: command.payload.workPlanRef.reference.entityId,
      embeddingDeploymentRef: mergePolicy.embeddingDeploymentRef,
      budgetPolicyRef: mergePolicy.embeddingBudgetPolicyRef,
      texts: resolved.candidates.map((candidate) => candidate.riskEvent),
      authorization: current,
    });
    if (embedding.kind === "failed") {
      throw new RiskCandidateFinalizationError(embedding.error);
    }
    if (embedding.vectors.length !== resolved.candidates.length) {
      throw new RiskCandidateFinalizationError(
        terminalFailure({
          causalRunId: command.commandId,
          occurredAt,
          stage: "embedding-arity",
        }),
      );
    }
    const drafts = buildMergeGroups({
      candidates: resolved.candidates,
      vectors: embedding.vectors,
      policy: mergePolicy,
    });
    const identificationRunRef = identificationRunRefFor({
      projectId: command.projectId,
      workPlanEntityId: command.payload.workPlanRef.reference.entityId,
    });
    const groupRequests: ArtifactPersistRequestV1[] = [];
    const groupEntries: MergePlanV1["groups"] = [];
    let memberTotal = 0;
    for (const draft of drafts) {
      const groupId = sha256CanonicalJson({
        workPlanRef: command.payload.workPlanRef.reference,
        members: draft.members.map((member) => referenceKey(member.candidateRef)),
      });
      const groupVersionId = sha256CanonicalJson({
        groupId,
        mergePolicyRef: mergePolicy.policyRef,
        embeddingDeploymentRef: mergePolicy.embeddingDeploymentRef,
        disposition: draft.disposition,
        mergeEvidence: draft.mergeEvidence,
        members: draft.members.map((member) => referenceKey(member.candidateRef)),
      });
      const groupRef = identificationGroupRefFor({
        projectId: command.projectId,
        workPlanEntityId: command.payload.workPlanRef.reference.entityId,
        groupId,
        requestDigest: groupVersionId,
      });
      const members: IdentificationGroupMemberV1[] = draft.members.map((member) => ({
        candidateId: member.candidateId,
        candidateVersion: member.candidateVersion,
        candidateRef: { kind: "content-artifact", reference: member.candidateRef },
        nodeId: member.nodeId,
        sourceSegmentIds:
          member.sourceSegmentIds.length === 0
            ? [member.candidateId]
            : [...member.sourceSegmentIds],
        mechanismEntryIds:
          member.mechanismEntryIds.length === 0
            ? [member.candidateId]
            : [...member.mechanismEntryIds],
        modelConfidence: member.modelConfidence,
      }));
      const group: IdentificationGroupV1 = {
        schemaVersion: RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
        projectId: command.projectId,
        workPlanRef: command.payload.workPlanRef,
        inputSnapshotRef: workPlan.read.inputSnapshotRef,
        policySetRef: workPlan.read.inputSnapshot.identificationPolicySetRef,
        groupId,
        groupVersionId,
        nodeIds: [...new Set(members.map((member) => member.nodeId))].sort(),
        members,
        mergeEvidence: draft.mergeEvidence,
        disposition: draft.disposition,
        ...(draft.disposition === "no-duplicate"
          ? { skipReasonCode: MERGE_SKIP_REASON_CODE_V1 }
          : {}),
        mergePolicyRef: mergePolicy.policyRef,
        embeddingDeploymentRef: mergePolicy.embeddingDeploymentRef,
        embeddingArtifactRef: {
          kind: CONTENT_REF_KIND,
          reference: embedding.embeddingArtifactRef.reference,
        },
        authorizationScopeDigest: scopeDigest,
        authorizationContextRef: current.authorizationContextRef,
        groupedAt: occurredAt,
      };
      memberTotal += draft.members.length;
      groupEntries.push({
        groupId,
        groupVersionId,
        groupRef,
        disposition: draft.disposition,
        memberCount: draft.members.length,
      });
      groupRequests.push({
        row: RiskCandidateFinalizationResultRowV1Schema.parse({
          ...this.#rowBase({
            resultKind: "identification-group",
            commandId: `${command.commandId}:merge-plan`,
            projectId: command.projectId,
            resultId: groupRef.reference.entityId,
            resultVersionId: groupRef.reference.versionId,
            requestDigest: groupVersionId,
            inputSnapshotRef: workPlan.read.inputSnapshotRef,
            authorizationScopeDigest: scopeDigest,
            actorId: command.actorId,
            authorizationContextRef: current.authorizationContextRef,
          }),
          workPlanRef: command.payload.workPlanRef,
          groupRef,
        }),
        artifactId: this.#artifactID("identification-group", groupRef.reference),
        purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.group,
        value: group,
      });
    }
    const evaluatedCandidateRefs = resolved.candidates.map((candidate) => ({
      kind: "content-artifact" as const,
      reference: candidate.candidateRef,
    }));
    const mergePlanDigest = sha256CanonicalJson({
      workPlanRef: command.payload.workPlanRef.reference,
      validatedCandidateSetRefs: command.payload.validatedCandidateSetRefs.map(
        (ref) => ref.reference,
      ),
      mergePolicyRef: mergePolicy.policyRef,
      embeddingDeploymentRef: mergePolicy.embeddingDeploymentRef,
      groupEntries: groupEntries.map((entry) => ({
        groupId: entry.groupId,
        groupVersionId: entry.groupVersionId,
        disposition: entry.disposition,
        memberCount: entry.memberCount,
      })),
    });
    const mergePlanRef = mergePlanRefFor({
      projectId: command.projectId,
      workPlanEntityId: command.payload.workPlanRef.reference.entityId,
      requestDigest: mergePlanDigest,
    });
    const mergePlan: MergePlanV1 = {
      schemaVersion: RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
      projectId: command.projectId,
      workPlanRef: command.payload.workPlanRef,
      identificationRunRef,
      inputSnapshotRef: workPlan.read.inputSnapshotRef,
      policySetRef: workPlan.read.inputSnapshot.identificationPolicySetRef,
      validatedCandidateSetRefs: [...command.payload.validatedCandidateSetRefs],
      mergePolicyRef: mergePolicy.policyRef,
      embeddingDeploymentRef: mergePolicy.embeddingDeploymentRef,
      embeddingArtifactRef: {
        kind: CONTENT_REF_KIND,
        reference: embedding.embeddingArtifactRef.reference,
      },
      groups: groupEntries,
      evaluatedCandidateRefs,
      authorizationScopeDigest: scopeDigest,
      authorizationContextRef: current.authorizationContextRef,
      plannedAt: occurredAt,
    };
    if (memberTotal !== evaluatedCandidateRefs.length) {
      throw new RiskCandidateFinalizationError(
        terminalFailure({
          causalRunId: command.commandId,
          occurredAt,
          stage: "merge-coverage",
        }),
      );
    }
    const persisted = await this.#persistRows({
      requests: [
        ...groupRequests,
        {
          row: RiskCandidateFinalizationResultRowV1Schema.parse({
            ...this.#rowBase({
              resultKind: "merge-plan",
              commandId: `${command.commandId}:merge-plan`,
              projectId: command.projectId,
              resultId: mergePlanRef.reference.entityId,
              resultVersionId: mergePlanRef.reference.versionId,
              requestDigest: mergePlanDigest,
              inputSnapshotRef: workPlan.read.inputSnapshotRef,
              authorizationScopeDigest: scopeDigest,
              actorId: command.actorId,
              authorizationContextRef: current.authorizationContextRef,
            }),
            workPlanRef: command.payload.workPlanRef,
            mergePlanRef,
          }),
          artifactId: this.#artifactID("merge-plan", mergePlanRef.reference),
          purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.mergePlan,
          value: mergePlan,
        },
      ],
      occurredAt,
      authorization: current,
      actorId: command.actorId,
      commandKind: "identification.merge-plan.register",
      commandId: `${command.commandId}:merge-plan`,
      idempotencyKey: `${command.commandId}:merge-plan`,
      resultRef: { kind: "merge-plan", reference: mergePlanRef.reference },
    });
    if (persisted.kind === "idempotency-conflict") {
      throw new RiskCandidateFinalizationError(
        idempotencyConflict({
          causalRunId: command.commandId,
          occurredAt,
          idempotencyKey: command.idempotencyKey,
          priorCommandId: persisted.priorCommandId,
        }),
      );
    }
    if (persisted.kind === "failed") {
      throw new RiskCandidateFinalizationError(
        terminalFailure({
          causalRunId: command.commandId,
          occurredAt,
          stage: "merge-plan-register",
        }),
      );
    }
    return { kind: "merge", mergePlanRef };
  }

  // ------------------------------- RI-S61～S63 综合置信度、验收路由与复核请求

  async #readValidationChecks(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly validatedCandidateSetRefs: readonly { readonly reference: VersionReference }[];
  }): Promise<
    | {
        readonly kind: "resolved";
        readonly checks: ReadonlyMap<string, readonly CandidateValidationCheckV1[]>;
        readonly sets: readonly CandidateValidationSetV1[];
      }
    | {
        readonly kind: "blocked";
        readonly detailCode: string;
        readonly blockerRef: ContractReferenceV1;
      }
  > {
    const checks = new Map<string, readonly CandidateValidationCheckV1[]>();
    const sets: CandidateValidationSetV1[] = [];
    for (const ref of input.validatedCandidateSetRefs) {
      const row = await this.#readRow({
        projectId: input.projectId,
        resultKind: "validated-candidate-set",
        resultId: ref.reference.entityId,
        resultVersionId: ref.reference.versionId,
      });
      if (row === undefined || row.resultKind !== "validated-candidate-set") {
        return {
          kind: "blocked",
          detailCode: "validated-candidate-set-not-found",
          blockerRef: { kind: "validated-candidate-set", reference: ref.reference },
        };
      }
      const set = await this.#readRegistered<CandidateValidationSetV1>({
        row,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.validationSet,
        authorization: input.authorization,
      });
      sets.push(set);
      for (const entry of set.entries) {
        checks.set(candidateEvaluationKey(entry.candidateId, entry.candidateVersion), entry.checks);
      }
    }
    return { kind: "resolved", checks, sets };
  }

  async #routeAcceptance(
    command: Extract<IdentificationFinalizationCommandV1, { readonly kind: "route-acceptance" }>,
  ): Promise<Extract<IdentificationFinalizationSuccessV1, { readonly kind: "route" }>> {
    const options = this.#options;
    const occurredAt = this.#now().toISOString();
    const current = await this.#requireCurrent({
      authorization: command.authorization,
      branch: "risk-identification.route-acceptance",
      causalRunId: command.commandId,
      policyRef: command.authorization.authorizationPolicyRef,
      capability: "risk-identification.finalize",
    });
    const scopeDigest = authorizationScopeDigest(current);
    const mergeRow = await this.#readRow({
      projectId: command.projectId,
      resultKind: "merge-plan",
      resultId: command.payload.mergePlanRef.reference.entityId,
      resultVersionId: command.payload.mergePlanRef.reference.versionId,
    });
    if (mergeRow === undefined || mergeRow.resultKind !== "merge-plan") {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt,
          blockerKind: "merge-plan-not-found",
          blockerRef: command.payload.mergePlanRef,
        }),
      );
    }
    const mergePlan = await this.#readRegistered<MergePlanV1>({
      row: mergeRow,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: occurredAt,
      purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.mergePlan,
      authorization: current,
    });
    const confidencePolicy = await options.policyProvider.resolveConfidence({
      projectId: command.projectId,
      inputSnapshotRef: mergePlan.inputSnapshotRef,
      policySetRef: mergePlan.policySetRef,
      confidencePolicyRef: command.payload.confidencePolicyRef,
    });
    const forcedReviewPolicy = await options.policyProvider.resolveForcedReview({
      projectId: command.projectId,
      inputSnapshotRef: mergePlan.inputSnapshotRef,
      policySetRef: mergePlan.policySetRef,
      forcedReviewPolicyRef: command.payload.forcedReviewPolicyRef,
    });
    if (confidencePolicy === undefined || forcedReviewPolicy === undefined) {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt,
          blockerKind: "routing-policy-missing",
          blockerRef: mergePlan.workPlanRef,
        }),
      );
    }
    const validationRead = await this.#readValidationChecks({
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: occurredAt,
      authorization: current,
      validatedCandidateSetRefs: mergePlan.validatedCandidateSetRefs,
    });
    if (validationRead.kind === "blocked") {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt,
          blockerKind: validationRead.detailCode,
          blockerRef: validationRead.blockerRef,
        }),
      );
    }
    const simulationDeclared = validationRead.sets.some(
      (set) => set.simulationConstraintPolicyRef !== undefined,
    );
    const routeRequests: ArtifactPersistRequestV1[] = [];
    const routes: AcceptanceRouteV1[] = [];
    const reviewTaskRefs: ReviewTaskRefV1[] = [];
    for (const entry of mergePlan.groups) {
      const groupRow = await this.#readRow({
        projectId: command.projectId,
        resultKind: "identification-group",
        resultId: entry.groupRef.reference.entityId,
        resultVersionId: entry.groupRef.reference.versionId,
      });
      if (groupRow === undefined || groupRow.resultKind !== "identification-group") {
        throw new RiskCandidateFinalizationError(
          blocked({
            causalRunId: command.commandId,
            occurredAt,
            blockerKind: "identification-group-not-found",
            blockerRef: entry.groupRef,
          }),
        );
      }
      const group = await this.#readRegistered<IdentificationGroupV1>({
        row: groupRow,
        projectId: command.projectId,
        actorId: command.actorId,
        requestedAt: occurredAt,
        purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.group,
        authorization: current,
      });
      const memberChecks = group.members.map(
        (member) =>
          validationRead.checks.get(
            candidateEvaluationKey(member.candidateId, member.candidateVersion),
          ) ?? [],
      );
      const distinctSourceSegments = new Set(
        group.members.flatMap((member) => member.sourceSegmentIds),
      ).size;
      const confidenceOutcome = calculateCompositeConfidence({
        memberModelConfidence: group.members.map((member) => member.modelConfidence),
        memberChecks,
        simulationConstraintDeclared: simulationDeclared,
        simulationConstraintSatisfied: simulationDeclared,
        memberCount: group.members.length,
        distinctSourceVersionCount: distinctSourceSegments,
        disposition: group.disposition,
        policy: confidencePolicy,
      });
      if (confidenceOutcome.kind === "blocked") {
        throw new RiskCandidateFinalizationError(
          blocked({
            causalRunId: command.commandId,
            occurredAt,
            blockerKind: confidenceOutcome.reasonCode,
            blockerRef: entry.groupRef,
          }),
        );
      }
      const forcedReason = forcedReviewReasonFor({
        confidence: confidenceOutcome.confidence,
        mergeEvidence: group.mergeEvidence,
        disposition: group.disposition,
        policy: forcedReviewPolicy,
      });
      if (forcedReason === undefined) {
        const routeDecisionRef = routeDecisionRefFor({
          projectId: command.projectId,
          mergePlanEntityId: command.payload.mergePlanRef.reference.entityId,
          groupId: entry.groupId,
          requestDigest: sha256CanonicalJson({
            groupVersionId: entry.groupVersionId,
            confidence: confidenceOutcome.confidence.value,
            forcedReviewPolicyRef: forcedReviewPolicy.policyRef,
          }),
        });
        const decision: AutomaticAcceptanceDecisionV1 = {
          schemaVersion: RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
          projectId: command.projectId,
          workPlanRef: mergePlan.workPlanRef,
          inputSnapshotRef: mergePlan.inputSnapshotRef,
          mergePlanRef: command.payload.mergePlanRef,
          groupId: entry.groupId,
          groupVersionId: entry.groupVersionId,
          groupRef: entry.groupRef,
          routeDecisionRef,
          decision: "accept-unchanged",
          compositeConfidence: confidenceOutcome.confidence,
          confidencePolicyRef: confidencePolicy.policyRef,
          forcedReviewPolicyRef: forcedReviewPolicy.policyRef,
          decidedAt: occurredAt,
        };
        routeRequests.push({
          row: RiskCandidateFinalizationResultRowV1Schema.parse({
            ...this.#rowBase({
              resultKind: "route-decision",
              commandId: `${command.commandId}:acceptance-route-set`,
              projectId: command.projectId,
              resultId: routeDecisionRef.reference.entityId,
              resultVersionId: routeDecisionRef.reference.versionId,
              requestDigest: routeDecisionRef.reference.versionId,
              inputSnapshotRef: mergePlan.inputSnapshotRef,
              authorizationScopeDigest: scopeDigest,
              actorId: command.actorId,
              authorizationContextRef: current.authorizationContextRef,
            }),
            workPlanRef: mergePlan.workPlanRef,
            groupRef: entry.groupRef,
            routeDecisionRef,
          }),
          artifactId: this.#artifactID("route-decision", routeDecisionRef.reference),
          purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.routeDecision,
          value: decision,
        });
        routes.push({
          routeKind: "automatic",
          groupId: entry.groupId,
          groupVersionId: entry.groupVersionId,
          groupRef: entry.groupRef,
          compositeConfidence: confidenceOutcome.confidence,
          routeDecisionRef,
        });
        continue;
      }

      const validationSnapshotRef = validationSnapshotRefFor({
        projectId: command.projectId,
        groupEntityId: entry.groupRef.reference.entityId,
        requestDigest: entry.groupVersionId,
      });
      const evidenceSnapshotRef = evidenceSnapshotRefFor({
        projectId: command.projectId,
        groupEntityId: entry.groupRef.reference.entityId,
        requestDigest: entry.groupVersionId,
      });
      const validationSnapshot: IdentificationSnapshotV1 = {
        schemaVersion: RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
        projectId: command.projectId,
        inputSnapshotRef: mergePlan.inputSnapshotRef,
        workPlanRef: mergePlan.workPlanRef,
        mergePlanRef: command.payload.mergePlanRef,
        policySetRef: mergePlan.policySetRef,
        groupId: entry.groupId,
        groupVersionId: entry.groupVersionId,
        groupRef: entry.groupRef,
        snapshotKind: "validation",
        entries: group.members.flatMap((member): IdentificationSnapshotEntryV1[] =>
          (
            validationRead.checks.get(
              candidateEvaluationKey(member.candidateId, member.candidateVersion),
            ) ?? []
          ).map((checkEntry) => ({
            entryKind: "validation",
            checkId: checkEntry.checkId,
            passed: checkEntry.passed,
            reasonCode: checkEntry.reasonCode,
          })),
        ),
        authorizationScopeDigest: scopeDigest,
        authorizationContextRef: current.authorizationContextRef,
        createdAt: occurredAt,
      };
      const evidenceSnapshot: IdentificationSnapshotV1 = {
        schemaVersion: RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
        projectId: command.projectId,
        inputSnapshotRef: mergePlan.inputSnapshotRef,
        workPlanRef: mergePlan.workPlanRef,
        mergePlanRef: command.payload.mergePlanRef,
        policySetRef: mergePlan.policySetRef,
        groupId: entry.groupId,
        groupVersionId: entry.groupVersionId,
        groupRef: entry.groupRef,
        snapshotKind: "evidence",
        entries: group.members.flatMap((member): IdentificationSnapshotEntryV1[] =>
          member.sourceSegmentIds.map((sourceSegmentId) => ({
            entryKind: "evidence",
            candidateId: member.candidateId,
            candidateVersion: member.candidateVersion,
            candidateRef: member.candidateRef,
            sourceSegmentId,
          })),
        ),
        authorizationScopeDigest: scopeDigest,
        authorizationContextRef: current.authorizationContextRef,
        createdAt: occurredAt,
      };
      if (validationSnapshot.entries.length === 0 || evidenceSnapshot.entries.length === 0) {
        throw new RiskCandidateFinalizationError(
          blocked({
            causalRunId: command.commandId,
            occurredAt,
            blockerKind: "snapshot-incomplete",
            blockerRef: entry.groupRef,
          }),
        );
      }
      routeRequests.push(
        {
          row: RiskCandidateFinalizationResultRowV1Schema.parse({
            ...this.#rowBase({
              resultKind: "validation-snapshot",
              commandId: `${command.commandId}:snapshot:${entry.groupVersionId}`,
              projectId: command.projectId,
              resultId: validationSnapshotRef.reference.entityId,
              resultVersionId: validationSnapshotRef.reference.versionId,
              requestDigest: entry.groupVersionId,
              inputSnapshotRef: mergePlan.inputSnapshotRef,
              authorizationScopeDigest: scopeDigest,
              actorId: command.actorId,
              authorizationContextRef: current.authorizationContextRef,
            }),
            workPlanRef: mergePlan.workPlanRef,
            groupRef: entry.groupRef,
            validationSnapshotRef,
          }),
          artifactId: this.#artifactID("validation-snapshot", validationSnapshotRef.reference),
          purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.snapshot,
          value: validationSnapshot,
        },
        {
          row: RiskCandidateFinalizationResultRowV1Schema.parse({
            ...this.#rowBase({
              resultKind: "evidence-snapshot",
              commandId: `${command.commandId}:snapshot:${entry.groupVersionId}`,
              projectId: command.projectId,
              resultId: evidenceSnapshotRef.reference.entityId,
              resultVersionId: evidenceSnapshotRef.reference.versionId,
              requestDigest: entry.groupVersionId,
              inputSnapshotRef: mergePlan.inputSnapshotRef,
              authorizationScopeDigest: scopeDigest,
              actorId: command.actorId,
              authorizationContextRef: current.authorizationContextRef,
            }),
            workPlanRef: mergePlan.workPlanRef,
            groupRef: entry.groupRef,
            evidenceSnapshotRef,
          }),
          artifactId: this.#artifactID("evidence-snapshot", evidenceSnapshotRef.reference),
          purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.snapshot,
          value: evidenceSnapshot,
        },
      );
      const snapshotPersisted = await this.#persistRows({
        requests: routeRequests.splice(routeRequests.length - 2, 2),
        occurredAt: this.#now().toISOString(),
        authorization: current,
        actorId: command.actorId,
        commandKind: "identification.group-snapshot.register",
        commandId: `${command.commandId}:snapshot:${entry.groupVersionId}`,
        idempotencyKey: `${command.commandId}:snapshot:${entry.groupVersionId}`,
        resultRef: { kind: "validation-snapshot", reference: validationSnapshotRef.reference },
      });
      if (snapshotPersisted.kind === "idempotency-conflict") {
        throw new RiskCandidateFinalizationError(
          idempotencyConflict({
            causalRunId: command.commandId,
            occurredAt: this.#now().toISOString(),
            idempotencyKey: command.idempotencyKey,
            priorCommandId: snapshotPersisted.priorCommandId,
          }),
        );
      }
      if (snapshotPersisted.kind === "failed") {
        throw new RiskCandidateFinalizationError(
          terminalFailure({
            causalRunId: command.commandId,
            occurredAt: this.#now().toISOString(),
            stage: "group-snapshot-register",
          }),
        );
      }
      const reviewAuthorization = await options.authorization.issueBranchContext({
        projectId: command.projectId,
        actorId: command.actorId,
        invocationId: `${command.commandId}:review:${entry.groupVersionId}`,
        requestedAt: occurredAt,
        branch: "review-audit.request-review",
        parentAuthorization: current,
        requestedSpatialScopeRefs: [...current.spatialScopeRefs],
        requestedSourceVersionRefs: [],
      });
      const reviewResult = await options.review.requestReview(
        ReviewRequestV1Schema.parse({
          commandId: `${command.commandId}:review:${entry.groupVersionId}`,
          idempotencyKey: `${command.commandId}:review:${entry.groupVersionId}`,
          projectId: command.projectId,
          actorId: command.actorId,
          issuedAt: occurredAt,
          kind: "request-review",
          authorization: reviewAuthorization,
          payload: {
            reviewType: "identification-group",
            targetRef: entry.groupRef,
            validationSnapshotRef: {
              kind: "validation-snapshot",
              reference: validationSnapshotRef.reference,
            },
            evidenceSnapshotRef: {
              kind: "evidence-snapshot",
              reference: evidenceSnapshotRef.reference,
            },
            waitingRunRef: mergePlan.identificationRunRef,
            reviewPolicyRef: forcedReviewPolicy.reviewPolicyRef,
          },
        }),
      );
      if (reviewResult.kind === "failed") {
        throw new RiskCandidateFinalizationError(reviewResult.error);
      }
      if (reviewResult.kind !== "succeeded") {
        throw new RiskCandidateFinalizationError(
          terminalFailure({
            causalRunId: command.commandId,
            occurredAt,
            stage: "review-request-unexpected-outcome",
          }),
        );
      }
      reviewTaskRefs.push(reviewResult.result.reviewTaskRef);
      routes.push({
        routeKind: "review",
        groupId: entry.groupId,
        groupVersionId: entry.groupVersionId,
        groupRef: entry.groupRef,
        compositeConfidence: confidenceOutcome.confidence,
        reviewTaskRef: reviewResult.result.reviewTaskRef,
        waitingRunRef: mergePlan.identificationRunRef,
        validationSnapshotRef,
        evidenceSnapshotRef,
        reviewPolicyRef: forcedReviewPolicy.reviewPolicyRef,
        forcedReviewReasonCode: forcedReason,
      });
    }
    const routeSetDigest = sha256CanonicalJson({
      mergePlanRef: command.payload.mergePlanRef.reference,
      confidencePolicyRef: confidencePolicy.policyRef,
      forcedReviewPolicyRef: forcedReviewPolicy.policyRef,
      routes: routes.map((route) =>
        route.routeKind === "automatic"
          ? {
              routeKind: route.routeKind,
              groupId: route.groupId,
              groupVersionId: route.groupVersionId,
              routeDecisionRef: route.routeDecisionRef.reference,
            }
          : {
              routeKind: route.routeKind,
              groupId: route.groupId,
              groupVersionId: route.groupVersionId,
              reviewTaskRef: route.reviewTaskRef.reference,
            },
      ),
    });
    const acceptanceRouteSetRef = acceptanceRouteSetRefFor({
      projectId: command.projectId,
      workPlanEntityId: mergePlan.workPlanRef.reference.entityId,
      requestDigest: routeSetDigest,
    });
    const routeSet: AcceptanceRouteSetV1 = {
      schemaVersion: RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
      projectId: command.projectId,
      workPlanRef: mergePlan.workPlanRef,
      identificationRunRef: mergePlan.identificationRunRef,
      inputSnapshotRef: mergePlan.inputSnapshotRef,
      policySetRef: mergePlan.policySetRef,
      mergePlanRef: command.payload.mergePlanRef,
      confidencePolicyRef: confidencePolicy.policyRef,
      forcedReviewPolicyRef: forcedReviewPolicy.policyRef,
      routes,
      authorizationScopeDigest: scopeDigest,
      authorizationContextRef: current.authorizationContextRef,
      routedAt: occurredAt,
    };
    const persisted = await this.#persistRows({
      requests: [
        ...routeRequests,
        {
          row: RiskCandidateFinalizationResultRowV1Schema.parse({
            ...this.#rowBase({
              resultKind: "acceptance-route-set",
              commandId: `${command.commandId}:acceptance-route-set`,
              projectId: command.projectId,
              resultId: acceptanceRouteSetRef.reference.entityId,
              resultVersionId: acceptanceRouteSetRef.reference.versionId,
              requestDigest: routeSetDigest,
              inputSnapshotRef: mergePlan.inputSnapshotRef,
              authorizationScopeDigest: scopeDigest,
              actorId: command.actorId,
              authorizationContextRef: current.authorizationContextRef,
            }),
            workPlanRef: mergePlan.workPlanRef,
            mergePlanRef: command.payload.mergePlanRef,
            acceptanceRouteSetRef,
          }),
          artifactId: this.#artifactID("acceptance-route-set", acceptanceRouteSetRef.reference),
          purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.acceptanceRouteSet,
          value: routeSet,
        },
      ],
      occurredAt: this.#now().toISOString(),
      authorization: current,
      actorId: command.actorId,
      commandKind: "identification.acceptance-route-set.register",
      commandId: `${command.commandId}:acceptance-route-set`,
      idempotencyKey: `${command.commandId}:acceptance-route-set`,
      resultRef: { kind: "acceptance-route-set", reference: acceptanceRouteSetRef.reference },
    });
    if (persisted.kind === "idempotency-conflict") {
      throw new RiskCandidateFinalizationError(
        idempotencyConflict({
          causalRunId: command.commandId,
          occurredAt,
          idempotencyKey: command.idempotencyKey,
          priorCommandId: persisted.priorCommandId,
        }),
      );
    }
    if (persisted.kind === "failed") {
      throw new RiskCandidateFinalizationError(
        terminalFailure({
          causalRunId: command.commandId,
          occurredAt,
          stage: "acceptance-route-set-register",
        }),
      );
    }
    return { kind: "route", acceptanceRouteSetRef, reviewTaskRefs };
  }

  // --------------------------------- RI-S63～S65 验收决定、标准化记录与事件原子成立

  async #acceptGroups(
    command: Extract<IdentificationFinalizationCommandV1, { readonly kind: "accept-groups" }>,
  ): Promise<
    Extract<IdentificationFinalizationSuccessV1, { readonly kind: "accepted" | "skipped" }>
  > {
    const options = this.#options;
    const occurredAt = this.#now().toISOString();
    const current = await this.#requireCurrent({
      authorization: command.authorization,
      branch: "risk-identification.accept-groups",
      causalRunId: command.commandId,
      policyRef: command.authorization.authorizationPolicyRef,
      capability: "risk-identification.finalize",
    });
    const routeRow = await this.#readRow({
      projectId: command.projectId,
      resultKind: "acceptance-route-set",
      resultId: command.payload.acceptanceRouteSetRef.reference.entityId,
      resultVersionId: command.payload.acceptanceRouteSetRef.reference.versionId,
    });
    if (routeRow === undefined || routeRow.resultKind !== "acceptance-route-set") {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt,
          blockerKind: "acceptance-route-set-not-found",
          blockerRef: command.payload.acceptanceRouteSetRef,
        }),
      );
    }
    const routeSet = await this.#readRegistered<AcceptanceRouteSetV1>({
      row: routeRow,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: occurredAt,
      purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.acceptanceRouteSet,
      authorization: current,
    });
    const routeByGroup = new Map(
      routeSet.routes.map((route) => [referenceKey(route.groupRef.reference), route]),
    );
    const submitted = command.payload.acceptedGroupRefs.map((ref) => referenceKey(ref.reference));
    if (
      new Set(submitted).size !== submitted.length ||
      submitted.length !== routeSet.routes.length ||
      submitted.some((key) => !routeByGroup.has(key))
    ) {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt,
          blockerKind: "acceptance-group-set-mismatch",
          blockerRef: command.payload.acceptanceRouteSetRef,
        }),
      );
    }
    const decisionKeys = new Set<string>();
    for (const decisionRef of command.payload.decisionRefs) {
      const key = `${decisionRef.kind}\u0000${referenceKey(decisionRef.reference)}`;
      if (decisionKeys.has(key)) {
        throw new RiskCandidateFinalizationError(
          blocked({
            causalRunId: command.commandId,
            occurredAt,
            blockerKind: "duplicate-decision",
            blockerRef: decisionRef,
          }),
        );
      }
      decisionKeys.add(key);
    }
    if (decisionKeys.size !== routeSet.routes.length) {
      throw new RiskCandidateFinalizationError(
        blocked({
          causalRunId: command.commandId,
          occurredAt,
          blockerKind: "acceptance-decision-set-mismatch",
          blockerRef: command.payload.acceptanceRouteSetRef,
        }),
      );
    }
    const reviewAuthorization = routeSet.routes.some((route) => route.routeKind === "review")
      ? await options.authorization.issueBranchContext({
          projectId: command.projectId,
          actorId: command.actorId,
          invocationId: `${command.commandId}:trace`,
          requestedAt: occurredAt,
          branch: "review-audit.trace",
          parentAuthorization: current,
          requestedSpatialScopeRefs: [...current.spatialScopeRefs],
          requestedSourceVersionRefs: [],
        })
      : undefined;
    const records: StandardizedRiskRecordEnvelope[] = [];
    const recordWrites: StandardizedRiskRecordWriteV1[] = [];
    const skippedGroupRefs: AcceptanceRouteSetV1["routes"][number]["groupRef"][] = [];
    for (const route of routeSet.routes) {
      let decisionKind: string;
      let reviewDecisionRef: VersionReference | undefined;
      if (route.routeKind === "automatic") {
        if (
          !decisionKeys.has(`route-decision\u0000${referenceKey(route.routeDecisionRef.reference)}`)
        ) {
          throw new RiskCandidateFinalizationError(
            blocked({
              causalRunId: command.commandId,
              occurredAt,
              blockerKind: "automatic-decision-mismatch",
              blockerRef: route.groupRef,
            }),
          );
        }
        const decisionRow = await this.#readRow({
          projectId: command.projectId,
          resultKind: "route-decision",
          resultId: route.routeDecisionRef.reference.entityId,
          resultVersionId: route.routeDecisionRef.reference.versionId,
        });
        if (decisionRow === undefined || decisionRow.resultKind !== "route-decision") {
          throw new RiskCandidateFinalizationError(
            blocked({
              causalRunId: command.commandId,
              occurredAt,
              blockerKind: "automatic-decision-not-found",
              blockerRef: route.groupRef,
            }),
          );
        }
        const automatic = await this.#readRegistered<AutomaticAcceptanceDecisionV1>({
          row: decisionRow,
          projectId: command.projectId,
          actorId: command.actorId,
          requestedAt: occurredAt,
          purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.routeDecision,
          authorization: current,
        });
        if (
          automatic.groupVersionId !== route.groupVersionId ||
          !sameRef(automatic.groupRef.reference, route.groupRef.reference) ||
          automatic.projectId !== command.projectId
        ) {
          throw new RiskCandidateFinalizationError(
            blocked({
              causalRunId: command.commandId,
              occurredAt,
              blockerKind: "automatic-decision-stale",
              blockerRef: route.groupRef,
            }),
          );
        }
        decisionKind = automatic.decision;
      } else {
        if (reviewAuthorization === undefined) throw new TypeError("review authorization required");
        const read: IdentificationGroupDecisionReadV1 =
          await options.reviewDecisionReader.readIdentificationGroupDecision({
            projectId: command.projectId,
            groupRef: route.groupRef,
            reviewTaskRef: route.reviewTaskRef,
            authorization: reviewAuthorization,
            invocationId: `${command.commandId}:review-read:${route.groupVersionId}`,
            requestedAt: occurredAt,
          });
        if (read.kind === "blocked") {
          throw new RiskCandidateFinalizationError(
            blocked({
              causalRunId: command.commandId,
              occurredAt,
              blockerKind: read.detailCode,
              blockerRef: route.groupRef,
            }),
          );
        }
        if (read.kind === "pending") {
          throw new RiskCandidateFinalizationError(
            blocked({
              causalRunId: command.commandId,
              occurredAt,
              blockerKind: "review-decision-pending",
              blockerRef: route.groupRef,
            }),
          );
        }
        if (
          !decisionKeys.has(
            `review-decision\u0000${referenceKey(read.reviewDecisionRef.reference)}`,
          )
        ) {
          throw new RiskCandidateFinalizationError(
            blocked({
              causalRunId: command.commandId,
              occurredAt,
              blockerKind: "review-decision-stale",
              blockerRef: route.groupRef,
            }),
          );
        }
        decisionKind = read.decisionKind;
        reviewDecisionRef = read.reviewDecisionRef.reference;
      }
      const disposition = decisionDispositionFor(decisionKind);
      if (disposition === "blocked") {
        throw new RiskCandidateFinalizationError(
          blocked({
            causalRunId: command.commandId,
            occurredAt,
            blockerKind: `decision-${decisionKind}`,
            blockerRef: route.groupRef,
          }),
        );
      }
      if (disposition === "reroute") {
        skippedGroupRefs.push(route.groupRef);
        continue;
      }
      const groupRow = await this.#readRow({
        projectId: command.projectId,
        resultKind: "identification-group",
        resultId: route.groupRef.reference.entityId,
        resultVersionId: route.groupRef.reference.versionId,
      });
      if (groupRow === undefined || groupRow.resultKind !== "identification-group") {
        throw new RiskCandidateFinalizationError(
          blocked({
            causalRunId: command.commandId,
            occurredAt,
            blockerKind: "identification-group-not-found",
            blockerRef: route.groupRef,
          }),
        );
      }
      const group = await this.#readRegistered<IdentificationGroupV1>({
        row: groupRow,
        projectId: command.projectId,
        actorId: command.actorId,
        requestedAt: occurredAt,
        purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.group,
        authorization: current,
      });
      // 代表成员由冻结合并策略的平局规则唯一确定：字典序最小的候选引用。
      const representative = [...group.members].sort((left, right) => {
        const leftKey = referenceKey(left.candidateRef.reference);
        const rightKey = referenceKey(right.candidateRef.reference);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      })[0];
      if (representative === undefined) {
        throw new RiskCandidateFinalizationError(
          blocked({
            causalRunId: command.commandId,
            occurredAt,
            blockerKind: "group-member-missing",
            blockerRef: route.groupRef,
          }),
        );
      }
      const candidatePayload = (await this.#readArtifactJson({
        artifactRef: representative.candidateRef.reference,
        projectId: command.projectId,
        actorId: command.actorId,
        requestedAt: occurredAt,
        purposeCode: RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.candidateSet,
        authorization: current,
      })) as RiskCandidateV1;
      const recordDigest = sha256CanonicalJson({
        groupRef: route.groupRef.reference,
        representative: representative.candidateRef.reference,
        output: candidatePayload.output,
        sourceIds: [...new Set(group.members.flatMap((member) => member.sourceSegmentIds))].sort(),
        mechanismEntryIds: [
          ...new Set(group.members.flatMap((member) => member.mechanismEntryIds)),
        ].sort(),
        compositeConfidence: route.compositeConfidence,
      });
      const riskRecordId = `identification-risk-record:${command.projectId}:${route.groupRef.reference.entityId}`;
      const envelope: StandardizedRiskRecordEnvelope = StandardizedRiskRecordEnvelopeSchema.parse({
        riskRecordId,
        record: { processNodeId: candidatePayload.nodeId, ...candidatePayload.output },
        riskMechanismEntryIds: [
          ...new Set(group.members.flatMap((member) => member.mechanismEntryIds)),
        ].sort(),
        sourceIds: [...new Set(group.members.flatMap((member) => member.sourceSegmentIds))].sort(),
        compositeConfidence: {
          value: route.compositeConfidence.value,
          basis: route.compositeConfidence.basis.map(
            (basis) =>
              `${basis.source}:${basis.value.toFixed(route.compositeConfidence.roundingDecimals)}`,
          ),
        },
        version: {
          reference: { entityId: riskRecordId, versionId: recordDigest },
          effectivePeriod: { validFrom: occurredAt },
          systemTime: { recordedAt: occurredAt },
        },
        audit: {
          actorId: command.actorId,
          action: "identification.risk-record-accepted",
          recordedAt: occurredAt,
        },
      });
      records.push(envelope);
      recordWrites.push({
        riskRecordId,
        versionId: recordDigest,
        riskRecordRef: {
          kind: "standardized-risk-record",
          reference: { entityId: riskRecordId, versionId: recordDigest },
        },
        rowId: `${riskRecordId}:${recordDigest}`,
        idempotencyKey: `${command.idempotencyKey}:${riskRecordId}:${recordDigest}`,
        requestDigest: recordDigest,
        projectId: command.projectId,
        workPlanRef: routeSet.workPlanRef,
        identificationRunRef: routeSet.identificationRunRef,
        inputSnapshotRef: routeSet.inputSnapshotRef,
        mergePlanRef: routeSet.mergePlanRef,
        ...(route.routeKind === "automatic" ? { routeDecisionRef: route.routeDecisionRef } : {}),
        ...(reviewDecisionRef === undefined
          ? {}
          : {
              reviewDecisionRef: { kind: "review-decision" as const, reference: reviewDecisionRef },
            }),
        groupId: route.groupId,
        groupVersionId: route.groupVersionId,
        groupRef: route.groupRef,
        representativeCandidateRefs: [
          { kind: "content-artifact", reference: representative.candidateRef.reference },
        ],
        sourceSegmentIds: envelope.sourceIds,
        mechanismEntryIds: envelope.riskMechanismEntryIds,
        authorizationScopeDigest: routeSet.authorizationScopeDigest,
        authorizationContextRef: current.authorizationContextRef,
        actorRef: command.actorId,
        commandId: command.commandId,
        occurredAt,
      });
    }
    if (skippedGroupRefs.length > 0 || records.length === 0) {
      return { kind: "skipped", skippedGroupRefs };
    }

    // 正式事实写入前再次复验当前授权，避免读取决定后撤权仍沿用旧上下文提交记录与事件。
    const closing = await this.#requireCurrent({
      authorization: command.authorization,
      branch: "risk-identification.accept-groups",
      causalRunId: command.commandId,
      policyRef: command.authorization.authorizationPolicyRef,
      capability: "risk-identification.finalize",
    });
    const closingScopeDigest = authorizationScopeDigest(closing);
    const closingRecordWrites = recordWrites.map((row) => ({
      ...row,
      authorizationScopeDigest: closingScopeDigest,
      authorizationContextRef: closing.authorizationContextRef,
    }));

    const commandId = command.commandId;
    const auditEntryId = `${commandId}:audit`;
    const auditVersionId = records[0]?.version.reference.versionId ?? "v1";
    const atomicCommand: AtomicCommandV1 = AtomicCommandV1Schema.parse({
      projectId: command.projectId,
      commandKind: "identification.accept-groups",
      commandId,
      idempotencyKey: command.idempotencyKey,
      payload: {
        riskRecordRefs: records.map((record) => record.version.reference),
      },
      actorRef: command.actorId,
      authorizationContextRef: closing.authorizationContextRef,
      issuedAt: command.issuedAt,
    });
    let aborted = false;
    let eventRefs: { readonly eventId: string }[] = [];
    try {
      const receipt = await options.transactionUnit.execute(
        atomicCommand,
        async (context: TransactionContextV1): Promise<AtomicCommitV1> => {
          const insertion = await options.recordStore.insertRecords(
            { rows: closingRecordWrites, records, occurredAt },
            context,
          );
          if (insertion.kind === "conflict") {
            aborted = true;
            throw new FinalizationTransactionAbort();
          }
          if (insertion.kind === "replayed") {
            aborted = true;
            throw new FinalizationTransactionAbort();
          }
          const recordedAt = this.#now().toISOString();
          const events: DomainEventV1[] = records.map((record) =>
            DomainEventV1Schema.parse({
              schemaVersion: "1",
              eventId: `identification-risk-record-accepted:${record.riskRecordId}:${record.version.reference.versionId}`,
              eventVersion: 1,
              eventType: "identification.risk-record-accepted.v1",
              projectId: command.projectId,
              aggregateRef: {
                kind: "standardized-risk-record",
                reference: record.version.reference,
              },
              occurredAt: command.issuedAt,
              recordedAt,
              causationId: commandId,
              correlationId: routeSet.identificationRunRef.reference.entityId,
              producerCommandId: commandId,
              idempotencyKey: command.idempotencyKey,
              authorizationContextRef: closing.authorizationContextRef,
              auditTrailRef: {
                kind: "audit-trail",
                reference: { entityId: auditEntryId, versionId: auditVersionId },
              },
              payload: {
                standardizedRiskRecordRef: {
                  kind: "standardized-risk-record",
                  reference: record.version.reference,
                },
                identificationInputSnapshotRef: routeSet.inputSnapshotRef,
                identificationRunRef: routeSet.identificationRunRef,
              },
            }),
          );
          return {
            resultRef: {
              kind: "standardized-risk-record",
              reference: records[0]?.version.reference ?? { entityId: "", versionId: "" },
            },
            audit: {
              auditEntryId,
              projectId: command.projectId,
              action: "identification.accept-groups",
              targetRef: {
                kind: "standardized-risk-record",
                reference: records[0]?.version.reference ?? { entityId: "", versionId: "" },
              },
              actorRef: command.actorId,
              authorizationContextRef: closing.authorizationContextRef,
              occurredAt,
              recordedAt,
              version: {
                entityId: records[0]?.riskRecordId ?? "",
                versionId: auditVersionId,
              },
              commandId,
              idempotencyKey: command.idempotencyKey,
            },
            events,
          };
        },
      );
      eventRefs = receipt.eventRefs.map((ref) => ({ eventId: ref.eventId }));
    } catch (error: unknown) {
      if (error instanceof FinalizationTransactionAbort) {
        if (aborted) {
          return {
            kind: "accepted",
            standardizedRiskRecordRefs: records.map((record) => ({
              kind: "standardized-risk-record" as const,
              reference: record.version.reference,
            })),
            assessmentEventRefs: records.map((record) => ({
              kind: "domain-event" as const,
              eventId: `identification-risk-record-accepted:${record.riskRecordId}:${record.version.reference.versionId}`,
              eventVersion: 1 as const,
            })) satisfies DomainEventRefV1[],
          };
        }
      }
      throw error;
    }
    if (eventRefs.length !== records.length) {
      throw new RiskCandidateFinalizationError(
        terminalFailure({
          causalRunId: commandId,
          occurredAt,
          stage: "acceptance-event-arity",
        }),
      );
    }
    return {
      kind: "accepted",
      standardizedRiskRecordRefs: records.map((record) => ({
        kind: "standardized-risk-record",
        reference: record.version.reference,
      })),
      assessmentEventRefs: records.map((record, index) => ({
        kind: "domain-event",
        eventId: eventRefs[index]?.eventId ?? "",
        eventVersion: 1,
      })),
    };
  }
}
