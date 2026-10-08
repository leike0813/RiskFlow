/**
 * C35 复核详情与活动只读面（design D-02/D-06/D-07）。
 *
 * 唯一 read Schema 定义在所属 review-audit 模块：查询信封与结果联合直接由 contracts 的
 * `createModuleQuerySchemaV1` / `createModuleResultSchemaV1` 构造。
 * 任务详情对原 ReviewTaskStateV1 只做一次安全 pick（剔除 requestedAuthorizationContextRef），
 * 决定仍是原五类 ReviewDecisionV1 联合——不在本模块复制候选、规则或证据正文。
 */
import { z } from "zod";

import {
  ContractReferenceV1Schema,
  ReadActionV1Schema,
  IdentificationCandidateSetRefV1Schema,
  ReviewDecisionRefV1Schema,
  ReviewDecisionV1Schema,
  ReviewTaskRefV1Schema,
  ReviewTargetRefV1Schema,
  ReviewTypeV1Schema,
  WorkflowRunRefV1Schema,
  createModuleQuerySchemaV1,
  createModuleResultSchemaV1,
} from "@riskflow/contracts/ports";
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";

import { ReviewActivityCodeV1Schema, ReviewTaskStatusV1Schema } from "./schema.js";

export const REVIEW_UI_READ_PAGE_SIZE_MAX_V1 = 50;
export const REVIEW_UI_READ_PAGE_SIZE_DEFAULT_V1 = 25;

const readPageSize = z.number().int().min(1).max(REVIEW_UI_READ_PAGE_SIZE_MAX_V1);
const readCursor = z.string().min(1).max(512);

/**
 * 复核任务详情：保留原任务/目标/验证与证据快照/复核策略/等待运行/状态与决定引用。
 * 用实体 + 身份版本定位，不以队列索引或 latest 重建目标；决定任务与被替代任务只读。
 */
export const ReviewTaskDetailV1Schema = z.strictObject({
  kind: z.literal("task-detail"),
  reviewTaskRef: ReviewTaskRefV1Schema,
  projectId: IdentifierSchema,
  reviewType: ReviewTypeV1Schema,
  status: ReviewTaskStatusV1Schema,
  targetRef: ReviewTargetRefV1Schema,
  validationSnapshotRef: ContractReferenceV1Schema,
  evidenceSnapshotRef: ContractReferenceV1Schema,
  reviewPolicyRef: VersionReferenceSchema,
  waitingRunRef: WorkflowRunRefV1Schema.optional(),
  requestedBy: IdentifierSchema,
  requestedAt: IsoDateTimeSchema,
  decidedAt: IsoDateTimeSchema.optional(),
  supersededAt: IsoDateTimeSchema.optional(),
  /** 原五类决定联合，存在时原样返回；本模块不新增也不归并决定种类。 */
  decision: z
    .strictObject({
      reviewDecisionRef: ReviewDecisionRefV1Schema,
      decision: ReviewDecisionV1Schema,
      reasonCode: IdentifierSchema,
      actorRef: IdentifierSchema,
      decidedAt: IsoDateTimeSchema,
    })
    .optional(),
  /** 当前动作可用性；只读授权不等于写权，五类决定各按自身合法分支判定。 */
  actions: z.array(ReadActionV1Schema).max(8),
  /**
   * 修正候选引用：识别修正只能选择上游已生成的候选集引用（实体 + 身份版本），
   * 由识别所属模块有界读取后原样转出；详情本身不复制候选正文。
   * 缺少身份版本就无法构造 `approve-revised-candidate`，因此这里不给裸标识符降级。
   */
  revisedCandidateRefs: z.array(IdentificationCandidateSetRefV1Schema).max(64).optional(),
});
export type ReviewTaskDetailV1 = z.infer<typeof ReviewTaskDetailV1Schema>;

/**
 * 活动条目：业务、安全与复核拒绝三类来源的安全展示码 + 类型化安全参数。
 * 只允许 actorRef、精确 subject/target/task/decision/run/authorization 引用、commandId、
 * resultCode/reasonCode 与 occurredAt/recordedAt/persistedAt；不导出审计 payload dump。
 */
export const ReviewActivityEntryV1Schema = z.strictObject({
  activityId: IdentifierSchema,
  sourceType: z.enum(["business-audit", "review-task", "review-rejection", "security-audit"]),
  activityCode: ReviewActivityCodeV1Schema,
  actionCode: IdentifierSchema.optional(),
  actorRef: IdentifierSchema.optional(),
  subjectRef: ContractReferenceV1Schema.optional(),
  reviewTaskRef: ReviewTaskRefV1Schema.optional(),
  reviewDecisionRef: ReviewDecisionRefV1Schema.optional(),
  targetRef: ContractReferenceV1Schema.optional(),
  waitingRunRef: WorkflowRunRefV1Schema.optional(),
  commandId: IdentifierSchema.optional(),
  resultCode: IdentifierSchema.optional(),
  reasonCode: IdentifierSchema.optional(),
  occurredAt: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
  persistedAt: IsoDateTimeSchema,
});
export type ReviewActivityEntryV1 = z.infer<typeof ReviewActivityEntryV1Schema>;

export const ReviewActivityPageV1Schema = z.strictObject({
  kind: z.literal("activities"),
  items: z.array(ReviewActivityEntryV1Schema).max(REVIEW_UI_READ_PAGE_SIZE_MAX_V1),
  /** 固定记录时点；本次翻页的历史不因后续新增活动而改变。 */
  asOfRecordedAt: IsoDateTimeSchema,
  nextCursor: readCursor.optional(),
});
export type ReviewActivityPageV1 = z.infer<typeof ReviewActivityPageV1Schema>;

const taskDetailPayload = z.strictObject({ reviewTaskRef: ReviewTaskRefV1Schema });
const activitiesPayload = z.strictObject({
  subjectRef: ContractReferenceV1Schema.optional(),
  sourceType: z
    .enum(["business-audit", "review-task", "review-rejection", "security-audit"])
    .optional(),
  resultCode: IdentifierSchema.optional(),
  asOfRecordedAt: IsoDateTimeSchema.optional(),
  cursor: readCursor.optional(),
  pageSize: readPageSize.optional(),
});

export const ReviewAuditReadQueryV1Schema = z.discriminatedUnion("kind", [
  createModuleQuerySchemaV1("task-detail", taskDetailPayload, "review-audit.read"),
  createModuleQuerySchemaV1("activities", activitiesPayload, "review-audit.read"),
]);
export type ReviewAuditReadQueryV1 = z.infer<typeof ReviewAuditReadQueryV1Schema>;

/**
 * 传输层载荷：只有 `kind` 与该 kind 的真实入参——与上面各 payload 共用同一份字段定义。
 */
export const ReviewAuditReadPayloadV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("task-detail"), ...taskDetailPayload.shape }),
  z.strictObject({ kind: z.literal("activities"), ...activitiesPayload.shape }),
]);
export type ReviewAuditReadPayloadV1 = z.infer<typeof ReviewAuditReadPayloadV1Schema>;

export const ReviewAuditReadSuccessV1Schema = z.discriminatedUnion("kind", [
  ReviewTaskDetailV1Schema,
  ReviewActivityPageV1Schema,
]);
export type ReviewAuditReadSuccessV1 = z.infer<typeof ReviewAuditReadSuccessV1Schema>;

export const ReviewAuditReadResultV1Schema = createModuleResultSchemaV1(
  ReviewAuditReadSuccessV1Schema,
);
export type ReviewAuditReadResultV1 = z.infer<typeof ReviewAuditReadResultV1Schema>;

/**
 * 有界只读端口：请求/决定写入口与原 C07 事务语义完全不变；
 * 本端口只提供足以提交精确决定的详情与分页活动，不批量、不加新 bulk API。
 */
export interface ReviewAuditReadPortV1 {
  read(query: ReviewAuditReadQueryV1): Promise<ReviewAuditReadResultV1>;
}
