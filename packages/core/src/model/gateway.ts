import { DiagnosticArtifactRefV1Schema, type ModuleErrorV1 } from "@riskflow/contracts/ports";
import { VersionReferenceSchema } from "@riskflow/contracts/common";
import { z } from "zod";

export { z } from "zod";
export type { ZodType } from "zod";

import {
  ConversationReceiptV1Schema,
  ConversationRequestV1Schema,
  ConversationTextDeltaV1Schema,
  EmbeddingRequestV1Schema,
  EmbeddingResultV1Schema,
  ModelGatewayErrorV1Schema,
  StructuredCompletionRequestV1Schema,
  structuredCompletionResultSchema,
  type ConversationReceiptV1,
  type ConversationRequestV1,
  type ConversationTextDeltaV1,
  type EmbeddingRequestV1,
  type EmbeddingResultV1,
  type ModelGatewayErrorV1,
  type StructuredCompletionRequestV1,
  type StructuredCompletionResultV1,
} from "./schema.js";

export interface ConversationStreamHandleV1 {
  readonly deltas: AsyncIterable<ConversationTextDeltaV1>;
  readonly completed: Promise<ConversationReceiptV1>;
}

export interface ModelGatewayPortV1 {
  completeStructured<T>(
    request: StructuredCompletionRequestV1,
    outputSchema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<StructuredCompletionResultV1<T>>;
  embed(request: EmbeddingRequestV1, signal?: AbortSignal): Promise<EmbeddingResultV1>;
  streamConversation(
    request: ConversationRequestV1,
    signal?: AbortSignal,
  ): ConversationStreamHandleV1;
}

export interface ModelGatewayModuleErrorContextV1 {
  readonly causalRunId: string;
  readonly requiredCapability: z.infer<
    typeof import("@riskflow/contracts/ports").ModuleCapabilityV1Schema
  >;
  readonly authorizationPolicyRef: z.infer<typeof VersionReferenceSchema>;
  readonly attempt?: number;
  readonly retryPolicyRef?: z.infer<typeof VersionReferenceSchema>;
  readonly idempotencyKey?: string;
  readonly priorCommandId?: string;
  readonly schemaVersion?: string;
  readonly diagnosticRef?: z.infer<typeof DiagnosticArtifactRefV1Schema>;
}

export class ModelGatewayError extends Error implements ModelGatewayErrorV1 {
  readonly schemaVersion: "1";
  readonly code: ModelGatewayErrorV1["code"];
  readonly category: ModelGatewayErrorV1["category"];
  readonly retryable: boolean;
  readonly stage: string;
  readonly occurredAt: string;
  readonly invocationId: string;
  readonly modelDeploymentRef: ModelGatewayErrorV1["modelDeploymentRef"];
  readonly rawResponseRef: ModelGatewayErrorV1["rawResponseRef"];
  readonly diagnosticRef: ModelGatewayErrorV1["diagnosticRef"];
  readonly counts: ModelGatewayErrorV1["counts"];
  readonly idempotencyKey: string | undefined;
  readonly priorCommandId: string | undefined;

  constructor(details: ModelGatewayErrorV1) {
    super(details.code);
    Object.defineProperty(this, "name", { value: "ModelGatewayError", configurable: true });
    this.schemaVersion = details.schemaVersion;
    this.code = details.code;
    this.category = details.category;
    this.retryable = details.retryable;
    this.stage = details.stage;
    this.occurredAt = details.occurredAt;
    this.invocationId = details.invocationId;
    this.modelDeploymentRef = details.modelDeploymentRef;
    this.rawResponseRef = details.rawResponseRef;
    this.diagnosticRef = details.diagnosticRef;
    this.counts = details.counts;
    this.idempotencyKey = details.idempotencyKey;
    this.priorCommandId = details.priorCommandId;
  }
}

export const asModelGatewayError = (error: unknown): ModelGatewayError => {
  if (error instanceof ModelGatewayError) return error;
  const parsed = ModelGatewayErrorV1Schema.safeParse(error);
  if (parsed.success) return new ModelGatewayError(parsed.data);
  throw error;
};

export const mapModelGatewayErrorToModuleError = (
  error: ModelGatewayErrorV1,
  context: ModelGatewayModuleErrorContextV1,
): ModuleErrorV1 => {
  const value = ModelGatewayErrorV1Schema.parse(error);
  const common = {
    stageCode: value.stage,
    occurredAt: value.occurredAt,
    causalRunId: context.causalRunId,
  };
  if (value.code === "MODEL_AUTHORIZATION_DENIED") {
    return {
      ...common,
      code: "AUTHORIZATION_DENIED",
      category: "authorization",
      retryable: false,
      requiredCapability: context.requiredCapability,
      authorizationPolicyRef: context.authorizationPolicyRef,
    };
  }
  if (value.code === "MODEL_IDEMPOTENCY_CONFLICT") {
    const idempotencyKey = value.idempotencyKey ?? context.idempotencyKey;
    const priorCommandId = value.priorCommandId ?? context.priorCommandId;
    if (idempotencyKey !== undefined && priorCommandId !== undefined) {
      return {
        ...common,
        code: "IDEMPOTENCY_CONFLICT",
        category: "idempotency",
        retryable: false,
        idempotencyKey,
        priorCommandId,
      };
    }
  }
  if (value.retryable) {
    const diagnosticRef = value.diagnosticRef ?? value.rawResponseRef ?? context.diagnosticRef;
    if (diagnosticRef !== undefined) {
      return {
        ...common,
        code: "TRANSIENT_FAILURE",
        category: "technical",
        retryable: true,
        attempt: context.attempt ?? 1,
        retryPolicyRef: context.retryPolicyRef ?? context.authorizationPolicyRef,
        diagnosticRef,
      };
    }
  }
  if (value.code === "MODEL_INPUT_INVALID" && context.schemaVersion !== undefined) {
    return {
      ...common,
      code: "UNSUPPORTED_CONTRACT",
      category: "technical",
      retryable: false,
      schemaVersion: context.schemaVersion,
    };
  }
  const diagnosticRef = value.diagnosticRef ?? value.rawResponseRef ?? context.diagnosticRef;
  if (diagnosticRef === undefined) {
    throw new Error("model failure requires a durable diagnostic reference");
  }
  return {
    ...common,
    code: "TERMINAL_FAILURE",
    category: "technical",
    retryable: false,
    diagnosticRef,
  };
};

export {
  ConversationReceiptV1Schema,
  ConversationRequestV1Schema,
  ConversationTextDeltaV1Schema,
  EmbeddingRequestV1Schema,
  EmbeddingResultV1Schema,
  ModelGatewayErrorV1Schema,
  StructuredCompletionRequestV1Schema,
  structuredCompletionResultSchema,
};
