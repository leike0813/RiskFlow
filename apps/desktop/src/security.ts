import { isApprovedOriginV1, type DesktopConfigV1 } from "./config.js";

/**
 * C37 D-14：桌面运行期的导航、窗口与权限边界。
 *
 * 这里是纯判定逻辑，不依赖 Electron 运行时，因此可在单元测试里逐条验证；
 * `main.ts` 只负责把这些判定接到真实的 webContents 事件上。
 *
 * 不变量：
 * - 只加载批准 origin 的业务页面；其它协议、origin、端口一律拒绝；
 * - 不新建窗口，不跳外链；
 * - 不接受通用 IPC、Shell、数据库或任意文件访问；
 * - 证书错误一律失败，绝不降级到 HTTP 或忽略校验。
 */

export const DESKTOP_NAVIGATION_V1 = {
  ALLOW: "allow",
  DENY: "deny",
} as const;

export type DesktopNavigationDecisionV1 =
  { readonly kind: "allow" } | { readonly kind: "deny"; readonly reason: string };

/** 主框架导航：只允许批准 origin；子框架默认拒绝。 */
export const decideMainFrameNavigationV1 = (
  config: DesktopConfigV1,
  target: string,
): DesktopNavigationDecisionV1 => {
  const { approved, origin } = isApprovedOriginV1(config, target);
  return approved
    ? { kind: "allow" }
    : { kind: "deny", reason: `navigation-outside-approved-origin:${origin}` };
};

/** 子框架（iframe）一律拒绝：业务界面不需要内嵌第三方内容。 */
export const decideSubframeNavigationV1 = (): DesktopNavigationDecisionV1 => ({
  kind: "deny",
  reason: "subframe-navigation-not-permitted",
});

/** 新窗口一律拒绝：客户端不提供多窗口，也不把任意页面交给用户。 */
export const decideNewWindowV1 = (): DesktopNavigationDecisionV1 => ({
  kind: "deny",
  reason: "new-window-not-permitted",
});

/** 外链一律拒绝：不调用系统浏览器，不打开任意 scheme。 */
export const decideExternalOpenV1 = (): DesktopNavigationDecisionV1 => ({
  kind: "deny",
  reason: "external-open-not-permitted",
});

/** 权限请求一律拒绝：客户端不申请摄像头、麦克风、定位或通知以外的任何能力。 */
export const decidePermissionRequestV1 = (permission: string): DesktopNavigationDecisionV1 => ({
  kind: "deny",
  reason: `permission-not-granted:${permission}`,
});

/** CSP：禁止任意外域、unsafe-eval 与 Node 能力注入。 */
export const DESKTOP_CONTENT_SECURITY_POLICY_V1 = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

/** webPreferences：关闭 Node 集成，开启上下文隔离与沙箱，且不暴露 preload。 */
export const DESKTOP_WEB_PREFERENCES_V1 = Object.freeze({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
});

/** 证书错误一律拒绝：私有 CA 通过系统信任链部署，不豁免校验。 */
export const decideCertificateErrorV1 = (): DesktopNavigationDecisionV1 => ({
  kind: "deny",
  reason: "certificate-error-never-ignored",
});

/** 认证挑战不代填凭据：证书与代理认证交给系统信任链处理。 */
export const decideLoginChallengeV1 = (): DesktopNavigationDecisionV1 => ({
  kind: "deny",
  reason: "login-challenge-not-handled",
});

export type DesktopDownloadDecisionV1 =
  { readonly kind: "ask" } | { readonly kind: "deny"; readonly reason: string };

/** 已登记的资料原件下载路径：只认这一个精确路径，不接受任意同源地址。 */
const SOURCE_ORIGINAL_PATH_V1 =
  /^\/api\/v1\/projects\/[^/]+\/sources\/[^/]+\/versions\/[^/]+\/original$/;

/** 已登记的 report 用途入口：blob 报告只认这个页面。 */
const REGISTERED_REPORT_PATH_V1 = "/report/export";

/** 解析为批准 origin 内的 URL；非 https、外域、userinfo 或无法解析都返回 undefined。 */
const approvedUrlV1 = (config: DesktopConfigV1, target: string): URL | undefined => {
  if (!isApprovedOriginV1(config, target).approved) return undefined;
  try {
    return new URL(target);
  } catch {
    return undefined;
  }
};

/** blob URL 的真实来源 origin：只认 blob:<https origin>/<id> 的内层 origin。 */
const blobSourceOriginV1 = (target: string): string | undefined => {
  if (!target.startsWith("blob:")) return undefined;
  try {
    const inner = new URL(target.slice("blob:".length));
    return inner.protocol === "https:" && inner.username === "" && inner.password === ""
      ? inner.origin
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * 下载处置：只放行产品已登记的两类下载，且都由用户选择保存位置。
 *
 * - 资料原件：批准 origin 上的精确原件路径，下载真实 HTTP 字节；
 * - 报告：批准 origin 的登记 report 页创建的 blob 报告。
 *
 * `frameUrl` 是发起下载的文档地址，两类都必须落在批准 origin 内；其它同源地址、外域、
 * 伪造 blob 与缺失来源一律拒绝，事件层取消，不代写路径、不自动打开文件。
 */
export const decideDownloadV1 = (
  config: DesktopConfigV1,
  url: string,
  frameUrl: string,
): DesktopDownloadDecisionV1 => {
  const frame = approvedUrlV1(config, frameUrl);
  const blobOrigin = blobSourceOriginV1(url);
  if (blobOrigin !== undefined)
    return blobOrigin === config.publicOrigin && frame?.pathname === REGISTERED_REPORT_PATH_V1
      ? { kind: "ask" }
      : { kind: "deny", reason: "blob-download-outside-registered-report" };

  const target = approvedUrlV1(config, url);
  if (target === undefined) return { kind: "deny", reason: "download-outside-approved-origin" };
  const disposition = target.searchParams.get("disposition");
  const attachment =
    (disposition === null || disposition === "attachment") &&
    [...target.searchParams.keys()].every((key) => key === "disposition");
  return frame !== undefined && attachment && SOURCE_ORIGINAL_PATH_V1.test(target.pathname)
    ? { kind: "ask" }
    : { kind: "deny", reason: "download-outside-registered-source-original" };
};
