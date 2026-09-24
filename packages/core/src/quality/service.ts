import {
  QualityEvaluationSummaryV1Schema,
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type QualityEvaluationSummaryV1,
  type SourceVersionRefV1,
  type SpatialScopeRefV1,
  type WorkflowRunRefV1,
} from "@riskflow/contracts/ports";
import type { EvidenceReference } from "@riskflow/contracts/common";
import { sha256CanonicalJson } from "../persistence/canonical-json.js";
import {
  RISK_ASSESSMENT_DECISION_ARTIFACT_PURPOSE_CODE_V1,
  RISK_ASSESSMENT_DECISION_MEDIA_TYPE_V1,
} from "../risk-assessment/engine/schema.js";
import { evaluateQualityDataset } from "./evaluate.js";
import {
  AssessmentDecisionArtifactV1Schema,
  QUALITY_EVALUATION_DATASET_MEDIA_TYPE_V1,
  QUALITY_EVALUATION_DATASET_PURPOSE_CODE_V1,
  QualityDatasetV1Schema,
  QualityEvaluationReportV1Schema,
  QualityReplayContextArtifactV1Schema,
  QualityRequiredSegmentReceiptV1Schema,
  StandardizedRiskRecordEnvelopeSchema,
  qualityDatasetArtifactId,
  qualityFailureFrom,
  qualitySyntheticLabelFor,
  type AssessmentEngineContextV1,
  type QualityDatasetV1,
  type QualityEnvironmentV1,
  type QualityEvaluationReportV1,
  type QualityFailureCodeV1,
  type QualityFailureV1,
  type QualityReasonCodeV1,
  type QualityRecordIdentityV1,
  type QualityRequiredSegmentReceiptV1,
  type QualitySampleEvidenceV1,
} from "./schema.js";

/** C36 冻结样例快照与 C29 重放上下文都只以 C04 内容工件保存，读取必须逐字匹配写入用途。 */
export const QUALITY_EVALUATION_SAMPLE_SNAPSHOT_PURPOSE_CODE_V1 =
  "quality-evaluation.sample-snapshot" as const;
export const QUALITY_EVALUATION_REPLAY_CONTEXT_PURPOSE_CODE_V1 =
  "quality-evaluation.replay-context" as const;
export const QUALITY_EVALUATION_ARTIFACT_MEDIA_TYPE_V1 = "application/json" as const;

/** 页面摘要 JSON 上界（D-04）：超界不入索引，不给页面任何越界载荷。 */
export const QUALITY_EVALUATION_SUMMARY_MAX_BYTES_V1 = 64 * 1024;
const QUALITY_SUMMARY_EVIDENCE_LIMIT_V1 = 16;

/** D-10 必审资料段：每批至多 16 项，样例最多 256 项，超界失败闭合。 */
export const QUALITY_REQUIRED_EVIDENCE_BATCH_SIZE_V1 = 16;
export const QUALITY_REQUIRED_EVIDENCE_MAX_REFS_V1 = 256;
export const QUALITY_REQUIRED_EVIDENCE_PURPOSE_CODE_V1 =
  "quality-evaluation.required-evidence" as const;

/** C04 有界读取结果：完整性/授权失败只返回安全原因码，不返回部分载荷。 */
export type QualityArtifactReadOutcomeV1 =
  | Readonly<{ kind: "read"; value: unknown }>
  | Readonly<{
      kind: "failed";
      failureCode: QualityFailureCodeV1;
      reasonCode: QualityReasonCodeV1;
    }>;

/**
 * D-10 必审资料段证明端口：由 C36 adapter 复用 C13 现有 `engineering-data.evidence-access`
 * 授权读实现，对一批明列引用返回同形解析收据；无权、不存在与跨空间一律同形失败。
 */
export type QualityRequiredSegmentProofOutcomeV1 =
  | Readonly<{ kind: "proved"; items: readonly QualityRequiredSegmentReceiptV1[] }>
  | Readonly<{
      kind: "failed";
      failureCode: QualityFailureCodeV1;
      reasonCode: QualityReasonCodeV1;
    }>;

export interface QualityRequiredSegmentProofReaderV1 {
  readExact(input: {
    /** 本批查询 id；必须与 C06 签发该授权时的 invocation 一致（C13 复验绑定）。 */
    readonly queryId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly sampleId: string;
    readonly requiredEvidenceRefs: readonly EvidenceReference[];
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<QualityRequiredSegmentProofOutcomeV1>;
}

/**
 * D-10 请求内签发：为一次 C13 证据读批量取得当前授权上下文；返回上下文的
 * `invocation` 必须等于 `queryId`，否则 C13 复验会拒绝。
 */
export interface QualityEvidenceAccessIssuerV1 {
  issueReadAuthorization(input: {
    readonly queryId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
    readonly sourceVersionRefs: readonly SourceVersionRefV1[];
  }): Promise<AuthorizationContextV1>;
}

/**
 * D-03 公开窄读端口：由 C36 adapter 实现，只按显式引用有界读取并完整消费 C04 `verified`；
 * 不查询私表，也不扩大调用方已复验的工程/空间/资料范围。
 */
export interface QualityEvaluationReadPortV1 extends QualityRequiredSegmentProofReaderV1 {
  readVerifiedJson(input: {
    readonly artifactRef: ContentArtifactRefV1;
    readonly purposeCode: string;
    readonly expectedMediaType: string;
    readonly authorization: AuthorizationContextV1;
    readonly requestId: string;
    readonly requestedAt: string;
  }): Promise<QualityArtifactReadOutcomeV1>;
  /** C22 公开窄读：只返回身份三元组，正文仍由 C22 保存。 */
  readRecordIdentity(input: {
    readonly projectId: string;
    readonly riskRecordId: string;
  }): Promise<QualityRecordIdentityV1 | undefined>;
  /** 同一数据集版本必须只有一个摘要；已存在不同摘要时报错版，不静默覆盖。 */
  assertDatasetVersionAvailable(input: {
    readonly projectId: string;
    readonly datasetArtifactId: string;
    readonly datasetArtifactVersionId: string;
  }): Promise<void>;
}

export type QualityIndexAppendReceiptV1 =
  | Readonly<{ kind: "appended" | "replayed"; auditEntryId: string }>
  | Readonly<{ kind: "conflict" }>;

/** D-03 写入端口：报告先落 C04 不可变工件，再在 C03 单个原子命令中追加索引、回执与审计。 */
export interface QualityEvaluationWritePortV1 {
  putReportArtifact(input: {
    readonly authorization: AuthorizationContextV1;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly issuedAt: string;
    readonly reportArtifactId: string;
    readonly report: QualityEvaluationReportV1;
  }): Promise<ContentArtifactRefV1>;
  appendReportIndex(input: {
    readonly authorization: AuthorizationContextV1;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly issuedAt: string;
    readonly report: QualityEvaluationReportV1;
    readonly reportArtifactRef: ContentArtifactRefV1;
    readonly summary: QualityEvaluationSummaryV1;
    readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
  }): Promise<QualityIndexAppendReceiptV1>;
}

export interface QualityRunEvidenceV1 {
  readonly commands: readonly string[];
  readonly codeHead: string;
  readonly environment: QualityEnvironmentV1;
}

export interface QualityEvaluationCommandV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly datasetArtifactRef: ContentArtifactRefV1;
  readonly runRefs: readonly WorkflowRunRefV1[];
  readonly authorization: AuthorizationContextV1;
  readonly runEvidence: QualityRunEvidenceV1;
  /** D-10：调用方按现有 `engineering-data.evidence-access` 分支签发；缺失时必审资料段失败闭合。 */
  readonly requiredEvidenceAccess?: QualityEvidenceAccessIssuerV1;
}

export type QualityEvaluationResultV1 =
  | Readonly<{
      kind: "succeeded";
      reportArtifactRef: ContentArtifactRefV1;
      datasetArtifactRef: ContentArtifactRefV1;
      report: QualityEvaluationReportV1;
      summary: QualityEvaluationSummaryV1;
    }>
  | Readonly<{ kind: "failed"; failure: QualityFailureV1 }>;

export interface QualityEvaluationServiceOptionsV1 {
  readonly read: QualityEvaluationReadPortV1;
  readonly write: QualityEvaluationWritePortV1;
}

const failed = (
  failureCode: QualityFailureCodeV1,
  reasonCode: QualityReasonCodeV1,
  entityId: string,
): QualityEvaluationResultV1 => ({
  kind: "failed",
  failure: { code: failureCode, reasonCode, targetRef: { entityId, versionId: "1" } },
});

/** 报告正文的稳定身份：同一命令、同一输入与同一冻结数据集得到同一个工件。 */
export const qualityEvaluationReportArtifactId = (input: {
  readonly dataset: QualityDatasetV1;
  readonly commandId: string;
  readonly datasetArtifactRef: ContentArtifactRefV1;
  readonly runRefs: readonly WorkflowRunRefV1[];
}): string =>
  `quality-evaluation-report-${input.dataset.datasetId}@${input.dataset.datasetVersion}-${sha256CanonicalJson(
    {
      commandId: input.commandId,
      datasetArtifactRef: input.datasetArtifactRef,
      runRefs: input.runRefs,
      samples: input.dataset.samples.map((sample) => sample.sampleId),
    },
  )}`;

const summaryEvidenceRefs = (
  dataset: QualityDatasetV1,
  limit: number,
): QualityEvaluationSummaryV1["evidenceRefs"] => {
  const seen = new Set<string>();
  const refs: QualityEvaluationSummaryV1["evidenceRefs"] = [];
  for (const sample of dataset.samples) {
    for (const reference of sample.sourceSegmentRefs) {
      const key = `${reference.locator.sourceSegmentId}\u0000${reference.sourceVersion.entityId}\u0000${reference.sourceVersion.versionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(reference);
      if (refs.length === limit) return refs;
    }
  }
  return refs;
};

/**
 * C36 评估用例（D-03）：授权先行，按显式引用读取冻结数据集与 C22/C29 正式输出证据，
 * 先写 C04 报告工件，再在 C03 单个原子命令中追加索引、回执与事实审计。
 * 事务失败保留未索引孤儿工件供同键重试，不暴露正式成功。
 */
export class QualityEvaluationService {
  readonly #read: QualityEvaluationReadPortV1;
  readonly #write: QualityEvaluationWritePortV1;

  constructor(options: QualityEvaluationServiceOptionsV1) {
    this.#read = options.read;
    this.#write = options.write;
  }

  async evaluateDataset(command: QualityEvaluationCommandV1): Promise<QualityEvaluationResultV1> {
    try {
      return await this.#evaluate(command);
    } catch (error: unknown) {
      const failure = qualityFailureFrom(error);
      if (failure !== undefined) return { kind: "failed", failure };
      return failed("TERMINAL_FAILURE", "quality-dataset-invalid", command.commandId);
    }
  }

  async #evaluate(command: QualityEvaluationCommandV1): Promise<QualityEvaluationResultV1> {
    const authorization = command.authorization;
    if (
      authorization.projectId !== command.projectId ||
      authorization.actorId !== command.actorId ||
      !authorization.grantedCapabilities.includes("projection.export")
    ) {
      return failed("AUTHORIZATION_DENIED", "quality-dataset-invalid", command.commandId);
    }

    const datasetOutcome = await this.#read.readVerifiedJson({
      artifactRef: command.datasetArtifactRef,
      purposeCode: QUALITY_EVALUATION_DATASET_PURPOSE_CODE_V1,
      expectedMediaType: QUALITY_EVALUATION_DATASET_MEDIA_TYPE_V1,
      authorization,
      requestId: `${command.commandId}:dataset`,
      requestedAt: command.requestedAt,
    });
    if (datasetOutcome.kind === "failed") {
      return failed(
        datasetOutcome.failureCode,
        datasetOutcome.reasonCode,
        command.datasetArtifactRef.reference.entityId,
      );
    }
    const dataset = QualityDatasetV1Schema.safeParse(datasetOutcome.value);
    if (!dataset.success || dataset.data.projectId !== command.projectId) {
      return failed(
        "CONTRACT_INVALID",
        "quality-dataset-invalid",
        command.datasetArtifactRef.reference.entityId,
      );
    }
    const frozenDataset = dataset.data;
    const datasetArtifactId = qualityDatasetArtifactId(frozenDataset);
    if (command.datasetArtifactRef.reference.entityId !== datasetArtifactId) {
      return failed("STALE_VERSION", "quality-dataset-invalid", datasetArtifactId);
    }
    const spatialScopeRefs = [
      ...new Map(
        frozenDataset.samples.map((sample) => [
          `${sample.spatialScopeRef.reference.entityId}\u0000${sample.spatialScopeRef.reference.versionId}`,
          sample.spatialScopeRef,
        ]),
      ).values(),
    ];
    if (
      spatialScopeRefs.some(
        (scope) =>
          !authorization.spatialScopeRefs.some(
            (granted) =>
              granted.reference.entityId === scope.reference.entityId &&
              granted.reference.versionId === scope.reference.versionId,
          ),
      )
    ) {
      return failed("AUTHORIZATION_DENIED", "quality-dataset-invalid", command.commandId);
    }
    await this.#read.assertDatasetVersionAvailable({
      projectId: command.projectId,
      datasetArtifactId,
      datasetArtifactVersionId: command.datasetArtifactRef.reference.versionId,
    });

    const evidence = await this.#collectEvidence(command, frozenDataset);
    const outcome = evaluateQualityDataset({ dataset: frozenDataset, evidence });

    const report = QualityEvaluationReportV1Schema.parse({
      schemaVersion: "1",
      projectId: command.projectId,
      projectRevisionRef: frozenDataset.projectRevisionRef,
      datasetArtifactRef: command.datasetArtifactRef,
      datasetId: frozenDataset.datasetId,
      datasetVersion: frozenDataset.datasetVersion,
      labelPolicyRef: frozenDataset.labelPolicyRef,
      sampleKind: frozenDataset.sampleKind,
      label: qualitySyntheticLabelFor(frozenDataset.sampleKind),
      runRefs: [...command.runRefs],
      metrics: [...outcome.metrics],
      samples: [...outcome.samples],
      commands: [...command.runEvidence.commands],
      codeHead: command.runEvidence.codeHead,
      environment: command.runEvidence.environment,
      evidenceChainStatus: outcome.evidenceChainStatus,
      generatedAt: command.requestedAt,
      actorId: command.actorId,
      commandId: command.commandId,
    });

    const summary = QualityEvaluationSummaryV1Schema.parse({
      schemaVersion: "1",
      projectId: command.projectId,
      reportArtifactRef: command.datasetArtifactRef,
      datasetArtifactRef: command.datasetArtifactRef,
      sampleKind: frozenDataset.sampleKind,
      label: report.label,
      metrics: [...outcome.metrics],
      evidenceRefs: summaryEvidenceRefs(frozenDataset, QUALITY_SUMMARY_EVIDENCE_LIMIT_V1),
      createdAt: command.requestedAt,
    });

    const reportArtifactRef = await this.#write.putReportArtifact({
      authorization,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      issuedAt: command.requestedAt,
      reportArtifactId: qualityEvaluationReportArtifactId({
        dataset: frozenDataset,
        commandId: command.commandId,
        datasetArtifactRef: command.datasetArtifactRef,
        runRefs: command.runRefs,
      }),
      report,
    });
    const boundedSummary = QualityEvaluationSummaryV1Schema.parse({
      ...summary,
      reportArtifactRef,
    });
    if (
      Buffer.byteLength(JSON.stringify(boundedSummary), "utf8") >
      QUALITY_EVALUATION_SUMMARY_MAX_BYTES_V1
    ) {
      return failed(
        "CONTRACT_INVALID",
        "quality-summary-exceeds-limit",
        reportArtifactRef.reference.entityId,
      );
    }

    const receipt = await this.#write.appendReportIndex({
      authorization,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      issuedAt: command.requestedAt,
      report,
      reportArtifactRef,
      summary: boundedSummary,
      spatialScopeRefs,
    });
    if (receipt.kind === "conflict") {
      return failed(
        "IDEMPOTENCY_CONFLICT",
        "quality-dataset-invalid",
        reportArtifactRef.reference.entityId,
      );
    }
    return {
      kind: "succeeded",
      reportArtifactRef,
      datasetArtifactRef: command.datasetArtifactRef,
      report,
      summary: boundedSummary,
    };
  }

  async #collectEvidence(
    command: QualityEvaluationCommandV1,
    dataset: QualityDatasetV1,
  ): Promise<readonly QualitySampleEvidenceV1[]> {
    const evidence: QualitySampleEvidenceV1[] = [];
    for (const sample of dataset.samples) {
      const verifiedEvidenceRefs: ContentArtifactRefV1[] = [];
      const readInput = {
        authorization: command.authorization,
        requestedAt: command.requestedAt,
      } as const;
      let recordSnapshot: QualitySampleEvidenceV1["recordSnapshot"];
      let recordIdentity: QualityRecordIdentityV1 | undefined;
      const snapshotRef = sample.standardizedRiskRecordSnapshotArtifactRef;
      if (snapshotRef !== undefined) {
        const read = await this.#read.readVerifiedJson({
          ...readInput,
          artifactRef: snapshotRef,
          purposeCode: QUALITY_EVALUATION_SAMPLE_SNAPSHOT_PURPOSE_CODE_V1,
          expectedMediaType: QUALITY_EVALUATION_ARTIFACT_MEDIA_TYPE_V1,
          requestId: `${command.commandId}:${sample.sampleId}:record-snapshot`,
        });
        if (read.kind === "read") {
          const envelope = StandardizedRiskRecordEnvelopeSchema.safeParse(read.value);
          if (envelope.success) {
            recordSnapshot = { artifactRef: snapshotRef, envelope: envelope.data };
            verifiedEvidenceRefs.push(snapshotRef);
          }
        }
      }
      if (sample.riskRecordRef !== undefined) {
        recordIdentity = await this.#read.readRecordIdentity({
          projectId: command.projectId,
          riskRecordId: sample.riskRecordRef.reference.entityId,
        });
      }

      let assessment: QualitySampleEvidenceV1["assessment"];
      if (sample.assessmentDecisionArtifactRef !== undefined) {
        const read = await this.#read.readVerifiedJson({
          ...readInput,
          artifactRef: sample.assessmentDecisionArtifactRef,
          purposeCode: RISK_ASSESSMENT_DECISION_ARTIFACT_PURPOSE_CODE_V1,
          expectedMediaType: RISK_ASSESSMENT_DECISION_MEDIA_TYPE_V1,
          requestId: `${command.commandId}:${sample.sampleId}:assessment-decision`,
        });
        if (read.kind === "read") {
          const decision = AssessmentDecisionArtifactV1Schema.safeParse(read.value);
          if (decision.success) {
            verifiedEvidenceRefs.push(sample.assessmentDecisionArtifactRef);
            assessment = {
              decisionArtifactRef: sample.assessmentDecisionArtifactRef,
              decision: decision.data,
              decisionDigest: sha256CanonicalJson(decision.data),
            };
          }
        }
      }
      const replayRef = sample.assessmentReplayContextArtifactRef;
      if (replayRef !== undefined && assessment !== undefined) {
        const read = await this.#read.readVerifiedJson({
          ...readInput,
          artifactRef: replayRef,
          purposeCode: QUALITY_EVALUATION_REPLAY_CONTEXT_PURPOSE_CODE_V1,
          expectedMediaType: QUALITY_EVALUATION_ARTIFACT_MEDIA_TYPE_V1,
          requestId: `${command.commandId}:${sample.sampleId}:assessment-replay-context`,
        });
        if (read.kind === "read") {
          const replay = QualityReplayContextArtifactV1Schema.safeParse(read.value);
          if (replay.success) {
            verifiedEvidenceRefs.push(replayRef);
            assessment = {
              ...assessment,
              replay: {
                artifactRef: replayRef,
                context: replay.data.context as AssessmentEngineContextV1,
                audit: replay.data.audit,
              },
            };
          }
        }
      }

      evidence.push({
        sampleId: sample.sampleId,
        ...(recordSnapshot === undefined ? {} : { recordSnapshot }),
        ...(recordIdentity === undefined ? {} : { recordIdentity }),
        ...(assessment === undefined ? {} : { assessment }),
        verifiedEvidenceRefs,
        requiredSegmentReceipts: await this.#collectRequiredSegmentReceipts(command, sample),
      });
    }
    return evidence;
  }

  /**
   * D-10：按样例冻结的 `requiredEvidenceRefs` 分批（每批至多 16 项）取 C13 现有授权读收据。
   * 任何一批无权、不存在、错版、漂移或超界都返回空收据，使该样例审计链失败闭合；
   * 交付给 core 的只有收据，资料正文留在 C13。
   */
  async #collectRequiredSegmentReceipts(
    command: QualityEvaluationCommandV1,
    sample: QualityDatasetV1["samples"][number],
  ): Promise<readonly QualityRequiredSegmentReceiptV1[]> {
    const required = sample.requiredEvidenceRefs;
    const issuer = command.requiredEvidenceAccess;
    if (issuer === undefined || required.length > QUALITY_REQUIRED_EVIDENCE_MAX_REFS_V1) {
      return [];
    }
    const receipts: QualityRequiredSegmentReceiptV1[] = [];
    const batchCount = Math.ceil(required.length / QUALITY_REQUIRED_EVIDENCE_BATCH_SIZE_V1);
    for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
      const batch = required.slice(
        batchIndex * QUALITY_REQUIRED_EVIDENCE_BATCH_SIZE_V1,
        (batchIndex + 1) * QUALITY_REQUIRED_EVIDENCE_BATCH_SIZE_V1,
      );
      const queryId = `${command.commandId}:${sample.sampleId}:required-evidence:${batchIndex}`;
      try {
        const authorization = await issuer.issueReadAuthorization({
          queryId,
          projectId: command.projectId,
          actorId: command.actorId,
          requestedAt: command.requestedAt,
          spatialScopeRefs: [sample.spatialScopeRef],
          sourceVersionRefs: [
            ...new Map(
              batch.map((reference) => [
                `${reference.sourceVersion.entityId}\u0000${reference.sourceVersion.versionId}`,
                {
                  kind: "source-version" as const,
                  reference: {
                    entityId: reference.sourceVersion.entityId,
                    versionId: reference.sourceVersion.versionId,
                  },
                },
              ]),
            ).values(),
          ],
        });
        if (
          authorization.projectId !== command.projectId ||
          authorization.actorId !== command.actorId
        ) {
          return [];
        }
        const outcome = await this.#read.readExact({
          queryId,
          projectId: command.projectId,
          actorId: command.actorId,
          sampleId: sample.sampleId,
          requiredEvidenceRefs: batch,
          requestedAt: command.requestedAt,
          authorization,
        });
        if (outcome.kind !== "proved") return [];
        // 拥有方返回项必须逐项通过 strict Schema，才允许进入本次请求内的收据集合。
        for (const item of outcome.items) {
          const parsed = QualityRequiredSegmentReceiptV1Schema.safeParse(item);
          if (!parsed.success) return [];
          receipts.push(parsed.data);
        }
      } catch {
        return [];
      }
    }
    return receipts;
  }
}

export const createQualityEvaluationService = (
  options: QualityEvaluationServiceOptionsV1,
): QualityEvaluationService => new QualityEvaluationService(options);
