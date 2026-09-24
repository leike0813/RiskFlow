/**
 * C30 自有运行事实 Schema（design D-05/D-06）。
 *
 * 本模块只定义 C30 自己的只追加登记行、链边、查询登记与运行状态/汇总正文；图状态仍引用
 * `@riskflow/contracts/workflows` 的单一公共 Schema，不另造第二套状态机。登记行只保存精确引用、
 * 版本、命令/幂等/授权摘要与业务/记录/持久化时点，正文只入 C04。
 */
import { z } from "zod";

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import {
  AuditTrailRefV1Schema,
  AuthorizationContextRefV1Schema,
  CalibrationSuggestionRefV1Schema,
  ContentArtifactRefV1Schema,
  ContractReferenceV1Schema,
  DeviationRecordRefV1Schema,
  ResponseRecommendationRefV1Schema,
  RiskAssessmentRecordRefV1Schema,
  RouteDecisionRefV1Schema,
  SpatialScopeRefV1Schema,
  StageResultRefV1Schema,
  StandardizedRiskRecordRefV1Schema,
  WaitingRefV1Schema,
  WarningRecordRefV1Schema,
  WorkflowEntryModeV1Schema,
  WorkflowErrorRefV1Schema,
  WorkflowLinkRelationV1Schema,
  WorkflowRunRefV1Schema,
  WorkflowRunStatusV1Schema,
  WorkflowSkippedTailKindV1Schema,
  WORKFLOW_LINK_RELATIONS_V1,
  WORKFLOW_SKIPPED_TAIL_KINDS_V1,
} from "@riskflow/contracts/ports";
import { AssessmentStageV1Schema, RiskFlowStageV1Schema } from "@riskflow/contracts/workflows";

export const WORKFLOW_GRAPH_SCHEMA_VERSION_V1 = "1" as const;

const schemaVersion = z.literal(WORKFLOW_GRAPH_SCHEMA_VERSION_V1);
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);

/** 登记行闭合 kind（design D-05）：未发生的分支只登记阶段原因，不虚构行。 */
export const WORKFLOW_GRAPH_RESULT_KINDS_V1 = [
  "entry-snapshot",
  "stage-result",
  "route-decision",
  "run-state",
  "waiting",
  "workflow-error",
  "run-result",
] as const;
export const WorkflowGraphResultKindV1Schema = z.enum(WORKFLOW_GRAPH_RESULT_KINDS_V1);
export type WorkflowGraphResultKindV1 = z.infer<typeof WorkflowGraphResultKindV1Schema>;

/** 链边闭合关系码来自公共契约（design D-05）：C30 不维护第二份取值。 */
export { WorkflowLinkRelationV1Schema, WORKFLOW_LINK_RELATIONS_V1 };
export type { WorkflowLinkRelationV1 } from "@riskflow/contracts/ports";

/** 缺席链尾类型同样来自公共契约（C31 design D-01）：报告谓词与登记共用一个闭合取值。 */
export { WorkflowSkippedTailKindV1Schema, WORKFLOW_SKIPPED_TAIL_KINDS_V1 };
export type { WorkflowSkippedTailKindV1 } from "@riskflow/contracts/ports";

/** 运行阶段：父运行取 `RiskFlowStageV1`，评估子运行取 `AssessmentStageV1`。 */
export const WorkflowRunStageV1Schema = z.union([RiskFlowStageV1Schema, AssessmentStageV1Schema]);
export type WorkflowRunStageV1 = z.infer<typeof WorkflowRunStageV1Schema>;

export const WORKFLOW_GRAPH_ERROR_CODES_V1 = [
  "ENTRY_REFERENCES_INCOMPLETE",
  "UPSTREAM_WAITING",
  "AUTHORIZATION_DENIED",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "CHECKPOINT_INCONSISTENT",
  "CONTRACT_INVALID",
  "CANCELLED",
  "RUN_NOT_FOUND",
  "RUN_TERMINATED",
  "RETRYABLE_INFRASTRUCTURE_FAILURE",
] as const;
export const WorkflowGraphErrorCodeV1Schema = z.enum(WORKFLOW_GRAPH_ERROR_CODES_V1);
export type WorkflowGraphErrorCodeV1 = z.infer<typeof WorkflowGraphErrorCodeV1Schema>;

/** C30 内部结构化错误（design D-07）：只带稳定 code、retryable、阶段与诊断引用，不含正文。 */
export const WorkflowGraphErrorV1Schema = z.strictObject({
  schemaVersion,
  code: WorkflowGraphErrorCodeV1Schema,
  retryable: z.boolean(),
  stage: WorkflowRunStageV1Schema,
  detailCode: IdentifierSchema,
  diagnosticRef: VersionReferenceSchema.optional(),
  occurredAt: IsoDateTimeSchema,
});
export type WorkflowGraphErrorV1 = z.infer<typeof WorkflowGraphErrorV1Schema>;

const rowBase = {
  schemaVersion,
  projectId: IdentifierSchema,
  resultId: IdentifierSchema,
  resultVersionId: IdentifierSchema,
  runId: IdentifierSchema,
  runVersionId: IdentifierSchema,
  parentRunId: IdentifierSchema.optional(),
  threadId: IdentifierSchema.optional(),
  entryMode: WorkflowEntryModeV1Schema,
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  requestDigest: digestSchema,
  actorRef: IdentifierSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  authorizationScopeDigest: digestSchema,
  validAt: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
  persistedAt: IsoDateTimeSchema,
  auditEntryId: IdentifierSchema,
  artifactRef: ContentArtifactRefV1Schema.optional(),
};

const rowRefs = {
  stage: WorkflowRunStageV1Schema.optional(),
  entryIdentity: VersionReferenceSchema.optional(),
  inputSnapshotRef: ContractReferenceV1Schema.optional(),
  stageResultRef: StageResultRefV1Schema.optional(),
  routeDecisionRef: RouteDecisionRefV1Schema.optional(),
  routeKind: IdentifierSchema.optional(),
  waitingRef: WaitingRefV1Schema.optional(),
  workflowErrorRef: WorkflowErrorRefV1Schema.optional(),
  runResultRef: ContractReferenceV1Schema.optional(),
  frozenRefs: z.array(ContractReferenceV1Schema),
};

/**
 * 只追加业务登记行（design D-05）：`resultKind` 决定必填引用，其它引用缺省；数据库 check
 * constraint 与每一类一一对应。行只保存精确引用与最小判别元数据，不保存正文。
 */
export const WorkflowGraphResultRowV1Schema = z
  .strictObject({ ...rowBase, ...rowRefs, resultKind: WorkflowGraphResultKindV1Schema })
  .superRefine((row, context) => {
    const require = (field: keyof typeof rowRefs, kind: WorkflowGraphResultKindV1) => {
      if (row[field] === undefined) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${kind} row requires ${field}`,
        });
      }
    };
    switch (row.resultKind) {
      case "entry-snapshot":
        require("entryIdentity", row.resultKind);
        require("stage", row.resultKind);
        break;
      case "stage-result":
        require("stage", row.resultKind);
        require("stageResultRef", row.resultKind);
        break;
      case "route-decision":
        require("routeDecisionRef", row.resultKind);
        require("routeKind", row.resultKind);
        break;
      case "run-state":
        if (row.resultVersionId !== row.runVersionId) {
          context.addIssue({
            code: "custom",
            path: ["runVersionId"],
            message: "run-state row version is the run state version",
          });
        }
        require("stage", row.resultKind);
        break;
      case "waiting":
        require("waitingRef", row.resultKind);
        require("stage", row.resultKind);
        break;
      case "workflow-error":
        require("workflowErrorRef", row.resultKind);
        require("stage", row.resultKind);
        break;
      case "run-result":
        require("runResultRef", row.resultKind);
        require("stage", row.resultKind);
        break;
    }
  });
export type WorkflowGraphResultRowV1 = z.infer<typeof WorkflowGraphResultRowV1Schema>;

/** 运行状态正文（C04 工件）：只含引用、阶段与版本，不含正文（design D-05/D-08）。 */
export const WorkflowGraphRunStateV1Schema = z.strictObject({
  schemaVersion,
  projectId: IdentifierSchema,
  runId: IdentifierSchema,
  runVersionId: IdentifierSchema,
  entryMode: WorkflowEntryModeV1Schema,
  entryIdentity: VersionReferenceSchema,
  stage: WorkflowRunStageV1Schema,
  status: WorkflowRunStatusV1Schema,
  parentRunRef: WorkflowRunRefV1Schema.optional(),
  identificationRunRef: WorkflowRunRefV1Schema.optional(),
  assessmentRunRefs: z.array(WorkflowRunRefV1Schema),
  acceptedRiskRecordRefs: z.array(StandardizedRiskRecordRefV1Schema),
  assessmentRecordRefs: z.array(RiskAssessmentRecordRefV1Schema),
  warningRecordRefs: z.array(WarningRecordRefV1Schema),
  responseRecommendationRefs: z.array(ResponseRecommendationRefV1Schema),
  deviationRecordRefs: z.array(DeviationRecordRefV1Schema),
  calibrationSuggestionRefs: z.array(CalibrationSuggestionRefV1Schema),
  lastStageResultRef: StageResultRefV1Schema.optional(),
  lastRouteDecisionRef: RouteDecisionRefV1Schema.optional(),
  lastWaitingRef: WaitingRefV1Schema.optional(),
  lastErrorRef: WorkflowErrorRefV1Schema.optional(),
  resultRef: ContractReferenceV1Schema.optional(),
  recordedAt: IsoDateTimeSchema,
});
export type WorkflowGraphRunStateV1 = z.infer<typeof WorkflowGraphRunStateV1Schema>;

/** 缺席链尾的类型化原因（design D-05/D-09）：只登记原因码与最后成立事实引用。 */
export const WorkflowSkippedTailV1Schema = z.strictObject({
  tailKind: WorkflowSkippedTailKindV1Schema,
  reasonCode: IdentifierSchema,
  lastEstablishedRef: ContractReferenceV1Schema.optional(),
});
export type WorkflowSkippedTailV1 = z.infer<typeof WorkflowSkippedTailV1Schema>;

/** 运行汇总正文（C04 工件）：只汇总精确引用与缺席原因，不复制领域正文。 */
export const WorkflowGraphRunResultV1Schema = z.strictObject({
  schemaVersion,
  projectId: IdentifierSchema,
  runRef: WorkflowRunRefV1Schema,
  entryMode: WorkflowEntryModeV1Schema,
  stage: WorkflowRunStageV1Schema,
  parentRunRef: WorkflowRunRefV1Schema.optional(),
  identificationRunRef: WorkflowRunRefV1Schema.optional(),
  assessmentRunRefs: z.array(WorkflowRunRefV1Schema),
  assessmentRecordRefs: z.array(RiskAssessmentRecordRefV1Schema),
  warningRecordRefs: z.array(WarningRecordRefV1Schema),
  responseRecommendationRefs: z.array(ResponseRecommendationRefV1Schema),
  deviationRecordRefs: z.array(DeviationRecordRefV1Schema),
  calibrationSuggestionRefs: z.array(CalibrationSuggestionRefV1Schema),
  skippedTails: z.array(WorkflowSkippedTailV1Schema),
  auditTrailRef: AuditTrailRefV1Schema,
  recordedAt: IsoDateTimeSchema,
});
export type WorkflowGraphRunResultV1 = z.infer<typeof WorkflowGraphRunResultV1Schema>;

/** 只追加链边（design D-05）：由已成立事实重建，未发生的关系不写空边。 */
export const WorkflowGraphLinkV1Schema = z.strictObject({
  schemaVersion,
  projectId: IdentifierSchema,
  linkId: IdentifierSchema,
  runId: IdentifierSchema,
  fromRef: ContractReferenceV1Schema,
  toRef: ContractReferenceV1Schema,
  relation: WorkflowLinkRelationV1Schema,
  sourceStage: WorkflowRunStageV1Schema,
  stageResultRef: StageResultRefV1Schema.optional(),
  evidenceLocator: z.strictObject({ sourceSegmentId: IdentifierSchema }).optional(),
  authorizationContextRef: AuthorizationContextRefV1Schema,
  authorizationScopeDigest: digestSchema,
  actorRef: IdentifierSchema,
  recordedAt: IsoDateTimeSchema,
  auditEntryId: IdentifierSchema,
});
export type WorkflowGraphLinkV1 = z.infer<typeof WorkflowGraphLinkV1Schema>;

/** 查询登记（design D-06）：`ProjectionPortV1.query` 的精确目标、权限快照与记录时点。 */
export const WorkflowQueryRegistrationV1Schema = z.strictObject({
  schemaVersion,
  projectId: IdentifierSchema,
  queryResultId: IdentifierSchema,
  queryResultVersionId: IdentifierSchema,
  queryType: IdentifierSchema,
  targetRef: ContractReferenceV1Schema,
  runId: IdentifierSchema.optional(),
  /** C31 工程总览的精确空间目标（design D-03）：随登记冻结，旧分支为空仍按原语义读取。 */
  spatialScopeRef: SpatialScopeRefV1Schema.optional(),
  actorRef: IdentifierSchema,
  authorizationContextRef: AuthorizationContextRefV1Schema,
  authorizationScopeDigest: digestSchema,
  requestedAt: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
  persistedAt: IsoDateTimeSchema,
  auditEntryId: IdentifierSchema,
});
export type WorkflowQueryRegistrationV1 = z.infer<typeof WorkflowQueryRegistrationV1Schema>;

/** 权威 C04 正文类型：每个 `artifactRef` 必须解析为该类型。 */
export const WorkflowGraphArtifactBodyV1Schema = z.discriminatedUnion("bodyKind", [
  z.strictObject({ bodyKind: z.literal("run-state"), runState: WorkflowGraphRunStateV1Schema }),
  z.strictObject({ bodyKind: z.literal("run-result"), runResult: WorkflowGraphRunResultV1Schema }),
]);
export type WorkflowGraphArtifactBodyV1 = z.infer<typeof WorkflowGraphArtifactBodyV1Schema>;
