import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ArtifactPutCommandV1Schema } from "@riskflow/core/artifacts";
import type {
  EngineeringDataCommandV1,
  EngineeringDataQueryV1,
  EngineeringFreezeCommandV1,
} from "@riskflow/contracts/ports";
import { bootstrapInitialSystemAdministrator } from "../../../src/auth/index.js";
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

  beforeAll(async () => {
    fixture = await startEngineeringContextSourceFixture({
      now: () => new Date("2030-01-01T00:00:00.000Z"),
    });
  }, 240_000);

  afterAll(async () => {
    await fixture?.close();
  }, 60_000);

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
    const snapshotAuthorization = await authorize("c11-snapshot");
    const snapshotResult = await fixture.registry.createApplicabilitySnapshot({
      commandId: "c11-snapshot",
      idempotencyKey: "c11-snapshot",
      projectId: project,
      actorId: manager.resultRef.entityId,
      issuedAt: now,
      authorization: snapshotAuthorization,
      projectRevisionRef: projectResult.result.revision.projectRevisionRef,
      spatialScopeRef: spatialResult.result.revision.spatialScopeRef,
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
      spatialScopeRefs: [spatialScopeRef],
      registeredByAccountId: manager.resultRef.entityId,
      sourceItemId: "c11-source-item",
      sourceItemName: "施工方案",
      sourceCategory: "engineering-document",
      sourceMetadata: { documentType: "施工方案", formedAt: now, sourceOrganization: "甲方" },
      descriptor: { kind: "file-upload" as const, contentFingerprint: "source body" },
      applicabilityMetadataSnapshotRef: snapshotResult.result.snapshot.snapshotRef,
    };
    const metadataArtifact = await put("metadata", JSON.stringify(metadata), "application/json");
    const delivery = await fixture.registry.apply({
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
    });
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
          spatialScopeRefs: [spatialScopeRef],
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
  });
});
