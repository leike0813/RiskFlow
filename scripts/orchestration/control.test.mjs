import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";
import {
  CONTROLLED_TOOL_NAMES,
  ControlError,
  canCompleteGoal,
  createV2Envelope,
  preflightAction,
  riskflowDispatch,
  riskflowIntegrate,
  riskflowReconcile,
  riskflowReply,
  riskflowSettle,
  riskflowWait,
  withOrcaSender,
  withRuntimeLock,
} from "./control.mjs";
import { formatCurrentState, shouldBlockDirectCommand } from "./omp-extension.mjs";

// 编排测试必须与调用方环境隔离：协调终端会设置 ORCA_TERMINAL_HANDLE，使
// resolveOrcaInvocation 返回 `orca` 而不是假 exec 期望的 `orca-ide`，令同一批
// 用例在干净 shell 与 Orca 终端中得到不同结论。
const ambientOrchestrationEnv = {
  terminalHandle: process.env.ORCA_TERMINAL_HANDLE,
  cliCommand: process.env.ORCA_CLI_COMMAND,
};
delete process.env.ORCA_TERMINAL_HANDLE;
delete process.env.ORCA_CLI_COMMAND;
afterAll(() => {
  if (ambientOrchestrationEnv.terminalHandle !== undefined) {
    process.env.ORCA_TERMINAL_HANDLE = ambientOrchestrationEnv.terminalHandle;
  }
  if (ambientOrchestrationEnv.cliCommand !== undefined) {
    process.env.ORCA_CLI_COMMAND = ambientOrchestrationEnv.cliCommand;
  }
});

function node(overrides = {}) {
  return {
    id: "C17",
    workItemId: "C17",
    routeNodeId: "C17",
    kind: "change",
    change: "deliver-process-model",
    status: "finalizing",
    phase: "finalizing",
    violations: [],
    nextActions: ["派发强模型 Finalizer"],
    worktree: {
      id: "repo::/tmp/c17",
      path: "/tmp/c17",
      branch: "feature/c17",
      head: "feature-head",
      dirty: false,
      git: { head: "feature-head", dirty: false, dirtyPaths: [] },
    },
    checkpoints: {
      taskId: "task-finalizer",
      runId: "run-finalizer",
      taskKind: "finalization",
      phase: "finalizing",
      runState: "queued",
      outcome: null,
      baseHead: "feature-head",
      head: "feature-head",
      owner: {
        taskId: "task-finalizer",
        agentClass: "strong-finalizer",
        model: "gpt-5.6-sol",
      },
      attemptGroup: "C17:finalizing",
      attempt: 1,
      auditPolicy: "self",
      issueRefs: [],
      evidenceRefs: [],
      main: {
        mergeCommit: null,
        mainHead: null,
        verification: "pending",
        archiveCommit: null,
      },
    },
    orca: { attempts: [] },
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  const current = node();
  return {
    schemaVersion: 2,
    revision: "revision-1",
    main: { head: "main-head", branch: "main", dirty: false, dirtyPaths: [] },
    nodes: [current],
    resumeQueue: [
      {
        workItemId: current.id,
        category: "finalizing",
        nextAction: current.nextActions[0],
      },
    ],
    violations: [],
    ...overrides,
  };
}

const graph = {
  policy: {
    roles: {
      planning: {
        agentClass: "strong-planner",
        model: "gpt-5.6-sol",
        thinking: "high",
      },
      finalization: {
        agentClass: "strong-finalizer",
        model: "gpt-5.6-sol",
        thinking: "high",
      },
      implementation: {
        agentClass: "bounded-implementer",
        model: "commandcode/deepseek/deepseek-v4.1-flash",
        thinking: "max",
      },
      audit: {
        agentClass: "strong-auditor",
        model: "gpt-5.6-sol",
        thinking: "high",
      },
    },
    targetedAudit: ["permission", "transaction", "critical-state-machine", "semantic-merge"],
    noProgressLimit: 3,
  },
};

function fakeCodexTerminal(command, args) {
  if (command !== "orca-ide" || args[0] !== "terminal") return null;
  if (args[1] === "create") return { terminal: { handle: "term-codex" } };
  if (args[1] === "wait") return {};
  return null;
}

describe("controlled orchestration", () => {
  it("blocks direct orchestration mutations but permits read-only checks", () => {
    expect(shouldBlockDirectCommand("orca-ide orchestration dispatch --run r --task t")).toBe(true);
    expect(shouldBlockDirectCommand("orca terminal create --worktree active --command codex")).toBe(
      true,
    );
    expect(shouldBlockDirectCommand("git merge feature/c26")).toBe(true);
    expect(shouldBlockDirectCommand("pnpm orchestration:check")).toBe(false);
  });

  it("passes the coordinator terminal as Orca sender for mutations", () => {
    const invocation = {
      command: "orca",
      prefix: [],
      senderTerminalHandle: "term-coordinator",
    };
    expect(withOrcaSender(invocation, ["orchestration", "task-create", "--spec", "task"])).toEqual([
      "orchestration",
      "task-create",
      "--spec",
      "task",
      "--from",
      "term-coordinator",
    ]);
    expect(withOrcaSender(invocation, ["orchestration", "status"])).toEqual([
      "orchestration",
      "status",
    ]);
  });

  it("formats a short resumable state view", () => {
    const text = formatCurrentState({
      revision: "rev-1",
      resumeQueue: [{ workItemId: "C26", category: "finalizing", nextAction: "继续 Finalizer" }],
      nodes: [{ id: "AUX:old", status: "stale", nextActions: ["受控 cleanup"] }],
      violations: [],
      diagnostics: [{ code: "historical_orphan_task" }],
    });
    expect(text).toContain("revision: rev-1");
    expect(text).toContain("C26: 继续 Finalizer");
    expect(text).toContain("AUX:old: 受控 cleanup");
    expect(text).toContain("1 non-blocking (historical_orphan_task)");
    expect(CONTROLLED_TOOL_NAMES).toEqual([
      "riskflow_status",
      "riskflow_dispatch",
      "riskflow_wait",
      "riskflow_reply",
      "riskflow_settle",
      "riskflow_integrate",
      "riskflow_reconcile",
    ]);
  });

  it("replies once to a message in the current run", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-reply-"));
    const running = node({
      checkpoints: { ...node().checkpoints, runState: "running" },
    });
    let calls = 0;
    let replyArgs;
    const exec = async (command, args) => {
      if (command === "git") return runtimeRoot;
      if (command === "orca-ide" && args.includes("reply")) {
        calls += 1;
        replyArgs = args;
        return { message: { id: "reply-1" } };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    const input = {
      workItemId: "C17",
      expectedRevision: "revision-1",
      idempotencyKey: "reply-current-run",
      messageId: "msg-question",
      body: "继续按实际 schema 收尾",
    };
    const options = {
      rootDir: process.cwd(),
      exec,
      statusProvider: async () => ({
        graph,
        snapshot: snapshot({ nodes: [running] }),
      }),
    };
    try {
      const first = await riskflowReply(input, options);
      const replay = await riskflowReply(input, options);
      expect(first).toEqual(replay);
      expect(calls).toBe(1);
      expect(replyArgs).toEqual(
        expect.arrayContaining([
          "--id",
          "msg-question",
          "--body",
          "继续按实际 schema 收尾",
          "--run",
          "run-finalizer",
        ]),
      );
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("acknowledges the prior Delivery before waiting for the next worker event", async () => {
    const calls = [];
    const exec = async (command, args) => {
      if (command === "git") return process.cwd();
      if (command === "orca-ide" && args.includes("check")) {
        calls.push(args);
        return args.includes("--ack")
          ? { delivery: { id: "delivery-2" }, messages: [{ id: "msg-next" }] }
          : { delivery: { id: "delivery-1" }, messages: [{ id: "msg-same" }] };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    const options = {
      rootDir: process.cwd(),
      exec,
      statusProvider: async () => ({ graph, snapshot: snapshot() }),
    };
    const first = await riskflowWait({ workItemId: "C17", timeoutMs: 1000 }, options);
    const next = await riskflowWait(
      { workItemId: "C17", ackDeliveryId: first.delivery.id, timeoutMs: 1000 },
      options,
    );
    expect(next.messages).toEqual([{ id: "msg-next" }]);
    expect(calls[1]).toEqual(expect.arrayContaining(["--ack", "delivery-1"]));
  });

  it("stops before worker-start when a new Codex terminal still needs workspace trust", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-codex-trust-"));
    let terminalCreates = 0;
    let trusted = false;
    let workerStarts = 0;
    let workerStartArgs;
    const exec = async (command, args) => {
      if (command === "git") return runtimeRoot;
      if (command === "orca-ide" && args[0] === "terminal" && args[1] === "create") {
        terminalCreates += 1;
        return { terminal: { handle: "term-codex-trust" } };
      }
      if (command === "orca-ide" && args[0] === "terminal" && args[1] === "wait") {
        if (!trusted) throw new Error("agent_prompt_blocked: workspace trust required");
        return {};
      }
      if (command === "orca-ide" && args.includes("worker-start")) {
        workerStarts += 1;
        workerStartArgs = args;
        return { state: "started" };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    try {
      await expect(
        riskflowDispatch(
          {
            workItemId: "C17",
            expectedRevision: "revision-1",
            idempotencyKey: "dispatch-codex-trust",
          },
          {
            rootDir: process.cwd(),
            exec,
            statusProvider: async () => ({ graph, snapshot: snapshot() }),
          },
        ),
      ).rejects.toMatchObject({ code: "workspace_trust_required" });
      expect(workerStarts).toBe(0);
      trusted = true;
      const resumed = await riskflowDispatch(
        {
          workItemId: "C17",
          expectedRevision: "revision-1",
          idempotencyKey: "dispatch-codex-after-trust",
          terminalHandle: "term-codex-trust",
        },
        {
          rootDir: process.cwd(),
          exec,
          statusProvider: async () => ({ graph, snapshot: snapshot() }),
        },
      );
      expect(resumed.worker).toMatchObject({ state: "started" });
      expect(terminalCreates).toBe(1);
      expect(workerStartArgs).toEqual(expect.arrayContaining(["--terminal", "term-codex-trust"]));
      expect(workerStartArgs).not.toContain("--agent");
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("continues the attempt number from the target attempt group history", () => {
    const auditCheckpoint = {
      ...node().checkpoints,
      taskId: "task-audit",
      taskKind: "audit",
      phase: "finalizing",
      runState: "settled",
      outcome: "failed",
      attemptGroup: "C17:audit",
      attempt: 1,
    };
    const withHistory = node({
      checkpoints: auditCheckpoint,
      orca: {
        attempts: [
          { taskId: "task-1", attemptGroup: "C17:finalizing", attempt: 1 },
          { taskId: "task-2", attemptGroup: "C17:finalizing", attempt: 2 },
          { taskId: "task-audit", attemptGroup: "C17:audit", attempt: 1 },
        ],
      },
    });
    expect(
      createV2Envelope({
        node: withHistory,
        taskId: "task-repair",
        taskKind: "finalization",
        role: graph.policy.roles.finalization,
      }),
    ).toMatchObject({ attemptGroup: "C17:finalizing", attempt: 3 });

    expect(
      createV2Envelope({
        node: node({ checkpoints: auditCheckpoint }),
        taskId: "task-repair-2",
        taskKind: "finalization",
        role: graph.policy.roles.finalization,
      }),
    ).toMatchObject({ attemptGroup: "C17:finalizing", attempt: 1 });
  });

  it("keeps finalizing dispatch bound to the strong Finalizer role", () => {
    const current = node();
    const checked = preflightAction(snapshot(), "dispatch", {
      workItemId: "C17",
      expectedRevision: "revision-1",
      role: "bounded-implementer",
    });
    expect(checked.node.status).toBe("finalizing");
    const envelope = createV2Envelope({
      node: current,
      taskId: "next-task",
      taskKind: "finalization",
      role: graph.policy.roles.finalization,
    });
    expect(envelope.owner.agentClass).toBe("strong-finalizer");
    expect(envelope).not.toHaveProperty("outputHead");
  });

  it("starts a new attempt group when responsibility changes", () => {
    const planned = node({
      phase: "planning",
      checkpoints: {
        ...node().checkpoints,
        taskKind: "planning",
        phase: "planning",
        attemptGroup: "C17:planning",
        attempt: 3,
      },
    });
    expect(
      createV2Envelope({
        node: planned,
        taskId: "implementation-1",
        taskKind: "implementation",
        role: { agentClass: "bounded-implementer", model: "deepseek" },
      }),
    ).toMatchObject({ attemptGroup: "C17:implementing", attempt: 1 });
  });

  it("requires explicit approval to reopen planning and records the superseded attempt", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-replan-"));
    const paused = node({
      status: "paused",
      checkpoints: {
        ...node().checkpoints,
        runState: "settled",
        outcome: "paused",
        issueRefs: ["assessment-basis-resolver-drift", "requires-c19-delegate-dependency"],
        evidenceRefs: ["worker-report:msg-9e588210c8cd"],
      },
    });
    const pausedSnapshot = snapshot({ nodes: [paused], resumeQueue: [] });
    expect(() =>
      preflightAction(pausedSnapshot, "dispatch", {
        workItemId: "C17",
        expectedRevision: "revision-1",
      }),
    ).toThrowError(expect.objectContaining({ code: "replan_approval_required" }));
    let createdSpec;
    let writtenEnvelope;
    const exec = async (command, args) => {
      if (command === "git") return runtimeRoot;
      const terminal = fakeCodexTerminal(command, args);
      if (terminal !== null) return terminal;
      if (command === "orca-ide" && args.includes("task-create")) {
        createdSpec = args[args.indexOf("--spec") + 1];
        return { id: "task-replan" };
      }
      if (command === "orca-ide" && args.includes("task-update")) {
        writtenEnvelope = JSON.parse(args[args.indexOf("--result") + 1]);
        return {};
      }
      if (command === "orca-ide" && args.includes("worker-start")) return { id: "worker-replan" };
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    try {
      await riskflowDispatch(
        {
          workItemId: "C17",
          expectedRevision: "revision-1",
          idempotencyKey: "replan-c17-approved",
          replanApprovalRef: "approval://riskflow/C17/2",
        },
        {
          rootDir: process.cwd(),
          exec,
          statusProvider: async () => ({ graph, snapshot: pausedSnapshot }),
        },
      );
      expect(writtenEnvelope).toMatchObject({
        schemaVersion: 2,
        taskKind: "planning",
        phase: "planning",
        approvalRef: "approval://riskflow/C17/2",
        supersedesAttemptGroup: "C17:finalizing",
        attempt: 1,
      });
      expect(writtenEnvelope.attemptGroup).toMatch(/^C17:planning:/u);
      expect(createdSpec).toContain("IMPLEMENTATION-ORCHESTRATION-RUNBOOK.md");
      expect(createdSpec).toContain("references/风险识别与评估规划事实源摘要.md");
      expect(createdSpec).toContain("本次为重开规划");
      expect(createdSpec).toContain("approval://riskflow/C17/2");
      expect(createdSpec).toContain("C17:finalizing");
      expect(createdSpec).toContain("assessment-basis-resolver-drift");
      expect(createdSpec).toContain("worker-report:msg-9e588210c8cd");
      expect(createdSpec).toContain("先读取它，再据此规划");
      expect(createdSpec).toContain("仅补齐模板章节不构成规划完成");
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("keeps the generic planning briefing when no replan is approved", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-planning-generic-"));
    const ready = node({
      status: "ready",
      checkpoints: { ...node().checkpoints, runState: "settled", outcome: "failed" },
    });
    const readySnapshot = snapshot({
      nodes: [ready],
      resumeQueue: [{ workItemId: "C17", category: "ready", nextAction: "创建有界规划任务" }],
    });
    let createdSpec;
    const exec = async (command, args) => {
      if (command === "git") return runtimeRoot;
      const terminal = fakeCodexTerminal(command, args);
      if (terminal !== null) return terminal;
      if (command === "orca-ide" && args.includes("task-create")) {
        createdSpec = args[args.indexOf("--spec") + 1];
        return { id: "task-planning" };
      }
      if (command === "orca-ide" && args.includes("task-update")) return {};
      if (command === "orca-ide" && args.includes("worker-start")) return { id: "worker-planning" };
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    try {
      await riskflowDispatch(
        {
          workItemId: "C17",
          expectedRevision: "revision-1",
          idempotencyKey: "dispatch-c17-planning-generic",
        },
        {
          rootDir: process.cwd(),
          exec,
          statusProvider: async () => ({ graph, snapshot: readySnapshot }),
        },
      );
      expect(createdSpec).toContain("按 change 实际 schema 和 applyRequires 创建并闭合规划工件");
      expect(createdSpec).not.toContain("本次为重开规划");
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("records a running attempt for the implementation dispatch path too", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-impl-ledger-"));
    const planning = node({
      status: "running",
      phase: "planning",
      checkpoints: {
        ...node().checkpoints,
        taskKind: "planning",
        phase: "planning",
        runState: "settled",
        outcome: "succeeded",
      },
    });
    const planningSnapshot = snapshot({
      nodes: [planning],
      resumeQueue: [
        { workItemId: "C17", category: "planning", nextAction: "创建有界首轮实现任务" },
      ],
    });
    const exec = async (command, args) => {
      if (command === "git") return runtimeRoot;
      if (command === "orca-ide" && args.includes("task-create")) return { id: "task-impl" };
      if (command === "orca-ide" && args.includes("task-update")) return {};
      if (command === "orca-ide" && args.includes("terminal") && args.includes("create")) {
        return { terminal: { handle: "term-impl" } };
      }
      if (command === "orca-ide" && args.includes("terminal") && args.includes("wait")) return {};
      if (command === "orca-ide" && args.includes("--inject")) return { injected: true };
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    try {
      await riskflowDispatch(
        {
          workItemId: "C17",
          expectedRevision: "revision-1",
          idempotencyKey: "dispatch-c17-implementation-ledger",
        },
        {
          rootDir: process.cwd(),
          exec,
          statusProvider: async () => ({ graph, snapshot: planningSnapshot }),
        },
      );
      const record = JSON.parse(
        await readFile(
          join(runtimeRoot, "riskflow-orchestration", "attempts", "task-impl.json"),
          "utf8",
        ),
      );
      expect(record.envelope).toMatchObject({ taskKind: "implementation", runState: "running" });
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("states the closing-round protocol in the dispatch briefing", async () => {
    const dispatchSpec = async (overrides, key) => {
      const runtimeRoot = await mkdtemp(join(tmpdir(), `riskflow-round-${key}-`));
      const target = node(overrides);
      const snap = snapshot({
        nodes: [target],
        resumeQueue: [{ workItemId: "C17", category: "finalizing", nextAction: "继续收尾" }],
      });
      let spec;
      const exec = async (command, args) => {
        if (command === "git") return runtimeRoot;
        const terminal = fakeCodexTerminal(command, args);
        if (terminal !== null) return terminal;
        if (command === "orca-ide" && args.includes("task-create")) {
          spec = args[args.indexOf("--spec") + 1];
          return { id: `task-${key}` };
        }
        if (command === "orca-ide" && args.includes("task-update")) return {};
        if (command === "orca-ide" && args.includes("worker-start")) return { state: "ready" };
        throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
      };
      try {
        await riskflowDispatch(
          { workItemId: "C17", expectedRevision: "revision-1", idempotencyKey: `dispatch-${key}` },
          { rootDir: process.cwd(), exec, statusProvider: async () => ({ graph, snapshot: snap }) },
        );
        return spec;
      } finally {
        await rm(runtimeRoot, { recursive: true });
      }
    };
    const targetedFinalization = {
      taskKind: "finalization",
      phase: "finalizing",
      runState: "settled",
      outcome: "succeeded",
      auditPolicy: "targeted",
    };
    // 首个收尾尝试：当前尝试还是实现（auditRequired 为假、本轮尚无审计结论）
    const first = await dispatchSpec(
      {
        auditRequired: false,
        checkpoints: {
          ...node().checkpoints,
          taskKind: "implementation",
          phase: "implementing",
          runState: "settled",
          outcome: "succeeded",
        },
      },
      "first",
    );
    expect(first).toContain("=== 收尾轮次协议 ===");
    expect(first).toContain("为审计结论留出位置");
    expect(first).not.toContain("本轮限定审计已出结论");

    const audit = await dispatchSpec(
      { auditRequired: true, checkpoints: { ...node().checkpoints, ...targetedFinalization } },
      "audit",
    );
    expect(audit).toContain("唯一的限定审计");
    expect(audit).toContain("每个独立 Task 使用新的 Agent session");
    expect(audit).toContain("当前任务内直接修复并回归");
  });

  function ledgerAttemptPath(runtimeRoot, taskId) {
    return join(runtimeRoot, "riskflow-orchestration", "attempts", `${taskId}.json`);
  }

  async function readLedgerEnvelope(runtimeRoot, taskId) {
    const record = JSON.parse(await readFile(ledgerAttemptPath(runtimeRoot, taskId), "utf8"));
    return record.envelope;
  }

  it("records the running attempt envelope in the ledger after a supervised dispatch", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-attempt-ledger-"));
    const queued = node({
      checkpoints: {
        ...node().checkpoints,
        schemaVersion: 2,
        workItemId: "C17",
        routeNodeId: "C17",
        changeName: "deliver-process-model",
        worktreeId: "repo::/tmp/c17",
        inputHead: "feature-head",
        approvalRef: null,
        supersedesAttemptGroup: null,
      },
    });
    const queuedSnapshot = snapshot({
      nodes: [queued],
      resumeQueue: [
        { workItemId: "C17", category: "finalizing", nextAction: "派发强模型 Finalizer" },
      ],
    });
    const exec = async (command, args) => {
      if (command === "git") return runtimeRoot;
      const terminal = fakeCodexTerminal(command, args);
      if (terminal !== null) return terminal;
      if (command === "orca-ide" && args.includes("worker-start")) return { state: "started" };
      if (command === "orca-ide" && args.includes("task-update")) return {};
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    try {
      const result = await riskflowDispatch(
        {
          workItemId: "C17",
          expectedRevision: "revision-1",
          idempotencyKey: "dispatch-c17-attempt-ledger",
        },
        {
          rootDir: process.cwd(),
          exec,
          statusProvider: async () => ({ graph, snapshot: queuedSnapshot }),
        },
      );
      expect(result.worker).toMatchObject({ state: "started", attemptRecorded: true });
      expect(await readLedgerEnvelope(runtimeRoot, "task-finalizer")).toMatchObject({
        schemaVersion: 2,
        workItemId: "C17",
        taskKind: "finalization",
        phase: "finalizing",
        runState: "running",
        worktreeId: "repo::/tmp/c17",
        attemptGroup: "C17:finalizing",
        attempt: 1,
        auditPolicy: "self",
        owner: { taskId: "task-finalizer" },
      });
      const recorded = await readLedgerEnvelope(runtimeRoot, "task-finalizer");
      expect(recorded.outcome).toBeUndefined();
      expect(recorded.outputHead).toBeUndefined();
      expect(recorded.approvalRef).toBeUndefined();
      expect(recorded.supersedesAttemptGroup).toBeUndefined();
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("keeps the ledger attempt when the supervised worker never starts", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-attempt-ledger-failed-start-"));
    const exec = async (command, args) => {
      if (command === "git") return runtimeRoot;
      const terminal = fakeCodexTerminal(command, args);
      if (terminal !== null) return terminal;
      if (command === "orca-ide" && args.includes("task-update")) return {};
      if (command === "orca-ide" && args.includes("worker-start")) {
        throw new Error("consumer_fenced");
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    try {
      await expect(
        riskflowDispatch(
          {
            workItemId: "C17",
            expectedRevision: "revision-1",
            idempotencyKey: "dispatch-c17-attempt-ledger-failed-start",
          },
          {
            rootDir: process.cwd(),
            exec,
            statusProvider: async () => ({ graph, snapshot: snapshot() }),
          },
        ),
      ).rejects.toThrow("consumer_fenced");
      expect(await readLedgerEnvelope(runtimeRoot, "task-finalizer")).toMatchObject({
        runState: "queued",
        attemptGroup: "C17:finalizing",
        attempt: 1,
      });
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("keeps a started worker dispatched when the ledger record is rejected", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-attempt-ledger-rejected-"));
    const exec = async (command, args) => {
      if (command === "git") return runtimeRoot;
      const terminal = fakeCodexTerminal(command, args);
      if (terminal !== null) return terminal;
      if (command === "orca-ide" && args.includes("task-update")) return {};
      if (command === "orca-ide" && args.includes("worker-start")) {
        await rm(join(runtimeRoot, "riskflow-orchestration", "attempts"), { recursive: true });
        await writeFile(join(runtimeRoot, "riskflow-orchestration", "attempts"), "not a directory");
        return { state: "started" };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    try {
      const result = await riskflowDispatch(
        {
          workItemId: "C17",
          expectedRevision: "revision-1",
          idempotencyKey: "dispatch-c17-attempt-ledger-rejected",
        },
        {
          rootDir: process.cwd(),
          exec,
          statusProvider: async () => ({ graph, snapshot: snapshot() }),
        },
      );
      expect(result.worker).toMatchObject({ state: "started", attemptRecorded: false });
      expect(result.worker.attemptWarning).toContain("登记台账失败");
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  function mergedState(overrides = {}) {
    const merged = node({
      status: "merged",
      phase: "integration",
      checkpoints: {
        ...node().checkpoints,
        runState: "settled",
        outcome: "succeeded",
        main: {
          mergeCommit: "merge-head",
          mainHead: "merge-head",
          verification: "pending",
          archiveCommit: null,
        },
      },
    });
    return snapshot({
      nodes: [merged],
      resumeQueue: [
        { workItemId: "C17", category: "integrating", nextAction: "在 main 上完成 pnpm verify" },
      ],
      ...overrides,
    });
  }

  it("releases the runtime lock while a long external step runs", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-lock-handoff-"));
    const exec = async (command) => {
      if (command === "git") return runtimeRoot;
      throw new Error(`unexpected command: ${command}`);
    };
    let acquiredWhileReleased = false;
    try {
      await withRuntimeLock(process.cwd(), exec, async (_runtimeDir, lock) => {
        await lock.withoutLock(async () => {
          await withRuntimeLock(process.cwd(), exec, async () => {
            acquiredWhileReleased = true;
          });
        });
      });
      expect(acquiredWhileReleased).toBe(true);
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("runs main-line verification without inheriting the coordinator identity", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-long-step-"));
    let verificationEnv;
    let reads = 0;
    const exec = async (command, args, options = {}) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--git-common-dir") {
        return runtimeRoot;
      }
      if (command === "git" && String(args[0] ?? "").startsWith("--git-dir=")) return runtimeRoot;
      if (command === "git" && args[0] === "rev-parse") return "merge-head";
      if (command === "pnpm") {
        verificationEnv = options.env;
        return "";
      }
      if (command === "orca-ide" && args.includes("task-update")) return {};
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    process.env.ORCA_TERMINAL_HANDLE = "term-test-coordinator";
    try {
      const result = await riskflowIntegrate(
        {
          workItemId: "C17",
          expectedRevision: "revision-1",
          idempotencyKey: "integrate-long-step",
        },
        {
          rootDir: process.cwd(),
          exec,
          orcaCommand: "orca-ide",
          statusProvider: async () => {
            reads += 1;
            return { graph, snapshot: mergedState() };
          },
        },
      );
      expect(result).toMatchObject({ action: "main-verify", mainHead: "merge-head" });
      expect(reads).toBeGreaterThan(1);
      expect(verificationEnv.ORCA_TERMINAL_HANDLE).toBeUndefined();
      expect(verificationEnv.ORCA_CLI_COMMAND).toBeUndefined();
    } finally {
      delete process.env.ORCA_TERMINAL_HANDLE;
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("rejects a long external step whose fact base changed while unlocked", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-long-step-stale-"));
    let reads = 0;
    const exec = async (command, args) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--git-common-dir") {
        return runtimeRoot;
      }
      if (command === "git" && String(args[0] ?? "").startsWith("--git-dir=")) return runtimeRoot;
      if (command === "pnpm") return "";
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    try {
      await expect(
        riskflowIntegrate(
          {
            workItemId: "C17",
            expectedRevision: "revision-1",
            idempotencyKey: "integrate-long-step-stale",
          },
          {
            rootDir: process.cwd(),
            exec,
            orcaCommand: "orca-ide",
            statusProvider: async () => {
              reads += 1;
              // 工作项状态在长步骤期间发生变化：必须 fail-closed
              return {
                graph,
                snapshot:
                  reads === 1
                    ? mergedState()
                    : mergedState({ nodes: [node({ status: "finalized" })] }),
              };
            },
          },
        ),
      ).rejects.toMatchObject({ code: "stale_revision" });
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("closes exact terminal handles and rechecks reclaimable before cleanup", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-cleanup-stale-"));
    const stale = node({
      status: "stale",
      phase: "cleanup",
      main: { archive: true, verification: "passed" },
      worktree: { ...node().worktree, exists: true, dirty: false },
      checkpoints: {
        ...node().checkpoints,
        runState: "settled",
        outcome: "succeeded",
      },
      orca: { attempts: [], terminalHandles: ["term-old", "term-finalizer"] },
      nextActions: ["受控 cleanup"],
    });
    const reclaimable = {
      ...stale,
      status: "reclaimable",
      orca: { ...stale.orca, terminalHandles: [] },
    };
    const calls = [];
    let reads = 0;
    const exec = async (command, args) => {
      if (command === "git") return runtimeRoot;
      if (command === "orca-ide") {
        calls.push(args);
        if (args[0] === "terminal" && args[1] === "close") return { closed: true };
        if (args[0] === "worktree" && args[1] === "rm") return { removed: true };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    try {
      const result = await riskflowIntegrate(
        {
          workItemId: "C17",
          expectedRevision: "revision-1",
          idempotencyKey: "cleanup-stale-terminals",
        },
        {
          rootDir: process.cwd(),
          exec,
          statusProvider: async () => {
            reads += 1;
            const current = reads === 1 ? stale : reclaimable;
            return {
              graph,
              snapshot: snapshot({
                nodes: [current],
                resumeQueue: [
                  { workItemId: "C17", category: "cleanup", nextAction: "受控 cleanup" },
                ],
              }),
            };
          },
        },
      );
      expect(result).toMatchObject({ action: "reclaim" });
      expect(calls.filter((args) => args[0] === "terminal").map((args) => args[3])).toEqual([
        "term-old",
        "term-finalizer",
      ]);
      const removal = calls.find((args) => args[0] === "worktree");
      expect(removal).toContain("id:repo::/tmp/c17");
      expect(removal).not.toContain("--force");
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("does not close terminals when stale cleanup preconditions fail", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-cleanup-unsafe-"));
    const unsafe = node({
      status: "stale",
      phase: "cleanup",
      main: { archive: true, verification: "passed" },
      worktree: { ...node().worktree, exists: true, dirty: true },
      checkpoints: {
        ...node().checkpoints,
        runState: "settled",
        outcome: "succeeded",
      },
      orca: { attempts: [], terminalHandles: ["term-active"] },
      nextActions: ["人工审阅"],
    });
    let terminalCalls = 0;
    const exec = async (command, args) => {
      if (command === "git") return runtimeRoot;
      if (command === "orca-ide" && args[0] === "terminal") terminalCalls += 1;
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    try {
      await expect(
        riskflowIntegrate(
          {
            workItemId: "C17",
            expectedRevision: "revision-1",
            idempotencyKey: "cleanup-unsafe",
          },
          {
            rootDir: process.cwd(),
            exec,
            statusProvider: async () => ({
              graph,
              snapshot: snapshot({
                nodes: [unsafe],
                resumeQueue: [{ workItemId: "C17", category: "cleanup", nextAction: "人工审阅" }],
              }),
            }),
          },
        ),
      ).rejects.toMatchObject({ code: "cleanup_not_safe" });
      expect(terminalCalls).toBe(0);
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  function settleHarness(runtimeRoot) {
    let written;
    const exec = async (command, args) => {
      if (command === "git") return runtimeRoot;
      if (command === "orca-ide" && args.includes("task-update")) {
        written = JSON.parse(args[args.indexOf("--result") + 1]);
        return {};
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    return { exec, envelope: () => written };
  }

  it("settles an already-terminal Task through the attempt ledger", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-settle-terminal-task-"));
    const terminalTask = node({
      checkpoints: {
        ...node().checkpoints,
        taskKind: "planning",
        phase: "planning",
        taskStatus: "completed",
        runState: "running",
      },
    });
    const exec = async (command) => {
      if (command === "git") return runtimeRoot;
      throw new Error(`unexpected command: ${command}`);
    };
    try {
      await riskflowSettle(
        {
          workItemId: "C17",
          outcome: "succeeded",
          evidenceRefs: ["terminal-task-evidence"],
          expectedRevision: "revision-1",
          idempotencyKey: "settle-terminal-task",
        },
        {
          rootDir: process.cwd(),
          exec,
          statusProvider: async () => ({
            graph,
            snapshot: snapshot({
              nodes: [terminalTask],
              resumeQueue: [{ workItemId: "C17", category: "planning", nextAction: "收口" }],
            }),
          }),
        },
      );
      const record = JSON.parse(
        await readFile(
          join(runtimeRoot, "riskflow-orchestration", "attempts", "task-finalizer.json"),
          "utf8",
        ),
      );
      expect(record.envelope).toMatchObject({ runState: "settled", outcome: "succeeded" });
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("preserves the approved replan boundary when a planning attempt settles", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-settle-boundary-"));
    const planning = node({
      checkpoints: {
        ...node().checkpoints,
        taskId: "task-replan",
        taskKind: "planning",
        phase: "planning",
        runState: "running",
        attemptGroup: "C17:planning:approved",
        attempt: 1,
        approvalRef: "approval://riskflow/C17/replan-2026-09-20",
        supersedesAttemptGroup: "C17:finalizing",
      },
    });
    const { exec, envelope } = settleHarness(runtimeRoot);
    try {
      await riskflowSettle(
        {
          workItemId: "C17",
          outcome: "paused",
          issueRefs: ["replan-scope-not-communicated"],
          evidenceRefs: ["worker-report:msg-replan"],
          expectedRevision: "revision-1",
          idempotencyKey: "settle-replan-boundary",
        },
        {
          rootDir: process.cwd(),
          exec,
          statusProvider: async () => ({
            graph,
            snapshot: snapshot({
              nodes: [planning],
              resumeQueue: [
                { workItemId: "C17", category: "planning", nextAction: "等待规划收口" },
              ],
            }),
          }),
        },
      );
      expect(envelope()).toMatchObject({
        taskKind: "planning",
        runState: "settled",
        outcome: "paused",
        approvalRef: "approval://riskflow/C17/replan-2026-09-20",
        supersedesAttemptGroup: "C17:finalizing",
      });
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("does not add a replan boundary to a regular settle", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-settle-regular-"));
    const { exec, envelope } = settleHarness(runtimeRoot);
    try {
      await riskflowSettle(
        {
          workItemId: "C17",
          outcome: "paused",
          issueRefs: ["ordinary"],
          evidenceRefs: ["ordinary-report"],
          expectedRevision: "revision-1",
          idempotencyKey: "settle-regular-boundary",
        },
        {
          rootDir: process.cwd(),
          exec,
          statusProvider: async () => ({ graph, snapshot: snapshot() }),
        },
      );
      expect(envelope().approvalRef).toBeUndefined();
      expect(envelope().supersedesAttemptGroup).toBeUndefined();
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("commits only the reviewed paths when a successful settle has dirty files", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-settle-reviewed-"));
    const dirty = node({
      worktree: {
        ...node().worktree,
        dirty: true,
        dirtyPaths: ["packages/a.ts"],
      },
    });
    const dirtySnapshot = snapshot({
      nodes: [dirty],
      resumeQueue: [{ workItemId: "C17", category: "finalizing", nextAction: "收口" }],
    });
    const calls = [];
    let written;
    const exec = async (command, args) => {
      calls.push([command, ...args].join(" "));
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--git-common-dir") {
        return runtimeRoot;
      }
      if (command === "git" && String(args[0] ?? "").startsWith("--git-dir=")) return runtimeRoot;
      if (command === "git" && args[0] === "rev-parse") return "reviewed-head";
      if (command === "git" && args[0] === "add") return "";
      if (command === "git" && args[0] === "commit") return "";
      if (command === "openspec") return { artifacts: [] };
      if (command === "orca-ide" && args.includes("task-update")) {
        written = JSON.parse(args[args.indexOf("--result") + 1]);
        return {};
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    try {
      await riskflowSettle(
        {
          workItemId: "C17",
          outcome: "succeeded",
          reviewedPaths: ["packages/a.ts"],
          evidenceRefs: ["vitest:reviewed"],
          expectedRevision: "revision-1",
          idempotencyKey: "settle-reviewed-paths",
        },
        {
          rootDir: process.cwd(),
          exec,
          orcaCommand: "orca-ide",
          statusProvider: async () => ({ graph, snapshot: dirtySnapshot }),
        },
      );
      expect(calls).toContain("git add -- packages/a.ts");
      expect(calls.some((call) => call.startsWith("git commit"))).toBe(true);
      expect(written.outputHead).toBe("reviewed-head");
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("rejects stale revisions and incomplete goals", () => {
    expect(() =>
      preflightAction(snapshot(), "dispatch", {
        workItemId: "C17",
        expectedRevision: "old",
      }),
    ).toThrowError(ControlError);
    expect(canCompleteGoal(snapshot()).allowed).toBe(false);
    const complete = snapshot({
      nodes: [node({ status: "completed" })],
      resumeQueue: [],
    });
    expect(canCompleteGoal(complete)).toMatchObject({ allowed: true, unfinished: [] });
    expect(canCompleteGoal(complete, ["missing"])).toMatchObject({
      allowed: false,
      unknown: ["missing"],
    });
  });

  it("rejects mutations while an unrelated global violation remains", () => {
    expect(() =>
      preflightAction(
        snapshot({ violations: [{ nodeId: "C20", code: "duplicate_active_writer" }] }),
        "dispatch",
        { workItemId: "C17", expectedRevision: "revision-1" },
      ),
    ).toThrowError(ControlError);
  });

  it("reconciles one checkpoint while other recovery-only violations remain", () => {
    expect(
      preflightAction(
        snapshot({
          violations: [
            { nodeId: "C17", code: "checkpoint_mismatch" },
            { nodeId: "C20", code: "checkpoint_mismatch" },
            { nodeId: "AUX:old", code: "worktree_reclaim_pending" },
          ],
        }),
        "reconcile",
        { workItemId: "C17", expectedRevision: "revision-1" },
      ).node.id,
    ).toBe("C17");
  });

  it("does not let reconcile bypass an unsafe violation on its own node", () => {
    expect(() =>
      preflightAction(
        snapshot({ violations: [{ nodeId: "C17", code: "duplicate_active_writer" }] }),
        "reconcile",
        { workItemId: "C17", expectedRevision: "revision-1" },
      ),
    ).toThrowError(ControlError);
  });

  it("rejects replies after the current attempt is settled", () => {
    const settled = node({
      checkpoints: { ...node().checkpoints, runState: "settled", outcome: "succeeded" },
    });
    expect(() =>
      preflightAction(snapshot({ nodes: [settled] }), "reply", {
        workItemId: "C17",
        expectedRevision: "revision-1",
      }),
    ).toThrowError(ControlError);
  });

  it("creates a new coordinator run when reconciling a historical checkpoint", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-reconcile-run-"));
    const conflicted = node({ status: "unknown" });
    const state = snapshot({
      nodes: [conflicted],
      violations: [{ nodeId: "C17", code: "checkpoint_mismatch" }],
    });
    let taskCreateArgs;
    const exec = async (command, args) => {
      if (command === "git") return runtimeRoot;
      if (command === "orca-ide" && args.includes("run-create")) return { id: "run-reconcile" };
      if (command === "orca-ide" && args.includes("task-create")) {
        taskCreateArgs = args;
        return { id: "task-reconcile" };
      }
      if (command === "orca-ide" && args.includes("task-update")) return {};
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    try {
      const result = await riskflowReconcile(
        {
          workItemId: "C17",
          expectedRevision: "revision-1",
          idempotencyKey: "reconcile-new-run",
          taskKind: "finalization",
        },
        {
          rootDir: process.cwd(),
          exec,
          statusProvider: async () => ({ graph, snapshot: state }),
        },
      );
      expect(result.runId).toBe("run-reconcile");
      expect(taskCreateArgs).toContain("run-reconcile");
      expect(taskCreateArgs).not.toContain("run-finalizer");
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("allows only auxiliary adoption through the recovery dispatch path", () => {
    const auxiliary = node({
      id: "AUX:fix-suite-isolation",
      workItemId: "AUX:fix-suite-isolation",
      routeNodeId: null,
      auxiliary: true,
      change: "fix-suite-isolation",
      status: "untracked",
      phase: "adopt",
      checkpoints: null,
      nextActions: ["adopt"],
    });
    const state = snapshot({
      nodes: [auxiliary],
      resumeQueue: [
        {
          workItemId: auxiliary.id,
          category: "recovery",
          nextAction: "adopt",
        },
      ],
    });
    expect(
      preflightAction(state, "dispatch", {
        workItemId: auxiliary.id,
        expectedRevision: "revision-1",
      }).node,
    ).toBe(auxiliary);
  });

  it("requires evidence for success and refuses to settle an already settled task", async () => {
    await expect(
      riskflowSettle({
        workItemId: "C17",
        expectedRevision: "revision-1",
        idempotencyKey: "missing-evidence",
        outcome: "succeeded",
      }),
    ).rejects.toMatchObject({ code: "evidence_required" });
    expect(() =>
      preflightAction(
        snapshot({
          nodes: [
            node({
              checkpoints: { ...node().checkpoints, runState: "settled", outcome: "succeeded" },
            }),
          ],
        }),
        "settle",
        { workItemId: "C17", expectedRevision: "revision-1" },
      ),
    ).toThrowError(ControlError);
  });

  it("requires reviewed paths to match dirty files before a successful settle", () => {
    const dirty = node({
      worktree: {
        ...node().worktree,
        dirty: true,
        dirtyPaths: ["b.mjs", "a.mjs"],
      },
    });
    expect(() =>
      preflightAction(snapshot({ nodes: [dirty] }), "settle", {
        workItemId: "C17",
        expectedRevision: "revision-1",
        outcome: "succeeded",
        reviewedPaths: ["a.mjs"],
      }),
    ).toThrowError(expect.objectContaining({ code: "unreviewed_changes" }));
    expect(() =>
      preflightAction(snapshot({ nodes: [dirty] }), "settle", {
        workItemId: "C17",
        expectedRevision: "revision-1",
        outcome: "succeeded",
        reviewedPaths: ["a.mjs", "b.mjs"],
      }),
    ).not.toThrow();
  });

  it("requires only schema-declared verification artifacts before successful finalization", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-verification-"));
    const cases = [
      { name: "pending", artifacts: [{ id: "verification", status: "ready" }], blocked: true },
      { name: "complete", artifacts: [{ id: "verification", status: "done" }], blocked: false },
      { name: "legacy", artifacts: [{ id: "tasks", status: "done" }], blocked: false },
    ];
    try {
      for (const testCase of cases) {
        let writes = 0;
        const exec = async (command, args) => {
          if (command === "git") {
            if (["add", "commit"].includes(args[0])) writes += 1;
            return runtimeRoot;
          }
          if (command === "openspec") return { artifacts: testCase.artifacts };
          if (command === "orca-ide" && args.includes("task-update")) {
            writes += 1;
            return { result: {} };
          }
          throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
        };
        const settle = riskflowSettle(
          {
            workItemId: "C17",
            expectedRevision: "revision-1",
            idempotencyKey: `verification-${testCase.name}`,
            outcome: "succeeded",
            evidenceRefs: ["verification.md"],
          },
          {
            rootDir: process.cwd(),
            exec,
            statusProvider: async () => ({ graph, snapshot: snapshot() }),
          },
        );
        if (testCase.blocked) {
          await expect(settle).rejects.toMatchObject({
            code: "verification_artifact_required",
          });
          expect(writes).toBe(0);
        } else {
          await expect(settle).resolves.toMatchObject({ outcome: "succeeded" });
          expect(writes).toBe(1);
        }
      }
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("serializes mutations with one common-dir lock", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-control-"));
    const exec = async (command) => {
      if (command === "git") return runtimeRoot;
      throw new Error(`unexpected command: ${command}`);
    };
    let active = 0;
    let maximum = 0;
    try {
      await Promise.all(
        [1, 2].map(() =>
          withRuntimeLock(process.cwd(), exec, async () => {
            active += 1;
            maximum = Math.max(maximum, active);
            await delay(30);
            active -= 1;
          }),
        ),
      );
      expect(maximum).toBe(1);
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("does not retry a mutation merely because its work reports EEXIST", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-control-error-"));
    const exec = async (command) => {
      if (command === "git") return runtimeRoot;
      throw new Error(`unexpected command: ${command}`);
    };
    let calls = 0;
    try {
      await expect(
        withRuntimeLock(process.cwd(), exec, async () => {
          calls += 1;
          throw Object.assign(new Error("downstream exists"), { code: "EEXIST" });
        }),
      ).rejects.toThrow("downstream exists");
      expect(calls).toBe(1);
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("replays a completed idempotent settle once and pauses after three unchanged failures", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-receipt-"));
    const failedAttempt = {
      runState: "settled",
      outcome: "failed",
      head: "feature-head",
      issueRefs: ["same-defect"],
      evidenceRefs: ["same-report"],
    };
    const current = node({
      orca: { attempts: [failedAttempt, failedAttempt] },
    });
    const currentSnapshot = snapshot({ nodes: [current] });
    let updates = 0;
    const exec = async (command, args) => {
      if (command === "git") return runtimeRoot;
      if (command === "orca-ide" && args.includes("task-update")) {
        updates += 1;
        return { result: {} };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    const input = {
      workItemId: "C17",
      expectedRevision: "revision-1",
      idempotencyKey: "settle-c17-attempt-1",
      outcome: "failed",
      issueRefs: ["same-defect"],
      evidenceRefs: ["same-report"],
    };
    const options = {
      rootDir: process.cwd(),
      exec,
      statusProvider: async () => ({ graph, snapshot: currentSnapshot }),
    };
    try {
      const first = await riskflowSettle(input, options);
      const replay = await riskflowSettle(input, options);
      expect(first.outcome).toBe("paused");
      expect(replay).toEqual(first);
      expect(updates).toBe(1);
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("fails closed instead of replaying an inflight external side effect", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-inflight-"));
    const currentSnapshot = snapshot();
    let updates = 0;
    const exec = async (command, args) => {
      if (command === "git") return runtimeRoot;
      if (command === "orca-ide" && args.includes("task-update")) {
        updates += 1;
        throw new Error("external outcome unknown");
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    const input = {
      workItemId: "C17",
      expectedRevision: "revision-1",
      idempotencyKey: "settle-c17-uncertain",
      outcome: "failed",
      issueRefs: ["external-outcome-unknown"],
      evidenceRefs: ["worker-report"],
    };
    const options = {
      rootDir: process.cwd(),
      exec,
      statusProvider: async () => ({ graph, snapshot: currentSnapshot }),
    };
    try {
      await expect(riskflowSettle(input, options)).rejects.toThrow("external outcome unknown");
      await expect(riskflowSettle(input, options)).rejects.toMatchObject({
        code: "uncertain_prior_execution",
        nextActions: expect.arrayContaining([expect.stringContaining("riskflow_status")]),
      });
      expect(updates).toBe(1);
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });
});

// Orca 的 `worktree create` 会在外部副作用可能已经发生之后才以运行时故障结束（实测
// `runtime_unavailable: ... closed the connection before responding`）。这一组用例覆盖
// 控制器的回退：确认已有工作树、必要时自持建立、从实时列表取回唯一身份、以及复用排队
// 尝试时按尝试自身角色启动。
describe("worktree provisioning recovery", () => {
  const REPO_ID = "d4349f30-1c7e-4777-b16d-f259481b0121";
  const BASE_HEAD = "4e9f2b1c8d7a6053e4f1b2c3d4e5f60718293a4b";
  const RUNTIME_FAILURE =
    "runtime_unavailable: The Orca runtime closed the connection before responding";
  const SETUP_LINES = ["pnpm install --frozen-lockfile", "openspec init --tools codex,oh-my-pi"];

  function expectedPath(runtimeRoot) {
    return join(runtimeRoot, ".orca", "RiskFlow", "c17");
  }

  function identityRecord(runtimeRoot, overrides = {}) {
    return {
      id: `${REPO_ID}::${expectedPath(runtimeRoot)}`,
      path: expectedPath(runtimeRoot),
      repoId: REPO_ID,
      isMainWorktree: false,
      head: BASE_HEAD,
      branch: "refs/heads/c17",
      ...overrides,
    };
  }

  function fakeExec(runtimeRoot, options = {}) {
    const calls = [];
    const state = {
      worktrees: options.worktrees ?? [],
      createError: options.createError === undefined ? RUNTIME_FAILURE : options.createError,
      existingHead: options.existingHead ?? null,
      setupFailure: options.setupFailure ?? null,
      delayedSideEffectOnAdd: options.delayedSideEffectOnAdd ?? false,
      setups: [],
    };
    const exec = async (command, args = [], execOptions = {}) => {
      calls.push({ command, args, cwd: execOptions.cwd });
      if (command === "git") {
        if (args.includes("--git-common-dir") || args[0]?.startsWith("--git-dir=")) {
          return runtimeRoot;
        }
        if (args[0] === "rev-parse") return BASE_HEAD;
        if (args[0] === "-C") {
          if (state.existingHead) return state.existingHead;
          throw new Error(`fatal: not a git repository: ${args[1]}`);
        }
        if (args[0] === "worktree" && args[1] === "add") {
          // 真实 `git worktree add` 会自己建立目录；这里同样让目录出现，
          // 以便覆盖取回身份后的存在性校验。
          await mkdir(expectedPath(runtimeRoot), { recursive: true });
          state.worktrees = [identityRecord(runtimeRoot)];
          if (state.delayedSideEffectOnAdd) {
            state.existingHead = BASE_HEAD;
            throw new Error("fatal: worktree path already exists");
          }
          return "";
        }
      }
      if (command === "sh") {
        state.setups.push(args[1]);
        await options.onSetup?.(args[1], state);
        if (state.setupFailure && args[1] === state.setupFailure) {
          throw new Error("command failed: openspec init --tools codex,oh-my-pi: exit 1");
        }
        return "";
      }
      if (command === "orca-ide") {
        if (args[0] === "repo" && args[1] === "list") {
          return {
            repos: [
              {
                id: REPO_ID,
                path: runtimeRoot,
                displayName: "RiskFlow",
                worktreeBasePath: ".orca",
                worktreeBaseRef: "main",
                hookSettings: { scripts: { setup: SETUP_LINES.join("\n") } },
              },
            ],
          };
        }
        if (args[0] === "worktree" && args[1] === "create") {
          if (state.createError) throw new Error(state.createError);
          return { worktree: identityRecord(runtimeRoot) };
        }
        if (args[0] === "worktree" && args[1] === "list") return { worktrees: state.worktrees };
        if (args.includes("task-create")) return { id: "task-provisioned" };
        if (args.includes("task-update")) {
          state.envelope = JSON.parse(args[args.indexOf("--result") + 1]);
          return {};
        }
        if (args.includes("worker-start")) {
          state.workerStart = args;
          return { state: "started" };
        }
        if (args.includes("terminal")) return { terminal: { handle: "term-provisioned" } };
        if (args.includes("--inject")) return { injected: true };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    return { exec, calls, state };
  }

  function readySnapshot() {
    const ready = node({
      status: "ready",
      phase: "planning",
      worktree: undefined,
      checkpoints: {
        ...node().checkpoints,
        taskKind: "planning",
        phase: "planning",
        runState: "settled",
        outcome: "failed",
      },
    });
    return snapshot({
      nodes: [ready],
      resumeQueue: [
        {
          workItemId: "C17",
          category: "ready",
          nextAction: "创建当前 change 的 feature worktree 和结构化 task",
        },
      ],
    });
  }

  function dispatchReady(
    exec,
    key,
    statusProvider = async () => ({ graph, snapshot: readySnapshot() }),
  ) {
    return riskflowDispatch(
      { workItemId: "C17", expectedRevision: "revision-1", idempotencyKey: `dispatch-${key}` },
      {
        rootDir: process.cwd(),
        exec,
        statusProvider,
      },
    );
  }

  async function readLedgerEnvelope(runtimeRoot, taskId) {
    const record = JSON.parse(
      await readFile(
        join(runtimeRoot, "riskflow-orchestration", "attempts", `${taskId}.json`),
        "utf8",
      ),
    );
    return record.envelope;
  }

  it("keeps the Orca-first path untouched when the create call succeeds", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-provision-orca-"));
    const { exec, calls, state } = fakeExec(runtimeRoot, { createError: null });
    const record = identityRecord(runtimeRoot);
    try {
      const result = await dispatchReady(exec, "provision-orca");
      expect(state.envelope).toMatchObject({ taskKind: "planning", worktreeId: record.id });
      expect(state.workerStart).toContain(`id:${record.id}`);
      expect(result.worktreeSetupWarnings).toBeUndefined();
      expect(calls.some(({ command }) => command === "sh")).toBe(false);
      expect(calls.some(({ command, args }) => command === "git" && args[0] === "worktree")).toBe(
        false,
      );
      expect(calls.some(({ args }) => args[0] === "repo")).toBe(false);
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("takes back the managed identity when the worktree already exists at the expected path", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-provision-existing-"));
    const record = identityRecord(runtimeRoot);
    // 副作用已经发生：期望路径上确实存在该工作树的目录。
    await mkdir(expectedPath(runtimeRoot), { recursive: true });
    const { exec, calls, state } = fakeExec(runtimeRoot, {
      worktrees: [record],
      existingHead: BASE_HEAD,
    });
    try {
      const result = await dispatchReady(exec, "provision-existing");
      expect(result.worker).toMatchObject({ state: "started", attemptRecorded: true });
      expect(state.envelope).toMatchObject({
        taskKind: "planning",
        worktreeId: record.id,
        inputHead: BASE_HEAD,
      });
      expect(state.workerStart).toContain(`id:${record.id}`);
      expect(calls.some(({ command, args }) => command === "git" && args[1] === "add")).toBe(false);
      expect(calls.some(({ command }) => command === "sh")).toBe(false);
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("builds the worktree and runs the repo setup script when no side effect happened", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-provision-add-"));
    const { exec, calls, state } = fakeExec(runtimeRoot);
    try {
      const result = await dispatchReady(exec, "provision-add");
      const add = calls.find(
        ({ command, args }) => command === "git" && args[0] === "worktree" && args[1] === "add",
      );
      expect(add.args).toEqual(["worktree", "add", expectedPath(runtimeRoot), "-b", "c17", "main"]);
      expect(add.cwd).toBe(runtimeRoot);
      expect(state.setups).toEqual(SETUP_LINES);
      expect(result.worktreeSetupWarnings).toBeUndefined();
      expect(result.worker).toMatchObject({ state: "started" });
      expect(state.envelope).toMatchObject({
        taskKind: "planning",
        worktreeId: identityRecord(runtimeRoot).id,
      });
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("takes back a delayed Orca side effect that lands while git worktree add is running", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-provision-delayed-"));
    const { exec, state } = fakeExec(runtimeRoot, { delayedSideEffectOnAdd: true });
    try {
      const result = await dispatchReady(exec, "provision-delayed");
      expect(result.worker).toMatchObject({ state: "started" });
      expect(state.envelope).toMatchObject({ worktreeId: identityRecord(runtimeRoot).id });
      expect(state.setups).toEqual([]);
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("releases the runtime lock during fallback and rejects concurrent fact drift", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-provision-unlocked-"));
    const setupStarted = Promise.withResolvers();
    const continueSetup = Promise.withResolvers();
    const { exec, calls } = fakeExec(runtimeRoot, {
      onSetup: async (command) => {
        if (command !== SETUP_LINES[0]) return;
        setupStarted.resolve();
        await continueSetup.promise;
      },
    });
    let reads = 0;
    const dispatch = dispatchReady(exec, "provision-unlocked", async () => {
      reads += 1;
      return {
        graph,
        snapshot:
          reads === 1
            ? readySnapshot()
            : snapshot({ nodes: [node({ status: "running", phase: "planning" })] }),
      };
    }).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    try {
      await setupStarted.promise;
      const concurrent = withRuntimeLock(process.cwd(), exec, async () => undefined);
      const acquiredWhileSetupWaited = await Promise.race([
        concurrent.then(() => true),
        delay(100).then(() => false),
      ]);
      continueSetup.resolve();
      const [outcome] = await Promise.all([dispatch, concurrent]);
      expect(acquiredWhileSetupWaited).toBe(true);
      expect(outcome.error).toMatchObject({ code: "stale_revision" });
      expect(calls.some(({ args }) => args.includes("task-create"))).toBe(false);
      expect(calls.some(({ args }) => args.includes("worker-start"))).toBe(false);
    } finally {
      continueSetup.resolve();
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("fails closed when a repo setup command fails", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-provision-setup-"));
    const { exec, calls, state } = fakeExec(runtimeRoot, { setupFailure: SETUP_LINES[1] });
    try {
      const error = await dispatchReady(exec, "provision-setup").catch((thrown) => thrown);
      expect(error).toMatchObject({
        code: "worktree_setup_failed",
        message: expect.stringContaining(SETUP_LINES[1]),
      });
      expect(error.message).toContain("closed the connection before responding");
      expect(state.setups).toEqual(SETUP_LINES);
      expect(calls.some(({ args }) => args.includes("task-create"))).toBe(false);
      expect(calls.some(({ args }) => args.includes("worker-start"))).toBe(false);
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("fails closed when the managed identity cannot be confirmed", async () => {
    const cases = [
      { key: "missing", worktrees: [] },
      {
        key: "ambiguous",
        worktrees: [
          identityRecord("/tmp/unused"),
          identityRecord("/tmp/unused", { id: `${REPO_ID}::duplicate` }),
        ],
      },
      { key: "incomplete", worktrees: [identityRecord("/tmp/unused", { head: null })] },
      { key: "stale-head", worktrees: [identityRecord("/tmp/unused", { head: "deadbeef" })] },
      {
        key: "main-worktree",
        worktrees: [identityRecord("/tmp/unused", { isMainWorktree: true })],
      },
    ];
    for (const testCase of cases) {
      const runtimeRoot = await mkdtemp(join(tmpdir(), `riskflow-provision-${testCase.key}-`));
      const records = testCase.worktrees.map((record) => ({
        ...record,
        id: record.id.replace("/tmp/unused", expectedPath(runtimeRoot)),
        path: expectedPath(runtimeRoot),
      }));
      const { exec, calls } = fakeExec(runtimeRoot, {
        worktrees: records,
        existingHead: BASE_HEAD,
      });
      try {
        await expect(dispatchReady(exec, `provision-${testCase.key}`)).rejects.toMatchObject({
          code: "worktree_identity_unresolved",
          nextActions: expect.arrayContaining([
            expect.stringContaining("externalWorktreeVisibility"),
          ]),
        });
        const error = await dispatchReady(exec, `provision-${testCase.key}-again`).catch(
          (thrown) => thrown,
        );
        expect(error.message).toContain("closed the connection before responding");
        expect(calls.some(({ args }) => args.includes("task-create"))).toBe(false);
      } finally {
        await rm(runtimeRoot, { recursive: true });
      }
    }
  });

  it("bubbles business failures from Orca instead of provisioning behind them", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-provision-business-"));
    const { exec, calls } = fakeExec(runtimeRoot, {
      createError: "invalid_argument: worktree name already exists",
    });
    try {
      await expect(dispatchReady(exec, "provision-business")).rejects.toThrow(
        "invalid_argument: worktree name already exists",
      );
      expect(calls.some(({ command, args }) => command === "git" && args[0] === "worktree")).toBe(
        false,
      );
      expect(calls.some(({ args }) => args.includes("task-create"))).toBe(false);
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("starts a queued planning attempt in its own role", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-queued-planning-"));
    const queued = node({
      status: "running",
      phase: "planning",
      checkpoints: {
        ...node().checkpoints,
        taskKind: "planning",
        phase: "planning",
        runState: "queued",
        attemptGroup: "C17:planning",
        owner: { taskId: "task-finalizer", agentClass: "strong-planner", model: "gpt-5.6-sol" },
      },
    });
    const queuedSnapshot = snapshot({
      nodes: [queued],
      resumeQueue: [
        { workItemId: "C17", category: "planning", nextAction: "启动排队中的规划尝试" },
      ],
    });
    let workerStart;
    const exec = async (command, args) => {
      if (command === "git") return runtimeRoot;
      const terminal = fakeCodexTerminal(command, args);
      if (terminal !== null) return terminal;
      if (command === "orca-ide" && args.includes("worker-start")) {
        workerStart = args;
        return { state: "started" };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    try {
      const result = await riskflowDispatch(
        {
          workItemId: "C17",
          expectedRevision: "revision-1",
          idempotencyKey: "dispatch-queued-planning",
        },
        {
          rootDir: process.cwd(),
          exec,
          statusProvider: async () => ({ graph, snapshot: queuedSnapshot }),
        },
      );
      expect(result.taskId).toBe("task-finalizer");
      expect(workerStart).toContain("task-finalizer");
      expect(await readLedgerEnvelope(runtimeRoot, "task-finalizer")).toMatchObject({
        taskKind: "planning",
        phase: "planning",
        runState: "running",
        attemptGroup: "C17:planning",
        owner: { agentClass: "strong-planner" },
      });
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });

  it("rejects a queued attempt whose role is unknown", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-queued-unknown-"));
    const queued = node({
      status: "running",
      phase: "planning",
      checkpoints: {
        ...node().checkpoints,
        taskKind: "verification",
        phase: "planning",
        runState: "queued",
      },
    });
    const queuedSnapshot = snapshot({
      nodes: [queued],
      resumeQueue: [
        { workItemId: "C17", category: "planning", nextAction: "启动排队中的规划尝试" },
      ],
    });
    let workerStarted = false;
    const exec = async (command, args) => {
      if (command === "git") return runtimeRoot;
      if (command === "orca-ide" && args.includes("worker-start")) {
        workerStarted = true;
        return { state: "started" };
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    try {
      await expect(
        riskflowDispatch(
          {
            workItemId: "C17",
            expectedRevision: "revision-1",
            idempotencyKey: "dispatch-queued-unknown",
          },
          {
            rootDir: process.cwd(),
            exec,
            statusProvider: async () => ({ graph, snapshot: queuedSnapshot }),
          },
        ),
      ).rejects.toMatchObject({ code: "unknown_task_kind" });
      expect(workerStarted).toBe(false);
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
  });
});
