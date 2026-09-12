import type { WarningTriggerType } from "@riskflow/contracts/vocabulary";
import {
  ContractReferenceV1Schema,
  type ContractReferenceV1,
  type ProjectRevisionRefV1,
} from "@riskflow/contracts/ports";

import { sha256CanonicalJson } from "../persistence/index.js";
import { resolveCanonicalDecimalBandIndex } from "./decimal.js";
import {
  ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1,
  AssessmentConfigurationDocumentV1Schema,
  MeasureLibraryContentV1Schema,
  type ApplicabilityConditionV1,
  type AssessmentConfigurationDefinitionTypeV1,
  type AssessmentConfigurationDocumentV1,
  type AssessmentConfigurationMetricV1,
  type AssessmentConfigurationMemberV1,
  type AssessmentConfigurationSummaryV1,
  type AssessmentFieldMappingV1,
  type AssessmentMeasureV1,
  type MeasureLibraryContentV1,
  type RiskMatrixCellV1,
  type RiskMatrixContentV1,
} from "./schema.js";

export type AssessmentConfigurationErrorCodeV1 =
  | "AUTHORIZATION_DENIED"
  | "ENTITY_NOT_FOUND"
  | "STALE_VERSION"
  | "BUSINESS_BLOCKED"
  | "IDEMPOTENCY_CONFLICT"
  | "TRANSIENT_FAILURE"
  | "TERMINAL_FAILURE";

export type AssessmentConfigurationReasonCodeV1 =
  | "assessment-configuration-media-type-invalid"
  | "assessment-configuration-size-exceeded"
  | "assessment-configuration-type-mismatch"
  | "assessment-configuration-request-invalid"
  | "assessment-configuration-project-mismatch"
  | "assessment-configuration-capability-required"
  | "assessment-configuration-content-invalid"
  | "assessment-configuration-indicator-coverage-invalid"
  | "assessment-configuration-unit-mapping-invalid"
  | "assessment-configuration-weight-total-invalid"
  | "assessment-configuration-matrix-invalid"
  | "assessment-configuration-joint-rule-invalid"
  | "assessment-configuration-reference-mismatch"
  | "assessment-configuration-incompatible"
  | "assessment-configuration-set-incomplete"
  | "assessment-configuration-set-mismatch"
  | "assessment-configuration-artifact-mismatch"
  | "assessment-configuration-artifact-unavailable"
  | "assessment-configuration-revision-unverified"
  | "assessment-configuration-policy-required"
  | "risk-matrix-value-out-of-range";

export interface AssessmentConfigurationFailureV1 {
  readonly code: AssessmentConfigurationErrorCodeV1;
  readonly reasonCode: AssessmentConfigurationReasonCodeV1;
  readonly targetRef: ContractReferenceV1;
}

export class AssessmentConfigurationError extends Error {
  readonly failure: AssessmentConfigurationFailureV1;

  constructor(failure: AssessmentConfigurationFailureV1) {
    super(failure.code);
    this.name = "AssessmentConfigurationError";
    this.failure = failure;
  }
}

export function failAssessmentConfiguration(
  reasonCode: AssessmentConfigurationReasonCodeV1,
  targetRef: ContractReferenceV1,
  code: AssessmentConfigurationErrorCodeV1 = "BUSINESS_BLOCKED",
): never {
  throw new AssessmentConfigurationError({ code, reasonCode, targetRef });
}

/** Recover a C18 failure from a raw error or an adapter-wrapped error. */
export const assessmentConfigurationFailureFrom = (
  error: unknown,
): AssessmentConfigurationFailureV1 | undefined => {
  if (error instanceof AssessmentConfigurationError) return error.failure;
  if (error instanceof Error && "assessmentConfigurationFailure" in error) {
    const failure = (error as Error & { assessmentConfigurationFailure?: unknown })
      .assessmentConfigurationFailure;
    return typeof failure === "object" && failure !== null
      ? (failure as AssessmentConfigurationFailureV1)
      : undefined;
  }
  return undefined;
};

export const ASSESSMENT_CONFIGURATION_SET_TARGET_REF_V1: ContractReferenceV1 =
  ContractReferenceV1Schema.parse({
    kind: "knowledge-revision",
    reference: { entityId: "assessment-configuration:set", versionId: "1" },
  });

const documentTargetRef = (document: AssessmentConfigurationDocumentV1): ContractReferenceV1 =>
  ContractReferenceV1Schema.parse({
    kind: "knowledge-revision",
    reference: {
      entityId: `assessment-configuration:${document.definitionType}`,
      versionId: document.configurationSetRef.versionId,
    },
  });

export const parseAssessmentConfigurationDocument = (
  value: unknown,
  targetRef: ContractReferenceV1,
): AssessmentConfigurationDocumentV1 => {
  const parsed = AssessmentConfigurationDocumentV1Schema.safeParse(value);
  if (!parsed.success) {
    failAssessmentConfiguration("assessment-configuration-content-invalid", targetRef);
  }
  return parsed.data as AssessmentConfigurationDocumentV1;
};

/* -------------------------------------------------------------------------- */
/* Local validation                                                           */
/* -------------------------------------------------------------------------- */

/** C14 fixes the unit of these frozen features; derived features keep the base unit. */
const FIXED_METRIC_UNITS_V1: Readonly<Partial<Record<AssessmentConfigurationMetricV1, string>>> = {
  "dominant-frequency": "Hz",
  "anomaly-score": "score",
};

const metricUnitMatches = (metric: AssessmentConfigurationMetricV1, unit: string): boolean => {
  const fixed = FIXED_METRIC_UNITS_V1[metric];
  if (fixed !== undefined) return unit === fixed;
  const suffix =
    metric === "short-term-slope" ? "/s" : metric === "acceleration" ? "/s^2" : undefined;
  return suffix === undefined || (unit.endsWith(suffix) && unit.length > suffix.length);
};

const validateFieldMappings = (
  mappings: readonly AssessmentFieldMappingV1[],
  targetRef: ContractReferenceV1,
): void => {
  for (const mapping of mappings) {
    if (mapping.sourceUnit !== mapping.targetUnit && mapping.conversion.kind === "identity") {
      failAssessmentConfiguration("assessment-configuration-unit-mapping-invalid", targetRef);
    }
    if (mapping.origin.kind === "source-field") continue;
    if (!metricUnitMatches(mapping.origin.metric, mapping.sourceUnit)) {
      failAssessmentConfiguration("assessment-configuration-unit-mapping-invalid", targetRef);
    }
  }
};

const cellIdentity = (possibilityBandId: string, consequenceBandId: string): string =>
  `${possibilityBandId}\u0000${consequenceBandId}`;

const validateRiskMatrix = (content: RiskMatrixContentV1, targetRef: ContractReferenceV1): void => {
  const levelIds = new Set(content.riskLevels.map((level) => level.levelId));
  const expected = new Set<string>();
  for (const possibilityBand of content.possibilityAxis.bands) {
    for (const consequenceBand of content.consequenceAxis.bands) {
      expected.add(cellIdentity(possibilityBand.bandId, consequenceBand.bandId));
    }
  }
  if (
    content.cells.some((cell) => !levelIds.has(cell.riskLevelId)) ||
    content.cells.length !== expected.size ||
    content.cells.some(
      (cell) => !expected.has(cellIdentity(cell.possibilityBandId, cell.consequenceBandId)),
    )
  ) {
    failAssessmentConfiguration("assessment-configuration-matrix-invalid", targetRef);
  }
};

export const validateAssessmentConfigurationDocument = (
  document: AssessmentConfigurationDocumentV1,
): void => {
  const targetRef = documentTargetRef(document);
  switch (document.definitionType) {
    case "indicator-system": {
      const indicators = document.content.indicators;
      const possibility = indicators.filter(
        (indicator) => indicator.indicatorType === "发生可能性评估指标",
      ).length;
      const consequence = indicators.filter(
        (indicator) => indicator.indicatorType === "后果严重性评估指标",
      ).length;
      const groups = new Set(indicators.map((indicator) => indicator.group));
      if (possibility === 0 || consequence === 0 || groups.size < 2) {
        failAssessmentConfiguration(
          "assessment-configuration-indicator-coverage-invalid",
          targetRef,
        );
      }
      return;
    }
    case "indicator-field-mapping":
      validateFieldMappings(document.content.mappings, targetRef);
      return;
    case "weight-set": {
      for (const entries of [
        document.content.possibilityWeights,
        document.content.consequenceWeights,
      ]) {
        const total = entries.reduce((sum, entry) => sum + entry.basisPoints, 0);
        if (total !== 10_000 || !entries.some((entry) => entry.basisPoints > 0)) {
          failAssessmentConfiguration("assessment-configuration-weight-total-invalid", targetRef);
        }
      }
      return;
    }
    case "risk-matrix":
      validateRiskMatrix(document.content, targetRef);
      return;
    default:
      return;
  }
};

/* -------------------------------------------------------------------------- */
/* Cross-document validation                                                  */
/* -------------------------------------------------------------------------- */

const requireDocument = <T extends AssessmentConfigurationDefinitionTypeV1>(
  documents: ReadonlyMap<string, AssessmentConfigurationDocumentV1>,
  definitionType: T,
  targetRef: ContractReferenceV1,
): Extract<AssessmentConfigurationDocumentV1, { definitionType: T }> => {
  const document = documents.get(definitionType);
  if (document === undefined) {
    failAssessmentConfiguration("assessment-configuration-set-incomplete", targetRef);
  }
  return document as Extract<AssessmentConfigurationDocumentV1, { definitionType: T }>;
};

const sameVersionReference = (
  left: { entityId: string; versionId: string },
  right: { entityId: string; versionId: string },
): boolean => left.entityId === right.entityId && left.versionId === right.versionId;

const validateIndicatorReferences = (input: {
  readonly documents: ReadonlyMap<string, AssessmentConfigurationDocumentV1>;
  readonly targetRef: ContractReferenceV1;
}): void => {
  const indicatorSystem = requireDocument(input.documents, "indicator-system", input.targetRef);
  const indicators = new Map(
    indicatorSystem.content.indicators.map((indicator) => [indicator.indicatorId, indicator]),
  );
  const requireIndicator = (indicatorId: string) => {
    const indicator = indicators.get(indicatorId);
    if (indicator === undefined) {
      failAssessmentConfiguration("assessment-configuration-reference-mismatch", input.targetRef);
    }
    return indicator;
  };

  const mappings = requireDocument(input.documents, "indicator-field-mapping", input.targetRef)
    .content.mappings;
  for (const mapping of mappings) {
    const indicator = requireIndicator(mapping.targetIndicatorId);
    if (indicator.valueKind === "numeric" && mapping.targetUnit !== indicator.canonicalUnit) {
      failAssessmentConfiguration("assessment-configuration-reference-mismatch", input.targetRef);
    }
    if (mapping.origin.kind !== "source-field" && indicator.valueKind !== "numeric") {
      failAssessmentConfiguration("assessment-configuration-reference-mismatch", input.targetRef);
    }
  }

  const weightSet = requireDocument(input.documents, "weight-set", input.targetRef).content;
  const sides = [
    ["发生可能性评估指标", weightSet.possibilityWeights],
    ["后果严重性评估指标", weightSet.consequenceWeights],
  ] as const;
  for (const [indicatorType, weights] of sides) {
    const expected = indicatorSystem.content.indicators
      .filter((indicator) => indicator.indicatorType === indicatorType)
      .map((indicator) => indicator.indicatorId)
      .sort()
      .join("\u0000");
    const assigned = weights
      .map((entry) => requireIndicator(entry.indicatorId).indicatorId)
      .sort()
      .join("\u0000");
    if (expected !== assigned) {
      failAssessmentConfiguration("assessment-configuration-reference-mismatch", input.targetRef);
    }
  }

  const strategy = requireDocument(input.documents, "scoring-strategy", input.targetRef).content;
  for (const axis of [strategy.possibility, strategy.consequence]) {
    if (axis.kind !== "weighted-average") continue;
    if (
      !sameVersionReference(axis.weightSetRef, {
        entityId: weightSet.weightSetId,
        versionId: weightSet.weightSetVersion,
      })
    ) {
      failAssessmentConfiguration("assessment-configuration-reference-mismatch", input.targetRef);
    }
  }

  const measureLibrary = requireDocument(
    input.documents,
    "measure-library",
    input.targetRef,
  ).content;
  for (const measure of measureLibrary.measures) {
    for (const indicatorId of measure.targetIndicatorIds) requireIndicator(indicatorId);
  }

  const forecastPolicies = requireDocument(input.documents, "forecast-policy", input.targetRef)
    .content.policies;
  for (const policy of forecastPolicies) {
    const target = requireIndicator(policy.targetIndicatorId);
    if (target.valueKind !== "numeric" || policy.unit !== target.canonicalUnit) {
      failAssessmentConfiguration("assessment-configuration-reference-mismatch", input.targetRef);
    }
    for (const indicatorId of policy.inputIndicatorIds) requireIndicator(indicatorId);
  }
};

const validateMatrixReferences = (input: {
  readonly documents: ReadonlyMap<string, AssessmentConfigurationDocumentV1>;
  readonly targetRef: ContractReferenceV1;
}): void => {
  const matrix = requireDocument(input.documents, "risk-matrix", input.targetRef).content;
  const levelIds = new Set(matrix.riskLevels.map((level) => level.levelId));
  const matrixRef = { entityId: matrix.matrixId, versionId: matrix.matrixVersion };

  const acceptance = requireDocument(
    input.documents,
    "risk-acceptance-threshold",
    input.targetRef,
  ).content;
  if (
    !sameVersionReference(acceptance.riskMatrixRef, matrixRef) ||
    acceptance.thresholds.some((threshold) => !levelIds.has(threshold.maximumAcceptedLevelId))
  ) {
    failAssessmentConfiguration("assessment-configuration-reference-mismatch", input.targetRef);
  }

  const warning = requireDocument(
    input.documents,
    "monitoring-warning-threshold",
    input.targetRef,
  ).content;
  if (
    !sameVersionReference(warning.riskMatrixRef, matrixRef) ||
    warning.thresholds.some((threshold) => !levelIds.has(threshold.warningLevelId))
  ) {
    failAssessmentConfiguration("assessment-configuration-reference-mismatch", input.targetRef);
  }

  const deviationPolicies = requireDocument(input.documents, "deviation-policy", input.targetRef)
    .content.policies;
  for (const policy of deviationPolicies) {
    if (policy.basis !== "risk-level-step") continue;
    if (!sameVersionReference(policy.riskMatrixRef, matrixRef)) {
      failAssessmentConfiguration("assessment-configuration-reference-mismatch", input.targetRef);
    }
  }
};

const validateThresholdReferences = (input: {
  readonly documents: ReadonlyMap<string, AssessmentConfigurationDocumentV1>;
  readonly targetRef: ContractReferenceV1;
}): void => {
  const warning = requireDocument(
    input.documents,
    "monitoring-warning-threshold",
    input.targetRef,
  ).content;
  const thresholdIds = new Set(warning.thresholds.map((threshold) => threshold.thresholdId));
  const mappings = requireDocument(input.documents, "indicator-field-mapping", input.targetRef)
    .content.mappings;

  for (const threshold of warning.thresholds) {
    const sourceMapping = mappings.find(
      (candidate) =>
        candidate.origin.kind !== "source-field" &&
        candidate.origin.monitoringIndicator === threshold.monitoringIndicator &&
        candidate.origin.parameterCode === threshold.parameterCode &&
        candidate.origin.metric === threshold.metric,
    );
    if (sourceMapping !== undefined && sourceMapping.sourceUnit !== threshold.unit) {
      failAssessmentConfiguration("assessment-configuration-reference-mismatch", input.targetRef);
    }
  }

  const jointPolicy = requireDocument(
    input.documents,
    "joint-trigger-policy",
    input.targetRef,
  ).content;
  for (const rule of jointPolicy.rules) {
    for (const thresholdId of rule.monitoringThresholdIds) {
      if (!thresholdIds.has(thresholdId)) {
        failAssessmentConfiguration("assessment-configuration-joint-rule-invalid", input.targetRef);
      }
    }
  }
};

export const validateAssessmentConfigurationSet = (
  documents: readonly AssessmentConfigurationDocumentV1[],
): void => {
  const first = documents[0];
  if (first === undefined) {
    failAssessmentConfiguration(
      "assessment-configuration-set-incomplete",
      ASSESSMENT_CONFIGURATION_SET_TARGET_REF_V1,
    );
  }
  const targetRef = documentTargetRef(first as AssessmentConfigurationDocumentV1);
  if (documents.length !== ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1.length) {
    failAssessmentConfiguration("assessment-configuration-set-incomplete", targetRef);
  }
  for (const document of documents) {
    if (
      !sameVersionReference(document.configurationSetRef, first.configurationSetRef) ||
      !sameVersionReference(
        document.projectRevisionRef.reference,
        first.projectRevisionRef.reference,
      )
    ) {
      failAssessmentConfiguration("assessment-configuration-set-mismatch", targetRef);
    }
  }
  const byType = new Map(documents.map((document) => [document.definitionType, document]));
  for (const definitionType of ASSESSMENT_CONFIGURATION_DEFINITION_TYPES_V1) {
    requireDocument(byType, definitionType, targetRef);
  }
  validateIndicatorReferences({ documents: byType, targetRef });
  validateMatrixReferences({ documents: byType, targetRef });
  validateThresholdReferences({ documents: byType, targetRef });
};

/* -------------------------------------------------------------------------- */
/* Pure derivation helpers                                                    */
/* -------------------------------------------------------------------------- */

export const mapRiskMatrixCell = (
  matrix: RiskMatrixContentV1,
  possibility: string,
  consequence: string,
): RiskMatrixCellV1 => {
  const possibilityIndex = resolveCanonicalDecimalBandIndex(
    matrix.possibilityAxis.bands.map((band) => ({ lower: band.lower, upper: band.upper })),
    possibility,
  );
  const consequenceIndex = resolveCanonicalDecimalBandIndex(
    matrix.consequenceAxis.bands.map((band) => ({ lower: band.lower, upper: band.upper })),
    consequence,
  );
  const possibilityBand = matrix.possibilityAxis.bands[possibilityIndex];
  const consequenceBand = matrix.consequenceAxis.bands[consequenceIndex];
  const targetRef = ContractReferenceV1Schema.parse({
    kind: "knowledge-revision",
    reference: {
      entityId: "assessment-configuration:risk-matrix",
      versionId: matrix.matrixVersion,
    },
  });
  if (possibilityBand === undefined || consequenceBand === undefined) {
    failAssessmentConfiguration("risk-matrix-value-out-of-range", targetRef);
  }
  const cell = matrix.cells.find(
    (candidate) =>
      candidate.possibilityBandId === possibilityBand.bandId &&
      candidate.consequenceBandId === consequenceBand.bandId,
  );
  if (cell === undefined) {
    failAssessmentConfiguration("risk-matrix-value-out-of-range", targetRef);
  }
  return cell;
};

const measureMatchesApplicability = (
  measure: AssessmentMeasureV1,
  applicability: readonly ApplicabilityConditionV1[],
): boolean =>
  measure.applicabilityConditions.every((condition) => {
    const actual = applicability.find((candidate) => candidate.dimension === condition.dimension);
    return actual !== undefined && actual.values.some((value) => condition.values.includes(value));
  });

export const selectMeasureCandidates = (input: {
  readonly library: MeasureLibraryContentV1;
  readonly riskEventCategory: string;
  readonly applicability: readonly ApplicabilityConditionV1[];
  readonly triggerType: WarningTriggerType;
}): readonly string[] => {
  const library = MeasureLibraryContentV1Schema.parse(input.library);
  return library.measures
    .filter(
      (measure) =>
        measure.riskEventCategory === input.riskEventCategory &&
        measure.triggerTypes.includes(input.triggerType) &&
        measureMatchesApplicability(measure, input.applicability),
    )
    .map((measure) => measure.measureId)
    .sort();
};

/** Bounded summary derived from the document identity collection. */
export const summarizeAssessmentConfigurationDocument = (
  document: AssessmentConfigurationDocumentV1,
): AssessmentConfigurationSummaryV1 => {
  const identityIds = ((): readonly string[] => {
    switch (document.definitionType) {
      case "indicator-system":
        return document.content.indicators.map((indicator) => indicator.indicatorId);
      case "indicator-field-mapping":
        return document.content.mappings.map((mapping) => mapping.mappingId);
      case "weight-set":
        return [
          ...document.content.possibilityWeights.map((entry) => entry.indicatorId),
          ...document.content.consequenceWeights.map((entry) => entry.indicatorId),
        ];
      case "scoring-strategy":
        return [];
      case "risk-matrix":
        return [
          ...document.content.riskLevels.map((level) => level.levelId),
          ...document.content.possibilityAxis.bands.map((band) => band.bandId),
          ...document.content.consequenceAxis.bands.map((band) => band.bandId),
        ];
      case "risk-acceptance-threshold":
        return document.content.thresholds.map((threshold) => threshold.thresholdId);
      case "monitoring-warning-threshold":
        return document.content.thresholds.map((threshold) => threshold.thresholdId);
      case "joint-trigger-policy":
        return document.content.rules.map((rule) => rule.ruleId);
      case "measure-library":
        return document.content.measures.map((measure) => measure.measureId);
      case "forecast-policy":
        return document.content.policies.map((policy) => policy.policyId);
      case "deviation-policy":
        return document.content.policies.map((policy) => policy.policyId);
    }
  })();
  const itemCount = ((): number => {
    switch (document.definitionType) {
      case "indicator-system":
        return document.content.indicators.length;
      case "indicator-field-mapping":
        return document.content.mappings.length;
      case "weight-set":
        return (
          document.content.possibilityWeights.length + document.content.consequenceWeights.length
        );
      case "risk-matrix":
        return document.content.cells.length;
      case "scoring-strategy":
        return 2;
      case "risk-acceptance-threshold":
      case "monitoring-warning-threshold":
        return document.content.thresholds.length;
      case "joint-trigger-policy":
        return document.content.rules.length;
      case "measure-library":
        return document.content.measures.length;
      case "forecast-policy":
      case "deviation-policy":
        return document.content.policies.length;
    }
  })();
  return { itemCount, identityIds: [...new Set(identityIds)].sort().slice(0, 64) };
};

export const assessmentConfigurationDocumentDigest = (
  document: AssessmentConfigurationDocumentV1,
): string => sha256CanonicalJson(document);

/* The set identity formula is fixed by D7 and must stay stable across runs. */
export const buildAssessmentConfigurationMemberIdentity = (input: {
  readonly projectId: string;
  readonly projectRevisionRef: ProjectRevisionRefV1;
  readonly configurationSetRef: { entityId: string; versionId: string };
  readonly requiredAt: string;
  readonly asOfRecordedAt: string;
  readonly members: readonly AssessmentConfigurationMemberV1[];
}): { readonly memberDigest: string; readonly identityDigest: string } => {
  const memberDigest = sha256CanonicalJson(input.members);
  return {
    memberDigest,
    identityDigest: sha256CanonicalJson({
      projectId: input.projectId,
      projectRevisionRef: input.projectRevisionRef,
      configurationSetRef: input.configurationSetRef,
      requiredAt: input.requiredAt,
      asOfRecordedAt: input.asOfRecordedAt,
      memberDigest,
    }),
  };
};
