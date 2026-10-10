#!/usr/bin/env node
/**
 * C37 D-16：正式包签名核验钩子（`electron-builder.yml` 的 `afterSign`）。
 *
 * 内网交付要求「正式包必须签名/公证，缺失材料时不产出可分发的包」。这个钩子按
 * **本次构建的平台**检查签名材料是否到位：
 * - 需要签名的平台材料缺失 → 非零失败，构建停止，不产出可分发的包；
 * - 该平台按冻结交付矩阵本就不需要签名（当前只有 linux-x64）→ 放行。
 *
 * 它不读产物里的证书，也不联网：材料是否提供只由环境变量的有无决定，真正的签名由
 * electron-builder 用同一批材料完成，本钩子只做「材料到位与否」的门槛。
 */

/** 冻结交付矩阵：electron-builder 平台名 → 所需签名材料环境变量。 */
export const REQUIRED_SIGNING_MATERIAL = Object.freeze({
  win32: "RISKFLOW_WIN_CSC_LINK",
  darwin: "RISKFLOW_MAC_SIGNING_IDENTITY",
});

export const verifySignatureHookV1 = (electronPlatformName, env = process.env) => {
  const variable = REQUIRED_SIGNING_MATERIAL[electronPlatformName];
  // 冻结矩阵里没有签名要求的平台（linux-x64）不阻塞。
  if (variable === undefined) return { ok: true, problems: [] };
  if (env[variable] === undefined || env[variable] === "") {
    return {
      ok: false,
      problems: [`${electronPlatformName} 需要签名材料 ${variable}，缺失时不产出正式包`],
    };
  }
  return { ok: true, problems: [] };
};

const main = () => {
  // electron-builder 以 afterSign 钩子调用本文件，平台名是唯一的位置参数。
  const platform = process.argv[2] ?? "linux";
  const result = verifySignatureHookV1(platform);
  if (!result.ok) {
    console.error(`signature verification failed: ${result.problems.join("; ")}`);
    process.exitCode = 4;
    return;
  }
  console.log(`signature material present for ${platform}`);
};

if (process.argv[1] !== undefined && process.argv[1].endsWith("verify-signature.mjs")) {
  main();
}
