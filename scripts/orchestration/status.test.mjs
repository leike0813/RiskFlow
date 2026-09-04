import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CommandFailure,
  InvalidJsonError,
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
      changeId: "C08",
      taskKind: "verification",
      worktreeId,
      baseHead: "base",
      head: "head",
    };
    for (const field of Object.keys(valid)) {
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

  it("does not treat a main archive without verification as complete", () => {
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
    expect(snapshot.nodes[0].status).toBe("unknown");
    expect(snapshot.violations).toContainEqual({
      nodeId: "C08",
      code: "main_verification_missing",
    });
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
