import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  MineruBenchmarkError,
  assertLocalSelfHostedConfig,
  evaluateBenchmark,
  identityIssues,
  median,
  pagesPerMinute,
  parseArguments,
  readObservation,
  runBenchmark,
  summarizeObservations,
} from "./mineru-benchmark.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SUITE_IDS = JSON.parse(
  readFileSync(join(REPO_ROOT, "references/acceptance/mineru-v2/manifest.json"), "utf8"),
).samples.map(({ id }) => id);
const roots = [];

const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "riskflow-mineru-benchmark-"));
  roots.push(dir);
  return dir;
};

const selfHostedConfig = (dir) => {
  const path = join(dir, "config.json");
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: "1",
      deploymentRef: { entityId: "mineru-local", versionId: "1" },
      qualityPolicyRef: { entityId: "mineru-local-quality", versionId: "1" },
      resourceAllocationRef: { entityId: "mineru-local-resources", versionId: "1" },
      protocol: "self-hosted-v1",
      endpoint: "http://127.0.0.1:18000",
      credentialRef: null,
    }),
  );
  return path;
};

const completed = (sampleId, elapsedMs, overrides = {}) => ({
  evidenceDir: "/evidence/" + sampleId,
  status: "completed",
  sampleId,
  protocol: "self-hosted-v1",
  elapsedMs,
  pages: 1,
  compliance: true,
  checks: { keyFields: 3, records: 2, pages: 1 },
  inputSha256: "sha-" + sampleId,
  deploymentRef: "mineru-local@1",
  qualityPolicyRef: "mineru-local-quality@1",
  resourceAllocationRef: "mineru-local-resources@1",
  ...overrides,
});

const failed = (sampleId, code) => ({
  evidenceDir: "/evidence/failed-" + sampleId,
  status: "failed",
  sampleId,
  protocol: "self-hosted-v1",
  elapsedMs: 1200,
  pages: null,
  compliance: null,
  checks: null,
  inputSha256: "sha-" + sampleId,
  deploymentRef: "mineru-local@1",
  qualityPolicyRef: "mineru-local-quality@1",
  resourceAllocationRef: "mineru-local-resources@1",
  code,
});

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

describe("benchmark CLI arguments and deployment boundary", () => {
  it("defaults to three warm repeats and rejects out-of-range counts", () => {
    expect(parseArguments(["a.json", "out"]).repeats).toBe(3);
    expect(parseArguments(["a.json", "out", "5"]).repeats).toBe(5);
    for (const argv of [
      ["a.json", "out", "2"],
      ["a.json", "out", "11"],
      ["a.json", "out", "3.5"],
    ])
      expect(() => parseArguments(argv)).toThrow(MineruBenchmarkError);
    expect(() => parseArguments(["a.json"])).toThrow(MineruBenchmarkError);
  });

  it("accepts loopback self-hosted configuration only", () => {
    const base = {
      deploymentRef: { entityId: "mineru-local", versionId: "1" },
      resourceAllocationRef: { entityId: "mineru-local-resources", versionId: "1" },
      qualityPolicyRef: { entityId: "mineru-local-quality", versionId: "1" },
      protocol: "self-hosted-v1",
      endpoint: "http://127.0.0.1:18000",
    };
    expect(assertLocalSelfHostedConfig(base).protocol).toBe("self-hosted-v1");
    expect(() =>
      assertLocalSelfHostedConfig({ ...base, endpoint: "http://10.0.0.5:18000" }),
    ).toThrow(MineruBenchmarkError);
    expect(() => assertLocalSelfHostedConfig({ ...base, protocol: "official-v4" })).toThrow(
      MineruBenchmarkError,
    );
  });

  it("refuses to write into an existing report root", () => {
    const dir = tempDir();
    const reportDir = join(dir, "report");
    selfHostedConfig(dir);
    mkdirSync(reportDir);
    expect(() =>
      runBenchmark({ configPath: join(dir, "config.json"), reportDir, repeats: 3, spawn: () => 0 }),
    ).toThrow(MineruBenchmarkError);
  });
});

describe("aggregation", () => {
  it("reports median and throughput only from enough samples and never for pageless input", () => {
    expect(median([30, 10, 20])).toBe(20);
    expect(median([40, 10, 20, 30])).toBe(25);
    expect(pagesPerMinute(5, 30_000)).toBe(10);
    expect(pagesPerMinute(null, 30_000)).toBeNull();
    expect(pagesPerMinute(5, null)).toBeNull();

    const few = summarizeObservations([completed("A", 10), completed("A", 20)]);
    expect(few[0].medianElapsedMs).toBeNull();
    expect(few[0].pagesPerMinute).toBeNull();

    const enough = summarizeObservations([
      completed("A", 30_000, { pages: 5 }),
      completed("A", 10_000, { pages: 5 }),
      completed("A", 20_000, { pages: 5 }),
    ]);
    expect(enough[0].medianElapsedMs).toBe(20_000);
    expect(enough[0].pagesPerMinute).toBe(15);

    const docx = summarizeObservations([
      completed("DOCX", 10_000, { pages: null }),
      completed("DOCX", 20_000, { pages: null }),
      completed("DOCX", 30_000, { pages: null }),
    ]);
    expect(docx[0].medianElapsedMs).toBe(20_000);
    expect(docx[0].pagesPerMinute).toBeNull();
  });

  it("flags mixed input identity and mixed protocol across repeats", () => {
    expect(identityIssues([completed("A", 1), completed("A", 2)])).toEqual([]);
    expect(
      identityIssues([completed("A", 1), completed("A", 2, { inputSha256: "other" })]),
    ).toHaveLength(1);
    expect(
      identityIssues([completed("A", 1), completed("A", 2, { protocol: "official-v4" })]),
    ).toHaveLength(1);
  });

  it("never passes when a repeat failed or a sample is missing", () => {
    const pass = evaluateBenchmark({
      runs: [{ runId: "run-01", exitCode: 0 }],
      repeats: 3,
      expectedSampleIds: ["A"],
      observations: [completed("A", 1), completed("A", 2), completed("A", 3)],
    });
    expect(pass.status).toBe("FAIL");
    expect(pass.issues.join("\n")).toContain("未覆盖五格式");

    const mixed = evaluateBenchmark({
      runs: [{ runId: "run-01", exitCode: 1 }],
      repeats: 3,
      expectedSampleIds: SUITE_IDS,
      observations: [
        ...SUITE_IDS.flatMap((id) => [completed(id, 1), completed(id, 2)]),
        ...SUITE_IDS.map((id) => completed(id, 3)),
        failed(SUITE_IDS[0], "MINERU_QUALITY_FAILED"),
      ],
    });
    expect(mixed.status).toBe("FAIL");
    expect(mixed.issues.join("\n")).toContain("MINERU_QUALITY_FAILED");
    expect(mixed.issues.join("\n")).toContain("退出码 1");
  });
});

describe("benchmark run", () => {
  const writeEvidence = (runDir, failingSampleIndex) => {
    for (const [index, id] of SUITE_IDS.entries()) {
      const evidenceDir = join(runDir, "evidence-" + index);
      mkdirSync(evidenceDir, { mode: 0o700 });
      const report =
        index === failingSampleIndex
          ? {
              status: "failed",
              protocol: "self-hosted-v1",
              sampleId: id,
              code: "MINERU_QUALITY_FAILED",
            }
          : {
              status: "completed",
              protocol: "self-hosted-v1",
              sampleId: id,
              elapsedMs: 1000 + index * 100,
              pages: id.includes("docx") ? null : 1,
              compliance: true,
              checks: { keyFields: 3, records: 2, pages: id.includes("docx") ? null : 1 },
              inputSha256: "sha-" + id,
              deploymentRef: { entityId: "mineru-local", versionId: "1" },
              qualityPolicyRef: { entityId: "mineru-local-quality", versionId: "1" },
              resourceAllocationRef: { entityId: "mineru-local-resources", versionId: "1" },
            };
      writeFileSync(
        join(evidenceDir, report.status === "completed" ? "acceptance.json" : "failure.json"),
        JSON.stringify(report),
        { mode: 0o600 },
      );
    }
  };

  it("passes only when every repeat covers five formats with stable identity", () => {
    const dir = tempDir();
    const configPath = selfHostedConfig(dir);
    const reportDir = join(dir, "report");
    const spawn = (runDir) => {
      writeEvidence(runDir, -1);
      return 0;
    };
    const { report, reportPath } = runBenchmark({ configPath, reportDir, repeats: 3, spawn });
    expect(report.status).toBe("PASS");
    expect(report.issues).toEqual([]);
    expect(report.samples).toHaveLength(5);
    expect(report.samples.every(({ successfulRuns }) => successfulRuns === 3)).toBe(true);
    expect(statSync(reportPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(reportPath, "utf8")).status).toBe("PASS");
    expect(readObservation(join(reportDir, "run-01", "evidence-0")).checks).toEqual({
      keyFields: 3,
      records: 2,
      pages: 1,
    });
  });

  it("fails the whole benchmark while still completing the remaining repeats", () => {
    const dir = tempDir();
    const configPath = selfHostedConfig(dir);
    const reportDir = join(dir, "report");
    const seenRuns = [];
    const spawn = (runDir) => {
      seenRuns.push(runDir);
      writeEvidence(runDir, seenRuns.length === 2 ? 0 : -1);
      return seenRuns.length === 2 ? 1 : 0;
    };
    const { report } = runBenchmark({ configPath, reportDir, repeats: 3, spawn });
    expect(seenRuns).toHaveLength(4);
    expect(report.status).toBe("FAIL");
    expect(report.runs).toHaveLength(3);
    const failedSample = report.samples.find(({ failedRuns }) => failedRuns > 0);
    expect(failedSample.failedRuns).toBe(1);
    expect(failedSample.medianElapsedMs).toBeNull();
    expect(report.samples.filter(({ failedRuns }) => failedRuns === 0)).toHaveLength(4);
    expect(readObservation(join(reportDir, "run-01", "evidence-0")).protocol).toBe(
      "self-hosted-v1",
    );
  });
});
