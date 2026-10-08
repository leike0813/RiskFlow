/**
 * C35 Agent 任务只读面（design D-02/D-03）。
 *
 * 唯一 read Schema 定义在所属 agent-runtime 模块：查询信封与结果联合直接由 contracts 的
 * `createModuleQuerySchemaV1` / `createModuleResultSchemaV1` 构造，不复制信封形状。
 * 预算、工具行动与逐项校验字段全部从 C08 原 Schema 派生安全投影——原
 * AgentBudgetUsageV1 / AgentTaskBudgetPolicyV1 / AgentBudgetLedgerV1 直接整体引用，
 * 不合并 input/output/context token，不生成虚构总上限。
 *
 * 披露边界：不返回完整授权信封、Worker 租约、数据库行、任意工件正文、模型响应或思维链。
 */
import { z } from "zod";

import {
  AgentTaskRefV1Schema,
  AgentTaskResultRefV1Schema,
  AgentTaskStatusV1Schema,
  AgentTaskTypeV1Schema,
  ContractReferenceV1Schema,
  ReadActionV1Schema,
  StartAgentTaskPayloadV1Schema,
  WorkflowRunRefV1Schema,
  createModuleQuerySchemaV1,
  createModuleResultSchemaV1,
} from "@riskflow/contracts/ports";
import {
  EvidenceReferenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";

import { ArtifactRefV1Schema } from "../artifacts/schema.js";
import {
  AgentBudgetLedgerV1Schema,
  AgentBudgetUsageV1Schema,
  AgentErrorCodeV1Schema,
  AgentExternalEffectV1Schema,
  AgentRejectionClassV1Schema,
  AgentTaskBudgetPolicyV1Schema,
  AgentValidationDispositionV1Schema,
} from "./schema.js";

/** 新目录 pageSize 上限（design D-02）；默认值由所属端口在缺省时取 25。 */
export const AGENT_UI_READ_PAGE_SIZE_MAX_V1 = 50;
export const AGENT_UI_READ_PAGE_SIZE_DEFAULT_V1 = 25;

const readPageSize = z.number().int().min(1).max(AGENT_UI_READ_PAGE_SIZE_MAX_V1);
const readCursor = z.string().min(1).max(512);
const nonNegativeInteger = z.number().int().nonnegative().refine(Number.isSafeInteger);
const positiveInteger = z.number().int().positive().refine(Number.isSafeInteger);

/**
 * 任务摘要：只从已登记 envelope/state 选取身份、发起者、父运行、冻结输入引用与时间。
 * 不含输入正文、预算台账、行动、候选或提案。
 */
export const AgentTaskSummaryV1Schema = z.strictObject({
  agentTaskRef: AgentTaskRefV1Schema,
  status: AgentTaskStatusV1Schema,
  /** 可变 state 版本（与任务身份版本 `agentTaskRef.reference.versionId` 不是同一语义）。 */
  taskVersion: positiveInteger,
  initiatorActorId: IdentifierSchema,
  parentRunRef: WorkflowRunRefV1Schema,
  frozenInputRef: ContractReferenceV1Schema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type AgentTaskSummaryV1 = z.infer<typeof AgentTaskSummaryV1Schema>;

export const AgentTaskListPageV1Schema = z.strictObject({
  kind: z.literal("list"),
  items: z.array(AgentTaskSummaryV1Schema).max(AGENT_UI_READ_PAGE_SIZE_MAX_V1),
  asOfRecordedAt: IsoDateTimeSchema,
  nextCursor: readCursor.optional(),
});
export type AgentTaskListPageV1 = z.infer<typeof AgentTaskListPageV1Schema>;

/**
 * 交互提案安全摘要：从已耐久的原 `AgentCommandProposalV1` 选取可确认字段，
 * 隐藏 commandArtifactRef 与命令正文。确认仍由原 confirm-command 端口按该版本处理。
 */
export const AgentProposalSummaryV1Schema = z.strictObject({
  commandProposalRef: z.strictObject({
    kind: z.literal("command-proposal"),
    reference: VersionReferenceSchema,
  }),
  taskRef: AgentTaskRefV1Schema,
  targetRef: ContractReferenceV1Schema,
  expectedTargetVersion: VersionReferenceSchema,
  expectedEffect: IdentifierSchema,
  externalEffects: z.array(AgentExternalEffectV1Schema),
  proposedAt: IsoDateTimeSchema,
});
export type AgentProposalSummaryV1 = z.infer<typeof AgentProposalSummaryV1Schema>;

/**
 * 预算视图：原策略与原台账整体引用。上限留在策略里，已用/已预留/墙钟/并发留在台账里，
 * 两者都不合并、不重算，界面只需原样呈现。
 */
export const AgentTaskBudgetViewV1Schema = z.strictObject({
  policy: AgentTaskBudgetPolicyV1Schema,
  ledger: AgentBudgetLedgerV1Schema,
});
export type AgentTaskBudgetViewV1 = z.infer<typeof AgentTaskBudgetViewV1Schema>;

/** 结构化安全错误：只有码、类别、可重试标记、阶段与时间，失败正文留在受保护的工件里。 */
export const AgentTaskSafeErrorV1Schema = z.strictObject({
  code: AgentErrorCodeV1Schema,
  category: z.string().trim().min(1),
  retryable: z.boolean(),
  stage: IdentifierSchema,
  occurredAt: IsoDateTimeSchema,
  reasonCode: IdentifierSchema.optional(),
  diagnosticRef: z
    .strictObject({
      kind: z.literal("diagnostic-artifact"),
      reference: VersionReferenceSchema,
    })
    .optional(),
});
export type AgentTaskSafeErrorV1 = z.infer<typeof AgentTaskSafeErrorV1Schema>;

export const AgentTaskDetailV1Schema = z.strictObject({
  kind: z.literal("detail"),
  summary: AgentTaskSummaryV1Schema,
  budget: AgentTaskBudgetViewV1Schema,
  /** 启动/恢复/取消/确认的当前可用性；只读授权不等于写权。 */
  actions: z.array(ReadActionV1Schema).max(8),
  currentProposal: AgentProposalSummaryV1Schema.optional(),
  resultRef: AgentTaskResultRefV1Schema.optional(),
  /** 结构化安全错误：只保留码、类别、可重试标记与阶段，不含失败正文。 */
  safeError: AgentTaskSafeErrorV1Schema.optional(),
});
export type AgentTaskDetailV1 = z.infer<typeof AgentTaskDetailV1Schema>;

/**
 * 安全行动条目：从原 AgentTaskActionV1 选取引用、类型、状态、实际用量与时间。
 * 刻意不含 toolRef 与观察正文：动作行本身不登记工具身份，正文只存在于受保护的意图工件，
 * 由所属模块按原工件读取后另行复验，不在本读面推断工具归属（design D-03）。
 */
export const AgentActionEntryV1Schema = z.strictObject({
  actionId: IdentifierSchema,
  sequence: nonNegativeInteger,
  actionType: z.string().trim().min(1),
  status: z.string().trim().min(1),
  intentArtifactRef: ArtifactRefV1Schema,
  resultRef: ContractReferenceV1Schema.optional(),
  resultArtifactRef: ArtifactRefV1Schema.optional(),
  errorCode: IdentifierSchema.optional(),
  usage: AgentBudgetUsageV1Schema,
  recordedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.optional(),
});
export type AgentActionEntryV1 = z.infer<typeof AgentActionEntryV1Schema>;

export const AgentActionPageV1Schema = z.strictObject({
  kind: z.literal("actions"),
  agentTaskRef: AgentTaskRefV1Schema,
  items: z.array(AgentActionEntryV1Schema).max(AGENT_UI_READ_PAGE_SIZE_MAX_V1),
  nextCursor: readCursor.optional(),
});
export type AgentActionPageV1 = z.infer<typeof AgentActionPageV1Schema>;

/**
 * 候选条目：版本、候选/增量/校验工件引用与处置。业务摘要只能来自已注册任务定义的
 * 安全显示映射；无映射时界面显示类型与引用，本 DTO 不通用遍历候选 JSON。
 */
export const AgentCandidateEntryV1Schema = z.strictObject({
  candidateVersion: positiveInteger,
  parentCandidateVersion: nonNegativeInteger,
  candidateArtifactRef: ArtifactRefV1Schema,
  incrementArtifactRef: ArtifactRefV1Schema,
  validationArtifactRef: ArtifactRefV1Schema.optional(),
  disposition: z.enum(["pending", "accepted", "rejected", "completed"]),
  rejectionClass: AgentRejectionClassV1Schema.optional(),
  createdAt: IsoDateTimeSchema,
});
export type AgentCandidateEntryV1 = z.infer<typeof AgentCandidateEntryV1Schema>;

export const AgentCandidatePageV1Schema = z.strictObject({
  kind: z.literal("candidates"),
  agentTaskRef: AgentTaskRefV1Schema,
  items: z.array(AgentCandidateEntryV1Schema).max(AGENT_UI_READ_PAGE_SIZE_MAX_V1),
  nextCursor: readCursor.optional(),
});
export type AgentCandidatePageV1 = z.infer<typeof AgentCandidatePageV1Schema>;

/** 逐项校验条目：按原 checkId 与原数组位置稳定分页，引用不可见时整页安全失败。 */
export const AgentValidationCheckEntryV1Schema = z.strictObject({
  checkId: IdentifierSchema,
  disposition: AgentValidationDispositionV1Schema,
  rejectionClass: AgentRejectionClassV1Schema.optional(),
  reasonCode: IdentifierSchema,
  evidenceReferences: z.array(EvidenceReferenceSchema).max(16),
});
export type AgentValidationCheckEntryV1 = z.infer<typeof AgentValidationCheckEntryV1Schema>;

export const AgentValidationPageV1Schema = z.strictObject({
  kind: z.literal("validation"),
  agentTaskRef: AgentTaskRefV1Schema,
  candidateVersion: positiveInteger,
  items: z.array(AgentValidationCheckEntryV1Schema).max(AGENT_UI_READ_PAGE_SIZE_MAX_V1),
  nextCursor: readCursor.optional(),
});
export type AgentValidationPageV1 = z.infer<typeof AgentValidationPageV1Schema>;

/**
 * 启动上下文：只有已登记且当前支持 interactive 的定义才返回完整原启动载荷；
 * 否则按原稳定语义给出不支持原因，不推测缺失策略、不扩模型/工具/预算。
 */
export const AgentLaunchContextV1Schema = z.discriminatedUnion("supported", [
  z.strictObject({ supported: z.literal(true), payload: StartAgentTaskPayloadV1Schema }),
  z.strictObject({
    supported: z.literal(false),
    reasonCode: IdentifierSchema,
  }),
]);
export type AgentLaunchContextV1 = z.infer<typeof AgentLaunchContextV1Schema>;

export const AgentLaunchContextResultV1Schema = z.strictObject({
  kind: z.literal("launch-context"),
  sourceAgentTaskRef: AgentTaskRefV1Schema,
  launchContext: AgentLaunchContextV1Schema,
});
export type AgentLaunchContextResultV1 = z.infer<typeof AgentLaunchContextResultV1Schema>;

const listPayload = z.strictObject({
  taskType: AgentTaskTypeV1Schema.optional(),
  status: AgentTaskStatusV1Schema.optional(),
  parentRunRef: WorkflowRunRefV1Schema.optional(),
  cursor: readCursor.optional(),
  pageSize: readPageSize.optional(),
});
const detailPayload = z.strictObject({ agentTaskRef: AgentTaskRefV1Schema });
const targetPagePayload = z.strictObject({
  agentTaskRef: AgentTaskRefV1Schema,
  cursor: readCursor.optional(),
  pageSize: readPageSize.optional(),
});
const validationPayload = z.strictObject({
  agentTaskRef: AgentTaskRefV1Schema,
  candidateVersion: positiveInteger,
  cursor: readCursor.optional(),
  pageSize: readPageSize.optional(),
});
const launchContextPayload = z.strictObject({ sourceAgentTaskRef: AgentTaskRefV1Schema });

export const AgentTaskReadQueryV1Schema = z.discriminatedUnion("kind", [
  createModuleQuerySchemaV1("list", listPayload, "agent-task.read"),
  createModuleQuerySchemaV1("detail", detailPayload, "agent-task.read"),
  createModuleQuerySchemaV1("actions", targetPagePayload, "agent-task.read"),
  createModuleQuerySchemaV1("candidates", targetPagePayload, "agent-task.read"),
  createModuleQuerySchemaV1("validation", validationPayload, "agent-task.read"),
  createModuleQuerySchemaV1("launch-context", launchContextPayload, "agent-task.read"),
]);
export type AgentTaskReadQueryV1 = z.infer<typeof AgentTaskReadQueryV1Schema>;

/**
 * 传输层载荷：只有 `kind` 与该 kind 的真实入参——字段形状与上面各 payload 完全同一份
 * 定义，不另抄。服务端补回信封后客户端无法自造主体身份，也拿不到信封里的授权上下文。
 */
export const AgentTaskReadPayloadV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("list"), ...listPayload.shape }),
  z.strictObject({ kind: z.literal("detail"), ...detailPayload.shape }),
  z.strictObject({ kind: z.literal("actions"), ...targetPagePayload.shape }),
  z.strictObject({ kind: z.literal("candidates"), ...targetPagePayload.shape }),
  z.strictObject({ kind: z.literal("validation"), ...validationPayload.shape }),
  z.strictObject({ kind: z.literal("launch-context"), ...launchContextPayload.shape }),
]);
export type AgentTaskReadPayloadV1 = z.infer<typeof AgentTaskReadPayloadV1Schema>;

export const AgentTaskReadSuccessV1Schema = z.discriminatedUnion("kind", [
  AgentTaskListPageV1Schema,
  AgentTaskDetailV1Schema,
  AgentActionPageV1Schema,
  AgentCandidatePageV1Schema,
  AgentValidationPageV1Schema,
  AgentLaunchContextResultV1Schema,
]);
export type AgentTaskReadSuccessV1 = z.infer<typeof AgentTaskReadSuccessV1Schema>;

export const AgentTaskReadResultV1Schema = createModuleResultSchemaV1(
  AgentTaskReadSuccessV1Schema,
);
export type AgentTaskReadResultV1 = z.infer<typeof AgentTaskReadResultV1Schema>;

/**
 * 有界窄读端口：写入口（start/resume/cancel/confirm-command）保持原样不变，
 * UI 只通过本端口读取当前工程内获准任务的安全投影。
 */
export interface AgentTaskReadPortV1 {
  read(query: AgentTaskReadQueryV1): Promise<AgentTaskReadResultV1>;
}