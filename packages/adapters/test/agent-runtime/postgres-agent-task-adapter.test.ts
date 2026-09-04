import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";

import {
  AgentTaskDefinitionRegistry,
  buildCompletedAgentTaskResult,
} from "@riskflow/core/agent-runtime";
import { z } from "@riskflow/core/model";

import { PostgresAgentTaskAdapter } from "../../src/agent-runtime/index.js";
import { runPostgresMigrations } from "../../src/postgres/migrations/run.js";
import { createPostgresRuntime } from "../../src/postgres/pool.js";
import { startPostgresFixture, type PostgresTestFixture } from "../postgres/fixture.js";

const ref = (entityId: string, versionId = "1") => ({ entityId, versionId });
const artifact = (kind: "content-artifact" | "diagnostic-artifact", entityId: string) => ({
  kind,
  reference: { entityId, versionId: `sha256:${"b".repeat(64)}` },
});
const authorization = {
  schemaVersion: "1" as const,
  authorizationContextRef: { kind: "authorization-context" as const, reference: ref("auth-1") },
  actorId: "actor-1",
  projectId: "project-1",
  grantedCapabilities: ["agent-task.start" as const],
  spatialScopeRefs: [],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: ref("access-policy"),
  decidedAt: "2030-01-01T00:00:00.000Z",
  invocation: { kind: "human" as const },
};
const policy = {
  schemaVersion: "1" as const,
  policyRef: ref("cleaning-budget"),
  modelDeploymentRef: ref("cleaning-model"),
  promptTemplateRef: ref("cleaning-prompt"),
  toolPolicyRef: ref("cleaning-tools"),
  maxModelInvocations: 1,
  maxToolInvocations: 1,
  maxContextTokens: 100,
  maxInputBytes: 1_000,
  maxOutputBytes: 1_000,
  maxCandidates: 1,
  maxObjects: 5,
  maxSupplementarySearches: 0,
  maxCorrections: 0,
  maxTransientRetries: 0,
  maxConcurrentActions: 1,
  maxWallClockMs: 60_000,
};
const definition = new AgentTaskDefinitionRegistry([
  {
    metadata: {
      schemaVersion: "1",
      definitionRef: ref("cleaning-definition"),
      taskType: "data-cleaning",
      toolPolicyRef: policy.toolPolicyRef,
      incrementSchemaRef: ref("cleaning-increment"),
      validationPolicyRef: ref("cleaning-validation"),
      supportedTriggerModes: ["embedded", "interactive"],
      allowedToolRefs: [],
      resultFamilies: ["content-artifact"],
    },
    budgetPolicy: policy,
    actionSchema: z.strictObject({ operation: z.literal("candidate") }),
    incrementSchema: z.strictObject({ operation: z.literal("candidate") }),
    candidateSchema: z.strictObject({ operation: z.literal("candidate") }),
    tools: [],
    validateCandidate: () => ({
      schemaVersion: "1",
      items: [],
      disposition: "accepted",
      validationArtifactRef: artifact("diagnostic-artifact", "validation"),
      validatedAt: "2030-01-01T00:00:00.000Z",
    }),
  },
]);
const startCommand = {
  kind: "start-task" as const,
  commandId: "command-start-1",
  idempotencyKey: "idempotency-start-1",
  projectId: "project-1",
  actorId: "actor-1",
  issuedAt: "2030-01-01T00:00:00.000Z",
  authorization,
  payload: {
    taskType: "data-cleaning" as const,
    triggerMode: "embedded" as const,
    parentRunRef: { kind: "workflow-run" as const, reference: ref("run-1") },
    frozenInputRef: { kind: "project-revision" as const, reference: ref("project-revision-1") },
    modelDeploymentRef: policy.modelDeploymentRef,
    promptTemplateRef: policy.promptTemplateRef,
    toolPolicyRef: policy.toolPolicyRef,
    budgetPolicyRef: policy.policyRef,
    incrementSchemaRef: ref("cleaning-increment"),
    validationPolicyRef: ref("cleaning-validation"),
  },
};

describe("postgres agent runtime adapter", () => {
  let fixture: PostgresTestFixture;
  let runtime: ReturnType<typeof createPostgresRuntime>;
  let adapter: PostgresAgentTaskAdapter;

  beforeAll(async () => {
    fixture = await startPostgresFixture();
    await runPostgresMigrations({
      connection: fixture.migrator,
      migrationRoot: fixture.productionMigrationRoot,
      additionalMigrationRoots: [fixture.fixtureMigrationRoot],
    });
    runtime = createPostgresRuntime(fixture.app, "riskflow_app");
    adapter = new PostgresAgentTaskAdapter({ db: runtime.db, registry: definition });
  }, 60_000);

  afterAll(async () => {
    await runtime?.close();
    await fixture?.close();
  });

  it("applies the 000005 tables and fixture without adding an outbox event", async () => {
    const tables = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'business' AND table_name IN (
        'agent_tasks', 'agent_task_attempts', 'agent_task_actions',
        'agent_task_candidates', 'agent_command_confirmations', 'agent_task_fixture'
      )
    `.execute(runtime.db);
    expect(tables.rows).toHaveLength(6);
    const outbox = await fixture.adminPool.query("SELECT event_id FROM outbox.events");
    expect(outbox.rows).toHaveLength(0);
  });

  it("uses C03 idempotency, SKIP LOCKED claim, CAS versioning and action reuse", async () => {
    const first = await adapter.startTask(startCommand);
    expect(first.kind).toBe("succeeded");
    const replay = await adapter.startTask(startCommand);
    expect(replay.kind).toBe("succeeded");
    if (first.kind !== "succeeded" || replay.kind !== "succeeded") return;
    expect(replay.result.agentTaskRef).toEqual(first.result.agentTaskRef);

    const claim = await adapter.claim({
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      now: "2030-01-01T00:00:01.000Z",
    });
    expect(claim?.task.state.status).toBe("running");
    if (claim === undefined) return;
    const reserved = await adapter.reserveAction({
      taskRef: claim.task.envelope.agentTaskRef,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      actionId: "action-1",
      reservationId: "reservation-1",
      actionType: "model-invocation",
      sequence: 1,
      idempotencyKey: "action-idempotency-1",
      intentArtifactRef: artifact("diagnostic-artifact", "intent"),
      now: "2030-01-01T00:00:02.000Z",
    });
    expect(await adapter.findAction(claim.task.envelope.agentTaskRef, "action-1")).toMatchObject({
      status: "started",
      intentArtifactRef: artifact("diagnostic-artifact", "intent"),
    });
    const output = artifact("content-artifact", "cleaned-output");
    await adapter.completeAction({
      taskRef: claim.task.envelope.agentTaskRef,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      actionId: "action-1",
      resultRef: output,
      resultArtifactRef: output,
      usage: { ...reserved.reservation.amount, modelInvocations: 1 },
      now: "2030-01-01T00:00:03.000Z",
    });
    const result = buildCompletedAgentTaskResult(claim.task.envelope.agentTaskRef, output);
    await adapter.completeTask({
      taskRef: claim.task.envelope.agentTaskRef,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      resultRef: result,
      now: "2030-01-01T00:00:04.000Z",
    });
    expect((await adapter.getTask(claim.task.envelope.agentTaskRef))?.state.status).toBe(
      "completed",
    );
    expect(await adapter.findAction(claim.task.envelope.agentTaskRef, "action-1")).toMatchObject({
      status: "completed",
    });
    const receipts = await fixture.adminPool.query(
      `SELECT command_kind, audit_entry_id
         FROM business.command_receipts
        WHERE project_id = 'project-1'
          AND command_kind LIKE 'agent-task.%'`,
    );
    expect(receipts.rows.length).toBeGreaterThanOrEqual(5);
    expect(receipts.rows.every((row) => row.audit_entry_id !== null)).toBe(true);
  });
});
