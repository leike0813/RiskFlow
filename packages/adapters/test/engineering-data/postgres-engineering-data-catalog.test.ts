import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ArtifactPutCommandV1Schema, type ArtifactStoreV1 } from "@riskflow/core/artifacts";
import type {
  ApplicabilityMetadataSnapshotRefV1,
  AuthorizationContextV1,
  EngineeringDataCommandV1,
  ModuleBranchV1,
  MonitoringSnapshotRefV1,
  ProjectRevisionRefV1,
  QueryResultRefV1,
  RiskDashboardDocumentsSourceResultV1,
  RiskDashboardMonitoringSourceResultV1,
  SourceSegmentSetRefV1,
  SourceVersionRefV1,
  SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import type { MonitoringIndicator } from "@riskflow/contracts/vocabulary";
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
import {
  completeCleaningTask,
  startDataCleaningFixture,
  type DataCleaningPostgresFixture,
  type CleaningWorldV1,
} from "./cleaning/fixture.js";

const now = "2030-01-01T00:00:00.000Z";

describe("C32 正式清洗目录读取", () => {
  let fixture: DataCleaningPostgresFixture;
  let world: CleaningWorldV1;
  beforeAll(async () => {
    fixture = await startDataCleaningFixture();
    world = await fixture.createWorld({
      suffix: "c32-cleaning-catalog",
      documentKinds: ["docx", "csv"],
      monitoring: false,
    });
    const command = await world.freezeCommand("c32-cleaning-catalog-freeze", { actor: "uploader" });
    const pending = await world.pipeline.store.freezeIdentificationPreparation(command);
    expect(pending).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    await completeCleaningTask(world.pipeline, fixture, {
      workerId: "c32-cleaning-catalog-worker",
      projectId: world.projectId,
    });
    expect(await world.pipeline.store.freezeIdentificationPreparation(command)).toMatchObject({
      kind: "succeeded",
      result: { kind: "identification-preparation" },
    });
  }, 180_000);
  afterAll(async () => fixture?.close());

  const read = async (
    id: string,
    refs: readonly SourceVersionRefV1[],
    artifactStore: ArtifactStoreV1 = fixture.artifactStore,
  ) => {
    const authorization = await world.authorizeBranch(id, "engineering-data.source-catalog", refs);
    const adapter = new PostgresEngineeringDataCatalogAdapter({
      db: fixture.runtime.db,
      access: fixture.access,
      artifactStore,
      resolvers: {
        resolveReadQuery: (query, options) => fixture.registry.resolveReadQuery(query, options),
        resolveSnapshotQuery: (query, options) =>
          fixture.monitoringStore.resolveSnapshotQuery(query, options),
      },
    });
    return adapter.read({
      kind: "source-catalog",
      queryId: id,
      projectId: world.projectId,
      actorId: authorization.actorId,
      authorization,
      requestedAt: now,
      payload: { pageSize: 50 },
    });
  };

  it("当前精确资料授权读取正式可用状态，缺父资料资格时不显示可用", async () => {
    const result = await read("c32-cleaning-current-grants", world.sourceVersionRefs());
    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded" || result.result.kind !== "source-catalog") return;
    expect(result.result.items).toHaveLength(2);
    expect(result.result.items).toEqual(
      expect.arrayContaining(
        world.sourceVersionRefs().map((sourceVersionRef) =>
          expect.objectContaining({
            sourceVersionRef,
            cleaningAvailability: "available",
            cleaningExclusionCount: 0,
          }),
        ),
      ),
    );
    const partial = await read(
      "c32-cleaning-missing-parent",
      world.sourceVersionRefs().slice(0, 1),
    );
    expect(partial.kind).toBe("succeeded");
    if (partial.kind !== "succeeded" || partial.result.kind !== "source-catalog") return;
    expect(partial.result.items).toHaveLength(1);
    expect(partial.result.items[0]?.cleaningAvailability).toBeUndefined();
  });

  it.each(["denied", "missing", "integrity"])("工件%s时不投影清洗成功", async (failure) => {
    const result = await read("c32-cleaning-artifact-" + failure, world.sourceVersionRefs(), {
      put: fixture.artifactStore.put.bind(fixture.artifactStore),
      open: async (request) => {
        if (failure !== "integrity") throw new Error(failure);
        const handle = await fixture.artifactStore.open(request);
        const verified = handle.completed.then(() => {
          throw new Error("integrity");
        });
        void verified.catch(() => undefined);
        return {
          ...handle,
          completed: verified,
        };
      },
    });
    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded" || result.result.kind !== "source-catalog") return;
    expect(result.result.items).toHaveLength(2);
    for (const item of result.result.items) expect(item.cleaningAvailability).toBeUndefined();
  });

  it("登记行的精确资料身份不匹配时拒绝", async () => {
    const source = world.sourceVersionRefs()[0]!;
    try {
      await fixture.postgres.adminPool.query(
        "UPDATE business.source_versions SET source_version_ref = $2 WHERE source_version_id = $1",
        [
          source.reference.entityId,
          { ...source, reference: { ...source.reference, versionId: "other" } },
        ],
      );
      expect(await read("c32-cleaning-source-identity", world.sourceVersionRefs())).toMatchObject({
        kind: "failed",
        error: { code: "AUTHORIZATION_DENIED" },
      });
    } finally {
      await fixture.postgres.adminPool.query(
        "UPDATE business.source_versions SET source_version_ref = $2 WHERE source_version_id = $1",
        [source.reference.entityId, source],
      );
    }
  });

  it("工程撤权后原目录授权不再可用", async () => {
    const id = "c32-cleaning-revoked";
    const authorization = await world.authorizeBranch(id, "engineering-data.source-catalog");
    const project = await fixture.postgres.adminPool.query<{ access_version: number }>(
      "SELECT access_version FROM business.access_projects WHERE project_id = $1",
      [world.projectId],
    );
    await fixture.access.administerProject({
      kind: "suspend-project",
      projectId: world.projectId,
      commandId: id + "-suspend",
      idempotencyKey: id + "-suspend",
      expectedVersion: {
        entityId: world.projectId,
        versionId: String(project.rows[0]!.access_version),
      },
      authorizationContextRef: fixture.administrationContextRef,
    });
    const adapter = new PostgresEngineeringDataCatalogAdapter({
      db: fixture.runtime.db,
      access: fixture.access,
      artifactStore: fixture.artifactStore,
      resolvers: {
        resolveReadQuery: (query, options) => fixture.registry.resolveReadQuery(query, options),
        resolveSnapshotQuery: (query, options) =>
          fixture.monitoringStore.resolveSnapshotQuery(query, options),
      },
    });
    expect(
      await adapter.read({
        kind: "source-catalog",
        queryId: id,
        projectId: world.projectId,
        actorId: authorization.actorId,
        authorization,
        requestedAt: now,
        payload: { pageSize: 50 },
      }),
    ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
  });

  it("仪表盘资料概况只计目录可见集合，未登记清洗结果的资料单独成组", async () => {
    const dashboardWorld = await fixture.createWorld({
      suffix: "c32-cleaning-dashboard",
      documentKinds: ["docx", "csv"],
      unconverted: ["csv"],
      monitoring: false,
    });
    const converted = dashboardWorld.documents[0];
    if (converted === undefined) throw new TypeError("C32 dashboard conversion missing");
    const command = await dashboardWorld.freezeCommand("c32-cleaning-dashboard-freeze", {
      actor: "uploader",
      sourceVersionRefs: [converted.sourceVersionRef],
    });
    expect(
      await dashboardWorld.pipeline.store.freezeIdentificationPreparation(command),
    ).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    await completeCleaningTask(dashboardWorld.pipeline, fixture, {
      workerId: "c32-cleaning-dashboard-worker",
      projectId: dashboardWorld.projectId,
    });
    expect(
      await dashboardWorld.pipeline.store.freezeIdentificationPreparation(command),
    ).toMatchObject({ kind: "succeeded" });

    const adapter = new PostgresEngineeringDataCatalogAdapter({
      db: fixture.runtime.db,
      access: fixture.access,
      artifactStore: fixture.artifactStore,
      resolvers: {
        resolveReadQuery: (query, options) => fixture.registry.resolveReadQuery(query, options),
        resolveSnapshotQuery: (query, options) =>
          fixture.monitoringStore.resolveSnapshotQuery(query, options),
      },
    });
    const authorization = await dashboardWorld.authorizeBranch(
      "c32-cleaning-dashboard-source",
      "engineering-data.source-catalog",
    );
    const dashboard = await adapter.readSourceDashboard({
      queryId: "c32-cleaning-dashboard-source",
      projectId: dashboardWorld.projectId,
      actorId: authorization.actorId,
      requestedAt: now,
      authorization,
      spatialScopeRef: dashboardWorld.spatialScopeRef,
    });
    expect(dashboard.kind).toBe("ready");
    if (dashboard.kind !== "ready") return;
    const catalog = await adapter.read({
      kind: "source-catalog",
      queryId: "c32-cleaning-dashboard-source-catalog",
      projectId: dashboardWorld.projectId,
      actorId: authorization.actorId,
      requestedAt: now,
      authorization,
      payload: { pageSize: 50 },
    });
    if (catalog.kind !== "succeeded" || catalog.result.kind !== "source-catalog") {
      throw new TypeError("C32 dashboard source catalog failed");
    }
    // 概况的统计单位与目录可见集合一致，不是分页累计。
    expect(dashboard.data.sourceVersionCount).toBe(catalog.result.totalCount);
    expect(dashboard.data.sourceVersionCount).toBe(2);
    expect(dashboard.data.parseStatusCounts).toHaveLength(2);
    expect(dashboard.data.parseStatusCounts).toEqual(
      expect.arrayContaining([
        { parseStatus: "parsed", count: 1 },
        { parseStatus: "registered", count: 1 },
      ]),
    );
    expect(dashboard.data.cleaningStatusCounts).toHaveLength(2);
    expect(dashboard.data.cleaningStatusCounts).toEqual(
      expect.arrayContaining([
        { status: { kind: "availability", availability: "available" }, count: 1 },
        { status: { kind: "not-registered" }, count: 1 },
      ]),
    );

    // 当前授权只覆盖一份资料版本时，概况与目录给出同一可见集合。
    const partialAuthorization = await dashboardWorld.authorizeBranch(
      "c32-cleaning-dashboard-partial",
      "engineering-data.source-catalog",
      [converted.sourceVersionRef],
    );
    const partialDashboard = await adapter.readSourceDashboard({
      queryId: "c32-cleaning-dashboard-partial-source",
      projectId: dashboardWorld.projectId,
      actorId: partialAuthorization.actorId,
      requestedAt: now,
      authorization: partialAuthorization,
      spatialScopeRef: dashboardWorld.spatialScopeRef,
    });
    if (partialDashboard.kind !== "ready") {
      throw new TypeError("C32 partial dashboard read failed");
    }
    const partialCatalog = await adapter.read({
      kind: "source-catalog",
      queryId: "c32-cleaning-dashboard-partial-catalog",
      projectId: dashboardWorld.projectId,
      actorId: partialAuthorization.actorId,
      requestedAt: now,
      authorization: partialAuthorization,
      payload: { pageSize: 50 },
    });
    if (partialCatalog.kind !== "succeeded" || partialCatalog.result.kind !== "source-catalog") {
      throw new TypeError("C32 partial source catalog failed");
    }
    expect(partialCatalog.result.items.map((item) => item.sourceVersionRef)).toEqual([
      converted.sourceVersionRef,
    ]);
    expect(partialDashboard.data.sourceVersionCount).toBe(partialCatalog.result.totalCount);
    expect(partialDashboard.data.sourceVersionCount).toBe(1);
    expect(partialDashboard.data.parseStatusCounts).toEqual([{ parseStatus: "parsed", count: 1 }]);
    expect(partialDashboard.data.cleaningStatusCounts).toEqual([
      { status: { kind: "availability", availability: "available" }, count: 1 },
    ]);
  });
});

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
  let applicabilitySnapshotRef: ApplicabilityMetadataSnapshotRefV1;
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
    applicabilitySnapshotRef = applicability.result.snapshot.snapshotRef;
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
        applicabilityMetadataSnapshotRef: applicabilitySnapshotRef,
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

  it("source-catalog 只转出登记 descriptor 已持有的交付方式与连接定义引用，不带连接秘密", async () => {
    const connectionDefinitionRef = { entityId: "c32-connection", versionId: "3" };
    const put = async (id: string, content: string, mediaType: string) =>
      fixture.artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: `c32-put-${id}`,
          idempotencyKey: `c32-put-${id}`,
          projectId,
          actorId: managerId,
          issuedAt: now,
          authorization: await authorization(
            `c32-put-${id}`,
            "engineering-data.register-source-delivery",
          ),
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
    const delivery = await fixture.registry.apply({
      commandId: "c32-snapshot-delivery",
      idempotencyKey: "c32-snapshot-delivery",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: await authorization(
        "c32-snapshot-delivery",
        "engineering-data.register-source-delivery",
      ),
      kind: "register-source-delivery",
      payload: {
        sourceConnectionRef: connectionDefinitionRef,
        deliveryKey: "c32-snapshot-delivery",
        sourceArtifactRef: (await put("snapshot-source", "snapshot source body", "text/plain"))
          .artifactRef,
        metadataArtifactRef: (
          await put(
            "snapshot-metadata",
            JSON.stringify({
              schemaVersion: "1",
              projectRevisionRef,
              spatialScopeRefs: [spatialScopeRef],
              registeredByAccountId: managerId,
              sourceItemId: "c32-source-item-snapshot",
              sourceItemName: "监测快照",
              sourceCategory: "monitoring-snapshot",
              sourceMetadata: { documentType: "监测快照" },
              descriptor: {
                kind: "database-snapshot",
                connectionDefinitionRef,
                queryFingerprint: "monitoring-query-fingerprint",
                cursorFingerprint: "monitoring-cursor-fingerprint",
              },
              applicabilityMetadataSnapshotRef: applicabilitySnapshotRef,
            }),
            "application/json",
          )
        ).artifactRef,
        occurredAt: now,
      },
    } satisfies Extract<EngineeringDataCommandV1, { kind: "register-source-delivery" }>);
    if (delivery.kind !== "succeeded") throw new Error("C32 snapshot delivery failed");
    const snapshotSourceVersionRef = delivery.result.sourceVersionRef;

    const result = await catalog.read({
      queryId: "c32-source-catalog-connection",
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: await authorization(
        "c32-source-catalog-connection",
        "engineering-data.source-catalog",
      ),
      kind: "source-catalog",
      payload: { pageSize: 10 },
    });
    if (result.kind !== "succeeded" || result.result.kind !== "source-catalog") {
      throw new Error("C32 source catalog with connection failed");
    }
    const byRef = (entityId: string) =>
      result.result.items.find((item) => item.sourceVersionRef.reference.entityId === entityId);

    // database-snapshot 登记：交付方式与连接定义引用逐字取自 descriptor。
    const snapshot = byRef(snapshotSourceVersionRef.reference.entityId);
    expect(snapshot?.deliveryKind).toBe("database-snapshot");
    expect(snapshot?.connectionDefinitionRef).toEqual(connectionDefinitionRef);

    // file-upload 登记本身不持有连接定义引用：缺席即未登记，不用空值冒充。
    const uploaded = byRef(sourceVersionRef.reference.entityId);
    expect(uploaded?.deliveryKind).toBe("file-upload");
    expect(uploaded?.connectionDefinitionRef).toBeUndefined();

    // 摘要条目只承载引用，不泄露 descriptor 里的查询/游标指纹。
    expect(JSON.stringify(snapshot)).not.toContain("monitoring-query-fingerprint");
    expect(JSON.stringify(snapshot)).not.toContain("monitoring-cursor-fingerprint");
  });

  it("仪表盘监测概况只数真实存在批次与冻结快照的可见序列", async () => {
    const reviseSeries = async (entityId: string, indicator: MonitoringIndicator) => {
      const seriesRef = {
        kind: "monitoring-series" as const,
        reference: { entityId, versionId: "1" },
      };
      const revised = await fixture.monitoringStore.reviseSeries({
        commandId: `c32-dashboard-${entityId}`,
        idempotencyKey: `c32-dashboard-${entityId}`,
        projectId,
        actorId: managerId,
        issuedAt: now,
        authorization: await authorization(
          `c32-dashboard-${entityId}`,
          "engineering-data.register-monitoring-batch",
          [sourceVersionRef],
        ),
        monitoringSeriesRef: seriesRef,
        expectedVersion: "none",
        projectRevisionRef,
        spatialScopeRef,
        monitoringObject: "settlement sensor",
        monitoringIndicator: indicator,
        parameterCode: "settlement",
        canonicalUnit: "mm",
        unitConversions: [{ fromUnit: "cm", scale: 10, offset: 0 }],
        effectivePeriod: { validFrom: now },
      });
      if (revised.kind !== "succeeded") throw new TypeError("C32 dashboard series failed");
      return seriesRef;
    };
    const batchSeriesRef = await reviseSeries("c32-dashboard-batch-series", "地下水位");
    await reviseSeries("c32-dashboard-empty-series", "泥水压力");

    const evidence = {
      locator: { sourceSegmentId: `${sourceVersionRef.reference.entityId}-chapter_1-segment_1` },
      sourceVersion: sourceVersionRef.reference,
    };
    const lines = [
      JSON.stringify({
        schemaVersion: "1",
        mediaType: "application/x-ndjson",
        monitoringSeriesRef: batchSeriesRef,
        projectRevisionRef,
        spatialScopeRef,
        sourceVersionRef,
        sourceSegmentSetRef,
        productionStrategyRef: { entityId: "monitoring-production", versionId: "1" },
        sampleCount: 5,
      }),
      ...[6, 7, 8, 9, 10].map((second) =>
        JSON.stringify({
          sourceSampleKey: `dashboard-s-${second}`,
          sampledAt: `2030-01-01T00:00:${String(second).padStart(2, "0")}.000Z`,
          value: second * 2,
          unit: "mm",
          evidenceReferences: [evidence],
        }),
      ),
    ].join("\n");
    const sampleArtifact = await fixture.artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: "1",
        commandId: "c32-dashboard-batch-artifact",
        idempotencyKey: "c32-dashboard-batch-artifact",
        projectId,
        actorId: managerId,
        issuedAt: now,
        authorization: await authorization(
          "c32-dashboard-batch-artifact",
          "engineering-data.register-monitoring-batch",
          [sourceVersionRef],
        ),
        requiredCapability: "engineering-data.write",
        artifactKind: "content",
        artifactId: "c32-dashboard-batch-artifact",
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
      commandId: "c32-dashboard-batch",
      idempotencyKey: "c32-dashboard-batch",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: await authorization(
        "c32-dashboard-batch",
        "engineering-data.register-monitoring-batch",
        [sourceVersionRef],
      ),
      kind: "register-monitoring-batch",
      payload: {
        monitoringSeriesRef: batchSeriesRef,
        deliveryKey: "c32-dashboard-batch",
        sampleArtifactRef: sampleArtifact.artifactRef,
        window: { from: "2030-01-01T00:00:05.000Z", to: "2030-01-01T00:00:11.000Z" },
        relation: { kind: "original" },
      },
    });
    if (batch.kind !== "succeeded") throw new TypeError("C32 dashboard batch failed");

    const dashboard = await catalog.readMonitoringDashboard({
      queryId: "c32-dashboard-monitoring",
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: await authorization(
        "c32-dashboard-monitoring",
        "engineering-data.monitoring-catalog",
      ),
      spatialScopeRef,
    });
    expect(dashboard.kind).toBe("ready");
    if (dashboard.kind !== "ready") return;
    // 既有序列同时有批次与冻结快照；批次序列与空序列都不得被折算成监测点或测值。
    expect(dashboard.data).toEqual({
      seriesCount: 3,
      seriesWithBatchCount: 2,
      seriesWithSnapshotCount: 1,
    });
  });

  it("仪表盘资料与监测概况无权同形失败且不返回计数", async () => {
    const sourceAuthorization = await authorization(
      "c32-dashboard-documents-denied",
      "engineering-data.source-catalog",
    );
    const monitoringAuthorization = await authorization(
      "c32-dashboard-monitoring-denied",
      "engineering-data.monitoring-catalog",
    );
    const expectDenied = (
      result: RiskDashboardDocumentsSourceResultV1 | RiskDashboardMonitoringSourceResultV1,
    ): void => {
      expect(result.kind).toBe("failed");
      if (result.kind !== "failed") return;
      expect(result.error.code).toBe("AUTHORIZATION_DENIED");
      expect("data" in result).toBe(false);
    };
    const noCapability: AuthorizationContextV1 = {
      ...sourceAuthorization,
      grantedCapabilities: ["projection.query"],
    };
    const crossProject: AuthorizationContextV1 = {
      ...sourceAuthorization,
      projectId: "project-c32-other",
    };
    expectDenied(
      await catalog.readSourceDashboard({
        queryId: "c32-dashboard-documents-no-capability",
        projectId,
        actorId: managerId,
        requestedAt: now,
        authorization: noCapability,
      }),
    );
    expectDenied(
      await catalog.readSourceDashboard({
        queryId: "c32-dashboard-documents-cross-project",
        projectId,
        actorId: managerId,
        requestedAt: now,
        authorization: crossProject,
      }),
    );
    expectDenied(
      await catalog.readMonitoringDashboard({
        queryId: "c32-dashboard-monitoring-no-capability",
        projectId,
        actorId: managerId,
        requestedAt: now,
        authorization: { ...monitoringAuthorization, grantedCapabilities: ["projection.query"] },
      }),
    );
    expectDenied(
      await catalog.readMonitoringDashboard({
        queryId: "c32-dashboard-monitoring-cross-project",
        projectId,
        actorId: managerId,
        requestedAt: now,
        authorization: { ...monitoringAuthorization, projectId: "project-c32-other" },
      }),
    );
  });
});
