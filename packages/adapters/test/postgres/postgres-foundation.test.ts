import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

import type { DomainEventV1 } from "@riskflow/contracts/events";
import { DomainEventV1Schema } from "@riskflow/contracts/events";
import type { ContractReferenceV1 } from "@riskflow/contracts/ports";
import type {
  AtomicCommandV1,
  AtomicCommitV1,
  OutboxDeliveryPolicyV1,
  TransactionContextV1,
} from "@riskflow/core/persistence";

import {
  createPostgresCheckpointer,
  createPostgresIdempotentConsumer,
  createPostgresOutbox,
  createPostgresTransactionUnit,
  setupPostgresCheckpointer,
  type PostgresCheckpointer,
} from "../../src/postgres/index.js";
import { getPostgresTransaction } from "../../src/postgres/transaction-unit.js";
import { PostgresMigrationProvider } from "../../src/postgres/migrations/provider.js";
import { runPostgresMigrations } from "../../src/postgres/migrations/run.js";
import { mapPostgresError, type PostgresConnectionConfig } from "../../src/postgres/pool.js";
import { startPostgresFixture, type PostgresTestFixture } from "./fixture.js";
import * as artifactManifestsMigration from "../../src/postgres/migrations/platform/deliver-content-addressed-artifact-store/000002_artifact_manifests.js";
import * as foundationMigration from "../../src/postgres/migrations/platform/deliver-postgresql-outbox-and-checkpoint-foundation/000001_foundation.js";
import * as localIdentityMigration from "../../src/postgres/migrations/platform/deliver-local-identity-and-project-authorization/000003_local_identity_and_authorization.js";
import * as reviewAuditMigration from "../../src/postgres/migrations/platform/deliver-review-and-audit-runtime/000004_review_and_audit_runtime.js";
import * as agentTaskRuntimeMigration from "../../src/postgres/migrations/agent-task/deliver-unified-bounded-agent-runtime/000005_agent_task_runtime.js";
import * as agentProposalArtifactRefMigration from "../../src/postgres/migrations/agent-task/deliver-unified-bounded-agent-runtime/000006_agent_proposal_artifact_ref.js";
import * as governedDefinitionLifecycleMigration from "../../src/postgres/migrations/knowledge-modeling/deliver-governed-definition-lifecycle/000007_governed_definition_lifecycle.js";
import * as engineeringContextSourceMigration from "../../src/postgres/migrations/engineering-data/deliver-engineering-context-and-source-registry/000008_engineering_context_source_registry.js";
import * as structuredDocumentConversionMigration from "../../src/postgres/migrations/engineering-data/deliver-structured-document-conversion/000009_structured_document_conversion.js";
import * as monitoringBatchesMigration from "../../src/postgres/migrations/engineering-data/deliver-monitoring-batches-snapshots-and-features/000011_monitoring_batches_snapshots_features.js";
import * as assessmentConfigurationMigration from "../../src/postgres/migrations/knowledge-modeling/deliver-assessment-configuration-and-measure-governance/000012_assessment_configuration.js";
import * as identificationKnowledgeGovernanceMigration from "../../src/postgres/migrations/knowledge-modeling/deliver-process-model-mechanism-and-evidence-governance/000020_identification_knowledge_governance.js";
import * as agentCleaningPartialAvailabilityMigration from "../../src/postgres/migrations/engineering-data/deliver-agent-cleaning-and-partial-availability/000016_agent_cleaning_partial_availability.js";
import * as engineeringDataReadQueryResultsMigration from "../../src/postgres/migrations/engineering-data/implement-engineering-data-read-branches/000024_engineering_data_read_query_results.js";
import * as structuredScoringRulesMigration from "../../src/postgres/migrations/knowledge-modeling/deliver-structured-scoring-rules-and-applicable-rule-sets/000028_structured_scoring_rules.js";
import * as deterministicRiskAssessmentMigration from "../../src/postgres/migrations/risk-assessment/deliver-deterministic-risk-assessment/000032_deterministic_risk_assessment.js";
import * as externalRiskEventRegistrationMigration from "../../src/postgres/migrations/engineering-data/implement-external-risk-event-registration/000036_external_risk_event_registration.js";
import * as warningTasksMigration from "../../src/postgres/migrations/warning-response/deliver-warning-tasks-and-in-app-notification/000044_warning_tasks_and_in_app_notification.js";
import * as responseRecommendationMigration from "../../src/postgres/migrations/warning-response/deliver-response-recommendation/000045_response_recommendation.js";

import * as fixtureMigration from "./fixtures/migrations/platform/deliver-postgresql-outbox-and-checkpoint-foundation/900001_fixture_fact.js";
import * as agentTaskFixtureMigration from "./fixtures/migrations/agent-task/deliver-unified-bounded-agent-runtime/900002_agent_task_fixture.js";

const timestamp = "2030-01-01T00:00:00.000Z";
const laterTimestamp = "2030-01-01T00:00:01.000Z";

let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${++sequence}`;

const authorizationContextRef = (suffix: string) => ({
  kind: "authorization-context" as const,
  reference: { entityId: `authorization-${suffix}`, versionId: "v1" },
});

const projectRevisionRef = (projectId: string) => ({
  kind: "project-revision" as const,
  reference: { entityId: projectId, versionId: "v1" },
});

const resultRef = (suffix: string) => ({
  kind: "risk-flow-run-result" as const,
  reference: { entityId: `result-${suffix}`, versionId: "v1" },
});

const workflowRunRef = (suffix: string) => ({
  kind: "workflow-run" as const,
  reference: { entityId: `workflow-run-${suffix}`, versionId: "v1" },
});

const riskFlowGraphState = (threadId: string, suffix: string) => ({
  schemaVersion: "1" as const,
  graphVersion: { entityId: "risk-flow-graph", versionId: "v1" },
  runRef: workflowRunRef(suffix),
  threadId,
  entryMode: "identify-and-assess" as const,
  authorizationContextRef: authorizationContextRef(suffix),
  status: "completed" as const,
  stage: "result-summary" as const,
  identificationRunRef: workflowRunRef(`${suffix}-identification`),
  assessmentRunRefs: [workflowRunRef(`${suffix}-assessment`)],
  waitingRefs: [],
  resultRef: resultRef(suffix),
});

const diagnosticRef = (suffix: string) => ({
  kind: "diagnostic-artifact" as const,
  reference: { entityId: `diagnostic-${suffix}`, versionId: "v1" },
});

const auditTrailRef = (auditEntryId: string) => ({
  kind: "audit-trail" as const,
  reference: { entityId: auditEntryId, versionId: "v1" },
});

const identificationPreparationRef = (suffix: string) => ({
  kind: "identification-preparation-snapshot" as const,
  reference: { entityId: `preparation-${suffix}`, versionId: "v1" },
});

const makeCommand = (suffix: string, value = 1): AtomicCommandV1 => ({
  projectId: `project-${suffix}`,
  commandKind: "fixture-fact-create",
  commandId: `command-${suffix}`,
  idempotencyKey: `idempotency-${suffix}`,
  payload: { factId: `fact-${suffix}`, value },
  actorRef: `actor-${suffix}`,
  authorizationContextRef: authorizationContextRef(suffix),
  issuedAt: timestamp,
  runId: `run-${suffix}`,
  threadId: `thread-${suffix}`,
});

const makeEvent = (
  command: AtomicCommandV1,
  auditEntryId: string,
  eventId: string,
  payloadSuffix = command.commandId,
): DomainEventV1 =>
  DomainEventV1Schema.parse({
    schemaVersion: "1",
    eventId,
    eventVersion: 1,
    eventType: "engineering.inputs-ready.v1",
    projectId: command.projectId,
    aggregateRef: projectRevisionRef(command.projectId),
    occurredAt: timestamp,
    recordedAt: laterTimestamp,
    causationId: command.commandId,
    correlationId: `correlation-${command.projectId}`,
    producerCommandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    authorizationContextRef: command.authorizationContextRef,
    auditTrailRef: auditTrailRef(auditEntryId),
    payload: {
      preparation: {
        kind: "identification",
        identificationPreparationSnapshotRef: identificationPreparationRef(payloadSuffix),
      },
    },
  });

const makeCommit = (
  command: AtomicCommandV1,
  suffix: string,
  eventCount = 1,
  eventIds?: readonly string[],
): AtomicCommitV1 => {
  const auditEntryId = `audit-${suffix}`;
  const events = Array.from({ length: eventCount }, (_, index) =>
    makeEvent(command, auditEntryId, eventIds?.[index] ?? `event-${suffix}-${index + 1}`),
  );
  return {
    resultRef: resultRef(suffix),
    audit: {
      auditEntryId,
      projectId: command.projectId,
      action: "fixture-fact-created",
      targetRef: projectRevisionRef(command.projectId),
      actorRef: command.actorRef,
      authorizationContextRef: command.authorizationContextRef,
      occurredAt: timestamp,
      recordedAt: laterTimestamp,
      version: { entityId: `fact-${suffix}`, versionId: "v1" },
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      runId: command.runId,
      threadId: command.threadId,
    },
    events,
  };
};

const writeFact = async (
  context: TransactionContextV1,
  factId: string,
  projectId: string,
  value = 1,
): Promise<void> => {
  await getPostgresTransaction(context)
    .insertInto("business.fixture_facts")
    .values({ fact_id: factId, project_id: projectId, value, occurred_at: timestamp })
    .execute();
};

const policy = (
  suffix: string,
  overrides: Partial<OutboxDeliveryPolicyV1> = {},
): OutboxDeliveryPolicyV1 => ({
  policyRef: { entityId: `outbox-policy-${suffix}`, versionId: "v1" },
  batchSize: 10,
  leaseDurationMs: 1_000,
  baseDelayMs: 100,
  maxDelayMs: 1_000,
  maxAttempts: 3,
  ...overrides,
});

const runMigrations = (fixture: PostgresTestFixture) =>
  runPostgresMigrations({
    connection: fixture.migrator,
    migrationRoot: fixture.productionMigrationRoot,
    additionalMigrationRoots: [fixture.fixtureMigrationRoot],
    loadModule: loadTestMigration,
  });

const testMigrationRoots = {
  production: resolve(dirname(fileURLToPath(import.meta.url)), "../../src/postgres/migrations"),
  fixture: resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/migrations"),
} as const;

type TestMigrationRoot = keyof typeof testMigrationRoots;
type TestMigrationManifestEntry = {
  readonly root: TestMigrationRoot;
  readonly relativePath: string;
  readonly migrationName: string;
  readonly sequence: number;
  readonly module: unknown;
};

const testMigrationManifest = [
  {
    root: "production",
    relativePath:
      "platform/deliver-postgresql-outbox-and-checkpoint-foundation/000001_foundation.ts",
    migrationName: "000001_platform_deliver-postgresql-outbox-and-checkpoint-foundation_foundation",
    sequence: 1,
    module: foundationMigration,
  },
  {
    root: "production",
    relativePath: "platform/deliver-content-addressed-artifact-store/000002_artifact_manifests.ts",
    migrationName: "000002_platform_deliver-content-addressed-artifact-store_artifact_manifests",
    sequence: 2,
    module: artifactManifestsMigration,
  },
  {
    root: "production",
    relativePath:
      "platform/deliver-local-identity-and-project-authorization/000003_local_identity_and_authorization.ts",
    migrationName:
      "000003_platform_deliver-local-identity-and-project-authorization_local_identity_and_authorization",
    sequence: 3,
    module: localIdentityMigration,
  },
  {
    root: "production",
    relativePath: "platform/deliver-review-and-audit-runtime/000004_review_and_audit_runtime.ts",
    migrationName: "000004_platform_deliver-review-and-audit-runtime_review_and_audit_runtime",
    sequence: 4,
    module: reviewAuditMigration,
  },
  {
    root: "production",
    relativePath: "agent-task/deliver-unified-bounded-agent-runtime/000005_agent_task_runtime.ts",
    migrationName: "000005_agent-task_deliver-unified-bounded-agent-runtime_agent_task_runtime",
    sequence: 5,
    module: agentTaskRuntimeMigration,
  },
  {
    root: "production",
    relativePath:
      "agent-task/deliver-unified-bounded-agent-runtime/000006_agent_proposal_artifact_ref.ts",
    migrationName:
      "000006_agent-task_deliver-unified-bounded-agent-runtime_agent_proposal_artifact_ref",
    sequence: 6,
    module: agentProposalArtifactRefMigration,
  },
  {
    root: "production",
    relativePath:
      "knowledge-modeling/deliver-governed-definition-lifecycle/000007_governed_definition_lifecycle.ts",
    migrationName:
      "000007_knowledge-modeling_deliver-governed-definition-lifecycle_governed_definition_lifecycle",
    sequence: 7,
    module: governedDefinitionLifecycleMigration,
  },
  {
    root: "production",
    relativePath:
      "engineering-data/deliver-engineering-context-and-source-registry/000008_engineering_context_source_registry.ts",
    migrationName:
      "000008_engineering-data_deliver-engineering-context-and-source-registry_engineering_context_source_registry",
    sequence: 8,
    module: engineeringContextSourceMigration,
  },
  {
    root: "production",
    relativePath:
      "engineering-data/deliver-structured-document-conversion/000009_structured_document_conversion.ts",
    migrationName:
      "000009_engineering-data_deliver-structured-document-conversion_structured_document_conversion",
    sequence: 9,
    module: structuredDocumentConversionMigration,
  },
  {
    root: "production",
    relativePath:
      "engineering-data/deliver-monitoring-batches-snapshots-and-features/000011_monitoring_batches_snapshots_features.ts",
    migrationName:
      "000011_engineering-data_deliver-monitoring-batches-snapshots-and-features_monitoring_batches_snapshots_features",
    sequence: 11,
    module: monitoringBatchesMigration,
  },
  {
    root: "production",
    relativePath:
      "knowledge-modeling/deliver-assessment-configuration-and-measure-governance/000012_assessment_configuration.ts",
    migrationName:
      "000012_knowledge-modeling_deliver-assessment-configuration-and-measure-governance_assessment_configuration",
    sequence: 12,
    module: assessmentConfigurationMigration,
  },
  {
    root: "production",
    relativePath:
      "engineering-data/deliver-agent-cleaning-and-partial-availability/000016_agent_cleaning_partial_availability.ts",
    migrationName:
      "000016_engineering-data_deliver-agent-cleaning-and-partial-availability_agent_cleaning_partial_availability",
    sequence: 16,
    module: agentCleaningPartialAvailabilityMigration,
  },
  {
    root: "production",
    relativePath:
      "knowledge-modeling/deliver-process-model-mechanism-and-evidence-governance/000020_identification_knowledge_governance.ts",
    migrationName:
      "000020_knowledge-modeling_deliver-process-model-mechanism-and-evidence-governance_identification_knowledge_governance",
    sequence: 20,
    module: identificationKnowledgeGovernanceMigration,
  },
  {
    root: "production",
    relativePath:
      "engineering-data/implement-engineering-data-read-branches/000024_engineering_data_read_query_results.ts",
    migrationName:
      "000024_engineering-data_implement-engineering-data-read-branches_engineering_data_read_query_results",
    sequence: 24,
    module: engineeringDataReadQueryResultsMigration,
  },
  {
    root: "production",
    relativePath:
      "knowledge-modeling/deliver-structured-scoring-rules-and-applicable-rule-sets/000028_structured_scoring_rules.ts",
    migrationName:
      "000028_knowledge-modeling_deliver-structured-scoring-rules-and-applicable-rule-sets_structured_scoring_rules",
    sequence: 28,
    module: structuredScoringRulesMigration,
  },
  {
    root: "production",
    relativePath:
      "risk-assessment/deliver-deterministic-risk-assessment/000032_deterministic_risk_assessment.ts",
    migrationName:
      "000032_risk-assessment_deliver-deterministic-risk-assessment_deterministic_risk_assessment",
    sequence: 32,
    module: deterministicRiskAssessmentMigration,
  },
  {
    root: "production",
    relativePath:
      "engineering-data/implement-external-risk-event-registration/000036_external_risk_event_registration.ts",
    migrationName:
      "000036_engineering-data_implement-external-risk-event-registration_external_risk_event_registration",
    sequence: 36,
    module: externalRiskEventRegistrationMigration,
  },
  {
    root: "production",
    relativePath:
      "warning-response/deliver-warning-tasks-and-in-app-notification/000044_warning_tasks_and_in_app_notification.ts",
    migrationName:
      "000044_warning-response_deliver-warning-tasks-and-in-app-notification_warning_tasks_and_in_app_notification",
    sequence: 44,
    module: warningTasksMigration,
  },
  {
    root: "production",
    relativePath:
      "warning-response/deliver-response-recommendation/000045_response_recommendation.ts",
    migrationName:
      "000045_warning-response_deliver-response-recommendation_response_recommendation",
    sequence: 45,
    module: responseRecommendationMigration,
  },
  {
    root: "fixture",
    relativePath:
      "platform/deliver-postgresql-outbox-and-checkpoint-foundation/900001_fixture_fact.ts",
    migrationName:
      "900001_platform_deliver-postgresql-outbox-and-checkpoint-foundation_fixture_fact",
    sequence: 900001,
    module: fixtureMigration,
  },
  {
    root: "fixture",
    relativePath: "agent-task/deliver-unified-bounded-agent-runtime/900002_agent_task_fixture.ts",
    migrationName: "900002_agent-task_deliver-unified-bounded-agent-runtime_agent_task_fixture",
    sequence: 900002,
    module: agentTaskFixtureMigration,
  },
] as const satisfies readonly TestMigrationManifestEntry[];

const migrationManifestPathPattern =
  /^(platform|agent-task|knowledge-modeling|engineering-data|risk-assessment|warning-response)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([0-9]{6})_([a-z0-9]+(?:[-_][a-z0-9]+)*)\.ts$/u;

const validateTestMigrationManifest = (): void => {
  const paths = new Set<string>();
  const names = new Set<string>();
  const sequences = new Set<number>();
  let previousSequence = -1;
  for (const migration of testMigrationManifest) {
    const match = migrationManifestPathPattern.exec(migration.relativePath);
    const [, domain, changeId, sequenceText, name] = match ?? [];
    if (
      match === null ||
      domain === undefined ||
      changeId === undefined ||
      sequenceText === undefined ||
      name === undefined
    ) {
      throw new Error("invalid test migration manifest path");
    }
    const expectedMigrationName = `${sequenceText}_${domain}_${changeId}_${name}`;
    if (
      migration.sequence !== Number(sequenceText) ||
      migration.migrationName !== expectedMigrationName
    ) {
      throw new Error("invalid test migration manifest metadata");
    }
    if (migration.sequence <= previousSequence)
      throw new Error("test migration manifest is not ordered");
    if (paths.has(migration.relativePath))
      throw new Error("duplicate test migration manifest path");
    if (names.has(migration.migrationName))
      throw new Error("duplicate test migration manifest name");
    if (sequences.has(migration.sequence))
      throw new Error("duplicate test migration manifest sequence");
    paths.add(migration.relativePath);
    names.add(migration.migrationName);
    sequences.add(migration.sequence);
    previousSequence = migration.sequence;
  }
};

validateTestMigrationManifest();

const testMigrationModules: ReadonlyMap<string, unknown> = new Map(
  testMigrationManifest.map(({ root, relativePath, module }) => [
    resolve(testMigrationRoots[root], relativePath),
    module,
  ]),
);

const migrationNames = (root: keyof typeof testMigrationRoots) =>
  testMigrationManifest
    .filter((migration) => migration.root === root)
    .map((migration) => migration.migrationName);

const loadTestMigration = async (filePath: string): Promise<unknown> => {
  const migration = testMigrationModules.get(filePath);
  if (migration !== undefined) return migration;
  throw new Error(`unexpected test migration: ${filePath}`);
};

const userPool = (config: PostgresConnectionConfig): Pool => new Pool(config);

describe("PostgreSQL foundation", () => {
  let fixture: PostgresTestFixture | undefined;
  let transactionUnit: ReturnType<typeof createPostgresTransactionUnit> | undefined;
  let outbox: ReturnType<typeof createPostgresOutbox> | undefined;
  let consumer: ReturnType<typeof createPostgresIdempotentConsumer> | undefined;
  let checkpointer: PostgresCheckpointer | undefined;
  const unavailableReferenceIds = new Set<string>();
  const validateReference = (reference: ContractReferenceV1) =>
    !unavailableReferenceIds.has(reference.reference.entityId);

  const seedCommand = async (suffix: string, value: number) => {
    const command = makeCommand(suffix, value);
    const commit = makeCommit(command, command.commandId);
    await transactionUnit!.execute(command, async (context) => {
      await writeFact(context, command.payload.factId as string, command.projectId, value);
      return commit;
    });
    return { command, commit };
  };

  it.each(["read committed", "repeatable read", "serializable"] as const)(
    "uses the requested %s transaction isolation",
    async (isolationLevel) => {
      const suffix = nextId("isolation");
      const command = makeCommand(suffix);
      await transactionUnit!.execute(
        command,
        async (context) => {
          const result = await sql<{
            transaction_isolation: string;
          }>`SHOW transaction_isolation`.execute(getPostgresTransaction(context));
          expect(result.rows[0]?.transaction_isolation).toBe(isolationLevel);
          return makeCommit(command, suffix, 0);
        },
        { isolationLevel },
      );
    },
  );

  beforeAll(async () => {
    fixture = await startPostgresFixture();

    await expect(
      runPostgresMigrations({
        connection: fixture.migrator,
        migrationRoot: fixture.fixtureMigrationRoot,
        additionalMigrationRoots: [`${fixture.fixtureMigrationRoot}/.`],
      }),
    ).rejects.toMatchObject({ code: "MIGRATION_SEQUENCE_CONFLICT" });
    const untouched = await fixture.adminPool.query<{ fixture_table: string | null }>(
      "SELECT to_regclass('business.fixture_facts') AS fixture_table",
    );
    expect(untouched.rows[0]?.fixture_table).toBeNull();

    const migrationRuns = await Promise.all([runMigrations(fixture), runMigrations(fixture)]);
    expect(migrationRuns.flatMap((run) => run.applied)).toEqual(
      expect.arrayContaining(testMigrationManifest.map((migration) => migration.migrationName)),
    );

    checkpointer = await setupPostgresCheckpointer({
      ...fixture.checkpointer,
      validateReference,
    });
    transactionUnit = createPostgresTransactionUnit(fixture.app);
    outbox = createPostgresOutbox(fixture.worker);
    consumer = createPostgresIdempotentConsumer(fixture.worker);
  }, 120_000);

  afterAll(async () => {
    await checkpointer?.end().catch(() => undefined);
    await transactionUnit?.close().catch(() => undefined);
    await outbox?.close().catch(() => undefined);
    await consumer?.close().catch(() => undefined);
    await fixture?.close().catch(() => undefined);
  });

  it("isolates schemas and roles with PostgreSQL permissions", async () => {
    expect(fixture).toBeDefined();
    const roles = await fixture!.adminPool.query<{ rolname: string; rolcanlogin: boolean }>(
      "SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = ANY($1::text[])",
      [["riskflow_migrator", "riskflow_app", "riskflow_outbox_worker", "riskflow_checkpointer"]],
    );
    expect(roles.rows).toHaveLength(4);
    expect(roles.rows.every((role) => role.rolcanlogin === false)).toBe(true);

    const publicCreate = await fixture!.adminPool.query<{
      nspname: string;
      can_create: boolean;
    }>(
      "SELECT nspname, has_schema_privilege('public', nspname, 'CREATE') AS can_create FROM pg_namespace WHERE nspname = ANY($1::text[]) ORDER BY nspname",
      [["business", "audit", "outbox", "langgraph_checkpoint"]],
    );
    expect(publicCreate.rows.every((schema) => schema.can_create === false)).toBe(true);

    const wrongOwners = await fixture!.adminPool.query(
      `SELECT n.nspname, c.relname, pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ANY($1::text[])
         AND c.relkind IN ('r', 'p')
         AND pg_get_userbyid(c.relowner) <> CASE
           WHEN n.nspname = 'langgraph_checkpoint' THEN 'riskflow_checkpointer'
           ELSE 'riskflow_migrator'
         END`,
      [["business", "audit", "outbox", "langgraph_checkpoint"]],
    );
    expect(wrongOwners.rows).toEqual([]);

    await fixture!.adminPool.query(
      "CREATE ROLE riskflow_rotated_worker_login LOGIN PASSWORD 'riskflow-rotated-password' IN ROLE riskflow_app, riskflow_outbox_worker",
    );
    await fixture!.adminPool.query(
      "CREATE ROLE riskflow_rotated_checkpointer_login LOGIN PASSWORD 'riskflow-rotated-password' IN ROLE riskflow_checkpointer",
    );

    const appPool = userPool(fixture!.app);
    const workerPool = userPool(fixture!.worker);
    const checkpointPool = userPool(fixture!.checkpointer);
    const rotatedWorkerPool = userPool({
      ...fixture!.worker,
      user: "riskflow_rotated_worker_login",
      password: "riskflow-rotated-password",
    });
    const rotatedCheckpointPool = userPool({
      ...fixture!.checkpointer,
      user: "riskflow_rotated_checkpointer_login",
      password: "riskflow-rotated-password",
    });
    const migratorPool = userPool(fixture!.migrator);
    const migratorClient = await migratorPool.connect();
    try {
      await migratorClient.query("SET ROLE riskflow_migrator");
      await migratorClient.query(
        "CREATE TABLE business.default_privilege_probe (id text PRIMARY KEY)",
      );
      await expect(
        appPool.query("CREATE TABLE business.app_must_not_ddl (id text PRIMARY KEY)"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        appPool.query("INSERT INTO business.default_privilege_probe (id) VALUES ('forbidden')"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(appPool.query("UPDATE audit.entries SET action = action")).rejects.toMatchObject(
        {
          code: "42501",
        },
      );
      await expect(appPool.query("DELETE FROM audit.entries")).rejects.toMatchObject({
        code: "42501",
      });
      await expect(
        appPool.query("SELECT count(*) FROM langgraph_checkpoint.checkpoints"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(workerPool.query("DELETE FROM audit.entries")).rejects.toMatchObject({
        code: "42501",
      });
      await expect(
        checkpointPool.query("SELECT count(*) FROM business.command_receipts"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        checkpointPool.query("SELECT count(*) FROM outbox.events"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        rotatedWorkerPool.query("SELECT count(*) FROM business.fixture_facts"),
      ).resolves.toBeDefined();
      await expect(
        rotatedWorkerPool.query("SELECT count(*) FROM outbox.events"),
      ).resolves.toBeDefined();
      await expect(
        rotatedCheckpointPool.query("SELECT count(*) FROM langgraph_checkpoint.checkpoints"),
      ).resolves.toBeDefined();
    } finally {
      await migratorClient
        .query("DROP TABLE IF EXISTS business.default_privilege_probe")
        .catch(() => undefined);
      migratorClient.release();
      await migratorPool.end();
      await appPool.end();
      await workerPool.end();
      await checkpointPool.end();
      await rotatedWorkerPool.end();
      await rotatedCheckpointPool.end();
    }
  });

  it("discovers recursive migrations without a central registry", async () => {
    expect(fixture).toBeDefined();
    const productionProvider = new PostgresMigrationProvider({
      migrationRoot: fixture!.productionMigrationRoot,
      loadModule: loadTestMigration,
    });
    expect(Object.keys(await productionProvider.getMigrations())).toEqual(
      migrationNames("production"),
    );
    const undeclaredFixtureEntry = testMigrationManifest.findLast(
      (migration) => migration.root === "fixture",
    );
    await expect(
      loadTestMigration(
        resolve(testMigrationRoots.production, undeclaredFixtureEntry!.relativePath),
      ),
    ).rejects.toThrow();
    await expect(
      loadTestMigration(
        resolve(testMigrationRoots.fixture, testMigrationManifest[0]!.relativePath),
      ),
    ).rejects.toThrow();

    const undeclaredRoot = await mkdtemp(join(tmpdir(), "riskflow-migrations-undeclared-"));
    const undeclaredMigrationDir = join(undeclaredRoot, "platform", "undeclared-test-migration");
    await mkdir(undeclaredMigrationDir, { recursive: true });
    await writeFile(
      join(undeclaredMigrationDir, "000002_undeclared.ts"),
      "export async function up() {}\nexport async function down() {}\n",
      "utf8",
    );
    try {
      const undeclaredProvider = new PostgresMigrationProvider({
        migrationRoot: undeclaredRoot,
        loadModule: loadTestMigration,
      });
      await expect(undeclaredProvider.getMigrations()).rejects.toMatchObject({
        code: "MIGRATION_INVALID",
      });
    } finally {
      await rm(undeclaredRoot, { recursive: true, force: true });
    }

    const invalidProvider = new PostgresMigrationProvider({
      migrationRoot: resolve(fixture!.fixtureMigrationRoot, "platform"),
    });
    await expect(invalidProvider.getMigrations()).rejects.toMatchObject({
      code: "MIGRATION_INVALID",
    });

    const missingExportProvider = new PostgresMigrationProvider({
      migrationRoot: fixture!.productionMigrationRoot,
      loadModule: async () => ({}),
    });
    await expect(missingExportProvider.getMigrations()).rejects.toMatchObject({
      code: "MIGRATION_INVALID",
    });

    const duplicateProvider = new PostgresMigrationProvider({
      migrationRoot: fixture!.fixtureMigrationRoot,
      additionalMigrationRoots: [`${fixture!.fixtureMigrationRoot}/.`],
      loadModule: loadTestMigration,
    });
    await expect(duplicateProvider.getMigrations()).rejects.toMatchObject({
      code: "MIGRATION_SEQUENCE_CONFLICT",
    });
    const history = await fixture!.adminPool.query<{ migration_name: string }>(
      "SELECT name AS migration_name FROM business._riskflow_migration ORDER BY name",
    );
    expect(history.rows.map((row) => row.migration_name)).toEqual(
      testMigrationManifest.map((migration) => migration.migrationName),
    );
  });

  it("discovers compiled migrations while ignoring generated sidecars", async () => {
    const root = await mkdtemp(join(tmpdir(), "riskflow-migrations-"));
    const migrationDir = join(
      root,
      "platform",
      "deliver-postgresql-outbox-and-checkpoint-foundation",
    );
    await mkdir(migrationDir, { recursive: true });
    await Promise.all([
      writeFile(join(migrationDir, "000001_foundation.js"), "export default {}", "utf8"),
      writeFile(join(migrationDir, "000001_foundation.d.ts"), "export {};", "utf8"),
      writeFile(join(migrationDir, "000001_foundation.js.map"), "{}", "utf8"),
      writeFile(join(migrationDir, "README.md"), "generated support file", "utf8"),
    ]);
    try {
      const provider = new PostgresMigrationProvider({
        migrationRoot: root,
        loadModule: async () => ({ up: async () => undefined, down: async () => undefined }),
      });
      expect(Object.keys(await provider.getMigrations())).toEqual([
        "000001_platform_deliver-postgresql-outbox-and-checkpoint-foundation_foundation",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies PostgreSQL and network connection interruptions as retryable", () => {
    for (const code of ["08001", "08P01", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"]) {
      expect(mapPostgresError({ code }, "connection.test")).toMatchObject({
        code: "CONNECTION_FAILED",
        retryable: true,
      });
    }
  });

  it("commits facts, audit, receipts and multiple events atomically", async () => {
    const command = makeCommand(nextId("atomic"), 42);
    const commit = makeCommit(command, command.commandId, 2);
    const result = await transactionUnit!.execute(command, async (context) => {
      await writeFact(context, command.payload.factId as string, command.projectId, 42);
      return commit;
    });

    expect(result).toMatchObject({
      resultRef: commit.resultRef,
      auditEntryId: commit.audit.auditEntryId,
      replayed: false,
    });
    const facts = await fixture!.adminPool.query(
      "SELECT fact_id, project_id, value, occurred_at FROM business.fixture_facts WHERE fact_id = $1",
      [command.payload.factId],
    );
    const audits = await fixture!.adminPool.query(
      "SELECT project_id, command_id, idempotency_key, occurred_at, recorded_at FROM audit.entries WHERE audit_entry_id = $1",
      [commit.audit.auditEntryId],
    );
    const events = await fixture!.adminPool.query<{
      event_id: string;
      project_id: string;
      producer_command_id: string;
      idempotency_key: string;
      status: string;
      occurred_at: Date;
      recorded_at: Date;
      event_json: DomainEventV1;
    }>(
      "SELECT event_id, project_id, producer_command_id, idempotency_key, status, occurred_at, recorded_at, event_json FROM outbox.events WHERE producer_command_id = $1 ORDER BY event_id",
      [command.commandId],
    );
    expect(facts.rows).toHaveLength(1);
    expect(facts.rows[0]).toMatchObject({ fact_id: command.payload.factId, value: 42 });
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]).toMatchObject({
      project_id: command.projectId,
      command_id: command.commandId,
      idempotency_key: command.idempotencyKey,
    });
    expect(events.rows).toHaveLength(2);
    expect(events.rows.map((event) => event.event_id)).toEqual(
      commit.events.map((event) => event.eventId).sort(),
    );
    expect(events.rows.every((event) => event.status === "pending")).toBe(true);
    expect(events.rows[0]?.event_json.eventVersion).toBe(1);
    expect(events.rows[0]?.occurred_at.toISOString()).toBe(timestamp);
    expect(events.rows[0]?.recorded_at.toISOString()).toBe(laterTimestamp);
  });

  it("narrows a multi-role login to the application role for atomic commands", async () => {
    const narrowedUnit = createPostgresTransactionUnit(fixture!.worker);
    const command = makeCommand(nextId("narrowed-role"));
    try {
      await expect(
        narrowedUnit.execute(command, async (context) => {
          await getPostgresTransaction(context)
            .selectFrom("outbox.consumer_receipts")
            .select("event_id")
            .executeTakeFirst();
          return makeCommit(command, command.commandId);
        }),
      ).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });
    } finally {
      await narrowedUnit.close();
    }
  });

  it("supports zero-event commits and rolls back audit or outbox failures", async () => {
    const zeroCommand = makeCommand(nextId("zero"));
    const zeroCommit = makeCommit(zeroCommand, zeroCommand.commandId, 0);
    await transactionUnit!.execute(zeroCommand, async (context) => {
      await writeFact(context, zeroCommand.payload.factId as string, zeroCommand.projectId);
      return zeroCommit;
    });
    const zeroEvents = await fixture!.adminPool.query(
      "SELECT count(*)::int AS count FROM outbox.events WHERE producer_command_id = $1",
      [zeroCommand.commandId],
    );
    expect(zeroEvents.rows[0]?.count).toBe(0);

    const auditFailureCommand = makeCommand(nextId("audit-failure"));
    const auditFailureCommit = makeCommit(auditFailureCommand, auditFailureCommand.commandId);
    auditFailureCommit.audit.auditEntryId = zeroCommit.audit.auditEntryId;
    auditFailureCommit.events = auditFailureCommit.events.map((event) => ({
      ...event,
      auditTrailRef: auditTrailRef(zeroCommit.audit.auditEntryId),
    }));
    await expect(
      transactionUnit!.execute(auditFailureCommand, async (context) => {
        await writeFact(
          context,
          auditFailureCommand.payload.factId as string,
          auditFailureCommand.projectId,
        );
        return auditFailureCommit;
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });

    const auditFailureFact = await fixture!.adminPool.query(
      "SELECT count(*)::int AS count FROM business.fixture_facts WHERE fact_id = $1",
      [auditFailureCommand.payload.factId],
    );
    const auditFailureReceipt = await fixture!.adminPool.query(
      "SELECT count(*)::int AS count FROM business.command_receipts WHERE command_id = $1",
      [auditFailureCommand.commandId],
    );
    expect(auditFailureFact.rows[0]?.count).toBe(0);
    expect(auditFailureReceipt.rows[0]?.count).toBe(0);

    const duplicateSeedCommand = makeCommand(nextId("duplicate-seed"));
    const duplicateSeedCommit = makeCommit(duplicateSeedCommand, duplicateSeedCommand.commandId);
    await transactionUnit!.execute(duplicateSeedCommand, async (context) => {
      await writeFact(
        context,
        duplicateSeedCommand.payload.factId as string,
        duplicateSeedCommand.projectId,
      );
      return duplicateSeedCommit;
    });

    const outboxFailureCommand = makeCommand(nextId("outbox-failure"));
    const outboxFailureCommit = makeCommit(outboxFailureCommand, outboxFailureCommand.commandId);
    outboxFailureCommit.events[0] = commitEventWithId(
      outboxFailureCommit.events[0]!,
      duplicateSeedCommit.events[0]!.eventId,
    );
    await expect(
      transactionUnit!.execute(outboxFailureCommand, async (context) => {
        await writeFact(
          context,
          outboxFailureCommand.payload.factId as string,
          outboxFailureCommand.projectId,
        );
        return outboxFailureCommit;
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });
    const outboxFailureFact = await fixture!.adminPool.query(
      "SELECT count(*)::int AS count FROM business.fixture_facts WHERE fact_id = $1",
      [outboxFailureCommand.payload.factId],
    );
    expect(outboxFailureFact.rows[0]?.count).toBe(0);
  });

  it("rejects inconsistent events and preserves command identity on idempotent replay", async () => {
    const mismatchCommand = makeCommand(nextId("mismatch"));
    const mismatchCommit = makeCommit(mismatchCommand, mismatchCommand.commandId);
    mismatchCommit.events[0] = { ...mismatchCommit.events[0]!, projectId: "other-project" };
    await expect(
      transactionUnit!.execute(mismatchCommand, async (context) => {
        await writeFact(
          context,
          mismatchCommand.payload.factId as string,
          mismatchCommand.projectId,
        );
        return mismatchCommit;
      }),
    ).rejects.toMatchObject({ code: "EVENT_CONTRACT_INVALID" });
    const mismatchFact = await fixture!.adminPool.query(
      "SELECT count(*)::int AS count FROM business.fixture_facts WHERE fact_id = $1",
      [mismatchCommand.payload.factId],
    );
    expect(mismatchFact.rows[0]?.count).toBe(0);

    const replayCommand = makeCommand(nextId("replay"));
    const replayCommit = makeCommit(replayCommand, replayCommand.commandId);
    let calls = 0;
    const handler = async (context: TransactionContextV1): Promise<AtomicCommitV1> => {
      calls += 1;
      await writeFact(context, replayCommand.payload.factId as string, replayCommand.projectId);
      return replayCommit;
    };
    const first = await transactionUnit!.execute(replayCommand, handler);
    const second = await transactionUnit!.execute(replayCommand, handler);
    expect(calls).toBe(1);
    expect(second).toMatchObject({
      resultRef: first.resultRef,
      auditEntryId: first.auditEntryId,
      eventRefs: first.eventRefs,
      replayed: true,
    });

    const conflictCommand = { ...replayCommand, payload: { factId: "different-fact", value: 99 } };
    await expect(transactionUnit!.execute(conflictCommand, handler)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    const replayFactCount = await fixture!.adminPool.query(
      "SELECT count(*)::int AS count FROM business.fixture_facts WHERE project_id = $1",
      [replayCommand.projectId],
    );
    expect(replayFactCount.rows[0]?.count).toBe(1);
  });

  it("serializes concurrent identical commands to one committed result", async () => {
    const command = makeCommand(nextId("concurrent-command"));
    const commit = makeCommit(command, command.commandId);
    let calls = 0;
    const handler = async (context: TransactionContextV1): Promise<AtomicCommitV1> => {
      calls += 1;
      await writeFact(context, command.payload.factId as string, command.projectId);
      return commit;
    };
    const [first, second] = await Promise.all([
      transactionUnit!.execute(command, handler),
      transactionUnit!.execute(command, handler),
    ]);
    expect(calls).toBe(1);
    expect(first.resultRef).toEqual(second.resultRef);
    expect(first.auditEntryId).toBe(second.auditEntryId);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
  });

  it("claims, retries, confirms, reclaims and exhausts Outbox leases", async () => {
    await fixture!.adminPool.query("DELETE FROM outbox.events");
    const firstSeed = await seedCommand(nextId("outbox"), 1);
    const firstPolicy = policy("first", { batchSize: 1 });
    const firstClaim = await outbox!.claimBatch({
      policy: firstPolicy,
      leaseOwner: "worker-one",
      now: timestamp,
    });
    expect(firstClaim.events).toHaveLength(1);
    expect(firstClaim.events[0]?.eventId).toBe(firstSeed.commit.events[0]?.eventId);
    const acknowledged = await outbox!.acknowledge({
      eventId: firstClaim.events[0]!.eventId,
      leaseOwner: firstClaim.events[0]!.leaseOwner,
      leaseToken: firstClaim.events[0]!.leaseToken,
      now: timestamp,
    });
    expect(acknowledged.status).toBe("published");
    expect(
      (
        await outbox!.claimBatch({
          policy: firstPolicy,
          leaseOwner: "worker-one",
          now: laterTimestamp,
        })
      ).events,
    ).toHaveLength(0);

    const retrySeed = await seedCommand(nextId("outbox-retry"), 2);
    const retryPolicy = policy("retry", { batchSize: 1 });
    const retryClaim = await outbox!.claimBatch({
      policy: retryPolicy,
      leaseOwner: "worker-two",
      now: timestamp,
    });
    expect(retryClaim.events[0]?.eventId).toBe(retrySeed.commit.events[0]?.eventId);
    const failed = await outbox!.recordFailure({
      eventId: retryClaim.events[0]!.eventId,
      leaseOwner: retryClaim.events[0]!.leaseOwner,
      leaseToken: retryClaim.events[0]!.leaseToken,
      policy: retryPolicy,
      errorCode: "temporary-delivery-failure",
      diagnosticRef: diagnosticRef("retry"),
      now: timestamp,
    });
    expect(failed.status).toBe("pending");
    expect(failed.nextAttemptAt).toBe("2030-01-01T00:00:00.100Z");
    const retryClaimed = await outbox!.claimBatch({
      policy: retryPolicy,
      leaseOwner: "worker-three",
      now: failed.nextAttemptAt,
    });
    expect(retryClaimed.events[0]?.attemptCount).toBe(2);

    const leaseSeed = await seedCommand(nextId("outbox-lease"), 3);
    const leasePolicy = policy("lease", { batchSize: 1, leaseDurationMs: 1 });
    const oldClaim = await outbox!.claimBatch({
      policy: leasePolicy,
      leaseOwner: "old-worker",
      now: timestamp,
    });
    expect(oldClaim.events[0]?.eventId).toBe(leaseSeed.commit.events[0]?.eventId);
    const newClaim = await outbox!.claimBatch({
      policy: leasePolicy,
      leaseOwner: "new-worker",
      now: "2030-01-01T00:00:00.002Z",
    });
    expect(newClaim.events[0]?.eventId).toBe(oldClaim.events[0]?.eventId);
    await expect(
      outbox!.acknowledge({
        eventId: oldClaim.events[0]!.eventId,
        leaseOwner: oldClaim.events[0]!.leaseOwner,
        leaseToken: oldClaim.events[0]!.leaseToken,
        now: "2030-01-01T00:00:00.002Z",
      }),
    ).rejects.toMatchObject({ code: "OUTBOX_LEASE_LOST" });
    await outbox!.acknowledge({
      eventId: newClaim.events[0]!.eventId,
      leaseOwner: newClaim.events[0]!.leaseOwner,
      leaseToken: newClaim.events[0]!.leaseToken,
      now: "2030-01-01T00:00:00.002Z",
    });

    const [parallelSeed] = await Promise.all([
      seedCommand(nextId("outbox-parallel-a"), 4),
      seedCommand(nextId("outbox-parallel-b"), 5),
    ]);
    const parallelPolicy = policy("parallel", { batchSize: 1 });
    const [claimedA, claimedB] = await Promise.all([
      outbox!.claimBatch({ policy: parallelPolicy, leaseOwner: "parallel-a", now: timestamp }),
      outbox!.claimBatch({ policy: parallelPolicy, leaseOwner: "parallel-b", now: timestamp }),
    ]);
    expect(new Set([claimedA.events[0]?.eventId, claimedB.events[0]?.eventId]).size).toBe(2);
    expect(
      new Set([
        parallelSeed.commit.events[0]?.eventId,
        claimedA.events[0]?.eventId,
        claimedB.events[0]?.eventId,
      ]).size,
    ).toBe(2);

    const exhaustedSeed = await seedCommand(nextId("outbox-exhausted"), 6);
    const exhaustedPolicy = policy("exhausted", { maxAttempts: 1, batchSize: 1 });
    const exhaustedClaim = await outbox!.claimBatch({
      policy: exhaustedPolicy,
      leaseOwner: "exhausted-worker",
      now: timestamp,
    });
    expect(exhaustedClaim.events[0]?.eventId).toBe(exhaustedSeed.commit.events[0]?.eventId);
    const exhausted = await outbox!.recordFailure({
      eventId: exhaustedClaim.events[0]!.eventId,
      leaseOwner: exhaustedClaim.events[0]!.leaseOwner,
      leaseToken: exhaustedClaim.events[0]!.leaseToken,
      policy: exhaustedPolicy,
      errorCode: "permanent-delivery-failure",
      diagnosticRef: diagnosticRef("exhausted"),
      now: timestamp,
    });
    expect(exhausted.status).toBe("exhausted");
    expect(exhausted.nextAttemptAt).toBeUndefined();
    const exhaustedRow = await fixture!.adminPool.query<{
      status: string;
      next_attempt_at: Date | null;
    }>("SELECT status, next_attempt_at FROM outbox.events WHERE event_id = $1", [
      exhaustedSeed.commit.events[0]!.eventId,
    ]);
    expect(exhaustedRow.rows[0]).toMatchObject({ status: "exhausted", next_attempt_at: null });
  });

  it("freezes Outbox policy and exhausts leases after worker crashes", async () => {
    await fixture!.adminPool.query("DELETE FROM outbox.events");
    const driftSeed = await seedCommand(nextId("outbox-policy-drift"), 7);
    const frozenPolicy = policy("frozen", {
      batchSize: 1,
      leaseDurationMs: 1,
      maxAttempts: 3,
    });
    const driftedPolicy = { ...frozenPolicy, maxAttempts: 4 };
    const firstClaim = await outbox!.claimBatch({
      policy: frozenPolicy,
      leaseOwner: "policy-worker-one",
      now: timestamp,
    });
    expect(firstClaim.events[0]?.eventId).toBe(driftSeed.commit.events[0]?.eventId);
    await expect(
      outbox!.claimBatch({
        policy: driftedPolicy,
        leaseOwner: "policy-worker-two",
        now: "2030-01-01T00:00:00.002Z",
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_FAILED", stage: "outbox.policy" });
    const reclaimed = await outbox!.claimBatch({
      policy: frozenPolicy,
      leaseOwner: "policy-worker-two",
      now: "2030-01-01T00:00:00.002Z",
    });
    await expect(
      outbox!.recordFailure({
        eventId: reclaimed.events[0]!.eventId,
        leaseOwner: reclaimed.events[0]!.leaseOwner,
        leaseToken: reclaimed.events[0]!.leaseToken,
        policy: driftedPolicy,
        errorCode: "policy-drift",
        diagnosticRef: diagnosticRef("policy-drift"),
        now: "2030-01-01T00:00:00.002Z",
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_FAILED", stage: "outbox.policy" });

    await fixture!.adminPool.query("DELETE FROM outbox.events");
    const crashSeed = await seedCommand(nextId("outbox-crash"), 8);
    const crashPolicy = policy("crash", {
      batchSize: 1,
      leaseDurationMs: 1,
      maxAttempts: 1,
    });
    const crashClaim = await outbox!.claimBatch({
      policy: crashPolicy,
      leaseOwner: "crash-worker",
      now: timestamp,
    });
    expect(crashClaim.events[0]?.eventId).toBe(crashSeed.commit.events[0]?.eventId);
    expect(
      (
        await outbox!.claimBatch({
          policy: crashPolicy,
          leaseOwner: "replacement-worker",
          now: "2030-01-01T00:00:00.002Z",
        })
      ).events,
    ).toEqual([]);
    const exhausted = await fixture!.adminPool.query<{
      status: string;
      attempt_count: number;
      delivery_policy_ref: unknown;
      delivery_policy_snapshot: unknown;
      delivery_policy_sha256: string | null;
    }>(
      `SELECT status, attempt_count, delivery_policy_ref, delivery_policy_snapshot, delivery_policy_sha256
       FROM outbox.events WHERE event_id = $1`,
      [crashSeed.commit.events[0]!.eventId],
    );
    expect(exhausted.rows[0]).toMatchObject({
      status: "exhausted",
      attempt_count: 1,
      delivery_policy_ref: crashPolicy.policyRef,
      delivery_policy_snapshot: crashPolicy,
    });
    expect(exhausted.rows[0]?.delivery_policy_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("makes consumer facts and completion receipts idempotent", async () => {
    const seed = await seedCommand(nextId("consumer-success"), 7);
    const event = seed.commit.events[0]!;
    const consumerName = nextId("consumer");
    const consumerResultRef = resultRef(`${consumerName}-result`);
    let calls = 0;
    const handler = async (
      context: TransactionContextV1,
    ): Promise<{ resultRef: typeof consumerResultRef }> => {
      calls += 1;
      await writeFact(context, `consumer-fact-${consumerName}`, event.projectId, 7);
      return { resultRef: consumerResultRef };
    };
    const first = await consumer!.consume(consumerName, event, handler);
    const second = await consumer!.consume(consumerName, event, handler);
    expect(first.replayed).toBe(false);
    expect(second).toMatchObject({ resultRef: consumerResultRef, replayed: true });
    expect(calls).toBe(1);
    const facts = await fixture!.adminPool.query(
      "SELECT count(*)::int AS count FROM business.fixture_facts WHERE fact_id = $1",
      [`consumer-fact-${consumerName}`],
    );
    expect(facts.rows[0]?.count).toBe(1);

    const changedEvent = makeEvent(
      makeCommand(nextId("consumer-changed")),
      event.auditTrailRef.reference.entityId,
      event.eventId,
      "changed-payload",
    );
    await expect(consumer!.consume(consumerName, changedEvent, handler)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(calls).toBe(1);
  });

  it("rolls back failed consumer facts and serializes concurrent duplicates", async () => {
    const failedSeed = await seedCommand(nextId("consumer-failure"), 8);
    const failedEvent = failedSeed.commit.events[0]!;
    const failedName = nextId("consumer-failed");
    let shouldFail = true;
    await expect(
      consumer!.consume(failedName, failedEvent, async (context) => {
        await writeFact(context, `failed-consumer-fact-${failedName}`, failedEvent.projectId, 8);
        if (shouldFail) throw new Error("fixture failure");
        return { resultRef: resultRef(`${failedName}-result`) };
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });
    const failedFact = await fixture!.adminPool.query(
      "SELECT count(*)::int AS count FROM business.fixture_facts WHERE fact_id = $1",
      [`failed-consumer-fact-${failedName}`],
    );
    const pending = await fixture!.adminPool.query<{ status: string; attempt_count: number }>(
      "SELECT status, attempt_count FROM outbox.consumer_receipts WHERE consumer_name = $1 AND event_id = $2",
      [failedName, failedEvent.eventId],
    );
    expect(failedFact.rows[0]?.count).toBe(0);
    expect(pending.rows[0]).toMatchObject({ status: "pending", attempt_count: 1 });

    shouldFail = false;
    const recovered = await consumer!.consume(failedName, failedEvent, async (context) => {
      await writeFact(context, `failed-consumer-fact-${failedName}`, failedEvent.projectId, 8);
      return { resultRef: resultRef(`${failedName}-result`) };
    });
    expect(recovered.replayed).toBe(false);

    const concurrentSeed = await seedCommand(nextId("consumer-concurrent"), 9);
    const concurrentEvent = concurrentSeed.commit.events[0]!;
    const concurrentName = nextId("consumer-concurrent-name");
    let concurrentCalls = 0;
    const concurrentHandler = async (context: TransactionContextV1) => {
      concurrentCalls += 1;
      await writeFact(
        context,
        `concurrent-consumer-fact-${concurrentName}`,
        concurrentEvent.projectId,
        9,
      );
      return { resultRef: resultRef(`${concurrentName}-result`) };
    };
    const [first, second] = await Promise.all([
      consumer!.consume(concurrentName, concurrentEvent, concurrentHandler),
      consumer!.consume(concurrentName, concurrentEvent, concurrentHandler),
    ]);
    expect(concurrentCalls).toBe(1);
    expect(first.resultRef).toEqual(second.resultRef);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    const concurrentFacts = await fixture!.adminPool.query(
      "SELECT count(*)::int AS count FROM business.fixture_facts WHERE fact_id = $1",
      [`concurrent-consumer-fact-${concurrentName}`],
    );
    expect(concurrentFacts.rows[0]?.count).toBe(1);
  });

  it("uses official PostgresSaver setup and isolates checkpoint state", async () => {
    expect(checkpointer).toBeDefined();
    const officialSaver: PostgresSaver = checkpointer!;
    expect(officialSaver).toBeInstanceOf(PostgresSaver);
    expect(officialSaver.getNextVersion(1)).toBe(2);
    await seedCommand(nextId("checkpoint-business"), 1);
    const threadId = nextId("checkpoint-thread");
    const checkpointSuffix = nextId("checkpoint-state");
    const config = { configurable: { thread_id: threadId, checkpoint_ns: "" } } as const;
    const graphState = riskFlowGraphState(threadId, checkpointSuffix);
    const channelVersions = {
      ...Object.fromEntries(Object.keys(graphState).map((channel) => [channel, 1])),
      __pregel_tasks: 1,
    };
    const checkpoint = {
      v: 4,
      id: `1f000000-0000-6000-8000-${String(sequence).padStart(12, "0")}`,
      ts: timestamp,
      channel_values: { ...graphState, __pregel_tasks: [] },
      channel_versions: channelVersions,
      versions_seen: { input: channelVersions },
    } as Parameters<PostgresCheckpointer["put"]>[1];
    const metadata = {
      source: "loop",
      step: 1,
      parents: {},
      schemaVersion: "1",
      runId: nextId("checkpoint-run"),
      threadId,
      commandId: nextId("checkpoint-command"),
      eventId: nextId("checkpoint-event"),
      graphVersion: { entityId: "risk-flow-graph", versionId: "v1" },
      routeDecisionRef: {
        kind: "route-decision",
        reference: { entityId: "route-decision", versionId: "v1" },
      },
      resultRef: resultRef("checkpoint"),
    } as Parameters<PostgresCheckpointer["put"]>[2];
    const savedConfig = await checkpointer!.put(config, checkpoint, metadata, channelVersions);
    await checkpointer!.putWrites(savedConfig, [["stage", "result-summary"]], "checkpoint-task");
    await checkpointer!.putWrites(
      savedConfig,
      [["__interrupt__", { reason: "paused" }]],
      "checkpoint-interrupt",
    );
    const tuple = await checkpointer!.getTuple(savedConfig);
    expect(tuple?.checkpoint.id).toBe(checkpoint.id);
    expect(tuple?.metadata).toMatchObject({ threadId, runId: metadata.runId });
    expect(tuple?.pendingWrites?.map(([, channel]) => channel)).toEqual(
      expect.arrayContaining(["stage", "__interrupt__"]),
    );
    expect((await officialSaver.get(savedConfig))?.id).toBe(checkpoint.id);
    const listed = [];
    for await (const item of checkpointer!.list(config)) listed.push(item);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.checkpoint.id).toBe(checkpoint.id);

    await expect(
      checkpointer!.put(
        config,
        { ...checkpoint, channel_values: { ...graphState, data: { secret: "forbidden" } } },
        metadata,
        channelVersions,
      ),
    ).rejects.toMatchObject({ code: "CHECKPOINT_INCONSISTENT" });
    await expect(
      checkpointer!.putWrites(savedConfig, [["data", { secret: "forbidden" }]], "bad-write"),
    ).rejects.toMatchObject({ code: "CHECKPOINT_INCONSISTENT" });
    await expect(
      checkpointer!.putWrites(savedConfig, [["stage", "I0"]], "wrong-graph-write"),
    ).rejects.toMatchObject({ code: "CHECKPOINT_INCONSISTENT" });
    const missingWriteRef = resultRef("missing-checkpoint-write");
    unavailableReferenceIds.add(missingWriteRef.reference.entityId);
    await expect(
      checkpointer!.putWrites(savedConfig, [["resultRef", missingWriteRef]], "missing-ref-write"),
    ).rejects.toMatchObject({
      code: "CHECKPOINT_INCONSISTENT",
      stage: "checkpointer.reference",
    });
    unavailableReferenceIds.delete(missingWriteRef.reference.entityId);
    await expect(
      checkpointer!.put(
        config,
        { ...checkpoint, password: "forbidden" } as never,
        metadata,
        channelVersions,
      ),
    ).rejects.toMatchObject({ code: "CHECKPOINT_INCONSISTENT" });
    await expect(
      checkpointer!.put(
        config,
        checkpoint,
        { ...metadata, counters_since_delta_snapshot: { stage: [1, "secret"] } } as never,
        channelVersions,
      ),
    ).rejects.toMatchObject({ code: "CHECKPOINT_INCONSISTENT" });
    await expect(
      checkpointer!.put(
        config,
        { ...checkpoint, channel_values: { ...graphState, threadId: "different-thread" } },
        metadata,
        channelVersions,
      ),
    ).rejects.toMatchObject({ code: "CHECKPOINT_INCONSISTENT" });
    await expect(
      checkpointer!.put(
        config,
        checkpoint,
        {
          ...metadata,
          resultRef: { kind: "unknown", reference: { entityId: "bad", versionId: "v1" } },
        } as never,
        channelVersions,
      ),
    ).rejects.toMatchObject({ code: "CHECKPOINT_INCONSISTENT" });

    unavailableReferenceIds.add(graphState.resultRef.reference.entityId);
    await expect(checkpointer!.getTuple(savedConfig)).rejects.toMatchObject({
      code: "CHECKPOINT_INCONSISTENT",
      stage: "checkpointer.reference",
    });
    const listWithMissingReference = async () => {
      const items = [];
      for await (const item of checkpointer!.list(config)) items.push(item);
      return items;
    };
    await expect(listWithMissingReference()).rejects.toMatchObject({
      code: "CHECKPOINT_INCONSISTENT",
      stage: "checkpointer.reference",
    });
    unavailableReferenceIds.delete(graphState.resultRef.reference.entityId);

    const appPool = userPool(fixture!.app);
    const workerPool = userPool(fixture!.worker);
    try {
      await expect(
        appPool.query("SELECT count(*) FROM langgraph_checkpoint.checkpoints"),
      ).rejects.toMatchObject({
        code: "42501",
      });
      await expect(
        workerPool.query("SELECT count(*) FROM langgraph_checkpoint.checkpoints"),
      ).rejects.toMatchObject({
        code: "42501",
      });
    } finally {
      await appPool.end();
      await workerPool.end();
    }

    await checkpointer!.end();
    checkpointer = createPostgresCheckpointer({
      ...fixture!.checkpointer,
      validateReference,
    });
    const restored = await checkpointer.getTuple(savedConfig);
    expect(restored?.checkpoint.id).toBe(checkpoint.id);
    await checkpointer.deleteThread(threadId);
    expect(await checkpointer.getTuple(savedConfig)).toBeUndefined();
    const businessRows = await fixture!.adminPool.query(
      "SELECT count(*)::int AS count FROM business.fixture_facts",
    );
    expect(businessRows.rows[0]?.count).toBeGreaterThan(0);
  });
});

const commitEventWithId = (event: DomainEventV1, eventId: string): DomainEventV1 => ({
  ...event,
  eventId,
});
