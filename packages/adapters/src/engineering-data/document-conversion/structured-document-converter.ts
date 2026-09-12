import { sql, type InsertObject, type Kysely, type Transaction } from "kysely";

import {
  ArtifactPutCommandV1Schema,
  ArtifactReadRequestV1Schema,
  type ArtifactPutResultV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  convertParsedDocument,
  DocumentConversionValidationError,
  type DocumentConversionStrategyV1,
  type NormalizedDocumentResultV1,
} from "@riskflow/core/engineering-data/document-conversion";
import {
  type EngineeringContextSourceRegistryV1,
  type ContextSourceResultV1,
  type SourceProcessingInputV1,
  type SourceSegmentV1,
  type ResolveSourceProcessingInputQueryV1,
  type ResolveSourceVersionForReadQueryV1,
  ResolveSourceProcessingInputQueryV1Schema,
  ResolveSourceVersionForReadQueryV1Schema,
  SourceSegmentIdV1Schema,
} from "@riskflow/core/engineering-data/context-source";
import {
  AtomicCommandV1Schema,
  type AtomicCommitV1,
  type AtomicCommandV1,
  type JsonValue,
  type TransactionUnitV1,
  sha256CanonicalJson,
} from "@riskflow/core/persistence";
import {
  ContentArtifactRefV1Schema,
  DiagnosticArtifactRefV1Schema,
  ModuleErrorV1Schema,
  StructuredDocumentConversionCommandV1Schema,
  StructuredDocumentConversionQueryV1Schema,
  StructuredDocumentConversionReadResultV1Schema,
  StructuredDocumentConversionRecordV1Schema,
  StructuredDocumentConversionResultV1Schema,
  StructuredDocumentConversionRefV1Schema,
  type ContentArtifactRefV1,
  type DiagnosticArtifactRefV1,
  type ModuleErrorV1,
  type StructuredDocumentConversionCommandV1,
  type StructuredDocumentConversionPortV1,
  type StructuredDocumentConversionQueryV1,
  type StructuredDocumentConversionReadResultV1,
  type StructuredDocumentConversionRecordV1,
  type StructuredDocumentConversionResultV1,
} from "@riskflow/contracts/ports";
import type { EvidenceReference } from "@riskflow/contracts/common";
import { getPostgresTransaction } from "../../postgres/transaction-unit.js";
import type { PostgresDatabase } from "../../postgres/types.js";
import {
  DEFAULT_DOCUMENT_CONVERSION_RESOURCE_POLICY_V1,
  DocumentParserError,
  parseResourcePolicy,
  type DocumentConversionResourcePolicyV1,
  type DocumentParserContextV1,
} from "./schema.js";
import { parseStructuredDocument } from "./parsers.js";

type JsonColumn = JsonValue;
type Timestamp = Date | string;

type ConversionRow = {
  schema_version: string;
  conversion_id: string;
  version_id: string;
  project_id: string;
  command_kind: string;
  source_version_ref: JsonColumn;
  source_artifact_ref: JsonColumn;
  input_kind: "docx" | "text-pdf" | "xlsx" | "csv" | "ocr-layout";
  media_type: string;
  conversion_policy_ref: JsonColumn;
  quality_policy_ref: JsonColumn;
  converter_deployment_ref: JsonColumn;
  parser_set_version: string;
  status: "succeeded" | "failed";
  jsonld_artifact_ref: JsonColumn | null;
  source_segment_set_ref: JsonColumn | null;
  diagnostic_ref: JsonColumn | null;
  authorization_policy_ref: JsonColumn;
  command_id: string;
  idempotency_key: string;
  actor_id: string;
  run_id: string;
  thread_id: string;
  statistics: JsonColumn;
  started_at: Timestamp;
  completed_at: Timestamp;
  audit_entry_id: string;
  created_at: Timestamp;
};

type ConversionDatabase = PostgresDatabase & {
  "business.structured_document_conversions": ConversionRow;
};
type ConversionTransaction = Transaction<ConversionDatabase>;

const COMMAND_KIND = "engineering-data.structured-document-conversion.v1";
const recordCommandId = (conversionId: string): string => `${conversionId}:record`;
const recordAuditEntryId = (conversionId: string): string => `audit-record-${conversionId}`;
const PURPOSE = "engineering-data.structured-document-conversion";
const SCHEMA_VERSION = "1" as const;

const jsonValue = (value: unknown): JsonValue => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("value is not JSON serializable");
  return serialized as JsonValue;
};

const referenceKey = (value: {
  kind: string;
  reference: { entityId: string; versionId: string };
}): string => `${value.kind}/${value.reference.entityId}/${value.reference.versionId}`;

const versionKey = (value: { entityId: string; versionId: string }): string =>
  `${value.entityId}/${value.versionId}`;

const sameVersion = (
  left: { entityId: string; versionId: string },
  right: { entityId: string; versionId: string },
): boolean => versionKey(left) === versionKey(right);

const iso = (clock: () => Date): string => {
  const value = clock();
  if (Number.isNaN(value.getTime())) throw new TypeError("clock returned an invalid date");
  return value.toISOString();
};

const asIso = (value: Timestamp): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const staticDiagnosticRef = (conversionId: string): DiagnosticArtifactRefV1 =>
  DiagnosticArtifactRefV1Schema.parse({
    kind: "diagnostic-artifact",
    reference: { entityId: `conversion-diagnostic-${conversionId}`, versionId: "1" },
  });

const moduleError = (
  code: "TERMINAL_FAILURE" | "TRANSIENT_FAILURE" | "BUSINESS_BLOCKED",
  causalRunId: string,
  diagnosticRef?: DiagnosticArtifactRefV1,
): ModuleErrorV1 => {
  if (code === "BUSINESS_BLOCKED") {
    return ModuleErrorV1Schema.parse({
      stageCode: "engineering-data.document-conversion",
      occurredAt: new Date().toISOString(),
      causalRunId,
      code,
      category: "business-blocked",
      retryable: false,
      blockerKind: "structured-document-conversion",
      blockerRef: {
        kind: "structured-document-conversion",
        reference: { entityId: causalRunId, versionId: "1" },
      },
    });
  }
  const ref = diagnosticRef ?? staticDiagnosticRef(causalRunId);
  return ModuleErrorV1Schema.parse({
    stageCode: "engineering-data.document-conversion",
    occurredAt: new Date().toISOString(),
    causalRunId,
    code,
    category: "technical",
    retryable: code === "TRANSIENT_FAILURE",
    ...(code === "TRANSIENT_FAILURE"
      ? {
          attempt: 1,
          retryPolicyRef: { entityId: "document-conversion-retry-policy", versionId: "1" },
          diagnosticRef: ref,
        }
      : { diagnosticRef: ref }),
  });
};

const failed = (error: ModuleErrorV1): StructuredDocumentConversionResultV1 =>
  StructuredDocumentConversionResultV1Schema.parse({ kind: "failed", error });

const sourceInputFromResult = (
  result: ContextSourceResultV1,
): SourceProcessingInputV1 | ModuleErrorV1 => {
  if (result.kind === "failed") return result.error;
  if (result.result.kind !== "source-processing-input") {
    return ModuleErrorV1Schema.parse({
      stageCode: "engineering-data.document-conversion.source",
      occurredAt: new Date().toISOString(),
      causalRunId: "source-processing-input",
      code: "TERMINAL_FAILURE",
      category: "technical",
      retryable: false,
      diagnosticRef: staticDiagnosticRef("source-processing-input"),
    });
  }
  return result.result.input;
};

const toEvidenceReferences = (
  sourceVersionRef: SourceProcessingInputV1["sourceVersionRef"],
  segments: readonly { sourceSegmentId: string }[],
): EvidenceReference[] =>
  [...segments]
    .map((segment) => ({
      locator: { sourceSegmentId: segment.sourceSegmentId },
      sourceVersion: sourceVersionRef.reference,
    }))
    .sort((left, right) => {
      const leftKey = `${left.locator.sourceSegmentId}/${versionKey(left.sourceVersion)}`;
      const rightKey = `${right.locator.sourceSegmentId}/${versionKey(right.sourceVersion)}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });

const toSourceSegments = (result: NormalizedDocumentResultV1): SourceSegmentV1[] =>
  result.document.sourceSegments.map((segment) => ({
    sourceSegmentId: SourceSegmentIdV1Schema.parse(segment.sourceSegmentId),
    chapterId: segment.chapterId,
    segmentId: segment.segmentId,
    kind: segment.kind,
    spatialScopeRefs: segment.spatialScopeRefs,
    locator: segment.locator,
  }));

async function* one(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

const artifactCommand = (
  command: StructuredDocumentConversionCommandV1,
  source: SourceProcessingInputV1,
  artifactId: string,
  artifactKind: "content" | "diagnostic",
  mediaType: string,
  parentArtifactRefs: readonly ContentArtifactRefV1[],
  evidenceReferences: readonly EvidenceReference[],
): Parameters<ArtifactStoreV1["put"]>[0] => {
  const parents = [...parentArtifactRefs].sort((left, right) =>
    referenceKey(left).localeCompare(referenceKey(right)),
  );
  const evidence = [...evidenceReferences].sort((left, right) => {
    const leftKey = `${left.locator.sourceSegmentId}/${versionKey(left.sourceVersion)}`;
    const rightKey = `${right.locator.sourceSegmentId}/${versionKey(right.sourceVersion)}`;
    return leftKey.localeCompare(rightKey);
  });
  const spatialScopeRefs = [...command.authorization.spatialScopeRefs].sort((left, right) =>
    referenceKey(left).localeCompare(referenceKey(right)),
  );
  const sourceAccessGrantRefs = [...command.authorization.sourceAccessGrantRefs];
  return ArtifactPutCommandV1Schema.parse({
    schemaVersion: SCHEMA_VERSION,
    commandId: `${command.conversionId}:${artifactKind}`,
    idempotencyKey: `${command.idempotencyKey}:${artifactKind}`,
    projectId: command.projectId,
    actorId: command.actorId,
    issuedAt: command.issuedAt,
    authorization: command.authorization,
    requiredCapability: "engineering-data.write",
    artifactId,
    artifactKind,
    purposeCode: PURPOSE,
    mediaType,
    parentArtifactRefs: parents,
    evidenceReferences: evidence,
    additionalSpatialScopeRefs: spatialScopeRefs,
    additionalSourceAccessGrantRefs: sourceAccessGrantRefs,
  });
};

const auditTrailRef = (auditEntryId: string) => ({
  kind: "audit-trail" as const,
  reference: { entityId: auditEntryId, versionId: "1" },
});

const atomicCommand = (
  command: StructuredDocumentConversionCommandV1,
  payload: object,
  commandId = command.conversionId,
): AtomicCommandV1 =>
  AtomicCommandV1Schema.parse({
    projectId: command.projectId,
    commandKind: COMMAND_KIND,
    commandId,
    idempotencyKey: command.idempotencyKey,
    payload: JSON.parse(JSON.stringify(payload)) as Record<string, JsonValue>,
    actorRef: command.actorId,
    authorizationContextRef: command.authorization.authorizationContextRef,
    issuedAt: command.issuedAt,
    runId: command.runId,
    threadId: command.threadId,
  });

const conversionCommit = (
  command: StructuredDocumentConversionCommandV1,
  record: StructuredDocumentConversionRecordV1,
): AtomicCommitV1 => ({
  resultRef: record.conversionRef,
  audit: {
    auditEntryId: record.auditTrailRef.reference.entityId,
    projectId: command.projectId,
    action: PURPOSE,
    targetRef: record.conversionRef,
    actorRef: command.actorId,
    authorizationContextRef: command.authorization.authorizationContextRef,
    occurredAt: command.issuedAt,
    recordedAt: record.completedAt,
    version: record.conversionRef.reference,
    commandId: record.commandId,
    idempotencyKey: command.idempotencyKey,
    runId: command.runId,
    threadId: command.threadId,
  },
  events: [],
});

const rowToRecord = (row: ConversionRow): StructuredDocumentConversionRecordV1 => {
  if (row.schema_version !== SCHEMA_VERSION || row.command_kind !== COMMAND_KIND) {
    throw new Error("unsupported structured document conversion row version");
  }
  return StructuredDocumentConversionRecordV1Schema.parse({
    schemaVersion: SCHEMA_VERSION,
    conversionRef: StructuredDocumentConversionRefV1Schema.parse({
      kind: "structured-document-conversion",
      reference: { entityId: row.conversion_id, versionId: row.version_id },
    }),
    projectId: row.project_id,
    sourceVersionRef: row.source_version_ref,
    sourceArtifactRef: row.source_artifact_ref,
    input: { kind: row.input_kind },
    mediaType: row.media_type,
    conversionPolicyRef: row.conversion_policy_ref,
    qualityPolicyRef: row.quality_policy_ref,
    converterDeploymentRef: row.converter_deployment_ref,
    status: row.status,
    statistics: row.statistics,
    ...(row.jsonld_artifact_ref === null ? {} : { jsonLdArtifactRef: row.jsonld_artifact_ref }),
    ...(row.source_segment_set_ref === null
      ? {}
      : { sourceSegmentSetRef: row.source_segment_set_ref }),
    ...(row.diagnostic_ref === null ? {} : { diagnosticRef: row.diagnostic_ref }),
    authorizationPolicyRef: row.authorization_policy_ref,
    commandId: row.command_id,
    idempotencyKey: row.idempotency_key,
    actorId: row.actor_id,
    runId: row.run_id,
    threadId: row.thread_id,
    startedAt: asIso(row.started_at),
    completedAt: asIso(row.completed_at),
    auditTrailRef: auditTrailRef(row.audit_entry_id),
  });
};

type ExistingConversion =
  | { record?: StructuredDocumentConversionRecordV1; conflict?: false }
  | { conflict: true; error: ModuleErrorV1 };

export interface StructuredDocumentConversionAdapterOptionsV1 {
  readonly db?: Kysely<PostgresDatabase>;
  readonly transactionUnit?: TransactionUnitV1;
  readonly contextSource: EngineeringContextSourceRegistryV1;
  readonly artifactStore: ArtifactStoreV1;
  readonly resourcePolicy?: DocumentConversionResourcePolicyV1;
  readonly qualityPolicyRef: StructuredDocumentConversionCommandV1["qualityPolicyRef"];
  readonly converterDeploymentRef: StructuredDocumentConversionCommandV1["converterDeploymentRef"];
  readonly now?: () => Date;
}

export class StructuredDocumentConversionAdapter implements StructuredDocumentConversionPortV1 {
  readonly #db: Kysely<ConversionDatabase> | undefined;
  readonly #transactionUnit: TransactionUnitV1 | undefined;
  readonly #contextSource: EngineeringContextSourceRegistryV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #policy: DocumentConversionResourcePolicyV1;
  readonly #qualityPolicyRef: StructuredDocumentConversionCommandV1["qualityPolicyRef"];
  readonly #converterDeploymentRef: StructuredDocumentConversionCommandV1["converterDeploymentRef"];
  readonly #now: () => Date;
  readonly #memoryRecords = new Map<
    string,
    { hash: string; record: StructuredDocumentConversionRecordV1 }
  >();

  constructor(options: StructuredDocumentConversionAdapterOptionsV1) {
    this.#db = options.db as Kysely<ConversionDatabase> | undefined;
    this.#transactionUnit = options.transactionUnit;
    this.#contextSource = options.contextSource;
    this.#artifactStore = options.artifactStore;
    this.#qualityPolicyRef = options.qualityPolicyRef;
    this.#converterDeploymentRef = options.converterDeploymentRef;
    this.#policy = parseResourcePolicy(
      options.resourcePolicy ?? DEFAULT_DOCUMENT_CONVERSION_RESOURCE_POLICY_V1,
    );
    this.#now = options.now ?? (() => new Date());
    if ((this.#db === undefined) !== (this.#transactionUnit === undefined)) {
      throw new TypeError("document conversion db and transactionUnit must be provided together");
    }
  }

  async convert(
    request: StructuredDocumentConversionCommandV1,
  ): Promise<StructuredDocumentConversionResultV1> {
    const parsed = StructuredDocumentConversionCommandV1Schema.safeParse(request);
    if (!parsed.success) {
      return failed(
        ModuleErrorV1Schema.parse({
          stageCode: "engineering-data.document-conversion.contract",
          occurredAt: new Date().toISOString(),
          causalRunId: "structured-document-conversion",
          code: "UNSUPPORTED_CONTRACT",
          category: "technical",
          retryable: false,
          schemaVersion: SCHEMA_VERSION,
        }),
      );
    }
    const command = parsed.data;
    if (
      !sameVersion(command.conversionPolicyRef, this.#policy.policyRef) ||
      !sameVersion(command.qualityPolicyRef, this.#qualityPolicyRef) ||
      !sameVersion(command.converterDeploymentRef, this.#converterDeploymentRef)
    ) {
      return failed(moduleError("BUSINESS_BLOCKED", command.runId));
    }
    const sourceQuery: ResolveSourceProcessingInputQueryV1 =
      ResolveSourceProcessingInputQueryV1Schema.parse({
        queryId: command.conversionId,
        projectId: command.projectId,
        actorId: command.actorId,
        requestedAt: command.issuedAt,
        authorization: command.authorization,
        sourceVersionRef: command.sourceVersionRef,
      });
    let source: SourceProcessingInputV1;
    try {
      const sourceResult = sourceInputFromResult(
        await this.#contextSource.resolveSourceProcessingInput(sourceQuery),
      );
      if ("code" in sourceResult) return failed(sourceResult);
      source = sourceResult;
    } catch {
      return failed(moduleError("TERMINAL_FAILURE", command.runId));
    }
    if (
      referenceKey(source.sourceArtifactRef) !== referenceKey(command.sourceArtifactRef) ||
      referenceKey(source.sourceVersionRef) !== referenceKey(command.sourceVersionRef)
    ) {
      return failed(moduleError("BUSINESS_BLOCKED", command.runId));
    }

    let existing: ExistingConversion;
    try {
      existing = await this.#readExisting(command);
    } catch {
      return failed(moduleError("TRANSIENT_FAILURE", command.runId));
    }
    if (existing.conflict === true) return failed(existing.error);
    if (existing.record !== undefined) {
      if (
        existing.record.status !== "succeeded" ||
        existing.record.jsonLdArtifactRef === undefined ||
        existing.record.sourceSegmentSetRef === undefined
      ) {
        return failed(
          moduleError("TERMINAL_FAILURE", command.runId, existing.record.diagnosticRef),
        );
      }
      return existing.record.status === "succeeded"
        ? StructuredDocumentConversionResultV1Schema.parse({
            kind: "succeeded",
            result: {
              conversionRef: existing.record.conversionRef,
              jsonLdArtifactRef: existing.record.jsonLdArtifactRef,
              sourceSegmentSetRef: existing.record.sourceSegmentSetRef,
            },
          })
        : failed(moduleError("TERMINAL_FAILURE", command.runId, existing.record.diagnosticRef));
    }

    const startedAt = iso(this.#now);
    let bytes: Uint8Array;
    try {
      bytes = await this.#readInput(command, source);
    } catch (error) {
      return this.#finishFailure(command, source, startedAt, "input", error);
    }

    let converted: NormalizedDocumentResultV1;
    try {
      const context: DocumentParserContextV1 = {
        source,
        inputKind: command.input.kind,
        mediaType: command.mediaType,
      };
      const parsedDocument = await parseStructuredDocument(bytes, context, this.#policy);
      const strategy: DocumentConversionStrategyV1 = {
        strategyVersion: [
          command.conversionPolicyRef,
          command.qualityPolicyRef,
          command.converterDeploymentRef,
        ]
          .map((reference) => `${reference.entityId}@${reference.versionId}`)
          .join("|"),
      };
      converted = convertParsedDocument(parsedDocument, strategy);
      if (converted.document.textBlocks.length > this.#policy.maxOutputBlocks) {
        throw new DocumentParserError(
          "OUTPUT_LIMIT_EXCEEDED",
          "normalized document exceeds policy output block limit",
        );
      }
    } catch (error) {
      return this.#finishFailure(command, source, startedAt, "parse", error, [], bytes.byteLength);
    }

    const evidenceReferences = toEvidenceReferences(
      source.sourceVersionRef,
      converted.document.sourceSegments,
    );
    let jsonLdArtifact: ArtifactPutResultV1;
    try {
      const bytesOut = new TextEncoder().encode(JSON.stringify(converted.jsonLd));
      const putCommand = artifactCommand(
        command,
        source,
        `conversion-${command.conversionId}`,
        "content",
        "application/ld+json",
        [source.sourceArtifactRef],
        evidenceReferences,
      );
      jsonLdArtifact = await this.#artifactStore.put(putCommand, one(bytesOut));
    } catch (error) {
      return this.#finishFailure(command, source, startedAt, "output", error, [], bytes.byteLength);
    }

    const segmentCommand = {
      commandId: command.conversionId,
      idempotencyKey: `${command.idempotencyKey}:segments`,
      projectId: command.projectId,
      actorId: command.actorId,
      issuedAt: command.issuedAt,
      authorization: command.authorization,
      sourceVersionRef: source.sourceVersionRef,
      sourceId: source.sourceId,
      segments: toSourceSegments(converted),
    };
    let segmentResult: ContextSourceResultV1;
    try {
      segmentResult = await this.#contextSource.registerSegments(segmentCommand);
    } catch (error) {
      return this.#finishFailure(
        command,
        source,
        startedAt,
        "segments",
        error,
        [ContentArtifactRefV1Schema.parse(jsonLdArtifact.artifactRef)],
        bytes.byteLength,
      );
    }
    if (segmentResult.kind === "failed") {
      return this.#finishFailure(
        command,
        source,
        startedAt,
        "segments",
        segmentResult.error,
        [ContentArtifactRefV1Schema.parse(jsonLdArtifact.artifactRef)],
        bytes.byteLength,
      );
    }
    if (segmentResult.result.kind !== "source-segment-set") {
      return this.#finishFailure(
        command,
        source,
        startedAt,
        "segments",
        new Error("source segment registration returned an unexpected result"),
        [ContentArtifactRefV1Schema.parse(jsonLdArtifact.artifactRef)],
        bytes.byteLength,
      );
    }

    const completedAt = iso(this.#now);
    const record = StructuredDocumentConversionRecordV1Schema.parse({
      schemaVersion: SCHEMA_VERSION,
      conversionRef: {
        kind: "structured-document-conversion",
        reference: { entityId: command.conversionId, versionId: "1" },
      },
      projectId: command.projectId,
      sourceVersionRef: source.sourceVersionRef,
      sourceArtifactRef: source.sourceArtifactRef,
      input: command.input,
      mediaType: command.mediaType,
      conversionPolicyRef: command.conversionPolicyRef,
      qualityPolicyRef: command.qualityPolicyRef,
      converterDeploymentRef: command.converterDeploymentRef,
      status: "succeeded",
      statistics: {
        ...converted.document.statistics,
        durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      },
      jsonLdArtifactRef: ContentArtifactRefV1Schema.parse(jsonLdArtifact.artifactRef),
      sourceSegmentSetRef: segmentResult.result.segmentSet.sourceSegmentSetRef,
      authorizationPolicyRef: command.authorization.authorizationPolicyRef,
      commandId: recordCommandId(command.conversionId),
      idempotencyKey: command.idempotencyKey,
      runId: command.runId,
      threadId: command.threadId,
      actorId: command.actorId,
      startedAt,
      completedAt,
      auditTrailRef: auditTrailRef(recordAuditEntryId(command.conversionId)),
    });
    try {
      const persisted = await this.#persist(command, record);
      return StructuredDocumentConversionResultV1Schema.parse({
        kind: "succeeded",
        result: {
          conversionRef: persisted.conversionRef,
          jsonLdArtifactRef: persisted.jsonLdArtifactRef,
          sourceSegmentSetRef: persisted.sourceSegmentSetRef,
        },
      });
    } catch {
      return failed(moduleError("TRANSIENT_FAILURE", command.runId));
    }
  }

  async read(
    query: StructuredDocumentConversionQueryV1,
  ): Promise<StructuredDocumentConversionReadResultV1> {
    const parsed = StructuredDocumentConversionQueryV1Schema.safeParse(query);
    if (!parsed.success) {
      return StructuredDocumentConversionReadResultV1Schema.parse({
        kind: "failed",
        error: ModuleErrorV1Schema.parse({
          stageCode: "engineering-data.document-conversion.contract",
          occurredAt: new Date().toISOString(),
          causalRunId: "structured-document-conversion-read",
          code: "UNSUPPORTED_CONTRACT",
          category: "technical",
          retryable: false,
          schemaVersion: SCHEMA_VERSION,
        }),
      });
    }
    const valid = parsed.data;
    const denied = StructuredDocumentConversionReadResultV1Schema.parse({
      kind: "failed",
      error: {
        stageCode: "engineering-data.document-conversion.read",
        occurredAt: new Date().toISOString(),
        causalRunId: valid.queryId,
        code: "AUTHORIZATION_DENIED",
        category: "authorization",
        retryable: false,
        requiredCapability: "engineering-data.read",
        authorizationPolicyRef: valid.authorization.authorizationPolicyRef,
      },
    });
    let record: StructuredDocumentConversionRecordV1 | undefined;
    try {
      record = await this.#readByRef(valid.projectId, valid.conversionRef);
    } catch {
      return StructuredDocumentConversionReadResultV1Schema.parse({
        kind: "failed",
        error: moduleError("TRANSIENT_FAILURE", valid.queryId),
      });
    }
    if (record === undefined || record.sourceVersionRef === undefined) {
      return denied;
    }
    let authorizationResult: ContextSourceResultV1;
    try {
      const authorizationQuery: ResolveSourceVersionForReadQueryV1 =
        ResolveSourceVersionForReadQueryV1Schema.parse({
          queryId: valid.queryId,
          projectId: valid.projectId,
          actorId: valid.actorId,
          requestedAt: valid.requestedAt,
          authorization: valid.authorization,
          sourceVersionRef: record.sourceVersionRef,
        });
      authorizationResult =
        await this.#contextSource.resolveSourceVersionForRead(authorizationQuery);
    } catch {
      return StructuredDocumentConversionReadResultV1Schema.parse({
        kind: "failed",
        error: moduleError("TRANSIENT_FAILURE", valid.queryId),
      });
    }
    if (authorizationResult.kind === "failed") {
      if (authorizationResult.error.code === "AUTHORIZATION_DENIED") return denied;
      return StructuredDocumentConversionReadResultV1Schema.parse(authorizationResult);
    }
    return StructuredDocumentConversionReadResultV1Schema.parse({
      kind: "succeeded",
      result: { conversion: record },
    });
  }

  async #readInput(
    command: StructuredDocumentConversionCommandV1,
    source: SourceProcessingInputV1,
  ): Promise<Uint8Array> {
    const request = ArtifactReadRequestV1Schema.parse({
      schemaVersion: SCHEMA_VERSION,
      requestId: `${command.conversionId}:input`,
      idempotencyKey: `${command.idempotencyKey}:input`,
      artifactRef: source.sourceArtifactRef,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.issuedAt,
      purposeCode: "engineering-data.register-source-delivery",
      requiredCapability: "engineering-data.write",
      authorization: command.authorization,
    });
    const handle = await this.#artifactStore.open(request);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of handle.content) {
      if (!(chunk instanceof Uint8Array))
        throw new DocumentParserError("ARTIFACT_INVALID", "input artifact chunk is invalid");
      size += chunk.byteLength;
      if (size > this.#policy.maxInputBytes)
        throw new DocumentParserError(
          "INPUT_LIMIT_EXCEEDED",
          "input exceeds policy limit",
          false,
          undefined,
          size,
        );
      chunks.push(chunk);
    }
    await handle.verified;
    if (referenceKey(handle.manifest.artifactRef) !== referenceKey(source.sourceArtifactRef)) {
      throw new DocumentParserError(
        "ARTIFACT_REFERENCE_INVALID",
        "input artifact reference mismatch",
        false,
        undefined,
        size,
      );
    }
    if (handle.manifest.mediaType !== command.mediaType) {
      throw new DocumentParserError(
        "MEDIA_TYPE_UNSUPPORTED",
        "input artifact media type mismatch",
        false,
        undefined,
        size,
      );
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  async #finishFailure(
    command: StructuredDocumentConversionCommandV1,
    source: SourceProcessingInputV1,
    startedAt: string,
    stage: string,
    reason: unknown,
    parents: readonly ContentArtifactRefV1[] = [],
    inputBytes = 0,
  ): Promise<StructuredDocumentConversionResultV1> {
    let diagnosticRef: DiagnosticArtifactRefV1 | undefined;
    try {
      const complianceIssue =
        reason instanceof DocumentConversionValidationError ? reason.report.issues[0] : undefined;
      const reasonCode =
        reason instanceof DocumentParserError
          ? reason.code
          : (complianceIssue?.code ??
            (typeof reason === "object" && reason !== null && "code" in reason
              ? String((reason as { code: unknown }).code)
              : "CONVERSION_FAILED"));
      const retryable =
        reason instanceof DocumentParserError
          ? reason.retryable
          : typeof reason === "object" && reason !== null && "retryable" in reason
            ? Boolean((reason as { retryable?: unknown }).retryable)
            : false;
      const failureReason = reason instanceof Error ? reason.message : reasonCode;
      const detail = {
        schemaVersion: SCHEMA_VERSION,
        stage,
        reasonCode,
        failureReason,
        retryable,
        ...(reasonCode.includes("LIMIT") ? { limitCode: reasonCode } : {}),
        inputBytes:
          inputBytes > 0
            ? inputBytes
            : reason instanceof DocumentParserError
              ? (reason.observedBytes ?? 0)
              : 0,
        inputKind: command.input.kind,
        sourceVersionRef: source.sourceVersionRef,
        sourceSegmentId:
          reason instanceof DocumentParserError
            ? reason.sourceSegmentId
            : complianceIssue?.sourceSegmentId,
      };
      const bytes = new TextEncoder().encode(JSON.stringify(detail));
      const parentRefs = [source.sourceArtifactRef, ...parents];
      const evidence = toEvidenceReferences(source.sourceVersionRef, []);
      const result = await this.#artifactStore.put(
        artifactCommand(
          command,
          source,
          `conversion-diagnostic-${command.conversionId}`,
          "diagnostic",
          "application/json",
          parentRefs,
          evidence,
        ),
        one(bytes),
      );
      diagnosticRef = DiagnosticArtifactRefV1Schema.parse(result.artifactRef);
    } catch {
      diagnosticRef = undefined;
    }
    if (diagnosticRef === undefined) {
      return failed(moduleError("TRANSIENT_FAILURE", command.runId));
    }
    const error = moduleError("TERMINAL_FAILURE", command.runId, diagnosticRef);
    const completedAt = iso(this.#now);
    const record = StructuredDocumentConversionRecordV1Schema.parse({
      schemaVersion: SCHEMA_VERSION,
      conversionRef: {
        kind: "structured-document-conversion",
        reference: { entityId: command.conversionId, versionId: "1" },
      },
      projectId: command.projectId,
      sourceVersionRef: source.sourceVersionRef,
      sourceArtifactRef: source.sourceArtifactRef,
      input: command.input,
      mediaType: command.mediaType,
      conversionPolicyRef: command.conversionPolicyRef,
      qualityPolicyRef: command.qualityPolicyRef,
      converterDeploymentRef: command.converterDeploymentRef,
      status: "failed",
      statistics: {
        inputBytes:
          inputBytes > 0
            ? inputBytes
            : reason instanceof DocumentParserError
              ? (reason.observedBytes ?? 0)
              : 0,
        outputBytes: 0,
        textBlockCount: 0,
        sourceSegmentCount: 0,
        pageCount: 0,
        tableCount: 0,
        cellCount: 0,
        durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
        ...(reason instanceof DocumentParserError && reason.code.includes("LIMIT")
          ? { limitCode: reason.code }
          : {}),
      },
      ...(diagnosticRef === undefined ? {} : { diagnosticRef }),
      authorizationPolicyRef: command.authorization.authorizationPolicyRef,
      commandId: recordCommandId(command.conversionId),
      idempotencyKey: command.idempotencyKey,
      runId: command.runId,
      threadId: command.threadId,
      actorId: command.actorId,
      startedAt,
      completedAt,
      auditTrailRef: auditTrailRef(recordAuditEntryId(command.conversionId)),
    });
    try {
      await this.#persist(command, record);
    } catch {
      return failed(moduleError("TRANSIENT_FAILURE", command.runId, diagnosticRef));
    }
    return failed(error);
  }

  async #persist(
    command: StructuredDocumentConversionCommandV1,
    record: StructuredDocumentConversionRecordV1,
  ): Promise<StructuredDocumentConversionRecordV1> {
    const key = `${command.projectId}\u0000${COMMAND_KIND}\u0000${command.idempotencyKey}`;
    const hash = sha256CanonicalJson(command);
    if (this.#db === undefined || this.#transactionUnit === undefined) {
      const prior = this.#memoryRecords.get(key);
      if (prior !== undefined && prior.hash !== hash) throw new Error("idempotency conflict");
      if (prior !== undefined) return prior.record;
      this.#memoryRecords.set(key, { hash, record });
      return record;
    }
    const db = this.#db;
    const transactionUnit = this.#transactionUnit;
    const atomic = atomicCommand(command, command, record.commandId);
    await transactionUnit.execute(atomic, async (context) => {
      const transaction = getPostgresTransaction(context) as unknown as ConversionTransaction;
      await transaction
        .insertInto("business.structured_document_conversions")
        .values({
          schema_version: record.schemaVersion,
          conversion_id: record.conversionRef.reference.entityId,
          version_id: record.conversionRef.reference.versionId,
          project_id: record.projectId,
          command_kind: COMMAND_KIND,
          source_version_ref: jsonValue(record.sourceVersionRef),
          source_artifact_ref: jsonValue(record.sourceArtifactRef),
          input_kind: record.input.kind,
          media_type: record.mediaType,
          conversion_policy_ref: jsonValue(record.conversionPolicyRef),
          quality_policy_ref: jsonValue(record.qualityPolicyRef),
          converter_deployment_ref: jsonValue(record.converterDeploymentRef),
          parser_set_version: `${record.converterDeploymentRef.entityId}@${record.converterDeploymentRef.versionId}`,
          status: record.status,
          jsonld_artifact_ref:
            record.jsonLdArtifactRef === undefined ? null : jsonValue(record.jsonLdArtifactRef),
          source_segment_set_ref:
            record.sourceSegmentSetRef === undefined ? null : jsonValue(record.sourceSegmentSetRef),
          diagnostic_ref:
            record.diagnosticRef === undefined ? null : jsonValue(record.diagnosticRef),
          authorization_policy_ref: jsonValue(record.authorizationPolicyRef),
          command_id: record.commandId,
          idempotency_key: record.idempotencyKey,
          actor_id: record.actorId,
          run_id: record.runId,
          thread_id: record.threadId,
          statistics: jsonValue(record.statistics),
          started_at: record.startedAt,
          completed_at: record.completedAt,
          audit_entry_id: record.auditTrailRef.reference.entityId,
          created_at: sql`clock_timestamp()`,
        } satisfies InsertObject<ConversionDatabase, "business.structured_document_conversions">)
        .execute();
      return conversionCommit(command, record);
    });
    const persisted = await db
      .selectFrom("business.structured_document_conversions")
      .selectAll()
      .where("project_id", "=", record.projectId)
      .where("conversion_id", "=", record.conversionRef.reference.entityId)
      .where("version_id", "=", record.conversionRef.reference.versionId)
      .executeTakeFirst();
    if (persisted === undefined) throw new Error("conversion record was not persisted");
    return rowToRecord(persisted);
  }

  async #readExisting(command: StructuredDocumentConversionCommandV1): Promise<ExistingConversion> {
    const key = `${command.projectId}\u0000${COMMAND_KIND}\u0000${command.idempotencyKey}`;
    const hash = sha256CanonicalJson(command);
    if (this.#db === undefined) {
      const prior = this.#memoryRecords.get(key);
      if (prior === undefined) return {};
      return prior.hash === hash
        ? { record: prior.record }
        : {
            conflict: true,
            error: ModuleErrorV1Schema.parse({
              stageCode: "engineering-data.document-conversion.idempotency",
              occurredAt: new Date().toISOString(),
              causalRunId: command.conversionId,
              code: "IDEMPOTENCY_CONFLICT",
              category: "idempotency",
              retryable: false,
              idempotencyKey: command.idempotencyKey,
              priorCommandId: prior.record.commandId,
            }),
          };
    }
    const receipt = await this.#db
      .selectFrom("business.command_receipts")
      .select(["command_id", "payload_sha256", "completed_at", "result_ref"])
      .where("project_id", "=", command.projectId)
      .where("command_kind", "=", COMMAND_KIND)
      .where("idempotency_key", "=", command.idempotencyKey)
      .executeTakeFirst();
    if (receipt === undefined) return {};
    if (receipt.payload_sha256 !== hash) {
      return {
        conflict: true,
        error: ModuleErrorV1Schema.parse({
          stageCode: "engineering-data.document-conversion.idempotency",
          occurredAt: new Date().toISOString(),
          causalRunId: command.conversionId,
          code: "IDEMPOTENCY_CONFLICT",
          category: "idempotency",
          retryable: false,
          idempotencyKey: command.idempotencyKey,
          priorCommandId: receipt.command_id,
        }),
      };
    }
    if (receipt.completed_at === null) return {};
    const row = await this.#db
      .selectFrom("business.structured_document_conversions")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("conversion_id", "=", command.conversionId)
      .where("version_id", "=", "1")
      .executeTakeFirst();
    return row === undefined ? {} : { record: rowToRecord(row) };
  }

  async #readByRef(
    projectId: string,
    conversionRef: StructuredDocumentConversionRecordV1["conversionRef"],
  ): Promise<StructuredDocumentConversionRecordV1 | undefined> {
    if (this.#db === undefined) {
      for (const item of this.#memoryRecords.values()) {
        if (
          item.record.projectId === projectId &&
          referenceKey(item.record.conversionRef) === referenceKey(conversionRef)
        )
          return item.record;
      }
      return undefined;
    }
    const row = await this.#db
      .selectFrom("business.structured_document_conversions")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("conversion_id", "=", conversionRef.reference.entityId)
      .where("version_id", "=", conversionRef.reference.versionId)
      .executeTakeFirst();
    return row === undefined ? undefined : rowToRecord(row);
  }
}

export const createStructuredDocumentConversionAdapter = (
  options: StructuredDocumentConversionAdapterOptionsV1,
): StructuredDocumentConversionAdapter => new StructuredDocumentConversionAdapter(options);

export type { ConversionDatabase };
