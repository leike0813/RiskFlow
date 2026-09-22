import { describe, expect, it, vi } from "vitest";

import { createHash } from "node:crypto";

import type { VersionReference } from "@riskflow/contracts/common";
import type { AuthorizationContextV1 } from "@riskflow/contracts/ports";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import { ArtifactPutCommandV1Schema, type ArtifactPutCommandV1 } from "@riskflow/core/artifacts";
import {
  RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1,
  type RiskCandidateEmbeddingRequestV1,
  type RiskCandidateModelRequestV1,
  type RiskCandidateRepairFeedbackV1,
  type RiskCandidateV1,
} from "@riskflow/core/identification/candidate-finalization";
import {
  ModelContextPayloadV1Schema,
  type ModelContextPayloadV1,
} from "@riskflow/core/identification/context";
import {
  makeModelGatewayError,
  type EmbeddingRequestV1,
  type ModelGatewayPortV1,
  type StructuredCompletionRequestV1,
} from "@riskflow/core/model";
import { ModelGatewayError } from "@riskflow/core/model";

import { createRiskCandidateModelRuntime } from "../../../src/identification/candidate-finalization/index.js";

/** 合成样本、待甲方复核 */
const SYNTHETIC_SAMPLE_NOTICE = "合成样本、待甲方复核";
const TIMESTAMP = "2030-01-01T00:00:00.000Z";
const DEADLINE = "2030-01-01T00:01:00.000Z";
const PROJECT = "project-c22";
const ACTOR = "actor-c22";
const NODE_ID = "node-current";
const INVOCATION = "identification-run-1:generate";

const versionRef = (entityId: string, versionId = "v1"): VersionReference => ({
  entityId,
  versionId,
});
const sha = (value: string): string => createHash("sha256").update(value).digest("hex");
const segmentEvidence = (sourceSegmentId: string) => ({
  locator: { sourceSegmentId },
  sourceVersion: versionRef("source-a"),
});
const releaseRef = (entityId: string) => ({
  kind: "knowledge-release" as const,
  reference: versionRef(entityId),
});

const MODEL_DEPLOYMENT = versionRef("model-deployment");
const PROMPT_TEMPLATE = versionRef("prompt-template");
const OUTPUT_SCHEMA = versionRef("risk-candidate-output-schema");
const BUDGET_POLICY = versionRef("generation-budget-policy");
const EMBEDDING_DEPLOYMENT = versionRef("embedding-deployment");
const RAW_RESPONSE = {
  kind: "diagnostic-artifact" as const,
  reference: versionRef("raw-response"),
};

const authorization = (): AuthorizationContextV1 =>
  ({
    schemaVersion: "1",
    authorizationContextRef: {
      kind: "authorization-context",
      reference: versionRef("authorization-context-c22"),
    },
    actorId: ACTOR,
    projectId: PROJECT,
    grantedCapabilities: ["risk-identification.run"],
    spatialScopeRefs: [{ kind: "spatial-scope", reference: versionRef("spatial-scope") }],
    sourceAccessGrantRefs: [
      { kind: "source-access-grant", reference: versionRef("source-access-grant") },
    ],
    authorizationPolicyRef: versionRef("access-policy"),
    decidedAt: TIMESTAMP,
    invocation: { kind: "system", systemActorId: ACTOR, reasonCode: "c22-worker-test" },
    causalRunRef: { kind: "workflow-run", reference: versionRef("workflow-run") },
  }) as AuthorizationContextV1;

/** 合成五项 C21 上下文：五组依据齐全，正文只出现在 C04，运行时只投影这五项。 */
const modelContext = (): ModelContextPayloadV1 =>
  ModelContextPayloadV1Schema.parse({
    schemaVersion: "1",
    projectId: PROJECT,
    nodeId: NODE_ID,
    inputSnapshotRef: {
      kind: "identification-input-snapshot",
      reference: versionRef("input-snapshot"),
    },
    workItemRef: { kind: "identification-work-item", reference: versionRef("work-item") },
    policySetRef: { kind: "identification-policy-set", reference: versionRef("policy-set") },
    releaseBinding: {
      processModelReleaseRef: releaseRef("release-process-model"),
      processModelPackageDigest: sha("process-model-package"),
      riskMechanismReleaseRef: releaseRef("release-risk-mechanism"),
      riskMechanismPackageDigest: sha("risk-mechanism-package"),
      retrievalEvidenceBaseReleaseRef: releaseRef("release-evidence-base"),
      retrievalEvidenceBasePackageDigest: sha("evidence-base-package"),
      compositeMemberReleaseRefs: [
        releaseRef("release-composite-a"),
        releaseRef("release-composite-b"),
        releaseRef("release-composite-c"),
      ],
    },
    relationshipQueryResultRef: {
      kind: "knowledge-query-result",
      reference: versionRef("relationship-query-result"),
    },
    baselineQueryResultRef: {
      kind: "knowledge-query-result",
      reference: versionRef("baseline-query-result"),
    },
    retrievalArtifactSetRef: {
      kind: "retrieval-artifact-set",
      reference: versionRef("retrieval-artifact-set"),
    },
    reviewTaskRef: {
      kind: "agent-task",
      reference: versionRef("agent-task:retrieval-review"),
      taskType: "retrieval-review",
      triggerMode: "embedded",
      modelDeploymentRef: MODEL_DEPLOYMENT,
      promptTemplateRef: PROMPT_TEMPLATE,
      toolPolicyRef: versionRef("tool-policy"),
      budgetPolicyRef: versionRef("review-budget-policy"),
      incrementSchemaRef: versionRef("increment-schema"),
      validationPolicyRef: versionRef("review-validation-policy"),
    },
    reviewAgentPolicyRef: versionRef("retrieval-review-policy"),
    retrievalPolicyRef: versionRef("retrieval-policy"),
    processNode: {
      nodeId: NODE_ID,
      processKind: "变径空间扩挖",
      inputs: ["小盾构"],
      outputs: ["扩径模块"],
      adjacentTimeNodes: [
        {
          nodeId: "node-predecessor",
          processKind: "扩径准备",
          edgeId: "edge-predecessor",
          position: "predecessor",
          evidence: [segmentEvidence("segment-predecessor")],
        },
      ],
      evidence: [segmentEvidence("segment-node")],
    },
    stateParameters: {
      nodeId: NODE_ID,
      stateParameters: ["盾体直径"],
      monitoringIndicators: ["地表沉降"],
      evidence: [segmentEvidence("segment-state")],
    },
    forceDependencies: [
      {
        edgeId: "edge-force",
        fromNodeId: "node-force",
        toNodeId: NODE_ID,
        relationType: "受力依赖关系",
        evidence: [segmentEvidence("segment-force")],
      },
    ],
    mechanisms: [
      {
        mechanismId: "mechanism-face",
        mechanismType: "掌子面稳定性失效",
        stateParameters: ["盾体直径"],
        evidence: [segmentEvidence("segment-mechanism")],
      },
    ],
    retrievalEvidence: [
      {
        memberRef: {
          kind: "retrieval-member",
          reference: { entityId: "retrieval-member:standard:entry-standard", versionId: "v1" },
        },
        sourceKind: "standard-library",
        sourceReleaseRef: releaseRef("release-standard-library"),
        sourceEntryId: "entry-standard",
        evidence: [segmentEvidence("segment-standard")],
        rankingSignal: {
          rank: 1,
          fusionScore: 0.5,
          scoreSemantics: "ranking-signal-not-confidence",
        },
      },
    ],
    authorizationScopeDigest: sha("authorization-scope"),
    authorizationContextRef: {
      kind: "authorization-context",
      reference: versionRef("authorization-context-c22"),
    },
    assembledAt: TIMESTAMP,
  });

const modelOutput = (modelConfidence = 0.42) => ({
  riskSource: "盾体扩径",
  riskFactor: "掌子面稳定性失效",
  riskEvent: "扩径期间掌子面失稳",
  riskElementRelations: [
    { sourceElement: "扩径模块", relation: "作用于", targetElement: "掌子面" },
  ],
  evidenceLocator: { sourceSegmentId: "segment-standard" },
  modelConfidence,
});

const modelRequest = (
  overrides: Partial<RiskCandidateModelRequestV1> = {},
): RiskCandidateModelRequestV1 => ({
  projectId: PROJECT,
  actorId: ACTOR,
  invocationId: INVOCATION,
  requestedAt: TIMESTAMP,
  deadlineAt: DEADLINE,
  modelContext: modelContext(),
  modelDeploymentRef: MODEL_DEPLOYMENT,
  promptTemplateRef: PROMPT_TEMPLATE,
  outputSchemaRef: OUTPUT_SCHEMA,
  budgetPolicyRef: BUDGET_POLICY,
  budget: {
    maxCandidates: 8,
    maxOutputBytes: 65_536,
    maxTotalTokens: 4_096,
    maxRepairRounds: 2,
    maxWallClockMs: 60_000,
  },
  maxOutputTokens: 4_096,
  authorization: authorization(),
  ...overrides,
});

/** 运行时只读候选身份对；完整候选构造由 core 测试覆盖。 */
const parentCandidate = (candidateId: string, candidateVersion: number) =>
  ({ candidateId, candidateVersion }) as unknown as RiskCandidateV1;

const repairFeedback = (): RiskCandidateRepairFeedbackV1 => ({
  attempt: 1,
  parentCandidates: [parentCandidate("candidate-1", 1)],
  failures: [
    {
      candidateId: "candidate-1",
      candidateVersion: 1,
      checkId: "candidate.process-node-binding",
      reasonCode: "candidate-node-mismatch",
    },
  ],
  previousRawResponseRefs: [RAW_RESPONSE],
});

const structuredResult = (request: StructuredCompletionRequestV1, value: unknown) => ({
  schemaVersion: "1" as const,
  invocationId: request.invocationId,
  modelDeploymentRef: request.modelDeploymentRef,
  serverBuildRef: versionRef("server-build"),
  modelVersionRef: versionRef("model-version"),
  usage: { available: true, inputTokens: 11, outputTokens: 7, totalTokens: 18 },
  rawResponseRef: RAW_RESPONSE,
  promptTemplateRef: request.promptTemplateRef,
  outputSchemaRef: request.outputSchemaRef,
  value,
  finishReason: "stop" as const,
});

const makeArtifactStore = () => {
  const puts: { readonly command: ArtifactPutCommandV1; readonly text: string }[] = [];
  const store = {
    puts,
    put: async (command: ArtifactPutCommandV1, content: AsyncIterable<Uint8Array>) => {
      const parsed = ArtifactPutCommandV1Schema.parse(command);
      const decoder = new TextDecoder();
      let text = "";
      for await (const chunk of content) text += decoder.decode(chunk, { stream: true });
      puts.push({ command: parsed, text });
      return {
        artifactRef: {
          kind: "content-artifact" as const,
          reference: versionRef("risk-event-vector-artifact", `sha256:${"a".repeat(64)}`),
        },
      };
    },
    open: async () => {
      throw new Error("artifact read is not part of the RI-S57 runtime");
    },
  } as unknown as ArtifactStoreV1 & { readonly puts: typeof puts };
  return store;
};

const setup = (options: {
  readonly completeStructured: ModelGatewayPortV1["completeStructured"];
  readonly embed?: ModelGatewayPortV1["embed"];
}) => {
  const artifactStore = makeArtifactStore();
  const gateway = {
    completeStructured: options.completeStructured,
    embed:
      options.embed ??
      (async () => {
        throw new Error("embedding is not part of this scenario");
      }),
  } as Pick<ModelGatewayPortV1, "completeStructured" | "embed">;
  const runtime = createRiskCandidateModelRuntime({
    gateway,
    artifactStore,
    now: () => new Date("2030-01-01T00:00:30.000Z"),
  });
  return { runtime, artifactStore };
};

describe("C22 RI-S57 model runtime", () => {
  it("sends only the frozen request references and the five-part frozen context", async () => {
    const calls: StructuredCompletionRequestV1[] = [];
    const outputs = [modelOutput(), modelOutput(0.9)];
    const { runtime } = setup({
      completeStructured: (async (request) => {
        calls.push(request);
        return structuredResult(request, { candidates: outputs }) as never;
      }) as ModelGatewayPortV1["completeStructured"],
    });

    const context = modelContext();
    const outcome = await runtime.generateCandidates(modelRequest({ modelContext: context }));

    expect(calls).toHaveLength(1);
    const request = calls[0]!;
    expect(request.projectId).toBe(PROJECT);
    expect(request.actorId).toBe(ACTOR);
    expect(request.authorization).toEqual(authorization());
    expect(request.requiredCapability).toBe("risk-identification.run");
    expect(request.modelDeploymentRef).toEqual(MODEL_DEPLOYMENT);
    expect(request.promptTemplateRef).toEqual(PROMPT_TEMPLATE);
    expect(request.outputSchemaRef).toEqual(OUTPUT_SCHEMA);
    expect(request.budgetPolicyRef).toEqual(BUDGET_POLICY);
    expect(request.maxOutputTokens).toBe(4_096);
    expect(request.parentArtifactRefs).toEqual([]);
    expect(request.evidenceReferences).toEqual([]);
    expect(Date.parse(request.deadlineAt)).toBeGreaterThan(Date.parse(request.issuedAt));
    expect(request.idempotencyKey).toBe(`${INVOCATION}:generate`);

    // 消息只有固定指令与五项投影：上下文里的发布/授权引用不进模型请求。
    expect(request.messages).toHaveLength(2);
    expect(request.messages[0]!.role).toBe("system");
    expect(request.messages[1]!.role).toBe("user");
    expect(Object.keys(JSON.parse(request.messages[1]!.content)).sort()).toEqual([
      "forceDependencies",
      "mechanisms",
      "processNode",
      "retrievalEvidence",
      "stateParameters",
    ]);
    expect(JSON.parse(request.messages[1]!.content)).toEqual({
      processNode: context.processNode,
      stateParameters: context.stateParameters,
      forceDependencies: context.forceDependencies,
      mechanisms: context.mechanisms,
      retrievalEvidence: context.retrievalEvidence,
    });

    // 成功结果原样带回六字段内容：模型置信度不被任何排序分数替换。
    expect(outcome.kind).toBe("succeeded");
    if (outcome.kind !== "succeeded") throw new Error("generation must succeed");
    expect(outcome.outputs).toEqual(outputs);
    expect(outcome.outputs[0]!.modelConfidence).toBe(0.42);
    expect(outcome.invocationId).toBe(INVOCATION);
    expect(outcome.rawResponseRef).toEqual(RAW_RESPONSE);
    expect(outcome.usage.inputTokens).toBe(11);
    expect(outcome.usage.outputTokens).toBe(7);
    expect(outcome.usage.totalTokens).toBe(18);
    expect(outcome.usage.outputBytes).toBeGreaterThan(0);
    expect(outcome.elapsedMs).toBe(0);
    expect(SYNTHETIC_SAMPLE_NOTICE).toBe("合成样本、待甲方复核");
  });

  it("carries only structured repair feedback and parent candidate identities", async () => {
    const calls: StructuredCompletionRequestV1[] = [];
    const { runtime } = setup({
      completeStructured: (async (request) => {
        calls.push(request);
        return structuredResult(request, { candidates: [modelOutput()] }) as never;
      }) as ModelGatewayPortV1["completeStructured"],
    });

    const repair = repairFeedback();
    await runtime.generateCandidates(modelRequest({ repair }));

    const request = calls[0]!;
    expect(request.messages).toHaveLength(3);
    const repairMessage = JSON.parse(request.messages[2]!.content);
    expect(repairMessage.attempt).toBe(1);
    expect(repairMessage.failures).toEqual(repair.failures);
    expect(repairMessage.parentCandidates).toEqual([
      { candidateId: "candidate-1", candidateVersion: 1 },
    ]);
    expect(Object.keys(repairMessage).sort()).toEqual(["attempt", "failures", "parentCandidates"]);
  });

  it("maps a gateway error to a structured module error with the raw-response diagnostic", async () => {
    const { runtime } = setup({
      completeStructured: (async () => {
        throw new ModelGatewayError(
          makeModelGatewayError({
            code: "MODEL_SERVICE_UNAVAILABLE",
            retryable: true,
            stage: "model.structured.transport",
            occurredAt: TIMESTAMP,
            invocationId: INVOCATION,
            modelDeploymentRef: MODEL_DEPLOYMENT,
            rawResponseRef: RAW_RESPONSE,
          }),
        );
      }) as ModelGatewayPortV1["completeStructured"],
    });

    const outcome = await runtime.generateCandidates(modelRequest());
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("gateway failure must close the run");
    expect(outcome.error).toMatchObject({
      code: "TRANSIENT_FAILURE",
      category: "technical",
      retryable: true,
      stageCode: "model.structured.transport",
      causalRunId: INVOCATION,
      diagnosticRef: RAW_RESPONSE,
    });
  });

  it("surfaces an output-shape violation as a terminal failure instead of fewer candidates", async () => {
    const { runtime } = setup({
      completeStructured: (async () => {
        throw new ModelGatewayError(
          makeModelGatewayError({
            code: "MODEL_OUTPUT_SCHEMA_INVALID",
            retryable: false,
            stage: "model.structured.output-schema",
            occurredAt: TIMESTAMP,
            invocationId: INVOCATION,
            modelDeploymentRef: MODEL_DEPLOYMENT,
            rawResponseRef: RAW_RESPONSE,
          }),
        );
      }) as ModelGatewayPortV1["completeStructured"],
    });

    const outcome = await runtime.generateCandidates(modelRequest());
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("shape violation must close the run");
    expect(outcome).not.toHaveProperty("outputs");
    expect(outcome.error).toMatchObject({
      code: "TERMINAL_FAILURE",
      retryable: false,
      stageCode: "model.structured.output-schema",
      diagnosticRef: RAW_RESPONSE,
    });
  });

  it("persists one C04 vector artifact and returns one vector per text", async () => {
    const requests: EmbeddingRequestV1[] = [];
    const texts = ["扩径期间掌子面失稳", "盾体扩径支护失效"];
    const vectors = [
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ];
    const { runtime, artifactStore } = setup({
      completeStructured: (async () => {
        throw new Error("generation is not part of this scenario");
      }) as ModelGatewayPortV1["completeStructured"],
      embed: (async (request) => {
        requests.push(request);
        return {
          schemaVersion: "1" as const,
          invocationId: request.invocationId,
          modelDeploymentRef: request.modelDeploymentRef,
          serverBuildRef: versionRef("server-build"),
          modelVersionRef: versionRef("model-version"),
          usage: { available: false },
          rawResponseRef: RAW_RESPONSE,
          vectors,
          dimensions: 3,
        } as never;
      }) as ModelGatewayPortV1["embed"],
    });

    const embeddingRequest: RiskCandidateEmbeddingRequestV1 = {
      projectId: PROJECT,
      actorId: ACTOR,
      invocationId: "identification-run-1:embed",
      requestedAt: TIMESTAMP,
      deadlineAt: DEADLINE,
      projectWorkPlanEntityId: "work-plan-1",
      embeddingDeploymentRef: EMBEDDING_DEPLOYMENT,
      budgetPolicyRef: versionRef("embedding-budget-policy"),
      texts,
      authorization: authorization(),
    };
    const outcome = await runtime.embedRiskEvents(embeddingRequest);

    expect(requests).toHaveLength(1);
    expect(requests[0]!.texts).toEqual(texts);
    expect(requests[0]!.modelDeploymentRef).toEqual(EMBEDDING_DEPLOYMENT);
    expect(requests[0]!.requiredCapability).toBe("risk-identification.run");
    expect(requests[0]!.maxBatchItems).toBeLessThanOrEqual(4096);
    expect(requests[0]!.maxInputBytes).toBeGreaterThan(0);

    expect(outcome.kind).toBe("succeeded");
    if (outcome.kind !== "succeeded") throw new Error("embedding must succeed");
    expect(outcome.vectors).toEqual(vectors);
    expect(outcome.dimensions).toBe(3);
    expect(outcome.deploymentRef).toEqual(EMBEDDING_DEPLOYMENT);
    expect(outcome.rawResponseRef).toEqual(RAW_RESPONSE);

    expect(artifactStore.puts).toHaveLength(1);
    const put = artifactStore.puts[0]!;
    expect(put.command.purposeCode).toBe(
      RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.riskEventVector,
    );
    expect(put.command.artifactKind).toBe("content");
    expect(put.command.mediaType).toBe("application/json");
    expect(put.command.requiredCapability).toBe("risk-identification.run");
    expect(put.command.artifactId).toBe(
      `${embeddingRequest.invocationId}:risk-candidate-risk-event-vector`,
    );
    expect(JSON.parse(put.text)).toMatchObject({ vectors, dimensions: 3 });
    expect(outcome.embeddingArtifactRef.kind).toBe("content-artifact");
  });

  it("maps an embedding gateway error to a structured module error", async () => {
    const { runtime, artifactStore } = setup({
      completeStructured: vi.fn() as never,
      embed: (async () => {
        throw new ModelGatewayError(
          makeModelGatewayError({
            code: "MODEL_EMBEDDING_INVALID",
            retryable: false,
            stage: "model.embedding.dimensions",
            occurredAt: TIMESTAMP,
            invocationId: "identification-run-1:embed",
            modelDeploymentRef: EMBEDDING_DEPLOYMENT,
            rawResponseRef: RAW_RESPONSE,
          }),
        );
      }) as ModelGatewayPortV1["embed"],
    });

    const outcome = await runtime.embedRiskEvents({
      projectId: PROJECT,
      actorId: ACTOR,
      invocationId: "identification-run-1:embed",
      requestedAt: TIMESTAMP,
      deadlineAt: DEADLINE,
      projectWorkPlanEntityId: "work-plan-1",
      embeddingDeploymentRef: EMBEDDING_DEPLOYMENT,
      budgetPolicyRef: versionRef("embedding-budget-policy"),
      texts: ["扩径期间掌子面失稳"],
      authorization: authorization(),
    });

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("embedding failure must close the run");
    expect(outcome.error).toMatchObject({
      code: "TERMINAL_FAILURE",
      stageCode: "model.embedding.dimensions",
      diagnosticRef: RAW_RESPONSE,
    });
    expect(artifactStore.puts).toHaveLength(0);
  });
});
