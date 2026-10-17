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
  it("评估详情分开运行身份与状态版本，只有同次正式结果可证明完成", () => {
    const operation = operationIdFor("query", "risk-assessment.read");
    const payload = { operation: "run-read", workflowRunRef };
    const result = {
      kind: "run-read",
      runRef: workflowRunRef,
      stateVersion: { entityId: workflowRunRef.reference.entityId, versionId: "later-state" },
      status: "completed",
      resultRefs: [ref("stage-result", "stage-1"), ref("risk-flow-run-result", "result-1")],
    };
    expect(terminalStatusOfV1(operation, payload, result, { workflowRunRef })).toBe("completed");
    expect(
      requiredReferencesOfV1(result, [["resultRefs", 1]], operation, { workflowRunRef }),
    ).toEqual({ "resultRefs.1": result.resultRefs[1] });
    expect(
      requiredReferencesOfV1(result, [["resultRefs", 0]], operation, { workflowRunRef }),
    ).toBeNull();
    expect(
      requiredReferencesOfV1(
        result,
        [
          ["resultRefs", 0],
          ["resultRefs", 1],
        ],
        operation,
        {
          workflowRunRef,
        },
      ),
    ).toBeNull();
    for (const reference of [
      { ...workflowRunRef.reference, entityId: "other-run" },
      { ...workflowRunRef.reference, versionId: "wrong-version" },
    ]) {
      const changed = { ...result, runRef: { ...workflowRunRef, reference } };
      expect(terminalStatusOfV1(operation, payload, changed, { workflowRunRef })).toBeUndefined();
      expect(
        requiredReferencesOfV1(changed, [["resultRefs", 1]], operation, { workflowRunRef }),
      ).toBeNull();
    }
  });
  it("只读取 Agent 任务 detail Schema 的 summary.status", () => {
    expect(
      terminalStatusOfV1(
        detailQuery,
        { kind: "detail" },
        {
          kind: "detail",
          summary: { status: "completed", agentTaskRef: agentTaskRef("data-cleaning") },
          history: { status: "running" },
        },
        { agentTaskRef: agentTaskRef("data-cleaning") },
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
    const result = {
      kind: "detail",
      resultRef: agentTaskCompletedResult("response-recommendation", { formalResultRef }),
    };
    expect(
      requiredReferencesOfV1(result, [["resultRef", "formalResultRef"]], detailQuery, {
        agentTaskRef: result.resultRef.agentTaskRef,
      }),
    ).toEqual({ "resultRef.formalResultRef": formalResultRef });
    expect(
      requiredReferencesOfV1(
        { kind: "detail", summary: { frozenInputRef } },
        [["summary", "frozenInputRef"]],
        detailQuery,
      ),
    ).toBeNull();
  });

  it.each([
    ["data-cleaning", "incrementRef", "content-artifact", "cleaning-1"],
    ["knowledge-authoring", "incrementRef", "content-artifact", "authoring-1"],
    ["knowledge-authoring", "candidateRef", "knowledge-revision", "revision-1"],
    ["retrieval-review", "incrementRef", "retrieval-artifact-set", "retrieval-1"],
    ["response-recommendation", "candidateRef", "recommendation-candidate", "candidate-1"],
    ["response-recommendation", "formalResultRef", "response-recommendation", "recommendation-1"],
    ["calibration-suggestion", "candidateRef", "calibration-suggestion", "suggestion-candidate-1"],
    ["calibration-suggestion", "formalResultRef", "calibration-suggestion", "suggestion-1"],
  ])("接受 %s 任务已完成的 %s 正式产出引用", (taskType, field, refKind, entityId) => {
    const outputRef = ref(refKind, entityId);
    const result = {
      kind: "detail",
      resultRef: agentTaskCompletedResult(taskType, { [field]: outputRef }),
    };
    expect(
      requiredReferencesOfV1(result, [["resultRef", field]], detailQuery, {
        agentTaskRef: result.resultRef.agentTaskRef,
      }),
    ).toEqual({ [`resultRef.${field}`]: outputRef });
  });

  it("Agent 任务引用类型错配、主产出并存或只有辅助引用都不算完成证明", () => {
    const cases = [
      // retrieval-review 的 incrementRef 必须是检索工件集，内容工件 kind 与任务类型错配。
      agentTaskCompletedResult("retrieval-review", {
        incrementRef: ref("content-artifact", "artifact-1"),
      }),
      // 主产出互斥：同时候选与正式结果不符合契约。
      agentTaskCompletedResult("response-recommendation", {
        candidateRef: ref("recommendation-candidate", "candidate-1"),
        formalResultRef: ref("response-recommendation", "recommendation-1"),
      }),
      // 只有校验引用，不构成完成证明。
      agentTaskCompletedResult("data-cleaning", {
        validationRef: ref("validation-snapshot", "validation-1"),
      }),
    ];
    for (const resultRef of cases) {
      const result = { kind: "detail", resultRef };
      for (const field of ["incrementRef", "candidateRef", "formalResultRef", "validationRef"]) {
        expect(
          requiredReferencesOfV1(result, [["resultRef", field]], detailQuery, {
            agentTaskRef: resultRef.agentTaskRef,
          }),
        ).toBeNull();
      }
    }
  });

  it("Agent 任务未完成时不接受任何主产出引用", () => {
    const result = {
      kind: "detail",
      resultRef: {
        kind: "agent-task-result",
        reference: ref("agent-task-result", "result-1").reference,
        status: "failed",
        agentTaskRef: agentTaskRef("data-cleaning"),
        errorRef: ref("workflow-error", "error-1"),
      },
    };
    expect(
      requiredReferencesOfV1(result, [["resultRef", "formalResultRef"]], detailQuery),
    ).toBeNull();
  });

  it("缺少目标身份或混入其它 Agent 任务的结果时不能证明本次完成", () => {
    const expected = agentTaskRef("data-cleaning");
    const other = { ...expected, reference: { entityId: "other-task", versionId: "1" } };
    const result = {
      kind: "detail",
      summary: { status: "completed", agentTaskRef: expected },
      resultRef: {
        ...agentTaskCompletedResult("data-cleaning", {
          incrementRef: ref("content-artifact", "cleaning-1"),
        }),
        agentTaskRef: other,
      },
    };
    expect(terminalStatusOfV1(detailQuery, { kind: "detail" }, result)).toBeUndefined();
    expect(
      terminalStatusOfV1(
        detailQuery,
        { kind: "detail" },
        {
          kind: "detail",
          summary: {
            status: "completed",
          },
        },
      ),
    ).toBeUndefined();
    expect(
      requiredReferencesOfV1(result, [["resultRef", "incrementRef"]], detailQuery, {
        agentTaskRef: expected,
      }),
    ).toBeNull();
  });

  it("projection run-view 只接受归属本次 run 的 report-fact 引用", () => {
    const otherRunRef = {
      kind: "workflow-run",
      reference: { entityId: "child-1", versionId: "1" },
    };
    const factRef = ref("risk-assessment-record", "assessment-1");
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
        { kind: "report-fact", workflowRunRef, factRef },
        {
          kind: "report-absence",
          workflowRunRef,
          tailKind: "response",
          reasonCode: "no-response-candidate",
          lastEstablishedRef: ref("risk-assessment-record", "assessment-1"),
        },
        {
          kind: "report-fact",
          workflowRunRef: otherRunRef,
          factRef: ref("warning-record", "warning-1"),
        },
      ],
    };
    expect(
      requiredReferencesOfV1(page, [["items", 1, "factRef"]], resultReadQuery, { workflowRunRef }),
    ).toEqual({ "items.1.factRef": factRef });
    // report-absence 的 lastEstablishedRef 不冒充正式业务事实。
    expect(
      requiredReferencesOfV1(page, [["items", 2, "lastEstablishedRef"]], resultReadQuery, {
        workflowRunRef,
      }),
    ).toBeNull();
    // 其它 run 的 report-fact 不能作为本次 run 的证据。
    expect(
      requiredReferencesOfV1(page, [["items", 3, "factRef"]], resultReadQuery, { workflowRunRef }),
    ).toBeNull();
    // 混入其它 run 的行时整组拒绝。
    expect(
      requiredReferencesOfV1(
        page,
        [
          ["items", 0, "latestResultRef"],
          ["items", 3, "factRef"],
        ],
        resultReadQuery,
        { workflowRunRef },
      ),
    ).toBeNull();
  });

  it("projection report-fact 必须落在已成立的业务事实引用上", () => {
    const page = {
      kind: "page",
      queryType: "run-view",
      items: [
        { kind: "run-summary", workflowRunRef, status: "completed" },
        {
          kind: "report-fact",
          workflowRunRef,
          factRef: ref("audit-trail", "audit-1"),
        },
      ],
    };
    expect(
      requiredReferencesOfV1(page, [["items", 1, "factRef"]], resultReadQuery, { workflowRunRef }),
    ).toBeNull();
  });
});

const ref = (kind, entityId) => ({ kind, reference: { entityId, versionId: "1" } });
const agentTaskRef = (taskType) => ({
  kind: "agent-task",
  reference: { entityId: "task-1", versionId: "1" },
  taskType,
  triggerMode: "embedded",
  modelDeploymentRef: ref("model-deployment", "deployment-1").reference,
  promptTemplateRef: ref("prompt-template", "template-1").reference,
  toolPolicyRef: ref("tool-policy", "tools-1").reference,
  budgetPolicyRef: ref("budget-policy", "budget-1").reference,
  incrementSchemaRef: ref("increment-schema", "schema-1").reference,
  validationPolicyRef: ref("validation-policy", "validation-1").reference,
});
const agentTaskCompletedResult = (taskType, outputs) => ({
  kind: "agent-task-result",
  reference: { entityId: "result-1", versionId: "1" },
  status: "completed",
  agentTaskRef: agentTaskRef(taskType),
  ...outputs,
});
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
