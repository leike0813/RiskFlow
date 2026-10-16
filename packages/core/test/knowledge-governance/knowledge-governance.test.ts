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
  KnowledgeReleaseSchema,
  KnowledgeReleaseV2Schema,
  KnowledgeRevisionV1Schema,
  parseKnowledgeRelease,
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

/** D-13：同一人工发布事实的 V2 表达只把两列人工引用移入 `human-reviewed` 来源。 */
const humanV2For = (release: ReturnType<typeof releaseFor>) => {
  const { reviewTaskRef, reviewDecisionRef, ...fields } = release;
  return {
    ...fields,
    schemaVersion: "2" as const,
    publicationOrigin: { kind: "human-reviewed" as const, reviewTaskRef, reviewDecisionRef },
  };
};

const derivedReleaseFor = (
  definitionType: "retrieval-evidence-base" | "applicable-rule-set" | "process-model",
  parentReleaseRefs: readonly unknown[] = [releaseRef("parent-release-1")],
  contextRefKind:
    "identification-preparation-snapshot" | "assessment-preparation-snapshot" = definitionType ===
  "applicable-rule-set"
    ? "assessment-preparation-snapshot"
    : "identification-preparation-snapshot",
) => ({
  schemaVersion: "2" as const,
  releaseRef: releaseRef("derived-release-1"),
  definitionRef: {
    kind: "knowledge-definition" as const,
    reference: { entityId: `definition-${definitionType}`, versionId: "1" },
  },
  projectId,
  definitionType,
  revisionRef: revisionRef("derived-revision-1"),
  publicationOrigin: {
    kind: "derived-approved" as const,
    parentReleaseRefs,
    derivationPolicyRef: { entityId: "derivation-policy", versionId: "1" },
    contextRef: {
      kind: contextRefKind,
      reference: { entityId: "preparation-1", versionId: "1" },
    },
  },
  effectiveFrom: recordedAt,
  commandId: "publish-derived-1",
  actorId: "actor-1",
  authorizationContextRef,
  occurredAt: recordedAt,
  recordedAt,
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

  it("仍按原规则解析 V1 人工发布事实", () => {
    const release = releaseFor(revisionFor(), "release-1", recordedAt);
    expect(KnowledgeReleaseSchema.safeParse(release).success).toBe(true);
    expect(parseKnowledgeRelease(release)).toEqual(KnowledgeReleaseV1Schema.parse(release));
    // 发布来源联合不放松原有精确审查目标：审查任务必须指向本次修订。
    expect(
      KnowledgeReleaseSchema.safeParse({
        ...release,
        reviewTaskRef: { ...release.reviewTaskRef, targetRef: revisionRef("other-revision") },
      }).success,
    ).toBe(false);
  });

  it("V2 human-reviewed 保持精确审查目标规则", () => {
    const humanV2 = humanV2For(releaseFor(revisionFor(), "release-1", recordedAt));
    const parsed = parseKnowledgeRelease(humanV2);
    expect(KnowledgeReleaseV2Schema.safeParse(humanV2).success).toBe(true);
    expect("publicationOrigin" in parsed && parsed.publicationOrigin.kind).toBe("human-reviewed");
    expect(parsed).toEqual(KnowledgeReleaseV2Schema.parse(humanV2));
    const origin = humanV2.publicationOrigin;
    expect(
      KnowledgeReleaseSchema.safeParse({
        ...humanV2,
        publicationOrigin: {
          ...origin,
          reviewTaskRef: { ...origin.reviewTaskRef, targetRef: revisionRef("other-revision") },
        },
      }).success,
    ).toBe(false);
  });

  it("derived-approved 只接受两类派生定义并保留父发布、策略与上下文", () => {
    const preparationKinds = {
      "retrieval-evidence-base": "identification-preparation-snapshot",
      "applicable-rule-set": "assessment-preparation-snapshot",
    } as const;
    for (const definitionType of ["retrieval-evidence-base", "applicable-rule-set"] as const) {
      const parsed = KnowledgeReleaseSchema.parse(derivedReleaseFor(definitionType));
      expect("publicationOrigin" in parsed && parsed.publicationOrigin.kind).toBe(
        "derived-approved",
      );
      if (!("publicationOrigin" in parsed) || parsed.publicationOrigin.kind !== "derived-approved")
        continue;
      expect(parsed.publicationOrigin.parentReleaseRefs).toHaveLength(1);
      expect(parsed.publicationOrigin.derivationPolicyRef).toEqual({
        entityId: "derivation-policy",
        versionId: "1",
      });
      expect(parsed.publicationOrigin.contextRef).toEqual({
        kind: preparationKinds[definitionType],
        reference: { entityId: "preparation-1", versionId: "1" },
      });
    }
    // 派生类型必须匹配对应准备引用，跨准备上下文不可复用。
    expect(
      KnowledgeReleaseSchema.safeParse(
        derivedReleaseFor(
          "applicable-rule-set",
          [releaseRef("parent-release-1")],
          "identification-preparation-snapshot",
        ),
      ).success,
    ).toBe(false);
    const unsupported = KnowledgeReleaseSchema.safeParse(derivedReleaseFor("process-model"));
    expect(unsupported.success).toBe(false);
    if (!unsupported.success) {
      expect(unsupported.error.issues.some((issue) => issue.path[0] === "definitionType")).toBe(
        true,
      );
    }
    expect(
      KnowledgeReleaseSchema.safeParse(derivedReleaseFor("retrieval-evidence-base", [])).success,
    ).toBe(false);
  });
});
