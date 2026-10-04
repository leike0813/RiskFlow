/**
 * demo 会话操作：登录/改密/登出经既有 session 路由，自省走无请求体的 GET。
 * cookie 由浏览器自动携带，前端不读写 token。
 */
import { ApiError, getRaw, postRaw } from './client'

export interface SessionMetadata {
  readonly accountRef: { readonly entityId: string; readonly versionId: string }
  readonly sessionRef: { readonly entityId: string; readonly versionId: string }
  readonly passwordChangeRequired: boolean
  readonly restricted: boolean
  readonly expiresAt: string
}

const decodeSession = (body: unknown): SessionMetadata => {
  if (typeof body !== 'object' || body === null) throw new ApiError('TERMINAL_FAILURE')
  const record = body as Record<string, unknown>
  const accountRef = record.accountRef as Record<string, unknown> | undefined
  const sessionRef = record.sessionRef as Record<string, unknown> | undefined
  if (
    typeof accountRef?.entityId !== 'string' ||
    typeof accountRef?.versionId !== 'string' ||
    typeof sessionRef?.entityId !== 'string' ||
    typeof sessionRef?.versionId !== 'string' ||
    typeof record.expiresAt !== 'string'
  ) {
    throw new ApiError('TERMINAL_FAILURE')
  }
  return {
    accountRef: { entityId: accountRef.entityId, versionId: accountRef.versionId },
    sessionRef: { entityId: sessionRef.entityId, versionId: sessionRef.versionId },
    passwordChangeRequired: record.passwordChangeRequired === true,
    restricted: record.restricted === true,
    expiresAt: record.expiresAt,
  }
}

export const login = async (input: {
  readonly loginName: string
  readonly password: string
}): Promise<SessionMetadata> =>
  decodeSession(
    await postRaw({
      path: '/api/v1/session/login',
      body: {
        schemaVersion: '1',
        loginAttemptId: `demo-login-${Date.now().toString(36)}`,
        loginName: input.loginName,
        password: input.password,
      },
    }),
  )

export const changePassword = async (input: {
  readonly newPassword: string
}): Promise<SessionMetadata> =>
  decodeSession(
    await postRaw({
      path: '/api/v1/session/change-password',
      body: { schemaVersion: '1', newPassword: input.newPassword },
    }),
  )

export const logout = async (): Promise<void> => {
  await postRaw({ path: '/api/v1/session/logout', body: { schemaVersion: '1' } })
}

/**
 * 当前会话自省。
 *
 * 只有「确认没有有效会话」（401）才算匿名：网络、契约与服务端故障一律按可重试失败上抛，
 * 绝不把一次技术故障降级成未登录。
 */
export const currentSession = async (signal?: AbortSignal): Promise<SessionMetadata | null> => {
  let body: unknown
  try {
    body = await getRaw({ path: '/api/v1/session', ...(signal === undefined ? {} : { signal }) })
  } catch (error) {
    if (error instanceof ApiError && error.code === 'AUTHENTICATION_REQUIRED') return null
    throw error
  }
  return decodeSession(body)
}
