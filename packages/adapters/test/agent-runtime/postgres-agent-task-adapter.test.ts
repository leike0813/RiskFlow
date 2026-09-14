import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";

import {
  AgentCommandProposalV1Schema,
  AgentTaskDefinitionRegistry,
  buildCompletedAgentTaskResult,
  type AgentTaskFailureEvidenceReadRequestV1,
} from "@riskflow/core/agent-runtime";
import { ArtifactPutCommandV1Schema } from "@riskflow/core/artifacts";
import { z } from "@riskflow/core/model";
import type {
  AgentTaskRefV1,
  AgentTaskTypeV1,
  AuthorizationContextV1,
  ModuleErrorV1,
} from "@riskflow/contracts/ports";

import { PostgresAgentTaskAdapter } from "../../src/agent-runtime/index.js";
import {
  bootstrapInitialSystemAdministrator,
  createPostgresLocalIdentityAccess,
  type PostgresLocalIdentityAccess,
} from "../../src/auth/index.js";
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
const cancelAuthorization = {
  ...authorization,
  grantedCapabilities: ["agent-task.cancel"] as const,
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
    measureCandidateUsage: () => ({ candidates: 1, objects: 1 }),
    validateCandidate: () => ({
      schemaVersion: "1",
      items: [],
      disposition: "accepted",
      validationArtifactRef: artifact("diagnostic-artifact", "validation"),
      validatedAt: "2030-01-01T00:00:00.000Z",
    }),
    finalizeCandidate: (_candidate, context) =>
      buildCompletedAgentTaskResult(
        context.envelope.agentTaskRef,
        artifact("content-artifact", "cleaned-result"),
      ),
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
const READ_BRANCH = "agent-task.read-failure-evidence";
const READ_CLOCK = "2030-01-01T00:00:00.000Z";
const READ_REQUESTED_AT = "2030-01-01T00:50:00.000Z";
const HMAC_KEY = new Uint8Array(32).fill(7);
const adminPassword = "admin-password-v1";
const adminPasswordChanged = "admin-password-changed-v1";
const managerPassword = "manager-password-v1";
const managerPasswordChanged = "manager-password-changed-v1";

describe("postgres agent runtime adapter", () => {
  let fixture: ArtifactTestFixture;
  let adapter: PostgresAgentTaskAdapter;
  let readerAdapter: PostgresAgentTaskAdapter;
  let access: PostgresLocalIdentityAccess | undefined;
  let managerAccountId: string | undefined;
  let managerSessionToken: string | undefined;
  let terminalFailureTaskRef: AgentTaskRefV1 | undefined;
  let cancelledTaskRef: AgentTaskRefV1 | undefined;

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
    const clock = () => new Date(READ_CLOCK);
    await bootstrapInitialSystemAdministrator({
      connection: fixture.postgres.migrator,
      loginName: "admin001",
      displayName: "Initial administrator",
      password: adminPassword,
      accountId: "account-admin",
      now: clock,
    });
    access = createPostgresLocalIdentityAccess({
      ...fixture.postgres.app,
      hmacKey: HMAC_KEY,
      keyVersion: "key-v1",
      now: clock,
    });
    const admin = await access.login({
      kind: "login",
      loginAttemptId: "login-admin",
      loginName: "admin001",
      password: adminPassword,
    });
    const changedAdmin = await access.changePassword({
      kind: "change-password",
      sessionToken: admin.sessionToken,
      newPassword: adminPasswordChanged,
    });
    const manager = await access.administerIdentity({
      kind: "create-account",
      commandId: "command-create-read-manager",
      idempotencyKey: "idem-create-read-manager",
      expectedVersion: "none",
      authorizationContextRef: changedAdmin.systemAdministrationContextRef!,
      loginName: "manager001",
      displayName: "Risk manager",
      password: managerPassword,
    });
    managerAccountId = manager.resultRef.entityId;
    for (const [projectId, commandId] of [
      ["project-1", "command-open-read-project-one"],
      ["project-2", "command-open-read-project-two"],
    ] as const) {
      await access.administerProject({
        kind: "open-project",
        projectId,
        commandId,
        idempotencyKey: `idem-${commandId}`,
        expectedVersion: "none",
        authorizationContextRef: changedAdmin.systemAdministrationContextRef!,
        initialRiskManagerAccountId: managerAccountId,
      });
    }
    const managerLogin = await access.login({
      kind: "login",
      loginAttemptId: "login-manager",
      loginName: "manager001",
      password: managerPassword,
    });
    const changedManager = await access.changePassword({
      kind: "change-password",
      sessionToken: managerLogin.sessionToken,
      newPassword: managerPasswordChanged,
    });
    managerSessionToken = changedManager.sessionToken;
    readerAdapter = new PostgresAgentTaskAdapter({
      db: fixture.runtime.db,
      registry: definition,
      transactionUnit: fixture.transactionUnit,
      artifactStore: fixture.store,
      referenceGuard: fixture.registry,
      authorization: access,
    });
  }, 180_000);

  afterAll(async () => {
    await access?.close().catch(() => undefined);
    await fixture?.close();
  });

  /** C06 把授权上下文的 invocationId 绑定到读取请求，读取前为每个 requestId 取得新鲜授权。 */
  const readAuthorizationFor = async (
    requestId: string,
    projectId = "project-1",
  ): Promise<AuthorizationContextV1> => {
    const decision = await access!.authorize({
      invocation: { kind: "human-session", sessionToken: managerSessionToken! },
      invocationId: requestId,
      projectId,
      branch: READ_BRANCH,
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
    });
    return decision.context;
  };

  const readRequest = async (
    requestId: string,
    overrides: {
      readonly projectId?: string;
      readonly actorId?: string;
      readonly requestedAt?: string;
      readonly taskRef?: AgentTaskRefV1;
      readonly expectedTaskType?: AgentTaskTypeV1;
      readonly authorization?: AuthorizationContextV1;
    } = {},
  ): Promise<AgentTaskFailureEvidenceReadRequestV1> => {
    const projectId = overrides.projectId ?? "project-1";
    return {
      projectId,
      actorId: overrides.actorId ?? managerAccountId!,
      requestId,
      requestedAt: overrides.requestedAt ?? READ_REQUESTED_AT,
      taskRef: overrides.taskRef ?? terminalFailureTaskRef!,
      expectedTaskType: overrides.expectedTaskType ?? "data-cleaning",
      authorization: overrides.authorization ?? (await readAuthorizationFor(requestId, projectId)),
    };
  };

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
        parentCandidateVersion: 0,
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

  it("reads terminal-failure evidence and preserves committed budget and references", async () => {
    const started = await adapter.startTask({
      ...startCommand,
      commandId: "command-read-terminal",
      idempotencyKey: "idempotency-read-terminal",
    });
    expect(started.kind).toBe("succeeded");
    if (started.kind !== "succeeded") return;
    const taskRef = started.result.agentTaskRef;
    terminalFailureTaskRef = taskRef;
    const claim = await adapter.claim({
      workerId: "worker-read-terminal",
      leaseDurationMs: 30_000,
      now: "2030-01-01T00:10:00.000Z",
    });
    expect(claim?.task.envelope.agentTaskRef).toEqual(taskRef);
    if (claim === undefined) return;
    const intent = await putArtifact("read-intent", "diagnostic", "agent-action-intent");
    const actionResult = await putArtifact(
      "read-action-result",
      "diagnostic",
      "agent-action-result",
    );
    const outputOne = await putArtifact("read-output-1", "content", "agent-candidate");
    const outputTwo = await putArtifact("read-output-2", "content", "agent-candidate");
    const incrementOne = await putArtifact("read-increment-1", "diagnostic", "agent-increment");
    const incrementTwo = await putArtifact("read-increment-2", "diagnostic", "agent-increment");
    const validationRef = await putArtifact("read-validation", "diagnostic", "agent-validation");
    const reserved = await adapter.reserveAction({
      taskRef,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      actionId: "action-read-1",
      reservationId: "reservation-read-1",
      actionType: "model-invocation",
      sequence: 1,
      idempotencyKey: "action-read-idempotency-1",
      intentArtifactRef: intent,
      amount: { inputTokens: 10 },
      now: "2030-01-01T00:10:01.000Z",
    });
    await adapter.completeAction({
      taskRef,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      actionId: "action-read-1",
      resultRef: outputOne,
      resultArtifactRef: actionResult,
      usage: { ...reserved.reservation.amount, inputTokens: 4 },
      activeWallClockMs: 1_000,
      now: "2030-01-01T00:10:02.000Z",
    });
    const secondReservation = await adapter.reserveAction({
      taskRef,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      actionId: "action-read-2",
      reservationId: "reservation-read-2",
      actionType: "deterministic-validation",
      sequence: 2,
      idempotencyKey: "action-read-idempotency-2",
      intentArtifactRef: intent,
      now: "2030-01-01T00:10:03.000Z",
    });
    await adapter.completeAction({
      taskRef,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      actionId: "action-read-2",
      resultRef: outputTwo,
      resultArtifactRef: actionResult,
      usage: secondReservation.reservation.amount,
      activeWallClockMs: 500,
      now: "2030-01-01T00:10:04.000Z",
    });
    for (const [candidateVersion, outputArtifact, incrementArtifact] of [
      [1, outputOne, incrementOne],
      [2, outputTwo, incrementTwo],
    ] as const) {
      await adapter.recordCandidate({
        candidate: {
          schemaVersion: "1",
          taskRef,
          candidateVersion,
          parentCandidateVersion: candidateVersion - 1,
          candidateArtifactRef: outputArtifact,
          incrementArtifactRef: incrementArtifact,
          validation: {
            schemaVersion: "1",
            items: [],
            disposition: "accepted",
            validationArtifactRef: validationRef,
            validatedAt: "2030-01-01T00:10:05.000Z",
          },
          disposition: "accepted",
          createdAt: "2030-01-01T00:10:05.000Z",
        },
        workerId: claim.workerId,
        leaseToken: claim.leaseToken,
      });
    }
    await adapter.failTask({
      taskRef,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      error: {
        schemaVersion: "1",
        code: "AGENT_VALIDATION_REJECTED",
        category: "validation",
        retryable: false,
        stage: "reader.terminal-failure",
        occurredAt: "2030-01-01T00:10:06.000Z",
      },
      now: "2030-01-01T00:10:06.000Z",
    });
    const snapshot = await adapter.getTask(taskRef);
    expect(snapshot?.state.status).toBe("terminal-failure");
    const read = await readerAdapter.readTerminalFailure(
      await readRequest("read-request-terminal"),
    );
    expect(read.kind).toBe("succeeded");
    if (read.kind !== "succeeded") return;
    expect(read.evidence.taskRef).toEqual(taskRef);
    expect(read.evidence.taskType).toBe("data-cleaning");
    expect(read.evidence.terminalStatus).toBe("terminal-failure");
    expect(read.evidence.error?.code).toBe("AGENT_VALIDATION_REJECTED");
    expect(read.evidence.usage).toEqual(snapshot?.budgetLedger.used);
    expect(read.evidence.usage.modelInvocations).toBe(1);
    expect(read.evidence.usage.inputTokens).toBe(4);
    expect(read.evidence.actionRefs).toEqual([
      { entityId: "action-read-1", versionId: "1" },
      { entityId: "action-read-2", versionId: "2" },
    ]);
    expect(read.evidence.candidateArtifactRefs).toEqual([outputOne, outputTwo]);
    expect(read.evidence.validationArtifactRefs).toEqual([validationRef]);
    expect(Object.keys(read.evidence).sort()).toEqual([
      "actionRefs",
      "candidateArtifactRefs",
      "error",
      "taskRef",
      "taskType",
      "terminalStatus",
      "usage",
      "validationArtifactRefs",
    ]);
    const serialized = JSON.stringify(read.evidence);
    for (const marker of [
      "envelope",
      "frozen",
      "intentArtifactRef",
      "incrementArtifactRef",
      "modelResponse",
      "authorizationContextRef",
    ]) {
      expect(serialized).not.toContain(marker);
    }
  });

  it("reads cancelled evidence with its cancel reason and committed references", async () => {
    const started = await adapter.startTask({
      ...startCommand,
      commandId: "command-read-cancelled",
      idempotencyKey: "idempotency-read-cancelled",
    });
    expect(started.kind).toBe("succeeded");
    if (started.kind !== "succeeded") return;
    const taskRef = started.result.agentTaskRef;
    cancelledTaskRef = taskRef;
    const claim = await adapter.claim({
      workerId: "worker-read-cancelled",
      leaseDurationMs: 30_000,
      now: "2030-01-01T00:20:00.000Z",
    });
    expect(claim?.task.envelope.agentTaskRef).toEqual(taskRef);
    if (claim === undefined) return;
    const intent = await putArtifact("cancel-intent", "diagnostic", "agent-action-intent");
    const actionResult = await putArtifact(
      "cancel-action-result",
      "diagnostic",
      "agent-action-result",
    );
    const output = await putArtifact("cancel-output", "content", "agent-candidate");
    const increment = await putArtifact("cancel-increment", "diagnostic", "agent-increment");
    const validationRef = await putArtifact("cancel-validation", "diagnostic", "agent-validation");
    const reserved = await adapter.reserveAction({
      taskRef,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      actionId: "action-cancel-1",
      reservationId: "reservation-cancel-1",
      actionType: "model-invocation",
      sequence: 1,
      idempotencyKey: "action-cancel-idempotency-1",
      intentArtifactRef: intent,
      now: "2030-01-01T00:20:01.000Z",
    });
    await adapter.completeAction({
      taskRef,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      actionId: "action-cancel-1",
      resultRef: output,
      resultArtifactRef: actionResult,
      usage: { ...reserved.reservation.amount, modelInvocations: 1 },
      activeWallClockMs: 250,
      now: "2030-01-01T00:20:02.000Z",
    });
    await adapter.recordCandidate({
      candidate: {
        schemaVersion: "1",
        taskRef,
        candidateVersion: 1,
        parentCandidateVersion: 0,
        candidateArtifactRef: output,
        incrementArtifactRef: increment,
        validation: {
          schemaVersion: "1",
          items: [],
          disposition: "accepted",
          validationArtifactRef: validationRef,
          validatedAt: "2030-01-01T00:20:03.000Z",
        },
        disposition: "accepted",
        createdAt: "2030-01-01T00:20:03.000Z",
      },
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
    });
    const cancelled = await adapter.cancelTask({
      kind: "cancel-task",
      commandId: "command-read-cancel",
      idempotencyKey: "idempotency-read-cancel",
      projectId: authorization.projectId,
      actorId: authorization.actorId,
      issuedAt: "2030-01-01T00:20:04.000Z",
      authorization: cancelAuthorization,
      payload: { agentTaskRef: taskRef, reasonCode: "user-request" },
    });
    expect(cancelled.kind).toBe("succeeded");
    const snapshot = await adapter.getTask(taskRef);
    expect(snapshot?.state.status).toBe("cancelled");
    const read = await readerAdapter.readTerminalFailure(
      await readRequest("read-request-cancelled", { taskRef }),
    );
    expect(read.kind).toBe("succeeded");
    if (read.kind !== "succeeded") return;
    expect(read.evidence.terminalStatus).toBe("cancelled");
    expect(read.evidence.cancelReasonCode).toBe("user-request");
    expect(read.evidence.error).toBeUndefined();
    expect(read.evidence.usage).toEqual(snapshot?.budgetLedger.used);
    expect(read.evidence.usage.modelInvocations).toBe(1);
    expect(read.evidence.actionRefs).toEqual([{ entityId: "action-cancel-1", versionId: "1" }]);
    expect(read.evidence.candidateArtifactRefs).toEqual([output]);
    expect(read.evidence.validationArtifactRefs).toEqual([validationRef]);
  });

  it("keeps every non-enumerable failure boundary in one denial shape", async () => {
    expect(terminalFailureTaskRef).toBeDefined();
    const pending = await adapter.startTask({
      ...startCommand,
      commandId: "command-read-pending",
      idempotencyKey: "idempotency-read-pending",
    });
    expect(pending.kind).toBe("succeeded");
    if (pending.kind !== "succeeded") return;
    const pendingRef = pending.result.agentTaskRef;
    const knownRef = terminalFailureTaskRef!;
    const forgedSource = await readAuthorizationFor("read-forged-context-source");
    const cases = [
      {
        name: "unknown task",
        request: await readRequest("read-deny-unknown", {
          taskRef: {
            ...knownRef,
            reference: { entityId: "agent-task:project-1:missing", versionId: "1" },
          },
        }),
      },
      {
        name: "cross project target",
        request: await readRequest("read-deny-cross-project", {
          projectId: "project-2",
          taskRef: knownRef,
        }),
      },
      {
        name: "drifted exact task reference",
        request: await readRequest("read-deny-drifted-ref", {
          taskRef: { ...knownRef, promptTemplateRef: ref("other-prompt") },
        }),
      },
      {
        name: "wrong expected task type",
        request: await readRequest("read-deny-expected-type", {
          expectedTaskType: "knowledge-authoring",
        }),
      },
      {
        name: "non-terminal task",
        request: await readRequest("read-deny-non-terminal", { taskRef: pendingRef }),
      },
      {
        name: "capability without read",
        request: await readRequest("read-deny-capability", {
          authorization: { ...forgedSource, grantedCapabilities: ["agent-task.confirm"] },
        }),
      },
      {
        name: "unregistered authorization context",
        request: await readRequest("read-deny-context", {
          authorization: {
            ...forgedSource,
            authorizationContextRef: {
              kind: "authorization-context",
              reference: ref("missing-authorized-context"),
            },
          },
        }),
      },
      {
        name: "missing verifier",
        request: await readRequest("read-deny-verifier"),
        reader: adapter,
      },
    ] as const;
    const denials: ModuleErrorV1[] = [];
    for (const testCase of cases) {
      const reader = "reader" in testCase ? testCase.reader : readerAdapter;
      const result = await reader.readTerminalFailure(testCase.request);
      expect(result.kind, testCase.name).toBe("failed");
      if (result.kind !== "failed") continue;
      denials.push(result.error);
    }
    expect(denials).toHaveLength(cases.length);
    for (const denial of denials) {
      expect(denial).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        category: "authorization",
        retryable: false,
        requiredCapability: "agent-task.read",
      });
      const serialized = JSON.stringify(denial);
      for (const marker of [
        knownRef.reference.entityId,
        pendingRef.reference.entityId,
        "terminal-failure",
        "cancelled",
        "data-cleaning",
      ]) {
        expect(serialized).not.toContain(marker);
      }
    }
    const shapes = denials.map((denial) =>
      JSON.stringify({ ...denial, occurredAt: "normalized", causalRunId: "normalized" }),
    );
    expect(new Set(shapes).size).toBe(1);

    const claim = await adapter.claim({
      workerId: "worker-read-cleanup",
      leaseDurationMs: 30_000,
      now: "2030-01-01T00:30:00.000Z",
    });
    expect(claim?.task.envelope.agentTaskRef).toEqual(pendingRef);
    if (claim === undefined) return;
    await adapter.failTask({
      taskRef: pendingRef,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      error: {
        schemaVersion: "1",
        code: "AGENT_VALIDATION_REJECTED",
        category: "validation",
        retryable: false,
        stage: "reader.pending-cleanup",
        occurredAt: "2030-01-01T00:30:01.000Z",
      },
      now: "2030-01-01T00:30:01.000Z",
    });
    expect((await adapter.getTask(pendingRef))?.state.status).toBe("terminal-failure");
  });

  it("closes successful reads with one receipt, one audit entry, and no outbox event", async () => {
    const otherProjectStart = await adapter.startTask({
      ...startCommand,
      commandId: "command-read-project-two",
      idempotencyKey: "idempotency-read-project-two",
      projectId: "project-2",
      authorization: { ...authorization, projectId: "project-2" },
    });
    expect(otherProjectStart.kind).toBe("succeeded");
    if (otherProjectStart.kind !== "succeeded") return;
    const projectTwoTaskRef = otherProjectStart.result.agentTaskRef;
    const otherProjectClaim = await adapter.claim({
      workerId: "worker-read-project-two",
      leaseDurationMs: 30_000,
      now: "2030-01-01T00:40:00.000Z",
    });
    expect(otherProjectClaim?.task.envelope.agentTaskRef).toEqual(projectTwoTaskRef);
    if (otherProjectClaim === undefined) return;
    await adapter.failTask({
      taskRef: projectTwoTaskRef,
      workerId: otherProjectClaim.workerId,
      leaseToken: otherProjectClaim.leaseToken,
      error: {
        schemaVersion: "1",
        code: "AGENT_VALIDATION_REJECTED",
        category: "validation",
        retryable: false,
        stage: "reader.project-two",
        occurredAt: "2030-01-01T00:40:01.000Z",
      },
      now: "2030-01-01T00:40:01.000Z",
    });
    expect((await adapter.getTask(projectTwoTaskRef))?.state.status).toBe("terminal-failure");

    const requestId = "read-request-idempotent";
    const request = await readRequest(requestId);
    const first = await readerAdapter.readTerminalFailure(request);
    expect(first.kind).toBe("succeeded");
    if (first.kind !== "succeeded") return;
    const initialReceipts = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.command_receipts WHERE command_kind = $1 AND idempotency_key = $2",
      ["agent-task.read-failure-evidence", requestId],
    );
    expect(initialReceipts.rows[0]?.count).toBe("1");
    const initialAudits = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit.entries WHERE action = $1 AND idempotency_key = $2",
      ["agent-task.read-failure-evidence", requestId],
    );
    expect(initialAudits.rows[0]?.count).toBe("1");
    const replay = await readerAdapter.readTerminalFailure(request);
    expect(replay).toEqual(first);
    const replayedReceipts = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.command_receipts WHERE command_kind = $1 AND idempotency_key = $2",
      ["agent-task.read-failure-evidence", requestId],
    );
    expect(replayedReceipts.rows[0]?.count).toBe("1");
    const replayedAudits = await fixture.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit.entries WHERE action = $1 AND idempotency_key = $2",
      ["agent-task.read-failure-evidence", requestId],
    );
    expect(replayedAudits.rows[0]?.count).toBe("1");
    const events = await fixture.postgres.adminPool.query<{ event_id: string }>(
      "SELECT event_id FROM outbox.events WHERE producer_command_id = $1",
      [requestId],
    );
    expect(events.rows).toHaveLength(0);

    const otherTarget = await readerAdapter.readTerminalFailure(
      await readRequest(requestId, { taskRef: cancelledTaskRef! }),
    );
    expect(otherTarget).toMatchObject({
      kind: "failed",
      error: { code: "IDEMPOTENCY_CONFLICT", category: "idempotency", retryable: false },
    });
    const otherType = await readerAdapter.readTerminalFailure(
      await readRequest(requestId, { expectedTaskType: "knowledge-authoring" }),
    );
    expect(otherType).toMatchObject({ kind: "failed", error: { code: "IDEMPOTENCY_CONFLICT" } });
    const sameRequestOtherProject = await readerAdapter.readTerminalFailure(
      await readRequest(requestId, { projectId: "project-2", taskRef: projectTwoTaskRef }),
    );
    expect(sameRequestOtherProject).toMatchObject({
      kind: "failed",
      error: {
        code: "IDEMPOTENCY_CONFLICT",
        category: "idempotency",
        retryable: false,
        idempotencyKey: requestId,
      },
    });
  });
});
