import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ArtifactPutCommandV1Schema } from "@riskflow/core/artifacts";
import type {
  AuthorizationContextV1,
  EngineeringDataCommandV1,
  ModuleBranchV1,
  MonitoringSnapshotRefV1,
  ProjectRevisionRefV1,
  QueryResultRefV1,
  SourceSegmentSetRefV1,
  SourceVersionRefV1,
  SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import type {
  RegisterMonitoringAvailabilityPolicyCommandV1,
  ReviseMonitoringSeriesCommandV1,
} from "@riskflow/core/engineering-data/monitoring";

import { bootstrapInitialSystemAdministrator } from "../../src/auth/index.js";
import {
  PostgresEngineeringDataCatalogAdapter,
  type PostgresEngineeringDataCatalogAdapterOptionsV1,
} from "../../src/engineering-data/catalog/index.js";
import {
  startEngineeringContextSourceFixture,
  type EngineeringContextSourcePostgresFixture,
} from "./context-source/fixture.js";

const now = "2030-01-01T00:00:00.000Z";

describe("C32 PostgreSQL engineering data catalog adapter", () => {
  let fixture: EngineeringContextSourcePostgresFixture;
  let catalog: PostgresEngineeringDataCatalogAdapter;
  let projectId: string;
  let managerId: string;
  let projectRevisionRef: ProjectRevisionRefV1;
  let spatialScopeRef: SpatialScopeRefV1;
  let sourceVersionRef: SourceVersionRefV1;
  let sourceSegmentSetRef: SourceSegmentSetRefV1;
  let monitoringSnapshotRef: MonitoringSnapshotRefV1;
  let segmentQueryResultRef: QueryResultRefV1;
  let monitoringQueryResultRef: QueryResultRefV1;
  let authorization: (
    id: string,
    branch: ModuleBranchV1,
    sourceRefs?: readonly SourceVersionRefV1[],
  ) => Promise<AuthorizationContextV1>;

  beforeAll(async () => {
    fixture = await startEngineeringContextSourceFixture({ now: () => new Date(now) });
    projectId = "project-c32-catalog";
    const admin = await bootstrapInitialSystemAdministrator({
      connection: fixture.postgres.migrator,
      loginName: "c32-admin",
      displayName: "C32 Administrator",
      password: "c32-admin-password",
      accountId: "c32-admin-account",
      now: () => new Date(now),
    });
    if (admin.kind !== "account") throw new Error("C32 admin bootstrap failed");
    const adminLogin = await fixture.access.login({
      kind: "login",
      loginAttemptId: "c32-admin-login",
      loginName: "c32-admin",
      password: "c32-admin-password",
    });
    const adminChanged = await fixture.access.changePassword({
      kind: "change-password",
      sessionToken: adminLogin.sessionToken,
      newPassword: "c32-admin-password-changed",
    });
    const manager = await fixture.access.administerIdentity({
      kind: "create-account",
      commandId: "c32-create-manager",
      idempotencyKey: "c32-create-manager",
      expectedVersion: "none",
      authorizationContextRef: adminChanged.systemAdministrationContextRef!,
      loginName: "c32-manager",
      displayName: "C32 Manager",
      password: "c32-manager-password",
    });
    if (manager.kind !== "account") throw new Error("C32 manager creation failed");
    managerId = manager.resultRef.entityId;
    const managerLogin = await fixture.access.login({
      kind: "login",
      loginAttemptId: "c32-manager-login",
      loginName: "c32-manager",
      password: "c32-manager-password",
    });
    const managerChanged = await fixture.access.changePassword({
      kind: "change-password",
      sessionToken: managerLogin.sessionToken,
      newPassword: "c32-manager-password-changed",
    });
    await fixture.access.administerProject({
      kind: "open-project",
      projectId,
      commandId: "c32-open-project",
      idempotencyKey: "c32-open-project",
      expectedVersion: "none",
      authorizationContextRef: adminChanged.systemAdministrationContextRef!,
      initialRiskManagerAccountId: managerId,
    });
    const root = await fixture.postgres.adminPool.query<{
      scope_id: string;
      revision_id: string;
    }>(
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
      "c32-project-context",
      "engineering-data.register-source-delivery",
    );
    const projectResult = await fixture.registry.reviseContext({
      commandId: "c32-project-context",
      idempotencyKey: "c32-project-context",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: contextAuth,
      kind: "project",
      expectedVersion: "none",
      name: "C32 工程",
      lifecycle: "preparing",
      applicabilityMetadata: {
        constructionMethod: "variable-diameter-shield",
        stratumCondition: "soft-soil",
        engineeringStage: "expansion-preparation",
      },
      effectivePeriod: { validFrom: now },
    });
    if (projectResult.kind !== "succeeded" || projectResult.result.kind !== "project-revision")
      throw new Error("C32 project context failed");
    projectRevisionRef = projectResult.result.revision.projectRevisionRef;
    const spatialAuth = await authorization(
      "c32-spatial-context",
      "engineering-data.register-source-delivery",
    );
    const spatialResult = await fixture.registry.reviseContext({
      commandId: "c32-spatial-context",
      idempotencyKey: "c32-spatial-context",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: spatialAuth,
      kind: "spatial",
      spatialScopeRef,
      projectRevisionRef,
      expectedVersion: "none",
      name: "C32 区段",
      worksiteLocation: "左线",
      applicabilityOverrides: {},
      status: "active",
      effectivePeriod: { validFrom: now },
    });
    if (spatialResult.kind !== "succeeded" || spatialResult.result.kind !== "spatial-revision")
      throw new Error("C32 spatial context failed");
    spatialScopeRef = spatialResult.result.revision.spatialScopeRef;
    const snapshotAuth = await authorization(
      "c32-applicability",
      "engineering-data.register-source-delivery",
    );
    const applicability = await fixture.registry.createApplicabilitySnapshot({
      commandId: "c32-applicability",
      idempotencyKey: "c32-applicability",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: snapshotAuth,
      projectRevisionRef,
      spatialScopeRef,
      formedAt: now,
    });
    if (applicability.kind !== "succeeded") throw new Error("C32 applicability snapshot failed");
    const put = async (id: string, content: string, mediaType: string) => {
      const putAuth = await authorization(
        `c32-put-${id}`,
        "engineering-data.register-source-delivery",
      );
      return fixture.artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: `c32-put-${id}`,
          idempotencyKey: `c32-put-${id}`,
          projectId,
          actorId: managerId,
          issuedAt: now,
          authorization: putAuth,
          requiredCapability: "engineering-data.write",
          artifactId: `c32-${id}`,
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
    };
    const sourceArtifact = await put("source", "source body", "text/plain");
    const metadataArtifact = await put(
      "metadata",
      JSON.stringify({
        schemaVersion: "1",
        projectRevisionRef,
        spatialScopeRefs: [spatialScopeRef],
        registeredByAccountId: managerId,
        sourceItemId: "c32-source-item",
        sourceItemName: "施工方案",
        sourceCategory: "engineering-document",
        sourceMetadata: {
          documentType: "施工方案",
          formedAt: now,
          sourceOrganization: "甲方",
        },
        descriptor: { kind: "file-upload", contentFingerprint: "source body" },
        applicabilityMetadataSnapshotRef: applicability.result.snapshot.snapshotRef,
      }),
      "application/json",
    );
    const deliveryAuth = await authorization(
      "c32-source-delivery",
      "engineering-data.register-source-delivery",
    );
    const delivery = await fixture.registry.apply({
      commandId: "c32-source-delivery",
      idempotencyKey: "c32-source-delivery",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: deliveryAuth,
      kind: "register-source-delivery",
      payload: {
        sourceConnectionRef: { entityId: "file-upload", versionId: "1" },
        deliveryKey: "c32-source-delivery",
        sourceArtifactRef: sourceArtifact.artifactRef,
        metadataArtifactRef: metadataArtifact.artifactRef,
        occurredAt: now,
      },
    } satisfies Extract<EngineeringDataCommandV1, { kind: "register-source-delivery" }>);
    if (delivery.kind !== "succeeded") throw new Error("C32 source delivery failed");
    sourceVersionRef = delivery.result.sourceVersionRef;
    const segmentAuth = await authorization(
      "c32-source-segments",
      "engineering-data.register-source-delivery",
      [sourceVersionRef],
    );
    const segments = await fixture.registry.registerSegments({
      commandId: "c32-source-segments",
      idempotencyKey: "c32-source-segments",
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
      throw new Error("C32 source segments failed");
    sourceSegmentSetRef = segments.result.segmentSet.sourceSegmentSetRef;

    // 监测链：序列 → 可用性策略 → 批次 → 冻结快照。
    const seriesRef = {
      kind: "monitoring-series" as const,
      reference: { entityId: "c32-series", versionId: "1" },
    };
    const seriesAuth = await authorization(
      "c32-series",
      "engineering-data.register-monitoring-batch",
      [sourceVersionRef],
    );
    const seriesCommand: ReviseMonitoringSeriesCommandV1 = {
      commandId: "c32-series",
      idempotencyKey: "c32-series",
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
    if ((await fixture.monitoringStore.reviseSeries(seriesCommand)).kind !== "succeeded")
      throw new Error("C32 series failed");
    const policyAuth = await authorization(
      "c32-policy",
      "engineering-data.register-monitoring-batch",
      [sourceVersionRef],
    );
    const policyCommand: RegisterMonitoringAvailabilityPolicyCommandV1 = {
      commandId: "c32-policy",
      idempotencyKey: "c32-policy",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: policyAuth,
      policy: {
        availabilityPolicyRef: { entityId: "c32-policy", versionId: "1" },
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
    if (
      (await fixture.monitoringStore.registerAvailabilityPolicy(policyCommand)).kind !== "succeeded"
    )
      throw new Error("C32 policy failed");
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
      "c32-sample-artifact",
      "engineering-data.register-monitoring-batch",
      [sourceVersionRef],
    );
    const sampleArtifact = await fixture.artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: "1",
        commandId: "c32-samples",
        idempotencyKey: "c32-samples",
        projectId,
        actorId: managerId,
        issuedAt: now,
        authorization: sampleAuth,
        requiredCapability: "engineering-data.write",
        artifactId: "c32-samples",
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
    const batchAuth = await authorization(
      "c32-batch",
      "engineering-data.register-monitoring-batch",
      [sourceVersionRef],
    );
    const batch = await fixture.registry.apply({
      commandId: "c32-batch",
      idempotencyKey: "c32-batch",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: batchAuth,
      kind: "register-monitoring-batch",
      payload: {
        monitoringSeriesRef: seriesRef,
        deliveryKey: "c32-batch",
        sampleArtifactRef: sampleArtifact.artifactRef,
        window: { from: "2030-01-01T00:00:05.000Z", to: "2030-01-01T00:00:11.000Z" },
        relation: { kind: "original" },
      },
    });
    if (batch.kind !== "succeeded") throw new Error("C32 batch failed");
    const freezeAuth = await authorization("c32-freeze", "engineering-data.monitoring-snapshot", [
      sourceVersionRef,
    ]);
    const snapshot = await fixture.registry.freeze({
      commandId: "c32-freeze",
      idempotencyKey: "c32-freeze",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: freezeAuth,
      kind: "monitoring-snapshot",
      payload: {
        monitoringSeriesRef: seriesRef,
        cutoff: "2030-01-01T00:00:10.000Z",
        availabilityPolicyRef: { entityId: "c32-policy", versionId: "1" },
      },
    });
    if (snapshot.kind !== "succeeded" || snapshot.result.kind !== "monitoring-snapshot")
      throw new Error("C32 snapshot freeze failed");
    monitoringSnapshotRef = snapshot.result.monitoringSnapshotRef;

    const options: PostgresEngineeringDataCatalogAdapterOptionsV1 = {
      db: fixture.runtime.db,
      access: fixture.access,
      artifactStore: fixture.artifactStore,
      resolvers: {
        resolveReadQuery: (query, options) => fixture.registry.resolveReadQuery(query, options),
        resolveSnapshotQuery: (query, options) =>
          fixture.monitoringStore.resolveSnapshotQuery(query, options),
      },
    };
    catalog = new PostgresEngineeringDataCatalogAdapter(options);

    // 已登记查询：source-segments 与 monitoring-snapshot，供 read-result 回读。
    const segmentQueryAuth = await authorization(
      "c32-segment-query",
      "engineering-data.source-segments",
      [sourceVersionRef],
    );
    const segmentQuery = await fixture.registry.read({
      queryId: "c32-segment-query",
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: segmentQueryAuth,
      kind: "source-segments",
      payload: { sourceSegmentSetRef },
    });
    if (segmentQuery.kind !== "succeeded") throw new Error("C32 segment query failed");
    segmentQueryResultRef = segmentQuery.result.queryResultRef;
    const monitoringQueryAuth = await authorization(
      "c32-monitoring-query",
      "engineering-data.monitoring-snapshot-query",
      [sourceVersionRef],
    );
    const monitoringQuery = await fixture.registry.read({
      queryId: "c32-monitoring-query",
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: monitoringQueryAuth,
      kind: "monitoring-snapshot",
      payload: { monitoringSnapshotRef },
    });
    if (monitoringQuery.kind !== "succeeded") throw new Error("C32 monitoring query failed");
    monitoringQueryResultRef = monitoringQuery.result.queryResultRef;
  }, 240_000);

  afterAll(async () => {
    await fixture?.close();
  }, 60_000);

  it("context-read 返回工程上下文、适用性维度与空间区段", async () => {
    const result = await catalog.read({
      queryId: "c32-context-read",
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: await authorization("c32-context-read", "engineering-data.context-read"),
      kind: "context-read",
      payload: {},
    });
    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded" || result.result.kind !== "context-read") return;
    expect(result.result.contextStatus).toBe("preparing");
    expect(result.result.applicabilityMetadata).toEqual({
      constructionMethod: "variable-diameter-shield",
      stratumCondition: "soft-soil",
      engineeringStage: "expansion-preparation",
    });
    expect(result.result.missingApplicabilityDimensions).toEqual([]);
    expect(result.result.currentProjectRevisionRef).toEqual(projectRevisionRef);
    expect(result.result.spatialScopes).toHaveLength(1);
    expect(result.result.spatialScopes[0]).toMatchObject({ name: "C32 区段" });
  });

  it("source-catalog 列出已登记资料并带解析与段集事实", async () => {
    const result = await catalog.read({
      queryId: "c32-source-catalog",
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: await authorization("c32-source-catalog", "engineering-data.source-catalog"),
      kind: "source-catalog",
      payload: { pageSize: 10 },
    });
    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded" || result.result.kind !== "source-catalog") return;
    expect(result.result.totalCount).toBe(1);
    expect(result.result.items[0]).toMatchObject({
      sourceVersionRef,
      documentType: "施工方案",
      parseStatus: "parsed",
      sourceSegmentSetRef,
    });
    expect(result.result.items[0]?.cleaningAvailability).toBeUndefined();
  });

  it("monitoring-catalog 列出序列与序列详情", async () => {
    const list = await catalog.read({
      queryId: "c32-monitoring-list",
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: await authorization(
        "c32-monitoring-list",
        "engineering-data.monitoring-catalog",
      ),
      kind: "monitoring-catalog",
      payload: { pageSize: 10 },
    });
    expect(list.kind).toBe("succeeded");
    if (list.kind !== "succeeded" || list.result.kind !== "monitoring-series-list") return;
    expect(list.result.items).toHaveLength(1);
    expect(list.result.items[0]).toMatchObject({
      monitoringIndicator: "地表沉降",
      canonicalUnit: "mm",
      batchCount: 1,
      latestSnapshotRef: monitoringSnapshotRef,
    });
    const detail = await catalog.read({
      queryId: "c32-monitoring-detail",
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: await authorization(
        "c32-monitoring-detail",
        "engineering-data.monitoring-catalog",
      ),
      kind: "monitoring-catalog",
      payload: {
        monitoringSeriesRef: {
          kind: "monitoring-series",
          reference: { entityId: "c32-series", versionId: "1" },
        },
      },
    });
    expect(detail.kind).toBe("succeeded");
    if (detail.kind !== "succeeded" || detail.result.kind !== "monitoring-series-detail") return;
    expect(detail.result.batches).toHaveLength(1);
    expect(detail.result.batches[0]).toMatchObject({ relation: "original", sampleCount: 5 });
    expect(detail.result.snapshots).toHaveLength(1);
    expect(detail.result.snapshots[0]?.monitoringSnapshotRef).toEqual(monitoringSnapshotRef);
    expect(["available", "partial", "unavailable"]).toContain(
      detail.result.snapshots[0]?.availability,
    );
  });

  it("read-result 回读 source-segments 与 monitoring-snapshot 登记结果", async () => {
    const segmentResult = await catalog.read({
      queryId: "c32-read-segments",
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: await authorization("c32-read-segments", "engineering-data.read-result", [
        sourceVersionRef,
      ]),
      kind: "read-result",
      payload: { queryResultRef: segmentQueryResultRef },
    });
    expect(segmentResult.kind).toBe("succeeded");
    if (
      segmentResult.kind !== "succeeded" ||
      segmentResult.result.kind !== "read-result" ||
      segmentResult.result.result.kind !== "source-segments"
    )
      return;
    expect(segmentResult.result.result.segmentSet.segments).toHaveLength(1);
    expect(segmentResult.result.result.segmentSet.segments[0]).toMatchObject({
      chapterId: "chapter_1",
      segmentId: "segment_1",
      kind: "chapter",
    });

    const monitoringResult = await catalog.read({
      queryId: "c32-read-monitoring",
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: await authorization("c32-read-monitoring", "engineering-data.read-result", [
        sourceVersionRef,
      ]),
      kind: "read-result",
      payload: { queryResultRef: monitoringQueryResultRef },
    });
    expect(monitoringResult.kind).toBe("succeeded");
    if (
      monitoringResult.kind !== "succeeded" ||
      monitoringResult.result.kind !== "read-result" ||
      monitoringResult.result.result.kind !== "monitoring-snapshot"
    )
      return;
    const snapshot = monitoringResult.result.result.snapshot;
    expect(snapshot.monitoringSnapshotRef).toEqual(monitoringSnapshotRef);
    expect(snapshot.alignedPoints.length).toBeGreaterThan(0);
    expect(snapshot.features.shortTermSlope.status).toBe("available");
  });

  it("无权、伪造引用与错误类型前缀同形失败", async () => {
    const wrongProject = await catalog.read({
      queryId: "c32-denied-project",
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: {
        ...(await authorization("c32-denied-project", "engineering-data.context-read")),
        projectId: "project-other",
      },
      kind: "context-read",
      payload: {},
    });
    expect(wrongProject.kind).toBe("failed");
    if (wrongProject.kind === "failed") {
      expect(wrongProject.error.code).toBe("AUTHORIZATION_DENIED");
    }
    const bogus = await catalog.read({
      queryId: "c32-denied-ref",
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: await authorization("c32-denied-ref", "engineering-data.read-result"),
      kind: "read-result",
      payload: {
        queryResultRef: {
          kind: "query-result",
          reference: { entityId: "fabricated-ref", versionId: "1" },
        },
      },
    });
    expect(bogus.kind).toBe("failed");
    if (bogus.kind === "failed") {
      expect(bogus.error.code).toBe("AUTHORIZATION_DENIED");
    }
  });
});
