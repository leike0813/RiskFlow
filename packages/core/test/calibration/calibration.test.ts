import { describe, expect, it } from "vitest";

import {
  CalibrationCandidateV1Schema,
  CalibrationOperationV1Schema,
  CalibrationValidationItemV1Schema,
  applyCalibrationOperations,
  calibrationCandidateDigest,
  createCalibrationSuggestionTaskDefinition,
  deriveCalibrationInputSnapshotRef,
  deriveCalibrationSuggestionRef,
  deriveDeviationRecordRef,
  deriveSuccessorCalibrationSuggestionRef,
  digestDocument,
  failCalibration,
  toCalibrationModuleError,
  validateCalibrationCandidate,
  type CalibrationCandidateV1,
  type CalibrationOperationV1,
  type CalibrationTargetDocumentV1,
  type CalibrationTargetDefinitionTypeV1,
} from "../../src/calibration/index.js";
import {
  RiskMatrixDocumentV1Schema,
  WeightSetDocumentV1Schema,
} from "../../src/assessment-config/index.js";
import { sha256CanonicalJson } from "../../src/persistence/index.js";
import {
  assessmentConfigurationDocumentOf,
  makeAssessmentConfigurationFixtureSet,
} from "../assessment-config/fixture.js";
import { makeScoringRuleDocument } from "../scoring-rules/fixture.js";

const versionRef = (entityId: string, versionId = "1") => ({ entityId, versionId });

const candidateVersionRef = (entityId: string, versionId = "1") => ({ entityId, versionId });

const agentTaskRef = {
  kind: "agent-task" as const,
  reference: versionRef("calibration-task"),
  taskType: "calibration-suggestion" as const,
  triggerMode: "embedded" as const,
  modelDeploymentRef: versionRef("model"),
  promptTemplateRef: versionRef("prompt"),
  toolPolicyRef: versionRef("tools"),
  budgetPolicyRef: versionRef("budget"),
  incrementSchemaRef: versionRef("increment"),
  validationPolicyRef: versionRef("validation"),
};
const agentTaskResultRef = {
  kind: "agent-task-result" as const,
  reference: versionRef("calibration-result"),
  agentTaskRef,
  status: "completed" as const,
  candidateRef: { kind: "calibration-suggestion" as const, reference: versionRef("candidate") },
};

const candidate = (operations: readonly CalibrationOperationV1[]): CalibrationCandidateV1 =>
  CalibrationCandidateV1Schema.parse({
    schemaVersion: "1",
    taskRef: agentTaskRef,
    resultRef: agentTaskResultRef,
    inputSnapshotRef: { kind: "calibration-input-snapshot", reference: versionRef("snapshot") },
    rationale: "依据监测偏差调整阈值",
    evidenceReferences: [
      {
        locator: { sourceSegmentId: "segment-1" },
        sourceVersion: versionRef("source-version"),
      },
    ],
    operations,
  });

/* -------------------------------------------------------------------------- */
/* 目标文档与操作构造                                                          */
/* -------------------------------------------------------------------------- */

const configurationSet = makeAssessmentConfigurationFixtureSet();

/** 自建合法权重集：每个轴必须合计 10000 基点，单条替换无法保持总量，需成对操作。 */
const weightSetDocument = (): CalibrationTargetDocumentV1 =>
  WeightSetDocumentV1Schema.parse({
    schemaVersion: "1",
    definitionType: "weight-set",
    projectRevisionRef: configurationSet.projectRevisionRef,
    configurationSetRef: configurationSet.configurationSetRef,
    content: {
      weightSetId: "calibration-weight-set",
      weightSetVersion: "1",
      sourceRef: configurationSet.configurationSetRef,
      possibilityWeights: [
        { indicatorId: "possibility-indicator-1", basisPoints: 4000 },
        { indicatorId: "possibility-indicator-2", basisPoints: 6000 },
      ],
      consequenceWeights: [
        { indicatorId: "consequence-indicator-1", basisPoints: 5000 },
        { indicatorId: "consequence-indicator-2", basisPoints: 5000 },
      ],
    },
  });

/** 单带矩阵：一个类型化带状替换既能改变正文，又能保持相邻边界与单元覆盖完整。 */
const riskMatrixDocument = (upper = "1"): CalibrationTargetDocumentV1 =>
  RiskMatrixDocumentV1Schema.parse({
    schemaVersion: "1",
    definitionType: "risk-matrix",
    projectRevisionRef: configurationSet.projectRevisionRef,
    configurationSetRef: configurationSet.configurationSetRef,
    content: {
      matrixId: "calibration-matrix",
      matrixVersion: "1",
      possibilityAxis: { bands: [{ bandId: "possibility-band-1", lower: "0", upper }] },
      consequenceAxis: { bands: [{ bandId: "consequence-band-1", lower: "0", upper }] },
      riskLevels: [{ levelId: "level-1", ordinal: 1 }],
      cells: [
        {
          possibilityBandId: "possibility-band-1",
          consequenceBandId: "consequence-band-1",
          riskLevelId: "level-1",
        },
      ],
    },
  });

const acceptanceDocument = (): CalibrationTargetDocumentV1 =>
  assessmentConfigurationDocumentOf(configurationSet, "risk-acceptance-threshold");

const monitoringDocument = (): CalibrationTargetDocumentV1 =>
  assessmentConfigurationDocumentOf(configurationSet, "monitoring-warning-threshold");

const deviationPolicyDocument = (): CalibrationTargetDocumentV1 =>
  assessmentConfigurationDocumentOf(configurationSet, "deviation-policy");

/** 每类目标定义一个真实改变正文、且仍通过完整文档 Schema 与 C18 语义的类型化操作。 */
const validOperationFor = (
  definitionType: CalibrationTargetDefinitionTypeV1,
): CalibrationOperationV1 => {
  switch (definitionType) {
    case "weight-set": {
      const document = weightSetDocument();
      if (document.definitionType !== "weight-set") throw new Error("unexpected definition");
      const [first] = document.content.possibilityWeights;
      if (first === undefined) throw new Error("fixture too small");
      return CalibrationOperationV1Schema.parse({
        kind: "replace-weight-entry",
        definitionType: "weight-set",
        axis: "possibility",
        entry: { indicatorId: first.indicatorId, basisPoints: first.basisPoints - 1000 },
      });
    }
    case "risk-matrix": {
      const document = riskMatrixDocument();
      if (document.definitionType !== "risk-matrix") throw new Error("unexpected definition");
      const [first] = document.content.possibilityAxis.bands;
      if (first === undefined) throw new Error("fixture too small");
      return CalibrationOperationV1Schema.parse({
        kind: "replace-risk-matrix-band",
        definitionType: "risk-matrix",
        axis: "possibility",
        band: { bandId: first.bandId, lower: first.lower, upper: "2" },
      });
    }
    case "risk-acceptance-threshold": {
      const document = acceptanceDocument();
      if (document.definitionType !== "risk-acceptance-threshold")
        throw new Error("unexpected definition");
      const [first] = document.content.thresholds;
      if (first === undefined) throw new Error("fixture too small");
      return CalibrationOperationV1Schema.parse({
        kind: "replace-risk-acceptance-threshold",
        definitionType: "risk-acceptance-threshold",
        threshold: {
          ...first,
          applicabilityConditions:
            first.applicabilityConditions.length === 0
              ? [{ dimension: "工程阶段数据", values: ["calibration-adjusted"] }]
              : first.applicabilityConditions.map((condition, index) =>
                  index === 0
                    ? {
                        ...condition,
                        values: [...condition.values, "calibration-adjusted"].sort(),
                      }
                    : condition,
                ),
        },
      });
    }
    case "monitoring-warning-threshold": {
      const document = monitoringDocument();
      if (document.definitionType !== "monitoring-warning-threshold")
        throw new Error("unexpected definition");
      const [first] = document.content.thresholds;
      if (first === undefined) throw new Error("fixture too small");
      return CalibrationOperationV1Schema.parse({
        kind: "replace-monitoring-warning-threshold",
        definitionType: "monitoring-warning-threshold",
        threshold: { ...first, warningLevelId: "warning-level-adjusted" },
      });
    }
    case "deviation-policy": {
      const document = deviationPolicyDocument();
      if (document.definitionType !== "deviation-policy") throw new Error("unexpected definition");
      const [first] = document.content.policies;
      if (first === undefined) throw new Error("fixture too small");
      return CalibrationOperationV1Schema.parse({
        kind: "replace-deviation-policy",
        definitionType: "deviation-policy",
        policy: { ...first, evidenceRequirements: ["calibration-adjusted"] },
      });
    }
    case "structured-scoring-rule": {
      const document = makeScoringRuleDocument();
      const [first] = document.members;
      if (first === undefined) throw new Error("fixture too small");
      const [threshold] = first.rule.scoringThresholds;
      if (threshold === undefined) throw new Error("fixture too small");
      return CalibrationOperationV1Schema.parse({
        kind: "replace-scoring-rule-interval",
        definitionType: "structured-scoring-rule",
        ruleId: first.rule.ruleId,
        replacement: { kind: "threshold", threshold: { ...threshold, score: 9 } },
      });
    }
  }
};

const documentFor = (
  definitionType: CalibrationTargetDefinitionTypeV1,
): CalibrationTargetDocumentV1 =>
  definitionType === "structured-scoring-rule"
    ? makeScoringRuleDocument()
    : definitionType === "weight-set"
      ? weightSetDocument()
      : definitionType === "risk-matrix"
        ? riskMatrixDocument()
        : definitionType === "risk-acceptance-threshold"
          ? acceptanceDocument()
          : definitionType === "monitoring-warning-threshold"
            ? monitoringDocument()
            : deviationPolicyDocument();

/** 双带矩阵：单个带状替换自身合法但会破坏相邻边界，用于验证完整文档收口。 */
const twoBandRiskMatrixDocument = (): Extract<
  CalibrationTargetDocumentV1,
  { definitionType: "risk-matrix" }
> =>
  RiskMatrixDocumentV1Schema.parse({
    schemaVersion: "1",
    definitionType: "risk-matrix",
    projectRevisionRef: configurationSet.projectRevisionRef,
    configurationSetRef: configurationSet.configurationSetRef,
    content: {
      matrixId: "calibration-matrix-two-band",
      matrixVersion: "1",
      possibilityAxis: {
        bands: [
          { bandId: "possibility-band-1", lower: "0", upper: "1" },
          { bandId: "possibility-band-2", lower: "1", upper: "2" },
        ],
      },
      consequenceAxis: { bands: [{ bandId: "consequence-band-1", lower: "0", upper: "1" }] },
      riskLevels: [{ levelId: "level-1", ordinal: 1 }],
      cells: [
        {
          possibilityBandId: "possibility-band-1",
          consequenceBandId: "consequence-band-1",
          riskLevelId: "level-1",
        },
        {
          possibilityBandId: "possibility-band-2",
          consequenceBandId: "consequence-band-1",
          riskLevelId: "level-1",
        },
      ],
    },
  });

const CALIBRATION_TARGET_TYPES: readonly CalibrationTargetDefinitionTypeV1[] = [
  "weight-set",
  "risk-matrix",
  "risk-acceptance-threshold",
  "monitoring-warning-threshold",
  "deviation-policy",
  "structured-scoring-rule",
];

/** 单条替换会破坏每轴 10000 基点的总量约束，因此权重集必须成对等量调整。 */
const validOperationsFor = (
  definitionType: CalibrationTargetDefinitionTypeV1,
): readonly CalibrationOperationV1[] => {
  const operation = validOperationFor(definitionType);
  if (definitionType !== "weight-set") return [operation];
  const document = weightSetDocument();
  if (document.definitionType !== "weight-set") throw new Error("unexpected definition");
  const [first, second] = document.content.possibilityWeights;
  if (first === undefined || second === undefined) throw new Error("fixture too small");
  return [
    CalibrationOperationV1Schema.parse({
      kind: "replace-weight-entry",
      definitionType: "weight-set",
      axis: "possibility",
      entry: { indicatorId: first.indicatorId, basisPoints: first.basisPoints - 1000 },
    }),
    CalibrationOperationV1Schema.parse({
      kind: "replace-weight-entry",
      definitionType: "weight-set",
      axis: "possibility",
      entry: { indicatorId: second.indicatorId, basisPoints: second.basisPoints + 1000 },
    }),
  ];
};

describe("C29 校准领域规则", () => {
  it("由不可变事实与候选摘要稳定派生身份", () => {
    const deviationFactRef = {
      kind: "response-deviation-fact" as const,
      reference: versionRef("fact-1"),
    };
    const first = deriveDeviationRecordRef({
      projectId: "project-1",
      deviationFactRef: deviationFactRef.reference,
    });
    const replay = deriveDeviationRecordRef({
      projectId: "project-1",
      deviationFactRef: deviationFactRef.reference,
    });
    const otherProject = deriveDeviationRecordRef({
      projectId: "project-2",
      deviationFactRef: deviationFactRef.reference,
    });
    const otherFact = deriveDeviationRecordRef({
      projectId: "project-1",
      deviationFactRef: versionRef("fact-2"),
    });
    expect(replay).toEqual(first);
    expect(first.reference.versionId).toBe("1");
    expect(otherProject.reference.entityId).not.toBe(first.reference.entityId);
    expect(otherFact.reference.entityId).not.toBe(first.reference.entityId);

    const base = {
      deviationRecordRef: first.reference,
      agentTaskResultRef: agentTaskResultRef.reference,
      calibrationValidationPolicyRef: versionRef("validation"),
    };
    const suggestion = deriveCalibrationSuggestionRef({ ...base, candidateDigest: "a".repeat(64) });
    expect(deriveCalibrationSuggestionRef({ ...base, candidateDigest: "a".repeat(64) })).toEqual(
      suggestion,
    );
    expect(
      deriveCalibrationSuggestionRef({ ...base, candidateDigest: "b".repeat(64) }).reference
        .entityId,
    ).not.toBe(suggestion.reference.entityId);
    expect(
      deriveCalibrationSuggestionRef({
        ...base,
        agentTaskResultRef: versionRef("calibration-result", "2"),
        candidateDigest: "a".repeat(64),
      }).reference.entityId,
    ).not.toBe(suggestion.reference.entityId);
    const successor = deriveSuccessorCalibrationSuggestionRef({
      predecessorSuggestionRef: suggestion.reference,
      reviewDecisionRef: versionRef("return-decision"),
    });
    expect(successor.reference.versionId).toBe("2");
    expect(
      deriveSuccessorCalibrationSuggestionRef({
        predecessorSuggestionRef: suggestion.reference,
        reviewDecisionRef: versionRef("return-decision"),
      }),
    ).toEqual(successor);
    expect(
      deriveSuccessorCalibrationSuggestionRef({
        predecessorSuggestionRef: successor.reference,
        reviewDecisionRef: versionRef("return-decision-2"),
      }).reference.versionId,
    ).toBe("3");

    const snapshot = deriveCalibrationInputSnapshotRef({
      projectId: "project-1",
      deviationFactRef: deviationFactRef.reference,
      targetReleaseRef: versionRef("release-1"),
      calibrationValidationPolicyRef: versionRef("validation"),
    });
    expect(
      deriveCalibrationInputSnapshotRef({
        projectId: "project-1",
        deviationFactRef: deviationFactRef.reference,
        targetReleaseRef: versionRef("release-1"),
        calibrationValidationPolicyRef: versionRef("validation"),
      }),
    ).toEqual(snapshot);
    expect(
      deriveCalibrationInputSnapshotRef({
        projectId: "project-1",
        deviationFactRef: deviationFactRef.reference,
        targetReleaseRef: versionRef("release-2"),
        calibrationValidationPolicyRef: versionRef("validation"),
      }).reference.entityId,
    ).not.toBe(snapshot.reference.entityId);
  });

  it.each(CALIBRATION_TARGET_TYPES)(
    "%s 上的类型化操作通过完整文档 Schema 与摘要重放",
    (definitionType) => {
      const document = documentFor(definitionType);
      const operations = validOperationsFor(definitionType);
      const outcome = validateCalibrationCandidate({
        definitionType,
        document,
        candidate: candidate(operations),
      });
      expect(outcome.validation).toMatchObject({
        disposition: "accepted",
        items: operations.map((operation, index) => ({
          operationIndex: index,
          operationKind: operation.kind,
          disposition: "accepted",
        })),
      });
      expect(outcome.validation.rejectionClass).toBeUndefined();
      expect(outcome.contentDigest).toMatch(/^[0-9a-f]{64}$/u);

      // 相同冻结基准与同一操作必须重建同一完整候选文档与摘要。
      const replay = applyCalibrationOperations({
        definitionType,
        document,
        operations,
      });
      expect(digestDocument(definitionType, replay.document)).toBe(outcome.contentDigest);
      expect(replay.document).toEqual(outcome.document);
      // 未应用的基准摘要必须不同于候选摘要。
      expect(digestDocument(definitionType, document)).not.toBe(outcome.contentDigest);
    },
  );

  it("选择器缺失与文档非法只产生可修复拒绝", () => {
    const document = documentFor("weight-set");
    if (document.definitionType !== "weight-set") throw new Error("unexpected definition");
    const missing = validateCalibrationCandidate({
      definitionType: "weight-set",
      document,
      candidate: candidate([
        CalibrationOperationV1Schema.parse({
          kind: "replace-weight-entry",
          definitionType: "weight-set",
          axis: "possibility",
          entry: { indicatorId: "indicator-absent", basisPoints: 1 },
        }),
      ]),
    });
    expect(missing.validation.disposition).toBe("rejected");
    expect(missing.validation.rejectionClass).toBe("repairable");
    expect(missing.validation.items[0]).toMatchObject({
      disposition: "rejected",
      reasonCode: "calibration-operation-selector-missing",
    });
    expect(missing.document).toBeUndefined();

    const [firstWeight] = document.content.possibilityWeights;
    if (firstWeight === undefined) throw new Error("fixture too small");
    const brokenWeights = validateCalibrationCandidate({
      definitionType: "weight-set",
      document,
      candidate: candidate([
        CalibrationOperationV1Schema.parse({
          kind: "replace-weight-entry",
          definitionType: "weight-set",
          axis: "possibility",
          entry: { ...firstWeight, basisPoints: 1 },
        }),
      ]),
    });
    expect(brokenWeights.validation).toMatchObject({
      disposition: "rejected",
      rejectionClass: "repairable",
      items: [{ reasonCode: "calibration-document-invalid" }],
    });

    // 单项操作自身合法、但破坏矩阵相邻边界时，完整文档 Schema 必须拒绝该候选。
    const matrix = twoBandRiskMatrixDocument();
    const [first] = matrix.content.possibilityAxis.bands;
    if (first === undefined) throw new Error("fixture too small");
    const brokenMatrix = validateCalibrationCandidate({
      definitionType: "risk-matrix",
      document: matrix,
      candidate: candidate([
        CalibrationOperationV1Schema.parse({
          kind: "replace-risk-matrix-band",
          definitionType: "risk-matrix",
          axis: "possibility",
          band: { bandId: first.bandId, lower: first.lower, upper: "0.5" },
        }),
      ]),
    });
    expect(brokenMatrix.validation.disposition).toBe("rejected");
    expect(brokenMatrix.validation.rejectionClass).toBe("repairable");
    expect(brokenMatrix.validation.items[0]?.reasonCode).toBe("calibration-document-invalid");
    expect(brokenMatrix.contentDigest).toBeUndefined();
  });

  it("越出冻结目标的操作是终结性拒绝且不产生部分文档", () => {
    const mismatched = validateCalibrationCandidate({
      definitionType: "weight-set",
      document: documentFor("weight-set"),
      candidate: candidate([
        CalibrationOperationV1Schema.parse({
          kind: "replace-deviation-policy",
          definitionType: "deviation-policy",
          policy: { ...deviationPolicyContent(), evidenceRequirements: ["adjusted"] },
        }),
      ]),
    });
    expect(mismatched.validation.disposition).toBe("rejected");
    expect(mismatched.validation.rejectionClass).toBe("terminal");
    expect(mismatched.validation.items[0]?.reasonCode).toBe(
      "calibration-operation-definition-mismatch",
    );
    expect(mismatched.document).toBeUndefined();

    // 一项通过、另一项越界时也不得留下部分文档。
    const mixed = validateCalibrationCandidate({
      definitionType: "weight-set",
      document: documentFor("weight-set"),
      candidate: candidate([
        ...validOperationsFor("weight-set"),
        CalibrationOperationV1Schema.parse({
          kind: "replace-monitoring-warning-threshold",
          definitionType: "monitoring-warning-threshold",
          threshold: monitoringThresholdContent(),
        }),
      ]),
    });
    expect(mixed.validation.disposition).toBe("rejected");
    expect(mixed.validation.items.map((item) => item.disposition)).toEqual([
      "accepted",
      "accepted",
      "rejected",
    ]);
    expect(mixed.document).toBeUndefined();
  });

  it("拒绝自由路径与整对象增量的操作形态", () => {
    for (const invalid of [
      {
        kind: "replace-weight-entry",
        definitionType: "weight-set",
        axis: "possibility",
        entry: { indicatorId: "indicator-1", basisPoints: 1 },
        path: "/content/possibilityWeights/0",
      },
      { kind: "replace-weight-entry", jsonPatch: [{ op: "replace", path: "/x", value: 1 }] },
      { kind: "replace-weight-set", definitionType: "weight-set", content: {} },
      { kind: "replace-deviation-policy", definitionType: "weight-set", policies: [] },
    ]) {
      expect(CalibrationOperationV1Schema.safeParse(invalid).success, JSON.stringify(invalid)).toBe(
        false,
      );
    }
    expect(
      CalibrationCandidateV1Schema.safeParse({
        ...candidate([validOperationFor("weight-set")]),
        operations: [],
      }).success,
    ).toBe(false);
    expect(
      CalibrationCandidateV1Schema.safeParse({
        ...candidate([validOperationFor("weight-set")]),
        rationale: "   ",
      }).success,
    ).toBe(false);
  });

  it("固定校准任务的任务类型、工具白名单与结果族", () => {
    const definition = createCalibrationSuggestionTaskDefinition({
      policy: {
        definitionRef: versionRef("calibration-definition"),
        toolPolicyRef: versionRef("calibration-tools"),
        incrementSchemaRef: versionRef("calibration-increment"),
        validationPolicyRef: versionRef("calibration-validation"),
        evidenceRequirementCount: 1,
        maxOperations: 4,
        budgetPolicy: {
          schemaVersion: "1",
          policyRef: versionRef("calibration-budget"),
          modelDeploymentRef: versionRef("model"),
          promptTemplateRef: versionRef("prompt"),
          toolPolicyRef: versionRef("calibration-tools"),
          maxModelInvocations: 4,
          maxToolInvocations: 1,
          maxContextTokens: 8192,
          maxInputBytes: 1_048_576,
          maxOutputBytes: 1_048_576,
          maxCandidates: 2,
          maxObjects: 64,
          maxSupplementarySearches: 0,
          maxCorrections: 1,
          maxTransientRetries: 1,
          maxConcurrentActions: 1,
          maxWallClockMs: 60_000,
        },
      },
      port: {
        validateIncrement: () => {
          throw new Error("not used");
        },
        finalizeIncrement: () => {
          throw new Error("not used");
        },
      },
    });
    expect(definition.metadata).toMatchObject({
      taskType: "calibration-suggestion",
      supportedTriggerModes: ["embedded"],
      allowedToolRefs: [],
      resultFamilies: ["calibration-suggestion"],
    });
    expect(definition.tools).toEqual([]);
    const typed = candidate(validOperationsFor("weight-set"));
    expect(definition.candidateSchema.parse(typed)).toEqual(typed);
    expect(
      definition.candidateSchema.safeParse({
        ...typed,
        operations: Array.from({ length: 5 }, () => validOperationFor("weight-set")),
      }).success,
    ).toBe(false);
    expect(definition.measureCandidateUsage(typed, {} as never)).toEqual({
      candidates: 1,
      objects: 2,
    });
  });

  it("候选摘要绑定全部操作、理由与证据", () => {
    const base = candidate(validOperationsFor("weight-set"));
    expect(calibrationCandidateDigest(base)).toMatch(/^[0-9a-f]{64}$/u);
    expect(calibrationCandidateDigest(base)).toBe(sha256CanonicalJson(base));
    expect(calibrationCandidateDigest({ ...base, rationale: "另一条理由" })).not.toBe(
      calibrationCandidateDigest(base),
    );
    expect(
      calibrationCandidateDigest({
        ...base,
        inputSnapshotRef: {
          kind: "calibration-input-snapshot",
          reference: candidateVersionRef("snapshot-2"),
        },
      }),
    ).not.toBe(calibrationCandidateDigest(base));
    expect(
      calibrationCandidateDigest({
        ...base,
        evidenceReferences: [
          {
            locator: { sourceSegmentId: "segment-2" },
            sourceVersion: candidateVersionRef("source-version-2"),
          },
        ],
      }),
    ).not.toBe(calibrationCandidateDigest(base));
  });

  it("失败原因映射到闭合公共错误码", () => {
    const targetRef = { kind: "calibration-suggestion", reference: versionRef("suggestion-1") };
    expect(
      toCalibrationModuleError(
        {
          code: "AUTHORIZATION_DENIED",
          reasonCode: "calibration-authorization-required",
          targetRef,
        },
        "run-1",
        "warning-response.record",
      ),
    ).toMatchObject({ code: "AUTHORIZATION_DENIED", category: "authorization", retryable: false });
    expect(
      toCalibrationModuleError(
        {
          code: "STALE_VERSION",
          reasonCode: "calibration-base-artifact-mismatch",
          targetRef,
        },
        "run-1",
        "warning-response.record",
      ),
    ).toMatchObject({ code: "STALE_VERSION", category: "concurrency" });
    expect(
      toCalibrationModuleError(
        {
          code: "BUSINESS_BLOCKED",
          reasonCode: "calibration-review-decision-not-approval",
          targetRef,
        },
        "run-1",
        "warning-response.record",
      ),
    ).toMatchObject({
      code: "BUSINESS_BLOCKED",
      blockerKind: "calibration-review-decision-not-approval",
    });

    // 失败引用必须是闭合公共引用；形态不足时退化为稳定模块引用。
    const degraded = toCalibrationModuleError(
      { code: "TERMINAL_FAILURE", reasonCode: "calibration-contract-drift", targetRef },
      "run-1",
      "warning-response.record",
    );
    expect(degraded).toMatchObject({ code: "TERMINAL_FAILURE", retryable: false });

    expect(() => failCalibration("calibration-deviation-within-threshold", targetRef)).toThrowError(
      /BUSINESS_BLOCKED/u,
    );
    expect(() => failCalibration("calibration-review-decision-not-found", targetRef)).toThrowError(
      /ENTITY_NOT_FOUND/u,
    );
    expect(CalibrationValidationItemV1Schema.safeParse({ operationIndex: 0 }).success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 目标文档片段助手                                                            */
/* -------------------------------------------------------------------------- */

function deviationPolicyContent() {
  const document = deviationPolicyDocument();
  if (document.definitionType !== "deviation-policy") throw new Error("unexpected definition");
  const [first] = document.content.policies;
  if (first === undefined) throw new Error("fixture too small");
  return first;
}

function monitoringThresholdContent() {
  const document = monitoringDocument();
  if (document.definitionType !== "monitoring-warning-threshold")
    throw new Error("unexpected definition");
  const [first] = document.content.thresholds;
  if (first === undefined) throw new Error("fixture too small");
  return first;
}
