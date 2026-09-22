import type { ReviewAuditPortV1 } from "@riskflow/contracts/ports";
import type { IdentificationReviewRevisionPortV1 } from "@riskflow/core/identification/candidate-finalization";
import {
  IdentificationHumanReviewService,
  type IdentificationPendingReviewReaderV1,
} from "@riskflow/core/identification/human-review";

/**
 * C23 生产组合根（design D-01/D-10/D-11）：只组合 C07 授权先行的 pending 任务窄读、C07 决定
 * 公共分支与 C22 候选修订接缝。任一必需依赖缺失时构造阶段拒绝，不产生部分组合，不提供内存
 * 回退，也不实现 HTTP/Web 交互（C33）与识别图事件消费（C24）。
 */
export interface IdentificationHumanReviewCompositionOptionsV1 {
  /** C07 自有表的 pending 任务窄读：实现 `ReviewAuditPortV1` 的适配器提供。 */
  readonly pendingReviewReader: IdentificationPendingReviewReaderV1;
  /** C22 候选修订与确定性重校验接缝。 */
  readonly reviewRevision: IdentificationReviewRevisionPortV1;
  /** C07 正式人工决定公共分支；C23 不新增任务表、事件或工作流恢复通道。 */
  readonly review: Pick<ReviewAuditPortV1, "decideReview">;
  readonly now?: () => Date;
}

export interface IdentificationHumanReviewCompositionV1 {
  readonly service: IdentificationHumanReviewService;
}

/** 全部必需项；任何一项缺失即拒绝构造，避免出现半组合的生产接线。 */
const REQUIRED_DEPENDENCIES_V1 = ["pendingReviewReader", "reviewRevision", "review"] as const;

export const createIdentificationHumanReviewComposition = (
  options: IdentificationHumanReviewCompositionOptionsV1,
): IdentificationHumanReviewCompositionV1 => {
  for (const dependency of REQUIRED_DEPENDENCIES_V1) {
    if (options[dependency] === undefined) {
      throw new TypeError(
        "identification human review composition requires every C07-C22 dependency",
      );
    }
  }
  const service = new IdentificationHumanReviewService({
    pendingReviewReader: options.pendingReviewReader,
    reviewRevision: options.reviewRevision,
    review: options.review,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return { service };
};
