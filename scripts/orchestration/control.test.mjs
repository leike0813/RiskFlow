import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  ControlError,
  canCompleteGoal,
  createV2Envelope,
  preflightAction,
  riskflowDispatch,
  riskflowSettle,
  withRuntimeLock,
} from "./control.mjs";
import { formatCurrentState, shouldBlockDirectCommand } from "./omp-extension.mjs";

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

  it("formats a short resumable state view", () => {
    const text = formatCurrentState({
      revision: "rev-1",
      resumeQueue: [{ workItemId: "C26", category: "finalizing", nextAction: "继续 Finalizer" }],
    });
    expect(text).toContain("revision: rev-1");
    expect(text).toContain("C26: 继续 Finalizer");
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
      checkpoints: { ...node().checkpoints, runState: "settled", outcome: "paused" },
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
        git: { head: "feature-head", dirty: true, dirtyPaths: ["b.mjs", "a.mjs"] },
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
