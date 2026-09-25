/**
 * demo 会话操作：登录/登出经既有 session 路由，cookie 由浏览器自动携带，前端不读写 token。
 */
import { ApiError, postRaw } from './client'

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

export const logout = async (): Promise<void> => {
  await postRaw({ path: '/api/v1/session/logout', body: { schemaVersion: '1' } })
}
