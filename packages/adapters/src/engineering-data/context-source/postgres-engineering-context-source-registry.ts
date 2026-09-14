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
  type AuthorizationDecisionV1,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  ArtifactReadRequestV1Schema,
  ArtifactReferenceCheckRequestV1Schema,
  ArtifactStoreError,
  mapArtifactErrorToModuleError,
  manifestSha256,
  normalizeEvidenceReferences,
  type ArtifactManifestV1,
  type ArtifactReferenceCheckResultV1,
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
  EngineeringDataReadBranchQueryV1Schema,
  EngineeringDataReadQueryRecordV1Schema,
  EvidenceAccessItemV1Schema,
  EvidenceAccessReadResultV1Schema,
  ProjectBusinessRevisionV1Schema,
  RegisterSourceSegmentSetCommandV1Schema,
  ResolveEngineeringDataReadQueryV1Schema,
  ResolveSourceVersionForReadQueryV1Schema,
  ResolveSourceProcessingInputQueryV1Schema,
  SourceDeliveryMetadataEnvelopeV1Schema,
  SourceProcessingInputV1Schema,
  SourceSegmentReadResultV1Schema,
  SourceSegmentSetV1Schema,
  SourceSegmentV1Schema,
  SourceVersionV1Schema,
  SpatialBusinessRevisionV1Schema,
  SpatialScopeRefSetV1Schema,
  normalizeSpatialScopeRefs,
  type ApplicabilityMetadataSnapshotV1,
  type ContextSourceResultV1,
  type ContextSourceSuccessV1,
  type CreateApplicabilitySnapshotCommandV1,
  type EngineeringContextRevisionCommandV1,
  type EngineeringDataReadBranchQueryV1,
  type EngineeringDataReadQueryRecordV1,
  type EngineeringDataReadResolutionResultV1,
  type EvidenceAccessItemV1,
  type EvidenceAccessReadResultV1,
  type ProjectBusinessRevisionV1,
  type RegisterSourceSegmentSetCommandV1,
  type ResolveEngineeringDataReadQueryV1,
  type ResolveSourceProcessingInputQueryV1,
  type ResolveSourceVersionForReadQueryV1,
  type SourceProcessingInputV1,
  type SourceDeliveryMetadataEnvelopeV1,
  type SourceSegmentReadResultV1,
  type SourceSegmentSetV1,
  type SourceSegmentV1,
  type SourceVersionV1,
  type SpatialBusinessRevisionV1,
  type EngineeringContextSourceRegistryV1,
} from "@riskflow/core/engineering-data/context-source";
import {
  AuthorizationContextV1Schema,
  EngineeringDataCommandV1Schema,
  EngineeringDataQueryV1Schema,
  EngineeringFreezeCommandV1Schema,
  EngineeringFreezeResultV1Schema,
  ExternalRiskEventRefV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
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
  type ModuleBranchV1,
  type ModuleErrorV1,
  type QueryResultRefV1,
  type SourceAccessGrantRefV1,
  type SourceDeliveryRefV1,
  type SourceSegmentSetRefV1,
  type SourceVersionRefV1,
  type SpatialScopeRefV1,
  type WaitingRefV1,
} from "@riskflow/contracts/ports";
import type { EvidenceReference, VersionReference } from "@riskflow/contracts/common";
import { DomainEventV1Schema } from "@riskflow/contracts/events";
import {
  RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1,
  RiskInputFactsV1Schema,
  type AssessmentDownstreamAuthorizerV1,
  type AssessmentPreparationContextReaderV1,
  type RiskInputFactsReaderV1,
} from "@riskflow/core/risk-assessment/engine";
import { AssessmentPreparationSnapshotV1Schema } from "@riskflow/contracts/workflows";
import type { AssessmentPreparationSnapshotV1 } from "@riskflow/contracts/workflows";
import {
  MonitoringSeriesRevisionReadV1Schema,
  MonitoringSnapshotV1Schema,
} from "@riskflow/core/engineering-data/monitoring";
import type {
  MonitoringSeriesReadResultV1,
  MonitoringSnapshotV1,
} from "@riskflow/core/engineering-data/monitoring";

import { getPostgresTransaction } from "../../postgres/transaction-unit.js";
import {
  makePersistenceError,
  mapPostgresError,
  type PostgresPersistenceError,
} from "../../postgres/pool.js";
import type { PostgresDatabase } from "../../postgres/types.js";
import type { PostgresMonitoringStoreV1 } from "../monitoring/postgres-monitoring-store.js";
import type { PostgresDataCleaningStore } from "../cleaning/postgres-data-cleaning-store.js";

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

interface ExternalRiskEventRow {
  external_risk_event_id: string;
  version_id: string;
  project_id: string;
  external_risk_event_ref: JsonColumn;
  external_source_entity_id: string;
  external_source_version_id: string;
  external_source_ref: JsonColumn;
  external_event_key: string;
  event_artifact_ref: JsonColumn;
  evidence_references: JsonColumn;
  source_version_refs: JsonColumn;
  spatial_scope_refs: JsonColumn;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
  actor_id: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
}

interface AssessmentPreparationRow {
  snapshot_id: string;
  version_id: string;
  schema_version: string;
  project_id: string;
  command_id: string;
  idempotency_key: string;
  payload_hash: string;
  risk_input_ref: JsonColumn;
  risk_input_kind: string;
  risk_input_entity_id: string;
  risk_input_version_id: string;
  project_revision_ref: JsonColumn;
  spatial_scope_ref: JsonColumn;
  applicability_snapshot_ref: JsonColumn;
  monitoring_snapshot_refs: JsonColumn | null;
  entry_mode: string;
  trigger_reason_code: string;
  previous_assessment_record_ref: JsonColumn | null;
  causal_run_ref: JsonColumn | null;
  snapshot_payload: JsonColumn;
  applicability_values: JsonColumn;
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface ReadQueryResultRow {
  query_result_id: string;
  version_id: string;
  project_id: string;
  branch: "source-segments" | "evidence-access";
  query_result_ref: JsonColumn;
  query_payload: JsonColumn;
  authorization_context_ref: JsonColumn;
  requested_by: string;
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
  "business.external_risk_events": ExternalRiskEventRow;
  "business.engineering_data_read_query_results": ReadQueryResultRow;
  "business.assessment_preparation_snapshots": AssessmentPreparationRow;
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
const externalRiskEventIdFor = (command: {
  readonly projectId: string;
  readonly payload: {
    readonly externalSourceRef: VersionReference;
    readonly externalEventKey: string;
  };
}): string =>
  `external-risk-event:${sha256CanonicalJson({
    projectId: command.projectId,
    externalSourceRef: command.payload.externalSourceRef,
    externalEventKey: command.payload.externalEventKey,
  }).slice(0, 40)}`;
const normalizeVersionedRefs = <
  T extends { kind: string; reference: { entityId: string; versionId: string } },
>(
  values: readonly T[],
): T[] =>
  [...new Map(values.map((value) => [refKey(value), value])).entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, value]) => value);
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

const readAuthorizationDenied = (causalRunId: string): ContextSourceError =>
  moduleError("AUTHORIZATION_DENIED", causalRunId, {
    requiredCapability: "engineering-data.read",
  });

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

const sourceProcessingInput = (sourceVersion: SourceVersionV1): SourceProcessingInputV1 =>
  SourceProcessingInputV1Schema.parse({
    sourceVersionRef: sourceVersion.sourceVersionRef,
    projectId: sourceVersion.projectId,
    sourceId: sourceVersion.sourceId,
    sourceItemId: sourceVersion.sourceItemId,
    projectRevisionRef: sourceVersion.projectRevisionRef,
    spatialScopeRefs: sourceVersion.spatialScopeRefs,
    sourceArtifactRef: sourceVersion.sourceArtifactRef,
    metadataArtifactRef: sourceVersion.metadataArtifactRef,
    sourceAccessGrantRef: sourceVersion.sourceAccessGrantRef,
    applicabilityMetadataSnapshotRef: sourceVersion.applicabilityMetadataSnapshotRef,
  });

const sourceSegmentSetResult = (set: SourceSegmentSetV1): ContextSourceResultV1 =>
  resultSuccess({ kind: "source-segment-set", segmentSet: set });

type EngineeringDataReadBranch = "source-segments" | "evidence-access";

const READ_BRANCH = {
  "source-segments": "engineering-data.source-segments",
  "evidence-access": "engineering-data.evidence-access",
} as const satisfies Record<EngineeringDataReadBranch, ModuleBranchV1>;

const READ_QUERY_COMMAND_KIND = {
  "source-segments": "engineering-data.source-segments-query.v1",
  "evidence-access": "engineering-data.evidence-access-query.v1",
} as const satisfies Record<EngineeringDataReadBranch, string>;

const READ_QUERY_ACTION = {
  "source-segments": "engineering-data.source-segments-query",
  "evidence-access": "engineering-data.evidence-access-query",
} as const satisfies Record<EngineeringDataReadBranch, string>;

const readBranchOfQueryResultRef = (entityId: string): EngineeringDataReadBranch | undefined =>
  entityId.startsWith("source-segments-")
    ? "source-segments"
    : entityId.startsWith("evidence-access-")
      ? "evidence-access"
      : undefined;

const readQueryResultRef = (branch: EngineeringDataReadBranch, queryId: string): QueryResultRefV1 =>
  ref("query-result", `${branch}-${queryId}`, "1") as QueryResultRefV1;

/**
 * A read request that names another project, actor, or requests no
 * `engineering-data.read` capability is an authorization failure before it is
 * a contract failure, so malformed requests cannot probe the difference.
 */
const readRequestDenied = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  const authorization = request.authorization;
  if (typeof authorization !== "object" || authorization === null) return false;
  const context = authorization as Record<string, unknown>;
  if (
    typeof request.projectId === "string" &&
    typeof context.projectId === "string" &&
    request.projectId !== context.projectId
  ) {
    return true;
  }
  if (
    typeof request.actorId === "string" &&
    typeof context.actorId === "string" &&
    request.actorId !== context.actorId
  ) {
    return true;
  }
  const capabilities = context.grantedCapabilities;
  return Array.isArray(capabilities) && !capabilities.includes("engineering-data.read");
};

const readCausalRunId = (value: unknown, fallback: string): string => {
  if (typeof value !== "object" || value === null) return fallback;
  const request = value as Record<string, unknown>;
  for (const key of ["queryId", "invocationId"]) {
    const candidate = request[key];
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }
  return fallback;
};

const dedupeSourceVersionRefs = (refs: readonly SourceVersionRefV1[]): SourceVersionRefV1[] => {
  const seen = new Map<string, SourceVersionRefV1>();
  for (const item of refs) seen.set(refKey(item), item);
  return [...seen.values()];
};

const toSourceSegment = (row: Selectable<SegmentRow>): SourceSegmentV1 =>
  SourceSegmentV1Schema.parse({
    sourceSegmentId: row.source_segment_id,
    chapterId: row.chapter_id,
    segmentId: row.segment_id,
    kind: row.kind,
    spatialScopeRefs: row.spatial_scope_refs,
    locator: row.locator,
  });

const dedupeSpatialScopeRefs = (
  groups: ReadonlyArray<readonly SpatialScopeRefV1[]>,
): SpatialScopeRefV1[] =>
  normalizeSpatialScopeRefs([
    ...new Map(groups.flat().map((scope) => [refKey(scope), scope] as const)).values(),
  ]);

interface SourceSegmentReadTarget {
  readonly sourceVersion: SourceVersionV1;
  readonly segmentSet: SourceSegmentSetV1;
  readonly spatialScopeRefs: SpatialScopeRefV1[];
}

interface EvidenceAccessReadTarget {
  readonly items: EvidenceAccessItemV1[];
  readonly spatialScopeRefs: SpatialScopeRefV1[];
}

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
  readonly monitoringStore?: PostgresMonitoringStoreV1;
  readonly dataCleaningStore?: PostgresDataCleaningStore;
  /**
   * C25 风险输入事实接缝（C24/C11 实现）。评估准备冻结必须经它复验精确 XOR 输入；
   * 未注入时 `assessment-preparation` 分支关闭失败，不产生部分快照。
   */
  readonly riskInputFacts?: RiskInputFactsReaderV1;
  /**
   * 下游读取授权签发接缝：调用方命令只有自己那一个 capability，C14/C19 读取需要各自
   * 精确 branch 的 C06 上下文。组合根按 branch 签发，绑定不符时适配器关闭失败。
   */
  readonly authorizeDownstream?: AssessmentDownstreamAuthorizerV1;
  readonly now?: () => Date;
}

export class PostgresEngineeringContextSourceRegistry
  implements
    EngineeringDataPortV1,
    EngineeringContextSourceRegistryV1,
    AssessmentPreparationContextReaderV1
{
  readonly #db: Kysely<ContextSourceDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #access: LocalIdentityAccessV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #artifactGuard: ArtifactReferenceGuardV1;
  readonly #monitoringStore: PostgresMonitoringStoreV1 | undefined;
  readonly #dataCleaningStore: PostgresDataCleaningStore | undefined;
  readonly #riskInputFacts: RiskInputFactsReaderV1 | undefined;
  readonly #authorizeDownstream: AssessmentDownstreamAuthorizerV1 | undefined;
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
    this.#monitoringStore = options.monitoringStore;
    this.#dataCleaningStore = options.dataCleaningStore;
    this.#riskInputFacts = options.riskInputFacts;
    this.#authorizeDownstream = options.authorizeDownstream;
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
      const decision = await this.#verify(
        valid,
        valid.kind === "project" ? [] : valid.authorization.spatialScopeRefs,
        [],
      );
      const verified = { ...valid, actorId: decision.context.actorId };
      const atomic = atomicCommand(verified, "engineering-data.context-revision.v1", verified);
      const receipt = await this.#transactionUnit.execute(atomic, async (context) =>
        verified.kind === "project"
          ? this.#reviseProjectInTransaction(context, verified)
          : this.#reviseSpatialInTransaction(context, verified),
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
      const decision = await this.#verify(valid, valid.authorization.spatialScopeRefs, [
        valid.sourceVersionRef,
      ]);
      const verified = { ...valid, actorId: decision.context.actorId };
      const sourceVersion = await this.#readSourceVersion(valid.projectId, valid.sourceVersionRef);
      if (sourceVersion === undefined) {
        return resultFailure(moduleError("AUTHORIZATION_DENIED", valid.commandId));
      }
      const atomic = atomicCommand(verified, "engineering-data.source-segments.v1", verified);
      const receipt = await this.#transactionUnit.execute(atomic, async (context) =>
        this.#registerSegmentsInTransaction(context, verified, sourceVersion),
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

  async resolveSourceProcessingInput(
    query: ResolveSourceProcessingInputQueryV1,
  ): Promise<ContextSourceResultV1> {
    const parsed = ResolveSourceProcessingInputQueryV1Schema.safeParse(query);
    if (!parsed.success)
      return resultFailure(moduleError("UNSUPPORTED_CONTRACT", "source-processing-input"));
    const valid = parsed.data;
    try {
      await this.#verifyRead(
        valid,
        valid.authorization.grantedCapabilities.includes("engineering-data.write")
          ? "engineering-data.register-source-delivery"
          : "engineering-data.evidence-access",
        valid.authorization.spatialScopeRefs,
        [valid.sourceVersionRef],
      );
      const sourceVersion = await this.#readSourceVersion(valid.projectId, valid.sourceVersionRef);
      if (
        sourceVersion === undefined ||
        sourceVersion.accessStatus !== "ready" ||
        sourceVersion.sourceAccessGrantRef === undefined
      ) {
        return resultFailure(moduleError("AUTHORIZATION_DENIED", valid.queryId));
      }
      const project = await this.#db
        .selectFrom("business.engineering_projects")
        .select(["current_revision_id"])
        .where("project_id", "=", valid.projectId)
        .executeTakeFirst();
      if (
        project === undefined ||
        project.current_revision_id !==
          projectRevisionStorageId(
            valid.projectId,
            sourceVersion.projectRevisionRef.reference.versionId,
          )
      ) {
        return resultFailure(
          moduleError("STALE_VERSION", valid.queryId, { targetRef: valid.sourceVersionRef }),
        );
      }
      const input = sourceProcessingInput(sourceVersion);
      return resultSuccess({ kind: "source-processing-input", input });
    } catch (error) {
      return resultFailure(
        this.#mapError(error, valid.queryId, "engineering-data.source-processing-input"),
      );
    }
  }

  async resolveSourceVersionForRead(
    query: ResolveSourceVersionForReadQueryV1,
  ): Promise<ContextSourceResultV1> {
    const parsed = ResolveSourceVersionForReadQueryV1Schema.safeParse(query);
    if (!parsed.success)
      return resultFailure(moduleError("UNSUPPORTED_CONTRACT", "source-version-read"));
    const valid = parsed.data;
    try {
      await this.#verifyRead(
        valid,
        valid.authorization.grantedCapabilities.includes("engineering-data.write")
          ? "engineering-data.register-source-delivery"
          : "engineering-data.evidence-access",
        valid.authorization.spatialScopeRefs,
        [valid.sourceVersionRef],
      );
      const sourceVersion = await this.#readSourceVersion(valid.projectId, valid.sourceVersionRef);
      if (
        sourceVersion === undefined ||
        sourceVersion.accessStatus !== "ready" ||
        sourceVersion.sourceAccessGrantRef === undefined
      ) {
        return resultFailure(moduleError("AUTHORIZATION_DENIED", valid.queryId));
      }
      const input = sourceProcessingInput(sourceVersion);
      return resultSuccess({ kind: "source-processing-input", input });
    } catch (error) {
      return resultFailure(
        this.#mapError(error, valid.queryId, "engineering-data.source-version-read"),
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
      const decision = await this.#verify(valid, valid.authorization.spatialScopeRefs, []);
      const verified = { ...valid, actorId: decision.context.actorId };
      const atomic = atomicCommand(
        verified,
        "engineering-data.applicability-snapshot.v1",
        verified,
      );
      const receipt = await this.#transactionUnit.execute(atomic, async (context) =>
        this.#createSnapshotInTransaction(context, verified),
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
    if (valid.kind === "register-monitoring-batch" && this.#monitoringStore !== undefined) {
      return this.#monitoringStore.registerBatch(valid);
    }
    if (valid.kind === "register-external-risk-event")
      return this.#registerExternalRiskEvent(valid);
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
    if (!parsed.success)
      return {
        kind: "failed",
        error: moduleError("UNSUPPORTED_CONTRACT", "engineering-data.freeze"),
      };
    if (parsed.data.kind === "monitoring-snapshot" && this.#monitoringStore !== undefined) {
      return this.#monitoringStore.freezeSnapshot(parsed.data);
    }
    if (
      parsed.data.kind === "identification-preparation" &&
      this.#dataCleaningStore !== undefined
    ) {
      return this.#dataCleaningStore.freezeIdentificationPreparation(parsed.data);
    }
    if (parsed.data.kind === "assessment-preparation") {
      return this.#freezeAssessmentPreparation(parsed.data);
    }
    return { kind: "failed", error: moduleError("UNSUPPORTED_CONTRACT", parsed.data.commandId) };
  }

  async read(query: EngineeringDataQueryV1): Promise<EngineeringDataReadResultV1> {
    const parsed = EngineeringDataQueryV1Schema.safeParse(query);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: readRequestDenied(query)
          ? readAuthorizationDenied(readCausalRunId(query, "engineering-data.read"))
          : moduleError("UNSUPPORTED_CONTRACT", readCausalRunId(query, "engineering-data.read")),
      };
    }
    const valid = parsed.data;
    if (valid.kind === "monitoring-snapshot") {
      return this.#monitoringStore === undefined
        ? { kind: "failed", error: moduleError("UNSUPPORTED_CONTRACT", valid.queryId) }
        : this.#monitoringStore.readSnapshot(valid);
    }
    return valid.kind === "source-segments"
      ? this.#readSourceSegments(valid)
      : this.#readEvidenceAccess(valid);
  }

  async #readSourceSegments(
    query: Extract<EngineeringDataQueryV1, { kind: "source-segments" }>,
  ): Promise<EngineeringDataReadResultV1> {
    const branchQuery = { kind: query.kind, ...query.payload };
    const queryResultRef = readQueryResultRef("source-segments", query.queryId);
    try {
      const decision = await this.#verifyRead(query, READ_BRANCH["source-segments"], [], []);
      const verified = { ...query, actorId: decision.context.actorId };
      const target = await this.#resolveSourceSegmentTarget(
        query.projectId,
        branchQuery.sourceSegmentSetRef,
      );
      if (target === undefined) {
        return { kind: "failed", error: readAuthorizationDenied(query.queryId) };
      }
      await this.#verifyRead(verified, READ_BRANCH["source-segments"], target.spatialScopeRefs, [
        target.sourceVersion.sourceVersionRef,
      ]);
      await this.#registerReadQuery(verified, {
        branch: "source-segments",
        branchQuery,
        queryResultRef,
      });
      return { kind: "succeeded", result: { queryResultRef } };
    } catch (error) {
      return {
        kind: "failed",
        error: this.#mapError(
          error,
          query.queryId,
          "engineering-data.read",
          "engineering-data.read",
        ),
      };
    }
  }

  async #readEvidenceAccess(
    query: Extract<EngineeringDataQueryV1, { kind: "evidence-access" }>,
  ): Promise<EngineeringDataReadResultV1> {
    const branchQuery = { kind: query.kind, ...query.payload };
    const queryResultRef = readQueryResultRef("evidence-access", query.queryId);
    try {
      const declaredSourceVersionRefs = dedupeSourceVersionRefs(
        branchQuery.evidenceReferences.map((evidence) =>
          SourceVersionV1Schema.shape.sourceVersionRef.parse({
            kind: "source-version",
            reference: evidence.sourceVersion,
          }),
        ),
      );
      const decision = await this.#verifyRead(
        query,
        READ_BRANCH["evidence-access"],
        [],
        declaredSourceVersionRefs,
      );
      const verified = { ...query, actorId: decision.context.actorId };
      const target = await this.#resolveEvidenceAccessTargets(
        query.projectId,
        branchQuery.evidenceReferences,
      );
      if (target === undefined) {
        return { kind: "failed", error: readAuthorizationDenied(query.queryId) };
      }
      await this.#verifyRead(
        verified,
        READ_BRANCH["evidence-access"],
        target.spatialScopeRefs,
        declaredSourceVersionRefs,
      );
      await this.#registerReadQuery(verified, {
        branch: "evidence-access",
        branchQuery,
        queryResultRef,
      });
      return { kind: "succeeded", result: { queryResultRef } };
    } catch (error) {
      return {
        kind: "failed",
        error: this.#mapError(
          error,
          query.queryId,
          "engineering-data.read",
          "engineering-data.read",
        ),
      };
    }
  }

  async #registerReadQuery(
    query: {
      queryId: string;
      projectId: string;
      actorId: string;
      requestedAt: string;
      authorization: AuthorizationContextV1;
    },
    input: {
      readonly branch: EngineeringDataReadBranch;
      readonly branchQuery: EngineeringDataReadBranchQueryV1;
      readonly queryResultRef: QueryResultRefV1;
    },
  ): Promise<void> {
    const command = {
      commandId: query.queryId,
      idempotencyKey: query.queryId,
      projectId: query.projectId,
      actorId: query.actorId,
      issuedAt: query.requestedAt,
      authorization: query.authorization,
    };
    await this.#transactionUnit.execute(
      atomicCommand(command, READ_QUERY_COMMAND_KIND[input.branch], input.branchQuery),
      async (context) => {
        const transaction = asTransaction(context);
        const recordedAt = nowIso(this.#now);
        await transaction
          .insertInto("business.engineering_data_read_query_results")
          .values({
            query_result_id: input.queryResultRef.reference.entityId,
            version_id: input.queryResultRef.reference.versionId,
            project_id: query.projectId,
            branch: input.branch,
            query_result_ref: jsonValue(input.queryResultRef),
            query_payload: jsonValue(
              EngineeringDataReadBranchQueryV1Schema.parse(input.branchQuery),
            ),
            authorization_context_ref: jsonValue(query.authorization.authorizationContextRef),
            requested_by: query.actorId,
            recorded_at: recordedAt,
            persisted_at: sql`clock_timestamp()`,
            audit_entry_id: auditEntryIdFor(query.queryId),
          } satisfies InsertObject<
            ContextSourceDatabase,
            "business.engineering_data_read_query_results"
          >)
          .onConflict((conflict) =>
            conflict.columns(["project_id", "query_result_ref"]).doNothing(),
          )
          .execute();
        return commit(
          command,
          READ_QUERY_ACTION[input.branch],
          input.queryResultRef,
          input.queryResultRef.reference,
          recordedAt,
        );
      },
    );
  }

  async resolveReadQuery(
    query: ResolveEngineeringDataReadQueryV1,
  ): Promise<EngineeringDataReadResolutionResultV1> {
    const parsed = ResolveEngineeringDataReadQueryV1Schema.safeParse(query);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: readRequestDenied(query)
          ? readAuthorizationDenied(readCausalRunId(query, "engineering-data.resolve-read-query"))
          : moduleError(
              "UNSUPPORTED_CONTRACT",
              readCausalRunId(query, "engineering-data.resolve-read-query"),
            ),
      };
    }
    const valid = parsed.data;
    const branch = readBranchOfQueryResultRef(valid.queryResultRef.reference.entityId);
    if (branch === undefined) {
      return { kind: "failed", error: readAuthorizationDenied(valid.invocationId) };
    }
    try {
      await this.#verifyRead(
        { ...valid, queryId: valid.invocationId },
        READ_BRANCH[branch],
        [],
        [],
      );
      const row = await this.#db
        .selectFrom("business.engineering_data_read_query_results")
        .selectAll()
        .where("query_result_id", "=", valid.queryResultRef.reference.entityId)
        .where("version_id", "=", valid.queryResultRef.reference.versionId)
        .executeTakeFirst();
      if (row === undefined || row.project_id !== valid.projectId || row.branch !== branch) {
        return { kind: "failed", error: readAuthorizationDenied(valid.invocationId) };
      }
      const record = EngineeringDataReadQueryRecordV1Schema.safeParse({
        queryResultRef: row.query_result_ref,
        projectId: row.project_id,
        query: row.query_payload,
        requestedBy: row.requested_by,
        authorizationContextRef: row.authorization_context_ref,
        recordedAt: asIso(row.recorded_at),
        audit: {
          actorId: row.requested_by,
          action: READ_QUERY_ACTION[row.branch],
          recordedAt: asIso(row.recorded_at),
        },
      });
      if (!record.success || record.data.query.kind !== branch) {
        return { kind: "failed", error: readAuthorizationDenied(valid.invocationId) };
      }
      const result = await this.#projectReadQuery(valid, record.data);
      return result === undefined
        ? { kind: "failed", error: readAuthorizationDenied(valid.invocationId) }
        : { kind: "succeeded", result };
    } catch (error) {
      return {
        kind: "failed",
        error: this.#mapError(
          error,
          valid.invocationId,
          "engineering-data.resolve-read-query",
          "engineering-data.read",
        ),
      };
    }
  }

  async #projectReadQuery(
    query: ResolveEngineeringDataReadQueryV1,
    record: EngineeringDataReadQueryRecordV1,
  ): Promise<SourceSegmentReadResultV1 | EvidenceAccessReadResultV1 | undefined> {
    const verify = {
      queryId: query.invocationId,
      projectId: query.projectId,
      actorId: query.actorId,
      authorization: query.authorization,
    };
    if (record.query.kind === "source-segments") {
      const target = await this.#resolveSourceSegmentTarget(
        query.projectId,
        record.query.sourceSegmentSetRef,
      );
      if (target === undefined || target.sourceVersion.sourceAccessGrantRef === undefined) {
        return undefined;
      }
      await this.#verifyRead(verify, READ_BRANCH["source-segments"], target.spatialScopeRefs, [
        target.sourceVersion.sourceVersionRef,
      ]);
      return SourceSegmentReadResultV1Schema.parse({
        kind: "source-segments",
        queryResultRef: record.queryResultRef,
        segmentSet: target.segmentSet,
        sourceAccessGrantRef: target.sourceVersion.sourceAccessGrantRef,
      });
    }
    const declaredSourceVersionRefs = dedupeSourceVersionRefs(
      record.query.evidenceReferences.map((evidence) =>
        SourceVersionV1Schema.shape.sourceVersionRef.parse({
          kind: "source-version",
          reference: evidence.sourceVersion,
        }),
      ),
    );
    const target = await this.#resolveEvidenceAccessTargets(
      query.projectId,
      record.query.evidenceReferences,
    );
    if (target === undefined) return undefined;
    await this.#verifyRead(
      verify,
      READ_BRANCH["evidence-access"],
      target.spatialScopeRefs,
      declaredSourceVersionRefs,
    );
    return EvidenceAccessReadResultV1Schema.parse({
      kind: "evidence-access",
      queryResultRef: record.queryResultRef,
      purposeCode: record.query.purposeCode,
      items: target.items,
    });
  }

  async #resolveSourceSegmentTarget(
    projectId: string,
    sourceSegmentSetRef: SourceSegmentSetRefV1,
  ): Promise<SourceSegmentReadTarget | undefined> {
    const segmentSet = await this.#readSegmentSet(projectId, sourceSegmentSetRef);
    if (segmentSet === undefined) return undefined;
    const sourceVersion = await this.#readSourceVersion(projectId, segmentSet.sourceVersionRef);
    if (
      sourceVersion === undefined ||
      sourceVersion.accessStatus !== "ready" ||
      sourceVersion.sourceAccessGrantRef === undefined
    ) {
      return undefined;
    }
    return {
      sourceVersion,
      segmentSet,
      spatialScopeRefs: dedupeSpatialScopeRefs([
        sourceVersion.spatialScopeRefs,
        ...segmentSet.segments.map((segment) => segment.spatialScopeRefs),
      ]),
    };
  }

  async #resolveEvidenceAccessTargets(
    projectId: string,
    evidenceReferences: readonly EvidenceReference[],
  ): Promise<EvidenceAccessReadTarget | undefined> {
    const sourceVersionIds = [
      ...new Set(evidenceReferences.map((evidence) => evidence.sourceVersion.entityId)),
    ];
    const sourceVersionRows = await this.#db
      .selectFrom("business.source_versions")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("source_version_id", "in", sourceVersionIds)
      .execute();
    const sourceVersionByStorageId = new Map(
      sourceVersionRows.map((row) => [`${row.source_version_id}/${row.version_id}`, row] as const),
    );
    const segmentSetRows = await this.#db
      .selectFrom("business.source_segment_sets")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("source_version_id", "in", sourceVersionIds)
      .execute();
    const segmentSetBySourceVersion = new Map(
      segmentSetRows.map((row) => [row.source_version_id, row] as const),
    );
    const segmentRows = await this.#db
      .selectFrom("business.source_segments")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("source_segment_id", "in", [
        ...new Set(evidenceReferences.map((evidence) => evidence.locator.sourceSegmentId)),
      ])
      .execute();
    const segmentBySegmentId = new Map(
      segmentRows.map((row) => [row.source_segment_id, row] as const),
    );
    const items: EvidenceAccessItemV1[] = [];
    const resolvedScopeRefs: SpatialScopeRefV1[][] = [];
    for (const evidence of evidenceReferences) {
      const sourceVersionRow = sourceVersionByStorageId.get(
        `${evidence.sourceVersion.entityId}/${evidence.sourceVersion.versionId}`,
      );
      if (sourceVersionRow === undefined) return undefined;
      const sourceVersion = toSourceVersion(sourceVersionRow);
      if (
        sourceVersion.accessStatus !== "ready" ||
        sourceVersion.sourceAccessGrantRef === undefined
      ) {
        return undefined;
      }
      const segmentSetRow = segmentSetBySourceVersion.get(sourceVersionRow.source_version_id);
      const segmentRow = segmentBySegmentId.get(evidence.locator.sourceSegmentId);
      if (
        segmentSetRow === undefined ||
        segmentRow === undefined ||
        segmentRow.source_version_id !== sourceVersionRow.source_version_id ||
        segmentRow.source_segment_set_id !== segmentSetRow.source_segment_set_id
      ) {
        return undefined;
      }
      const segment = toSourceSegment(segmentRow);
      resolvedScopeRefs.push(sourceVersion.spatialScopeRefs, segment.spatialScopeRefs);
      items.push(
        EvidenceAccessItemV1Schema.parse({
          evidenceReference: evidence,
          sourceVersionRef: sourceVersion.sourceVersionRef,
          sourceSegmentSetRef: segmentSetRow.source_segment_set_ref,
          sourceAccessGrantRef: sourceVersion.sourceAccessGrantRef,
          segment,
        }),
      );
    }
    if (items.length === 0) return undefined;
    return {
      items,
      spatialScopeRefs: dedupeSpatialScopeRefs(resolvedScopeRefs),
    };
  }

  async #registerExternalRiskEvent(
    command: Extract<EngineeringDataCommandV1, { kind: "register-external-risk-event" }>,
  ): Promise<EngineeringDataApplyResultV1> {
    try {
      const evidence = normalizeEvidenceReferences(command.payload.evidenceReferences);
      const decision = await this.#verify(
        command,
        command.authorization.spatialScopeRefs,
        normalizeVersionedRefs(
          evidence.map((item) =>
            ref("source-version", item.sourceVersion.entityId, item.sourceVersion.versionId),
          ),
        ),
        "engineering-data.register-external-risk-event",
      );
      const verified = { ...command, actorId: decision.context.actorId };
      const atomic = atomicCommand(
        verified,
        "engineering-data.register-external-risk-event.v1",
        verified,
      );
      const receipt = await this.#transactionUnit.execute(atomic, async (context) =>
        this.#registerExternalRiskEventInTransaction(context, verified, evidence),
      );
      return {
        kind: "succeeded",
        result: {
          kind: "register-external-risk-event",
          externalRiskEventRef: ExternalRiskEventRefV1Schema.parse(receipt.resultRef),
        },
      };
    } catch (error) {
      return {
        kind: "failed",
        error: this.#mapError(
          error,
          command.commandId,
          "engineering-data.register-external-risk-event",
          "engineering-data.write",
          true,
        ),
      };
    }
  }

  async #registerExternalRiskEventInTransaction(
    context: TransactionContextV1,
    command: Extract<EngineeringDataCommandV1, { kind: "register-external-risk-event" }>,
    evidence: readonly EvidenceReference[],
  ): Promise<AtomicCommitV1> {
    const transaction = asTransaction(context);
    const externalRiskEventId = externalRiskEventIdFor(command);
    const externalRiskEventRef = ExternalRiskEventRefV1Schema.parse(
      ref("external-risk-event", externalRiskEventId, "1"),
    );
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`riskflow.c11.external-risk-event.${command.projectId}.${externalRiskEventId}`}, 0))`.execute(
      transaction,
    );
    const artifact = await this.#assertExternalRiskEventArtifact(context, command);
    if (refKey(artifact.artifactRef) !== refKey(command.payload.eventArtifactRef))
      throw preserveDomainError(moduleError("AUTHORIZATION_DENIED", command.commandId));
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
    if (projectRevision === undefined)
      throw preserveDomainError(moduleError("AUTHORIZATION_DENIED", command.commandId));
    if (projectRevision.lifecycle === "ended" || projectRevision.lifecycle === "archived")
      throw preserveDomainError(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerRef: ref(
            "project-revision",
            command.projectId,
            versionIdFromReference(projectRevision.project_revision_ref as never),
          ),
          blockerKind: "project-lifecycle",
        }),
      );
    const priorRegistration = await transaction
      .selectFrom("business.external_risk_events")
      .select(["external_risk_event_id"])
      .where("external_risk_event_id", "=", externalRiskEventId)
      .executeTakeFirst();
    if (priorRegistration !== undefined)
      throw preserveDomainError(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerRef: externalRiskEventRef,
          blockerKind: "external-risk-event",
        }),
      );
    const authorizedScopeIds = new Set(
      command.authorization.spatialScopeRefs.map((scope) => scope.reference.entityId),
    );
    const evidenceSourceVersions: SourceVersionRefV1[] = [];
    const evidenceSpatialScopes: SpatialScopeRefV1[] = [];
    for (const item of evidence) {
      const sourceVersionRef = ref(
        "source-version",
        item.sourceVersion.entityId,
        item.sourceVersion.versionId,
      ) as SourceVersionRefV1;
      const sourceVersion = await transaction
        .selectFrom("business.source_versions")
        .select(["access_status"])
        .where("project_id", "=", command.projectId)
        .where("source_version_id", "=", sourceVersionRef.reference.entityId)
        .where("version_id", "=", sourceVersionRef.reference.versionId)
        .executeTakeFirst();
      if (sourceVersion === undefined || sourceVersion.access_status !== "ready")
        throw preserveDomainError(moduleError("AUTHORIZATION_DENIED", command.commandId));
      const segment = await transaction
        .selectFrom("business.source_segments")
        .select(["spatial_scope_refs"])
        .where("project_id", "=", command.projectId)
        .where("source_version_id", "=", sourceVersionRef.reference.entityId)
        .where("source_segment_id", "=", item.locator.sourceSegmentId)
        .executeTakeFirst();
      const segmentSpatialScopes =
        segment === undefined
          ? undefined
          : SpatialScopeRefSetV1Schema.safeParse(segment.spatial_scope_refs);
      if (
        segmentSpatialScopes === undefined ||
        !segmentSpatialScopes.success ||
        segmentSpatialScopes.data.some((scope) => !authorizedScopeIds.has(scope.reference.entityId))
      )
        throw preserveDomainError(moduleError("AUTHORIZATION_DENIED", command.commandId));
      evidenceSourceVersions.push(sourceVersionRef);
      evidenceSpatialScopes.push(...segmentSpatialScopes.data);
    }
    const auditId = auditEntryIdFor(command.commandId);
    await transaction
      .insertInto("business.external_risk_events")
      .values({
        external_risk_event_id: externalRiskEventId,
        version_id: externalRiskEventRef.reference.versionId,
        project_id: command.projectId,
        external_risk_event_ref: jsonValue(externalRiskEventRef),
        external_source_entity_id: command.payload.externalSourceRef.entityId,
        external_source_version_id: command.payload.externalSourceRef.versionId,
        external_source_ref: jsonValue(command.payload.externalSourceRef),
        external_event_key: command.payload.externalEventKey,
        event_artifact_ref: jsonValue(command.payload.eventArtifactRef),
        evidence_references: jsonValue(command.payload.evidenceReferences),
        source_version_refs: jsonValue(normalizeVersionedRefs(evidenceSourceVersions)),
        spatial_scope_refs: jsonValue(normalizeVersionedRefs(evidenceSpatialScopes)),
        occurred_at: command.payload.occurredAt,
        recorded_at: command.issuedAt,
        persisted_at: sql`clock_timestamp()`,
        actor_id: command.actorId,
        authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
        audit_entry_id: auditId,
      } satisfies InsertObject<ContextSourceDatabase, "business.external_risk_events">)
      .execute();
    return commit(
      command,
      "engineering-data.register-external-risk-event",
      externalRiskEventRef,
      externalRiskEventRef.reference,
      command.issuedAt,
      auditId,
    );
  }

  async #assertExternalRiskEventArtifact(
    context: TransactionContextV1,
    command: Extract<EngineeringDataCommandV1, { kind: "register-external-risk-event" }>,
  ): Promise<ArtifactReferenceCheckResultV1> {
    try {
      return await this.#assertArtifact(
        context,
        command,
        command.payload.eventArtifactRef,
        "engineering-data.register-external-risk-event",
      );
    } catch (error) {
      if (!(error instanceof ArtifactStoreError)) throw error;
      if (error.code !== "ARTIFACT_REFERENCE_NOT_FOUND" && error.code !== "ARTIFACT_ACCESS_DENIED")
        throw preserveDomainError(
          mapArtifactErrorToModuleError(error, {
            causalRunId: command.commandId,
            requiredCapability: "engineering-data.write",
            authorizationPolicyRef: ACCESS_POLICY_REF_V1,
            schemaVersion: "1",
          }),
        );
      throw preserveDomainError(moduleError("AUTHORIZATION_DENIED", command.commandId));
    }
  }

  async #registerSourceDelivery(
    command: Extract<EngineeringDataCommandV1, { kind: "register-source-delivery" }>,
  ): Promise<EngineeringDataApplyResultV1> {
    try {
      const decision = await this.#verify(command, command.authorization.spatialScopeRefs, []);
      const verified = { ...command, actorId: decision.context.actorId };
      const metadataRead = await this.#readDeliveryMetadata(verified);
      const envelope = metadataRead.envelope;
      if (envelope.registeredByAccountId !== verified.actorId) {
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
      const atomic = atomicCommand(verified, "engineering-data.register-source-delivery.v1", {
        command: verified,
        metadata: envelope,
      });
      const receipt = await this.#transactionUnit.execute(atomic, async (context) =>
        this.#registerSourceDeliveryInTransaction(context, verified, envelope, metadataRead),
      );
      const sourceVersionRef = SourceVersionV1Schema.shape.sourceVersionRef.parse(
        receipt.resultRef,
      );
      await this.#verify(verified, verified.authorization.spatialScopeRefs, []);
      const sourceVersion = await this.#readSourceVersion(verified.projectId, sourceVersionRef);
      if (sourceVersion === undefined) {
        return { kind: "failed", error: moduleError("TERMINAL_FAILURE", command.commandId) };
      }
      await this.#ensureSourceAccess(
        verified,
        sourceVersion,
        verified.authorization.spatialScopeRefs,
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
    branch: ModuleBranchV1 = "engineering-data.register-source-delivery",
  ): Promise<AuthorizationDecisionV1> {
    if (
      command.projectId !== command.authorization.projectId ||
      command.actorId !== command.authorization.actorId ||
      !command.authorization.grantedCapabilities.includes(MODULE_BRANCH_CAPABILITY_V1[branch])
    ) {
      throw preserveDomainError(moduleError("AUTHORIZATION_DENIED", command.commandId));
    }
    const decision = await this.#access.verify({
      authorizationContextRef: command.authorization.authorizationContextRef,
      invocationId: command.commandId,
      projectId: command.projectId,
      branch,
      requestedSpatialScopeRefs: [...requestedSpatialScopeRefs],
      requestedSourceVersionRefs: [...requestedSourceVersionRefs],
      requestedAt: command.authorization.decidedAt,
    });
    // 操作者身份只取自 C06 当前验证结果；命令声明主体必须与之一致。
    if (decision.context.actorId !== command.actorId) {
      throw preserveDomainError(moduleError("AUTHORIZATION_DENIED", command.commandId));
    }
    return decision;
  }

  /**
   * Resolved C11 targets carry business spatial revisions, while the C06
   * authorization and its current-access evaluation only know access scope
   * revisions. Both spaces share the scope identity, so an exact re-verify
   * projects each resolved scope onto the authorization's own ref and refuses
   * anything the caller's context does not name.
   */
  async #verifyRead(
    query: {
      queryId: string;
      projectId: string;
      actorId: string;
      authorization: AuthorizationContextV1;
    },
    branch: ModuleBranchV1,
    resolvedSpatialScopeRefs: readonly SpatialScopeRefV1[],
    requestedSourceVersionRefs: readonly SourceVersionRefV1[],
  ): Promise<AuthorizationDecisionV1> {
    if (
      query.projectId !== query.authorization.projectId ||
      query.actorId !== query.authorization.actorId ||
      (!query.authorization.grantedCapabilities.includes("engineering-data.read") &&
        !query.authorization.grantedCapabilities.includes("engineering-data.write"))
    ) {
      throw preserveDomainError(
        moduleError("AUTHORIZATION_DENIED", query.queryId, {
          requiredCapability: MODULE_BRANCH_CAPABILITY_V1[branch],
        }),
      );
    }
    const requestedSpatialScopeRefs = new Map<string, SpatialScopeRefV1>();
    for (const resolved of resolvedSpatialScopeRefs) {
      const authorized = query.authorization.spatialScopeRefs.find(
        (scope) => scope.reference.entityId === resolved.reference.entityId,
      );
      if (authorized === undefined) {
        throw preserveDomainError(
          moduleError("AUTHORIZATION_DENIED", query.queryId, {
            requiredCapability: MODULE_BRANCH_CAPABILITY_V1[branch],
          }),
        );
      }
      requestedSpatialScopeRefs.set(refKey(authorized), authorized);
    }
    const decision = await this.#access.verify({
      authorizationContextRef: query.authorization.authorizationContextRef,
      invocationId: query.queryId,
      projectId: query.projectId,
      branch,
      requestedSpatialScopeRefs: [...requestedSpatialScopeRefs.values()],
      requestedSourceVersionRefs: [...requestedSourceVersionRefs],
      requestedAt: query.authorization.decidedAt,
    });
    // 操作者身份只取自 C06 当前验证结果；查询声明主体必须与之一致。
    if (decision.context.actorId !== query.actorId) {
      throw preserveDomainError(
        moduleError("AUTHORIZATION_DENIED", query.queryId, {
          requiredCapability: MODULE_BRANCH_CAPABILITY_V1[branch],
        }),
      );
    }
    return decision;
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
    command: { readonly projectId: string; readonly authorization: AuthorizationContextV1 },
    artifactRef: ContentArtifactRefV1,
    purposeCode = "engineering-data.register-source-delivery",
  ) {
    const request = ArtifactReferenceCheckRequestV1Schema.parse({
      schemaVersion: "1",
      artifactRef,
      projectId: command.projectId,
      purposeCode,
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
    return rows.map(toSourceSegment);
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

  // ------------------------------------------------- assessment preparation (C25)

  /**
   * C25 评估准备冻结（D-02）：命令字段原样冻结，风险输入、适用性与每个监测快照/序列都在
   * 这里用 C06 当前事实复验；C25 不创建监测快照、不选择序列或截止点、不推导入口语义。
   */
  async #freezeAssessmentPreparation(
    command: Extract<EngineeringFreezeCommandV1, { kind: "assessment-preparation" }>,
  ): Promise<EngineeringFreezeResultV1> {
    try {
      const factsReader = this.#riskInputFacts;
      const monitoringStore = this.#monitoringStore;
      if (factsReader === undefined || monitoringStore === undefined) {
        return {
          kind: "failed",
          error: moduleError("UNSUPPORTED_CONTRACT", command.commandId, { schemaVersion: "1" }),
        };
      }
      // C06 只认授权上下文自己的访问空间；载荷的业务空间引用必须落在同一空间身份内。
      if (
        !command.authorization.spatialScopeRefs.some((scope) =>
          sameEntity(scope, command.payload.spatialScopeRef),
        )
      ) {
        return { kind: "failed", error: moduleError("AUTHORIZATION_DENIED", command.commandId) };
      }
      const decision = await this.#verify(
        command,
        command.authorization.spatialScopeRefs,
        [],
        "engineering-data.assessment-preparation",
      );
      const verified = { ...command, actorId: decision.context.actorId };
      const payloadRun = command.payload.causalRunRef;
      const authorizationRun = decision.context.causalRunRef;
      if (
        payloadRun !== undefined &&
        authorizationRun !== undefined &&
        !sameVersion(payloadRun.reference, authorizationRun.reference)
      ) {
        return {
          kind: "failed",
          error: moduleError("AUTHORIZATION_DENIED", command.commandId, {
            requiredCapability:
              MODULE_BRANCH_CAPABILITY_V1["engineering-data.assessment-preparation"],
          }),
        };
      }

      const projectRevision = await this.#readProjectRevision(
        command.projectId,
        versionIdFromReference(command.payload.projectRevisionRef),
      );
      const project = await this.#db
        .selectFrom("business.engineering_projects")
        .select(["current_revision_id"])
        .where("project_id", "=", command.projectId)
        .executeTakeFirst();
      if (projectRevision === undefined || project === undefined) {
        return { kind: "failed", error: moduleError("AUTHORIZATION_DENIED", command.commandId) };
      }
      if (
        project.current_revision_id !==
        projectRevisionStorageId(
          command.projectId,
          versionIdFromReference(command.payload.projectRevisionRef),
        )
      ) {
        return {
          kind: "failed",
          error: moduleError("STALE_VERSION", command.commandId, {
            targetRef: command.payload.projectRevisionRef,
          }),
        };
      }
      const applicability = await this.#readSnapshot(
        command.projectId,
        command.payload.applicabilityMetadataSnapshotRef,
      );
      if (applicability === undefined) {
        return { kind: "failed", error: moduleError("AUTHORIZATION_DENIED", command.commandId) };
      }
      if (
        !sameVersion(
          applicability.projectRevisionRef.reference,
          command.payload.projectRevisionRef.reference,
        )
      ) {
        return {
          kind: "failed",
          error: moduleError("STALE_VERSION", command.commandId, {
            targetRef: command.payload.applicabilityMetadataSnapshotRef,
          }),
        };
      }

      const monitoringRefs = command.payload.monitoringSnapshotRefs;
      if (monitoringRefs !== undefined) {
        const keys = monitoringRefs.map(refKey);
        if (new Set(keys).size !== keys.length) {
          return {
            kind: "failed",
            error: moduleError("UNSUPPORTED_CONTRACT", command.commandId, { schemaVersion: "1" }),
          };
        }
      }

      const factsAuthorization = await this.#downstreamAuthorization({
        branch: RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.riskInputFacts,
        invocationId: `${command.commandId}:risk-input-facts`,
        projectId: command.projectId,
        actorId: verified.actorId,
        requestedAt: command.issuedAt,
        requestedSpatialScopeRefs: [command.payload.spatialScopeRef],
      });
      const factsResult = await factsReader.readRiskInputFacts({
        requestId: `${command.commandId}:risk-input-facts`,
        idempotencyKey: `${command.idempotencyKey}:risk-input-facts`,
        requestedAt: command.issuedAt,
        authorization: factsAuthorization,
        riskInput: command.payload.riskInput,
      });
      if (factsResult.kind !== "succeeded") {
        return {
          kind: "failed",
          error:
            factsResult.kind === "failed"
              ? factsResult.error
              : moduleError("BUSINESS_BLOCKED", command.commandId, {
                  blockerKind: "risk-input-facts-unavailable",
                  blockerRef: command.payload.riskInput,
                }),
        };
      }
      const facts = RiskInputFactsV1Schema.parse(factsResult.facts);
      if (
        facts.projectId !== command.projectId ||
        !sameVersion(facts.riskInput.reference, command.payload.riskInput.reference) ||
        facts.riskInput.kind !== command.payload.riskInput.kind
      ) {
        return { kind: "failed", error: moduleError("AUTHORIZATION_DENIED", command.commandId) };
      }

      // 监测读取所需的资料版本只能来自本次已读到的风险输入证据（C14 快照证据同源）。
      const sourceVersionRefs = [
        ...new Map(
          facts.evidenceReferences.map((evidence) => [
            `${evidence.sourceVersion.entityId}\u0000${evidence.sourceVersion.versionId}`,
            { kind: "source-version" as const, reference: evidence.sourceVersion },
          ]),
        ).values(),
      ].sort((left, right) =>
        `${left.reference.entityId}\u0000${left.reference.versionId}` <
        `${right.reference.entityId}\u0000${right.reference.versionId}`
          ? -1
          : 1,
      );
      const orderedMonitoringRefs =
        monitoringRefs === undefined
          ? []
          : [...monitoringRefs].sort((left, right) => (refKey(left) < refKey(right) ? -1 : 1));
      for (const monitoringRef of orderedMonitoringRefs) {
        await this.#verifyMonitoringRef(
          command,
          verified.actorId,
          monitoringRef,
          sourceVersionRefs,
        );
      }

      const recordedAt = nowIso(this.#now);
      const auditEntryId = auditEntryIdFor(command.commandId, ":assessment-preparation");
      const snapshot = AssessmentPreparationSnapshotV1Schema.parse({
        schemaVersion: "1",
        projectRevisionRef: command.payload.projectRevisionRef,
        spatialScopeRef: command.payload.spatialScopeRef,
        riskInput: command.payload.riskInput,
        applicabilityMetadataSnapshotRef: command.payload.applicabilityMetadataSnapshotRef,
        ...(monitoringRefs === undefined ? {} : { monitoringSnapshotRefs: orderedMonitoringRefs }),
        sourceEvidenceReferences: facts.evidenceReferences,
        entryMode: command.payload.entryMode,
        triggerReasonCode: command.payload.triggerReasonCode,
        ...(command.payload.previousAssessmentRecordRef === undefined
          ? {}
          : { previousAssessmentRecordRef: command.payload.previousAssessmentRecordRef }),
        ...(command.payload.causalRunRef === undefined
          ? {}
          : { causalRunRef: command.payload.causalRunRef }),
        authorizationContextRef: decision.context.authorizationContextRef,
        auditTrailRef: {
          kind: "audit-trail",
          reference: { entityId: auditEntryId, versionId: "1" },
        },
        createdBy: verified.actorId,
        createdAt: recordedAt,
      });
      // 业务身份不含记录时钟；可选字段只在提供时进入摘要，避免 undefined 进入规范 JSON。
      const digest = sha256CanonicalJson({
        schemaVersion: "1",
        projectId: command.projectId,
        idempotencyKey: command.idempotencyKey,
        projectRevisionRef: snapshot.projectRevisionRef,
        spatialScopeRef: snapshot.spatialScopeRef,
        riskInput: snapshot.riskInput,
        applicabilityMetadataSnapshotRef: snapshot.applicabilityMetadataSnapshotRef,
        sourceEvidenceReferences: snapshot.sourceEvidenceReferences,
        entryMode: snapshot.entryMode,
        triggerReasonCode: snapshot.triggerReasonCode,
        ...(snapshot.monitoringSnapshotRefs === undefined
          ? {}
          : { monitoringSnapshotRefs: snapshot.monitoringSnapshotRefs }),
        ...(snapshot.previousAssessmentRecordRef === undefined
          ? {}
          : { previousAssessmentRecordRef: snapshot.previousAssessmentRecordRef }),
        ...(snapshot.causalRunRef === undefined ? {} : { causalRunRef: snapshot.causalRunRef }),
      });
      const snapshotRef = ref(
        "assessment-preparation-snapshot",
        `assessment-preparation-${digest.slice(0, 40)}`,
        "1",
      );

      await this.#transactionUnit.execute(
        atomicCommand(verified, "engineering-data.assessment-preparation.v1", {
          snapshotRef,
          entryMode: snapshot.entryMode,
          triggerReasonCode: snapshot.triggerReasonCode,
          riskInput: snapshot.riskInput,
          monitoringSnapshotRefs: snapshot.monitoringSnapshotRefs,
          identityDigest: digest,
        }),
        async (transactionContext): Promise<AtomicCommitV1> => {
          const transaction = asTransaction(transactionContext);
          await transaction
            .insertInto("business.assessment_preparation_snapshots")
            .values({
              snapshot_id: snapshotRef.reference.entityId,
              version_id: snapshotRef.reference.versionId,
              schema_version: "1",
              project_id: command.projectId,
              command_id: command.commandId,
              idempotency_key: command.idempotencyKey,
              payload_hash: digest,
              risk_input_ref: jsonValue(snapshot.riskInput),
              risk_input_kind: snapshot.riskInput.kind,
              risk_input_entity_id: snapshot.riskInput.reference.entityId,
              risk_input_version_id: snapshot.riskInput.reference.versionId,
              project_revision_ref: jsonValue(snapshot.projectRevisionRef),
              spatial_scope_ref: jsonValue(snapshot.spatialScopeRef),
              applicability_snapshot_ref: jsonValue(snapshot.applicabilityMetadataSnapshotRef),
              monitoring_snapshot_refs:
                snapshot.monitoringSnapshotRefs === undefined
                  ? null
                  : jsonValue(snapshot.monitoringSnapshotRefs),
              entry_mode: snapshot.entryMode,
              trigger_reason_code: snapshot.triggerReasonCode,
              previous_assessment_record_ref:
                snapshot.previousAssessmentRecordRef === undefined
                  ? null
                  : jsonValue(snapshot.previousAssessmentRecordRef),
              causal_run_ref:
                snapshot.causalRunRef === undefined ? null : jsonValue(snapshot.causalRunRef),
              snapshot_payload: jsonValue(snapshot),
              applicability_values: jsonValue(applicability),
              actor_ref: verified.actorId,
              authorization_context_ref: jsonValue(decision.context.authorizationContextRef),
              audit_entry_id: auditEntryId,
              occurred_at: command.issuedAt,
              recorded_at: recordedAt,
            } as never)
            .onConflict((conflict) => conflict.columns(["snapshot_id", "version_id"]).doNothing())
            .execute();
          return {
            resultRef: snapshotRef,
            audit: auditAppend(
              verified,
              "engineering-data.assessment-preparation",
              snapshotRef,
              snapshotRef.reference,
              recordedAt,
              auditEntryId,
            ),
            events: [
              DomainEventV1Schema.parse({
                schemaVersion: "1",
                eventId: `inputs-ready-${digest.slice(0, 40)}`,
                eventVersion: 1,
                eventType: "engineering.inputs-ready.v1",
                projectId: command.projectId,
                aggregateRef: snapshotRef,
                occurredAt: command.issuedAt,
                recordedAt,
                causationId: command.commandId,
                correlationId: `assessment-preparation-${digest.slice(0, 40)}`,
                producerCommandId: command.commandId,
                idempotencyKey: command.idempotencyKey,
                authorizationContextRef: decision.context.authorizationContextRef,
                auditTrailRef: snapshot.auditTrailRef,
                payload: {
                  preparation: {
                    kind: "assessment",
                    assessmentPreparationSnapshotRef: snapshotRef,
                  },
                },
              }),
            ],
          } satisfies AtomicCommitV1;
        },
        { isolationLevel: "repeatable read" },
      );

      return EngineeringFreezeResultV1Schema.parse({
        kind: "succeeded",
        result: {
          kind: "assessment-preparation",
          assessmentPreparationSnapshotRef: snapshotRef,
        },
      });
    } catch (error) {
      return {
        kind: "failed",
        error: this.#mapError(error, command.commandId, "engineering-data.assessment-preparation"),
      };
    }
  }

  /** C25 有界读取：公共准备快照 + 当时冻结的完整适用性元数据快照值。 */
  async readAssessmentPreparationContext(input: {
    readonly requestId: string;
    readonly idempotencyKey: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly preparationSnapshotRef: Extract<
      ContractReferenceV1,
      { kind: "assessment-preparation-snapshot" }
    >;
  }): Promise<
    | {
        readonly kind: "succeeded";
        readonly preparation: AssessmentPreparationSnapshotV1;
        readonly applicability: ApplicabilityMetadataSnapshotV1;
      }
    | { readonly kind: "waiting"; readonly waiting: WaitingRefV1 }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  > {
    try {
      await this.#verifyRead(
        {
          queryId: input.requestId,
          projectId: input.authorization.projectId,
          actorId: input.authorization.actorId,
          authorization: input.authorization,
        },
        "engineering-data.evidence-access",
        [],
        [],
      );
      const row = await this.#db
        .selectFrom("business.assessment_preparation_snapshots")
        .selectAll()
        .where("project_id", "=", input.authorization.projectId)
        .where("snapshot_id", "=", input.preparationSnapshotRef.reference.entityId)
        .where("version_id", "=", input.preparationSnapshotRef.reference.versionId)
        .executeTakeFirst();
      if (row === undefined) {
        return {
          kind: "failed",
          error: moduleError("AUTHORIZATION_DENIED", input.requestId, {
            requiredCapability: "engineering-data.read",
          }),
        };
      }
      const preparation = AssessmentPreparationSnapshotV1Schema.parse(row.snapshot_payload);
      const applicability = ApplicabilityMetadataSnapshotV1Schema.parse(row.applicability_values);
      // 取得准备快照后按它的空间与来源引用再次复验当前授权，只用验证后的上下文继续。
      const accessScopes = input.authorization.spatialScopeRefs.filter(
        (scope) => scope.reference.entityId === preparation.spatialScopeRef.reference.entityId,
      );
      if (accessScopes.length === 0) {
        return {
          kind: "failed",
          error: moduleError("AUTHORIZATION_DENIED", input.requestId, {
            requiredCapability: "engineering-data.read",
          }),
        };
      }
      // 空间与来源都必须落到已验证上下文内：来源取准备快照自身的证据资料版本。
      const sourceVersionRefs = [
        ...new Map(
          preparation.sourceEvidenceReferences.map((evidence) => [
            `${evidence.sourceVersion.entityId}@${evidence.sourceVersion.versionId}`,
            { kind: "source-version" as const, reference: evidence.sourceVersion },
          ]),
        ).values(),
      ].sort((left, right) =>
        `${left.reference.entityId}@${left.reference.versionId}` <
        `${right.reference.entityId}@${right.reference.versionId}`
          ? -1
          : 1,
      );
      // C06 verify 把上下文与签发时的 invocationId 绑定：复验必须沿用同一调用身份。
      await this.#verifyRead(
        {
          queryId: input.requestId,
          projectId: input.authorization.projectId,
          actorId: input.authorization.actorId,
          authorization: input.authorization,
        },
        "engineering-data.evidence-access",
        accessScopes,
        sourceVersionRefs,
      );
      return { kind: "succeeded", preparation, applicability };
    } catch (error) {
      return {
        kind: "failed",
        error: this.#mapError(
          error,
          input.requestId,
          "engineering-data.assessment-preparation-read",
          "engineering-data.read",
          true,
        ),
      };
    }
  }

  async #downstreamAuthorization(input: {
    readonly branch: ModuleBranchV1;
    readonly invocationId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly requestedSpatialScopeRefs?: readonly SpatialScopeRefV1[];
    readonly requestedSourceVersionRefs?: readonly SourceVersionRefV1[];
  }): Promise<AuthorizationContextV1> {
    const authorize = this.#authorizeDownstream;
    if (authorize === undefined) {
      throw preserveDomainError(
        moduleError("UNSUPPORTED_CONTRACT", input.invocationId, { schemaVersion: "1" }),
      );
    }
    const context = AuthorizationContextV1Schema.parse(
      await authorize({
        branch: input.branch,
        invocationId: input.invocationId,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        ...(input.requestedSpatialScopeRefs === undefined
          ? {}
          : { requestedSpatialScopeRefs: input.requestedSpatialScopeRefs }),
        ...(input.requestedSourceVersionRefs === undefined
          ? {}
          : { requestedSourceVersionRefs: input.requestedSourceVersionRefs }),
      }),
    );
    const capability = MODULE_BRANCH_CAPABILITY_V1[input.branch];
    if (
      context.projectId !== input.projectId ||
      context.actorId !== input.actorId ||
      context.grantedCapabilities.length !== 1 ||
      !context.grantedCapabilities.includes(capability)
    ) {
      throw preserveDomainError(moduleError("AUTHORIZATION_DENIED", input.invocationId));
    }
    return context;
  }

  /** 通过 C14 公共快照查询与正式序列 reader 复验每个冻结监测引用的工程、空间与序列身份。 */
  async #verifyMonitoringRef(
    command: Extract<EngineeringFreezeCommandV1, { kind: "assessment-preparation" }>,
    actorId: string,
    monitoringRef: Extract<ContractReferenceV1, { kind: "monitoring-snapshot" }>,
    sourceVersionRefs: readonly SourceVersionRefV1[],
  ): Promise<void> {
    const monitoringStore = this.#monitoringStore;
    if (monitoringStore === undefined) {
      throw preserveDomainError(
        moduleError("UNSUPPORTED_CONTRACT", command.commandId, { schemaVersion: "1" }),
      );
    }
    // C06 只认授权上下文自己的访问空间修订；按 scope 身份把业务空间投影到访问空间。
    const accessScopes = command.authorization.spatialScopeRefs.filter(
      (scope) => scope.reference.entityId === command.payload.spatialScopeRef.reference.entityId,
    );
    if (accessScopes.length === 0) {
      throw preserveDomainError(moduleError("AUTHORIZATION_DENIED", command.commandId));
    }
    // C06 每次 verify 都要求上下文与本次调用的 invocationId 绑定，因此两次读取各签发一次。
    const snapshotInvocationId = `${command.commandId}:monitoring-snapshot:${monitoringRef.reference.entityId}@${monitoringRef.reference.versionId}`;
    const authorization = await this.#downstreamAuthorization({
      branch: RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.monitoringReads,
      invocationId: snapshotInvocationId,
      projectId: command.projectId,
      actorId,
      requestedAt: command.issuedAt,
      requestedSpatialScopeRefs: accessScopes,
      requestedSourceVersionRefs: sourceVersionRefs,
    });
    const read = await monitoringStore.readSnapshot({
      kind: "monitoring-snapshot",
      queryId: snapshotInvocationId,
      projectId: command.projectId,
      actorId,
      requestedAt: command.issuedAt,
      authorization,
      payload: { monitoringSnapshotRef: monitoringRef },
    });
    if (read.kind === "waiting") {
      throw preserveDomainError(
        moduleError("BUSINESS_BLOCKED", command.commandId, {
          blockerKind: "monitoring-snapshot-unavailable",
          blockerRef: monitoringRef,
        }),
      );
    }
    if (read.kind !== "succeeded") {
      throw preserveDomainError(read.error as ContextSourceError);
    }
    const resolved = await monitoringStore.resolveSnapshotQuery({
      queryResultRef: read.result.queryResultRef,
      invocationId: snapshotInvocationId,
      projectId: command.projectId,
      actorId,
      requestedAt: command.issuedAt,
      authorization,
    });
    if (resolved.kind !== "succeeded" || resolved.result.kind !== "snapshot-query") {
      throw preserveDomainError(
        moduleError("AUTHORIZATION_DENIED", command.commandId, {
          requiredCapability: "engineering-data.read",
        }),
      );
    }
    const snapshot: MonitoringSnapshotV1 = MonitoringSnapshotV1Schema.parse(
      resolved.result.query.snapshot,
    );
    if (
      snapshot.projectId !== command.projectId ||
      !snapshot.authorizationSnapshot.spatialScopeRefs.some((scope) =>
        sameEntity(scope, command.payload.spatialScopeRef),
      )
    ) {
      throw preserveDomainError(moduleError("AUTHORIZATION_DENIED", command.commandId));
    }
    const seriesQueryId = `${command.commandId}:monitoring-series:${snapshot.monitoringSeriesRef.reference.entityId}@${snapshot.monitoringSeriesRef.reference.versionId}`;
    const seriesAuthorization = await this.#downstreamAuthorization({
      branch: RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.monitoringReads,
      invocationId: seriesQueryId,
      projectId: command.projectId,
      actorId,
      requestedAt: command.issuedAt,
      requestedSpatialScopeRefs: accessScopes,
      requestedSourceVersionRefs: sourceVersionRefs,
    });
    const seriesRead: MonitoringSeriesReadResultV1 = await monitoringStore.readSeriesRevision({
      queryId: seriesQueryId,
      projectId: command.projectId,
      actorId,
      requestedAt: command.issuedAt,
      authorization: seriesAuthorization,
      monitoringSeriesRef: snapshot.monitoringSeriesRef,
    });
    if (seriesRead.kind !== "succeeded") {
      throw preserveDomainError(seriesRead.error as ContextSourceError);
    }
    const revision = MonitoringSeriesRevisionReadV1Schema.parse(seriesRead.result);
    if (
      revision.projectId !== command.projectId ||
      !sameEntity(revision.spatialScopeRef, command.payload.spatialScopeRef) ||
      !sameVersion(revision.monitoringSeriesRef.reference, snapshot.monitoringSeriesRef.reference)
    ) {
      throw preserveDomainError(moduleError("AUTHORIZATION_DENIED", command.commandId));
    }
  }

  #mapError(
    error: unknown,
    causalRunId: string,
    stage: string,
    requiredCapability:
      "engineering-data.read" | "engineering-data.write" = "engineering-data.write",
    concealAuthorizationTarget = false,
  ): ModuleErrorV1 {
    const contextError =
      error instanceof Error
        ? (error as Error & { contextSourceError?: unknown }).contextSourceError
        : undefined;
    if (contextError !== undefined) return contextError as ModuleErrorV1;
    const accessError =
      error instanceof Error ? (error as Error & { accessError?: unknown }).accessError : undefined;
    if (accessError instanceof AccessServiceError) {
      if (
        accessError.details.code === "AUTHORIZATION_DENIED" ||
        (concealAuthorizationTarget &&
          ["SESSION_EXPIRED", "SESSION_REVOKED", "STALE_ACCESS_VERSION"].includes(
            accessError.details.code,
          ))
      )
        return moduleError("AUTHORIZATION_DENIED", causalRunId, { requiredCapability });
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
      return error.details.code === "AUTHORIZATION_DENIED" ||
        (concealAuthorizationTarget &&
          ["SESSION_EXPIRED", "SESSION_REVOKED", "STALE_ACCESS_VERSION"].includes(
            error.details.code,
          ))
        ? moduleError("AUTHORIZATION_DENIED", causalRunId, { requiredCapability })
        : moduleError("TERMINAL_FAILURE", causalRunId);
    if (error instanceof ArtifactStoreError)
      return mapArtifactErrorToModuleError(error, {
        causalRunId,
        requiredCapability,
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
