import { readFile, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { ArtifactReadRequestV1Schema, type ArtifactRefV1 } from "@riskflow/core/artifacts";
import {
  ConversationRequestV1Schema,
  EmbeddingRequestV1Schema,
  StructuredCompletionRequestV1Schema,
  z,
} from "@riskflow/core/model";
import { createDeploymentSecretFileLoaderV1 } from "../../src/deployment/secrets.js";
import {
  createNetworkApiModelGateway,
  ModelGatewayDeploymentConfigV1Schema,
} from "../../src/model/index.js";
import { startArtifactFixture } from "../artifacts/fixture.js";
import { testRequestBase } from "./fixture.js";

const enabled = process.env.RISKFLOW_NETWORK_API_SMOKE === "1";
const secretRefsSchema = z
  .array(
    z.strictObject({
      secretId: z.string().min(1),
      filePath: z.string().min(1),
    }),
  )
  .min(1);

const readConfig = async (name: string): Promise<unknown> => {
  const path = process.env[name];
  if (!path) throw new Error(`${name} is required for explicitly enabled smoke`);
  const bytes = await readFile(path);
  if (bytes.byteLength > 1_048_576) throw new Error("smoke config size exceeded");
  return JSON.parse(bytes.toString("utf8"));
};

describe.skipIf(!enabled)("网络模型 adapter 真实服务 smoke", () => {
  it("通过真实聊天、Embedding 和会话流取得可读取的 C04 证据", async () => {
    const entries = z
      .array(ModelGatewayDeploymentConfigV1Schema)
      .min(1)
      .parse(await readConfig("RISKFLOW_MODEL_GATEWAY_CONFIG"));
    const deployments = entries.flatMap((entry) =>
      entry.backend === "network-api" ? [entry.config] : [],
    );
    const chat = deployments.find((item) => item.protocol === "openai-chat");
    const embedding = deployments.find((item) => item.protocol === "ollama-embed");
    if (chat?.protocol !== "openai-chat" || embedding?.protocol !== "ollama-embed")
      throw new Error("smoke requires both approved network protocols");
    if (
      !chat.capabilities.includes("completeStructured") ||
      !chat.capabilities.includes("streamConversation") ||
      chat.maxOutputTokens < 4096 ||
      embedding.maxBatchItems < 2
    )
      throw new Error("smoke requires three capabilities and explicit request budgets");
    const secretRefs = secretRefsSchema.parse(await readConfig("RISKFLOW_MODEL_GATEWAY_SECRETS"));
    const credentials = createDeploymentSecretFileLoaderV1({
      expectedUid: process.getuid?.(),
    })(secretRefs);
    const fixture = await startArtifactFixture();
    try {
      const gateway = createNetworkApiModelGateway({
        deployments,
        artifactStore: fixture.store,
        credentials,
      });
      const issuedAt = new Date().toISOString();
      const common = {
        ...testRequestBase,
        issuedAt,
        deadlineAt: new Date(Date.now() + 360_000).toISOString(),
      };
      const readEvidence = async (artifactRef: ArtifactRefV1, id: string) => {
        const opened = await fixture.store.open(
          ArtifactReadRequestV1Schema.parse({
            schemaVersion: "1",
            requestId: id,
            idempotencyKey: id,
            artifactRef,
            projectId: common.projectId,
            actorId: common.actorId,
            requestedAt: new Date().toISOString(),
            purposeCode: "model-raw-response",
            requiredCapability: common.requiredCapability,
            authorization: common.authorization,
          }),
        );
        const chunks: Uint8Array[] = [];
        for await (const chunk of opened.content) chunks.push(chunk);
        const receipt = await opened.verified;
        const bytes = Buffer.concat(chunks);
        expect(bytes.byteLength).toBeGreaterThan(0);
        expect(bytes.toString("utf8")).not.toContain('"reasoning_content"');
        return {
          artifactRef,
          content: receipt.content,
          verifiedAt: receipt.verifiedAt,
        };
      };
      const structured = await gateway.completeStructured(
        StructuredCompletionRequestV1Schema.parse({
          ...common,
          invocationId: "network-smoke-structured",
          idempotencyKey: "network-smoke-structured",
          modelDeploymentRef: chat.deploymentRef,
          promptTemplateRef: {
            entityId: "network-smoke-prompt",
            versionId: "v1",
          },
          outputSchemaRef: {
            entityId: "network-smoke-output",
            versionId: "v1",
          },
          messages: [
            {
              role: "user",
              content: "请返回一个 JSON 对象，包含非空字符串 answer，简述施工监测的用途。",
            },
          ],
          maxOutputTokens: 4096,
        }),
        z.strictObject({ answer: z.string().min(1) }),
      );
      expect(structured.usage.available).toBe(true);
      const structuredEvidence = await readEvidence(
        structured.rawResponseRef,
        "network-read-structured",
      );

      const vectors = await gateway.embed(
        EmbeddingRequestV1Schema.parse({
          ...common,
          invocationId: "network-smoke-embedding",
          idempotencyKey: "network-smoke-embedding",
          modelDeploymentRef: embedding.deploymentRef,
          texts: [
            "合成样本：地下水压力变化，需核对监测记录。",
            "合成样本：支护参数变化，需进行工程复核。",
          ],
          maxInputBytes: embedding.maxInputBytes,
          maxBatchItems: 2,
        }),
      );
      expect(vectors.vectors).toHaveLength(2);
      expect(vectors.dimensions).toBe(embedding.embeddingDimensions);
      expect(
        vectors.vectors.every(
          (v) => v.length === embedding.embeddingDimensions && v.every(Number.isFinite),
        ),
      ).toBe(true);
      expect(vectors.usage.available).toBe(true);
      const embeddingEvidence = await readEvidence(
        vectors.rawResponseRef,
        "network-read-embedding",
      );

      const stream = gateway.streamConversation(
        ConversationRequestV1Schema.parse({
          ...common,
          invocationId: "network-smoke-stream",
          idempotencyKey: "network-smoke-stream",
          modelDeploymentRef: chat.deploymentRef,
          conversationRef: {
            entityId: "network-smoke-conversation",
            versionId: "v1",
          },
          promptTemplateRef: {
            entityId: "network-smoke-prompt",
            versionId: "v1",
          },
          messages: [
            {
              role: "user",
              content: "用两句话说明工程监测记录为什么需要保留版本。",
            },
          ],
          maxOutputTokens: 4096,
        }),
      );
      let deltaCount = 0;
      let textBytes = 0;
      for await (const delta of stream.deltas) {
        deltaCount += 1;
        textBytes += Buffer.byteLength(delta.text);
      }
      const receipt = await stream.completed;
      expect(deltaCount).toBeGreaterThan(0);
      expect(textBytes).toBeGreaterThan(0);
      expect(receipt.deltaCount).toBe(deltaCount);
      expect(receipt.usage.available).toBe(true);
      const streamEvidence = await readEvidence(receipt.rawResponseRef, "network-read-stream");
      const report = {
        scope: "network-model-adapter-smoke",
        storage: "isolated-postgres-c04-test-storage",
        productionAuthorizationVerified: false,
        status: "PASS",
        deployments: deployments.map(({ deploymentRef, serviceContractRef, modelVersionRef }) => ({
          deploymentRef,
          serviceContractRef,
          modelVersionRef,
        })),
        structured: { usage: structured.usage, evidence: structuredEvidence },
        embedding: {
          dimensions: vectors.dimensions,
          batchItems: vectors.vectors.length,
          usage: vectors.usage,
          evidence: embeddingEvidence,
        },
        stream: {
          deltaCount,
          usage: receipt.usage,
          evidence: streamEvidence,
        },
      };
      if (process.env.RISKFLOW_NETWORK_API_SMOKE_REPORT) {
        await writeFile(
          process.env.RISKFLOW_NETWORK_API_SMOKE_REPORT,
          `${JSON.stringify(report, null, 2)}\n`,
          { mode: 0o600, flag: "wx" },
        );
      }
      console.info(JSON.stringify(report));
    } finally {
      await fixture.close();
    }
  }, 600_000);
});
