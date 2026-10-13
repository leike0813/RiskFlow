import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AccessServiceError, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import {
  ReviewAuditReadQueryV1Schema,
  type ReviewActivityPageV1,
  type ReviewAuditReadQueryV1,
  type ReviewTaskDetailV1,
} from "@riskflow/core/review-audit";
import {
  AuthorizationContextV1Schema,
  CalibrationSuggestionApprovalProofQueryV1Schema,
  KnowledgeRevisionApprovalProofQueryV1Schema,
  ReviewDecisionCommandV1Schema,
  ReviewRequestV1Schema,
  type AuthorizationContextV1,
  type CalibrationSuggestionApprovalProofQueryV1,
  type IdentificationGroupRefV1,
  type KnowledgeRevisionApprovalProofQueryV1,
  type ReviewDecisionCommandV1,
  type ReviewRequestV1,
  type ReviewTaskRefV1,
  type ReviewTargetRefV1,
  type RuleConflictRefV1,
} from "@riskflow/contracts/ports";

import {
  bootstrapInitialSystemAdministrator,
  createPostgresLocalIdentityAccess,
} from "../../src/auth/index.js";
import {
  PostgresReviewAuditAdapter,
  PostgresReviewAuditRead,
} from "../../src/review-audit/index.js";
import { createPostgresRuntime } from "../../src/postgres/pool.js";
import * as reviewAuditMigration from "../../src/postgres/migrations/platform/deliver-review-and-audit-runtime/000004_review_and_audit_runtime.js";
import {
  startReviewAuditFixture,
  REVIEW_TEST_TIMESTAMP,
  type ReviewAuditPostgresFixture,
} from "./fixture.js";

const nextId = (() => {
  let count = 0;
  return (prefix: string): string => `${prefix}-${++count}`;
})();

const target = (
  kind:
    | "identification-group"
    | "knowledge-revision"
    | "rule-conflict"
    | "response-candidate"
    | "calibration-suggestion",
  entityId: string,
  versionId = "1",
): ReviewTargetRefV1 => ({ kind, reference: { entityId, versionId } }) as ReviewTargetRefV1;

const authorizationFor = (projectId: string, actorId = "actor-1"): AuthorizationContextV1 => ({
  schemaVersion: "1",
  authorizationContextRef: {
    kind: "authorization-context",
    reference: { entityId: `authorization-${projectId}`, versionId: "1" },
  },
  actorId,
  projectId,
  grantedCapabilities: ["review-audit.request", "review-audit.decide", "review-audit.read"],
  spatialScopeRefs: [],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
  decidedAt: REVIEW_TEST_TIMESTAMP,
  invocation: { kind: "human" },
});

const requestFor = (options: {
  readonly suffix: string;
  readonly projectId?: string;
  readonly targetVersionId?: string;
  readonly targetEntityId?: string;
  readonly reviewType?: ReviewRequestV1["payload"]["reviewType"];
  readonly authorization?: AuthorizationContextV1;
  readonly commandId?: string;
  readonly idempotencyKey?: string;
}): ReviewRequestV1 => {
  const projectId = options.projectId ?? "project-1";
  const reviewType = options.reviewType ?? "identification-group";
  const targetRef = target(
    reviewType === "identification-group" ? "identification-group" : reviewType,
    options.targetEntityId ?? `group-${options.suffix}`,
    options.targetVersionId,
  );
  return ReviewRequestV1Schema.parse({
    kind: "request-review",
    commandId: options.commandId ?? nextId(`request-${options.suffix}`),
    idempotencyKey: options.idempotencyKey ?? nextId(`idempotency-${options.suffix}`),
    projectId,
    actorId: options.authorization?.actorId ?? "actor-1",
    issuedAt: REVIEW_TEST_TIMESTAMP,
    authorization: options.authorization ?? authorizationFor(projectId),
    payload: {
      reviewType,
      targetRef,
      validationSnapshotRef: {
        kind: "validation-snapshot",
        reference: { entityId: `validation-${options.suffix}`, versionId: "1" },
      },
      evidenceSnapshotRef: {
        kind: "evidence-snapshot",
        reference: { entityId: `evidence-${options.suffix}`, versionId: "1" },
      },
      waitingRunRef: {
        kind: "workflow-run",
        reference: { entityId: `run-${options.suffix}`, versionId: "1" },
      },
      reviewPolicyRef: { entityId: "review-policy", versionId: "1" },
    },
  });
};

const decisionFor = (
  request: ReviewRequestV1,
  taskRef: ReviewTaskRefV1,
  suffix = "decision",
  options: {
    readonly actorId?: string;
    readonly authorization?: AuthorizationContextV1;
    readonly commandId?: string;
    readonly knowledgeDecisionKind?: "approve-publication" | "reject" | "return-for-revision";
    readonly calibrationDecisionKind?: "approve-draft-creation" | "reject" | "return-for-revision";
  } = {},
): ReviewDecisionCommandV1 =>
  ReviewDecisionCommandV1Schema.parse({
    kind: "decide-review",
    commandId: options.commandId ?? nextId(`decide-${suffix}`),
    idempotencyKey: nextId(`idempotency-decide-${suffix}`),
    projectId: request.projectId,
    actorId: options.actorId ?? request.actorId,
    issuedAt: REVIEW_TEST_TIMESTAMP,
    authorization: options.authorization ?? request.authorization,
    payload: {
      reviewTaskRef: taskRef,
      targetRef: request.payload.targetRef,
      decision:
        request.payload.reviewType === "identification-group"
          ? { reviewType: "identification-group", kind: "approve-unchanged" }
          : request.payload.reviewType === "knowledge-revision"
            ? {
                reviewType: "knowledge-revision",
                kind: options.knowledgeDecisionKind ?? "approve-publication",
              }
            : request.payload.reviewType === "rule-conflict"
              ? { reviewType: request.payload.reviewType, kind: "approve-publication" }
              : request.payload.reviewType === "response-candidate"
                ? { reviewType: "response-candidate", kind: "return-upstream" }
                : {
                    reviewType: "calibration-suggestion",
                    kind: options.calibrationDecisionKind ?? "approve-draft-creation",
                  },
      reasonCode: "reviewed",
    },
  });

const approvalQueryFor = (options: {
  readonly suffix: string;
  readonly projectId: string;
  readonly authorization: AuthorizationContextV1;
  readonly queryId?: string;
  readonly revisionEntityId: string;
  readonly revisionVersionId?: string;
  readonly decisionEntityId: string;
  readonly decisionVersionId?: string;
}): KnowledgeRevisionApprovalProofQueryV1 =>
  KnowledgeRevisionApprovalProofQueryV1Schema.parse({
    queryId: options.queryId ?? nextId(`approval-query-${options.suffix}`),
    projectId: options.projectId,
    actorId: options.authorization.actorId,
    requestedAt: REVIEW_TEST_TIMESTAMP,
    authorization: options.authorization,
    kind: "verify-knowledge-revision-approval",
    payload: {
      revisionRef: {
        kind: "knowledge-revision",
        reference: {
          entityId: options.revisionEntityId,
          versionId: options.revisionVersionId ?? "1",
        },
      },
      reviewDecisionRef: {
        kind: "review-decision",
        reference: {
          entityId: options.decisionEntityId,
          versionId: options.decisionVersionId ?? "1",
        },
      },
    },
  });

const calibrationApprovalQueryFor = (options: {
  readonly suffix: string;
  readonly projectId: string;
  readonly authorization: AuthorizationContextV1;
  readonly queryId?: string;
  readonly suggestionEntityId: string;
  readonly suggestionVersionId?: string;
  readonly decisionEntityId: string;
  readonly decisionVersionId?: string;
}): CalibrationSuggestionApprovalProofQueryV1 =>
  CalibrationSuggestionApprovalProofQueryV1Schema.parse({
    queryId: options.queryId ?? nextId(`calibration-approval-query-${options.suffix}`),
    projectId: options.projectId,
    actorId: options.authorization.actorId,
    requestedAt: REVIEW_TEST_TIMESTAMP,
    authorization: options.authorization,
    kind: "verify-calibration-suggestion-approval",
    payload: {
      calibrationSuggestionRef: {
        kind: "calibration-suggestion",
        reference: {
          entityId: options.suggestionEntityId,
          versionId: options.suggestionVersionId ?? "1",
        },
      },
      reviewDecisionRef: {
        kind: "review-decision",
        reference: {
          entityId: options.decisionEntityId,
          versionId: options.decisionVersionId ?? "1",
        },
      },
    },
  });

const reviewAuditCounts = async (fixture: ReviewAuditPostgresFixture, projectId: string) => {
  const result = await fixture.postgres.adminPool.query<{
    tasks: string;
    decisions: string;
    rejections: string;
    businessAudit: string;
    receipts: string;
    outbox: string;
  }>(
    `SELECT
       (SELECT count(*)::text FROM business.review_tasks WHERE project_id = $1) AS tasks,
       (SELECT count(*)::text FROM business.review_decisions WHERE project_id = $1) AS decisions,
       (SELECT count(*)::text FROM audit.review_rejections WHERE project_id = $1) AS rejections,
       (SELECT count(*)::text FROM audit.entries WHERE project_id = $1) AS "businessAudit",
       (SELECT count(*)::text FROM business.command_receipts WHERE project_id = $1) AS receipts,
       (SELECT count(*)::text FROM outbox.events WHERE project_id = $1) AS outbox`,
    [projectId],
  );
  return result.rows[0]!;
};

const makeAccess = (authorization: AuthorizationContextV1) => {
  const verify = vi.fn(async () => ({
    context: authorization,
    contextRef: authorization.authorizationContextRef,
    redacted: false,
  }));
  return { verify, access: { verify } as unknown as LocalIdentityAccessV1 };
};

const adapterFor = (
  fixture: ReviewAuditPostgresFixture,
  authorization: AuthorizationContextV1,
  verify?: ReturnType<typeof vi.fn>,
) => {
  const fake = makeAccess(authorization);
  const verifier = verify ?? fake.verify;
  return {
    adapter: new PostgresReviewAuditAdapter({
      db: fixture.runtime.db,
      transactionUnit: fixture.transactionUnit,
      access: { verify: verifier } as unknown as LocalIdentityAccessV1,
      now: () => new Date("2030-01-01T00:00:01.000Z"),
    }),
    verify: verifier,
  };
};

const mutableClock = () => {
  let current = new Date(REVIEW_TEST_TIMESTAMP);
  return {
    now: () => new Date(current),
    advance(milliseconds: number) {
      current = new Date(current.getTime() + milliseconds);
    },
  };
};

describe.sequential("PostgreSQL review-audit adapter", () => {
  let fixture: ReviewAuditPostgresFixture | undefined;

  beforeAll(async () => {
    fixture = await startReviewAuditFixture();
  }, 180_000);

  afterAll(async () => {
    await fixture?.close().catch(() => undefined);
  });

  it("migration and database role privileges", async () => {
    const tables = await fixture!.postgres.adminPool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'business' AND table_name IN ('review_tasks', 'review_decisions') ORDER BY table_name",
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(["review_decisions", "review_tasks"]);
    const view = await fixture!.postgres.adminPool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.views WHERE table_schema = 'audit' AND table_name = 'review_activity_v1'",
    );
    expect(view.rows).toHaveLength(1);
    const triggerFunction = await fixture!.postgres.adminPool.query<{
      app_execute: boolean;
      public_execute: boolean;
    }>(
      "SELECT has_function_privilege('riskflow_app', 'business.reject_review_task_terminal_rewrite()', 'EXECUTE') AS app_execute, has_function_privilege('public', 'business.reject_review_task_terminal_rewrite()', 'EXECUTE') AS public_execute",
    );
    expect(triggerFunction.rows[0]).toEqual({ app_execute: false, public_execute: false });

    const appPool = new Pool(fixture!.postgres.app);
    try {
      await expect(
        appPool.query("UPDATE audit.review_rejections SET reason_code = reason_code"),
      ).rejects.toBeDefined();
      await expect(appPool.query("DELETE FROM audit.review_rejections")).rejects.toBeDefined();
      await expect(
        appPool.query("UPDATE business.review_decisions SET reason_code = reason_code"),
      ).rejects.toBeDefined();
      await expect(appPool.query("DELETE FROM business.review_decisions")).rejects.toBeDefined();
      await expect(appPool.query("UPDATE audit.entries SET action = action")).rejects.toBeDefined();
      await expect(
        appPool.query("DELETE FROM business.security_audit_events"),
      ).rejects.toBeDefined();
      await expect(
        appPool.query("UPDATE business.security_audit_events SET reason_code = reason_code"),
      ).rejects.toBeDefined();
      await expect(
        appPool.query("ALTER TABLE business.review_tasks ADD COLUMN forbidden text"),
      ).rejects.toBeDefined();
    } finally {
      await appPool.end();
    }
  });

  it("migration supports down and up", async () => {
    const migrator = createPostgresRuntime(fixture!.postgres.migrator, "riskflow_migrator");
    try {
      await reviewAuditMigration.down(migrator.db);
      await reviewAuditMigration.up(migrator.db);
    } finally {
      await migrator.close();
    }
  });

  it("request review, idempotency, and supersede", async () => {
    const authorization = authorizationFor("project-1");
    const { adapter, verify } = adapterFor(fixture!, authorization);
    const request = requestFor({ suffix: "request" });
    const first = await adapter.requestReview(request);
    expect(first.kind).toBe("succeeded");
    if (first.kind !== "succeeded") return;
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: "review-audit.request-review",
        invocationId: request.commandId,
      }),
    );
    const replay = await adapter.requestReview(request);
    expect(replay).toEqual(first);
    const count = await fixture!.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.review_tasks WHERE project_id = $1",
      [request.projectId],
    );
    expect(count.rows[0]!.count).toBe("1");
    const auditCount = await fixture!.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit.entries WHERE command_id = $1",
      [request.commandId],
    );
    const eventCount = await fixture!.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM outbox.events WHERE producer_command_id = $1",
      [request.commandId],
    );
    expect(auditCount.rows[0]!.count).toBe("1");
    expect(eventCount.rows[0]!.count).toBe("1");

    const changedPayload = ReviewRequestV1Schema.parse({
      ...request,
      payload: {
        ...request.payload,
        targetRef: target("identification-group", "group-request", "2"),
      },
    });
    const conflict = await adapter.requestReview(changedPayload);
    expect(conflict).toMatchObject({ kind: "failed", error: { code: "IDEMPOTENCY_CONFLICT" } });

    const replacement = await adapter.requestReview(
      ReviewRequestV1Schema.parse({
        ...request,
        commandId: nextId("request-replacement"),
        idempotencyKey: nextId("idempotency-replacement"),
        payload: {
          ...request.payload,
          targetRef: target("identification-group", "group-request", "2"),
        },
      }),
    );
    expect(replacement.kind).toBe("succeeded");
    const stale = await adapter.decideReview(
      decisionFor(request, first.result.reviewTaskRef, "superseded"),
    );
    expect(stale).toMatchObject({ kind: "failed", error: { code: "STALE_VERSION" } });
    const states = await fixture!.postgres.adminPool.query<{
      status: string;
      target_version_id: string;
    }>(
      "SELECT status, target_version_id FROM business.review_tasks WHERE project_id = $1 AND target_entity_id = $2 ORDER BY target_version_id",
      [request.projectId, "group-request"],
    );
    expect(states.rows).toEqual([
      { status: "superseded", target_version_id: "1" },
      { status: "pending", target_version_id: "2" },
    ]);
  });

  it("decide review, stale rejection audit, activity projection, and as of trace", async () => {
    const authorization = authorizationFor("project-1", "reviewer-1");
    const { adapter, verify } = adapterFor(fixture!, authorization);
    const request = requestFor({ suffix: "decide", authorization });
    const requested = await adapter.requestReview(request);
    expect(requested.kind).toBe("succeeded");
    if (requested.kind !== "succeeded") return;
    const taskRef = requested.result.reviewTaskRef;
    const decision = decisionFor(request, taskRef, "decide");
    const decided = await adapter.decideReview(decision);
    expect(decided.kind).toBe("succeeded");
    if (decided.kind !== "succeeded") return;
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: "review-audit.decide-review",
        invocationId: decision.commandId,
      }),
    );
    expect(await adapter.decideReview(decision)).toEqual(decided);
    const decisionAuditCount = await fixture!.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit.entries WHERE command_id = $1",
      [decision.commandId],
    );
    const decisionEventCount = await fixture!.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM outbox.events WHERE producer_command_id = $1",
      [decision.commandId],
    );
    expect(decisionAuditCount.rows[0]!.count).toBe("1");
    expect(decisionEventCount.rows[0]!.count).toBe("1");

    const appPool = new Pool(fixture!.postgres.app);
    try {
      await expect(
        appPool.query(
          "UPDATE business.review_tasks SET status = 'pending', decision_ref = NULL, decided_at = NULL WHERE review_task_id = $1",
          [taskRef.reference.entityId],
        ),
      ).rejects.toBeDefined();
    } finally {
      await appPool.end();
    }

    const staleCommand = ReviewDecisionCommandV1Schema.parse({
      ...decisionFor(request, taskRef, "stale"),
      issuedAt: "2030-01-01T00:00:00.500Z",
    });
    const stale = await adapter.decideReview(staleCommand);
    expect(stale).toMatchObject({ kind: "failed", error: { code: "STALE_VERSION" } });
    const rejection = await fixture!.postgres.adminPool.query<{ occurred_at: Date }>(
      "SELECT occurred_at FROM audit.review_rejections WHERE project_id = $1 AND command_id = $2",
      [request.projectId, staleCommand.commandId],
    );
    expect(rejection.rows[0]!.occurred_at.toISOString()).toBe(staleCommand.issuedAt);

    const trace = await adapter.trace({
      queryId: nextId("trace"),
      projectId: request.projectId,
      actorId: request.actorId,
      requestedAt: REVIEW_TEST_TIMESTAMP,
      authorization,
      kind: "trace",
      payload: {
        subjectRef: taskRef,
        asOfRecordedAt: "2030-01-01T00:00:01.000Z",
        includeEvidenceSummary: true,
      },
    });
    expect(trace.kind).toBe("succeeded");
    if (trace.kind === "succeeded") {
      expect("auditTrailRef" in trace.result).toBe(true);
      expect(JSON.stringify(trace)).not.toContain("candidate正文");
    }
    const activity = await fixture!.postgres.adminPool.query<{
      activity_code: string;
      reason_code: string | null;
      review_task_ref: unknown;
      target_ref: unknown;
      review_decision_ref: unknown;
      waiting_run_ref: unknown;
      validation_snapshot_ref: unknown;
      evidence_snapshot_ref: unknown;
      review_policy_ref: unknown;
    }>(
      "SELECT activity_code, reason_code, review_task_ref, target_ref, review_decision_ref, waiting_run_ref, validation_snapshot_ref, evidence_snapshot_ref, review_policy_ref FROM audit.review_activity_v1 WHERE project_id = $1 AND review_task_ref -> 'reference' ->> 'entityId' = $2 ORDER BY recorded_at",
      [request.projectId, taskRef.reference.entityId],
    );
    const decidedActivity = activity.rows.find((row) => row.activity_code === "review.decided");
    expect(decidedActivity).toMatchObject({
      reason_code: "reviewed",
      review_task_ref: taskRef,
      target_ref: request.payload.targetRef,
      waiting_run_ref: request.payload.waitingRunRef,
      validation_snapshot_ref: request.payload.validationSnapshotRef,
      evidence_snapshot_ref: request.payload.evidenceSnapshotRef,
      review_policy_ref: request.payload.reviewPolicyRef,
      review_decision_ref: { kind: "review-decision" },
    });
  });

  it("verifies knowledge revision approval proof with closed outcomes and no writes", async () => {
    const projectId = "project-approval-proof";
    const authorization = authorizationFor(projectId);
    const { adapter } = adapterFor(fixture!, authorization);
    const cases = [
      {
        suffix: "approved",
        decisionKind: "approve-publication" as const,
        expected: "approved" as const,
      },
      {
        suffix: "rejected",
        decisionKind: "reject" as const,
        expected: "decision-not-approval" as const,
      },
      {
        suffix: "returned",
        decisionKind: "return-for-revision" as const,
        expected: "decision-not-approval" as const,
      },
      {
        suffix: "target-mismatch",
        decisionKind: "approve-publication" as const,
        expected: "target-mismatch" as const,
      },
    ];
    const decidedCases: Array<{
      readonly suffix: string;
      readonly expected: (typeof cases)[number]["expected"];
      readonly taskRef: ReviewTaskRefV1;
      readonly decisionRef: {
        kind: "review-decision";
        reference: { entityId: string; versionId: string };
      };
    }> = [];

    for (const testCase of cases) {
      const request = requestFor({
        suffix: `approval-${testCase.suffix}`,
        projectId,
        reviewType: "knowledge-revision",
        targetEntityId: `revision-${testCase.suffix}`,
        authorization,
      });
      const requested = await adapter.requestReview(request);
      expect(requested.kind).toBe("succeeded");
      if (requested.kind !== "succeeded") return;
      const decided = await adapter.decideReview(
        decisionFor(request, requested.result.reviewTaskRef, `approval-${testCase.suffix}`, {
          knowledgeDecisionKind: testCase.decisionKind,
        }),
      );
      expect(decided.kind).toBe("succeeded");
      if (decided.kind !== "succeeded") return;
      decidedCases.push({
        suffix: testCase.suffix,
        expected: testCase.expected,
        taskRef: requested.result.reviewTaskRef,
        decisionRef: decided.result.reviewDecisionRef,
      });
    }

    const inconsistentRequest = requestFor({
      suffix: "approval-inconsistent",
      projectId,
      reviewType: "knowledge-revision",
      targetEntityId: "revision-inconsistent",
      authorization,
    });
    const inconsistentTask = await adapter.requestReview(inconsistentRequest);
    expect(inconsistentTask.kind).toBe("succeeded");
    if (inconsistentTask.kind !== "succeeded") return;
    const inconsistentDecisionRef = {
      kind: "review-decision" as const,
      reference: { entityId: "approval-inconsistent-decision", versionId: "1" },
    };
    await fixture!.postgres.adminPool.query(
      `INSERT INTO business.review_decisions
        (review_decision_id, version_id, review_task_id, review_decision_ref, project_id,
         review_type, review_task_ref, target_ref, decision, reason_code,
         validation_snapshot_ref, evidence_snapshot_ref, waiting_run_ref, review_policy_ref,
         actor_ref, authorization_context_ref, decided_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        inconsistentDecisionRef.reference.entityId,
        inconsistentDecisionRef.reference.versionId,
        inconsistentTask.result.reviewTaskRef.reference.entityId,
        inconsistentDecisionRef,
        projectId,
        "knowledge-revision",
        inconsistentTask.result.reviewTaskRef,
        inconsistentRequest.payload.targetRef,
        { reviewType: "knowledge-revision", kind: "approve-publication" },
        "reviewed",
        inconsistentRequest.payload.validationSnapshotRef,
        inconsistentRequest.payload.evidenceSnapshotRef,
        inconsistentRequest.payload.waitingRunRef,
        inconsistentRequest.payload.reviewPolicyRef,
        "inconsistent-actor",
        authorization.authorizationContextRef,
        REVIEW_TEST_TIMESTAMP,
      ],
    );

    const before = await reviewAuditCounts(fixture!, projectId);
    for (const testCase of decidedCases) {
      const result = await adapter.verifyKnowledgeRevisionApproval(
        approvalQueryFor({
          suffix: `approval-${testCase.suffix}`,
          projectId,
          authorization,
          revisionEntityId:
            testCase.expected === "target-mismatch"
              ? "revision-other"
              : `revision-${testCase.suffix}`,
          decisionEntityId: testCase.decisionRef.reference.entityId,
        }),
      );
      if (testCase.expected === "approved") {
        expect(result).toMatchObject({
          kind: "succeeded",
          result: {
            kind: "approved",
            revisionRef: {
              kind: "knowledge-revision",
              reference: { entityId: "revision-approved", versionId: "1" },
            },
            reviewTaskRef: testCase.taskRef,
            reviewDecisionRef: testCase.decisionRef,
            decidedAt: expect.any(String),
          },
        });
        expect(result).not.toHaveProperty("result.decision");
        expect(result).not.toHaveProperty("result.reasonCode");
      } else {
        expect(result).toMatchObject({
          kind: "succeeded",
          result: { kind: "not-approved", reason: testCase.expected },
        });
      }
    }

    const missing = await adapter.verifyKnowledgeRevisionApproval(
      approvalQueryFor({
        suffix: "approval-missing",
        projectId,
        authorization,
        revisionEntityId: "revision-approved",
        decisionEntityId: "approval-missing-decision",
      }),
    );
    expect(missing).toEqual({
      kind: "succeeded",
      result: { kind: "not-approved", reason: "decision-not-found" },
    });

    const projectTwo = "project-approval-proof-two";
    const projectTwoAuthorization = authorizationFor(projectTwo);
    const projectTwoAdapter = adapterFor(fixture!, projectTwoAuthorization).adapter;
    const projectTwoRequest = requestFor({
      suffix: "approval-project-two",
      projectId: projectTwo,
      reviewType: "knowledge-revision",
      targetEntityId: "revision-project-two",
      authorization: projectTwoAuthorization,
    });
    const projectTwoTask = await projectTwoAdapter.requestReview(projectTwoRequest);
    expect(projectTwoTask.kind).toBe("succeeded");
    if (projectTwoTask.kind !== "succeeded") return;
    const projectTwoDecision = await projectTwoAdapter.decideReview(
      decisionFor(projectTwoRequest, projectTwoTask.result.reviewTaskRef, "approval-project-two"),
    );
    expect(projectTwoDecision.kind).toBe("succeeded");
    if (projectTwoDecision.kind !== "succeeded") return;
    const crossProject = await adapter.verifyKnowledgeRevisionApproval(
      approvalQueryFor({
        suffix: "approval-cross-project",
        projectId,
        authorization,
        revisionEntityId: "revision-project-two",
        decisionEntityId: projectTwoDecision.result.reviewDecisionRef.reference.entityId,
      }),
    );
    expect(crossProject).toEqual(missing);

    const inconsistent = await adapter.verifyKnowledgeRevisionApproval(
      approvalQueryFor({
        suffix: "approval-inconsistent",
        projectId,
        authorization,
        revisionEntityId: "revision-inconsistent",
        decisionEntityId: inconsistentDecisionRef.reference.entityId,
      }),
    );
    expect(inconsistent).toMatchObject({
      kind: "failed",
      error: { code: "TERMINAL_FAILURE" },
    });
    expect(await reviewAuditCounts(fixture!, projectId)).toEqual(before);
  });

  it("verifies calibration suggestion approval proof with closed outcomes and no writes", async () => {
    const projectId = "project-calibration-approval-proof";
    const authorization = authorizationFor(projectId);
    const { adapter } = adapterFor(fixture!, authorization);
    const cases = [
      {
        suffix: "approved",
        decisionKind: "approve-draft-creation" as const,
        expected: "approved-for-draft" as const,
      },
      {
        suffix: "rejected",
        decisionKind: "reject" as const,
        expected: "rejected" as const,
      },
      {
        suffix: "returned",
        decisionKind: "return-for-revision" as const,
        expected: "returned-for-revision" as const,
      },
      {
        suffix: "target-mismatch",
        decisionKind: "approve-draft-creation" as const,
        expected: "target-mismatch" as const,
      },
    ];
    const decidedCases: Array<{
      readonly suffix: string;
      readonly expected: (typeof cases)[number]["expected"];
      readonly taskRef: ReviewTaskRefV1;
      readonly decisionRef: {
        kind: "review-decision";
        reference: { entityId: string; versionId: string };
      };
    }> = [];

    for (const testCase of cases) {
      const request = requestFor({
        suffix: `calibration-${testCase.suffix}`,
        projectId,
        reviewType: "calibration-suggestion",
        targetEntityId: `suggestion-${testCase.suffix}`,
        authorization,
      });
      const requested = await adapter.requestReview(request);
      expect(requested.kind).toBe("succeeded");
      if (requested.kind !== "succeeded") return;
      const decided = await adapter.decideReview(
        decisionFor(request, requested.result.reviewTaskRef, `calibration-${testCase.suffix}`, {
          calibrationDecisionKind: testCase.decisionKind,
        }),
      );
      expect(decided.kind).toBe("succeeded");
      if (decided.kind !== "succeeded") return;
      decidedCases.push({
        suffix: testCase.suffix,
        expected: testCase.expected,
        taskRef: requested.result.reviewTaskRef,
        decisionRef: decided.result.reviewDecisionRef,
      });
    }

    // 任务决定事实违反既有状态约束（保存的决定引用与查询决定不一致）时必须技术失败关闭。
    const inconsistentRequest = requestFor({
      suffix: "calibration-inconsistent",
      projectId,
      reviewType: "calibration-suggestion",
      targetEntityId: "suggestion-inconsistent",
      authorization,
    });
    const inconsistentTask = await adapter.requestReview(inconsistentRequest);
    expect(inconsistentTask.kind).toBe("succeeded");
    if (inconsistentTask.kind !== "succeeded") return;
    const inconsistentDecisionRef = {
      kind: "review-decision" as const,
      reference: { entityId: "calibration-inconsistent-decision", versionId: "1" },
    };
    await fixture!.postgres.adminPool.query(
      `INSERT INTO business.review_decisions
        (review_decision_id, version_id, review_task_id, review_decision_ref, project_id,
         review_type, review_task_ref, target_ref, decision, reason_code,
         validation_snapshot_ref, evidence_snapshot_ref, waiting_run_ref, review_policy_ref,
         actor_ref, authorization_context_ref, decided_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        inconsistentDecisionRef.reference.entityId,
        inconsistentDecisionRef.reference.versionId,
        inconsistentTask.result.reviewTaskRef.reference.entityId,
        inconsistentDecisionRef,
        projectId,
        "calibration-suggestion",
        inconsistentTask.result.reviewTaskRef,
        inconsistentRequest.payload.targetRef,
        { reviewType: "calibration-suggestion", kind: "approve-draft-creation" },
        "reviewed",
        inconsistentRequest.payload.validationSnapshotRef,
        inconsistentRequest.payload.evidenceSnapshotRef,
        inconsistentRequest.payload.waitingRunRef,
        inconsistentRequest.payload.reviewPolicyRef,
        "inconsistent-actor",
        authorization.authorizationContextRef,
        REVIEW_TEST_TIMESTAMP,
      ],
    );

    const before = await reviewAuditCounts(fixture!, projectId);
    for (const testCase of decidedCases) {
      const result = await adapter.verifyCalibrationSuggestionApproval(
        calibrationApprovalQueryFor({
          suffix: `calibration-${testCase.suffix}`,
          projectId,
          authorization,
          suggestionEntityId:
            testCase.expected === "target-mismatch"
              ? "suggestion-other"
              : `suggestion-${testCase.suffix}`,
          decisionEntityId: testCase.decisionRef.reference.entityId,
        }),
      );
      if (testCase.expected !== "target-mismatch") {
        expect(result, JSON.stringify(result)).toMatchObject({
          kind: "succeeded",
          result: {
            kind: testCase.expected,
            calibrationSuggestionRef: {
              kind: "calibration-suggestion",
              reference: { entityId: `suggestion-${testCase.suffix}`, versionId: "1" },
            },
            reviewTaskRef: testCase.taskRef,
            reviewDecisionRef: testCase.decisionRef,
            decidedAt: expect.any(String),
          },
        });
        expect(result).not.toHaveProperty("result.decision");
        expect(result).not.toHaveProperty("result.reasonCode");
        expect(result).not.toHaveProperty("result.evidence");
      } else {
        expect(result).toMatchObject({
          kind: "succeeded",
          result: { kind: "not-approved", reason: testCase.expected },
        });
      }
    }

    const missing = await adapter.verifyCalibrationSuggestionApproval(
      calibrationApprovalQueryFor({
        suffix: "calibration-missing",
        projectId,
        authorization,
        suggestionEntityId: "suggestion-approved",
        decisionEntityId: "calibration-missing-decision",
      }),
    );
    expect(missing).toEqual({
      kind: "succeeded",
      result: { kind: "not-approved", reason: "decision-not-found" },
    });

    const projectTwo = "project-calibration-approval-proof-two";
    const projectTwoAuthorization = authorizationFor(projectTwo);
    const projectTwoAdapter = adapterFor(fixture!, projectTwoAuthorization).adapter;
    const projectTwoRequest = requestFor({
      suffix: "calibration-project-two",
      projectId: projectTwo,
      reviewType: "calibration-suggestion",
      targetEntityId: "suggestion-project-two",
      authorization: projectTwoAuthorization,
    });
    const projectTwoTask = await projectTwoAdapter.requestReview(projectTwoRequest);
    expect(projectTwoTask.kind).toBe("succeeded");
    if (projectTwoTask.kind !== "succeeded") return;
    const projectTwoDecision = await projectTwoAdapter.decideReview(
      decisionFor(
        projectTwoRequest,
        projectTwoTask.result.reviewTaskRef,
        "calibration-project-two",
      ),
    );
    expect(projectTwoDecision.kind).toBe("succeeded");
    if (projectTwoDecision.kind !== "succeeded") return;
    const crossProject = await adapter.verifyCalibrationSuggestionApproval(
      calibrationApprovalQueryFor({
        suffix: "calibration-cross-project",
        projectId,
        authorization,
        suggestionEntityId: "suggestion-project-two",
        decisionEntityId: projectTwoDecision.result.reviewDecisionRef.reference.entityId,
      }),
    );
    expect(crossProject).toEqual(missing);

    const inconsistent = await adapter.verifyCalibrationSuggestionApproval(
      calibrationApprovalQueryFor({
        suffix: "calibration-inconsistent",
        projectId,
        authorization,
        suggestionEntityId: "suggestion-inconsistent",
        decisionEntityId: inconsistentDecisionRef.reference.entityId,
      }),
    );
    expect(inconsistent).toMatchObject({
      kind: "failed",
      error: { code: "TERMINAL_FAILURE" },
    });
    expect(await reviewAuditCounts(fixture!, projectId)).toEqual(before);
  });

  it("rejects calibration approval proof before lookup for invalid or unauthorized queries", async () => {
    const projectId = "project-calibration-approval-auth";
    const authorization = authorizationFor(projectId);
    const valid = calibrationApprovalQueryFor({
      suffix: "auth",
      projectId,
      authorization,
      suggestionEntityId: "suggestion-auth",
      decisionEntityId: "decision-auth",
    });
    const denial = new AccessServiceError({
      code: "AUTHORIZATION_DENIED",
      stage: "verify",
      occurredAt: REVIEW_TEST_TIMESTAMP,
      diagnosticRef: {
        kind: "diagnostic-artifact",
        reference: { entityId: "diagnostic-calibration-approval-denied", versionId: "1" },
      },
      contextRefs: [],
      retryable: false,
      requiredCapability: "review-audit.read",
      authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
    });
    const verify = vi.fn(async () => {
      throw denial;
    });
    const { adapter, verify: verifySpy } = adapterFor(fixture!, authorization, verify);
    await fixture!.postgres.adminPool.query(
      "REVOKE SELECT ON TABLE business.review_decisions FROM riskflow_app",
    );
    try {
      expect(await adapter.verifyCalibrationSuggestionApproval(valid)).toMatchObject({
        kind: "failed",
        error: { code: "AUTHORIZATION_DENIED" },
      });
    } finally {
      await fixture!.postgres.adminPool.query(
        "GRANT SELECT ON TABLE business.review_decisions TO riskflow_app",
      );
    }
    expect(verifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: "review-audit.verify-calibration-suggestion-approval",
        invocationId: valid.queryId,
      }),
    );

    const invalidQueries = [
      { ...valid, kind: "verify-knowledge-revision-approval" },
      {
        ...valid,
        authorization: { ...valid.authorization, grantedCapabilities: ["review-audit.request"] },
      },
      { ...valid, projectId: "project-calibration-approval-auth-other" },
      { ...valid, actorId: "actor-other" },
      { ...valid, extra: true },
      {
        ...valid,
        payload: { ...valid.payload, reviewDecisionRef: { entityId: "decision-auth" } },
      },
    ] as unknown[];
    const schemaAdapter = adapterFor(fixture!, authorization).adapter;
    for (const invalid of invalidQueries) {
      expect(
        await schemaAdapter.verifyCalibrationSuggestionApproval(
          invalid as CalibrationSuggestionApprovalProofQueryV1,
        ),
      ).toMatchObject({ kind: "failed", error: { code: "UNSUPPORTED_CONTRACT" } });
    }
  });

  it("rejects approval proof before lookup for invalid or unauthorized queries", async () => {
    const projectId = "project-approval-auth";
    const authorization = authorizationFor(projectId);
    const valid = approvalQueryFor({
      suffix: "auth",
      projectId,
      authorization,
      revisionEntityId: "revision-auth",
      decisionEntityId: "decision-auth",
    });
    const denial = new AccessServiceError({
      code: "AUTHORIZATION_DENIED",
      stage: "verify",
      occurredAt: REVIEW_TEST_TIMESTAMP,
      diagnosticRef: {
        kind: "diagnostic-artifact",
        reference: { entityId: "diagnostic-approval-denied", versionId: "1" },
      },
      contextRefs: [],
      retryable: false,
      requiredCapability: "review-audit.read",
      authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
    });
    const verify = vi.fn(async () => {
      throw denial;
    });
    const { adapter, verify: verifySpy } = adapterFor(fixture!, authorization, verify);
    await fixture!.postgres.adminPool.query(
      "REVOKE SELECT ON TABLE business.review_decisions FROM riskflow_app",
    );
    try {
      expect(await adapter.verifyKnowledgeRevisionApproval(valid)).toMatchObject({
        kind: "failed",
        error: { code: "AUTHORIZATION_DENIED" },
      });
    } finally {
      await fixture!.postgres.adminPool.query(
        "GRANT SELECT ON TABLE business.review_decisions TO riskflow_app",
      );
    }
    expect(verifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: "review-audit.verify-knowledge-revision-approval",
        invocationId: valid.queryId,
      }),
    );

    const invalidQueries = [
      { ...valid, kind: "trace" },
      {
        ...valid,
        authorization: { ...valid.authorization, grantedCapabilities: ["review-audit.request"] },
      },
      { ...valid, projectId: "project-approval-auth-other" },
      { ...valid, actorId: "actor-other" },
      { ...valid, extra: true },
    ] as unknown[];
    const schemaAdapter = adapterFor(fixture!, authorization).adapter;
    for (const invalid of invalidQueries) {
      expect(
        await schemaAdapter.verifyKnowledgeRevisionApproval(
          invalid as KnowledgeRevisionApprovalProofQueryV1,
        ),
      ).toMatchObject({ kind: "failed", error: { code: "UNSUPPORTED_CONTRACT" } });
    }
  });

  it("reads rule-conflict decisions for the C19 gate without writes or target leakage", async () => {
    const projectId = "project-rule-conflict-read";
    const authorization = authorizationFor(projectId);
    const { adapter } = adapterFor(fixture!, authorization);
    const request = requestFor({
      suffix: "rule-conflict-read",
      projectId,
      reviewType: "rule-conflict",
      targetEntityId: "rule-conflict-target",
      authorization,
    });
    const relationRef = request.payload.targetRef as RuleConflictRefV1;
    const requested = await adapter.requestReview(request);
    expect(requested.kind).toBe("succeeded");
    if (requested.kind !== "succeeded") return;
    const taskRef = requested.result.reviewTaskRef;
    const readInput = {
      projectId,
      relationRef,
      reviewTaskRef: taskRef,
      authorization,
      invocationId: "rc-read-invocation",
      requestedAt: REVIEW_TEST_TIMESTAMP,
    };

    expect(await adapter.readRuleConflictDecision(readInput)).toEqual({ kind: "pending" });

    const decided = await adapter.decideReview(decisionFor(request, taskRef, "rule-conflict-read"));
    expect(decided.kind).toBe("succeeded");
    if (decided.kind !== "succeeded") return;
    const before = await reviewAuditCounts(fixture!, projectId);

    expect(await adapter.readRuleConflictDecision(readInput)).toEqual({
      kind: "decided",
      decision: "approve-publication",
      reviewDecisionRef: decided.result.reviewDecisionRef,
      decidedAt: "2030-01-01T00:00:01.000Z",
    });

    const mismatches: ReadonlyArray<typeof readInput> = [
      {
        ...readInput,
        relationRef: {
          kind: "rule-conflict",
          reference: { entityId: "rule-conflict-other", versionId: "1" },
        },
      },
      {
        ...readInput,
        relationRef: {
          kind: "rule-conflict",
          reference: { entityId: "rule-conflict-target", versionId: "2" },
        },
      },
      {
        ...readInput,
        reviewTaskRef: {
          ...taskRef,
          reference: { entityId: "review-task-unknown", versionId: "1" },
        },
      },
    ];
    for (const mismatch of mismatches) {
      const result = await adapter.readRuleConflictDecision(mismatch);
      expect(result).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
      expect(JSON.stringify(result)).not.toContain(taskRef.reference.entityId);
      expect(JSON.stringify(result)).not.toContain("rule-conflict-target");
    }

    const denial = new AccessServiceError({
      code: "AUTHORIZATION_DENIED",
      stage: "verify",
      occurredAt: REVIEW_TEST_TIMESTAMP,
      diagnosticRef: {
        kind: "diagnostic-artifact",
        reference: { entityId: "diagnostic-rule-conflict-read-denied", versionId: "1" },
      },
      contextRefs: [],
      retryable: false,
      requiredCapability: "review-audit.read",
      authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
    });
    const denyVerify = vi.fn(async () => {
      throw denial;
    });
    const { adapter: deniedAdapter, verify: deniedVerify } = adapterFor(
      fixture!,
      authorization,
      denyVerify,
    );
    const denied = await deniedAdapter.readRuleConflictDecision(readInput);
    expect(denied).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    expect(deniedVerify).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: "review-audit.trace",
        invocationId: readInput.invocationId,
      }),
    );
    expect(JSON.stringify(denied)).not.toContain(taskRef.reference.entityId);
    expect(JSON.stringify(denied)).not.toContain("rule-conflict-target");

    expect(await reviewAuditCounts(fixture!, projectId)).toEqual(before);
  });

  it("reads identification-group decisions for the C22 acceptance path without writes or target leakage", async () => {
    const projectId = "project-group-decision-read";
    const authorization = authorizationFor(projectId);
    const { adapter } = adapterFor(fixture!, authorization);
    const request = requestFor({ suffix: "group-decision", projectId, authorization });
    const groupRef = request.payload.targetRef as IdentificationGroupRefV1;
    const requested = await adapter.requestReview(request);
    expect(requested.kind).toBe("succeeded");
    if (requested.kind !== "succeeded") return;
    const taskRef = requested.result.reviewTaskRef;
    const readInput = {
      projectId,
      groupRef,
      reviewTaskRef: taskRef,
      authorization,
      invocationId: "group-decision-read-invocation",
      requestedAt: REVIEW_TEST_TIMESTAMP,
    };

    // 未裁决不给出决定。
    expect(await adapter.readIdentificationGroupDecision(readInput)).toEqual({ kind: "pending" });

    // 同目标重新发起使旧任务 superseded；陈旧任务必须稳定阻断，不得伪装成可继续等待的 pending。
    const supersedingRequest = requestFor({
      suffix: "group-decision",
      projectId,
      authorization,
      targetEntityId: groupRef.reference.entityId,
      targetVersionId: "2",
      commandId: nextId("request-group-decision-superseding"),
      idempotencyKey: nextId("idempotency-group-decision-superseding"),
    });
    const superseding = await adapter.requestReview(supersedingRequest);
    expect(superseding.kind).toBe("succeeded");
    if (superseding.kind !== "succeeded") return;
    const supersedingTaskRef = superseding.result.reviewTaskRef;
    const supersedingRead = {
      ...readInput,
      groupRef: supersedingRequest.payload.targetRef as IdentificationGroupRefV1,
      reviewTaskRef: supersedingTaskRef,
    };
    expect(await adapter.readIdentificationGroupDecision(readInput)).toEqual({
      kind: "blocked",
      detailCode: "review-task-stale",
    });
    expect(await adapter.readIdentificationGroupDecision(supersedingRead)).toEqual({
      kind: "pending",
    });

    // 裁决后按当前事实返回决定种类与决定引用。
    const decided = await adapter.decideReview(
      decisionFor(supersedingRequest, supersedingTaskRef, "group-decision"),
    );
    expect(decided.kind).toBe("succeeded");
    if (decided.kind !== "succeeded") return;
    expect(await adapter.readIdentificationGroupDecision(supersedingRead)).toEqual({
      kind: "decided",
      decisionKind: "approve-unchanged",
      reviewDecisionRef: decided.result.reviewDecisionRef,
      decidedAt: "2030-01-01T00:00:01.000Z",
    });

    // 修订候选决定必须带回修订后的候选集引用。
    const revisedRequest = requestFor({
      suffix: "group-decision-revised",
      projectId,
      authorization,
    });
    const revised = await adapter.requestReview(revisedRequest);
    expect(revised.kind).toBe("succeeded");
    if (revised.kind !== "succeeded") return;
    const revisedTaskRef = revised.result.reviewTaskRef;
    const revisedCandidateRef = {
      kind: "identification-candidate-set" as const,
      reference: { entityId: "candidate-set-revised", versionId: "1" },
    };
    const revisedCommand = decisionFor(revisedRequest, revisedTaskRef, "group-decision-revised");
    const decidedRevised = await adapter.decideReview(
      ReviewDecisionCommandV1Schema.parse({
        ...revisedCommand,
        payload: {
          ...revisedCommand.payload,
          decision: {
            reviewType: "identification-group",
            kind: "approve-revised-candidate",
            revisedCandidateRef,
          },
        },
      }),
    );
    expect(decidedRevised.kind).toBe("succeeded");
    if (decidedRevised.kind !== "succeeded") return;
    expect(
      await adapter.readIdentificationGroupDecision({
        ...supersedingRead,
        groupRef: revisedRequest.payload.targetRef as IdentificationGroupRefV1,
        reviewTaskRef: revisedTaskRef,
      }),
    ).toEqual({
      kind: "decided",
      decisionKind: "approve-revised-candidate",
      reviewDecisionRef: decidedRevised.result.reviewDecisionRef,
      revisedCandidateSetRef: revisedCandidateRef,
      decidedAt: "2030-01-01T00:00:01.000Z",
    });

    // 事实不符：目标引用或任务引用对不上时封闭拒绝，且不泄漏目标与任务身份。
    for (const mismatch of [
      {
        ...supersedingRead,
        groupRef: {
          ...groupRef,
          reference: { ...groupRef.reference, entityId: "group-decided-other" },
        },
      },
      {
        ...supersedingRead,
        groupRef: { ...groupRef, reference: { ...groupRef.reference, versionId: "3" } },
      },
    ] as ReadonlyArray<typeof supersedingRead>) {
      const rejected = await adapter.readIdentificationGroupDecision(mismatch);
      expect(rejected).toEqual({ kind: "blocked", detailCode: "review-task-fact-mismatch" });
      expect(JSON.stringify(rejected)).not.toContain(taskRef.reference.entityId);
      expect(JSON.stringify(rejected)).not.toContain(groupRef.reference.entityId);
    }

    // 任务不存在与跨工程引用必须不可区分，二者都不泄露任务是否存在。
    const otherProjectId = "project-group-decision-other";
    const otherAuthorization = authorizationFor(otherProjectId);
    const absent = await adapter.readIdentificationGroupDecision({
      ...supersedingRead,
      reviewTaskRef: {
        ...supersedingTaskRef,
        reference: { entityId: "review-task-unknown", versionId: "1" },
      },
    });
    const foreignProject = await adapterFor(
      fixture!,
      otherAuthorization,
    ).adapter.readIdentificationGroupDecision({
      ...supersedingRead,
      projectId: otherProjectId,
      authorization: otherAuthorization,
    });
    expect(absent).toEqual({ kind: "blocked", detailCode: "review-task-not-found" });
    expect(foreignProject).toEqual(absent);

    const denial = new AccessServiceError({
      code: "AUTHORIZATION_DENIED",
      stage: "verify",
      occurredAt: REVIEW_TEST_TIMESTAMP,
      diagnosticRef: {
        kind: "diagnostic-artifact",
        reference: { entityId: "diagnostic-group-decision-read-denied", versionId: "1" },
      },
      contextRefs: [],
      retryable: false,
      requiredCapability: "review-audit.read",
      authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
    });
    const denyVerify = vi.fn(async () => {
      throw denial;
    });
    const denied = await adapterFor(
      fixture!,
      authorization,
      denyVerify,
    ).adapter.readIdentificationGroupDecision(supersedingRead);
    expect(denied).toEqual({ kind: "blocked", detailCode: "review-decision-not-authorized" });
    expect(denyVerify).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: "review-audit.trace",
        invocationId: readInput.invocationId,
      }),
    );
    expect(JSON.stringify(denied)).not.toContain(groupRef.reference.entityId);

    // 只读路径：读取前后任务、决定、审计、回执与事件计数完全一致。
    const before = await reviewAuditCounts(fixture!, projectId);
    expect(await adapter.readIdentificationGroupDecision(supersedingRead)).toMatchObject({
      kind: "decided",
    });
    expect(await reviewAuditCounts(fixture!, projectId)).toEqual(before);
  });

  it("concurrent decisions and independent multiple decisions with partial failure", async () => {
    const authorization = authorizationFor("project-1", "reviewer-2");
    const { adapter } = adapterFor(fixture!, authorization);
    const request = requestFor({ suffix: "concurrent", authorization });
    const requested = await adapter.requestReview(request);
    expect(requested.kind).toBe("succeeded");
    if (requested.kind !== "succeeded") return;
    const commandA = decisionFor(request, requested.result.reviewTaskRef, "concurrent-a");
    const commandB = decisionFor(request, requested.result.reviewTaskRef, "concurrent-b");
    const results = await Promise.all([
      adapter.decideReview(commandA),
      adapter.decideReview(commandB),
    ]);
    expect(results.filter((result) => result.kind === "succeeded")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "failed")).toHaveLength(1);

    const requestA = requestFor({ suffix: "multiple-a", authorization });
    const requestB = requestFor({ suffix: "multiple-b", authorization });
    const [requestedA, requestedB] = await Promise.all([
      adapter.requestReview(requestA),
      adapter.requestReview(requestB),
    ]);
    expect(requestedA.kind).toBe("succeeded");
    expect(requestedB.kind).toBe("succeeded");
    if (requestedA.kind !== "succeeded" || requestedB.kind !== "succeeded") return;
    const [resultA, resultB, conflictA] = await Promise.all([
      adapter.decideReview(decisionFor(requestA, requestedA.result.reviewTaskRef, "multiple-a")),
      adapter.decideReview(decisionFor(requestB, requestedB.result.reviewTaskRef, "multiple-b")),
      adapter.decideReview(
        decisionFor(requestA, requestedA.result.reviewTaskRef, "multiple-a-conflict"),
      ),
    ]);
    expect(resultB.kind).toBe("succeeded");
    expect([resultA, conflictA].filter((result) => result.kind === "succeeded")).toHaveLength(1);
    expect([resultA, conflictA].filter((result) => result.kind === "failed")).toHaveLength(1);
  });

  it("rolls back request on audit failure and outbox failure", async () => {
    const authorization = authorizationFor("project-1");
    const { adapter } = adapterFor(fixture!, authorization);
    const auditRequest = requestFor({ suffix: "audit-rollback", authorization });
    await fixture!.postgres.adminPool.query(
      "REVOKE INSERT ON TABLE audit.entries FROM riskflow_app",
    );
    try {
      expect(await adapter.requestReview(auditRequest)).toMatchObject({
        kind: "failed",
        error: { code: "TERMINAL_FAILURE" },
      });
    } finally {
      await fixture!.postgres.adminPool.query(
        "GRANT INSERT ON TABLE audit.entries TO riskflow_app",
      );
    }
    const absent = await fixture!.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.review_tasks WHERE target_entity_id = $1",
      ["group-audit-rollback"],
    );
    expect(absent.rows[0]!.count).toBe("0");

    const outboxRequest = requestFor({ suffix: "outbox-rollback", authorization });
    await fixture!.postgres.adminPool.query(
      "REVOKE INSERT ON TABLE outbox.events FROM riskflow_app",
    );
    try {
      expect(await adapter.requestReview(outboxRequest)).toMatchObject({
        kind: "failed",
        error: { code: "TERMINAL_FAILURE" },
      });
    } finally {
      await fixture!.postgres.adminPool.query(
        "GRANT INSERT ON TABLE outbox.events TO riskflow_app",
      );
    }
    const outboxAbsent = await fixture!.postgres.adminPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business.review_tasks WHERE target_entity_id = $1",
      [
        `group-${outboxRequest.payload.waitingRunRef.reference.entityId.replace("run-", "outbox-rollback")}`,
      ],
    );
    expect(outboxAbsent.rows[0]!.count).toBe("0");
  });

  it("denies before lookup and keeps trace project isolation", async () => {
    const authorization = authorizationFor("project-1");
    const denial = new AccessServiceError({
      code: "AUTHORIZATION_DENIED",
      stage: "verify",
      occurredAt: REVIEW_TEST_TIMESTAMP,
      diagnosticRef: {
        kind: "diagnostic-artifact",
        reference: { entityId: "diagnostic-denied", versionId: "1" },
      },
      contextRefs: [],
      retryable: false,
      requiredCapability: "review-audit.request",
      authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
    });
    const verify = vi.fn(async () => {
      throw denial;
    });
    const { adapter } = adapterFor(fixture!, authorization, verify);
    const request = requestFor({ suffix: "denied", authorization });
    expect(await adapter.requestReview(request)).toMatchObject({
      kind: "failed",
      error: { code: "AUTHORIZATION_DENIED" },
    });
    expect(verify).toHaveBeenCalledTimes(1);

    const projectTwoAuthorization = authorizationFor("project-2");
    const projectTwoAdapter = adapterFor(fixture!, projectTwoAuthorization).adapter;
    const projectTwoRequest = requestFor({
      suffix: "project-two",
      projectId: "project-2",
      authorization: projectTwoAuthorization,
    });
    const projectTwoResult = await projectTwoAdapter.requestReview(projectTwoRequest);
    expect(projectTwoResult.kind).toBe("succeeded");
    if (projectTwoResult.kind !== "succeeded") return;
    const traceAdapter = adapterFor(fixture!, authorization).adapter;
    const trace = await traceAdapter.trace({
      queryId: nextId("trace-isolation"),
      projectId: "project-1",
      actorId: authorization.actorId,
      requestedAt: REVIEW_TEST_TIMESTAMP,
      authorization,
      kind: "trace",
      payload: {
        subjectRef: projectTwoResult.result.reviewTaskRef,
        includeEvidenceSummary: false,
      },
    });
    expect(trace).toMatchObject({
      kind: "succeeded",
      result: { queryResultRef: expect.anything() },
    });
  });

  it("enforces C06 reviewer, manager, project, branch, and expiry boundaries", async () => {
    const clock = mutableClock();
    const adminPassword = "c07-admin-password-v1";
    const adminChangedPassword = "c07-admin-password-changed-v1";
    const managerPassword = "c07-manager-password-v1";
    const managerChangedPassword = "c07-manager-password-changed-v1";
    const reviewerPassword = "c07-reviewer-password-v1";
    const reviewerChangedPassword = "c07-reviewer-password-changed-v1";
    const projectId = "project-c07-auth";
    const access = createPostgresLocalIdentityAccess({
      ...fixture!.postgres.app,
      hmacKey: new Uint8Array(32).fill(7),
      keyVersion: "c07-test-key-v1",
      now: clock.now,
    });
    try {
      await bootstrapInitialSystemAdministrator({
        connection: fixture!.postgres.migrator,
        loginName: "c07admin001",
        displayName: "C07 administrator",
        password: adminPassword,
        accountId: "c07-account-admin",
        now: clock.now,
      });
      const adminLogin = await access.login({
        kind: "login",
        loginAttemptId: "c07-auth-admin-login",
        loginName: "c07admin001",
        password: adminPassword,
      });
      const adminSession = await access.changePassword({
        kind: "change-password",
        sessionToken: adminLogin.sessionToken,
        newPassword: adminChangedPassword,
      });
      const manager = await access.administerIdentity({
        kind: "create-account",
        commandId: "c07-auth-create-manager",
        idempotencyKey: "c07-auth-create-manager",
        expectedVersion: "none",
        authorizationContextRef: adminSession.systemAdministrationContextRef!,
        loginName: "c07manager001",
        displayName: "C07 manager",
        password: managerPassword,
      });
      const reviewer = await access.administerIdentity({
        kind: "create-account",
        commandId: "c07-auth-create-reviewer",
        idempotencyKey: "c07-auth-create-reviewer",
        expectedVersion: "none",
        authorizationContextRef: adminSession.systemAdministrationContextRef!,
        loginName: "c07reviewer001",
        displayName: "C07 reviewer",
        password: reviewerPassword,
      });
      const managerAccountId = manager.resultRef.entityId;
      const reviewerAccountId = reviewer.resultRef.entityId;
      await access.administerProject({
        kind: "open-project",
        projectId,
        commandId: "c07-auth-open-project",
        idempotencyKey: "c07-auth-open-project",
        expectedVersion: "none",
        authorizationContextRef: adminSession.systemAdministrationContextRef!,
        initialRiskManagerAccountId: managerAccountId,
      });
      const root = await fixture!.postgres.adminPool.query<{
        scope_id: string;
        revision_id: string;
      }>(
        "SELECT scope.scope_id, scope.current_revision_id AS revision_id FROM business.access_spatial_scopes scope WHERE scope.project_id = $1",
        [projectId],
      );
      const rootScopeRef = {
        kind: "spatial-scope" as const,
        reference: { entityId: root.rows[0]!.scope_id, versionId: root.rows[0]!.revision_id },
      };
      await access.administerProject({
        kind: "revise-membership",
        projectId,
        commandId: "c07-auth-membership-reviewer",
        idempotencyKey: "c07-auth-membership-reviewer",
        expectedVersion: "none",
        authorizationContextRef: adminSession.systemAdministrationContextRef!,
        membershipId: "c07-membership-reviewer",
        accountId: reviewerAccountId,
        roles: ["reviewer"],
        spatialScopeRefs: [rootScopeRef],
        status: "active",
      });

      const managerLogin = await access.login({
        kind: "login",
        loginAttemptId: "c07-auth-manager-login",
        loginName: "c07manager001",
        password: managerPassword,
      });
      const managerSession = await access.changePassword({
        kind: "change-password",
        sessionToken: managerLogin.sessionToken,
        newPassword: managerChangedPassword,
      });
      const reviewerLogin = await access.login({
        kind: "login",
        loginAttemptId: "c07-auth-reviewer-login",
        loginName: "c07reviewer001",
        password: reviewerPassword,
      });
      const reviewerSession = await access.changePassword({
        kind: "change-password",
        sessionToken: reviewerLogin.sessionToken,
        newPassword: reviewerChangedPassword,
      });
      const authorize = async (
        invocationId: string,
        sessionToken: string,
        branch:
          | "review-audit.request-review"
          | "review-audit.decide-review"
          | "review-audit.trace"
          | "review-audit.verify-knowledge-revision-approval",
      ) => {
        const decision = await access.authorize({
          invocation: { kind: "human-session", sessionToken },
          invocationId,
          projectId,
          branch,
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
        });
        return decision;
      };
      const managerRequestAccess = await authorize(
        "c07-auth-manager-request",
        managerSession.sessionToken,
        "review-audit.request-review",
      );
      const managerSecondRequestAccess = await authorize(
        "c07-auth-manager-request-2",
        managerSession.sessionToken,
        "review-audit.request-review",
      );
      const managerDecisionAccess = await authorize(
        "c07-auth-manager-decide",
        managerSession.sessionToken,
        "review-audit.decide-review",
      );
      const managerTraceAccess = await authorize(
        "c07-auth-manager-trace",
        managerSession.sessionToken,
        "review-audit.trace",
      );
      const managerApprovalAccess = await authorize(
        "c07-auth-manager-approval",
        managerSession.sessionToken,
        "review-audit.verify-knowledge-revision-approval",
      );
      const managerApprovalRequestAccess = await authorize(
        "c07-auth-manager-approval-request",
        managerSession.sessionToken,
        "review-audit.request-review",
      );
      const managerApprovalDecisionAccess = await authorize(
        "c07-auth-manager-approval-decision",
        managerSession.sessionToken,
        "review-audit.decide-review",
      );
      const reviewerDecisionAccess = await authorize(
        "c07-auth-reviewer-decide",
        reviewerSession.sessionToken,
        "review-audit.decide-review",
      );
      const reviewerTraceAccess = await authorize(
        "c07-auth-reviewer-trace",
        reviewerSession.sessionToken,
        "review-audit.trace",
      );
      const adapter = new PostgresReviewAuditAdapter({
        db: fixture!.runtime.db,
        transactionUnit: fixture!.transactionUnit,
        access,
        now: clock.now,
      });
      const reviewerRequest = requestFor({
        suffix: "c06-reviewer-request",
        projectId,
        commandId: "c07-auth-reviewer-decide",
        authorization: AuthorizationContextV1Schema.parse({
          ...reviewerDecisionAccess.context,
          grantedCapabilities: ["review-audit.request"],
        }),
      });
      expect(await adapter.requestReview(reviewerRequest)).toMatchObject({
        kind: "failed",
        error: { code: "AUTHORIZATION_DENIED" },
      });

      const reviewerTaskRequest = requestFor({
        suffix: "c06-reviewer-task",
        projectId,
        commandId: "c07-auth-manager-request",
        authorization: managerRequestAccess.context,
      });
      const reviewerTask = await adapter.requestReview(reviewerTaskRequest);
      expect(reviewerTask.kind).toBe("succeeded");
      if (reviewerTask.kind !== "succeeded") return;
      const reviewerDecision = decisionFor(
        reviewerTaskRequest,
        reviewerTask.result.reviewTaskRef,
        "c06-reviewer",
        {
          actorId: reviewerDecisionAccess.context.actorId,
          authorization: reviewerDecisionAccess.context,
          commandId: "c07-auth-reviewer-decide",
        },
      );
      expect(await adapter.decideReview(reviewerDecision)).toMatchObject({ kind: "succeeded" });
      const reviewerTrace = await adapter.trace({
        queryId: "c07-auth-reviewer-trace",
        projectId,
        actorId: reviewerTraceAccess.context.actorId,
        requestedAt: REVIEW_TEST_TIMESTAMP,
        authorization: reviewerTraceAccess.context,
        kind: "trace",
        payload: {
          subjectRef: reviewerTask.result.reviewTaskRef,
          includeEvidenceSummary: false,
        },
      });
      expect(reviewerTrace).toMatchObject({ kind: "succeeded" });

      const managerTaskRequest = requestFor({
        suffix: "c06-manager-task",
        projectId,
        commandId: "c07-auth-manager-request-2",
        authorization: managerSecondRequestAccess.context,
      });
      const managerTask = await adapter.requestReview(managerTaskRequest);
      expect(managerTask.kind).toBe("succeeded");
      if (managerTask.kind !== "succeeded") return;
      const managerDecision = decisionFor(
        managerTaskRequest,
        managerTask.result.reviewTaskRef,
        "c06-manager",
        {
          actorId: managerDecisionAccess.context.actorId,
          authorization: managerDecisionAccess.context,
          commandId: "c07-auth-manager-decide",
        },
      );
      expect(await adapter.decideReview(managerDecision)).toMatchObject({ kind: "succeeded" });
      const managerTrace = await adapter.trace({
        queryId: "c07-auth-manager-trace",
        projectId,
        actorId: managerTraceAccess.context.actorId,
        requestedAt: REVIEW_TEST_TIMESTAMP,
        authorization: managerTraceAccess.context,
        kind: "trace",
        payload: {
          subjectRef: managerTask.result.reviewTaskRef,
          includeEvidenceSummary: false,
        },
      });
      expect(managerTrace).toMatchObject({ kind: "succeeded" });

      const approvalRequest = requestFor({
        suffix: "c06-approval-proof",
        projectId,
        commandId: "c07-auth-manager-approval-request",
        reviewType: "knowledge-revision",
        targetEntityId: "c06-approval-revision",
        authorization: managerApprovalRequestAccess.context,
      });
      const approvalTask = await adapter.requestReview(approvalRequest);
      expect(approvalTask.kind).toBe("succeeded");
      if (approvalTask.kind !== "succeeded") return;
      const approvalDecision = await adapter.decideReview(
        decisionFor(approvalRequest, approvalTask.result.reviewTaskRef, "c06-approval-proof", {
          actorId: managerApprovalDecisionAccess.context.actorId,
          authorization: managerApprovalDecisionAccess.context,
          commandId: "c07-auth-manager-approval-decision",
        }),
      );
      expect(approvalDecision.kind).toBe("succeeded");
      if (approvalDecision.kind !== "succeeded") return;
      expect(
        await adapter.verifyKnowledgeRevisionApproval(
          approvalQueryFor({
            suffix: "c06-approval-proof",
            projectId,
            authorization: managerApprovalAccess.context,
            queryId: "c07-auth-manager-approval",
            revisionEntityId: "c06-approval-revision",
            decisionEntityId: approvalDecision.result.reviewDecisionRef.reference.entityId,
          }),
        ),
      ).toMatchObject({ kind: "succeeded", result: { kind: "approved" } });

      await expect(
        authorize(
          "c07-auth-reviewer-approval",
          reviewerSession.sessionToken,
          "review-audit.verify-knowledge-revision-approval",
        ),
      ).rejects.toBeInstanceOf(AccessServiceError);

      const forgedBranchRequest = requestFor({
        suffix: "c06-forged-branch",
        projectId,
        commandId: "c07-auth-manager-decide",
        authorization: AuthorizationContextV1Schema.parse({
          ...managerDecisionAccess.context,
          grantedCapabilities: ["review-audit.request"],
        }),
      });
      expect(await adapter.requestReview(forgedBranchRequest)).toMatchObject({
        kind: "failed",
        error: { code: "AUTHORIZATION_DENIED" },
      });
      const wrongProjectAuthorization = AuthorizationContextV1Schema.parse({
        ...managerTraceAccess.context,
        projectId: "project-c07-wrong",
      });
      expect(
        await adapter.trace({
          queryId: "c07-auth-manager-trace",
          projectId: "project-c07-wrong",
          actorId: wrongProjectAuthorization.actorId,
          requestedAt: REVIEW_TEST_TIMESTAMP,
          authorization: wrongProjectAuthorization,
          kind: "trace",
          payload: {
            subjectRef: managerTask.result.reviewTaskRef,
            includeEvidenceSummary: false,
          },
        }),
      ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
      clock.advance(10 * 60 * 1000);
      expect(
        await adapter.trace({
          queryId: "c07-auth-manager-trace",
          projectId,
          actorId: managerTraceAccess.context.actorId,
          requestedAt: REVIEW_TEST_TIMESTAMP,
          authorization: managerTraceAccess.context,
          kind: "trace",
          payload: {
            subjectRef: managerTask.result.reviewTaskRef,
            includeEvidenceSummary: false,
          },
        }),
      ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
    } finally {
      await access.close();
    }
  }, 240_000);

  it("pending identification review narrow read returns the frozen task facts", async () => {
    const authorization = authorizationFor("project-c23-read");
    const { adapter, verify } = adapterFor(fixture!, authorization);
    const request = requestFor({ suffix: "c23-pending" });
    const created = await adapter.requestReview(request);
    expect(created.kind).toBe("succeeded");
    if (created.kind !== "succeeded") return;
    const before = await reviewAuditCounts(fixture!, request.projectId);

    const read = await adapter.readPendingIdentificationReview({
      projectId: request.projectId,
      reviewTaskRef: created.result.reviewTaskRef,
      authorization,
      idempotencyKey: "c23-read-pending",
      invocationId: "c23-read-pending",
      requestedAt: REVIEW_TEST_TIMESTAMP,
    });

    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: "review-audit.decide-review",
        invocationId: "c23-read-pending",
        projectId: request.projectId,
      }),
    );
    expect(read).toEqual({
      kind: "pending",
      task: {
        reviewTaskRef: created.result.reviewTaskRef,
        groupRef: request.payload.targetRef,
        validationSnapshotRef: request.payload.validationSnapshotRef,
        evidenceSnapshotRef: request.payload.evidenceSnapshotRef,
        reviewPolicyRef: request.payload.reviewPolicyRef,
        waitingRunRef: request.payload.waitingRunRef,
      },
    });
    // 窄读只读事实：不写审计、不发事件、不产生命令回执。
    expect(await reviewAuditCounts(fixture!, request.projectId)).toEqual(before);
  }, 120_000);

  it("superseded identification tasks are stale and decided tasks only allow reconciliation", async () => {
    const authorization = authorizationFor("project-c23-stale");
    const { adapter } = adapterFor(fixture!, authorization);
    const request = requestFor({ suffix: "c23-stale" });
    const created = await adapter.requestReview(request);
    expect(created.kind).toBe("succeeded");
    if (created.kind !== "succeeded") return;

    const supersedingRequest = requestFor({ suffix: "c23-stale", targetVersionId: "2" });
    const superseding = await adapter.requestReview(supersedingRequest);
    expect(superseding.kind).toBe("succeeded");
    if (superseding.kind !== "succeeded") return;

    expect(
      await adapter.readPendingIdentificationReview({
        projectId: request.projectId,
        reviewTaskRef: created.result.reviewTaskRef,
        authorization,
        idempotencyKey: "c23-read-superseded",
        invocationId: "c23-read-superseded",
        requestedAt: REVIEW_TEST_TIMESTAMP,
      }),
    ).toEqual({ kind: "blocked", detailCode: "review-task-stale" });

    const decision = decisionFor(supersedingRequest, superseding.result.reviewTaskRef);
    const decided = await adapter.decideReview(decision);
    expect(decided.kind).toBe("succeeded");
    // 已决定任务只返回同一冻结事实，供同命令重试对账，不返回决定正文。
    const decidedRead = await adapter.readPendingIdentificationReview({
      projectId: request.projectId,
      reviewTaskRef: superseding.result.reviewTaskRef,
      authorization,
      idempotencyKey: decision.idempotencyKey,
      invocationId: decision.commandId,
      requestedAt: REVIEW_TEST_TIMESTAMP,
    });
    expect(decidedRead).toEqual({
      kind: "decided",
      task: {
        reviewTaskRef: superseding.result.reviewTaskRef,
        groupRef: supersedingRequest.payload.targetRef,
        validationSnapshotRef: supersedingRequest.payload.validationSnapshotRef,
        evidenceSnapshotRef: supersedingRequest.payload.evidenceSnapshotRef,
        reviewPolicyRef: supersedingRequest.payload.reviewPolicyRef,
        waitingRunRef: supersedingRequest.payload.waitingRunRef,
      },
    });
    expect(
      await adapter.readPendingIdentificationReview({
        projectId: request.projectId,
        reviewTaskRef: superseding.result.reviewTaskRef,
        authorization,
        idempotencyKey: "c23-read-decided-other",
        invocationId: "c23-read-decided-other",
        requestedAt: REVIEW_TEST_TIMESTAMP,
      }),
    ).toEqual({ kind: "blocked", detailCode: "review-task-stale" });
  }, 180_000);

  it("missing, mismatched, and cross-project identification tasks fold to the same closed result", async () => {
    const authorization = authorizationFor("project-c23-mismatch");
    const { adapter } = adapterFor(fixture!, authorization);
    const request = requestFor({ suffix: "c23-mismatch" });
    const created = await adapter.requestReview(request);
    expect(created.kind).toBe("succeeded");
    if (created.kind !== "succeeded") return;
    const taskRef = created.result.reviewTaskRef;

    const missing = await adapter.readPendingIdentificationReview({
      projectId: request.projectId,
      reviewTaskRef: {
        ...taskRef,
        reference: { ...taskRef.reference, versionId: "unknown-version" },
      },
      authorization,
      idempotencyKey: "c23-read-missing",
      invocationId: "c23-read-missing",
      requestedAt: REVIEW_TEST_TIMESTAMP,
    });
    const crossProject = await adapter.readPendingIdentificationReview({
      projectId: "project-c23-other",
      reviewTaskRef: taskRef,
      authorization,
      idempotencyKey: "c23-read-cross-project",
      invocationId: "c23-read-cross-project",
      requestedAt: REVIEW_TEST_TIMESTAMP,
    });
    expect(missing).toEqual({ kind: "blocked", detailCode: "review-task-not-found" });
    expect(crossProject).toEqual(missing);

    const wrongTarget = await adapter.readPendingIdentificationReview({
      projectId: request.projectId,
      reviewTaskRef: {
        ...taskRef,
        targetRef: {
          kind: "identification-group",
          reference: { entityId: "other-group", versionId: "1" },
        },
      },
      authorization,
      idempotencyKey: "c23-read-wrong-target",
      invocationId: "c23-read-wrong-target",
      requestedAt: REVIEW_TEST_TIMESTAMP,
    });
    expect(wrongTarget).toEqual({ kind: "blocked", detailCode: "review-task-fact-mismatch" });

    const foreignType = requestFor({ suffix: "c23-knowledge", reviewType: "knowledge-revision" });
    const foreignTask = await adapter.requestReview(foreignType);
    expect(foreignTask.kind).toBe("succeeded");
    if (foreignTask.kind !== "succeeded") return;
    const foreignRead = await adapter.readPendingIdentificationReview({
      projectId: foreignType.projectId,
      reviewTaskRef: foreignTask.result.reviewTaskRef,
      authorization,
      idempotencyKey: "c23-read-foreign-type",
      invocationId: "c23-read-foreign-type",
      requestedAt: REVIEW_TEST_TIMESTAMP,
    });
    expect(foreignRead).toEqual({ kind: "blocked", detailCode: "review-task-fact-mismatch" });
  }, 180_000);

  it("authorization is verified before any task fact is read", async () => {
    const authorization = authorizationFor("project-c23-denied");
    const denial = new AccessServiceError({
      code: "AUTHORIZATION_DENIED",
      stage: "verify",
      occurredAt: REVIEW_TEST_TIMESTAMP,
      diagnosticRef: {
        kind: "diagnostic-artifact",
        reference: { entityId: "diagnostic-pending-review-read-denied", versionId: "1" },
      },
      contextRefs: [],
      retryable: false,
      requiredCapability: "review-audit.decide",
      authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
    });
    const deniedVerify = vi.fn(async () => {
      throw denial;
    });
    const request = requestFor({ suffix: "c23-denied" });
    const created = await adapterFor(fixture!, authorization).adapter.requestReview(request);
    expect(created.kind).toBe("succeeded");
    if (created.kind !== "succeeded") return;
    const { adapter } = adapterFor(fixture!, authorization, deniedVerify);

    const read = await adapter.readPendingIdentificationReview({
      projectId: request.projectId,
      reviewTaskRef: created.result.reviewTaskRef,
      authorization,
      idempotencyKey: "c23-read-denied",
      invocationId: "c23-read-denied",
      requestedAt: REVIEW_TEST_TIMESTAMP,
    });

    // 授权先行使无权调用方无法区分目标存在性、版本陈旧或属于其它工程。
    expect(read).toEqual({ kind: "blocked", detailCode: "review-task-not-authorized" });
    expect(deniedVerify).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: "review-audit.decide-review",
        invocationId: "c23-read-denied",
      }),
    );
    expect(JSON.stringify(read)).not.toContain(created.result.reviewTaskRef.reference.entityId);
  }, 120_000);
});

/**
 * C35 统一复核详情与活动只读面（IP-03）：真实 PostgreSQL、真实 C07 写入路径产物。
 * 只断言稳定可观察契约——精确定位、五类决定原样返回、动作可用性只反映业务状态、
 * 多源归并顺序、固定记录时点下的续页稳定与游标绑定失败关闭，以及读取不写任何事实。
 */
describe.sequential("PostgreSQL review audit read adapter (C35)", () => {
  let fixture: ReviewAuditPostgresFixture | undefined;

  beforeAll(async () => {
    fixture = await startReviewAuditFixture();
  }, 180_000);

  afterAll(async () => {
    await fixture?.close().catch(() => undefined);
  });

  const requireFixture = (): ReviewAuditPostgresFixture => {
    if (fixture === undefined) throw new TypeError("fixture not started");
    return fixture;
  };

  const writerFor = (authorization: AuthorizationContextV1): PostgresReviewAuditAdapter =>
    new PostgresReviewAuditAdapter({
      db: requireFixture().runtime.db,
      transactionUnit: requireFixture().transactionUnit,
      access: makeAccess(authorization).access,
      now: () => new Date("2030-01-01T00:00:01.000Z"),
    });

  const readAdapterFor = (
    authorization: AuthorizationContextV1,
    verify?: ReturnType<typeof vi.fn>,
  ): PostgresReviewAuditRead =>
    new PostgresReviewAuditRead({
      db: requireFixture().runtime.db,
      authorization: { verify: verify ?? makeAccess(authorization).verify },
      now: () => new Date(REVIEW_TEST_TIMESTAMP),
    });

  const taskDetailQuery = (
    projectId: string,
    authorization: AuthorizationContextV1,
    reviewTaskRef: ReviewTaskRefV1,
  ): ReviewAuditReadQueryV1 =>
    ReviewAuditReadQueryV1Schema.parse({
      queryId: nextId("ui-task-detail"),
      projectId,
      actorId: authorization.actorId,
      requestedAt: REVIEW_TEST_TIMESTAMP,
      authorization,
      kind: "task-detail",
      payload: { reviewTaskRef },
    });

  const activityQuery = (
    projectId: string,
    authorization: AuthorizationContextV1,
    payload: Record<string, unknown> = {},
  ): ReviewAuditReadQueryV1 =>
    ReviewAuditReadQueryV1Schema.parse({
      queryId: nextId("ui-activities"),
      projectId,
      actorId: authorization.actorId,
      requestedAt: REVIEW_TEST_TIMESTAMP,
      authorization,
      kind: "activities",
      payload,
    });

  const succeededDetail = async (
    reader: PostgresReviewAuditRead,
    query: ReviewAuditReadQueryV1,
  ): Promise<ReviewTaskDetailV1> => {
    const result = await reader.read(query);
    if (result.kind !== "succeeded") throw new TypeError(`task detail read failed: ${query.kind}`);
    if (result.result.kind !== "task-detail") throw new TypeError("expected a task detail result");
    return result.result;
  };

  const succeededPage = async (
    reader: PostgresReviewAuditRead,
    query: ReviewAuditReadQueryV1,
  ): Promise<ReviewActivityPageV1> => {
    const result = await reader.read(query);
    if (result.kind !== "succeeded") throw new TypeError(`activities read failed: ${query.kind}`);
    if (result.result.kind !== "activities") throw new TypeError("expected an activities page");
    return result.result;
  };

  it("按实体加身份版本精确定位待复核任务，返回提交决定所需的引用且不复制上游正文", async () => {
    const authorization = authorizationFor("project-ui-detail");
    const request = requestFor({ suffix: "ui-pending", projectId: authorization.projectId });
    const writer = writerFor(authorization);
    const created = await writer.requestReview(request);
    expect(created.kind).toBe("succeeded");
    if (created.kind !== "succeeded") return;
    const before = await reviewAuditCounts(requireFixture(), request.projectId);

    const detail = await succeededDetail(
      readAdapterFor(authorization),
      taskDetailQuery(request.projectId, authorization, created.result.reviewTaskRef),
    );

    expect(detail).toMatchObject({
      kind: "task-detail",
      reviewTaskRef: created.result.reviewTaskRef,
      projectId: request.projectId,
      reviewType: "identification-group",
      status: "pending",
      targetRef: request.payload.targetRef,
      validationSnapshotRef: request.payload.validationSnapshotRef,
      evidenceSnapshotRef: request.payload.evidenceSnapshotRef,
      reviewPolicyRef: request.payload.reviewPolicyRef,
      waitingRunRef: request.payload.waitingRunRef,
      requestedBy: request.actorId,
      requestedAt: request.issuedAt,
    });
    // 决定正文、登记行与请求授权上下文都不在读面；详情只回送提交决定所需的引用。
    expect(detail.decision).toBeUndefined();
    expect("requestedAuthorizationContextRef" in detail).toBe(false);
    expect(await reviewAuditCounts(requireFixture(), request.projectId)).toEqual(before);
  }, 120_000);

  it("待复核任务不推断写能力，已决定与被替代任务只读并报告业务不可用", async () => {
    const authorization = authorizationFor("project-ui-status");
    const writer = writerFor(authorization);
    const pending = requestFor({ suffix: "ui-status-pending", projectId: authorization.projectId });
    const created = await writer.requestReview(pending);
    expect(created.kind).toBe("succeeded");
    if (created.kind !== "succeeded") return;
    const reader = readAdapterFor(authorization);

    // 待复核：只有读能力时不得输出"全部允许"的写动作清单。
    const pendingDetail = await succeededDetail(
      reader,
      taskDetailQuery(pending.projectId, authorization, created.result.reviewTaskRef),
    );
    expect(pendingDetail.actions).toEqual([]);

    // 五类决定按原联合返回，不归并为通用通过。
    const decided = await writer.decideReview(
      decisionFor(pending, created.result.reviewTaskRef, "ui-status-decided"),
    );
    expect(decided.kind).toBe("succeeded");
    const decidedDetail = await succeededDetail(
      reader,
      taskDetailQuery(pending.projectId, authorization, created.result.reviewTaskRef),
    );
    expect(decidedDetail.status).toBe("decided");
    expect(decidedDetail.decision).toMatchObject({
      decision: { reviewType: "identification-group", kind: "approve-unchanged" },
      reasonCode: "reviewed",
      actorRef: pending.actorId,
    });
    expect(decidedDetail.actions).toEqual([
      {
        branch: "review-audit.decide-review",
        availability: "business-unavailable",
        reasonCode: "TASK_ALREADY_DECIDED",
      },
    ]);

    // 被替代任务仍可读，但业务上不可再决定。
    // 同一等待运行与目标实体的新版本请求会取代旧任务（C07 原语义）。
    const supersededV1 = requestFor({
      suffix: "ui-status-stale",
      projectId: authorization.projectId,
      targetVersionId: "1",
    });
    const staleCreated = await writer.requestReview(supersededV1);
    expect(staleCreated.kind).toBe("succeeded");
    if (staleCreated.kind !== "succeeded") return;
    await writer.requestReview(
      requestFor({
        suffix: "ui-status-stale",
        projectId: authorization.projectId,
        targetVersionId: "2",
      }),
    );
    const staleDetail = await succeededDetail(
      reader,
      taskDetailQuery(supersededV1.projectId, authorization, staleCreated.result.reviewTaskRef),
    );
    expect(staleDetail.status).toBe("superseded");
    expect(staleDetail.actions).toEqual([
      {
        branch: "review-audit.decide-review",
        availability: "business-unavailable",
        reasonCode: "TASK_SUPERSEDED",
      },
    ]);
  }, 180_000);

  it("未知任务、错配身份版本与跨工程读取同形失败，且授权先行不触达任务事实", async () => {
    const authorization = authorizationFor("project-ui-denied");
    const request = requestFor({ suffix: "ui-denied", projectId: authorization.projectId });
    const created = await writerFor(authorization).requestReview(request);
    expect(created.kind).toBe("succeeded");
    if (created.kind !== "succeeded") return;
    const taskRef = created.result.reviewTaskRef;

    const expectClosed = (result: Awaited<ReturnType<PostgresReviewAuditRead["read"]>>): void => {
      expect(result).toMatchObject({
        kind: "failed",
        error: {
          code: "AUTHORIZATION_DENIED",
          category: "authorization",
          stageCode: "review-audit.ui-read",
          requiredCapability: "review-audit.read",
        },
      });
    };

    const reader = readAdapterFor(authorization);
    // 身份版本错配：不回落到最新版本，也不返回队列索引形态。
    expectClosed(
      await reader.read(
        taskDetailQuery(request.projectId, authorization, {
          ...taskRef,
          reference: { ...taskRef.reference, versionId: "99" },
        } as ReviewTaskRefV1),
      ),
    );
    // 跨工程：与不存在同形，不提供存在性 oracle。
    const otherProject = authorizationFor("project-ui-denied-other");
    expectClosed(
      await reader.read(taskDetailQuery("project-ui-denied-other", otherProject, taskRef)),
    );

    // 当前授权复验拒绝 → 关闭，且 verify 先于任何任务事实读取。
    const deniedVerify = vi.fn(async () => {
      throw new AccessServiceError({
        code: "AUTHORIZATION_DENIED",
        stage: "verify",
        occurredAt: REVIEW_TEST_TIMESTAMP,
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "diagnostic-ui-read-denied", versionId: "1" },
        },
        contextRefs: [],
        retryable: false,
        requiredCapability: "review-audit.read",
        authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      });
    });
    const revokedReader = readAdapterFor(authorization, deniedVerify);
    expectClosed(
      await revokedReader.read(taskDetailQuery(request.projectId, authorization, taskRef)),
    );
    expect(deniedVerify).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "review-audit.read", invocationId: expect.any(String) }),
    );

    // 冻结上下文不持复核读能力 → 同形关闭。
    const noReadCapability = {
      ...authorization,
      grantedCapabilities: ["review-audit.request", "review-audit.decide"],
    };
    expectClosed(
      await reader.read({
        queryId: nextId("ui-task-detail"),
        projectId: request.projectId,
        actorId: noReadCapability.actorId,
        requestedAt: REVIEW_TEST_TIMESTAMP,
        authorization: noReadCapability,
        kind: "task-detail",
        payload: { reviewTaskRef: taskRef },
      } as unknown as ReviewAuditReadQueryV1),
    );
  }, 180_000);

  it("多源活动按固定排序归并，只回送类型化安全参数而不导出审计 payload", async () => {
    const authorization = authorizationFor("project-ui-activities");
    const writer = writerFor(authorization);
    const request = requestFor({ suffix: "ui-activities", projectId: authorization.projectId });
    const created = await writer.requestReview(request);
    expect(created.kind).toBe("succeeded");
    if (created.kind !== "succeeded") return;
    await writer.decideReview(decisionFor(request, created.result.reviewTaskRef, "ui-activities"));
    // 同任务的新决定按原 C07 语义记为陈旧拒绝，产生带结果码的复核拒绝活动。
    await writer.decideReview(
      decisionFor(request, created.result.reviewTaskRef, "ui-activities-stale"),
    );
    const before = await reviewAuditCounts(requireFixture(), request.projectId);

    const page = await succeededPage(
      readAdapterFor(authorization),
      activityQuery(request.projectId, authorization, {
        asOfRecordedAt: "2030-01-01T00:00:01.000Z",
      }),
    );

    const codes = page.items.map((item) => item.activityCode);
    expect(codes).toContain("review.requested");
    expect(codes).toContain("review.decided");
    // 复核请求与决定各只出现一次：view 与 C03 审计不会重复呈现同一条事实。
    expect(codes.filter((code) => code === "review.requested")).toHaveLength(1);
    expect(codes.filter((code) => code === "review.decided")).toHaveLength(1);

    // 固定排序：记录时点降序，相同记录时点内全序稳定。
    const ordered = [...page.items].sort((left, right) => {
      if (left.recordedAt !== right.recordedAt) return left.recordedAt < right.recordedAt ? 1 : -1;
      if (left.sourceType !== right.sourceType) return left.sourceType < right.sourceType ? 1 : -1;
      return left.activityId < right.activityId ? 1 : -1;
    });
    expect(page.items).toEqual(ordered);

    const decidedEntry = page.items.find((item) => item.activityCode === "review.decided");
    expect(decidedEntry).toMatchObject({
      sourceType: "business-audit",
      reasonCode: "reviewed",
      reviewTaskRef: created.result.reviewTaskRef,
      targetRef: request.payload.targetRef,
      waitingRunRef: request.payload.waitingRunRef,
    });

    // 登记行只暴露允许的字段：授权上下文与审计 payload 不外泄。
    expect(JSON.stringify(page)).not.toContain(
      request.authorization.authorizationContextRef.reference.entityId,
    );
    expect(await reviewAuditCounts(requireFixture(), request.projectId)).toEqual(before);

    // 结果码筛选：只有带该结果码的来源进入本次读取。
    const rejected = await succeededPage(
      readAdapterFor(authorization),
      activityQuery(request.projectId, authorization, {
        asOfRecordedAt: "2030-01-01T00:00:01.000Z",
        resultCode: "STALE_VERSION",
      }),
    );
    expect(rejected.items.map((item) => item.sourceType)).toEqual(["review-rejection"]);
    expect(rejected.items.map((item) => item.activityCode)).toEqual(["review.decision-rejected"]);

    // 来源类型筛选：安全审计来源在本工程没有登记事实时返回空页而非失败。
    const security = await succeededPage(
      readAdapterFor(authorization),
      activityQuery(request.projectId, authorization, {
        asOfRecordedAt: "2030-01-01T00:00:01.000Z",
        sourceType: "security-audit",
      }),
    );
    expect(security.items).toEqual([]);
  }, 180_000);

  it("活动按来源与主题筛选，续页沿固定记录时点且新增活动不污染历史分页", async () => {
    const authorization = authorizationFor("project-ui-paging");
    const writer = writerFor(authorization);
    const first = requestFor({ suffix: "ui-paging-a", projectId: authorization.projectId });
    const firstCreated = await writer.requestReview(first);
    expect(firstCreated.kind).toBe("succeeded");
    if (firstCreated.kind !== "succeeded") return;
    const second = requestFor({ suffix: "ui-paging-b", projectId: authorization.projectId });
    const secondCreated = await writer.requestReview(second);
    expect(secondCreated.kind).toBe("succeeded");
    if (secondCreated.kind !== "succeeded") return;

    const reader = readAdapterFor(authorization);
    const asOfRecordedAt = "2030-01-01T00:00:01.000Z";
    const subjectFilter = { subjectRef: firstCreated.result.reviewTaskRef };
    const unfiltered = await succeededPage(
      reader,
      activityQuery(first.projectId, authorization, { asOfRecordedAt }),
    );
    const filtered = await succeededPage(
      reader,
      activityQuery(first.projectId, authorization, { ...subjectFilter, asOfRecordedAt }),
    );
    expect(filtered.items.map((item) => item.reviewTaskRef)).toEqual([
      firstCreated.result.reviewTaskRef,
    ]);
    expect(unfiltered.items.length).toBeGreaterThan(filtered.items.length);

    // 逐页取完两页，再补一个新任务；固定记录时点保证第二页内容不因新活动而改变。
    const secondPageBefore = await succeededPage(
      reader,
      activityQuery(first.projectId, authorization, {
        ...subjectFilter,
        asOfRecordedAt,
        pageSize: 1,
      }),
    );
    await writer.requestReview(
      requestFor({ suffix: "ui-paging-c", projectId: authorization.projectId }),
    );
    const secondPageAfter = await succeededPage(
      reader,
      activityQuery(first.projectId, authorization, {
        ...subjectFilter,
        asOfRecordedAt,
        pageSize: 1,
      }),
    );
    expect(secondPageAfter).toEqual(secondPageBefore);
    expect(secondPageAfter.asOfRecordedAt).toBe(asOfRecordedAt);

    // 多页有界：同一过滤下每页不超过页大小，且单来源读取行数有界。
    const paged = await succeededPage(
      reader,
      activityQuery(first.projectId, authorization, { asOfRecordedAt, pageSize: 1 }),
    );
    expect(paged.items).toHaveLength(1);
    expect(paged.nextCursor).toBeDefined();
    const continued = await succeededPage(
      reader,
      activityQuery(first.projectId, authorization, {
        asOfRecordedAt,
        pageSize: 1,
        cursor: paged.nextCursor,
      }),
    );
    expect(continued.items).toHaveLength(1);
    expect(continued.items[0]!.activityId).not.toBe(paged.items[0]!.activityId);
    expect(continued.items[0]!.recordedAt <= asOfRecordedAt).toBe(true);
  }, 240_000);

  it("伪造、错绑与跨筛选游标一律失败关闭，不静默从第一页重启", async () => {
    const authorization = authorizationFor("project-ui-cursor");
    const writer = writerFor(authorization);
    const request = requestFor({ suffix: "ui-cursor", projectId: authorization.projectId });
    const created = await writer.requestReview(request);
    expect(created.kind).toBe("succeeded");
    if (created.kind !== "succeeded") return;
    await writer.decideReview(decisionFor(request, created.result.reviewTaskRef, "ui-cursor"));
    const reader = readAdapterFor(authorization);
    const asOfRecordedAt = "2030-01-01T00:00:01.000Z";
    const page = await succeededPage(
      reader,
      activityQuery(request.projectId, authorization, { asOfRecordedAt, pageSize: 1 }),
    );
    expect(page.nextCursor).toBeDefined();
    const cursor = page.nextCursor!;

    const expectClosed = async (payload: Record<string, unknown>): Promise<void> => {
      const result = await reader.read(activityQuery(request.projectId, authorization, payload));
      expect(result).toMatchObject({
        kind: "failed",
        error: { code: "AUTHORIZATION_DENIED", category: "authorization" },
      });
    };

    // 伪造游标。
    await expectClosed({ asOfRecordedAt, pageSize: 1, cursor: "not-a-cursor" });
    // 篡改排序键：绑定摘要不匹配。
    const forged = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<
      string,
      string
    >;
    await expectClosed({
      asOfRecordedAt,
      pageSize: 1,
      cursor: Buffer.from(JSON.stringify({ ...forged, keyA: "1999-01-01T00:00:00.000Z" })).toString(
        "base64url",
      ),
    });
    // 同一游标换筛选条件：不得跨筛选复用。
    await expectClosed({
      asOfRecordedAt,
      pageSize: 1,
      cursor,
      sourceType: "security-audit",
    });
    // 同一游标换页大小：切分改变即失效。
    await expectClosed({ asOfRecordedAt, pageSize: 2, cursor });
    // 换记录时点：历史边界不可改写。
    await expectClosed({ asOfRecordedAt: "2030-01-01T00:00:02.000Z", pageSize: 1, cursor });
  }, 180_000);

  /**
   * IP-05/IP-16 C07 检查点引用证明（D-21）：等待中与已决定任务都按原 invocationId、当前
   * 单能力 `review-audit.read` 完整授权与精确 parentRunRef 证明，且只读任务行不读决定正文。
   * 错版本、任务元数据、等待运行、父运行、工程、原主体与能力都证明不了；脱敏、上下文收窄
   * 与撤权同理。宿主把技术/权限异常收为 false，因此证明本身零审计、回执、工件、访问与事件。
   */
  it("proves the exact review task checkpoint reference without decisions or writes", async () => {
    type CheckpointInput = Parameters<PostgresReviewAuditRead["verifyCheckpointReference"]>[0];
    const authorization = authorizationFor("project-ui-checkpoint");
    const writer = writerFor(authorization);
    const request = requestFor({ suffix: "ui-checkpoint", projectId: authorization.projectId });
    const created = await writer.requestReview(request);
    expect(created.kind).toBe("succeeded");
    if (created.kind !== "succeeded") return;
    const taskRef = created.result.reviewTaskRef;

    // 读者只持单能力复核读上下文；写侧授权不变，读权不等于写权。
    const readerAuthorization = AuthorizationContextV1Schema.parse({
      ...authorization,
      authorizationContextRef: {
        kind: "authorization-context",
        reference: { entityId: `authorization-${authorization.projectId}-read`, versionId: "1" },
      },
      grantedCapabilities: ["review-audit.read"],
      spatialScopeRefs: [
        { kind: "spatial-scope", reference: { entityId: "scope-ui", versionId: "1" } },
      ],
      sourceAccessGrantRefs: [
        { kind: "source-access-grant", reference: { entityId: "grant-ui", versionId: "1" } },
      ],
    });
    const checkpointInput = (
      invocationId: string,
      overrides: Partial<CheckpointInput> = {},
    ): CheckpointInput => ({
      projectId: authorization.projectId,
      actorId: authorization.actorId,
      invocationId,
      requestedAt: REVIEW_TEST_TIMESTAMP,
      authorization: readerAuthorization,
      taskRef,
      parentRunRef: taskRef.waitingRunRef,
      ...overrides,
    });
    /** 宿主收口：证明抛出的技术/权限异常一律不算通过，其余按返回的 boolean 判定。 */
    const proves = async (
      reader: PostgresReviewAuditRead,
      input: CheckpointInput,
    ): Promise<boolean> => reader.verifyCheckpointReference(input).catch(() => false);

    const beforePending = await reviewAuditCounts(requireFixture(), request.projectId);
    const artifactFacts = async () =>
      (
        await requireFixture().postgres.adminPool.query<{ manifests: string; accesses: string }>(
          `SELECT (SELECT count(*) FROM business.artifact_manifests)::text AS manifests,
                  (SELECT count(*) FROM business.artifact_access_records)::text AS accesses`,
        )
      ).rows[0];
    const artifactsBefore = await artifactFacts();
    const reader = readAdapterFor(readerAuthorization);

    // 等待中任务可证明；决定后同一任务引用仍可证明历史身份，状态更新不改身份版本。
    expect(await reader.verifyCheckpointReference(checkpointInput("ui-checkpoint-pending"))).toBe(
      true,
    );
    expect(await reviewAuditCounts(requireFixture(), request.projectId)).toEqual(beforePending);
    const decided = await writer.decideReview(decisionFor(request, taskRef, "ui-checkpoint"));
    expect(decided.kind).toBe("succeeded");
    expect(await reader.verifyCheckpointReference(checkpointInput("ui-checkpoint-decided"))).toBe(
      true,
    );
    const before = await reviewAuditCounts(requireFixture(), request.projectId);

    const otherSubject = AuthorizationContextV1Schema.parse({
      ...readerAuthorization,
      actorId: "actor-2",
      authorizationContextRef: {
        kind: "authorization-context",
        reference: { entityId: "authorization-ui-checkpoint-actor-2", versionId: "1" },
      },
    });
    const writeOnly = AuthorizationContextV1Schema.parse({
      ...readerAuthorization,
      grantedCapabilities: ["review-audit.decide"],
    });
    const extraCapability = AuthorizationContextV1Schema.parse({
      ...readerAuthorization,
      grantedCapabilities: ["review-audit.read", "review-audit.decide"],
    });
    const denials: ReadonlyArray<
      readonly [string, Partial<CheckpointInput>, AuthorizationContextV1]
    > = [
      [
        "错身份版本",
        { taskRef: { ...taskRef, reference: { ...taskRef.reference, versionId: "2" } } },
        readerAuthorization,
      ],
      [
        "错目标元数据",
        {
          taskRef: {
            ...taskRef,
            targetRef: {
              ...taskRef.targetRef,
              reference: { ...taskRef.targetRef.reference, entityId: "group-other" },
            },
          } as ReviewTaskRefV1,
        },
        readerAuthorization,
      ],
      [
        "任务等待运行漂移",
        {
          taskRef: {
            ...taskRef,
            waitingRunRef: {
              ...taskRef.waitingRunRef,
              reference: { ...taskRef.waitingRunRef.reference, versionId: "2" },
            },
          } as ReviewTaskRefV1,
        },
        readerAuthorization,
      ],
      [
        "错父运行精确版本",
        {
          parentRunRef: {
            ...taskRef.waitingRunRef,
            reference: { ...taskRef.waitingRunRef.reference, versionId: "2" },
          },
        },
        readerAuthorization,
      ],
      ["错工程", { projectId: "project-ui-checkpoint-other" }, readerAuthorization],
      // 任务原 requestedBy 是 actor-1：上下文自身一致的其它主体也证明不了它。
      ["错原请求主体", { actorId: "actor-2" }, otherSubject],
      ["冻结上下文无读能力", {}, writeOnly],
      ["能力集不唯一", {}, extraCapability],
    ];
    for (const [index, [name, overrides, context]] of denials.entries()) {
      expect(
        await proves(
          readAdapterFor(context),
          checkpointInput(`ui-checkpoint-deny-${index}`, { ...overrides, authorization: context }),
        ),
        name,
      ).toBe(false);
    }

    // 受控复验：冻结上下文是已签发的完整授权，当前脱敏或收窄后的复验结果都不替代它。
    const controlledVerify =
      (context: AuthorizationContextV1, redacted = false): LocalIdentityAccessV1["verify"] =>
      async () =>
        ({ context, redacted }) as Awaited<ReturnType<LocalIdentityAccessV1["verify"]>>;
    const narrowings: ReadonlyArray<readonly [string, AuthorizationContextV1, boolean]> = [
      ["脱敏复验", readerAuthorization, true],
      ["空间范围收窄", { ...readerAuthorization, spatialScopeRefs: [] }, false],
      ["来源许可收窄", { ...readerAuthorization, sourceAccessGrantRefs: [] }, false],
    ];
    for (const [index, [name, context, redacted]] of narrowings.entries()) {
      expect(
        await readAdapterFor(
          readerAuthorization,
          controlledVerify(context, redacted),
        ).verifyCheckpointReference(checkpointInput(`ui-checkpoint-scope-${index}`)),
        name,
      ).toBe(false);
    }

    // 撤权：复验异常抛出，宿主收口为不证明，且证明从未因此改写任何事实。
    const revokedVerify = vi.fn(async () => {
      throw new AccessServiceError({
        code: "AUTHORIZATION_DENIED",
        stage: "verify",
        occurredAt: REVIEW_TEST_TIMESTAMP,
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: { entityId: "diagnostic-ui-checkpoint-revoked", versionId: "1" },
        },
        contextRefs: [],
        retryable: false,
        requiredCapability: "review-audit.read",
        authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      });
    });
    expect(
      await proves(
        readAdapterFor(readerAuthorization, revokedVerify),
        checkpointInput("ui-checkpoint-revoked"),
      ),
    ).toBe(false);
    expect(revokedVerify).toHaveBeenCalledTimes(1);

    expect(await reviewAuditCounts(requireFixture(), request.projectId)).toEqual(before);
    expect(await artifactFacts()).toEqual(artifactsBefore);
  }, 180_000);
});
