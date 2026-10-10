import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * C37 D-22：桌面验收的受控输入。
 *
 * 配置由安装者受控写入（RISKFLOW_DESKTOP_BUILD_CONFIG / ACCEPTANCE_CONFIG）；
 * 缺失或不合规时必须非零失败，不允许用默认 origin 或跳过场景来「通过」。
 */
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../../..");

export const DESKTOP_ACCEPTANCE_ENV_V1 = Object.freeze({
  buildConfig: "RISKFLOW_DESKTOP_BUILD_CONFIG",
  acceptanceConfig: "RISKFLOW_DESKTOP_ACCEPTANCE_CONFIG",
});

export class DesktopAcceptanceError extends Error {
  constructor(code, detail = "") {
    super(code);
    this.name = "DesktopAcceptanceError";
    this.code = code;
    this.detail = detail;
  }
}

/** 校验桌面配置与客户端构建产物是否齐备。 */
export const preflightDesktopAcceptanceV1 = (env = process.env, root = REPO_ROOT) => {
  const problems = [];
  const buildConfigPath = env[DESKTOP_ACCEPTANCE_ENV_V1.buildConfig];
  const acceptanceConfigPath = env[DESKTOP_ACCEPTANCE_ENV_V1.acceptanceConfig];

  let publicOrigin;
  if (buildConfigPath === undefined || !existsSync(buildConfigPath)) {
    problems.push("missing-desktop-build-config");
  } else {
    const config = JSON.parse(readFileSync(buildConfigPath, "utf8"));
    publicOrigin = config.publicOrigin;
    if (typeof publicOrigin !== "string" || !publicOrigin.startsWith("https://")) {
      problems.push("desktop-origin-not-https");
    }
    const mainPath = join(root, "apps", "desktop", "dist", "main.js");
    if (!existsSync(mainPath)) problems.push("missing-desktop-build");
  }

  if (acceptanceConfigPath === undefined || !existsSync(acceptanceConfigPath)) {
    problems.push("missing-desktop-acceptance-config");
  }

  return {
    ready: problems.length === 0,
    problems,
    publicOrigin,
  };
};
