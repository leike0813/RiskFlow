import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  FunctionalAcceptanceConfigV1Schema,
  requiredReferencesOfV1,
  runFunctionalAcceptance,
  terminalStatusOfV1,
} from "./functional.mjs";
import { operationIdFor } from "./synthetic.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACK_DIR = join(REPO_ROOT, "references", "acceptance", "synthetic-v1");
const tempRoots = [];
const tempDir = () => {
  const path = mkdtempSync(join(tmpdir(), "riskflow-functional-"));
  tempRoots.push(path);
  return path;
};
afterEach(() => {
  while (tempRoots.length > 0) rmSync(tempRoots.pop(), { recursive: true, force: true });
});

const detailQuery = operationIdFor("query", "agent-task.read");
const resultReadQuery = operationIdFor("query", "projection.result-read");
const runReadQuery = operationIdFor("query", "risk-identification.run-read");
const workflowRunRef = {
  kind: "workflow-run",
  reference: { entityId: "workflow-1", versionId: "1" },
};
const validConfig = () => ({
  schemaVersion: "1",
  runConfigFile: "run-config.json",
  observations: [
    {
      stepId: "start-task",
      operationId: detailQuery,
      payload: {
        kind: "detail",
        agentTaskRef: { kind: "agent-task", reference: { entityId: "task-1", versionId: "1" } },
      },
      expectedTerminalStatus: "completed",
      requiredReferences: [["resultRef", "formalResultRef"]],
    },
  ],
  pollIntervalMs: 1000,
  timeoutMs: 30_000,
  maxQueries: 10,
});

describe("功能验收配置契约", () => {
  it("接受有界的正式 Agent 任务详情观察配置", () => {
    expect(FunctionalAcceptanceConfigV1Schema.safeParse(validConfig()).success).toBe(true);
  });

  it.each(["submitted", "running", "waiting", "failed", "cancelled", "rejected", "succeeded"])(
    "拒绝非成功终态 %s",
    (expectedTerminalStatus) => {
      const config = validConfig();
      config.observations[0].expectedTerminalStatus = expectedTerminalStatus;
      expect(FunctionalAcceptanceConfigV1Schema.safeParse(config).success).toBe(false);
    },
  );

  it("拒绝缺少观察的配置、重复步骤和无界参数", () => {
    expect(
      FunctionalAcceptanceConfigV1Schema.safeParse({ ...validConfig(), observations: [] }).success,
    ).toBe(false);
    const duplicate = validConfig();
    duplicate.observations.push({ ...duplicate.observations[0] });
    expect(FunctionalAcceptanceConfigV1Schema.safeParse(duplicate).success).toBe(false);
    expect(
      FunctionalAcceptanceConfigV1Schema.safeParse({ ...validConfig(), maxQueries: Infinity })
        .success,
    ).toBe(false);
  });
});

describe("正式查询目标终态定位", () => {
  it("只读取 Agent 任务 detail Schema 的 summary.status", () => {
    expect(
      terminalStatusOfV1(
        detailQuery,
        { kind: "detail" },
        {
          kind: "detail",
          summary: { status: "completed" },
          history: { status: "running" },
        },
      ),
    ).toBe("completed");
    expect(
      terminalStatusOfV1(
        detailQuery,
        { kind: "detail" },
        {
          kind: "list",
          items: [{ status: "completed" }],
        },
      ),
    ).toBeUndefined();
  });

  it("不会把列表子项、历史或其他 query 的嵌套 status 当作目标终态", () => {
    expect(
      terminalStatusOfV1(
        detailQuery,
        { kind: "list" },
        {
          kind: "list",
          items: [{ status: "completed" }],
        },
      ),
    ).toBeUndefined();
    expect(
      terminalStatusOfV1(
        operationIdFor("query", "risk-identification.run-read"),
        {},
        {
          status: "completed",
          history: { status: "completed" },
        },
      ),
    ).toBeUndefined();
  });

  it("projection run-view 只取同次 start 回执对应的唯一 run-summary", () => {
    const payload = {
      queryResultRef: { kind: "query-result", reference: { entityId: "query-1", versionId: "1" } },
    };
    const page = {
      kind: "page",
      queryType: "run-view",
      items: [
        {
          kind: "run-summary",
          workflowRunRef,
          status: "completed",
          latestResultRef: ref("risk-assessment-record", "assessment-1"),
        },
        {
          kind: "run-summary",
          workflowRunRef: {
            kind: "workflow-run",
            reference: { entityId: "child-1", versionId: "1" },
          },
          status: "running",
        },
      ],
    };
    expect(terminalStatusOfV1(resultReadQuery, payload, page, { workflowRunRef })).toBe(
      "completed",
    );
    expect(
      requiredReferencesOfV1(page, [["items", 0, "latestResultRef"]], resultReadQuery, {
        workflowRunRef,
      }),
    ).toEqual({ "items.0.latestResultRef": ref("risk-assessment-record", "assessment-1") });
    expect(
      requiredReferencesOfV1(page, [["items", 1, "latestResultRef"]], resultReadQuery, {
        workflowRunRef,
      }),
    ).toBeNull();
    expect(
      terminalStatusOfV1(resultReadQuery, payload, page, {
        workflowRunRef: {
          kind: "workflow-run",
          reference: { entityId: "missing", versionId: "1" },
        },
      }),
    ).toBeUndefined();
    expect(
      terminalStatusOfV1(
        resultReadQuery,
        payload,
        {
          ...page,
          items: [page.items[0], page.items[0]],
        },
        { workflowRunRef },
      ),
    ).toBeUndefined();
  });

  it("risk-identification.run-read 只接受与 start 回执相同的 runRef", () => {
    const payload = { kind: "run-read", runRef: workflowRunRef };
    expect(
      terminalStatusOfV1(
        runReadQuery,
        payload,
        {
          kind: "run-read",
          runRef: workflowRunRef,
          status: "completed",
          history: { status: "running" },
        },
        { workflowRunRef },
      ),
    ).toBe("completed");
    expect(
      terminalStatusOfV1(
        runReadQuery,
        payload,
        {
          kind: "run-read",
          runRef: {
            ...workflowRunRef,
            reference: { ...workflowRunRef.reference, entityId: "other" },
          },
          status: "completed",
        },
        { workflowRunRef },
      ),
    ).toBeUndefined();
  });

  it("要求目标终态之外还必须有正式业务结果引用", () => {
    const frozenInputRef = {
      kind: "content-artifact",
      reference: { entityId: "artifact-1", versionId: "1" },
    };
    const formalResultRef = ref("response-recommendation", "recommendation-1");
    const result = { kind: "detail", resultRef: { formalResultRef } };
    expect(requiredReferencesOfV1(result, [["resultRef", "formalResultRef"]], detailQuery)).toEqual(
      { "resultRef.formalResultRef": formalResultRef },
    );
    expect(
      requiredReferencesOfV1(
        { kind: "detail", summary: { frozenInputRef } },
        [["summary", "frozenInputRef"]],
        detailQuery,
      ),
    ).toBeNull();
  });
});

const ref = (kind, entityId) => ({ kind, reference: { entityId, versionId: "1" } });
const workflowRef = workflowRunRef;
const session = () => ({
  schemaVersion: "1",
  sessionRef: { entityId: "session-1", versionId: "1" },
  accountRef: { entityId: "account-1", versionId: "1" },
  passwordChangeRequired: false,
  restricted: false,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

const httpFixture = ({
  runStatuses = ["completed"],
  missingFormalRef = false,
  forbidRead = false,
  hangStart = false,
} = {}) => {
  const requests = [];
  let readCount = 0;
  const fetchImpl = async (url, init) => {
    const target = new globalThis.URL(String(url));
    const body = init.body === undefined ? null : JSON.parse(init.body);
    requests.push({ path: target.pathname, body });
    const reply = (status, data, headers = {}) =>
      new globalThis.Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json", ...headers },
      });
    if (target.pathname === "/api/v1/session/login") {
      return reply(200, session(), {
        "set-cookie": "__Host-riskflow_session=fixture-secret; Path=/",
      });
    }
    if (target.pathname.endsWith("/commands/workflow.start-run")) {
      if (hangStart) {
        return await new Promise((_, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new globalThis.DOMException("aborted", "AbortError")),
            {
              once: true,
            },
          );
        });
      }
      return reply(200, { kind: "succeeded", result: { workflowRunRef, disposition: "created" } });
    }
    if (target.pathname.endsWith("/queries/projection.query")) {
      return reply(200, {
        kind: "succeeded",
        result: { queryResultRef: ref("query-result", "query-1") },
      });
    }
    if (target.pathname.endsWith("/queries/projection.result-read")) {
      if (forbidRead) return reply(403, { code: "QUERY_FORBIDDEN" });
      const status = runStatuses[Math.min(readCount, runStatuses.length - 1)];
      readCount += 1;
      const runSummary = {
        kind: "run-summary",
        workflowRunRef: workflowRef,
        status,
        entryIdentity: { entityId: "entry-1", versionId: "1" },
        auditTrailRef: ref("audit-trail", "audit-1"),
        ...(missingFormalRef
          ? {}
          : { latestResultRef: ref("risk-assessment-record", "assessment-1") }),
      };
      return reply(200, {
        kind: "succeeded",
        result: { kind: "page", queryType: "run-view", items: [runSummary] },
      });
    }
    return reply(404, { code: "NOT_FOUND" });
  };
  return { fetchImpl, requests };
};

const integrationInputs = (
  root,
  { manual = false, observationStepId = "start-run", timeoutMs = 5_000, maxQueries = 4 } = {},
) => {
  const runConfigPath = join(root, "run-config.json");
  const baseBindings = {
    projectRevisionRef: ref("project-revision", "revision-1"),
    spatialScopeRef: ref("spatial-scope", "scope-1"),
    sourceVersionRef: ref("source-version", "source-1"),
  };
  const commands = [
    ...(manual
      ? [
          {
            stepId: "human-prerequisite",
            type: "manual",
            instruction: "Wait for the external operator",
            requiredBindings: ["externalDecisionRef"],
          },
        ]
      : []),
    {
      stepId: "start-run",
      type: "http",
      operationId: operationIdFor("command", "workflow.start-run"),
      payload: {
        entryMode: "identify-and-assess",
        graphVersion: { entityId: "graph-1", versionId: "1" },
        retryPolicyRef: { entityId: "retry-1", versionId: "1" },
        projectRevisionRef: { $binding: "projectRevisionRef" },
        spatialScopeRefs: [{ $binding: "spatialScopeRef" }],
        sourceVersionRefs: [{ $binding: "sourceVersionRef" }],
      },
      requestedSpatialScopeRefs: [{ $binding: "spatialScopeRef" }],
      requestedSourceVersionRefs: [{ $binding: "sourceVersionRef" }],
      captures: { workflowRunRef: ["result", "workflowRunRef"] },
    },
    {
      stepId: "projection-query",
      type: "http",
      operationId: operationIdFor("query", "projection.query"),
      payload: {
        queryType: "run-view",
        workflowRunRef: { $result: "start-run", path: ["workflowRunRef"] },
      },
      captures: { queryResultRef: ["result", "queryResultRef"] },
    },
  ];
  writeFileSync(
    runConfigPath,
    JSON.stringify({
      schemaVersion: "1",
      baseUrl: "https://functional.invalid",
      projectId: "project-1",
      loginName: "acceptance-user",
      password: "fixture-password-secret",
      timeoutMs: 10_000,
      bindings: baseBindings,
      commands,
    }),
  );
  const configPath = join(root, "functional-config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: "1",
      runConfigFile: "run-config.json",
      observations: [
        {
          stepId: observationStepId,
          operationId: operationIdFor("query", "projection.result-read"),
          payload: {
            queryResultRef: { $result: "projection-query", path: ["queryResultRef"] },
          },
          expectedTerminalStatus: "completed",
          requiredReferences: [["items", 0, "latestResultRef"]],
        },
      ],
      pollIntervalMs: 5,
      timeoutMs,
      maxQueries,
    }),
  );
  return { configPath, runConfigPath };
};

describe("功能验收真实 runner 行为", () => {
  it("异步提交后只在同一 run 终态完成且有正式结果引用时通过，并继承原授权范围", async () => {
    const root = tempDir();
    const outputDir = join(root, "output");
    integrationInputs(root);
    const fixture = httpFixture({ runStatuses: ["running", "completed"] });
    const result = await runFunctionalAcceptance({
      packDir: PACK_DIR,
      configPath: join(root, "functional-config.json"),
      outputDir,
      fetchImpl: fixture.fetchImpl,
    });
    expect(result.status).toBe("PASS");
    expect(
      fixture.requests.filter((request) => request.path.endsWith("projection.result-read")),
    ).toHaveLength(2);
    const observedRequest = fixture.requests.find((request) =>
      request.path.endsWith("projection.result-read"),
    );
    expect(observedRequest.body.requestedSpatialScopeRefs).toEqual([
      ref("spatial-scope", "scope-1"),
    ]);
    expect(observedRequest.body.requestedSourceVersionRefs).toEqual([
      ref("source-version", "source-1"),
    ]);
    const persisted = [
      "functional.json",
      "functional.md",
      "synthetic/run.json",
      "synthetic/report.md",
    ].map((path) => readFileSync(join(outputDir, path), "utf8"));
    expect(persisted.join("\n")).not.toContain("fixture-password-secret");
    expect(persisted.join("\n")).not.toContain("fixture-secret");
    expect(result.state.observations[0].references["items.0.latestResultRef"]).toEqual(
      ref("risk-assessment-record", "assessment-1"),
    );
  });

  it("遗漏已提交步骤观察时阻塞", async () => {
    const root = tempDir();
    integrationInputs(root, { observationStepId: "missing-step" });
    const result = await runFunctionalAcceptance({
      packDir: PACK_DIR,
      configPath: join(root, "functional-config.json"),
      outputDir: join(root, "output"),
      fetchImpl: httpFixture().fetchImpl,
    });
    expect(result.status).toBe("BLOCKED");
    expect(result.state.reason).toBe("SUBMITTED_STEP_WITHOUT_OBSERVATION");
  });

  it("人审前置等待与缺少正式结果引用都不能通过", async () => {
    const waitingRoot = tempDir();
    integrationInputs(waitingRoot, { manual: true });
    const waiting = await runFunctionalAcceptance({
      packDir: PACK_DIR,
      configPath: join(waitingRoot, "functional-config.json"),
      outputDir: join(waitingRoot, "output"),
      fetchImpl: httpFixture().fetchImpl,
    });
    expect(waiting.status).toBe("awaiting-human");

    const refRoot = tempDir();
    integrationInputs(refRoot, { maxQueries: 1 });
    const missing = await runFunctionalAcceptance({
      packDir: PACK_DIR,
      configPath: join(refRoot, "functional-config.json"),
      outputDir: join(refRoot, "output"),
      fetchImpl: httpFixture({ missingFormalRef: true }).fetchImpl,
    });
    expect(missing.status).toBe("BLOCKED");
    expect(missing.state.observations[0].status).not.toBe("passed");
  });

  it("查询权限拒绝与超 deadline 的挂起请求都阻塞并按时结束", async () => {
    const forbiddenRoot = tempDir();
    integrationInputs(forbiddenRoot);
    const forbidden = await runFunctionalAcceptance({
      packDir: PACK_DIR,
      configPath: join(forbiddenRoot, "functional-config.json"),
      outputDir: join(forbiddenRoot, "output"),
      fetchImpl: httpFixture({ forbidRead: true }).fetchImpl,
    });
    expect(forbidden.status).toBe("BLOCKED");
    expect(forbidden.state.observations[0].reason).toBe("QUERY_FORBIDDEN");

    const timeoutRoot = tempDir();
    integrationInputs(timeoutRoot, { timeoutMs: 40 });
    const startedAt = Date.now();
    const timeout = await runFunctionalAcceptance({
      packDir: PACK_DIR,
      configPath: join(timeoutRoot, "functional-config.json"),
      outputDir: join(timeoutRoot, "output"),
      fetchImpl: httpFixture({ hangStart: true }).fetchImpl,
    });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(timeout.status).toBe("BLOCKED");
    expect(timeout.state.reason).toBe("FUNCTIONAL_TIMEOUT");
  });
});
