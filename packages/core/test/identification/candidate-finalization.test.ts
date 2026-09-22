/**
 * C22 核心行为测试（IP-01/04/05/06）：严格 Schema 与身份、确定性逐项校验、可修正/终止分类、
 * 三信号合并、综合置信度、强制复核与决定语义，以及端口驱动的服务接入。
 *
 * 全部 fixture 均为「合成样本、待甲方复核」：五项上下文、策略版本、候选、合并向量、组与
 * 决定都是手工构造的合成值，不对应任何真实工程资料或真实模型输出。
 *
 * 断言只覆盖稳定可观察行为：稳定标识、稳定原因码、disposition、权重归一、零副作用
 * （端口未被调用）。不断言消息文本、内部调用顺序或 Schema 源码。
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { VersionReference } from "@riskflow/contracts/common";
import { IdentificationInputSnapshotV1Schema } from "@riskflow/contracts/workflows";
import {
  IdentificationAnalysisCommandV1Schema,
  IdentificationFinalizationCommandV1Schema,
  ModuleErrorV1Schema,
  type AuthorizationContextV1,
  type IdentificationAnalysisCommandV1,
  type IdentificationAnalysisResultV1,
  type IdentificationFinalizationCommandV1,
  type IdentificationFinalizationResultV1,
} from "@riskflow/contracts/ports";
import { ModelContextPayloadV1Schema } from "../../src/identification/context/schema.js";
import { sha256CanonicalJson } from "../../src/persistence/index.js";
import {
  AcceptanceRouteSetV1Schema,
  CANDIDATE_REPAIRABLE_REASON_CODES_V1,
  CANDIDATE_VALIDATION_CHECK_IDS_V1,
  CANDIDATE_VALIDATION_REASON_CODES_V1,
  CandidateValidationSetV1Schema,
  CONFIDENCE_BASIS_SOURCES_V1,
  CompositeConfidencePolicyV1Schema,
  FORCED_REVIEW_REASON_CODES_V1,
  ForcedReviewPolicyV1Schema,
  IdentificationGroupDecisionKindV1Schema,
  IdentificationGroupV1Schema,
  MERGE_SKIP_REASON_CODE_V1,
  MergePlanV1Schema,
  RiskCandidateFinalizationResultRowV1Schema,
  RiskCandidateFinalizationService,
  RiskCandidateGenerationPolicyV1Schema,
  RiskCandidateMergePolicyV1Schema,
  RiskCandidateSetV1Schema,
  RiskCandidateV1Schema,
  RiskCandidateValidationPolicyV1Schema,
  assertCompositeConfidenceWeights,
  assertMergePolicyWeights,
  assertRepairableReasonCodes,
  buildMergeGroups,
  buildVisibleEvidenceIndex,
  calculateCompositeConfidence,
  candidateEvaluationKey,
  decisionDispositionFor,
  evaluateCandidate,
  evaluateCandidateSet,
  forcedReviewReasonFor,
  type CandidateValidationCheckV1,
  type CandidateValidationEntryV1,
  type CompositeConfidenceInputV1,
  type ForcedReviewPolicyV1,
  type GroupCompositeConfidenceV1,
  type GroupMergeEvidenceV1,
  type MergeCandidateInputV1,
  type RiskCandidateFinalizationResultStoreV1,
  type RiskCandidateFinalizationServiceOptionsV1,
  type RiskCandidateGenerationPolicyV1,
  type RiskCandidateMergePolicyV1,
  type RiskCandidateValidationPolicyV1,
} from "../../src/identification/candidate-finalization/index.js";

const TIMESTAMP = "2030-01-01T00:00:00.000Z";
const PROJECT = "project-c22";
const ACTOR = "actor-c22";
const NODE_ID = "node-变径空间扩挖";
const RELATED_NODE_ID = "node-刀盘扩径";

const SEGMENT_PROCESS = "segment-process-node";
const SEGMENT_STATE = "segment-state-parameter";
const SEGMENT_FORCE = "segment-force-dependency";
const SEGMENT_MECHANISM = "segment-mechanism";
const SEGMENT_CASE = "segment-case-library";

const versionRef = (entityId: string, versionId = "v1"): VersionReference => ({
  entityId,
  versionId,
});

const digestOf = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(value) ?? "")
    .digest("hex");

const DIGEST_A = digestOf("c22-digest-a");
const DIGEST_B = digestOf("c22-digest-b");
const DIGEST_C = digestOf("c22-digest-c");

const contentRef = (entityId: string) => ({
  kind: "content-artifact" as const,
  reference: versionRef(entityId),
});
const diagnosisRef = (entityId: string) => ({
  kind: "diagnostic-artifact" as const,
  reference: versionRef(entityId),
});

const authorizationContextRef = {
  kind: "authorization-context" as const,
  reference: versionRef("authorization-context-c22"),
};
const inputSnapshotRef = {
  kind: "identification-input-snapshot" as const,
  reference: versionRef("input-snapshot-c22"),
};
const workItemRef = {
  kind: "identification-work-item" as const,
  reference: versionRef("work-item-c22"),
};
const workPlanRef = {
  kind: "identification-work-plan" as const,
  reference: versionRef("work-plan-c22"),
};
const policySetRef = {
  kind: "identification-policy-set" as const,
  reference: versionRef("policy-set-c22"),
};
const retrievalArtifactSetRef = {
  kind: "retrieval-artifact-set" as const,
  reference: versionRef("retrieval-review:task-c22"),
};
const modelContextArtifactSetRef = {
  kind: "model-context-artifact-set" as const,
  reference: versionRef("model-context-artifact-set-c22"),
};
const mergePlanRefValue = {
  kind: "merge-plan" as const,
  reference: versionRef(`merge-plan:${PROJECT}:work-plan-c22`, DIGEST_A),
};
const acceptanceRouteSetRefValue = {
  kind: "acceptance-route-set" as const,
  reference: versionRef(`acceptance-route-set:${PROJECT}:work-plan-c22`, DIGEST_B),
};
const validatedSetRef = (entityId: string) => ({
  kind: "validated-candidate-set" as const,
  reference: versionRef(entityId),
});
const groupRefValue = (groupId: string) => ({
  kind: "identification-group" as const,
  reference: versionRef(`identification-group:${PROJECT}:work-plan-c22:${groupId}`, DIGEST_C),
});

const authorization = (
  grantedCapabilities: readonly string[],
  overrides: Record<string, unknown> = {},
): AuthorizationContextV1 =>
  ({
    schemaVersion: "1",
    authorizationContextRef,
    actorId: ACTOR,
    projectId: PROJECT,
    grantedCapabilities: [...grantedCapabilities],
    spatialScopeRefs: [{ kind: "spatial-scope", reference: versionRef("spatial-scope") }],
    sourceAccessGrantRefs: [
      { kind: "source-access-grant", reference: versionRef("source-access-grant") },
    ],
    authorizationPolicyRef: versionRef("access-policy"),
    decidedAt: TIMESTAMP,
    invocation: { kind: "system", systemActorId: ACTOR, reasonCode: "c22-test" },
    causalRunRef: { kind: "workflow-run", reference: versionRef("workflow-run") },
    ...overrides,
  }) as unknown as AuthorizationContextV1;

const governanceAuthorization = () =>
  authorization(["risk-identification.run", "risk-identification.finalize"]);

const inputSnapshot = (overrides: Record<string, unknown> = {}) =>
  IdentificationInputSnapshotV1Schema.parse({
    schemaVersion: "1",
    preparationSnapshotRef: {
      kind: "identification-preparation-snapshot",
      reference: versionRef("preparation-snapshot"),
    },
    processModelReleaseRef: {
      kind: "process-model-release",
      reference: versionRef("release-process-model"),
    },
    riskMechanismReleaseRef: {
      kind: "risk-mechanism-release",
      reference: versionRef("release-risk-mechanism"),
    },
    retrievalEvidenceBaseReleaseRef: {
      kind: "retrieval-evidence-base-release",
      reference: versionRef("release-evidence-base"),
    },
    identificationPolicySetRef: policySetRef,
    retrievalPolicyRef: versionRef("retrieval-policy"),
    retrievalReviewAgentPolicyRef: versionRef("retrieval-review-policy"),
    repairPolicyRef: versionRef("repair-policy"),
    confidencePolicyRef: versionRef("confidence-policy"),
    forcedReviewPolicyRef: versionRef("forced-review-policy"),
    retryPolicyRef: versionRef("retry-policy"),
    modelDeploymentRef: versionRef("model-deployment"),
    promptTemplateRef: versionRef("prompt-template"),
    authorizationContextRef,
    auditTrailRef: { kind: "audit-trail", reference: versionRef("audit-trail") },
    createdBy: ACTOR,
    createdAt: TIMESTAMP,
    ...overrides,
  });

// ------------------------------------------------------------------ 合成五项上下文

const evidence = (sourceSegmentId: string, entityId = "source-a") => ({
  locator: { sourceSegmentId },
  sourceVersion: versionRef(entityId),
});

const reviewTaskRefValue = () => ({
  kind: "agent-task" as const,
  reference: versionRef(`agent-task:${PROJECT}:review-1`),
  taskType: "retrieval-review" as const,
  triggerMode: "embedded" as const,
  modelDeploymentRef: versionRef("model-deployment"),
  promptTemplateRef: versionRef("prompt-template"),
  toolPolicyRef: versionRef("tool-policy"),
  budgetPolicyRef: versionRef("budget-policy"),
  incrementSchemaRef: versionRef("increment-schema"),
  validationPolicyRef: versionRef("validation-policy"),
});

/** 合成 C21 冻结五项上下文：五组全部非空，证据定位与版本键覆盖正例与反例。 */
const modelContextValue = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  projectId: PROJECT,
  nodeId: NODE_ID,
  inputSnapshotRef,
  workItemRef,
  policySetRef,
  releaseBinding: {
    processModelReleaseRef: {
      kind: "knowledge-release",
      reference: versionRef("release-process-model"),
    },
    processModelPackageDigest: DIGEST_A,
    riskMechanismReleaseRef: {
      kind: "knowledge-release",
      reference: versionRef("release-risk-mechanism"),
    },
    riskMechanismPackageDigest: DIGEST_B,
    retrievalEvidenceBaseReleaseRef: {
      kind: "knowledge-release",
      reference: versionRef("release-evidence-base"),
    },
    retrievalEvidenceBasePackageDigest: DIGEST_C,
    compositeMemberReleaseRefs: [
      { kind: "knowledge-release", reference: versionRef("release-risk-mechanism") },
      { kind: "knowledge-release", reference: versionRef("release-standard-library") },
      { kind: "knowledge-release", reference: versionRef("release-case-library") },
    ],
  },
  relationshipQueryResultRef: {
    kind: "knowledge-query-result",
    reference: versionRef("relationship-query-result"),
  },
  baselineQueryResultRef: {
    kind: "knowledge-query-result",
    reference: versionRef("baseline-query-result"),
  },
  retrievalArtifactSetRef,
  reviewTaskRef: reviewTaskRefValue(),
  reviewAgentPolicyRef: versionRef("retrieval-review-policy"),
  retrievalPolicyRef: versionRef("retrieval-policy"),
  processNode: {
    nodeId: NODE_ID,
    processKind: "变径空间扩挖",
    inputs: ["扩挖机构"],
    outputs: ["变径空间"],
    adjacentTimeNodes: [],
    evidence: [evidence(SEGMENT_PROCESS)],
  },
  stateParameters: {
    nodeId: NODE_ID,
    stateParameters: ["土仓/泥水压力"],
    monitoringIndicators: ["地表沉降"],
    evidence: [evidence(SEGMENT_STATE)],
  },
  forceDependencies: [
    {
      edgeId: "edge-force-1",
      fromNodeId: RELATED_NODE_ID,
      toNodeId: NODE_ID,
      relationType: "受力依赖关系",
      evidence: [evidence(SEGMENT_FORCE)],
    },
  ],
  mechanisms: [
    {
      mechanismId: "mechanism-1",
      mechanismType: "渗流突涌",
      stateParameters: ["土仓/泥水压力"],
      evidence: [evidence(SEGMENT_MECHANISM)],
    },
  ],
  retrievalEvidence: [
    {
      memberRef: {
        kind: "retrieval-member",
        reference: versionRef("retrieval-member:case-1"),
      },
      sourceKind: "case-library",
      sourceReleaseRef: {
        kind: "knowledge-release",
        reference: versionRef("release-case-library"),
      },
      sourceEntryId: "case-1",
      evidence: [evidence(SEGMENT_CASE, "source-case")],
      rankingSignal: {
        rank: 1,
        fusionScore: 0.93,
        scoreSemantics: "ranking-signal-not-confidence",
      },
    },
  ],
  authorizationScopeDigest: DIGEST_A,
  authorizationContextRef,
  assembledAt: TIMESTAMP,
  ...overrides,
});

const modelContext = () => ModelContextPayloadV1Schema.parse(modelContextValue());

// ---------------------------------------------------------------------- 合成策略

const validationPolicyValue = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  policyRef: versionRef("validation-policy"),
  policySetRef,
  ruleValidationPolicyRef: versionRef("rule-validation-policy"),
  allowedMechanismTypes: [],
  requiredMechanismTypes: [],
  requiredRelationTypes: [],
  repairableReasonCodes: [...CANDIDATE_REPAIRABLE_REASON_CODES_V1],
  ...overrides,
});

const validationPolicy = (
  overrides: Record<string, unknown> = {},
): RiskCandidateValidationPolicyV1 =>
  RiskCandidateValidationPolicyV1Schema.parse(validationPolicyValue(overrides));

const mergePolicy = (overrides: Record<string, unknown> = {}): RiskCandidateMergePolicyV1 =>
  RiskCandidateMergePolicyV1Schema.parse({
    schemaVersion: "1",
    policyRef: versionRef("merge-policy"),
    policySetRef,
    embeddingDeploymentRef: versionRef("embedding-deployment"),
    embeddingBudgetPolicyRef: versionRef("embedding-budget-policy"),
    relatedNodeIds: [],
    riskEventCosineThreshold: 0.9,
    evidenceSetSimilarityThreshold: 0.8,
    weights: { processNode: 0.4, riskEvent: 0.35, evidence: 0.25 },
    groupThreshold: 0.8,
    maxGroupMembers: 8,
    memberOrder: "candidate-ref-ascending",
    tieBreak: "lexicographically-smallest-candidate-ref",
    ...overrides,
  });

const confidencePolicyValue = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  policyRef: versionRef("confidence-policy"),
  policySetRef,
  weights: {
    modelConfidence: 0.4,
    ruleConsistency: 0.3,
    simulationConstraint: 0.1,
    multiSourceMerge: 0.2,
  },
  requiredBasis: ["model-confidence"],
  missingBasisBehavior: "block",
  roundingDecimals: 4,
  ...overrides,
});

const confidencePolicy = (overrides: Record<string, unknown> = {}) =>
  CompositeConfidencePolicyV1Schema.parse(confidencePolicyValue(overrides));

const forcedReviewPolicy = (overrides: Record<string, unknown> = {}): ForcedReviewPolicyV1 =>
  ForcedReviewPolicyV1Schema.parse({
    schemaVersion: "1",
    policyRef: versionRef("forced-review-policy"),
    policySetRef,
    autoAcceptanceThreshold: 0.95,
    forcedReviewReasonCodes: [],
    reviewPolicyRef: versionRef("review-policy"),
    ...overrides,
  });

const generationPolicy = (): RiskCandidateGenerationPolicyV1 =>
  RiskCandidateGenerationPolicyV1Schema.parse({
    schemaVersion: "1",
    policyRef: versionRef("generation-policy"),
    policySetRef,
    outputSchemaRef: versionRef("output-schema"),
    budgetPolicyRef: versionRef("budget-policy"),
    budget: {
      maxCandidates: 8,
      maxOutputBytes: 65_536,
      maxTotalTokens: 4_096,
      maxWallClockMs: 60_000,
      maxRepairRounds: 2,
    },
  });

// ---------------------------------------------------------------------- 合成候选

/** 六字段模型输出；`modelConfidence` 故意取值 0.31，与上下文的排序信号 0.93 无关。 */
const candidateOutput = (overrides: Record<string, unknown> = {}) => ({
  riskSource: "扩径切削扰动",
  riskFactor: "掌子面支护不足",
  riskEvent: "掌子面失稳涌水",
  riskElementRelations: [
    { sourceElement: "扩挖机构", relation: "作用关系", targetElement: "掌子面" },
  ],
  evidenceLocator: { sourceSegmentId: SEGMENT_MECHANISM },
  modelConfidence: 0.31,
  ...overrides,
});

const candidateValue = (overrides: Record<string, unknown> = {}) => ({
  candidateId: "candidate-001",
  candidateVersion: 1,
  projectId: PROJECT,
  inputSnapshotRef,
  workItemRef,
  modelContextArtifactSetRef,
  nodeId: NODE_ID,
  output: candidateOutput(),
  modelDeploymentRef: versionRef("model-deployment"),
  promptTemplateRef: versionRef("prompt-template"),
  outputSchemaRef: versionRef("output-schema"),
  budgetPolicyRef: versionRef("budget-policy"),
  rawResponseRef: diagnosisRef("raw-response-1"),
  invocationId: "invocation-1",
  generatedAt: TIMESTAMP,
  ...overrides,
});

const candidateSetValue = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  projectId: PROJECT,
  inputSnapshotRef,
  workItemRef,
  nodeId: NODE_ID,
  modelContextArtifactSetRef,
  retrievalArtifactSetRef,
  modelContextPayloadDigest: digestOf(modelContextValue()),
  policySetRef,
  generationPolicyRef: versionRef("generation-policy"),
  modelDeploymentRef: versionRef("model-deployment"),
  promptTemplateRef: versionRef("prompt-template"),
  outputSchemaRef: versionRef("output-schema"),
  budgetPolicyRef: versionRef("budget-policy"),
  candidateSetVersion: 1,
  candidates: [candidateValue()],
  rawResponseRefs: [diagnosisRef("raw-response-1")],
  usage: {
    modelInvocations: 1,
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    outputBytes: 100,
    elapsedMs: 5,
    repairRounds: 0,
  },
  authorizationScopeDigest: DIGEST_A,
  authorizationContextRef,
  generatedAt: TIMESTAMP,
  ...overrides,
});

const CHECK = CANDIDATE_VALIDATION_CHECK_IDS_V1;
const REASON = CANDIDATE_VALIDATION_REASON_CODES_V1;

/** 逐项校验的失败码表：每项检查声明的失败原因码是稳定契约。 */
const FAILURE_REASON_OF_CHECK: Readonly<Record<string, string>> = {
  [CHECK.schema]: REASON.schemaInvalid,
  [CHECK.nodeBinding]: REASON.nodeMismatch,
  [CHECK.riskEvent]: REASON.schemaInvalid,
  [CHECK.relationEndpoints]: REASON.relationEndpointMissing,
  [CHECK.evidenceReachability]: REASON.evidenceNotFrozen,
  [CHECK.mechanismApplicability]: REASON.mechanismNotApplicable,
  [CHECK.ruleConsistency]: REASON.ruleConflict,
  [CHECK.simulationConstraint]: REASON.simulationViolation,
};

const evaluateSet = (
  candidateOverrides: readonly Record<string, unknown>[],
  policyOverrides: Record<string, unknown> = {},
  contextOverrides: Record<string, unknown> = {},
) => {
  const candidates = candidateOverrides.map((overrides, index) =>
    RiskCandidateV1Schema.parse(
      candidateValue({ candidateId: `candidate-00${index + 1}`, ...overrides }),
    ),
  );
  const candidateArtifactRefs = new Map(
    candidates.map((candidate) => [
      candidateEvaluationKey(candidate.candidateId, candidate.candidateVersion),
      versionRef(`candidate-artifact-${candidate.candidateId}`),
    ]),
  );
  return evaluateCandidateSet({
    candidateSet: RiskCandidateSetV1Schema.parse(candidateSetValue({ candidates })),
    candidateArtifactRefs,
    modelContext: ModelContextPayloadV1Schema.parse(modelContextValue(contextOverrides)),
    policy: validationPolicy(policyOverrides),
  });
};

const checkOf = (entry: CandidateValidationEntryV1, checkId: string) =>
  entry.checks.find((check) => check.checkId === checkId);

// ------------------------------------------------------------ 合并 / 置信度 fixture

interface MergeCandidateOverrides {
  readonly candidateRef?: VersionReference;
  readonly candidateId?: string;
  readonly candidateVersion?: number;
  readonly nodeId?: string;
  readonly riskEvent?: string;
  readonly modelConfidence?: number;
  readonly sourceSegmentIds?: readonly string[];
  readonly mechanismEntryIds?: readonly string[];
  readonly sourceVersionKeys?: readonly string[];
}

const mergeCandidate = (overrides: MergeCandidateOverrides = {}): MergeCandidateInputV1 => ({
  candidateRef: versionRef("candidate-artifact-1"),
  candidateId: "candidate-001",
  candidateVersion: 1,
  nodeId: NODE_ID,
  riskEvent: "掌子面失稳涌水",
  modelConfidence: 0.8,
  sourceSegmentIds: [SEGMENT_MECHANISM],
  mechanismEntryIds: ["mechanism-1"],
  sourceVersionKeys: [`source-a\u0000v1`],
  ...overrides,
});

const buildGroups = (
  pairs: readonly (readonly [MergeCandidateInputV1, readonly number[]])[],
  policy: RiskCandidateMergePolicyV1,
) =>
  buildMergeGroups({
    candidates: pairs.map(([candidate]) => candidate),
    vectors: pairs.map(([, vector]) => vector),
    policy,
  });

/** 分组可观察签名：disposition 与按候选引用升序的成员顺序。 */
const groupSignature = (
  groups: readonly {
    readonly disposition: string;
    readonly members: readonly MergeCandidateInputV1[];
  }[],
) =>
  groups.map(
    (group) =>
      `${group.disposition}:${group.members
        .map((member) => member.candidateRef.entityId)
        .join(",")}`,
  );

const checkValue = (checkId: string, passed: boolean): CandidateValidationCheckV1 => ({
  checkId,
  passed,
  reasonCode: passed ? REASON.accepted : REASON.evidenceNotFrozen,
  evidenceRefs: [],
});

const confidenceInput = (
  overrides: Partial<CompositeConfidenceInputV1> = {},
): CompositeConfidenceInputV1 => ({
  memberModelConfidence: [0.8, 0.9],
  memberChecks: [
    [checkValue("check-a", true), checkValue("check-b", true)],
    [checkValue("check-c", true), checkValue("check-d", false)],
  ],
  simulationConstraintDeclared: true,
  simulationConstraintSatisfied: true,
  memberCount: 2,
  distinctSourceVersionCount: 2,
  disposition: "merged",
  policy: confidencePolicy(),
  ...overrides,
});

const computeConfidence = (input: CompositeConfidenceInputV1) => {
  const outcome = calculateCompositeConfidence(input);
  if (outcome.kind !== "computed")
    throw new Error(`unexpected confidence outcome: ${outcome.reasonCode}`);
  return outcome.confidence;
};

const compositeConfidence = (value: number): GroupCompositeConfidenceV1 => ({
  value,
  basis: CONFIDENCE_BASIS_SOURCES_V1.map((source) => ({
    source,
    available: true,
    value,
    weight: 0.25,
    contribution: 0.25,
  })),
  policyRef: versionRef("confidence-policy"),
  missingBasisBehavior: "block",
  roundingDecimals: 4,
});

interface MergeEvidenceOverrides {
  readonly nodeSatisfied?: boolean;
  readonly riskEventSatisfied?: boolean;
  readonly evidenceSatisfied?: boolean;
}

const mergeEvidence = (overrides: MergeEvidenceOverrides = {}): GroupMergeEvidenceV1 => {
  const nodeSatisfied = overrides.nodeSatisfied ?? true;
  const riskEventSatisfied = overrides.riskEventSatisfied ?? true;
  const evidenceSatisfied = overrides.evidenceSatisfied ?? true;
  return {
    processNode: {
      signal: "process-node",
      satisfied: nodeSatisfied,
      nodeIds: [NODE_ID],
      allowedNodeIds: [NODE_ID],
    },
    riskEvent: {
      signal: "risk-event",
      value: riskEventSatisfied ? 1 : 0.5,
      threshold: 0.9,
      satisfied: riskEventSatisfied,
    },
    evidence: {
      signal: "evidence-locator",
      value: evidenceSatisfied ? 1 : 0.5,
      threshold: 0.8,
      satisfied: evidenceSatisfied,
    },
    aggregate: {
      value: nodeSatisfied && riskEventSatisfied && evidenceSatisfied ? 1 : 0.5,
      threshold: 0.8,
      satisfied: nodeSatisfied && riskEventSatisfied && evidenceSatisfied,
    },
  };
};

// ------------------------------------------------------------------ 合成组与计划

const groupMemberValue = (candidateId: string, candidateVersion: number) => ({
  candidateId,
  candidateVersion,
  candidateRef: contentRef(`candidate-artifact-${candidateId}`),
  nodeId: NODE_ID,
  sourceSegmentIds: [SEGMENT_MECHANISM],
  mechanismEntryIds: ["mechanism-1"],
  modelConfidence: 0.8,
});

const groupValue = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  projectId: PROJECT,
  workPlanRef,
  inputSnapshotRef,
  policySetRef,
  groupId: "group-1",
  groupVersionId: DIGEST_C,
  nodeIds: [NODE_ID],
  members: [groupMemberValue("candidate-001", 1), groupMemberValue("candidate-002", 1)],
  mergeEvidence: mergeEvidence(),
  disposition: "merged",
  mergePolicyRef: versionRef("merge-policy"),
  embeddingDeploymentRef: versionRef("embedding-deployment"),
  embeddingArtifactRef: contentRef("embedding-artifact"),
  authorizationScopeDigest: DIGEST_A,
  authorizationContextRef,
  groupedAt: TIMESTAMP,
  ...overrides,
});

const mergePlanValue = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  projectId: PROJECT,
  workPlanRef,
  identificationRunRef: {
    kind: "workflow-run",
    reference: versionRef(`identification-run:${PROJECT}:work-plan-c22`),
  },
  inputSnapshotRef,
  policySetRef,
  validatedCandidateSetRefs: [validatedSetRef("validated-set-a")],
  mergePolicyRef: versionRef("merge-policy"),
  embeddingDeploymentRef: versionRef("embedding-deployment"),
  embeddingArtifactRef: contentRef("embedding-artifact"),
  groups: [
    {
      groupId: "group-1",
      groupVersionId: DIGEST_C,
      groupRef: groupRefValue("group-1"),
      disposition: "no-duplicate",
      memberCount: 1,
    },
  ],
  evaluatedCandidateRefs: [contentRef("candidate-artifact-candidate-001")],
  authorizationScopeDigest: DIGEST_A,
  authorizationContextRef,
  plannedAt: TIMESTAMP,
  ...overrides,
});

const validationSetValue = () => {
  const candidateRefs = [
    contentRef("candidate-artifact-candidate-001"),
    contentRef("candidate-artifact-candidate-002"),
  ];
  return CandidateValidationSetV1Schema.parse({
    schemaVersion: "1",
    projectId: PROJECT,
    inputSnapshotRef,
    workItemRef,
    nodeId: NODE_ID,
    candidateSetRef: contentRef("candidate-set-artifact"),
    candidateSetVersion: 1,
    policySetRef,
    validationPolicyRef: versionRef("validation-policy"),
    ruleValidationPolicyRef: versionRef("rule-validation-policy"),
    simulationConstraintPolicyRef: versionRef("simulation-policy"),
    entries: candidateRefs.map((candidateRef, index) => ({
      candidateId: `candidate-${String(index + 1).padStart(3, "0")}`,
      candidateVersion: 1,
      candidateRef,
      disposition: "accepted",
      checks: [checkValue(`candidate-check-${index + 1}`, true)],
    })),
    acceptedCandidateRefs: candidateRefs,
    usage: candidateSetValue().usage,
    authorizationScopeDigest: DIGEST_A,
    authorizationContextRef,
    completedAt: TIMESTAMP,
  });
};

const routeSetValue = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  projectId: PROJECT,
  workPlanRef,
  identificationRunRef: {
    kind: "workflow-run",
    reference: versionRef(`identification-run:${PROJECT}:work-plan-c22`),
  },
  inputSnapshotRef,
  policySetRef,
  mergePlanRef: mergePlanRefValue,
  confidencePolicyRef: versionRef("confidence-policy"),
  forcedReviewPolicyRef: versionRef("forced-review-policy"),
  routes: [
    {
      routeKind: "automatic",
      groupId: "group-1",
      groupVersionId: DIGEST_C,
      groupRef: groupRefValue("group-1"),
      compositeConfidence: compositeConfidence(0.99),
      routeDecisionRef: {
        kind: "route-decision",
        reference: versionRef(`route-decision:${PROJECT}:group-1`),
      },
    },
  ],
  authorizationScopeDigest: DIGEST_A,
  authorizationContextRef,
  routedAt: TIMESTAMP,
  ...overrides,
});

const resultRowBase = (resultKind: string, resultId: string, resultVersionId: string) => ({
  schemaVersion: "1",
  resultKind,
  projectId: PROJECT,
  resultId,
  resultVersionId,
  requestDigest: DIGEST_A,
  artifactRef: contentRef("artifact-placeholder"),
  inputSnapshotRef,
  authorizationScopeDigest: DIGEST_A,
  actorRef: ACTOR,
  authorizationContextRef,
  commandId: "command-seed",
});

const mergePlanRow = () => ({
  ...resultRowBase(
    "merge-plan",
    mergePlanRefValue.reference.entityId,
    mergePlanRefValue.reference.versionId,
  ),
  workPlanRef,
  mergePlanRef: mergePlanRefValue,
});

const acceptanceRouteSetRow = () => ({
  ...resultRowBase(
    "acceptance-route-set",
    acceptanceRouteSetRefValue.reference.entityId,
    acceptanceRouteSetRefValue.reference.versionId,
  ),
  workPlanRef,
  mergePlanRef: mergePlanRefValue,
  acceptanceRouteSetRef: acceptanceRouteSetRefValue,
});

// ------------------------------------------------------------------------- 测试端口

interface HarnessOverrides {
  readonly verifyCurrent?: (input: {
    readonly invocationId: string;
    readonly branch: string;
  }) => Promise<AuthorizationContextV1 | undefined>;
  readonly missingConfidencePolicy?: boolean;
  readonly modelOutcome?: unknown;
  readonly workPlanValidatedRefs?: readonly unknown[];
  readonly validationPolicyOverrides?: Record<string, unknown>;
  readonly forcedReviewPolicyOverrides?: Record<string, unknown>;
  readonly recordInsertOutcomes?: readonly (
    | { readonly kind: "inserted" }
    | { readonly kind: "replayed" }
    | { readonly kind: "conflict"; readonly detailCode: string }
  )[];
}

const makeHarness = (overrides: HarnessOverrides = {}) => {
  const artifacts = new Map<string, Uint8Array>();
  const rows = new Map<string, unknown>();
  const receipts = new Map<
    string,
    {
      readonly resultRef: unknown;
      readonly auditEntryId: string;
      readonly eventRefs: readonly {
        readonly kind: "domain-event";
        readonly eventId: string;
        readonly eventVersion: number;
      }[];
      readonly payloadDigest: string;
    }
  >();
  const calls = {
    modelContextReads: 0,
    workPlanReads: 0,
    resultReads: 0,
    registerCalls: 0,
    recordInsertCalls: 0,
    transactionCalls: 0,
    reviewRequests: 0,
    decisionsRead: 0,
    generateCalls: 0,
    embedCalls: 0,
    issueBranchCalls: 0,
    verifyCurrentCalls: 0,
  };

  const bytesOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

  const putValue = (entityId: string, value: unknown) => {
    const bytes = bytesOf(value);
    const reference = {
      entityId,
      versionId: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    };
    artifacts.set(reference.versionId, bytes);
    return { kind: "content-artifact" as const, reference };
  };

  const seedRow = (row: Record<string, unknown>, value: unknown) => {
    const reference = putValue(String(row.resultId), value);
    const parsed = RiskCandidateFinalizationResultRowV1Schema.parse({
      ...row,
      artifactRef: reference,
    });
    rows.set(`${parsed.resultKind}:${parsed.resultId}:${parsed.resultVersionId}`, parsed);
    return parsed;
  };

  const rowKey = (resultKind: string, resultId: string, resultVersionId: string) =>
    `${resultKind}:${resultId}:${resultVersionId}`;

  const artifactStore = {
    async put(command: { readonly artifactId: string }, content: AsyncIterable<Uint8Array>) {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of content) {
        chunks.push(chunk);
        size += chunk.byteLength;
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const artifactRef = {
        kind: "content-artifact" as const,
        reference: {
          entityId: command.artifactId,
          versionId: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        },
      };
      artifacts.set(artifactRef.reference.versionId, bytes);
      return {
        artifactRef,
        manifest: {},
        manifestSha256: "0".repeat(64),
        replayed: false,
        deduplicated: false,
      };
    },
    async open(request: { readonly artifactRef: { readonly reference: VersionReference } }) {
      const bytes = artifacts.get(request.artifactRef.reference.versionId);
      if (bytes === undefined) {
        throw new Error(`artifact-not-found:${request.artifactRef.reference.entityId}`);
      }
      return {
        manifest: {},
        content: (async function* () {
          yield bytes;
        })(),
        verified: Promise.resolve({}),
      };
    },
  };

  const resultStore: RiskCandidateFinalizationResultStoreV1 = {
    async registerResults({ rows: incoming }) {
      calls.registerCalls += 1;
      for (const row of incoming) {
        rows.set(rowKey(row.resultKind, row.resultId, row.resultVersionId), row);
      }
      return { kind: "registered", replayed: false };
    },
    async readResult({ resultKind, resultId, resultVersionId }) {
      calls.resultReads += 1;
      return rows.get(rowKey(resultKind, resultId, resultVersionId)) as never;
    },
  };

  const workPlanReader = {
    async readExact() {
      calls.workPlanReads += 1;
      return {
        kind: "succeeded" as const,
        read: {
          workPlanRef,
          inputSnapshotRef,
          inputSnapshot: inputSnapshot(),
          workItems: [],
          validatedCandidateSetRefs: overrides.workPlanValidatedRefs ?? [
            validatedSetRef("validated-set-a"),
          ],
        },
      };
    },
  };

  const modelContextReader = {
    async readExact() {
      calls.modelContextReads += 1;
      const payload = modelContext();
      return {
        kind: "succeeded" as const,
        read: {
          payload,
          payloadDigest: digestOf(payload),
          modelContextArtifactSetRef,
          authorizationScopeDigest: DIGEST_A,
          authorizationContextRef,
        },
      };
    },
  };

  const policyProvider = {
    async resolveGeneration() {
      return generationPolicy();
    },
    async resolveValidation() {
      return validationPolicy(overrides.validationPolicyOverrides);
    },
    async resolveMerge() {
      return mergePolicy();
    },
    async resolveConfidence() {
      return overrides.missingConfidencePolicy === true ? undefined : confidencePolicy();
    },
    async resolveForcedReview() {
      return forcedReviewPolicy(overrides.forcedReviewPolicyOverrides);
    },
  };

  const authorizationPort = {
    async issueBranchContext() {
      calls.issueBranchCalls += 1;
      return governanceAuthorization();
    },
    async verifyCurrent(input: { readonly invocationId: string; readonly branch: string }) {
      calls.verifyCurrentCalls += 1;
      if (overrides.verifyCurrent !== undefined) return await overrides.verifyCurrent(input);
      return governanceAuthorization();
    },
  };

  const recordStore = {
    async insertRecords() {
      calls.recordInsertCalls += 1;
      return (
        overrides.recordInsertOutcomes?.[calls.recordInsertCalls - 1] ?? {
          kind: "inserted" as const,
        }
      );
    },
    async readRecord() {
      return undefined;
    },
  };

  const transactionUnit = {
    async execute(
      command: { readonly commandId: string; readonly payload?: unknown },
      handler: (context: unknown) => Promise<{
        readonly resultRef: unknown;
        readonly audit: { readonly auditEntryId: string };
        readonly events?: readonly { readonly eventId: string; readonly eventVersion: number }[];
      }>,
    ) {
      calls.transactionCalls += 1;
      const payloadDigest = digestOf(command.payload ?? null);
      const prior = receipts.get(command.commandId);
      if (prior !== undefined) {
        // 与 C03 回执一致：同一命令身份携带不同载荷时拒绝，同载荷才算重放。
        if (prior.payloadDigest !== payloadDigest) {
          const conflict = new Error("IDEMPOTENCY_CONFLICT");
          Object.defineProperties(conflict, {
            code: { value: "IDEMPOTENCY_CONFLICT" },
            retryable: { value: false },
            stage: { value: "transaction.idempotency" },
          });
          throw conflict;
        }
        return { ...prior, replayed: true };
      }
      const commit = await handler({ transaction: "in-memory" });
      const receipt = {
        resultRef: commit.resultRef,
        auditEntryId: commit.audit.auditEntryId,
        eventRefs: (commit.events ?? []).map((event) => ({
          kind: "domain-event" as const,
          eventId: event.eventId,
          eventVersion: event.eventVersion,
        })),
      };
      receipts.set(command.commandId, { ...receipt, payloadDigest });
      return { ...receipt, replayed: false };
    },
  };

  const model = {
    async generateCandidates() {
      calls.generateCalls += 1;
      return (
        overrides.modelOutcome ?? {
          kind: "succeeded",
          outputs: [candidateOutput()],
          invocationId: "invocation-1",
          rawResponseRef: diagnosisRef("raw-response-1"),
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            outputBytes: 100,
          },
          elapsedMs: 5,
        }
      );
    },
    async embedRiskEvents(request: { readonly texts: readonly string[] }) {
      calls.embedCalls += 1;
      return {
        kind: "succeeded" as const,
        vectors: request.texts.map(() => [1, 0]),
        dimensions: 2,
        embeddingArtifactRef: contentRef("embedding-artifact"),
        deploymentRef: versionRef("embedding-deployment"),
        rawResponseRef: diagnosisRef("raw-response-embed"),
      };
    },
  };

  const review = {
    async requestReview() {
      calls.reviewRequests += 1;
      return { kind: "succeeded" as const, result: { reviewTaskRef: reviewTaskRefValue() } };
    },
  };

  const reviewDecisionReader = {
    async readIdentificationGroupDecision() {
      calls.decisionsRead += 1;
      return { kind: "pending" as const };
    },
  };

  const options = {
    modelContextReader,
    workPlanReader,
    policyProvider,
    reviewDecisionReader,
    authorization: authorizationPort,
    resultStore,
    recordStore,
    model,
    artifactStore,
    transactionUnit,
    review,
    now: () => new Date(TIMESTAMP),
  } as unknown as RiskCandidateFinalizationServiceOptionsV1;

  return {
    service: new RiskCandidateFinalizationService(options),
    options,
    calls,
    artifacts,
    rows,
    seedRow,
    putValue,
  };
};

// ---------------------------------------------------------------------- 合成命令

const rawAssembleCommand = (overrides: Record<string, unknown> = {}) => ({
  commandId: "command-assemble",
  idempotencyKey: "idempotency-assemble",
  projectId: PROJECT,
  actorId: ACTOR,
  issuedAt: TIMESTAMP,
  kind: "assemble-and-infer",
  authorization: governanceAuthorization(),
  payload: {
    workItemRef,
    retrievalArtifactSetRef,
    modelDeploymentRef: versionRef("model-deployment"),
    promptTemplateRef: versionRef("prompt-template"),
  },
  ...overrides,
});

const assembleCommand = (
  overrides: Record<string, unknown> = {},
): IdentificationAnalysisCommandV1 =>
  IdentificationAnalysisCommandV1Schema.parse(rawAssembleCommand(overrides));

const repairCommand = (overrides: Record<string, unknown> = {}) =>
  IdentificationAnalysisCommandV1Schema.parse({
    commandId: "command-repair",
    idempotencyKey: "idempotency-repair",
    projectId: PROJECT,
    actorId: ACTOR,
    issuedAt: TIMESTAMP,
    kind: "repair-and-validate",
    authorization: governanceAuthorization(),
    payload: {
      candidateSetRef: {
        kind: "identification-candidate-set",
        reference: versionRef("candidate-set-c22"),
      },
      repairPolicyRef: versionRef("repair-policy"),
      ruleValidationPolicyRef: versionRef("rule-validation-policy"),
    },
    ...overrides,
  });

const mergeCommand = (
  overrides: Record<string, unknown> = {},
): IdentificationFinalizationCommandV1 =>
  IdentificationFinalizationCommandV1Schema.parse({
    commandId: "command-merge",
    idempotencyKey: "idempotency-merge",
    projectId: PROJECT,
    actorId: ACTOR,
    issuedAt: TIMESTAMP,
    kind: "merge-run-candidates",
    authorization: governanceAuthorization(),
    payload: {
      workPlanRef,
      validatedCandidateSetRefs: [validatedSetRef("validated-set-a")],
      mergePolicyRef: versionRef("merge-policy"),
    },
    ...overrides,
  });

const routeCommand = (
  overrides: Record<string, unknown> = {},
): IdentificationFinalizationCommandV1 =>
  IdentificationFinalizationCommandV1Schema.parse({
    commandId: "command-route",
    idempotencyKey: "idempotency-route",
    projectId: PROJECT,
    actorId: ACTOR,
    issuedAt: TIMESTAMP,
    kind: "route-acceptance",
    authorization: governanceAuthorization(),
    payload: {
      mergePlanRef: mergePlanRefValue,
      confidencePolicyRef: versionRef("confidence-policy"),
      forcedReviewPolicyRef: versionRef("forced-review-policy"),
    },
    ...overrides,
  });

const acceptCommand = (
  overrides: Record<string, unknown> = {},
): IdentificationFinalizationCommandV1 =>
  IdentificationFinalizationCommandV1Schema.parse({
    commandId: "command-accept",
    idempotencyKey: "idempotency-accept",
    projectId: PROJECT,
    actorId: ACTOR,
    issuedAt: TIMESTAMP,
    kind: "accept-groups",
    authorization: governanceAuthorization(),
    payload: {
      acceptanceRouteSetRef: acceptanceRouteSetRefValue,
      acceptedGroupRefs: [groupRefValue("group-1")],
      decisionRefs: [{ kind: "route-decision", reference: versionRef("route-decision-stub") }],
    },
    ...overrides,
  });

const failedError = (
  result: IdentificationAnalysisResultV1 | IdentificationFinalizationResultV1,
) => (result.kind === "failed" ? result.error : undefined);

const blockedKindOf = (
  result: IdentificationAnalysisResultV1 | IdentificationFinalizationResultV1,
) => {
  const error = failedError(result);
  return error?.code === "BUSINESS_BLOCKED" ? error.blockerKind : undefined;
};

// ============================================================ 严格 Schema 与身份

describe("C22 严格 Schema 与身份", () => {
  it("候选集拒绝契约外字段与重复候选版本", () => {
    expect(RiskCandidateSetV1Schema.safeParse(candidateSetValue()).success).toBe(true);
    expect(
      RiskCandidateSetV1Schema.safeParse(candidateSetValue({ extraField: "契约外字段" })).success,
    ).toBe(false);
    expect(
      RiskCandidateSetV1Schema.safeParse(
        candidateSetValue({ candidates: [candidateValue(), candidateValue()] }),
      ).success,
    ).toBe(false);
    expect(
      RiskCandidateSetV1Schema.safeParse(
        candidateSetValue({
          candidates: [candidateValue(), candidateValue({ candidateVersion: 2 })],
        }),
      ).success,
    ).toBe(true);
    expect(
      RiskCandidateSetV1Schema.safeParse(
        candidateSetValue({ candidates: [candidateValue({ extraCandidateField: "x" })] }),
      ).success,
    ).toBe(false);
    expect(
      RiskCandidateSetV1Schema.safeParse(
        candidateSetValue({
          candidates: [candidateValue({ output: candidateOutput({ extra: 1 }) })],
        }),
      ).success,
    ).toBe(false);
  });

  it("登记行按结果种类限定引用形状", () => {
    const groupRow = {
      ...resultRowBase("identification-group", "identification-group:group-1", DIGEST_C),
      workPlanRef,
      groupRef: groupRefValue("group-1"),
    };
    expect(RiskCandidateFinalizationResultRowV1Schema.safeParse(groupRow).success).toBe(true);
    expect(
      RiskCandidateFinalizationResultRowV1Schema.safeParse({
        ...groupRow,
        workPlanRef: undefined,
      }).success,
    ).toBe(false);
    expect(
      RiskCandidateFinalizationResultRowV1Schema.safeParse({
        ...groupRow,
        workItemRef,
      }).success,
    ).toBe(false);

    const candidateSetRow = {
      ...resultRowBase("candidate-set", "identification-candidate-set:c22", DIGEST_A),
      workItemRef,
      modelContextArtifactSetRef,
      candidateSetRef: {
        kind: "identification-candidate-set",
        reference: versionRef("identification-candidate-set:c22"),
      },
    };
    expect(RiskCandidateFinalizationResultRowV1Schema.safeParse(candidateSetRow).success).toBe(
      true,
    );
    expect(
      RiskCandidateFinalizationResultRowV1Schema.safeParse({
        ...candidateSetRow,
        mergePlanRef: mergePlanRefValue,
      }).success,
    ).toBe(false);
    expect(
      RiskCandidateFinalizationResultRowV1Schema.safeParse({
        ...candidateSetRow,
        resultKind: "merge-plan",
      }).success,
    ).toBe(false);
    expect(RiskCandidateFinalizationResultRowV1Schema.safeParse(mergePlanRow()).success).toBe(true);
  });

  it("校验策略只接受封闭可修正集合内的原因码", () => {
    expect(RiskCandidateValidationPolicyV1Schema.safeParse(validationPolicyValue()).success).toBe(
      true,
    );
    expect(
      RiskCandidateValidationPolicyV1Schema.safeParse(
        validationPolicyValue({ repairableReasonCodes: [REASON.authorizationRevoked] }),
      ).success,
    ).toBe(false);
    expect(
      RiskCandidateValidationPolicyV1Schema.safeParse(
        validationPolicyValue({ repairableReasonCodes: [REASON.ruleConflict] }),
      ).success,
    ).toBe(false);
    expect(
      RiskCandidateValidationPolicyV1Schema.safeParse(
        validationPolicyValue({ repairableReasonCodes: [REASON.simulationViolation] }),
      ).success,
    ).toBe(false);
    expect(() => assertRepairableReasonCodes(validationPolicy())).not.toThrow();
    // Schema 已挡住越界策略；断言函数对绕过 Schema 的组合仍按封闭集合拒绝。
    expect(() =>
      assertRepairableReasonCodes({
        ...validationPolicy(),
        repairableReasonCodes: [REASON.ruleConflict],
      }),
    ).toThrow(TypeError);
  });

  it("合并与综合置信度权重必须归一", () => {
    expect(() => assertMergePolicyWeights(mergePolicy())).not.toThrow();
    expect(() =>
      assertMergePolicyWeights(
        mergePolicy({ weights: { processNode: 0.4, riskEvent: 0.4, evidence: 0.4 } }),
      ),
    ).toThrow(TypeError);
    expect(() => assertCompositeConfidenceWeights(confidencePolicy())).not.toThrow();
    expect(() =>
      assertCompositeConfidenceWeights(
        confidencePolicy({
          weights: {
            modelConfidence: 0.5,
            ruleConsistency: 0.3,
            simulationConstraint: 0.1,
            multiSourceMerge: 0.2,
          },
        }),
      ),
    ).toThrow(TypeError);
  });
});

// ============================================================== 确定性逐项校验

describe("C22 确定性逐项校验", () => {
  it("八项检查全部通过且校验结果不承载任何评分字段", () => {
    const evaluation = evaluateSet([{}]);
    const entry = evaluation.entries[0];
    expect(evaluation.disposition).toBe("accepted");
    expect(entry?.disposition).toBe("accepted");
    expect(entry?.checks.map((check) => check.checkId)).toEqual([
      CHECK.schema,
      CHECK.nodeBinding,
      CHECK.riskEvent,
      CHECK.relationEndpoints,
      CHECK.evidenceReachability,
      CHECK.mechanismApplicability,
      CHECK.ruleConsistency,
      CHECK.simulationConstraint,
    ]);
    expect(entry?.checks.every((check) => check.passed)).toBe(true);
    expect(entry?.checks.every((check) => check.reasonCode === REASON.accepted)).toBe(true);
    expect(entry?.candidateRef.reference).toEqual(versionRef("candidate-artifact-candidate-001"));
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      "candidateId",
      "candidateRef",
      "candidateVersion",
      "checks",
      "disposition",
    ]);
    expect(Object.keys(entry?.checks[0] ?? {}).sort()).toEqual([
      "checkId",
      "evidenceRefs",
      "passed",
      "reasonCode",
    ]);
    const frozen = RiskCandidateSetV1Schema.parse(candidateSetValue()).candidates[0];
    expect(frozen?.output).toEqual(candidateOutput());
    expect(frozen?.output.modelConfidence).toBe(0.31);
    expect(modelContext().retrievalEvidence[0]?.rankingSignal.fusionScore).toBe(0.93);
  });

  it("直接逐项校验以五项上下文派生的可见证据索引裁定", () => {
    const visible = buildVisibleEvidenceIndex(modelContext());
    expect(visible.sourceVersionKeys).toContain(`source-a\u0000v1`);
    const entry = evaluateCandidate({
      candidate: RiskCandidateV1Schema.parse(candidateValue()),
      candidateRef: versionRef("candidate-artifact-candidate-001"),
      modelContext: modelContext(),
      visible,
      policy: validationPolicy(),
    });
    expect(entry.disposition).toBe("accepted");
    expect(entry.checks).toHaveLength(8);
  });

  it("六字段空白值按输出 Schema 失败封闭，可修正而不终止", () => {
    // 六字段 Schema 本身会 trim，因此空白值只能来自未经 Schema 收口的输入；逐项校验必须
    // 独立发现它，而不是信任上游已通过 Schema。
    const candidate = {
      ...RiskCandidateV1Schema.parse(candidateValue()),
      output: { ...candidateOutput(), riskFactor: "   " },
    } as unknown as Parameters<typeof evaluateCandidate>[0]["candidate"];
    const entry = evaluateCandidate({
      candidate,
      candidateRef: versionRef("candidate-artifact-candidate-001"),
      modelContext: modelContext(),
      visible: buildVisibleEvidenceIndex(modelContext()),
      policy: validationPolicy(),
    });
    expect(checkOf(entry, CHECK.schema)?.passed).toBe(false);
    expect(checkOf(entry, CHECK.schema)?.reasonCode).toBe(REASON.schemaInvalid);
    expect(entry.disposition).toBe("repairable");
    expect(entry.checks.filter((check) => !check.passed)).toHaveLength(1);
  });

  it("证据定位不在冻结五项上下文中即不可达", () => {
    const evaluation = evaluateSet([
      { output: candidateOutput({ evidenceLocator: { sourceSegmentId: "segment-outside" } }) },
    ]);
    const entry = evaluation.entries[0] as CandidateValidationEntryV1;
    expect(checkOf(entry, CHECK.evidenceReachability)?.passed).toBe(false);
    expect(checkOf(entry, CHECK.evidenceReachability)?.reasonCode).toBe(REASON.evidenceNotFrozen);
    expect(checkOf(entry, CHECK.mechanismApplicability)?.reasonCode).toBe(
      REASON.mechanismNotApplicable,
    );
    expect(entry.checks.every((check) => !check.passed)).toBe(false);
    expect(entry.disposition).toBe("repairable");
  });

  it("定位命中但没有同发布适用机理条目时机理不适用", () => {
    const evaluation = evaluateSet([
      { output: candidateOutput({ evidenceLocator: { sourceSegmentId: SEGMENT_PROCESS } }) },
    ]);
    const entry = evaluation.entries[0] as CandidateValidationEntryV1;
    expect(checkOf(entry, CHECK.evidenceReachability)?.passed).toBe(true);
    expect(checkOf(entry, CHECK.mechanismApplicability)?.passed).toBe(false);
    expect(checkOf(entry, CHECK.mechanismApplicability)?.reasonCode).toBe(
      REASON.mechanismNotApplicable,
    );
    expect(entry.disposition).toBe("repairable");
  });

  it("关系两端相同视为端点缺失", () => {
    const evaluation = evaluateSet([
      {
        output: candidateOutput({
          riskElementRelations: [
            { sourceElement: "掌子面", relation: "作用关系", targetElement: "掌子面" },
          ],
        }),
      },
    ]);
    const entry = evaluation.entries[0] as CandidateValidationEntryV1;
    expect(checkOf(entry, CHECK.relationEndpoints)?.passed).toBe(false);
    expect(checkOf(entry, CHECK.relationEndpoints)?.reasonCode).toBe(
      REASON.relationEndpointMissing,
    );
    expect(entry.disposition).toBe("repairable");
  });

  it("机理或关系类型未覆盖以及仿真来源缺失都按终止封闭", () => {
    const missingMechanism = evaluateSet([{}], {
      requiredMechanismTypes: ["支护结构失效"],
    });
    const mechanismEntry = missingMechanism.entries[0] as CandidateValidationEntryV1;
    expect(checkOf(mechanismEntry, CHECK.ruleConsistency)?.passed).toBe(false);
    expect(checkOf(mechanismEntry, CHECK.ruleConsistency)?.reasonCode).toBe(REASON.ruleConflict);
    expect(missingMechanism.disposition).toBe("terminal");

    const missingRelation = evaluateSet([{}], { requiredRelationTypes: ["受力依赖关系"] });
    expect(
      checkOf(missingRelation.entries[0] as CandidateValidationEntryV1, CHECK.ruleConsistency)
        ?.reasonCode,
    ).toBe(REASON.ruleConflict);
    expect(missingRelation.disposition).toBe("terminal");

    const missingSimulationSource = evaluateSet([{}], {
      simulationConstraint: {
        policyRef: versionRef("simulation-policy"),
        requiredSourceVersionRefs: [
          { kind: "source-version", reference: versionRef("source-missing") },
        ],
      },
    });
    const simulationEntry = missingSimulationSource.entries[0] as CandidateValidationEntryV1;
    expect(checkOf(simulationEntry, CHECK.simulationConstraint)?.passed).toBe(false);
    expect(checkOf(simulationEntry, CHECK.simulationConstraint)?.reasonCode).toBe(
      REASON.simulationViolation,
    );
    expect(missingSimulationSource.disposition).toBe("terminal");

    const satisfiedSimulation = evaluateSet([{}], {
      simulationConstraint: {
        policyRef: versionRef("simulation-policy"),
        requiredSourceVersionRefs: [{ kind: "source-version", reference: versionRef("source-a") }],
      },
    });
    expect(
      checkOf(
        satisfiedSimulation.entries[0] as CandidateValidationEntryV1,
        CHECK.simulationConstraint,
      )?.passed,
    ).toBe(true);
    expect(satisfiedSimulation.disposition).toBe("accepted");
  });

  it("每项检查的失败原因码取自稳定失败码表", () => {
    const failing = [
      { nodeId: RELATED_NODE_ID },
      { output: candidateOutput({ riskEvent: "扩径切削扰动" }) },
      {
        output: candidateOutput({
          riskElementRelations: [
            { sourceElement: "掌子面", relation: "作用关系", targetElement: "掌子面" },
          ],
        }),
      },
      { output: candidateOutput({ evidenceLocator: { sourceSegmentId: "segment-outside" } }) },
    ];
    for (const overrides of failing) {
      const entry = evaluateSet([overrides]).entries[0] as CandidateValidationEntryV1;
      for (const check of entry.checks) {
        if (check.passed) continue;
        expect(check.reasonCode).toBe(FAILURE_REASON_OF_CHECK[check.checkId]);
      }
    }
  });
});

// ============================================================ 可修正与终止分类

describe("C22 可修正与终止分类", () => {
  it("只有封闭可修正集合内的失败可修正，其余一律终止", () => {
    const repairable = evaluateSet([{ nodeId: RELATED_NODE_ID }]);
    expect(repairable.entries[0]?.disposition).toBe("repairable");
    expect(repairable.disposition).toBe("repairable");

    const terminal = evaluateSet([{}], { requiredRelationTypes: ["受力依赖关系"] });
    expect(terminal.entries[0]?.disposition).toBe("terminal");
    expect(terminal.disposition).toBe("terminal");

    const narrowed = evaluateSet([{ nodeId: RELATED_NODE_ID }], {
      repairableReasonCodes: [REASON.evidenceNotFrozen],
    });
    expect(narrowed.entries[0]?.disposition).toBe("terminal");

    expect(() =>
      assertRepairableReasonCodes({
        ...validationPolicy(),
        repairableReasonCodes: [REASON.simulationViolation],
      }),
    ).toThrow(TypeError);
  });

  it("集合判定只在全部接受时为接受，任一终止即终止", () => {
    const accepted = evaluateSet([{}, { output: candidateOutput({ riskEvent: "盾体变形超限" }) }]);
    expect(accepted.disposition).toBe("accepted");
    expect(accepted.entries.map((entry) => entry.disposition)).toEqual(["accepted", "accepted"]);

    const repairable = evaluateSet([{}, { nodeId: RELATED_NODE_ID }], {
      requiredRelationTypes: ["作用关系"],
    });
    expect(repairable.entries.map((entry) => entry.disposition)).toEqual([
      "accepted",
      "repairable",
    ]);
    expect(repairable.disposition).toBe("repairable");

    const terminal = evaluateSet(
      [
        {
          output: candidateOutput({
            riskElementRelations: [
              { sourceElement: "扩挖机构", relation: "受力依赖关系", targetElement: "掌子面" },
            ],
          }),
        },
        { output: candidateOutput({ riskEvent: "盾体变形超限" }) },
      ],
      { requiredRelationTypes: ["受力依赖关系"] },
    );
    expect(terminal.entries.map((entry) => entry.disposition)).toEqual(["accepted", "terminal"]);
    expect(terminal.disposition).toBe("terminal");
  });
});

// ================================================================ 三信号合并

describe("C22 三信号合并", () => {
  it("同节点、同风险事件与同证据集合的候选合并成组", () => {
    const groups = buildGroups(
      [
        [mergeCandidate(), [1, 0]],
        [
          mergeCandidate({
            candidateRef: versionRef("candidate-artifact-2"),
            candidateId: "candidate-002",
          }),
          [1, 0],
        ],
      ],
      mergePolicy(),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.disposition).toBe("merged");
    expect(groups[0]?.members.map((member) => member.candidateId)).toEqual([
      "candidate-001",
      "candidate-002",
    ]);
    expect(groups[0]?.mergeEvidence.processNode.satisfied).toBe(true);
    expect(groups[0]?.mergeEvidence.riskEvent.satisfied).toBe(true);
    expect(groups[0]?.mergeEvidence.evidence.satisfied).toBe(true);
    expect(groups[0]?.mergeEvidence.aggregate.satisfied).toBe(true);
  });

  it("节点不一致是硬门槛，只有显式列入相关节点才放行", () => {
    const pairs = [
      [mergeCandidate(), [1, 0]],
      [
        mergeCandidate({
          candidateRef: versionRef("candidate-artifact-2"),
          candidateId: "candidate-002",
          nodeId: RELATED_NODE_ID,
        }),
        [1, 0],
      ],
    ] as const;
    const gated = buildGroups(pairs, mergePolicy());
    expect(gated).toHaveLength(2);
    expect(gated.every((group) => group.disposition === "no-duplicate")).toBe(true);
    expect(gated.every((group) => group.members.length === 1)).toBe(true);
    expect(gated.flatMap((group) => group.members)).toHaveLength(2);

    const halfListed = buildGroups(pairs, mergePolicy({ relatedNodeIds: [RELATED_NODE_ID] }));
    expect(halfListed[0]?.disposition).toBe("no-duplicate");

    const related = buildGroups(pairs, mergePolicy({ relatedNodeIds: [NODE_ID, RELATED_NODE_ID] }));
    expect(related).toHaveLength(1);
    expect(related[0]?.disposition).toBe("merged");
    expect(related[0]?.mergeEvidence.processNode.satisfied).toBe(true);
  });

  it("相似度低于阈值或证据不相交时只产生单成员跳过组", () => {
    const lowCosine = buildGroups(
      [
        [mergeCandidate(), [1, 0]],
        [
          mergeCandidate({
            candidateRef: versionRef("candidate-artifact-2"),
            candidateId: "candidate-002",
          }),
          [0, 1],
        ],
      ],
      mergePolicy(),
    );
    expect(lowCosine).toHaveLength(2);
    expect(lowCosine.every((group) => group.disposition === "no-duplicate")).toBe(true);
    expect(lowCosine.every((group) => group.members.length === 1)).toBe(true);

    const disjointEvidence = buildGroups(
      [
        [mergeCandidate(), [1, 0]],
        [
          mergeCandidate({
            candidateRef: versionRef("candidate-artifact-2"),
            candidateId: "candidate-002",
            sourceSegmentIds: ["segment-other"],
          }),
          [1, 0],
        ],
      ],
      mergePolicy(),
    );
    expect(disjointEvidence).toHaveLength(2);
    expect(disjointEvidence.every((group) => group.disposition === "no-duplicate")).toBe(true);
    expect(disjointEvidence.every((group) => group.members.length === 1)).toBe(true);
  });

  it("单成员组恒为 no-duplicate，组 Schema 强制显式跳过原因", () => {
    const single = buildGroups([[mergeCandidate(), [1, 0]]], mergePolicy());
    expect(single).toHaveLength(1);
    expect(single[0]?.members).toHaveLength(1);
    expect(single[0]?.disposition).toBe("no-duplicate");

    const singleMember = [groupMemberValue("candidate-001", 1)];
    expect(
      IdentificationGroupV1Schema.safeParse(
        groupValue({ disposition: "no-duplicate", members: singleMember }),
      ).success,
    ).toBe(false);
    expect(
      IdentificationGroupV1Schema.safeParse(
        groupValue({
          disposition: "no-duplicate",
          skipReasonCode: MERGE_SKIP_REASON_CODE_V1,
          members: singleMember,
        }),
      ).success,
    ).toBe(true);
    expect(
      IdentificationGroupV1Schema.safeParse(
        groupValue({ disposition: "merged", skipReasonCode: MERGE_SKIP_REASON_CODE_V1 }),
      ).success,
    ).toBe(false);
    expect(MERGE_SKIP_REASON_CODE_V1).toBe("no-duplicate");
  });

  it("maxGroupMembers 限制团大小且不丢候选", () => {
    const three = [1, 2, 3].map((index) =>
      mergeCandidate({
        candidateRef: versionRef(`candidate-artifact-${index}`),
        candidateId: `candidate-00${index}`,
      }),
    );
    const groups = buildGroups(
      three.map((candidate) => [candidate, [1, 0]] as const),
      mergePolicy({ maxGroupMembers: 2 }),
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]?.members).toHaveLength(2);
    expect(groups[0]?.disposition).toBe("merged");
    expect(groups[1]?.members).toHaveLength(1);
    expect(groups[1]?.disposition).toBe("no-duplicate");
    expect(groups.flatMap((group) => group.members)).toHaveLength(3);
  });

  it("打乱输入顺序得到相同分组与升序成员", () => {
    const base = [
      [mergeCandidate(), [1, 0]],
      [
        mergeCandidate({
          candidateRef: versionRef("candidate-artifact-3"),
          candidateId: "candidate-003",
          sourceSegmentIds: ["segment-other"],
        }),
        [1, 0],
      ],
      [
        mergeCandidate({
          candidateRef: versionRef("candidate-artifact-2"),
          candidateId: "candidate-002",
        }),
        [1, 0],
      ],
    ] as const;
    const shuffled = [base[1], base[2], base[0]] as const;
    const first = buildGroups(base, mergePolicy());
    const second = buildGroups(shuffled, mergePolicy());
    expect(groupSignature(second)).toEqual(groupSignature(first));
    expect(first[0]?.members.map((member) => member.candidateRef.entityId)).toEqual([
      "candidate-artifact-1",
      "candidate-artifact-2",
    ]);
    expect(first[1]?.members.map((member) => member.candidateRef.entityId)).toEqual([
      "candidate-artifact-3",
    ]);
  });
});

// =============================================================== 综合置信度

describe("C22 综合置信度", () => {
  it("四类依据恒定齐全，完全可比时按权重可重放", () => {
    const confidence = computeConfidence(confidenceInput());
    expect(confidence.basis.map((basis) => basis.source)).toEqual([...CONFIDENCE_BASIS_SOURCES_V1]);
    expect(confidence.basis.every((basis) => basis.available)).toBe(true);
    expect(confidence.value).toBeCloseTo(0.4 * 0.85 + 0.3 * 0.75 + 0.1 + 0.2, 6);
    expect(confidence.value).toBeGreaterThanOrEqual(0);
    expect(confidence.value).toBeLessThanOrEqual(1);
    expect(computeConfidence(confidenceInput())).toEqual(confidence);
  });

  it("必需依据缺失即阻断，不产生默认权重", () => {
    const outcome = calculateCompositeConfidence(
      confidenceInput({
        disposition: "no-duplicate",
        policy: confidencePolicy({ requiredBasis: ["multi-source-merge"] }),
      }),
    );
    expect(outcome.kind).toBe("blocked");
    expect(outcome.kind === "blocked" ? outcome.reasonCode : "").toContain("multi-source-merge");
  });

  it("block 语义下任一依据缺失即阻断，exclude-and-renormalize 只按可用权重归一", () => {
    const blocked = calculateCompositeConfidence(
      confidenceInput({
        simulationConstraintDeclared: false,
        policy: confidencePolicy({ missingBasisBehavior: "block" }),
      }),
    );
    expect(blocked.kind).toBe("blocked");

    const renorm = computeConfidence(
      confidenceInput({
        simulationConstraintDeclared: false,
        policy: confidencePolicy({ missingBasisBehavior: "exclude-and-renormalize" }),
      }),
    );
    const simulation = renorm.basis.find((basis) => basis.source === "simulation-constraint");
    expect(simulation?.available).toBe(false);
    expect(simulation?.contribution).toBe(0);
    expect(simulation?.weight).toBe(0.1);
    expect(
      renorm.basis
        .filter((basis) => basis.available)
        .reduce((total, basis) => total + basis.contribution, 0),
    ).toBeCloseTo(1, 3);
    expect(renorm.value).toBeCloseTo(0.85, 6);
  });

  it("未参与的依据不会被当作可用值，模型置信度取均值而非排序分数", () => {
    const unrelated = computeConfidence(
      confidenceInput({
        disposition: "no-duplicate",
        memberCount: 2,
        policy: confidencePolicy({ missingBasisBehavior: "exclude-and-renormalize" }),
      }),
    );
    const merge = unrelated.basis.find((basis) => basis.source === "multi-source-merge");
    expect(merge?.available).toBe(false);
    expect(merge?.value).toBe(0);
    const model = unrelated.basis.find((basis) => basis.source === "model-confidence");
    expect(model?.value).toBeCloseTo(0.85, 6);
    expect(unrelated.basis.map((basis) => basis.source)).toEqual([...CONFIDENCE_BASIS_SOURCES_V1]);
  });
});

// ========================================================= 强制复核与决定语义

describe("C22 强制复核与决定语义", () => {
  it("低于阈值、合并歧义与策略强制标记各自路由人工复核", () => {
    expect(
      forcedReviewReasonFor({
        confidence: compositeConfidence(0.9),
        mergeEvidence: mergeEvidence(),
        disposition: "merged",
        policy: forcedReviewPolicy(),
      }),
    ).toBe(FORCED_REVIEW_REASON_CODES_V1.lowConfidence);

    expect(
      forcedReviewReasonFor({
        confidence: compositeConfidence(0.99),
        mergeEvidence: mergeEvidence({ riskEventSatisfied: false }),
        disposition: "merged",
        policy: forcedReviewPolicy(),
      }),
    ).toBe(FORCED_REVIEW_REASON_CODES_V1.mergeAmbiguity);

    expect(
      forcedReviewReasonFor({
        confidence: compositeConfidence(0.99),
        mergeEvidence: mergeEvidence({ evidenceSatisfied: false }),
        disposition: "merged",
        policy: forcedReviewPolicy({ forcedReviewReasonCodes: [] }),
      }),
    ).toBe(FORCED_REVIEW_REASON_CODES_V1.mergeAmbiguity);

    expect(
      forcedReviewReasonFor({
        confidence: compositeConfidence(0.99),
        mergeEvidence: mergeEvidence({ evidenceSatisfied: false }),
        disposition: "merged",
        policy: forcedReviewPolicy({ forcedReviewReasonCodes: ["unrelated-code"] }),
      }),
    ).toBeUndefined();

    expect(
      forcedReviewReasonFor({
        confidence: compositeConfidence(0.99),
        mergeEvidence: mergeEvidence(),
        disposition: "merged",
        policy: forcedReviewPolicy({
          forcedReviewReasonCodes: [FORCED_REVIEW_REASON_CODES_V1.policyFlag],
        }),
      }),
    ).toBe(FORCED_REVIEW_REASON_CODES_V1.policyFlag);

    expect(
      forcedReviewReasonFor({
        confidence: compositeConfidence(0.99),
        mergeEvidence: mergeEvidence({ riskEventSatisfied: false }),
        disposition: "no-duplicate",
        policy: forcedReviewPolicy(),
      }),
    ).toBeUndefined();

    expect(
      forcedReviewReasonFor({
        confidence: compositeConfidence(0.99),
        mergeEvidence: mergeEvidence(),
        disposition: "merged",
        policy: forcedReviewPolicy(),
      }),
    ).toBeUndefined();
  });

  it("真实合并组的歧义证据直接触发强制复核", () => {
    const groups = buildGroups(
      [
        [mergeCandidate(), [1, 0]],
        [
          mergeCandidate({
            candidateRef: versionRef("candidate-artifact-2"),
            candidateId: "candidate-002",
            sourceSegmentIds: ["segment-other"],
          }),
          [1, 0],
        ],
      ],
      mergePolicy({ groupThreshold: 0.5 }),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.disposition).toBe("merged");
    expect(groups[0]?.mergeEvidence.evidence.satisfied).toBe(false);
    expect(groups[0]?.mergeEvidence.aggregate.satisfied).toBe(true);
    const evidence = groups[0]?.mergeEvidence;
    expect(
      forcedReviewReasonFor({
        confidence: compositeConfidence(0.99),
        mergeEvidence: evidence as GroupMergeEvidenceV1,
        disposition: "merged",
        policy: forcedReviewPolicy(),
      }),
    ).toBe(FORCED_REVIEW_REASON_CODES_V1.mergeAmbiguity);
  });

  it("决定语义唯一映射到继续、改道与阻断", () => {
    expect(IdentificationGroupDecisionKindV1Schema.options.slice().sort()).toEqual(
      [
        "approve-revised-candidate",
        "approve-unchanged",
        "confirm-merge",
        "keep-separate",
        "reject",
        "return-upstream",
      ].sort(),
    );
    for (const kind of ["accept-unchanged", "approve-unchanged", "confirm-merge"]) {
      expect(decisionDispositionFor(kind)).toBe("continue");
    }
    for (const kind of ["approve-revised-candidate", "keep-separate"]) {
      expect(decisionDispositionFor(kind)).toBe("reroute");
    }
    for (const kind of ["reject", "return-upstream", "unknown-decision"]) {
      expect(decisionDispositionFor(kind)).toBe("blocked");
    }
  });
});

// =========================================================== 服务接入（端口驱动）

describe("C22 服务接入（端口驱动）", () => {
  it("缺失必需依赖时构造函数拒绝组合", () => {
    const harness = makeHarness();
    expect(() => new RiskCandidateFinalizationService(harness.options)).not.toThrow();
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
      expect(
        () =>
          new RiskCandidateFinalizationService({
            ...harness.options,
            [key]: undefined,
          } as unknown as RiskCandidateFinalizationServiceOptionsV1),
      ).toThrow(TypeError);
    }
  });

  it("C02 命令解析失败时返回 UNSUPPORTED_CONTRACT 且不触达任何端口", async () => {
    const harness = makeHarness();
    const unknownBranch = await harness.service.analyze({ kind: "unknown-branch" } as never);
    const missingPayload = await harness.service.analyze(
      rawAssembleCommand({ payload: { workItemRef } }) as never,
    );
    const unknownFinalization = await harness.service.finalize({
      kind: "unknown-branch",
    } as never);
    for (const result of [unknownBranch, missingPayload, unknownFinalization]) {
      expect(result.kind).toBe("failed");
      expect(failedError(result)?.code).toBe("UNSUPPORTED_CONTRACT");
    }
    expect(harness.calls.modelContextReads).toBe(0);
    expect(harness.calls.workPlanReads).toBe(0);
    expect(harness.calls.registerCalls).toBe(0);
  });

  it("分支能力未授权时命令在 Schema 层即被拒绝", async () => {
    const harness = makeHarness();
    const command = rawAssembleCommand({
      authorization: authorization(["risk-identification.read"]),
    });
    expect(IdentificationAnalysisCommandV1Schema.safeParse(command).success).toBe(false);
    const result = await harness.service.analyze(command as never);
    expect(result.kind).toBe("failed");
    expect(failedError(result)?.code).toBe("UNSUPPORTED_CONTRACT");
    expect(harness.calls.modelContextReads).toBe(0);
    expect(harness.calls.generateCalls).toBe(0);
  });

  it("当前授权复验失败时每个分支都在读端口之前返回 AUTHORIZATION_DENIED", async () => {
    const harness = makeHarness({ verifyCurrent: async () => undefined });
    const results = [
      await harness.service.analyze(assembleCommand()),
      await harness.service.analyze(repairCommand()),
      await harness.service.finalize(mergeCommand()),
      await harness.service.finalize(routeCommand()),
      await harness.service.finalize(acceptCommand()),
    ];
    for (const result of results) {
      expect(result.kind).toBe("failed");
      expect(failedError(result)?.code).toBe("AUTHORIZATION_DENIED");
    }
    expect(harness.calls.modelContextReads).toBe(0);
    expect(harness.calls.workPlanReads).toBe(0);
    expect(harness.calls.resultReads).toBe(0);
    expect(harness.calls.generateCalls).toBe(0);
    expect(harness.calls.registerCalls).toBe(0);
  });

  it("自动路线按路线中的组与系统决定逐项匹配并原子写入记录和事件", async () => {
    const authorizationChecks = new Map<string, number>();
    const harness = makeHarness({
      verifyCurrent: async ({ invocationId }) => {
        const count = (authorizationChecks.get(invocationId) ?? 0) + 1;
        authorizationChecks.set(invocationId, count);
        return invocationId === "command-accept-revoked" && count === 2
          ? undefined
          : governanceAuthorization();
      },
      recordInsertOutcomes: [
        { kind: "inserted" },
        { kind: "conflict", detailCode: "standardized-risk-record-payload-mismatch" },
      ],
    });
    const routeSet = AcceptanceRouteSetV1Schema.parse(routeSetValue());
    const route = routeSet.routes[0];
    if (route?.routeKind !== "automatic") throw new Error("automatic route fixture required");
    const candidateArtifactRef = harness.putValue(
      "candidate-artifact-candidate-001",
      RiskCandidateV1Schema.parse(candidateValue()),
    );
    const group = IdentificationGroupV1Schema.parse(
      groupValue({
        disposition: "no-duplicate",
        skipReasonCode: MERGE_SKIP_REASON_CODE_V1,
        members: [
          {
            ...groupMemberValue("candidate-001", 1),
            candidateRef: candidateArtifactRef,
          },
        ],
      }),
    );
    harness.seedRow(acceptanceRouteSetRow(), routeSet);
    harness.seedRow(
      {
        ...resultRowBase(
          "route-decision",
          route.routeDecisionRef.reference.entityId,
          route.routeDecisionRef.reference.versionId,
        ),
        workPlanRef,
        groupRef: route.groupRef,
        routeDecisionRef: route.routeDecisionRef,
      },
      {
        schemaVersion: "1",
        projectId: PROJECT,
        workPlanRef,
        inputSnapshotRef,
        mergePlanRef: mergePlanRefValue,
        groupId: route.groupId,
        groupVersionId: route.groupVersionId,
        groupRef: route.groupRef,
        routeDecisionRef: route.routeDecisionRef,
        decision: "accept-unchanged",
        compositeConfidence: route.compositeConfidence,
        confidencePolicyRef: versionRef("confidence-policy"),
        forcedReviewPolicyRef: versionRef("forced-review-policy"),
        decidedAt: TIMESTAMP,
      },
    );
    harness.seedRow(
      {
        ...resultRowBase(
          "identification-group",
          route.groupRef.reference.entityId,
          route.groupRef.reference.versionId,
        ),
        workPlanRef,
        groupRef: route.groupRef,
      },
      group,
    );

    const result = await harness.service.finalize(
      acceptCommand({
        payload: {
          acceptanceRouteSetRef: acceptanceRouteSetRefValue,
          acceptedGroupRefs: [route.groupRef],
          decisionRefs: [route.routeDecisionRef],
        },
      }),
    );

    expect(result.kind).toBe("succeeded");
    expect(result.kind === "succeeded" ? result.result.kind : undefined).toBe("accepted");
    expect(harness.calls.recordInsertCalls).toBe(1);
    expect(harness.calls.transactionCalls).toBe(1);
    expect(harness.calls.issueBranchCalls).toBe(0);
    expect(harness.calls.verifyCurrentCalls).toBe(2);

    const replay = await harness.service.finalize(
      acceptCommand({
        payload: {
          acceptanceRouteSetRef: acceptanceRouteSetRefValue,
          acceptedGroupRefs: [route.groupRef],
          decisionRefs: [route.routeDecisionRef],
        },
      }),
    );
    expect(replay.kind).toBe("succeeded");
    expect(replay.kind === "succeeded" ? replay.result.kind : undefined).toBe("accepted");
    expect(harness.calls.recordInsertCalls).toBe(1);
    expect(harness.calls.transactionCalls).toBe(2);
    expect(harness.calls.verifyCurrentCalls).toBe(4);

    const conflict = await harness.service.finalize(
      acceptCommand({
        commandId: "command-accept-conflict",
        idempotencyKey: "idempotency-accept-conflict",
        payload: {
          acceptanceRouteSetRef: acceptanceRouteSetRefValue,
          acceptedGroupRefs: [route.groupRef],
          decisionRefs: [route.routeDecisionRef],
        },
      }),
    );
    expect(conflict).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    expect(blockedKindOf(conflict)).toBe("standardized-risk-record-payload-mismatch");
    expect(harness.calls.recordInsertCalls).toBe(2);

    const revoked = await harness.service.finalize(
      acceptCommand({
        commandId: "command-accept-revoked",
        idempotencyKey: "idempotency-accept-revoked",
        payload: {
          acceptanceRouteSetRef: acceptanceRouteSetRefValue,
          acceptedGroupRefs: [route.groupRef],
          decisionRefs: [route.routeDecisionRef],
        },
      }),
    );
    expect(revoked).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    expect(harness.calls.recordInsertCalls).toBe(2);
  });

  it("assemble-and-infer 模型失败时返回映射的技术错误且零登记", async () => {
    const harness = makeHarness({
      modelOutcome: {
        kind: "failed",
        error: ModuleErrorV1Schema.parse({
          stageCode: "risk-candidate-model.generate",
          occurredAt: TIMESTAMP,
          causalRunId: "model-run-c22",
          code: "TERMINAL_FAILURE",
          category: "technical",
          retryable: false,
          diagnosticRef: diagnosisRef("model-diagnostic"),
        }),
      },
    });
    const result = await harness.service.analyze(assembleCommand());
    expect(result.kind).toBe("failed");
    expect(failedError(result)?.code).toBe("TERMINAL_FAILURE");
    expect(failedError(result)?.causalRunId).toBe("model-run-c22");
    expect(harness.calls.generateCalls).toBe(1);
    expect(harness.calls.registerCalls).toBe(0);
    expect(harness.artifacts.size).toBe(0);
  });

  it("assemble-and-infer 正常生成并登记不可变候选集", async () => {
    const harness = makeHarness();

    const result = await harness.service.analyze(assembleCommand());

    expect(result.kind).toBe("succeeded");
    expect(result.kind === "succeeded" ? result.result.kind : undefined).toBe("assemble-and-infer");
    expect(harness.calls.generateCalls).toBe(1);
    expect(harness.calls.registerCalls).toBe(1);
    expect(harness.calls.transactionCalls).toBe(1);
  });

  it("assemble-and-infer 超过冻结候选数量预算时失败关闭且零正式候选", async () => {
    const harness = makeHarness({
      modelOutcome: {
        kind: "succeeded",
        outputs: Array.from({ length: 9 }, (_, index) =>
          candidateOutput({ riskEvent: `掌子面失稳涌水-${index}` }),
        ),
        invocationId: "invocation-over-budget",
        rawResponseRef: diagnosisRef("raw-response-over-budget"),
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, outputBytes: 100 },
        elapsedMs: 5,
      },
    });

    const result = await harness.service.analyze(assembleCommand());

    expect(result).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    expect(blockedKindOf(result)).toBe(CANDIDATE_VALIDATION_REASON_CODES_V1.budgetExhausted);
    expect(harness.calls.registerCalls).toBe(0);
    expect(harness.artifacts.size).toBe(0);
  });

  it("repair-and-validate 遇到 terminal 候选时不修正或丢弃该候选", async () => {
    const harness = makeHarness({
      validationPolicyOverrides: { requiredRelationTypes: ["作用关系"] },
    });
    const candidateSetRef = {
      kind: "identification-candidate-set" as const,
      reference: versionRef("candidate-set-c22"),
    };
    const candidateSet = RiskCandidateSetV1Schema.parse(
      candidateSetValue({
        candidates: [
          candidateValue({
            candidateId: "candidate-terminal",
            output: candidateOutput({
              riskElementRelations: [
                { sourceElement: "扩挖机构", relation: "诱发", targetElement: "掌子面" },
              ],
            }),
          }),
          candidateValue({ candidateId: "candidate-repairable", nodeId: RELATED_NODE_ID }),
        ],
      }),
    );
    harness.seedRow(
      {
        ...resultRowBase(
          "candidate-set",
          candidateSetRef.reference.entityId,
          candidateSetRef.reference.versionId,
        ),
        workItemRef,
        modelContextArtifactSetRef,
        candidateSetRef,
      },
      candidateSet,
    );

    const result = await harness.service.analyze(repairCommand());

    expect(result).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    expect(blockedKindOf(result)).toBe(CANDIDATE_VALIDATION_REASON_CODES_V1.ruleConflict);
    expect(harness.calls.generateCalls).toBe(0);
    expect(harness.calls.registerCalls).toBe(0);
  });

  it("合并输入与冻结工作计划的已校验集合不一致时整体拒绝", async () => {
    const harness = makeHarness({
      workPlanValidatedRefs: [validatedSetRef("validated-set-plan")],
    });
    const result = await harness.service.finalize(
      mergeCommand({
        payload: {
          workPlanRef,
          validatedCandidateSetRefs: [validatedSetRef("validated-set-submitted")],
          mergePolicyRef: versionRef("merge-policy"),
        },
      }),
    );
    expect(result.kind).toBe("failed");
    expect(failedError(result)?.code).toBe("BUSINESS_BLOCKED");
    expect(blockedKindOf(result)).toBe("merge-input-incomplete");
    expect(harness.calls.resultReads).toBe(0);
    expect(harness.calls.embedCalls).toBe(0);
    expect(harness.calls.registerCalls).toBe(0);
  });

  it("路由缺少置信度策略时阻断且不产生复核请求与路线集", async () => {
    const harness = makeHarness({ missingConfidencePolicy: true });
    harness.seedRow(mergePlanRow(), MergePlanV1Schema.parse(mergePlanValue()));
    const result = await harness.service.finalize(routeCommand());
    expect(result.kind).toBe("failed");
    expect(failedError(result)?.code).toBe("BUSINESS_BLOCKED");
    expect(blockedKindOf(result)).toBe("routing-policy-missing");
    expect(harness.calls.reviewRequests).toBe(0);
    expect(harness.calls.decisionsRead).toBe(0);
    expect(harness.calls.registerCalls).toBe(0);
  });

  it("高置信组生成唯一自动验收路线且不创建人工复核任务", async () => {
    const harness = makeHarness({
      forcedReviewPolicyOverrides: { autoAcceptanceThreshold: 0.1 },
    });
    const validatedRef = validatedSetRef("validated-set-a");
    const groupRef = groupRefValue("group-1");
    harness.seedRow(
      mergePlanRow(),
      MergePlanV1Schema.parse(
        mergePlanValue({
          groups: [
            {
              groupId: "group-1",
              groupVersionId: DIGEST_C,
              groupRef,
              disposition: "merged",
              memberCount: 2,
            },
          ],
          evaluatedCandidateRefs: [
            contentRef("candidate-artifact-candidate-001"),
            contentRef("candidate-artifact-candidate-002"),
          ],
        }),
      ),
    );
    harness.seedRow(
      {
        ...resultRowBase(
          "identification-group",
          groupRef.reference.entityId,
          groupRef.reference.versionId,
        ),
        workPlanRef,
        groupRef,
      },
      IdentificationGroupV1Schema.parse(groupValue()),
    );
    harness.seedRow(
      {
        ...resultRowBase(
          "validated-candidate-set",
          validatedRef.reference.entityId,
          validatedRef.reference.versionId,
        ),
        workItemRef,
        candidateSetRef: {
          kind: "identification-candidate-set",
          reference: versionRef("candidate-set-c22"),
        },
        validatedCandidateSetRef: validatedRef,
      },
      validationSetValue(),
    );

    const result = await harness.service.finalize(routeCommand());

    expect(result.kind).toBe("succeeded");
    expect(result.kind === "succeeded" ? result.result.kind : undefined).toBe("route");
    expect(harness.calls.reviewRequests).toBe(0);
    expect(harness.calls.registerCalls).toBe(1);
    expect(harness.calls.transactionCalls).toBe(1);
  });

  it("提交组的验收决定错配时阻断且不写记录与事件", async () => {
    const harness = makeHarness();
    harness.seedRow(acceptanceRouteSetRow(), AcceptanceRouteSetV1Schema.parse(routeSetValue()));
    const result = await harness.service.finalize(
      acceptCommand({
        payload: {
          acceptanceRouteSetRef: acceptanceRouteSetRefValue,
          acceptedGroupRefs: [groupRefValue("group-1")],
          decisionRefs: [
            { kind: "route-decision", reference: versionRef("route-decision-unrelated") },
          ],
        },
      }),
    );
    expect(result.kind).toBe("failed");
    expect(failedError(result)?.code).toBe("BUSINESS_BLOCKED");
    expect(blockedKindOf(result)).toBe("automatic-decision-mismatch");
    expect(harness.calls.recordInsertCalls).toBe(0);
    expect(harness.calls.transactionCalls).toBe(0);
    expect(harness.calls.registerCalls).toBe(0);
  });
});

// ============================================================ C23 人工修订窄端口

/**
 * 修订场景全部为「合成样本、待甲方复核」：分组、候选集、已校验集、验证/证据快照与候选正文都是
 * 按 C22 既有 Schema 手工构造的一致合成事实，不对应任何真实工程资料或真实模型输出。
 */
const SET_DIGEST = DIGEST_B;
const VALIDATION_DIGEST = DIGEST_C;

const reviewAuthorization = () => authorization(["review-audit.decide"]);

const makeRevisionFixture = (
  harnessOverrides: HarnessOverrides = {},
  fixtureOptions: {
    readonly orphanThirdCandidate?: boolean;
    readonly sourceValidationOutsideMergePlan?: boolean;
  } = {},
) => {
  const harness = makeHarness(harnessOverrides);
  const groupRef = groupRefValue("group-1");
  const groupVersionId = DIGEST_C;
  const candidateSetRef = {
    kind: "identification-candidate-set" as const,
    reference: {
      entityId: `identification-candidate-set:${PROJECT}:${workItemRef.reference.entityId}`,
      versionId: SET_DIGEST,
    },
  };
  const validatedSetRef = {
    kind: "validated-candidate-set" as const,
    reference: {
      entityId: `validated-candidate-set:${PROJECT}:${candidateSetRef.reference.entityId}`,
      versionId: VALIDATION_DIGEST,
    },
  };
  const candidates = [
    RiskCandidateV1Schema.parse(candidateValue({ candidateId: "candidate-001" })),
    RiskCandidateV1Schema.parse(candidateValue({ candidateId: "candidate-002" })),
    ...(fixtureOptions.orphanThirdCandidate === true
      ? [RiskCandidateV1Schema.parse(candidateValue({ candidateId: "candidate-003" }))]
      : []),
  ];
  const candidateRefs = candidates.map((candidate) =>
    harness.putValue(`candidate-artifact-${candidate.candidateId}`, candidate),
  );
  const candidateSet = RiskCandidateSetV1Schema.parse(
    candidateSetValue({
      candidates,
      modelContextPayloadDigest: sha256CanonicalJson(modelContextValue()),
      candidateSetVersion: 1,
    }),
  );
  const candidateSetRow = harness.seedRow(
    {
      ...resultRowBase(
        "candidate-set",
        candidateSetRef.reference.entityId,
        candidateSetRef.reference.versionId,
      ),
      workItemRef,
      modelContextArtifactSetRef,
      candidateSetRef,
    },
    candidateSet,
  );
  const validatedSet = CandidateValidationSetV1Schema.parse({
    schemaVersion: "1",
    projectId: PROJECT,
    inputSnapshotRef,
    workItemRef,
    nodeId: NODE_ID,
    candidateSetRef: { kind: "content-artifact", reference: candidateSetRef.reference },
    candidateSetVersion: 1,
    policySetRef,
    validationPolicyRef: versionRef("validation-policy"),
    ruleValidationPolicyRef: versionRef("rule-validation-policy"),
    entries: candidates.map((candidate, index) => ({
      candidateId: candidate.candidateId,
      candidateVersion: candidate.candidateVersion,
      candidateRef: candidateRefs[index],
      disposition: "accepted",
      checks: [checkValue(`candidate-check-${index + 1}`, true)],
    })),
    acceptedCandidateRefs: candidateRefs,
    usage: candidateSetValue().usage,
    authorizationScopeDigest: DIGEST_A,
    authorizationContextRef,
    completedAt: TIMESTAMP,
  });
  harness.seedRow(
    {
      ...resultRowBase(
        "validated-candidate-set",
        validatedSetRef.reference.entityId,
        validatedSetRef.reference.versionId,
      ),
      workItemRef,
      candidateSetRef,
      validatedCandidateSetRef: validatedSetRef,
    },
    validatedSet,
  );
  // 合并组只包含前两个候选：第三个候选（如构造）在来源集与已校验集中但不是组成员。
  harness.seedRow(
    {
      ...resultRowBase("identification-group", groupRef.reference.entityId, groupVersionId),
      workPlanRef,
      groupRef,
    },
    IdentificationGroupV1Schema.parse(
      groupValue({
        members: candidates.slice(0, 2).map((candidate, index) => ({
          ...groupMemberValue(candidate.candidateId, candidate.candidateVersion),
          candidateRef: candidateRefs[index],
        })),
      }),
    ),
  );
  harness.seedRow(
    mergePlanRow(),
    MergePlanV1Schema.parse(
      mergePlanValue({
        validatedCandidateSetRefs:
          fixtureOptions.sourceValidationOutsideMergePlan === true
            ? [
                {
                  kind: "validated-candidate-set",
                  reference: versionRef("validated-set-other"),
                },
              ]
            : [validatedSetRef],
        groups: [
          {
            groupId: "group-1",
            groupVersionId,
            groupRef,
            disposition: "merged",
            memberCount: 2,
          },
        ],
        evaluatedCandidateRefs: candidateRefs.slice(0, 2),
      }),
    ),
  );
  const validationSnapshotRef = {
    kind: "validation-snapshot" as const,
    reference: versionRef(`validation-snapshot:${PROJECT}:group-1`, groupVersionId),
  };
  const evidenceSnapshotRef = {
    kind: "evidence-snapshot" as const,
    reference: versionRef(`evidence-snapshot:${PROJECT}:group-1`, groupVersionId),
  };
  const snapshotCommon = {
    schemaVersion: "1",
    projectId: PROJECT,
    inputSnapshotRef,
    workPlanRef,
    mergePlanRef: mergePlanRefValue,
    policySetRef,
    groupId: "group-1",
    groupVersionId,
    groupRef,
    authorizationScopeDigest: DIGEST_A,
    authorizationContextRef,
    createdAt: TIMESTAMP,
  };
  harness.seedRow(
    {
      ...resultRowBase(
        "validation-snapshot",
        validationSnapshotRef.reference.entityId,
        validationSnapshotRef.reference.versionId,
      ),
      workPlanRef,
      groupRef,
      validationSnapshotRef,
    },
    {
      ...snapshotCommon,
      snapshotKind: "validation",
      entries: [
        { entryKind: "validation", checkId: "check-1", passed: true, reasonCode: REASON.accepted },
      ],
    },
  );
  harness.seedRow(
    {
      ...resultRowBase(
        "evidence-snapshot",
        evidenceSnapshotRef.reference.entityId,
        evidenceSnapshotRef.reference.versionId,
      ),
      workPlanRef,
      groupRef,
      evidenceSnapshotRef,
    },
    {
      ...snapshotCommon,
      snapshotKind: "evidence",
      entries: [
        {
          entryKind: "evidence",
          candidateId: "candidate-001",
          candidateVersion: 1,
          candidateRef: candidateRefs[0],
          sourceSegmentId: SEGMENT_MECHANISM,
        },
        {
          entryKind: "evidence",
          candidateId: "candidate-001",
          candidateVersion: 1,
          candidateRef: candidateRefs[0],
          sourceSegmentId: SEGMENT_PROCESS,
        },
      ],
    },
  );

  const storedBody = async <T>(
    resultKind: "candidate-set" | "validated-candidate-set",
    ref: { readonly reference: VersionReference },
  ): Promise<T> => {
    const row = await harness.options.resultStore.readResult({
      projectId: PROJECT,
      resultKind,
      resultId: ref.reference.entityId,
      resultVersionId: ref.reference.versionId,
    });
    if (row === undefined) throw new Error(`missing ${resultKind} row`);
    const handle = await harness.options.artifactStore.open({
      artifactRef: row.artifactRef,
    } as never);
    const chunks: Uint8Array[] = [];
    for await (const chunk of handle.content) chunks.push(chunk);
    return JSON.parse(new TextDecoder().decode(chunks[0])) as T;
  };

  return {
    harness,
    candidates,
    candidateRefs,
    candidateSet,
    candidateSetRow,
    validatedSet,
    storedBody,
    revisionRequest: (overrides: Record<string, unknown> = {}) => ({
      projectId: PROJECT,
      actorId: ACTOR,
      commandId: "command-review",
      idempotencyKey: "idempotency-review",
      issuedAt: TIMESTAMP,
      invocationId: "command-review:revision",
      authorization: reviewAuthorization(),
      groupRef,
      validationSnapshotRef,
      evidenceSnapshotRef,
      sourceCandidateSetRef: candidateSetRef,
      sourceValidatedCandidateSetRef: validatedSetRef,
      candidateRef: candidateRefs[0],
      changes: { riskEvent: "掌子面失稳涌水（复核修正）" },
      ...overrides,
    }),
  };
};

describe("C23 人工修订窄端口", () => {
  it("只改允许字段并形成不可变后继候选集与已校验候选集", async () => {
    const fixture = makeRevisionFixture();
    const outcome = await fixture.harness.service.prepareReviewRevision(
      fixture.revisionRequest() as never,
    );

    expect(outcome.kind).toBe("revised");
    if (outcome.kind !== "revised") return;
    expect(outcome.revisedCandidateSetRef.reference.entityId).toBe(
      `identification-candidate-set:${PROJECT}:${workItemRef.reference.entityId}`,
    );
    expect(outcome.revisedCandidateSetRef.reference.versionId).not.toBe(SET_DIGEST);
    expect(outcome.validatedCandidateSetRef.reference.entityId).toBe(
      `validated-candidate-set:${PROJECT}:identification-candidate-set:${PROJECT}:${workItemRef.reference.entityId}`,
    );

    const revised = await fixture.storedBody<RiskCandidateSetV1>(
      "candidate-set",
      outcome.revisedCandidateSetRef,
    );
    expect(revised.candidateSetVersion).toBe(2);
    expect(revised.parentCandidateSetRef).toEqual(fixture.candidateSetRow.artifactRef);
    expect(revised.candidates).toHaveLength(2);
    const revisedCandidate = revised.candidates.find(
      (candidate) => candidate.candidateId === "candidate-001",
    );
    const sourceCandidate = RiskCandidateV1Schema.parse(
      candidateValue({ candidateId: "candidate-001" }),
    );
    expect(revisedCandidate?.candidateVersion).toBe(2);
    expect(revisedCandidate?.parentCandidateRef).toEqual(fixture.candidateRefs[0]);
    expect(revisedCandidate?.output.riskEvent).toBe("掌子面失稳涌水（复核修正）");
    // 只读事实逐项保留：模型置信度、工序绑定、模型/提示/输出 Schema/预算、原始响应与生成时间。
    expect(revisedCandidate?.output.modelConfidence).toBe(sourceCandidate.output.modelConfidence);
    expect(revisedCandidate?.nodeId).toBe(sourceCandidate.nodeId);
    expect(revisedCandidate?.modelDeploymentRef).toEqual(sourceCandidate.modelDeploymentRef);
    expect(revisedCandidate?.promptTemplateRef).toEqual(sourceCandidate.promptTemplateRef);
    expect(revisedCandidate?.outputSchemaRef).toEqual(sourceCandidate.outputSchemaRef);
    expect(revisedCandidate?.budgetPolicyRef).toEqual(sourceCandidate.budgetPolicyRef);
    expect(revisedCandidate?.rawResponseRef).toEqual(sourceCandidate.rawResponseRef);
    expect(revisedCandidate?.generatedAt).toBe(sourceCandidate.generatedAt);
    expect(
      revised.candidates.find((candidate) => candidate.candidateId === "candidate-002"),
    ).toEqual(RiskCandidateV1Schema.parse(candidateValue({ candidateId: "candidate-002" })));

    const validated = await fixture.storedBody<CandidateValidationSetV1>(
      "validated-candidate-set",
      outcome.validatedCandidateSetRef,
    );
    expect(validated.entries.every((entry) => entry.disposition === "accepted")).toBe(true);
    expect(validated.acceptedCandidateRefs).toHaveLength(2);
    // 人工修订不产生模型预算消耗，也不形成第二条模型调用链。
    expect(validated.usage).toEqual(fixture.validatedSet.usage);
    expect(fixture.harness.calls.generateCalls).toBe(0);
    expect(fixture.harness.calls.embedCalls).toBe(0);
    // 一个 C03 事务登记两类既有结果。
    expect(fixture.harness.calls.registerCalls).toBe(1);
    expect(fixture.harness.calls.transactionCalls).toBe(1);
  });

  it("相同命令重放返回原候选集与校验引用", async () => {
    const fixture = makeRevisionFixture();
    const first = await fixture.harness.service.prepareReviewRevision(
      fixture.revisionRequest() as never,
    );
    const second = await fixture.harness.service.prepareReviewRevision(
      fixture.revisionRequest() as never,
    );

    expect(second).toEqual(first);
    expect(fixture.harness.calls.generateCalls).toBe(0);
  });

  it("相同命令身份改变修订内容时返回幂等冲突", async () => {
    const fixture = makeRevisionFixture();
    const first = await fixture.harness.service.prepareReviewRevision(
      fixture.revisionRequest() as never,
    );
    expect(first.kind).toBe("revised");

    const conflict = await fixture.harness.service.prepareReviewRevision(
      fixture.revisionRequest({ changes: { riskEvent: "另一条修订内容" } }) as never,
    );

    expect(conflict).toEqual({
      kind: "conflict",
      priorCommandId: "command-review:revision",
    });
  });

  it("调整到冻结证据快照外的定位被拒绝且不登记结果", async () => {
    const fixture = makeRevisionFixture();
    const outcome = await fixture.harness.service.prepareReviewRevision(
      fixture.revisionRequest({
        changes: { evidenceLocator: { sourceSegmentId: SEGMENT_STATE } },
      }) as never,
    );

    expect(outcome).toEqual({ kind: "blocked", detailCode: REASON.evidenceNotFrozen });
    expect(fixture.harness.calls.registerCalls).toBe(0);
    expect(fixture.harness.calls.transactionCalls).toBe(0);
  });

  it("修订后未通过机理适用性校验时返回业务阻断且不登记", async () => {
    const fixture = makeRevisionFixture();
    const outcome = await fixture.harness.service.prepareReviewRevision(
      fixture.revisionRequest({
        changes: { evidenceLocator: { sourceSegmentId: SEGMENT_PROCESS } },
      }) as never,
    );

    expect(outcome).toEqual({ kind: "blocked", detailCode: REASON.mechanismNotApplicable });
    expect(fixture.harness.calls.registerCalls).toBe(0);
  });

  it("没有真实字段变化时拒绝修订", async () => {
    const fixture = makeRevisionFixture();
    const outcome = await fixture.harness.service.prepareReviewRevision(
      fixture.revisionRequest({
        changes: { riskEvent: candidateValue().output.riskEvent },
      }) as never,
    );

    expect(outcome).toEqual({ kind: "blocked", detailCode: "revision-unchanged" });
    expect(fixture.harness.calls.registerCalls).toBe(0);
  });

  it("候选工件不在来源集合时返回陈旧结果", async () => {
    const fixture = makeRevisionFixture();
    const outcome = await fixture.harness.service.prepareReviewRevision(
      fixture.revisionRequest({
        candidateRef: contentRef("candidate-artifact-unknown"),
      }) as never,
    );

    expect(outcome).toEqual({ kind: "stale", detailCode: "candidate-not-found" });
    expect(fixture.harness.calls.registerCalls).toBe(0);
  });

  it("候选不在任务目标组内时返回陈旧结果", async () => {
    const fixture = makeRevisionFixture({}, { orphanThirdCandidate: true });
    const outcome = await fixture.harness.service.prepareReviewRevision(
      fixture.revisionRequest({ candidateRef: fixture.candidateRefs[2] }) as never,
    );

    expect(outcome).toEqual({ kind: "stale", detailCode: "candidate-not-in-group" });
    expect(fixture.harness.calls.registerCalls).toBe(0);
  });

  it("来源候选集版本不存在时返回陈旧结果", async () => {
    const fixture = makeRevisionFixture();
    const outcome = await fixture.harness.service.prepareReviewRevision(
      fixture.revisionRequest({
        sourceCandidateSetRef: {
          kind: "identification-candidate-set",
          reference: {
            entityId: `identification-candidate-set:${PROJECT}:${workItemRef.reference.entityId}`,
            versionId: DIGEST_A,
          },
        },
      }) as never,
    );

    expect(outcome).toEqual({ kind: "stale", detailCode: "candidate-set-not-found" });
    expect(fixture.harness.calls.registerCalls).toBe(0);
  });

  it("来源已校验集不属于任务冻结合并计划时返回陈旧结果", async () => {
    const fixture = makeRevisionFixture({}, { sourceValidationOutsideMergePlan: true });
    const outcome = await fixture.harness.service.prepareReviewRevision(
      fixture.revisionRequest() as never,
    );

    expect(outcome).toEqual({ kind: "stale", detailCode: "merge-plan-fact-mismatch" });
    expect(fixture.harness.calls.registerCalls).toBe(0);
  });

  it("当前 review-audit.decide-review 授权不成立时返回未授权", async () => {
    const fixture = makeRevisionFixture({ verifyCurrent: async () => undefined });
    const outcome = await fixture.harness.service.prepareReviewRevision(
      fixture.revisionRequest() as never,
    );

    expect(outcome).toEqual({ kind: "unauthorized" });
    expect(fixture.harness.calls.resultReads).toBe(0);
    expect(fixture.harness.calls.registerCalls).toBe(0);
  });
});
