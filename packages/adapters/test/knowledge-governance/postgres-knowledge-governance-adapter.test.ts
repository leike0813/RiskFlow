import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  KnowledgeGovernanceCommandV1Schema,
  ReviewDecisionCommandV1Schema,
  type AuthorizationContextV1,
  type KnowledgeGovernanceCommandV1,
  type ReviewTaskRefV1,
} from "@riskflow/contracts/ports";
import { createPostgresRuntime } from "../../src/postgres/pool.js";
import * as governanceMigration from "../../src/postgres/migrations/knowledge-modeling/deliver-governed-definition-lifecycle/000007_governed_definition_lifecycle.js";
import {
  GOVERNANCE_TEST_TIMESTAMP,
  governanceAuthorizationFor,
  reviewAuthorizationFor,
  startKnowledgeGovernanceFixture,
  type KnowledgeGovernancePostgresFixture,
} from "./fixture.js";

let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${++sequence}`;

const artifactFor = (suffix: string) => ({
  kind: "content-artifact" as const,
  reference: { entityId: `artifact-${suffix}`, versionId: `sha256:${suffix}` },
});

const submitFor = (
  projectId: string,
  authorization: AuthorizationContextV1,
  suffix: string,
  baseReleaseRef?: {
    kind: "knowledge-release";
    reference: { entityId: string; versionId: string };
  },
): KnowledgeGovernanceCommandV1 =>
  KnowledgeGovernanceCommandV1Schema.parse({
    kind: "submit-revision",
    commandId: nextId("submit"),
    idempotencyKey: nextId("submit-key"),
    projectId,
    actorId: authorization.actorId,
    issuedAt: GOVERNANCE_TEST_TIMESTAMP,
    authorization,
    payload: {
      definitionType: "process-model",
      ...(baseReleaseRef === undefined ? {} : { baseReleaseRef }),
      candidateArtifactRef: artifactFor(suffix),
      evidenceReferences: [
        {
          locator: { sourceSegmentId: `segment-${suffix}` },
          sourceVersion: { entityId: `source-${suffix}`, versionId: "1" },
        },
      ],
    },
  });

const requestReviewFor = (
  projectId: string,
  authorization: AuthorizationContextV1,
  revisionRef: Extract<
    KnowledgeGovernanceCommandV1,
    { kind: "request-review" }
  >["payload"]["revisionRef"],
) =>
  KnowledgeGovernanceCommandV1Schema.parse({
    kind: "request-review",
    commandId: nextId("request-review"),
    idempotencyKey: nextId("request-review-key"),
    projectId,
    actorId: authorization.actorId,
    issuedAt: GOVERNANCE_TEST_TIMESTAMP,
    authorization,
    payload: {
      revisionRef,
      reviewPolicyRef: { entityId: "review-policy", versionId: "1" },
    },
  });

const publishFor = (
  projectId: string,
  authorization: AuthorizationContextV1,
  revisionRef: Extract<
    KnowledgeGovernanceCommandV1,
    { kind: "publish-approved-release" }
  >["payload"]["revisionRef"],
  reviewDecisionRef: Extract<
    KnowledgeGovernanceCommandV1,
    { kind: "publish-approved-release" }
  >["payload"]["reviewDecisionRef"],
  effectiveFrom = GOVERNANCE_TEST_TIMESTAMP,
) =>
  KnowledgeGovernanceCommandV1Schema.parse({
    kind: "publish-approved-release",
    commandId: nextId("publish"),
    idempotencyKey: nextId("publish-key"),
    projectId,
    actorId: authorization.actorId,
    issuedAt: "2030-01-01T00:00:02.000Z",
    authorization,
    payload: { revisionRef, reviewDecisionRef, effectiveFrom },
  });

const decideApproval = (
  projectId: string,
  authorization: AuthorizationContextV1,
  taskRef: ReviewTaskRefV1,
  decisionKind: "approve-publication" | "reject" = "approve-publication",
) =>
  ReviewDecisionCommandV1Schema.parse({
    kind: "decide-review",
    commandId: nextId("review-decision"),
    idempotencyKey: nextId("review-decision-key"),
    projectId,
    actorId: authorization.actorId,
    issuedAt: "2030-01-01T00:00:01.000Z",
    authorization,
    payload: {
      reviewTaskRef: taskRef,
      targetRef: taskRef.targetRef,
      decision: { reviewType: "knowledge-revision", kind: decisionKind },
      reasonCode: "reviewed",
    },
  });

describe.sequential("PostgreSQL knowledge-governance adapter", () => {
  let fixture: KnowledgeGovernancePostgresFixture | undefined;

  beforeAll(async () => {
    fixture = await startKnowledgeGovernanceFixture();
  }, 180_000);

  afterAll(async () => {
    await fixture?.close().catch(() => undefined);
  });

  it("creates the governed tables and enforces application immutability", async () => {
    const tables = await fixture!.postgres.adminPool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'business' AND table_name LIKE 'knowledge_%' ORDER BY table_name",
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "knowledge_definitions",
      "knowledge_release_decisions",
      "knowledge_releases",
      "knowledge_review_links",
      "knowledge_revisions",
    ]);
    const appPool = new Pool(fixture!.postgres.app);
    try {
      await expect(
        appPool.query("UPDATE business.knowledge_revisions SET definition_type = definition_type"),
      ).rejects.toBeDefined();
      await expect(appPool.query("DELETE FROM business.knowledge_releases")).rejects.toBeDefined();
      await expect(
        appPool.query("UPDATE business.knowledge_review_links SET command_id = command_id"),
      ).rejects.toBeDefined();
    } finally {
      await appPool.end();
    }
  });

  it("supports migration down and up", async () => {
    const migrator = createPostgresRuntime(fixture!.postgres.migrator, "riskflow_migrator");
    try {
      await governanceMigration.down(migrator.db);
      await governanceMigration.up(migrator.db);
    } finally {
      await migrator.close();
    }
  });

  it("submits idempotently and creates a real C07 review task", async () => {
    const projectId = "governance-submit-project";
    const authorization = governanceAuthorizationFor(projectId);
    const reviewAuthorization = reviewAuthorizationFor(projectId);
    const command = submitFor(projectId, authorization, "first");
    const first = await fixture!.adapter.govern(command);
    expect(first).toMatchObject({ kind: "succeeded", result: { kind: "revision" } });
    if (first.kind !== "succeeded" || first.result.kind !== "revision") return;
    expect(await fixture!.adapter.govern(command)).toEqual(first);

    const changed = KnowledgeGovernanceCommandV1Schema.parse({
      ...command,
      payload: { ...command.payload, candidateArtifactRef: artifactFor("changed") },
    });
    expect(await fixture!.adapter.govern(changed)).toMatchObject({
      kind: "failed",
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });

    const request = requestReviewFor(projectId, authorization, first.result.knowledgeRevisionRef);
    const requested = await fixture!.adapter.govern(request);
    expect(requested).toMatchObject({ kind: "succeeded", result: { kind: "review-task" } });
    if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") return;
    expect(requested.result.reviewTaskRef.targetRef).toEqual(first.result.knowledgeRevisionRef);
    const link = await fixture!.postgres.adminPool.query<{ review_attempt_id: string }>(
      "SELECT review_attempt_id FROM business.knowledge_review_links WHERE project_id = $1 AND revision_id = $2",
      [projectId, first.result.knowledgeRevisionRef.reference.entityId],
    );
    const appPool = new Pool(fixture!.postgres.app);
    try {
      await expect(
        appPool.query(
          'UPDATE business.knowledge_review_links SET review_task_ref = \'{"kind":"review-task"}\'::jsonb WHERE review_attempt_id = $1',
          [link.rows[0]!.review_attempt_id],
        ),
      ).rejects.toBeDefined();
    } finally {
      await appPool.end();
    }
    const decisions = await fixture!.reviewAudit.decideReview(
      decideApproval(projectId, reviewAuthorization, requested.result.reviewTaskRef),
    );
    expect(decisions.kind).toBe("succeeded");
  });

  it("requires approval proof before publishing and resolves exact releases", async () => {
    const projectId = "governance-publish-project";
    const authorization = governanceAuthorizationFor(projectId);
    const reviewAuthorization = reviewAuthorizationFor(projectId);
    const submitted = await fixture!.adapter.govern(submitFor(projectId, authorization, "publish"));
    expect(submitted.kind).toBe("succeeded");
    if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") return;
    const requested = await fixture!.adapter.govern(
      requestReviewFor(projectId, authorization, submitted.result.knowledgeRevisionRef),
    );
    expect(requested.kind).toBe("succeeded");
    if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") return;
    const reviewTaskRef = requested.result.reviewTaskRef;
    const rejected = await fixture!.reviewAudit.decideReview(
      decideApproval(projectId, reviewAuthorization, reviewTaskRef, "reject"),
    );
    expect(rejected.kind).toBe("succeeded");
    if (rejected.kind !== "succeeded") return;
    const rejectedPublish = await fixture!.adapter.govern(
      publishFor(
        projectId,
        authorization,
        submitted.result.knowledgeRevisionRef,
        rejected.result.reviewDecisionRef,
      ),
    );
    expect(rejectedPublish).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
  });

  it("publishes, deactivates, and keeps historical references resolvable by time", async () => {
    const projectId = "governance-resolve-project";
    const authorization = governanceAuthorizationFor(projectId);
    const reviewAuthorization = reviewAuthorizationFor(projectId);
    const submitted = await fixture!.adapter.govern(submitFor(projectId, authorization, "resolve"));
    expect(submitted.kind).toBe("succeeded");
    if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") return;
    const requested = await fixture!.adapter.govern(
      requestReviewFor(projectId, authorization, submitted.result.knowledgeRevisionRef),
    );
    if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") return;
    const taskRef = requested.result.reviewTaskRef;
    const decision = await fixture!.reviewAudit.decideReview(
      decideApproval(projectId, reviewAuthorization, taskRef),
    );
    expect(decision.kind).toBe("succeeded");
    if (decision.kind !== "succeeded") return;
    const published = await fixture!.adapter.govern(
      publishFor(
        projectId,
        authorization,
        submitted.result.knowledgeRevisionRef,
        decision.result.reviewDecisionRef,
      ),
    );
    expect(published).toMatchObject({ kind: "succeeded", result: { kind: "release" } });
    if (published.kind !== "succeeded" || published.result.kind !== "release") return;
    const resolved = await fixture!.adapter.resolveGovernedReleases({
      projectId,
      requiredDefinitionTypes: ["process-model"],
      requiredAt: "2030-01-01T00:00:03.000Z",
      asOfRecordedAt: "2030-01-01T00:00:03.000Z",
      authorization,
    });
    expect(resolved).toMatchObject({
      kind: "succeeded",
      result: { releaseRefs: [published.result.knowledgeReleaseRef] },
    });
    const deactivated = KnowledgeGovernanceCommandV1Schema.parse({
      kind: "deactivate-release",
      commandId: nextId("deactivate"),
      idempotencyKey: nextId("deactivate-key"),
      projectId,
      actorId: authorization.actorId,
      issuedAt: "2030-01-01T00:00:04.000Z",
      authorization,
      payload: { releaseRef: published.result.knowledgeReleaseRef, reasonCode: "superseded" },
    });
    expect(await fixture!.adapter.govern(deactivated)).toMatchObject({ kind: "succeeded" });
    const unavailable = await fixture!.adapter.resolveGovernedReleases({
      projectId,
      requiredDefinitionTypes: ["process-model"],
      requiredAt: "2030-01-01T00:00:05.000Z",
      asOfRecordedAt: "2030-01-01T00:00:05.000Z",
      authorization,
    });
    expect(unavailable).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    const rollback = KnowledgeGovernanceCommandV1Schema.parse({
      kind: "rollback-by-new-release",
      commandId: nextId("rollback"),
      idempotencyKey: nextId("rollback-key"),
      projectId,
      actorId: authorization.actorId,
      issuedAt: "2030-01-01T00:00:06.000Z",
      authorization,
      payload: {
        historicalReleaseRef: published.result.knowledgeReleaseRef,
        reviewDecisionRef: decision.result.reviewDecisionRef,
        reasonCode: "restore-stable-version",
      },
    });
    const restored = await fixture!.adapter.govern(rollback);
    expect(restored).toMatchObject({ kind: "succeeded", result: { kind: "release" } });
    if (restored.kind !== "succeeded" || restored.result.kind !== "release") return;
    const restoredResolution = await fixture!.adapter.resolveGovernedReleases({
      projectId,
      requiredDefinitionTypes: ["process-model"],
      requiredAt: "2030-01-01T00:00:07.000Z",
      asOfRecordedAt: "2030-01-01T00:00:07.000Z",
      authorization,
    });
    expect(restoredResolution).toMatchObject({
      kind: "succeeded",
      result: { releaseRefs: [restored.result.knowledgeReleaseRef] },
    });
  });
});
