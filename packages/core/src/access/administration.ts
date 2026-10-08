/**
 * C35 系统管理独立面（design D-10）。
 *
 * 与既有 LocalIdentityAccessV1 并列的第二端口：管理授权引用只在服务端生成并注入，
 * 客户端不得提交、覆盖或复用登录时的旧引用。每次调用都携带服务端取得的 sessionToken，
 * 由所属实现重新验证当前会话、账号的管理员授予、首次改密限制与安全修订。
 *
 * 管理身份不从空业务能力集合推断，也不借用工程业务 branch：系统管理员仍不获得任何
 * 工程业务能力，管理命令仍沿原 C06 幂等收据、预期版本与原子安全审计事务。
 */
import { z } from "zod";

import { SpatialScopeRefV1Schema } from "@riskflow/contracts/ports";
import { IdentifierSchema, IsoDateTimeSchema } from "@riskflow/contracts/common";

import {
  CanonicalLoginNameV1Schema,
  CreateAccountCommandV1Schema,
  DisableAccountCommandV1Schema,
  DisplayNameV1Schema,
  LocalAccountStatusV1Schema,
  OpenProjectCommandV1Schema,
  PresetRoleV1Schema,
  ProjectAccessStatusV1Schema,
  ResetPasswordCommandV1Schema,
  ReviseMembershipCommandV1Schema,
  SpatialAccessStatusV1Schema,
  SuspendProjectCommandV1Schema,
  AccessCommandResultV1Schema,
  AccessErrorV1Schema,
  type AccessCommandResultV1,
  type AccessErrorV1,
} from "./schema.js";
import { SYSTEM_ACCESS_ACTIONS_V1 } from "./policy.js";

export const SYSTEM_ADMINISTRATION_PAGE_SIZE_MAX_V1 = 50;
export const SYSTEM_ADMINISTRATION_PAGE_SIZE_DEFAULT_V1 = 25;

const readPageSize = z
  .number()
  .int()
  .min(1)
  .max(SYSTEM_ADMINISTRATION_PAGE_SIZE_MAX_V1);
const readCursor = z.string().min(1).max(512);
const sessionToken = z.string().min(1).max(512);

const accessReference = z.strictObject({
  entityId: IdentifierSchema,
  versionId: IdentifierSchema,
});

/** 管理读请求信封：主体身份由服务端从 Cookie 会话取得，客户端只提供请求身份。 */
const systemReadEnvelope = {
  schemaVersion: z.literal("1"),
  queryId: IdentifierSchema,
  requestedAt: IsoDateTimeSchema,
  sessionToken,
};

export const SystemAdministrationReadQueryV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("identity"), ...systemReadEnvelope }),
  z.strictObject({
    kind: z.literal("accounts"),
    ...systemReadEnvelope,
    cursor: readCursor.optional(),
    pageSize: readPageSize.optional(),
  }),
  z.strictObject({
    kind: z.literal("projects"),
    ...systemReadEnvelope,
    cursor: readCursor.optional(),
    pageSize: readPageSize.optional(),
  }),
  z.strictObject({
    kind: z.literal("memberships"),
    ...systemReadEnvelope,
    projectId: IdentifierSchema,
    cursor: readCursor.optional(),
    pageSize: readPageSize.optional(),
  }),
  z.strictObject({
    kind: z.literal("spatial-scopes"),
    ...systemReadEnvelope,
    projectId: IdentifierSchema,
    cursor: readCursor.optional(),
    pageSize: readPageSize.optional(),
  }),
]);
export type SystemAdministrationReadQueryV1 = z.infer<typeof SystemAdministrationReadQueryV1Schema>;

/**
 * 目录条目：只披露显示身份、状态与当前版本引用。
 * 不返回密码派生值、秘密、会话 token 或授权表内部行。
 */
export const SystemAccountDirectoryItemV1Schema = z.strictObject({
  accountRef: accessReference,
  loginName: CanonicalLoginNameV1Schema,
  displayName: DisplayNameV1Schema,
  status: LocalAccountStatusV1Schema,
  passwordChangeRequired: z.boolean(),
});
export type SystemAccountDirectoryItemV1 = z.infer<typeof SystemAccountDirectoryItemV1Schema>;

export const SystemProjectDirectoryItemV1Schema = z.strictObject({
  projectId: IdentifierSchema,
  status: ProjectAccessStatusV1Schema,
  accessRevisionRef: accessReference,
  rootScopeRef: SpatialScopeRefV1Schema.optional(),
});
export type SystemProjectDirectoryItemV1 = z.infer<typeof SystemProjectDirectoryItemV1Schema>;

export const SystemMembershipDirectoryItemV1Schema = z.strictObject({
  membershipRef: accessReference,
  accountRef: accessReference,
  roles: z.array(PresetRoleV1Schema).min(1).max(4),
  spatialScopeRefs: z.array(SpatialScopeRefV1Schema).max(128),
  status: z.enum(["active", "removed"]),
});
export type SystemMembershipDirectoryItemV1 = z.infer<
  typeof SystemMembershipDirectoryItemV1Schema
>;

export const SystemSpatialScopeDirectoryItemV1Schema = z.strictObject({
  scopeId: IdentifierSchema,
  scopeRef: SpatialScopeRefV1Schema,
  parentScopeRef: SpatialScopeRefV1Schema.optional(),
  status: SpatialAccessStatusV1Schema,
});
export type SystemSpatialScopeDirectoryItemV1 = z.infer<
  typeof SystemSpatialScopeDirectoryItemV1Schema
>;

export const SystemAdministrationReadResultPayloadV1Schema = z.discriminatedUnion("kind", [
  /**
   * 当前身份：普通有效会话只能成功返回这里且 `isSystemAdministrator=false`；
   * 目录与写入在读取目标之前就拒绝，绝不据此推断管理员身份。
   */
  z.strictObject({
    kind: z.literal("identity"),
    isSystemAdministrator: z.boolean(),
    accountRef: accessReference.optional(),
    /** 六项原系统管理动作中当前获准的动作子集。 */
    allowedActions: z.array(z.enum(SYSTEM_ACCESS_ACTIONS_V1)).max(6),
  }),
  z.strictObject({
    kind: z.literal("accounts"),
    items: z.array(SystemAccountDirectoryItemV1Schema).max(SYSTEM_ADMINISTRATION_PAGE_SIZE_MAX_V1),
    nextCursor: readCursor.optional(),
  }),
  z.strictObject({
    kind: z.literal("projects"),
    items: z.array(SystemProjectDirectoryItemV1Schema).max(SYSTEM_ADMINISTRATION_PAGE_SIZE_MAX_V1),
    nextCursor: readCursor.optional(),
  }),
  z.strictObject({
    kind: z.literal("memberships"),
    projectId: IdentifierSchema,
    items: z
      .array(SystemMembershipDirectoryItemV1Schema)
      .max(SYSTEM_ADMINISTRATION_PAGE_SIZE_MAX_V1),
    nextCursor: readCursor.optional(),
  }),
  z.strictObject({
    kind: z.literal("spatial-scopes"),
    projectId: IdentifierSchema,
    items: z
      .array(SystemSpatialScopeDirectoryItemV1Schema)
      .max(SYSTEM_ADMINISTRATION_PAGE_SIZE_MAX_V1),
    nextCursor: readCursor.optional(),
  }),
]);
export type SystemAdministrationReadResultPayloadV1 = z.infer<
  typeof SystemAdministrationReadResultPayloadV1Schema
>;

export const SystemAdministrationReadResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("succeeded"), result: SystemAdministrationReadResultPayloadV1Schema }),
  z.strictObject({ kind: z.literal("failed"), error: AccessErrorV1Schema }),
]);
export type SystemAdministrationReadResultV1 = z.infer<typeof SystemAdministrationReadResultV1Schema>;

/**
 * 管理命令载荷：原 C06 六项管理命令剔除 commandId / idempotencyKey / authorizationContextRef
 * 之后的辨识联合，由原 Schema 派生而非另抄字段——预期版本、工程标识与密码边界全部沿用原定义。
 */
const commandEnvelopeFields = {
  commandId: true,
  idempotencyKey: true,
  authorizationContextRef: true,
} as const;

export const SystemAdministrationCommandPayloadV1Schema = z.discriminatedUnion("kind", [
  CreateAccountCommandV1Schema.omit(commandEnvelopeFields),
  DisableAccountCommandV1Schema.omit(commandEnvelopeFields),
  ResetPasswordCommandV1Schema.omit(commandEnvelopeFields),
  OpenProjectCommandV1Schema.omit(commandEnvelopeFields),
  SuspendProjectCommandV1Schema.omit(commandEnvelopeFields),
  ReviseMembershipCommandV1Schema.omit(commandEnvelopeFields),
]);
export type SystemAdministrationCommandPayloadV1 = z.infer<
  typeof SystemAdministrationCommandPayloadV1Schema
>;

/** 管理命令信封：幂等身份与签发时间在此提供，授权引用由服务端注入。 */
export const SystemAdministrationCommandV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  issuedAt: IsoDateTimeSchema,
  sessionToken,
  payload: SystemAdministrationCommandPayloadV1Schema,
});
export type SystemAdministrationCommandV1 = z.infer<typeof SystemAdministrationCommandV1Schema>;

export const SystemAdministrationExecuteResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("succeeded"), result: AccessCommandResultV1Schema }),
  z.strictObject({ kind: z.literal("failed"), error: AccessErrorV1Schema }),
]);
export type SystemAdministrationExecuteResultV1 = z.infer<
  typeof SystemAdministrationExecuteResultV1Schema
>;

/**
 * 独立系统管理端口：HTTP 层只从唯一 Cookie 取得 sessionToken 并转交本端口，
 * 不构造 AuthorizationContextV1 业务载荷，也不让管理面走工程授权分支。
 */
export interface SystemAdministrationPortV1 {
  read(request: SystemAdministrationReadQueryV1): Promise<SystemAdministrationReadResultV1>;
  execute(command: SystemAdministrationCommandV1): Promise<SystemAdministrationExecuteResultV1>;
}

export type { AccessCommandResultV1, AccessErrorV1 };