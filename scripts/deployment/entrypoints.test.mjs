/**
 * C37 D-22：交付取证的 CLI 入口必须指向真实存在的脚本。
 *
 * 入口脚本名曾指向不存在的文件（`smoke.mjs`/`benchmark.mjs`）或把子命令当作清单路径
 * （`release.mjs verify`），结果是取证命令在任何机器上都以 ENOENT 失败，无法区分
 * 「命令坏了」与「交付输入缺件」。这里锁住「package.json 里每个交付 CLI 都解析到真实文件」。
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");

const DELIVERY_CLI_PREFIXES = ["deployment:", "desktop:", "acceptance:"];

const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts ?? {};

const deliveryCliEntries = Object.entries(scripts).filter(([name]) =>
  DELIVERY_CLI_PREFIXES.some((prefix) => name.startsWith(prefix)),
);

describe("交付取证 CLI 入口", () => {
  it("package.json 至少登记了验证、smoke 与基准三类交付命令", () => {
    expect(deliveryCliEntries.length).toBeGreaterThanOrEqual(3);
  });

  it.each(deliveryCliEntries)("%s 指向真实存在的脚本", (_name, command) => {
    const scriptPath = /node\s+(\S+)/.exec(command)?.[1];
    expect(scriptPath, `${_name} 未按 node <脚本> 形式登记`).toBeDefined();
    expect(existsSync(join(REPO_ROOT, scriptPath)), `${_name} 指向不存在的 ${scriptPath}`).toBe(
      true,
    );
  });

  it.each(deliveryCliEntries)("%s 不把子命令塞进脚本路径参数", (_name, command) => {
    // `release.mjs verify` 会让 verify 变成清单文件路径；子命令必须走脚本自己的契约。
    const afterScript = command.split(/\.mjs/)[1]?.trim() ?? "";
    expect(afterScript).toBe("");
  });
});
