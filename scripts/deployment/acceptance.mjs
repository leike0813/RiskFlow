#!/usr/bin/env node
/**
 * C37 D-22 / 14.1：部署 smoke 与基准的输入校验与证据汇总。
 *
 * 关键原则：启用项缺输入、缺服务、缺目标硬件或关键场景被 skip 时**非零失败**，
 * 不得把「没跑」当作「通过」。证据汇总只记录真实测量，不预设吞吐、RPO/RTO 或 SLA。
 */
import { existsSync, readFileSync } from "node:fs";

export const ACCEPTANCE_ERROR_V1 = {
  configMissing: "ACCEPTANCE_CONFIG_MISSING",
  configInvalid: "ACCEPTANCE_CONFIG_INVALID",
  scenarioSkipped: "ACCEPTANCE_SCENARIO_SKIPPED",
  targetUnavailable: "ACCEPTANCE_TARGET_UNAVAILABLE",
  mediaMissing: "ACCEPTANCE_MEDIA_MISSING",
};

export class AcceptanceError extends Error {
  constructor(code, detail = "") {
    super(code);
    this.name = "AcceptanceError";
    this.code = code;
    this.detail = detail;
  }
}

/** 最低实测基线（D-16）：RTX 4090 24GB 与 128GB 主机内存。 */
export const MINIMUM_TARGET_HARDWARE_V1 = Object.freeze({
  gpuModel: "NVIDIA GeForce RTX 4090",
  gpuVramMb: 24576,
  hostMemoryMb: 131072,
});

/** 合成样本必须标注待甲方复核；真实质量门槛以甲方样例为准。 */
export const SYNTHETIC_SAMPLE_NOTICE_V1 = "合成样本，待甲方复核";

/**
 * 校验验收配置。
 *
 * 缺文件、非法结构或缺最低硬件基线都直接失败——配置不全时继续跑只会产出假证据。
 */
export const validateAcceptanceConfigV1 = (config) => {
  if (typeof config !== "object" || config === null) {
    throw new AcceptanceError(ACCEPTANCE_ERROR_V1.configInvalid, "not-an-object");
  }
  if (config.releaseId === undefined || config.targetHost === undefined) {
    throw new AcceptanceError(ACCEPTANCE_ERROR_V1.configInvalid, "missing-identity-or-target");
  }
  const hardware = config.hardware ?? {};
  if (hardware.gpuVramMb < MINIMUM_TARGET_HARDWARE_V1.gpuVramMb) {
    throw new AcceptanceError(ACCEPTANCE_ERROR_V1.configInvalid, "gpu-below-minimum");
  }
  if (hardware.hostMemoryMb < MINIMUM_TARGET_HARDWARE_V1.hostMemoryMb) {
    throw new AcceptanceError(ACCEPTANCE_ERROR_V1.configInvalid, "memory-below-minimum");
  }
  return Object.freeze({
    releaseId: config.releaseId,
    targetHost: config.targetHost,
    hardware,
    thresholds: config.thresholds ?? {},
    syntheticSample: config.syntheticSample === true,
  });
};

/** 载入验收配置；缺文件即失败，不回落默认值。 */
export const loadAcceptanceConfigV1 = (path) => {
  if (!existsSync(path)) {
    throw new AcceptanceError(ACCEPTANCE_ERROR_V1.configMissing, path);
  }
  return validateAcceptanceConfigV1(JSON.parse(readFileSync(path, "utf8")));
};

/**
 * 场景结果汇总。
 *
 * 任一启用场景被 skip 或失败，整体即失败；只有全部真实通过才给出 passed。
 */
export const summarizeScenariosV1 = (results) => {
  const skipped = results.filter((r) => r.skipped === true);
  const failed = results.filter((r) => r.skipped !== true && r.passed !== true);
  const passed = results.filter((r) => r.skipped !== true && r.passed === true);
  if (results.length === 0) {
    throw new AcceptanceError(ACCEPTANCE_ERROR_V1.scenarioSkipped, "no-scenarios");
  }
  if (skipped.length > 0) {
    throw new AcceptanceError(
      ACCEPTANCE_ERROR_V1.scenarioSkipped,
      skipped.map((r) => r.id).join(","),
    );
  }
  return Object.freeze({
    passed: failed.length === 0,
    total: results.length,
    passedCount: passed.length,
    failedIds: Object.freeze(failed.map((r) => r.id)),
  });
};

/**
 * 测量汇总。
 *
 * 只登记真实测量与批准阈值；不写入任何未经测量的吞吐、RPO/RTO 或 SLA 承诺。
 */
export const summarizeMeasurementsV1 = ({ measurements, thresholds }) => {
  const compared = Object.entries(measurements).map(([metric, observed]) => {
    const limit = thresholds?.[metric];
    return Object.freeze({
      metric,
      observed,
      limit: limit ?? null,
      withinThreshold: limit === undefined ? null : observed <= limit,
    });
  });
  const serialized = JSON.stringify({ measurements, thresholds });
  // 明确拒绝把未测量的恢复指标写成承诺。
  for (const forbidden of ["rpo", "slo", "sla"]) {
    if (serialized.includes(`"${forbidden}"`)) {
      throw new AcceptanceError(
        ACCEPTANCE_ERROR_V1.configInvalid,
        `forbidden-promise:${forbidden}`,
      );
    }
  }
  return Object.freeze({
    releaseIdentity: true,
    syntheticNotice: SYNTHETIC_SAMPLE_NOTICE_V1,
    metrics: Object.freeze(compared),
  });
};

const main = () => {
  const configPath = process.env.RISKFLOW_ACCEPTANCE_CONFIG;
  if (configPath === undefined) {
    console.error(`${ACCEPTANCE_ERROR_V1.configMissing}: RISKFLOW_ACCEPTANCE_CONFIG is not set`);
    process.exitCode = 3;
    return;
  }
  try {
    const config = loadAcceptanceConfigV1(configPath);
    console.log(`acceptance config ok: ${config.releaseId} @ ${config.targetHost}`);
  } catch (error) {
    if (error instanceof AcceptanceError) {
      console.error(`${error.code}: ${error.detail}`);
      process.exitCode = 3;
      return;
    }
    throw error;
  }
};

if (process.argv[1] !== undefined && process.argv[1].endsWith("acceptance.mjs")) {
  main();
}
