import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assessmentConfigurationDocumentDigest,
  type AssessmentConfigurationDefinitionTypeV1,
} from "@riskflow/core/assessment-config";
import {
  KnowledgeGovernanceCommandV1Schema,
  ReviewDecisionCommandV1Schema,
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type KnowledgeGovernanceCommandV1,
  type KnowledgeReleaseRefV1,
  type ReviewTaskRefV1,
} from "@riskflow/contracts/ports";
import { createPostgresRuntime } from "../../src/postgres/pool.js";
import * as assessmentConfigurationMigration from "../../src/postgres/migrations/knowledge-modeling/deliver-assessment-configuration-and-measure-governance/000012_assessment_configuration.js";
import { PostgresKnowledgeGovernanceAdapter } from "../../src/knowledge-governance/index.js";
import {
  assessmentConfigurationDocumentOf,
  configurationDefinitionTypeOrder,
  makeAssessmentConfigurationFixtureSet,
  type AssessmentConfigurationFixtureSetV1,
} from "../../../core/test/assessment-config/fixture.js";
import {
  governanceAuthorizationFor,
  reviewAuthorizationFor,
} from "../knowledge-governance/fixture.js";
import {
  ASSESSMENT_CONFIGURATION_TEST_TIMESTAMP,
  contextFor,
  readAuthorizationFor,
  startAssessmentConfigurationFixture,
  type AssessmentConfigurationPostgresFixtureV1,
  type PutAssessmentConfigurationDocumentOptionsV1,
} from "./fixture.js";

const ISSUED_AT = ASSESSMENT_CONFIGURATION_TEST_TIMESTAMP;
const PUBLISH_AT = "2030-01-01T00:00:02.000Z";
const REQUIRED_AT = "2030-01-01T00:00:03.000Z";
const LATER_AT = "2030-01-01T00:01:00.000Z";
const AFTER_LATER_AT = "2030-01-01T00:02:00.000Z";

let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${++sequence}`;

const evidenceFor = (suffix: string) => ({
  locator: { sourceSegmentId: `segment-${suffix}` },
  sourceVersion: { entityId: `source-${suffix}`, versionId: "1" },
});

interface PublishedConfigurationV1 {
  readonly definitionType: AssessmentConfigurationDefinitionTypeV1;
  readonly revisionRef: Extract<
    KnowledgeGovernanceCommandV1,
    { kind: "publish-approved-release" }
  >["payload"]["revisionRef"];
  readonly releaseRef: KnowledgeReleaseRefV1;
  readonly reviewDecisionRef: Extract<
    KnowledgeGovernanceCommandV1,
    { kind: "publish-approved-release" }
  >["payload"]["reviewDecisionRef"];
}

describe.sequential("PostgreSQL assessment-configuration adapter", () => {
  let fixture: AssessmentConfigurationPostgresFixtureV1 | undefined;

  const authorizationFor = (projectId: string, actorId = "manager-1") =>
    governanceAuthorizationFor(projectId, actorId);
  const readFor = (projectId: string, actorId = "reader-1") =>
    readAuthorizationFor(projectId, actorId);

  const submitFor = (
    projectId: string,
    definitionType: AssessmentConfigurationDefinitionTypeV1,
    artifactRef: ContentArtifactRefV1,
    authorization: AuthorizationContextV1,
    baseReleaseRef?: KnowledgeReleaseRefV1,
    issuedAt = ISSUED_AT,
  ): KnowledgeGovernanceCommandV1 =>
    KnowledgeGovernanceCommandV1Schema.parse({
      kind: "submit-revision",
      commandId: nextId("submit"),
      idempotencyKey: nextId("submit-key"),
      projectId,
      actorId: authorization.actorId,
      issuedAt,
      authorization,
      payload: {
        definitionType,
        candidateArtifactRef: artifactRef,
        evidenceReferences: [evidenceFor(definitionType)],
        ...(baseReleaseRef === undefined ? {} : { baseReleaseRef }),
      },
    });

  const requestReviewFor = (
    projectId: string,
    revisionRef: Extract<
      KnowledgeGovernanceCommandV1,
      { kind: "request-review" }
    >["payload"]["revisionRef"],
    issuedAt = ISSUED_AT,
  ): KnowledgeGovernanceCommandV1 =>
    KnowledgeGovernanceCommandV1Schema.parse({
      kind: "request-review",
      commandId: nextId("review"),
      idempotencyKey: nextId("review-key"),
      projectId,
      actorId: "manager-1",
      issuedAt,
      authorization: authorizationFor(projectId),
      payload: {
        revisionRef,
        reviewPolicyRef: { entityId: "review-policy", versionId: "1" },
      },
    });

  const decideFor = (projectId: string, taskRef: ReviewTaskRefV1) =>
    ReviewDecisionCommandV1Schema.parse({
      kind: "decide-review",
      commandId: nextId("decision"),
      idempotencyKey: nextId("decision-key"),
      projectId,
      actorId: "manager-1",
      issuedAt: ISSUED_AT,
      authorization: reviewAuthorizationFor(projectId, "manager-1"),
      payload: {
        reviewTaskRef: taskRef,
        targetRef: taskRef.targetRef,
        decision: { reviewType: "knowledge-revision", kind: "approve-publication" },
        reasonCode: "client-reviewed",
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
    effectiveFrom = PUBLISH_AT,
  ): KnowledgeGovernanceCommandV1 =>
    KnowledgeGovernanceCommandV1Schema.parse({
      kind: "publish-approved-release",
      commandId: nextId("publish"),
      idempotencyKey: nextId("publish-key"),
      projectId,
      actorId: authorization.actorId,
      issuedAt: PUBLISH_AT,
      authorization,
      payload: { revisionRef, reviewDecisionRef, effectiveFrom },
    });

  const importAndPublish = async (input: {
    readonly projectId: string;
    readonly definitionType: AssessmentConfigurationDefinitionTypeV1;
    readonly document: unknown;
    readonly effectiveFrom?: string;
    readonly issuedAt?: string;
    readonly baseReleaseRef?: KnowledgeReleaseRefV1;
    readonly artifactOptions?: PutAssessmentConfigurationDocumentOptionsV1;
  }): Promise<PublishedConfigurationV1> => {
    const authorization = authorizationFor(input.projectId);
    const issuedAt = input.issuedAt ?? ISSUED_AT;
    const artifactRef = await fixture!.putDocument(input.document as never, {
      projectId: input.projectId,
      ...input.artifactOptions,
    });
    const submitted = await fixture!.governance.govern(
      submitFor(
        input.projectId,
        input.definitionType,
        artifactRef,
        authorization,
        input.baseReleaseRef,
        issuedAt,
      ),
    );
    expect(submitted).toMatchObject({ kind: "succeeded", result: { kind: "revision" } });
    if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") {
      throw new Error(`submit failed for ${input.definitionType}: ${JSON.stringify(submitted)}`);
    }
    const revisionRef = submitted.result.knowledgeRevisionRef;
    const requested = await fixture!.governance.govern(
      requestReviewFor(input.projectId, revisionRef, issuedAt),
    );
    expect(requested).toMatchObject({ kind: "succeeded", result: { kind: "review-task" } });
    if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") {
      throw new Error(`request-review failed for ${input.definitionType}`);
    }
    const decided = await fixture!.reviewAudit.decideReview(
      decideFor(input.projectId, requested.result.reviewTaskRef),
    );
    expect(decided).toMatchObject({ kind: "succeeded" });
    if (decided.kind !== "succeeded") {
      throw new Error(`review decision failed for ${input.definitionType}`);
    }
    const published = await fixture!.governance.govern(
      publishFor(
        input.projectId,
        authorization,
        revisionRef,
        decided.result.reviewDecisionRef,
        input.effectiveFrom ?? PUBLISH_AT,
      ),
    );
    expect(published).toMatchObject({ kind: "succeeded", result: { kind: "release" } });
    if (published.kind !== "succeeded" || published.result.kind !== "release") {
      throw new Error(`publish failed for ${input.definitionType}`);
    }
    return {
      definitionType: input.definitionType,
      revisionRef,
      releaseRef: published.result.knowledgeReleaseRef,
      reviewDecisionRef: decided.result.reviewDecisionRef,
    };
  };

  const publishWholeSet = async (
    projectId: string,
    set: AssessmentConfigurationFixtureSetV1,
    effectiveFrom = PUBLISH_AT,
  ): Promise<Map<AssessmentConfigurationDefinitionTypeV1, PublishedConfigurationV1>> => {
    const published = new Map<AssessmentConfigurationDefinitionTypeV1, PublishedConfigurationV1>();
    for (const definitionType of configurationDefinitionTypeOrder()) {
      published.set(
        definitionType,
        await importAndPublish({
          projectId,
          definitionType,
          document: set.documents[definitionType],
          effectiveFrom,
        }),
      );
    }
    return published;
  };

  const resolveRequest = (
    projectId: string,
    suffix: string,
    options: { readonly requiredAt?: string; readonly asOfRecordedAt?: string } = {},
  ) => ({
    requestId: nextId(`resolve-${suffix}`),
    idempotencyKey: nextId(`resolve-key-${suffix}`),
    projectId,
    actorId: "reader-1",
    requestedAt: options.requiredAt ?? REQUIRED_AT,
    authorization: readFor(projectId),
    requiredAt: options.requiredAt ?? REQUIRED_AT,
    asOfRecordedAt: options.asOfRecordedAt ?? REQUIRED_AT,
  });

  const countRows = async (table: string, projectId?: string): Promise<number> => {
    const result =
      projectId === undefined
        ? await fixture!.postgres.adminPool.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM ${table}`,
          )
        : await fixture!.postgres.adminPool.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM ${table} WHERE project_id = $1`,
            [projectId],
          );
    return Number(result.rows[0]?.count ?? "0");
  };

  beforeAll(async () => {
    fixture = await startAssessmentConfigurationFixture();
  }, 240_000);

  afterAll(async () => {
    await fixture?.close().catch(() => undefined);
  });

  it("creates the C18 tables with migration and database privileges", async () => {
    const tables = await fixture!.postgres.adminPool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'business' AND table_name LIKE 'assessment_config%'
        ORDER BY table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "assessment_config_revision_metadata",
      "assessment_configuration_release_set_members",
      "assessment_configuration_release_sets",
    ]);

    const appPool = new Pool(fixture!.postgres.app);
    const publicProbe = new Pool(fixture!.postgres.admin);
    try {
      await expect(
        appPool.query("SELECT count(*) FROM business.assessment_configuration_release_set_members"),
      ).resolves.toBeDefined();
      await expect(
        appPool.query(
          "UPDATE business.assessment_config_revision_metadata SET project_id = project_id",
        ),
      ).rejects.toBeDefined();
      await expect(
        appPool.query("DELETE FROM business.assessment_configuration_release_sets"),
      ).rejects.toBeDefined();
      await expect(
        publicProbe.query(
          "SET ROLE riskflow_checkpointer; SELECT count(*) FROM business.assessment_config_revision_metadata",
        ),
      ).rejects.toBeDefined();
    } finally {
      await appPool.end();
      await publicProbe.end();
    }

    const migrator = createPostgresRuntime(fixture!.postgres.migrator, "riskflow_migrator");
    try {
      await assessmentConfigurationMigration.down(migrator.db);
      const dropped = await fixture!.postgres.adminPool.query<{ name: string | null }>(
        "SELECT to_regclass('business.assessment_config_revision_metadata') AS name",
      );
      expect(dropped.rows[0]?.name).toBeNull();
      await assessmentConfigurationMigration.up(migrator.db);
      const restored = await fixture!.postgres.adminPool.query<{ name: string | null }>(
        "SELECT to_regclass('business.assessment_configuration_release_set_members') AS name",
      );
      expect(restored.rows[0]?.name).not.toBeNull();
    } finally {
      await migrator.close();
    }
  });

  it("imports and publishes the eleven configuration documents with atomic verification metadata", async () => {
    const projectId = "assessment-configuration-imports";
    const set = makeAssessmentConfigurationFixtureSet();
    const published = await publishWholeSet(projectId, set);
    expect(published.size).toBe(11);

    const metadata = await fixture!.postgres.adminPool.query<{
      definition_type: string;
      content_digest: string;
      artifact_version_id: string;
      summary: { itemCount: number };
    }>(
      `SELECT definition_type, content_digest, artifact_version_id, summary
        FROM business.assessment_config_revision_metadata WHERE project_id = $1
        ORDER BY definition_type`,
      [projectId],
    );
    expect(metadata.rows).toHaveLength(11);
    for (const row of metadata.rows) {
      const definitionType = row.definition_type as AssessmentConfigurationDefinitionTypeV1;
      expect(row.content_digest).toBe(
        assessmentConfigurationDocumentDigest(set.documents[definitionType]),
      );
      expect(row.artifact_version_id).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(row.summary.itemCount).toBeGreaterThan(0);
    }

    const events = await fixture!.postgres.adminPool.query<{
      event_type: string;
      event_json: { payload: Record<string, unknown> };
    }>(
      `SELECT event_type, event_json FROM outbox.events
        WHERE project_id = $1 AND event_type = 'knowledge.assessment-basis-published.v1'`,
      [projectId],
    );
    expect(events.rows).toHaveLength(11);
    const releaseIds = new Set(
      [...published.values()].map((entry) => entry.releaseRef.reference.entityId),
    );
    for (const row of events.rows) {
      expect(Object.keys(row.event_json.payload).sort()).toEqual([
        "affectedProjectRevisionRef",
        "basisKind",
        "newKnowledgeReleaseRef",
      ]);
      const payloadRelease = row.event_json.payload["newKnowledgeReleaseRef"] as {
        reference: { entityId: string };
      };
      expect(releaseIds.has(payloadRelease.reference.entityId)).toBe(true);
      const serialized = JSON.stringify(row.event_json);
      expect(serialized).not.toContain("instruction");
      expect(serialized).not.toContain("ground-settlement");
    }

    const auditCount = await fixture!.postgres.adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit.entries
        WHERE project_id = $1 AND action = 'knowledge.publish-approved-release'`,
      [projectId],
    );
    expect(Number(auditCount.rows[0]?.count ?? "0")).toBe(11);
  });

  it("stays idempotent, rejects invalid artifacts and blocks agents", async () => {
    const projectId = "assessment-configuration-boundaries";
    const set = makeAssessmentConfigurationFixtureSet();
    const riskMatrix = set.documents["risk-matrix"];
    const authorization = authorizationFor(projectId);
    const artifactRef = await fixture!.putDocument(riskMatrix, { projectId });
    const command = submitFor(projectId, "risk-matrix", artifactRef, authorization);
    const first = await fixture!.governance.govern(command);
    expect(first).toMatchObject({ kind: "succeeded", result: { kind: "revision" } });
    if (first.kind !== "succeeded" || first.result.kind !== "revision") return;
    expect(await fixture!.governance.govern(command)).toMatchObject({
      kind: "succeeded",
      result: { kind: "revision", knowledgeRevisionRef: first.result.knowledgeRevisionRef },
    });
    const changedDocument = {
      ...riskMatrix,
      content: { ...riskMatrix.content, matrixVersion: "2" },
    };
    const changedArtifact = await fixture!.putDocument(changedDocument, { projectId });
    const reusedKey = KnowledgeGovernanceCommandV1Schema.parse({
      ...command,
      payload: { ...command.payload, candidateArtifactRef: changedArtifact },
    });
    expect(await fixture!.governance.govern(reusedKey)).toMatchObject({
      kind: "failed",
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });

    const revisionsBefore = await countRows("business.knowledge_revisions", projectId);
    const metadataBefore = await countRows(
      "business.assessment_config_revision_metadata",
      projectId,
    );
    const invalidDocuments: readonly (readonly [string, unknown])[] = [
      ["unknown-field", { ...riskMatrix, content: { ...riskMatrix.content, formula: "p * c" } }],
      ["definition-type-drift", { ...riskMatrix, definitionType: "process-model" }],
      ["empty-cells", { ...riskMatrix, content: { ...riskMatrix.content, cells: [] } }],
    ];
    for (const [label, document] of invalidDocuments) {
      const artifact = await fixture!.putDocument(document as never, {
        projectId,
        artifactId: `invalid-${label}`,
      });
      expect(
        await fixture!.governance.govern(
          submitFor(projectId, "risk-matrix", artifact, authorization),
        ),
      ).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });
    }

    const mediaMismatch = await fixture!.putDocument(riskMatrix, {
      projectId,
      artifactId: "invalid-media",
      mediaType: "application/json",
    });
    expect(
      await fixture!.governance.govern(
        submitFor(projectId, "risk-matrix", mediaMismatch, authorization),
      ),
    ).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });

    const oversized = await fixture!.putDocument(riskMatrix, {
      projectId,
      artifactId: "invalid-oversized",
      payload: new Uint8Array(1024 * 1024 + 1).fill(0x20),
    });
    expect(
      await fixture!.governance.govern(
        submitFor(projectId, "risk-matrix", oversized, authorization),
      ),
    ).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });

    const undecodable = await fixture!.putDocument(riskMatrix, {
      projectId,
      artifactId: "invalid-utf8",
      payload: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]),
    });
    expect(
      await fixture!.governance.govern(
        submitFor(projectId, "risk-matrix", undecodable, authorization),
      ),
    ).toMatchObject({ kind: "failed", error: { code: "BUSINESS_BLOCKED" } });

    expect(await countRows("business.knowledge_revisions", projectId)).toBe(revisionsBefore);
    expect(await countRows("business.assessment_config_revision_metadata", projectId)).toBe(
      metadataBefore,
    );

    const agentAuthorization = contextFor(projectId, "agent-runner", ["knowledge-modeling.govern"]);
    const publication = await importAndPublish({
      projectId,
      definitionType: "forecast-policy",
      document: set.documents["forecast-policy"],
    });
    fixture!.setVerifiedContext({
      ...agentAuthorization,
      invocation: {
        kind: "agent-task",
        agentTaskRef: {
          kind: "agent-task",
          reference: { entityId: "agent-task-configuration", versionId: "1" },
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
    const releasesBefore = await countRows("business.knowledge_releases", projectId);
    const agentPublish = KnowledgeGovernanceCommandV1Schema.parse({
      ...publishFor(
        projectId,
        agentAuthorization,
        publication.revisionRef,
        publication.reviewDecisionRef,
        LATER_AT,
      ),
    });
    expect(await fixture!.governance.govern(agentPublish)).toMatchObject({
      kind: "failed",
      error: { code: "AUTHORIZATION_DENIED" },
    });
    expect(await countRows("business.knowledge_releases", projectId)).toBe(releasesBefore);

    const foreignProject = "assessment-configuration-foreign";
    const crossProject = await fixture!.configuration.resolveConfigurationSet({
      ...resolveRequest(foreignProject, "cross-project"),
      projectId: foreignProject,
      authorization: readFor(foreignProject),
    });
    expect(crossProject).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "required-release-unavailable" },
    });

    const mismatched = await fixture!.configuration.resolveConfigurationSet({
      ...resolveRequest(projectId, "project-mismatch"),
      projectId: foreignProject,
    } as never);
    expect(mismatched).toMatchObject({ kind: "failed", error: { code: "AUTHORIZATION_DENIED" } });

    const capabilityLess = await fixture!.configuration.resolveConfigurationSet({
      ...resolveRequest(projectId, "capability-less"),
      authorization: authorization,
    } as never);
    expect(capabilityLess).toMatchObject({
      kind: "failed",
      error: { code: "AUTHORIZATION_DENIED" },
    });
  });

  it("resolves the exact eleven member set and freezes historical sets", async () => {
    const projectId = "assessment-configuration-resolves";
    const set = makeAssessmentConfigurationFixtureSet();
    const published = await publishWholeSet(projectId, set);

    const first = await fixture!.configuration.resolveConfigurationSet(
      resolveRequest(projectId, "first"),
    );
    expect(first).toMatchObject({ kind: "succeeded" });
    if (first.kind !== "succeeded") return;
    expect(first.configurationSet.members).toHaveLength(11);
    expect(first.configurationSet.members.map((member) => member.definitionType)).toEqual(
      configurationDefinitionTypeOrder(),
    );
    for (const member of first.configurationSet.members) {
      expect(member.releaseRef.reference.entityId).toBe(
        published.get(member.definitionType)!.releaseRef.reference.entityId,
      );
      expect(member.contentDigest).toBe(
        assessmentConfigurationDocumentDigest(set.documents[member.definitionType]),
      );
    }

    const futureAsKnown = await fixture!.configuration.resolveConfigurationSet(
      resolveRequest(projectId, "future-as-known", {
        requiredAt: REQUIRED_AT,
        asOfRecordedAt: PUBLISH_AT,
      }),
    );
    expect(futureAsKnown).toMatchObject({ kind: "succeeded" });
    const setTimes = await fixture!.postgres.adminPool.query<{
      occurred_at: Date;
      recorded_at: Date;
    }>(
      `SELECT occurred_at, recorded_at
        FROM business.assessment_configuration_release_sets
        WHERE project_id = $1 AND as_of_recorded_at = $2`,
      [projectId, PUBLISH_AT],
    );
    expect(setTimes.rows).toHaveLength(1);
    expect(setTimes.rows[0]?.occurred_at.toISOString()).toBe(REQUIRED_AT);
    expect(setTimes.rows[0]?.recorded_at.toISOString()).toBe("2030-01-01T00:00:01.000Z");

    const replay = await fixture!.configuration.resolveConfigurationSet(
      resolveRequest(projectId, "replay"),
    );
    expect(replay).toMatchObject({ kind: "succeeded" });
    if (replay.kind !== "succeeded") return;
    expect(replay.configurationSet.identityDigest).toBe(first.configurationSet.identityDigest);

    const [concurrentA, concurrentB] = await Promise.all([
      fixture!.configuration.resolveConfigurationSet(resolveRequest(projectId, "concurrent-a")),
      fixture!.configuration.resolveConfigurationSet(resolveRequest(projectId, "concurrent-b")),
    ]);
    expect(concurrentA).toMatchObject({ kind: "succeeded" });
    expect(concurrentB).toMatchObject({ kind: "succeeded" });
    if (concurrentA.kind !== "succeeded" || concurrentB.kind !== "succeeded") return;
    expect(concurrentA.configurationSet.identityDigest).toBe(
      concurrentB.configurationSet.identityDigest,
    );
    const setRows = await fixture!.postgres.adminPool.query<{ identity_digest: string }>(
      `SELECT identity_digest FROM business.assessment_configuration_release_sets
        WHERE project_id = $1`,
      [projectId],
    );
    expect(setRows.rows).toHaveLength(2);
    expect(setRows.rows.map((row) => row.identity_digest)).toEqual(
      expect.arrayContaining([
        first.configurationSet.identityDigest,
        futureAsKnown.kind === "succeeded"
          ? futureAsKnown.configurationSet.identityDigest
          : "missing-future-set",
      ]),
    );
    const frozenIdentity = first.configurationSet.identityDigest;
    const memberKeys = (
      members: readonly {
        definitionType: string;
        releaseRef: { reference: { entityId: string } };
        contentDigest: string;
      }[],
    ) =>
      members.map(
        (member) =>
          `${member.definitionType}:${member.releaseRef.reference.entityId}:${member.contentDigest}`,
      );
    const frozenMembers = memberKeys(first.configurationSet.members);
    expect(
      await countRows("business.assessment_configuration_release_set_members"),
    ).toBeGreaterThanOrEqual(11);

    const weightSet = assessmentConfigurationDocumentOf(set, "weight-set");
    await importAndPublish({
      projectId,
      definitionType: "weight-set",
      document: {
        ...weightSet,
        configurationSetRef: { entityId: "configuration-set-revised", versionId: "2" },
      },
      effectiveFrom: LATER_AT,
      issuedAt: LATER_AT,
      baseReleaseRef: published.get("weight-set")!.releaseRef,
    });
    const incompatible = await fixture!.configuration.resolveConfigurationSet(
      resolveRequest(projectId, "incompatible", {
        requiredAt: AFTER_LATER_AT,
        asOfRecordedAt: AFTER_LATER_AT,
      }),
    );
    expect(incompatible).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "assessment-configuration-incompatible" },
    });

    const historical = await fixture!.configuration.resolveConfigurationSet(
      resolveRequest(projectId, "historical", {
        requiredAt: PUBLISH_AT,
        asOfRecordedAt: PUBLISH_AT,
      }),
    );
    expect(historical).toMatchObject({ kind: "succeeded" });
    if (historical.kind !== "succeeded") return;
    expect(memberKeys(historical.configurationSet.members)).toEqual(frozenMembers);
    const identitiesBeforeFailures = (
      await fixture!.postgres.adminPool.query<{ identity_digest: string }>(
        `SELECT identity_digest FROM business.assessment_configuration_release_sets
          WHERE project_id = $1 ORDER BY identity_digest`,
        [projectId],
      )
    ).rows.map((row) => row.identity_digest);

    const deactivated = await fixture!.governance.govern(
      KnowledgeGovernanceCommandV1Schema.parse({
        kind: "deactivate-release",
        commandId: nextId("deactivate"),
        idempotencyKey: nextId("deactivate-key"),
        projectId,
        actorId: "manager-1",
        issuedAt: LATER_AT,
        authorization: authorizationFor(projectId),
        payload: {
          releaseRef: first.configurationSet.members[0]!.releaseRef,
          reasonCode: "superseded",
        },
      }),
    );
    expect(deactivated).toMatchObject({ kind: "succeeded" });
    const afterDeactivate = await fixture!.configuration.resolveConfigurationSet(
      resolveRequest(projectId, "after-deactivate", {
        requiredAt: AFTER_LATER_AT,
        asOfRecordedAt: AFTER_LATER_AT,
      }),
    );
    expect(afterDeactivate).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED" },
    });
    const setRowsAfter = await fixture!.postgres.adminPool.query<{ identity_digest: string }>(
      `SELECT identity_digest FROM business.assessment_configuration_release_sets
        WHERE project_id = $1 ORDER BY identity_digest`,
      [projectId],
    );
    expect(setRowsAfter.rows.map((row) => row.identity_digest)).toEqual(identitiesBeforeFailures);
    expect(setRowsAfter.rows.map((row) => row.identity_digest)).toContain(frozenIdentity);
  });

  it("reads a published member by exact release through C04 and rejects mismatched scope or version", async () => {
    const projectId = "assessment-configuration-member-read";
    const set = makeAssessmentConfigurationFixtureSet();
    const published = await publishWholeSet(projectId, set);
    const target = published.get("weight-set")!;
    const authorization = readFor(projectId);
    const resolved = await fixture!.configuration.resolveConfigurationSet(
      resolveRequest(projectId, "published-member-read"),
    );
    expect(resolved).toMatchObject({ kind: "succeeded" });

    const result = await fixture!.configuration.readPublishedConfigurationMember({
      projectId,
      requestId: nextId("deployment-config-read"),
      releaseRef: target.releaseRef.reference,
      authorization,
    });
    expect(result).toEqual({
      body: set.documents["weight-set"],
      sha256: assessmentConfigurationDocumentDigest(set.documents["weight-set"]),
    });
    expect(
      await fixture!.configuration.readPublishedConfigurationMember({
        projectId: `${projectId}-other`,
        requestId: nextId("deployment-config-cross-project"),
        releaseRef: target.releaseRef.reference,
        authorization,
      }),
    ).toBeUndefined();
    expect(
      await fixture!.configuration.readPublishedConfigurationMember({
        projectId,
        requestId: nextId("deployment-config-wrong-version"),
        releaseRef: { ...target.releaseRef.reference, versionId: "wrong-version" },
        authorization,
      }),
    ).toBeUndefined();
  });

  it("keeps the frozen set stable across rollback and reports missing members", async () => {
    const projectId = "assessment-configuration-rollback";
    const set = makeAssessmentConfigurationFixtureSet();
    const published = await publishWholeSet(projectId, set);
    const first = await fixture!.configuration.resolveConfigurationSet(
      resolveRequest(projectId, "before-rollback"),
    );
    expect(first).toMatchObject({ kind: "succeeded" });
    if (first.kind !== "succeeded") return;
    const frozenIdentity = first.configurationSet.identityDigest;

    const riskMatrix = published.get("risk-matrix")!;
    const rollback = KnowledgeGovernanceCommandV1Schema.parse({
      kind: "rollback-by-new-release",
      commandId: nextId("rollback"),
      idempotencyKey: nextId("rollback-key"),
      projectId,
      actorId: "manager-1",
      issuedAt: LATER_AT,
      authorization: authorizationFor(projectId),
      payload: {
        historicalReleaseRef: riskMatrix.releaseRef,
        reviewDecisionRef: riskMatrix.reviewDecisionRef,
        reasonCode: "restore-approved-matrix",
      },
    });
    const rolledBack = await fixture!.governance.govern(rollback);
    expect(rolledBack).toMatchObject({ kind: "succeeded", result: { kind: "release" } });

    const events = await fixture!.postgres.adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM outbox.events
        WHERE project_id = $1 AND event_type = 'knowledge.assessment-basis-published.v1'`,
      [projectId],
    );
    expect(Number(events.rows[0]?.count ?? "0")).toBe(
      await countRows("business.knowledge_releases", projectId),
    );

    const setRows = await fixture!.postgres.adminPool.query<{ identity_digest: string }>(
      `SELECT identity_digest FROM business.assessment_configuration_release_sets
        WHERE project_id = $1`,
      [projectId],
    );
    expect(setRows.rows.map((row) => row.identity_digest)).toEqual([frozenIdentity]);

    const missingMember = await fixture!.configuration.resolveConfigurationSet(
      resolveRequest(projectId, "missing-member", {
        requiredAt: ISSUED_AT,
        asOfRecordedAt: ISSUED_AT,
      }),
    );
    expect(missingMember).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "required-release-unavailable" },
    });
    expect(await countRows("business.assessment_configuration_release_sets", projectId)).toBe(1);
  });

  it("rolls back a failed resolve without partial facts", async () => {
    const projectId = "assessment-configuration-fault";
    const set = makeAssessmentConfigurationFixtureSet();
    await publishWholeSet(projectId, set);
    const request = resolveRequest(projectId, "expected-write-failure");
    await fixture!.postgres.adminPool.query(
      "REVOKE INSERT ON business.assessment_configuration_release_set_members FROM riskflow_app",
    );
    try {
      const failing = await fixture!.configuration.resolveConfigurationSet(request);
      expect(failing).toMatchObject({ kind: "failed", error: { code: "TERMINAL_FAILURE" } });
      expect(await countRows("business.assessment_configuration_release_sets", projectId)).toBe(0);
      expect(
        await countRows("business.assessment_configuration_release_set_members"),
      ).toBeGreaterThanOrEqual(11);
      const incompleteReceipts = await fixture!.postgres.adminPool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM business.command_receipts
          WHERE project_id = $1 AND command_kind = 'knowledge.resolve-assessment-configuration-set.v1'
            AND completed_at IS NULL`,
        [projectId],
      );
      expect(Number(incompleteReceipts.rows[0]?.count ?? "0")).toBe(0);
    } finally {
      await fixture!.postgres.adminPool.query(
        "GRANT INSERT ON business.assessment_configuration_release_set_members TO riskflow_app",
      );
    }

    const retried = await fixture!.configuration.resolveConfigurationSet(request);
    expect(retried).toMatchObject({ kind: "succeeded" });
    expect(await countRows("business.assessment_configuration_release_sets", projectId)).toBe(1);
  });

  it("rolls back a failed publication without leaving a release", async () => {
    const projectId = "assessment-configuration-outbox-fault";
    const set = makeAssessmentConfigurationFixtureSet();
    const document = set.documents["deviation-policy"];
    const authorization = authorizationFor(projectId);
    const artifactRef = await fixture!.putDocument(document, { projectId });
    const submitted = await fixture!.governance.govern(
      submitFor(projectId, "deviation-policy", artifactRef, authorization),
    );
    if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") {
      throw new Error("submit failed");
    }
    const requested = await fixture!.governance.govern(
      requestReviewFor(projectId, submitted.result.knowledgeRevisionRef),
    );
    if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") {
      throw new Error("request-review failed");
    }
    const decided = await fixture!.reviewAudit.decideReview(
      decideFor(projectId, requested.result.reviewTaskRef),
    );
    if (decided.kind !== "succeeded") throw new Error("decision failed");

    await fixture!.postgres.adminPool.query("REVOKE INSERT ON outbox.events FROM riskflow_app");
    try {
      const published = await fixture!.governance.govern(
        publishFor(
          projectId,
          authorization,
          submitted.result.knowledgeRevisionRef,
          decided.result.reviewDecisionRef,
        ),
      );
      expect(published).toMatchObject({ kind: "failed", error: { code: "TERMINAL_FAILURE" } });
      expect(await countRows("business.knowledge_releases", projectId)).toBe(0);
      expect(await countRows("business.assessment_config_revision_metadata", projectId)).toBe(1);
    } finally {
      await fixture!.postgres.adminPool.query("GRANT INSERT ON outbox.events TO riskflow_app");
    }
  });

  it("rejects C18 definition types without a configuration policy", async () => {
    const projectId = "assessment-configuration-without-policy";
    const set = makeAssessmentConfigurationFixtureSet();
    const authorization = authorizationFor(projectId);
    const artifactRef = await fixture!.putDocument(set.documents["measure-library"], { projectId });
    const withoutPolicy = new PostgresKnowledgeGovernanceAdapter({
      db: fixture!.runtime.db,
      transactionUnit: fixture!.transactionUnit,
      access: fixture!.access,
      reviewAudit: fixture!.reviewAudit,
      now: () => new Date("2030-01-01T00:00:01.000Z"),
    });
    const result = await withoutPolicy.govern(
      submitFor(projectId, "measure-library", artifactRef, authorization),
    );
    expect(result).toMatchObject({
      kind: "failed",
      error: { code: "BUSINESS_BLOCKED", blockerKind: "assessment-configuration-policy-required" },
    });
    expect(await countRows("business.assessment_config_revision_metadata", projectId)).toBe(0);
    expect(await countRows("business.knowledge_revisions", projectId)).toBe(0);
  });
});
