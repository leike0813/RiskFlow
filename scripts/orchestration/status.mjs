import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const V1_TASK_KINDS = new Set(["planning", "implementation", "verification", "archive"]);
const V2_TASK_KINDS = new Set(["planning", "implementation", "finalization", "audit", "archive"]);
const WORK_PHASES = new Set(["planning", "implementing", "finalizing", "integrating", "archiving"]);
const RUN_STATES = new Set(["queued", "running", "waiting", "settled"]);
const TASK_STATUSES = new Set(["pending", "ready", "dispatched", "completed", "failed", "blocked"]);
const TERMINAL_TASK_STATUSES = new Set(["completed", "failed"]);
const ACTIVE_TASK_STATUSES = new Set(["pending", "ready", "dispatched", "blocked"]);
const V1_TASK_OUTCOMES = new Set(["pending", "succeeded", "failed", "blocked"]);
const V2_TASK_OUTCOMES = new Set(["succeeded", "failed", "blocked", "paused"]);
const MAIN_VERIFICATIONS = new Set(["pending", "passed", "failed"]);
const TERMINAL_WORKER_STATES = new Set(["succeeded", "failed", "stopped", "abandoned"]);
const TERMINAL_DISPATCH_STATUSES = new Set(["completed", "failed"]);
const PHASE_ORDER = new Map([
  ["planning", 1],
  ["implementing", 2],
  ["implementation", 2],
  ["finalizing", 3],
  ["finalization", 3],
  ["verification", 3],
  ["integrating", 4],
  ["archiving", 5],
  ["archive", 5],
]);

export class CommandFailure extends Error {
  constructor(command, args, cause) {
    super(`command failed: ${command} ${args.join(" ")}: ${cause.message}`);
    this.name = "CommandFailure";
    this.command = command;
    this.args = args;
    this.exitCode = cause.code;
    this.cause = cause;
  }
}

export class InvalidJsonError extends Error {
  constructor(command, cause) {
    super(`invalid JSON from ${command}: ${cause.message}`);
    this.name = "InvalidJsonError";
    this.cause = cause;
  }
}

export async function defaultExec(command, args, options = {}) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      timeout: options.timeoutMs ?? 20_000,
      maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    throw new CommandFailure(command, args, error);
  }
}

export async function resolveCoordinatorRoot(rootDir, exec = defaultExec) {
  const common = String(
    await exec("git", ["rev-parse", "--git-common-dir"], { cwd: rootDir }),
  ).trim();
  const gitDir = common.startsWith("/") ? common : resolve(rootDir, common);
  return String(
    await exec("git", [`--git-dir=${gitDir}`, "rev-parse", "--show-toplevel"], { cwd: rootDir }),
  ).trim();
}

export async function readJsonCommand(exec, command, args, options = {}) {
  const output = await exec(command, args, options);
  if (typeof output === "object") return output;
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new InvalidJsonError(`${command} ${args.join(" ")}`, error);
  }
}

export function unwrapResult(payload) {
  if (payload && payload.ok === false) {
    throw new Error(payload.error?.message ?? "Orca command returned ok=false");
  }
  return payload?.result ?? payload;
}

function arrayAt(payload, keys) {
  const value = unwrapResult(payload);
  if (Array.isArray(value)) return value;
  for (const key of keys) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseTaskEnvelope(task) {
  const result = parseObject(task?.result);
  const envelope =
    parseObject(result?.execution) ?? parseObject(result?.executionEnvelope) ?? result;
  if (!envelope) return { valid: false, reason: "missing_result_object" };

  const schemaMissing = envelope.schemaVersion === undefined;
  const schemaVersion = schemaMissing ? 1 : Number(envelope.schemaVersion);
  const required =
    schemaVersion === 1
      ? ["changeId", "taskKind", "worktreeId", "baseHead", "head"]
      : [
          "workItemId",
          "changeName",
          "taskKind",
          "phase",
          "runState",
          "worktreeId",
          "inputHead",
          "attemptGroup",
          "auditPolicy",
        ];
  const missing = required.filter((field) => !nonEmptyString(envelope[field]));
  if (missing.length > 0) return { valid: false, reason: "missing_fields", missing };
  if (schemaMissing || ![1, 2].includes(schemaVersion)) {
    return { valid: false, reason: "invalid_schema_version", value: envelope.schemaVersion };
  }
  const taskKinds = schemaVersion === 1 ? V1_TASK_KINDS : V2_TASK_KINDS;
  if (!taskKinds.has(envelope.taskKind)) {
    return { valid: false, reason: "invalid_task_kind", value: envelope.taskKind };
  }
  if (!envelope.worktreeId.includes("::/")) {
    return { valid: false, reason: "worktree_id_not_full", value: envelope.worktreeId };
  }
  if (schemaVersion === 1 && envelope.phase !== undefined) {
    if (!nonEmptyString(envelope.phase)) return { valid: false, reason: "invalid_phase" };
    if (envelope.phase !== envelope.taskKind) {
      return {
        valid: false,
        reason: "phase_task_kind_mismatch",
        phase: envelope.phase,
        taskKind: envelope.taskKind,
      };
    }
  }
  if (schemaVersion === 2 && !WORK_PHASES.has(envelope.phase)) {
    return { valid: false, reason: "invalid_phase", value: envelope.phase };
  }
  if (schemaVersion === 2 && !RUN_STATES.has(envelope.runState)) {
    return { valid: false, reason: "invalid_run_state", value: envelope.runState };
  }
  const outcomes = schemaVersion === 1 ? V1_TASK_OUTCOMES : V2_TASK_OUTCOMES;
  if (envelope.outcome !== undefined && !outcomes.has(envelope.outcome)) {
    return { valid: false, reason: "invalid_outcome", value: envelope.outcome };
  }
  if (schemaVersion === 2 && envelope.runState === "settled" && !envelope.outcome) {
    return { valid: false, reason: "missing_settled_outcome" };
  }
  if (schemaVersion === 2 && envelope.runState !== "settled" && envelope.outcome !== undefined) {
    return { valid: false, reason: "premature_outcome" };
  }
  if (
    schemaVersion === 2 &&
    (!Number.isInteger(envelope.attempt) || Number(envelope.attempt) < 1)
  ) {
    return { valid: false, reason: "invalid_attempt", value: envelope.attempt };
  }
  if (schemaVersion === 2 && !["self", "targeted"].includes(envelope.auditPolicy)) {
    return { valid: false, reason: "invalid_audit_policy", value: envelope.auditPolicy };
  }
  if (
    schemaVersion === 2 &&
    (!envelope.owner ||
      typeof envelope.owner !== "object" ||
      !nonEmptyString(envelope.owner.taskId) ||
      !nonEmptyString(envelope.owner.agentClass) ||
      !nonEmptyString(envelope.owner.model))
  ) {
    return { valid: false, reason: "invalid_owner" };
  }
  for (const field of ["evidenceRefs", "issueRefs", "filesModified"]) {
    if (envelope[field] !== undefined && !Array.isArray(envelope[field])) {
      return {
        valid: false,
        reason: `invalid_${field.replace(/[A-Z]/gu, (c) => `_${c.toLowerCase()}`)}`,
      };
    }
  }
  for (const field of schemaVersion === 2 ? ["routeNodeId", "outputHead"] : []) {
    const value = envelope[field];
    if (value !== undefined && value !== null && !nonEmptyString(value)) {
      return { valid: false, reason: `invalid_${field}` };
    }
  }
  if (envelope.main !== undefined && (!envelope.main || typeof envelope.main !== "object")) {
    return { valid: false, reason: "invalid_main_summary" };
  }
  if (
    envelope.main?.verification !== undefined &&
    !MAIN_VERIFICATIONS.has(envelope.main.verification)
  ) {
    return {
      valid: false,
      reason: "invalid_main_verification",
      value: envelope.main.verification,
    };
  }
  for (const field of ["mergeCommit", "mainHead", "archiveCommit"]) {
    const value = envelope.main?.[field];
    if (value !== undefined && value !== null && !nonEmptyString(value)) {
      return { valid: false, reason: "invalid_main_summary", field };
    }
  }
  return {
    valid: true,
    ...envelope,
    schemaVersion,
    workItemId: schemaVersion === 1 ? envelope.changeId : envelope.workItemId,
    routeNodeId: schemaVersion === 1 ? envelope.changeId : (envelope.routeNodeId ?? null),
    changeId:
      schemaVersion === 1 ? envelope.changeId : (envelope.routeNodeId ?? envelope.workItemId),
    inputHead: schemaVersion === 1 ? envelope.baseHead : envelope.inputHead,
    outputHead: schemaVersion === 1 ? envelope.head : (envelope.outputHead ?? null),
    baseHead: schemaVersion === 1 ? envelope.baseHead : envelope.inputHead,
    head: schemaVersion === 1 ? envelope.head : (envelope.outputHead ?? envelope.inputHead),
    runState:
      schemaVersion === 1
        ? envelope.outcome === "pending"
          ? "running"
          : "settled"
        : envelope.runState,
    issueRefs: envelope.issueRefs ?? [],
    evidenceRefs: envelope.evidenceRefs ?? [],
  };
}

export function validateGraph(graph) {
  const issues = [];
  if (!graph || typeof graph !== "object" || !Array.isArray(graph.nodes)) {
    return ["graph.nodes must be an array"];
  }
  if (!nonEmptyString(graph.routeId)) issues.push("graph.routeId must be a non-empty string");
  if (![1, 2].includes(Number(graph.schemaVersion))) {
    issues.push("graph.schemaVersion must be 1 or 2");
  }
  if (Number(graph.schemaVersion) === 2) {
    const roles = graph.policy?.roles;
    for (const role of V2_TASK_KINDS) {
      if (
        !nonEmptyString(roles?.[role]?.agentClass) ||
        !nonEmptyString(roles?.[role]?.model) ||
        !nonEmptyString(roles?.[role]?.thinking)
      ) {
        issues.push(`graph.policy.roles.${role} must define agentClass, model, and thinking`);
      }
    }
    if (!Array.isArray(graph.policy?.phaseOrder)) {
      issues.push("graph.policy.phaseOrder must be an array");
    }
    if (!Array.isArray(graph.policy?.resumePriority)) {
      issues.push("graph.policy.resumePriority must be an array");
    }
    if (!Number.isInteger(graph.policy?.noProgressLimit) || graph.policy.noProgressLimit < 1) {
      issues.push("graph.policy.noProgressLimit must be a positive integer");
    }
  }
  const nodes = new Map();
  const changes = new Set();
  for (const node of graph.nodes) {
    if (!node || !nonEmptyString(node.id)) {
      issues.push("node id must be a non-empty string");
      continue;
    }
    if (nodes.has(node.id)) issues.push(`duplicate node id: ${node.id}`);
    nodes.set(node.id, node);
    if (!["change", "gate"].includes(node.kind)) issues.push(`${node.id}: invalid kind`);
    if (node.kind === "change") {
      if (!nonEmptyString(node.change))
        issues.push(`${node.id}: change must be a non-empty string`);
      else if (changes.has(node.change)) issues.push(`${node.id}: duplicate change ${node.change}`);
      else changes.add(node.change);
    }
    if (!Array.isArray(node.dependsOn)) issues.push(`${node.id}: dependsOn must be an array`);
    if (new Set(node.dependsOn ?? []).size !== (node.dependsOn ?? []).length) {
      issues.push(`${node.id}: duplicate dependency`);
    }
    for (const dependency of node.dependsOn ?? []) {
      if (!nonEmptyString(dependency)) {
        issues.push(`${node.id}: dependency must be a non-empty string`);
        continue;
      }
      if (dependency === node.id) issues.push(`${node.id}: self dependency`);
      else if (!graph.nodes.some((candidate) => candidate?.id === dependency)) {
        issues.push(`${node.id}: unknown dependency ${dependency}`);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(id, path = []) {
    if (visiting.has(id)) {
      issues.push(`dependency cycle: ${[...path, id].join(" -> ")}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of nodes.get(id)?.dependsOn ?? []) visit(dependency, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of nodes.keys()) visit(id);
  return [...new Set(issues)];
}

function topologicalNodes(graph) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const visited = new Set();
  const ordered = [];
  function visit(node) {
    if (visited.has(node.id)) return;
    for (const dependency of node.dependsOn ?? []) visit(nodes.get(dependency));
    visited.add(node.id);
    ordered.push(node);
  }
  for (const node of graph.nodes) visit(node);
  return ordered;
}

export function resolveOrcaInvocation(value = process.env.ORCA_CLI_COMMAND) {
  if (nonEmptyString(value)) {
    const [command, ...prefix] = value.trim().split(/\s+/u);
    return { command, prefix };
  }
  return {
    command: process.env.ORCA_TERMINAL_HANDLE ? "orca" : "orca-ide",
    prefix: [],
  };
}

function changeName(record) {
  return record?.name ?? record?.changeName ?? record?.id ?? null;
}

function extractOpenSpecChanges(payload) {
  return arrayAt(payload, ["changes", "items"])
    .map((record) => ({
      name: changeName(record),
      status: record?.status ?? null,
      raw: record,
    }))
    .filter((record) => nonEmptyString(record.name));
}

async function committedArchiveChangeNames(exec, rootDir) {
  const prefix = "openspec/changes/archive/";
  const output = await exec(
    "git",
    ["ls-tree", "-d", "--name-only", "-r", "HEAD", "--", "openspec/changes/archive"],
    { cwd: rootDir },
  );
  return [
    ...new Set(
      String(output)
        .split("\n")
        .filter((path) => path.startsWith(prefix))
        .map((path) => path.slice(prefix.length).split("/")[0])
        .filter(nonEmptyString),
    ),
  ];
}

function archivedName(names, change) {
  return names.some((name) => name === change || name.endsWith(`-${change}`));
}

async function collectGit(exec, cwd) {
  const [statusOutput, headOutput, branchOutput] = await Promise.all([
    exec("git", ["status", "--porcelain=v1", "--branch"], { cwd }),
    exec("git", ["rev-parse", "HEAD"], { cwd }),
    exec("git", ["branch", "--show-current"], { cwd }),
  ]);
  const lines = String(statusOutput).split("\n").filter(Boolean);
  const dirtyPaths = lines.filter((line) => !line.startsWith("## "));
  return {
    head: String(headOutput).trim(),
    branch: String(branchOutput).trim() || null,
    dirty: dirtyPaths.length > 0,
    dirtyPaths,
  };
}

async function isAncestor(exec, ancestor, descendant, cwd) {
  try {
    await exec("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd });
    return true;
  } catch (error) {
    if (error instanceof CommandFailure && error.exitCode === 1) return false;
    throw error;
  }
}

function normalizeWorktree(record, rootDir, repoId) {
  const path = record?.path ?? record?.worktreePath ?? null;
  const worktreeId = record?.worktreeId ?? (path && repoId ? `${repoId}::${path}` : null);
  return {
    id: worktreeId,
    path,
    repoId: record?.repoId ?? repoId ?? null,
    branch: record?.branch ?? null,
    isMain: Boolean(record?.isMainWorktree) || path === rootDir,
    liveTerminalCount: Number(record?.liveTerminalCount ?? 0),
    workspaceStatus: record?.workspaceStatus ?? null,
    raw: record,
  };
}

function normalizeTask(record, repoId) {
  const envelope = parseTaskEnvelope(record);
  const processRef = record?.created_by_process_incarnation ?? "";
  const repoOwned =
    Boolean(repoId && processRef.startsWith(`${repoId}::`)) ||
    (envelope.valid && envelope.worktreeId.startsWith(`${repoId}::`));
  return {
    id: record?.id ?? null,
    status: TASK_STATUSES.has(record?.status) ? record.status : "unknown",
    runId: record?.run_id ?? null,
    createdAt: record?.created_at ?? null,
    completedAt: record?.completed_at ?? null,
    envelope,
    repoOwned,
    raw: record,
  };
}

async function collectWorktree(exec, worktree, graph, tasks) {
  const base = {
    ...worktree,
    exists: Boolean(worktree.path && existsSync(worktree.path)),
    git: null,
    openSpec: null,
    openSpecNodeIds: [],
    openSpecNames: [],
    tasks: tasks.filter((task) => task.envelope.valid && task.envelope.worktreeId === worktree.id),
  };
  if (!base.exists) return base;

  const [git, openSpecPayload] = await Promise.all([
    collectGit(exec, worktree.path),
    readJsonCommand(exec, "openspec", ["list", "--json"], { cwd: worktree.path }),
  ]);
  const openSpec = extractOpenSpecChanges(openSpecPayload);
  const names = new Set(openSpec.map((record) => record.name));
  const openSpecNodeIds = graph.nodes
    .filter((node) => node.kind === "change" && names.has(node.change))
    .map((node) => node.id);
  const localNodeIds = [...openSpecNodeIds];
  for (const task of base.tasks) {
    const routeNodeId = task.envelope.routeNodeId ?? task.envelope.changeId;
    if (task.envelope.valid && routeNodeId && !localNodeIds.includes(routeNodeId)) {
      const node = graph.nodes.find((candidate) => candidate.id === routeNodeId);
      if (node?.kind === "change") localNodeIds.push(node.id);
    }
  }
  return {
    ...base,
    git,
    openSpec: { changes: openSpec },
    openSpecNames: [...names].sort(),
    openSpecNodeIds: [...new Set(openSpecNodeIds)],
    localNodeIds: [...new Set(localNodeIds)],
  };
}

function taskSummary(tasks) {
  const valid = tasks.filter((task) => task.envelope.valid);
  const maxPhase = Math.max(
    0,
    ...valid.map(
      (task) =>
        PHASE_ORDER.get(task.envelope.phase) ?? PHASE_ORDER.get(task.envelope.taskKind) ?? 0,
    ),
  );
  const phaseTasks = valid.filter((task) => {
    const order =
      PHASE_ORDER.get(task.envelope.phase) ?? PHASE_ORDER.get(task.envelope.taskKind) ?? 0;
    return order === maxPhase;
  });
  const maxAttempt = Math.max(0, ...phaseTasks.map((task) => Number(task.envelope.attempt ?? 0)));
  const attemptTasks = phaseTasks.filter(
    (task) => Number(task.envelope.attempt ?? 0) === maxAttempt,
  );
  const comparableCreationOrder = attemptTasks.every((task) => nonEmptyString(task.createdAt));
  const maxCreatedAt = comparableCreationOrder
    ? attemptTasks
        .map((task) => task.createdAt)
        .sort()
        .at(-1)
    : null;
  const current = maxCreatedAt
    ? attemptTasks.filter((task) => task.createdAt === maxCreatedAt)
    : attemptTasks;
  const signatures = new Set(
    current.map((task) => {
      const main = task.envelope.main;
      return JSON.stringify([
        task.status,
        task.envelope.outcome ?? null,
        main?.verification ?? null,
        main?.mainHead ?? null,
        main?.mergeCommit ?? null,
        main?.archiveCommit ?? null,
      ]);
    }),
  );
  const failed = current.find(
    (task) => task.status === "failed" || task.envelope.outcome === "failed",
  );
  const blocked = current.find((task) => task.status === "blocked");
  const active = current.find((task) => ACTIVE_TASK_STATUSES.has(task.status));
  const latest = current[0] ?? null;
  return {
    current,
    conflict: signatures.size > 1,
    failed,
    blocked,
    active,
    latest,
    hasActive: current.some((task) => ACTIVE_TASK_STATUSES.has(task.status)),
    allSettled:
      current.length > 0 && current.every((task) => TERMINAL_TASK_STATUSES.has(task.status)),
  };
}

function mainSummary(tasks, workItemId, mainHead) {
  const current = taskSummary(
    tasks.filter((task) => task.envelope.valid && task.envelope.workItemId === workItemId),
  );
  const summaries = current.current
    .map((task) => task.envelope.main)
    .filter((summary) => summary && typeof summary === "object");
  const verifications = [
    ...new Set(summaries.map((summary) => summary.verification).filter(nonEmptyString)),
  ];
  const mainHeads = [
    ...new Set(summaries.map((summary) => summary.mainHead).filter(nonEmptyString)),
  ];
  const mergeCommits = [
    ...new Set(summaries.map((summary) => summary.mergeCommit).filter(nonEmptyString)),
  ];
  const archiveCommits = [
    ...new Set(summaries.map((summary) => summary.archiveCommit).filter(nonEmptyString)),
  ];
  return {
    verification:
      verifications.length === 1
        ? verifications[0]
        : verifications.length > 1
          ? "conflict"
          : "unknown",
    mainHead:
      mainHeads.length === 1
        ? mainHeads[0]
        : mainHeads.length > 1
          ? "conflict"
          : (mainHead ?? null),
    mergeCommit:
      mergeCommits.length === 1 ? mergeCommits[0] : mergeCommits.length > 1 ? "conflict" : null,
    archiveCommit:
      archiveCommits.length === 1
        ? archiveCommits[0]
        : archiveCommits.length > 1
          ? "conflict"
          : null,
    conflict:
      verifications.length > 1 ||
      mainHeads.length > 1 ||
      mergeCommits.length > 1 ||
      archiveCommits.length > 1 ||
      current.conflict,
  };
}

function dependencySatisfied(dependencyState, dependency) {
  return (
    dependencyState.get(dependency) === "archived" ||
    dependencyState.get(dependency) === "reclaimable" ||
    dependencyState.get(dependency) === "completed" ||
    dependencyState.get(dependency) === "stale"
  );
}

function taskEvidence(task) {
  if (!task?.envelope?.valid) return null;
  return {
    taskId: task.id,
    runId: task.runId,
    workItemId: task.envelope.workItemId,
    changeName: task.envelope.changeName ?? null,
    taskKind: task.envelope.taskKind,
    phase: task.envelope.phase ?? task.envelope.taskKind,
    outcome: task.envelope.outcome ?? null,
    runState: task.envelope.runState ?? null,
    owner: task.envelope.owner ?? null,
    attemptGroup: task.envelope.attemptGroup ?? null,
    attempt: task.envelope.attempt ?? null,
    auditPolicy: task.envelope.auditPolicy ?? "self",
    issueRefs: task.envelope.issueRefs ?? [],
    main: task.envelope.main ?? {
      mergeCommit: null,
      mainHead: null,
      verification: "pending",
      archiveCommit: null,
    },
    head: task.envelope.outputHead ?? task.envelope.head,
    baseHead: task.envelope.inputHead ?? task.envelope.baseHead,
    evidenceRefs: Array.isArray(task.envelope.evidenceRefs) ? task.envelope.evidenceRefs : [],
  };
}

export function deriveNodeState(node, context) {
  const dependencies = context.dependencyState ?? new Map();
  const blockers = (node.dependsOn ?? []).filter(
    (dependency) => !dependencySatisfied(dependencies, dependency),
  );
  if (node.kind === "gate") {
    const status = blockers.length === 0 ? "completed" : "pending";
    return {
      id: node.id,
      kind: node.kind,
      change: null,
      phase: status,
      status,
      dependsOn: node.dependsOn,
      blockers,
      nextActions: blockers.length === 0 ? [] : [`等待依赖完成: ${blockers.join(", ")}`],
      violations: [],
    };
  }

  const worktrees = context.worktrees ?? [];
  const tasks = context.tasks ?? [];
  const violations = [];
  if (worktrees.length > 1)
    violations.push({
      code: "duplicate_active_worktree",
      worktreeIds: worktrees.map((item) => item.id),
    });
  const worktree = worktrees[0] ?? null;
  const summary = taskSummary(tasks);
  const localSpecPresent = worktrees.some(
    (item) => item.localNodeIds?.includes(node.id) || item.openSpecNames?.includes(node.change),
  );
  const openSpecPresent =
    worktree?.openSpecNodeIds?.includes(node.id) || worktree?.openSpecNames?.includes(node.change);
  const unlinkedLocal = localSpecPresent && tasks.length === 0 && !node.auxiliary;
  if (unlinkedLocal) violations.push({ code: "local_change_without_linked_task" });
  if (
    tasks.length > 0 &&
    worktree?.exists &&
    Array.isArray(worktree.openSpecNodeIds) &&
    !openSpecPresent
  ) {
    violations.push({ code: "task_missing_local_openspec" });
  }
  if (tasks.some((task) => !task.envelope.valid))
    violations.push({
      code: "unlinked_task_result",
      taskIds: tasks.filter((task) => !task.envelope.valid).map((task) => task.id),
    });

  const main = context.main ?? {};
  const mainArchive = archivedName(main.archiveNames ?? [], node.change);
  const mainState = mainSummary(tasks, node.id, main.head);
  if (mainState.conflict) violations.push({ code: "main_summary_conflict" });
  const mainCheckpointMatches =
    mainState.mainHead === main.head ||
    context.mainCheckpointAncestry?.[mainState.mainHead] === true;
  if (mainState.mainHead && main.head && !mainArchive && !mainCheckpointMatches) {
    violations.push({
      code: "main_checkpoint_mismatch",
      checkpointHead: mainState.mainHead,
      currentHead: main.head,
    });
  }
  if (
    worktree?.exists &&
    worktree.git?.head &&
    summary.latest?.envelope?.head &&
    worktree.git.head !== summary.latest.envelope.head
  ) {
    violations.push({
      code: "checkpoint_mismatch",
      checkpointHead: summary.latest.envelope.head,
      currentHead: worktree.git.head,
    });
  }
  if (worktree && !worktree.exists)
    violations.push({ code: "worktree_missing", worktreeId: worktree.id });
  const featureMerged = mainArchive || Boolean(context.ancestry?.[node.id]);
  const mainVerified = mainArchive || mainState.verification === "passed";
  const archived = featureMerged && Boolean(mainArchive);
  const unknownDirty = Boolean(worktree?.git?.dirty);
  const activeTerminal = Number(worktree?.liveTerminalCount ?? 0) > 0;
  const reclaimable =
    archived &&
    mainVerified &&
    context.ancestry?.[node.id] === true &&
    Boolean(worktree?.exists) &&
    !unknownDirty &&
    !activeTerminal &&
    summary.allSettled &&
    violations.length === 0;
  const completed = archived && mainVerified && !worktree?.exists;

  let status;
  let phase = summary.latest?.envelope?.phase ?? summary.latest?.envelope?.taskKind ?? null;
  let nextActions = [];
  const currentEnvelope = summary.latest?.envelope ?? null;
  const currentKind = currentEnvelope?.taskKind ?? null;
  const currentSucceeded = currentEnvelope?.outcome === "succeeded";
  if (violations.length > 0) {
    status = "unknown";
    nextActions = ["审阅 violations，禁止自动派发或回收"];
  } else if (blockers.length > 0 && !localSpecPresent && !featureMerged) {
    status = "pending";
    nextActions = [`等待依赖归档: ${blockers.join(", ")}`];
  } else if (completed) {
    status = "completed";
    phase = "completed";
  } else if (reclaimable) {
    status = "reclaimable";
    phase = "cleanup";
    nextActions = ["使用完整 worktreeId 执行 Orca worktree rm，然后重新运行 orchestration:check"];
  } else if (archived) {
    status = "stale";
    phase = "cleanup";
    nextActions = activeTerminal ? ["先收口残留 terminal/Dispatch"] : ["审阅脏状态后回收 worktree"];
  } else if (featureMerged && mainVerified) {
    status = "main_verified";
    phase = "integration";
    nextActions = ["完成 OpenSpec archive checkpoint"];
  } else if (featureMerged) {
    status = "merged";
    phase = "integration";
    nextActions = ["在 main 上完成冻结安装、pnpm verify 和主线验证"];
  } else if (currentEnvelope?.outcome === "paused") {
    status = "paused";
    nextActions = ["处理结构化升级条件；批准新规划后才可重开实现"];
  } else if (summary.failed && ["verification", "finalization"].includes(currentKind)) {
    status = "finalizing";
    phase = "finalizing";
    nextActions = ["由强模型 Finalizer 继续修复与回归，或移交新的强模型 Finalizer"];
  } else if (summary.failed) {
    status = "failed";
    nextActions = ["由当前责任角色按失败证据修复；仅真实设计边界变化进入重新规划"];
  } else if (summary.blocked) {
    status = "blocked";
    nextActions = ["处理 Orca task blocker 或升级决策"];
  } else if (currentEnvelope?.runState === "waiting" && blockers.length > 0) {
    status = "blocked";
    nextActions = [`等待依赖归档: ${blockers.join(", ")}`];
  } else if (currentEnvelope?.runState === "queued" && currentEnvelope.phase === "finalizing") {
    status = "finalizing";
    nextActions = ["派发强模型 Finalizer 接管当前产物"];
  } else if (currentEnvelope?.runState === "queued") {
    status = "running";
    nextActions = ["派发当前信封指定的受控任务"];
  } else if (
    currentSucceeded &&
    currentKind === "finalization" &&
    currentEnvelope.auditPolicy === "targeted"
  ) {
    status = "finalizing";
    phase = "finalizing";
    nextActions = ["派发不同强模型责任者执行限定范围 audit"];
  } else if (currentSucceeded && ["verification", "finalization", "audit"].includes(currentKind)) {
    status = "finalized";
    phase = "finalizing";
    nextActions = ["集成当前已验收产物"];
  } else if (currentSucceeded && currentKind === "implementation") {
    status = "finalizing";
    phase = "finalizing";
    nextActions = ["创建强模型 Finalizer 任务"];
  } else if (currentSucceeded && currentKind === "planning") {
    status = blockers.length > 0 ? "blocked" : "running";
    phase = "planning";
    nextActions =
      blockers.length > 0 ? [`等待依赖归档: ${blockers.join(", ")}`] : ["创建有界首轮实现任务"];
  } else if (node.auxiliary && localSpecPresent && tasks.length === 0) {
    status = "untracked";
    phase = "adopt";
    nextActions = ["adopt：登记 v2 执行信封后由强模型 Finalizer 接管"];
  } else if (summary.active || localSpecPresent) {
    status = "running";
    nextActions = summary.active
      ? ["等待当前 task 收口或处理下一阶段"]
      : ["补齐结构化 task 关联信封"];
  } else if (blockers.length === 0) {
    status = "ready";
    nextActions = ["创建当前 change 的 feature worktree 和结构化 task"];
  } else {
    status = "pending";
    nextActions = [`等待依赖归档: ${blockers.join(", ")}`];
  }

  if (unknownDirty && status === "stale") nextActions = ["未知未提交改动阻止强制回收，先人工审阅"];
  if (activeTerminal && status === "stale")
    nextActions = ["任务已归档但仍有活动 terminal，先收口 terminal/Dispatch"];
  if (main.archiveNames?.length && archivedName(main.archiveNames, node.change) && !mainVerified) {
    nextActions = ["补齐 main 主线验证结构化摘要，不能把 archive 当作 verify"];
  }
  const nodeWorkers = (context.workers ?? []).filter((worker) =>
    tasks.some((task) => task.id === worker.taskId),
  );
  const nodeTerminals = worktree?.terminals ?? [];

  return {
    id: node.id,
    workItemId: node.id,
    routeNodeId: node.auxiliary ? null : node.id,
    auxiliary: Boolean(node.auxiliary),
    kind: node.kind,
    change: node.change,
    phase,
    status,
    dependsOn: node.dependsOn,
    blockers,
    worktree: worktree
      ? {
          id: worktree.id,
          path: worktree.path,
          branch: worktree.git?.branch ?? worktree.branch ?? null,
          head: worktree.git?.head ?? null,
          exists: worktree.exists,
          dirty: worktree.git?.dirty ?? null,
          dirtyPaths: worktree.git?.dirtyPaths ?? [],
          liveTerminalCount: worktree.liveTerminalCount,
        }
      : null,
    orca: {
      taskIds: tasks.map((task) => task.id),
      statuses: tasks.map((task) => task.status),
      runIds: [...new Set(tasks.map((task) => task.runId).filter(Boolean))],
      dispatchIds: nodeWorkers.map((worker) => worker.dispatchId).filter(Boolean),
      workerStates: nodeWorkers.map((worker) => worker.workerState),
      terminalHandles: nodeTerminals.map((terminal) => terminal.handle).filter(Boolean),
      attempts: tasks.map(taskEvidence).filter(Boolean),
    },
    main: {
      head: main.head ?? null,
      merged: featureMerged,
      verification: mainVerified ? "passed" : mainState.verification,
      archive: archivedName(main.archiveNames ?? [], node.change),
      mergeCommit: mainState.mergeCommit,
      archiveCommit: mainState.archiveCommit,
    },
    checkpoints: taskEvidence(summary.latest),
    nextActions,
    violations,
  };
}

function taskMatchesNode(task, node) {
  if (!task.envelope.valid) return false;
  return node.auxiliary
    ? task.envelope.workItemId === node.id ||
        (task.envelope.schemaVersion === 2 && task.envelope.changeName === node.change)
    : (task.envelope.routeNodeId ?? task.envelope.changeId) === node.id;
}

function queueCategory(node) {
  if (["unknown", "untracked"].includes(node.status)) return "recovery";
  if (node.status === "finalizing") return "finalizing";
  if (["finalized", "merged", "main_verified"].includes(node.status)) return "integrating";
  if (node.status === "running" && node.phase === "implementing") return "implementing";
  if (node.status === "running" && node.phase === "planning") return "planning";
  if (node.status === "ready") return "ready";
  if (["stale", "reclaimable"].includes(node.status)) return "cleanup";
  return null;
}

function downstreamCounts(graph) {
  const dependents = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const node of graph.nodes) {
    for (const dependency of node.dependsOn ?? []) dependents.get(dependency)?.push(node.id);
  }
  const counts = new Map();
  const visit = (id, seen = new Set()) => {
    for (const dependent of dependents.get(id) ?? []) {
      if (seen.has(dependent)) continue;
      seen.add(dependent);
      visit(dependent, seen);
    }
    return seen.size;
  };
  for (const id of dependents.keys()) counts.set(id, visit(id));
  return counts;
}

function buildResumeQueue(graph, nodes) {
  const priorities = new Map(
    (
      graph.policy?.resumePriority ?? [
        "recovery",
        "finalizing",
        "integrating",
        "implementing",
        "planning",
        "ready",
        "cleanup",
      ]
    ).map((name, index) => [name, index]),
  );
  const topology = new Map(topologicalNodes(graph).map((node, index) => [node.id, index]));
  const downstream = downstreamCounts(graph);
  return nodes
    .map((node) => ({ node, category: queueCategory(node) }))
    .filter((entry) => entry.category)
    .sort(
      (left, right) =>
        (priorities.get(left.category) ?? 99) - (priorities.get(right.category) ?? 99) ||
        (downstream.get(right.node.routeNodeId) ?? 0) -
          (downstream.get(left.node.routeNodeId) ?? 0) ||
        (topology.get(left.node.routeNodeId) ?? Number.MAX_SAFE_INTEGER) -
          (topology.get(right.node.routeNodeId) ?? Number.MAX_SAFE_INTEGER) ||
        left.node.id.localeCompare(right.node.id),
    )
    .map(({ node, category }) => ({
      workItemId: node.id,
      routeNodeId: node.routeNodeId,
      changeName: node.change,
      category,
      status: node.status,
      phase: node.phase,
      responsibility:
        category === "finalizing"
          ? "strong-finalizer"
          : category === "implementing"
            ? "bounded-implementer"
            : category === "planning"
              ? "strong-planner"
              : "coordinator",
      worktreeId: node.worktree?.id ?? null,
      checkpoint: node.checkpoints?.head ?? node.worktree?.head ?? null,
      nextAction: node.nextActions[0] ?? null,
    }));
}

function snapshotRevision(snapshot) {
  const businessState = {
    routeId: snapshot.routeId,
    main: snapshot.main,
    frontier: snapshot.frontier,
    resumeQueue: snapshot.resumeQueue,
    nodes: snapshot.nodes,
    violations: snapshot.violations,
  };
  return createHash("sha256").update(JSON.stringify(businessState)).digest("hex");
}

export function deriveSnapshot(graph, facts) {
  const changeIds = new Set(
    graph.nodes.filter((node) => node.kind === "change").map((node) => node.id),
  );
  const dependencyState = new Map();
  const stateById = new Map();
  for (const node of topologicalNodes(graph)) {
    const state =
      node.kind === "gate"
        ? deriveNodeState(node, { dependencyState })
        : deriveNodeState(node, {
            ...facts,
            dependencyState,
            worktrees: (facts.worktrees ?? []).filter(
              (worktree) =>
                worktree.localNodeIds?.includes(node.id) ||
                worktree.tasks?.some((task) => taskMatchesNode(task, node)),
            ),
            tasks: (facts.tasks ?? []).filter((task) => taskMatchesNode(task, node)),
          });
    stateById.set(node.id, state);
    dependencyState.set(node.id, state.status);
  }
  const routeChangeNames = new Set(
    graph.nodes.filter((node) => node.kind === "change").map((node) => node.change),
  );
  const auxiliaryNodes = (facts.worktrees ?? [])
    .flatMap((worktree) =>
      (worktree.openSpecNames ?? [])
        .filter((name) => !routeChangeNames.has(name))
        .map((name) => ({
          id: `AUX:${name}`,
          kind: "change",
          change: name,
          dependsOn: [],
          auxiliary: true,
          worktree,
        })),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const auxiliaryStates = auxiliaryNodes.map((node) =>
    deriveNodeState(node, {
      ...facts,
      dependencyState,
      worktrees: [node.worktree],
      tasks: (facts.tasks ?? []).filter((task) => taskMatchesNode(task, node)),
    }),
  );
  const nodes = [...graph.nodes.map((node) => stateById.get(node.id)), ...auxiliaryStates];
  const changeStates = nodes.filter((node) => node.kind === "change");
  const violations = [
    ...nodes.flatMap((node) =>
      node.violations.map((violation) => ({ nodeId: node.id, ...violation })),
    ),
    ...(facts.unlinkedTasks ?? []).map((task) => ({
      nodeId: null,
      code: "unlinked_task_result",
      taskId: task.id,
    })),
    ...(facts.unknownTaskLinks ?? []).map((task) => ({
      nodeId: changeIds.has(task.changeId) ? task.changeId : null,
      code: "task_identity_conflict",
      ...task,
    })),
    ...changeStates
      .filter((node) => ["stale", "reclaimable"].includes(node.status))
      .map((node) => ({ nodeId: node.id, code: "worktree_reclaim_pending" })),
  ];
  const snapshot = {
    schemaVersion: 2,
    generatedAt: facts.generatedAt ?? new Date().toISOString(),
    routeId: graph.routeId,
    main: {
      head: facts.main?.head ?? null,
      branch: facts.main?.branch ?? null,
      dirty: facts.main?.dirty ?? false,
      dirtyPaths: facts.main?.dirtyPaths ?? [],
    },
    orca: {
      runs: facts.runs ?? [],
      workers: facts.workers ?? [],
      terminals: facts.terminals ?? [],
    },
    frontier: changeStates.filter((node) => node.status === "ready").map((node) => node.id),
    resumeQueue: buildResumeQueue(graph, changeStates),
    nodes,
    staleWorktrees: changeStates
      .filter((node) => ["stale", "reclaimable"].includes(node.status))
      .map((node) => node.worktree?.id)
      .filter(Boolean),
    unlinkedTasks: (facts.unlinkedTasks ?? []).map((task) => ({
      id: task.id,
      status: task.status,
      runId: task.runId,
    })),
    diagnostics: facts.diagnostics ?? [],
    violations,
  };
  return { ...snapshot, revision: snapshotRevision(snapshot) };
}

function extractWorktrees(payload) {
  return arrayAt(payload, ["worktrees", "items"]);
}

function extractTasks(payload) {
  return arrayAt(payload, ["tasks", "items"]);
}

function extractRuns(payload) {
  return arrayAt(payload, ["runs", "items"]);
}

function extractWorkers(payload) {
  return arrayAt(payload, ["workers", "items"]);
}

function extractTerminals(payload) {
  return arrayAt(payload, ["terminals", "items"]);
}

function normalizeRun(record) {
  return {
    id: record?.id ?? null,
    objective: record?.objective ?? null,
    legacy: Boolean(record?.legacy),
    createdAt: record?.created_at ?? null,
    updatedAt: record?.updated_at ?? null,
  };
}

function normalizeWorker(record) {
  return {
    dispatchId: record?.dispatchId ?? null,
    taskId: record?.taskId ?? null,
    runId: record?.runId ?? null,
    workerState: record?.workerState ?? null,
    dispatchStatus: record?.dispatchStatus ?? null,
    terminalHandle: record?.agentTerminalHandle ?? null,
    terminalState: record?.terminalState ?? null,
    worktreeId: record?.resource?.worktreeId ?? null,
  };
}

function normalizeTerminal(record) {
  return {
    handle: record?.handle ?? null,
    worktreeId: record?.worktreeId ?? null,
    worktreePath: record?.worktreePath ?? null,
    branch: record?.branch ?? null,
    connected: Boolean(record?.connected),
    orphaned: Boolean(record?.orphaned),
    lastOutputAt: record?.lastOutputAt ?? null,
  };
}

function cursorAt(payload) {
  const value = unwrapResult(payload);
  return nonEmptyString(value?.nextCursor) ? value.nextCursor : null;
}

async function collectRuns(exec, orcaInvocation, rootDir) {
  const records = new Map();
  const seenCursors = new Set();
  let cursor = null;
  do {
    const args = [
      ...orcaInvocation.prefix,
      "orchestration",
      "run-list",
      "--limit",
      "100",
      ...(cursor ? ["--cursor", cursor] : []),
      "--json",
    ];
    const payload = await readJsonCommand(exec, orcaInvocation.command, args, { cwd: rootDir });
    for (const record of extractRuns(payload)) {
      if (nonEmptyString(record?.id)) records.set(record.id, record);
    }
    const nextCursor = cursorAt(payload);
    if (!nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);
  return [...records.values()].map(normalizeRun);
}

function workerIsLive(worker) {
  return (
    !TERMINAL_WORKER_STATES.has(worker.workerState) &&
    !TERMINAL_DISPATCH_STATUSES.has(worker.dispatchStatus)
  );
}

async function collectFacts({ rootDir, graph, exec, orcaInvocation }) {
  const worktreePayload = await readJsonCommand(
    exec,
    orcaInvocation.command,
    [...orcaInvocation.prefix, "worktree", "list", "--repo", `path:${rootDir}`, "--json"],
    { cwd: rootDir },
  );
  const rawWorktrees = extractWorktrees(worktreePayload);
  const repoId =
    rawWorktrees.find((record) => record.repoId)?.repoId ??
    rawWorktrees.map((record) => record.worktreeId?.split("::/")[0]).find(nonEmptyString) ??
    null;
  const worktrees = rawWorktrees.map((record) => normalizeWorktree(record, rootDir, repoId));

  const [allRuns, workerPayload] = await Promise.all([
    collectRuns(exec, orcaInvocation, rootDir),
    readJsonCommand(
      exec,
      orcaInvocation.command,
      [...orcaInvocation.prefix, "orchestration", "worker-list", "--json"],
      { cwd: rootDir },
    ),
  ]);
  const taskPayloads = await Promise.all(
    allRuns
      .filter((run) => nonEmptyString(run.id))
      .map((run) =>
        readJsonCommand(
          exec,
          orcaInvocation.command,
          [...orcaInvocation.prefix, "orchestration", "task-list", "--run", run.id, "--json"],
          { cwd: rootDir },
        ),
      ),
  );
  const tasks = [
    ...new Map(
      taskPayloads.flatMap((payload) => extractTasks(payload)).map((record) => [record.id, record]),
    ).values(),
  ].map((record) => normalizeTask(record, repoId));
  const repoTasks = tasks.filter((task) => task.repoOwned);
  const repoTaskIds = new Set(repoTasks.map((task) => task.id));
  const repoRunIds = new Set(repoTasks.map((task) => task.runId).filter(Boolean));
  const runs = allRuns.filter((run) => repoRunIds.has(run.id));
  const workers = extractWorkers(workerPayload)
    .map(normalizeWorker)
    .filter((worker) => repoTaskIds.has(worker.taskId));

  const terminalPayloads = await Promise.all(
    worktrees.map((worktree) =>
      worktree.id
        ? readJsonCommand(
            exec,
            orcaInvocation.command,
            [
              ...orcaInvocation.prefix,
              "terminal",
              "list",
              "--worktree",
              `id:${worktree.id}`,
              "--json",
            ],
            { cwd: rootDir },
          )
        : Promise.resolve([]),
    ),
  );
  const terminals = terminalPayloads
    .flatMap((payload) => extractTerminals(payload))
    .map(normalizeTerminal);
  const worktreesWithTerminals = worktrees.map((worktree) => {
    const ownedTerminals = terminals.filter((terminal) => terminal.worktreeId === worktree.id);
    return {
      ...worktree,
      liveTerminalCount: Math.max(worktree.liveTerminalCount, ownedTerminals.length),
      terminals: ownedTerminals,
    };
  });

  const liveWorktreeIds = new Set(
    worktreesWithTerminals.filter((worktree) => !worktree.isMain).map((worktree) => worktree.id),
  );
  const liveTerminalHandles = new Set(terminals.map((terminal) => terminal.handle).filter(Boolean));
  const liveWorkers = workers.filter(
    (worker) => workerIsLive(worker) || liveTerminalHandles.has(worker.terminalHandle),
  );
  const liveWorkerTaskIds = new Set(liveWorkers.map((worker) => worker.taskId));
  const taskIsLive = (task) =>
    liveWorkerTaskIds.has(task.id) ||
    (task.envelope.valid && liveWorktreeIds.has(task.envelope.worktreeId)) ||
    (!task.envelope.valid &&
      [...liveWorktreeIds].some((worktreeId) =>
        String(task.raw?.created_by_process_incarnation ?? "").startsWith(worktreeId),
      ));
  const liveTasks = repoTasks.filter(taskIsLive);
  const historicalTasks = repoTasks.filter((task) => !taskIsLive(task));
  const changeIds = new Set(
    graph.nodes.filter((node) => node.kind === "change").map((node) => node.id),
  );
  const unknownTaskLinks = liveTasks.flatMap((task) => {
    if (!task.envelope.valid) return [];
    const workerWorktreeIds = [
      ...new Set(
        liveWorkers
          .filter((worker) => worker.taskId === task.id)
          .map((worker) => worker.worktreeId)
          .filter(nonEmptyString),
      ),
    ];
    let reason = null;
    const routeNodeId = task.envelope.routeNodeId ?? task.envelope.changeId;
    const declaredAuxiliary =
      task.envelope.schemaVersion === 2 &&
      task.envelope.workItemId === `AUX:${task.envelope.changeName}`;
    if (!changeIds.has(routeNodeId) && !declaredAuxiliary) reason = "unknown_change";
    else if (workerWorktreeIds.some((id) => id !== task.envelope.worktreeId)) {
      reason = "worker_worktree_mismatch";
    } else if (
      ACTIVE_TASK_STATUSES.has(task.status) &&
      !liveWorktreeIds.has(task.envelope.worktreeId)
    ) {
      reason = "worktree_missing";
    }
    return reason
      ? [
          {
            taskId: task.id,
            changeId: routeNodeId,
            workItemId: task.envelope.workItemId,
            worktreeId: task.envelope.worktreeId,
            ...(workerWorktreeIds.length > 0 ? { workerWorktreeIds } : {}),
            reason,
          },
        ]
      : [];
  });
  const unlinkedTasks = liveTasks.filter(
    (task) => !task.envelope.valid && ACTIVE_TASK_STATUSES.has(task.status),
  );
  const diagnostics = historicalTasks
    .filter((task) => !task.envelope.valid || ACTIVE_TASK_STATUSES.has(task.status))
    .map((task) => ({
      code: task.envelope.valid ? "historical_orphan_task" : "historical_unlinked_task",
      taskId: task.id,
      runId: task.runId,
      status: task.status,
      ...(task.envelope.valid
        ? {
            changeId: task.envelope.routeNodeId ?? task.envelope.changeId,
            workItemId: task.envelope.workItemId,
            worktreeId: task.envelope.worktreeId,
          }
        : { reason: task.envelope.reason }),
    }));
  const mainWorktree =
    worktreesWithTerminals.find((worktree) => worktree.isMain) ??
    normalizeWorktree({ path: rootDir, isMainWorktree: true }, rootDir, repoId);
  const main = await collectGit(exec, rootDir);
  const mainArchives = await committedArchiveChangeNames(exec, rootDir);
  const nonMain = worktreesWithTerminals.filter((worktree) => !worktree.isMain);
  const collectedWorktrees = await Promise.all(
    nonMain.map((worktree) => collectWorktree(exec, worktree, graph, liveTasks)),
  );
  const ancestry = {};
  for (const worktree of collectedWorktrees) {
    if (!worktree.exists || !worktree.git?.head) continue;
    for (const node of graph.nodes.filter(
      (candidate) => candidate.kind === "change" && worktree.localNodeIds.includes(candidate.id),
    )) {
      ancestry[node.id] = await isAncestor(exec, worktree.git.head, main.head, rootDir);
    }
  }
  const mainCheckpointAncestry = {};
  const checkpointHeads = new Set(
    liveTasks
      .filter((task) => task.envelope.valid)
      .map((task) => task.envelope.main?.mainHead)
      .filter(nonEmptyString),
  );
  for (const checkpointHead of checkpointHeads) {
    mainCheckpointAncestry[checkpointHead] = await isAncestor(
      exec,
      checkpointHead,
      main.head,
      rootDir,
    );
  }
  return {
    generatedAt: new Date().toISOString(),
    main: { ...main, worktree: mainWorktree, archiveNames: mainArchives },
    worktrees: collectedWorktrees,
    tasks: liveTasks,
    runs,
    workers,
    terminals,
    unknownTaskLinks,
    unlinkedTasks,
    diagnostics,
    ancestry,
    mainCheckpointAncestry,
  };
}

export function renderHuman(snapshot) {
  const lines = [
    `route: ${snapshot.routeId}`,
    `main: ${snapshot.main.branch ?? "(detached)"} ${snapshot.main.head ?? "(unknown)"}${snapshot.main.dirty ? " dirty" : " clean"}`,
    `frontier: ${snapshot.frontier.length > 0 ? snapshot.frontier.join(", ") : "(empty)"}`,
    `resume: ${snapshot.resumeQueue.length > 0 ? snapshot.resumeQueue.map((item) => item.workItemId).join(" -> ") : "(empty)"}`,
  ];
  for (const node of snapshot.nodes.filter(
    (item) => item.kind === "change" && item.status !== "completed",
  )) {
    lines.push(
      `${node.id} ${node.status}${node.phase ? ` [${node.phase}]` : ""}: ${node.nextActions.join("；")}`,
    );
  }
  if (snapshot.staleWorktrees.length > 0)
    lines.push(`stale/reclaimable worktrees: ${snapshot.staleWorktrees.join(", ")}`);
  if (snapshot.unlinkedTasks.length > 0)
    lines.push(
      `unlinked active tasks: ${snapshot.unlinkedTasks.map((task) => task.id).join(", ")}`,
    );
  if (snapshot.violations.length > 0)
    lines.push(
      `violations: ${snapshot.violations.map((item) => `${item.nodeId}:${item.code}`).join(", ")}`,
    );
  return `${lines.join("\n")}\n`;
}

async function loadGraph(graphPath) {
  return JSON.parse(await readFile(graphPath, "utf8"));
}

function parseArgs(argv) {
  const options = { json: false, check: false, graphOnly: false, rootDir: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--check") options.check = true;
    else if (arg === "--graph-only") options.graphOnly = true;
    else if (arg === "--root") options.rootDir = resolve(argv[++index]);
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

export async function collectStatus({
  rootDir = process.cwd(),
  graphPath,
  exec = defaultExec,
  orcaCommand,
} = {}) {
  const coordinatorRoot = await resolveCoordinatorRoot(rootDir, exec);
  const graph = await loadGraph(
    graphPath ?? resolve(coordinatorRoot, "config/orchestration/execution-graph.json"),
  );
  const graphIssues = validateGraph(graph);
  if (graphIssues.length > 0) return { graph, graphIssues };
  const facts = await collectFacts({
    rootDir: coordinatorRoot,
    graph,
    exec,
    orcaInvocation: resolveOrcaInvocation(orcaCommand),
  });
  return { graph, rootDir: coordinatorRoot, snapshot: deriveSnapshot(graph, facts) };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    const graphPath = resolve(options.rootDir, "config/orchestration/execution-graph.json");
    const graph = await loadGraph(graphPath);
    const graphIssues = validateGraph(graph);
    if (options.graphOnly) {
      const output = {
        graph: graph.routeId ?? null,
        valid: graphIssues.length === 0,
        issues: graphIssues,
      };
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      return graphIssues.length === 0 ? 0 : 1;
    }
    const result = await collectStatus({ rootDir: options.rootDir, graphPath });
    if (result.graphIssues?.length > 0) {
      process.stdout.write(
        `${JSON.stringify({ valid: false, issues: result.graphIssues }, null, 2)}\n`,
      );
      return 1;
    }
    const output = options.json
      ? JSON.stringify(result.snapshot, null, 2)
      : renderHuman(result.snapshot);
    process.stdout.write(options.json ? `${output}\n` : output);
    if (!options.check) return 0;
    const hardViolations = result.snapshot.violations.length > 0;
    return hardViolations ? 1 : 0;
  } catch (error) {
    const output = {
      valid: false,
      error: error.name,
      message: error.message,
      ...(error.command
        ? { command: error.command, args: error.args, exitCode: error.exitCode }
        : {}),
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
}
