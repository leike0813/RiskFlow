import { z } from "zod";

import {
  AuthorizationContextRefV1Schema,
  AuthorizationContextV1Schema,
  ContentArtifactRefV1Schema,
  ContractReferenceV1Schema,
  KnowledgeDefinitionTypeV1Schema,
  KnowledgeReleaseRefV1Schema,
  KnowledgeRevisionRefV1Schema,
  ReviewDecisionRefV1Schema,
  ReviewTaskRefV1Schema,
  WorkflowRunRefV1Schema,
  type KnowledgeDefinitionTypeV1,
} from "@riskflow/contracts/ports";
import {
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";

const versionedRef = <const T extends string>(kind: T) =>
  z.strictObject({ kind: z.literal(kind), reference: VersionReferenceSchema });

export const KnowledgeDefinitionRefV1Schema = versionedRef("knowledge-definition");
export type KnowledgeDefinitionRefV1 = z.infer<typeof KnowledgeDefinitionRefV1Schema>;

export const KNOWLEDGE_REVISION_STATUS_V1_VALUES = [
  "draft",
  "in-review",
  "approved",
  "rejected",
  "returned",
  "published",
] as const;
export const KnowledgeRevisionStatusV1Schema = z.enum(KNOWLEDGE_REVISION_STATUS_V1_VALUES);
export type KnowledgeRevisionStatusV1 = z.infer<typeof KnowledgeRevisionStatusV1Schema>;

const lifecycleTimes = {
  occurredAt: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
  persistedAt: IsoDateTimeSchema.optional(),
};

export const KnowledgeDefinitionV1Schema = z.strictObject({
  definitionRef: KnowledgeDefinitionRefV1Schema,
  projectId: IdentifierSchema,
  definitionType: KnowledgeDefinitionTypeV1Schema,
  createdBy: IdentifierSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  createdAt: IsoDateTimeSchema,
  ...lifecycleTimes,
});
export type KnowledgeDefinitionV1 = z.infer<typeof KnowledgeDefinitionV1Schema>;

export const KnowledgeRevisionV1Schema = z
  .strictObject({
    revisionRef: KnowledgeRevisionRefV1Schema,
    definitionRef: KnowledgeDefinitionRefV1Schema,
    projectId: IdentifierSchema,
    definitionType: KnowledgeDefinitionTypeV1Schema,
    candidateArtifactRef: ContentArtifactRefV1Schema,
    evidenceReferences: z.array(EvidenceReferenceSchema).min(1),
    baseReleaseRef: KnowledgeReleaseRefV1Schema.optional(),
    baseRevisionRef: KnowledgeRevisionRefV1Schema.optional(),
    artifactIdentityDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    commandId: IdentifierSchema,
    actorId: IdentifierSchema,
    authorizationContextRef: AuthorizationContextRefV1Schema,
    ...lifecycleTimes,
  })
  .superRefine((revision, context) => {
    const hasBaseRelease = revision.baseReleaseRef !== undefined;
    const hasBaseRevision = revision.baseRevisionRef !== undefined;
    if (hasBaseRelease !== hasBaseRevision) {
      context.addIssue({
        code: "custom",
        path: [hasBaseRelease ? "baseRevisionRef" : "baseReleaseRef"],
        message: "base release and base revision must be provided together",
      });
    }
  });
export type KnowledgeRevisionV1 = z.infer<typeof KnowledgeRevisionV1Schema>;

export const KnowledgeReviewLinkStateV1Schema = z.enum(["waiting", "linked"]);
export type KnowledgeReviewLinkStateV1 = z.infer<typeof KnowledgeReviewLinkStateV1Schema>;

export const KnowledgeReviewLinkV1Schema = z
  .strictObject({
    reviewAttemptId: IdentifierSchema,
    projectId: IdentifierSchema,
    revisionRef: KnowledgeRevisionRefV1Schema,
    reviewPolicyRef: VersionReferenceSchema,
    validationSnapshotRef: ContractReferenceV1Schema,
    evidenceSnapshotRef: ContractReferenceV1Schema,
    waitingRunRef: WorkflowRunRefV1Schema,
    reviewTaskRef: ReviewTaskRefV1Schema.optional(),
    reviewDecisionRef: ReviewDecisionRefV1Schema.optional(),
    state: KnowledgeReviewLinkStateV1Schema,
    requestedBy: IdentifierSchema,
    authorizationContextRef: AuthorizationContextRefV1Schema,
    requestedAt: IsoDateTimeSchema,
    ...lifecycleTimes,
  })
  .superRefine((link, context) => {
    if (link.reviewTaskRef !== undefined) {
      if (
        link.reviewTaskRef.reviewType !== "knowledge-revision" ||
        link.reviewTaskRef.targetRef.reference.entityId !== link.revisionRef.reference.entityId ||
        link.reviewTaskRef.targetRef.reference.versionId !== link.revisionRef.reference.versionId
      ) {
        context.addIssue({
          code: "custom",
          path: ["reviewTaskRef"],
          message: "review target mismatch",
        });
      }
      if (
        link.reviewTaskRef.waitingRunRef.reference.entityId !==
          link.waitingRunRef.reference.entityId ||
        link.reviewTaskRef.waitingRunRef.reference.versionId !==
          link.waitingRunRef.reference.versionId
      ) {
        context.addIssue({
          code: "custom",
          path: ["reviewTaskRef", "waitingRunRef"],
          message: "review waiting run mismatch",
        });
      }
    }
    if (link.reviewDecisionRef !== undefined && link.reviewTaskRef === undefined) {
      context.addIssue({
        code: "custom",
        path: ["reviewDecisionRef"],
        message: "review decision requires a review task",
      });
    }
    if (link.state === "waiting" && link.reviewTaskRef !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "linked task requires linked state",
      });
    }
    if (link.state === "linked" && link.reviewTaskRef === undefined) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "linked state requires review task",
      });
    }
  });
export type KnowledgeReviewLinkV1 = z.infer<typeof KnowledgeReviewLinkV1Schema>;

export const KnowledgeReleaseV1Schema = z
  .strictObject({
    releaseRef: KnowledgeReleaseRefV1Schema,
    definitionRef: KnowledgeDefinitionRefV1Schema,
    projectId: IdentifierSchema,
    definitionType: KnowledgeDefinitionTypeV1Schema,
    revisionRef: KnowledgeRevisionRefV1Schema,
    reviewTaskRef: ReviewTaskRefV1Schema,
    reviewDecisionRef: ReviewDecisionRefV1Schema,
    effectiveFrom: IsoDateTimeSchema,
    restoredFromReleaseRef: KnowledgeReleaseRefV1Schema.optional(),
    reasonCode: IdentifierSchema.optional(),
    commandId: IdentifierSchema,
    actorId: IdentifierSchema,
    authorizationContextRef: AuthorizationContextRefV1Schema,
    ...lifecycleTimes,
  })
  .superRefine((release, context) => {
    if (
      release.reviewTaskRef.reviewType !== "knowledge-revision" ||
      release.reviewTaskRef.targetRef.reference.entityId !==
        release.revisionRef.reference.entityId ||
      release.reviewTaskRef.targetRef.reference.versionId !==
        release.revisionRef.reference.versionId
    ) {
      context.addIssue({
        code: "custom",
        path: ["reviewTaskRef"],
        message: "release review target mismatch",
      });
    }
    if (release.restoredFromReleaseRef !== undefined && release.reasonCode === undefined) {
      context.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "rollback requires a reason",
      });
    }
  });
export type KnowledgeReleaseV1 = z.infer<typeof KnowledgeReleaseV1Schema>;

export const KnowledgeReleaseDecisionV1Schema = z.strictObject({
  decisionRef: versionedRef("knowledge-release-decision"),
  releaseRef: KnowledgeReleaseRefV1Schema,
  projectId: IdentifierSchema,
  decision: z.literal("deactivated"),
  reasonCode: IdentifierSchema,
  commandId: IdentifierSchema,
  actorId: IdentifierSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  ...lifecycleTimes,
});
export type KnowledgeReleaseDecisionV1 = z.infer<typeof KnowledgeReleaseDecisionV1Schema>;

export const KnowledgeImportReceiptV1Schema = z.strictObject({
  revisionRef: KnowledgeRevisionRefV1Schema,
  disposition: z.enum(["created", "replayed"]),
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
});
export type KnowledgeImportReceiptV1 = z.infer<typeof KnowledgeImportReceiptV1Schema>;

export const KnowledgeRevisionProjectionV1Schema = z.strictObject({
  revisionRef: KnowledgeRevisionRefV1Schema,
  projectId: IdentifierSchema,
  definitionType: KnowledgeDefinitionTypeV1Schema,
  status: KnowledgeRevisionStatusV1Schema,
  reviewTaskRef: ReviewTaskRefV1Schema.optional(),
  reviewDecisionRef: ReviewDecisionRefV1Schema.optional(),
  releaseRefs: z.array(KnowledgeReleaseRefV1Schema),
  recordedAt: IsoDateTimeSchema,
});
export type KnowledgeRevisionProjectionV1 = z.infer<typeof KnowledgeRevisionProjectionV1Schema>;

const uniqueDefinitionTypes = z
  .array(KnowledgeDefinitionTypeV1Schema)
  .min(1)
  .refine((values) => new Set(values).size === values.length);

export const ResolveGovernedReleasesRequestV1Schema = z.strictObject({
  projectId: IdentifierSchema,
  requiredDefinitionTypes: uniqueDefinitionTypes,
  requiredAt: IsoDateTimeSchema,
  asOfRecordedAt: IsoDateTimeSchema,
  authorization: AuthorizationContextV1Schema,
});
export type ResolveGovernedReleasesRequestV1 = z.infer<
  typeof ResolveGovernedReleasesRequestV1Schema
>;

export const GovernedReleaseCandidateV1Schema = z.strictObject({
  release: KnowledgeReleaseV1Schema,
  deactivatedAt: IsoDateTimeSchema.optional(),
  deactivatedRecordedAt: IsoDateTimeSchema.optional(),
});
export type GovernedReleaseCandidateV1 = z.infer<typeof GovernedReleaseCandidateV1Schema>;

export const ResolveGovernedReleasesResultV1Schema = z.strictObject({
  releaseRefs: z.array(KnowledgeReleaseRefV1Schema),
});
export type ResolveGovernedReleasesResultV1 = z.infer<typeof ResolveGovernedReleasesResultV1Schema>;

export { KnowledgeDefinitionTypeV1Schema };
export type { KnowledgeDefinitionTypeV1 };
