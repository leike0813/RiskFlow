#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { setTimeout, clearTimeout } from "node:timers";
import { pathToFileURL, URL } from "node:url";
const { z } = createRequire(new URL("../../packages/contracts/dist/index.js", import.meta.url))(
  "zod",
);
import {
  AgentTaskResultRefV1Schema,
  ContractReferenceV1Schema,
  ProjectionReportFactRefV1Schema,
  WorkflowRunRefV1Schema,
  AgentTaskRefV1Schema,
  SpatialScopeRefV1Schema,
  SourceVersionRefV1Schema,
} from "../../packages/contracts/dist/ports/index.js";
import {
  checkPack,
  createReadOnlyQuerySession,
  isQueryOperationV1,
  operationIdFor,
  runPack,
  SyntheticAcceptanceError,
} from "./synthetic.mjs";

const CONFIG_LIMIT_BYTES_V1 = 1024 * 1024;
const MAX_POLL_INTERVAL_MS_V1 = 60_000;
const MAX_TIMEOUT_MS_V1 = 3_600_000;
const MAX_QUERY_COUNT_V1 = 10_000;
const SUCCESS_TERMINAL_STATUSES_V1 = ["completed"];
const PositiveInt = (max) => z.number().int().positive().max(max);
const PathPart = z.union([
  z.string().min(1),
  z.number().int().nonnegative(),
  z.strictObject({ kind: z.string().min(1).max(128) }),
]);
const ObservationV1Schema = z.strictObject({
  stepId: z.string().min(1).max(128),
  operationId: z
    .string()
    .min(1)
    .refine(isQueryOperationV1, "must name a registered query operation"),
  payload: z.unknown(),
  expectedTerminalStatus: z.enum(SUCCESS_TERMINAL_STATUSES_V1),
  requiredReferences: z.array(z.array(PathPart).min(1).max(32)).min(1).max(32),
});

export const FunctionalAcceptanceConfigV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    runConfigFile: z.string().min(1),
    mode: z.literal("existing-formal-references").optional(),
    targets: z
      .array(
        z.strictObject({
          stepId: z.string().min(1).max(128),
          resultRef: z.union([
            z.strictObject({ workflowRunRef: WorkflowRunRefV1Schema }),
            z.strictObject({ agentTaskRef: AgentTaskRefV1Schema }),
          ]),
          requestedSpatialScopeRefs: z.array(SpatialScopeRefV1Schema),
          requestedSourceVersionRefs: z.array(SourceVersionRefV1Schema),
        }),
      )
      .min(1)
      .max(128)
      .optional(),
    observations: z.array(ObservationV1Schema).min(1).max(128),
    pollIntervalMs: PositiveInt(MAX_POLL_INTERVAL_MS_V1),
    timeoutMs: PositiveInt(MAX_TIMEOUT_MS_V1),
    maxQueries: PositiveInt(MAX_QUERY_COUNT_V1),
  })
  .superRefine((config, context) => {
    if (
      (config.mode === undefined && config.targets !== undefined) ||
      (config.mode !== undefined &&
        (config.targets === undefined ||
          config.targets.length !== config.observations.length ||
          new Set(config.targets.map((target) => target.stepId)).size !== config.targets.length ||
          config.targets.some(
            (target) => !config.observations.some((item) => item.stepId === target.stepId),
          )))
    ) {
      context.addIssue({ code: "custom", path: ["targets"] });
    }
    const ids = new Set();
    for (const [index, observation] of config.observations.entries()) {
      if (ids.has(observation.stepId)) {
        context.addIssue({ code: "custom", path: ["observations", index, "stepId"] });
      }
      ids.add(observation.stepId);
      const paths = new Set(observation.requiredReferences.map((path) => JSON.stringify(path)));
      if (paths.size !== observation.requiredReferences.length) {
        context.addIssue({ code: "custom", path: ["observations", index, "requiredReferences"] });
      }
    }
  });

const readJson = (path) => {
  let content;
  try {
    if (statSync(path).size > CONFIG_LIMIT_BYTES_V1) {
      throw new SyntheticAcceptanceError("FUNCTIONAL_CONFIG_TOO_LARGE");
    }
    content = readFileSync(path);
  } catch {
    throw new SyntheticAcceptanceError("FUNCTIONAL_CONFIG_UNREADABLE");
  }
  try {
    return JSON.parse(content.toString("utf8"));
  } catch {
    throw new SyntheticAcceptanceError("FUNCTIONAL_CONFIG_INVALID_JSON");
  }
};

const valueAtPath = (value, path) => {
  let current = value;
  for (const part of path) {
    if (typeof part === "object") {
      if (!Array.isArray(current)) return undefined;
      const matches = current.filter((item) => item?.kind === part.kind);
      if (matches.length !== 1) return undefined;
      current = matches[0];
      continue;
    }
    if (current === null || typeof current !== "object" || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
};

const HUMAN_WAIT_STATUSES = new Set([
  "awaiting-human",
  "waiting",
  "waiting-for-human",
  "waiting-review",
  "waiting-user-confirmation",
  "pending-review",
]);

const hasTerminalStatusPathV1 = (operationId, payload) =>
  (operationId === operationIdFor("query", "agent-task.read") && payload?.kind === "detail") ||
  (operationId === operationIdFor("query", "risk-identification.run-read") &&
    payload?.runRef !== undefined) ||
  (operationId === operationIdFor("query", "risk-assessment.read") &&
    payload?.operation === "run-read") ||
  (operationId === operationIdFor("query", "projection.result-read") &&
    payload?.queryResultRef !== undefined);

const sameReferenceV1 = (left, right) =>
  left?.kind !== undefined &&
  left?.reference?.entityId !== undefined &&
  left?.reference?.versionId !== undefined &&
  left?.kind === right?.kind &&
  left?.reference?.entityId === right?.reference?.entityId &&
  left?.reference?.versionId === right?.reference?.versionId;

const isRunViewPageV1 = (result) => result?.kind === "page" && result.queryType === "run-view";

const projectionTargetIndexV1 = (result, expectedTargetRef) => {
  if (!isRunViewPageV1(result)) return -1;
  const matches = result.items.flatMap((item, index) =>
    item.kind === "run-summary" && sameReferenceV1(item.workflowRunRef, expectedTargetRef)
      ? [index]
      : [],
  );
  return matches.length === 1 ? matches[0] : -1;
};

/**
 * Agent 完成的正式产出只有契约主引用三族；`validationRef` 等辅助引用不构成完成证明。
 * 引用 kind 与三族互斥由 AgentTaskResultRefV1Schema 整体校验，此处不再另判。
 */
const AGENT_TASK_PRIMARY_OUTPUT_FIELDS_V1 = new Set([
  "incrementRef",
  "candidateRef",
  "formalResultRef",
]);

const completedAgentTaskResultV1 = (result, expectedTaskRef) => {
  if (result?.kind !== "detail") return null;
  const parsed = AgentTaskResultRefV1Schema.safeParse(result.resultRef);
  return parsed.success &&
    parsed.data.status === "completed" &&
    sameReferenceV1(parsed.data.agentTaskRef, expectedTaskRef)
    ? parsed.data
    : null;
};

const isAgentTaskFormalPathV1 = (path) =>
  path.length === 2 && path[0] === "resultRef" && AGENT_TASK_PRIMARY_OUTPUT_FIELDS_V1.has(path[1]);

/**
 * run-view 页内能证明属于本次 run 的正式结果路径：目标 run-summary 的 `latestResultRef`，
 * 或归属同一 run 的 `report-fact.factRef`——同一运行可披露多条事实，按项内 `workflowRunRef`
 * 判定归属而不是要求唯一。report-absence 与其它 run 的行都不是正式业务事实。
 */
const projectionFormalSchemaV1 = (result, path, expectedRunRef) => {
  if (!isRunViewPageV1(result)) return null;
  if (path.length !== 3 || path[0] !== "items" || typeof path[1] !== "number") return null;
  const item = result.items[path[1]];
  if (path[2] === "latestResultRef" && item?.kind === "run-summary") {
    return path[1] === projectionTargetIndexV1(result, expectedRunRef)
      ? ContractReferenceV1Schema
      : null;
  }
  if (path[2] === "factRef" && item?.kind === "report-fact") {
    return sameReferenceV1(item.workflowRunRef, expectedRunRef)
      ? ProjectionReportFactRefV1Schema
      : null;
  }
  return null;
};

/** 路径能证明正式结果时返回该路径的引用 Schema，否则返回 null。 */
const formalResultSchemaV1 = (result, path, operationId, targetResultRef) => {
  if (operationId === operationIdFor("query", "risk-assessment.read")) {
    return result?.kind === "run-read" &&
      sameReferenceV1(result.runRef, targetResultRef.workflowRunRef) &&
      path.length === 2 &&
      path[0] === "resultRefs" &&
      (Number.isInteger(path[1]) || typeof path[1] === "object") &&
      ["assessment-run-result", "risk-flow-run-result"].includes(valueAtPath(result, path)?.kind)
      ? ContractReferenceV1Schema
      : null;
  }
  if (operationId === operationIdFor("query", "agent-task.read")) {
    return completedAgentTaskResultV1(result, targetResultRef.agentTaskRef) !== null &&
      isAgentTaskFormalPathV1(path)
      ? ContractReferenceV1Schema
      : null;
  }
  if (operationId === operationIdFor("query", "projection.result-read")) {
    return projectionFormalSchemaV1(result, path, targetResultRef.workflowRunRef);
  }
  if (operationId === operationIdFor("query", "risk-identification.run-read")) {
    return path.length === 2 && path[0] === "acceptedRiskRecordRefs" && Number.isInteger(path[1])
      ? ContractReferenceV1Schema
      : null;
  }
  return null;
};

export const requiredReferencesOfV1 = (result, paths, operationId, targetResultRef = {}) => {
  const schemas = paths.map((path) =>
    formalResultSchemaV1(result, path, operationId, targetResultRef),
  );
  if (!schemas.some((schema) => schema !== null)) return null;
  const references = {};
  for (const [index, path] of paths.entries()) {
    if (schemas[index] === null) return null;
    const value = valueAtPath(result, path);
    if (!(schemas[index] ?? ContractReferenceV1Schema).safeParse(value).success) return null;
    references[
      path.map((part) => (typeof part === "object" ? `[kind=${part.kind}]` : part)).join(".")
    ] = value;
  }
  return references;
};

/** Only paths verified against the formal query result DTO are eligible to determine PASS. */
export const terminalStatusOfV1 = (operationId, payload, result, targetResultRef = {}) => {
  if (
    operationId === operationIdFor("query", "risk-assessment.read") &&
    payload?.operation === "run-read" &&
    result?.kind === "run-read" &&
    sameReferenceV1(result.runRef, targetResultRef.workflowRunRef)
  ) {
    return result.status;
  }
  if (
    operationId === operationIdFor("query", "agent-task.read") &&
    payload?.kind === "detail" &&
    result?.kind === "detail" &&
    sameReferenceV1(result.summary?.agentTaskRef, targetResultRef.agentTaskRef)
  ) {
    return result.summary?.status;
  }
  if (
    operationId === operationIdFor("query", "risk-identification.run-read") &&
    payload?.runRef !== undefined &&
    result?.kind === "run-read" &&
    sameReferenceV1(result.runRef, targetResultRef.workflowRunRef)
  ) {
    return result.status;
  }
  if (
    operationId === operationIdFor("query", "projection.result-read") &&
    payload?.queryResultRef !== undefined &&
    isRunViewPageV1(result)
  ) {
    const index = projectionTargetIndexV1(result, targetResultRef.workflowRunRef);
    return index < 0 ? undefined : result.items[index].status;
  }
  return undefined;
};

const digestOf = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const runConfigDigestOfV1 = (config) =>
  digestOf({
    ...config,
    password: createHash("sha256")
      .update(String(config.password ?? ""))
      .digest("hex"),
  });

/** 桌面宿主只读同次报告；沿原摘要拒绝换配置、换运行或未受理的回执。 */
export const readFunctionalAcceptanceReportV1 = (configPath, reportPath) => {
  const configFile = resolve(configPath);
  const config = FunctionalAcceptanceConfigV1Schema.parse(readJson(configFile));
  if (config.mode !== undefined)
    throw new SyntheticAcceptanceError("FUNCTIONAL_REPORT_RUN_MISMATCH");
  const runConfig = readJson(resolve(dirname(configFile), config.runConfigFile));
  const report = readJson(resolve(reportPath));
  const synthetic = readJson(join(dirname(resolve(reportPath)), "synthetic", "run.json"));
  if (
    report.schemaVersion !== "1" ||
    synthetic.schemaVersion !== "1" ||
    typeof report.runId !== "string" ||
    report.runId !== synthetic.runId ||
    !["RUNNING", "PASS", "awaiting-human"].includes(report.status) ||
    report.configDigest !== digestOf(config) ||
    report.runConfigDigest !== runConfigDigestOfV1(runConfig) ||
    !["COMPLETED", "SUBMITTED"].includes(synthetic.status) ||
    !Array.isArray(synthetic.steps) ||
    synthetic.steps.length < 1
  ) {
    throw new SyntheticAcceptanceError("FUNCTIONAL_REPORT_RUN_MISMATCH");
  }
  return { config, runConfig, report, synthetic };
};

const renderReport = (state) =>
  [
    "# RiskFlow 功能验收观察",
    "",
    `- status: ${state.status}`,
    `- runId: ${state.runId ?? "unavailable"}`,
    `- queryCount: ${state.queryCount}`,
    `- evidenceSource: ${state.evidenceSource ?? "submitted-run"}`,
    ...state.observations.flatMap((observation) => [
      "",
      `## ${observation.stepId}`,
      `- operationId: ${observation.operationId}`,
      `- status: ${observation.status}`,
      `- expectedTerminalStatus: ${observation.expectedTerminalStatus}`,
      `- observedStatus: ${observation.observedStatus ?? "unavailable"}`,
      `- references: ${JSON.stringify(observation.references ?? {})}`,
      ...(observation.reason === undefined ? [] : [`- reason: ${observation.reason}`]),
    ]),
    "",
  ].join("\n");

const safePersist = (state, output) => {
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "functional.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  writeFileSync(join(output, "functional.md"), renderReport(state), "utf8");
};

const blockedObservation = (observation, reason, status = "blocked") => ({
  stepId: observation.stepId,
  operationId: observation.operationId,
  expectedTerminalStatus: observation.expectedTerminalStatus,
  status,
  reason,
  queryCount: 0,
  references: {},
});

export const runFunctionalAcceptance = async ({
  packDir,
  configPath,
  outputDir,
  resume = false,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
}) => {
  const pack = resolve(packDir);
  const configFile = resolve(configPath);
  const output = resolve(outputDir);
  const statePath = join(output, "functional.json");
  const prior = existsSync(statePath) ? readJson(statePath) : null;
  if (prior !== null && !resume) {
    return { ok: false, status: "REFUSED", exitCode: 1, state: prior };
  }
  if (prior === null && existsSync(output) && readdirSync(output).length > 0) {
    return {
      ok: false,
      status: "REFUSED",
      exitCode: 1,
      state: { schemaVersion: "1", status: "REFUSED", reason: "OUTPUT_NOT_EMPTY" },
    };
  }
  const config = FunctionalAcceptanceConfigV1Schema.safeParse(readJson(configFile));
  if (!config.success) {
    const state = {
      schemaVersion: "1",
      status: "BLOCKED",
      reason: "FUNCTIONAL_CONFIG_INVALID",
      queryCount: 0,
      observations: [],
    };
    return { ok: false, status: state.status, exitCode: 1, state };
  }
  const acceptance = config.data;
  const runConfigPath = resolve(dirname(configFile), acceptance.runConfigFile);
  const runConfig = readJson(runConfigPath);
  const check = checkPack(pack);
  const runConfigDigest = runConfigDigestOfV1(runConfig);
  const configDigest = digestOf(acceptance);
  if (
    prior !== null &&
    (!resume || prior.configDigest !== configDigest || prior.runConfigDigest !== runConfigDigest)
  ) {
    return { ok: false, status: "REFUSED", exitCode: 1, state: prior };
  }
  const startedAt = prior?.startedAt ?? now();
  const initialState = prior ?? {
    schemaVersion: "1",
    configDigest,
    runConfigDigest,
    startedAt,
    runId: null,
    evidenceSource: acceptance.mode ?? "submitted-run",
    status: "RUNNING",
    queryCount: 0,
    observations: acceptance.observations.map((item) => ({
      stepId: item.stepId,
      operationId: item.operationId,
      expectedTerminalStatus: item.expectedTerminalStatus,
      status: "pending",
      queryCount: 0,
      references: {},
    })),
  };
  if (prior === null) safePersist(initialState, output);
  const deadline = startedAt + acceptance.timeoutMs;
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => deadlineController.abort(), Math.max(0, deadline - now()));
  deadlineTimer.unref?.();

  let runState;
  let runStatus;
  if (acceptance.mode === "existing-formal-references") {
    runState = {
      runId: prior?.runId ?? `formal-observation-${randomUUID()}`,
      steps: acceptance.targets,
      bindings: {},
    };
    runStatus = "READ_ONLY";
    initialState.targets = acceptance.targets.map(({ stepId, resultRef }) => ({
      stepId,
      resultRef,
    }));
  } else {
    let synthetic;
    try {
      synthetic = await runPack({
        packDir: pack,
        configPath: runConfigPath,
        outputDir: join(output, "synthetic"),
        resume: existsSync(join(output, "synthetic", "run.json")),
        fetchImpl,
        signal: deadlineController.signal,
      });
    } catch {
      synthetic = null;
    }
    runState = synthetic?.state;
    runStatus = synthetic?.status;
  }
  if (!check.ok || runState?.runId == null || deadlineController.signal.aborted) {
    initialState.status = "BLOCKED";
    initialState.reason = !check.ok
      ? "PACK_CHECK_FAILED"
      : deadlineController.signal.aborted
        ? "FUNCTIONAL_TIMEOUT"
        : "SYNTHETIC_RUN_UNAVAILABLE";
    initialState.checkProblemCount = check.problems.length;
    initialState.syntheticStatus = runStatus ?? "unavailable";
    safePersist(initialState, output);
    return { ok: false, status: initialState.status, exitCode: 1, state: initialState };
  }
  initialState.runId = runState.runId;
  initialState.syntheticStatus = runStatus;

  const submitted =
    acceptance.mode === "existing-formal-references"
      ? runState.steps
      : runState.steps.filter((step) => step.status === "submitted");
  const waiting = runState.steps.some((step) => step.status === "waiting");
  if (waiting) {
    initialState.status = "awaiting-human";
    initialState.observations = initialState.observations.map((item) =>
      blockedObservation(
        acceptance.observations.find((entry) => entry.stepId === item.stepId),
        "HUMAN_PREREQUISITE",
        "awaiting-human",
      ),
    );
    safePersist(initialState, output);
    return { ok: false, status: initialState.status, exitCode: 1, state: initialState };
  }
  const observationIds = new Set(acceptance.observations.map((item) => item.stepId));
  if (submitted.some((step) => !observationIds.has(step.stepId))) {
    initialState.status = "BLOCKED";
    initialState.reason = "SUBMITTED_STEP_WITHOUT_OBSERVATION";
    initialState.submittedStepCount = submitted.length;
    safePersist(initialState, output);
    return { ok: false, status: initialState.status, exitCode: 1, state: initialState };
  }
  if (
    acceptance.observations.some(
      (observation) => !submitted.some((step) => step.stepId === observation.stepId),
    )
  ) {
    initialState.status = "BLOCKED";
    initialState.reason = "OBSERVATION_STEP_NOT_SUBMITTED";
    safePersist(initialState, output);
    return { ok: false, status: initialState.status, exitCode: 1, state: initialState };
  }

  if (!["COMPLETED", "SUBMITTED", "READ_ONLY"].includes(runStatus)) {
    initialState.status = "BLOCKED";
    initialState.reason = "SYNTHETIC_RUN_NOT_READY";
    safePersist(initialState, output);
    return { ok: false, status: initialState.status, exitCode: 1, state: initialState };
  }

  const steps = new Map(runState.steps.map((step) => [step.stepId, step]));
  let querySession;
  try {
    querySession = await createReadOnlyQuerySession({
      config: runConfig,
      runId: runState.runId,
      fetchImpl,
      signal: deadlineController.signal,
    });
  } catch (error) {
    initialState.status = "BLOCKED";
    initialState.reason = deadlineController.signal.aborted
      ? "FUNCTIONAL_TIMEOUT"
      : (error.code ?? "QUERY_SESSION_FAILED");
    safePersist(initialState, output);
    return { ok: false, status: initialState.status, exitCode: 1, state: initialState };
  }

  for (const [index, observation] of acceptance.observations.entries()) {
    if (!hasTerminalStatusPathV1(observation.operationId, observation.payload)) {
      initialState.status = "BLOCKED";
      initialState.reason = "TERMINAL_STATUS_PATH_UNSUPPORTED";
      initialState.observations[index].status = "blocked";
      initialState.observations[index].reason = "TERMINAL_STATUS_PATH_UNSUPPORTED";
      safePersist(initialState, output);
      return { ok: false, status: initialState.status, exitCode: 1, state: initialState };
    }
    let result = initialState.observations[index];
    if (result?.status === "passed") continue;
    if (result === undefined || result.stepId !== observation.stepId) {
      result = {
        stepId: observation.stepId,
        operationId: observation.operationId,
        expectedTerminalStatus: observation.expectedTerminalStatus,
        status: "pending",
        queryCount: 0,
        references: {},
      };
      initialState.observations[index] = result;
    }

    while (now() < deadline && initialState.queryCount < acceptance.maxQueries) {
      initialState.queryCount += 1;
      result.queryCount += 1;
      safePersist(initialState, output);
      try {
        const targetStep = steps.get(observation.stepId);
        const body = await querySession.query({
          packDir: pack,
          steps,
          bindings: runState.bindings ?? {},
          stepId: observation.stepId,
          operationId: observation.operationId,
          payload: observation.payload,
          queryId: `${runState.runId}-${observation.stepId}-${result.queryCount}`.slice(0, 200),
          requestedSpatialScopeRefs: targetStep?.requestedSpatialScopeRefs ?? [],
          requestedSourceVersionRefs: targetStep?.requestedSourceVersionRefs ?? [],
        });
        const observed = terminalStatusOfV1(
          observation.operationId,
          observation.payload,
          body,
          targetStep?.resultRef,
        );
        result.observedStatus = observed ?? null;
        if (HUMAN_WAIT_STATUSES.has(observed)) {
          result.status = "awaiting-human";
          result.reason = "FORMAL_RESULT_WAITING_FOR_HUMAN";
          initialState.status = "awaiting-human";
          safePersist(initialState, output);
          return { ok: false, status: initialState.status, exitCode: 1, state: initialState };
        }
        const references = requiredReferencesOfV1(
          body,
          observation.requiredReferences,
          observation.operationId,
          targetStep?.resultRef,
        );
        if (observed === observation.expectedTerminalStatus && references !== null) {
          result.status = "passed";
          result.references = references;
          result.reason = undefined;
          safePersist(initialState, output);
          break;
        }
        if (observed === undefined) {
          result.status = "blocked";
          result.reason = "TERMINAL_STATUS_PATH_UNRESOLVED";
          initialState.status = "BLOCKED";
          safePersist(initialState, output);
          return { ok: false, status: initialState.status, exitCode: 1, state: initialState };
        }
        result.status = "observing";
        result.references = {};
        result.reason =
          observed === undefined
            ? "TERMINAL_STATUS_PATH_UNRESOLVED"
            : observed === observation.expectedTerminalStatus
              ? "REQUIRED_REFERENCE_MISSING"
              : "TERMINAL_STATUS_PENDING";
      } catch (error) {
        if (error.code === "QUERY_AWAITING_HUMAN") {
          result.status = "awaiting-human";
          result.reason = "FORMAL_RESULT_WAITING_FOR_HUMAN";
          initialState.status = "awaiting-human";
          safePersist(initialState, output);
          return { ok: false, status: initialState.status, exitCode: 1, state: initialState };
        }
        result.status = "blocked";
        result.reason = deadlineController.signal.aborted
          ? "OBSERVATION_TIMEOUT"
          : (error.code ?? "QUERY_FAILED");
        initialState.status = "BLOCKED";
        safePersist(initialState, output);
        return { ok: false, status: initialState.status, exitCode: 1, state: initialState };
      }
      if (result.status === "passed") break;
      safePersist(initialState, output);
      const remaining = deadline - now();
      if (remaining > 0 && initialState.queryCount < acceptance.maxQueries) {
        await sleep(Math.min(acceptance.pollIntervalMs, remaining));
      }
    }
    if (result.status !== "passed") {
      result.status = "blocked";
      result.reason = now() >= deadline ? "OBSERVATION_TIMEOUT" : "QUERY_BUDGET_EXHAUSTED";
      initialState.status = "BLOCKED";
      safePersist(initialState, output);
      return { ok: false, status: initialState.status, exitCode: 1, state: initialState };
    }
  }

  initialState.status = "PASS";
  clearTimeout(deadlineTimer);
  safePersist(initialState, output);
  return { ok: true, status: initialState.status, exitCode: 0, state: initialState };
};

export const main = async (argv) => {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) throw new SyntheticAcceptanceError("ARGUMENT_INVALID");
    if (argv[index] === "--resume") args.set("resume", true);
    else {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new SyntheticAcceptanceError("ARGUMENT_VALUE_MISSING");
      }
      args.set(argv[index].slice(2), value);
      index += 1;
    }
  }
  for (const name of ["pack", "config", "output"]) {
    if (!args.has(name)) throw new SyntheticAcceptanceError("ARGUMENT_MISSING", name);
  }
  const result = await runFunctionalAcceptance({
    packDir: args.get("pack"),
    configPath: args.get("config"),
    outputDir: args.get("output"),
    resume: args.get("resume") === true,
  });
  process.stdout.write(
    `${JSON.stringify({ status: result.status, queryCount: result.state.queryCount })}\n`,
  );
  return result.exitCode;
};

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error.code ?? "FUNCTIONAL_ACCEPTANCE_FAILED"}\n`);
      process.exitCode = 1;
    },
  );
}
