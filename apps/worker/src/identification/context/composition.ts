import type { KnowledgeModelingPortV1 } from "@riskflow/contracts/ports";
import type { ArtifactStoreV1, ArtifactReferenceGuardV1 } from "@riskflow/core/artifacts";
import { ArtifactPutCommandV1Schema } from "@riskflow/core/artifacts";
import { AgentTaskDefinitionRegistry } from "@riskflow/core/agent-runtime";
import {
  IdentificationContextService,
  type HybridRetrievalPolicyReaderV1,
  type AgentTaskSnapshotReaderV1,
  type IdentificationContextAuthorizationPortV1,
  type IdentificationContextInputReaderV1,
  type RetrievalReviewPolicyV1,
} from "@riskflow/core/identification/context";
import type { IdentificationKnowledgeReleaseReaderV1 } from "@riskflow/core/identification-knowledge";
import type { TransactionUnitV1 } from "@riskflow/core/persistence";
import type { ModelContextReaderV1 } from "@riskflow/core/identification/candidate-finalization";
import type {
  HybridRetrievalInputReaderV1,
  RetrievalGenerationStoreV1,
} from "@riskflow/core/retrieval";

import {
  createPostgresIdentificationContextAdapter,
  createPostgresOfficialHybridResultReader,
  type PostgresIdentificationContextAdapter,
} from "@riskflow/adapters/identification/context";

import {
  createAgentRuntimeRunner,
  type AgentRuntimeRunner,
  type AgentRuntimeRunnerOptionsV1,
} from "../../agent-runtime/index.js";
import {
  withRetrievalReviewModelStep,
  type RetrievalReviewModelStepCallbacksV1,
} from "./runtime.js";

/**
 * C21 生产组合根（design D-01）：只组合 C20 正式检索服务、C17 精确窄读、共享 C08 registry
 * 与 C21 自有登记表，并把两个查询分支交给**同一个** `retrievalDelegate` 注入位。
 * 任一必需依赖缺失时构造阶段拒绝，不产生部分组合，也不提供内存回退。
 */
export interface IdentificationContextCompositionOptionsV1 {
  /** PostgreSQL 事实存储（C21 登记表 + C20 只读结果行）。 */
  readonly db: unknown;
  readonly transactionUnit: TransactionUnitV1;
  readonly artifactStore: ArtifactStoreV1;
  /** C24 冻结输入生产者；缺失即拒绝构造。 */
  readonly inputReader: IdentificationContextInputReaderV1;
  /** C06 授权签发与复验接缝。 */
  readonly authorization: IdentificationContextAuthorizationPortV1;
  readonly knowledgeReader: IdentificationKnowledgeReleaseReaderV1;
  readonly hybridPolicy: HybridRetrievalPolicyReaderV1;
  readonly hybridStore: Pick<RetrievalGenerationStoreV1, "readQueryResult">;
  /** C20 正式混合检索服务；补搜与基线都走这一条正式分支。 */
  readonly retrievalService: Pick<KnowledgeModelingPortV1, "retrieve">;
  readonly taskReader: AgentTaskSnapshotReaderV1;
  readonly reviewPolicy: RetrievalReviewPolicyV1;
  /** 共享 C08 registry；C21 只注册 `retrieval-review`，不新建 registry 或 claim 循环。 */
  readonly registry: AgentTaskDefinitionRegistry;
  readonly artifactReferenceGuard?: ArtifactReferenceGuardV1;
  readonly now?: () => Date;
}

export interface IdentificationContextCompositionV1 {
  readonly adapter: PostgresIdentificationContextAdapter;
  readonly service: IdentificationContextService;
  readonly modelContextReader: ModelContextReaderV1;
  /** 唯一委派 router：`relationship-context` 走 C21，其余分支原样交给 C20。 */
  readonly retrievalDelegate: Pick<KnowledgeModelingPortV1, "retrieve">;
  /** 交给 C20 组合的冻结查询输入窄读；C20 不实现内存回退。 */
  readonly queryInputReader: HybridRetrievalInputReaderV1;
  readonly modelStep: RetrievalReviewModelStepCallbacksV1;
  /** 用共享 C08 runner 组装：不创建第二个 claim 循环，只补齐 C21 的模型步与工件写入。 */
  createSharedRunner(
    options: Omit<
      AgentRuntimeRunnerOptionsV1,
      "registry" | "artifactStore" | "renderModelStep" | "interpretModelStep" | "persistArtifact"
    >,
  ): AgentRuntimeRunner;
}

export const createIdentificationContextComposition = (
  options: IdentificationContextCompositionOptionsV1,
): IdentificationContextCompositionV1 => {
  if (
    options.db === undefined ||
    options.transactionUnit === undefined ||
    options.artifactStore === undefined ||
    options.inputReader === undefined ||
    options.authorization === undefined ||
    options.knowledgeReader === undefined ||
    options.hybridPolicy === undefined ||
    options.hybridStore === undefined ||
    options.retrievalService === undefined ||
    options.taskReader === undefined ||
    options.reviewPolicy === undefined ||
    options.registry === undefined
  ) {
    throw new TypeError("identification context composition requires every C03–C21 dependency");
  }
  const adapter = createPostgresIdentificationContextAdapter({
    db: options.db,
    transactionUnit: options.transactionUnit,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const officialHybrid = createPostgresOfficialHybridResultReader({
    retrievalStore: options.hybridStore,
    artifactStore: options.artifactStore,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const service = new IdentificationContextService({
    inputReader: options.inputReader,
    authorization: options.authorization,
    resultStore: adapter,
    officialHybrid,
    retrievalService: options.retrievalService,
    knowledgeReader: options.knowledgeReader,
    hybridPolicy: options.hybridPolicy,
    taskReader: options.taskReader,
    artifactStore: options.artifactStore,
    transactionUnit: options.transactionUnit,
    reviewPolicy: options.reviewPolicy,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  options.registry.register(service.createTaskDefinition());
  const modelStep = withRetrievalReviewModelStep({
    policy: options.reviewPolicy,
    loadModelInput: (task, observationArtifactRef) =>
      service.readReviewModelInput(task, observationArtifactRef),
    persistArtifact: async ({ task, actionId, purposeCode, value }) => {
      const result = await options.artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: `${actionId}:${purposeCode}`,
          idempotencyKey: `${actionId}:${purposeCode}`,
          projectId: task.envelope.projectId,
          actorId: task.envelope.actorId,
          issuedAt: task.envelope.createdAt,
          authorization: task.envelope.authorization,
          requiredCapability: task.envelope.authorization.grantedCapabilities[0],
          artifactId: `${actionId}:${purposeCode}`,
          artifactKind: "content",
          purposeCode,
          mediaType: "application/json",
          parentArtifactRefs: [],
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        (async function* () {
          yield new TextEncoder().encode(JSON.stringify(value));
        })(),
      );
      return result.artifactRef;
    },
    ...(options.now === undefined
      ? {}
      : { now: () => (options.now ?? (() => new Date()))().toISOString() }),
  });
  return {
    modelContextReader: service.modelContextReader,
    adapter,
    service,
    retrievalDelegate: {
      retrieve: (query) =>
        query.kind === "relationship-context"
          ? service.retrieve(query)
          : options.retrievalService.retrieve(query),
    },
    queryInputReader: service.queryInputReader,
    modelStep,
    createSharedRunner: (runnerOptions) =>
      createAgentRuntimeRunner({
        ...runnerOptions,
        registry: options.registry,
        artifactStore: options.artifactStore,
        renderModelStep: modelStep.renderModelStep,
        interpretModelStep: modelStep.interpretModelStep,
      }),
  };
};
