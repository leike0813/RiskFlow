import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { VersionReference } from "@riskflow/contracts/common";
import {
  ModuleErrorV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  type AgentTaskRefV1,
  type AuthorizationContextV1,
  type KnowledgeRetrievalQueryV1,
} from "@riskflow/contracts/ports";
import { IdentificationInputSnapshotV1Schema } from "@riskflow/contracts/workflows";
import {
  AgentRuntimeError,
  AgentTaskEnvelopeV1Schema,
  buildCompletedAgentTaskResult,
  emptyAgentBudgetUsage,
  type AgentTaskSnapshotV1,
} from "../../src/agent-runtime/index.js";
import type { ArtifactRefV1 } from "../../src/artifacts/index.js";
import {
  IdentificationContextService,
  RelationshipContextPayloadV1Schema,
  RetrievalReviewCandidateSetV1Schema,
  RetrievalReviewPolicyV1Schema,
  ModelContextPayloadV1Schema,
  ReviewedRetrievalSetV1Schema,
  baselineQueryIdFor,
  relationshipQueryIdFor,
  resupplementQueryIdFor,
  type IdentificationContextResultStoreV1,
  type IdentificationContextResultRowV1,
  type IdentificationContextAuthorizationPortV1,
} from "../../src/identification/context/index.js";
import {
  HybridRetrievalPolicyV1Schema,
  HybridRetrievalResultPayloadV1Schema,
} from "../../src/retrieval/index.js";
import { authorizationScopeDigest } from "../../src/retrieval/service.js";

const TIMESTAMP = "2030-01-01T00:00:00.000Z";
const PROJECT = "project-c21";
const OTHER_PROJECT = "project-c21-other";
const ACTOR = "actor-c21";
const NODE_ID = "node-current";
const NEIGHBOR_ID = "node-neighbor";
const FORCE_NODE_ID = "node-force";
const SYNTHETIC_NOTICE = "合成样本、待甲方复核";

const versionRef = (entityId: string, versionId = "v1"): VersionReference => ({
  entityId,
  versionId,
});
const releaseRef = (entityId: string, versionId = "v1") => ({
  kind: "knowledge-release" as const,
  reference: versionRef(entityId, versionId),
});
const segmentEvidence = (sourceSegmentId: string, entityId = "source-a") => ({
  locator: { sourceSegmentId },
  sourceVersion: versionRef(entityId),
});
const authorizationContextRef = {
  kind: "authorization-context" as const,
  reference: versionRef("authorization-context-c21"),
};
const retrievalReviewPolicyRef = versionRef("retrieval-review-policy");

const inputSnapshotRef = {
  kind: "identification-input-snapshot" as const,
  reference: versionRef("input-snapshot-c21"),
};
const workItemRef = {
  kind: "identification-work-item" as const,
  reference: versionRef("work-item-c21"),
};

const processModelRelease = versionRef("release-process-model");
const riskMechanismRelease = versionRef("release-risk-mechanism");
const evidenceBaseRelease = versionRef("release-evidence-base");

const inputSnapshot = (overrides: Record<string, unknown> = {}) =>
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

const authorization = (overrides: Partial<AuthorizationContextV1> = {}): AuthorizationContextV1 =>
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
    invocation: { kind: "system", systemActorId: ACTOR, reasonCode: "c21-test" },
    causalRunRef: { kind: "workflow-run", reference: versionRef("workflow-run") },
    ...overrides,
  }) as AuthorizationContextV1;

const processModelPackage = (overrides: Record<string, unknown> = {}) => ({
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

const riskMechanismPackageValue = (overrides: Record<string, unknown> = {}) => ({
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
    {
      mechanismId: "mechanism-inapplicable",
      mechanismType: "渗流突涌",
      nodeIds: [NODE_ID],
      stateParameters: ["盾体直径"],
      monitoringIndicators: ["地下水位"],
      applicability: {
        constructionMethod: ["method-other"],
        stratumCondition: ["stratum-a"],
        engineeringStage: ["stage-a"],
      },
      preconditions: ["precondition-b"],
      triggeringFactors: ["trigger-b"],
      evolutionPath: ["path-b"],
      consequences: ["consequence-b"],
      evidence: [segmentEvidence("segment-mechanism-b")],
    },
  ],
  ...overrides,
});

const evidenceBasePackage = (overrides: Record<string, unknown> = {}) => ({
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

const standardLibraryPackage = (projectId = PROJECT) => ({
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

const exactRead = (
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

const digestOf = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(value) ?? "")
    .digest("hex");

const memberRef = (sourceEntryId: string, release: VersionReference) => ({
  kind: "retrieval-member" as const,
  reference: {
    entityId: `retrieval-member:${release.entityId}:${sourceEntryId}`,
    versionId: digestOf({ release, sourceEntryId }).slice(0, 32),
  },
});

const hybridPayload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  queryId: baselineQueryIdFor(NODE_ID, workItemRef),
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
  authorizationScopeDigest: authorizationScopeDigest(authorization()),
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
      entityId: `retrieval-query-result:${PROJECT}:${baselineQueryIdFor(NODE_ID, workItemRef)}`,
      versionId: digestOf("baseline"),
    },
  },
  ...overrides,
});

const candidateMember = (overrides: Record<string, unknown> = {}) => ({
  memberRef: memberRef("entry-standard", versionRef("release-standard-library")),
  sourceKind: "standard-library",
  sourceReleaseRef: releaseRef("release-standard-library"),
  sourceEntryId: "entry-standard",
  contentDigest: digestOf("standard-entry"),
  evidenceSourceVersionRefs: [versionRef("source-a")],
  evidence: [segmentEvidence("segment-standard")],
  origin: "baseline",
  originQueryResultRef: {
    kind: "knowledge-query-result",
    reference: { entityId: "retrieval-query-result:baseline", versionId: digestOf("baseline") },
  },
  rank: 1,
  fusionScore: 1,
  ...overrides,
});

const candidateSetValue = (overrides: Record<string, unknown> = {}) => ({
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
  frozenAuthorizationScopeDigest: authorizationScopeDigest(authorization()),
  frozenAuthorizationContextRef: authorizationContextRef,
  frozenAt: TIMESTAMP,
  ...overrides,
});

function taskRef(): AgentTaskRefV1 {
  return {
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
  };
}

const reviewPolicy = () =>
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
    budgetPolicy: taskSnapshot().budgetPolicy,
    maxResupplements: 2,
    allowedSupplementIntentCodes: ["settlement", "support"],
    modelMaxOutputTokens: 1024,
  });

const taskSnapshot = (candidateSetRef?: ArtifactRefV1): AgentTaskSnapshotV1 => {
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
    frozenInputRef: candidateSetRef ?? {
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
      status: "running",
      taskVersion: 1,
      cancelRequested: false,
      updatedAt: TIMESTAMP,
    } as AgentTaskSnapshotV1["state"],
    budgetPolicy: {
      schemaVersion: "1",
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
    },
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

interface HarnessOverrides {
  readonly inputReader?: Partial<Record<string, unknown>>;
  readonly workItemSourceVersionRefs?: readonly {
    readonly kind: "source-version";
    readonly reference: VersionReference;
  }[];
  readonly issueReadContext?: IdentificationContextAuthorizationPortV1["issueReadContext"];
  readonly verifyCurrent?: (input: {
    readonly requestedSourceVersionRefs: readonly { readonly reference: VersionReference }[];
  }) => Promise<AuthorizationContextV1 | undefined>;
  readonly packages?: Readonly<Record<string, Record<string, unknown>>>;
  readonly payload?: Record<string, unknown>;
  readonly retrievalResult?: unknown;
  readonly task?: AgentTaskSnapshotV1 | (() => AgentTaskSnapshotV1 | undefined) | undefined;
  readonly taskRef?: AgentTaskRefV1;
}

const makeHarness = (overrides: HarnessOverrides = {}) => {
  const artifacts = new Map<string, Uint8Array>();
  const artifactPurposes = new Map<string, string>();
  const rows = new Map<string, Record<string, unknown>>();
  const auditRows: string[] = [];
  const events: unknown[] = [];
  const packageReads: string[] = [];

  const artifactRefOf = (artifactId: string, bytes: Uint8Array) => ({
    kind: "content-artifact" as const,
    reference: {
      entityId: artifactId,
      versionId: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    },
  });

  const artifactStore = {
    async put(
      command: { artifactId: string; purposeCode: string },
      content: AsyncIterable<Uint8Array>,
    ) {
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
      const artifactRef = artifactRefOf(command.artifactId, bytes);
      artifacts.set(artifactRef.reference.versionId, bytes);
      artifactPurposes.set(artifactRef.reference.versionId, command.purposeCode);
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
      if (bytes === undefined)
        throw new Error(`artifact-not-found:${request.artifactRef.reference.entityId}`);
      return {
        manifest: {},
        content: (async function* () {
          yield bytes;
        })(),
        completed: Promise.resolve({}),
      };
    },
  };

  const transactionUnit = {
    async execute(
      command: { commandId: string },
      handler: (context: unknown) => Promise<{ audit: { auditEntryId: string } }>,
    ) {
      const commit = await handler({ transaction: "in-memory" });
      auditRows.push(commit.audit.auditEntryId);
      return {
        resultRef: (commit as { resultRef: unknown }).resultRef,
        auditEntryId: commit.audit.auditEntryId,
        eventRefs: [],
        replayed: false,
      };
    },
  };

  const resultStore: IdentificationContextResultStoreV1 = {
    async registerResult({ row }) {
      const key = `${row.resultKind}:${row.resultId}:${row.resultVersionId}`;
      const existing = rows.get(key);
      if (existing === undefined) {
        rows.set(key, row as unknown as Record<string, unknown>);
        return { kind: "registered", replayed: false };
      }
      return (existing as { requestDigest?: string }).requestDigest === row.requestDigest
        ? { kind: "registered", replayed: true }
        : { kind: "idempotency-conflict" };
    },
    async readResult(input) {
      for (const value of rows.values()) {
        const row = value as unknown as IdentificationContextResultRowV1;
        if (row.projectId !== input.projectId || row.resultKind !== input.resultKind) continue;
        const matched =
          "resultId" in input
            ? row.resultId === input.resultId
            : "agentTaskRef" in input
              ? row.resultKind === "reviewed-retrieval" &&
                JSON.stringify(row.agentTaskRef) === JSON.stringify(input.agentTaskRef)
              : row.resultKind !== "relationship" &&
                JSON.stringify(row.retrievalArtifactSetRef) ===
                  JSON.stringify(input.retrievalArtifactSetRef);
        if (matched) return row;
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

  const inputReader = {
    async readExact(input: { readonly workItemRef: typeof workItemRef }) {
      return {
        kind: "succeeded",
        read: {
          inputSnapshot: inputSnapshot(),
          workItem: {
            workItemRef: input.workItemRef,
            nodeId: NODE_ID,
            spatialScopeRefs: [{ kind: "spatial-scope", reference: versionRef("spatial-scope") }],
            sourceVersionRefs: overrides.workItemSourceVersionRefs ?? [
              { kind: "source-version", reference: versionRef("source-a") },
            ],
            frozenQueryText: "变径空间扩挖 受力依赖",
          },
        },
      };
    },
  };

  const authorizationPort = {
    async issueReadContext(
      input: Parameters<IdentificationContextAuthorizationPortV1["issueReadContext"]>[0],
    ) {
      return await (overrides.issueReadContext?.(input) ??
        Promise.resolve(
          authorization({ grantedCapabilities: [MODULE_BRANCH_CAPABILITY_V1[input.branch]] }),
        ));
    },
    async verifyCurrent(input: {
      readonly requestedSourceVersionRefs: readonly { readonly reference: VersionReference }[];
    }) {
      return await (overrides.verifyCurrent?.(input) ?? Promise.resolve(authorization()));
    },
  };

  const knowledgeReader = {
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
            causalRunId: "c21-test",
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
  };

  const payload = HybridRetrievalResultPayloadV1Schema.parse(overrides.payload ?? hybridPayload());
  const officialHybrid = {
    async readOfficial(input: { queryId: string }) {
      const typed = HybridRetrievalResultPayloadV1Schema.parse({
        ...payload,
        queryId: input.queryId,
        authorizationScopeDigest: authorizationScopeDigest(authorization()),
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
  };

  const retrievalCalls: unknown[] = [];
  const retrievalService = {
    async retrieve(query: unknown) {
      retrievalCalls.push(query);
      return (
        overrides.retrievalResult ?? {
          kind: "succeeded",
          result: { knowledgeQueryResultRef: payload.knowledgeQueryResultRef },
        }
      );
    },
  };

  const service = new IdentificationContextService({
    inputReader: (overrides.inputReader ?? inputReader) as never,
    authorization: authorizationPort as never,
    resultStore,
    officialHybrid: officialHybrid as never,
    retrievalService: retrievalService as never,
    knowledgeReader: knowledgeReader as never,
    hybridPolicy: {
      async resolveExact() {
        return HybridRetrievalPolicyV1Schema.parse(hybridPolicyValue());
      },
    } as never,
    taskReader: {
      async getTask() {
        return typeof overrides.task === "function" ? overrides.task() : overrides.task;
      },
    },
    artifactStore: artifactStore as never,
    transactionUnit: transactionUnit as never,
    reviewPolicy: reviewPolicy(),
    now: () => new Date(TIMESTAMP),
  });

  const putValue = async (artifactId: string, value: unknown): Promise<ArtifactRefV1> => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const artifactRef = artifactRefOf(artifactId, bytes);
    artifacts.set(artifactRef.reference.versionId, bytes);
    return artifactRef;
  };

  return {
    service,
    rows,
    auditRows,
    artifacts,
    artifactPurposes,
    packageReads,
    events,
    payload,
    putValue,
    retrievalCalls,
  };
};

const relationshipQuery = (overrides: Record<string, unknown> = {}) =>
  ({
    queryId: relationshipQueryIdFor(NODE_ID, workItemRef),
    projectId: PROJECT,
    actorId: ACTOR,
    requestedAt: TIMESTAMP,
    authorization: authorization(),
    kind: "relationship-context",
    payload: { inputSnapshotRef, workItemRef },
    ...overrides,
  }) as unknown as KnowledgeRetrievalQueryV1;

describe("C21 relationship-context and retrieval review", () => {
  it("uses the explicit task budget and rejects mismatched or insufficient policy bindings", () => {
    const harness = makeHarness();
    expect(harness.service.createTaskDefinition().budgetPolicy).toEqual(
      reviewPolicy().budgetPolicy,
    );
    const policy = reviewPolicy();
    for (const budgetPolicy of [
      undefined,
      { ...policy.budgetPolicy, policyRef: versionRef("another-budget") },
      { ...policy.budgetPolicy, modelDeploymentRef: versionRef("another-model") },
      { ...policy.budgetPolicy, maxObjects: policy.maxCandidateMembers - 1 },
      { ...policy.budgetPolicy, maxSupplementarySearches: policy.maxResupplements - 1 },
    ])
      expect(RetrievalReviewPolicyV1Schema.safeParse({ ...policy, budgetPolicy }).success).toBe(
        false,
      );
  });

  it.each(["equal", "broader", "partial"])(
    "reads exact one-hop relations with %s mechanism applicability",
    async (coverage) => {
      const process = processModelPackage();
      const mechanisms = riskMechanismPackageValue();
      if (coverage === "broader") {
        for (const dimension of [
          "constructionMethod",
          "stratumCondition",
          "engineeringStage",
        ] as const)
          mechanisms.mechanisms[0]!.applicability[dimension].push("additional-value");
      } else if (coverage === "partial") {
        process.nodes[0]!.applicability.engineeringStage.push("additional-stage");
      }
      const harness = makeHarness({
        packages: {
          "release-process-model": process,
          "release-risk-mechanism": mechanisms,
        },
      });
      const result = await harness.service.retrieve(relationshipQuery());
      expect(result.kind).toBe("succeeded");
      if (result.kind !== "succeeded") throw new Error("relationship query must succeed");
      expect(result.result.knowledgeQueryResultRef.reference.entityId).toBe(
        `relationship-query-result:${PROJECT}:${relationshipQueryIdFor(NODE_ID, workItemRef)}`,
      );
      expect(harness.packageReads).toEqual([
        "release-process-model",
        "release-risk-mechanism",
        "release-evidence-base",
      ]);
      const row = [...harness.rows.values()].find(
        (entry) => entry["resultKind"] === "relationship",
      );
      expect(row).toBeDefined();
      const stored = [...harness.artifacts.values()][0];
      const payload = RelationshipContextPayloadV1Schema.parse(
        JSON.parse(new TextDecoder().decode(stored)),
      );
      expect(payload.nodeId).toBe(NODE_ID);
      expect(payload.dependencyEdges.map((edge) => edge.relationType)).toEqual([
        "时间先后关系",
        "受力依赖关系",
      ]);
      expect(payload.neighborNodes.map((neighbor) => neighbor.upstream)).toEqual([true, true]);
      expect(payload.mechanisms.map((mechanism) => mechanism.mechanismId)).toEqual(
        coverage === "partial" ? [] : ["mechanism-applicable"],
      );
      expect(payload.excludedMechanisms.map((entry) => entry.mechanismId)).toEqual(
        coverage === "partial"
          ? ["mechanism-applicable", "mechanism-inapplicable"]
          : ["mechanism-inapplicable"],
      );
      expect(payload.releaseBinding.compositeMemberReleaseRefs).toHaveLength(3);
      expect(harness.auditRows).toHaveLength(1);
    },
  );

  it("closes broken relations, foreign projects and revoked authorization without partial results", async () => {
    const broken = makeHarness({
      packages: {
        "release-process-model": processModelPackage({
          dependencyEdges: [
            {
              edgeId: "edge-broken",
              fromNodeId: "node-missing",
              toNodeId: NODE_ID,
              relationType: "受力依赖关系",
              evidence: [segmentEvidence("segment-edge-broken")],
            },
          ],
        }),
      },
    });
    const brokenResult = await broken.service.retrieve(relationshipQuery());
    expect(brokenResult.kind).toBe("failed");
    if (brokenResult.kind === "failed") {
      expect(brokenResult.error.code).toBe("BUSINESS_BLOCKED");
      expect(brokenResult.error).toMatchObject({ blockerKind: "relationship-broken" });
    }
    expect(broken.rows.size).toBe(0);

    const foreign = makeHarness({
      packages: { "release-process-model": processModelPackage({ projectId: OTHER_PROJECT }) },
    });
    const foreignResult = await foreign.service.retrieve(relationshipQuery());
    expect(foreignResult.kind).toBe("failed");
    expect(foreign.rows.size).toBe(0);

    const revoked = makeHarness({ verifyCurrent: async () => undefined });
    const revokedResult = await revoked.service.retrieve(relationshipQuery());
    expect(revokedResult.kind).toBe("failed");
    if (revokedResult.kind === "failed") {
      expect(revokedResult.error.code).toBe("AUTHORIZATION_DENIED");
      expect(JSON.stringify(revokedResult.error)).not.toContain("mechanism-applicable");
    }
    expect(revoked.rows.size).toBe(0);
    expect(revoked.packageReads).toEqual([]);
  });

  it("replays the same queryId and rejects the same key with a different payload", async () => {
    const harness = makeHarness();
    const first = await harness.service.retrieve(relationshipQuery());
    const second = await harness.service.retrieve(relationshipQuery());
    expect(first).toEqual(second);
    expect(harness.rows.size).toBe(1);
    expect(harness.auditRows).toHaveLength(1);

    const conflicting = makeHarness();
    await conflicting.service.retrieve(relationshipQuery());
    const conflict = await conflicting.service.retrieve(
      relationshipQuery({
        payload: {
          inputSnapshotRef,
          workItemRef: {
            kind: "identification-work-item",
            reference: versionRef("work-item-other"),
          },
        },
      }),
    );
    expect(conflict.kind).toBe("failed");
    if (conflict.kind === "failed") expect(conflict.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(conflicting.rows.size).toBe(1);

    let accessRevoked = false;
    const revokedReplay = makeHarness({
      verifyCurrent: async () => (accessRevoked ? undefined : authorization()),
    });
    expect((await revokedReplay.service.retrieve(relationshipQuery())).kind).toBe("succeeded");
    accessRevoked = true;
    const replay = await revokedReplay.service.retrieve(relationshipQuery());
    expect(replay.kind).toBe("failed");
    if (replay.kind === "failed") expect(replay.error.code).toBe("AUTHORIZATION_DENIED");
    expect(revokedReplay.rows.size).toBe(1);
    expect(revokedReplay.auditRows).toHaveLength(1);
  });

  it("registers the retrieval-review definition inside the shared C08 registry shape", () => {
    const { service } = makeHarness();
    const definition = service.createTaskDefinition();
    expect(definition.metadata.taskType).toBe("retrieval-review");
    expect(definition.metadata.allowedToolRefs).toEqual([
      versionRef("tool-read-frozen"),
      versionRef("tool-resupplement"),
    ]);
    expect(definition.metadata.resultFamilies).toEqual(["retrieval-artifact-set"]);
    expect(definition.metadata.toolPolicyRef).toEqual(definition.budgetPolicy.toolPolicyRef);
    expect(definition.tools.map((tool) => tool.toolRef)).toEqual([
      versionRef("tool-read-frozen"),
      versionRef("tool-resupplement"),
    ]);
  });

  it("accepts only frozen candidates and frozen evidence, and treats revocation as terminal", async () => {
    const harness = makeHarness();
    const candidateSet = RetrievalReviewCandidateSetV1Schema.parse(candidateSetValue());
    const artifactRef = await harness.putValue(
      `retrieval-review-candidate-set-${taskRef().reference.entityId}`,
      candidateSet,
    );
    const task = taskSnapshot(artifactRef);

    const accepted = await harness.service.validateReviewIncrement({
      task,
      candidate: {
        schemaVersion: "1",
        candidateVersion: 1,
        candidateSetRef: artifactRef,
        operations: [
          {
            operation: "select",
            memberRef: candidateSet.members[0]!.memberRef,
            evidence: [segmentEvidence("segment-standard")],
            rationaleCode: "supporting-standard",
          },
        ],
      },
    });
    expect(accepted.disposition).toBe("accepted");

    const staleVersion = await harness.service.validateReviewIncrement({
      task,
      candidate: {
        schemaVersion: "1",
        candidateVersion: 2,
        candidateSetRef: artifactRef,
        operations: [
          {
            operation: "select",
            memberRef: candidateSet.members[0]!.memberRef,
            evidence: [segmentEvidence("segment-standard")],
            rationaleCode: "supporting-standard",
          },
        ],
      },
    });
    expect(staleVersion).toMatchObject({ disposition: "rejected", rejectionClass: "terminal" });
    expect(staleVersion.items).toContainEqual(
      expect.objectContaining({ checkId: "retrieval-review.candidate-set-binding" }),
    );

    const outsideMember = await harness.service.validateReviewIncrement({
      task,
      candidate: {
        schemaVersion: "1",
        candidateVersion: 1,
        candidateSetRef: artifactRef,
        operations: [
          {
            operation: "select",
            memberRef: memberRef("entry-unknown", versionRef("release-standard-library")),
            evidence: [segmentEvidence("segment-standard")],
            rationaleCode: "supporting-standard",
          },
        ],
      },
    });
    expect(outsideMember.disposition).toBe("rejected");
    expect(outsideMember.rejectionClass).toBe("terminal");
    expect(outsideMember.items).toContainEqual(
      expect.objectContaining({
        checkId: "retrieval-review.candidate-membership",
        reasonCode: "candidate-not-frozen",
      }),
    );

    const outsideEvidence = await harness.service.validateReviewIncrement({
      task,
      candidate: {
        schemaVersion: "1",
        candidateVersion: 1,
        candidateSetRef: artifactRef,
        operations: [
          {
            operation: "select",
            memberRef: candidateSet.members[0]!.memberRef,
            evidence: [segmentEvidence("segment-free-text")],
            rationaleCode: "supporting-standard",
          },
        ],
      },
    });
    expect(outsideEvidence.rejectionClass).toBe("terminal");
    expect(outsideEvidence.items).toContainEqual(
      expect.objectContaining({
        checkId: "retrieval-review.evidence-reachability",
        reasonCode: "evidence-not-frozen",
      }),
    );

    const revoked = makeHarness({ verifyCurrent: async () => undefined });
    const revokedRef = await revoked.putValue(
      `retrieval-review-candidate-set-${taskRef().reference.entityId}`,
      candidateSet,
    );
    const revokedOutcome = await revoked.service.validateReviewIncrement({
      task: taskSnapshot(revokedRef),
      candidate: {
        schemaVersion: "1",
        candidateVersion: 1,
        candidateSetRef: revokedRef,
        operations: [
          {
            operation: "select",
            memberRef: candidateSet.members[0]!.memberRef,
            evidence: [segmentEvidence("segment-standard")],
            rationaleCode: "supporting-standard",
          },
        ],
      },
    });
    expect(revokedOutcome.disposition).toBe("rejected");
    expect(revokedOutcome.rejectionClass).toBe("terminal");
    expect(revokedOutcome.items).toContainEqual(
      expect.objectContaining({
        checkId: "retrieval-review.current-authorization",
        reasonCode: "authorization-revoked",
      }),
    );

    const outOfScope = makeHarness({
      workItemSourceVersionRefs: [{ kind: "source-version", reference: versionRef("source-b") }],
      verifyCurrent: async ({ requestedSourceVersionRefs }) =>
        requestedSourceVersionRefs.some((ref) => ref.reference.entityId === "source-b")
          ? undefined
          : authorization(),
    });
    const outOfScopeRef = await outOfScope.putValue("out-of-scope-candidate-set", candidateSet);
    const outOfScopeOutcome = await outOfScope.service.validateReviewIncrement({
      task: taskSnapshot(outOfScopeRef),
      candidate: {
        schemaVersion: "1",
        candidateVersion: 1,
        candidateSetRef: outOfScopeRef,
        operations: [
          {
            operation: "select",
            memberRef: candidateSet.members[0]!.memberRef,
            evidence: [segmentEvidence("segment-standard")],
            rationaleCode: "supporting-standard",
          },
        ],
      },
    });
    expect(outOfScopeOutcome).toMatchObject({
      disposition: "rejected",
      rejectionClass: "terminal",
    });
    expect(outOfScope.rows.size).toBe(0);
    expect(outOfScope.auditRows).toHaveLength(0);
  });

  it("loads exact knowledge and rejects foreign observations or revoked model input", async () => {
    let revoked = false;
    const harness = makeHarness({
      verifyCurrent: async () => (revoked ? undefined : authorization()),
    });
    const set = RetrievalReviewCandidateSetV1Schema.parse(candidateSetValue());
    const candidateSetRef = await harness.putValue("model-input-candidates", set);
    const task = taskSnapshot(candidateSetRef);
    const modelInput = await harness.service.readReviewModelInput(task);
    expect(modelInput.candidateSet.members[0]?.entry).toEqual(standardLibraryPackage().entries[0]);
    const validation = await harness.service.validateReviewIncrement({
      task,
      candidate: {
        schemaVersion: "1",
        candidateVersion: 1,
        candidateSetRef,
        operations: [
          {
            operation: "select",
            memberRef: set.members[0]!.memberRef,
            evidence: set.members[0]!.evidence,
            rationaleCode: "supporting-standard",
          },
        ],
      },
    });
    const afterValidation = await harness.service.readReviewModelInput(
      task,
      validation.validationArtifactRef,
    );
    expect(harness.artifactPurposes.get(validation.validationArtifactRef.reference.versionId)).toBe(
      "agent-validation",
    );
    expect(afterValidation.candidateSetRef).toEqual(candidateSetRef);
    expect(afterValidation.previousObservation?.kind).toBe("validation");
    const observationRef = await harness.putValue("foreign-model-observation", {
      kind: "retrieval-result",
      schemaVersion: "1",
      taskRef: { ...task.envelope.agentTaskRef, reference: versionRef("another-task") },
      candidateSetRef,
      candidateVersion: set.candidateVersion,
      queryResultRef: set.baselineQueryResultRef,
      members: set.members,
      resupplements: [],
    });
    await expect(harness.service.readReviewModelInput(task, observationRef)).rejects.toMatchObject({
      details: { code: "AGENT_INPUT_INVALID" },
    });
    revoked = true;
    await expect(harness.service.readReviewModelInput(task)).rejects.toMatchObject({
      details: { code: "AGENT_AUTHORIZATION_DENIED" },
    });
  });

  it("pairs candidate input reads with the issued validation action", async () => {
    let issuedInvocationId: string | undefined;
    const harness = makeHarness({
      issueReadContext: async (input) => {
        issuedInvocationId = input.invocationId;
        return authorization({ grantedCapabilities: [MODULE_BRANCH_CAPABILITY_V1[input.branch]] });
      },
      inputReader: {
        async readExact(input: { queryId: string; workItemRef: typeof workItemRef }) {
          if (input.queryId !== issuedInvocationId) return { kind: "failed" };
          return {
            kind: "succeeded",
            read: {
              inputSnapshot: inputSnapshot(),
              workItem: {
                workItemRef: input.workItemRef,
                nodeId: NODE_ID,
                spatialScopeRefs: [
                  { kind: "spatial-scope", reference: versionRef("spatial-scope") },
                ],
                sourceVersionRefs: [{ kind: "source-version", reference: versionRef("source-a") }],
                frozenQueryText: "变径空间扩挖 受力依赖",
              },
            },
          };
        },
      },
    });
    const candidateSet = RetrievalReviewCandidateSetV1Schema.parse(candidateSetValue());
    const candidateSetRef = await harness.putValue("candidate-set-action-binding", candidateSet);
    const task = taskSnapshot(candidateSetRef);
    await expect(
      harness.service.readFrozenResult(
        {
          kind: "read-frozen-result",
          candidateSetRef,
          queryResultRef: candidateSet.baselineQueryResultRef,
          maxMembers: 1,
        },
        { task, taskRef: task.envelope.agentTaskRef, actionId: "bound-read" },
      ),
    ).resolves.toBeDefined();
  });

  it("rechecks current authorization after validation before tool reads and formal finalization", async () => {
    let revoked = false;
    const harness = makeHarness({
      verifyCurrent: async () => (revoked ? undefined : authorization()),
    });
    const candidateSet = RetrievalReviewCandidateSetV1Schema.parse(candidateSetValue());
    const candidateSetRef = await harness.putValue("candidate-set-revocation-race", candidateSet);
    const task = taskSnapshot(candidateSetRef);
    const candidate = {
      schemaVersion: "1",
      candidateVersion: 1,
      candidateSetRef,
      operations: [
        {
          operation: "select",
          memberRef: candidateSet.members[0]!.memberRef,
          evidence: [segmentEvidence("segment-standard")],
          rationaleCode: "supporting-standard",
        },
      ],
    };
    expect((await harness.service.validateReviewIncrement({ task, candidate })).disposition).toBe(
      "accepted",
    );
    revoked = true;
    await expect(
      harness.service.readFrozenResult(
        {
          kind: "read-frozen-result",
          candidateSetRef,
          queryResultRef: candidateSet.baselineQueryResultRef,
          maxMembers: 1,
        },
        { task, taskRef: task.envelope.agentTaskRef, actionId: "revoked-read" },
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_AUTHORIZATION_DENIED" } });
    await expect(
      harness.service.boundedHybridResupplement(
        {
          kind: "bounded-hybrid-resupplement",
          candidateSetRef,
          supplementIntentCode: "settlement",
          anchorEntryIds: ["entry-standard"],
        },
        { task, taskRef: task.envelope.agentTaskRef, actionId: "revoked-supplement" },
      ),
    ).rejects.toMatchObject({ details: { code: "AGENT_AUTHORIZATION_DENIED" } });
    await expect(
      harness.service.finalizeRetrievalReview({ task, candidate }),
    ).rejects.toMatchObject({ details: { code: "AGENT_AUTHORIZATION_DENIED" } });
    expect(harness.retrievalCalls).toHaveLength(0);
    expect(harness.rows.size).toBe(0);
    expect(harness.auditRows).toHaveLength(0);
  });

  it("assembles the five-item context only when every group is present", async () => {
    const taskRefValue = taskRef();
    const completed: { current?: AgentTaskSnapshotV1 } = {};
    let readable = true;
    const harness = makeHarness({
      task: () => completed.current,
      verifyCurrent: async () => (readable ? authorization() : undefined),
    });
    const candidateSetRef = await harness.putValue(
      `retrieval-review-candidate-set-${taskRefValue.reference.entityId}`,
      RetrievalReviewCandidateSetV1Schema.parse(candidateSetValue()),
    );
    const reviewedRef = await seedReviewedSet(harness, taskRefValue);
    completed.current = completedTaskSnapshot(taskRefValue, reviewedRef.retrievalArtifactSetRef);
    await harness.service.retrieve(relationshipQuery());

    const readInput = {
      projectId: PROJECT,
      actorId: ACTOR,
      requestedAt: TIMESTAMP,
      workItemRef,
      retrievalArtifactSetRef: reviewedRef.retrievalArtifactSetRef,
      authorization: authorization(),
    };
    expect(await harness.service.modelContextReader.readExact(readInput)).toMatchObject({
      kind: "failed",
      code: "ENTITY_NOT_FOUND",
    });
    const assembled = await harness.service.assembleContext({
      projectId: PROJECT,
      actorId: ACTOR,
      reviewTaskRef: taskRefValue,
      inputSnapshotRef,
      workItemRef,
      authorization: authorization(),
    });
    expect(assembled.modelContextArtifactSetRef.reference.entityId).toMatch(/^[0-9a-f-]{36}$/);
    const modelContext = ModelContextPayloadV1Schema.parse(assembled.payload);
    expect(modelContext.forceDependencies).toHaveLength(1);
    expect(modelContext.mechanisms.map((mechanism) => mechanism.mechanismId)).toEqual([
      "mechanism-applicable",
    ]);
    expect(modelContext.retrievalEvidence).toHaveLength(1);
    expect(modelContext.retrievalEvidence[0]!.rankingSignal.scoreSemantics).toBe(
      "ranking-signal-not-confidence",
    );
    expect(modelContext.retrievalArtifactSetRef).toEqual(reviewedRef.retrievalArtifactSetRef);
    expect([...harness.rows.values()].some((row) => row["resultKind"] === "model-context")).toBe(
      true,
    );
    const factsBeforeRead = [harness.rows.size, harness.artifacts.size, harness.auditRows.length];
    expect(await harness.service.modelContextReader.readExact(readInput)).toMatchObject({
      kind: "succeeded",
      read: {
        payload: assembled.payload,
        modelContextArtifactSetRef: assembled.modelContextArtifactSetRef,
      },
    });
    for (const [changed, code] of [
      [
        {
          ...readInput,
          retrievalArtifactSetRef: {
            ...readInput.retrievalArtifactSetRef,
            reference: {
              ...readInput.retrievalArtifactSetRef.reference,
              versionId: "wrong-version",
            },
          },
        },
        "ENTITY_NOT_FOUND",
      ],
      [
        { ...readInput, workItemRef: { ...workItemRef, reference: versionRef("wrong-work-item") } },
        "SOURCE_FACT_DRIFT",
      ],
    ] as const)
      expect(await harness.service.modelContextReader.readExact(changed)).toMatchObject({
        kind: "failed",
        code,
      });
    expect(
      await harness.service.modelContextReader.readExact({
        ...readInput,
        actorId: "another-actor",
      }),
    ).toMatchObject({ kind: "failed", code: "AUTHORIZATION_DENIED" });
    readable = false;
    expect(await harness.service.modelContextReader.readExact(readInput)).toMatchObject({
      kind: "failed",
      code: "AUTHORIZATION_DENIED",
    });
    expect([harness.rows.size, harness.artifacts.size, harness.auditRows.length]).toEqual(
      factsBeforeRead,
    );
    void candidateSetRef;

    const missingForceReviewed: { current?: AgentTaskSnapshotV1 } = {};
    const missingForce = makeHarness({
      task: () => missingForceReviewed.current,
      packages: {
        "release-process-model": processModelPackage({
          dependencyEdges: [
            {
              edgeId: "edge-time",
              fromNodeId: NEIGHBOR_ID,
              toNodeId: NODE_ID,
              relationType: "时间先后关系",
              evidence: [segmentEvidence("segment-edge-time")],
            },
          ],
        }),
      },
    });
    missingForceReviewed.current = completedTaskSnapshot(
      taskRefValue,
      (await seedReviewedSet(missingForce, taskRefValue)).retrievalArtifactSetRef,
    );
    await missingForce.service.retrieve(relationshipQuery());
    await expect(
      missingForce.service.assembleContext({
        projectId: PROJECT,
        actorId: ACTOR,
        reviewTaskRef: taskRefValue,
        inputSnapshotRef,
        workItemRef,
        authorization: authorization(),
      }),
    ).rejects.toMatchObject({
      details: { code: "BUSINESS_BLOCKED", blockerKind: "force-dependency-missing" },
    });
    expect(
      [...missingForce.rows.values()].some((row) => row["resultKind"] === "model-context"),
    ).toBe(false);

    const missingStateReviewed: { current?: AgentTaskSnapshotV1 } = {};
    const missingState = makeHarness({
      task: () => missingStateReviewed.current,
      packages: {
        "release-process-model": processModelPackage({
          nodes: processModelPackage().nodes.map((node) =>
            node.nodeId === NODE_ID ? { ...node, stateParameters: [] } : node,
          ),
        }),
      },
    });
    missingStateReviewed.current = completedTaskSnapshot(
      taskRefValue,
      (await seedReviewedSet(missingState, taskRefValue)).retrievalArtifactSetRef,
    );
    await expect(
      missingState.service.assembleContext({
        projectId: PROJECT,
        actorId: ACTOR,
        reviewTaskRef: taskRefValue,
        inputSnapshotRef,
        workItemRef,
        authorization: authorization(),
      }),
    ).rejects.toMatchObject({
      details: { code: "BUSINESS_BLOCKED", blockerKind: "state-parameters-missing" },
    });
    expect(
      [...missingState.rows.values()].some((row) => row["resultKind"] === "model-context"),
    ).toBe(false);

    const missingMechanismReviewed: { current?: AgentTaskSnapshotV1 } = {};
    const missingMechanism = makeHarness({
      task: () => missingMechanismReviewed.current,
      packages: {
        "release-risk-mechanism": riskMechanismPackageValue({
          mechanisms: [
            {
              mechanismId: "mechanism-unrelated",
              mechanismType: "渗流突涌",
              nodeIds: ["node-other"],
              stateParameters: ["盾体直径"],
              monitoringIndicators: ["地下水位"],
              applicability: {
                constructionMethod: ["method-a"],
                stratumCondition: ["stratum-a"],
                engineeringStage: ["stage-a"],
              },
              preconditions: ["precondition-b"],
              triggeringFactors: ["trigger-b"],
              evolutionPath: ["path-b"],
              consequences: ["consequence-b"],
              evidence: [segmentEvidence("segment-mechanism-b")],
            },
          ],
        }),
      },
    });
    missingMechanismReviewed.current = completedTaskSnapshot(
      taskRefValue,
      (await seedReviewedSet(missingMechanism, taskRefValue)).retrievalArtifactSetRef,
    );
    await missingMechanism.service.retrieve(relationshipQuery());
    await expect(
      missingMechanism.service.assembleContext({
        projectId: PROJECT,
        actorId: ACTOR,
        reviewTaskRef: taskRefValue,
        inputSnapshotRef,
        workItemRef,
        authorization: authorization(),
      }),
    ).rejects.toMatchObject({
      details: { code: "BUSINESS_BLOCKED", blockerKind: "mechanism-missing" },
    });

    const missingReview = makeHarness();
    await missingReview.service.retrieve(relationshipQuery());
    await expect(
      missingReview.service.assembleContext({
        projectId: PROJECT,
        actorId: ACTOR,
        reviewTaskRef: taskRefValue,
        inputSnapshotRef,
        workItemRef,
        authorization: authorization(),
      }),
    ).rejects.toMatchObject({
      details: { code: "BUSINESS_BLOCKED", blockerKind: "reviewed-retrieval-missing" },
    });
  });

  it("rejects a reviewed set from another frozen input without registering context", async () => {
    const taskRefValue = taskRef();
    const completed: { current?: AgentTaskSnapshotV1 } = {};
    const harness = makeHarness({ task: () => completed.current });
    const reviewed = await seedReviewedSet(harness, taskRefValue, {
      workItemRef: {
        kind: "identification-work-item",
        reference: versionRef("work-item-other"),
      },
    });
    completed.current = completedTaskSnapshot(taskRefValue, reviewed.retrievalArtifactSetRef);
    const before = harness.auditRows.length;
    await expect(
      harness.service.assembleContext({
        projectId: PROJECT,
        actorId: ACTOR,
        reviewTaskRef: taskRefValue,
        inputSnapshotRef,
        workItemRef,
        authorization: authorization(),
      }),
    ).rejects.toMatchObject({ details: { blockerKind: "context-source-mismatch" } });
    expect(harness.auditRows).toHaveLength(before);
    expect([...harness.rows.values()].some((row) => row["resultKind"] === "model-context")).toBe(
      false,
    );

    const releaseTask: { current?: AgentTaskSnapshotV1 } = {};
    const mismatchedRelease = makeHarness({
      task: () => releaseTask.current,
      payload: hybridPayload({
        memberReleaseRefs: {
          riskMechanismRef: releaseRef("release-risk-mechanism"),
          standardLibraryRef: releaseRef("release-standard-library-other"),
          caseLibraryRef: releaseRef("release-case-library"),
        },
      }),
    });
    const releaseReviewed = await seedReviewedSet(mismatchedRelease, taskRefValue);
    releaseTask.current = completedTaskSnapshot(
      taskRefValue,
      releaseReviewed.retrievalArtifactSetRef,
    );
    const releaseAudits = mismatchedRelease.auditRows.length;
    await expect(
      mismatchedRelease.service.assembleContext({
        projectId: PROJECT,
        actorId: ACTOR,
        reviewTaskRef: taskRefValue,
        inputSnapshotRef,
        workItemRef,
        authorization: authorization(),
      }),
    ).rejects.toMatchObject({ details: { blockerKind: "context-source-mismatch" } });
    expect(mismatchedRelease.auditRows).toHaveLength(releaseAudits);
    expect(
      [...mismatchedRelease.rows.values()].some((row) => row["resultKind"] === "model-context"),
    ).toBe(false);
  });

  it("keeps two reviews of the same work item as separate immutable contexts", async () => {
    const completed: { current?: AgentTaskSnapshotV1 } = {};
    const harness = makeHarness({ task: () => completed.current });
    const firstTask = taskRef();
    const secondTask = {
      ...taskRef(),
      reference: versionRef("agent-task:project-c21:review-2"),
    };
    const firstReviewed = await seedReviewedSet(harness, firstTask);
    completed.current = completedTaskSnapshot(firstTask, firstReviewed.retrievalArtifactSetRef);
    const first = await harness.service.assembleContext({
      projectId: PROJECT,
      actorId: ACTOR,
      reviewTaskRef: firstTask,
      inputSnapshotRef,
      workItemRef,
      authorization: authorization(),
    });
    const auditsAfterFirst = harness.auditRows.length;
    const replay = await harness.service.assembleContext({
      projectId: PROJECT,
      actorId: ACTOR,
      reviewTaskRef: firstTask,
      inputSnapshotRef,
      workItemRef,
      authorization: authorization(),
    });
    expect(replay.modelContextArtifactSetRef).toEqual(first.modelContextArtifactSetRef);
    expect(harness.auditRows).toHaveLength(auditsAfterFirst);
    const secondReviewed = await seedReviewedSet(harness, secondTask);
    completed.current = completedTaskSnapshot(secondTask, secondReviewed.retrievalArtifactSetRef);
    const second = await harness.service.assembleContext({
      projectId: PROJECT,
      actorId: ACTOR,
      reviewTaskRef: secondTask,
      inputSnapshotRef,
      workItemRef,
      authorization: authorization(),
    });
    expect(first.modelContextArtifactSetRef.reference.entityId).not.toBe(
      second.modelContextArtifactSetRef.reference.entityId,
    );
    expect(
      [...harness.rows.values()].filter((row) => row["resultKind"] === "model-context"),
    ).toHaveLength(2);
  });

  it("freezes the official baseline with a stable queryId and writes candidate set v1", async () => {
    const issued: Parameters<IdentificationContextAuthorizationPortV1["issueReadContext"]>[0][] =
      [];
    const harness = makeHarness({
      issueReadContext: async (input) => {
        issued.push(input);
        return authorization({ grantedCapabilities: [MODULE_BRANCH_CAPABILITY_V1[input.branch]] });
      },
    });
    const prepared = await harness.service.prepareReview({
      projectId: PROJECT,
      actorId: ACTOR,
      requestedAt: TIMESTAMP,
      taskRef: taskRef(),
      inputSnapshotRef,
      workItemRef,
      authorization: authorization(),
    });
    const baselineQuery = harness.retrievalCalls[0] as {
      readonly queryId: string;
      readonly kind: string;
    };
    expect(baselineQuery.queryId).toBe(baselineQueryIdFor(NODE_ID, workItemRef));
    expect(baselineQuery.kind).toBe("hybrid-evidence");
    expect(prepared.candidateSet.candidateVersion).toBe(1);
    expect(prepared.candidateSet.resupplements).toEqual([]);
    expect(prepared.candidateSet.baselineQueryResultRef).toEqual(prepared.baselineQueryResultRef);
    expect(prepared.candidateSet.members).toHaveLength(1);
    expect(prepared.candidateSet.members[0]!.sourceEntryId).toBe("entry-standard");
    expect(prepared.candidateSet.members[0]!.evidence).toEqual([
      segmentEvidence("segment-standard"),
    ]);
    expect(prepared.candidateSet.frozenQueryText).toBe("变径空间扩挖 受力依赖");
    expect(
      issued.some(
        (input) =>
          input.branch === "knowledge-modeling.hybrid-evidence" &&
          input.invocationId === baselineQuery.queryId,
      ),
    ).toBe(true);
    expect(
      issued.every(
        (input) =>
          authorizationScopeDigest(input.authorization) ===
          authorizationScopeDigest(authorization()),
      ),
    ).toBe(true);
    // 关系结果与基线一起被冻结：同一工作项只对应一个正式关系结果。
    expect([...harness.rows.values()].some((row) => row["resultKind"] === "relationship")).toBe(
      true,
    );
  });

  it("rejects an official hybrid result owned by another actor", async () => {
    const harness = makeHarness({ payload: hybridPayload({ actorId: "other-actor" }) });
    await expect(
      harness.service.readOfficialHybrid({
        projectId: PROJECT,
        actorId: ACTOR,
        requestedAt: TIMESTAMP,
        queryId: baselineQueryIdFor(NODE_ID, workItemRef),
        authorization: authorization(),
      }),
    ).rejects.toMatchObject({ details: { code: "BUSINESS_BLOCKED" } });
  });

  it("rejects review preparation outside the exact work item source scope before side effects", async () => {
    const harness = makeHarness({
      workItemSourceVersionRefs: [{ kind: "source-version", reference: versionRef("source-b") }],
      verifyCurrent: async ({ requestedSourceVersionRefs }) =>
        requestedSourceVersionRefs.some((ref) => ref.reference.entityId === "source-b")
          ? undefined
          : authorization(),
    });
    await expect(
      harness.service.prepareReview({
        projectId: PROJECT,
        actorId: ACTOR,
        requestedAt: TIMESTAMP,
        taskRef: taskRef(),
        inputSnapshotRef,
        workItemRef,
        authorization: authorization(),
      }),
    ).rejects.toMatchObject({ details: { code: "AUTHORIZATION_DENIED" } });
    expect(harness.rows.size).toBe(0);
    expect(harness.artifacts.size).toBe(0);
    expect(harness.auditRows).toHaveLength(0);
  });

  it("extends the frozen candidate version through one bounded resupplement", async () => {
    const harness = makeHarness();
    const candidateSetRef = await harness.putValue(
      `retrieval-review-candidate-set-${taskRef().reference.entityId}`,
      RetrievalReviewCandidateSetV1Schema.parse(candidateSetValue()),
    );
    const task = taskSnapshot(candidateSetRef);
    const definition = harness.service.createTaskDefinition();
    const tool = definition.tools.find((entry) => entry.toolRef.entityId === "tool-resupplement");
    if (tool === undefined) throw new Error("resupplement tool must be registered");
    const outcome = await tool.execute(
      {
        kind: "bounded-hybrid-resupplement",
        candidateSetRef,
        supplementIntentCode: "settlement",
        anchorEntryIds: ["entry-standard"],
      },
      { task, taskRef: task.envelope.agentTaskRef, actionId: "action-resupplement-1" },
    );
    expect(outcome.effect).toBe("committed");
    expect(outcome.resultRef).toMatchObject({ kind: "content-artifact" });
    expect(outcome.usage).toMatchObject({ supplementarySearches: 1 });
    if (outcome.resultRef?.kind !== "content-artifact")
      throw new Error("candidate reference required");
    const nextSet = RetrievalReviewCandidateSetV1Schema.parse(
      JSON.parse(
        new TextDecoder().decode(harness.artifacts.get(outcome.resultRef.reference.versionId)!),
      ),
    );
    expect(nextSet.candidateVersion).toBe(2);
    expect(nextSet.parentCandidateSetRef).toEqual(candidateSetRef);
    expect(nextSet.resupplements).toHaveLength(1);
    expect(nextSet.resupplements[0]!.queryId).toBe(
      resupplementQueryIdFor(taskRef().reference.entityId, "action-resupplement-1"),
    );
    const modelInput = await harness.service.readReviewModelInput(
      task,
      outcome.observationArtifactRef,
    );
    expect(modelInput.candidateSetRef.reference).toEqual(outcome.resultRef.reference);
    expect(modelInput.candidateSet.candidateVersion).toBe(2);
    expect(modelInput.candidateSet.members[0]?.entry).toBeDefined();

    await expect(
      tool.execute(
        {
          kind: "bounded-hybrid-resupplement",
          candidateSetRef,
          supplementIntentCode: "not-allowed-intent",
          anchorEntryIds: ["entry-standard"],
        },
        { task, taskRef: task.envelope.agentTaskRef, actionId: "action-resupplement-2" },
      ),
    ).rejects.toBeInstanceOf(AgentRuntimeError);
  });

  it("resolves the frozen query text for baseline ids and refuses unknown resupplement ids", async () => {
    const harness = makeHarness();
    const baseline = await harness.service.queryInputReader.readExact({
      refs: {
        inputSnapshotRef,
        workItemRef,
        retrievalPolicyRef: versionRef("retrieval-policy"),
      },
      projectId: PROJECT,
      queryId: baselineQueryIdFor(NODE_ID, workItemRef),
      actorId: ACTOR,
      requestedAt: TIMESTAMP,
      authorization: authorization(),
    });
    expect(baseline.kind).toBe("succeeded");
    if (baseline.kind !== "succeeded") throw new Error("baseline read must succeed");
    expect(baseline.input.queryText).toBe("变径空间扩挖 受力依赖");

    const unknownResupplement = await harness.service.queryInputReader.readExact({
      refs: {
        inputSnapshotRef,
        workItemRef,
        retrievalPolicyRef: versionRef("retrieval-policy"),
      },
      projectId: PROJECT,
      queryId: resupplementQueryIdFor(taskRef().reference.entityId, "action-unknown"),
      actorId: ACTOR,
      requestedAt: TIMESTAMP,
      authorization: authorization(),
    });
    expect(unknownResupplement).toEqual({
      kind: "failed",
      code: "RETRIEVAL_INPUT_DRIFT",
      detailCode: "query-text-unresolved",
    });
  });

  it("keeps the synthetic sample notice explicit in fixtures", () => {
    expect(SYNTHETIC_NOTICE).toBe("合成样本、待甲方复核");
  });
});

const hybridPolicyValue = () => ({
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

const reviewedSetValue = (
  taskRefValue: AgentTaskRefV1,
  overrides: Record<string, unknown> = {},
) => ({
  schemaVersion: "1",
  projectId: PROJECT,
  taskRef: taskRefValue,
  nodeId: NODE_ID,
  inputSnapshotRef,
  workItemRef,
  candidateSetRef: {
    kind: "content-artifact",
    reference: { entityId: "candidate-set", versionId: `sha256:${"c".repeat(64)}` },
  },
  candidateVersion: 1,
  baselineQueryResultRef: hybridPayload().knowledgeQueryResultRef,
  relationshipQueryResultRef: {
    kind: "knowledge-query-result",
    reference: { entityId: "relationship-query-result:1", versionId: digestOf("relationship") },
  },
  resupplementQueryResultRefs: [],
  validationArtifactRef: {
    kind: "validation-snapshot",
    reference: versionRef("retrieval-review-validation"),
  },
  selectedMembers: [
    {
      memberRef: candidateMember().memberRef,
      sourceKind: "standard-library",
      sourceReleaseRef: releaseRef("release-standard-library"),
      sourceEntryId: "entry-standard",
      contentDigest: digestOf("standard-entry"),
      evidence: [segmentEvidence("segment-standard")],
      originQueryResultRef: {
        ...hybridPayload().knowledgeQueryResultRef,
      },
      rankingSignal: { rank: 1, fusionScore: 1, scoreSemantics: "ranking-signal-not-confidence" },
    },
  ],
  excludedMembers: [],
  authorizationScopeDigest: authorizationScopeDigest(authorization()),
  authorizationContextRef,
  completedAt: TIMESTAMP,
  ...overrides,
});

const seedReviewedSet = async (
  harness: ReturnType<typeof makeHarness>,
  taskRefValue: AgentTaskRefV1,
  overrides: Record<string, unknown> = {},
): Promise<{
  readonly artifactRef: ArtifactRefV1;
  readonly retrievalArtifactSetRef: {
    readonly kind: "retrieval-artifact-set";
    readonly reference: VersionReference;
  };
}> => {
  const relationship = await harness.service.retrieve(relationshipQuery());
  if (relationship.kind !== "succeeded") throw new Error("relationship fixture failed");
  const reviewedSet = ReviewedRetrievalSetV1Schema.parse(
    reviewedSetValue(taskRefValue, {
      relationshipQueryResultRef: relationship.result.knowledgeQueryResultRef,
      ...overrides,
    }),
  );
  const artifactRef = await harness.putValue(
    `retrieval-artifact-set-${taskRefValue.reference.entityId}`,
    reviewedSet,
  );
  const retrievalArtifactSetRef = {
    kind: "retrieval-artifact-set" as const,
    reference: {
      entityId: `retrieval-review:${taskRefValue.reference.entityId}`,
      versionId: artifactRef.reference.versionId,
    },
  };
  harness.rows.set(
    `reviewed-retrieval:${retrievalArtifactSetRef.reference.entityId}:${retrievalArtifactSetRef.reference.versionId}`,
    {
      schemaVersion: "1",
      resultKind: "reviewed-retrieval",
      projectId: PROJECT,
      resultId: retrievalArtifactSetRef.reference.entityId,
      resultVersionId: retrievalArtifactSetRef.reference.versionId,
      requestDigest: "e".repeat(64),
      artifactRef,
      inputSnapshotRef,
      workItemRef,
      authorizationScopeDigest: authorizationScopeDigest(authorization()),
      actorRef: ACTOR,
      authorizationContextRef,
      agentTaskRef: taskRefValue,
      baselineQueryResultRef: reviewedSet.baselineQueryResultRef,
      retrievalArtifactSetRef,
    },
  );
  return { artifactRef, retrievalArtifactSetRef };
};

const completedTaskSnapshot = (
  taskRefValue: AgentTaskRefV1,
  retrievalArtifactSetRef: {
    readonly kind: "retrieval-artifact-set";
    readonly reference: VersionReference;
  },
): AgentTaskSnapshotV1 => {
  const snapshot = taskSnapshot();
  const resultRef = buildCompletedAgentTaskResult(
    taskRefValue,
    retrievalArtifactSetRef,
    undefined,
    ["retrieval-artifact-set"],
  );
  return {
    ...snapshot,
    envelope: { ...snapshot.envelope, agentTaskRef: taskRefValue },
    state: { ...snapshot.state, status: "completed", resultRef, taskVersion: 2 },
  };
};
