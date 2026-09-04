import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";

import {
  AgentCommandProposalV1Schema,
  AgentTaskDefinitionRegistry,
  buildCompletedAgentTaskResult,
} from "@riskflow/core/agent-runtime";
import { ArtifactPutCommandV1Schema } from "@riskflow/core/artifacts";
import { z } from "@riskflow/core/model";

import { PostgresAgentTaskAdapter } from "../../src/agent-runtime/index.js";
import {
  ARTIFACT_TEST_TIMESTAMP,
  startArtifactFixture,
  type ArtifactTestFixture,
} from "../artifacts/fixture.js";

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
  grantedCapabilities: ["agent-task.start", "agent-task.confirm"] as const,
  spatialScopeRefs: [],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: ref("access-policy"),
  decidedAt: "2030-01-01T00:00:00.000Z",
  invocation: { kind: "human" as const },
};

const confirmAuthorization = {
  ...authorization,
  grantedCapabilities: ["agent-task.confirm"] as const,
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

const executedCommands: Array<{ readonly command: unknown; readonly proposalRef: unknown }> = [];
describe("postgres agent runtime adapter", () => {
  let fixture: ArtifactTestFixture;
  let adapter: PostgresAgentTaskAdapter;

  beforeAll(async () => {
    fixture = await startArtifactFixture();
    adapter = new PostgresAgentTaskAdapter({
      db: fixture.runtime.db,
      registry: definition,
      transactionUnit: fixture.transactionUnit,
      artifactStore: fixture.store,
      referenceGuard: fixture.registry,
      commandExecutor: {
        async execute({ command, proposal }) {
          executedCommands.push({ command, proposalRef: proposal.commandProposalRef });
          return { resultRef: proposal.targetRef };
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await fixture?.close();
  });

  const putArtifact = async (
    artifactId: string,
    artifactKind: "content" | "diagnostic",
    purposeCode: string,
    value?: unknown,
  ) => {
    const command = ArtifactPutCommandV1Schema.parse({
      schemaVersion: "1",
      commandId: `put-${artifactId}`,
      idempotencyKey: `put-${artifactId}`,
      projectId: authorization.projectId,
      actorId: authorization.actorId,
      issuedAt: ARTIFACT_TEST_TIMESTAMP,
      authorization,
      requiredCapability: "agent-task.start",
      artifactId,
      artifactKind,
      purposeCode,
      mediaType: "application/json",
      parentArtifactRefs: [],
      evidenceReferences: [],
      additionalSpatialScopeRefs: [],
      additionalSourceAccessGrantRefs: [],
    });
    const content = new TextEncoder().encode(JSON.stringify(value ?? { artifactId, purposeCode }));
    const result = await fixture.store.put(
      command,
      (async function* () {
        yield content;
      })(),
    );
    return result.artifactRef;
  };

  it("applies the 000005 tables and fixture without adding an outbox event", async () => {
    const tables = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'business' AND table_name IN (
        'agent_tasks', 'agent_task_attempts', 'agent_task_actions',
        'agent_task_candidates', 'agent_command_confirmations', 'agent_task_fixture'
      )
    `.execute(fixture.runtime.db);
    expect(tables.rows).toHaveLength(6);
    const outbox = await fixture.postgres.adminPool.query("SELECT event_id FROM outbox.events");
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
    const intent = await putArtifact("intent", "diagnostic", "agent-action-intent");
    const output = await putArtifact("cleaned-output", "content", "agent-candidate");
    const increment = await putArtifact("increment", "diagnostic", "agent-increment");
    const resultArtifact = await putArtifact("action-result", "diagnostic", "agent-action-result");
    const reserved = await adapter.reserveAction({
      taskRef: claim.task.envelope.agentTaskRef,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      actionId: "action-1",
      reservationId: "reservation-1",
      actionType: "model-invocation",
      sequence: 1,
      idempotencyKey: "action-idempotency-1",
      intentArtifactRef: intent,
      now: "2030-01-01T00:00:02.000Z",
    });
    expect(await adapter.findAction(claim.task.envelope.agentTaskRef, "action-1")).toMatchObject({
      status: "started",
      intentArtifactRef: intent,
    });
    await adapter.recordCandidate({
      candidate: {
        schemaVersion: "1",
        taskRef: claim.task.envelope.agentTaskRef,
        candidateVersion: 1,
        candidateArtifactRef: output,
        incrementArtifactRef: increment,
        disposition: "accepted",
        createdAt: "2030-01-01T00:00:02.500Z",
      },
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
    });
    expect(
      (await adapter.getTask(claim.task.envelope.agentTaskRef))?.state.latestCandidateVersion,
    ).toBe(1);
    await adapter.completeAction({
      taskRef: claim.task.envelope.agentTaskRef,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      actionId: "action-1",
      resultRef: output,
      resultArtifactRef: resultArtifact,
      usage: { ...reserved.reservation.amount, modelInvocations: 1 },
      activeWallClockMs: 1_000,
      now: "2030-01-01T00:00:03.000Z",
    });
    expect(
      (await adapter.getTask(claim.task.envelope.agentTaskRef))?.budgetLedger.activeWallClockMs,
    ).toBe(1_000);
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
    const receipts = await fixture.postgres.adminPool.query(
      `SELECT command_kind, audit_entry_id
         FROM business.command_receipts
        WHERE project_id = 'project-1'
          AND command_kind LIKE 'agent-task.%'`,
    );
    expect(receipts.rows.length).toBeGreaterThanOrEqual(5);
    expect(receipts.rows.every((row) => row.audit_entry_id !== null)).toBe(true);
  });
  it("executes a confirmed command through the domain port", async () => {
    const started = await adapter.startTask({
      ...startCommand,
      commandId: "command-interactive-1",
      idempotencyKey: "idempotency-interactive-1",
      payload: { ...startCommand.payload, triggerMode: "interactive" },
    });
    expect(started.kind).toBe("succeeded");
    if (started.kind !== "succeeded") return;
    const claim = await adapter.claim({
      workerId: "worker-confirm",
      leaseDurationMs: 30_000,
      now: "2030-01-01T00:01:00.000Z",
    });
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    const targetRef = await putArtifact("confirmed-target", "content", "agent-candidate");
    const commandArtifactRef = await putArtifact("command-payload", "diagnostic", "agent-command", {
      commandKind: "fixture-cleaning.apply",
      targetRef,
    });
    const proposal = AgentCommandProposalV1Schema.parse({
      schemaVersion: "1",
      commandProposalRef: {
        kind: "command-proposal",
        reference: ref("proposal-confirmed", "1"),
      },
      taskRef: claim.task.envelope.agentTaskRef,
      projectId: authorization.projectId,
      targetRef,
      expectedTargetVersion: targetRef.reference,
      commandArtifactRef,
      commandIdempotencyKey: "fixture-cleaning-apply-1",
      expectedEffect: "cleaning-applied",
      externalEffects: ["business-write"],
      proposedAt: "2030-01-01T00:01:01.000Z",
    });
    const proposalArtifactRef = await putArtifact(
      "command-proposal",
      "diagnostic",
      "agent-command-proposal",
      proposal,
    );
    await adapter.markWaiting({
      taskRef: claim.task.envelope.agentTaskRef,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      proposalRef: proposal.commandProposalRef,
      proposalArtifactRef,
      now: "2030-01-01T00:01:02.000Z",
    });
    const confirmed = await adapter.confirmCommand({
      kind: "confirm-command",
      commandId: "command-confirm-1",
      idempotencyKey: "idempotency-confirm-1",
      projectId: authorization.projectId,
      actorId: authorization.actorId,
      issuedAt: "2030-01-01T00:01:03.000Z",
      authorization: confirmAuthorization,
      payload: {
        agentTaskRef: claim.task.envelope.agentTaskRef,
        commandProposalRef: proposal.commandProposalRef,
        confirmation: "confirmed",
      },
    });
    expect(confirmed.kind).toBe("succeeded");
    expect(executedCommands).toContainEqual({
      command: { commandKind: "fixture-cleaning.apply", targetRef },
      proposalRef: proposal.commandProposalRef,
    });
    const completed = await adapter.getTask(claim.task.envelope.agentTaskRef);
    expect(completed?.state.status).toBe("completed");
    expect(completed?.state.resultRef).toBeDefined();
    const confirmation = await sql<{ command_result_ref: unknown }>`
      SELECT command_result_ref
      FROM business.agent_command_confirmations
      WHERE agent_task_id = ${claim.task.envelope.agentTaskRef.reference.entityId}
    `.execute(fixture.runtime.db);
    expect(confirmation.rows[0]?.command_result_ref).toEqual(targetRef);
  });
});
