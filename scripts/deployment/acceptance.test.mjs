import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  ACCEPTANCE_ERROR_V1,
  AcceptanceError,
  MINIMUM_TARGET_HARDWARE_V1,
  SYNTHETIC_SAMPLE_NOTICE_V1,
  loadAcceptanceConfigV1,
  summarizeMeasurementsV1,
  summarizeScenariosV1,
  validateAcceptanceConfigV1,
} from "./acceptance.mjs";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const roots = [];

const validConfig = {
  releaseId: "release-2030-01",
  targetHost: "10.0.0.12",
  hardware: { gpuVramMb: 24576, hostMemoryMb: 131072 },
  thresholds: { startupLatencyMs: 8000 },
};

/** 把配置写到临时文件，用真实的 loadAcceptanceConfigV1 读取，验证磁盘路径也生效。 */
const writeConfig = (config) => {
  const dir = mkdtempSync(join(tmpdir(), "riskflow-acceptance-"));
  roots.push(dir);
  const path = join(dir, "acceptance.json");
  writeFileSync(path, JSON.stringify(config));
  return path;
};

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

describe("验收输入校验", () => {
  it("接受达到最低硬件基线的配置", () => {
    const parsed = validateAcceptanceConfigV1(validConfig);
    expect(parsed.releaseId).toBe("release-2030-01");
    expect(MINIMUM_TARGET_HARDWARE_V1.gpuVramMb).toBe(24576);
  });

  it("显存或内存低于最低基线时配置无效", () => {
    expect(() =>
      validateAcceptanceConfigV1({
        ...validConfig,
        hardware: { gpuVramMb: 12288, hostMemoryMb: 131072 },
      }),
    ).toThrow(AcceptanceError);
    expect(() =>
      validateAcceptanceConfigV1({
        ...validConfig,
        hardware: { gpuVramMb: 24576, hostMemoryMb: 65536 },
      }),
    ).toThrow(AcceptanceError);
  });

  it("从磁盘读取的配置同样通过校验", () => {
    expect(loadAcceptanceConfigV1(writeConfig(validConfig)).releaseId).toBe("release-2030-01");
  });

  it("缺配置文件或关键字段时非零失败，不回落默认值", () => {
    expect(() => loadAcceptanceConfigV1(join(tmpdir(), "missing-acceptance.json"))).toThrow(
      expect.objectContaining({ code: ACCEPTANCE_ERROR_V1.configMissing }),
    );
    expect(() => validateAcceptanceConfigV1({ targetHost: "h" })).toThrow(AcceptanceError);
  });
});

describe("场景汇总", () => {
  it("全部真实通过才 passed", () => {
    const summary = summarizeScenariosV1([
      { id: "login", passed: true },
      { id: "upload", passed: true },
    ]);
    expect(summary).toMatchObject({ passed: true, total: 2, passedCount: 2 });
  });

  it("关键场景被 skip 或失败时整体不通过", () => {
    expect(() =>
      summarizeScenariosV1([
        { id: "login", passed: true },
        { id: "certificate-reject", skipped: true },
      ]),
    ).toThrow(expect.objectContaining({ code: ACCEPTANCE_ERROR_V1.scenarioSkipped }));

    const failed = summarizeScenariosV1([
      { id: "login", passed: true },
      { id: "revoke", passed: false },
    ]);
    expect(failed.passed).toBe(false);
    expect(failed.failedIds).toEqual(["revoke"]);
  });

  it("零场景视为未执行，失败而不是通过", () => {
    expect(() => summarizeScenariosV1([])).toThrow(AcceptanceError);
  });
});

describe("测量汇总", () => {
  it("只登记真实测量与批准阈值，合成样本带待复核标注", () => {
    const summary = summarizeMeasurementsV1({
      measurements: { startupLatencyMs: 3200, projectionQueryP95Ms: 210 },
      thresholds: { startupLatencyMs: 8000, projectionQueryP95Ms: 400 },
    });
    expect(summary.syntheticNotice).toBe(SYNTHETIC_SAMPLE_NOTICE_V1);
    const startup = summary.metrics.find((m) => m.metric === "startupLatencyMs");
    expect(startup.observed).toBe(3200);
    expect(startup.withinThreshold).toBe(true);
  });

  it("超阈值如实标记，不修饰为通过", () => {
    const summary = summarizeMeasurementsV1({
      measurements: { projectionQueryP95Ms: 900 },
      thresholds: { projectionQueryP95Ms: 400 },
    });
    expect(summary.metrics[0].withinThreshold).toBe(false);
  });

  it("拒绝写入未经测量的 RPO/SLA 承诺", () => {
    expect(() =>
      summarizeMeasurementsV1({
        measurements: { rpo: 0 },
        thresholds: {},
      }),
    ).toThrow(expect.objectContaining({ code: ACCEPTANCE_ERROR_V1.configInvalid }));
  });
});

describe("仓库内的验收配置示例", () => {
  it("通过校验并覆盖模型/OCR/投影/停写阈值", () => {
    const config = loadAcceptanceConfigV1(
      join(REPO_ROOT, "deployment", "acceptance-config.example.json"),
    );
    expect(config.releaseId).toBe("release-2030-01");
    expect(config.syntheticSample).toBe(true);
    for (const metric of [
      "startupLatencyMs",
      "projectionQueryP95Ms",
      "modelFirstTokenMs",
      "ocrPageLatencyMs",
      "backupQuiesceMs",
    ]) {
      expect(config.thresholds[metric]).toBeGreaterThan(0);
    }
  });
});
