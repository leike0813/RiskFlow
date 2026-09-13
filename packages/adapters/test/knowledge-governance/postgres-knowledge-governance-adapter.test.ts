import { sql } from "kysely";
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
import { getPostgresTransaction } from "../../src/postgres/transaction-unit.js";
import { createPostgresRuntime } from "../../src/postgres/pool.js";
import { getPostgresTransaction } from "../../src/postgres/transaction-unit.js";
import * as governanceMigration from "../../src/postgres/migrations/knowledge-modeling/deliver-governed-definition-lifecycle/000007_governed_definition_lifecycle.js";
import * as assessmentConfigurationMigration from "../../src/postgres/migrations/knowledge-modeling/deliver-assessment-configuration-and-measure-governance/000012_assessment_configuration.js";
import * as structuredScoringRulesMigration from "../../src/postgres/migrations/knowledge-modeling/deliver-structured-scoring-rules-and-applicable-rule-sets/000028_structured_scoring_rules.js";
import { DomainEventV1Schema, type DomainEventV1 } from "@riskflow/contracts/events";
import { sha256CanonicalJson, type TransactionContextV1 } from "@riskflow/core/persistence";
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
import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import { KnowledgeLifecycleError } from "@riskflow/core/knowledge-governance";
import type {
  IdentificationKnowledgeGovernancePolicyV1,
  IdentificationKnowledgeReleaseAppendV1,
} from "@riskflow/core/identification-knowledge";
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

const GENERIC_DEFINITION_TYPE = "structured-scoring-rule" as const;

const submitFor = (
  projectId: string,
  authorization: AuthorizationContextV1,
  suffix: string,
  baseReleaseRef?: {
    kind: "knowledge-release";
    reference: { entityId: string; versionId: string };
  },
  definitionType: KnowledgeGovernanceCommandV1 extends never
    ? never
    : string = GENERIC_DEFINITION_TYPE,
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
      definitionType,
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
  /**
   * C16 发布/回滚接缝的 C17 策略替身：证明回调拿到的是同一发布事务上下文
   * （事务内可见刚写入的 C16 release 行），四类成员发布返回空事件。
   */
  const identificationAppendCalls: {
    readonly context: TransactionContextV1;
    readonly input: IdentificationKnowledgeReleaseAppendV1;
  }[] = [];
  const identificationKnowledgePolicy: IdentificationKnowledgeGovernancePolicyV1 = {
    appendRelease: async (context, input) => {
      // 同一事务的观察证明：只有 C16 当前发布事务内才可见刚写入的 release 行。
      const visible = await sql<{ release_id: string }>`
        SELECT release_id FROM business.knowledge_releases
         WHERE release_id = ${input.releaseRef.reference.entityId}
           AND version_id = ${input.releaseRef.reference.versionId}
           AND project_id = ${input.command.projectId}
      `.execute(getPostgresTransaction(context));
      if (visible.rows[0] === undefined) {
        throw new KnowledgeLifecycleError({
          code: "BUSINESS_BLOCKED",
          reasonCode: "c16-release-not-visible-in-policy-transaction",
          targetRef: input.releaseRef,
        });
      }
      identificationAppendCalls.push({ context, input });
      return [];
    },
  };

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
      // 逆依赖顺序：C19 关系事实外键绑定 C16 revision，必须先于 C16 迁移回退。
      await structuredScoringRulesMigration.down(migrator.db);
      await assessmentConfigurationMigration.down(migrator.db);
      await governanceMigration.down(migrator.db);
      await governanceMigration.up(migrator.db);
      await assessmentConfigurationMigration.up(migrator.db);
      await structuredScoringRulesMigration.up(migrator.db);
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

      // C06 的 verify 要求调用方按同一 invocationId 授权；resolve 使用由请求派生的稳定身份。
      const resolveInvocationId = (
        requiredTypes: readonly string[],
        requiredAt: string,
        asOfRecordedAt: string,
      ) =>
        `knowledge-resolve-${sha256CanonicalJson({ requiredTypes, requiredAt, asOfRecordedAt })}`;
      const resolveWith = (requiredTypes: readonly string[], context: AuthorizationContextV1) =>
        adapter.resolveGovernedReleases({
          projectId,
          requiredDefinitionTypes: requiredTypes,
          requiredAt: GOVERNANCE_TEST_TIMESTAMP,
          asOfRecordedAt: GOVERNANCE_TEST_TIMESTAMP,
          authorization: context,
        });

      const identificationTypes = ["process-model"];
      const identificationInvocationId = resolveInvocationId(
        identificationTypes,
        GOVERNANCE_TEST_TIMESTAMP,
        GOVERNANCE_TEST_TIMESTAMP,
      );
      const identification = await actualAccess.authorize({
        invocation: { kind: "human-session", sessionToken: session.sessionToken },
        invocationId: identificationInvocationId,
        projectId,
        branch: "knowledge-modeling.identification-basis",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      });
      expect(await resolveWith(identificationTypes, identification.context)).toMatchObject({
        kind: "failed",
        error: { code: "BUSINESS_BLOCKED" },
      });

      const crossTypes = ["indicator-system"];
      const crossInvocationId = resolveInvocationId(
        crossTypes,
        GOVERNANCE_TEST_TIMESTAMP,
        GOVERNANCE_TEST_TIMESTAMP,
      );
      const crossAuthorized = await actualAccess.authorize({
        invocation: { kind: "human-session", sessionToken: session.sessionToken },
        invocationId: crossInvocationId,
        projectId,
        branch: "knowledge-modeling.assessment-basis",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      });
      expect(await resolveWith(crossTypes, crossAuthorized.context)).toMatchObject({
        kind: "failed",
        error: { code: "BUSINESS_BLOCKED" },
      });
      expect(await resolveWith(identificationTypes, crossAuthorized.context)).toMatchObject({
        kind: "failed",
        error: { code: "AUTHORIZATION_DENIED" },
      });
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
      requiredDefinitionTypes: [GENERIC_DEFINITION_TYPE],
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
      requiredDefinitionTypes: [GENERIC_DEFINITION_TYPE],
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
      requiredDefinitionTypes: [GENERIC_DEFINITION_TYPE],
      requiredAt: "2030-01-01T00:00:07.000Z",
      asOfRecordedAt: "2030-01-01T00:00:07.000Z",
      authorization,
    });
    expect(restoredResolution).toMatchObject({
      kind: "succeeded",
      result: { releaseRefs: [restored.result.knowledgeReleaseRef] },
    });
  });
  it("runs the C17 release policy inside the publish and rollback transactions", async () => {
    const projectId = "governance-c17-transaction-policy";
    const authorization = governanceAuthorizationFor(projectId);
    const reviewAuthorization = reviewAuthorizationFor(projectId);
    const adapter = new PostgresKnowledgeGovernanceAdapter({
      db: fixture!.runtime.db,
      transactionUnit: fixture!.transactionUnit,
      access: fixture!.access,
      reviewAudit: fixture!.reviewAudit,
      now: () => new Date(GOVERNANCE_TEST_TIMESTAMP),
      reviewAuthorization: () => reviewAuthorizationFor(projectId),
      approvalAuthorization: () => reviewAuthorizationFor(projectId),
      identificationKnowledgePolicy,
    });
    const submitted = await adapter.govern(
      submitFor(projectId, authorization, "policy", undefined, "process-model"),
    );
    if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") {
      throw new Error(`policy submit failed: ${JSON.stringify(submitted)}`);
    }
    const requested = await adapter.govern(
      requestReviewFor(projectId, authorization, submitted.result.knowledgeRevisionRef),
    );
    if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") {
      throw new Error(`policy review request failed: ${JSON.stringify(requested)}`);
    }
    const decision = await fixture!.reviewAudit.decideReview(
      decideApproval(projectId, reviewAuthorization, requested.result.reviewTaskRef),
    );
    if (decision.kind !== "succeeded") throw new Error("review decision failed");
    const callsBefore = identificationAppendCalls.length;
    const published = await adapter.govern(
      publishFor(
        projectId,
        authorization,
        submitted.result.knowledgeRevisionRef,
        decision.result.reviewDecisionRef,
      ),
    );
    if (published.kind !== "succeeded" || published.result.kind !== "release") {
      throw new Error(`policy publish failed: ${JSON.stringify(published)}`);
    }
    // 发布路径：同一事务上下文内被调用一次，成员发布返回空事件。
    expect(identificationAppendCalls).toHaveLength(callsBefore + 1);
    expect(identificationAppendCalls.at(-1)?.input.command.kind).toBe("publish-approved-release");
    expect(identificationAppendCalls.at(-1)?.input.requiredAt).toBe(GOVERNANCE_TEST_TIMESTAMP);
    expect(identificationAppendCalls.at(-1)?.input.revision.definitionType).toBe("process-model");
    const releaseEvents = await fixture!.postgres.adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM outbox.events WHERE producer_command_id = $1`,
      [
        (
          await fixture!.postgres.adminPool.query<{ command_id: string }>(
            `SELECT command_id FROM business.knowledge_releases WHERE release_id = $1`,
            [published.result.knowledgeReleaseRef.reference.entityId],
          )
        ).rows[0]?.command_id ?? "missing",
      ],
    );
    expect(releaseEvents.rows[0]?.count).toBe("0");

    // 回滚路径同样在同一事务上下文内调用策略。
    const rollback = KnowledgeGovernanceCommandV1Schema.parse({
      kind: "rollback-by-new-release",
      commandId: nextId("rollback-policy"),
      idempotencyKey: nextId("rollback-policy-key"),
      projectId,
      actorId: authorization.actorId,
      issuedAt: "2030-01-01T00:00:06.000Z",
      authorization,
      payload: {
        historicalReleaseRef: published.result.knowledgeReleaseRef,
        reviewDecisionRef: decision.result.reviewDecisionRef,
        reasonCode: "restore",
      },
    });
    const restored = await adapter.govern(rollback);
    if (restored.kind !== "succeeded" || restored.result.kind !== "release") {
      throw new Error(`policy rollback failed: ${JSON.stringify(restored)}`);
    }
    expect(identificationAppendCalls).toHaveLength(callsBefore + 2);
    expect(identificationAppendCalls.at(-1)?.input.command.kind).toBe("rollback-by-new-release");
    expect(identificationAppendCalls.at(-1)?.input.requiredAt).toBe("2030-01-01T00:00:06.000Z");
  });

  it("closes a C17 publish without the identification policy and rolls it back", async () => {
    const projectId = "governance-c17-policy-missing";
    const authorization = governanceAuthorizationFor(projectId);
    const reviewAuthorization = reviewAuthorizationFor(projectId);
    const submitted = await fixture!.adapter.govern(
      submitFor(projectId, authorization, "missing-policy", undefined, "process-model"),
    );
    if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") {
      throw new Error(`submit failed: ${JSON.stringify(submitted)}`);
    }
    const requested = await fixture!.adapter.govern(
      requestReviewFor(projectId, authorization, submitted.result.knowledgeRevisionRef),
    );
    if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") {
      throw new Error(`review request failed: ${JSON.stringify(requested)}`);
    }
    const decision = await fixture!.reviewAudit.decideReview(
      decideApproval(projectId, reviewAuthorization, requested.result.reviewTaskRef),
    );
    if (decision.kind !== "succeeded") throw new Error("review decision failed");
    const published = await fixture!.adapter.govern(
      publishFor(
        projectId,
        authorization,
        submitted.result.knowledgeRevisionRef,
        decision.result.reviewDecisionRef,
      ),
    );
    expect(published).toMatchObject({
      kind: "failed",
      error: {
        code: "BUSINESS_BLOCKED",
        blockerKind: "identification-knowledge-policy-required",
      },
    });
    // 缺失策略时发布事务整体回滚：没有 release、没有完成回执、没有识别基础事件。
    const state = await fixture!.postgres.adminPool.query<{
      releases: string;
      receipts: string;
      events: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM business.knowledge_releases
           WHERE project_id = $1 AND revision_id = $2) AS releases,
         (SELECT count(*)::text FROM business.command_receipts
           WHERE project_id = $1 AND command_kind = 'knowledge.publish-approved-release.v1'
             AND completed_at IS NOT NULL) AS receipts,
         (SELECT count(*)::text FROM outbox.events
           WHERE project_id = $1
             AND event_type = 'knowledge.identification-basis-published.v1') AS events`,
      [projectId, submitted.result.knowledgeRevisionRef.reference.entityId],
    );
    expect(state.rows[0]).toEqual({ releases: "0", receipts: "0", events: "0" });
  });

  it("rolls the whole publish back when the C17 policy rejects inside the transaction", async () => {
    const projectId = "governance-c17-policy-failure";
    const authorization = governanceAuthorizationFor(projectId);
    const reviewAuthorization = reviewAuthorizationFor(projectId);
    const failing = new PostgresKnowledgeGovernanceAdapter({
      db: fixture!.runtime.db,
      transactionUnit: fixture!.transactionUnit,
      access: fixture!.access,
      reviewAudit: fixture!.reviewAudit,
      now: () => new Date(GOVERNANCE_TEST_TIMESTAMP),
      reviewAuthorization: () => reviewAuthorizationFor(projectId),
      approvalAuthorization: () => reviewAuthorizationFor(projectId),
      identificationKnowledgePolicy: {
        appendRelease: async () => {
          throw new KnowledgeLifecycleError({
            code: "BUSINESS_BLOCKED",
            reasonCode: "c17-policy-rejected",
            targetRef: artifactFor("policy-fault"),
          });
        },
      },
    });
    const submitted = await failing.govern(
      submitFor(projectId, authorization, "fault", undefined, "process-model"),
    );
    if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") {
      throw new Error(`submit failed: ${JSON.stringify(submitted)}`);
    }
    const requested = await failing.govern(
      requestReviewFor(projectId, authorization, submitted.result.knowledgeRevisionRef),
    );
    if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") {
      throw new Error(`review request failed: ${JSON.stringify(requested)}`);
    }
    const decision = await fixture!.reviewAudit.decideReview(
      decideApproval(projectId, reviewAuthorization, requested.result.reviewTaskRef),
    );
    if (decision.kind !== "succeeded") throw new Error("review decision failed");
    const published = await failing.govern(
      publishFor(
        projectId,
        authorization,
        submitted.result.knowledgeRevisionRef,
        decision.result.reviewDecisionRef,
      ),
    );
    expect(published).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "c17-policy-rejected" },
    });
    // 发布事务整体回滚：没有 release、没有完成回执、没有识别基础事件。
    const state = await fixture!.postgres.adminPool.query<{
      releases: string;
      receipts: string;
      events: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM business.knowledge_releases
           WHERE project_id = $1 AND revision_id = $2) AS releases,
         (SELECT count(*)::text FROM business.command_receipts
           WHERE project_id = $1 AND command_kind = 'knowledge.publish-approved-release.v1'
             AND completed_at IS NOT NULL) AS receipts,
         (SELECT count(*)::text FROM outbox.events
           WHERE project_id = $1
             AND event_type = 'knowledge.identification-basis-published.v1') AS events`,
      [projectId, submitted.result.knowledgeRevisionRef.reference.entityId],
    );
    expect(state.rows[0]).toEqual({ releases: "0", receipts: "0", events: "0" });
  });

  it("selects the resolver branch by knowledge family before any database access", async () => {
    const projectId = "governance-family-branch";
    const authorization = governanceAuthorizationFor(projectId);
    const verifiedBranches: string[] = [];
    const access = {
      verify: async (request: { branch: string }) => {
        verifiedBranches.push(request.branch);
        return {
          context: authorization,
          contextRef: authorization.authorizationContextRef,
          redacted: false,
        };
      },
    } as unknown as LocalIdentityAccessV1;
    const adapter = new PostgresKnowledgeGovernanceAdapter({
      db: fixture!.runtime.db,
      transactionUnit: fixture!.transactionUnit,
      access,
      reviewAudit: fixture!.reviewAudit,
      now: () => new Date(GOVERNANCE_TEST_TIMESTAMP),
      reviewAuthorization: () => reviewAuthorizationFor(projectId),
      approvalAuthorization: () => reviewAuthorizationFor(projectId),
    });

    const resolveFor = (requiredDefinitionTypes: readonly string[]) =>
      adapter.resolveGovernedReleases({
        projectId,
        requiredDefinitionTypes,
        requiredAt: GOVERNANCE_TEST_TIMESTAMP,
        asOfRecordedAt: GOVERNANCE_TEST_TIMESTAMP,
        authorization,
      });

    const identification = await resolveFor([
      "process-model",
      "risk-mechanism",
      "retrieval-evidence-base",
      "standard-library",
      "case-library",
    ]);
    expect(identification).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    expect(verifiedBranches).toEqual(["knowledge-modeling.identification-basis"]);

    const assessment = await resolveFor(["indicator-system", "risk-matrix"]);
    expect(assessment).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    expect(verifiedBranches).toEqual([
      "knowledge-modeling.identification-basis",
      "knowledge-modeling.assessment-basis",
    ]);

    const mixed = await resolveFor(["process-model", "indicator-system"]);
    expect(mixed).toMatchObject({ kind: "failed", error: { code: "UNSUPPORTED_CONTRACT" } });
    expect(verifiedBranches).toEqual([
      "knowledge-modeling.identification-basis",
      "knowledge-modeling.assessment-basis",
    ]);
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

    it("C19 发布门禁先于 release insert：发布真实顺序跨 submit、review、publish 接缝", async () => {
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
      stub!.appendRelease.mockImplementationOnce(async (context, input) => {
        const releaseInTransaction = await getPostgresTransaction(context)
          .selectFrom("business.knowledge_releases")
          .select(({ fn }) => fn.countAll<string>().as("count"))
          .where("project_id", "=", projectId)
          .where("revision_id", "=", submitted.result.knowledgeRevisionRef.reference.entityId)
          .executeTakeFirstOrThrow();
        expect(releaseInTransaction.count).toBe("0");
        const [audit, receipt, outbox] = await Promise.all([
          fixture!.postgres.adminPool.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM audit.entries
              WHERE project_id = $1 AND action = 'knowledge.publish-approved-release'`,
            [projectId],
          ),
          fixture!.postgres.adminPool.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM business.command_receipts WHERE command_id = $1`,
            [input.command.commandId],
          ),
          fixture!.postgres.adminPool.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM outbox.events WHERE producer_command_id = $1`,
            [input.command.commandId],
          ),
        ]);
        expect([audit, receipt, outbox].map((result) => result.rows[0]?.count)).toEqual([
          "0",
          "0",
          "0",
        ]);
        return [];
      });
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
      const committed = await Promise.all([
        fixture!.postgres.adminPool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM business.knowledge_releases
            WHERE project_id = $1 AND revision_id = $2`,
          [projectId, submitted.result.knowledgeRevisionRef.reference.entityId],
        ),
        fixture!.postgres.adminPool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM audit.entries
            WHERE project_id = $1 AND action = 'knowledge.publish-approved-release'`,
          [projectId],
        ),
        fixture!.postgres.adminPool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM business.command_receipts WHERE command_id = $1`,
          [stub!.appendRelease.mock.calls[0]![1].command.commandId],
        ),
        fixture!.postgres.adminPool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM outbox.events WHERE producer_command_id = $1`,
          [stub!.appendRelease.mock.calls[0]![1].command.commandId],
        ),
      ]);
      expect(committed.map((result) => result.rows[0]?.count)).toEqual(["1", "1", "1", "0"]);
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
