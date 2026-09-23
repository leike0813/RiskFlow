import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CommandFailure,
  DISPATCH_INPUT_TRUST_ISSUE_REF,
  InvalidJsonError,
  collectStatus,
  defaultExec,
  deriveNodeState,
  deriveSnapshot,
  normalizeTask,
  parseTaskEnvelope,
  porcelainDirtyPath,
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

function v2Envelope(overrides = {}) {
  return parseTaskEnvelope({
    result: {
      schemaVersion: 2,
      workItemId: "C08",
      routeNodeId: "C08",
      changeName: "deliver-agent",
      taskKind: "finalization",
      phase: "finalizing",
      runState: "queued",
      worktreeId,
      inputHead: "feature-head",
      owner: {
        taskId: "task-c08-finalization",
        agentClass: "strong-finalizer",
        model: "gpt-6-sol",
      },
      attemptGroup: "finalize-c08",
      attempt: 1,
      auditPolicy: "self",
      issueRefs: [],
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
    expect(v2Envelope()).toMatchObject({
      valid: true,
      schemaVersion: 2,
      workItemId: "C08",
      head: "feature-head",
    });
    expect(v2Envelope({ outcome: "succeeded" })).toMatchObject({
      valid: false,
      reason: "premature_outcome",
    });
    expect(v2Envelope({ outputHead: "feature-head" })).toMatchObject({
      valid: false,
      reason: "premature_output_head",
    });
    expect(v2Envelope({ phase: "implementing" })).toMatchObject({
      valid: false,
      reason: "phase_task_kind_mismatch",
    });
    expect(v2Envelope({ runState: "settled" })).toMatchObject({
      valid: false,
      reason: "missing_settled_outcome",
    });
    expect(v2Envelope({ runState: "settled", outcome: "succeeded" })).toMatchObject({
      valid: true,
      outcome: "succeeded",
    });
    expect(v2Envelope({ approvalRef: "approval://C08/2" })).toMatchObject({
      valid: false,
      reason: "invalid_replan_boundary",
    });
    expect(
      v2Envelope({
        taskKind: "planning",
        phase: "planning",
        approvalRef: "approval://C08/2",
        supersedesAttemptGroup: "finalize-c08",
      }),
    ).toMatchObject({ valid: true, approvalRef: "approval://C08/2" });
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

describe("dirty path projection", () => {
  it("exposes paths rather than porcelain status lines", () => {
    expect(porcelainDirtyPath(" M packages/a.ts")).toBe("packages/a.ts");
    expect(porcelainDirtyPath("?? packages/b.ts")).toBe("packages/b.ts");
    expect(porcelainDirtyPath("R  packages/old.ts -> packages/new.ts")).toBe("packages/new.ts");
    expect(porcelainDirtyPath(' M "packages/with space.ts"')).toBe("packages/with space.ts");
  });
});

describe("attempt ledger overlay", () => {
  it("completes the current attempt from the ledger when Orca no longer carries it", () => {
    const ledgerEnvelope = v2Envelope({ runState: "running" });
    const record = {
      id: "task-c08-finalization",
      status: "dispatched",
      run_id: "run-c08",
      created_by_process_incarnation: "serve-1:instance-1",
      result: null,
    };
    const withoutLedger = normalizeTask(record, "repo-id");
    expect(withoutLedger.envelope.valid).toBe(false);
    expect(withoutLedger.repoOwned).toBe(false);

    const withLedger = normalizeTask(record, "repo-id", ledgerEnvelope);
    expect(withLedger.envelope).toMatchObject({
      valid: true,
      workItemId: "C08",
      taskKind: "finalization",
      runState: "running",
      worktreeId,
    });
    expect(withLedger.repoOwned).toBe(true);
    expect(withLedger.runId).toBe("run-c08");
    expect(withLedger.status).toBe("dispatched");
  });

  it("prefers the Orca envelope while it is still valid", () => {
    const orcaPayload = v2Envelope({ runState: "settled", outcome: "paused" });
    delete orcaPayload.valid;
    const record = {
      id: "task-c08-finalization",
      status: "completed",
      result: JSON.stringify(orcaPayload),
    };
    const normalized = normalizeTask(
      record,
      "repo-id",
      v2Envelope({ runState: "settled", outcome: "succeeded" }),
    );
    expect(normalized.envelope).toMatchObject({ runState: "settled", outcome: "paused" });
  });

  it("prefers a settled ledger over a stale running envelope on a terminal task", () => {
    const orcaPayload = v2Envelope({ runState: "running" });
    delete orcaPayload.valid;
    const normalized = normalizeTask(
      {
        id: "task-c08-finalization",
        status: "completed",
        result: JSON.stringify(orcaPayload),
      },
      "repo-id",
      v2Envelope({ runState: "settled", outcome: "succeeded", outputHead: "feature-head" }),
    );
    expect(normalized.envelope).toMatchObject({ runState: "settled", outcome: "succeeded" });
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

    const terminalFacts = {
      ...facts,
      worktrees: [{ ...facts.worktrees[0], liveTerminalCount: 1 }],
    };
    expect(deriveSnapshot(graph(node), terminalFacts).nodes[0]).toMatchObject({
      status: "stale",
      nextActions: [expect.stringContaining("riskflow_integrate")],
    });

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

  it("restarts phase selection at the latest approved replan boundary", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const finalization = task({
      id: "task-c08-finalization",
      createdAt: "2026-09-04 12:00:00",
      envelope: v2Envelope({
        runState: "settled",
        outcome: "paused",
        outputHead: "feature-head",
      }),
    });
    const replan = task({
      id: "task-c08-replan",
      status: "ready",
      createdAt: "2026-09-04 13:00:00",
      envelope: v2Envelope({
        taskKind: "planning",
        phase: "planning",
        owner: {
          taskId: "task-c08-replan",
          agentClass: "strong-planner",
          model: "gpt-6-sol",
        },
        attemptGroup: "C08:planning:approved",
        approvalRef: "approval://C08/2",
        supersedesAttemptGroup: "finalize-c08",
      }),
    });
    const state = deriveNodeState(node, context({ tasks: [finalization, replan] }));
    expect(state).toMatchObject({
      status: "running",
      phase: "planning",
      checkpoints: {
        taskId: "task-c08-replan",
        approvalRef: "approval://C08/2",
        supersedesAttemptGroup: "finalize-c08",
      },
    });
    expect(state.violations).toEqual([]);
  });

  it("accepts a replan boundary that supersedes a settled non-succeeded attempt", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const pausedPlanning = task({
      id: "task-c08-planning-paused",
      status: "failed",
      createdAt: "2026-09-04 12:00:00",
      envelope: v2Envelope({
        taskKind: "planning",
        phase: "planning",
        runState: "settled",
        outcome: "paused",
        attemptGroup: "C08:planning",
        attempt: 1,
        owner: {
          taskId: "task-c08-planning-paused",
          agentClass: "strong-planner",
          model: "gpt-6-sol",
        },
      }),
    });
    const replan = task({
      id: "task-c08-replan",
      status: "ready",
      createdAt: "2026-09-04 13:00:00",
      envelope: v2Envelope({
        taskKind: "planning",
        phase: "planning",
        attemptGroup: "C08:planning:approved",
        approvalRef: "approval://C08/scope",
        supersedesAttemptGroup: "C08:planning",
        owner: { taskId: "task-c08-replan", agentClass: "strong-planner", model: "gpt-6-sol" },
      }),
    });
    const state = deriveNodeState(node, context({ tasks: [pausedPlanning, replan] }));
    expect(state.violations).toEqual([]);
    expect(state.checkpoints).toMatchObject({
      taskId: "task-c08-replan",
      approvalRef: "approval://C08/scope",
      supersedesAttemptGroup: "C08:planning",
    });
  });

  it("rejects a replan boundary over an active or succeeded attempt", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const active = task({
      id: "task-c08-planning-active",
      status: "dispatched",
      createdAt: "2026-09-04 12:00:00",
      envelope: v2Envelope({
        taskKind: "planning",
        phase: "planning",
        runState: "running",
        attemptGroup: "C08:planning",
        attempt: 1,
        owner: {
          taskId: "task-c08-planning-active",
          agentClass: "strong-planner",
          model: "gpt-6-sol",
        },
      }),
    });
    const succeeded = task({
      id: "task-c08-planning-succeeded",
      status: "completed",
      createdAt: "2026-09-04 12:30:00",
      envelope: v2Envelope({
        taskKind: "planning",
        phase: "planning",
        runState: "settled",
        outcome: "succeeded",
        outputHead: "feature-head",
        attemptGroup: "C08:planning",
        attempt: 2,
        owner: {
          taskId: "task-c08-planning-succeeded",
          agentClass: "strong-planner",
          model: "gpt-6-sol",
        },
      }),
    });
    const replan = task({
      id: "task-c08-replan",
      status: "ready",
      createdAt: "2026-09-04 13:00:00",
      envelope: v2Envelope({
        taskKind: "planning",
        phase: "planning",
        attemptGroup: "C08:planning:approved",
        approvalRef: "approval://C08/unapproved",
        supersedesAttemptGroup: "C08:planning",
        owner: { taskId: "task-c08-replan", agentClass: "strong-planner", model: "gpt-6-sol" },
      }),
    });
    for (const superseded of [active, succeeded]) {
      const state = deriveNodeState(node, context({ tasks: [superseded, replan] }));
      expect(state.violations).toContainEqual(
        expect.objectContaining({ code: "invalid_replan_boundary" }),
      );
    }

    const earlierPaused = task({
      id: "task-c08-planning-paused",
      status: "failed",
      createdAt: "2026-09-04 11:00:00",
      envelope: v2Envelope({
        taskKind: "planning",
        phase: "planning",
        runState: "settled",
        outcome: "paused",
        attemptGroup: "C08:planning",
        attempt: 1,
        owner: {
          taskId: "task-c08-planning-paused",
          agentClass: "strong-planner",
          model: "gpt-6-sol",
        },
      }),
    });
    const state = deriveNodeState(node, context({ tasks: [earlierPaused, succeeded, replan] }));
    expect(state.violations).toContainEqual(
      expect.objectContaining({ code: "invalid_replan_boundary" }),
    );
  });

  it("does not count a superseded attempt as a second active writer after an approved replan", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const superseded = task({
      id: "task-c08-finalization",
      status: "ready",
      createdAt: "2026-09-04 12:00:00",
      envelope: v2Envelope({ runState: "queued", attempt: 3 }),
    });
    const replan = task({
      id: "task-c08-replan",
      status: "dispatched",
      createdAt: "2026-09-04 13:00:00",
      envelope: v2Envelope({
        taskKind: "planning",
        phase: "planning",
        runState: "running",
        owner: {
          taskId: "task-c08-replan",
          agentClass: "strong-planner",
          model: "gpt-6-sol",
        },
        attemptGroup: "C08:planning:approved",
        approvalRef: "approval://C08/2",
        supersedesAttemptGroup: "finalize-c08",
      }),
    });
    const state = deriveNodeState(node, context({ tasks: [superseded, replan] }));
    expect(state.violations).toEqual([]);
    expect(state).toMatchObject({
      status: "running",
      phase: "planning",
      checkpoints: { taskId: "task-c08-replan" },
    });
  });

  it("does not treat a superseded attempt in the same group as a second active writer", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const older = task({
      id: "task-c08-older",
      status: "ready",
      createdAt: "2026-09-04 12:00:00",
      envelope: v2Envelope({
        attempt: 3,
        attemptGroup: "finalize-c08",
        owner: { taskId: "task-c08-older", agentClass: "strong-finalizer", model: "gpt-6-sol" },
      }),
    });
    const newer = task({
      id: "task-c08-newer",
      status: "ready",
      createdAt: "2026-09-04 13:00:00",
      envelope: v2Envelope({
        attempt: 4,
        attemptGroup: "finalize-c08",
        owner: { taskId: "task-c08-newer", agentClass: "strong-finalizer", model: "gpt-6-sol" },
      }),
    });
    const state = deriveNodeState(node, context({ tasks: [older, newer] }));
    expect(state.violations).toEqual([]);
    expect(state.checkpoints.taskId).toBe("task-c08-newer");
  });

  it("still reports duplicate writers across attempt groups", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const implementation = task({
      id: "task-c08-implementation",
      status: "dispatched",
      createdAt: "2026-09-04 12:00:00",
      envelope: v2Envelope({
        taskKind: "implementation",
        phase: "implementing",
        attempt: 1,
        attemptGroup: "implement-c08",
      }),
    });
    const finalization = task({
      id: "task-c08-finalization",
      status: "ready",
      createdAt: "2026-09-04 13:00:00",
      envelope: v2Envelope({ attempt: 1, attemptGroup: "finalize-c08" }),
    });
    const state = deriveNodeState(node, context({ tasks: [implementation, finalization] }));
    expect(state.violations).toContainEqual(
      expect.objectContaining({ code: "duplicate_active_writer" }),
    );
  });

  it("selects the newest attempt group as the current attempt within a phase", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const finalization = task({
      id: "task-c08-finalization",
      status: "completed",
      createdAt: "2026-09-04 12:00:00",
      envelope: v2Envelope({
        runState: "settled",
        outcome: "succeeded",
        outputHead: "feature-head",
        attempt: 2,
        attemptGroup: "finalize-c08",
        owner: {
          taskId: "task-c08-finalization",
          agentClass: "strong-finalizer",
          model: "gpt-6-sol",
        },
      }),
    });
    const audit = task({
      id: "task-c08-audit",
      status: "dispatched",
      createdAt: "2026-09-04 13:00:00",
      envelope: v2Envelope({
        taskKind: "audit",
        phase: "finalizing",
        runState: "running",
        attempt: 1,
        attemptGroup: "audit-c08",
        auditPolicy: "targeted",
        owner: {
          taskId: "task-c08-audit",
          agentClass: "strong-auditor",
          model: "gpt-6-sol",
        },
      }),
    });
    const state = deriveNodeState(node, context({ tasks: [finalization, audit] }));
    expect(state.violations).toEqual([]);
    expect(state.checkpoints.taskId).toBe("task-c08-audit");
    expect(state.status).toBe("running");
  });

  it("requires exactly one limited audit per finalizing round", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const finalization = task({
      id: "task-c08-finalization",
      status: "completed",
      createdAt: "2026-09-04 12:00:00",
      envelope: v2Envelope({
        runState: "settled",
        outcome: "succeeded",
        outputHead: "feature-head",
        attempt: 1,
        attemptGroup: "finalize-c08",
        auditPolicy: "targeted",
        owner: {
          taskId: "task-c08-finalization",
          agentClass: "strong-finalizer",
          model: "gpt-6-sol",
        },
      }),
    });

    const beforeAudit = deriveNodeState(node, context({ tasks: [finalization] }));
    expect(beforeAudit.auditRequired).toBe(true);
    expect(beforeAudit.nextActions).toEqual(["派发不同强模型责任者执行限定范围 audit"]);

    const concludedAudit = task({
      id: "task-c08-audit",
      status: "completed",
      createdAt: "2026-09-04 13:00:00",
      envelope: v2Envelope({
        taskKind: "audit",
        phase: "finalizing",
        runState: "settled",
        outcome: "succeeded",
        outputHead: "feature-head",
        attempt: 1,
        attemptGroup: "audit-c08",
        auditPolicy: "targeted",
        owner: { taskId: "task-c08-audit", agentClass: "strong-auditor", model: "gpt-6-sol" },
      }),
    });
    const afterAudit = deriveNodeState(node, context({ tasks: [finalization, concludedAudit] }));
    expect(afterAudit.auditRequired).toBe(false);
    expect(afterAudit.status).toBe("finalized");
    expect(afterAudit.nextActions).toEqual(["集成当前已验收产物"]);
  });

  it("pauses instead of reusing a session or dispatching another Finalizer after audit failure", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const audit = task({
      id: "task-c08-audit",
      status: "failed",
      createdAt: "2026-09-04 13:00:00",
      envelope: v2Envelope({
        taskKind: "audit",
        phase: "finalizing",
        runState: "settled",
        outcome: "failed",
        outputHead: "feature-head",
        attempt: 1,
        attemptGroup: "audit-c08",
        auditPolicy: "targeted",
        owner: {
          taskId: "task-c08-audit",
          agentClass: "strong-auditor",
          model: "gpt-6-sol",
        },
      }),
    });
    const state = deriveNodeState(node, context({ tasks: [audit] }));
    expect(state.status).toBe("paused");
    expect(state.nextActions).toEqual([
      "限定审计未在当前任务内闭合；禁止复用会话或自动新建 Finalizer，向用户升级",
    ]);
  });

  it("routes a failed current worker through controlled reconciliation", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const currentTask = task({
      id: "task-c08-finalization",
      status: "blocked",
      envelope: v2Envelope({ runState: "running" }),
    });
    const snapshot = deriveSnapshot(
      graph(node),
      context({
        worktrees: [
          {
            id: worktreeId,
            path: "/tmp/riskflow-feature",
            exists: true,
            localNodeIds: ["C08"],
            openSpecNodeIds: ["C08"],
            openSpecNames: ["deliver-agent"],
            liveTerminalCount: 1,
            git: { head: "feature-head", branch: "feature", dirty: false, dirtyPaths: [] },
            tasks: [currentTask],
          },
        ],
        tasks: [currentTask],
        workers: [
          {
            taskId: "task-c08-finalization",
            dispatchId: "dispatch-c08",
            workerState: "unsupervised",
            dispatchStatus: "failed",
          },
        ],
        ancestry: { C08: true },
      }),
    );
    expect(snapshot.nodes[0]).toMatchObject({
      status: "blocked",
      nextActions: [expect.stringContaining("riskflow_reconcile")],
    });
  });

  it("does not let an old failed dispatch override a live dispatch for the same task", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const currentTask = task({
      id: "task-c08-finalization",
      status: "dispatched",
      envelope: v2Envelope({ runState: "running" }),
    });
    const snapshot = deriveSnapshot(
      graph(node),
      context({
        worktrees: [
          {
            id: worktreeId,
            path: "/tmp/riskflow-feature",
            exists: true,
            localNodeIds: ["C08"],
            openSpecNodeIds: ["C08"],
            openSpecNames: ["deliver-agent"],
            liveTerminalCount: 1,
            git: { head: "feature-head", branch: "feature", dirty: false, dirtyPaths: [] },
            tasks: [currentTask],
          },
        ],
        tasks: [currentTask],
        workers: [
          {
            taskId: "task-c08-finalization",
            dispatchId: "dispatch-old",
            workerState: "failed",
            dispatchStatus: "failed",
          },
          {
            taskId: "task-c08-finalization",
            dispatchId: "dispatch-current",
            workerState: "ready",
            dispatchStatus: "dispatched",
          },
        ],
        ancestry: { C08: false },
      }),
    );
    expect(snapshot.nodes[0]).toMatchObject({ status: "running", violations: [] });
  });

  it("still orders attempts inside one attempt group", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const first = task({
      id: "task-c08-attempt-1",
      status: "completed",
      createdAt: "2026-09-04 12:00:00",
      envelope: v2Envelope({
        runState: "settled",
        outcome: "paused",
        outputHead: "feature-head",
        attempt: 1,
        attemptGroup: "finalize-c08",
        owner: {
          taskId: "task-c08-attempt-1",
          agentClass: "strong-finalizer",
          model: "gpt-6-sol",
        },
      }),
    });
    const second = task({
      id: "task-c08-attempt-2",
      status: "ready",
      createdAt: "2026-09-04 13:00:00",
      envelope: v2Envelope({
        runState: "queued",
        attempt: 2,
        attemptGroup: "finalize-c08",
        owner: {
          taskId: "task-c08-attempt-2",
          agentClass: "strong-finalizer",
          model: "gpt-6-sol",
        },
      }),
    });
    const state = deriveNodeState(node, context({ tasks: [first, second] }));
    expect(state.checkpoints.taskId).toBe("task-c08-attempt-2");
  });

  it("fails closed when an approved replan does not supersede a finalizing attempt", () => {
    const node = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const replan = task({
      id: "task-c08-replan",
      status: "ready",
      createdAt: "2026-09-04 13:00:00",
      envelope: v2Envelope({
        taskKind: "planning",
        phase: "planning",
        owner: {
          taskId: "task-c08-replan",
          agentClass: "strong-planner",
          model: "gpt-6-sol",
        },
        attemptGroup: "C08:planning:approved",
        approvalRef: "approval://C08/2",
        supersedesAttemptGroup: "missing-finalizer",
      }),
    });
    const state = deriveNodeState(node, context({ tasks: [replan] }));
    expect(state.status).toBe("unknown");
    expect(state.violations.map((item) => item.code)).toContain("invalid_replan_boundary");
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

  it("orders active finalization and auxiliary adoption in the resume queue", () => {
    const c17 = {
      id: "C17",
      kind: "change",
      change: "deliver-process-model",
      dependsOn: [],
    };
    const c20 = {
      id: "C20",
      kind: "change",
      change: "deliver-retrieval",
      dependsOn: ["C17"],
    };
    const finalizerTask = task({
      id: "task-c17-finalizer",
      status: "ready",
      envelope: v2Envelope({
        workItemId: "C17",
        routeNodeId: "C17",
        changeName: "deliver-process-model",
        owner: {
          taskId: "task-c17-finalizer",
          agentClass: "strong-finalizer",
          model: "gpt-6-sol",
        },
      }),
    });
    const routeWorktree = {
      id: worktreeId,
      path: "/tmp/riskflow-feature",
      exists: true,
      localNodeIds: ["C17"],
      openSpecNodeIds: ["C17"],
      openSpecNames: ["deliver-process-model"],
      liveTerminalCount: 0,
      git: { head: "feature-head", branch: "feature", dirty: false, dirtyPaths: [] },
      tasks: [finalizerTask],
    };
    const auxiliaryWorktree = {
      ...routeWorktree,
      id: "repo-id::/tmp/auxiliary",
      path: "/tmp/auxiliary",
      localNodeIds: [],
      openSpecNodeIds: [],
      openSpecNames: ["fix-suite-isolation"],
      tasks: [],
    };
    const auxiliaryTask = task({
      id: "task-aux-finalizer",
      status: "ready",
      envelope: v2Envelope({
        workItemId: "AUX:fix-suite-isolation",
        routeNodeId: null,
        changeName: "fix-suite-isolation",
        owner: {
          taskId: "task-aux-finalizer",
          agentClass: "strong-finalizer",
          model: "gpt-6-sol",
        },
      }),
    });
    auxiliaryWorktree.tasks = [auxiliaryTask];
    const snapshot = deriveSnapshot(
      graph(c20, c17),
      context({
        worktrees: [routeWorktree, auxiliaryWorktree],
        tasks: [finalizerTask, auxiliaryTask],
        ancestry: { C17: false },
      }),
    );
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.resumeQueue.map((item) => item.workItemId)).toEqual([
      "C17",
      "AUX:fix-suite-isolation",
    ]);
    expect(snapshot.nodes.find((node) => node.id === "C20")?.status).toBe("pending");
    expect(snapshot.revision).toMatch(/^[a-f0-9]{64}$/u);
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

  it("keeps dispatch-input trust recovery reachable until a worker accepts input", () => {
    const routeNode = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const recoveryEnvelope = v2Envelope({
      issueRefs: [DISPATCH_INPUT_TRUST_ISSUE_REF],
      runState: "queued",
    });
    const recoveringTask = task({
      id: "task-c08-finalization",
      status: "failed",
      envelope: recoveryEnvelope,
    });
    const worktree = {
      id: worktreeId,
      path: "/tmp/riskflow-feature",
      exists: true,
      localNodeIds: ["C08"],
      openSpecNodeIds: [],
      openSpecNames: [],
      liveTerminalCount: 1,
      git: { head: "feature-head", branch: "feature", dirty: false, dirtyPaths: [] },
      tasks: [recoveringTask],
    };
    const failedWorker = {
      taskId: "task-c08-finalization",
      dispatchId: "dispatch-trust-blocked",
      workerState: "failed",
      dispatchStatus: "failed",
    };

    const recovering = deriveSnapshot(
      graph(routeNode),
      context({ worktrees: [worktree], tasks: [recoveringTask], workers: [failedWorker] }),
    );
    expect(recovering.nodes[0]).toMatchObject({
      status: "finalizing",
      violations: [],
      nextActions: [expect.stringContaining("同一 terminalHandle")],
    });
    expect(recovering.resumeQueue[0]).toMatchObject({ workItemId: "C08", category: "finalizing" });

    const runningTask = task({
      id: "task-c08-finalization",
      status: "dispatched",
      envelope: v2Envelope({
        issueRefs: [DISPATCH_INPUT_TRUST_ISSUE_REF],
        runState: "running",
      }),
    });
    const accepted = deriveSnapshot(
      graph(routeNode),
      context({
        worktrees: [{ ...worktree, tasks: [runningTask] }],
        tasks: [runningTask],
        workers: [
          {
            taskId: "task-c08-finalization",
            dispatchId: "dispatch-running",
            workerState: "ready",
            dispatchStatus: "dispatched",
          },
        ],
      }),
    ).nodes[0];
    expect(accepted.status).toBe("unknown");
    expect(accepted.violations.map((item) => item.code)).toContain("task_missing_local_openspec");
  });

  it("prefers the queued dispatch-input recovery ledger over a ready Orca envelope", () => {
    const current = v2Envelope();
    const rawEnvelope = { ...current };
    delete rawEnvelope.valid;
    const normalized = normalizeTask(
      {
        id: "task-c08-finalization",
        status: "ready",
        result: rawEnvelope,
        created_by_process_incarnation: "repo-id::/tmp/riskflow-feature::process",
      },
      "repo-id",
      { ...rawEnvelope, issueRefs: [DISPATCH_INPUT_TRUST_ISSUE_REF] },
    );
    expect(normalized.envelope).toMatchObject({
      valid: true,
      runState: "queued",
      issueRefs: [DISPATCH_INPUT_TRUST_ISSUE_REF],
    });
  });

  it("fails closed for duplicate writers and v2 identity mismatches", () => {
    const routeNode = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const first = task({
      id: "first",
      status: "dispatched",
      envelope: v2Envelope({
        owner: { taskId: "first", agentClass: "strong-finalizer", model: "gpt-6-sol" },
      }),
    });
    const second = task({
      id: "second",
      status: "ready",
      createdAt: "2026-09-04 13:00:00",
      envelope: v2Envelope({
        owner: { taskId: "wrong", agentClass: "strong-finalizer", model: "gpt-6-sol" },
      }),
    });
    const worktree = {
      id: worktreeId,
      path: "/tmp/riskflow-feature",
      exists: true,
      localNodeIds: ["C08"],
      openSpecNodeIds: ["C08"],
      openSpecNames: ["deliver-agent"],
      liveTerminalCount: 0,
      git: { head: "feature-head", branch: "feature", dirty: false, dirtyPaths: [] },
      tasks: [first, second],
    };
    const state = deriveSnapshot(
      graph(routeNode),
      context({ worktrees: [worktree], tasks: [first, second] }),
    ).nodes[0];
    expect(state.status).toBe("unknown");
    expect(state.violations.map((item) => item.code)).toEqual(
      expect.arrayContaining(["duplicate_active_writer", "task_identity_conflict"]),
    );
  });

  it("allows a dispatched worker to advance HEAD but binds a settled result to outputHead", () => {
    const routeNode = { id: "C08", kind: "change", change: "deliver-agent", dependsOn: [] };
    const dispatched = task({
      id: "task-c08-finalization",
      status: "dispatched",
      envelope: v2Envelope(),
    });
    const worktree = {
      id: worktreeId,
      path: "/tmp/riskflow-feature",
      exists: true,
      localNodeIds: ["C08"],
      openSpecNodeIds: ["C08"],
      openSpecNames: ["deliver-agent"],
      liveTerminalCount: 1,
      git: { head: "new-head", branch: "feature", dirty: false, dirtyPaths: [] },
      tasks: [dispatched],
    };
    const active = deriveSnapshot(
      graph(routeNode),
      context({ worktrees: [worktree], tasks: [dispatched] }),
    ).nodes[0];
    expect(active.violations.map((item) => item.code)).not.toContain("checkpoint_mismatch");

    const settled = {
      ...dispatched,
      status: "completed",
      envelope: v2Envelope({
        runState: "settled",
        outcome: "succeeded",
        outputHead: "old-output",
      }),
    };
    const stale = deriveSnapshot(
      graph(routeNode),
      context({
        worktrees: [{ ...worktree, tasks: [settled] }],
        tasks: [settled],
      }),
    ).nodes[0];
    expect(stale.violations.map((item) => item.code)).toContain("checkpoint_mismatch");
  });

  it("treats a merged auxiliary worktree head as merge evidence", () => {
    const auxiliaryWorktree = {
      id: "repo-id::/tmp/auxiliary",
      path: "/tmp/auxiliary",
      exists: true,
      isMain: false,
      git: { head: "aux-head", branch: "feature/aux", dirty: false, dirtyPaths: [] },
      openSpec: [{ name: "fix-suite-isolation", status: "complete" }],
      openSpecNames: ["fix-suite-isolation"],
      openSpecNodeIds: [],
      localNodeIds: [],
      liveTerminalCount: 0,
      terminals: [],
      tasks: [],
    };
    const auxiliaryTask = task({
      id: "task-aux-finalization",
      status: "completed",
      createdAt: "2026-09-04 14:00:00",
      envelope: v2Envelope({
        workItemId: "AUX:fix-suite-isolation",
        changeName: "fix-suite-isolation",
        routeNodeId: null,
        runState: "settled",
        outcome: "succeeded",
        outputHead: "aux-head",
        owner: {
          taskId: "task-aux-finalization",
          agentClass: "strong-finalizer",
          model: "gpt-6-sol",
        },
      }),
    });
    auxiliaryWorktree.tasks = [auxiliaryTask];
    const facts = context({
      worktrees: [auxiliaryWorktree],
      tasks: [auxiliaryTask],
      ancestry: { "AUX:fix-suite-isolation": true },
    });

    const merged = deriveSnapshot(graph(), facts).nodes.find(
      (candidate) => candidate.id === "AUX:fix-suite-isolation",
    );
    expect(merged).toMatchObject({ status: "merged", phase: "integration" });
    expect(merged.nextActions).toEqual(["在 main 上完成冻结安装、pnpm verify 和主线验证"]);

    const unmerged = deriveSnapshot(
      graph(),
      context({
        worktrees: [auxiliaryWorktree],
        tasks: [auxiliaryTask],
      }),
    ).nodes.find((candidate) => candidate.id === "AUX:fix-suite-isolation");
    expect(unmerged.status).toBe("finalized");
  });

  it("adopts a dirty auxiliary worktree whose unchanged HEAD is already on main", () => {
    const auxiliaryWorktree = {
      id: "repo-id::/tmp/auxiliary",
      path: "/tmp/auxiliary",
      exists: true,
      isMain: false,
      git: {
        head: "main-head",
        branch: "feature/aux",
        dirty: true,
        dirtyPaths: ["scripts/orchestration/control.mjs"],
      },
      openSpec: [{ name: "fix-suite-isolation", status: "complete" }],
      openSpecNames: ["fix-suite-isolation"],
      openSpecNodeIds: [],
      localNodeIds: [],
      liveTerminalCount: 0,
      terminals: [],
      tasks: [],
    };
    const snapshot = deriveSnapshot(
      graph(),
      context({
        worktrees: [auxiliaryWorktree],
        ancestry: { "AUX:fix-suite-isolation": true },
      }),
    );
    const auxiliary = snapshot.nodes.find(
      (candidate) => candidate.id === "AUX:fix-suite-isolation",
    );
    expect(auxiliary).toMatchObject({ status: "untracked", phase: "adopt" });
    expect(snapshot.resumeQueue[0]).toMatchObject({
      workItemId: "AUX:fix-suite-isolation",
      category: "recovery",
    });
  });

  it("groups duplicate auxiliary changes before deriving their state", () => {
    const auxiliary = (id, path) => ({
      id,
      path,
      exists: true,
      localNodeIds: [],
      openSpecNodeIds: [],
      openSpecNames: ["fix-suite-isolation"],
      liveTerminalCount: 0,
      git: { head: "feature-head", branch: id, dirty: false, dirtyPaths: [] },
      tasks: [],
    });
    const snapshot = deriveSnapshot(
      graph(),
      context({
        worktrees: [
          auxiliary("repo-id::/tmp/aux-1", "/tmp/aux-1"),
          auxiliary("repo-id::/tmp/aux-2", "/tmp/aux-2"),
        ],
      }),
    );
    const states = snapshot.nodes.filter((item) => item.id === "AUX:fix-suite-isolation");
    expect(states).toHaveLength(1);
    expect(states[0].violations.map((item) => item.code)).toContain("duplicate_active_worktree");
  });

  it("uses an auxiliary v2 envelope to ignore inherited change copies", () => {
    const auxiliary = (id, path, tasks = []) => ({
      id,
      path,
      exists: true,
      localNodeIds: [],
      openSpecNodeIds: [],
      openSpecNames: ["strengthen-orchestration"],
      liveTerminalCount: 0,
      git: { head: "feature-head", branch: id, dirty: false, dirtyPaths: [] },
      tasks,
    });
    const ownerTask = task({
      id: "task-aux-owner",
      status: "ready",
      envelope: v2Envelope({
        workItemId: "AUX:strengthen-orchestration",
        routeNodeId: null,
        changeName: "strengthen-orchestration",
        worktreeId: "repo-id::/tmp/owner",
        owner: {
          taskId: "task-aux-owner",
          agentClass: "strong-finalizer",
          model: "gpt-6-sol",
        },
      }),
    });
    const snapshot = deriveSnapshot(
      graph(),
      context({
        worktrees: [
          auxiliary("repo-id::/tmp/inherited", "/tmp/inherited"),
          auxiliary("repo-id::/tmp/owner", "/tmp/owner", [ownerTask]),
        ],
        tasks: [ownerTask],
      }),
    );
    const state = snapshot.nodes.find((item) => item.id === "AUX:strengthen-orchestration");
    expect(state?.worktree?.id).toBe("repo-id::/tmp/owner");
    expect(state?.violations.map((item) => item.code)).not.toContain("duplicate_active_worktree");
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
    const earlyChanges = result.snapshot.nodes.filter((node) =>
      /^C(?:0[0-9]|10|11)$/u.test(node.id),
    );
    expect(earlyChanges).toHaveLength(12);
    expect(earlyChanges.every((node) => node.status === "completed")).toBe(true);
    expect(result.snapshot.nodes.find((node) => node.id === "G0")?.status).toBe("completed");
    expect(result.snapshot.nodes.find((node) => node.id === "G1")?.status).toBe("completed");
    expect(result.snapshot.frontier.length).toBeGreaterThan(0);
    expect(
      result.snapshot.nodes
        .filter((node) => result.snapshot.frontier.includes(node.id))
        .every((node) => node.status === "ready"),
    ).toBe(true);
    expect(
      result.snapshot.nodes
        .filter((node) => node.status === "completed")
        .every((node) => !result.snapshot.frontier.includes(node.id)),
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
