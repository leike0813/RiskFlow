/**
 * demo 会话操作：登录/改密/登出经既有 session 路由，自省走无请求体的 GET。
 * cookie 由浏览器自动携带，前端不读写 token。
 */
import { ApiError, getRaw, postRaw } from "./client";

export interface SessionMetadata {
  readonly accountRef: { readonly entityId: string; readonly versionId: string };
  readonly sessionRef: { readonly entityId: string; readonly versionId: string };
  readonly passwordChangeRequired: boolean;
  readonly restricted: boolean;
  readonly expiresAt: string;
}

type SessionReference = SessionMetadata["sessionRef"];

export const sessionReturnTarget = (value: string | null): string =>
  value !== null && /^\/(?![\\/])/.test(value) ? value : "/";

const recordOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const decodeReference = (value: unknown): SessionReference | null => {
  const record = recordOf(value);
  if (
    record === null ||
    Object.keys(record).length !== 2 ||
    typeof record.entityId !== "string" ||
    record.entityId.trim() === "" ||
    typeof record.versionId !== "string" ||
    record.versionId.trim() === ""
  )
    return null;
  return { entityId: record.entityId.trim(), versionId: record.versionId.trim() };
};

const isIsoDateTime = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
      value,
    );
  if (parts === null || Number.isNaN(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const local = new Date(0);
  local.setUTCFullYear(year!, month! - 1, day!);
  local.setUTCHours(hour!, minute!, second!, Number((parts[7] ?? "").padEnd(3, "0").slice(0, 3)));
  return (
    local.getUTCFullYear() === year &&
    local.getUTCMonth() === month! - 1 &&
    local.getUTCDate() === day &&
    hour! <= 23 &&
    minute! <= 59 &&
    second! <= 59
  );
};

const decodeSession = (body: unknown): SessionMetadata => {
  const record = recordOf(body);
  if (record === null) throw new ApiError("TERMINAL_FAILURE");
  const accountRef = decodeReference(record.accountRef);
  const sessionRef = decodeReference(record.sessionRef);
  const allowedKeys = new Set([
    "schemaVersion",
    "accountRef",
    "sessionRef",
    "passwordChangeRequired",
    "restricted",
    "expiresAt",
    "systemAdministrationContextRef",
  ]);
  const administrationRef = recordOf(record.systemAdministrationContextRef);
  if (
    record.schemaVersion !== "1" ||
    Object.keys(record).some((key) => !allowedKeys.has(key)) ||
    accountRef === null ||
    sessionRef === null ||
    typeof record.passwordChangeRequired !== "boolean" ||
    typeof record.restricted !== "boolean" ||
    typeof record.expiresAt !== "string" ||
    !isIsoDateTime(record.expiresAt) ||
    (record.systemAdministrationContextRef !== undefined &&
      (administrationRef === null ||
        Object.keys(administrationRef).length !== 2 ||
        administrationRef.kind !== "authorization-context" ||
        decodeReference(administrationRef.reference) === null))
  ) {
    throw new ApiError("TERMINAL_FAILURE");
  }
  return {
    accountRef,
    sessionRef,
    passwordChangeRequired: record.passwordChangeRequired,
    restricted: record.restricted,
    expiresAt: record.expiresAt,
  };
};

export const login = async (
  input: {
    readonly loginName: string;
    readonly password: string;
  },
  signal?: AbortSignal,
): Promise<SessionMetadata> =>
  decodeSession(
    await postRaw({
      path: "/api/v1/session/login",
      ...(signal === undefined ? {} : { signal }),
      body: {
        schemaVersion: "1",
        loginAttemptId: `demo-login-${Date.now().toString(36)}`,
        loginName: input.loginName,
        password: input.password,
      },
    }),
  );

export const changePassword = async (
  input: {
    readonly newPassword: string;
  },
  signal?: AbortSignal,
): Promise<SessionMetadata> =>
  decodeSession(
    await postRaw({
      path: "/api/v1/session/change-password",
      body: { schemaVersion: "1", newPassword: input.newPassword },
      ...(signal === undefined ? {} : { signal }),
    }),
  );

export const logout = async (signal?: AbortSignal): Promise<void> => {
  try {
    await postRaw({
      path: "/api/v1/session/logout",
      body: { schemaVersion: "1" },
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    // 401 表示服务端已确认当前会话失效；只有技术失败才应保留原会话供重试。
    if (error instanceof ApiError && error.code === "AUTHENTICATION_REQUIRED") return;
    throw error;
  }
};

/**
 * 当前会话自省。
 *
 * 只有「确认没有有效会话」（401）才算匿名：网络、契约与服务端故障一律按可重试失败上抛，
 * 绝不把一次技术故障降级成未登录。
 */
export const currentSession = async (signal?: AbortSignal): Promise<SessionMetadata | null> => {
  let body: unknown;
  try {
    body = await getRaw({ path: "/api/v1/session", ...(signal === undefined ? {} : { signal }) });
  } catch (error) {
    if (error instanceof ApiError && error.code === "AUTHENTICATION_REQUIRED") return null;
    throw error;
  }
  return decodeSession(body);
};
