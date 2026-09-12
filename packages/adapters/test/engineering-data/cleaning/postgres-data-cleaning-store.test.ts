import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AgentTaskClaimV1, AgentTaskSnapshotV1 } from "@riskflow/core/agent-runtime";
import type { TransactionUnitV1 } from "@riskflow/core/persistence";
import { StartAgentTaskCommandV1Schema } from "@riskflow/contracts/ports";
import type {
  AuthorizationContextV1,
  EngineeringFreezeCommandV1,
  SourceVersionRefV1,
  VersionReference,
} from "@riskflow/contracts/ports";

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

interface PreparationSnapshotViewV1 {
  readonly sourceVersionRefs: readonly SourceVersionRefV1[];
  readonly includedSourceSegmentSetRefs: readonly {
    readonly reference: VersionReference;
  }[];
  readonly monitoringSnapshotRef?: { readonly reference: VersionReference };
  readonly coverageDecisionRef: { readonly reference: VersionReference };
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
  let tailTaskRef: { readonly reference: VersionReference } | undefined;
  let tailSnapshotRef: { readonly reference: VersionReference } | undefined;

  beforeAll(async () => {
    fixture = await startDataCleaningFixture();
    main = await fixture.createWorld({ suffix: "main" });
  }, 240_000);

  afterAll(async () => {
    await fixture?.close();
  }, 60_000);

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
    const command = fixture.recordedStartCommands[index];
    if (command === undefined) throw new Error(`start command ${index} was not recorded`);
    return command.payload.frozenInputRef as {
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
        authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
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
      snapshot_payload: PreparationSnapshotViewV1;
      audit_entry_id: string;
      cleaning_result_artifact_ref: unknown;
    }>(
      "SELECT snapshot_ref, snapshot_payload, audit_entry_id, cleaning_result_artifact_ref FROM business.identification_preparation_snapshots WHERE project_id = $1",
      [world.projectId],
    );
    expect(snapshotRows.rows).toHaveLength(1);
    expect(snapshotRows.rows[0]?.snapshot_ref).toEqual(snapshotRef);
    const snapshotPayload = snapshotRows.rows[0]!.snapshot_payload;
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
    expect(snapshotPayload.coverageDecisionRef.reference.entityId).toBeTruthy();

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
    ).rejects.toThrow(/not part of the frozen preparation/u);
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
    ).rejects.toThrow(/not part of the frozen preparation/u);
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
    ).rejects.toThrow(/exceeds the frozen tool limit/u);
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
    ).rejects.toThrow(/not part of the frozen preparation/u);
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
    ).rejects.toThrow(/exceeds the frozen tool limit/u);
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
    ).rejects.toThrow(/not part of the frozen preparation/u);
    expect(await observationArtifactCount(world.projectId)).toBe(observationsBefore + 2);
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
      snapshot_payload: PreparationSnapshotViewV1;
    }>(
      "SELECT snapshot_ref, snapshot_payload FROM business.identification_preparation_snapshots WHERE project_id = $1",
      [world.projectId],
    );
    expect(snapshotRows.rows).toHaveLength(1);
    expect(snapshotRows.rows[0]?.snapshot_ref).toEqual(snapshotRef);
    const snapshotPayload = snapshotRows.rows[0]!.snapshot_payload;
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

  it("cannot hand C15's own start command to the real C08 adapter", async () => {
    const raw = fixture.recordedStartCommands[0]!;
    expect(raw.kind).toBe("start-task");
    expect(raw.authorization.grantedCapabilities).toEqual(["engineering-data.freeze"]);
    const parsed = StartAgentTaskCommandV1Schema.safeParse(raw);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toContain(
        "required capability is not granted",
      );
    }
    const direct = await main.pipeline.agentTaskAdapter.startTask(raw);
    expect(direct).toMatchObject({ kind: "failed", error: { category: "technical" } });
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
