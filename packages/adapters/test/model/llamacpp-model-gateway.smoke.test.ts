import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { ArtifactReadRequestV1Schema, type ArtifactRefV1 } from "@riskflow/core/artifacts";
import {
  ConversationRequestV1Schema,
  EmbeddingRequestV1Schema,
  StructuredCompletionRequestV1Schema,
  z,
} from "@riskflow/core/model";
import {
  createLlamaCppModelGateway,
  LlamaCppDeploymentConfigV1Schema,
} from "../../src/model/index.js";
import { startArtifactFixture } from "../artifacts/fixture.js";

import { testAuthorization, testRequestBase } from "./fixture.js";

const enabled = process.env.RISKFLOW_LLAMACPP_SMOKE === "1";
const SmokeConfigSchema = z.strictObject({
  deployments: z.array(LlamaCppDeploymentConfigV1Schema).min(1),
  unreachableDeployment: LlamaCppDeploymentConfigV1Schema,
});

const smokeConfig = async () => {
  const path = process.env.RISKFLOW_LLAMACPP_SMOKE_CONFIG;
  if (path === undefined || path.length === 0)
    throw new Error("RISKFLOW_LLAMACPP_SMOKE_CONFIG is required when smoke is enabled");
  return SmokeConfigSchema.parse(JSON.parse(await readFile(path, "utf8")));
};

describe.skipIf(!enabled)("llama.cpp real-service smoke", () => {
  it("runs strict structured output, two-input embedding, a multi-delta stream, and no-service failure", async () => {
    const config = await smokeConfig();
    const chat = config.deployments.find((deployment) =>
      deployment.capabilities.includes("completeStructured"),
    );
    const embedding = config.deployments.find((deployment) =>
      deployment.capabilities.includes("embed"),
    );
    const stream = config.deployments.find((deployment) =>
      deployment.capabilities.includes("streamConversation"),
    );
    if (chat === undefined || embedding === undefined || stream === undefined)
      throw new Error("smoke config must provide chat, embedding, and streaming capabilities");
    if (embedding.embeddingDimensions === undefined || embedding.maxBatchItems < 2)
      throw new Error("smoke embedding deployment must support a two-input batch");

    const artifactFixture = await startArtifactFixture();
    try {
      const gateway = createLlamaCppModelGateway({
        deployments: config.deployments,
        artifactStore: artifactFixture.store,
      });
      const common = {
        ...testRequestBase,
        authorization: testAuthorization,
        deadlineAt: new Date(Date.now() + 600_000).toISOString(),
      } as const;
      const assertRawArtifactReadable = async (
        artifactRef: ArtifactRefV1,
        requestId: string,
      ): Promise<void> => {
        const opened = await artifactFixture.store.open(
          ArtifactReadRequestV1Schema.parse({
            schemaVersion: "1",
            requestId,
            idempotencyKey: requestId,
            artifactRef,
            projectId: common.projectId,
            actorId: common.actorId,
            requestedAt: new Date().toISOString(),
            purposeCode: "model-raw-response",
            requiredCapability: common.requiredCapability,
            authorization: common.authorization,
          }),
        );
        let byteLength = 0;
        for await (const chunk of opened.content) byteLength += chunk.byteLength;
        expect(byteLength).toBeGreaterThan(0);
        await opened.verified;
      };

      const structured = await gateway.completeStructured(
        StructuredCompletionRequestV1Schema.parse({
          ...common,
          invocationId: "smoke-structured",
          idempotencyKey: "smoke-structured",
          modelDeploymentRef: chat.deploymentRef,
          promptTemplateRef: { entityId: "smoke-prompt", versionId: "v1" },
          outputSchemaRef: { entityId: "smoke-output", versionId: "v1" },
          messages: [{ role: "user", content: "Return a JSON object with an answer string." }],
          maxOutputTokens: Math.min(chat.maxOutputTokens, 128),
        }),
        z.strictObject({ answer: z.string() }),
      );
      expect(structured.rawResponseRef.kind).toBe("diagnostic-artifact");
      await assertRawArtifactReadable(structured.rawResponseRef, "smoke-read-structured");

      const vectors = await gateway.embed(
        EmbeddingRequestV1Schema.parse({
          ...common,
          invocationId: "smoke-embedding",
          idempotencyKey: "smoke-embedding",
          modelDeploymentRef: embedding.deploymentRef,
          texts: ["地层与地下水条件", "支护与监测状态"],
          maxInputBytes: embedding.maxInputBytes,
          maxBatchItems: 2,
        }),
      );
      expect(vectors.vectors).toHaveLength(2);
      expect(vectors.dimensions).toBe(embedding.embeddingDimensions);
      expect(vectors.rawResponseRef.kind).toBe("diagnostic-artifact");
      await assertRawArtifactReadable(vectors.rawResponseRef, "smoke-read-embedding");

      const handle = gateway.streamConversation(
        ConversationRequestV1Schema.parse({
          ...common,
          invocationId: "smoke-stream",
          idempotencyKey: "smoke-stream",
          modelDeploymentRef: stream.deploymentRef,
          conversationRef: { entityId: "smoke-conversation", versionId: "v1" },
          promptTemplateRef: { entityId: "smoke-prompt", versionId: "v1" },
          messages: [{ role: "user", content: "Reply in multiple short content chunks." }],
          maxOutputTokens: Math.min(stream.maxOutputTokens, 256),
        }),
      );
      const deltas = [];
      for await (const delta of handle.deltas) deltas.push(delta);
      const receipt = await handle.completed;
      expect(deltas.length).toBeGreaterThan(1);
      expect(receipt.deltaCount).toBe(deltas.length);
      expect(receipt.rawResponseRef.kind).toBe("diagnostic-artifact");
      await assertRawArtifactReadable(receipt.rawResponseRef, "smoke-read-stream");

      const unavailableGateway = createLlamaCppModelGateway({
        deployments: [config.unreachableDeployment],
        artifactStore: artifactFixture.store,
      });
      const unreachable = await unavailableGateway
        .embed(
          EmbeddingRequestV1Schema.parse({
            ...common,
            invocationId: "smoke-unavailable",
            idempotencyKey: "smoke-unavailable",
            modelDeploymentRef: config.unreachableDeployment.deploymentRef,
            texts: ["unavailable"],
            maxInputBytes: config.unreachableDeployment.maxInputBytes,
            maxBatchItems: 1,
          }),
        )
        .catch((error: unknown) => error);
      expect(unreachable).toMatchObject({ code: "MODEL_SERVICE_UNAVAILABLE" });
    } finally {
      await artifactFixture.close();
    }
  });
});
