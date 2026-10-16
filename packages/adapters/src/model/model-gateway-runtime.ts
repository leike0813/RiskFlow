import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import type {
  ConversationRequestV1,
  EmbeddingRequestV1,
  ModelInvocationBaseV1,
  ModelUsageV1,
  StructuredCompletionRequestV1,
} from "@riskflow/core/model";
import type { DiagnosticArtifactRefV1 } from "@riskflow/contracts/ports";

const encoder = new TextEncoder();
const nonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export type ModelGatewayRequestV1 =
  StructuredCompletionRequestV1 | EmbeddingRequestV1 | ConversationRequestV1;

export interface ParentArtifactPreflightRequestV1 {
  readonly projectId: ModelInvocationBaseV1["projectId"];
  readonly authorization: ModelInvocationBaseV1["authorization"];
  readonly requiredCapability: ModelInvocationBaseV1["requiredCapability"];
  readonly parentArtifactRefs: ModelInvocationBaseV1["parentArtifactRefs"];
  readonly purposeCode: "model-raw-response";
}

export type ParentArtifactPreflightV1 = (
  request: ParentArtifactPreflightRequestV1,
) => Promise<void>;

export class ResponseBodyLimitError extends Error {
  constructor(readonly partial: Uint8Array) {
    super("response body limit");
    this.name = "ResponseBodyLimitError";
  }
}

export class PersistedResponseLimitError extends Error {
  constructor(readonly rawResponseRef: DiagnosticArtifactRefV1) {
    super("persisted response exceeds configured read limit");
    this.name = "PersistedResponseLimitError";
  }
}

export class ConsumerStoppedError extends Error {
  constructor() {
    super("stream consumer stopped");
    this.name = "ConsumerStoppedError";
  }
}

export class OneSlotQueue<T> implements AsyncIterable<T> {
  #value: T | undefined;
  #hasValue = false;
  #closed = false;
  #closeError: unknown;
  readonly #consumers: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  readonly #producers: Array<() => void> = [];

  constructor(readonly onConsumerStop?: () => void) {}

  async push(value: T): Promise<void> {
    if (this.#closed) throw this.#closeError ?? new Error("queue closed");
    const consumer = this.#consumers.shift();
    if (consumer !== undefined) return consumer.resolve({ done: false, value });
    while (this.#hasValue && !this.#closed)
      await new Promise<void>((resolve) => this.#producers.push(resolve));
    if (this.#closed) throw this.#closeError ?? new Error("queue closed");
    this.#value = value;
    this.#hasValue = true;
  }

  close(error?: unknown): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#closeError = error;
    for (const consumer of this.#consumers.splice(0)) {
      if (error === undefined) consumer.resolve({ done: true, value: undefined });
      else consumer.reject(error);
    }
    for (const producer of this.#producers.splice(0)) producer();
  }

  next(): Promise<IteratorResult<T>> {
    if (this.#hasValue) {
      const value = this.#value as T;
      this.#value = undefined;
      this.#hasValue = false;
      this.#producers.shift()?.();
      return Promise.resolve({ done: false, value });
    }
    if (this.#closed)
      return this.#closeError === undefined
        ? Promise.resolve({ done: true, value: undefined })
        : Promise.reject(this.#closeError);
    return new Promise((resolve, reject) => this.#consumers.push({ resolve, reject }));
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return {
      next: () => this.next(),
      return: async () => {
        this.onConsumerStop?.();
        this.close(new ConsumerStoppedError());
        return { done: true, value: undefined };
      },
      throw: async (error?: unknown) => {
        this.onConsumerStop?.();
        this.close(error ?? new ConsumerStoppedError());
        throw error;
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }
}

const concatBytes = (parts: readonly Uint8Array[], total: number): Uint8Array => {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
};

export const readBoundedBytes = async (
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> => {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  let completed = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        return concatBytes(parts, total);
      }
      if (value === undefined) continue;
      const nextTotal = total + value.byteLength;
      if (!Number.isSafeInteger(nextTotal) || nextTotal > maxBytes) {
        const remaining = Math.max(0, maxBytes - total);
        if (remaining > 0) parts.push(value.slice(0, remaining));
        void reader.cancel().catch(() => undefined);
        throw new ResponseBodyLimitError(concatBytes(parts, Math.min(nextTotal, maxBytes)));
      }
      total = nextTotal;
      parts.push(new Uint8Array(value));
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
};

export const decodeJson = (bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));

export const usageFromWire = (value: unknown): ModelUsageV1 => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { available: false };
  const usage = value as Record<string, unknown>;
  const inputTokens = usage.prompt_tokens;
  const outputTokens = usage.completion_tokens;
  const totalTokens = usage.total_tokens;
  if (
    (inputTokens !== undefined && !nonNegativeInteger(inputTokens)) ||
    (outputTokens !== undefined && !nonNegativeInteger(outputTokens)) ||
    (totalTokens !== undefined && !nonNegativeInteger(totalTokens)) ||
    (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined)
  )
    return { available: false };
  return {
    available: true,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
};

export const inputBytesForMessages = (messages: readonly { readonly content: string }[]): number =>
  messages.reduce((total, message) => total + encoder.encode(message.content).byteLength, 0);

/** Action quotas may only narrow the frozen deployment window; the smaller value wins. */
export const structuredTokenLimits = (
  request: StructuredCompletionRequestV1,
  deploymentContextWindowTokens: number,
): { readonly maxInputTokens: number | undefined; readonly maxContextTokens: number } => ({
  maxInputTokens:
    request.maxInputTokens === undefined
      ? undefined
      : Math.min(request.maxInputTokens, deploymentContextWindowTokens),
  maxContextTokens:
    request.maxContextTokens === undefined
      ? deploymentContextWindowTokens
      : Math.min(request.maxContextTokens, deploymentContextWindowTokens),
});

export interface ModelUsageCounts {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/** Counters of an already converted usage; never carries response text or thinking content. */
export const usageCounts = (usage: ModelUsageV1): ModelUsageCounts =>
  usage.available
    ? {
        ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
        ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
      }
    : {};

/** Best-effort counters from persisted raw bytes when later parsing fails. */
export const rawUsageCounts = (bytes: Uint8Array): ModelUsageCounts => {
  let value: unknown;
  try {
    value = decodeJson(bytes);
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return usageCounts(usageFromWire((value as Record<string, unknown>).usage));
};

export const inputBytesForTexts = (texts: readonly string[]): number =>
  texts.reduce((total, text) => total + encoder.encode(text).byteLength, 0);

export const hasAuthorizationMismatch = (request: unknown): boolean => {
  if (typeof request !== "object" || request === null || Array.isArray(request)) return false;
  const value = request as Record<string, unknown>;
  if (typeof value.authorization !== "object" || value.authorization === null) return false;
  const authorization = value.authorization as Record<string, unknown>;
  return (
    (typeof value.projectId === "string" && value.projectId !== authorization.projectId) ||
    (typeof value.actorId === "string" && value.actorId !== authorization.actorId) ||
    (typeof value.requiredCapability === "string" &&
      Array.isArray(authorization.grantedCapabilities) &&
      !authorization.grantedCapabilities.includes(value.requiredCapability))
  );
};

export const assertModelGatewayRequestBudget = <T extends ModelGatewayRequestV1>(
  request: T,
  config: {
    readonly maxInputBytes: number;
    readonly maxBatchItems: number;
    readonly maxOutputTokens: number;
    readonly contextWindowTokens: number;
  },
  inputBytes: number,
  fail: (
    code: "MODEL_REQUEST_TIMEOUT" | "MODEL_CONTEXT_EXCEEDED" | "MODEL_INPUT_INVALID",
    stage: string,
    counts?: { inputBytes?: number; batchItems?: number },
  ) => never,
  now: () => Date,
): void => {
  if (Date.parse(request.deadlineAt) <= now().getTime())
    fail("MODEL_REQUEST_TIMEOUT", "request.deadline");
  if (inputBytes > config.maxInputBytes)
    fail("MODEL_CONTEXT_EXCEEDED", "request.input-bytes", { inputBytes });
  if ("maxOutputTokens" in request) {
    if (request.maxOutputTokens > config.maxOutputTokens)
      fail("MODEL_INPUT_INVALID", "request.output-budget");
    if (request.maxOutputTokens > config.contextWindowTokens)
      fail("MODEL_CONTEXT_EXCEEDED", "request.context");
  }
  if ("maxInputBytes" in request) {
    if (
      request.maxInputBytes > config.maxInputBytes ||
      request.maxBatchItems > config.maxBatchItems
    )
      fail("MODEL_INPUT_INVALID", "request.input-budget");
    if (request.texts.length > request.maxBatchItems)
      fail("MODEL_CONTEXT_EXCEEDED", "request.batch", { batchItems: request.texts.length });
    if (inputBytes > request.maxInputBytes)
      fail("MODEL_CONTEXT_EXCEEDED", "request.input-budget", { inputBytes });
  }
};

export const conservativeTokenUpperBound = (
  serializedRequestBytes: number,
  maxTokensPerInputByte: number,
  requestOverheadTokens: number,
): number => Math.ceil(serializedRequestBytes * maxTokensPerInputByte) + requestOverheadTokens;

export const preflightParentArtifacts = async (
  request: ModelGatewayRequestV1,
  preflight: ParentArtifactPreflightV1 | undefined,
): Promise<void> => {
  if (request.parentArtifactRefs.length === 0) return;
  if (preflight === undefined) throw new Error("parent artifact preflight unavailable");
  await preflight({
    projectId: request.projectId,
    authorization: request.authorization,
    requiredCapability: request.requiredCapability,
    parentArtifactRefs: request.parentArtifactRefs,
    purposeCode: "model-raw-response",
  });
};

export const persistRawModelResponse = async (
  _request: ModelGatewayRequestV1,
  bytes: Uint8Array,
  _operation: string,
  maxResponseBytes: number,
  options: {
    readonly artifactStore: ArtifactStoreV1;
    readonly putRaw: (bytes: Uint8Array) => Promise<DiagnosticArtifactRefV1>;
    readonly now: () => Date;
  },
): Promise<{ readonly ref: DiagnosticArtifactRefV1; readonly bytes: Uint8Array }> => {
  const ref = await options.putRaw(bytes);
  if (bytes.byteLength > maxResponseBytes) throw new PersistedResponseLimitError(ref);
  return { ref, bytes };
};
