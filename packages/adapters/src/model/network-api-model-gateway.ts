import {
  ArtifactPutCommandV1Schema,
  ArtifactPutResultV1Schema,
  ArtifactStoreError,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  ConversationReceiptV1Schema,
  ConversationRequestV1Schema,
  ConversationTextDeltaV1Schema,
  EmbeddingRequestV1Schema,
  EmbeddingResultV1Schema,
  MODEL_GATEWAY_ERROR_CATEGORY_V1,
  ModelGatewayError,
  ModelGatewayErrorV1Schema,
  ModelTerminationReasonV1Schema,
  StructuredCompletionRequestV1Schema,
  structuredCompletionResultSchema,
  modelGatewayError,
  z,
  type ConversationReceiptV1,
  type ConversationRequestV1,
  type ConversationTextDeltaV1,
  type EmbeddingRequestV1,
  type EmbeddingResultV1,
  type ModelGatewayErrorCodeV1,
  type ModelGatewayErrorV1,
  type ModelGatewayPortV1,
  type ModelUsageV1,
  type StructuredCompletionRequestV1,
  type StructuredCompletionResultV1,
  type ZodType,
} from "@riskflow/core/model";
import type { DiagnosticArtifactRefV1 } from "@riskflow/contracts/ports";

import {
  NetworkApiDeploymentConfigV1Schema,
  llamaCppDeploymentKey,
  type NetworkApiDeploymentConfigV1,
} from "./config.js";
import {
  assertModelGatewayRequestBudget,
  conservativeTokenUpperBound,
  decodeJson,
  hasAuthorizationMismatch,
  inputBytesForMessages,
  inputBytesForTexts,
  OneSlotQueue,
  persistRawModelResponse,
  preflightParentArtifacts,
  PersistedResponseLimitError,
  readBoundedBytes,
  ResponseBodyLimitError,
  usageFromWire,
  type ModelGatewayRequestV1,
  type ParentArtifactPreflightV1,
} from "./model-gateway-runtime.js";

const nonNegativeInteger = z.number().int().refine(Number.isSafeInteger).nonnegative();
const ChatResponseSchema = z
  .object({
    model: z.string().optional(),
    choices: z.array(
      z
        .object({
          index: nonNegativeInteger,
          message: z.object({ content: z.string().nullable().optional() }).passthrough(),
          finish_reason: z.union([ModelTerminationReasonV1Schema, z.null()]),
        })
        .passthrough(),
    ),
    usage: z.unknown().optional(),
  })
  .passthrough();
const EmbeddingResponseSchema = z.object({
  model: z.string(),
  embeddings: z.array(z.array(z.number().refine(Number.isFinite))),
  prompt_eval_count: nonNegativeInteger,
});
const OllamaVersionSchema = z.object({ version: z.string() });
const OllamaTagsSchema = z.object({
  models: z.array(z.object({ name: z.string(), digest: z.string() })),
});

type Request = ModelGatewayRequestV1;
type Capability = "completeStructured" | "embed" | "streamConversation";
type CallControl = {
  readonly signal: AbortSignal;
  readonly reason: () => "caller" | "deadline" | "request-timeout" | "idle" | undefined;
  resetIdle(): void;
  stopIdle(): void;
  cleanup(): void;
};

export interface NetworkApiModelGatewayObservationV1 {
  readonly capability: Capability;
  readonly stage: string;
  readonly resultCode: string;
  readonly elapsedMs: number;
  readonly inputBytes?: number;
  readonly responseBytes?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly deltaCount?: number;
  readonly rawResponseRef?: DiagnosticArtifactRefV1;
}

export type NetworkApiModelGatewayObserverV1 = (value: NetworkApiModelGatewayObservationV1) => void;

export interface NetworkApiModelGatewayOptionsV1 {
  readonly deployments: readonly NetworkApiDeploymentConfigV1[];
  readonly artifactStore: ArtifactStoreV1;
  readonly credentials?: Readonly<Record<string, string>>;
  readonly resolveCredential?: (credentialRef: string) => string | undefined;
  readonly parentArtifactPreflight?: ParentArtifactPreflightV1;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  readonly observe?: NetworkApiModelGatewayObserverV1;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const stripThinking = (value: string): string =>
  value.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think\s*>|$)/gi, "");

class ThinkingContentFilter {
  #pending = "";
  #thinking = false;

  push(chunk: string, final = false): string {
    this.#pending += chunk;
    let visible = "";
    for (;;) {
      if (this.#thinking) {
        const end = /<\/think\s*>/i.exec(this.#pending);
        if (end === null) {
          this.#pending = final ? "" : this.#pending.slice(-16);
          return visible;
        }
        this.#pending = this.#pending.slice(end.index + end[0].length);
        this.#thinking = false;
        continue;
      }
      const start = /<think\b[^>]*>/i.exec(this.#pending);
      if (start !== null) {
        visible += this.#pending.slice(0, start.index);
        this.#pending = this.#pending.slice(start.index + start[0].length);
        this.#thinking = true;
        continue;
      }
      if (final) {
        visible += this.#pending;
        this.#pending = "";
        return visible;
      }
      const hold = Math.min(this.#pending.length, 16);
      visible += this.#pending.slice(0, this.#pending.length - hold);
      this.#pending = this.#pending.slice(this.#pending.length - hold);
      return visible;
    }
  }
}

const sanitizeProtocolValue = (value: unknown): unknown => {
  if (typeof value === "string") return stripThinking(value);
  if (Array.isArray(value)) return value.map(sanitizeProtocolValue);
  const object = record(value);
  if (object === undefined) return value;
  return Object.fromEntries(
    Object.entries(object)
      .filter(
        ([key]) =>
          !["reasoning_content", "reasoning_details", "thinking", "thoughts"].includes(key),
      )
      .map(([key, child]) => [key, sanitizeProtocolValue(child)]),
  );
};

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const chunksOf = async function* (value: Uint8Array): AsyncGenerator<Uint8Array> {
  yield value;
};
const retryableStatus = (status: number): boolean => [408, 429, 502, 503, 504].includes(status);

export class NetworkApiModelGateway implements ModelGatewayPortV1 {
  readonly #deployments: ReadonlyMap<string, NetworkApiDeploymentConfigV1>;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #credentials: Readonly<Record<string, string>>;
  readonly #resolveCredential: NetworkApiModelGatewayOptionsV1["resolveCredential"];
  readonly #parentPreflight: ParentArtifactPreflightV1 | undefined;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #observe: NetworkApiModelGatewayObserverV1 | undefined;
  readonly #probes = new Map<string, Promise<void>>();

  constructor(options: NetworkApiModelGatewayOptionsV1) {
    this.#artifactStore = options.artifactStore;
    this.#credentials = options.credentials ?? Object.freeze({});
    this.#resolveCredential = options.resolveCredential;
    this.#parentPreflight = options.parentArtifactPreflight;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#observe = options.observe;
    const deployments = new Map<string, NetworkApiDeploymentConfigV1>();
    for (const input of options.deployments) {
      const config = NetworkApiDeploymentConfigV1Schema.parse(input);
      const key = llamaCppDeploymentKey(config.deploymentRef);
      if (deployments.has(key)) throw new Error("duplicate model deployment reference");
      deployments.set(key, config);
    }
    this.#deployments = deployments;
  }

  completeStructured<T>(
    request: StructuredCompletionRequestV1,
    schema: ZodType<T>,
    signal?: AbortSignal,
  ): Promise<StructuredCompletionResultV1<T>> {
    return this.#complete(request, schema, signal);
  }

  embed(request: EmbeddingRequestV1, signal?: AbortSignal): Promise<EmbeddingResultV1> {
    return this.#embed(request, signal);
  }

  streamConversation(
    request: ConversationRequestV1,
    signal?: AbortSignal,
  ): {
    readonly deltas: AsyncIterable<ConversationTextDeltaV1>;
    readonly completed: Promise<ConversationReceiptV1>;
  } {
    const abort = new AbortController();
    const channel = new OneSlotQueue<ConversationTextDeltaV1>(() => abort.abort());
    const parsed = ConversationRequestV1Schema.safeParse(request);
    if (!parsed.success) {
      const error = this.#invalid(request, hasAuthorizationMismatch(request));
      channel.close(error);
      return { deltas: channel, completed: Promise.reject(error) };
    }
    const completed = this.#stream(
      parsed.data,
      signal ? AbortSignal.any([signal, abort.signal]) : abort.signal,
      channel,
    );
    void completed.then(
      () => channel.close(),
      (error: unknown) => channel.close(error),
    );
    return { deltas: channel, completed };
  }

  async #complete<T>(
    input: StructuredCompletionRequestV1,
    outputSchema: ZodType<T>,
    signal?: AbortSignal,
  ): Promise<StructuredCompletionResultV1<T>> {
    const request = this.#parse(StructuredCompletionRequestV1Schema, input);
    const config = this.#deployment(request, "completeStructured", "openai-chat");
    const schema = this.#jsonSchema(request, outputSchema);
    const schemaSystem = `Return exactly one JSON value satisfying this JSON Schema. Do not include commentary. Schema: ${JSON.stringify(schema)}`;
    const messages =
      config.structuredOutputMode === "schema-prompt"
        ? [{ role: "system" as const, content: schemaSystem }, ...request.messages]
        : request.messages;
    const payload = {
      model: config.modelId,
      messages,
      max_tokens: request.maxOutputTokens,
      reasoning_effort: config.reasoningEffort,
      ...(config.structuredOutputMode === "server-json-schema"
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: "riskflow_output", strict: true, schema },
            },
          }
        : {}),
    };
    const requestBytes = bytes(JSON.stringify(payload)).byteLength;
    let inputTokenLimit: number;
    let control: CallControl | undefined;
    const startedAt = Date.now();
    try {
      inputTokenLimit = this.#assertBudget(request, config, requestBytes, requestBytes);
      await this.#runPreflight(request);
      control = this.#control(request, config, signal);
      const response = await this.#post(
        config,
        request,
        control,
        "chat/completions",
        payload,
        "chat.complete",
      );
      const rawBytes = await this.#readAndPersist(
        response,
        request,
        "complete",
        config.maxResponseBytes,
        "application/json",
      );
      if (!response.ok)
        throw this.#http(
          request,
          response.status,
          "chat.http",
          rawBytes.ref,
          rawBytes.bytes.byteLength,
        );
      let wire: z.infer<typeof ChatResponseSchema>;
      try {
        wire = ChatResponseSchema.parse(decodeJson(rawBytes.bytes));
      } catch {
        throw this.#error(request, "MODEL_PROTOCOL_ERROR", "chat.protocol", false, {
          rawResponseRef: rawBytes.ref,
        });
      }
      if (
        wire.model !== config.modelId ||
        wire.choices.length !== 1 ||
        wire.choices[0]?.index !== 0 ||
        wire.choices[0].finish_reason !== "stop" ||
        typeof wire.choices[0].message.content !== "string"
      )
        throw this.#error(request, "MODEL_STRUCTURE_INVALID", "chat.choice", false, {
          rawResponseRef: rawBytes.ref,
        });
      const usage = this.#usage(
        request,
        wire.usage,
        request.maxOutputTokens,
        inputTokenLimit,
        config.contextWindowTokens,
      );
      let value: T;
      try {
        const output = JSON.parse(stripThinking(wire.choices[0].message.content));
        this.#assertNoAdditionalProperties(output, schema);
        value = outputSchema.parse(output);
      } catch {
        throw this.#error(request, "MODEL_OUTPUT_SCHEMA_INVALID", "chat.output-schema", false, {
          rawResponseRef: rawBytes.ref,
        });
      }
      const result = structuredCompletionResultSchema(outputSchema).parse({
        schemaVersion: "1",
        invocationId: request.invocationId,
        modelDeploymentRef: config.deploymentRef,
        serverBuildRef: config.serviceContractRef,
        modelVersionRef: config.modelVersionRef,
        usage,
        rawResponseRef: rawBytes.ref,
        promptTemplateRef: request.promptTemplateRef,
        outputSchemaRef: request.outputSchemaRef,
        value,
        finishReason: "stop",
      }) as StructuredCompletionResultV1<T>;
      this.#emit("completeStructured", "complete", "ok", startedAt, {
        inputBytes: requestBytes,
        responseBytes: rawBytes.bytes.byteLength,
        ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
        ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
        rawResponseRef: rawBytes.ref,
      });
      return result;
    } catch (error) {
      const failure = await this.#failure(request, this.#map(error, request, control), "complete");
      this.#emit("completeStructured", "complete", failure.code, startedAt, {
        inputBytes: requestBytes,
        ...(failure.counts?.responseBytes === undefined
          ? {}
          : { responseBytes: failure.counts.responseBytes }),
        ...(failure.rawResponseRef === undefined ? {} : { rawResponseRef: failure.rawResponseRef }),
      });
      throw failure;
    } finally {
      control?.cleanup();
    }
  }

  async #embed(input: EmbeddingRequestV1, signal?: AbortSignal): Promise<EmbeddingResultV1> {
    const request = this.#parse(EmbeddingRequestV1Schema, input);
    const config = this.#deployment(request, "embed", "ollama-embed");
    const body = { model: config.modelId, input: request.texts, truncate: false };
    const inputBytes = inputBytesForTexts(request.texts);
    let inputTokenLimit: number;
    let control: CallControl | undefined;
    const startedAt = Date.now();
    try {
      const serializedBytes = bytes(JSON.stringify(body)).byteLength;
      inputTokenLimit = this.#assertBudget(request, config, serializedBytes, serializedBytes);
      await this.#runPreflight(request);
      control = this.#control(request, config, signal);
      await this.#ensureOllama(request, config, control);
      const response = await this.#post(
        config,
        request,
        control,
        "api/embed",
        body,
        "embedding.request",
      );
      const raw = await this.#readAndPersist(
        response,
        request,
        "embed",
        config.maxResponseBytes,
        "application/json",
      );
      if (!response.ok)
        throw this.#http(request, response.status, "embedding.http", raw.ref, raw.bytes.byteLength);
      let wire: z.infer<typeof EmbeddingResponseSchema>;
      try {
        wire = EmbeddingResponseSchema.parse(decodeJson(raw.bytes));
      } catch {
        throw this.#error(request, "MODEL_PROTOCOL_ERROR", "embedding.protocol", false, {
          rawResponseRef: raw.ref,
        });
      }
      if (
        wire.model !== config.modelId ||
        wire.embeddings.length !== request.texts.length ||
        wire.embeddings.some((v) => v.length !== config.embeddingDimensions)
      )
        throw this.#error(request, "MODEL_EMBEDDING_INVALID", "embedding.shape", false, {
          rawResponseRef: raw.ref,
          counts: { batchItems: wire.embeddings.length },
        });
      if (
        wire.prompt_eval_count > inputTokenLimit ||
        wire.prompt_eval_count > config.contextWindowTokens
      )
        throw this.#error(request, "MODEL_CONTEXT_EXCEEDED", "usage.budget", false, {
          rawResponseRef: raw.ref,
          counts: { inputTokens: wire.prompt_eval_count },
        });
      const usage = { available: true as const, inputTokens: wire.prompt_eval_count };
      const result = EmbeddingResultV1Schema.parse({
        schemaVersion: "1",
        invocationId: request.invocationId,
        modelDeploymentRef: config.deploymentRef,
        serverBuildRef: config.serviceContractRef,
        modelVersionRef: config.modelVersionRef,
        usage,
        rawResponseRef: raw.ref,
        vectors: wire.embeddings,
        dimensions: config.embeddingDimensions,
      });
      this.#emit("embed", "embed", "ok", startedAt, {
        inputBytes,
        responseBytes: raw.bytes.byteLength,
        inputTokens: usage.inputTokens,
        rawResponseRef: raw.ref,
      });
      return result;
    } catch (error) {
      const failure = await this.#failure(request, this.#map(error, request, control), "embed");
      this.#emit("embed", "embed", failure.code, startedAt, {
        inputBytes,
        ...(failure.counts?.responseBytes === undefined
          ? {}
          : { responseBytes: failure.counts.responseBytes }),
        ...(failure.rawResponseRef === undefined ? {} : { rawResponseRef: failure.rawResponseRef }),
      });
      throw failure;
    } finally {
      control?.cleanup();
    }
  }

  async #stream(
    request: ConversationRequestV1,
    signal: AbortSignal,
    output: OneSlotQueue<ConversationTextDeltaV1>,
  ): Promise<ConversationReceiptV1> {
    const config = this.#deployment(request, "streamConversation", "openai-chat");
    const payload = {
      model: config.modelId,
      messages: request.messages,
      max_tokens: request.maxOutputTokens,
      reasoning_effort: config.reasoningEffort,
      stream: true,
      stream_options: { include_usage: true },
    };
    const inputBytes = inputBytesForMessages(request.messages);
    const requestBytes = bytes(JSON.stringify(payload)).byteLength;
    let inputTokenLimit: number;
    let control: CallControl | undefined;
    const startedAt = Date.now();
    try {
      inputTokenLimit = this.#assertBudget(request, config, requestBytes, requestBytes);
      await this.#runPreflight(request);
      control = this.#control(request, config, signal);
      const response = await this.#post(
        config,
        request,
        control,
        "chat/completions",
        payload,
        "chat.stream",
      );
      if (!response.ok) {
        const raw = await this.#readAndPersist(
          response,
          request,
          "stream-error",
          config.maxResponseBytes,
          "application/json",
        );
        throw this.#http(request, response.status, "stream.http", raw.ref, raw.bytes.byteLength);
      }
      if (!response.body)
        throw this.#error(request, "MODEL_STREAM_INTERRUPTED", "stream.body", true);
      control.resetIdle();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let lineBuffer = "";
      let responseBytes = 0;
      let deltaCount = 0;
      let sequence = 0;
      let finishReason: "stop" | "length" | undefined;
      let wireUsage: unknown;
      let done = false;
      const thinking = new ThinkingContentFilter();
      const evidence: Uint8Array[] = [];
      const processLine = async (line: string): Promise<void> => {
        if (!line.startsWith("data:")) return;
        const data = line.slice(5).trimStart();
        if (data === "[DONE]") {
          done = true;
          return;
        }
        let event: Record<string, unknown>;
        try {
          event = record(JSON.parse(data)) ?? {};
        } catch {
          throw this.#error(request, "MODEL_PROTOCOL_ERROR", "stream.event", false);
        }
        const choices = Array.isArray(event.choices) ? event.choices : [];
        if (event.model !== undefined) {
          if (event.model !== config.modelId)
            throw this.#error(request, "MODEL_DEPLOYMENT_MISMATCH", "stream.model", false);
        }
        if (event.usage !== undefined) wireUsage = event.usage;
        if (choices.length > 1)
          throw this.#error(request, "MODEL_PROTOCOL_ERROR", "stream.choices", false);
        const choice = record(choices[0]);
        if (!choice) return;
        if (choice.index !== 0)
          throw this.#error(request, "MODEL_PROTOCOL_ERROR", "stream.choice-index", false);
        if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
          const parsed = ModelTerminationReasonV1Schema.safeParse(choice.finish_reason);
          if (!parsed.success)
            throw this.#error(request, "MODEL_PROTOCOL_ERROR", "stream.finish", false);
          finishReason = parsed.data;
        }
        const delta = record(choice.delta) ?? {};
        const content = typeof delta.content === "string" ? thinking.push(delta.content) : "";
        const clean = sanitizeProtocolValue(event);
        const cleanEvent = record(clean)!;
        const safeChoices = Array.isArray(cleanEvent.choices) ? cleanEvent.choices : [];
        const safeChoice = record(safeChoices[0]);
        const safeDelta = safeChoice && record(safeChoice.delta);
        if (safeDelta && typeof delta.content === "string") safeDelta.content = content;
        evidence.push(bytes(`data: ${JSON.stringify(cleanEvent)}\n\n`));
        if (content.length) {
          await output.push(
            ConversationTextDeltaV1Schema.parse({
              schemaVersion: "1",
              sequence: sequence++,
              text: content,
            }),
          );
          deltaCount++;
        }
      };
      for await (const chunk of this.#readStream(response.body)) {
        responseBytes += chunk.byteLength;
        if (responseBytes > config.maxResponseBytes)
          throw new ResponseBodyLimitError(new Uint8Array());
        control.resetIdle();
        lineBuffer += decoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = lineBuffer.indexOf("\n")) >= 0) {
          const line = lineBuffer.slice(0, newline).replace(/\r$/, "");
          lineBuffer = lineBuffer.slice(newline + 1);
          await processLine(line);
        }
      }
      lineBuffer += decoder.decode();
      if (lineBuffer.trim()) await processLine(lineBuffer.replace(/\r$/, ""));
      const trailing = thinking.push("", true);
      if (trailing) {
        await output.push(
          ConversationTextDeltaV1Schema.parse({
            schemaVersion: "1",
            sequence: sequence++,
            text: trailing,
          }),
        );
        deltaCount++;
        evidence.push(
          bytes(
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: trailing }, finish_reason: null }] })}\n\n`,
          ),
        );
      }
      if (!done || finishReason === undefined || wireUsage === undefined)
        throw this.#error(request, "MODEL_STREAM_INTERRUPTED", "stream.terminal", true, {
          counts: { responseBytes, deltaCount },
        });
      const usageFinal = this.#usage(
        request,
        wireUsage,
        request.maxOutputTokens,
        inputTokenLimit,
        config.contextWindowTokens,
      );
      const raw = await this.#persistSanitized(
        request,
        concat(evidence),
        "stream",
        config.maxResponseBytes,
        "text/event-stream",
      );
      const receipt = ConversationReceiptV1Schema.parse({
        schemaVersion: "1",
        invocationId: request.invocationId,
        modelDeploymentRef: config.deploymentRef,
        serverBuildRef: config.serviceContractRef,
        modelVersionRef: config.modelVersionRef,
        usage: usageFinal,
        rawResponseRef: raw.ref,
        conversationRef: request.conversationRef,
        promptTemplateRef: request.promptTemplateRef,
        finishReason,
        deltaCount,
        responseByteLength: responseBytes,
      });
      this.#emit("streamConversation", "stream", "ok", startedAt, {
        inputBytes,
        responseBytes,
        ...(usageFinal.inputTokens === undefined ? {} : { inputTokens: usageFinal.inputTokens }),
        ...(usageFinal.outputTokens === undefined ? {} : { outputTokens: usageFinal.outputTokens }),
        deltaCount,
        rawResponseRef: raw.ref,
      });
      return receipt;
    } catch (error) {
      const failure = await this.#failure(request, this.#map(error, request, control), "stream");
      this.#emit("streamConversation", "stream", failure.code, startedAt, {
        inputBytes,
        ...(failure.counts?.responseBytes === undefined
          ? {}
          : { responseBytes: failure.counts.responseBytes }),
        ...(failure.counts?.deltaCount === undefined
          ? {}
          : { deltaCount: failure.counts.deltaCount }),
        ...(failure.rawResponseRef === undefined ? {} : { rawResponseRef: failure.rawResponseRef }),
      });
      throw failure;
    } finally {
      control?.cleanup();
    }
  }

  async #ensureOllama(
    request: EmbeddingRequestV1,
    config: Extract<NetworkApiDeploymentConfigV1, { protocol: "ollama-embed" }>,
    control: CallControl,
  ): Promise<void> {
    const key = llamaCppDeploymentKey(config.deploymentRef);
    let probe = this.#probes.get(key);
    if (!probe) {
      probe = this.#probeOllama(request, config, control);
      this.#probes.set(key, probe);
    }
    try {
      await probe;
    } catch (error) {
      if (this.#probes.get(key) === probe) this.#probes.delete(key);
      throw error;
    }
  }

  async #probeOllama(
    request: EmbeddingRequestV1,
    config: Extract<NetworkApiDeploymentConfigV1, { protocol: "ollama-embed" }>,
    control: CallControl,
  ): Promise<void> {
    const versionResponse = await this.#get(
      config,
      request,
      control,
      "api/version",
      "probe.version",
    );
    const version = OllamaVersionSchema.safeParse(
      await this.#jsonResponse(versionResponse, config.maxResponseBytes),
    );
    if (
      !versionResponse.ok ||
      !version.success ||
      version.data.version !== config.expectedServerVersion
    )
      throw this.#error(request, "MODEL_DEPLOYMENT_MISMATCH", "probe.version", false);
    const tagsResponse = await this.#get(config, request, control, "api/tags", "probe.tags");
    const tags = OllamaTagsSchema.safeParse(
      await this.#jsonResponse(tagsResponse, config.maxResponseBytes),
    );
    const model = tags.success
      ? tags.data.models.find((candidate) => candidate.name === config.modelId)
      : undefined;
    if (!tagsResponse.ok || !model || model.digest !== config.expectedModelDigest)
      throw this.#error(request, "MODEL_DEPLOYMENT_MISMATCH", "probe.model", false);
    const showResponse = await this.#post(
      config,
      request,
      control,
      "api/show",
      { model: config.modelId },
      "probe.show",
    );
    const show = record(await this.#jsonResponse(showResponse, config.maxResponseBytes));
    const info = record(show?.model_info);
    const lengths = Object.entries(info ?? {}).filter(([key]) =>
      /embedding_length|context_length$/.test(key),
    );
    const dimension = lengths.find(([key]) => key.endsWith("embedding_length"))?.[1];
    const context = lengths.find(([key]) => key.endsWith("context_length"))?.[1];
    if (
      !showResponse.ok ||
      dimension !== config.embeddingDimensions ||
      context !== config.contextWindowTokens
    )
      throw this.#error(request, "MODEL_DEPLOYMENT_MISMATCH", "probe.model-metadata", false);
  }

  #deployment(
    request: Request,
    capability: "completeStructured" | "streamConversation",
    protocol: "openai-chat",
  ): Extract<NetworkApiDeploymentConfigV1, { protocol: "openai-chat" }>;
  #deployment(
    request: Request,
    capability: "embed",
    protocol: "ollama-embed",
  ): Extract<NetworkApiDeploymentConfigV1, { protocol: "ollama-embed" }>;
  #deployment(
    request: Request,
    capability: Capability,
    protocol: NetworkApiDeploymentConfigV1["protocol"],
  ): NetworkApiDeploymentConfigV1 {
    const config = this.#deployments.get(llamaCppDeploymentKey(request.modelDeploymentRef));
    if (!config)
      throw this.#error(request, "MODEL_DEPLOYMENT_NOT_FOUND", "deployment.lookup", false);
    if (config.protocol !== protocol || !config.capabilities.includes(capability as never))
      throw this.#error(request, "MODEL_CAPABILITY_UNAVAILABLE", "deployment.capability", false);
    return config;
  }

  #assertBudget(
    request: Request,
    config: NetworkApiDeploymentConfigV1,
    contentBytes: number,
    serializedBytes: number,
  ): number {
    const maxOutputTokens = "maxOutputTokens" in config ? config.maxOutputTokens : 0;
    assertModelGatewayRequestBudget(
      request,
      {
        maxInputBytes: config.maxInputBytes,
        maxBatchItems: config.maxBatchItems,
        maxOutputTokens,
        contextWindowTokens: config.contextWindowTokens,
      },
      contentBytes,
      (code, stage, counts) => {
        throw this.#error(
          request,
          code,
          stage,
          code === "MODEL_REQUEST_TIMEOUT",
          counts ? { counts } : {},
        );
      },
      this.#now,
    );
    const upper = conservativeTokenUpperBound(
      serializedBytes,
      config.inputTokenUpperBoundPolicy.maxTokensPerInputByte,
      config.inputTokenUpperBoundPolicy.requestOverheadTokens,
    );
    if (upper + maxOutputTokens > config.contextWindowTokens)
      throw this.#error(request, "MODEL_CONTEXT_EXCEEDED", "request.context-upper-bound", false, {
        counts: { inputTokens: upper },
      });
    return upper;
  }

  #control(
    request: Request,
    config: NetworkApiDeploymentConfigV1,
    callerSignal?: AbortSignal,
  ): CallControl {
    const internal = new AbortController();
    let reason: ReturnType<CallControl["reason"]>;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.parse(request.deadlineAt) - this.#now().getTime();
    const timeout = Math.min(config.requestTimeoutMs, Math.max(0, deadline));
    const deadlineWins = deadline < config.requestTimeoutMs;
    const timer = setTimeout(() => {
      reason = deadlineWins ? "deadline" : "request-timeout";
      internal.abort();
    }, timeout);
    const abort = () => {
      reason = "caller";
      internal.abort();
    };
    if (callerSignal?.aborted) abort();
    else callerSignal?.addEventListener("abort", abort, { once: true });
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, internal.signal])
      : internal.signal;
    return {
      signal,
      reason: () => reason,
      resetIdle: () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          reason = "idle";
          internal.abort();
        }, config.streamIdleTimeoutMs);
      },
      stopIdle: () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = undefined;
      },
      cleanup: () => {
        clearTimeout(timer);
        if (idleTimer) clearTimeout(idleTimer);
        callerSignal?.removeEventListener("abort", abort);
      },
    };
  }

  async #runPreflight(request: Request): Promise<void> {
    try {
      await preflightParentArtifacts(request, this.#parentPreflight);
    } catch (error) {
      if (error instanceof ModelGatewayError || error instanceof ArtifactStoreError) throw error;
      throw this.#error(request, "MODEL_AUTHORIZATION_DENIED", "parent-artifact.preflight", false);
    }
  }

  #credential(config: Extract<NetworkApiDeploymentConfigV1, { protocol: "openai-chat" }>): string {
    const value =
      this.#resolveCredential?.(config.credentialRef) ?? this.#credentials[config.credentialRef];
    if (typeof value !== "string" || value.length === 0)
      throw this.#errorFromIdentity(
        { invocationId: "credential", modelDeploymentRef: config.deploymentRef },
        "MODEL_DEPLOYMENT_NOT_FOUND",
        "credential.lookup",
        false,
      );
    return value;
  }

  async #post(
    config: NetworkApiDeploymentConfigV1,
    request: Request,
    control: CallControl,
    path: string,
    body: unknown,
    stage: string,
  ): Promise<Response> {
    return this.#fetchResponse(
      config,
      request,
      control,
      path,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.protocol === "openai-chat"
            ? { authorization: `Bearer ${this.#credential(config)}` }
            : {}),
        },
        body: JSON.stringify(body),
      },
      stage,
    );
  }

  async #get(
    config: NetworkApiDeploymentConfigV1,
    request: Request,
    control: CallControl,
    path: string,
    stage: string,
  ): Promise<Response> {
    return this.#fetchResponse(config, request, control, path, { method: "GET" }, stage);
  }

  async #fetchResponse(
    config: NetworkApiDeploymentConfigV1,
    request: Request,
    control: CallControl,
    path: string,
    init: RequestInit,
    stage: string,
  ): Promise<Response> {
    try {
      const base = new URL(config.baseUrl);
      base.pathname = `${base.pathname.replace(/\/$/, "")}/`;
      const url = new URL(path, base);
      return await this.#fetch(url, { ...init, redirect: "error", signal: control.signal });
    } catch {
      const reason = control.reason();
      if (reason === "caller")
        throw this.#error(request, "MODEL_ABORTED", `${stage}.cancelled`, false);
      if (reason === "idle")
        throw this.#error(request, "MODEL_STREAM_IDLE_TIMEOUT", `${stage}.idle`, true);
      if (reason === "deadline" || reason === "request-timeout")
        throw this.#error(request, "MODEL_REQUEST_TIMEOUT", `${stage}.timeout`, true);
      throw this.#error(request, "MODEL_SERVICE_UNAVAILABLE", `${stage}.unavailable`, true);
    }
  }

  async #readAndPersist(
    response: Response,
    request: Request,
    operation: string,
    limit: number,
    mediaType: string,
  ) {
    let body: Uint8Array;
    try {
      body = await readBoundedBytes(response, limit);
    } catch (error) {
      if (!(error instanceof ResponseBodyLimitError)) throw error;
      const sanitized = this.#sanitizeBytes(error.partial);
      const raw = await this.#persistSanitized(request, sanitized, operation, limit, mediaType);
      throw this.#error(request, "MODEL_STRUCTURE_INVALID", "response.size", false, {
        rawResponseRef: raw.ref,
        counts: { responseBytes: error.partial.byteLength },
      });
    }
    return this.#persistSanitized(request, this.#sanitizeBytes(body), operation, limit, mediaType);
  }

  async #persistSanitized(
    request: Request,
    body: Uint8Array,
    operation: string,
    limit: number,
    mediaType: string,
  ) {
    try {
      return await persistRawModelResponse(request, body, operation, limit, {
        artifactStore: this.#artifactStore,
        now: this.#now,
        putRaw: async (content) => {
          const result = ArtifactPutResultV1Schema.parse(
            await this.#artifactStore.put(
              this.#artifactCommand(request, "model-raw-response", "model-raw-response", mediaType),
              chunksOf(content),
            ),
          );
          if (result.artifactRef.kind !== "diagnostic-artifact")
            throw this.#error(request, "MODEL_ARTIFACT_PERSISTENCE_FAILED", "artifact.kind", false);
          return result.artifactRef;
        },
      });
    } catch (error) {
      if (error instanceof ArtifactStoreError) throw this.#artifactError(request, error);
      if (error instanceof PersistedResponseLimitError)
        throw this.#error(request, "MODEL_ARTIFACT_PERSISTENCE_FAILED", "artifact.open", false, {
          rawResponseRef: error.rawResponseRef,
        });
      throw error;
    }
  }

  #sanitizeBytes(body: Uint8Array): Uint8Array {
    try {
      return bytes(JSON.stringify(sanitizeProtocolValue(decodeJson(body))));
    } catch {
      return bytes(stripThinking(new TextDecoder().decode(body)));
    }
  }

  async #jsonResponse(response: Response, limit: number): Promise<unknown> {
    const data = await readBoundedBytes(response, limit);
    return sanitizeProtocolValue(decodeJson(data));
  }

  #usage(
    request: Request,
    value: unknown,
    maxOutput: number,
    maxInputTokens: number,
    contextWindowTokens: number,
  ): ModelUsageV1 {
    const usage = usageFromWire(value);
    if (!usage.available || usage.inputTokens === undefined || usage.outputTokens === undefined)
      throw this.#error(request, "MODEL_PROTOCOL_ERROR", "usage.missing", false);
    if (
      usage.inputTokens > maxInputTokens ||
      usage.outputTokens > maxOutput ||
      usage.inputTokens + usage.outputTokens > contextWindowTokens ||
      (usage.totalTokens !== undefined &&
        (usage.totalTokens < usage.inputTokens + usage.outputTokens ||
          usage.totalTokens > contextWindowTokens))
    )
      throw this.#error(request, "MODEL_CONTEXT_EXCEEDED", "usage.budget", false, {
        counts: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      });
    return usage;
  }

  #jsonSchema<T>(
    request: StructuredCompletionRequestV1,
    schema: ZodType<T>,
  ): Record<string, unknown> {
    try {
      const { $schema: _meta, ...jsonSchema } = z.toJSONSchema(schema as never) as Record<
        string,
        unknown
      >;
      void _meta;
      return jsonSchema;
    } catch {
      throw this.#error(request, "MODEL_SCHEMA_UNSUPPORTED", "schema.convert", false);
    }
  }

  #assertNoAdditionalProperties(value: unknown, schema: unknown): void {
    const shape = record(schema);
    if (!shape) return;
    if (shape.type === "object" && record(value)) {
      const properties = record(shape.properties) ?? {};
      const object = record(value)!;
      if (Object.keys(object).some((key) => !(key in properties)))
        throw new Error("additional property");
      for (const [key, child] of Object.entries(object))
        this.#assertNoAdditionalProperties(child, properties[key]);
    }
    if (shape.type === "array" && Array.isArray(value))
      for (const child of value) this.#assertNoAdditionalProperties(child, shape.items);
  }

  async #failure(
    request: Request,
    failure: ModelGatewayError,
    operation: string,
  ): Promise<ModelGatewayError> {
    if (
      failure.rawResponseRef ||
      failure.diagnosticRef ||
      failure.code === "MODEL_INPUT_INVALID" ||
      failure.code === "MODEL_AUTHORIZATION_DENIED" ||
      failure.code === "MODEL_DEPLOYMENT_NOT_FOUND" ||
      failure.code === "MODEL_CAPABILITY_UNAVAILABLE" ||
      failure.code === "MODEL_SCHEMA_UNSUPPORTED" ||
      failure.code === "MODEL_CONTEXT_EXCEEDED"
    )
      return failure;
    try {
      const value = { schemaVersion: "1", stage: operation, code: failure.code };
      const result = ArtifactPutResultV1Schema.parse(
        await this.#artifactStore.put(
          this.#artifactCommand(
            request,
            `model-diagnostic-${operation}`,
            "model-diagnostic",
            "application/json",
          ),
          chunksOf(bytes(JSON.stringify(value))),
        ),
      );
      if (result.artifactRef.kind !== "diagnostic-artifact") return failure;
      return new ModelGatewayError(
        ModelGatewayErrorV1Schema.parse({ ...failure, diagnosticRef: result.artifactRef }),
      );
    } catch {
      return failure;
    }
  }

  #artifactCommand(
    request: Request,
    artifactIdSuffix: string,
    purposeCode: string,
    mediaType: string,
  ) {
    const commandId = `model-${request.invocationId}-${artifactIdSuffix}`;
    return ArtifactPutCommandV1Schema.parse({
      schemaVersion: "1",
      commandId,
      idempotencyKey: `${request.idempotencyKey}:${artifactIdSuffix}`,
      projectId: request.projectId,
      actorId: request.actorId,
      issuedAt: request.issuedAt,
      authorization: request.authorization,
      requiredCapability: request.requiredCapability,
      artifactId: commandId,
      artifactKind: "diagnostic",
      purposeCode,
      mediaType,
      parentArtifactRefs: request.parentArtifactRefs,
      evidenceReferences: request.evidenceReferences,
      additionalSpatialScopeRefs: [],
      additionalSourceAccessGrantRefs: [],
    });
  }

  #http(
    request: Request,
    status: number,
    stage: string,
    rawResponseRef: DiagnosticArtifactRefV1,
    responseBytes: number,
  ): ModelGatewayError {
    return this.#error(request, "MODEL_HTTP_ERROR", stage, retryableStatus(status), {
      rawResponseRef,
      counts: { responseBytes },
    });
  }

  #artifactError(request: Request, error: ArtifactStoreError): ModelGatewayError {
    if (error.code === "ARTIFACT_ACCESS_DENIED")
      return this.#error(request, "MODEL_AUTHORIZATION_DENIED", "artifact.authorization", false, {
        diagnosticRef: error.diagnosticRef,
      });
    if (error.code === "ARTIFACT_IDEMPOTENCY_CONFLICT")
      return this.#error(request, "MODEL_IDEMPOTENCY_CONFLICT", "artifact.idempotency", false, {
        diagnosticRef: error.diagnosticRef,
        idempotencyKey: request.idempotencyKey,
      });
    return this.#error(
      request,
      "MODEL_ARTIFACT_PERSISTENCE_FAILED",
      "artifact.persistence",
      error.retryable,
      { diagnosticRef: error.diagnosticRef },
    );
  }

  #parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw this.#invalid(value, hasAuthorizationMismatch(value));
  }

  #invalid(request: unknown, authorizationFailure: boolean): ModelGatewayError {
    const value = record(request) ?? {};
    const ref = record(value.modelDeploymentRef);
    const entityId = typeof ref?.entityId === "string" ? ref.entityId : "invalid";
    const versionId = typeof ref?.versionId === "string" ? ref.versionId : "invalid";
    const invocationId = typeof value.invocationId === "string" ? value.invocationId : "invalid";
    return this.#errorFromIdentity(
      { invocationId, modelDeploymentRef: { entityId, versionId } },
      authorizationFailure ? "MODEL_AUTHORIZATION_DENIED" : "MODEL_INPUT_INVALID",
      authorizationFailure ? "request.authorization" : "request.schema",
      false,
    );
  }

  #error(
    request: Request,
    code: ModelGatewayErrorCodeV1,
    stage: string,
    retryable: boolean,
    extra: Partial<
      Omit<
        ModelGatewayErrorV1,
        | "schemaVersion"
        | "code"
        | "category"
        | "retryable"
        | "stage"
        | "occurredAt"
        | "invocationId"
        | "modelDeploymentRef"
      >
    > = {},
  ): ModelGatewayError {
    return this.#errorFromIdentity(
      { invocationId: request.invocationId, modelDeploymentRef: request.modelDeploymentRef },
      code,
      stage,
      retryable,
      extra,
    );
  }

  #errorFromIdentity(
    identity: { invocationId: string; modelDeploymentRef: { entityId: string; versionId: string } },
    code: ModelGatewayErrorCodeV1,
    stage: string,
    retryable: boolean,
    extra: Partial<
      Omit<
        ModelGatewayErrorV1,
        | "schemaVersion"
        | "code"
        | "category"
        | "retryable"
        | "stage"
        | "occurredAt"
        | "invocationId"
        | "modelDeploymentRef"
      >
    > = {},
  ): ModelGatewayError {
    return new ModelGatewayError(
      modelGatewayError({
        ...identity,
        ...extra,
        code,
        category: MODEL_GATEWAY_ERROR_CATEGORY_V1[code],
        retryable,
        stage,
        occurredAt: this.#now().toISOString(),
      }),
    );
  }

  #map(error: unknown, request: Request, control?: CallControl): ModelGatewayError {
    if (error instanceof ModelGatewayError) return error;
    if (error instanceof ArtifactStoreError) return this.#artifactError(request, error);
    const reason = control?.reason();
    if (reason === "caller")
      return this.#error(request, "MODEL_ABORTED", "request.cancelled", false);
    if (reason === "idle")
      return this.#error(request, "MODEL_STREAM_IDLE_TIMEOUT", "stream.idle", true);
    if (reason === "deadline" || reason === "request-timeout")
      return this.#error(request, "MODEL_REQUEST_TIMEOUT", "request.timeout", true);
    if (error instanceof ResponseBodyLimitError)
      return this.#error(request, "MODEL_PROTOCOL_ERROR", "response.size", false, {
        counts: { responseBytes: error.partial.byteLength },
      });
    return this.#error(request, "MODEL_PROTOCOL_ERROR", "request.failure", false);
  }

  #emit(
    capability: Capability,
    stage: string,
    resultCode: string,
    startedAt: number,
    values: Partial<
      Omit<NetworkApiModelGatewayObservationV1, "capability" | "stage" | "resultCode" | "elapsedMs">
    >,
  ): void {
    try {
      this.#observe?.({
        capability,
        stage,
        resultCode,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        ...values,
      });
    } catch {
      /* observation cannot change model results */
    }
  }

  async *#readStream(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
    const reader = body.getReader();
    let complete = false;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) {
          complete = true;
          return;
        }
        if (part.value) yield part.value;
      }
    } finally {
      if (!complete) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const value = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    value.set(part, offset);
    offset += part.byteLength;
  }
  return value;
};

export const createNetworkApiModelGateway = (
  options: NetworkApiModelGatewayOptionsV1,
): NetworkApiModelGateway => new NetworkApiModelGateway(options);
