import {
  QUALITY_METRIC_CODES_V1,
  QUALITY_SYNTHETIC_SAMPLE_LABEL_V1,
  qualityEvidenceReferenceKeyV1,
  type QualityDatasetV1,
  type QualityMetricCodeV1,
  type QualityMetricV1,
  type QualityReasonCodeV1,
  type QualitySampleClassificationV1,
  type QualitySampleEvidenceV1,
  type QualitySampleOutcomeV1,
  type QualitySampleV1,
} from "./schema.js";
import { evaluateDeterministicAssessment } from "../risk-assessment/engine/engine.js";

/**
 * D-02 确定性指标与逐项诊断：只消费冻结数据集、已授权的 C22/C29 正式输出快照与
 * C04 验证收据，不查询私表、不重跑 LLM、也不复制 C22 合并或 C29 评分算法。
 */
export interface QualityEvaluationInputV1 {
  readonly dataset: QualityDatasetV1;
  readonly evidence: readonly QualitySampleEvidenceV1[];
}

export interface QualityEvaluationOutcomeV1 {
  readonly metrics: readonly QualityMetricV1[];
  readonly samples: readonly QualitySampleOutcomeV1[];
  readonly evidenceChainStatus: "complete" | "partial";
}

const refKey = (value: { reference: { entityId: string; versionId: string } }): string =>
  `${value.reference.entityId}\u0000${value.reference.versionId}`;

const recordKey = (record: {
  readonly riskEvent: string;
  readonly processNodeId: string;
  readonly evidenceLocator: { readonly sourceSegmentId: string };
}): string =>
  `${record.riskEvent}\u0000${record.processNodeId}\u0000${record.evidenceLocator.sourceSegmentId}`;

const computed = (
  metricCode: QualityMetricCodeV1,
  numerator: number,
  denominator: number,
): QualityMetricV1 => ({
  metricCode,
  numerator,
  denominator,
  value: denominator === 0 ? null : numerator / denominator,
  status: denominator === 0 ? "not-computable" : "computed",
  ...(denominator === 0 ? { reasonCode: "quality-metric-denominator-zero" as const } : {}),
});

const notComputable = (
  metricCode: QualityMetricCodeV1,
  numerator: number,
  denominator: number,
  reasonCode: QualityReasonCodeV1,
): QualityMetricV1 => ({
  metricCode,
  numerator,
  denominator,
  value: null,
  status: "not-computable",
  reasonCode,
});

interface SampleEvaluationV1 {
  readonly outcome: QualitySampleOutcomeV1;
  readonly covered: boolean;
  readonly pairComparable: boolean;
}

/** 只有一个样例显式声明正式记录时才可能存在命中；缺声明即视为运行未产出结论。 */
const evaluateSample = (
  sample: QualitySampleV1,
  evidence: QualitySampleEvidenceV1 | undefined,
  keyConflicts: ReadonlySet<string>,
): SampleEvaluationV1 => {
  const reasonCodes: QualityReasonCodeV1[] = [];
  const declaredRecord = sample.riskRecordRef !== undefined;
  const snapshot = evidence?.recordSnapshot;
  const identity = evidence?.recordIdentity;
  let identityVerified = false;
  let keyMatched = false;
  let actualRiskLevelId: string | undefined;

  if (!declaredRecord) {
    reasonCodes.push("quality-identification-result-missing");
  } else if (snapshot === undefined || identity === undefined) {
    reasonCodes.push("quality-identification-result-missing");
  } else {
    const envelopeVersionId = snapshot.envelope.version.reference.versionId;
    const declaredVersionId = sample.riskRecordRef?.reference.versionId;
    identityVerified =
      identity.riskRecordId === snapshot.envelope.riskRecordId &&
      identity.riskRecordId === sample.riskRecordRef?.reference.entityId &&
      identity.versionId === envelopeVersionId &&
      identity.requestDigest === envelopeVersionId &&
      declaredVersionId === envelopeVersionId;
    if (!identityVerified) reasonCodes.push("quality-identification-evidence-unverified");
    const record = snapshot.envelope.record;
    const declaredSegments = new Set(
      sample.sourceSegmentRefs.map((reference) => reference.locator.sourceSegmentId),
    );
    keyMatched =
      identityVerified &&
      record.riskEvent === sample.expectedEventKey &&
      record.processNodeId === sample.processNodeId &&
      declaredSegments.has(record.evidenceLocator.sourceSegmentId);
    if (identityVerified && !keyMatched) reasonCodes.push("quality-identification-key-mismatch");
    if (identityVerified && keyConflicts.has(recordKey(record))) {
      keyMatched = false;
      reasonCodes.push("quality-identification-key-conflict");
    }
  }

  // 审计链完整率只按样例自己声明的耐久证据判定：声明的工件必须全部通过 C04 校验，
  // 声明记录时必须核对正式身份，声明评估时必须核对精确决策与记录引用，且样例明列的
  // 必审资料段必须逐项具有当前授权下的同形解析收据（D-10）；缺任一项即失败闭合。
  const verified = new Set((evidence?.verifiedEvidenceRefs ?? []).map(refKey));
  let evidenceVerified = true;
  for (const artifactRef of [
    sample.standardizedRiskRecordSnapshotArtifactRef,
    sample.assessmentDecisionArtifactRef,
    sample.assessmentReplayContextArtifactRef,
  ]) {
    if (artifactRef === undefined) continue;
    if (!verified.has(refKey(artifactRef))) evidenceVerified = false;
  }
  if (sample.standardizedRiskRecordSnapshotArtifactRef !== undefined && !identityVerified) {
    evidenceVerified = false;
  }
  const receiptKeys = new Set(
    (evidence?.requiredSegmentReceipts ?? []).map((receipt) =>
      qualityEvidenceReferenceKeyV1(receipt.evidenceReference),
    ),
  );
  if (
    !sample.requiredEvidenceRefs.every((required) =>
      receiptKeys.has(qualityEvidenceReferenceKeyV1(required)),
    )
  ) {
    evidenceVerified = false;
  }
  if (!evidenceVerified) reasonCodes.push("quality-evidence-artifact-unverified");

  const assessment = evidence?.assessment;
  let replayConsistent: boolean | null = null;
  if (sample.assessmentRecordRef !== undefined) {
    if (assessment === undefined) {
      reasonCodes.push("quality-assessment-decision-missing");
      evidenceVerified = false;
      if (sample.assessmentReplayContextArtifactRef !== undefined) {
        replayConsistent = false;
        reasonCodes.push("quality-assessment-replay-context-missing");
      }
    } else {
      actualRiskLevelId = assessment.decision.matrix.riskLevelId;
      const replay = assessment.replay;
      if (replay === undefined) {
        replayConsistent = false;
        reasonCodes.push("quality-assessment-replay-context-missing");
        evidenceVerified = false;
      } else {
        try {
          const replayed = evaluateDeterministicAssessment(replay.context, replay.audit);
          const frozen = assessment.decision;
          replayConsistent =
            replayed.decisionDigest === assessment.decisionDigest &&
            refKey(replayed.recordRef) === refKey(sample.assessmentRecordRef) &&
            replayed.decision.axisScores.possibility.score ===
              frozen.axisScores.possibility.score &&
            replayed.decision.axisScores.consequence.score ===
              frozen.axisScores.consequence.score &&
            replayed.decision.matrix.riskLevelId === frozen.matrix.riskLevelId &&
            replayed.decision.matrix.riskLevelOrdinal === frozen.matrix.riskLevelOrdinal;
          if (!replayConsistent) {
            reasonCodes.push("quality-assessment-replay-mismatch");
            evidenceVerified = false;
          }
        } catch {
          replayConsistent = false;
          reasonCodes.push("quality-assessment-replay-failed");
          evidenceVerified = false;
        }
      }
    }
  }

  const classification: QualitySampleClassificationV1 = keyMatched
    ? sample.expectedPositive
      ? "true-positive"
      : "false-positive"
    : sample.expectedPositive
      ? "false-negative"
      : "undetermined";

  return {
    outcome: {
      sampleId: sample.sampleId,
      expectedEventKey: sample.expectedEventKey,
      expectedPositive: sample.expectedPositive,
      classification,
      reasonCodes,
      ...(sample.riskRecordRef === undefined
        ? {}
        : {
            riskRecordId: sample.riskRecordRef.reference.entityId,
            riskRecordVersionId: sample.riskRecordRef.reference.versionId,
          }),
      recordIdentityVerified: identityVerified,
      recordKeyMatched: keyMatched,
      evidenceVerified,
      replayConsistent,
      ...(sample.expectedRiskLevelId === undefined
        ? {}
        : { expectedRiskLevelId: sample.expectedRiskLevelId }),
      ...(actualRiskLevelId === undefined ? {} : { actualRiskLevelId }),
    },
    covered: keyMatched,
    pairComparable: sample.comparisonGroupId !== undefined,
  };
};

export const evaluateQualityDataset = (
  input: QualityEvaluationInputV1,
): QualityEvaluationOutcomeV1 => {
  const evidenceBySample = new Map(input.evidence.map((entry) => [entry.sampleId, entry] as const));

  // 同一 (riskEvent, processNodeId, sourceSegmentId) 在冻结数据集内只能命中一个正式记录。
  const keyCounts = new Map<string, number>();
  for (const sample of input.dataset.samples) {
    const snapshot = evidenceBySample.get(sample.sampleId)?.recordSnapshot;
    if (snapshot === undefined) continue;
    const key = recordKey(snapshot.envelope.record);
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  const keyConflicts = new Set(
    [...keyCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key),
  );

  const evaluations = input.dataset.samples.map((sample) =>
    evaluateSample(sample, evidenceBySample.get(sample.sampleId), keyConflicts),
  );
  const samples = evaluations.map((evaluation) => evaluation.outcome);

  let truePositives = 0;
  let trueNegatives = 0;
  let falsePositives = 0;
  let covered = 0;
  let auditComplete = 0;
  let gradeExpected = 0;
  let gradeMatched = 0;
  let replayExpected = 0;
  let replayConsistent = 0;

  for (const evaluation of evaluations) {
    const { outcome } = evaluation;
    if (outcome.classification === "true-positive") truePositives += 1;
    else if (outcome.classification === "true-negative") trueNegatives += 1;
    else if (outcome.classification === "false-positive") falsePositives += 1;
    if (evaluation.covered) covered += 1;
    if (outcome.evidenceVerified) auditComplete += 1;
    if (outcome.expectedRiskLevelId !== undefined) {
      gradeExpected += 1;
      if (outcome.actualRiskLevelId === outcome.expectedRiskLevelId) gradeMatched += 1;
    }
    if (outcome.replayConsistent !== null) {
      replayExpected += 1;
      if (outcome.replayConsistent) replayConsistent += 1;
    }
  }

  // 跨来源一致性以数据集明列的可比来源对为分母：同一 comparisonGroupId 内两两成对。
  const groups = new Map<string, SampleEvaluationV1[]>();
  for (const [index, sample] of input.dataset.samples.entries()) {
    if (sample.comparisonGroupId === undefined) continue;
    const bucket = groups.get(sample.comparisonGroupId) ?? [];
    bucket.push(evaluations[index]!);
    groups.set(sample.comparisonGroupId, bucket);
  }
  let comparablePairs = 0;
  let consistentPairs = 0;
  for (const bucket of groups.values()) {
    for (let left = 0; left < bucket.length; left += 1) {
      for (let right = left + 1; right < bucket.length; right += 1) {
        comparablePairs += 1;
        const a = bucket[left]!;
        const b = bucket[right]!;
        if (
          a.outcome.classification === "undetermined" ||
          b.outcome.classification === "undetermined"
        )
          continue;
        if (a.outcome.classification === b.outcome.classification) consistentPairs += 1;
      }
    }
  }

  const total = input.dataset.samples.length;
  const accuracy = computed("accuracy", truePositives + trueNegatives, total);
  const precision =
    truePositives + falsePositives === 0
      ? notComputable("precision", 0, 0, "quality-metric-denominator-zero")
      : computed("precision", truePositives, truePositives + falsePositives);
  const coverage = computed("coverage", covered, total);
  const sourceConsistency =
    comparablePairs === 0
      ? notComputable("source-consistency", 0, 0, "quality-metric-denominator-zero")
      : computed("source-consistency", consistentPairs, comparablePairs);
  const gradeMatch =
    gradeExpected === 0
      ? notComputable("grade-match", 0, 0, "quality-metric-denominator-zero")
      : computed("grade-match", gradeMatched, gradeExpected);
  const replayRate =
    replayExpected === 0
      ? notComputable("replay-rate", 0, 0, "quality-metric-denominator-zero")
      : computed("replay-rate", replayConsistent, replayExpected);
  const auditCompleteness = computed("audit-completeness", auditComplete, total);

  const byCode = new Map<QualityMetricCodeV1, QualityMetricV1>(
    [
      accuracy,
      precision,
      coverage,
      sourceConsistency,
      gradeMatch,
      replayRate,
      auditCompleteness,
    ].map((metric) => [metric.metricCode, metric] as const),
  );

  return {
    metrics: QUALITY_METRIC_CODES_V1.map((code) => byCode.get(code)!),
    samples,
    evidenceChainStatus: samples.every((sample) => sample.evidenceVerified)
      ? "complete"
      : "partial",
  };
};

export const qualityLabelForDataset = (dataset: QualityDatasetV1): string =>
  dataset.sampleKind === "synthetic" ? QUALITY_SYNTHETIC_SAMPLE_LABEL_V1 : "";
