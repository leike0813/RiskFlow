import { describe, expect, it } from "vitest";

import {
  ConversationRequestV1Schema,
  EmbeddingRequestV1Schema,
  z,
} from "@riskflow/core/model";
import { makeArtifactError } from "@riskflow/core/artifacts";

import {
  createNetworkApiModelGateway,
  ModelGatewayDeploymentConfigV1Schema,
} from "../../src/model/index.js";
import {
  ArtifactStoreLatch,
  jsonResponse,
  ScriptedFetch,
  streamResponse,
  structuredRequest,
  testRequestBase,
} from "./fixture.js";

const chatDeployment = (mode: "schema-prompt" | "server-json-schema" = "schema-prompt") => ({
  schemaVersion: "1" as const,
  protocol: "openai-chat" as const,
  deploymentRef: { entityId: "network-chat", versionId: "v1" },
  serviceContractRef: { entityId: "chat-contract", versionId: "v1" },
  modelVersionRef: { entityId: "minimax-m31", versionId: "v1" },
  baseUrl: "https://api.minimax.cn/v1",
  modelId: "MiniMax-M3.1-Flash-Preview",
  capabilities: ["completeStructured", "streamConversation"] as const,
  contextWindowTokens: 1_000_000,
  maxOutputTokens: 4096,
  structuredOutputMode: mode,
  reasoningEffort: "low" as const,
  credentialRef: "minimax-key",
  requestTimeoutMs: 2_000,
  streamIdleTimeoutMs: 1_000,
  maxResponseBytes: 64 * 1024,
  maxInputBytes: 16 * 1024,
  maxBatchItems: 8,
  inputTokenUpperBoundPolicy: { maxTokensPerInputByte: 1, requestOverheadTokens: 128 },
});

const ollamaDeployment = () => ({
  schemaVersion: "1" as const,
  protocol: "ollama-embed" as const,
  deploymentRef: { entityId: "network-embed", versionId: "v1" },
  serviceContractRef: { entityId: "ollama-contract", versionId: "0.40.0" },
  modelVersionRef: { entityId: "qwen3-embedding-4b", versionId: "df5bd2e3c74cd8d069d21dc038f1b359fcdc9458fce1c99bd43c9eb1518ff907" },
  baseUrl: "http://192.168.13.11:11434" as const,
  modelId: "qwen3-embedding:4b",
  capabilities: ["embed"] as const,
  contextWindowTokens: 40960,
  embeddingDimensions: 2560,
  expectedServerVersion: "0.40.0",
  expectedModelDigest: "df5bd2e3c74cd8d069d21dc038f1b359fcdc9458fce1c99bd43c9eb1518ff907",
  requestTimeoutMs: 2_000,
  streamIdleTimeoutMs: 1_000,
  maxResponseBytes: 64 * 1024,
  maxInputBytes: 16 * 1024,
  maxBatchItems: 8,
  inputTokenUpperBoundPolicy: { maxTokensPerInputByte: 1, requestOverheadTokens: 128 },
});

class UniqueCommandArtifactStore extends ArtifactStoreLatch {
  readonly #commandIds = new Set<string>();

  override async put(command: Parameters<ArtifactStoreLatch["put"]>[0], content: Parameters<ArtifactStoreLatch["put"]>[1]) {
    if (this.#commandIds.has(command.commandId)) throw makeArtifactError("ARTIFACT_REGISTRY_FAILURE", "registry.register");
    this.#commandIds.add(command.commandId);
    return super.put(command, content);
  }
}

const gateway = (fetcher: ScriptedFetch, deployments = [chatDeployment()], store = new ArtifactStoreLatch()) => createNetworkApiModelGateway({
  deployments,
  artifactStore: store,
  credentials: { "minimax-key": "test-secret" },
  fetchImpl: fetcher.fetch,
  now: () => new Date("2030-01-01T00:00:01.000Z"),
});

describe("network API model gateway", () => {
  it("strictly validates the backend wrapper and schema-prompt output without repair", async () => {
    expect(ModelGatewayDeploymentConfigV1Schema.safeParse({ backend: "network-api", config: { ...chatDeployment(), unexpected: true } }).success).toBe(false);
    const fetcher = new ScriptedFetch();
    fetcher.enqueue(jsonResponse({
      model: "MiniMax-M3.1-Flash-Preview",
      choices: [{ index: 0, message: { content: '{"risk":"stable"}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 120, completion_tokens: 3, total_tokens: 123 },
    }));
    const result = await gateway(fetcher).completeStructured({ ...structuredRequest(), modelDeploymentRef: chatDeployment().deploymentRef }, z.strictObject({ risk: z.string() }));
    expect(result.value).toEqual({ risk: "stable" });
    const sent = JSON.parse(fetcher.calls[0]!.body!);
    expect(sent.messages[0].content).toContain('"risk"');
    expect(sent.response_format).toBeUndefined();
    expect(fetcher.calls[0]!.url).toBe("https://api.minimax.cn/v1/chat/completions");
    expect(fetcher.calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses distinct raw artifact command identities across invocations on one store", async () => {
    const fetcher = new ScriptedFetch();
    const store = new UniqueCommandArtifactStore();
    for (const risk of ["stable", "changing"]) fetcher.enqueue(jsonResponse({
      model: "MiniMax-M3.1-Flash-Preview",
      choices: [{ index: 0, message: { content: JSON.stringify({ risk }) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 },
    }));
    const gatewayInstance = gateway(fetcher, [chatDeployment()], store);
    const schema = z.strictObject({ risk: z.string() });
    const first = structuredRequest();
    await gatewayInstance.completeStructured({ ...first, modelDeploymentRef: chatDeployment().deploymentRef }, schema);
    await gatewayInstance.completeStructured({
      ...first,
      invocationId: "invocation-model-second",
      idempotencyKey: "idempotency-model-second",
      modelDeploymentRef: chatDeployment().deploymentRef,
    }, schema);
    expect(store.commands).toHaveLength(2);
    expect(new Set(store.commands.map(({ commandId }) => commandId)).size).toBe(2);
    expect(new Set([...store.artifacts.values()].map(({ bytes }) => new TextDecoder().decode(bytes))).size).toBe(2);
  });

  it("probes Ollama identity and preserves embedding order and dimensions", async () => {
    const fetcher = new ScriptedFetch();
    fetcher.enqueue(jsonResponse({ version: "0.40.0" }));
    fetcher.enqueue(jsonResponse({ models: [{ name: "qwen3-embedding:4b", model: "qwen3-embedding:4b", modified_at: "2026-10-11T00:00:00Z", size: 4_000_000_000, digest: ollamaDeployment().expectedModelDigest, details: { format: "gguf", family: "qwen3" } }] }));
    fetcher.enqueue(jsonResponse({ model_info: { "qwen3.embedding_length": 2560, "qwen3.context_length": 40960 } }));
    fetcher.enqueue(jsonResponse({ model: "qwen3-embedding:4b", embeddings: [Array.from({ length: 2560 }, () => 0.1)], prompt_eval_count: 3, total_duration: 12_000, load_duration: 3_000, prompt_eval_duration: 4_000 }));
    const request = EmbeddingRequestV1Schema.parse({ ...testRequestBase, modelDeploymentRef: ollamaDeployment().deploymentRef, texts: ["风险文本"], maxInputBytes: 1024, maxBatchItems: 2 });
    const result = await gateway(fetcher, [ollamaDeployment()]).embed(request);
    expect(result.vectors[0]).toHaveLength(2560);
    expect(fetcher.calls.map((call) => new URL(call.url).pathname)).toEqual(["/api/version", "/api/tags", "/api/show", "/api/embed"]);
    expect(JSON.parse(fetcher.calls.at(-1)!.body!)).toMatchObject({ truncate: false });
    expect(fetcher.calls.every((call) => call.method !== "POST" || call.url.endsWith("/api/embed") || call.url.endsWith("/api/show"))).toBe(true);
  });

  it("rejects Ollama actual usage above the conservative input token bound", async () => {
    const fetcher = new ScriptedFetch();
    fetcher.enqueue(jsonResponse({ version: "0.40.0" }));
    fetcher.enqueue(jsonResponse({ models: [{ name: "qwen3-embedding:4b", digest: ollamaDeployment().expectedModelDigest }] }));
    fetcher.enqueue(jsonResponse({ model_info: { "qwen3.embedding_length": 2560, "qwen3.context_length": 40960 } }));
    fetcher.enqueue(jsonResponse({ model: "qwen3-embedding:4b", embeddings: [Array.from({ length: 2560 }, () => 0.1)], prompt_eval_count: 40961 }));
    const request = EmbeddingRequestV1Schema.parse({ ...testRequestBase, modelDeploymentRef: ollamaDeployment().deploymentRef, texts: ["短文本"], maxInputBytes: 1024, maxBatchItems: 2 });
    await expect(gateway(fetcher, [ollamaDeployment()]).embed(request)).rejects.toMatchObject({ code: "MODEL_CONTEXT_EXCEEDED" });
  });

  it("streams only user-facing content and never persists internal thinking fields or blocks", async () => {
    const fetcher = new ScriptedFetch();
    const store = new ArtifactStoreLatch();
    fetcher.enqueue(streamResponse([
      'data: {"choices":[{"index":0,"delta":{"content":"开<th"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"ink>hidden</think>放" ,"reasoning_content":"private"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n',
      "data: [DONE]\n\n",
    ]));
    const request = ConversationRequestV1Schema.parse({
      ...testRequestBase,
      modelDeploymentRef: chatDeployment().deploymentRef,
      conversationRef: { entityId: "conversation", versionId: "v1" },
      promptTemplateRef: { entityId: "prompt", versionId: "v1" },
      messages: [{ role: "user", content: "说一句话" }],
      maxOutputTokens: 128,
    });
    const handle = createNetworkApiModelGateway({ deployments: [chatDeployment()], artifactStore: store, credentials: { "minimax-key": "test-secret" }, fetchImpl: fetcher.fetch, now: () => new Date("2030-01-01T00:00:01.000Z") }).streamConversation(request);
    const text: string[] = [];
    for await (const delta of handle.deltas) text.push(delta.text);
    await handle.completed;
    expect(text.join("")).toBe("开放");
    const persisted = [...store.artifacts.values()].map((artifact) => new TextDecoder().decode(artifact.bytes)).join("\n");
    expect(persisted).not.toContain("private");
    expect(persisted).not.toContain("hidden");
  });
});
