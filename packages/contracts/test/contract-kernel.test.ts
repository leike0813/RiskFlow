import { describe, expect, it } from "vitest";

import {
  APPLICABILITY_METADATA_DIMENSION_VALUES,
  ApplicabilityMetadataDimensionSchema,
  ApplicabilityMetadataSchema,
  ApplicabilityConditionsSchema,
  AuditInfoSchema,
  CommandEnvelopeSchema,
  CompositeConfidenceSchema,
  DeviationRecordSchema,
  EQUIPMENT_COMPONENT_VALUES,
  EffectivePeriodSchema,
  EquipmentComponentSchema,
  ErrorEnvelopeSchema,
  EvidenceLocatorSchema,
  EvidenceReferenceSchema,
  GradeIntervalSchema,
  IdentifierSchema,
  IndicatorResultSchema,
  IsoDateTimeSchema,
  MeasureItemSchema,
  ModelOutputResultSchema,
  MONITORING_INDICATOR_VALUES,
  MonitoringIndicatorSchema,
  PROCESS_DEPENDENCY_RELATION_TYPE_VALUES,
  PROCESS_NODE_VALUES,
  ProcessDependencyRelationTypeSchema,
  ProcessNodeSchema,
  QUANTITATIVE_INDICATOR_GROUP_VALUES,
  QuantitativeIndicatorGroupSchema,
  ResponseRecommendationSchema,
  RiskAssessmentRecordSchema,
  RiskElementRelationSchema,
  RiskInputReferenceSchema,
  RiskStateSchema,
  RISK_ASSESSMENT_INDICATOR_TYPE_VALUES,
  RISK_MECHANISM_TYPE_VALUES,
  RiskAssessmentIndicatorTypeSchema,
  RiskMechanismTypeSchema,
  ScalarValueSchema,
  ScoringThresholdSchema,
  StandardizedRiskRecordEnvelopeSchema,
  StandardizedRiskRecordSchema,
  STATE_PARAMETER_DESCRIPTION_VALUES,
  StateParameterDescriptionSchema,
  StructuralComponentSchema,
  STRUCTURAL_COMPONENT_VALUES,
  StructuredScoringRuleSchema,
  SystemRecordTimeSchema,
  TargetIndicatorSchema,
  ValidationResultSchema,
  VersionReferenceSchema,
  VersionedRecordInfoSchema,
  WARNING_TRIGGER_TYPE_VALUES,
  WarningRecordSchema,
  WarningTriggerTypeSchema,
} from "../src/index.js";
import type { RiskInputReference } from "../src/index.js";

const vocabularyCases = [
  ["工序节点", PROCESS_NODE_VALUES, ProcessNodeSchema],
  ["装备部件", EQUIPMENT_COMPONENT_VALUES, EquipmentComponentSchema],
  ["构件", STRUCTURAL_COMPONENT_VALUES, StructuralComponentSchema],
  ["状态参数", STATE_PARAMETER_DESCRIPTION_VALUES, StateParameterDescriptionSchema],
  ["监测指标", MONITORING_INDICATOR_VALUES, MonitoringIndicatorSchema],
  ["风险机理类型", RISK_MECHANISM_TYPE_VALUES, RiskMechanismTypeSchema],
  ["工序依赖关系", PROCESS_DEPENDENCY_RELATION_TYPE_VALUES, ProcessDependencyRelationTypeSchema],
  [
    "适用性元数据维度",
    APPLICABILITY_METADATA_DIMENSION_VALUES,
    ApplicabilityMetadataDimensionSchema,
  ],
  ["风险评估指标类型", RISK_ASSESSMENT_INDICATOR_TYPE_VALUES, RiskAssessmentIndicatorTypeSchema],
  ["量化指标组", QUANTITATIVE_INDICATOR_GROUP_VALUES, QuantitativeIndicatorGroupSchema],
  ["预警触发类型", WARNING_TRIGGER_TYPE_VALUES, WarningTriggerTypeSchema],
] as const;

const recordedAt = "2026-08-31T00:00:00Z";
const later = "2026-08-31T01:00:00+08:00";
const versionReference = { entityId: "riskflow-record", versionId: "v1" };
const versionedRecord = {
  reference: versionReference,
  effectivePeriod: { validFrom: recordedAt, validTo: "2026-08-31T02:00:00Z" },
  systemTime: { recordedAt },
};
const evidenceLocator = { sourceSegmentId: "资料ID-章节ID-资料段ID" };
const evidenceReference = {
  locator: evidenceLocator,
  sourceVersion: { entityId: "source-document", versionId: "v2" },
};
const audit = {
  actorId: "operator-1",
  action: "create",
  recordedAt,
};

const modelOutput = {
  riskSource: "地层条件",
  riskFactor: "地下水压力异常",
  riskEvent: "渗流突涌",
  riskElementRelations: [
    {
      sourceElement: "地下水压力异常",
      relation: "导致",
      targetElement: "渗流突涌",
    },
  ],
  evidenceLocator,
  modelConfidence: 0.8,
};

const standardizedRiskRecord = {
  processNodeId: "process-node-1",
  ...modelOutput,
};

const indicatorResult = {
  indicatorItem: "地下水位",
  actualValue: 12.5,
  baseScore: 3,
  weightedScore: 2.4,
  ruleVersion: versionReference,
  evidenceReferences: [evidenceReference],
};

const assessmentBase = {
  assessmentRecordId: "assessment-1",
  applicabilityMetadataSnapshot: {
    constructionMethod: "变径盾构法",
    stratumCondition: "富水软弱地层",
    engineeringStage: "变径空间扩挖",
  },
  likelihoodScore: 3.5,
  consequenceScore: 4,
  riskLevel: "II",
  indicatorResults: [indicatorResult],
  triggerIndicators: [
    {
      indicatorItem: "地下水位",
      triggerType: "监测指标越限",
      actualValue: 12.5,
    },
  ],
  evidenceReferences: [evidenceReference],
  applicableRuleSetVersion: versionReference,
  weightVersion: { entityId: "weight", versionId: "v3" },
  riskMatrixVersion: { entityId: "risk-matrix", versionId: "v1" },
  audit,
};

const warning = {
  warningRecordId: "warning-1",
  assessmentRecordId: assessmentBase.assessmentRecordId,
  warningLevel: "预警",
  triggerType: "监测指标越限",
  triggerIndicators: assessmentBase.triggerIndicators,
  evidenceReferences: [evidenceReference],
  recommendedResponseDirection: "加密监测并调整注浆",
  notificationStatus: "pending",
  audit,
};

const response = {
  responseRecommendationId: "response-1",
  warningRecordId: warning.warningRecordId,
  measureItems: [{ measureId: "measure-1", content: "调整注浆压力并加密监测" }],
  implementationOrder: ["measure-1"],
  resourceRequirements: ["注浆设备", "监测人员"],
  targetIndicators: [{ indicatorItem: "地下水位", targetValue: 10 }],
  triggerConsistencyValidation: { passed: true, issues: [] },
  standardsComplianceValidation: { passed: true, issues: [] },
  siteFeasibilityValidation: { passed: true, issues: [] },
  reviewStatus: "approved",
  version: versionedRecord,
  audit,
};

const deviation = {
  deviationRecordId: "deviation-1",
  responseRecommendationId: response.responseRecommendationId,
  predictedRiskChange: { likelihoodScore: 2, consequenceScore: 3, riskLevel: "III" },
  actualRiskChange: { likelihoodScore: 2.5, consequenceScore: 3, riskLevel: "III" },
  deviationValue: 0.5,
  deviationThresholdVersion: { entityId: "deviation-threshold", versionId: "v1" },
  evidenceReferences: [evidenceReference],
  calibrationRecommendation: "复核地下水位指标权重",
  reviewStatus: "pending",
  version: versionedRecord,
  audit,
};

describe("固定领域词汇", () => {
  it.each(vocabularyCases)("%s 只接受设计中的值", (_name, values, schema) => {
    for (const value of values) {
      expect(schema.safeParse(value).success).toBe(true);
    }
    expect(new Set(values).size).toBe(values.length);
    expect(schema.safeParse("未定义词汇").success).toBe(false);
    expect(schema.safeParse("").success).toBe(false);
  });
});

describe("通用契约", () => {
  it("保留版本、双时间、证据与审计语义", () => {
    expect(IdentifierSchema.safeParse("  record-1  ").success).toBe(true);
    expect(IdentifierSchema.safeParse("   ").success).toBe(false);
    expect(IsoDateTimeSchema.safeParse(later).success).toBe(true);
    expect(IsoDateTimeSchema.safeParse("2026-08-31T01:00:00").success).toBe(false);
    expect(VersionReferenceSchema.safeParse(versionReference).success).toBe(true);
    expect(VersionedRecordInfoSchema.safeParse(versionedRecord).success).toBe(true);
    expect(AuditInfoSchema.safeParse(audit).success).toBe(true);
    expect(EvidenceLocatorSchema.safeParse(evidenceLocator).success).toBe(true);
    expect(EvidenceReferenceSchema.safeParse(evidenceReference).success).toBe(true);
    expect(EvidenceLocatorSchema.safeParse({ sourceSegmentId: "" }).success).toBe(false);
  });

  it.each([
    [EffectivePeriodSchema, { validFrom: recordedAt, validTo: recordedAt }],
    [EffectivePeriodSchema, { validFrom: "2026-08-31T02:00:00Z", validTo: recordedAt }],
    [SystemRecordTimeSchema, { recordedAt: "2026-08-31T02:00:00Z", supersededAt: recordedAt }],
  ])("拒绝倒置或相等的时间区间", (schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  it("要求命令调用身份并保留结构化错误", () => {
    const command = {
      commandId: "command-1",
      idempotencyKey: "idempotency-1",
      projectId: "project-1",
      actorId: "operator-1",
      issuedAt: recordedAt,
      payload: { kind: "assessment" },
    };
    expect(CommandEnvelopeSchema.safeParse(command).success).toBe(true);
    for (const key of ["commandId", "idempotencyKey", "projectId", "actorId", "issuedAt"]) {
      const missing = Object.fromEntries(
        Object.entries(command).filter(([field]) => field !== key),
      );
      expect(CommandEnvelopeSchema.safeParse(missing).success).toBe(false);
    }

    const error = ErrorEnvelopeSchema.parse({
      code: "RULE_CONFLICT",
      retryable: false,
      details: { source: "rule-1" },
    });
    expect(error.code).toBe("RULE_CONFLICT");
    expect(error.retryable).toBe(false);
    expect(
      ErrorEnvelopeSchema.safeParse({
        code: "RULE_CONFLICT",
        retryable: false,
        details: "not-structured",
      }).success,
    ).toBe(false);
  });
});

describe("识别记录", () => {
  it("接受模型六项与标准化记录七项内容", () => {
    expect(RiskElementRelationSchema.safeParse(modelOutput.riskElementRelations[0]).success).toBe(
      true,
    );
    expect(ModelOutputResultSchema.safeParse(modelOutput).success).toBe(true);
    expect(ModelOutputResultSchema.safeParse({ ...modelOutput, extra: "拒绝" }).success).toBe(
      false,
    );
    expect(
      ModelOutputResultSchema.safeParse({ ...modelOutput, modelConfidence: 1.01 }).success,
    ).toBe(false);

    const parsed = StandardizedRiskRecordSchema.safeParse(standardizedRiskRecord);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data)).toHaveLength(7);
    }
    expect(
      StandardizedRiskRecordSchema.safeParse({ ...standardizedRiskRecord, audit }).success,
    ).toBe(false);
    expect(
      StandardizedRiskRecordSchema.safeParse({
        ...standardizedRiskRecord,
        processNodeId: undefined,
      }).success,
    ).toBe(false);
    expect(
      StandardizedRiskRecordSchema.safeParse({
        ...standardizedRiskRecord,
        riskEvent: undefined,
      }).success,
    ).toBe(false);
    expect(CompositeConfidenceSchema.safeParse({ value: 1, basis: ["model"] }).success).toBe(true);
    expect(CompositeConfidenceSchema.safeParse({ value: -0.01, basis: ["model"] }).success).toBe(
      false,
    );
  });

  it("将标准化内容与独立记录信封分离", () => {
    const envelope = {
      riskRecordId: "risk-record-1",
      record: standardizedRiskRecord,
      riskMechanismEntryIds: ["mechanism-1"],
      sourceIds: ["source-1"],
      compositeConfidence: { value: 0.75, basis: ["model", "rule"] },
      version: versionedRecord,
      audit,
    };
    expect(StandardizedRiskRecordEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(
      StandardizedRiskRecordSchema.safeParse({
        ...standardizedRiskRecord,
        version: versionReference,
      }).success,
    ).toBe(false);
  });
});

describe("评估记录", () => {
  it("接受三维适用性、结构化评分规则和标量指标", () => {
    expect(
      ApplicabilityMetadataSchema.safeParse(assessmentBase.applicabilityMetadataSnapshot).success,
    ).toBe(true);
    expect(
      ApplicabilityMetadataSchema.safeParse({ constructionMethod: "变径盾构法" }).success,
    ).toBe(false);
    expect(
      ApplicabilityConditionsSchema.safeParse({
        constructionMethod: ["变径盾构法"],
        stratumCondition: ["富水软弱地层"],
        engineeringStage: ["变径空间扩挖"],
      }).success,
    ).toBe(true);
    expect(ScalarValueSchema.safeParse({ value: 1 }).success).toBe(false);
    expect(ScalarValueSchema.safeParse("   ").success).toBe(false);

    expect(
      ScoringThresholdSchema.safeParse({
        thresholdId: "threshold-1",
        operator: "gte",
        value: 10,
        score: 3,
      }).success,
    ).toBe(true);
    expect(
      ScoringThresholdSchema.safeParse({
        thresholdId: "threshold-qualitative",
        operator: "eq",
        value: "富水软弱地层",
        score: 4,
      }).success,
    ).toBe(true);
    expect(
      ScoringThresholdSchema.safeParse({
        thresholdId: "threshold-2",
        operator: "between",
        value: 10,
        upperValue: 20,
        score: 4,
      }).success,
    ).toBe(true);
    expect(
      ScoringThresholdSchema.safeParse({
        thresholdId: "threshold-3",
        operator: "between",
        value: 10,
        score: 4,
      }).success,
    ).toBe(false);
    expect(
      ScoringThresholdSchema.safeParse({
        thresholdId: "threshold-5",
        operator: "between",
        value: 20,
        upperValue: 10,
        score: 4,
      }).success,
    ).toBe(false);
    expect(
      ScoringThresholdSchema.safeParse({
        thresholdId: "threshold-4",
        operator: "gte",
        value: 10,
        upperValue: 20,
        score: 4,
      }).success,
    ).toBe(false);

    expect(GradeIntervalSchema.safeParse({ grade: "I", lowerBound: 4 }).success).toBe(true);
    expect(GradeIntervalSchema.safeParse({ grade: "II" }).success).toBe(false);
    expect(
      GradeIntervalSchema.safeParse({ grade: "III", lowerBound: 4, upperBound: 3 }).success,
    ).toBe(false);

    expect(
      StructuredScoringRuleSchema.safeParse({
        ruleId: "rule-1",
        applicabilityConditions: {
          constructionMethod: ["变径盾构法"],
          stratumCondition: ["富水软弱地层"],
          engineeringStage: ["变径空间扩挖"],
        },
        indicatorItem: "地下水位",
        scoringThresholds: [{ thresholdId: "threshold-1", operator: "gte", value: 10, score: 3 }],
        gradeIntervals: [{ grade: "I", lowerBound: 4 }],
        exceptionClauses: [],
        evidenceLocator,
        ruleVersion: versionReference,
        reviewStatus: "approved",
      }).success,
    ).toBe(true);
  });

  it("以可辨识联合类型强制风险输入 XOR", () => {
    const riskRecordInput: RiskInputReference = {
      kind: "standardized-risk-record",
      riskRecordId: "risk-1",
    };
    const externalRiskEventInput: RiskInputReference = {
      kind: "external-risk-event",
      externalRiskEventId: "external-risk-1",
    };

    expect(RiskInputReferenceSchema.safeParse(riskRecordInput).success).toBe(true);
    expect(RiskInputReferenceSchema.safeParse(externalRiskEventInput).success).toBe(true);

    const ambiguousRiskInputs = [
      {},
      { riskRecordId: "risk-1" },
      { kind: "unknown-risk-input", riskRecordId: "risk-1" },
      { kind: "standardized-risk-record", externalRiskEventId: "external-risk-1" },
      { kind: "external-risk-event", riskRecordId: "risk-1" },
      { kind: "standardized-risk-record" },
      {
        kind: "standardized-risk-record",
        riskRecordId: "risk-1",
        externalRiskEventId: "external-risk-1",
      },
      {
        kind: "standardized-risk-record",
        riskRecordId: "risk-1",
        externalRiskEventId: undefined,
      },
      { kind: "standardized-risk-record", riskRecordId: "risk-1", undeclaredField: true },
    ];

    for (const ambiguousRiskInput of ambiguousRiskInputs) {
      expect(RiskInputReferenceSchema.safeParse(ambiguousRiskInput).success).toBe(false);
      expect(
        RiskAssessmentRecordSchema.safeParse({ ...assessmentBase, ...ambiguousRiskInput }).success,
      ).toBe(false);
    }

    const parsedRiskRecordInput = RiskInputReferenceSchema.parse(riskRecordInput);
    const parsedExternalRiskEventInput = RiskInputReferenceSchema.parse(externalRiskEventInput);
    const selectedRiskInputIds = [
      parsedRiskRecordInput.kind === "standardized-risk-record"
        ? parsedRiskRecordInput.riskRecordId
        : parsedRiskRecordInput.externalRiskEventId,
      parsedExternalRiskEventInput.kind === "standardized-risk-record"
        ? parsedExternalRiskEventInput.riskRecordId
        : parsedExternalRiskEventInput.externalRiskEventId,
    ];
    expect(selectedRiskInputIds).toEqual(["risk-1", "external-risk-1"]);

    const ambiguousRiskInput = {
      kind: "standardized-risk-record",
      riskRecordId: "risk-1",
      externalRiskEventId: "external-risk-1",
    } as const;
    // @ts-expect-error 同时携带两个标识的对象不得赋给共享风险输入引用
    const rejectedRiskInput: RiskInputReference = ambiguousRiskInput;
    expect(RiskInputReferenceSchema.safeParse(rejectedRiskInput)).toEqual({
      success: false,
      error: expect.objectContaining({
        issues: [expect.objectContaining({ code: "custom", path: ["externalRiskEventId"] })],
      }),
    });
    expect(
      RiskAssessmentRecordSchema.safeParse({ ...assessmentBase, ...ambiguousRiskInput }),
    ).toEqual({
      success: false,
      error: expect.objectContaining({
        issues: [expect.objectContaining({ code: "custom", path: ["externalRiskEventId"] })],
      }),
    });
    expect(RiskInputReferenceSchema.safeParse({ kind: "standardized-risk-record" })).toEqual({
      success: false,
      error: expect.objectContaining({
        issues: [expect.objectContaining({ code: "invalid_type", path: ["riskRecordId"] })],
      }),
    });

    expect(IndicatorResultSchema.safeParse(indicatorResult).success).toBe(true);
    expect(
      RiskAssessmentRecordSchema.safeParse({
        ...assessmentBase,
        kind: "standardized-risk-record",
        riskRecordId: "risk-1",
      }).success,
    ).toBe(true);
    expect(
      RiskAssessmentRecordSchema.safeParse({
        ...assessmentBase,
        kind: "external-risk-event",
        externalRiskEventId: "external-risk-1",
      }).success,
    ).toBe(true);
    expect(RiskAssessmentRecordSchema.safeParse(assessmentBase).success).toBe(false);
  });
});

describe("预警、处置与偏差闭环", () => {
  it("沿评估、预警、处置建议和偏差记录贯通引用", () => {
    expect(WarningRecordSchema.safeParse(warning).success).toBe(true);
    expect(WarningRecordSchema.safeParse({ ...warning, triggerType: "未知触发" }).success).toBe(
      false,
    );
    expect(MeasureItemSchema.safeParse(response.measureItems[0]).success).toBe(true);
    expect(TargetIndicatorSchema.safeParse(response.targetIndicators[0]).success).toBe(true);
    expect(ValidationResultSchema.safeParse({ passed: true, issues: [] }).success).toBe(true);
    expect(ResponseRecommendationSchema.safeParse(response).success).toBe(true);
    expect(RiskStateSchema.safeParse(deviation.predictedRiskChange).success).toBe(true);
    expect(DeviationRecordSchema.safeParse(deviation).success).toBe(true);

    for (const field of [
      "triggerConsistencyValidation",
      "standardsComplianceValidation",
      "siteFeasibilityValidation",
    ]) {
      const invalid = Object.fromEntries(Object.entries(response).filter(([key]) => key !== field));
      expect(ResponseRecommendationSchema.safeParse(invalid).success).toBe(false);
    }
    expect(
      DeviationRecordSchema.safeParse({
        ...deviation,
        publishedRuleVersion: versionReference,
      }).success,
    ).toBe(false);
  });
});
