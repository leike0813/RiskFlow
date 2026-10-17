import { C09HttpError, HTTP_JSON_MEDIA_TYPE_V1, makeSafeHttpError, type C09Fetch } from "./http.js";
import type { HttpErrorCodeV1 } from "./errors.js";

/**
 * 迁入页面按语义给出错误码，这里做一次受控收敛：
 * 未知码一律降为 TERMINAL_FAILURE，不把任意字符串塞进契约。
 */
const safeErrorCode = (code: string): HttpErrorCodeV1 => {
  const known: readonly string[] = [
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
  ];
  return known.includes(code) ? (code as HttpErrorCodeV1) : "TERMINAL_FAILURE";
};

/** 受控收敛错误码：未知码一律降为 TERMINAL_FAILURE。 */
export const clientErrorCode = (code: string): HttpErrorCodeV1 => safeErrorCode(code);

/** 按错误码构造客户端错误；页面据此区分无权、可重试与终止。 */
export const clientError = (code: string, retryable = false): C09HttpError =>
  new C09HttpError(makeSafeHttpError({ code: safeErrorCode(code), retryable }));

/**
 * C37 D-17：迁入业务 operation 的**唯一传输接缝**。
 *
 * 这里的每个函数都建立在同一 fetch 语义与同一个 `C09HttpError` 上：
 * 同源凭据、`no-store` 缓存、JSON 媒体类型、统一的错误解码。
 * 不再保留第二套 HTTP 实现或第二套错误模型——页面只经
 * `api/http.ts#createC09Client` 与本适配层通信。
 */

export { C09HttpError };

export interface QueryEnvelope {
  readonly schemaVersion: "1";
  readonly queryId: string;
  readonly requestedAt: string;
  readonly requestedSpatialScopeRefs: readonly unknown[];
  readonly requestedSourceVersionRefs: readonly unknown[];
  readonly payload: Record<string, unknown>;
}

export interface AssessmentSourceSelection {
  readonly projectId: string;
  readonly revisionId: string | null;
  readonly refs: readonly { readonly entityId: string; readonly versionId: string }[];
}

/**
 * 来源由用户明确声明；工程或修订不匹配时不继承旧选择。
 * 解析失败一律返回 null，不回退到其它工程的选择。
 */
export const readAssessmentSourceSelection = (search: string): AssessmentSourceSelection | null => {
  const params = new URLSearchParams(search);
  const serialized = params.get("assessmentSources");
  if (serialized === null) return null;
  try {
    const selection = JSON.parse(serialized) as AssessmentSourceSelection;
    const revision = params.get("revision");
    const revisionId = revision?.includes("@") ? revision.split("@")[1] : revision;
    if (
      selection.projectId !== params.get("project") ||
      selection.revisionId !== revisionId ||
      !Array.isArray(selection.refs) ||
      selection.refs.length === 0 ||
      selection.refs.length > 256 ||
      selection.refs.some(
        (ref) =>
          ref === null ||
          typeof ref !== "object" ||
          typeof ref.entityId !== "string" ||
          ref.entityId.trim() === "" ||
          typeof ref.versionId !== "string" ||
          ref.versionId.trim() === "",
      )
    ) {
      return null;
    }
    return selection;
  } catch {
    return null;
  }
};

const selectedAssessmentSources = (projectId: string) => {
  if (typeof window === "undefined") return [];
  const selection = readAssessmentSourceSelection(window.location.search);
  return selection?.projectId === projectId
    ? selection.refs.map((reference) => ({ kind: "source-version" as const, reference }))
    : [];
};

/** projectId 只进路径；含分隔符一律拒绝，避免路径穿越。 */
const assertProjectId = (projectId: string): void => {
  if (projectId.includes("/") || projectId.includes("\\")) {
    throw new C09HttpError(makeSafeHttpError({ code: "CONTRACT_INVALID" }));
  }
};

let querySequence = 0;
let commandSequence = 0;

/** 查询标识只用于审计关联，不承载业务语义。 */
export const nextQueryId = (projectId: string, branch: string): string => {
  querySequence += 1;
  return `web-${branch}-${projectId}-${Date.now().toString(36)}-${querySequence}`;
};

/** 命令标识即幂等键：同一 commandId 重放同一命令，不重复产生业务事实。 */
export const nextCommandId = (projectId: string, branch: string): string => {
  commandSequence += 1;
  return `web-${branch}-${projectId}-${Date.now().toString(36)}-${commandSequence}`;
};

const readJsonBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const STATUS_CODE_FALLBACK = {
  400: "CONTRACT_INVALID",
  401: "AUTHENTICATION_REQUIRED",
  403: "NOT_FOUND",
  404: "NOT_FOUND",
  409: "IDEMPOTENCY_CONFLICT",
  413: "REQUEST_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "CONTRACT_INVALID",
  426: "UNSUPPORTED_CONTRACT",
  503: "TRANSIENT_FAILURE",
} as const;

const errorCodeFor = (status: number, body: unknown): string => {
  if (typeof body === "object" && body !== null && "error" in body) {
    const inner = (body as { error: unknown }).error;
    if (typeof inner === "object" && inner !== null && "code" in inner) {
      const code = (inner as { code: unknown }).code;
      if (typeof code === "string") return code;
    }
  }
  const fallback = STATUS_CODE_FALLBACK[status as keyof typeof STATUS_CODE_FALLBACK];
  return fallback ?? (status >= 500 ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE");
};

const requestJson = async (input: {
  readonly fetcher: C09Fetch;
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly body?: unknown;
  readonly signal: AbortSignal;
}): Promise<unknown> => {
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
  const body = await readJsonBody(response);
  if (!response.ok) {
    const code = errorCodeFor(response.status, body);
    throw new C09HttpError(
      makeSafeHttpError({
        code: safeErrorCode(code),
        retryable: code === "TRANSIENT_FAILURE",
      }),
    );
  }
  return body;
};

const liveFetcher: C09Fetch = (input, init) => fetch(input, init);

export const sourceOriginalPath = (
  projectId: string,
  sourceId: string,
  versionId: string,
): string => {
  for (const value of [projectId, sourceId, versionId]) assertProjectId(value);
  return `/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}/versions/${encodeURIComponent(versionId)}/original`;
};

export const readSourceOriginalBytes = async (input: {
  readonly projectId: string;
  readonly sourceId: string;
  readonly versionId: string;
  readonly signal: AbortSignal;
  readonly fetcher?: C09Fetch;
}): Promise<Blob> => {
  let response: Response;
  try {
    response = await (input.fetcher ?? liveFetcher)(
      sourceOriginalPath(input.projectId, input.sourceId, input.versionId),
      {
        credentials: "same-origin",
        cache: "no-store",
        signal: input.signal,
      },
    );
  } catch (error) {
    if (input.signal.aborted) throw error;
    throw clientError("TRANSIENT_FAILURE", true);
  }
  if (!response.ok)
    throw clientError(
      errorCodeFor(response.status, await readJsonBody(response)),
      response.status === 503,
    );
  return response.blob();
};

export const getRaw = async (request: {
  readonly path: string;
  readonly signal?: AbortSignal;
  readonly fetcher?: C09Fetch;
}): Promise<unknown> =>
  requestJson({
    fetcher: request.fetcher ?? liveFetcher,
    path: request.path,
    method: "GET",
    signal: request.signal ?? new AbortController().signal,
  });

export const postRaw = async (request: {
  readonly path: string;
  readonly body: unknown;
  readonly signal?: AbortSignal;
  readonly fetcher?: C09Fetch;
}): Promise<unknown> =>
  requestJson({
    fetcher: request.fetcher ?? liveFetcher,
    path: request.path,
    method: "POST",
    body: request.body,
    signal: request.signal ?? new AbortController().signal,
  });

/** 查询传输信封：projectId 只走路径，不进 body；触达资料正文的查询必须声明来源版本。 */
export const postQuery = async (input: {
  readonly projectId: string;
  readonly branch: string;
  readonly payload: Record<string, unknown>;
  readonly sourceVersionRefs?: readonly unknown[];
  readonly signal?: AbortSignal;
}): Promise<unknown> => {
  assertProjectId(input.projectId);
  const envelope: QueryEnvelope = {
    schemaVersion: "1",
    queryId: nextQueryId(input.projectId, input.branch),
    requestedAt: new Date().toISOString(),
    requestedSpatialScopeRefs: [],
    requestedSourceVersionRefs: [
      ...(input.sourceVersionRefs ??
        (input.branch === "risk-assessment.read"
          ? selectedAssessmentSources(input.projectId)
          : [])),
    ],
    payload: input.payload,
  };
  return postRaw({
    path: `/api/v1/projects/${encodeURIComponent(input.projectId)}/queries/${input.branch}`,
    body: envelope as unknown as Record<string, unknown>,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
};

/** 查询成功应答：剥离 moduleResult 信封只留 result；形状不符收敛为 TERMINAL_FAILURE。 */
export const unwrapQueryResult = (body: unknown): unknown => {
  if (typeof body !== "object" || body === null) {
    throw new C09HttpError(makeSafeHttpError({ code: "TERMINAL_FAILURE" }));
  }
  const record = body as Record<string, unknown>;
  if (record.kind !== "succeeded" || !("result" in record)) {
    throw new C09HttpError(makeSafeHttpError({ code: "TERMINAL_FAILURE" }));
  }
  return record.result;
};

export const submitQuery = async (input: {
  readonly projectId: string;
  readonly branch: string;
  readonly payload: Record<string, unknown>;
  readonly sourceVersionRefs?: readonly unknown[];
  readonly signal?: AbortSignal;
}): Promise<unknown> => unwrapQueryResult(await postQuery(input));

export interface CommandEnvelope {
  readonly schemaVersion: "1";
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
  readonly requestedSpatialScopeRefs: readonly unknown[];
  readonly requestedSourceVersionRefs: readonly unknown[];
  readonly payload: Record<string, unknown>;
}

/** 稳定摘要：键按字典序排列，使对象字面量写法差异不影响同一 payload 的判定。 */
const canonicalPayloadDigest = (payload: Record<string, unknown>): string => {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort()) sorted[key] = normalize(record[key]);
      return sorted;
    }
    return value;
  };
  return JSON.stringify(normalize(payload));
};

/**
 * 冻结信封登记：同一 `commandId` 的重试逐字节复用首次冻结的请求。
 *
 * D-07 要求动作确认冻结整个信封（含 `issuedAt`/`commandId`/`idempotencyKey`/空间/来源），
 * 网络异常后的重试必须原样重发；只保留 commandId 再刷新时间会被服务端按同键异载荷拒绝。
 */
const frozenCommands = new Map<
  string,
  { readonly digest: string; readonly envelope: CommandEnvelope }
>();

/** 登记项上限：只服务同一次确认的即时重试，不承担长期重放记忆。 */
const FROZEN_COMMAND_LIMIT_V1 = 200;

const freezeCommandEnvelope = (input: {
  readonly projectId: string;
  readonly branch: string;
  readonly commandId: string;
  readonly payload: Record<string, unknown>;
  readonly spatialScopeRefs: readonly unknown[];
  readonly sourceVersionRefs: readonly unknown[];
}): CommandEnvelope => {
  const key = `${input.projectId}|${input.branch}|${input.commandId}`;
  const digest = canonicalPayloadDigest({
    payload: input.payload,
    requestedSpatialScopeRefs: input.spatialScopeRefs,
    requestedSourceVersionRefs: input.sourceVersionRefs,
  });
  const frozen = frozenCommands.get(key);
  if (frozen !== undefined && frozen.digest === digest) return frozen.envelope;
  if (frozenCommands.size >= FROZEN_COMMAND_LIMIT_V1) {
    const oldest = frozenCommands.keys().next();
    if (!oldest.done) frozenCommands.delete(oldest.value);
  }
  const envelope: CommandEnvelope = {
    schemaVersion: "1",
    commandId: input.commandId,
    // 命令标识即幂等键：同一 commandId 重放同一命令，不重复产生业务事实。
    idempotencyKey: input.commandId,
    issuedAt: new Date().toISOString(),
    requestedSpatialScopeRefs: input.spatialScopeRefs,
    requestedSourceVersionRefs: input.sourceVersionRefs,
    payload: input.payload,
  };
  frozenCommands.set(key, { digest, envelope });
  return envelope;
};

/**
 * 丢弃某条命令的冻结信封：目标引用变化时调用方重新确认并取得新身份。
 * 陈旧版本必须刷新后再次确认，不在这里自动改引用。
 */
export const discardFrozenCommand = (
  projectId: string,
  branch: string,
  commandId: string,
): void => {
  frozenCommands.delete(`${projectId}|${branch}|${commandId}`);
};

export const postCommand = async (input: {
  readonly projectId: string;
  readonly branch: string;
  readonly payload: Record<string, unknown>;
  readonly commandId?: string;
  readonly spatialScopeRefs?: readonly unknown[];
  readonly sourceVersionRefs?: readonly unknown[];
  readonly signal?: AbortSignal;
}): Promise<unknown> => {
  assertProjectId(input.projectId);
  const envelope = freezeCommandEnvelope({
    projectId: input.projectId,
    branch: input.branch,
    commandId: input.commandId ?? nextCommandId(input.projectId, input.branch),
    payload: input.payload,
    spatialScopeRefs: [...(input.spatialScopeRefs ?? [])],
    sourceVersionRefs: [
      ...(input.sourceVersionRefs ??
        (input.branch === "workflow.start-run" ? selectedAssessmentSources(input.projectId) : [])),
    ],
  });
  return postRaw({
    path: `/api/v1/projects/${encodeURIComponent(input.projectId)}/commands/${input.branch}`,
    body: envelope as unknown as Record<string, unknown>,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
};

export const submitCommand = async (input: {
  readonly projectId: string;
  readonly branch: string;
  readonly payload: Record<string, unknown>;
  readonly commandId?: string;
  readonly spatialScopeRefs?: readonly unknown[];
  readonly sourceVersionRefs?: readonly unknown[];
  readonly signal?: AbortSignal;
}): Promise<unknown> => unwrapQueryResult(await postCommand(input));
