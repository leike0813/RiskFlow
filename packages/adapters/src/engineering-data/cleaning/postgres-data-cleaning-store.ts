import { sql, type Kysely, type Transaction } from "kysely";

import type {
  AgentTaskRefV1,
  AgentTaskResultRefV1,
  ContentArtifactRefV1,
  EngineeringFreezeCommandV1,
  EngineeringFreezeResultV1,
  MonitoringSeriesRefV1,
  MonitoringSnapshotRefV1,
  SourceVersionRefV1,
  StartAgentTaskResultV1,
} from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";
import {
  AgentTaskRefV1Schema,
  ContentArtifactRefV1Schema,
  EngineeringFreezeResultV1Schema,
  MonitoringSeriesRefV1Schema,
  SourceSegmentSetRefV1Schema,
  SourceVersionRefV1Schema,
  StartAgentTaskResultV1Schema,
  StructuredDocumentConversionRefV1Schema,
} from "@riskflow/contracts/ports";
import { canonicalJson, sha256CanonicalJson } from "@riskflow/core/persistence";
import type {
  AtomicCommitV1,
  TransactionContextV1,
  TransactionUnitV1,
} from "@riskflow/core/persistence";
import type {
  AgentDomainToolExecutionContextV1,
  AgentDomainToolResultV1,
  AgentTaskDefinitionV1,
  AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import { emptyAgentBudgetUsage } from "@riskflow/core/agent-runtime";
import {
  ACCESS_POLICY_REF_V1,
  AccessServiceError,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import type {
  ArtifactReadHandleV1,
  ArtifactReferenceGuardV1,
  ArtifactRefV1,
  ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  ArtifactReadRequestV1Schema,
  ArtifactPutCommandV1Schema,
  ArtifactRefV1Schema,
} from "@riskflow/core/artifacts";
import {
  CleaningPreparationManifestV1Schema,
  DataCleaningAvailabilityV1Schema,
  DataCleaningCandidateV1Schema,
  DataCleaningFrozenInputV1Schema,
  DataCleaningPolicyV1Schema,
  DataCleaningResultV1Schema,
  createDataCleaningTaskDefinition,
  type CleaningPreparationManifestV1,
  type DataCleaningCandidateV1,
  type DataCleaningDocumentSliceRequestV1,
  type DataCleaningFrozenDocumentV1,
  type DataCleaningFrozenInputV1,
  type DataCleaningFrozenMonitoringV1,
  type DataCleaningFrozenSegmentV1,
  type DataCleaningMonitoringSliceRequestV1,
  type DataCleaningPolicyV1,
  type DataCleaningResultV1,
  type DataCleaningSettlementV1,
  type DataCleaningTaskPortV1,
  type DataCleaningValidationViewV1,
} from "@riskflow/core/engineering-data/cleaning";
import { MonitoringSampleVersionRefV1Schema } from "@riskflow/core/engineering-data/monitoring";
import {
  SourceSegmentIdV1Schema,
  SourceSegmentKindV1Schema,
  SourceSegmentLocatorV1Schema,
} from "@riskflow/core/engineering-data/context-source";
import { StructuredDocumentJsonLdV1Schema } from "@riskflow/core/engineering-data/document-conversion";
import { getPostgresTransaction } from "../../postgres/transaction-unit.js";
import type { PostgresDatabase } from "../../postgres/types.js";
import type { PostgresMonitoringStoreV1 } from "../monitoring/postgres-monitoring-store.js";

const SCHEMA_VERSION = "1" as const;
const RESULT_COMMAND_KIND = "engineering-data.data-cleaning-result.v1";
const PREPARATION_COMMAND_KIND = "engineering-data.identification-preparation.v1";
const MANIFEST_PURPOSE = "engineering-data.data-cleaning-preparation-manifest";
/** C04 读取按工件自身的 purposeCode 授权，C12 的 JSON-LD 必须用其写入时的用途码读取。 */
const CONVERSION_PURPOSE = "engineering-data.structured-document-conversion";
const DECISION_PURPOSE = "engineering-data.data-cleaning-decision";
const OBSERVATION_PURPOSE = "engineering-data.data-cleaning-observation";
/** C08 `recordCandidate` 以该用途码复验校验工件，必须与运行时一致。 */
const VALIDATION_PURPOSE = "agent-validation";
const RESULT_PURPOSE = "engineering-data.data-cleaning-result";
const PREPARATION_BRANCH = "engineering-data.identification-preparation" as const;
const MONITORING_BRANCH = "engineering-data.monitoring-snapshot" as const;
const FREEZE_CAPABILITY = "engineering-data.freeze" as const;
const MAX_MANIFEST_BYTES = 1_048_576;
const MAX_JSON_LD_BYTES = 16_777_216;
const MAX_OBSERVATION_BYTES = 4_194_304;

/** 冻结准备命令的稳定身份，读写事实与授权都从它派生。 */
interface CleaningCommandContext {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly issuedAt: string;
  readonly authorization: EngineeringFreezeCommandV1["authorization"];
}

interface ConversionRow {
  conversion_id: string;
  version_id: string;
  project_id: string;
  status: string;
  input_kind: string;
  source_version_ref: unknown;
  conversion_policy_ref: unknown;
  quality_policy_ref: unknown;
  converter_deployment_ref: unknown;
  jsonld_artifact_ref: unknown;
  source_segment_set_ref: unknown;
}

interface SegmentRow {
  source_segment_id: string;
  project_id: string;
  source_version_id: string;
  source_segment_set_id: string;
  kind: string;
  locator: unknown;
}

interface SnapshotRow {
  snapshot_id: string;
  version_id: string;
  project_id: string;
  monitoring_series_ref: unknown;
  sample_version_refs: unknown;
  availability: string;
  coverage_ratio: number;
  availability_reasons: unknown;
}

interface SnapshotMemberRow {
  project_id: string;
  snapshot_id: string;
  member_index: number;
  sample_version_id: string;
  selection_reason: string;
}

interface SnapshotPointRow {
  project_id: string;
  snapshot_id: string;
  point_index: number;
  sampled_at: Date | string;
  status: string;
  source_sample_refs: unknown;
}

interface SampleVersionRow {
  project_id: string;
  sample_version_id: string;
  version_id: string;
  source_sample_key: string;
  sampled_at: Date | string;
  value: number;
  unit: string;
  canonical_value: number;
  canonical_unit: string;
  relation_kind: string;
  evidence_references: unknown;
  source_version_ref: unknown;
  source_segment_set_ref: unknown;
}

interface AgentTaskRow {
  agent_task_id: string;
  status: string;
}

interface DataCleaningResultRow {
  result_id: string;
  version_id: string;
  project_id: string;
  agent_task_ref: unknown;
  result_artifact_ref: unknown;
}

interface PreparationSnapshotRow {
  snapshot_id: string;
  version_id: string;
  project_id: string;
  snapshot_ref: unknown;
}

type CleaningDatabase = PostgresDatabase & {
  "business.structured_document_conversions": ConversionRow;
  "business.source_segments": SegmentRow;
  "business.monitoring_snapshots": SnapshotRow;
  "business.monitoring_snapshot_members": SnapshotMemberRow;
  "business.monitoring_snapshot_points": SnapshotPointRow;
  "business.monitoring_sample_versions": SampleVersionRow;
  "business.agent_tasks": AgentTaskRow;
  "business.data_cleaning_results": DataCleaningResultRow;
  "business.identification_preparation_snapshots": PreparationSnapshotRow;
};

type CleaningTransaction = Transaction<CleaningDatabase>;

export interface PostgresDataCleaningStoreOptions {
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: TransactionUnitV1;
  readonly access: LocalIdentityAccessV1;
  readonly artifactStore: ArtifactStoreV1;
  readonly artifactReferenceGuard: ArtifactReferenceGuardV1;
  readonly monitoringStore: PostgresMonitoringStoreV1;
  readonly startAgentTask: (command: unknown) => Promise<StartAgentTaskResultV1>;
  readonly policy: DataCleaningPolicyV1;
  readonly now?: () => Date;
}

const asTransaction = (context: TransactionContextV1): CleaningTransaction =>
  getPostgresTransaction(context) as unknown as CleaningTransaction;

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const referenceKey = (value: { reference: { entityId: string; versionId: string } }): string =>
  `${value.reference.entityId}@${value.reference.versionId}`;

const sameVersion = (left: VersionReference, right: VersionReference): boolean =>
  left.entityId === right.entityId && left.versionId === right.versionId;

const artifactSortKey = (value: {
  kind: string;
  reference: { entityId: string; versionId: string };
}) => `${value.kind}/${value.reference.entityId}/${value.reference.versionId}`;

const one = (bytes: Uint8Array): AsyncIterable<Uint8Array> =>
  (async function* () {
    yield bytes;
  })();

const diagnosticRef = (causalRunId: string) => ({
  kind: "diagnostic-artifact" as const,
  reference: {
    entityId: `data-cleaning-failure-${causalRunId}`,
    versionId: `sha256:${sha256CanonicalJson({ causalRunId })}`,
  },
});

const moduleError = (
  code:
    | "AUTHORIZATION_DENIED"
    | "IDEMPOTENCY_CONFLICT"
    | "BUSINESS_BLOCKED"
    | "UNSUPPORTED_CONTRACT"
    | "TRANSIENT_FAILURE"
    | "TERMINAL_FAILURE",
  causalRunId: string,
  extras: Record<string, unknown> = {},
): Record<string, unknown> => {
  const common = {
    stageCode: "engineering-data.data-cleaning",
    occurredAt: new Date().toISOString(),
    causalRunId,
  };
  if (code === "AUTHORIZATION_DENIED") {
    return {
      ...common,
      code,
      category: "authorization",
      retryable: false,
      requiredCapability: FREEZE_CAPABILITY,
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
      ...extras,
    };
  }
  if (code === "IDEMPOTENCY_CONFLICT") {
    return {
      ...common,
      code,
      category: "idempotency",
      retryable: false,
      idempotencyKey: causalRunId,
      priorCommandId: causalRunId,
      ...extras,
    };
  }
  if (code === "BUSINESS_BLOCKED") {
    return {
      ...common,
      code,
      category: "business-blocked",
      retryable: false,
      blockerKind: "data-cleaning-preparation",
      blockerRef: { kind: "project-revision", reference: { entityId: "unknown", versionId: "1" } },
      ...extras,
    };
  }
  if (code === "UNSUPPORTED_CONTRACT") {
    return {
      ...common,
      code,
      category: "technical",
      retryable: false,
      schemaVersion: SCHEMA_VERSION,
      ...extras,
    };
  }
  if (code === "TRANSIENT_FAILURE") {
    return {
      ...common,
      code,
      category: "technical",
      retryable: true,
      attempt: 1,
      retryPolicyRef: { entityId: "engineering-data-retry-policy", versionId: "1" },
      diagnosticRef: diagnosticRef(causalRunId),
      ...extras,
    };
  }
  return {
    ...common,
    code,
    category: "technical",
    retryable: false,
    diagnosticRef: diagnosticRef(causalRunId),
    ...extras,
  };
};

/** C06 在事务内抛出的是裸错误，事务外则被包装；两种情况都必须映射为授权失败。 */
const resolveAccessFailure = (error: unknown): AccessServiceError | undefined => {
  if (error instanceof AccessServiceError) return error;
  if (!(error instanceof Error)) return undefined;
  const wrapped = (error as Error & { accessError?: unknown }).accessError;
  if (wrapped instanceof AccessServiceError) return wrapped;
  const cause = (error as Error & { cause?: unknown }).cause;
  return cause instanceof AccessServiceError ? cause : undefined;
};

const failed = (error: Record<string, unknown>): EngineeringFreezeResultV1 =>
  EngineeringFreezeResultV1Schema.parse({ kind: "failed", error });

/**
 * C15 数据清洗与识别准备收口的事实存储：组合 C03 事务、C04 工件、C08 任务、
 * C11 资料授权、C12/C13 转换记录与 C14 冻结快照，只在 C15 自有文件内实现。
 */
export class PostgresDataCleaningStore implements DataCleaningTaskPortV1 {
  readonly #db: Kysely<CleaningDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #access: LocalIdentityAccessV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #artifactGuard: ArtifactReferenceGuardV1;
  readonly #monitoringStore: PostgresMonitoringStoreV1;
  readonly #startAgentTask: (command: unknown) => Promise<StartAgentTaskResultV1>;
  readonly #policy: DataCleaningPolicyV1;
  readonly #now: () => Date;

  constructor(options: PostgresDataCleaningStoreOptions) {
    this.#db = options.db as unknown as Kysely<CleaningDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#access = options.access;
    this.#artifactStore = options.artifactStore;
    this.#artifactGuard = options.artifactReferenceGuard;
    this.#monitoringStore = options.monitoringStore;
    this.#startAgentTask = options.startAgentTask;
    this.#policy = DataCleaningPolicyV1Schema.parse(options.policy);
    this.#now = options.now ?? (() => new Date());
  }

  createTaskDefinition(): AgentTaskDefinitionV1 {
    return createDataCleaningTaskDefinition({ policy: this.#policy, port: this, now: this.#now });
  }

  // -------------------------------------------------------- freeze entry point

  async freezeIdentificationPreparation(
    command: Extract<EngineeringFreezeCommandV1, { kind: "identification-preparation" }>,
  ): Promise<EngineeringFreezeResultV1> {
    const context: CleaningCommandContext = {
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      projectId: command.projectId,
      actorId: command.actorId,
      issuedAt: command.issuedAt,
      authorization: command.authorization,
    };
    try {
      if (!sameVersion(command.payload.dataProcessingPolicyRef, this.#policy.policyRef)) {
        return failed(
          moduleError("UNSUPPORTED_CONTRACT", command.commandId, { schemaVersion: SCHEMA_VERSION }),
        );
      }
      await this.#verify(
        context,
        PREPARATION_BRANCH,
        command.payload.spatialScopeRefs,
        command.payload.sourceVersionRefs,
      );

      const documents = await this.#resolveDocuments(context, command.payload.sourceVersionRefs);
      if (documents.kind === "error") return failed(documents.error);

      const monitoring = await this.#freezeMonitoring(context, command);
      if (monitoring.kind === "error") return failed(monitoring.error);

      const manifest = CleaningPreparationManifestV1Schema.parse({
        schemaVersion: SCHEMA_VERSION,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        projectId: command.projectId,
        actorId: command.actorId,
        projectRevisionRef: command.payload.projectRevisionRef,
        spatialScopeRefs: command.payload.spatialScopeRefs,
        dataProcessingPolicyRef: command.payload.dataProcessingPolicyRef,
        documents: documents.documents,
        ...(monitoring.monitoring === undefined ? {} : { monitoring: monitoring.monitoring }),
      });
      const digest = sha256CanonicalJson({
        schemaVersion: SCHEMA_VERSION,
        projectId: command.projectId,
        idempotencyKey: command.idempotencyKey,
        manifest,
      });
      const manifestArtifactRef = await this.#putContent(context, {
        artifactId: `data-cleaning-manifest-${digest.slice(0, 40)}`,
        purposeCode: MANIFEST_PURPOSE,
        value: manifest,
        parentArtifactRefs: [],
      });
      const started = await this.#startCleaningTask(context, digest, manifestArtifactRef);
      if (started.kind === "error") return failed(started.error);
      return await this.#finalizePreparation(
        context,
        command,
        digest,
        manifest,
        manifestArtifactRef,
        started.taskRef,
      );
    } catch (error) {
      return failed(this.#mapError(error, command.commandId));
    }
  }

  // -------------------------------------------------------------- task contract

  async loadFrozenInput(task: AgentTaskSnapshotV1): Promise<DataCleaningFrozenInputV1> {
    const taskRef = task.envelope.agentTaskRef;
    const authorization = task.envelope.authorization;
    const frozenInputRef = task.envelope.frozenInputRef;
    if (frozenInputRef.kind !== "content-artifact") {
      throw new Error("data cleaning task has no frozen preparation manifest");
    }
    const manifestArtifactRef = ContentArtifactRefV1Schema.parse(frozenInputRef);
    const manifest = CleaningPreparationManifestV1Schema.parse(
      await this.#readJson(
        taskRef,
        manifestArtifactRef,
        authorization,
        MANIFEST_PURPOSE,
        MAX_MANIFEST_BYTES,
      ),
    );
    const documents: DataCleaningFrozenDocumentV1[] = [];
    for (const document of manifest.documents) {
      documents.push(await this.#readFrozenDocument(taskRef, document, authorization));
    }
    const monitoring =
      manifest.monitoring === undefined
        ? undefined
        : await this.#readFrozenMonitoring(
            manifest.projectId,
            manifest.monitoring.monitoringSnapshotRef,
          );
    return DataCleaningFrozenInputV1Schema.parse({
      schemaVersion: SCHEMA_VERSION,
      manifestArtifactRef,
      manifestDigest: sha256CanonicalJson({
        schemaVersion: SCHEMA_VERSION,
        projectId: manifest.projectId,
        idempotencyKey: manifest.idempotencyKey,
        manifest,
      }),
      agentTaskRef: taskRef,
      policyRef: this.#policy.policyRef,
      documents,
      ...(monitoring === undefined ? {} : { monitoring }),
    });
  }

  async persistValidationArtifact(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: DataCleaningCandidateV1;
    readonly validation: DataCleaningValidationViewV1;
    readonly settlement: DataCleaningSettlementV1;
  }): Promise<ArtifactRefV1> {
    const value = {
      schemaVersion: SCHEMA_VERSION,
      candidateDigest: sha256CanonicalJson(DataCleaningCandidateV1Schema.parse(input.candidate)),
      validation: input.validation,
      settlement: input.settlement,
    };
    return this.#putContent(taskContext(input.task), {
      artifactId: `data-cleaning-validation-${sha256CanonicalJson(value).slice(0, 40)}`,
      purposeCode: VALIDATION_PURPOSE,
      value,
      parentArtifactRefs: [],
    });
  }

  async persistCleaningResult(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: DataCleaningCandidateV1;
    readonly frozen: DataCleaningFrozenInputV1;
    readonly settlement: DataCleaningSettlementV1;
    readonly validationArtifactRef: ArtifactRefV1;
  }): Promise<AgentTaskResultRefV1> {
    const context = taskContext(input.task);
    const frozen = input.frozen;
    const taskRef = input.task.envelope.agentTaskRef;
    const manifest = CleaningPreparationManifestV1Schema.parse(
      await this.#readJson(
        taskRef,
        frozen.manifestArtifactRef,
        context.authorization,
        MANIFEST_PURPOSE,
        MAX_MANIFEST_BYTES,
      ),
    );
    const result = DataCleaningResultV1Schema.parse({
      schemaVersion: SCHEMA_VERSION,
      manifestArtifactRef: frozen.manifestArtifactRef,
      manifestDigest: frozen.manifestDigest,
      policyRef: this.#policy.policyRef,
      agentTaskRef: taskRef,
      projectRevisionRef: manifest.projectRevisionRef,
      spatialScopeRefs: manifest.spatialScopeRefs,
      documentConversionRefs: frozen.documents.map((document) => document.conversionRef),
      sourceSegmentSetRefs: frozen.documents.map((document) => document.sourceSegmentSetRef),
      ...(frozen.monitoring === undefined
        ? {}
        : { monitoringSnapshotRef: frozen.monitoring.monitoringSnapshotRef }),
      modelDeploymentRef: this.#policy.agent.modelDeploymentRef,
      promptTemplateRef: this.#policy.agent.promptTemplateRef,
      toolPolicyRef: this.#policy.agent.toolPolicyRef,
      budgetPolicyRef: this.#policy.agent.budgetPolicyRef,
      incrementSchemaRef: this.#policy.agent.incrementSchemaRef,
      validationPolicyRef: this.#policy.agent.validationPolicyRef,
      candidateVersion: DataCleaningCandidateV1Schema.parse(input.candidate).candidateVersion,
      validationArtifactRef: ContentArtifactRefV1Schema.parse(input.validationArtifactRef),
      exclusions: input.settlement.exclusions,
      inputs: input.settlement.inputs,
      overallAvailability: input.settlement.overallAvailability,
      overallCoverageRatio: input.settlement.overallCoverageRatio,
      reasonCodes: input.settlement.reasonCodes,
      formedAt: this.#now().toISOString(),
    });
    const resultArtifactRef = await this.#putContent(context, {
      artifactId: `data-cleaning-result-${frozen.manifestDigest.slice(0, 40)}`,
      purposeCode: RESULT_PURPOSE,
      value: result,
      parentArtifactRefs: [
        frozen.manifestArtifactRef,
        ContentArtifactRefV1Schema.parse(input.validationArtifactRef),
      ],
    });
    await this.#persistResultIndex(context, taskRef, frozen, resultArtifactRef, result);
    return {
      kind: "agent-task-result",
      reference: { entityId: `agent-result:${taskRef.reference.entityId}`, versionId: "1" },
      agentTaskRef: taskRef,
      status: "completed",
      incrementRef: resultArtifactRef,
    } as AgentTaskResultRefV1;
  }

  async readDocumentSlice(
    input: DataCleaningDocumentSliceRequestV1,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1> {
    const frozen = await this.loadFrozenInput(context.task);
    const key = referenceKey(input.sourceVersionRef);
    const document = frozen.documents.find((item) => referenceKey(item.sourceVersionRef) === key);
    if (document === undefined) {
      throw new TypeError("requested source version is not part of the frozen preparation");
    }
    if (input.sourceSegmentIds.length > this.#policy.tools.maxSegmentsPerRead) {
      throw new RangeError("requested segment slice exceeds the frozen tool limit");
    }
    const requested = new Set<string>(input.sourceSegmentIds);
    const selected = document.segments.filter((segment) => requested.has(segment.sourceSegmentId));
    if (selected.length !== requested.size) {
      throw new RangeError("requested segment is not part of the frozen preparation");
    }
    const jsonLd = StructuredDocumentJsonLdV1Schema.parse(
      JSON.parse(
        await this.#readBytes(
          context.task.envelope.agentTaskRef,
          document.jsonLdArtifactRef,
          context.task.envelope.authorization,
          CONVERSION_PURPOSE,
          MAX_JSON_LD_BYTES,
        ),
      ) as unknown,
    );
    const blocksById = new Map(jsonLd.textBlocks.map((block) => [block.blockId, block]));
    const evidenceBySegment = new Map(
      jsonLd.evidenceFragments.map((fragment) => [fragment.sourceSegmentId, fragment]),
    );
    const protectedKinds = new Set<string>(this.#policy.protectedSegmentKinds);
    const observationRef = await this.#putDiagnostic(taskContext(context.task), {
      artifactId: `${context.actionId}:document-slice`,
      purposeCode: OBSERVATION_PURPOSE,
      value: {
        schemaVersion: SCHEMA_VERSION,
        manifestArtifactRef: frozen.manifestArtifactRef,
        sourceVersionRef: document.sourceVersionRef,
        conversionRef: document.conversionRef,
        jsonLdArtifactRef: document.jsonLdArtifactRef,
        sourceSegmentSetRef: document.sourceSegmentSetRef,
        inputKind: document.inputKind,
        segments: selected.map((segment) => {
          const fragment = evidenceBySegment.get(segment.sourceSegmentId);
          const blocks = (fragment?.textBlockIds ?? segment.textBlockIds)
            .map((blockId) => blocksById.get(blockId))
            .flatMap((block) => (block === undefined ? [] : [block]));
          return {
            sourceSegmentId: segment.sourceSegmentId,
            kind: segment.kind,
            locator: segment.locator,
            numericProtection: protectedKinds.has(segment.kind) ? "protected" : "exposable",
            textBlocks: blocks.map((block) => ({
              blockId: block.blockId,
              text: block.text,
              ...(block.confidence === undefined ? {} : { confidence: block.confidence }),
            })),
          };
        }),
      },
      parentArtifactRefs: [frozen.manifestArtifactRef, document.jsonLdArtifactRef],
    });
    return {
      observationArtifactRef: observationRef,
      effect: "none",
      usage: { ...emptyAgentBudgetUsage(), objects: selected.length },
    };
  }

  async readMonitoringSlice(
    input: DataCleaningMonitoringSliceRequestV1,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1> {
    const frozen = await this.loadFrozenInput(context.task);
    const monitoring = frozen.monitoring;
    if (monitoring === undefined) {
      throw new TypeError("frozen preparation has no monitoring input");
    }
    if (
      referenceKey(input.monitoringSnapshotRef) !== referenceKey(monitoring.monitoringSnapshotRef)
    ) {
      throw new RangeError("requested monitoring snapshot is not part of the frozen preparation");
    }
    if (input.sampleVersionRefs.length > this.#policy.tools.maxMonitoringItemsPerRead) {
      throw new RangeError("requested monitoring slice exceeds the frozen tool limit");
    }
    const requested = new Set(input.sampleVersionRefs.map((ref) => referenceKey(ref)));
    const members = monitoring.members.filter((member) =>
      requested.has(referenceKey(member.sampleVersionRef)),
    );
    if (members.length !== requested.size) {
      throw new RangeError("requested monitoring sample is not part of the frozen preparation");
    }
    const samples = await this.#readSampleVersions(
      context.task.envelope.projectId,
      members.map((member) => member.sampleVersionRef.reference.entityId),
    );
    const observationRef = await this.#putDiagnostic(taskContext(context.task), {
      artifactId: `${context.actionId}:monitoring-slice`,
      purposeCode: OBSERVATION_PURPOSE,
      value: {
        schemaVersion: SCHEMA_VERSION,
        manifestArtifactRef: frozen.manifestArtifactRef,
        monitoringSnapshotRef: monitoring.monitoringSnapshotRef,
        availability: monitoring.availability,
        coverageRatio: monitoring.coverageRatio,
        availabilityReasons: monitoring.availabilityReasons,
        members: members.map((member) => ({
          memberIndex: member.memberIndex,
          selectionReason: member.selectionReason,
          sampleVersionRef: member.sampleVersionRef,
        })),
        points: monitoring.pointStatuses.map((point) => ({
          sampledAt: point.sampledAt,
          status: point.status,
          sampleVersionRefs: point.sampleVersionRefs,
        })),
        samples,
      },
      parentArtifactRefs: [frozen.manifestArtifactRef],
    });
    return {
      observationArtifactRef: observationRef,
      effect: "none",
      usage: { ...emptyAgentBudgetUsage(), objects: members.length },
    };
  }

  // ----------------------------------------------------------- preparation tail

  async #finalizePreparation(
    context: CleaningCommandContext,
    command: Extract<EngineeringFreezeCommandV1, { kind: "identification-preparation" }>,
    digest: string,
    manifest: CleaningPreparationManifestV1,
    manifestArtifactRef: ContentArtifactRefV1,
    agentTaskRef: AgentTaskRefV1,
  ): Promise<EngineeringFreezeResultV1> {
    const task = await this.#db
      .selectFrom("business.agent_tasks")
      .select(["status"])
      .where("agent_task_id", "=", agentTaskRef.reference.entityId)
      .executeTakeFirst();
    if (task === undefined) {
      return failed(moduleError("TERMINAL_FAILURE", command.commandId));
    }
    if (task.status !== "completed") {
      return failed(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerKind: "data-cleaning-task-incomplete",
          blockerRef: agentTaskRef,
        }),
      );
    }
    const bound = await this.#readBoundResult(context, agentTaskRef);
    if (bound.kind === "error") return failed(bound.error);
    const result = bound.result;

    const documentsNonUnavailable = result.inputs.filter(
      (status) =>
        status.inputKind !== "monitoring-snapshot" && status.availability !== "unavailable",
    ).length;
    if (
      documentsNonUnavailable === 0 ||
      documentsNonUnavailable / manifest.documents.length <
        this.#policy.minimumDocumentCoverageRatio
    ) {
      return failed(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerKind: "data-cleaning-coverage",
          blockerRef: result.validationArtifactRef,
        }),
      );
    }

    const availabilityByVersion = new Map(
      result.inputs
        .filter((status) => status.sourceVersionRef !== undefined)
        .map((status) => [referenceKey(status.sourceVersionRef!), status.availability] as const),
    );
    const monitoringStatus = result.inputs.find(
      (status) => status.inputKind === "monitoring-snapshot",
    );
    const monitoringSnapshotRef =
      monitoringStatus !== undefined &&
      monitoringStatus.availability !== "unavailable" &&
      manifest.monitoring !== undefined
        ? manifest.monitoring.monitoringSnapshotRef
        : undefined;

    const coverageDecisionRef = await this.#putContent(context, {
      artifactId: `data-cleaning-coverage-${digest.slice(0, 40)}`,
      purposeCode: DECISION_PURPOSE,
      value: {
        schemaVersion: SCHEMA_VERSION,
        manifestDigest: digest,
        cleaningResultArtifactRef: bound.resultArtifactRef,
        overallAvailability: result.overallAvailability,
        overallCoverageRatio: result.overallCoverageRatio,
        documentCoverage: manifest.documents.map((document) => ({
          sourceVersionRef: document.sourceVersionRef,
          availability:
            availabilityByVersion.get(referenceKey(document.sourceVersionRef)) ?? "unavailable",
        })),
        ...(monitoringStatus === undefined
          ? {}
          : {
              monitoring: {
                monitoringSnapshotRef: manifest.monitoring?.monitoringSnapshotRef,
                availability: monitoringStatus.availability,
                reasonCodes: monitoringStatus.reasonCodes,
              },
            }),
        reasonCodes: result.reasonCodes,
      },
      parentArtifactRefs: [manifestArtifactRef, bound.resultArtifactRef],
    });
    const excludedSegmentDecisionRef = await this.#putContent(context, {
      artifactId: `data-cleaning-exclusions-${digest.slice(0, 40)}`,
      purposeCode: DECISION_PURPOSE,
      value: {
        schemaVersion: SCHEMA_VERSION,
        manifestDigest: digest,
        cleaningResultArtifactRef: bound.resultArtifactRef,
        decisions: result.exclusions,
      },
      parentArtifactRefs: [manifestArtifactRef, bound.resultArtifactRef],
    });

    const snapshotRef = {
      kind: "identification-preparation-snapshot" as const,
      reference: { entityId: `identification-preparation-${digest.slice(0, 40)}`, versionId: "1" },
    };
    const recordedAt = this.#now().toISOString();
    const auditEntryId = `audit-${command.commandId}`;
    const snapshot = {
      schemaVersion: SCHEMA_VERSION,
      projectRevisionRef: manifest.projectRevisionRef,
      spatialScopeRefs: manifest.spatialScopeRefs,
      sourceVersionRefs: manifest.documents.map((document) => document.sourceVersionRef),
      includedSourceSegmentSetRefs: manifest.documents.map(
        (document) => document.sourceSegmentSetRef,
      ),
      excludedSegmentDecisionRefs: [excludedSegmentDecisionRef],
      ...(monitoringSnapshotRef === undefined ? {} : { monitoringSnapshotRef }),
      dataProcessingPolicyRef: this.#policy.policyRef,
      dataProcessingToolRef: this.#policy.agent.toolPolicyRef,
      dataProcessingModelRef: this.#policy.agent.modelDeploymentRef,
      coverageDecisionRef,
      authorizationContextRef: context.authorization.authorizationContextRef,
      auditTrailRef: {
        kind: "audit-trail" as const,
        reference: { entityId: auditEntryId, versionId: "1" },
      },
      createdBy: context.actorId,
      createdAt: recordedAt,
    };

    await this.#transactionUnit.execute(
      atomicCommandFor(context, PREPARATION_COMMAND_KIND, {
        manifestDigest: digest,
        projectRevisionRef: manifest.projectRevisionRef,
        sourceVersionRefs: snapshot.sourceVersionRefs,
      }),
      async (transactionContext) => {
        for (const decisionRef of [coverageDecisionRef, excludedSegmentDecisionRef]) {
          await this.#artifactGuard.assertUsable(transactionContext, {
            schemaVersion: SCHEMA_VERSION,
            artifactRef: decisionRef,
            projectId: context.projectId,
            purposeCode: DECISION_PURPOSE,
            requiredCapability: FREEZE_CAPABILITY,
            authorization: context.authorization,
          });
        }
        const transaction = asTransaction(transactionContext);
        await transaction
          .insertInto("business.identification_preparation_snapshots")
          .values({
            snapshot_id: snapshotRef.reference.entityId,
            version_id: "1",
            schema_version: SCHEMA_VERSION,
            command_kind: PREPARATION_COMMAND_KIND,
            project_id: context.projectId,
            command_id: command.commandId,
            idempotency_key: command.idempotencyKey,
            payload_hash: digest,
            agent_task_ref: agentTaskRef,
            cleaning_result_artifact_ref: bound.resultArtifactRef,
            snapshot_ref: snapshotRef,
            snapshot_payload: snapshot,
            audit_entry_id: auditEntryId,
          } as never)
          .onConflict((conflict) => conflict.columns(["snapshot_id", "version_id"]).doNothing())
          .execute();
        return {
          resultRef: snapshotRef,
          audit: {
            auditEntryId,
            projectId: context.projectId,
            action: "engineering-data.identification-preparation",
            targetRef: snapshotRef,
            actorRef: context.actorId,
            authorizationContextRef: context.authorization.authorizationContextRef,
            occurredAt: context.issuedAt,
            recordedAt,
            version: { entityId: snapshotRef.reference.entityId, versionId: "1" },
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
          },
          events: [
            {
              schemaVersion: SCHEMA_VERSION,
              eventId: `inputs-ready-${digest.slice(0, 40)}`,
              eventVersion: 1,
              eventType: "engineering.inputs-ready.v1",
              projectId: context.projectId,
              aggregateRef: snapshotRef,
              occurredAt: context.issuedAt,
              recordedAt,
              causationId: command.commandId,
              correlationId: `data-cleaning-${digest.slice(0, 40)}`,
              producerCommandId: command.commandId,
              idempotencyKey: command.idempotencyKey,
              authorizationContextRef: context.authorization.authorizationContextRef,
              auditTrailRef: snapshot.auditTrailRef,
              payload: {
                preparation: {
                  kind: "identification",
                  identificationPreparationSnapshotRef: snapshotRef,
                },
              },
            },
          ],
        } satisfies AtomicCommitV1;
      },
      { isolationLevel: "repeatable read" },
    );

    return EngineeringFreezeResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "identification-preparation",
        identificationPreparationSnapshotRef: snapshotRef,
      },
    });
  }

  // ------------------------------------------------------------------- helpers

  async #verify(
    context: CleaningCommandContext,
    branch: typeof PREPARATION_BRANCH | typeof MONITORING_BRANCH,
    spatialScopeRefs: readonly { reference: { entityId: string; versionId: string } }[],
    sourceVersionRefs: readonly SourceVersionRefV1[],
  ): Promise<void> {
    if (
      context.projectId !== context.authorization.projectId ||
      context.actorId !== context.authorization.actorId
    ) {
      throw Object.assign(new Error("authorization denied"), {
        dataCleaningError: moduleError("AUTHORIZATION_DENIED", context.commandId),
      });
    }
    await this.#access.verify({
      authorizationContextRef: context.authorization.authorizationContextRef,
      invocationId: context.commandId,
      projectId: context.projectId,
      branch,
      requestedSpatialScopeRefs: [...spatialScopeRefs] as never,
      requestedSourceVersionRefs: [...sourceVersionRefs] as never,
      requestedAt: context.authorization.decidedAt,
    });
  }

  async #resolveDocuments(
    context: CleaningCommandContext,
    sourceVersionRefs: readonly SourceVersionRefV1[],
  ): Promise<
    | { readonly kind: "ok"; readonly documents: CleaningPreparationManifestV1["documents"] }
    | { readonly kind: "error"; readonly error: Record<string, unknown> }
  > {
    const rows = await this.#db
      .selectFrom("business.structured_document_conversions")
      .selectAll()
      .where("project_id", "=", context.projectId)
      .where("status", "=", "succeeded")
      .execute();
    const documents: CleaningPreparationManifestV1["documents"] = [];
    for (const sourceVersionRef of sourceVersionRefs) {
      const versionKey = referenceKey(sourceVersionRef);
      const candidates = rows.filter((row) => {
        const parsed = SourceVersionRefV1Schema.safeParse(row.source_version_ref);
        if (!parsed.success || referenceKey(parsed.data) !== versionKey) return false;
        return (
          this.#policy.allowedConversionPolicyRefs.some((ref) =>
            sameVersion(ref, row.conversion_policy_ref as VersionReference),
          ) &&
          this.#policy.allowedQualityPolicyRefs.some((ref) =>
            sameVersion(ref, row.quality_policy_ref as VersionReference),
          ) &&
          this.#policy.allowedConverterDeploymentRefs.some((ref) =>
            sameVersion(ref, row.converter_deployment_ref as VersionReference),
          )
        );
      });
      if (candidates.length !== 1) {
        return {
          kind: "error",
          error: moduleError("BUSINESS_BLOCKED", context.commandId, {
            blockerKind:
              candidates.length === 0
                ? "document-conversion-missing"
                : "document-conversion-ambiguous",
            blockerRef: sourceVersionRef,
          }),
        };
      }
      const row = candidates[0]!;
      documents.push({
        sourceVersionRef,
        conversionRef: StructuredDocumentConversionRefV1Schema.parse({
          kind: "structured-document-conversion",
          reference: { entityId: row.conversion_id, versionId: row.version_id },
        }),
        jsonLdArtifactRef: ContentArtifactRefV1Schema.parse(row.jsonld_artifact_ref),
        sourceSegmentSetRef: SourceSegmentSetRefV1Schema.parse(row.source_segment_set_ref),
        inputKind:
          row.input_kind as CleaningPreparationManifestV1["documents"][number]["inputKind"],
      });
    }
    return { kind: "ok", documents };
  }

  async #freezeMonitoring(
    context: CleaningCommandContext,
    command: Extract<EngineeringFreezeCommandV1, { kind: "identification-preparation" }>,
  ): Promise<
    | {
        readonly kind: "ok";
        readonly monitoring: CleaningPreparationManifestV1["monitoring"];
      }
    | { readonly kind: "error"; readonly error: Record<string, unknown> }
  > {
    const monitoringPolicy = this.#policy.monitoring;
    if (monitoringPolicy === undefined) return { kind: "ok", monitoring: undefined };
    const cutoff = command.payload.monitoringCutoff;
    if (cutoff === undefined) {
      return {
        kind: "error",
        error: moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerKind: "monitoring-cutoff-missing",
          blockerRef: monitoringPolicy.monitoringSeriesRef,
        }),
      };
    }
    const authorization = await this.#deriveMonitoringAuthorization(
      context,
      { sourceVersionRefs: command.payload.sourceVersionRefs },
      monitoringPolicy.monitoringSeriesRef,
    );
    const frozen = await this.#monitoringStore.freezeSnapshot({
      commandId: `${command.commandId}:monitoring`,
      idempotencyKey: `${command.idempotencyKey}:monitoring`,
      projectId: command.projectId,
      actorId: command.actorId,
      issuedAt: command.issuedAt,
      authorization,
      kind: "monitoring-snapshot",
      payload: {
        monitoringSeriesRef: monitoringPolicy.monitoringSeriesRef,
        cutoff,
        availabilityPolicyRef: monitoringPolicy.availabilityPolicyRef,
      },
    });
    if (frozen.kind === "waiting") {
      return {
        kind: "error",
        error: moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerKind: "monitoring-freeze-pending",
          blockerRef: monitoringPolicy.monitoringSeriesRef,
        }),
      };
    }
    if (frozen.kind === "failed") {
      return { kind: "error", error: frozen.error as unknown as Record<string, unknown> };
    }
    if (frozen.result.kind !== "monitoring-snapshot") {
      return { kind: "error", error: moduleError("TERMINAL_FAILURE", command.commandId) };
    }
    const availability = await this.#readSnapshotAvailability(
      command.projectId,
      frozen.result.monitoringSnapshotRef,
    );
    if (availability === undefined) {
      return { kind: "error", error: moduleError("TERMINAL_FAILURE", command.commandId) };
    }
    return {
      kind: "ok",
      monitoring: {
        monitoringSnapshotRef: frozen.result.monitoringSnapshotRef,
        monitoringSeriesRef: monitoringPolicy.monitoringSeriesRef,
        availability,
      },
    };
  }

  /**
   * C06 授权上下文按 (invocationId, project, branch) 绑定，因此 C14 的冻结必须使用
   * 以本次冻结为父上下文的窄化 system 授权，而不是直接复用 C15 自己的上下文。
   */
  async #deriveMonitoringAuthorization(
    context: CleaningCommandContext,
    request: { readonly sourceVersionRefs: readonly SourceVersionRefV1[] },
    monitoringSeriesRef: MonitoringSeriesRefV1,
  ): Promise<EngineeringFreezeCommandV1["authorization"]> {
    const decision = await this.#access.authorize({
      invocationId: `${context.commandId}:monitoring`,
      projectId: context.projectId,
      branch: MONITORING_BRANCH,
      requestedSpatialScopeRefs: [...context.authorization.spatialScopeRefs] as never,
      // 窄化到本次冻结命令的资料版本；C14 冻结仍会以监测样本的资料版本复验当前授权，
      // 因此监测序列必须引用同一批资料版本，否则准备按授权失败阻断而不是放宽。
      requestedSourceVersionRefs: request.sourceVersionRefs as never,
      requestedAt: context.issuedAt,
      invocation: {
        kind: "system",
        systemActorId: context.actorId,
        reasonCode: "data-cleaning-monitoring-freeze",
      },
      parentContext: context.authorization,
      causalRunRef: {
        kind: "workflow-run",
        reference: {
          entityId: `data-cleaning-${referenceKey(monitoringSeriesRef)}`,
          versionId: "1",
        },
      },
    });
    return decision.context;
  }

  async #startCleaningTask(
    context: CleaningCommandContext,
    digest: string,
    manifestArtifactRef: ContentArtifactRefV1,
  ): Promise<
    | { readonly kind: "ok"; readonly taskRef: AgentTaskRefV1 }
    | { readonly kind: "error"; readonly error: Record<string, unknown> }
  > {
    const agent = this.#policy.agent;
    const started = StartAgentTaskResultV1Schema.parse(
      await this.#startAgentTask({
        commandId: `data-cleaning-start-${digest.slice(0, 40)}`,
        idempotencyKey: `data-cleaning-task-${digest.slice(0, 40)}`,
        projectId: context.projectId,
        actorId: context.actorId,
        issuedAt: context.issuedAt,
        authorization: context.authorization,
        kind: "start-task",
        payload: {
          taskType: "data-cleaning",
          triggerMode: "embedded",
          parentRunRef: {
            kind: "workflow-run",
            reference: { entityId: `data-cleaning-run-${digest.slice(0, 40)}`, versionId: "1" },
          },
          frozenInputRef: manifestArtifactRef,
          modelDeploymentRef: agent.modelDeploymentRef,
          promptTemplateRef: agent.promptTemplateRef,
          toolPolicyRef: agent.toolPolicyRef,
          budgetPolicyRef: agent.budgetPolicyRef,
          incrementSchemaRef: agent.incrementSchemaRef,
          validationPolicyRef: agent.validationPolicyRef,
        },
      }),
    );
    if (started.kind === "failed") {
      return { kind: "error", error: started.error as unknown as Record<string, unknown> };
    }
    if (started.kind !== "succeeded") {
      return { kind: "error", error: moduleError("TERMINAL_FAILURE", context.commandId) };
    }
    return { kind: "ok", taskRef: AgentTaskRefV1Schema.parse(started.result.agentTaskRef) };
  }

  async #readBoundResult(
    context: CleaningCommandContext,
    taskRef: AgentTaskRefV1,
  ): Promise<
    | {
        readonly kind: "ok";
        readonly result: DataCleaningResultV1;
        readonly resultArtifactRef: ContentArtifactRefV1;
      }
    | { readonly kind: "error"; readonly error: Record<string, unknown> }
  > {
    const row = await this.#db
      .selectFrom("business.data_cleaning_results")
      .selectAll()
      .where("project_id", "=", context.projectId)
      .where(sql<boolean>`agent_task_ref->'reference'->>'entityId' = ${taskRef.reference.entityId}`)
      .executeTakeFirst();
    if (row === undefined) {
      return {
        kind: "error",
        error: moduleError("BUSINESS_BLOCKED", context.commandId, {
          blockerKind: "data-cleaning-result-missing",
          blockerRef: taskRef,
        }),
      };
    }
    const resultArtifactRef = ContentArtifactRefV1Schema.parse(row.result_artifact_ref);
    const result = DataCleaningResultV1Schema.parse(
      await this.#readJson(
        taskRef,
        resultArtifactRef,
        context.authorization,
        RESULT_PURPOSE,
        MAX_MANIFEST_BYTES,
      ),
    );
    if (!sameVersion(result.agentTaskRef.reference, taskRef.reference)) {
      return {
        kind: "error",
        error: moduleError("BUSINESS_BLOCKED", context.commandId, {
          blockerKind: "data-cleaning-result-mismatch",
          blockerRef: taskRef,
        }),
      };
    }
    return { kind: "ok", result, resultArtifactRef };
  }

  async #persistResultIndex(
    context: CleaningCommandContext,
    taskRef: AgentTaskRefV1,
    frozen: DataCleaningFrozenInputV1,
    resultArtifactRef: ContentArtifactRefV1,
    result: DataCleaningResultV1,
  ): Promise<void> {
    const recordedAt = this.#now().toISOString();
    const resultContext: CleaningCommandContext = {
      ...context,
      commandId: `${taskRef.reference.entityId}:cleaning-result`,
      idempotencyKey: `${taskRef.reference.entityId}:cleaning-result`,
    };
    const auditEntryId = `audit-${resultContext.commandId}`;
    const resultRef = {
      kind: "route-decision" as const,
      reference: {
        entityId: `data-cleaning-result-${frozen.manifestDigest.slice(0, 40)}`,
        versionId: "1",
      },
    };
    await this.#transactionUnit.execute(
      atomicCommandFor(resultContext, RESULT_COMMAND_KIND, {
        manifestDigest: frozen.manifestDigest,
        overallAvailability: result.overallAvailability,
      }),
      async (transactionContext) => {
        const transaction = asTransaction(transactionContext);
        await transaction
          .insertInto("business.data_cleaning_results")
          .values({
            result_id: resultRef.reference.entityId,
            version_id: "1",
            schema_version: SCHEMA_VERSION,
            command_kind: RESULT_COMMAND_KIND,
            project_id: context.projectId,
            command_id: resultContext.commandId,
            idempotency_key: resultContext.idempotencyKey,
            agent_task_ref: taskRef,
            manifest_artifact_ref: frozen.manifestArtifactRef,
            result_artifact_ref: resultArtifactRef,
            policy_ref: this.#policy.policyRef,
            overall_availability: result.overallAvailability,
            result_payload: result,
            audit_entry_id: auditEntryId,
          } as never)
          .onConflict((conflict) => conflict.columns(["result_id", "version_id"]).doNothing())
          .execute();
        return {
          resultRef,
          audit: {
            auditEntryId,
            projectId: context.projectId,
            action: "engineering-data.data-cleaning-result",
            targetRef: resultRef,
            actorRef: resultContext.actorId,
            authorizationContextRef: resultContext.authorization.authorizationContextRef,
            occurredAt: resultContext.issuedAt,
            recordedAt,
            version: { entityId: resultRef.reference.entityId, versionId: "1" },
            commandId: resultContext.commandId,
            idempotencyKey: resultContext.idempotencyKey,
          },
          events: [],
        } satisfies AtomicCommitV1;
      },
      { isolationLevel: "repeatable read" },
    );
  }

  async #readFrozenDocument(
    taskRef: AgentTaskRefV1,
    document: CleaningPreparationManifestV1["documents"][number],
    authorization: EngineeringFreezeCommandV1["authorization"],
  ): Promise<DataCleaningFrozenDocumentV1> {
    const raw = await this.#readBytes(
      taskRef,
      document.jsonLdArtifactRef,
      authorization,
      CONVERSION_PURPOSE,
      MAX_JSON_LD_BYTES,
    );
    const jsonLd = StructuredDocumentJsonLdV1Schema.parse(JSON.parse(raw) as unknown);
    const rows = await this.#db
      .selectFrom("business.source_segments")
      .selectAll()
      .where("project_id", "=", authorization.projectId)
      .where("source_segment_set_id", "=", document.sourceSegmentSetRef.reference.entityId)
      .orderBy("source_segment_id")
      .execute();
    const blocksById = new Map(jsonLd.textBlocks.map((block) => [block.blockId, block]));
    const evidenceBySegment = new Map(
      jsonLd.evidenceFragments.map((fragment) => [fragment.sourceSegmentId, fragment]),
    );
    const segments: DataCleaningFrozenSegmentV1[] = rows.map((row) => {
      const sourceSegmentId = SourceSegmentIdV1Schema.parse(row.source_segment_id);
      const textBlockIds = [...(evidenceBySegment.get(sourceSegmentId)?.textBlockIds ?? [])];
      const blocks = textBlockIds
        .map((blockId) => blocksById.get(blockId))
        .flatMap((block) => (block === undefined ? [] : [block]));
      return {
        sourceSegmentId,
        kind: SourceSegmentKindV1Schema.parse(row.kind),
        locator: SourceSegmentLocatorV1Schema.parse(row.locator),
        textBlockIds,
        parsedFingerprint: sha256CanonicalJson({
          segment: sourceSegmentId,
          blocks: blocks.map((block) => ({ blockId: block.blockId, text: block.text })),
        }),
      };
    });
    return {
      sourceVersionRef: document.sourceVersionRef,
      conversionRef: document.conversionRef,
      jsonLdArtifactRef: document.jsonLdArtifactRef,
      sourceSegmentSetRef: document.sourceSegmentSetRef,
      inputKind: document.inputKind,
      jsonLdFingerprint: sha256CanonicalJson(raw),
      segments,
    };
  }

  async #readFrozenMonitoring(
    projectId: string,
    monitoringSnapshotRef: MonitoringSnapshotRefV1,
  ): Promise<DataCleaningFrozenMonitoringV1> {
    const snapshot = await this.#db
      .selectFrom("business.monitoring_snapshots")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("snapshot_id", "=", monitoringSnapshotRef.reference.entityId)
      .where("version_id", "=", monitoringSnapshotRef.reference.versionId)
      .executeTakeFirst();
    if (snapshot === undefined) {
      throw new TypeError("frozen monitoring snapshot is not available");
    }
    const members = await this.#db
      .selectFrom("business.monitoring_snapshot_members")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("snapshot_id", "=", monitoringSnapshotRef.reference.entityId)
      .orderBy("member_index")
      .execute();
    const points = await this.#db
      .selectFrom("business.monitoring_snapshot_points")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("snapshot_id", "=", monitoringSnapshotRef.reference.entityId)
      .orderBy("point_index")
      .execute();
    const sampleRefs = new Map(
      (snapshot.sample_version_refs as unknown[])
        .map((value) => MonitoringSampleVersionRefV1Schema.safeParse(value))
        .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
        .map((ref) => [ref.reference.entityId, ref] as const),
    );
    return {
      monitoringSnapshotRef,
      monitoringSeriesRef: MonitoringSeriesRefV1Schema.parse(
        snapshot.monitoring_series_ref,
      ) as MonitoringSeriesRefV1,
      availability: DataCleaningAvailabilityV1Schema.parse(snapshot.availability),
      coverageRatio: snapshot.coverage_ratio,
      availabilityReasons: (snapshot.availability_reasons as unknown[])
        .flatMap((value) => (typeof value === "string" ? [value] : []))
        .slice(0, 32),
      members: members.map((member) => ({
        memberIndex: member.member_index,
        sampleVersionRef:
          sampleRefs.get(member.sample_version_id) ??
          MonitoringSampleVersionRefV1Schema.parse({
            kind: "monitoring-sample-version",
            reference: { entityId: member.sample_version_id, versionId: "1" },
          }),
        selectionReason:
          member.selection_reason as DataCleaningFrozenMonitoringV1["members"][number]["selectionReason"],
      })),
      pointStatuses: points.map((point) => ({
        sampledAt: asIso(point.sampled_at),
        status: point.status as DataCleaningFrozenMonitoringV1["pointStatuses"][number]["status"],
        sampleVersionRefs: (point.source_sample_refs as unknown[])
          .map((value) => MonitoringSampleVersionRefV1Schema.safeParse(value))
          .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
          .slice(0, 4),
      })),
      snapshotFingerprint: sha256CanonicalJson({
        snapshot: referenceKey(monitoringSnapshotRef),
        members: members.map((member) => `${member.member_index}:${member.sample_version_id}`),
        points: points.map((point) => `${point.point_index}:${point.status}`),
      }),
    };
  }

  async #readSampleVersions(
    projectId: string,
    sampleVersionIds: readonly string[],
  ): Promise<readonly Record<string, unknown>[]> {
    if (sampleVersionIds.length === 0) return [];
    const rows = await this.#db
      .selectFrom("business.monitoring_sample_versions")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("sample_version_id", "in", [...sampleVersionIds])
      .execute();
    return rows.map((row) => ({
      sampleVersionRef: {
        kind: "monitoring-sample-version",
        reference: { entityId: row.sample_version_id, versionId: row.version_id },
      },
      sourceSampleKey: row.source_sample_key,
      sampledAt: asIso(row.sampled_at),
      value: row.value,
      unit: row.unit,
      canonicalValue: row.canonical_value,
      canonicalUnit: row.canonical_unit,
      relationKind: row.relation_kind,
      evidenceReferences: row.evidence_references,
      sourceVersionRef: row.source_version_ref,
      sourceSegmentSetRef: row.source_segment_set_ref,
    }));
  }

  async #readSnapshotAvailability(
    projectId: string,
    monitoringSnapshotRef: MonitoringSnapshotRefV1,
  ): Promise<DataCleaningFrozenMonitoringV1["availability"] | undefined> {
    const row = await this.#db
      .selectFrom("business.monitoring_snapshots")
      .select(["availability"])
      .where("project_id", "=", projectId)
      .where("snapshot_id", "=", monitoringSnapshotRef.reference.entityId)
      .where("version_id", "=", monitoringSnapshotRef.reference.versionId)
      .executeTakeFirst();
    if (row === undefined) return undefined;
    return DataCleaningAvailabilityV1Schema.parse(row.availability);
  }

  async #putContent(
    context: CleaningCommandContext,
    spec: Omit<ArtifactSpec, "artifactKind">,
  ): Promise<ContentArtifactRefV1> {
    const result = await this.#put(context, { ...spec, artifactKind: "content" });
    return ContentArtifactRefV1Schema.parse(result);
  }

  async #putDiagnostic(
    context: CleaningCommandContext,
    spec: Omit<ArtifactSpec, "artifactKind">,
  ): Promise<ArtifactRefV1> {
    return ArtifactRefV1Schema.parse(
      await this.#put(context, { ...spec, artifactKind: "diagnostic" }),
    );
  }

  async #put(context: CleaningCommandContext, spec: ArtifactSpec): Promise<ArtifactRefV1> {
    const bytes = new TextEncoder().encode(canonicalJson(spec.value));
    // C04 要求父工件引用按 (kind/entityId/versionId) 规范排序且不重复。
    const parentArtifactRefs = [...spec.parentArtifactRefs]
      .sort((left, right) => (artifactSortKey(left) < artifactSortKey(right) ? -1 : 1))
      .filter(
        (ref, index, all) =>
          index === 0 || artifactSortKey(ref) !== artifactSortKey(all[index - 1]!),
      );
    const result = await this.#artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: SCHEMA_VERSION,
        commandId: `${spec.artifactId}:put`,
        idempotencyKey: `${spec.artifactId}:put`,
        projectId: context.projectId,
        actorId: context.actorId,
        issuedAt: context.issuedAt,
        authorization: context.authorization,
        requiredCapability: FREEZE_CAPABILITY,
        artifactId: spec.artifactId,
        artifactKind: spec.artifactKind,
        purposeCode: spec.purposeCode,
        mediaType: "application/json",
        parentArtifactRefs,
        evidenceReferences: [],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      }),
      one(bytes),
    );
    return result.artifactRef;
  }

  async #readJson(
    taskRef: AgentTaskRefV1,
    artifactRefValue: ContentArtifactRefV1,
    authorization: EngineeringFreezeCommandV1["authorization"],
    purposeCode: string,
    maxBytes: number,
  ): Promise<unknown> {
    return JSON.parse(
      await this.#readBytes(taskRef, artifactRefValue, authorization, purposeCode, maxBytes),
    ) as unknown;
  }

  async #readBytes(
    taskRef: AgentTaskRefV1,
    artifactRefValue: ContentArtifactRefV1,
    authorization: EngineeringFreezeCommandV1["authorization"],
    purposeCode: string,
    maxBytes: number,
  ): Promise<string> {
    const handle: ArtifactReadHandleV1 = await this.#artifactStore.open(
      ArtifactReadRequestV1Schema.parse({
        schemaVersion: SCHEMA_VERSION,
        requestId: `${taskRef.reference.entityId}:${purposeCode}:read`,
        idempotencyKey: `${taskRef.reference.entityId}:${purposeCode}:read`,
        artifactRef: artifactRefValue,
        projectId: authorization.projectId,
        actorId: authorization.actorId,
        requestedAt: authorization.decidedAt,
        purposeCode,
        requiredCapability: FREEZE_CAPABILITY,
        authorization,
      }),
    );
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of handle.content) {
      size += chunk.byteLength;
      if (size > maxBytes || size > MAX_OBSERVATION_BYTES) {
        throw new RangeError("frozen artifact exceeds the bounded read limit");
      }
      chunks.push(chunk);
    }
    await handle.verified;
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(buffer);
  }

  #mapError(error: unknown, causalRunId: string): Record<string, unknown> {
    const accessFailure = resolveAccessFailure(error);
    if (accessFailure !== undefined) {
      if (accessFailure.details.code === "AUTHORIZATION_DENIED") {
        return moduleError("AUTHORIZATION_DENIED", causalRunId);
      }
      if (accessFailure.details.code === "IDEMPOTENCY_CONFLICT") {
        return moduleError("IDEMPOTENCY_CONFLICT", causalRunId);
      }
      return moduleError(
        accessFailure.details.retryable ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE",
        causalRunId,
      );
    }
    const declared =
      error instanceof Error
        ? (error as Error & { dataCleaningError?: Record<string, unknown> }).dataCleaningError
        : undefined;
    if (declared !== undefined) return declared;
    const accessError =
      error instanceof Error ? (error as Error & { accessError?: unknown }).accessError : undefined;
    if (accessError instanceof AccessServiceError) {
      if (accessError.details.code === "AUTHORIZATION_DENIED") {
        return moduleError("AUTHORIZATION_DENIED", causalRunId);
      }
      if (accessError.details.code === "IDEMPOTENCY_CONFLICT") {
        return moduleError("IDEMPOTENCY_CONFLICT", causalRunId);
      }
      return moduleError(
        accessError.details.retryable ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE",
        causalRunId,
      );
    }
    if (
      error instanceof Error &&
      (error as Error & { persistenceError?: { retryable?: boolean } }).persistenceError !==
        undefined
    ) {
      const retryable = (error as Error & { persistenceError: { retryable?: boolean } })
        .persistenceError.retryable;
      return moduleError(
        retryable === true ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE",
        causalRunId,
      );
    }
    return moduleError("TRANSIENT_FAILURE", causalRunId);
  }
}

interface ArtifactSpec {
  readonly artifactId: string;
  readonly artifactKind: "content" | "diagnostic";
  readonly purposeCode: string;
  readonly value: unknown;
  readonly parentArtifactRefs: readonly ArtifactRefV1[];
}

const taskContext = (task: AgentTaskSnapshotV1): CleaningCommandContext => ({
  commandId: task.envelope.commandId,
  idempotencyKey: task.envelope.idempotencyKey,
  projectId: task.envelope.projectId,
  actorId: task.envelope.actorId,
  issuedAt: task.envelope.createdAt,
  authorization: task.envelope.authorization as EngineeringFreezeCommandV1["authorization"],
});

const atomicCommandFor = (
  context: CleaningCommandContext,
  commandKind: string,
  payload: Record<string, unknown>,
) => ({
  projectId: context.projectId,
  commandKind,
  commandId: context.commandId,
  idempotencyKey: context.idempotencyKey,
  payload: JSON.parse(JSON.stringify(payload)) as never,
  actorRef: context.actorId,
  authorizationContextRef: context.authorization.authorizationContextRef,
  issuedAt: context.issuedAt,
});

export const createPostgresDataCleaningStore = (
  options: PostgresDataCleaningStoreOptions,
): PostgresDataCleaningStore => new PostgresDataCleaningStore(options);
