import { Buffer } from "node:buffer";

import { z, type ZodType } from "zod";
import { ArtifactStoreError } from "@riskflow/core/artifacts";

import {
  ApplicableRuleSetAssemblyCommandV1Schema,
  ApplicableRuleSetAssemblyResultV1Schema,
  AssessmentEvaluationCommandV1Schema,
  AssessmentEvaluationResultV1Schema,
  AssessmentPreparationCommandV1Schema,
  AssessmentPreparationResultV1Schema,
  AuthorizationContextRefV1Schema,
  CancelAgentTaskCommandV1Schema,
  CancelAgentTaskResultV1Schema,
  CancelWorkflowRunCommandV1Schema,
  CancelWorkflowRunResultV1Schema,
  ConfirmAgentCommandV1Schema,
  ConfirmAgentCommandResultV1Schema,
  ContractReferenceV1Schema,
  DomainEventRefV1Schema,
  EngineeringDataApplyResultV1Schema,
  EngineeringDataCatalogQueryV1Schema,
  EngineeringDataCatalogResultV1Schema,
  EngineeringDataCommandV1Schema,
  EngineeringDataQueryV1Schema,
  EngineeringDataReadResultV1Schema,
  SourceOriginalQueryV1Schema,
  SourceOriginalReadResultV1Schema,
  type SourceOriginalReadPortV1,
  type SourceOriginalQueryV1,
  EngineeringFreezeCommandV1Schema,
  EngineeringFreezeResultV1Schema,
  IdentificationAnalysisCommandV1Schema,
  IdentificationAnalysisResultV1Schema,
  IdentificationFinalizationCommandV1Schema,
  IdentificationFinalizationResultV1Schema,
  IdentificationPlanCommandV1Schema,
  IdentificationPlanResultV1Schema,
  KnowledgeGovernanceCommandV1Schema,
  KnowledgeGovernanceReadQueryV1Schema,
  KnowledgeGovernanceReadResultV1Schema,
  KnowledgeGovernanceResultV1Schema,
  KnowledgeResolutionCommandV1Schema,
  KnowledgeResolutionResultV1Schema,
  KnowledgeRetrievalQueryV1Schema,
  KnowledgeRetrievalReadQueryV1Schema,
  KnowledgeRetrievalReadResultV1Schema,
  KnowledgeRetrievalResultV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  OpenWarningCommandV1Schema,
  OpenWarningResultV1Schema,
  ProjectionExportRequestV1Schema,
  ProjectionExportResultV1Schema,
  ProjectionQueryResultV1Schema,
  ProjectionQueryV1Schema,
  ProjectionResultReadQueryResultV1Schema,
  ProjectionResultReadQueryV1Schema,
  ProjectionSubscriptionResultV1Schema,
  RecommendationCommandV1Schema,
  RecommendationResultV1Schema,
  ResumeAgentTaskCommandV1Schema,
  ResumeAgentTaskResultV1Schema,
  ResumeWorkflowRunCommandV1Schema,
  ResumeWorkflowRunResultV1Schema,
  ReviewDecisionCommandV1Schema,
  ReviewDecisionResultV1Schema,
  ReviewQueueReadQueryV1Schema,
  ReviewQueueReadResultV1Schema,
  ReviewRequestResultV1Schema,
  ReviewRequestV1Schema,
  RiskAssessmentReadQueryV1Schema,
  RiskAssessmentReadResultV1Schema,
  RiskDashboardReadQueryV1Schema,
  RiskDashboardReadResultV1Schema,
  RiskIdentificationReadQueryV1Schema,
  RiskIdentificationReadResultV1Schema,
  CalibrationGovernanceCommandV1Schema,
  CalibrationGovernanceDraftResultV1Schema,
  CalibrationReviewOutcomeResultV1Schema,
  WarningResponseReadQueryV1Schema,
  WarningResponseReadResultV1Schema,
  RunSubscriptionRequestV1Schema,
  SpatialScopeRefV1Schema,
  StartAgentTaskCommandV1Schema,
  StartAgentTaskResultV1Schema,
  StartWorkflowRunCommandV1Schema,
  StartWorkflowRunResultV1Schema,
  TraceQueryV1Schema,
  TraceResultV1Schema,
  WarningResponseRecordCommandV1Schema,
  WarningResponseRecordResultV1Schema,
  WorkflowRunRefV1Schema,
  type AgentTaskPortV1,
  type ApplicableRuleSetAssemblyCommandV1,
  type ApplicableRuleSetAssemblyPortV1,
  type AssessmentEvaluationCommandV1,
  type AssessmentPreparationCommandV1,
  type CancelAgentTaskCommandV1,
  type CancelWorkflowRunCommandV1,
  type ConfirmAgentCommandV1,
  type EngineeringDataCatalogPortV1,
  type EngineeringDataCatalogQueryV1,
  type EngineeringDataCommandV1,
  type EngineeringDataPortV1,
  type EngineeringDataQueryV1,
  type EngineeringFreezeCommandV1,
  type HumanDecisionFeedbackCommandV1,
  type HumanDecisionFeedbackPortV1,
  type IdentificationAnalysisCommandV1,
  type IdentificationFinalizationCommandV1,
  type IdentificationPlanCommandV1,
  type KnowledgeGovernanceCommandV1,
  type KnowledgeGovernanceReadPortV1,
  type KnowledgeGovernanceReadQueryV1,
  type KnowledgeModelingPortV1,
  type KnowledgeResolutionCommandV1,
  type KnowledgeRetrievalQueryV1,
  type KnowledgeRetrievalReadPortV1,
  type KnowledgeRetrievalReadQueryV1,
  type ModuleBranchV1,
  type ModuleCapabilityV1,
  type OpenWarningCommandV1,
  type ProjectionExportRequestV1,
  type ProjectionPortV1,
  type ProjectionQueryResultV1,
  type ProjectionQueryV1,
  type ProjectionResultReadPortV1,
  type ProjectionResultReadQueryV1,
  type RecommendationCommandV1,
  type RiskDashboardReadPortV1,
  type RiskDashboardReadQueryV1,
  type ResumeAgentTaskCommandV1,
  type ResumeWorkflowRunCommandV1,
  type ReviewAuditPortV1,
  type ReviewDecisionCommandV1,
  type ReviewQueueReadPortV1,
  type ReviewQueueReadQueryV1,
  type ReviewRequestV1,
  type RiskAssessmentPortV1,
  type RiskAssessmentReadPortV1,
  type RiskAssessmentReadQueryV1,
  type RiskIdentificationPortV1,
  type RiskIdentificationReadPortV1,
  type RiskIdentificationReadQueryV1,
  type CalibrationGovernancePortV1,
  type CalibrationGovernanceCommandV1,
  type WarningResponseReadPortV1,
  type WarningResponseReadQueryV1,
  type RunSubscriptionRequestV1,
  type AuthorizationContextV1,
  type ProjectionSubscriptionResultV1,
  type SpatialScopeRefV1,
  type SourceAccessGrantRefV1,
  type SourceVersionRefV1,
  type StartAgentTaskCommandV1,
  type StartWorkflowRunCommandV1,
  type TraceQueryV1,
  ProjectAccessPresentationV1Schema,
  type WarningResponsePortV1,
  type WarningResponseRecordCommandV1,
  type WorkflowPortV1,
} from "@riskflow/contracts/ports";
import {
  AccessErrorV1Schema,
  AccessServiceError,
  AuthorizationDecisionV1Schema,
  AuthorizationRequestV1Schema,
  ChangePasswordCommandV1Schema,
  LoginCommandV1Schema,
  LoginNameInputV1Schema,
  ReadSessionCommandV1Schema,
  LogoutCommandV1Schema,
  PasswordV1Schema,
  SessionMetadataV1Schema as CoreSessionMetadataV1Schema,
  SessionResultV1Schema,
  SourceVersionRefSetV1Schema,
  type AccessErrorV1,
  type AuthorizationDecisionV1,
  type LocalIdentityAccessV1,
  type ProjectAccessPresentationPortV1,
} from "@riskflow/core/access";
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";
import {
  SystemAdministrationCommandPayloadV1Schema,
  SystemAdministrationCommandV1Schema,
  SystemAdministrationExecuteResultV1Schema,
  SystemAdministrationReadQueryV1Schema,
  SystemAdministrationReadResultV1Schema,
  type SystemAdministrationCommandV1,
  type SystemAdministrationPortV1,
  type SystemAdministrationReadQueryV1,
} from "@riskflow/core/access";
import {
  AgentTaskReadPayloadV1Schema,
  AgentTaskReadQueryV1Schema,
  AgentTaskReadResultV1Schema,
  type AgentTaskReadPortV1,
  type AgentTaskReadQueryV1,
} from "@riskflow/core/agent-runtime";
import {
  ReviewAuditReadPayloadV1Schema,
  ReviewAuditReadQueryV1Schema,
  ReviewAuditReadResultV1Schema,
  type ReviewAuditReadPortV1,
  type ReviewAuditReadQueryV1,
} from "@riskflow/core/review-audit";
import {
  ProjectionReportReadPayloadV1Schema,
  ProjectionReportReadQueryV1Schema,
  ProjectionReportReadResultV1Schema,
  type ProjectionReportReadPortV1,
  type ProjectionReportReadQueryV1,
} from "@riskflow/core/workflow";
import {
  SystemOperationsQueryRequestV1Schema,
  SystemOperationsQueryResultEnvelopeV1Schema,
  type SystemOperationsReadPortV1,
} from "./operations.js";

export const HTTP_SCHEMA_VERSION_V1 = "1" as const;
export const HTTP_COOKIE_NAME_V1 = "__Host-riskflow_session" as const;
export const HTTP_JSON_MEDIA_TYPE_V1 = "application/json" as const;
export const HTTP_SSE_MEDIA_TYPE_V1 = "text/event-stream" as const;

export const HTTP_ACCESS_LOG_RESULT_CATEGORY_VALUES = ["succeeded", "waiting", "failed"] as const;
export type HttpAccessLogResultCategoryV1 = (typeof HTTP_ACCESS_LOG_RESULT_CATEGORY_VALUES)[number];
export type HttpAccessLogEntryV1 = Readonly<{
  route: string;
  requestId: string;
  commandId?: string;
  queryId?: string;
  runId?: string;
  projectId?: string;
  resultCategory: HttpAccessLogResultCategoryV1;
  status: number;
  durationMs: number;
  errorCode?: HttpErrorCodeV1;
}>;
export type HttpAccessLogV1 = (entry: HttpAccessLogEntryV1) => void | Promise<void>;

export const HTTP_ERROR_CODE_VALUES = [
  "CONTRACT_INVALID",
  "AUTHENTICATION_REQUIRED",
  "PASSWORD_CHANGE_REQUIRED",
  "NOT_FOUND",
  "STALE_VERSION",
  "IDEMPOTENCY_CONFLICT",
  "BUSINESS_BLOCKED",
  "UNSUPPORTED_MEDIA_TYPE",
  "UNSUPPORTED_CONTRACT",
  "REQUEST_TOO_LARGE",
  "TRANSIENT_FAILURE",
  "TERMINAL_FAILURE",
] as const;
export const HttpErrorCodeV1Schema = z.enum(HTTP_ERROR_CODE_VALUES);
export type HttpErrorCodeV1 = z.infer<typeof HttpErrorCodeV1Schema>;

export const HttpErrorV1Schema = z.strictObject({
  schemaVersion: z.literal(HTTP_SCHEMA_VERSION_V1),
  requestId: IdentifierSchema,
  code: HttpErrorCodeV1Schema,
  retryable: z.boolean(),
  occurredAt: IsoDateTimeSchema,
  references: z.array(ContractReferenceV1Schema).max(16),
  attempt: z.number().int().positive().optional(),
  retryAt: IsoDateTimeSchema.optional(),
});
export type HttpErrorV1 = z.infer<typeof HttpErrorV1Schema>;

const RequestedSpatialScopeRefSetV1Schema = z
  .array(SpatialScopeRefV1Schema)
  .max(128)
  .refine((values) => new Set(values.map((value) => JSON.stringify(value))).size === values.length);

const httpEnvelopeBase = {
  schemaVersion: z.literal(HTTP_SCHEMA_VERSION_V1),
  requestedSpatialScopeRefs: RequestedSpatialScopeRefSetV1Schema,
  requestedSourceVersionRefs: SourceVersionRefSetV1Schema,
};

export const HttpCommandRequestV1Schema = z.strictObject({
  ...httpEnvelopeBase,
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  issuedAt: IsoDateTimeSchema,
  payload: z.unknown(),
});
export type HttpCommandRequestV1 = z.infer<typeof HttpCommandRequestV1Schema>;

export const HttpQueryRequestV1Schema = z.strictObject({
  ...httpEnvelopeBase,
  queryId: IdentifierSchema,
  requestedAt: IsoDateTimeSchema,
  payload: z.unknown(),
});
export type HttpQueryRequestV1 = z.infer<typeof HttpQueryRequestV1Schema>;

export const SessionLoginRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(HTTP_SCHEMA_VERSION_V1),
  loginAttemptId: IdentifierSchema,
  loginName: LoginNameInputV1Schema,
  password: z.string().max(512),
});
export type SessionLoginRequestV1 = z.infer<typeof SessionLoginRequestV1Schema>;

export const SessionChangePasswordRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(HTTP_SCHEMA_VERSION_V1),
  newPassword: PasswordV1Schema,
});
export type SessionChangePasswordRequestV1 = z.infer<typeof SessionChangePasswordRequestV1Schema>;

export const SessionLogoutRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(HTTP_SCHEMA_VERSION_V1),
});
export type SessionLogoutRequestV1 = z.infer<typeof SessionLogoutRequestV1Schema>;

const SessionReferenceV1Schema = z.strictObject({
  entityId: IdentifierSchema,
  versionId: IdentifierSchema,
});
export const SessionMetadataV1Schema = z.strictObject({
  schemaVersion: z.literal(HTTP_SCHEMA_VERSION_V1),
  sessionRef: SessionReferenceV1Schema,
  accountRef: SessionReferenceV1Schema,
  passwordChangeRequired: z.boolean(),
  restricted: z.boolean(),
  expiresAt: IsoDateTimeSchema,
  systemAdministrationContextRef: AuthorizationContextRefV1Schema.optional(),
});
export type SessionMetadataV1 = z.infer<typeof SessionMetadataV1Schema>;

export const SseQueryRequestV1Schema = z.strictObject({
  afterEventId: IdentifierSchema.optional(),
});
export type SseQueryRequestV1 = z.infer<typeof SseQueryRequestV1Schema>;

const WorkflowRunPathPayloadV1Schema = z.strictObject({
  entityId: IdentifierSchema,
  versionId: IdentifierSchema,
});
type WorkflowRunPathPayloadV1 = z.infer<typeof WorkflowRunPathPayloadV1Schema>;

const decodeWorkflowRunPathPayload = (value: string): WorkflowRunPathPayloadV1 | undefined => {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const parsed = WorkflowRunPathPayloadV1Schema.safeParse(decoded);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

const encodeWorkflowRunPathPayload = (value: WorkflowRunPathPayloadV1): string =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

export const HTTP_WORKFLOW_RUN_ID_MAX_LENGTH_V1 = 2_048;

export const EncodedWorkflowRunIdV1Schema = z
  .string()
  .min(1)
  .max(HTTP_WORKFLOW_RUN_ID_MAX_LENGTH_V1)
  .regex(/^[A-Za-z0-9_-]+$/)
  .superRefine((value, context) => {
    const decoded = decodeWorkflowRunPathPayload(value);
    if (decoded === undefined || encodeWorkflowRunPathPayload(decoded) !== value) {
      context.addIssue({ code: "custom", message: "workflow run id must use canonical encoding" });
    }
  });

export const encodeWorkflowRunIdV1 = (value: z.infer<typeof WorkflowRunRefV1Schema>): string => {
  const run = WorkflowRunRefV1Schema.parse(value);
  return encodeWorkflowRunPathPayload(run.reference);
};

export const decodeWorkflowRunIdV1 = (value: unknown): z.infer<typeof WorkflowRunRefV1Schema> => {
  const encoded = EncodedWorkflowRunIdV1Schema.parse(value);
  return WorkflowRunRefV1Schema.parse({
    kind: "workflow-run",
    reference: decodeWorkflowRunPathPayload(encoded),
  });
};

export const SseDomainEventDataV1Schema = z.strictObject({
  schemaVersion: z.literal(HTTP_SCHEMA_VERSION_V1),
  workflowRunRef: z.strictObject({
    kind: z.literal("workflow-run"),
    reference: VersionReferenceSchema,
  }),
  domainEventRef: DomainEventRefV1Schema,
});
export type SseDomainEventDataV1 = z.infer<typeof SseDomainEventDataV1Schema>;

type ObjectSchemaWithPayload = {
  readonly shape: Readonly<Record<string, unknown>>;
};
type DiscriminatedUnionSchema = {
  readonly options?: readonly ObjectSchemaWithPayload[];
};

const payloadSchemaFor = (schema: ZodType, kind: string): ZodType => {
  const options = (schema as unknown as DiscriminatedUnionSchema).options ?? [];
  // 单 kind 查询契约（C32 只读面）：非判别联合，payload 字段直接挂在 strictObject 上。
  if (options.length === 0) {
    const direct = (schema as unknown as ObjectSchemaWithPayload).shape?.payload;
    if (direct !== undefined && typeof direct === "object" && direct !== null) {
      return direct as ZodType;
    }
  }
  const option = options.find((candidate) => {
    const discriminator = candidate.shape.kind as { readonly value?: unknown } | undefined;
    return discriminator?.value === kind;
  });
  const payload = option?.shape.payload;
  if (payload === undefined || typeof payload !== "object" || payload === null) {
    throw new Error(`missing C02 payload schema for ${kind}`);
  }
  return payload as ZodType;
};

const commandTransportSchemaFor = (schema: ZodType, kind: string): ZodType =>
  z.strictObject({
    ...httpEnvelopeBase,
    commandId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
    issuedAt: IsoDateTimeSchema,
    payload: payloadSchemaFor(schema, kind),
  });

const queryTransportSchemaFor = (schema: ZodType, kind: string): ZodType =>
  z.strictObject({
    ...httpEnvelopeBase,
    queryId: IdentifierSchema,
    requestedAt: IsoDateTimeSchema,
    payload: payloadSchemaFor(schema, kind),
  });

/** 多 kind 领域的查询信封：payload 就是该领域自己的联合，`kind` 由请求体携带。 */
const queryTransportSchemaForPayload = (schema: ZodType, payload: ZodType): ZodType =>
  z.strictObject({
    ...httpEnvelopeBase,
    queryId: IdentifierSchema,
    requestedAt: IsoDateTimeSchema,
    payload,
  });

/**
 * D-11 C36 两阶段窄端口（仅服务端可调用，不进入 HTTP 契约）：先按当前授权预选候选来源版本，
 * 再按请求内 grant 映射过滤摘要定位引用；grant 与来源版本的身份映射只存在于本次请求。
 */
export type QualityProjectionSourceVersionRefV1 = {
  readonly versionKey: string;
  readonly sourceVersionRef: SourceVersionRefV1;
};

export type QualityProjectionCandidateSelectionV1 =
  | Readonly<{
      kind: "candidates";
      readonly rowRefs: readonly {
        readonly reportArtifactId: string;
        readonly reportArtifactVersionId: string;
      }[];
      readonly summaryDigests: readonly string[];
      readonly versions: readonly QualityProjectionSourceVersionRefV1[];
    }>
  | Readonly<{ kind: "rejected"; result: ProjectionQueryResultV1 }>;

export interface ApiPortsV1 {
  readonly sourceOriginal?: SourceOriginalReadPortV1;
  readonly engineeringData?: EngineeringDataPortV1;
  readonly knowledgeModeling?: KnowledgeModelingPortV1;
  /** C19 组装窄端口：独立注入位，未注入时对应命令分支不激活。 */
  readonly applicableRuleSetAssembly?: ApplicableRuleSetAssemblyPortV1;
  readonly riskIdentification?: RiskIdentificationPortV1;
  readonly riskAssessment?: RiskAssessmentPortV1;
  readonly warningResponse?: WarningResponsePortV1;
  // C41 人工决定/执行/反馈三分支的独立注入位；未注入时这三个分支不可用（C41 接线 D1）。
  readonly humanDecisionFeedback?: HumanDecisionFeedbackPortV1;
  readonly reviewAudit?: ReviewAuditPortV1;
  readonly agentTask?: AgentTaskPortV1;
  readonly workflow?: WorkflowPortV1;
  readonly projection?: ProjectionPortV1;
  /** SSE 逐事件签发后复验；HTTP 负责当前会话，reader 负责精确运行与事件范围。 */
  readonly runEventSubscription?: {
    subscribeWithSourceAuthorization(
      request: RunSubscriptionRequestV1,
      authorizeEvent: (scope: {
        readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
        readonly sourceVersionRefs: readonly SourceVersionRefV1[];
      }) => Promise<{ readonly queryId: string; readonly authorization: AuthorizationContextV1 }>,
    ): Promise<ProjectionSubscriptionResultV1>;
  };
  // C32 只读面四条独立注入位；未注入时对应七条查询分支不激活（C32 接线 D 案）。
  readonly engineeringDataCatalog?: EngineeringDataCatalogPortV1;
  readonly knowledgeGovernanceRead?: KnowledgeGovernanceReadPortV1;
  readonly knowledgeRetrievalRead?: KnowledgeRetrievalReadPortV1;
  readonly projectionResultRead?: ProjectionResultReadPortV1;
  // C33 只读面两条独立注入位；未注入时对应五条查询分支不激活。
  readonly riskIdentificationRead?: RiskIdentificationReadPortV1;
  readonly reviewQueueRead?: ReviewQueueReadPortV1;
  // C34 只读面两条与校准治理一条独立注入位；未注入时对应四条分支不激活（design D-03、IP-08）。
  readonly riskAssessmentRead?: RiskAssessmentReadPortV1;
  readonly warningResponseRead?: WarningResponseReadPortV1;
  readonly calibrationGovernance?: CalibrationGovernancePortV1;
  // C35 三条业务窄读独立注入位；未注入时对应三条查询分支不激活（design D-12）。
  readonly agentTaskRead?: AgentTaskReadPortV1;
  readonly reviewAuditRead?: ReviewAuditReadPortV1;
  readonly projectionReportRead?: ProjectionReportReadPortV1;
  /**
   * CH-3 风险总览仪表盘读面：独立可选注入位，未注入时对应查询分支不激活。
   * 入口能力与六个来源的读权分别判定，组合层不因缺来源而伪造空结果。
   */
  readonly riskDashboardRead?: RiskDashboardReadPortV1;
  /**
   * C35 独立系统管理面注入位：HTTP 只从唯一 Cookie 取会话 token 并转交，
   * 不构造管理授权上下文，管理身份证明全部在所属适配器内完成（design D-10）。
   */
  readonly systemAdministration?: SystemAdministrationPortV1;
  /**
   * C35 应用输出接缝：健康与模型版本读取。整体未注入时 `/api/v1/operations/queries`
   * 不激活（design D-11），避免以内部探测冒充事实。
   */
  readonly systemOperationsRead?: SystemOperationsReadPortV1;
  /**
   * CH-2（design D-07）：当前工程入口能力呈现的独立可选注入位。
   * 未注入时 GET /api/v1/projects/:projectId/access 与其 OpenAPI 操作都不激活，
   * 客户端据此呈现接缝不可用，而不是把假空能力当成"当前没有入口权"。
   */
  readonly projectAccessPresentation?: ProjectAccessPresentationPortV1;
  /**
   * C36 窄投影 port：只在未提供完整 `projection` port 时把原 `projection.query` 路由绑定到它，
   * 只接受 `quality-evaluation` 查询类型；SSE 与导出仍只由完整 port 激活。
   */
  readonly qualityProjectionQuery?: Pick<ProjectionPortV1, "query"> &
    Partial<{
      candidateSourceVersionRefs(
        request: ProjectionQueryV1,
      ): Promise<QualityProjectionCandidateSelectionV1>;
      queryWithSourceGrants(
        request: ProjectionQueryV1,
        grantsBySourceVersion: ReadonlyMap<string, readonly SourceAccessGrantRefV1[]>,
        candidates: Extract<QualityProjectionCandidateSelectionV1, { kind: "candidates" }>,
      ): Promise<ProjectionQueryResultV1>;
    }>;
}

type ApiPortKeyV1 = keyof ApiPortsV1;
type HttpInvokerV1 = (ports: ApiPortsV1, request: unknown) => Promise<unknown>;

export type HttpRouteEntryV1 = Readonly<{
  method: "POST";
  path: string;
  mode: "command" | "query";
  branch: ModuleBranchV1;
  domainKind: string;
  requiredCapability: ModuleCapabilityV1;
  portKey: ApiPortKeyV1;
  /** 除 `portKey` 外仍可激活该路由的窄端口；不改变同路径只注册一条 entry 的约束。 */
  activationPortKeys: readonly ApiPortKeyV1[];
  requestSchema: ZodType;
  moduleRequestSchema: ZodType;
  resultSchema: ZodType;
  invoke: HttpInvokerV1;
}>;

type RouteDefinitionV1 = Readonly<{
  branch: ModuleBranchV1;
  domainKind: string;
  mode: "command" | "query";
  moduleRequestSchema: ZodType;
  /**
   * 传输层 payload 覆盖项：一个分支承载多个领域 kind 时（C35 的 Agent 任务读、
   * 统一复核/活动读与报告读），payload 就是该领域联合本身，`kind` 由请求体携带。
   * 不提供时按原规则从联合中取出单个 domainKind 的 payload。
   */
  transportPayloadSchema?: ZodType;
  resultSchema: ZodType;
  portKey: ApiPortKeyV1;
  activationPortKeys: readonly ApiPortKeyV1[];
  invoke: HttpInvokerV1;
}>;

const route = (definition: RouteDefinitionV1): HttpRouteEntryV1 =>
  Object.freeze({
    ...definition,
    method: "POST" as const,
    path: `/api/v1/projects/:projectId/${definition.mode === "command" ? "commands" : "queries"}/${definition.branch}`,
    requiredCapability: MODULE_BRANCH_CAPABILITY_V1[definition.branch],
    activationPortKeys: [definition.portKey, ...definition.activationPortKeys],
    requestSchema:
      definition.transportPayloadSchema === undefined
        ? definition.mode === "command"
          ? commandTransportSchemaFor(definition.moduleRequestSchema, definition.domainKind)
          : queryTransportSchemaFor(definition.moduleRequestSchema, definition.domainKind)
        : queryTransportSchemaForPayload(
            definition.moduleRequestSchema,
            definition.transportPayloadSchema,
          ),
  });

const commandRoutes = (
  moduleRequestSchema: ZodType,
  resultSchema: ZodType,
  portKey: ApiPortKeyV1,
  invoke: HttpInvokerV1,
  branches: readonly (readonly [ModuleBranchV1, string])[],
  activationPortKeys: readonly ApiPortKeyV1[] = [],
): readonly HttpRouteEntryV1[] =>
  branches.map(([branch, domainKind]) =>
    route({
      branch,
      domainKind,
      mode: "command",
      moduleRequestSchema,
      resultSchema,
      portKey,
      activationPortKeys,
      invoke,
    }),
  );

/**
 * 治理路由按分支各绑自己的结果 Schema（design D-08）：同一用例族的两个分支成功形状不同，
 * 共用联合 Schema 会让任一分支接受对方的成功结果。请求信封仍取自同一份公共契约，
 * kind 与分支不匹配时由签发能力在领域层失败闭合，不在这里复制 payload 定义。
 */
const commandRoutesByResult = (
  moduleRequestSchema: ZodType,
  portKey: ApiPortKeyV1,
  invoke: HttpInvokerV1,
  branches: readonly (readonly [ModuleBranchV1, string, ZodType])[],
  activationPortKeys: readonly ApiPortKeyV1[] = [],
): readonly HttpRouteEntryV1[] =>
  branches.map(([branch, domainKind, resultSchema]) =>
    route({
      branch,
      domainKind,
      mode: "command",
      moduleRequestSchema,
      resultSchema,
      portKey,
      activationPortKeys,
      invoke,
    }),
  );

const queryRoutes = (
  moduleRequestSchema: ZodType,
  resultSchema: ZodType,
  portKey: ApiPortKeyV1,
  invoke: HttpInvokerV1,
  branches: readonly (readonly [ModuleBranchV1, string])[],
  activationPortKeys: readonly ApiPortKeyV1[] = [],
): readonly HttpRouteEntryV1[] =>
  branches.map(([branch, domainKind]) =>
    route({
      branch,
      domainKind,
      mode: "query",
      moduleRequestSchema,
      resultSchema,
      portKey,
      activationPortKeys,
      invoke,
    }),
  );

/**
 * C35 领域查询路由：一个分支承载多个领域 kind，传输 payload 直接是该领域联合，
 * 由请求体的 `kind` 决定具体读取；路径与能力仍取自同一份路由目录（design D-12）。
 */
const domainQueryRoutes = (
  moduleRequestSchema: ZodType,
  payloadSchema: ZodType,
  resultSchema: ZodType,
  portKey: ApiPortKeyV1,
  invoke: HttpInvokerV1,
  branch: ModuleBranchV1,
): readonly HttpRouteEntryV1[] => [
  route({
    branch,
    domainKind: "domain-query",
    mode: "query",
    moduleRequestSchema,
    transportPayloadSchema: payloadSchema,
    resultSchema,
    portKey,
    activationPortKeys: [],
    invoke,
  }),
];

const missingPort = (name: string): never => {
  throw new Error(`HTTP route port is unavailable: ${name}`);
};

const invokeEngineeringApply: HttpInvokerV1 = (ports, request) =>
  ports.engineeringData?.apply(request as EngineeringDataCommandV1) ??
  missingPort("engineeringData");
const invokeEngineeringFreeze: HttpInvokerV1 = (ports, request) =>
  ports.engineeringData?.freeze(request as EngineeringFreezeCommandV1) ??
  missingPort("engineeringData");
const invokeEngineeringRead: HttpInvokerV1 = (ports, request) =>
  ports.engineeringData?.read(request as EngineeringDataQueryV1) ?? missingPort("engineeringData");
const invokeKnowledgeGovern: HttpInvokerV1 = (ports, request) =>
  ports.knowledgeModeling?.govern(request as KnowledgeGovernanceCommandV1) ??
  missingPort("knowledgeModeling");
const invokeKnowledgeResolve: HttpInvokerV1 = (ports, request) =>
  ports.knowledgeModeling?.resolve(request as KnowledgeResolutionCommandV1) ??
  missingPort("knowledgeModeling");
const invokeKnowledgeRetrieve: HttpInvokerV1 = (ports, request) =>
  ports.knowledgeModeling?.retrieve(request as KnowledgeRetrievalQueryV1) ??
  missingPort("knowledgeModeling");
const invokeApplicableRuleSetAssembly: HttpInvokerV1 = (ports, request) =>
  ports.applicableRuleSetAssembly?.assemble(request as ApplicableRuleSetAssemblyCommandV1) ??
  missingPort("applicableRuleSetAssembly");
const invokeIdentificationPlan: HttpInvokerV1 = (ports, request) =>
  ports.riskIdentification?.plan(request as IdentificationPlanCommandV1) ??
  missingPort("riskIdentification");
const invokeIdentificationAnalyze: HttpInvokerV1 = (ports, request) =>
  ports.riskIdentification?.analyze(request as IdentificationAnalysisCommandV1) ??
  missingPort("riskIdentification");
const invokeIdentificationFinalize: HttpInvokerV1 = (ports, request) =>
  ports.riskIdentification?.finalize(request as IdentificationFinalizationCommandV1) ??
  missingPort("riskIdentification");
const invokeAssessmentPrepare: HttpInvokerV1 = (ports, request) =>
  ports.riskAssessment?.prepare(request as AssessmentPreparationCommandV1) ??
  missingPort("riskAssessment");
const invokeAssessmentEvaluate: HttpInvokerV1 = (ports, request) =>
  ports.riskAssessment?.evaluate(request as AssessmentEvaluationCommandV1) ??
  missingPort("riskAssessment");
const invokeWarningOpen: HttpInvokerV1 = (ports, request) =>
  ports.warningResponse?.open(request as OpenWarningCommandV1) ?? missingPort("warningResponse");
const invokeWarningRecommend: HttpInvokerV1 = (ports, request) =>
  ports.warningResponse?.recommend(request as RecommendationCommandV1) ??
  missingPort("warningResponse");
const invokeWarningRecord: HttpInvokerV1 = (ports, request) =>
  ports.warningResponse?.record(request as WarningResponseRecordCommandV1) ??
  missingPort("warningResponse");
// 只转发 C41 三分支；类型收窄由路由表登记的分支保证（C41 接线 D1）。
const invokeHumanDecisionFeedback: HttpInvokerV1 = (ports, request) =>
  ports.humanDecisionFeedback?.record(request as HumanDecisionFeedbackCommandV1) ??
  missingPort("humanDecisionFeedback");
const invokeReviewRequest: HttpInvokerV1 = (ports, request) =>
  ports.reviewAudit?.requestReview(request as ReviewRequestV1) ?? missingPort("reviewAudit");
const invokeReviewDecision: HttpInvokerV1 = (ports, request) =>
  ports.reviewAudit?.decideReview(request as ReviewDecisionCommandV1) ?? missingPort("reviewAudit");
const invokeReviewTrace: HttpInvokerV1 = (ports, request) =>
  ports.reviewAudit?.trace(request as TraceQueryV1) ?? missingPort("reviewAudit");
const invokeAgentStart: HttpInvokerV1 = (ports, request) =>
  ports.agentTask?.startTask(request as StartAgentTaskCommandV1) ?? missingPort("agentTask");
const invokeAgentResume: HttpInvokerV1 = (ports, request) =>
  ports.agentTask?.resumeTask(request as ResumeAgentTaskCommandV1) ?? missingPort("agentTask");
const invokeAgentCancel: HttpInvokerV1 = (ports, request) =>
  ports.agentTask?.cancelTask(request as CancelAgentTaskCommandV1) ?? missingPort("agentTask");
const invokeAgentConfirm: HttpInvokerV1 = (ports, request) =>
  ports.agentTask?.confirmCommand(request as ConfirmAgentCommandV1) ?? missingPort("agentTask");
const invokeWorkflowStart: HttpInvokerV1 = (ports, request) =>
  ports.workflow?.startRun(request as StartWorkflowRunCommandV1) ?? missingPort("workflow");
const invokeWorkflowResume: HttpInvokerV1 = (ports, request) =>
  ports.workflow?.resumeRun(request as ResumeWorkflowRunCommandV1) ?? missingPort("workflow");
const invokeWorkflowCancel: HttpInvokerV1 = (ports, request) =>
  ports.workflow?.cancelRun(request as CancelWorkflowRunCommandV1) ?? missingPort("workflow");
const invokeProjectionQuery: HttpInvokerV1 = (ports, request) =>
  ports.projection?.query(request as ProjectionQueryV1) ??
  ports.qualityProjectionQuery?.query(request as ProjectionQueryV1) ??
  missingPort("projection");
const invokeProjectionSubscribe: HttpInvokerV1 = (ports, request) =>
  ports.projection?.subscribe(request as RunSubscriptionRequestV1) ?? missingPort("projection");
const invokeProjectionExport: HttpInvokerV1 = (ports, request) =>
  ports.projection?.export(request as ProjectionExportRequestV1) ?? missingPort("projection");
// C32 只读面：三条新端口直接转发 `read`；projection.result-read 把既有 readPage
// 判别结果包成传输信封的 moduleResult（succeeded/failed）。
const invokeEngineeringDataCatalog: HttpInvokerV1 = (ports, request) =>
  ports.engineeringDataCatalog?.read(request as EngineeringDataCatalogQueryV1) ??
  missingPort("engineeringDataCatalog");
const invokeKnowledgeGovernanceRead: HttpInvokerV1 = (ports, request) =>
  ports.knowledgeGovernanceRead?.read(request as KnowledgeGovernanceReadQueryV1) ??
  missingPort("knowledgeGovernanceRead");
const invokeKnowledgeRetrievalRead: HttpInvokerV1 = (ports, request) =>
  ports.knowledgeRetrievalRead?.read(request as KnowledgeRetrievalReadQueryV1) ??
  missingPort("knowledgeRetrievalRead");
const invokeProjectionResultRead: HttpInvokerV1 = async (ports, request) => {
  const port = ports.projectionResultRead ?? missingPort("projectionResultRead");
  const query = request as ProjectionResultReadQueryV1;
  const page = await port.readPage({
    projectId: query.projectId,
    queryResultRef: query.payload.queryResultRef,
    requestedAt: query.requestedAt,
    // C06 verify 把授权上下文与签发时的 invocationId 绑定：readPage 复验必须使用这次
    // 读取调用的领域 queryId，HTTP 签发即以此值为 invocationId（见 app.ts 注释）。
    queryId: query.queryId,
    ...(query.payload.cursor === undefined ? {} : { cursor: query.payload.cursor }),
    limit: query.payload.limit ?? 50,
    authorization: query.authorization,
  });
  return page.kind === "page"
    ? { kind: "succeeded", result: page }
    : { kind: "failed", error: page.error };
};
// C33 只读面：两条新端口直接转发 `read`，与 C32 只读面同形。
const invokeRiskIdentificationRead: HttpInvokerV1 = (ports, request) =>
  ports.riskIdentificationRead?.read(request as RiskIdentificationReadQueryV1) ??
  missingPort("riskIdentificationRead");
const invokeReviewQueueRead: HttpInvokerV1 = (ports, request) =>
  ports.reviewQueueRead?.read(request as ReviewQueueReadQueryV1) ?? missingPort("reviewQueueRead");
// C34 只读面：两条新只读端口直接转发 `read`；校准治理按本次命令的 kind 分派到对应用例。
const invokeRiskAssessmentRead: HttpInvokerV1 = (ports, request) =>
  ports.riskAssessmentRead?.read(request as RiskAssessmentReadQueryV1) ??
  missingPort("riskAssessmentRead");
const invokeWarningResponseRead: HttpInvokerV1 = (ports, request) =>
  ports.warningResponseRead?.read(request as WarningResponseReadQueryV1) ??
  missingPort("warningResponseRead");
// C35 业务窄读：三条端口直接转发 `read`，与 C32–C34 只读面同形。
const invokeAgentTaskRead: HttpInvokerV1 = (ports, request) =>
  ports.agentTaskRead?.read(request as AgentTaskReadQueryV1) ?? missingPort("agentTaskRead");
const invokeReviewAuditRead: HttpInvokerV1 = (ports, request) =>
  ports.reviewAuditRead?.read(request as ReviewAuditReadQueryV1) ?? missingPort("reviewAuditRead");
const invokeProjectionReportRead: HttpInvokerV1 = (ports, request) =>
  ports.projectionReportRead?.read(request as ProjectionReportReadQueryV1) ??
  missingPort("projectionReportRead");
// CH-3 仪表盘读面：直接转发 `read`；六个来源的读权由组合层按来源分支分别判定。
const invokeRiskDashboardRead: HttpInvokerV1 = (ports, request) =>
  ports.riskDashboardRead?.read(request as RiskDashboardReadQueryV1) ??
  missingPort("riskDashboardRead");
const invokeCalibrationGovernance: HttpInvokerV1 = (ports, request) => {
  const command = request as CalibrationGovernanceCommandV1;
  const governance = ports.calibrationGovernance;
  if (governance === undefined) return missingPort("calibrationGovernance");
  return command.kind === "create-calibration-governance-draft"
    ? governance.createGovernanceDraft(command)
    : governance.recordReviewOutcome(command);
};

export const HTTP_ROUTE_CATALOG_V1: readonly HttpRouteEntryV1[] = Object.freeze([
  route({
    branch: "engineering-data.source-original-read",
    domainKind: "source-original",
    mode: "query",
    moduleRequestSchema: SourceOriginalQueryV1Schema,
    resultSchema: SourceOriginalReadResultV1Schema,
    portKey: "sourceOriginal",
    activationPortKeys: [],
    invoke: (ports, request) =>
      ports.sourceOriginal?.read(request as SourceOriginalQueryV1) ?? missingPort("sourceOriginal"),
  }),
  ...commandRoutes(
    EngineeringDataCommandV1Schema,
    EngineeringDataApplyResultV1Schema,
    "engineeringData",
    invokeEngineeringApply,
    [
      ["engineering-data.register-source-delivery", "register-source-delivery"],
      ["engineering-data.register-monitoring-batch", "register-monitoring-batch"],
      ["engineering-data.register-external-risk-event", "register-external-risk-event"],
    ],
  ),
  ...commandRoutes(
    EngineeringFreezeCommandV1Schema,
    EngineeringFreezeResultV1Schema,
    "engineeringData",
    invokeEngineeringFreeze,
    [
      ["engineering-data.identification-preparation", "identification-preparation"],
      [
        "engineering-data.complete-identification-preparation",
        "complete-identification-preparation",
      ],
      ["engineering-data.assessment-preparation", "assessment-preparation"],
      ["engineering-data.monitoring-snapshot", "monitoring-snapshot"],
    ],
  ),
  ...queryRoutes(
    EngineeringDataQueryV1Schema,
    EngineeringDataReadResultV1Schema,
    "engineeringData",
    invokeEngineeringRead,
    [
      ["engineering-data.source-segments", "source-segments"],
      ["engineering-data.monitoring-snapshot-query", "monitoring-snapshot"],
      ["engineering-data.evidence-access", "evidence-access"],
    ],
  ),
  ...commandRoutes(
    KnowledgeGovernanceCommandV1Schema,
    KnowledgeGovernanceResultV1Schema,
    "knowledgeModeling",
    invokeKnowledgeGovern,
    [
      ["knowledge-modeling.submit-revision", "submit-revision"],
      ["knowledge-modeling.request-review", "request-review"],
      ["knowledge-modeling.publish-approved-release", "publish-approved-release"],
      ["knowledge-modeling.deactivate-release", "deactivate-release"],
      ["knowledge-modeling.rollback-by-new-release", "rollback-by-new-release"],
    ],
  ),
  ...commandRoutes(
    KnowledgeResolutionCommandV1Schema,
    KnowledgeResolutionResultV1Schema,
    "knowledgeModeling",
    invokeKnowledgeResolve,
    [
      ["knowledge-modeling.identification-basis", "identification-basis"],
      ["knowledge-modeling.assessment-basis", "assessment-basis"],
    ],
  ),
  // C19 正式组装入口：单分支窄命令与窄端口；未注入端口时不激活（design D-39）。
  ...commandRoutes(
    ApplicableRuleSetAssemblyCommandV1Schema,
    ApplicableRuleSetAssemblyResultV1Schema,
    "applicableRuleSetAssembly",
    invokeApplicableRuleSetAssembly,
    [["knowledge-modeling.assemble-applicable-rule-set", "assemble-applicable-rule-set"]],
  ),
  ...queryRoutes(
    KnowledgeRetrievalQueryV1Schema,
    KnowledgeRetrievalResultV1Schema,
    "knowledgeModeling",
    invokeKnowledgeRetrieve,
    [
      ["knowledge-modeling.hybrid-evidence", "hybrid-evidence"],
      ["knowledge-modeling.relationship-context", "relationship-context"],
      ["knowledge-modeling.measure-candidates", "measure-candidates"],
    ],
  ),
  ...commandRoutes(
    IdentificationPlanCommandV1Schema,
    IdentificationPlanResultV1Schema,
    "riskIdentification",
    invokeIdentificationPlan,
    [["risk-identification.plan", "plan"]],
  ),
  ...commandRoutes(
    IdentificationAnalysisCommandV1Schema,
    IdentificationAnalysisResultV1Schema,
    "riskIdentification",
    invokeIdentificationAnalyze,
    [
      ["risk-identification.assemble-and-infer", "assemble-and-infer"],
      ["risk-identification.repair-and-validate", "repair-and-validate"],
    ],
  ),
  ...commandRoutes(
    IdentificationFinalizationCommandV1Schema,
    IdentificationFinalizationResultV1Schema,
    "riskIdentification",
    invokeIdentificationFinalize,
    [
      ["risk-identification.merge-run-candidates", "merge-run-candidates"],
      ["risk-identification.route-acceptance", "route-acceptance"],
      ["risk-identification.accept-groups", "accept-groups"],
    ],
  ),
  ...commandRoutes(
    AssessmentPreparationCommandV1Schema,
    AssessmentPreparationResultV1Schema,
    "riskAssessment",
    invokeAssessmentPrepare,
    [
      ["risk-assessment.initial", "initial"],
      ["risk-assessment.reassessment", "reassessment"],
      ["risk-assessment.historical-backfill", "historical-backfill"],
    ],
  ),
  ...commandRoutes(
    AssessmentEvaluationCommandV1Schema,
    AssessmentEvaluationResultV1Schema,
    "riskAssessment",
    invokeAssessmentEvaluate,
    [["risk-assessment.evaluate", "evaluate"]],
  ),
  ...commandRoutes(
    OpenWarningCommandV1Schema,
    OpenWarningResultV1Schema,
    "warningResponse",
    invokeWarningOpen,
    [["warning-response.open", "open"]],
  ),
  ...commandRoutes(
    RecommendationCommandV1Schema,
    RecommendationResultV1Schema,
    "warningResponse",
    invokeWarningRecommend,
    [
      ["warning-response.create-candidate", "create-candidate"],
      ["warning-response.validate-and-record", "validate-and-record"],
    ],
  ),
  ...commandRoutes(
    WarningResponseRecordCommandV1Schema,
    WarningResponseRecordResultV1Schema,
    "warningResponse",
    invokeWarningRecord,
    [
      ["warning-response.acknowledge", "acknowledge"],
      ["warning-response.calculate-deviation", "calculate-deviation"],
      ["warning-response.create-calibration-suggestion", "create-calibration-suggestion"],
    ],
  ),
  // C41 的人工决定/执行/反馈分支转入独立注入位，路径、能力值与结果 Schema 不变。
  ...commandRoutes(
    WarningResponseRecordCommandV1Schema,
    WarningResponseRecordResultV1Schema,
    "humanDecisionFeedback",
    invokeHumanDecisionFeedback,
    [
      ["warning-response.adopt-recommendation", "adopt-recommendation"],
      ["warning-response.record-execution", "record-execution"],
      ["warning-response.record-feedback", "record-feedback"],
    ],
  ),
  ...commandRoutes(
    ReviewRequestV1Schema,
    ReviewRequestResultV1Schema,
    "reviewAudit",
    invokeReviewRequest,
    [["review-audit.request-review", "request-review"]],
  ),
  ...commandRoutes(
    ReviewDecisionCommandV1Schema,
    ReviewDecisionResultV1Schema,
    "reviewAudit",
    invokeReviewDecision,
    [["review-audit.decide-review", "decide-review"]],
  ),
  ...queryRoutes(TraceQueryV1Schema, TraceResultV1Schema, "reviewAudit", invokeReviewTrace, [
    ["review-audit.trace", "trace"],
  ]),
  ...commandRoutes(
    StartAgentTaskCommandV1Schema,
    StartAgentTaskResultV1Schema,
    "agentTask",
    invokeAgentStart,
    [["agent-task.start-task", "start-task"]],
  ),
  ...commandRoutes(
    ResumeAgentTaskCommandV1Schema,
    ResumeAgentTaskResultV1Schema,
    "agentTask",
    invokeAgentResume,
    [["agent-task.resume-task", "resume-task"]],
  ),
  ...commandRoutes(
    CancelAgentTaskCommandV1Schema,
    CancelAgentTaskResultV1Schema,
    "agentTask",
    invokeAgentCancel,
    [["agent-task.cancel-task", "cancel-task"]],
  ),
  ...commandRoutes(
    ConfirmAgentCommandV1Schema,
    ConfirmAgentCommandResultV1Schema,
    "agentTask",
    invokeAgentConfirm,
    [["agent-task.confirm-command", "confirm-command"]],
  ),
  ...commandRoutes(
    StartWorkflowRunCommandV1Schema,
    StartWorkflowRunResultV1Schema,
    "workflow",
    invokeWorkflowStart,
    [["workflow.start-run", "start-run"]],
  ),
  ...commandRoutes(
    ResumeWorkflowRunCommandV1Schema,
    ResumeWorkflowRunResultV1Schema,
    "workflow",
    invokeWorkflowResume,
    [["workflow.resume-run", "resume-run"]],
  ),
  ...commandRoutes(
    CancelWorkflowRunCommandV1Schema,
    CancelWorkflowRunResultV1Schema,
    "workflow",
    invokeWorkflowCancel,
    [["workflow.cancel-run", "cancel-run"]],
  ),
  ...queryRoutes(
    ProjectionQueryV1Schema,
    ProjectionQueryResultV1Schema,
    "projection",
    invokeProjectionQuery,
    [["projection.query", "query"]],
    ["qualityProjectionQuery"],
  ),
  ...queryRoutes(
    RunSubscriptionRequestV1Schema,
    ProjectionSubscriptionResultV1Schema,
    "projection",
    invokeProjectionSubscribe,
    [["projection.subscribe", "subscribe"]],
  ),
  ...queryRoutes(
    ProjectionExportRequestV1Schema,
    ProjectionExportResultV1Schema,
    "projection",
    invokeProjectionExport,
    [["projection.export", "export"]],
  ),
  // C32 只读面七条查询分支：目录、能力映射与 OpenAPI 由同一条目派生；未注入不激活。
  ...queryRoutes(
    EngineeringDataCatalogQueryV1Schema,
    EngineeringDataCatalogResultV1Schema,
    "engineeringDataCatalog",
    invokeEngineeringDataCatalog,
    [
      ["engineering-data.context-read", "context-read"],
      ["engineering-data.source-catalog", "source-catalog"],
      ["engineering-data.monitoring-catalog", "monitoring-catalog"],
      ["engineering-data.read-result", "read-result"],
    ],
  ),
  ...queryRoutes(
    KnowledgeGovernanceReadQueryV1Schema,
    KnowledgeGovernanceReadResultV1Schema,
    "knowledgeGovernanceRead",
    invokeKnowledgeGovernanceRead,
    [["knowledge-modeling.governance-read", "governance-read"]],
  ),
  ...queryRoutes(
    KnowledgeRetrievalReadQueryV1Schema,
    KnowledgeRetrievalReadResultV1Schema,
    "knowledgeRetrievalRead",
    invokeKnowledgeRetrievalRead,
    [["knowledge-modeling.retrieval-result", "retrieval-result"]],
  ),
  ...queryRoutes(
    ProjectionResultReadQueryV1Schema,
    ProjectionResultReadQueryResultV1Schema,
    "projectionResultRead",
    invokeProjectionResultRead,
    [["projection.result-read", "result-read"]],
  ),
  // C33 只读面五条查询分支：目录、能力映射与 OpenAPI 由同一条目派生；未注入不激活。
  ...queryRoutes(
    RiskIdentificationReadQueryV1Schema,
    RiskIdentificationReadResultV1Schema,
    "riskIdentificationRead",
    invokeRiskIdentificationRead,
    [
      ["risk-identification.run-list", "run-list"],
      ["risk-identification.run-read", "run-read"],
      ["risk-identification.record-catalog", "record-catalog"],
      ["risk-identification.record-read", "record-read"],
    ],
  ),
  ...queryRoutes(
    ReviewQueueReadQueryV1Schema,
    ReviewQueueReadResultV1Schema,
    "reviewQueueRead",
    invokeReviewQueueRead,
    [["review-audit.queue-read", "queue-read"]],
  ),
  // C34 只读面与校准治理四条分支：运行路由与 OpenAPI 从同一条目派生；未注入不激活。
  ...queryRoutes(
    RiskAssessmentReadQueryV1Schema,
    RiskAssessmentReadResultV1Schema,
    "riskAssessmentRead",
    invokeRiskAssessmentRead,
    [["risk-assessment.read", "read"]],
  ),
  ...queryRoutes(
    WarningResponseReadQueryV1Schema,
    WarningResponseReadResultV1Schema,
    "warningResponseRead",
    invokeWarningResponseRead,
    [["warning-response.read", "read"]],
  ),
  // C35 三条业务窄读：Agent 任务、统一复核/活动与报告读取；目录、能力映射与 OpenAPI
  // 全部由同一条目派生，未注入对应端口时不激活（design D-12）。
  ...domainQueryRoutes(
    AgentTaskReadQueryV1Schema,
    AgentTaskReadPayloadV1Schema,
    AgentTaskReadResultV1Schema,
    "agentTaskRead",
    invokeAgentTaskRead,
    "agent-task.read",
  ),
  ...domainQueryRoutes(
    ReviewAuditReadQueryV1Schema,
    ReviewAuditReadPayloadV1Schema,
    ReviewAuditReadResultV1Schema,
    "reviewAuditRead",
    invokeReviewAuditRead,
    "review-audit.read",
  ),
  ...domainQueryRoutes(
    ProjectionReportReadQueryV1Schema,
    ProjectionReportReadPayloadV1Schema,
    ProjectionReportReadResultV1Schema,
    "projectionReportRead",
    invokeProjectionReportRead,
    "projection.report-read",
  ),
  // CH-3 仪表盘读面：独立查询分支；未注入端口时不激活（design D-08）。
  ...queryRoutes(
    RiskDashboardReadQueryV1Schema,
    RiskDashboardReadResultV1Schema,
    "riskDashboardRead",
    invokeRiskDashboardRead,
    [["projection.dashboard-read", "read"]],
  ),
  ...commandRoutesByResult(
    CalibrationGovernanceCommandV1Schema,
    "calibrationGovernance",
    invokeCalibrationGovernance,
    [
      [
        "warning-response.calibration-review-outcome",
        "record-calibration-review-outcome",
        CalibrationReviewOutcomeResultV1Schema,
      ],
      [
        "warning-response.calibration-governance-draft",
        "create-calibration-governance-draft",
        CalibrationGovernanceDraftResultV1Schema,
      ],
    ],
  ),
]);

export const activeHttpRouteCatalog = (ports: ApiPortsV1): readonly HttpRouteEntryV1[] =>
  HTTP_ROUTE_CATALOG_V1.filter((entry) =>
    entry.activationPortKeys.some((portKey) => ports[portKey] !== undefined),
  );

export const HTTP_BRANCHES_V1 = Object.freeze(HTTP_ROUTE_CATALOG_V1.map((entry) => entry.branch));

export const buildAuthorizationRequest = (input: {
  readonly invocationId: string;
  readonly projectId: string;
  readonly branch: ModuleBranchV1;
  readonly sessionToken: string;
  readonly requestedSpatialScopeRefs: readonly SpatialScopeRefV1[];
  readonly requestedSourceVersionRefs: z.infer<typeof SourceVersionRefSetV1Schema>;
  readonly requestedAt: string;
}) =>
  AuthorizationRequestV1Schema.parse({
    invocationId: input.invocationId,
    projectId: input.projectId,
    branch: input.branch,
    requestedSpatialScopeRefs: input.requestedSpatialScopeRefs,
    requestedSourceVersionRefs: input.requestedSourceVersionRefs,
    requestedAt: input.requestedAt,
    invocation: { kind: "human-session", sessionToken: input.sessionToken },
  });

export const assembleCommandRequest = (
  entry: HttpRouteEntryV1,
  projectId: string,
  body: unknown,
  authorization: AuthorizationDecisionV1,
) => {
  const parsed = entry.requestSchema.parse(body) as HttpCommandRequestV1;
  return entry.moduleRequestSchema.parse({
    kind: entry.domainKind,
    commandId: parsed.commandId,
    idempotencyKey: parsed.idempotencyKey,
    projectId,
    actorId: authorization.context.actorId,
    issuedAt: parsed.issuedAt,
    authorization: authorization.context,
    payload: parsed.payload,
  });
};

export const assembleQueryRequest = (
  entry: HttpRouteEntryV1,
  projectId: string,
  body: unknown,
  authorization: AuthorizationDecisionV1,
) => {
  const parsed = entry.requestSchema.parse(body) as HttpQueryRequestV1;
  // 多 kind 领域（C35 三条窄读）的 kind 由请求体携带，进入信封；领域 payload 本身不含
  // `kind`，因此这里把载荷里的判别键提上来而不是原样透传。单 kind 分支仍取自路由条目。
  const carriesOwnKind =
    typeof parsed.payload === "object" &&
    parsed.payload !== null &&
    typeof (parsed.payload as { readonly kind?: unknown }).kind === "string";
  const payloadKind = carriesOwnKind
    ? (parsed.payload as { readonly kind: string }).kind
    : entry.domainKind;
  const payload = carriesOwnKind
    ? Object.fromEntries(
        Object.entries(parsed.payload as Record<string, unknown>).filter(
          ([field]) => field !== "kind",
        ),
      )
    : parsed.payload;
  return entry.moduleRequestSchema.parse({
    kind: payloadKind,
    queryId: parsed.queryId,
    projectId,
    actorId: authorization.context.actorId,
    requestedAt: parsed.requestedAt,
    authorization: authorization.context,
    payload,
  });
};

const safeReferences = (
  references: readonly unknown[],
): readonly z.infer<typeof ContractReferenceV1Schema>[] => {
  const result: z.infer<typeof ContractReferenceV1Schema>[] = [];
  for (const candidate of references) {
    const parsed = ContractReferenceV1Schema.safeParse(candidate);
    if (parsed.success && result.length < 16) result.push(parsed.data);
  }
  return result;
};

export const asIso = (date: Date): string => {
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? date.toISOString() : new Date(0).toISOString();
};

export type HttpFailureV1 = Readonly<{ status: number; error: HttpErrorV1 }>;

const failure = (input: {
  readonly status: number;
  readonly requestId: string;
  readonly code: HttpErrorCodeV1;
  readonly retryable: boolean;
  readonly occurredAt: string;
  readonly references?: readonly unknown[];
  readonly attempt?: number;
  readonly retryAt?: string;
}): HttpFailureV1 => ({
  status: input.status,
  error: HttpErrorV1Schema.parse({
    schemaVersion: HTTP_SCHEMA_VERSION_V1,
    requestId: input.requestId,
    code: input.code,
    retryable: input.retryable,
    occurredAt: input.occurredAt,
    references: safeReferences(input.references ?? []),
    ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
    ...(input.retryAt === undefined ? {} : { retryAt: input.retryAt }),
  }),
});

export class HttpTransportError extends Error {
  readonly failure: HttpFailureV1;

  constructor(value: HttpFailureV1) {
    super(value.error.code);
    this.name = "HttpTransportError";
    this.failure = value;
  }
}

const mapModuleError = (
  moduleError: z.infer<typeof ModuleErrorV1Schema>,
  requestId: string,
  now: Date,
): HttpFailureV1 => {
  switch (moduleError.code) {
    case "AUTHORIZATION_DENIED":
      return failure({
        status: 404,
        requestId,
        code: "NOT_FOUND",
        retryable: false,
        occurredAt: moduleError.occurredAt,
      });
    case "ENTITY_NOT_FOUND":
      return failure({
        status: 404,
        requestId,
        code: "NOT_FOUND",
        retryable: false,
        occurredAt: moduleError.occurredAt,
        references: [moduleError.targetRef],
      });
    case "STALE_VERSION":
      return failure({
        status: 409,
        requestId,
        code: "STALE_VERSION",
        retryable: false,
        occurredAt: moduleError.occurredAt,
        references: [
          moduleError.targetRef,
          ...(moduleError.currentRef === undefined ? [] : [moduleError.currentRef]),
        ],
      });
    case "IDEMPOTENCY_CONFLICT":
      return failure({
        status: 409,
        requestId,
        code: "IDEMPOTENCY_CONFLICT",
        retryable: false,
        occurredAt: moduleError.occurredAt,
      });
    case "BUSINESS_BLOCKED":
      return failure({
        status: 422,
        requestId,
        code: "BUSINESS_BLOCKED",
        retryable: false,
        occurredAt: moduleError.occurredAt,
        references: [moduleError.blockerRef],
      });
    case "TRANSIENT_FAILURE":
      return failure({
        status: 503,
        requestId,
        code: "TRANSIENT_FAILURE",
        retryable: true,
        occurredAt: moduleError.occurredAt,
        references: [moduleError.diagnosticRef],
        attempt: moduleError.attempt,
        ...(moduleError.retryAt === undefined ? {} : { retryAt: moduleError.retryAt }),
      });
    case "TERMINAL_FAILURE":
      return failure({
        status: 500,
        requestId,
        code: "TERMINAL_FAILURE",
        retryable: false,
        occurredAt: moduleError.occurredAt,
        references: [moduleError.diagnosticRef],
      });
    case "UNSUPPORTED_CONTRACT":
      return failure({
        status: 426,
        requestId,
        code: "UNSUPPORTED_CONTRACT",
        retryable: false,
        occurredAt: moduleError.occurredAt,
      });
    default:
      return failure({
        status: 500,
        requestId,
        code: "TERMINAL_FAILURE",
        retryable: false,
        occurredAt: asIso(now),
      });
  }
};

const mapAccessError = (
  accessError: AccessErrorV1,
  requestId: string,
  now: Date,
): HttpFailureV1 => {
  switch (accessError.code) {
    case "AUTHENTICATION_REJECTED":
    case "SESSION_EXPIRED":
    case "SESSION_REVOKED":
      return failure({
        status: 401,
        requestId,
        code: "AUTHENTICATION_REQUIRED",
        retryable: false,
        occurredAt: accessError.occurredAt,
      });
    case "PASSWORD_CHANGE_REQUIRED":
      return failure({
        status: 403,
        requestId,
        code: "PASSWORD_CHANGE_REQUIRED",
        retryable: false,
        occurredAt: accessError.occurredAt,
      });
    case "AUTHORIZATION_DENIED":
      return failure({
        status: 404,
        requestId,
        code: "NOT_FOUND",
        retryable: false,
        occurredAt: accessError.occurredAt,
      });
    case "STALE_ACCESS_VERSION":
      return failure({
        status: 409,
        requestId,
        code: "STALE_VERSION",
        retryable: false,
        occurredAt: accessError.occurredAt,
        references: [
          accessError.targetRef,
          ...(accessError.currentRef === undefined ? [] : [accessError.currentRef]),
        ],
      });
    case "IDEMPOTENCY_CONFLICT":
      return failure({
        status: 409,
        requestId,
        code: "IDEMPOTENCY_CONFLICT",
        retryable: false,
        occurredAt: accessError.occurredAt,
      });
    case "ACCESS_CONTRACT_INVALID":
      return failure({
        status: 400,
        requestId,
        code: "CONTRACT_INVALID",
        retryable: false,
        occurredAt: accessError.occurredAt,
      });
    case "ACCESS_TRANSIENT_FAILURE":
      return failure({
        status: 503,
        requestId,
        code: "TRANSIENT_FAILURE",
        retryable: true,
        occurredAt: accessError.occurredAt,
        references: [accessError.diagnosticRef],
        attempt: accessError.attempt,
        ...(accessError.retryAt === undefined ? {} : { retryAt: accessError.retryAt }),
      });
    case "ACCESS_TERMINAL_FAILURE":
      return failure({
        status: 500,
        requestId,
        code: "TERMINAL_FAILURE",
        retryable: false,
        occurredAt: accessError.occurredAt,
        references: [accessError.diagnosticRef],
      });
    default:
      return failure({
        status: 500,
        requestId,
        code: "TERMINAL_FAILURE",
        retryable: false,
        occurredAt: asIso(now),
      });
  }
};

export const invalidRequest = (requestId: string, now: Date): HttpFailureV1 =>
  failure({
    status: 400,
    requestId,
    code: "CONTRACT_INVALID",
    retryable: false,
    occurredAt: asIso(now),
  });
export const authenticationRequired = (requestId: string, now: Date): HttpFailureV1 =>
  failure({
    status: 401,
    requestId,
    code: "AUTHENTICATION_REQUIRED",
    retryable: false,
    occurredAt: asIso(now),
  });
export const unsupportedMediaType = (requestId: string, now: Date): HttpFailureV1 =>
  failure({
    status: 415,
    requestId,
    code: "UNSUPPORTED_MEDIA_TYPE",
    retryable: false,
    occurredAt: asIso(now),
  });
export const notFound = (requestId: string, now: Date): HttpFailureV1 =>
  failure({ status: 404, requestId, code: "NOT_FOUND", retryable: false, occurredAt: asIso(now) });
export const requestTooLarge = (requestId: string, now: Date): HttpFailureV1 =>
  failure({
    status: 413,
    requestId,
    code: "REQUEST_TOO_LARGE",
    retryable: false,
    occurredAt: asIso(now),
  });

export const mapHttpError = (input: {
  readonly error: unknown;
  readonly requestId: string;
  readonly now: Date;
}): HttpFailureV1 => {
  if (input.error instanceof HttpTransportError) return input.error.failure;
  if (input.error instanceof ArtifactStoreError) {
    if (
      [
        "ARTIFACT_ACCESS_DENIED",
        "ARTIFACT_REFERENCE_NOT_FOUND",
        "ARTIFACT_INHERITANCE_CONFLICT",
      ].includes(input.error.code)
    )
      return notFound(input.requestId, input.now);
    if (input.error.code === "ARTIFACT_TOO_LARGE")
      return requestTooLarge(input.requestId, input.now);
  }
  if (input.error instanceof AccessServiceError)
    return mapAccessError(input.error.details, input.requestId, input.now);
  const details =
    typeof input.error === "object" && input.error !== null && "details" in input.error
      ? (input.error as { readonly details?: unknown }).details
      : undefined;
  const access = AccessErrorV1Schema.safeParse(details ?? input.error);
  if (access.success) return mapAccessError(access.data, input.requestId, input.now);
  const module = ModuleErrorV1Schema.safeParse(details ?? input.error);
  if (module.success) return mapModuleError(module.data, input.requestId, input.now);
  if (input.error instanceof z.ZodError) return invalidRequest(input.requestId, input.now);
  return failure({
    status: 500,
    requestId: input.requestId,
    code: "TERMINAL_FAILURE",
    retryable: false,
    occurredAt: asIso(input.now),
  });
};

export const mapModuleResult = (input: {
  readonly result: unknown;
  readonly resultSchema: ZodType;
  readonly requestId: string;
  readonly now: Date;
}): { readonly kind: "succeeded" | "waiting"; readonly value: unknown } | HttpFailureV1 => {
  const parsed = input.resultSchema.safeParse(input.result);
  if (!parsed.success) {
    return failure({
      status: 500,
      requestId: input.requestId,
      code: "TERMINAL_FAILURE",
      retryable: false,
      occurredAt: asIso(input.now),
    });
  }
  const value = parsed.data as {
    readonly kind: "succeeded" | "waiting" | "failed";
    readonly error?: z.infer<typeof ModuleErrorV1Schema>;
  };
  if (value.kind === "failed" && value.error !== undefined)
    return mapModuleError(value.error, input.requestId, input.now);
  if (value.kind === "failed") return invalidRequest(input.requestId, input.now);
  return { kind: value.kind, value };
};

export const mapSessionResult = (result: unknown): SessionMetadataV1 => {
  const parsed = SessionResultV1Schema.parse(result);
  return SessionMetadataV1Schema.parse({
    schemaVersion: HTTP_SCHEMA_VERSION_V1,
    sessionRef: parsed.sessionRef,
    accountRef: parsed.accountRef,
    passwordChangeRequired: parsed.passwordChangeRequired,
    restricted: parsed.restricted,
    expiresAt: parsed.expiresAt,
    ...(parsed.systemAdministrationContextRef === undefined
      ? {}
      : { systemAdministrationContextRef: parsed.systemAdministrationContextRef }),
  });
};

export const buildLoginCommand = (body: unknown) => {
  const parsed = SessionLoginRequestV1Schema.parse(body);
  return LoginCommandV1Schema.parse({
    kind: "login",
    loginAttemptId: parsed.loginAttemptId,
    loginName: parsed.loginName,
    password: parsed.password,
  });
};
export const buildChangePasswordCommand = (body: unknown, sessionToken: string) => {
  const parsed = SessionChangePasswordRequestV1Schema.parse(body);
  return ChangePasswordCommandV1Schema.parse({
    kind: "change-password",
    sessionToken,
    newPassword: parsed.newPassword,
  });
};
export const buildLogoutCommand = (body: unknown, sessionToken: string) => {
  SessionLogoutRequestV1Schema.parse(body);
  return LogoutCommandV1Schema.parse({ kind: "logout", sessionToken });
};
/** 自省命令：只带 Cookie 里的会话 token，没有请求体、没有身份名称。 */
export const buildReadSessionCommand = (sessionToken: string) =>
  ReadSessionCommandV1Schema.parse({ kind: "introspect-session", sessionToken });
/**
 * 自省投影：把 C06 的会话元数据映射为 HTTP 会话 Schema。
 *
 * 字段与登录投影共用同一组取值；管理上下文不由会话读取派生，因此自省不会带出该字段。
 */
export const mapSessionMetadata = (result: unknown): SessionMetadataV1 => {
  const parsed = CoreSessionMetadataV1Schema.parse(result);
  return SessionMetadataV1Schema.parse({
    schemaVersion: HTTP_SCHEMA_VERSION_V1,
    sessionRef: parsed.sessionRef,
    accountRef: parsed.accountRef,
    passwordChangeRequired: parsed.passwordChangeRequired,
    restricted: parsed.restricted,
    expiresAt: parsed.expiresAt,
  });
};

export const buildAuthorizationDecision = (result: unknown): AuthorizationDecisionV1 =>
  AuthorizationDecisionV1Schema.parse(result);

export const isSafeHeaderValue = (value: string): boolean =>
  !value.includes("\r") && !value.includes("\n");
export const isSupportedJsonMediaType = (value: string | undefined): boolean => {
  if (value === undefined || value.includes(",")) return false;
  return value.split(";", 1)[0]?.trim().toLowerCase() === HTTP_JSON_MEDIA_TYPE_V1;
};

/**
 * C35 系统面传输信封（design D-12）：请求体只有 schemaVersion、调用标识与 strict payload；
 * 会话 token 由 HTTP 层从唯一 Cookie 取值后补齐，客户端既不提交也不得覆盖管理授权引用。
 * payload 直接由所属 core Schema 剥掉整个管理信封派生，不另抄一份字段定义。
 */
/**
 * 每个成员都是 strictObject，去掉 sessionToken 后仍是同一组按 `kind` 辨识的载荷。
 * 联合成员的 `omit` 泛型签名彼此独立，这里收敛成同一个调用形状再统一应用掩码。
 */
/** 传输层不接受的管理信封字段：版本、调用标识、签发时间与会话 token 全部由服务端补齐。 */
const withoutSystemEnvelope = (
  options: typeof SystemAdministrationReadQueryV1Schema.options,
): ZodType[] =>
  options.map((option) =>
    (
      option.omit as (mask: {
        schemaVersion: true;
        queryId: true;
        requestedAt: true;
        sessionToken: true;
      }) => ZodType
    )({
      schemaVersion: true,
      queryId: true,
      requestedAt: true,
      sessionToken: true,
    }),
  );

export const SystemAdministrationQueryRequestV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  queryId: IdentifierSchema,
  requestedAt: IsoDateTimeSchema,
  payload: z.union(withoutSystemEnvelope(SystemAdministrationReadQueryV1Schema.options)),
});
export type SystemAdministrationQueryRequestV1 = z.infer<
  typeof SystemAdministrationQueryRequestV1Schema
>;

export const SystemAdministrationCommandRequestV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  issuedAt: IsoDateTimeSchema,
  payload: SystemAdministrationCommandPayloadV1Schema,
});
export type SystemAdministrationCommandRequestV1 = z.infer<
  typeof SystemAdministrationCommandRequestV1Schema
>;

/** 把传输信封还原成所属 core 的管理请求：补上服务端取得的会话 token，不构造授权上下文。 */
export const toSystemAdministrationQuery = (
  body: SystemAdministrationQueryRequestV1,
  sessionToken: string,
): SystemAdministrationReadQueryV1 =>
  SystemAdministrationReadQueryV1Schema.parse({
    ...(body.payload as Record<string, unknown>),
    schemaVersion: body.schemaVersion,
    queryId: body.queryId,
    requestedAt: body.requestedAt,
    sessionToken,
  });

export const toSystemAdministrationCommand = (
  body: SystemAdministrationCommandRequestV1,
  sessionToken: string,
): SystemAdministrationCommandV1 =>
  SystemAdministrationCommandV1Schema.parse({
    schemaVersion: body.schemaVersion,
    commandId: body.commandId,
    idempotencyKey: body.idempotencyKey,
    issuedAt: body.issuedAt,
    sessionToken,
    payload: body.payload,
  });

export type HttpSessionRouteKindV1 =
  "login" | "change-password" | "logout" | "introspect" | "openapi";
/**
 * C35 系统面路由种类（design D-12）：四条固定路径，元数据仍由本目录派生 OpenAPI。
 * 激活条件都是"对应端口已注入"，没有隐式兜底。
 */
export type HttpSystemRouteKindV1 =
  | "administration-identity"
  | "administration-queries"
  | "administration-commands"
  | "operations-queries"
  | "project-access";
export type HttpSystemRouteEntryV1 = Readonly<{
  method: "POST" | "GET";
  path: string;
  kind: HttpSessionRouteKindV1 | HttpSystemRouteKindV1 | "sse" | "source-original";
  requestSchema?: ZodType;
  resultSchema?: ZodType;
  requiresSession: boolean;
  mediaType:
    typeof HTTP_JSON_MEDIA_TYPE_V1 | typeof HTTP_SSE_MEDIA_TYPE_V1 | "application/octet-stream";
  /** C35 系统面激活所需的注入位；缺任一项该路由不注册、也不出现在 OpenAPI。 */
  activationPortKeys?: readonly ApiPortKeyV1[];
}>;

export const HTTP_SYSTEM_ROUTE_CATALOG_V1: readonly HttpSystemRouteEntryV1[] = Object.freeze([
  Object.freeze({
    method: "GET" as const,
    path: "/api/v1/projects/:projectId/sources/:sourceId/versions/:versionId/original",
    kind: "source-original" as const,
    requiresSession: true,
    mediaType: "application/octet-stream" as const,
    activationPortKeys: ["sourceOriginal"] as const,
  }),
  Object.freeze({
    method: "POST" as const,
    path: "/api/v1/session/login",
    kind: "login" as const,
    requestSchema: SessionLoginRequestV1Schema,
    resultSchema: SessionMetadataV1Schema,
    requiresSession: false,
    mediaType: HTTP_JSON_MEDIA_TYPE_V1,
  }),
  Object.freeze({
    method: "POST" as const,
    path: "/api/v1/session/change-password",
    kind: "change-password" as const,
    requestSchema: SessionChangePasswordRequestV1Schema,
    resultSchema: SessionMetadataV1Schema,
    requiresSession: true,
    mediaType: HTTP_JSON_MEDIA_TYPE_V1,
  }),
  Object.freeze({
    method: "POST" as const,
    path: "/api/v1/session/logout",
    kind: "logout" as const,
    requestSchema: SessionLogoutRequestV1Schema,
    requiresSession: true,
    mediaType: HTTP_JSON_MEDIA_TYPE_V1,
  }),
  // 自省走安全 Cookie：没有请求体、不接受客户端会话身份，缺 Cookie 时按匿名结果处理。
  Object.freeze({
    method: "GET" as const,
    path: "/api/v1/session",
    kind: "introspect" as const,
    resultSchema: SessionMetadataV1Schema,
    requiresSession: false,
    mediaType: HTTP_JSON_MEDIA_TYPE_V1,
  }),
  Object.freeze({
    method: "GET" as const,
    path: "/api/v1/projects/:projectId/runs/:runId/events",
    kind: "sse" as const,
    requiresSession: true,
    mediaType: HTTP_SSE_MEDIA_TYPE_V1,
  }),
  // C35 独立系统面四条固定路径（design D-12）：请求体只有身份与调用标识，
  // 会话 token 一律从唯一 Cookie 取得，客户端不得提交授权引用或连接凭证。
  Object.freeze({
    method: "GET" as const,
    path: "/api/v1/administration",
    kind: "administration-identity" as const,
    resultSchema: SystemAdministrationReadResultV1Schema,
    requiresSession: true,
    mediaType: HTTP_JSON_MEDIA_TYPE_V1,
    activationPortKeys: ["systemAdministration"] as const,
  }),
  Object.freeze({
    method: "POST" as const,
    path: "/api/v1/administration/queries",
    kind: "administration-queries" as const,
    requestSchema: SystemAdministrationQueryRequestV1Schema,
    resultSchema: SystemAdministrationReadResultV1Schema,
    requiresSession: true,
    mediaType: HTTP_JSON_MEDIA_TYPE_V1,
    activationPortKeys: ["systemAdministration"] as const,
  }),
  Object.freeze({
    method: "POST" as const,
    path: "/api/v1/administration/commands",
    kind: "administration-commands" as const,
    requestSchema: SystemAdministrationCommandRequestV1Schema,
    resultSchema: SystemAdministrationExecuteResultV1Schema,
    requiresSession: true,
    mediaType: HTTP_JSON_MEDIA_TYPE_V1,
    activationPortKeys: ["systemAdministration"] as const,
  }),
  Object.freeze({
    method: "POST" as const,
    path: "/api/v1/operations/queries",
    kind: "operations-queries" as const,
    requestSchema: SystemOperationsQueryRequestV1Schema,
    resultSchema: SystemOperationsQueryResultEnvelopeV1Schema,
    requiresSession: true,
    mediaType: HTTP_JSON_MEDIA_TYPE_V1,
    activationPortKeys: ["systemAdministration", "systemOperationsRead"] as const,
  }),
  // CH-2 独立入口能力读面（design D-07）：只有路径上的工程，没有 body/query 参数；
  // 未注入真实 port 时该路由与对应 OpenAPI 操作都不注册。
  Object.freeze({
    method: "GET" as const,
    path: "/api/v1/projects/:projectId/access",
    kind: "project-access" as const,
    resultSchema: ProjectAccessPresentationV1Schema,
    requiresSession: true,
    mediaType: HTTP_JSON_MEDIA_TYPE_V1,
    activationPortKeys: ["projectAccessPresentation"] as const,
  }),
  Object.freeze({
    method: "GET" as const,
    path: "/api/v1/openapi.json",
    kind: "openapi" as const,
    requiresSession: false,
    mediaType: HTTP_JSON_MEDIA_TYPE_V1,
  }),
]);

/**
 * 系统路由的激活判定（design D-12）：SSE 需要完整 projection port；C35 四条系统面路由
 * 需要它们声明的注入位全部就位。未激活的路由既不注册也不出现在 OpenAPI——
 * OpenAPI 与实际可调用集合必须同源。
 */
export const isSystemRouteActive = (entry: HttpSystemRouteEntryV1, ports: ApiPortsV1): boolean => {
  if (entry.kind === "sse") return ports.projection !== undefined;
  if (entry.activationPortKeys === undefined) return true;
  return entry.activationPortKeys.every((portKey) => ports[portKey] !== undefined);
};

export const activeHttpSystemRouteCatalog = (
  ports: ApiPortsV1,
): readonly HttpSystemRouteEntryV1[] =>
  HTTP_SYSTEM_ROUTE_CATALOG_V1.filter((entry) => isSystemRouteActive(entry, ports));

export const httpCatalogForOpenApi = (
  ports: ApiPortsV1,
): readonly (HttpRouteEntryV1 | HttpSystemRouteEntryV1)[] => [
  ...activeHttpSystemRouteCatalog(ports),
  ...activeHttpRouteCatalog(ports),
];

type OpenApiSchema = Record<string, unknown>;
type OpenApiOperation = Record<string, unknown>;

const asJsonSchema = (schema: ZodType): OpenApiSchema => {
  const value = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    unrepresentable: "any",
  }) as OpenApiSchema;
  const withoutDialect = { ...value };
  delete withoutDialect.$schema;
  return withoutDialect;
};
const openApiPath = (path: string): string => path.replaceAll(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}");
const pathParameters = (path: string): OpenApiOperation[] =>
  Array.from(path.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g), ([, name]) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string", minLength: 1 },
  }));
const errorResponses = (): OpenApiOperation =>
  Object.fromEntries(
    [400, 401, 403, 404, 409, 413, 415, 422, 426, 500, 503].map((status) => [
      String(status),
      {
        description: "安全错误",
        content: {
          [HTTP_JSON_MEDIA_TYPE_V1]: { schema: { $ref: "#/components/schemas/HttpErrorV1" } },
        },
      },
    ]),
  );

const operationFor = (entry: HttpRouteEntryV1 | HttpSystemRouteEntryV1): OpenApiOperation => {
  const systemKind = "kind" in entry ? entry.kind : undefined;
  const isSse = systemKind === "sse";
  const parameters = pathParameters(entry.path);
  if (systemKind === "source-original")
    parameters.push({
      name: "disposition",
      in: "query",
      required: false,
      schema: { type: "string", enum: ["inline", "attachment"] },
    });
  if (isSse)
    parameters.push(
      {
        name: "Last-Event-ID",
        in: "header",
        required: false,
        schema: { type: "string", minLength: 1 },
      },
      {
        name: "afterEventId",
        in: "query",
        required: false,
        schema: { type: "string", minLength: 1 },
      },
    );
  const operation: OpenApiOperation = {
    operationId: isSse
      ? "riskflow_subscribe"
      : "mode" in entry
        ? `riskflow_${entry.mode}_${entry.branch.replaceAll(".", "_")}`
        : `riskflow_${entry.kind}`,
    parameters,
    responses: {
      ...(systemKind === "logout"
        ? { "204": { description: "已注销" } }
        : isSse
          ? {
              "200": {
                description: "事件引用流",
                content: {
                  [HTTP_SSE_MEDIA_TYPE_V1]: { schema: asJsonSchema(SseDomainEventDataV1Schema) },
                },
              },
            }
          : {
              "200": {
                description: "成功",
                ...(systemKind === "source-original"
                  ? {
                      content: {
                        "application/octet-stream": {
                          schema: { type: "string", format: "binary" },
                        },
                      },
                    }
                  : entry.resultSchema === undefined
                    ? {}
                    : {
                        content: {
                          [HTTP_JSON_MEDIA_TYPE_V1]: { schema: asJsonSchema(entry.resultSchema) },
                        },
                      }),
              },
            }),
      ...(systemKind !== "sse" && "mode" in entry && entry.mode === "command"
        ? {
            "202": {
              description: "等待中",
              content: {
                [HTTP_JSON_MEDIA_TYPE_V1]: {
                  schema: entry.resultSchema === undefined ? {} : asJsonSchema(entry.resultSchema),
                },
              },
            },
          }
        : {}),
      ...errorResponses(),
    },
    // 自省缺 Cookie 时按匿名结果返回而不是硬性拒绝，因此安全方案在这里显式声明，
    // 而不是靠 requiresSession 顺带带出。
    ...(systemKind !== "openapi" &&
    ("mode" in entry ||
      systemKind === "introspect" ||
      (systemKind !== undefined && "requiresSession" in entry && entry.requiresSession))
      ? { security: [{ sessionCookie: [] }] }
      : {}),
  };
  if (!isSse && entry.method === "POST" && entry.requestSchema !== undefined) {
    operation.requestBody = {
      required: true,
      content: { [HTTP_JSON_MEDIA_TYPE_V1]: { schema: asJsonSchema(entry.requestSchema) } },
    };
  }
  return operation;
};

export const buildOpenApiDocument = (
  entries: readonly (HttpRouteEntryV1 | HttpSystemRouteEntryV1)[] = [
    ...HTTP_SYSTEM_ROUTE_CATALOG_V1,
    ...HTTP_ROUTE_CATALOG_V1,
  ],
) => {
  const paths: Record<string, Record<string, OpenApiOperation>> = {};
  for (const entry of entries) {
    const path = openApiPath(entry.path);
    paths[path] ??= {};
    paths[path][entry.method.toLowerCase()] = operationFor(entry);
  }
  return {
    openapi: "3.1.0",
    info: { title: "RiskFlow API", version: HTTP_SCHEMA_VERSION_V1 },
    servers: [{ url: "/" }],
    paths,
    components: {
      securitySchemes: {
        sessionCookie: { type: "apiKey", in: "cookie", name: HTTP_COOKIE_NAME_V1 },
      },
      schemas: {
        HttpErrorV1: asJsonSchema(HttpErrorV1Schema),
        SseDomainEventDataV1: asJsonSchema(SseDomainEventDataV1Schema),
      },
    },
  } as const;
};

export type ApiIdentityAccessV1 = LocalIdentityAccessV1;
