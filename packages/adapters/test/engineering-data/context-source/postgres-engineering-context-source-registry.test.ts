import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ArtifactPutCommandV1Schema } from "@riskflow/core/artifacts";
import type {
  AuthorizationContextV1,
  ContentArtifactRefV1,
  EngineeringDataCommandV1,
  EngineeringDataQueryV1,
  EngineeringFreezeCommandV1,
  ProjectRevisionRefV1,
  SourceVersionRefV1,
  SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import { bootstrapInitialSystemAdministrator } from "../../../src/auth/index.js";
import { PostgresEngineeringContextSourceRegistry } from "../../../src/engineering-data/context-source/postgres-engineering-context-source-registry.js";
import { createPostgresRuntime } from "../../../src/postgres/pool.js";
import * as contextSourceMigration from "../../../src/postgres/migrations/engineering-data/deliver-engineering-context-and-source-registry/000007_engineering_context_source_registry.js";
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
        businessSpatialScopeRef: SpatialScopeRefV1;
        snapshotRef: {
          kind: "applicability-metadata-snapshot";
          reference: { entityId: string; versionId: string };
        };
        metadataArtifactRef: ContentArtifactRefV1;
        deliveryCommand: Extract<EngineeringDataCommandV1, { kind: "register-source-delivery" }>;
        authorize(
          invocationId: string,
          requestedSourceVersionRefs?: readonly SourceVersionRefV1[],
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

  const createDelivery = async (suffix: string) => {
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
    const sourceContent = `source body ${suffix}`;
    const sourceArtifact = await put(`${suffix}-source`, sourceContent, "text/plain");
    const metadataArtifact = await put(
      `${suffix}-metadata`,
      JSON.stringify({
        schemaVersion: "1",
        projectRevisionRef: state.projectRevisionRef,
        spatialScopeRefs: [state.businessSpatialScopeRef],
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

  it("loads migration 000007 and keeps C11 tables inaccessible to worker/checkpointer roles", async () => {
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

  it("keeps C02 public branches closed until their owning change is installed", async () => {
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
    expect(await fixture.registry.apply(monitoringCommand)).toMatchObject({
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
    expect(await fixture.registry.freeze(freeze)).toMatchObject({
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
      businessSpatialScopeRef,
      snapshotRef: snapshotResult.result.snapshot.snapshotRef,
      metadataArtifactRef: metadataArtifact.artifactRef,
      deliveryCommand,
      authorize: async (
        invocationId: string,
        requestedSourceVersionRefs: readonly SourceVersionRefV1[] = [],
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
        ).context,
    };
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
});
