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

/**
 * 下载处置：只允许业务 origin 发起的下载，且必须由用户选择保存位置。
 * 不接受任意来源或服务端指定路径，也不代写文件。
 */
export const decideDownloadV1 = (
  config: DesktopConfigV1,
  url: string,
): DesktopDownloadDecisionV1 => {
  const { approved } = isApprovedOriginV1(config, url);
  return approved ? { kind: "ask" } : { kind: "deny", reason: "download-outside-approved-origin" };
};
