import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";
import {
  ControlError,
  canCompleteGoal,
  createV2Envelope,
  preflightAction,
  riskflowDispatch,
  riskflowIntegrate,
  riskflowReconcile,
  riskflowSettle,
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

describe("controlled orchestration", () => {
  it("blocks direct orchestration mutations but permits read-only checks", () => {
    expect(shouldBlockDirectCommand("orca-ide orchestration dispatch --run r --task t")).toBe(true);
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
    });
    expect(text).toContain("revision: rev-1");
    expect(text).toContain("C26: 继续 Finalizer");
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

  it("selects the finalization role when the round no longer requires an audit", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "riskflow-round-role-"));
    const roundNode = node({
      auditRequired: false,
      checkpoints: {
        ...node().checkpoints,
        taskKind: "finalization",
        phase: "finalizing",
        runState: "settled",
        outcome: "succeeded",
        auditPolicy: "targeted",
      },
    });
    const roundSnapshot = snapshot({
      nodes: [roundNode],
      resumeQueue: [{ workItemId: "C17", category: "finalizing", nextAction: "继续收尾" }],
    });
    let writtenEnvelope;
    const exec = async (command, args) => {
      if (command === "git") return runtimeRoot;
      if (command === "orca-ide" && args.includes("task-create")) return { id: "task-next" };
      if (command === "orca-ide" && args.includes("task-update")) {
        writtenEnvelope = JSON.parse(args[args.indexOf("--result") + 1]);
        return {};
      }
      if (command === "orca-ide" && args.includes("worker-start")) return { state: "ready" };
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    };
    try {
      await riskflowDispatch(
        {
          workItemId: "C17",
          expectedRevision: "revision-1",
          idempotencyKey: "dispatch-round-role",
        },
        {
          rootDir: process.cwd(),
          exec,
          statusProvider: async () => ({ graph, snapshot: roundSnapshot }),
        },
      );
      expect(writtenEnvelope).toMatchObject({ taskKind: "finalization" });
    } finally {
      await rm(runtimeRoot, { recursive: true });
    }
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
              return {
                graph,
                snapshot: reads === 1 ? mergedState() : mergedState({ revision: "revision-2" }),
              };
            },
          },
        ),
      ).rejects.toMatchObject({ code: "stale_revision" });
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
