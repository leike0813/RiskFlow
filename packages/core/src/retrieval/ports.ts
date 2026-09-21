import type {
  AuthorizationContextRefV1,
  AuthorizationContextV1,
  ContractReferenceV1,
  KnowledgeQueryResultRefV1,
} from "@riskflow/contracts/ports";

import type { ArtifactRefV1 } from "../artifacts/index.js";
import type { TransactionContextV1 } from "../persistence/index.js";

import type {
  HybridRetrievalInputRefsV1,
  HybridRetrievalPolicyV1,
  HybridRetrievalQueryInputV1,
  RetrievalActivationV1,
  RetrievalEvidenceBaseReleaseRefV1,
  RetrievalGenerationRefV1,
  RetrievalGenerationTransitionV1,
  RetrievalGenerationV1,
  RetrievalHybridQueryResultV1,
  RetrievalHybridQueryV1,
  RetrievalIndexManifestV1,
  RetrievalProjectionObservationV1,
  Sha256V1,
} from "./schema.js";

/**
 * C20 跨层必需端口（design D2）。策略、身份、状态与对账规则在核心层实现；
 * PostgreSQL 事实、Qdrant 投影和冻结查询输入各自以最小端口注入，不再包一层抽象。
 */

export interface RetrievalGenerationStoreV1 {
  /** 幂等创建 `building` 代际事实；同身份字段不一致时返回已存在事实供调用方判定漂移。 */
  ensureBuildingGeneration(input: {
    readonly generation: RetrievalGenerationV1;
    readonly transitionRef: RetrievalGenerationTransitionV1["transitionRef"];
    readonly actorRef: string;
    readonly authorizationContextRef: AuthorizationContextRefV1;
    readonly occurredAt: string;
    /** C03 消费/事务的 ambient 上下文：传入时必须复用该事务，保证与消费者回执同事务提交。 */
    readonly context?: TransactionContextV1;
  }): Promise<{
    readonly generation: RetrievalGenerationV1;
    readonly created: boolean;
    readonly status: string;
  }>;
  readGeneration(
    generationRef: RetrievalGenerationRefV1,
    context?: TransactionContextV1,
  ): Promise<RetrievalGenerationV1 | undefined>;
  /** 只读返回最近一次被事务提交的状态；未提交的 building 事实不参与查询选择。 */
  readGenerationStatus(
    generationRef: RetrievalGenerationRefV1,
    context?: TransactionContextV1,
  ): Promise<string | undefined>;
  appendTransition(input: {
    readonly transition: RetrievalGenerationTransitionV1;
    readonly actorRef: string;
    readonly authorizationContextRef: AuthorizationContextRefV1;
    readonly contextRefs: readonly ContractReferenceV1[];
    readonly context?: TransactionContextV1;
  }): Promise<void>;
  /** 精确读取与发布、策略和授权摘要匹配的 active + ready 代际；无匹配返回 undefined。 */
  readActiveGeneration(input: {
    readonly projectId: string;
    readonly evidenceBaseReleaseRef: RetrievalEvidenceBaseReleaseRefV1;
    readonly policyRef: HybridRetrievalPolicyV1["policyRef"];
    readonly authorizationScopeDigest: Sha256V1;
    readonly context?: TransactionContextV1;
  }): Promise<RetrievalGenerationV1 | undefined>;
  readActivation(
    generationRef: RetrievalGenerationRefV1,
    context?: TransactionContextV1,
  ): Promise<RetrievalActivationV1 | undefined>;
  /** compare-and-swap 激活：基于当前活动版本追加 activation，失配返回冲突且不改写历史。 */
  activateGeneration(input: {
    readonly activation: RetrievalActivationV1;
    readonly contextRefs: readonly ContractReferenceV1[];
    readonly context?: TransactionContextV1;
  }): Promise<{ readonly kind: "activated" } | { readonly kind: "activation-conflict" }>;
  /** `{projectId, queryId}` 幂等登记正式结果；同键异载荷返回冲突且不覆盖既有结果。 */
  registerQueryResult(input: {
    readonly projectId: string;
    readonly queryId: string;
    readonly requestDigest: Sha256V1;
    readonly generationRef: RetrievalGenerationRefV1;
    readonly policyRef: HybridRetrievalPolicyV1["policyRef"];
    readonly authorizationScopeDigest: Sha256V1;
    readonly resultArtifactRef: ArtifactRefV1;
    readonly knowledgeQueryResultRef: KnowledgeQueryResultRefV1;
    readonly recordedAt: string;
    readonly actorRef: string;
    readonly authorizationContextRef: AuthorizationContextRefV1;
    readonly context?: TransactionContextV1;
  }): Promise<
    | { readonly kind: "registered"; readonly replayed: boolean }
    | { readonly kind: "idempotency-conflict" }
  >;
  readQueryResult(
    input: { readonly projectId: string; readonly queryId: string },
    context?: TransactionContextV1,
  ): Promise<
    | {
        readonly requestDigest: Sha256V1;
        readonly knowledgeQueryResultRef: KnowledgeQueryResultRefV1;
        readonly resultArtifactRef: ArtifactRefV1;
      }
    | undefined
  >;
}

/** Qdrant 检索投影端口；只承载可删除、可重建的检索投影，不承载业务事实。 */
export interface RetrievalProjectionPortV1 {
  serviceVersion(): Promise<{ readonly version: string }>;
  ensureCollection(input: {
    readonly collectionName: string;
    readonly policy: HybridRetrievalPolicyV1;
  }): Promise<{ readonly created: boolean }>;
  upsertMembers(input: {
    readonly collectionName: string;
    readonly policy: HybridRetrievalPolicyV1;
    readonly manifest: RetrievalIndexManifestV1;
    readonly texts: readonly { readonly pointId: string; readonly text: string }[];
    readonly denseVectors: readonly {
      readonly pointId: string;
      readonly vector: readonly number[];
    }[];
  }): Promise<void>;
  inspectGeneration(input: {
    readonly collectionName: string;
    readonly generationRef: RetrievalGenerationRefV1;
    readonly pageSize: number;
    readonly maxPoints: number;
  }): Promise<RetrievalProjectionObservationV1>;
  queryHybrid(input: RetrievalHybridQueryV1): Promise<RetrievalHybridQueryResultV1>;
  /** 按精确代际删除其 collection；不接受空泛匹配，也不做隐式回收。 */
  deleteGenerationCollection(input: {
    readonly collectionName: string;
    readonly generationRef: RetrievalGenerationRefV1;
  }): Promise<{ readonly deleted: boolean }>;
  listRetrievalCollections(input: { readonly namePrefix: string }): Promise<readonly string[]>;
}

/** 冻结查询输入窄读端口：按三个公共引用解析查询文本、策略、发布与当前授权。 */
export interface HybridRetrievalInputReaderV1 {
  readExact(input: {
    readonly refs: HybridRetrievalInputRefsV1;
    readonly projectId: string;
    readonly queryId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly invocationId?: string;
  }): Promise<
    | { readonly kind: "succeeded"; readonly input: HybridRetrievalQueryInputV1 }
    | {
        readonly kind: "failed";
        readonly code: "AUTHORIZATION_DENIED" | "POLICY_NOT_FOUND" | "RETRIEVAL_INPUT_DRIFT";
        readonly detailCode: string;
      }
  >;
}
