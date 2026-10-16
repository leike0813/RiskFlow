/**
 * C30 父运行生产组合根（design D-01/D-02/D-05/D-08，IP-03/IP-06）。
 *
 * 只组合 C30 自有的 PostgreSQL 登记/正文适配器、真实 LangGraph `StateGraph` 与真实 PostgreSQL
 * checkpointer；其余全部依赖——C24 识别子图运行面、评估子运行运行面、逐空间配对解析、冻结重试
 * 预算读取、子图冻结版本与冻结重试策略引用——都是注入的领域端口，缺失时构造阶段即拒绝，不产生
 * 部分组合，不提供内存回退，也不内建策略默认值（策略只来自冻结配置身份）。
 */
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import type { TransactionUnitV1 } from "@riskflow/core/persistence";
import type { WorkflowGraphRegistrationStoreV1 } from "@riskflow/core/workflow";

import {
  createPostgresWorkflowAdapter,
  type PostgresWorkflowAdapterV1,
} from "@riskflow/adapters/workflow";

import type { BaseCheckpointSaver } from "@langchain/langgraph";

import {
  createRiskFlowGraph,
  type RiskFlowGraphPortsV1,
  type RiskFlowGraphRunnerV1,
} from "./graph.js";
import {
  createRiskFlowGraphRuntime,
  type RiskFlowGraphAuthorizationPortV1,
  type RiskFlowGraphRuntimeOptionsV1,
  type RiskFlowGraphRuntimeV1,
} from "./runtime.js";

export interface RiskFlowGraphCompositionOptionsV1 {
  /** 传 `runtime.db` 即可（`Kysely<PostgresDatabase & WorkflowGraphDatabaseV1>`）。 */
  readonly db: unknown;
  /** C03 事务单元：登记行与业务事实同事务提交。 */
  readonly transactionUnit: TransactionUnitV1;
  /** C04 工件存储：正文只入 C04。 */
  readonly artifactStore: ArtifactStoreV1;
  /** C05 授权复验接缝（适配器逐次受保护读写前复验）。 */
  readonly authorization: Pick<LocalIdentityAccessV1, "verify">;
  /** C05 授权复验接缝（start/resume/cancel 命令入口复验）。 */
  readonly runtimeAuthorization: RiskFlowGraphAuthorizationPortV1;
  /** C41 人工采纳证明接缝（design D2/D3）：等待态运行只在该证明核对通过后推进。 */
  readonly humanDecisionProof: RiskFlowGraphRuntimeOptionsV1["humanDecisionProof"];
  readonly identificationPreparation?: RiskFlowGraphRuntimeOptionsV1["identificationPreparation"];
  /** 真实 PostgreSQL checkpointer（`PostgresSaver`）。 */
  readonly checkpointer: BaseCheckpointSaver;
  /** C24 识别子图运行面：子运行由 C24 自己的组合根提供（design D-02）。 */
  readonly identificationRuntime: RiskFlowGraphPortsV1["identificationRuntime"];
  /** 评估子运行运行面：本 change 评估图运行时的注入位（design D-02）。 */
  readonly assessmentRuntime: RiskFlowGraphPortsV1["assessmentRuntime"];
  /** 验收风险 → 精确空间配对（design D-01）：来源由调用方给出，组合根不猜测。 */
  readonly riskSpatialPairing: RiskFlowGraphPortsV1["riskSpatialPairing"];
  /** 冻结重试预算读取（design D-08）：只按冻结 `retryPolicyRef` 精确解析。 */
  readonly retryPolicy: RiskFlowGraphPortsV1["retryPolicy"];
  /** 子图冻结版本：组合根注入的配置身份（design D-02）。 */
  readonly subGraphVersions: RiskFlowGraphPortsV1["subGraphVersions"];
  /** 冻结重试策略引用：恢复/取消只能取此配置，必须与入口使用的策略配置一致（design D-08）。 */
  readonly retryPolicyRef: RiskFlowGraphPortsV1["retryPolicyRef"];
  readonly now?: () => Date;
}

export interface RiskFlowGraphCompositionV1 {
  readonly adapter: PostgresWorkflowAdapterV1;
  readonly registrationStore: WorkflowGraphRegistrationStoreV1;
  readonly ports: RiskFlowGraphPortsV1;
  readonly graph: RiskFlowGraphRunnerV1;
  readonly runtime: RiskFlowGraphRuntimeV1;
}

/** 全部必需项；任何一项缺失即拒绝构造，避免出现半组合的生产接线。 */
const REQUIRED_DEPENDENCIES_V1 = [
  "db",
  "transactionUnit",
  "artifactStore",
  "authorization",
  "runtimeAuthorization",
  "humanDecisionProof",
  "checkpointer",
  "identificationRuntime",
  "assessmentRuntime",
  "riskSpatialPairing",
  "retryPolicy",
  "subGraphVersions",
  "retryPolicyRef",
] as const;

export const createRiskFlowGraphComposition = (
  options: RiskFlowGraphCompositionOptionsV1,
): RiskFlowGraphCompositionV1 => {
  for (const dependency of REQUIRED_DEPENDENCIES_V1) {
    if (options[dependency] === undefined) {
      throw new TypeError("risk flow graph composition requires every C03-C30 dependency");
    }
  }
  const now = options.now ?? (() => new Date());
  const adapter = createPostgresWorkflowAdapter({
    db: options.db,
    transactionUnit: options.transactionUnit,
    artifactStore: options.artifactStore,
    authorization: options.authorization,
    now,
  });

  const ports: RiskFlowGraphPortsV1 = {
    transactionUnit: options.transactionUnit,
    registrationStore: adapter.registrationStore,
    bodies: adapter.bodies,
    identificationRuntime: options.identificationRuntime,
    assessmentRuntime: options.assessmentRuntime,
    riskSpatialPairing: options.riskSpatialPairing,
    retryPolicy: options.retryPolicy,
    subGraphVersions: options.subGraphVersions,
    retryPolicyRef: options.retryPolicyRef,
    now,
  };

  const graph = createRiskFlowGraph({ ports, checkpointer: options.checkpointer });
  const runtime = createRiskFlowGraphRuntime({
    ports,
    graph,
    authorization: options.runtimeAuthorization,
    humanDecisionProof: options.humanDecisionProof,
    ...(options.identificationPreparation === undefined
      ? {}
      : { identificationPreparation: options.identificationPreparation }),
    now,
  });

  return {
    adapter,
    registrationStore: adapter.registrationStore,
    ports,
    graph,
    runtime,
  };
};
