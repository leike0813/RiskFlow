import { z } from "zod";

import { IdentifierSchema, IsoDateTimeSchema } from "@riskflow/contracts/common";
import {
  AuthorizationContextV1Schema,
  ContentArtifactRefV1Schema,
  IdentificationCandidateSetRefV1Schema,
  ModuleErrorV1Schema,
  ReviewDecisionRefV1Schema,
  ReviewTaskRefV1Schema,
  ValidatedCandidateSetRefV1Schema,
  WorkflowRunRefV1Schema,
} from "@riskflow/contracts/ports";

import {
  MAX_RISK_CANDIDATES_V1,
  IdentificationReviewRevisionFieldsV1Schema,
} from "../candidate-finalization/schema.js";

/** C23 自有诊断前缀；不进入任何公共契约。 */
export const IDENTIFICATION_HUMAN_REVIEW_STAGE_PREFIX_V1 = "identification-human-review" as const;

/**
 * 人工修订输入（design D-02）：精确来源候选集、来源已校验集、组内候选工件与只含允许字段的
 * strict partial 修订。允许字段集合来自 C22 的 `IdentificationReviewRevisionFieldsV1Schema`，
 * 因此 `modelConfidence`、工序绑定、候选来源与模型事实在此不可能出现。
 */
export const IdentificationReviewRevisionV1Schema = z.strictObject({
  sourceCandidateSetRef: IdentificationCandidateSetRefV1Schema,
  sourceValidatedCandidateSetRef: ValidatedCandidateSetRefV1Schema,
  candidateRef: ContentArtifactRefV1Schema,
  changes: IdentificationReviewRevisionFieldsV1Schema,
});
export type IdentificationReviewRevisionV1 = z.infer<typeof IdentificationReviewRevisionV1Schema>;

const identificationDecisionBase = { reviewType: z.literal("identification-group") };

/**
 * 单项复核决定（design D-02）：六个判别分支精确对应 C02 已有的 `identification-group`
 * 决定，不创建近义决定，也不接受候选正文以外的自由字段。
 */
export const IdentificationHumanReviewDecisionV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ ...identificationDecisionBase, kind: z.literal("approve-unchanged") }),
  z.strictObject({
    ...identificationDecisionBase,
    kind: z.literal("approve-revised-candidate"),
    revision: IdentificationReviewRevisionV1Schema,
  }),
  z.strictObject({ ...identificationDecisionBase, kind: z.literal("confirm-merge") }),
  z.strictObject({ ...identificationDecisionBase, kind: z.literal("keep-separate") }),
  z.strictObject({ ...identificationDecisionBase, kind: z.literal("reject") }),
  z.strictObject({ ...identificationDecisionBase, kind: z.literal("return-upstream") }),
]);
export type IdentificationHumanReviewDecisionV1 = z.infer<
  typeof IdentificationHumanReviewDecisionV1Schema
>;

/** 批量只接受原样通过与拒绝（design D-07），不提供第二个批量决定 DTO。 */
export const IdentificationHumanReviewBatchDecisionV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ ...identificationDecisionBase, kind: z.literal("approve-unchanged") }),
  z.strictObject({ ...identificationDecisionBase, kind: z.literal("reject") }),
]);
export type IdentificationHumanReviewBatchDecisionV1 = z.infer<
  typeof IdentificationHumanReviewBatchDecisionV1Schema
>;

/**
 * 识别复核只服务 `identification-group` 任务：其它复核类型在解析阶段即被拒绝，
 * 不进入授权先行读取、修订接缝或 C07 决定提交。
 */
const humanReviewCommandBase = {
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  projectId: IdentifierSchema,
  actorId: IdentifierSchema,
  issuedAt: IsoDateTimeSchema,
  authorization: AuthorizationContextV1Schema,
  reviewTaskRef: ReviewTaskRefV1Schema,
  reasonCode: IdentifierSchema,
};

export const IdentificationHumanReviewCommandV1Schema = z
  .strictObject({
    ...humanReviewCommandBase,
    decision: IdentificationHumanReviewDecisionV1Schema,
  })
  .refine((command) => command.reviewTaskRef.reviewType === "identification-group", {
    message: "identification human review requires an identification-group task",
    path: ["reviewTaskRef", "reviewType"],
  });
export type IdentificationHumanReviewCommandV1 = z.infer<
  typeof IdentificationHumanReviewCommandV1Schema
>;

/**
 * 批量容器（design D-07）：每项都是完整标准复核动作，携带自己的命令标识、幂等键、任务/目标
 * 引用与授权，因此每项拥有独立事务、结果、审计与恢复事件；容器本身不产生副作用。
 */
export const IdentificationHumanReviewBatchV1Schema = z
  .strictObject({
    items: z
      .array(
        z
          .strictObject({
            ...humanReviewCommandBase,
            decision: IdentificationHumanReviewBatchDecisionV1Schema,
          })
          .refine((item) => item.reviewTaskRef.reviewType === "identification-group", {
            message: "identification human review requires an identification-group task",
            path: ["reviewTaskRef", "reviewType"],
          }),
      )
      .min(1)
      .max(MAX_RISK_CANDIDATES_V1),
  })
  .refine(
    (batch) =>
      new Set(
        batch.items.map(
          (item) =>
            `${item.reviewTaskRef.reference.entityId}\u0000${item.reviewTaskRef.reference.versionId}`,
        ),
      ).size === batch.items.length,
    { message: "batch review task references must be unique", path: ["items"] },
  );
export type IdentificationHumanReviewBatchV1 = z.infer<
  typeof IdentificationHumanReviewBatchV1Schema
>;
export type IdentificationHumanReviewBatchItemV1 =
  IdentificationHumanReviewBatchV1["items"][number];

/**
 * 单项成功结果（design D-02）：只返回精确决定与等待运行引用；修订分支额外返回新候选集与
 * 对应已校验候选集，供调用方按既有决定引用继续。
 */
export const IdentificationHumanReviewOutcomeV1Schema = z.discriminatedUnion("outcomeKind", [
  z.strictObject({
    outcomeKind: z.literal("decided"),
    reviewDecisionRef: ReviewDecisionRefV1Schema,
    waitingRunRef: WorkflowRunRefV1Schema,
  }),
  z.strictObject({
    outcomeKind: z.literal("revised"),
    reviewDecisionRef: ReviewDecisionRefV1Schema,
    waitingRunRef: WorkflowRunRefV1Schema,
    revisedCandidateSetRef: IdentificationCandidateSetRefV1Schema,
    validatedCandidateSetRef: ValidatedCandidateSetRefV1Schema,
  }),
]);
export type IdentificationHumanReviewOutcomeV1 = z.infer<
  typeof IdentificationHumanReviewOutcomeV1Schema
>;

export const IdentificationHumanReviewResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("succeeded"),
    result: IdentificationHumanReviewOutcomeV1Schema,
  }),
  z.strictObject({ kind: z.literal("failed"), error: ModuleErrorV1Schema }),
]);
export type IdentificationHumanReviewResultV1 = z.infer<
  typeof IdentificationHumanReviewResultV1Schema
>;

/** 批量逐项结果：与输入顺序一一对应，失败项不回滚、不冒充其它项结果。 */
export const IdentificationHumanReviewBatchItemResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("succeeded"),
    reviewTaskRef: ReviewTaskRefV1Schema,
    result: IdentificationHumanReviewOutcomeV1Schema,
  }),
  z.strictObject({
    kind: z.literal("failed"),
    reviewTaskRef: ReviewTaskRefV1Schema,
    error: ModuleErrorV1Schema,
  }),
]);
export type IdentificationHumanReviewBatchItemResultV1 = z.infer<
  typeof IdentificationHumanReviewBatchItemResultV1Schema
>;

export const IdentificationHumanReviewBatchResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("succeeded"),
    results: z.array(IdentificationHumanReviewBatchItemResultV1Schema).min(1),
  }),
  z.strictObject({ kind: z.literal("failed"), error: ModuleErrorV1Schema }),
]);
export type IdentificationHumanReviewBatchResultV1 = z.infer<
  typeof IdentificationHumanReviewBatchResultV1Schema
>;
