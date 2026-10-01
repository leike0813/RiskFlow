import { z } from "zod";

import {
  AgentTaskRefV1Schema,
  AuthorizationContextRefV1Schema,
  AuthorizationContextV1Schema,
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

/** C02 is the only source of module branch names. */
export { ModuleBranchV1Schema };

export const LocalAccountStatusV1Schema = z.enum(["active", "disabled"]);
export type LocalAccountStatusV1 = z.infer<typeof LocalAccountStatusV1Schema>;

export const PresetRoleV1Schema = z.enum([
  "system-administrator",
  "project-risk-manager",
  "reviewer",
  "field-responder",
  "business-viewer",
]);
export type PresetRoleV1 = z.infer<typeof PresetRoleV1Schema>;

export const ProjectAccessStatusV1Schema = z.enum(["active", "suspended"]);
export type ProjectAccessStatusV1 = z.infer<typeof ProjectAccessStatusV1Schema>;

export const SpatialAccessStatusV1Schema = z.enum(["active", "inactive"]);
export type SpatialAccessStatusV1 = z.infer<typeof SpatialAccessStatusV1Schema>;

export const SourceVisibilityV1Schema = z.enum(["project-shared", "restricted"]);
export type SourceVisibilityV1 = z.infer<typeof SourceVisibilityV1Schema>;

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

export const RoleSetV1Schema = uniqueArray(PresetRoleV1Schema, 4).min(1);
export const SpatialScopeRefSetV1Schema = uniqueArray(SpatialScopeRefV1Schema, 128).min(1);
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

const CreateAccountCommandV1Schema = z.strictObject({
  kind: z.literal("create-account"),
  ...commandIdentity,
  loginName: LoginNameInputV1Schema,
  displayName: DisplayNameV1Schema,
  password: PasswordV1Schema,
});
const DisableAccountCommandV1Schema = z.strictObject({
  kind: z.literal("disable-account"),
  ...commandIdentity,
  accountId: IdentifierSchema,
});
const ResetPasswordCommandV1Schema = z.strictObject({
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

const OpenProjectCommandV1Schema = z.strictObject({
  kind: z.literal("open-project"),
  ...projectCommandIdentity,
  initialRiskManagerAccountId: IdentifierSchema,
  includeAdministrator: z.boolean().optional(),
});
const SuspendProjectCommandV1Schema = z.strictObject({
  kind: z.literal("suspend-project"),
  ...projectCommandIdentity,
});
const ReviseMembershipCommandV1Schema = z.strictObject({
  kind: z.literal("revise-membership"),
  ...projectCommandIdentity,
  membershipId: IdentifierSchema,
  accountId: IdentifierSchema,
  roles: RoleSetV1Schema,
  spatialScopeRefs: SpatialScopeRefSetV1Schema,
  status: z.enum(["active", "removed"]),
});
const CreateSpatialScopeCommandV1Schema = z.strictObject({
  kind: z.literal("create-spatial-scope"),
  ...projectCommandIdentity,
  scopeId: IdentifierSchema,
  parentScopeRef: SpatialScopeRefV1Schema.optional(),
});
const ReviseSpatialScopeCommandV1Schema = z.strictObject({
  kind: z.literal("revise-spatial-scope"),
  ...projectCommandIdentity,
  scopeId: IdentifierSchema,
  status: SpatialAccessStatusV1Schema,
  parentScopeRef: SpatialScopeRefV1Schema.optional(),
});
const ReviseSourceAccessCommandV1Schema = z.strictObject({
  kind: z.literal("revise-source-access"),
  ...projectCommandIdentity,
  sourceVersionRef: SourceVersionRefV1Schema,
  visibility: SourceVisibilityV1Schema,
  allowedAccountIds: uniqueArray(IdentifierSchema, 512),
  spatialScopeRefs: uniqueArray(SpatialScopeRefV1Schema, 128),
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

export const SessionCommandV1Schema = z.discriminatedUnion("kind", [
  LoginCommandV1Schema,
  ChangePasswordCommandV1Schema,
  LogoutCommandV1Schema,
]);
export type SessionCommandV1 = z.infer<typeof SessionCommandV1Schema>;

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

export const AccessCommandResultKindV1Schema = z.enum([
  "account",
  "project",
  "membership",
  "spatial-scope",
  "source-access",
  "session",
]);

const AccessReferenceV1Schema = z.strictObject({
  entityId: IdentifierSchema,
  versionId: IdentifierSchema,
});
export const AccessCommandResultV1Schema = z.strictObject({
  kind: AccessCommandResultKindV1Schema,
  resultRef: AccessReferenceV1Schema,
  references: z.array(AccessReferenceV1Schema).max(16),
});
export type AccessCommandResultV1 = z.infer<typeof AccessCommandResultV1Schema>;

export const SessionResultV1Schema = z.strictObject({
  sessionRef: AccessReferenceV1Schema,
  accountRef: AccessReferenceV1Schema,
  sessionToken: z.string().min(1).max(512),
  passwordChangeRequired: z.boolean(),
  restricted: z.boolean(),
  expiresAt: IsoDateTimeSchema,
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
