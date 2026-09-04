import {
  ModelCapabilityV1Schema,
  type ModelCapabilityV1,
} from "@riskflow/core/model";
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

const originUrlSchema = z.string().url().superRefine((value, context) => {
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
export type LlamaCppDeploymentConfigV1 = z.infer<typeof LlamaCppDeploymentConfigV1Schema>;

export type FrozenLlamaCppDeploymentConfigV1 = Readonly<
  Omit<LlamaCppDeploymentConfigV1, "serverBuildRef" | "modelVersionRef" | "deploymentRef" | "samplingPolicy">>
  & {
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

export const freezeLlamaCppDeploymentConfig = (
  value: unknown,
): FrozenLlamaCppDeploymentConfigV1 =>
  deepFreeze(LlamaCppDeploymentConfigV1Schema.parse(value)) as FrozenLlamaCppDeploymentConfigV1;

export const parseLlamaCppDeploymentConfig = freezeLlamaCppDeploymentConfig;

export const llamaCppDeploymentKey = (ref: {
  readonly entityId: string;
  readonly versionId: string;
}): string => `${ref.entityId}\u0000${ref.versionId}`;
