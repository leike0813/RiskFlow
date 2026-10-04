import type {
  AccessCommandResultV1,
  AccessErrorV1,
  AuthorizationDecisionV1,
  AuthorizationRequestV1,
  AuthorizationVerificationRequestV1,
  ChangePasswordCommandV1,
  IdentityAdministrationCommandV1,
  LoginCommandV1,
  LogoutCommandV1,
  ProjectAccessCommandV1,
  ReadSessionCommandV1,
  SessionMetadataV1,
  SessionResultV1,
} from "./schema.js";

export type {
  AccessCommandResultV1,
  AccessErrorV1,
  AuthorizationDecisionV1,
  AuthorizationRequestV1,
  AuthorizationVerificationRequestV1,
  ChangePasswordCommandV1,
  IdentityAdministrationCommandV1,
  LoginCommandV1,
  LogoutCommandV1,
  ProjectAccessCommandV1,
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
