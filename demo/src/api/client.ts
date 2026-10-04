/**
 * demo 最小 HTTP 客户端：按 apps/api 传输契约形状手写（demo 是独立 npm 项目，不跨包引用）。
 * 查询一律 POST /api/v1/projects/:projectId/queries/:branch，
 * 命令一律 POST /api/v1/projects/:projectId/commands/:branch，会话经同源 cookie 由浏览器携带。
 */

export type ApiErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'CONTRACT_INVALID'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'UNSUPPORTED_CONTRACT'
  | 'TRANSIENT_FAILURE'
  | 'TERMINAL_FAILURE'

/** 脱敏错误：只保留可对用户呈现的结构化字段，不带服务端文案与堆栈。 */
export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly retryable: boolean
  readonly requestId: string | null

  constructor(code: ApiErrorCode, options: { retryable?: boolean; requestId?: string | null } = {}) {
    super(code)
    this.name = 'ApiError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.requestId = options.requestId ?? null
  }
}

const STATUS_CODE_MAP: Record<number, ApiErrorCode> = {
  400: 'CONTRACT_INVALID',
  401: 'AUTHENTICATION_REQUIRED',
  403: 'NOT_FOUND',
  404: 'NOT_FOUND',
  409: 'IDEMPOTENCY_CONFLICT',
  413: 'REQUEST_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'CONTRACT_INVALID',
  426: 'UNSUPPORTED_CONTRACT',
  503: 'TRANSIENT_FAILURE',
}

const KNOWN_CODES: readonly string[] = [
  'AUTHENTICATION_REQUIRED',
  'CONTRACT_INVALID',
  'NOT_FOUND',
  'IDEMPOTENCY_CONFLICT',
  'REQUEST_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNSUPPORTED_CONTRACT',
  'TRANSIENT_FAILURE',
  'TERMINAL_FAILURE',
  'PASSWORD_CHANGE_REQUIRED',
  'STALE_VERSION',
  'BUSINESS_BLOCKED',
]

const decodeErrorBody = (body: unknown): { code?: string; requestId?: string } => {
  if (typeof body !== 'object' || body === null) return {}
  const record = body as Record<string, unknown>
  return {
    code: typeof record.code === 'string' ? record.code : undefined,
    requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
  }
}

const toApiError = (status: number, body: unknown): ApiError => {
  const decoded = decodeErrorBody(body)
  const code =
    decoded.code !== undefined && KNOWN_CODES.includes(decoded.code)
      ? (decoded.code as ApiErrorCode)
      : (STATUS_CODE_MAP[status] ?? 'TERMINAL_FAILURE')
  return new ApiError(code, {
    retryable: code === 'TRANSIENT_FAILURE',
    requestId: decoded.requestId ?? null,
  })
}

interface RawRequest {
  readonly path: string
  readonly body: Record<string, unknown>
  readonly signal?: AbortSignal
}

/**
 * 原始 GET：无请求体的只读调用（当前只有会话自省）。与 POST 共用同一套失败收敛，
 * 网络异常同样归一为瞬时故障。
 */
export const getRaw = async (request: {
  readonly path: string
  readonly signal?: AbortSignal
}): Promise<unknown> => {
  let response: Response
  try {
    response = await fetch(request.path, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: request.signal ?? null,
      headers: { accept: 'application/json' },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('TRANSIENT_FAILURE', { retryable: true })
  }
  const text = await response.text()
  let body: unknown = null
  if (text.length > 0) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }
  if (!response.ok) throw toApiError(response.status, body)
  return body
}

/** 原始 POST：返回 2xx 的 JSON body；失败统一收敛为 ApiError；网络异常归一为瞬时故障。 */
export const postRaw = async (request: RawRequest): Promise<unknown> => {
  let response: Response
  try {
    response = await fetch(request.path, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: request.signal ?? null,
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(request.body),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('TRANSIENT_FAILURE', { retryable: true })
  }
  const text = await response.text()
  let body: unknown = null
  if (text.length > 0) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }
  if (!response.ok) throw toApiError(response.status, body)
  return body
}

let querySequence = 0

/** 查询标识只用于审计关联，不承载业务语义。 */
export const nextQueryId = (projectId: string, branch: string): string => {
  querySequence += 1
  return `demo-${branch}-${projectId}-${Date.now().toString(36)}-${querySequence}`
}

export interface QueryEnvelope {
  readonly schemaVersion: '1'
  readonly queryId: string
  readonly requestedAt: string
  readonly requestedSpatialScopeRefs: readonly unknown[]
  readonly requestedSourceVersionRefs: readonly unknown[]
  readonly payload: Record<string, unknown>
}

/** 查询传输信封：projectId 只走路径，不进 body；触达资料正文的查询必须声明来源版本。 */
export const postQuery = async (input: {
  readonly projectId: string
  readonly branch: string
  readonly payload: Record<string, unknown>
  readonly sourceVersionRefs?: readonly unknown[]
  readonly signal?: AbortSignal
}): Promise<unknown> => {
  if (input.projectId.includes('/') || input.projectId.includes('\\')) {
    throw new ApiError('CONTRACT_INVALID')
  }
  const envelope: QueryEnvelope = {
    schemaVersion: '1',
    queryId: nextQueryId(input.projectId, input.branch),
    requestedAt: new Date().toISOString(),
    requestedSpatialScopeRefs: [],
    requestedSourceVersionRefs: [...(input.sourceVersionRefs ?? [])],
    payload: input.payload,
  }
  const body = await postRaw({
    path: `/api/v1/projects/${encodeURIComponent(input.projectId)}/queries/${input.branch}`,
    body: envelope as unknown as Record<string, unknown>,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
  return body
}

/** 查询成功应答：剥离 moduleResult 信封，只留 result；failed 由 HTTP 层错误表达。 */
export const unwrapQueryResult = (body: unknown): unknown => {
  if (typeof body !== 'object' || body === null) throw new ApiError('TERMINAL_FAILURE')
  const record = body as Record<string, unknown>
  if (record.kind !== 'succeeded' || !('result' in record)) {
    throw new ApiError('TERMINAL_FAILURE')
  }
  return record.result
}

/** 提交只读查询并返回业务结果载荷。 */
export const submitQuery = async (input: {
  readonly projectId: string
  readonly branch: string
  readonly payload: Record<string, unknown>
  readonly sourceVersionRefs?: readonly unknown[]
  readonly signal?: AbortSignal
}): Promise<unknown> => unwrapQueryResult(await postQuery(input))

let commandSequence = 0

/** 命令标识即幂等键：同一 commandId 重放同一命令，不重复产生业务事实。 */
export const nextCommandId = (projectId: string, branch: string): string => {
  commandSequence += 1
  return `demo-${branch}-${projectId}-${Date.now().toString(36)}-${commandSequence}`
}

export interface CommandEnvelope {
  readonly schemaVersion: '1'
  readonly commandId: string
  readonly idempotencyKey: string
  readonly issuedAt: string
  readonly requestedSpatialScopeRefs: readonly unknown[]
  readonly requestedSourceVersionRefs: readonly unknown[]
  readonly payload: Record<string, unknown>
}

/** 稳定摘要：键按字典序排列，使对象字面量写法差异不影响同一 payload 的判定。 */
const canonicalPayloadDigest = (payload: Record<string, unknown>): string => {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize)
    if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>
      const sorted: Record<string, unknown> = {}
      for (const key of Object.keys(record).sort()) sorted[key] = normalize(record[key])
      return sorted
    }
    return value
  }
  return JSON.stringify(normalize(payload))
}

/**
 * 冻结信封登记：同一 `commandId` 的重试逐字节复用首次冻结的请求。
 *
 * D-07 要求动作确认冻结整个信封（含 `issuedAt`/`commandId`/`idempotencyKey`/空间/来源），
 * 网络异常后的重试必须原样重发。只保留 commandId 再刷新时间会被服务端按同键异载荷拒绝——
 * 绑定摘要本来就包含 `issuedAt`，那是设计要求，不是缺陷。
 *
 * payload 变了就换身份：登记项摘要不匹配时废弃旧信封重新冻结，调用方同时应给出新的
 * `commandId`（页面把目标引用的 entityId/versionId 编进了 commandId，引用变化自然换身份）。
 */
const frozenCommands = new Map<string, { readonly digest: string; readonly envelope: CommandEnvelope }>()

/** 登记项上限：只服务同一次确认的即时重试，不承担长期重放记忆。 */
const FROZEN_COMMAND_LIMIT_V1 = 200

const freezeCommandEnvelope = (input: {
  readonly projectId: string
  readonly branch: string
  readonly commandId: string
  readonly payload: Record<string, unknown>
  readonly spatialScopeRefs: readonly unknown[]
  readonly sourceVersionRefs: readonly unknown[]
}): CommandEnvelope => {
  const key = `${input.projectId}|${input.branch}|${input.commandId}`
  const digest = canonicalPayloadDigest({
    payload: input.payload,
    requestedSpatialScopeRefs: input.spatialScopeRefs,
    requestedSourceVersionRefs: input.sourceVersionRefs,
  })
  const frozen = frozenCommands.get(key)
  if (frozen !== undefined && frozen.digest === digest) return frozen.envelope
  if (frozenCommands.size >= FROZEN_COMMAND_LIMIT_V1) {
    const oldest = frozenCommands.keys().next()
    if (!oldest.done) frozenCommands.delete(oldest.value)
  }
  const envelope: CommandEnvelope = {
    schemaVersion: '1',
    commandId: input.commandId,
    idempotencyKey: input.commandId,
    issuedAt: new Date().toISOString(),
    requestedSpatialScopeRefs: input.spatialScopeRefs,
    requestedSourceVersionRefs: input.sourceVersionRefs,
    payload: input.payload,
  }
  frozenCommands.set(key, { digest, envelope })
  return envelope
}

/**
 * 丢弃某条命令的冻结信封：目标引用发生变化时，调用方重新确认并取得新身份。
 * 陈旧版本必须刷新后再次确认，不在这里自动改引用。
 */
export const discardFrozenCommand = (projectId: string, branch: string, commandId: string): void => {
  frozenCommands.delete(`${projectId}|${branch}|${commandId}`)
}

/** 命令传输信封：与 postQuery 同一脱敏/取消语义；commandId 由调用方传入以支持重放，缺省生成。 */
export const postCommand = async (input: {
  readonly projectId: string
  readonly branch: string
  readonly payload: Record<string, unknown>
  readonly commandId?: string
  readonly spatialScopeRefs?: readonly unknown[]
  readonly sourceVersionRefs?: readonly unknown[]
  readonly signal?: AbortSignal
}): Promise<unknown> => {
  if (input.projectId.includes('/') || input.projectId.includes('\\')) {
    throw new ApiError('CONTRACT_INVALID')
  }
  const commandId = input.commandId ?? nextCommandId(input.projectId, input.branch)
  const envelope = freezeCommandEnvelope({
    projectId: input.projectId,
    branch: input.branch,
    commandId,
    payload: input.payload,
    spatialScopeRefs: input.spatialScopeRefs ?? [],
    sourceVersionRefs: input.sourceVersionRefs ?? [],
  })
  return postRaw({
    path: `/api/v1/projects/${encodeURIComponent(input.projectId)}/commands/${input.branch}`,
    body: envelope as unknown as Record<string, unknown>,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
}

/** 提交命令并返回业务结果载荷（与查询同一 moduleResult 剥离语义）。 */
export const submitCommand = async (input: {
  readonly projectId: string
  readonly branch: string
  readonly payload: Record<string, unknown>
  readonly commandId?: string
  readonly spatialScopeRefs?: readonly unknown[]
  readonly sourceVersionRefs?: readonly unknown[]
  readonly signal?: AbortSignal
}): Promise<unknown> => unwrapQueryResult(await postCommand(input))
