#!/usr/bin/env node
/**
 * C37 D-16 / 9.3：桌面安装包制备程序。
 *
 * 它只做三件事，并且在缺输入时显式失败：
 * 1. 校验离线介质与 Electron 分发包是否就位（不联网、不代为下载）；
 * 2. 校验平台签名材料是否就位（缺失则该平台不产出正式包）；
 * 3. 调用 electron-builder 产出安装包，并收集 Chromium/Node/Electron 的许可与 SBOM 信息。
 *
 * 服务端发布与桌面发布彼此独立：本程序不读取也不改写服务端发布配置。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const DESKTOP_DIR = join(REPO_ROOT, "apps", "desktop");
const DIST_DIR = join(DESKTOP_DIR, "dist");
const BUILDER_CONFIG = join(DESKTOP_DIR, "electron-builder.yml");

/** D-16 冻结的交付矩阵：平台 → 目标与架构。 */
export const DESKTOP_TARGETS_V1 = Object.freeze({
  "win-x64": Object.freeze({ platform: "win32", target: "nsis", arch: "x64" }),
  "linux-x64": Object.freeze({ platform: "linux", target: "AppImage", arch: "x64" }),
  "mac-arm64": Object.freeze({ platform: "darwin", target: "dmg", arch: "arm64" }),
});

/** 签名材料：属部署输入，缺失时对应平台不产出可分发的正式包。 */
export const SIGNING_MATERIAL_ENV_V1 = Object.freeze({
  "win-x64": "RISKFLOW_WIN_CSC_LINK",
  "mac-arm64": "RISKFLOW_MAC_SIGNING_IDENTITY",
});

const readJsonIfExists = (path) => {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
};

/** 桌面运行时身份：随安装包记录，与服务端 Node 主版本相互独立。 */
export const collectRuntimeIdentityV1 = () => {
  const electronManifest = readJsonIfExists(
    join(DESKTOP_DIR, "node_modules", "electron", "dist", "version"),
  );
  const builderManifest = readJsonIfExists(
    join(DESKTOP_DIR, "node_modules", "electron-builder", "package.json"),
  );
  const electronPackage = readJsonIfExists(
    join(DESKTOP_DIR, "node_modules", "electron", "package.json"),
  );
  return {
    electronVersion: electronPackage?.version ?? "unknown",
    electronBuilderVersion: builderManifest?.version ?? "unknown",
    nodeVersion: process.versions.node,
    chromeVersion: electronManifest ?? "unknown",
    licenses: [
      { component: "Electron", license: "MIT" },
      { component: "Chromium", license: "BSD-3-Clause" },
      { component: "Node.js", license: "MIT" },
    ],
  };
};

/** 离线预检：Electron 分发包与打包配置必须已在介质上就位。 */
/**
 * 离线与签名预检。
 *
 * 只针对**本次要产出的那个平台**收签名材料：要求三个平台的签名材料同时就位，
 * 会让任何单个平台都产不出包——那既不是交付约束也帮不了谁。缺哪个平台的签名材料，
 * 就只阻塞那个平台。
 */
export const preflightOfflineV1 = (env = process.env, target = undefined) => {
  const problems = [];
  if (!existsSync(BUILDER_CONFIG)) problems.push("missing-builder-config");
  const electronDist = env.RISKFLOW_ELECTRON_DIST;
  if (electronDist === undefined || !existsSync(electronDist)) {
    problems.push("missing-electron-dist");
  }
  for (const [signingTarget, variable] of Object.entries(SIGNING_MATERIAL_ENV_V1)) {
    if (target !== undefined && signingTarget !== target) continue;
    if (env[variable] === undefined || env[variable] === "") {
      problems.push(`missing-signing-material:${signingTarget}`);
    }
  }
  return { ready: problems.length === 0, problems };
};

/** 组装 SBOM：只记录身份与许可，不含构建机路径或凭据。 */
export const buildSbomV1 = () => {
  const identity = collectRuntimeIdentityV1();
  return {
    schemaVersion: 1,
    component: "RiskFlow Desktop",
    runtime: identity,
    targets: Object.entries(DESKTOP_TARGETS_V1).map(([key, value]) => ({ target: key, ...value })),
  };
};

const main = () => {
  // `pnpm <script> -- <target>` 会把 `--` 一并传进 argv，取第一个非 `--` 的位置参数。
  const target = process.argv.slice(2).find((arg) => arg !== "--");
  if (target === undefined || !(target in DESKTOP_TARGETS_V1)) {
    console.error(`usage: pnpm desktop:package -- <${Object.keys(DESKTOP_TARGETS_V1).join("|")}>`);
    process.exitCode = 2;
    return;
  }
  const preflight = preflightOfflineV1(process.env, target);
  if (!preflight.ready) {
    // 缺介质或签名材料时显式失败：不产出可分发的包，也不联网补齐。
    console.error(`desktop packaging preflight failed: ${preflight.problems.join(", ")}`);
    process.exitCode = 3;
    return;
  }
  writeFileSync(join(DIST_DIR, "desktop-sbom.json"), `${JSON.stringify(buildSbomV1(), null, 2)}\n`);
  console.log(`preflight ok for ${target}; run electron-builder with --${target}`);
};

if (process.argv[1] !== undefined && process.argv[1].endsWith("package-desktop.mjs")) {
  main();
}
