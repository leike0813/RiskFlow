/**
 * C30 评估子图生产组合根（design D-02/D-03/D-05，IP-05）。
 *
 * 只构造 C30 自有的三件套：C03 运行事实适配器、A0～A9 子图与运行时。所有非 C30 自有的
 * 领域端口（C11/C18/C19/C25/C26/C27/C28/C29/C08/C04/C05/C03）一律由部署注入，组合根
 * 不猜来源、不内建策略默认值、不提供内存回退：任一必需项缺失即拒绝构造。
 */
import type { BaseCheckpointSaver } from "@langchain/langgraph";

import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import type { TransactionUnitV1 } from "@riskflow/core/persistence";
import type { WorkflowGraphRegistrationStoreV1 } from "@riskflow/core/workflow";

import {
  createPostgresWorkflowAdapter,
  type PostgresWorkflowAdapterV1,
} from "@riskflow/adapters/workflow";

import {
  createAssessmentGraph,
  type AssessmentGraphPortsV1,
  type AssessmentGraphRunnerV1,
} from "./graph.js";
import {
  createAssessmentGraphRuntime,
  type AssessmentGraphAuthorizationPortV1,
  type AssessmentGraphRuntimeV1,
} from "./runtime.js";

export interface AssessmentGraphCompositionOptionsV1 {
  /** 传 `runtime.db` 即可（`Kysely<PostgresDatabase & WorkflowGraphDatabaseV1>`）。 */
  readonly db: unknown;
  /** C03 事务单元：登记行、链边与审计同事务提交。 */
  readonly transactionUnit: TransactionUnitV1;
  /** C04 工件存储：正文只入 C04，登记行只保存精确引用。 */
  readonly artifactStore: ArtifactStoreV1;
  /** C05 授权复验接缝（适配器逐次受保护读写前复验）。 */
  readonly authorization: Pick<LocalIdentityAccessV1, "verify">;
  /** C05 授权复验接缝（start/resume/cancel 命令入口复验）。 */
  readonly runtimeAuthorization: AssessmentGraphAuthorizationPortV1;
  /** 真实 PostgreSQL checkpointer（`PostgresSaver`）。 */
  readonly checkpointer: BaseCheckpointSaver;
  /** C11 评估准备冻结端口。 */
  readonly engineeringData: AssessmentGraphPortsV1["engineeringData"];
  /** C19 已发布评估依据集合与 C18 版本化策略读取。 */
  readonly basis: AssessmentGraphPortsV1["basis"];
  /** C17/C19 正式依据解析：按冻结评估准备快照解析 `assessment-basis`（与 C24 同形注入）。 */
  readonly basisResolver: AssessmentGraphPortsV1["basisResolver"];
  /** C25 运行策略提供者（十项策略只按冻结引用解析）。 */
  readonly runtimePolicies: AssessmentGraphPortsV1["runtimePolicies"];
  /** C25 确定性评估端口。 */
  readonly riskAssessment: AssessmentGraphPortsV1["riskAssessment"];
  /** C26 预警生命周期端口。 */
  readonly warning: AssessmentGraphPortsV1["warning"];
  /** C27 处置建议端口。 */
  readonly recommendation: AssessmentGraphPortsV1["recommendation"];
  /** C28 预测与偏差端口。 */
  readonly responseLifecycle: AssessmentGraphPortsV1["responseLifecycle"];
  /** C29 校准端口。 */
  readonly calibration: AssessmentGraphPortsV1["calibration"];
  /**
   * C27 处置组合 Agent 接缝：由部署用真实 C08 适配器与
   * `createResponseRecommendationTaskDefinition(policy, port)` 绑定，现场上下文引用来源
   * 只有部署能确定（组合根不推断“当前现场”）。
   */
  readonly recommendationAgent: AssessmentGraphPortsV1["recommendationAgent"];
  /** C29 校准候选 Agent 接缝：部署绑定 C29 任务定义与端口。 */
  readonly calibrationAgent: AssessmentGraphPortsV1["calibrationAgent"];
  /** 分段入口的冻结策略目录：只有部署持有已冻结策略，组合根不内建默认策略。 */
  readonly policies: AssessmentGraphPortsV1["policies"];
  /**
   * C06 下游签发接缝：由部署按 branch 签发精确上下文（复用同一真实 C06 access）。
   * 图的运行上下文只有 `workflow.*` 能力，C11 冻结等下游动作必须用各自 branch 的上下文。
   */
  readonly authorizeDownstream: AssessmentGraphPortsV1["authorizeDownstream"];
  readonly now?: () => Date;
}

export interface AssessmentGraphCompositionV1 {
  readonly adapter: PostgresWorkflowAdapterV1;
  readonly registrationStore: WorkflowGraphRegistrationStoreV1;
  readonly ports: AssessmentGraphPortsV1;
  readonly graph: AssessmentGraphRunnerV1;
  readonly runtime: AssessmentGraphRuntimeV1;
}

/** 全部必需项；任何一项缺失即拒绝构造，避免出现半组合的生产接线。 */
const REQUIRED_DEPENDENCIES_V1 = [
  "db",
  "transactionUnit",
  "artifactStore",
  "authorization",
  "runtimeAuthorization",
  "checkpointer",
  "engineeringData",
  "basis",
  "basisResolver",
  "runtimePolicies",
  "riskAssessment",
  "warning",
  "recommendation",
  "recommendationAgent",
  "responseLifecycle",
  "calibration",
  "calibrationAgent",
  "policies",
  "authorizeDownstream",
] as const;

export const createAssessmentGraphComposition = (
  options: AssessmentGraphCompositionOptionsV1,
): AssessmentGraphCompositionV1 => {
  for (const dependency of REQUIRED_DEPENDENCIES_V1) {
    if (options[dependency] === undefined) {
      throw new TypeError("assessment graph composition requires every C03-C29 dependency");
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

  const ports: AssessmentGraphPortsV1 = {
    transactionUnit: options.transactionUnit,
    registrationStore: adapter.registrationStore,
    bodies: adapter.bodies,
    engineeringData: options.engineeringData,
    basis: options.basis,
    basisResolver: options.basisResolver,
    runtimePolicies: options.runtimePolicies,
    riskAssessment: options.riskAssessment,
    warning: options.warning,
    recommendation: options.recommendation,
    recommendationAgent: options.recommendationAgent,
    responseLifecycle: options.responseLifecycle,
    calibration: options.calibration,
    calibrationAgent: options.calibrationAgent,
    policies: options.policies,
    authorizeDownstream: options.authorizeDownstream,
    now,
  };

  const graph = createAssessmentGraph({ ports, checkpointer: options.checkpointer });
  const runtime = createAssessmentGraphRuntime({
    ports,
    graph,
    authorization: options.runtimeAuthorization,
    now,
  });

  return { adapter, registrationStore: adapter.registrationStore, ports, graph, runtime };
};
