import {
  KnowledgeRevisionRefV1Schema,
  KnowledgeReleaseRefV1Schema,
  type KnowledgeDefinitionTypeV1,
  type KnowledgeRevisionRefV1,
  type KnowledgeReleaseRefV1,
} from "@riskflow/contracts/ports";
import {
  ContractReferenceV1Schema,
  type ContractReferenceV1,
  type ReviewDecisionRefV1,
  type ReviewTaskRefV1,
} from "@riskflow/contracts/ports";
import { IsoDateTimeSchema } from "@riskflow/contracts/common";

import {
  KnowledgeDefinitionV1Schema,
  KnowledgeReleaseDecisionV1Schema,
  KnowledgeReleaseV1Schema,
  KnowledgeRevisionProjectionV1Schema,
  KnowledgeRevisionStatusV1Schema,
  KnowledgeRevisionV1Schema,
  ResolveGovernedReleasesResultV1Schema,
  type GovernedReleaseCandidateV1,
  type KnowledgeDefinitionV1,
  type KnowledgeReleaseDecisionV1,
  type KnowledgeReleaseV1,
  type KnowledgeRevisionProjectionV1,
  type KnowledgeRevisionStatusV1,
  type KnowledgeRevisionV1,
  type KnowledgeReviewLinkV1,
  type ResolveGovernedReleasesResultV1,
} from "./schema.js";

export type KnowledgeLifecycleErrorCodeV1 =
  | "AUTHORIZATION_DENIED"
  | "ENTITY_NOT_FOUND"
  | "STALE_VERSION"
  | "BUSINESS_BLOCKED"
  | "IDEMPOTENCY_CONFLICT";

export interface KnowledgeLifecycleFailureV1 {
  readonly code: KnowledgeLifecycleErrorCodeV1;
  readonly reasonCode: string;
  readonly targetRef: ContractReferenceV1;
  readonly currentRef?: ContractReferenceV1;
}

export class KnowledgeLifecycleError extends Error {
  readonly failure: KnowledgeLifecycleFailureV1;

  constructor(failure: KnowledgeLifecycleFailureV1) {
    super(failure.code);
    this.name = "KnowledgeLifecycleError";
    this.failure = failure;
  }
}

const referenceKey = (value: { reference: { entityId: string; versionId: string } }): string =>
  `${value.reference.entityId}\u0000${value.reference.versionId}`;

export const versionedReferenceEquals = (
  left: { reference: { entityId: string; versionId: string } },
  right: { reference: { entityId: string; versionId: string } },
): boolean => referenceKey(left) === referenceKey(right);

export const definitionIdentityEquals = (
  left: Pick<KnowledgeDefinitionV1, "projectId" | "definitionType">,
  right: Pick<KnowledgeDefinitionV1, "projectId" | "definitionType">,
): boolean => left.projectId === right.projectId && left.definitionType === right.definitionType;

const refAsContract = (value: {
  readonly kind: string;
  readonly reference: { readonly entityId: string; readonly versionId: string };
}): ContractReferenceV1 => ContractReferenceV1Schema.parse(value);

const revisionTarget = (revisionRef: KnowledgeRevisionRefV1): ContractReferenceV1 =>
  refAsContract(revisionRef);

const releaseTarget = (releaseRef: KnowledgeReleaseRefV1): ContractReferenceV1 =>
  refAsContract(releaseRef);

const fail = (
  code: KnowledgeLifecycleErrorCodeV1,
  reasonCode: string,
  targetRef: ContractReferenceV1,
  currentRef?: ContractReferenceV1,
): never => {
  throw new KnowledgeLifecycleError({
    code,
    reasonCode,
    targetRef,
    ...(currentRef === undefined ? {} : { currentRef }),
  });
};

const parseDate = (value: string): number => {
  const parsed = IsoDateTimeSchema.parse(value);
  const time = Date.parse(parsed);
  if (!Number.isFinite(time)) throw new TypeError("invalid lifecycle date");
  return time;
};

export const validateRevisionBase = (input: {
  readonly projectId: string;
  readonly definitionType: KnowledgeDefinitionTypeV1;
  readonly hasDefinition: boolean;
  readonly baseReleaseRef?: KnowledgeReleaseRefV1 | undefined;
  readonly baseRevisionRef?: KnowledgeRevisionRefV1 | undefined;
  readonly baseRelease?: KnowledgeReleaseV1 | undefined;
  readonly currentRelease?: KnowledgeReleaseV1 | undefined;
}): void => {
  const missingTarget = KnowledgeRevisionRefV1Schema.parse({
    kind: "knowledge-revision",
    reference: { entityId: `definition:${input.definitionType}`, versionId: "1" },
  });
  if (!input.hasDefinition) {
    if (input.baseReleaseRef !== undefined || input.baseRevisionRef !== undefined) {
      fail(
        "ENTITY_NOT_FOUND",
        "knowledge-definition-not-found",
        input.baseReleaseRef === undefined
          ? revisionTarget(missingTarget)
          : releaseTarget(input.baseReleaseRef),
      );
    }
    return;
  }
  const baseReleaseRef = input.baseReleaseRef;
  const baseRevisionRef = input.baseRevisionRef;
  if (baseReleaseRef === undefined || baseRevisionRef === undefined) {
    fail("STALE_VERSION", "base-release-required", revisionTarget(missingTarget));
  }
  const requiredBaseReleaseRef = baseReleaseRef as KnowledgeReleaseRefV1;
  const requiredBaseRevisionRef = baseRevisionRef as KnowledgeRevisionRefV1;
  const baseRelease = input.baseRelease;
  if (baseRelease === undefined) {
    fail("ENTITY_NOT_FOUND", "base-release-not-found", releaseTarget(requiredBaseReleaseRef));
  }
  const requiredBaseRelease = baseRelease as KnowledgeReleaseV1;
  if (
    requiredBaseRelease.projectId !== input.projectId ||
    requiredBaseRelease.definitionType !== input.definitionType ||
    !versionedReferenceEquals(requiredBaseRelease.releaseRef, requiredBaseReleaseRef) ||
    !versionedReferenceEquals(requiredBaseRelease.revisionRef, requiredBaseRevisionRef)
  ) {
    fail("STALE_VERSION", "base-release-mismatch", releaseTarget(requiredBaseReleaseRef));
  }
  if (
    input.currentRelease === undefined ||
    !versionedReferenceEquals(input.currentRelease.releaseRef, requiredBaseReleaseRef)
  ) {
    fail(
      "STALE_VERSION",
      "base-release-not-current",
      releaseTarget(requiredBaseReleaseRef),
      input.currentRelease === undefined
        ? undefined
        : releaseTarget(input.currentRelease.releaseRef),
    );
  }
};

export const validateCandidateArtifactIdentity = (input: {
  readonly candidateArtifactRef: KnowledgeRevisionV1["candidateArtifactRef"];
  readonly existingRevision?: KnowledgeRevisionV1;
}): void => {
  if (input.existingRevision === undefined) return;
  if (
    versionedReferenceEquals(
      input.existingRevision.candidateArtifactRef,
      input.candidateArtifactRef,
    )
  ) {
    fail(
      "BUSINESS_BLOCKED",
      "candidate-artifact-already-registered",
      refAsContract(input.candidateArtifactRef),
    );
  }
};

export const validateApprovalProof = (input: {
  readonly projectId: string;
  readonly revisionRef: KnowledgeRevisionRefV1;
  readonly reviewDecisionRef: ReviewDecisionRefV1;
  readonly proof:
    | {
        readonly kind: "approved";
        readonly revisionRef: KnowledgeRevisionRefV1;
        readonly reviewTaskRef: ReviewTaskRefV1;
        readonly reviewDecisionRef: ReviewDecisionRefV1;
      }
    | { readonly kind: "not-approved" };
}): void => {
  if (input.proof.kind !== "approved") {
    fail("BUSINESS_BLOCKED", "review-approval-required", revisionTarget(input.revisionRef));
  }
  const approvedProof = input.proof as Extract<typeof input.proof, { kind: "approved" }>;
  const reviewTaskRef = approvedProof.reviewTaskRef;
  const proofRevisionRef = approvedProof.revisionRef;
  const proofDecisionRef = approvedProof.reviewDecisionRef;
  if (
    !versionedReferenceEquals(proofRevisionRef, input.revisionRef) ||
    !versionedReferenceEquals(proofDecisionRef, input.reviewDecisionRef) ||
    reviewTaskRef.reviewType !== "knowledge-revision" ||
    !versionedReferenceEquals(reviewTaskRef.targetRef, input.revisionRef)
  ) {
    fail("STALE_VERSION", "review-approval-target-mismatch", revisionTarget(input.revisionRef));
  }
  if (input.projectId.trim().length === 0) {
    fail("AUTHORIZATION_DENIED", "project-required", revisionTarget(input.revisionRef));
  }
};

export const validatePublicationTimeline = (input: {
  readonly projectId: string;
  readonly definitionType: KnowledgeDefinitionTypeV1;
  readonly revisionRef: KnowledgeRevisionRefV1;
  readonly effectiveFrom: string;
  readonly now: string;
  readonly existingReleases: readonly KnowledgeReleaseV1[];
  readonly currentRelease?: KnowledgeReleaseV1 | undefined;
  readonly expectedBaseReleaseRef?: KnowledgeReleaseRefV1 | undefined;
  readonly allowPreviouslyPublishedRevision?: boolean | undefined;
}): void => {
  const effectiveAt = parseDate(input.effectiveFrom);
  const now = parseDate(input.now);
  const matching = input.existingReleases.filter(
    (release) =>
      release.projectId === input.projectId && release.definitionType === input.definitionType,
  );
  const duplicate = matching.find((release) => parseDate(release.effectiveFrom) === effectiveAt);
  if (duplicate !== undefined) {
    fail("STALE_VERSION", "release-effective-time-conflict", releaseTarget(duplicate.releaseRef));
  }
  if (input.expectedBaseReleaseRef !== undefined) {
    if (
      input.currentRelease === undefined ||
      !versionedReferenceEquals(input.currentRelease.releaseRef, input.expectedBaseReleaseRef)
    ) {
      fail(
        "STALE_VERSION",
        "publication-base-release-stale",
        releaseTarget(input.expectedBaseReleaseRef),
        input.currentRelease === undefined
          ? undefined
          : releaseTarget(input.currentRelease.releaseRef),
      );
    }
  } else if (input.currentRelease !== undefined) {
    fail(
      "STALE_VERSION",
      "publication-base-release-required",
      revisionTarget(input.revisionRef),
      releaseTarget(input.currentRelease.releaseRef),
    );
  }
  const future = matching
    .filter((release) => parseDate(release.effectiveFrom) > now)
    .sort((left, right) => parseDate(left.effectiveFrom) - parseDate(right.effectiveFrom));
  if (future.some((release) => effectiveAt < parseDate(release.effectiveFrom))) {
    const first = future[0];
    if (first !== undefined) {
      fail("BUSINESS_BLOCKED", "future-release-overlap", releaseTarget(first.releaseRef));
    }
  }
  if (
    !input.allowPreviouslyPublishedRevision &&
    matching.some((release) => versionedReferenceEquals(release.revisionRef, input.revisionRef))
  ) {
    fail("BUSINESS_BLOCKED", "revision-already-published", revisionTarget(input.revisionRef));
  }
};

export const deriveKnowledgeRevisionStatus = (input: {
  readonly revision: KnowledgeRevisionV1;
  readonly reviewLink?: KnowledgeReviewLinkV1;
  readonly decision?: "approve-publication" | "reject" | "return-for-revision";
  readonly releaseRefs?: readonly KnowledgeReleaseRefV1[];
}): KnowledgeRevisionProjectionV1 => {
  const releaseRefs = [...(input.releaseRefs ?? [])];
  const status: KnowledgeRevisionStatusV1 =
    releaseRefs.length > 0
      ? "published"
      : input.decision === "approve-publication"
        ? "approved"
        : input.decision === "reject"
          ? "rejected"
          : input.decision === "return-for-revision"
            ? "returned"
            : input.reviewLink !== undefined && input.reviewLink.reviewDecisionRef === undefined
              ? "in-review"
              : "draft";
  return KnowledgeRevisionProjectionV1Schema.parse({
    revisionRef: input.revision.revisionRef,
    projectId: input.revision.projectId,
    definitionType: input.revision.definitionType,
    status: KnowledgeRevisionStatusV1Schema.parse(status),
    ...(input.reviewLink?.reviewTaskRef === undefined
      ? {}
      : { reviewTaskRef: input.reviewLink.reviewTaskRef }),
    ...(input.reviewLink?.reviewDecisionRef === undefined
      ? {}
      : { reviewDecisionRef: input.reviewLink.reviewDecisionRef }),
    releaseRefs,
    recordedAt: input.revision.recordedAt,
  });
};

const releaseIsActiveAt = (
  candidate: GovernedReleaseCandidateV1,
  requiredAt: number,
  asOfRecordedAt: number,
): boolean => {
  const release = candidate.release;
  if (
    parseDate(release.effectiveFrom) > requiredAt ||
    parseDate(release.recordedAt) > asOfRecordedAt
  )
    return false;
  if (candidate.deactivatedRecordedAt === undefined) return true;
  if (parseDate(candidate.deactivatedRecordedAt) > asOfRecordedAt) return true;
  return candidate.deactivatedAt === undefined || parseDate(candidate.deactivatedAt) > requiredAt;
};

export const selectGovernedReleaseCandidates = (input: {
  readonly projectId: string;
  readonly requiredDefinitionTypes: readonly KnowledgeDefinitionTypeV1[];
  readonly requiredAt: string;
  readonly asOfRecordedAt: string;
  readonly candidates: readonly GovernedReleaseCandidateV1[];
}): ResolveGovernedReleasesResultV1 => {
  const requiredAt = parseDate(input.requiredAt);
  const asOfRecordedAt = parseDate(input.asOfRecordedAt);
  const selected: KnowledgeReleaseRefV1[] = [];
  for (const definitionType of [...input.requiredDefinitionTypes].sort()) {
    const eligible = input.candidates
      .filter(
        (candidate) =>
          candidate.release.projectId === input.projectId &&
          candidate.release.definitionType === definitionType &&
          releaseIsActiveAt(candidate, requiredAt, asOfRecordedAt),
      )
      .sort((left, right) => {
        const effective =
          parseDate(right.release.effectiveFrom) - parseDate(left.release.effectiveFrom);
        return effective !== 0
          ? effective
          : right.release.recordedAt.localeCompare(left.release.recordedAt);
      });
    const first = eligible[0];
    if (first === undefined) {
      const missing = KnowledgeReleaseRefV1Schema.parse({
        kind: "knowledge-release",
        reference: { entityId: `${input.projectId}:${definitionType}`, versionId: "missing" },
      });
      fail("BUSINESS_BLOCKED", "required-release-unavailable", releaseTarget(missing));
    }
    const selectedCandidate = first as GovernedReleaseCandidateV1;
    const second = eligible[1];
    if (
      second !== undefined &&
      parseDate(selectedCandidate.release.effectiveFrom) === parseDate(second.release.effectiveFrom)
    ) {
      fail(
        "BUSINESS_BLOCKED",
        "release-timeline-conflict",
        releaseTarget(selectedCandidate.release.releaseRef),
      );
    }
    selected.push(selectedCandidate.release.releaseRef);
  }
  return ResolveGovernedReleasesResultV1Schema.parse({ releaseRefs: selected });
};

export const parseKnowledgeDefinition = (value: unknown): KnowledgeDefinitionV1 =>
  KnowledgeDefinitionV1Schema.parse(value);
export const parseKnowledgeRevision = (value: unknown): KnowledgeRevisionV1 =>
  KnowledgeRevisionV1Schema.parse(value);
export const parseKnowledgeRelease = (value: unknown): KnowledgeReleaseV1 =>
  KnowledgeReleaseV1Schema.parse(value);
export const parseKnowledgeReleaseDecision = (value: unknown): KnowledgeReleaseDecisionV1 =>
  KnowledgeReleaseDecisionV1Schema.parse(value);
