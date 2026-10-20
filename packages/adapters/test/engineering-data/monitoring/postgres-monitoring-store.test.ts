import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { QueryResultRefV1 } from "@riskflow/contracts/ports";

import { ArtifactPutCommandV1Schema } from "@riskflow/core/artifacts";
import type {
  MonitoringSeriesReadResultV1,
  ReadMonitoringSeriesRevisionQueryV1,
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
import { createPostgresRuntime } from "../../../src/postgres/pool.js";
import * as monitoringMigration from "../../../src/postgres/migrations/engineering-data/deliver-monitoring-batches-snapshots-and-features/000011_monitoring_batches_snapshots_features.js";
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
  let seriesReadAuthorization: AuthorizationContextV1;
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
    const migrator = createPostgresRuntime(fixture.postgres.migrator, "riskflow_migrator");
    try {
      await monitoringMigration.down(migrator.db);
      await monitoringMigration.up(migrator.db);
    } finally {
      await migrator.db.destroy();
    }
    const privileges = await fixture.postgres.adminPool.query<{
      role: string;
      read: boolean;
      write: boolean;
      remove: boolean;
    }>(
      "SELECT role, has_table_privilege(role, 'business.monitoring_batches', 'SELECT') AS read, has_table_privilege(role, 'business.monitoring_batches', 'INSERT') AS write, has_table_privilege(role, 'business.monitoring_batches', 'DELETE') AS remove FROM unnest($1::text[]) AS role",
      [["riskflow_app", "riskflow_outbox_worker", "riskflow_checkpointer"]],
    );
    expect(privileges.rows).toEqual([
      { role: "riskflow_app", read: true, write: true, remove: false },
      { role: "riskflow_outbox_worker", read: false, write: false, remove: false },
      { role: "riskflow_checkpointer", read: false, write: false, remove: false },
    ]);
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
        {
          sourceSegmentId: `${sourceVersionRef.reference.entityId}-chapter_1-segment_2` as never,
          chapterId: "chapter_1",
          segmentId: "segment_2",
          kind: "chapter",
          spatialScopeRefs: [spatialScopeRef],
          locator: { kind: "document", pageNumber: 2, headingPath: ["监测"] },
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

    const register = async (
      id: string,
      sampleLines: string[],
      relation: Extract<
        EngineeringDataCommandV1,
        { kind: "register-monitoring-batch" }
      >["payload"]["relation"],
      rawContent?: Uint8Array,
    ) => {
      const auth = await authorization(id, "engineering-data.register-monitoring-batch", [
        sourceVersionRef,
      ]);
      const envelope = { ...JSON.parse(lines.split("\n")[0]!), sampleCount: sampleLines.length };
      const stored = await fixture.artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: `${id}-put`,
          idempotencyKey: `${id}-put`,
          projectId,
          actorId: managerId,
          issuedAt: now,
          authorization: auth,
          requiredCapability: "engineering-data.write",
          artifactId: id,
          artifactKind: "content",
          purposeCode: "engineering-data.register-monitoring-batch",
          mediaType: "application/x-ndjson",
          parentArtifactRefs: [],
          evidenceReferences: [evidence],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        (async function* () {
          yield rawContent ??
            new TextEncoder().encode([JSON.stringify(envelope), ...sampleLines].join("\n"));
        })(),
      );
      const command = {
        commandId: id,
        idempotencyKey: id,
        projectId,
        actorId: managerId,
        issuedAt: now,
        authorization: auth,
        kind: "register-monitoring-batch" as const,
        payload: {
          monitoringSeriesRef: seriesRef,
          deliveryKey: id,
          sampleArtifactRef: stored.artifactRef,
          window: { from: "2030-01-01T00:00:00.000Z", to: "2030-01-01T00:00:11.000Z" },
          relation,
        },
      };
      return { command, result: await fixture.registry.apply(command) };
    };
    const sample = (second: number, value: number, extra = {}) =>
      JSON.stringify({
        sourceSampleKey: `s-${second}`,
        sampledAt: `2030-01-01T00:00:${String(second).padStart(2, "0")}.000Z`,
        value,
        unit: "mm",
        evidenceReferences: [evidence],
        ...extra,
      });
    if (batch.kind !== "succeeded") throw new Error("missing original batch");
    const correction = await register("c14-valid-correction", [sample(9, 99)], {
      kind: "correction",
      priorBatchRef: batch.result.monitoringBatchRef,
    });
    expect(correction.result.kind).toBe("succeeded");
    expect(await fixture.registry.apply(correction.command)).toEqual(correction.result);
    const concurrent = await Promise.all([
      fixture.registry.apply(correction.command),
      fixture.registry.apply(correction.command),
    ]);
    expect(concurrent).toEqual([correction.result, correction.result]);
    const duplicateAuth = await authorization(
      "c14-correction-duplicate",
      "engineering-data.register-monitoring-batch",
      [sourceVersionRef],
    );
    expect(
      await fixture.registry.apply({
        ...correction.command,
        commandId: "c14-correction-duplicate",
        idempotencyKey: "c14-correction-duplicate",
        authorization: duplicateAuth,
      }),
    ).toEqual(correction.result);
    expect(
      await fixture.registry.apply({
        ...correction.command,
        payload: {
          ...correction.command.payload,
          deliveryKey: "different",
        },
      }),
    ).toMatchObject({ kind: "failed", error: { code: "IDEMPOTENCY_CONFLICT" } });
    const supplement = await register("c14-supplement", [sample(5, 10)], {
      kind: "supplement",
      priorBatchRef: batch.result.monitoringBatchRef,
    });
    expect(supplement.result.kind).toBe("succeeded");
    const independentEvidence = await register(
      "c14-independent-evidence",
      [
        sample(6, 12, {
          evidenceReferences: [
            {
              ...evidence,
              locator: {
                sourceSegmentId: `${sourceVersionRef.reference.entityId}-chapter_1-segment_2`,
              },
            },
          ],
        }),
      ],
      { kind: "original" },
    );
    expect(independentEvidence.result.kind).toBe("succeeded");
    expect(independentEvidence.result).not.toEqual(batch);
    // 固定记录时间碰撞，冻结仍应采用后登记的更正版本。
    await fixture.postgres.adminPool.query(
      "UPDATE business.monitoring_sample_versions SET recorded_at = (SELECT min(recorded_at) FROM business.monitoring_sample_versions) WHERE sampled_at = $1",
      ["2030-01-01T00:00:09.000Z"],
    );
    await fixture.postgres.adminPool.query(
      "ALTER TABLE audit.entries ADD CONSTRAINT c14_reject_audit CHECK (command_id <> 'c14-audit-failure')",
    );
    try {
      const failed = await register("c14-audit-failure", [sample(3, 6)], {
        kind: "supplement",
        priorBatchRef: batch.result.monitoringBatchRef,
      });
      expect(failed.result.kind).toBe("failed");
      const facts = await fixture.postgres.adminPool.query(
        "SELECT (SELECT count(*)::int FROM business.monitoring_batches WHERE delivery_key = 'c14-audit-failure') AS batches, (SELECT count(*)::int FROM business.command_receipts WHERE command_id = 'c14-audit-failure') AS receipts",
      );
      expect(facts.rows).toEqual([{ batches: 0, receipts: 0 }]);
    } finally {
      await fixture.postgres.adminPool.query(
        "ALTER TABLE audit.entries DROP CONSTRAINT c14_reject_audit",
      );
    }
    const beforeInvalid = await fixture.postgres.adminPool.query(
      "SELECT count(*)::int AS count FROM business.monitoring_batches",
    );
    for (const [id, invalid] of [
      ["unknown-field", [sample(4, 8, { unknown: true })]],
      ["duplicate-time", [sample(4, 8), sample(4, 8)]],
      ["unordered", [sample(4, 8), sample(3, 6)]],
      ["unknown-unit", [sample(4, 8, { unit: "unknown" })]],
      ["no-evidence", [sample(4, 8, { evidenceReferences: [] })]],
      ["out-of-window", [sample(12, 24)]],
      ["non-finite", [sample(4, Number.POSITIVE_INFINITY)]],
      ["line-limit", [sample(4, 8, { sourceSampleKey: "x".repeat(16_385) })]],
    ] as const) {
      const rejected = await register(`c14-invalid-${id}`, [...invalid], { kind: "original" });
      expect(rejected.result.kind).toBe("failed");
    }
    expect(
      (
        await register(
          "c14-invalid-utf8",
          [sample(4, 8)],
          { kind: "original" },
          new Uint8Array([0xc0, 0xaf]),
        )
      ).result.kind,
    ).toBe("failed");
    expect(
      (
        await fixture.postgres.adminPool.query(
          "SELECT count(*)::int AS count FROM business.monitoring_batches",
        )
      ).rows,
    ).toEqual(beforeInvalid.rows);
    const nextAuth = await authorization(
      "c14-freeze-after",
      "engineering-data.monitoring-snapshot",
      [sourceVersionRef],
    );
    const nextCommand = {
      commandId: "c14-freeze-after",
      idempotencyKey: "c14-freeze-after",
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: nextAuth,
      kind: "monitoring-snapshot" as const,
      payload: {
        monitoringSeriesRef: seriesRef,
        cutoff: "2030-01-01T00:00:10.000Z",
        availabilityPolicyRef: { entityId: "c14-policy", versionId: "1" },
      },
    };
    const next = await fixture.registry.freeze(nextCommand);
    expect(next.kind).toBe("succeeded");
    expect(await fixture.registry.freeze(nextCommand)).toEqual(next);
    const after = await fixture.monitoringStore.resolveSnapshotQuery({
      queryResultRef,
      invocationId: "c14-query",
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: queryAuth,
    });
    expect(after).toEqual(resolved);
    if (next.kind !== "succeeded") throw new Error("missing new snapshot");
    const points = await fixture.postgres.adminPool.query<{ value: number }>(
      "SELECT canonical_value AS value FROM business.monitoring_sample_versions s JOIN business.monitoring_snapshot_members m ON m.sample_version_id = s.sample_version_id WHERE m.snapshot_id = $1 AND s.sampled_at = $2",
      [next.result.monitoringSnapshotRef.reference.entityId, "2030-01-01T00:00:09.000Z"],
    );
    expect(points.rows).toEqual([{ value: 99 }]);
    const empty = await fixture.registry.freeze({
      ...nextCommand,
      commandId: "c14-empty",
      idempotencyKey: "c14-empty",
      authorization: await authorization("c14-empty", "engineering-data.monitoring-snapshot", [
        sourceVersionRef,
      ]),
      payload: { ...nextCommand.payload, cutoff: "2029-12-31T23:59:59.000Z" },
    });
    expect(empty.kind).toBe("succeeded");
    if (empty.kind !== "succeeded") throw new Error("missing empty snapshot");
    const emptyRow = await fixture.postgres.adminPool.query(
      "SELECT availability FROM business.monitoring_snapshots WHERE snapshot_id = $1",
      [empty.result.monitoringSnapshotRef.reference.entityId],
    );
    expect(emptyRow.rows).toEqual([{ availability: "unavailable" }]);
  });

  it("reads one exact series revision with bounded fields, independent access audits, and stable denials", async () => {
    const seriesRef = {
      kind: "monitoring-series" as const,
      reference: { entityId: "c14-series", versionId: "1" },
    };
    seriesReadAuthorization = await authorization(
      "c14-series-read",
      "engineering-data.monitoring-snapshot-query",
    );
    const query: ReadMonitoringSeriesRevisionQueryV1 = {
      queryId: "c14-series-read",
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: seriesReadAuthorization,
      monitoringSeriesRef: seriesRef,
    };
    const evidenceFor = async (queryId: string) =>
      fixture.postgres.adminPool.query<{
        receipts: number;
        audits: number;
        command_kind: string | null;
        result_ref: unknown;
      }>(
        `SELECT (SELECT count(*)::int FROM business.command_receipts WHERE command_id = $1) AS receipts,
                (SELECT count(*)::int FROM audit.entries WHERE command_id = $1) AS audits,
                (SELECT command_kind FROM business.command_receipts WHERE command_id = $1) AS command_kind,
                (SELECT result_ref FROM business.command_receipts WHERE command_id = $1) AS result_ref`,
        [queryId],
      );
    const stableErrorShape = (error: unknown): Record<string, unknown> => {
      const shape = { ...(error as Record<string, unknown>) };
      delete shape.occurredAt;
      delete shape.causalRunId;
      return shape;
    };
    const errorOf = (result: MonitoringSeriesReadResultV1): Record<string, unknown> => {
      if (result.kind !== "failed") throw new Error("expected a failed series read");
      return stableErrorShape(result.error);
    };
    const read = await fixture.monitoringStore.readSeriesRevision(query);
    expect(read).toEqual({
      kind: "succeeded",
      result: {
        monitoringSeriesRef: seriesRef,
        seriesId: "c14-series",
        projectId,
        projectRevisionRef,
        spatialScopeRef,
        monitoringObject: "settlement sensor",
        monitoringIndicator: "地表沉降",
        parameterCode: "settlement",
        canonicalUnit: "mm",
        unitConversions: [{ fromUnit: "cm", scale: 10, offset: 0 }],
        effectivePeriod: { validFrom: now },
        recordedAt: now,
        status: "current",
      },
    });
    expect((await evidenceFor("c14-series-read")).rows).toEqual([
      {
        receipts: 0,
        audits: 1,
        command_kind: null,
        result_ref: null,
      },
    ]);
    expect(await fixture.monitoringStore.readSeriesRevision(query)).toEqual(read);
    expect((await evidenceFor("c14-series-read")).rows).toEqual([
      {
        receipts: 0,
        audits: 2,
        command_kind: null,
        result_ref: null,
      },
    ]);
    expect(
      await fixture.monitoringStore.readSeriesRevision({
        ...query,
        requestedAt: "2030-01-01T00:00:01.000Z",
      }),
    ).toEqual(read);
    const facts = await fixture.postgres.adminPool.query<{
      series: number;
      revisions: number;
      events: number;
    }>(
      `SELECT (SELECT count(*)::int FROM business.monitoring_series) AS series,
              (SELECT count(*)::int FROM business.monitoring_series_revisions) AS revisions,
              (SELECT count(*)::int FROM outbox.events WHERE event_type LIKE 'engineering.%') AS events`,
    );
    expect(facts.rows).toEqual([{ series: 1, revisions: 1, events: 0 }]);
    // 其它工程已存在同版本序列修订，读取仍必须与"缺失/版本不匹配"同构拒绝。
    await fixture.postgres.adminPool.query(
      `INSERT INTO business.monitoring_series (series_id, project_id, current_revision_id)
       VALUES ('c14-other-series', 'project-c14-other', NULL)`,
    );
    await fixture.postgres.adminPool.query(
      `INSERT INTO audit.entries (audit_entry_id, project_id, action, target_ref, actor_ref, authorization_context_ref, version_ref, occurred_at, recorded_at, command_id, idempotency_key)
       VALUES ('audit:c14-other-series', 'project-c14-other', 'engineering-data.monitoring-series-revision',
               '{"kind":"monitoring-series","reference":{"entityId":"c14-other-series","versionId":"1"}}'::jsonb,
               $1,
               '{"kind":"authorization-context","reference":{"entityId":"c14-other-series","versionId":"1"}}'::jsonb,
               '{"entityId":"c14-other-series","versionId":"1"}'::jsonb,
               $2::timestamptz, $2::timestamptz, 'c14-other-series', 'c14-other-series')`,
      [managerId, now],
    );
    await fixture.postgres.adminPool.query(
      `INSERT INTO business.monitoring_series_revisions (revision_id, series_id, project_id, revision_no, version_id, monitoring_series_ref, project_revision_ref, spatial_scope_ref, monitoring_object, monitoring_indicator, parameter_code, canonical_unit, unit_conversions, effective_period, recorded_at, actor_id, authorization_context_ref, audit_entry_id, occurred_at)
       VALUES ('c14-other-series:1', 'c14-other-series', 'project-c14-other', 1, '1',
               '{"kind":"monitoring-series","reference":{"entityId":"c14-other-series","versionId":"1"}}'::jsonb,
               '{"kind":"project-revision","reference":{"entityId":"project-c14-other","versionId":"1"}}'::jsonb,
               '{"kind":"spatial-scope","reference":{"entityId":"c14-other-scope","versionId":"1"}}'::jsonb,
               'settlement sensor', '地表沉降', 'settlement', 'mm', '[]'::jsonb,
               '{"validFrom":"2030-01-01T00:00:00.000Z"}'::jsonb,
               $1::timestamptz, $2,
               '{"kind":"authorization-context","reference":{"entityId":"c14-other-series","versionId":"1"}}'::jsonb,
               'audit:c14-other-series', $1::timestamptz)`,
      [now, managerId],
    );
    await fixture.postgres.adminPool.query(
      `UPDATE business.monitoring_series SET current_revision_id = 'c14-other-series:1' WHERE series_id = 'c14-other-series'`,
    );
    const denied = await Promise.all([
      fixture.monitoringStore.readSeriesRevision({
        ...query,
        queryId: "c14-read-missing",
        monitoringSeriesRef: {
          kind: "monitoring-series",
          reference: { entityId: "c14-missing-series", versionId: "1" },
        },
        authorization: await authorization(
          "c14-read-missing",
          "engineering-data.monitoring-snapshot-query",
        ),
      }),
      fixture.monitoringStore.readSeriesRevision({
        ...query,
        queryId: "c14-read-wrong-version",
        monitoringSeriesRef: {
          kind: "monitoring-series",
          reference: { entityId: "c14-series", versionId: "9" },
        },
        authorization: await authorization(
          "c14-read-wrong-version",
          "engineering-data.monitoring-snapshot-query",
        ),
      }),
      fixture.monitoringStore.readSeriesRevision({
        ...query,
        queryId: "c14-read-foreign",
        monitoringSeriesRef: {
          kind: "monitoring-series",
          reference: { entityId: "c14-other-series", versionId: "1" },
        },
        authorization: await authorization(
          "c14-read-foreign",
          "engineering-data.monitoring-snapshot-query",
        ),
      }),
    ]);
    for (const failure of denied) {
      expect(failure).toMatchObject({
        kind: "failed",
        error: {
          code: "AUTHORIZATION_DENIED",
          category: "authorization",
          requiredCapability: "engineering-data.read",
          retryable: false,
        },
      });
      expect(errorOf(failure)).not.toHaveProperty("targetRef");
    }
    expect(errorOf(denied[0]!)).toEqual(errorOf(denied[1]!));
    expect(errorOf(denied[0]!)).toEqual(errorOf(denied[2]!));
    expect((await evidenceFor("c14-read-missing")).rows).toEqual([
      { receipts: 0, audits: 0, command_kind: null, result_ref: null },
    ]);
  });

  it("records each authorized access and writes only the verified actor", async () => {
    const seriesRef = {
      kind: "monitoring-series" as const,
      reference: { entityId: "c14-series", versionId: "1" },
    };
    const queryId = "c14-read-precedence";
    const query: ReadMonitoringSeriesRevisionQueryV1 = {
      queryId,
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: await authorization(queryId, "engineering-data.monitoring-snapshot-query"),
      monitoringSeriesRef: seriesRef,
    };
    const readEvidence = async (id: string) =>
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
                  (SELECT actor_ref FROM audit.entries WHERE command_id = $1 LIMIT 1) AS audit_actor`,
          [id],
        )
      ).rows[0];
    // 重复查看返回同一业务结果，每次记录访问。
    const first = await fixture.monitoringStore.readSeriesRevision(query);
    expect(first).toMatchObject({ kind: "succeeded", result: { monitoringSeriesRef: seriesRef } });
    expect(await fixture.monitoringStore.readSeriesRevision(query)).toEqual(first);
    expect(await readEvidence(queryId)).toEqual({
      receipts: 0,
      audits: 2,
      receipt_actor: null,
      audit_actor: managerId,
    });
    // 新的访问时间不占用业务幂等键。
    const changedAuthorization = {
      ...query.authorization,
      decidedAt: "2030-01-01T00:00:01.000Z",
    };
    expect(
      await fixture.monitoringStore.readSeriesRevision({
        ...query,
        authorization: changedAuthorization,
      }),
    ).toEqual(first);
    expect(await readEvidence(queryId)).toEqual({
      receipts: 0,
      audits: 3,
      receipt_actor: null,
      audit_actor: managerId,
    });
    // 新登录取得的授权可以继续读取既有对象。
    const otherAuthorization = await authorization(
      "c14-read-other-invocation",
      "engineering-data.monitoring-snapshot-query",
    );
    expect(
      await fixture.monitoringStore.readSeriesRevision({
        ...query,
        authorization: otherAuthorization,
      }),
    ).toEqual(first);
    expect(await readEvidence(queryId)).toEqual({
      receipts: 0,
      audits: 4,
      receipt_actor: null,
      audit_actor: managerId,
    });
    // 伪造载荷 actor：当前授权通过也不得进入收据、审计或任何事实。
    const factsBefore = await fixture.postgres.adminPool.query<{
      series: number;
      revisions: number;
      events: number;
    }>(
      `SELECT (SELECT count(*)::int FROM business.monitoring_series) AS series,
              (SELECT count(*)::int FROM business.monitoring_series_revisions) AS revisions,
              (SELECT count(*)::int FROM outbox.events WHERE event_type LIKE 'engineering.%') AS events`,
    );
    const forgedQueryId = "c14-read-forged-actor";
    const forgedAuthorization = await authorization(
      forgedQueryId,
      "engineering-data.monitoring-snapshot-query",
    );
    expect(
      await fixture.monitoringStore.readSeriesRevision({
        queryId: forgedQueryId,
        projectId,
        actorId: "c14-forged-actor",
        requestedAt: now,
        authorization: { ...forgedAuthorization, actorId: "c14-forged-actor" },
        monitoringSeriesRef: seriesRef,
      }),
    ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    expect(await readEvidence(forgedQueryId)).toEqual({
      receipts: 0,
      audits: 0,
      receipt_actor: null,
      audit_actor: null,
    });
    const forgedActorRows = await fixture.postgres.adminPool.query<{ rows: number }>(
      `SELECT (SELECT count(*)::int FROM business.command_receipts WHERE actor_ref = 'c14-forged-actor') +
              (SELECT count(*)::int FROM audit.entries WHERE actor_ref = 'c14-forged-actor') AS rows`,
    );
    expect(forgedActorRows.rows).toEqual([{ rows: 0 }]);
    const factsAfter = await fixture.postgres.adminPool.query<{
      series: number;
      revisions: number;
      events: number;
    }>(
      `SELECT (SELECT count(*)::int FROM business.monitoring_series) AS series,
              (SELECT count(*)::int FROM business.monitoring_series_revisions) AS revisions,
              (SELECT count(*)::int FROM outbox.events WHERE event_type LIKE 'engineering.%') AS events`,
    );
    expect(factsAfter.rows).toEqual(factsBefore.rows);
  });

  it("denies forged actor declarations across monitoring writes, reads, and resolution", async () => {
    const seriesRef = {
      kind: "monitoring-series" as const,
      reference: { entityId: "c14-series", versionId: "1" },
    };
    const forgedActorId = "c14-forged-actor-binding";
    const evidence = {
      locator: { sourceSegmentId: `${sourceVersionRef.reference.entityId}-chapter_1-segment_1` },
      sourceVersion: sourceVersionRef.reference,
    };
    const forgedAuthorization = async (
      id: string,
      branch:
        | "engineering-data.register-monitoring-batch"
        | "engineering-data.monitoring-snapshot"
        | "engineering-data.monitoring-snapshot-query",
      sourceRefs: readonly SourceVersionRefV1[] = [],
    ): Promise<AuthorizationContextV1> => ({
      ...(await authorization(id, branch, sourceRefs)),
      actorId: forgedActorId,
    });
    const putSamples = async (
      id: string,
      authorizationContext: AuthorizationContextV1,
      samples: readonly { readonly second: number; readonly value: number }[],
    ) =>
      fixture.artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: `${id}-put`,
          idempotencyKey: `${id}-put`,
          projectId,
          actorId: managerId,
          issuedAt: now,
          authorization: authorizationContext,
          requiredCapability: "engineering-data.write",
          artifactId: id,
          artifactKind: "content",
          purposeCode: "engineering-data.register-monitoring-batch",
          mediaType: "application/x-ndjson",
          parentArtifactRefs: [],
          evidenceReferences: [evidence],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        (async function* () {
          yield new TextEncoder().encode(
            [
              JSON.stringify({
                schemaVersion: "1",
                mediaType: "application/x-ndjson",
                monitoringSeriesRef: seriesRef,
                projectRevisionRef,
                spatialScopeRef,
                sourceVersionRef,
                sourceSegmentSetRef,
                productionStrategyRef: { entityId: "monitoring-production", versionId: "1" },
                sampleCount: samples.length,
              }),
              ...samples.map((sample) =>
                JSON.stringify({
                  sourceSampleKey: `${id}-${sample.second}`,
                  sampledAt: `2030-01-01T00:00:${String(sample.second).padStart(2, "0")}.000Z`,
                  value: sample.value,
                  unit: "mm",
                  evidenceReferences: [evidence],
                }),
              ),
            ].join("\n"),
          );
        })(),
      );
    const monitoringFacts = async () =>
      (
        await fixture.postgres.adminPool.query<{
          series: number;
          revisions: number;
          policies: number;
          batches: number;
          samples: number;
          snapshots: number;
          queries: number;
          events: number;
          current_revision_id: string | null;
        }>(
          `SELECT (SELECT count(*)::int FROM business.monitoring_series) AS series,
                  (SELECT count(*)::int FROM business.monitoring_series_revisions) AS revisions,
                  (SELECT count(*)::int FROM business.monitoring_availability_policies) AS policies,
                  (SELECT count(*)::int FROM business.monitoring_batches) AS batches,
                  (SELECT count(*)::int FROM business.monitoring_sample_versions) AS samples,
                  (SELECT count(*)::int FROM business.monitoring_snapshots) AS snapshots,
                  (SELECT count(*)::int FROM business.monitoring_snapshot_query_results) AS queries,
                  (SELECT count(*)::int FROM outbox.events WHERE event_type LIKE 'engineering.%') AS events,
                  (SELECT current_revision_id FROM business.monitoring_series WHERE project_id = $1 AND series_id = 'c14-series') AS current_revision_id`,
          [projectId],
        )
      ).rows[0]!;
    const commandEvidence = async (id: string) =>
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
    const forgedActorRows = async () =>
      (
        await fixture.postgres.adminPool.query<{ rows: number }>(
          `SELECT (SELECT count(*)::int FROM business.command_receipts WHERE actor_ref = $1) +
                  (SELECT count(*)::int FROM audit.entries WHERE actor_ref = $1) +
                  (SELECT count(*)::int FROM business.monitoring_series_revisions WHERE actor_id = $1) +
                  (SELECT count(*)::int FROM business.monitoring_availability_policies WHERE actor_id = $1) +
                  (SELECT count(*)::int FROM business.monitoring_batches WHERE actor_id = $1) +
                  (SELECT count(*)::int FROM business.monitoring_snapshots WHERE actor_id = $1) +
                  (SELECT count(*)::int FROM business.monitoring_snapshot_query_results WHERE requested_by = $1) AS rows`,
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

    // 先用合规主体冻结一个真实快照，供热/读/解析的伪造用例定位到既有目标。
    const freezeControlId = "c14-binding-freeze-control";
    const freezeControl = await fixture.registry.freeze({
      commandId: freezeControlId,
      idempotencyKey: freezeControlId,
      projectId,
      actorId: managerId,
      issuedAt: now,
      authorization: await authorization(freezeControlId, "engineering-data.monitoring-snapshot", [
        sourceVersionRef,
      ]),
      kind: "monitoring-snapshot",
      payload: {
        monitoringSeriesRef: seriesRef,
        cutoff: "2030-01-01T00:00:10.000Z",
        availabilityPolicyRef: { entityId: "c14-policy", versionId: "1" },
      },
    });
    if (freezeControl.kind !== "succeeded") throw new Error("binding freeze control failed");
    const bindingSnapshotRef = freezeControl.result.monitoringSnapshotRef;
    expect(
      (
        await fixture.postgres.adminPool.query<{ actor_id: string }>(
          "SELECT actor_id FROM business.monitoring_snapshots WHERE snapshot_id = $1",
          [bindingSnapshotRef.reference.entityId],
        )
      ).rows,
    ).toEqual([{ actor_id: managerId }]);

    const batchArtifactId = "c14-binding-batch-artifact";
    const batchArtifactAuth = await authorization(
      batchArtifactId,
      "engineering-data.register-monitoring-batch",
      [sourceVersionRef],
    );
    const forgedBatchArtifact = await putSamples(batchArtifactId, batchArtifactAuth, [
      { second: 40, value: 80 },
    ]);
    const forgedContextSeriesRevision = await forgedAuthorization(
      "c14-forged-series-revision",
      "engineering-data.register-monitoring-batch",
      [sourceVersionRef],
    );
    const forgedContextPolicy = await forgedAuthorization(
      "c14-forged-policy",
      "engineering-data.register-monitoring-batch",
      [sourceVersionRef],
    );
    const forgedContextBatch = await forgedAuthorization(
      "c14-forged-batch",
      "engineering-data.register-monitoring-batch",
      [sourceVersionRef],
    );
    const forgedContextFreeze = await forgedAuthorization(
      "c14-forged-freeze",
      "engineering-data.monitoring-snapshot",
      [sourceVersionRef],
    );
    const forgedContextSnapshotRead = await forgedAuthorization(
      "c14-forged-snapshot-read",
      "engineering-data.monitoring-snapshot-query",
      [sourceVersionRef],
    );
    const forgedContextResolve = await forgedAuthorization(
      "c14-forged-resolve",
      "engineering-data.monitoring-snapshot-query",
      [sourceVersionRef],
    );
    const forgedContextSeriesRead = await forgedAuthorization(
      "c14-forged-series-read",
      "engineering-data.monitoring-snapshot-query",
    );
    const forgedCases: ReadonlyArray<{
      readonly label: string;
      readonly commandId: string;
      readonly run: () => Promise<{ kind: string }>;
    }> = [
      {
        label: "series-revision",
        commandId: "c14-forged-series-revision",
        run: () =>
          fixture.monitoringStore.reviseSeries({
            commandId: "c14-forged-series-revision",
            idempotencyKey: "c14-forged-series-revision",
            projectId,
            actorId: forgedActorId,
            issuedAt: now,
            authorization: forgedContextSeriesRevision,
            monitoringSeriesRef: {
              kind: "monitoring-series",
              reference: { entityId: "c14-forged-series", versionId: "1" },
            },
            expectedVersion: "none",
            projectRevisionRef,
            spatialScopeRef,
            monitoringObject: "settlement sensor",
            monitoringIndicator: "地表沉降",
            parameterCode: "forged",
            canonicalUnit: "mm",
            unitConversions: [{ fromUnit: "cm", scale: 10, offset: 0 }],
            effectivePeriod: { validFrom: now },
          }),
      },
      {
        label: "availability-policy",
        commandId: "c14-forged-policy",
        run: () =>
          fixture.monitoringStore.registerAvailabilityPolicy({
            commandId: "c14-forged-policy",
            idempotencyKey: "c14-forged-policy",
            projectId,
            actorId: forgedActorId,
            issuedAt: now,
            authorization: forgedContextPolicy,
            policy: {
              availabilityPolicyRef: { entityId: "c14-forged-policy", versionId: "1" },
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
              audit: { actorId: forgedActorId, action: "policy", recordedAt: now },
            },
          }),
      },
      {
        label: "monitoring-batch",
        commandId: "c14-forged-batch",
        run: () =>
          fixture.registry.apply({
            commandId: "c14-forged-batch",
            idempotencyKey: "c14-forged-batch",
            projectId,
            actorId: forgedActorId,
            issuedAt: now,
            authorization: forgedContextBatch,
            kind: "register-monitoring-batch",
            payload: {
              monitoringSeriesRef: seriesRef,
              deliveryKey: "c14-forged-batch",
              sampleArtifactRef: forgedBatchArtifact.artifactRef,
              window: { from: "2030-01-01T00:00:30.000Z", to: "2030-01-01T00:00:41.000Z" },
              relation: { kind: "original" },
            },
          }),
      },
      {
        label: "monitoring-freeze",
        commandId: "c14-forged-freeze",
        run: () =>
          fixture.registry.freeze({
            commandId: "c14-forged-freeze",
            idempotencyKey: "c14-forged-freeze",
            projectId,
            actorId: forgedActorId,
            issuedAt: now,
            authorization: forgedContextFreeze,
            kind: "monitoring-snapshot",
            payload: {
              monitoringSeriesRef: seriesRef,
              cutoff: "2030-01-01T00:00:10.000Z",
              availabilityPolicyRef: { entityId: "c14-policy", versionId: "1" },
            },
          }),
      },
      {
        label: "monitoring-snapshot-read",
        commandId: "c14-forged-snapshot-read",
        run: () =>
          fixture.registry.read({
            queryId: "c14-forged-snapshot-read",
            projectId,
            actorId: forgedActorId,
            requestedAt: now,
            authorization: forgedContextSnapshotRead,
            kind: "monitoring-snapshot",
            payload: { monitoringSnapshotRef: bindingSnapshotRef },
          }),
      },
      {
        label: "monitoring-snapshot-resolve",
        commandId: "c14-forged-resolve",
        run: () =>
          fixture.monitoringStore.resolveSnapshotQuery({
            queryResultRef,
            invocationId: "c14-forged-resolve",
            projectId,
            actorId: forgedActorId,
            requestedAt: now,
            authorization: forgedContextResolve,
          }),
      },
      {
        label: "series-revision-read",
        commandId: "c14-forged-series-read",
        run: () =>
          fixture.monitoringStore.readSeriesRevision({
            queryId: "c14-forged-series-read",
            projectId,
            actorId: forgedActorId,
            requestedAt: now,
            authorization: forgedContextSeriesRead,
            monitoringSeriesRef: seriesRef,
          }),
      },
    ];
    const factsBefore = await monitoringFacts();
    const forgedErrors: string[] = [];
    for (const forgedCase of forgedCases) {
      const result = await forgedCase.run();
      expect(result, forgedCase.label).toMatchObject({
        kind: "failed",
        error: {
          code: "AUTHORIZATION_DENIED",
          category: "authorization",
          retryable: false,
        },
      });
      forgedErrors.push(stableError(result));
    }
    expect(forgedErrors[0]).toContain("AUTHORIZATION_DENIED");
    expect(new Set(forgedErrors).size).toBe(1);
    for (const forgedCase of forgedCases) {
      expect(await commandEvidence(forgedCase.commandId), forgedCase.label).toEqual({
        receipts: 0,
        audits: 0,
        receipt_actor: null,
        audit_actor: null,
      });
    }
    expect(await forgedActorRows()).toEqual({ rows: 0 });
    expect(await monitoringFacts()).toEqual(factsBefore);

    // 合规主体的同类控制调用：主体、收据与审计只写 C06 已验证主体。
    const seriesControlId = "c14-binding-series-control";
    expect(
      await fixture.monitoringStore.reviseSeries({
        commandId: seriesControlId,
        idempotencyKey: seriesControlId,
        projectId,
        actorId: managerId,
        issuedAt: now,
        authorization: await authorization(
          seriesControlId,
          "engineering-data.register-monitoring-batch",
          [sourceVersionRef],
        ),
        monitoringSeriesRef: {
          kind: "monitoring-series",
          reference: { entityId: "c14-binding-series", versionId: "1" },
        },
        expectedVersion: "none",
        projectRevisionRef,
        spatialScopeRef,
        monitoringObject: "settlement sensor",
        monitoringIndicator: "地表沉降",
        parameterCode: "binding",
        canonicalUnit: "mm",
        unitConversions: [{ fromUnit: "cm", scale: 10, offset: 0 }],
        effectivePeriod: { validFrom: now },
      }),
    ).toMatchObject({ kind: "succeeded" });
    expect(
      (
        await fixture.postgres.adminPool.query<{ actor_id: string }>(
          "SELECT actor_id FROM business.monitoring_series_revisions WHERE series_id = 'c14-binding-series'",
        )
      ).rows,
    ).toEqual([{ actor_id: managerId }]);
    expect(await commandEvidence(seriesControlId)).toMatchObject({
      receipts: 1,
      audits: 1,
      receipt_actor: managerId,
      audit_actor: managerId,
    });

    const policyControlId = "c14-binding-policy-control";
    expect(
      await fixture.monitoringStore.registerAvailabilityPolicy({
        commandId: policyControlId,
        idempotencyKey: policyControlId,
        projectId,
        actorId: managerId,
        issuedAt: now,
        authorization: await authorization(
          policyControlId,
          "engineering-data.register-monitoring-batch",
          [sourceVersionRef],
        ),
        policy: {
          availabilityPolicyRef: { entityId: "c14-binding-policy", versionId: "1" },
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
      }),
    ).toMatchObject({ kind: "succeeded" });
    expect(
      (
        await fixture.postgres.adminPool.query<{ actor_id: string }>(
          "SELECT actor_id FROM business.monitoring_availability_policies WHERE policy_id = $1",
          ["c14-binding-policy:1"],
        )
      ).rows,
    ).toEqual([{ actor_id: managerId }]);
    expect(await commandEvidence(policyControlId)).toMatchObject({
      receipts: 1,
      audits: 1,
      receipt_actor: managerId,
      audit_actor: managerId,
    });

    const batchControlId = "c14-binding-batch-control";
    const batchControlAuth = await authorization(
      batchControlId,
      "engineering-data.register-monitoring-batch",
      [sourceVersionRef],
    );
    const batchControlArtifact = await putSamples(
      "c14-binding-batch-artifact-control",
      batchControlAuth,
      [{ second: 50, value: 100 }],
    );
    expect(
      await fixture.registry.apply({
        commandId: batchControlId,
        idempotencyKey: batchControlId,
        projectId,
        actorId: managerId,
        issuedAt: now,
        authorization: batchControlAuth,
        kind: "register-monitoring-batch",
        payload: {
          monitoringSeriesRef: seriesRef,
          deliveryKey: "c14-binding-batch",
          sampleArtifactRef: batchControlArtifact.artifactRef,
          window: { from: "2030-01-01T00:00:40.000Z", to: "2030-01-01T00:00:51.000Z" },
          relation: { kind: "original" },
        },
      }),
    ).toMatchObject({ kind: "succeeded", result: { kind: "register-monitoring-batch" } });
    expect(
      (
        await fixture.postgres.adminPool.query<{ actor_id: string }>(
          "SELECT actor_id FROM business.monitoring_batches WHERE delivery_key = 'c14-binding-batch'",
        )
      ).rows,
    ).toEqual([{ actor_id: managerId }]);
    expect(await commandEvidence(batchControlId)).toMatchObject({
      receipts: 1,
      audits: 1,
      receipt_actor: managerId,
      audit_actor: managerId,
    });
    expect(await commandEvidence(freezeControlId)).toMatchObject({
      receipts: 1,
      audits: 1,
      receipt_actor: managerId,
      audit_actor: managerId,
    });

    const snapshotReadControlId = "c14-binding-snapshot-read-control";
    expect(
      await fixture.registry.read({
        queryId: snapshotReadControlId,
        projectId,
        actorId: managerId,
        requestedAt: now,
        authorization: await authorization(
          snapshotReadControlId,
          "engineering-data.monitoring-snapshot-query",
          [sourceVersionRef],
        ),
        kind: "monitoring-snapshot",
        payload: { monitoringSnapshotRef: bindingSnapshotRef },
      }),
    ).toMatchObject({ kind: "succeeded" });
    expect(
      (
        await fixture.postgres.adminPool.query<{ requested_by: string }>(
          "SELECT requested_by FROM business.monitoring_snapshot_query_results WHERE query_result_id = $1",
          [`monitoring-${snapshotReadControlId}`],
        )
      ).rows,
    ).toEqual([{ requested_by: managerId }]);
    expect(await commandEvidence(snapshotReadControlId)).toMatchObject({
      receipts: 1,
      audits: 1,
      receipt_actor: managerId,
      audit_actor: managerId,
    });

    const resolveControlId = "c14-binding-resolve-control";
    const resolvedControl = await fixture.monitoringStore.resolveSnapshotQuery({
      queryResultRef,
      invocationId: resolveControlId,
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: await authorization(
        resolveControlId,
        "engineering-data.monitoring-snapshot-query",
        [sourceVersionRef],
      ),
    });
    expect(resolvedControl).toMatchObject({
      kind: "succeeded",
      result: {
        kind: "snapshot-query",
        query: { requestedBy: managerId, audit: { actorId: managerId } },
      },
    });

    const seriesReadControlId = "c14-binding-series-read-control";
    expect(
      await fixture.monitoringStore.readSeriesRevision({
        queryId: seriesReadControlId,
        projectId,
        actorId: managerId,
        requestedAt: now,
        authorization: await authorization(
          seriesReadControlId,
          "engineering-data.monitoring-snapshot-query",
        ),
        monitoringSeriesRef: seriesRef,
      }),
    ).toMatchObject({ kind: "succeeded", result: { monitoringSeriesRef: seriesRef } });
    expect(await commandEvidence(seriesReadControlId)).toMatchObject({
      receipts: 0,
      audits: 1,
      receipt_actor: null,
      audit_actor: managerId,
    });
    const forgedReplayAuthorization = await forgedAuthorization(
      seriesReadControlId,
      "engineering-data.monitoring-snapshot-query",
    );
    expect(
      await fixture.monitoringStore.readSeriesRevision({
        queryId: seriesReadControlId,
        projectId,
        actorId: forgedActorId,
        requestedAt: now,
        authorization: forgedReplayAuthorization,
        monitoringSeriesRef: seriesRef,
      }),
    ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    expect(await commandEvidence(seriesReadControlId)).toMatchObject({
      receipts: 0,
      audits: 1,
      receipt_actor: null,
      audit_actor: managerId,
    });
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

  it("reports current and superseded status for exact revisions without changing series facts", async () => {
    const readRevision = async (
      queryId: string,
      versionId: string,
      authorizationContext: AuthorizationContextV1,
    ) =>
      fixture.monitoringStore.readSeriesRevision({
        queryId,
        projectId,
        actorId: managerId,
        requestedAt: now,
        authorization: authorizationContext,
        monitoringSeriesRef: {
          kind: "monitoring-series",
          reference: { entityId: "c14-series", versionId },
        },
      });
    const supersededAuthorization = await authorization(
      "c14-read-v1-superseded",
      "engineering-data.monitoring-snapshot-query",
    );
    const currentAuthorization = await authorization(
      "c14-read-v2-current",
      "engineering-data.monitoring-snapshot-query",
    );
    const factsBefore = await fixture.postgres.adminPool.query<{
      revisions: number;
      series: number;
    }>(
      `SELECT (SELECT count(*)::int FROM business.monitoring_series_revisions) AS revisions,
              (SELECT count(*)::int FROM business.monitoring_series) AS series`,
    );
    expect(
      await readRevision("c14-read-v1-superseded", "1", supersededAuthorization),
    ).toMatchObject({
      kind: "succeeded",
      result: {
        parameterCode: "settlement",
        status: "superseded",
        effectivePeriod: { validFrom: now },
      },
    });
    expect(await readRevision("c14-read-v2-current", "2", currentAuthorization)).toEqual({
      kind: "succeeded",
      result: {
        monitoringSeriesRef: {
          kind: "monitoring-series",
          reference: { entityId: "c14-series", versionId: "2" },
        },
        seriesId: "c14-series",
        projectId,
        projectRevisionRef,
        spatialScopeRef,
        monitoringObject: "settlement sensor",
        monitoringIndicator: "地表沉降",
        parameterCode: "settlement-v2",
        canonicalUnit: "mm",
        unitConversions: [{ fromUnit: "cm", scale: 10, offset: 0 }],
        effectivePeriod: { validFrom: now },
        recordedAt: now,
        previousRevisionRef: {
          kind: "monitoring-series",
          reference: { entityId: "c14-series", versionId: "1" },
        },
        status: "current",
      },
    });
    expect(
      await readRevision("c14-read-v1-superseded", "1", supersededAuthorization),
    ).toMatchObject({
      kind: "succeeded",
      result: { status: "superseded" },
    });
    expect(
      await readRevision("c14-read-v1-superseded", "2", supersededAuthorization),
    ).toMatchObject({ kind: "succeeded", result: { status: "current" } });
    const factsAfter = await fixture.postgres.adminPool.query<{
      revisions: number;
      series: number;
    }>(
      `SELECT (SELECT count(*)::int FROM business.monitoring_series_revisions) AS revisions,
              (SELECT count(*)::int FROM business.monitoring_series) AS series`,
    );
    expect(factsAfter.rows).toEqual(factsBefore.rows);
  });

  it("keeps background reads after password change and rejects a disabled account", async () => {
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
    expect(resolved).toMatchObject({ kind: "succeeded" });
    const reread = await fixture.monitoringStore.readSeriesRevision({
      queryId: "c14-series-read",
      projectId,
      actorId: managerId,
      requestedAt: now,
      authorization: seriesReadAuthorization,
      monitoringSeriesRef: {
        kind: "monitoring-series",
        reference: { entityId: "c14-series", versionId: "1" },
      },
    });
    expect(reread).toMatchObject({ kind: "succeeded" });
    await fixture.postgres.adminPool.query(
      "UPDATE business.local_accounts SET status = 'disabled' WHERE account_id = $1",
      [managerId],
    );
    try {
      const denied = await fixture.monitoringStore.resolveSnapshotQuery({
        queryResultRef,
        invocationId: "c14-query",
        projectId,
        actorId: managerId,
        requestedAt: now,
        authorization: queryAuthorization,
      });
      expect(denied).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    } finally {
      await fixture.postgres.adminPool.query(
        "UPDATE business.local_accounts SET status = 'active' WHERE account_id = $1",
        [managerId],
      );
    }
  });

  it("lists the exact series batches and snapshots without scanning the catalog", async () => {
    const seriesRef = {
      kind: "monitoring-series" as const,
      reference: { entityId: "c14-series", versionId: "1" },
    };
    const batches = await fixture.monitoringStore.listBatchesBySeries({
      projectId,
      monitoringSeriesRef: seriesRef,
      limit: 50,
    });
    expect(batches.length).toBeGreaterThan(0);
    expect(batches[0]).toMatchObject({ relation: "original" });
    const snapshots = await fixture.monitoringStore.listSnapshotsBySeries({
      projectId,
      monitoringSeriesRef: seriesRef,
      limit: 50,
    });
    expect(snapshots.length).toBeGreaterThan(0);
    const registered = await fixture.postgres.adminPool.query<{ snapshot_id: string }>(
      "SELECT snapshot_id FROM business.monitoring_snapshots WHERE project_id = $1 AND series_id = $2 ORDER BY cutoff DESC LIMIT 1",
      [projectId, "c14-series"],
    );
    expect(snapshots[0]?.monitoringSnapshotRef.reference.entityId).toBe(
      registered.rows[0]?.snapshot_id,
    );
    expect(["available", "partial", "unavailable"]).toContain(snapshots[0]?.availability);
    const scopeRef = await fixture.monitoringStore.readSeriesScopeRef({
      projectId,
      monitoringSeriesRef: seriesRef,
    });
    expect(scopeRef).toEqual(spatialScopeRef);
    const catalogItem = await fixture.monitoringStore.readCurrentSeriesCatalogItem({
      projectId,
      seriesId: "c14-series",
    });
    expect(catalogItem?.monitoringSeriesRef.reference.entityId).toBe("c14-series");
    expect(catalogItem?.monitoringObject).toBe("settlement sensor");
    expect(catalogItem?.spatialScopeRef.reference.entityId).toBe(
      spatialScopeRef.reference.entityId,
    );
    expect(catalogItem?.batchCount).toBeGreaterThan(0);
    const missing = await fixture.monitoringStore.readCurrentSeriesCatalogItem({
      projectId,
      seriesId: "c14-missing-series",
    });
    expect(missing).toBeUndefined();
  });
});
