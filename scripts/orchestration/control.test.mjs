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
    expect(
      createV2Envelope({
        node: current,
        taskId: "next-task",
        taskKind: "finalization",
        role: graph.policy.roles.finalization,
      }).owner.agentClass,
    ).toBe("strong-finalizer");
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

  it("replays an idempotent settle once and pauses after three unchanged failures", async () => {
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
});
