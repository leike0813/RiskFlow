#!/usr/bin/env node
/**
 * 本机 MinerU 固定服务暖请求基准 runner（IP-11 / D-12）。
 *
 * 不变量：
 * - 只驱动 self-hosted-v1 环回配置的既有真实 smoke，不改端点、不换模型、不启停容器；
 * - 先一次预热，再跑 repeats（3..10）次暖请求；输出根必须不存在，目录 0700、日志 0600；
 * - 每项 smoke 由既有 smoke.test.ts 写 acceptance.json / failure.json，runner 只读不放正文、不打密钥；
 * - 样本不足不报中位数与吞吐，且不输出 p95；失败重复仍记录并让整体 FAIL，但不影响其余重复；
 * - 计时只代表暖请求：任务缓存是否复用未知，模型加载与冷启动由外部实测另计。
 */

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SMOKE_TEST =
  "packages/adapters/test/engineering-data/document-conversion/mineru/smoke.test.ts";
const SUITE_PATH = "references/acceptance/mineru-v2/manifest.json";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const MAX_SAMPLES_PER_RUN = 5;
const MAX_REPORT_BYTES = 1_048_576;
const MIN_SAMPLES_FOR_MEDIAN = 3;
const USAGE =
  "usage: node scripts/acceptance/mineru-benchmark.mjs <config.json> <report-dir> [repeats=3]";

export class MineruBenchmarkError extends Error {
  constructor(code, detail = "") {
    super(detail === "" ? code : code + ": " + detail);
    this.name = "MineruBenchmarkError";
    this.code = code;
  }
}

const refText = (ref) =>
  ref === undefined || ref === null ? null : ref.entityId + "@" + ref.versionId;

export const parseArguments = (argv) => {
  const [configArg, reportArg, repeatsArg] = argv;
  if (configArg === undefined || reportArg === undefined)
    throw new MineruBenchmarkError("ARGUMENT_MISSING", USAGE);
  const repeats = repeatsArg === undefined ? 3 : Number(repeatsArg);
  if (!Number.isInteger(repeats) || repeats < 3 || repeats > 10)
    throw new MineruBenchmarkError("REPEATS_OUT_OF_RANGE", "repeats must be an integer in 3..10");
  return { configPath: resolve(configArg), reportDir: resolve(reportArg), repeats };
};

/** 基准只认可本机固定自托管服务：协议必须显式，环回端点由配置提供，runner 不做任何替换。 */
export const assertLocalSelfHostedConfig = (config) => {
  if (config?.protocol !== "self-hosted-v1")
    throw new MineruBenchmarkError("PROTOCOL_NOT_SELF_HOSTED", String(config?.protocol));
  let host;
  try {
    host = new URL(config.endpoint).hostname;
  } catch {
    throw new MineruBenchmarkError("ENDPOINT_INVALID", String(config.endpoint));
  }
  if (!LOOPBACK_HOSTS.has(host))
    throw new MineruBenchmarkError("ENDPOINT_NOT_LOOPBACK", String(config.endpoint));
  return {
    protocol: config.protocol,
    endpoint: config.endpoint,
    deploymentRef: refText(config.deploymentRef),
    resourceAllocationRef: refText(config.resourceAllocationRef),
    qualityPolicyRef: refText(config.qualityPolicyRef),
  };
};

const readSmallJson = (path) => {
  if (!existsSync(path) || statSync(path).size > MAX_REPORT_BYTES) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

/** 单个证据目录的观测；只提取计量与身份字段，不携带正文。 */
export const readObservation = (evidenceDir) => {
  const report = readSmallJson(join(evidenceDir, "acceptance.json"));
  if (report !== null && report.status === "completed")
    return {
      evidenceDir,
      status: "completed",
      sampleId: report.sampleId ?? null,
      protocol: report.protocol ?? null,
      elapsedMs: report.elapsedMs ?? null,
      pages: report.pages ?? null,
      compliance: report.compliance ?? null,
      checks: report.checks ?? null,
      inputSha256: report.inputSha256 ?? null,
      deploymentRef: refText(report.deploymentRef),
      qualityPolicyRef: refText(report.qualityPolicyRef),
      resourceAllocationRef: refText(report.resourceAllocationRef),
    };
  const failure = readSmallJson(join(evidenceDir, "failure.json"));
  return {
    evidenceDir,
    status: failure === null ? "missing" : "failed",
    sampleId: report?.sampleId ?? failure?.sampleId ?? null,
    protocol: report?.protocol ?? failure?.protocol ?? null,
    elapsedMs: report?.elapsedMs ?? failure?.elapsedMs ?? null,
    pages: null,
    compliance: null,
    checks: null,
    inputSha256: report?.inputSha256 ?? null,
    deploymentRef: refText(report?.deploymentRef),
    qualityPolicyRef: refText(report?.qualityPolicyRef),
    resourceAllocationRef: refText(report?.resourceAllocationRef),
    code: failure?.code ?? "ACCEPTANCE_REPORT_MISSING",
  };
};

/** 有界读取：只看当前重复目录最多 5 个证据子目录，不搜索全局临时目录。 */
export const collectObservations = (runDir) =>
  readdirSync(runDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .slice(0, MAX_SAMPLES_PER_RUN)
    .map((entry) => readObservation(join(runDir, entry.name)))
    .sort((left, right) => String(left.sampleId).localeCompare(String(right.sampleId)));

export const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** DOCX 页数为 null（源无固定分页），此时不伪造吞吐。 */
export const pagesPerMinute = (pages, medianMs) => {
  if (pages === null || pages === undefined || !Number.isFinite(pages) || pages <= 0) return null;
  if (!Number.isFinite(medianMs) || medianMs <= 0) return null;
  return Math.round((pages / (medianMs / 60_000)) * 10) / 10;
};

export const summarizeObservations = (observations) => {
  const bySample = new Map();
  for (const observation of observations) {
    const key = observation.sampleId ?? "unknown:" + observation.evidenceDir;
    const entry = bySample.get(key) ?? { sampleId: key, successes: [], failures: [] };
    (observation.status === "completed" ? entry.successes : entry.failures).push(observation);
    bySample.set(key, entry);
  }
  return [...bySample.values()].map(({ sampleId, successes, failures }) => {
    const elapsedMs = successes.map(({ elapsedMs }) => elapsedMs).filter(Number.isFinite);
    const medianElapsedMs = successes.length >= MIN_SAMPLES_FOR_MEDIAN ? median(elapsedMs) : null;
    const pages = successes[0]?.pages ?? null;
    return {
      sampleId,
      successfulRuns: successes.length,
      failedRuns: failures.length,
      failureCodes: [...new Set(failures.map(({ code }) => code))].sort(),
      elapsedMs,
      medianElapsedMs,
      pages,
      checks: successes[0]?.checks ?? null,
      pagesPerMinute: pagesPerMinute(pages, medianElapsedMs),
      evidenceDirectories: [...successes, ...failures].map(({ evidenceDir }) => evidenceDir),
    };
  });
};

/** 同一 sample 必须来自同一输入哈希、部署引用与质量引用；混用即为 FAIL。 */
export const identityIssues = (observations) => {
  const issues = [];
  const fields = ["inputSha256", "deploymentRef", "qualityPolicyRef", "resourceAllocationRef"];
  const identities = new Map();
  for (const observation of observations.filter(({ status }) => status === "completed")) {
    const key = observation.sampleId ?? "unknown:" + observation.evidenceDir;
    const seen = identities.get(key) ?? new Map();
    for (const field of fields) {
      const value = observation[field];
      if (value === null) continue;
      if (!seen.has(field)) seen.set(field, value);
      else if (seen.get(field) !== value)
        issues.push(key + " 的 " + field + " 在重复之间不一致：" + seen.get(field) + " / " + value);
    }
    identities.set(key, seen);
  }
  const protocols = new Set(
    observations.map(({ protocol }) => protocol).filter((value) => value !== null),
  );
  if (protocols.size > 1) issues.push("观测跨协议混用：" + [...protocols].sort().join(", "));
  return issues;
};

export const evaluateBenchmark = ({ runs, repeats, expectedSampleIds, observations }) => {
  const issues = [];
  for (const run of runs)
    if (run.exitCode !== 0) issues.push(run.runId + " 退出码 " + String(run.exitCode));
  const completed = new Set(
    observations.filter(({ status }) => status === "completed").map(({ sampleId }) => sampleId),
  );
  if (completed.size !== MAX_SAMPLES_PER_RUN || expectedSampleIds.some((id) => !completed.has(id)))
    issues.push("成功样本未覆盖五格式：已记录 " + ([...completed].sort().join(", ") || "无"));
  for (const sample of summarizeObservations(observations))
    if (sample.successfulRuns < repeats || sample.failedRuns > 0)
      issues.push(
        sample.sampleId +
          " 成功 " +
          sample.successfulRuns +
          "/" +
          repeats +
          "（失败码 " +
          (sample.failureCodes.join(",") || "无") +
          "）",
      );
  issues.push(...identityIssues(observations));
  return { status: issues.length === 0 ? "PASS" : "FAIL", issues };
};

const runSmoke = (runDir, configPath) => {
  const fd = openSync(join(runDir, "vitest.log"), "wx", 0o600);
  try {
    const result = spawnSync("pnpm", ["exec", "vitest", "run", SMOKE_TEST], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        MINERU_REAL_SMOKE: "1",
        MINERU_SMOKE_CONFIG: configPath,
        MINERU_SMOKE_SUITE: join(REPO_ROOT, SUITE_PATH),
        MINERU_SMOKE_OUTPUT_DIR: runDir,
      },
      stdio: ["ignore", fd, fd],
    });
    return result.status ?? 1;
  } finally {
    closeSync(fd);
  }
};

export const runBenchmark = ({ configPath, reportDir, repeats, spawn = runSmoke }) => {
  if (existsSync(reportDir)) throw new MineruBenchmarkError("OUTPUT_EXISTS", reportDir);
  const config = readSmallJson(configPath);
  if (config === null) throw new MineruBenchmarkError("CONFIG_UNREADABLE", configPath);
  const identity = assertLocalSelfHostedConfig(config);
  const suite = readSmallJson(join(REPO_ROOT, SUITE_PATH));
  const expectedSampleIds = (suite?.samples ?? []).map(({ id }) => id);
  if (expectedSampleIds.length !== MAX_SAMPLES_PER_RUN)
    throw new MineruBenchmarkError("SUITE_NOT_FIVE_FORMATS", SUITE_PATH);

  mkdirSync(reportDir, { mode: 0o700 });
  const execute = (runId) => {
    const runDir = join(reportDir, runId);
    mkdirSync(runDir, { mode: 0o700 });
    const exitCode = spawn(runDir, configPath);
    return { runId, exitCode, samples: collectObservations(runDir) };
  };
  const warmup = execute("warmup");
  const runs = Array.from({ length: repeats }, (_, index) =>
    execute("run-" + String(index + 1).padStart(2, "0")),
  );
  // 预热只抬高服务状态；正式统计只看暖重复，预热结果不混入中位数。
  const observations = runs.flatMap(({ samples }) => samples);
  const { status, issues } = evaluateBenchmark({
    runs,
    repeats,
    expectedSampleIds,
    observations,
  });
  const report = {
    schemaVersion: "1",
    status,
    suite: SUITE_PATH,
    suiteVersionId: suite.versionId ?? null,
    configPath,
    repeats,
    ...identity,
    warmup: { runId: warmup.runId, exitCode: warmup.exitCode, samples: warmup.samples },
    runs: runs.map(({ runId, exitCode }) => ({ runId, exitCode })),
    samples: summarizeObservations(observations),
    issues,
    notes: {
      measurements: "warm-only",
      coldStartAndModelLoad: "not measured by this runner; record separately",
      taskCache: "self-hosted task cache reuse is unknown; elapsedMs may be cache-assisted",
      resources:
        "container RAM/VRAM and CPU/GPU participation come from separate docker/nvidia records",
      gpuClaim: "this runner does not assert that a GPU backend actually ran",
      docx: "DOCX native flash tier is excluded from VLM throughput claims",
    },
  };
  const reportPath = join(reportDir, "benchmark-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return { report, reportPath };
};

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  try {
    const { report, reportPath } = runBenchmark(parseArguments(process.argv.slice(2)));
    process.stdout.write(
      JSON.stringify(
        {
          status: report.status,
          report: reportPath,
          samples: report.samples.map(
            ({ sampleId, successfulRuns, medianElapsedMs, pagesPerMinute }) => ({
              sampleId,
              successfulRuns,
              medianElapsedMs,
              pagesPerMinute,
            }),
          ),
          issues: report.issues,
        },
        null,
        2,
      ) + "\n",
    );
    process.exitCode = report.status === "PASS" ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      (error instanceof MineruBenchmarkError ? error.code : "UNEXPECTED") +
        ": " +
        error.message +
        "\n",
    );
    process.exitCode = 1;
  }
}
