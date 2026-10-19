import {
  AuthorizationContextRefV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ProjectAccessPresentationV1Schema,
} from "@riskflow/contracts/ports";
import { IsoDateTimeSchema, VersionReferenceSchema } from "@riskflow/contracts/common";
import type {
  AuthorizationContextRefV1,
  ModuleBranchV1,
  ModuleCapabilityV1,
  SourceVersionRefV1,
  SpatialScopeRefV1,
} from "@riskflow/contracts/ports";

import { createSseClient } from "./sse.js";
import {
  decodeSafeHttpError,
  isDateString,
  isNonEmptyString,
  isRecord,
  makeSafeHttpError,
  requestIdFallback,
  safeErrorCode,
} from "./errors.js";
import type { HttpErrorCodeV1, SafeHttpErrorV1 } from "./errors.js";
import { deriveOpenApiAvailability, type OpenApiAvailabilityV1 } from "./openapi.js";
import {
  HTTP_JSON_MEDIA_TYPE_V1,
  HTTP_SCHEMA_VERSION_V1,
  HTTP_SSE_MEDIA_TYPE_V1,
} from "./constants.js";
import type {
  C09RunSubscriptionHandleV1,
  C09RunSubscriptionInputV1,
  C09SseClientV1,
} from "./sse.js";

export {
  HTTP_COOKIE_NAME_V1,
  HTTP_JSON_MEDIA_TYPE_V1,
  HTTP_SCHEMA_VERSION_V1,
  HTTP_SSE_MEDIA_TYPE_V1,
} from "./constants.js";
export { decodeSafeHttpError, makeSafeHttpError } from "./errors.js";
export type { HttpErrorCodeV1, SafeHttpErrorV1 } from "./errors.js";

export type SessionReferenceV1 = Readonly<{
  entityId: string;
  versionId: string;
}>;

/**
 * 当前工程入口能力呈现视图（CH-2 design D-07）。
 *
 * 只承载界面入口资格：既不是授权上下文，也不能证明任何对象或来源可读。
 * 能力集合来自服务端当前成员事实，客户端不构造角色镜像。
 */
export type ProjectAccessPresentationViewV1 = Readonly<{
  projectId: string;
  capabilities: readonly ModuleCapabilityV1[];
}>;

const decodeProjectAccessPresentation = (value: unknown): ProjectAccessPresentationViewV1 => {
  const parsed = ProjectAccessPresentationV1Schema.safeParse(value);
  if (!parsed.success) throw new Error("invalid project access presentation");
  return Object.freeze({
    projectId: parsed.data.projectId,
    capabilities: Object.freeze([...parsed.data.capabilities]),
  });
};

export type SessionMetadataViewV1 = Readonly<{
  schemaVersion: typeof HTTP_SCHEMA_VERSION_V1;
  sessionRef: SessionReferenceV1;
  accountRef: SessionReferenceV1;
  passwordChangeRequired: boolean;
  restricted: boolean;
  expiresAt: string;
  systemAdministrationContextRef?: AuthorizationContextRefV1;
}>;

export type SessionLoginInputV1 = Readonly<{
  loginAttemptId: string;
  loginName: string;
  password: string;
}>;

export type SessionChangePasswordInputV1 = Readonly<{ newPassword: string }>;

export type C09ProjectRequestBaseV1 = Readonly<{
  projectId: string;
  requestedSpatialScopeRefs: readonly SpatialScopeRefV1[];
  requestedSourceVersionRefs: readonly SourceVersionRefV1[];
}>;

export type C09CommandRequestV1<TPayload> = Readonly<
  C09ProjectRequestBaseV1 & {
    commandId: string;
    idempotencyKey: string;
    issuedAt: string;
    payload: TPayload;
  }
>;

export type C09QueryRequestV1<TPayload> = Readonly<
  C09ProjectRequestBaseV1 & {
    queryId: string;
    requestedAt: string;
    payload: TPayload;
  }
>;

export type C09ResultV1<TResult> = Readonly<{
  kind: "succeeded" | "waiting";
  value: TResult;
}>;

export type C09PathTemplateV1 = Readonly<string>;
export type C09OperationIdV1 = string;
export type C09OperationModeV1 = "session" | "command" | "query";

export type C09OperationV1<TRequest, TResult> = Readonly<{
  operationId: C09OperationIdV1;
  mode: C09OperationModeV1;
  method: "POST" | "GET";
  path: C09PathTemplateV1;
  branch: ModuleBranchV1 | null;
  requiredCapability: ModuleCapabilityV1 | null;
  encode: (request: TRequest) => unknown;
  decode: (response: unknown) => TResult;
}>;

export type RegisteredC09OperationV1<TRequest, TResult> = C09OperationV1<TRequest, TResult>;
type AnyC09OperationV1 = C09OperationV1<never, unknown>;

export type C09SystemRouteKindV1 =
  "login" | "change-password" | "logout" | "introspect" | "project-access" | "openapi" | "sse";
export type C09SystemRouteEntryV1 = Readonly<{
  method: "POST" | "GET";
  path: string;
  kind: C09SystemRouteKindV1;
  requiresSession: boolean;
  mediaType: typeof HTTP_JSON_MEDIA_TYPE_V1 | typeof HTTP_SSE_MEDIA_TYPE_V1;
}>;

export const C09_SYSTEM_ROUTE_CATALOG_V1: readonly C09SystemRouteEntryV1[] = Object.freeze([
  Object.freeze({
    method: "POST" as const,
    path: "/api/v1/session/login",
    kind: "login" as const,
    requiresSession: false,
    mediaType: HTTP_JSON_MEDIA_TYPE_V1,
  }),
  Object.freeze({
    method: "POST" as const,
    path: "/api/v1/session/change-password",
    kind: "change-password" as const,
    requiresSession: true,
    mediaType: HTTP_JSON_MEDIA_TYPE_V1,
  }),
  Object.freeze({
    method: "POST" as const,
    path: "/api/v1/session/logout",
    kind: "logout" as const,
    requiresSession: true,
    mediaType: HTTP_JSON_MEDIA_TYPE_V1,
  }),
  // 自省是唯一的会话 GET：没有请求体，身份只来自安全 Cookie。
  Object.freeze({
    method: "GET" as const,
    path: "/api/v1/session",
    kind: "introspect" as const,
    requiresSession: false,
    mediaType: HTTP_JSON_MEDIA_TYPE_V1,
  }),
  // CH-2：入口能力读面是唯一的工程级 GET；没有 query/body，服务端未注入时
  // 该路由与 OpenAPI 操作都不出现，客户端据此呈现接缝不可用。
  Object.freeze({
    method: "GET" as const,
    path: "/api/v1/projects/:projectId/access",
    kind: "project-access" as const,
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

export const HTTP_SYSTEM_ROUTE_CATALOG_V1 = C09_SYSTEM_ROUTE_CATALOG_V1;

export class C09HttpError extends Error {
  readonly error: SafeHttpErrorV1;

  constructor(error: SafeHttpErrorV1) {
    super(error.code);
    this.name = "C09HttpError";
    this.error = error;
  }
}

const statusError = (status: number, requestId: string): SafeHttpErrorV1 => {
  const mapping: Partial<Record<number, { code: HttpErrorCodeV1; retryable: boolean }>> = {
    401: { code: "AUTHENTICATION_REQUIRED", retryable: false },
    400: { code: "CONTRACT_INVALID", retryable: false },
    403: { code: "NOT_FOUND", retryable: false },
    404: { code: "NOT_FOUND", retryable: false },
    409: { code: "IDEMPOTENCY_CONFLICT", retryable: false },
    413: { code: "REQUEST_TOO_LARGE", retryable: false },
    415: { code: "UNSUPPORTED_MEDIA_TYPE", retryable: false },
    422: { code: "CONTRACT_INVALID", retryable: false },
    426: { code: "UNSUPPORTED_CONTRACT", retryable: false },
    503: { code: "TRANSIENT_FAILURE", retryable: true },
  };
  const selected = mapping[status] ?? { code: "TERMINAL_FAILURE", retryable: false };
  return makeSafeHttpError({ requestId, ...selected });
};

const requestIdFromResponse = (response: Response): string => {
  try {
    return requestIdFallback(response.headers.get("x-request-id"));
  } catch {
    return "web-request";
  }
};

const projectIdFrom = (request: unknown): string | undefined => {
  if (!isRecord(request) || !isNonEmptyString(request.projectId)) return undefined;
  return request.projectId.trim();
};

const hasForbiddenRequestField = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  return [
    "actorId",
    "capability",
    "capabilities",
    "authorization",
    "authorizationContext",
    "authorizationContextRef",
    "sessionToken",
    "token",
    "accessToken",
    "url",
    "path",
    "branch",
  ].some((key) => Object.hasOwn(value, key));
};

const isValidSafeErrorPayload = (value: unknown): boolean =>
  isRecord(value) &&
  value.schemaVersion === HTTP_SCHEMA_VERSION_V1 &&
  isNonEmptyString(value.requestId) &&
  safeErrorCode(value.code) &&
  typeof value.retryable === "boolean" &&
  isDateString(value.occurredAt) &&
  Array.isArray(value.references);

const isProjectRequestBody = (
  operation: Pick<C09OperationV1<never, unknown>, "mode">,
  body: Record<string, unknown>,
  projectId: string,
): boolean => {
  if (
    body.schemaVersion !== HTTP_SCHEMA_VERSION_V1 ||
    (Object.hasOwn(body, "projectId") && body.projectId !== projectId) ||
    !Array.isArray(body.requestedSpatialScopeRefs) ||
    !Array.isArray(body.requestedSourceVersionRefs) ||
    !Object.hasOwn(body, "payload")
  )
    return false;
  if (operation.mode === "command")
    return (
      isNonEmptyString(body.commandId) &&
      isNonEmptyString(body.idempotencyKey) &&
      isDateString(body.issuedAt)
    );
  return isNonEmptyString(body.queryId) && isDateString(body.requestedAt);
};

const safeProjectPath = (path: string, projectId: string): string => {
  if (!path.startsWith("/api/v1/projects/:projectId/")) throw new Error("unsafe C09 path");
  if (!isNonEmptyString(projectId) || projectId.includes("/") || projectId.includes("\\"))
    throw new Error("invalid project id");
  return path.replace(":projectId", encodeURIComponent(projectId));
};

export type C09SystemOperationIdV1 =
  "session.login" | "session.change-password" | "session.logout" | "session.introspect";

const sessionOperation = <TRequest, TResult>(input: {
  readonly operationId: C09SystemOperationIdV1;
  readonly method: "POST" | "GET";
  readonly path:
    | "/api/v1/session/login"
    | "/api/v1/session/change-password"
    | "/api/v1/session/logout"
    | "/api/v1/session";
  readonly encode: (request: TRequest) => unknown;
  readonly decode: (response: unknown) => TResult;
}): C09OperationV1<TRequest, TResult> =>
  Object.freeze({
    operationId: input.operationId,
    mode: "session" as const,
    method: input.method,
    path: input.path,
    branch: null,
    requiredCapability: null,
    encode: input.encode,
    decode: input.decode,
  });

const exactSessionReference = (value: unknown): SessionReferenceV1 => {
  const parsed = VersionReferenceSchema.safeParse(value);
  if (!parsed.success) throw new Error("invalid session reference");
  return Object.freeze(parsed.data);
};

const SESSION_METADATA_KEYS_V1 = new Set([
  "schemaVersion",
  "sessionRef",
  "accountRef",
  "passwordChangeRequired",
  "restricted",
  "expiresAt",
  "systemAdministrationContextRef",
]);

export const decodeSessionMetadata = (value: unknown): SessionMetadataViewV1 => {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !SESSION_METADATA_KEYS_V1.has(key)) ||
    value.schemaVersion !== HTTP_SCHEMA_VERSION_V1
  )
    throw new Error("invalid session response");
  const expiresAt = IsoDateTimeSchema.safeParse(value.expiresAt);
  if (!expiresAt.success) throw new Error("invalid session expiry");
  const systemAdministrationContextRef =
    value.systemAdministrationContextRef === undefined
      ? undefined
      : (() => {
          const parsed = AuthorizationContextRefV1Schema.safeParse(
            value.systemAdministrationContextRef,
          );
          if (!parsed.success) throw new Error("invalid session administration context");
          return parsed.data;
        })();
  const metadata: SessionMetadataViewV1 = {
    schemaVersion: HTTP_SCHEMA_VERSION_V1,
    sessionRef: exactSessionReference(value.sessionRef),
    accountRef: exactSessionReference(value.accountRef),
    passwordChangeRequired: value.passwordChangeRequired === true,
    restricted: value.restricted === true,
    expiresAt: expiresAt.data,
    ...(systemAdministrationContextRef === undefined ? {} : { systemAdministrationContextRef }),
  };
  if (typeof value.passwordChangeRequired !== "boolean" || typeof value.restricted !== "boolean")
    throw new Error("invalid session response");
  return Object.freeze(metadata);
};

export const C09_SESSION_OPERATIONS_V1 = Object.freeze([
  sessionOperation<SessionLoginInputV1, SessionMetadataViewV1>({
    operationId: "session.login",
    method: "POST" as const,
    path: "/api/v1/session/login",
    encode: (request) => ({ schemaVersion: HTTP_SCHEMA_VERSION_V1, ...request }),
    decode: decodeSessionMetadata,
  }),
  sessionOperation<SessionChangePasswordInputV1, SessionMetadataViewV1>({
    operationId: "session.change-password",
    method: "POST" as const,
    path: "/api/v1/session/change-password",
    encode: (request) => ({ schemaVersion: HTTP_SCHEMA_VERSION_V1, ...request }),
    decode: decodeSessionMetadata,
  }),
  sessionOperation<Record<string, never>, undefined>({
    operationId: "session.logout",
    method: "POST" as const,
    path: "/api/v1/session/logout",
    encode: () => ({ schemaVersion: HTTP_SCHEMA_VERSION_V1 }),
    decode: () => undefined,
  }),
  // 自省不编码任何请求：身份只来自同源安全 Cookie，客户端不持也不发会话身份。
  sessionOperation<Record<string, never>, SessionMetadataViewV1>({
    operationId: "session.introspect",
    method: "GET" as const,
    path: "/api/v1/session",
    encode: () => ({}),
    decode: decodeSessionMetadata,
  }),
]);

const C09_LOGIN_OPERATION_V1 = C09_SESSION_OPERATIONS_V1[0] as C09OperationV1<
  SessionLoginInputV1,
  SessionMetadataViewV1
>;
const C09_CHANGE_PASSWORD_OPERATION_V1 = C09_SESSION_OPERATIONS_V1[1] as C09OperationV1<
  SessionChangePasswordInputV1,
  SessionMetadataViewV1
>;
const C09_LOGOUT_OPERATION_V1 = C09_SESSION_OPERATIONS_V1[2] as C09OperationV1<
  Record<string, never>,
  undefined
>;
const C09_INTROSPECT_OPERATION_V1 = C09_SESSION_OPERATIONS_V1[3] as C09OperationV1<
  Record<string, never>,
  SessionMetadataViewV1
>;

const expectedProjectPath = (mode: "command" | "query", branch: ModuleBranchV1): string =>
  `/api/v1/projects/:projectId/${mode === "command" ? "commands" : "queries"}/${branch}`;

const operationKey = (operation: AnyC09OperationV1): string =>
  `${operation.operationId}|${operation.method}|${operation.path}|${operation.branch ?? ""}`;

const assertOperation = (operation: AnyC09OperationV1): void => {
  if (
    !isNonEmptyString(operation.operationId) ||
    !/^[a-z0-9][a-z0-9.-]*$/.test(operation.operationId) ||
    (operation.method !== "POST" && operation.method !== "GET") ||
    typeof operation.encode !== "function" ||
    typeof operation.decode !== "function"
  )
    throw new Error("invalid C09 operation descriptor");
  if (operation.mode === "session") {
    if (
      operation.branch !== null ||
      operation.requiredCapability !== null ||
      !C09_SYSTEM_ROUTE_CATALOG_V1.some(
        (entry) => entry.kind !== "sse" && entry.path === operation.path,
      )
    )
      throw new Error("invalid C09 session operation");
    return;
  }
  if (operation.mode !== "command" && operation.mode !== "query")
    throw new Error("invalid C09 operation mode");
  // GET 只属于会话自省；业务命令与查询仍是有请求体的 POST。
  if (operation.method !== "POST") throw new Error("invalid C09 operation method");
  if (
    operation.branch === null ||
    !Object.hasOwn(MODULE_BRANCH_CAPABILITY_V1, operation.branch) ||
    MODULE_BRANCH_CAPABILITY_V1[operation.branch] !== operation.requiredCapability ||
    operation.path !== expectedProjectPath(operation.mode, operation.branch)
  )
    throw new Error("invalid C09 project operation");
};

export const createC09Operation = <TRequest, TResult>(input: {
  readonly operationId: C09OperationIdV1;
  readonly mode: "command" | "query";
  readonly branch: ModuleBranchV1;
  readonly encode: (request: TRequest) => unknown;
  readonly decode: (response: unknown) => TResult;
}): C09OperationV1<TRequest, TResult> => {
  const operation = Object.freeze({
    operationId: input.operationId,
    mode: input.mode,
    method: "POST" as const,
    path: expectedProjectPath(input.mode, input.branch),
    branch: input.branch,
    requiredCapability: MODULE_BRANCH_CAPABILITY_V1[input.branch],
    encode: input.encode,
    decode: input.decode,
  });
  assertOperation(operation as C09OperationV1<unknown, unknown>);
  return operation;
};

export const createCommandOperation = <TRequest, TResult>(input: {
  readonly operationId: C09OperationIdV1;
  readonly branch: ModuleBranchV1;
  readonly encode: (request: TRequest) => unknown;
  readonly decode: (response: unknown) => TResult;
}): C09OperationV1<TRequest, TResult> => createC09Operation({ ...input, mode: "command" });

export const createQueryOperation = <TRequest, TResult>(input: {
  readonly operationId: C09OperationIdV1;
  readonly branch: ModuleBranchV1;
  readonly encode: (request: TRequest) => unknown;
  readonly decode: (response: unknown) => TResult;
}): C09OperationV1<TRequest, TResult> => createC09Operation({ ...input, mode: "query" });

/**
 * C37 D-17：闭合 system operation。
 *
 * 系统管理面与运维查询走固定路径，不套用 `/projects/:projectId` 业务模板，
 * 但仍使用同一 session/Cookie、错误映射与取消语义；这里只登记四条，
 * 不提供任意 URL 方法，避免把客户端变成通用 HTTP 代理。
 */
export const C37_SYSTEM_OPERATION_IDS_V1 = Object.freeze([
  "administration.read",
  "administration.query",
  "administration.command",
  "operations.query",
] as const);
export type C37SystemOperationIdV1 = (typeof C37_SYSTEM_OPERATION_IDS_V1)[number];

const SYSTEM_OPERATION_PATHS_V1: Readonly<Record<C37SystemOperationIdV1, string>> = Object.freeze({
  "administration.read": "/api/v1/administration",
  "administration.query": "/api/v1/administration/queries",
  "administration.command": "/api/v1/administration/commands",
  "operations.query": "/api/v1/operations/queries",
});

export type C37SystemOperationV1<TRequest, TResult> = Readonly<{
  operationId: C37SystemOperationIdV1;
  mode: "command" | "query";
  method: "POST" | "GET";
  path: string;
  requiresSession: true;
  encode: (request: TRequest) => unknown;
  decode: (response: unknown) => TResult;
}>;

export const createC09SystemOperation = <TRequest, TResult>(input: {
  readonly operationId: C37SystemOperationIdV1;
  readonly mode: "command" | "query";
  readonly method: "POST" | "GET";
  readonly encode: (request: TRequest) => unknown;
  readonly decode: (response: unknown) => TResult;
}): C37SystemOperationV1<TRequest, TResult> =>
  Object.freeze({
    operationId: input.operationId,
    mode: input.mode,
    method: input.method,
    path: SYSTEM_OPERATION_PATHS_V1[input.operationId],
    requiresSession: true as const,
    encode: input.encode,
    decode: input.decode,
  });

/** 客户端只接受已登记的 system operation；不在目录内的 id 直接拒绝。 */
export const isC37SystemOperationIdV1 = (value: unknown): value is C37SystemOperationIdV1 =>
  typeof value === "string" && (C37_SYSTEM_OPERATION_IDS_V1 as readonly string[]).includes(value);

export type C09OperationRegistryV1 = Readonly<{
  operations: readonly AnyC09OperationV1[];
  has: (operation: AnyC09OperationV1) => boolean;
  get: (operationId: string) => AnyC09OperationV1 | undefined;
}>;

export const createC09OperationRegistry = (
  operations: readonly AnyC09OperationV1[] = C09_SESSION_OPERATIONS_V1,
): C09OperationRegistryV1 => {
  const byIdentity = new Set<AnyC09OperationV1>();
  const byId = new Map<string, AnyC09OperationV1>();
  const keys = new Set<string>();
  for (const operation of operations) {
    Object.freeze(operation);
    assertOperation(operation);
    const key = operationKey(operation);
    if (keys.has(key) || byId.has(operation.operationId))
      throw new Error("duplicate C09 operation");
    keys.add(key);
    byIdentity.add(operation);
    byId.set(operation.operationId, operation);
  }
  const values = Object.freeze(Array.from(byIdentity));
  return Object.freeze({
    operations: values,
    has: (operation: AnyC09OperationV1) => byIdentity.has(operation),
    get: (operationId: string) => byId.get(operationId),
  });
};

export const C09_OPERATION_REGISTRY_V1 = createC09OperationRegistry();

export type C09Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const defaultFetch: C09Fetch = (input, init) => {
  if (typeof globalThis.fetch !== "function")
    return Promise.reject(new Error("Fetch is unavailable"));
  return globalThis.fetch(input, init);
};

const readResponseBody = async (response: Response): Promise<unknown> => {
  if (response.status === 204) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

const wireBody = (operation: C09OperationV1<unknown, unknown>, request: unknown): unknown => {
  if (hasForbiddenRequestField(request))
    throw new C09HttpError(makeSafeHttpError({ code: "CONTRACT_INVALID" }));
  const encoded = operation.encode(request);
  if (!isRecord(encoded) || hasForbiddenRequestField(encoded))
    throw new C09HttpError(makeSafeHttpError({ code: "CONTRACT_INVALID" }));
  try {
    if (typeof JSON.stringify(encoded) !== "string") throw new Error("body is not serializable");
  } catch {
    throw new C09HttpError(makeSafeHttpError({ code: "CONTRACT_INVALID" }));
  }
  return encoded;
};

const responseFailure = async (response: Response): Promise<never> => {
  const requestId = requestIdFromResponse(response);
  const body = await readResponseBody(response);
  const error = decodeSafeHttpError(body, requestId);
  const fallback = isValidSafeErrorPayload(body) ? error : statusError(response.status, requestId);
  throw new C09HttpError(fallback);
};

export type C09ClientV1 = Readonly<{
  operations: C09OperationRegistryV1;
  loadOpenApi: (signal: AbortSignal) => Promise<OpenApiAvailabilityV1>;
  login: (request: SessionLoginInputV1, signal: AbortSignal) => Promise<SessionMetadataViewV1>;
  changePassword: (
    request: SessionChangePasswordInputV1,
    signal: AbortSignal,
  ) => Promise<SessionMetadataViewV1>;
  logout: (signal: AbortSignal) => Promise<void>;
  /** 当前会话自省：GET 无请求体，身份只来自同源安全 Cookie。 */
  introspectSession: (signal: AbortSignal) => Promise<SessionMetadataViewV1>;
  /**
   * 当前工程入口能力呈现：GET 无请求体，身份只来自同源安全 Cookie。
   *
   * 专用方法而不是通用 URL 查询器：路径只由工程标识拼出，客户端不能借它
   * 声明 actor、角色或能力；服务端未注入该接缝时按统一未找到失败。
   */
  readProjectAccessPresentation: (
    projectId: string,
    signal: AbortSignal,
  ) => Promise<ProjectAccessPresentationViewV1>;
  submit: <TRequest, TResult>(
    operation: RegisteredC09OperationV1<TRequest, TResult>,
    request: TRequest,
    signal: AbortSignal,
  ) => Promise<C09ResultV1<TResult>>;
  subscribe: (input: C09RunSubscriptionInputV1) => C09RunSubscriptionHandleV1;
}>;

const requestJson = async (input: {
  fetcher: C09Fetch;
  path: string;
  method: "GET" | "POST";
  body?: unknown;
  signal: AbortSignal;
}): Promise<{ readonly response: Response; readonly body: unknown }> => {
  if (input.signal.aborted) throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
  let response: Response;
  try {
    response = await input.fetcher(input.path, {
      method: input.method,
      credentials: "same-origin",
      cache: "no-store",
      signal: input.signal,
      headers: {
        accept: HTTP_JSON_MEDIA_TYPE_V1,
        ...(input.method === "POST" ? { "content-type": HTTP_JSON_MEDIA_TYPE_V1 } : {}),
      },
      ...(input.method === "POST" ? { body: JSON.stringify(input.body ?? {}) } : {}),
    });
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason ?? error;
    throw new C09HttpError(makeSafeHttpError({ code: "TRANSIENT_FAILURE", retryable: true }));
  }
  if (!response.ok) await responseFailure(response);
  return { response, body: await readResponseBody(response) };
};

export const createC09Client = (input?: {
  readonly fetcher?: C09Fetch;
  readonly operationRegistry?: C09OperationRegistryV1;
  readonly operations?: readonly C09OperationV1<never, unknown>[];
  readonly sse?: C09SseClientV1;
}): C09ClientV1 => {
  const fetcher = input?.fetcher ?? defaultFetch;
  const operations =
    input?.operationRegistry ??
    createC09OperationRegistry(
      input?.operations === undefined
        ? C09_SESSION_OPERATIONS_V1
        : [...C09_SESSION_OPERATIONS_V1, ...input.operations],
    );
  const sse = input?.sse ?? createSseClient();
  const submit = async <TRequest, TResult>(
    operation: RegisteredC09OperationV1<TRequest, TResult>,
    request: TRequest,
    signal: AbortSignal,
  ): Promise<C09ResultV1<TResult>> => {
    const builtInSessionOperation =
      operation.mode === "session" &&
      C09_SESSION_OPERATIONS_V1.some((candidate) => candidate === operation);
    if (!operations.has(operation as C09OperationV1<unknown, unknown>) && !builtInSessionOperation)
      throw new C09HttpError(makeSafeHttpError({ code: "CONTRACT_INVALID" }));
    const projectId = operation.mode === "session" ? undefined : projectIdFrom(request);
    if (operation.mode !== "session" && projectId === undefined)
      throw new C09HttpError(makeSafeHttpError({ code: "CONTRACT_INVALID" }));
    let path: string;
    try {
      path =
        operation.mode === "session"
          ? operation.path
          : safeProjectPath(operation.path, projectId as string);
    } catch {
      throw new C09HttpError(makeSafeHttpError({ code: "CONTRACT_INVALID" }));
    }
    let body: unknown;
    try {
      body = wireBody(operation as C09OperationV1<unknown, unknown>, request);
    } catch (error) {
      if (error instanceof C09HttpError) throw error;
      throw new C09HttpError(makeSafeHttpError({ code: "CONTRACT_INVALID" }));
    }
    if (
      operation.mode !== "session" &&
      (!isRecord(body) || !isProjectRequestBody(operation, body, projectId as string))
    )
      throw new C09HttpError(makeSafeHttpError({ code: "CONTRACT_INVALID" }));
    const transportBody =
      operation.mode === "session"
        ? body
        : (() => {
            const envelope = { ...(body as Record<string, unknown>) };
            delete envelope.projectId;
            return envelope;
          })();
    const { response, body: responseBody } = await requestJson({
      fetcher,
      path,
      method: operation.method,
      body: transportBody,
      signal,
    });
    let value: TResult;
    try {
      value = operation.decode(responseBody);
    } catch {
      throw new C09HttpError(makeSafeHttpError({ requestId: requestIdFromResponse(response) }));
    }
    return Object.freeze({ kind: response.status === 202 ? "waiting" : "succeeded", value });
  };
  const loginOperation = C09_LOGIN_OPERATION_V1;
  const passwordOperation = C09_CHANGE_PASSWORD_OPERATION_V1;
  const logoutOperation = C09_LOGOUT_OPERATION_V1;
  const introspectOperation = C09_INTROSPECT_OPERATION_V1;
  return Object.freeze({
    operations,
    loadOpenApi: async (signal: AbortSignal) => {
      const { body } = await requestJson({
        fetcher,
        path: "/api/v1/openapi.json",
        method: "GET",
        signal,
      });
      return deriveOpenApiAvailability(body);
    },
    login: async (request, signal) => (await submit(loginOperation, request, signal)).value,
    changePassword: async (request, signal) =>
      (await submit(passwordOperation, request, signal)).value,
    logout: async (signal) => {
      try {
        await submit(logoutOperation, {}, signal);
      } catch (error) {
        // 401 表示服务端已确认当前会话失效——那正是注销要达成的终态，按成功收口。
        // 只吞这一种码：技术失败仍须上抛，外壳据此保留会话并给出重试入口。
        if (error instanceof C09HttpError && error.error.code === "AUTHENTICATION_REQUIRED") return;
        throw error;
      }
    },
    introspectSession: async (signal) => (await submit(introspectOperation, {}, signal)).value,
    readProjectAccessPresentation: async (projectId, signal) => {
      let path: string;
      try {
        path = safeProjectPath("/api/v1/projects/:projectId/access", projectId);
      } catch {
        throw new C09HttpError(makeSafeHttpError({ code: "CONTRACT_INVALID" }));
      }
      const { response, body } = await requestJson({ fetcher, path, method: "GET", signal });
      try {
        return decodeProjectAccessPresentation(body);
      } catch {
        throw new C09HttpError(makeSafeHttpError({ requestId: requestIdFromResponse(response) }));
      }
    },
    submit,
    subscribe: (subscription: C09RunSubscriptionInputV1) => sse.subscribe(subscription),
  });
};

export const C09_CLIENT_V1 = createC09Client();
