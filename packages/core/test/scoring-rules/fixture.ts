/**
 * C19 core 夹具：公共规则/三维/阈值构造器、冻结来源（GB 50911-2013 真实条文段）、
 * 策略与 manifest 构造器。
 *
 * 阈值、等级区间与资料段定位来自 `standard-fixture.ts` 的 GB 50911-2013 真实条文夹具
 * （真实公开来源，非甲方审核资料；甲方正式输入到位后需复核）；二级来源为待甲方输入的
 * 企业规程占位，仅用于来源类别/优先级语义，不冒充规范或甲方量化标准。
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
  GB50911_CLAUSE_SEGMENT_ID,
  GB50911_SOFT_SOIL_BANDS,
  GB50911_SOURCE_VERSION_REF,
  gb50911GradeIntervals,
  gb50911ScoringThresholds,
} from "./standard-fixture.js";
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
 * 获准真实规范来源：GB 50911-2013《城市轨道交通工程监测技术规范》中与「施工阶段监测
 * 适用条件」「盾构法监测项目」「地表沉降控制值」相关的保留资料段（真实公开来源，
 * 见 `fixtures/gb50911-2013-clauses.source.json`）。
 * 只登记标准身份、来源版本与资料段定位，正文留在 C04。
 */
export const REAL_STANDARD_SOURCE_VERSION = GB50911_SOURCE_VERSION_REF;

/** 待甲方正式输入的二级来源（企业规程）占位：只承载来源类别与优先级语义。 */
export const SECOND_STANDARD_SOURCE_VERSION = {
  kind: "source-version",
  reference: { entityId: "enterprise-standard-pending-client-input", versionId: "1" },
} as const;

export const REAL_STANDARD_SEGMENT_ID = GB50911_CLAUSE_SEGMENT_ID.controlValues;
export const REAL_STANDARD_MONITORING_SEGMENT_ID = GB50911_CLAUSE_SEGMENT_ID.mandatoryWarning;

export const REAL_STANDARD_RETAINED_SEGMENTS = [
  {
    sourceVersionRef: REAL_STANDARD_SOURCE_VERSION,
    sourceSegmentIds: [
      GB50911_CLAUSE_SEGMENT_ID.mandatoryMonitoring,
      GB50911_CLAUSE_SEGMENT_ID.indicatorItems,
      GB50911_CLAUSE_SEGMENT_ID.controlValues,
    ],
  },
  {
    sourceVersionRef: SECOND_STANDARD_SOURCE_VERSION,
    sourceSegmentIds: [REAL_STANDARD_MONITORING_SEGMENT_ID],
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
  scoringThresholds:
    overrides?.scoringThresholds ?? gb50911ScoringThresholds(GB50911_SOFT_SOIL_BANDS),
  gradeIntervals: overrides?.gradeIntervals ?? gb50911GradeIntervals(GB50911_SOFT_SOIL_BANDS),
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
