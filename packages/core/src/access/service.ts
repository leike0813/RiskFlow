import {
  AccessErrorV1Schema,
  type AccessErrorV1,
  type AuthorizationDecisionV1,
  type AuthorizationRequestV1,
  type AuthorizationVerificationRequestV1,
  type ChangePasswordCommandV1,
  type IdentityAdministrationCommandV1,
  type LoginCommandV1,
  type LogoutCommandV1,
  type ProjectAccessCommandV1,
  type ProjectAccessPresentationRequestV1,
  type ReadSessionCommandV1,
  type SessionMetadataV1,
  type SessionResultV1,
} from "./schema.js";
import type {
  AuthorizationContextV1,
  ProjectAccessPresentationV1,
  SourceVersionRefV1,
} from "@riskflow/contracts/ports";
import {
  ProjectWorkspaceAccessCommandPayloadV1Schema,
  ProjectWorkspaceAccessReadPayloadV1Schema,
  ProjectWorkspaceAccessReadSuccessV1Schema,
  AccessCommandResultV1Schema,
  type AccessCommandResultV1,
} from "@riskflow/contracts/engineering-workspace";
import { IdentifierSchema, IsoDateTimeSchema } from "@riskflow/contracts/common";
import { z } from "zod";

export type {
  AccessErrorV1,
  AuthorizationDecisionV1,
  AuthorizationRequestV1,
  AuthorizationVerificationRequestV1,
  ChangePasswordCommandV1,
  IdentityAdministrationCommandV1,
  LoginCommandV1,
  LogoutCommandV1,
  ProjectAccessCommandV1,
  ProjectAccessPresentationRequestV1,
  ReadSessionCommandV1,
  SessionMetadataV1,
  SessionResultV1,
};

export class AccessServiceError extends Error {
  readonly details: AccessErrorV1;

  constructor(details: AccessErrorV1) {
    super(details.code);
    this.name = "AccessServiceError";
    this.details = details;
  }
}

export interface LocalIdentityAccessV1 {
  filterVisibleSources?(input: {
    readonly branch?: "knowledge-modeling.hybrid-evidence" | "risk-assessment.read";
    readonly authorization: AuthorizationContextV1;
    readonly sourceVersionRefs: readonly SourceVersionRefV1[];
  }): Promise<readonly SourceVersionRefV1[]>;
  administerIdentity(command: IdentityAdministrationCommandV1): Promise<AccessCommandResultV1>;
  administerProject(command: ProjectAccessCommandV1): Promise<AccessCommandResultV1>;
  login(command: LoginCommandV1): Promise<SessionResultV1>;
  changePassword(command: ChangePasswordCommandV1): Promise<SessionResultV1>;
  logout(command: LogoutCommandV1): Promise<AccessCommandResultV1>;
  /**
   * 当前会话元数据：验证既有会话后回报无 token 元数据。
   *
   * 只读且不签发任何授权上下文；会话失效、密码/密钥版本不符或期限到达时按会话失效类别
   * 失败，调用方据此区分「没有有效会话」与技术故障。
   */
  readSession(command: ReadSessionCommandV1): Promise<SessionMetadataV1>;
  authorize(request: AuthorizationRequestV1): Promise<AuthorizationDecisionV1>;
  verify(request: AuthorizationVerificationRequestV1): Promise<AuthorizationDecisionV1>;
}

/**
 * 当前工程入口能力呈现端口（CH-2 design D-07）。
 *
 * 与 LocalIdentityAccessV1 分离：既有实现与 mock 不必为入口读取补假方法，
 * 真实实现由 PostgresLocalIdentityAccess.projectAccessPresentation 单独返回。
 */
export interface ProjectAccessPresentationPortV1 {
  read(request: ProjectAccessPresentationRequestV1): Promise<ProjectAccessPresentationV1>;
}

/**
 * 工程工作区访问维护端口（design D-04）。
 *
 * 与系统管理端口并列但授权来源不同：这里只承认当前工程的工程风险管理员（或原系统管理员
 * 路径），不因开通工程取得业务读权，也不向普通成员开放全局账号目录。
 */
export const ProjectWorkspaceAccessReadRequestV1Schema = z.strictObject({
  sessionToken: z.string().min(1).max(512),
  payload: ProjectWorkspaceAccessReadPayloadV1Schema,
});
export type ProjectWorkspaceAccessReadRequestV1 = z.infer<
  typeof ProjectWorkspaceAccessReadRequestV1Schema
>;

export const ProjectWorkspaceAccessCommandRequestV1Schema = z.strictObject({
  sessionToken: z.string().min(1).max(512),
  projectId: IdentifierSchema,
  commandId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  issuedAt: IsoDateTimeSchema,
  payload: ProjectWorkspaceAccessCommandPayloadV1Schema,
});
export type ProjectWorkspaceAccessCommandRequestV1 = z.infer<
  typeof ProjectWorkspaceAccessCommandRequestV1Schema
>;

export const ProjectWorkspaceAccessReadResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("succeeded"),
    result: ProjectWorkspaceAccessReadSuccessV1Schema,
  }),
  z.strictObject({ kind: z.literal("failed"), error: AccessErrorV1Schema }),
]);
export type ProjectWorkspaceAccessReadResultV1 = z.infer<
  typeof ProjectWorkspaceAccessReadResultV1Schema
>;

export const ProjectWorkspaceAccessExecuteResultV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("succeeded"), result: AccessCommandResultV1Schema }),
  z.strictObject({ kind: z.literal("failed"), error: AccessErrorV1Schema }),
]);
export type ProjectWorkspaceAccessExecuteResultV1 = z.infer<
  typeof ProjectWorkspaceAccessExecuteResultV1Schema
>;

export interface ProjectWorkspaceAccessPortV1 {
  read(request: ProjectWorkspaceAccessReadRequestV1): Promise<ProjectWorkspaceAccessReadResultV1>;
  execute(
    command: ProjectWorkspaceAccessCommandRequestV1,
  ): Promise<ProjectWorkspaceAccessExecuteResultV1>;
}
