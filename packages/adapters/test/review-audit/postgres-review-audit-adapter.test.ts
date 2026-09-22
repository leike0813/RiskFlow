import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AccessServiceError, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import {
  AuthorizationContextV1Schema,
  KnowledgeRevisionApprovalProofQueryV1Schema,
  ReviewDecisionCommandV1Schema,
  ReviewRequestV1Schema,
  type AuthorizationContextV1,
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
import { PostgresReviewAuditAdapter } from "../../src/review-audit/index.js";
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
                : { reviewType: "calibration-suggestion", kind: "approve-draft-creation" },
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

    // 同目标重新发起使旧任务 superseded；未裁决任务无论 pending 还是 superseded 都只返回 pending。
    const supersedingRequest = requestFor({
      suffix: "group-decision",
      projectId,
      authorization,
      commandId: nextId("request-group-decision-superseding"),
      idempotencyKey: nextId("idempotency-group-decision-superseding"),
    });
    const superseding = await adapter.requestReview(supersedingRequest);
    expect(superseding.kind).toBe("succeeded");
    if (superseding.kind !== "succeeded") return;
    const supersedingTaskRef = superseding.result.reviewTaskRef;
    const supersedingRead = { ...readInput, reviewTaskRef: supersedingTaskRef };
    expect(await adapter.readIdentificationGroupDecision(readInput)).toEqual({ kind: "pending" });
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
        groupRef: { ...groupRef, reference: { ...groupRef.reference, versionId: "2" } },
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
});
