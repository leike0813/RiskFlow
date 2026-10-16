import { describe, expect, it } from "vitest";

import { ConversationRequestV1Schema, EmbeddingRequestV1Schema, z } from "@riskflow/core/model";
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

const chatDeployment = (
  mode: "schema-prompt" | "server-json-schema" | "function-call" = "schema-prompt",
) => ({
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
  modelVersionRef: {
    entityId: "qwen3-embedding-4b",
    versionId: "df5bd2e3c74cd8d069d21dc038f1b359fcdc9458fce1c99bd43c9eb1518ff907",
  },
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

  override async put(
    command: Parameters<ArtifactStoreLatch["put"]>[0],
    content: Parameters<ArtifactStoreLatch["put"]>[1],
  ) {
    if (this.#commandIds.has(command.commandId))
      throw makeArtifactError("ARTIFACT_REGISTRY_FAILURE", "registry.register");
    this.#commandIds.add(command.commandId);
    return super.put(command, content);
  }
}

const gateway = (
  fetcher: ScriptedFetch,
  deployments = [chatDeployment()],
  store = new ArtifactStoreLatch(),
  observe?: (value: { readonly stage: string; readonly serverVersion?: string }) => void,
) =>
  createNetworkApiModelGateway({
    deployments,
    artifactStore: store,
    credentials: { "minimax-key": "test-secret" },
    fetchImpl: fetcher.fetch,
    now: () => new Date("2030-01-01T00:00:01.000Z"),
    observe,
  });

describe("network API model gateway", () => {
  const resultCall = (args = '{"risk":"stable"}', name = "emit_result") => ({
    id: "result-call-1",
    type: "function",
    function: { name, arguments: args },
  });
  const resultMessage = { content: null, tool_calls: [resultCall()] };

  it.each(
    ["tool_calls", "stop"].flatMap((finishReason) =>
      [null, "", undefined].map((content) => ({ finishReason, content })),
    ),
  )(
    "reads one function result with $finishReason and content=$content",
    async ({ finishReason, content }) => {
      const fetcher = new ScriptedFetch();
      fetcher.enqueue(
        jsonResponse({
          model: "MiniMax-M3.1-Flash-Preview",
          choices: [
            { index: 0, message: { ...resultMessage, content }, finish_reason: finishReason },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 3, total_tokens: 123 },
        }),
      );
      const result = await gateway(fetcher, [chatDeployment("function-call")]).completeStructured(
        { ...structuredRequest(), modelDeploymentRef: chatDeployment().deploymentRef },
        z.strictObject({ risk: z.string() }),
      );
      expect(result.value).toEqual({ risk: "stable" });
      expect(result.finishReason).toBe("stop");
      const sent = JSON.parse(fetcher.calls[0]!.body!);
      expect(sent.tools).toHaveLength(1);
      expect(sent.tools[0]).toMatchObject({
        type: "function",
        function: { name: "emit_result", parameters: { required: ["risk"] } },
      });
      expect(sent.tool_choice).toBeUndefined();
      expect(sent.tools[0].function.strict).toBeUndefined();
      expect(sent.response_format).toBeUndefined();
      expect(result.usage).toMatchObject({ inputTokens: 120, outputTokens: 3 });
      expect(fetcher.calls).toHaveLength(1);
    },
  );

  it.each([
    { label: "wrong index", patch: { index: 1 }, code: "MODEL_STRUCTURE_INVALID" },
    {
      label: "wrong call type",
      patch: { message: { content: null, tool_calls: [{ ...resultCall(), type: "command" }] } },
      code: "MODEL_PROTOCOL_ERROR",
    },
    {
      label: "missing call identity",
      patch: {
        message: {
          content: null,
          tool_calls: [{ type: "function", function: resultCall().function }],
        },
      },
      code: "MODEL_PROTOCOL_ERROR",
    },
    {
      label: "missing call",
      patch: { message: { content: null } },
      code: "MODEL_STRUCTURE_INVALID",
    },
    {
      label: "empty calls",
      patch: { message: { content: null, tool_calls: [] } },
      code: "MODEL_STRUCTURE_INVALID",
    },
    {
      label: "multiple calls",
      patch: { message: { content: null, tool_calls: [resultCall(), resultCall()] } },
      code: "MODEL_STRUCTURE_INVALID",
    },
    {
      label: "wrong name",
      patch: { message: { content: null, tool_calls: [resultCall(undefined, "other_result")] } },
      code: "MODEL_STRUCTURE_INVALID",
    },
    {
      label: "text result",
      patch: { message: { ...resultMessage, content: '{"risk":"stable"}' } },
      code: "MODEL_STRUCTURE_INVALID",
    },
    {
      label: "stop without function",
      patch: { finish_reason: "stop", message: { content: '{"risk":"stable"}' } },
      code: "MODEL_STRUCTURE_INVALID",
    },
    { label: "truncated", patch: { finish_reason: "length" }, code: "MODEL_STRUCTURE_INVALID" },
    {
      label: "invalid arguments",
      patch: { message: { content: null, tool_calls: [resultCall('{"risk":')] } },
      code: "MODEL_OUTPUT_SCHEMA_INVALID",
    },
    {
      label: "wrong field type",
      patch: { message: { content: null, tool_calls: [resultCall('{"risk":1}')] } },
      code: "MODEL_OUTPUT_SCHEMA_INVALID",
    },
    {
      label: "additional field",
      patch: {
        message: { content: null, tool_calls: [resultCall('{"risk":"stable","extra":1}')] },
      },
      code: "MODEL_OUTPUT_SCHEMA_INVALID",
    },
  ])("rejects function result: $label without retry", async ({ patch, code }) => {
    const fetcher = new ScriptedFetch();
    fetcher.enqueue(
      jsonResponse({
        model: "MiniMax-M3.1-Flash-Preview",
        choices: [{ index: 0, message: resultMessage, finish_reason: "tool_calls", ...patch }],
        usage: { prompt_tokens: 120, completion_tokens: 3, total_tokens: 123 },
      }),
    );
    const error = await gateway(fetcher, [chatDeployment("function-call")])
      .completeStructured(
        { ...structuredRequest(), modelDeploymentRef: chatDeployment().deploymentRef },
        z.strictObject({ risk: z.string() }),
      )
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      code,
      retryable: false,
      rawResponseRef: { kind: "diagnostic-artifact" },
      counts: { inputTokens: 120, outputTokens: 3 },
    });
    expect(fetcher.calls).toHaveLength(1);
  });

  it("strictly validates the backend wrapper and schema-prompt output without repair", async () => {
    expect(
      ModelGatewayDeploymentConfigV1Schema.safeParse({
        backend: "network-api",
        config: { ...chatDeployment(), unexpected: true },
      }).success,
    ).toBe(false);
    const fetcher = new ScriptedFetch();
    fetcher.enqueue(
      jsonResponse({
        model: "MiniMax-M3.1-Flash-Preview",
        choices: [{ index: 0, message: { content: '{"risk":"stable"}' }, finish_reason: "stop" }],
        usage: { prompt_tokens: 120, completion_tokens: 3, total_tokens: 123 },
      }),
    );
    const result = await gateway(fetcher).completeStructured(
      { ...structuredRequest(), modelDeploymentRef: chatDeployment().deploymentRef },
      z.strictObject({ risk: z.string() }),
    );
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
    for (const risk of ["stable", "changing"])
      fetcher.enqueue(
        jsonResponse({
          model: "MiniMax-M3.1-Flash-Preview",
          choices: [
            { index: 0, message: { content: JSON.stringify({ risk }) }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 },
        }),
      );
    const gatewayInstance = gateway(fetcher, [chatDeployment()], store);
    const schema = z.strictObject({ risk: z.string() });
    const first = structuredRequest();
    await gatewayInstance.completeStructured(
      { ...first, modelDeploymentRef: chatDeployment().deploymentRef },
      schema,
    );
    await gatewayInstance.completeStructured(
      {
        ...first,
        invocationId: "invocation-model-second",
        idempotencyKey: "idempotency-model-second",
        modelDeploymentRef: chatDeployment().deploymentRef,
      },
      schema,
    );
    expect(store.commands).toHaveLength(2);
    expect(new Set(store.commands.map(({ commandId }) => commandId)).size).toBe(2);
    expect(
      new Set([...store.artifacts.values()].map(({ bytes }) => new TextDecoder().decode(bytes)))
        .size,
    ).toBe(2);
  });

  it.each([
    { version: "0.40.0", maxInputBytes: 1024 },
    { version: "0.40.3", maxInputBytes: new TextEncoder().encode("风险文本").byteLength },
  ])(
    "probes Ollama $version and preserves embedding order and dimensions",
    async ({ version, maxInputBytes }) => {
      const fetcher = new ScriptedFetch();
      const observations: Record<string, unknown>[] = [];
      fetcher.enqueue(jsonResponse({ version }));
      fetcher.enqueue(
        jsonResponse({
          models: [
            {
              name: "qwen3-embedding:4b",
              model: "qwen3-embedding:4b",
              modified_at: "2026-10-11T00:00:00Z",
              size: 4_000_000_000,
              digest: ollamaDeployment().expectedModelDigest,
              details: { format: "gguf", family: "qwen3" },
            },
          ],
        }),
      );
      fetcher.enqueue(
        jsonResponse({
          model_info: { "qwen3.embedding_length": 2560, "qwen3.context_length": 40960 },
        }),
      );
      fetcher.enqueue(
        jsonResponse({
          model: "qwen3-embedding:4b",
          embeddings: [Array.from({ length: 2560 }, () => 0.1)],
          prompt_eval_count: 3,
          total_duration: 12_000,
          load_duration: 3_000,
          prompt_eval_duration: 4_000,
        }),
      );
      const request = EmbeddingRequestV1Schema.parse({
        ...testRequestBase,
        modelDeploymentRef: ollamaDeployment().deploymentRef,
        texts: ["风险文本"],
        maxInputBytes,
        maxBatchItems: 2,
      });
      const result = await gateway(fetcher, [ollamaDeployment()], undefined, (observation) =>
        observations.push(observation),
      ).embed(request);
      expect(result.vectors[0]).toHaveLength(2560);
      expect(observations).toContainEqual(
        expect.objectContaining({ stage: "probe.version", serverVersion: version }),
      );
      expect(fetcher.calls.map((call) => new URL(call.url).pathname)).toEqual([
        "/api/version",
        "/api/tags",
        "/api/show",
        "/api/embed",
      ]);
      expect(JSON.parse(fetcher.calls.at(-1)!.body!)).toMatchObject({ truncate: false });
      expect(
        fetcher.calls.every(
          (call) =>
            call.method !== "POST" ||
            call.url.endsWith("/api/embed") ||
            call.url.endsWith("/api/show"),
        ),
      ).toBe(true);
    },
  );

  it.each(["0.41.0", "1.0.0", "0.40.3-dev"])(
    "rejects incompatible Ollama version %s and records the observed value",
    async (version) => {
      const fetcher = new ScriptedFetch();
      const observations: Record<string, unknown>[] = [];
      fetcher.enqueue(jsonResponse({ version }));
      const request = EmbeddingRequestV1Schema.parse({
        ...testRequestBase,
        modelDeploymentRef: ollamaDeployment().deploymentRef,
        texts: ["风险文本"],
        maxInputBytes: 1024,
        maxBatchItems: 2,
      });
      await expect(
        gateway(fetcher, [ollamaDeployment()], undefined, (observation) =>
          observations.push(observation),
        ).embed(request),
      ).rejects.toMatchObject({ code: "MODEL_DEPLOYMENT_MISMATCH", stage: "probe.version" });
      expect(observations).toContainEqual(
        expect.objectContaining({
          stage: "probe.version",
          resultCode: "MODEL_DEPLOYMENT_MISMATCH",
          serverVersion: version,
        }),
      );
      expect(fetcher.calls.map((call) => new URL(call.url).pathname)).toEqual(["/api/version"]);
    },
  );

  it.each(["body", "wire", "batch"] as const)(
    "rejects embedding %s budget overflow before HTTP",
    async (boundary) => {
      const fetcher = new ScriptedFetch(),
        store = new ArtifactStoreLatch();
      const text = "风险文本",
        contentBytes = new TextEncoder().encode(text).byteLength;
      const config = {
        ...ollamaDeployment(),
        ...(boundary === "wire" ? { maxInputBytes: contentBytes } : {}),
        ...(boundary === "batch" ? { maxBatchItems: 1 } : {}),
      };
      const request = EmbeddingRequestV1Schema.parse({
        ...testRequestBase,
        modelDeploymentRef: config.deploymentRef,
        texts: boundary === "batch" ? [text, text] : [text],
        maxInputBytes:
          boundary === "body" ? contentBytes - 1 : boundary === "wire" ? contentBytes : 1024,
        maxBatchItems: boundary === "batch" ? 2 : 1,
      });
      const failure = await gateway(fetcher, [config], store)
        .embed(request)
        .catch((error) => error);
      expect(failure).toMatchObject({
        code: boundary === "batch" ? "MODEL_INPUT_INVALID" : "MODEL_CONTEXT_EXCEEDED",
        stage: boundary === "wire" ? "request.input-bytes" : "request.input-budget",
      });
      expect(fetcher.calls).toHaveLength(0);
      expect(store.commands).toHaveLength(0);
    },
  );

  it("rejects Ollama actual usage above the conservative input token bound", async () => {
    const fetcher = new ScriptedFetch();
    fetcher.enqueue(jsonResponse({ version: "0.40.0" }));
    fetcher.enqueue(
      jsonResponse({
        models: [{ name: "qwen3-embedding:4b", digest: ollamaDeployment().expectedModelDigest }],
      }),
    );
    fetcher.enqueue(
      jsonResponse({
        model_info: { "qwen3.embedding_length": 2560, "qwen3.context_length": 40960 },
      }),
    );
    fetcher.enqueue(
      jsonResponse({
        model: "qwen3-embedding:4b",
        embeddings: [Array.from({ length: 2560 }, () => 0.1)],
        prompt_eval_count: 40961,
      }),
    );
    const request = EmbeddingRequestV1Schema.parse({
      ...testRequestBase,
      modelDeploymentRef: ollamaDeployment().deploymentRef,
      texts: ["短文本"],
      maxInputBytes: 1024,
      maxBatchItems: 2,
    });
    await expect(gateway(fetcher, [ollamaDeployment()]).embed(request)).rejects.toMatchObject({
      code: "MODEL_CONTEXT_EXCEEDED",
    });
  });

  it("streams only user-facing content and never persists internal thinking fields or blocks", async () => {
    const fetcher = new ScriptedFetch();
    const store = new ArtifactStoreLatch();
    fetcher.enqueue(
      streamResponse([
        'data: {"choices":[{"index":0,"delta":{"content":"开<th"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"content":"ink>hidden</think>放" ,"reasoning_content":"private"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    const request = ConversationRequestV1Schema.parse({
      ...testRequestBase,
      modelDeploymentRef: chatDeployment().deploymentRef,
      conversationRef: { entityId: "conversation", versionId: "v1" },
      promptTemplateRef: { entityId: "prompt", versionId: "v1" },
      messages: [{ role: "user", content: "说一句话" }],
      maxOutputTokens: 128,
    });
    const handle = createNetworkApiModelGateway({
      deployments: [chatDeployment()],
      artifactStore: store,
      credentials: { "minimax-key": "test-secret" },
      fetchImpl: fetcher.fetch,
      now: () => new Date("2030-01-01T00:00:01.000Z"),
    }).streamConversation(request);
    const text: string[] = [];
    for await (const delta of handle.deltas) text.push(delta.text);
    await handle.completed;
    expect(text.join("")).toBe("开放");
    const persisted = [...store.artifacts.values()]
      .map((artifact) => new TextDecoder().decode(artifact.bytes))
      .join("\n");
    expect(persisted).not.toContain("private");
    expect(persisted).not.toContain("hidden");
  });

  it("rejects a structured action quota below the deployment window before any inference", async () => {
    const fetcher = new ScriptedFetch();
    const schema = z.strictObject({ risk: z.string() });
    const request = { ...structuredRequest(), modelDeploymentRef: chatDeployment().deploymentRef };

    const inputRejected = await gateway(fetcher)
      .completeStructured({ ...request, maxInputTokens: 8 }, schema)
      .catch((value: unknown) => value);
    expect(inputRejected).toMatchObject({
      code: "MODEL_CONTEXT_EXCEEDED",
      counts: { inputTokens: expect.any(Number) },
    });

    const contextRejected = await gateway(fetcher)
      .completeStructured({ ...request, maxContextTokens: 16 }, schema)
      .catch((value: unknown) => value);
    expect(contextRejected).toMatchObject({ code: "MODEL_CONTEXT_EXCEEDED" });
    expect(fetcher.calls).toHaveLength(0);
  });

  it("keeps the durable raw response and actual counts when usage exceeds the action allowance", async () => {
    const fetcher = new ScriptedFetch();
    fetcher.enqueue(
      jsonResponse({
        model: "MiniMax-M3.1-Flash-Preview",
        choices: [{ index: 0, message: { content: '{"risk":"stable"}' }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1_200, completion_tokens: 6, total_tokens: 1_206 },
      }),
    );

    const error = await gateway(fetcher)
      .completeStructured(
        {
          ...structuredRequest(),
          modelDeploymentRef: chatDeployment().deploymentRef,
          maxInputTokens: 1_000,
        },
        z.strictObject({ risk: z.string() }),
      )
      .catch((value: unknown) => value);

    expect(error).toMatchObject({
      code: "MODEL_CONTEXT_EXCEEDED",
      rawResponseRef: { kind: "diagnostic-artifact" },
      counts: { inputTokens: 1_200, outputTokens: 6 },
    });
    expect(fetcher.calls).toHaveLength(1);
  });

  it("retains actual counts when a persisted response fails post-parse validation", async () => {
    const schema = z.strictObject({ risk: z.string() });
    const request = { ...structuredRequest(), modelDeploymentRef: chatDeployment().deploymentRef };

    const shapeFetcher = new ScriptedFetch();
    shapeFetcher.enqueue(
      jsonResponse({
        model: "MiniMax-M3.1-Flash-Preview",
        choices: [{ index: 0, message: { content: '{"risk":1}' }, finish_reason: "stop" }],
        usage: { prompt_tokens: 90, completion_tokens: 4, total_tokens: 94 },
      }),
    );
    const shapeError = await gateway(shapeFetcher)
      .completeStructured(request, schema)
      .catch((value: unknown) => value);
    expect(shapeError).toMatchObject({
      code: "MODEL_OUTPUT_SCHEMA_INVALID",
      rawResponseRef: { kind: "diagnostic-artifact" },
      counts: { inputTokens: 90, outputTokens: 4 },
    });

    const protocolFetcher = new ScriptedFetch();
    protocolFetcher.enqueue(
      jsonResponse({
        choices: [{ index: 0, message: { content: "x" }, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 70, completion_tokens: 2, total_tokens: 72 },
      }),
    );
    const protocolError = await gateway(protocolFetcher)
      .completeStructured(request, schema)
      .catch((value: unknown) => value);
    expect(protocolError).toMatchObject({
      code: "MODEL_PROTOCOL_ERROR",
      rawResponseRef: { kind: "diagnostic-artifact" },
      counts: { inputTokens: 70, outputTokens: 2 },
    });
  });
});
