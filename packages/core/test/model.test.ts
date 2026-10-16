import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ConversationReceiptV1Schema,
  ConversationRequestV1Schema,
  ConversationTextDeltaV1Schema,
  EmbeddingRequestV1Schema,
  ModelDeploymentSnapshotV1Schema,
  EmbeddingResultV1Schema,
  ModelGatewayErrorV1Schema,
  ModelUsageV1Schema,
  StructuredCompletionRequestV1Schema,
  mapModelGatewayErrorToModuleError,
  modelGatewayError,
  structuredCompletionResultSchema,
} from "../src/model/index.js";

const authorization = {
  schemaVersion: "1" as const,
  authorizationContextRef: {
    kind: "authorization-context" as const,
    reference: { entityId: "auth-model", versionId: "v1" },
  },
  actorId: "actor-model",
  projectId: "project-model",
  grantedCapabilities: ["risk-identification.run" as const],
  spatialScopeRefs: [],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
  decidedAt: "2030-01-01T00:00:00.000Z",
  invocation: { kind: "human" as const },
};

const baseRequest = {
  schemaVersion: "1" as const,
  invocationId: "invocation-model",
  idempotencyKey: "idempotency-model",
  issuedAt: "2030-01-01T00:00:00.000Z",
  projectId: "project-model",
  actorId: "actor-model",
  authorization,
  requiredCapability: "risk-identification.run" as const,
  modelDeploymentRef: { entityId: "deployment", versionId: "v1" },
  budgetPolicyRef: { entityId: "budget", versionId: "v1" },
  deadlineAt: "2030-01-01T00:01:00.000Z",
  parentArtifactRefs: [],
  evidenceReferences: [],
};

const structuredRequest = () =>
  StructuredCompletionRequestV1Schema.parse({
    ...baseRequest,
    promptTemplateRef: { entityId: "prompt", versionId: "v1" },
    outputSchemaRef: { entityId: "schema", versionId: "v1" },
    messages: [{ role: "user", content: "分析当前工序" }],
    maxOutputTokens: 128,
  });

describe("model gateway core contract", () => {
  it("validates per-action structured token limits", () => {
    expect(
      StructuredCompletionRequestV1Schema.parse({
        ...structuredRequest(),
        maxInputTokens: 10,
        maxContextTokens: 20,
      }),
    ).toMatchObject({ maxInputTokens: 10, maxContextTokens: 20 });
    for (const key of ["maxInputTokens", "maxContextTokens"])
      for (const value of [0, -1, 1.5])
        expect(
          StructuredCompletionRequestV1Schema.safeParse({ ...structuredRequest(), [key]: value })
            .success,
        ).toBe(false);
  });
  it("accepts all three strict request shapes", () => {
    const structured = structuredRequest();
    expect(structured.invocationId).toBe("invocation-model");
    expect(
      EmbeddingRequestV1Schema.parse({
        ...baseRequest,
        texts: ["地层条件"],
        maxInputBytes: 1024,
        maxBatchItems: 4,
      }).texts,
    ).toHaveLength(1);
    expect(
      ConversationRequestV1Schema.parse({
        ...baseRequest,
        conversationRef: { entityId: "conversation", versionId: "v1" },
        promptTemplateRef: { entityId: "prompt", versionId: "v1" },
        messages: [{ role: "user", content: "继续" }],
        maxOutputTokens: 128,
      }).conversationRef.entityId,
    ).toBe("conversation");
    expect(
      StructuredCompletionRequestV1Schema.safeParse({ ...structured, extra: true }).success,
    ).toBe(false);
  });

  it.each([
    ["project", { projectId: "other-project" }],
    ["actor", { actorId: "other-actor" }],
    ["capability", { requiredCapability: "risk-assessment.evaluate" }],
  ])("rejects an authorization %s mismatch", (_name, override) => {
    expect(
      StructuredCompletionRequestV1Schema.safeParse({ ...structuredRequest(), ...override })
        .success,
    ).toBe(false);
  });

  it("keeps the schema factory and finite usage values type aligned", () => {
    const outputSchema = z.strictObject({ risk: z.string() });
    const result = structuredCompletionResultSchema(outputSchema).parse({
      schemaVersion: "1",
      invocationId: "invocation-model",
      modelDeploymentRef: { entityId: "deployment", versionId: "v1" },
      serverBuildRef: { entityId: "llama-build", versionId: "v1" },
      modelVersionRef: { entityId: "model", versionId: "v1" },
      usage: { available: false },
      rawResponseRef: {
        kind: "diagnostic-artifact",
        reference: { entityId: "raw", versionId: "v1" },
      },
      promptTemplateRef: { entityId: "prompt", versionId: "v1" },
      outputSchemaRef: { entityId: "schema", versionId: "v1" },
      value: { risk: "稳定" },
      finishReason: "stop",
    });
    expect(result.value.risk).toBe("稳定");
    expect(
      ModelUsageV1Schema.safeParse({ available: false, inputTokens: Number.NaN }).success,
    ).toBe(false);
  });

  it("keeps deployment dimensions and stream receipt closed", () => {
    const deployment = ModelDeploymentSnapshotV1Schema.parse({
      schemaVersion: "1",
      deploymentRef: { entityId: "deployment", versionId: "v1" },
      serverBuildRef: { entityId: "llama-build", versionId: "v1" },
      modelVersionRef: { entityId: "model", versionId: "v1" },
      capabilities: ["embed"],
      contextWindowTokens: 4096,
      embeddingDimensions: 768,
      observedAt: "2030-01-01T00:00:00.000Z",
    });
    expect(deployment.embeddingDimensions).toBe(768);
    expect(
      ModelDeploymentSnapshotV1Schema.safeParse({
        ...deployment,
        embeddingDimensions: undefined,
      }).success,
    ).toBe(false);
    expect(
      EmbeddingResultV1Schema.safeParse({
        schemaVersion: "1",
        invocationId: "invocation-model",
        modelDeploymentRef: { entityId: "deployment", versionId: "v1" },
        serverBuildRef: { entityId: "llama-build", versionId: "v1" },
        modelVersionRef: { entityId: "model", versionId: "v1" },
        usage: { available: false },
        rawResponseRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "raw", versionId: "v1" },
        },
        vectors: [[1, 2]],
        dimensions: 3,
      }).success,
    ).toBe(false);
    expect(
      ConversationTextDeltaV1Schema.safeParse({
        schemaVersion: "1",
        sequence: 0,
        text: "片段",
        tool: true,
      }).success,
    ).toBe(false);
    expect(
      ConversationReceiptV1Schema.safeParse({
        schemaVersion: "1",
        invocationId: "invocation-model",
        modelDeploymentRef: { entityId: "deployment", versionId: "v1" },
        serverBuildRef: { entityId: "llama-build", versionId: "v1" },
        modelVersionRef: { entityId: "model", versionId: "v1" },
        usage: { available: false },
        rawResponseRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "raw", versionId: "v1" },
        },
        conversationRef: { entityId: "conversation", versionId: "v1" },
        promptTemplateRef: { entityId: "prompt", versionId: "v1" },
        finishReason: "stop",
        deltaCount: 1,
        responseByteLength: 10,
      }).success,
    ).toBe(true);
  });

  it("maps closed model errors to C02 semantics", () => {
    const rawResponseRef = {
      kind: "diagnostic-artifact" as const,
      reference: { entityId: "raw", versionId: "v1" },
    };
    const timeout = modelGatewayError({
      code: "MODEL_REQUEST_TIMEOUT",
      retryable: true,
      stage: "chat.timeout",
      occurredAt: "2030-01-01T00:00:01.000Z",
      invocationId: "invocation-model",
      modelDeploymentRef: { entityId: "deployment", versionId: "v1" },
      diagnosticRef: rawResponseRef,
    });
    const mapped = mapModelGatewayErrorToModuleError(timeout, {
      causalRunId: "run-model",
      requiredCapability: "risk-identification.run",
      authorizationPolicyRef: authorization.authorizationPolicyRef,
      attempt: 1,
      retryPolicyRef: { entityId: "retry", versionId: "v1" },
    });
    expect(mapped.code).toBe("TRANSIENT_FAILURE");
    expect(mapped.retryable).toBe(true);
    expect(ModelGatewayErrorV1Schema.safeParse({ ...timeout, unexpected: true }).success).toBe(
      false,
    );
    expect(ModelGatewayErrorV1Schema.safeParse({ ...timeout, category: "embedding" }).success).toBe(
      false,
    );
  });
});
