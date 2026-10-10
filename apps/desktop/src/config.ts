import { z } from "zod";

/**
 * C37 D-14：桌面配置的唯一入口。
 *
 * 配置由安装者受控写入，只含批准的业务 HTTPS origin 与兼容范围；
 * 不含任何服务器秘密、会话密钥或数据库凭据，也不允许网页或自由 CLI 覆盖 origin。
 */

export const DESKTOP_CONFIG_SCHEMA_VERSION_V1 = 1;

/**
 * 桌面配置 Schema。
 *
 * origin 必须是纯 HTTPS origin：无路径、无用户信息、无 query、无 fragment。
 * 该约束保证客户端只会加载业务入口，不会把 origin 当成任意 URL 打开。
 */
export const DesktopConfigV1Schema = z.strictObject({
  schemaVersion: z.literal(DESKTOP_CONFIG_SCHEMA_VERSION_V1),
  deploymentId: z.string().min(1).max(120),
  publicOrigin: z
    .string()
    .regex(
      /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?$/,
      "publicOrigin must be a bare https origin without path, credentials, query or fragment",
    ),
  serverCompatibilityRange: z.strictObject({
    minServerReleaseId: z.string().min(1).max(120),
    maxServerReleaseId: z.string().min(1).max(120),
  }),
});

export type DesktopConfigV1 = z.infer<typeof DesktopConfigV1Schema>;

export const DESKTOP_CONFIG_ERROR_V1 = {
  malformed: "DESKTOP_CONFIG_MALFORMED",
  originNotHttps: "DESKTOP_CONFIG_ORIGIN_NOT_HTTPS",
} as const;
export type DesktopConfigErrorCodeV1 =
  (typeof DESKTOP_CONFIG_ERROR_V1)[keyof typeof DESKTOP_CONFIG_ERROR_V1];

export class DesktopConfigError extends Error {
  readonly code: DesktopConfigErrorCodeV1;

  constructor(code: DesktopConfigErrorCodeV1) {
    super(code);
    this.name = "DesktopConfigError";
    this.code = code;
  }
}

/** 解析并校验桌面配置；失败一律抛出稳定类别，不回落到默认 origin。 */
export const parseDesktopConfigV1 = (raw: unknown): DesktopConfigV1 => {
  if (typeof raw !== "object" || raw === null) {
    throw new DesktopConfigError(DESKTOP_CONFIG_ERROR_V1.malformed);
  }
  const candidate = raw as { publicOrigin?: unknown };
  if (
    typeof candidate.publicOrigin === "string" &&
    !candidate.publicOrigin.startsWith("https://")
  ) {
    throw new DesktopConfigError(DESKTOP_CONFIG_ERROR_V1.originNotHttps);
  }
  const parsed = DesktopConfigV1Schema.safeParse(raw);
  if (!parsed.success) {
    throw new DesktopConfigError(DESKTOP_CONFIG_ERROR_V1.malformed);
  }
  return Object.freeze(parsed.data);
};

/** 校验目标是否落在批准 origin 内；带路径的同源地址返回其 origin。 */
export const isApprovedOriginV1 = (
  config: DesktopConfigV1,
  target: string,
): { readonly approved: boolean; readonly origin: string } => {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { approved: false, origin: config.publicOrigin };
  }
  if (url.protocol !== "https:") return { approved: false, origin: config.publicOrigin };
  const origin = `${url.protocol}//${url.host}`;
  return { approved: origin === config.publicOrigin, origin: config.publicOrigin };
};
