import { describe, expect, it } from "vitest";

import {
  DESKTOP_CONFIG_ERROR_V1,
  DesktopConfigError,
  isApprovedOriginV1,
  parseDesktopConfigV1,
} from "../src/config.js";
import {
  DESKTOP_CONTENT_SECURITY_POLICY_V1,
  DESKTOP_WEB_PREFERENCES_V1,
  decideCertificateErrorV1,
  decideDownloadV1,
  decideExternalOpenV1,
  decideLoginChallengeV1,
  decideMainFrameNavigationV1,
  decideNewWindowV1,
  decidePermissionRequestV1,
  decideSubframeNavigationV1,
} from "../src/security.js";

const config = parseDesktopConfigV1({
  schemaVersion: 1,
  deploymentId: "app-vm-01",
  publicOrigin: "https://riskflow.internal.example",
  serverCompatibilityRange: {
    minServerReleaseId: "release-2030-01",
    maxServerReleaseId: "release-2030-06",
  },
});

describe("桌面配置边界", () => {
  it("只接受纯 HTTPS origin，不接受路径、用户信息、query 或非 https", () => {
    expect(parseDesktopConfigV1(config).publicOrigin).toBe("https://riskflow.internal.example");
    for (const bad of [
      "http://riskflow.internal.example",
      "https://riskflow.internal.example/login",
      "https://user@riskflow.internal.example",
      "https://riskflow.internal.example?x=1",
      "https://riskflow.internal.example#a",
      "//riskflow.internal.example",
      "javascript:alert(1)",
    ]) {
      expect(() => parseDesktopConfigV1({ ...config, publicOrigin: bad }), bad).toThrow(
        DesktopConfigError,
      );
    }
    expect(() =>
      parseDesktopConfigV1({ ...config, publicOrigin: "http://riskflow.internal.example" }),
    ).toThrow(
      expect.objectContaining({ code: DESKTOP_CONFIG_ERROR_V1.originNotHttps }) as unknown as Error,
    );
  });

  it("缺字段或非法 schema 一律拒绝，不回落默认 origin", () => {
    expect(() => parseDesktopConfigV1(undefined)).toThrow(DesktopConfigError);
    expect(() => parseDesktopConfigV1({ ...config, schemaVersion: 2 })).toThrow(DesktopConfigError);
    expect(() => parseDesktopConfigV1({ ...config, deploymentId: "" })).toThrow(DesktopConfigError);
  });

  it("同源判定只认 origin，路径任意但协议/主机/端口必须一致", () => {
    expect(isApprovedOriginV1(config, "https://riskflow.internal.example/login").approved).toBe(
      true,
    );
    expect(isApprovedOriginV1(config, "https://riskflow.internal.example:8443/").approved).toBe(
      false,
    );
    expect(isApprovedOriginV1(config, "https://evil.example/").approved).toBe(false);
    expect(isApprovedOriginV1(config, "not-a-url").approved).toBe(false);
  });
});

describe("导航、窗口与权限边界", () => {
  it("主框架只允许批准 origin，拒绝其它协议与外站", () => {
    expect(
      decideMainFrameNavigationV1(config, "https://riskflow.internal.example/overview"),
    ).toEqual({
      kind: "allow",
    });
    for (const bad of [
      "http://riskflow.internal.example/",
      "https://evil.example/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://riskflow.internal.example.evil.example/",
    ]) {
      expect(decideMainFrameNavigationV1(config, bad).kind, bad).toBe("deny");
    }
  });

  it("子框架、新窗口、外链与权限一律拒绝", () => {
    expect(decideSubframeNavigationV1().kind).toBe("deny");
    expect(decideNewWindowV1().kind).toBe("deny");
    expect(decideExternalOpenV1().kind).toBe("deny");
    expect(decidePermissionRequestV1("media").kind).toBe("deny");
  });

  it("证书错误与认证挑战不代为处理", () => {
    expect(decideCertificateErrorV1().kind).toBe("deny");
    expect(decideLoginChallengeV1().kind).toBe("deny");
  });

  it("下载只允许业务 origin 且必须由用户选择保存位置", () => {
    expect(decideDownloadV1(config, "https://riskflow.internal.example/api/v1/report")).toEqual({
      kind: "ask",
    });
    expect(decideDownloadV1(config, "https://evil.example/x.json").kind).toBe("deny");
  });

  it("渲染进程关闭 Node 集成并开启隔离与沙箱，且不注入 preload", () => {
    expect(DESKTOP_WEB_PREFERENCES_V1).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    });
    // preload 键直接缺席：客户端不向渲染进程注入任何宿主能力。
    expect(Object.hasOwn(DESKTOP_WEB_PREFERENCES_V1, "preload")).toBe(false);
  });

  it("CSP 禁止外域、eval、frame 与 object", () => {
    expect(DESKTOP_CONTENT_SECURITY_POLICY_V1).toContain("default-src 'self'");
    expect(DESKTOP_CONTENT_SECURITY_POLICY_V1).toContain("script-src 'self'");
    expect(DESKTOP_CONTENT_SECURITY_POLICY_V1).not.toContain("unsafe-eval");
    expect(DESKTOP_CONTENT_SECURITY_POLICY_V1).toContain("frame-src 'none'");
    expect(DESKTOP_CONTENT_SECURITY_POLICY_V1).toContain("object-src 'none'");
    expect(DESKTOP_CONTENT_SECURITY_POLICY_V1).not.toMatch(/script-src[^;]*\bhttps?:/);
  });
});
