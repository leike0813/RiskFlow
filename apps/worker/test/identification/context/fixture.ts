import { createHash } from "node:crypto";

import type { VersionReference } from "@riskflow/contracts/common";
import {
  ModuleErrorV1Schema,
  type AgentTaskRefV1,
  type AuthorizationContextV1,
} from "@riskflow/contracts/ports";
import { IdentificationInputSnapshotV1Schema } from "@riskflow/contracts/workflows";
import {
  AgentTaskEnvelopeV1Schema,
  emptyAgentBudgetUsage,
  type AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import type { ArtifactRefV1 } from "@riskflow/core/artifacts";
import {
  IdentificationContextService,
  RetrievalReviewCandidateSetV1Schema,
  RetrievalReviewPolicyV1Schema,
  type IdentificationContextResultStoreV1,
  type RetrievalReviewPolicyV1,
} from "@riskflow/core/identification/context";
import {
  HybridRetrievalPolicyV1Schema,
  HybridRetrievalResultPayloadV1Schema,
  authorizationScopeDigest,
} from "@riskflow/core/retrieval";

/** 合成样本、待甲方复核 */
export const SYNTHETIC_SAMPLE_NOTICE = "合成样本、待甲方复核";
export const TIMESTAMP = "2030-01-01T00:00:00.000Z";
export const PROJECT = "project-c21";
export const ACTOR = "actor-c21";
export const NODE_ID = "node-current";
export const NEIGHBOR_ID = "node-neighbor";
export const FORCE_NODE_ID = "node-force";

export const versionRef = (entityId: string, versionId = "v1"): VersionReference => ({
  entityId,
  versionId,
});
export const releaseRef = (entityId: string, versionId = "v1") => ({
  kind: "knowledge-release" as const,
  reference: versionRef(entityId, versionId),
});
export const segmentEvidence = (sourceSegmentId: string, entityId = "source-a") => ({
  locator: { sourceSegmentId },
  sourceVersion: versionRef(entityId),
});

export const authorizationContextRef = {
  kind: "authorization-context" as const,
  reference: versionRef("authorization-context-c21"),
};
export const retrievalReviewPolicyRef = versionRef("retrieval-review-policy");
export const inputSnapshotRef = {
  kind: "identification-input-snapshot" as const,
  reference: versionRef("input-snapshot-c21"),
};
export const workItemRef = {
  kind: "identification-work-item" as const,
  reference: versionRef("work-item-c21"),
};

export const processModelRelease = versionRef("release-process-model");
export const riskMechanismRelease = versionRef("release-risk-mechanism");
export const evidenceBaseRelease = versionRef("release-evidence-base");

export const digestOf = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(value) ?? "")
    .digest("hex");

export const inputSnapshot = (overrides: Record<string, unknown> = {}) =>
  IdentificationInputSnapshotV1Schema.parse({
    schemaVersion: "1",
    preparationSnapshotRef: {
      kind: "identification-preparation-snapshot",
      reference: versionRef("preparation-snapshot"),
    },
    processModelReleaseRef: { kind: "process-model-release", reference: processModelRelease },
    riskMechanismReleaseRef: { kind: "risk-mechanism-release", reference: riskMechanismRelease },
    retrievalEvidenceBaseReleaseRef: {
      kind: "retrieval-evidence-base-release",
      reference: evidenceBaseRelease,
    },
    identificationPolicySetRef: {
      kind: "identification-policy-set",
      reference: versionRef("identification-policy-set"),
    },
    retrievalPolicyRef: versionRef("retrieval-policy"),
    retrievalReviewAgentPolicyRef: retrievalReviewPolicyRef,
    repairPolicyRef: versionRef("repair-policy"),
    confidencePolicyRef: versionRef("confidence-policy"),
    forcedReviewPolicyRef: versionRef("forced-review-policy"),
    retryPolicyRef: versionRef("retry-policy"),
    modelDeploymentRef: versionRef("model-deployment"),
    promptTemplateRef: versionRef("prompt-template"),
    authorizationContextRef,
    auditTrailRef: { kind: "audit-trail", reference: versionRef("audit-trail") },
    createdBy: ACTOR,
    createdAt: TIMESTAMP,
    ...overrides,
  });

export const authorization = (
  overrides: Partial<AuthorizationContextV1> = {},
): AuthorizationContextV1 =>
  ({
    schemaVersion: "1",
    authorizationContextRef,
    actorId: ACTOR,
    projectId: PROJECT,
    grantedCapabilities: ["knowledge-modeling.retrieve"],
    spatialScopeRefs: [{ kind: "spatial-scope", reference: versionRef("spatial-scope") }],
    sourceAccessGrantRefs: [
      { kind: "source-access-grant", reference: versionRef("source-access-grant") },
    ],
    authorizationPolicyRef: versionRef("access-policy"),
    decidedAt: TIMESTAMP,
    invocation: { kind: "system", systemActorId: ACTOR, reasonCode: "c21-worker-test" },
    causalRunRef: { kind: "workflow-run", reference: versionRef("workflow-run") },
    ...overrides,
  }) as AuthorizationContextV1;

export const processModelPackage = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  projectId: PROJECT,
  validationPolicyRef: versionRef("validation-policy"),
  preparationSnapshotRef: {
    kind: "identification-preparation-snapshot",
    reference: versionRef("preparation-snapshot"),
  },
  generatedAt: TIMESTAMP,
  definitionType: "process-model",
  nodes: [
    {
      nodeId: NODE_ID,
      processKind: "变径空间扩挖",
      inputs: ["input-a"],
      outputs: ["output-a"],
      equipmentRefs: ["扩径模块"],
      structuralComponentRefs: ["钢管片"],
      stateParameters: ["盾体直径", "土仓/泥水压力"],
      monitoringIndicators: ["地表沉降"],
      applicability: {
        constructionMethod: ["method-a"],
        stratumCondition: ["stratum-a"],
        engineeringStage: ["stage-a"],
      },
      evidence: [segmentEvidence("segment-current")],
    },
    {
      nodeId: NEIGHBOR_ID,
      processKind: "扩径准备",
      inputs: ["input-b"],
      outputs: ["output-b"],
      equipmentRefs: ["反力系统"],
      structuralComponentRefs: ["锚杆"],
      stateParameters: ["支护状态"],
      monitoringIndicators: ["支护结构变形"],
      applicability: {
        constructionMethod: ["method-a"],
        stratumCondition: ["stratum-a"],
        engineeringStage: ["stage-a"],
      },
      evidence: [segmentEvidence("segment-neighbor")],
    },
    {
      nodeId: FORCE_NODE_ID,
      processKind: "盾体扩径",
      inputs: ["input-c"],
      outputs: ["output-c"],
      equipmentRefs: ["推进系统"],
      structuralComponentRefs: ["尾盾"],
      stateParameters: ["反力体系状态"],
      monitoringIndicators: ["盾构姿态参数"],
      applicability: {
        constructionMethod: ["method-a"],
        stratumCondition: ["stratum-a"],
        engineeringStage: ["stage-a"],
      },
      evidence: [segmentEvidence("segment-force")],
    },
  ],
  dependencyEdges: [
    {
      edgeId: "edge-time",
      fromNodeId: NEIGHBOR_ID,
      toNodeId: NODE_ID,
      relationType: "时间先后关系",
      evidence: [segmentEvidence("segment-edge-time")],
    },
    {
      edgeId: "edge-force",
      fromNodeId: FORCE_NODE_ID,
      toNodeId: NODE_ID,
      relationType: "受力依赖关系",
      evidence: [segmentEvidence("segment-edge-force")],
    },
  ],
  ...overrides,
});

export const riskMechanismPackageValue = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  projectId: PROJECT,
  validationPolicyRef: versionRef("validation-policy"),
  preparationSnapshotRef: {
    kind: "identification-preparation-snapshot",
    reference: versionRef("preparation-snapshot"),
  },
  generatedAt: TIMESTAMP,
  definitionType: "risk-mechanism",
  processModelReleaseRef: { kind: "process-model-release", reference: processModelRelease },
  mechanisms: [
    {
      mechanismId: "mechanism-applicable",
      mechanismType: "过挖与地表沉降",
      nodeIds: [NODE_ID],
      stateParameters: ["盾体直径"],
      monitoringIndicators: ["地表沉降"],
      applicability: {
        constructionMethod: ["method-a"],
        stratumCondition: ["stratum-a"],
        engineeringStage: ["stage-a"],
      },
      preconditions: ["precondition-a"],
      triggeringFactors: ["trigger-a"],
      evolutionPath: ["path-a"],
      consequences: ["consequence-a"],
      evidence: [segmentEvidence("segment-mechanism")],
    },
  ],
  ...overrides,
});

export const evidenceBasePackage = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  projectId: PROJECT,
  validationPolicyRef: versionRef("validation-policy"),
  preparationSnapshotRef: {
    kind: "identification-preparation-snapshot",
    reference: versionRef("preparation-snapshot"),
  },
  generatedAt: TIMESTAMP,
  definitionType: "retrieval-evidence-base",
  riskMechanismReleaseRef: { kind: "risk-mechanism-release", reference: riskMechanismRelease },
  standardLibraryRef: releaseRef("release-standard-library"),
  caseLibraryRef: releaseRef("release-case-library"),
  ...overrides,
});

export const standardLibraryPackage = (projectId = PROJECT) => ({
  schemaVersion: "1",
  projectId,
  validationPolicyRef: versionRef("validation-policy"),
  preparationSnapshotRef: {
    kind: "identification-preparation-snapshot",
    reference: versionRef("preparation-snapshot"),
  },
  generatedAt: TIMESTAMP,
  definitionType: "standard-library",
  entries: [
    {
      entryId: "entry-standard",
      level: "national",
      standardIdentity: "standard-a",
      standardVersion: "2026",
      clauseRefs: ["clause-a"],
      applicability: {
        constructionMethod: ["method-a"],
        stratumCondition: ["stratum-a"],
        engineeringStage: ["stage-a"],
      },
      evidence: [segmentEvidence("segment-standard")],
    },
  ],
});

export const exactRead = (
  packageValue: Record<string, unknown>,
  release: VersionReference,
  compositeMemberReleaseRefs?: readonly unknown[],
) => ({
  package: packageValue,
  validation: {
    schemaVersion: "1",
    projectId: PROJECT,
    definitionType: packageValue["definitionType"],
    packageDigest: digestOf(packageValue),
    validationPolicyRef: versionRef("validation-policy"),
    preparationSnapshotRef: {
      kind: "identification-preparation-snapshot",
      reference: versionRef("preparation-snapshot"),
    },
    items: [
      {
        checkId: "package.strict-schema",
        targetKind: "package",
        targetId: String(packageValue["definitionType"]),
        disposition: "accepted",
        reasonCode: "accepted",
        evidenceReferences: [],
      },
    ],
    disposition: "accepted",
    validationArtifactRef: {
      kind: "content-artifact",
      reference: { entityId: "validation", versionId: `sha256:${"a".repeat(64)}` },
    },
    validatedAt: TIMESTAMP,
  },
  releaseBinding: {
    schemaVersion: "1",
    projectId: PROJECT,
    definitionType: packageValue["definitionType"],
    releaseRef: release,
    revisionRef: { kind: "knowledge-revision", reference: versionRef("revision") },
    candidateArtifactRef: {
      kind: "content-artifact",
      reference: { entityId: "candidate", versionId: `sha256:${"b".repeat(64)}` },
    },
    ...(compositeMemberReleaseRefs === undefined ? {} : { compositeMemberReleaseRefs }),
    boundAt: TIMESTAMP,
  },
});

export const memberRef = (sourceEntryId: string, release: VersionReference) => ({
  kind: "retrieval-member" as const,
  reference: {
    entityId: `retrieval-member:${release.entityId}:${sourceEntryId}`,
    versionId: digestOf({ release, sourceEntryId }).slice(0, 32),
  },
});

export const baselineQueryId = `${NODE_ID}:retrieval-baseline`;
/** 与当前授权范围一致的摘要；测试不伪造范围。 */
export const scopeDigest = authorizationScopeDigest(authorization());

export const hybridPayload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  queryId: baselineQueryId,
  projectId: PROJECT,
  actorId: ACTOR,
  requestedAt: TIMESTAMP,
  completedAt: TIMESTAMP,
  refs: { inputSnapshotRef, workItemRef, retrievalPolicyRef: versionRef("retrieval-policy") },
  evidenceBaseReleaseRef: {
    kind: "retrieval-evidence-base-release",
    reference: evidenceBaseRelease,
  },
  memberReleaseRefs: {
    riskMechanismRef: releaseRef("release-risk-mechanism"),
    standardLibraryRef: releaseRef("release-standard-library"),
    caseLibraryRef: releaseRef("release-case-library"),
  },
  generationRef: { kind: "retrieval-generation", reference: versionRef("retrieval-generation") },
  collectionName: "riskflow-retrieval-test",
  projectionCompatibilityRef: versionRef("projection-compatibility"),
  policyRef: versionRef("retrieval-policy"),
  modelDeploymentRef: versionRef("model-deployment"),
  embeddingDimensions: 4,
  bm25: {
    model: "qdrant/bm25",
    tokenizer: "multilingual",
    language: "chinese",
    stemmer: "none",
    stopwords: [],
  },
  rrf: { k: 60, denseWeight: 1, bm25Weight: 1 },
  densePrefetchLimit: 8,
  bm25PrefetchLimit: 8,
  topK: 4,
  authorizationScopeDigest: scopeDigest,
  authorizationContextRef,
  hits: [
    {
      rank: 1,
      memberRef: memberRef("entry-standard", versionRef("release-standard-library")),
      sourceKind: "standard-library",
      sourceReleaseRef: releaseRef("release-standard-library"),
      sourceEntryId: "entry-standard",
      contentDigest: digestOf("standard-entry"),
      evidenceSourceVersionRefs: [versionRef("source-a")],
      denseRank: 1,
      bm25Rank: 1,
      denseContribution: 0.5,
      bm25Contribution: 0.5,
      fusionScore: 1,
    },
  ],
  scoreSemantics: "ranking-signal-not-confidence",
  knowledgeQueryResultRef: {
    kind: "knowledge-query-result",
    reference: {
      entityId: `retrieval-query-result:${PROJECT}:${baselineQueryId}`,
      versionId: digestOf("baseline"),
    },
  },
  ...overrides,
});

export const hybridPolicyValue = () => ({
  schemaVersion: "1",
  policyRef: versionRef("retrieval-policy"),
  evidenceBaseDefinitionType: "retrieval-evidence-base",
  modelDeploymentRef: versionRef("model-deployment"),
  dense: { vectorName: "dense", dimensions: 4, distance: "cosine" },
  bm25: {
    vectorName: "bm25",
    model: "qdrant/bm25",
    tokenizer: "multilingual",
    language: "chinese",
    stemmer: "none",
    stopwords: [],
  },
  densePrefetchLimit: 8,
  bm25PrefetchLimit: 8,
  topK: 4,
  rrf: { k: 60, denseWeight: 1, bm25Weight: 1 },
  memberBatchLimit: 64,
  memberByteLimit: 4096,
  memberLimit: 500,
  embeddingTimeoutMs: 30000,
  projectionTimeoutMs: 60000,
  acceptancePolicyRef: versionRef("retrieval-acceptance-policy"),
  projectionCompatibilityRef: versionRef("projection-compatibility"),
});

export const candidateMember = (overrides: Record<string, unknown> = {}) => ({
  memberRef: memberRef("entry-standard", versionRef("release-standard-library")),
  sourceKind: "standard-library",
  sourceReleaseRef: releaseRef("release-standard-library"),
  sourceEntryId: "entry-standard",
  contentDigest: digestOf("standard-entry"),
  evidenceSourceVersionRefs: [versionRef("source-a")],
  evidence: [segmentEvidence("segment-standard")],
  origin: "baseline",
  originQueryResultRef: {
    kind: "knowledge-query-result" as const,
    reference: { entityId: "retrieval-query-result:baseline", versionId: digestOf("baseline") },
  },
  rank: 1,
  fusionScore: 1,
  ...overrides,
});

export const taskRef = (): AgentTaskRefV1 => ({
  kind: "agent-task",
  reference: versionRef("agent-task:project-c21:review-1"),
  taskType: "retrieval-review",
  triggerMode: "embedded",
  modelDeploymentRef: versionRef("model-deployment"),
  promptTemplateRef: versionRef("prompt-template"),
  toolPolicyRef: versionRef("tool-policy"),
  budgetPolicyRef: versionRef("budget-policy"),
  incrementSchemaRef: versionRef("increment-schema"),
  validationPolicyRef: versionRef("validation-policy"),
});

export const reviewPolicy = (): RetrievalReviewPolicyV1 =>
  RetrievalReviewPolicyV1Schema.parse({
    schemaVersion: "1",
    policyRef: retrievalReviewPolicyRef,
    definitionRef: versionRef("retrieval-review-definition"),
    toolPolicyRef: versionRef("tool-policy"),
    incrementSchemaRef: versionRef("increment-schema"),
    validationPolicyRef: versionRef("validation-policy"),
    readFrozenResultToolRef: versionRef("tool-read-frozen"),
    resupplementToolRef: versionRef("tool-resupplement"),
    budgetPolicyRef: versionRef("budget-policy"),
    modelDeploymentRef: versionRef("model-deployment"),
    promptTemplateRef: versionRef("prompt-template"),
    maxCandidateMembers: 8,
    maxResupplements: 2,
    allowedSupplementIntentCodes: ["settlement", "support"],
    modelMaxOutputTokens: 1024,
  });

export const candidateSetValue = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  projectId: PROJECT,
  taskRef: taskRef(),
  nodeId: NODE_ID,
  inputSnapshotRef,
  workItemRef,
  relationshipQueryResultRef: {
    kind: "knowledge-query-result",
    reference: { entityId: "relationship-query-result:1", versionId: digestOf("relationship") },
  },
  baselineQueryResultRef: {
    kind: "knowledge-query-result",
    reference: { entityId: "retrieval-query-result:baseline", versionId: digestOf("baseline") },
  },
  baselineRequestDigest: digestOf("baseline-request"),
  generationRef: { kind: "retrieval-generation", reference: versionRef("retrieval-generation") },
  retrievalPolicyRef: versionRef("retrieval-policy"),
  reviewAgentPolicyRef: retrievalReviewPolicyRef,
  frozenQueryText: "变径空间扩挖 受力依赖",
  candidateVersion: 1,
  resupplements: [],
  members: [candidateMember()],
  frozenAuthorizationScopeDigest: "0".repeat(64),
  frozenAuthorizationContextRef: authorizationContextRef,
  frozenAt: TIMESTAMP,
  ...overrides,
});

export const taskSnapshot = (frozenInputRef?: ArtifactRefV1): AgentTaskSnapshotV1 => {
  const ref = taskRef();
  const envelope = AgentTaskEnvelopeV1Schema.parse({
    schemaVersion: "1",
    agentTaskRef: ref,
    commandId: "command-review-1",
    idempotencyKey: "review-1",
    taskType: "retrieval-review",
    triggerMode: "embedded",
    projectId: PROJECT,
    actorId: ACTOR,
    parentRunRef: { kind: "workflow-run", reference: versionRef("workflow-run") },
    frozenInputRef: frozenInputRef ?? {
      kind: "content-artifact",
      reference: { entityId: "candidate-set", versionId: `sha256:${"c".repeat(64)}` },
    },
    modelDeploymentRef: versionRef("model-deployment"),
    promptTemplateRef: versionRef("prompt-template"),
    toolPolicyRef: versionRef("tool-policy"),
    budgetPolicyRef: versionRef("budget-policy"),
    incrementSchemaRef: versionRef("increment-schema"),
    validationPolicyRef: versionRef("validation-policy"),
    authorization: authorization(),
    frozenAuthorization: {
      schemaVersion: "1",
      authorizationContextRef,
      projectId: PROJECT,
      actorId: ACTOR,
      grantedCapabilities: ["knowledge-modeling.retrieve"],
      spatialScopeRefs: [{ kind: "spatial-scope", reference: versionRef("spatial-scope") }],
      sourceAccessGrantRefs: [
        { kind: "source-access-grant", reference: versionRef("source-access-grant") },
      ],
      authorizationPolicyRef: versionRef("access-policy"),
      capturedAt: TIMESTAMP,
    },
    createdAt: TIMESTAMP,
  });
  return {
    envelope,
    state: {
      schemaVersion: "1",
      agentTaskRef: ref,
      status: "running",
      taskVersion: 2,
      cancelRequested: false,
      latestCandidateVersion: 0,
      updatedAt: TIMESTAMP,
    } as unknown as AgentTaskSnapshotV1["state"],
    budgetPolicy: reviewBudgetPolicy(),
    budgetLedger: {
      schemaVersion: "1",
      reserved: emptyAgentBudgetUsage(),
      used: emptyAgentBudgetUsage(),
      activeWallClockMs: 0,
      currentConcurrency: 0,
      ledgerVersion: 1,
      changedAt: TIMESTAMP,
    },
  };
};

export const reviewBudgetPolicy = () => ({
  schemaVersion: "1" as const,
  policyRef: versionRef("budget-policy"),
  modelDeploymentRef: versionRef("model-deployment"),
  promptTemplateRef: versionRef("prompt-template"),
  toolPolicyRef: versionRef("tool-policy"),
  maxModelInvocations: 4,
  maxToolInvocations: 8,
  maxContextTokens: 16_384,
  maxInputBytes: 512_000,
  maxOutputBytes: 128_000,
  maxCandidates: 4,
  maxObjects: 8,
  maxSupplementarySearches: 2,
  maxCorrections: 2,
  maxTransientRetries: 2,
  maxConcurrentActions: 1,
  maxWallClockMs: 600_000,
});

export interface ServiceHarnessOverrides {
  readonly verifyCurrent?: () => Promise<AuthorizationContextV1 | undefined>;
  readonly packages?: Readonly<Record<string, Record<string, unknown>>>;
  readonly retrievalResult?: unknown;
}

/** C21 核心服务的测试替身组合：只替身显式端口，不绕过任何资格。 */
export const makeServiceHarness = (overrides: ServiceHarnessOverrides = {}) => {
  const artifacts = new Map<string, Uint8Array>();
  const rows = new Map<string, Record<string, unknown>>();
  const auditRows: string[] = [];
  const packageReads: string[] = [];
  const inputReaderCalls: string[] = [];

  const putValue = async (artifactId: string, value: unknown): Promise<ArtifactRefV1> => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const artifactRef: ArtifactRefV1 = {
      kind: "content-artifact",
      reference: {
        entityId: artifactId,
        versionId: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      },
    };
    artifacts.set(artifactRef.reference.versionId, bytes);
    return artifactRef;
  };

  const artifactStore = {
    async put(command: { artifactId: string }, content: AsyncIterable<Uint8Array>) {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of content) {
        chunks.push(chunk);
        size += chunk.byteLength;
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const artifactRef = await putValue(
        command.artifactId,
        JSON.parse(new TextDecoder().decode(bytes)),
      );
      return {
        artifactRef,
        manifest: {},
        manifestSha256: "0".repeat(64),
        replayed: false,
        deduplicated: false,
      };
    },
    async open(request: { artifactRef: ArtifactRefV1 }) {
      const bytes = artifacts.get(request.artifactRef.reference.versionId);
      if (bytes === undefined) throw new Error("artifact-not-found");
      return {
        manifest: {},
        content: (async function* () {
          yield bytes;
        })(),
        verified: Promise.resolve({}),
      };
    },
  };

  const transactionUnit = {
    async execute(
      command: { commandId: string },
      handler: (
        context: unknown,
      ) => Promise<{ audit: { auditEntryId: string }; resultRef: unknown }>,
    ) {
      const commit = await handler({ transaction: "in-memory" });
      auditRows.push(commit.audit.auditEntryId);
      return {
        resultRef: commit.resultRef,
        auditEntryId: commit.audit.auditEntryId,
        eventRefs: [],
        replayed: false,
      };
    },
  };

  const resultStore: IdentificationContextResultStoreV1 = {
    async registerResult({ row }) {
      const key = `${row.resultKind}:${row.resultId}:${row.resultVersionId}`;
      const existing = rows.get(key) as { requestDigest?: string } | undefined;
      if (existing === undefined) {
        rows.set(key, row as unknown as Record<string, unknown>);
        return { kind: "registered", replayed: false };
      }
      return existing.requestDigest === row.requestDigest
        ? { kind: "registered", replayed: true }
        : { kind: "idempotency-conflict" };
    },
    async readResult({ projectId, resultKind, resultId }) {
      for (const row of rows.values()) {
        const typed = row as { projectId: string; resultKind: string; resultId: string };
        if (
          typed.projectId === projectId &&
          typed.resultKind === resultKind &&
          typed.resultId === resultId
        ) {
          return row as never;
        }
      }
      return undefined;
    },
    async readRelationshipResult({ projectId, queryId }) {
      for (const row of rows.values()) {
        const typed = row as { projectId: string; resultKind: string; queryId?: string };
        if (
          typed.projectId === projectId &&
          typed.resultKind === "relationship" &&
          typed.queryId === queryId
        ) {
          return row as never;
        }
      }
      return undefined;
    },
  };

  const payload = HybridRetrievalResultPayloadV1Schema.parse(hybridPayload());
  const ports = {
    inputReader: {
      async readExact(input: { workItemRef: typeof workItemRef; queryId: string }) {
        inputReaderCalls.push(input.queryId);
        return {
          kind: "succeeded" as const,
          read: {
            inputSnapshot: inputSnapshot(),
            workItem: {
              workItemRef: input.workItemRef,
              nodeId: NODE_ID,
              spatialScopeRefs: [{ kind: "spatial-scope", reference: versionRef("spatial-scope") }],
              sourceVersionRefs: [{ kind: "source-version", reference: versionRef("source-a") }],
              frozenQueryText: "变径空间扩挖 受力依赖",
            },
          },
        };
      },
    },
    authorization: {
      async issueReadContext() {
        return authorization({ grantedCapabilities: ["knowledge-modeling.read"] });
      },
      async verifyCurrent() {
        return await (overrides.verifyCurrent?.() ?? Promise.resolve(authorization()));
      },
    },
    officialHybrid: {
      async readOfficial(input: { queryId: string }) {
        const typed = HybridRetrievalResultPayloadV1Schema.parse({
          ...payload,
          queryId: input.queryId,
        });
        return {
          kind: "succeeded" as const,
          result: {
            requestDigest: typed.knowledgeQueryResultRef.reference.versionId,
            knowledgeQueryResultRef: typed.knowledgeQueryResultRef,
            resultArtifactRef: {
              kind: "content-artifact" as const,
              reference: { entityId: "hybrid-result", versionId: `sha256:${"d".repeat(64)}` },
            },
            payload: typed,
          },
        };
      },
    },
    retrievalService: {
      async retrieve() {
        return (
          overrides.retrievalResult ?? {
            kind: "succeeded",
            result: { knowledgeQueryResultRef: payload.knowledgeQueryResultRef },
          }
        );
      },
    },
    knowledgeReader: {
      async readExact(input: { releaseRef: { reference: VersionReference } }) {
        const entityId = input.releaseRef.reference.entityId;
        packageReads.push(entityId);
        const packages: Record<string, Record<string, unknown>> = {
          "release-process-model": processModelPackage(),
          "release-risk-mechanism": riskMechanismPackageValue(),
          "release-evidence-base": evidenceBasePackage(),
          "release-standard-library": standardLibraryPackage(),
          "release-case-library": standardLibraryPackage(),
          ...(overrides.packages ?? {}),
        };
        const packageValue = packages[entityId];
        if (packageValue === undefined) {
          return {
            kind: "failed" as const,
            error: ModuleErrorV1Schema.parse({
              stageCode: "identification-knowledge.read",
              occurredAt: TIMESTAMP,
              causalRunId: "c21-worker-test",
              code: "ENTITY_NOT_FOUND",
              category: "not-found",
              retryable: false,
              targetRef: { kind: "knowledge-release", reference: versionRef(entityId) },
            }),
          };
        }
        return {
          kind: "succeeded" as const,
          read: exactRead(
            packageValue,
            input.releaseRef,
            entityId === "release-evidence-base"
              ? [
                  releaseRef("release-risk-mechanism"),
                  releaseRef("release-standard-library"),
                  releaseRef("release-case-library"),
                ]
              : undefined,
          ),
        };
      },
    },
    hybridPolicy: {
      async resolveExact() {
        return HybridRetrievalPolicyV1Schema.parse(hybridPolicyValue());
      },
    },
    taskReader: {
      async getTask() {
        return undefined;
      },
    },
    inputReaderCalls,
    artifactStore,
    transactionUnit,
    resultStore,
    hybridStore: {
      async readQueryResult() {
        return undefined;
      },
    },
  };

  const service = new IdentificationContextService({
    inputReader: ports.inputReader as never,
    authorization: ports.authorization as never,
    resultStore,
    officialHybrid: ports.officialHybrid as never,
    retrievalService: ports.retrievalService as never,
    knowledgeReader: ports.knowledgeReader as never,
    hybridPolicy: ports.hybridPolicy as never,
    taskReader: ports.taskReader,
    artifactStore: artifactStore as never,
    transactionUnit: transactionUnit as never,
    reviewPolicy: reviewPolicy(),
    now: () => new Date(TIMESTAMP),
  });

  return { service, ports, rows, auditRows, artifacts, packageReads, payload, putValue };
};

export const candidateSetRefFor = async (
  harness: ReturnType<typeof makeServiceHarness>,
): Promise<ArtifactRefV1> =>
  await harness.putValue(
    `retrieval-review-candidate-set-${taskRef().reference.entityId}`,
    RetrievalReviewCandidateSetV1Schema.parse(candidateSetValue()),
  );
