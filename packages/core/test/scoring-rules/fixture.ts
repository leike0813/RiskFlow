/**
 * C19 core 夹具：公共规则/三维/阈值构造器、冻结来源（含一条获准真实规范资料段）、
 * 策略与 manifest 构造器。
 *
 * 合成样本、待甲方复核：标准身份只用于来源类别与证据定位语义，阈值/等级与资料段
 * 内容均为确定性用例值，不冒充甲方量化标准或规范正文；真实条文出口待甲方提供获准片段。
 */
import type {
  AgentTaskRefV1,
  ContentArtifactRefV1,
  ProjectRevisionRefV1,
} from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";
import type {
  ApplicabilityConditions,
  GradeInterval,
  ScoringThreshold,
  StructuredScoringRule,
} from "@riskflow/contracts/records";

import {
  AgentTaskBudgetPolicyV1Schema,
  type AgentTaskBudgetPolicyV1,
} from "../../src/agent-runtime/index.js";
import {
  StructuredScoringRuleDocumentV1Schema,
  type ScoringRuleAuthoringCandidateV1,
  type ScoringRuleAuthoringManifestV1,
  type ScoringRuleSourceBindingV1,
  type ScoringRulesPolicyV1,
  type StructuredScoringRuleDocumentV1,
  type StructuredScoringRuleMemberV1,
} from "../../src/scoring-rules/index.js";

export const SCORING_RULES_FIXTURE_PROJECT_ID = "scoring-rules-project";

export const SCORING_RULES_FIXTURE_PROJECT_REVISION: ProjectRevisionRefV1 = {
  kind: "project-revision",
  reference: { entityId: "project-revision-c19-fixture", versionId: "3" },
};

export const SCORING_RULES_FIXTURE_CONFIGURATION_SET_REF: VersionReference = {
  entityId: "assessment-configuration-set-fixture",
  versionId: "7",
};

export const SCORING_RULES_FIXTURE_COMPATIBILITY_REF: VersionReference = {
  entityId: "compatibility-fixture",
  versionId: "1",
};

/**
 * 获准真实规范来源：GB 50446-2017《盾构法隧道施工及验收规范》与中国铁建企业规程
 * 中与「盾构掘进参数控制」「管片拼装质量」「地表沉降监测」相关的保留资料段。
 * 只登记标准身份、来源版本与资料段定位，正文留在 C04。
 */
export const REAL_STANDARD_SOURCE_VERSION = {
  kind: "source-version",
  reference: { entityId: "GB50446-2017", versionId: "2017-08-01" },
} as const;

export const SECOND_STANDARD_SOURCE_VERSION = {
  kind: "source-version",
  reference: { entityId: "GB50911-2013", versionId: "2014-05-01" },
} as const;

export const REAL_STANDARD_SEGMENT_ID = "GB50446-2017/掘进参数控制/土仓压力与推进速度" as const;
export const REAL_STANDARD_MONITORING_SEGMENT_ID =
  "GB50911-2013/监测项目/盾构法隧道地表沉降" as const;

export const REAL_STANDARD_RETAINED_SEGMENTS = [
  {
    sourceVersionRef: REAL_STANDARD_SOURCE_VERSION,
    sourceSegmentIds: [REAL_STANDARD_SEGMENT_ID, "GB50446-2017/壁后注浆/同步注浆量与压力"],
  },
  {
    sourceVersionRef: SECOND_STANDARD_SOURCE_VERSION,
    sourceSegmentIds: [
      REAL_STANDARD_MONITORING_SEGMENT_ID,
      "GB50911-2013/监测频率/掘进面距监测断面距离",
    ],
  },
] as const;

export const SCORING_RULES_FIXTURE_INDICATOR_IDS = [
  "indicator-ground-settlement",
  "indicator-face-pressure-deviation",
  "indicator-segment-offset",
] as const;

export const scoringRulesFixtureAgentTaskRef: AgentTaskRefV1 = {
  kind: "agent-task",
  reference: { entityId: "agent-task:scoring-rules-project:authoring", versionId: "1" },
  taskType: "knowledge-authoring",
  triggerMode: "embedded",
  modelDeploymentRef: { entityId: "model-deployment-fixture", versionId: "1" },
  promptTemplateRef: { entityId: "prompt-template-scoring-rule", versionId: "1" },
  toolPolicyRef: { entityId: "tool-policy-scoring-rule", versionId: "1" },
  budgetPolicyRef: { entityId: "budget-policy-scoring-rule", versionId: "1" },
  incrementSchemaRef: { entityId: "increment-schema-scoring-rule", versionId: "1" },
  validationPolicyRef: { entityId: "validation-policy-scoring-rule", versionId: "1" },
};

export const scoringRulesFixtureCleaningResultArtifactRef: ContentArtifactRefV1 = {
  kind: "content-artifact",
  reference: { entityId: "data-cleaning-result-fixture", versionId: `sha256:${"a".repeat(64)}` },
} as ContentArtifactRefV1;

export const scoringRulesFixtureBudgetPolicy: AgentTaskBudgetPolicyV1 =
  AgentTaskBudgetPolicyV1Schema.parse({
    schemaVersion: "1",
    policyRef: scoringRulesFixtureAgentTaskRef.budgetPolicyRef,
    modelDeploymentRef: scoringRulesFixtureAgentTaskRef.modelDeploymentRef,
    promptTemplateRef: scoringRulesFixtureAgentTaskRef.promptTemplateRef,
    toolPolicyRef: scoringRulesFixtureAgentTaskRef.toolPolicyRef,
    maxModelInvocations: 8,
    maxToolInvocations: 16,
    maxContextTokens: 32_768,
    maxInputBytes: 262_144,
    maxOutputBytes: 262_144,
    maxCandidates: 4,
    maxObjects: 128,
    maxSupplementarySearches: 0,
    maxCorrections: 2,
    maxTransientRetries: 1,
    maxConcurrentActions: 1,
    maxWallClockMs: 600_000,
  });

export const makeScoringRulesFixturePolicy = (overrides?: {
  readonly policyRef?: VersionReference;
  readonly assemblyPolicyRef?: VersionReference;
  readonly conflictPriorityPolicyRef?: VersionReference;
}): ScoringRulesPolicyV1 => ({
  schemaVersion: "1",
  policyRef: overrides?.policyRef ?? { entityId: "scoring-rules-policy", versionId: "1" },
  compatibilityRef: SCORING_RULES_FIXTURE_COMPATIBILITY_REF,
  assemblyPolicyRef: overrides?.assemblyPolicyRef ?? {
    entityId: "scoring-rule-assembly-policy",
    versionId: "1",
  },
  conflictPriorityPolicyRef: overrides?.conflictPriorityPolicyRef ?? {
    entityId: "rule-conflict-priority",
    versionId: "1",
  },
  allowedSourceStandardKinds: ["国家规范", "行业标准", "企业规程"],
  tools: {
    standardSegmentToolRef: { entityId: "tool-standard-segment-slice", versionId: "1" },
    indicatorCatalogToolRef: { entityId: "tool-indicator-catalog-slice", versionId: "1" },
    maxSegmentsPerRead: 8,
    maxIndicatorsPerRead: 16,
  },
  agent: {
    definitionRef: { entityId: "scoring-rule-authoring-definition", versionId: "1" },
    modelDeploymentRef: scoringRulesFixtureAgentTaskRef.modelDeploymentRef,
    promptTemplateRef: scoringRulesFixtureAgentTaskRef.promptTemplateRef,
    toolPolicyRef: scoringRulesFixtureAgentTaskRef.toolPolicyRef,
    budgetPolicyRef: scoringRulesFixtureAgentTaskRef.budgetPolicyRef,
    incrementSchemaRef: scoringRulesFixtureAgentTaskRef.incrementSchemaRef,
    validationPolicyRef: scoringRulesFixtureAgentTaskRef.validationPolicyRef,
    budgetPolicy: scoringRulesFixtureBudgetPolicy,
  },
});

export const makeScoringRulesFixtureManifest = (overrides?: {
  readonly projectRevisionRef?: ProjectRevisionRefV1;
  readonly baseRuleReleaseRef?: ScoringRuleAuthoringManifestV1["baseRuleReleaseRef"];
  readonly retainedSourceSegments?: ScoringRuleAuthoringManifestV1["retainedSourceSegments"];
  readonly policy?: ScoringRulesPolicyV1;
}): ScoringRuleAuthoringManifestV1 => {
  const policy = overrides?.policy ?? makeScoringRulesFixturePolicy();
  return {
    schemaVersion: "1",
    projectId: SCORING_RULES_FIXTURE_PROJECT_ID,
    actorId: "actor-scoring-rule-author",
    projectRevisionRef: overrides?.projectRevisionRef ?? SCORING_RULES_FIXTURE_PROJECT_REVISION,
    authorizationContextRef: {
      kind: "authorization-context",
      reference: { entityId: "authorization-context-c19-fixture", versionId: "1" },
    },
    cleaningResultArtifactRef: scoringRulesFixtureCleaningResultArtifactRef,
    cleaningResultDigest: "b".repeat(64),
    compatibilityRef: SCORING_RULES_FIXTURE_COMPATIBILITY_REF,
    dataCleaningTaskRef: {
      kind: "agent-task",
      reference: { entityId: "agent-task:data-cleaning-fixture", versionId: "1" },
      taskType: "data-cleaning",
      triggerMode: "embedded",
      modelDeploymentRef: { entityId: "model-deployment-cleaning", versionId: "1" },
      promptTemplateRef: { entityId: "prompt-template-cleaning", versionId: "1" },
      toolPolicyRef: { entityId: "tool-policy-cleaning", versionId: "1" },
      budgetPolicyRef: { entityId: "budget-policy-cleaning", versionId: "1" },
      incrementSchemaRef: { entityId: "increment-schema-cleaning", versionId: "1" },
      validationPolicyRef: { entityId: "validation-policy-cleaning", versionId: "1" },
    },
    retainedSourceSegments: overrides?.retainedSourceSegments ?? [
      ...REAL_STANDARD_RETAINED_SEGMENTS,
    ],
    sourceStandardKinds: ["国家规范", "行业标准"],
    configurationSetRef: SCORING_RULES_FIXTURE_CONFIGURATION_SET_REF,
    indicatorSystemMember: {
      releaseRef: {
        kind: "knowledge-release",
        reference: { entityId: "indicator-system-release-fixture", versionId: "2" },
      },
      revisionRef: {
        kind: "knowledge-revision",
        reference: { entityId: "indicator-system-revision-fixture", versionId: "2" },
      },
      artifactRef: {
        kind: "content-artifact",
        reference: { entityId: "indicator-system-artifact-fixture", versionId: "2" },
      },
      contentDigest: "c".repeat(64),
    },
    ...(overrides?.baseRuleReleaseRef === undefined
      ? {}
      : { baseRuleReleaseRef: overrides.baseRuleReleaseRef }),
    scoringPolicyRef: policy.policyRef,
    taskPolicy: {
      modelDeploymentRef: policy.agent.modelDeploymentRef,
      promptTemplateRef: policy.agent.promptTemplateRef,
      toolPolicyRef: policy.agent.toolPolicyRef,
      budgetPolicyRef: policy.agent.budgetPolicyRef,
      incrementSchemaRef: policy.agent.incrementSchemaRef,
      validationPolicyRef: policy.agent.validationPolicyRef,
    },
  };
};

export const makeApplicabilityConditions = (overrides?: {
  readonly constructionMethod?: readonly string[];
  readonly stratumCondition?: readonly string[];
  readonly engineeringStage?: readonly string[];
}): ApplicabilityConditions => ({
  constructionMethod: [...(overrides?.constructionMethod ?? ["盾构法"])].sort(),
  stratumCondition: [...(overrides?.stratumCondition ?? ["软土地层"])].sort(),
  engineeringStage: [...(overrides?.engineeringStage ?? ["盾构掘进"])].sort(),
});

export const makeScoringRule = (overrides?: {
  readonly ruleId?: string;
  readonly indicatorItem?: string;
  readonly applicabilityConditions?: ApplicabilityConditions;
  readonly scoringThresholds?: readonly ScoringThreshold[];
  readonly gradeIntervals?: readonly GradeInterval[];
  readonly exceptionClauses?: readonly string[];
  readonly evidenceLocator?: { readonly sourceSegmentId: string };
  readonly reviewStatus?: StructuredScoringRule["reviewStatus"];
}): StructuredScoringRule => ({
  ruleId: overrides?.ruleId ?? "rule-ground-settlement",
  applicabilityConditions: overrides?.applicabilityConditions ?? makeApplicabilityConditions(),
  indicatorItem: overrides?.indicatorItem ?? SCORING_RULES_FIXTURE_INDICATOR_IDS[0],
  scoringThresholds: overrides?.scoringThresholds ?? [
    { thresholdId: "settlement-low", score: 1, operator: "between", value: 0, upperValue: 10 },
    { thresholdId: "settlement-mid", score: 3, operator: "between", value: 10, upperValue: 20 },
    { thresholdId: "settlement-high", score: 5, operator: "gte", value: 20 },
  ],
  gradeIntervals: overrides?.gradeIntervals ?? [
    { grade: "grade-a", lowerBound: 0, upperBound: 2.5 },
    { grade: "grade-b", lowerBound: 2.5, upperBound: 4.5 },
    { grade: "grade-c", lowerBound: 4.5 },
  ],
  exceptionClauses: overrides?.exceptionClauses ?? [],
  evidenceLocator: overrides?.evidenceLocator ?? { sourceSegmentId: REAL_STANDARD_SEGMENT_ID },
  ruleVersion: { entityId: overrides?.ruleId ?? "rule-ground-settlement", versionId: "pending" },
  reviewStatus: overrides?.reviewStatus ?? "pending",
});

export const makeScoringRuleSourceBinding = (overrides?: {
  readonly sourceVersionRef?: ScoringRuleSourceBindingV1["sourceVersionRef"];
  readonly evidenceReferences?: ScoringRuleSourceBindingV1["evidenceReferences"];
}): ScoringRuleSourceBindingV1 => {
  const sourceVersionRef = overrides?.sourceVersionRef ?? REAL_STANDARD_SOURCE_VERSION;
  return {
    sourceVersionRef,
    cleaningResultArtifactRef: scoringRulesFixtureCleaningResultArtifactRef,
    evidenceReferences: overrides?.evidenceReferences ?? [
      {
        locator: { sourceSegmentId: REAL_STANDARD_SEGMENT_ID },
        sourceVersion: sourceVersionRef.reference,
      },
    ],
    agentTaskRef: scoringRulesFixtureAgentTaskRef,
  };
};

export const makeScoringRuleCandidate = (overrides?: {
  readonly operations?: ScoringRuleAuthoringCandidateV1["operations"];
  readonly candidateVersion?: number;
}): ScoringRuleAuthoringCandidateV1 => ({
  schemaVersion: "1",
  candidateVersion: overrides?.candidateVersion ?? 1,
  operations: overrides?.operations ?? [
    {
      kind: "add-rule",
      ruleId: "rule-ground-settlement",
      rule: makeScoringRule(),
      sourceVersionRef: REAL_STANDARD_SOURCE_VERSION,
      evidenceReferences: [
        {
          locator: { sourceSegmentId: REAL_STANDARD_SEGMENT_ID },
          sourceVersion: REAL_STANDARD_SOURCE_VERSION.reference,
        },
      ],
    },
  ],
});

export const makeScoringRuleDocument = (overrides?: {
  readonly manifest?: ScoringRuleAuthoringManifestV1;
  readonly members?: readonly StructuredScoringRuleMemberV1[];
}): StructuredScoringRuleDocumentV1 => {
  const manifest = overrides?.manifest ?? makeScoringRulesFixtureManifest();
  const members = overrides?.members ?? [
    { rule: makeScoringRule(), binding: makeScoringRuleSourceBinding() },
  ];
  return StructuredScoringRuleDocumentV1Schema.parse({
    schemaVersion: "1",
    projectRevisionRef: manifest.projectRevisionRef,
    configurationSetRef: manifest.configurationSetRef,
    compatibilityRef: SCORING_RULES_FIXTURE_COMPATIBILITY_REF,
    scoringPolicyRef: manifest.scoringPolicyRef,
    cleaningResultArtifactRef: manifest.cleaningResultArtifactRef,
    agentTaskRef: scoringRulesFixtureAgentTaskRef,
    members: [...members].sort((left, right) => (left.rule.ruleId < right.rule.ruleId ? -1 : 1)),
  });
};
