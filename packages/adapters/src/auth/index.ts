export {
  activePasswordDerivations,
  createSessionToken,
  decodeAndVerifySessionToken,
  derivePassword,
  encodeSessionToken,
  makeDummyCredential,
  PASSWORD_POLICY_V1,
  SESSION_TOKEN_POLICY_V1,
  sessionTokenSha256,
  validatePassword,
  verifyPassword,
} from "./crypto.js";
export type {
  PasswordCredentialV1,
  RandomBytes,
  SessionTokenKeyV1,
  SessionTokenPartsV1,
} from "./crypto.js";
export {
  bootstrapInitialSystemAdministrator,
  createPostgresLocalIdentityAccess,
} from "./postgres-local-identity-access.js";
export type {
  BootstrapInitialSystemAdministratorConfig,
  DeploymentAuthorizationSourceV1,
  LocalIdentityAccessConfig,
  PostgresLocalIdentityAccess,
  DeploymentProjectAccessCommandV1,
} from "./postgres-local-identity-access.js";
// 系统管理面挂在同一个 C06 适配器对象上，导出类型以便组合根按接口注入。
export type { SystemAdministrationPortV1 } from "@riskflow/core/access";
// C37 D-20：受控的跨能力因果授权适配（HTTP 受理签发 + 后台复验）。
export * from "./deployment-authorization.js";
