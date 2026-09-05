import { describe, expect, it } from "vitest";

import {
  EngineeringContextSourceService,
  EngineeringContextRevisionCommandV1Schema,
  SourceSegmentV1Schema,
  SourceVersionV1Schema,
  makeSourceSegmentId,
} from "../../src/engineering-data/context-source/index.js";

const projectId = "project-1";
const scopeRef = {
  kind: "spatial-scope" as const,
  reference: { entityId: "scope-1", versionId: "1" },
};
const authorization = {
  schemaVersion: "1" as const,
  authorizationContextRef: {
    kind: "authorization-context" as const,
    reference: { entityId: "auth-1", versionId: "1" },
  },
  actorId: "account-1",
  projectId,
  grantedCapabilities: ["engineering-data.write" as const],
  spatialScopeRefs: [scopeRef],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
  decidedAt: "2030-01-01T00:00:00.000Z",
  invocation: { kind: "human" as const },
};

const projectCommand = (overrides: Record<string, unknown> = {}) =>
  EngineeringContextRevisionCommandV1Schema.parse({
    commandId: "command-1",
    idempotencyKey: "idempotency-1",
    projectId,
    actorId: "account-1",
    issuedAt: "2030-01-01T00:00:00.000Z",
    authorization,
    kind: "project",
    expectedVersion: "none",
    name: "示例工程",
    lifecycle: "preparing",
    applicabilityMetadata: {
      constructionMethod: "variable-diameter-shield",
      stratumCondition: "soft-soil",
      engineeringStage: "expansion-preparation",
    },
    effectivePeriod: { validFrom: "2030-01-01T00:00:00.000Z" },
    ...overrides,
  });

const spatialCommandBase = (overrides: Record<string, unknown> = {}) => {
  const base = { ...projectCommand(overrides) } as Record<string, unknown>;
  delete base.kind;
  delete base.expectedVersion;
  delete base.applicabilityMetadata;
  delete base.effectivePeriod;
  delete base.lifecycle;
  return base;
};

describe("engineering context and source registry core", () => {
  it("creates immutable project/spatial revisions and rejects a stale revision", async () => {
    const service = new EngineeringContextSourceService();
    const first = await service.reviseContext(projectCommand());
    expect(first.kind).toBe("succeeded");
    if (first.kind !== "succeeded" || first.result.kind !== "project-revision") return;

    const spatial = await service.reviseContext(
      EngineeringContextRevisionCommandV1Schema.parse({
        ...spatialCommandBase({ commandId: "spatial-1", idempotencyKey: "spatial-1" }),
        kind: "spatial",
        spatialScopeRef: scopeRef,
        projectRevisionRef: first.result.revision.projectRevisionRef,
        expectedVersion: "none",
        name: "区间一",
        worksiteLocation: "左线起点",
        applicabilityOverrides: { engineeringStage: "expansion-preparation" },
        status: "active",
        effectivePeriod: { validFrom: "2030-01-01T00:00:00.000Z" },
      }),
    );
    expect(spatial.kind).toBe("succeeded");
    if (spatial.kind !== "succeeded" || spatial.result.kind !== "spatial-revision") return;

    const spatialRevision = await service.reviseContext(
      EngineeringContextRevisionCommandV1Schema.parse({
        ...spatialCommandBase({ commandId: "spatial-2", idempotencyKey: "spatial-2" }),
        kind: "spatial",
        spatialScopeRef: scopeRef,
        projectRevisionRef: first.result.revision.projectRevisionRef,
        expectedVersion: spatial.result.revision.spatialScopeRef.reference,
        name: "区间一修订",
        worksiteLocation: "左线中点",
        applicabilityOverrides: { engineeringStage: "shield-expansion" },
        status: "active",
        effectivePeriod: { validFrom: "2030-01-01T00:00:00.000Z" },
      }),
    );
    expect(spatialRevision).toMatchObject({
      kind: "succeeded",
      result: {
        kind: "spatial-revision",
        revision: {
          spatialScopeRef: {
            kind: "spatial-scope",
            reference: { entityId: scopeRef.reference.entityId, versionId: "2" },
          },
          previousRevisionRef: spatial.result.revision.spatialScopeRef,
        },
      },
    });

    const stale = await service.reviseContext(
      projectCommand({
        commandId: "command-2",
        idempotencyKey: "idempotency-2",
        expectedVersion: { entityId: projectId, versionId: "99" },
      }),
    );
    expect(stale).toMatchObject({ kind: "failed", error: { code: "STALE_VERSION" } });
  });

  it("composes applicability metadata with field-level spatial provenance", async () => {
    const service = new EngineeringContextSourceService();
    const project = await service.reviseContext(projectCommand());
    if (project.kind !== "succeeded" || project.result.kind !== "project-revision")
      throw new Error("project setup failed");
    const spatial = await service.reviseContext(
      EngineeringContextRevisionCommandV1Schema.parse({
        ...spatialCommandBase({ commandId: "spatial-2", idempotencyKey: "spatial-2" }),
        kind: "spatial",
        spatialScopeRef: scopeRef,
        projectRevisionRef: project.result.revision.projectRevisionRef,
        expectedVersion: "none",
        name: "区间一",
        worksiteLocation: "左线起点",
        applicabilityOverrides: { engineeringStage: "shield-expansion" },
        status: "active",
        effectivePeriod: { validFrom: "2030-01-01T00:00:00.000Z" },
      }),
    );
    if (spatial.kind !== "succeeded" || spatial.result.kind !== "spatial-revision")
      throw new Error("spatial setup failed");
    const snapshot = await service.createApplicabilitySnapshot({
      commandId: "snapshot-1",
      idempotencyKey: "snapshot-1",
      projectId,
      actorId: "account-1",
      issuedAt: "2030-01-01T00:00:00.000Z",
      authorization,
      projectRevisionRef: project.result.revision.projectRevisionRef,
      spatialScopeRef: spatial.result.revision.spatialScopeRef,
      formedAt: "2030-01-01T00:00:00.000Z",
    });
    expect(snapshot).toMatchObject({
      kind: "succeeded",
      result: {
        kind: "applicability-snapshot",
        snapshot: {
          applicabilityMetadata: { engineeringStage: "shield-expansion" },
          provenance: {
            constructionMethod: { source: "project-revision" },
            engineeringStage: { source: "spatial-scope-revision" },
          },
        },
      },
    });
  });

  it("keeps source segment identities deterministic and locators typed", () => {
    const sourceId = "source_1";
    const segment = SourceSegmentV1Schema.parse({
      sourceSegmentId: makeSourceSegmentId(sourceId, "chapter_1", "segment_1"),
      chapterId: "chapter_1",
      segmentId: "segment_1",
      kind: "chapter",
      spatialScopeRefs: [scopeRef],
      locator: { kind: "document", pageNumber: 2, headingPath: ["风险识别"] },
    });
    expect(segment.sourceSegmentId).toBe("source_1-chapter_1-segment_1");
    expect(
      SourceSegmentV1Schema.safeParse({
        ...segment,
        sourceSegmentId: "source_1-chapter_1-other",
      }).success,
    ).toBe(false);
    expect(
      SourceVersionV1Schema.safeParse({
        sourceVersionRef: {
          kind: "source-version",
          reference: { entityId: sourceId, versionId: "1" },
        },
        projectId,
        sourceId,
        sourceItemId: "item-1",
        sourceDeliveryRef: {
          kind: "source-delivery",
          reference: { entityId: "delivery-1", versionId: "1" },
        },
        projectRevisionRef: {
          kind: "project-revision",
          reference: { entityId: projectId, versionId: "1" },
        },
        spatialScopeRefs: [scopeRef],
        sourceArtifactRef: {
          kind: "content-artifact",
          reference: { entityId: "content", versionId: "sha256:" + "a".repeat(64) },
        },
        metadataArtifactRef: {
          kind: "content-artifact",
          reference: { entityId: "metadata", versionId: "sha256:" + "b".repeat(64) },
        },
        accessStatus: "pending-access",
        applicabilityMetadataSnapshotRef: {
          kind: "applicability-metadata-snapshot",
          reference: { entityId: "snapshot-1", versionId: "1" },
        },
        recordedAt: "2030-01-01T00:00:00.000Z",
        audit: { actorId: "account-1", action: "source", recordedAt: "2030-01-01T00:00:00.000Z" },
      }).success,
    ).toBe(true);
  });
});
