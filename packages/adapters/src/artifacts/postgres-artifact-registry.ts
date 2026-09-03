import { sql, type Kysely, type Transaction } from "kysely";
import type { Pool, PoolClient } from "pg";

import {
  ArtifactAccessSnapshotV1Schema,
  ArtifactAccessRecordV1Schema,
  ArtifactManifestV1Schema,
  ArtifactMaintenanceBatchV1Schema,
  ArtifactPutCommandV1Schema,
  ArtifactPutResultV1Schema,
  ArtifactReferenceCheckRequestV1Schema,
  ArtifactReferenceCheckResultV1Schema,
  ArtifactRefV1Schema,
  ArtifactStoreError,
  ArtifactStorePolicyV1Schema,
  ArtifactErrorV1Schema,
  evidenceReferencesSha256,
  makeArtifactError,
  manifestSha256,
  mergeArtifactAccessSnapshots,
  mergeEvidenceReferences,
  normalizeArtifactAccessSnapshot,
  type ArtifactAccessSnapshotV1,
  type ArtifactAccessRecordV1,
  type ArtifactErrorV1,
  type ArtifactManifestV1,
  type ArtifactMaintenanceBatchV1,
  type ArtifactPutCommandV1,
  type ArtifactPutResultV1,
  type ArtifactReferenceCheckRequestV1,
  type ArtifactReferenceCheckResultV1,
  type ArtifactRefV1,
  type ArtifactStorePolicyV1,
  type ArtifactAccessOutcomeV1,
} from "@riskflow/core/artifacts";
import type {
  AuthorizationContextV1,
  AuthorizationContextRefV1,
  ContractReferenceV1,
  AuditTrailRefV1,
} from "@riskflow/contracts/ports";
import {
  AuthorizationContextV1Schema,
  AuthorizationContextRefV1Schema,
} from "@riskflow/contracts/ports";
import { VersionReferenceSchema } from "@riskflow/contracts/common";
import type { JsonValue } from "@riskflow/core/persistence";
import {
  AtomicCommandV1Schema,
  type AtomicCommitV1,
  type AtomicCommandV1,
  type TransactionContextV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";

import { getPostgresTransaction } from "../postgres/transaction-unit.js";
import { mapPostgresError } from "../postgres/pool.js";
import type { PostgresDatabase } from "../postgres/types.js";

type ArtifactManifestRow = {
  artifact_id: string;
  version_id: string;
  artifact_kind: "content" | "diagnostic";
  content_sha256: string;
  byte_length: string | number | bigint;
  media_type: string;
  purpose_code: string;
  project_id: string;
  spatial_scope_refs: JsonValue;
  source_access_grant_refs: JsonValue;
  authorization_policy_refs: JsonValue;
  write_policy_ref: JsonValue;
  parent_artifact_refs: JsonValue;
  evidence_references: JsonValue;
  producer_command_id: string;
  authorization_context_ref: JsonValue;
  audit_entry_id: string;
  manifest_sha256: string;
  occurred_at: Date | string;
  recorded_at: Date | string;
  persisted_at: Date | string;
};

type ArtifactAccessRecordRow = {
  schema_version: string;
  request_id: string;
  project_id: string;
  actor_id: string;
  purpose_code: string;
  authorization_context_ref: JsonValue;
  authorization_policy_ref: JsonValue;
  outcome: ArtifactAccessRecordV1["outcome"];
  stage: string;
  occurred_at: Date | string;
  audit_entry_id: string;
  diagnostic_ref: JsonValue | null;
};

type ArtifactMaintenanceBatchRow = {
  schema_version: string;
  run_id: string;
  batch_number: number;
  project_id: string;
  command_id: string;
  operation: ArtifactMaintenanceBatchV1["operation"];
  policy_ref: JsonValue;
  policy_sha256: string;
  run_started_at: Date | string;
  cutoff: Date | string;
  dry_run: boolean;
  candidate_hashes: JsonValue;
  audit_entry_id: string;
  persisted_at: Date | string;
};

type ArtifactRegistryDatabase = PostgresDatabase & {
  "business.artifact_manifests": ArtifactManifestRow;
  "business.artifact_access_records": ArtifactAccessRecordRow;
  "business.artifact_maintenance_batches": ArtifactMaintenanceBatchRow;
};
type RegistryTransaction = Transaction<ArtifactRegistryDatabase>;

const asRegistryTransaction = (context: TransactionContextV1): RegistryTransaction =>
  getPostgresTransaction(context) as unknown as RegistryTransaction;

const jsonValue = (value: unknown): JsonValue => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw makeArtifactError("ARTIFACT_INPUT_INVALID", "registry.json");
  return serialized as JsonValue;
};

const refKey = (value: {
  kind: string;
  reference: { entityId: string; versionId: string };
}): string => `${value.kind}/${value.reference.entityId}/${value.reference.versionId}`;
const versionKey = (value: { entityId: string; versionId: string }): string =>
  `${value.entityId}/${value.versionId}`;

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const safeByteLength = (value: ArtifactManifestRow["byte_length"]): number => {
  const numberValue = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
    throw makeArtifactError("ARTIFACT_REGISTRY_FAILURE", "registry.byte-length");
  }
  return numberValue;
};

const parseJson = <T>(schema: { parse(value: unknown): T }, value: unknown, stage: string): T => {
  try {
    return schema.parse(value);
  } catch {
    throw makeArtifactError("ARTIFACT_REGISTRY_FAILURE", stage);
  }
};

const diagnosticRefFor = (code: ArtifactErrorV1["code"]): ArtifactErrorV1["diagnosticRef"] => ({
  kind: "diagnostic-artifact",
  reference: { entityId: `artifact-${code.toLowerCase()}`, versionId: "v1" },
});

const readError = (error: unknown, stage: string): ArtifactStoreError => {
  if (error instanceof ArtifactStoreError) return error;
  const mapped = mapPostgresError(error, stage, "TRANSACTION_FAILED");
  const code =
    mapped.code === "IDEMPOTENCY_CONFLICT"
      ? "ARTIFACT_IDEMPOTENCY_CONFLICT"
      : "ARTIFACT_REGISTRY_FAILURE";
  return new ArtifactStoreError(
    ArtifactErrorV1Schema.parse({
      code,
      retryable: mapped.retryable,
      stage,
      occurredAt: new Date().toISOString(),
      diagnosticRef: diagnosticRefFor(code),
      contextRefs: mapped.contextRefs,
    }),
  );
};

const authorizationPolicyRefs = (authorization: AuthorizationContextV1) => [
  authorization.authorizationPolicyRef,
];

const accessForAuthorization = (authorization: AuthorizationContextV1): ArtifactAccessSnapshotV1 =>
  normalizeArtifactAccessSnapshot({
    projectId: authorization.projectId,
    spatialScopeRefs: authorization.spatialScopeRefs,
    sourceAccessGrantRefs: authorization.sourceAccessGrantRefs,
    authorizationPolicyRefs: authorizationPolicyRefs(authorization),
  });

const containsAll = <T>(
  available: readonly T[],
  required: readonly T[],
  key: (value: T) => string,
): boolean => {
  const values = new Set(available.map(key));
  return required.every((value) => values.has(key(value)));
};

const artifactRefFromRow = (row: ArtifactManifestRow): ArtifactRefV1 => ({
  kind: row.artifact_kind === "content" ? "content-artifact" : "diagnostic-artifact",
  reference: { entityId: row.artifact_id, versionId: row.version_id },
});

const manifestFromRow = (row: ArtifactManifestRow): ArtifactManifestV1 =>
  parseJson(
    ArtifactManifestV1Schema,
    {
      schemaVersion: "1",
      artifactRef: artifactRefFromRow(row),
      artifactKind: row.artifact_kind,
      content: {
        hash: { algorithm: "sha256", value: row.content_sha256 },
        byteLength: safeByteLength(row.byte_length),
      },
      mediaType: row.media_type,
      purposeCode: row.purpose_code,
      access: parseJson(
        ArtifactAccessSnapshotV1Schema,
        {
          projectId: row.project_id,
          spatialScopeRefs: row.spatial_scope_refs,
          sourceAccessGrantRefs: row.source_access_grant_refs,
          authorizationPolicyRefs: row.authorization_policy_refs,
        },
        "registry.access",
      ),
      writePolicyRef: parseJson(
        VersionReferenceSchema,
        row.write_policy_ref,
        "registry.write-policy",
      ),
      parentArtifactRefs: parseJson(
        ArtifactManifestV1Schema.shape.parentArtifactRefs,
        row.parent_artifact_refs,
        "registry.parents",
      ),
      evidenceReferences: parseJson(
        ArtifactManifestV1Schema.shape.evidenceReferences,
        row.evidence_references,
        "registry.evidence",
      ),
      producerCommandId: row.producer_command_id,
      authorizationContextRef: parseJson(
        AuthorizationContextRefV1Schema,
        row.authorization_context_ref,
        "registry.authorization-ref",
      ),
      auditTrailRef: {
        kind: "audit-trail",
        reference: { entityId: row.audit_entry_id, versionId: "v1" },
      },
      occurredAt: asIso(row.occurred_at),
      recordedAt: asIso(row.recorded_at),
      persistedAt: asIso(row.persisted_at),
    },
    "registry.manifest",
  );

const assertManifestDigest = (row: ArtifactManifestRow, manifest: ArtifactManifestV1): void => {
  if (manifestSha256(manifest) !== row.manifest_sha256) {
    throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", "registry.manifest-digest");
  }
};

const rowFromManifest = (
  manifest: ArtifactManifestV1,
  manifestDigest: string,
): ArtifactManifestRow => ({
  artifact_id: manifest.artifactRef.reference.entityId,
  version_id: manifest.artifactRef.reference.versionId,
  artifact_kind: manifest.artifactKind,
  content_sha256: manifest.content.hash.value,
  byte_length: manifest.content.byteLength,
  media_type: manifest.mediaType,
  purpose_code: manifest.purposeCode,
  project_id: manifest.access.projectId,
  spatial_scope_refs: jsonValue(manifest.access.spatialScopeRefs),
  source_access_grant_refs: jsonValue(manifest.access.sourceAccessGrantRefs),
  authorization_policy_refs: jsonValue(manifest.access.authorizationPolicyRefs),
  write_policy_ref: jsonValue(manifest.writePolicyRef),
  parent_artifact_refs: jsonValue(manifest.parentArtifactRefs),
  evidence_references: jsonValue(manifest.evidenceReferences),
  producer_command_id: manifest.producerCommandId,
  authorization_context_ref: jsonValue(manifest.authorizationContextRef),
  audit_entry_id: manifest.auditTrailRef.reference.entityId,
  manifest_sha256: manifestDigest,
  occurred_at: manifest.occurredAt,
  recorded_at: manifest.recordedAt,
  persisted_at: manifest.persistedAt,
});

const commandPayload = (
  command: ArtifactPutCommandV1,
  manifest: ArtifactManifestV1,
  manifestDigest: string,
): AtomicCommandV1["payload"] => {
  const authorization = {
    schemaVersion: command.authorization.schemaVersion,
    authorizationContextRef: command.authorization.authorizationContextRef,
    actorId: command.authorization.actorId,
    projectId: command.authorization.projectId,
    grantedCapabilities: command.authorization.grantedCapabilities,
    spatialScopeRefs: command.authorization.spatialScopeRefs,
    sourceAccessGrantRefs: command.authorization.sourceAccessGrantRefs,
    authorizationPolicyRef: command.authorization.authorizationPolicyRef,
    decidedAt: command.authorization.decidedAt,
    invocation: command.authorization.invocation,
    ...(command.authorization.causalRunRef === undefined
      ? {}
      : { causalRunRef: command.authorization.causalRunRef }),
  };
  return {
    schemaVersion: command.schemaVersion,
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    projectId: command.projectId,
    actorId: command.actorId,
    authorization,
    authorizationContextRef: command.authorization.authorizationContextRef,
    requiredCapability: command.requiredCapability,
    issuedAt: command.issuedAt,
    artifactId: command.artifactId,
    artifactKind: command.artifactKind,
    purposeCode: command.purposeCode,
    mediaType: command.mediaType,
    expectedHash: command.expectedHash ?? null,
    expectedByteLength: command.expectedByteLength ?? null,
    parentArtifactRefs: command.parentArtifactRefs,
    evidenceReferences: command.evidenceReferences,
    additionalSpatialScopeRefs: command.additionalSpatialScopeRefs,
    additionalSourceAccessGrantRefs: command.additionalSourceAccessGrantRefs,
    actualContent: manifest.content,
    writePolicyRef: manifest.writePolicyRef,
    manifestSha256: manifestDigest,
  };
};

const targetProject = (projectId: string): ContractReferenceV1 => ({
  kind: "project-revision",
  reference: { entityId: projectId, versionId: "v1" },
});

const assertAuthorized = (
  manifest: ArtifactManifestV1,
  projectId: string,
  purposeCode: string,
  requiredCapability: ArtifactReferenceCheckRequestV1["requiredCapability"],
  authorization: AuthorizationContextV1,
): void => {
  const allowed =
    projectId === authorization.projectId &&
    projectId === manifest.access.projectId &&
    authorization.grantedCapabilities.includes(requiredCapability) &&
    containsAll(authorization.spatialScopeRefs, manifest.access.spatialScopeRefs, refKey) &&
    containsAll(
      authorization.sourceAccessGrantRefs,
      manifest.access.sourceAccessGrantRefs,
      refKey,
    ) &&
    containsAll(
      authorizationPolicyRefs(authorization),
      manifest.access.authorizationPolicyRefs,
      versionKey,
    );
  if (!allowed || purposeCode !== manifest.purposeCode) {
    throw makeArtifactError("ARTIFACT_ACCESS_DENIED", "registry.authorization");
  }
};

export interface ArtifactManifestSnapshotReaderV1 {
  readManifest(artifactRef: ArtifactRefV1): Promise<ArtifactManifestV1 | undefined>;
  listManifests(batchSize: number, exclude?: ArtifactRefV1): AsyncGenerator<ArtifactManifestV1>;
  close(committed?: boolean): Promise<void>;
}

const manifestColumns = [
  "artifact_id",
  "version_id",
  "artifact_kind",
  "content_sha256",
  "byte_length",
  "media_type",
  "purpose_code",
  "project_id",
  "spatial_scope_refs",
  "source_access_grant_refs",
  "authorization_policy_refs",
  "write_policy_ref",
  "parent_artifact_refs",
  "evidence_references",
  "producer_command_id",
  "authorization_context_ref",
  "audit_entry_id",
  "manifest_sha256",
  "occurred_at",
  "recorded_at",
  "persisted_at",
] as const;

const accessAction = (outcome: ArtifactAccessOutcomeV1): string =>
  outcome === "authorized" ? "artifact.read-started" : `artifact.read-${outcome}`;

const accessCommandKind = (outcome: ArtifactAccessOutcomeV1): string =>
  `artifact.read-${outcome}.v1`;

export interface ArtifactPreparedMetadataV1 {
  readonly access: ArtifactAccessSnapshotV1;
  readonly evidenceReferences: ArtifactManifestV1["evidenceReferences"];
}

export interface ArtifactRegistryOptionsV1 {
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: TransactionUnitV1;
  readonly pool?: Pool;
  readonly failpoint?: (
    point: "registry.handler" | "audit.commit" | "database.commit",
  ) => void | Promise<void>;
}

export class PostgresArtifactRegistry {
  readonly #db: Kysely<ArtifactRegistryDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #pool: Pool | undefined;
  readonly #failpoint: (
    point: "registry.handler" | "audit.commit" | "database.commit",
  ) => void | Promise<void>;
  readonly #activeSnapshots = new Set<() => Promise<void>>();
  readonly #activeTransactions = new Set<Promise<unknown>>();
  #closed = false;

  constructor(options: ArtifactRegistryOptionsV1) {
    this.#db = options.db as unknown as Kysely<ArtifactRegistryDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#pool = options.pool;
    this.#failpoint = options.failpoint ?? (() => undefined);
  }

  #trackTransaction<T>(operation: () => Promise<T>): Promise<T> {
    const promise = operation();
    this.#activeTransactions.add(promise);
    void promise.then(
      () => this.#activeTransactions.delete(promise),
      () => this.#activeTransactions.delete(promise),
    );
    return promise;
  }

  async openManifestSnapshot(projectId: string): Promise<ArtifactManifestSnapshotReaderV1> {
    if (this.#closed) throw makeArtifactError("ARTIFACT_REGISTRY_FAILURE", "registry.closed");
    if (this.#pool === undefined)
      throw makeArtifactError("ARTIFACT_REGISTRY_FAILURE", "registry.snapshot.pool");
    const client: PoolClient = await this.#pool.connect();
    let closed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    } catch (error) {
      client.release();
      throw readError(error, "registry.snapshot.begin");
    }
    const finish = async (committed = false): Promise<void> => {
      if (closed) return;
      closed = true;
      this.#activeSnapshots.delete(finish);
      try {
        await client.query(committed ? "COMMIT" : "ROLLBACK");
      } finally {
        client.release();
      }
    };
    this.#activeSnapshots.add(finish);
    const reader: ArtifactManifestSnapshotReaderV1 = {
      readManifest: async (artifactRef) => {
        if (closed)
          throw makeArtifactError("ARTIFACT_REGISTRY_FAILURE", "registry.snapshot.closed");
        const validRef = ArtifactRefV1Schema.parse(artifactRef);
        const kind = validRef.kind === "content-artifact" ? "content" : "diagnostic";
        try {
          const result = await client.query<ArtifactManifestRow>(
            `SELECT ${manifestColumns.join(", ")} FROM business.artifact_manifests
             WHERE project_id = $1 AND artifact_kind = $2 AND artifact_id = $3 AND version_id = $4`,
            [projectId, kind, validRef.reference.entityId, validRef.reference.versionId],
          );
          const row = result.rows[0];
          if (row === undefined) return undefined;
          const manifest = manifestFromRow(row);
          assertManifestDigest(row, manifest);
          return manifest;
        } catch (error) {
          throw readError(error, "registry.snapshot.read");
        }
      },
      listManifests: async function* (batchSize: number, exclude?: ArtifactRefV1) {
        if (closed)
          throw makeArtifactError("ARTIFACT_REGISTRY_FAILURE", "registry.snapshot.closed");
        if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
          throw makeArtifactError("ARTIFACT_INPUT_INVALID", "registry.snapshot.batch");
        }
        let cursor:
          | {
              artifactKind: ArtifactManifestRow["artifact_kind"];
              artifactId: string;
              versionId: string;
            }
          | undefined;
        for (;;) {
          const parameters: unknown[] = [projectId];
          const predicates = ["project_id = $1"];
          if (exclude !== undefined) {
            const kind = exclude.kind === "content-artifact" ? "content" : "diagnostic";
            parameters.push(kind, exclude.reference.entityId, exclude.reference.versionId);
            predicates.push(
              `(artifact_kind, artifact_id, version_id) <> ($${parameters.length - 2}, $${parameters.length - 1}, $${parameters.length})`,
            );
          }
          if (cursor !== undefined) {
            parameters.push(cursor.artifactKind, cursor.artifactId, cursor.versionId);
            predicates.push(
              `(artifact_kind, artifact_id, version_id) > ($${parameters.length - 2}, $${parameters.length - 1}, $${parameters.length})`,
            );
          }
          parameters.push(batchSize);
          const query = `SELECT ${manifestColumns.join(", ")} FROM business.artifact_manifests WHERE ${predicates.join(" AND ")} ORDER BY artifact_kind, artifact_id, version_id LIMIT $${parameters.length}`;
          let rows: ArtifactManifestRow[];
          try {
            const result = await client.query<ArtifactManifestRow>(query, parameters);
            rows = result.rows;
          } catch (error) {
            throw readError(error, "registry.snapshot.list");
          }
          if (rows.length === 0) return;
          for (const row of rows) {
            const manifest = manifestFromRow(row);
            assertManifestDigest(row, manifest);
            cursor = {
              artifactKind: row.artifact_kind,
              artifactId: row.artifact_id,
              versionId: row.version_id,
            };
            yield manifest;
          }
          if (rows.length < batchSize) return;
        }
      },
      close: finish,
    };
    return reader;
  }

  async readManifest(
    projectId: string,
    artifactRef: ArtifactRefV1,
  ): Promise<ArtifactManifestV1 | undefined> {
    const parsedRef = ArtifactRefV1Schema.safeParse(artifactRef);
    if (!parsedRef.success) throw makeArtifactError("ARTIFACT_INPUT_INVALID", "registry.reference");
    try {
      const row = await this.#db
        .selectFrom("business.artifact_manifests")
        .selectAll()
        .where("project_id", "=", projectId)
        .where("artifact_id", "=", parsedRef.data.reference.entityId)
        .where(
          "artifact_kind",
          "=",
          parsedRef.data.kind === "content-artifact" ? "content" : "diagnostic",
        )
        .where("version_id", "=", parsedRef.data.reference.versionId)
        .executeTakeFirst();
      if (row === undefined) return undefined;
      const manifest = manifestFromRow(row);
      if (refKey(manifest.artifactRef) !== refKey(parsedRef.data)) {
        throw makeArtifactError("ARTIFACT_REGISTRY_FAILURE", "registry.reference-consistency");
      }
      return manifest;
    } catch (error) {
      throw readError(error, "registry.read");
    }
  }

  async readManifestDigest(
    projectId: string,
    artifactRef: ArtifactRefV1,
  ): Promise<string | undefined> {
    const parsedRef = ArtifactRefV1Schema.safeParse(artifactRef);
    if (!parsedRef.success) throw makeArtifactError("ARTIFACT_INPUT_INVALID", "registry.reference");
    try {
      const row = await this.#db
        .selectFrom("business.artifact_manifests")
        .select(["manifest_sha256"])
        .where("project_id", "=", projectId)
        .where("artifact_id", "=", parsedRef.data.reference.entityId)
        .where(
          "artifact_kind",
          "=",
          parsedRef.data.kind === "content-artifact" ? "content" : "diagnostic",
        )
        .where("version_id", "=", parsedRef.data.reference.versionId)
        .executeTakeFirst();
      return row?.manifest_sha256;
    } catch (error) {
      throw readError(error, "registry.digest");
    }
  }

  async readCompletedPutResult(
    command: Pick<ArtifactPutCommandV1, "projectId" | "commandId" | "idempotencyKey">,
  ): Promise<ArtifactPutResultV1 | undefined> {
    try {
      const receipt = await this.#db
        .selectFrom("business.command_receipts")
        .select(["command_id", "result_ref", "completed_at"])
        .where("project_id", "=", command.projectId)
        .where("command_kind", "=", "artifact.put.v1")
        .where("idempotency_key", "=", command.idempotencyKey)
        .executeTakeFirst();
      if (receipt === undefined) return undefined;
      if (receipt.command_id !== command.commandId)
        throw makeArtifactError("ARTIFACT_IDEMPOTENCY_CONFLICT", "registry.put-replay");
      if (receipt.completed_at === null || receipt.result_ref === null) return undefined;
      const artifactRef = parseJson(ArtifactRefV1Schema, receipt.result_ref, "registry.replay-ref");
      const manifest = await this.readManifest(command.projectId, artifactRef);
      if (manifest === undefined)
        throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", "registry.replay-manifest");
      const manifestDigest = await this.readManifestDigest(command.projectId, artifactRef);
      if (manifestDigest === undefined || manifestDigest !== manifestSha256(manifest))
        throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", "registry.replay-digest");
      return ArtifactPutResultV1Schema.parse({
        artifactRef,
        manifest,
        manifestSha256: manifestDigest,
        replayed: true,
        deduplicated: true,
      });
    } catch (error) {
      throw readError(error, "registry.put-replay");
    }
  }

  async preparePutMetadata(command: ArtifactPutCommandV1): Promise<ArtifactPreparedMetadataV1> {
    const parsed = ArtifactPutCommandV1Schema.safeParse(command);
    if (!parsed.success) throw makeArtifactError("ARTIFACT_INPUT_INVALID", "registry.put-command");
    const value = parsed.data;
    const snapshots: ArtifactAccessSnapshotV1[] = [accessForAuthorization(value.authorization)];
    const evidenceGroups: ArtifactManifestV1["evidenceReferences"][] = [value.evidenceReferences];
    for (const parentRef of value.parentArtifactRefs) {
      const parent = await this.readManifest(value.projectId, parentRef);
      if (parent === undefined) {
        throw makeArtifactError("ARTIFACT_ACCESS_DENIED", "registry.parent-access", [parentRef]);
      }
      try {
        assertAuthorized(
          parent,
          value.projectId,
          parent.purposeCode,
          value.requiredCapability,
          value.authorization,
        );
      } catch (error) {
        if (error instanceof ArtifactStoreError) {
          throw makeArtifactError("ARTIFACT_ACCESS_DENIED", "registry.parent-access", [parentRef]);
        }
        throw error;
      }
      snapshots.push(parent.access);
      const parentDigest = await this.readManifestDigest(value.projectId, parentRef);
      if (parentDigest === undefined || parentDigest !== manifestSha256(parent)) {
        throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", "registry.parent-digest", [
          parentRef,
        ]);
      }
      evidenceGroups.push(parent.evidenceReferences);
    }
    const access = mergeArtifactAccessSnapshots(snapshots);
    return {
      access: normalizeArtifactAccessSnapshot({
        projectId: access.projectId,
        spatialScopeRefs: [...access.spatialScopeRefs, ...value.additionalSpatialScopeRefs],
        sourceAccessGrantRefs: [
          ...access.sourceAccessGrantRefs,
          ...value.additionalSourceAccessGrantRefs,
        ],
        authorizationPolicyRefs: [
          ...access.authorizationPolicyRefs,
          value.authorization.authorizationPolicyRef,
        ],
      }),
      evidenceReferences: mergeEvidenceReferences(evidenceGroups),
    };
  }

  async register(
    command: ArtifactPutCommandV1,
    manifest: ArtifactManifestV1,
    manifestDigest: string,
    action = "artifact.put",
  ): Promise<{
    readonly replayed: boolean;
    readonly manifest: ArtifactManifestV1;
    readonly manifestSha256: string;
  }> {
    const parsedCommand = ArtifactPutCommandV1Schema.safeParse(command);
    const parsedManifest = ArtifactManifestV1Schema.safeParse(manifest);
    if (
      !parsedCommand.success ||
      !parsedManifest.success ||
      !/^[0-9a-f]{64}$/u.test(manifestDigest) ||
      (parsedManifest.success && manifestSha256(parsedManifest.data) !== manifestDigest)
    ) {
      throw makeArtifactError("ARTIFACT_INPUT_INVALID", "registry.register");
    }
    const value = parsedCommand.data;
    const validManifest = parsedManifest.data;
    const atomicCommand = AtomicCommandV1Schema.parse({
      projectId: value.projectId,
      commandKind: "artifact.put.v1",
      commandId: value.commandId,
      idempotencyKey: value.idempotencyKey,
      payload: commandPayload(value, validManifest, manifestDigest),
      actorRef: value.actorId,
      authorizationContextRef: value.authorization.authorizationContextRef,
      issuedAt: value.issuedAt,
    });
    const auditEntryId = validManifest.auditTrailRef.reference.entityId;
    let inserted = false;
    try {
      const receipt = await this.#trackTransaction(() =>
        this.#transactionUnit.execute(atomicCommand, async (context) => {
          inserted = true;
          await this.#failpoint("registry.handler");
          const transaction = asRegistryTransaction(context);
          for (const parentRef of validManifest.parentArtifactRefs) {
            const parentRow = await transaction
              .selectFrom("business.artifact_manifests")
              .selectAll()
              .where("project_id", "=", value.projectId)
              .where("artifact_id", "=", parentRef.reference.entityId)
              .where(
                "artifact_kind",
                "=",
                parentRef.kind === "content-artifact" ? "content" : "diagnostic",
              )
              .where("version_id", "=", parentRef.reference.versionId)
              .executeTakeFirst();
            if (parentRow === undefined) {
              throw makeArtifactError("ARTIFACT_ACCESS_DENIED", "registry.parent-access", [
                parentRef,
              ]);
            }
            const parent = manifestFromRow(parentRow);
            try {
              assertAuthorized(
                parent,
                value.projectId,
                parent.purposeCode,
                value.requiredCapability,
                value.authorization,
              );
            } catch (error) {
              if (error instanceof ArtifactStoreError)
                throw makeArtifactError("ARTIFACT_ACCESS_DENIED", "registry.parent-access", [
                  parentRef,
                ]);
              throw error;
            }
            assertManifestDigest(parentRow, parent);
          }
          await transaction
            .insertInto("business.artifact_manifests")
            .values({
              ...rowFromManifest(validManifest, manifestDigest),
              persisted_at: sql`clock_timestamp()`,
            })
            .execute();
          const commit: AtomicCommitV1 = {
            resultRef: validManifest.artifactRef,
            audit: {
              auditEntryId,
              projectId: value.projectId,
              action,
              targetRef: validManifest.artifactRef,
              actorRef: value.actorId,
              authorizationContextRef: value.authorization.authorizationContextRef,
              occurredAt: validManifest.occurredAt,
              recordedAt: validManifest.recordedAt,
              version: validManifest.artifactRef.reference,
              commandId: value.commandId,
              idempotencyKey: value.idempotencyKey,
            },
            events: [],
          };
          await this.#failpoint("audit.commit");
          return commit;
        }),
      );
      await this.#failpoint("database.commit");
      const stored = await this.readManifest(value.projectId, validManifest.artifactRef);
      if (stored === undefined)
        throw makeArtifactError("ARTIFACT_REGISTRY_FAILURE", "registry.register-readback");
      const storedDigest = await this.readManifestDigest(
        value.projectId,
        validManifest.artifactRef,
      );
      if (storedDigest !== manifestDigest) {
        throw makeArtifactError("ARTIFACT_INTEGRITY_FAILURE", "registry.register-digest");
      }
      return {
        replayed: receipt.replayed || !inserted,
        manifest: stored,
        manifestSha256: storedDigest,
      };
    } catch (error) {
      throw readError(error, "registry.register");
    }
  }

  async recordAccessOutcome(request: {
    requestId: string;
    idempotencyKey: string;
    projectId: string;
    actorId: string;
    occurredAt: string;
    purposeCode: string;
    authorizationContextRef: AuthorizationContextRefV1;
    authorizationPolicyRef: ArtifactAccessRecordV1["authorizationPolicyRef"];
    outcome: ArtifactAccessRecordV1["outcome"];
    stage: string;
    diagnosticRef?: ArtifactAccessRecordV1["diagnosticRef"];
  }): Promise<ArtifactAccessRecordV1> {
    const valid = ArtifactAccessRecordV1Schema.parse({
      schemaVersion: "1",
      requestId: request.requestId,
      projectId: request.projectId,
      actorId: request.actorId,
      purposeCode: request.purposeCode,
      authorizationContextRef: request.authorizationContextRef,
      authorizationPolicyRef: request.authorizationPolicyRef,
      outcome: request.outcome,
      stage: request.stage,
      occurredAt: request.occurredAt,
      auditTrailRef: {
        kind: "audit-trail",
        reference: {
          entityId: `artifact-access-${request.requestId}-${request.outcome}`,
          versionId: "v1",
        },
      },
      ...(request.diagnosticRef === undefined ? {} : { diagnosticRef: request.diagnosticRef }),
    });
    const auditEntryId = valid.auditTrailRef.reference.entityId;
    const commandId = `${valid.requestId}-${valid.outcome}`;
    const atomic = AtomicCommandV1Schema.parse({
      projectId: valid.projectId,
      commandKind: accessCommandKind(valid.outcome),
      commandId,
      idempotencyKey: request.idempotencyKey,
      payload: {
        schemaVersion: valid.schemaVersion,
        requestId: valid.requestId,
        projectId: valid.projectId,
        actorId: valid.actorId,
        purposeCode: valid.purposeCode,
        authorizationContextRef: valid.authorizationContextRef,
        authorizationPolicyRef: valid.authorizationPolicyRef,
        outcome: valid.outcome,
        stage: valid.stage,
        occurredAt: valid.occurredAt,
        ...(valid.diagnosticRef === undefined ? {} : { diagnosticRef: valid.diagnosticRef }),
      },
      actorRef: valid.actorId,
      authorizationContextRef: valid.authorizationContextRef,
      issuedAt: valid.occurredAt,
    });
    try {
      await this.#trackTransaction(() =>
        this.#transactionUnit.execute(atomic, async (context) => {
          const transaction = asRegistryTransaction(context);
          await transaction
            .insertInto("business.artifact_access_records")
            .values({
              schema_version: valid.schemaVersion,
              request_id: valid.requestId,
              project_id: valid.projectId,
              actor_id: valid.actorId,
              purpose_code: valid.purposeCode,
              authorization_context_ref: jsonValue(valid.authorizationContextRef),
              authorization_policy_ref: jsonValue(valid.authorizationPolicyRef),
              outcome: valid.outcome,
              stage: valid.stage,
              occurred_at: valid.occurredAt,
              audit_entry_id: auditEntryId,
              diagnostic_ref:
                valid.diagnosticRef === undefined ? null : jsonValue(valid.diagnosticRef),
            })
            .onConflict((conflict) =>
              conflict.columns(["project_id", "request_id", "outcome"]).doNothing(),
            )
            .execute();
          return {
            resultRef: valid.auditTrailRef,
            audit: {
              auditEntryId,
              projectId: valid.projectId,
              action: accessAction(valid.outcome),
              targetRef: targetProject(valid.projectId),
              actorRef: valid.actorId,
              authorizationContextRef: valid.authorizationContextRef,
              occurredAt: valid.occurredAt,
              recordedAt: valid.occurredAt,
              version: { entityId: valid.requestId, versionId: "v1" },
              commandId,
              idempotencyKey: request.idempotencyKey,
            },
            events: [],
          };
        }),
      );
      return valid;
    } catch (error) {
      throw readError(error, "registry.access-record");
    }
  }

  async recordReadStarted(request: {
    requestId: string;
    idempotencyKey: string;
    projectId: string;
    actorId: string;
    requestedAt: string;
    purposeCode: string;
    authorizationContextRef: AuthorizationContextRefV1;
    authorizationPolicyRef: ArtifactAccessRecordV1["authorizationPolicyRef"];
  }): Promise<ArtifactAccessRecordV1> {
    return this.recordAccessOutcome({
      ...request,
      occurredAt: request.requestedAt,
      outcome: "authorized",
      stage: "read-authorized",
    });
  }

  async assertUsable(
    context: TransactionContextV1,
    request: ArtifactReferenceCheckRequestV1,
  ): Promise<ArtifactReferenceCheckResultV1> {
    const parsed = ArtifactReferenceCheckRequestV1Schema.safeParse(request);
    if (!parsed.success)
      throw makeArtifactError("ARTIFACT_INPUT_INVALID", "registry.reference-command");
    const value = parsed.data;
    const transaction = asRegistryTransaction(context);
    try {
      const row = await transaction
        .selectFrom("business.artifact_manifests")
        .selectAll()
        .where("project_id", "=", value.projectId)
        .where("artifact_id", "=", value.artifactRef.reference.entityId)
        .where(
          "artifact_kind",
          "=",
          value.artifactRef.kind === "content-artifact" ? "content" : "diagnostic",
        )
        .where("version_id", "=", value.artifactRef.reference.versionId)
        .executeTakeFirst();
      if (row === undefined)
        throw makeArtifactError("ARTIFACT_REFERENCE_NOT_FOUND", "registry.reference");
      const manifest = manifestFromRow(row);
      assertAuthorized(
        manifest,
        value.projectId,
        value.purposeCode,
        value.requiredCapability,
        value.authorization,
      );
      assertManifestDigest(row, manifest);
      return ArtifactReferenceCheckResultV1Schema.parse({
        artifactRef: manifest.artifactRef,
        manifestSha256: row.manifest_sha256,
        content: manifest.content,
        mediaType: manifest.mediaType,
        access: manifest.access,
        evidenceReferences: manifest.evidenceReferences,
      });
    } catch (error) {
      if (error instanceof ArtifactStoreError) throw error;
      throw readError(error, "registry.reference");
    }
  }

  assertReadable(
    manifest: ArtifactManifestV1,
    request: Pick<
      ArtifactReferenceCheckRequestV1,
      "projectId" | "purposeCode" | "requiredCapability" | "authorization"
    >,
  ): void {
    const parsed = ArtifactReferenceCheckRequestV1Schema.safeParse({
      schemaVersion: "1",
      artifactRef: manifest.artifactRef,
      ...request,
    });
    if (!parsed.success) throw makeArtifactError("ARTIFACT_INPUT_INVALID", "registry.read-request");
    assertAuthorized(
      manifest,
      parsed.data.projectId,
      parsed.data.purposeCode,
      parsed.data.requiredCapability,
      parsed.data.authorization,
    );
  }

  async *listManifests(
    projectId: string,
    batchSize = 250,
    exclude?: ArtifactRefV1,
  ): AsyncGenerator<ArtifactManifestV1> {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000)
      throw makeArtifactError("ARTIFACT_INPUT_INVALID", "registry.list.batch");
    let cursor:
      | {
          artifactKind: ArtifactManifestRow["artifact_kind"];
          artifactId: string;
          versionId: string;
        }
      | undefined;
    for (;;) {
      try {
        let query = this.#db
          .selectFrom("business.artifact_manifests")
          .selectAll()
          .where("project_id", "=", projectId)
          .orderBy("artifact_kind", "asc")
          .orderBy("artifact_id", "asc")
          .orderBy("version_id", "asc")
          .limit(batchSize);
        if (exclude !== undefined) {
          const kind = exclude.kind === "content-artifact" ? "content" : "diagnostic";
          query = query.where(
            sql<boolean>`(artifact_kind, artifact_id, version_id) <> (${kind}, ${exclude.reference.entityId}, ${exclude.reference.versionId})`,
          );
        }
        if (cursor !== undefined) {
          query = query.where(
            sql<boolean>`(artifact_kind, artifact_id, version_id) > (${cursor.artifactKind}, ${cursor.artifactId}, ${cursor.versionId})`,
          );
        }
        const rows = await query.execute();
        if (rows.length === 0) return;
        for (const row of rows) {
          const manifest = manifestFromRow(row);
          assertManifestDigest(row, manifest);
          cursor = {
            artifactKind: row.artifact_kind,
            artifactId: row.artifact_id,
            versionId: row.version_id,
          };
          yield manifest;
        }
        if (rows.length < batchSize) return;
      } catch (error) {
        throw readError(error, "registry.list");
      }
    }
  }

  async countContentHash(contentHash: string): Promise<number> {
    try {
      const row = await this.#db
        .selectFrom("business.artifact_manifests")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("content_sha256", "=", contentHash)
        .executeTakeFirst();
      return Number(row?.count ?? 0);
    } catch (error) {
      throw readError(error, "registry.count");
    }
  }

  async withAdvisoryLock<T>(
    policy: ArtifactStorePolicyV1,
    work: () => Promise<T>,
    mode: "shared" | "exclusive" = "exclusive",
  ): Promise<T> {
    const validPolicy = ArtifactStorePolicyV1Schema.parse(policy);
    if (this.#pool === undefined) return work();
    const client = await this.#pool.connect();
    const lockName = "riskflow.c04.artifact-store";
    const deadline = Date.now() + validPolicy.registrationTimeoutMs;
    try {
      let acquired = false;
      while (!acquired && Date.now() <= deadline) {
        const result = await client.query<{ acquired: boolean }>(
          `SELECT pg_try_advisory_lock${mode === "shared" ? "_shared" : ""}(hashtext($1)) AS acquired`,
          [lockName],
        );
        acquired = result.rows[0]?.acquired === true;
        if (!acquired) await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      if (!acquired)
        throw makeArtifactError("ARTIFACT_MAINTENANCE_BUSY", "registry.advisory-lock", [], true);
      try {
        return await work();
      } finally {
        await client.query(
          `SELECT pg_advisory_unlock${mode === "shared" ? "_shared" : ""}(hashtext($1))`,
          [lockName],
        );
      }
    } catch (error) {
      throw readError(error, "registry.advisory-lock");
    } finally {
      client.release();
    }
  }

  async recordMaintenanceBatch(input: {
    batch: ArtifactMaintenanceBatchV1;
    idempotencyKey: string;
    actorId: string;
    authorizationContextRef: AuthorizationContextRefV1;
  }): Promise<ArtifactMaintenanceBatchV1> {
    const batch = ArtifactMaintenanceBatchV1Schema.parse(input.batch);
    const atomic = AtomicCommandV1Schema.parse({
      projectId: batch.projectId,
      commandKind: `artifact.${batch.operation}.batch.v1`,
      commandId: batch.commandId,
      idempotencyKey: input.idempotencyKey,
      payload: { schemaVersion: "1", batch },
      actorRef: input.actorId,
      authorizationContextRef: input.authorizationContextRef,
      issuedAt: batch.persistedAt,
      runId: batch.runId,
    });
    try {
      await this.#trackTransaction(() =>
        this.#transactionUnit.execute(atomic, async (context) => {
          const transaction = asRegistryTransaction(context);
          await transaction
            .insertInto("business.artifact_maintenance_batches")
            .values({
              schema_version: batch.schemaVersion,
              run_id: batch.runId,
              batch_number: batch.batchNumber,
              project_id: batch.projectId,
              command_id: batch.commandId,
              operation: batch.operation,
              policy_ref: jsonValue(batch.policyRef),
              policy_sha256: batch.policySha256,
              run_started_at: batch.runStartedAt,
              cutoff: batch.cutoff,
              dry_run: batch.dryRun,
              candidate_hashes: jsonValue(batch.candidateHashes),
              audit_entry_id: batch.auditTrailRef.reference.entityId,
              persisted_at: batch.persistedAt,
            })
            .onConflict((conflict) => conflict.columns(["run_id", "batch_number"]).doNothing())
            .execute();
          await this.#failpoint("audit.commit");
          const auditAction =
            batch.operation === "quarantine-recovery"
              ? "artifact.orphan-sweep-recovered"
              : "artifact.orphan-sweep";
          return {
            resultRef: batch.auditTrailRef,
            audit: {
              auditEntryId: batch.auditTrailRef.reference.entityId,
              projectId: batch.projectId,
              action: auditAction,
              targetRef: targetProject(batch.projectId),
              actorRef: input.actorId,
              authorizationContextRef: input.authorizationContextRef,
              occurredAt: batch.persistedAt,
              recordedAt: batch.persistedAt,
              version: { entityId: batch.runId, versionId: `batch-${batch.batchNumber}` },
              commandId: batch.commandId,
              idempotencyKey: input.idempotencyKey,
              runId: batch.runId,
            },
            events: [],
          };
        }),
      );
      return batch;
    } catch (error) {
      throw readError(error, "registry.maintenance-batch");
    }
  }

  async listMaintenanceBatches(
    projectId: string,
    runId: string,
  ): Promise<ArtifactMaintenanceBatchV1[]> {
    try {
      const rows = await this.#db
        .selectFrom("business.artifact_maintenance_batches")
        .selectAll()
        .where("project_id", "=", projectId)
        .where("run_id", "=", runId)
        .orderBy("batch_number", "asc")
        .execute();
      return rows.map((row) =>
        ArtifactMaintenanceBatchV1Schema.parse({
          schemaVersion: row.schema_version,
          runId: row.run_id,
          batchNumber: row.batch_number,
          projectId: row.project_id,
          commandId: row.command_id,
          operation: row.operation,
          policyRef: row.policy_ref,
          policySha256: row.policy_sha256,
          runStartedAt: asIso(row.run_started_at),
          cutoff: asIso(row.cutoff),
          dryRun: row.dry_run,
          candidateHashes: row.candidate_hashes,
          auditTrailRef: {
            kind: "audit-trail",
            reference: { entityId: row.audit_entry_id, versionId: "v1" },
          },
          persistedAt: asIso(row.persisted_at),
        }),
      );
    } catch (error) {
      throw readError(error, "registry.maintenance-batches");
    }
  }

  async appendMaintenanceAudit(command: {
    runId: string;
    commandId: string;
    idempotencyKey: string;
    projectId: string;
    actorId: string;
    authorizationContextRef: AuthorizationContextRefV1;
    issuedAt: string;
    auditEntryId?: string;
    action: "artifact.orphan-sweep" | "artifact.reconcile" | "artifact.orphan-sweep-recovered";
    payload: AtomicCommandV1["payload"];
  }): Promise<AuditTrailRefV1> {
    const auditEntryId =
      command.auditEntryId ?? `artifact-maintenance-audit-${command.runId}-${command.action}`;
    const targetRef = targetProject(command.projectId);
    const atomic = AtomicCommandV1Schema.parse({
      projectId: command.projectId,
      commandKind: `${command.action}.v1`,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      payload: {
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        projectId: command.projectId,
        actorId: command.actorId,
        authorizationContextRef: command.authorizationContextRef,
        issuedAt: command.issuedAt,
        action: command.action,
        details: command.payload,
      },
      actorRef: command.actorId,
      authorizationContextRef: command.authorizationContextRef,
      issuedAt: command.issuedAt,
      runId: command.runId,
    });
    try {
      await this.#trackTransaction(() =>
        this.#transactionUnit.execute(atomic, async () => ({
          resultRef: {
            kind: "audit-trail",
            reference: { entityId: auditEntryId, versionId: "v1" },
          },
          audit: {
            auditEntryId,
            projectId: command.projectId,
            action: command.action,
            targetRef,
            actorRef: command.actorId,
            authorizationContextRef: command.authorizationContextRef,
            occurredAt: command.issuedAt,
            recordedAt: command.issuedAt,
            version: { entityId: command.runId, versionId: "v1" },
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            runId: command.runId,
          },
          events: [],
        })),
      );
      return { kind: "audit-trail", reference: { entityId: auditEntryId, versionId: "v1" } };
    } catch (error) {
      throw readError(error, "registry.maintenance-audit");
    }
  }

  async hasContentHash(contentHash: string): Promise<boolean> {
    return (await this.countContentHash(contentHash)) > 0;
  }

  async close(): Promise<void> {
    this.#closed = true;
    await Promise.allSettled([...this.#activeTransactions]);
    await Promise.allSettled([...this.#activeSnapshots].map((finish) => finish()));
  }

  static manifestSha256(manifest: ArtifactManifestV1): string {
    return manifestSha256(manifest);
  }

  static evidenceReferencesSha256(manifest: ArtifactManifestV1): string {
    return evidenceReferencesSha256(manifest.evidenceReferences);
  }
}

export const createPostgresArtifactRegistry = (
  options: ArtifactRegistryOptionsV1,
): PostgresArtifactRegistry => new PostgresArtifactRegistry(options);

export const validateAuthorizationContext = (value: unknown): AuthorizationContextV1 =>
  AuthorizationContextV1Schema.parse(value);

export const validateArtifactManifest = (value: unknown): ArtifactManifestV1 =>
  ArtifactManifestV1Schema.parse(value);
