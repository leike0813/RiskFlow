import { describe, expect, it } from "vitest";

import {
  KnowledgeRevisionRefV1Schema,
  KnowledgeReleaseRefV1Schema,
  type KnowledgeRevisionRefV1,
  type KnowledgeReleaseRefV1,
} from "@riskflow/contracts/ports";
import { sha256CanonicalJson } from "../../src/persistence/index.js";
import {
  deriveKnowledgeRevisionStatus,
  KnowledgeLifecycleError,
  KnowledgeReleaseV1Schema,
  KnowledgeRevisionV1Schema,
  selectGovernedReleaseCandidates,
  validateApprovalProof,
  validateCandidateArtifactIdentity,
  validatePublicationTimeline,
  validateRevisionBase,
} from "../../src/knowledge-governance/index.js";

const projectId = "project-1";
const recordedAt = "2030-01-01T00:00:00.000Z";
const authorizationContextRef = {
  kind: "authorization-context" as const,
  reference: { entityId: "authorization-1", versionId: "1" },
};

const revisionRef = (entityId: string): KnowledgeRevisionRefV1 =>
  KnowledgeRevisionRefV1Schema.parse({
    kind: "knowledge-revision",
    reference: { entityId, versionId: "1" },
  });

const releaseRef = (entityId: string): KnowledgeReleaseRefV1 =>
  KnowledgeReleaseRefV1Schema.parse({
    kind: "knowledge-release",
    reference: { entityId, versionId: "1" },
  });

const revisionFor = (
  definitionType = "process-model" as const,
  entityId = "revision-1",
  artifactId = `artifact-${entityId}`,
) =>
  KnowledgeRevisionV1Schema.parse({
    revisionRef: revisionRef(entityId),
    definitionRef: {
      kind: "knowledge-definition",
      reference: { entityId: `definition-${definitionType}`, versionId: "1" },
    },
    projectId,
    definitionType,
    candidateArtifactRef: {
      kind: "content-artifact",
      reference: { entityId: artifactId, versionId: "sha256:artifact" },
    },
    evidenceReferences: [
      {
        locator: { sourceSegmentId: "source-1" },
        sourceVersion: { entityId: "source-version-1", versionId: "1" },
      },
    ],
    artifactIdentityDigest: sha256CanonicalJson({ artifactId }),
    commandId: `submit-${entityId}`,
    actorId: "actor-1",
    authorizationContextRef,
    occurredAt: recordedAt,
    recordedAt,
  });

const releaseFor = (
  revision: ReturnType<typeof revisionFor>,
  entityId: string,
  effectiveFrom: string,
) =>
  KnowledgeReleaseV1Schema.parse({
    releaseRef: releaseRef(entityId),
    definitionRef: revision.definitionRef,
    projectId: revision.projectId,
    definitionType: revision.definitionType,
    revisionRef: revision.revisionRef,
    reviewTaskRef: {
      kind: "review-task",
      reference: { entityId: `task-${entityId}`, versionId: "1" },
      reviewType: "knowledge-revision",
      targetRef: revision.revisionRef,
      waitingRunRef: {
        kind: "workflow-run",
        reference: { entityId: `run-${entityId}`, versionId: "1" },
      },
    },
    reviewDecisionRef: {
      kind: "review-decision",
      reference: { entityId: `decision-${entityId}`, versionId: "1" },
    },
    effectiveFrom,
    commandId: `publish-${entityId}`,
    actorId: "actor-1",
    authorizationContextRef,
    occurredAt: effectiveFrom,
    recordedAt: effectiveFrom,
  });

const expectFailure = (action: () => void, code: string, reasonCode: string) => {
  try {
    action();
    throw new Error("expected lifecycle failure");
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeLifecycleError);
    expect((error as KnowledgeLifecycleError).failure).toMatchObject({ code, reasonCode });
  }
};

describe("knowledge-governance core", () => {
  it("enforces first submission and exact published base", () => {
    const revision = revisionFor();
    const base = releaseFor(revision, "release-1", recordedAt);
    expect(() =>
      validateRevisionBase({
        projectId,
        definitionType: revision.definitionType,
        hasDefinition: false,
      }),
    ).not.toThrow();
    expectFailure(
      () =>
        validateRevisionBase({
          projectId,
          definitionType: revision.definitionType,
          hasDefinition: true,
        }),
      "STALE_VERSION",
      "base-release-required",
    );
    expect(() =>
      validateRevisionBase({
        projectId,
        definitionType: revision.definitionType,
        hasDefinition: true,
        baseReleaseRef: base.releaseRef,
        baseRevisionRef: base.revisionRef,
        baseRelease: base,
        latestRelease: base,
      }),
    ).not.toThrow();
    expectFailure(
      () =>
        validateRevisionBase({
          projectId,
          definitionType: revision.definitionType,
          hasDefinition: true,
          baseReleaseRef: releaseRef("other-release"),
          baseRevisionRef: base.revisionRef,
          baseRelease: base,
          latestRelease: base,
        }),
      "STALE_VERSION",
      "base-release-mismatch",
    );
    expectFailure(
      () =>
        validateRevisionBase({
          projectId,
          definitionType: revision.definitionType,
          hasDefinition: true,
          baseReleaseRef: base.releaseRef,
          baseRevisionRef: base.revisionRef,
          baseRelease: base,
        }),
      "STALE_VERSION",
      "base-release-not-current",
    );
    expectFailure(
      () =>
        validateRevisionBase({
          projectId,
          definitionType: revision.definitionType,
          hasDefinition: true,
          baseReleaseRef: releaseRef("missing-release"),
          baseRevisionRef: revisionRef("missing-revision"),
        }),
      "ENTITY_NOT_FOUND",
      "base-release-not-found",
    );
    const newerRelease = releaseFor(revision, "release-2", "2030-01-02T00:00:00.000Z");
    expectFailure(
      () =>
        validateRevisionBase({
          projectId,
          definitionType: revision.definitionType,
          hasDefinition: true,
          baseReleaseRef: base.releaseRef,
          baseRevisionRef: base.revisionRef,
          baseRelease: base,
          latestRelease: newerRelease,
        }),
      "STALE_VERSION",
      "base-release-not-current",
    );
  });

  it("rejects candidate identity collisions and non-approved proof", () => {
    const revision = revisionFor();
    expectFailure(
      () =>
        validateCandidateArtifactIdentity({
          candidateArtifactRef: revision.candidateArtifactRef,
          existingRevision: revision,
        }),
      "BUSINESS_BLOCKED",
      "candidate-artifact-already-registered",
    );
    const reviewTaskRef = {
      kind: "review-task" as const,
      reference: { entityId: "task-1", versionId: "1" },
      reviewType: "knowledge-revision" as const,
      targetRef: revision.revisionRef,
      waitingRunRef: {
        kind: "workflow-run" as const,
        reference: { entityId: "run-1", versionId: "1" },
      },
    };
    const decisionRef = {
      kind: "review-decision" as const,
      reference: { entityId: "decision-1", versionId: "1" },
    };
    expect(() =>
      validateApprovalProof({
        projectId,
        revisionRef: revision.revisionRef,
        reviewDecisionRef: decisionRef,
        proof: {
          kind: "approved",
          revisionRef: revision.revisionRef,
          reviewTaskRef,
          reviewDecisionRef: decisionRef,
        },
      }),
    ).not.toThrow();
    expectFailure(
      () =>
        validateApprovalProof({
          projectId,
          revisionRef: revision.revisionRef,
          reviewDecisionRef: decisionRef,
          proof: { kind: "not-approved" },
        }),
      "BUSINESS_BLOCKED",
      "review-approval-required",
    );
  });

  it("keeps release timelines and historical resolution deterministic", () => {
    const firstRevision = revisionFor("process-model", "revision-1");
    const firstRelease = releaseFor(firstRevision, "release-1", recordedAt);
    const secondRevision = revisionFor("process-model", "revision-2");
    const futureRelease = releaseFor(secondRevision, "release-2", "2030-01-03T00:00:00.000Z");
    expectFailure(
      () =>
        validatePublicationTimeline({
          projectId,
          definitionType: "process-model",
          revisionRef: secondRevision.revisionRef,
          effectiveFrom: recordedAt,
          now: "2030-01-02T00:00:00.000Z",
          existingReleases: [firstRelease],
          currentRelease: firstRelease,
          expectedBaseReleaseRef: firstRelease.releaseRef,
        }),
      "STALE_VERSION",
      "release-effective-time-conflict",
    );
    expectFailure(
      () =>
        validatePublicationTimeline({
          projectId,
          definitionType: "process-model",
          revisionRef: revisionRef("revision-4"),
          effectiveFrom: "2030-01-02T00:00:00.000Z",
          now: "2030-01-01T00:00:00.000Z",
          existingReleases: [firstRelease, futureRelease],
          currentRelease: firstRelease,
          expectedBaseReleaseRef: firstRelease.releaseRef,
        }),
      "BUSINESS_BLOCKED",
      "future-release-overlap",
    );
    const otherRevision = revisionFor("risk-mechanism", "revision-3");
    const otherRelease = releaseFor(otherRevision, "release-3", recordedAt);
    const result = selectGovernedReleaseCandidates({
      projectId,
      requiredDefinitionTypes: ["process-model", "risk-mechanism"],
      requiredAt: "2030-01-02T00:00:00.000Z",
      asOfRecordedAt: "2030-01-02T00:00:00.000Z",
      candidates: [
        { release: firstRelease },
        { release: futureRelease },
        { release: otherRelease },
      ],
    });
    expect(result.releaseRefs.map((ref) => ref.reference.entityId)).toEqual([
      "release-1",
      "release-3",
    ]);
    expectFailure(
      () =>
        selectGovernedReleaseCandidates({
          projectId,
          requiredDefinitionTypes: ["process-model"],
          requiredAt: "2030-01-02T00:00:00.000Z",
          asOfRecordedAt: "2030-01-02T00:00:00.000Z",
          candidates: [
            {
              release: firstRelease,
              deactivatedAt: "2030-01-01T12:00:00.000Z",
              deactivatedRecordedAt: "2030-01-01T12:00:00.000Z",
            },
          ],
        }),
      "BUSINESS_BLOCKED",
      "required-release-unavailable",
    );
  });

  it("derives revision status only from review and release facts", () => {
    const revision = revisionFor();
    const release = releaseFor(revision, "release-1", recordedAt);
    expect(deriveKnowledgeRevisionStatus({ revision, releaseRefs: [] }).status).toBe("draft");
    expect(
      deriveKnowledgeRevisionStatus({ revision, releaseRefs: [release.releaseRef] }).status,
    ).toBe("published");
  });
});
