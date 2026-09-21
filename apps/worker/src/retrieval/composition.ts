import type { KnowledgeModelingPortV1 } from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import type { IdentificationKnowledgeReleaseReaderV1 } from "@riskflow/core/identification-knowledge";
import type { ModelGatewayPortV1 } from "@riskflow/core/model";
import type { IdempotentConsumerV1, TransactionUnitV1 } from "@riskflow/core/persistence";
import {
  HybridRetrievalService,
  type HybridRetrievalInputReaderV1,
} from "@riskflow/core/retrieval";

import {
  PostgresRetrievalAdapter,
  QdrantRetrievalProjection,
  type PostgresRetrievalAdapterOptionsV1,
} from "@riskflow/adapters/retrieval";

import {
  VersionedHybridRetrievalProjectionHandler,
  type HybridRetrievalBuildQualityGateV1,
  type HybridRetrievalPolicyProviderV1,
  type HybridRetrievalProjectionAuthorizationSourceV1,
} from "./projection-handler.js";

/**
 * C20 生产组合根（design D12）：显式注入全部生产依赖，构建投影 handler 与查询服务，
 * 并把查询服务以 `retrievalDelegate` 暴露给 C17 组合。这里不创建第二套检索服务，
 * 也不允许把任一必需依赖替换成默认值或内存实现。
 */
export interface HybridRetrievalProjectionCompositionOptionsV1 {
  /** PostgreSQL 事实存储（C03 事务单元 + Kysely 连接）。 */
  readonly generationStore: PostgresRetrievalAdapterOptionsV1;
  /** Qdrant 检索投影服务地址。 */
  readonly qdrant: { readonly baseUrl: string; readonly requestTimeoutMs?: number };
  readonly transactionUnit: TransactionUnitV1;
  readonly idempotentConsumer: IdempotentConsumerV1;
  readonly sourceFacts: IdentificationKnowledgeReleaseReaderV1;
  readonly modelGateway: ModelGatewayPortV1;
  readonly artifactStore: ArtifactStoreV1;
  readonly policyProvider: HybridRetrievalPolicyProviderV1;
  readonly qualityGate: HybridRetrievalBuildQualityGateV1;
  /** 冻结查询输入窄读；由 C21/C24 组合提供，C20 不实现内存回退。 */
  readonly queryInputReader: HybridRetrievalInputReaderV1;
  readonly authorize: HybridRetrievalProjectionAuthorizationSourceV1;
  readonly budgetPolicyRef: VersionReference;
  readonly now?: () => Date;
}

export interface HybridRetrievalProjectionCompositionV1 {
  readonly projectionHandler: VersionedHybridRetrievalProjectionHandler;
  readonly retrievalService: HybridRetrievalService;
  /** C17 知识门面的可选委派实现：同一查询对象原样转发。 */
  readonly retrievalDelegate: Pick<KnowledgeModelingPortV1, "retrieve">;
}

export const createHybridRetrievalProjectionComposition = (
  options: HybridRetrievalProjectionCompositionOptionsV1,
): HybridRetrievalProjectionCompositionV1 => {
  const generationStore = new PostgresRetrievalAdapter(options.generationStore);
  const projection = new QdrantRetrievalProjection({
    baseUrl: options.qdrant.baseUrl,
    ...(options.qdrant.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: options.qdrant.requestTimeoutMs }),
  });
  const projectionHandler = new VersionedHybridRetrievalProjectionHandler({
    idempotentConsumer: options.idempotentConsumer,
    sourceFacts: options.sourceFacts,
    modelGateway: options.modelGateway,
    generationStore,
    projection,
    policyProvider: options.policyProvider,
    qualityGate: options.qualityGate,
    authorize: options.authorize,
    budgetPolicyRef: options.budgetPolicyRef,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const retrievalService = new HybridRetrievalService({
    inputReader: options.queryInputReader,
    generationStore,
    projection,
    sourceFacts: options.sourceFacts,
    modelGateway: options.modelGateway,
    artifactStore: options.artifactStore,
    budgetPolicyRef: options.budgetPolicyRef,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return {
    projectionHandler,
    retrievalService,
    retrievalDelegate: { retrieve: (query) => retrievalService.retrieve(query) },
  };
};
