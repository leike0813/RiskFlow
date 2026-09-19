import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  collectStatus,
  defaultExec,
  readJsonCommand,
  resolveCoordinatorRoot,
  resolveOrcaInvocation,
  unwrapResult,
} from "./status.mjs";

const TERMINAL_OUTCOMES = new Set(["succeeded", "failed", "blocked", "paused"]);
const RECONCILE_SAFE_VIOLATIONS = new Set(["checkpoint_mismatch", "worktree_reclaim_pending"]);
const CONTROLLED_TOOL_NAMES = [
  "riskflow_status",
  "riskflow_dispatch",
  "riskflow_wait",
  "riskflow_settle",
  "riskflow_integrate",
];

export class ControlError extends Error {
  constructor(code, reason, nextActions = []) {
    super(reason);
    this.name = "ControlError";
    this.code = code;
    this.nextActions = nextActions;
  }
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ControlError("invalid_input", `${name} 必须是非空字符串`);
  }
  return value;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function findWorkItem(snapshot, workItemId) {
  return snapshot.nodes.find((node) => node.kind === "change" && node.id === workItemId) ?? null;
}

export function canCompleteGoal(snapshot, workItemIds) {
  const selected = workItemIds?.length
    ? workItemIds.map((id) => [id, findWorkItem(snapshot, id)])
    : snapshot.nodes.filter((node) => node.kind === "change").map((node) => [node.id, node]);
  const unknown = selected.filter(([, node]) => !node).map(([id]) => id);
  const targets = selected.map(([, node]) => node).filter(Boolean);
  const unfinished = targets.filter((node) => !["completed", "reclaimable"].includes(node.status));
  return {
    allowed: unknown.length === 0 && unfinished.length === 0 && snapshot.violations.length === 0,
    unknown,
    unfinished: unfinished.map((node) => node.id),
    nextActions: snapshot.resumeQueue.slice(0, 3),
  };
}

export function preflightAction(snapshot, action, input = {}) {
  if (input.expectedRevision && input.expectedRevision !== snapshot.revision) {
    throw new ControlError("stale_revision", "编排状态已变化，请重新读取状态", [
      "调用 riskflow_status 获取新 revision",
    ]);
  }
  if (action === "complete") {
    const result = canCompleteGoal(snapshot, input.workItemIds);
    if (!result.allowed) {
      throw new ControlError("goal_incomplete", "目标范围仍有未完成工作", [
        ...result.nextActions.map((item) => `${item.workItemId}: ${item.nextAction}`),
      ]);
    }
    return result;
  }

  const workItemId = requiredString(input.workItemId, "workItemId");
  const node = findWorkItem(snapshot, workItemId);
  if (!node) throw new ControlError("work_item_not_found", `未知工作项：${workItemId}`);
  const queueItem = snapshot.resumeQueue.find((item) => item.workItemId === workItemId);
  const adoptingAuxiliary = action === "dispatch" && node.auxiliary && node.status === "untracked";
  const blockingViolations = snapshot.violations.filter(
    (violation) =>
      !(
        (action === "reconcile" &&
          (violation.nodeId === workItemId || RECONCILE_SAFE_VIOLATIONS.has(violation.code))) ||
        (adoptingAuxiliary && violation.nodeId === workItemId) ||
        (action === "integrate" &&
          queueItem?.category === "cleanup" &&
          violation.nodeId === workItemId &&
          violation.code === "worktree_reclaim_pending")
      ),
  );
  if (blockingViolations.length > 0) {
    throw new ControlError("orchestration_conflict", "编排状态仍有未解决冲突", [
      "调用 riskflow_status 并先处理 violations",
    ]);
  }
  if (action !== "reconcile" && !adoptingAuxiliary && node.violations.length > 0) {
    throw new ControlError("work_item_conflict", `${workItemId} 存在状态冲突`, node.nextActions);
  }
  if (action === "dispatch") {
    const replanApprovalRef =
      input.replanApprovalRef === undefined
        ? null
        : requiredString(input.replanApprovalRef, "replanApprovalRef");
    if (replanApprovalRef && !["finalizing", "paused"].includes(node.status)) {
      throw new ControlError(
        "replan_not_allowed",
        `${workItemId} 只有进入 finalizing 或 paused 后才能按批准引用重新规划`,
        node.nextActions,
      );
    }
    if (replanApprovalRef && !nonEmptyString(node.checkpoints?.attemptGroup)) {
      throw new ControlError(
        "replan_not_allowed",
        `${workItemId} 缺少可被取代的 attemptGroup`,
        node.nextActions,
      );
    }
    if (!replanApprovalRef && node.status === "paused") {
      throw new ControlError(
        "replan_approval_required",
        `${workItemId} 重开规划需要非空 replanApprovalRef`,
        node.nextActions,
      );
    }
    if (
      !replanApprovalRef &&
      (!queueItem ||
        !["planning", "implementing", "finalizing", "ready", "recovery"].includes(
          queueItem.category,
        ))
    ) {
      throw new ControlError(
        "dispatch_not_allowed",
        `${workItemId} 当前不可派发`,
        node.nextActions,
      );
    }
  } else if (action === "settle") {
    if (!node.checkpoints?.taskId || !node.worktree?.head) {
      throw new ControlError(
        "settle_not_allowed",
        `${workItemId} 没有可收口的当前任务`,
        node.nextActions,
      );
    }
    if (node.checkpoints.runState === "settled") {
      throw new ControlError(
        "settle_not_allowed",
        `${workItemId} 当前任务已经收口`,
        node.nextActions,
      );
    }
    if (input.outcome === "succeeded" && node.worktree.git?.dirty) {
      const actual = [...(node.worktree.git.dirtyPaths ?? [])].sort();
      const reviewed = [...new Set(input.reviewedPaths ?? [])].sort();
      if (JSON.stringify(actual) !== JSON.stringify(reviewed)) {
        throw new ControlError(
          "unreviewed_changes",
          `${workItemId} 的 reviewedPaths 与实际未提交改动不一致`,
          ["审阅 riskflow_status 返回的 dirtyPaths 后重新收口"],
        );
      }
    }
  } else if (action === "integrate") {
    if (!queueItem || !["integrating", "cleanup"].includes(queueItem.category)) {
      throw new ControlError(
        "integrate_not_allowed",
        `${workItemId} 当前不可集成`,
        node.nextActions,
      );
    }
  } else if (action === "reconcile") {
    if (!node.worktree?.id || !node.worktree?.head) {
      throw new ControlError("reconcile_not_allowed", `${workItemId} 缺少实际工作树或 HEAD`);
    }
  }
  return { node, queueItem };
}

function nextTaskKind(node) {
  const checkpoint = node.checkpoints;
  if (node.phase === "adopt" || node.status === "untracked") return "finalization";
  if (node.status === "ready") return "planning";
  if (node.status === "finalizing") {
    if (
      checkpoint?.taskKind === "finalization" &&
      checkpoint.outcome === "succeeded" &&
      checkpoint.auditPolicy === "targeted"
    ) {
      return "audit";
    }
    return "finalization";
  }
  if (node.phase === "planning") return "implementation";
  if (node.phase === "implementing") return "implementation";
  throw new ControlError(
    "dispatch_not_allowed",
    `${node.id} 没有合法的下一任务角色`,
    node.nextActions,
  );
}

function taskPhase(taskKind) {
  return {
    planning: "planning",
    implementation: "implementing",
    finalization: "finalizing",
    audit: "finalizing",
    archive: "archiving",
  }[taskKind];
}

export function createV2Envelope({
  node,
  taskId,
  taskKind,
  role,
  runState = "queued",
  outcome,
  approvalRef,
  supersedesAttemptGroup,
}) {
  const checkpoint = node.checkpoints;
  const phase = taskPhase(taskKind);
  const sameAttemptGroup = checkpoint?.taskKind === taskKind;
  const replan = nonEmptyString(approvalRef) && nonEmptyString(supersedesAttemptGroup);
  const envelope = {
    schemaVersion: 2,
    workItemId: node.id,
    routeNodeId: node.routeNodeId,
    changeName: node.change,
    taskKind,
    phase,
    runState,
    worktreeId: node.worktree.id,
    inputHead: node.worktree.head,
    ...(runState === "settled" ? { outputHead: node.worktree.head } : {}),
    owner: {
      taskId,
      agentClass: role.agentClass,
      model: role.model,
    },
    attemptGroup: replan
      ? `${node.id}:planning:${hash(approvalRef).slice(0, 12)}`
      : ((sameAttemptGroup ? checkpoint?.attemptGroup : null) ??
        `${node.id}:${taskKind === "audit" ? "audit" : phase}`),
    attempt: replan ? 1 : sameAttemptGroup ? Number(checkpoint?.attempt ?? 0) + 1 : 1,
    ...(replan ? { approvalRef, supersedesAttemptGroup } : {}),
    auditPolicy: checkpoint?.auditPolicy ?? "self",
    issueRefs: checkpoint?.issueRefs ?? [],
    evidenceRefs: checkpoint?.evidenceRefs ?? [],
    ...(outcome ? { outcome } : {}),
    main: checkpoint?.main ?? {
      mergeCommit: null,
      mainHead: null,
      verification: "pending",
      archiveCommit: null,
    },
  };
  return envelope;
}

async function gitCommonDir(rootDir, exec) {
  const output = String(
    await exec("git", ["rev-parse", "--git-common-dir"], { cwd: rootDir }),
  ).trim();
  return isAbsolute(output) ? output : resolve(rootDir, output);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function removeStaleLock(lockDir) {
  try {
    const owner = JSON.parse(await readFile(resolve(lockDir, "owner.json"), "utf8"));
    if (Date.now() - Number(owner.createdAt) < 120_000 || processAlive(Number(owner.pid)))
      return false;
  } catch {
    const info = await stat(lockDir).catch(() => null);
    if (!info || Date.now() - info.mtimeMs < 120_000) return false;
  }
  await rm(lockDir, { recursive: true });
  return true;
}

export async function withRuntimeLock(rootDir, exec, work) {
  const runtimeDir = resolve(await gitCommonDir(rootDir, exec), "riskflow-orchestration");
  const lockDir = resolve(runtimeDir, "control.lock");
  await mkdir(runtimeDir, { recursive: true });
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      await mkdir(lockDir);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await removeStaleLock(lockDir)) continue;
      await delay(40);
      continue;
    }
    try {
      await writeFile(
        resolve(lockDir, "owner.json"),
        JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
        "utf8",
      );
      return await work(runtimeDir);
    } finally {
      await rm(lockDir, { recursive: true });
    }
  }
  throw new ControlError("control_busy", "编排状态正在由另一操作更新，请稍后重试");
}

async function readReceipt(runtimeDir, idempotencyKey, input) {
  const path = resolve(runtimeDir, "receipts", `${hash(idempotencyKey)}.json`);
  try {
    const receipt = JSON.parse(await readFile(path, "utf8"));
    if (receipt.inputHash !== hash(input)) {
      throw new ControlError("idempotency_conflict", "同一幂等键已用于不同输入");
    }
    if (receipt.status === "inflight") {
      throw new ControlError(
        "uncertain_prior_execution",
        "同一幂等操作曾开始执行，但无法确认外部副作用是否完成；禁止自动重放",
        ["调用 riskflow_status 重新读取实时状态", "根据实时事实对账后使用新的幂等键继续"],
      );
    }
    if (receipt.status === "completed" || (receipt.status === undefined && "result" in receipt)) {
      return receipt.result;
    }
    throw new ControlError("invalid_idempotency_receipt", "幂等回执状态无效");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeReceipt(runtimeDir, idempotencyKey, input, status, result) {
  const receiptsDir = resolve(runtimeDir, "receipts");
  await mkdir(receiptsDir, { recursive: true });
  const path = resolve(receiptsDir, `${hash(idempotencyKey)}.json`);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(
    temporaryPath,
    JSON.stringify({
      status,
      inputHash: hash(input),
      ...(status === "completed" ? { result } : {}),
    }),
    "utf8",
  );
  await rename(temporaryPath, path);
}

const ORCA_SENDER_COMMANDS = new Set([
  "run-create",
  "task-create",
  "task-update",
  "worker-start",
  "dispatch",
]);

export function withOrcaSender(invocation, args) {
  if (
    invocation.senderTerminalHandle &&
    args[0] === "orchestration" &&
    ORCA_SENDER_COMMANDS.has(args[1]) &&
    !args.includes("--from")
  ) {
    return [...args, "--from", invocation.senderTerminalHandle];
  }
  return args;
}

async function orcaJson(exec, invocation, args, cwd, retryRequest) {
  return unwrapResult(
    await readJsonCommand(
      exec,
      invocation.command,
      [
        ...invocation.prefix,
        ...withOrcaSender(invocation, args),
        ...(retryRequest ? ["--retry-request", retryRequest] : []),
        "--json",
      ],
      {
        cwd,
        timeoutMs: 120_000,
      },
    ),
  );
}

function retryRequest(idempotencyKey, step) {
  return hash([idempotencyKey, step]);
}

function idFrom(value, kind) {
  return value?.id ?? value?.[kind]?.id ?? value?.result?.id ?? null;
}

async function ensureRun(exec, invocation, rootDir, node, idempotencyKey, reuseExisting = true) {
  if (reuseExisting && node.checkpoints?.runId) return node.checkpoints.runId;
  const created = await orcaJson(
    exec,
    invocation,
    ["orchestration", "run-create", "--objective", `推进 RiskFlow ${node.id}：${node.change}`],
    rootDir,
    retryRequest(idempotencyKey, "run-create"),
  );
  const runId = idFrom(created, "run");
  if (!runId) throw new ControlError("orca_result_invalid", "Orca 未返回 run id");
  return runId;
}

function taskSpec(node, taskKind) {
  const responsibility = {
    planning:
      "按 change 实际 schema 和 applyRequires 创建并闭合规划工件，不实现代码；研究资料只读取 references/风险识别与评估规划事实源摘要.md",
    implementation:
      "按已批准 IP-ID 有界实现并在当前任务内修复普通测试失败；不提前创建 verification",
    finalization:
      "核验当前产物，在已批准语义内直接修复、回归，并按实际 schema 填写最终 verification；普通缺陷保持当前收尾责任",
    audit: "独立检查权限、事务、关键状态机或语义 merge 冲突的受影响范围，并把结论补入 verification",
    archive: "仅在门禁通过后机械归档",
  }[taskKind];
  return [
    `工作项：${node.id}`,
    `OpenSpec change：${node.change}`,
    `工作树：${node.worktree.id}`,
    `输入 HEAD：${node.worktree.head}`,
    responsibility,
    "先读 AGENTS.md、IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md、IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md 和全部 OpenSpec contextFiles。",
    "公共契约、权限、持久化、迁移、依赖或批准范围变化必须 escalation；禁止提交、合并、归档或扩大范围。",
    "worker_done 必须列出产物 HEAD、证据、实际命令和剩余事项。",
  ].join("\n");
}

async function createWorktreeForReadyNode(exec, invocation, rootDir, node) {
  const created = await orcaJson(
    exec,
    invocation,
    [
      "worktree",
      "create",
      "--repo",
      `path:${rootDir}`,
      "--name",
      node.id.toLowerCase(),
      "--base-branch",
      "main",
      "--no-parent",
      "--setup",
      "run",
      "--comment",
      `RiskFlow ${node.id} ${node.change}`,
    ],
    rootDir,
  );
  const worktree = created?.worktree ?? created;
  if (!worktree?.id || !worktree?.path || !worktree?.head) {
    throw new ControlError("orca_result_invalid", "Orca 未返回完整 worktree 身份");
  }
  return {
    ...node,
    worktree: {
      id: worktree.id,
      path: worktree.path,
      branch: worktree.branch,
      head: worktree.head,
    },
  };
}

async function createTask(
  exec,
  invocation,
  rootDir,
  graph,
  node,
  taskKind,
  runId,
  idempotencyKey,
  envelopeOptions = {},
) {
  const role = graph.policy.roles[taskKind];
  const created = await orcaJson(
    exec,
    invocation,
    [
      "orchestration",
      "task-create",
      "--run",
      runId,
      "--task-title",
      `${node.id} ${taskKind}`,
      "--spec",
      taskSpec(node, taskKind),
    ],
    rootDir,
    retryRequest(idempotencyKey, "task-create"),
  );
  const taskId = idFrom(created, "task");
  if (!taskId) throw new ControlError("orca_result_invalid", "Orca 未返回 task id");
  const envelope = createV2Envelope({ node, taskId, taskKind, role, ...envelopeOptions });
  await orcaJson(
    exec,
    invocation,
    [
      "orchestration",
      "task-update",
      "--run",
      runId,
      "--id",
      taskId,
      "--status",
      "ready",
      "--result",
      JSON.stringify(envelope),
    ],
    rootDir,
    retryRequest(idempotencyKey, "task-envelope"),
  );
  return { taskId, runId, envelope, role };
}

async function startWorker(exec, invocation, rootDir, node, task, idempotencyKey) {
  const worktree = `id:${node.worktree.id}`;
  if (["planning", "finalization", "audit"].includes(task.envelope.taskKind)) {
    return orcaJson(
      exec,
      invocation,
      [
        "orchestration",
        "worker-start",
        "--run",
        task.runId,
        "--task",
        task.taskId,
        "--worktree",
        worktree,
        "--agent",
        "codex",
        "--model",
        task.role.model,
        "--effort",
        task.role.thinking,
      ],
      rootDir,
      retryRequest(idempotencyKey, "worker-start"),
    );
  }
  const command = `omp --model ${task.role.model} --thinking ${task.role.thinking} --approval-mode yolo`;
  const terminalResult = await orcaJson(
    exec,
    invocation,
    [
      "terminal",
      "create",
      "--worktree",
      worktree,
      "--title",
      `${node.id}-${task.envelope.taskKind}`,
      "--command",
      command,
    ],
    rootDir,
  );
  const terminalHandle =
    terminalResult?.agentTerminalHandle ??
    terminalResult?.startupTerminal?.handle ??
    terminalResult?.terminal?.handle ??
    terminalResult?.handle;
  if (!terminalHandle) throw new ControlError("orca_result_invalid", "Orca 未返回 terminal handle");
  await orcaJson(
    exec,
    invocation,
    [
      "terminal",
      "wait",
      "--terminal",
      terminalHandle,
      "--for",
      "tui-idle",
      "--timeout-ms",
      "60000",
    ],
    rootDir,
  );
  return orcaJson(
    exec,
    invocation,
    [
      "orchestration",
      "dispatch",
      "--run",
      task.runId,
      "--task",
      task.taskId,
      "--to",
      terminalHandle,
      "--inject",
    ],
    rootDir,
    retryRequest(idempotencyKey, "dispatch"),
  );
}

async function controlledMutation(action, input, options, perform) {
  const exec = options.exec ?? defaultExec;
  const rootDir = await resolveCoordinatorRoot(options.rootDir ?? process.cwd(), exec);
  requiredString(input.expectedRevision, "expectedRevision");
  const idempotencyKey = requiredString(input.idempotencyKey, "idempotencyKey");
  return withRuntimeLock(rootDir, exec, async (runtimeDir) => {
    const prior = await readReceipt(runtimeDir, idempotencyKey, { action, ...input });
    if (prior !== null) return prior;
    const status = await (options.statusProvider ?? collectStatus)({ rootDir, exec });
    if (status.graphIssues?.length) {
      throw new ControlError("invalid_manifest", status.graphIssues.join("; "));
    }
    const checked = preflightAction(status.snapshot, action, input);
    await writeReceipt(runtimeDir, idempotencyKey, { action, ...input }, "inflight");
    const result = await perform({
      rootDir,
      exec,
      idempotencyKey,
      graph: status.graph,
      snapshot: status.snapshot,
      ...checked,
    });
    await writeReceipt(runtimeDir, idempotencyKey, { action, ...input }, "completed", result);
    return result;
  });
}

export async function riskflowStatus(options = {}) {
  const result = await (options.statusProvider ?? collectStatus)({
    rootDir: options.rootDir ?? process.cwd(),
    exec: options.exec ?? defaultExec,
  });
  if (result.graphIssues?.length)
    throw new ControlError("invalid_manifest", result.graphIssues.join("; "));
  return result.snapshot;
}

export async function riskflowDispatch(input, options = {}) {
  return controlledMutation("dispatch", input, options, async (ctx) => {
    const invocation = resolveOrcaInvocation(options.orcaCommand);
    let node = ctx.node;
    if (!node.worktree && node.status === "ready") {
      node = await createWorktreeForReadyNode(ctx.exec, invocation, ctx.rootDir, node);
    }
    const replanApprovalRef = input.replanApprovalRef;
    const taskKind = replanApprovalRef ? "planning" : nextTaskKind(node);
    const runId = await ensureRun(ctx.exec, invocation, ctx.rootDir, node, ctx.idempotencyKey);
    let task;
    if (!replanApprovalRef && node.checkpoints?.runState === "queued" && node.checkpoints.taskId) {
      task = {
        taskId: node.checkpoints.taskId,
        runId: node.checkpoints.runId ?? runId,
        envelope: { ...node.checkpoints, taskKind },
        role: ctx.graph.policy.roles[taskKind],
      };
    } else {
      task = await createTask(
        ctx.exec,
        invocation,
        ctx.rootDir,
        ctx.graph,
        node,
        taskKind,
        runId,
        ctx.idempotencyKey,
        replanApprovalRef
          ? {
              approvalRef: replanApprovalRef,
              supersedesAttemptGroup: node.checkpoints?.attemptGroup,
            }
          : {},
      );
    }
    const worker = await startWorker(
      ctx.exec,
      invocation,
      ctx.rootDir,
      node,
      task,
      ctx.idempotencyKey,
    );
    return {
      ok: true,
      action: "dispatch",
      workItemId: node.id,
      taskId: task.taskId,
      runId,
      worker,
    };
  });
}

export async function riskflowWait(input, options = {}) {
  const rootDir = await resolveCoordinatorRoot(
    options.rootDir ?? process.cwd(),
    options.exec ?? defaultExec,
  );
  const snapshot = await riskflowStatus(options);
  const node = findWorkItem(snapshot, requiredString(input.workItemId, "workItemId"));
  if (!node?.checkpoints?.runId) throw new ControlError("wait_not_allowed", "当前工作项没有 Run");
  const timeoutMs = Math.min(60_000, Math.max(1_000, Number(input.timeoutMs ?? 60_000)));
  const invocation = resolveOrcaInvocation(options.orcaCommand);
  return orcaJson(
    options.exec ?? defaultExec,
    invocation,
    [
      "orchestration",
      "check",
      "--run",
      node.checkpoints.runId,
      "--wait",
      "--types",
      "worker_done,escalation,question",
      "--timeout-ms",
      String(timeoutMs),
    ],
    rootDir,
  );
}

function settledStatus(outcome) {
  if (outcome === "succeeded") return "completed";
  if (outcome === "failed") return "failed";
  return "blocked";
}

export async function riskflowSettle(input, options = {}) {
  if (!TERMINAL_OUTCOMES.has(input.outcome)) {
    throw new ControlError("invalid_input", "outcome 必须为 succeeded、failed、blocked 或 paused");
  }
  if (input.outcome === "succeeded" && !input.evidenceRefs?.length) {
    throw new ControlError("evidence_required", "成功收口必须提供至少一项可核验证据");
  }
  return controlledMutation("settle", input, options, async (ctx) => {
    const checkpoint = ctx.node.checkpoints;
    const attempts = ctx.node.orca.attempts ?? [];
    const issueRefs = Array.isArray(input.issueRefs) ? input.issueRefs : [];
    const evidenceRefs = Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [];
    const sameNoProgress = attempts.filter(
      (attempt) =>
        attempt.runState === "settled" &&
        ["failed", "blocked", "paused"].includes(attempt.outcome) &&
        attempt.head === ctx.node.worktree.head &&
        JSON.stringify(attempt.issueRefs ?? []) === JSON.stringify(issueRefs) &&
        JSON.stringify(attempt.evidenceRefs ?? []) === JSON.stringify(evidenceRefs),
    ).length;
    const outcome =
      input.outcome !== "succeeded" &&
      sameNoProgress + 1 >= Number(ctx.graph.policy.noProgressLimit ?? 3)
        ? "paused"
        : input.outcome;
    if (outcome === "succeeded" && ["finalization", "audit"].includes(checkpoint.taskKind)) {
      const status = await readJsonCommand(
        ctx.exec,
        "openspec",
        ["status", "--change", ctx.node.change, "--json"],
        { cwd: ctx.node.worktree.path },
      );
      const verification = status.artifacts?.find((artifact) => artifact.id === "verification");
      if (verification && verification.status !== "done") {
        throw new ControlError(
          "verification_artifact_required",
          `${ctx.node.change} 的 verification 工件尚未完成`,
          [
            `运行 openspec instructions verification --change ${ctx.node.change} --json 并完成该工件`,
          ],
        );
      }
    }
    const riskTags = Array.isArray(input.riskTags) ? input.riskTags : [];
    const auditPolicy = riskTags.some((tag) => ctx.graph.policy.targetedAudit.includes(tag))
      ? "targeted"
      : checkpoint.auditPolicy;
    let outputHead = ctx.node.worktree.head;
    if (outcome === "succeeded" && ctx.node.worktree.git?.dirty) {
      await ctx.exec("git", ["add", "--", ...input.reviewedPaths], {
        cwd: ctx.node.worktree.path,
      });
      await ctx.exec(
        "git",
        ["commit", "-m", `chore(orchestration): checkpoint ${ctx.node.change}`],
        { cwd: ctx.node.worktree.path, timeoutMs: 120_000 },
      );
      outputHead = String(
        await ctx.exec("git", ["rev-parse", "HEAD"], { cwd: ctx.node.worktree.path }),
      ).trim();
    }
    const envelope = {
      schemaVersion: 2,
      workItemId: ctx.node.id,
      routeNodeId: ctx.node.routeNodeId,
      changeName: ctx.node.change,
      taskKind: checkpoint.taskKind,
      phase: checkpoint.phase,
      runState: "settled",
      outcome,
      worktreeId: ctx.node.worktree.id,
      inputHead: checkpoint.baseHead,
      outputHead,
      owner: checkpoint.owner,
      attemptGroup: checkpoint.attemptGroup,
      attempt: checkpoint.attempt,
      auditPolicy,
      issueRefs,
      evidenceRefs,
      main: checkpoint.main,
    };
    const invocation = resolveOrcaInvocation(options.orcaCommand);
    await orcaJson(
      ctx.exec,
      invocation,
      [
        "orchestration",
        "task-update",
        "--run",
        checkpoint.runId,
        "--id",
        checkpoint.taskId,
        "--status",
        settledStatus(outcome),
        "--result",
        JSON.stringify(envelope),
      ],
      ctx.rootDir,
      retryRequest(ctx.idempotencyKey, "settle"),
    );
    return { ok: true, action: "settle", workItemId: ctx.node.id, outcome, envelope };
  });
}

async function updateMainSummary(ctx, main, orcaCommand, step) {
  const checkpoint = ctx.node.checkpoints;
  const envelope = {
    schemaVersion: 2,
    workItemId: ctx.node.id,
    routeNodeId: ctx.node.routeNodeId,
    changeName: ctx.node.change,
    taskKind: checkpoint.taskKind,
    phase: checkpoint.phase,
    runState: "settled",
    outcome: checkpoint.outcome,
    worktreeId: ctx.node.worktree.id,
    inputHead: checkpoint.baseHead,
    outputHead: checkpoint.head,
    owner: checkpoint.owner,
    attemptGroup: checkpoint.attemptGroup,
    attempt: checkpoint.attempt,
    auditPolicy: checkpoint.auditPolicy,
    issueRefs: checkpoint.issueRefs,
    evidenceRefs: checkpoint.evidenceRefs,
    main,
  };
  const invocation = resolveOrcaInvocation(orcaCommand);
  await orcaJson(
    ctx.exec,
    invocation,
    [
      "orchestration",
      "task-update",
      "--run",
      checkpoint.runId,
      "--id",
      checkpoint.taskId,
      "--status",
      "completed",
      "--result",
      JSON.stringify(envelope),
    ],
    ctx.rootDir,
    retryRequest(ctx.idempotencyKey, step),
  );
  return envelope;
}

export async function riskflowIntegrate(input, options = {}) {
  return controlledMutation("integrate", input, options, async (ctx) => {
    if (ctx.snapshot.main.dirty) {
      throw new ControlError("main_dirty", "main 工作树存在未提交改动，不能集成");
    }
    if (ctx.queueItem.category === "cleanup") {
      const invocation = resolveOrcaInvocation(options.orcaCommand);
      const result = await orcaJson(
        ctx.exec,
        invocation,
        ["worktree", "rm", "--worktree", `id:${ctx.node.worktree.id}`],
        ctx.rootDir,
      );
      return { ok: true, action: "reclaim", workItemId: ctx.node.id, result };
    }
    if (ctx.node.status === "finalized") {
      if (ctx.node.worktree.dirty) {
        throw new ControlError("feature_dirty", "feature 工作树存在未提交改动，不能合并");
      }
      await ctx.exec(
        "git",
        ["merge", "--no-ff", ctx.node.worktree.branch, "-m", `merge: 集成 ${ctx.node.change}`],
        { cwd: ctx.rootDir, timeoutMs: 120_000 },
      );
      const mainHead = String(
        await ctx.exec("git", ["rev-parse", "HEAD"], { cwd: ctx.rootDir }),
      ).trim();
      const envelope = await updateMainSummary(
        ctx,
        {
          ...ctx.node.checkpoints.main,
          mergeCommit: mainHead,
          mainHead,
          verification: "pending",
        },
        options.orcaCommand,
        "main-merge-summary",
      );
      return { ok: true, action: "merge", workItemId: ctx.node.id, mainHead, envelope };
    }
    if (ctx.node.status === "merged") {
      await ctx.exec("pnpm", ["verify"], { cwd: ctx.rootDir, timeoutMs: 30 * 60_000 });
      const mainHead = String(
        await ctx.exec("git", ["rev-parse", "HEAD"], { cwd: ctx.rootDir }),
      ).trim();
      const envelope = await updateMainSummary(
        ctx,
        {
          ...ctx.node.checkpoints.main,
          mainHead,
          verification: "passed",
        },
        options.orcaCommand,
        "main-verify-summary",
      );
      return { ok: true, action: "main-verify", workItemId: ctx.node.id, mainHead, envelope };
    }
    if (ctx.node.status === "main_verified") {
      await readJsonCommand(ctx.exec, "openspec", ["archive", ctx.node.change, "--yes", "--json"], {
        cwd: ctx.rootDir,
        timeoutMs: 120_000,
      });
      await ctx.exec("git", ["add", "-A", "--", "openspec"], { cwd: ctx.rootDir });
      await ctx.exec("git", ["commit", "-m", `docs(openspec): 归档 ${ctx.node.change}`], {
        cwd: ctx.rootDir,
        timeoutMs: 120_000,
      });
      const archiveCommit = String(
        await ctx.exec("git", ["rev-parse", "HEAD"], { cwd: ctx.rootDir }),
      ).trim();
      const envelope = await updateMainSummary(
        ctx,
        {
          ...ctx.node.checkpoints.main,
          archiveCommit,
          mainHead: archiveCommit,
          verification: "passed",
        },
        options.orcaCommand,
        "archive-summary",
      );
      return { ok: true, action: "archive", workItemId: ctx.node.id, archiveCommit, envelope };
    }
    throw new ControlError("integrate_not_allowed", `${ctx.node.id} 没有可执行的集成步骤`);
  });
}

export async function riskflowReconcile(input, options = {}) {
  return controlledMutation("reconcile", input, options, async (ctx) => {
    const taskKind = input.taskKind ?? (input.phase === "planning" ? "planning" : "finalization");
    if (!new Set(["planning", "finalization"]).has(taskKind)) {
      throw new ControlError("invalid_input", "reconcile 只接受 planning 或 finalization");
    }
    const invocation = resolveOrcaInvocation(options.orcaCommand);
    const runId = await ensureRun(
      ctx.exec,
      invocation,
      ctx.rootDir,
      ctx.node,
      ctx.idempotencyKey,
      false,
    );
    const role = ctx.graph.policy.roles[taskKind];
    const created = await orcaJson(
      ctx.exec,
      invocation,
      [
        "orchestration",
        "task-create",
        "--run",
        runId,
        "--task-title",
        `${ctx.node.id} reconcile`,
        "--spec",
        taskSpec(ctx.node, taskKind),
      ],
      ctx.rootDir,
      retryRequest(ctx.idempotencyKey, "reconcile-task-create"),
    );
    const taskId = idFrom(created, "task");
    if (!taskId) throw new ControlError("orca_result_invalid", "Orca 未返回 task id");
    const runState = input.waiting ? "waiting" : "queued";
    const envelope = createV2Envelope({
      node: ctx.node,
      taskId,
      taskKind,
      role,
      runState,
    });
    await orcaJson(
      ctx.exec,
      invocation,
      [
        "orchestration",
        "task-update",
        "--run",
        runId,
        "--id",
        taskId,
        "--status",
        input.waiting ? "blocked" : "ready",
        "--result",
        JSON.stringify(envelope),
      ],
      ctx.rootDir,
      retryRequest(ctx.idempotencyKey, "reconcile-task-envelope"),
    );
    return { ok: true, action: "reconcile", workItemId: ctx.node.id, runId, taskId, envelope };
  });
}

export async function smokeOmpExtension(extensionPath, cwd) {
  return new Promise((resolveSmoke, rejectSmoke) => {
    const child = spawn(
      "omp",
      [
        "--mode",
        "rpc",
        "--no-session",
        "--no-extensions",
        "--no-skills",
        "--no-rules",
        "--no-lsp",
        "-e",
        extensionPath,
      ],
      { cwd, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 10_000);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", rejectSmoke);
    child.on("close", (code) => {
      clearTimeout(timer);
      const missingTools = CONTROLLED_TOOL_NAMES.filter((name) => !stdout.includes(name));
      if (code !== 0 || /Failed to load extension/u.test(stderr) || missingTools.length > 0) {
        rejectSmoke(
          new ControlError(
            "extension_load_failed",
            stderr.trim() ||
              (missingTools.length > 0
                ? `OMP 未注册工具：${missingTools.join(", ")}`
                : `OMP exit ${code}`),
          ),
        );
      } else {
        resolveSmoke({ ok: true });
      }
    });
    child.stdin.end('{"id":"riskflow-doctor","type":"get_state"}\n');
  });
}

export async function doctor(options = {}) {
  const exec = options.exec ?? defaultExec;
  const sourceRoot = options.rootDir ?? process.cwd();
  const rootDir = await resolveCoordinatorRoot(sourceRoot, exec);
  const extensionPath = resolve(sourceRoot, "scripts/orchestration/omp-extension.mjs");
  await stat(extensionPath);
  const invocation = resolveOrcaInvocation(options.orcaCommand);
  const [ompVersion, orcaStatus, graph] = await Promise.all([
    exec("omp", ["--version"], { cwd: rootDir }),
    readJsonCommand(exec, invocation.command, [...invocation.prefix, "status", "--json"], {
      cwd: rootDir,
    }),
    collectStatus({
      rootDir,
      graphPath: resolve(sourceRoot, "config/orchestration/execution-graph.json"),
      exec,
    }),
  ]);
  if (!String(ompVersion).includes("18.1.18")) {
    throw new ControlError(
      "unsupported_omp",
      `需要 OMP 18.1.18，实际为 ${String(ompVersion).trim()}`,
    );
  }
  if (graph.graphIssues?.length)
    throw new ControlError("invalid_manifest", graph.graphIssues.join("; "));
  const orcaReady = Boolean(unwrapResult(orcaStatus)?.runtime?.state === "ready");
  if (!orcaReady) throw new ControlError("orca_not_ready", "Orca runtime 未就绪");
  await smokeOmpExtension(extensionPath, sourceRoot);
  return {
    ok: true,
    ompVersion: String(ompVersion).trim(),
    orcaReady,
    extensionPath,
    tools: CONTROLLED_TOOL_NAMES,
  };
}

function parseArgs(argv) {
  const options = { action: argv[0] ?? "status", rootDir: process.cwd(), input: {} };
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === "--root") options.rootDir = resolve(argv[++index]);
    else if (argv[index] === "--input") options.input = JSON.parse(argv[++index]);
    else throw new ControlError("invalid_input", `未知参数：${argv[index]}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const { action, rootDir, input } = parseArgs(argv);
    const handlers = {
      status: () => riskflowStatus({ rootDir }),
      doctor: () => doctor({ rootDir }),
      dispatch: () => riskflowDispatch(input, { rootDir }),
      wait: () => riskflowWait(input, { rootDir }),
      settle: () => riskflowSettle(input, { rootDir }),
      integrate: () => riskflowIntegrate(input, { rootDir }),
      reconcile: () => riskflowReconcile(input, { rootDir }),
    };
    if (!handlers[action]) throw new ControlError("invalid_action", `未知动作：${action}`);
    process.stdout.write(`${JSON.stringify(await handlers[action](), null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: false,
          code: error.code ?? "control_failure",
          reason: error.message,
          nextActions: error.nextActions ?? [],
        },
        null,
        2,
      )}\n`,
    );
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
}
