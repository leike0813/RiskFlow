import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { QueryResultRefV1 } from "@riskflow/contracts/ports";

import { ArtifactPutCommandV1Schema } from "@riskflow/core/artifacts";
import type {
  RegisterMonitoringAvailabilityPolicyCommandV1,
  ReviseMonitoringSeriesCommandV1,
} from "@riskflow/core/engineering-data/monitoring";
import type {
  AuthorizationContextV1,
  EngineeringDataCommandV1,
  ProjectRevisionRefV1,
  SourceVersionRefV1,
  SpatialScopeRefV1,
} from "@riskflow/contracts/ports";

import { bootstrapInitialSystemAdministrator } from "../../../src/auth/index.js";
import { startMonitoringFixture, type MonitoringPostgresFixture } from "./fixture.js";

const now = "2030-01-01T00:00:00.000Z";

describe("C14 PostgreSQL monitoring store", () => {
  let fixture: MonitoringPostgresFixture;
  let projectId: string;
  let managerId: string;
  let projectRevisionRef: ProjectRevisionRefV1;
  let spatialScopeRef: SpatialScopeRefV1;
  let sourceVersionRef: SourceVersionRefV1;
  let sourceSegmentSetRef: {
    kind: "source-segment-set";
    reference: { entityId: string; versionId: string };
  };
  let managerSessionToken: string;
  let queryResultRef: QueryResultRefV1;
  let queryAuthorization: AuthorizationContextV1;
  let authorization: (
    id: string,
    branch:
      | "engineering-data.register-source-delivery"
      | "engineering-data.register-monitoring-batch"
      | "engineering-data.monitoring-snapshot"
      | "engineering-data.monitoring-snapshot-query",
    sourceRefs?: readonly SourceVersionRefV1[],
  ) => Promise<AuthorizationContextV1>;

  beforeAll(async () => {
    fixture = await startMonitoringFixture({ now: () => new Date(now) });
    projectId = "project-c14-e2e";
    const admin = await bootstrapInitialSystemAdministrator({
      connection: fixture.postgres.migrator,
      loginName: "c14-admin",
      displayName: "C14 Administrator",
      password: "c14-admin-password",
      accountId: "c14-admin-account",
      now: () => new Date(now),
    });
    if (admin.kind !== "account") throw new Error("C14 admin bootstrap failed");
    const adminLogin = await fixture.access.login({
      kind: "login",
      loginAttemptId: "c14-admin-login",
      loginName: "c14-admin",
      password: "c14-admin-password",
    });
    const adminChanged = await fixture.access.changePassword({
      kind: "change-password",
      sessionToken: adminLogin.sessionToken,
      newPassword: "c14-admin-password-changed",
    });
    const manager = await fixture.access.administerIdentity({
      kind: "create-account",
      commandId: "c14-create-manager",
      idempotencyKey: "c14-create-manager",
      expectedVersion: "none",
      authorizationContextRef: adminChanged.systemAdministrationContextRef!,
      loginName: "c14-manager",
      displayName: "C14 Manager",
      password: "c14-manager-password",
    });
    if (manager.kind !== "account") throw new Error("C14 manager creation failed");
    managerId = manager.resultRef.entityId;
    const managerLogin = await fixture.access.login({
      kind: "login",
      loginAttemptId: "c14-manager-login",
      loginName: "c14-manager",
      password: "c14-manager-password",
    });
    const managerChanged = await fixture.access.changePassword({
      kind: "change-password",
      sessionToken: managerLogin.sessionToken,
      newPassword: "c14-manager-password-changed",
    });
    managerSessionToken = managerChanged.sessionToken;
    await fixture.access.administerProject({
      kind: "open-project",
      projectId,
      commandId: "c14-open-project",
      idempotencyKey: "c14-open-project",
      expectedVersion: "none",
      authorizationContextRef: adminChanged.systemAdministrationContextRef!,
      initialRiskManagerAccountId: managerId,
    });
    const root = await fixture.postgres.adminPool.query<{ scope_id: string; revision_id: string }>(
      "SELECT scope_id, current_revision_id AS revision_id FROM business.access_spatial_scopes WHERE project_id = $1",
      [projectId],
    );
    spatialScopeRef = {
      kind: "spatial-scope",
      reference: { entityId: root.rows[0]!.scope_id, versionId: root.rows[0]!.revision_id },
    };
    authorization = async (id, branch, sourceRefs = []) =>
      (
        await fixture.access.authorize({
          invocation: { kind: "human-session", sessionToken: managerChanged.sessionToken },
          invocationId: id,
          projectId,
          branch,
          requestedSpatialScopeRefs: [spatialScopeRef],
          requestedSourceVersionRefs: sourceRefs,
        })
      ).context;
    const contextAuth = await authorization(
      "c14-project-context",
      "engineering-data.register-source-delivery",
    );
    const projectResult = await fixture.registry.reviseContext({
      commandId: "c14-project-context",
      idempotencyKey: "c14-project-context",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: contextAuth,
      kind: "project",
      expectedVersion: "none",
      name: "C14 工程",
      lifecycle: "preparing",
      applicabilityMetadata: {
        constructionMethod: "variable-diameter-shield",
        stratumCondition: "soft-soil",
        engineeringStage: "expansion-preparation",
      },
      effectivePeriod: { validFrom: now },
    });
    if (projectResult.kind !== "succeeded" || projectResult.result.kind !== "project-revision")
      throw new Error("C14 project context failed");
    projectRevisionRef = projectResult.result.revision.projectRevisionRef;
    const spatialAuth = await authorization(
      "c14-spatial-context",
      "engineering-data.register-source-delivery",
    );
    const spatialResult = await fixture.registry.reviseContext({
      commandId: "c14-spatial-context",
      idempotencyKey: "c14-spatial-context",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: spatialAuth,
      kind: "spatial",
      spatialScopeRef,
      projectRevisionRef,
      expectedVersion: "none",
      name: "C14 区段",
      worksiteLocation: "左线",
      applicabilityOverrides: {},
      status: "active",
      effectivePeriod: { validFrom: now },
    });
    if (spatialResult.kind !== "succeeded" || spatialResult.result.kind !== "spatial-revision")
      throw new Error("C14 spatial context failed");
    spatialScopeRef = spatialResult.result.revision.spatialScopeRef;
    const snapshotAuth = await authorization(
      "c14-applicability",
      "engineering-data.register-source-delivery",
    );
    const snapshotResult = await fixture.registry.createApplicabilitySnapshot({
      commandId: "c14-applicability",
      idempotencyKey: "c14-applicability",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: snapshotAuth,
      projectRevisionRef,
      spatialScopeRef,
      formedAt: now,
    });
    if (snapshotResult.kind !== "succeeded") throw new Error("C14 applicability snapshot failed");
    const put = async (
      id: string,
      content: string,
      mediaType: string,
      auth: AuthorizationContextV1,
    ) =>
      fixture.artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: `c14-put-${id}`,
          idempotencyKey: `c14-put-${id}`,
          projectId,
          actorId: managerId,
          issuedAt: now,
          authorization: auth,
          requiredCapability: "engineering-data.write",
          artifactId: `c14-${id}`,
          artifactKind: "content",
          purposeCode:
            id === "samples"
              ? "engineering-data.register-monitoring-batch"
              : "engineering-data.register-source-delivery",
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
    const sourceAuth = await authorization(
      "c14-source-delivery",
      "engineering-data.register-source-delivery",
    );
    const sourceArtifact = await put("source", "source body", "text/plain", sourceAuth);
    const metadataArtifact = await put(
      "metadata",
      JSON.stringify({
        schemaVersion: "1",
        projectRevisionRef,
        spatialScopeRefs: [spatialScopeRef],
        registeredByAccountId: managerId,
        sourceItemId: "c14-source-item",
        sourceItemName: "监测方案",
        sourceCategory: "engineering-document",
        sourceMetadata: { documentType: "监测方案", formedAt: now, sourceOrganization: "甲方" },
        descriptor: { kind: "file-upload", contentFingerprint: "source body" },
        applicabilityMetadataSnapshotRef: snapshotResult.result.snapshot.snapshotRef,
      }),
      "application/json",
      sourceAuth,
    );
    const delivery = await fixture.registry.apply({
      commandId: "c14-source-delivery",
      idempotencyKey: "c14-source-delivery",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: sourceAuth,
      kind: "register-source-delivery",
      payload: {
        sourceConnectionRef: { entityId: "file-upload", versionId: "1" },
        deliveryKey: "c14-source-delivery",
        sourceArtifactRef: sourceArtifact.artifactRef,
        metadataArtifactRef: metadataArtifact.artifactRef,
        occurredAt: now,
      },
    } satisfies Extract<EngineeringDataCommandV1, { kind: "register-source-delivery" }>);
    if (delivery.kind !== "succeeded") throw new Error("C14 source delivery failed");
    sourceVersionRef = delivery.result.sourceVersionRef;
    const segmentAuth = await authorization(
      "c14-source-segments",
      "engineering-data.register-source-delivery",
      [sourceVersionRef],
    );
    const segments = await fixture.registry.registerSegments({
      commandId: "c14-source-segments",
      idempotencyKey: "c14-source-segments",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: segmentAuth,
      sourceVersionRef,
      sourceId: sourceVersionRef.reference.entityId,
      segments: [
        {
          sourceSegmentId: `${sourceVersionRef.reference.entityId}-chapter_1-segment_1` as never,
          chapterId: "chapter_1",
          segmentId: "segment_1",
          kind: "chapter",
          spatialScopeRefs: [spatialScopeRef],
          locator: { kind: "document", pageNumber: 1, headingPath: ["监测"] },
        },
      ],
    });
    if (segments.kind !== "succeeded" || segments.result.kind !== "source-segment-set")
      throw new Error("C14 source segments failed");
    sourceSegmentSetRef = segments.result.segmentSet.sourceSegmentSetRef;
  }, 240_000);

  afterAll(async () => {
    await fixture?.close();
  }, 60_000);

  it("registers a series, batch, frozen snapshot, and narrow query result", async () => {
    const seriesRef = {
      kind: "monitoring-series" as const,
      reference: { entityId: "c14-series", versionId: "1" },
    };
    const seriesAuth = await authorization(
      "c14-series",
      "engineering-data.register-monitoring-batch",
      [sourceVersionRef],
    );
    const seriesCommand: ReviseMonitoringSeriesCommandV1 = {
      commandId: "c14-series",
      idempotencyKey: "c14-series",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: seriesAuth,
      monitoringSeriesRef: seriesRef,
      expectedVersion: "none",
      projectRevisionRef,
      spatialScopeRef,
      monitoringObject: "settlement sensor",
      monitoringIndicator: "地表沉降",
      parameterCode: "settlement",
      canonicalUnit: "mm",
      unitConversions: [{ fromUnit: "cm", scale: 10, offset: 0 }],
      effectivePeriod: { validFrom: now },
    };
    expect((await fixture.monitoringStore.reviseSeries(seriesCommand)).kind).toBe("succeeded");
    const policyAuth = await authorization(
      "c14-policy",
      "engineering-data.register-monitoring-batch",
      [sourceVersionRef],
    );
    const policyCommand: RegisterMonitoringAvailabilityPolicyCommandV1 = {
      commandId: "c14-policy",
      idempotencyKey: "c14-policy",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: policyAuth,
      policy: {
        availabilityPolicyRef: { entityId: "c14-policy", versionId: "1" },
        projectId,
        monitoringSeriesRef: seriesRef,
        windowDurationMs: 10_000,
        intervalMs: 1_000,
        maxInterpolationGapMs: 2_000,
        slopeWindowSize: 5,
        accelerationWindowSize: 5,
        frequencyWindowSize: 5,
        anomalyBaselineSize: 2,
        anomalyScaleFloor: 0.1,
        frequencyPowerFloor: 0,
        minimumCoverageRatio: 0.5,
        maxFrequencySamples: 32,
        algorithmVersions: {
          alignment: "a1",
          slope: "s1",
          acceleration: "g1",
          frequency: "f1",
          anomaly: "n1",
        },
        recordedAt: now,
        audit: { actorId: managerId, action: "policy", recordedAt: now },
      },
    };
    expect((await fixture.monitoringStore.registerAvailabilityPolicy(policyCommand)).kind).toBe(
      "succeeded",
    );
    const evidence = {
      locator: { sourceSegmentId: `${sourceVersionRef.reference.entityId}-chapter_1-segment_1` },
      sourceVersion: sourceVersionRef.reference,
    };
    const lines = [
      JSON.stringify({
        schemaVersion: "1",
        mediaType: "application/x-ndjson",
        monitoringSeriesRef: seriesRef,
        projectRevisionRef,
        spatialScopeRef,
        sourceVersionRef,
        sourceSegmentSetRef,
        productionStrategyRef: { entityId: "monitoring-production", versionId: "1" },
        sampleCount: 5,
      }),
      ...[6, 7, 8, 9, 10].map((second) =>
        JSON.stringify({
          sourceSampleKey: `s-${second}`,
          sampledAt: `2030-01-01T00:00:${String(second).padStart(2, "0")}.000Z`,
          value: second * 2,
          unit: "mm",
          evidenceReferences: [evidence],
        }),
      ),
    ].join("\n");
    const sampleAuth = await authorization(
      "c14-sample-artifact",
      "engineering-data.register-monitoring-batch",
      [sourceVersionRef],
    );
    const batchAuth = await authorization(
      "c14-batch",
      "engineering-data.register-monitoring-batch",
      [sourceVersionRef],
    );
    const artifact = await fixture.artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: "1",
        commandId: "c14-samples",
        idempotencyKey: "c14-samples",
        projectId,
        actorId: managerId,
        issuedAt: now,
        authorization: sampleAuth,
        requiredCapability: "engineering-data.write",
        artifactId: "c14-samples",
        artifactKind: "content",
        purposeCode: "engineering-data.register-monitoring-batch",
        mediaType: "application/x-ndjson",
        parentArtifactRefs: [],
        evidenceReferences: [evidence],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      }),
      (async function* () {
        yield new TextEncoder().encode(lines);
      })(),
    );
    const batch = await fixture.registry.apply({
      commandId: "c14-batch",
      idempotencyKey: "c14-batch",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: batchAuth,
      kind: "register-monitoring-batch",
      payload: {
        monitoringSeriesRef: seriesRef,
        deliveryKey: "c14-batch",
        sampleArtifactRef: artifact.artifactRef,
        window: { from: "2030-01-01T00:00:05.000Z", to: "2030-01-01T00:00:11.000Z" },
        relation: { kind: "original" },
      },
    });
    expect(batch).toMatchObject({
      kind: "succeeded",
      result: { kind: "register-monitoring-batch" },
    });
    const freezeAuth = await authorization("c14-freeze", "engineering-data.monitoring-snapshot", [
      sourceVersionRef,
    ]);
    const snapshot = await fixture.registry.freeze({
      commandId: "c14-freeze",
      idempotencyKey: "c14-freeze",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: freezeAuth,
      kind: "monitoring-snapshot",
      payload: {
        monitoringSeriesRef: seriesRef,
        cutoff: "2030-01-01T00:00:10.000Z",
        availabilityPolicyRef: { entityId: "c14-policy", versionId: "1" },
      },
    });
    expect(snapshot).toMatchObject({ kind: "succeeded", result: { kind: "monitoring-snapshot" } });
    if (snapshot.kind !== "succeeded") return;
    const queryAuth = await authorization(
      "c14-query",
      "engineering-data.monitoring-snapshot-query",
      [sourceVersionRef],
    );
    queryAuthorization = queryAuth;
    const query = await fixture.registry.read({
      queryId: "c14-query",
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: queryAuth,
      kind: "monitoring-snapshot",
      payload: { monitoringSnapshotRef: snapshot.result.monitoringSnapshotRef },
    });
    expect(query).toMatchObject({
      kind: "succeeded",
      result: { queryResultRef: { kind: "query-result" } },
    });
    if (query.kind !== "succeeded") return;
    queryResultRef = query.result.queryResultRef;
    const resolved = await fixture.monitoringStore.resolveSnapshotQuery({
      queryResultRef: query.result.queryResultRef,
      invocationId: "c14-query",
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: queryAuth,
    });
    expect(resolved).toMatchObject({
      kind: "succeeded",
      result: { kind: "snapshot-query", query: { snapshot: { monitoringSeriesRef: seriesRef } } },
    });
    const counts = await fixture.postgres.adminPool.query<{
      batches: string;
      samples: string;
      snapshots: string;
      events: string;
    }>(
      "SELECT (SELECT count(*)::text FROM business.monitoring_batches) AS batches, (SELECT count(*)::text FROM business.monitoring_sample_versions) AS samples, (SELECT count(*)::text FROM business.monitoring_snapshots) AS snapshots, (SELECT count(*)::text FROM outbox.events WHERE event_type LIKE 'engineering.%') AS events",
    );
    expect(counts.rows[0]).toEqual({ batches: "1", samples: "5", snapshots: "1", events: "0" });
  });

  it("requires a correction predecessor to contain the corrected sample time", async () => {
    const evidence = {
      locator: { sourceSegmentId: `${sourceVersionRef.reference.entityId}-chapter_1-segment_1` },
      sourceVersion: sourceVersionRef.reference,
    };
    const putSampleArtifact = async (suffix: string, second: number, value: number) => {
      const artifactAuth = await authorization(
        `c14-${suffix}-artifact`,
        "engineering-data.register-monitoring-batch",
        [sourceVersionRef],
      );
      const content = [
        JSON.stringify({
          schemaVersion: "1",
          mediaType: "application/x-ndjson",
          monitoringSeriesRef: {
            kind: "monitoring-series",
            reference: { entityId: "c14-series", versionId: "1" },
          },
          projectRevisionRef,
          spatialScopeRef,
          sourceVersionRef,
          sourceSegmentSetRef,
          productionStrategyRef: { entityId: "monitoring-production", versionId: "1" },
          sampleCount: 1,
        }),
        JSON.stringify({
          sourceSampleKey: `${suffix}-sample`,
          sampledAt: `2030-01-01T00:00:${String(second).padStart(2, "0")}.000Z`,
          value,
          unit: "mm",
          evidenceReferences: [evidence],
        }),
      ].join("\n");
      return fixture.artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: `c14-${suffix}-put`,
          idempotencyKey: `c14-${suffix}-put`,
          projectId,
          actorId: managerId,
          issuedAt: now,
          authorization: artifactAuth,
          requiredCapability: "engineering-data.write",
          artifactId: `c14-${suffix}`,
          artifactKind: "content",
          purposeCode: "engineering-data.register-monitoring-batch",
          mediaType: "application/x-ndjson",
          parentArtifactRefs: [],
          evidenceReferences: [evidence],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        (async function* () {
          yield new TextEncoder().encode(content);
        })(),
      );
    };

    const predecessorArtifact = await putSampleArtifact("predecessor", 12, 24);
    const predecessorAuth = await authorization(
      "c14-predecessor",
      "engineering-data.register-monitoring-batch",
      [sourceVersionRef],
    );
    const predecessor = await fixture.registry.apply({
      commandId: "c14-predecessor",
      idempotencyKey: "c14-predecessor",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: predecessorAuth,
      kind: "register-monitoring-batch",
      payload: {
        monitoringSeriesRef: {
          kind: "monitoring-series",
          reference: { entityId: "c14-series", versionId: "1" },
        },
        deliveryKey: "c14-predecessor",
        sampleArtifactRef: predecessorArtifact.artifactRef,
        window: { from: "2030-01-01T00:00:11.000Z", to: "2030-01-01T00:00:13.000Z" },
        relation: { kind: "original" },
      },
    });
    expect(predecessor.kind).toBe("succeeded");
    if (predecessor.kind !== "succeeded") return;

    const correctionArtifact = await putSampleArtifact("correction", 9, 999);
    const correctionAuth = await authorization(
      "c14-correction",
      "engineering-data.register-monitoring-batch",
      [sourceVersionRef],
    );
    const correction = await fixture.registry.apply({
      commandId: "c14-correction",
      idempotencyKey: "c14-correction",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: correctionAuth,
      kind: "register-monitoring-batch",
      payload: {
        monitoringSeriesRef: {
          kind: "monitoring-series",
          reference: { entityId: "c14-series", versionId: "1" },
        },
        deliveryKey: "c14-correction",
        sampleArtifactRef: correctionArtifact.artifactRef,
        window: { from: "2030-01-01T00:00:08.000Z", to: "2030-01-01T00:00:10.000Z" },
        relation: { kind: "correction", priorBatchRef: predecessor.result.monitoringBatchRef },
      },
    });
    expect(correction).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
  });

  it("rejects a database current pointer rollback", async () => {
    const seriesAuth = await authorization(
      "c14-series-v2",
      "engineering-data.register-monitoring-batch",
      [sourceVersionRef],
    );
    const revised = await fixture.monitoringStore.reviseSeries({
      commandId: "c14-series-v2",
      idempotencyKey: "c14-series-v2",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: seriesAuth,
      monitoringSeriesRef: {
        kind: "monitoring-series",
        reference: { entityId: "c14-series", versionId: "2" },
      },
      expectedVersion: { entityId: "c14-series", versionId: "1" },
      projectRevisionRef,
      spatialScopeRef,
      monitoringObject: "settlement sensor",
      monitoringIndicator: "地表沉降",
      parameterCode: "settlement-v2",
      canonicalUnit: "mm",
      unitConversions: [{ fromUnit: "cm", scale: 10, offset: 0 }],
      effectivePeriod: { validFrom: now },
    });
    expect(revised.kind).toBe("succeeded");
    await expect(
      fixture.runtime.pool.query(
        "UPDATE business.monitoring_series SET current_revision_id = $1 WHERE project_id = $2 AND series_id = $3",
        ["c14-series:1", projectId, "c14-series"],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rechecks current authorization before resolving a stored query", async () => {
    await fixture.access.changePassword({
      kind: "change-password",
      sessionToken: managerSessionToken,
      newPassword: "c14-manager-password-revoked",
    });
    const resolved = await fixture.monitoringStore.resolveSnapshotQuery({
      queryResultRef,
      invocationId: "c14-query",
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: queryAuthorization,
    });
    expect(resolved).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
  });
});
