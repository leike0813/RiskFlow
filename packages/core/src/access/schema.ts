import { z } from "zod";

import {
  AgentTaskRefV1Schema,
  AuthorizationContextRefV1Schema,
  AuthorizationContextV1Schema,
  CommandCausalRefV1Schema,
  ContractReferenceV1Schema,
  ModuleBranchV1Schema,
  ModuleCapabilityV1Schema,
  SourceAccessGrantRefV1Schema,
  SourceVersionRefV1Schema,
  SpatialScopeRefV1Schema,
  type AuthorizationContextV1,
  type ModuleCapabilityV1,
} from "@riskflow/contracts/ports";
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  VersionReferenceSchema,
  type VersionReference,
} from "@riskflow/contracts/common";
import {
  AccessReferenceV1Schema,
  ProjectWorkspaceAccessCommandPayloadV1Schema,
} from "@riskflow/contracts/engineering-workspace";

/** C02 is the only source of module branch names. */
export { ModuleBranchV1Schema };

export const LoginNameInputV1Schema = z.string().min(1).max(96);
export const CanonicalLoginNameV1Schema = z.string().regex(/^[a-z][a-z0-9._-]{2,63}$/);
export const DisplayNameV1Schema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => Array.from(value).length <= 100);

export const PasswordV1Schema = z.string().superRefine((password, context) => {
  if (password.length > 512) {
    context.addIssue({
      code: "too_big",
      maximum: 512,
      inclusive: true,
      origin: "string",
      message: "password input exceeds the bounded validation size",
    });
    return;
  }
  const characterCount = Array.from(password).length;
  const byteCount = Buffer.byteLength(password, "utf8");
  if (characterCount < 15 || characterCount > 128) {
    context.addIssue({
      code: "too_small",
      minimum: 15,
      inclusive: true,
      origin: "string",
      message: "password length is outside the supported range",
    });
  }
  if (byteCount > 512) {
    context.addIssue({
      code: "too_big",
      maximum: 512,
      inclusive: true,
      origin: "string",
      message: "password UTF-8 length exceeds the supported limit",
    });
  }
});
export type PasswordV1 = z.infer<typeof PasswordV1Schema>;

const uniqueArray = <T extends z.ZodType>(schema: T, max: number) =>
  z
    .array(schema)
    .max(max)
    .refine(
      (values) => new Set(values.map((value) => JSON.stringify(value))).size === values.length,
    );

export const SourceVersionRefSetV1Schema = uniqueArray(SourceVersionRefV1Schema, 256);
export const SourceAccessGrantRefSetV1Schema = uniqueArray(SourceAccessGrantRefV1Schema, 256);

export const ExpectedVersionV1Schema = z.union([VersionReferenceSchema, z.literal("none")]);
export type ExpectedVersionV1 = z.infer<typeof ExpectedVersionV1Schema>;

const authorizationRef = AuthorizationContextRefV1Schema;
const commandIdentity = {
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  expectedVersion: ExpectedVersionV1Schema,
  authorizationContextRef: authorizationRef,
};

export const CreateAccountCommandV1Schema = z.strictObject({
  kind: z.literal("create-account"),
  ...commandIdentity,
  loginName: LoginNameInputV1Schema,
  displayName: DisplayNameV1Schema,
  password: PasswordV1Schema,
});
export const DisableAccountCommandV1Schema = z.strictObject({
  kind: z.literal("disable-account"),
  ...commandIdentity,
  accountId: IdentifierSchema,
});
export const ResetPasswordCommandV1Schema = z.strictObject({
  kind: z.literal("reset-password"),
  ...commandIdentity,
  accountId: IdentifierSchema,
  password: PasswordV1Schema,
});

export const IdentityAdministrationCommandV1Schema = z.discriminatedUnion("kind", [
  CreateAccountCommandV1Schema,
  DisableAccountCommandV1Schema,
  ResetPasswordCommandV1Schema,
]);
export type IdentityAdministrationCommandV1 = z.infer<typeof IdentityAdministrationCommandV1Schema>;

const projectCommandIdentity = {
  projectId: IdentifierSchema,
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  expectedVersion: ExpectedVersionV1Schema,
  authorizationContextRef: authorizationRef,
};

export const OpenProjectCommandV1Schema = z.strictObject({
  kind: z.literal("open-project"),
  ...projectCommandIdentity,
  initialRiskManagerAccountId: IdentifierSchema,
  includeAdministrator: z.boolean().optional(),
});
export const SuspendProjectCommandV1Schema = z.strictObject({
  kind: z.literal("suspend-project"),
  ...projectCommandIdentity,
});
/**
 * 四项工程访问维护命令：业务字段由公共工作区载荷唯一定义，此处只补授权信封
 * （工程标识、幂等身份与授权引用），不另抄一份字段约束。
 */
const workspaceCommandEnvelope = {
  projectId: IdentifierSchema,
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  authorizationContextRef: authorizationRef,
};
export const ReviseMembershipCommandV1Schema = z.strictObject({
  ...workspaceCommandEnvelope,
  ...ProjectWorkspaceAccessCommandPayloadV1Schema.options[0].shape,
});
const CreateSpatialScopeCommandV1Schema = z.strictObject({
  ...workspaceCommandEnvelope,
  ...ProjectWorkspaceAccessCommandPayloadV1Schema.options[1].shape,
});
const ReviseSpatialScopeCommandV1Schema = z.strictObject({
  ...workspaceCommandEnvelope,
  ...ProjectWorkspaceAccessCommandPayloadV1Schema.options[2].shape,
});
const ReviseSourceAccessCommandV1Schema = z.strictObject({
  ...workspaceCommandEnvelope,
  ...ProjectWorkspaceAccessCommandPayloadV1Schema.options[3].shape,
  registeredByAccountId: IdentifierSchema,
});

export const ProjectAccessCommandV1Schema = z.discriminatedUnion("kind", [
  OpenProjectCommandV1Schema,
  SuspendProjectCommandV1Schema,
  ReviseMembershipCommandV1Schema,
  CreateSpatialScopeCommandV1Schema,
  ReviseSpatialScopeCommandV1Schema,
  ReviseSourceAccessCommandV1Schema,
]);
export type ProjectAccessCommandV1 = z.infer<typeof ProjectAccessCommandV1Schema>;

export const LoginCommandV1Schema = z.strictObject({
  kind: z.literal("login"),
  loginAttemptId: IdentifierSchema,
  loginName: LoginNameInputV1Schema,
  password: z.string().max(512),
});
export type LoginCommandV1 = z.infer<typeof LoginCommandV1Schema>;

export const ChangePasswordCommandV1Schema = z.strictObject({
  kind: z.literal("change-password"),
  sessionToken: z.string().min(1).max(512),
  newPassword: PasswordV1Schema,
});
export type ChangePasswordCommandV1 = z.infer<typeof ChangePasswordCommandV1Schema>;

export const LogoutCommandV1Schema = z.strictObject({
  kind: z.literal("logout"),
  sessionToken: z.string().min(1).max(512),
});
export type LogoutCommandV1 = z.infer<typeof LogoutCommandV1Schema>;

/**
 * 会话自省：只验证既有服务端会话并回报无 token 元数据。
 *
 * 它不签发任何授权上下文，也不返回 token；管理上下文不入 local_sessions，因此不在此投影。
 * 字段与普通命令完全分离，使 HTTP 层可以直接 GET 且不会不小心泄露凭证。
 */
export const ReadSessionCommandV1Schema = z.strictObject({
  kind: z.literal("introspect-session"),
  sessionToken: z.string().min(1).max(512),
});
export type ReadSessionCommandV1 = z.infer<typeof ReadSessionCommandV1Schema>;

export const SessionCommandV1Schema = z.discriminatedUnion("kind", [
  LoginCommandV1Schema,
  ChangePasswordCommandV1Schema,
  LogoutCommandV1Schema,
  ReadSessionCommandV1Schema,
]);
export type SessionCommandV1 = z.infer<typeof SessionCommandV1Schema>;

/**
 * 当前工程入口能力呈现的内部请求（CH-2 design D-07）。
 *
 * sessionToken 只由 HTTP 从安全 Cookie 注入；请求不接受 actor、角色、能力或来源集合。
 * 与会话自省分离：它不改变 SessionMetadataV1 形状，也不签发任何授权上下文。
 */
export const ProjectAccessPresentationRequestV1Schema = z.strictObject({
  requestId: IdentifierSchema,
  requestedAt: IsoDateTimeSchema,
  sessionToken: z.string().min(1).max(512),
  projectId: IdentifierSchema,
});
export type ProjectAccessPresentationRequestV1 = z.infer<
  typeof ProjectAccessPresentationRequestV1Schema
>;

const authorizationRequestBase = {
  invocationId: IdentifierSchema,
  projectId: IdentifierSchema,
  branch: ModuleBranchV1Schema,
  requestedSpatialScopeRefs: uniqueArray(SpatialScopeRefV1Schema, 128),
  requestedSourceVersionRefs: SourceVersionRefSetV1Schema,
  requestedAt: IsoDateTimeSchema.optional(),
};

const HumanAuthorizationRequestV1Schema = z.strictObject({
  ...authorizationRequestBase,
  invocation: z.strictObject({
    kind: z.literal("human-session"),
    sessionToken: z.string().min(1).max(512),
  }),
});
const SystemAuthorizationRequestV1Schema = z.strictObject({
  ...authorizationRequestBase,
  invocation: z.strictObject({
    kind: z.literal("system"),
    systemActorId: IdentifierSchema,
    reasonCode: IdentifierSchema,
  }),
  parentContext: AuthorizationContextV1Schema,
  causalRunRef: z.strictObject({
    kind: z.literal("workflow-run"),
    reference: VersionReferenceSchema,
  }),
});
const AgentAuthorizationRequestV1Schema = z.strictObject({
  ...authorizationRequestBase,
  invocation: z.strictObject({
    kind: z.literal("agent-task"),
    agentTaskRef: AgentTaskRefV1Schema,
  }),
  parentContext: AuthorizationContextV1Schema,
  causalRunRef: z.strictObject({
    kind: z.literal("workflow-run"),
    reference: VersionReferenceSchema,
  }),
});

export const AuthorizationInvocationRequestV1Schema = z.union([
  HumanAuthorizationRequestV1Schema,
  SystemAuthorizationRequestV1Schema,
  SystemAuthorizationRequestV1Schema.omit({ causalRunRef: true }).extend({
    causalRunRef: z.never().optional(),
    causalCommandRef: CommandCausalRefV1Schema,
  }),
  AgentAuthorizationRequestV1Schema,
]);
export const AuthorizationRequestV1Schema = AuthorizationInvocationRequestV1Schema;
export type AuthorizationRequestV1 = z.infer<typeof AuthorizationRequestV1Schema>;
export type AuthorizationInvocationRequestV1 = z.infer<
  typeof AuthorizationInvocationRequestV1Schema
>;

export const AuthorizationVerificationRequestV1Schema = z.strictObject({
  authorizationContextRef: authorizationRef,
  invocationId: IdentifierSchema,
  projectId: IdentifierSchema,
  branch: ModuleBranchV1Schema,
  requestedSpatialScopeRefs: uniqueArray(SpatialScopeRefV1Schema, 128),
  requestedSourceVersionRefs: SourceVersionRefSetV1Schema,
  requestedAt: IsoDateTimeSchema.optional(),
});
export type AuthorizationVerificationRequestV1 = z.infer<
  typeof AuthorizationVerificationRequestV1Schema
>;

/**
 * 会话元数据：会话与账号引用、到期时间、首次改密限制与受限标志。
 *
 * 这是自省的唯一返回形状，不含 token；`SessionResultV1` 在其上扩展 token 与管理上下文，
 * 因此登录返回的元数据与自省回报的元数据不会出现两套字段定义。
 */
export const SessionMetadataV1Schema = z.strictObject({
  sessionRef: AccessReferenceV1Schema,
  accountRef: AccessReferenceV1Schema,
  passwordChangeRequired: z.boolean(),
  restricted: z.boolean(),
  expiresAt: IsoDateTimeSchema,
});
export type SessionMetadataV1 = z.infer<typeof SessionMetadataV1Schema>;

export const SessionResultV1Schema = SessionMetadataV1Schema.extend({
  sessionToken: z.string().min(1).max(512),
  systemAdministrationContextRef: AuthorizationContextRefV1Schema.optional(),
});
export type SessionResultV1 = z.infer<typeof SessionResultV1Schema>;

export const AuthorizationDecisionV1Schema = z.strictObject({
  context: AuthorizationContextV1Schema,
  contextRef: AuthorizationContextRefV1Schema,
  redacted: z.boolean(),
});
export type AuthorizationDecisionV1 = z.infer<typeof AuthorizationDecisionV1Schema>;

export const AccessErrorCodeV1Schema = z.enum([
  "AUTHENTICATION_REJECTED",
  "PASSWORD_CHANGE_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_REVOKED",
  "AUTHORIZATION_DENIED",
  "STALE_ACCESS_VERSION",
  "IDEMPOTENCY_CONFLICT",
  "ACCESS_CONTRACT_INVALID",
  "ACCESS_TRANSIENT_FAILURE",
  "ACCESS_TERMINAL_FAILURE",
]);
export type AccessErrorCodeV1 = z.infer<typeof AccessErrorCodeV1Schema>;

const accessErrorBase = {
  stage: IdentifierSchema,
  occurredAt: IsoDateTimeSchema,
  diagnosticRef: ContractReferenceV1Schema,
  contextRefs: z.array(ContractReferenceV1Schema).max(16),
};

const errorVariant = <const T extends AccessErrorCodeV1, const R extends boolean>(
  code: T,
  retryable: R,
) => z.strictObject({ ...accessErrorBase, code: z.literal(code), retryable: z.literal(retryable) });

export const AccessErrorV1Schema = z.discriminatedUnion("code", [
  errorVariant("AUTHENTICATION_REJECTED", false),
  errorVariant("PASSWORD_CHANGE_REQUIRED", false),
  errorVariant("SESSION_EXPIRED", false),
  errorVariant("SESSION_REVOKED", false),
  z.strictObject({
    ...accessErrorBase,
    code: z.literal("AUTHORIZATION_DENIED"),
    retryable: z.literal(false),
    requiredCapability: ModuleCapabilityV1Schema,
    authorizationPolicyRef: VersionReferenceSchema,
  }),
  z.strictObject({
    ...accessErrorBase,
    code: z.literal("STALE_ACCESS_VERSION"),
    retryable: z.literal(false),
    targetRef: ContractReferenceV1Schema,
    currentRef: ContractReferenceV1Schema.optional(),
  }),
  z.strictObject({
    ...accessErrorBase,
    code: z.literal("IDEMPOTENCY_CONFLICT"),
    retryable: z.literal(false),
    idempotencyKey: IdentifierSchema,
    priorCommandId: IdentifierSchema,
  }),
  errorVariant("ACCESS_CONTRACT_INVALID", false),
  z.strictObject({
    ...accessErrorBase,
    code: z.literal("ACCESS_TRANSIENT_FAILURE"),
    retryable: z.literal(true),
    attempt: z.number().int().positive(),
    retryAt: IsoDateTimeSchema.optional(),
  }),
  errorVariant("ACCESS_TERMINAL_FAILURE", false),
]);
export type AccessErrorV1 = z.infer<typeof AccessErrorV1Schema>;

export type AccessVersionRefV1 = VersionReference;
export type AccessCapabilityV1 = ModuleCapabilityV1;
export type AccessAuthorizationContextV1 = AuthorizationContextV1;
