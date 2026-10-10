import { createHash, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

import {
  AccessCommandResultV1Schema,
  type LocalIdentityAccessV1,
  type SystemAdministrationPortV1,
} from "@riskflow/core/access";
import {
  ProjectionQueryV1Schema,
  RunSubscriptionRequestV1Schema,
  WorkflowRunRefV1Schema,
  type AuthorizationContextV1,
  type SourceAccessGrantRefV1,
} from "@riskflow/contracts/ports";
import { IdentifierSchema } from "@riskflow/contracts/common";

import {
  HTTP_COOKIE_NAME_V1,
  HTTP_JSON_MEDIA_TYPE_V1,
  HTTP_SSE_MEDIA_TYPE_V1,
  HttpTransportError,
  SessionChangePasswordRequestV1Schema,
  SessionLoginRequestV1Schema,
  SessionLogoutRequestV1Schema,
  SseQueryRequestV1Schema,
  activeHttpRouteCatalog,
  asIso,
  assembleCommandRequest,
  assembleQueryRequest,
  authenticationRequired,
  buildAuthorizationDecision,
  buildAuthorizationRequest,
  buildChangePasswordCommand,
  decodeWorkflowRunIdV1,
  buildLoginCommand,
  buildLogoutCommand,
  buildOpenApiDocument,
  buildReadSessionCommand,
  httpCatalogForOpenApi,
  invalidRequest,
  isSafeHeaderValue,
  isSupportedJsonMediaType,
  mapHttpError,
  mapModuleResult,
  mapSessionMetadata,
  mapSessionResult,
  notFound,
  requestTooLarge,
  unsupportedMediaType,
  type ApiPortsV1,
  type HttpSystemRouteEntryV1,
  SystemAdministrationQueryRequestV1Schema,
  SystemAdministrationCommandRequestV1Schema,
  toSystemAdministrationQuery,
  toSystemAdministrationCommand,
  activeHttpSystemRouteCatalog,
  type HttpAccessLogEntryV1,
  type HttpAccessLogResultCategoryV1,
  type HttpAccessLogV1,
  type HttpCommandRequestV1,
  type HttpErrorCodeV1,
  type HttpFailureV1,
  type HttpQueryRequestV1,
  type HttpRouteEntryV1,
} from "./http.js";
import { SsePolicyV1Schema, normalizeSsePolicy, serveSse, type SsePolicyV1 } from "./sse.js";
import { SystemOperationsQueryRequestV1Schema } from "./operations.js";

const MAX_HTTP_BODY_BYTES = 1_048_576;
const REQUEST_ID_HEADER = "x-request-id";

export interface BuildApiOptionsV1 {
  readonly access: LocalIdentityAccessV1;
  readonly ports?: ApiPortsV1;
  readonly publicOrigin: string;
  readonly now?: () => Date;
  readonly idGenerator?: () => string;
  readonly ssePolicy?: Partial<SsePolicyV1>;
  readonly accessLog?: HttpAccessLogV1;
}

const singleHeader = (request: FastifyRequest, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) || typeof value !== "string" ? undefined : value;
};

const headerPresent = (request: FastifyRequest, name: string): boolean =>
  request.headers[name] !== undefined;

const queryIsEmpty = (request: FastifyRequest): boolean => {
  const query = request.query;
  return typeof query === "object" && query !== null && Object.keys(query).length === 0;
};

const parsePublicOrigin = (value: string): string => {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error("publicOrigin must be an origin");
  }
  if (
    !/^https?:$/.test(origin.protocol) ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  ) {
    throw new Error("publicOrigin must be an origin");
  }
  return origin.origin;
};

const requestIdFor = (request: FastifyRequest, generate: () => string): string => {
  const incoming = singleHeader(request, REQUEST_ID_HEADER);
  const normalizedIncoming = incoming?.trim();
  if (
    incoming !== undefined &&
    isSafeHeaderValue(incoming) &&
    normalizedIncoming !== undefined &&
    normalizedIncoming.length > 0 &&
    normalizedIncoming.length <= 128
  ) {
    return normalizedIncoming;
  }
  const generated = generate();
  const normalizedGenerated = generated.trim();
  return isSafeHeaderValue(generated) &&
    normalizedGenerated.length > 0 &&
    normalizedGenerated.length <= 128
    ? normalizedGenerated
    : randomUUID();
};

type AccessLogReplyState = Readonly<{
  resultCategory: HttpAccessLogResultCategoryV1;
  errorCode: HttpErrorCodeV1;
}>;

const accessLogReplyStates = new WeakMap<object, AccessLogReplyState>();

const markAccessLogFailure = (reply: FastifyReply, errorCode: HttpErrorCodeV1): void => {
  accessLogReplyStates.set(reply, { resultCategory: "failed", errorCode });
};

const responseFailure = (reply: FastifyReply, value: HttpFailureV1): FastifyReply => {
  markAccessLogFailure(reply, value.error.code);
  return reply.code(value.status).type(HTTP_JSON_MEDIA_TYPE_V1).send(value.error);
};

const requestNow = (clock: () => Date): Date => {
  const value = clock();
  return Number.isNaN(value.getTime()) ? new Date(0) : value;
};

type CookieToken = string | null | undefined;

const cookieToken = (request: FastifyRequest): CookieToken => {
  const header = request.headers.cookie;
  if (header === undefined) return undefined;
  if (Array.isArray(header) || !isSafeHeaderValue(header)) return null;
  let value: string | undefined;
  let count = 0;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    if (part.slice(0, separator).trim() !== HTTP_COOKIE_NAME_V1) continue;
    count += 1;
    value = part.slice(separator + 1).trim();
  }
  if (count > 1 || value === undefined || value.length === 0 || !isSafeHeaderValue(value))
    return null;
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length > 0 && isSafeHeaderValue(decoded) ? decoded : null;
  } catch {
    return null;
  }
};

const sessionFailure = (
  reply: FastifyReply,
  token: CookieToken,
  requestId: string,
  now: Date,
): FastifyReply | undefined => {
  if (token === null) return responseFailure(reply, invalidRequest(requestId, now));
  if (token === undefined) return responseFailure(reply, authenticationRequired(requestId, now));
  return undefined;
};

const setSessionCookie = (reply: FastifyReply, token: string, clear = false): void => {
  const value = clear ? "" : encodeURIComponent(token);
  const maxAge = clear ? "; Max-Age=0" : "";
  reply.header(
    "set-cookie",
    `${HTTP_COOKIE_NAME_V1}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict${maxAge}`,
  );
};

const sameOrigin = (request: FastifyRequest, origin: string): boolean => {
  const value = singleHeader(request, "origin");
  return (
    value !== undefined && !value.includes(",") && isSafeHeaderValue(value) && value === origin
  );
};

const pathProjectId = (request: FastifyRequest): string => {
  const params = request.params as { readonly projectId?: unknown };
  return z.string().min(1).parse(params.projectId);
};

const pathRunRef = (request: FastifyRequest): z.infer<typeof WorkflowRunRefV1Schema> => {
  const params = request.params as { readonly runId?: unknown };
  return decodeWorkflowRunIdV1(params.runId);
};

const lastEventId = (request: FastifyRequest): string | undefined => {
  const value = request.headers["last-event-id"];
  if (Array.isArray(value)) return "";
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.includes(",") || !isSafeHeaderValue(value)) return "";
  const parsed = IdentifierSchema.safeParse(value);
  return parsed.success ? parsed.data : "";
};

const MAX_ACCESS_LOG_IDENTIFIER_LENGTH = 256;

const accessLogIdentifier = (value: unknown): string | undefined => {
  if (
    typeof value !== "string" ||
    value.length > MAX_ACCESS_LOG_IDENTIFIER_LENGTH ||
    !isSafeHeaderValue(value)
  )
    return undefined;
  const parsed = IdentifierSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

const requestParam = (request: FastifyRequest, name: string): string | undefined => {
  const params = request.params;
  if (typeof params !== "object" || params === null || Array.isArray(params)) return undefined;
  return accessLogIdentifier((params as Record<string, unknown>)[name]);
};

const accessLogRoute = (request: FastifyRequest): string => {
  const route = request.routeOptions?.url;
  return typeof route === "string" &&
    route.length > 0 &&
    route.length <= 256 &&
    isSafeHeaderValue(route)
    ? route
    : "unmatched";
};

const accessLogEntryFor = (
  request: FastifyRequest,
  reply: FastifyReply,
  startedAt: number,
): HttpAccessLogEntryV1 => {
  const body =
    typeof request.body === "object" && request.body !== null && !Array.isArray(request.body)
      ? (request.body as Record<string, unknown>)
      : undefined;
  const requestId =
    accessLogIdentifier(singleHeader(request, REQUEST_ID_HEADER)) ?? "unknown-request";
  const commandId = accessLogIdentifier(body?.commandId);
  const queryId = accessLogIdentifier(body?.queryId);
  const runId = requestParam(request, "runId");
  const projectId = requestParam(request, "projectId");
  const state = accessLogReplyStates.get(reply);
  const status = reply.statusCode;
  const resultCategory =
    state?.resultCategory ??
    (state?.errorCode !== undefined || status >= 400
      ? "failed"
      : status === 202
        ? "waiting"
        : "succeeded");
  return Object.freeze({
    route: accessLogRoute(request),
    requestId,
    ...(commandId === undefined ? {} : { commandId }),
    ...(queryId === undefined ? {} : { queryId }),
    ...(runId === undefined ? {} : { runId }),
    ...(projectId === undefined ? {} : { projectId }),
    resultCategory,
    status,
    durationMs: Math.max(0, Date.now() - startedAt),
    ...(state?.errorCode === undefined ? {} : { errorCode: state.errorCode }),
  });
};

const authorize = async (input: {
  readonly access: LocalIdentityAccessV1;
  readonly invocationId: string;
  readonly projectId: string;
  readonly branch: HttpRouteEntryV1["branch"];
  readonly sessionToken: string;
  readonly requestedSpatialScopeRefs: Parameters<
    typeof buildAuthorizationRequest
  >[0]["requestedSpatialScopeRefs"];
  readonly requestedSourceVersionRefs: Parameters<
    typeof buildAuthorizationRequest
  >[0]["requestedSourceVersionRefs"];
  readonly requestedAt: string;
}) => {
  const request = buildAuthorizationRequest({
    invocationId: input.invocationId,
    projectId: input.projectId,
    branch: input.branch,
    sessionToken: input.sessionToken,
    requestedSpatialScopeRefs: input.requestedSpatialScopeRefs,
    requestedSourceVersionRefs: input.requestedSourceVersionRefs,
    requestedAt: input.requestedAt,
  });
  return buildAuthorizationDecision(await input.access.authorize(request));
};

const runBusiness = async (input: {
  readonly entry: HttpRouteEntryV1;
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly options: BuildApiOptionsV1;
  readonly ports: ApiPortsV1;
  readonly requestId: string;
  readonly now: Date;
}): Promise<FastifyReply> => {
  const token = cookieToken(input.request);
  const sessionError = sessionFailure(input.reply, token, input.requestId, input.now);
  if (sessionError !== undefined) return sessionError;
  try {
    const body = input.entry.requestSchema.parse(input.request.body) as
      HttpCommandRequestV1 | HttpQueryRequestV1;
    const projectId = pathProjectId(input.request);
    const decision = await authorize({
      access: input.options.access,
      // C06 verify 把授权上下文与签发时的 invocationId 绑定：下游 port 以领域
      // commandId/queryId 复验，HTTP 签发必须沿用同一调用身份。
      invocationId:
        input.entry.mode === "command"
          ? (body as HttpCommandRequestV1).commandId
          : (body as HttpQueryRequestV1).queryId,
      projectId,
      branch: input.entry.branch,
      sessionToken: token as string,
      requestedSpatialScopeRefs: body.requestedSpatialScopeRefs,
      requestedSourceVersionRefs: body.requestedSourceVersionRefs,
      requestedAt: input.now.toISOString(),
    });
    if (
      decision.context.projectId !== projectId ||
      !decision.context.grantedCapabilities.includes(input.entry.requiredCapability)
    ) {
      throw new HttpTransportError(notFound(input.requestId, input.now));
    }
    const domainRequest =
      input.entry.mode === "command"
        ? assembleCommandRequest(input.entry, projectId, body, decision)
        : assembleQueryRequest(input.entry, projectId, body, decision);
    const grantedProjection = await qualityProjectionWithGrants({
      entry: input.entry,
      request: input.request,
      options: input.options,
      ports: input.ports,
      requestId: input.requestId,
      now: input.now,
      decision,
      domainRequest,
    });
    const result = grantedProjection ?? (await input.entry.invoke(input.ports, domainRequest));
    const mapped = mapModuleResult({
      result,
      resultSchema: input.entry.resultSchema,
      requestId: input.requestId,
      now: input.now,
    });
    if ("status" in mapped) return responseFailure(input.reply, mapped);
    return input.reply
      .code(mapped.kind === "waiting" ? 202 : 200)
      .type(HTTP_JSON_MEDIA_TYPE_V1)
      .send(mapped.value);
  } catch (error) {
    return responseFailure(
      input.reply,
      mapHttpError({ error, requestId: input.requestId, now: input.now }),
    );
  }
};

/**
 * D-21：C36 质量查询的请求侧两阶段签发。
 *
 * D-11 原文「完整 projection port 缺席才接管」在 D-21 修正为**只按 queryType 选择**：
 * 质量查询无论是否同时存在完整 projection 都由 C36 窄口接管，否则 D-21 要求的两阶段
 * 来源授权会被静默跳过；其它 queryType 一律委派原 projection。返回 `undefined` 表示不接管。
 */
const qualityProjectionWithGrants = async (input: {
  readonly entry: HttpRouteEntryV1;
  readonly request: FastifyRequest;
  readonly options: BuildApiOptionsV1;
  readonly ports: ApiPortsV1;
  readonly requestId: string;
  readonly now: Date;
  readonly decision: { readonly context: AuthorizationContextV1 };
  readonly domainRequest: unknown;
}): Promise<unknown | undefined> => {
  if (input.entry.branch !== "projection.query") return undefined;
  const narrow = input.ports.qualityProjectionQuery;
  if (
    narrow?.candidateSourceVersionRefs === undefined ||
    narrow.queryWithSourceGrants === undefined
  ) {
    return undefined;
  }
  const parsed = ProjectionQueryV1Schema.safeParse(input.domainRequest);
  if (!parsed.success || parsed.data.payload.queryType !== "quality-evaluation") return undefined;
  const candidates = await narrow.candidateSourceVersionRefs(parsed.data);
  if (candidates.kind === "rejected") return candidates.result;
  const sessionToken = cookieToken(input.request);
  if (sessionToken === undefined || sessionToken === null) return undefined;
  const requestedSpatialScopeRefs = input.decision.context.spatialScopeRefs;
  const signVersions = async (phase: "initial" | "final") => {
    const grants = new Map<string, readonly SourceAccessGrantRefV1[]>();
    for (const candidate of candidates.versions) {
      try {
        // 两轮使用不同 invocation，最终轮不能命中先前的签发回执。
        const versionDigest = createHash("sha256").update(candidate.versionKey).digest("hex");
        const perVersion = await authorize({
          access: input.options.access,
          invocationId: `${input.requestId}:quality-source-version:${phase}:${versionDigest}`,
          projectId: parsed.data.projectId,
          branch: "projection.query",
          sessionToken,
          requestedSpatialScopeRefs,
          requestedSourceVersionRefs: [candidate.sourceVersionRef],
          requestedAt: input.now.toISOString(),
        });
        const context = perVersion.context;
        if (
          context.projectId !== parsed.data.projectId ||
          context.actorId !== input.decision.context.actorId ||
          context.grantedCapabilities.length !== 1 ||
          context.grantedCapabilities[0] !== "projection.query" ||
          JSON.stringify(context.spatialScopeRefs) !== JSON.stringify(requestedSpatialScopeRefs) ||
          context.sourceAccessGrantRefs.length === 0
        )
          continue;
        grants.set(candidate.versionKey, context.sourceAccessGrantRefs);
      } catch (error: unknown) {
        if (accessDeniedCode(error)) continue;
        throw error;
      }
    }
    return grants;
  };
  await signVersions("initial");
  // 当前工程/空间与来源版本均在返回前重新签发；旧上下文不得披露撤权后的定位。
  let current;
  try {
    current = (
      await authorize({
        access: input.options.access,
        invocationId: `${input.requestId}:quality-final-scope`,
        projectId: parsed.data.projectId,
        branch: "projection.query",
        sessionToken,
        requestedSpatialScopeRefs,
        requestedSourceVersionRefs: [],
        requestedAt: input.now.toISOString(),
      })
    ).context;
  } catch (error: unknown) {
    if (!accessDeniedCode(error)) throw error;
    throw new HttpTransportError(notFound(input.requestId, input.now));
  }
  if (
    current.projectId !== parsed.data.projectId ||
    current.actorId !== input.decision.context.actorId ||
    current.grantedCapabilities.length !== 1 ||
    current.grantedCapabilities[0] !== "projection.query" ||
    JSON.stringify(current.spatialScopeRefs) !== JSON.stringify(requestedSpatialScopeRefs)
  )
    throw new HttpTransportError(notFound(input.requestId, input.now));
  return narrow.queryWithSourceGrants(parsed.data, await signVersions("final"), candidates);
};

const accessDeniedCode = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null || !("details" in error)) return false;
  const details = error.details;
  return (
    typeof details === "object" &&
    details !== null &&
    "code" in details &&
    details.code === "AUTHORIZATION_DENIED"
  );
};

/**
 * C35 系统面处理（design D-12）：会话 token 一律来自唯一 Cookie；请求体只提供身份与调用
 * 标识，管理授权上下文由服务端在所属适配器内注入。目录/写入/运维查询都要先拿到 D-10 的
 * 当前管理证明，拿不到就按拒绝收口，绝不先查目标再判身份。
 */
/** D-10 的当前管理证明；普通有效会话只能拿到 `isSystemAdministrator: false`。 */
const currentSystemAdministrator = async (input: {
  readonly administration: SystemAdministrationPortV1;
  readonly sessionToken: string;
  readonly queryId: string;
  readonly now: Date;
}): Promise<boolean> => {
  const identity = await input.administration.read({
    kind: "identity",
    schemaVersion: "1",
    queryId: input.queryId,
    requestedAt: asIso(input.now),
    sessionToken: input.sessionToken,
  });
  if (identity.kind === "failed") throw identity.error;
  // identity 是唯一可能对普通会话成功的目录读，结果族按 kind 收窄。
  return identity.result.kind === "identity" && identity.result.isSystemAdministrator;
};

const runSystem = async (input: {
  readonly entry: HttpSystemRouteEntryV1;
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly options: BuildApiOptionsV1;
  readonly ports: ApiPortsV1;
  readonly requestId: string;
  readonly now: Date;
}): Promise<FastifyReply> => {
  const token = cookieToken(input.request);
  const sessionError = sessionFailure(input.reply, token, input.requestId, input.now);
  if (sessionError !== undefined) return sessionError;
  const administration = input.ports.systemAdministration;
  if (administration === undefined)
    throw new HttpTransportError(notFound(input.requestId, input.now));
  input.reply.header("cache-control", "no-store");
  try {
    if (input.entry.kind === "administration-identity") {
      // 无请求体：身份查询只需要 Cookie 会话与这次调用的标识。
      const identity = await administration.read({
        kind: "identity",
        schemaVersion: "1",
        queryId: input.requestId,
        requestedAt: asIso(input.now),
        sessionToken: token as string,
      });
      return input.reply.code(200).type(HTTP_JSON_MEDIA_TYPE_V1).send(identity);
    }
    if (input.entry.kind === "administration-queries") {
      const body = SystemAdministrationQueryRequestV1Schema.parse(input.request.body);
      const result = await administration.read(toSystemAdministrationQuery(body, token as string));
      // 端口以 failed 信封表达拒绝/失败：沿既有安全错误映射，无权与不存在同形，
      // 不把授权失败包装成 HTTP 200（design D-10/D-12）。
      if (result.kind === "failed")
        return responseFailure(
          input.reply,
          mapHttpError({ error: result.error, requestId: input.requestId, now: input.now }),
        );
      return input.reply.code(200).type(HTTP_JSON_MEDIA_TYPE_V1).send(result);
    }
    if (input.entry.kind === "administration-commands") {
      const body = SystemAdministrationCommandRequestV1Schema.parse(input.request.body);
      const result = await administration.execute(
        toSystemAdministrationCommand(body, token as string),
      );
      if (result.kind === "failed")
        return responseFailure(
          input.reply,
          mapHttpError({ error: result.error, requestId: input.requestId, now: input.now }),
        );
      return input.reply.code(200).type(HTTP_JSON_MEDIA_TYPE_V1).send(result);
    }
    const operations = input.ports.systemOperationsRead;
    if (operations === undefined)
      throw new HttpTransportError(notFound(input.requestId, input.now));
    // 系统管理没有对应的业务能力位：与业务路由同样按 NOT_FOUND 收口，
    // 既拒绝未授权者，也不披露系统对象是否存在（design D-10）。
    if (
      !(await currentSystemAdministrator({
        administration,
        sessionToken: token as string,
        queryId: input.requestId,
        now: input.now,
      }))
    )
      throw new HttpTransportError(notFound(input.requestId, input.now));
    const body = SystemOperationsQueryRequestV1Schema.parse(input.request.body);
    return input.reply
      .code(200)
      .type(HTTP_JSON_MEDIA_TYPE_V1)
      .send(await operations.read(body));
  } catch (error) {
    return responseFailure(
      input.reply,
      mapHttpError({ error, requestId: input.requestId, now: input.now }),
    );
  }
};

export const buildApi = (options: BuildApiOptionsV1): FastifyInstance => {
  const publicOrigin = parsePublicOrigin(options.publicOrigin);
  const ports = options.ports ?? {};
  const clock = options.now ?? (() => new Date());
  const generateId = options.idGenerator ?? randomUUID;
  const ssePolicy = normalizeSsePolicy(options.ssePolicy);
  SsePolicyV1Schema.parse(ssePolicy);
  const app = Fastify({ bodyLimit: MAX_HTTP_BODY_BYTES, logger: false });
  const activeSseControllers = new Set<AbortController>();
  const accessLogStartedAt = new WeakMap<object, number>();
  const accessLog = options.accessLog;

  app.addHook("onRequest", async (request, reply) => {
    const requestId = requestIdFor(request, generateId);
    request.headers[REQUEST_ID_HEADER] = requestId;
    if (accessLog !== undefined) accessLogStartedAt.set(request, Date.now());
    if (headerPresent(request, "authorization"))
      return responseFailure(reply, invalidRequest(requestId, requestNow(clock)));
    if (request.method === "POST") {
      if (!sameOrigin(request, publicOrigin))
        return responseFailure(reply, invalidRequest(requestId, requestNow(clock)));
      if (!queryIsEmpty(request))
        return responseFailure(reply, invalidRequest(requestId, requestNow(clock)));
      if (!isSupportedJsonMediaType(singleHeader(request, "content-type")))
        return responseFailure(reply, unsupportedMediaType(requestId, requestNow(clock)));
    }
  });

  if (accessLog !== undefined) {
    app.addHook("onResponse", (request, reply, done) => {
      const startedAt = accessLogStartedAt.get(request) ?? Date.now();
      accessLogStartedAt.delete(request);
      try {
        const result = accessLog(accessLogEntryFor(request, reply, startedAt));
        void Promise.resolve(result).catch(() => undefined);
      } catch {
        // Access logging is diagnostic only and must not affect the response.
      }
      done();
    });
  }

  app.setErrorHandler((error, request, reply) => {
    const requestId = requestIdFor(request, generateId);
    const now = requestNow(clock);
    const statusCode = (error as { readonly statusCode?: number }).statusCode;
    const code = (error as { readonly code?: string }).code;
    if (statusCode === 413 || code === "FST_ERR_CTP_BODY_TOO_LARGE")
      return responseFailure(reply, requestTooLarge(requestId, now));
    if (code === "FST_ERR_CTP_INVALID_MEDIA_TYPE")
      return responseFailure(reply, unsupportedMediaType(requestId, now));
    if (code === "FST_ERR_CTP_INVALID_JSON_BODY" || code === "FST_ERR_CTP_EMPTY_JSON_BODY")
      return responseFailure(reply, invalidRequest(requestId, now));
    return responseFailure(reply, mapHttpError({ error, requestId, now }));
  });
  app.setNotFoundHandler((request, reply) =>
    responseFailure(reply, notFound(requestIdFor(request, generateId), requestNow(clock))),
  );

  app.post("/api/v1/session/login", async (request, reply) => {
    const requestId = requestIdFor(request, generateId);
    const now = requestNow(clock);
    try {
      const session = await options.access.login(
        buildLoginCommand(SessionLoginRequestV1Schema.parse(request.body)),
      );
      const result = mapSessionResult(session);
      setSessionCookie(reply, session.sessionToken);
      return reply.code(200).type(HTTP_JSON_MEDIA_TYPE_V1).send(result);
    } catch (error) {
      return responseFailure(reply, mapHttpError({ error, requestId, now }));
    }
  });

  app.post("/api/v1/session/change-password", async (request, reply) => {
    const requestId = requestIdFor(request, generateId);
    const now = requestNow(clock);
    const token = cookieToken(request);
    const sessionError = sessionFailure(reply, token, requestId, now);
    if (sessionError !== undefined) return sessionError;
    try {
      const session = await options.access.changePassword(
        buildChangePasswordCommand(
          SessionChangePasswordRequestV1Schema.parse(request.body),
          token as string,
        ),
      );
      const result = mapSessionResult(session);
      setSessionCookie(reply, session.sessionToken);
      return reply.code(200).type(HTTP_JSON_MEDIA_TYPE_V1).send(result);
    } catch (error) {
      return responseFailure(reply, mapHttpError({ error, requestId, now }));
    }
  });

  /**
   * 当前会话自省：只从安全 Cookie 取会话，返回无 token 元数据。
   *
   * 无请求体、不接受客户端会话身份或 Authorization header；所有响应禁止缓存，
   * 也不返回 token 或下发新 Cookie。缺 Cookie 与失效会话都是 401 认证失败，
   * 畸形或重复 Cookie 是 400 契约失败，暂态与终态故障保留原技术错误信封。
   */
  app.get("/api/v1/session", async (request, reply) => {
    const requestId = requestIdFor(request, generateId);
    const now = requestNow(clock);
    reply.header("cache-control", "no-store");
    const token = cookieToken(request);
    const sessionError = sessionFailure(reply, token, requestId, now);
    if (sessionError !== undefined) return sessionError;
    try {
      const metadata = await options.access.readSession(buildReadSessionCommand(token as string));
      return reply.code(200).type(HTTP_JSON_MEDIA_TYPE_V1).send(mapSessionMetadata(metadata));
    } catch (error) {
      return responseFailure(reply, mapHttpError({ error, requestId, now }));
    }
  });

  app.post("/api/v1/session/logout", async (request, reply) => {
    const requestId = requestIdFor(request, generateId);
    const now = requestNow(clock);
    const token = cookieToken(request);
    const sessionError = sessionFailure(reply, token, requestId, now);
    if (sessionError !== undefined) return sessionError;
    try {
      const result = await options.access.logout(
        buildLogoutCommand(SessionLogoutRequestV1Schema.parse(request.body), token as string),
      );
      AccessCommandResultV1Schema.parse(result);
      setSessionCookie(reply, "", true);
      return reply.code(204).send();
    } catch (error) {
      return responseFailure(reply, mapHttpError({ error, requestId, now }));
    }
  });

  // 会话、自省与 openapi 已有各自的专用处理；这里只注册 C35 新增的四条系统面路由。
  for (const entry of activeHttpSystemRouteCatalog(ports).filter(
    (candidate) => candidate.activationPortKeys !== undefined,
  )) {
    const handler = (request: FastifyRequest, reply: FastifyReply) =>
      runSystem({
        entry,
        request,
        reply,
        options,
        ports,
        requestId: requestIdFor(request, generateId),
        now: requestNow(clock),
      });
    if (entry.method === "GET") app.get(entry.path, handler);
    else app.post(entry.path, handler);
  }

  for (const entry of activeHttpRouteCatalog(ports)) {
    app.post(entry.path, (request, reply) =>
      runBusiness({
        entry,
        request,
        reply,
        options,
        ports,
        requestId: requestIdFor(request, generateId),
        now: requestNow(clock),
      }),
    );
  }

  const projection = ports.projection;
  if (projection !== undefined) {
    app.get("/api/v1/projects/:projectId/runs/:runId/events", async (request, reply) => {
      const requestId = requestIdFor(request, generateId);
      const now = requestNow(clock);
      try {
        const projectId = pathProjectId(request);
        const query = SseQueryRequestV1Schema.parse(request.query);
        const headerCursor = lastEventId(request);
        if (headerCursor === "") throw new HttpTransportError(invalidRequest(requestId, now));
        if (
          headerCursor !== undefined &&
          query.afterEventId !== undefined &&
          headerCursor !== query.afterEventId
        )
          throw new HttpTransportError(invalidRequest(requestId, now));
        const initialAfterEventId = headerCursor ?? query.afterEventId;
        const runRef = pathRunRef(request);
        const token = cookieToken(request);
        const sessionError = sessionFailure(reply, token, requestId, now);
        if (sessionError !== undefined) return sessionError;
        const controller = new AbortController();
        activeSseControllers.add(controller);
        const onAborted = (): void => controller.abort();
        request.raw.on("aborted", onAborted);
        try {
          await serveSse({
            raw: reply.raw,
            signal: controller.signal,
            workflowRunRef: runRef,
            ...(initialAfterEventId === undefined ? {} : { initialAfterEventId }),
            policy: ssePolicy,
            now: clock,
            authorize: async (): Promise<AuthorizationContextV1> => {
              const currentToken = cookieToken(request);
              if (currentToken === null)
                throw new HttpTransportError(invalidRequest(requestId, requestNow(clock)));
              if (currentToken === undefined)
                throw new HttpTransportError(authenticationRequired(requestId, requestNow(clock)));
              const decision = await authorize({
                access: options.access,
                invocationId: requestId,
                projectId,
                branch: "projection.subscribe",
                sessionToken: currentToken,
                requestedSpatialScopeRefs: [],
                requestedSourceVersionRefs: [],
                requestedAt: requestNow(clock).toISOString(),
              });
              if (
                decision.context.projectId !== projectId ||
                !decision.context.grantedCapabilities.includes("projection.subscribe")
              ) {
                throw new HttpTransportError(notFound(requestId, requestNow(clock)));
              }
              return decision.context;
            },
            subscribe: async (context) => {
              const queryRequest = RunSubscriptionRequestV1Schema.parse({
                queryId: requestId,
                projectId,
                actorId: context.authorization.actorId,
                requestedAt: requestNow(clock).toISOString(),
                authorization: context.authorization,
                kind: "subscribe",
                payload: {
                  workflowRunRef: context.workflowRunRef,
                  ...(context.afterEventId === undefined
                    ? {}
                    : { afterEventId: context.afterEventId }),
                },
              });
              return projection.subscribe(queryRequest);
            },
            toError: (error) => {
              const failure = mapHttpError({ error, requestId, now: requestNow(clock) });
              markAccessLogFailure(reply, failure.error.code);
              return failure;
            },
            open: () => {
              reply.raw.statusCode = 200;
              reply.raw.setHeader("content-type", `${HTTP_SSE_MEDIA_TYPE_V1}; charset=utf-8`);
              reply.raw.setHeader("cache-control", "no-cache, no-transform");
              reply.raw.setHeader("connection", "keep-alive");
              reply.raw.setHeader("x-accel-buffering", "no");
              reply.hijack();
            },
          });
          return reply;
        } finally {
          request.raw.off("aborted", onAborted);
          activeSseControllers.delete(controller);
        }
      } catch (error) {
        return responseFailure(reply, mapHttpError({ error, requestId, now }));
      }
    });
  }

  app.get("/api/v1/openapi.json", async (_request, reply) =>
    reply
      .code(200)
      .type(HTTP_JSON_MEDIA_TYPE_V1)
      .send(buildOpenApiDocument(httpCatalogForOpenApi(ports))),
  );
  app.addHook("onClose", async () => {
    for (const controller of activeSseControllers) controller.abort();
    activeSseControllers.clear();
  });
  return app;
};
