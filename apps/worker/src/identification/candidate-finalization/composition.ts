import type { ReviewAuditPortV1 } from "@riskflow/contracts/ports";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  RiskCandidateFinalizationService,
  type IdentificationReviewDecisionReaderV1,
  type IdentificationWorkPlanReaderV1,
  type ModelContextReaderV1,
  type RiskCandidateFinalizationAuthorizationPortV1,
  type RiskCandidateModelPortV1,
  type RiskCandidatePolicyProviderV1,
} from "@riskflow/core/identification/candidate-finalization";
import type { ModelGatewayPortV1 } from "@riskflow/core/model";
import type { TransactionUnitV1 } from "@riskflow/core/persistence";

import {
  createPostgresRiskCandidateFinalizationAdapter,
  type PostgresRiskCandidateFinalizationAdapter,
} from "@riskflow/adapters/identification/candidate-finalization";

import { createRiskCandidateModelRuntime } from "./runtime.js";

/**
 * C22 生产组合根（design D-01/D-03/D-12）：只组合 C22 自有 PostgreSQL 适配器、RI-S57
 * 专用模型节点与冻结核心服务。任一必需依赖缺失时构造阶段拒绝，不产生部分组合，
 * 不提供内存回退，也不实现 `plan`（C24 的图与公共入口）。
 */
export interface RiskCandidateFinalizationCompositionOptionsV1 {
  /** PostgreSQL 事实存储：C22 两张自有表与正式标准化记录表。 */
  readonly db: unknown;
  readonly transactionUnit: TransactionUnitV1;
  readonly artifactStore: ArtifactStoreV1;
  /** C10 网关子集：结构化补全与嵌入；不注册 C08 任务类型。 */
  readonly modelGateway: Pick<ModelGatewayPortV1, "completeStructured" | "embed">;
  /** C07 复核请求公共分支；C22 不新增任务表或事件。 */
  readonly review: Pick<ReviewAuditPortV1, "requestReview">;
  /** C21 五项上下文精确窄读。 */
  readonly modelContextReader: ModelContextReaderV1;
  /** C24 冻结识别工作计划；C22 不提供生产回退实现。 */
  readonly workPlanReader: IdentificationWorkPlanReaderV1;
  /** C22 策略精确解析：无默认策略、无 latest 回退。 */
  readonly policyProvider: RiskCandidatePolicyProviderV1;
  /** C07 人工决定窄读。 */
  readonly reviewDecisionReader: IdentificationReviewDecisionReaderV1;
  /** C05 授权签发与复验接缝。 */
  readonly authorization: RiskCandidateFinalizationAuthorizationPortV1;
  readonly now?: () => Date;
}

export interface RiskCandidateFinalizationCompositionV1 {
  readonly adapter: PostgresRiskCandidateFinalizationAdapter;
  readonly modelRuntime: RiskCandidateModelPortV1;
  /** C22 只暴露 analyze/finalize、C23 修订接缝与 C24 使用的零结果窄读；`plan` 属于 C24。 */
  readonly service: Pick<
    RiskCandidateFinalizationService,
    "analyze" | "finalize" | "prepareReviewRevision" | "readZeroResult"
  >;
}

/** 全部必需项；任何一项缺失即拒绝构造，避免出现半组合的生产接线。 */
const REQUIRED_DEPENDENCIES_V1 = [
  "db",
  "transactionUnit",
  "artifactStore",
  "modelGateway",
  "review",
  "modelContextReader",
  "workPlanReader",
  "policyProvider",
  "reviewDecisionReader",
  "authorization",
] as const;

export const createRiskCandidateFinalizationComposition = (
  options: RiskCandidateFinalizationCompositionOptionsV1,
): RiskCandidateFinalizationCompositionV1 => {
  for (const dependency of REQUIRED_DEPENDENCIES_V1) {
    if (options[dependency] === undefined) {
      throw new TypeError(
        "risk candidate finalization composition requires every C03-C22 dependency",
      );
    }
  }
  const adapter = createPostgresRiskCandidateFinalizationAdapter({
    db: options.db,
    transactionUnit: options.transactionUnit,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const modelRuntime = createRiskCandidateModelRuntime({
    gateway: options.modelGateway,
    artifactStore: options.artifactStore,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const service = new RiskCandidateFinalizationService({
    resultStore: adapter,
    recordStore: adapter,
    model: modelRuntime,
    artifactStore: options.artifactStore,
    transactionUnit: options.transactionUnit,
    review: options.review,
    modelContextReader: options.modelContextReader,
    workPlanReader: options.workPlanReader,
    policyProvider: options.policyProvider,
    reviewDecisionReader: options.reviewDecisionReader,
    authorization: options.authorization,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return { adapter, modelRuntime, service };
};
