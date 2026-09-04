import { describe, expect, it } from "vitest";

import { makeArtifactError } from "@riskflow/core/artifacts";
import {
  ConversationRequestV1Schema,
  EmbeddingRequestV1Schema,
  ModelGatewayError,
  z,
} from "@riskflow/core/model";

import { createModelGateway } from "../../src/model/index.js";

import {
  ArtifactStoreLatch,
  ScriptedFetch,
  jsonResponse,
  modelProbeResponses,
  structuredRequest,
  streamResponse,
  testDeployment,
  testRequestBase,
} from "./fixture.js";

const deployment = (): typeof testDeployment => ({ ...testDeployment });

const gatewayWith = (fetcher: ScriptedFetch, store = new ArtifactStoreLatch()) => ({
  gateway: createModelGateway({
    deployments: [deployment()],
    artifactStore: store,
    fetchImpl: fetcher.fetch,
    now: () => new Date("2030-01-01T00:00:01.000Z"),
  }),
  store,
});

const queueProbe = (fetcher: ScriptedFetch): void => {
  for (const response of modelProbeResponses()) fetcher.enqueue(response);
};

describe("llama.cpp model gateway", () => {
  it("probes once and durably re-reads structured responses before returning", async () => {
    const fetcher = new ScriptedFetch();
    const { gateway, store } = gatewayWith(fetcher);
    queueProbe(fetcher);
    fetcher.enqueue(jsonResponse({ tokens: 5 }));
    fetcher.enqueue(
      jsonResponse({
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: '{"risk":"stable"}' },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    );

    const result = await gateway.completeStructured(
      structuredRequest(),
      z.strictObject({ risk: z.string() }),
    );

    expect(result.value).toEqual({ risk: "stable" });
    expect(fetcher.calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/health",
      "/props",
      "/v1/models",
      "/v1/chat/completions/input_tokens",
      "/v1/chat/completions",
    ]);
    expect(JSON.parse(fetcher.calls.at(-1)!.body!).model).toBe(testDeployment.modelAlias);
    expect(store.events).toEqual(["put:start", "put:done", "open:start", "verified"]);
    expect(store.commands[0]!.idempotencyKey).toContain("idempotency-model");
  });

  it("keeps embedding order and rejects an out-of-order batch without repair", async () => {
    const fetcher = new ScriptedFetch();
    const { gateway, store } = gatewayWith(fetcher);
    queueProbe(fetcher);
    fetcher.enqueue(jsonResponse({ tokens: [1, 2] }));
    fetcher.enqueue(jsonResponse({ tokens: [3, 4] }));
    fetcher.enqueue(
      jsonResponse({
        data: [
          { index: 1, embedding: [0.2, 0.3, 0.4] },
          { index: 0, embedding: [0.1, 0.2, 0.3] },
        ],
      }),
    );
    const request = EmbeddingRequestV1Schema.parse({
      ...testRequestBase,
      texts: ["第一项", "第二项"],
      maxInputBytes: 1024,
      maxBatchItems: 2,
    });

    await expect(gateway.embed(request)).rejects.toMatchObject({
      code: "MODEL_EMBEDDING_INVALID",
      rawResponseRef: { kind: "diagnostic-artifact" },
    });
  });

  it("returns a complete embedding batch at the frozen dimension", async () => {
    const fetcher = new ScriptedFetch();
    const { gateway, store } = gatewayWith(fetcher);
    queueProbe(fetcher);
    fetcher.enqueue(jsonResponse({ tokens: [1, 2] }));
    fetcher.enqueue(jsonResponse({ tokens: [3] }));
    fetcher.enqueue(
      jsonResponse({
        data: [
          { index: 0, embedding: [0.1, 0.2, 0.3] },
          { index: 1, embedding: [0.4, 0.5, 0.6] },
        ],
        usage: { prompt_tokens: 3 },
      }),
    );
    const request = EmbeddingRequestV1Schema.parse({
      ...testRequestBase,
      texts: ["第一项", "第二项"],
      maxInputBytes: 1024,
      maxBatchItems: 2,
    });

    const result = await gateway.embed(request);

    expect(result.vectors).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    expect(result.dimensions).toBe(3);
    expect(store.events).toEqual(["put:start", "put:done", "open:start", "verified"]);
  });

  it("emits only content deltas and waits for finish, DONE, EOF, and put", async () => {
    const fetcher = new ScriptedFetch();
    const { gateway, store } = gatewayWith(fetcher);
    queueProbe(fetcher);
    fetcher.enqueue(jsonResponse({ tokens: 5 }));
    const body = new TextEncoder().encode(
      [
        'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"安"},"finish_reason":null}]}',
        'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"全","reasoning_content":"hidden","tool_calls":[]},"finish_reason":null}]}',
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
    );
    const splitAt = body.findIndex((byte, index) => index > 0 && byte >= 0x80);
    fetcher.enqueue(streamResponse([body.slice(0, splitAt + 1), body.slice(splitAt + 1)]));
    const request = ConversationRequestV1Schema.parse({
      ...testRequestBase,
      conversationRef: { entityId: "conversation", versionId: "v1" },
      promptTemplateRef: { entityId: "prompt", versionId: "v1" },
      messages: [{ role: "user", content: "继续" }],
      maxOutputTokens: 128,
    });

    const handle = gateway.streamConversation(request);
    const deltas: string[] = [];
    for await (const delta of handle.deltas) deltas.push(delta.text);
    const receipt = await handle.completed;

    expect(deltas).toEqual(["安", "全"]);
    expect(receipt.finishReason).toBe("stop");
    expect(receipt.deltaCount).toBe(2);
    expect(receipt.rawResponseRef.kind).toBe("diagnostic-artifact");
    expect(store.events.at(-1)).toBe("put:done");
  });

  it("rejects before fetch when the authorization context does not match", async () => {
    const fetcher = new ScriptedFetch();
    const { gateway } = gatewayWith(fetcher);
    const request = { ...structuredRequest(), projectId: "other-project" };

    await expect(
      gateway.completeStructured(request, z.strictObject({ risk: z.string() })),
    ).rejects.toMatchObject({ code: "MODEL_AUTHORIZATION_DENIED" });
    expect(fetcher.calls).toHaveLength(0);
  });

  it("returns a closed service error when the deployment cannot connect", async () => {
    const fetcher = new ScriptedFetch();
    const { gateway, store } = gatewayWith(fetcher);
    fetcher.enqueueError(new TypeError("connection refused"));

    const error = await gateway
      .embed(
        EmbeddingRequestV1Schema.parse({
          ...testRequestBase,
          texts: ["地层"],
          maxInputBytes: 1024,
          maxBatchItems: 1,
        }),
      )
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ModelGatewayError);
    expect((error as ModelGatewayError).code).toBe("MODEL_SERVICE_UNAVAILABLE");
    expect(store.events).toEqual(["put:start", "put:done"]);
  });

  it.each([
    [429, true],
    [503, true],
    [400, false],
  ])("maps HTTP %s without retrying the model request", async (status, retryable) => {
    const fetcher = new ScriptedFetch();
    const { gateway } = gatewayWith(fetcher);
    queueProbe(fetcher);
    fetcher.enqueue(jsonResponse({ tokens: 5 }));
    fetcher.enqueue(jsonResponse({ error: { code: "upstream_failure" } }, status));

    const error = await gateway
      .completeStructured(structuredRequest(), z.strictObject({ risk: z.string() }))
      .catch((value: unknown) => value);

    expect(error).toMatchObject({
      code: "MODEL_HTTP_ERROR",
      retryable,
      rawResponseRef: { kind: "diagnostic-artifact" },
    });
    expect(fetcher.calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/health",
      "/props",
      "/v1/models",
      "/v1/chat/completions/input_tokens",
      "/v1/chat/completions",
    ]);
  });

  it("distinguishes invalid JSON from a valid JSON value rejected by Zod", async () => {
    const invalidJsonFetcher = new ScriptedFetch();
    const { gateway: invalidJsonGateway } = gatewayWith(invalidJsonFetcher);
    queueProbe(invalidJsonFetcher);
    invalidJsonFetcher.enqueue(jsonResponse({ tokens: 5 }));
    invalidJsonFetcher.enqueue(
      jsonResponse({ choices: [{ index: 0, message: { content: '{"risk":' }, finish_reason: "stop" }] }),
    );

    const invalidJson = await invalidJsonGateway
      .completeStructured(structuredRequest(), z.strictObject({ risk: z.string() }))
      .catch((value: unknown) => value);
    expect(invalidJson).toMatchObject({
      code: "MODEL_STRUCTURE_INVALID",
      rawResponseRef: { kind: "diagnostic-artifact" },
    });

    const invalidShapeFetcher = new ScriptedFetch();
    const { gateway: invalidShapeGateway } = gatewayWith(invalidShapeFetcher);
    queueProbe(invalidShapeFetcher);
    invalidShapeFetcher.enqueue(jsonResponse({ tokens: 5 }));
    invalidShapeFetcher.enqueue(
      jsonResponse({
        choices: [{ index: 0, message: { content: '{"risk":1}' }, finish_reason: "stop" }],
      }),
    );

    const invalidShape = await invalidShapeGateway
      .completeStructured(structuredRequest(), z.strictObject({ risk: z.string() }))
      .catch((value: unknown) => value);
    expect(invalidShape).toMatchObject({
      code: "MODEL_OUTPUT_SCHEMA_INVALID",
      rawResponseRef: { kind: "diagnostic-artifact" },
    });
  });

  it("rejects context overflow and expired calls before network side effects", async () => {
    const contextFetcher = new ScriptedFetch();
    const { gateway: contextGateway } = gatewayWith(contextFetcher);
    queueProbe(contextFetcher);
    contextFetcher.enqueue(jsonResponse({ tokens: 4_000 }));
    const contextError = await contextGateway
      .completeStructured(structuredRequest(), z.strictObject({ risk: z.string() }))
      .catch((value: unknown) => value);
    expect(contextError).toMatchObject({ code: "MODEL_CONTEXT_EXCEEDED" });
    expect(contextFetcher.calls).toHaveLength(4);

    const expiredFetcher = new ScriptedFetch();
    const { gateway: expiredGateway } = gatewayWith(expiredFetcher);
    const expired = await expiredGateway
      .completeStructured(
        { ...structuredRequest(), deadlineAt: "2030-01-01T00:00:00.500Z" },
        z.strictObject({ risk: z.string() }),
      )
      .catch((value: unknown) => value);
    expect(expired).toMatchObject({ code: "MODEL_REQUEST_TIMEOUT" });
    expect(expiredFetcher.calls).toHaveLength(0);
  });

  it("rejects a partial stream with its durable raw response", async () => {
    const fetcher = new ScriptedFetch();
    const { gateway } = gatewayWith(fetcher);
    queueProbe(fetcher);
    fetcher.enqueue(jsonResponse({ tokens: 5 }));
    fetcher.enqueue(
      streamResponse(['data: {"choices":[{"index":0,"delta":{"content":"部分"},"finish_reason":null}]}\n\n']),
    );

    const handle = gateway.streamConversation({
      ...testRequestBase,
      conversationRef: { entityId: "conversation", versionId: "v1" },
      promptTemplateRef: { entityId: "prompt", versionId: "v1" },
      messages: [{ role: "user", content: "继续" }],
      maxOutputTokens: 128,
    });
    const error = await handle.completed.catch((value: unknown) => value);
    expect(error).toMatchObject({
      code: "MODEL_STREAM_INTERRUPTED",
      rawResponseRef: { kind: "diagnostic-artifact" },
    });
  });

  it("fails closed when the streaming artifact cannot be persisted", async () => {
    const fetcher = new ScriptedFetch();
    const store = new ArtifactStoreLatch();
    store.failNextPut();
    const { gateway } = gatewayWith(fetcher, store);
    queueProbe(fetcher);
    fetcher.enqueue(jsonResponse({ tokens: 5 }));
    fetcher.enqueue(
      streamResponse([
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );

    const handle = gateway.streamConversation({
      ...testRequestBase,
      conversationRef: { entityId: "conversation", versionId: "v1" },
      promptTemplateRef: { entityId: "prompt", versionId: "v1" },
      messages: [{ role: "user", content: "继续" }],
      maxOutputTokens: 128,
    });
    await expect(handle.completed).rejects.toMatchObject({
      code: "MODEL_ARTIFACT_PERSISTENCE_FAILED",
      diagnosticRef: { kind: "diagnostic-artifact" },
    });
  });

  it("surfaces C04 idempotency conflicts without retrying", async () => {
    const fetcher = new ScriptedFetch();
    const store = new ArtifactStoreLatch();
    store.failNextPut(makeArtifactError("ARTIFACT_IDEMPOTENCY_CONFLICT", "artifact.put"));
    const { gateway } = gatewayWith(fetcher, store);
    queueProbe(fetcher);
    fetcher.enqueue(jsonResponse({ tokens: 5 }));
    fetcher.enqueue(
      jsonResponse({
        choices: [{ index: 0, message: { content: '{"risk":"stable"}' }, finish_reason: "stop" }],
      }),
    );

    const error = await gateway
      .completeStructured(structuredRequest(), z.strictObject({ risk: z.string() }))
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      code: "MODEL_IDEMPOTENCY_CONFLICT",
      idempotencyKey: "idempotency-model",
      diagnosticRef: { kind: "diagnostic-artifact" },
    });
    expect(fetcher.calls).toHaveLength(5);
  });
});
