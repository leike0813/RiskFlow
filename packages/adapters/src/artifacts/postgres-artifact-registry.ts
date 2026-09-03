import { sql, type Kysely, type Transaction } from "kysely";
import type { Pool } from "pg";

import {
  ArtifactAccessSnapshotV1Schema,
  ArtifactManifestV1Schema,
  ArtifactPutCommandV1Schema,
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
  type ArtifactErrorV1,
  type ArtifactManifestV1,
  type ArtifactPutCommandV1,
  type ArtifactReferenceCheckRequestV1,
  type ArtifactReferenceCheckResultV1,
  type ArtifactRefV1,
  type ArtifactStorePolicyV1,
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

type ArtifactRegistryDatabase = PostgresDatabase & {
  "business.artifact_manifests": ArtifactManifestRow;
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

  constructor(options: ArtifactRegistryOptionsV1) {
    this.#db = options.db as unknown as Kysely<ArtifactRegistryDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#pool = options.pool;
    this.#failpoint = options.failpoint ?? (() => undefined);
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

  async preparePutMetadata(command: ArtifactPutCommandV1): Promise<ArtifactPreparedMetadataV1> {
    const parsed = ArtifactPutCommandV1Schema.safeParse(command);
    if (!parsed.success) throw makeArtifactError("ARTIFACT_INPUT_INVALID", "registry.put-command");
    const value = parsed.data;
    const snapshots: ArtifactAccessSnapshotV1[] = [accessForAuthorization(value.authorization)];
    const evidenceGroups: ArtifactManifestV1["evidenceReferences"][] = [value.evidenceReferences];
    for (const parentRef of value.parentArtifactRefs) {
      const parent = await this.readManifest(value.projectId, parentRef);
      if (parent === undefined) {
        throw makeArtifactError("ARTIFACT_INHERITANCE_CONFLICT", "registry.parent-not-found", [
          parentRef,
        ]);
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
          throw makeArtifactError(
            "ARTIFACT_INHERITANCE_CONFLICT",
            "registry.parent-authorization",
            [parentRef],
          );
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
      const receipt = await this.#transactionUnit.execute(atomicCommand, async (context) => {
        inserted = true;
        await this.#failpoint("registry.handler");
        const transaction = asRegistryTransaction(context);
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
      });
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

  async recordReadStarted(request: {
    requestId: string;
    idempotencyKey: string;
    projectId: string;
    actorId: string;
    requestedAt: string;
    purposeCode: string;
    requiredCapability: ArtifactReferenceCheckRequestV1["requiredCapability"];
    authorizationContextRef: AuthorizationContextRefV1;
    artifactRef: ArtifactRefV1;
    manifestSha256: string;
  }): Promise<void> {
    const auditEntryId = `artifact-read-audit-${request.requestId}`;
    const command = AtomicCommandV1Schema.parse({
      projectId: request.projectId,
      commandKind: "artifact.read-started.v1",
      commandId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      payload: {
        commandId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        projectId: request.projectId,
        actorId: request.actorId,
        authorizationContextRef: request.authorizationContextRef,
        requiredCapability: request.requiredCapability,
        artifactRef: request.artifactRef,
        manifestSha256: request.manifestSha256,
        purposeCode: request.purposeCode,
      },
      actorRef: request.actorId,
      authorizationContextRef: request.authorizationContextRef,
      issuedAt: request.requestedAt,
    });
    try {
      await this.#transactionUnit.execute(command, async () => ({
        resultRef: request.artifactRef,
        audit: {
          auditEntryId,
          projectId: request.projectId,
          action: "artifact.read-started",
          targetRef: request.artifactRef,
          actorRef: request.actorId,
          authorizationContextRef: request.authorizationContextRef,
          occurredAt: request.requestedAt,
          recordedAt: request.requestedAt,
          version: request.artifactRef.reference,
          commandId: request.requestId,
          idempotencyKey: request.idempotencyKey,
        },
        events: [],
      }));
    } catch (error) {
      throw readError(error, "registry.read-audit");
    }
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
    excludeArtifactId?: string,
  ): AsyncGenerator<ArtifactManifestV1> {
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
        if (excludeArtifactId !== undefined)
          query = query.where("artifact_id", "<>", excludeArtifactId);
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

  async appendMaintenanceAudit(command: {
    runId: string;
    commandId: string;
    idempotencyKey: string;
    projectId: string;
    actorId: string;
    authorizationContextRef: AuthorizationContextRefV1;
    issuedAt: string;
    action: "artifact.orphan-sweep" | "artifact.reconcile";
    payload: AtomicCommandV1["payload"];
  }): Promise<AuditTrailRefV1> {
    const auditEntryId = `artifact-maintenance-audit-${command.runId}`;
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
      await this.#transactionUnit.execute(atomic, async () => ({
        resultRef: { kind: "audit-trail", reference: { entityId: auditEntryId, versionId: "v1" } },
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
      }));
      return { kind: "audit-trail", reference: { entityId: auditEntryId, versionId: "v1" } };
    } catch (error) {
      throw readError(error, "registry.maintenance-audit");
    }
  }

  async hasContentHash(contentHash: string): Promise<boolean> {
    return (await this.countContentHash(contentHash)) > 0;
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
