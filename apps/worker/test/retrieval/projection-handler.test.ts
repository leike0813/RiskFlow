import { describe, expect, it } from "vitest";

import { DomainEventV1Schema, type DomainEventV1 } from "@riskflow/contracts/events";
import {
  AuthorizationContextV1Schema,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type ModuleErrorV1,
} from "@riskflow/contracts/ports";
import type {
  IdentificationKnowledgeExactReadV1,
  IdentificationKnowledgeReleaseReaderV1,
} from "@riskflow/core/identification-knowledge";
import {
  IdentificationKnowledgeReleaseBindingV1Schema,
  IdentificationKnowledgeValidationReceiptV1Schema,
} from "@riskflow/core/identification-knowledge";
import {
  EmbeddingResultV1Schema,
  type EmbeddingRequestV1,
  type ModelGatewayPortV1,
} from "@riskflow/core/model";
import {
  ConsumerResultV1Schema,
  type ConsumerHandlerResultV1,
  type IdempotentConsumerHandlerV1,
  type IdempotentConsumerV1,
  type TransactionContextV1,
} from "@riskflow/core/persistence";
import {
  HybridRetrievalPolicyV1Schema,
  authorizationScopeDigest,
  projectionCompatibilityRefFor,
  retrievalCollectionNameFor,
  retrievalGenerationRefFor,
  type HybridRetrievalPolicyV1,
  type RetrievalActivationV1,
  type RetrievalEvidenceBaseReleaseRefV1,
  type RetrievalGenerationRefV1,
  type RetrievalGenerationStoreV1,
  type RetrievalGenerationTransitionV1,
  type RetrievalGenerationV1,
  type RetrievalHybridQueryResultV1,
  type RetrievalIndexManifestV1,
  type RetrievalProjectionObservationV1,
  type RetrievalProjectionPortV1,
} from "@riskflow/core/retrieval";

import {
  HYBRID_RETRIEVAL_CONSUMER_NAME_V1,
  VersionedHybridRetrievalProjectionHandler,
  type HybridRetrievalBuildQualityGateV1,
  type HybridRetrievalPolicyProviderV1,
} from "../../src/retrieval/index.js";

const PROJECT_ID = "project-c20";
const TIMESTAMP = "2030-01-01T00:00:00.000Z";
const RETRIEVAL_POLICY_REF = { entityId: "retrieval-policy", versionId: "1" };
const MODEL_DEPLOYMENT_REF = { entityId: "embedding-deployment", versionId: "1" };

const authorization: AuthorizationContextV1 = AuthorizationContextV1Schema.parse({
  schemaVersion: "1",
  authorizationContextRef: {
    kind: "authorization-context",
    reference: { entityId: "authorization-c20", versionId: "1" },
  },
  actorId: "actor-c20",
  projectId: PROJECT_ID,
  grantedCapabilities: ["knowledge-modeling.read", "knowledge-modeling.retrieve"],
  spatialScopeRefs: [],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
  decidedAt: TIMESTAMP,
  invocation: { kind: "human" },
});

const releaseRef = (entityId: string, versionId: string) => ({
  kind: "knowledge-release" as const,
  reference: { entityId, versionId },
});

const MEMBER_RELEASES = {
  riskMechanism: releaseRef("risk-mechanism-release", "1"),
  standardLibrary: releaseRef("standard-library-release", "1"),
  caseLibrary: releaseRef("case-library-release", "1"),
  processModel: releaseRef("process-model-release", "1"),
  evidenceBase: releaseRef("retrieval-evidence-base-release", "1"),
};

const retrievalPolicy: HybridRetrievalPolicyV1 = HybridRetrievalPolicyV1Schema.parse({
  schemaVersion: "1",
  policyRef: RETRIEVAL_POLICY_REF,
  evidenceBaseDefinitionType: "retrieval-evidence-base",
  modelDeploymentRef: MODEL_DEPLOYMENT_REF,
  dense: { vectorName: "dense", dimensions: 8, distance: "cosine" },
  bm25: {
    vectorName: "bm25",
    model: "qdrant/bm25",
    tokenizer: "multilingual",
    language: "chinese",
    stemmer: "none",
    stopwords: [],
  },
  densePrefetchLimit: 20,
  bm25PrefetchLimit: 20,
  topK: 5,
  rrf: { k: 60, denseWeight: 0.7, bm25Weight: 0.3 },
  memberBatchLimit: 16,
  memberByteLimit: 4096,
  memberLimit: 512,
  embeddingTimeoutMs: 5000,
  projectionTimeoutMs: 5000,
  acceptancePolicyRef: { entityId: "acceptance-policy", versionId: "1" },
  projectionCompatibilityRef: {
    entityId: "retrieval-projection-compatibility",
    versionId: "fixture",
  },
});

const evidenceBaseReleaseRef = {
  kind: "retrieval-evidence-base-release" as const,
  reference: MEMBER_RELEASES.evidenceBase.reference,
};

const eventFor = (input: {
  readonly eventId?: string;
  readonly riskMechanismRelease?: { reference: { entityId: string; versionId: string } };
}): DomainEventV1 =>
  DomainEventV1Schema.parse({
    schemaVersion: "1",
    eventId: input.eventId ?? "event-c20-1",
    eventVersion: 1,
    projectId: PROJECT_ID,
    aggregateRef: MEMBER_RELEASES.evidenceBase,
    occurredAt: TIMESTAMP,
    recordedAt: TIMESTAMP,
    causationId: "causation-c20",
    correlationId: "correlation-c20",
    producerCommandId: "command-c20",
    idempotencyKey: "idempotency-c20",
    authorizationContextRef: authorization.authorizationContextRef,
    auditTrailRef: {
      kind: "audit-trail",
      reference: { entityId: "audit-trail-c20", versionId: "1" },
    },
    eventType: "knowledge.identification-basis-published.v1",
    payload: {
      basisKind: "identification-basis",
      publishedReleases: [
        { definitionType: "process-model", releaseRef: MEMBER_RELEASES.processModel },
        {
          definitionType: "risk-mechanism",
          releaseRef: input.riskMechanismRelease ?? MEMBER_RELEASES.riskMechanism,
        },
        { definitionType: "standard-library", releaseRef: MEMBER_RELEASES.standardLibrary },
        { definitionType: "case-library", releaseRef: MEMBER_RELEASES.caseLibrary },
        { definitionType: "retrieval-evidence-base", releaseRef: MEMBER_RELEASES.evidenceBase },
      ],
      retrievalEvidenceBaseReleaseRef: evidenceBaseReleaseRef,
    },
  });

const APPLICABILITY = {
  constructionMethod: ["variable-diameter-shield"],
  stratumCondition: ["soft-soil"],
  engineeringStage: ["expansion-preparation"],
};

const EVIDENCE = [
  {
    locator: { sourceSegmentId: "segment-1" },
    sourceVersion: { entityId: "source-version-1", versionId: "1" },
  },
];

const riskMechanismPackage = (projectId: string) => ({
  schemaVersion: "1" as const,
  projectId,
  definitionType: "risk-mechanism" as const,
  validationPolicyRef: { entityId: "c17-policy", versionId: "1" },
  preparationSnapshotRef: {
    kind: "identification-preparation-snapshot" as const,
    reference: { entityId: "preparation-1", versionId: "1" },
  },
  generatedAt: TIMESTAMP,
  processModelReleaseRef: {
    kind: "process-model-release" as const,
    reference: MEMBER_RELEASES.processModel.reference,
  },
  mechanisms: [
    {
      mechanismId: "mechanism-1",
      mechanismType: "掌子面稳定性失效",
      nodeIds: ["node-1"],
      stateParameters: ["土仓/泥水压力"],
      monitoringIndicators: ["地表沉降"],
      applicability: APPLICABILITY,
      preconditions: ["precondition-1"],
      triggeringFactors: ["trigger-1"],
      evolutionPath: ["path-1"],
      consequences: ["consequence-1"],
      evidence: EVIDENCE,
    },
  ],
});

const standardLibraryPackage = (projectId: string) => ({
  schemaVersion: "1" as const,
  projectId,
  definitionType: "standard-library" as const,
  validationPolicyRef: { entityId: "c17-policy", versionId: "1" },
  preparationSnapshotRef: {
    kind: "identification-preparation-snapshot" as const,
    reference: { entityId: "preparation-1", versionId: "1" },
  },
  generatedAt: TIMESTAMP,
  entries: [
    {
      entryId: "standard-1",
      level: "national" as const,
      standardIdentity: "GB-50446",
      standardVersion: "2025",
      clauseRefs: ["clause-3.2"],
      applicability: APPLICABILITY,
      evidence: EVIDENCE,
    },
  ],
});

const caseLibraryPackage = (projectId: string) => ({
  schemaVersion: "1" as const,
  projectId,
  definitionType: "case-library" as const,
  validationPolicyRef: { entityId: "c17-policy", versionId: "1" },
  preparationSnapshotRef: {
    kind: "identification-preparation-snapshot" as const,
    reference: { entityId: "preparation-1", versionId: "1" },
  },
  generatedAt: TIMESTAMP,
  entries: [
    {
      entryId: "case-1",
      constructionMethod: "variable-diameter-shield",
      engineeringConditions: ["condition-1"],
      process: ["process-1"],
      events: ["event-1"],
      outcomes: ["outcome-1"],
      treatments: ["treatment-1"],
      applicability: APPLICABILITY,
      evidence: EVIDENCE,
    },
  ],
});

const evidenceBasePackage = (projectId: string) => ({
  schemaVersion: "1" as const,
  projectId,
  definitionType: "retrieval-evidence-base" as const,
  validationPolicyRef: { entityId: "c17-policy", versionId: "1" },
  preparationSnapshotRef: {
    kind: "identification-preparation-snapshot" as const,
    reference: { entityId: "preparation-1", versionId: "1" },
  },
  generatedAt: TIMESTAMP,
  riskMechanismReleaseRef: {
    kind: "risk-mechanism-release" as const,
    reference: MEMBER_RELEASES.riskMechanism.reference,
  },
  standardLibraryReleaseRef: MEMBER_RELEASES.standardLibrary,
  caseLibraryReleaseRef: MEMBER_RELEASES.caseLibrary,
});

const validationReceipt = (projectId: string, definitionType: string) =>
  IdentificationKnowledgeValidationReceiptV1Schema.parse({
    schemaVersion: "1",
    projectId,
    definitionType,
    packageDigest: "a".repeat(64),
    validationPolicyRef: { entityId: "c17-policy", versionId: "1" },
    preparationSnapshotRef: {
      kind: "identification-preparation-snapshot",
      reference: { entityId: "preparation-1", versionId: "1" },
    },
    items: [
      {
        checkId: "check-1",
        targetKind: "package",
        targetId: "target-1",
        disposition: "accepted",
        reasonCode: "accepted",
        evidenceReferences: EVIDENCE,
      },
    ],
    disposition: "accepted",
    validationArtifactRef: {
      kind: "content-artifact",
      reference: { entityId: "validation-artifact", versionId: `sha256:${"b".repeat(64)}` },
    },
    validatedAt: TIMESTAMP,
  });

const exactRead = (input: {
  readonly projectId: string;
  readonly definitionType:
    "risk-mechanism" | "standard-library" | "case-library" | "retrieval-evidence-base";
  readonly releaseRef: { reference: { entityId: string; versionId: string } };
  readonly package: unknown;
  readonly compositeMemberReleaseRefs?: readonly {
    reference: { entityId: string; versionId: string };
  }[];
}): IdentificationKnowledgeExactReadV1 =>
  ({
    package: input.package,
    validation: validationReceipt(input.projectId, input.definitionType),
    releaseBinding: IdentificationKnowledgeReleaseBindingV1Schema.parse({
      schemaVersion: "1",
      projectId: input.projectId,
      definitionType: input.definitionType,
      releaseRef: input.releaseRef,
      revisionRef: {
        kind: "knowledge-revision",
        reference: { entityId: `${input.definitionType}-revision`, versionId: "1" },
      },
      candidateArtifactRef: {
        kind: "content-artifact",
        reference: { entityId: "candidate-artifact", versionId: `sha256:${"c".repeat(64)}` },
      },
      ...(input.compositeMemberReleaseRefs === undefined
        ? {}
        : { compositeMemberReleaseRefs: [...input.compositeMemberReleaseRefs] }),
      boundAt: TIMESTAMP,
    }),
  }) as IdentificationKnowledgeExactReadV1;

class SourceFactsDouble implements IdentificationKnowledgeReleaseReaderV1 {
  readonly calls: string[] = [];

  constructor(private readonly reads: ReadonlyMap<string, IdentificationKnowledgeExactReadV1>) {}

  async readExact(input: {
    releaseRef: { reference: { entityId: string } };
  }): Promise<
    | { readonly kind: "succeeded"; readonly read: IdentificationKnowledgeExactReadV1 }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  > {
    this.calls.push(input.releaseRef.reference.entityId);
    const read = this.reads.get(input.releaseRef.reference.entityId);
    if (read === undefined) {
      return {
        kind: "failed",
        error: {
          stageCode: "c20.test",
          occurredAt: TIMESTAMP,
          causalRunId: "c20-test",
          code: "ENTITY_NOT_FOUND",
          category: "not-found",
          retryable: false,
          targetRef: {
            kind: "knowledge-release",
            reference: { entityId: input.releaseRef.reference.entityId, versionId: "1" },
          },
        },
      };
    }
    return { kind: "succeeded", read };
  }
}

class ConsumerDouble implements IdempotentConsumerV1 {
  readonly receipts = new Map<
    string,
    { status: "pending" | "completed"; resultRef?: ContractReferenceV1 }
  >();
  runs = 0;
  context: TransactionContextV1 | undefined;

  async consume(
    consumerName: string,
    event: DomainEventV1,
    handler: IdempotentConsumerHandlerV1,
  ): Promise<{ resultRef: ContractReferenceV1; replayed: boolean }> {
    const key = `${consumerName}/${event.eventId}`;
    const existing = this.receipts.get(key);
    if (existing?.status === "completed" && existing.resultRef !== undefined) {
      return ConsumerResultV1Schema.parse({ resultRef: existing.resultRef, replayed: true });
    }
    if (existing === undefined) this.receipts.set(key, { status: "pending" });
    this.runs += 1;
    const context = {} as unknown as TransactionContextV1;
    this.context = context;
    const result: ConsumerHandlerResultV1 = await handler(context, event);
    this.receipts.set(key, { status: "completed", resultRef: result.resultRef });
    return ConsumerResultV1Schema.parse({ resultRef: result.resultRef, replayed: false });
  }
}

class GenerationStoreDouble implements RetrievalGenerationStoreV1 {
  readonly generations = new Map<string, RetrievalGenerationV1>();
  readonly transitions: RetrievalGenerationTransitionV1[] = [];
  readonly activations: RetrievalActivationV1[] = [];
  readonly failureAudits: string[] = [];
  readonly queryResults = new Map<
    string,
    {
      requestDigest: string;
      knowledgeQueryResultRef: ContractReferenceV1;
      resultArtifactRef: never;
    }
  >();
  ensureCalls = 0;
  activationConflicts = 0;
  simulateActivationConflict = false;

  #key(generationRef: RetrievalGenerationRefV1): string {
    return generationRef.reference.versionId;
  }

  async ensureBuildingGeneration(input: { readonly generation: RetrievalGenerationV1 }): Promise<{
    readonly generation: RetrievalGenerationV1;
    readonly created: boolean;
    readonly status: string;
  }> {
    this.ensureCalls += 1;
    const key = this.#key(input.generation.generationRef);
    const existing = this.generations.get(key);
    if (existing !== undefined) {
      return {
        generation: existing,
        created: false,
        status: this.statusOf(existing.generationRef),
      };
    }
    this.generations.set(key, input.generation);
    this.transitions.push({
      schemaVersion: "1",
      transitionRef: {
        kind: "retrieval-generation-transition",
        reference: { entityId: `${key}:1`, versionId: "building" },
      },
      generationRef: input.generation.generationRef,
      ordinal: 1,
      status: "building",
      occurredAt: TIMESTAMP,
    });
    return { generation: input.generation, created: true, status: "building" };
  }

  statusOf(generationRef: RetrievalGenerationRefV1): string {
    const rows = this.transitions.filter(
      (transition) =>
        transition.generationRef.reference.versionId === generationRef.reference.versionId,
    );
    return rows.length === 0 ? "unknown" : rows[rows.length - 1]!.status;
  }

  async readGeneration(
    generationRef: RetrievalGenerationRefV1,
  ): Promise<RetrievalGenerationV1 | undefined> {
    return this.generations.get(this.#key(generationRef));
  }

  async readGenerationStatus(generationRef: RetrievalGenerationRefV1): Promise<string | undefined> {
    return this.statusOf(generationRef);
  }

  async appendTransition(input: {
    readonly transition: RetrievalGenerationTransitionV1;
  }): Promise<void> {
    this.transitions.push(input.transition);
  }

  async recordProjectionFailure(input: { readonly eventId: string }): Promise<void> {
    this.failureAudits.push(input.eventId);
  }

  async readActiveGeneration(input: {
    readonly projectId: string;
    readonly policyRef: { entityId: string; versionId: string };
    readonly authorizationScopeDigest: string;
  }): Promise<RetrievalGenerationV1 | undefined> {
    for (const activation of this.activations) {
      const generation = this.generations.get(this.#key(activation.generationRef));
      if (generation === undefined) continue;
      if (
        generation.identity.projectId === input.projectId &&
        generation.identity.policyRef.entityId === input.policyRef.entityId &&
        generation.authorizationScopeDigest === input.authorizationScopeDigest &&
        this.statusOf(generation.generationRef) === "active"
      ) {
        return generation;
      }
    }
    return undefined;
  }

  async readActivation(
    generationRef: RetrievalGenerationRefV1,
  ): Promise<RetrievalActivationV1 | undefined> {
    return this.activations.find(
      (activation) =>
        activation.generationRef.reference.versionId === generationRef.reference.versionId,
    );
  }

  async readCurrentActivation(input: {
    readonly projectId: string;
    readonly evidenceBaseReleaseRef: RetrievalEvidenceBaseReleaseRefV1;
  }): Promise<RetrievalActivationV1 | undefined> {
    return [...this.activations]
      .reverse()
      .find(
        (activation) =>
          activation.projectId === input.projectId &&
          activation.evidenceBaseReleaseRef.reference.entityId ===
            input.evidenceBaseReleaseRef.reference.entityId &&
          activation.evidenceBaseReleaseRef.reference.versionId ===
            input.evidenceBaseReleaseRef.reference.versionId,
      );
  }

  async activateGeneration(input: {
    readonly activation: RetrievalActivationV1;
  }): Promise<{ readonly kind: "activated" } | { readonly kind: "activation-conflict" }> {
    if (this.simulateActivationConflict) {
      this.activationConflicts += 1;
      return { kind: "activation-conflict" };
    }
    const current = this.activations[this.activations.length - 1];
    const currentRef = current?.generationRef;
    const expectedRef = input.activation.previousGenerationRef;
    const matches =
      (currentRef === undefined && expectedRef === undefined) ||
      (currentRef !== undefined &&
        expectedRef !== undefined &&
        currentRef.reference.versionId === expectedRef.reference.versionId);
    if (!matches) {
      this.activationConflicts += 1;
      return { kind: "activation-conflict" };
    }
    this.activations.push(input.activation);
    this.transitions.push({
      schemaVersion: "1",
      transitionRef: {
        kind: "retrieval-generation-transition",
        reference: {
          entityId: `${this.#key(input.activation.generationRef)}:3`,
          versionId: "active",
        },
      },
      generationRef: input.activation.generationRef,
      ordinal: 3,
      status: "active",
      occurredAt: TIMESTAMP,
    });
    return { kind: "activated" };
  }

  async registerQueryResult(): Promise<never> {
    throw new Error("query registration is not used by the projection handler");
  }

  async readQueryResult(): Promise<undefined> {
    return undefined;
  }
}

type StoredPoint = {
  readonly hasDenseVector: boolean;
  readonly hasSparseVector: boolean;
  readonly denseDimensions: number;
  readonly payload: RetrievalProjectionObservationV1["points"][number]["payload"];
};

class ProjectionDouble implements RetrievalProjectionPortV1 {
  readonly collections = new Map<string, Map<string, StoredPoint>>();
  readonly ensured: string[] = [];
  failUpsert = false;
  omitSparseFor: string | undefined;

  async serviceVersion(): Promise<{ version: string }> {
    return { version: "1.19.0" };
  }

  async ensureCollection(input: {
    readonly collectionName: string;
  }): Promise<{ created: boolean }> {
    this.ensured.push(input.collectionName);
    if (!this.collections.has(input.collectionName)) {
      this.collections.set(input.collectionName, new Map());
      return { created: true };
    }
    return { created: false };
  }

  async upsertMembers(input: {
    readonly collectionName: string;
    readonly manifest: RetrievalIndexManifestV1;
    readonly texts: readonly { readonly pointId: string; readonly text: string }[];
  }): Promise<void> {
    if (this.failUpsert) throw new Error("qdrant unavailable");
    const points = this.collections.get(input.collectionName) ?? new Map<string, StoredPoint>();
    for (const member of input.manifest.members) {
      points.set(member.pointId, {
        hasDenseVector: true,
        hasSparseVector: member.pointId !== this.omitSparseFor,
        denseDimensions: member.denseDimensions,
        payload: {
          schemaVersion: "1",
          projectId: input.manifest.projectId,
          generationRef: input.manifest.generationRef,
          generationKey: input.manifest.generationRef.reference.versionId,
          sourceKind: member.sourceKind,
          sourceReleaseRef: member.sourceReleaseRef,
          sourceEntryId: member.sourceEntryId,
          contentDigest: member.contentDigest,
          authorizationScopeDigest: member.authorizationScopeDigest,
        },
      });
    }
    this.collections.set(input.collectionName, points);
  }

  async inspectGeneration(input: {
    readonly collectionName: string;
    readonly generationRef: RetrievalGenerationRefV1;
    readonly maxPoints: number;
  }): Promise<RetrievalProjectionObservationV1> {
    const points = this.collections.get(input.collectionName) ?? new Map<string, StoredPoint>();
    const entries = [...points.entries()].slice(0, input.maxPoints);
    return {
      collectionName: input.collectionName,
      generationRef: input.generationRef,
      serviceVersion: "1.19.0",
      points: entries.map(([pointId, point]) => ({ pointId, ...point })),
      complete: points.size <= input.maxPoints,
    };
  }

  async queryHybrid(): Promise<RetrievalHybridQueryResultV1> {
    throw new Error("hybrid queries are not used by the projection handler");
  }

  async deleteGenerationCollection(): Promise<{ deleted: boolean }> {
    return { deleted: false };
  }

  async listRetrievalCollections(): Promise<readonly string[]> {
    return [...this.collections.keys()];
  }
}

const embeddingFor = (request: EmbeddingRequestV1) =>
  EmbeddingResultV1Schema.parse({
    schemaVersion: "1",
    invocationId: request.invocationId,
    modelDeploymentRef: request.modelDeploymentRef,
    serverBuildRef: { entityId: "llama-server", versionId: "1" },
    modelVersionRef: { entityId: "embedding-model", versionId: "1" },
    usage: { available: false },
    rawResponseRef: {
      kind: "diagnostic-artifact",
      reference: { entityId: "embedding-raw", versionId: "1" },
    },
    vectors: request.texts.map((text) =>
      Array.from({ length: 8 }, (_, index) => ((text.length + index) % 11) / 11),
    ),
    dimensions: 8,
  });

const policyProviderFor = (policy: HybridRetrievalPolicyV1): HybridRetrievalPolicyProviderV1 => ({
  async resolveExact() {
    return policy;
  },
});

class RecordingModelGateway {
  readonly requests: EmbeddingRequestV1[] = [];

  async embed(request: EmbeddingRequestV1) {
    this.requests.push(request);
    return embeddingFor(request);
  }
}

const passingQualityGate: HybridRetrievalBuildQualityGateV1 = {
  async evaluate() {
    return { passed: true, detailCode: "fixture-passed" };
  },
};

const buildHandler = (options: {
  readonly consumer?: ConsumerDouble;
  readonly store?: GenerationStoreDouble;
  readonly projection?: ProjectionDouble;
  readonly sourceFacts?: IdentificationKnowledgeReleaseReaderV1;
  readonly modelGateway?: Pick<ModelGatewayPortV1, "embed">;
  readonly qualityGate?: HybridRetrievalBuildQualityGateV1;
  readonly riskMechanismMember?: { readonly entityId: string; readonly versionId: string };
  readonly policy?: Partial<HybridRetrievalPolicyV1>;
}) => {
  const riskMechanismMember =
    options.riskMechanismMember === undefined
      ? MEMBER_RELEASES.riskMechanism
      : { kind: "knowledge-release" as const, reference: options.riskMechanismMember };
  const consumer = options.consumer ?? new ConsumerDouble();
  const store = options.store ?? new GenerationStoreDouble();
  const projection = options.projection ?? new ProjectionDouble();
  const sourceFacts =
    options.sourceFacts ??
    new SourceFactsDouble(
      new Map<string, IdentificationKnowledgeExactReadV1>([
        [
          riskMechanismMember.reference.entityId,
          exactRead({
            projectId: PROJECT_ID,
            definitionType: "risk-mechanism",
            releaseRef: riskMechanismMember,
            package: riskMechanismPackage(PROJECT_ID),
          }),
        ],
        [
          "standard-library-release",
          exactRead({
            projectId: PROJECT_ID,
            definitionType: "standard-library",
            releaseRef: MEMBER_RELEASES.standardLibrary,
            package: standardLibraryPackage(PROJECT_ID),
          }),
        ],
        [
          "case-library-release",
          exactRead({
            projectId: PROJECT_ID,
            definitionType: "case-library",
            releaseRef: MEMBER_RELEASES.caseLibrary,
            package: caseLibraryPackage(PROJECT_ID),
          }),
        ],
        [
          "retrieval-evidence-base-release",
          exactRead({
            projectId: PROJECT_ID,
            definitionType: "retrieval-evidence-base",
            releaseRef: MEMBER_RELEASES.evidenceBase,
            package: evidenceBasePackage(PROJECT_ID),
            compositeMemberReleaseRefs: [
              riskMechanismMember,
              MEMBER_RELEASES.standardLibrary,
              MEMBER_RELEASES.caseLibrary,
            ],
          }),
        ],
      ]),
    );
  const modelGateway = options.modelGateway ?? new RecordingModelGateway();
  const policy =
    options.policy === undefined ? retrievalPolicy : { ...retrievalPolicy, ...options.policy };
  const handler = new VersionedHybridRetrievalProjectionHandler({
    idempotentConsumer: consumer,
    sourceFacts,
    modelGateway,
    generationStore: store,
    projection,
    policyProvider: policyProviderFor(policy),
    qualityGate: options.qualityGate ?? passingQualityGate,
    authorize: async () => authorization,
    budgetPolicyRef: { entityId: "retrieval-budget-policy", versionId: "1" },
    now: () => new Date(TIMESTAMP),
  });
  return { handler, consumer, store, projection, modelGateway };
};

const expectedCollectionName = retrievalCollectionNameFor(
  retrievalGenerationRefFor({
    projectId: PROJECT_ID,
    sourceEventId: "event-c20-1",
    evidenceBaseReleaseRef,
    memberReleaseRefs: {
      riskMechanismRef: MEMBER_RELEASES.riskMechanism,
      standardLibraryRef: MEMBER_RELEASES.standardLibrary,
      caseLibraryRef: MEMBER_RELEASES.caseLibrary,
    },
    policyRef: retrievalPolicy.policyRef,
    modelDeploymentRef: retrievalPolicy.modelDeploymentRef,
    projectionCompatibilityRef: projectionCompatibilityRefFor({
      serviceVersion: "1.19.0",
      policy: retrievalPolicy,
    }),
  }),
);

describe("versioned hybrid retrieval projection handler", () => {
  it("reads the building generation for quality in the consumer transaction", async () => {
    const consumer = new ConsumerDouble();
    const store = new GenerationStoreDouble();
    let checked = false;
    const { handler } = buildHandler({
      consumer,
      store,
      qualityGate: {
        async evaluate(input, context) {
          expect(context).toBeDefined();
          expect(context).toBe(consumer.context);
          const generation = await store.readGeneration(input.generationRef);
          expect(generation?.generationRef).toEqual(input.generationRef);
          expect(store.statusOf(input.generationRef)).toBe("building");
          checked = true;
          return { passed: true, detailCode: "fixture-passed" };
        },
      },
    });

    expect((await handler.handle(eventFor({}))).kind).toBe("projected");
    expect(checked).toBe(true);
    expect(store.activations).toHaveLength(1);
  });

  it("projects one dual-index generation with ready, activation and a completed receipt", async () => {
    const { handler, consumer, store, projection } = buildHandler({});

    const outcome = await handler.handle(eventFor({}));

    expect(outcome.kind).toBe("projected");
    expect(store.generations.size).toBe(1);
    const generation = [...store.generations.values()][0]!;
    expect(generation.collectionName).toBe(expectedCollectionName);
    expect(generation.expectedMemberCount).toBe(3);
    expect(generation.authorizationScopeDigest).toBe(authorizationScopeDigest(authorization));
    expect(store.transitions.map((transition) => transition.status)).toEqual([
      "building",
      "ready",
      "active",
    ]);
    expect(store.activations).toHaveLength(1);
    expect(consumer.receipts.get(`${HYBRID_RETRIEVAL_CONSUMER_NAME_V1}/event-c20-1`)?.status).toBe(
      "completed",
    );
    const points = [...(projection.collections.get(expectedCollectionName) ?? new Map()).values()];
    expect(points).toHaveLength(3);
    expect(points.every((point) => point.hasDenseVector && point.hasSparseVector)).toBe(true);
    expect(points.map((point) => point.payload?.sourceKind).sort()).toEqual([
      "case-library",
      "risk-mechanism",
      "standard-library",
    ]);
  });

  it("replays duplicate deliveries without duplicating members, transitions or activations", async () => {
    const { handler, consumer, store, projection } = buildHandler({});
    await handler.handle(eventFor({}));
    const second = await handler.handle(eventFor({}));

    expect(second.kind).toBe("projected");
    if (second.kind !== "projected") throw new Error("unreachable");
    expect(second.consumer.replayed).toBe(true);
    expect(consumer.runs).toBe(1);
    expect(store.transitions).toHaveLength(3);
    expect(store.activations).toHaveLength(1);
    expect(projection.collections.get(expectedCollectionName)?.size).toBe(3);
  });

  it("rebuilds the registered generation into an empty projection without consuming or activating again", async () => {
    const original = buildHandler({});
    await original.handler.handle(eventFor({}));
    const generation = [...original.store.generations.values()][0]!;
    const before = structuredClone({
      transitions: original.store.transitions,
      activations: original.store.activations,
      receipts: original.consumer.receipts,
    });
    const restored = buildHandler({ store: original.store, consumer: original.consumer });
    const result = await restored.handler.rebuildGeneration({
      event: eventFor({}),
      generationRef: generation.generationRef,
      authorization,
      operationId: "restore-c20",
    });
    expect(result).toEqual({
      kind: "rebuilt",
      generationRef: generation.generationRef,
      memberCount: 3,
    });
    const points = [...restored.projection.collections.get(generation.collectionName)!.values()];
    expect(points).toHaveLength(3);
    expect(points.every((point) => point.hasDenseVector && point.hasSparseVector)).toBe(true);
    expect({
      transitions: original.store.transitions,
      activations: original.store.activations,
      receipts: original.consumer.receipts,
    }).toEqual(before);
    expect(original.consumer.runs).toBe(1);
    expect(original.store.ensureCalls).toBe(1);
  });

  it.each(["event", "manifest", "quality"] as const)(
    "refuses restore %s drift without changing formal generation facts",
    async (failure) => {
      const original = buildHandler({});
      await original.handler.handle(eventFor({}));
      let generation = [...original.store.generations.values()][0]!;
      if (failure === "manifest") {
        generation = { ...generation, manifestSha256: "0".repeat(64) };
        original.store.generations.set(generation.generationRef.reference.versionId, generation);
      }
      const restored = buildHandler({
        store: original.store,
        consumer: original.consumer,
        ...(failure === "quality"
          ? {
              qualityGate: {
                evaluate: async () => ({ passed: false, detailCode: "gate-refused" }),
              },
            }
          : {}),
      });
      const before = structuredClone({
        transitions: original.store.transitions,
        activations: original.store.activations,
        receipts: original.consumer.receipts,
      });
      const result = await restored.handler.rebuildGeneration({
        event: eventFor(failure === "event" ? { eventId: "other-event" } : {}),
        generationRef: generation.generationRef,
        authorization,
        operationId: "restore-refused-c20",
      });
      expect(result.kind).toBe("rejected");
      expect({
        transitions: original.store.transitions,
        activations: original.store.activations,
        receipts: original.consumer.receipts,
      }).toEqual(before);
      expect(original.consumer.runs).toBe(1);
      expect(original.store.ensureCalls).toBe(1);
      if (failure !== "quality")
        expect((restored.modelGateway as RecordingModelGateway).requests).toHaveLength(0);
    },
  );

  it("activates the next generation in a series after the policy changes", async () => {
    const first = buildHandler({});
    expect((await first.handler.handle(eventFor({}))).kind).toBe("projected");
    const next = buildHandler({
      consumer: first.consumer,
      store: first.store,
      projection: first.projection,
      policy: { policyRef: { entityId: "retrieval-policy", versionId: "v2" } },
    });

    expect((await next.handler.handle(eventFor({ eventId: "event-c20-2" }))).kind).toBe(
      "projected",
    );
    expect(first.store.activations).toHaveLength(2);
    expect(first.store.activations[1]).toMatchObject({
      activationOrdinal: 2,
      previousGenerationRef: first.store.activations[0]?.generationRef,
    });
  });

  it("rejects a build when the series activation changes before the final lock", async () => {
    const { handler, store } = buildHandler({});
    await handler.handle(eventFor({}));
    const readCurrent = store.readCurrentActivation.bind(store);
    let reads = 0;
    store.readCurrentActivation = async (input) => {
      const current = await readCurrent(input);
      reads += 1;
      return reads === 2 && current !== undefined
        ? { ...current, activationOrdinal: current.activationOrdinal + 1 }
        : current;
    };

    const outcome = await handler.handle(eventFor({ eventId: "event-c20-concurrent" }));
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") throw new Error("unreachable");
    expect(outcome.failure.code).toBe("ACTIVATION_CONFLICT");
    expect(outcome.failure.retryable).toBe(true);
    expect(store.activations).toHaveLength(1);
  });

  it("ignores non-target events without writing any C20 state", async () => {
    const { handler, consumer, store, projection } = buildHandler({});
    const otherEvent = DomainEventV1Schema.parse({
      ...eventFor({}),
      eventId: "event-other",
      aggregateRef: { kind: "knowledge-release", reference: { entityId: "other", versionId: "1" } },
      eventType: "engineering.inputs-ready.v1",
      payload: {
        preparation: {
          kind: "identification",
          identificationPreparationSnapshotRef: {
            kind: "identification-preparation-snapshot",
            reference: { entityId: "preparation-1", versionId: "1" },
          },
        },
      },
    });

    const outcome = await handler.handle(otherEvent);

    expect(outcome.kind).toBe("ignored");
    expect(consumer.runs).toBe(0);
    expect(store.generations.size).toBe(0);
    expect(store.activations).toHaveLength(0);
    expect(projection.ensured).toEqual([]);
  });

  it("keeps the generation buildable but unready when Qdrant fails, then converges on redelivery", async () => {
    const { handler, store, projection } = buildHandler({});
    projection.failUpsert = true;

    const failed = await handler.handle(eventFor({}));
    expect(failed.kind).toBe("rejected");
    if (failed.kind !== "rejected") throw new Error("unreachable");
    expect(failed.failure.code).toBe("QDRANT_UNAVAILABLE");
    expect(failed.failure.retryable).toBe(true);
    expect(store.transitions.map((transition) => transition.status)).toEqual(["building"]);
    expect(store.activations).toHaveLength(0);

    projection.failUpsert = false;
    const retried = await handler.handle(eventFor({}));
    expect(retried.kind).toBe("projected");
    expect(store.transitions.map((transition) => transition.status)).toEqual([
      "building",
      "ready",
      "active",
    ]);
    expect(store.activations).toHaveLength(1);
  });

  it("rejects a manifest that is missing a sparse representation and records a failed transition", async () => {
    const { handler, store, projection } = buildHandler({});
    const inspect = projection.inspectGeneration.bind(projection);
    projection.inspectGeneration = async (input) => {
      const observation = await inspect(input);
      return {
        ...observation,
        points: observation.points.map((point) => ({ ...point, hasSparseVector: false })),
      };
    };

    const outcome = await handler.handle(eventFor({}));

    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") throw new Error("unreachable");
    expect(outcome.failure.code).toBe("DUAL_INDEX_MISMATCH");
    expect(outcome.failure.retryable).toBe(false);
    expect(store.transitions.map((transition) => transition.status)).toEqual([
      "building",
      "failed",
    ]);
    expect(store.activations).toHaveLength(0);
  });

  it("does not complete the consumer receipt when the failed transition cannot be written", async () => {
    const { handler, consumer, store, projection } = buildHandler({});
    const inspect = projection.inspectGeneration.bind(projection);
    projection.inspectGeneration = async (input) => {
      const observation = await inspect(input);
      return {
        ...observation,
        points: observation.points.map((point) => ({ ...point, hasSparseVector: false })),
      };
    };
    const append = store.appendTransition.bind(store);
    let fail = true;
    store.appendTransition = async (input) => {
      if (input.transition.status === "failed" && fail) throw new Error("failed-transition-write");
      return append(input);
    };

    await expect(handler.handle(eventFor({}))).rejects.toThrow("failed-transition-write");
    expect(consumer.receipts.get(`${HYBRID_RETRIEVAL_CONSUMER_NAME_V1}/event-c20-1`)?.status).toBe(
      "pending",
    );
    fail = false;
    expect((await handler.handle(eventFor({}))).kind).toBe("rejected");
    expect(consumer.receipts.get(`${HYBRID_RETRIEVAL_CONSUMER_NAME_V1}/event-c20-1`)?.status).toBe(
      "completed",
    );
    await handler.handle(eventFor({}));
    expect(store.transitions.filter((transition) => transition.status === "failed")).toHaveLength(
      1,
    );
  });

  it("reports an activation conflict as a retryable rejection without touching history", async () => {
    const { handler, store } = buildHandler({});
    store.simulateActivationConflict = true;

    const outcome = await handler.handle(eventFor({}));

    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") throw new Error("unreachable");
    expect(outcome.failure.code).toBe("ACTIVATION_CONFLICT");
    expect(outcome.failure.retryable).toBe(true);
    expect(store.activations).toHaveLength(0);
  });

  it("rejects a quality gate failure permanently", async () => {
    const { handler, store } = buildHandler({
      qualityGate: {
        async evaluate() {
          return { passed: false, detailCode: "dense-recall-below-threshold" };
        },
      },
    });

    const outcome = await handler.handle(eventFor({}));

    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") throw new Error("unreachable");
    expect(outcome.failure.code).toBe("QUALITY_GATE_FAILED");
    expect(store.activations).toHaveLength(0);
    expect(store.transitions.map((transition) => transition.status)).toEqual([
      "building",
      "failed",
    ]);
  });

  it("fails closed when a member release cannot be read", async () => {
    const reads = new Map<string, IdentificationKnowledgeExactReadV1>();
    const { handler, store } = buildHandler({ sourceFacts: new SourceFactsDouble(reads) });

    const outcome = await handler.handle(eventFor({}));

    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") throw new Error("unreachable");
    expect(outcome.failure.code).toBe("SOURCE_FACT_DRIFT");
    expect(store.activations).toHaveLength(0);
    expect(store.failureAudits).toEqual(["event-c20-1"]);
  });

  it("passes the versioned resource budget into the member embedding batches", async () => {
    const single = buildHandler({});
    await single.handler.handle(eventFor({}));
    expect(single.modelGateway.requests).toHaveLength(1);
    const request = single.modelGateway.requests[0]!;
    expect(request.texts).toHaveLength(3);
    expect(request.maxInputBytes).toBe(retrievalPolicy.memberByteLimit);
    expect(request.maxBatchItems).toBe(retrievalPolicy.memberBatchLimit);
    expect(request.requiredCapability).toBe("knowledge-modeling.retrieve");
    expect(request.modelDeploymentRef).toEqual(retrievalPolicy.modelDeploymentRef);

    // 策略把批量压到 2 后必须切成两批，且每批不超过策略上限。
    const batched = buildHandler({ policy: { memberBatchLimit: 2, memberByteLimit: 2048 } });
    await batched.handler.handle(eventFor({}));
    expect(batched.modelGateway.requests.map((entry) => entry.texts.length)).toEqual([2, 1]);
    expect(batched.modelGateway.requests.every((entry) => entry.maxBatchItems === 2)).toBe(true);
  });

  it("creates a distinct generation when a member release changes", async () => {
    const changedMember = { entityId: "risk-mechanism-release", versionId: "2" };
    const first = buildHandler({});
    await first.handler.handle(eventFor({}));
    const second = buildHandler({ riskMechanismMember: changedMember });
    const changed = await second.handler.handle(
      eventFor({
        riskMechanismRelease: releaseRef(changedMember.entityId, changedMember.versionId),
      }),
    );

    expect(changed.kind).toBe("projected");
    const [firstGeneration] = [...first.store.generations.values()];
    const [secondGeneration] = [...second.store.generations.values()];
    expect(firstGeneration).toBeDefined();
    expect(secondGeneration).toBeDefined();
    expect(secondGeneration!.generationRef.reference.versionId).not.toBe(
      firstGeneration!.generationRef.reference.versionId,
    );
    expect(secondGeneration!.collectionName).not.toBe(firstGeneration!.collectionName);
  });
});
