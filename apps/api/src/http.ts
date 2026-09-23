import { Buffer } from "node:buffer";

import { z, type ZodType } from "zod";

import {
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
  EngineeringDataCommandV1Schema,
  EngineeringDataQueryV1Schema,
  EngineeringDataReadResultV1Schema,
  EngineeringFreezeCommandV1Schema,
  EngineeringFreezeResultV1Schema,
  IdentificationAnalysisCommandV1Schema,
  IdentificationAnalysisResultV1Schema,
  IdentificationFinalizationCommandV1Schema,
  IdentificationFinalizationResultV1Schema,
  IdentificationPlanCommandV1Schema,
  IdentificationPlanResultV1Schema,
  KnowledgeGovernanceCommandV1Schema,
  KnowledgeGovernanceResultV1Schema,
  KnowledgeResolutionCommandV1Schema,
  KnowledgeResolutionResultV1Schema,
  KnowledgeRetrievalQueryV1Schema,
  KnowledgeRetrievalResultV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  OpenWarningCommandV1Schema,
  OpenWarningResultV1Schema,
  ProjectionExportRequestV1Schema,
  ProjectionExportResultV1Schema,
  ProjectionQueryResultV1Schema,
  ProjectionQueryV1Schema,
  ProjectionSubscriptionResultV1Schema,
  RecommendationCommandV1Schema,
  RecommendationResultV1Schema,
  ResumeAgentTaskCommandV1Schema,
  ResumeAgentTaskResultV1Schema,
  ResumeWorkflowRunCommandV1Schema,
  ResumeWorkflowRunResultV1Schema,
  ReviewDecisionCommandV1Schema,
  ReviewDecisionResultV1Schema,
  ReviewRequestResultV1Schema,
  ReviewRequestV1Schema,
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
  type AssessmentEvaluationCommandV1,
  type AssessmentPreparationCommandV1,
  type CancelAgentTaskCommandV1,
  type CancelWorkflowRunCommandV1,
  type ConfirmAgentCommandV1,
  type EngineeringDataCommandV1,
  type EngineeringDataPortV1,
  type EngineeringDataQueryV1,
  type EngineeringFreezeCommandV1,
  type IdentificationAnalysisCommandV1,
  type IdentificationFinalizationCommandV1,
  type IdentificationPlanCommandV1,
  type KnowledgeGovernanceCommandV1,
  type KnowledgeModelingPortV1,
  type KnowledgeResolutionCommandV1,
  type KnowledgeRetrievalQueryV1,
  type ModuleBranchV1,
  type ModuleCapabilityV1,
  type OpenWarningCommandV1,
  type ProjectionExportRequestV1,
  type ProjectionPortV1,
  type ProjectionQueryV1,
  type RecommendationCommandV1,
  type ResumeAgentTaskCommandV1,
  type ResumeWorkflowRunCommandV1,
  type ReviewAuditPortV1,
  type ReviewDecisionCommandV1,
  type ReviewRequestV1,
  type RiskAssessmentPortV1,
  type RiskIdentificationPortV1,
  type RunSubscriptionRequestV1,
  type SpatialScopeRefV1,
  type StartAgentTaskCommandV1,
  type StartWorkflowRunCommandV1,
  type TraceQueryV1,
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
  LogoutCommandV1Schema,
  PasswordV1Schema,
  SessionResultV1Schema,
  SourceVersionRefSetV1Schema,
  type AccessErrorV1,
  type AuthorizationDecisionV1,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
} from "@riskflow/contracts/common";

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

export const EncodedWorkflowRunIdV1Schema = z
  .string()
  .min(1)
  .max(2_048)
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

export interface ApiPortsV1 {
  readonly engineeringData?: EngineeringDataPortV1;
  readonly knowledgeModeling?: KnowledgeModelingPortV1;
  readonly riskIdentification?: RiskIdentificationPortV1;
  readonly riskAssessment?: RiskAssessmentPortV1;
  readonly warningResponse?: WarningResponsePortV1;
  readonly reviewAudit?: ReviewAuditPortV1;
  readonly agentTask?: AgentTaskPortV1;
  readonly workflow?: WorkflowPortV1;
  readonly projection?: ProjectionPortV1;
  /**
   * C36 窄投影 port：只在未提供完整 `projection` port 时把原 `projection.query` 路由绑定到它，
   * 只接受 `quality-evaluation` 查询类型；SSE 与导出仍只由完整 port 激活。
   */
  readonly qualityProjectionQuery?: Pick<ProjectionPortV1, "query">;
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
      definition.mode === "command"
        ? commandTransportSchemaFor(definition.moduleRequestSchema, definition.domainKind)
        : queryTransportSchemaFor(definition.moduleRequestSchema, definition.domainKind),
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

export const HTTP_ROUTE_CATALOG_V1: readonly HttpRouteEntryV1[] = Object.freeze([
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
      ["warning-response.adopt-recommendation", "adopt-recommendation"],
      ["warning-response.record-execution", "record-execution"],
      ["warning-response.record-feedback", "record-feedback"],
      ["warning-response.calculate-deviation", "calculate-deviation"],
      ["warning-response.create-calibration-suggestion", "create-calibration-suggestion"],
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
  return entry.moduleRequestSchema.parse({
    kind: entry.domainKind,
    queryId: parsed.queryId,
    projectId,
    actorId: authorization.context.actorId,
    requestedAt: parsed.requestedAt,
    authorization: authorization.context,
    payload: parsed.payload,
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
export const buildAuthorizationDecision = (result: unknown): AuthorizationDecisionV1 =>
  AuthorizationDecisionV1Schema.parse(result);

export const isSafeHeaderValue = (value: string): boolean =>
  !value.includes("\r") && !value.includes("\n");
export const isSupportedJsonMediaType = (value: string | undefined): boolean => {
  if (value === undefined || value.includes(",")) return false;
  return value.split(";", 1)[0]?.trim().toLowerCase() === HTTP_JSON_MEDIA_TYPE_V1;
};

export type HttpSessionRouteKindV1 = "login" | "change-password" | "logout" | "openapi";
export type HttpSystemRouteEntryV1 = Readonly<{
  method: "POST" | "GET";
  path: string;
  kind: HttpSessionRouteKindV1 | "sse";
  requestSchema?: ZodType;
  resultSchema?: ZodType;
  requiresSession: boolean;
  mediaType: typeof HTTP_JSON_MEDIA_TYPE_V1 | typeof HTTP_SSE_MEDIA_TYPE_V1;
}>;

export const HTTP_SYSTEM_ROUTE_CATALOG_V1: readonly HttpSystemRouteEntryV1[] = Object.freeze([
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
  Object.freeze({
    method: "GET" as const,
    path: "/api/v1/projects/:projectId/runs/:runId/events",
    kind: "sse" as const,
    requiresSession: true,
    mediaType: HTTP_SSE_MEDIA_TYPE_V1,
  }),
  Object.freeze({
    method: "GET" as const,
    path: "/api/v1/openapi.json",
    kind: "openapi" as const,
    requiresSession: false,
    mediaType: HTTP_JSON_MEDIA_TYPE_V1,
  }),
]);

export const httpCatalogForOpenApi = (
  ports: ApiPortsV1,
): readonly (HttpRouteEntryV1 | HttpSystemRouteEntryV1)[] => [
  ...HTTP_SYSTEM_ROUTE_CATALOG_V1.filter(
    (entry) => entry.kind !== "sse" || ports.projection !== undefined,
  ),
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
                ...(entry.resultSchema === undefined
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
    ...(systemKind !== "openapi" &&
    ("mode" in entry ||
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
