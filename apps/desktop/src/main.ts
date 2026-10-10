import { BrowserWindow, app } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DesktopConfigError, parseDesktopConfigV1, type DesktopConfigV1 } from "./config.js";
import {
  DESKTOP_WEB_PREFERENCES_V1,
  decideCertificateErrorV1,
  decideMainFrameNavigationV1,
  decideNewWindowV1,
  decidePermissionRequestV1,
  decideSubframeNavigationV1,
} from "./security.js";

/**
 * C37 D-14：Electron 主进程。
 *
 * 它是薄壳：不打包 React 界面、不导入 Web 源码、不持有服务器秘密。
 * 只负责加载应用 VM 的同一 HTTPS 入口，并把安全判定接到 webContents 事件上。
 */

const CONFIG_RELATIVE_PATH = "desktop-config.json";

/** 部署配置路径：由安装者受控写入，网页与自由 CLI 都无法覆盖。 */
const readDesktopConfig = (): DesktopConfigV1 => {
  const configPath =
    process.env.RISKFLOW_DESKTOP_CONFIG ?? join(app.getPath("userData"), CONFIG_RELATIVE_PATH);
  return parseDesktopConfigV1(JSON.parse(readFileSync(configPath, "utf8")) as unknown);
};

/**
 * 无特权的本地连接状态页。
 *
 * 它由安装介质随包提供：只说明「当前连不上」并提供显式重试。
 * 重试目标由主进程以 data 属性注入，仍然只指向批准 origin；
 * 页面本身不携带凭据、不调用宿主能力、不展示业务数据。
 */
const showConnectionState = (window: BrowserWindow, message: string, retryOrigin: string): void => {
  const pagePath = join(app.getAppPath(), "resources", "connection.html");
  window.loadFile(pagePath, { query: { message, retry: retryOrigin } }).catch(() => undefined);
};

const createWindow = (config: DesktopConfigV1): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    // 使用系统原生标题栏：客户端不自带业务 UI 装饰。
    titleBarStyle: "default",
    autoHideMenuBar: true,
    // 无特权：没有 preload（键直接缺席），页面拿不到 Node、IPC 或宿主能力。
    webPreferences: DESKTOP_WEB_PREFERENCES_V1,
  });

  window.webContents.on("will-navigate", (event, url) => {
    const decision = decideMainFrameNavigationV1(config, url);
    if (decision.kind === "deny") event.preventDefault();
  });
  window.webContents.on("will-frame-navigate", (event) => {
    if (decideSubframeNavigationV1().kind === "deny") event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: decideNewWindowV1().kind }));
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(decidePermissionRequestV1("unknown").kind === "allow");
  });
  window.webContents.session.setPermissionCheckHandler(() => false);
  // 证书错误与认证挑战都不代为处理：私有 CA 通过系统信任链部署。
  window.webContents.session.setCertificateVerifyProc((_request, callback) => {
    callback(decideCertificateErrorV1().kind === "allow" ? 0 : -2);
  });
  window.webContents.on("login", (event) => {
    event.preventDefault();
  });
  window.webContents.on("did-fail-load", (_event, _code, _description, validatedUrl) => {
    if (
      validatedUrl === config.publicOrigin ||
      validatedUrl.startsWith(`${config.publicOrigin}/`)
    ) {
      showConnectionState(
        window,
        "与 RiskFlow 服务的连接中断，请检查内网与证书配置。",
        config.publicOrigin,
      );
    }
  });

  window.loadURL(config.publicOrigin).catch(() => {
    showConnectionState(window, "无法连接到 RiskFlow 服务。", config.publicOrigin);
  });
  return window;
};

const main = (): void => {
  let config: DesktopConfigV1;
  try {
    config = readDesktopConfig();
  } catch (error) {
    // 配置缺失或不合法时直接退出，不带默认 origin 启动。
    if (error instanceof DesktopConfigError) {
      console.error(`RiskFlow 桌面配置无效：${error.code}`);
      app.quit();
      return;
    }
    throw error;
  }

  void app.whenReady().then(() => {
    const window = createWindow(config);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(config);
    });
    window.on("closed", () => {
      // 关闭窗口只结束客户端连接；已受理的服务端任务继续执行。
    });
  });
};

app.on("window-all-closed", () => app.quit());

main();
