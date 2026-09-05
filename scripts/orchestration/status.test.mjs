import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CommandFailure,
  InvalidJsonError,
  collectStatus,
  defaultExec,
  deriveNodeState,
  deriveSnapshot,
  parseTaskEnvelope,
  readJsonCommand,
  validateGraph,
} from "./status.mjs";

const worktreeId = "repo-id::/tmp/riskflow-feature";

function envelope(overrides = {}) {
  return parseTaskEnvelope({
    result: {
      schemaVersion: 1,
      changeId: "C08",
      taskKind: "verification",
      worktreeId,
      baseHead: "base-head",
      head: "feature-head",
      phase: "verification",
      outcome: "succeeded",
      main: {
        mergeCommit: null,
        mainHead: null,
        verification: "pending",
        archiveCommit: null,
      },
      evidenceRefs: [],
      ...overrides,
    },
  });
}

function task(overrides = {}) {
  return {
    id: "task-c08-verification",
    status: "completed",
    createdAt: "2026-09-04 12:00:00",
    envelope: envelope(),
    ...overrides,
  };
}

function graph(...nodes) {
  return { routeId: "test-route", nodes };
}

function context(overrides = {}) {
  return {
    main: {
      head: "main-head",
      branch: "main",
      dirty: false,
      archiveNames: [],
    },
    worktrees: [],
    tasks: [],
    ancestry: {},
    ...overrides,
  };
}

describe("execution graph", () => {
  it("validates the committed C00-C38 graph", async () => {
    const manifest = JSON.parse(
      await readFile(
        resolve(
          dirname(fileURLToPath(import.meta.url)),
          "../../config/orchestration/execution-graph.json",
        ),
        "utf8",
      ),
    );
    expect(manifest.nodes).toHaveLength(45);
    expect(validateGraph(manifest)).toEqual([]);
  });

  it("rejects malformed task envelopes", () => {
    expect(parseTaskEnvelope({ result: {} })).toMatchObject({
      valid: false,
      reason: "missing_fields",
    });
    expect(
      parseTaskEnvelope({
        result: { changeId: "C08", taskKind: "verification", worktreeId, baseHead: "base" },
      }),
    ).toMatchObject({
      valid: false,
      reason: "missing_fields",
      missing: ["head"],
    });
    const valid = {
      schemaVersion: 1,
      changeId: "C08",
      taskKind: "verification",
      worktreeId,
      baseHead: "base",
      head: "head",
    };
    for (const field of ["changeId", "taskKind", "worktreeId", "baseHead", "head"]) {
      const candidate = { ...valid };
      delete candidate[field];
      expect(parseTaskEnvelope({ result: candidate })).toMatchObject({
        valid: false,
        reason: "missing_fields",
      });
    }
    expect(
      parseTaskEnvelope({ result: { ...valid, worktreeId: "repo-id::relative/path" } }),
    ).toMatchObject({
      valid: false,
      reason: "worktree_id_not_full",
    });
    expect(envelope()).toMatchObject({ valid: true, changeId: "C08", taskKind: "verification" });
    expect(
      parseTaskEnvelope({
        result: {
          schemaVersion: 1,
          changeId: "C08",
          taskKind: "verification",
          worktreeId,
          baseHead: "base",
          head: "head",
          phase: "archive",
        },
      }),
    ).toMatchObject({
      valid: false,
      reason: "phase_task_kind_mismatch",
    });
    expect(envelope()).toMatchObject({ schemaVersion: 1, evidenceRefs: [] });
    expect(envelope({ schemaVersion: "1" })).toMatchObject({ valid: true, schemaVersion: 1 });
    expect(envelope({ schemaVersion: 2 })).toMatchObject({
      valid: false,
      reason: "invalid_schema_version",
    });
    expect(envelope({ evidenceRefs: "report.md" })).toMatchObject({
      valid: false,
      reason: "invalid_evidence_refs",
    });
    expect(envelope({ main: { verification: "pnpm verify passed" } })).toMatchObject({
      valid: false,
      reason: "invalid_main_verification",
    });
  });
});

describe("worktree-aware state", () => {
  it("keeps a feature-local change active when main has no change", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const currentTask = task({ status: "dispatched", envelope: envelope({ outcome: "pending" }) });
    const snapshot = deriveSnapshot(
      graph(node),
      context({
        worktrees: [
          {
            id: worktreeId,
            path: "/tmp/riskflow-feature",
            exists: true,
            localNodeIds: ["C08"],
            liveTerminalCount: 1,
            git: { head: "feature-head", branch: "feature", dirty: false, dirtyPaths: [] },
            tasks: [currentTask],
          },
        ],
        tasks: [currentTask],
        ancestry: { C08: false },
      }),
    );
    expect(snapshot.nodes[0]).toMatchObject({
      id: "C08",
      status: "running",
      main: { merged: false },
    });
  });

  it("does not unlock a dependent change until its dependency is archived on main", () => {
    const node = { id: "C04", kind: "change", change: "deliver-artifacts", dependsOn: ["C03"] };
    const blocked = deriveNodeState(
      node,
      context({ dependencyState: new Map([["C03", "merged"]]) }),
    );
    const ready = deriveNodeState(
      node,
      context({ dependencyState: new Map([["C03", "archived"]]) }),
    );
    expect(blocked.status).toBe("pending");
    expect(ready.status).toBe("ready");
  });

  it("requires main verification before archive and reclaim", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const currentTask = task({
      envelope: envelope({
        main: {
          mergeCommit: "merge-head",
          mainHead: "main-head",
          verification: "passed",
          archiveCommit: "archive-head",
        },
      }),
    });
    const facts = context({
      main: {
        head: "main-head",
        branch: "main",
        dirty: false,
        archiveNames: ["2026-09-04-deliver-agent"],
      },
      worktrees: [
        {
          id: worktreeId,
          path: "/tmp/riskflow-feature",
          exists: true,
          localNodeIds: ["C08"],
          liveTerminalCount: 0,
          git: { head: "feature-head", branch: "feature", dirty: false, dirtyPaths: [] },
          tasks: [currentTask],
        },
      ],
      tasks: [currentTask],
      ancestry: { C08: true },
    });
    expect(deriveSnapshot(graph(node), facts).nodes[0].status).toBe("reclaimable");

    const dirtyFacts = {
      ...facts,
      worktrees: [
        {
          ...facts.worktrees[0],
          git: { ...facts.worktrees[0].git, dirty: true, dirtyPaths: ["unknown.txt"] },
        },
      ],
    };
    expect(deriveSnapshot(graph(node), dirtyFacts).nodes[0]).toMatchObject({
      status: "stale",
      main: { archive: true },
    });
    expect(deriveSnapshot(graph(node), dirtyFacts).staleWorktrees).toEqual([worktreeId]);
  });

  it("treats a committed main archive as durable completion", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const snapshot = deriveSnapshot(
      graph(node),
      context({
        main: {
          head: "main-head",
          branch: "main",
          dirty: false,
          archiveNames: ["2026-09-04-deliver-agent"],
        },
      }),
    );
    expect(snapshot.nodes[0]).toMatchObject({
      status: "completed",
      main: { archive: true, verification: "passed" },
    });
    expect(snapshot.violations).toEqual([]);
  });

  it("accepts an older main checkpoint that is an ancestor of current main", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const currentTask = task({
      envelope: envelope({
        main: {
          mergeCommit: "merge-head",
          mainHead: "older-main-head",
          verification: "passed",
          archiveCommit: null,
        },
      }),
    });
    const snapshot = deriveSnapshot(
      graph(node),
      context({
        tasks: [currentTask],
        ancestry: { C08: true },
        mainCheckpointAncestry: { "older-main-head": true },
      }),
    );
    expect(snapshot.nodes[0].status).toBe("main_verified");
    expect(snapshot.violations.map((item) => item.code)).not.toContain("main_checkpoint_mismatch");
  });

  it("uses the latest phase instead of conflicting with an earlier pending summary", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const planning = task({
      id: "planning",
      createdAt: "2026-09-04 10:00:00",
      envelope: envelope({
        taskKind: "planning",
        phase: "planning",
        outcome: "pending",
        main: { mainHead: "main-head", verification: "pending" },
      }),
    });
    const verification = task({
      id: "verification",
      createdAt: "2026-09-04 12:00:00",
      envelope: envelope({
        main: { mainHead: "main-head", verification: "passed" },
      }),
    });
    const snapshot = deriveSnapshot(
      graph(node),
      context({ tasks: [planning, verification], ancestry: { C08: true } }),
    );
    expect(snapshot.nodes[0].status).toBe("main_verified");
    expect(snapshot.violations.map((item) => item.code)).not.toContain("main_summary_conflict");
  });

  it("fails closed when the current phase has no unique creation order", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const passed = task({
      id: "passed",
      createdAt: null,
      envelope: envelope({ main: { mainHead: "main-head", verification: "passed" } }),
    });
    const failed = task({
      id: "failed",
      status: "failed",
      createdAt: "2026-09-04 12:00:00",
      envelope: envelope({
        outcome: "failed",
        main: { mainHead: "main-head", verification: "failed" },
      }),
    });
    const snapshot = deriveSnapshot(
      graph(node),
      context({ tasks: [passed, failed], ancestry: { C08: true } }),
    );
    expect(snapshot.nodes[0].status).toBe("unknown");
    expect(snapshot.violations.map((item) => item.code)).toContain("main_summary_conflict");
  });

  it("derives dependencies in topological order regardless of manifest order", () => {
    const dependency = { id: "C01", kind: "change", change: "first", dependsOn: [] };
    const dependent = { id: "C02", kind: "change", change: "second", dependsOn: ["C01"] };
    const snapshot = deriveSnapshot(
      graph(dependent, dependency),
      context({
        main: {
          head: "main-head",
          branch: "main",
          dirty: false,
          archiveNames: ["2026-09-01-first"],
        },
      }),
    );
    expect(snapshot.nodes.find((node) => node.id === "C01")?.status).toBe("completed");
    expect(snapshot.frontier).toEqual(["C02"]);
  });

  it("keeps historical orphan tasks as non-blocking diagnostics", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const snapshot = deriveSnapshot(
      graph(node),
      context({
        diagnostics: [{ code: "historical_unlinked_task", taskId: "old-task" }],
      }),
    );
    expect(snapshot.frontier).toEqual(["C08"]);
    expect(snapshot.unlinkedTasks).toEqual([]);
    expect(snapshot.violations).toEqual([]);
    expect(snapshot.diagnostics).toEqual([
      { code: "historical_unlinked_task", taskId: "old-task" },
    ]);
  });

  it("keeps derived state independent from generation time", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const first = deriveSnapshot(graph(node), context({ generatedAt: "2026-01-01T00:00:00Z" }));
    const second = deriveSnapshot(graph(node), context({ generatedAt: "2026-02-01T00:00:00Z" }));
    const withoutTime = (snapshot) => {
      const copy = { ...snapshot };
      delete copy.generatedAt;
      return copy;
    };
    expect(withoutTime(first)).toEqual(withoutTime(second));
  });

  it("fails closed for duplicate, missing, and mismatched worktree facts", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const currentTask = task();
    const baseWorktree = {
      id: worktreeId,
      path: "/tmp/riskflow-feature",
      exists: true,
      localNodeIds: ["C08"],
      liveTerminalCount: 0,
      git: { head: "other-head", branch: "feature", dirty: false, dirtyPaths: [] },
      tasks: [currentTask],
    };
    const duplicate = deriveSnapshot(
      graph(node),
      context({
        worktrees: [baseWorktree, { ...baseWorktree, id: "repo-id::/tmp/riskflow-feature-2" }],
        tasks: [currentTask],
      }),
    ).nodes[0];
    expect(duplicate.status).toBe("unknown");
    expect(duplicate.violations.map((item) => item.code)).toContain("duplicate_active_worktree");

    const missing = deriveSnapshot(
      graph(node),
      context({
        worktrees: [{ ...baseWorktree, exists: false }],
        tasks: [currentTask],
      }),
    ).nodes[0];
    expect(missing.status).toBe("unknown");
    expect(missing.violations.map((item) => item.code)).toContain("worktree_missing");

    const mismatch = deriveSnapshot(
      graph(node),
      context({
        worktrees: [baseWorktree],
        tasks: [currentTask],
      }),
    ).nodes[0];
    expect(mismatch.violations.map((item) => item.code)).toContain("checkpoint_mismatch");

    const missingOpenSpec = deriveSnapshot(
      graph(node),
      context({
        worktrees: [{ ...baseWorktree, openSpecNodeIds: [] }],
        tasks: [currentTask],
      }),
    ).nodes[0];
    expect(missingOpenSpec.violations.map((item) => item.code)).toContain(
      "task_missing_local_openspec",
    );
  });
});

describe("command boundaries", () => {
  it("collects every run page and ignores historical orphan tasks", async () => {
    const repoId = "riskflow-repo";
    const calls = [];
    let workerRecords = [
      {
        taskId: "task-run-1",
        workerState: "unsupervised",
        dispatchStatus: "completed",
      },
    ];
    let taskRecord = (runId) => ({
      id: `task-${runId}`,
      run_id: runId,
      status: runId === "run-1" ? "ready" : "completed",
      created_by_process_incarnation: `${repoId}::${process.cwd()}::old`,
      result: null,
    });
    const exec = async (command, args, options) => {
      calls.push([command, ...args]);
      if (command === "git") return defaultExec(command, args, options);
      if (command !== "orca-test") throw new Error(`unexpected command: ${command}`);
      if (args[0] === "worktree") {
        return {
          result: {
            worktrees: [
              {
                repoId,
                worktreeId: `${repoId}::${process.cwd()}`,
                path: process.cwd(),
                isMainWorktree: true,
              },
            ],
          },
        };
      }
      if (args[1] === "run-list" && !args.includes("--cursor")) {
        return {
          result: {
            runs: [{ id: "run-1", created_at: "2026-09-05 10:00:00" }],
            nextCursor: "page-2",
          },
        };
      }
      if (args[1] === "run-list") {
        return {
          result: {
            runs: [
              { id: "run-1", created_at: "2026-09-05 10:00:00" },
              { id: "run-2", created_at: "2026-09-04 10:00:00" },
            ],
          },
        };
      }
      if (args[1] === "worker-list") return { result: { workers: workerRecords } };
      if (args[1] === "task-list") {
        const runId = args[args.indexOf("--run") + 1];
        return { result: { tasks: [taskRecord(runId)] } };
      }
      if (args[0] === "terminal") return { result: { terminals: [] } };
      throw new Error(`unexpected args: ${args.join(" ")}`);
    };
    const result = await collectStatus({
      rootDir: process.cwd(),
      exec,
      orcaCommand: "orca-test",
    });

    expect(result.snapshot.orca.runs.map((run) => run.id)).toEqual(["run-1", "run-2"]);
    expect(calls.some((call) => call.includes("--cursor") && call.includes("page-2"))).toBe(true);
    const completed = result.snapshot.nodes.filter((node) => /^C(?:0[0-9]|10)$/u.test(node.id));
    expect(completed).toHaveLength(11);
    expect(completed.every((node) => node.status === "completed")).toBe(true);
    expect(result.snapshot.nodes.find((node) => node.id === "G0")?.status).toBe("completed");
    expect(result.snapshot.nodes.find((node) => node.id === "G1")?.status).toBe("completed");
    expect(result.snapshot.frontier).toContain("C11");
    expect(
      result.snapshot.nodes
        .filter((node) => result.snapshot.frontier.includes(node.id))
        .every((node) => node.status === "ready"),
    ).toBe(true);
    expect(result.snapshot.unlinkedTasks).toEqual([]);
    expect(result.snapshot.violations).toEqual([]);
    expect(result.snapshot.diagnostics).toHaveLength(2);

    const envelopeWorktreeId = `${repoId}::${process.cwd()}`;
    taskRecord = (runId) =>
      runId === "run-1"
        ? {
            id: "task-run-1",
            run_id: runId,
            status: "dispatched",
            result: {
              schemaVersion: 1,
              changeId: "C11",
              taskKind: "planning",
              phase: "planning",
              worktreeId: envelopeWorktreeId,
              baseHead: "base-head",
              head: "feature-head",
              outcome: "pending",
              evidenceRefs: [],
            },
          }
        : {
            id: "task-run-2",
            run_id: runId,
            status: "completed",
            created_by_process_incarnation: `${repoId}::${process.cwd()}::old`,
            result: null,
          };
    workerRecords = [
      {
        taskId: "task-run-1",
        workerState: "running",
        dispatchStatus: "dispatched",
        resource: { worktreeId: `${repoId}::/tmp/different-worktree` },
      },
    ];
    const conflict = await collectStatus({
      rootDir: process.cwd(),
      exec,
      orcaCommand: "orca-test",
    });
    expect(conflict.snapshot.violations).toContainEqual(
      expect.objectContaining({
        nodeId: "C11",
        code: "task_identity_conflict",
        reason: "worker_worktree_mismatch",
      }),
    );
  });

  it("reports non-zero commands as structured failures", async () => {
    await expect(defaultExec(process.execPath, ["-e", "process.exit(2)"])).rejects.toBeInstanceOf(
      CommandFailure,
    );
  });

  it("reports timeouts as structured failures", async () => {
    await expect(
      defaultExec(process.execPath, ["-e", "setTimeout(() => {}, 1000)"], { timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(CommandFailure);
  });

  it("rejects invalid command JSON", async () => {
    await expect(
      readJsonCommand(async () => "not-json", "orca", ["--json"]),
    ).rejects.toBeInstanceOf(InvalidJsonError);
  });
});
