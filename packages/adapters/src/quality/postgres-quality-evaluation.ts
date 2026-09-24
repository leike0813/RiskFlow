import { sql, type ColumnType, type Kysely, type Transaction } from "kysely";

import {
  ArtifactPutCommandV1Schema,
  ArtifactReadRequestV1Schema,
  ArtifactReferenceCheckRequestV1Schema,
  makeArtifactError,
  type ArtifactReferenceGuardV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  AtomicCommandV1Schema,
  sha256CanonicalJson,
  type AtomicCommandV1,
  type AtomicCommitReceiptV1,
  type AtomicCommitV1,
  type JsonValue,
  type TransactionContextV1,
  type TransactionOptionsV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import type {
  IdentificationWorkPlanReaderV1,
  RiskCandidateZeroResultReaderV1,
  StandardizedRiskRecordStoreV1,
} from "@riskflow/core/identification/candidate-finalization";
import type { IdentificationGraphRegistrationStoreV1 } from "@riskflow/core/identification/graph";
import {
  ResolveEngineeringDataReadQueryV1Schema,
  type EngineeringDataReadResolutionResultV1,
  type ResolveEngineeringDataReadQueryV1,
} from "@riskflow/core/engineering-data/context-source";
import {
  QUALITY_EVALUATION_REPORT_MEDIA_TYPE_V1,
  QUALITY_EVALUATION_REPORT_PURPOSE_CODE_V1,
  QUALITY_REQUIRED_EVIDENCE_BATCH_SIZE_V1,
  QUALITY_REQUIRED_EVIDENCE_PURPOSE_CODE_V1,
  QualityError,
  QualityEvaluationReportV1Schema,
  QualityRequiredSegmentReceiptV1Schema,
  qualityEvidenceReferenceKeyV1,
  type QualityEvaluationReadPortV1,
  type QualityEvaluationServiceOptionsV1,
  type QualityEvaluationWritePortV1,
  type QualityFailureCodeV1,
  type QualityFormalRunAccessIssuerV1,
  type QualityFormalZeroResultOutcomeV1,
  type QualityIndexAppendReceiptV1,
  type QualityReasonCodeV1,
  type QualityRecordIdentityV1,
  type QualitySampleV1,
  type QualityRequiredSegmentProofOutcomeV1,
  type QualityRequiredSegmentReceiptV1,
} from "@riskflow/core/quality";
import {
  ContentArtifactRefV1Schema,
  EngineeringDataQueryV1Schema,
  QualityEvaluationSummaryV1Schema,
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type EngineeringDataQueryV1,
  type EngineeringDataReadResultV1,
  type SpatialScopeRefV1,
  type SourceVersionRefV1,
} from "@riskflow/contracts/ports";
import type { EvidenceReference } from "@riskflow/contracts/common";

import { makePersistenceError, mapPostgresError } from "../postgres/pool.js";
import { identificationGraphReadInvocationIdV1 } from "../identification/graph/postgres-identification-graph-adapter.js";
import { getPostgresTransaction } from "../postgres/transaction-unit.js";
import type { PostgresDatabase } from "../postgres/types.js";

type JsonColumn = ColumnType<JsonValue, JsonValue, JsonValue>;

const REPORT_INDEX_TABLE = "business.quality_evaluation_report_index" as const;
const DATASET_FREEZE_TABLE = "business.quality_evaluation_dataset_freeze" as const;
const COMMAND_KIND_V1 = "quality-evaluation.record-report" as const;
const MAX_ARTIFACT_BYTES_V1 = 8 * 1024 * 1024;
const MAX_SERIALIZATION_ATTEMPTS_V1 = 3;

const jsonValue = (value: unknown): JsonValue => value as JsonValue;

interface QualityEvaluationReportIndexRow {
  readonly project_id: string;
  readonly report_artifact_id: string;
  readonly report_artifact_version_id: string;
  readonly project_revision_id: string;
  readonly project_revision_version_id: string;
  readonly dataset_artifact_id: string;
  readonly dataset_artifact_version_id: string;
  readonly sample_kind: string;
  readonly spatial_scope_refs: JsonColumn;
  readonly summary_digest: string;
  readonly report_artifact_ref: JsonColumn;
  readonly dataset_artifact_ref: JsonColumn;
  readonly summary_payload: JsonColumn;
  readonly command_id: string;
  readonly actor_ref: string;
  readonly authorization_context_ref: JsonColumn;
  readonly audit_entry_id: string;
  readonly created_at: ColumnType<Date, Date | string, Date | string>;
}

interface QualityEvaluationDatabase extends PostgresDatabase {
  "business.quality_evaluation_report_index": QualityEvaluationReportIndexRow;
  "business.quality_evaluation_dataset_freeze": {
    readonly project_id: string;
    readonly dataset_id: string;
    readonly dataset_version: string;
    readonly content_digest: string;
  };
}

type QualityEvaluationTransaction = Transaction<QualityEvaluationDatabase>;

export interface PostgresQualityEvaluationAdapterOptionsV1 {
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: TransactionUnitV1;
  readonly artifactStore: ArtifactStoreV1;
  readonly artifactReferenceGuard: ArtifactReferenceGuardV1;
  /** C22 公开窄读：只用于核对正式记录身份，不读 C22 私表。 */
  readonly recordStore: Pick<StandardizedRiskRecordStoreV1, "readRecord">;
  /** D-10：C13 现有公开读接缝（`read` + `resolveReadQuery`），不新增或改写其语义。 */
  readonly evidenceAccess: QualityC13EvidenceReadPortV1;
  readonly formalRunEvidence?: {
    readonly registrationStore: Pick<
      IdentificationGraphRegistrationStoreV1,
      "readCompletedRunResult"
    >;
    readonly workPlanReader: Pick<IdentificationWorkPlanReaderV1, "readExact">;
    readonly zeroResultReader: RiskCandidateZeroResultReaderV1;
  };
  readonly now?: () => Date;
}

/**
 * D-10 C13 公共读接缝：只取既有 `EngineeringDataPortV1.read` 与
 * `PostgresEngineeringContextSourceRegistry.resolveReadQuery` 两个公开方法。
 */
export interface QualityC13EvidenceReadPortV1 {
  read(query: EngineeringDataQueryV1): Promise<EngineeringDataReadResultV1>;
  resolveReadQuery(
    query: ResolveEngineeringDataReadQueryV1,
  ): Promise<EngineeringDataReadResolutionResultV1>;
}

const failure = (
  code: QualityFailureCodeV1,
  reasonCode: QualityReasonCodeV1,
  entityId: string,
): QualityError => new QualityError({ code, reasonCode, targetRef: { entityId, versionId: "1" } });

/**
 * C36 PostgreSQL 适配器（D-03/D-05）：按显式引用有界读取 C04 工件并完整消费 `verified`，
 * 报告先写 C04 不可变工件，再在 C03 单个原子命令中追加索引、命令回执与事实审计。
 * 页面查询走 `postgres-quality-projection.ts`，本文件不提供任何读私表路径。
 */
export class PostgresQualityEvaluationAdapter
  implements QualityEvaluationReadPortV1, QualityEvaluationWritePortV1
{
  readonly #db: Kysely<QualityEvaluationDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #artifactGuard: ArtifactReferenceGuardV1;
  readonly #recordStore: Pick<StandardizedRiskRecordStoreV1, "readRecord">;
  readonly #evidenceAccess: QualityC13EvidenceReadPortV1;
  readonly #formalRunEvidence: PostgresQualityEvaluationAdapterOptionsV1["formalRunEvidence"];
  readonly #now: () => Date;

  constructor(options: PostgresQualityEvaluationAdapterOptionsV1) {
    this.#db = options.db as unknown as Kysely<QualityEvaluationDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#artifactStore = options.artifactStore;
    this.#artifactGuard = options.artifactReferenceGuard;
    this.#recordStore = options.recordStore;
    this.#evidenceAccess = options.evidenceAccess;
    this.#formalRunEvidence = options.formalRunEvidence;
    this.#now = options.now ?? (() => new Date());
  }

  static readPort(options: PostgresQualityEvaluationAdapterOptionsV1): QualityEvaluationReadPortV1 {
    return new PostgresQualityEvaluationAdapter(options);
  }

  serviceOptions(): QualityEvaluationServiceOptionsV1 {
    return { read: this, write: this };
  }

  async readVerifiedJson(input: {
    readonly artifactRef: ContentArtifactRefV1;
    readonly purposeCode: string;
    readonly expectedMediaType: string;
    readonly authorization: AuthorizationContextV1;
    readonly requestId: string;
    readonly requestedAt: string;
  }): Promise<
    | { readonly kind: "read"; readonly value: unknown }
    | {
        readonly kind: "failed";
        readonly failureCode: QualityFailureCodeV1;
        readonly reasonCode: QualityReasonCodeV1;
      }
  > {
    try {
      const handle = await this.#artifactStore.open(
        ArtifactReadRequestV1Schema.parse({
          schemaVersion: "1",
          requestId: input.requestId,
          idempotencyKey: input.requestId,
          artifactRef: input.artifactRef,
          projectId: input.authorization.projectId,
          actorId: input.authorization.actorId,
          requestedAt: input.requestedAt,
          purposeCode: input.purposeCode,
          requiredCapability: "projection.export",
          authorization: input.authorization,
        }),
      );
      const chunks: Uint8Array[] = [];
      let byteLength = 0;
      for await (const chunk of handle.content) {
        byteLength += chunk.byteLength;
        if (byteLength > MAX_ARTIFACT_BYTES_V1) {
          return {
            kind: "failed",
            failureCode: "TERMINAL_FAILURE",
            reasonCode: "quality-evidence-artifact-unverified",
          };
        }
        chunks.push(chunk);
      }
      await handle.verified;
      if (handle.manifest.mediaType !== input.expectedMediaType) {
        return {
          kind: "failed",
          failureCode: "UNSUPPORTED_CONTRACT",
          reasonCode: "quality-evidence-artifact-unverified",
        };
      }
      const buffer = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return {
        kind: "read",
        value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)) as unknown,
      };
    } catch (error: unknown) {
      const mapped = mapPostgresError(error, "quality-evaluation.read-artifact");
      if (mapped.code === "TRANSACTION_FAILED" && mapped.retryable) {
        return {
          kind: "failed",
          failureCode: "TRANSIENT_FAILURE",
          reasonCode: "quality-evidence-artifact-unverified",
        };
      }
      const code = artifactFailureCode(error);
      return {
        kind: "failed",
        failureCode: code,
        reasonCode: "quality-evidence-artifact-unverified",
      };
    }
  }

  async readRecordIdentity(input: {
    readonly projectId: string;
    readonly riskRecordId: string;
  }): Promise<QualityRecordIdentityV1 | undefined> {
    try {
      const record = await this.#recordStore.readRecord(input);
      return record === undefined
        ? undefined
        : {
            riskRecordId: record.riskRecordId,
            versionId: record.versionId,
            requestDigest: record.requestDigest,
          };
    } catch {
      return undefined;
    }
  }

  /** D-09：只组合 C39/C22 已公开的精确只读事实；任何缺口保持未判定。 */
  async readFormalZeroResult(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly sample: QualitySampleV1;
    readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
    readonly sourceVersionRefs: readonly SourceVersionRefV1[];
    readonly issuer: QualityFormalRunAccessIssuerV1;
  }): Promise<QualityFormalZeroResultOutcomeV1> {
    const ports = this.#formalRunEvidence;
    const refs = input.sample.formalRunProofRefs;
    const failed = { kind: "failed" } as const;
    if (
      ports === undefined ||
      refs === undefined ||
      input.sample.expectedPositive ||
      input.sample.riskRecordRef !== undefined
    )
      return failed;
    const same = (
      left: { reference: { entityId: string; versionId: string } },
      right: { reference: { entityId: string; versionId: string } },
    ) =>
      left.reference.entityId === right.reference.entityId &&
      left.reference.versionId === right.reference.versionId;
    const issue = async (
      branch: "risk-identification.plan" | "risk-identification.assemble-and-infer",
      invocationId: string,
    ) => {
      const context = await input.issuer.issueReadAuthorization({
        invocationId,
        branch,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        spatialScopeRefs: input.spatialScopeRefs,
        sourceVersionRefs: input.sourceVersionRefs,
      });
      return context.projectId === input.projectId &&
        context.actorId === input.actorId &&
        context.grantedCapabilities.length === 1 &&
        context.grantedCapabilities[0] === "risk-identification.run"
        ? context
        : undefined;
    };
    try {
      const runAuthorization = await issue(
        "risk-identification.plan",
        identificationGraphReadInvocationIdV1({
          operation: "run-result",
          projectId: input.projectId,
          targetId: `${refs.terminalResultRef.reference.entityId}:${refs.terminalResultRef.reference.versionId}`,
        }),
      );
      if (runAuthorization === undefined) return failed;
      const terminal = await ports.registrationStore.readCompletedRunResult({
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        runResultRef: refs.terminalResultRef,
        authorization: runAuthorization,
      });
      if (terminal.kind !== "read") return failed;
      const result = terminal.runResult;
      if (
        result.projectId !== input.projectId ||
        !same(result.runRef, refs.runRef) ||
        !same(result.workPlanRef, refs.workPlanRef) ||
        !same(result.inputSnapshotRef, input.sample.identificationInputSnapshotRef) ||
        result.acceptedRiskRecordRefs.length !== 0 ||
        result.acceptedEventRefs.length !== 0 ||
        result.failedWorkItemRefs.length !== 0 ||
        result.skippedWorkItemRefs.length !== 0 ||
        result.rejectedGroupRefs.length !== 0 ||
        result.pendingReviewTaskRefs.length !== 0 ||
        result.cancelledReasonCode !== undefined
      )
        return failed;

      const planAuthorization = await issue(
        "risk-identification.plan",
        identificationGraphReadInvocationIdV1({
          operation: "work-plan",
          projectId: input.projectId,
          targetId: `${refs.workPlanRef.reference.entityId}@${refs.workPlanRef.reference.versionId}`,
        }),
      );
      if (planAuthorization === undefined) return failed;
      const plan = await ports.workPlanReader.readExact({
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        workPlanRef: refs.workPlanRef,
        authorization: planAuthorization,
      });
      if (
        plan.kind !== "succeeded" ||
        !same(plan.read.inputSnapshotRef, result.inputSnapshotRef) ||
        plan.read.workItems.length === 0 ||
        plan.read.workItems.length !== result.zeroResults.length
      )
        return failed;
      const zeroByWorkItem = new Map(
        result.zeroResults.map(
          (item) =>
            [
              `${item.workItemRef.reference.entityId}\u0000${item.workItemRef.reference.versionId}`,
              item,
            ] as const,
        ),
      );
      if (zeroByWorkItem.size !== plan.read.workItems.length) return failed;
      const sampleSources = new Set(
        input.sample.sourceSegmentRefs.map(
          (segment) => `${segment.sourceVersion.entityId}\u0000${segment.sourceVersion.versionId}`,
        ),
      );
      const matchingItems = plan.read.workItems.filter(
        (item) =>
          item.nodeId === input.sample.processNodeId &&
          item.spatialScopeRefs.length === 1 &&
          same(item.spatialScopeRefs[0]!, input.sample.spatialScopeRef) &&
          item.sourceVersionRefs.length === sampleSources.size &&
          item.sourceVersionRefs.every((ref) =>
            sampleSources.has(`${ref.reference.entityId}\u0000${ref.reference.versionId}`),
          ),
      );
      if (matchingItems.length !== 1) return failed;
      for (const item of plan.read.workItems) {
        const zero = zeroByWorkItem.get(
          `${item.workItemRef.reference.entityId}\u0000${item.workItemRef.reference.versionId}`,
        );
        if (zero === undefined) return failed;
        const invocationId = `quality-zero-${sha256CanonicalJson({
          terminalResultRef: refs.terminalResultRef,
          workItemRef: item.workItemRef,
        })}`;
        const authorization = await issue("risk-identification.assemble-and-infer", invocationId);
        if (authorization === undefined) return failed;
        const read = await ports.zeroResultReader.readZeroResult({
          projectId: input.projectId,
          actorId: input.actorId,
          invocationId,
          requestedAt: input.requestedAt,
          inputSnapshotRef: result.inputSnapshotRef,
          workItemRef: item.workItemRef,
          zeroResultRef: zero.zeroResultRef,
          authorization,
        });
        if (
          read.kind !== "read" ||
          read.zeroResult.nodeId !== item.nodeId ||
          !same(read.zeroResult.workItemRef, item.workItemRef) ||
          !same(read.zeroResult.inputSnapshotRef, result.inputSnapshotRef)
        )
          return failed;
      }
      return {
        kind: "proved",
        terminalResultRef: refs.terminalResultRef,
        frozenScopeDigest: sha256CanonicalJson({
          runRef: refs.runRef,
          inputSnapshotRef: result.inputSnapshotRef,
          workPlanRef: refs.workPlanRef,
          workItems: plan.read.workItems,
          zeroResults: result.zeroResults,
        }),
      };
    } catch {
      return failed;
    }
  }

  /**
   * D-10 必审资料段证明：只经 C13 现有 `read`/`resolveReadQuery` 两阶段公开读，
   * 逐项核对资料段 ID、精确来源版本、工程/空间与集合/grant 引用，丢弃资料正文。
   * 无权与不存在同形失败；任何失配都不产出部分收据。
   */
  async readExact(input: {
    readonly queryId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly sampleId: string;
    readonly requiredEvidenceRefs: readonly EvidenceReference[];
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<QualityRequiredSegmentProofOutcomeV1> {
    const refs = input.requiredEvidenceRefs;
    if (refs.length === 0 || refs.length > QUALITY_REQUIRED_EVIDENCE_BATCH_SIZE_V1) {
      return requiredSegmentFailure("UNSUPPORTED_CONTRACT");
    }
    if (
      input.projectId !== input.authorization.projectId ||
      input.actorId !== input.authorization.actorId ||
      !input.authorization.grantedCapabilities.includes("engineering-data.read")
    ) {
      return requiredSegmentFailure("AUTHORIZATION_DENIED");
    }
    try {
      const read = await this.#evidenceAccess.read(
        EngineeringDataQueryV1Schema.parse({
          queryId: input.queryId,
          projectId: input.projectId,
          actorId: input.actorId,
          requestedAt: input.requestedAt,
          authorization: input.authorization,
          kind: "evidence-access",
          payload: {
            evidenceReferences: [...refs],
            purposeCode: QUALITY_REQUIRED_EVIDENCE_PURPOSE_CODE_V1,
          },
        }),
      );
      if (read.kind !== "succeeded") {
        return requiredSegmentFailure(read.kind === "failed" ? read.error.code : undefined);
      }
      const resolved = await this.#evidenceAccess.resolveReadQuery(
        ResolveEngineeringDataReadQueryV1Schema.parse({
          queryResultRef: read.result.queryResultRef,
          invocationId: input.queryId,
          projectId: input.projectId,
          actorId: input.actorId,
          requestedAt: input.requestedAt,
          authorization: input.authorization,
        }),
      );
      if (resolved.kind !== "succeeded" || resolved.result.kind !== "evidence-access") {
        return requiredSegmentFailure(resolved.kind === "failed" ? resolved.error.code : undefined);
      }
      const result = resolved.result;
      if (
        result.purposeCode !== QUALITY_REQUIRED_EVIDENCE_PURPOSE_CODE_V1 ||
        result.items.length !== refs.length
      ) {
        return requiredSegmentFailure("ENTITY_NOT_FOUND");
      }
      const itemsByKey = new Map(
        result.items.map(
          (item) => [qualityEvidenceReferenceKeyV1(item.evidenceReference), item] as const,
        ),
      );
      const authorizedScopeIds = new Set(
        input.authorization.spatialScopeRefs.map((scope) => scope.reference.entityId),
      );
      const receipts: QualityRequiredSegmentReceiptV1[] = [];
      for (const required of refs) {
        const item = itemsByKey.get(qualityEvidenceReferenceKeyV1(required));
        if (
          item === undefined ||
          item.segment.sourceSegmentId !== required.locator.sourceSegmentId ||
          item.sourceVersionRef.reference.entityId !== required.sourceVersion.entityId ||
          item.sourceVersionRef.reference.versionId !== required.sourceVersion.versionId ||
          item.segment.spatialScopeRefs.some(
            (scope) => !authorizedScopeIds.has(scope.reference.entityId),
          )
        ) {
          return requiredSegmentFailure("ENTITY_NOT_FOUND");
        }
        receipts.push(
          QualityRequiredSegmentReceiptV1Schema.parse({
            evidenceReference: required,
            sourceVersionRef: item.sourceVersionRef,
            sourceSegmentSetRef: item.sourceSegmentSetRef,
            sourceAccessGrantRef: item.sourceAccessGrantRef,
            queryResultRef: result.queryResultRef,
          }),
        );
      }
      return { kind: "proved", items: receipts };
    } catch (error: unknown) {
      return requiredSegmentFailure(moduleErrorCodeOf(error));
    }
  }

  async assertDatasetVersionAvailable(input: {
    readonly projectId: string;
    readonly datasetArtifactId: string;
    readonly datasetArtifactVersionId: string;
  }): Promise<void> {
    const row = await this.#db
      .selectFrom(REPORT_INDEX_TABLE)
      .select("dataset_artifact_version_id")
      .where("project_id", "=", input.projectId)
      .where("dataset_artifact_id", "=", input.datasetArtifactId)
      .where("dataset_artifact_version_id", "<>", input.datasetArtifactVersionId)
      .executeTakeFirst();
    if (row !== undefined) {
      throw failure("STALE_VERSION", "quality-dataset-invalid", input.datasetArtifactId);
    }
  }

  async putReportArtifact(input: {
    readonly authorization: AuthorizationContextV1;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly issuedAt: string;
    readonly reportArtifactId: string;
    readonly report: unknown;
  }): Promise<ContentArtifactRefV1> {
    const report = QualityEvaluationReportV1Schema.parse(input.report);
    const payload = new TextEncoder().encode(JSON.stringify(report, null, 2));
    try {
      const result = await this.#artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          // C03 回执 command_id 全局唯一：工件写入必须拥有独立身份，不能复用命令 id。
          commandId: `${input.commandId}:artifact-put:${QUALITY_EVALUATION_REPORT_PURPOSE_CODE_V1}`,
          idempotencyKey: `${input.commandId}:artifact-put:${QUALITY_EVALUATION_REPORT_PURPOSE_CODE_V1}`,
          projectId: input.authorization.projectId,
          actorId: input.authorization.actorId,
          issuedAt: input.issuedAt,
          authorization: input.authorization,
          requiredCapability: "projection.export",
          artifactId: input.reportArtifactId,
          artifactKind: "content",
          purposeCode: QUALITY_EVALUATION_REPORT_PURPOSE_CODE_V1,
          mediaType: QUALITY_EVALUATION_REPORT_MEDIA_TYPE_V1,
          parentArtifactRefs: [],
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        (async function* () {
          yield payload;
        })(),
      );
      return ContentArtifactRefV1Schema.parse(result.artifactRef);
    } catch (error: unknown) {
      if (isArtifactCode(error, "ARTIFACT_ACCESS_DENIED")) {
        throw failure("AUTHORIZATION_DENIED", "quality-dataset-invalid", input.reportArtifactId);
      }
      if (isArtifactCode(error, "ARTIFACT_IDEMPOTENCY_CONFLICT")) {
        throw failure("IDEMPOTENCY_CONFLICT", "quality-dataset-invalid", input.reportArtifactId);
      }
      throw failure("TERMINAL_FAILURE", "quality-dataset-invalid", input.reportArtifactId);
    }
  }

  async appendReportIndex(input: {
    readonly authorization: AuthorizationContextV1;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly issuedAt: string;
    readonly report: unknown;
    readonly reportArtifactRef: ContentArtifactRefV1;
    readonly summary: unknown;
    readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
  }): Promise<QualityIndexAppendReceiptV1> {
    const report = QualityEvaluationReportV1Schema.parse(input.report);
    const summary = QualityEvaluationSummaryV1Schema.parse(input.summary);
    if (
      input.spatialScopeRefs.length === 0 ||
      input.spatialScopeRefs.some(
        (scope) =>
          !input.authorization.spatialScopeRefs.some(
            (granted) =>
              granted.reference.entityId === scope.reference.entityId &&
              granted.reference.versionId === scope.reference.versionId,
          ),
      )
    ) {
      throw failure("AUTHORIZATION_DENIED", "quality-dataset-invalid", input.commandId);
    }
    const summaryDigest = sha256CanonicalJson(summary);
    const auditEntryId = `audit-${input.commandId}:quality-evaluation-report-index`;
    const command = AtomicCommandV1Schema.parse({
      projectId: input.authorization.projectId,
      commandKind: COMMAND_KIND_V1,
      commandId: input.commandId,
      idempotencyKey: input.idempotencyKey,
      payload: jsonValue({
        datasetArtifactRef: report.datasetArtifactRef,
        reportArtifactRef: input.reportArtifactRef,
        summaryDigest,
      }),
      actorRef: input.authorization.actorId,
      authorizationContextRef: input.authorization.authorizationContextRef,
      issuedAt: input.issuedAt,
    });
    try {
      const receipt = await this.#executeWithRetry(command, async (context) => {
        const transaction = getPostgresTransaction(
          context,
        ) as unknown as QualityEvaluationTransaction;
        await this.#artifactGuard.assertUsable(
          context,
          ArtifactReferenceCheckRequestV1Schema.parse({
            schemaVersion: "1",
            artifactRef: input.reportArtifactRef,
            projectId: input.authorization.projectId,
            purposeCode: QUALITY_EVALUATION_REPORT_PURPOSE_CODE_V1,
            requiredCapability: "projection.export",
            authorization: input.authorization,
          }),
        );
        await transaction
          .insertInto(DATASET_FREEZE_TABLE)
          .values({
            project_id: input.authorization.projectId,
            dataset_id: report.datasetId,
            dataset_version: report.datasetVersion,
            content_digest: report.datasetArtifactRef.reference.versionId,
          })
          .onConflict((conflict) =>
            conflict.columns(["project_id", "dataset_id", "dataset_version"]).doNothing(),
          )
          .execute();
        const frozen = await transaction
          .selectFrom(DATASET_FREEZE_TABLE)
          .select("content_digest")
          .where("project_id", "=", input.authorization.projectId)
          .where("dataset_id", "=", report.datasetId)
          .where("dataset_version", "=", report.datasetVersion)
          .executeTakeFirst();
        if (frozen?.content_digest !== report.datasetArtifactRef.reference.versionId) {
          throw makePersistenceError("IDEMPOTENCY_CONFLICT", "quality-evaluation.dataset-freeze");
        }
        await transaction
          .insertInto(REPORT_INDEX_TABLE)
          .values({
            project_id: input.authorization.projectId,
            report_artifact_id: input.reportArtifactRef.reference.entityId,
            report_artifact_version_id: input.reportArtifactRef.reference.versionId,
            project_revision_id: report.projectRevisionRef.reference.entityId,
            project_revision_version_id: report.projectRevisionRef.reference.versionId,
            dataset_artifact_id: report.datasetArtifactRef.reference.entityId,
            dataset_artifact_version_id: report.datasetArtifactRef.reference.versionId,
            sample_kind: report.sampleKind,
            spatial_scope_refs: sql`${JSON.stringify(input.spatialScopeRefs)}::jsonb`,
            summary_digest: summaryDigest,
            report_artifact_ref: jsonValue(input.reportArtifactRef),
            dataset_artifact_ref: jsonValue(report.datasetArtifactRef),
            summary_payload: jsonValue(summary),
            command_id: input.commandId,
            actor_ref: input.authorization.actorId,
            authorization_context_ref: jsonValue(input.authorization.authorizationContextRef),
            audit_entry_id: auditEntryId,
            created_at: input.issuedAt,
          })
          .onConflict((conflict) => conflict.doNothing())
          .execute();
        const stored = await transaction
          .selectFrom(REPORT_INDEX_TABLE)
          .selectAll()
          .where("project_id", "=", input.authorization.projectId)
          .where("report_artifact_id", "=", input.reportArtifactRef.reference.entityId)
          .where("report_artifact_version_id", "=", input.reportArtifactRef.reference.versionId)
          .executeTakeFirst();
        if (
          stored === undefined ||
          stored.summary_digest !== summaryDigest ||
          stored.command_id !== input.commandId
        ) {
          throw makeArtifactError("ARTIFACT_IDEMPOTENCY_CONFLICT", "registry.put-replay");
        }
        return {
          resultRef: input.reportArtifactRef,
          audit: {
            auditEntryId,
            projectId: input.authorization.projectId,
            action: COMMAND_KIND_V1,
            targetRef: input.reportArtifactRef,
            actorRef: input.authorization.actorId,
            authorizationContextRef: input.authorization.authorizationContextRef,
            occurredAt: input.issuedAt,
            recordedAt: this.#now().toISOString(),
            version: { entityId: auditEntryId, versionId: "1" },
            commandId: input.commandId,
            idempotencyKey: input.idempotencyKey,
          },
          events: [] as AtomicCommitV1["events"],
        };
      });
      return {
        kind: receipt.replayed ? "replayed" : "appended",
        auditEntryId: receipt.auditEntryId,
      };
    } catch (error: unknown) {
      const mapped = mapPostgresError(error, "quality-evaluation.report-index");
      if (
        mapped.code === "IDEMPOTENCY_CONFLICT" &&
        mapped.stage === "quality-evaluation.dataset-freeze"
      ) {
        throw failure("STALE_VERSION", "quality-dataset-invalid", report.datasetId);
      }
      if (
        mapped.code === "IDEMPOTENCY_CONFLICT" ||
        isArtifactCode(error, "ARTIFACT_IDEMPOTENCY_CONFLICT")
      ) {
        return { kind: "conflict" };
      }
      throw mapped;
    }
  }

  async #executeWithRetry(
    command: AtomicCommandV1,
    handler: (context: TransactionContextV1) => Promise<AtomicCommitV1>,
  ): Promise<AtomicCommitReceiptV1> {
    const options: TransactionOptionsV1 = { isolationLevel: "serializable" };
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.#transactionUnit.execute(command, handler, options);
      } catch (error: unknown) {
        if (
          attempt < MAX_SERIALIZATION_ATTEMPTS_V1 &&
          mapPostgresError(error, "quality-evaluation.report-index").retryable
        ) {
          continue;
        }
        throw error;
      }
    }
  }
}

const isArtifactCode = (error: unknown, code: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { readonly code?: unknown }).code === code;

const moduleErrorCodeOf = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
};

/** D-10：拒权与不存在同形收口，错版保持可辨识；任何失败都不产出部分收据。 */
const requiredSegmentFailure = (
  code: string | undefined,
): QualityRequiredSegmentProofOutcomeV1 => ({
  kind: "failed",
  failureCode:
    code === "AUTHORIZATION_DENIED" || code === "ENTITY_NOT_FOUND"
      ? "AUTHORIZATION_DENIED"
      : code === "STALE_VERSION"
        ? "STALE_VERSION"
        : code === "UNSUPPORTED_CONTRACT"
          ? "UNSUPPORTED_CONTRACT"
          : "TERMINAL_FAILURE",
  reasonCode: "quality-evidence-artifact-unverified",
});

const artifactFailureCode = (error: unknown): QualityFailureCodeV1 => {
  if (isArtifactCode(error, "ARTIFACT_ACCESS_DENIED")) return "AUTHORIZATION_DENIED";
  if (isArtifactCode(error, "ARTIFACT_REFERENCE_NOT_FOUND")) return "ENTITY_NOT_FOUND";
  if (isArtifactCode(error, "ARTIFACT_UNSUPPORTED_VERSION")) return "UNSUPPORTED_CONTRACT";
  if (isArtifactCode(error, "ARTIFACT_IDEMPOTENCY_CONFLICT")) return "IDEMPOTENCY_CONFLICT";
  return "TERMINAL_FAILURE";
};

export const createPostgresQualityEvaluationAdapter = (
  options: PostgresQualityEvaluationAdapterOptionsV1,
): PostgresQualityEvaluationAdapter => new PostgresQualityEvaluationAdapter(options);
