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
  ModelGatewayErrorV1Schema,
  ModelGatewayError,
  ModelTerminationReasonV1Schema,
  StructuredCompletionRequestV1Schema,
  structuredCompletionResultSchema,
  type ConversationReceiptV1,
  type ConversationRequestV1,
  type ConversationTextDeltaV1,
  type EmbeddingRequestV1,
  type EmbeddingResultV1,
  type ModelGatewayErrorCodeV1,
  type ModelGatewayErrorV1,
  type ModelUsageV1,
  type StructuredCompletionRequestV1,
  type StructuredCompletionResultV1,
  type ModelGatewayPortV1,
  modelGatewayError,
  z,
  type ZodType,
} from "@riskflow/core/model";
import type { DiagnosticArtifactRefV1 } from "@riskflow/contracts/ports";

import {
  freezeLlamaCppDeploymentConfig,
  llamaCppDeploymentKey,
  type FrozenLlamaCppDeploymentConfigV1,
  type LlamaCppDeploymentConfigV1,
} from "./config.js";
import {
  assertModelGatewayRequestBudget,
  ConsumerStoppedError,
  decodeJson,
  hasAuthorizationMismatch,
  inputBytesForMessages,
  inputBytesForTexts,
  OneSlotQueue,
  PersistedResponseLimitError,
  persistRawModelResponse,
  preflightParentArtifacts,
  readBoundedBytes,
  ResponseBodyLimitError,
  usageFromWire,
  type ParentArtifactPreflightV1,
} from "./model-gateway-runtime.js";
export type {
  ParentArtifactPreflightRequestV1,
  ParentArtifactPreflightV1,
} from "./model-gateway-runtime.js";

const encoder = new TextEncoder();
const nonNegativeInteger = z.number().int().refine(Number.isSafeInteger).nonnegative();
const positiveInteger = nonNegativeInteger.positive();

const ChatMessageSchema = z
  .object({
    role: z.literal("assistant").optional(),
    content: z.union([z.string(), z.null()]).optional(),
    reasoning_content: z.unknown().optional(),
    tool_calls: z.unknown().optional(),
    function_call: z.unknown().optional(),
  })
  .passthrough();
const ChatChoiceSchema = z
  .object({
    index: nonNegativeInteger,
    message: ChatMessageSchema,
    reasoning_content: z.unknown().optional(),
    tool_calls: z.unknown().optional(),
    function_call: z.unknown().optional(),
    finish_reason: z.union([ModelTerminationReasonV1Schema, z.null()]),
  })
  .passthrough();
const ChatResponseSchema = z
  .object({
    id: z.string().optional(),
    object: z.string().optional(),
    created: nonNegativeInteger.optional(),
    model: z.string().optional(),
    system_fingerprint: z.string().optional(),
    choices: z.array(ChatChoiceSchema),
    usage: z.unknown().optional(),
  })
  .passthrough();
const ChatDeltaSchema = z
  .object({
    role: z.literal("assistant").optional(),
    content: z.union([z.string(), z.null()]).optional(),
    reasoning_content: z.unknown().optional(),
    tool_calls: z.unknown().optional(),
    function_call: z.unknown().optional(),
  })
  .passthrough();
const ChatStreamChoiceSchema = z
  .object({
    index: nonNegativeInteger,
    delta: ChatDeltaSchema,
    reasoning_content: z.unknown().optional(),
    tool_calls: z.unknown().optional(),
    function_call: z.unknown().optional(),
    finish_reason: z.union([ModelTerminationReasonV1Schema, z.null()]),
  })
  .passthrough();
const ChatStreamResponseSchema = z
  .object({
    id: z.string().optional(),
    object: z.string().optional(),
    created: nonNegativeInteger.optional(),
    model: z.string().optional(),
    system_fingerprint: z.string().optional(),
    choices: z.array(ChatStreamChoiceSchema),
    usage: z.unknown().optional(),
  })
  .passthrough();
const EmbeddingDataSchema = z.strictObject({
  index: nonNegativeInteger,
  embedding: z.array(z.number().refine(Number.isFinite)),
  object: z.string().optional(),
});
const EmbeddingResponseSchema = z.strictObject({
  object: z.string().optional(),
  model: z.string().optional(),
  data: z.array(EmbeddingDataSchema),
  usage: z.unknown().optional(),
});
const InputTokensResponseSchema = z.union([
  z.strictObject({ object: z.string().optional(), tokens: nonNegativeInteger }),
  z.strictObject({ object: z.string().optional(), input_tokens: nonNegativeInteger }),
  z.strictObject({ object: z.string().optional(), n_tokens: nonNegativeInteger }),
]);
const TokenizeResponseSchema = z.strictObject({
  tokens: z.array(nonNegativeInteger),
});
const HttpErrorEnvelopeSchema = z
  .object({ error: z.object({ code: z.string().max(128).optional() }).passthrough() })
  .passthrough();
const HealthResponseSchema = z.object({ status: z.string().optional() }).passthrough();
const PropsResponseSchema = z
  .object({
    build_info: z.string().optional(),
    n_ctx: positiveInteger.optional(),
    n_embd: positiveInteger.optional(),
    default_generation_settings: z
      .object({ n_ctx: positiveInteger.optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
const ModelsResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: z.string(),
          meta: z
            .object({ n_embd: positiveInteger.optional() })
            .passthrough()
            .nullable()
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

type RequestValue = StructuredCompletionRequestV1 | EmbeddingRequestV1 | ConversationRequestV1;
type StreamRequest = ConversationRequestV1;

export interface ModelGatewayObservationV1 {
  readonly capability: "completeStructured" | "embed" | "streamConversation";
  readonly stage: string;
  readonly resultCode: string;
  readonly elapsedMs: number;
  readonly inputBytes?: number | undefined;
  readonly responseBytes?: number | undefined;
  readonly inputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly deltaCount?: number | undefined;
  readonly rawResponseRef?: DiagnosticArtifactRefV1 | undefined;
}

export type ModelGatewayObserverV1 = (observation: ModelGatewayObservationV1) => void;

export interface LlamaCppModelGatewayOptionsV1 {
  readonly deployments: readonly LlamaCppDeploymentConfigV1[];
  readonly artifactStore: ArtifactStoreV1;
  readonly parentArtifactPreflight?: ParentArtifactPreflightV1;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  readonly observe?: ModelGatewayObserverV1;
}

interface CallControl {
  readonly signal: AbortSignal;
  readonly reason: () => "caller" | "deadline" | "request-timeout" | "idle" | undefined;
  readonly abort: (reason: "caller" | "idle") => void;
  readonly resetIdle: () => void;
  readonly stopIdle: () => void;
  readonly cleanup: () => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const refFromUnknown = (value: unknown): { entityId: string; versionId: string } => {
  if (isRecord(value) && isRecord(value.reference)) {
    const entityId = value.reference.entityId;
    const versionId = value.reference.versionId;
    if (typeof entityId === "string" && typeof versionId === "string")
      return { entityId, versionId };
  }
  return { entityId: "invalid", versionId: "invalid" };
};

const requestIdentity = (
  request: unknown,
): {
  readonly invocationId: string;
  readonly modelDeploymentRef: { entityId: string; versionId: string };
} => ({
  invocationId:
    isRecord(request) && typeof request.invocationId === "string"
      ? request.invocationId
      : "invalid",
  modelDeploymentRef: refFromUnknown(isRecord(request) ? request.modelDeploymentRef : undefined),
});

const chunksOf = async function* (bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
};

const readStream = async function* (body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let completed = false;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        completed = true;
        return;
      }
      if (result.value !== undefined) yield new Uint8Array(result.value);
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
};

const statusRetryable = (status: number): boolean =>
  status === 408 || status === 429 || status === 502 || status === 503 || status === 504;

const makeSseDelta = (sequence: number, text: string): ConversationTextDeltaV1 =>
  ConversationTextDeltaV1Schema.parse({ schemaVersion: "1", sequence, text });

export class LlamaCppModelGateway implements ModelGatewayPortV1 {
  readonly #deployments: ReadonlyMap<string, FrozenLlamaCppDeploymentConfigV1>;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #parentArtifactPreflight: ParentArtifactPreflightV1 | undefined;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #observe: ModelGatewayObserverV1 | undefined;
  readonly #probeCache = new Map<string, Promise<void>>();

  constructor(options: LlamaCppModelGatewayOptionsV1) {
    this.#artifactStore = options.artifactStore;
    this.#parentArtifactPreflight = options.parentArtifactPreflight;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#observe = options.observe;
    const deployments = new Map<string, FrozenLlamaCppDeploymentConfigV1>();
    for (const deployment of options.deployments) {
      const parsed = freezeLlamaCppDeploymentConfig(deployment);
      const key = llamaCppDeploymentKey(parsed.deploymentRef);
      if (deployments.has(key)) throw new Error("duplicate deployment reference");
      deployments.set(key, parsed);
    }
    this.#deployments = deployments;
  }

  completeStructured<T>(
    request: StructuredCompletionRequestV1,
    outputSchema: ZodType<T>,
    signal?: AbortSignal,
  ): Promise<StructuredCompletionResultV1<T>> {
    return this.#completeStructured(request, outputSchema, signal);
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
    const consumerController = new AbortController();
    const output = new OneSlotQueue<ConversationTextDeltaV1>(() => consumerController.abort());
    const parsed = ConversationRequestV1Schema.safeParse(request);
    let resolveCompleted!: (value: ConversationReceiptV1) => void;
    let rejectCompleted!: (error: unknown) => void;
    const completed = new Promise<ConversationReceiptV1>((resolve, reject) => {
      resolveCompleted = resolve;
      rejectCompleted = reject;
    });
    void completed.catch(() => undefined);
    if (!parsed.success) {
      const failure = this.#invalidRequestError(request, hasAuthorizationMismatch(request));
      output.close(failure);
      rejectCompleted(failure);
      return { deltas: output, completed };
    }
    const value = parsed.data;
    const run = this.#runStream(
      value,
      signal === undefined
        ? consumerController.signal
        : AbortSignal.any([signal, consumerController.signal]),
      output,
    );
    run.then(
      (receipt) => {
        output.close();
        resolveCompleted(receipt);
      },
      (error: unknown) => {
        output.close(error);
        rejectCompleted(error);
      },
    );
    return { deltas: output, completed };
  }

  async #completeStructured<T>(
    requestInput: StructuredCompletionRequestV1,
    outputSchema: ZodType<T>,
    callerSignal?: AbortSignal,
  ): Promise<StructuredCompletionResultV1<T>> {
    const startedAt = Date.now();
    const request = this.#parseRequest(StructuredCompletionRequestV1Schema, requestInput);
    let config: FrozenLlamaCppDeploymentConfigV1 | undefined;
    let control: CallControl | undefined;
    try {
      config = this.#deploymentFor(request, "completeStructured");
      this.#assertBudget(request, config, inputBytesForMessages(request.messages));
      const jsonSchema = this.#toJsonSchema(request, outputSchema);
      await this.#preflightParentArtifacts(request);
      control = this.#createControl(request, config, callerSignal);
      if (control.reason() === "caller")
        throw this.#error(request, "MODEL_ABORTED", "request.cancelled", false);
      await this.#ensureReady(request, config, control);
      const inputTokens = await this.#preflightTokens(request, config, control);
      if (inputTokens > config.contextWindowTokens - request.maxOutputTokens) {
        throw this.#error(request, "MODEL_CONTEXT_EXCEEDED", "chat.context", false, {
          counts: { inputTokens },
        });
      }
      const payload = this.#chatPayload(request, config, {
        max_tokens: request.maxOutputTokens,
        stream: false,
        response_format: { type: "json_schema", schema: jsonSchema },
      });
      const response = await this.#fetchResponse(
        request,
        config,
        control,
        "/v1/chat/completions",
        payload,
        "chat.complete",
      );
      let bytes: Uint8Array;
      try {
        bytes = await readBoundedBytes(response, config.maxResponseBytes);
      } catch (error) {
        if (error instanceof ResponseBodyLimitError) {
          const raw = await this.#persistRaw(
            request,
            error.partial,
            "application/json",
            "complete",
            config.maxResponseBytes,
          );
          throw this.#error(request, "MODEL_STRUCTURE_INVALID", "chat.response-size", false, {
            rawResponseRef: raw.ref,
            counts: { responseBytes: error.partial.byteLength },
          });
        }
        throw error;
      }
      const raw = await this.#persistRaw(
        request,
        bytes,
        "application/json",
        "complete",
        config.maxResponseBytes,
      );
      if (!response.ok)
        throw this.#httpError(request, response.status, "chat.http", raw.ref, raw.bytes.byteLength);
      const parsed = this.#parseChatResponse(request, raw.bytes, raw.ref, "chat.complete");
      if (parsed.finishReason !== "stop") {
        throw this.#error(request, "MODEL_STRUCTURE_INVALID", "chat.finish", false, {
          rawResponseRef: raw.ref,
        });
      }
      let jsonValue: unknown;
      try {
        jsonValue = JSON.parse(parsed.content);
      } catch {
        throw this.#error(request, "MODEL_STRUCTURE_INVALID", "chat.output-json", false, {
          rawResponseRef: raw.ref,
        });
      }
      let value: T;
      try {
        value = outputSchema.parse(jsonValue) as T;
      } catch {
        throw this.#error(request, "MODEL_OUTPUT_SCHEMA_INVALID", "chat.output-schema", false, {
          rawResponseRef: raw.ref,
        });
      }
      const result = structuredCompletionResultSchema(outputSchema).parse({
        schemaVersion: "1",
        invocationId: request.invocationId,
        modelDeploymentRef: config.deploymentRef,
        serverBuildRef: config.serverBuildRef,
        modelVersionRef: config.modelVersionRef,
        usage: parsed.usage,
        rawResponseRef: raw.ref,
        promptTemplateRef: request.promptTemplateRef,
        outputSchemaRef: request.outputSchemaRef,
        value,
        finishReason: "stop",
      }) as StructuredCompletionResultV1<T>;
      this.#emit("completeStructured", "complete", "ok", startedAt, {
        inputBytes: inputBytesForMessages(request.messages),
        responseBytes: raw.bytes.byteLength,
        inputTokens: parsed.usage.inputTokens,
        outputTokens: parsed.usage.outputTokens,
        rawResponseRef: raw.ref,
      });
      return result;
    } catch (error) {
      const mapped = this.#mapError(error, request, control);
      this.#invalidateProbeAfterFailure(config, mapped);
      const failure = await this.#failureWithDiagnostic(request, mapped, "complete");
      this.#emit("completeStructured", "complete", failure.code, startedAt, {
        inputBytes: inputBytesForMessages(request.messages),
        rawResponseRef: failure.rawResponseRef,
        responseBytes: failure.counts?.responseBytes,
      });
      throw failure;
    } finally {
      control?.cleanup();
    }
  }

  async #embed(
    requestInput: EmbeddingRequestV1,
    callerSignal?: AbortSignal,
  ): Promise<EmbeddingResultV1> {
    const startedAt = Date.now();
    const request = this.#parseRequest(EmbeddingRequestV1Schema, requestInput);
    let config: FrozenLlamaCppDeploymentConfigV1 | undefined;
    let control: CallControl | undefined;
    try {
      config = this.#deploymentFor(request, "embed");
      const inputBytes = inputBytesForTexts(request.texts);
      this.#assertBudget(request, config, inputBytes);
      await this.#preflightParentArtifacts(request);
      control = this.#createControl(request, config, callerSignal);
      if (control.reason() === "caller")
        throw this.#error(request, "MODEL_ABORTED", "request.cancelled", false);
      await this.#ensureReady(request, config, control);
      await this.#preflightEmbeddingTokens(request, config, control);
      const payload = {
        model: config.modelAlias,
        input: request.texts,
        encoding_format: "float",
      };
      const response = await this.#fetchResponse(
        request,
        config,
        control,
        "/v1/embeddings",
        payload,
        "embedding.request",
      );
      let bytes: Uint8Array;
      try {
        bytes = await readBoundedBytes(response, config.maxResponseBytes);
      } catch (error) {
        if (error instanceof ResponseBodyLimitError) {
          const raw = await this.#persistRaw(
            request,
            error.partial,
            "application/json",
            "embed",
            config.maxResponseBytes,
          );
          throw this.#error(request, "MODEL_EMBEDDING_INVALID", "embedding.response-size", false, {
            rawResponseRef: raw.ref,
            counts: { responseBytes: error.partial.byteLength },
          });
        }
        throw error;
      }
      const raw = await this.#persistRaw(
        request,
        bytes,
        "application/json",
        "embed",
        config.maxResponseBytes,
      );
      if (!response.ok)
        throw this.#httpError(
          request,
          response.status,
          "embedding.http",
          raw.ref,
          raw.bytes.byteLength,
        );
      let wire: z.infer<typeof EmbeddingResponseSchema>;
      try {
        wire = EmbeddingResponseSchema.parse(decodeJson(raw.bytes));
      } catch {
        throw this.#error(request, "MODEL_PROTOCOL_ERROR", "embedding.protocol", false, {
          rawResponseRef: raw.ref,
        });
      }
      if (config.embeddingDimensions === undefined) {
        throw this.#error(
          request,
          "MODEL_DEPLOYMENT_MISMATCH",
          "embedding.dimension-config",
          false,
          {
            rawResponseRef: raw.ref,
          },
        );
      }
      const embeddingDimensions = config.embeddingDimensions;
      const indices = wire.data.map((item) => item.index);
      if (
        wire.data.length !== request.texts.length ||
        new Set(indices).size !== indices.length ||
        indices.some((index, position) => index !== position)
      ) {
        throw this.#error(request, "MODEL_EMBEDDING_INVALID", "embedding.indices", false, {
          rawResponseRef: raw.ref,
          counts: { batchItems: wire.data.length },
        });
      }
      const vectors = wire.data.map((item) => item.embedding);
      if (
        vectors.some(
          (vector) =>
            vector === undefined ||
            vector.length !== embeddingDimensions ||
            vector.some((value) => !Number.isFinite(value)),
        )
      ) {
        throw this.#error(request, "MODEL_EMBEDDING_INVALID", "embedding.dimension", false, {
          rawResponseRef: raw.ref,
        });
      }
      const result = EmbeddingResultV1Schema.parse({
        schemaVersion: "1",
        invocationId: request.invocationId,
        modelDeploymentRef: config.deploymentRef,
        serverBuildRef: config.serverBuildRef,
        modelVersionRef: config.modelVersionRef,
        usage: usageFromWire(wire.usage),
        rawResponseRef: raw.ref,
        vectors,
        dimensions: config.embeddingDimensions,
      });
      this.#emit("embed", "embed", "ok", startedAt, {
        inputBytes,
        responseBytes: raw.bytes.byteLength,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        rawResponseRef: raw.ref,
      });
      return result;
    } catch (error) {
      const mapped = this.#mapError(error, request, control);
      this.#invalidateProbeAfterFailure(config, mapped);
      const failure = await this.#failureWithDiagnostic(request, mapped, "embed");
      this.#emit("embed", "embed", failure.code, startedAt, {
        inputBytes: inputBytesForTexts(request.texts),
        responseBytes: failure.counts?.responseBytes,
        rawResponseRef: failure.rawResponseRef,
      });
      throw failure;
    } finally {
      control?.cleanup();
    }
  }

  async #runStream(
    request: StreamRequest,
    callerSignal: AbortSignal | undefined,
    output: OneSlotQueue<ConversationTextDeltaV1>,
  ): Promise<ConversationReceiptV1> {
    const startedAt = Date.now();
    let config: FrozenLlamaCppDeploymentConfigV1 | undefined;
    let control: CallControl | undefined;
    let parserQueue: OneSlotQueue<Uint8Array> | undefined;
    let artifactQueue: OneSlotQueue<Uint8Array> | undefined;
    let putPromise: Promise<ReturnType<typeof ArtifactPutResultV1Schema.parse>> | undefined;
    let artifactFailure: unknown;
    try {
      config = this.#deploymentFor(request, "streamConversation");
      const inputBytes = inputBytesForMessages(request.messages);
      this.#assertBudget(request, config, inputBytes);
      await this.#preflightParentArtifacts(request);
      control = this.#createControl(request, config, callerSignal);
      if (control.reason() === "caller")
        throw this.#error(request, "MODEL_ABORTED", "request.cancelled", false);
      await this.#ensureReady(request, config, control);
      const inputTokens = await this.#preflightTokens(request, config, control);
      if (inputTokens > config.contextWindowTokens - request.maxOutputTokens) {
        throw this.#error(request, "MODEL_CONTEXT_EXCEEDED", "stream.context", false, {
          counts: { inputTokens },
        });
      }
      const payload = this.#chatPayload(request, config, {
        max_tokens: request.maxOutputTokens,
        stream: true,
        stream_options: { include_usage: true },
      });
      const response = await this.#fetchResponse(
        request,
        config,
        control,
        "/v1/chat/completions",
        payload,
        "chat.stream",
      );
      if (!response.ok) {
        let bytes: Uint8Array;
        try {
          bytes = await readBoundedBytes(response, config.maxResponseBytes);
        } catch (error) {
          if (error instanceof ResponseBodyLimitError) bytes = error.partial;
          else throw error;
        }
        const raw = await this.#persistRaw(
          request,
          bytes,
          "application/json",
          "stream",
          config.maxResponseBytes,
        );
        throw this.#httpError(request, response.status, "stream.http", raw.ref, bytes.byteLength);
      }
      if (response.body === null)
        throw this.#error(request, "MODEL_STREAM_INTERRUPTED", "stream.body", true);

      parserQueue = new OneSlotQueue<Uint8Array>();
      artifactQueue = new OneSlotQueue<Uint8Array>();
      const putCommand = this.#artifactCommand(
        request,
        "model-raw-response",
        "model-raw-response",
        "text/event-stream",
      );
      putPromise = this.#artifactStore
        .put(putCommand, artifactQueue)
        .then((result) => ArtifactPutResultV1Schema.parse(result));
      void putPromise.catch((error: unknown) => {
        artifactFailure = error;
        artifactQueue?.close(error);
        control?.abort("caller");
      });
      control.resetIdle();
      const parserPromise = this.#parseSse(parserQueue, request, config, output, control).catch(
        (error: unknown) => {
          parserQueue?.close(error);
          throw error;
        },
      );
      let responseBytes = 0;
      let streamFailure: unknown;
      try {
        for await (const chunk of readStream(response.body)) {
          if (chunk.byteLength === 0) continue;
          const nextBytes = responseBytes + chunk.byteLength;
          const accepted =
            nextBytes > config.maxResponseBytes
              ? chunk.slice(0, Math.max(0, config.maxResponseBytes - responseBytes))
              : chunk;
          responseBytes += accepted.byteLength;
          control.resetIdle();
          if (accepted.byteLength > 0)
            await Promise.all([parserQueue.push(accepted), artifactQueue.push(accepted)]);
          if (nextBytes > config.maxResponseBytes)
            throw new ResponseBodyLimitError(new Uint8Array());
        }
      } catch (error) {
        streamFailure = error;
      } finally {
        control.stopIdle();
        parserQueue.close();
        artifactQueue.close();
      }
      const parsed = await parserPromise.catch((error: unknown) => {
        streamFailure ??= error;
        return undefined;
      });
      const persisted = await putPromise.catch((error: unknown) => {
        artifactFailure ??= error;
        streamFailure ??= error;
        return undefined;
      });
      if (streamFailure !== undefined) {
        if (artifactFailure !== undefined)
          throw this.#artifactFailureError(request, artifactFailure);
        if (persisted === undefined) throw streamFailure;
        const failure = this.#mapError(streamFailure, request, control);
        throw new ModelGatewayError(
          ModelGatewayErrorV1Schema.parse({
            ...failure,
            rawResponseRef: persisted.artifactRef,
            counts: {
              ...(failure.counts ?? {}),
              responseBytes,
            },
          }),
        );
      }
      if (parsed === undefined || persisted === undefined) {
        throw this.#error(request, "MODEL_STREAM_INTERRUPTED", "stream.complete", true, {
          counts: { responseBytes },
        });
      }
      if (persisted.artifactRef.kind !== "diagnostic-artifact") {
        throw this.#error(
          request,
          "MODEL_ARTIFACT_PERSISTENCE_FAILED",
          "stream.artifact-kind",
          false,
        );
      }
      const persistedRef = persisted.artifactRef;
      const receipt = ConversationReceiptV1Schema.parse({
        schemaVersion: "1",
        invocationId: request.invocationId,
        modelDeploymentRef: config.deploymentRef,
        serverBuildRef: config.serverBuildRef,
        modelVersionRef: config.modelVersionRef,
        usage: parsed.usage,
        rawResponseRef: persistedRef,
        conversationRef: request.conversationRef,
        promptTemplateRef: request.promptTemplateRef,
        finishReason: parsed.finishReason,
        deltaCount: parsed.deltaCount,
        responseByteLength: responseBytes,
      });
      this.#emit("streamConversation", "stream", "ok", startedAt, {
        inputBytes: inputBytesForMessages(request.messages),
        responseBytes,
        inputTokens: parsed.usage.inputTokens,
        outputTokens: parsed.usage.outputTokens,
        deltaCount: parsed.deltaCount,
        rawResponseRef: persistedRef,
      });
      return receipt;
    } catch (error) {
      parserQueue?.close();
      artifactQueue?.close();
      const mapped = this.#mapError(error, request, control);
      this.#invalidateProbeAfterFailure(config, mapped);
      const failure = await this.#failureWithDiagnostic(request, mapped, "stream");
      this.#emit("streamConversation", "stream", failure.code, startedAt, {
        inputBytes: inputBytesForMessages(request.messages),
        responseBytes: failure.counts?.responseBytes,
        deltaCount: failure.counts?.deltaCount,
        rawResponseRef: failure.rawResponseRef,
      });
      throw failure;
    } finally {
      control?.cleanup();
    }
  }

  async #parseSse(
    chunks: AsyncIterable<Uint8Array>,
    request: StreamRequest,
    config: FrozenLlamaCppDeploymentConfigV1,
    output: OneSlotQueue<ConversationTextDeltaV1>,
    control: CallControl,
  ): Promise<{
    readonly finishReason: "stop" | "length";
    readonly usage: ModelUsageV1;
    readonly deltaCount: number;
  }> {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let textBuffer = "";
    let dataLines: string[] = [];
    let sequence = 0;
    let deltaCount = 0;
    let finishReason: "stop" | "length" | undefined;
    let usage: ModelUsageV1 = { available: false };
    let doneMarker = false;
    let eventCount = 0;
    const maxEventChars = Math.min(config.maxResponseBytes, 1_048_576);
    const processEvent = async (): Promise<void> => {
      if (dataLines.length === 0) return;
      eventCount += 1;
      if (eventCount > config.maxResponseBytes)
        throw this.#error(request, "MODEL_PROTOCOL_ERROR", "stream.events", false);
      const data = dataLines.join("\n");
      dataLines = [];
      if (data === "[DONE]") {
        doneMarker = true;
        return;
      }
      if (doneMarker)
        throw this.#error(request, "MODEL_PROTOCOL_ERROR", "stream.after-done", false);
      let parsed: z.infer<typeof ChatStreamResponseSchema>;
      try {
        parsed = ChatStreamResponseSchema.parse(JSON.parse(data));
      } catch {
        throw this.#error(request, "MODEL_PROTOCOL_ERROR", "stream.event", false);
      }
      if (parsed.usage !== undefined) usage = usageFromWire(parsed.usage);
      if (parsed.choices.length > 1)
        throw this.#error(request, "MODEL_PROTOCOL_ERROR", "stream.choice-count", false);
      const choice = parsed.choices[0];
      if (choice === undefined) return;
      if (choice.index !== 0)
        throw this.#error(request, "MODEL_PROTOCOL_ERROR", "stream.choice-index", false);
      if (choice.finish_reason !== null) {
        if (finishReason !== undefined && finishReason !== choice.finish_reason)
          throw this.#error(request, "MODEL_PROTOCOL_ERROR", "stream.finish-repeat", false);
        finishReason = choice.finish_reason;
      }
      const content = choice.delta.content;
      if (
        finishReason !== undefined &&
        content !== undefined &&
        content !== null &&
        content.length > 0
      )
        throw this.#error(request, "MODEL_PROTOCOL_ERROR", "stream.after-finish", false);
      if (content !== undefined && content !== null && content.length > 0) {
        const delta = makeSseDelta(sequence, content);
        sequence += 1;
        deltaCount += 1;
        await output.push(delta);
      }
    };
    const processLine = async (line: string): Promise<void> => {
      if (line === "") {
        await processEvent();
        return;
      }
      if (line.startsWith(":")) return;
      if (line.startsWith("data:")) {
        const data = line.slice(5).startsWith(" ") ? line.slice(6) : line.slice(5);
        dataLines.push(data);
        if (dataLines.join("\n").length > maxEventChars)
          throw this.#error(request, "MODEL_PROTOCOL_ERROR", "stream.event-size", false);
        return;
      }
      throw this.#error(request, "MODEL_PROTOCOL_ERROR", "stream.field", false);
    };
    try {
      for await (const chunk of chunks) {
        const reason = control.reason();
        if (reason === "caller")
          throw this.#error(request, "MODEL_ABORTED", "stream.cancelled", false);
        if (reason === "idle")
          throw this.#error(request, "MODEL_STREAM_IDLE_TIMEOUT", "stream.idle", true);
        if (reason === "deadline" || reason === "request-timeout")
          throw this.#error(request, "MODEL_REQUEST_TIMEOUT", "stream.timeout", true);
        textBuffer += decoder.decode(chunk, { stream: true });
        if (textBuffer.length > maxEventChars && !textBuffer.includes("\n"))
          throw this.#error(request, "MODEL_PROTOCOL_ERROR", "stream.line-size", false);
        for (;;) {
          const newline = textBuffer.indexOf("\n");
          if (newline < 0) break;
          let line = textBuffer.slice(0, newline);
          textBuffer = textBuffer.slice(newline + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          await processLine(line);
        }
      }
      textBuffer += decoder.decode();
      if (textBuffer.length > 0) {
        let line = textBuffer;
        if (line.endsWith("\r")) line = line.slice(0, -1);
        await processLine(line);
        await processEvent();
      } else if (dataLines.length > 0) {
        await processEvent();
      }
    } catch (error) {
      if (error instanceof ConsumerStoppedError) {
        control.abort("caller");
        throw this.#error(request, "MODEL_ABORTED", "stream.consumer", false);
      }
      throw error;
    }
    if (finishReason === undefined || !doneMarker) {
      if (control.reason() === "idle")
        throw this.#error(request, "MODEL_STREAM_IDLE_TIMEOUT", "stream.idle", true);
      if (control.reason() === "caller")
        throw this.#error(request, "MODEL_ABORTED", "stream.cancelled", false);
      if (control.reason() === "deadline" || control.reason() === "request-timeout")
        throw this.#error(request, "MODEL_REQUEST_TIMEOUT", "stream.timeout", true);
      throw this.#error(request, "MODEL_STREAM_INTERRUPTED", "stream.eof", true);
    }
    return { finishReason, usage, deltaCount };
  }

  #parseRequest<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (parsed.success) return parsed.data;
    throw this.#invalidRequestError(input, hasAuthorizationMismatch(input));
  }

  #invalidRequestError(request: unknown, authorizationFailure: boolean): ModelGatewayError {
    const identity = requestIdentity(request);
    return this.#errorFromIdentity(
      identity,
      authorizationFailure ? "MODEL_AUTHORIZATION_DENIED" : "MODEL_INPUT_INVALID",
      authorizationFailure ? "request.authorization" : "request.schema",
      false,
    );
  }

  #errorFromIdentity(
    identity: ReturnType<typeof requestIdentity>,
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

  #error<T extends RequestValue>(
    request: T,
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

  #deploymentFor(
    request: RequestValue,
    capability: "completeStructured" | "embed" | "streamConversation",
  ): FrozenLlamaCppDeploymentConfigV1 {
    const config = this.#deployments.get(llamaCppDeploymentKey(request.modelDeploymentRef));
    if (config === undefined)
      throw this.#error(request, "MODEL_DEPLOYMENT_NOT_FOUND", "deployment.lookup", false);
    if (!config.capabilities.includes(capability))
      throw this.#error(request, "MODEL_CAPABILITY_UNAVAILABLE", "deployment.capability", false);
    if (
      config.deploymentRef.entityId !== request.modelDeploymentRef.entityId ||
      config.deploymentRef.versionId !== request.modelDeploymentRef.versionId
    ) {
      throw this.#error(request, "MODEL_DEPLOYMENT_MISMATCH", "deployment.reference", false);
    }
    return config;
  }

  #assertBudget(
    request: RequestValue,
    config: FrozenLlamaCppDeploymentConfigV1,
    inputBytes: number,
  ): void {
    assertModelGatewayRequestBudget(
      request,
      config,
      inputBytes,
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
  }

  async #preflightParentArtifacts(request: RequestValue): Promise<void> {
    try {
      await preflightParentArtifacts(request, this.#parentArtifactPreflight);
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      if (error instanceof ArtifactStoreError) throw this.#artifactError(request, error);
      throw this.#error(request, "MODEL_AUTHORIZATION_DENIED", "parent-artifact.preflight", false);
    }
  }

  #createControl(
    request: RequestValue,
    config: FrozenLlamaCppDeploymentConfigV1,
    callerSignal: AbortSignal | undefined,
  ): CallControl {
    const internal = new AbortController();
    let abortReason: "caller" | "deadline" | "request-timeout" | "idle" | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const deadlineMs = Date.parse(request.deadlineAt) - this.#now().getTime();
    const timeoutMs = Math.min(config.requestTimeoutMs, Math.max(0, deadlineMs));
    const deadlineWins = deadlineMs < config.requestTimeoutMs;
    const timeoutTimer = setTimeout(() => {
      abortReason = deadlineWins ? "deadline" : "request-timeout";
      internal.abort();
    }, timeoutMs);
    const onCallerAbort = (): void => {
      abortReason = "caller";
      internal.abort();
    };
    if (callerSignal?.aborted) onCallerAbort();
    else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    const signal =
      callerSignal === undefined
        ? internal.signal
        : AbortSignal.any([callerSignal, internal.signal]);
    return {
      signal,
      reason: () => abortReason,
      abort: (reason) => {
        abortReason = reason;
        internal.abort();
      },
      resetIdle: () => {
        if (idleTimer !== undefined) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          abortReason = "idle";
          internal.abort();
        }, config.streamIdleTimeoutMs);
      },
      stopIdle: () => {
        if (idleTimer !== undefined) {
          clearTimeout(idleTimer);
          idleTimer = undefined;
        }
      },
      cleanup: () => {
        clearTimeout(timeoutTimer);
        if (idleTimer !== undefined) clearTimeout(idleTimer);
        callerSignal?.removeEventListener("abort", onCallerAbort);
      },
    };
  }

  async #ensureReady(
    request: RequestValue,
    config: FrozenLlamaCppDeploymentConfigV1,
    control: CallControl,
  ): Promise<void> {
    const key = llamaCppDeploymentKey(config.deploymentRef);
    let probe = this.#probeCache.get(key);
    if (probe === undefined) {
      probe = this.#probe(request, config, control);
      this.#probeCache.set(key, probe);
    }
    try {
      await probe;
    } catch (error) {
      if (this.#probeCache.get(key) === probe) this.#probeCache.delete(key);
      throw error;
    }
  }

  #invalidateProbeAfterFailure(
    config: FrozenLlamaCppDeploymentConfigV1 | undefined,
    failure: ModelGatewayError,
  ): void {
    if (
      config === undefined ||
      ![
        "MODEL_SERVICE_UNAVAILABLE",
        "MODEL_REQUEST_TIMEOUT",
        "MODEL_STREAM_IDLE_TIMEOUT",
        "MODEL_HTTP_ERROR",
        "MODEL_PROTOCOL_ERROR",
        "MODEL_STREAM_INTERRUPTED",
      ].includes(failure.code)
    )
      return;
    this.#probeCache.delete(llamaCppDeploymentKey(config.deploymentRef));
  }

  async #probe(
    request: RequestValue,
    config: FrozenLlamaCppDeploymentConfigV1,
    control: CallControl,
  ): Promise<void> {
    let health: Uint8Array;
    let propsEmbeddingDimensions: number | undefined;
    try {
      const response = await this.#fetchResponse(
        request,
        config,
        control,
        "/health",
        undefined,
        "probe.health",
      );
      health = await readBoundedBytes(response, Math.min(config.maxResponseBytes, 256 * 1024));
      if (!response.ok)
        throw this.#error(request, "MODEL_SERVICE_UNAVAILABLE", "probe.health", true);
      if (health.byteLength > 0) HealthResponseSchema.parse(decodeJson(health));
    } catch (error) {
      throw this.#mapError(error, request, control);
    }
    void health;
    try {
      const propsResponse = await this.#fetchResponse(
        request,
        config,
        control,
        "/props",
        undefined,
        "probe.props",
      );
      const propsBytes = await readBoundedBytes(
        propsResponse,
        Math.min(config.maxResponseBytes, 256 * 1024),
      );
      if (!propsResponse.ok)
        throw this.#error(request, "MODEL_SERVICE_UNAVAILABLE", "probe.props", true);
      const props = PropsResponseSchema.parse(decodeJson(propsBytes));
      propsEmbeddingDimensions = props.n_embd;
      const contextWindow = props.n_ctx ?? props.default_generation_settings?.n_ctx;
      if (
        props.build_info !== config.expectedBuildInfo ||
        contextWindow !== config.contextWindowTokens
      ) {
        throw this.#error(request, "MODEL_DEPLOYMENT_MISMATCH", "probe.props", false);
      }
    } catch (error) {
      throw this.#mapError(error, request, control);
    }
    try {
      const modelsResponse = await this.#fetchResponse(
        request,
        config,
        control,
        "/v1/models",
        undefined,
        "probe.models",
      );
      const modelsBytes = await readBoundedBytes(
        modelsResponse,
        Math.min(config.maxResponseBytes, 256 * 1024),
      );
      if (!modelsResponse.ok)
        throw this.#error(request, "MODEL_SERVICE_UNAVAILABLE", "probe.models", true);
      const models = ModelsResponseSchema.parse(decodeJson(modelsBytes));
      const model = models.data.find((entry) => entry.id === config.modelAlias);
      if (model === undefined)
        throw this.#error(request, "MODEL_DEPLOYMENT_MISMATCH", "probe.models", false);
      if (
        config.capabilities.includes("embed") &&
        (model.meta?.n_embd ?? propsEmbeddingDimensions) !== config.embeddingDimensions
      )
        throw this.#error(request, "MODEL_DEPLOYMENT_MISMATCH", "probe.embedding-dimension", false);
    } catch (error) {
      throw this.#mapError(error, request, control);
    }
  }

  async #preflightTokens(
    request: StructuredCompletionRequestV1 | ConversationRequestV1,
    config: FrozenLlamaCppDeploymentConfigV1,
    control: CallControl,
  ): Promise<number> {
    const payload = this.#chatPayload(request, config, {});
    const response = await this.#fetchResponse(
      request,
      config,
      control,
      "/v1/chat/completions/input_tokens",
      payload,
      "chat.input-tokens",
    );
    const bytes = await readBoundedBytes(response, Math.min(config.maxResponseBytes, 256 * 1024));
    if (!response.ok) {
      let contextError = false;
      try {
        const envelope = HttpErrorEnvelopeSchema.parse(decodeJson(bytes));
        contextError =
          envelope.error.code === "context_length_exceeded" ||
          envelope.error.code === "context_window_exceeded";
      } catch {
        // The public error remains a closed protocol error when the envelope is not recognized.
      }
      if (contextError)
        throw this.#error(request, "MODEL_CONTEXT_EXCEEDED", "chat.input-tokens", false);
      throw this.#httpError(
        request,
        response.status,
        "chat.input-tokens",
        undefined,
        bytes.byteLength,
      );
    }
    try {
      const result = InputTokensResponseSchema.parse(decodeJson(bytes));
      return "tokens" in result
        ? result.tokens
        : "input_tokens" in result
          ? result.input_tokens
          : result.n_tokens;
    } catch {
      throw this.#error(request, "MODEL_PROTOCOL_ERROR", "chat.input-tokens", false);
    }
  }

  async #preflightEmbeddingTokens(
    request: EmbeddingRequestV1,
    config: FrozenLlamaCppDeploymentConfigV1,
    control: CallControl,
  ): Promise<void> {
    for (const text of request.texts) {
      const response = await this.#fetchResponse(
        request,
        config,
        control,
        "/tokenize",
        { content: text, add_special: false, parse_special: true, with_pieces: false },
        "embedding.input-tokens",
      );
      const bytes = await readBoundedBytes(response, Math.min(config.maxResponseBytes, 256 * 1024));
      if (!response.ok) {
        let contextError = false;
        try {
          const envelope = HttpErrorEnvelopeSchema.parse(decodeJson(bytes));
          contextError =
            envelope.error.code === "context_length_exceeded" ||
            envelope.error.code === "context_window_exceeded";
        } catch {
          // The public error remains a closed protocol error when the envelope is not recognized.
        }
        if (contextError)
          throw this.#error(request, "MODEL_CONTEXT_EXCEEDED", "embedding.input-tokens", false);
        throw this.#httpError(
          request,
          response.status,
          "embedding.input-tokens",
          undefined,
          bytes.byteLength,
        );
      }
      let tokenCount: number;
      try {
        tokenCount = TokenizeResponseSchema.parse(decodeJson(bytes)).tokens.length;
      } catch {
        throw this.#error(request, "MODEL_PROTOCOL_ERROR", "embedding.input-tokens", false);
      }
      if (tokenCount > config.contextWindowTokens) {
        throw this.#error(request, "MODEL_CONTEXT_EXCEEDED", "embedding.input-tokens", false, {
          counts: { inputTokens: tokenCount },
        });
      }
    }
  }

  #chatPayload(
    request: StructuredCompletionRequestV1 | ConversationRequestV1,
    config: FrozenLlamaCppDeploymentConfigV1,
    extra: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      model: config.modelAlias,
      messages: request.messages,
      ...this.#samplingPayload(config),
      reasoning_format: "none",
      ...extra,
    };
  }

  #samplingPayload(config: FrozenLlamaCppDeploymentConfigV1): Record<string, unknown> {
    const policy = config.samplingPolicy;
    return {
      ...(policy.temperature === undefined ? {} : { temperature: policy.temperature }),
      ...(policy.topP === undefined ? {} : { top_p: policy.topP }),
      ...(policy.topK === undefined ? {} : { top_k: policy.topK }),
      ...(policy.minP === undefined ? {} : { min_p: policy.minP }),
      ...(policy.repeatPenalty === undefined ? {} : { repeat_penalty: policy.repeatPenalty }),
      ...(policy.seed === undefined ? {} : { seed: policy.seed }),
    };
  }

  #toJsonSchema<T>(
    request: StructuredCompletionRequestV1,
    schema: ZodType<T>,
  ): Record<string, unknown> {
    try {
      const generated = z.toJSONSchema(schema as never) as Record<string, unknown>;
      const { $schema: _schema, ...withoutMeta } = generated;
      void _schema;
      return withoutMeta;
    } catch {
      throw this.#errorFromIdentity(
        { invocationId: request.invocationId, modelDeploymentRef: request.modelDeploymentRef },
        "MODEL_SCHEMA_UNSUPPORTED",
        "schema.convert",
        false,
      );
    }
  }

  async #fetchResponse(
    request: RequestValue,
    config: FrozenLlamaCppDeploymentConfigV1,
    control: CallControl,
    path: string,
    payload: Record<string, unknown> | undefined,
    stage: string,
  ): Promise<Response> {
    try {
      return await this.#fetch(new URL(path, config.baseUrl), {
        method: payload === undefined ? "GET" : "POST",
        ...(payload === undefined
          ? {}
          : { body: JSON.stringify(payload), headers: { "content-type": "application/json" } }),
        redirect: "error",
        signal: control.signal,
      });
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

  #parseChatResponse(
    request: StructuredCompletionRequestV1,
    bytes: Uint8Array,
    rawResponseRef: DiagnosticArtifactRefV1,
    stage: string,
  ): {
    readonly content: string;
    readonly finishReason: "stop" | "length";
    readonly usage: ModelUsageV1;
  } {
    let parsed: z.infer<typeof ChatResponseSchema>;
    try {
      parsed = ChatResponseSchema.parse(decodeJson(bytes));
    } catch {
      throw this.#error(request, "MODEL_PROTOCOL_ERROR", `${stage}.protocol`, false, {
        rawResponseRef,
      });
    }
    if (parsed.choices.length !== 1) {
      throw this.#error(request, "MODEL_STRUCTURE_INVALID", `${stage}.choice-count`, false, {
        rawResponseRef,
      });
    }
    const choice = parsed.choices[0]!;
    if (
      choice.index !== 0 ||
      choice.finish_reason === null ||
      choice.message.content === undefined ||
      choice.message.content === null
    ) {
      throw this.#error(request, "MODEL_STRUCTURE_INVALID", `${stage}.choice`, false, {
        rawResponseRef,
      });
    }
    return {
      content: choice.message.content,
      finishReason: choice.finish_reason,
      usage: usageFromWire(parsed.usage),
    };
  }

  #httpError(
    request: RequestValue,
    status: number,
    stage: string,
    rawResponseRef: DiagnosticArtifactRefV1 | undefined,
    responseBytes: number,
  ): ModelGatewayError {
    return this.#error(request, "MODEL_HTTP_ERROR", stage, statusRetryable(status), {
      rawResponseRef,
      counts: { responseBytes },
    });
  }

  #mapError(
    error: unknown,
    request: RequestValue,
    control: CallControl | undefined,
  ): ModelGatewayError {
    if (error instanceof ModelGatewayError) return error;
    if (error instanceof ArtifactStoreError) return this.#artifactError(request, error);
    if (error instanceof ResponseBodyLimitError)
      return this.#error(request, "MODEL_PROTOCOL_ERROR", "response.size", false, {
        counts: { responseBytes: error.partial.byteLength },
      });
    if (error instanceof ConsumerStoppedError)
      return this.#error(request, "MODEL_ABORTED", "stream.consumer", false);
    const reason = control?.reason();
    if (reason === "caller")
      return this.#error(request, "MODEL_ABORTED", "request.cancelled", false);
    if (reason === "idle")
      return this.#error(request, "MODEL_STREAM_IDLE_TIMEOUT", "stream.idle", true);
    if (reason === "deadline" || reason === "request-timeout")
      return this.#error(request, "MODEL_REQUEST_TIMEOUT", "request.timeout", true);
    return this.#error(request, "MODEL_PROTOCOL_ERROR", "request.failure", false);
  }

  #artifactError(request: RequestValue, error: ArtifactStoreError): ModelGatewayError {
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
      {
        diagnosticRef: error.diagnosticRef,
      },
    );
  }

  #artifactFailureError(request: RequestValue, error: unknown): ModelGatewayError {
    if (error instanceof ModelGatewayError) return error;
    if (error instanceof ArtifactStoreError) return this.#artifactError(request, error);
    return this.#error(request, "MODEL_ARTIFACT_PERSISTENCE_FAILED", "artifact.persistence", false);
  }

  async #failureWithDiagnostic(
    request: RequestValue,
    failure: ModelGatewayError,
    operation: string,
  ): Promise<ModelGatewayError> {
    if (
      failure.rawResponseRef !== undefined ||
      failure.diagnosticRef !== undefined ||
      failure.code === "MODEL_INPUT_INVALID" ||
      failure.code === "MODEL_AUTHORIZATION_DENIED" ||
      failure.code === "MODEL_DEPLOYMENT_NOT_FOUND" ||
      failure.code === "MODEL_CAPABILITY_UNAVAILABLE" ||
      failure.code === "MODEL_DEPLOYMENT_MISMATCH" ||
      failure.code === "MODEL_SCHEMA_UNSUPPORTED" ||
      failure.code === "MODEL_CONTEXT_EXCEEDED" ||
      failure.code === "MODEL_IDEMPOTENCY_CONFLICT" ||
      failure.stage === "parent-artifact.preflight"
    )
      return failure;
    try {
      const diagnosticRef = await this.#persistDiagnostic(request, failure.code, operation);
      return new ModelGatewayError(ModelGatewayErrorV1Schema.parse({ ...failure, diagnosticRef }));
    } catch (error) {
      const mapped =
        error instanceof ModelGatewayError ? error : this.#mapError(error, request, undefined);
      return mapped.code === "MODEL_ARTIFACT_PERSISTENCE_FAILED"
        ? mapped
        : this.#error(request, "MODEL_ARTIFACT_PERSISTENCE_FAILED", "artifact.diagnostic", false);
    }
  }

  #artifactCommand(
    request: RequestValue,
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

  async #putArtifact(
    request: RequestValue,
    bytes: Uint8Array,
    mediaType: string,
    purposeCode: string,
    artifactIdSuffix: string,
  ): Promise<ReturnType<typeof ArtifactPutResultV1Schema.parse>> {
    try {
      const result = await this.#artifactStore.put(
        this.#artifactCommand(request, artifactIdSuffix, purposeCode, mediaType),
        chunksOf(bytes),
      );
      return ArtifactPutResultV1Schema.parse(result);
    } catch (error) {
      if (error instanceof ArtifactStoreError) throw error;
      throw this.#error(request, "MODEL_ARTIFACT_PERSISTENCE_FAILED", "artifact.put", false);
    }
  }

  async #persistRaw(
    request: RequestValue,
    bytes: Uint8Array,
    mediaType: string,
    operation: string,
    maxResponseBytes: number,
  ): Promise<{ readonly ref: DiagnosticArtifactRefV1; readonly bytes: Uint8Array }> {
    try {
      return await persistRawModelResponse(request, bytes, operation, maxResponseBytes, {
        artifactStore: this.#artifactStore,
        now: this.#now,
        putRaw: async (rawBytes) => {
          const result = await this.#putArtifact(
            request,
            rawBytes,
            mediaType,
            "model-raw-response",
            "model-raw-response",
          );
          if (result.artifactRef.kind !== "diagnostic-artifact")
            throw this.#error(request, "MODEL_ARTIFACT_PERSISTENCE_FAILED", "artifact.kind", false);
          return result.artifactRef;
        },
      });
    } catch (error) {
      if (error instanceof PersistedResponseLimitError)
        throw this.#error(request, "MODEL_ARTIFACT_PERSISTENCE_FAILED", "artifact.open", false, {
          rawResponseRef: error.rawResponseRef,
        });
      throw this.#mapError(error, request, undefined);
    }
  }

  async #persistDiagnostic(
    request: RequestValue,
    code: ModelGatewayErrorCodeV1,
    operation: string,
  ): Promise<DiagnosticArtifactRefV1> {
    const body = encoder.encode(JSON.stringify({ schemaVersion: "1", stage: operation, code }));
    const result = await this.#putArtifact(
      request,
      body,
      "application/json",
      "model-diagnostic",
      `model-diagnostic-${operation}`,
    );
    if (result.artifactRef.kind !== "diagnostic-artifact")
      throw this.#error(
        request,
        "MODEL_ARTIFACT_PERSISTENCE_FAILED",
        "artifact.diagnostic-kind",
        false,
      );
    return result.artifactRef;
  }

  #emit(
    capability: ModelGatewayObservationV1["capability"],
    stage: string,
    resultCode: string,
    startedAt: number,
    values: Omit<ModelGatewayObservationV1, "capability" | "stage" | "resultCode" | "elapsedMs">,
  ): void {
    if (this.#observe === undefined) return;
    try {
      this.#observe({
        capability,
        stage,
        resultCode,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        ...values,
      });
    } catch {
      // Observability is a seam; it cannot change the model result.
    }
  }
}

export const createLlamaCppModelGateway = (
  options: LlamaCppModelGatewayOptionsV1,
): LlamaCppModelGateway => new LlamaCppModelGateway(options);

export const createModelGateway = createLlamaCppModelGateway;
