import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Kysely, PostgresDialect } from "kysely";

import { ArtifactPutCommandV1Schema } from "@riskflow/core/artifacts";
import type {
  ApplicabilityMetadataSnapshotRefV1,
  AssessmentEntryContextReadQueryV1,
  AssessmentEntryContextReadResultV1,
  AuthorizationContextRefV1,
  AuthorizationContextV1,
  ContentArtifactRefV1,
  EngineeringDataApplyResultV1,
  EngineeringDataCommandV1,
  EngineeringDataQueryV1,
  EngineeringFreezeCommandV1,
  ProjectRevisionRefV1,
  SourceSegmentSetRefV1,
  SourceVersionRefV1,
  SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import {
  RiskInputVersionRefV1Schema,
  SpatialScopeRefV1Schema,
  StandardizedRiskRecordRefV1Schema,
  StructuredDocumentConversionCommandV1Schema,
  StructuredDocumentConversionQueryV1Schema,
} from "@riskflow/contracts/ports";
import { bootstrapInitialSystemAdministrator } from "../../../src/auth/index.js";
import { PostgresEngineeringContextSourceRegistry } from "../../../src/engineering-data/context-source/postgres-engineering-context-source-registry.js";
import { StructuredDocumentConversionAdapter } from "../../../src/engineering-data/document-conversion/structured-document-converter.js";
import { createPostgresPool, createPostgresRuntime } from "../../../src/postgres/pool.js";
import type { PostgresDatabase } from "../../../src/postgres/types.js";
import * as contextSourceMigration from "../../../src/postgres/migrations/engineering-data/deliver-engineering-context-and-source-registry/000008_engineering_context_source_registry.js";
import * as externalRiskEventRegistrationMigration from "../../../src/postgres/migrations/engineering-data/implement-external-risk-event-registration/000036_external_risk_event_registration.js";
import * as readQueryResultsMigration from "../../../src/postgres/migrations/engineering-data/implement-engineering-data-read-branches/000024_engineering_data_read_query_results.js";
import * as assessmentEntryCatalogCursorKeysMigration from "../../../src/postgres/migrations/engineering-data/fix-assessment-entry-read-seam/000055_assessment_entry_catalog_cursor_keys.js";
import {
  startEngineeringContextSourceFixture,
  type EngineeringContextSourcePostgresFixture,
} from "./fixture.js";

const projectId = "project-1";
const scopeRef = {
  kind: "spatial-scope" as const,
  reference: { entityId: "scope-1", versionId: "1" },
};
const authorization = {
  schemaVersion: "1" as const,
  authorizationContextRef: {
    kind: "authorization-context" as const,
    reference: { entityId: "auth-1", versionId: "1" },
  },
  actorId: "account-1",
  projectId,
  grantedCapabilities: ["engineering-data.write" as const],
  spatialScopeRefs: [scopeRef],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
  decidedAt: "2030-01-01T00:00:00.000Z",
  invocation: { kind: "human" as const },
};

describe("C11 PostgreSQL context/source registry", () => {
  let fixture: EngineeringContextSourcePostgresFixture;
  let e2eState:
    | {
        projectId: string;
        managerId: string;
        adminContextRef: AuthorizationContextRefV1;
        projectRevisionRef: ProjectRevisionRefV1;
        sourceVersionRef: SourceVersionRefV1;
        businessSpatialScopeRef: SpatialScopeRefV1;
        accessRootScopeRef: SpatialScopeRefV1;
        systemAdministrationContextRef: AuthorizationContextRefV1;
        managerSessionToken: string;
        snapshotRef: {
          kind: "applicability-metadata-snapshot";
          reference: { entityId: string; versionId: string };
        };
        metadataArtifactRef: ContentArtifactRefV1;
        deliveryCommand: Extract<EngineeringDataCommandV1, { kind: "register-source-delivery" }>;
        segmentSetRef: SourceSegmentSetRefV1;
        segmentIds: readonly string[];
        authorize(
          invocationId: string,
          requestedSourceVersionRefs?: readonly SourceVersionRefV1[],
          branch?:
            | "engineering-data.register-source-delivery"
            | "engineering-data.register-external-risk-event"
            | "engineering-data.evidence-access"
            | "engineering-data.source-segments"
            | "engineering-data.context-read",
          requestedSpatialScopeRefs?: readonly SpatialScopeRefV1[],
        ): Promise<AuthorizationContextV1>;
      }
    | undefined;

  beforeAll(async () => {
    fixture = await startEngineeringContextSourceFixture({
      now: () => new Date("2030-01-01T00:00:00.000Z"),
    });
  }, 240_000);

  afterAll(async () => {
    await fixture?.close();
  }, 60_000);

  const requireE2eState = () => {
    if (e2eState === undefined) throw new Error("e2e state is not initialized");
    return e2eState;
  };

  const createDelivery = async (
    suffix: string,
    options: {
      readonly sourceContent?: string;
      readonly mediaType?: string;
      readonly spatialScopeRefs?: readonly SpatialScopeRefV1[];
      readonly authorizationSpatialScopeRefs?: readonly SpatialScopeRefV1[];
      readonly applicabilityMetadataSnapshotRef?: ApplicabilityMetadataSnapshotRefV1;
    } = {},
  ) => {
    const state = requireE2eState();
    const now = "2030-01-01T00:00:00.000Z";
    const commandId = `c11-${suffix}`;
    const authorization = await state.authorize(
      commandId,
      [],
      undefined,
      options.authorizationSpatialScopeRefs,
    );
    const put = async (id: string, content: string, mediaType: string) =>
      fixture.artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: `c11-put-${id}`,
          idempotencyKey: `c11-put-${id}`,
          projectId: state.projectId,
          actorId: state.managerId,
          issuedAt: now,
          authorization,
          requiredCapability: "engineering-data.write",
          artifactId: `c11-${id}`,
          artifactKind: "content",
          purposeCode: "engineering-data.register-source-delivery",
          mediaType,
          parentArtifactRefs: [],
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        (async function* () {
          yield new TextEncoder().encode(content);
        })(),
      );
    const sourceContent = options.sourceContent ?? `source body ${suffix}`;
    const sourceArtifact = await put(
      `${suffix}-source`,
      sourceContent,
      options.mediaType ?? "text/plain",
    );
    const metadataArtifact = await put(
      `${suffix}-metadata`,
      JSON.stringify({
        schemaVersion: "1",
        projectRevisionRef: state.projectRevisionRef,
        spatialScopeRefs: [...(options.spatialScopeRefs ?? [state.businessSpatialScopeRef])],
        registeredByAccountId: state.managerId,
        sourceItemId: `c11-source-item-${suffix}`,
        sourceItemName: `施工方案-${suffix}`,
        sourceCategory: "engineering-document",
        sourceMetadata: {
          documentType: "施工方案",
          formedAt: now,
          sourceOrganization: "甲方",
        },
        descriptor: { kind: "file-upload", contentFingerprint: sourceContent },
        applicabilityMetadataSnapshotRef:
          options.applicabilityMetadataSnapshotRef ?? state.snapshotRef,
      }),
      "application/json",
    );
    const command = {
      commandId,
      idempotencyKey: commandId,
      projectId: state.projectId,
      actorId: state.managerId,
      issuedAt: now,
      authorization,
      kind: "register-source-delivery" as const,
      payload: {
        sourceConnectionRef: { entityId: "file-upload", versionId: "1" },
        deliveryKey: `c11-delivery-${suffix}`,
        sourceArtifactRef: sourceArtifact.artifactRef,
        metadataArtifactRef: metadataArtifact.artifactRef,
        occurredAt: now,
      },
    } satisfies Extract<EngineeringDataCommandV1, { kind: "register-source-delivery" }>;
    return { command };
  };

  const putExternalEventArtifact = async (
    owner: { readonly projectId: string; readonly managerId: string },
    artifactId: string,
    content: string,
    authorization: AuthorizationContextV1,
  ) =>
    fixture.artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: "1",
        commandId: `c11-put-${artifactId}`,
        idempotencyKey: `c11-put-${artifactId}`,
        projectId: owner.projectId,
        actorId: owner.managerId,
        issuedAt: "2030-01-01T00:00:00.000Z",
        authorization,
        requiredCapability: "engineering-data.write",
        artifactId: `c11-${artifactId}`,
        artifactKind: "content",
        purposeCode: "engineering-data.register-external-risk-event",
        mediaType: "application/json",
        parentArtifactRefs: [],
        evidenceReferences: [],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      }),
      (async function* () {
        yield new TextEncoder().encode(content);
      })(),
    );

  const externalRiskEventCommand = (
    state: NonNullable<typeof e2eState>,
    input: {
      readonly suffix: string;
      readonly authorization: AuthorizationContextV1;
      readonly eventArtifactRef: ContentArtifactRefV1;
      readonly sourceVersionRef: SourceVersionRefV1;
      readonly sourceSegmentId: string;
      readonly externalEventKey?: string;
      readonly occurredAt?: string;
    },
  ) =>
    ({
      commandId: `c11-external-${input.suffix}`,
      idempotencyKey: `c11-external-${input.suffix}`,
      projectId: state.projectId,
      actorId: state.managerId,
      issuedAt: "2030-01-01T00:00:00.000Z",
      authorization: input.authorization,
      kind: "register-external-risk-event",
      payload: {
        externalSourceRef: { entityId: "external-monitoring-platform", versionId: "1" },
        externalEventKey: input.externalEventKey ?? `external-event-${input.suffix}`,
        eventArtifactRef: input.eventArtifactRef,
        evidenceReferences: [
          {
            locator: { sourceSegmentId: input.sourceSegmentId },
            sourceVersion: {
              entityId: input.sourceVersionRef.reference.entityId,
              versionId: input.sourceVersionRef.reference.versionId,
            },
          },
        ],
        occurredAt: input.occurredAt ?? "2029-12-31T23:00:00.000Z",
      },
    }) satisfies Extract<EngineeringDataCommandV1, { kind: "register-external-risk-event" }>;

  const externalEvidence = async (projectId: string, sourceVersionRef: SourceVersionRefV1) => {
    const rows = await fixture.postgres.adminPool.query<{
      source_segment_id: string;
      spatial_scope_refs: unknown;
    }>(
      "SELECT source_segment_id, spatial_scope_refs FROM business.source_segments WHERE project_id = $1 AND source_version_id = $2 ORDER BY source_segment_id",
      [projectId, sourceVersionRef.reference.entityId],
    );
    const segment = rows.rows[0];
    if (segment === undefined) throw new Error("external evidence segment is missing");
    return segment;
  };

  const externalRiskEventRow = async (projectId: string, entityId: string) => {
    const rows = await fixture.postgres.adminPool.query<{
      project_id: string;
      external_risk_event_ref: { reference: { entityId: string; versionId: string } };
      external_source_entity_id: string;
      external_source_version_id: string;
      external_event_key: string;
      event_artifact_ref: unknown;
      evidence_references: unknown;
      source_version_refs: unknown;
      spatial_scope_refs: unknown;
      occurred_at: Date;
      recorded_at: Date;
      actor_id: string;
      row_json: string;
    }>(
      `SELECT project_id, external_risk_event_ref, external_source_entity_id, external_source_version_id, external_event_key, event_artifact_ref, evidence_references, source_version_refs, spatial_scope_refs, occurred_at, recorded_at, actor_id, to_jsonb(e)::text AS row_json FROM business.external_risk_events e WHERE project_id = $1 AND external_risk_event_id = $2`,
      [projectId, entityId],
    );
    return rows.rows[0];
  };

  const countExternalRiskEvents = async (projectId: string) => {
    const rows = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.external_risk_events WHERE project_id = $1",
      [projectId],
    );
    return rows.rows[0]?.count;
  };

  it("loads migration 000008 and keeps C11 tables inaccessible to worker/checkpointer roles", async () => {
    const tableResult = await fixture.postgres.adminPool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'business' AND table_name IN ('engineering_projects', 'source_versions', 'source_segments', 'applicability_metadata_snapshots') ORDER BY table_name`,
    );
    expect(tableResult.rows.map((row) => row.table_name)).toEqual([
      "applicability_metadata_snapshots",
      "engineering_projects",
      "source_segments",
      "source_versions",
    ]);
    const privilegeResult = await fixture.postgres.adminPool.query<{
      app: boolean;
      worker: boolean;
      checkpointer: boolean;
    }>(
      `SELECT has_table_privilege('riskflow_app', 'business.source_versions', 'SELECT') AS app, has_table_privilege('riskflow_outbox_worker', 'business.source_versions', 'SELECT') AS worker, has_table_privilege('riskflow_checkpointer', 'business.source_versions', 'SELECT') AS checkpointer`,
    );
    expect(privilegeResult.rows[0]).toEqual({ app: true, worker: false, checkpointer: false });
    const migratorRuntime = createPostgresRuntime(fixture.postgres.migrator, "riskflow_migrator");
    try {
      // 000055 只增列/索引，000036 持有 000008 工程表外键，回退按依赖反向执行。
      await assessmentEntryCatalogCursorKeysMigration.down(migratorRuntime.db);
      await externalRiskEventRegistrationMigration.down(migratorRuntime.db);
      await contextSourceMigration.down(migratorRuntime.db);
      const dropped = await fixture.postgres.adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'business' AND table_name = 'engineering_projects'",
      );
      expect(dropped.rows[0]?.count).toBe("0");
      await contextSourceMigration.up(migratorRuntime.db);
      await externalRiskEventRegistrationMigration.up(migratorRuntime.db);
      await assessmentEntryCatalogCursorKeysMigration.up(migratorRuntime.db);
    } finally {
      await migratorRuntime.close();
    }
  });

  it("loads migration 000036, restores it through down/up, and keeps it closed to worker/checkpointer/PUBLIC roles", async () => {
    const expectedColumns = [
      "actor_id",
      "audit_entry_id",
      "authorization_context_ref",
      "catalog_cursor_key",
      "event_artifact_ref",
      "evidence_references",
      "external_event_key",
      "external_risk_event_id",
      "external_risk_event_ref",
      "external_source_entity_id",
      "external_source_ref",
      "external_source_version_id",
      "occurred_at",
      "persisted_at",
      "project_id",
      "recorded_at",
      "source_version_refs",
      "spatial_scope_refs",
      "version_id",
    ];
    const expectedConstraints = [
      "external_risk_events_audit_fk",
      "external_risk_events_identity_ck",
      "external_risk_events_identity_unique",
      "external_risk_events_json_ck",
      "external_risk_events_pkey",
      "external_risk_events_project_fk",
      "external_risk_events_ref_unique",
      "external_risk_events_source_key_unique",
    ];
    const readSchema = async () => {
      const columns = await fixture.postgres.adminPool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'business' AND table_name = 'external_risk_events'",
      );
      const constraints = await fixture.postgres.adminPool.query<{ conname: string }>(
        "SELECT conname FROM pg_constraint WHERE conrelid = 'business.external_risk_events'::regclass AND contype <> 'n'",
      );
      const privileges = await fixture.postgres.adminPool.query<{
        app_select: boolean;
        app_insert: boolean;
        app_update: boolean;
        worker_select: boolean;
        checkpointer_select: boolean;
        public_acl: string;
      }>(
        `SELECT has_table_privilege('riskflow_app', 'business.external_risk_events', 'SELECT') AS app_select, has_table_privilege('riskflow_app', 'business.external_risk_events', 'INSERT') AS app_insert, has_table_privilege('riskflow_app', 'business.external_risk_events', 'UPDATE') AS app_update, has_table_privilege('riskflow_outbox_worker', 'business.external_risk_events', 'SELECT') AS worker_select, has_table_privilege('riskflow_checkpointer', 'business.external_risk_events', 'SELECT') AS checkpointer_select, (SELECT count(*)::text FROM pg_class c, aclexplode(c.relacl) acl WHERE c.oid = 'business.external_risk_events'::regclass AND acl.grantee = 0) AS public_acl`,
      );
      return {
        columns: columns.rows.map((row) => row.column_name).sort(),
        constraints: constraints.rows.map((row) => row.conname).sort(),
        privileges: privileges.rows[0],
      };
    };
    const expectSchema = async () => {
      const schema = await readSchema();
      expect(schema.columns).toEqual(expectedColumns);
      expect(schema.constraints).toEqual(expectedConstraints);
      expect(schema.privileges).toEqual({
        app_select: true,
        app_insert: true,
        app_update: false,
        worker_select: false,
        checkpointer_select: false,
        public_acl: "0",
      });
    };
    await expectSchema();
    const migratorRuntime = createPostgresRuntime(fixture.postgres.migrator, "riskflow_migrator");
    try {
      await assessmentEntryCatalogCursorKeysMigration.down(migratorRuntime.db);
      await externalRiskEventRegistrationMigration.down(migratorRuntime.db);
      const dropped = await fixture.postgres.adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'business' AND table_name = 'external_risk_events'",
      );
      expect(dropped.rows[0]?.count).toBe("0");
      await externalRiskEventRegistrationMigration.up(migratorRuntime.db);
      await assessmentEntryCatalogCursorKeysMigration.up(migratorRuntime.db);
    } finally {
      await migratorRuntime.close();
    }
    await expectSchema();
  });

  it("discovers migration 000024 and keeps read query results read-only for service roles", async () => {
    const tableResult = await fixture.postgres.adminPool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'business' AND table_name = 'engineering_data_read_query_results'`,
    );
    expect(tableResult.rows.map((row) => row.table_name)).toEqual([
      "engineering_data_read_query_results",
    ]);
    const privilegeResult = await fixture.postgres.adminPool.query<{
      app_select: boolean;
      app_update: boolean;
      worker: boolean;
      checkpointer: boolean;
    }>(
      `SELECT has_table_privilege('riskflow_app', 'business.engineering_data_read_query_results', 'SELECT') AS app_select, has_table_privilege('riskflow_app', 'business.engineering_data_read_query_results', 'UPDATE') AS app_update, has_table_privilege('riskflow_outbox_worker', 'business.engineering_data_read_query_results', 'SELECT') AS worker, has_table_privilege('riskflow_checkpointer', 'business.engineering_data_read_query_results', 'SELECT') AS checkpointer`,
    );
    expect(privilegeResult.rows[0]).toEqual({
      app_select: true,
      app_update: false,
      worker: false,
      checkpointer: false,
    });
    const migratorRuntime = createPostgresRuntime(fixture.postgres.migrator, "riskflow_migrator");
    try {
      await readQueryResultsMigration.down(migratorRuntime.db);
      const dropped = await fixture.postgres.adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'business' AND table_name = 'engineering_data_read_query_results'",
      );
      expect(dropped.rows[0]?.count).toBe("0");
      await readQueryResultsMigration.up(migratorRuntime.db);
    } finally {
      await migratorRuntime.close();
    }
    const restored = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'business' AND table_name = 'engineering_data_read_query_results'",
    );
    expect(restored.rows[0]?.count).toBe("1");
  });

  it("keeps C02 public branches closed until their owning change is installed", async () => {
    const closedRegistry = new PostgresEngineeringContextSourceRegistry({
      db: fixture.runtime.db,
      transactionUnit: fixture.transactionUnit,
      access: fixture.access,
      artifactStore: fixture.artifactStore,
      artifactReferenceGuard: fixture.artifactRegistry,
      now: () => new Date("2030-01-01T00:00:00.000Z"),
    });
    const monitoringCommand = {
      commandId: "monitoring-command",
      idempotencyKey: "monitoring-command",
      projectId,
      actorId: "account-1",
      issuedAt: "2030-01-01T00:00:00.000Z",
      authorization,
      kind: "register-monitoring-batch" as const,
      payload: {
        monitoringSeriesRef: {
          kind: "monitoring-series" as const,
          reference: { entityId: "series-1", versionId: "1" },
        },
        deliveryKey: "delivery-1",
        sampleArtifactRef: {
          kind: "content-artifact" as const,
          reference: { entityId: "sample", versionId: "sha256:" + "a".repeat(64) },
        },
        window: { from: "2030-01-01T00:00:00.000Z", to: "2030-01-01T00:01:00.000Z" },
        relation: { kind: "original" as const },
      },
    } satisfies EngineeringDataCommandV1;
    expect(await closedRegistry.apply(monitoringCommand)).toMatchObject({
      kind: "failed",
      error: { code: "UNSUPPORTED_CONTRACT" },
    });

    const freeze = {
      commandId: "freeze-command",
      idempotencyKey: "freeze-command",
      projectId,
      actorId: "account-1",
      issuedAt: "2030-01-01T00:00:00.000Z",
      authorization: {
        ...authorization,
        grantedCapabilities: ["engineering-data.freeze" as const],
      },
      kind: "monitoring-snapshot" as const,
      payload: {
        monitoringSeriesRef: {
          kind: "monitoring-series" as const,
          reference: { entityId: "series-1", versionId: "1" },
        },
        cutoff: "2030-01-01T00:01:00.000Z",
        availabilityPolicyRef: { entityId: "availability", versionId: "1" },
      },
    } satisfies EngineeringFreezeCommandV1;
    expect(await closedRegistry.freeze(freeze)).toMatchObject({
      kind: "failed",
      error: { code: "UNSUPPORTED_CONTRACT" },
    });

    const query = {
      queryId: "source-segments-query",
      projectId,
      actorId: "account-1",
      requestedAt: "2030-01-01T00:00:00.000Z",
      authorization: { ...authorization, grantedCapabilities: ["engineering-data.read" as const] },
      kind: "source-segments" as const,
      payload: {
        sourceSegmentSetRef: {
          kind: "source-segment-set" as const,
          reference: { entityId: "set-1", versionId: "1" },
        },
      },
    } satisfies EngineeringDataQueryV1;
    const unownedQuery = {
      ...query,
      queryId: "monitoring-snapshot-query",
      kind: "monitoring-snapshot" as const,
      payload: {
        monitoringSnapshotRef: {
          kind: "monitoring-snapshot" as const,
          reference: { entityId: "snapshot-1", versionId: "1" },
        },
      },
    } satisfies EngineeringDataQueryV1;
    expect(await closedRegistry.read(unownedQuery)).toMatchObject({
      kind: "failed",
      error: { code: "UNSUPPORTED_CONTRACT" },
    });
    expect(
      await closedRegistry.read({ ...query, payload: {} } as EngineeringDataQueryV1),
    ).toMatchObject({ kind: "failed", error: { code: "UNSUPPORTED_CONTRACT" } });
    expect(await fixture.registry.read(unownedQuery)).toMatchObject({
      kind: "failed",
      error: { code: "AUTHORIZATION_DENIED" },
    });
  });

  it("does not emit C11 events for unsupported or empty fixture operations", async () => {
    const result = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM outbox.events WHERE event_type LIKE 'engineering.%'",
    );
    expect(result.rows[0]?.count).toBe("0");
  });

  it("persists context, snapshot, source delivery, access closure, and segments", async () => {
    const now = "2030-01-01T00:00:00.000Z";
    const project = "project-c11-e2e";
    const admin = await bootstrapInitialSystemAdministrator({
      connection: fixture.postgres.migrator,
      loginName: "c11-admin",
      displayName: "C11 Administrator",
      password: "c11-admin-password",
      accountId: "c11-admin-account",
      now: () => new Date(now),
    });
    expect(admin.kind).toBe("account");
    const adminLogin = await fixture.access.login({
      kind: "login",
      loginAttemptId: "c11-admin-login",
      loginName: "c11-admin",
      password: "c11-admin-password",
    });
    const adminChanged = await fixture.access.changePassword({
      kind: "change-password",
      sessionToken: adminLogin.sessionToken,
      newPassword: "c11-admin-password-changed",
    });
    const manager = await fixture.access.administerIdentity({
      kind: "create-account",
      commandId: "c11-create-manager",
      idempotencyKey: "c11-create-manager",
      expectedVersion: "none",
      authorizationContextRef: adminChanged.systemAdministrationContextRef!,
      loginName: "c11-manager",
      displayName: "C11 Manager",
      password: "c11-manager-password",
    });
    const managerLogin = await fixture.access.login({
      kind: "login",
      loginAttemptId: "c11-manager-login",
      loginName: "c11-manager",
      password: "c11-manager-password",
    });
    const managerChanged = await fixture.access.changePassword({
      kind: "change-password",
      sessionToken: managerLogin.sessionToken,
      newPassword: "c11-manager-password-changed",
    });
    await fixture.access.administerProject({
      kind: "open-project",
      projectId: project,
      commandId: "c11-open-project",
      idempotencyKey: "c11-open-project",
      expectedVersion: "none",
      authorizationContextRef: adminChanged.systemAdministrationContextRef!,
      initialRiskManagerAccountId: manager.resultRef.entityId,
    });
    const root = await fixture.postgres.adminPool.query<{ scope_id: string; revision_id: string }>(
      "SELECT scope_id, current_revision_id AS revision_id FROM business.access_spatial_scopes WHERE project_id = $1",
      [project],
    );
    const spatialScopeRef = {
      kind: "spatial-scope" as const,
      reference: { entityId: root.rows[0]!.scope_id, versionId: root.rows[0]!.revision_id },
    };
    const authorize = async (
      invocationId: string,
      requestedSourceVersionRefs: readonly {
        kind: "source-version";
        reference: { entityId: string; versionId: string };
      }[] = [],
    ) =>
      (
        await fixture.access.authorize({
          invocation: { kind: "human-session", sessionToken: managerChanged.sessionToken },
          invocationId,
          projectId: project,
          branch: "engineering-data.register-source-delivery",
          requestedSpatialScopeRefs: [spatialScopeRef],
          requestedSourceVersionRefs,
        })
      ).context;
    const projectAuthorization = await authorize("c11-project-context");
    const projectResult = await fixture.registry.reviseContext({
      commandId: "c11-project-context",
      idempotencyKey: "c11-project-context",
      projectId: project,
      actorId: manager.resultRef.entityId,
      issuedAt: now,
      authorization: projectAuthorization,
      kind: "project",
      expectedVersion: "none",
      name: "C11 工程",
      lifecycle: "preparing",
      applicabilityMetadata: {
        constructionMethod: "variable-diameter-shield",
        stratumCondition: "soft-soil",
        engineeringStage: "expansion-preparation",
      },
      effectivePeriod: { validFrom: now },
    });
    expect(projectResult).toMatchObject({
      kind: "succeeded",
      result: { kind: "project-revision" },
    });
    if (projectResult.kind !== "succeeded" || projectResult.result.kind !== "project-revision")
      return;
    const spatialAuthorization = await authorize("c11-spatial-context");
    const spatialResult = await fixture.registry.reviseContext({
      commandId: "c11-spatial-context",
      idempotencyKey: "c11-spatial-context",
      projectId: project,
      actorId: manager.resultRef.entityId,
      issuedAt: now,
      authorization: spatialAuthorization,
      kind: "spatial",
      spatialScopeRef,
      projectRevisionRef: projectResult.result.revision.projectRevisionRef,
      expectedVersion: "none",
      name: "C11 区间",
      worksiteLocation: "左线起点",
      applicabilityOverrides: { engineeringStage: "shield-expansion" },
      status: "active",
      effectivePeriod: { validFrom: now },
    });
    expect(spatialResult).toMatchObject({
      kind: "succeeded",
      result: { kind: "spatial-revision" },
    });
    if (spatialResult.kind !== "succeeded" || spatialResult.result.kind !== "spatial-revision")
      return;
    const revisedSpatialAuthorization = await authorize("c11-spatial-context-2");
    const revisedSpatialResult = await fixture.registry.reviseContext({
      commandId: "c11-spatial-context-2",
      idempotencyKey: "c11-spatial-context-2",
      projectId: project,
      actorId: manager.resultRef.entityId,
      issuedAt: now,
      authorization: revisedSpatialAuthorization,
      kind: "spatial",
      spatialScopeRef: spatialResult.result.revision.spatialScopeRef,
      projectRevisionRef: projectResult.result.revision.projectRevisionRef,
      expectedVersion: spatialResult.result.revision.spatialScopeRef.reference,
      name: "C11 区间修订",
      worksiteLocation: "左线中点",
      applicabilityOverrides: { engineeringStage: "shield-expansion" },
      status: "active",
      effectivePeriod: { validFrom: now },
    });
    expect(revisedSpatialResult).toMatchObject({
      kind: "succeeded",
      result: {
        kind: "spatial-revision",
        revision: {
          previousRevisionRef: spatialResult.result.revision.spatialScopeRef,
        },
      },
    });
    if (
      revisedSpatialResult.kind !== "succeeded" ||
      revisedSpatialResult.result.kind !== "spatial-revision"
    )
      return;
    expect(revisedSpatialResult.result.revision.spatialScopeRef).not.toEqual(
      spatialResult.result.revision.spatialScopeRef,
    );
    const businessSpatialScopeRef = revisedSpatialResult.result.revision.spatialScopeRef;
    const snapshotAuthorization = await authorize("c11-snapshot");
    const snapshotResult = await fixture.registry.createApplicabilitySnapshot({
      commandId: "c11-snapshot",
      idempotencyKey: "c11-snapshot",
      projectId: project,
      actorId: manager.resultRef.entityId,
      issuedAt: now,
      authorization: snapshotAuthorization,
      projectRevisionRef: projectResult.result.revision.projectRevisionRef,
      spatialScopeRef: businessSpatialScopeRef,
      formedAt: now,
    });
    expect(snapshotResult).toMatchObject({
      kind: "succeeded",
      result: {
        kind: "applicability-snapshot",
        snapshot: { applicabilityMetadata: { engineeringStage: "shield-expansion" } },
      },
    });
    if (
      snapshotResult.kind !== "succeeded" ||
      snapshotResult.result.kind !== "applicability-snapshot"
    )
      return;

    const sourceAuthorization = await authorize("c11-source-delivery");
    const put = async (id: string, content: string, mediaType: string) =>
      fixture.artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: `c11-put-${id}`,
          idempotencyKey: `c11-put-${id}`,
          projectId: project,
          actorId: manager.resultRef.entityId,
          issuedAt: now,
          authorization: sourceAuthorization,
          requiredCapability: "engineering-data.write",
          artifactId: `c11-${id}`,
          artifactKind: "content",
          purposeCode: "engineering-data.register-source-delivery",
          mediaType,
          parentArtifactRefs: [],
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        (async function* () {
          yield new TextEncoder().encode(content);
        })(),
      );
    const sourceArtifact = await put("source", "source body", "text/plain");
    const metadata = {
      schemaVersion: "1" as const,
      projectRevisionRef: projectResult.result.revision.projectRevisionRef,
      spatialScopeRefs: [businessSpatialScopeRef],
      registeredByAccountId: manager.resultRef.entityId,
      sourceItemId: "c11-source-item",
      sourceItemName: "施工方案",
      sourceCategory: "engineering-document",
      sourceMetadata: { documentType: "施工方案", formedAt: now, sourceOrganization: "甲方" },
      descriptor: { kind: "file-upload" as const, contentFingerprint: "source body" },
      applicabilityMetadataSnapshotRef: snapshotResult.result.snapshot.snapshotRef,
    };
    const metadataArtifact = await put("metadata", JSON.stringify(metadata), "application/json");
    const deliveryCommand = {
      commandId: "c11-source-delivery",
      idempotencyKey: "c11-source-delivery",
      projectId: project,
      actorId: manager.resultRef.entityId,
      issuedAt: now,
      authorization: sourceAuthorization,
      kind: "register-source-delivery",
      payload: {
        sourceConnectionRef: { entityId: "file-upload", versionId: "1" },
        deliveryKey: "c11-delivery",
        sourceArtifactRef: sourceArtifact.artifactRef,
        metadataArtifactRef: metadataArtifact.artifactRef,
        occurredAt: now,
      },
    } satisfies Extract<EngineeringDataCommandV1, { kind: "register-source-delivery" }>;
    const delivery = await fixture.registry.apply(deliveryCommand);
    expect(delivery.kind).toBe("succeeded");
    if (delivery.kind !== "succeeded") return;
    const sourceVersionRef = delivery.result.sourceVersionRef;
    const sourceId = sourceVersionRef.reference.entityId;
    const sourceSegmentsAuthorization = await authorize("c11-source-segments", [sourceVersionRef]);
    const segments = await fixture.registry.registerSegments({
      commandId: "c11-source-segments",
      idempotencyKey: "c11-source-segments",
      projectId: project,
      actorId: manager.resultRef.entityId,
      issuedAt: now,
      authorization: sourceSegmentsAuthorization,
      sourceVersionRef,
      sourceId,
      segments: [
        {
          sourceSegmentId: `${sourceId}-chapter_1-segment_1` as never,
          chapterId: "chapter_1",
          segmentId: "segment_1",
          kind: "chapter",
          spatialScopeRefs: [businessSpatialScopeRef],
          locator: { kind: "document", pageNumber: 1, headingPath: ["施工方案"] },
        },
        {
          sourceSegmentId: `${sourceId}-chapter_2-segment_1` as never,
          chapterId: "chapter_2",
          segmentId: "segment_1",
          kind: "chapter",
          spatialScopeRefs: [businessSpatialScopeRef],
          locator: { kind: "document", pageNumber: 3, headingPath: ["风险源"] },
        },
      ],
    });
    expect(segments).toMatchObject({ kind: "succeeded", result: { kind: "source-segment-set" } });
    if (segments.kind !== "succeeded" || segments.result.kind !== "source-segment-set") return;
    const persisted = await fixture.postgres.adminPool.query<{
      access_status: string;
      segment_count: string;
    }>(
      "SELECT v.access_status, (SELECT count(*)::text FROM business.source_segments s WHERE s.source_version_id = v.source_version_id) AS segment_count FROM business.source_versions v WHERE v.source_version_id = $1",
      [sourceId],
    );
    expect(persisted.rows[0]).toEqual({ access_status: "ready", segment_count: "2" });
    e2eState = {
      projectId: project,
      managerId: manager.resultRef.entityId,
      adminContextRef: adminChanged.systemAdministrationContextRef!,
      projectRevisionRef: projectResult.result.revision.projectRevisionRef,
      sourceVersionRef,
      businessSpatialScopeRef,
      accessRootScopeRef: spatialScopeRef,
      systemAdministrationContextRef: adminChanged.systemAdministrationContextRef!,
      managerSessionToken: managerChanged.sessionToken,
      snapshotRef: snapshotResult.result.snapshot.snapshotRef,
      metadataArtifactRef: metadataArtifact.artifactRef,
      deliveryCommand,
      segmentSetRef: segments.result.segmentSet.sourceSegmentSetRef,
      segmentIds: [...segments.result.segmentSet.segments]
        .map((segment) => segment.sourceSegmentId as string)
        .sort(),
      authorize: async (
        invocationId: string,
        requestedSourceVersionRefs: readonly SourceVersionRefV1[] = [],
        branch:
          | "engineering-data.register-source-delivery"
          | "engineering-data.register-external-risk-event"
          | "engineering-data.evidence-access"
          | "engineering-data.source-segments"
          | "engineering-data.context-read" = "engineering-data.register-source-delivery",
        requestedSpatialScopeRefs: readonly SpatialScopeRefV1[] = [spatialScopeRef],
      ) =>
        (
          await fixture.access.authorize({
            invocation: { kind: "human-session", sessionToken: managerChanged.sessionToken },
            invocationId,
            projectId: project,
            branch,
            requestedSpatialScopeRefs,
            requestedSourceVersionRefs,
          })
        ).context,
    };
  });

  it("registers an immutable external risk event bound to project, source, evidence and spatial scope", async () => {
    const state = requireE2eState();
    const evidence = await externalEvidence(state.projectId, state.sourceVersionRef);
    const authorization = await state.authorize(
      "c11-external-register",
      [state.sourceVersionRef],
      "engineering-data.register-external-risk-event",
    );
    const eventBody = JSON.stringify({ eventType: "support-pressure-alarm", value: 1.25 });
    const eventArtifact = await putExternalEventArtifact(
      state,
      "external-event",
      eventBody,
      authorization,
    );
    const command = externalRiskEventCommand(state, {
      suffix: "register",
      authorization,
      eventArtifactRef: eventArtifact.artifactRef,
      sourceVersionRef: state.sourceVersionRef,
      sourceSegmentId: evidence.source_segment_id,
    });
    const result = await fixture.registry.apply(command);
    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded") return;
    const externalRiskEventRef = result.result.externalRiskEventRef;
    expect(result.result.kind).toBe("register-external-risk-event");
    expect(externalRiskEventRef.kind).toBe("external-risk-event");
    expect(externalRiskEventRef.reference.versionId).toBe("1");

    // C25 selects the risk input XOR external branch with this exact reference and nothing else.
    expect(RiskInputVersionRefV1Schema.safeParse(externalRiskEventRef).success).toBe(true);
    expect(StandardizedRiskRecordRefV1Schema.safeParse(externalRiskEventRef).success).toBe(false);

    const row = await externalRiskEventRow(
      state.projectId,
      externalRiskEventRef.reference.entityId,
    );
    expect(row).toMatchObject({
      project_id: state.projectId,
      external_risk_event_ref: externalRiskEventRef,
      external_source_entity_id: command.payload.externalSourceRef.entityId,
      external_source_version_id: command.payload.externalSourceRef.versionId,
      external_event_key: command.payload.externalEventKey,
      event_artifact_ref: command.payload.eventArtifactRef,
      evidence_references: command.payload.evidenceReferences,
      source_version_refs: [
        {
          kind: "source-version",
          reference: {
            entityId: state.sourceVersionRef.reference.entityId,
            versionId: "1",
          },
        },
      ],
      spatial_scope_refs: evidence.spatial_scope_refs,
      actor_id: state.managerId,
    });
    expect(row?.occurred_at.toISOString()).toBe(command.payload.occurredAt);
    expect(row?.recorded_at.toISOString()).toBe(command.issuedAt);
    expect(row?.row_json).not.toContain("support-pressure-alarm");
    expect(row?.row_json).not.toContain(eventBody);

    const receipt = await fixture.postgres.adminPool.query<{
      command_kind: string;
      result_ref: unknown;
      completed: boolean;
    }>(
      "SELECT command_kind, result_ref, (completed_at IS NOT NULL) AS completed FROM business.command_receipts WHERE project_id = $1 AND idempotency_key = $2",
      [state.projectId, command.idempotencyKey],
    );
    expect(receipt.rows).toEqual([
      {
        command_kind: "engineering-data.register-external-risk-event.v1",
        result_ref: externalRiskEventRef,
        completed: true,
      },
    ]);
    const audit = await fixture.postgres.adminPool.query<{
      action: string;
      target_ref: unknown;
      actor_ref: string;
      command_id: string;
    }>(
      "SELECT action, target_ref, actor_ref, command_id FROM audit.entries WHERE project_id = $1 AND command_id = $2",
      [state.projectId, command.commandId],
    );
    expect(audit.rows).toEqual([
      {
        action: "engineering-data.register-external-risk-event",
        target_ref: externalRiskEventRef,
        actor_ref: state.managerId,
        command_id: command.commandId,
      },
    ]);

    const outbox = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM outbox.events WHERE producer_command_id = $1",
      [command.commandId],
    );
    expect(outbox.rows[0]?.count).toBe("0");

    const replay = await fixture.registry.apply(command);
    expect(replay).toEqual(result);
    expect(await countExternalRiskEvents(state.projectId)).toBe("1");
    const replayAudit = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit.entries WHERE project_id = $1 AND command_id = $2",
      [state.projectId, command.commandId],
    );
    expect(replayAudit.rows[0]?.count).toBe("1");

    const conflict = await fixture.registry.apply({
      ...command,
      payload: { ...command.payload, occurredAt: "2029-12-31T22:00:00.000Z" },
    });
    expect(conflict).toMatchObject({ kind: "failed", error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(
      (
        await externalRiskEventRow(state.projectId, externalRiskEventRef.reference.entityId)
      )?.occurred_at.toISOString(),
    ).toBe(command.payload.occurredAt);

    const overwriteAuthorization = await state.authorize(
      "c11-external-overwrite",
      [state.sourceVersionRef],
      "engineering-data.register-external-risk-event",
    );
    const overwriteArtifact = await putExternalEventArtifact(
      state,
      "external-event-overwrite",
      JSON.stringify({ eventType: "overwritten" }),
      overwriteAuthorization,
    );
    const overwrite = await fixture.registry.apply(
      externalRiskEventCommand(state, {
        suffix: "overwrite",
        authorization: overwriteAuthorization,
        eventArtifactRef: overwriteArtifact.artifactRef,
        sourceVersionRef: state.sourceVersionRef,
        sourceSegmentId: evidence.source_segment_id,
        externalEventKey: command.payload.externalEventKey,
        occurredAt: "2029-12-30T10:00:00.000Z",
      }),
    );
    expect(overwrite).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    expect(await countExternalRiskEvents(state.projectId)).toBe("1");
    const unchanged = await externalRiskEventRow(
      state.projectId,
      externalRiskEventRef.reference.entityId,
    );
    expect(unchanged?.event_artifact_ref).toEqual(command.payload.eventArtifactRef);
    expect(unchanged?.occurred_at.toISOString()).toBe(command.payload.occurredAt);
  });

  it("hides missing, unauthorized, not-ready and out-of-scope event targets behind one denial", async () => {
    const state = requireE2eState();
    const before = await countExternalRiskEvents(state.projectId);
    const covered = await state.authorize(
      "c11-external-denied",
      [state.sourceVersionRef],
      "engineering-data.register-external-risk-event",
    );
    const eventArtifact = await putExternalEventArtifact(
      state,
      "external-event-denied",
      JSON.stringify({ eventType: "denied" }),
      covered,
    );
    const evidence = await externalEvidence(state.projectId, state.sourceVersionRef);
    const missingSourceVersionRef: SourceVersionRefV1 = {
      kind: "source-version",
      reference: { entityId: "c11-missing-source-version", versionId: "1" },
    };
    const mismatchedSourceVersionRef: SourceVersionRefV1 = {
      ...state.sourceVersionRef,
      reference: { ...state.sourceVersionRef.reference, versionId: "2" },
    };
    const uncovered = await state.authorize(
      "c11-external-denied-uncovered",
      [],
      "engineering-data.register-external-risk-event",
    );
    const missingArtifactRef: ContentArtifactRefV1 = {
      kind: "content-artifact",
      reference: { entityId: "c11-missing-external-event", versionId: `sha256:${"d".repeat(64)}` },
    };
    // A real artifact owned by another project must be indistinguishable from a missing one.
    const otherProjectId = "project-c11-external-other";
    await fixture.access.administerProject({
      kind: "open-project",
      projectId: otherProjectId,
      commandId: "c11-external-other-project",
      idempotencyKey: "c11-external-other-project",
      expectedVersion: "none",
      authorizationContextRef: state.systemAdministrationContextRef,
      initialRiskManagerAccountId: state.managerId,
    });
    const otherRoot = await fixture.postgres.adminPool.query<{
      scope_id: string;
      revision_id: string;
    }>(
      "SELECT scope_id, current_revision_id AS revision_id FROM business.access_spatial_scopes WHERE project_id = $1",
      [otherProjectId],
    );
    const otherAuthorization = (
      await fixture.access.authorize({
        invocation: { kind: "human-session", sessionToken: state.managerSessionToken },
        invocationId: "c11-external-other-project",
        projectId: otherProjectId,
        branch: "engineering-data.register-external-risk-event",
        requestedSpatialScopeRefs: [
          {
            kind: "spatial-scope",
            reference: {
              entityId: otherRoot.rows[0]!.scope_id,
              versionId: otherRoot.rows[0]!.revision_id,
            },
          },
        ],
        requestedSourceVersionRefs: [],
      })
    ).context;
    const otherProjectArtifact = await putExternalEventArtifact(
      { projectId: otherProjectId, managerId: state.managerId },
      "external-event-other-project",
      JSON.stringify({ eventType: "other-project" }),
      otherAuthorization,
    );
    const crossProjectSourceAuthorization = (
      await fixture.access.authorize({
        invocation: { kind: "human-session", sessionToken: state.managerSessionToken },
        invocationId: "c11-external-denied-cross-project-source",
        projectId: otherProjectId,
        branch: "engineering-data.register-external-risk-event",
        requestedSpatialScopeRefs: [
          {
            kind: "spatial-scope",
            reference: {
              entityId: otherRoot.rows[0]!.scope_id,
              versionId: otherRoot.rows[0]!.revision_id,
            },
          },
        ],
        requestedSourceVersionRefs: [],
      })
    ).context;

    // A delivery whose access closure fails leaves a real pending-access source version with a
    // registered source access policy, so the external branch must reject it as not ready.
    const notReadyDelivery = await createDelivery("external-not-ready");
    const pendingAccessRegistry = new PostgresEngineeringContextSourceRegistry({
      db: fixture.runtime.db,
      transactionUnit: fixture.transactionUnit,
      access: {
        verify: fixture.access.verify.bind(fixture.access),
        administerProject: async (command: never) => {
          await fixture.access.administerProject(command);
          throw new Error("forced access closure failure after source access policy creation");
        },
      } as unknown as typeof fixture.access,
      artifactStore: fixture.artifactStore,
      artifactReferenceGuard: fixture.artifactRegistry,
      now: () => new Date("2030-01-01T00:00:00.000Z"),
    });
    const notReadyApply = await pendingAccessRegistry.apply(notReadyDelivery.command);
    expect(notReadyApply).toMatchObject({ kind: "failed" });
    const pendingSourceVersion = await fixture.postgres.adminPool.query<{
      source_version_id: string;
      access_status: string;
    }>(
      `SELECT v.source_version_id, v.access_status
       FROM business.source_versions v
       JOIN business.source_deliveries d
         ON d.source_delivery_id = v.source_delivery_id AND d.project_id = v.project_id
       WHERE d.project_id = $1 AND d.delivery_key = $2`,
      [state.projectId, notReadyDelivery.command.payload.deliveryKey],
    );
    expect(pendingSourceVersion.rows).toEqual([
      { source_version_id: expect.any(String), access_status: "pending-access" },
    ]);
    const notReadySourceVersionRef: SourceVersionRefV1 = {
      kind: "source-version",
      reference: { entityId: pendingSourceVersion.rows[0]!.source_version_id, versionId: "1" },
    };
    const notReadyAuthorization = await state.authorize(
      "c11-external-denied-not-ready",
      [notReadySourceVersionRef],
      "engineering-data.register-external-risk-event",
    );
    const notReadyArtifact = await putExternalEventArtifact(
      state,
      "external-event-not-ready",
      JSON.stringify({ eventType: "not-ready" }),
      notReadyAuthorization,
    );

    const childScopeId = "c11-external-child-scope";
    await fixture.access.administerProject({
      kind: "create-spatial-scope",
      projectId: state.projectId,
      commandId: "c11-external-child-scope",
      idempotencyKey: "c11-external-child-scope",
      expectedVersion: "none",
      authorizationContextRef: (await state.authorize("c11-external-child-scope-actor"))
        .authorizationContextRef,
      scopeId: childScopeId,
      parentScopeRef: state.accessRootScopeRef,
    });
    const childScopeRevision = await fixture.postgres.adminPool.query<{ revision_id: string }>(
      "SELECT current_revision_id AS revision_id FROM business.access_spatial_scopes WHERE project_id = $1 AND scope_id = $2",
      [state.projectId, childScopeId],
    );
    const childAccessScopeRef: SpatialScopeRefV1 = {
      kind: "spatial-scope",
      reference: { entityId: childScopeId, versionId: childScopeRevision.rows[0]!.revision_id },
    };
    const childBusinessScopeRef: SpatialScopeRefV1 = {
      kind: "spatial-scope",
      reference: { entityId: childScopeId, versionId: "1" },
    };
    // The child scope exists as a real C11 spatial scope, so evidence may legally belong to it
    // while an external registration authorization that only covers the root scope cannot include it.
    const childContext = await fixture.registry.reviseContext({
      commandId: "c11-external-child-scope-context",
      idempotencyKey: "c11-external-child-scope-context",
      projectId: state.projectId,
      actorId: state.managerId,
      issuedAt: "2030-01-01T00:00:00.000Z",
      authorization: await state.authorize(
        "c11-external-child-scope-context",
        [],
        "engineering-data.register-source-delivery",
        [childAccessScopeRef],
      ),
      kind: "spatial",
      spatialScopeRef: childBusinessScopeRef,
      projectRevisionRef: state.projectRevisionRef,
      expectedVersion: "none",
      name: "外部事件子区段",
      worksiteLocation: "左线子区段",
      applicabilityOverrides: { engineeringStage: "shield-expansion" },
      status: "active",
      effectivePeriod: { validFrom: "2030-01-01T00:00:00.000Z" },
    });
    expect(childContext).toMatchObject({ kind: "succeeded", result: { kind: "spatial-revision" } });
    const childSnapshot = await fixture.registry.createApplicabilitySnapshot({
      commandId: "c11-external-child-scope-snapshot",
      idempotencyKey: "c11-external-child-scope-snapshot",
      projectId: state.projectId,
      actorId: state.managerId,
      issuedAt: "2030-01-01T00:00:00.000Z",
      authorization: await state.authorize(
        "c11-external-child-scope-snapshot",
        [],
        "engineering-data.register-source-delivery",
        [childAccessScopeRef],
      ),
      projectRevisionRef: state.projectRevisionRef,
      spatialScopeRef: childBusinessScopeRef,
      formedAt: "2030-01-01T00:00:00.000Z",
    });
    expect(childSnapshot).toMatchObject({
      kind: "succeeded",
      result: { kind: "applicability-snapshot" },
    });
    if (
      childSnapshot.kind !== "succeeded" ||
      childSnapshot.result.kind !== "applicability-snapshot"
    )
      return;
    const outside = await createDelivery("external-outside-scope", {
      spatialScopeRefs: [childBusinessScopeRef],
      authorizationSpatialScopeRefs: [childAccessScopeRef],
      applicabilityMetadataSnapshotRef: childSnapshot.result.snapshot.snapshotRef,
    });
    const outsideDelivery = await fixture.registry.apply(outside.command);
    expect(outsideDelivery.kind).toBe("succeeded");
    if (outsideDelivery.kind !== "succeeded") return;
    const outsideSourceVersionRef = outsideDelivery.result.sourceVersionRef;
    const outsideSegments = await fixture.registry.registerSegments({
      commandId: "c11-external-outside-scope-segments",
      idempotencyKey: "c11-external-outside-scope-segments",
      projectId: state.projectId,
      actorId: state.managerId,
      issuedAt: "2030-01-01T00:00:00.000Z",
      authorization: await state.authorize(
        "c11-external-outside-scope-segments",
        [outsideSourceVersionRef],
        "engineering-data.register-source-delivery",
        [childAccessScopeRef],
      ),
      sourceVersionRef: outsideSourceVersionRef,
      sourceId: outsideSourceVersionRef.reference.entityId,
      segments: [
        {
          sourceSegmentId:
            `${outsideSourceVersionRef.reference.entityId}-child_1-segment_1` as never,
          chapterId: "child_1",
          segmentId: "segment_1",
          kind: "chapter",
          spatialScopeRefs: [childBusinessScopeRef],
          locator: { kind: "document", pageNumber: 1, headingPath: ["外部证据"] },
        },
      ],
    });
    expect(outsideSegments).toMatchObject({ kind: "succeeded" });
    const outsideEvidence = await externalEvidence(state.projectId, outsideSourceVersionRef);
    const rootOnlyAuthorization = await state.authorize(
      "c11-external-denied-spatial-scope",
      [outsideSourceVersionRef],
      "engineering-data.register-external-risk-event",
    );
    const outsideArtifact = await putExternalEventArtifact(
      state,
      "external-event-outside-scope",
      JSON.stringify({ eventType: "outside-scope" }),
      rootOnlyAuthorization,
    );
    const expiredAuthorization = await state.authorize(
      "c11-external-denied-expired",
      [state.sourceVersionRef],
      "engineering-data.register-external-risk-event",
    );
    const expiredArtifact = await putExternalEventArtifact(
      state,
      "external-event-expired",
      JSON.stringify({ eventType: "expired-authorization" }),
      expiredAuthorization,
    );
    await fixture.postgres.adminPool.query(
      "UPDATE business.authorization_contexts SET decided_at = $1, expires_at = $2 WHERE context_id = $3 AND version_id = $4",
      [
        "2029-12-31T23:58:00.000Z",
        "2029-12-31T23:59:00.000Z",
        expiredAuthorization.authorizationContextRef.reference.entityId,
        expiredAuthorization.authorizationContextRef.reference.versionId,
      ],
    );

    const attempts: [string, EngineeringDataCommandV1][] = [
      [
        "missing event artifact",
        externalRiskEventCommand(state, {
          suffix: "denied-artifact",
          authorization: await state.authorize(
            "c11-external-denied-artifact",
            [state.sourceVersionRef],
            "engineering-data.register-external-risk-event",
          ),
          eventArtifactRef: missingArtifactRef,
          sourceVersionRef: state.sourceVersionRef,
          sourceSegmentId: evidence.source_segment_id,
        }),
      ],
      [
        "event artifact belongs to another project",
        externalRiskEventCommand(state, {
          suffix: "denied-cross-project-artifact",
          authorization: await state.authorize(
            "c11-external-denied-cross-project-artifact",
            [state.sourceVersionRef],
            "engineering-data.register-external-risk-event",
          ),
          eventArtifactRef: otherProjectArtifact.artifactRef,
          sourceVersionRef: state.sourceVersionRef,
          sourceSegmentId: evidence.source_segment_id,
        }),
      ],
      [
        "evidence source version belongs to another project",
        {
          ...externalRiskEventCommand(state, {
            suffix: "denied-cross-project-source",
            authorization: crossProjectSourceAuthorization,
            eventArtifactRef: otherProjectArtifact.artifactRef,
            sourceVersionRef: state.sourceVersionRef,
            sourceSegmentId: evidence.source_segment_id,
          }),
          projectId: otherProjectId,
          authorization: crossProjectSourceAuthorization,
        },
      ],
      [
        "authorization does not cover the evidence source version",
        externalRiskEventCommand(state, {
          suffix: "denied-uncovered",
          authorization: uncovered,
          eventArtifactRef: eventArtifact.artifactRef,
          sourceVersionRef: state.sourceVersionRef,
          sourceSegmentId: evidence.source_segment_id,
        }),
      ],
      [
        "evidence source version does not exist",
        externalRiskEventCommand(state, {
          suffix: "denied-source-version",
          authorization: await state.authorize(
            "c11-external-denied-source-version",
            [state.sourceVersionRef],
            "engineering-data.register-external-risk-event",
          ),
          eventArtifactRef: eventArtifact.artifactRef,
          sourceVersionRef: missingSourceVersionRef,
          sourceSegmentId: evidence.source_segment_id,
        }),
      ],
      [
        "evidence source version does not match the authorized exact version",
        externalRiskEventCommand(state, {
          suffix: "denied-source-version-mismatch",
          authorization: await state.authorize(
            "c11-external-denied-source-version-mismatch",
            [state.sourceVersionRef],
            "engineering-data.register-external-risk-event",
          ),
          eventArtifactRef: eventArtifact.artifactRef,
          sourceVersionRef: mismatchedSourceVersionRef,
          sourceSegmentId: evidence.source_segment_id,
        }),
      ],
      [
        "evidence segment does not exist",
        externalRiskEventCommand(state, {
          suffix: "denied-segment",
          authorization: await state.authorize(
            "c11-external-denied-segment",
            [state.sourceVersionRef],
            "engineering-data.register-external-risk-event",
          ),
          eventArtifactRef: eventArtifact.artifactRef,
          sourceVersionRef: state.sourceVersionRef,
          sourceSegmentId: "c11-missing-segment-1",
        }),
      ],
      [
        "evidence segment belongs to another source version",
        externalRiskEventCommand(state, {
          suffix: "denied-segment-source-mismatch",
          authorization: await state.authorize(
            "c11-external-denied-segment-source-mismatch",
            [state.sourceVersionRef],
            "engineering-data.register-external-risk-event",
          ),
          eventArtifactRef: eventArtifact.artifactRef,
          sourceVersionRef: state.sourceVersionRef,
          sourceSegmentId: outsideEvidence.source_segment_id,
        }),
      ],
      [
        "evidence source version is not ready",
        externalRiskEventCommand(state, {
          suffix: "denied-not-ready",
          authorization: notReadyAuthorization,
          eventArtifactRef: notReadyArtifact.artifactRef,
          sourceVersionRef: notReadySourceVersionRef,
          sourceSegmentId: notReadySourceVersionRef.reference.entityId,
        }),
      ],
      [
        "authorization context is expired",
        externalRiskEventCommand(state, {
          suffix: "denied-expired",
          authorization: expiredAuthorization,
          eventArtifactRef: expiredArtifact.artifactRef,
          sourceVersionRef: state.sourceVersionRef,
          sourceSegmentId: evidence.source_segment_id,
        }),
      ],
      [
        "evidence spatial scope is outside the authorization",
        externalRiskEventCommand(state, {
          suffix: "denied-spatial-scope",
          authorization: rootOnlyAuthorization,
          eventArtifactRef: outsideArtifact.artifactRef,
          sourceVersionRef: outsideSourceVersionRef,
          sourceSegmentId: outsideEvidence.source_segment_id,
        }),
      ],
    ];
    for (const [label, command] of attempts) {
      const result = await fixture.registry.apply(command);
      expect(result.kind, label).toBe("failed");
      if (result.kind !== "failed") continue;
      expect(result.error.code, label).toBe("AUTHORIZATION_DENIED");
      expect(result.error.category, label).toBe("authorization");
      expect((result.error as { targetRef?: unknown }).targetRef, label).toBeUndefined();
      expect(result.error, label).not.toHaveProperty("message");
    }
    expect(await countExternalRiskEvents(state.projectId)).toBe(before);
    const deniedIds = attempts.map(([, command]) => command.commandId);
    const deniedReceipts = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.command_receipts WHERE project_id = $1 AND command_kind = $2 AND command_id = ANY($3)",
      [state.projectId, "engineering-data.register-external-risk-event.v1", deniedIds],
    );
    expect(deniedReceipts.rows[0]?.count).toBe("0");
    const deniedAudit = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit.entries WHERE project_id = $1 AND command_id = ANY($2)",
      [state.projectId, deniedIds],
    );
    expect(deniedAudit.rows[0]?.count).toBe("0");
  });

  it("reports event artifact integrity failures as technical and rolls back the command", async () => {
    const state = requireE2eState();
    const before = await countExternalRiskEvents(state.projectId);
    const evidence = await externalEvidence(state.projectId, state.sourceVersionRef);
    const authorization = await state.authorize(
      "c11-external-integrity",
      [state.sourceVersionRef],
      "engineering-data.register-external-risk-event",
    );
    const eventArtifact = await putExternalEventArtifact(
      state,
      "external-event-integrity",
      JSON.stringify({ eventType: "integrity-failure" }),
      authorization,
    );
    const command = externalRiskEventCommand(state, {
      suffix: "integrity",
      authorization,
      eventArtifactRef: eventArtifact.artifactRef,
      sourceVersionRef: state.sourceVersionRef,
      sourceSegmentId: evidence.source_segment_id,
    });
    const manifest = await fixture.postgres.adminPool.query<{ manifest_sha256: string }>(
      "SELECT manifest_sha256 FROM business.artifact_manifests WHERE project_id = $1 AND artifact_id = $2 AND version_id = $3",
      [
        state.projectId,
        eventArtifact.artifactRef.reference.entityId,
        eventArtifact.artifactRef.reference.versionId,
      ],
    );
    await fixture.postgres.adminPool.query(
      "UPDATE business.artifact_manifests SET manifest_sha256 = $1 WHERE project_id = $2 AND artifact_id = $3 AND version_id = $4",
      [
        "0".repeat(64),
        state.projectId,
        eventArtifact.artifactRef.reference.entityId,
        eventArtifact.artifactRef.reference.versionId,
      ],
    );
    let result: EngineeringDataApplyResultV1;
    try {
      result = await fixture.registry.apply(command);
    } finally {
      await fixture.postgres.adminPool.query(
        "UPDATE business.artifact_manifests SET manifest_sha256 = $1 WHERE project_id = $2 AND artifact_id = $3 AND version_id = $4",
        [
          manifest.rows[0]!.manifest_sha256,
          state.projectId,
          eventArtifact.artifactRef.reference.entityId,
          eventArtifact.artifactRef.reference.versionId,
        ],
      );
    }
    expect(result!).toMatchObject({
      kind: "failed",
      error: { code: "TERMINAL_FAILURE", category: "technical", retryable: false },
    });
    expect(await countExternalRiskEvents(state.projectId)).toBe(before);
    const receiptAndAudit = await fixture.postgres.adminPool.query<{
      receipts: string;
      audits: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM business.command_receipts WHERE project_id = $1 AND command_kind = $2 AND idempotency_key = $3) AS receipts,
         (SELECT count(*)::text FROM audit.entries WHERE project_id = $1 AND command_id = $4) AS audits`,
      [
        state.projectId,
        "engineering-data.register-external-risk-event.v1",
        command.idempotencyKey,
        command.commandId,
      ],
    );
    expect(receiptAndAudit.rows[0]).toEqual({ receipts: "0", audits: "0" });
  });

  it("rolls back the external risk event registration when the audit append fails and allows retry", async () => {
    const state = requireE2eState();
    const before = await countExternalRiskEvents(state.projectId);
    const evidence = await externalEvidence(state.projectId, state.sourceVersionRef);
    const authorization = await state.authorize(
      "c11-external-audit-rollback",
      [state.sourceVersionRef],
      "engineering-data.register-external-risk-event",
    );
    const eventArtifact = await putExternalEventArtifact(
      state,
      "external-event-audit-rollback",
      JSON.stringify({ eventType: "audit-rollback" }),
      authorization,
    );
    const command = externalRiskEventCommand(state, {
      suffix: "audit-rollback",
      authorization,
      eventArtifactRef: eventArtifact.artifactRef,
      sourceVersionRef: state.sourceVersionRef,
      sourceSegmentId: evidence.source_segment_id,
    });
    await fixture.postgres.adminPool.query(
      "REVOKE INSERT ON TABLE audit.entries FROM riskflow_app",
    );
    let failed: EngineeringDataApplyResultV1;
    try {
      failed = await fixture.registry.apply(command);
    } finally {
      await fixture.postgres.adminPool.query("GRANT INSERT ON TABLE audit.entries TO riskflow_app");
    }
    expect(failed!).toMatchObject({ kind: "failed" });
    expect(await countExternalRiskEvents(state.projectId)).toBe(before);

    const retry = await fixture.registry.apply(command);
    expect(retry).toMatchObject({
      kind: "succeeded",
      result: { kind: "register-external-risk-event" },
    });
    expect(await countExternalRiskEvents(state.projectId)).toBe(String(Number(before) + 1));
  });

  it("persists and replays a C12 conversion through PostgreSQL", async () => {
    const state = requireE2eState();
    const { command: deliveryCommand } = await createDelivery("c12-conversion", {
      sourceContent: "指标,备注\n盾构,稳定\n",
      mediaType: "text/csv",
      spatialScopeRefs: [state.businessSpatialScopeRef],
    });
    const delivery = await fixture.registry.apply(deliveryCommand);
    expect(delivery).toMatchObject({ kind: "succeeded" });
    if (delivery.kind !== "succeeded") return;
    const sourceVersionRef = delivery.result.sourceVersionRef;
    const authorization = await state.authorize("c12-conversion-record", [sourceVersionRef]);
    const conversion = StructuredDocumentConversionCommandV1Schema.parse({
      schemaVersion: "1",
      conversionId: "c12-conversion-record",
      idempotencyKey: "c12-conversion-idempotency",
      runId: "c12-run",
      threadId: "c12-thread",
      issuedAt: "2030-01-01T00:00:00.000Z",
      deadlineAt: "2030-01-01T01:00:00.000Z",
      projectId: state.projectId,
      actorId: state.managerId,
      authorization,
      sourceVersionRef,
      sourceArtifactRef: deliveryCommand.payload.sourceArtifactRef,
      mediaType: "text/csv",
      input: { kind: "csv" },
      conversionPolicyRef: { entityId: "document-conversion-policy", versionId: "1" },
      qualityPolicyRef: { entityId: "quality-policy", versionId: "v1" },
      converterDeploymentRef: { entityId: "converter", versionId: "v1" },
    });
    let failCommit = true;
    const adapter = new StructuredDocumentConversionAdapter({
      db: fixture.runtime.db,
      transactionUnit: {
        async execute(command, handler) {
          if (failCommit) {
            failCommit = false;
            throw new Error("temporary conversion storage outage");
          }
          return fixture.transactionUnit.execute(command, handler);
        },
      },
      contextSource: fixture.registry,
      artifactStore: fixture.artifactStore,
      qualityPolicyRef: conversion.qualityPolicyRef,
      converterDeploymentRef: conversion.converterDeploymentRef,
    });
    expect(await adapter.convert(conversion)).toMatchObject({
      kind: "failed",
      error: { code: "TRANSIENT_FAILURE", retryable: true },
    });
    const first = await adapter.convert(conversion);
    expect(first).toMatchObject({ kind: "succeeded" });
    const second = await adapter.convert(conversion);
    expect(second).toEqual(first);
    const conflict = await adapter.convert({ ...conversion, runId: "different-run" });
    expect(conflict).toMatchObject({ kind: "failed", error: { code: "IDEMPOTENCY_CONFLICT" } });
    const persisted = await fixture.postgres.adminPool.query<{
      status: string;
      run_id: string;
      thread_id: string;
    }>(
      "SELECT status, run_id, thread_id FROM business.structured_document_conversions WHERE project_id = $1 AND conversion_id = $2",
      [state.projectId, conversion.conversionId],
    );
    expect(persisted.rows).toEqual([
      { status: "succeeded", run_id: "c12-run", thread_id: "c12-thread" },
    ]);
    if (first.kind !== "succeeded") return;
    const readAuthorization = await state.authorize(
      "c12-read",
      [sourceVersionRef],
      "engineering-data.evidence-access",
    );
    const readQuery = StructuredDocumentConversionQueryV1Schema.parse({
      schemaVersion: "1",
      queryId: "c12-read",
      projectId: state.projectId,
      actorId: state.managerId,
      requestedAt: "2030-01-01T01:00:00.000Z",
      authorization: readAuthorization,
      conversionRef: first.result.conversionRef,
    });
    const read = await adapter.read(readQuery);
    expect(read).toMatchObject({
      kind: "succeeded",
      result: { conversion: { runId: "c12-run", threadId: "c12-thread" } },
    });
    expect(await adapter.read({ ...readQuery, projectId: "other-project" })).toMatchObject({
      kind: "failed",
    });
    for (const conversionRef of [
      readQuery.conversionRef,
      { ...readQuery.conversionRef, reference: { entityId: "missing-conversion", versionId: "1" } },
    ]) {
      expect(
        await adapter.read({
          ...readQuery,
          conversionRef,
          authorization: {
            ...readAuthorization,
            authorizationContextRef: {
              ...readAuthorization.authorizationContextRef,
              reference: { entityId: "missing-authorization", versionId: "1" },
            },
          },
        }),
      ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    }

    const failedCommand = {
      ...conversion,
      conversionId: "c12-failed-conversion",
      idempotencyKey: "c12-failed-conversion",
      authorization: await state.authorize("c12-failed-conversion", [sourceVersionRef]),
      input: { kind: "text-pdf" as const },
    };
    failCommit = true;
    expect(await adapter.convert(failedCommand)).toMatchObject({
      kind: "failed",
      error: { code: "TRANSIENT_FAILURE", retryable: true },
    });
    const failure = await adapter.convert(failedCommand);
    expect(failure).toMatchObject({ kind: "failed", error: { code: "TERMINAL_FAILURE" } });
    if (failure.kind !== "failed") return;
    expect(await adapter.convert(failedCommand)).toMatchObject({
      kind: "failed",
      error: { code: failure.error.code, diagnosticRef: failure.error.diagnosticRef },
    });
    const failedRows = await fixture.postgres.adminPool.query<{ status: string }>(
      "SELECT status FROM business.structured_document_conversions WHERE project_id = $1 AND conversion_id = $2",
      [state.projectId, failedCommand.conversionId],
    );
    expect(failedRows.rows).toEqual([{ status: "failed" }]);
  });

  it("rejects same-key source delivery conflicts without creating a second row", async () => {
    const state = requireE2eState();
    const before = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.source_deliveries WHERE project_id = $1",
      [state.projectId],
    );
    const conflict = {
      ...state.deliveryCommand,
      payload: { ...state.deliveryCommand.payload, deliveryKey: "c11-conflicting-delivery" },
    } satisfies Extract<EngineeringDataCommandV1, { kind: "register-source-delivery" }>;
    const result = await fixture.registry.apply(conflict);
    expect(result).toMatchObject({ kind: "failed", error: { code: "IDEMPOTENCY_CONFLICT" } });
    const after = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.source_deliveries WHERE project_id = $1",
      [state.projectId],
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it("leaves pending access recoverable when the access closure fails", async () => {
    const state = requireE2eState();
    const { command } = await createDelivery("permission-retry");
    const failingAccess = {
      verify: fixture.access.verify.bind(fixture.access),
      administerProject: async () => {
        throw new Error("forced access closure failure");
      },
    } as unknown as typeof fixture.access;
    const failingRegistry = new PostgresEngineeringContextSourceRegistry({
      db: fixture.runtime.db,
      transactionUnit: fixture.transactionUnit,
      access: failingAccess,
      artifactStore: fixture.artifactStore,
      artifactReferenceGuard: fixture.artifactRegistry,
      now: () => new Date("2030-01-01T00:00:00.000Z"),
    });
    const first = await failingRegistry.apply(command);
    expect(first).toMatchObject({ kind: "failed" });
    const pending = await fixture.postgres.adminPool.query<{ access_status: string }>(
      `SELECT v.access_status
       FROM business.source_versions v
       JOIN business.source_deliveries d
         ON d.source_delivery_id = v.source_delivery_id AND d.project_id = v.project_id
       WHERE d.project_id = $1 AND d.delivery_key = $2`,
      [state.projectId, command.payload.deliveryKey],
    );
    expect(pending.rows).toEqual([{ access_status: "pending-access" }]);
    const retry = await fixture.registry.apply(command);
    expect(retry).toMatchObject({
      kind: "succeeded",
      result: { kind: "register-source-delivery" },
    });
    const ready = await fixture.postgres.adminPool.query<{ access_status: string }>(
      `SELECT v.access_status
       FROM business.source_versions v
       JOIN business.source_deliveries d
         ON d.source_delivery_id = v.source_delivery_id AND d.project_id = v.project_id
       WHERE d.project_id = $1 AND d.delivery_key = $2`,
      [state.projectId, command.payload.deliveryKey],
    );
    expect(ready.rows).toEqual([{ access_status: "ready" }]);
  });

  it("fails before C11 persistence when the metadata artifact is unavailable", async () => {
    const state = requireE2eState();
    const commandId = "c11-artifact-failure";
    const authorization = await state.authorize(commandId);
    const missingSourceArtifactRef: ContentArtifactRefV1 = {
      kind: "content-artifact",
      reference: { entityId: "missing-c11-source", versionId: `sha256:${"c".repeat(64)}` },
    };
    const command = {
      commandId,
      idempotencyKey: commandId,
      projectId: state.projectId,
      actorId: state.managerId,
      issuedAt: "2030-01-01T00:00:00.000Z",
      authorization,
      kind: "register-source-delivery" as const,
      payload: {
        sourceConnectionRef: { entityId: "file-upload", versionId: "1" },
        deliveryKey: "c11-artifact-failure",
        sourceArtifactRef: missingSourceArtifactRef,
        metadataArtifactRef: state.metadataArtifactRef,
        occurredAt: "2030-01-01T00:00:00.000Z",
      },
    } satisfies Extract<EngineeringDataCommandV1, { kind: "register-source-delivery" }>;
    const result = await fixture.registry.apply(command);
    expect(result).toMatchObject({ kind: "failed" });
    const persisted = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.source_deliveries WHERE project_id = $1 AND delivery_key = $2",
      [state.projectId, command.payload.deliveryKey],
    );
    expect(persisted.rows[0]?.count).toBe("0");
  });

  it("does not leak context revisions across projects", async () => {
    const state = requireE2eState();
    const commandId = "c11-cross-project-context";
    const authorization = await state.authorize(commandId);
    const result = await fixture.registry.reviseContext({
      commandId,
      idempotencyKey: commandId,
      projectId: "project-c11-forbidden",
      actorId: state.managerId,
      issuedAt: "2030-01-01T00:00:00.000Z",
      authorization,
      kind: "project",
      expectedVersion: "none",
      name: "不应写入",
      lifecycle: "preparing",
      applicabilityMetadata: {
        constructionMethod: "variable-diameter-shield",
        stratumCondition: "soft-soil",
        engineeringStage: "expansion-preparation",
      },
      effectivePeriod: { validFrom: "2030-01-01T00:00:00.000Z" },
    });
    expect(result).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    const leaked = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.engineering_projects WHERE project_id = $1",
      ["project-c11-forbidden"],
    );
    expect(leaked.rows[0]?.count).toBe("0");
  });

  it("rejects segments outside the authorized spatial scope", async () => {
    const state = requireE2eState();
    const { command: deliveryCommand } = await createDelivery("segment-permission");
    const delivery = await fixture.registry.apply(deliveryCommand);
    expect(delivery).toMatchObject({ kind: "succeeded" });
    if (delivery.kind !== "succeeded") return;
    const sourceVersionRef = delivery.result.sourceVersionRef;
    const commandId = "c11-segment-permission-segments";
    const authorization = await state.authorize(commandId, [sourceVersionRef]);
    const unauthorizedScopeRef: SpatialScopeRefV1 = {
      kind: "spatial-scope",
      reference: { entityId: "scope-not-authorized", versionId: "1" },
    };
    const result = await fixture.registry.registerSegments({
      commandId,
      idempotencyKey: commandId,
      projectId: state.projectId,
      actorId: state.managerId,
      issuedAt: "2030-01-01T00:00:00.000Z",
      authorization,
      sourceVersionRef,
      sourceId: sourceVersionRef.reference.entityId,
      segments: [
        {
          sourceSegmentId:
            `${sourceVersionRef.reference.entityId}-chapter_unauthorized-segment_unauthorized` as never,
          chapterId: "chapter_unauthorized",
          segmentId: "segment_unauthorized",
          kind: "chapter",
          spatialScopeRefs: [unauthorizedScopeRef],
          locator: { kind: "document", pageNumber: 1, headingPath: ["未授权"] },
        },
      ],
    });
    expect(result).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    const persisted = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.source_segment_sets WHERE project_id = $1 AND source_version_id = $2",
      [state.projectId, sourceVersionRef.reference.entityId],
    );
    expect(persisted.rows[0]?.count).toBe("0");
  });

  it("serializes concurrent spatial revisions and rejects the stale writer", async () => {
    const state = requireE2eState();
    const current = state.businessSpatialScopeRef;
    const commandAId = "c11-spatial-concurrent-a";
    const commandBId = "c11-spatial-concurrent-b";
    const [authorizationA, authorizationB] = await Promise.all([
      state.authorize(commandAId),
      state.authorize(commandBId),
    ]);
    const commandA = {
      commandId: commandAId,
      idempotencyKey: commandAId,
      projectId: state.projectId,
      actorId: state.managerId,
      issuedAt: "2030-01-01T00:00:00.000Z",
      authorization: authorizationA,
      kind: "spatial" as const,
      spatialScopeRef: current,
      projectRevisionRef: state.projectRevisionRef,
      expectedVersion: current.reference,
      name: "并发修订 A",
      worksiteLocation: "左线并发 A",
      applicabilityOverrides: { engineeringStage: "shield-expansion" },
      status: "active" as const,
      effectivePeriod: { validFrom: "2030-01-01T00:00:00.000Z" },
    };
    const commandB = {
      ...commandA,
      commandId: commandBId,
      idempotencyKey: commandBId,
      authorization: authorizationB,
      name: "并发修订 B",
      worksiteLocation: "左线并发 B",
    };
    const [resultA, resultB] = await Promise.all([
      fixture.registry.reviseContext(commandA),
      fixture.registry.reviseContext(commandB),
    ]);
    const results = [resultA, resultB];
    expect(results.filter((result) => result.kind === "succeeded")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "failed")).toHaveLength(1);
    const succeeded = results.find((result) => result.kind === "succeeded");
    const stale = results.find((result) => result.kind === "failed");
    expect(succeeded).toMatchObject({
      kind: "succeeded",
      result: { kind: "spatial-revision", revision: { previousRevisionRef: current } },
    });
    expect(stale).toMatchObject({ kind: "failed", error: { code: "STALE_VERSION" } });
    if (succeeded?.kind === "succeeded" && succeeded.result.kind === "spatial-revision") {
      state.businessSpatialScopeRef = succeeded.result.revision.spatialScopeRef;
    }
  });

  it("rolls back a context revision when the audit append fails and allows retry", async () => {
    const state = requireE2eState();
    const commandId = "c11-audit-rollback";
    const authorization = await state.authorize(commandId);
    const command = {
      commandId,
      idempotencyKey: commandId,
      projectId: state.projectId,
      actorId: state.managerId,
      issuedAt: "2030-01-01T00:00:00.000Z",
      authorization,
      kind: "spatial" as const,
      spatialScopeRef: state.businessSpatialScopeRef,
      projectRevisionRef: state.projectRevisionRef,
      expectedVersion: state.businessSpatialScopeRef.reference,
      name: "审计失败后重试",
      worksiteLocation: "左线审计回滚",
      applicabilityOverrides: { engineeringStage: "shield-expansion" },
      status: "active" as const,
      effectivePeriod: { validFrom: "2030-01-01T00:00:00.000Z" },
    };
    const before = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.engineering_spatial_segment_revisions WHERE project_id = $1",
      [state.projectId],
    );
    await fixture.postgres.adminPool.query(
      "REVOKE INSERT ON TABLE audit.entries FROM riskflow_app",
    );
    let failed: Awaited<ReturnType<typeof fixture.registry.reviseContext>>;
    try {
      failed = await fixture.registry.reviseContext(command);
    } finally {
      await fixture.postgres.adminPool.query("GRANT INSERT ON TABLE audit.entries TO riskflow_app");
    }
    expect(failed!).toMatchObject({ kind: "failed" });
    const afterFailure = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.engineering_spatial_segment_revisions WHERE project_id = $1",
      [state.projectId],
    );
    expect(afterFailure.rows[0]?.count).toBe(before.rows[0]?.count);
    const retry = await fixture.registry.reviseContext(command);
    expect(retry).toMatchObject({ kind: "succeeded", result: { kind: "spatial-revision" } });
  });

  it("reads an exact historical source version after the project revision advances", async () => {
    const state = requireE2eState();
    const commandId = "c11-historical-project-revision";
    const authorization = await state.authorize(commandId);
    const revised = await fixture.registry.reviseContext({
      commandId,
      idempotencyKey: commandId,
      projectId: state.projectId,
      actorId: state.managerId,
      issuedAt: "2030-01-01T00:00:00.000Z",
      authorization,
      kind: "project",
      expectedVersion: state.projectRevisionRef.reference,
      name: "C11 历史读取验证",
      lifecycle: "active",
      applicabilityMetadata: {
        constructionMethod: "variable-diameter-shield",
        stratumCondition: "soft-soil",
        engineeringStage: "shield-expansion",
      },
      effectivePeriod: { validFrom: "2030-01-01T00:00:00.000Z" },
    });
    expect(revised).toMatchObject({ kind: "succeeded", result: { kind: "project-revision" } });
    const readAuthorization = await state.authorize(
      "c11-historical-source-read",
      [state.sourceVersionRef],
      "engineering-data.evidence-access",
    );
    const read = await fixture.registry.resolveSourceVersionForRead({
      queryId: "c11-historical-source-read",
      projectId: state.projectId,
      actorId: state.managerId,
      requestedAt: "2030-01-01T00:00:00.000Z",
      authorization: readAuthorization,
      sourceVersionRef: state.sourceVersionRef,
    });
    expect(read).toMatchObject({
      kind: "succeeded",
      result: {
        kind: "source-processing-input",
        input: { sourceVersionRef: state.sourceVersionRef },
      },
    });
  });

  it("rolls back read query persistence after a storage failure and recovers on retry", async () => {
    const state = requireE2eState();
    const queryId = "c11-read-rollback";
    const query = {
      queryId,
      projectId: state.projectId,
      actorId: state.managerId,
      requestedAt: "2030-01-01T00:00:00.000Z",
      authorization: await state.authorize(
        queryId,
        [state.sourceVersionRef],
        "engineering-data.source-segments",
      ),
      kind: "source-segments",
      payload: { sourceSegmentSetRef: state.segmentSetRef },
    } satisfies EngineeringDataQueryV1;
    let failNext = true;
    const failingRegistry = new PostgresEngineeringContextSourceRegistry({
      db: fixture.runtime.db,
      transactionUnit: {
        async execute(command, handler) {
          if (failNext) {
            failNext = false;
            throw new Error("temporary read query storage outage");
          }
          return fixture.transactionUnit.execute(command, handler);
        },
      },
      access: fixture.access,
      artifactStore: fixture.artifactStore,
      artifactReferenceGuard: fixture.artifactRegistry,
      monitoringStore: fixture.monitoringStore,
      now: () => new Date("2030-01-01T00:00:00.000Z"),
    });
    expect(await failingRegistry.read(query)).toMatchObject({ kind: "failed" });
    const persisted = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.engineering_data_read_query_results WHERE query_result_id = $1",
      [`source-segments-${queryId}`],
    );
    expect(persisted.rows[0]?.count).toBe("0");
    const audited = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit.entries WHERE command_id = $1",
      [queryId],
    );
    expect(audited.rows[0]?.count).toBe("0");
    expect(await fixture.registry.read(query)).toEqual({
      kind: "succeeded",
      result: {
        queryResultRef: {
          kind: "query-result",
          reference: { entityId: `source-segments-${queryId}`, versionId: "1" },
        },
      },
    });
  });

  it("denies forged actor declarations across context writes, reads, and resolutions", async () => {
    const state = requireE2eState();
    // 既有用例已推进空间修订指针；先对齐数据库当前指针，使伪造与合规用例都落在真实当前修订上。
    state.projectRevisionRef = (
      await fixture.postgres.adminPool.query<{ project_revision_ref: ProjectRevisionRefV1 }>(
        `SELECT r.project_revision_ref
           FROM business.engineering_projects p
           JOIN business.engineering_project_revisions r
             ON r.project_id = p.project_id AND r.revision_id = p.current_revision_id
          WHERE p.project_id = $1`,
        [state.projectId],
      )
    ).rows[0]!.project_revision_ref;
    state.businessSpatialScopeRef = (
      await fixture.postgres.adminPool.query<{ spatial_scope_ref: SpatialScopeRefV1 }>(
        `SELECT r.spatial_scope_ref
           FROM business.engineering_spatial_segments s
           JOIN business.engineering_spatial_segment_revisions r
             ON r.project_id = s.project_id
            AND r.scope_id = s.scope_id
            AND r.revision_id = s.current_revision_id
          WHERE s.project_id = $1 AND s.scope_id = $2`,
        [state.projectId, state.businessSpatialScopeRef.reference.entityId],
      )
    ).rows[0]!.spatial_scope_ref;
    const forgedActorId = "c11-forged-actor-binding";
    const timestamp = "2030-01-01T00:00:00.000Z";
    const forged = async (
      invocationId: string,
      branch:
        | "engineering-data.register-source-delivery"
        | "engineering-data.evidence-access"
        | "engineering-data.source-segments" = "engineering-data.register-source-delivery",
      sourceRefs: readonly SourceVersionRefV1[] = [],
    ): Promise<AuthorizationContextV1> => ({
      ...(await state.authorize(invocationId, sourceRefs, branch)),
      actorId: forgedActorId,
    });
    const putArtifact = async (
      suffix: string,
      authorizationContext: AuthorizationContextV1,
      content: string,
      mediaType: string,
    ) =>
      fixture.artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: `c11-binding-${suffix}`,
          idempotencyKey: `c11-binding-${suffix}`,
          projectId: state.projectId,
          actorId: state.managerId,
          issuedAt: timestamp,
          authorization: authorizationContext,
          requiredCapability: "engineering-data.write",
          artifactId: `c11-binding-${suffix}`,
          artifactKind: "content",
          purposeCode: "engineering-data.register-source-delivery",
          mediaType,
          parentArtifactRefs: [],
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        (async function* () {
          yield new TextEncoder().encode(content);
        })(),
      );
    const evidenceFor = async (id: string) =>
      (
        await fixture.postgres.adminPool.query<{
          receipts: number;
          audits: number;
          receipt_actor: string | null;
          audit_actor: string | null;
        }>(
          `SELECT (SELECT count(*)::int FROM business.command_receipts WHERE command_id = $1) AS receipts,
                  (SELECT count(*)::int FROM audit.entries WHERE command_id = $1) AS audits,
                  (SELECT actor_ref FROM business.command_receipts WHERE command_id = $1) AS receipt_actor,
                  (SELECT actor_ref FROM audit.entries WHERE command_id = $1) AS audit_actor`,
          [id],
        )
      ).rows[0]!;
    const factsFor = async () =>
      (
        await fixture.postgres.adminPool.query<Record<string, number | string | null>>(
          `SELECT (SELECT count(*)::int FROM business.engineering_projects) AS projects,
                  (SELECT count(*)::int FROM business.engineering_project_revisions) AS project_revisions,
                  (SELECT count(*)::int FROM business.engineering_spatial_segment_revisions) AS spatial_revisions,
                  (SELECT count(*)::int FROM business.source_items) AS source_items,
                  (SELECT count(*)::int FROM business.source_deliveries) AS source_deliveries,
                  (SELECT count(*)::int FROM business.source_versions) AS source_versions,
                  (SELECT count(*)::int FROM business.source_segment_sets) AS source_segment_sets,
                  (SELECT count(*)::int FROM business.source_segments) AS source_segments,
                  (SELECT count(*)::int FROM business.applicability_metadata_snapshots) AS snapshots,
                  (SELECT count(*)::int FROM business.engineering_data_read_query_results) AS read_query_results,
                  (SELECT count(*)::int FROM business.source_access_policies) AS access_policies,
                  (SELECT count(*)::int FROM business.source_access_policy_revisions) AS access_revisions,
                  (SELECT count(*)::int FROM business.source_access_policy_revision_accounts) AS access_accounts,
                  (SELECT count(*)::int FROM business.source_access_policy_revision_scopes) AS access_scopes,
                  (SELECT count(*)::int FROM outbox.events WHERE event_type LIKE 'engineering.%') AS events,
                  (SELECT current_revision_id FROM business.engineering_projects WHERE project_id = $1) AS project_pointer,
                  (SELECT current_revision_id FROM business.engineering_spatial_segments WHERE project_id = $1 AND scope_id = $2) AS spatial_pointer`,
          [state.projectId, state.businessSpatialScopeRef.reference.entityId],
        )
      ).rows[0]!;
    const forgedActorRows = async () =>
      (
        await fixture.postgres.adminPool.query<{ rows: number }>(
          `SELECT (SELECT count(*)::int FROM business.command_receipts WHERE actor_ref = $1) +
                  (SELECT count(*)::int FROM audit.entries WHERE actor_ref = $1) +
                  (SELECT count(*)::int FROM business.engineering_project_revisions WHERE actor_id = $1) +
                  (SELECT count(*)::int FROM business.engineering_spatial_segment_revisions WHERE actor_id = $1) +
                  (SELECT count(*)::int FROM business.source_items WHERE actor_id = $1) +
                  (SELECT count(*)::int FROM business.source_deliveries WHERE registered_by = $1) +
                  (SELECT count(*)::int FROM business.source_versions WHERE registered_by = $1) +
                  (SELECT count(*)::int FROM business.source_segment_sets WHERE actor_id = $1) +
                  (SELECT count(*)::int FROM business.applicability_metadata_snapshots WHERE actor_id = $1) +
                  (SELECT count(*)::int FROM business.engineering_data_read_query_results WHERE requested_by = $1) +
                  (SELECT count(*)::int FROM business.source_access_policy_revisions WHERE registered_by = $1) +
                  (SELECT count(*)::int FROM business.source_access_policy_revision_accounts WHERE account_id = $1) AS rows`,
          [forgedActorId],
        )
      ).rows[0]!;
    const stableError = (result: unknown): string => {
      if (typeof result !== "object" || result === null || !("error" in result)) return "";
      const { error } = result;
      if (typeof error !== "object" || error === null) return "";
      const shape: Record<string, unknown> = { ...error };
      delete shape.occurredAt;
      delete shape.causalRunId;
      return JSON.stringify(shape);
    };

    // 先用合规主体建立真实目标：空间修订、适用性快照、来源交付、资料段集合与两类读取。
    const spatialControlId = "c11-binding-spatial-control";
    const spatialControl = await fixture.registry.reviseContext({
      commandId: spatialControlId,
      idempotencyKey: spatialControlId,
      projectId: state.projectId,
      actorId: state.managerId,
      issuedAt: timestamp,
      authorization: await state.authorize(spatialControlId),
      kind: "spatial",
      spatialScopeRef: state.businessSpatialScopeRef,
      projectRevisionRef: state.projectRevisionRef,
      expectedVersion: state.businessSpatialScopeRef.reference,
      name: "主体绑定空间修订",
      worksiteLocation: "左线绑定",
      applicabilityOverrides: { engineeringStage: "shield-expansion" },
      status: "active",
      effectivePeriod: { validFrom: timestamp },
    });
    expect(spatialControl, "spatial control").toMatchObject({
      kind: "succeeded",
      result: { kind: "spatial-revision" },
    });
    if (spatialControl.kind !== "succeeded" || spatialControl.result.kind !== "spatial-revision")
      throw new Error("binding spatial control failed");
    state.businessSpatialScopeRef = spatialControl.result.revision.spatialScopeRef;
    expect(
      (
        await fixture.postgres.adminPool.query<{ actor_id: string }>(
          "SELECT actor_id FROM business.engineering_spatial_segment_revisions WHERE project_id = $1 AND scope_id = $2 AND revision_id = $3",
          [
            state.projectId,
            state.businessSpatialScopeRef.reference.entityId,
            `${state.businessSpatialScopeRef.reference.entityId}:${state.businessSpatialScopeRef.reference.versionId}`,
          ],
        )
      ).rows,
    ).toEqual([{ actor_id: state.managerId }]);
    expect(await evidenceFor(spatialControlId)).toMatchObject({
      receipts: 1,
      audits: 1,
      receipt_actor: state.managerId,
      audit_actor: state.managerId,
    });

    const snapshotControlId = "c11-binding-snapshot-control";
    const snapshotControl = await fixture.registry.createApplicabilitySnapshot({
      commandId: snapshotControlId,
      idempotencyKey: snapshotControlId,
      projectId: state.projectId,
      actorId: state.managerId,
      issuedAt: timestamp,
      authorization: await state.authorize(snapshotControlId),
      projectRevisionRef: state.projectRevisionRef,
      spatialScopeRef: state.businessSpatialScopeRef,
      formedAt: timestamp,
    });
    expect(snapshotControl, "snapshot control").toMatchObject({
      kind: "succeeded",
      result: { kind: "applicability-snapshot" },
    });
    if (
      snapshotControl.kind !== "succeeded" ||
      snapshotControl.result.kind !== "applicability-snapshot"
    )
      throw new Error("binding snapshot control failed");
    const bindingSnapshotRef = snapshotControl.result.snapshot.snapshotRef;
    expect(
      (
        await fixture.postgres.adminPool.query<{ actor_id: string }>(
          "SELECT actor_id FROM business.applicability_metadata_snapshots WHERE snapshot_id = $1 AND version_id = $2",
          [bindingSnapshotRef.reference.entityId, bindingSnapshotRef.reference.versionId],
        )
      ).rows,
    ).toEqual([{ actor_id: state.managerId }]);
    expect(await evidenceFor(snapshotControlId)).toMatchObject({
      receipts: 1,
      audits: 1,
      receipt_actor: state.managerId,
      audit_actor: state.managerId,
    });

    const deliveryControlId = "c11-binding-delivery-control";
    const deliveryAuthorization = await state.authorize(deliveryControlId);
    const sourceContent = "binding source body";
    const sourceArtifact = await putArtifact(
      "delivery-source",
      deliveryAuthorization,
      sourceContent,
      "text/plain",
    );
    const metadataArtifact = await putArtifact(
      "delivery-metadata",
      deliveryAuthorization,
      JSON.stringify({
        schemaVersion: "1",
        projectRevisionRef: state.projectRevisionRef,
        spatialScopeRefs: [state.businessSpatialScopeRef],
        registeredByAccountId: state.managerId,
        sourceItemId: "c11-binding-source-item",
        sourceItemName: "施工方案-主体绑定",
        sourceCategory: "engineering-document",
        sourceMetadata: {
          documentType: "施工方案",
          formedAt: timestamp,
          sourceOrganization: "甲方",
        },
        descriptor: { kind: "file-upload", contentFingerprint: sourceContent },
        applicabilityMetadataSnapshotRef: bindingSnapshotRef,
      }),
      "application/json",
    );
    const deliveryControl = await fixture.registry.apply({
      commandId: deliveryControlId,
      idempotencyKey: deliveryControlId,
      projectId: state.projectId,
      actorId: state.managerId,
      issuedAt: timestamp,
      authorization: deliveryAuthorization,
      kind: "register-source-delivery",
      payload: {
        sourceConnectionRef: { entityId: "file-upload", versionId: "1" },
        deliveryKey: "c11-binding-delivery",
        sourceArtifactRef: sourceArtifact.artifactRef,
        metadataArtifactRef: metadataArtifact.artifactRef,
        occurredAt: timestamp,
      },
    });
    if (deliveryControl.kind !== "succeeded") throw new Error("binding delivery control failed");
    const bindingSourceVersionRef = deliveryControl.result.sourceVersionRef;
    const bindingSourceId = bindingSourceVersionRef.reference.entityId;
    expect(await evidenceFor(deliveryControlId)).toMatchObject({
      receipts: 1,
      audits: 1,
      receipt_actor: state.managerId,
      audit_actor: state.managerId,
    });
    // 资料权限收口只登记 C06 已验证主体。
    expect(
      (
        await fixture.postgres.adminPool.query<{ registered_by: string; accounts: string }>(
          `SELECT r.registered_by AS registered_by,
                  (SELECT string_agg(a.account_id, ',' ORDER BY a.account_id)
                     FROM business.source_access_policy_revision_accounts a
                    WHERE a.revision_id = r.revision_id) AS accounts
             FROM business.source_access_policy_revisions r
             JOIN business.source_access_policies p
               ON p.source_access_grant_id = r.source_access_grant_id
            WHERE p.project_id = $1 AND p.source_entity_id = $2`,
          [state.projectId, bindingSourceId],
        )
      ).rows,
    ).toEqual([{ registered_by: state.managerId, accounts: state.managerId }]);

    const segmentsControlId = "c11-binding-segments-control";
    const segmentsControl = await fixture.registry.registerSegments({
      commandId: segmentsControlId,
      idempotencyKey: segmentsControlId,
      projectId: state.projectId,
      actorId: state.managerId,
      issuedAt: timestamp,
      authorization: await state.authorize(segmentsControlId, [bindingSourceVersionRef]),
      sourceVersionRef: bindingSourceVersionRef,
      sourceId: bindingSourceId,
      segments: [
        {
          sourceSegmentId: `${bindingSourceId}-chapter_1-segment_1` as never,
          chapterId: "chapter_1",
          segmentId: "segment_1",
          kind: "chapter",
          spatialScopeRefs: [state.businessSpatialScopeRef],
          locator: { kind: "document", pageNumber: 1, headingPath: ["主体绑定"] },
        },
      ],
    });
    expect(segmentsControl).toMatchObject({
      kind: "succeeded",
      result: { kind: "source-segment-set" },
    });
    expect(
      (
        await fixture.postgres.adminPool.query<{ actor_id: string }>(
          "SELECT actor_id FROM business.source_segment_sets WHERE project_id = $1 AND source_version_id = $2",
          [state.projectId, bindingSourceId],
        )
      ).rows,
    ).toEqual([{ actor_id: state.managerId }]);
    expect(await evidenceFor(segmentsControlId)).toMatchObject({
      receipts: 1,
      audits: 1,
      receipt_actor: state.managerId,
      audit_actor: state.managerId,
    });

    const processingInputControlId = "c11-binding-processing-input-control";
    expect(
      await fixture.registry.resolveSourceProcessingInput({
        queryId: processingInputControlId,
        projectId: state.projectId,
        actorId: state.managerId,
        requestedAt: timestamp,
        authorization: await state.authorize(processingInputControlId, [bindingSourceVersionRef]),
        sourceVersionRef: bindingSourceVersionRef,
      }),
    ).toMatchObject({
      kind: "succeeded",
      result: {
        kind: "source-processing-input",
        input: { sourceVersionRef: bindingSourceVersionRef },
      },
    });

    const versionReadControlId = "c11-binding-version-read-control";
    expect(
      await fixture.registry.resolveSourceVersionForRead({
        queryId: versionReadControlId,
        projectId: state.projectId,
        actorId: state.managerId,
        requestedAt: timestamp,
        authorization: await state.authorize(
          versionReadControlId,
          [state.sourceVersionRef],
          "engineering-data.evidence-access",
        ),
        sourceVersionRef: state.sourceVersionRef,
      }),
    ).toMatchObject({
      kind: "succeeded",
      result: {
        kind: "source-processing-input",
        input: { sourceVersionRef: state.sourceVersionRef },
      },
    });

    const segmentsReadId = "c11-binding-segments-read-control";
    const segmentsReadRef = {
      kind: "query-result" as const,
      reference: { entityId: `source-segments-${segmentsReadId}`, versionId: "1" },
    };
    expect(
      await fixture.registry.read({
        queryId: segmentsReadId,
        projectId: state.projectId,
        actorId: state.managerId,
        requestedAt: timestamp,
        authorization: await state.authorize(
          segmentsReadId,
          [state.sourceVersionRef],
          "engineering-data.source-segments",
        ),
        kind: "source-segments",
        payload: { sourceSegmentSetRef: state.segmentSetRef },
      }),
    ).toEqual({ kind: "succeeded", result: { queryResultRef: segmentsReadRef } });
    expect(
      (
        await fixture.postgres.adminPool.query<{ requested_by: string }>(
          "SELECT requested_by FROM business.engineering_data_read_query_results WHERE query_result_id = $1",
          [`source-segments-${segmentsReadId}`],
        )
      ).rows,
    ).toEqual([{ requested_by: state.managerId }]);

    const evidenceReadId = "c11-binding-evidence-read-control";
    const evidenceReadRef = {
      kind: "query-result" as const,
      reference: { entityId: `evidence-access-${evidenceReadId}`, versionId: "1" },
    };
    const evidenceReferences = state.segmentIds.map((segmentId) => ({
      locator: { sourceSegmentId: segmentId },
      sourceVersion: {
        entityId: state.sourceVersionRef.reference.entityId,
        versionId: state.sourceVersionRef.reference.versionId,
      },
    }));
    expect(
      await fixture.registry.read({
        queryId: evidenceReadId,
        projectId: state.projectId,
        actorId: state.managerId,
        requestedAt: timestamp,
        authorization: await state.authorize(
          evidenceReadId,
          [state.sourceVersionRef],
          "engineering-data.evidence-access",
        ),
        kind: "evidence-access",
        payload: { evidenceReferences, purposeCode: "risk-identification.evidence-access" },
      }),
    ).toEqual({ kind: "succeeded", result: { queryResultRef: evidenceReadRef } });
    expect(
      (
        await fixture.postgres.adminPool.query<{ requested_by: string }>(
          "SELECT requested_by FROM business.engineering_data_read_query_results WHERE query_result_id = $1",
          [`evidence-access-${evidenceReadId}`],
        )
      ).rows,
    ).toEqual([{ requested_by: state.managerId }]);

    const forgedProjectRevision = await forged("c11-forged-project-revision");
    const forgedSpatialRevision = await forged("c11-forged-spatial-revision");
    const forgedSegments = await forged(
      "c11-forged-segments",
      "engineering-data.register-source-delivery",
      [state.sourceVersionRef],
    );
    const forgedSnapshot = await forged("c11-forged-snapshot");
    const forgedDelivery = await forged("c11-forged-delivery");
    const forgedProcessingInput = await forged(
      "c11-forged-processing-input",
      "engineering-data.register-source-delivery",
      [bindingSourceVersionRef],
    );
    const forgedVersionRead = await forged(
      "c11-forged-version-read",
      "engineering-data.evidence-access",
      [state.sourceVersionRef],
    );
    const forgedSegmentsRead = await forged(
      "c11-forged-segments-read",
      "engineering-data.source-segments",
      [state.sourceVersionRef],
    );
    const forgedEvidenceRead = await forged(
      "c11-forged-evidence-read",
      "engineering-data.evidence-access",
      [state.sourceVersionRef],
    );
    const forgedSegmentsResolve = await forged(
      "c11-forged-segments-resolve",
      "engineering-data.source-segments",
      [state.sourceVersionRef],
    );
    const forgedEvidenceResolve = await forged(
      "c11-forged-evidence-resolve",
      "engineering-data.evidence-access",
      [state.sourceVersionRef],
    );
    const forgedArtifactAuthorization = await state.authorize("c11-forged-delivery");
    const forgedSourceArtifact = await putArtifact(
      "forged-delivery-source",
      forgedArtifactAuthorization,
      "forged source body",
      "text/plain",
    );
    const forgedMetadataArtifact = await putArtifact(
      "forged-delivery-metadata",
      forgedArtifactAuthorization,
      JSON.stringify({
        schemaVersion: "1",
        projectRevisionRef: state.projectRevisionRef,
        spatialScopeRefs: [state.businessSpatialScopeRef],
        registeredByAccountId: forgedActorId,
        sourceItemId: "c11-forged-source-item",
        sourceItemName: "施工方案-伪造主体",
        sourceCategory: "engineering-document",
        sourceMetadata: {
          documentType: "施工方案",
          formedAt: timestamp,
          sourceOrganization: "甲方",
        },
        descriptor: { kind: "file-upload", contentFingerprint: "forged source body" },
        applicabilityMetadataSnapshotRef: bindingSnapshotRef,
      }),
      "application/json",
    );
    const forgedCases: ReadonlyArray<{
      readonly label: string;
      readonly commandId: string;
      readonly group: "write" | "read";
      readonly run: () => Promise<{ kind: string }>;
    }> = [
      {
        label: "project-revision",
        commandId: "c11-forged-project-revision",
        group: "write",
        run: () =>
          fixture.registry.reviseContext({
            commandId: "c11-forged-project-revision",
            idempotencyKey: "c11-forged-project-revision",
            projectId: state.projectId,
            actorId: forgedActorId,
            issuedAt: timestamp,
            authorization: forgedProjectRevision,
            kind: "project",
            expectedVersion: state.projectRevisionRef.reference,
            name: "伪造工程修订",
            lifecycle: "active",
            applicabilityMetadata: {
              constructionMethod: "variable-diameter-shield",
              stratumCondition: "soft-soil",
              engineeringStage: "shield-expansion",
            },
            effectivePeriod: { validFrom: timestamp },
          }),
      },
      {
        label: "spatial-revision",
        commandId: "c11-forged-spatial-revision",
        group: "write",
        run: () =>
          fixture.registry.reviseContext({
            commandId: "c11-forged-spatial-revision",
            idempotencyKey: "c11-forged-spatial-revision",
            projectId: state.projectId,
            actorId: forgedActorId,
            issuedAt: timestamp,
            authorization: forgedSpatialRevision,
            kind: "spatial",
            spatialScopeRef: state.businessSpatialScopeRef,
            projectRevisionRef: state.projectRevisionRef,
            expectedVersion: state.businessSpatialScopeRef.reference,
            name: "伪造空间修订",
            worksiteLocation: "左线伪造",
            applicabilityOverrides: { engineeringStage: "shield-expansion" },
            status: "active",
            effectivePeriod: { validFrom: timestamp },
          }),
      },
      {
        label: "source-segment-set",
        commandId: "c11-forged-segments",
        group: "write",
        run: () =>
          fixture.registry.registerSegments({
            commandId: "c11-forged-segments",
            idempotencyKey: "c11-forged-segments",
            projectId: state.projectId,
            actorId: forgedActorId,
            issuedAt: timestamp,
            authorization: forgedSegments,
            sourceVersionRef: state.sourceVersionRef,
            sourceId: state.sourceVersionRef.reference.entityId,
            segments: [
              {
                sourceSegmentId:
                  `${state.sourceVersionRef.reference.entityId}-chapter_9-segment_1` as never,
                chapterId: "chapter_9",
                segmentId: "segment_1",
                kind: "chapter",
                spatialScopeRefs: [state.businessSpatialScopeRef],
                locator: { kind: "document", pageNumber: 9, headingPath: ["伪造"] },
              },
            ],
          }),
      },
      {
        label: "applicability-snapshot",
        commandId: "c11-forged-snapshot",
        group: "write",
        run: () =>
          fixture.registry.createApplicabilitySnapshot({
            commandId: "c11-forged-snapshot",
            idempotencyKey: "c11-forged-snapshot",
            projectId: state.projectId,
            actorId: forgedActorId,
            issuedAt: timestamp,
            authorization: forgedSnapshot,
            projectRevisionRef: state.projectRevisionRef,
            spatialScopeRef: state.businessSpatialScopeRef,
            formedAt: timestamp,
          }),
      },
      {
        label: "source-delivery",
        commandId: "c11-forged-delivery",
        group: "write",
        run: () =>
          fixture.registry.apply({
            commandId: "c11-forged-delivery",
            idempotencyKey: "c11-forged-delivery",
            projectId: state.projectId,
            actorId: forgedActorId,
            issuedAt: timestamp,
            authorization: forgedDelivery,
            kind: "register-source-delivery",
            payload: {
              sourceConnectionRef: { entityId: "file-upload", versionId: "1" },
              deliveryKey: "c11-forged-delivery",
              sourceArtifactRef: forgedSourceArtifact.artifactRef,
              metadataArtifactRef: forgedMetadataArtifact.artifactRef,
              occurredAt: timestamp,
            },
          }),
      },
      {
        label: "source-processing-input",
        commandId: "c11-forged-processing-input",
        group: "write",
        run: () =>
          fixture.registry.resolveSourceProcessingInput({
            queryId: "c11-forged-processing-input",
            projectId: state.projectId,
            actorId: forgedActorId,
            requestedAt: timestamp,
            authorization: forgedProcessingInput,
            sourceVersionRef: bindingSourceVersionRef,
          }),
      },
      {
        label: "source-version-read",
        commandId: "c11-forged-version-read",
        group: "read",
        run: () =>
          fixture.registry.resolveSourceVersionForRead({
            queryId: "c11-forged-version-read",
            projectId: state.projectId,
            actorId: forgedActorId,
            requestedAt: timestamp,
            authorization: forgedVersionRead,
            sourceVersionRef: state.sourceVersionRef,
          }),
      },
      {
        label: "source-segments-read",
        commandId: "c11-forged-segments-read",
        group: "read",
        run: () =>
          fixture.registry.read({
            queryId: "c11-forged-segments-read",
            projectId: state.projectId,
            actorId: forgedActorId,
            requestedAt: timestamp,
            authorization: forgedSegmentsRead,
            kind: "source-segments",
            payload: { sourceSegmentSetRef: state.segmentSetRef },
          }),
      },
      {
        label: "evidence-access-read",
        commandId: "c11-forged-evidence-read",
        group: "read",
        run: () =>
          fixture.registry.read({
            queryId: "c11-forged-evidence-read",
            projectId: state.projectId,
            actorId: forgedActorId,
            requestedAt: timestamp,
            authorization: forgedEvidenceRead,
            kind: "evidence-access",
            payload: { evidenceReferences, purposeCode: "risk-identification.evidence-access" },
          }),
      },
      {
        label: "source-segments-resolve",
        commandId: "c11-forged-segments-resolve",
        group: "read",
        run: () =>
          fixture.registry.resolveReadQuery({
            queryResultRef: segmentsReadRef,
            invocationId: "c11-forged-segments-resolve",
            projectId: state.projectId,
            actorId: forgedActorId,
            requestedAt: timestamp,
            authorization: forgedSegmentsResolve,
          }),
      },
      {
        label: "evidence-access-resolve",
        commandId: "c11-forged-evidence-resolve",
        group: "read",
        run: () =>
          fixture.registry.resolveReadQuery({
            queryResultRef: evidenceReadRef,
            invocationId: "c11-forged-evidence-resolve",
            projectId: state.projectId,
            actorId: forgedActorId,
            requestedAt: timestamp,
            authorization: forgedEvidenceResolve,
          }),
      },
    ];
    const factsBefore = await factsFor();
    const forgedErrors = new Map<"write" | "read", string[]>();
    for (const forgedCase of forgedCases) {
      const result = await forgedCase.run();
      expect(result, forgedCase.label).toMatchObject({
        kind: "failed",
        error: { code: "AUTHORIZATION_DENIED", category: "authorization" },
      });
      expect(result, forgedCase.label).not.toHaveProperty("error.targetRef");
      forgedErrors.set(forgedCase.group, [
        ...(forgedErrors.get(forgedCase.group) ?? []),
        stableError(result),
      ]);
    }
    expect([...forgedErrors.values()].every((errors) => errors.length > 0)).toBe(true);
    for (const errors of forgedErrors.values()) {
      expect(errors[0]).toContain("AUTHORIZATION_DENIED");
      expect(new Set(errors).size).toBe(1);
    }
    for (const forgedCase of forgedCases) {
      expect(await evidenceFor(forgedCase.commandId), forgedCase.label).toEqual({
        receipts: 0,
        audits: 0,
        receipt_actor: null,
        audit_actor: null,
      });
    }
    expect(await forgedActorRows()).toEqual({ rows: 0 });
    expect(await factsFor()).toEqual(factsBefore);

    // 合规主体的同类控制调用：resolve 与修订只写 C06 已验证主体。
    const segmentsResolveControlId = "c11-binding-segments-resolve-control";
    expect(
      await fixture.registry.resolveReadQuery({
        queryResultRef: segmentsReadRef,
        invocationId: segmentsResolveControlId,
        projectId: state.projectId,
        actorId: state.managerId,
        requestedAt: timestamp,
        authorization: await state.authorize(
          segmentsResolveControlId,
          [state.sourceVersionRef],
          "engineering-data.source-segments",
        ),
      }),
    ).toMatchObject({
      kind: "succeeded",
      result: {
        kind: "source-segments",
        queryResultRef: segmentsReadRef,
        sourceAccessGrantRef: { kind: "source-access-grant" },
      },
    });
    const evidenceResolveControlId = "c11-binding-evidence-resolve-control";
    expect(
      await fixture.registry.resolveReadQuery({
        queryResultRef: evidenceReadRef,
        invocationId: evidenceResolveControlId,
        projectId: state.projectId,
        actorId: state.managerId,
        requestedAt: timestamp,
        authorization: await state.authorize(
          evidenceResolveControlId,
          [state.sourceVersionRef],
          "engineering-data.evidence-access",
        ),
      }),
    ).toMatchObject({
      kind: "succeeded",
      result: {
        kind: "evidence-access",
        queryResultRef: evidenceReadRef,
        purposeCode: "risk-identification.evidence-access",
      },
    });

    const forgedReplayAuthorization = await forged(
      segmentsReadId,
      "engineering-data.source-segments",
      [state.sourceVersionRef],
    );
    expect(
      await fixture.registry.read({
        queryId: segmentsReadId,
        projectId: state.projectId,
        actorId: forgedActorId,
        requestedAt: timestamp,
        authorization: forgedReplayAuthorization,
        kind: "source-segments",
        payload: { sourceSegmentSetRef: state.segmentSetRef },
      }),
    ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    expect(await evidenceFor(segmentsReadId)).toMatchObject({
      receipts: 1,
      audits: 1,
      receipt_actor: state.managerId,
      audit_actor: state.managerId,
    });

    const projectControlId = "c11-binding-project-control";
    const projectControl = await fixture.registry.reviseContext({
      commandId: projectControlId,
      idempotencyKey: projectControlId,
      projectId: state.projectId,
      actorId: state.managerId,
      issuedAt: timestamp,
      authorization: await state.authorize(projectControlId),
      kind: "project",
      expectedVersion: state.projectRevisionRef.reference,
      name: "主体绑定工程修订",
      lifecycle: "active",
      applicabilityMetadata: {
        constructionMethod: "variable-diameter-shield",
        stratumCondition: "soft-soil",
        engineeringStage: "shield-expansion",
      },
      effectivePeriod: { validFrom: timestamp },
    });
    expect(projectControl).toMatchObject({
      kind: "succeeded",
      result: { kind: "project-revision" },
    });
    if (projectControl.kind !== "succeeded" || projectControl.result.kind !== "project-revision")
      return;
    expect(
      (
        await fixture.postgres.adminPool.query<{ actor_id: string }>(
          "SELECT actor_id FROM business.engineering_project_revisions WHERE project_id = $1 AND revision_id = $2",
          [
            state.projectId,
            `${state.projectId}:${projectControl.result.revision.projectRevisionRef.reference.versionId}`,
          ],
        )
      ).rows,
    ).toEqual([{ actor_id: state.managerId }]);
    expect(await evidenceFor(projectControlId)).toMatchObject({
      receipts: 1,
      audits: 1,
      receipt_actor: state.managerId,
      audit_actor: state.managerId,
    });
  });

  it("projects distinct C11 revisions of one scope to one exact C06 reference", async () => {
    const state = requireE2eState();
    const revisions = await fixture.postgres.adminPool.query<{
      spatial_scope_ref: SpatialScopeRefV1;
    }>(
      "SELECT spatial_scope_ref FROM business.engineering_spatial_segment_revisions WHERE project_id = $1 AND scope_id = $2 ORDER BY revision_no",
      [state.projectId, state.businessSpatialScopeRef.reference.entityId],
    );
    const historicalScopeRef = revisions.rows.find(
      ({ spatial_scope_ref }) =>
        spatial_scope_ref.reference.versionId !== state.businessSpatialScopeRef.reference.versionId,
    )?.spatial_scope_ref;
    if (historicalScopeRef === undefined)
      throw new Error("historical C11 scope revision is missing");
    const segmentId = state.segmentIds[0]!;
    const original = await fixture.postgres.adminPool.query<{ spatial_scope_refs: unknown }>(
      "SELECT spatial_scope_refs FROM business.source_segments WHERE project_id = $1 AND source_segment_id = $2",
      [state.projectId, segmentId],
    );
    const queryId = "c11-read-mixed-spatial-revisions";
    const authorization = await state.authorize(
      queryId,
      [state.sourceVersionRef],
      "engineering-data.source-segments",
    );
    await fixture.postgres.adminPool.query(
      "UPDATE business.source_segments SET spatial_scope_refs = $3::jsonb WHERE project_id = $1 AND source_segment_id = $2",
      [state.projectId, segmentId, JSON.stringify([historicalScopeRef])],
    );
    const result = await fixture.registry.read({
      queryId,
      projectId: state.projectId,
      actorId: state.managerId,
      requestedAt: "2030-01-01T00:00:00.000Z",
      authorization,
      kind: "source-segments",
      payload: { sourceSegmentSetRef: state.segmentSetRef },
    });
    await fixture.postgres.adminPool.query(
      "UPDATE business.source_segments SET spatial_scope_refs = $3::jsonb WHERE project_id = $1 AND source_segment_id = $2",
      [state.projectId, segmentId, JSON.stringify(original.rows[0]!.spatial_scope_refs)],
    );
    expect(result).toMatchObject({ kind: "succeeded" });
  });

  it("records both read branches once, replays the same reference, and resolves safe projections", async () => {
    const state = requireE2eState();
    const segmentsQueryId = "c11-read-source-segments";
    const segmentsQuery = {
      queryId: segmentsQueryId,
      projectId: state.projectId,
      actorId: state.managerId,
      requestedAt: "2030-01-01T00:00:00.000Z",
      authorization: await state.authorize(
        segmentsQueryId,
        [state.sourceVersionRef],
        "engineering-data.source-segments",
      ),
      kind: "source-segments",
      payload: { sourceSegmentSetRef: state.segmentSetRef },
    } satisfies EngineeringDataQueryV1;
    const segmentsResultRef = {
      kind: "query-result" as const,
      reference: { entityId: `source-segments-${segmentsQueryId}`, versionId: "1" },
    };
    expect(await fixture.registry.read(segmentsQuery)).toEqual({
      kind: "succeeded",
      result: { queryResultRef: segmentsResultRef },
    });
    expect(await fixture.registry.read(segmentsQuery)).toEqual({
      kind: "succeeded",
      result: { queryResultRef: segmentsResultRef },
    });
    const segmentsRows = await fixture.postgres.adminPool.query<{ query_payload: unknown }>(
      "SELECT query_payload FROM business.engineering_data_read_query_results WHERE query_result_id = $1",
      [`source-segments-${segmentsQueryId}`],
    );
    expect(segmentsRows.rows).toEqual([
      { query_payload: { kind: "source-segments", sourceSegmentSetRef: state.segmentSetRef } },
    ]);
    const segmentsAudit = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit.entries WHERE command_id = $1",
      [segmentsQueryId],
    );
    expect(segmentsAudit.rows[0]?.count).toBe("1");

    const segmentsResolveId = "c11-resolve-source-segments";
    const segmentsResolved = await fixture.registry.resolveReadQuery({
      queryResultRef: segmentsResultRef,
      invocationId: segmentsResolveId,
      projectId: state.projectId,
      actorId: state.managerId,
      requestedAt: "2030-01-01T00:00:01.000Z",
      authorization: await state.authorize(
        segmentsResolveId,
        [state.sourceVersionRef],
        "engineering-data.source-segments",
      ),
    });
    expect(segmentsResolved).toMatchObject({
      kind: "succeeded",
      result: {
        kind: "source-segments",
        queryResultRef: segmentsResultRef,
        segmentSet: { sourceSegmentSetRef: state.segmentSetRef },
        sourceAccessGrantRef: { kind: "source-access-grant" },
      },
    });
    if (
      segmentsResolved.kind !== "succeeded" ||
      segmentsResolved.result.kind !== "source-segments"
    ) {
      throw new Error("source-segments resolve did not succeed");
    }
    expect(
      segmentsResolved.result.segmentSet.segments.map((segment) => segment.sourceSegmentId),
    ).toEqual(state.segmentIds);
    expect(JSON.stringify(segmentsResolved)).not.toContain("content-artifact");
    expect(JSON.stringify(segmentsResolved)).not.toContain("sha256:");

    const evidenceQueryId = "c11-read-evidence-access";
    const evidenceReferences = state.segmentIds.map((segmentId) => ({
      locator: { sourceSegmentId: segmentId },
      sourceVersion: {
        entityId: state.sourceVersionRef.reference.entityId,
        versionId: state.sourceVersionRef.reference.versionId,
      },
    }));
    const evidenceQuery = {
      queryId: evidenceQueryId,
      projectId: state.projectId,
      actorId: state.managerId,
      requestedAt: "2030-01-01T00:00:00.000Z",
      authorization: await state.authorize(
        evidenceQueryId,
        [state.sourceVersionRef],
        "engineering-data.evidence-access",
      ),
      kind: "evidence-access",
      payload: {
        evidenceReferences,
        purposeCode: "risk-identification.evidence-access",
      },
    } satisfies EngineeringDataQueryV1;
    const evidenceResultRef = {
      kind: "query-result" as const,
      reference: { entityId: `evidence-access-${evidenceQueryId}`, versionId: "1" },
    };
    expect(await fixture.registry.read(evidenceQuery)).toEqual({
      kind: "succeeded",
      result: { queryResultRef: evidenceResultRef },
    });
    expect(
      await fixture.registry.read({
        ...evidenceQuery,
        payload: { ...evidenceQuery.payload, purposeCode: "engineering-data.evidence-access" },
      }),
    ).toMatchObject({ kind: "failed", error: { code: "IDEMPOTENCY_CONFLICT" } });
    const evidenceRows = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.engineering_data_read_query_results WHERE query_result_id = $1",
      [`evidence-access-${evidenceQueryId}`],
    );
    expect(evidenceRows.rows[0]?.count).toBe("1");

    const evidenceResolveId = "c11-resolve-evidence-access";
    const evidenceResolved = await fixture.registry.resolveReadQuery({
      queryResultRef: evidenceResultRef,
      invocationId: evidenceResolveId,
      projectId: state.projectId,
      actorId: state.managerId,
      requestedAt: "2030-01-01T00:00:01.000Z",
      authorization: await state.authorize(
        evidenceResolveId,
        [state.sourceVersionRef],
        "engineering-data.evidence-access",
      ),
    });
    expect(evidenceResolved).toMatchObject({
      kind: "succeeded",
      result: {
        kind: "evidence-access",
        queryResultRef: evidenceResultRef,
        purposeCode: "risk-identification.evidence-access",
      },
    });
    if (
      evidenceResolved.kind !== "succeeded" ||
      evidenceResolved.result.kind !== "evidence-access"
    ) {
      throw new Error("evidence-access resolve did not succeed");
    }
    expect(evidenceResolved.result.items.map((item) => item.segment.sourceSegmentId)).toEqual(
      state.segmentIds,
    );
    expect(
      evidenceResolved.result.items.map((item) => item.evidenceReference.locator.sourceSegmentId),
    ).toEqual(state.segmentIds);
    expect(
      evidenceResolved.result.items.every(
        (item) =>
          item.sourceAccessGrantRef.kind === "source-access-grant" &&
          item.sourceSegmentSetRef.reference.entityId === state.segmentSetRef.reference.entityId &&
          item.sourceSegmentSetRef.reference.versionId === state.segmentSetRef.reference.versionId,
      ),
    ).toBe(true);
    expect(JSON.stringify(evidenceResolved)).not.toContain("content-artifact");
    expect(JSON.stringify(evidenceResolved)).not.toContain("sha256:");
  });

  it("returns one indistinguishable denial for every unresolvable read target", async () => {
    const state = requireE2eState();
    const queryId = "c11-read-denied";
    const authorization = await state.authorize(
      queryId,
      [state.sourceVersionRef],
      "engineering-data.source-segments",
    );
    const segmentsQueryBase = {
      queryId,
      projectId: state.projectId,
      actorId: state.managerId,
      requestedAt: "2030-01-01T00:00:00.000Z",
      authorization,
      kind: "source-segments" as const,
    };
    const evidenceQueryId = "c11-read-denied-evidence";
    const evidenceAuthorization = await state.authorize(
      evidenceQueryId,
      [state.sourceVersionRef],
      "engineering-data.evidence-access",
    );
    const evidenceQueryBase = {
      queryId: evidenceQueryId,
      projectId: state.projectId,
      actorId: state.managerId,
      requestedAt: "2030-01-01T00:00:00.000Z",
      authorization: evidenceAuthorization,
      kind: "evidence-access" as const,
    };
    const results: Array<
      [
        string,
        {
          kind: string;
          error?: { code: string; category: string; requiredCapability?: string };
        },
      ]
    > = [
      [
        "missing-segment-set",
        await fixture.registry.read({
          ...segmentsQueryBase,
          payload: {
            sourceSegmentSetRef: {
              kind: "source-segment-set",
              reference: { entityId: "c11-missing-set", versionId: "1" },
            },
          },
        }),
      ],
      [
        "unknown-segment-set-version",
        await fixture.registry.read({
          ...segmentsQueryBase,
          payload: {
            sourceSegmentSetRef: {
              ...state.segmentSetRef,
              reference: {
                entityId: state.segmentSetRef.reference.entityId,
                versionId: "9",
              },
            },
          },
        }),
      ],
      [
        "cross-project-query",
        await fixture.registry.read({ ...segmentsQueryBase, projectId: "c11-other-project" }),
      ],
      [
        "unknown-actor",
        await fixture.registry.read({ ...segmentsQueryBase, actorId: "c11-other-account" }),
      ],
      [
        "capability-not-granted",
        await fixture.registry.read({
          ...segmentsQueryBase,
          authorization: {
            ...authorization,
            grantedCapabilities: ["engineering-data.write" as const],
          },
        }),
      ],
      [
        "one-unresolvable-evidence",
        await fixture.registry.read({
          ...evidenceQueryBase,
          payload: {
            evidenceReferences: [
              {
                locator: { sourceSegmentId: state.segmentIds[0]! },
                sourceVersion: state.sourceVersionRef.reference,
              },
              {
                locator: { sourceSegmentId: "c11-missing-segment" },
                sourceVersion: state.sourceVersionRef.reference,
              },
            ],
            purposeCode: "risk-identification.evidence-access",
          },
        }),
      ],
      [
        "unknown-source-version",
        await fixture.registry.read({
          ...evidenceQueryBase,
          payload: {
            evidenceReferences: [
              {
                locator: { sourceSegmentId: state.segmentIds[0]! },
                sourceVersion: {
                  entityId: state.sourceVersionRef.reference.entityId,
                  versionId: "9",
                },
              },
            ],
            purposeCode: "risk-identification.evidence-access",
          },
        }),
      ],
      [
        "unmanaged-source-version",
        await fixture.registry.read({
          ...evidenceQueryBase,
          payload: {
            evidenceReferences: [
              {
                locator: {
                  sourceSegmentId: `${state.sourceVersionRef.reference.entityId}-chapter_1-segment_1`,
                },
                sourceVersion: { entityId: "c11-unmanaged-source", versionId: "1" },
              },
            ],
            purposeCode: "risk-identification.evidence-access",
          },
        }),
      ],
    ];
    for (const [label, result] of results) {
      expect(result, label).toMatchObject({
        kind: "failed",
        error: { code: "AUTHORIZATION_DENIED", category: "authorization" },
      });
    }
    expect(
      new Set(
        results.map(
          ([, result]) =>
            `${result.error?.code}/${result.error?.category}/${result.error?.requiredCapability}`,
        ),
      ),
    ).toEqual(new Set(["AUTHORIZATION_DENIED/authorization/engineering-data.read"]));
    for (const deniedQueryId of [queryId, evidenceQueryId]) {
      const deniedRows = await fixture.postgres.adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM business.engineering_data_read_query_results WHERE query_result_id LIKE $1",
        [`%-${deniedQueryId}`],
      );
      expect(deniedRows.rows[0]?.count).toBe("0");
      const deniedAudit = await fixture.postgres.adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM audit.entries WHERE command_id = $1",
        [deniedQueryId],
      );
      expect(deniedAudit.rows[0]?.count).toBe("0");
    }
  });

  describe("C34 评估启动候选窄读", () => {
    const readDate = "2030-01-01T00:00:00.000Z";

    const entryQuery = async (input: {
      readonly operation: "applicability-catalog" | "external-event-catalog";
      readonly suffix: string;
      readonly projectRevisionRef?: ProjectRevisionRefV1;
      readonly spatialScopeRef?: SpatialScopeRefV1;
      /** 签发授权时请求的空间；与 payload 空间分开，才能构造“载荷越界但授权成立”的失败闭合。 */
      readonly authorizationScopeRef?: SpatialScopeRefV1;
      /** 需要构造授权摘要差异（同一 payload 空间、不同获准集合）时使用。 */
      readonly authorizationScopeRefs?: readonly SpatialScopeRefV1[];
      readonly pageSize?: number;
      readonly cursor?: string;
    }): Promise<AssessmentEntryContextReadQueryV1> => {
      const state = requireE2eState();
      const spatialScopeRef = input.spatialScopeRef ?? state.businessSpatialScopeRef;
      // 操作判别 strict 载荷：只有适用性目录携带精确工程修订，外部事件目录只用空间。
      const payload =
        input.operation === "applicability-catalog"
          ? {
              operation: "applicability-catalog" as const,
              projectRevisionRef: input.projectRevisionRef ?? state.projectRevisionRef,
              spatialScopeRef,
              ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
              ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
            }
          : {
              operation: "external-event-catalog" as const,
              spatialScopeRef,
              ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
              ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
            };
      return {
        queryId: `c34-entry-${input.suffix}`,
        projectId: state.projectId,
        actorId: state.managerId,
        requestedAt: readDate,
        authorization: await state.authorize(
          `c34-entry-${input.suffix}`,
          [state.sourceVersionRef],
          "engineering-data.context-read",
          // C11 业务空间引用是 C06 入口空间的新修订：授权按入口空间签发，
          // 读取在适配器内按 entityId 归一到当前获准空间。
          input.authorizationScopeRefs ?? [input.authorizationScopeRef ?? state.accessRootScopeRef],
        ),
        kind: "read-assessment-entry-context",
        payload,
      };
    };

    /**
     * 外部事件的登记空间来自其证据资料段，因此按已登记事件实际使用的空间读取，
     * 而不是猜测某个空间修订下存在候选。返回的仍是精确已登记引用。
     */
    const registeredEventScope = async (): Promise<SpatialScopeRefV1> => {
      const state = requireE2eState();
      const rows = await fixture.postgres.adminPool.query<{ scope: unknown; count: string }>(
        `SELECT spatial_scope_refs -> 0 AS scope, count(*)::text AS count
           FROM business.external_risk_events
          WHERE project_id = $1 AND jsonb_array_length(spatial_scope_refs) > 0
          GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
        [state.projectId],
      );
      const row = rows.rows[0];
      if (row === undefined) throw new Error("no registered external risk event scope");
      // 取已登记事件最多的空间，保证目录确实存在第二页可续。
      expect(Number(row.count)).toBeGreaterThan(1);
      return SpatialScopeRefV1Schema.parse(row.scope);
    };

    const countCatalogRows = async () => {
      const state = requireE2eState();
      const rows = await fixture.postgres.adminPool.query<{
        snapshots: string;
        events: string;
        read_results: string;
        audit: string;
        outbox: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM business.applicability_metadata_snapshots WHERE project_id = $1) AS snapshots,
           (SELECT count(*)::text FROM business.external_risk_events WHERE project_id = $1) AS events,
           (SELECT count(*)::text FROM business.engineering_data_read_query_results WHERE project_id = $1) AS read_results,
           (SELECT count(*)::text FROM audit.entries WHERE project_id = $1) AS audit,
           (SELECT count(*)::text FROM outbox.events WHERE project_id = $1) AS outbox`,
        [state.projectId],
      );
      return rows.rows[0];
    };

    const registeredEventRefs = async (scopeRef: SpatialScopeRefV1) => {
      const state = requireE2eState();
      const rows = await fixture.postgres.adminPool.query<{ external_risk_event_ref: unknown }>(
        "SELECT external_risk_event_ref FROM business.external_risk_events WHERE project_id = $1 AND spatial_scope_refs @> jsonb_build_array($2::jsonb)",
        [state.projectId, JSON.stringify(scopeRef)],
      );
      return rows.rows.map((row) => JSON.stringify(row.external_risk_event_ref)).sort();
    };

    it("按精确修订分别续页两个已登记目录，只披露获准字段且预览零写入", async () => {
      const state = requireE2eState();
      const eventScopeRef = await registeredEventScope();
      const before = await countCatalogRows();

      // 快照目录：只读该精确工程/空间修订下已登记的快照，逐页取尽后与登记事实一致。
      const registeredSnapshotRefs = async () => {
        const rows = await fixture.postgres.adminPool.query<{ snapshot_ref: unknown }>(
          "SELECT snapshot_ref FROM business.applicability_metadata_snapshots WHERE project_id = $1 AND project_revision_ref = $2::jsonb AND spatial_scope_ref = $3::jsonb",
          [
            state.projectId,
            JSON.stringify(state.projectRevisionRef),
            JSON.stringify(state.businessSpatialScopeRef),
          ],
        );
        return rows.rows.map((row) => JSON.stringify(row.snapshot_ref)).sort();
      };
      const expectedSnapshotRefs = await registeredSnapshotRefs();
      expect(expectedSnapshotRefs.length).toBeGreaterThan(0);

      const pagedSnapshotRefs: string[] = [];
      let snapshotCursor: string | undefined;
      let snapshotGuard = 0;
      for (;;) {
        snapshotGuard += 1;
        expect(snapshotGuard).toBeLessThanOrEqual(expectedSnapshotRefs.length + 1);
        const page = await fixture.registry.readAssessmentEntryContext(
          await entryQuery({
            operation: "applicability-catalog",
            suffix: `snapshot-page-${snapshotGuard}`,
            pageSize: 1,
            ...(snapshotCursor === undefined ? {} : { cursor: snapshotCursor }),
          }),
        );
        expect(page).toMatchObject({
          kind: "succeeded",
          result: { kind: "applicability-catalog" },
        });
        if (page.kind !== "succeeded") return;
        expect(page.result.items).toHaveLength(1);
        // 快照项直接投影已登记快照引用与三个必含适用性维度。
        expect(page.result.items[0]?.metadata).toMatchObject({
          constructionMethod: "variable-diameter-shield",
          stratumCondition: "soft-soil",
          engineeringStage: "shield-expansion",
        });
        pagedSnapshotRefs.push(
          ...page.result.items.map((item) => JSON.stringify(item.snapshotRef)),
        );
        snapshotCursor = page.result.nextCursor;
        if (snapshotCursor === undefined) break;
      }
      expect(pagedSnapshotRefs.sort()).toEqual(expectedSnapshotRefs);

      // 外部事件目录：独立游标、独立页，且只给精确引用与证据，不披露事件工件正文。
      const registeredEvents = await registeredEventRefs(eventScopeRef);
      expect(registeredEvents.length).toBeGreaterThan(1);
      const firstEventPage = await fixture.registry.readAssessmentEntryContext(
        await entryQuery({
          operation: "external-event-catalog",
          suffix: "event-1",
          spatialScopeRef: eventScopeRef,
          pageSize: 1,
        }),
      );
      expect(firstEventPage).toMatchObject({
        kind: "succeeded",
        result: { kind: "external-event-catalog" },
      });
      if (firstEventPage.kind !== "succeeded") return;
      expect(firstEventPage.result.kind).toBe("external-event-catalog");
      expect(firstEventPage.result.items).toHaveLength(1);
      expect(firstEventPage.result.nextCursor).toBeDefined();
      expect(firstEventPage.result.items[0]).toMatchObject({
        spatialScopeRef: eventScopeRef,
        sourceVersionRefs: [state.sourceVersionRef],
        evidenceReferences: [
          {
            sourceVersion: {
              entityId: state.sourceVersionRef.reference.entityId,
              versionId: state.sourceVersionRef.reference.versionId,
            },
          },
        ],
      });
      expect(JSON.stringify(firstEventPage.result.items)).not.toContain("pressure-alarm");

      // 该空间登记了多个事件：逐页取尽后与登记事实逐项一致，不多不少。
      const pagedEventRefs = [
        ...firstEventPage.result.items.map((item) => JSON.stringify(item.riskInput)),
      ];
      let nextCursor = firstEventPage.result.nextCursor;
      let guard = 0;
      while (nextCursor !== undefined) {
        guard += 1;
        expect(guard).toBeLessThanOrEqual(registeredEvents.length + 1);
        const page = await fixture.registry.readAssessmentEntryContext(
          await entryQuery({
            operation: "external-event-catalog",
            suffix: `event-page-${guard}`,
            spatialScopeRef: eventScopeRef,
            pageSize: 1,
            cursor: nextCursor,
          }),
        );
        expect(page).toMatchObject({
          kind: "succeeded",
          result: { kind: "external-event-catalog" },
        });
        if (page.kind !== "succeeded") return;
        expect(page.result.items).toHaveLength(1);
        pagedEventRefs.push(...page.result.items.map((item) => JSON.stringify(item.riskInput)));
        nextCursor = page.result.nextCursor;
      }
      expect(pagedEventRefs.sort()).toEqual(registeredEvents);

      // 两个目录各自续页：外部事件目录的游标不能推进快照目录。
      expect(
        await fixture.registry.readAssessmentEntryContext(
          await entryQuery({
            operation: "applicability-catalog",
            suffix: "cursor-swap",
            pageSize: 1,
            cursor: firstEventPage.result.nextCursor,
          }),
        ),
      ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
      // 适用性游标与精确工程修订的绑定越界（外部事件目录不登记该字段）由下方
      // “C34 目录分页有界、定位稳定与失败闭合”套件用真实适用性游标验证，此处不重复。

      // 预览不写回：快照、事件、读取结果、审计与 Outbox 计数全部不变。
      expect(await countCatalogRows()).toEqual(before);
    }, 120_000);

    it("空目录保持空：错配修订不跨目录补齐，越界空间失败闭合", async () => {
      const state = requireE2eState();

      // 错配工程修订：精确过滤后为空，不解析 latest、也不回退到已登记修订。
      const revisionMismatch = await fixture.registry.readAssessmentEntryContext(
        await entryQuery({
          operation: "applicability-catalog",
          suffix: "revision-mismatch",
          projectRevisionRef: {
            kind: "project-revision",
            reference: { entityId: "project-revision-absent", versionId: "1" },
          },
        }),
      );
      expect(revisionMismatch).toEqual({
        kind: "succeeded",
        result: { kind: "applicability-catalog", items: [] },
      });

      // 获准但未登记任何候选的空间：两个目录各自保持空，不用另一目录补齐。
      expect(
        await fixture.registry.readAssessmentEntryContext(
          await entryQuery({
            operation: "applicability-catalog",
            suffix: "empty-scope-snapshot",
            spatialScopeRef: state.accessRootScopeRef,
          }),
        ),
      ).toEqual({ kind: "succeeded", result: { kind: "applicability-catalog", items: [] } });
      expect(
        await fixture.registry.readAssessmentEntryContext(
          await entryQuery({
            operation: "external-event-catalog",
            suffix: "empty-scope-event",
            spatialScopeRef: state.accessRootScopeRef,
          }),
        ),
      ).toEqual({ kind: "succeeded", result: { kind: "external-event-catalog", items: [] } });

      // 载荷空间越界：授权只覆盖入口根空间，读取在披露目标前失败闭合，
      // 且与“该空间从未创建”返回完全相同的错误，不泄露对象存在性。
      const outside = await fixture.registry.readAssessmentEntryContext(
        await entryQuery({
          operation: "applicability-catalog",
          suffix: "scope-outside-authorization",
          authorizationScopeRef: state.accessRootScopeRef,
          spatialScopeRef: {
            kind: "spatial-scope",
            reference: { entityId: "scope-outside-authorization", versionId: "1" },
          },
        }),
      );
      const absent = await fixture.registry.readAssessmentEntryContext(
        await entryQuery({
          operation: "applicability-catalog",
          suffix: "scope-absent",
          authorizationScopeRef: state.accessRootScopeRef,
          spatialScopeRef: {
            kind: "spatial-scope",
            reference: { entityId: "scope-never-created", versionId: "1" },
          },
        }),
      );
      expect(outside).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
      // 两次读取只应有调用身份差异，错误分类与目标信息完全一致。
      expect(absent).toMatchObject({
        kind: "failed",
        error: {
          code: outside.kind === "failed" ? outside.error.code : "",
          category: outside.kind === "failed" ? outside.error.category : "",
          stageCode: outside.kind === "failed" ? outside.error.stageCode : "",
          requiredCapability: outside.kind === "failed" ? outside.error.requiredCapability : "",
          retryable: false,
        },
      });
    }, 120_000);

    it("目录只提出事件登记的来源引用：不解析 latest、不披露正文、不扩大来源范围", async () => {
      const state = requireE2eState();
      const eventScopeRef = await registeredEventScope();
      const result = await fixture.registry.readAssessmentEntryContext(
        await entryQuery({
          operation: "external-event-catalog",
          suffix: "exact-sources",
          spatialScopeRef: eventScopeRef,
        }),
      );
      expect(result).toMatchObject({
        kind: "succeeded",
        result: { kind: "external-event-catalog" },
      });
      if (result.kind !== "succeeded") return;
      expect(result.result.items.length).toBeGreaterThan(0);

      const rows = await fixture.postgres.adminPool.query<{
        external_risk_event_ref: unknown;
        source_version_refs: unknown;
        spatial_scope_refs: unknown;
        evidence_references: unknown;
        event_artifact_ref: unknown;
      }>(
        "SELECT external_risk_event_ref, source_version_refs, spatial_scope_refs, evidence_references, event_artifact_ref FROM business.external_risk_events WHERE project_id = $1 AND spatial_scope_refs @> jsonb_build_array($2::jsonb)",
        [state.projectId, JSON.stringify(eventScopeRef)],
      );
      const byRef = new Map(
        rows.rows.map((row) => [JSON.stringify(row.external_risk_event_ref), row] as const),
      );
      expect(result.result.items).toHaveLength(byRef.size);
      for (const item of result.result.items) {
        const row = byRef.get(JSON.stringify(item.riskInput));
        if (row === undefined) throw new Error("the catalog returned an unregistered event");
        // 来源引用逐项等于登记值：不合并其它来源、不解析为“当前资料”。
        expect(item.sourceVersionRefs).toEqual(row.source_version_refs);
        expect(item.evidenceReferences).toEqual(row.evidence_references);
        expect(item.spatialScopeRef).toEqual(eventScopeRef);
        // 只给引用与证据定位，不披露事件工件引用或正文。
        expect(JSON.stringify(item)).not.toContain(JSON.stringify(row.event_artifact_ref));
      }
    }, 120_000);

    describe("C34 目录分页有界、定位稳定与失败闭合", () => {
      // 本套件用真实 C06 授权与真实 C11 登记命令构造“合法合成登记事实”，待甲方复核；
      // 目录读取本身不 mock，全部经 PostgreSQL 适配器执行。
      type CatalogScope = {
        readonly access: SpatialScopeRefV1;
        readonly business: SpatialScopeRefV1;
      };
      let childScope: CatalogScope;
      // 前置用例已推进工程修订指针，登记写入必须落在数据库当前修订上。
      let catalogRevision: ProjectRevisionRefV1;

      const currentProjectRevisionRef = async (): Promise<ProjectRevisionRefV1> => {
        const state = requireE2eState();
        const rows = await fixture.postgres.adminPool.query<{
          project_revision_ref: ProjectRevisionRefV1;
        }>(
          `SELECT r.project_revision_ref
             FROM business.engineering_projects p
             JOIN business.engineering_project_revisions r
               ON r.project_id = p.project_id AND r.revision_id = p.current_revision_id
            WHERE p.project_id = $1`,
          [state.projectId],
        );
        return rows.rows[0]!.project_revision_ref;
      };

      const seedSnapshot = async (commandId: string, scope: CatalogScope) => {
        const state = requireE2eState();
        const authorization = await state.authorize(
          commandId,
          [],
          "engineering-data.register-source-delivery",
          [scope.access],
        );
        const result = await fixture.registry.createApplicabilitySnapshot({
          commandId,
          idempotencyKey: commandId,
          projectId: state.projectId,
          actorId: state.managerId,
          issuedAt: "2030-01-01T00:00:00.000Z",
          authorization,
          projectRevisionRef: catalogRevision,
          spatialScopeRef: scope.business,
          formedAt: "2030-01-01T00:00:00.000Z",
        });
        if (result.kind !== "succeeded" || result.result.kind !== "applicability-snapshot")
          throw new Error(`C34 seed ${commandId} failed`);
        return result.result.snapshot.snapshotRef;
      };

      const createChildScope = async (scopeId: string): Promise<CatalogScope> => {
        const state = requireE2eState();
        await fixture.access.administerProject({
          kind: "create-spatial-scope",
          projectId: state.projectId,
          commandId: `${scopeId}-scope`,
          idempotencyKey: `${scopeId}-scope`,
          expectedVersion: "none",
          authorizationContextRef: (await state.authorize(`${scopeId}-scope-actor`))
            .authorizationContextRef,
          scopeId,
          parentScopeRef: state.accessRootScopeRef,
        });
        const revision = await fixture.postgres.adminPool.query<{ revision_id: string }>(
          "SELECT current_revision_id AS revision_id FROM business.access_spatial_scopes WHERE project_id = $1 AND scope_id = $2",
          [state.projectId, scopeId],
        );
        const access: SpatialScopeRefV1 = {
          kind: "spatial-scope",
          reference: { entityId: scopeId, versionId: revision.rows[0]!.revision_id },
        };
        const business: SpatialScopeRefV1 = {
          kind: "spatial-scope",
          reference: { entityId: scopeId, versionId: "1" },
        };
        const revised = await fixture.registry.reviseContext({
          commandId: `${scopeId}-context`,
          idempotencyKey: `${scopeId}-context`,
          projectId: state.projectId,
          actorId: state.managerId,
          issuedAt: "2030-01-01T00:00:00.000Z",
          authorization: await state.authorize(
            `${scopeId}-context`,
            [],
            "engineering-data.register-source-delivery",
            [access],
          ),
          kind: "spatial",
          spatialScopeRef: business,
          projectRevisionRef: catalogRevision,
          expectedVersion: "none",
          name: "C34 分页验收区段",
          worksiteLocation: "合成区段",
          applicabilityOverrides: { engineeringStage: "shield-expansion" },
          status: "active",
          effectivePeriod: { validFrom: "2030-01-01T00:00:00.000Z" },
        });
        if (revised.kind !== "succeeded" || revised.result.kind !== "spatial-revision")
          throw new Error(`C34 child scope ${scopeId} revision failed`);
        return { access, business };
      };

      const readApplicability = async (input: {
        readonly suffix: string;
        readonly scope?: CatalogScope;
        readonly pageSize?: number;
        readonly cursor?: string;
        readonly projectRevisionRef?: ProjectRevisionRefV1;
        readonly authorizationScopeRefs?: readonly SpatialScopeRefV1[];
      }) => {
        const target = input.scope ?? childScope;
        return fixture.registry.readAssessmentEntryContext(
          await entryQuery({
            operation: "applicability-catalog",
            suffix: input.suffix,
            spatialScopeRef: target.business,
            authorizationScopeRefs: input.authorizationScopeRefs ?? [target.access],
            projectRevisionRef: input.projectRevisionRef ?? catalogRevision,
            ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
            ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          }),
        );
      };

      /** 正向目录读取必须先显式断言成功再收窄，避免实现失败被静默 return 掩盖成假绿。 */
      const expectApplicabilityCatalog = (
        result: AssessmentEntryContextReadResultV1,
        context: string,
      ) => {
        expect(result, context).toMatchObject({
          kind: "succeeded",
          result: { kind: "applicability-catalog" },
        });
        if (result.kind !== "succeeded" || result.result.kind !== "applicability-catalog")
          throw new Error(`${context}: 适用性目录读取未成功`);
        return result.result;
      };

      const mutateCursor = (
        cursor: string,
        mutate: (value: { anchor?: unknown; b?: unknown }) => void,
      ): string => {
        const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
          anchor?: unknown;
          b?: unknown;
        };
        mutate(value);
        return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
      };

      beforeAll(async () => {
        catalogRevision = await currentProjectRevisionRef();
        childScope = await createChildScope("c34-paging-scope");
        // 51 条同一 issuedAt 的登记：钉住“页大小 50 + 一条哨兵”边界与同时间 tie-break。
        for (let index = 0; index < 51; index += 1) {
          await seedSnapshot(`c34-paging-${String(index).padStart(2, "0")}`, childScope);
        }
      }, 240_000);

      it("页大小上界 50：51 条登记稳定续页，单页读取有界且预览零写入", async () => {
        const state = requireE2eState();
        const before = await countCatalogRows();

        // 首页取满 50 条并保留续页游标；第二页取尽最后 1 条且无续页。
        const first = await readApplicability({ suffix: "bound-first" });
        expect(first).toMatchObject({
          kind: "succeeded",
          result: { kind: "applicability-catalog" },
        });
        if (first.kind !== "succeeded" || first.result.kind !== "applicability-catalog") return;
        expect(first.result.items).toHaveLength(50);
        const sentinel = first.result.nextCursor;
        expect(sentinel).toBeDefined();
        if (sentinel === undefined) return;
        const second = await readApplicability({ suffix: "bound-second", cursor: sentinel });
        expect(second).toMatchObject({
          kind: "succeeded",
          result: { kind: "applicability-catalog" },
        });
        if (second.kind !== "succeeded" || second.result.kind !== "applicability-catalog") return;
        expect(second.result.items).toHaveLength(1);
        expect(second.result.nextCursor).toBeUndefined();

        // 两页并集恰好等于该精确修订/空间下的全部登记事实：不重复、不遗漏。
        const registered = await fixture.postgres.adminPool.query<{ snapshot_ref: unknown }>(
          "SELECT snapshot_ref FROM business.applicability_metadata_snapshots WHERE project_id = $1 AND project_revision_ref = $2::jsonb AND spatial_scope_ref = $3::jsonb",
          [state.projectId, JSON.stringify(catalogRevision), JSON.stringify(childScope.business)],
        );
        const paged = [...first.result.items, ...second.result.items].map((item) =>
          JSON.stringify(item.snapshotRef),
        );
        expect(paged.sort()).toEqual(
          registered.rows.map((row) => JSON.stringify(row.snapshot_ref)).sort(),
        );

        // 采集真实执行的 SQL 边界：首页 1 次事实查询，续页多 1 次唯一锚点查询，LIMIT 恒为 pageSize+1。
        const pool = createPostgresPool(fixture.postgres.app, "riskflow_app");
        const captured: { sql: string; parameters: readonly unknown[] }[] = [];
        const loggingDb = new Kysely<PostgresDatabase>({
          dialect: new PostgresDialect({ pool }),
          log: (event) => {
            if (event.level === "query")
              captured.push({ sql: event.query.sql, parameters: event.query.parameters });
          },
        });
        const loggingRegistry = new PostgresEngineeringContextSourceRegistry({
          db: loggingDb,
          transactionUnit: fixture.transactionUnit,
          access: fixture.access,
          artifactStore: fixture.artifactStore,
          artifactReferenceGuard: fixture.artifactRegistry,
          monitoringStore: fixture.monitoringStore,
        });
        const limits = (table: string) =>
          captured
            .filter((query) => query.sql.includes(table))
            .flatMap((query) => {
              const match = /limit \$(\d+)/iu.exec(query.sql);
              return match === null ? [] : [Number(query.parameters[Number(match[1]) - 1])];
            });
        try {
          captured.length = 0;
          const loggedFirst = await loggingRegistry.readAssessmentEntryContext(
            await entryQuery({
              operation: "applicability-catalog",
              suffix: "bound-log-first",
              projectRevisionRef: catalogRevision,
              spatialScopeRef: childScope.business,
              authorizationScopeRefs: [childScope.access],
            }),
          );
          expect(loggedFirst).toMatchObject({ kind: "succeeded" });
          expect(limits("applicability_metadata_snapshots")).toEqual([51]);
          if (
            loggedFirst.kind !== "succeeded" ||
            loggedFirst.result.kind !== "applicability-catalog" ||
            loggedFirst.result.nextCursor === undefined
          )
            throw new Error("bounded first page must return an applicability cursor");
          captured.length = 0;
          const loggedSecond = await loggingRegistry.readAssessmentEntryContext(
            await entryQuery({
              operation: "applicability-catalog",
              suffix: "bound-log-second",
              projectRevisionRef: catalogRevision,
              spatialScopeRef: childScope.business,
              authorizationScopeRefs: [childScope.access],
              cursor: loggedFirst.result.nextCursor,
            }),
          );
          expect(loggedSecond).toMatchObject({ kind: "succeeded" });
          // 唯一锚点查询 LIMIT 1 + 事实查询 LIMIT pageSize+1；无累计 offset，页数不放大读取量。
          expect(
            limits("applicability_metadata_snapshots").sort((left, right) => left - right),
          ).toEqual([1, 51]);
        } finally {
          await loggingDb.destroy();
        }

        // 预览不产生业务写入：登记事实、读取结果、审计与 Outbox 计数全部不变。
        expect(await countCatalogRows()).toEqual(before);
      }, 120_000);

      it("登记时间含微秒：等时锚点稳定推进，插入更靠前条目不重复已消费项", async () => {
        const setRecordedAt = async (ref: ApplicabilityMetadataSnapshotRefV1, value: string) => {
          await fixture.postgres.adminPool.query(
            "UPDATE business.applicability_metadata_snapshots SET recorded_at = $3::timestamptz WHERE snapshot_id = $1 AND version_id = $2",
            [ref.reference.entityId, ref.reference.versionId, value],
          );
        };
        // 整数微秒（PostgreSQL 只保留 6 位小数，超过会被四舍五入成同值 tie）。
        const old4 = await seedSnapshot("c34-micro-4", childScope);
        const middle5 = await seedSnapshot("c34-micro-5", childScope);
        const anchor6 = await seedSnapshot("c34-micro-6", childScope);
        await setRecordedAt(old4, "2030-01-02T00:00:00.000004Z");
        await setRecordedAt(middle5, "2030-01-02T00:00:00.000005Z");
        await setRecordedAt(anchor6, "2030-01-02T00:00:00.000006Z");

        const firstPage = expectApplicabilityCatalog(
          await readApplicability({ suffix: "micro-first", pageSize: 1 }),
          "micro-first",
        );
        expect(firstPage.items[0]?.snapshotRef).toEqual(anchor6);
        const cursor = firstPage.nextCursor;
        expect(cursor).toBeDefined();
        if (cursor === undefined) throw new Error("micro-first: 缺少续页游标");

        // 翻页期间插入一条排序在已消费锚点之前（…007）：keyset 必须跳过它且不重复已消费项。
        const newer7 = await seedSnapshot("c34-micro-7", childScope);
        await setRecordedAt(newer7, "2030-01-02T00:00:00.000007Z");

        const secondPage = expectApplicabilityCatalog(
          await readApplicability({ suffix: "micro-second", pageSize: 1, cursor }),
          "micro-second",
        );
        // 微秒精度参与排序：…005 排在 …004 之前，已消费的 …006 不重复。
        expect(secondPage.items[0]?.snapshotRef).toEqual(middle5);
        const next = secondPage.nextCursor;
        expect(next).toBeDefined();
        if (next === undefined) throw new Error("micro-second: 缺少续页游标");
        const thirdPage = expectApplicabilityCatalog(
          await readApplicability({ suffix: "micro-third", pageSize: 1, cursor: next }),
          "micro-third",
        );
        expect(thirdPage.items[0]?.snapshotRef).toEqual(old4);
        // 排序在锚点之前的 …007 不被回头取回，也不把已消费的 …006 带回。
        expect(thirdPage.items[0]?.snapshotRef).not.toEqual(newer7);
        expect(thirdPage.items[0]?.snapshotRef).not.toEqual(anchor6);
      }, 120_000);

      it("长工程修订/空间/实体标识：游标仍满足 512 上限并跨新运行时恢复", async () => {
        const longScope = await createChildScope(`c34-long-scope-${"s".repeat(700)}`);
        const longRevision: ProjectRevisionRefV1 = {
          kind: "project-revision",
          reference: { entityId: `revision-${"r".repeat(600)}`, versionId: "1" },
        };
        const longSuffix = "e".repeat(600);
        const longFirst = await seedSnapshot(`c34-long-${longSuffix}-1`, longScope);
        const longSecond = await seedSnapshot(`c34-long-${longSuffix}-2`, longScope);
        // 合成登记事实：改成超长精确修订引用，验证游标不嵌入领域标识、仍受 512 约束。
        await fixture.postgres.adminPool.query(
          "UPDATE business.applicability_metadata_snapshots SET project_revision_ref = $3::jsonb WHERE snapshot_id IN ($1, $2)",
          [
            longFirst.reference.entityId,
            longSecond.reference.entityId,
            JSON.stringify(longRevision),
          ],
        );

        const firstPage = expectApplicabilityCatalog(
          await readApplicability({
            suffix: "long-first",
            scope: longScope,
            pageSize: 1,
            projectRevisionRef: longRevision,
          }),
          "long-first",
        );
        expect(firstPage.items).toHaveLength(1);
        const cursor = firstPage.nextCursor;
        expect(cursor).toBeDefined();
        if (cursor === undefined) throw new Error("long-first: 缺少续页游标");
        expect(cursor.length).toBeLessThanOrEqual(512);

        // 新运行时（独立连接池 + 新 registry 实例）用同一数据库的续页游标恢复。
        const freshRuntime = createPostgresRuntime(fixture.postgres.app, "riskflow_app");
        try {
          const freshRegistry = new PostgresEngineeringContextSourceRegistry({
            db: freshRuntime.db,
            transactionUnit: fixture.transactionUnit,
            access: fixture.access,
            artifactStore: fixture.artifactStore,
            artifactReferenceGuard: fixture.artifactRegistry,
            monitoringStore: fixture.monitoringStore,
          });
          const resumed = expectApplicabilityCatalog(
            await freshRegistry.readAssessmentEntryContext(
              await entryQuery({
                operation: "applicability-catalog",
                suffix: "long-second",
                spatialScopeRef: longScope.business,
                authorizationScopeRefs: [longScope.access],
                projectRevisionRef: longRevision,
                pageSize: 1,
                cursor,
              }),
            ),
            "long-second",
          );
          expect(resumed.items).toHaveLength(1);
          expect(resumed.nextCursor).toBeUndefined();
        } finally {
          await freshRuntime.close();
        }
      }, 240_000);

      it("错目录/空间/修订/授权摘要/伪锚点一律同形拒绝", async () => {
        const state = requireE2eState();
        const denied = { kind: "failed", error: { code: "AUTHORIZATION_DENIED" } } as const;
        const base = expectApplicabilityCatalog(
          await readApplicability({ suffix: "guard-base", pageSize: 1 }),
          "guard-base",
        );
        const cursor = base.nextCursor;
        expect(cursor).toBeDefined();
        if (cursor === undefined) throw new Error("guard-base: 缺少续页游标");

        // 同一适用性游标在多种错配下都必须同形拒绝且不披露目标存在性；以表驱动逐项覆盖。
        const applicabilityQuery = (
          suffix: string,
          overrides: {
            readonly spatialScopeRef?: SpatialScopeRefV1;
            readonly authorizationScopeRefs?: readonly SpatialScopeRefV1[];
            readonly projectRevisionRef?: ProjectRevisionRefV1;
            readonly cursor?: string;
          },
        ) =>
          entryQuery({
            operation: "applicability-catalog",
            suffix,
            spatialScopeRef: overrides.spatialScopeRef ?? childScope.business,
            authorizationScopeRefs: overrides.authorizationScopeRefs ?? [childScope.access],
            ...(overrides.projectRevisionRef === undefined
              ? {}
              : { projectRevisionRef: overrides.projectRevisionRef }),
            pageSize: 1,
            cursor: overrides.cursor ?? cursor,
          });
        const deniedQueries: readonly {
          readonly name: string;
          readonly build: (suffix: string) => Promise<AssessmentEntryContextReadQueryV1>;
        }[] = [
          {
            name: "错目录",
            build: (suffix) =>
              entryQuery({
                operation: "external-event-catalog",
                suffix,
                spatialScopeRef: childScope.business,
                authorizationScopeRefs: [childScope.access],
                pageSize: 1,
                cursor,
              }),
          },
          {
            name: "错空间修订",
            build: (suffix) => applicabilityQuery(suffix, { spatialScopeRef: childScope.access }),
          },
          {
            name: "错工程修订",
            build: (suffix) =>
              applicabilityQuery(suffix, {
                projectRevisionRef: {
                  kind: "project-revision",
                  reference: { entityId: state.projectId, versionId: "revision-not-current" },
                },
              }),
          },
          {
            name: "伪 UUID 锚点",
            build: (suffix) =>
              applicabilityQuery(suffix, {
                cursor: mutateCursor(cursor, (value) => {
                  value.anchor = "00000000-0000-4000-8000-000000000000";
                }),
              }),
          },
          {
            name: "非法锚点",
            build: (suffix) =>
              applicabilityQuery(suffix, {
                cursor: mutateCursor(cursor, (value) => {
                  value.anchor = "not-a-uuid";
                }),
              }),
          },
          {
            name: "伪造绑定摘要",
            build: (suffix) =>
              applicabilityQuery(suffix, {
                cursor: mutateCursor(cursor, (value) => {
                  value.b = "0".repeat(64);
                }),
              }),
          },
          {
            name: "损坏游标",
            build: (suffix) => applicabilityQuery(suffix, { cursor: "!!!not-a-cursor!!!" }),
          },
        ];
        for (const [index, testCase] of deniedQueries.entries()) {
          const result = await fixture.registry.readAssessmentEntryContext(
            await testCase.build(`guard-${index}`),
          );
          expect(result, testCase.name).toMatchObject(denied);
        }

        // 错授权摘要：payload 空间与操作不变，但该空间的当前获准修订已推进，重验出的摘要与旧游标不符。
        const accessRevision = await fixture.postgres.adminPool.query<{ revision_no: number }>(
          `SELECT r.revision_no
             FROM business.access_spatial_scopes s
             JOIN business.access_spatial_scope_revisions r ON r.revision_id = s.current_revision_id
            WHERE s.project_id = $1 AND s.scope_id = $2`,
          [state.projectId, childScope.access.reference.entityId],
        );
        await fixture.access.administerProject({
          kind: "revise-spatial-scope",
          projectId: state.projectId,
          commandId: "c34-guard-revise-access",
          idempotencyKey: "c34-guard-revise-access",
          expectedVersion: {
            entityId: childScope.access.reference.entityId,
            versionId: String(accessRevision.rows[0]!.revision_no),
          },
          authorizationContextRef: (await state.authorize("c34-guard-revise-access-actor"))
            .authorizationContextRef,
          scopeId: childScope.access.reference.entityId,
          status: "active",
          parentScopeRef: state.accessRootScopeRef,
        });
        const advanced = await fixture.postgres.adminPool.query<{ revision_id: string }>(
          "SELECT current_revision_id AS revision_id FROM business.access_spatial_scopes WHERE project_id = $1 AND scope_id = $2",
          [state.projectId, childScope.access.reference.entityId],
        );
        const advancedAccess: SpatialScopeRefV1 = {
          kind: "spatial-scope",
          reference: {
            entityId: childScope.access.reference.entityId,
            versionId: advanced.rows[0]!.revision_id,
          },
        };
        expect(
          await fixture.registry.readAssessmentEntryContext(
            await applicabilityQuery("guard-cross-digest", {
              authorizationScopeRefs: [advancedAccess],
            }),
          ),
        ).toMatchObject(denied);
        // 该空间授权修订已推进：后续用例改用新获准引用。
        childScope = { access: advancedAccess, business: childScope.business };
      }, 120_000);

      it("页内已登记事实损坏时类型化技术失败，不退化为空页", async () => {
        const state = requireE2eState();
        const target = await fixture.postgres.adminPool.query<{
          catalog_cursor_key: string;
          applicability_metadata: unknown;
        }>(
          `SELECT catalog_cursor_key, applicability_metadata
             FROM business.applicability_metadata_snapshots
            WHERE project_id = $1 AND project_revision_ref = $2::jsonb AND spatial_scope_ref = $3::jsonb
            ORDER BY recorded_at DESC, snapshot_id ASC, version_id ASC
            LIMIT 1`,
          [state.projectId, JSON.stringify(catalogRevision), JSON.stringify(childScope.business)],
        );
        const row = target.rows[0];
        if (row === undefined) throw new Error("no applicability row to corrupt");
        try {
          await fixture.postgres.adminPool.query(
            `UPDATE business.applicability_metadata_snapshots SET applicability_metadata = '{"broken":true}'::jsonb WHERE catalog_cursor_key = $1`,
            [row.catalog_cursor_key],
          );
          expect(
            await readApplicability({ suffix: "corrupt-applicability", pageSize: 1 }),
          ).toMatchObject({
            kind: "failed",
            error: { code: "TERMINAL_FAILURE", category: "technical", retryable: false },
          });
        } finally {
          await fixture.postgres.adminPool.query(
            `UPDATE business.applicability_metadata_snapshots SET applicability_metadata = $2::jsonb WHERE catalog_cursor_key = $1`,
            [row.catalog_cursor_key, JSON.stringify(row.applicability_metadata)],
          );
        }

        // 外部事件目录同形：登记引用不可解析即技术失败，不退化为“该事件不存在”。
        const eventScopeRef = await registeredEventScope();
        const eventRow = await fixture.postgres.adminPool.query<{
          catalog_cursor_key: string;
          external_risk_event_ref: unknown;
        }>(
          `SELECT catalog_cursor_key, external_risk_event_ref
             FROM business.external_risk_events
            WHERE project_id = $1 AND spatial_scope_refs @> jsonb_build_array($2::jsonb)
            ORDER BY recorded_at DESC, external_risk_event_id ASC, version_id ASC
            LIMIT 1`,
          [state.projectId, JSON.stringify(eventScopeRef)],
        );
        const eventTarget = eventRow.rows[0];
        if (eventTarget === undefined) throw new Error("no external event row to corrupt");
        try {
          await fixture.postgres.adminPool.query(
            `UPDATE business.external_risk_events SET external_risk_event_ref = '{"kind":"corrupt"}'::jsonb WHERE catalog_cursor_key = $1`,
            [eventTarget.catalog_cursor_key],
          );
          expect(
            await fixture.registry.readAssessmentEntryContext(
              await entryQuery({
                operation: "external-event-catalog",
                suffix: "corrupt-external",
                spatialScopeRef: eventScopeRef,
                pageSize: 1,
              }),
            ),
          ).toMatchObject({ kind: "failed", error: { code: "TERMINAL_FAILURE" } });
        } finally {
          await fixture.postgres.adminPool.query(
            `UPDATE business.external_risk_events SET external_risk_event_ref = $2::jsonb WHERE catalog_cursor_key = $1`,
            [eventTarget.catalog_cursor_key, JSON.stringify(eventTarget.external_risk_event_ref)],
          );
        }
      }, 120_000);
    });
  });

  it("denies historical read resolutions once current authorization is revoked", async () => {
    const state = requireE2eState();
    const segmentsQueryId = "c11-revoked-source-segments";
    const segmentsQuery = {
      queryId: segmentsQueryId,
      projectId: state.projectId,
      actorId: state.managerId,
      requestedAt: "2030-01-01T00:00:00.000Z",
      authorization: await state.authorize(
        segmentsQueryId,
        [state.sourceVersionRef],
        "engineering-data.source-segments",
      ),
      kind: "source-segments",
      payload: { sourceSegmentSetRef: state.segmentSetRef },
    } satisfies EngineeringDataQueryV1;
    const segmentsResultRef = {
      kind: "query-result" as const,
      reference: { entityId: `source-segments-${segmentsQueryId}`, versionId: "1" },
    };
    expect(await fixture.registry.read(segmentsQuery)).toEqual({
      kind: "succeeded",
      result: { queryResultRef: segmentsResultRef },
    });
    const segmentsResolveId = "c11-revoked-resolve-source-segments";
    const segmentsResolveAuthorization = await state.authorize(
      segmentsResolveId,
      [state.sourceVersionRef],
      "engineering-data.source-segments",
    );
    const evidenceQueryId = "c11-revoked-evidence-access";
    const evidenceQuery = {
      queryId: evidenceQueryId,
      projectId: state.projectId,
      actorId: state.managerId,
      requestedAt: "2030-01-01T00:00:00.000Z",
      authorization: await state.authorize(
        evidenceQueryId,
        [state.sourceVersionRef],
        "engineering-data.evidence-access",
      ),
      kind: "evidence-access",
      payload: {
        evidenceReferences: [
          {
            locator: { sourceSegmentId: state.segmentIds[0]! },
            sourceVersion: state.sourceVersionRef.reference,
          },
        ],
        purposeCode: "risk-identification.evidence-access",
      },
    } satisfies EngineeringDataQueryV1;
    const evidenceResultRef = {
      kind: "query-result" as const,
      reference: { entityId: `evidence-access-${evidenceQueryId}`, versionId: "1" },
    };
    expect(await fixture.registry.read(evidenceQuery)).toEqual({
      kind: "succeeded",
      result: { queryResultRef: evidenceResultRef },
    });
    const evidenceResolveId = "c11-revoked-resolve-evidence-access";
    const evidenceResolveAuthorization = await state.authorize(
      evidenceResolveId,
      [state.sourceVersionRef],
      "engineering-data.evidence-access",
    );
    const projectRow = await fixture.postgres.adminPool.query<{ access_version: number }>(
      "SELECT access_version FROM business.access_projects WHERE project_id = $1",
      [state.projectId],
    );
    const suspension = await fixture.access.administerProject({
      kind: "suspend-project",
      projectId: state.projectId,
      commandId: "c11-suspend-project",
      idempotencyKey: "c11-suspend-project",
      expectedVersion: {
        entityId: state.projectId,
        versionId: String(projectRow.rows[0]!.access_version),
      },
      authorizationContextRef: state.adminContextRef,
    });
    expect(suspension.kind).toBe("project");

    expect(
      await fixture.registry.resolveReadQuery({
        queryResultRef: segmentsResultRef,
        invocationId: segmentsResolveId,
        projectId: state.projectId,
        actorId: state.managerId,
        requestedAt: "2030-01-01T00:00:02.000Z",
        authorization: segmentsResolveAuthorization,
      }),
    ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    expect(
      await fixture.registry.resolveReadQuery({
        queryResultRef: evidenceResultRef,
        invocationId: evidenceResolveId,
        projectId: state.projectId,
        actorId: state.managerId,
        requestedAt: "2030-01-01T00:00:02.000Z",
        authorization: evidenceResolveAuthorization,
      }),
    ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    expect(await fixture.registry.read(segmentsQuery)).toMatchObject({
      kind: "failed",
      error: { code: "AUTHORIZATION_DENIED" },
    });
    const retained = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.engineering_data_read_query_results WHERE query_result_id IN ($1, $2)",
      [`source-segments-${segmentsQueryId}`, `evidence-access-${evidenceQueryId}`],
    );
    expect(retained.rows[0]?.count).toBe("2");
  });

  describe("C25 assessment-preparation freeze", () => {
    const project = "project-c25-freeze";
    const now = "2030-01-01T00:00:00.000Z";
    // 子套件自带 fixture，避免依赖前序用例留下的账号、密码与授权状态。
    let fixture: EngineeringContextSourcePostgresFixture;
    let world:
      | {
          readonly managerId: string;
          readonly sessionToken: string;
          readonly projectRevisionRef: ProjectRevisionRefV1;
          readonly businessSpatialScopeRef: SpatialScopeRefV1;
          readonly accessRootScopeRef: SpatialScopeRefV1;
          readonly applicabilitySnapshotRef: ApplicabilityMetadataSnapshotRefV1;
          /** C19 准备读取声明的来源范围：与准备快照内的来源证据同源。 */
          readonly sourceVersionRef: SourceVersionRefV1;
        }
      | undefined;

    const requireWorld = () => {
      if (world === undefined) throw new Error("C25 freeze world is not initialized");
      return world;
    };

    const authorizeBranch = async (
      invocationId: string,
      branch:
        | "engineering-data.register-source-delivery"
        | "engineering-data.evidence-access"
        | "engineering-data.assessment-preparation"
        // C19 评估依据准备读取固定使用自己的分支；C11 不枚举或复用其它分支的上下文。
        | "knowledge-modeling.assessment-basis",
      sourceVersionRefs: readonly SourceVersionRefV1[] = [],
      // 业务空间是准备快照自身保存的空间身份；C11 按该身份核对授权空间，
      // 因此读取场景必须按业务空间而非根空间签发。
      spatialScopeRef?: SpatialScopeRefV1,
    ) => {
      const state = requireWorld();
      return (
        await fixture.access.authorize({
          invocation: { kind: "human-session", sessionToken: state.sessionToken },
          invocationId,
          projectId: project,
          branch,
          requestedSpatialScopeRefs: [spatialScopeRef ?? state.accessRootScopeRef],
          requestedSourceVersionRefs: [...sourceVersionRefs],
        })
      ).context;
    };

    beforeAll(async () => {
      fixture = await startEngineeringContextSourceFixture({
        now: () => new Date(now),
      });
      await bootstrapInitialSystemAdministrator({
        connection: fixture.postgres.migrator,
        loginName: "c25-admin",
        displayName: "C25 Administrator",
        password: "c25-admin-password",
        accountId: "c25-admin-account",
        now: () => new Date(now),
      });
      const adminLogin = await fixture.access.login({
        kind: "login",
        loginAttemptId: "c25-admin-login",
        loginName: "c25-admin",
        password: "c25-admin-password",
      });
      const adminChanged = await fixture.access.changePassword({
        kind: "change-password",
        sessionToken: adminLogin.sessionToken,
        newPassword: "c25-admin-password-changed",
      });
      const manager = await fixture.access.administerIdentity({
        kind: "create-account",
        commandId: "c25-create-manager",
        idempotencyKey: "c25-create-manager",
        expectedVersion: "none",
        authorizationContextRef: adminChanged.systemAdministrationContextRef!,
        loginName: "c25-manager",
        displayName: "C25 Manager",
        password: "c25-manager-password",
      });
      const managerLogin = await fixture.access.login({
        kind: "login",
        loginAttemptId: "c25-manager-login",
        loginName: "c25-manager",
        password: "c25-manager-password",
      });
      const managerChanged = await fixture.access.changePassword({
        kind: "change-password",
        sessionToken: managerLogin.sessionToken,
        newPassword: "c25-manager-password-changed",
      });
      await fixture.access.administerProject({
        kind: "open-project",
        projectId: project,
        commandId: "c25-open-project",
        idempotencyKey: "c25-open-project",
        expectedVersion: "none",
        authorizationContextRef: adminChanged.systemAdministrationContextRef!,
        initialRiskManagerAccountId: manager.resultRef.entityId,
      });
      const root = await fixture.postgres.adminPool.query<{
        scope_id: string;
        revision_id: string;
      }>(
        "SELECT scope_id, current_revision_id AS revision_id FROM business.access_spatial_scopes WHERE project_id = $1",
        [project],
      );
      const accessRootScopeRef = {
        kind: "spatial-scope" as const,
        reference: { entityId: root.rows[0]!.scope_id, versionId: root.rows[0]!.revision_id },
      };
      world = {
        managerId: manager.resultRef.entityId,
        sessionToken: managerChanged.sessionToken,
        projectRevisionRef: {
          kind: "project-revision",
          reference: { entityId: "", versionId: "1" },
        },
        businessSpatialScopeRef: accessRootScopeRef,
        accessRootScopeRef,
        applicabilitySnapshotRef: {
          kind: "applicability-metadata-snapshot",
          reference: { entityId: "", versionId: "1" },
        },
      };
      const projectAuthorization = await authorizeBranch(
        "c25-project",
        "engineering-data.register-source-delivery",
      );
      const projectResult = await fixture.registry.reviseContext({
        commandId: "c25-project",
        idempotencyKey: "c25-project",
        projectId: project,
        actorId: manager.resultRef.entityId,
        issuedAt: now,
        authorization: projectAuthorization,
        kind: "project",
        expectedVersion: "none",
        name: "C25 工程",
        lifecycle: "preparing",
        applicabilityMetadata: {
          constructionMethod: "variable-diameter-shield",
          stratumCondition: "soft-soil",
          engineeringStage: "shield-expansion",
        },
        effectivePeriod: { validFrom: now },
      });
      if (projectResult.kind !== "succeeded" || projectResult.result.kind !== "project-revision") {
        throw new Error("C25 project revision failed");
      }
      const spatialAuthorization = await authorizeBranch(
        "c25-spatial",
        "engineering-data.register-source-delivery",
      );
      const spatialResult = await fixture.registry.reviseContext({
        commandId: "c25-spatial",
        idempotencyKey: "c25-spatial",
        projectId: project,
        actorId: manager.resultRef.entityId,
        issuedAt: now,
        authorization: spatialAuthorization,
        kind: "spatial",
        spatialScopeRef: accessRootScopeRef,
        projectRevisionRef: projectResult.result.revision.projectRevisionRef,
        expectedVersion: "none",
        name: "C25 区间",
        worksiteLocation: "C25 工地",
        applicabilityOverrides: {},
        status: "active",
        effectivePeriod: { validFrom: now },
      });
      if (spatialResult.kind !== "succeeded" || spatialResult.result.kind !== "spatial-revision") {
        throw new Error("C25 spatial revision failed");
      }
      const snapshotAuthorization = await authorizeBranch(
        "c25-applicability",
        "engineering-data.register-source-delivery",
      );
      const snapshot = await fixture.registry.createApplicabilitySnapshot({
        commandId: "c25-applicability",
        idempotencyKey: "c25-applicability",
        projectId: project,
        actorId: manager.resultRef.entityId,
        issuedAt: now,
        authorization: snapshotAuthorization,
        projectRevisionRef: projectResult.result.revision.projectRevisionRef,
        spatialScopeRef: spatialResult.result.revision.spatialScopeRef,
        formedAt: now,
      });
      if (snapshot.kind !== "succeeded" || snapshot.result.kind !== "applicability-snapshot") {
        throw new Error("C25 applicability snapshot failed");
      }
      // C19 评估依据准备读取必须声明该工程的真实来源版本：先登记一份交付，
      // 让「授权声明的来源范围」与「准备快照内的来源证据」同源可比。
      const sourceAuthorization = await authorizeBranch(
        "c25-basis-source",
        "engineering-data.register-source-delivery",
      );
      const sourceArtifact = await fixture.artifactStore.put(
        {
          schemaVersion: "1",
          commandId: "c25-basis-source:put",
          idempotencyKey: "c25-basis-source:put",
          projectId: project,
          actorId: manager.resultRef.entityId,
          issuedAt: now,
          authorization: sourceAuthorization,
          requiredCapability: sourceAuthorization.grantedCapabilities[0]!,
          artifactId: "c25-basis-source",
          artifactKind: "content",
          purposeCode: "engineering-data.register-source-delivery",
          mediaType: "application/json",
          parentArtifactRefs: [],
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        },
        (async function* () {
          yield new TextEncoder().encode(JSON.stringify({ schemaVersion: "1" }));
        })(),
      );
      const metadataArtifact = await fixture.artifactStore.put(
        {
          schemaVersion: "1",
          commandId: "c25-basis-source-metadata:put",
          idempotencyKey: "c25-basis-source-metadata:put",
          projectId: project,
          actorId: manager.resultRef.entityId,
          issuedAt: now,
          authorization: sourceAuthorization,
          requiredCapability: sourceAuthorization.grantedCapabilities[0]!,
          artifactId: "c25-basis-source-metadata",
          artifactKind: "content",
          purposeCode: "engineering-data.register-source-delivery",
          mediaType: "application/json",
          parentArtifactRefs: [],
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        },
        (async function* () {
          yield new TextEncoder().encode(
            JSON.stringify({
              schemaVersion: "1",
              projectRevisionRef: projectResult.result.revision.projectRevisionRef,
              spatialScopeRefs: [spatialResult.result.revision.spatialScopeRef],
              registeredByAccountId: manager.resultRef.entityId,
              sourceItemId: "c25-basis-source-item",
              sourceItemName: "C25 basis source",
              sourceCategory: "engineering-document",
              sourceMetadata: {
                documentType: "c25-basis",
                formedAt: now,
                sourceOrganization: "owner",
              },
              descriptor: { kind: "file-upload", contentFingerprint: "c25-basis-source" },
              applicabilityMetadataSnapshotRef: snapshot.result.snapshot.snapshotRef,
            }),
          );
        })(),
      );
      const delivery = await fixture.registry.apply({
        commandId: "c25-basis-source",
        idempotencyKey: "c25-basis-source",
        projectId: project,
        actorId: manager.resultRef.entityId,
        issuedAt: now,
        authorization: sourceAuthorization,
        kind: "register-source-delivery",
        payload: {
          sourceConnectionRef: { entityId: "c25-basis-connection", versionId: "1" },
          deliveryKey: "c25-basis-source",
          sourceArtifactRef: sourceArtifact.artifactRef,
          metadataArtifactRef: metadataArtifact.artifactRef,
          occurredAt: now,
        },
      } as never);
      if (delivery.kind !== "succeeded" || delivery.result.kind !== "register-source-delivery") {
        throw new Error(`C25 basis source delivery failed: ${JSON.stringify(delivery)}`);
      }
      world = {
        managerId: manager.resultRef.entityId,
        sessionToken: managerChanged.sessionToken,
        projectRevisionRef: projectResult.result.revision.projectRevisionRef,
        businessSpatialScopeRef: spatialResult.result.revision.spatialScopeRef,
        accessRootScopeRef,
        applicabilitySnapshotRef: snapshot.result.snapshot.snapshotRef,
        sourceVersionRef: delivery.result.sourceVersionRef,
      };
    }, 240_000);

    afterAll(async () => {
      await fixture?.close();
    }, 60_000);

    const factsReader = {
      readRiskInputFacts: async (input: {
        readonly authorization: AuthorizationContextV1;
        readonly riskInput: {
          readonly kind: string;
          readonly reference: { readonly entityId: string; readonly versionId: string };
        };
      }) => {
        // 事实证据必须落在该 world 登记的真实来源版本上：准备快照会原样保存这些来源引用，
        // 后续 C19 读取按同一引用复验。用固定假版本会让读取按越权关闭。
        const state = requireWorld();
        const sourceVersion = state.sourceVersionRef.reference;
        return {
          kind: "succeeded" as const,
          facts: {
            schemaVersion: "1" as const,
            projectId: input.authorization.projectId,
            riskInput: input.riskInput,
            fields: [
              {
                documentType: "standardized-risk-record",
                fieldPath: ["riskSource"],
                value: "盾构机正面",
                evidenceReferences: [
                  { locator: { sourceSegmentId: "c25-segment-1" }, sourceVersion },
                ],
              },
            ],
            evidenceReferences: [{ locator: { sourceSegmentId: "c25-segment-1" }, sourceVersion }],
          },
        };
      },
    };

    const authorizeDownstream = async (request: {
      readonly branch: string;
      readonly invocationId: string;
      readonly projectId: string;
      readonly requestedAt: string;
      readonly requestedSpatialScopeRefs?: readonly SpatialScopeRefV1[];
      readonly requestedSourceVersionRefs?: readonly SourceVersionRefV1[];
    }) => {
      const state = requireWorld();
      return (
        await fixture.access.authorize({
          invocation: { kind: "human-session", sessionToken: state.sessionToken },
          invocationId: request.invocationId,
          projectId: request.projectId,
          branch: request.branch as "engineering-data.evidence-access",
          requestedSpatialScopeRefs: [...(request.requestedSpatialScopeRefs ?? [])],
          requestedSourceVersionRefs: [...(request.requestedSourceVersionRefs ?? [])],
        })
      ).context;
    };

    const openRegistry = () =>
      new PostgresEngineeringContextSourceRegistry({
        db: fixture.runtime.db,
        transactionUnit: fixture.transactionUnit,
        access: fixture.access,
        artifactStore: fixture.artifactStore,
        artifactReferenceGuard: fixture.artifactRegistry,
        monitoringStore: fixture.monitoringStore,
        riskInputFacts: factsReader as never,
        authorizeDownstream: authorizeDownstream as never,
      });

    const freezeCommand = async (
      suffix: string,
      withMonitoring: boolean,
      // 入口授权声明的来源范围。缺省为空：既有冻结用例不要求来源证据同源；
      // C19 准备读取场景必须与读取授权声明同一来源，否则按越权关闭。
      sourceVersionRefs: readonly SourceVersionRefV1[] = [],
    ) => {
      const state = requireWorld();
      const authorization = await authorizeBranch(
        `c25-freeze-${suffix}`,
        "engineering-data.assessment-preparation",
        sourceVersionRefs,
      );
      return {
        commandId: `c25-freeze-${suffix}`,
        idempotencyKey: `c25-freeze-${suffix}`,
        projectId: project,
        actorId: state.managerId,
        issuedAt: now,
        authorization,
        kind: "assessment-preparation" as const,
        payload: {
          riskInput: StandardizedRiskRecordRefV1Schema.parse({
            kind: "standardized-risk-record",
            reference: { entityId: "c25-risk-record", versionId: "1" },
          }),
          projectRevisionRef: state.projectRevisionRef,
          spatialScopeRef: state.businessSpatialScopeRef,
          applicabilityMetadataSnapshotRef: state.applicabilitySnapshotRef,
          entryMode: "assess" as const,
          triggerReasonCode: "manual-assessment",
          ...(withMonitoring
            ? {
                monitoringSnapshotRefs: [
                  {
                    kind: "monitoring-snapshot" as const,
                    reference: { entityId: "c25-missing-snapshot", versionId: "1" },
                  },
                ],
              }
            : {}),
        },
      } satisfies EngineeringFreezeCommandV1;
    };

    it("未注入事实 reader 与授权签发接缝时关闭失败", async () => {
      const state = requireWorld();
      const closed = new PostgresEngineeringContextSourceRegistry({
        db: fixture.runtime.db,
        transactionUnit: fixture.transactionUnit,
        access: fixture.access,
        artifactStore: fixture.artifactStore,
        artifactReferenceGuard: fixture.artifactRegistry,
        monitoringStore: fixture.monitoringStore,
      });
      const command = await freezeCommand("closed", false);
      expect(await closed.freeze(command)).toMatchObject({
        kind: "failed",
        error: { code: "UNSUPPORTED_CONTRACT" },
      });
      expect(state.managerId).toBeDefined();
    });

    it("注入接缝后原样冻结入口语义并发布 engineering.inputs-ready.v1", async () => {
      requireWorld();
      const registry = openRegistry();
      const command = await freezeCommand("open", false);
      const frozen = await registry.freeze(command);
      expect(frozen).toMatchObject({
        kind: "succeeded",
        result: { kind: "assessment-preparation" },
      });
      if (frozen.kind !== "succeeded" || frozen.result.kind !== "assessment-preparation") return;
      const preparationSnapshotRef = frozen.result.assessmentPreparationSnapshotRef;
      expect(preparationSnapshotRef.reference.versionId).toBe("1");

      const replay = await registry.freeze(command);
      expect(replay).toMatchObject({
        kind: "succeeded",
        result: {
          kind: "assessment-preparation",
          assessmentPreparationSnapshotRef: preparationSnapshotRef,
        },
      });

      // 本桩的风险事实引用的是未登记来源资料，读取必须因来源不可验而关闭失败；
      // 真实登记来源下的读取成功路径由 C25 适配器套件覆盖。
      const readAuthorization = await authorizeBranch(
        "c25-freeze-read",
        "engineering-data.evidence-access",
      );
      const read = await registry.readAssessmentPreparationContext({
        requestId: "c25-freeze-read",
        idempotencyKey: "c25-freeze-read",
        requestedAt: now,
        authorization: readAuthorization,
        preparationSnapshotRef,
      });
      expect(read).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });

      // 未声明来源的授权同样不能读出含来源证据的准备快照。
      const undeclaredAuthorization = await authorizeBranch(
        "c25-freeze-read-undeclared",
        "engineering-data.evidence-access",
      );
      const undeclared = await registry.readAssessmentPreparationContext({
        requestId: "c25-freeze-read-undeclared",
        idempotencyKey: "c25-freeze-read-undeclared",
        requestedAt: now,
        authorization: undeclaredAuthorization,
        preparationSnapshotRef,
      });
      expect(undeclared).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });

      const missing = await registry.readAssessmentPreparationContext({
        requestId: "c25-freeze-read-missing",
        idempotencyKey: "c25-freeze-read-missing",
        requestedAt: now,
        authorization: readAuthorization,
        preparationSnapshotRef: {
          kind: "assessment-preparation-snapshot",
          reference: { entityId: "c25-missing-preparation", versionId: "1" },
        },
      });
      expect(missing).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });

      const events = await fixture.postgres.adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM outbox.events WHERE event_type = 'engineering.inputs-ready.v1' AND aggregate_ref ->> 'reference' LIKE '%assessment-preparation%'",
      );
      expect(Number(events.rows[0]?.count ?? "0")).toBeGreaterThanOrEqual(1);
    }, 120_000);

    it("下游签发接缝返回额外来源或空间时拒绝冻结且零准备事实", async () => {
      const state = requireWorld();
      const snapshotsBefore = await fixture.postgres.adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM business.assessment_preparation_snapshots WHERE project_id = $1",
        [project],
      );
      const eventsBefore = await fixture.postgres.adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM outbox.events WHERE event_type = 'engineering.inputs-ready.v1'",
      );
      for (const widen of [
        { extraSource: true, extraSpace: false },
        { extraSource: false, extraSpace: true },
      ]) {
        const widening = new PostgresEngineeringContextSourceRegistry({
          db: fixture.runtime.db,
          transactionUnit: fixture.transactionUnit,
          access: fixture.access,
          artifactStore: fixture.artifactStore,
          artifactReferenceGuard: fixture.artifactRegistry,
          monitoringStore: fixture.monitoringStore,
          riskInputFacts: factsReader as never,
          authorizeDownstream: (async (request: {
            readonly branch: string;
            readonly invocationId: string;
          }) => ({
            ...(await authorizeDownstream(request)),
            ...(widen.extraSource
              ? {
                  sourceAccessGrantRefs: [
                    {
                      kind: "source-access-grant" as const,
                      reference: { entityId: "grant-not-granted", versionId: "1" },
                    },
                  ],
                }
              : {}),
            ...(widen.extraSpace
              ? {
                  spatialScopeRefs: [
                    state.accessRootScopeRef,
                    {
                      kind: "spatial-scope" as const,
                      reference: { entityId: "scope-not-granted", versionId: "1" },
                    },
                  ],
                }
              : {}),
          })) as never,
        });
        const result = await widening.freeze(
          await freezeCommand(`widen-${widen.extraSource}-${widen.extraSpace}`, false),
        );
        expect(result, JSON.stringify(widen)).toMatchObject({
          kind: "failed",
          error: { code: "AUTHORIZATION_DENIED" },
        });
      }
      const snapshotsAfter = await fixture.postgres.adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM business.assessment_preparation_snapshots WHERE project_id = $1",
        [project],
      );
      const eventsAfter = await fixture.postgres.adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM outbox.events WHERE event_type = 'engineering.inputs-ready.v1'",
      );
      expect(Number(snapshotsAfter.rows[0]?.count)).toBe(Number(snapshotsBefore.rows[0]?.count));
      expect(Number(eventsAfter.rows[0]?.count)).toBe(Number(eventsBefore.rows[0]?.count));
    }, 120_000);

    it("监测引用先经 C14 受权读取：不存在的快照整体失败且零准备事实", async () => {
      const registry = openRegistry();
      const command = await freezeCommand("monitoring", true);
      const result = await registry.freeze(command);
      expect(result.kind).toBe("failed");
      const rows = await fixture.postgres.adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM business.assessment_preparation_snapshots WHERE project_id = $1",
        [project],
      );
      expect(Number(rows.rows[0]?.count ?? "0")).toBe(1);
    }, 120_000);

    /**
     * IP-04 / C19 delta：评估依据准备投影由 C11 所属域提供。投影只含准备身份、工程修订与
     * 冻结适用性六项——不含清洗任务、结果工件、配置集合或兼容引用，因为那些是规则编制
     * 来源与 C18/C19 的核验对象。读取固定 `knowledge-modeling.assessment-basis` 分支，
     * 与 C25 精确准备读取的 `engineering-data.evidence-access` 分支互不通用。
     */
    describe("C19 评估依据准备投影读取", () => {
      const freezeAndRead = async (suffix: string) => {
        const state = requireWorld();
        const registry = openRegistry();
        const command = await freezeCommand(`basis-${suffix}`, false, [state.sourceVersionRef]);
        const frozen = await registry.freeze(command);
        if (frozen.kind !== "succeeded" || frozen.result.kind !== "assessment-preparation") {
          throw new Error(`C11 freeze failed: ${JSON.stringify(frozen)}`);
        }
        const authorization = await authorizeBranch(
          `basis-${suffix}-read`,
          "knowledge-modeling.assessment-basis",
          // 准备快照内含来源证据：授权必须声明该工程的真实来源版本与业务空间，否则按越权关闭。
          [state.sourceVersionRef],
          state.businessSpatialScopeRef,
        );
        return {
          state,
          registry,
          preparationSnapshotRef: frozen.result.assessmentPreparationSnapshotRef,
          read: await registry.readAssessmentPreparationSnapshot({
            projectId: project,
            actorId: state.managerId,
            requestId: `basis-${suffix}-read`,
            idempotencyKey: `basis-${suffix}-read`,
            requestedAt: now,
            authorization,
            preparationSnapshotRef: frozen.result.assessmentPreparationSnapshotRef,
          }),
        };
      };

      it("投影只含准备身份、工程修订与冻结适用性，且与冻结准备同源", async () => {
        const { state, preparationSnapshotRef, read } = await freezeAndRead("projection");
        expect(read.kind, JSON.stringify(read)).toBe("succeeded");
        if (read.kind !== "succeeded") return;
        // 六字段闭包：不得混入清洗任务、结果工件、配置集合、兼容引用或业务时刻。
        expect(Object.keys(read.projection).sort()).toEqual([
          "applicability",
          "applicabilitySnapshotRef",
          "preparationSnapshotRef",
          "projectId",
          "projectRevisionRef",
          "schemaVersion",
        ]);
        expect(read.projection.preparationSnapshotRef).toEqual(preparationSnapshotRef);
        expect(read.projection.projectId).toBe(project);
        expect(read.projection.projectRevisionRef).toEqual(state.projectRevisionRef);
        expect(read.projection.applicabilitySnapshotRef).toEqual(state.applicabilitySnapshotRef);
      }, 120_000);

      it("准备身份错配或工程不合法时关闭失败且不返回投影", async () => {
        const state = requireWorld();
        const registry = openRegistry();
        const frozen = await registry.freeze(
          await freezeCommand("basis-mismatch", false, [state.sourceVersionRef]),
        );
        if (frozen.kind !== "succeeded" || frozen.result.kind !== "assessment-preparation") {
          throw new Error("C11 freeze failed");
        }
        const cases = [
          {
            label: "preparation-missing",
            preparationSnapshotRef: {
              kind: "assessment-preparation-snapshot" as const,
              reference: { entityId: "c11-absent-preparation", versionId: "1" },
            },
          },
          {
            label: "preparation-wrong-version",
            preparationSnapshotRef: {
              ...frozen.result.assessmentPreparationSnapshotRef,
              reference: {
                ...frozen.result.assessmentPreparationSnapshotRef.reference,
                versionId: "7",
              },
            },
          },
          {
            label: "foreign-project",
            projectId: "project-c11-foreign",
          },
        ];
        for (const current of cases) {
          const authorization = await authorizeBranch(
            `basis-mismatch-${current.label}`,
            "knowledge-modeling.assessment-basis",
          );
          const read = await registry.readAssessmentPreparationSnapshot({
            projectId: current.projectId ?? project,
            actorId: state.managerId,
            requestId: `basis-mismatch-${current.label}`,
            idempotencyKey: `basis-mismatch-${current.label}`,
            requestedAt: now,
            authorization,
            preparationSnapshotRef:
              current.preparationSnapshotRef ?? frozen.result.assessmentPreparationSnapshotRef,
          });
          // 缺失、错版本与跨工程收敛为同一不可枚举拒绝，且不返回任何投影字段。
          expect(read, current.label).toMatchObject({
            kind: "failed",
            error: { code: "AUTHORIZATION_DENIED" },
          });
        }
      }, 120_000);

      it("只接受 C19 assessment-basis 调用身份：C25 evidence-access 上下文不被接受", async () => {
        const { state, preparationSnapshotRef } = await freezeAndRead("identity");
        // 合法准备、合法 actor，但授权上下文来自另一个分支：C11 不枚举或复用其它分支。
        const authorization = await authorizeBranch(
          "basis-identity-other-branch",
          "engineering-data.evidence-access",
        );
        const registry = openRegistry();
        const read = await registry.readAssessmentPreparationSnapshot({
          projectId: project,
          actorId: state.managerId,
          requestId: "basis-identity-other-branch",
          idempotencyKey: "basis-identity-other-branch",
          requestedAt: now,
          authorization,
          preparationSnapshotRef,
        });
        expect(read).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
      }, 120_000);
    });
  });
});
