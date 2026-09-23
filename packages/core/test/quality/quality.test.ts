/** 合成样本、待甲方复核：本文件所有工程、身份、摘要与工件正文均为合成夹具，不代表真实工程性能。 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  StandardizedRiskRecordEnvelopeSchema,
  type StandardizedRiskRecordEnvelope,
} from "@riskflow/contracts/records";
import {
  C25_FIXTURE_RECORD_AUDIT,
  makeRiskAssessmentEngineContext,
} from "../risk-assessment/fixture.js";
import { evaluateDeterministicAssessment } from "../../src/risk-assessment/engine/index.js";
import {
  QualityDatasetV1Schema,
  type QualityDatasetV1,
  type QualitySampleEvidenceV1,
} from "../../src/quality/schema.js";
import { evaluateQualityDataset } from "../../src/quality/evaluate.js";

const synthetic = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/synthetic.json", import.meta.url)), "utf8"),
) as unknown;

const recordedAt = "2026-09-23T00:00:00.000Z";

const assessment = evaluateDeterministicAssessment(
  makeRiskAssessmentEngineContext(),
  C25_FIXTURE_RECORD_AUDIT,
);

const envelopeFor = (input: {
  readonly riskRecordId: string;
  readonly versionId: string;
  readonly processNodeId: string;
  readonly riskEvent: string;
  readonly sourceSegmentId: string;
}): StandardizedRiskRecordEnvelope =>
  StandardizedRiskRecordEnvelopeSchema.parse({
    riskRecordId: input.riskRecordId,
    record: {
      processNodeId: input.processNodeId,
      riskSource: "risk-source-synthetic",
      riskFactor: "risk-factor-synthetic",
      riskEvent: input.riskEvent,
      riskElementRelations: [
        { sourceElement: "element-a", relation: "affects", targetElement: "element-b" },
      ],
      evidenceLocator: { sourceSegmentId: input.sourceSegmentId },
      modelConfidence: 0.5,
    },
    riskMechanismEntryIds: ["mechanism-synthetic"],
    sourceIds: ["source-synthetic"],
    compositeConfidence: { value: 0.5, basis: ["synthetic:0.5"] },
    version: {
      reference: { entityId: input.riskRecordId, versionId: input.versionId },
      effectivePeriod: { validFrom: recordedAt },
      systemTime: { recordedAt },
    },
    audit: {
      actorId: "actor-quality-fixture",
      action: "identification.risk-record-accepted",
      recordedAt,
    },
  });

/**
 * 冻结数据集：标签、匹配键、版本与资料段来自仓库内合成 fixture；
 * 运行输出引用（正式记录、决策工件与重放上下文）由本次真实 C29 引擎输出绑定，
 * 因为它们只有在运行结束后才成立。C25 fixture 漂移会让本测试显式失败。
 */
const freezeSyntheticDataset = (): QualityDatasetV1 => {
  const draft = structuredClone(synthetic) as Record<string, unknown>;
  const samples = draft["samples"] as Record<string, unknown>[];
  for (const sample of samples) {
    const sampleId = sample["sampleId"];
    if (sampleId !== "sample-alpha-1" && sampleId !== "sample-alpha-2") continue;
    sample["assessmentRecordRef"] = assessment.recordRef;
    sample["expectedRiskLevelId"] = assessment.decision.matrix.riskLevelId;
  }
  return QualityDatasetV1Schema.parse(draft);
};

const dataset = freezeSyntheticDataset();
const sampleById = new Map(dataset.samples.map((sample) => [sample.sampleId, sample] as const));

const sample = (sampleId: string) => {
  const value = sampleById.get(sampleId);
  if (value === undefined) throw new Error(`unknown fixture sample ${sampleId}`);
  return value;
};

const snapshotEvidence = (sampleId: string, riskEvent: string): QualitySampleEvidenceV1 => {
  const declared = sample(sampleId);
  const snapshotRef = declared.standardizedRiskRecordSnapshotArtifactRef;
  const riskRecordRef = declared.riskRecordRef;
  if (snapshotRef === undefined || riskRecordRef === undefined)
    throw new Error(`fixture sample ${sampleId} does not declare a record`);
  const envelope = envelopeFor({
    riskRecordId: riskRecordRef.reference.entityId,
    versionId: riskRecordRef.reference.versionId,
    processNodeId: declared.processNodeId,
    riskEvent,
    sourceSegmentId: declared.sourceSegmentRefs[0]!.locator.sourceSegmentId,
  });
  return {
    sampleId,
    recordSnapshot: { artifactRef: snapshotRef, envelope },
    recordIdentity: {
      riskRecordId: envelope.riskRecordId,
      versionId: riskRecordRef.reference.versionId,
      requestDigest: riskRecordRef.reference.versionId,
    },
    verifiedEvidenceRefs: [snapshotRef],
  };
};

const assessmentEvidence = (sampleId: string): QualitySampleEvidenceV1 => {
  const base = snapshotEvidence(sampleId, sample(sampleId).expectedEventKey);
  const declared = sample(sampleId);
  const decisionRef = declared.assessmentDecisionArtifactRef;
  const replayRef = declared.assessmentReplayContextArtifactRef;
  if (decisionRef === undefined || replayRef === undefined)
    throw new Error(`fixture sample ${sampleId} does not declare assessment evidence`);
  return {
    ...base,
    assessment: {
      decisionArtifactRef: decisionRef,
      decision: assessment.decision,
      decisionDigest: assessment.decisionDigest,
      replay: {
        artifactRef: replayRef,
        context: makeRiskAssessmentEngineContext(),
        audit: C25_FIXTURE_RECORD_AUDIT,
      },
    },
    verifiedEvidenceRefs: [...base.verifiedEvidenceRefs, decisionRef, replayRef],
  };
};

const zetaEnvelopeFor = (sampleId: string): StandardizedRiskRecordEnvelope => {
  const declared = sample(sampleId);
  const riskRecordRef = declared.riskRecordRef!;
  return envelopeFor({
    riskRecordId: riskRecordRef.reference.entityId,
    versionId: riskRecordRef.reference.versionId,
    processNodeId: "process-node-3",
    riskEvent: "risk-event-zeta",
    sourceSegmentId: "segment-zeta-1",
  });
};

const evidence: readonly QualitySampleEvidenceV1[] = [
  assessmentEvidence("sample-alpha-1"),
  assessmentEvidence("sample-alpha-2"),
  // sample-beta 故意不给证据：正式结果缺失仍必须留在分母。
  { sampleId: "sample-gamma", verifiedEvidenceRefs: [] },
  snapshotEvidence("sample-delta", "risk-event-unknown"),
  ...["sample-zeta-1", "sample-zeta-2"].map((sampleId) => {
    const envelope = zetaEnvelopeFor(sampleId);
    return {
      sampleId,
      recordSnapshot: {
        artifactRef: sample(sampleId).standardizedRiskRecordSnapshotArtifactRef!,
        envelope,
      },
      recordIdentity: {
        riskRecordId: envelope.riskRecordId,
        versionId: envelope.version.reference.versionId,
        requestDigest: envelope.version.reference.versionId,
      },
      verifiedEvidenceRefs: [sample(sampleId).standardizedRiskRecordSnapshotArtifactRef!],
    };
  }),
];

const outcome = evaluateQualityDataset({ dataset, evidence });
const metric = (metricCode: string) =>
  outcome.metrics.find((entry) => entry.metricCode === metricCode)!;
const outcomeById = new Map(outcome.samples.map((entry) => [entry.sampleId, entry] as const));

describe("C36 冻结质量数据集", () => {
  it("拒绝缺少标签政策版本或资格说明的合成数据集", () => {
    const missingPolicy = structuredClone(synthetic) as Record<string, unknown>;
    delete missingPolicy["labelPolicyRef"];
    expect(QualityDatasetV1Schema.safeParse(missingPolicy).success).toBe(false);

    const missingReason = structuredClone(synthetic) as Record<string, unknown>;
    delete missingReason["sourceQualificationMissingReasonCode"];
    expect(QualityDatasetV1Schema.safeParse(missingReason).success).toBe(false);

    expect(dataset.sampleKind).toBe("synthetic");
  });

  it("按冻结版本复算同一分母与标签全集", () => {
    const again = evaluateQualityDataset({
      dataset: freezeSyntheticDataset(),
      evidence,
    });
    expect(again.metrics).toEqual(outcome.metrics);
    expect(again.samples.map((entry) => entry.sampleId)).toEqual(
      dataset.samples.map((entry) => entry.sampleId),
    );
    expect(dataset.samples).toHaveLength(7);
  });
});

describe("C36 确定性指标与逐项诊断", () => {
  it("用冻结标签全集计算准确率、精确率与覆盖度，不丢弃失败样例", () => {
    expect(metric("accuracy")).toMatchObject({ numerator: 3, denominator: 7, status: "computed" });
    expect(metric("accuracy").value).toBeCloseTo(3 / 7, 12);
    expect(metric("precision")).toMatchObject({ numerator: 2, denominator: 2, value: 1 });
    expect(metric("coverage")).toMatchObject({ numerator: 3, denominator: 7, status: "computed" });

    expect(outcomeById.get("sample-alpha-1")).toMatchObject({
      classification: "true-positive",
      recordKeyMatched: true,
    });
    expect(outcomeById.get("sample-gamma")).toMatchObject({ classification: "true-negative" });
    expect(outcomeById.get("sample-beta")).toMatchObject({
      classification: "false-negative",
      recordIdentityVerified: false,
    });
    expect(outcomeById.get("sample-beta")?.reasonCodes).toContain(
      "quality-identification-result-missing",
    );
  });

  it("对键错配与多命中记稳定冲突原因，而不是当作命中", () => {
    expect(outcomeById.get("sample-delta")).toMatchObject({
      classification: "false-negative",
      recordKeyMatched: false,
    });
    expect(outcomeById.get("sample-delta")?.reasonCodes).toContain(
      "quality-identification-key-mismatch",
    );
    for (const sampleId of ["sample-zeta-1", "sample-zeta-2"]) {
      expect(outcomeById.get(sampleId)).toMatchObject({
        classification: "false-negative",
        recordKeyMatched: false,
      });
      expect(outcomeById.get(sampleId)?.reasonCodes).toContain(
        "quality-identification-key-conflict",
      );
    }
  });

  it("以明列可比来源对计算跨来源一致性", () => {
    expect(metric("source-consistency")).toMatchObject({
      numerator: 1,
      denominator: 1,
      value: 1,
      status: "computed",
    });
  });

  it("零分母指标返回不可计算原因，不记为零分或满分", () => {
    const single = structuredClone(synthetic) as Record<string, unknown>;
    const samples = single["samples"] as Record<string, unknown>[];
    single["samples"] = samples.filter((entry) => entry["sampleId"] === "sample-gamma");
    const parsed = QualityDatasetV1Schema.parse(single);
    const only = evaluateQualityDataset({
      dataset: parsed,
      evidence: [{ sampleId: "sample-gamma", verifiedEvidenceRefs: [] }],
    });
    expect(only.metrics.find((entry) => entry.metricCode === "precision")).toMatchObject({
      value: null,
      status: "not-computable",
      reasonCode: "quality-metric-denominator-zero",
    });
    expect(only.metrics.find((entry) => entry.metricCode === "source-consistency")).toMatchObject({
      value: null,
      status: "not-computable",
    });
  });

  it("用冻结 C29 上下文重算并比对 P/C、矩阵等级与决策摘要", () => {
    expect(metric("replay-rate")).toMatchObject({ numerator: 2, denominator: 3 });
    expect(metric("grade-match")).toMatchObject({ numerator: 2, denominator: 3 });
    expect(metric("audit-completeness")).toMatchObject({ numerator: 6, denominator: 7 });
    expect(outcome.evidenceChainStatus).toBe("partial");
    expect(outcomeById.get("sample-alpha-1")?.actualRiskLevelId).toBe(
      assessment.decision.matrix.riskLevelId,
    );
  });

  it("重放不一致或证据缺失时记失败而不宣布通过", () => {
    const drifted = evidence.map((entry) =>
      entry.sampleId === "sample-alpha-2" && entry.assessment !== undefined
        ? {
            ...entry,
            assessment: {
              ...entry.assessment,
              decisionDigest: "0".repeat(64),
            },
          }
        : entry,
    );
    const driftedOutcome = evaluateQualityDataset({ dataset, evidence: drifted });
    expect(
      driftedOutcome.samples.find((entry) => entry.sampleId === "sample-alpha-2"),
    ).toMatchObject({ replayConsistent: false, evidenceVerified: false });
    expect(
      driftedOutcome.metrics.find((entry) => entry.metricCode === "replay-rate"),
    ).toMatchObject({ numerator: 1, denominator: 3 });

    const artifactRefs = evidence
      .flatMap((entry) => entry.verifiedEvidenceRefs)
      .map((reference) => reference.reference.entityId);
    expect(artifactRefs).toContain("quality-sample-snapshot-alpha-1");
  });

  it("评估记录缺失时等级匹配计入分母而不是被跳过", () => {
    const withoutAssessment = evidence.map((entry) =>
      entry.sampleId === "sample-alpha-1"
        ? { sampleId: entry.sampleId, verifiedEvidenceRefs: entry.verifiedEvidenceRefs }
        : entry,
    );
    const stripped = evaluateQualityDataset({ dataset, evidence: withoutAssessment });
    expect(stripped.samples.find((entry) => entry.sampleId === "sample-alpha-1")).toMatchObject({
      classification: "false-negative",
      replayConsistent: false,
    });
    expect(stripped.metrics.find((entry) => entry.metricCode === "grade-match")).toMatchObject({
      numerator: 1,
      denominator: 3,
    });
  });
});
