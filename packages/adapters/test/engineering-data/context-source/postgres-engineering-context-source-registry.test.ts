import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ArtifactPutCommandV1Schema } from "@riskflow/core/artifacts";
import type {
  AuthorizationContextRefV1,
  AuthorizationContextV1,
  ContentArtifactRefV1,
  EngineeringDataCommandV1,
  EngineeringDataQueryV1,
  EngineeringFreezeCommandV1,
  ProjectRevisionRefV1,
  SourceSegmentSetRefV1,
  SourceVersionRefV1,
  SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import {
  StructuredDocumentConversionCommandV1Schema,
  StructuredDocumentConversionQueryV1Schema,
} from "@riskflow/contracts/ports";
import { bootstrapInitialSystemAdministrator } from "../../../src/auth/index.js";
import { PostgresEngineeringContextSourceRegistry } from "../../../src/engineering-data/context-source/postgres-engineering-context-source-registry.js";
import { StructuredDocumentConversionAdapter } from "../../../src/engineering-data/document-conversion/structured-document-converter.js";
import { createPostgresRuntime } from "../../../src/postgres/pool.js";
import * as contextSourceMigration from "../../../src/postgres/migrations/engineering-data/deliver-engineering-context-and-source-registry/000008_engineering_context_source_registry.js";
import * as readQueryResultsMigration from "../../../src/postgres/migrations/engineering-data/implement-engineering-data-read-branches/000024_engineering_data_read_query_results.js";
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
            | "engineering-data.evidence-access"
            | "engineering-data.source-segments",
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
    } = {},
  ) => {
    const state = requireE2eState();
    const now = "2030-01-01T00:00:00.000Z";
    const commandId = `c11-${suffix}`;
    const authorization = await state.authorize(commandId);
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
        applicabilityMetadataSnapshotRef: state.snapshotRef,
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
      await contextSourceMigration.down(migratorRuntime.db);
      const dropped = await fixture.postgres.adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'business' AND table_name = 'engineering_projects'",
      );
      expect(dropped.rows[0]?.count).toBe("0");
      await contextSourceMigration.up(migratorRuntime.db);
    } finally {
      await migratorRuntime.close();
    }
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
          | "engineering-data.evidence-access"
          | "engineering-data.source-segments" = "engineering-data.register-source-delivery",
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
});
