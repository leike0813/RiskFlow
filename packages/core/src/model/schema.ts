import { z, type ZodType } from "zod";

import {
  AuthorizationContextV1Schema,
  DiagnosticArtifactRefV1Schema,
  ModuleCapabilityV1Schema,
  type AuthorizationContextV1,
  type ModuleCapabilityV1,
} from "@riskflow/contracts/ports";
import {
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import { ArtifactRefV1Schema } from "../artifacts/schema.js";

const safeInteger = z.number().int().refine(Number.isSafeInteger, "must be a safe integer");
const nonNegativeSafeInteger = safeInteger.nonnegative();
const positiveSafeInteger = safeInteger.positive();
const artifactReference = ArtifactRefV1Schema;
const artifactReferenceKey = (value: {
  kind: string;
  reference: { entityId: string; versionId: string };
}): string => `${value.kind}/${value.reference.entityId}/${value.reference.versionId}`;
const evidenceReferenceKey = (value: {
  locator: { sourceSegmentId: string };
  sourceVersion: { entityId: string; versionId: string };
}): string =>
  `${value.locator.sourceSegmentId}/${value.sourceVersion.entityId}/${value.sourceVersion.versionId}`;
const sortedUnique = <T>(schema: z.ZodType<T>, key: (value: T) => string) =>
  z.array(schema).superRefine((values, context) => {
    const keys = values.map(key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "collection must not contain duplicates" });
    }
    for (let index = 1; index < keys.length; index += 1) {
      if (keys[index - 1]! >= keys[index]!) {
        context.addIssue({ code: "custom", message: "collection must be sorted" });
        break;
      }
    }
  });

export const MODEL_CAPABILITY_V1_VALUES = [
  "completeStructured",
  "embed",
  "streamConversation",
] as const;
export const ModelCapabilityV1Schema = z.enum(MODEL_CAPABILITY_V1_VALUES);
export type ModelCapabilityV1 = z.infer<typeof ModelCapabilityV1Schema>;

const boundedMessageText = z.string().max(1_048_576);
export const ModelMessageV1Schema = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("system"), content: boundedMessageText }),
  z.strictObject({ role: z.literal("user"), content: boundedMessageText }),
  z.strictObject({ role: z.literal("assistant"), content: boundedMessageText }),
]);
export type ModelMessageV1 = z.infer<typeof ModelMessageV1Schema>;

const invocationBaseShape = {
  schemaVersion: z.literal("1"),
  invocationId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  issuedAt: IsoDateTimeSchema,
  projectId: IdentifierSchema,
  actorId: IdentifierSchema,
  authorization: AuthorizationContextV1Schema,
  requiredCapability: ModuleCapabilityV1Schema,
  modelDeploymentRef: VersionReferenceSchema,
  budgetPolicyRef: VersionReferenceSchema,
  deadlineAt: IsoDateTimeSchema,
  parentArtifactRefs: sortedUnique(artifactReference, artifactReferenceKey),
  evidenceReferences: sortedUnique(EvidenceReferenceSchema, evidenceReferenceKey),
};

const validateInvocationBase = (value: unknown, context: z.RefinementCtx): void => {
  const input = value as {
    projectId: string;
    actorId: string;
    requiredCapability: ModuleCapabilityV1;
    authorization: AuthorizationContextV1;
    issuedAt: string;
    deadlineAt: string;
  };
  if (input.projectId !== input.authorization.projectId) {
    context.addIssue({ code: "custom", path: ["projectId"], message: "project mismatch" });
  }
  if (input.actorId !== input.authorization.actorId) {
    context.addIssue({ code: "custom", path: ["actorId"], message: "actor mismatch" });
  }
  if (!input.authorization.grantedCapabilities.includes(input.requiredCapability)) {
    context.addIssue({
      code: "custom",
      path: ["requiredCapability"],
      message: "required capability is not granted",
    });
  }
  if (Date.parse(input.deadlineAt) <= Date.parse(input.issuedAt)) {
    context.addIssue({ code: "custom", path: ["deadlineAt"], message: "deadline must be later" });
  }
};

export const ModelInvocationBaseV1Schema = z
  .strictObject(invocationBaseShape)
  .superRefine(validateInvocationBase);
export type ModelInvocationBaseV1 = z.infer<typeof ModelInvocationBaseV1Schema>;

export const StructuredCompletionRequestV1Schema = z
  .strictObject({
    ...invocationBaseShape,
    promptTemplateRef: VersionReferenceSchema,
    outputSchemaRef: VersionReferenceSchema,
    messages: z.array(ModelMessageV1Schema).min(1).max(256),
    maxOutputTokens: positiveSafeInteger,
    maxInputTokens: positiveSafeInteger.optional(),
    maxContextTokens: positiveSafeInteger.optional(),
  })
  .superRefine(validateInvocationBase);
export type StructuredCompletionRequestV1 = z.infer<typeof StructuredCompletionRequestV1Schema>;

export const EmbeddingRequestV1Schema = z
  .strictObject({
    ...invocationBaseShape,
    texts: z.array(boundedMessageText).min(1).max(4096),
    maxInputBytes: positiveSafeInteger,
    maxBatchItems: positiveSafeInteger,
  })
  .superRefine(validateInvocationBase);
export type EmbeddingRequestV1 = z.infer<typeof EmbeddingRequestV1Schema>;

export const ConversationRequestV1Schema = z
  .strictObject({
    ...invocationBaseShape,
    conversationRef: VersionReferenceSchema,
    promptTemplateRef: VersionReferenceSchema,
    messages: z.array(ModelMessageV1Schema).min(1).max(256),
    maxOutputTokens: positiveSafeInteger,
  })
  .superRefine(validateInvocationBase);
export type ConversationRequestV1 = z.infer<typeof ConversationRequestV1Schema>;

export const ModelUsageV1Schema = z
  .strictObject({
    available: z.boolean(),
    inputTokens: nonNegativeSafeInteger.optional(),
    outputTokens: nonNegativeSafeInteger.optional(),
    totalTokens: nonNegativeSafeInteger.optional(),
  })
  .superRefine((value, context) => {
    if (value.available && value.inputTokens === undefined && value.outputTokens === undefined) {
      context.addIssue({ code: "custom", message: "reported usage must contain token counts" });
    }
  });
export type ModelUsageV1 = z.infer<typeof ModelUsageV1Schema>;

export const ModelTerminationReasonV1Schema = z.enum(["stop", "length"]);
export type ModelTerminationReasonV1 = z.infer<typeof ModelTerminationReasonV1Schema>;

export const ConversationTextDeltaV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  sequence: nonNegativeSafeInteger,
  text: z.string().min(1).max(1_048_576),
});
export type ConversationTextDeltaV1 = z.infer<typeof ConversationTextDeltaV1Schema>;

export const ModelDeploymentSnapshotV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    deploymentRef: VersionReferenceSchema,
    serverBuildRef: VersionReferenceSchema,
    modelVersionRef: VersionReferenceSchema,
    capabilities: z.array(ModelCapabilityV1Schema).min(1),
    contextWindowTokens: positiveSafeInteger,
    embeddingDimensions: positiveSafeInteger.optional(),
    observedAt: IsoDateTimeSchema,
  })
  .superRefine((value, context) => {
    if (value.capabilities.includes("embed") !== (value.embeddingDimensions !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["embeddingDimensions"],
        message: "embedding dimensions must match the declared capability",
      });
    }
  });
export type ModelDeploymentSnapshotV1 = z.infer<typeof ModelDeploymentSnapshotV1Schema>;

const resultBase = {
  schemaVersion: z.literal("1"),
  invocationId: IdentifierSchema,
  modelDeploymentRef: VersionReferenceSchema,
  serverBuildRef: VersionReferenceSchema,
  modelVersionRef: VersionReferenceSchema,
  usage: ModelUsageV1Schema,
  rawResponseRef: DiagnosticArtifactRefV1Schema,
};

export const structuredCompletionResultSchema = <T>(outputSchema: ZodType<T>) =>
  z.strictObject({
    ...resultBase,
    promptTemplateRef: VersionReferenceSchema,
    outputSchemaRef: VersionReferenceSchema,
    value: outputSchema,
    finishReason: z.literal("stop"),
  });
export type StructuredCompletionResultV1<T> = {
  readonly schemaVersion: "1";
  readonly invocationId: string;
  readonly modelDeploymentRef: z.infer<typeof VersionReferenceSchema>;
  readonly serverBuildRef: z.infer<typeof VersionReferenceSchema>;
  readonly modelVersionRef: z.infer<typeof VersionReferenceSchema>;
  readonly usage: ModelUsageV1;
  readonly rawResponseRef: z.infer<typeof DiagnosticArtifactRefV1Schema>;
  readonly promptTemplateRef: z.infer<typeof VersionReferenceSchema>;
  readonly outputSchemaRef: z.infer<typeof VersionReferenceSchema>;
  readonly value: T;
  readonly finishReason: "stop";
};

export const EmbeddingResultV1Schema = z
  .strictObject({
    ...resultBase,
    vectors: z.array(z.array(z.number().refine(Number.isFinite))).min(1),
    dimensions: positiveSafeInteger,
  })
  .superRefine((value, context) => {
    if (value.vectors.some((vector) => vector.length !== value.dimensions)) {
      context.addIssue({
        code: "custom",
        path: ["vectors"],
        message: "all vectors must match the declared dimensions",
      });
    }
  });
export type EmbeddingResultV1 = z.infer<typeof EmbeddingResultV1Schema>;

export const ConversationReceiptV1Schema = z.strictObject({
  ...resultBase,
  conversationRef: VersionReferenceSchema,
  promptTemplateRef: VersionReferenceSchema,
  finishReason: ModelTerminationReasonV1Schema,
  deltaCount: nonNegativeSafeInteger,
  responseByteLength: nonNegativeSafeInteger,
});
export type ConversationReceiptV1 = z.infer<typeof ConversationReceiptV1Schema>;

export const MODEL_GATEWAY_ERROR_CODE_V1_VALUES = [
  "MODEL_INPUT_INVALID",
  "MODEL_AUTHORIZATION_DENIED",
  "MODEL_DEPLOYMENT_NOT_FOUND",
  "MODEL_CAPABILITY_UNAVAILABLE",
  "MODEL_DEPLOYMENT_MISMATCH",
  "MODEL_SCHEMA_UNSUPPORTED",
  "MODEL_CONTEXT_EXCEEDED",
  "MODEL_SERVICE_UNAVAILABLE",
  "MODEL_REQUEST_TIMEOUT",
  "MODEL_STREAM_IDLE_TIMEOUT",
  "MODEL_ABORTED",
  "MODEL_HTTP_ERROR",
  "MODEL_PROTOCOL_ERROR",
  "MODEL_STREAM_INTERRUPTED",
  "MODEL_STRUCTURE_INVALID",
  "MODEL_OUTPUT_SCHEMA_INVALID",
  "MODEL_EMBEDDING_INVALID",
  "MODEL_ARTIFACT_PERSISTENCE_FAILED",
  "MODEL_IDEMPOTENCY_CONFLICT",
] as const;
export const ModelGatewayErrorCodeV1Schema = z.enum(MODEL_GATEWAY_ERROR_CODE_V1_VALUES);
export type ModelGatewayErrorCodeV1 = z.infer<typeof ModelGatewayErrorCodeV1Schema>;

export const ModelGatewayErrorCategoryV1Schema = z.enum([
  "input",
  "authorization",
  "deployment",
  "schema",
  "context",
  "service",
  "timeout",
  "cancelled",
  "http",
  "protocol",
  "stream",
  "structure",
  "embedding",
  "artifact",
  "idempotency",
]);
export type ModelGatewayErrorCategoryV1 = z.infer<typeof ModelGatewayErrorCategoryV1Schema>;

export const ModelGatewayErrorCountsV1Schema = z.strictObject({
  inputBytes: nonNegativeSafeInteger.optional(),
  responseBytes: nonNegativeSafeInteger.optional(),
  inputTokens: nonNegativeSafeInteger.optional(),
  outputTokens: nonNegativeSafeInteger.optional(),
  deltaCount: nonNegativeSafeInteger.optional(),
  batchItems: nonNegativeSafeInteger.optional(),
});
export type ModelGatewayErrorCountsV1 = z.infer<typeof ModelGatewayErrorCountsV1Schema>;

export const ModelGatewayErrorV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    code: ModelGatewayErrorCodeV1Schema,
    category: ModelGatewayErrorCategoryV1Schema,
    retryable: z.boolean(),
    stage: IdentifierSchema,
    occurredAt: IsoDateTimeSchema,
    invocationId: IdentifierSchema,
    modelDeploymentRef: VersionReferenceSchema,
    rawResponseRef: DiagnosticArtifactRefV1Schema.optional(),
    diagnosticRef: DiagnosticArtifactRefV1Schema.optional(),
    counts: ModelGatewayErrorCountsV1Schema.optional(),
    idempotencyKey: IdentifierSchema.optional(),
    priorCommandId: IdentifierSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.category !== MODEL_GATEWAY_ERROR_CATEGORY_V1[value.code]) {
      context.addIssue({
        code: "custom",
        path: ["category"],
        message: "error category must match the error code",
      });
    }
  });
export type ModelGatewayErrorV1 = z.infer<typeof ModelGatewayErrorV1Schema>;

export const MODEL_GATEWAY_ERROR_CATEGORY_V1: Readonly<
  Record<ModelGatewayErrorCodeV1, ModelGatewayErrorCategoryV1>
> = Object.freeze({
  MODEL_INPUT_INVALID: "input",
  MODEL_AUTHORIZATION_DENIED: "authorization",
  MODEL_DEPLOYMENT_NOT_FOUND: "deployment",
  MODEL_CAPABILITY_UNAVAILABLE: "deployment",
  MODEL_DEPLOYMENT_MISMATCH: "deployment",
  MODEL_SCHEMA_UNSUPPORTED: "schema",
  MODEL_CONTEXT_EXCEEDED: "context",
  MODEL_SERVICE_UNAVAILABLE: "service",
  MODEL_REQUEST_TIMEOUT: "timeout",
  MODEL_STREAM_IDLE_TIMEOUT: "timeout",
  MODEL_ABORTED: "cancelled",
  MODEL_HTTP_ERROR: "http",
  MODEL_PROTOCOL_ERROR: "protocol",
  MODEL_STREAM_INTERRUPTED: "stream",
  MODEL_STRUCTURE_INVALID: "structure",
  MODEL_OUTPUT_SCHEMA_INVALID: "schema",
  MODEL_EMBEDDING_INVALID: "embedding",
  MODEL_ARTIFACT_PERSISTENCE_FAILED: "artifact",
  MODEL_IDEMPOTENCY_CONFLICT: "idempotency",
});

export const modelGatewayError = (
  details: Omit<ModelGatewayErrorV1, "schemaVersion" | "category"> & {
    readonly category?: ModelGatewayErrorCategoryV1;
  },
): ModelGatewayErrorV1 =>
  ModelGatewayErrorV1Schema.parse({
    ...details,
    schemaVersion: "1",
    category:
      details.category ?? MODEL_GATEWAY_ERROR_CATEGORY_V1[details.code as ModelGatewayErrorCodeV1],
  });

export const makeModelGatewayError = modelGatewayError;
