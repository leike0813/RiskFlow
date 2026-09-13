import { TextDecoder } from "node:util";

import { sql, type InsertObject, type Kysely, type Transaction } from "kysely";

import {
  ACCESS_POLICY_REF_V1,
  AccessServiceError,
  type AuthorizationDecisionV1,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  ArtifactReadRequestV1Schema,
  ArtifactReferenceCheckRequestV1Schema,
  artifactDiagnosticRef,
  ArtifactStoreError,
  mapArtifactErrorToModuleError,
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
  computeMonitoringFeatures,
  convertMonitoringValue,
  type MonitoringFeatureSampleV1,
} from "@riskflow/core/engineering-data/monitoring";
import {
  MonitoringAvailabilityPolicyV1Schema,
  MonitoringBatchV1Schema,
  MonitoringSampleArtifactEnvelopeV1Schema,
  MonitoringSampleInputV1Schema,
  MonitoringSampleVersionV1Schema,
  MonitoringSnapshotQueryV1Schema,
  MonitoringSnapshotV1Schema,
  MonitoringSeriesRevisionReadV1Schema,
  MonitoringSeriesRevisionV1Schema,
  ReadMonitoringSeriesRevisionQueryV1Schema,
  RegisterMonitoringAvailabilityPolicyCommandV1Schema,
  ResolveMonitoringSnapshotQueryV1Schema,
  ReviseMonitoringSeriesCommandV1Schema,
  type MonitoringAvailabilityPolicyV1,
  type MonitoringBatchV1,
  type MonitoringSampleArtifactEnvelopeV1,
  type MonitoringSampleInputV1,
  type MonitoringSampleVersionV1,
  type MonitoringSnapshotV1,
  type MonitoringSeriesReaderV1,
  type MonitoringSeriesReadResultV1,
  type MonitoringSeriesRevisionStatusV1,
  type MonitoringSeriesRevisionV1,
  type MonitoringResultV1,
  type ReadMonitoringSeriesRevisionQueryV1,
  type RegisterMonitoringAvailabilityPolicyCommandV1,
  type ResolveMonitoringSnapshotQueryV1,
  type ReviseMonitoringSeriesCommandV1,
} from "@riskflow/core/engineering-data/monitoring";
import {
  EngineeringDataCommandV1Schema,
  EngineeringDataQueryV1Schema,
  EngineeringFreezeCommandV1Schema,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type EngineeringDataApplyResultV1,
  type EngineeringDataCommandV1,
  type EngineeringDataReadResultV1,
  type EngineeringDataQueryV1,
  type EngineeringFreezeCommandV1,
  type EngineeringFreezeResultV1,
  type ModuleErrorV1,
  type MonitoringBatchRefV1,
  type MonitoringSeriesRefV1,
  type MonitoringSnapshotRefV1,
  type QueryResultRefV1,
  type SourceVersionRefV1,
  SourceVersionRefV1Schema,
  type SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import type { EvidenceReference, VersionReference } from "@riskflow/contracts/common";

import { getPostgresTransaction } from "../../postgres/transaction-unit.js";
import { makePersistenceError, mapPostgresError } from "../../postgres/pool.js";
import type { PostgresDatabase } from "../../postgres/types.js";

type JsonColumn = JsonValue;
type TimestampColumn = Date | string;

interface MonitoringSeriesRow {
  series_id: string;
  project_id: string;
  current_revision_id: string | null;
  created_at: TimestampColumn;
}

interface MonitoringSeriesRevisionRow {
  revision_id: string;
  series_id: string;
  project_id: string;
  revision_no: number;
  version_id: string;
  monitoring_series_ref: JsonColumn;
  project_revision_ref: JsonColumn;
  spatial_scope_ref: JsonColumn;
  monitoring_object: string;
  monitoring_indicator: string;
  parameter_code: string;
  canonical_unit: string;
  unit_conversions: JsonColumn;
  effective_period: JsonColumn;
  recorded_at: TimestampColumn;
  actor_id: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  persisted_at: TimestampColumn;
  previous_revision_id: string | null;
}

interface MonitoringBatchRow {
  batch_id: string;
  version_id: string;
  project_id: string;
  series_id: string;
  series_revision_id: string;
  monitoring_batch_ref: JsonColumn;
  delivery_key: string;
  delivery_fingerprint: string;
  sample_artifact_ref: JsonColumn;
  source_version_ref: JsonColumn;
  source_segment_set_ref: JsonColumn;
  project_revision_ref: JsonColumn;
  spatial_scope_ref: JsonColumn;
  window_from: TimestampColumn;
  window_to: TimestampColumn;
  relation_kind: MonitoringBatchV1["relation"]["kind"];
  prior_batch_id: string | null;
  sample_count: number;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
  actor_id: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
}

interface MonitoringSampleVersionRow {
  sample_version_id: string;
  version_id: string;
  project_id: string;
  series_id: string;
  series_revision_id: string;
  batch_id: string;
  sample_version_ref: JsonColumn;
  monitoring_batch_ref: JsonColumn;
  monitoring_series_ref: JsonColumn;
  source_sample_key: string;
  sampled_at: TimestampColumn;
  value: number;
  unit: string;
  canonical_value: number;
  canonical_unit: string;
  previous_sample_version_id: string | null;
  relation_kind: MonitoringSampleVersionV1["relationKind"];
  evidence_references: JsonColumn;
  source_version_ref: JsonColumn;
  source_segment_set_ref: JsonColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface MonitoringPolicyRow {
  policy_id: string;
  version_id: string;
  project_id: string;
  monitoring_series_ref: JsonColumn;
  availability_policy_ref: JsonColumn;
  policy: JsonColumn;
  policy_sha256: string;
  actor_id: string;
  authorization_context_ref: JsonColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
  audit_entry_id: string;
}

interface MonitoringSnapshotRow {
  snapshot_id: string;
  version_id: string;
  project_id: string;
  series_id: string;
  series_revision_id: string;
  monitoring_snapshot_ref: JsonColumn;
  monitoring_series_ref: JsonColumn;
  cutoff: TimestampColumn;
  recorded_at: TimestampColumn;
  window: JsonColumn;
  availability_policy_ref: JsonColumn;
  algorithm_versions: JsonColumn;
  monitoring_batch_refs: JsonColumn;
  sample_version_refs: JsonColumn;
  availability: MonitoringSnapshotV1["availability"];
  coverage_ratio: number;
  availability_reasons: JsonColumn;
  evidence_references: JsonColumn;
  authorization_snapshot: JsonColumn;
  actor_id: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  persisted_at: TimestampColumn;
}

interface MonitoringSnapshotMemberRow {
  project_id: string;
  snapshot_id: string;
  member_index: number;
  batch_id: string;
  sample_version_id: string;
  selection_reason: MonitoringSnapshotV1["members"][number]["selectionReason"];
}

interface MonitoringSnapshotPointRow {
  project_id: string;
  snapshot_id: string;
  point_index: number;
  sampled_at: TimestampColumn;
  value: number | null;
  unit: string;
  status: MonitoringSnapshotV1["alignedPoints"][number]["status"];
  source_sample_refs: JsonColumn;
  reason_code: string | null;
}

interface MonitoringSnapshotFeatureRow {
  project_id: string;
  snapshot_id: string;
  feature_type: MonitoringSnapshotV1["features"][keyof MonitoringSnapshotV1["features"]]["featureType"];
  value: number | null;
  unit: string | null;
  window_size: number;
  input_count: number;
  algorithm_version: string;
  status: "available" | "unavailable";
  reason_code: string | null;
}

interface MonitoringSnapshotQueryRow {
  query_result_id: string;
  version_id: string;
  project_id: string;
  query_result_ref: JsonColumn;
  snapshot_id: string;
  monitoring_snapshot_ref: JsonColumn;
  authorization_context_ref: JsonColumn;
  requested_by: string;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
  audit_entry_id: string;
}

interface EngineeringProjectRow {
  project_id: string;
  current_revision_id: string;
}

interface EngineeringSpatialRow {
  scope_id: string;
  project_id: string;
  current_revision_id: string;
}

interface SourceVersionAccessRow {
  source_version_id: string;
  version_id: string;
  project_id: string;
  project_revision_ref: JsonColumn;
  spatial_scope_refs: JsonColumn;
  access_status: string;
  source_access_grant_ref: JsonColumn | null;
}

interface SourceSegmentSetRow {
  source_segment_set_id: string;
  version_id: string;
  project_id: string;
  source_version_id: string;
  source_segment_set_ref: JsonColumn;
}

interface SourceSegmentRow {
  source_segment_id: string;
  project_id: string;
  source_segment_set_id: string;
}

type MonitoringDatabase = PostgresDatabase & {
  "business.monitoring_series": MonitoringSeriesRow;
  "business.monitoring_series_revisions": MonitoringSeriesRevisionRow;
  "business.monitoring_batches": MonitoringBatchRow;
  "business.monitoring_sample_versions": MonitoringSampleVersionRow;
  "business.monitoring_availability_policies": MonitoringPolicyRow;
  "business.monitoring_snapshots": MonitoringSnapshotRow;
  "business.monitoring_snapshot_members": MonitoringSnapshotMemberRow;
  "business.monitoring_snapshot_points": MonitoringSnapshotPointRow;
  "business.monitoring_snapshot_features": MonitoringSnapshotFeatureRow;
  "business.monitoring_snapshot_query_results": MonitoringSnapshotQueryRow;
  "business.engineering_projects": EngineeringProjectRow;
  "business.engineering_spatial_segments": EngineeringSpatialRow;
  "business.source_versions": SourceVersionAccessRow;
  "business.source_segment_sets": SourceSegmentSetRow;
  "business.source_segments": SourceSegmentRow;
};

type MonitoringTransaction = Transaction<MonitoringDatabase>;

const transaction = (context: TransactionContextV1): MonitoringTransaction =>
  getPostgresTransaction(context) as unknown as MonitoringTransaction;

const jsonValue = (value: unknown): JsonValue => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw makePersistenceError("TRANSACTION_FAILED", "monitoring.json");
  return serialized as JsonValue;
};

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const nowIso = (clock: () => Date): string => {
  const value = clock();
  if (!Number.isFinite(value.getTime())) throw new RangeError("clock returned invalid date");
  return value.toISOString();
};

const databaseClock = async (db: MonitoringTransaction): Promise<string> => {
  const result = await sql<{
    recorded_at: TimestampColumn;
  }>`SELECT clock_timestamp() AS recorded_at`.execute(db);
  const recordedAt = result.rows[0]?.recorded_at;
  if (recordedAt === undefined)
    throw makePersistenceError("TRANSACTION_FAILED", "monitoring.clock");
  return asIso(recordedAt);
};

const sameVersion = (
  left: { entityId: string; versionId: string },
  right: { entityId: string; versionId: string },
): boolean => left.entityId === right.entityId && left.versionId === right.versionId;

const jsonData = (value: JsonValue): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const hasVersionRef = (
  value: JsonValue,
  expected: { reference: { entityId: string; versionId: string } },
): boolean => {
  const data = jsonData(value);
  return (
    typeof data === "object" &&
    data !== null &&
    !Array.isArray(data) &&
    "reference" in data &&
    typeof data.reference === "object" &&
    data.reference !== null &&
    "entityId" in data.reference &&
    "versionId" in data.reference &&
    typeof data.reference.entityId === "string" &&
    typeof data.reference.versionId === "string" &&
    sameVersion(data.reference as { entityId: string; versionId: string }, expected.reference)
  );
};

const hasVersionRefInArray = (
  value: JsonValue,
  expected: { reference: { entityId: string; versionId: string } },
): boolean => {
  const data = jsonData(value);
  return (
    Array.isArray(data) &&
    data.some((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
      return hasVersionRef(item as JsonValue, expected);
    })
  );
};

const sourceVersionRefsFromJson = (values: readonly unknown[]): SourceVersionRefV1[] => {
  const refs = new Map<string, SourceVersionRefV1>();
  for (const value of values) {
    const parsed = SourceVersionRefV1Schema.safeParse(
      typeof value === "string" ? jsonData(value as JsonValue) : value,
    );
    if (parsed.success) refs.set(refKey(parsed.data), parsed.data);
  }
  return [...refs.values()];
};

const ref = <T extends ContractReferenceV1["kind"]>(kind: T, entityId: string, versionId: string) =>
  ({ kind, reference: { entityId, versionId } }) as Extract<ContractReferenceV1, { kind: T }>;

const refKey = (value: { reference: { entityId: string; versionId: string } }): string =>
  `${value.reference.entityId}/${value.reference.versionId}`;

const evidenceKey = (value: EvidenceReference): string =>
  `${value.sourceVersion.entityId}/${value.sourceVersion.versionId}/${value.locator.sourceSegmentId}`;

const auditEntryIdFor = (commandId: string): string => `audit:${commandId}`;

const moduleError = (
  code: ModuleErrorV1["code"],
  causalRunId: string,
  targetRef?: ContractReferenceV1,
  requiredCapability:
    | "engineering-data.write"
    | "engineering-data.freeze"
    | "engineering-data.read" = "engineering-data.read",
): ModuleErrorV1 => {
  const common = {
    stageCode: `engineering-data.monitoring.${code.toLowerCase()}`,
    occurredAt: new Date().toISOString(),
    causalRunId,
  };
  if (code === "AUTHORIZATION_DENIED") {
    return {
      ...common,
      code,
      category: "authorization",
      retryable: false,
      requiredCapability,
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
    };
  }
  if (code === "ENTITY_NOT_FOUND") {
    return {
      ...common,
      code,
      category: "not-found",
      retryable: false,
      targetRef: targetRef ?? ref("project-revision", "monitoring", "1"),
    };
  }
  if (code === "STALE_VERSION") {
    return {
      ...common,
      code,
      category: "concurrency",
      retryable: false,
      targetRef: targetRef ?? ref("project-revision", "monitoring", "1"),
    };
  }
  if (code === "BUSINESS_BLOCKED") {
    return {
      ...common,
      code,
      category: "business-blocked",
      retryable: false,
      blockerKind: targetRef?.kind ?? "monitoring-series",
      blockerRef: targetRef ?? ref("monitoring-series", "monitoring", "1"),
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
    };
  }
  if (code === "UNSUPPORTED_CONTRACT") {
    return { ...common, code, category: "technical", retryable: false, schemaVersion: "1" };
  }
  if (code === "TRANSIENT_FAILURE") {
    return {
      ...common,
      code,
      category: "technical",
      retryable: true,
      attempt: 1,
      retryPolicyRef: ACCESS_POLICY_REF_V1,
      diagnosticRef: ref("diagnostic-artifact", "engineering-data-monitoring-failure", "1"),
    };
  }
  return {
    ...common,
    code: "TERMINAL_FAILURE",
    category: "technical",
    retryable: false,
    diagnosticRef: ref("diagnostic-artifact", "engineering-data-monitoring-failure", "1"),
  };
};

const domainFailure = (error: ModuleErrorV1): Error => {
  const wrapped = makePersistenceError("TRANSACTION_FAILED", "monitoring.domain");
  Object.defineProperty(wrapped, "monitoringError", { value: error });
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
): AtomicCommitV1 => ({
  resultRef: targetRef,
  audit: {
    auditEntryId: auditEntryIdFor(command.commandId),
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
  },
  events: [],
});

const sampleRefFor = (entityId: string, versionId: string) => ({
  kind: "monitoring-sample-version" as const,
  reference: { entityId, versionId },
});

const latestSample = (
  rows: readonly MonitoringSampleVersionRow[],
): MonitoringSampleVersionRow | undefined =>
  rows.reduce<MonitoringSampleVersionRow | undefined>((latest, row) => {
    if (latest === undefined) return row;
    const recordedAt = new Date(row.recorded_at as Date | string).getTime();
    const latestRecordedAt = new Date(latest.recorded_at as Date | string).getTime();
    if (recordedAt !== latestRecordedAt) return recordedAt > latestRecordedAt ? row : latest;
    const persistedAt = new Date(row.persisted_at as Date | string).getTime();
    const latestPersistedAt = new Date(latest.persisted_at as Date | string).getTime();
    if (persistedAt !== latestPersistedAt) return persistedAt > latestPersistedAt ? row : latest;
    return row.sample_version_id > latest.sample_version_id ? row : latest;
  }, undefined);

type NormalizedMonitoringSampleV1 = MonitoringSampleInputV1 & { readonly canonicalValue: number };

interface SampleArtifactReadV1 {
  readonly envelope: MonitoringSampleArtifactEnvelopeV1;
  readonly samples: readonly NormalizedMonitoringSampleV1[];
  readonly fingerprint: string;
}

interface MonitoringSnapshotSourceRowsV1 {
  readonly batches: readonly MonitoringBatchRow[];
  readonly samples: readonly MonitoringSampleVersionRow[];
}

const success = (
  result: import("@riskflow/core/engineering-data/monitoring").MonitoringSuccessV1,
): MonitoringResultV1 => ({
  kind: "succeeded",
  result,
});

export interface PostgresMonitoringStoreOptions {
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: TransactionUnitV1;
  readonly access: LocalIdentityAccessV1;
  readonly artifactStore: ArtifactStoreV1;
  readonly artifactReferenceGuard: ArtifactReferenceGuardV1;
  readonly now?: () => Date;
}

export class PostgresMonitoringStoreV1 implements MonitoringSeriesReaderV1 {
  readonly #db: Kysely<MonitoringDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #access: LocalIdentityAccessV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #artifactGuard: ArtifactReferenceGuardV1;
  readonly #now: () => Date;

  constructor(options: PostgresMonitoringStoreOptions) {
    this.#db = options.db as unknown as Kysely<MonitoringDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#access = options.access;
    this.#artifactStore = options.artifactStore;
    this.#artifactGuard = options.artifactReferenceGuard;
    this.#now = options.now ?? (() => new Date());
  }

  async reviseSeries(command: ReviseMonitoringSeriesCommandV1): Promise<MonitoringResultV1> {
    const parsed = ReviseMonitoringSeriesCommandV1Schema.safeParse(command);
    if (!parsed.success)
      return { kind: "failed", error: moduleError("UNSUPPORTED_CONTRACT", "monitoring.series") };
    const valid = parsed.data;
    try {
      const decision = await this.#verify(
        valid,
        "engineering-data.write",
        [valid.spatialScopeRef],
        [],
      );
      const verified = { ...valid, actorId: decision.context.actorId };
      const atomic = atomicCommand(verified, "engineering-data.monitoring-series.v1", verified);
      const receipt = await this.#transactionUnit.execute(atomic, async (context) =>
        this.#reviseSeriesInTransaction(context, verified),
      );
      const revision = await this.#readSeriesRevision(valid.projectId, receipt.resultRef);
      return revision === undefined
        ? { kind: "failed", error: moduleError("TERMINAL_FAILURE", valid.commandId) }
        : success({ kind: "series-revision", revision });
    } catch (error) {
      return {
        kind: "failed",
        error: this.#mapError(
          error,
          valid.commandId,
          "monitoring.series",
          "engineering-data.write",
        ),
      };
    }
  }

  async registerAvailabilityPolicy(
    command: RegisterMonitoringAvailabilityPolicyCommandV1,
  ): Promise<MonitoringResultV1> {
    const parsed = RegisterMonitoringAvailabilityPolicyCommandV1Schema.safeParse(command);
    if (!parsed.success)
      return { kind: "failed", error: moduleError("UNSUPPORTED_CONTRACT", "monitoring.policy") };
    const valid = parsed.data;
    try {
      const series = await this.#readSeriesRevision(
        valid.projectId,
        valid.policy.monitoringSeriesRef,
      );
      if (series === undefined) {
        return { kind: "failed", error: moduleError("AUTHORIZATION_DENIED", valid.commandId) };
      }
      const decision = await this.#verify(
        valid,
        "engineering-data.write",
        [series.spatialScopeRef],
        [],
      );
      const verified = { ...valid, actorId: decision.context.actorId };
      const atomic = atomicCommand(verified, "engineering-data.monitoring-policy.v1", verified);
      await this.#transactionUnit.execute(atomic, async (context) =>
        this.#registerPolicyInTransaction(context, verified),
      );
      const policy = await this.#readPolicy(valid.projectId, valid.policy.availabilityPolicyRef);
      return policy === undefined
        ? { kind: "failed", error: moduleError("TERMINAL_FAILURE", valid.commandId) }
        : success({ kind: "availability-policy", policy });
    } catch (error) {
      return {
        kind: "failed",
        error: this.#mapError(
          error,
          valid.commandId,
          "monitoring.policy",
          "engineering-data.write",
        ),
      };
    }
  }

  async registerBatch(
    command: Extract<EngineeringDataCommandV1, { kind: "register-monitoring-batch" }>,
  ): Promise<EngineeringDataApplyResultV1> {
    const parsed = EngineeringDataCommandV1Schema.safeParse(command);
    if (!parsed.success || parsed.data.kind !== "register-monitoring-batch") {
      return { kind: "failed", error: moduleError("UNSUPPORTED_CONTRACT", "monitoring.batch") };
    }
    const valid = parsed.data;
    try {
      const revision = await this.#readSeriesRevision(
        valid.projectId,
        valid.payload.monitoringSeriesRef,
      );
      if (
        revision === undefined ||
        !sameVersion(
          revision.monitoringSeriesRef.reference,
          valid.payload.monitoringSeriesRef.reference,
        )
      ) {
        return { kind: "failed", error: moduleError("AUTHORIZATION_DENIED", valid.commandId) };
      }
      const decision = await this.#verify(
        valid,
        "engineering-data.write",
        [revision.spatialScopeRef],
        [],
      );
      const verified = { ...valid, actorId: decision.context.actorId };
      const artifact = await this.#readSampleArtifact(verified, revision);
      await this.#verify(
        verified,
        "engineering-data.write",
        [revision.spatialScopeRef],
        [artifact.envelope.sourceVersionRef],
      );
      const atomic = atomicCommand(verified, "engineering-data.register-monitoring-batch.v1", {
        command: verified,
        envelope: artifact.envelope,
        fingerprint: artifact.fingerprint,
      });
      const receipt = await this.#transactionUnit.execute(atomic, async (context) =>
        this.#registerBatchInTransaction(context, verified, revision, artifact),
      );
      const batch = await this.#readBatch(valid.projectId, receipt.resultRef);
      return batch === undefined
        ? { kind: "failed", error: moduleError("TERMINAL_FAILURE", valid.commandId) }
        : {
            kind: "succeeded",
            result: {
              kind: "register-monitoring-batch",
              monitoringBatchRef: batch.monitoringBatchRef,
            },
          };
    } catch (error) {
      return {
        kind: "failed",
        error: this.#mapError(error, valid.commandId, "monitoring.batch", "engineering-data.write"),
      };
    }
  }

  async freezeSnapshot(
    command: Extract<EngineeringFreezeCommandV1, { kind: "monitoring-snapshot" }>,
  ): Promise<EngineeringFreezeResultV1> {
    const parsed = EngineeringFreezeCommandV1Schema.safeParse(command);
    if (!parsed.success || parsed.data.kind !== "monitoring-snapshot") {
      return { kind: "failed", error: moduleError("UNSUPPORTED_CONTRACT", "monitoring.freeze") };
    }
    const valid = parsed.data;
    try {
      // 冻结的精确范围只能在事务内解析，先以同一分支完成主体绑定再进入 C03 幂等。
      const decision = await this.#verify(valid, "engineering-data.freeze", [], []);
      const verified = { ...valid, actorId: decision.context.actorId };
      const atomic = atomicCommand(verified, "engineering-data.monitoring-snapshot.v1", verified);
      const receipt = await this.#transactionUnit.execute(
        atomic,
        async (context) => {
          const db = transaction(context);
          const freezeRecordedAt = await databaseClock(db);
          const revision = await this.#readSeriesRevisionFromDb(
            db,
            verified.projectId,
            verified.payload.monitoringSeriesRef,
          );
          if (revision === undefined)
            throw domainFailure(moduleError("AUTHORIZATION_DENIED", verified.commandId));
          const policy = await this.#readPolicyFromDb(
            db,
            verified.projectId,
            verified.payload.availabilityPolicyRef,
          );
          if (
            policy === undefined ||
            !sameVersion(
              policy.monitoringSeriesRef.reference,
              revision.monitoringSeriesRef.reference,
            )
          ) {
            throw domainFailure(moduleError("AUTHORIZATION_DENIED", verified.commandId));
          }
          const sourceRows = await this.#selectSnapshotSourceRows(
            db,
            verified.projectId,
            revision,
            policy,
            verified.payload.cutoff,
            freezeRecordedAt,
          );
          const sourceRowsByTime = new Map<number, MonitoringSampleVersionRow[]>();
          for (const row of sourceRows.samples) {
            const time = new Date(row.sampled_at as Date | string).getTime();
            const rows = sourceRowsByTime.get(time) ?? [];
            rows.push(row);
            sourceRowsByTime.set(time, rows);
          }
          try {
            await this.#verify(
              verified,
              "engineering-data.freeze",
              [revision.spatialScopeRef],
              sourceVersionRefsFromJson(
                [...sourceRowsByTime.values()]
                  .map((rows) => latestSample(rows))
                  .filter((row): row is MonitoringSampleVersionRow => row !== undefined)
                  .map((row) => row.source_version_ref),
              ),
            );
          } catch (error) {
            if (error instanceof AccessServiceError) {
              throw domainFailure(
                this.#mapError(
                  error,
                  verified.commandId,
                  "monitoring.freeze",
                  "engineering-data.freeze",
                ),
              );
            }
            throw error;
          }
          return this.#freezeInTransaction(
            context,
            verified,
            revision,
            policy,
            freezeRecordedAt,
            sourceRows,
          );
        },
        { isolationLevel: "repeatable read" },
      );
      const snapshot = await this.#readSnapshot(valid.projectId, receipt.resultRef);
      return snapshot === undefined
        ? { kind: "failed", error: moduleError("TERMINAL_FAILURE", valid.commandId) }
        : {
            kind: "succeeded",
            result: {
              kind: "monitoring-snapshot",
              monitoringSnapshotRef: snapshot.monitoringSnapshotRef,
            },
          };
    } catch (error) {
      return {
        kind: "failed",
        error: this.#mapError(
          error,
          valid.commandId,
          "monitoring.freeze",
          "engineering-data.freeze",
        ),
      };
    }
  }

  async readSnapshot(
    query: Extract<EngineeringDataQueryV1, { kind: "monitoring-snapshot" }>,
  ): Promise<EngineeringDataReadResultV1> {
    const parsed = EngineeringDataQueryV1Schema.safeParse(query);
    if (!parsed.success || parsed.data.kind !== "monitoring-snapshot") {
      return { kind: "failed", error: moduleError("UNSUPPORTED_CONTRACT", "monitoring.read") };
    }
    const valid = parsed.data;
    try {
      const snapshot = await this.#readSnapshotByRef(
        valid.projectId,
        valid.payload.monitoringSnapshotRef,
      );
      if (snapshot === undefined)
        return { kind: "failed", error: moduleError("AUTHORIZATION_DENIED", valid.queryId) };
      const sourceVersionRefs = sourceVersionRefsFromJson(
        snapshot.evidenceReferences.map((evidence) => ({
          kind: "source-version",
          reference: evidence.sourceVersion,
        })),
      );
      const decision = await this.#verify(
        { ...valid, commandId: valid.queryId },
        "engineering-data.read",
        snapshot.authorizationSnapshot.spatialScopeRefs,
        sourceVersionRefs,
      );
      const verified = { ...valid, actorId: decision.context.actorId };
      const atomic = atomicCommand(
        {
          commandId: verified.queryId,
          idempotencyKey: verified.queryId,
          projectId: verified.projectId,
          actorId: verified.actorId,
          issuedAt: verified.requestedAt,
          authorization: verified.authorization,
        },
        "engineering-data.monitoring-snapshot-query.v1",
        verified,
      );
      await this.#transactionUnit.execute(atomic, async (context) =>
        this.#registerQueryInTransaction(context, verified, snapshot),
      );
      return {
        kind: "succeeded",
        result: {
          queryResultRef: ref(
            "query-result",
            `monitoring-${valid.queryId}`,
            "1",
          ) as QueryResultRefV1,
        },
      };
    } catch (error) {
      return {
        kind: "failed",
        error: this.#mapError(error, valid.queryId, "monitoring.read", "engineering-data.read"),
      };
    }
  }

  async resolveSnapshotQuery(query: ResolveMonitoringSnapshotQueryV1): Promise<MonitoringResultV1> {
    const parsed = ResolveMonitoringSnapshotQueryV1Schema.safeParse(query);
    if (!parsed.success)
      return { kind: "failed", error: moduleError("UNSUPPORTED_CONTRACT", "monitoring.query") };
    try {
      const row = await this.#db
        .selectFrom("business.monitoring_snapshot_query_results")
        .selectAll()
        .where("query_result_id", "=", parsed.data.queryResultRef.reference.entityId)
        .where("version_id", "=", parsed.data.queryResultRef.reference.versionId)
        .executeTakeFirst();
      if (row === undefined)
        return {
          kind: "failed",
          error: moduleError("AUTHORIZATION_DENIED", parsed.data.queryResultRef.reference.entityId),
        };
      if (row.project_id !== parsed.data.projectId)
        return {
          kind: "failed",
          error: moduleError("AUTHORIZATION_DENIED", parsed.data.queryResultRef.reference.entityId),
        };
      const snapshot = await this.#readSnapshot(
        row.project_id,
        row.monitoring_snapshot_ref as MonitoringSnapshotRefV1,
      );
      if (snapshot === undefined)
        return {
          kind: "failed",
          error: moduleError("AUTHORIZATION_DENIED", parsed.data.queryResultRef.reference.entityId),
        };
      await this.#verify(
        { ...parsed.data, commandId: parsed.data.invocationId },
        "engineering-data.read",
        snapshot.authorizationSnapshot.spatialScopeRefs,
        sourceVersionRefsFromJson(
          snapshot.evidenceReferences.map((evidence) => ({
            kind: "source-version",
            reference: evidence.sourceVersion,
          })),
        ),
      );
      const result = MonitoringSnapshotQueryV1Schema.parse({
        queryResultRef: parsed.data.queryResultRef,
        monitoringSnapshotRef: snapshot.monitoringSnapshotRef,
        projectId: row.project_id,
        snapshot,
        requestedBy: row.requested_by,
        authorizationContextRef: row.authorization_context_ref,
        recordedAt: asIso(row.recorded_at),
        audit: {
          actorId: row.requested_by,
          action: "engineering-data.monitoring-snapshot-query",
          recordedAt: asIso(row.recorded_at),
        },
      });
      return success({ kind: "snapshot-query", query: result });
    } catch (error) {
      return {
        kind: "failed",
        error: this.#mapError(
          error,
          query.queryResultRef.reference.entityId,
          "monitoring.query",
          "engineering-data.read",
        ),
      };
    }
  }

  async readSeriesRevision(
    query: ReadMonitoringSeriesRevisionQueryV1,
  ): Promise<MonitoringSeriesReadResultV1> {
    const parsed = ReadMonitoringSeriesRevisionQueryV1Schema.safeParse(query);
    if (!parsed.success)
      return {
        kind: "failed",
        error: moduleError("UNSUPPORTED_CONTRACT", "monitoring.series-read"),
      };
    const valid = parsed.data;
    try {
      const revision = await this.#readSeriesRevision(valid.projectId, valid.monitoringSeriesRef);
      if (
        revision === undefined ||
        !sameVersion(revision.monitoringSeriesRef.reference, valid.monitoringSeriesRef.reference)
      ) {
        return { kind: "failed", error: moduleError("AUTHORIZATION_DENIED", valid.queryId) };
      }
      // 固定顺序：先按本次调用方授权上下文完成 C06 verify（授权与不可枚举拒绝优先），
      // 通过后才进入 C03 幂等；同键异载荷在授权通过后返回既有 IDEMPOTENCY_CONFLICT。
      const decision = await this.#verify(
        { ...valid, commandId: valid.queryId },
        "engineering-data.read",
        [revision.spatialScopeRef],
        [],
      );
      // 操作者身份只能取自 C06 已验证的授权上下文，载荷 actor 仅是一致性声明。
      const verified = { ...valid, actorId: decision.context.actorId };
      const status = await this.#readSeriesRevisionStatus(
        verified.projectId,
        verified.monitoringSeriesRef,
      );
      if (status === undefined)
        return { kind: "failed", error: moduleError("AUTHORIZATION_DENIED", verified.queryId) };
      const atomic = atomicCommand(
        {
          commandId: verified.queryId,
          idempotencyKey: verified.queryId,
          projectId: verified.projectId,
          actorId: verified.actorId,
          issuedAt: verified.requestedAt,
          authorization: verified.authorization,
        },
        "engineering-data.monitoring-series-read.v1",
        verified,
      );
      await this.#transactionUnit.execute(atomic, async () =>
        this.#registerSeriesReadInTransaction(verified, verified.actorId),
      );
      return {
        kind: "succeeded",
        result: MonitoringSeriesRevisionReadV1Schema.parse({
          monitoringSeriesRef: revision.monitoringSeriesRef,
          seriesId: revision.seriesId,
          projectId: revision.projectId,
          projectRevisionRef: revision.projectRevisionRef,
          spatialScopeRef: revision.spatialScopeRef,
          monitoringObject: revision.monitoringObject,
          monitoringIndicator: revision.monitoringIndicator,
          parameterCode: revision.parameterCode,
          canonicalUnit: revision.canonicalUnit,
          unitConversions: revision.unitConversions,
          effectivePeriod: revision.effectivePeriod,
          recordedAt: revision.recordedAt,
          ...(revision.previousRevisionRef === undefined
            ? {}
            : { previousRevisionRef: revision.previousRevisionRef }),
          status,
        }),
      };
    } catch (error) {
      return {
        kind: "failed",
        error: this.#mapError(
          error,
          valid.queryId,
          "monitoring.series-read",
          "engineering-data.read",
        ),
      };
    }
  }

  async #verify(
    command: {
      commandId: string;
      projectId: string;
      actorId: string;
      authorization: AuthorizationContextV1;
    },
    branch: "engineering-data.write" | "engineering-data.freeze" | "engineering-data.read",
    requestedSpatialScopeRefs: readonly SpatialScopeRefV1[],
    requestedSourceVersionRefs: readonly SourceVersionRefV1[],
  ): Promise<AuthorizationDecisionV1> {
    if (
      command.projectId !== command.authorization.projectId ||
      command.actorId !== command.authorization.actorId ||
      !command.authorization.grantedCapabilities.includes(branch)
    ) {
      throw domainFailure(moduleError("AUTHORIZATION_DENIED", command.commandId));
    }
    const decision = await this.#access.verify({
      authorizationContextRef: command.authorization.authorizationContextRef,
      invocationId: command.commandId,
      projectId: command.projectId,
      branch:
        branch === "engineering-data.write"
          ? "engineering-data.register-monitoring-batch"
          : branch === "engineering-data.freeze"
            ? "engineering-data.monitoring-snapshot"
            : "engineering-data.monitoring-snapshot-query",
      requestedSpatialScopeRefs: [...requestedSpatialScopeRefs],
      requestedSourceVersionRefs: [...requestedSourceVersionRefs],
      requestedAt: command.authorization.decidedAt,
    });
    // 操作者身份只取自 C06 当前验证结果；命令声明主体必须与之一致。
    if (decision.context.actorId !== command.actorId) {
      throw domainFailure(moduleError("AUTHORIZATION_DENIED", command.commandId));
    }
    return decision;
  }

  async #reviseSeriesInTransaction(
    context: TransactionContextV1,
    command: ReviseMonitoringSeriesCommandV1,
  ): Promise<AtomicCommitV1> {
    const db = transaction(context);
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`riskflow.c14.series.${command.projectId}.${command.monitoringSeriesRef.reference.entityId}`}, 0))`.execute(
      db,
    );
    const identity = await db
      .selectFrom("business.monitoring_series")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("series_id", "=", command.monitoringSeriesRef.reference.entityId)
      .forUpdate()
      .executeTakeFirst();
    const previous =
      identity?.current_revision_id === null || identity === undefined
        ? undefined
        : await db
            .selectFrom("business.monitoring_series_revisions")
            .selectAll()
            .where("project_id", "=", command.projectId)
            .where("revision_id", "=", identity.current_revision_id)
            .executeTakeFirst();
    if (identity === undefined && command.expectedVersion !== "none") {
      throw domainFailure(
        moduleError("STALE_VERSION", command.commandId, command.monitoringSeriesRef),
      );
    }
    if (
      identity !== undefined &&
      (previous === undefined ||
        command.expectedVersion === "none" ||
        previous.version_id !== command.expectedVersion.versionId)
    ) {
      throw domainFailure(
        moduleError("STALE_VERSION", command.commandId, command.monitoringSeriesRef),
      );
    }
    await this.#assertContextCurrent(
      db,
      command.projectId,
      command.projectRevisionRef,
      command.spatialScopeRef,
      command.commandId,
    );
    const versionId = command.monitoringSeriesRef.reference.versionId;
    const revisionNo = previous === undefined ? 1 : previous.revision_no + 1;
    const revisionId = `${command.monitoringSeriesRef.reference.entityId}:${versionId}`;
    const auditId = auditEntryIdFor(command.commandId);
    if (identity === undefined) {
      await db
        .insertInto("business.monitoring_series")
        .values({
          series_id: command.monitoringSeriesRef.reference.entityId,
          project_id: command.projectId,
          current_revision_id: null,
          created_at: sql`clock_timestamp()`,
        })
        .execute();
    }
    await db
      .insertInto("business.monitoring_series_revisions")
      .values({
        revision_id: revisionId,
        series_id: command.monitoringSeriesRef.reference.entityId,
        project_id: command.projectId,
        revision_no: revisionNo,
        version_id: versionId,
        monitoring_series_ref: jsonValue(command.monitoringSeriesRef),
        project_revision_ref: jsonValue(command.projectRevisionRef),
        spatial_scope_ref: jsonValue(command.spatialScopeRef),
        monitoring_object: command.monitoringObject,
        monitoring_indicator: command.monitoringIndicator,
        parameter_code: command.parameterCode,
        canonical_unit: command.canonicalUnit,
        unit_conversions: jsonValue(command.unitConversions),
        effective_period: jsonValue(command.effectivePeriod),
        recorded_at: command.issuedAt,
        actor_id: command.actorId,
        authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
        audit_entry_id: auditId,
        occurred_at: command.issuedAt,
        persisted_at: sql`clock_timestamp()`,
        previous_revision_id: previous?.revision_id ?? null,
      } satisfies InsertObject<MonitoringDatabase, "business.monitoring_series_revisions">)
      .execute();
    const pointerUpdate = db
      .updateTable("business.monitoring_series")
      .set({ current_revision_id: revisionId })
      .where("project_id", "=", command.projectId)
      .where("series_id", "=", command.monitoringSeriesRef.reference.entityId);
    const updated = await (
      previous === undefined
        ? pointerUpdate.where("current_revision_id", "is", null)
        : pointerUpdate.where("current_revision_id", "=", previous.revision_id)
    ).executeTakeFirst();
    if (Number(updated.numUpdatedRows) !== 1) {
      throw domainFailure(
        moduleError("STALE_VERSION", command.commandId, command.monitoringSeriesRef),
      );
    }
    return commit(
      command,
      "engineering-data.monitoring-series-revision",
      command.monitoringSeriesRef,
      command.monitoringSeriesRef.reference,
      command.issuedAt,
    );
  }

  async #registerPolicyInTransaction(
    context: TransactionContextV1,
    command: RegisterMonitoringAvailabilityPolicyCommandV1,
  ): Promise<AtomicCommitV1> {
    const db = transaction(context);
    const policy = MonitoringAvailabilityPolicyV1Schema.parse(command.policy);
    const series = await db
      .selectFrom("business.monitoring_series_revisions")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("series_id", "=", policy.monitoringSeriesRef.reference.entityId)
      .where("version_id", "=", policy.monitoringSeriesRef.reference.versionId)
      .executeTakeFirst();
    if (series === undefined)
      throw domainFailure(
        moduleError("ENTITY_NOT_FOUND", command.commandId, policy.monitoringSeriesRef),
      );
    const policyId = `${policy.availabilityPolicyRef.entityId}:${policy.availabilityPolicyRef.versionId}`;
    const hash = sha256CanonicalJson(policy);
    const existing = await db
      .selectFrom("business.monitoring_availability_policies")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("availability_policy_ref", "=", jsonValue(policy.availabilityPolicyRef))
      .executeTakeFirst();
    if (existing !== undefined) {
      if (existing.policy_sha256 !== hash)
        throw domainFailure(
          moduleError("STALE_VERSION", command.commandId, policy.monitoringSeriesRef),
        );
      return commit(
        command,
        "engineering-data.monitoring-availability-policy",
        policy.monitoringSeriesRef,
        policy.availabilityPolicyRef,
        command.issuedAt,
      );
    }
    await db
      .insertInto("business.monitoring_availability_policies")
      .values({
        policy_id: policyId,
        version_id: policy.availabilityPolicyRef.versionId,
        project_id: command.projectId,
        monitoring_series_ref: jsonValue(policy.monitoringSeriesRef),
        availability_policy_ref: jsonValue(policy.availabilityPolicyRef),
        policy: jsonValue(policy),
        policy_sha256: hash,
        actor_id: command.actorId,
        authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
        recorded_at: command.issuedAt,
        persisted_at: sql`clock_timestamp()`,
        audit_entry_id: auditEntryIdFor(command.commandId),
      } satisfies InsertObject<MonitoringDatabase, "business.monitoring_availability_policies">)
      .execute();
    return commit(
      command,
      "engineering-data.monitoring-availability-policy",
      policy.monitoringSeriesRef,
      policy.availabilityPolicyRef,
      command.issuedAt,
    );
  }

  async #registerBatchInTransaction(
    context: TransactionContextV1,
    command: Extract<EngineeringDataCommandV1, { kind: "register-monitoring-batch" }>,
    revision: MonitoringSeriesRevisionV1,
    artifact: SampleArtifactReadV1,
  ): Promise<AtomicCommitV1> {
    const db = transaction(context);
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`riskflow.c14.monitoring-series.${command.projectId}.${revision.monitoringSeriesRef.reference.entityId}`}, 0))`.execute(
      db,
    );
    await this.#artifactGuard.assertUsable(
      context,
      ArtifactReferenceCheckRequestV1Schema.parse({
        schemaVersion: "1",
        artifactRef: command.payload.sampleArtifactRef,
        projectId: command.projectId,
        purposeCode: "engineering-data.register-monitoring-batch",
        requiredCapability: "engineering-data.write",
        authorization: command.authorization,
      }),
    );
    const sourceVersion = await db
      .selectFrom("business.source_versions")
      .select([
        "source_version_id",
        "version_id",
        "project_id",
        "project_revision_ref",
        "spatial_scope_refs",
        "access_status",
        "source_access_grant_ref",
      ])
      .where("project_id", "=", command.projectId)
      .where("source_version_id", "=", artifact.envelope.sourceVersionRef.reference.entityId)
      .where("version_id", "=", artifact.envelope.sourceVersionRef.reference.versionId)
      .executeTakeFirst();
    const segmentSet = await db
      .selectFrom("business.source_segment_sets")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("source_segment_set_id", "=", artifact.envelope.sourceSegmentSetRef.reference.entityId)
      .where("version_id", "=", artifact.envelope.sourceSegmentSetRef.reference.versionId)
      .executeTakeFirst();
    if (
      sourceVersion === undefined ||
      segmentSet === undefined ||
      sourceVersion.access_status !== "ready"
    ) {
      throw domainFailure(moduleError("AUTHORIZATION_DENIED", command.commandId));
    }
    if (
      !hasVersionRef(sourceVersion.project_revision_ref, artifact.envelope.projectRevisionRef) ||
      !hasVersionRefInArray(sourceVersion.spatial_scope_refs, artifact.envelope.spatialScopeRef)
    ) {
      throw domainFailure(moduleError("AUTHORIZATION_DENIED", command.commandId));
    }
    if (segmentSet.source_version_id !== sourceVersion.source_version_id) {
      throw domainFailure(
        moduleError("BUSINESS_BLOCKED", command.commandId, artifact.envelope.sourceSegmentSetRef),
      );
    }
    const evidenceSegments = await db
      .selectFrom("business.source_segments")
      .select(["source_segment_id"])
      .where("project_id", "=", command.projectId)
      .where("source_segment_set_id", "=", segmentSet.source_segment_set_id)
      .execute();
    const segmentIds = new Set(evidenceSegments.map((row) => row.source_segment_id));
    for (const sample of artifact.samples) {
      if (
        sample.evidenceReferences.some(
          (evidence) =>
            !sameVersion(evidence.sourceVersion, artifact.envelope.sourceVersionRef.reference) ||
            !segmentIds.has(evidence.locator.sourceSegmentId),
        )
      ) {
        throw domainFailure(
          moduleError("BUSINESS_BLOCKED", command.commandId, artifact.envelope.sourceSegmentSetRef),
        );
      }
    }
    const existingFingerprint = await db
      .selectFrom("business.monitoring_batches")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where(
        "series_revision_id",
        "=",
        `${revision.monitoringSeriesRef.reference.entityId}:${revision.monitoringSeriesRef.reference.versionId}`,
      )
      .where("delivery_fingerprint", "=", artifact.fingerprint)
      .executeTakeFirst();
    if (existingFingerprint !== undefined) {
      return commit(
        command,
        "engineering-data.monitoring-batch",
        existingFingerprint.monitoring_batch_ref as MonitoringBatchRefV1,
        { entityId: existingFingerprint.batch_id, versionId: existingFingerprint.version_id },
        command.issuedAt,
      );
    }
    const priorRef =
      command.payload.relation.kind === "original"
        ? undefined
        : command.payload.relation.priorBatchRef;
    const prior =
      priorRef === undefined
        ? undefined
        : await db
            .selectFrom("business.monitoring_batches")
            .selectAll()
            .where("project_id", "=", command.projectId)
            .where("batch_id", "=", priorRef.reference.entityId)
            .where("version_id", "=", priorRef.reference.versionId)
            .executeTakeFirst();
    if (
      priorRef !== undefined &&
      (prior === undefined ||
        prior.series_revision_id !==
          `${revision.monitoringSeriesRef.reference.entityId}:${revision.monitoringSeriesRef.reference.versionId}`)
    ) {
      throw domainFailure(moduleError("STALE_VERSION", command.commandId, priorRef));
    }
    const priorBatchIds = new Set<string>();
    let priorCursor = prior;
    while (priorCursor !== undefined) {
      if (priorBatchIds.has(priorCursor.batch_id)) {
        throw domainFailure(moduleError("BUSINESS_BLOCKED", command.commandId, priorRef));
      }
      priorBatchIds.add(priorCursor.batch_id);
      if (priorCursor.prior_batch_id === null) break;
      priorCursor = await db
        .selectFrom("business.monitoring_batches")
        .selectAll()
        .where("project_id", "=", command.projectId)
        .where("batch_id", "=", priorCursor.prior_batch_id)
        .where("series_id", "=", revision.monitoringSeriesRef.reference.entityId)
        .executeTakeFirst();
      if (priorCursor === undefined) {
        throw domainFailure(moduleError("STALE_VERSION", command.commandId, priorRef));
      }
    }
    const priorSampleTimes = new Set(
      priorBatchIds.size === 0
        ? []
        : (
            await db
              .selectFrom("business.monitoring_sample_versions")
              .select("sampled_at")
              .where("project_id", "=", command.projectId)
              .where(
                "series_revision_id",
                "=",
                `${revision.monitoringSeriesRef.reference.entityId}:${revision.monitoringSeriesRef.reference.versionId}`,
              )
              .where("batch_id", "in", [...priorBatchIds])
              .execute()
          ).map((row) => new Date(row.sampled_at as Date | string).getTime()),
    );
    const sampledAt = artifact.samples.map((sample) => Date.parse(sample.sampledAt));
    const existingSamples =
      sampledAt.length === 0
        ? []
        : await db
            .selectFrom("business.monitoring_sample_versions")
            .selectAll()
            .where("project_id", "=", command.projectId)
            .where(
              "series_revision_id",
              "=",
              `${revision.monitoringSeriesRef.reference.entityId}:${revision.monitoringSeriesRef.reference.versionId}`,
            )
            .where("sampled_at", ">=", new Date(Math.min(...sampledAt)))
            .where("sampled_at", "<=", new Date(Math.max(...sampledAt)))
            .execute();
    const latestExistingSample = await db
      .selectFrom("business.monitoring_sample_versions")
      .select("sampled_at")
      .where("project_id", "=", command.projectId)
      .where(
        "series_revision_id",
        "=",
        `${revision.monitoringSeriesRef.reference.entityId}:${revision.monitoringSeriesRef.reference.versionId}`,
      )
      .orderBy("sampled_at", "desc")
      .executeTakeFirst();
    const existingByTime = new Map<number, MonitoringSampleVersionRow[]>();
    for (const item of existingSamples) {
      const key = new Date(item.sampled_at as Date | string).getTime();
      const values = existingByTime.get(key) ?? [];
      values.push(item);
      existingByTime.set(key, values);
    }
    for (const sample of artifact.samples) {
      const old = existingByTime.get(Date.parse(sample.sampledAt)) ?? [];
      const current = latestSample(old);
      if (
        command.payload.relation.kind === "correction" &&
        (current === undefined ||
          current.canonical_value === sample.canonicalValue ||
          !priorSampleTimes.has(Date.parse(sample.sampledAt)))
      ) {
        throw domainFailure(
          moduleError(
            "BUSINESS_BLOCKED",
            command.commandId,
            priorRef ?? command.payload.monitoringSeriesRef,
          ),
        );
      }
      if (command.payload.relation.kind === "supplement" && old.length > 0) {
        throw domainFailure(
          moduleError(
            "BUSINESS_BLOCKED",
            command.commandId,
            priorRef ?? command.payload.monitoringSeriesRef,
          ),
        );
      }
      if (
        command.payload.relation.kind === "supplement" &&
        (latestExistingSample === undefined ||
          Date.parse(sample.sampledAt) >=
            new Date(latestExistingSample.sampled_at as Date | string).getTime())
      ) {
        throw domainFailure(
          moduleError(
            "BUSINESS_BLOCKED",
            command.commandId,
            priorRef ?? command.payload.monitoringSeriesRef,
          ),
        );
      }
      if (
        command.payload.relation.kind === "original" &&
        old.some((item) => item.canonical_value !== sample.canonicalValue)
      ) {
        throw domainFailure(
          moduleError("BUSINESS_BLOCKED", command.commandId, command.payload.monitoringSeriesRef),
        );
      }
    }
    const batchId = `monitoring-batch:${revision.monitoringSeriesRef.reference.entityId}:${artifact.fingerprint.slice(0, 32)}`;
    const batchRef = ref("monitoring-batch", batchId, "1") as MonitoringBatchRefV1;
    const recordedAt = await databaseClock(db);
    const batch = MonitoringBatchV1Schema.parse({
      monitoringBatchRef: batchRef,
      projectId: command.projectId,
      monitoringSeriesRef: revision.monitoringSeriesRef,
      projectRevisionRef: artifact.envelope.projectRevisionRef,
      spatialScopeRef: artifact.envelope.spatialScopeRef,
      deliveryKey: command.payload.deliveryKey,
      deliveryFingerprint: artifact.fingerprint,
      sampleArtifactRef: command.payload.sampleArtifactRef,
      sourceVersionRef: artifact.envelope.sourceVersionRef,
      sourceSegmentSetRef: artifact.envelope.sourceSegmentSetRef,
      window: command.payload.window,
      relation: command.payload.relation,
      sampleCount: artifact.samples.length,
      occurredAt: command.issuedAt,
      recordedAt,
      audit: { actorId: command.actorId, action: "engineering-data.monitoring-batch", recordedAt },
    });
    await db
      .insertInto("business.monitoring_batches")
      .values({
        batch_id: batchId,
        version_id: "1",
        project_id: command.projectId,
        series_id: revision.monitoringSeriesRef.reference.entityId,
        series_revision_id: `${revision.monitoringSeriesRef.reference.entityId}:${revision.monitoringSeriesRef.reference.versionId}`,
        monitoring_batch_ref: jsonValue(batch.monitoringBatchRef),
        delivery_key: batch.deliveryKey,
        delivery_fingerprint: batch.deliveryFingerprint,
        sample_artifact_ref: jsonValue(batch.sampleArtifactRef),
        source_version_ref: jsonValue(batch.sourceVersionRef),
        source_segment_set_ref: jsonValue(batch.sourceSegmentSetRef),
        project_revision_ref: jsonValue(batch.projectRevisionRef),
        spatial_scope_ref: jsonValue(batch.spatialScopeRef),
        window_from: batch.window.from,
        window_to: batch.window.to,
        relation_kind: batch.relation.kind,
        prior_batch_id: prior?.batch_id ?? null,
        sample_count: batch.sampleCount,
        occurred_at: batch.occurredAt,
        recorded_at: batch.recordedAt,
        persisted_at: sql`clock_timestamp()`,
        actor_id: command.actorId,
        authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
        audit_entry_id: auditEntryIdFor(command.commandId),
      } satisfies InsertObject<MonitoringDatabase, "business.monitoring_batches">)
      .execute();
    for (const sample of artifact.samples) {
      const old = latestSample(existingByTime.get(Date.parse(sample.sampledAt)) ?? []);
      const sampleId = `${batchId}:${sample.sourceSampleKey}`;
      const sampleRef = sampleRefFor(sampleId, "1");
      const sampleVersion = MonitoringSampleVersionV1Schema.parse({
        sampleVersionRef: sampleRef,
        monitoringBatchRef: batch.monitoringBatchRef,
        monitoringSeriesRef: revision.monitoringSeriesRef,
        sourceSampleKey: sample.sourceSampleKey,
        sampledAt: sample.sampledAt,
        value: sample.value,
        unit: sample.unit,
        canonicalValue: sample.canonicalValue,
        canonicalUnit: revision.canonicalUnit,
        ...(old === undefined ? {} : { previousSampleVersionRef: old.sample_version_ref }),
        relationKind: batch.relation.kind,
        evidenceReferences: sample.evidenceReferences,
        sourceVersionRef: batch.sourceVersionRef,
        sourceSegmentSetRef: batch.sourceSegmentSetRef,
        recordedAt,
      });
      await db
        .insertInto("business.monitoring_sample_versions")
        .values({
          sample_version_id: sampleId,
          version_id: "1",
          project_id: command.projectId,
          series_id: revision.monitoringSeriesRef.reference.entityId,
          series_revision_id: `${revision.monitoringSeriesRef.reference.entityId}:${revision.monitoringSeriesRef.reference.versionId}`,
          batch_id: batchId,
          sample_version_ref: jsonValue(sampleVersion.sampleVersionRef),
          monitoring_batch_ref: jsonValue(sampleVersion.monitoringBatchRef),
          monitoring_series_ref: jsonValue(sampleVersion.monitoringSeriesRef),
          source_sample_key: sampleVersion.sourceSampleKey,
          sampled_at: sampleVersion.sampledAt,
          value: sampleVersion.value,
          unit: sampleVersion.unit,
          canonical_value: sampleVersion.canonicalValue,
          canonical_unit: sampleVersion.canonicalUnit,
          previous_sample_version_id: old?.sample_version_id ?? null,
          relation_kind: sampleVersion.relationKind,
          evidence_references: jsonValue(sampleVersion.evidenceReferences),
          source_version_ref: jsonValue(sampleVersion.sourceVersionRef),
          source_segment_set_ref: jsonValue(sampleVersion.sourceSegmentSetRef),
          recorded_at: sampleVersion.recordedAt,
          persisted_at: sql`clock_timestamp()`,
        } satisfies InsertObject<MonitoringDatabase, "business.monitoring_sample_versions">)
        .execute();
    }
    return commit(
      command,
      "engineering-data.monitoring-batch",
      batch.monitoringBatchRef,
      batch.monitoringBatchRef.reference,
      recordedAt,
    );
  }

  async #freezeInTransaction(
    context: TransactionContextV1,
    command: Extract<EngineeringFreezeCommandV1, { kind: "monitoring-snapshot" }>,
    revision: MonitoringSeriesRevisionV1,
    policy: MonitoringAvailabilityPolicyV1,
    recordedAt: string,
    sourceRows: MonitoringSnapshotSourceRowsV1,
  ): Promise<AtomicCommitV1> {
    const db = transaction(context);
    const seriesRevisionId = `${revision.monitoringSeriesRef.reference.entityId}:${revision.monitoringSeriesRef.reference.versionId}`;
    const cutoffMillis = Date.parse(command.payload.cutoff);
    const fromMillis = cutoffMillis - policy.windowDurationMs;
    const batches = sourceRows.batches;
    const batchById = new Map(batches.map((batch) => [batch.batch_id, batch]));
    const byTime = new Map<number, MonitoringSampleVersionRow[]>();
    const samples = sourceRows.samples;
    for (const sample of samples) {
      const time = new Date(sample.sampled_at as Date | string).getTime();
      const rows = byTime.get(time) ?? [];
      rows.push(sample);
      byTime.set(time, rows);
    }
    const selected = [...byTime.values()]
      .map((rows) => latestSample(rows))
      .filter((sample): sample is MonitoringSampleVersionRow => sample !== undefined)
      .sort(
        (left, right) =>
          new Date(left.sampled_at as Date | string).getTime() -
          new Date(right.sampled_at as Date | string).getTime(),
      );
    const featureSamples: MonitoringFeatureSampleV1[] = selected.map((sample) => ({
      sampledAt: asIso(sample.sampled_at),
      value: sample.value,
      canonicalValue: sample.canonical_value,
      canonicalUnit: sample.canonical_unit,
      sourceSampleKey: sample.source_sample_key,
      sampleVersionRef:
        sample.sample_version_ref as unknown as MonitoringSampleVersionV1["sampleVersionRef"],
    }));
    const computed = computeMonitoringFeatures({
      samples: featureSamples,
      cutoff: command.payload.cutoff,
      canonicalUnit: revision.canonicalUnit,
      policy,
    });
    const snapshotId = `monitoring-snapshot:${sha256CanonicalJson({ projectId: command.projectId, commandId: command.commandId }).slice(0, 40)}`;
    const snapshotRef = ref("monitoring-snapshot", snapshotId, "1") as MonitoringSnapshotRefV1;
    const batchRefs = [
      ...new Map(
        batches
          .filter((batch) => selected.some((sample) => sample.batch_id === batch.batch_id))
          .map((batch) => [
            refKey(batch.monitoring_batch_ref as MonitoringBatchRefV1),
            batch.monitoring_batch_ref as MonitoringBatchRefV1,
          ]),
      ).values(),
    ];
    const sampleRefs = selected.map(
      (sample) =>
        sample.sample_version_ref as unknown as MonitoringSampleVersionV1["sampleVersionRef"],
    );
    const evidenceReferences = selected.flatMap(
      (sample) => sample.evidence_references as unknown as EvidenceReference[],
    );
    const uniqueEvidence = [
      ...new Map(
        evidenceReferences.map((evidence) => [
          `${evidence.sourceVersion.entityId}/${evidence.sourceVersion.versionId}/${evidence.locator.sourceSegmentId}`,
          evidence,
        ]),
      ).values(),
    ];
    const members = selected.map((sample, index) => {
      const batch = batchById.get(sample.batch_id);
      if (batch === undefined)
        throw domainFailure(moduleError("TERMINAL_FAILURE", command.commandId));
      return {
        memberIndex: index,
        monitoringBatchRef: batch.monitoring_batch_ref as MonitoringBatchRefV1,
        sampleVersionRef:
          sample.sample_version_ref as unknown as MonitoringSampleVersionV1["sampleVersionRef"],
        selectionReason: sample.relation_kind === "original" ? "original" : sample.relation_kind,
      } as const;
    });
    const snapshot = MonitoringSnapshotV1Schema.parse({
      monitoringSnapshotRef: snapshotRef,
      projectId: command.projectId,
      monitoringSeriesRef: revision.monitoringSeriesRef,
      cutoff: command.payload.cutoff,
      recordedAt,
      window: { from: new Date(fromMillis).toISOString(), to: command.payload.cutoff },
      availabilityPolicyRef: policy.availabilityPolicyRef,
      algorithmVersions: policy.algorithmVersions,
      monitoringBatchRefs: batchRefs,
      sampleVersionRefs: sampleRefs,
      members,
      alignedPoints: computed.alignedPoints,
      features: computed.features,
      availability: computed.availability,
      coverageRatio: computed.coverageRatio,
      availabilityReasons: computed.availabilityReasons,
      evidenceReferences: uniqueEvidence,
      authorizationSnapshot: {
        authorizationContextRef: command.authorization.authorizationContextRef,
        spatialScopeRefs: [revision.spatialScopeRef],
        sourceAccessGrantRefs: command.authorization.sourceAccessGrantRefs,
      },
      audit: {
        actorId: command.actorId,
        action: "engineering-data.monitoring-snapshot",
        recordedAt,
      },
    });
    await db
      .insertInto("business.monitoring_snapshots")
      .values({
        snapshot_id: snapshotId,
        version_id: "1",
        project_id: command.projectId,
        series_id: revision.monitoringSeriesRef.reference.entityId,
        series_revision_id: seriesRevisionId,
        monitoring_snapshot_ref: jsonValue(snapshot.monitoringSnapshotRef),
        monitoring_series_ref: jsonValue(snapshot.monitoringSeriesRef),
        cutoff: snapshot.cutoff,
        recorded_at: snapshot.recordedAt,
        window: jsonValue(snapshot.window),
        availability_policy_ref: jsonValue(snapshot.availabilityPolicyRef),
        algorithm_versions: jsonValue(snapshot.algorithmVersions),
        monitoring_batch_refs: jsonValue(snapshot.monitoringBatchRefs),
        sample_version_refs: jsonValue(snapshot.sampleVersionRefs),
        availability: snapshot.availability,
        coverage_ratio: snapshot.coverageRatio,
        availability_reasons: jsonValue(snapshot.availabilityReasons),
        evidence_references: jsonValue(snapshot.evidenceReferences),
        authorization_snapshot: jsonValue(snapshot.authorizationSnapshot),
        actor_id: command.actorId,
        authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
        audit_entry_id: auditEntryIdFor(command.commandId),
        persisted_at: sql`clock_timestamp()`,
      } satisfies InsertObject<MonitoringDatabase, "business.monitoring_snapshots">)
      .execute();
    if (members.length > 0) {
      await db
        .insertInto("business.monitoring_snapshot_members")
        .values(
          members.map((member) => ({
            project_id: command.projectId,
            snapshot_id: snapshotId,
            member_index: member.memberIndex,
            batch_id: member.monitoringBatchRef.reference.entityId,
            sample_version_id: member.sampleVersionRef.reference.entityId,
            selection_reason: member.selectionReason,
          })),
        )
        .execute();
    }
    if (snapshot.alignedPoints.length > 0) {
      await db
        .insertInto("business.monitoring_snapshot_points")
        .values(
          snapshot.alignedPoints.map((item, index) => ({
            project_id: command.projectId,
            snapshot_id: snapshotId,
            point_index: index,
            sampled_at: item.sampledAt,
            value: item.value,
            unit: item.unit,
            status: item.status,
            source_sample_refs: jsonValue(item.sourceSampleRefs),
            reason_code: item.reasonCode ?? null,
          })),
        )
        .execute();
    }
    const features = Object.values(snapshot.features);
    await db
      .insertInto("business.monitoring_snapshot_features")
      .values(
        features.map((item) => ({
          project_id: command.projectId,
          snapshot_id: snapshotId,
          feature_type: item.featureType,
          value: item.value ?? null,
          unit: item.unit ?? null,
          window_size: item.windowSize,
          input_count: item.inputCount,
          algorithm_version: item.algorithmVersion,
          status: item.status,
          reason_code: item.reasonCode ?? null,
        })),
      )
      .execute();
    return commit(
      command,
      "engineering-data.monitoring-snapshot",
      snapshot.monitoringSnapshotRef,
      snapshot.monitoringSnapshotRef.reference,
      recordedAt,
    );
  }

  async #selectSnapshotSourceRows(
    db: MonitoringTransaction,
    projectId: string,
    revision: MonitoringSeriesRevisionV1,
    policy: MonitoringAvailabilityPolicyV1,
    cutoff: string,
    recordedAt: string,
  ): Promise<MonitoringSnapshotSourceRowsV1> {
    const seriesRevisionId = `${revision.monitoringSeriesRef.reference.entityId}:${revision.monitoringSeriesRef.reference.versionId}`;
    const cutoffMillis = Date.parse(cutoff);
    const fromMillis = cutoffMillis - policy.windowDurationMs;
    const batches = await db
      .selectFrom("business.monitoring_batches")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("series_revision_id", "=", seriesRevisionId)
      .where("recorded_at", "<=", recordedAt)
      .execute();
    const samples =
      batches.length === 0
        ? []
        : await db
            .selectFrom("business.monitoring_sample_versions")
            .selectAll()
            .where("project_id", "=", projectId)
            .where("series_revision_id", "=", seriesRevisionId)
            .where("sampled_at", ">", new Date(fromMillis))
            .where("sampled_at", "<=", new Date(cutoffMillis))
            .where(
              "batch_id",
              "in",
              batches.map((batch) => batch.batch_id),
            )
            .where("recorded_at", "<=", recordedAt)
            .execute();
    return { batches, samples };
  }

  async #registerQueryInTransaction(
    context: TransactionContextV1,
    query: Extract<EngineeringDataQueryV1, { kind: "monitoring-snapshot" }>,
    snapshot: MonitoringSnapshotV1,
  ): Promise<AtomicCommitV1> {
    const db = transaction(context);
    const queryId = `monitoring-${query.queryId}`;
    const queryRef = ref("query-result", queryId, "1") as QueryResultRefV1;
    const recordedAt = nowIso(this.#now);
    await db
      .insertInto("business.monitoring_snapshot_query_results")
      .values({
        query_result_id: queryId,
        version_id: "1",
        project_id: query.projectId,
        query_result_ref: jsonValue(queryRef),
        snapshot_id: snapshot.monitoringSnapshotRef.reference.entityId,
        monitoring_snapshot_ref: jsonValue(snapshot.monitoringSnapshotRef),
        authorization_context_ref: jsonValue(query.authorization.authorizationContextRef),
        requested_by: query.actorId,
        recorded_at: recordedAt,
        persisted_at: sql`clock_timestamp()`,
        audit_entry_id: auditEntryIdFor(query.queryId),
      } satisfies InsertObject<MonitoringDatabase, "business.monitoring_snapshot_query_results">)
      .onConflict((conflict) => conflict.columns(["project_id", "query_result_ref"]).doNothing())
      .execute();
    return commit(
      {
        commandId: query.queryId,
        idempotencyKey: query.queryId,
        projectId: query.projectId,
        actorId: query.actorId,
        issuedAt: query.requestedAt,
        authorization: query.authorization,
      },
      "engineering-data.monitoring-snapshot-query",
      queryRef,
      queryRef.reference,
      recordedAt,
    );
  }

  async #registerSeriesReadInTransaction(
    query: ReadMonitoringSeriesRevisionQueryV1,
    actorId: string,
  ): Promise<AtomicCommitV1> {
    const recordedAt = nowIso(this.#now);
    return commit(
      {
        commandId: query.queryId,
        idempotencyKey: query.queryId,
        projectId: query.projectId,
        actorId,
        issuedAt: query.requestedAt,
        authorization: query.authorization,
      },
      "engineering-data.monitoring-series-read",
      query.monitoringSeriesRef,
      query.monitoringSeriesRef.reference,
      recordedAt,
    );
  }

  async #readSampleArtifact(
    command: Extract<EngineeringDataCommandV1, { kind: "register-monitoring-batch" }>,
    revision: MonitoringSeriesRevisionV1,
  ): Promise<SampleArtifactReadV1> {
    const request = ArtifactReadRequestV1Schema.parse({
      schemaVersion: "1",
      requestId: `${command.commandId}:sample-artifact`,
      idempotencyKey: `${command.idempotencyKey}:sample-artifact`,
      artifactRef: command.payload.sampleArtifactRef,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.issuedAt,
      purposeCode: "engineering-data.register-monitoring-batch",
      requiredCapability: "engineering-data.write",
      authorization: command.authorization,
    });
    const handle = await this.#artifactStore.open(request);
    if (handle.manifest.mediaType !== "application/x-ndjson") {
      throw new ArtifactStoreError({
        code: "ARTIFACT_INPUT_INVALID",
        stage: "monitoring.sample-artifact.media-type",
        occurredAt: new Date().toISOString(),
        retryable: false,
        diagnosticRef: artifactDiagnosticRef("ARTIFACT_INPUT_INVALID"),
        contextRefs: [],
      });
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const encoder = new TextEncoder();
    const samples: NormalizedMonitoringSampleV1[] = [];
    const sourceSampleKeys = new Set<string>();
    let buffer = "";
    let totalBytes = 0;
    let previousTimestamp: number | undefined;
    let envelope: MonitoringSampleArtifactEnvelopeV1 | undefined;
    const parseLine = (line: string, lineBytes: number): void => {
      const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (normalizedLine.length === 0) throw new RangeError("empty monitoring artifact line");
      const value: unknown = JSON.parse(normalizedLine);
      if (envelope === undefined) {
        if (lineBytes > 64 * 1024) throw new RangeError("monitoring envelope exceeds 64 KiB");
        envelope = MonitoringSampleArtifactEnvelopeV1Schema.parse(value);
        if (
          !sameVersion(
            envelope.monitoringSeriesRef.reference,
            revision.monitoringSeriesRef.reference,
          )
        )
          throw new RangeError("artifact series does not match revision");
        if (
          !sameVersion(
            envelope.projectRevisionRef.reference,
            revision.projectRevisionRef.reference,
          ) ||
          !sameVersion(envelope.spatialScopeRef.reference, revision.spatialScopeRef.reference)
        )
          throw new RangeError("artifact context does not match revision");
        return;
      }
      if (lineBytes > 16 * 1024) throw new RangeError("monitoring sample exceeds 16 KiB");
      if (samples.length >= 100_000) throw new RangeError("monitoring sample count exceeds limit");
      const sample = MonitoringSampleInputV1Schema.parse(value);
      if (sourceSampleKeys.has(sample.sourceSampleKey)) {
        throw new RangeError("monitoring sample source key is duplicated");
      }
      sourceSampleKeys.add(sample.sourceSampleKey);
      const sampledAt = Date.parse(sample.sampledAt);
      if (previousTimestamp !== undefined && sampledAt <= previousTimestamp)
        throw new RangeError("monitoring samples are not strictly ordered");
      previousTimestamp = sampledAt;
      const from = Date.parse(command.payload.window.from);
      const to = Date.parse(command.payload.window.to);
      if (sampledAt < from || sampledAt >= to)
        throw new RangeError("monitoring sample is outside batch window");
      const canonicalValue = convertMonitoringValue(
        sample.value,
        sample.unit,
        revision.canonicalUnit,
        revision.unitConversions,
      );
      samples.push({ ...sample, canonicalValue });
    };
    for await (const chunk of handle.content) {
      totalBytes += chunk.byteLength;
      if (totalBytes > handle.manifest.content.byteLength)
        throw new RangeError("monitoring artifact exceeds manifest length");
      buffer += decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        parseLine(line, encoder.encode(line).byteLength);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
      if (encoder.encode(buffer).byteLength > 16 * 1024)
        throw new RangeError("monitoring artifact line exceeds limit");
    }
    buffer += decoder.decode();
    if (buffer.length > 0) parseLine(buffer, encoder.encode(buffer).byteLength);
    await handle.verified;
    if (envelope === undefined || envelope.sampleCount !== samples.length)
      throw new RangeError("monitoring sample count mismatch");
    const fingerprint = sha256CanonicalJson({
      monitoringSeriesRef: envelope.monitoringSeriesRef,
      sourceVersionRef: envelope.sourceVersionRef,
      sourceSegmentSetRef: envelope.sourceSegmentSetRef,
      window: command.payload.window,
      relation: command.payload.relation,
      samples: samples.map((sample) => ({
        sourceSampleKey: sample.sourceSampleKey,
        sampledAt: sample.sampledAt,
        canonicalValue: sample.canonicalValue,
        evidenceReferences: [...sample.evidenceReferences].sort((left, right) =>
          evidenceKey(left).localeCompare(evidenceKey(right)),
        ),
      })),
    });
    return { envelope, samples, fingerprint };
  }

  async #readSeriesRevision(
    projectId: string,
    seriesRef: MonitoringSeriesRefV1 | ContractReferenceV1,
  ): Promise<MonitoringSeriesRevisionV1 | undefined> {
    return this.#readSeriesRevisionFromDb(this.#db, projectId, seriesRef);
  }

  async #readSeriesRevisionFromDb(
    db: Kysely<MonitoringDatabase>,
    projectId: string,
    seriesRef: MonitoringSeriesRefV1 | ContractReferenceV1,
  ): Promise<MonitoringSeriesRevisionV1 | undefined> {
    if (seriesRef.kind !== "monitoring-series") return undefined;
    const row = await db
      .selectFrom("business.monitoring_series_revisions")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("series_id", "=", seriesRef.reference.entityId)
      .where("version_id", "=", seriesRef.reference.versionId)
      .executeTakeFirst();
    if (row === undefined) return undefined;
    return MonitoringSeriesRevisionV1Schema.parse({
      monitoringSeriesRef: row.monitoring_series_ref,
      seriesId: row.series_id,
      projectId: row.project_id,
      projectRevisionRef: row.project_revision_ref,
      spatialScopeRef: row.spatial_scope_ref,
      monitoringObject: row.monitoring_object,
      monitoringIndicator: row.monitoring_indicator,
      parameterCode: row.parameter_code,
      canonicalUnit: row.canonical_unit,
      unitConversions: row.unit_conversions,
      effectivePeriod: row.effective_period,
      recordedAt: asIso(row.recorded_at),
      ...(row.previous_revision_id === null
        ? {}
        : {
            previousRevisionRef: ref(
              "monitoring-series",
              row.series_id,
              row.previous_revision_id.split(":").at(-1) ?? "1",
            ),
          }),
      audit: {
        actorId: row.actor_id,
        action: "engineering-data.monitoring-series-revision",
        recordedAt: asIso(row.recorded_at),
      },
    });
  }

  async #readSeriesRevisionStatus(
    projectId: string,
    seriesRef: MonitoringSeriesRefV1,
  ): Promise<MonitoringSeriesRevisionStatusV1 | undefined> {
    const row = await this.#db
      .selectFrom("business.monitoring_series")
      .select(["current_revision_id"])
      .where("project_id", "=", projectId)
      .where("series_id", "=", seriesRef.reference.entityId)
      .executeTakeFirst();
    if (row === undefined) return undefined;
    const revisionId = `${seriesRef.reference.entityId}:${seriesRef.reference.versionId}`;
    return row.current_revision_id === revisionId ? "current" : "superseded";
  }

  async #readPolicy(
    projectId: string,
    policyRef: VersionReference,
  ): Promise<MonitoringAvailabilityPolicyV1 | undefined> {
    return this.#readPolicyFromDb(this.#db, projectId, policyRef);
  }

  async #readPolicyFromDb(
    db: Kysely<MonitoringDatabase>,
    projectId: string,
    policyRef: VersionReference,
  ): Promise<MonitoringAvailabilityPolicyV1 | undefined> {
    const row = await db
      .selectFrom("business.monitoring_availability_policies")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("policy_id", "=", `${policyRef.entityId}:${policyRef.versionId}`)
      .where("version_id", "=", policyRef.versionId)
      .executeTakeFirst();
    return row === undefined ? undefined : MonitoringAvailabilityPolicyV1Schema.parse(row.policy);
  }

  async #readBatch(
    projectId: string,
    batchRef: ContractReferenceV1,
  ): Promise<MonitoringBatchV1 | undefined> {
    if (batchRef.kind !== "monitoring-batch") return undefined;
    const row = await this.#db
      .selectFrom("business.monitoring_batches")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("batch_id", "=", batchRef.reference.entityId)
      .where("version_id", "=", batchRef.reference.versionId)
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : MonitoringBatchV1Schema.parse({
          monitoringBatchRef: row.monitoring_batch_ref,
          projectId: row.project_id,
          monitoringSeriesRef: ref(
            "monitoring-series",
            row.series_id,
            row.series_revision_id.split(":").at(-1) ?? "1",
          ),
          projectRevisionRef: row.project_revision_ref,
          spatialScopeRef: row.spatial_scope_ref,
          deliveryKey: row.delivery_key,
          deliveryFingerprint: row.delivery_fingerprint,
          sampleArtifactRef: row.sample_artifact_ref,
          sourceVersionRef: row.source_version_ref,
          sourceSegmentSetRef: row.source_segment_set_ref,
          window: { from: asIso(row.window_from), to: asIso(row.window_to) },
          relation:
            row.relation_kind === "original"
              ? { kind: "original" }
              : {
                  kind: row.relation_kind,
                  priorBatchRef: ref("monitoring-batch", row.prior_batch_id ?? "", "1"),
                },
          sampleCount: row.sample_count,
          occurredAt: asIso(row.occurred_at),
          recordedAt: asIso(row.recorded_at),
          audit: {
            actorId: row.actor_id,
            action: "engineering-data.monitoring-batch",
            recordedAt: asIso(row.recorded_at),
          },
        });
  }

  async #readSnapshotByRef(
    projectId: string,
    snapshotRef: MonitoringSnapshotRefV1,
  ): Promise<MonitoringSnapshotV1 | undefined> {
    const row = await this.#db
      .selectFrom("business.monitoring_snapshots")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("snapshot_id", "=", snapshotRef.reference.entityId)
      .where("version_id", "=", snapshotRef.reference.versionId)
      .executeTakeFirst();
    return row === undefined ? undefined : this.#readSnapshotRow(this.#db, row);
  }

  async #readSnapshot(
    projectId: string,
    snapshotRef: ContractReferenceV1,
  ): Promise<MonitoringSnapshotV1 | undefined> {
    if (snapshotRef.kind !== "monitoring-snapshot") return undefined;
    return this.#readSnapshotByRef(projectId, snapshotRef);
  }

  async #readSnapshotRow(
    db: Kysely<MonitoringDatabase>,
    row: MonitoringSnapshotRow,
  ): Promise<MonitoringSnapshotV1> {
    const [members, points, features] = await Promise.all([
      db
        .selectFrom("business.monitoring_snapshot_members")
        .selectAll()
        .where("project_id", "=", row.project_id)
        .where("snapshot_id", "=", row.snapshot_id)
        .orderBy("member_index", "asc")
        .execute(),
      db
        .selectFrom("business.monitoring_snapshot_points")
        .selectAll()
        .where("project_id", "=", row.project_id)
        .where("snapshot_id", "=", row.snapshot_id)
        .orderBy("point_index", "asc")
        .execute(),
      db
        .selectFrom("business.monitoring_snapshot_features")
        .selectAll()
        .where("project_id", "=", row.project_id)
        .where("snapshot_id", "=", row.snapshot_id)
        .orderBy("feature_type", "asc")
        .execute(),
    ]);
    const featureObjects = features.map((feature) => ({
      featureType: feature.feature_type,
      ...(feature.value === null ? {} : { value: feature.value }),
      ...(feature.unit === null ? {} : { unit: feature.unit }),
      windowSize: feature.window_size,
      inputCount: feature.input_count,
      algorithmVersion: feature.algorithm_version,
      status: feature.status,
      ...(feature.reason_code === null ? {} : { reasonCode: feature.reason_code }),
    }));
    const featureMap = Object.fromEntries(
      featureObjects.map((feature) => [feature.featureType, feature]),
    );
    return MonitoringSnapshotV1Schema.parse({
      monitoringSnapshotRef: row.monitoring_snapshot_ref,
      projectId: row.project_id,
      monitoringSeriesRef: row.monitoring_series_ref,
      cutoff: asIso(row.cutoff),
      recordedAt: asIso(row.recorded_at),
      window: row.window,
      availabilityPolicyRef: row.availability_policy_ref,
      algorithmVersions: row.algorithm_versions,
      monitoringBatchRefs: row.monitoring_batch_refs,
      sampleVersionRefs: row.sample_version_refs,
      members: members.map((member) => ({
        memberIndex: member.member_index,
        monitoringBatchRef: ref("monitoring-batch", member.batch_id, "1"),
        sampleVersionRef: sampleRefFor(member.sample_version_id, "1"),
        selectionReason: member.selection_reason,
      })),
      alignedPoints: points.map((point) => ({
        sampledAt: asIso(point.sampled_at),
        value: point.value,
        unit: point.unit,
        status: point.status,
        sourceSampleRefs: point.source_sample_refs,
        ...(point.reason_code === null ? {} : { reasonCode: point.reason_code }),
      })),
      features: {
        shortTermSlope: featureMap["short-term-slope"],
        acceleration: featureMap.acceleration,
        dominantFrequency: featureMap["dominant-frequency"],
        anomalyScore: featureMap["anomaly-score"],
      },
      availability: row.availability,
      coverageRatio: row.coverage_ratio,
      availabilityReasons: row.availability_reasons,
      evidenceReferences: row.evidence_references,
      authorizationSnapshot: row.authorization_snapshot,
      audit: {
        actorId: row.actor_id,
        action: "engineering-data.monitoring-snapshot",
        recordedAt: asIso(row.recorded_at),
      },
    });
  }

  async #assertContextCurrent(
    db: MonitoringTransaction,
    projectId: string,
    projectRevisionRef: { reference: { entityId: string; versionId: string } },
    spatialScopeRef: { reference: { entityId: string; versionId: string } },
    commandId: string,
  ): Promise<void> {
    const project = await db
      .selectFrom("business.engineering_projects")
      .selectAll()
      .where("project_id", "=", projectId)
      .executeTakeFirst();
    const spatial = await db
      .selectFrom("business.engineering_spatial_segments")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("scope_id", "=", spatialScopeRef.reference.entityId)
      .executeTakeFirst();
    if (
      project === undefined ||
      spatial === undefined ||
      project.current_revision_id !== `${projectId}:${projectRevisionRef.reference.versionId}` ||
      spatial.current_revision_id !==
        `${spatialScopeRef.reference.entityId}:${spatialScopeRef.reference.versionId}`
    ) {
      throw domainFailure(
        moduleError("STALE_VERSION", commandId, {
          kind: "project-revision",
          reference: { entityId: projectId, versionId: projectRevisionRef.reference.versionId },
        }),
      );
    }
  }

  #mapError(
    error: unknown,
    causalRunId: string,
    stage: string,
    requiredCapability:
      "engineering-data.write" | "engineering-data.freeze" | "engineering-data.read",
  ): ModuleErrorV1 {
    const monitoringError =
      error instanceof Error
        ? (error as Error & { monitoringError?: unknown }).monitoringError
        : undefined;
    if (monitoringError !== undefined) return monitoringError as ModuleErrorV1;
    if (error instanceof AccessServiceError) {
      if (error.details.code === "AUTHORIZATION_DENIED")
        return moduleError("AUTHORIZATION_DENIED", causalRunId, undefined, requiredCapability);
      if (error.details.code === "SESSION_EXPIRED" || error.details.code === "SESSION_REVOKED")
        return moduleError("AUTHORIZATION_DENIED", causalRunId, undefined, requiredCapability);
      if (error.details.code === "STALE_ACCESS_VERSION")
        return moduleError("STALE_VERSION", causalRunId, error.details.targetRef);
      if (error.details.code === "IDEMPOTENCY_CONFLICT")
        return moduleError("IDEMPOTENCY_CONFLICT", causalRunId);
      return moduleError(
        error.details.retryable ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE",
        causalRunId,
      );
    }
    if (error instanceof ArtifactStoreError) {
      return mapArtifactErrorToModuleError(error, {
        causalRunId,
        requiredCapability,
        authorizationPolicyRef: ACCESS_POLICY_REF_V1,
        schemaVersion: "1",
      });
    }
    const mapped = mapPostgresError(error, stage);
    if (mapped.code === "IDEMPOTENCY_CONFLICT") {
      return moduleError("IDEMPOTENCY_CONFLICT", causalRunId);
    }
    return moduleError(mapped.retryable ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE", causalRunId);
  }
}

export const createPostgresMonitoringStore = (
  options: PostgresMonitoringStoreOptions,
): PostgresMonitoringStoreV1 => new PostgresMonitoringStoreV1(options);
