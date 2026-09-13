import { describe, expect, it } from "vitest";

import type { KnowledgeReleaseRefV1, KnowledgeRevisionRefV1 } from "@riskflow/contracts/ports";

import {
  ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1,
  type AssessmentConfigurationDefinitionTypeV1,
} from "../../src/assessment-config/index.js";
import {
  AssessmentBasisReleaseSetMembersV1Schema,
  ReadAssessmentBasisReleaseSetV1Schema,
  ScoringRuleAuthoringCandidateV1Schema,
  applicableRuleSetDocumentDigest,
  assembleApplicableRuleSet,
  assertScoringRuleMembersMatchApplicableRuleSet,
  buildAssessmentBasisMembers,
  detectRuleRelations,
  evaluateScoringRule,
  materializeScoringRuleDocument,
  normalizeGradeIntervals,
  normalizeScoringThresholds,
  projectApplicableRuleSetMembers,
  structuredScoringRuleDocumentDigest,
  validateScoringRuleOperations,
  type ApplicableRuleSetDocumentV1,
  type AssessmentBasisReleaseSetMemberV1,
  type ScoringRuleRelationCandidateV1,
} from "../../src/scoring-rules/index.js";
import {
  REAL_STANDARD_SEGMENT_ID,
  REAL_STANDARD_SOURCE_VERSION,
  SCORING_RULES_FIXTURE_CONFIGURATION_SET_REF,
  SCORING_RULES_FIXTURE_INDICATOR_IDS,
  SCORING_RULES_FIXTURE_PROJECT_REVISION,
  makeApplicabilityConditions,
  makeScoringRule,
  makeScoringRuleCandidate,
  makeScoringRuleSourceBinding,
  makeScoringRulesFixtureManifest,
  makeScoringRulesFixturePolicy,
  scoringRulesFixtureAgentTaskRef,
} from "./fixture.js";

const baseInput = () => ({
  manifest: makeScoringRulesFixtureManifest(),
  policy: makeScoringRulesFixturePolicy(),
  agentTaskRef: scoringRulesFixtureAgentTaskRef,
  indicatorIds: [...SCORING_RULES_FIXTURE_INDICATOR_IDS],
  configurationSetRef: SCORING_RULES_FIXTURE_CONFIGURATION_SET_REF,
  compatibilityRef: { entityId: "compatibility-fixture", versionId: "1" },
});

const releaseFor = (ruleId: string): KnowledgeReleaseRefV1 => ({
  kind: "knowledge-release",
  reference: { entityId: `release-${ruleId}`, versionId: "1" },
});

const revisionFor = (ruleId: string): KnowledgeRevisionRefV1 => ({
  kind: "knowledge-revision",
  reference: { entityId: `revision-${ruleId}`, versionId: "1" },
});

describe("C19 结构化评分规则与适用规则集", () => {
  describe("内容校验", () => {
    it("完整规则通过内容校验并记录内容摘要、兼容集合与精确证据引用", () => {
      const outcome = validateScoringRuleOperations({
        ...baseInput(),
        candidate: makeScoringRuleCandidate(),
      });

      expect(outcome.disposition).toBe("accepted");
      expect(outcome.acceptedMembers).toHaveLength(1);
      const member = outcome.acceptedMembers[0]!;
      expect(member.rule.reviewStatus).toBe("pending");
      expect(member.rule.evidenceLocator.sourceSegmentId).toBe(REAL_STANDARD_SEGMENT_ID);
      expect(member.binding.sourceVersionRef).toEqual(REAL_STANDARD_SOURCE_VERSION);
      expect(member.rule.ruleVersion.versionId).not.toBe("pending");

      const document = materializeScoringRuleDocument({
        manifest: baseInput().manifest,
        agentTaskRef: scoringRulesFixtureAgentTaskRef,
        members: outcome.acceptedMembers,
      });
      expect(document.members.map((entry) => entry.rule.ruleId)).toEqual([
        "rule-ground-settlement",
      ]);
      expect(structuredScoringRuleDocumentDigest(document)).toMatch(/^[0-9a-f]{64}$/u);
    });

    it("不完整或悬空规则被拒绝并给出稳定原因码", () => {
      const cases = [
        {
          reason: "scoring-rule-applicability-incomplete",
          candidate: makeScoringRuleCandidate({
            operations: [
              {
                kind: "add-rule",
                ruleId: "rule-ground-settlement",
                rule: makeScoringRule({
                  applicabilityConditions: makeApplicabilityConditions({
                    constructionMethod: ["盾构法", "盾构法"],
                  }),
                }),
                sourceVersionRef: REAL_STANDARD_SOURCE_VERSION,
                evidenceReferences: makeScoringRuleSourceBinding().evidenceReferences,
              },
            ],
          }),
        },
        {
          reason: "scoring-rule-indicator-unknown",
          candidate: makeScoringRuleCandidate({
            operations: [
              {
                kind: "add-rule",
                ruleId: "rule-ground-settlement",
                rule: makeScoringRule({ indicatorItem: "indicator-missing" }),
                sourceVersionRef: REAL_STANDARD_SOURCE_VERSION,
                evidenceReferences: makeScoringRuleSourceBinding().evidenceReferences,
              },
            ],
          }),
        },
        {
          reason: "scoring-rule-exception-unknown",
          candidate: makeScoringRuleCandidate({
            operations: [
              {
                kind: "add-rule",
                ruleId: "rule-ground-settlement",
                rule: makeScoringRule({ exceptionClauses: ["clause-missing"] }),
                sourceVersionRef: REAL_STANDARD_SOURCE_VERSION,
                evidenceReferences: makeScoringRuleSourceBinding().evidenceReferences,
              },
            ],
          }),
        },
        {
          reason: "scoring-rule-evidence-unverified",
          candidate: makeScoringRuleCandidate({
            operations: [
              {
                kind: "add-rule",
                ruleId: "rule-ground-settlement",
                rule: makeScoringRule({
                  evidenceLocator: { sourceSegmentId: "GB50446-2017/未保留/证据" },
                }),
                sourceVersionRef: REAL_STANDARD_SOURCE_VERSION,
                evidenceReferences: makeScoringRuleSourceBinding().evidenceReferences,
              },
            ],
          }),
        },
        {
          reason: "scoring-rule-review-status-not-pending",
          candidate: makeScoringRuleCandidate({
            operations: [
              {
                kind: "add-rule",
                ruleId: "rule-ground-settlement",
                rule: makeScoringRule({ reviewStatus: "approved" }),
                sourceVersionRef: REAL_STANDARD_SOURCE_VERSION,
                evidenceReferences: makeScoringRuleSourceBinding().evidenceReferences,
              },
            ],
          }),
        },
        {
          reason: "scoring-rule-threshold-invalid",
          candidate: makeScoringRuleCandidate({
            operations: [
              {
                kind: "add-rule",
                ruleId: "rule-ground-settlement",
                rule: makeScoringRule({
                  scoringThresholds: [
                    { thresholdId: "t-1", score: 1, operator: "between", value: 0, upperValue: 20 },
                    {
                      thresholdId: "t-2",
                      score: 3,
                      operator: "between",
                      value: 10,
                      upperValue: 30,
                    },
                  ],
                }),
                sourceVersionRef: REAL_STANDARD_SOURCE_VERSION,
                evidenceReferences: makeScoringRuleSourceBinding().evidenceReferences,
              },
            ],
          }),
        },
        {
          reason: "scoring-rule-grade-invalid",
          candidate: makeScoringRuleCandidate({
            operations: [
              {
                kind: "add-rule",
                ruleId: "rule-ground-settlement",
                rule: makeScoringRule({
                  gradeIntervals: [
                    { grade: "grade-a", lowerBound: 0, upperBound: 2.5 },
                    { grade: "grade-b", lowerBound: 2.6 },
                  ],
                }),
                sourceVersionRef: REAL_STANDARD_SOURCE_VERSION,
                evidenceReferences: makeScoringRuleSourceBinding().evidenceReferences,
              },
            ],
          }),
        },
      ] as const;

      for (const testCase of cases) {
        const outcome = validateScoringRuleOperations({
          ...baseInput(),
          candidate: testCase.candidate,
        });
        expect(outcome.disposition, testCase.reason).toBe("rejected");
        expect(outcome.acceptedMembers, testCase.reason).toHaveLength(0);
        expect(
          outcome.validation.items.some(
            (item) => item.disposition === "rejected" && item.reasonCode === testCase.reason,
          ),
          testCase.reason,
        ).toBe(true);
      }
    });
  });

  describe("评分边界", () => {
    it("between 与等级区间共享端点按左闭右开唯一求值", () => {
      const rule = makeScoringRule();
      expect(evaluateScoringRule(rule, 9.99)).toEqual({
        kind: "evaluated",
        thresholdId: "settlement-low",
        score: 1,
        grade: "grade-c",
      });
      expect(evaluateScoringRule(rule, 10)).toEqual({
        kind: "evaluated",
        thresholdId: "settlement-mid",
        score: 3,
        grade: "grade-c",
      });
      expect(evaluateScoringRule(rule, 2.5)).toEqual({
        kind: "evaluated",
        thresholdId: "settlement-low",
        score: 1,
        grade: "grade-b",
      });
      expect(evaluateScoringRule(rule, 4.5)).toEqual({
        kind: "evaluated",
        thresholdId: "settlement-low",
        score: 1,
        grade: "grade-c",
      });

      const unbounded = makeScoringRule({
        ruleId: "rule-unbounded",
        scoringThresholds: [
          { thresholdId: "t-low", score: 1, operator: "lt", value: 5 },
          { thresholdId: "t-high", score: 5, operator: "gte", value: 5 },
        ],
        gradeIntervals: [
          { grade: "grade-low", upperBound: 5 },
          { grade: "grade-high", lowerBound: 5 },
        ],
      });
      expect(evaluateScoringRule(unbounded, -1_000)).toEqual({
        kind: "evaluated",
        thresholdId: "t-low",
        score: 1,
        grade: "grade-low",
      });
      expect(evaluateScoringRule(unbounded, 5)).toEqual({
        kind: "evaluated",
        thresholdId: "t-high",
        score: 5,
        grade: "grade-high",
      });

      const normalized = normalizeScoringThresholds(rule.scoringThresholds);
      expect(normalized.map((value) => value.thresholdId)).toEqual([
        "settlement-low",
        "settlement-mid",
        "settlement-high",
      ]);
      const grades = normalizeGradeIntervals(rule.gradeIntervals);
      expect(grades[0]).toMatchObject({ grade: "grade-a", upperInclusive: false });
      expect(grades[2]).toMatchObject({ grade: "grade-c", upper: null });
    });

    it("不连续或越界取值被拒绝且不按相邻区间或默认等级补值", () => {
      expect(() =>
        normalizeScoringThresholds([
          { thresholdId: "t-1", score: 1, operator: "between", value: 0, upperValue: 10 },
          { thresholdId: "t-2", score: 3, operator: "between", value: 11, upperValue: 20 },
        ]),
      ).toThrowError(/BUSINESS_BLOCKED/u);
      expect(() =>
        normalizeGradeIntervals([
          { grade: "grade-a", lowerBound: 0, upperBound: 2 },
          { grade: "grade-b", lowerBound: 2, upperBound: 4 },
          { grade: "grade-d", lowerBound: 5 },
        ]),
      ).toThrowError(/BUSINESS_BLOCKED/u);

      const bounded = makeScoringRule({
        ruleId: "rule-bounded",
        scoringThresholds: [
          { thresholdId: "t-1", score: 1, operator: "between", value: 0, upperValue: 10 },
        ],
        gradeIntervals: [{ grade: "grade-a", lowerBound: 0, upperBound: 5 }],
      });
      expect(evaluateScoringRule(bounded, 10)).toEqual({
        kind: "rejected",
        reasonCode: "scoring-value-out-of-range",
      });
      expect(evaluateScoringRule(bounded, 7)).toEqual({
        kind: "rejected",
        reasonCode: "scoring-value-out-of-range",
      });
      expect(evaluateScoringRule(bounded, "text")).toEqual({
        kind: "rejected",
        reasonCode: "scoring-value-type-mismatch",
      });
    });
  });

  describe("三维适用性", () => {
    const candidateFor = (ruleId: string, rule = makeScoringRule({ ruleId })) =>
      ({
        member: { rule, binding: makeScoringRuleSourceBinding() },
        ruleReleaseRef: releaseFor(ruleId),
        ruleRevisionRef: revisionFor(ruleId),
        artifactRef: {
          kind: "content-artifact",
          reference: { entityId: `artifact-${ruleId}`, versionId: "1" },
        },
        contentDigest: "d".repeat(64),
      }) as const;

    it("三维匹配规则被纳入并记录三维匹配证据", () => {
      const document = assembleApplicableRuleSet({
        projectRevisionRef: SCORING_RULES_FIXTURE_PROJECT_REVISION,
        applicabilitySnapshotRef: {
          kind: "applicability-metadata-snapshot",
          reference: { entityId: "applicability-snapshot", versionId: "1" },
        },
        applicability: {
          constructionMethod: "盾构法",
          stratumCondition: "软土地层",
          engineeringStage: "盾构掘进",
        },
        configurationSetRef: SCORING_RULES_FIXTURE_CONFIGURATION_SET_REF,
        compatibilityRef: { entityId: "compatibility-fixture", versionId: "1" },
        policy: makeScoringRulesFixturePolicy(),
        requiredAt: "2030-01-01T00:00:00.000Z",
        candidates: [candidateFor("rule-ground-settlement")],
        relations: [],
      });
      expect(document.includedMembers).toHaveLength(1);
      const decision = document.decisions[0]!;
      expect(decision.decision).toBe("included");
      expect(decision.matchedDimensions).toEqual(["施工工法数据", "地层条件数据", "工程阶段数据"]);
      expect(applicableRuleSetDocumentDigest(document)).toMatch(/^[0-9a-f]{64}$/u);
    });

    it("不适用规则全部筛除并给出维度或例外原因", () => {
      const mismatched = candidateFor(
        "rule-method-mismatch",
        makeScoringRule({
          ruleId: "rule-method-mismatch",
          applicabilityConditions: makeApplicabilityConditions({ constructionMethod: ["矿山法"] }),
        }),
      );
      const exceptionCase = candidateFor(
        "rule-exception",
        makeScoringRule({ ruleId: "rule-exception" }),
      );
      expect(() =>
        assembleApplicableRuleSet({
          projectRevisionRef: SCORING_RULES_FIXTURE_PROJECT_REVISION,
          applicabilitySnapshotRef: {
            kind: "applicability-metadata-snapshot",
            reference: { entityId: "applicability-snapshot", versionId: "1" },
          },
          applicability: {
            constructionMethod: "盾构法",
            stratumCondition: "软土地层",
            engineeringStage: "盾构掘进",
          },
          configurationSetRef: SCORING_RULES_FIXTURE_CONFIGURATION_SET_REF,
          compatibilityRef: { entityId: "compatibility-fixture", versionId: "1" },
          policy: makeScoringRulesFixturePolicy(),
          requiredAt: "2030-01-01T00:00:00.000Z",
          candidates: [mismatched],
          relations: [],
        }),
      ).toThrowError(/BUSINESS_BLOCKED/u);

      const mixed = assembleApplicableRuleSet({
        projectRevisionRef: SCORING_RULES_FIXTURE_PROJECT_REVISION,
        applicabilitySnapshotRef: {
          kind: "applicability-metadata-snapshot",
          reference: { entityId: "applicability-snapshot", versionId: "1" },
        },
        applicability: {
          constructionMethod: "盾构法",
          stratumCondition: "软土地层",
          engineeringStage: "盾构掘进",
        },
        configurationSetRef: SCORING_RULES_FIXTURE_CONFIGURATION_SET_REF,
        compatibilityRef: { entityId: "compatibility-fixture", versionId: "1" },
        policy: makeScoringRulesFixturePolicy(),
        requiredAt: "2030-01-01T00:00:00.000Z",
        candidates: [candidateFor("rule-ground-settlement"), mismatched, exceptionCase],
        relations: [],
        exceptionsByRuleId: { "rule-exception": ["clause-protection"] },
      });
      const byRule = new Map(
        mixed.decisions.map((decision) => [decision.ruleId, decision] as const),
      );
      expect(byRule.get("rule-method-mismatch")?.reasonCode).toBe("construction-method-mismatch");
      expect(byRule.get("rule-exception")?.reasonCode).toBe("exception-applies");
      expect(mixed.includedMembers.map((member) => member.ruleId)).toEqual([
        "rule-ground-settlement",
      ]);
      expect(mixed.decisions).toHaveLength(3);
    });
  });

  describe("冲突", () => {
    const relationCandidate = (
      ruleId: string,
      thresholds: ScoringRuleRelationCandidateV1["rule"]["scoringThresholds"],
      grades: ScoringRuleRelationCandidateV1["rule"]["gradeIntervals"],
      sourceVersionRef = REAL_STANDARD_SOURCE_VERSION,
    ): ScoringRuleRelationCandidateV1 => ({
      rule: makeScoringRule({
        ruleId,
        indicatorItem: SCORING_RULES_FIXTURE_INDICATOR_IDS[0],
        scoringThresholds: thresholds,
        gradeIntervals: grades,
      }),
      sourceVersionRef,
    });

    it("冲突规则全部被拦截并给出闭合拟议处置", () => {
      const relations = detectRuleRelations({
        policyRef: { entityId: "rule-conflict-priority", versionId: "1" },
        candidates: [
          relationCandidate(
            "rule-a",
            [{ thresholdId: "a-1", score: 1, operator: "between", value: 0, upperValue: 20 }],
            [{ grade: "grade-a", lowerBound: 0 }],
            {
              kind: "source-version",
              reference: { entityId: "GB50446-2017", versionId: "2017-08-01" },
            },
          ),
          relationCandidate(
            "rule-b",
            [{ thresholdId: "b-1", score: 5, operator: "between", value: 0, upperValue: 20 }],
            [{ grade: "grade-c", lowerBound: 0 }],
            {
              kind: "source-version",
              reference: { entityId: "GB50911-2013", versionId: "2014-05-01" },
            },
          ),
        ],
      });

      expect(relations).toHaveLength(1);
      const conflict = relations[0]!;
      expect(conflict.relationKind).toBe("conflict");
      expect(conflict.retainedRuleVersionRef?.entityId).toBe("rule-a");
      expect(conflict.excludedRuleVersionRef?.entityId).toBe("rule-b");
      expect(conflict.overlap.lower).toBe(0);
      expect(conflict.overlap.upper).toBe(20);
      expect(conflict.relationId).toMatch(/^[0-9a-f]{64}$/u);
    });
  });

  describe("重叠", () => {
    it("等价重叠被完整记录并按闭合优先级确定保留成员", () => {
      const relations = detectRuleRelations({
        policyRef: { entityId: "rule-conflict-priority", versionId: "1" },
        candidates: [
          {
            rule: makeScoringRule({
              ruleId: "rule-overlap-settlement-a",
              scoringThresholds: [
                { thresholdId: "a-1", score: 3, operator: "between", value: 0, upperValue: 20 },
              ],
              gradeIntervals: [{ grade: "grade-b", lowerBound: 0 }],
            }),
            sourceVersionRef: REAL_STANDARD_SOURCE_VERSION,
          },
          {
            rule: makeScoringRule({
              ruleId: "rule-overlap-settlement-b",
              scoringThresholds: [
                { thresholdId: "b-1", score: 3, operator: "between", value: 5, upperValue: 15 },
              ],
              gradeIntervals: [{ grade: "grade-b", lowerBound: 0 }],
            }),
            sourceVersionRef: REAL_STANDARD_SOURCE_VERSION,
          },
        ],
      });

      expect(relations).toHaveLength(1);
      expect(relations[0]!.relationKind).toBe("overlap");
      expect(relations[0]!.retainedRuleVersionRef).toBeUndefined();
      expect(relations[0]!.overlap.leftThresholdIds).toEqual(["a-1"]);
      expect(relations[0]!.overlap.rightThresholdIds).toEqual(["b-1"]);
      expect(relations[0]!.overlap.lower).toBe(5);
      expect(relations[0]!.overlap.upper).toBe(15);
    });
  });

  describe("basis 成员清单", () => {
    const member = (ruleId: string): AssessmentBasisReleaseSetMemberV1 => ({
      releaseRef: releaseFor(ruleId),
      revisionRef: revisionFor(ruleId),
      artifactRef: {
        kind: "content-artifact",
        reference: { entityId: `artifact-${ruleId}`, versionId: "1" },
      },
      contentDigest: "e".repeat(64),
    });

    const configurationMember = (
      definitionType: AssessmentConfigurationDefinitionTypeV1,
    ): {
      readonly definitionType: AssessmentConfigurationDefinitionTypeV1;
      readonly releaseRef: KnowledgeReleaseRefV1;
      readonly revisionRef: KnowledgeRevisionRefV1;
      readonly artifactRef: AssessmentBasisReleaseSetMemberV1["artifactRef"];
      readonly contentDigest: string;
    } => ({
      definitionType,
      releaseRef: {
        kind: "knowledge-release",
        reference: { entityId: `release-${definitionType}`, versionId: "1" },
      },
      revisionRef: {
        kind: "knowledge-revision",
        reference: { entityId: `revision-${definitionType}`, versionId: "1" },
      },
      artifactRef: {
        kind: "content-artifact",
        reference: { entityId: `artifact-${definitionType}`, versionId: "1" },
      },
      contentDigest: "f".repeat(64),
    });

    it("basis 成员清单固定精确引用且配置成员恰好 11 类", () => {
      const members = buildAssessmentBasisMembers({
        applicableRuleSetMember: member("applicable-rule-set"),
        scoringRuleMembers: [member("rule-b"), member("rule-a"), member("rule-a")],
        configurationMembers: [...ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1]
          .sort()
          .map(configurationMember),
      });
      expect(members.configurationMembers).toHaveLength(11);
      expect(members.configurationMembers.map((entry) => entry.definitionType)).toEqual(
        [...ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1].sort(),
      );
      expect(
        members.scoringRuleMembers.map((entry) => entry.releaseRef.reference.entityId),
      ).toEqual(["release-rule-a", "release-rule-b"]);
    });

    it("basis 规则成员与摘要与适用规则集 included refs 双向完备", () => {
      const document: ApplicableRuleSetDocumentV1 = {
        schemaVersion: "1",
        projectRevisionRef: SCORING_RULES_FIXTURE_PROJECT_REVISION,
        applicabilitySnapshotRef: {
          kind: "applicability-metadata-snapshot",
          reference: { entityId: "applicability-snapshot", versionId: "1" },
        },
        applicability: {
          constructionMethod: "盾构法",
          stratumCondition: "软土地层",
          engineeringStage: "盾构掘进",
        },
        configurationSetRef: SCORING_RULES_FIXTURE_CONFIGURATION_SET_REF,
        compatibilityRef: { entityId: "compatibility-fixture", versionId: "1" },
        assemblyPolicyRef: { entityId: "scoring-rule-assembly-policy", versionId: "1" },
        requiredAt: "2030-01-01T00:00:00.000Z",
        includedMembers: [
          {
            ruleId: "rule-a",
            ruleVersion: { entityId: "rule-a", versionId: "sha256:1" },
            ...member("rule-a"),
          },
        ],
        decisions: [
          {
            ruleId: "rule-a",
            ruleVersion: { entityId: "rule-a", versionId: "sha256:1" },
            decision: "included",
            reasonCode: "three-dimensional-match",
            matchedDimensions: ["施工工法数据"],
            relationRefs: [],
          },
        ],
      };

      const projected = projectApplicableRuleSetMembers(document);
      expect(projected).toEqual([member("rule-a")]);
      expect(() =>
        assertScoringRuleMembersMatchApplicableRuleSet({
          document,
          scoringRuleMembers: projected,
        }),
      ).not.toThrow();
      expect(() =>
        assertScoringRuleMembersMatchApplicableRuleSet({
          document,
          scoringRuleMembers: [...projected, member("rule-extra")],
        }),
      ).toThrowError(/BUSINESS_BLOCKED/u);
    });

    it("basis 无正文：strict 成员与请求不接受正文、显示名或枚举字段", () => {
      const parsed = AssessmentBasisReleaseSetMembersV1Schema.safeParse({
        applicableRuleSetMember: { ...member("applicable-rule-set"), displayName: "规则集" },
        scoringRuleMembers: [member("rule-a")],
        configurationMembers: ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1.map(configurationMember),
      });
      expect(parsed.success).toBe(false);

      const request = ReadAssessmentBasisReleaseSetV1Schema.safeParse({
        requestId: "request-1",
        idempotencyKey: "idempotency-1",
        projectId: "project-1",
        actorId: "actor-1",
        requestedAt: "2030-01-01T00:00:00.000Z",
        authorization: {
          schemaVersion: "1",
          authorizationContextRef: {
            kind: "authorization-context",
            reference: { entityId: "authorization-context-1", versionId: "1" },
          },
          actorId: "actor-1",
          projectId: "project-1",
          grantedCapabilities: ["knowledge-modeling.read"],
          spatialScopeRefs: [],
          sourceAccessGrantRefs: [],
          authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
          decidedAt: "2030-01-01T00:00:00.000Z",
          invocation: { kind: "human" },
        },
        assessmentBasisReleaseSetRef: {
          kind: "assessment-basis-release-set",
          reference: { entityId: "basis-1", versionId: "1" },
        },
        latest: true,
      });
      expect(request.success).toBe(false);
    });

    it("basis 读取幂等：相同规范载荷解析为同一请求与同一成员摘要", () => {
      const payload = {
        applicableRuleSetMember: member("applicable-rule-set"),
        scoringRuleMembers: [member("rule-a")],
        configurationMembers: [...ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1]
          .sort()
          .map(configurationMember),
      };
      const first = AssessmentBasisReleaseSetMembersV1Schema.parse(payload);
      const second = AssessmentBasisReleaseSetMembersV1Schema.parse(
        JSON.parse(JSON.stringify(payload)) as unknown,
      );
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(buildAssessmentBasisMembers(payload)).toEqual(first);
    });
  });

  it("候选 schema 只接受 add-rule 与 replace-rule 操作", () => {
    expect(
      ScoringRuleAuthoringCandidateV1Schema.safeParse({
        schemaVersion: "1",
        candidateVersion: 1,
        operations: [{ kind: "delete-rule", ruleId: "rule-a" }],
      }).success,
    ).toBe(false);
    const replace = ScoringRuleAuthoringCandidateV1Schema.safeParse(
      makeScoringRuleCandidate({
        operations: [
          {
            kind: "replace-rule",
            ruleId: "rule-ground-settlement",
            baseRuleVersion: { entityId: "rule-ground-settlement", versionId: "sha256:base" },
            rule: makeScoringRule(),
            sourceVersionRef: REAL_STANDARD_SOURCE_VERSION,
            evidenceReferences: makeScoringRuleSourceBinding().evidenceReferences,
          },
        ],
      }),
    );
    expect(replace.success).toBe(true);
  });
});
