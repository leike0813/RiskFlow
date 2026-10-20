import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DataCleaningPolicyV2Schema } from "@riskflow/core/engineering-data/cleaning";
import { ACCESS_POLICY_REF_V1 } from "@riskflow/core/access";
import { StructuredDocumentJsonLdV1Schema } from "@riskflow/core/engineering-data/document-conversion";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import { PostgresDataCleaningStore } from "../../../src/engineering-data/cleaning/postgres-data-cleaning-store.js";
import {
  AgentTaskEnvelopeV1Schema,
  type AgentTaskClaimV1,
  type AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import type { TransactionUnitV1 } from "@riskflow/core/persistence";
import { StartAgentTaskCommandV1Schema } from "@riskflow/contracts/ports";
import type {
  AgentTaskRefV1,
  AuthorizationContextV1,
  ContentArtifactRefV1,
  EngineeringFreezeCommandV1,
  IdentificationPreparationSnapshotRefV1,
  SourceVersionRefV1,
  VersionReference,
} from "@riskflow/contracts/ports";
import {
  IdentificationPreparationSnapshotV1Schema,
  type IdentificationPreparationSnapshotV1,
} from "@riskflow/contracts/workflows";

import {
  CLEANING_CONVERSION_POLICY_REF,
  CLEANING_CONVERTER_DEPLOYMENT_REF,
  CLEANING_QUALITY_POLICY_REF,
  cleaningTimestamp,
  completeCleaningTask,
  freezeIdentificationPreparation,
  startDataCleaningFixture,
  type CleaningPipelineV1,
  type CleaningPolicyOverridesV1,
  type CleaningWorldOptionsV1,
  type CleaningWorldV1,
  type DataCleaningPostgresFixture,
} from "./fixture.js";

const MANIFEST_PURPOSE = "engineering-data.data-cleaning-preparation-manifest";
const CONVERSION_PURPOSE = "engineering-data.structured-document-conversion";
const DECISION_PURPOSE = "engineering-data.data-cleaning-decision";
const OBSERVATION_PURPOSE = "engineering-data.data-cleaning-observation";
const RESULT_PURPOSE = "engineering-data.data-cleaning-result";
const PREPARATION_COMMAND_KIND = "engineering-data.identification-preparation.v1";
const PREPARATION_ACTION = "engineering-data.identification-preparation";
const PREPARATION_POLICY_REF: VersionReference = {
  entityId: "c15-data-processing-policy",
  versionId: "1",
};
const DOCUMENT_KIND_ORDER = ["docx", "text-pdf", "xlsx", "csv", "ocr-layout"] as const;

interface ProjectCountsV1 {
  readonly tasks: string;
  readonly snapshots: string;
  readonly results: string;
  readonly events: string;
  readonly preparationReceipts: string;
  readonly preparationAudits: string;
}

interface ManifestDocumentViewV1 {
  readonly inputKind: string;
  readonly sourceVersionRef: SourceVersionRefV1;
  readonly conversionRef: { readonly reference: VersionReference };
  readonly jsonLdArtifactRef: {
    readonly kind: "content-artifact";
    readonly reference: VersionReference;
  };
  readonly sourceSegmentSetRef: { readonly reference: VersionReference };
}

interface CleaningManifestViewV1 {
  readonly documents: readonly ManifestDocumentViewV1[];
  readonly monitoring?: {
    readonly monitoringSnapshotRef: {
      readonly kind: "monitoring-snapshot";
      readonly reference: VersionReference;
    };
    readonly availability: string;
  };
  readonly dataProcessingPolicyRef: VersionReference;
}

interface DocumentObservationViewV1 {
  readonly sourceVersionRef: SourceVersionRefV1;
  readonly inputKind: string;
  readonly segments: readonly {
    readonly sourceSegmentId: string;
    readonly kind: string;
    readonly locator: unknown;
    readonly numericProtection: string;
    readonly textBlocks: readonly { readonly blockId: string; readonly text: string }[];
  }[];
}

interface MonitoringObservationViewV1 {
  readonly monitoringSnapshotRef: { readonly reference: VersionReference };
  readonly availability: string;
  readonly coverageRatio: number;
  readonly members: readonly {
    readonly memberIndex: number;
    readonly sampleVersionRef: { readonly reference: VersionReference };
  }[];
  readonly points: readonly { readonly sampledAt: string; readonly status: string }[];
  readonly samples: readonly {
    readonly sampleVersionRef: { readonly reference: VersionReference };
    readonly sourceSampleKey: string;
    readonly sampledAt: string;
    readonly value: number;
    readonly unit: string;
    readonly canonicalValue: number;
    readonly canonicalUnit: string;
    readonly relationKind: string;
    readonly evidenceReferences: readonly unknown[];
    readonly sourceVersionRef: SourceVersionRefV1;
    readonly sourceSegmentSetRef: { readonly reference: VersionReference };
  }[];
}

interface PreparationCatalogObservationViewV1 {
  readonly manifestArtifactRef: {
    readonly kind: "content-artifact";
    readonly reference: VersionReference;
  };
  readonly sourceVersionRef: SourceVersionRefV1;
  readonly offset: number;
  readonly totalCount: number;
  readonly segments: readonly { readonly sourceSegmentId: string; readonly kind: string }[];
  readonly nextOffset?: number;
}

interface CleaningResultViewV1 {
  readonly overallAvailability: string;
  readonly overallCoverageRatio: number;
  readonly inputs: readonly { readonly inputKind: string; readonly availability: string }[];
}

type FreezeCommandV1 = Extract<EngineeringFreezeCommandV1, { kind: "identification-preparation" }>;

describe("C15 PostgreSQL data cleaning store", () => {
  let fixture: DataCleaningPostgresFixture;
  let main: CleaningWorldV1;
  let firstFrozen: { readonly command: FreezeCommandV1 } | undefined;
  let mainClaim: AgentTaskClaimV1 | undefined;
  let tail: CleaningWorldV1 | undefined;
  let readWorld: CleaningWorldV1 | undefined;
  let readTaskRef: AgentTaskRefV1 | undefined;
  let tailTaskRef: { readonly reference: VersionReference } | undefined;
  let tailSnapshotRef: { readonly reference: VersionReference } | undefined;

  beforeAll(async () => {
    fixture = await startDataCleaningFixture();
    main = await fixture.createWorld({ suffix: "main" });
  }, 240_000);

  afterAll(async () => {
    await fixture?.close();
  }, 60_000);

  afterEach(() => vi.restoreAllMocks());

  const projectCounts = async (projectId: string): Promise<ProjectCountsV1> => {
    const result = await fixture.postgres.adminPool.query<ProjectCountsV1>(
      `SELECT
         (SELECT count(*)::text FROM business.agent_tasks WHERE project_id = $1) AS tasks,
         (SELECT count(*)::text FROM business.identification_preparation_snapshots WHERE project_id = $1) AS snapshots,
         (SELECT count(*)::text FROM business.data_cleaning_results WHERE project_id = $1) AS results,
         (SELECT count(*)::text FROM outbox.events WHERE project_id = $1 AND event_type = 'engineering.inputs-ready.v1') AS events,
         (SELECT count(*)::text FROM business.command_receipts WHERE project_id = $1 AND command_kind = $2) AS "preparationReceipts",
         (SELECT count(*)::text FROM audit.entries WHERE project_id = $1 AND action = $3) AS "preparationAudits"`,
      [projectId, PREPARATION_COMMAND_KIND, PREPARATION_ACTION],
    );
    return result.rows[0]!;
  };

  const frozenInputRefOf = (index: number) => {
    const request = fixture.recordedStartCommands[index];
    if (request === undefined) throw new Error(`start request ${index} was not recorded`);
    return request.command.payload.frozenInputRef as {
      readonly kind: "content-artifact";
      readonly reference: VersionReference;
    };
  };

  const readManifest = async (
    index: number,
    authorization: AuthorizationContextV1,
  ): Promise<CleaningManifestViewV1 | undefined> =>
    (await fixture.readArtifact(frozenInputRefOf(index), authorization, MANIFEST_PURPOSE)) as
      CleaningManifestViewV1 | undefined;

  /** Reads the preparation manifest the C08 task was bound to, independent of replay counts. */
  const readManifestOfTask = async (
    projectId: string,
    taskRef: { readonly reference: VersionReference },
    authorization: AuthorizationContextV1,
  ): Promise<CleaningManifestViewV1 | undefined> => {
    const rows = await fixture.postgres.adminPool.query<{
      frozen_input_ref: { readonly kind: "content-artifact"; readonly reference: VersionReference };
    }>(
      "SELECT frozen_input_ref FROM business.agent_tasks WHERE project_id = $1 AND agent_task_id = $2",
      [projectId, taskRef.reference.entityId],
    );
    const manifestRef = rows.rows[0]?.frozen_input_ref;
    if (manifestRef === undefined) throw new Error("the task has no frozen input manifest");
    return (await fixture.readArtifact(manifestRef, authorization, MANIFEST_PURPOSE)) as
      CleaningManifestViewV1 | undefined;
  };

  const taskRefOfFailure = (result: unknown): { readonly reference: VersionReference } => {
    const error = (result as { error?: { blockerRef?: { reference: VersionReference } } }).error;
    if (error?.blockerRef === undefined) throw new Error("the freeze did not report a blocker ref");
    return error.blockerRef;
  };

  const resultRowsOf = async (projectId: string) =>
    (
      await fixture.postgres.adminPool.query<{
        result_id: string;
        result_artifact_ref: { readonly reference: VersionReference };
        overall_availability: string;
      }>(
        "SELECT result_id, result_artifact_ref, overall_availability FROM business.data_cleaning_results WHERE project_id = $1 ORDER BY result_id",
        [projectId],
      )
    ).rows;

  const observationArtifactCount = async (projectId: string): Promise<number> => {
    const rows = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.artifact_manifests WHERE project_id = $1 AND purpose_code = $2",
      [projectId, OBSERVATION_PURPOSE],
    );
    return Number(rows.rows[0]?.count);
  };

  const requireTaskSnapshot = async (
    pipeline: CleaningPipelineV1,
    taskRef: { readonly reference: VersionReference },
  ): Promise<AgentTaskSnapshotV1> => {
    const task = await pipeline.agentTaskAdapter.getTask(taskRef as never);
    if (task === undefined) throw new Error("the C08 task disappeared");
    return task;
  };

  it("resolves four conversions plus an OCR input into one ordered manifest", async () => {
    const frozen = await freezeIdentificationPreparation(main.pipeline.store, main, {
      commandId: "c15-main-freeze-1",
    });
    firstFrozen = frozen;
    expect(frozen.result).toMatchObject({
      kind: "failed",
      error: {
        code: "BUSINESS_BLOCKED",
        category: "business-blocked",
        retryable: false,
        blockerKind: "data-cleaning-task-incomplete",
      },
    });
    if (frozen.result.kind !== "failed") return;
    expect(frozen.result.error.blockerRef).toMatchObject({ kind: "agent-task" });

    const manifest = await readManifest(0, frozen.command.authorization);
    expect(manifest).toBeDefined();
    if (manifest === undefined) return;
    expect(manifest.dataProcessingPolicyRef).toEqual(PREPARATION_POLICY_REF);
    expect(manifest.documents.map((document) => document.sourceVersionRef)).toEqual([
      ...frozen.command.payload.sourceVersionRefs,
    ]);
    expect(manifest.documents.map((document) => document.inputKind)).toEqual([
      ...DOCUMENT_KIND_ORDER,
    ]);
    const conversionIds = manifest.documents.map(
      (document) => document.conversionRef.reference.entityId,
    );
    const segmentSetIds = manifest.documents.map(
      (document) => document.sourceSegmentSetRef.reference.entityId,
    );
    expect(segmentSetIds).toHaveLength(frozen.command.payload.sourceVersionRefs.length);
    expect(new Set(conversionIds).size).toBe(conversionIds.length);
    expect(new Set(segmentSetIds).size).toBe(segmentSetIds.length);

    const snapshot = await fixture.postgres.adminPool.query<{ availability: string }>(
      `SELECT availability FROM business.monitoring_snapshots
        WHERE project_id = $1 AND snapshot_id = $2`,
      [main.projectId, manifest.monitoring?.monitoringSnapshotRef.reference.entityId],
    );
    expect(snapshot.rows).toHaveLength(1);
    expect(manifest.monitoring?.availability).toBe(snapshot.rows[0]?.availability);

    const converted = await fixture.postgres.adminPool.query<{
      conversion_id: string;
      input_kind: string;
      status: string;
    }>(
      `SELECT conversion_id, input_kind, status FROM business.structured_document_conversions
        WHERE project_id = $1 ORDER BY conversion_id`,
      [main.projectId],
    );
    expect([...converted.rows.map((row) => row.input_kind)].sort()).toEqual(
      [...DOCUMENT_KIND_ORDER].sort(),
    );
    expect(converted.rows.every((row) => row.status === "succeeded")).toBe(true);
    expect([...converted.rows.map((row) => row.conversion_id)].sort()).toEqual(
      [...conversionIds].sort(),
    );

    const ocr = manifest.documents[4]!;
    const segments = await fixture.postgres.adminPool.query<{ count: string; kinds: string[] }>(
      `SELECT count(*)::text AS count, array_agg(DISTINCT kind) AS kinds
         FROM business.source_segments WHERE project_id = $1 AND source_segment_set_id = $2`,
      [main.projectId, ocr.sourceSegmentSetRef.reference.entityId],
    );
    expect(Number(segments.rows[0]?.count)).toBeGreaterThan(0);
    expect(segments.rows[0]?.kinds).toContain("table");
    const artifacts = await fixture.postgres.adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM business.artifact_manifests
        WHERE project_id = $1 AND purpose_code = $2 AND media_type = 'application/ld+json'`,
      [main.projectId, CONVERSION_PURPOSE],
    );
    expect(artifacts.rows[0]?.count).toBe("5");
  }, 120_000);

  it("V2按输入类型使用已登记转换，不再维护逐版本允许清单", async () => {
    const world = await fixture.createWorld({
      suffix: "typed-policy",
      documentKinds: ["csv"],
      monitoring: false,
    });
    const raw: Record<string, unknown> = {
      ...world.policy(),
      schemaVersion: "2",
      documentRules: [{ inputKind: "csv", requiredSegmentKinds: ["table"] }],
    };
    for (const key of [
      "allowedConversionPolicyRefs",
      "allowedQualityPolicyRefs",
      "allowedConverterDeploymentRefs",
      "requiredSegmentKinds",
      "minimumRetainedSegmentRatio",
    ])
      delete raw[key];
    const pipeline = fixture.createPipeline({ policy: DataCleaningPolicyV2Schema.parse(raw) });
    const prepared = await freezeIdentificationPreparation(pipeline.store, world, {
      commandId: "c15-typed-policy",
    });
    expect(prepared.result).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "data-cleaning-task-incomplete" },
    });
  }, 120_000);

  it("creates exactly one C08 task and no snapshot, result or outbox event on the first freeze", async () => {
    expect(await projectCounts(main.projectId)).toEqual({
      tasks: "1",
      snapshots: "0",
      results: "0",
      events: "0",
      preparationReceipts: "0",
      preparationAudits: "0",
    });
    const tasks = await fixture.postgres.adminPool.query<{
      status: string;
      frozen_input_ref: unknown;
    }>("SELECT status, frozen_input_ref FROM business.agent_tasks WHERE project_id = $1", [
      main.projectId,
    ]);
    expect(tasks.rows).toHaveLength(1);
    expect(tasks.rows[0]?.frozen_input_ref).toEqual(frozenInputRefOf(0));
  }, 120_000);

  it("keeps a blocked freeze pinned to the running task without new side effects", async () => {
    mainClaim = await main.pipeline.agentTaskAdapter.claim({
      workerId: "c15-main-worker",
      leaseDurationMs: 600_000,
      now: cleaningTimestamp(60),
    });
    expect(mainClaim?.task.state.status).toBe("running");
    const blocked = await freezeIdentificationPreparation(main.pipeline.store, main, {
      commandId: "c15-main-freeze-1",
    });
    const replay = await freezeIdentificationPreparation(main.pipeline.store, main, {
      commandId: "c15-main-freeze-1",
    });
    expect(blocked.result).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "data-cleaning-task-incomplete" },
    });
    expect(replay.result).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "data-cleaning-task-incomplete" },
    });
    if (blocked.result.kind !== "failed" || replay.result.kind !== "failed") return;
    expect(replay.result.error.blockerRef).toEqual(blocked.result.error.blockerRef);
    expect(replay.result.error.blockerRef).toEqual(mainClaim?.task.envelope.agentTaskRef);
    expect(await projectCounts(main.projectId)).toEqual({
      tasks: "1",
      snapshots: "0",
      results: "0",
      events: "0",
      preparationReceipts: "0",
      preparationAudits: "0",
    });
  }, 120_000);

  it("produces a second task for a changed input set and leaves the first manifest untouched", async () => {
    if (firstFrozen === undefined) throw new Error("the first freeze was not recorded");
    const firstTaskRef = taskRefOfFailure(firstFrozen.result);
    const firstManifest = await readManifestOfTask(
      main.projectId,
      firstTaskRef,
      firstFrozen.command.authorization,
    );
    const subset = await freezeIdentificationPreparation(main.pipeline.store, main, {
      commandId: "c15-main-freeze-2",
      sourceVersionRefs: main.documents.slice(0, 4).map((document) => document.sourceVersionRef),
    });
    expect(subset.result).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    const subsetTaskRef = taskRefOfFailure(subset.result);
    expect(subsetTaskRef).not.toEqual(firstTaskRef);
    const subsetManifest = await readManifestOfTask(
      main.projectId,
      subsetTaskRef,
      subset.command.authorization,
    );
    expect(subsetManifest?.documents.map((document) => document.sourceVersionRef)).toEqual([
      ...subset.command.payload.sourceVersionRefs,
    ]);
    expect(subsetManifest?.documents).toHaveLength(4);
    expect(
      await readManifestOfTask(main.projectId, firstTaskRef, subset.command.authorization),
    ).toEqual(firstManifest);
    expect((await projectCounts(main.projectId)).tasks).toBe("2");
    expect((await projectCounts(main.projectId)).snapshots).toBe("0");
  }, 120_000);

  it("produces a new task when the data processing policy ref changes", async () => {
    const policyRef: VersionReference = { entityId: "c15-data-processing-policy", versionId: "2" };
    const pipeline = fixture.createPipeline({ policy: main.policy({ policyRef }) });
    const changed = await freezeIdentificationPreparation(pipeline.store, main, {
      commandId: "c15-main-freeze-3",
      policyRef,
    });
    expect(changed.result).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    const manifest = await readManifestOfTask(
      main.projectId,
      taskRefOfFailure(changed.result),
      changed.command.authorization,
    );
    expect(manifest?.dataProcessingPolicyRef).toEqual(policyRef);
    expect((await projectCounts(main.projectId)).tasks).toBe("3");
    expect((await projectCounts(main.projectId)).snapshots).toBe("0");
  }, 120_000);

  interface RejectionCaseV1 {
    readonly name: string;
    readonly world: CleaningWorldOptionsV1;
    readonly policy?: (world: CleaningWorldV1) => CleaningPipelineV1["policy"];
    readonly freeze?: {
      readonly policyRef?: VersionReference;
      readonly monitoringCutoff?: undefined;
    };
    readonly expected: { readonly code: string; readonly blockerKind?: string };
  }

  const rejectionCases: RejectionCaseV1[] = [
    {
      name: "a source version whose conversion was never recorded",
      world: { suffix: "reject-missing", documentKinds: ["csv", "docx"], unconverted: ["docx"] },
      expected: { code: "BUSINESS_BLOCKED", blockerKind: "document-conversion-missing" },
    },
    {
      name: "a C15 policy that allows a different conversion policy ref",
      world: { suffix: "reject-policy-refs", documentKinds: ["csv"] },
      policy: (world) =>
        world.policy({
          allowedConversionPolicyRefs: [
            { entityId: "c15-other-conversion-policy", versionId: "1" },
          ],
        }),
      expected: { code: "BUSINESS_BLOCKED", blockerKind: "document-conversion-missing" },
    },
    {
      name: "a command that names another data processing policy",
      world: { suffix: "reject-command-policy", documentKinds: ["csv"] },
      freeze: { policyRef: { entityId: "c15-other-data-processing-policy", versionId: "1" } },
      expected: { code: "UNSUPPORTED_CONTRACT" },
    },
    {
      name: "a monitoring cutoff the command never carries",
      world: { suffix: "reject-cutoff", documentKinds: ["csv"] },
      freeze: { monitoringCutoff: undefined },
      expected: { code: "BUSINESS_BLOCKED", blockerKind: "monitoring-cutoff-missing" },
    },
    {
      name: "a monitoring availability policy version that does not exist",
      world: { suffix: "reject-monitoring-version", documentKinds: ["csv"] },
      policy: (world) =>
        world.policy({
          monitoring: {
            monitoringSeriesRef: world.monitoring!.seriesRef,
            availabilityPolicyRef: { entityId: "c15-monitoring-availability", versionId: "99" },
          },
        }),
      expected: { code: "AUTHORIZATION_DENIED" },
    },
  ];

  it.each(rejectionCases)(
    "blocks without side effects for $name",
    async (testCase) => {
      const world = await fixture.createWorld(testCase.world);
      const pipeline =
        testCase.policy === undefined
          ? world.pipeline
          : fixture.createPipeline({ policy: testCase.policy(world) });
      const attempt = await freezeIdentificationPreparation(pipeline.store, world, {
        commandId: `c15-${testCase.world.suffix}`,
        ...testCase.freeze,
      });
      expect(attempt.result).toMatchObject({
        kind: "failed",
        error: { code: testCase.expected.code },
      });
      if (attempt.result.kind !== "failed") return;
      if (testCase.expected.blockerKind !== undefined) {
        expect(attempt.result.error.blockerKind).toBe(testCase.expected.blockerKind);
      }
      expect(await projectCounts(world.projectId)).toEqual({
        tasks: "0",
        snapshots: "0",
        results: "0",
        events: "0",
        preparationReceipts: "0",
        preparationAudits: "0",
      });
    },
    120_000,
  );

  it("blocks without side effects when two allowed conversions share one source version", async () => {
    const world = await fixture.createWorld({ suffix: "reject-ambiguous", documentKinds: ["csv"] });
    await fixture.duplicateConversionRow(
      world.projectId,
      world.documents[0]!.conversionRef.reference.entityId,
      "c15-conversion-ambiguous-duplicate",
    );
    const attempt = await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: "c15-reject-ambiguous",
    });
    expect(attempt.result).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "document-conversion-ambiguous" },
    });
    expect(await projectCounts(world.projectId)).toEqual({
      tasks: "0",
      snapshots: "0",
      results: "0",
      events: "0",
      preparationReceipts: "0",
      preparationAudits: "0",
    });
  }, 120_000);

  it("denies a revoked authorization without enumerating requester state and commits nothing", async () => {
    const world = await fixture.createWorld({ suffix: "revoked", documentKinds: ["csv"] });
    const command = await world.freezeCommand("c15-revoked-freeze");
    const suspended = await fixture.postgres.adminPool.query<{ access_version: number }>(
      "SELECT access_version FROM business.access_projects WHERE project_id = $1",
      [world.projectId],
    );
    await fixture.access.administerProject({
      kind: "suspend-project",
      projectId: world.projectId,
      commandId: "c15-suspend",
      idempotencyKey: "c15-suspend",
      expectedVersion: {
        entityId: world.projectId,
        versionId: String(suspended.rows[0]!.access_version),
      },
      authorizationContextRef: fixture.administrationContextRef,
    });
    const denied = await world.pipeline.store.freezeIdentificationPreparation(command);
    expect(denied).toMatchObject({
      kind: "failed",
      error: {
        code: "AUTHORIZATION_DENIED",
        category: "authorization",
        retryable: false,
        requiredCapability: "engineering-data.freeze",
        authorizationPolicyRef: ACCESS_POLICY_REF_V1,
      },
    });
    if (denied.kind !== "failed") return;
    expect(Object.keys(denied.error).sort()).toEqual(
      [
        "authorizationPolicyRef",
        "causalRunId",
        "category",
        "code",
        "occurredAt",
        "requiredCapability",
        "retryable",
        "stageCode",
      ].sort(),
    );
    expect(JSON.stringify(denied.error)).not.toContain(world.projectId);
    expect(JSON.stringify(denied.error)).not.toContain(world.uploaderId);
    expect(JSON.stringify(denied.error)).not.toContain(world.freezerId);
    expect(await projectCounts(world.projectId)).toEqual({
      tasks: "0",
      snapshots: "0",
      results: "0",
      events: "0",
      preparationReceipts: "0",
      preparationAudits: "0",
    });
  }, 120_000);

  it("commits one preparation snapshot, receipt, audit entry and inputs-ready event after the task tail", async () => {
    const world = await fixture.createWorld({ suffix: "tail" });
    tail = world;
    const firstFreeze = await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: "c15-tail-freeze",
      actor: "uploader",
    });
    expect(firstFreeze.result).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "data-cleaning-task-incomplete" },
    });
    const completion = await completeCleaningTask(world.pipeline, fixture, {
      workerId: "c15-tail-worker",
      projectId: world.projectId,
    });
    tailTaskRef = completion.taskRef;
    const task = await requireTaskSnapshot(world.pipeline, completion.taskRef);
    expect(task.state.status).toBe("completed");
    expect(completion.resultRef).toMatchObject({
      kind: "agent-task-result",
      status: "completed",
      agentTaskRef: { taskType: "data-cleaning" },
    });

    const committed = await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: "c15-tail-freeze",
      actor: "uploader",
    });
    expect(committed.result).toMatchObject({
      kind: "succeeded",
      result: {
        kind: "identification-preparation",
        identificationPreparationSnapshotRef: {
          kind: "identification-preparation-snapshot",
        },
      },
    });
    if (
      committed.result.kind !== "succeeded" ||
      committed.result.result.kind !== "identification-preparation"
    )
      return;
    const snapshotRef = committed.result.result.identificationPreparationSnapshotRef;
    tailSnapshotRef = snapshotRef;

    expect(await projectCounts(world.projectId)).toEqual({
      tasks: "1",
      snapshots: "1",
      results: "1",
      events: "1",
      preparationReceipts: "1",
      preparationAudits: "1",
    });

    const snapshotRows = await fixture.postgres.adminPool.query<{
      snapshot_ref: unknown;
      snapshot_payload: unknown;
      audit_entry_id: string;
      cleaning_result_artifact_ref: unknown;
    }>(
      "SELECT snapshot_ref, snapshot_payload, audit_entry_id, cleaning_result_artifact_ref FROM business.identification_preparation_snapshots WHERE project_id = $1",
      [world.projectId],
    );
    expect(snapshotRows.rows).toHaveLength(1);
    expect(snapshotRows.rows[0]?.snapshot_ref).toEqual(snapshotRef);
    // 入库 payload 必须能被公共 strict Schema 直接解析：旧写入的 content-artifact 决定会在这里失败。
    const snapshotPayload: IdentificationPreparationSnapshotV1 =
      IdentificationPreparationSnapshotV1Schema.parse(snapshotRows.rows[0]!.snapshot_payload);
    expect(snapshotPayload.sourceVersionRefs).toEqual([
      ...firstFreeze.command.payload.sourceVersionRefs,
    ]);
    expect(snapshotPayload.includedSourceSegmentSetRefs).toHaveLength(
      snapshotPayload.sourceVersionRefs.length,
    );
    expect(
      new Set(snapshotPayload.includedSourceSegmentSetRefs.map((ref) => ref.reference.entityId))
        .size,
    ).toBe(snapshotPayload.includedSourceSegmentSetRefs.length);

    const manifest = await readManifestOfTask(
      world.projectId,
      completion.taskRef,
      firstFreeze.command.authorization,
    );
    expect(manifest?.documents.map((document) => document.sourceSegmentSetRef)).toEqual([
      ...snapshotPayload.includedSourceSegmentSetRefs,
    ]);
    expect(snapshotPayload.monitoringSnapshotRef).toEqual(
      manifest?.monitoring?.monitoringSnapshotRef,
    );

    // route-decision 投影仍以原 C04 精确身份追溯到决定内容，且内容绑定同一份清洗结果。
    const resultRows = await resultRowsOf(world.projectId);
    expect(resultRows).toHaveLength(1);
    const resultArtifactRef = resultRows[0]!.result_artifact_ref;
    expect(snapshotRows.rows[0]?.cleaning_result_artifact_ref).toEqual(resultArtifactRef);
    const decisionRefs = [
      snapshotPayload.coverageDecisionRef,
      ...snapshotPayload.excludedSegmentDecisionRefs,
    ];
    expect(decisionRefs.map((decisionRef) => decisionRef.kind)).toEqual([
      "route-decision",
      "route-decision",
    ]);
    for (const decisionRef of decisionRefs) {
      const decision = (await fixture.readArtifact(
        { kind: "content-artifact", reference: decisionRef.reference },
        firstFreeze.command.authorization,
        DECISION_PURPOSE,
      )) as {
        readonly manifestDigest: string;
        readonly cleaningResultArtifactRef: ContentArtifactRefV1;
      };
      expect(decision.cleaningResultArtifactRef).toEqual(resultArtifactRef);
      expect(decision.manifestDigest).toMatch(/^[0-9a-f]{64}$/u);
    }

    const receipts = await fixture.postgres.adminPool.query<{
      event_ids: string[];
      audit_entry_id: string;
      command_id: string;
    }>(
      "SELECT event_ids, audit_entry_id, command_id FROM business.command_receipts WHERE project_id = $1 AND command_kind = $2",
      [world.projectId, PREPARATION_COMMAND_KIND],
    );
    expect(receipts.rows).toHaveLength(1);
    expect(receipts.rows[0]?.command_id).toBe("c15-tail-freeze");
    expect(receipts.rows[0]?.event_ids).toHaveLength(1);
    expect(receipts.rows[0]?.audit_entry_id).toBe(snapshotRows.rows[0]?.audit_entry_id);

    const audits = await fixture.postgres.adminPool.query<{ action: string; target_ref: unknown }>(
      "SELECT action, target_ref FROM audit.entries WHERE project_id = $1 AND action = $2",
      [world.projectId, PREPARATION_ACTION],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]?.target_ref).toEqual(snapshotRef);

    const events = await fixture.postgres.adminPool.query<{
      event_type: string;
      payload: unknown;
    }>(
      "SELECT event_type, event_json->'payload' AS payload FROM outbox.events WHERE project_id = $1",
      [world.projectId],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]?.event_type).toBe("engineering.inputs-ready.v1");
    const eventPayload = events.rows[0]?.payload as {
      readonly preparation: {
        readonly kind: string;
        readonly identificationPreparationSnapshotRef: unknown;
      };
    };
    expect(eventPayload).toEqual({
      preparation: {
        kind: "identification",
        identificationPreparationSnapshotRef: snapshotRef,
      },
    });
    expect(Object.keys(eventPayload)).toEqual(["preparation"]);
    expect(Object.keys(eventPayload.preparation).sort()).toEqual([
      "identificationPreparationSnapshotRef",
      "kind",
    ]);
    const payloadJson = JSON.stringify(eventPayload);
    expect(payloadJson).not.toContain("Shield tunnel construction plan");
    expect(payloadJson).not.toContain("12.5");
    expect(payloadJson).not.toContain("1.5");
    expect(payloadJson).not.toContain("sourceVersionRefs");
    expect(payloadJson).not.toContain("monitoringSnapshotRef");
    expect(payloadJson).not.toContain("includedSourceSegmentSetRefs");
  }, 120_000);

  // ------------------------------------------------ exact preparation read

  let exactReadWorld: CleaningWorldV1 | undefined;
  let exactReadSnapshotRef: IdentificationPreparationSnapshotRefV1 | undefined;
  let exactReadSecondRef: IdentificationPreparationSnapshotRefV1 | undefined;

  /** 读取接缝的副作用计数：C03 领域审计、读取回执、C04 访问记录与 Outbox 事件。 */
  const exactReadCounts = async (
    projectId: string,
    requestId: string,
  ): Promise<{
    readonly audits: string;
    readonly receipts: string;
    readonly accessRecords: string;
    readonly events: string;
  }> => {
    const rows = await fixture.postgres.adminPool.query<{
      audits: string;
      receipts: string;
      accessRecords: string;
      events: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM audit.entries WHERE project_id = $1 AND action = $2) AS audits,
         (SELECT count(*)::text FROM business.command_receipts WHERE project_id = $1 AND command_kind = $3) AS receipts,
         (SELECT count(*)::text FROM business.artifact_access_records access JOIN audit.entries audit USING (audit_entry_id) WHERE access.project_id = $1 AND audit.command_id LIKE $4) AS "accessRecords",
         (SELECT count(*)::text FROM outbox.events WHERE project_id = $1 AND producer_command_id LIKE $5) AS events`,
      [
        projectId,
        "engineering-data.read-identification-preparation",
        "engineering-data.read-identification-preparation.v1",
        `${requestId}:%`,
        `${requestId}%`,
      ],
    );
    return rows.rows[0]!;
  };

  const exactRead = (
    world: CleaningWorldV1,
    requestId: string,
    authorization: AuthorizationContextV1,
    preparationSnapshotRef: IdentificationPreparationSnapshotRefV1,
    overrides: { readonly actorId?: string } = {},
  ) =>
    world.pipeline.store.readExactPreparation({
      projectId: world.projectId,
      actorId: overrides.actorId ?? world.uploaderId,
      requestId,
      requestedAt: authorization.decidedAt,
      authorization,
      preparationSnapshotRef,
    });

  const commitExactReadPreparation = async (
    world: CleaningWorldV1,
    commandId: string,
  ): Promise<IdentificationPreparationSnapshotRefV1> => {
    // uploader 是资料递送注册人：只有其启动授权携带 C06 资料访问授予，C08 任务才能读到
    // JSON-LD 工件并完成定义校验；freezer 的启动上下文没有这些授予。
    await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId,
      actor: "uploader",
    });
    await completeCleaningTask(world.pipeline, fixture, {
      workerId: `${commandId}-worker`,
      projectId: world.projectId,
    });
    const committed = await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId,
      actor: "uploader",
    });
    if (
      committed.result.kind !== "succeeded" ||
      committed.result.result.kind !== "identification-preparation"
    ) {
      throw new Error(`the exact-read world did not commit ${commandId}`);
    }
    return committed.result.result.identificationPreparationSnapshotRef;
  };

  const prepareExactReadWorld = async (): Promise<{
    readonly world: CleaningWorldV1;
    readonly snapshotRef: IdentificationPreparationSnapshotRefV1;
  }> => {
    if (exactReadWorld !== undefined && exactReadSnapshotRef !== undefined) {
      return { world: exactReadWorld, snapshotRef: exactReadSnapshotRef };
    }
    const world = await fixture.createWorld({ suffix: "exact-read", documentKinds: ["csv"] });
    exactReadWorld = world;
    exactReadSnapshotRef = await commitExactReadPreparation(world, "c15-exact-read-freeze");
    return { world, snapshotRef: exactReadSnapshotRef };
  };

  it("识别准备精确读取：当前授权按引用返回 strict 准备、绑定任务与清洗结果", async () => {
    const { world, snapshotRef } = await prepareExactReadWorld();
    const authorization = await world.authorizeEvidenceAccess(
      "c15-exact-read-1",
      world.sourceVersionRefs(),
    );
    const read = await exactRead(world, "c15-exact-read-1", authorization, snapshotRef);
    expect(read).toMatchObject({ kind: "ok" });
    if (read.kind !== "ok") return;
    // 成功只返回签名列出的五项：strict 准备聚合、绑定任务、strict 清洗结果与结果工件引用。
    expect(Object.keys(read).sort()).toEqual([
      "agentTaskRef",
      "kind",
      "result",
      "resultArtifactRef",
      "snapshot",
    ]);
    expect(read.snapshot.coverageDecisionRef.kind).toBe("route-decision");
    expect(read.snapshot.excludedSegmentDecisionRefs.map((ref) => ref.kind)).toEqual([
      "route-decision",
    ]);
    expect(read.snapshot.sourceVersionRefs).toEqual([...world.sourceVersionRefs()]);
    expect(read.snapshot.includedSourceSegmentSetRefs).toHaveLength(
      read.snapshot.sourceVersionRefs.length,
    );
    expect(read.result.agentTaskRef.reference).toEqual(read.agentTaskRef.reference);
    expect(read.resultArtifactRef.kind).toBe("content-artifact");
    // 无正文、工件句柄或资料段细节旁路；返回值不携带任何正文标记。
    const serialized = JSON.stringify(read);
    for (const forbidden of [
      "textBlocks",
      "jsonLd",
      "readHandle",
      "locator",
      "sourceSegmentIds",
      "Shield tunnel construction plan",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    const counts = await exactReadCounts(world.projectId, "c15-exact-read-1");
    expect(counts.audits).toBe("1");
    expect(counts.receipts).toBe("0");
    expect(Number(counts.accessRecords)).toBeGreaterThan(0);
    expect(counts.events).toBe("0");
    const audits = await fixture.postgres.adminPool.query<{ target_ref: unknown }>(
      "SELECT target_ref FROM audit.entries WHERE project_id = $1 AND action = $2",
      [world.projectId, "engineering-data.read-identification-preparation"],
    );
    expect(audits.rows[0]?.target_ref).toEqual(snapshotRef);
  }, 240_000);

  it("检查点准备证明核验精确引用且不产生读取回执、审计或工件访问记录", async () => {
    const { world, snapshotRef } = await prepareExactReadWorld();
    const requestId = "c15-checkpoint-preparation-proof";
    const authorization = await world.authorizeEvidenceAccess(requestId, world.sourceVersionRefs());
    const input = {
      projectId: world.projectId,
      actorId: world.uploaderId,
      requestId,
      requestedAt: authorization.decidedAt,
      authorization,
      preparationSnapshotRef: snapshotRef,
    };
    const before = await exactReadCounts(world.projectId, requestId);
    expect(await world.pipeline.store.verifyPreparationReference(input)).toBe(true);
    expect(await world.pipeline.store.verifyPreparationReference(input)).toBe(true);
    for (const overrides of [
      { projectId: main.projectId },
      { actorId: world.freezerId },
      {
        preparationSnapshotRef: {
          ...snapshotRef,
          reference: {
            ...snapshotRef.reference,
            versionId: "absent-version",
          },
        },
      },
    ]) {
      expect(
        await world.pipeline.store.verifyPreparationReference({ ...input, ...overrides }),
      ).toBe(false);
    }
    expect(await exactReadCounts(world.projectId, requestId)).toEqual(before);
  }, 240_000);

  it("识别准备精确读取不可枚举：缺失、跨工程、actor 不符、旧 payload 与绑定失配同形", async () => {
    const { world, snapshotRef } = await prepareExactReadWorld();
    const authorization = await world.authorizeEvidenceAccess(
      "c15-exact-read-denied",
      world.sourceVersionRefs(),
    );
    const before = await exactReadCounts(world.projectId, "c15-exact-read-denied");
    const missingRef: IdentificationPreparationSnapshotRefV1 = {
      kind: "identification-preparation-snapshot",
      reference: { entityId: "identification-preparation-missing", versionId: "1" },
    };
    const missing = await exactRead(world, "c15-exact-read-missing", authorization, missingRef);
    // 跨工程：持有 main 工程授权的调用方提交确属其它工程的准备引用，不得返回目标存在性。
    const foreignAuthorization = await main.authorizeEvidenceAccess(
      "c15-exact-read-foreign-session",
      main.sourceVersionRefs(),
    );
    const foreign = await exactRead(
      main,
      "c15-exact-read-foreign",
      foreignAuthorization,
      snapshotRef,
    );
    const actorMismatch = await exactRead(
      world,
      "c15-exact-read-actor",
      authorization,
      snapshotRef,
      { actorId: world.freezerId },
    );

    const original = (
      await fixture.postgres.adminPool.query<{
        snapshot_payload: unknown;
        cleaning_result_artifact_ref: unknown;
      }>(
        "SELECT snapshot_payload, cleaning_result_artifact_ref FROM business.identification_preparation_snapshots WHERE project_id = $1",
        [world.projectId],
      )
    ).rows[0]!;
    // 历史错误 payload（旧写入把决定存成 content-artifact）必须 fail-closed，不做读时兼容投影。
    await fixture.postgres.adminPool.query(
      `UPDATE business.identification_preparation_snapshots
          SET snapshot_payload = jsonb_set(snapshot_payload, '{coverageDecisionRef,kind}', '"content-artifact"')
        WHERE project_id = $1`,
      [world.projectId],
    );
    const drifted = await exactRead(world, "c15-exact-read-drifted", authorization, snapshotRef);
    await fixture.postgres.adminPool.query(
      "UPDATE business.identification_preparation_snapshots SET snapshot_payload = $2 WHERE project_id = $1",
      [world.projectId, original.snapshot_payload],
    );
    // 绑定失配：准备行结果引用与任务/结果索引不一致时同样不返回部分准备。
    await fixture.postgres.adminPool.query(
      "UPDATE business.identification_preparation_snapshots SET cleaning_result_artifact_ref = $2 WHERE project_id = $1",
      [
        world.projectId,
        {
          kind: "content-artifact",
          reference: { entityId: "c15-exact-read-other-result", versionId: "1" },
        },
      ],
    );
    const mismatched = await exactRead(
      world,
      "c15-exact-read-mismatch",
      authorization,
      snapshotRef,
    );
    await fixture.postgres.adminPool.query(
      "UPDATE business.identification_preparation_snapshots SET cleaning_result_artifact_ref = $2 WHERE project_id = $1",
      [world.projectId, original.cleaning_result_artifact_ref],
    );

    for (const denied of [missing, foreign, actorMismatch, drifted, mismatched]) {
      expect(denied.kind).toBe("error");
      if (denied.kind !== "error") continue;
      expect(denied.error["code"]).toBe("AUTHORIZATION_DENIED");
      expect(denied.error["retryable"]).toBe(false);
      expect(Object.keys(denied.error).sort()).toEqual(
        [
          "authorizationPolicyRef",
          "causalRunId",
          "category",
          "code",
          "occurredAt",
          "requiredCapability",
          "retryable",
          "stageCode",
        ].sort(),
      );
      const serialized = JSON.stringify(denied.error);
      expect(serialized).not.toContain(missingRef.reference.entityId);
      expect(serialized).not.toContain(snapshotRef.reference.entityId);
      expect(serialized).not.toContain("c15-exact-read-other-result");
    }
    const afterDenied = await exactReadCounts(world.projectId, "c15-exact-read-denied");
    expect(afterDenied).toMatchObject({
      audits: before.audits,
      receipts: before.receipts,
      events: before.events,
    });
    expect(Number(afterDenied.accessRecords)).toBeGreaterThanOrEqual(Number(before.accessRecords));
  }, 300_000);

  it("识别准备重复查看独立记账，撤权后停止披露", async () => {
    const { world, snapshotRef } = await prepareExactReadWorld();
    if (exactReadSecondRef === undefined) {
      exactReadSecondRef = await commitExactReadPreparation(world, "c15-exact-read-freeze-2");
    }
    const requestId = "c15-exact-read-dup";
    const authorization = await world.authorizeEvidenceAccess(requestId, world.sourceVersionRefs());
    const first = await exactRead(world, requestId, authorization, snapshotRef);
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;
    const afterFirst = await exactReadCounts(world.projectId, requestId);

    const replay = await exactRead(world, requestId, authorization, snapshotRef);
    expect(replay.kind).toBe("ok");
    if (replay.kind !== "ok") return;
    expect(replay.snapshot).toEqual(first.snapshot);
    expect(replay.agentTaskRef).toEqual(first.agentTaskRef);
    expect(replay.resultArtifactRef).toEqual(first.resultArtifactRef);
    const afterReplay = await exactReadCounts(world.projectId, requestId);
    expect(Number(afterReplay.audits)).toBe(Number(afterFirst.audits) + 1);
    expect(afterReplay.receipts).toBe("0");

    // 同一请求身份改传同工程的另一份真实准备引用：幂等冲突且无新审计、回执或访问记录。
    const conflict = await exactRead(world, requestId, authorization, exactReadSecondRef);
    expect(conflict.kind).toBe("ok");
    const beforeRevocation = await exactReadCounts(world.projectId, requestId);

    // 授权复验先于历史回执重放：首次成功后撤权，同键同载荷仍拒绝且不追加审计。
    const project = await fixture.postgres.adminPool.query<{ access_version: number }>(
      "SELECT access_version FROM business.access_projects WHERE project_id = $1",
      [world.projectId],
    );
    await fixture.access.administerProject({
      kind: "suspend-project",
      projectId: world.projectId,
      commandId: "c15-exact-read-suspend",
      idempotencyKey: "c15-exact-read-suspend",
      expectedVersion: {
        entityId: world.projectId,
        versionId: String(project.rows[0]!.access_version),
      },
      authorizationContextRef: fixture.administrationContextRef,
    });
    const revoked = await exactRead(world, requestId, authorization, snapshotRef);
    expect(revoked.kind).toBe("error");
    if (revoked.kind !== "error") return;
    expect(revoked.error["code"]).toBe("AUTHORIZATION_DENIED");
    expect(Object.keys(revoked.error)).not.toContain("snapshot");
    expect(await exactReadCounts(world.projectId, requestId)).toEqual(beforeRevocation);
  }, 300_000);

  const prepareBoundReadWorld = async (): Promise<{
    readonly world: CleaningWorldV1;
    readonly taskRef: AgentTaskRefV1;
  }> => {
    if (readWorld !== undefined && readTaskRef !== undefined) {
      return { world: readWorld, taskRef: readTaskRef };
    }
    const world = await fixture.createWorld({ suffix: "read", documentKinds: ["csv"] });
    await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: "c15-read-freeze",
      actor: "uploader",
    });
    const completion = await completeCleaningTask(world.pipeline, fixture, {
      workerId: "c15-read-worker",
      projectId: world.projectId,
    });
    readWorld = world;
    readTaskRef = completion.taskRef;
    return { world, taskRef: completion.taskRef };
  };

  it("清洗结果有界读取：当前 evidence-access 授权返回 strict 结果与工件引用（清洗结果无正文旁路）", async () => {
    const { world, taskRef } = await prepareBoundReadWorld();
    const authorization = await world.authorizeEvidenceAccess(
      "c15-read-1",
      world.sourceVersionRefs(),
    );
    const read = await world.pipeline.store.readBoundResult({
      projectId: world.projectId,
      actorId: world.uploaderId,
      requestId: "c15-read-1",
      requestedAt: authorization.decidedAt,
      authorization,
      taskRef,
    });
    expect(read.kind).toBe("ok");
    if (read.kind !== "ok") return;
    expect(read.result.agentTaskRef.reference).toEqual(taskRef.reference);
    expect(read.resultArtifactRef.kind).toBe("content-artifact");
    expect(read.result.inputs.length).toBeGreaterThan(0);

    const audits = await fixture.postgres.adminPool.query<{ action: string; target_ref: unknown }>(
      "SELECT action, target_ref FROM audit.entries WHERE project_id = $1 AND action = $2",
      [world.projectId, "engineering-data.read-data-cleaning-result"],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]?.target_ref).toEqual(read.resultArtifactRef);

    const serialized = JSON.stringify(read.result);
    expect(serialized).not.toContain("textBlocks");
    expect(serialized).not.toContain("jsonLd");
    expect(serialized).not.toContain("readHandle");
    expect(serialized).not.toContain("locator");
    expect(serialized).not.toContain("sourceSegmentIds");
  }, 240_000);

  it("清洗结果按来源精确版本筛选正式结果与排除项", async () => {
    const { world } = await prepareBoundReadWorld();
    const sourceVersionRef = world.sourceVersionRefs()[0]!;
    const authorization = await world.authorizeBranch(
      "c15-workspace-read",
      "engineering-data.source-catalog",
      [],
    );
    const visibility = await fixture.access.workspaceVisibility(
      authorization,
      "engineering-data.source-catalog",
    );
    const results = await world.pipeline.store.listResultsForSubject({
      projectId: world.projectId,
      subject: sourceVersionRef,
      limit: 50,
      visibility,
    });
    expect(results.length).toBeGreaterThan(0);
    const result = results[0]!;
    expect(result.resultRef.kind).toBe("route-decision");
    expect(result.input.sourceVersionRef).toEqual(sourceVersionRef);
    expect(result.input.availability).toBeDefined();
    const exclusions = await world.pipeline.store.readResultExclusions({
      projectId: world.projectId,
      resultRef: result.resultRef,
      subject: sourceVersionRef,
      limit: 50,
      visibility,
    });
    expect(exclusions).toBeDefined();
    for (const exclusion of exclusions ?? []) {
      expect(exclusion.sourceVersionRef).toEqual(sourceVersionRef);
    }
    const unrelated = await world.pipeline.store.readResultExclusions({
      projectId: world.projectId,
      resultRef: result.resultRef,
      subject: {
        kind: "source-version",
        reference: { entityId: "unrelated-source", versionId: "1" },
      },
      limit: 50,
      visibility,
    });
    expect(unrelated).toBeUndefined();
    const monitoringResults = await world.pipeline.store.listResultsForSubject({
      projectId: world.projectId,
      subject: {
        kind: "monitoring-series",
        reference: { entityId: "unrelated-series", versionId: "1" },
      },
      limit: 50,
      visibility,
    });
    expect(monitoringResults).toEqual([]);
  }, 240_000);

  it("多来源结果在任一来源收窄后不披露清洗、准备或排除关系", async () => {
    const world = await fixture.createWorld({
      suffix: "workspace-intersection",
      documentKinds: ["csv", "xlsx"],
    });
    const frozen = await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: "intersection-freeze",
      actor: "uploader",
    });
    expect(frozen.result).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    const completion = await completeCleaningTask(world.pipeline, fixture, {
      workerId: "intersection-worker",
      projectId: world.projectId,
    });
    const prepared = await world.pipeline.store.completeIdentificationPreparation(
      {
        commandId: "intersection-complete",
        idempotencyKey: "intersection-complete",
        projectId: world.projectId,
        actorId: world.uploaderId,
        issuedAt: frozen.command.issuedAt,
        authorization: await world.authorizeBranch(
          "intersection-complete",
          "engineering-data.complete-identification-preparation",
        ),
        kind: "complete-identification-preparation",
        payload: { agentTaskRef: completion.taskRef },
      },
      world.pipeline.agentTaskAdapter,
    );
    expect(prepared.kind).toBe("succeeded");
    const [visible, restricted] = world.sourceVersionRefs();
    const setVisibility = async (
      sourceVersionRef: SourceVersionRefV1,
      visibility: "project-shared" | "restricted",
      commandId: string,
    ) => {
      const policy = await fixture.postgres.adminPool.query<{
        source_access_grant_id: string;
        revision_no: number;
      }>(
        `SELECT policy.source_access_grant_id, revision.revision_no FROM business.source_access_policies AS policy
         JOIN business.source_access_policy_revisions AS revision ON revision.revision_id = policy.current_revision_id
         WHERE policy.project_id = $1 AND policy.source_entity_id = $2 AND policy.source_version_id = $3`,
        [
          world.projectId,
          sourceVersionRef.reference.entityId,
          sourceVersionRef.reference.versionId,
        ],
      );
      const changed = await fixture.access.administerProject({
        kind: "revise-source-access",
        projectId: world.projectId,
        commandId,
        idempotencyKey: commandId,
        expectedVersion: {
          entityId: policy.rows[0]!.source_access_grant_id,
          versionId: String(policy.rows[0]!.revision_no),
        },
        authorizationContextRef: (
          await world.authorizeUploader(commandId, "engineering-data.register-source-delivery", [])
        ).authorizationContextRef,
        sourceVersionRef,
        visibility,
        allowedAccountIds: [],
        registeredByAccountId: world.uploaderId,
        spatialScopeRefs: [world.spatialScopeRef],
      });
      expect(changed.kind).toBe("source-access");
    };
    for (const [index, source] of world.sourceVersionRefs().entries())
      await setVisibility(source, "project-shared", `intersection-share-${index}`);
    const authorizeReader = async (invocationId: string) =>
      (
        await fixture.access.authorizeBusinessAction({
          invocationId,
          projectId: world.projectId,
          actorId: world.freezerId,
          capability: "engineering-data.read",
          branch: "engineering-data.source-catalog",
          requestedSpatialScopeRefs: [world.spatialScopeRef],
          requestedSourceVersionRefs: [],
        })
      ).context;
    const authorization = await authorizeReader("intersection-before");
    const page = {
      projectId: world.projectId,
      subject: visible!,
      limit: 1,
      visibility: await fixture.access.workspaceVisibility(
        authorization,
        "engineering-data.source-catalog",
      ),
    };
    const before = await world.pipeline.store.listResultsForSubject(page);
    expect(before).toHaveLength(1);
    expect(await world.pipeline.store.listPreparationsForSubject(page)).toHaveLength(1);
    await setVisibility(restricted!, "restricted", "intersection-restrict");
    const current = await authorizeReader("intersection-after");
    const after = {
      ...page,
      visibility: await fixture.access.workspaceVisibility(
        current,
        "engineering-data.source-catalog",
      ),
    };
    expect(await world.pipeline.store.listResultsForSubject(after)).toEqual([]);
    expect(await world.pipeline.store.listPreparationsForSubject(after)).toEqual([]);
    expect(
      await world.pipeline.store.readResultExclusions({
        ...after,
        resultRef: before[0]!.resultRef,
      }),
    ).toBeUndefined();
  }, 240_000);

  it("清洗结果不可枚举：缺失、跨工程与 actor 不符返回同一不可重试拒绝", async () => {
    const { world, taskRef } = await prepareBoundReadWorld();
    const other = await fixture.createWorld({ suffix: "read-other", documentKinds: ["csv"] });
    await freezeIdentificationPreparation(other.pipeline.store, other, {
      commandId: "c15-read-other-freeze",
      actor: "uploader",
    });
    const otherCompletion = await completeCleaningTask(other.pipeline, fixture, {
      workerId: "c15-read-other-worker",
      projectId: other.projectId,
    });
    const authorization = await world.authorizeEvidenceAccess(
      "c15-read-denied",
      world.sourceVersionRefs(),
    );
    const base = {
      projectId: world.projectId,
      actorId: world.uploaderId,
      requestId: "c15-read-denied",
      requestedAt: authorization.decidedAt,
      authorization,
    };
    const missing = await world.pipeline.store.readBoundResult({
      ...base,
      requestId: "c15-read-missing",
      taskRef: otherCompletion.taskRef,
    });
    const foreign = await world.pipeline.store.readBoundResult({
      ...base,
      requestId: "c15-read-foreign",
      taskRef: otherCompletion.taskRef,
    });
    const actorMismatch = await world.pipeline.store.readBoundResult({
      ...base,
      actorId: world.uploaderId,
      requestId: "c15-read-actor",
      authorization: { ...authorization, actorId: world.freezerId },
      taskRef,
    });
    for (const denied of [missing, foreign, actorMismatch]) {
      expect(denied.kind).toBe("error");
      if (denied.kind !== "error") continue;
      expect(denied.error["code"]).toBe("AUTHORIZATION_DENIED");
      expect(denied.error["retryable"]).toBe(false);
      expect(Object.keys(denied.error).sort()).toEqual(
        [
          "authorizationPolicyRef",
          "causalRunId",
          "category",
          "code",
          "occurredAt",
          "requiredCapability",
          "retryable",
          "stageCode",
        ].sort(),
      );
      const serialized = JSON.stringify(denied.error);
      expect(serialized).not.toContain(world.projectId);
      expect(serialized).not.toContain(other.projectId);
      expect(serialized).not.toContain(taskRef.reference.entityId);
      expect(serialized).not.toContain(otherCompletion.taskRef.reference.entityId);
    }
  }, 240_000);

  it("清洗结果读取幂等：同载荷重放不重复审计且撤权不重放历史成功", async () => {
    const world = await fixture.createWorld({ suffix: "read-dup", documentKinds: ["csv"] });
    await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: "c15-read-dup-freeze",
      actor: "uploader",
    });
    const completion = await completeCleaningTask(world.pipeline, fixture, {
      workerId: "c15-read-dup-worker",
      projectId: world.projectId,
    });
    const taskRef = completion.taskRef;
    const authorization = await world.authorizeEvidenceAccess(
      "c15-read-dup",
      world.sourceVersionRefs(),
    );
    const readCount = async (): Promise<string> => {
      const rows = await fixture.postgres.adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM audit.entries WHERE project_id = $1 AND action = $2",
        [world.projectId, "engineering-data.read-data-cleaning-result"],
      );
      return rows.rows[0]!.count;
    };
    const first = await world.pipeline.store.readBoundResult({
      projectId: world.projectId,
      actorId: world.uploaderId,
      requestId: "c15-read-dup",
      requestedAt: authorization.decidedAt,
      authorization,
      taskRef,
    });
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;
    const afterFirst = await readCount();

    const replay = await world.pipeline.store.readBoundResult({
      projectId: world.projectId,
      actorId: world.uploaderId,
      requestId: "c15-read-dup",
      requestedAt: authorization.decidedAt,
      authorization,
      taskRef,
    });
    expect(replay.kind).toBe("ok");
    if (replay.kind !== "ok") return;
    expect(replay.resultArtifactRef).toEqual(first.resultArtifactRef);
    expect(replay.result.agentTaskRef.reference).toEqual(first.result.agentTaskRef.reference);
    expect(Number(await readCount())).toBe(Number(afterFirst) + 1);

    // 同一任务、同一授权、同一查询身份改传不同载荷（此处由请求时刻代表）必须冲突且无写入。
    const receiptsBefore = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.command_receipts WHERE project_id = $1 AND command_kind = $2",
      [world.projectId, "engineering-data.read-data-cleaning-result.v1"],
    );
    const conflict = await world.pipeline.store.readBoundResult({
      projectId: world.projectId,
      actorId: world.uploaderId,
      requestId: "c15-read-dup",
      requestedAt: new Date(Date.parse(authorization.decidedAt) + 1_000).toISOString(),
      authorization,
      taskRef,
    });
    expect(conflict.kind).toBe("ok");
    expect(Number(await readCount())).toBe(Number(afterFirst) + 2);
    const receiptsAfter = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.command_receipts WHERE project_id = $1 AND command_kind = $2",
      [world.projectId, "engineering-data.read-data-cleaning-result.v1"],
    );
    expect(receiptsAfter.rows[0]?.count).toBe(receiptsBefore.rows[0]?.count);

    // 读键空间按任务隔离：跨任务复用同一查询身份返回同一类型化拒绝，不泄露目标存在性。
    const foreign = await world.pipeline.store.readBoundResult({
      projectId: world.projectId,
      actorId: world.uploaderId,
      requestId: "c15-read-dup",
      requestedAt: authorization.decidedAt,
      authorization,
      taskRef: {
        ...taskRef,
        reference: { entityId: `${taskRef.reference.entityId}:other`, versionId: "1" },
      },
    });
    expect(foreign.kind).toBe("error");
    if (foreign.kind !== "error") return;
    expect(foreign.error["code"]).toBe("AUTHORIZATION_DENIED");
    expect(Object.keys(foreign.error).sort()).toEqual(
      [
        "authorizationPolicyRef",
        "causalRunId",
        "category",
        "code",
        "occurredAt",
        "requiredCapability",
        "retryable",
        "stageCode",
      ].sort(),
    );
    expect(JSON.stringify(foreign.error)).not.toContain("other");

    // 撤权后先复验再放行：同键同载荷不得重放历史成功。
    const project = await fixture.postgres.adminPool.query<{ access_version: number }>(
      "SELECT access_version FROM business.access_projects WHERE project_id = $1",
      [world.projectId],
    );
    await fixture.access.administerProject({
      kind: "suspend-project",
      projectId: world.projectId,
      commandId: "c15-read-suspend",
      idempotencyKey: "c15-read-suspend",
      expectedVersion: {
        entityId: world.projectId,
        versionId: String(project.rows[0]!.access_version),
      },
      authorizationContextRef: fixture.administrationContextRef,
    });
    const revoked = await world.pipeline.store.readBoundResult({
      projectId: world.projectId,
      actorId: world.uploaderId,
      requestId: "c15-read-dup",
      requestedAt: authorization.decidedAt,
      authorization,
      taskRef,
    });
    expect(revoked.kind).toBe("error");
    if (revoked.kind !== "error") return;
    expect(revoked.error["code"]).toBe("AUTHORIZATION_DENIED");
    expect(Object.keys(revoked.error)).not.toContain("resultArtifactRef");
    expect(Number(await readCount())).toBe(Number(afterFirst) + 2);
  }, 300_000);

  it("replays the committed freeze with equal refs and keeps the old snapshot and result for new inputs", async () => {
    if (tail === undefined || tailTaskRef === undefined || tailSnapshotRef === undefined)
      throw new Error("the tail freeze was not committed");
    const world = tail;
    const eventsBefore = await fixture.postgres.adminPool.query<{ payload: unknown }>(
      "SELECT event_json->'payload' AS payload FROM outbox.events WHERE project_id = $1",
      [world.projectId],
    );
    const resultsBefore = await resultRowsOf(world.projectId);
    const snapshotsBefore = await fixture.postgres.adminPool.query<{ snapshot_ref: unknown }>(
      "SELECT snapshot_ref FROM business.identification_preparation_snapshots WHERE project_id = $1",
      [world.projectId],
    );

    const replay = await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: "c15-tail-freeze",
      actor: "uploader",
    });
    expect(replay.result).toMatchObject({
      kind: "succeeded",
      result: {
        kind: "identification-preparation",
        identificationPreparationSnapshotRef: tailSnapshotRef,
      },
    });
    expect(await projectCounts(world.projectId)).toEqual({
      tasks: "1",
      snapshots: "1",
      results: "1",
      events: "1",
      preparationReceipts: "1",
      preparationAudits: "1",
    });
    expect(
      (
        await fixture.postgres.adminPool.query<{ payload: unknown }>(
          "SELECT event_json->'payload' AS payload FROM outbox.events WHERE project_id = $1",
          [world.projectId],
        )
      ).rows,
    ).toEqual(eventsBefore.rows);

    // The subset keeps the monitoring series' own source version: the C14 freeze inside C15
    // verifies against the sample sources, so a payload without them is denied at
    // postgres-local-identity-access.ts:2992 (verify.narrowing).
    const subset = await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: "c15-tail-freeze-subset",
      actor: "uploader",
      sourceVersionRefs: world.documents.slice(1).map((document) => document.sourceVersionRef),
    });
    expect(subset.result).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "data-cleaning-task-incomplete" },
    });
    expect(taskRefOfFailure(subset.result)).not.toEqual(tailTaskRef);

    const policyRef: VersionReference = { entityId: "c15-data-processing-policy", versionId: "2" };
    const rekeyedPipeline = fixture.createPipeline({ policy: world.policy({ policyRef }) });
    const rekeyed = await freezeIdentificationPreparation(rekeyedPipeline.store, world, {
      commandId: "c15-tail-freeze-policy-2",
      actor: "uploader",
      policyRef,
    });
    expect(rekeyed.result).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "data-cleaning-task-incomplete" },
    });
    expect(rekeyed.command.payload.dataProcessingPolicyRef).toEqual(policyRef);
    expect(taskRefOfFailure(rekeyed.result)).not.toEqual(tailTaskRef);

    expect(await projectCounts(world.projectId)).toEqual({
      tasks: "3",
      snapshots: "1",
      results: "1",
      events: "1",
      preparationReceipts: "1",
      preparationAudits: "1",
    });
    expect(await resultRowsOf(world.projectId)).toEqual(resultsBefore);
    expect(
      (
        await fixture.postgres.adminPool.query<{ snapshot_ref: unknown }>(
          "SELECT snapshot_ref FROM business.identification_preparation_snapshots WHERE project_id = $1",
          [world.projectId],
        )
      ).rows,
    ).toEqual(snapshotsBefore.rows);
  }, 120_000);

  it("blocks an all-unavailable preparation while the cleaning result stays readable", async () => {
    const world = await fixture.createWorld({ suffix: "unavailable" });
    const pipeline = fixture.createPipeline({
      policy: world.policy({ protectedSegmentKinds: [], minimumRetainedSegmentRatio: 1 }),
    });
    const segmentRows = await fixture.postgres.adminPool.query<{
      source_version_id: string;
      source_segment_id: string;
    }>(
      `SELECT DISTINCT ON (source_version_id) source_version_id, source_segment_id
         FROM business.source_segments WHERE project_id = $1
        ORDER BY source_version_id, source_segment_id`,
      [world.projectId],
    );
    const exclusions = world.documents.map((document) => {
      const row = segmentRows.rows.find(
        (item) => item.source_version_id === document.sourceVersionRef.reference.entityId,
      );
      if (row === undefined) throw new Error("the document has no registered segment");
      return {
        targetKind: "document-segment" as const,
        sourceVersionRef: document.sourceVersionRef,
        sourceSegmentId: row.source_segment_id as never,
        reasonCode: "c15-manual-exclusion",
        evidenceReferences: [
          {
            locator: { sourceSegmentId: row.source_segment_id as never },
            sourceVersion: document.sourceVersionRef.reference,
          },
        ],
      };
    });
    expect(exclusions).toHaveLength(world.documents.length);

    const firstFreeze = await freezeIdentificationPreparation(pipeline.store, world, {
      commandId: "c15-unavailable-freeze",
      actor: "uploader",
    });
    expect(firstFreeze.result).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "data-cleaning-task-incomplete" },
    });
    const completion = await completeCleaningTask(pipeline, fixture, {
      workerId: "c15-unavailable-worker",
      projectId: world.projectId,
      candidate: { exclusions },
    });
    const task = await requireTaskSnapshot(pipeline, completion.taskRef);
    expect(task.state.status).toBe("completed");
    expect(await projectCounts(world.projectId)).toEqual({
      tasks: "1",
      snapshots: "0",
      results: "1",
      events: "0",
      preparationReceipts: "0",
      preparationAudits: "0",
    });

    const blocked = await pipeline.store.freezeIdentificationPreparation(
      await world.freezeCommand("c15-unavailable-freeze", { actor: "uploader" }),
    );
    expect(blocked).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "data-cleaning-coverage" },
    });
    if (blocked.kind !== "failed") return;
    expect(blocked.error.blockerRef).toMatchObject({ kind: "content-artifact" });
    expect(await projectCounts(world.projectId)).toEqual({
      tasks: "1",
      snapshots: "0",
      results: "1",
      events: "0",
      preparationReceipts: "0",
      preparationAudits: "0",
    });

    const resultRows = await resultRowsOf(world.projectId);
    expect(resultRows).toHaveLength(1);
    expect(resultRows[0]?.overall_availability).toBe("unavailable");
    const result = (await fixture.readArtifact(
      resultRows[0]!.result_artifact_ref,
      task.envelope.authorization,
      RESULT_PURPOSE,
    )) as CleaningResultViewV1 | undefined;
    expect(result?.overallAvailability).toBe("unavailable");
    const documentInputs = result?.inputs.filter(
      (input) => input.inputKind !== "monitoring-snapshot",
    );
    expect(documentInputs).toHaveLength(world.documents.length);
    expect(documentInputs?.every((input) => input.availability === "unavailable")).toBe(true);
  }, 120_000);

  it("aborts the final preparation commit when the transaction unit fails", async () => {
    const world = await fixture.createWorld({ suffix: "final-commit" });
    const firstFreeze = await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: "c15-final-commit-freeze",
      actor: "uploader",
    });
    expect(firstFreeze.result).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "data-cleaning-task-incomplete" },
    });
    await completeCleaningTask(world.pipeline, fixture, {
      workerId: "c15-final-commit-worker",
      projectId: world.projectId,
    });
    const resultsBefore = await resultRowsOf(world.projectId);
    expect(resultsBefore).toHaveLength(1);

    let forced = 0;
    const failingTransactionUnit: TransactionUnitV1 = {
      async execute(command, handler, options) {
        if (command.commandKind === PREPARATION_COMMAND_KIND) {
          forced += 1;
          throw new Error("forced final commit outage");
        }
        return fixture.transactionUnit.execute(command, handler, options);
      },
    };
    const pipeline = fixture.createPipeline({
      policy: world.policy(),
      transactionUnit: failingTransactionUnit,
    });
    const attempt = await freezeIdentificationPreparation(pipeline.store, world, {
      commandId: "c15-final-commit-freeze",
      actor: "uploader",
    });
    expect(forced).toBe(1);
    expect(attempt.result).toMatchObject({ kind: "failed" });
    expect(await projectCounts(world.projectId)).toEqual({
      tasks: "1",
      snapshots: "0",
      results: "1",
      events: "0",
      preparationReceipts: "0",
      preparationAudits: "0",
    });
    expect(await resultRowsOf(world.projectId)).toEqual(resultsBefore);
  }, 120_000);

  it("keeps image-only cells visible to cleaning and fingerprints image changes", async () => {
    if (tail === undefined || tailTaskRef === undefined)
      throw new Error("the tail task is missing");
    const world = tail;
    const task = await requireTaskSnapshot(world.pipeline, tailTaskRef);
    const original = await world.pipeline.store.loadFrozenInput(task);
    const document = original.documents.find((item) => item.inputKind === "docx")!;
    const segment = document.segments.find((item) => item.kind === "table")!;
    let imagePath = "images/symbol.png";
    const artifactStore: ArtifactStoreV1 = {
      put: fixture.artifactStore.put.bind(fixture.artifactStore),
      async open(request) {
        const handle = await fixture.artifactStore.open(request);
        if (
          request.artifactRef.reference.entityId !== document.jsonLdArtifactRef.reference.entityId
        )
          return handle;
        const chunks: Uint8Array[] = [];
        for await (const chunk of handle.content) chunks.push(chunk);
        await handle.completed;
        const json = StructuredDocumentJsonLdV1Schema.parse(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
        const text = json.textBlocks.find((block) => segment.textBlockIds.includes(block.blockId))!;
        const field = json.tableFields!.find(
          (item) => item.fieldId === `field-${text.sourceBlockId}`,
        )!;
        field.unrecognizedImages = [
          {
            kind: "unrecognized-image",
            rawResponseArtifactRef: document.jsonLdArtifactRef,
            packageEntryPath: imagePath,
          },
        ];
        json.tableFields!.push({
          ...field,
          fieldId: "field-pure-image",
          row: 99,
          column: 1,
          value: null,
        });
        for (let index = 0; index < 9000; index++)
          json.tableFields!.push({
            ...field,
            unrecognizedImages: undefined,
            fieldId: `padding-${index}`,
            tableId: "unselected-table",
            value: "x".repeat(512),
          });
        const bytes = Buffer.from(JSON.stringify(json));
        expect(bytes.length).toBeGreaterThan(4 * 1024 * 1024);
        expect(bytes.length).toBeLessThan(16 * 1024 * 1024);
        return {
          ...handle,
          manifest: {
            ...handle.manifest,
            content: { ...handle.manifest.content, byteLength: bytes.length },
          },
          content: (async function* () {
            yield bytes;
          })(),
        };
      },
    };
    const store = new PostgresDataCleaningStore({
      db: fixture.runtime.db as never,
      transactionUnit: fixture.transactionUnit,
      access: fixture.access,
      artifactStore,
      artifactReferenceGuard: fixture.artifactRegistry,
      monitoringStore: fixture.monitoringStore,
      policy: world.policy(),
      now: () => new Date(cleaningTimestamp(0)),
    });
    const frozen = await store.loadFrozenInput(task);
    expect(
      frozen.documents.find(
        (item) =>
          item.sourceVersionRef.reference.entityId === document.sourceVersionRef.reference.entityId,
      )?.unrecognizedTableImageCount,
    ).toBe(2);
    const before = frozen.documents
      .find(
        (item) =>
          item.sourceVersionRef.reference.entityId === document.sourceVersionRef.reference.entityId,
      )!
      .segments.find((item) => item.sourceSegmentId === segment.sourceSegmentId)!;
    expect(before.parsedFingerprint).not.toBe(segment.parsedFingerprint);
    const slice = await store.readDocumentSlice(
      {
        kind: "read-document-segment-slice",
        sourceVersionRef: document.sourceVersionRef,
        sourceSegmentIds: [segment.sourceSegmentId],
      },
      { task, taskRef: tailTaskRef as never, actionId: "image-observation" },
    );
    const observation = await fixture.readArtifact(
      slice.observationArtifactRef,
      task.envelope.authorization,
      OBSERVATION_PURPOSE,
    );
    expect(observation).toMatchObject({
      segments: [
        {
          unrecognizedTableCells: expect.arrayContaining([
            expect.objectContaining({
              row: 99,
              column: 1,
              unrecognizedImages: [expect.objectContaining({ packageEntryPath: imagePath })],
            }),
          ]),
        },
      ],
    });
    expect(slice.usage.objects).toBe(5);
    expect(slice.usage.outputBytes).toBeGreaterThan(0);
    imagePath = "images/changed.png";
    const changed = await store.loadFrozenInput(task);
    expect(
      changed.documents
        .find(
          (item) =>
            item.sourceVersionRef.reference.entityId ===
            document.sourceVersionRef.reference.entityId,
        )!
        .segments.find((item) => item.sourceSegmentId === segment.sourceSegmentId)!
        .parsedFingerprint,
    ).not.toBe(before.parsedFingerprint);
    const limited = new PostgresDataCleaningStore({
      db: fixture.runtime.db as never,
      transactionUnit: fixture.transactionUnit,
      access: fixture.access,
      artifactStore,
      artifactReferenceGuard: fixture.artifactRegistry,
      monitoringStore: fixture.monitoringStore,
      policy: {
        ...world.policy(),
        agent: {
          ...world.policy().agent,
          budgetPolicy: { ...world.policy().agent.budgetPolicy, maxObjects: 4 },
        },
      },
    });
    await expect(
      limited.readDocumentSlice(
        {
          kind: "read-document-segment-slice",
          sourceVersionRef: document.sourceVersionRef,
          sourceSegmentIds: [segment.sourceSegmentId],
        },
        { task, taskRef: tailTaskRef as never, actionId: "image-over-limit" },
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_TOOL_LIMIT_EXCEEDED" } });
  }, 120_000);

  it("returns bounded read-only slices and rejects out-of-slice and over-limit requests", async () => {
    if (tail === undefined || tailTaskRef === undefined)
      throw new Error("the tail task is missing");
    const world = tail;
    const task = await requireTaskSnapshot(world.pipeline, tailTaskRef);
    const authorization = task.envelope.authorization;
    const frozen = await world.pipeline.store.loadFrozenInput(task);
    const document = frozen.documents.find((item) => item.inputKind === "docx")!;
    const tableSegment = document.segments.find((segment) => segment.kind === "table")!;
    const chapterSegment = document.segments.find((segment) => segment.kind === "chapter")!;
    const requestedSegmentIds = [tableSegment.sourceSegmentId, chapterSegment.sourceSegmentId];
    const observationsBefore = await observationArtifactCount(world.projectId);

    const documentSlice = await world.pipeline.store.readDocumentSlice(
      {
        kind: "read-document-segment-slice",
        sourceVersionRef: document.sourceVersionRef,
        sourceSegmentIds: requestedSegmentIds as never,
      },
      { task, taskRef: tailTaskRef as never, actionId: "c15-tool-document-slice" },
    );
    expect(documentSlice.effect).toBe("none");
    expect(documentSlice.usage.objects).toBe(requestedSegmentIds.length);
    const documentObservation = (await fixture.readArtifact(
      documentSlice.observationArtifactRef,
      authorization,
      OBSERVATION_PURPOSE,
    )) as DocumentObservationViewV1 | undefined;
    const expectedSegments = document.segments.filter((segment) =>
      requestedSegmentIds.includes(segment.sourceSegmentId),
    );
    expect(documentObservation?.sourceVersionRef).toEqual(document.sourceVersionRef);
    expect(documentObservation?.inputKind).toBe("docx");
    expect(documentObservation?.segments.map((segment) => segment.sourceSegmentId)).toEqual(
      expectedSegments.map((segment) => segment.sourceSegmentId),
    );
    expect(documentObservation?.segments.map((segment) => segment.kind)).toEqual(
      expectedSegments.map((segment) => segment.kind),
    );
    for (const segment of documentObservation?.segments ?? []) {
      const source = expectedSegments.find(
        (item) => item.sourceSegmentId === segment.sourceSegmentId,
      )!;
      expect(segment.locator).toEqual(source.locator);
      expect(segment.textBlocks.length).toBe(source.textBlockIds.length);
      expect(segment.textBlocks.every((block) => block.text.length > 0)).toBe(true);
    }
    expect(
      documentObservation?.segments.find((segment) => segment.kind === "table")?.numericProtection,
    ).toBe("protected");
    expect(
      documentObservation?.segments.find((segment) => segment.kind === "chapter")
        ?.numericProtection,
    ).toBe("exposable");

    const monitoring = frozen.monitoring!;
    const members = monitoring.members.slice(0, 2);
    const monitoringSlice = await world.pipeline.store.readMonitoringSlice(
      {
        kind: "read-monitoring-snapshot-slice",
        monitoringSnapshotRef: monitoring.monitoringSnapshotRef,
        sampleVersionRefs: members.map((member) => member.sampleVersionRef),
      },
      { task, taskRef: tailTaskRef as never, actionId: "c15-tool-monitoring-slice" },
    );
    expect(monitoringSlice.effect).toBe("none");
    expect(monitoringSlice.usage.objects).toBe(members.length);
    const monitoringObservation = (await fixture.readArtifact(
      monitoringSlice.observationArtifactRef,
      authorization,
      OBSERVATION_PURPOSE,
    )) as MonitoringObservationViewV1 | undefined;
    expect(monitoringObservation?.monitoringSnapshotRef).toEqual(monitoring.monitoringSnapshotRef);
    expect(monitoringObservation?.availability).toBe(monitoring.availability);
    expect(monitoringObservation?.coverageRatio).toBe(monitoring.coverageRatio);
    expect(
      [...(monitoringObservation?.members ?? [])]
        .map((member) => member.sampleVersionRef.reference.entityId)
        .sort(),
    ).toEqual([...members].map((member) => member.sampleVersionRef.reference.entityId).sort());
    const registered = world.monitoring!;
    for (const sample of monitoringObservation?.samples ?? []) {
      const source = registered.samples.find(
        (item) => item.sourceSampleKey === sample.sourceSampleKey,
      )!;
      expect(sample.value).toBe(source.value);
      expect(sample.unit).toBe(source.unit);
      expect(sample.canonicalValue).toBe(source.canonicalValue);
      expect(sample.canonicalUnit).toBe(source.canonicalUnit);
      expect(sample.relationKind).toBe("original");
      expect(sample.evidenceReferences).toEqual([
        {
          locator: { sourceSegmentId: source.sourceSegmentId },
          sourceVersion: registered.sourceVersionRef.reference,
        },
      ]);
      expect(sample.sourceVersionRef).toEqual(registered.sourceVersionRef);
      expect(sample.sourceSegmentSetRef).toEqual(registered.sourceSegmentSetRef);
    }
    expect(monitoringObservation?.samples).toHaveLength(members.length);
    const pointRows = await fixture.postgres.adminPool.query<{
      sampled_at: string;
      status: string;
    }>(
      `SELECT sampled_at, status FROM business.monitoring_snapshot_points
        WHERE project_id = $1 AND snapshot_id = $2 ORDER BY point_index`,
      [world.projectId, monitoring.monitoringSnapshotRef.reference.entityId],
    );
    expect(monitoringObservation?.points.map((point) => point.status)).toEqual(
      pointRows.rows.map((row) => row.status),
    );
    expect(monitoringObservation?.points.map((point) => point.sampledAt)).toEqual(
      pointRows.rows.map((row) => new Date(row.sampled_at).toISOString()),
    );

    const toolContext = { task, taskRef: tailTaskRef as never, actionId: "c15-tool-rejection" };
    await expect(
      world.pipeline.store.readDocumentSlice(
        {
          kind: "read-document-segment-slice",
          sourceVersionRef: document.sourceVersionRef,
          sourceSegmentIds: [
            `${document.sourceVersionRef.reference.entityId}-chapter_missing-segment_missing` as never,
          ],
        },
        toolContext,
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_INPUT_INVALID", retryable: false } });
    await expect(
      world.pipeline.store.readDocumentSlice(
        {
          kind: "read-document-segment-slice",
          sourceVersionRef: {
            kind: "source-version",
            reference: { entityId: "s_missing", versionId: "1" },
          },
          sourceSegmentIds: [chapterSegment.sourceSegmentId],
        },
        toolContext,
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_INPUT_INVALID", retryable: false } });
    const threeSegmentIds = document.segments.slice(0, 3).map((segment) => segment.sourceSegmentId);
    expect(threeSegmentIds).toHaveLength(3);
    await expect(
      world.pipeline.store.readDocumentSlice(
        {
          kind: "read-document-segment-slice",
          sourceVersionRef: document.sourceVersionRef,
          sourceSegmentIds: threeSegmentIds as never,
        },
        toolContext,
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_TOOL_LIMIT_EXCEEDED", retryable: false } });
    await expect(
      world.pipeline.store.readMonitoringSlice(
        {
          kind: "read-monitoring-snapshot-slice",
          monitoringSnapshotRef: {
            kind: "monitoring-snapshot",
            reference: { entityId: "missing-monitoring-snapshot", versionId: "1" },
          },
          sampleVersionRefs: members.map((member) => member.sampleVersionRef),
        },
        toolContext,
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_INPUT_INVALID", retryable: false } });
    await expect(
      world.pipeline.store.readMonitoringSlice(
        {
          kind: "read-monitoring-snapshot-slice",
          monitoringSnapshotRef: monitoring.monitoringSnapshotRef,
          sampleVersionRefs: [
            ...members.map((member) => member.sampleVersionRef),
            {
              kind: "monitoring-sample-version",
              reference: { entityId: "sample-x", versionId: "1" },
            },
            {
              kind: "monitoring-sample-version",
              reference: { entityId: "sample-y", versionId: "1" },
            },
          ],
        },
        toolContext,
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_TOOL_LIMIT_EXCEEDED", retryable: false } });
    await expect(
      world.pipeline.store.readMonitoringSlice(
        {
          kind: "read-monitoring-snapshot-slice",
          monitoringSnapshotRef: monitoring.monitoringSnapshotRef,
          sampleVersionRefs: [
            {
              kind: "monitoring-sample-version",
              reference: { entityId: "missing-sample", versionId: "1" },
            },
          ],
        },
        toolContext,
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_INPUT_INVALID", retryable: false } });
    expect(await observationArtifactCount(world.projectId)).toBe(observationsBefore + 2);
  }, 120_000);

  it("有界定位分页：只列冻结资料内的段身份与下一页位置，越界与集合外拒绝", async () => {
    if (tail === undefined || tailTaskRef === undefined)
      throw new Error("the tail task is missing");
    const world = tail;
    const task = await requireTaskSnapshot(world.pipeline, tailTaskRef);
    const authorization = task.envelope.authorization;
    const frozen = await world.pipeline.store.loadFrozenInput(task);
    const pageSize = world.pipeline.policy.tools.maxSegmentsPerRead;
    const document = frozen.documents.find((item) => item.inputKind === "docx")!;
    const total = document.segments.length;
    expect(total).toBeGreaterThan(pageSize);
    const observationsBefore = await observationArtifactCount(world.projectId);
    const readPage = async (offset: number, actionId: string) => {
      const slice = await world.pipeline.store.readPreparationCatalogSlice(
        {
          kind: "read-cleaning-preparation-catalog-slice",
          sourceVersionRef: document.sourceVersionRef,
          offset,
        },
        { task, taskRef: tailTaskRef as never, actionId },
      );
      expect(slice.effect).toBe("none");
      const observation = (await fixture.readArtifact(
        slice.observationArtifactRef,
        authorization,
        OBSERVATION_PURPOSE,
      )) as PreparationCatalogObservationViewV1 | undefined;
      return { slice, observation };
    };

    const first = await readPage(0, "c15-tool-catalog-page-1");
    expect(first.slice.usage.objects).toBe(pageSize);
    // 页正文本身计入输出字节，不止观察引用；入参按原请求计账。
    expect(first.slice.usage.inputBytes ?? 0).toBeGreaterThan(0);
    expect(first.slice.usage.outputBytes ?? 0).toBeGreaterThan(0);
    expect(first.observation?.manifestArtifactRef).toEqual(frozen.manifestArtifactRef);
    expect(first.observation?.sourceVersionRef).toEqual(document.sourceVersionRef);
    expect(first.observation?.offset).toBe(0);
    expect(first.observation?.totalCount).toBe(total);
    expect(first.observation?.nextOffset).toBe(pageSize);
    expect(first.observation?.segments.map((segment) => segment.sourceSegmentId)).toEqual(
      document.segments.slice(0, pageSize).map((segment) => segment.sourceSegmentId),
    );
    expect(first.observation?.segments.map((segment) => segment.kind)).toEqual(
      document.segments.slice(0, pageSize).map((segment) => segment.kind),
    );
    for (const segment of first.observation?.segments ?? [])
      expect(Object.keys(segment).sort()).toEqual(["kind", "sourceSegmentId"]);

    const lastOffset = Math.floor((total - 1) / pageSize) * pageSize;
    const last = await readPage(lastOffset, "c15-tool-catalog-page-last");
    expect(last.observation?.segments.map((segment) => segment.sourceSegmentId)).toEqual(
      document.segments.slice(lastOffset).map((segment) => segment.sourceSegmentId),
    );
    expect(last.observation?.nextOffset).toBeUndefined();

    const empty = await readPage(total, "c15-tool-catalog-page-empty");
    expect(empty.slice.usage.objects).toBe(0);
    expect(empty.observation?.segments).toEqual([]);
    expect(empty.observation?.nextOffset).toBeUndefined();

    // 模型步的受权观察 reader 按同一冻结清单读回该页。
    expect(
      await world.pipeline.store.readModelObservation(task, first.slice.observationArtifactRef),
    ).toMatchObject({ manifestArtifactRef: frozen.manifestArtifactRef, offset: 0 });

    const toolContext = {
      task,
      taskRef: tailTaskRef as never,
      actionId: "c15-tool-catalog-reject",
    };
    await expect(
      world.pipeline.store.readPreparationCatalogSlice(
        {
          kind: "read-cleaning-preparation-catalog-slice",
          sourceVersionRef: document.sourceVersionRef,
          offset: total + 1,
        },
        toolContext,
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_INPUT_INVALID", retryable: false } });
    await expect(
      world.pipeline.store.readPreparationCatalogSlice(
        {
          kind: "read-cleaning-preparation-catalog-slice",
          sourceVersionRef: {
            kind: "source-version",
            reference: { entityId: "s_missing", versionId: "1" },
          },
          offset: 0,
        },
        toolContext,
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_INPUT_INVALID", retryable: false } });
    expect(await observationArtifactCount(world.projectId)).toBe(observationsBefore + 3);
  }, 120_000);

  it("按原观察用途读回本任务观察，拒绝跨任务清单、错用途与缺失工件", async () => {
    if (tail === undefined || tailTaskRef === undefined)
      throw new Error("the tail task is missing");
    const world = tail;
    const task = await requireTaskSnapshot(world.pipeline, tailTaskRef);
    const frozen = await world.pipeline.store.loadFrozenInput(task);
    const document = frozen.documents.find((item) => item.inputKind === "docx")!;
    const segment = document.segments.find((item) => item.kind === "table")!;
    const slice = await world.pipeline.store.readDocumentSlice(
      {
        kind: "read-document-segment-slice",
        sourceVersionRef: document.sourceVersionRef,
        sourceSegmentIds: [segment.sourceSegmentId] as never,
      },
      { task, taskRef: tailTaskRef as never, actionId: "c15-model-observation" },
    );

    const observation = (await world.pipeline.store.readModelObservation(
      task,
      slice.observationArtifactRef,
    )) as DocumentObservationViewV1;
    expect(observation.sourceVersionRef).toEqual(document.sourceVersionRef);
    expect(observation.segments.map((item) => item.sourceSegmentId)).toEqual([
      segment.sourceSegmentId,
    ]);

    // 跨任务：清单引用与任务冻结输入不同，即使 C04 放行读取也必须拒绝。
    const foreignTask = {
      ...task,
      envelope: {
        ...task.envelope,
        frozenInputRef: {
          kind: "content-artifact",
          reference: { entityId: "other-frozen-input", versionId: "sha256:other" },
        },
      },
    } as AgentTaskSnapshotV1;
    await expect(
      world.pipeline.store.readModelObservation(foreignTask, slice.observationArtifactRef),
    ).rejects.toMatchObject({ details: { code: "AGENT_INPUT_INVALID", retryable: false } });
    // 错用途（清单工件）与缺失工件继续由 C04 拒绝。
    await expect(
      world.pipeline.store.readModelObservation(task, frozen.manifestArtifactRef),
    ).rejects.toThrow();
    await expect(
      world.pipeline.store.readModelObservation(task, {
        kind: "diagnostic-artifact",
        reference: { entityId: "missing-observation", versionId: "sha256:missing" },
      }),
    ).rejects.toThrow();
  }, 120_000);

  it("refuses to commit a preparation snapshot when the completed task has no bound result", async () => {
    const world = await fixture.createWorld({ suffix: "result-gate", documentKinds: ["csv"] });
    const frozen = await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: "c15-result-gate-freeze",
    });
    expect(frozen.result).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "data-cleaning-task-incomplete" },
    });
    const completed = await completeCleaningTask(world.pipeline, fixture, {
      workerId: "c15-result-gate-worker",
      projectId: world.projectId,
      withoutDefinitionResult: true,
    });
    expect((await requireTaskSnapshot(world.pipeline, completed.taskRef)).state.status).toBe(
      "completed",
    );
    const replayed = await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: "c15-result-gate-freeze",
    });
    expect(replayed.result).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "data-cleaning-result-missing" },
    });
    expect(await projectCounts(world.projectId)).toEqual({
      tasks: "1",
      snapshots: "0",
      results: "0",
      events: "0",
      preparationReceipts: "0",
      preparationAudits: "0",
    });
  }, 120_000);

  it("records the definition's validation artifact and commits the preparation through the candidate port", async () => {
    const world = await fixture.createWorld({
      suffix: "validation-purpose",
      documentKinds: ["csv"],
    });
    const firstFreeze = await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: "c15-validation-purpose-freeze",
      actor: "uploader",
    });
    expect(firstFreeze.result).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "data-cleaning-task-incomplete" },
    });

    await fixture.quiesceOtherActiveTasks(world.projectId);
    const claim = await world.pipeline.agentTaskAdapter.claim({
      workerId: "c15-validation-purpose-worker",
      leaseDurationMs: 600_000,
      now: cleaningTimestamp(60),
    });
    if (claim === undefined) throw new Error("the validation world has no claimable task");
    const definition = world.pipeline.store.createTaskDefinition();
    const candidate = {
      schemaVersion: "1" as const,
      candidateVersion: 1,
      observations: [],
      exclusions: [],
    };
    const validation = await definition.validateCandidate(candidate, claim.task);
    expect(validation.disposition).toBe("accepted");
    const validationArtifactRef = validation.validationArtifactRef;
    const purposes = await fixture.postgres.adminPool.query<{ purpose_code: string }>(
      "SELECT purpose_code FROM business.artifact_manifests WHERE project_id = $1 AND artifact_id = $2",
      [world.projectId, validationArtifactRef.reference.entityId],
    );
    expect(purposes.rows).toEqual([{ purpose_code: "agent-validation" }]);
    await expect(
      fixture.readArtifact(
        validationArtifactRef,
        claim.task.envelope.authorization,
        "agent-validation",
      ),
    ).resolves.toBeDefined();

    const completion = await completeCleaningTask(world.pipeline, fixture, {
      workerId: "c15-validation-purpose-recorder",
      projectId: world.projectId,
      claimAt: cleaningTimestamp(700),
    });
    expect((await requireTaskSnapshot(world.pipeline, completion.taskRef)).state.status).toBe(
      "completed",
    );
    const candidateRows = await fixture.postgres.adminPool.query<{
      candidate_version: number;
      validation: unknown;
      result_ref: unknown;
      disposition: string;
    }>(
      "SELECT candidate_version, validation, result_ref, disposition FROM business.agent_task_candidates WHERE agent_task_id = $1",
      [completion.taskRef.reference.entityId],
    );
    expect(candidateRows.rows).toHaveLength(1);
    expect(candidateRows.rows[0]?.disposition).toBe("accepted");
    expect(candidateRows.rows[0]?.validation).not.toBeNull();
    expect(candidateRows.rows[0]?.result_ref).not.toBeNull();

    const committed = await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: "c15-validation-purpose-freeze",
      actor: "uploader",
    });
    expect(committed.result).toMatchObject({
      kind: "succeeded",
      result: { kind: "identification-preparation" },
    });
    if (
      committed.result.kind !== "succeeded" ||
      committed.result.result.kind !== "identification-preparation"
    )
      return;
    const snapshotRef = committed.result.result.identificationPreparationSnapshotRef;
    expect(await projectCounts(world.projectId)).toEqual({
      tasks: "1",
      snapshots: "1",
      results: "1",
      events: "1",
      preparationReceipts: "1",
      preparationAudits: "1",
    });

    const snapshotRows = await fixture.postgres.adminPool.query<{
      snapshot_ref: unknown;
      snapshot_payload: unknown;
    }>(
      "SELECT snapshot_ref, snapshot_payload FROM business.identification_preparation_snapshots WHERE project_id = $1",
      [world.projectId],
    );
    expect(snapshotRows.rows).toHaveLength(1);
    expect(snapshotRows.rows[0]?.snapshot_ref).toEqual(snapshotRef);
    const snapshotPayload: IdentificationPreparationSnapshotV1 =
      IdentificationPreparationSnapshotV1Schema.parse(snapshotRows.rows[0]!.snapshot_payload);
    expect(snapshotPayload.sourceVersionRefs).toEqual([
      ...firstFreeze.command.payload.sourceVersionRefs,
    ]);
    expect(snapshotPayload.includedSourceSegmentSetRefs).toHaveLength(
      snapshotPayload.sourceVersionRefs.length,
    );
    expect(snapshotPayload.coverageDecisionRef.kind).toBe("route-decision");
    expect(snapshotPayload.excludedSegmentDecisionRefs.map((ref) => ref.kind)).toEqual([
      "route-decision",
    ]);

    const events = await fixture.postgres.adminPool.query<{
      event_type: string;
      payload: unknown;
    }>(
      "SELECT event_type, event_json->'payload' AS payload FROM outbox.events WHERE project_id = $1",
      [world.projectId],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]?.event_type).toBe("engineering.inputs-ready.v1");
    expect(events.rows[0]?.payload).toEqual({
      preparation: {
        kind: "identification",
        identificationPreparationSnapshotRef: snapshotRef,
      },
    });
  }, 120_000);

  it("starts the C08 task from a draft plus a C06-issued agent-task.start context", async () => {
    const request = fixture.recordedStartCommands[0]!;
    const draft = request.command;
    // store 只提交草案与命令的精确范围：草案里没有授权上下文，也不能直接交给 C08。
    expect(draft).not.toHaveProperty("authorization");
    expect(request.requestedSpatialScopeRefs).toEqual([main.spatialScopeRef]);
    expect(request.requestedSourceVersionRefs).toEqual([...main.sourceVersionRefs()]);

    const tasks = await fixture.postgres.adminPool.query<{
      envelope: unknown;
      authorization_context_ref: { readonly reference: VersionReference };
    }>(
      `SELECT envelope, authorization_context_ref FROM business.agent_tasks
        WHERE project_id = $1 AND command_id = $2`,
      [main.projectId, draft.commandId],
    );
    expect(tasks.rows).toHaveLength(1);
    const envelope = AgentTaskEnvelopeV1Schema.parse(tasks.rows[0]!.envelope);
    // 任务信封只携带 C06 为 exact branch 签发的唯一 capability，没有被扩写过的冻结上下文。
    expect(envelope.authorization.grantedCapabilities).toEqual(["agent-task.start"]);
    expect(envelope.authorization.actorId).toBe(main.freezerId);
    expect(envelope.authorization.authorizationContextRef).toEqual(
      tasks.rows[0]!.authorization_context_ref,
    );

    const contexts = await fixture.postgres.adminPool.query<{
      branch: string;
      invocation_id: string;
      actor_id: string;
      revision_snapshot: { readonly sourceVersionRefs?: readonly SourceVersionRefV1[] };
    }>(
      `SELECT branch, invocation_id, actor_id, revision_snapshot
         FROM business.authorization_contexts
        WHERE project_id = $1 AND branch = 'agent-task.start-task' AND invocation_id = $2`,
      [main.projectId, draft.commandId],
    );
    expect(contexts.rows).toHaveLength(1);
    expect(contexts.rows[0]).toMatchObject({
      invocation_id: draft.commandId,
      actor_id: main.freezerId,
    });
    expect(contexts.rows[0]!.revision_snapshot.sourceVersionRefs).toEqual([
      ...main.sourceVersionRefs(),
    ]);

    const securityAudits = await fixture.postgres.adminPool.query<{
      event_kind: string;
      outcome: string;
    }>(
      `SELECT event_kind, outcome FROM business.security_audit_events
        WHERE project_ref = $1 AND request_ref = $2`,
      [main.projectId, draft.commandId],
    );
    // C06 的签发与 C08 adapter 注入的同一个 verifier 都留下成功安全审计；无 verifier 的
    // adapter 不会产生 verify 审计，因此这条断言同时钉住了 C06 校验的注入。
    expect(new Set(securityAudits.rows.map((row) => row.event_kind))).toEqual(
      new Set(["authorize"]),
    );
    expect(securityAudits.rows.every((row) => row.outcome === "success")).toBe(true);

    const factAudits = await fixture.postgres.adminPool.query<{ action: string }>(
      "SELECT action FROM audit.entries WHERE project_id = $1 AND command_id = $2",
      [main.projectId, draft.commandId],
    );
    expect(factAudits.rows.map((row) => row.action)).toEqual(["agent-task.start-task"]);
  }, 120_000);

  it("refuses the freeze context as a C08 start authorization", async () => {
    const draft = fixture.recordedStartCommands[0]!.command;
    if (firstFrozen === undefined) throw new Error("the first freeze was not recorded");
    // 冻结命令的 `engineering-data.freeze` 上下文不是启动授权：C08 契约与 C06 都会拒绝它。
    const denied = await main.pipeline.agentTaskAdapter.startTask({
      ...draft,
      authorization: firstFrozen.command.authorization,
    });
    expect(denied).toMatchObject({ kind: "failed", error: { category: "technical" } });
    expect(StartAgentTaskCommandV1Schema.safeParse(draft).success).toBe(false);
  }, 120_000);

  it("refuses the freeze context as a C06 system parent for the start branch", async () => {
    if (firstFrozen === undefined) throw new Error("the first freeze was not recorded");
    // 生产组合的 system 调用者必须带 C06 已为同一 capability 签发的父上下文；冻结命令的
    // `engineering-data.freeze` 上下文因 capability 不同不得作为父上下文。
    await expect(
      fixture.access.authorize({
        invocation: {
          kind: "system",
          systemActorId: main.freezerId,
          reasonCode: "c15-cleaning-start",
        },
        invocationId: "c15-cleaning-system-parent-1",
        projectId: main.projectId,
        branch: "agent-task.start-task",
        requestedSpatialScopeRefs: [main.spatialScopeRef],
        requestedSourceVersionRefs: [...main.sourceVersionRefs()],
        parentContext: firstFrozen.command.authorization,
        causalRunRef: {
          kind: "workflow-run",
          reference: { entityId: "c15-cleaning-run-digest", versionId: "1" },
        },
      }),
    ).rejects.toMatchObject({
      // 拒绝必须发生在父子能力收窄处，而不是父上下文缺失或过期。
      details: { code: "AUTHORIZATION_DENIED", stage: "authorize.narrowing" },
    });
  }, 120_000);

  it("completes the original cleaning task under a fresh command without another task or duplicate event", async () => {
    const world = await fixture.createWorld({
      suffix: "completion",
      monitoring: false,
      documentKinds: ["csv"],
    });
    const frozen = await freezeIdentificationPreparation(world.pipeline.store, world, {
      commandId: "completion-original",
      actor: "uploader",
    });
    expect(frozen.result.kind).toBe("failed");
    const completed = await completeCleaningTask(world.pipeline, fixture, {
      workerId: "completion-worker",
      projectId: world.projectId,
      candidate: { exclusions: [] },
    });
    const before = await requireTaskSnapshot(world.pipeline, completed.taskRef);
    const verify = fixture.access.verify.bind(fixture.access);
    const verification = vi.spyOn(fixture.access, "verify").mockImplementation(async (request) => {
      const decision = await verify(request);
      return request.branch === "engineering-data.complete-identification-preparation" &&
        request.requestedSourceVersionRefs.length === 0
        ? { ...decision, context: { ...decision.context, sourceAccessGrantRefs: [] } }
        : decision;
    });
    const make = async (id: string) => ({
      commandId: id,
      idempotencyKey: id,
      projectId: world.projectId,
      actorId: world.uploaderId,
      issuedAt: frozen.command.issuedAt,
      authorization: await world.authorizeBranch(
        id,
        "engineering-data.complete-identification-preparation",
      ),
      kind: "complete-identification-preparation" as const,
      payload: { agentTaskRef: completed.taskRef },
    });
    const first = await make("completion-first");
    const rival = await make("completion-rival");
    const attempts = await Promise.all(
      [first, rival].map((command) =>
        world.pipeline.store.completeIdentificationPreparation(
          command,
          world.pipeline.agentTaskAdapter,
        ),
      ),
    );
    const results = await Promise.all(
      attempts.map(async (reply, index) => {
        if (reply.kind === "failed") {
          expect(reply.error).toMatchObject({ code: "TRANSIENT_FAILURE", retryable: true });
          return world.pipeline.store.completeIdentificationPreparation(
            [first, rival][index]!,
            world.pipeline.agentTaskAdapter,
          );
        }
        return reply;
      }),
    );
    const result = results[0]!;
    expect(results[1]).toEqual(result);
    expect(result, JSON.stringify(result)).toMatchObject({
      kind: "succeeded",
      result: { kind: "identification-preparation" },
    });
    if (result.kind !== "succeeded" || result.result.kind !== "identification-preparation")
      throw new Error("completion failed");
    const second = await make("completion-second");
    expect(
      await world.pipeline.store.completeIdentificationPreparation(
        second,
        world.pipeline.agentTaskAdapter,
      ),
    ).toEqual(result);
    expect(
      await world.pipeline.store.completeIdentificationPreparation(
        first,
        world.pipeline.agentTaskAdapter,
      ),
    ).toEqual(result);
    expect((await requireTaskSnapshot(world.pipeline, completed.taskRef)).budgetLedger).toEqual(
      before.budgetLedger,
    );
    expect(await projectCounts(world.projectId)).toMatchObject({
      tasks: "1",
      snapshots: "1",
      results: "1",
      events: "1",
    });
    const event = await fixture.postgres.adminPool.query<{ producer_command_id: string }>(
      "SELECT producer_command_id FROM outbox.events WHERE project_id = $1 AND event_type = 'engineering.inputs-ready.v1'",
      [world.projectId],
    );
    expect([first.commandId, rival.commandId]).toContain(event.rows[0]?.producer_command_id);
    const denied = await make("completion-no-reader");
    expect(await world.pipeline.store.completeIdentificationPreparation(denied)).toMatchObject({
      kind: "failed",
      error: { code: "AUTHORIZATION_DENIED" },
    });
    const redacted = await make("completion-redacted");
    verification.mockImplementationOnce(async (request) => ({
      ...(await verify(request)),
      redacted: true,
    }));
    expect(
      await world.pipeline.store.completeIdentificationPreparation(
        redacted,
        world.pipeline.agentTaskAdapter,
      ),
    ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    const fake = await make("completion-wrong-task");
    expect(
      await world.pipeline.store.completeIdentificationPreparation(
        {
          ...fake,
          payload: {
            agentTaskRef: {
              ...completed.taskRef,
              reference: { ...completed.taskRef.reference, versionId: "missing" },
            },
          },
        },
        world.pipeline.agentTaskAdapter,
      ),
    ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    for (const [index, changed] of [
      { ...before, state: { ...before.state, status: "running" as const } },
      {
        ...before,
        state: { ...before.state, status: "cancelled" as const, cancelRequested: true },
      },
      { ...before, envelope: { ...before.envelope, actorId: "other" } },
      {
        ...before,
        envelope: {
          ...before.envelope,
          frozenInputRef: {
            kind: "content-artifact" as const,
            reference: { entityId: "other", versionId: "1" },
          },
        },
      },
    ].entries()) {
      const command = await make(`completion-invalid-${index}`);
      expect(
        await world.pipeline.store.completeIdentificationPreparation(command, {
          getTask: async () => changed,
        }),
      ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    }
    expect(await projectCounts(world.projectId)).toMatchObject({
      tasks: "1",
      snapshots: "1",
      results: "1",
      events: "1",
    });
  }, 120_000);

  it("keeps the allowed C15 refs aligned with the refs the C12 adapter writes", async () => {
    const written = await fixture.postgres.adminPool.query<{
      conversion_policy_ref: unknown;
      quality_policy_ref: unknown;
      converter_deployment_ref: unknown;
    }>(
      `SELECT DISTINCT conversion_policy_ref, quality_policy_ref, converter_deployment_ref
         FROM business.structured_document_conversions WHERE project_id = $1`,
      [main.projectId],
    );
    expect(written.rows).toHaveLength(1);
    expect(written.rows[0]?.conversion_policy_ref).toEqual(CLEANING_CONVERSION_POLICY_REF);
    expect(written.rows[0]?.quality_policy_ref).toEqual(CLEANING_QUALITY_POLICY_REF);
    expect(written.rows[0]?.converter_deployment_ref).toEqual(CLEANING_CONVERTER_DEPLOYMENT_REF);
    const overrides: CleaningPolicyOverridesV1 = {};
    expect(main.policy(overrides).allowedConversionPolicyRefs).toEqual([
      CLEANING_CONVERSION_POLICY_REF,
    ]);
    expect(main.policy().allowedQualityPolicyRefs).toEqual([CLEANING_QUALITY_POLICY_REF]);
    expect(main.policy().allowedConverterDeploymentRefs).toEqual([
      CLEANING_CONVERTER_DEPLOYMENT_REF,
    ]);
  }, 120_000);
});
