import { z } from "zod";

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import {
  AcceptanceRouteSetRefV1Schema,
  AgentTaskRefV1Schema,
  AuditTrailRefV1Schema,
  AuthorizationContextRefV1Schema,
  ContentArtifactRefV1Schema,
  DomainEventRefV1Schema,
  IdentificationGroupRefV1Schema,
  IdentificationInputSnapshotRefV1Schema,
  IdentificationPolicySetRefV1Schema,
  IdentificationPreparationSnapshotRefV1Schema,
  IdentificationRunResultRefV1Schema,
  IdentificationWorkItemRefV1Schema,
  IdentificationWorkPlanRefV1Schema,
  type IdentificationWorkPlanRefV1,
  ReviewTaskRefV1Schema,
  SourceSegmentSetRefV1Schema,
  SourceVersionRefV1Schema,
  SpatialScopeRefV1Schema,
  StageResultRefV1Schema,
  StandardizedRiskRecordRefV1Schema,
  ValidatedCandidateSetRefV1Schema,
  WaitingRefV1Schema,
  WorkflowErrorRefV1Schema,
  WorkflowRunRefV1Schema,
} from "@riskflow/contracts/ports";
import {
  IdentificationInputSnapshotV1Schema,
  IdentificationStageResultV1Schema,
  IdentificationStageV1Schema,
} from "@riskflow/contracts/workflows";

import type { ArtifactRefV1 } from "../../artifacts/index.js";

export const IDENTIFICATION_GRAPH_SCHEMA_VERSION_V1 = "1" as const;

const graphSchemaVersion = z.literal(IDENTIFICATION_GRAPH_SCHEMA_VERSION_V1);

const positiveInt = z.number().int().positive();

/**
 * C24 运行级技术重试策略正文（design D-05）：次数与退避只来自冻结策略引用，
 * 调用方、当前时间与“最新版”都不参与。仅 C24 拥有该正文，C10/C21/C22 不解释它。
 */
export const IdentificationGraphRetryPolicyV1Schema = z.strictObject({
  schemaVersion: graphSchemaVersion,
  policyRef: VersionReferenceSchema,
  maxAttempts: positiveInt.max(10),
  backoffMs: z.number().int().nonnegative(),
});
export type IdentificationGraphRetryPolicyV1 = z.infer<
  typeof IdentificationGraphRetryPolicyV1Schema
>;

/**
 * I1 冻结的策略成员集合（design D-03）：只保存已审核配置的精确版本引用，
 * 不保存策略正文，也不内建业务默认值。成员正文由组合根按同一引用解析。
 */
export const IdentificationGraphPolicySetV1Schema = z.strictObject({
  schemaVersion: graphSchemaVersion,
  policySetRef: IdentificationPolicySetRefV1Schema,
  retrievalPolicyRef: VersionReferenceSchema,
  retrievalReviewAgentPolicyRef: VersionReferenceSchema,
  repairPolicyRef: VersionReferenceSchema,
  confidencePolicyRef: VersionReferenceSchema,
  forcedReviewPolicyRef: VersionReferenceSchema,
  mergePolicyRef: VersionReferenceSchema,
  ruleValidationPolicyRef: VersionReferenceSchema,
  simulationConstraintPolicyRef: VersionReferenceSchema.optional(),
  retryPolicyRef: VersionReferenceSchema,
  modelDeploymentRef: VersionReferenceSchema,
  promptTemplateRef: VersionReferenceSchema,
  retryPolicy: IdentificationGraphRetryPolicyV1Schema,
});
export type IdentificationGraphPolicySetV1 = z.infer<typeof IdentificationGraphPolicySetV1Schema>;

/**
 * I2 工作项正文（design D-03）：固定工序节点、空间、资料版本、资料段范围与由受治理
 * 工序/机理事实形成的冻结查询依据；不接受调用方自由正文。
 */
export const IdentificationGraphWorkItemV1Schema = z.strictObject({
  schemaVersion: graphSchemaVersion,
  workItemRef: IdentificationWorkItemRefV1Schema,
  nodeId: IdentifierSchema,
  spatialScopeRefs: z.array(SpatialScopeRefV1Schema).min(1),
  sourceVersionRefs: z.array(SourceVersionRefV1Schema).min(1),
  sourceSegmentSetRefs: z.array(SourceSegmentSetRefV1Schema).min(1),
  frozenQueryText: IdentifierSchema,
});
export type IdentificationGraphWorkItemV1 = z.infer<typeof IdentificationGraphWorkItemV1Schema>;

export const IdentificationGraphExcludedWorkItemV1Schema = z.strictObject({
  nodeId: IdentifierSchema,
  reasonCode: IdentifierSchema,
});
export type IdentificationGraphExcludedWorkItemV1 = z.infer<
  typeof IdentificationGraphExcludedWorkItemV1Schema
>;

/** I2 不可变工作计划正文（C04 工件）：正文只入 C04，登记行只引用它。 */
export const IdentificationGraphWorkPlanBodyV1Schema = z.strictObject({
  schemaVersion: graphSchemaVersion,
  projectId: IdentifierSchema,
  workPlanRef: IdentificationWorkPlanRefV1Schema,
  inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
  inputSnapshot: IdentificationInputSnapshotV1Schema,
  workItems: z.array(IdentificationGraphWorkItemV1Schema).min(1),
  excludedWorkItems: z.array(IdentificationGraphExcludedWorkItemV1Schema),
});
export type IdentificationGraphWorkPlanBodyV1 = z.infer<
  typeof IdentificationGraphWorkPlanBodyV1Schema
>;

/**
 * C24 等待事实正文（design D-05/D-10）：精确区分知识/策略未就绪、C08 Agent 任务未终结和
 * 人工决定未成立；对外投影为 `WaitingRefV1` 由 `toWaitingRef` 单一函数负责。
 */
export const IdentificationGraphWaitingV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("knowledge-preparation"),
    preparationSnapshotRef: IdentificationPreparationSnapshotRefV1Schema,
    reasonCode: IdentifierSchema,
  }),
  z.strictObject({
    kind: z.literal("retrieval-review-agent"),
    agentTaskRef: AgentTaskRefV1Schema,
    workItemRef: IdentificationWorkItemRefV1Schema,
    stage: IdentificationStageV1Schema,
  }),
  z.strictObject({
    kind: z.literal("human-review"),
    reviewTaskRef: ReviewTaskRefV1Schema,
    groupRef: IdentificationGroupRefV1Schema,
  }),
]);
export type IdentificationGraphWaitingV1 = z.infer<typeof IdentificationGraphWaitingV1Schema>;

export const IDENTIFICATION_GRAPH_ERROR_CODES_V1 = [
  "INPUT_NOT_READY",
  "POLICY_NOT_READY",
  "WORK_PLAN_INVALID",
  "UPSTREAM_WAITING",
  "RETRYABLE_INFRASTRUCTURE_FAILURE",
  "AUTHORIZATION_DENIED",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "CHECKPOINT_INCONSISTENT",
  "CONTRACT_INVALID",
  "CANCELLED",
] as const;
export const IdentificationGraphErrorCodeV1Schema = z.enum(IDENTIFICATION_GRAPH_ERROR_CODES_V1);
export type IdentificationGraphErrorCodeV1 = z.infer<typeof IdentificationGraphErrorCodeV1Schema>;

const RETRYABLE_IDENTIFICATION_GRAPH_ERROR_V1: Record<
  IdentificationGraphErrorCodeV1,
  true | undefined
> = {
  RETRYABLE_INFRASTRUCTURE_FAILURE: true,
  INPUT_NOT_READY: undefined,
  POLICY_NOT_READY: undefined,
  WORK_PLAN_INVALID: undefined,
  UPSTREAM_WAITING: undefined,
  AUTHORIZATION_DENIED: undefined,
  VERSION_CONFLICT: undefined,
  IDEMPOTENCY_CONFLICT: undefined,
  CHECKPOINT_INCONSISTENT: undefined,
  CONTRACT_INVALID: undefined,
  CANCELLED: undefined,
};

export const isRetryableIdentificationGraphError = (
  code: IdentificationGraphErrorCodeV1,
): boolean => RETRYABLE_IDENTIFICATION_GRAPH_ERROR_V1[code] === true;

/** C24 内部结构化错误（design D-10）：只带稳定 code、retryable 与诊断引用，不带正文。 */
export const IdentificationGraphErrorV1Schema = z.strictObject({
  schemaVersion: graphSchemaVersion,
  code: IdentificationGraphErrorCodeV1Schema,
  retryable: z.boolean(),
  stage: IdentificationStageV1Schema,
  detailCode: IdentifierSchema,
  diagnosticRef: VersionReferenceSchema.optional(),
  occurredAt: IsoDateTimeSchema,
});
export type IdentificationGraphErrorV1 = z.infer<typeof IdentificationGraphErrorV1Schema>;

/** 运行状态版本（design D-06 `run-state`）：只含引用、阶段、游标与版本，不含正文。 */
export const IdentificationGraphRunStateV1Schema = z.strictObject({
  schemaVersion: graphSchemaVersion,
  runId: IdentifierSchema,
  runVersionId: IdentifierSchema,
  stage: IdentificationStageV1Schema,
  status: z.enum([
    "running",
    "waiting",
    "retryable-failure",
    "completed",
    "terminal-failure",
    "cancelled",
  ]),
  completedWorkItemRefs: z.array(IdentificationWorkItemRefV1Schema),
  pendingWorkItemRefs: z.array(IdentificationWorkItemRefV1Schema),
  validatedCandidateSetRefs: z.array(ValidatedCandidateSetRefV1Schema),
  failedWorkItemRefs: z.array(IdentificationWorkItemRefV1Schema),
  acceptedRiskRecordRefs: z.array(StandardizedRiskRecordRefV1Schema),
  rejectedGroupRefs: z.array(IdentificationGroupRefV1Schema),
  pendingGroupRefs: z.array(IdentificationGroupRefV1Schema),
  acceptedRouteSetRef: AcceptanceRouteSetRefV1Schema.optional(),
  lastStageResultRef: StageResultRefV1Schema.optional(),
  lastWaitingRef: IdentificationGraphWaitingV1Schema.optional(),
  lastErrorRef: WorkflowErrorRefV1Schema.optional(),
  resultRef: IdentificationRunResultRefV1Schema.optional(),
});
export type IdentificationGraphRunStateV1 = z.infer<typeof IdentificationGraphRunStateV1Schema>;

/** I9 运行汇总正文（C04 工件）：每个工作项与分组的终态与精确引用。 */
export const IdentificationGraphRunResultV1Schema = z.strictObject({
  schemaVersion: graphSchemaVersion,
  projectId: IdentifierSchema,
  runRef: WorkflowRunRefV1Schema,
  parentRiskFlowRunRef: WorkflowRunRefV1Schema,
  preparationSnapshotRef: IdentificationPreparationSnapshotRefV1Schema,
  inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
  workPlanRef: IdentificationWorkPlanRefV1Schema,
  acceptedRiskRecordRefs: z.array(StandardizedRiskRecordRefV1Schema),
  acceptedEventRefs: z.array(DomainEventRefV1Schema),
  rejectedGroupRefs: z.array(IdentificationGroupRefV1Schema),
  pendingReviewTaskRefs: z.array(ReviewTaskRefV1Schema),
  failedWorkItemRefs: z.array(IdentificationWorkItemRefV1Schema),
  skippedWorkItemRefs: z.array(IdentificationWorkItemRefV1Schema),
  cancelledReasonCode: IdentifierSchema.optional(),
  auditTrailRef: AuditTrailRefV1Schema,
  recordedAt: IsoDateTimeSchema,
});
export type IdentificationGraphRunResultV1 = z.infer<typeof IdentificationGraphRunResultV1Schema>;

/** 取消正文（C04 工件）：取消原因只在此正文，登记行只引用它。 */
export const IdentificationGraphCancellationV1Schema = z.strictObject({
  schemaVersion: graphSchemaVersion,
  runRef: WorkflowRunRefV1Schema,
  reasonCode: IdentifierSchema,
  cancelledAt: IsoDateTimeSchema,
});
export type IdentificationGraphCancellationV1 = z.infer<
  typeof IdentificationGraphCancellationV1Schema
>;

export const IDENTIFICATION_GRAPH_RESULT_KINDS_V1 = [
  "input-snapshot",
  "work-plan",
  "stage-result",
  "waiting",
  "workflow-error",
  "run-state",
  "run-result",
  "cancellation",
] as const;
export const IdentificationGraphResultKindV1Schema = z.enum(IDENTIFICATION_GRAPH_RESULT_KINDS_V1);
export type IdentificationGraphResultKindV1 = z.infer<typeof IdentificationGraphResultKindV1Schema>;

const resultRowBase = {
  schemaVersion: graphSchemaVersion,
  projectId: IdentifierSchema,
  resultId: IdentifierSchema,
  resultVersionId: IdentifierSchema,
  runId: IdentifierSchema,
  runVersionId: IdentifierSchema,
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  requestDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  artifactRef: ContentArtifactRefV1Schema,
  authorizationScopeDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  actorRef: IdentifierSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  validAt: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
  persistedAt: IsoDateTimeSchema,
  auditEntryId: IdentifierSchema,
};

/**
 * D-15：I0/I1 在工作计划形成前登记阶段结果，该判别因此不要求工作计划引用；数据库对应列为可空，
 * 回读登记行时以 SQL NULL 表达同一事实，故这里同时接受缺省与空值。只放宽 `stage-result`
 * 判别自身的引用形状，其它判别的引用仍严格必填，正文引用与事实来源不变。
 */
const stageResultWorkPlanRef = IdentificationWorkPlanRefV1Schema.nullish();

/**
 * 追加式业务登记行（design D-06）：只保存 C24 自有工件的精确引用与最小判别元数据，
 * 不保存文档正文、模型响应或 LangGraph state。数据库 check constraint 与每一类一一对应。
 */
export const IdentificationGraphResultRowV1Schema = z.discriminatedUnion("resultKind", [
  z.strictObject({
    ...resultRowBase,
    resultKind: z.literal("input-snapshot"),
    parentRunRef: WorkflowRunRefV1Schema,
    preparationSnapshotRef: IdentificationPreparationSnapshotRefV1Schema,
    inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
  }),
  z.strictObject({
    ...resultRowBase,
    resultKind: z.literal("work-plan"),
    parentRunRef: WorkflowRunRefV1Schema,
    inputSnapshotRef: IdentificationInputSnapshotRefV1Schema,
    workPlanRef: IdentificationWorkPlanRefV1Schema,
  }),
  z.strictObject({
    ...resultRowBase,
    resultKind: z.literal("stage-result"),
    workPlanRef: stageResultWorkPlanRef,
    stageResultRef: StageResultRefV1Schema,
  }),
  z.strictObject({
    ...resultRowBase,
    resultKind: z.literal("waiting"),
    waitingRef: WaitingRefV1Schema,
    stageResultRef: StageResultRefV1Schema.optional(),
  }),
  z.strictObject({
    ...resultRowBase,
    resultKind: z.literal("workflow-error"),
    workflowErrorRef: WorkflowErrorRefV1Schema,
  }),
  z.strictObject({
    ...resultRowBase,
    resultKind: z.literal("run-state"),
  }),
  z.strictObject({
    ...resultRowBase,
    resultKind: z.literal("run-result"),
    workPlanRef: IdentificationWorkPlanRefV1Schema,
    runResultRef: IdentificationRunResultRefV1Schema,
  }),
  z.strictObject({
    ...resultRowBase,
    resultKind: z.literal("cancellation"),
  }),
]);
export type IdentificationGraphResultRowV1 = z.infer<typeof IdentificationGraphResultRowV1Schema>;

/** 权威 C04 正文类型：每类 `artifactRef` 必须解析为该类型且摘要一致。 */
export const IdentificationGraphArtifactBodyV1Schema = z.discriminatedUnion("bodyKind", [
  z.strictObject({
    bodyKind: z.literal("input-snapshot"),
    inputSnapshot: IdentificationInputSnapshotV1Schema,
  }),
  z.strictObject({
    bodyKind: z.literal("work-plan"),
    workPlan: IdentificationGraphWorkPlanBodyV1Schema,
  }),
  z.strictObject({
    bodyKind: z.literal("stage-result"),
    stageResult: IdentificationStageResultV1Schema,
  }),
  z.strictObject({
    bodyKind: z.literal("run-result"),
    runResult: IdentificationGraphRunResultV1Schema,
  }),
  z.strictObject({
    bodyKind: z.literal("cancellation"),
    cancellation: IdentificationGraphCancellationV1Schema,
  }),
  z.strictObject({
    bodyKind: z.literal("run-state"),
    runState: IdentificationGraphRunStateV1Schema,
  }),
]);
export type IdentificationGraphArtifactBodyV1 = z.infer<
  typeof IdentificationGraphArtifactBodyV1Schema
>;

/** 读取 C04 工件后必须核对的最小事实（design D-04/D-07）。 */
export interface IdentificationGraphWorkPlanReadV1 {
  readonly workPlanRef: IdentificationWorkPlanRefV1;
  readonly inputSnapshotRef: z.infer<typeof IdentificationInputSnapshotRefV1Schema>;
  readonly inputSnapshot: z.infer<typeof IdentificationInputSnapshotV1Schema>;
  readonly workItems: readonly {
    readonly workItemRef: z.infer<typeof IdentificationWorkItemRefV1Schema>;
    readonly nodeId: string;
    readonly spatialScopeRefs: readonly z.infer<typeof SpatialScopeRefV1Schema>[];
    readonly sourceVersionRefs: readonly z.infer<typeof SourceVersionRefV1Schema>[];
    readonly frozenQueryText: string;
  }[];
  readonly validatedCandidateSetRefs: readonly z.infer<typeof ValidatedCandidateSetRefV1Schema>[];
}

export type IdentificationGraphArtifactRef = ArtifactRefV1;

export { graphSchemaVersion };
