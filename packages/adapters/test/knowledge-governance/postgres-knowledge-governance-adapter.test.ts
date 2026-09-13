import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AuthorizationContextV1Schema,
  KnowledgeGovernanceCommandV1Schema,
  ReviewRequestV1Schema,
  ReviewDecisionCommandV1Schema,
  type AuthorizationContextV1,
  type KnowledgeGovernanceCommandV1,
  type ReviewTaskRefV1,
} from "@riskflow/contracts/ports";
import {
  bootstrapInitialSystemAdministrator,
  createPostgresLocalIdentityAccess,
} from "../../src/auth/index.js";
import { PostgresKnowledgeGovernanceAdapter } from "../../src/knowledge-governance/index.js";
import { createPostgresRuntime } from "../../src/postgres/pool.js";
import * as governanceMigration from "../../src/postgres/migrations/knowledge-modeling/deliver-governed-definition-lifecycle/000007_governed_definition_lifecycle.js";
import * as assessmentConfigurationMigration from "../../src/postgres/migrations/knowledge-modeling/deliver-assessment-configuration-and-measure-governance/000012_assessment_configuration.js";
import { DomainEventV1Schema, type DomainEventV1 } from "@riskflow/contracts/events";
import type { TransactionContextV1 } from "@riskflow/core/persistence";
import {
  AssessmentConfigurationDefinitionTypeV1Schema,
  type AssessmentConfigurationGovernancePolicyV1,
  type AssessmentConfigurationReleaseAppendV1,
  type AssessmentConfigurationSetResultV1,
  type PreparedAssessmentConfigurationV1,
} from "@riskflow/core/assessment-config";
import {
  ScoringRuleError,
  type PreparedScoringRuleV1,
  type ScoringRulesGovernancePolicyV1,
  type SubmitScoringRuleRevisionV1,
} from "@riskflow/core/scoring-rules";
import { vi } from "vitest";
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

  it("supports migration down and up in reverse dependency order", async () => {
    const migrator = createPostgresRuntime(fixture!.postgres.migrator, "riskflow_migrator");
    try {
      await assessmentConfigurationMigration.down(migrator.db);
      await governanceMigration.down(migrator.db);
      await governanceMigration.up(migrator.db);
      await assessmentConfigurationMigration.up(migrator.db);
      const restored = await fixture!.postgres.adminPool.query<{ name: string | null }>(
        "SELECT to_regclass('business.assessment_config_revision_metadata') AS name",
      );
      expect(restored.rows[0]?.name).not.toBeNull();
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

  it("rejects approval proofs with a wrong project, target, or superseded task", async () => {
    const projectId = "governance-proof-boundaries";
    const authorization = governanceAuthorizationFor(projectId);
    const reviewAuthorization = reviewAuthorizationFor(projectId);
    const submitted = await fixture!.adapter.govern(
      submitFor(projectId, authorization, "proof-boundary"),
    );
    expect(submitted.kind).toBe("succeeded");
    if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") return;
    const requested = await fixture!.adapter.govern(
      requestReviewFor(projectId, authorization, submitted.result.knowledgeRevisionRef),
    );
    expect(requested.kind).toBe("succeeded");
    if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") return;
    const decision = await fixture!.reviewAudit.decideReview(
      decideApproval(projectId, reviewAuthorization, requested.result.reviewTaskRef),
    );
    expect(decision.kind).toBe("succeeded");
    if (decision.kind !== "succeeded") return;

    const wrongProject = await fixture!.adapter.govern(
      publishFor(
        "governance-proof-other-project",
        governanceAuthorizationFor("governance-proof-other-project"),
        submitted.result.knowledgeRevisionRef,
        decision.result.reviewDecisionRef,
      ),
    );
    expect(wrongProject).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });

    const wrongTarget = await fixture!.adapter.govern(
      publishFor(
        projectId,
        authorization,
        {
          kind: "knowledge-revision",
          reference: { entityId: "revision-not-approved", versionId: "1" },
        },
        decision.result.reviewDecisionRef,
      ),
    );
    expect(wrongTarget).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });

    const replacement = await fixture!.reviewAudit.requestReview(
      ReviewRequestV1Schema.parse({
        kind: "request-review",
        commandId: nextId("supersede-review"),
        idempotencyKey: nextId("supersede-review-key"),
        projectId,
        actorId: reviewAuthorization.actorId,
        issuedAt: "2030-01-01T00:00:02.000Z",
        authorization: reviewAuthorization,
        payload: {
          reviewType: "knowledge-revision",
          targetRef: {
            kind: "knowledge-revision",
            reference: {
              entityId: submitted.result.knowledgeRevisionRef.reference.entityId,
              versionId: "2",
            },
          },
          validationSnapshotRef: {
            kind: "validation-snapshot",
            reference: { entityId: "supersede-validation", versionId: "1" },
          },
          evidenceSnapshotRef: {
            kind: "evidence-snapshot",
            reference: { entityId: "supersede-evidence", versionId: "1" },
          },
          waitingRunRef: requested.result.reviewTaskRef.waitingRunRef,
          reviewPolicyRef: { entityId: "review-policy", versionId: "1" },
        },
      }),
    );
    expect(replacement).toMatchObject({ kind: "succeeded" });
    const superseded = await fixture!.adapter.govern(
      publishFor(projectId, authorization, submitted.result.knowledgeRevisionRef, {
        kind: "review-decision",
        reference: { entityId: "superseded-decision", versionId: "1" },
      }),
    );
    expect(superseded).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
  });

  it("uses the C06 verified invocation kind for human-only governance commands", async () => {
    const projectId = "governance-authoritative-access";
    const authorization = governanceAuthorizationFor(projectId);
    const reviewAuthorization = reviewAuthorizationFor(projectId);
    const submitted = await fixture!.adapter.govern(
      submitFor(projectId, authorization, "authoritative-access"),
    );
    expect(submitted.kind).toBe("succeeded");
    if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") return;
    const requested = await fixture!.adapter.govern(
      requestReviewFor(projectId, authorization, submitted.result.knowledgeRevisionRef),
    );
    expect(requested.kind).toBe("succeeded");
    if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") return;
    const decision = await fixture!.reviewAudit.decideReview(
      decideApproval(projectId, reviewAuthorization, requested.result.reviewTaskRef),
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

    const verifiedAsAgent = AuthorizationContextV1Schema.parse({
      ...authorization,
      causalRunRef: {
        kind: "workflow-run",
        reference: { entityId: `agent-run-${projectId}`, versionId: "1" },
      },
      invocation: {
        kind: "agent-task",
        agentTaskRef: {
          kind: "agent-task",
          reference: { entityId: `agent-task-${projectId}`, versionId: "1" },
          taskType: "knowledge-authoring",
          triggerMode: "embedded",
          modelDeploymentRef: { entityId: "model-deployment", versionId: "1" },
          promptTemplateRef: { entityId: "prompt-template", versionId: "1" },
          toolPolicyRef: { entityId: "tool-policy", versionId: "1" },
          budgetPolicyRef: { entityId: "budget-policy", versionId: "1" },
          incrementSchemaRef: { entityId: "increment-schema", versionId: "1" },
          validationPolicyRef: { entityId: "validation-policy", versionId: "1" },
        },
      },
    });
    fixture!.setVerifiedContext(verifiedAsAgent);

    expect(
      await fixture!.adapter.govern(
        publishFor(
          projectId,
          authorization,
          submitted.result.knowledgeRevisionRef,
          decision.result.reviewDecisionRef,
          "2030-01-01T00:00:10.000Z",
        ),
      ),
    ).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });

    const deactivated = KnowledgeGovernanceCommandV1Schema.parse({
      kind: "deactivate-release",
      commandId: nextId("agent-deactivate"),
      idempotencyKey: nextId("agent-deactivate-key"),
      projectId,
      actorId: authorization.actorId,
      issuedAt: "2030-01-01T00:00:11.000Z",
      authorization,
      payload: { releaseRef: published.result.knowledgeReleaseRef, reasonCode: "agent-attempt" },
    });
    expect(await fixture!.adapter.govern(deactivated)).toMatchObject({
      kind: "failed",
      error: { code: "AUTHORIZATION_DENIED" },
    });

    const rollback = KnowledgeGovernanceCommandV1Schema.parse({
      kind: "rollback-by-new-release",
      commandId: nextId("agent-rollback"),
      idempotencyKey: nextId("agent-rollback-key"),
      projectId,
      actorId: authorization.actorId,
      issuedAt: "2030-01-01T00:00:12.000Z",
      authorization,
      payload: {
        historicalReleaseRef: published.result.knowledgeReleaseRef,
        reviewDecisionRef: decision.result.reviewDecisionRef,
        reasonCode: "agent-attempt",
      },
    });
    expect(await fixture!.adapter.govern(rollback)).toMatchObject({
      kind: "failed",
      error: { code: "AUTHORIZATION_DENIED" },
    });
  });

  it("uses real C06 human and agent verification contexts", async () => {
    const projectId = "governance-real-c06-authority";
    const actualAccess = createPostgresLocalIdentityAccess({
      ...fixture!.postgres.app,
      hmacKey: new Uint8Array(32).fill(9),
      keyVersion: "c16-real-c06-key",
      now: () => new Date("2030-01-01T00:00:01.000Z"),
    });
    try {
      await bootstrapInitialSystemAdministrator({
        connection: fixture!.postgres.migrator,
        loginName: "c16realadmin",
        displayName: "C16 real C06 administrator",
        password: "c16-real-c06-password-v1",
        accountId: "c16-real-c06-admin",
        now: () => new Date("2030-01-01T00:00:01.000Z"),
      });
      const login = await actualAccess.login({
        kind: "login",
        loginAttemptId: "c16-real-c06-login",
        loginName: "c16realadmin",
        password: "c16-real-c06-password-v1",
      });
      const session = await actualAccess.changePassword({
        kind: "change-password",
        sessionToken: login.sessionToken,
        newPassword: "c16-real-c06-password-changed-v1",
      });
      await actualAccess.administerProject({
        kind: "open-project",
        projectId,
        commandId: "c16-real-c06-open-project",
        idempotencyKey: "c16-real-c06-open-project",
        expectedVersion: "none",
        authorizationContextRef: session.systemAdministrationContextRef!,
        initialRiskManagerAccountId: "c16-real-c06-admin",
      });

      const adapter = new PostgresKnowledgeGovernanceAdapter({
        db: fixture!.runtime.db,
        transactionUnit: fixture!.transactionUnit,
        access: actualAccess,
        reviewAudit: fixture!.reviewAudit,
        reviewAuthorization: (command) =>
          reviewAuthorizationFor(command.projectId, command.actorId),
        approvalAuthorization: (command) =>
          reviewAuthorizationFor(command.projectId, command.actorId),
        now: () => new Date("2030-01-01T00:00:01.000Z"),
      });
      const agentTaskRefFor = (suffix: string) => ({
        kind: "agent-task" as const,
        reference: { entityId: `c16-agent-task-${suffix}`, versionId: "1" },
        taskType: "knowledge-authoring" as const,
        triggerMode: "embedded" as const,
        modelDeploymentRef: { entityId: "c16-model-deployment", versionId: "1" },
        promptTemplateRef: { entityId: "c16-prompt-template", versionId: "1" },
        toolPolicyRef: { entityId: "c16-tool-policy", versionId: "1" },
        budgetPolicyRef: { entityId: "c16-budget-policy", versionId: "1" },
        incrementSchemaRef: { entityId: "c16-increment-schema", versionId: "1" },
        validationPolicyRef: { entityId: "c16-validation-policy", versionId: "1" },
      });
      const branches = [
        ["publish", "knowledge-modeling.publish-approved-release"],
        ["deactivate", "knowledge-modeling.deactivate-release"],
        ["rollback", "knowledge-modeling.rollback-by-new-release"],
      ] as const;
      for (const [suffix, branch] of branches) {
        const humanInvocationId = `c16-real-c06-human-${suffix}`;
        const human = await actualAccess.authorize({
          invocation: { kind: "human-session", sessionToken: session.sessionToken },
          invocationId: humanInvocationId,
          projectId,
          branch,
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
        });
        const agentInvocationId = `c16-real-c06-agent-${suffix}`;
        const agent = await actualAccess.authorize({
          invocation: { kind: "agent-task", agentTaskRef: agentTaskRefFor(suffix) },
          invocationId: agentInvocationId,
          projectId,
          branch,
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
          parentContext: human.context,
          causalRunRef: {
            kind: "workflow-run",
            reference: { entityId: `c16-real-c06-run-${suffix}`, versionId: "1" },
          },
        });
        const verifiedHuman = await actualAccess.verify({
          authorizationContextRef: human.context.authorizationContextRef,
          invocationId: humanInvocationId,
          projectId,
          branch,
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
        });
        const verifiedAgent = await actualAccess.verify({
          authorizationContextRef: agent.context.authorizationContextRef,
          invocationId: agentInvocationId,
          projectId,
          branch,
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
        });
        expect(verifiedHuman.context.invocation.kind).toBe("human");
        expect(verifiedAgent.context.invocation.kind).toBe("agent-task");

        const forgedHuman = AuthorizationContextV1Schema.parse({
          ...agent.context,
          invocation: { kind: "human" },
        });
        const result =
          suffix === "publish"
            ? await adapter.govern(
                publishFor(
                  projectId,
                  forgedHuman,
                  {
                    kind: "knowledge-revision",
                    reference: { entityId: "unknown", versionId: "1" },
                  },
                  { kind: "review-decision", reference: { entityId: "unknown", versionId: "1" } },
                ),
              )
            : suffix === "deactivate"
              ? await adapter.govern(
                  KnowledgeGovernanceCommandV1Schema.parse({
                    kind: "deactivate-release",
                    commandId: `c16-real-c06-${suffix}`,
                    idempotencyKey: `c16-real-c06-${suffix}`,
                    projectId,
                    actorId: forgedHuman.actorId,
                    issuedAt: "2030-01-01T00:00:02.000Z",
                    authorization: forgedHuman,
                    payload: {
                      releaseRef: {
                        kind: "knowledge-release",
                        reference: { entityId: "unknown", versionId: "1" },
                      },
                      reasonCode: "agent-attempt",
                    },
                  }),
                )
              : await adapter.govern(
                  KnowledgeGovernanceCommandV1Schema.parse({
                    kind: "rollback-by-new-release",
                    commandId: `c16-real-c06-${suffix}`,
                    idempotencyKey: `c16-real-c06-${suffix}`,
                    projectId,
                    actorId: forgedHuman.actorId,
                    issuedAt: "2030-01-01T00:00:02.000Z",
                    authorization: forgedHuman,
                    payload: {
                      historicalReleaseRef: {
                        kind: "knowledge-release",
                        reference: { entityId: "unknown", versionId: "1" },
                      },
                      reviewDecisionRef: {
                        kind: "review-decision",
                        reference: { entityId: "unknown", versionId: "1" },
                      },
                      reasonCode: "agent-attempt",
                    },
                  }),
                );
        expect(result).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });
      }
    } finally {
      await actualAccess.close();
    }
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

  it("blocks C19 scoring-rule submissions while the scoring-rule policy is missing", async () => {
    const projectId = "governance-c19-policy-missing";
    const authorization = governanceAuthorizationFor(projectId);
    const submitted = await fixture!.adapter.govern(
      KnowledgeGovernanceCommandV1Schema.parse({
        kind: "submit-revision",
        commandId: nextId("c19-submit-missing-policy"),
        idempotencyKey: nextId("c19-submit-missing-policy-key"),
        projectId,
        actorId: authorization.actorId,
        issuedAt: GOVERNANCE_TEST_TIMESTAMP,
        authorization,
        payload: {
          definitionType: "structured-scoring-rule",
          candidateArtifactRef: artifactFor("c19-missing-policy"),
          evidenceReferences: [
            {
              locator: { sourceSegmentId: "segment-c19-missing-policy" },
              sourceVersion: { entityId: "source-c19-missing-policy", versionId: "1" },
            },
          ],
        },
      }),
    );
    expect(submitted).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "scoring-rule-policy-required" },
    });
  });
});

describe.sequential("PostgreSQL knowledge-governance adapter with a C18 content policy", () => {
  const preparedFor = (definitionType: string): PreparedAssessmentConfigurationV1 =>
    ({
      definitionType: AssessmentConfigurationDefinitionTypeV1Schema.parse(definitionType),
      projectRevisionRef: {
        kind: "project-revision",
        reference: { entityId: "project-revision-stub", versionId: "1" },
      },
      configurationSetRef: { entityId: "configuration-set-stub", versionId: "1" },
      contentDigest: "a".repeat(64),
      summary: { itemCount: 1, identityIds: ["stub-identity"] },
      document: {} as PreparedAssessmentConfigurationV1["document"],
    }) satisfies PreparedAssessmentConfigurationV1;

  const policyStub = () => {
    const prepareRevision = vi.fn(async () => preparedFor("risk-matrix"));
    const appendPreparedRevision = vi.fn(async () => undefined);
    const assertRevisionMetadata = vi.fn(async () => undefined);
    const appendRelease = vi.fn(
      async (
        context: TransactionContextV1,
        input: AssessmentConfigurationReleaseAppendV1,
      ): Promise<DomainEventV1[]> => {
        // The C18 seam must receive the C16 transaction context and the release facts.
        expect(context).toBeDefined();
        return [
          DomainEventV1Schema.parse({
            schemaVersion: "1",
            eventId: `stub-assessment-basis-${input.releaseRef.reference.entityId}`,
            eventVersion: 1,
            projectId: input.command.projectId,
            aggregateRef: input.releaseRef,
            occurredAt: input.command.issuedAt,
            recordedAt: input.recordedAt,
            causationId: input.command.commandId,
            correlationId: input.command.idempotencyKey,
            producerCommandId: input.command.commandId,
            idempotencyKey: input.command.idempotencyKey,
            authorizationContextRef: input.command.authorizationContextRef,
            auditTrailRef: {
              kind: "audit-trail",
              reference: {
                entityId: input.audit.auditEntryId,
                versionId: input.audit.version.versionId,
              },
            },
            eventType: "knowledge.assessment-basis-published.v1",
            payload: {
              basisKind: "assessment-basis",
              newKnowledgeReleaseRef: input.releaseRef,
              affectedProjectRevisionRef: {
                kind: "project-revision",
                reference: { entityId: "project-revision-stub", versionId: "1" },
              },
            },
          }),
        ];
      },
    );
    const resolveConfigurationSet = vi.fn(async (): Promise<AssessmentConfigurationSetResultV1> => {
      throw new Error("resolution is not exercised here");
    });
    const policy: AssessmentConfigurationGovernancePolicyV1 = {
      prepareRevision,
      appendPreparedRevision,
      assertRevisionMetadata,
      appendRelease,
      resolveConfigurationSet,
    };
    return {
      policy,
      prepareRevision,
      appendPreparedRevision,
      assertRevisionMetadata,
      appendRelease,
    };
  };

  let fixture: KnowledgeGovernancePostgresFixture | undefined;
  let stub: ReturnType<typeof policyStub> | undefined;

  beforeAll(async () => {
    stub = policyStub();
    fixture = await startKnowledgeGovernanceFixture({
      assessmentConfigurationPolicy: stub.policy,
    });
  }, 180_000);

  afterAll(async () => {
    await fixture?.close().catch(() => undefined);
  });

  it("keeps non C18 governance behavior unchanged and never calls the policy", async () => {
    const projectId = "governance-c18-seam-non-c18";
    const authorization = governanceAuthorizationFor(projectId);
    const submitted = await fixture!.adapter.govern(
      submitFor(projectId, authorization, "seam-non-c18"),
    );
    expect(submitted).toMatchObject({ kind: "succeeded", result: { kind: "revision" } });
    expect(stub!.prepareRevision).not.toHaveBeenCalled();
    expect(stub!.appendPreparedRevision).not.toHaveBeenCalled();
    expect(stub!.appendRelease).not.toHaveBeenCalled();
  });

  it("runs C18 content verification inside the C16 revision transaction", async () => {
    const projectId = "governance-c18-seam-submit";
    const authorization = governanceAuthorizationFor(projectId);
    const reviewAuthorization = reviewAuthorizationFor(projectId);
    const definitionType = "risk-matrix";
    const artifactRef = artifactFor("c18-seam");
    const submitted = await fixture!.adapter.govern(
      KnowledgeGovernanceCommandV1Schema.parse({
        kind: "submit-revision",
        commandId: nextId("c18-submit"),
        idempotencyKey: nextId("c18-submit-key"),
        projectId,
        actorId: authorization.actorId,
        issuedAt: GOVERNANCE_TEST_TIMESTAMP,
        authorization,
        payload: {
          definitionType,
          candidateArtifactRef: artifactRef,
          evidenceReferences: [
            {
              locator: { sourceSegmentId: "segment-c18-seam" },
              sourceVersion: { entityId: "source-c18-seam", versionId: "1" },
            },
          ],
        },
      }),
    );
    expect(submitted).toMatchObject({ kind: "succeeded", result: { kind: "revision" } });
    if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") return;
    expect(stub!.prepareRevision).toHaveBeenCalledTimes(1);
    expect(stub!.appendPreparedRevision).toHaveBeenCalledTimes(1);
    const appendInput = stub!.appendPreparedRevision.mock.calls[0]![1];
    expect(appendInput.prepared.contentDigest).toBe("a".repeat(64));

    const revisionRow = await fixture!.postgres.adminPool.query<{
      audit_entry_id: string;
      definition_type: string;
    }>(
      `SELECT audit_entry_id, definition_type FROM business.knowledge_revisions
        WHERE revision_id = $1`,
      [submitted.result.knowledgeRevisionRef.reference.entityId],
    );
    expect(revisionRow.rows[0]?.audit_entry_id).toBe(appendInput.auditEntryId);
    expect(revisionRow.rows[0]?.definition_type).toBe(definitionType);

    const requested = await fixture!.adapter.govern(
      requestReviewFor(projectId, authorization, submitted.result.knowledgeRevisionRef),
    );
    expect(requested).toMatchObject({ kind: "succeeded", result: { kind: "review-task" } });
    expect(stub!.assertRevisionMetadata).toHaveBeenCalledTimes(1);
    if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") return;

    const decision = await fixture!.reviewAudit.decideReview(
      decideApproval(projectId, reviewAuthorization, requested.result.reviewTaskRef),
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
    expect(stub!.appendRelease).toHaveBeenCalledTimes(1);
    if (published.kind !== "succeeded" || published.result.kind !== "release") return;

    const events = await fixture!.postgres.adminPool.query<{ event_type: string }>(
      `SELECT event_type FROM outbox.events WHERE producer_command_id = $1`,
      [
        (
          await fixture!.postgres.adminPool.query<{ command_id: string }>(
            `SELECT command_id FROM business.knowledge_releases WHERE release_id = $1`,
            [published.result.knowledgeReleaseRef.reference.entityId],
          )
        ).rows[0]?.command_id ?? "missing",
      ],
    );
    expect(events.rows.map((row) => row.event_type)).toEqual([
      "knowledge.assessment-basis-published.v1",
    ]);
  });
});

describe.sequential(
  "PostgreSQL knowledge-governance adapter with a C19 scoring-rules policy",
  () => {
    const staleVersionProjectId = "governance-c19-seam-stale-version";

    const preparedFor = (
      definitionType: SubmitScoringRuleRevisionV1["definitionType"],
    ): PreparedScoringRuleV1 =>
      ({
        definitionType,
        projectRevisionRef: {
          kind: "project-revision",
          reference: { entityId: "project-revision-stub", versionId: "1" },
        },
        compatibilityRef: { entityId: "compatibility-stub", versionId: "1" },
        contentDigest: "b".repeat(64),
        itemCount: 3,
      }) satisfies PreparedScoringRuleV1;

    const policyStub = () => {
      const prepareRevision = vi.fn(
        async (command: SubmitScoringRuleRevisionV1): Promise<PreparedScoringRuleV1> => {
          if (command.projectId === staleVersionProjectId) {
            throw new ScoringRuleError({
              code: "STALE_VERSION",
              reasonCode: "scoring-rule-base-version-conflict",
              targetRef: {
                kind: "knowledge-revision",
                reference: { entityId: "c19-seam-stale-version", versionId: "1" },
              },
            });
          }
          return preparedFor(command.definitionType);
        },
      );
      const appendPreparedRevision = vi.fn(async (): Promise<void> => undefined);
      const assertRevisionMetadata = vi.fn(async (): Promise<void> => undefined);
      const appendRelease = vi.fn(async () => [] as DomainEventV1[]);
      const policy: ScoringRulesGovernancePolicyV1 = {
        prepareRevision,
        appendPreparedRevision,
        assertRevisionMetadata,
        appendRelease,
      };
      return {
        policy,
        prepareRevision,
        appendPreparedRevision,
        assertRevisionMetadata,
        appendRelease,
      };
    };

    const stub = policyStub();
    let fixture: KnowledgeGovernancePostgresFixture | undefined;

    beforeAll(async () => {
      fixture = await startKnowledgeGovernanceFixture({ scoringRulesPolicy: stub.policy });
    }, 180_000);

    afterAll(async () => {
      await fixture?.close().catch(() => undefined);
    });

    it("keeps non C19 governance behavior unchanged and never calls the policy", async () => {
      const projectId = "governance-c19-seam-non-c19";
      const authorization = governanceAuthorizationFor(projectId);
      const submitted = await fixture!.adapter.govern(
        submitFor(projectId, authorization, "seam-non-c19"),
      );
      expect(submitted).toMatchObject({ kind: "succeeded", result: { kind: "revision" } });
      expect(stub!.prepareRevision).not.toHaveBeenCalled();
      expect(stub!.appendPreparedRevision).not.toHaveBeenCalled();
      expect(stub!.appendRelease).not.toHaveBeenCalled();
    });

    it("runs C19 scoring-rule verification across the submit, review, and publish seams", async () => {
      const projectId = "governance-c19-seam-submit";
      const authorization = governanceAuthorizationFor(projectId);
      const reviewAuthorization = reviewAuthorizationFor(projectId);
      const definitionType = "structured-scoring-rule";
      const artifactRef = artifactFor("c19-seam");
      const submitted = await fixture!.adapter.govern(
        KnowledgeGovernanceCommandV1Schema.parse({
          kind: "submit-revision",
          commandId: nextId("c19-submit"),
          idempotencyKey: nextId("c19-submit-key"),
          projectId,
          actorId: authorization.actorId,
          issuedAt: GOVERNANCE_TEST_TIMESTAMP,
          authorization,
          payload: {
            definitionType,
            candidateArtifactRef: artifactRef,
            evidenceReferences: [
              {
                locator: { sourceSegmentId: "segment-c19-seam" },
                sourceVersion: { entityId: "source-c19-seam", versionId: "1" },
              },
            ],
          },
        }),
      );
      expect(submitted).toMatchObject({ kind: "succeeded", result: { kind: "revision" } });
      if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") return;
      expect(stub!.prepareRevision).toHaveBeenCalledTimes(1);
      expect(stub!.prepareRevision.mock.calls[0]![0]).toMatchObject({
        projectId,
        definitionType,
        candidateArtifactRef: artifactRef,
      });
      expect(stub!.appendPreparedRevision).toHaveBeenCalledTimes(1);
      const appendInput = stub!.appendPreparedRevision.mock.calls[0]![1];
      expect(appendInput.revisionRef).toMatchObject(submitted.result.knowledgeRevisionRef);
      expect(appendInput.definitionType).toBe(definitionType);
      expect(appendInput.prepared.contentDigest).toBe("b".repeat(64));

      const revisionRow = await fixture!.postgres.adminPool.query<{ definition_type: string }>(
        `SELECT definition_type FROM business.knowledge_revisions WHERE revision_id = $1`,
        [submitted.result.knowledgeRevisionRef.reference.entityId],
      );
      expect(revisionRow.rows[0]?.definition_type).toBe(definitionType);

      const requested = await fixture!.adapter.govern(
        requestReviewFor(projectId, authorization, submitted.result.knowledgeRevisionRef),
      );
      expect(requested).toMatchObject({ kind: "succeeded", result: { kind: "review-task" } });
      expect(stub!.assertRevisionMetadata).toHaveBeenCalledTimes(1);
      expect(stub!.assertRevisionMetadata.mock.calls[0]![0]).toMatchObject({
        projectId,
        revisionRef: submitted.result.knowledgeRevisionRef,
      });
      if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") return;

      const decision = await fixture!.reviewAudit.decideReview(
        decideApproval(projectId, reviewAuthorization, requested.result.reviewTaskRef),
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
      expect(stub!.appendRelease).toHaveBeenCalledTimes(1);
      expect(stub!.appendRelease.mock.calls[0]![1]).toMatchObject({
        definitionType,
        revisionRef: submitted.result.knowledgeRevisionRef,
      });
    });

    it("maps a non BUSINESS_BLOCKED scoring-rule failure instead of degrading it", async () => {
      const projectId = staleVersionProjectId;
      const authorization = governanceAuthorizationFor(projectId);
      const submitted = await fixture!.adapter.govern(
        KnowledgeGovernanceCommandV1Schema.parse({
          kind: "submit-revision",
          commandId: nextId("c19-stale-version"),
          idempotencyKey: nextId("c19-stale-version-key"),
          projectId,
          actorId: authorization.actorId,
          issuedAt: GOVERNANCE_TEST_TIMESTAMP,
          authorization,
          payload: {
            definitionType: "structured-scoring-rule",
            candidateArtifactRef: artifactFor("c19-stale-version"),
            evidenceReferences: [
              {
                locator: { sourceSegmentId: "segment-c19-stale-version" },
                sourceVersion: { entityId: "source-c19-stale-version", versionId: "1" },
              },
            ],
          },
        }),
      );
      expect(submitted).toMatchObject({
        kind: "failed",
        error: {
          code: "STALE_VERSION",
          targetRef: {
            kind: "knowledge-revision",
            reference: { entityId: "c19-seam-stale-version", versionId: "1" },
          },
        },
      });
      const revisions = await fixture!.postgres.adminPool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM business.knowledge_revisions WHERE project_id = $1`,
        [projectId],
      );
      expect(revisions.rows[0]?.count).toBe("0");
    });
  },
);
