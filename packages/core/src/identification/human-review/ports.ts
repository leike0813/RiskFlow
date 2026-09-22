import type {
  AuthorizationContextV1,
  EvidenceSnapshotRefV1,
  IdentificationGroupRefV1,
  ReviewAuditPortV1,
  ReviewTaskRefV1,
  ValidationSnapshotRefV1,
  WorkflowRunRefV1,
} from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";

import type { IdentificationReviewRevisionPortV1 } from "../candidate-finalization/ports.js";

/**
 * C07 pending 任务窄读结果（design D-03）：只返回精确任务、目标、冻结验证/证据/复核策略与
 * 等待运行；不返回决定正文、证据正文或数据库行，因此调用方无法据此读取目标内容。
 */
export interface IdentificationPendingReviewTaskV1 {
  readonly reviewTaskRef: ReviewTaskRefV1;
  /** 任务目标的精确分组引用；窄读已证明目标确实是 `identification-group`。 */
  readonly groupRef: IdentificationGroupRefV1;
  readonly validationSnapshotRef: ValidationSnapshotRefV1;
  readonly evidenceSnapshotRef: EvidenceSnapshotRefV1;
  readonly reviewPolicyRef: VersionReference;
  readonly waitingRunRef: WorkflowRunRefV1;
}

/**
 * 闭合结果（design D-03/D-09）：事实错配、已替代、跨工程与读取失败一律折叠为 `blocked`；
 * 授权在读取任何事实之前验证，因此无权调用方无法区分目标存在性、版本或工程。
 *
 * `decided` 只服务规格的“响应丢失后同命令重试”对账：它返回与 `pending` 相同的冻结事实，
 * 但 C07 只可能按命令身份重放既有决定，不可能据此成立新的人工决定。
 */
export type IdentificationPendingReviewReadV1 =
  | { readonly kind: "pending"; readonly task: IdentificationPendingReviewTaskV1 }
  | { readonly kind: "decided"; readonly task: IdentificationPendingReviewTaskV1 }
  | { readonly kind: "blocked"; readonly detailCode: string };

export interface IdentificationPendingReviewReaderV1 {
  readPendingIdentificationReview(input: {
    readonly projectId: string;
    readonly reviewTaskRef: ReviewTaskRefV1;
    readonly authorization: AuthorizationContextV1;
    readonly idempotencyKey: string;
    readonly invocationId: string;
    readonly requestedAt: string;
  }): Promise<IdentificationPendingReviewReadV1>;
}

/** 由组合根注入的 C23 服务依赖；任一必需项缺失时构造失败，不产生部分组合。 */
export interface IdentificationHumanReviewServiceOptionsV1 {
  /** C07 授权先行的 pending 任务窄读。 */
  readonly pendingReviewReader: IdentificationPendingReviewReaderV1;
  /** C22 候选修订与确定性重校验接缝。 */
  readonly reviewRevision: IdentificationReviewRevisionPortV1;
  /** C07 正式人工决定公共分支：C23 不直接调用 workflow resume，也不写决定表。 */
  readonly review: Pick<ReviewAuditPortV1, "decideReview">;
  readonly now?: () => Date;
}
