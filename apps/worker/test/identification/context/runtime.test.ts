import { describe, expect, it, vi } from "vitest";

import type { AuthorizationContextV1 } from "@riskflow/contracts/ports";

import {
  AgentRuntimeError,
  AgentTaskDefinitionRegistry,
  emptyAgentBudgetUsage,
  type AgentBudgetUsageV1,
  type AgentTaskActionV1,
  type AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import type { ArtifactRefV1 } from "@riskflow/core/artifacts";
import { RetrievalReviewCandidateSetV1Schema } from "@riskflow/core/identification/context";
import type { ModelGatewayPortV1, StructuredCompletionRequestV1 } from "@riskflow/core/model";
import type { AgentTaskExecutionStoreV1 } from "@riskflow/adapters/agent-runtime";

import { AgentRuntimeRunner } from "../../../src/agent-runtime/index.js";
import {
  interpretRetrievalReviewModelStep,
  renderRetrievalReviewModelStep,
  withRetrievalReviewModelStep,
} from "../../../src/identification/context/index.js";

import {
  ACTOR,
  PROJECT,
  SYNTHETIC_SAMPLE_NOTICE,
  TIMESTAMP,
  candidateMember,
  candidateSetValue,
  makeServiceHarness,
  memberRef,
  reviewPolicy,
  segmentEvidence,
  taskRef,
  taskSnapshot,
  versionRef,
} from "./fixture.js";

const submission = (candidateSetRef: ArtifactRefV1) => ({
  kind: "submit-retrieval-review",
  increment: {
    schemaVersion: "1",
    candidateVersion: 1,
    candidateSetRef,
    operations: [
      {
        operation: "select",
        memberRef: candidateSetValue()["members"][0]!["memberRef"],
        evidence: [segmentEvidence("segment-standard")],
        rationaleCode: "supporting-standard",
      },
    ],
  },
});

const outOfFrozenSubmission = (candidateSetRef: ArtifactRefV1) => ({
  kind: "submit-retrieval-review",
  increment: {
    schemaVersion: "1",
    candidateVersion: 1,
    candidateSetRef,
    operations: [
      {
        operation: "select",
        memberRef: memberRef("entry-unknown", versionRef("release-standard-library")),
        evidence: [segmentEvidence("segment-standard")],
        rationaleCode: "supporting-standard",
      },
    ],
  },
});

const makeGateway = (...values: readonly unknown[]) => {
  let index = 0;
  const completeStructured = vi.fn(async (request: StructuredCompletionRequestV1) => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    if (value instanceof Error) throw value;
    return {
      schemaVersion: "1" as const,
      invocationId: request.invocationId,
      modelDeploymentRef: request.modelDeploymentRef,
      serverBuildRef: versionRef("server-build"),
      modelVersionRef: versionRef("model-version"),
      usage: { available: true, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      rawResponseRef: {
        kind: "diagnostic-artifact" as const,
        reference: versionRef("raw-model-response"),
      },
      promptTemplateRef: request.promptTemplateRef,
      outputSchemaRef: request.outputSchemaRef,
      value,
      finishReason: "stop" as const,
    };
  });
  return { completeStructured, port: { completeStructured } as unknown as ModelGatewayPortV1 };
};

const makeStore = (task: AgentTaskSnapshotV1) => {
  const calls: string[] = [];
  const candidates: { readonly disposition: string; readonly candidateVersion: number }[] = [];
  const actionFailures: string[] = [];
  let claimed = true;
  const store = {
    calls,
    candidates,
    actionFailures,
    async claim() {
      calls.push("claim");
      if (!claimed) return undefined;
      claimed = false;
      return {
        task,
        attemptNumber: 1,
        workerId: "worker-1",
        leaseToken: "lease-1",
        leaseUntil: TIMESTAMP,
      };
    },
    async verifyWorker() {
      calls.push("verify");
    },
    async heartbeat() {
      calls.push("heartbeat");
      return TIMESTAMP;
    },
    async reserveAction(input: {
      readonly actionId: string;
      readonly reservationId: string;
      readonly actionType: AgentTaskActionV1["actionType"];
      readonly amount?: Partial<AgentBudgetUsageV1>;
    }) {
      calls.push("reserve");
      const amount = { ...emptyAgentBudgetUsage(), ...(input.amount ?? {}) };
      if (input.actionType === "model-invocation") amount.modelInvocations = 1;
      if (input.actionType === "domain-tool") amount.toolInvocations = 1;
      return {
        task,
        reservation: {
          schemaVersion: "1" as const,
          reservationId: input.reservationId,
          actionId: input.actionId,
          amount,
          concurrency: 1,
          reservedAt: TIMESTAMP,
        },
      };
    },
    async findAction() {
      return undefined;
    },
    async recordCandidate(input: {
      readonly candidate: { readonly disposition: string; readonly candidateVersion: number };
    }) {
      calls.push("candidate");
      candidates.push({
        disposition: input.candidate.disposition,
        candidateVersion: input.candidate.candidateVersion,
      });
    },
    async completeAction() {
      calls.push("complete-action");
      return task;
    },
    async completeTask() {
      calls.push("complete-task");
      return task;
    },
    async failAction(input: { readonly error: { readonly code: string } }) {
      calls.push("fail");
      actionFailures.push(input.error.code);
      return task;
    },
    async releaseLease() {
      calls.push("release");
    },
    async failTask() {
      calls.push("fail-task");
      return task;
    },
  };
  return store as unknown as AgentTaskExecutionStoreV1 & {
    readonly calls: string[];
    readonly candidates: { readonly disposition: string; readonly candidateVersion: number }[];
    readonly actionFailures: string[];
  };
};

const setup = async (options: {
  readonly script: (candidateSetRef: ArtifactRefV1) => readonly unknown[];
  readonly verifyCurrent?: () => Promise<AuthorizationContextV1>;
}) => {
  const harness = makeServiceHarness(
    options.verifyCurrent === undefined ? {} : { verifyCurrent: options.verifyCurrent as never },
  );
  const candidateSetRef = await harness.putValue(
    `retrieval-review-candidate-set-${taskRef().reference.entityId}`,
    RetrievalReviewCandidateSetV1Schema.parse(candidateSetValue()),
  );
  const task = taskSnapshot(candidateSetRef);
  const persisted: {
    readonly actionId: string;
    readonly purposeCode: string;
    readonly value: unknown;
  }[] = [];
  const persistArtifact = vi.fn(
    async (input: {
      readonly actionId: string;
      readonly purposeCode: string;
      readonly value: unknown;
    }) => {
      persisted.push(input);
      const artifactRef: ArtifactRefV1 = {
        kind: "content-artifact",
        reference: {
          entityId: `${input.actionId}:${input.purposeCode}`,
          versionId: `sha256:${"f".repeat(64)}`,
        },
      };
      return artifactRef;
    },
  );
  const definition = harness.service.createTaskDefinition();
  const modelStep = withRetrievalReviewModelStep({
    policy: harness.service.reviewPolicy,
    persistArtifact,
    now: () => TIMESTAMP,
  });
  const store = makeStore(task);
  const gateway = makeGateway(...options.script(candidateSetRef));
  const runner = new AgentRuntimeRunner({
    store,
    registry: new AgentTaskDefinitionRegistry([definition]),
    workerId: "worker-1",
    leaseDurationMs: 30_000,
    maxConcurrentTasks: 1,
    modelGateway: gateway.port,
    renderModelStep: modelStep.renderModelStep,
    interpretModelStep: modelStep.interpretModelStep,
    persistArtifact,
    now: () => TIMESTAMP,
  });
  return { harness, candidateSetRef, task, persisted, store, gateway, runner, modelStep };
};

describe("C21 retrieval review model step", () => {
  it("renders only the frozen candidate set reference and routes tool intents to frozen tools", async () => {
    const policy = reviewPolicy();
    const persistArtifact = vi.fn();
    const task = taskSnapshot();
    const step = renderRetrievalReviewModelStep(
      { policy, persistArtifact: persistArtifact as never },
      task,
      {},
    );
    expect(step.maxOutputTokens).toBe(policy.modelMaxOutputTokens);
    expect(step.domainTool).toBeUndefined();
    expect(step.messages).toHaveLength(2);
    expect(JSON.parse(step.messages[1]!.content)).toEqual({
      frozenCandidateSetRef: task.envelope.frozenInputRef,
    });

    const readAction = {
      kind: "read-frozen-result",
      candidateSetRef: task.envelope.frozenInputRef,
      queryResultRef: candidateSetValue()["baselineQueryResultRef"],
      maxMembers: 4,
    };
    const readOutcome = await interpretRetrievalReviewModelStep(
      { policy, persistArtifact: persistArtifact as never },
      {
        schemaVersion: "1",
        invocationId: "action-1",
        modelDeploymentRef: versionRef("model-deployment"),
        serverBuildRef: versionRef("server-build"),
        modelVersionRef: versionRef("model-version"),
        usage: { available: true, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        rawResponseRef: {
          kind: "diagnostic-artifact",
          reference: versionRef("raw-model-response"),
        },
        promptTemplateRef: versionRef("prompt-template"),
        outputSchemaRef: versionRef("increment-schema"),
        value: readAction,
        finishReason: "stop",
      } as never,
      task,
    );
    expect(readOutcome).toMatchObject({
      kind: "tool-request",
      toolRef: policy.readFrozenResultToolRef,
    });

    const resupplementOutcome = await interpretRetrievalReviewModelStep(
      { policy, persistArtifact: persistArtifact as never },
      {
        schemaVersion: "1",
        invocationId: "action-2",
        modelDeploymentRef: versionRef("model-deployment"),
        serverBuildRef: versionRef("server-build"),
        modelVersionRef: versionRef("model-version"),
        usage: { available: true, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        rawResponseRef: {
          kind: "diagnostic-artifact",
          reference: versionRef("raw-model-response"),
        },
        promptTemplateRef: versionRef("prompt-template"),
        outputSchemaRef: versionRef("increment-schema"),
        value: {
          kind: "bounded-hybrid-resupplement",
          candidateSetRef: task.envelope.frozenInputRef,
          supplementIntentCode: "settlement",
          anchorEntryIds: [candidateMember()["sourceEntryId"]],
        },
        finishReason: "stop",
      } as never,
      task,
    );
    expect(resupplementOutcome).toMatchObject({
      kind: "tool-request",
      toolRef: policy.resupplementToolRef,
    });

    await expect(
      interpretRetrievalReviewModelStep(
        { policy, persistArtifact: persistArtifact as never },
        {
          schemaVersion: "1",
          invocationId: "action-3",
          modelDeploymentRef: versionRef("model-deployment"),
          serverBuildRef: versionRef("server-build"),
          modelVersionRef: versionRef("model-version"),
          usage: { available: true, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          rawResponseRef: {
            kind: "diagnostic-artifact",
            reference: versionRef("raw-model-response"),
          },
          promptTemplateRef: versionRef("prompt-template"),
          outputSchemaRef: versionRef("increment-schema"),
          value: { kind: "apply-patch", path: "/operations/-" },
          finishReason: "stop",
        } as never,
        task,
      ),
    ).rejects.toBeInstanceOf(AgentRuntimeError);
  });

  it("drives a bounded submit through validation and finalization into one formal artifact set", async () => {
    const { harness, persisted, store, runner } = await setup({
      script: (candidateSetRef) => [submission(candidateSetRef)],
    });
    expect(await runner.runOnce()).toBe(1);

    // 候选与增量各落一份 JSON 工件，正文只经 C08 与 C04。
    const purposes = persisted
      .filter(
        (entry) =>
          entry.purposeCode === "agent-candidate" || entry.purposeCode === "agent-increment",
      )
      .map((entry) => entry.purposeCode)
      .sort();
    expect(purposes).toEqual(["agent-candidate", "agent-increment"]);
    expect(store.candidates).toEqual([{ disposition: "completed", candidateVersion: 1 }]);
    expect(store.calls).toContain("complete-task");
    expect(store.actionFailures).toEqual([]);

    // C21 登记表只有一行正式检索工件集，且与 C08 完成引用一致。
    const reviewed = [...harness.rows.values()].filter(
      (row) => row["resultKind"] === "reviewed-retrieval",
    );
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0]!["retrievalArtifactSetRef"]).toMatchObject({
      kind: "retrieval-artifact-set",
      reference: { entityId: `retrieval-review:${taskRef().reference.entityId}` },
    });
    expect(harness.auditRows).toHaveLength(1);
    expect(SYNTHETIC_SAMPLE_NOTICE).toBe("合成样本、待甲方复核");
  });

  it("rejects out-of-frozen candidates with a terminal class and never writes a formal artifact set", async () => {
    const { harness, store, runner } = await setup({
      script: (candidateSetRef) => [outOfFrozenSubmission(candidateSetRef)],
    });
    expect(await runner.runOnce()).toBe(1);
    expect(store.actionFailures).toEqual(["AGENT_VALIDATION_REJECTED"]);
    expect(store.calls).not.toContain("complete-task");
    expect(
      [...harness.rows.values()].filter((row) => row["resultKind"] === "reviewed-retrieval"),
    ).toHaveLength(0);
    expect(harness.auditRows).toHaveLength(0);
  });

  it("does not fabricate a formal result when authorization is revoked before finalization", async () => {
    const { harness, store, runner } = await setup({
      script: (candidateSetRef) => [submission(candidateSetRef)],
      verifyCurrent: async () => undefined as never,
    });
    expect(await runner.runOnce()).toBe(1);
    expect(store.actionFailures).toEqual(["AGENT_VALIDATION_REJECTED"]);
    expect(
      [...harness.rows.values()].filter((row) => row["resultKind"] === "reviewed-retrieval"),
    ).toHaveLength(0);
    expect(harness.auditRows).toHaveLength(0);
    void ACTOR;
    void PROJECT;
  });
});
