import { describe, expect, it } from "vitest";

import {
  IDENTIFICATION_KNOWLEDGE_DEFINITION_TYPES_V1,
  IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1,
  IdentificationKnowledgeValidationPolicyV1Schema,
  KnowledgeAuthoringCandidateV1Schema,
  KnowledgeAuthoringIncrementV1Schema,
  applyKnowledgeAuthoringIncrement,
  createKnowledgeAuthoringTaskDefinition,
  identificationBasisPublishedEvent,
  identificationKnowledgePackageDigest,
  validateIdentificationKnowledgePackage,
  type IdentificationEvidenceDecisionV1,
  type IdentificationKnowledgeValidationDependenciesV1,
  type KnowledgeAuthoringIncrementV1,
} from "@riskflow/core/identification-knowledge";

const PROJECT_ID = "project-1";
const OTHER_PROJECT_ID = "project-2";
const POLICY_REF = { entityId: "identification-knowledge-policy", versionId: "3" };
const PREPARATION_SNAPSHOT_REF = {
  kind: "identification-preparation-snapshot" as const,
  reference: { entityId: "identification-preparation-1", versionId: "1" },
};
const SEGMENT_EVIDENCE = {
  locator: { sourceSegmentId: "source-1-chapter-1-segment-1" },
  sourceVersion: { entityId: "source-version-1", versionId: "1" },
};
const GROUND_EVIDENCE = {
  locator: { sourceSegmentId: "source-1-chapter-1-segment-2" },
  sourceVersion: { entityId: "source-version-1", versionId: "1" },
};
const POLICY = IdentificationKnowledgeValidationPolicyV1Schema.parse({
  schemaVersion: "1",
  policyRef: POLICY_REF,
  criticalProcessKinds: ["扩径准备", "缩径转换"],
  coverage: [
    { processKind: "扩径准备", minimumMechanisms: 1, minimumEvidence: 1 },
    { processKind: "缩径转换", minimumMechanisms: 1, minimumEvidence: 1 },
  ],
  allowedStandardLevels: ["national", "industry"],
  allowedCaseConstructionMethods: ["盾构", "顶管"],
  maxEntriesPerPackage: 128,
  tools: {
    segmentSliceToolRef: { entityId: "knowledge-segment-slice", versionId: "1" },
    baselineKnowledgeToolRef: { entityId: "knowledge-baseline-read", versionId: "1" },
  },
  agent: {
    definitionRef: { entityId: "knowledge-authoring-definition", versionId: "1" },
    modelDeploymentRef: { entityId: "model", versionId: "1" },
    promptTemplateRef: { entityId: "prompt", versionId: "1" },
    toolPolicyRef: { entityId: "knowledge-authoring-tools", versionId: "1" },
    budgetPolicyRef: { entityId: "knowledge-authoring-budget", versionId: "1" },
    incrementSchemaRef: { entityId: "knowledge-authoring-increment", versionId: "1" },
    validationPolicyRef: { entityId: "knowledge-authoring-validation", versionId: "1" },
    budgetPolicy: {
      schemaVersion: "1",
      policyRef: { entityId: "knowledge-authoring-budget", versionId: "1" },
      modelDeploymentRef: { entityId: "model", versionId: "1" },
      promptTemplateRef: { entityId: "prompt", versionId: "1" },
      toolPolicyRef: { entityId: "knowledge-authoring-tools", versionId: "1" },
      maxModelInvocations: 8,
      maxToolInvocations: 16,
      maxContextTokens: 32_768,
      maxInputBytes: 262_144,
      maxOutputBytes: 262_144,
      maxCandidates: 4,
      maxObjects: 512,
      maxSupplementarySearches: 0,
      maxCorrections: 4,
      maxTransientRetries: 2,
      maxConcurrentActions: 1,
      maxWallClockMs: 600_000,
    },
  },
});

const eligibilityFor = (
  eligibleSegmentIds: readonly string[],
): IdentificationKnowledgeValidationDependenciesV1["checkEvidence"] => {
  const eligible = new Set(eligibleSegmentIds);
  return async ({ evidenceReferences }) =>
    evidenceReferences.map((reference): IdentificationEvidenceDecisionV1 => ({
      evidenceReference: reference,
      disposition: eligible.has(reference.locator.sourceSegmentId) ? "eligible" : "rejected",
      reasonCode: eligible.has(reference.locator.sourceSegmentId) ? "eligible" : "segment-excluded",
    }));
};

const PROCESS_NODE_KIND_BY_ID: Readonly<Record<string, string>> = {
  "node-preparation": "扩径准备",
  "node-enlargement": "变径空间扩挖",
  "node-cutter": "刀盘扩径",
  "node-shield": "盾体扩径",
  "node-reduction": "缩径转换",
};

const dependenciesFor = (
  overrides: Partial<IdentificationKnowledgeValidationDependenciesV1> = {},
): IdentificationKnowledgeValidationDependenciesV1 => ({
  projectId: PROJECT_ID,
  policy: POLICY,
  checkEvidence: eligibilityFor([
    SEGMENT_EVIDENCE.locator.sourceSegmentId,
    GROUND_EVIDENCE.locator.sourceSegmentId,
  ]),
  resolveProcessModel: async () => ({
    projectId: PROJECT_ID,
    nodes: Object.entries(PROCESS_NODE_KIND_BY_ID).map(([nodeId, processKind]) => ({
      nodeId,
      processKind: processKind as never,
    })),
  }),
  resolveCompositeMembers: async () => true,
  ...overrides,
});

const nodeFor = (nodeId: string) => ({
  nodeId,
  processKind: PROCESS_NODE_KIND_BY_ID[nodeId] as never,
  inputs: [`input-${nodeId}`],
  outputs: [`output-${nodeId}`],
  equipmentRefs: ["小盾构"],
  structuralComponentRefs: [],
  stateParameters: ["土仓/泥水压力"],
  monitoringIndicators: ["地表沉降"],
  applicability: {
    constructionMethod: ["盾构"],
    stratumCondition: ["软土"],
    engineeringStage: ["掘进"],
  },
  evidence: [SEGMENT_EVIDENCE],
});

const processModelPackage = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  projectId: PROJECT_ID,
  definitionType: "process-model",
  validationPolicyRef: POLICY_REF,
  preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
  generatedAt: "2030-01-01T00:00:00.000Z",
  nodes: Object.keys(PROCESS_NODE_KIND_BY_ID).map(nodeFor),
  dependencyEdges: [
    {
      edgeId: "edge-1",
      fromNodeId: "node-preparation",
      toNodeId: "node-enlargement",
      relationType: "时间先后关系",
      evidence: [GROUND_EVIDENCE],
    },
  ],
  ...overrides,
});

const mechanismEntry = (mechanismId: string, mechanismType: string, nodeIds: string[]) => ({
  mechanismId,
  mechanismType,
  nodeIds,
  stateParameters: ["土仓/泥水压力"],
  monitoringIndicators: ["地表沉降"],
  applicability: {
    constructionMethod: ["盾构"],
    stratumCondition: ["软土"],
    engineeringStage: ["掘进"],
  },
  preconditions: ["precondition-1"],
  triggeringFactors: ["trigger-1"],
  evolutionPath: ["path-1"],
  consequences: ["consequence-1"],
  evidence: [SEGMENT_EVIDENCE],
});

const MECHANISM_TYPES = [
  "掌子面稳定性失效",
  "支护结构失效",
  "渗流突涌",
  "过挖与地表沉降",
  "施工装备故障",
  "装配连接失效",
] as const;

const mechanismPackage = (mechanisms: readonly unknown[]) => ({
  schemaVersion: "1",
  projectId: PROJECT_ID,
  definitionType: "risk-mechanism",
  validationPolicyRef: POLICY_REF,
  preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
  generatedAt: "2030-01-01T00:00:00.000Z",
  processModelReleaseRef: {
    kind: "process-model-release",
    reference: { entityId: "process-model", versionId: "1" },
  },
  mechanisms,
});

const completeMechanisms = () =>
  MECHANISM_TYPES.map((mechanismType, index) =>
    mechanismEntry(
      `mechanism-${index + 1}`,
      mechanismType,
      index % 2 === 0 ? ["node-preparation"] : ["node-reduction"],
    ),
  );

const standardEntry = (entryId: string, level: string) => ({
  entryId,
  level,
  standardIdentity: "GB-50446",
  standardVersion: "2025",
  clauseRefs: ["clause-3.2"],
  applicability: {
    constructionMethod: ["盾构"],
    stratumCondition: ["软土"],
    engineeringStage: ["掘进"],
  },
  evidence: [GROUND_EVIDENCE],
});

const standardPackage = (entries: readonly unknown[]) => ({
  schemaVersion: "1",
  projectId: PROJECT_ID,
  definitionType: "standard-library",
  validationPolicyRef: POLICY_REF,
  preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
  generatedAt: "2030-01-01T00:00:00.000Z",
  entries,
});

const casePackage = (entries: readonly unknown[]) => ({
  schemaVersion: "1",
  projectId: PROJECT_ID,
  definitionType: "case-library",
  validationPolicyRef: POLICY_REF,
  preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
  generatedAt: "2030-01-01T00:00:00.000Z",
  entries,
});

const caseEntry = (entryId: string, constructionMethod: string) => ({
  entryId,
  constructionMethod,
  engineeringConditions: ["condition-1"],
  process: ["process-1"],
  events: ["event-1"],
  outcomes: ["outcome-1"],
  treatments: ["treatment-1"],
  applicability: {
    constructionMethod: ["盾构"],
    stratumCondition: ["软土"],
    engineeringStage: ["掘进"],
  },
  evidence: [GROUND_EVIDENCE],
});

const compositePackage = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  projectId: PROJECT_ID,
  definitionType: "retrieval-evidence-base",
  validationPolicyRef: POLICY_REF,
  preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
  generatedAt: "2030-01-01T00:00:00.000Z",
  riskMechanismReleaseRef: {
    kind: "risk-mechanism-release",
    reference: { entityId: "risk-mechanism", versionId: "1" },
  },
  standardLibraryReleaseRef: {
    kind: "knowledge-release",
    reference: { entityId: "standard-library", versionId: "1" },
  },
  caseLibraryReleaseRef: {
    kind: "knowledge-release",
    reference: { entityId: "case-library", versionId: "1" },
  },
  ...overrides,
});

const rejectedReasonCodes = (
  outcome: Awaited<ReturnType<typeof validateIdentificationKnowledgePackage>>,
) =>
  outcome.items
    .filter((item) => item.disposition === "rejected")
    .map((item) => item.reasonCode.split(":")[0]);

describe("C17 identification knowledge package validation", () => {
  it.each([true, false, undefined] as const)(
    "validates standard retrieval text against its exact preparation (%s)",
    async (verified) => {
      const entry = {
        ...standardEntry("standard-text", "national"),
        retrievalText: "真实资料正文",
      };
      const checked: unknown[] = [];
      const outcome = await validateIdentificationKnowledgePackage({
        value: standardPackage([entry]),
        expectedDefinitionType: "standard-library",
        dependencies: dependenciesFor({
          ...(verified === undefined
            ? {}
            : {
                checkStandardRetrievalText: async (input) => {
                  checked.push(input);
                  return verified;
                },
              }),
        }),
      });
      expect(outcome.disposition).toBe(verified === true ? "accepted" : "rejected");
      if (verified !== undefined) {
        expect(checked).toEqual([{ entry, preparationSnapshotRef: PREPARATION_SNAPSHOT_REF }]);
      }
      if (verified !== true) expect(outcome.rejectionClass).toBe("terminal");
    },
  );

  it.each([
    {
      name: "missing critical rule",
      policy: { ...POLICY, coverage: [POLICY.coverage[0]] },
    },
    {
      name: "duplicate critical kind",
      policy: { ...POLICY, criticalProcessKinds: ["扩径准备", "扩径准备"] },
    },
    {
      name: "duplicate coverage rule",
      policy: { ...POLICY, coverage: [...POLICY.coverage, POLICY.coverage[0]] },
    },
  ])("rejects an inconsistent validation policy: $name", ({ policy }) => {
    expect(IdentificationKnowledgeValidationPolicyV1Schema.safeParse(policy).success).toBe(false);
  });

  it("accepts complete process, mechanism, standard and case packages with reachable evidence", async () => {
    const processOutcome = await validateIdentificationKnowledgePackage({
      value: processModelPackage(),
      expectedDefinitionType: "process-model",
      dependencies: dependenciesFor(),
    });
    expect(processOutcome.disposition).toBe("accepted");

    const mechanismOutcome = await validateIdentificationKnowledgePackage({
      value: mechanismPackage(completeMechanisms()),
      expectedDefinitionType: "risk-mechanism",
      dependencies: dependenciesFor(),
    });
    expect(mechanismOutcome.disposition).toBe("accepted");

    const standardOutcome = await validateIdentificationKnowledgePackage({
      value: standardPackage([standardEntry("standard-1", "national")]),
      expectedDefinitionType: "standard-library",
      dependencies: dependenciesFor(),
    });
    expect(standardOutcome.disposition).toBe("accepted");

    const caseOutcome = await validateIdentificationKnowledgePackage({
      value: casePackage([caseEntry("case-1", "盾构")]),
      expectedDefinitionType: "case-library",
      dependencies: dependenciesFor(),
    });
    expect(caseOutcome.disposition).toBe("accepted");
  });

  it.each([
    [
      "missing required process kind",
      processModelPackage({
        nodes: Object.keys(PROCESS_NODE_KIND_BY_ID).slice(1).map(nodeFor),
      }),
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.missingRequiredProcessKind,
    ],
    [
      "unknown edge endpoint",
      processModelPackage({
        dependencyEdges: [
          {
            edgeId: "edge-1",
            fromNodeId: "node-preparation",
            toNodeId: "node-unknown",
            relationType: "时间先后关系",
            evidence: [GROUND_EVIDENCE],
          },
        ],
      }),
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.unknownEdgeEndpoint,
    ],
    [
      "self referencing edge",
      processModelPackage({
        dependencyEdges: [
          {
            edgeId: "edge-1",
            fromNodeId: "node-preparation",
            toNodeId: "node-preparation",
            relationType: "资源依赖关系",
            evidence: [GROUND_EVIDENCE],
          },
        ],
      }),
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.selfReferencingEdge,
    ],
    [
      "duplicate dependency edge",
      processModelPackage({
        dependencyEdges: [
          {
            edgeId: "edge-1",
            fromNodeId: "node-preparation",
            toNodeId: "node-enlargement",
            relationType: "时间先后关系",
            evidence: [GROUND_EVIDENCE],
          },
          {
            edgeId: "edge-2",
            fromNodeId: "node-preparation",
            toNodeId: "node-enlargement",
            relationType: "时间先后关系",
            evidence: [GROUND_EVIDENCE],
          },
        ],
      }),
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.duplicateEdge,
    ],
    [
      "time dependency cycle",
      processModelPackage({
        dependencyEdges: [
          {
            edgeId: "edge-1",
            fromNodeId: "node-preparation",
            toNodeId: "node-enlargement",
            relationType: "时间先后关系",
            evidence: [GROUND_EVIDENCE],
          },
          {
            edgeId: "edge-2",
            fromNodeId: "node-enlargement",
            toNodeId: "node-preparation",
            relationType: "时间先后关系",
            evidence: [GROUND_EVIDENCE],
          },
        ],
      }),
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.timeDependencyCycle,
    ],
    [
      "duplicate node id",
      processModelPackage({
        nodes: [...Object.keys(PROCESS_NODE_KIND_BY_ID).map(nodeFor), nodeFor("node-preparation")],
      }),
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.duplicateNodeId,
    ],
    [
      "excluded evidence segment",
      processModelPackage({
        nodes: Object.keys(PROCESS_NODE_KIND_BY_ID).map((nodeId) => ({
          ...nodeFor(nodeId),
          evidence: [SEGMENT_EVIDENCE, GROUND_EVIDENCE],
        })),
      }),
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.nodeEvidenceIneligible,
      { checkEvidence: eligibilityFor([SEGMENT_EVIDENCE.locator.sourceSegmentId]) },
    ],
    [
      "unknown process model release",
      mechanismPackage(completeMechanisms()),
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.unknownProcessModel,
    ],
    [
      "missing required mechanism type",
      mechanismPackage(completeMechanisms().slice(0, 5)),
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.missingRequiredMechanismType,
    ],
    [
      "mechanism without declared process node",
      mechanismPackage([
        ...completeMechanisms().slice(0, 5),
        mechanismEntry("mechanism-6", "装配连接失效", ["node-unknown"]),
      ]),
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.unknownProcessNode,
    ],
    [
      "standard level outside policy",
      standardPackage([standardEntry("standard-1", "enterprise")]),
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.standardLevelNotAllowed,
    ],
    [
      "case method outside policy",
      casePackage([caseEntry("case-1", "矿山法")]),
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.caseMethodNotAllowed,
    ],
    [
      "duplicate standard entry",
      standardPackage([
        standardEntry("standard-1", "national"),
        standardEntry("standard-1", "industry"),
      ]),
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.duplicateEntryId,
    ],
  ])("rejects %s with a stable reason code", async (_name, value, reasonCode, overrides) => {
    const outcome = await validateIdentificationKnowledgePackage({
      value,
      dependencies: dependenciesFor(
        _name === "unknown process model release"
          ? { resolveProcessModel: async () => undefined }
          : (overrides ?? {}),
      ),
    });
    expect(outcome.disposition).toBe("rejected");
    expect(rejectedReasonCodes(outcome)).toContain(reasonCode);
  });

  it("rejects unknown fields, wrong project, wrong definition type and policy drift", async () => {
    const unknownField = await validateIdentificationKnowledgePackage({
      value: { ...processModelPackage(), undeclaredField: true },
      dependencies: dependenciesFor(),
    });
    expect(rejectedReasonCodes(unknownField)).toContain(
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.schemaInvalid,
    );

    const wrongProject = await validateIdentificationKnowledgePackage({
      value: processModelPackage({ projectId: OTHER_PROJECT_ID }),
      dependencies: dependenciesFor(),
    });
    expect(rejectedReasonCodes(wrongProject)).toContain(
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.projectMismatch,
    );

    const wrongType = await validateIdentificationKnowledgePackage({
      value: processModelPackage(),
      expectedDefinitionType: "risk-mechanism",
      dependencies: dependenciesFor(),
    });
    expect(rejectedReasonCodes(wrongType)).toContain(
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.definitionTypeMismatch,
    );

    const policyDrift = await validateIdentificationKnowledgePackage({
      value: processModelPackage({
        validationPolicyRef: { entityId: POLICY_REF.entityId, versionId: "2" },
      }),
      dependencies: dependenciesFor(),
    });
    expect(rejectedReasonCodes(policyDrift)).toContain(
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.validationPolicyMismatch,
    );
  });

  it("rejects a cross-project process release and packages beyond the policy entry limit", async () => {
    const crossProject = await validateIdentificationKnowledgePackage({
      value: mechanismPackage(completeMechanisms()),
      dependencies: dependenciesFor({
        resolveProcessModel: async () => ({
          projectId: OTHER_PROJECT_ID,
          nodes: [{ nodeId: "node-preparation", processKind: "扩径准备" as never }],
        }),
      }),
    });
    expect(crossProject.disposition).toBe("rejected");
    expect(crossProject.rejectionClass).toBe("terminal");
    expect(rejectedReasonCodes(crossProject)).toContain(
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.unknownProcessModel,
    );

    const limitedPolicy = IdentificationKnowledgeValidationPolicyV1Schema.parse({
      ...POLICY,
      maxEntriesPerPackage: 4,
    });
    const limitExceeded = await validateIdentificationKnowledgePackage({
      value: processModelPackage(),
      dependencies: dependenciesFor({ policy: limitedPolicy }),
    });
    expect(rejectedReasonCodes(limitExceeded)).toContain(
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.entryLimitExceeded,
    );
  });

  it("rejects critical coverage shortfall and applies evidence authorization decisions", async () => {
    const shortfall = await validateIdentificationKnowledgePackage({
      value: mechanismPackage(
        completeMechanisms().map((mechanism) => ({
          ...mechanism,
          nodeIds: ["node-enlargement"],
        })),
      ),
      dependencies: dependenciesFor(),
    });
    expect(rejectedReasonCodes(shortfall)).toContain(
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.criticalCoverageShortfall,
    );

    const revoked = await validateIdentificationKnowledgePackage({
      value: standardPackage([standardEntry("standard-1", "national")]),
      dependencies: dependenciesFor({ checkEvidence: eligibilityFor([]) }),
    });
    expect(rejectedReasonCodes(revoked)).toContain(
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.entryEvidenceIneligible,
    );
    expect(revoked.rejectionClass).toBe("terminal");
  });

  it("accepts exactly three composite members and rejects duplicates or invalid members", async () => {
    const acceptedComposite = await validateIdentificationKnowledgePackage({
      value: compositePackage(),
      dependencies: dependenciesFor(),
    });
    expect(acceptedComposite.disposition).toBe("accepted");

    const duplicateMember = await validateIdentificationKnowledgePackage({
      value: compositePackage({
        caseLibraryReleaseRef: {
          kind: "knowledge-release",
          reference: { entityId: "standard-library", versionId: "1" },
        },
      }),
      dependencies: dependenciesFor(),
    });
    expect(rejectedReasonCodes(duplicateMember)).toContain(
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.compositeMemberDuplicate,
    );

    const invalidMember = await validateIdentificationKnowledgePackage({
      value: compositePackage(),
      dependencies: dependenciesFor({ resolveCompositeMembers: async () => false }),
    });
    expect(rejectedReasonCodes(invalidMember)).toContain(
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.compositeMemberInvalid,
    );
  });

  it("keeps the five independent definition identities distinct", () => {
    expect(IDENTIFICATION_KNOWLEDGE_DEFINITION_TYPES_V1).toEqual([
      "process-model",
      "risk-mechanism",
      "standard-library",
      "case-library",
      "retrieval-evidence-base",
    ]);
    for (const definitionType of IDENTIFICATION_KNOWLEDGE_DEFINITION_TYPES_V1) {
      const value =
        definitionType === "process-model"
          ? processModelPackage()
          : definitionType === "risk-mechanism"
            ? mechanismPackage(completeMechanisms())
            : definitionType === "standard-library"
              ? standardPackage([standardEntry("standard-1", "national")])
              : definitionType === "case-library"
                ? casePackage([caseEntry("case-1", "盾构")])
                : compositePackage();
      expect(Reflect.get(value as object, "definitionType")).toBe(definitionType);
    }
  });
});

describe("C17 identification basis publication event", () => {
  const releaseRef = (entityId: string) => ({
    kind: "knowledge-release" as const,
    reference: { entityId, versionId: "1" },
  });

  it("builds the exact published-releases payload and pins the composite aggregate", () => {
    const composite = releaseRef("retrieval-evidence-base");
    const event = identificationBasisPublishedEvent({
      releaseRef: composite,
      compositeMemberReleaseRefs: [
        releaseRef("process-model"),
        releaseRef("risk-mechanism"),
        releaseRef("standard-library"),
        releaseRef("case-library"),
      ],
      command: {
        projectId: PROJECT_ID,
        commandId: "c17-publish-1",
        idempotencyKey: "c17-publish-key-1",
        actorId: "manager-1",
        issuedAt: "2030-01-01T00:02:00.000Z",
        authorizationContextRef: {
          kind: "authorization-context",
          reference: { entityId: "authorization-1", versionId: "1" },
        },
      },
      recordedAt: "2030-01-01T00:02:01.000Z",
      auditEntryId: "audit-1",
    });
    expect(event.eventType).toBe("knowledge.identification-basis-published.v1");
    expect(event.aggregateRef).toEqual(composite);
    expect(event.producerCommandId).toBe("c17-publish-1");
    expect(event.auditTrailRef).toEqual({
      kind: "audit-trail",
      reference: { entityId: "audit-1", versionId: "1" },
    });
    expect(event.payload).toMatchObject({
      basisKind: "identification-basis",
      retrievalEvidenceBaseReleaseRef: {
        kind: "retrieval-evidence-base-release",
        reference: composite.reference,
      },
    });
    expect(event.payload.publishedReleases.map((entry) => entry.definitionType)).toEqual([
      "process-model",
      "risk-mechanism",
      "standard-library",
      "case-library",
      "retrieval-evidence-base",
    ]);
  });

  it("rejects member sets that are not exactly the four definition identities", () => {
    expect(() =>
      identificationBasisPublishedEvent({
        releaseRef: releaseRef("retrieval-evidence-base"),
        compositeMemberReleaseRefs: [releaseRef("process-model")],
        command: {
          projectId: PROJECT_ID,
          commandId: "c17-publish-2",
          idempotencyKey: "c17-publish-key-2",
          actorId: "manager-1",
          issuedAt: "2030-01-01T00:02:00.000Z",
          authorizationContextRef: {
            kind: "authorization-context",
            reference: { entityId: "authorization-1", versionId: "1" },
          },
        },
        recordedAt: "2030-01-01T00:02:01.000Z",
        auditEntryId: "audit-2",
      }),
    ).toThrow();
  });
});

describe("C17 knowledge authoring increments", () => {
  const baselineDigest = identificationKnowledgePackageDigest(processModelPackage());
  const baselinePackage = processModelPackage() as never;

  const applyIncrement = (increment: unknown, baselineDigest: string) =>
    applyKnowledgeAuthoringIncrement({
      projectId: PROJECT_ID,
      preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
      baseline: baselinePackage,
      baselineDigest,
      increment: KnowledgeAuthoringIncrementV1Schema.parse(increment),
      generatedAt: "2030-01-02T00:00:00.000Z",
      policy: POLICY,
    });

  it("applies typed declare and retire operations against the frozen baseline", () => {
    const digest = baselineDigest;
    const applied = applyIncrement(
      {
        schemaVersion: "1",
        candidateVersion: 1,
        definitionType: "process-model",
        operations: [
          {
            operation: "declare-node",
            expectedBaselineDigest: digest,
            reasonCode: "add-node",
            evidence: [SEGMENT_EVIDENCE],
            node: {
              ...nodeFor("node-preparation"),
              nodeId: "node-extra",
            },
          },
          {
            operation: "retire-node",
            expectedBaselineDigest: digest,
            reasonCode: "retire-node",
            evidence: [SEGMENT_EVIDENCE],
            nodeId: "node-shield",
          },
          {
            operation: "declare-edge",
            expectedBaselineDigest: digest,
            reasonCode: "add-edge",
            evidence: [SEGMENT_EVIDENCE],
            edge: {
              edgeId: "edge-2",
              fromNodeId: "node-extra",
              toNodeId: "node-enlargement",
              relationType: "作用关系",
              evidence: [SEGMENT_EVIDENCE],
            },
          },
        ],
      },
      digest,
    );
    expect(applied.kind).toBe("applied");
    if (applied.kind !== "applied") return;
    const nodeIds = (applied.package as { nodes: readonly { nodeId: string }[] }).nodes.map(
      (node) => node.nodeId,
    );
    expect(nodeIds).toContain("node-extra");
    expect(nodeIds).not.toContain("node-shield");
    expect(applied.packageDigest).toBe(identificationKnowledgePackageDigest(applied.package));
  });

  it.each([
    [
      "stale baseline digest",
      (digest: string) => ({
        schemaVersion: "1",
        candidateVersion: 1,
        definitionType: "process-model",
        operations: [
          {
            operation: "retire-node",
            expectedBaselineDigest: digest,
            reasonCode: "retire-node",
            evidence: [SEGMENT_EVIDENCE],
            nodeId: "node-shield",
          },
        ],
      }),
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.incrementBaselineMismatch,
    ],
    [
      "retire of an undeclared entry",
      (digest: string) => ({
        schemaVersion: "1",
        candidateVersion: 1,
        definitionType: "process-model",
        operations: [
          {
            operation: "retire-node",
            expectedBaselineDigest: digest,
            reasonCode: "retire-node",
            evidence: [SEGMENT_EVIDENCE],
            nodeId: "node-unknown",
          },
        ],
      }),
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.incrementTargetMissing,
    ],
    [
      "declare of an existing entry",
      (digest: string) => ({
        schemaVersion: "1",
        candidateVersion: 1,
        definitionType: "process-model",
        operations: [
          {
            operation: "declare-node",
            expectedBaselineDigest: digest,
            reasonCode: "add-node",
            evidence: [SEGMENT_EVIDENCE],
            node: nodeFor("node-preparation"),
          },
        ],
      }),
      IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.incrementTargetExists,
    ],
  ])("rejects %s", (_name, build, reasonCode) => {
    const digest = baselineDigest;
    const increment = build(digest);
    const applied = applyIncrement(
      _name === "stale baseline digest" ? increment : increment,
      _name === "stale baseline digest" ? "0".repeat(64) : digest,
    );
    expect(applied.kind).toBe("rejected");
    if (applied.kind !== "rejected") return;
    expect(applied.outcome.items.map((item) => item.reasonCode)).toContain(reasonCode);
  });

  it("applies first revisions without a baseline except for risk mechanisms", () => {
    const standard = applyKnowledgeAuthoringIncrement({
      projectId: PROJECT_ID,
      preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
      baseline: undefined,
      baselineDigest: undefined,
      increment: KnowledgeAuthoringIncrementV1Schema.parse({
        schemaVersion: "1",
        candidateVersion: 1,
        definitionType: "standard-library",
        operations: [
          {
            operation: "cite-clause",
            expectedBaselineDigest: "0".repeat(64),
            reasonCode: "cite-clause",
            evidence: [GROUND_EVIDENCE],
            entry: standardEntry("standard-1", "national"),
          },
        ],
      }),
      generatedAt: "2030-01-02T00:00:00.000Z",
      policy: POLICY,
    });
    expect(standard.kind).toBe("applied");
    if (standard.kind === "applied") {
      expect(standard.package.definitionType).toBe("standard-library");
    }

    const mechanisms = applyKnowledgeAuthoringIncrement({
      projectId: PROJECT_ID,
      preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
      baseline: undefined,
      baselineDigest: undefined,
      increment: KnowledgeAuthoringIncrementV1Schema.parse({
        schemaVersion: "1",
        candidateVersion: 1,
        definitionType: "risk-mechanism",
        operations: [
          {
            operation: "declare-mechanism",
            expectedBaselineDigest: "0".repeat(64),
            reasonCode: "declare-mechanism",
            evidence: [GROUND_EVIDENCE],
            mechanism: mechanismEntry("mechanism-1", "掌子面稳定性失效", ["node-preparation"]),
          },
        ],
      }),
      generatedAt: "2030-01-02T00:00:00.000Z",
      policy: POLICY,
    });
    expect(mechanisms.kind).toBe("rejected");
    if (mechanisms.kind === "rejected") {
      expect(mechanisms.outcome.items.map((item) => item.reasonCode)).toContain(
        IDENTIFICATION_KNOWLEDGE_REASON_CODES_V1.incrementBaselineMissing,
      );
    }
  });

  it("structurally forbids patch, whole object and publish operations", () => {
    for (const forbidden of [
      { operation: "json-patch", path: "/nodes/-", value: {} },
      { operation: "replace-package", package: processModelPackage() },
      { operation: "publish-release", releaseRef: { entityId: "x", versionId: "1" } },
      { operation: "patch", ops: [] },
    ]) {
      const parsed = KnowledgeAuthoringIncrementV1Schema.safeParse({
        schemaVersion: "1",
        candidateVersion: 1,
        definitionType: "process-model",
        operations: [forbidden],
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("selects exactly three composite members through typed operations", () => {
    const composite = KnowledgeAuthoringIncrementV1Schema.safeParse({
      schemaVersion: "1",
      candidateVersion: 1,
      definitionType: "retrieval-evidence-base",
      operations: [
        {
          operation: "select-member",
          expectedBaselineDigest: "0".repeat(64),
          reasonCode: "select-mechanism",
          evidence: [SEGMENT_EVIDENCE],
          memberDefinitionType: "risk-mechanism",
          memberReleaseRef: {
            kind: "knowledge-release",
            reference: { entityId: "risk-mechanism", versionId: "2" },
          },
        },
        {
          operation: "select-member",
          expectedBaselineDigest: "0".repeat(64),
          reasonCode: "select-standard",
          evidence: [SEGMENT_EVIDENCE],
          memberDefinitionType: "standard-library",
          memberReleaseRef: {
            kind: "knowledge-release",
            reference: { entityId: "standard-library", versionId: "2" },
          },
        },
        {
          operation: "select-member",
          expectedBaselineDigest: "0".repeat(64),
          reasonCode: "select-case",
          evidence: [SEGMENT_EVIDENCE],
          memberDefinitionType: "case-library",
          memberReleaseRef: {
            kind: "knowledge-release",
            reference: { entityId: "case-library", versionId: "2" },
          },
        },
      ],
    });
    expect(composite.success).toBe(true);
    const incomplete = KnowledgeAuthoringIncrementV1Schema.safeParse({
      schemaVersion: "1",
      candidateVersion: 1,
      definitionType: "retrieval-evidence-base",
      operations: (composite.success
        ? (composite.data as KnowledgeAuthoringIncrementV1).operations
        : []
      ).slice(0, 2),
    });
    expect(incomplete.success).toBe(false);
  });
});

describe("C17 knowledge authoring task definition", () => {
  it("registers the knowledge-authoring task with read-only tools and revision results", async () => {
    const calls: string[] = [];
    const definition = createKnowledgeAuthoringTaskDefinition({
      policy: POLICY,
      port: {
        readSegmentSlice: async () => {
          calls.push("segment-slice");
          return { observationArtifactRef: {} as never, effect: "none" };
        },
        readExactKnowledge: async () => {
          calls.push("baseline");
          return { observationArtifactRef: {} as never, effect: "none" };
        },
        validateAuthoringCandidate: async () => {
          calls.push("validate");
          return {
            schemaVersion: "1",
            items: [],
            disposition: "accepted",
            validationArtifactRef: {} as never,
            validatedAt: "2030-01-01T00:00:00.000Z",
          };
        },
        finalizeAuthoringCandidate: async () => {
          calls.push("finalize");
          return {} as never;
        },
      },
    });

    expect(definition.metadata.taskType).toBe("knowledge-authoring");
    expect(definition.metadata.resultFamilies).toEqual(["knowledge-revision"]);
    expect(definition.metadata.allowedToolRefs).toEqual([
      POLICY.tools.segmentSliceToolRef,
      POLICY.tools.baselineKnowledgeToolRef,
    ]);
    expect(definition.metadata.supportedTriggerModes).toEqual(["embedded", "interactive"]);
    expect(definition.tools).toHaveLength(2);
    expect(
      definition.measureCandidateUsage(
        KnowledgeAuthoringCandidateV1Schema.parse({
          schemaVersion: "1",
          candidateVersion: 1,
          definitionType: "process-model",
          operations: [
            {
              operation: "retire-node",
              expectedBaselineDigest: "0".repeat(64),
              reasonCode: "retire-node",
              evidence: [SEGMENT_EVIDENCE],
              nodeId: "node-shield",
            },
          ],
        }),
        {} as never,
      ),
    ).toEqual({ candidates: 1, objects: 1 });
  });
});
