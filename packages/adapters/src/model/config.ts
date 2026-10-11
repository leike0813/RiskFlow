import { ModelCapabilityV1Schema, type ModelCapabilityV1 } from "@riskflow/core/model";
import { IdentifierSchema, VersionReferenceSchema } from "@riskflow/contracts/common";
import { z } from "@riskflow/core/model";

const safeInteger = z.number().int().refine(Number.isSafeInteger, "must be a safe integer");
const positiveSafeInteger = safeInteger.positive();
const modelAliasSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(
    (value) =>
      value !== "." &&
      value !== ".." &&
      !value.includes("/") &&
      !value.includes("\\") &&
      !value.includes("\u0000"),
    "model alias must not be a path",
  );
const finiteNumber = z.number().refine(Number.isFinite, "must be finite");

const networkCommon = {
  schemaVersion: z.literal("1"),
  deploymentRef: VersionReferenceSchema,
  serviceContractRef: VersionReferenceSchema,
  modelVersionRef: VersionReferenceSchema,
  modelId: z.string().trim().min(1).max(256),
  contextWindowTokens: positiveSafeInteger,
  requestTimeoutMs: positiveSafeInteger,
  streamIdleTimeoutMs: positiveSafeInteger,
  maxResponseBytes: positiveSafeInteger,
  maxInputBytes: positiveSafeInteger,
  maxBatchItems: positiveSafeInteger,
  inputTokenUpperBoundPolicy: z.strictObject({
    maxTokensPerInputByte: finiteNumber.min(1),
    requestOverheadTokens: safeInteger.nonnegative(),
  }),
};

const openAiBaseUrl = z.string().url().superRefine((value, context) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      context.addIssue({ code: "custom", message: "chat baseUrl must be credential-free HTTPS" });
    }
    if (url.pathname !== "/" && !url.pathname.endsWith("/v1")) {
      context.addIssue({ code: "custom", message: "chat baseUrl path must be empty or end in /v1" });
    }
  } catch {
    context.addIssue({ code: "custom", message: "chat baseUrl must be a valid URL" });
  }
});

const ollamaBaseUrl = z.literal("http://192.168.13.11:11434");

const networkTiming = (
  config: { streamIdleTimeoutMs: number; requestTimeoutMs: number; contextWindowTokens: number; maxOutputTokens: number },
  context: z.RefinementCtx,
): void => {
  if (config.streamIdleTimeoutMs > config.requestTimeoutMs) {
    context.addIssue({ code: "custom", path: ["streamIdleTimeoutMs"], message: "stream idle timeout exceeds request timeout" });
  }
  if (config.maxOutputTokens > config.contextWindowTokens) {
    context.addIssue({ code: "custom", path: ["maxOutputTokens"], message: "output budget exceeds context window" });
  }
};

export const NetworkApiDeploymentConfigV1Schema = z.discriminatedUnion("protocol", [
  z.strictObject({
    ...networkCommon,
    protocol: z.literal("openai-chat"),
    baseUrl: openAiBaseUrl,
    credentialRef: IdentifierSchema,
    capabilities: z.array(z.enum(["completeStructured", "streamConversation"])).min(1).max(2),
    maxOutputTokens: positiveSafeInteger,
    structuredOutputMode: z.enum(["server-json-schema", "schema-prompt"]),
    reasoningEffort: z.enum(["low", "medium", "high", "xhigh", "max"]),
  }).superRefine(networkTiming),
  z.strictObject({
    ...networkCommon,
    protocol: z.literal("ollama-embed"),
    baseUrl: ollamaBaseUrl,
    capabilities: z.tuple([z.literal("embed")]),
    embeddingDimensions: positiveSafeInteger,
    expectedServerVersion: z.string().trim().min(1).max(128),
    expectedModelDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);
export type NetworkApiDeploymentConfigV1 = z.infer<typeof NetworkApiDeploymentConfigV1Schema>;

export const LlamaCppSamplingPolicyV1Schema = z.strictObject({
  temperature: finiteNumber.min(0).max(2).optional(),
  topP: finiteNumber.gt(0).max(1).optional(),
  topK: safeInteger.nonnegative().optional(),
  minP: finiteNumber.min(0).max(1).optional(),
  repeatPenalty: finiteNumber.gt(0).max(10).optional(),
  seed: safeInteger.optional(),
});
export type LlamaCppSamplingPolicyV1 = z.infer<typeof LlamaCppSamplingPolicyV1Schema>;

const capabilitiesSchema = z
  .array(ModelCapabilityV1Schema)
  .min(1)
  .max(3)
  .refine((values) => new Set(values).size === values.length, "capabilities must be unique");

const originUrlSchema = z
  .string()
  .url()
  .superRefine((value, context) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        context.addIssue({ code: "custom", message: "baseUrl must use http or https" });
      }
      if (
        url.username !== "" ||
        url.password !== "" ||
        url.search !== "" ||
        url.hash !== "" ||
        (url.pathname !== "" && url.pathname !== "/")
      ) {
        context.addIssue({ code: "custom", message: "baseUrl must be an origin" });
      }
    } catch {
      context.addIssue({ code: "custom", message: "baseUrl must be a valid URL" });
    }
  });

export const LlamaCppDeploymentConfigV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    deploymentRef: VersionReferenceSchema,
    serverBuildRef: VersionReferenceSchema,
    expectedBuildInfo: IdentifierSchema.max(256),
    modelVersionRef: VersionReferenceSchema,
    modelAlias: modelAliasSchema,
    baseUrl: originUrlSchema,
    capabilities: capabilitiesSchema,
    contextWindowTokens: positiveSafeInteger,
    embeddingDimensions: positiveSafeInteger.optional(),
    requestTimeoutMs: positiveSafeInteger,
    streamIdleTimeoutMs: positiveSafeInteger,
    maxResponseBytes: positiveSafeInteger,
    maxInputBytes: positiveSafeInteger,
    maxBatchItems: positiveSafeInteger,
    maxOutputTokens: positiveSafeInteger,
    samplingPolicy: LlamaCppSamplingPolicyV1Schema,
  })
  .superRefine((config, context) => {
    const supportsEmbedding = config.capabilities.includes("embed");
    if (supportsEmbedding && config.embeddingDimensions === undefined) {
      context.addIssue({
        code: "custom",
        path: ["embeddingDimensions"],
        message: "embedding capability requires embeddingDimensions",
      });
    }
    if (!supportsEmbedding && config.embeddingDimensions !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["embeddingDimensions"],
        message: "embeddingDimensions requires embed capability",
      });
    }
    if (config.streamIdleTimeoutMs > config.requestTimeoutMs) {
      context.addIssue({
        code: "custom",
        path: ["streamIdleTimeoutMs"],
        message: "stream idle timeout must not exceed request timeout",
      });
    }
    if (config.maxOutputTokens > config.contextWindowTokens) {
      context.addIssue({
        code: "custom",
        path: ["maxOutputTokens"],
        message: "max output tokens must fit the context window",
      });
    }
  });

export const ModelGatewayDeploymentConfigV1Schema = z.discriminatedUnion("backend", [
  z.strictObject({ backend: z.literal("llamacpp"), config: LlamaCppDeploymentConfigV1Schema }),
  z.strictObject({ backend: z.literal("network-api"), config: NetworkApiDeploymentConfigV1Schema }),
]);
export type ModelGatewayDeploymentConfigV1 = z.infer<typeof ModelGatewayDeploymentConfigV1Schema>;
export type LlamaCppDeploymentConfigV1 = z.infer<typeof LlamaCppDeploymentConfigV1Schema>;

export type FrozenLlamaCppDeploymentConfigV1 = Readonly<
  Omit<
    LlamaCppDeploymentConfigV1,
    "serverBuildRef" | "modelVersionRef" | "deploymentRef" | "samplingPolicy"
  >
> & {
  readonly deploymentRef: Readonly<LlamaCppDeploymentConfigV1["deploymentRef"]>;
  readonly serverBuildRef: Readonly<LlamaCppDeploymentConfigV1["serverBuildRef"]>;
  readonly modelVersionRef: Readonly<LlamaCppDeploymentConfigV1["modelVersionRef"]>;
  readonly samplingPolicy: Readonly<LlamaCppSamplingPolicyV1>;
  readonly capabilities: readonly ModelCapabilityV1[];
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
};

export const freezeLlamaCppDeploymentConfig = (value: unknown): FrozenLlamaCppDeploymentConfigV1 =>
  deepFreeze(LlamaCppDeploymentConfigV1Schema.parse(value)) as FrozenLlamaCppDeploymentConfigV1;

export const parseLlamaCppDeploymentConfig = freezeLlamaCppDeploymentConfig;

export const llamaCppDeploymentKey = (ref: {
  readonly entityId: string;
  readonly versionId: string;
}): string => `${ref.entityId}\u0000${ref.versionId}`;
