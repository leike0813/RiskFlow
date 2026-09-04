import { z } from "zod";

import {
  AgentTaskRefV1Schema,
  AgentTaskResultRefV1Schema,
  AgentTaskTypeV1Schema,
  AgentTriggerModeV1Schema,
  AuthorizationContextV1Schema,
  ContractReferenceV1Schema,
  DiagnosticArtifactRefV1Schema,
  ModuleCapabilityV1Schema,
  SourceAccessGrantRefV1Schema,
  SpatialScopeRefV1Schema,
  WorkflowRunRefV1Schema,
  type AgentTaskRefV1,
  type AgentTaskTypeV1,
  type AuthorizationContextV1,
  type ContractReferenceV1,
} from "@riskflow/contracts/ports";
import {
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";

import { ArtifactRefV1Schema } from "../artifacts/schema.js";

const safeInteger = z.number().int().refine(Number.isSafeInteger, "must be a safe integer");
const nonNegativeInteger = safeInteger.nonnegative();
const positiveInteger = safeInteger.positive();
const refEquals = (
  left: { readonly entityId: string; readonly versionId: string },
  right: { readonly entityId: string; readonly versionId: string },
): boolean => left.entityId === right.entityId && left.versionId === right.versionId;

const refArray = z.array(VersionReferenceSchema);
export const AGENT_INTERNAL_STATUS_VALUES = [
  "pending",
  "running",
  "waiting-user-confirmation",
  "retryable-failure",
  "completed",
  "terminal-failure",
  "cancelled",
] as const;
export const AgentInternalStatusV1Schema = z.enum(AGENT_INTERNAL_STATUS_VALUES);
export type AgentInternalStatusV1 = z.infer<typeof AgentInternalStatusV1Schema>;

export const AGENT_ACTION_TYPE_VALUES = [
  "model-invocation",
  "domain-tool",
  "deterministic-validation",
  "command-proposal",
  "command-confirmation",
] as const;
export const AgentActionTypeV1Schema = z.enum(AGENT_ACTION_TYPE_VALUES);
export type AgentActionTypeV1 = z.infer<typeof AgentActionTypeV1Schema>;

export const AGENT_ACTION_STATUS_VALUES = [
  "reserved",
  "started",
  "completed",
  "failed",
  "uncertain",
] as const;
export const AgentActionStatusV1Schema = z.enum(AGENT_ACTION_STATUS_VALUES);
export type AgentActionStatusV1 = z.infer<typeof AgentActionStatusV1Schema>;

export const AGENT_VALIDATION_DISPOSITION_VALUES = ["accepted", "rejected"] as const;
export const AgentValidationDispositionV1Schema = z.enum(AGENT_VALIDATION_DISPOSITION_VALUES);
export type AgentValidationDispositionV1 = z.infer<typeof AgentValidationDispositionV1Schema>;

export const AGENT_REJECTION_CLASS_VALUES = ["repairable", "terminal"] as const;
export const AgentRejectionClassV1Schema = z.enum(AGENT_REJECTION_CLASS_VALUES);
export type AgentRejectionClassV1 = z.infer<typeof AgentRejectionClassV1Schema>;

export const AGENT_RESULT_FAMILY_VALUES = [
  "content-artifact",
  "knowledge-revision",
  "retrieval-artifact-set",
  "recommendation-candidate",
  "response-recommendation",
  "calibration-suggestion",
] as const;
export const AgentResultFamilyV1Schema = z.enum(AGENT_RESULT_FAMILY_VALUES);
export type AgentResultFamilyV1 = z.infer<typeof AgentResultFamilyV1Schema>;

export const AgentAuthorizationBoundaryV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  authorizationContextRef: z.strictObject({
    kind: z.literal("authorization-context"),
    reference: VersionReferenceSchema,
  }),
  projectId: IdentifierSchema,
  actorId: IdentifierSchema,
  grantedCapabilities: z.array(ModuleCapabilityV1Schema).min(1),
  spatialScopeRefs: z.array(SpatialScopeRefV1Schema),
  sourceAccessGrantRefs: z.array(SourceAccessGrantRefV1Schema),
  authorizationPolicyRef: VersionReferenceSchema,
  capturedAt: IsoDateTimeSchema,
});
export type AgentAuthorizationBoundaryV1 = z.infer<typeof AgentAuthorizationBoundaryV1Schema>;

export const AgentTaskEnvelopeV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    agentTaskRef: AgentTaskRefV1Schema,
    commandId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
    taskType: AgentTaskTypeV1Schema,
    triggerMode: AgentTriggerModeV1Schema,
    projectId: IdentifierSchema,
    actorId: IdentifierSchema,
    parentRunRef: WorkflowRunRefV1Schema,
    frozenInputRef: ContractReferenceV1Schema,
    modelDeploymentRef: VersionReferenceSchema,
    promptTemplateRef: VersionReferenceSchema,
    toolPolicyRef: VersionReferenceSchema,
    budgetPolicyRef: VersionReferenceSchema,
    incrementSchemaRef: VersionReferenceSchema,
    validationPolicyRef: VersionReferenceSchema,
    authorization: AuthorizationContextV1Schema,
    frozenAuthorization: AgentAuthorizationBoundaryV1Schema,
    createdAt: IsoDateTimeSchema,
  })
  .superRefine((envelope, context) => {
    const refFields = [
      ["modelDeploymentRef", envelope.modelDeploymentRef, envelope.agentTaskRef.modelDeploymentRef],
      ["promptTemplateRef", envelope.promptTemplateRef, envelope.agentTaskRef.promptTemplateRef],
      ["toolPolicyRef", envelope.toolPolicyRef, envelope.agentTaskRef.toolPolicyRef],
      ["budgetPolicyRef", envelope.budgetPolicyRef, envelope.agentTaskRef.budgetPolicyRef],
      ["incrementSchemaRef", envelope.incrementSchemaRef, envelope.agentTaskRef.incrementSchemaRef],
      [
        "validationPolicyRef",
        envelope.validationPolicyRef,
        envelope.agentTaskRef.validationPolicyRef,
      ],
    ] as const;
    for (const [field, value, taskValue] of refFields) {
      if (!refEquals(value, taskValue))
        context.addIssue({ code: "custom", path: [field], message: "task reference mismatch" });
    }
    if (envelope.taskType !== envelope.agentTaskRef.taskType)
      context.addIssue({ code: "custom", path: ["taskType"], message: "task type mismatch" });
    if (envelope.triggerMode !== envelope.agentTaskRef.triggerMode)
      context.addIssue({ code: "custom", path: ["triggerMode"], message: "trigger mode mismatch" });
    if (envelope.projectId !== envelope.authorization.projectId)
      context.addIssue({ code: "custom", path: ["projectId"], message: "project mismatch" });
    if (envelope.actorId !== envelope.authorization.actorId)
      context.addIssue({ code: "custom", path: ["actorId"], message: "actor mismatch" });
    if (
      envelope.frozenAuthorization.projectId !== envelope.projectId ||
      envelope.frozenAuthorization.actorId !== envelope.actorId ||
      !refEquals(
        envelope.frozenAuthorization.authorizationContextRef.reference,
        envelope.authorization.authorizationContextRef.reference,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["frozenAuthorization"],
        message: "frozen authorization mismatch",
      });
    }
    if (
      !envelope.frozenAuthorization.grantedCapabilities.every((capability) =>
        envelope.authorization.grantedCapabilities.includes(capability),
      ) ||
      !envelope.frozenAuthorization.spatialScopeRefs.every((scope) =>
        envelope.authorization.spatialScopeRefs.some((parent) =>
          refEquals(parent.reference, scope.reference),
        ),
      ) ||
      !envelope.frozenAuthorization.sourceAccessGrantRefs.every((grant) =>
        envelope.authorization.sourceAccessGrantRefs.some((parent) =>
          refEquals(parent.reference, grant.reference),
        ),
      ) ||
      !refEquals(
        envelope.frozenAuthorization.authorizationPolicyRef,
        envelope.authorization.authorizationPolicyRef,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["frozenAuthorization"],
        message: "authorization widens parent context",
      });
    }
  });
export type AgentTaskEnvelopeV1 = z.infer<typeof AgentTaskEnvelopeV1Schema>;

export const AgentBudgetUsageV1Schema = z.strictObject({
  modelInvocations: nonNegativeInteger,
  toolInvocations: nonNegativeInteger,
  inputTokens: nonNegativeInteger,
  outputTokens: nonNegativeInteger,
  contextTokens: nonNegativeInteger,
  inputBytes: nonNegativeInteger,
  outputBytes: nonNegativeInteger,
  candidates: nonNegativeInteger,
  objects: nonNegativeInteger,
  supplementarySearches: nonNegativeInteger,
  corrections: nonNegativeInteger,
  transientRetries: nonNegativeInteger,
});
export type AgentBudgetUsageV1 = z.infer<typeof AgentBudgetUsageV1Schema>;

export const AgentTaskBudgetPolicyV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  policyRef: VersionReferenceSchema,
  modelDeploymentRef: VersionReferenceSchema,
  promptTemplateRef: VersionReferenceSchema,
  toolPolicyRef: VersionReferenceSchema,
  maxModelInvocations: positiveInteger,
  maxToolInvocations: positiveInteger,
  maxContextTokens: positiveInteger,
  maxInputTokens: positiveInteger.optional(),
  maxOutputTokens: positiveInteger.optional(),
  maxInputBytes: positiveInteger,
  maxOutputBytes: positiveInteger,
  maxCandidates: positiveInteger,
  maxObjects: positiveInteger,
  maxSupplementarySearches: nonNegativeInteger,
  maxCorrections: nonNegativeInteger,
  maxTransientRetries: nonNegativeInteger,
  maxConcurrentActions: positiveInteger,
  maxWallClockMs: positiveInteger,
});
export type AgentTaskBudgetPolicyV1 = z.infer<typeof AgentTaskBudgetPolicyV1Schema>;

export const AgentBudgetLedgerV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  reserved: AgentBudgetUsageV1Schema,
  used: AgentBudgetUsageV1Schema,
  activeWallClockMs: nonNegativeInteger,
  currentConcurrency: nonNegativeInteger,
  ledgerVersion: positiveInteger,
  changedAt: IsoDateTimeSchema,
});
export type AgentBudgetLedgerV1 = z.infer<typeof AgentBudgetLedgerV1Schema>;

export const AgentBudgetReservationV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  reservationId: IdentifierSchema,
  actionId: IdentifierSchema,
  amount: AgentBudgetUsageV1Schema,
  concurrency: positiveInteger,
  reservedAt: IsoDateTimeSchema,
});
export type AgentBudgetReservationV1 = z.infer<typeof AgentBudgetReservationV1Schema>;

export const AgentTaskDefinitionMetadataV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  definitionRef: VersionReferenceSchema,
  taskType: AgentTaskTypeV1Schema,
  toolPolicyRef: VersionReferenceSchema,
  incrementSchemaRef: VersionReferenceSchema,
  validationPolicyRef: VersionReferenceSchema,
  supportedTriggerModes: z
    .array(AgentTriggerModeV1Schema)
    .min(1)
    .refine((modes) => new Set(modes).size === modes.length),
  allowedToolRefs: refArray,
  resultFamilies: z.array(AgentResultFamilyV1Schema).min(1),
});
export type AgentTaskDefinitionMetadataV1 = z.infer<typeof AgentTaskDefinitionMetadataV1Schema>;

export const AgentTaskActionV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    taskRef: AgentTaskRefV1Schema,
    actionId: IdentifierSchema,
    sequence: nonNegativeInteger,
    actionType: AgentActionTypeV1Schema,
    status: AgentActionStatusV1Schema,
    idempotencyKey: IdentifierSchema,
    intentArtifactRef: ArtifactRefV1Schema,
    resultRef: ContractReferenceV1Schema.optional(),
    resultArtifactRef: ArtifactRefV1Schema.optional(),
    reservation: AgentBudgetReservationV1Schema,
    usage: AgentBudgetUsageV1Schema,
    errorCode: IdentifierSchema.optional(),
    recordedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.optional(),
  })
  .superRefine((action, context) => {
    if (action.actionId !== action.reservation.actionId)
      context.addIssue({
        code: "custom",
        path: ["reservation", "actionId"],
        message: "reservation action does not match action",
      });
    if (
      action.status === "completed" &&
      action.resultRef === undefined &&
      action.resultArtifactRef === undefined
    )
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "completed action requires a result reference",
      });
    if (action.status === "uncertain" && action.errorCode !== "AGENT_ACTION_UNCERTAIN")
      context.addIssue({
        code: "custom",
        path: ["errorCode"],
        message: "uncertain action requires its error code",
      });
  });
export type AgentTaskActionV1 = z.infer<typeof AgentTaskActionV1Schema>;

export const AgentValidationItemV1Schema = z.strictObject({
  checkId: IdentifierSchema,
  disposition: AgentValidationDispositionV1Schema,
  rejectionClass: AgentRejectionClassV1Schema.optional(),
  reasonCode: IdentifierSchema,
  evidenceReferences: z.array(EvidenceReferenceSchema),
});
export type AgentValidationItemV1 = z.infer<typeof AgentValidationItemV1Schema>;

export const AgentValidationResultV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    items: z.array(AgentValidationItemV1Schema),
    disposition: AgentValidationDispositionV1Schema,
    rejectionClass: AgentRejectionClassV1Schema.optional(),
    validationArtifactRef: ArtifactRefV1Schema,
    validatedAt: IsoDateTimeSchema,
  })
  .superRefine((result, context) => {
    const rejected = result.items.filter((item) => item.disposition === "rejected");
    if (result.items.some((item) => item.disposition === "accepted" && item.rejectionClass))
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "accepted check cannot carry a rejection class",
      });
    if (
      result.items.some(
        (item) => item.disposition === "rejected" && item.rejectionClass === undefined,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "rejected check requires a rejection class",
      });
    if (result.disposition === "accepted" && rejected.length > 0)
      context.addIssue({
        code: "custom",
        path: ["disposition"],
        message: "accepted result has rejected checks",
      });
    if (result.disposition === "rejected" && rejected.length === 0)
      context.addIssue({
        code: "custom",
        path: ["disposition"],
        message: "rejected result has no rejected checks",
      });
    if (result.disposition === "rejected" && result.rejectionClass === undefined)
      context.addIssue({
        code: "custom",
        path: ["rejectionClass"],
        message: "rejected result lacks class",
      });
  });
export type AgentValidationResultV1 = z.infer<typeof AgentValidationResultV1Schema>;

export const AgentCandidateVersionV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    taskRef: AgentTaskRefV1Schema,
    candidateVersion: positiveInteger,
    parentCandidateVersion: nonNegativeInteger.optional(),
    candidateArtifactRef: ArtifactRefV1Schema,
    incrementArtifactRef: ArtifactRefV1Schema,
    validation: AgentValidationResultV1Schema.optional(),
    resultRef: AgentTaskResultRefV1Schema.optional(),
    disposition: z.enum(["pending", "accepted", "rejected", "completed"]),
    rejectionClass: AgentRejectionClassV1Schema.optional(),
    createdAt: IsoDateTimeSchema,
  })
  .superRefine((candidate, context) => {
    if (candidate.disposition === "rejected" && candidate.rejectionClass === undefined)
      context.addIssue({
        code: "custom",
        path: ["rejectionClass"],
        message: "rejected candidate requires a rejection class",
      });
    if (candidate.disposition !== "rejected" && candidate.rejectionClass !== undefined)
      context.addIssue({
        code: "custom",
        path: ["rejectionClass"],
        message: "accepted candidate cannot carry a rejection class",
      });
  });
export type AgentCandidateVersionV1 = z.infer<typeof AgentCandidateVersionV1Schema>;

export const AGENT_EXTERNAL_EFFECT_VALUES = [
  "none",
  "business-write",
  "external-system-write",
  "notification",
] as const;
export const AgentExternalEffectV1Schema = z.enum(AGENT_EXTERNAL_EFFECT_VALUES);
export type AgentExternalEffectV1 = z.infer<typeof AgentExternalEffectV1Schema>;

export const AgentCommandProposalV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  commandProposalRef: z.strictObject({
    kind: z.literal("command-proposal"),
    reference: VersionReferenceSchema,
  }),
  taskRef: AgentTaskRefV1Schema,
  projectId: IdentifierSchema,
  targetRef: ContractReferenceV1Schema,
  expectedTargetVersion: VersionReferenceSchema,
  commandArtifactRef: ArtifactRefV1Schema,
  commandIdempotencyKey: IdentifierSchema,
  expectedEffect: IdentifierSchema,
  externalEffects: z.array(AgentExternalEffectV1Schema),
  proposedAt: IsoDateTimeSchema,
});
export type AgentCommandProposalV1 = z.infer<typeof AgentCommandProposalV1Schema>;

export const AGENT_ERROR_CODE_VALUES = [
  "AGENT_INPUT_INVALID",
  "AGENT_AUTHORIZATION_DENIED",
  "AGENT_TASK_NOT_FOUND",
  "AGENT_STALE_VERSION",
  "AGENT_IDEMPOTENCY_CONFLICT",
  "AGENT_POLICY_NOT_FOUND",
  "AGENT_POLICY_MISMATCH",
  "AGENT_TOOL_NOT_ALLOWED",
  "AGENT_TOOL_LIMIT_EXCEEDED",
  "AGENT_BUDGET_EXHAUSTED",
  "AGENT_CONTEXT_LIMIT_EXCEEDED",
  "AGENT_CANDIDATE_LIMIT_EXCEEDED",
  "AGENT_CONCURRENCY_LIMIT_EXCEEDED",
  "AGENT_WALL_CLOCK_EXCEEDED",
  "AGENT_MODEL_FAILURE",
  "AGENT_TOOL_FAILURE",
  "AGENT_VALIDATION_REJECTED",
  "AGENT_CONFIRMATION_REQUIRED",
  "AGENT_CONFIRMATION_STALE",
  "AGENT_ACTION_UNCERTAIN",
  "AGENT_ARTIFACT_FAILURE",
  "AGENT_PERSISTENCE_FAILURE",
  "AGENT_CANCELLED",
  "AGENT_UNSUPPORTED_VERSION",
] as const;
export const AgentErrorCodeV1Schema = z.enum(AGENT_ERROR_CODE_VALUES);
export type AgentErrorCodeV1 = z.infer<typeof AgentErrorCodeV1Schema>;

export const AgentErrorCategoryV1Schema = z.enum([
  "input",
  "authorization",
  "not-found",
  "concurrency",
  "idempotency",
  "policy",
  "tool",
  "budget",
  "model",
  "validation",
  "confirmation",
  "action",
  "artifact",
  "persistence",
  "cancelled",
  "version",
]);
export type AgentErrorCategoryV1 = z.infer<typeof AgentErrorCategoryV1Schema>;

export const AgentStructuredErrorV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  code: AgentErrorCodeV1Schema,
  category: AgentErrorCategoryV1Schema,
  retryable: z.boolean(),
  stage: IdentifierSchema,
  occurredAt: IsoDateTimeSchema,
  taskRef: AgentTaskRefV1Schema.optional(),
  actionId: IdentifierSchema.optional(),
  attempt: positiveInteger.optional(),
  currentTaskVersion: positiveInteger.optional(),
  idempotencyKey: IdentifierSchema.optional(),
  priorCommandId: IdentifierSchema.optional(),
  reasonCode: IdentifierSchema.optional(),
  diagnosticRef: DiagnosticArtifactRefV1Schema.optional(),
});
export type AgentStructuredErrorV1 = z.infer<typeof AgentStructuredErrorV1Schema>;

export const emptyAgentBudgetUsage = (): AgentBudgetUsageV1 => ({
  modelInvocations: 0,
  toolInvocations: 0,
  inputTokens: 0,
  outputTokens: 0,
  contextTokens: 0,
  inputBytes: 0,
  outputBytes: 0,
  candidates: 0,
  objects: 0,
  supplementarySearches: 0,
  corrections: 0,
  transientRetries: 0,
});

export const agentAuthorizationBoundaryFromContext = (
  authorization: AuthorizationContextV1,
  capturedAt: string,
): AgentAuthorizationBoundaryV1 =>
  AgentAuthorizationBoundaryV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: authorization.authorizationContextRef,
    projectId: authorization.projectId,
    actorId: authorization.actorId,
    grantedCapabilities: authorization.grantedCapabilities,
    spatialScopeRefs: authorization.spatialScopeRefs,
    sourceAccessGrantRefs: authorization.sourceAccessGrantRefs,
    authorizationPolicyRef: authorization.authorizationPolicyRef,
    capturedAt,
  });

export const agentTaskRefEquals = (left: AgentTaskRefV1, right: AgentTaskRefV1): boolean =>
  left.taskType === right.taskType &&
  left.triggerMode === right.triggerMode &&
  refEquals(left.reference, right.reference) &&
  refEquals(left.modelDeploymentRef, right.modelDeploymentRef) &&
  refEquals(left.promptTemplateRef, right.promptTemplateRef) &&
  refEquals(left.toolPolicyRef, right.toolPolicyRef) &&
  refEquals(left.budgetPolicyRef, right.budgetPolicyRef) &&
  refEquals(left.incrementSchemaRef, right.incrementSchemaRef) &&
  refEquals(left.validationPolicyRef, right.validationPolicyRef);

export const primaryResultFamilyForTask = (
  taskType: AgentTaskTypeV1,
  primaryRef: ContractReferenceV1,
): AgentResultFamilyV1 | undefined => {
  if (taskType === "data-cleaning" && primaryRef.kind === "content-artifact")
    return "content-artifact";
  if (taskType === "knowledge-authoring" && primaryRef.kind === "content-artifact")
    return "content-artifact";
  if (taskType === "knowledge-authoring" && primaryRef.kind === "knowledge-revision")
    return "knowledge-revision";
  if (taskType === "retrieval-review" && primaryRef.kind === "retrieval-artifact-set")
    return "retrieval-artifact-set";
  if (taskType === "response-recommendation" && primaryRef.kind === "recommendation-candidate")
    return "recommendation-candidate";
  if (taskType === "response-recommendation" && primaryRef.kind === "response-recommendation")
    return "response-recommendation";
  if (taskType === "calibration-suggestion" && primaryRef.kind === "calibration-suggestion")
    return primaryRef.kind;
  return undefined;
};
