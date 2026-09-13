import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { KnowledgeReleaseRefV1, KnowledgeRevisionRefV1 } from "@riskflow/contracts/ports";

import {
  ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1,
  type AssessmentConfigurationDefinitionTypeV1,
} from "../../src/assessment-config/index.js";
import {
  AssessmentBasisReleaseSetMembersV1Schema,
  AssessmentBasisReleaseSetReadResultV1Schema,
  ReadAssessmentBasisReleaseSetV1Schema,
  ScoringRuleAuthoringCandidateV1Schema,
  applicableRuleSetDocumentDigest,
  assembleApplicableRuleSet,
  assertScoringRuleMembersMatchApplicableRuleSet,
  bindScoringRuleRelationsToRevision,
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
  SECOND_STANDARD_SOURCE_VERSION,
  makeApplicabilityConditions,
  makeScoringRule,
  makeScoringRuleCandidate,
  makeScoringRuleSourceBinding,
  makeScoringRulesFixtureManifest,
  makeScoringRulesFixturePolicy,
  scoringRulesFixtureAgentTaskRef,
} from "./fixture.js";
import {
  GB50911_CLAUSE_SEGMENT_ID,
  GB50911_CLAUSES,
  GB50911_CONTROL_VALUES,
  GB50911_EXCEPTIONS,
  GB50911_FIXTURE,
  GB50911_INDICATOR_ITEMS,
  GB50911_SOFT_SOIL_BANDS,
  GB50911_SOURCE_METADATA,
  GB50911_STANDARD,
  GB50911_STIFF_SOIL_BANDS,
} from "./standard-fixture.js";

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
  describe("真实规范夹具（GB 50911-2013）", () => {
    it("夹具锚定仓库内公开来源原件，章节号与页映射逐条一致", () => {
      const artifact = readFileSync(
        new URL(`../../../../${GB50911_SOURCE_METADATA.repositoryArtifact}`, import.meta.url),
      );
      expect(artifact.byteLength).toBe(GB50911_SOURCE_METADATA.artifactBytes);
      expect(createHash("sha256").update(artifact).digest("hex")).toBe(
        GB50911_SOURCE_METADATA.sha256,
      );
      expect(GB50911_SOURCE_METADATA.sha256).toBe(
        "1328780ab4d16871187a791262b6e6e31777bfb1cc34a22d3972c228449e4795",
      );
      expect(GB50911_STANDARD.code).toBe("GB 50911-2013");
      expect(GB50911_STANDARD.standardKind).toBe("国家规范");
      expect(GB50911_STANDARD.mandatoryClauses).toEqual(["3.1.1", "9.1.1", "9.1.5"]);
      expect(GB50911_FIXTURE.reviewNotice).toBe(GB50911_SOURCE_METADATA.reviewNotice);
      expect(GB50911_FIXTURE.reviewNotice).toContain("非甲方审核资料");
      for (const clause of GB50911_CLAUSES) {
        expect(GB50911_SOURCE_METADATA.clausePageMap[clause.clauseNumber]).toBe(clause.pdfPage);
      }
      expect(GB50911_CLAUSES.map((clause) => clause.clauseNumber)).toEqual([
        "3.1.1",
        "3.2.5",
        "3.3.5",
        "4.2.2",
        "9.1.1",
        "9.1.3",
        "9.1.5",
        "9.2.2",
      ]);
      expect(
        GB50911_CLAUSES.filter((clause) => clause.mandatory).map((clause) => clause.clauseNumber),
      ).toEqual(GB50911_STANDARD.mandatoryClauses);
      expect(GB50911_CLAUSE_SEGMENT_ID).toEqual({
        mandatoryMonitoring: "GB 50911-2013/3.1.1",
        indicatorItems: "GB 50911-2013/4.2.2/表 4.2.2",
        controlValues: "GB 50911-2013/9.2.2/表 9.2.2-2",
        mandatoryWarning: "GB 50911-2013/9.1.5",
      });
      expect(REAL_STANDARD_SEGMENT_ID).toBe(GB50911_CLAUSE_SEGMENT_ID.controlValues);
    });

    it("表 9.2.2-2 控制值、变化速率与例外条款按原文数值登记", () => {
      expect(GB50911_CONTROL_VALUES.tableNumber).toBe("表 9.2.2-2");
      expect(GB50911_CONTROL_VALUES.pdfPage).toBe(65);
      expect(
        GB50911_SOFT_SOIL_BANDS.map((band) => [band.grade, band.cumulative, band.rate]),
      ).toEqual([
        ["一级", [15, 25], 3],
        ["二级", [25, 35], 4],
        ["三级", [35, 45], 5],
      ]);
      expect(
        GB50911_STIFF_SOIL_BANDS.map((band) => [band.grade, band.cumulative, band.rate]),
      ).toEqual([
        ["一级", [10, 20], 3],
        ["二级", [20, 30], 4],
        ["三级", [30, 40], 4],
      ]);
      expect(GB50911_CONTROL_VALUES.upliftBand).toMatchObject({
        monitoringItem: "地表隆起",
        cumulative: 10,
        rate: 3,
      });
      expect(GB50911_CONTROL_VALUES.notes).toEqual(["本表主要适用于标准断面的盾构法隧道工程。"]);
      expect(
        GB50911_INDICATOR_ITEMS.find((item) => item.indicatorItem === "地表沉降"),
      ).toMatchObject({
        clauseNumber: "4.2.2",
        requiredByGrade: { 一级: true, 二级: true, 三级: true },
      });
      expect(GB50911_EXCEPTIONS.map((exception) => exception.clauseNumber)).toEqual([
        "9.2.2",
        "表 9.2.2-2 注",
        "9.1.2 第 4 款",
        "9.1.2 第 6 款",
        "3.2.4",
      ]);
    });

    it("由真实控制值派生的规则证据反查到同一条文段定位", () => {
      const rule = makeScoringRule();
      expect(rule.evidenceLocator.sourceSegmentId).toBe("GB 50911-2013/9.2.2/表 9.2.2-2");
      expect(rule.scoringThresholds.map((threshold) => threshold.thresholdId)).toEqual([
        "gb50911-monitoring-grade-1-cumulative",
        "gb50911-monitoring-grade-2-cumulative",
        "gb50911-monitoring-grade-3-cumulative",
        "gb50911-over-control-value",
      ]);
      const member = validateScoringRuleOperations({
        ...baseInput(),
        candidate: makeScoringRuleCandidate(),
      }).acceptedMembers[0]!;
      expect(member.binding.evidenceReferences.map((reference) => reference.locator)).toEqual([
        { sourceSegmentId: "GB 50911-2013/9.2.2/表 9.2.2-2" },
      ]);
      expect(member.binding.sourceVersionRef.reference).toEqual({
        entityId: "GB 50911-2013",
        versionId: "2014-05-01",
      });
    });
  });

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
    it("GB 50911-2013 表 9.2.2-2 端点按左闭右开唯一求值", () => {
      // 中软~软弱土行：一级 15~25、二级 25~35、三级 35~45（mm），变化速率 3/4/5（mm/d）。
      const rule = makeScoringRule();
      expect(evaluateScoringRule(rule, 14.9)).toEqual({
        kind: "rejected",
        reasonCode: "scoring-value-out-of-range",
      });
      expect(evaluateScoringRule(rule, 15)).toEqual({
        kind: "evaluated",
        thresholdId: "gb50911-monitoring-grade-1-cumulative",
        score: 1,
        grade: "gb50911-monitoring-grade-1",
      });
      expect(evaluateScoringRule(rule, 24.9)).toEqual({
        kind: "evaluated",
        thresholdId: "gb50911-monitoring-grade-1-cumulative",
        score: 1,
        grade: "gb50911-monitoring-grade-1",
      });
      expect(evaluateScoringRule(rule, 25)).toEqual({
        kind: "evaluated",
        thresholdId: "gb50911-monitoring-grade-2-cumulative",
        score: 2,
        grade: "gb50911-monitoring-grade-2",
      });
      expect(evaluateScoringRule(rule, 35)).toEqual({
        kind: "evaluated",
        thresholdId: "gb50911-monitoring-grade-3-cumulative",
        score: 3,
        grade: "gb50911-monitoring-grade-3",
      });
      // 45 是表中最大控制值上限：超出即按 9.1.5 强制性条文进入警情报送档。
      expect(evaluateScoringRule(rule, 45)).toEqual({
        kind: "evaluated",
        thresholdId: "gb50911-over-control-value",
        score: 5,
        grade: "gb50911-control-limit-exceeded",
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
        "gb50911-monitoring-grade-1-cumulative",
        "gb50911-monitoring-grade-2-cumulative",
        "gb50911-monitoring-grade-3-cumulative",
        "gb50911-over-control-value",
      ]);
      const grades = normalizeGradeIntervals(rule.gradeIntervals);
      expect(grades[0]).toMatchObject({
        grade: "gb50911-monitoring-grade-1",
        upperInclusive: false,
      });
      expect(grades[3]).toMatchObject({ grade: "gb50911-control-limit-exceeded", upper: null });
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
      // 表 9.2.2-2 的通用行只适用于「无地方经验且标准断面」：项目若落在该表之外，
      // 由 9.1.2 第 4 款的专项评估规则接管，通用规则以 exception-applies 被筛除。
      const specialAssessmentRuleId = "rule-gb50911-2013-9.1.2-special-assessment";
      const specialAssessmentExceptionId = GB50911_EXCEPTIONS.find((exception) =>
        exception.exceptionId.includes("9.1.2-special-assessment"),
      )!.exceptionId;
      const mismatched = candidateFor(
        "rule-method-mismatch",
        makeScoringRule({
          ruleId: "rule-method-mismatch",
          applicabilityConditions: makeApplicabilityConditions({ constructionMethod: ["矿山法"] }),
        }),
      );
      const exceptionCase = candidateFor(
        "rule-gb50911-2013-9.2.2-2-settlement-general",
        makeScoringRule({
          ruleId: "rule-gb50911-2013-9.2.2-2-settlement-general",
          exceptionClauses: [specialAssessmentRuleId],
        }),
      );
      expect(specialAssessmentExceptionId).toBe("gb50911-2013-9.1.2-special-assessment");
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

      const cases = [
        {
          // 例外未触发：调用方按项目实际声明该规则没有生效中的例外规则。
          exceptionsByRuleId: {
            "rule-gb50911-2013-9.2.2-2-settlement-general": [] as readonly string[],
          },
          expectedGeneralReason: "three-dimensional-match",
        },
        {
          // 例外触发：重要/特殊/风险较高的环境对象改用 9.1.2 第 4 款专项评估控制值。
          exceptionsByRuleId: undefined,
          expectedGeneralReason: "exception-applies",
        },
      ] as const;
      for (const testCase of cases) {
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
          ...(testCase.exceptionsByRuleId === undefined
            ? {}
            : { exceptionsByRuleId: testCase.exceptionsByRuleId }),
        });
        const reasonForMismatch = mixed.decisions.find(
          (decision) => decision.ruleId === "rule-method-mismatch",
        )?.reasonCode;
        const reasonForGeneral = mixed.decisions.find(
          (decision) => decision.ruleId === "rule-gb50911-2013-9.2.2-2-settlement-general",
        )?.reasonCode;
        expect(reasonForMismatch).toBe("construction-method-mismatch");
        expect(reasonForGeneral).toBe(testCase.expectedGeneralReason);
        expect(
          mixed.decisions.find((decision) => decision.ruleId === "rule-ground-settlement")
            ?.reasonCode,
        ).toBe("three-dimensional-match");
        expect(mixed.decisions).toHaveLength(3);
      }
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

    it("关系身份：发布前冲突规则被拦截并在修订生成后绑定", () => {
      const candidateContentDigest = "a".repeat(64);
      const snapshot = detectRuleRelations({
        policyRef: { entityId: "rule-conflict-priority", versionId: "1" },
        candidateContentDigest,
        candidates: [
          relationCandidate(
            "rule-a",
            [{ thresholdId: "a-1", score: 1, operator: "between", value: 0, upperValue: 20 }],
            [{ grade: "grade-a", lowerBound: 0 }],
            REAL_STANDARD_SOURCE_VERSION,
          ),
          relationCandidate(
            "rule-b",
            [{ thresholdId: "b-1", score: 5, operator: "between", value: 0, upperValue: 20 }],
            [{ grade: "grade-c", lowerBound: 0 }],
            SECOND_STANDARD_SOURCE_VERSION,
          ),
        ],
      });

      expect(snapshot.candidateContentDigest).toBe(candidateContentDigest);
      expect(snapshot.baseReleaseRef).toBeUndefined();
      const relations = snapshot.relations;
      expect(relations).toHaveLength(1);
      const conflict = relations[0]!;
      expect(conflict.relationKind).toBe("conflict");
      expect(conflict.retainedRuleVersionRef?.entityId).toBe("rule-a");
      expect(conflict.excludedRuleVersionRef?.entityId).toBe("rule-b");
      expect(conflict.overlap.lower).toBe(0);
      expect(conflict.overlap.upper).toBe(20);
      const bound = bindScoringRuleRelationsToRevision({
        projectId: "project-c19",
        candidateRevisionRef: revisionFor("candidate-a"),
        snapshot,
      });
      expect(bound.relationDigest).toMatch(/^[0-9a-f]{64}$/u);
      expect(bound.relations[0]!.relationId).toMatch(/^[0-9a-f]{64}$/u);
    });

    it("候选与精确比较基线相交时仍产生绑定该基线的冲突事实", () => {
      const baseReleaseRef = {
        kind: "knowledge-release" as const,
        reference: { entityId: "release-rule-base", versionId: "1" },
      };
      const baseRevisionRef = {
        kind: "knowledge-revision" as const,
        reference: { entityId: "revision-rule-base", versionId: "1" },
      };
      const snapshot = detectRuleRelations({
        policyRef: { entityId: "rule-conflict-priority", versionId: "1" },
        candidateContentDigest: "c".repeat(64),
        candidates: [
          relationCandidate(
            "rule-candidate",
            [{ thresholdId: "c-1", score: 1, operator: "between", value: 0, upperValue: 20 }],
            [{ grade: "grade-c", lowerBound: 0 }],
            REAL_STANDARD_SOURCE_VERSION,
          ),
        ],
        baseline: [
          relationCandidate(
            "rule-published",
            [{ thresholdId: "p-1", score: 5, operator: "between", value: 0, upperValue: 20 }],
            [{ grade: "grade-p", lowerBound: 0 }],
            SECOND_STANDARD_SOURCE_VERSION,
          ),
          // 从基线继承的同一规则版本不与自己比较。
          relationCandidate(
            "rule-candidate",
            [{ thresholdId: "c-1", score: 1, operator: "between", value: 0, upperValue: 20 }],
            [{ grade: "grade-c", lowerBound: 0 }],
            REAL_STANDARD_SOURCE_VERSION,
          ),
        ],
        baseReleaseRef,
        baseRevisionRef,
      });

      expect(snapshot.baseReleaseRef).toEqual(baseReleaseRef);
      expect(snapshot.baseRevisionRef).toEqual(baseRevisionRef);
      expect(snapshot.relations).toHaveLength(1);
      expect(snapshot.relations[0]!.relationKind).toBe("conflict");
      expect(
        [snapshot.relations[0]!.leftRuleId, snapshot.relations[0]!.rightRuleId].sort(),
      ).toEqual(["rule-candidate", "rule-published"]);
    });

    it("修订归属：相同语义在不同候选修订中获得不同关系身份", () => {
      const candidates = [
        relationCandidate(
          "rule-z",
          [{ thresholdId: "z-1", score: 1, operator: "between", value: 0, upperValue: 20 }],
          [{ grade: "grade-z", lowerBound: 0 }],
        ),
        relationCandidate(
          "rule-a",
          [{ thresholdId: "a-1", score: 2, operator: "between", value: 0, upperValue: 20 }],
          [{ grade: "grade-a", lowerBound: 0 }],
          SECOND_STANDARD_SOURCE_VERSION,
        ),
      ];
      const detect = (values: readonly ScoringRuleRelationCandidateV1[]) =>
        detectRuleRelations({
          policyRef: { entityId: "rule-conflict-priority", versionId: "1" },
          candidateContentDigest: "d".repeat(64),
          candidates: values,
        });
      const revisionA = revisionFor("candidate-a");
      const first = bindScoringRuleRelationsToRevision({
        projectId: "project-c19",
        candidateRevisionRef: revisionA,
        snapshot: detect(candidates),
      });
      const replay = bindScoringRuleRelationsToRevision({
        projectId: "project-c19",
        candidateRevisionRef: revisionA,
        snapshot: detect([...candidates].reverse()),
      });
      const next = bindScoringRuleRelationsToRevision({
        projectId: "project-c19",
        candidateRevisionRef: revisionFor("candidate-b"),
        snapshot: detect(candidates),
      });

      expect(first.relations[0]!.leftRuleId).toBe("rule-a");
      expect(replay).toEqual(first);
      expect(next.relations[0]!.relationId).not.toBe(first.relations[0]!.relationId);
    });

    it("关系贡献冲突：重复规则身份或同身份异文整体失败", () => {
      const candidate = relationCandidate(
        "rule-duplicate",
        [{ thresholdId: "d-1", score: 1, operator: "between", value: 0, upperValue: 20 }],
        [{ grade: "grade-d", lowerBound: 0 }],
      );
      expect(() =>
        detectRuleRelations({
          policyRef: { entityId: "rule-conflict-priority", versionId: "1" },
          candidateContentDigest: "e".repeat(64),
          candidates: [candidate, candidate],
        }),
      ).toThrow();
      expect(() =>
        detectRuleRelations({
          policyRef: { entityId: "rule-conflict-priority", versionId: "1" },
          candidateContentDigest: "f".repeat(64),
          candidates: [candidate],
          baseline: [
            {
              ...candidate,
              rule: { ...candidate.rule, exceptionClauses: ["different-content"] },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("重叠", () => {
    it("重叠事实去重：等价相邻贡献合并并按闭合优先级确定处置", () => {
      const snapshot = detectRuleRelations({
        policyRef: { entityId: "rule-conflict-priority", versionId: "1" },
        candidateContentDigest: "b".repeat(64),
        candidates: [
          {
            rule: makeScoringRule({
              ruleId: "rule-overlap-settlement-a",
              scoringThresholds: [
                { thresholdId: "a-1", score: 3, operator: "between", value: 0, upperValue: 10 },
                {
                  thresholdId: "a-2",
                  score: 3,
                  operator: "between",
                  value: 10,
                  upperValue: 20,
                },
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

      expect(snapshot.relations).toHaveLength(1);
      expect(snapshot.relations[0]!.relationKind).toBe("overlap");
      expect(snapshot.relations[0]!.retainedRuleVersionRef.entityId).toBe(
        "rule-overlap-settlement-a",
      );
      expect(snapshot.relations[0]!.excludedRuleVersionRef.entityId).toBe(
        "rule-overlap-settlement-b",
      );
      expect(snapshot.relations[0]!.overlap.leftThresholdIds).toEqual(["a-1", "a-2"]);
      expect(snapshot.relations[0]!.overlap.rightThresholdIds).toEqual(["b-1"]);
      expect(snapshot.relations[0]!.overlap.lower).toBe(5);
      expect(snapshot.relations[0]!.overlap.upper).toBe(15);
      const bound = bindScoringRuleRelationsToRevision({
        projectId: "project-c19",
        candidateRevisionRef: revisionFor("overlap"),
        snapshot,
      });
      expect(bound.relationDigest).toMatch(/^[0-9a-f]{64}$/u);
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
        scoringRuleMembers: [member("rule-b"), member("rule-a")],
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
      // 重复成员是整体失败，不得静默去重或部分返回。
      expect(() =>
        buildAssessmentBasisMembers({
          applicableRuleSetMember: member("applicable-rule-set"),
          scoringRuleMembers: [member("rule-a"), member("rule-a")],
          configurationMembers: [...ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1]
            .sort()
            .map(configurationMember),
        }),
      ).toThrowError(/BUSINESS_BLOCKED/u);
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
      // 重复成员同样整体失败：不允许去重后伪装成一致。
      expect(() =>
        assertScoringRuleMembersMatchApplicableRuleSet({
          document,
          scoringRuleMembers: [...projected, member("rule-a")],
        }),
      ).toThrowError(/BUSINESS_BLOCKED/u);
    });

    it("basis 无正文：strict 请求与顶层三分支结果不接受正文、包装或伪身份", () => {
      const parsed = AssessmentBasisReleaseSetMembersV1Schema.safeParse({
        applicableRuleSetMember: { ...member("applicable-rule-set"), displayName: "规则集" },
        scoringRuleMembers: [member("rule-a")],
        configurationMembers: ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1.map(configurationMember),
      });
      expect(parsed.success).toBe(false);

      const requestPayload = {
        requestId: "request-1",
        idempotencyKey: "idempotency-1",
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
      };
      expect(ReadAssessmentBasisReleaseSetV1Schema.safeParse(requestPayload).success).toBe(true);
      // 工程与 actor 只能来自 C06 验证结果；latest/列表选择器一律拒绝。
      for (const forbidden of [
        { projectId: "project-1" },
        { actorId: "actor-1" },
        { latest: true },
        { name: "basis" },
      ]) {
        expect(
          ReadAssessmentBasisReleaseSetV1Schema.safeParse({ ...requestPayload, ...forbidden })
            .success,
        ).toBe(false);
      }

      const members = AssessmentBasisReleaseSetMembersV1Schema.parse({
        applicableRuleSetMember: member("applicable-rule-set"),
        scoringRuleMembers: [member("rule-a")],
        configurationMembers: [...ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1]
          .sort()
          .map(configurationMember),
      });
      const succeeded = AssessmentBasisReleaseSetReadResultV1Schema.safeParse({
        kind: "succeeded",
        schemaVersion: "1",
        assessmentBasisReleaseSetRef: requestPayload.assessmentBasisReleaseSetRef,
        memberDigest: "a".repeat(64),
        ...members,
      });
      expect(succeeded.success).toBe(true);
      if (succeeded.success) {
        expect(Object.keys(succeeded.data).sort()).toEqual([
          "applicableRuleSetMember",
          "assessmentBasisReleaseSetRef",
          "configurationMembers",
          "kind",
          "memberDigest",
          "schemaVersion",
          "scoringRuleMembers",
        ]);
      }
      // 旧的 `{releaseSet}` 包装与内部字段名不再被接受。
      expect(
        AssessmentBasisReleaseSetReadResultV1Schema.safeParse({
          kind: "succeeded",
          releaseSet: { memberDigest: "a".repeat(64) },
        }).success,
      ).toBe(false);

      const moduleError = {
        code: "AUTHORIZATION_DENIED",
        category: "authorization",
        retryable: false,
        stageCode: "scoring-rules.authorization_denied",
        occurredAt: "2030-01-01T00:00:00.000Z",
        causalRunId: "request-1",
        requiredCapability: "knowledge-modeling.read",
        authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      };
      expect(
        AssessmentBasisReleaseSetReadResultV1Schema.safeParse({
          kind: "unavailable",
          error: moduleError,
        }).success,
      ).toBe(true);
      expect(
        AssessmentBasisReleaseSetReadResultV1Schema.safeParse({
          kind: "failed",
          error: moduleError,
        }).success,
      ).toBe(true);
      expect(AssessmentBasisReleaseSetReadResultV1Schema.safeParse({ kind: "other" }).success).toBe(
        false,
      );
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
