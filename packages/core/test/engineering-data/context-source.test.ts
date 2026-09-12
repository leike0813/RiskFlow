import { describe, expect, it } from "vitest";

import {
  EngineeringContextSourceService,
  EngineeringContextRevisionCommandV1Schema,
  EngineeringDataReadBranchQueryV1Schema,
  EngineeringDataReadQueryRecordV1Schema,
  EngineeringDataReadResolutionResultV1Schema,
  EvidenceAccessItemV1Schema,
  EvidenceAccessReadResultV1Schema,
  ResolveEngineeringDataReadQueryV1Schema,
  ResolveSourceProcessingInputQueryV1Schema,
  ResolveSourceVersionForReadQueryV1Schema,
  SourceSegmentReadResultV1Schema,
  SourceSegmentSetV1Schema,
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

  it("resolves only a ready, current source version for authorized processing", async () => {
    const service = new EngineeringContextSourceService();
    const project = await service.reviseContext(projectCommand());
    if (project.kind !== "succeeded" || project.result.kind !== "project-revision")
      throw new Error("project setup failed");
    const sourceVersion = SourceVersionV1Schema.parse({
      sourceVersionRef: {
        kind: "source-version",
        reference: { entityId: "source_1", versionId: "v1" },
      },
      projectId,
      sourceId: "source_1",
      sourceItemId: "item_1",
      sourceDeliveryRef: {
        kind: "source-delivery",
        reference: { entityId: "delivery_1", versionId: "v1" },
      },
      projectRevisionRef: project.result.revision.projectRevisionRef,
      spatialScopeRefs: [scopeRef],
      sourceArtifactRef: {
        kind: "content-artifact",
        reference: { entityId: "content_1", versionId: `sha256:${"a".repeat(64)}` },
      },
      metadataArtifactRef: {
        kind: "content-artifact",
        reference: { entityId: "metadata_1", versionId: `sha256:${"b".repeat(64)}` },
      },
      sourceAccessGrantRef: {
        kind: "source-access-grant",
        reference: { entityId: "grant_1", versionId: "v1" },
      },
      accessStatus: "ready",
      applicabilityMetadataSnapshotRef: {
        kind: "applicability-metadata-snapshot",
        reference: { entityId: "snapshot_1", versionId: "v1" },
      },
      recordedAt: "2030-01-01T00:00:00.000Z",
      audit: { actorId: "account-1", action: "source", recordedAt: "2030-01-01T00:00:00.000Z" },
    });
    const seeded = new EngineeringContextSourceService({
      projects: [project.result.revision],
      sourceVersions: [sourceVersion],
    });
    const query = ResolveSourceProcessingInputQueryV1Schema.parse({
      queryId: "source-processing-input-1",
      projectId,
      actorId: "account-1",
      requestedAt: "2030-01-01T00:00:00.000Z",
      authorization: {
        ...authorization,
        grantedCapabilities: ["engineering-data.read" as const],
        sourceAccessGrantRefs: [sourceVersion.sourceAccessGrantRef!],
      },
      sourceVersionRef: sourceVersion.sourceVersionRef,
    });
    const resolved = await seeded.resolveSourceProcessingInput(query);
    expect(resolved).toMatchObject({
      kind: "succeeded",
      result: {
        kind: "source-processing-input",
        input: {
          sourceVersionRef: sourceVersion.sourceVersionRef,
          sourceArtifactRef: sourceVersion.sourceArtifactRef,
          metadataArtifactRef: sourceVersion.metadataArtifactRef,
        },
      },
    });
    expect(
      await seeded.resolveSourceProcessingInput({
        ...query,
        queryId: "source-processing-input-no-body",
        authorization: {
          ...query.authorization,
          grantedCapabilities: ["engineering-data.freeze" as const],
        },
      }),
    ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });

    const advanced = await service.reviseContext(
      projectCommand({
        commandId: "project-2",
        idempotencyKey: "project-2",
        expectedVersion: project.result.revision.projectRevisionRef.reference,
        name: "示例工程二期",
      }),
    );
    if (advanced.kind !== "succeeded" || advanced.result.kind !== "project-revision")
      throw new Error("project revision setup failed");
    const stale = new EngineeringContextSourceService({
      projects: [advanced.result.revision],
      sourceVersions: [sourceVersion],
    });
    expect(await stale.resolveSourceProcessingInput(query)).toMatchObject({
      kind: "failed",
      error: { code: "STALE_VERSION" },
    });
    expect(
      await stale.resolveSourceVersionForRead(
        ResolveSourceVersionForReadQueryV1Schema.parse({
          ...query,
          queryId: "source-version-read-historical",
        }),
      ),
    ).toMatchObject({
      kind: "succeeded",
      result: { kind: "source-processing-input" },
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

const recordedAt = "2030-01-01T00:00:00.000Z";
const sourceVersionRef = {
  kind: "source-version" as const,
  reference: { entityId: "source_1", versionId: "1" },
};
const sourceAccessGrantRef = {
  kind: "source-access-grant" as const,
  reference: { entityId: "grant_1", versionId: "1" },
};
const segmentSet = SourceSegmentSetV1Schema.parse({
  sourceSegmentSetRef: {
    kind: "source-segment-set",
    reference: { entityId: "set_1", versionId: "1" },
  },
  sourceVersionRef,
  sourceId: "source_1",
  segments: [
    {
      sourceSegmentId: makeSourceSegmentId("source_1", "chapter_1", "segment_1"),
      chapterId: "chapter_1",
      segmentId: "segment_1",
      kind: "chapter",
      spatialScopeRefs: [scopeRef],
      locator: { kind: "document", pageNumber: 2, headingPath: ["风险识别"] },
    },
  ],
  recordedAt,
  audit: {
    actorId: "account-1",
    action: "engineering-data.register-source-segments",
    recordedAt,
  },
});
const evidenceReference = {
  locator: { sourceSegmentId: "source_1-chapter_1-segment_1" },
  sourceVersion: { entityId: "source_1", versionId: "1" },
};

const readQueryRecord = (query: Record<string, unknown>) =>
  EngineeringDataReadQueryRecordV1Schema.parse({
    queryResultRef: {
      kind: "query-result",
      reference: { entityId: "source-segments-read-1", versionId: "1" },
    },
    projectId,
    query,
    requestedBy: "account-1",
    authorizationContextRef: {
      kind: "authorization-context",
      reference: { entityId: "auth-1", versionId: "1" },
    },
    recordedAt,
    audit: {
      actorId: "account-1",
      action: "engineering-data.source-segments-query",
      recordedAt,
    },
  });

describe("engineering data read query schemas", () => {
  it.each([
    [
      "source-segments",
      {
        kind: "source-segments",
        sourceSegmentSetRef: {
          kind: "source-segment-set",
          reference: { entityId: "set_1", versionId: "1" },
        },
      },
    ],
    [
      "evidence-access",
      {
        kind: "evidence-access",
        evidenceReferences: [evidenceReference],
        purposeCode: "engineering-data.evidence-access",
      },
    ],
  ])("closes the %s query record and rejects extra fields", (_branch, query) => {
    const record = readQueryRecord(query);
    expect(record.query.kind).toBe(query.kind);
    expect(EngineeringDataReadQueryRecordV1Schema.safeParse(record).success).toBe(true);
    expect(
      EngineeringDataReadQueryRecordV1Schema.safeParse({ ...record, body: "资料正文" }).success,
    ).toBe(false);
    expect(
      EngineeringDataReadQueryRecordV1Schema.safeParse({
        ...record,
        query: { ...query, sourceArtifactRef: segmentSet.sourceVersionRef },
      }).success,
    ).toBe(false);
  });

  it("requires a non-empty evidence list and a known read branch", () => {
    expect(
      EngineeringDataReadBranchQueryV1Schema.safeParse({
        kind: "evidence-access",
        evidenceReferences: [],
        purposeCode: "engineering-data.evidence-access",
      }).success,
    ).toBe(false);
    expect(
      EngineeringDataReadBranchQueryV1Schema.safeParse({
        kind: "monitoring-snapshot",
        monitoringSnapshotRef: {
          kind: "monitoring-snapshot",
          reference: { entityId: "snapshot-1", versionId: "1" },
        },
      }).success,
    ).toBe(false);
  });

  it("projects only localized C11 facts in safe read results", () => {
    const segmentResult = {
      kind: "source-segments",
      queryResultRef: readQueryRecord({
        kind: "source-segments",
        sourceSegmentSetRef: segmentSet.sourceSegmentSetRef,
      }).queryResultRef,
      segmentSet,
      sourceAccessGrantRef,
    };
    expect(SourceSegmentReadResultV1Schema.safeParse(segmentResult).success).toBe(true);
    expect(
      SourceSegmentReadResultV1Schema.safeParse({
        ...segmentResult,
        segmentSet: { ...segmentSet, sourceArtifactRef: segmentSet.sourceVersionRef },
      }).success,
    ).toBe(false);
    expect(
      SourceSegmentReadResultV1Schema.safeParse({
        ...segmentResult,
        content: "资料正文",
      }).success,
    ).toBe(false);

    const evidenceResult = {
      kind: "evidence-access",
      queryResultRef: {
        kind: "query-result",
        reference: { entityId: "evidence-access-read-1", versionId: "1" },
      },
      purposeCode: "engineering-data.evidence-access",
      items: [
        {
          evidenceReference,
          sourceVersionRef,
          sourceSegmentSetRef: segmentSet.sourceSegmentSetRef,
          sourceAccessGrantRef,
          segment: segmentSet.segments[0]!,
        },
      ],
    };
    expect(EvidenceAccessReadResultV1Schema.safeParse(evidenceResult).success).toBe(true);
    expect(
      EvidenceAccessReadResultV1Schema.safeParse({ ...evidenceResult, items: [] }).success,
    ).toBe(false);
    expect(
      EvidenceAccessItemV1Schema.safeParse({
        ...evidenceResult.items[0],
        sourceArtifactRef: segmentSet.sourceVersionRef,
      }).success,
    ).toBe(false);
    expect(
      EvidenceAccessReadResultV1Schema.safeParse({
        ...evidenceResult,
        items: [{ ...evidenceResult.items[0], jsonLd: { "@id": "risk-1" } }],
      }).success,
    ).toBe(false);
  });

  it("closes resolve input and the resolution result", () => {
    const resolveInput = {
      queryResultRef: {
        kind: "query-result",
        reference: { entityId: "source-segments-read-1", versionId: "1" },
      },
      invocationId: "source-segments-read-1",
      projectId,
      actorId: "account-1",
      requestedAt: recordedAt,
      authorization,
    };
    const parsed = ResolveEngineeringDataReadQueryV1Schema.safeParse(resolveInput);
    expect(parsed.success).toBe(true);
    expect(
      ResolveEngineeringDataReadQueryV1Schema.safeParse({ ...resolveInput, body: "资料正文" })
        .success,
    ).toBe(false);
    const withoutInvocation: Record<string, unknown> = { ...resolveInput };
    delete withoutInvocation.invocationId;
    expect(ResolveEngineeringDataReadQueryV1Schema.safeParse(withoutInvocation).success).toBe(
      false,
    );

    expect(
      EngineeringDataReadResolutionResultV1Schema.safeParse({
        kind: "succeeded",
        result: {
          kind: "evidence-access",
          queryResultRef: resolveInput.queryResultRef,
          purposeCode: "engineering-data.evidence-access",
          items: [
            {
              evidenceReference,
              sourceVersionRef,
              sourceSegmentSetRef: segmentSet.sourceSegmentSetRef,
              sourceAccessGrantRef,
              segment: segmentSet.segments[0]!,
            },
          ],
        },
      }).success,
    ).toBe(true);
    expect(
      EngineeringDataReadResolutionResultV1Schema.safeParse({
        kind: "failed",
        error: {
          code: "AUTHORIZATION_DENIED",
          category: "authorization",
          retryable: false,
          requiredCapability: "engineering-data.read",
          authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
          stageCode: "engineering-data.context-source",
          occurredAt: recordedAt,
          causalRunId: "source-segments-read-1",
        },
      }).success,
    ).toBe(true);
    expect(
      EngineeringDataReadResolutionResultV1Schema.safeParse({
        kind: "succeeded",
        result: { kind: "source-segments", segmentSet },
      }).success,
    ).toBe(false);
  });
});
