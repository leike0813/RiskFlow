/**
 * C24 生产组合根（design D-01/D-03/D-05，IP-16）。
 *
 * 只组合 C24 自有 PostgreSQL 登记/正文适配器、真实 LangGraph `StateGraph`、真实 PostgreSQL
 * checkpointer、冻结的 C17/C21/C22/C23 端口与本 change 自有的恢复消费者。任一必需依赖缺失时
 * 构造阶段即拒绝，不产生部分组合，不提供内存回退，也不内建策略默认值（策略只来自注入的不可变
 * 策略目录，按精确引用解析）。
 *
 * 恢复消费者只消费既有的 `review.review-resolved.v1` 领域事件：人工决定落地后按事件身份恢复
 * 原线程，同一 `eventId` 重放不产生第二次副作用。C23 任务完成没有对应领域事件，按设计由 C23
 * 完成回执直接调用 `runtime.resume`（`agent-task-completed` 原因），本组合根不新造事件。
 */
import type { DomainEventV1 } from "@riskflow/contracts/events";
import type { AuthorizationContextV1, KnowledgeModelingPortV1 } from "@riskflow/contracts/ports";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import type { AgentTaskPortV1 } from "@riskflow/contracts/ports";
import type { IdentificationContextService } from "@riskflow/core/identification/context";
import type {
  IdentificationReviewDecisionReaderV1 as ContextReviewDecisionReaderV1,
  RiskCandidateFinalizationService,
} from "@riskflow/core/identification/candidate-finalization";
import {
  type IdentificationGraphPolicySetProviderV1,
  type IdentificationGraphRegistrationStoreV1,
  type IdentificationGraphRuntimeV1,
} from "@riskflow/core/identification/graph";
import type {
  IdentificationKnowledgeReleaseReaderV1,
  IdentificationPreparationKnowledgeReaderV1,
} from "@riskflow/core/identification-knowledge";
import type { IdempotentConsumerV1 } from "@riskflow/core/persistence";

import {
  createPostgresIdentificationGraphAdapter,
  type PostgresIdentificationGraphAdapterV1,
} from "@riskflow/adapters/identification/graph";

import type { BaseCheckpointSaver } from "@langchain/langgraph";

import {
  createIdentificationGraph,
  type IdentificationGraphPortsV1,
  type IdentificationGraphRunnerV1,
} from "./graph.js";
import {
  createIdentificationGraphRuntime,
  type IdentificationGraphAuthorizationPortV1,
} from "./runtime.js";

/**
 * C24 逐工作项与逐决策读取的授权复验：与其它模块组合根同形的 C05 注入位，签名与
 * `LocalIdentityAccessV1["verify"]` 逐字一致（组合根不得收窄或改写授权接缝）。
 */
export type IdentificationGraphRequestAuthorizationPortV1 = Parameters<
  typeof createPostgresIdentificationGraphAdapter
>[0]["authorization"];

/** C07 决定窄读与 C22 收窄服务共用同一冻结接口。 */
export type IdentificationGraphReviewDecisionReaderV1 = ContextReviewDecisionReaderV1;

export interface IdentificationGraphCompositionOptionsV1 {
  /** 传 `runtime.db` 即可（`Kysely<PostgresDatabase & IdentificationGraphDatabase>`）。 */
  readonly db: unknown;
  /** C03 事务单元：登记行与业务事实同事务提交。 */
  readonly transactionUnit: IdentificationGraphPortsV1["transactionUnit"];
  /** C04 工件存储：正文只入 C04。 */
  readonly artifactStore: ArtifactStoreV1;
  /** C05 授权复验接缝（适配器逐次受保护读写前复验）。 */
  readonly authorization: IdentificationGraphRequestAuthorizationPortV1;
  /** C05 授权复验接缝（start/resume/cancel 命令入口复验）。 */
  readonly runtimeAuthorization: IdentificationGraphAuthorizationPortV1;
  /** 真实 PostgreSQL checkpointer（`PostgresSaver`）。 */
  readonly checkpointer: BaseCheckpointSaver;
  /** 不可变策略目录：C17/C21/C22 策略正文与重试策略只按精确引用解析。 */
  readonly policyProvider: IdentificationGraphPolicySetProviderV1;
  /** C21 检索审阅策略正文来源（同一策略目录的精确读取）。 */
  readonly reviewPolicy: () => Promise<unknown>;
  /** C17 识别依据精确解析。 */
  readonly basisResolver: Pick<KnowledgeModelingPortV1, "resolve">;
  /** C17/C21 准备快照精确窄读。 */
  readonly preparationReader: Pick<
    IdentificationPreparationKnowledgeReaderV1,
    "readExactPreparation"
  >;
  /** C17 知识发布件精确窄读。 */
  readonly knowledgeReleaseReader: Pick<IdentificationKnowledgeReleaseReaderV1, "readExact">;
  /** C21 上下文组装与审阅准备。 */
  readonly contextService: Pick<IdentificationContextService, "prepareReview" | "assembleContext">;
  /** C23 任务启动接缝。 */
  readonly agentTasks: Pick<AgentTaskPortV1, "startTask">;
  /** C23 任务快照窄读：只读状态与增量结果引用。 */
  readonly agentTaskReader: IdentificationGraphPortsV1["agentTaskReader"];
  /** C22 分析/收口窄接口与零结果窄读。 */
  readonly finalizationService: Pick<
    RiskCandidateFinalizationService,
    "analyze" | "finalize" | "readZeroResult"
  >;
  /** C07 人工决定窄读。 */
  readonly reviewDecisionReader: IdentificationGraphReviewDecisionReaderV1;
  /** C24 自有路线集窄读（组合根用 C22 结果端口 + C04 实现，不改 C22）。 */
  readonly acceptanceRoutes: IdentificationGraphPortsV1["acceptanceRoutes"];
  /** C03 幂等消费者：恢复信号按事件身份去重。 */
  readonly recoveryConsumer: IdempotentConsumerV1;
  /**
   * 恢复事件的授权解析：消费者不发明授权，由组合根按事件所属工程与来源给出当前 `C05` 授权；
   * 返回 `undefined` 表示该事件不可恢复（按拒绝收口，不重试）。
   */
  readonly recoveryAuthorization: (input: {
    readonly event: DomainEventV1;
  }) => Promise<AuthorizationContextV1 | undefined>;
  readonly recoveryConsumerName?: string;
  readonly now?: () => Date;
}

export interface IdentificationGraphCompositionV1 {
  readonly adapter: PostgresIdentificationGraphAdapterV1;
  readonly registrationStore: IdentificationGraphRegistrationStoreV1;
  readonly ports: IdentificationGraphPortsV1;
  readonly graph: IdentificationGraphRunnerV1;
  readonly runtime: IdentificationGraphRuntimeV1;
  /** 恢复消费者入口：只消费 `review.review-resolved.v1`。 */
  readonly consumeRecoveryEvent: (
    event: DomainEventV1,
  ) => Promise<{ readonly resultRef: unknown; readonly replayed: boolean }>;
}

const DEFAULT_RECOVERY_CONSUMER_NAME_V1 = "c24-identification-graph-recovery";

/** 全部必需项；任何一项缺失即拒绝构造，避免出现半组合的生产接线。 */
const REQUIRED_DEPENDENCIES_V1 = [
  "db",
  "transactionUnit",
  "artifactStore",
  "authorization",
  "runtimeAuthorization",
  "checkpointer",
  "policyProvider",
  "reviewPolicy",
  "basisResolver",
  "preparationReader",
  "knowledgeReleaseReader",
  "contextService",
  "agentTasks",
  "agentTaskReader",
  "finalizationService",
  "reviewDecisionReader",
  "acceptanceRoutes",
  "recoveryConsumer",
  "recoveryAuthorization",
] as const;

export const createIdentificationGraphComposition = (
  options: IdentificationGraphCompositionOptionsV1,
): IdentificationGraphCompositionV1 => {
  for (const dependency of REQUIRED_DEPENDENCIES_V1) {
    if (options[dependency] === undefined) {
      throw new TypeError("identification graph composition requires every C03-C24 dependency");
    }
  }
  const now = options.now ?? (() => new Date());
  const adapter = createPostgresIdentificationGraphAdapter({
    db: options.db,
    transactionUnit: options.transactionUnit,
    artifactStore: options.artifactStore,
    authorization: options.authorization,
    now,
  });

  const ports: IdentificationGraphPortsV1 = {
    transactionUnit: options.transactionUnit,
    registrationStore: adapter.registrationStore,
    bodies: adapter,
    checkpoints: adapter,
    policyProvider: options.policyProvider,
    reviewPolicy: options.reviewPolicy,
    basisResolver: options.basisResolver,
    preparationReader: options.preparationReader,
    knowledgeReleaseReader: options.knowledgeReleaseReader,
    contextService: options.contextService,
    agentTasks: options.agentTasks,
    agentTaskReader: options.agentTaskReader,
    finalizationService: options.finalizationService,
    reviewDecisionReader: options.reviewDecisionReader,
    acceptanceRoutes: options.acceptanceRoutes,
    now,
  };

  const graph = createIdentificationGraph({ ports, checkpointer: options.checkpointer });
  const runtime = createIdentificationGraphRuntime({
    ports,
    graph,
    authorization: options.runtimeAuthorization,
    now,
  });
  const consumerName = options.recoveryConsumerName ?? DEFAULT_RECOVERY_CONSUMER_NAME_V1;

  const consumeRecoveryEvent = async (
    event: DomainEventV1,
  ): Promise<{ readonly resultRef: unknown; readonly replayed: boolean }> => {
    // 只有复核决定落地事件触发恢复；其它事件不属于本消费者，按既有消费者的既约语义处理。
    if (event.eventType !== "review.review-resolved.v1") {
      throw new TypeError("identification graph recovery consumer only accepts review decisions");
    }
    return await options.recoveryConsumer.consume(consumerName, event, async () => {
      const authorization = await options.recoveryAuthorization({ event });
      if (authorization === undefined) {
        throw new TypeError("identification graph recovery requires a current authorization");
      }
      const runRef = event.payload.resumeRunRef;
      const latest = await adapter.registrationStore.readLatestRunState({
        projectId: event.projectId,
        runId: runRef.reference.entityId,
        actorId: authorization.actorId,
        authorization,
        requestedAt: event.recordedAt,
      });
      if (latest === undefined) {
        throw new TypeError("identification graph recovery requires a registered run");
      }
      await runtime.resume({
        projectId: event.projectId,
        actorId: authorization.actorId,
        commandId: `${consumerName}:${event.eventId}`,
        idempotencyKey: `${consumerName}:${event.eventId}`,
        issuedAt: event.recordedAt,
        requestedAt: event.recordedAt,
        authorization,
        runRef,
        expectedRunVersionId: latest.state.runVersionId,
        resumeCause: {
          kind: "review-resolved",
          reviewDecisionRef: event.payload.reviewDecisionRef,
        },
      });
      return { resultRef: runRef };
    });
  };

  return {
    adapter,
    registrationStore: adapter.registrationStore,
    ports,
    graph,
    runtime,
    consumeRecoveryEvent,
  };
};
