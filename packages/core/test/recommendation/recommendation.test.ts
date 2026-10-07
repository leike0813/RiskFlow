import { describe, expect, it } from "vitest";

import type {
  RecommendationCandidateRefV1,
  ResponseRecommendationRefV1,
  WarningRecordRefV1,
} from "@riskflow/contracts/ports";
import type { AgentTaskSnapshotV1 } from "../../src/agent-runtime/index.js";
import {
  AgentValidationResultV1Schema,
  buildCompletedAgentTaskResult,
} from "../../src/agent-runtime/index.js";
import {
  MeasureCandidateSetV1Schema,
  RECOMMENDATION_TASK_TYPE_V1,
  ResponseAgentPolicyV1Schema,
  ResponseGenerationPolicyV1Schema,
  ResponseRecommendationIncrementV1Schema,
  ResponseValidationPolicyV1Schema,
  RecommendationSiteContextV1Schema,
  RecommendationFrozenWarningV1Schema,
  buildResponseRecommendationRecord,
  createResponseRecommendationTaskDefinition,
  failRecommendation,
  measureCandidateInputDigest,
  primaryWarningRecordRef,
  recommendationFailureFrom,
  recommendationValidationPassedAll,
  resolveTriggerIndicators,
  selectFrozenMeasures,
  validateRecommendationCandidate,
  type MeasureCandidateSetV1,
  type RecommendationFrozenWarningV1,
  type RecommendationValidationOutcomeV1,
} from "../../src/recommendation/index.js";
import { c25ConfigurationDocuments } from "../risk-assessment/fixture.js";

const digest = (seed: string): string => seed.repeat(64).slice(0, 64);
const warningRef = (id: string): WarningRecordRefV1 => ({
  kind: "warning-record",
  reference: { entityId: id, versionId: "1" },
});

const measure = (input: {
  readonly measureId: string;
  readonly riskEventCategory: string;
  readonly triggerTypes: readonly string[];
  readonly targetIndicatorIds: readonly string[];
  readonly resourceRequirements?: readonly string[];
  readonly evidenceRequirements?: readonly string[];
  readonly contraindications?: readonly string[];
  readonly applicability?: readonly {
    readonly dimension: string;
    readonly values: readonly string[];
  }[];
}) => ({
  measureId: input.measureId,
  riskEventCategory: input.riskEventCategory,
  applicabilityConditions: [...(input.applicability ?? [])],
  triggerTypes: [...input.triggerTypes],
  steps: [
    { stepOrdinal: 1, instruction: `${input.measureId} step 1` },
    { stepOrdinal: 2, instruction: `${input.measureId} step 2` },
  ],
  resourceRequirements: [...(input.resourceRequirements ?? [])],
  targetIndicatorIds: [...input.targetIndicatorIds],
  evidenceRequirements: [...(input.evidenceRequirements ?? ["evidence-standard"])],
  contraindications: [...(input.contraindications ?? [])],
});

const library = {
  measures: [
    measure({
      measureId: "measure-a",
      riskEventCategory: "突涌",
      triggerTypes: ["多指标联合规则命中", "监测指标越限"],
      targetIndicatorIds: ["indicator-1", "indicator-2"],
      resourceRequirements: ["resource-a", "resource-b"],
      evidenceRequirements: ["evidence-a"],
      contraindications: ["contra-1"],
      applicability: [{ dimension: "地层条件数据", values: ["地层-x"] }],
    }),
    measure({
      measureId: "measure-b",
      riskEventCategory: "突涌",
      triggerTypes: ["监测指标越限"],
      targetIndicatorIds: ["indicator-1"],
      resourceRequirements: ["resource-b"],
      evidenceRequirements: ["evidence-b"],
      applicability: [],
    }),
    measure({
      measureId: "measure-c",
      riskEventCategory: "沉降",
      triggerTypes: ["监测指标越限"],
      targetIndicatorIds: ["indicator-1"],
      applicability: [{ dimension: "地层条件数据", values: ["地层-y"] }],
    }),
  ],
};

const warning = (input: {
  readonly id: string;
  readonly triggerType: string;
  readonly indicatorItem: string;
  readonly resolvedTargetIndicatorIds?: readonly string[];
  readonly unresolvedTriggerItems?: readonly string[];
}) => ({
  warningRecordRef: warningRef(input.id),
  triggerType: input.triggerType,
  triggerIndicators: [
    { indicatorItem: input.indicatorItem, triggerType: input.triggerType, actualValue: 1 },
  ],
  resolvedTargetIndicatorIds: [...(input.resolvedTargetIndicatorIds ?? [input.indicatorItem])],
  unresolvedTriggerItems: [...(input.unresolvedTriggerItems ?? [])],
  evidenceReferences: [
    {
      locator: { sourceSegmentId: `segment-${input.id}` },
      sourceVersion: { entityId: "src", versionId: "1" },
    },
  ],
  assessmentRecordRef: {
    kind: "risk-assessment-record" as const,
    reference: { entityId: `assessment-${input.id}`, versionId: "1" },
  },
  assessmentInputSnapshotRef: {
    kind: "assessment-input-snapshot" as const,
    reference: { entityId: `input-${input.id}`, versionId: "1" },
  },
  preparationSnapshotRef: {
    kind: "assessment-preparation-snapshot" as const,
    reference: { entityId: `preparation-${input.id}`, versionId: "1" },
  },
});

const WARNINGS = [
  warning({ id: "warning-1", triggerType: "监测指标越限", indicatorItem: "indicator-1" }),
  warning({ id: "warning-2", triggerType: "多指标联合规则命中", indicatorItem: "indicator-2" }),
  warning({ id: "warning-3", triggerType: "趋势/加速度/异常评分越限", indicatorItem: "trend-1" }),
];

const candidateSetOf = (input: {
  readonly candidates: ReturnType<typeof selectFrozenMeasures>;
  readonly warnings?: readonly RecommendationFrozenWarningV1[];
}): MeasureCandidateSetV1 =>
  MeasureCandidateSetV1Schema.parse({
    schemaVersion: "1",
    projectId: "project-c27",
    warningResponseTaskRef: {
      kind: "warning-response-task",
      reference: { entityId: "task-1", versionId: "2" },
    },
    riskInputRef: {
      kind: "standardized-risk-record",
      reference: { entityId: "risk-1", versionId: "1" },
    },
    spatialScopeRef: { kind: "spatial-scope", reference: { entityId: "scope-1", versionId: "1" } },
    applicableRuleSetRef: { entityId: "rule-set-release", versionId: "1" },
    basisReleaseSetRef: {
      kind: "assessment-basis-release-set",
      reference: { entityId: "basis-1", versionId: "1" },
    },
    measureLibraryReleaseRef: {
      kind: "measure-library-release",
      reference: { entityId: "library-release", versionId: "1" },
    },
    measureArtifactRef: {
      kind: "content-artifact",
      reference: { entityId: "library", versionId: `sha256:${digest("a")}` },
    },
    measureContentDigest: digest("b"),
    generationPolicyRef: { entityId: "generation-policy", versionId: "1" },
    validationPolicyRef: { entityId: "validation-policy", versionId: "1" },
    agentPolicyRef: { entityId: "agent-policy", versionId: "1" },
    reviewPolicyRef: { entityId: "review-policy", versionId: "1" },
    riskEventCategory: "突涌",
    warnings: [...(input.warnings ?? WARNINGS.slice(0, 2))],
    candidates: input.candidates,
    inputDigest: digest("c"),
    frozenAt: "2033-04-05T06:07:08.000Z",
    frozenBy: "actor-c27",
  });

const validationPolicy = ResponseValidationPolicyV1Schema.parse({
  schemaVersion: "1",
  policyRef: { entityId: "validation-policy", versionId: "1" },
  projectId: "project-c27",
  targetIndicators: [
    { indicatorItem: "indicator-1", targetValue: 5 },
    { indicatorItem: "indicator-2", targetValue: 6 },
    { indicatorItem: "threshold-1", targetValue: 7 },
    { indicatorItem: "joint-1", targetValue: 2 },
    { indicatorItem: "trend-1", targetValue: 0.5 },
  ],
  reviewedStandardEvidence: [
    { measureId: "measure-a", evidenceItem: "evidence-a" },
    { measureId: "measure-b", evidenceItem: "evidence-b" },
  ],
  contraindicationRules: [
    { contraindicationId: "contra-9", triggerTypes: ["风险等级超过风险可接受阈值"] },
  ],
  executableProcessStatuses: ["掘进"],
});

const siteContext = RecommendationSiteContextV1Schema.parse({
  schemaVersion: "1",
  projectId: "project-c27",
  siteContextRef: { entityId: "site-1", versionId: "1" },
  spatialScopeRef: { kind: "spatial-scope", reference: { entityId: "scope-1", versionId: "1" } },
  processNodeRef: { entityId: "process-1", versionId: "1" },
  processStatus: "掘进",
  availableResources: ["resource-a", "resource-b"],
  constraints: [],
  evidenceReferences: [
    {
      locator: { sourceSegmentId: "site-segment" },
      sourceVersion: { entityId: "src", versionId: "1" },
    },
  ],
  observedAt: "2033-04-05T06:07:08.000Z",
});

const runValidation = (input: {
  readonly selections: readonly { readonly measureId: string; readonly order: number }[];
  readonly candidates?: ReturnType<typeof selectFrozenMeasures>;
  readonly warnings?: readonly RecommendationFrozenWarningV1[];
  readonly policy?: unknown;
  readonly site?: unknown;
}): RecommendationValidationOutcomeV1 =>
  validateRecommendationCandidate({
    candidateSet: candidateSetOf({
      candidates: input.candidates ?? selectFrozenMeasuresAll(),
      warnings: input.warnings,
    }),
    selections: input.selections,
    validationPolicy: ResponseValidationPolicyV1Schema.parse(input.policy ?? validationPolicy),
    siteContext: RecommendationSiteContextV1Schema.parse(input.site ?? siteContext),
  });

const selectFrozenMeasuresAll = (): ReturnType<typeof selectFrozenMeasures> =>
  selectFrozenMeasures({
    library,
    riskEventCategory: "突涌",
    applicability: [
      { dimension: "地层条件数据", values: ["地层-x"] },
      { dimension: "施工工法数据", values: ["盾构法"] },
      { dimension: "工程阶段数据", values: ["掘进"] },
    ],
    warnings: WARNINGS.map((entry) => ({
      warningRecordRef: entry.warningRecordRef,
      triggerType: entry.triggerType as never,
    })),
  });

describe("C27 措施候选与三项确定性校验", () => {
  it("冻结阈值和联合规则只经同版字段映射解析", () => {
    const documents = c25ConfigurationDocuments();
    const configuration = {
      fieldMapping: documents["indicator-field-mapping"].content,
      monitoringThresholds: documents["monitoring-warning-threshold"].content,
      jointTriggerPolicy: documents["joint-trigger-policy"].content,
    };
    // 按类型分流后：特征越限只查非 value 阈值，联合类型只查联合规则；解析不出来照旧
    // 记未解析，不因任务里另有其它类型触发而跳过。
    expect(
      resolveTriggerIndicators(
        [
          {
            indicatorItem: "threshold-settlement-slope",
            triggerType: "趋势/加速度/异常评分越限",
          },
        ],
        configuration,
      ),
    ).toEqual({
      indicatorIds: ["indicator-consequence-1"],
      unresolvedItems: [],
    });
    expect(
      resolveTriggerIndicators(
        [
          { indicatorItem: "threshold-settlement-value", triggerType: "监测指标越限" },
          { indicatorItem: "joint-trend", triggerType: "多指标联合规则命中" },
        ],
        configuration,
      ),
    ).toEqual({
      indicatorIds: ["indicator-consequence-1"],
      unresolvedItems: ["joint-trend", "threshold-settlement-value"],
    });
  });
  it("风险等级触发不产出监测指标映射，也不算解析失败", () => {
    const documents = c25ConfigurationDocuments();
    const configuration = {
      fieldMapping: documents["indicator-field-mapping"].content,
      monitoringThresholds: documents["monitoring-warning-threshold"].content,
      jointTriggerPolicy: documents["joint-trigger-policy"].content,
    };
    expect(
      resolveTriggerIndicators(
        [{ indicatorItem: "threshold-risk-1", triggerType: "风险等级超过风险可接受阈值" }],
        configuration,
      ),
    ).toEqual({ indicatorIds: [], unresolvedItems: [] });
  });
  it("按预警逐项筛选并按措施身份合并触发关系", () => {
    const candidates = selectFrozenMeasuresAll();
    expect(candidates.map((entry) => entry.measure.measureId)).toEqual(["measure-a", "measure-b"]);
    const measureA = candidates.find((entry) => entry.measure.measureId === "measure-a")!;
    expect(measureA.triggerTypes).toEqual(["多指标联合规则命中", "监测指标越限"]);
    expect(measureA.warningRecordRefs.map((ref) => ref.reference.entityId)).toEqual([
      "warning-1",
      "warning-2",
    ]);
    const measureB = candidates.find((entry) => entry.measure.measureId === "measure-b")!;
    expect(measureB.triggerTypes).toEqual(["监测指标越限"]);
    expect(measureB.warningRecordRefs.map((ref) => ref.reference.entityId)).toEqual(["warning-1"]);
    // 同一输入重复筛选结果完全一致：冻结集不依赖调用时刻。
    expect(selectFrozenMeasuresAll()).toEqual(candidates);
  });

  it("类别、适用性与触发类型不匹配的措施不进入候选", () => {
    const byCategory = selectFrozenMeasures({
      library,
      riskEventCategory: "沉降",
      applicability: [{ dimension: "地层条件数据", values: ["地层-x"] }],
      warnings: [
        { warningRecordRef: warningRef("warning-1"), triggerType: "监测指标越限" as never },
      ],
    });
    expect(byCategory).toEqual([]);
    const byApplicability = selectFrozenMeasures({
      library,
      riskEventCategory: "突涌",
      applicability: [{ dimension: "地层条件数据", values: ["地层-z"] }],
      warnings: [
        { warningRecordRef: warningRef("warning-1"), triggerType: "监测指标越限" as never },
      ],
    });
    expect(byApplicability.map((entry) => entry.measure.measureId)).toEqual(["measure-b"]);
    const byTrigger = selectFrozenMeasures({
      library,
      riskEventCategory: "突涌",
      applicability: [{ dimension: "地层条件数据", values: ["地层-x"] }],
      warnings: [
        {
          warningRecordRef: warningRef("warning-3"),
          triggerType: "趋势/加速度/异常评分越限" as never,
        },
      ],
    });
    expect(byTrigger).toEqual([]);
  });

  it("三项均通过时给出有序措施项、资源并集与审核目标值", () => {
    const outcome = runValidation({
      selections: [
        { measureId: "measure-b", order: 2 },
        { measureId: "measure-a", order: 1 },
      ],
    });
    expect(recommendationValidationPassedAll(outcome.results)).toBe(true);
    expect(outcome.results.triggerConsistency.issues).toEqual([]);
    expect(outcome.implementationOrder).toEqual(["measure-a", "measure-b"]);
    expect(outcome.measureItems.map((item) => item.measureId)).toEqual(["measure-a", "measure-b"]);
    expect(outcome.measureItems[0]?.content).toBe("measure-a step 1 measure-a step 2");
    expect(outcome.resourceRequirements).toEqual(["resource-a", "resource-b"]);
    expect(outcome.targetIndicators).toEqual([
      { indicatorItem: "indicator-1", targetValue: 5 },
      { indicatorItem: "indicator-2", targetValue: 6 },
    ]);
    expect(outcome.diagnostics).toEqual([]);
  });

  it("候选集之外的增量项不参与校验，也不补默认措施", () => {
    const outcome = runValidation({
      selections: [
        { measureId: "measure-c", order: 1 },
        { measureId: "measure-a", order: 2 },
      ],
    });
    expect(outcome.selections.map((entry) => entry.measureId)).toEqual(["measure-a"]);
    expect(outcome.implementationOrder).toEqual(["measure-a"]);
  });

  it("触发指标缺目标值时逐项失败并保留证据引用", () => {
    const outcome = runValidation({
      selections: [{ measureId: "measure-a", order: 1 }],
      policy: {
        ...validationPolicy,
        targetIndicators: [{ indicatorItem: "indicator-1", targetValue: 5 }],
      },
    });
    expect(outcome.results.triggerConsistency.passed).toBe(false);
    expect(outcome.results.triggerConsistency.issues).toContain(
      "target-indicator-unavailable: measure-a/indicator-2",
    );
    expect(outcome.results.triggerConsistency.issues).toContain(
      "trigger-indicator-uncovered: warning-2/indicator-2",
    );
    expect(outcome.results.standardsCompliance.passed).toBe(true);
    expect(outcome.results.siteFeasibility.passed).toBe(true);
    expect(
      outcome.diagnostics.map((diagnostic) => `${diagnostic.checkId}:${diagnostic.reasonCode}`),
    ).toEqual([
      "trigger-consistency:target-indicator-unavailable",
      "trigger-consistency:trigger-indicator-uncovered",
    ]);
    expect(outcome.diagnostics[1]?.references).toEqual([warningRef("warning-2")]);
  });

  it("策略有目标值但措施未覆盖预警触发指标时拒绝", () => {
    const outcome = runValidation({
      selections: [{ measureId: "measure-b", order: 1 }],
      candidates: selectFrozenMeasuresAll().filter(
        (entry) => entry.measure.measureId === "measure-b",
      ),
      warnings: [
        warning({ id: "warning-1", triggerType: "监测指标越限", indicatorItem: "indicator-2" }),
      ],
    });
    expect(outcome.results.triggerConsistency.passed).toBe(false);
    expect(
      outcome.diagnostics.some((entry) => entry.reasonCode === "trigger-indicator-uncovered"),
    ).toBe(true);
  });

  it("规范证据缺失或禁忌命中时规范合规性失败", () => {
    const missingEvidence = runValidation({
      selections: [{ measureId: "measure-b", order: 1 }],
      policy: { ...validationPolicy, reviewedStandardEvidence: [] },
    });
    expect(missingEvidence.results.standardsCompliance.passed).toBe(false);
    expect(missingEvidence.results.standardsCompliance.issues).toContain(
      "standard-evidence-unavailable: measure-b/evidence-b",
    );
    const contraindication = runValidation({
      selections: [{ measureId: "measure-a", order: 1 }],
      policy: {
        ...validationPolicy,
        contraindicationRules: [{ contraindicationId: "contra-1", triggerTypes: ["监测指标越限"] }],
      },
    });
    expect(contraindication.results.standardsCompliance.passed).toBe(false);
    expect(contraindication.results.standardsCompliance.issues).toContain(
      "contraindication-triggered: measure-a/contra-1",
    );
    expect(contraindication.results.triggerConsistency.passed).toBe(true);
  });

  it("资源、工序状态与现场约束不足时现场可执行性失败", () => {
    const missingResource = runValidation({
      selections: [{ measureId: "measure-a", order: 1 }],
      policy: {
        ...validationPolicy,
        contraindicationRules: [],
      },
      site: { ...siteContext, availableResources: ["resource-a"] },
    });
    expect(missingResource.results.siteFeasibility.passed).toBe(false);
    expect(missingResource.results.siteFeasibility.issues).toEqual([
      "resource-unavailable: measure-a/resource-b",
    ]);
    const processBlocked = runValidation({
      selections: [{ measureId: "measure-b", order: 1 }],
      policy: { ...validationPolicy, contraindicationRules: [] },
      site: { ...siteContext, processStatus: "已完工" },
    });
    expect(processBlocked.results.siteFeasibility.issues).toEqual([
      "process-not-executable: 已完工",
    ]);
    const constraintHit = runValidation({
      selections: [{ measureId: "measure-a", order: 1 }],
      policy: { ...validationPolicy, contraindicationRules: [] },
      site: { ...siteContext, constraints: ["contra-1"] },
    });
    expect(constraintHit.results.siteFeasibility.issues).toEqual([
      "site-constraint-hit: measure-a/contra-1",
    ]);
    expect(constraintHit.results.triggerConsistency.passed).toBe(true);
  });

  it("正式记录只接受三项全过并保持待采纳状态", () => {
    const outcome = runValidation({
      selections: [{ measureId: "measure-a", order: 1 }],
      policy: { ...validationPolicy, contraindicationRules: [] },
    });
    const recommendationRef: ResponseRecommendationRefV1 = {
      kind: "response-recommendation",
      reference: { entityId: "recommendation-1", versionId: "1" },
    };
    const record = buildResponseRecommendationRecord({
      recommendationRef,
      primaryWarningRecordRef: primaryWarningRecordRef(WARNINGS),
      outcome,
      actorId: "actor-c27",
      recordedAt: "2033-04-05T06:07:08.000Z",
    });
    expect(record.reviewStatus).toBe("pending");
    expect(record.measureItems).toHaveLength(1);
    expect(record.implementationOrder).toEqual(["measure-a"]);
    expect(record.warningRecordId).toBe("warning-1");
    expect(record.audit.action).toBe("warning-response.validate-and-record");

    const rejected = runValidation({
      selections: [{ measureId: "measure-b", order: 1 }],
      policy: { ...validationPolicy, reviewedStandardEvidence: [] },
    });
    expect(rejected.results.standardsCompliance.passed).toBe(false);
    try {
      buildResponseRecommendationRecord({
        recommendationRef,
        primaryWarningRecordRef: primaryWarningRecordRef(WARNINGS),
        outcome: rejected,
        actorId: "actor-c27",
        recordedAt: "2033-04-05T06:07:08.000Z",
      });
      throw new Error("record must not accept failed validations");
    } catch (error: unknown) {
      const failure = recommendationFailureFrom(error);
      expect(failure?.reasonCode).toBe("recommendation-validation-rejected");
      expect(failure?.code).toBe("BUSINESS_BLOCKED");
    }
  });

  it("主预警与冻结输入摘要按精确引用规范取值", () => {
    expect(primaryWarningRecordRef(WARNINGS)).toEqual(warningRef("warning-1"));
    const digestA = measureCandidateInputDigest({
      projectId: "project-c27",
      warningResponseTaskRef: {
        kind: "warning-response-task",
        reference: { entityId: "task-1", versionId: "2" },
      },
      riskInputRef: {
        kind: "standardized-risk-record",
        reference: { entityId: "risk-1", versionId: "1" },
      },
      measureLibraryReleaseRef: {
        kind: "measure-library-release",
        reference: { entityId: "library-release", versionId: "1" },
      },
      generationPolicyRef: { entityId: "generation-policy", versionId: "1" },
      riskEventCategory: "突涌",
      warnings: WARNINGS,
    });
    expect(digestA).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      measureCandidateInputDigest({
        projectId: "project-c27",
        warningResponseTaskRef: {
          kind: "warning-response-task",
          reference: { entityId: "task-1", versionId: "2" },
        },
        riskInputRef: {
          kind: "standardized-risk-record",
          reference: { entityId: "risk-1", versionId: "1" },
        },
        measureLibraryReleaseRef: {
          kind: "measure-library-release",
          reference: { entityId: "library-release", versionId: "2" },
        },
        generationPolicyRef: { entityId: "generation-policy", versionId: "1" },
        riskEventCategory: "突涌",
        warnings: WARNINGS,
      }),
    ).not.toBe(digestA);
  });

  it("处置任务定义只接受内嵌触发、空工具白名单与冻结候选选择", async () => {
    const agentPolicy = ResponseAgentPolicyV1Schema.parse({
      schemaVersion: "1",
      policyRef: { entityId: "agent-policy", versionId: "1" },
      projectId: "project-c27",
      definitionRef: { entityId: "definition", versionId: "1" },
      toolPolicyRef: { entityId: "tools", versionId: "1" },
      incrementSchemaRef: { entityId: "increment", versionId: "1" },
      validationPolicyRef: { entityId: "validation-policy", versionId: "1" },
      budgetPolicy: {
        schemaVersion: "1",
        policyRef: { entityId: "budget", versionId: "1" },
        modelDeploymentRef: { entityId: "model", versionId: "1" },
        promptTemplateRef: { entityId: "prompt", versionId: "1" },
        toolPolicyRef: { entityId: "tools", versionId: "1" },
        maxModelInvocations: 2,
        maxToolInvocations: 1,
        maxContextTokens: 1024,
        maxInputBytes: 4096,
        maxOutputBytes: 4096,
        maxCandidates: 4,
        maxObjects: 8,
        maxSupplementarySearches: 0,
        maxCorrections: 1,
        maxTransientRetries: 0,
        maxConcurrentActions: 1,
        maxWallClockMs: 60_000,
      },
    });
    const finalized: string[] = [];
    const definition = createResponseRecommendationTaskDefinition({
      policy: agentPolicy,
      port: {
        validateIncrement: () =>
          AgentValidationResultV1Schema.parse({
            schemaVersion: "1",
            items: [
              {
                checkId: "candidate-measure-measure-a",
                disposition: "accepted",
                reasonCode: "measure-in-frozen-candidates",
                evidenceReferences: [],
              },
            ],
            disposition: "accepted",
            validationArtifactRef: {
              kind: "content-artifact",
              reference: { entityId: "validation", versionId: `sha256:${digest("d")}` },
            },
            validatedAt: "2033-04-05T06:07:08.000Z",
          }),
        finalizeIncrement: ({ candidate }) => {
          finalized.push(candidate.selections.map((selection) => selection.measureId).join(","));
          return buildCompletedAgentTaskResult(
            {
              kind: "agent-task",
              reference: { entityId: "agent-task-1", versionId: "1" },
              taskType: RECOMMENDATION_TASK_TYPE_V1,
              triggerMode: "embedded",
              modelDeploymentRef: agentPolicy.budgetPolicy.modelDeploymentRef,
              promptTemplateRef: agentPolicy.budgetPolicy.promptTemplateRef,
              toolPolicyRef: agentPolicy.toolPolicyRef,
              budgetPolicyRef: agentPolicy.budgetPolicy.policyRef,
              incrementSchemaRef: agentPolicy.incrementSchemaRef,
              validationPolicyRef: agentPolicy.validationPolicyRef,
            },
            {
              kind: "recommendation-candidate",
              reference: {
                entityId: "candidate-1",
                versionId: "1",
              } as RecommendationCandidateRefV1["reference"],
            },
            undefined,
            ["recommendation-candidate"],
          );
        },
      },
    });
    expect(definition.metadata.taskType).toBe(RECOMMENDATION_TASK_TYPE_V1);
    expect(definition.metadata.supportedTriggerModes).toEqual(["embedded"]);
    expect(definition.metadata.allowedToolRefs).toEqual([]);
    expect(definition.metadata.resultFamilies).toEqual(["recommendation-candidate"]);
    expect(definition.tools).toEqual([]);
    expect(
      definition.measureCandidateUsage(
        { schemaVersion: "1", selections: [{ measureId: "measure-a", order: 1 }] },
        {} as AgentTaskSnapshotV1,
      ),
    ).toEqual({ candidates: 1, objects: 1 });

    const candidate = ResponseRecommendationIncrementV1Schema.parse({
      schemaVersion: "1",
      selections: [{ measureId: "measure-a", order: 1 }],
    });
    const validation = await definition.validateCandidate(candidate, {} as AgentTaskSnapshotV1);
    expect(validation.disposition).toBe("accepted");
    const result = await definition.finalizeCandidate(candidate, {} as AgentTaskSnapshotV1);
    expect(finalized).toEqual(["measure-a"]);
    expect(result.status).toBe("completed");
    expect(
      ResponseRecommendationIncrementV1Schema.safeParse({
        schemaVersion: "1",
        op: "replace",
        selections: [{ measureId: "measure-a", order: 1 }],
      }).success,
    ).toBe(false);
    expect(
      ResponseRecommendationIncrementV1Schema.safeParse({
        schemaVersion: "1",
        selections: [
          { measureId: "measure-a", order: 1 },
          { measureId: "measure-a", order: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(
      ResponseRecommendationIncrementV1Schema.safeParse({
        schemaVersion: "1",
        selections: [
          { measureId: "measure-a", order: 1 },
          { measureId: "measure-b", order: 3 },
        ],
      }).success,
    ).toBe(false);
    expect(
      ResponseRecommendationIncrementV1Schema.safeParse({ schemaVersion: "1", selections: [] })
        .success,
    ).toBe(false);
    expect(ResponseGenerationPolicyV1Schema.safeParse({ schemaVersion: "1" }).success).toBe(false);
  });

  it("失败事实源保持闭合分类", () => {
    try {
      failRecommendation("recommendation-warning-mismatch", warningRef("warning-1"));
      throw new Error("failRecommendation must throw");
    } catch (error: unknown) {
      const failure = recommendationFailureFrom(error);
      expect(failure?.code).toBe("BUSINESS_BLOCKED");
      expect(failure?.targetRef).toEqual(warningRef("warning-1"));
    }
    expect(recommendationFailureFrom(new Error("other"))).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* 风险等级触发分支（design D-13）                                             */
/* -------------------------------------------------------------------------- */

const RISK_LEVEL_THRESHOLD_ID = "threshold-risk-1";
const RISK_LEVEL_ID = "level-4";
const RISK_LEVEL_ACCEPTED_ID = "level-3";

/** 合格冻结依据：配置引用、等级序数与有效指标集合都自洽。 */
const riskAcceptanceBasis = (overrides: Record<string, unknown> = {}) => ({
  thresholdReleaseRef: { entityId: "threshold-release", versionId: "1" },
  riskMatrixReleaseRef: { entityId: "matrix-release", versionId: "1" },
  thresholdArtifactRef: {
    kind: "content-artifact",
    reference: { entityId: "threshold", versionId: `sha256:${digest("a")}` },
  },
  riskMatrixArtifactRef: {
    kind: "content-artifact",
    reference: { entityId: "matrix", versionId: `sha256:${digest("b")}` },
  },
  thresholdId: RISK_LEVEL_THRESHOLD_ID,
  maximumAcceptedLevelId: RISK_LEVEL_ACCEPTED_ID,
  riskLevelId: RISK_LEVEL_ID,
  maximumAcceptedLevelOrdinal: 3,
  riskLevelOrdinal: 4,
  assessedIndicatorIds: ["indicator-1"],
  ...overrides,
});

const riskLevelWarning = (input: {
  readonly id: string;
  readonly thresholdId?: string;
  readonly riskLevelId?: string;
  readonly basis?: Record<string, unknown> | null;
  readonly indicatorItem?: string;
}): RecommendationFrozenWarningV1 =>
  RecommendationFrozenWarningV1Schema.parse({
    ...warning({
      id: input.id,
      triggerType: "风险等级超过风险可接受阈值",
      indicatorItem: input.indicatorItem ?? input.thresholdId ?? RISK_LEVEL_THRESHOLD_ID,
      resolvedTargetIndicatorIds: [],
      unresolvedTriggerItems: [],
    }),
    triggerIndicators: [
      {
        indicatorItem: input.indicatorItem ?? input.thresholdId ?? RISK_LEVEL_THRESHOLD_ID,
        triggerType: "风险等级超过风险可接受阈值",
        actualValue: input.riskLevelId ?? RISK_LEVEL_ID,
      },
    ],
    ...(input.basis === null
      ? {}
      : { riskAcceptanceBasis: riskAcceptanceBasis(input.basis ?? {}) }),
  });

const riskLevelLibrary = {
  measures: [
    measure({
      measureId: "measure-level",
      riskEventCategory: "突涌",
      triggerTypes: ["风险等级超过风险可接受阈值"],
      targetIndicatorIds: ["indicator-1"],
      resourceRequirements: ["resource-a"],
      applicability: [{ dimension: "地层条件数据", values: ["地层-x"] }],
    }),
    measure({
      measureId: "measure-level-monitor",
      riskEventCategory: "突涌",
      triggerTypes: ["监测指标越限"],
      targetIndicatorIds: ["indicator-1"],
      resourceRequirements: ["resource-a"],
      applicability: [{ dimension: "地层条件数据", values: ["地层-x"] }],
    }),
  ],
};

const riskLevelPolicy = ResponseValidationPolicyV1Schema.parse({
  schemaVersion: "1",
  policyRef: { entityId: "risk-level-validation-policy", versionId: "1" },
  projectId: "project-c27",
  targetIndicators: [{ indicatorItem: "indicator-1", targetValue: 5 }],
  reviewedStandardEvidence: [
    { measureId: "measure-level", evidenceItem: "evidence-standard" },
    { measureId: "measure-level-monitor", evidenceItem: "evidence-standard" },
  ],
  contraindicationRules: [],
  executableProcessStatuses: ["掘进"],
});

const riskLevelSelections = [{ measureId: "measure-level", order: 1 }];
const riskLevelCandidates = (warnings: readonly RecommendationFrozenWarningV1[]) =>
  selectFrozenMeasures({
    library: riskLevelLibrary,
    riskEventCategory: "突涌",
    applicability: [
      { dimension: "地层条件数据", values: ["地层-x"] },
      { dimension: "施工工法数据", values: ["盾构法"] },
      { dimension: "工程阶段数据", values: ["掘进"] },
    ],
    warnings: warnings.map((entry) => ({
      warningRecordRef: entry.warningRecordRef,
      triggerType: entry.triggerType,
    })),
  });

const runRiskLevelValidation = (input: {
  readonly warnings: readonly RecommendationFrozenWarningV1[];
  readonly selections?: readonly { readonly measureId: string; readonly order: number }[];
  readonly policy?: unknown;
}) =>
  validateRecommendationCandidate({
    candidateSet: candidateSetOf({
      candidates: riskLevelCandidates(input.warnings),
      warnings: input.warnings,
    }),
    selections: input.selections ?? riskLevelSelections,
    validationPolicy: ResponseValidationPolicyV1Schema.parse(input.policy ?? riskLevelPolicy),
    siteContext,
  });

describe("D-13 风险等级触发分支", () => {
  it("单独风险等级预警在依据与措施自洽时通过并可正式入库", () => {
    const outcome = runRiskLevelValidation({
      warnings: [riskLevelWarning({ id: "warning-level" })],
    });
    expect(outcome.results.triggerConsistency.passed).toBe(true);
    expect(
      outcome.diagnostics.find((entry) => entry.reasonCode === "risk-acceptance-basis-verified"),
    ).toMatchObject({ checkId: "trigger-consistency", passed: true });
    // 通过即可正式建记录：三项校验齐全，人工采纳边界不变。
    expect(recommendationValidationPassedAll(outcome.results)).toBe(true);
    // 合格候选可正式建记录：人工采纳边界不变，记录仍是待审状态。
    const record = buildResponseRecommendationRecord({
      recommendationRef: {
        kind: "response-recommendation",
        reference: { entityId: "rec-level", versionId: "1" },
      },
      primaryWarningRecordRef: primaryWarningRecordRef([riskLevelWarning({ id: "warning-level" })]),
      outcome,
      actorId: "actor-c27",
      recordedAt: "2033-04-05T06:07:08.000Z",
    });
    expect(record.reviewStatus).toBe("pending");
    expect(record.measureItems.map((entry) => entry.measureId)).toEqual(["measure-level"]);
  });

  it("混合触发的任务按各自类型分流：等级分支不牵连监测分支判定", () => {
    const outcome = runRiskLevelValidation({
      warnings: [
        warning({
          id: "warning-monitor",
          triggerType: "监测指标越限",
          indicatorItem: "indicator-1",
        }),
        riskLevelWarning({ id: "warning-level" }),
      ],
      selections: [
        { measureId: "measure-level", order: 1 },
        { measureId: "measure-level-monitor", order: 2 },
      ],
    });
    expect(outcome.results.triggerConsistency.passed).toBe(true);
    expect(recommendationValidationPassedAll(outcome.results)).toBe(true);
  });

  it("冻结依据缺失或与预警事实错配时失败闭合", () => {
    const missing = runRiskLevelValidation({
      warnings: [riskLevelWarning({ id: "warning-level", basis: null })],
    });
    expect(missing.results.triggerConsistency.passed).toBe(false);
    // 触发项仍未解析——不允许只清空未解析集合就放行。
    expect(missing.diagnostics.map((entry) => entry.reasonCode)).toContain(
      "risk-acceptance-basis-unavailable",
    );

    const mismatched = runRiskLevelValidation({
      warnings: [
        riskLevelWarning({ id: "warning-level", basis: { thresholdId: "threshold-other" } }),
      ],
    });
    expect(mismatched.results.triggerConsistency.passed).toBe(false);
    expect(mismatched.diagnostics.map((entry) => entry.reasonCode)).toContain(
      "risk-acceptance-basis-mismatch",
    );

    // 等级没有越过可接受等级时，依据摘要本身自相矛盾，同样失败。
    const notExceeded = runRiskLevelValidation({
      warnings: [riskLevelWarning({ id: "warning-level", basis: { riskLevelOrdinal: 3 } })],
    });
    expect(notExceeded.results.triggerConsistency.passed).toBe(false);
  });

  it("风险等级预警没有对应措施时失败闭合", () => {
    const outcome = runRiskLevelValidation({
      warnings: [riskLevelWarning({ id: "warning-level" })],
      selections: [],
    });
    expect(outcome.results.triggerConsistency.passed).toBe(false);
    expect(outcome.diagnostics.map((entry) => entry.reasonCode)).toContain(
      "risk-level-measure-uncovered",
    );
  });

  it("措施目标不属于关联评估有效指标、或缺少审核目标值时失败闭合", () => {
    const outOfScope = runRiskLevelValidation({
      warnings: [
        riskLevelWarning({ id: "warning-level", basis: { assessedIndicatorIds: ["indicator-2"] } }),
      ],
    });
    expect(outOfScope.results.triggerConsistency.passed).toBe(false);
    expect(outOfScope.diagnostics.map((entry) => entry.reasonCode)).toContain(
      "risk-level-target-out-of-scope",
    );

    const noTargetValue = runRiskLevelValidation({
      warnings: [riskLevelWarning({ id: "warning-level" })],
      policy: ResponseValidationPolicyV1Schema.parse({
        ...riskLevelPolicy,
        targetIndicators: [{ indicatorItem: "indicator-2", targetValue: 5 }],
      }),
    });
    expect(noTargetValue.results.triggerConsistency.passed).toBe(false);
    expect(noTargetValue.diagnostics.map((entry) => entry.reasonCode)).toContain(
      "target-indicator-unavailable",
    );
  });

  it("监测分支解析失败仍然阻断候选，不因新增等级分支而放行", () => {
    const outcome = runRiskLevelValidation({
      warnings: [
        {
          ...riskLevelWarning({ id: "warning-level" }),
        },
        {
          ...warning({
            id: "warning-monitor",
            triggerType: "监测指标越限",
            indicatorItem: "indicator-1",
            resolvedTargetIndicatorIds: [],
            unresolvedTriggerItems: ["threshold-missing"],
          }),
        },
      ],
    });
    expect(outcome.results.triggerConsistency.passed).toBe(false);
    expect(outcome.diagnostics.map((entry) => entry.reasonCode)).toContain(
      "trigger-mapping-unavailable",
    );
  });
});
