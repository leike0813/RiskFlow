import { TextDecoder } from "node:util";
import {
  sql,
  type ColumnType,
  type InsertObject,
  type Kysely,
  type Selectable,
  type Transaction,
} from "kysely";

import {
  ACCESS_POLICY_REF_V1,
  AccessServiceError,
  AccessCommandResultV1Schema,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  ArtifactReadRequestV1Schema,
  ArtifactReferenceCheckRequestV1Schema,
  ArtifactStoreError,
  mapArtifactErrorToModuleError,
  manifestSha256,
  type ArtifactManifestV1,
  type ArtifactReferenceGuardV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  AtomicCommandV1Schema,
  sha256CanonicalJson,
  type AtomicCommitV1,
  type AtomicCommandV1,
  type JsonValue,
  type TransactionContextV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import {
  buildApplicabilityMetadataSnapshot,
  buildProjectBusinessRevision,
  buildSourceSegmentSet,
  buildSpatialBusinessRevision,
  CONTEXT_SOURCE_MAX_SEGMENT_BATCH,
  ContextSourceResultV1Schema,
  ApplicabilityMetadataSnapshotV1Schema,
  CreateApplicabilitySnapshotCommandV1Schema,
  EngineeringContextRevisionCommandV1Schema,
  ProjectBusinessRevisionV1Schema,
  RegisterSourceSegmentSetCommandV1Schema,
  SourceDeliveryMetadataEnvelopeV1Schema,
  SourceSegmentSetV1Schema,
  SourceVersionV1Schema,
  SpatialBusinessRevisionV1Schema,
  type ApplicabilityMetadataSnapshotV1,
  type ContextSourceResultV1,
  type ContextSourceSuccessV1,
  type CreateApplicabilitySnapshotCommandV1,
  type EngineeringContextRevisionCommandV1,
  type ProjectBusinessRevisionV1,
  type RegisterSourceSegmentSetCommandV1,
  type SourceDeliveryMetadataEnvelopeV1,
  type SourceSegmentSetV1,
  type SourceVersionV1,
  type SpatialBusinessRevisionV1,
  type EngineeringContextSourceRegistryV1,
} from "@riskflow/core/engineering-data/context-source";
import {
  EngineeringDataCommandV1Schema,
  EngineeringDataQueryV1Schema,
  EngineeringFreezeCommandV1Schema,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type ContentArtifactRefV1,
  type EngineeringDataApplyResultV1,
  type EngineeringDataCommandV1,
  type EngineeringDataPortV1,
  type EngineeringDataReadResultV1,
  type EngineeringDataQueryV1,
  type EngineeringFreezeCommandV1,
  type EngineeringFreezeResultV1,
  type ModuleErrorV1,
  type SourceAccessGrantRefV1,
  type SourceDeliveryRefV1,
  type SourceVersionRefV1,
  type SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";

import { getPostgresTransaction } from "../../postgres/transaction-unit.js";
import {
  makePersistenceError,
  mapPostgresError,
  type PostgresPersistenceError,
} from "../../postgres/pool.js";
import type { PostgresDatabase } from "../../postgres/types.js";

type JsonColumn = ColumnType<JsonValue, JsonValue, JsonValue>;
type TimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;

interface ProjectRevisionRow {
  revision_id: string;
  project_id: string;
  revision_no: number;
  project_revision_ref: JsonColumn;
  name: string;
  lifecycle: ProjectBusinessRevisionV1["lifecycle"];
  applicability_metadata: JsonColumn;
  effective_period: JsonColumn;
  system_time: JsonColumn;
  previous_revision_id: string | null;
  actor_id: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface ProjectIdentityRow {
  project_id: string;
  current_revision_id: string;
  created_at: TimestampColumn;
}

interface SpatialRevisionRow {
  revision_id: string;
  scope_id: string;
  project_id: string;
  revision_no: number;
  spatial_scope_ref: JsonColumn;
  project_revision_ref: JsonColumn;
  parent_scope_ref: JsonColumn | null;
  name: string;
  worksite_location: string;
  chainage: JsonColumn | null;
  applicability_overrides: JsonColumn;
  status: SpatialBusinessRevisionV1["status"];
  effective_period: JsonColumn;
  system_time: JsonColumn;
  previous_revision_id: string | null;
  actor_id: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface SpatialIdentityRow {
  scope_id: string;
  project_id: string;
  current_revision_id: string;
  created_at: TimestampColumn;
}

interface SourceItemRow {
  source_item_id: string;
  project_id: string;
  name: string;
  category: string;
  actor_id: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  created_at: TimestampColumn;
}

interface SourceDeliveryRow {
  source_delivery_id: string;
  version_id: string;
  project_id: string;
  source_item_id: string;
  delivery_key: string;
  source_delivery_ref: JsonColumn;
  project_revision_ref: JsonColumn;
  spatial_scope_refs: JsonColumn;
  descriptor: JsonColumn;
  source_metadata: JsonColumn;
  source_artifact_ref: JsonColumn;
  metadata_artifact_ref: JsonColumn;
  applicability_snapshot_ref: JsonColumn;
  registered_by: string;
  authorization_context_ref: JsonColumn;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
  audit_entry_id: string;
}

interface SourceVersionRow {
  source_version_id: string;
  version_id: string;
  source_id: string;
  project_id: string;
  source_item_id: string;
  source_delivery_id: string;
  source_delivery_ref: JsonColumn;
  source_version_ref: JsonColumn;
  source_version_sequence: number;
  project_revision_ref: JsonColumn;
  spatial_scope_refs: JsonColumn;
  source_artifact_ref: JsonColumn;
  metadata_artifact_ref: JsonColumn;
  source_access_grant_ref: JsonColumn | null;
  access_status: "pending-access" | "ready";
  applicability_snapshot_ref: JsonColumn;
  previous_source_version_id: string | null;
  registered_by: string;
  authorization_context_ref: JsonColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
  audit_entry_id: string;
}

interface SegmentSetRow {
  source_segment_set_id: string;
  version_id: string;
  project_id: string;
  source_version_id: string;
  source_id: string;
  source_segment_set_ref: JsonColumn;
  actor_id: string;
  authorization_context_ref: JsonColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
  audit_entry_id: string;
}

interface SegmentRow {
  source_segment_id: string;
  project_id: string;
  source_version_id: string;
  source_segment_set_id: string;
  chapter_id: string;
  segment_id: string;
  kind: string;
  spatial_scope_refs: JsonColumn;
  locator: JsonColumn;
  recorded_at: TimestampColumn;
}

interface ApplicabilitySnapshotRow {
  snapshot_id: string;
  version_id: string;
  project_id: string;
  snapshot_ref: JsonColumn;
  applicability_metadata: JsonColumn;
  provenance: JsonColumn;
  project_revision_ref: JsonColumn;
  spatial_scope_ref: JsonColumn;
  formed_at: TimestampColumn;
  worksite_location: string | null;
  chainage: JsonColumn | null;
  actor_id: string;
  authorization_context_ref: JsonColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
  audit_entry_id: string;
}

type ContextSourceDatabase = PostgresDatabase & {
  "business.engineering_projects": ProjectIdentityRow;
  "business.engineering_project_revisions": ProjectRevisionRow;
  "business.engineering_spatial_segments": SpatialIdentityRow;
  "business.engineering_spatial_segment_revisions": SpatialRevisionRow;
  "business.source_items": SourceItemRow;
  "business.source_deliveries": SourceDeliveryRow;
  "business.source_versions": SourceVersionRow;
  "business.source_segment_sets": SegmentSetRow;
  "business.source_segments": SegmentRow;
  "business.applicability_metadata_snapshots": ApplicabilitySnapshotRow;
};

type ContextTransaction = Transaction<ContextSourceDatabase>;
type ContextSourceError = ModuleErrorV1;

const asTransaction = (context: TransactionContextV1): ContextTransaction =>
  getPostgresTransaction(context) as unknown as ContextTransaction;

const jsonValue = (value: unknown): JsonValue => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined)
    throw makePersistenceError("TRANSACTION_FAILED", "context-source.json");
  return serialized as JsonValue;
};

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const nowIso = (clock: () => Date): string => {
  const value = clock();
  if (Number.isNaN(value.getTime())) throw new TypeError("clock returned an invalid date");
  return value.toISOString();
};

const refKey = (value: {
  kind: string;
  reference: { entityId: string; versionId: string };
}): string => `${value.kind}/${value.reference.entityId}/${value.reference.versionId}`;

const sameVersion = (
  left: VersionReference | { reference: { entityId: string; versionId: string } },
  right: VersionReference | { reference: { entityId: string; versionId: string } },
): boolean => {
  const leftRef = "reference" in left ? left.reference : left;
  const rightRef = "reference" in right ? right.reference : right;
  return leftRef.entityId === rightRef.entityId && leftRef.versionId === rightRef.versionId;
};

const sameEntity = (
  left: { reference: { entityId: string } },
  right: { reference: { entityId: string } },
): boolean => left.reference.entityId === right.reference.entityId;

const versionIdFromReference = (value: ContractReferenceV1): string =>
  "reference" in value ? value.reference.versionId : String(value.eventVersion);

const ref = <T extends string>(kind: T, entityId: string, versionId: string) => ({
  kind,
  reference: { entityId, versionId },
});

const sourceIdFor = (command: EngineeringDataCommandV1): string =>
  `s_${sha256CanonicalJson({ projectId: command.projectId, commandId: command.commandId }).slice(0, 32)}`;
const deliveryIdFor = (command: EngineeringDataCommandV1): string =>
  `d_${sha256CanonicalJson({ projectId: command.projectId, commandId: command.commandId }).slice(0, 32)}`;

const sourceVersionRefFor = (sourceId: string): SourceVersionRefV1 =>
  ref("source-version", sourceId, "1") as SourceVersionRefV1;
const sourceDeliveryRefFor = (deliveryId: string): SourceDeliveryRefV1 =>
  ref("source-delivery", deliveryId, "1") as SourceDeliveryRefV1;
const projectRevisionStorageId = (projectId: string, versionId: string): string =>
  `${projectId}:${versionId}`;
const spatialRevisionStorageId = (scopeId: string, versionId: string): string =>
  `${scopeId}:${versionId}`;
const lifecycleRank: Record<ProjectBusinessRevisionV1["lifecycle"], number> = {
  preparing: 0,
  active: 1,
  ended: 2,
  archived: 3,
};

const sourceAccessGrantRef = (value: {
  entityId: string;
  versionId: string;
}): SourceAccessGrantRefV1 =>
  ref("source-access-grant", value.entityId, value.versionId) as SourceAccessGrantRefV1;

const auditEntryIdFor = (commandId: string, suffix = "") => `audit-${commandId}${suffix}`;

const moduleError = (
  code: ContextSourceError["code"],
  causalRunId: string,
  extras: Partial<Extract<ContextSourceError, { code: typeof code }>> = {},
): ContextSourceError => {
  const common = {
    stageCode: "engineering-data.context-source",
    occurredAt: new Date().toISOString(),
    causalRunId,
  };
  if (code === "AUTHORIZATION_DENIED") {
    return {
      ...common,
      code,
      category: "authorization",
      retryable: false,
      requiredCapability: "engineering-data.write",
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
      ...extras,
    } as ContextSourceError;
  }
  if (code === "ENTITY_NOT_FOUND" || code === "STALE_VERSION") {
    return {
      ...common,
      code,
      category: code === "ENTITY_NOT_FOUND" ? "not-found" : "concurrency",
      retryable: false,
      targetRef: ref("project-revision", "unknown", "unknown"),
      ...extras,
    } as ContextSourceError;
  }
  if (code === "IDEMPOTENCY_CONFLICT") {
    return {
      ...common,
      code,
      category: "idempotency",
      retryable: false,
      idempotencyKey: "unknown",
      priorCommandId: "unknown",
      ...extras,
    } as ContextSourceError;
  }
  if (code === "BUSINESS_BLOCKED") {
    return {
      ...common,
      code,
      category: "business-blocked",
      retryable: false,
      blockerKind: "project-revision",
      blockerRef: ref("project-revision", "unknown", "unknown"),
      ...extras,
    } as ContextSourceError;
  }
  if (code === "UNSUPPORTED_CONTRACT") {
    return {
      ...common,
      code,
      category: "technical",
      retryable: false,
      schemaVersion: "1",
      ...extras,
    } as ContextSourceError;
  }
  if (code === "TRANSIENT_FAILURE") {
    return {
      ...common,
      code,
      category: "technical",
      retryable: true,
      attempt: 1,
      retryPolicyRef: { entityId: "engineering-data-retry-policy", versionId: "1" },
      diagnosticRef: {
        kind: "diagnostic-artifact",
        reference: { entityId: "engineering-data-failure", versionId: "1" },
      },
      ...extras,
    } as ContextSourceError;
  }
  return {
    ...common,
    code,
    category: "technical",
    retryable: false,
    diagnosticRef: {
      kind: "diagnostic-artifact",
      reference: { entityId: "engineering-data-failure", versionId: "1" },
    },
    ...extras,
  } as ContextSourceError;
};

const resultFailure = (error: ContextSourceError): ContextSourceResultV1 =>
  ContextSourceResultV1Schema.parse({ kind: "failed", error });

const resultSuccess = (result: ContextSourceSuccessV1): ContextSourceResultV1 =>
  ContextSourceResultV1Schema.parse({ kind: "succeeded", result });

const toProjectRevision = (row: Selectable<ProjectRevisionRow>): ProjectBusinessRevisionV1 =>
  ProjectBusinessRevisionV1Schema.parse({
    projectRevisionRef: row.project_revision_ref,
    name: row.name,
    lifecycle: row.lifecycle,
    applicabilityMetadata: row.applicability_metadata,
    effectivePeriod: row.effective_period,
    systemTime: row.system_time,
    ...(row.previous_revision_id === null
      ? {}
      : {
          previousRevisionRef: ref(
            "project-revision",
            row.project_id,
            row.previous_revision_id.split(":").at(-1) ?? "1",
          ),
        }),
    audit: {
      actorId: row.actor_id,
      action: "engineering-data.context",
      recordedAt: asIso(row.recorded_at),
    },
  });

const toSpatialRevision = (row: Selectable<SpatialRevisionRow>): SpatialBusinessRevisionV1 =>
  SpatialBusinessRevisionV1Schema.parse({
    spatialScopeRef: row.spatial_scope_ref,
    projectRevisionRef: row.project_revision_ref,
    ...(row.parent_scope_ref === null ? {} : { parentScopeRef: row.parent_scope_ref }),
    name: row.name,
    worksiteLocation: row.worksite_location,
    ...(row.chainage === null ? {} : { chainage: row.chainage }),
    applicabilityOverrides: row.applicability_overrides,
    status: row.status,
    effectivePeriod: row.effective_period,
    systemTime: row.system_time,
    ...(row.previous_revision_id === null
      ? {}
      : {
          previousRevisionRef: ref(
            "spatial-scope",
            row.scope_id,
            row.previous_revision_id.split(":").at(-1) ?? "1",
          ),
        }),
    audit: {
      actorId: row.actor_id,
      action: "engineering-data.context",
      recordedAt: asIso(row.recorded_at),
    },
  });

const toSourceVersion = (row: Selectable<SourceVersionRow>): SourceVersionV1 =>
  SourceVersionV1Schema.parse({
    sourceVersionRef: row.source_version_ref,
    projectId: row.project_id,
    sourceId: row.source_id,
    sourceItemId: row.source_item_id,
    sourceDeliveryRef: row.source_delivery_ref,
    projectRevisionRef: row.project_revision_ref,
    spatialScopeRefs: row.spatial_scope_refs,
    sourceArtifactRef: row.source_artifact_ref,
    metadataArtifactRef: row.metadata_artifact_ref,
    ...(row.source_access_grant_ref === null
      ? {}
      : { sourceAccessGrantRef: row.source_access_grant_ref }),
    accessStatus: row.access_status,
    applicabilityMetadataSnapshotRef: row.applicability_snapshot_ref,
    ...(row.previous_source_version_id === null
      ? {}
      : {
          previousSourceVersionRef: ref("source-version", row.previous_source_version_id, "1"),
        }),
    recordedAt: asIso(row.recorded_at),
    audit: {
      actorId: row.registered_by,
      action: "engineering-data.register-source-delivery",
      recordedAt: asIso(row.recorded_at),
    },
  });

const sourceSegmentSetResult = (set: SourceSegmentSetV1): ContextSourceResultV1 =>
  resultSuccess({ kind: "source-segment-set", segmentSet: set });

const preserveDomainError = (error: ContextSourceError): PostgresPersistenceError => {
  const wrapped = makePersistenceError("TRANSACTION_FAILED", "context-source.domain");
  Object.defineProperty(wrapped, "contextSourceError", { value: error });
  return wrapped;
};

const atomicCommand = (
  command: {
    commandId: string;
    idempotencyKey: string;
    projectId: string;
    actorId: string;
    issuedAt: string;
    authorization: AuthorizationContextV1;
  },
  commandKind: string,
  payload: object,
): AtomicCommandV1 =>
  AtomicCommandV1Schema.parse({
    projectId: command.projectId,
    commandKind,
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    payload: JSON.parse(JSON.stringify(payload)) as Record<string, JsonValue>,
    actorRef: command.actorId,
    authorizationContextRef: command.authorization.authorizationContextRef,
    issuedAt: command.issuedAt,
  });

const auditAppend = (
  command: {
    commandId: string;
    idempotencyKey: string;
    projectId: string;
    actorId: string;
    issuedAt: string;
    authorization: AuthorizationContextV1;
  },
  action: string,
  targetRef: ContractReferenceV1,
  version: VersionReference,
  recordedAt: string,
  auditEntryId = auditEntryIdFor(command.commandId),
) => ({
  auditEntryId,
  projectId: command.projectId,
  action,
  targetRef,
  actorRef: command.actorId,
  authorizationContextRef: command.authorization.authorizationContextRef,
  occurredAt: command.issuedAt,
  recordedAt,
  version,
  commandId: command.commandId,
  idempotencyKey: command.idempotencyKey,
});

const commit = (
  command: {
    commandId: string;
    idempotencyKey: string;
    projectId: string;
    actorId: string;
    issuedAt: string;
    authorization: AuthorizationContextV1;
  },
  action: string,
  targetRef: ContractReferenceV1,
  version: VersionReference,
  recordedAt: string,
  auditEntryId = auditEntryIdFor(command.commandId),
): AtomicCommitV1 => ({
  resultRef: targetRef,
  audit: auditAppend(command, action, targetRef, version, recordedAt, auditEntryId),
  events: [],
});

export interface PostgresEngineeringContextSourceRegistryOptions {
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: TransactionUnitV1;
  readonly access: LocalIdentityAccessV1;
  readonly artifactStore?: ArtifactStoreV1;
  readonly artifactReferenceGuard?: ArtifactReferenceGuardV1;
  readonly artifacts?: {
    readonly store: ArtifactStoreV1;
    readonly referenceGuard: ArtifactReferenceGuardV1;
  };
  readonly now?: () => Date;
}

export class PostgresEngineeringContextSourceRegistry
  implements EngineeringDataPortV1, EngineeringContextSourceRegistryV1
{
  readonly #db: Kysely<ContextSourceDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #access: LocalIdentityAccessV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #artifactGuard: ArtifactReferenceGuardV1;
  readonly #now: () => Date;

  constructor(options: PostgresEngineeringContextSourceRegistryOptions) {
    const store = options.artifactStore ?? options.artifacts?.store;
    const guard = options.artifactReferenceGuard ?? options.artifacts?.referenceGuard;
    if (store === undefined || guard === undefined) {
      throw new TypeError("C11 requires an ArtifactStoreV1 and ArtifactReferenceGuardV1");
    }
    this.#db = options.db as unknown as Kysely<ContextSourceDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#access = options.access;
    this.#artifactStore = store;
    this.#artifactGuard = guard;
    this.#now = options.now ?? (() => new Date());
  }

  async reviseContext(
    command: EngineeringContextRevisionCommandV1,
  ): Promise<ContextSourceResultV1> {
    const parsed = EngineeringContextRevisionCommandV1Schema.safeParse(command);
    if (!parsed.success)
      return resultFailure(moduleError("UNSUPPORTED_CONTRACT", "context-revision"));
    const valid = parsed.data;
    try {
      if (
        valid.kind === "spatial" &&
        !valid.authorization.spatialScopeRefs.some((scope) =>
          sameEntity(scope, valid.spatialScopeRef),
        )
      ) {
        return resultFailure(moduleError("AUTHORIZATION_DENIED", valid.commandId));
      }
      await this.#verify(
        valid,
        valid.kind === "project" ? [] : valid.authorization.spatialScopeRefs,
        [],
      );
      const atomic = atomicCommand(valid, "engineering-data.context-revision.v1", valid);
      const receipt = await this.#transactionUnit.execute(atomic, async (context) =>
        valid.kind === "project"
          ? this.#reviseProjectInTransaction(context, valid)
          : this.#reviseSpatialInTransaction(context, valid),
      );
      const target = receipt.resultRef;
      const revision =
        valid.kind === "project"
          ? await this.#readProjectRevision(valid.projectId, versionIdFromReference(target))
          : await this.#readSpatialRevision(
              valid.projectId,
              valid.spatialScopeRef.reference.entityId,
              versionIdFromReference(target),
            );
      if (revision === undefined)
        return resultFailure(moduleError("TERMINAL_FAILURE", valid.commandId));
      return valid.kind === "project"
        ? resultSuccess({
            kind: "project-revision",
            revision: revision as ProjectBusinessRevisionV1,
          })
        : resultSuccess({
            kind: "spatial-revision",
            revision: revision as SpatialBusinessRevisionV1,
          });
    } catch (error) {
      return resultFailure(
        this.#mapError(error, valid.commandId, "engineering-data.context-revision"),
      );
    }
  }

  async registerSegments(
    command: RegisterSourceSegmentSetCommandV1,
  ): Promise<ContextSourceResultV1> {
    const parsed = RegisterSourceSegmentSetCommandV1Schema.safeParse(command);
    if (!parsed.success)
      return resultFailure(moduleError("UNSUPPORTED_CONTRACT", "source-segments"));
    const valid = parsed.data;
    try {
      await this.#verify(valid, valid.authorization.spatialScopeRefs, [valid.sourceVersionRef]);
      const sourceVersion = await this.#readSourceVersion(valid.projectId, valid.sourceVersionRef);
      if (sourceVersion === undefined) {
        return resultFailure(moduleError("AUTHORIZATION_DENIED", valid.commandId));
      }
      const atomic = atomicCommand(valid, "engineering-data.source-segments.v1", valid);
      const receipt = await this.#transactionUnit.execute(atomic, async (context) =>
        this.#registerSegmentsInTransaction(context, valid, sourceVersion),
      );
      const set = await this.#readSegmentSet(valid.projectId, receipt.resultRef);
      return set === undefined
        ? resultFailure(moduleError("TERMINAL_FAILURE", valid.commandId))
        : sourceSegmentSetResult(set);
    } catch (error) {
      return resultFailure(
        this.#mapError(error, valid.commandId, "engineering-data.source-segments"),
      );
    }
  }

  async createApplicabilitySnapshot(
    command: CreateApplicabilitySnapshotCommandV1,
  ): Promise<ContextSourceResultV1> {
    const parsed = CreateApplicabilitySnapshotCommandV1Schema.safeParse(command);
    if (!parsed.success)
      return resultFailure(moduleError("UNSUPPORTED_CONTRACT", "applicability-snapshot"));
    const valid = parsed.data;
    try {
      if (
        !valid.authorization.spatialScopeRefs.some((scope) =>
          sameEntity(scope, valid.spatialScopeRef),
        )
      ) {
        return resultFailure(moduleError("AUTHORIZATION_DENIED", valid.commandId));
      }
      await this.#verify(valid, valid.authorization.spatialScopeRefs, []);
      const atomic = atomicCommand(valid, "engineering-data.applicability-snapshot.v1", valid);
      const receipt = await this.#transactionUnit.execute(atomic, async (context) =>
        this.#createSnapshotInTransaction(context, valid),
      );
      const snapshot = await this.#readSnapshot(valid.projectId, receipt.resultRef);
      return snapshot === undefined
        ? resultFailure(moduleError("TERMINAL_FAILURE", valid.commandId))
        : resultSuccess({ kind: "applicability-snapshot", snapshot });
    } catch (error) {
      return resultFailure(
        this.#mapError(error, valid.commandId, "engineering-data.applicability-snapshot"),
      );
    }
  }

  async apply(command: EngineeringDataCommandV1): Promise<EngineeringDataApplyResultV1> {
    const parsed = EngineeringDataCommandV1Schema.safeParse(command);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: moduleError("UNSUPPORTED_CONTRACT", "engineering-data.apply"),
      };
    }
    const valid = parsed.data;
    if (valid.kind !== "register-source-delivery") {
      return {
        kind: "failed",
        error: moduleError("UNSUPPORTED_CONTRACT", valid.commandId),
      };
    }
    return this.#registerSourceDelivery(valid);
  }

  async freeze(command: EngineeringFreezeCommandV1): Promise<EngineeringFreezeResultV1> {
    const parsed = EngineeringFreezeCommandV1Schema.safeParse(command);
    return parsed.success
      ? { kind: "failed", error: moduleError("UNSUPPORTED_CONTRACT", parsed.data.commandId) }
      : { kind: "failed", error: moduleError("UNSUPPORTED_CONTRACT", "engineering-data.freeze") };
  }

  async read(query: EngineeringDataQueryV1): Promise<EngineeringDataReadResultV1> {
    const parsed = EngineeringDataQueryV1Schema.safeParse(query);
    return parsed.success
      ? { kind: "failed", error: moduleError("UNSUPPORTED_CONTRACT", parsed.data.queryId) }
      : { kind: "failed", error: moduleError("UNSUPPORTED_CONTRACT", "engineering-data.read") };
  }

  async #registerSourceDelivery(
    command: Extract<EngineeringDataCommandV1, { kind: "register-source-delivery" }>,
  ): Promise<EngineeringDataApplyResultV1> {
    try {
      await this.#verify(command, command.authorization.spatialScopeRefs, []);
      const metadataRead = await this.#readDeliveryMetadata(command);
      const envelope = metadataRead.envelope;
      if (envelope.registeredByAccountId !== command.actorId) {
        return { kind: "failed", error: moduleError("AUTHORIZATION_DENIED", command.commandId) };
      }
      if (
        envelope.projectRevisionRef.reference.entityId !== command.projectId ||
        !envelope.spatialScopeRefs.every((scope) =>
          command.authorization.spatialScopeRefs.some((item) => sameEntity(scope, item)),
        )
      ) {
        return { kind: "failed", error: moduleError("AUTHORIZATION_DENIED", command.commandId) };
      }
      if (
        (envelope.descriptor.kind === "database-snapshot" ||
          envelope.descriptor.kind === "api-snapshot") &&
        !sameVersion(
          envelope.descriptor.connectionDefinitionRef,
          command.payload.sourceConnectionRef,
        )
      ) {
        return {
          kind: "failed",
          error: moduleError("BUSINESS_BLOCKED", command.commandId, {
            blockerRef: ref(
              "source-version",
              command.payload.sourceConnectionRef.entityId,
              command.payload.sourceConnectionRef.versionId,
            ),
            blockerKind: "source-connection",
          }),
        };
      }
      const atomic = atomicCommand(command, "engineering-data.register-source-delivery.v1", {
        command,
        metadata: envelope,
      });
      const receipt = await this.#transactionUnit.execute(atomic, async (context) =>
        this.#registerSourceDeliveryInTransaction(context, command, envelope, metadataRead),
      );
      const sourceVersionRef = SourceVersionV1Schema.shape.sourceVersionRef.parse(
        receipt.resultRef,
      );
      await this.#verify(command, command.authorization.spatialScopeRefs, []);
      const sourceVersion = await this.#readSourceVersion(command.projectId, sourceVersionRef);
      if (sourceVersion === undefined) {
        return { kind: "failed", error: moduleError("TERMINAL_FAILURE", command.commandId) };
      }
      await this.#ensureSourceAccess(
        command,
        sourceVersion,
        command.authorization.spatialScopeRefs,
      );
      return {
        kind: "succeeded",
        result: {
          kind: "register-source-delivery",
          sourceDeliveryRef: sourceVersion.sourceDeliveryRef,
          sourceVersionRef: sourceVersion.sourceVersionRef,
        },
      };
    } catch (error) {
      return {
        kind: "failed",
        error: this.#mapError(
          error,
          command.commandId,
          "engineering-data.register-source-delivery",
        ),
      };
    }
  }

  async #readDeliveryMetadata(
    command: Extract<EngineeringDataCommandV1, { kind: "register-source-delivery" }>,
  ): Promise<{
    readonly envelope: SourceDeliveryMetadataEnvelopeV1;
    readonly manifest: ArtifactManifestV1;
    readonly manifestSha256: string;
  }> {
    const request = ArtifactReadRequestV1Schema.parse({
      schemaVersion: "1",
      requestId: `metadata-read-${command.commandId}`,
      idempotencyKey: `metadata-read-${command.idempotencyKey}`,
      artifactRef: command.payload.metadataArtifactRef,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.issuedAt,
      purposeCode: "engineering-data.register-source-delivery",
      requiredCapability: "engineering-data.write",
      authorization: command.authorization,
    });
    const handle = await this.#artifactStore.open(request);
    if (refKey(handle.manifest.artifactRef) !== refKey(command.payload.metadataArtifactRef)) {
      throw new Error("metadata artifact reference mismatch");
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of handle.content) {
      length += chunk.byteLength;
      if (length > 1024 * 1024) throw new Error("metadata artifact exceeds 1 MiB");
      chunks.push(chunk);
    }
    await handle.verified;
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return {
      envelope: SourceDeliveryMetadataEnvelopeV1Schema.parse(JSON.parse(text) as unknown),
      manifest: handle.manifest,
      manifestSha256: manifestSha256(handle.manifest),
    };
  }

  async #ensureSourceAccess(
    command: Extract<EngineeringDataCommandV1, { kind: "register-source-delivery" }>,
    sourceVersion: SourceVersionV1,
    spatialScopeRefs: readonly SpatialScopeRefV1[],
  ): Promise<void> {
    if (sourceVersion.accessStatus === "ready") return;
    const accessCommand = {
      kind: "revise-source-access" as const,
      projectId: command.projectId,
      commandId: `${command.commandId}:source-access`,
      idempotencyKey: `${command.idempotencyKey}:source-access`,
      expectedVersion: "none" as const,
      authorizationContextRef: command.authorization.authorizationContextRef,
      sourceVersionRef: sourceVersion.sourceVersionRef,
      visibility: "restricted" as const,
      allowedAccountIds: [command.actorId],
      spatialScopeRefs: [...spatialScopeRefs],
      registeredByAccountId: command.actorId,
    };
    const accessResult = AccessCommandResultV1Schema.parse(
      await this.#access.administerProject(accessCommand),
    );
    if (accessResult.kind !== "source-access") {
      throw preserveDomainError(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerRef: sourceVersion.sourceVersionRef,
          blockerKind: "source-access",
        }),
      );
    }
    const grant = sourceAccessGrantRef(accessResult.resultRef);
    const bindingCommand = {
      ...command,
      commandId: `${command.commandId}:source-access-bind`,
      idempotencyKey: `${command.idempotencyKey}:source-access-bind`,
    };
    const binding = atomicCommand(bindingCommand, "engineering-data.bind-source-access.v1", {
      sourceVersionRef: sourceVersion.sourceVersionRef,
      sourceAccessGrantRef: grant,
    });
    await this.#transactionUnit.execute(binding, async (context) => {
      const transaction = asTransaction(context);
      const row = await transaction
        .selectFrom("business.source_versions")
        .selectAll()
        .where("project_id", "=", command.projectId)
        .where("source_version_id", "=", sourceVersion.sourceVersionRef.reference.entityId)
        .where("version_id", "=", sourceVersion.sourceVersionRef.reference.versionId)
        .forUpdate()
        .executeTakeFirst();
      if (row === undefined)
        throw preserveDomainError(moduleError("AUTHORIZATION_DENIED", command.commandId));
      if (row.access_status === "ready") {
        if (
          row.source_access_grant_ref === null ||
          refKey(row.source_access_grant_ref as never) !== refKey(grant)
        ) {
          throw preserveDomainError(
            moduleError("BUSINESS_BLOCKED", command.commandId, {
              blockerRef: sourceVersion.sourceVersionRef,
              blockerKind: "source-access",
            }),
          );
        }
      } else {
        await transaction
          .updateTable("business.source_versions")
          .set({ source_access_grant_ref: jsonValue(grant), access_status: "ready" })
          .where("project_id", "=", command.projectId)
          .where("source_version_id", "=", sourceVersion.sourceVersionRef.reference.entityId)
          .where("version_id", "=", sourceVersion.sourceVersionRef.reference.versionId)
          .where("access_status", "=", "pending-access")
          .execute();
      }
      return commit(
        bindingCommand,
        "engineering-data.bind-source-access",
        sourceVersion.sourceVersionRef,
        sourceVersion.sourceVersionRef.reference,
        nowIso(this.#now),
        auditEntryIdFor(bindingCommand.commandId),
      );
    });
  }

  async #verify(
    command: {
      commandId: string;
      projectId: string;
      actorId: string;
      authorization: AuthorizationContextV1;
    },
    requestedSpatialScopeRefs: readonly SpatialScopeRefV1[],
    requestedSourceVersionRefs: readonly SourceVersionRefV1[],
  ): Promise<void> {
    if (
      command.projectId !== command.authorization.projectId ||
      command.actorId !== command.authorization.actorId ||
      !command.authorization.grantedCapabilities.includes("engineering-data.write")
    ) {
      throw preserveDomainError(moduleError("AUTHORIZATION_DENIED", command.commandId));
    }
    await this.#access.verify({
      authorizationContextRef: command.authorization.authorizationContextRef,
      invocationId: command.commandId,
      projectId: command.projectId,
      branch: "engineering-data.register-source-delivery",
      requestedSpatialScopeRefs: [...requestedSpatialScopeRefs],
      requestedSourceVersionRefs: [...requestedSourceVersionRefs],
      requestedAt: command.authorization.decidedAt,
    });
  }

  async #reviseProjectInTransaction(
    context: TransactionContextV1,
    command: Extract<EngineeringContextRevisionCommandV1, { kind: "project" }>,
  ): Promise<AtomicCommitV1> {
    const transaction = asTransaction(context);
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`riskflow.c11.project.${command.projectId}`}, 0))`.execute(
      transaction,
    );
    const identity = await transaction
      .selectFrom("business.engineering_projects")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .forUpdate()
      .executeTakeFirst();
    const previous =
      identity === undefined
        ? undefined
        : await transaction
            .selectFrom("business.engineering_project_revisions")
            .selectAll()
            .where("revision_id", "=", identity.current_revision_id)
            .where("project_id", "=", command.projectId)
            .executeTakeFirst();
    if (identity === undefined && command.expectedVersion !== "none") {
      throw preserveDomainError(
        moduleError("STALE_VERSION", command.commandId, {
          targetRef: ref("project-revision", command.projectId, command.expectedVersion.versionId),
        }),
      );
    }
    if (
      identity !== undefined &&
      (previous === undefined ||
        command.expectedVersion === "none" ||
        identity.current_revision_id !==
          projectRevisionStorageId(command.projectId, command.expectedVersion.versionId))
    ) {
      throw preserveDomainError(
        moduleError("STALE_VERSION", command.commandId, {
          targetRef: ref(
            "project-revision",
            command.projectId,
            command.expectedVersion === "none" ? "none" : command.expectedVersion.versionId,
          ),
        }),
      );
    }
    if (
      previous !== undefined &&
      (previous.lifecycle === "ended" || previous.lifecycle === "archived")
    ) {
      throw preserveDomainError(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerRef: ref("project-revision", command.projectId, String(previous.revision_no)),
          blockerKind: "project-lifecycle",
        }),
      );
    }
    if (
      previous !== undefined &&
      lifecycleRank[command.lifecycle] < lifecycleRank[previous.lifecycle]
    ) {
      throw preserveDomainError(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerRef: ref("project-revision", command.projectId, String(previous.revision_no)),
          blockerKind: "project-lifecycle",
        }),
      );
    }
    const previousRevision = previous === undefined ? undefined : toProjectRevision(previous);
    const revision = buildProjectBusinessRevision(command, previousRevision);
    const auditId = auditEntryIdFor(command.commandId);
    const revisionId = projectRevisionStorageId(
      command.projectId,
      revision.projectRevisionRef.reference.versionId,
    );
    if (identity === undefined) {
      await transaction
        .insertInto("business.engineering_projects")
        .values({
          project_id: command.projectId,
          current_revision_id: revisionId,
          created_at: sql`clock_timestamp()`,
        })
        .execute();
    }
    await transaction
      .insertInto("business.engineering_project_revisions")
      .values({
        revision_id: revisionId,
        project_id: command.projectId,
        revision_no: Number(revision.projectRevisionRef.reference.versionId),
        project_revision_ref: jsonValue(revision.projectRevisionRef),
        name: revision.name,
        lifecycle: revision.lifecycle,
        applicability_metadata: jsonValue(revision.applicabilityMetadata),
        effective_period: jsonValue(revision.effectivePeriod),
        system_time: jsonValue(revision.systemTime),
        previous_revision_id: previous === undefined ? null : identity!.current_revision_id,
        actor_id: command.actorId,
        authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
        audit_entry_id: auditId,
        occurred_at: command.issuedAt,
        recorded_at: command.issuedAt,
        persisted_at: sql`clock_timestamp()`,
      } satisfies InsertObject<ContextSourceDatabase, "business.engineering_project_revisions">)
      .execute();
    if (identity !== undefined) {
      const updated = await transaction
        .updateTable("business.engineering_projects")
        .set({ current_revision_id: revisionId })
        .where("project_id", "=", command.projectId)
        .where("current_revision_id", "=", identity.current_revision_id)
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) !== 1) {
        throw preserveDomainError(
          moduleError("STALE_VERSION", command.commandId, {
            targetRef:
              command.expectedVersion === "none"
                ? ref("project-revision", command.projectId, "none")
                : ref("project-revision", command.projectId, command.expectedVersion.versionId),
          }),
        );
      }
    }
    return commit(
      command,
      "engineering-data.revise-project-context",
      revision.projectRevisionRef,
      revision.projectRevisionRef.reference,
      command.issuedAt,
      auditId,
    );
  }

  async #reviseSpatialInTransaction(
    context: TransactionContextV1,
    command: Extract<EngineeringContextRevisionCommandV1, { kind: "spatial" }>,
  ): Promise<AtomicCommitV1> {
    const transaction = asTransaction(context);
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`riskflow.c11.project.${command.projectId}`}, 0))`.execute(
      transaction,
    );
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`riskflow.c11.spatial.${command.projectId}.${command.spatialScopeRef.reference.entityId}`}, 0))`.execute(
      transaction,
    );
    const project = await transaction
      .selectFrom("business.engineering_projects")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .forUpdate()
      .executeTakeFirst();
    if (
      project === undefined ||
      project.current_revision_id !==
        projectRevisionStorageId(command.projectId, command.projectRevisionRef.reference.versionId)
    ) {
      throw preserveDomainError(
        moduleError("STALE_VERSION", command.commandId, { targetRef: command.projectRevisionRef }),
      );
    }
    const currentProjectRevision = await transaction
      .selectFrom("business.engineering_project_revisions")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("revision_id", "=", project.current_revision_id)
      .executeTakeFirst();
    if (currentProjectRevision === undefined) {
      throw preserveDomainError(
        moduleError("STALE_VERSION", command.commandId, { targetRef: command.projectRevisionRef }),
      );
    }
    if (
      currentProjectRevision.lifecycle === "ended" ||
      currentProjectRevision.lifecycle === "archived"
    ) {
      throw preserveDomainError(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerRef: command.projectRevisionRef,
          blockerKind: "project-lifecycle",
        }),
      );
    }
    const identity = await transaction
      .selectFrom("business.engineering_spatial_segments")
      .selectAll()
      .where("scope_id", "=", command.spatialScopeRef.reference.entityId)
      .where("project_id", "=", command.projectId)
      .forUpdate()
      .executeTakeFirst();
    const previous =
      identity === undefined
        ? undefined
        : await transaction
            .selectFrom("business.engineering_spatial_segment_revisions")
            .selectAll()
            .where("revision_id", "=", identity.current_revision_id)
            .where("scope_id", "=", identity.scope_id)
            .where("project_id", "=", command.projectId)
            .executeTakeFirst();
    if (identity === undefined && command.expectedVersion !== "none")
      throw preserveDomainError(
        moduleError("STALE_VERSION", command.commandId, { targetRef: command.spatialScopeRef }),
      );
    if (
      identity !== undefined &&
      (previous === undefined ||
        command.expectedVersion === "none" ||
        identity.current_revision_id !==
          spatialRevisionStorageId(
            command.spatialScopeRef.reference.entityId,
            command.expectedVersion.versionId,
          ))
    )
      throw preserveDomainError(
        moduleError("STALE_VERSION", command.commandId, { targetRef: command.spatialScopeRef }),
      );
    if (command.parentScopeRef !== undefined) {
      if (
        command.parentScopeRef.reference.entityId === command.spatialScopeRef.reference.entityId
      ) {
        throw preserveDomainError(
          moduleError("BUSINESS_BLOCKED", command.commandId, {
            blockerRef: command.parentScopeRef,
            blockerKind: "parent-scope",
          }),
        );
      }
      const parent = await transaction
        .selectFrom("business.engineering_spatial_segments")
        .selectAll()
        .where("scope_id", "=", command.parentScopeRef.reference.entityId)
        .where("project_id", "=", command.projectId)
        .executeTakeFirst();
      const parentRevision =
        parent === undefined
          ? undefined
          : await transaction
              .selectFrom("business.engineering_spatial_segment_revisions")
              .selectAll()
              .where("scope_id", "=", command.parentScopeRef.reference.entityId)
              .where("project_id", "=", command.projectId)
              .where("revision_id", "=", parent.current_revision_id)
              .executeTakeFirst();
      if (
        parent === undefined ||
        parent.current_revision_id !==
          spatialRevisionStorageId(
            command.parentScopeRef.reference.entityId,
            command.parentScopeRef.reference.versionId,
          ) ||
        parentRevision === undefined ||
        parentRevision.status !== "active"
      )
        throw preserveDomainError(
          moduleError("BUSINESS_BLOCKED", command.commandId, {
            blockerRef: command.parentScopeRef,
            blockerKind: "parent-scope",
          }),
        );
    }
    const previousRevision = previous === undefined ? undefined : toSpatialRevision(previous);
    const revision = buildSpatialBusinessRevision(command, previousRevision);
    const revisionId = spatialRevisionStorageId(
      command.spatialScopeRef.reference.entityId,
      revision.spatialScopeRef.reference.versionId,
    );
    const auditId = auditEntryIdFor(command.commandId);
    if (identity === undefined) {
      await transaction
        .insertInto("business.engineering_spatial_segments")
        .values({
          scope_id: command.spatialScopeRef.reference.entityId,
          project_id: command.projectId,
          current_revision_id: revisionId,
          created_at: sql`clock_timestamp()`,
        })
        .execute();
    }
    await transaction
      .insertInto("business.engineering_spatial_segment_revisions")
      .values({
        revision_id: revisionId,
        scope_id: command.spatialScopeRef.reference.entityId,
        project_id: command.projectId,
        revision_no: previous === undefined ? 1 : previous.revision_no + 1,
        spatial_scope_ref: jsonValue(revision.spatialScopeRef),
        project_revision_ref: jsonValue(revision.projectRevisionRef),
        parent_scope_ref:
          revision.parentScopeRef === undefined ? null : jsonValue(revision.parentScopeRef),
        name: revision.name,
        worksite_location: revision.worksiteLocation,
        chainage: revision.chainage === undefined ? null : jsonValue(revision.chainage),
        applicability_overrides: jsonValue(revision.applicabilityOverrides),
        status: revision.status,
        effective_period: jsonValue(revision.effectivePeriod),
        system_time: jsonValue(revision.systemTime),
        previous_revision_id: identity?.current_revision_id ?? null,
        actor_id: command.actorId,
        authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
        audit_entry_id: auditId,
        occurred_at: command.issuedAt,
        recorded_at: command.issuedAt,
        persisted_at: sql`clock_timestamp()`,
      } satisfies InsertObject<
        ContextSourceDatabase,
        "business.engineering_spatial_segment_revisions"
      >)
      .execute();
    if (identity !== undefined) {
      const updated = await transaction
        .updateTable("business.engineering_spatial_segments")
        .set({ current_revision_id: revisionId })
        .where("scope_id", "=", identity.scope_id)
        .where("project_id", "=", command.projectId)
        .where("current_revision_id", "=", identity.current_revision_id)
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) !== 1)
        throw preserveDomainError(
          moduleError("STALE_VERSION", command.commandId, { targetRef: command.spatialScopeRef }),
        );
    }
    return commit(
      command,
      "engineering-data.revise-spatial-context",
      revision.spatialScopeRef,
      revision.spatialScopeRef.reference,
      command.issuedAt,
      auditId,
    );
  }

  async #registerSegmentsInTransaction(
    context: TransactionContextV1,
    command: RegisterSourceSegmentSetCommandV1,
    sourceVersion: SourceVersionV1,
  ): Promise<AtomicCommitV1> {
    const transaction = asTransaction(context);
    const lockedSourceRow = await transaction
      .selectFrom("business.source_versions")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("source_version_id", "=", sourceVersion.sourceVersionRef.reference.entityId)
      .where("version_id", "=", sourceVersion.sourceVersionRef.reference.versionId)
      .forUpdate()
      .executeTakeFirst();
    if (lockedSourceRow === undefined) {
      throw preserveDomainError(moduleError("AUTHORIZATION_DENIED", command.commandId));
    }
    if (
      lockedSourceRow.access_status !== "ready" ||
      lockedSourceRow.source_id !== command.sourceId
    ) {
      throw preserveDomainError(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerRef: sourceVersion.sourceVersionRef,
          blockerKind: "source-segment",
        }),
      );
    }
    const lockedSourceVersion = toSourceVersion(lockedSourceRow);
    const authorizedScopeIds = new Set(
      command.authorization.spatialScopeRefs.map((scope) => scope.reference.entityId),
    );
    if (
      command.segments.some((segment) =>
        segment.spatialScopeRefs.some((scope) => !authorizedScopeIds.has(scope.reference.entityId)),
      )
    ) {
      throw preserveDomainError(moduleError("AUTHORIZATION_DENIED", command.commandId));
    }
    const existing = await transaction
      .selectFrom("business.source_segment_sets")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("source_version_id", "=", sourceVersion.sourceVersionRef.reference.entityId)
      .executeTakeFirst();
    if (existing !== undefined) {
      throw preserveDomainError(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerRef: sourceVersion.sourceVersionRef,
          blockerKind: "source-segment-set",
        }),
      );
    }
    let set: SourceSegmentSetV1;
    try {
      set = buildSourceSegmentSet(command, lockedSourceVersion);
    } catch {
      throw preserveDomainError(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerRef: sourceVersion.sourceVersionRef,
          blockerKind: "source-segment",
        }),
      );
    }
    const auditId = auditEntryIdFor(command.commandId);
    await transaction
      .insertInto("business.source_segment_sets")
      .values({
        source_segment_set_id: set.sourceSegmentSetRef.reference.entityId,
        version_id: set.sourceSegmentSetRef.reference.versionId,
        project_id: command.projectId,
        source_version_id: sourceVersion.sourceVersionRef.reference.entityId,
        source_id: sourceVersion.sourceId,
        source_segment_set_ref: jsonValue(set.sourceSegmentSetRef),
        actor_id: command.actorId,
        authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
        recorded_at: command.issuedAt,
        persisted_at: sql`clock_timestamp()`,
        audit_entry_id: auditId,
      } satisfies InsertObject<ContextSourceDatabase, "business.source_segment_sets">)
      .execute();
    for (let offset = 0; offset < set.segments.length; offset += CONTEXT_SOURCE_MAX_SEGMENT_BATCH) {
      const batch = set.segments.slice(offset, offset + CONTEXT_SOURCE_MAX_SEGMENT_BATCH);
      await transaction
        .insertInto("business.source_segments")
        .values(
          batch.map((segment) => ({
            source_segment_id: segment.sourceSegmentId,
            project_id: command.projectId,
            source_version_id: sourceVersion.sourceVersionRef.reference.entityId,
            source_segment_set_id: set.sourceSegmentSetRef.reference.entityId,
            chapter_id: segment.chapterId,
            segment_id: segment.segmentId,
            kind: segment.kind,
            spatial_scope_refs: jsonValue(segment.spatialScopeRefs),
            locator: jsonValue(segment.locator),
            recorded_at: command.issuedAt,
          })),
        )
        .execute();
    }
    return commit(
      command,
      "engineering-data.register-source-segments",
      set.sourceSegmentSetRef,
      set.sourceSegmentSetRef.reference,
      command.issuedAt,
      auditId,
    );
  }

  async #createSnapshotInTransaction(
    context: TransactionContextV1,
    command: CreateApplicabilitySnapshotCommandV1,
  ): Promise<AtomicCommitV1> {
    const transaction = asTransaction(context);
    const projectIdentity = await transaction
      .selectFrom("business.engineering_projects")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .forUpdate()
      .executeTakeFirst();
    const projectRow =
      projectIdentity === undefined
        ? undefined
        : await transaction
            .selectFrom("business.engineering_project_revisions")
            .selectAll()
            .where("project_id", "=", command.projectId)
            .where("revision_id", "=", projectIdentity.current_revision_id)
            .executeTakeFirst();
    const spatialIdentity = await transaction
      .selectFrom("business.engineering_spatial_segments")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("scope_id", "=", command.spatialScopeRef.reference.entityId)
      .forUpdate()
      .executeTakeFirst();
    const spatialRow =
      spatialIdentity === undefined
        ? undefined
        : await transaction
            .selectFrom("business.engineering_spatial_segment_revisions")
            .selectAll()
            .where("project_id", "=", command.projectId)
            .where("scope_id", "=", command.spatialScopeRef.reference.entityId)
            .where("revision_id", "=", spatialIdentity.current_revision_id)
            .executeTakeFirst();
    if (projectRow === undefined || spatialRow === undefined)
      throw preserveDomainError(
        moduleError("ENTITY_NOT_FOUND", command.commandId, {
          targetRef: command.projectRevisionRef,
        }),
      );
    const project = toProjectRevision(projectRow);
    const spatial = toSpatialRevision(spatialRow);
    if (!sameVersion(spatial.spatialScopeRef, command.spatialScopeRef)) {
      throw preserveDomainError(
        moduleError("STALE_VERSION", command.commandId, { targetRef: command.spatialScopeRef }),
      );
    }
    if (
      project.lifecycle === "ended" ||
      project.lifecycle === "archived" ||
      spatial.status !== "active"
    ) {
      throw preserveDomainError(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerRef: command.spatialScopeRef,
          blockerKind: "context-lifecycle",
        }),
      );
    }
    let snapshot: ApplicabilityMetadataSnapshotV1;
    try {
      snapshot = buildApplicabilityMetadataSnapshot(command, project, spatial);
    } catch {
      throw preserveDomainError(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerRef: command.spatialScopeRef,
          blockerKind: "applicability",
        }),
      );
    }
    const auditId = auditEntryIdFor(command.commandId);
    await transaction
      .insertInto("business.applicability_metadata_snapshots")
      .values({
        snapshot_id: snapshot.snapshotRef.reference.entityId,
        version_id: snapshot.snapshotRef.reference.versionId,
        project_id: command.projectId,
        snapshot_ref: jsonValue(snapshot.snapshotRef),
        applicability_metadata: jsonValue(snapshot.applicabilityMetadata),
        provenance: jsonValue(snapshot.provenance),
        project_revision_ref: jsonValue(snapshot.projectRevisionRef),
        spatial_scope_ref: jsonValue(snapshot.spatialScopeRef),
        formed_at: snapshot.formedAt,
        worksite_location: snapshot.worksiteLocation ?? null,
        chainage: snapshot.chainage === undefined ? null : jsonValue(snapshot.chainage),
        actor_id: command.actorId,
        authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
        recorded_at: command.issuedAt,
        persisted_at: sql`clock_timestamp()`,
        audit_entry_id: auditId,
      } satisfies InsertObject<ContextSourceDatabase, "business.applicability_metadata_snapshots">)
      .onConflict((conflict) => conflict.columns(["snapshot_id", "version_id"]).doNothing())
      .execute();
    return commit(
      command,
      "engineering-data.create-applicability-snapshot",
      snapshot.snapshotRef,
      snapshot.snapshotRef.reference,
      command.issuedAt,
      auditId,
    );
  }

  async #registerSourceDeliveryInTransaction(
    context: TransactionContextV1,
    command: Extract<EngineeringDataCommandV1, { kind: "register-source-delivery" }>,
    envelope: SourceDeliveryMetadataEnvelopeV1,
    metadataRead: { readonly manifest: ArtifactManifestV1; readonly manifestSha256: string },
  ): Promise<AtomicCommitV1> {
    const transaction = asTransaction(context);
    const sourceGuard = await this.#assertArtifact(
      context,
      command,
      command.payload.sourceArtifactRef,
    );
    const metadataGuard = await this.#assertArtifact(
      context,
      command,
      command.payload.metadataArtifactRef,
    );
    if (
      metadataGuard.manifestSha256 !== metadataRead.manifestSha256 ||
      metadataGuard.content.hash.value !== metadataRead.manifest.content.hash.value ||
      metadataGuard.content.byteLength !== metadataRead.manifest.content.byteLength
    ) {
      throw preserveDomainError(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerRef: command.payload.metadataArtifactRef,
          blockerKind: "metadata-integrity",
        }),
      );
    }
    if (
      refKey(sourceGuard.artifactRef) !== refKey(command.payload.sourceArtifactRef) ||
      refKey(metadataGuard.artifactRef) !== refKey(command.payload.metadataArtifactRef)
    ) {
      throw preserveDomainError(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerRef: command.payload.sourceArtifactRef,
          blockerKind: "artifact-reference",
        }),
      );
    }
    const project = await transaction
      .selectFrom("business.engineering_projects")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .forUpdate()
      .executeTakeFirst();
    if (project === undefined)
      throw preserveDomainError(moduleError("AUTHORIZATION_DENIED", command.commandId));
    const projectRevision = await transaction
      .selectFrom("business.engineering_project_revisions")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("revision_id", "=", project.current_revision_id)
      .executeTakeFirst();
    if (
      projectRevision === undefined ||
      !sameVersion(projectRevision.project_revision_ref as never, envelope.projectRevisionRef)
    ) {
      throw preserveDomainError(
        moduleError("STALE_VERSION", command.commandId, { targetRef: envelope.projectRevisionRef }),
      );
    }
    if (projectRevision.lifecycle === "ended" || projectRevision.lifecycle === "archived")
      throw preserveDomainError(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerRef: envelope.projectRevisionRef,
          blockerKind: "project-lifecycle",
        }),
      );
    for (const scopeRef of envelope.spatialScopeRefs) {
      const scope = await transaction
        .selectFrom("business.engineering_spatial_segments")
        .selectAll()
        .where("project_id", "=", command.projectId)
        .where("scope_id", "=", scopeRef.reference.entityId)
        .executeTakeFirst();
      const scopeRevision =
        scope === undefined
          ? undefined
          : await transaction
              .selectFrom("business.engineering_spatial_segment_revisions")
              .selectAll()
              .where("project_id", "=", command.projectId)
              .where("scope_id", "=", scopeRef.reference.entityId)
              .where("revision_id", "=", scope.current_revision_id)
              .executeTakeFirst();
      if (
        scope === undefined ||
        scope.current_revision_id !==
          spatialRevisionStorageId(scopeRef.reference.entityId, scopeRef.reference.versionId) ||
        scopeRevision === undefined ||
        scopeRevision.status !== "active" ||
        !sameVersion(scopeRevision.project_revision_ref as never, envelope.projectRevisionRef)
      ) {
        throw preserveDomainError(
          moduleError("STALE_VERSION", command.commandId, { targetRef: scopeRef }),
        );
      }
    }
    const snapshot = await transaction
      .selectFrom("business.applicability_metadata_snapshots")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("snapshot_id", "=", envelope.applicabilityMetadataSnapshotRef.reference.entityId)
      .where("version_id", "=", envelope.applicabilityMetadataSnapshotRef.reference.versionId)
      .executeTakeFirst();
    if (
      snapshot === undefined ||
      !sameVersion(snapshot.project_revision_ref as never, envelope.projectRevisionRef) ||
      !envelope.spatialScopeRefs.some((scope) =>
        sameVersion(scope, snapshot.spatial_scope_ref as never),
      )
    ) {
      throw preserveDomainError(moduleError("AUTHORIZATION_DENIED", command.commandId));
    }
    const deliveryId = deliveryIdFor(command);
    const sourceId = sourceIdFor(command);
    const deliveryRef = sourceDeliveryRefFor(deliveryId);
    const sourceVersionRef = sourceVersionRefFor(sourceId);
    const prior = await transaction
      .selectFrom("business.source_versions")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("source_item_id", "=", envelope.sourceItemId)
      .orderBy("source_version_sequence", "desc")
      .executeTakeFirst();
    const existingDelivery = await transaction
      .selectFrom("business.source_deliveries")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("delivery_key", "=", command.payload.deliveryKey)
      .executeTakeFirst();
    if (existingDelivery !== undefined && existingDelivery.source_delivery_id !== deliveryId)
      throw preserveDomainError(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerRef: deliveryRef,
          blockerKind: "delivery-key",
        }),
      );
    const sourceItem = await transaction
      .selectFrom("business.source_items")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("source_item_id", "=", envelope.sourceItemId)
      .executeTakeFirst();
    const auditId = auditEntryIdFor(command.commandId);
    if (sourceItem === undefined) {
      await transaction
        .insertInto("business.source_items")
        .values({
          source_item_id: envelope.sourceItemId,
          project_id: command.projectId,
          name: envelope.sourceItemName,
          category: envelope.sourceCategory,
          actor_id: command.actorId,
          authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
          audit_entry_id: auditId,
          created_at: sql`clock_timestamp()`,
        })
        .execute();
    } else if (
      sourceItem.name !== envelope.sourceItemName ||
      sourceItem.category !== envelope.sourceCategory
    ) {
      throw preserveDomainError(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerRef: ref("source-delivery", deliveryId, "1"),
          blockerKind: "source-item-identity",
        }),
      );
    }
    const sequence = prior === undefined ? 1 : prior.source_version_sequence + 1;
    await transaction
      .insertInto("business.source_deliveries")
      .values({
        source_delivery_id: deliveryId,
        version_id: "1",
        project_id: command.projectId,
        source_item_id: envelope.sourceItemId,
        delivery_key: command.payload.deliveryKey,
        source_delivery_ref: jsonValue(deliveryRef),
        project_revision_ref: jsonValue(envelope.projectRevisionRef),
        spatial_scope_refs: jsonValue(envelope.spatialScopeRefs),
        descriptor: jsonValue(envelope.descriptor),
        source_metadata: jsonValue(envelope.sourceMetadata),
        source_artifact_ref: jsonValue(command.payload.sourceArtifactRef),
        metadata_artifact_ref: jsonValue(command.payload.metadataArtifactRef),
        applicability_snapshot_ref: jsonValue(envelope.applicabilityMetadataSnapshotRef),
        registered_by: envelope.registeredByAccountId,
        authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
        occurred_at: command.payload.occurredAt,
        recorded_at: command.issuedAt,
        persisted_at: sql`clock_timestamp()`,
        audit_entry_id: auditId,
      })
      .onConflict((conflict) => conflict.columns(["source_delivery_id", "version_id"]).doNothing())
      .execute();
    await transaction
      .insertInto("business.source_versions")
      .values({
        source_version_id: sourceId,
        version_id: "1",
        source_id: sourceId,
        project_id: command.projectId,
        source_item_id: envelope.sourceItemId,
        source_delivery_id: deliveryId,
        source_delivery_ref: jsonValue(deliveryRef),
        source_version_ref: jsonValue(sourceVersionRef),
        source_version_sequence: sequence,
        project_revision_ref: jsonValue(envelope.projectRevisionRef),
        spatial_scope_refs: jsonValue(envelope.spatialScopeRefs),
        source_artifact_ref: jsonValue(command.payload.sourceArtifactRef),
        metadata_artifact_ref: jsonValue(command.payload.metadataArtifactRef),
        source_access_grant_ref: null,
        access_status: "pending-access",
        applicability_snapshot_ref: jsonValue(envelope.applicabilityMetadataSnapshotRef),
        previous_source_version_id: prior?.source_version_id ?? null,
        registered_by: envelope.registeredByAccountId,
        authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
        recorded_at: command.issuedAt,
        persisted_at: sql`clock_timestamp()`,
        audit_entry_id: auditId,
      })
      .onConflict((conflict) => conflict.columns(["source_version_id", "version_id"]).doNothing())
      .execute();
    return commit(
      command,
      "engineering-data.register-source-delivery",
      sourceVersionRef,
      sourceVersionRef.reference,
      command.issuedAt,
      auditId,
    );
  }

  async #assertArtifact(
    context: TransactionContextV1,
    command: Extract<EngineeringDataCommandV1, { kind: "register-source-delivery" }>,
    artifactRef: ContentArtifactRefV1,
  ) {
    const request = ArtifactReferenceCheckRequestV1Schema.parse({
      schemaVersion: "1",
      artifactRef,
      projectId: command.projectId,
      purposeCode: "engineering-data.register-source-delivery",
      requiredCapability: "engineering-data.write",
      authorization: command.authorization,
    });
    return this.#artifactGuard.assertUsable(context, request);
  }

  async #segmentsForSet(
    transaction: ContextTransaction,
    setId: string,
  ): Promise<SourceSegmentSetV1["segments"]> {
    const rows = await transaction
      .selectFrom("business.source_segments")
      .selectAll()
      .where("source_segment_set_id", "=", setId)
      .orderBy("source_segment_id")
      .execute();
    return rows.map((row) => ({
      sourceSegmentId:
        row.source_segment_id as SourceSegmentSetV1["segments"][number]["sourceSegmentId"],
      chapterId: row.chapter_id,
      segmentId: row.segment_id,
      kind: row.kind as SourceSegmentSetV1["segments"][number]["kind"],
      spatialScopeRefs:
        row.spatial_scope_refs as SourceSegmentSetV1["segments"][number]["spatialScopeRefs"],
      locator: row.locator as SourceSegmentSetV1["segments"][number]["locator"],
    }));
  }

  async #readProjectRevision(
    projectId: string,
    versionId: string,
  ): Promise<ProjectBusinessRevisionV1 | undefined> {
    const row = await this.#db
      .selectFrom("business.engineering_project_revisions")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("revision_id", "=", projectRevisionStorageId(projectId, versionId))
      .executeTakeFirst();
    return row === undefined ? undefined : toProjectRevision(row);
  }

  async #readSpatialRevision(
    projectId: string,
    scopeId: string,
    versionId: string,
  ): Promise<SpatialBusinessRevisionV1 | undefined> {
    const row = await this.#db
      .selectFrom("business.engineering_spatial_segment_revisions")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("scope_id", "=", scopeId)
      .where("revision_id", "=", spatialRevisionStorageId(scopeId, versionId))
      .executeTakeFirst();
    return row === undefined ? undefined : toSpatialRevision(row);
  }

  async #readSourceVersion(
    projectId: string,
    sourceVersionRef: SourceVersionRefV1,
  ): Promise<SourceVersionV1 | undefined> {
    const row = await this.#db
      .selectFrom("business.source_versions")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("source_version_id", "=", sourceVersionRef.reference.entityId)
      .where("version_id", "=", sourceVersionRef.reference.versionId)
      .executeTakeFirst();
    return row === undefined ? undefined : toSourceVersion(row);
  }

  async #readSegmentSet(
    projectId: string,
    sourceSegmentSetRef: ContractReferenceV1,
  ): Promise<SourceSegmentSetV1 | undefined> {
    if (sourceSegmentSetRef.kind !== "source-segment-set") return undefined;
    const row = await this.#db
      .selectFrom("business.source_segment_sets")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("source_segment_set_id", "=", sourceSegmentSetRef.reference.entityId)
      .where("version_id", "=", sourceSegmentSetRef.reference.versionId)
      .executeTakeFirst();
    if (row === undefined) return undefined;
    return SourceSegmentSetV1Schema.parse({
      sourceSegmentSetRef: row.source_segment_set_ref,
      sourceVersionRef: ref("source-version", row.source_version_id, "1"),
      sourceId: row.source_id,
      segments: await this.#segmentsForSet(
        this.#db as unknown as ContextTransaction,
        row.source_segment_set_id,
      ),
      recordedAt: asIso(row.recorded_at),
      audit: {
        actorId: row.actor_id,
        action: "engineering-data.register-source-segments",
        recordedAt: asIso(row.recorded_at),
      },
    });
  }

  async #readSnapshot(
    projectId: string,
    snapshotRef: ContractReferenceV1,
  ): Promise<ApplicabilityMetadataSnapshotV1 | undefined> {
    if (snapshotRef.kind !== "applicability-metadata-snapshot") return undefined;
    const row = await this.#db
      .selectFrom("business.applicability_metadata_snapshots")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("snapshot_id", "=", snapshotRef.reference.entityId)
      .where("version_id", "=", snapshotRef.reference.versionId)
      .executeTakeFirst();
    if (row === undefined) return undefined;
    return ApplicabilityMetadataSnapshotV1Schema.parse({
      snapshotRef: row.snapshot_ref,
      applicabilityMetadata: row.applicability_metadata,
      provenance: row.provenance,
      projectRevisionRef: row.project_revision_ref,
      spatialScopeRef: row.spatial_scope_ref,
      formedAt: asIso(row.formed_at),
      ...(row.worksite_location === null ? {} : { worksiteLocation: row.worksite_location }),
      ...(row.chainage === null ? {} : { chainage: row.chainage }),
      audit: {
        actorId: row.actor_id,
        action: "engineering-data.create-applicability-snapshot",
        recordedAt: asIso(row.recorded_at),
      },
    });
  }

  #mapError(error: unknown, causalRunId: string, stage: string): ModuleErrorV1 {
    const contextError =
      error instanceof Error
        ? (error as Error & { contextSourceError?: unknown }).contextSourceError
        : undefined;
    if (contextError !== undefined) return contextError as ModuleErrorV1;
    const accessError =
      error instanceof Error ? (error as Error & { accessError?: unknown }).accessError : undefined;
    if (accessError instanceof AccessServiceError) {
      if (accessError.details.code === "AUTHORIZATION_DENIED")
        return moduleError("AUTHORIZATION_DENIED", causalRunId);
      if (accessError.details.code === "STALE_ACCESS_VERSION")
        return moduleError("STALE_VERSION", causalRunId, {
          targetRef: accessError.details.targetRef,
        });
      if (accessError.details.code === "IDEMPOTENCY_CONFLICT")
        return moduleError("IDEMPOTENCY_CONFLICT", causalRunId, {
          idempotencyKey: accessError.details.idempotencyKey,
          priorCommandId: accessError.details.priorCommandId,
        });
      return moduleError(
        accessError.details.retryable ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE",
        causalRunId,
      );
    }
    if (error instanceof AccessServiceError)
      return moduleError(
        error.details.code === "AUTHORIZATION_DENIED" ? "AUTHORIZATION_DENIED" : "TERMINAL_FAILURE",
        causalRunId,
      );
    if (error instanceof ArtifactStoreError)
      return mapArtifactErrorToModuleError(error, {
        causalRunId,
        requiredCapability: "engineering-data.write",
        authorizationPolicyRef: ACCESS_POLICY_REF_V1,
        schemaVersion: "1",
      });
    const mapped = mapPostgresError(error, stage);
    if (mapped.code === "IDEMPOTENCY_CONFLICT")
      return moduleError("IDEMPOTENCY_CONFLICT", causalRunId, {
        idempotencyKey: causalRunId,
        priorCommandId: causalRunId,
      });
    return moduleError(mapped.retryable ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE", causalRunId);
  }
}

export const createPostgresEngineeringContextSourceRegistry = (
  options: PostgresEngineeringContextSourceRegistryOptions,
): PostgresEngineeringContextSourceRegistry =>
  new PostgresEngineeringContextSourceRegistry(options);

export type { ContextSourceDatabase };
