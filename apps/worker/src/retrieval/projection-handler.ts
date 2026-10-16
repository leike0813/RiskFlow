import type { DomainEventV1 } from "@riskflow/contracts/events";
import { DomainEventV1Schema } from "@riskflow/contracts/events";
import type { VersionReference } from "@riskflow/contracts/common";
import type {
  AuthorizationContextV1,
  RetrievalEvidenceBaseReleaseRefV1,
} from "@riskflow/contracts/ports";
import type {
  IdentificationKnowledgeExactReadV1,
  IdentificationKnowledgeReleaseReaderV1,
} from "@riskflow/core/identification-knowledge";
import {
  EmbeddingRequestV1Schema,
  type EmbeddingResultV1,
  type ModelGatewayPortV1,
} from "@riskflow/core/model";
import type {
  ConsumerResultV1,
  IdempotentConsumerV1,
  TransactionContextV1,
} from "@riskflow/core/persistence";
import {
  HybridRetrievalPolicyV1Schema,
  authorizationScopeDigest,
  hybridRetrievalFailure,
  normalizeRetrievalMembers,
  projectionCompatibilityRefFor,
  reconcileDualIndexManifest,
  retrievalCollectionNameFor,
  retrievalGenerationRefFor,
  type HybridRetrievalFailureV1,
  type HybridRetrievalPolicyV1,
  type RetrievalGenerationRefV1,
  type RetrievalGenerationStoreV1,
  type RetrievalGenerationTransitionV1,
  type RetrievalGenerationV1,
  type RetrievalIndexManifestV1,
  type RetrievalMemberSourceV1,
  type RetrievalProjectionPortV1,
  type RetrievalReconciliationV1,
  type RetrievalSourceKindV1,
} from "@riskflow/core/retrieval";

/**
 * C20 版本化 Outbox 投影 handler（design D1/D5）：只消费
 * `knowledge.identification-basis-published.v1`，在旁路 collection 中幂等构建双索引代际，
 * ready/对账/质量门禁全部通过后才在 C03 消费事务内做原子激活。
 */

export const HYBRID_RETRIEVAL_PROJECTION_EVENT_TYPE_V1 =
  "knowledge.identification-basis-published.v1" as const;

export const HYBRID_RETRIEVAL_CONSUMER_NAME_V1 = "versioned-hybrid-retrieval-projection.v1";

/** 代际状态转换序号：building/ready 为正常序列，failed 用独立高位避免与正常序列冲突。 */
const PROJECTION_TRANSITION_ORDINAL_V1 = { building: 1, ready: 2, failed: 9_000 } as const;

const MEMBER_RELEASE_SLOTS_V1 = [
  { index: 1, sourceKind: "risk-mechanism" },
  { index: 2, sourceKind: "standard-library" },
  { index: 3, sourceKind: "case-library" },
] as const satisfies readonly {
  readonly index: number;
  readonly sourceKind: RetrievalSourceKindV1;
}[];

/** 检索策略的版本化来源；生产由组合根注入甲方发布配置，handler 不写默认值。 */
export interface HybridRetrievalPolicyProviderV1 {
  resolveExact(input: {
    readonly projectId: string;
    readonly evidenceBaseReleaseRef: RetrievalEvidenceBaseReleaseRefV1;
    readonly requiredAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<HybridRetrievalPolicyV1 | undefined>;
}

/** 固定数据集质量门禁；构建只有在门禁通过后才能 ready。 */
export interface HybridRetrievalBuildQualityGateV1 {
  evaluate(
    input: {
      readonly projectId: string;
      readonly generationRef: RetrievalGenerationRefV1;
      readonly manifest: RetrievalIndexManifestV1;
      readonly reconciliation: RetrievalReconciliationV1;
      readonly policy: HybridRetrievalPolicyV1;
    },
    context?: TransactionContextV1,
  ): Promise<{ readonly passed: boolean; readonly detailCode: string }>;
}

/** 组合根的 C06 受信来源：为投影构建签发工程级调用上下文。 */
export type HybridRetrievalProjectionAuthorizationSourceV1 = (input: {
  readonly projectId: string;
  readonly eventId: string;
  readonly requiredAt: string;
}) => Promise<AuthorizationContextV1>;

export interface VersionedHybridRetrievalProjectionHandlerOptionsV1 {
  readonly idempotentConsumer: IdempotentConsumerV1;
  readonly sourceFacts: IdentificationKnowledgeReleaseReaderV1;
  readonly modelGateway: Pick<ModelGatewayPortV1, "embed">;
  readonly generationStore: RetrievalGenerationStoreV1;
  readonly projection: RetrievalProjectionPortV1;
  readonly policyProvider: HybridRetrievalPolicyProviderV1;
  readonly qualityGate: HybridRetrievalBuildQualityGateV1;
  readonly authorize: HybridRetrievalProjectionAuthorizationSourceV1;
  readonly budgetPolicyRef: VersionReference;
  readonly now?: () => Date;
  readonly failureSink?: {
    record(failure: HybridRetrievalFailureV1): Promise<void>;
  };
}

export type HybridRetrievalProjectionOutcomeV1 =
  | { readonly kind: "ignored"; readonly reason: string }
  | { readonly kind: "projected"; readonly consumer: ConsumerResultV1 }
  | { readonly kind: "rejected"; readonly failure: HybridRetrievalFailureV1 };

type ProjectionEvent = Extract<
  DomainEventV1,
  { eventType: typeof HYBRID_RETRIEVAL_PROJECTION_EVENT_TYPE_V1 }
>;

const sameReference = (left: VersionReference, right: VersionReference): boolean =>
  left.entityId === right.entityId && left.versionId === right.versionId;

const memberSourcesFromReads = (
  reads: readonly {
    readonly sourceKind: RetrievalSourceKindV1;
    readonly read: IdentificationKnowledgeExactReadV1;
  }[],
): readonly RetrievalMemberSourceV1[] =>
  reads.map(({ sourceKind, read }) => {
    const sourceReleaseRef = read.releaseBinding.releaseRef;
    if (read.package.definitionType === "risk-mechanism") {
      return {
        sourceKind,
        sourceReleaseRef,
        entries: read.package.mechanisms.map((mechanism) => ({
          entryId: mechanism.mechanismId,
          entry: mechanism as unknown as Readonly<Record<string, unknown>>,
        })),
      };
    }
    if (
      read.package.definitionType === "standard-library" ||
      read.package.definitionType === "case-library"
    ) {
      return {
        sourceKind,
        sourceReleaseRef,
        entries: read.package.entries.map((entry) => ({
          entryId: entry.entryId,
          entry: entry as unknown as Readonly<Record<string, unknown>>,
        })),
      };
    }
    return { sourceKind, sourceReleaseRef, entries: [] };
  });

/** 可重试失败的内部信号：C03 消费失败记账后按至少一次投递重投。 */
export class ProjectionRetryError extends Error {
  readonly code: string;
  readonly detailCode: string;

  constructor(code: string, detailCode: string) {
    super(`hybrid retrieval projection retryable failure: ${code}/${detailCode}`);
    this.name = "ProjectionRetryError";
    this.code = code;
    this.detailCode = detailCode;
  }
}

export class VersionedHybridRetrievalProjectionHandler {
  readonly #options: VersionedHybridRetrievalProjectionHandlerOptionsV1;
  readonly #now: () => Date;

  constructor(options: VersionedHybridRetrievalProjectionHandlerOptionsV1) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
  }

  async handle(event: DomainEventV1): Promise<HybridRetrievalProjectionOutcomeV1> {
    const parsed = DomainEventV1Schema.safeParse(event);
    if (!parsed.success) {
      return {
        kind: "rejected",
        failure: this.#failure(undefined, {
          stage: "event",
          code: "UNSUPPORTED_EVENT_VERSION",
          detailCode: "event-contract-invalid",
        }),
      };
    }
    if (parsed.data.eventType !== HYBRID_RETRIEVAL_PROJECTION_EVENT_TYPE_V1) {
      return { kind: "ignored", reason: `event-type-${parsed.data.eventType}` };
    }
    const target = parsed.data as ProjectionEvent;
    if (target.eventVersion !== 1) {
      return {
        kind: "rejected",
        failure: this.#failure(
          { projectId: target.projectId, eventId: target.eventId },
          {
            stage: "event",
            code: "UNSUPPORTED_EVENT_VERSION",
            detailCode: `event-version-${String(target.eventVersion)}`,
          },
        ),
      };
    }

    let outcome: HybridRetrievalProjectionOutcomeV1 | undefined;
    let consumer: ConsumerResultV1 | undefined;
    try {
      consumer = await this.#options.idempotentConsumer.consume(
        HYBRID_RETRIEVAL_CONSUMER_NAME_V1,
        target,
        async (context) => {
          const result = await this.#project(target, context);
          outcome = result;
          if (result.kind === "rejected" && result.failure.retryable) {
            // 可重试失败必须在消费事务内抛出：C03 保持 pending 回执并安排至少一次重投。
            throw new ProjectionRetryError(result.failure.code, result.failure.detailCode);
          }
          if (result.kind === "rejected") {
            await this.#recordPermanentFailure(target, result.failure, context);
          }
          return { resultRef: target.payload.retrievalEvidenceBaseReleaseRef };
        },
      );
    } catch (error) {
      // 永久失败的 transition/回执若未提交，不能伪装成已记录的拒绝。
      if (outcome?.kind !== "rejected" || !outcome.failure.retryable) throw error;
    }
    const settled = outcome;
    if (settled === undefined) {
      // 已完成的消费者回执不会再次执行 handler：直接复用既有结果，不重复投影。
      if (consumer !== undefined) return { kind: "projected", consumer };
      throw new ProjectionRetryError("GENERATION_NOT_READY", "projection-outcome-missing");
    }
    if (settled.kind === "rejected") {
      await this.#options.failureSink?.record(settled.failure);
      return settled;
    }
    if (consumer === undefined)
      throw new ProjectionRetryError("GENERATION_NOT_READY", "missing-consumer-result");
    return { kind: "projected", consumer };
  }

  #failure(
    context: { readonly projectId?: string; readonly eventId?: string } | undefined,
    input: {
      readonly stage: HybridRetrievalFailureV1["stage"];
      readonly code: HybridRetrievalFailureV1["code"];
      readonly detailCode: string;
      readonly retryable?: boolean;
      readonly generationRef?: RetrievalGenerationRefV1;
    },
  ): HybridRetrievalFailureV1 {
    return hybridRetrievalFailure({
      stage: input.stage,
      code: input.code,
      detailCode: input.detailCode,
      retryable: input.retryable ?? false,
      ...(context?.projectId === undefined ? {} : { projectId: context.projectId }),
      ...(context?.eventId === undefined ? {} : { eventId: context.eventId }),
      ...(input.generationRef === undefined ? {} : { generationRef: input.generationRef }),
      occurredAt: this.#now().toISOString(),
    });
  }

  /** 永久失败与消费者回执在同一事务内收口。 */
  async #recordPermanentFailure(
    event: ProjectionEvent,
    failure: HybridRetrievalFailureV1,
    context: TransactionContextV1,
  ): Promise<void> {
    const generationRef = failure.generationRef;
    if (
      generationRef === undefined ||
      (await this.#options.generationStore.readGeneration(generationRef, context)) === undefined
    ) {
      await this.#options.generationStore.recordProjectionFailure({
        projectId: event.projectId,
        eventId: event.eventId,
        targetRef: event.payload.retrievalEvidenceBaseReleaseRef,
        failure,
        actorRef: "hybrid-retrieval-projection",
        authorizationContextRef: event.authorizationContextRef,
        context,
      });
      return;
    }
    await this.#options.generationStore.appendTransition({
      transition: {
        schemaVersion: "1",
        transitionRef: {
          kind: "retrieval-generation-transition",
          reference: {
            entityId: `${generationRef.reference.entityId}:${PROJECTION_TRANSITION_ORDINAL_V1.failed}`,
            versionId: `${failure.code}:${failure.detailCode}`,
          },
        },
        generationRef,
        ordinal: PROJECTION_TRANSITION_ORDINAL_V1.failed,
        status: "failed",
        occurredAt: failure.occurredAt,
        failureCode: failure.code,
        noteCode: failure.detailCode,
      } satisfies RetrievalGenerationTransitionV1,
      actorRef: "hybrid-retrieval-projection",
      authorizationContextRef: {
        kind: "authorization-context",
        reference: { entityId: "hybrid-retrieval-projection", versionId: failure.detailCode },
      },
      contextRefs: [],
      context,
    });
  }

  async #project(
    event: ProjectionEvent,
    context: TransactionContextV1,
  ): Promise<HybridRetrievalProjectionOutcomeV1> {
    const { sourceFacts, modelGateway, generationStore, projection, policyProvider, qualityGate } =
      this.#options;
    const projectId = event.projectId;
    const eventId = event.eventId;
    const requiredAt = event.occurredAt;
    const reject = (input: {
      readonly stage: HybridRetrievalFailureV1["stage"];
      readonly code: HybridRetrievalFailureV1["code"];
      readonly detailCode: string;
      readonly retryable?: boolean;
      readonly generationRef?: RetrievalGenerationRefV1;
    }): HybridRetrievalProjectionOutcomeV1 => ({
      kind: "rejected",
      failure: this.#failure({ projectId, eventId }, input),
    });

    const memberSlots = MEMBER_RELEASE_SLOTS_V1.map((slot) => ({
      sourceKind: slot.sourceKind,
      releaseRef: event.payload.publishedReleases[slot.index]!.releaseRef,
    }));
    const compositeRef = event.payload.publishedReleases[4]!.releaseRef;
    if (
      !sameReference(
        compositeRef.reference,
        event.payload.retrievalEvidenceBaseReleaseRef.reference,
      )
    ) {
      return reject({
        stage: "event",
        code: "SOURCE_FACT_DRIFT",
        detailCode: "composite-release-mismatch",
      });
    }

    const authorization = await this.#options.authorize({ projectId, eventId, requiredAt });
    if (!authorization.grantedCapabilities.includes("knowledge-modeling.retrieve")) {
      return reject({
        stage: "authorization",
        code: "AUTHORIZATION_DENIED",
        detailCode: "projection-authorization-missing-capability",
      });
    }
    const scopeDigest = authorizationScopeDigest(authorization);

    const resolvedPolicy = await policyProvider.resolveExact({
      projectId,
      evidenceBaseReleaseRef: event.payload.retrievalEvidenceBaseReleaseRef,
      requiredAt,
      authorization,
    });
    if (resolvedPolicy === undefined) {
      return reject({
        stage: "source-read",
        code: "POLICY_NOT_FOUND",
        detailCode: "retrieval-policy-not-published",
      });
    }
    const policy = HybridRetrievalPolicyV1Schema.parse(resolvedPolicy);

    let serviceVersion: string;
    try {
      serviceVersion = (await projection.serviceVersion()).version;
    } catch {
      return reject({
        stage: "projection",
        code: "QDRANT_UNAVAILABLE",
        detailCode: "service-version-unavailable",
        retryable: true,
      });
    }
    const compatibilityRef = projectionCompatibilityRefFor({ serviceVersion, policy });
    const generationRef = retrievalGenerationRefFor({
      projectId,
      sourceEventId: eventId,
      evidenceBaseReleaseRef: event.payload.retrievalEvidenceBaseReleaseRef,
      memberReleaseRefs: {
        riskMechanismRef: memberSlots[0]!.releaseRef,
        standardLibraryRef: memberSlots[1]!.releaseRef,
        caseLibraryRef: memberSlots[2]!.releaseRef,
      },
      policyRef: policy.policyRef,
      modelDeploymentRef: policy.modelDeploymentRef,
      projectionCompatibilityRef: compatibilityRef,
    });
    const collectionName = retrievalCollectionNameFor(generationRef);
    const baselineActivation = await generationStore.readCurrentActivation({
      projectId,
      evidenceBaseReleaseRef: event.payload.retrievalEvidenceBaseReleaseRef,
      lock: false,
      context,
    });

    const reads: {
      sourceKind: RetrievalSourceKindV1;
      read: IdentificationKnowledgeExactReadV1;
    }[] = [];
    for (const slot of memberSlots) {
      const outcome = await sourceFacts.readExact({
        projectId,
        releaseRef: slot.releaseRef,
        actorId: authorization.actorId,
        requestedAt: requiredAt,
        invocationId: `hybrid-retrieval-projection-${eventId}`,
        authorization,
      });
      if (outcome.kind === "failed") {
        return reject({
          stage: "source-read",
          code:
            outcome.error.code === "AUTHORIZATION_DENIED"
              ? "AUTHORIZATION_DENIED"
              : "SOURCE_FACT_DRIFT",
          detailCode: `member-read-${outcome.error.code}`,
        });
      }
      if (outcome.read.releaseBinding.definitionType !== slot.sourceKind) {
        return reject({
          stage: "source-read",
          code: "SOURCE_FACT_DRIFT",
          detailCode: `member-definition-type-${slot.sourceKind}`,
        });
      }
      reads.push({ sourceKind: slot.sourceKind, read: outcome.read });
    }

    const compositeRead = await sourceFacts.readExact({
      projectId,
      releaseRef: compositeRef,
      actorId: authorization.actorId,
      requestedAt: requiredAt,
      invocationId: `hybrid-retrieval-projection-composite-${eventId}`,
      authorization,
    });
    if (compositeRead.kind === "failed") {
      return reject({
        stage: "source-read",
        code: "SOURCE_FACT_DRIFT",
        detailCode: `composite-read-${compositeRead.error.code}`,
        generationRef,
      });
    }
    const compositeMembers = compositeRead.read.releaseBinding.compositeMemberReleaseRefs ?? [];
    if (
      compositeRead.read.package.definitionType !== "retrieval-evidence-base" ||
      compositeMembers.length !== memberSlots.length ||
      memberSlots.some(
        (slot, index) =>
          !sameReference(compositeMembers[index]!.reference, slot.releaseRef.reference),
      )
    ) {
      return reject({
        stage: "reconciliation",
        code: "SOURCE_FACT_DRIFT",
        detailCode: "composite-member-reference-mismatch",
        generationRef,
      });
    }

    const normalized = normalizeRetrievalMembers({
      projectId,
      generationRef,
      policy,
      authorizationScopeDigest: scopeDigest,
      sources: memberSourcesFromReads(reads),
    });
    if (normalized.kind === "failed") {
      return reject({
        stage: "reconciliation",
        code: normalized.code,
        detailCode: normalized.detailCode,
        generationRef,
      });
    }
    const { manifest, points } = normalized;

    const denseVectors: { pointId: string; vector: readonly number[] }[] = [];
    for (let offset = 0; offset < points.length; offset += policy.memberBatchLimit) {
      const batch = points.slice(offset, offset + policy.memberBatchLimit);
      const issuedAt = this.#now();
      let embedding: EmbeddingResultV1;
      try {
        embedding = await modelGateway.embed(
          EmbeddingRequestV1Schema.parse({
            schemaVersion: "1",
            invocationId: `hybrid-retrieval-projection-embed-${eventId}-${offset}`,
            idempotencyKey: `hybrid-retrieval-projection-embed:${eventId}:${offset}`,
            issuedAt: issuedAt.toISOString(),
            projectId,
            actorId: authorization.actorId,
            authorization,
            requiredCapability: "knowledge-modeling.retrieve",
            modelDeploymentRef: policy.modelDeploymentRef,
            budgetPolicyRef: this.#options.budgetPolicyRef,
            deadlineAt: new Date(issuedAt.getTime() + policy.embeddingTimeoutMs).toISOString(),
            parentArtifactRefs: [],
            evidenceReferences: [],
            texts: batch.map((point) => point.text),
            maxInputBytes: policy.memberByteLimit,
            maxBatchItems: policy.memberBatchLimit,
          }),
          AbortSignal.timeout(policy.embeddingTimeoutMs),
        );
      } catch {
        return reject({
          stage: "embedding",
          code: "EMBEDDING_FAILED",
          detailCode: "member-embedding-call-failed",
          retryable: true,
          generationRef,
        });
      }
      if (
        embedding.modelDeploymentRef.entityId !== policy.modelDeploymentRef.entityId ||
        embedding.modelDeploymentRef.versionId !== policy.modelDeploymentRef.versionId
      ) {
        return reject({
          stage: "embedding",
          code: "POLICY_INCOMPATIBLE",
          detailCode: "embedding-deployment-mismatch",
          generationRef,
        });
      }
      if (
        embedding.dimensions !== policy.dense.dimensions ||
        embedding.vectors.length !== batch.length
      ) {
        return reject({
          stage: "embedding",
          code: "EMBEDDING_DIMENSION_MISMATCH",
          detailCode: "member-embedding-dimensions",
          generationRef,
        });
      }
      batch.forEach((point, index) => {
        denseVectors.push({ pointId: point.pointId, vector: embedding.vectors[index]! });
      });
    }

    const generation: RetrievalGenerationV1 = {
      schemaVersion: "1",
      generationRef,
      identity: {
        projectId,
        sourceEventId: eventId,
        evidenceBaseReleaseRef: event.payload.retrievalEvidenceBaseReleaseRef,
        memberReleaseRefs: {
          riskMechanismRef: memberSlots[0]!.releaseRef,
          standardLibraryRef: memberSlots[1]!.releaseRef,
          caseLibraryRef: memberSlots[2]!.releaseRef,
        },
        policyRef: policy.policyRef,
        modelDeploymentRef: policy.modelDeploymentRef,
        projectionCompatibilityRef: compatibilityRef,
      },
      collectionName,
      authorizationScopeDigest: scopeDigest,
      expectedMemberCount: manifest.members.length,
      manifestSha256: manifest.membersSha256,
      createdAt: this.#now().toISOString(),
      createdBy: authorization.actorId,
      authorizationContextRef: authorization.authorizationContextRef,
    };
    const ensured = await generationStore.ensureBuildingGeneration({
      generation,
      transitionRef: {
        kind: "retrieval-generation-transition",
        reference: {
          entityId: `${generationRef.reference.entityId}:${PROJECTION_TRANSITION_ORDINAL_V1.building}`,
          versionId: manifest.membersSha256,
        },
      },
      actorRef: authorization.actorId,
      authorizationContextRef: authorization.authorizationContextRef,
      occurredAt: generation.createdAt,
      context,
    });
    if (
      ensured.generation.manifestSha256 !== generation.manifestSha256 ||
      ensured.generation.collectionName !== generation.collectionName ||
      ensured.generation.identity.sourceEventId !== generation.identity.sourceEventId
    ) {
      return reject({
        stage: "reconciliation",
        code: "SOURCE_FACT_DRIFT",
        detailCode: "generation-identity-drift",
        generationRef,
      });
    }
    if (ensured.status === "failed") {
      return reject({
        stage: "reconciliation",
        code: "GENERATION_NOT_READY",
        detailCode: "generation-previously-failed",
        generationRef,
      });
    }

    try {
      await projection.ensureCollection({ collectionName, policy });
      await projection.upsertMembers({
        collectionName,
        policy,
        manifest,
        texts: points.map((point) => ({ pointId: point.pointId, text: point.text })),
        denseVectors,
      });
    } catch {
      return reject({
        stage: "projection",
        code: "QDRANT_UNAVAILABLE",
        detailCode: "projection-write-failed",
        retryable: true,
        generationRef,
      });
    }

    let observed;
    try {
      observed = await projection.inspectGeneration({
        collectionName,
        generationRef,
        pageSize: Math.min(policy.memberLimit, 256),
        maxPoints: policy.memberLimit,
      });
    } catch {
      return reject({
        stage: "reconciliation",
        code: "QDRANT_UNAVAILABLE",
        detailCode: "projection-inspect-failed",
        retryable: true,
        generationRef,
      });
    }
    const reconciliation = reconcileDualIndexManifest({ projectId, expected: manifest, observed });
    if (!reconciliation.consistent) {
      return reject({
        stage: "reconciliation",
        code: "DUAL_INDEX_MISMATCH",
        detailCode: reconciliation.differences[0]?.code ?? "manifest-mismatch",
        generationRef,
      });
    }

    const gate = await qualityGate.evaluate(
      {
        projectId,
        generationRef,
        manifest,
        reconciliation,
        policy,
      },
      context,
    );
    if (!gate.passed) {
      return reject({
        stage: "quality",
        code: "QUALITY_GATE_FAILED",
        detailCode: gate.detailCode,
        generationRef,
      });
    }

    await generationStore.appendTransition({
      transition: {
        schemaVersion: "1",
        transitionRef: {
          kind: "retrieval-generation-transition",
          reference: {
            entityId: `${generationRef.reference.entityId}:${PROJECTION_TRANSITION_ORDINAL_V1.ready}`,
            versionId: manifest.membersSha256,
          },
        },
        generationRef,
        ordinal: PROJECTION_TRANSITION_ORDINAL_V1.ready,
        status: "ready",
        occurredAt: this.#now().toISOString(),
        manifestSha256: manifest.membersSha256,
        noteCode: "projection-reconciled",
      } satisfies RetrievalGenerationTransitionV1,
      actorRef: authorization.actorId,
      authorizationContextRef: authorization.authorizationContextRef,
      contextRefs: [event.payload.retrievalEvidenceBaseReleaseRef],
      context,
    });

    const currentActivation = await generationStore.readCurrentActivation({
      projectId,
      evidenceBaseReleaseRef: event.payload.retrievalEvidenceBaseReleaseRef,
      context,
    });
    if (
      currentActivation?.activationOrdinal !== baselineActivation?.activationOrdinal ||
      currentActivation?.generationRef.reference.versionId !==
        baselineActivation?.generationRef.reference.versionId
    ) {
      return reject({
        stage: "activation",
        code: "ACTIVATION_CONFLICT",
        detailCode: "concurrent-activation",
        retryable: true,
        generationRef,
      });
    }
    const activation = await generationStore.activateGeneration({
      activation: {
        schemaVersion: "1",
        generationRef,
        projectId,
        evidenceBaseReleaseRef: event.payload.retrievalEvidenceBaseReleaseRef,
        policyRef: policy.policyRef,
        authorizationScopeDigest: scopeDigest,
        activationOrdinal: (currentActivation?.activationOrdinal ?? 0) + 1,
        ...(currentActivation === undefined
          ? {}
          : { previousGenerationRef: currentActivation.generationRef }),
        activatedAt: this.#now().toISOString(),
        actorRef: authorization.actorId,
        authorizationContextRef: authorization.authorizationContextRef,
      },
      contextRefs: [event.payload.retrievalEvidenceBaseReleaseRef],
      context,
    });
    if (activation.kind === "activation-conflict") {
      return reject({
        stage: "activation",
        code: "ACTIVATION_CONFLICT",
        detailCode: "concurrent-activation",
        retryable: true,
        generationRef,
      });
    }
    return {
      kind: "projected",
      consumer: { resultRef: event.payload.retrievalEvidenceBaseReleaseRef, replayed: false },
    };
  }
}
