import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  DISPATCH_INPUT_TRUST_ISSUE_REF,
  collectStatus,
  defaultExec,
  gitCommonDir,
  readJsonCommand,
  resolveCoordinatorRoot,
  resolveOrcaInvocation,
  supersedableAttempt,
  unwrapResult,
} from "./status.mjs";

const TERMINAL_OUTCOMES = new Set(["succeeded", "failed", "blocked", "paused"]);
const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "blocked"]);
const RECONCILE_SAFE_VIOLATIONS = new Set(["checkpoint_mismatch", "worktree_reclaim_pending"]);
// 关闭一个已经消失的 terminal 不是失败：状态投影列出的是曾经记录的 handle，
// 上一次尝试或其它关闭者可能已经处理过它（Orca 返回 terminal_handle_stale）。
const TERMINAL_ALREADY_GONE_PATTERN =
  /terminal_handle_stale|terminal not found|no such terminal|already closed/iu;
// Orca 的 `worktree create` 可能在外部副作用已经发生之后才以运行时故障结束（实测 30 秒
// 后 `runtime_unavailable`）。只有这类"运行时不可用/响应丢失"错误才允许自持建立并取回
// 身份；参数、命名、权限等业务错误原样冒泡，否则会用一个自建工作树掩盖真实原因。
const ORCA_RUNTIME_FAILURE_PATTERN =
  /runtime_unavailable|closed the connection before responding|Timed out waiting for the Orca runtime to respond|Could not connect to the running Orca app/u;
// 信任阻断在失败文本里并不稳定（实测 worker-start 只报 agent_prompt_stalled），
// 因此文本判定之外还会对 terminal 屏幕做一次探测，见 terminalShowsWorkspaceTrustPrompt()。
const WORKSPACE_TRUST_PATTERN =
  /agent_prompt_blocked|workspace trust|trust this folder|trust and continue/iu;
const WORKTREE_IDENTITY_NEXT_ACTIONS = [
  '运行 `orca repo list --json` 确认该仓库的 externalWorktreeVisibility 为 "show"，并核对 worktreeBasePath 与 worktreeBaseRef',
  "运行 `orca worktree list --json` 与 `git worktree list --porcelain` 对账期望路径上的工作树",
  "对账实时事实后使用新的幂等键重试派发",
];
const GIT_WORKTREE_TIMEOUT_MS = 120_000;
const SETUP_COMMAND_TIMEOUT_MS = 600_000;
export const CONTROLLED_TOOL_NAMES = [
  "riskflow_status",
  "riskflow_dispatch",
  "riskflow_wait",
  "riskflow_reply",
  "riskflow_settle",
  "riskflow_integrate",
  "riskflow_reconcile",
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

function failureDetails(value) {
  if (typeof value === "string") {
    try {
      return failureDetails(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  if (value.stage || value.failedStage || value.lastError) return value;
  for (const key of ["result", "error", "details", "cause"]) {
    const nested = failureDetails(value[key]);
    if (nested) return nested;
  }
  return null;
}

function commandFailureDetails(error) {
  for (const value of [error?.cause?.stdout, error?.cause?.stderr, error?.stdout, error?.stderr]) {
    const details = failureDetails(value);
    if (details) return details;
  }
  return null;
}

function isWorkspaceTrustFailure(details, error, requireDispatchInput = false) {
  const stage = details?.stage ?? details?.failedStage ?? null;
  if (stage && stage !== "dispatch_input") return false;
  if (requireDispatchInput && stage !== "dispatch_input") return false;
  return WORKSPACE_TRUST_PATTERN.test(
    [details?.lastError, details?.message, error?.message].filter(Boolean).join(" "),
  );
}

async function inspectWorkerStartFailure(error, replay) {
  const direct = commandFailureDetails(error);
  if (direct) return direct;
  try {
    return failureDetails(await replay());
  } catch (replayError) {
    return commandFailureDetails(replayError);
  }
}

// 信任提示是 TUI 上的固定形态，比失败文本更贴近事实。探测失败（terminal 已释放、
// 无屏幕缓冲等）不改判失败分类：调用方仍按原始错误上抛。
async function terminalShowsWorkspaceTrustPrompt(exec, invocation, rootDir, terminalHandle) {
  if (!nonEmptyString(terminalHandle)) return false;
  try {
    const result = await orcaJson(
      exec,
      invocation,
      ["terminal", "read", "--terminal", terminalHandle, "--screen", "--json"],
      rootDir,
    );
    const screen = [result?.screen, result?.output].filter(Boolean).join("\n");
    return WORKSPACE_TRUST_PATTERN.test(screen);
  } catch {
    return false;
  }
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
  // `worktree_reclaim_pending` 由状态视图对每个 stale/reclaimable 节点派生，语义是「该工作项
  // 还有终态工作树待回收」的就绪标记，不是冲突。把它当阻断违规会让受控回收自身不可达，
  // 也会让一个已完成工作项的残留回收阻断其他工作项的派发，因此它 MUST NOT 阻断受控动作。
  const blockingViolations = snapshot.violations.filter(
    (violation) =>
      violation.code !== "worktree_reclaim_pending" &&
      !(
        (action === "reconcile" && RECONCILE_SAFE_VIOLATIONS.has(violation.code)) ||
        (adoptingAuxiliary && violation.nodeId === workItemId)
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
    if (replanApprovalRef && !["finalizing", "finalized", "paused"].includes(node.status)) {
      throw new ControlError(
        "replan_not_allowed",
        `${workItemId} 只有进入 finalizing、finalized 或 paused 后才能按批准引用重新规划`,
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
    if (replanApprovalRef && !supersedableAttempt(node.checkpoints)) {
      throw new ControlError(
        "replan_not_allowed",
        `${workItemId} 当前 planning/implementing 尝试仍在活动或已成功收口，不可被重开规划取代`,
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
    if (input.outcome === "succeeded" && node.worktree.dirty) {
      const actual = [...(node.worktree.dirtyPaths ?? [])].sort();
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
  } else if (action === "reply") {
    if (!node.checkpoints?.runId || node.checkpoints.runState === "settled") {
      throw new ControlError("reply_not_allowed", `${workItemId} 没有可回复的当前 Run`, [
        "调用 riskflow_status 获取最新 revision 和当前工作项",
      ]);
    }
  } else if (action === "reconcile") {
    if (
      node.checkpoints?.runState === "queued" &&
      node.checkpoints.issueRefs?.includes(DISPATCH_INPUT_TRUST_ISSUE_REF)
    ) {
      throw new ControlError(
        "reconcile_not_allowed",
        `${workItemId} 的工作区信任恢复必须复用当前 queued Task，不得创建替代尝试`,
        ["确认信任后，以新幂等键和同一 terminalHandle 调用 riskflow_dispatch"],
      );
    }
    if (!node.worktree?.id || !node.worktree?.head) {
      throw new ControlError("reconcile_not_allowed", `${workItemId} 缺少实际工作树或 HEAD`);
    }
  }
  return { node, queueItem };
}

export function nextTaskKind(node) {
  const attempts = node.orca?.attempts ?? [];
  const planningSucceeded = attempts.some(
    (attempt) => attempt.taskKind === "planning" && attempt.outcome === "succeeded",
  );
  // 从未成功完成规划时（首次派发被工作区信任确认阻断、或 reconcile 替一个还没规划的
  // 工作树生成了收尾尝试），change 还没有 applyRequires 工件：必须继续派发 planning，
  // 否则空工作树会被交给实现或收尾角色。已采纳的 auxiliary 工作树不适用该规则，
  // 仍走下面的 adopt 回退。
  const planningIncomplete = !node.auxiliary && !planningSucceeded && attempts.length > 0;
  if (planningIncomplete) return "planning";
  if (node.phase === "adopt" || node.status === "untracked") return "finalization";
  if (node.status === "ready") return "planning";
  if (node.status === "finalizing") {
    // 本轮是否仍需要审计由状态视图判定（同一收尾轮次最多一次限定审计）；
    // 这里不再凭检查点条件一律再派，避免同一收尾被重复派发。
    if (node.auditRequired === true) return "audit";
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
  const attemptGroup = replan
    ? `${node.id}:planning:${hash(approvalRef).slice(0, 12)}`
    : ((sameAttemptGroup ? checkpoint?.attemptGroup : null) ??
      `${node.id}:${taskKind === "audit" ? "audit" : phase}`);
  // 尝试次数是同一尝试组内的代次，选择当前尝试时按最大值取。只依据"当前检查点是否
  // 同类"来决定是否递增，会在不同职责先后进入同一组时撞号（例如 audit 失败后的修复
  // 回到 finalizing 组、却重新从 1 起算，状态视图于是回到已收口的旧尝试）。
  const groupAttempts = (node.orca?.attempts ?? [])
    .filter((attempt) => attempt.attemptGroup === attemptGroup)
    .map((attempt) => Number(attempt.attempt))
    .filter((value) => Number.isInteger(value));
  const attempt = replan
    ? 1
    : groupAttempts.length > 0
      ? Math.max(...groupAttempts) + 1
      : sameAttemptGroup
        ? Number(checkpoint?.attempt ?? 0) + 1
        : 1;
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
    attemptGroup,
    attempt,
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

// 初次获取保持 fail-fast（约 1 秒），避免调用方排在长操作后面；
// 长外部步骤结束后重新获取使用更宽预算，因为此时工作已完成、应尽量提交。
const LOCK_ACQUIRE_ATTEMPTS = 25;
const LOCK_REACQUIRE_ATTEMPTS = 1_500;

async function acquireRuntimeLock(lockDir, attempts = LOCK_ACQUIRE_ATTEMPTS) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await mkdir(lockDir);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await removeStaleLock(lockDir)) continue;
      await delay(40);
      continue;
    }
    await writeFile(
      resolve(lockDir, "owner.json"),
      JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
      "utf8",
    );
    return async () => {
      await rm(lockDir, { recursive: true });
    };
  }
  throw new ControlError("control_busy", "编排状态正在由另一操作更新，请稍后重试");
}

export async function withRuntimeLock(rootDir, exec, work) {
  const runtimeDir = resolve(await gitCommonDir(rootDir, exec), "riskflow-orchestration");
  const lockDir = resolve(runtimeDir, "control.lock");
  await mkdir(runtimeDir, { recursive: true });
  let release = await acquireRuntimeLock(lockDir);
  let held = true;
  const lock = {
    // 长外部步骤在锁外执行：它仍属于同一次幂等操作，只是不占用互斥资源。
    // 重新取锁写在 finally 中，调用点无法忘记；事实是否变化由调用方按 revision 校验。
    async withoutLock(step) {
      if (!held) throw new ControlError("lock_released", "运行时锁已让出，不能重复让出");
      await release();
      held = false;
      try {
        return await step();
      } finally {
        release = await acquireRuntimeLock(lockDir, LOCK_REACQUIRE_ATTEMPTS);
        held = true;
      }
    },
  };
  try {
    return await work(runtimeDir, lock);
  } finally {
    if (held) await release();
  }
}

// Orca 会在监督派发起步与 worker 报告收口时整体覆盖 `tasks.result`，而 v2 执行信封
// 历史上存放在该字段。控制器把当前尝试的正式信封另外持久化在 git common dir 的台账里，
// 状态视图只在该 Task 的 result 不再携带有效信封时用它补齐，Orca 侧的有效信封始终优先。
async function recordAttempt(runtimeDir, envelope) {
  const taskId = envelope.owner?.taskId;
  if (!nonEmptyString(taskId)) {
    throw new ControlError("invalid_input", "尝试信封缺少 owner.taskId，无法登记台账");
  }
  const attemptsDir = resolve(runtimeDir, "attempts");
  await mkdir(attemptsDir, { recursive: true });
  const path = resolve(attemptsDir, `${taskId}.json`);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(
    temporaryPath,
    JSON.stringify({ taskId, workItemId: envelope.workItemId, envelope }),
    "utf8",
  );
  await rename(temporaryPath, path);
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
  "reply",
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

// `--retry-request` 只在 orchestration 写命令上实现（与 sender 身份同一族）；terminal/worktree
// 命令会以 invalid_argument 拒绝它，附加即让调用必定失败（实测 terminal close）。
function withRetryRequest(args, retryRequest) {
  if (!retryRequest || args[0] !== "orchestration") return [];
  return ["--retry-request", retryRequest];
}

async function orcaJson(exec, invocation, args, cwd, retryRequest) {
  return unwrapResult(
    await readJsonCommand(
      exec,
      invocation.command,
      [
        ...invocation.prefix,
        ...withOrcaSender(invocation, args),
        ...withRetryRequest(args, retryRequest),
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

function taskSpec(node, taskKind, envelopeOptions = {}) {
  const responsibility = {
    planning:
      "按 change 实际 schema 和 applyRequires 创建并闭合规划工件，不实现代码；研究资料只读取 references/风险识别与评估规划事实源摘要.md",
    implementation:
      "按已批准 IP-ID 有界实现并在当前任务内修复普通测试失败；不提前创建 verification",
    finalization:
      "核验当前产物，在已批准语义内直接修复、回归，并按实际 schema 填写最终 verification；普通缺陷保持当前收尾责任",
    audit:
      "独立检查权限、事务、关键状态机或语义 merge 冲突的受影响范围；在当前任务内修复已批准范围的普通缺陷、回归并把最终结论补入 verification",
    archive: "仅在门禁通过后机械归档",
  }[taskKind];
  const lines = [
    `工作项：${node.id}`,
    `OpenSpec change：${node.change}`,
    `工作树：${node.worktree.id}`,
    `输入 HEAD：${node.worktree.head}`,
    responsibility,
    "先读 AGENTS.md、IMPLEMENTATION-ORCHESTRATION-HANDBOOK.md、IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md 和全部 OpenSpec contextFiles。",
    "公共契约、权限、持久化、迁移、依赖或批准范围变化必须 escalation；禁止提交、合并、归档或扩大范围。",
    "worker_done 必须列出产物 HEAD、证据、实际命令和剩余事项。",
  ];
  if (taskKind === "finalization" || taskKind === "audit") {
    lines.push(
      "",
      "=== 收尾轮次协议 ===",
      "每个独立 Task 使用新的 Agent session；只在当前仍活动的 Task 内连续修复，不复用已结束、失败、暂停或闲置的会话。",
      "同一收尾轮次最多一次限定审计；禁止请求或期待第二次审计，也禁止期待新的 Finalizer 接管本轮。",
      "机制上无法在当前任务内完成时必须 escalation，不得自行再开一轮。",
      "审计结论与任务内修复、回归证据必须一并写入同一 verification。",
    );
    if (taskKind === "audit") {
      lines.push(
        "你是本收尾轮次唯一的限定审计：发现已批准范围内的普通缺陷时，必须在当前任务内直接修复并回归；超出边界则 escalation。",
      );
    } else {
      lines.push(
        "若本次修改触及 permission/transaction/critical-state-machine/semantic-merge，本轮会由协调端触发一次限定审计；你填写的 verification 必须为审计结论留出位置。",
      );
    }
  }
  // 重开规划必须把「为什么重开」送进规划任务：否则规划者只按通用文案补齐模板章节，
  // 不会覆盖被取代尝试升级出来的批准范围（实测发生过一次）。
  if (nonEmptyString(envelopeOptions.approvalRef)) {
    const checkpoint = node.checkpoints ?? {};
    lines.push(
      "",
      "=== 本次为重开规划 ===",
      `批准引用：${envelopeOptions.approvalRef}`,
      `被取代的尝试组：${envelopeOptions.supersedesAttemptGroup ?? checkpoint.attemptGroup ?? "(未记录)"}`,
      `重开原因（被取代尝试的 issueRefs）：${JSON.stringify(checkpoint.issueRefs ?? [])}`,
      `被取代尝试的证据（evidenceRefs）：${JSON.stringify(checkpoint.evidenceRefs ?? [])}`,
      "本工作项 change 目录中由 proposal 引用的批准记录是本次规划的必要输入；先读取它，再据此规划。",
      "批准记录列出的范围必须逐项展开为 IP-ID、允许文件清单和验证命令；worker_done 必须逐项说明每一条的闭合情况，仅补齐模板章节不构成规划完成。",
      "若认定批准范围中任一项无法在该 change 已批准语义内闭合，必须在规划工件中显式说明并 escalation。",
    );
  }
  return lines.join("\n");
}

async function createWorktreeForReadyNode(ctx, invocation, node) {
  try {
    return await createWorktreeViaOrca(ctx.exec, invocation, ctx.rootDir, node);
  } catch (error) {
    if (error instanceof ControlError) throw error;
    if (!ORCA_RUNTIME_FAILURE_PATTERN.test(String(error?.message ?? ""))) throw error;
    const recovered = await ctx.lock.withoutLock(() =>
      provisionWorktreeWithoutOrca(ctx.exec, invocation, ctx.rootDir, node, error),
    );
    await assertFactsUnchanged(ctx);
    return recovered;
  }
}

async function createWorktreeViaOrca(exec, invocation, rootDir, node) {
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

function sameDirectory(left, right) {
  return nonEmptyString(left) && nonEmptyString(right) && resolve(left) === resolve(right);
}

// 回退的所有失败都保留原始 Orca 错误文本：真正的原因通常在那里，而不在症状里。
function worktreeIdentityError(detail, cause) {
  return new ControlError(
    "worktree_identity_unresolved",
    `Orca 工作树创建失败（${cause.message}），控制器回退也未能确认工作树身份：${detail}`,
    WORKTREE_IDENTITY_NEXT_ACTIONS,
  );
}

async function orcaRepoForRoot(exec, invocation, rootDir, cause) {
  let listed;
  try {
    listed = await orcaJson(exec, invocation, ["repo", "list"], rootDir);
  } catch (error) {
    throw worktreeIdentityError(`读取 orca repo list 失败：${error.message}`, cause);
  }
  const repo = (listed?.repos ?? []).find((candidate) => sameDirectory(candidate?.path, rootDir));
  if (
    !nonEmptyString(repo?.id) ||
    !nonEmptyString(repo?.displayName) ||
    !nonEmptyString(repo?.worktreeBasePath)
  ) {
    throw worktreeIdentityError(`orca repo list 未给出 ${rootDir} 的完整仓库元数据`, cause);
  }
  return repo;
}

async function resolveWorktreeBaseRef(exec, rootDir, ref, cause) {
  try {
    const head = String(await exec("git", ["rev-parse", ref], { cwd: rootDir })).trim();
    if (!head) throw new Error("空输出");
    return head;
  } catch (error) {
    throw worktreeIdentityError(`无法解析基线 ${ref}：${error.message}`, cause);
  }
}

// 期望路径上的 HEAD 无法解析时返回 null，表示该路径还不是可用的工作树。
async function pathHead(exec, worktreePath) {
  try {
    return String(
      await exec("git", ["-C", worktreePath, "rev-parse", "HEAD"], { cwd: worktreePath }),
    ).trim();
  } catch {
    return null;
  }
}

async function addGitWorktree(exec, rootDir, worktreePath, name, baseRef, cause) {
  const attempts = [
    ["worktree", "add", worktreePath, "-b", name, baseRef],
    ["worktree", "add", worktreePath, name],
  ];
  const failures = [];
  for (const args of attempts) {
    try {
      await exec("git", args, { cwd: rootDir, timeoutMs: GIT_WORKTREE_TIMEOUT_MS });
      return;
    } catch (error) {
      failures.push(error.message);
    }
  }
  throw worktreeIdentityError(`git worktree add 失败：${failures.join("；")}`, cause);
}

async function runRepoSetupScripts(exec, repo, worktreePath) {
  const script = repo.hookSettings?.scripts?.setup;
  if (!nonEmptyString(script)) return [];
  const warnings = [];
  for (const line of script.split("\n")) {
    const command = line.trim();
    if (!command) continue;
    try {
      await exec("sh", ["-c", command], { cwd: worktreePath, timeoutMs: SETUP_COMMAND_TIMEOUT_MS });
    } catch (error) {
      warnings.push({ command, message: error.message });
    }
  }
  return warnings;
}

function worktreeSetupError(worktreePath, warnings, cause) {
  const summary = warnings.map(({ command, message }) => `${command}: ${message}`).join("；");
  return new ControlError(
    "worktree_setup_failed",
    `Orca 工作树创建失败（${cause.message}），回退已建立 ${worktreePath}，但仓库 setup 失败：${summary}`,
    [
      `修复并在 ${worktreePath} 重新执行失败的 setup 命令`,
      "核对依赖与 OpenSpec 工具已就绪后，重新读取 riskflow_status 并使用新幂等键重试",
    ],
  );
}

// 身份只能来自实时事实：orca worktree list 中 repoId 相同、非主工作树、路径归一化后
// 等于期望路径的记录必须恰有一条。取不到唯一身份就 fail-closed，绝不返回一个"可能对"
// 的工作树。
async function takeBackWorktreeIdentity(
  exec,
  invocation,
  rootDir,
  repo,
  expectedPath,
  expectedHead,
  cause,
) {
  let listed;
  try {
    listed = await orcaJson(exec, invocation, ["worktree", "list"], rootDir);
  } catch (error) {
    throw worktreeIdentityError(`读取 orca worktree list 失败：${error.message}`, cause);
  }
  const matches = (listed?.worktrees ?? []).filter(
    (candidate) =>
      candidate?.repoId === repo.id &&
      candidate?.isMainWorktree !== true &&
      sameDirectory(candidate?.path, expectedPath),
  );
  if (matches.length !== 1) {
    throw worktreeIdentityError(
      `orca worktree list 在 ${expectedPath} 匹配到 ${matches.length} 条记录`,
      cause,
    );
  }
  const record = matches[0];
  if (!nonEmptyString(record.id) || !nonEmptyString(record.path) || !nonEmptyString(record.head)) {
    throw worktreeIdentityError(
      `orca worktree list 在 ${expectedPath} 的记录缺少 id/path/head`,
      cause,
    );
  }
  if (String(record.head).trim() !== expectedHead) {
    throw worktreeIdentityError(
      `取回的工作树 HEAD ${record.head} 与请求基线 ${expectedHead} 不一致`,
      cause,
    );
  }
  const info = await stat(record.path).catch(() => null);
  if (!info?.isDirectory()) {
    throw worktreeIdentityError(`取回的工作树路径 ${record.path} 不存在`, cause);
  }
  return {
    id: record.id,
    path: record.path,
    branch: nonEmptyString(record.branch)
      ? record.branch.replace(/^refs\/heads\//u, "")
      : record.branch,
    head: record.head,
  };
}

async function provisionWorktreeWithoutOrca(exec, invocation, rootDir, node, cause) {
  const name = node.id.toLowerCase();
  const repo = await orcaRepoForRoot(exec, invocation, rootDir, cause);
  const expectedPath = resolve(repo.path, repo.worktreeBasePath, repo.displayName, name);
  const baseRef = nonEmptyString(repo.worktreeBaseRef) ? repo.worktreeBaseRef : "main";
  const expectedHead = await resolveWorktreeBaseRef(exec, rootDir, baseRef, cause);
  // 副作用已经发生是这次故障最主要的形态：先确认再建立，绝不重复建立。
  if ((await pathHead(exec, expectedPath)) !== expectedHead) {
    let added = false;
    try {
      await addGitWorktree(exec, rootDir, expectedPath, name, baseRef, cause);
      added = true;
    } catch (error) {
      // Orca 的延迟副作用可能正好在首次确认后落地，令 git add 因路径/分支
      // 已存在而失败。只有实时 HEAD 已等于基线时才继续，其余错误仍原样冒泡。
      if ((await pathHead(exec, expectedPath)) !== expectedHead) throw error;
    }
    if (added) {
      const setupWarnings = await runRepoSetupScripts(exec, repo, expectedPath);
      if (setupWarnings.length > 0) throw worktreeSetupError(expectedPath, setupWarnings, cause);
    }
  }
  const worktree = await takeBackWorktreeIdentity(
    exec,
    invocation,
    rootDir,
    repo,
    expectedPath,
    expectedHead,
    cause,
  );
  return {
    ...node,
    worktree,
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
      taskSpec(node, taskKind, envelopeOptions),
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

// 从状态视图投影或控制器自建信封归一化出一次尝试的完整 v2 信封：位置与阶段字段
// 一律以路线节点为准，尝试身份以派发信封为准，且不携带任何质量结论。
// 投影会把 outcome/approvalRef/supersedesAttemptGroup 补成 null，且不携带
// schemaVersion、worktreeId、inputHead；直接使用会触发 premature_outcome、
// invalid_replan_boundary 或 missing_fields。
function attemptEnvelope(node, task, runState) {
  const source = task.envelope;
  const envelope = {
    ...source,
    schemaVersion: 2,
    workItemId: node.id,
    routeNodeId: node.routeNodeId,
    changeName: node.change,
    taskKind: source.taskKind,
    phase: taskPhase(source.taskKind),
    worktreeId: node.worktree.id,
    inputHead: node.worktree.head,
    runState,
    owner: {
      ...(source.owner ?? {}),
      taskId: task.taskId,
      agentClass: source.owner?.agentClass ?? task.role.agentClass,
      model: source.owner?.model ?? task.role.model,
    },
  };
  delete envelope.outcome;
  delete envelope.outputHead;
  if (!nonEmptyString(envelope.approvalRef)) delete envelope.approvalRef;
  if (!nonEmptyString(envelope.supersedesAttemptGroup)) delete envelope.supersedesAttemptGroup;
  return envelope;
}

async function recordWorkspaceTrustRecovery(runtimeDir, node, task) {
  const envelope = attemptEnvelope(node, task, "queued");
  await recordAttempt(runtimeDir, {
    ...envelope,
    issueRefs: [...new Set([...(envelope.issueRefs ?? []), DISPATCH_INPUT_TRUST_ISSUE_REF])],
  });
}

function workspaceTrustError(terminalHandle) {
  return new ControlError(
    "workspace_trust_required",
    `${terminalHandle} 正在等待 Codex 工作区信任确认；当前 queued Task 尚未生成 failed attempt`,
    [
      `在 ${terminalHandle} 中确认当前工作区信任并等待 tui-idle`,
      `重新读取 riskflow_status，并以新幂等键调用 riskflow_dispatch，传入 terminalHandle=${terminalHandle}`,
    ],
  );
}

async function startWorker(exec, invocation, rootDir, runtimeDir, node, task, idempotencyKey) {
  const worktree = `id:${node.worktree.id}`;
  if (["planning", "finalization", "audit"].includes(task.envelope.taskKind)) {
    let terminalHandle = task.terminalHandle;
    if (!terminalHandle) {
      const terminal = await orcaJson(
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
          `codex --model ${task.role.model} -c model_reasoning_effort="${task.role.thinking}" -a never -s danger-full-access`,
        ],
        rootDir,
      );
      terminalHandle =
        terminal?.agentTerminalHandle ??
        terminal?.startupTerminal?.handle ??
        terminal?.terminal?.handle ??
        terminal?.handle;
      if (!terminalHandle)
        throw new ControlError("orca_result_invalid", "Orca 未返回 Codex terminal handle");
    }
    try {
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
    } catch (error) {
      if (
        !isWorkspaceTrustFailure(commandFailureDetails(error), error) &&
        !(await terminalShowsWorkspaceTrustPrompt(exec, invocation, rootDir, terminalHandle))
      )
        throw error;
      await recordWorkspaceTrustRecovery(runtimeDir, node, task);
      throw workspaceTrustError(terminalHandle);
    }
    let worker;
    const workerStartArgs = [
      "orchestration",
      "worker-start",
      "--run",
      task.runId,
      "--task",
      task.taskId,
      "--worktree",
      worktree,
      "--terminal",
      terminalHandle,
    ];
    const workerStartRetry = retryRequest(idempotencyKey, "worker-start");
    try {
      worker = await orcaJson(exec, invocation, workerStartArgs, rootDir, workerStartRetry);
    } catch (error) {
      const details = await inspectWorkerStartFailure(error, () =>
        orcaJson(exec, invocation, workerStartArgs, rootDir, workerStartRetry),
      );
      if (
        !isWorkspaceTrustFailure(details, error, true) &&
        !(await terminalShowsWorkspaceTrustPrompt(exec, invocation, rootDir, terminalHandle))
      )
        throw error;
      await recordWorkspaceTrustRecovery(runtimeDir, node, task);
      throw workspaceTrustError(terminalHandle);
    }
    return {
      ...worker,
      ...(await recordRunningAttempt(runtimeDir, node, task)),
    };
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
  const worker = await orcaJson(
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
  // 实现分支同样要把台账推进到 running：否则状态视图在整段实现期间仍报告
  // runState=queued，并给出"派发当前信封指定的受控任务"这种会导致重复派发的下一动作。
  return { ...worker, ...(await recordRunningAttempt(runtimeDir, node, task)) };
}

// worker 已启动意味着该尝试进入运行态；登记失败不使派发失败（worker 已在跑，
// 报告失败会诱导上层盲重试），但必须以结构化 warning 暴露，因为该尝试随后可能
// 因 Orca 覆盖 result 而无法从状态视图解析。
async function recordRunningAttempt(runtimeDir, node, task) {
  try {
    await recordAttempt(runtimeDir, attemptEnvelope(node, task, "running"));
    return { attemptRecorded: true };
  } catch (error) {
    return {
      attemptRecorded: false,
      attemptWarning: `worker 已启动，但运行中尝试登记台账失败：${error.message}`,
    };
  }
}

async function controlledMutation(action, input, options, perform) {
  const exec = options.exec ?? defaultExec;
  const rootDir = await resolveCoordinatorRoot(options.rootDir ?? process.cwd(), exec);
  requiredString(input.expectedRevision, "expectedRevision");
  const idempotencyKey = requiredString(input.idempotencyKey, "idempotencyKey");
  return withRuntimeLock(rootDir, exec, async (runtimeDir, lock) => {
    const prior = await readReceipt(runtimeDir, idempotencyKey, { action, ...input });
    if (prior !== null) return prior;
    const collect = options.statusProvider ?? collectStatus;
    const status = await collect({ rootDir, exec });
    if (status.graphIssues?.length) {
      throw new ControlError("invalid_manifest", status.graphIssues.join("; "));
    }
    const checked = preflightAction(status.snapshot, action, input);
    await writeReceipt(runtimeDir, idempotencyKey, { action, ...input }, "inflight");
    const result = await perform({
      rootDir,
      runtimeDir,
      lock,
      exec,
      idempotencyKey,
      revision: status.snapshot.revision,
      collectStatus: () => collect({ rootDir, exec }),
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
      node = await createWorktreeForReadyNode(ctx, invocation, node);
    }
    const replanApprovalRef = input.replanApprovalRef;
    // 复用的排队尝试必须按它自己的角色启动：它的任务说明本来就属于那个角色，
    // 用节点当前阶段重新推导会把规划尝试交给实现模型并记成实现尝试。
    const pendingAttempt =
      !replanApprovalRef && node.checkpoints?.runState === "queued" && node.checkpoints.taskId;
    const taskKind = replanApprovalRef
      ? "planning"
      : pendingAttempt
        ? node.checkpoints.taskKind
        : nextTaskKind(node);
    if (pendingAttempt && !ctx.graph.policy.roles[taskKind]) {
      throw new ControlError(
        "unknown_task_kind",
        `${node.id} 的排队尝试角色 ${taskKind} 不在 Manifest 角色表中`,
        node.nextActions,
      );
    }
    const terminalHandle =
      input.terminalHandle === undefined
        ? null
        : requiredString(input.terminalHandle, "terminalHandle");
    const runId = await ensureRun(ctx.exec, invocation, ctx.rootDir, node, ctx.idempotencyKey);
    let task;
    if (pendingAttempt) {
      task = {
        taskId: node.checkpoints.taskId,
        runId: node.checkpoints.runId ?? runId,
        envelope: { ...node.checkpoints, taskKind },
        role: ctx.graph.policy.roles[taskKind],
        terminalHandle,
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
      task.terminalHandle = terminalHandle;
    }
    await recordAttempt(ctx.runtimeDir, attemptEnvelope(node, task, "queued"));
    const worker = await startWorker(
      ctx.exec,
      invocation,
      ctx.rootDir,
      ctx.runtimeDir,
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
  const ackDeliveryId =
    input.ackDeliveryId === undefined ? null : requiredString(input.ackDeliveryId, "ackDeliveryId");
  const invocation = resolveOrcaInvocation(options.orcaCommand);
  return orcaJson(
    options.exec ?? defaultExec,
    invocation,
    [
      "orchestration",
      "check",
      "--run",
      node.checkpoints.runId,
      ...(ackDeliveryId ? ["--ack", ackDeliveryId] : []),
      "--wait",
      "--types",
      "worker_done,escalation,question",
      "--timeout-ms",
      String(timeoutMs),
    ],
    rootDir,
  );
}

export async function riskflowReply(input, options = {}) {
  requiredString(input.messageId, "messageId");
  requiredString(input.body, "body");
  return controlledMutation("reply", input, options, async (ctx) => {
    const invocation = resolveOrcaInvocation(options.orcaCommand);
    const result = await orcaJson(
      ctx.exec,
      invocation,
      [
        "orchestration",
        "reply",
        "--id",
        input.messageId,
        "--body",
        input.body,
        "--run",
        ctx.node.checkpoints.runId,
      ],
      ctx.rootDir,
      retryRequest(ctx.idempotencyKey, "reply"),
    );
    return { ok: true, action: "reply", workItemId: ctx.node.id, result };
  });
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
    if (outcome === "succeeded" && ctx.node.worktree.dirty) {
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
      // 获批重开规划的边界由这对字段标记；收口若丢掉它们，边界随之消失，
      // 被取代的旧尝试会重新参与当前尝试选择（实测导致节点回退成 unknown）。
      // 校验把这对字段视为整体，因此只在两者都非空时才成对保留。
      ...(nonEmptyString(checkpoint.approvalRef) &&
      nonEmptyString(checkpoint.supersedesAttemptGroup)
        ? {
            approvalRef: checkpoint.approvalRef,
            supersedesAttemptGroup: checkpoint.supersedesAttemptGroup,
          }
        : {}),
    };
    const invocation = resolveOrcaInvocation(options.orcaCommand);
    if (!TERMINAL_TASK_STATUSES.has(checkpoint.taskStatus)) {
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
    }
    await recordAttempt(ctx.runtimeDir, envelope);
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
  if (!TERMINAL_TASK_STATUSES.has(checkpoint.taskStatus)) {
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
  }
  await recordAttempt(ctx.runtimeDir, envelope);
  return envelope;
}

export async function riskflowIntegrate(input, options = {}) {
  return controlledMutation("integrate", input, options, async (ctx) => {
    if (ctx.snapshot.main.dirty) {
      throw new ControlError("main_dirty", "main 工作树存在未提交改动，不能集成");
    }
    if (ctx.queueItem.category === "cleanup") {
      const invocation = resolveOrcaInvocation(options.orcaCommand);
      if (ctx.node.status === "stale") {
        const handles = ctx.node.orca?.terminalHandles ?? [];
        // 回收就绪标记由状态视图对 stale/reclaimable 派生，是回收触发条件本身；
        // 把它当作阻断违规会让受控回收永远不可达。其他违规仍然 fail-closed。
        const blockingViolations = ctx.snapshot.violations.filter(
          (violation) => violation.code !== "worktree_reclaim_pending",
        );
        const safelySettled =
          ctx.node.main?.archive === true &&
          ctx.node.main?.verification === "passed" &&
          ctx.node.worktree?.exists === true &&
          ctx.node.worktree.dirty === false &&
          ctx.node.checkpoints?.runState === "settled" &&
          ctx.node.checkpoints?.outcome === "succeeded" &&
          ctx.node.violations.length === 0 &&
          blockingViolations.length === 0 &&
          handles.length > 0;
        if (!safelySettled) {
          throw new ControlError(
            "cleanup_not_safe",
            `${ctx.node.id} 不满足终态 terminal 自动清理前提`,
            ctx.node.nextActions,
          );
        }
        for (const handle of handles) {
          try {
            await orcaJson(
              ctx.exec,
              invocation,
              ["terminal", "close", "--terminal", handle],
              ctx.rootDir,
            );
          } catch (error) {
            // 状态投影列出的是曾经记录的 handle；上一次尝试或其它关闭者可能已经处理过它。
            // 「已经不存在」不是失败，其余错误（权限、运行时不可用、参数）仍 fail-closed。
            if (!TERMINAL_ALREADY_GONE_PATTERN.test(String(error?.message ?? error))) throw error;
          }
        }
        const current = await ctx.collectStatus();
        const refreshed = findWorkItem(current.snapshot, ctx.node.id);
        if (
          refreshed?.status !== "reclaimable" ||
          refreshed.worktree?.id !== ctx.node.worktree.id
        ) {
          throw new ControlError(
            "cleanup_not_reclaimable",
            `${ctx.node.id} 关闭终态 terminal 后仍不可回收`,
            refreshed?.nextActions ?? ["调用 riskflow_status 重新对账"],
          );
        }
      } else if (ctx.node.status !== "reclaimable") {
        throw new ControlError(
          "cleanup_not_safe",
          `${ctx.node.id} 当前不可回收`,
          ctx.node.nextActions,
        );
      }
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
      await ctx.lock.withoutLock(() =>
        ctx.exec("pnpm", ["verify"], {
          cwd: ctx.rootDir,
          timeoutMs: 30 * 60_000,
          env: verificationEnv(),
        }),
      );
      await assertFactsUnchanged(ctx);
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

// 外部验证命令 MUST NOT 继承协调者身份：协调终端设置 ORCA_TERMINAL_HANDLE 后，
// resolveOrcaInvocation 会把 CLI 从 orca-ide 切换为 orca，使验证结论取决于发起终端。
function verificationEnv() {
  const env = { ...process.env };
  delete env.ORCA_TERMINAL_HANDLE;
  delete env.ORCA_CLI_COMMAND;
  return env;
}

// 长外部步骤在锁外执行，因此必须重新确认它依据的事实没有变化。只比对这一步真正
// 依赖的不变量（阶段、当前尝试、main HEAD、违规集合），而不是整个事实集哈希：
// 长步骤自身的构建/测试会产生瞬时文件变化，用全量哈希会把它们误判为并发写者，
// 从而无谓丢弃一次已经通过的复验。
async function assertFactsUnchanged(ctx) {
  const current = await ctx.collectStatus();
  const node = current.snapshot.nodes.find((candidate) => candidate.id === ctx.node.id);
  const drift = [];
  if (node?.status !== ctx.node.status) {
    drift.push(`工作项状态 ${ctx.node.status} → ${node?.status ?? "(缺失)"}`);
  }
  if (node?.checkpoints?.taskId !== ctx.node.checkpoints?.taskId) {
    drift.push("当前尝试已变化");
  }
  if (current.snapshot.main.head !== ctx.snapshot.main.head) {
    drift.push("main HEAD 已变化");
  }
  if (current.snapshot.violations.length > 0) {
    drift.push("出现新的状态违规");
  }
  if (drift.length > 0) {
    throw new ControlError("stale_revision", `长外部步骤期间编排状态已变化：${drift.join("；")}`, [
      "调用 riskflow_status 获取新 revision",
    ]);
  }
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
    await recordAttempt(ctx.runtimeDir, envelope);
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
      reply: () => riskflowReply(input, { rootDir }),
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
