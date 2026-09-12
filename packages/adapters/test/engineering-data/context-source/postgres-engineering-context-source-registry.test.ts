import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ArtifactPutCommandV1Schema } from "@riskflow/core/artifacts";
import type {
  ApplicabilityMetadataSnapshotRefV1,
  AuthorizationContextRefV1,
  AuthorizationContextV1,
  ContentArtifactRefV1,
  EngineeringDataApplyResultV1,
  EngineeringDataCommandV1,
  EngineeringDataQueryV1,
  EngineeringFreezeCommandV1,
  ProjectRevisionRefV1,
  SourceVersionRefV1,
  SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import {
  RiskInputVersionRefV1Schema,
  StandardizedRiskRecordRefV1Schema,
  StructuredDocumentConversionCommandV1Schema,
  StructuredDocumentConversionQueryV1Schema,
} from "@riskflow/contracts/ports";
import { bootstrapInitialSystemAdministrator } from "../../../src/auth/index.js";
import { PostgresEngineeringContextSourceRegistry } from "../../../src/engineering-data/context-source/postgres-engineering-context-source-registry.js";
import { StructuredDocumentConversionAdapter } from "../../../src/engineering-data/document-conversion/structured-document-converter.js";
import { createPostgresRuntime } from "../../../src/postgres/pool.js";
import * as contextSourceMigration from "../../../src/postgres/migrations/engineering-data/deliver-engineering-context-and-source-registry/000008_engineering_context_source_registry.js";
import * as externalRiskEventRegistrationMigration from "../../../src/postgres/migrations/engineering-data/implement-external-risk-event-registration/000036_external_risk_event_registration.js";
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
        authorize(
          invocationId: string,
          requestedSourceVersionRefs?: readonly SourceVersionRefV1[],
          branch?:
            | "engineering-data.register-source-delivery"
            | "engineering-data.register-external-risk-event"
            | "engineering-data.evidence-access",
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
      // 000036 holds a foreign key onto business.engineering_projects, so it rolls back first.
      await externalRiskEventRegistrationMigration.down(migratorRuntime.db);
      await contextSourceMigration.down(migratorRuntime.db);
      const dropped = await fixture.postgres.adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'business' AND table_name = 'engineering_projects'",
      );
      expect(dropped.rows[0]?.count).toBe("0");
      await contextSourceMigration.up(migratorRuntime.db);
      await externalRiskEventRegistrationMigration.up(migratorRuntime.db);
    } finally {
      await migratorRuntime.close();
    }
  });

  it("loads migration 000036, restores it through down/up, and keeps it closed to worker/checkpointer/PUBLIC roles", async () => {
    const expectedColumns = [
      "actor_id",
      "audit_entry_id",
      "authorization_context_ref",
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
      await externalRiskEventRegistrationMigration.down(migratorRuntime.db);
      const dropped = await fixture.postgres.adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'business' AND table_name = 'external_risk_events'",
      );
      expect(dropped.rows[0]?.count).toBe("0");
      await externalRiskEventRegistrationMigration.up(migratorRuntime.db);
    } finally {
      await migratorRuntime.close();
    }
    await expectSchema();
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
    expect(await fixture.registry.read(query)).toMatchObject({
      kind: "failed",
      error: { code: "UNSUPPORTED_CONTRACT" },
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
      ],
    });
    expect(segments).toMatchObject({ kind: "succeeded", result: { kind: "source-segment-set" } });
    const persisted = await fixture.postgres.adminPool.query<{
      access_status: string;
      segment_count: string;
    }>(
      "SELECT v.access_status, (SELECT count(*)::text FROM business.source_segments s WHERE s.source_version_id = v.source_version_id) AS segment_count FROM business.source_versions v WHERE v.source_version_id = $1",
      [sourceId],
    );
    expect(persisted.rows[0]).toEqual({ access_status: "ready", segment_count: "1" });
    e2eState = {
      projectId: project,
      managerId: manager.resultRef.entityId,
      projectRevisionRef: projectResult.result.revision.projectRevisionRef,
      sourceVersionRef,
      businessSpatialScopeRef,
      accessRootScopeRef: spatialScopeRef,
      systemAdministrationContextRef: adminChanged.systemAdministrationContextRef!,
      managerSessionToken: managerChanged.sessionToken,
      snapshotRef: snapshotResult.result.snapshot.snapshotRef,
      metadataArtifactRef: metadataArtifact.artifactRef,
      deliveryCommand,
      authorize: async (
        invocationId: string,
        requestedSourceVersionRefs: readonly SourceVersionRefV1[] = [],
        branch:
          | "engineering-data.register-source-delivery"
          | "engineering-data.register-external-risk-event"
          | "engineering-data.evidence-access" = "engineering-data.register-source-delivery",
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
    const uncovered = await state.authorize(
      "c11-external-uncovered",
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
      "c11-external-not-ready",
      [notReadySourceVersionRef],
      "engineering-data.register-external-risk-event",
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
      "c11-external-outside-scope",
      [outsideSourceVersionRef],
      "engineering-data.register-external-risk-event",
    );
    const outsideArtifact = await putExternalEventArtifact(
      state,
      "external-event-outside-scope",
      JSON.stringify({ eventType: "outside-scope" }),
      rootOnlyAuthorization,
    );

    const attempts: [string, EngineeringDataCommandV1][] = [
      [
        "missing event artifact",
        externalRiskEventCommand(state, {
          suffix: "denied-artifact",
          authorization: covered,
          eventArtifactRef: missingArtifactRef,
          sourceVersionRef: state.sourceVersionRef,
          sourceSegmentId: evidence.source_segment_id,
        }),
      ],
      [
        "event artifact belongs to another project",
        externalRiskEventCommand(state, {
          suffix: "denied-cross-project-artifact",
          authorization: covered,
          eventArtifactRef: otherProjectArtifact.artifactRef,
          sourceVersionRef: state.sourceVersionRef,
          sourceSegmentId: evidence.source_segment_id,
        }),
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
          authorization: covered,
          eventArtifactRef: eventArtifact.artifactRef,
          sourceVersionRef: missingSourceVersionRef,
          sourceSegmentId: evidence.source_segment_id,
        }),
      ],
      [
        "evidence segment does not exist",
        externalRiskEventCommand(state, {
          suffix: "denied-segment",
          authorization: covered,
          eventArtifactRef: eventArtifact.artifactRef,
          sourceVersionRef: state.sourceVersionRef,
          sourceSegmentId: "c11-missing-segment-1",
        }),
      ],
      [
        "evidence source version is not ready",
        externalRiskEventCommand(state, {
          suffix: "denied-not-ready",
          authorization: notReadyAuthorization,
          eventArtifactRef: eventArtifact.artifactRef,
          sourceVersionRef: notReadySourceVersionRef,
          sourceSegmentId: notReadySourceVersionRef.reference.entityId,
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
});
