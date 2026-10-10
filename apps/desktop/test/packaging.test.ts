import { describe, expect, it } from "vitest";

import {
  DESKTOP_TARGETS_V1,
  SIGNING_MATERIAL_ENV_V1,
  buildSbomV1,
  collectRuntimeIdentityV1,
  preflightOfflineV1,
} from "../../../scripts/deployment/package-desktop.mjs";

describe("桌面离线打包制备", () => {
  it("交付矩阵固定为 Windows/Ubuntu/macOS 三平台", () => {
    expect(Object.keys(DESKTOP_TARGETS_V1)).toEqual(["win-x64", "linux-x64", "mac-arm64"]);
    expect(DESKTOP_TARGETS_V1["win-x64"]).toEqual({
      platform: "win32",
      target: "nsis",
      arch: "x64",
    });
    expect(DESKTOP_TARGETS_V1["linux-x64"]).toEqual({
      platform: "linux",
      target: "AppImage",
      arch: "x64",
    });
    expect(DESKTOP_TARGETS_V1["mac-arm64"]).toEqual({
      platform: "darwin",
      target: "dmg",
      arch: "arm64",
    });
  });

  it("缺 Electron 分发包或签名材料时预检失败，且不代为下载", () => {
    const missing = preflightOfflineV1({});
    expect(missing.ready).toBe(false);
    expect(missing.problems).toContain("missing-electron-dist");
    for (const target of Object.keys(SIGNING_MATERIAL_ENV_V1)) {
      expect(missing.problems).toContain(`missing-signing-material:${target}`);
    }
  });

  it("介质与签名材料齐备时预检通过", () => {
    const ready = preflightOfflineV1({
      RISKFLOW_ELECTRON_DIST: "apps/desktop",
      [SIGNING_MATERIAL_ENV_V1["win-x64"]]: "cert.pfx",
      [SIGNING_MATERIAL_ENV_V1["mac-arm64"]]: "Developer ID Application: RiskFlow",
    });
    expect(ready.problems).not.toContain("missing-electron-dist");
    expect(ready.problems.filter((p) => p.startsWith("missing-signing-material"))).toHaveLength(0);
  });

  it("SBOM 只记录运行时身份与许可，不含构建机路径或凭据", () => {
    const sbom = buildSbomV1();
    const serialized = JSON.stringify(sbom);
    expect(sbom.schemaVersion).toBe(1);
    expect(sbom.targets).toHaveLength(3);
    expect(serialized).not.toContain("/home/");
    expect(serialized).not.toContain("password");
    const identity = collectRuntimeIdentityV1();
    expect(identity.licenses.map((l) => l.component)).toEqual(["Electron", "Chromium", "Node.js"]);
  });
});
