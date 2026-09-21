import { describe, expect, it } from "vitest";

import { DomainEventV1Schema, type DomainEventV1 } from "@riskflow/contracts/events";
import {
  AuthorizationContextV1Schema,
  KnowledgeRetrievalQueryV1Schema,
  type AuthorizationContextV1,
} from "@riskflow/contracts/ports";
import { VersionReferenceSchema } from "@riskflow/contracts/common";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import type {
  IdentificationKnowledgeExactReadV1,
  IdentificationKnowledgeReleaseReaderV1,
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
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import {
  HybridRetrievalPolicyV1Schema,
  type HybridRetrievalInputReaderV1,
  type HybridRetrievalPolicyV1,
} from "@riskflow/core/retrieval";

import { createHybridRetrievalProjectionComposition } from "../../src/retrieval/index.js";

/**
 * 组合根测试（IP-05 / 4.2）：验证生产依赖全部显式注入、非目标事件零副作用、
 * 投影失败在缺少真实 Qdrant 时封闭失败（不出现第二队列、私表扫描或内存回退），
 * 以及查询服务以 `retrievalDelegate` 暴露给 C17 组合。
 */

const PROJECT_ID = "project-c20";
const TIMESTAMP = "2030-01-01T00:00:00.000Z";

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

const policy: HybridRetrievalPolicyV1 = HybridRetrievalPolicyV1Schema.parse({
  schemaVersion: "1",
  policyRef: { entityId: "retrieval-policy", versionId: "1" },
  evidenceBaseDefinitionType: "retrieval-evidence-base",
  modelDeploymentRef: { entityId: "embedding-deployment", versionId: "1" },
  dense: { vectorName: "dense", dimensions: 4, distance: "cosine" },
  bm25: {
    vectorName: "bm25",
    model: "qdrant/bm25",
    tokenizer: "multilingual",
    language: "chinese",
    stemmer: "none",
    stopwords: [],
  },
  densePrefetchLimit: 4,
  bm25PrefetchLimit: 4,
  topK: 2,
  rrf: { k: 60, denseWeight: 0.5, bm25Weight: 0.5 },
  memberBatchLimit: 2,
  memberByteLimit: 2048,
  memberLimit: 16,
  embeddingTimeoutMs: 5000,
  projectionTimeoutMs: 5000,
  acceptancePolicyRef: { entityId: "acceptance-policy", versionId: "1" },
  projectionCompatibilityRef: { entityId: "projection-compatibility", versionId: "1" },
});

const releaseRef = (entityId: string, versionId: string) => ({
  kind: "knowledge-release" as const,
  reference: { entityId, versionId },
});

const memberReleases = {
  riskMechanism: releaseRef("risk-mechanism-release", "1"),
  standardLibrary: releaseRef("standard-library-release", "1"),
  caseLibrary: releaseRef("case-library-release", "1"),
  processModel: releaseRef("process-model-release", "1"),
  evidenceBase: releaseRef("retrieval-evidence-base-release", "1"),
};

const event: DomainEventV1 = DomainEventV1Schema.parse({
  schemaVersion: "1",
  eventId: "event-c20-composition",
  eventVersion: 1,
  projectId: PROJECT_ID,
  aggregateRef: memberReleases.evidenceBase,
  occurredAt: TIMESTAMP,
  recordedAt: TIMESTAMP,
  causationId: "causation-c20",
  correlationId: "correlation-c20",
  producerCommandId: "command-c20",
  idempotencyKey: "idempotency-c20",
  authorizationContextRef: authorization.authorizationContextRef,
  auditTrailRef: { kind: "audit-trail", reference: { entityId: "audit-trail", versionId: "1" } },
  eventType: "knowledge.identification-basis-published.v1",
  payload: {
    basisKind: "identification-basis",
    publishedReleases: [
      { definitionType: "process-model", releaseRef: memberReleases.processModel },
      { definitionType: "risk-mechanism", releaseRef: memberReleases.riskMechanism },
      { definitionType: "standard-library", releaseRef: memberReleases.standardLibrary },
      { definitionType: "case-library", releaseRef: memberReleases.caseLibrary },
      { definitionType: "retrieval-evidence-base", releaseRef: memberReleases.evidenceBase },
    ],
    retrievalEvidenceBaseReleaseRef: {
      kind: "retrieval-evidence-base-release",
      reference: memberReleases.evidenceBase.reference,
    },
  },
});

class RecordingSourceFacts implements IdentificationKnowledgeReleaseReaderV1 {
  readonly reads: string[] = [];

  async readExact(input: {
    releaseRef: { reference: { entityId: string; versionId: string } };
  }): Promise<
    | { readonly kind: "succeeded"; readonly read: IdentificationKnowledgeExactReadV1 }
    | { readonly kind: "failed"; readonly error: never }
  > {
    this.reads.push(input.releaseRef.reference.entityId);
    const definitionType = input.releaseRef.reference.entityId.replace(/-release$/u, "");
    return {
      kind: "succeeded",
      read: {
        package: { schemaVersion: "1", projectId: PROJECT_ID, definitionType },
        validation: { packageDigest: "e".repeat(64) },
        releaseBinding: {
          schemaVersion: "1",
          projectId: PROJECT_ID,
          definitionType,
          releaseRef: input.releaseRef,
          compositeMemberReleaseRefs:
            definitionType === "retrieval-evidence-base"
              ? [
                  memberReleases.riskMechanism,
                  memberReleases.standardLibrary,
                  memberReleases.caseLibrary,
                ]
              : undefined,
        },
      } as unknown as IdentificationKnowledgeExactReadV1,
    };
  }
}

class RecordingConsumer implements IdempotentConsumerV1 {
  runs = 0;

  async consume(
    _consumerName: string,
    domainEvent: DomainEventV1,
    handler: IdempotentConsumerHandlerV1,
  ): Promise<ReturnType<typeof ConsumerResultV1Schema.parse>> {
    this.runs += 1;
    const result: ConsumerHandlerResultV1 = await handler(
      {} as unknown as TransactionContextV1,
      domainEvent,
    );
    return ConsumerResultV1Schema.parse({ resultRef: result.resultRef, replayed: false });
  }
}

class RecordingModelGateway {
  readonly requests: EmbeddingRequestV1[] = [];

  async embed(
    request: EmbeddingRequestV1,
  ): Promise<ReturnType<typeof EmbeddingResultV1Schema.parse>> {
    this.requests.push(request);
    return EmbeddingResultV1Schema.parse({
      schemaVersion: "1",
      invocationId: request.invocationId,
      modelDeploymentRef: request.modelDeploymentRef,
      serverBuildRef: { entityId: "llama-server", versionId: "1" },
      modelVersionRef: { entityId: "embedding-model", versionId: "1" },
      usage: { available: false },
      rawResponseRef: {
        kind: "diagnostic-artifact",
        reference: { entityId: "raw", versionId: "1" },
      },
      vectors: request.texts.map(() => [0.25, 0.25, 0.25, 0.25]),
      dimensions: 4,
    });
  }
}

const transactionUnit: TransactionUnitV1 = {
  async execute(_command, handler) {
    const commit = await handler({} as unknown as TransactionContextV1);
    return {
      resultRef: commit.resultRef,
      auditEntryId: commit.audit.auditEntryId,
      eventRefs: [],
      replayed: false,
    };
  },
};

const artifactStore: ArtifactStoreV1 = {
  async put() {
    throw new Error("artifact store is not exercised by the composition wiring test");
  },
  async open() {
    throw new Error("artifact store is not exercised by the composition wiring test");
  },
};

const queryInputReader: HybridRetrievalInputReaderV1 = {
  async readExact() {
    return { kind: "failed", code: "POLICY_NOT_FOUND", detailCode: "no-policy" };
  },
};

const buildComposition = () => {
  const consumer = new RecordingConsumer();
  const sourceFacts = new RecordingSourceFacts();
  const modelGateway = new RecordingModelGateway();
  const composition = createHybridRetrievalProjectionComposition({
    generationStore: { db: {}, transactionUnit },
    qdrant: { baseUrl: "http://127.0.0.1:1" },
    transactionUnit,
    idempotentConsumer: consumer,
    sourceFacts,
    modelGateway: modelGateway as unknown as ModelGatewayPortV1,
    artifactStore,
    policyProvider: {
      async resolveExact() {
        return policy;
      },
    },
    qualityGate: {
      async evaluate() {
        return { passed: true, detailCode: "composition-fixture" };
      },
    },
    queryInputReader,
    authorize: async () => authorization,
    budgetPolicyRef: VersionReferenceSchema.parse({
      entityId: "retrieval-budget-policy",
      versionId: "1",
    }),
    now: () => new Date(TIMESTAMP),
  });
  return { composition, consumer, sourceFacts, modelGateway };
};

describe("hybrid retrieval composition", () => {
  it("ignores non-target events without touching any injected dependency", async () => {
    const { composition, consumer, sourceFacts, modelGateway } = buildComposition();
    const otherEvent = DomainEventV1Schema.parse({
      ...event,
      eventId: "event-other",
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

    const outcome = await composition.projectionHandler.handle(otherEvent);

    expect(outcome.kind).toBe("ignored");
    expect(consumer.runs).toBe(0);
    expect(sourceFacts.reads).toEqual([]);
    expect(modelGateway.requests).toEqual([]);
  });

  it("fails closed on the target event when the injected Qdrant endpoint is unreachable", async () => {
    const { composition, consumer, sourceFacts, modelGateway } = buildComposition();

    const outcome = await composition.projectionHandler.handle(event);

    // 组合根只接受显式注入的依赖：没有内存回退、没有第二队列，读取面固定为 C17 精确读取。
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") throw new Error("unreachable");
    expect(outcome.failure.code).toBe("QDRANT_UNAVAILABLE");
    expect(outcome.failure.retryable).toBe(true);
    expect(outcome.failure.projectId).toBe(PROJECT_ID);
    expect(consumer.runs).toBe(1);
    expect(sourceFacts.reads).toEqual([]);
    expect(modelGateway.requests).toEqual([]);
  });

  it("exposes the query service through the C17 retrieval delegate without a fallback", async () => {
    const { composition } = buildComposition();
    const query = KnowledgeRetrievalQueryV1Schema.parse({
      queryId: "query-composition-1",
      projectId: PROJECT_ID,
      actorId: authorization.actorId,
      requestedAt: TIMESTAMP,
      authorization,
      kind: "hybrid-evidence",
      payload: {
        inputSnapshotRef: {
          kind: "identification-input-snapshot",
          reference: { entityId: "input-snapshot-1", versionId: "1" },
        },
        workItemRef: {
          kind: "identification-work-item",
          reference: { entityId: "work-item-1", versionId: "1" },
        },
        retrievalPolicyRef: policy.policyRef,
      },
    });

    const result = await composition.retrievalDelegate.retrieve(query);

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") throw new Error("unreachable");
    // 输入窄读未命中策略时必须结构化失败，不得给出默认策略或空结果。
    expect(result.error.retryable).toBe(false);
    expect(composition.retrievalService).toBeDefined();
  });
});
