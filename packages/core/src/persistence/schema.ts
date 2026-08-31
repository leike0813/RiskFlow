import { z } from "zod";

import {
  AuthorizationContextRefV1Schema,
  ContractReferenceV1Schema,
  DiagnosticArtifactRefV1Schema,
  DomainEventRefV1Schema,
} from "@riskflow/contracts/ports";
import { DomainEventV1Schema } from "@riskflow/contracts/events";
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";

import { isJsonValue, type JsonObject, type JsonValue } from "./canonical-json.js";

const JsonValueSchema = z.custom<JsonValue>(isJsonValue, "value must be JSON serializable");

export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);
export type { JsonObject, JsonValue };

export const AtomicCommandV1Schema = z.strictObject({
  projectId: IdentifierSchema,
  commandKind: IdentifierSchema,
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  payload: JsonObjectSchema,
  actorRef: IdentifierSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  issuedAt: IsoDateTimeSchema.optional(),
  runId: IdentifierSchema.optional(),
  threadId: IdentifierSchema.optional(),
});
export type AtomicCommandV1 = z.infer<typeof AtomicCommandV1Schema>;

export const AuditAppendV1Schema = z.strictObject({
  auditEntryId: IdentifierSchema,
  projectId: IdentifierSchema,
  action: IdentifierSchema,
  targetRef: ContractReferenceV1Schema,
  actorRef: IdentifierSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  occurredAt: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
  version: VersionReferenceSchema,
  reasonRef: ContractReferenceV1Schema.optional(),
  commandId: IdentifierSchema.optional(),
  idempotencyKey: IdentifierSchema.optional(),
  runId: IdentifierSchema.optional(),
  threadId: IdentifierSchema.optional(),
});
export type AuditAppendV1 = z.infer<typeof AuditAppendV1Schema>;

export const AtomicCommitV1Schema = z.strictObject({
  resultRef: ContractReferenceV1Schema,
  audit: AuditAppendV1Schema,
  events: z.array(DomainEventV1Schema),
});
export type AtomicCommitV1 = z.infer<typeof AtomicCommitV1Schema>;

export const AtomicCommitReceiptV1Schema = z.strictObject({
  resultRef: ContractReferenceV1Schema,
  auditEntryId: IdentifierSchema,
  eventRefs: z.array(DomainEventRefV1Schema),
  replayed: z.boolean(),
});
export type AtomicCommitReceiptV1 = z.infer<typeof AtomicCommitReceiptV1Schema>;

export const OutboxDeliveryPolicyV1Schema = z
  .strictObject({
    policyRef: VersionReferenceSchema,
    batchSize: z.number().int().positive().max(1000),
    leaseDurationMs: z.number().int().positive(),
    baseDelayMs: z.number().int().positive(),
    maxDelayMs: z.number().int().positive(),
    maxAttempts: z.number().int().positive(),
  })
  .superRefine((policy, context) => {
    if (policy.maxDelayMs < policy.baseDelayMs) {
      context.addIssue({
        code: "custom",
        path: ["maxDelayMs"],
        message: "maxDelayMs must be at least baseDelayMs",
      });
    }
  });
export type OutboxDeliveryPolicyV1 = z.infer<typeof OutboxDeliveryPolicyV1Schema>;

export const OutboxEventStatusV1Schema = z.enum(["pending", "leased", "published", "exhausted"]);
export type OutboxEventStatusV1 = z.infer<typeof OutboxEventStatusV1Schema>;

export const OutboxClaimBatchRequestV1Schema = z.strictObject({
  policy: OutboxDeliveryPolicyV1Schema,
  leaseOwner: IdentifierSchema,
  now: IsoDateTimeSchema.optional(),
});
export type OutboxClaimBatchRequestV1 = z.infer<typeof OutboxClaimBatchRequestV1Schema>;

export const OutboxClaimedEventV1Schema = z.strictObject({
  eventId: IdentifierSchema,
  event: DomainEventV1Schema,
  leaseOwner: IdentifierSchema,
  leaseToken: IdentifierSchema,
  leaseUntil: IsoDateTimeSchema,
  attemptCount: z.number().int().positive(),
  policyRef: VersionReferenceSchema,
  payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type OutboxClaimedEventV1 = z.infer<typeof OutboxClaimedEventV1Schema>;

export const OutboxClaimBatchResultV1Schema = z.strictObject({
  events: z.array(OutboxClaimedEventV1Schema),
});
export type OutboxClaimBatchResultV1 = z.infer<typeof OutboxClaimBatchResultV1Schema>;

export const OutboxAcknowledgeV1Schema = z.strictObject({
  eventId: IdentifierSchema,
  leaseOwner: IdentifierSchema,
  leaseToken: IdentifierSchema,
  now: IsoDateTimeSchema.optional(),
});
export type OutboxAcknowledgeV1 = z.infer<typeof OutboxAcknowledgeV1Schema>;

export const OutboxFailureV1Schema = z.strictObject({
  eventId: IdentifierSchema,
  leaseOwner: IdentifierSchema,
  leaseToken: IdentifierSchema,
  policy: OutboxDeliveryPolicyV1Schema,
  errorCode: IdentifierSchema,
  diagnosticRef: DiagnosticArtifactRefV1Schema,
  now: IsoDateTimeSchema.optional(),
});
export type OutboxFailureV1 = z.infer<typeof OutboxFailureV1Schema>;

export const OutboxOperationResultV1Schema = z.strictObject({
  eventId: IdentifierSchema,
  status: OutboxEventStatusV1Schema,
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAt: IsoDateTimeSchema.optional(),
});
export type OutboxOperationResultV1 = z.infer<typeof OutboxOperationResultV1Schema>;

export const ConsumerReceiptStatusV1Schema = z.enum(["pending", "completed"]);
export type ConsumerReceiptStatusV1 = z.infer<typeof ConsumerReceiptStatusV1Schema>;

export const ConsumerHandlerResultV1Schema = z.strictObject({
  resultRef: ContractReferenceV1Schema,
});
export type ConsumerHandlerResultV1 = z.infer<typeof ConsumerHandlerResultV1Schema>;

export const ConsumerResultV1Schema = z.strictObject({
  resultRef: ContractReferenceV1Schema,
  replayed: z.boolean(),
});
export type ConsumerResultV1 = z.infer<typeof ConsumerResultV1Schema>;

export const PERSISTENCE_ERROR_CODE_VALUES = [
  "MIGRATION_INVALID",
  "MIGRATION_SEQUENCE_CONFLICT",
  "MIGRATION_FAILED",
  "CONNECTION_FAILED",
  "TRANSACTION_FAILED",
  "IDEMPOTENCY_CONFLICT",
  "EVENT_CONTRACT_INVALID",
  "OUTBOX_LEASE_LOST",
  "OUTBOX_DELIVERY_FAILED",
  "OUTBOX_EXHAUSTED",
  "CONSUMER_CONFLICT",
  "CHECKPOINTER_SETUP_REQUIRED",
  "CHECKPOINT_INCONSISTENT",
] as const;
export const PersistenceErrorCodeV1Schema = z.enum(PERSISTENCE_ERROR_CODE_VALUES);
export type PersistenceErrorCodeV1 = z.infer<typeof PersistenceErrorCodeV1Schema>;

export const PersistenceErrorV1Schema = z.strictObject({
  code: PersistenceErrorCodeV1Schema,
  retryable: z.boolean(),
  stage: IdentifierSchema,
  occurredAt: IsoDateTimeSchema,
  diagnosticRef: DiagnosticArtifactRefV1Schema,
  contextRefs: z.array(ContractReferenceV1Schema),
});
export type PersistenceErrorV1 = z.infer<typeof PersistenceErrorV1Schema>;

export const persistenceError = (
  code: PersistenceErrorCodeV1,
  stage: string,
  diagnosticRef: PersistenceErrorV1["diagnosticRef"],
  contextRefs: PersistenceErrorV1["contextRefs"] = [],
  retryable = false,
): PersistenceErrorV1 =>
  PersistenceErrorV1Schema.parse({
    code,
    retryable,
    stage,
    occurredAt: new Date().toISOString(),
    diagnosticRef,
    contextRefs,
  });
