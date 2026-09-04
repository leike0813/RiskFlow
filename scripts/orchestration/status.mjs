import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const TASK_KINDS = new Set(["planning", "implementation", "verification", "archive"]);
const TASK_STATUSES = new Set(["pending", "ready", "dispatched", "completed", "failed", "blocked"]);
const TERMINAL_TASK_STATUSES = new Set(["completed", "failed"]);
const ACTIVE_TASK_STATUSES = new Set(["pending", "ready", "dispatched", "blocked"]);

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

export async function readJsonCommand(exec, command, args, options = {}) {
  const output = await exec(command, args, options);
  if (typeof output === "object") return output;
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new InvalidJsonError(`${command} ${args.join(" ")}`, error);
  }
}

function unwrapResult(payload) {
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

  const required = ["changeId", "taskKind", "worktreeId", "baseHead", "head"];
  const missing = required.filter((field) => !nonEmptyString(envelope[field]));
  if (missing.length > 0) return { valid: false, reason: "missing_fields", missing };
  if (!TASK_KINDS.has(envelope.taskKind)) {
    return { valid: false, reason: "invalid_task_kind", value: envelope.taskKind };
  }
  if (!envelope.worktreeId.includes("::/")) {
    return { valid: false, reason: "worktree_id_not_full", value: envelope.worktreeId };
  }
  if (envelope.phase !== undefined) {
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
  if (envelope.main !== undefined && (!envelope.main || typeof envelope.main !== "object")) {
    return { valid: false, reason: "invalid_main_summary" };
  }
  return { valid: true, ...envelope };
}

export function validateGraph(graph) {
  const issues = [];
  if (!graph || typeof graph !== "object" || !Array.isArray(graph.nodes)) {
    return ["graph.nodes must be an array"];
  }
  const nodes = new Map();
  for (const node of graph.nodes) {
    if (!node || !nonEmptyString(node.id)) {
      issues.push("node id must be a non-empty string");
      continue;
    }
    if (nodes.has(node.id)) issues.push(`duplicate node id: ${node.id}`);
    nodes.set(node.id, node);
    if (!["change", "gate"].includes(node.kind)) issues.push(`${node.id}: invalid kind`);
    if (!Array.isArray(node.dependsOn)) issues.push(`${node.id}: dependsOn must be an array`);
    for (const dependency of node.dependsOn ?? []) {
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

function resolveOrcaInvocation(value = process.env.ORCA_CLI_COMMAND) {
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

async function archiveChangeNames(rootDir) {
  const archiveDir = resolve(rootDir, "openspec/changes/archive");
  try {
    const entries = await readdir(archiveDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
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
    tasks: tasks.filter((task) => task.envelope.valid && task.envelope.worktreeId === worktree.id),
  };
  if (!base.exists) return base;

  const [git, openSpecPayload, archives] = await Promise.all([
    collectGit(exec, worktree.path),
    readJsonCommand(exec, "openspec", ["list", "--json"], { cwd: worktree.path }),
    archiveChangeNames(worktree.path),
  ]);
  const openSpec = extractOpenSpecChanges(openSpecPayload);
  const names = new Set(openSpec.map((record) => record.name));
  const openSpecNodeIds = graph.nodes
    .filter(
      (node) =>
        node.kind === "change" && (names.has(node.change) || archivedName(archives, node.change)),
    )
    .map((node) => node.id);
  const localNodeIds = [...openSpecNodeIds];
  for (const task of base.tasks) {
    if (task.envelope.valid && !localNodeIds.includes(task.envelope.changeId)) {
      const node = graph.nodes.find((candidate) => candidate.id === task.envelope.changeId);
      if (node?.kind === "change") localNodeIds.push(node.id);
    }
  }
  return {
    ...base,
    git,
    openSpec: { changes: openSpec, archiveNames: archives },
    openSpecNodeIds: [...new Set(openSpecNodeIds)],
    localNodeIds: [...new Set(localNodeIds)],
  };
}

function taskSummary(tasks) {
  const valid = tasks.filter((task) => task.envelope.valid);
  const failed = valid.find(
    (task) => task.status === "failed" || task.envelope.outcome === "failed",
  );
  const blocked = valid.find((task) => task.status === "blocked");
  const active = valid.find((task) => ACTIVE_TASK_STATUSES.has(task.status));
  const phaseOrder = new Map([
    ["planning", 1],
    ["implementation", 2],
    ["verification", 3],
    ["archive", 4],
  ]);
  const latest =
    [...valid].sort((left, right) => {
      const leftOrder = phaseOrder.get(left.envelope.taskKind) ?? 0;
      const rightOrder = phaseOrder.get(right.envelope.taskKind) ?? 0;
      return (
        rightOrder - leftOrder || String(right.createdAt).localeCompare(String(left.createdAt))
      );
    })[0] ?? null;
  return {
    failed,
    blocked,
    active,
    latest,
    hasActive: valid.some((task) => ACTIVE_TASK_STATUSES.has(task.status)),
    allSettled: valid.length > 0 && valid.every((task) => TERMINAL_TASK_STATUSES.has(task.status)),
  };
}

function mainSummary(tasks, changeId, mainHead) {
  const summaries = tasks
    .filter((task) => task.envelope.valid && task.envelope.changeId === changeId)
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
      archiveCommits.length > 1,
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
    taskKind: task.envelope.taskKind,
    phase: task.envelope.phase ?? task.envelope.taskKind,
    outcome: task.envelope.outcome ?? null,
    head: task.envelope.head,
    baseHead: task.envelope.baseHead,
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
  const localSpecPresent = worktrees.some((item) => item.localNodeIds.includes(node.id));
  const openSpecPresent = worktree?.openSpecNodeIds?.includes(node.id);
  const unlinkedLocal = localSpecPresent && tasks.length === 0;
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
  const mainState = mainSummary(tasks, node.id, main.head);
  if (mainState.conflict) violations.push({ code: "main_summary_conflict" });
  if (mainState.mainHead && main.head && mainState.mainHead !== main.head) {
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
  const mainArchive = archivedName(main.archiveNames ?? [], node.change);
  if (mainArchive && context.ancestry?.[node.id] === false) {
    violations.push({ code: "archived_main_but_feature_head_not_ancestor" });
  }

  if (worktree && !worktree.exists)
    violations.push({ code: "worktree_missing", worktreeId: worktree.id });
  const featureMerged = mainArchive || Boolean(context.ancestry?.[node.id]);
  const mainVerified = mainState.verification === "passed";
  if (mainArchive && !mainVerified) violations.push({ code: "main_verification_missing" });
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
  } else if (summary.failed) {
    status = summary.failed.envelope.taskKind === "verification" ? "verification_failed" : "failed";
    nextActions = ["按失败证据执行当前 change 的修复或重新规划"];
  } else if (summary.blocked) {
    status = "blocked";
    nextActions = ["处理 Orca task blocker 或升级决策"];
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
    },
    main: {
      head: main.head ?? null,
      merged: featureMerged,
      verification: mainState.verification,
      archive: archivedName(main.archiveNames ?? [], node.change),
      mergeCommit: mainState.mergeCommit,
      archiveCommit: mainState.archiveCommit,
    },
    checkpoints: taskEvidence(summary.latest),
    nextActions,
    violations,
  };
}

export function deriveSnapshot(graph, facts) {
  const changes = graph.nodes.filter((node) => node.kind === "change");
  const changeIds = new Set(changes.map((node) => node.id));
  const dependencyState = new Map();
  const changeStates = [];
  for (const node of changes) {
    const state = deriveNodeState(node, {
      ...facts,
      dependencyState,
      worktrees: (facts.worktrees ?? []).filter(
        (worktree) =>
          worktree.localNodeIds.includes(node.id) ||
          worktree.tasks.some((task) => task.envelope.valid && task.envelope.changeId === node.id),
      ),
      tasks: (facts.tasks ?? []).filter(
        (task) => task.envelope.valid && task.envelope.changeId === node.id,
      ),
    });
    changeStates.push(state);
    dependencyState.set(node.id, state.status);
  }
  const gateStates = graph.nodes
    .filter((node) => node.kind === "gate")
    .map((node) => deriveNodeState(node, { dependencyState }));
  const nodes = [...changeStates, ...gateStates];
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
  return {
    schemaVersion: 1,
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
    violations,
  };
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

  const [runPayload, workerPayload] = await Promise.all([
    readJsonCommand(
      exec,
      orcaInvocation.command,
      [...orcaInvocation.prefix, "orchestration", "run-list", "--limit", "100", "--json"],
      { cwd: rootDir },
    ),
    readJsonCommand(
      exec,
      orcaInvocation.command,
      [...orcaInvocation.prefix, "orchestration", "worker-list", "--json"],
      { cwd: rootDir },
    ),
  ]);
  const allRuns = extractRuns(runPayload).map(normalizeRun);
  const taskPayloads = await Promise.all(
    allRuns.map((run) =>
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

  const liveWorktreeIds = new Set(worktreesWithTerminals.map((worktree) => worktree.id));
  const changeIds = new Set(
    graph.nodes.filter((node) => node.kind === "change").map((node) => node.id),
  );
  const unknownTaskLinks = repoTasks
    .filter(
      (task) =>
        task.envelope.valid &&
        (!changeIds.has(task.envelope.changeId) ||
          (ACTIVE_TASK_STATUSES.has(task.status) &&
            !liveWorktreeIds.has(task.envelope.worktreeId))),
    )
    .map((task) => ({
      taskId: task.id,
      changeId: task.envelope.changeId,
      worktreeId: task.envelope.worktreeId,
      reason: !changeIds.has(task.envelope.changeId) ? "unknown_change" : "worktree_missing",
    }));
  const unlinkedTasks = repoTasks
    .filter((task) => !task.envelope.valid && ACTIVE_TASK_STATUSES.has(task.status))
    .filter((task) => {
      const processRef = task.raw?.created_by_process_incarnation ?? "";
      return (
        !processRef || [...liveWorktreeIds].some((worktreeId) => processRef.startsWith(worktreeId))
      );
    });
  const mainWorktree =
    worktreesWithTerminals.find((worktree) => worktree.isMain) ??
    normalizeWorktree({ path: rootDir, isMainWorktree: true }, rootDir, repoId);
  const main = await collectGit(exec, rootDir);
  const mainArchives = await archiveChangeNames(rootDir);
  const nonMain = worktreesWithTerminals.filter((worktree) => !worktree.isMain);
  const collectedWorktrees = await Promise.all(
    nonMain.map((worktree) => collectWorktree(exec, worktree, graph, repoTasks)),
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
  return {
    generatedAt: new Date().toISOString(),
    main: { ...main, worktree: mainWorktree, archiveNames: mainArchives },
    worktrees: collectedWorktrees,
    tasks: repoTasks,
    runs,
    workers,
    terminals,
    unknownTaskLinks,
    unlinkedTasks,
    ancestry,
  };
}

export function renderHuman(snapshot) {
  const lines = [
    `route: ${snapshot.routeId}`,
    `main: ${snapshot.main.branch ?? "(detached)"} ${snapshot.main.head ?? "(unknown)"}${snapshot.main.dirty ? " dirty" : " clean"}`,
    `frontier: ${snapshot.frontier.length > 0 ? snapshot.frontier.join(", ") : "(empty)"}`,
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
  graphPath = resolve(rootDir, "config/orchestration/execution-graph.json"),
  exec = defaultExec,
  orcaCommand,
} = {}) {
  const graph = await loadGraph(graphPath);
  const graphIssues = validateGraph(graph);
  if (graphIssues.length > 0) return { graph, graphIssues };
  const facts = await collectFacts({
    rootDir,
    graph,
    exec,
    orcaInvocation: resolveOrcaInvocation(orcaCommand),
  });
  return { graph, snapshot: deriveSnapshot(graph, facts) };
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
