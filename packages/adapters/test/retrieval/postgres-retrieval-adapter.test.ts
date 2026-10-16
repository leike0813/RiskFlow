import { createHash } from "node:crypto";

import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainEventV1Schema } from "@riskflow/contracts/events";

import {
  RetrievalActivationV1Schema,
  RetrievalGenerationTransitionV1Schema,
  RetrievalGenerationV1Schema,
  type RetrievalActivationV1,
  type RetrievalGenerationTransitionV1,
  type RetrievalGenerationV1,
} from "@riskflow/core/retrieval";
import type { AtomicCommandV1, AtomicCommitV1 } from "@riskflow/core/persistence";
import type { AuthorizationContextRefV1 } from "@riskflow/contracts/ports";

import { makePersistenceError } from "../../src/postgres/pool.js";
import { createPostgresRuntime } from "../../src/postgres/pool.js";
import { PostgresIdempotentConsumer } from "../../src/postgres/idempotent-consumer.js";
import {
  down as retrievalDown,
  up as retrievalUp,
} from "../../src/postgres/migrations/knowledge-modeling/deliver-versioned-dual-index-hybrid-retrieval/000040_versioned_hybrid_retrieval.js";
import { startRetrievalFixture, type RetrievalTestFixture } from "./postgres-retrieval-fixture.js";

const PROJECT_ID = "project-c20";
const ACTOR_REF = "actor-c20";
const TIMESTAMP = "2030-01-01T00:00:00.000Z";

const sha = (seed: string): string => createHash("sha256").update(seed).digest("hex");

const authorizationContextRef = (suffix: string): AuthorizationContextRefV1 => ({
  kind: "authorization-context",
  reference: { entityId: `authorization-${suffix}`, versionId: "v1" },
});

const makeCommand = (suffix: string): AtomicCommandV1 => ({
  projectId: PROJECT_ID,
  commandKind: "retrieval-fixture",
  commandId: `retrieval-command-${suffix}`,
  idempotencyKey: `retrieval-idempotency-${suffix}`,
  payload: { fixture: suffix },
  actorRef: ACTOR_REF,
  authorizationContextRef: authorizationContextRef(suffix),
  issuedAt: TIMESTAMP,
});

const makeCommit = (command: AtomicCommandV1, suffix: string): AtomicCommitV1 => ({
  resultRef: command.authorizationContextRef,
  audit: {
    auditEntryId: `retrieval-audit-fixture-${suffix}`,
    projectId: command.projectId,
    action: "retrieval-fixture-command",
    targetRef: command.authorizationContextRef,
    actorRef: command.actorRef,
    authorizationContextRef: command.authorizationContextRef,
    occurredAt: TIMESTAMP,
    recordedAt: TIMESTAMP,
    version: command.authorizationContextRef.reference,
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
  },
  events: [],
});

const makeGeneration = (
  suffix: string,
  overrides: {
    readonly projectId?: string;
    readonly evidenceBaseReleaseEntityId?: string;
    readonly policyVersionId?: string;
  } = {},
): RetrievalGenerationV1 =>
  RetrievalGenerationV1Schema.parse({
    schemaVersion: "1",
    generationRef: {
      kind: "retrieval-generation",
      reference: { entityId: `generation-${suffix}`, versionId: sha(`generation-${suffix}`) },
    },
    identity: {
      projectId: overrides.projectId ?? PROJECT_ID,
      sourceEventId: `event-${suffix}`,
      evidenceBaseReleaseRef: {
        kind: "retrieval-evidence-base-release",
        reference: {
          entityId: overrides.evidenceBaseReleaseEntityId ?? "evidence-base",
          versionId: "v1",
        },
      },
      memberReleaseRefs: {
        riskMechanismRef: {
          kind: "knowledge-release",
          reference: { entityId: "risk-mechanism-release", versionId: "v1" },
        },
        standardLibraryRef: {
          kind: "knowledge-release",
          reference: { entityId: "standard-library-release", versionId: "v1" },
        },
        caseLibraryRef: {
          kind: "knowledge-release",
          reference: { entityId: "case-library-release", versionId: "v1" },
        },
      },
      policyRef: { entityId: "retrieval-policy", versionId: overrides.policyVersionId ?? "v1" },
      modelDeploymentRef: { entityId: "embedding-deployment", versionId: "v1" },
      projectionCompatibilityRef: { entityId: "qdrant-1.x", versionId: "v1" },
    },
    collectionName: `retrieval-${suffix}`,
    authorizationScopeDigest: sha(`scope-${suffix}`),
    expectedMemberCount: 3,
    manifestSha256: sha(`manifest-${suffix}`),
    createdAt: TIMESTAMP,
    createdBy: ACTOR_REF,
    authorizationContextRef: authorizationContextRef(suffix),
  });

const buildingTransition = (generation: RetrievalGenerationV1): RetrievalGenerationTransitionV1 =>
  RetrievalGenerationTransitionV1Schema.parse({
    schemaVersion: "1",
    transitionRef: {
      kind: "retrieval-generation-transition",
      reference: {
        entityId: `${generation.generationRef.reference.entityId}:1`,
        versionId: "building",
      },
    },
    generationRef: generation.generationRef,
    ordinal: 1,
    status: "building",
    occurredAt: TIMESTAMP,
  });

const readyTransition = (generation: RetrievalGenerationV1): RetrievalGenerationTransitionV1 =>
  RetrievalGenerationTransitionV1Schema.parse({
    schemaVersion: "1",
    transitionRef: {
      kind: "retrieval-generation-transition",
      reference: {
        entityId: `${generation.generationRef.reference.entityId}:2`,
        versionId: generation.manifestSha256,
      },
    },
    generationRef: generation.generationRef,
    ordinal: 2,
    status: "ready",
    occurredAt: TIMESTAMP,
    manifestSha256: generation.manifestSha256,
  });

const makeActivation = (
  generation: RetrievalGenerationV1,
  activationOrdinal: number,
  previous?: RetrievalGenerationV1,
): RetrievalActivationV1 =>
  RetrievalActivationV1Schema.parse({
    schemaVersion: "1",
    generationRef: generation.generationRef,
    projectId: generation.identity.projectId,
    evidenceBaseReleaseRef: generation.identity.evidenceBaseReleaseRef,
    policyRef: generation.identity.policyRef,
    authorizationScopeDigest: generation.authorizationScopeDigest,
    activationOrdinal,
    ...(previous === undefined ? {} : { previousGenerationRef: previous.generationRef }),
    activatedAt: TIMESTAMP,
    actorRef: ACTOR_REF,
    authorizationContextRef: generation.authorizationContextRef,
  });

const countRows = async (
  fixture: RetrievalTestFixture,
  table: string,
  suffix: string,
): Promise<number> => {
  const result = await sql<{ count: string }>`
    SELECT count(*)::text AS count FROM ${sql.table(`business.${table}`)}
    WHERE generation_id = ${`generation-${suffix}`}
  `.execute(fixture.runtime.db);
  return Number(result.rows[0]?.count ?? "0");
};

describe("PostgreSQL versioned hybrid retrieval facts", () => {
  let fixture: RetrievalTestFixture | undefined;

  beforeAll(async () => {
    fixture = await startRetrievalFixture();
  }, 180_000);

  afterAll(async () => {
    await fixture?.close().catch(() => undefined);
  });

  it("migrates the retrieval fact tables down and back up", async () => {
    const migrator = fixture!.migratorRuntime.db as unknown as Kysely<unknown>;
    const tables = async (): Promise<(string | null)[]> => {
      const result = await sql<{ generation_table: string | null; query_table: string | null }>`
        SELECT to_regclass('business.retrieval_generations')::text AS generation_table,
               to_regclass('business.retrieval_query_results')::text AS query_table
      `.execute(fixture!.runtime.db);
      return [result.rows[0]?.generation_table ?? null, result.rows[0]?.query_table ?? null];
    };
    expect(await tables()).toEqual([
      "business.retrieval_generations",
      "business.retrieval_query_results",
    ]);

    const constraints = await sql<{
      conname: string;
      contype: string;
      condeferrable: boolean;
      condeferred: boolean;
    }>`
      SELECT conname, contype, condeferrable, condeferred
      FROM pg_constraint
      WHERE conname IN (
        'retrieval_generations_identity_uidx',
        'retrieval_query_results_pk',
        'retrieval_generations_audit_fk',
        'retrieval_generation_transitions_audit_fk',
        'retrieval_activations_audit_fk',
        'retrieval_query_results_audit_fk'
      )
      ORDER BY conname
    `.execute(fixture!.runtime.db);
    expect(constraints.rows).toEqual([
      // 审计外键必须延迟：C03 先跑 handler 后写审计行，同事务内插入顺序不保证。
      {
        conname: "retrieval_activations_audit_fk",
        contype: "f",
        condeferrable: true,
        condeferred: true,
      },
      {
        conname: "retrieval_generation_transitions_audit_fk",
        contype: "f",
        condeferrable: true,
        condeferred: true,
      },
      {
        conname: "retrieval_generations_audit_fk",
        contype: "f",
        condeferrable: true,
        condeferred: true,
      },
      {
        conname: "retrieval_generations_identity_uidx",
        contype: "u",
        condeferrable: false,
        condeferred: false,
      },
      {
        conname: "retrieval_query_results_audit_fk",
        contype: "f",
        condeferrable: true,
        condeferred: true,
      },
      {
        conname: "retrieval_query_results_pk",
        contype: "p",
        condeferrable: false,
        condeferred: false,
      },
    ]);

    await retrievalDown(migrator);
    expect(await tables()).toEqual([null, null]);

    await retrievalUp(migrator);
    expect(await tables()).toEqual([
      "business.retrieval_generations",
      "business.retrieval_query_results",
    ]);
  }, 60_000);

  it("commits building, ready and activation inside the caller transaction", async () => {
    const generation = makeGeneration("ambient");
    const command = makeCommand("ambient");
    const result = await fixture!.transactionUnit.execute(command, async (context) => {
      await fixture!.adapter.ensureBuildingGeneration({
        generation,
        transitionRef: buildingTransition(generation).transitionRef,
        actorRef: ACTOR_REF,
        authorizationContextRef: generation.authorizationContextRef,
        occurredAt: TIMESTAMP,
        context,
      });
      await fixture!.adapter.appendTransition({
        transition: readyTransition(generation),
        actorRef: ACTOR_REF,
        authorizationContextRef: generation.authorizationContextRef,
        contextRefs: [generation.identity.evidenceBaseReleaseRef],
        context,
      });
      const activated = await fixture!.adapter.activateGeneration({
        activation: makeActivation(generation, 1),
        contextRefs: [generation.identity.evidenceBaseReleaseRef],
        context,
      });
      expect(activated).toEqual({ kind: "activated" });
      // ambient 事务内必须能读到自己未提交的同事务事实。
      expect(await fixture!.adapter.readGenerationStatus(generation.generationRef, context)).toBe(
        "active",
      );
      expect(await fixture!.adapter.readGeneration(generation.generationRef, context)).toEqual(
        generation,
      );
      return makeCommit(command, "ambient");
    });

    expect(result.replayed).toBe(false);
    expect(await countRows(fixture!, "retrieval_generations", "ambient")).toBe(1);
    expect(await countRows(fixture!, "retrieval_generation_transitions", "ambient")).toBe(3);
    expect(await countRows(fixture!, "retrieval_activations", "ambient")).toBe(1);
    expect(await fixture!.adapter.readGenerationStatus(generation.generationRef)).toBe("active");
    expect(await fixture!.adapter.readActivation(generation.generationRef)).toMatchObject({
      activationOrdinal: 1,
      generationRef: generation.generationRef,
    });
    const active = await fixture!.adapter.readActiveGeneration({
      projectId: PROJECT_ID,
      evidenceBaseReleaseRef: generation.identity.evidenceBaseReleaseRef,
      policyRef: generation.identity.policyRef,
      authorizationScopeDigest: generation.authorizationScopeDigest,
    });
    expect(active?.generationRef).toEqual(generation.generationRef);

    const audits = await sql<{ action: string; audit_entry_id: string }>`
      SELECT action, audit_entry_id FROM audit.entries
      WHERE audit_entry_id LIKE 'retrieval-audit:%'
        AND target_ref->'reference'->>'entityId' = 'evidence-base'
      ORDER BY audit_entry_id
    `.execute(fixture!.runtime.db);
    expect(audits.rows.map((row) => row.action)).toEqual([
      "retrieval-generation.activate.activated",
      "retrieval-generation.ensure",
      "retrieval-generation.ready",
    ]);
  }, 60_000);

  it("leaves no partial fact rows when the caller transaction fails", async () => {
    const generation = makeGeneration("rolledback");
    const orphan = makeGeneration("orphan");
    const command = makeCommand("rolledback");
    await expect(
      fixture!.transactionUnit.execute(command, async (context) => {
        await fixture!.adapter.ensureBuildingGeneration({
          generation,
          transitionRef: buildingTransition(generation).transitionRef,
          actorRef: ACTOR_REF,
          authorizationContextRef: generation.authorizationContextRef,
          occurredAt: TIMESTAMP,
          context,
        });
        await fixture!.adapter.appendTransition({
          transition: readyTransition(generation),
          actorRef: ACTOR_REF,
          authorizationContextRef: generation.authorizationContextRef,
          contextRefs: [],
          context,
        });
        // previousGenerationRef 指向一个从未激活的代际：CAS 必须判冲突且不写任何行。
        const conflict = await fixture!.adapter.activateGeneration({
          activation: makeActivation(generation, 1, orphan),
          contextRefs: [],
          context,
        });
        expect(conflict).toEqual({ kind: "activation-conflict" });
        throw makePersistenceError("TRANSACTION_FAILED", "retrieval-test-consumer-rejected");
      }),
    ).rejects.toMatchObject({
      code: "TRANSACTION_FAILED",
      stage: "retrieval-test-consumer-rejected",
    });

    expect(await countRows(fixture!, "retrieval_generations", "rolledback")).toBe(0);
    expect(await countRows(fixture!, "retrieval_generation_transitions", "rolledback")).toBe(0);
    expect(await countRows(fixture!, "retrieval_activations", "rolledback")).toBe(0);
    const audits = await sql<{ count: string }>`
      SELECT count(*)::text AS count FROM audit.entries
      WHERE audit_entry_id LIKE 'retrieval-audit:%rolledback%'
    `.execute(fixture!.runtime.db);
    expect(audits.rows[0]?.count).toBe("0");
  }, 60_000);

  it("commits a permanent failure transition, audit and consumer receipt together", async () => {
    const generation = makeGeneration("atomic-failure");
    const worker = createPostgresRuntime(fixture!.postgres.worker);
    const consumer = new PostgresIdempotentConsumer(worker.db);
    const event = DomainEventV1Schema.parse({
      schemaVersion: "1",
      eventId: "retrieval-atomic-failure-event",
      eventVersion: 1,
      eventType: "engineering.inputs-ready.v1",
      projectId: PROJECT_ID,
      aggregateRef: {
        kind: "project-revision",
        reference: { entityId: PROJECT_ID, versionId: "v1" },
      },
      occurredAt: TIMESTAMP,
      recordedAt: TIMESTAMP,
      causationId: "retrieval-atomic-failure-command",
      correlationId: "retrieval-atomic-failure-correlation",
      producerCommandId: "retrieval-atomic-failure-command",
      idempotencyKey: "retrieval-atomic-failure-key",
      authorizationContextRef: generation.authorizationContextRef,
      auditTrailRef: {
        kind: "audit-trail",
        reference: { entityId: "retrieval-atomic-failure-audit", versionId: "v1" },
      },
      payload: {
        preparation: {
          kind: "identification",
          identificationPreparationSnapshotRef: {
            kind: "identification-preparation-snapshot",
            reference: { entityId: "retrieval-atomic-failure-preparation", versionId: "v1" },
          },
        },
      },
    });
    const failedTransition = RetrievalGenerationTransitionV1Schema.parse({
      schemaVersion: "1",
      transitionRef: {
        kind: "retrieval-generation-transition",
        reference: { entityId: "generation-atomic-failure:9000", versionId: "quality-gate-failed" },
      },
      generationRef: generation.generationRef,
      ordinal: 9_000,
      status: "failed",
      occurredAt: TIMESTAMP,
      failureCode: "QUALITY_GATE_FAILED",
      noteCode: "quality-gate-failed",
    });
    const consume = (abort: boolean) =>
      consumer.consume("retrieval-atomic-failure", event, async (context) => {
        await fixture!.adapter.ensureBuildingGeneration({
          generation,
          transitionRef: buildingTransition(generation).transitionRef,
          actorRef: ACTOR_REF,
          authorizationContextRef: generation.authorizationContextRef,
          occurredAt: TIMESTAMP,
          context,
        });
        await fixture!.adapter.appendTransition({
          transition: failedTransition,
          actorRef: ACTOR_REF,
          authorizationContextRef: generation.authorizationContextRef,
          contextRefs: [generation.identity.evidenceBaseReleaseRef],
          context,
        });
        if (abort) throw makePersistenceError("TRANSACTION_FAILED", "retrieval.atomic-failure");
        return { resultRef: generation.identity.evidenceBaseReleaseRef };
      });
    try {
      await expect(consume(true)).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });
      expect(await countRows(fixture!, "retrieval_generations", "atomic-failure")).toBe(0);
      expect(await countRows(fixture!, "retrieval_generation_transitions", "atomic-failure")).toBe(
        0,
      );
      const pending = await sql<{ status: string }>`
        SELECT status FROM outbox.consumer_receipts
        WHERE consumer_name = 'retrieval-atomic-failure' AND event_id = ${event.eventId}
      `.execute(worker.db);
      expect(pending.rows[0]?.status).toBe("pending");
      const beforeAudit = await sql<{ count: string }>`
        SELECT count(*)::text AS count FROM audit.entries
        WHERE audit_entry_id LIKE '%generation-atomic-failure%'
      `.execute(worker.db);
      expect(beforeAudit.rows[0]?.count).toBe("0");

      expect((await consume(false)).replayed).toBe(false);
      expect((await consume(false)).replayed).toBe(true);
      expect(await fixture!.adapter.readGenerationStatus(generation.generationRef)).toBe("failed");
      expect(await countRows(fixture!, "retrieval_generation_transitions", "atomic-failure")).toBe(
        2,
      );
      const completed = await sql<{ status: string }>`
        SELECT status FROM outbox.consumer_receipts
        WHERE consumer_name = 'retrieval-atomic-failure' AND event_id = ${event.eventId}
      `.execute(worker.db);
      expect(completed.rows[0]?.status).toBe("completed");
    } finally {
      await worker.close();
    }
  }, 60_000);

  it("keeps one generation per identity input set", async () => {
    const generation = makeGeneration("identity");
    const first = await fixture!.adapter.ensureBuildingGeneration({
      generation,
      transitionRef: buildingTransition(generation).transitionRef,
      actorRef: ACTOR_REF,
      authorizationContextRef: generation.authorizationContextRef,
      occurredAt: TIMESTAMP,
    });
    expect(first.created).toBe(true);
    expect(first.status).toBe("building");

    // 同一身份输入但不同代际引用：返回已存在代际，供调用方判定身份漂移。
    const drifted = RetrievalGenerationV1Schema.parse({
      ...generation,
      generationRef: {
        kind: "retrieval-generation",
        reference: { entityId: "generation-drifted", versionId: sha("generation-drifted") },
      },
    });
    const second = await fixture!.adapter.ensureBuildingGeneration({
      generation: drifted,
      transitionRef: buildingTransition(drifted).transitionRef,
      actorRef: ACTOR_REF,
      authorizationContextRef: drifted.authorizationContextRef,
      occurredAt: TIMESTAMP,
    });
    expect(second.created).toBe(false);
    expect(second.generation.generationRef).toEqual(generation.generationRef);

    const duplicates = await sql<{ count: string }>`
      SELECT count(*)::text AS count FROM business.retrieval_generations
      WHERE project_id = ${PROJECT_ID} AND source_event_id = 'event-identity'
    `.execute(fixture!.runtime.db);
    expect(duplicates.rows[0]?.count).toBe("1");

    // 手写插入同身份、不同代际的行必须被唯一约束拦下。
    await expect(
      sql`
        INSERT INTO business.retrieval_generations (
          generation_id, generation_version_id, schema_version, project_id, source_event_id,
          evidence_base_release_entity_id, evidence_base_release_version_id,
          risk_mechanism_release_entity_id, risk_mechanism_release_version_id,
          standard_library_release_entity_id, standard_library_release_version_id,
          case_library_release_entity_id, case_library_release_version_id,
          policy_entity_id, policy_version_id, model_deployment_entity_id,
          model_deployment_version_id, projection_compatibility_entity_id,
          projection_compatibility_version_id, authorization_scope_digest, expected_member_count,
          manifest_sha256, collection_name, created_by, authorization_context_ref, created_at,
          audit_entry_id
        )
        SELECT ${sha("handwritten")}, ${sha("handwritten-version")}, schema_version, project_id,
               source_event_id, evidence_base_release_entity_id, evidence_base_release_version_id,
               risk_mechanism_release_entity_id, risk_mechanism_release_version_id,
               standard_library_release_entity_id, standard_library_release_version_id,
               case_library_release_entity_id, case_library_release_version_id, policy_entity_id,
               policy_version_id, model_deployment_entity_id, model_deployment_version_id,
               projection_compatibility_entity_id, projection_compatibility_version_id,
               authorization_scope_digest, expected_member_count, manifest_sha256, collection_name,
               created_by, authorization_context_ref, created_at, audit_entry_id
        FROM business.retrieval_generations
        WHERE generation_id = ${generation.generationRef.reference.entityId}
      `.execute(fixture!.runtime.db),
    ).rejects.toMatchObject({ code: "23505" });
  }, 60_000);

  it("appends status transitions only when the state machine allows them", async () => {
    const generation = makeGeneration("status");
    await fixture!.adapter.ensureBuildingGeneration({
      generation,
      transitionRef: buildingTransition(generation).transitionRef,
      actorRef: ACTOR_REF,
      authorizationContextRef: generation.authorizationContextRef,
      occurredAt: TIMESTAMP,
    });
    await fixture!.adapter.appendTransition({
      transition: readyTransition(generation),
      actorRef: ACTOR_REF,
      authorizationContextRef: generation.authorizationContextRef,
      contextRefs: [],
    });
    expect(await fixture!.adapter.readGenerationStatus(generation.generationRef)).toBe("ready");

    // ready -> building 不在允许迁移内，必须拒绝且不改写历史。
    await expect(
      fixture!.adapter.appendTransition({
        transition: RetrievalGenerationTransitionV1Schema.parse({
          ...readyTransition(generation),
          transitionRef: {
            kind: "retrieval-generation-transition",
            reference: { entityId: "generation-status:3", versionId: "building-again" },
          },
          ordinal: 3,
          status: "building",
          manifestSha256: undefined,
        }),
        actorRef: ACTOR_REF,
        authorizationContextRef: generation.authorizationContextRef,
        contextRefs: [],
      }),
    ).rejects.toMatchObject({ stage: "retrieval.transition-illegal" });

    // 同序号同内容的重放视为已追加，不新增行、不报错。
    await fixture!.adapter.appendTransition({
      transition: readyTransition(generation),
      actorRef: ACTOR_REF,
      authorizationContextRef: generation.authorizationContextRef,
      contextRefs: [],
    });

    // ready -> failed 合法：终态必须可判定。
    await fixture!.adapter.appendTransition({
      transition: RetrievalGenerationTransitionV1Schema.parse({
        schemaVersion: "1",
        transitionRef: {
          kind: "retrieval-generation-transition",
          reference: { entityId: "generation-status:5", versionId: "quality:failure" },
        },
        generationRef: generation.generationRef,
        ordinal: 5,
        status: "failed",
        occurredAt: TIMESTAMP,
        failureCode: "QUALITY_GATE_FAILED",
      }),
      actorRef: ACTOR_REF,
      authorizationContextRef: generation.authorizationContextRef,
      contextRefs: [],
    });

    expect(await fixture!.adapter.readGenerationStatus(generation.generationRef)).toBe("failed");
    expect(await countRows(fixture!, "retrieval_generation_transitions", "status")).toBe(3);
    const active = await fixture!.adapter.readActiveGeneration({
      projectId: PROJECT_ID,
      evidenceBaseReleaseRef: generation.identity.evidenceBaseReleaseRef,
      policyRef: generation.identity.policyRef,
      authorizationScopeDigest: generation.authorizationScopeDigest,
    });
    expect(active?.generationRef).not.toEqual(generation.generationRef);
    if (active !== undefined)
      expect(await fixture!.adapter.readGenerationStatus(active.generationRef)).toBe("active");
  }, 60_000);

  it("serializes concurrent activations by compare-and-swap", async () => {
    const series = { evidenceBaseReleaseEntityId: "evidence-base-race" };
    const generations = await Promise.all(
      ["race-a", "race-b", "race-c"].map(async (suffix) => {
        const generation = makeGeneration(suffix, series);
        await fixture!.adapter.ensureBuildingGeneration({
          generation,
          transitionRef: buildingTransition(generation).transitionRef,
          actorRef: ACTOR_REF,
          authorizationContextRef: generation.authorizationContextRef,
          occurredAt: TIMESTAMP,
        });
        await fixture!.adapter.appendTransition({
          transition: readyTransition(generation),
          actorRef: ACTOR_REF,
          authorizationContextRef: generation.authorizationContextRef,
          contextRefs: [],
        });
        return generation;
      }),
    );
    const [first, second, third] = generations as [
      RetrievalGenerationV1,
      RetrievalGenerationV1,
      RetrievalGenerationV1,
    ];
    expect(
      await fixture!.adapter.activateGeneration({
        activation: makeActivation(first, 1),
        contextRefs: [],
      }),
    ).toEqual({ kind: "activated" });
    expect(
      await fixture!.adapter.readCurrentActivation({
        projectId: PROJECT_ID,
        evidenceBaseReleaseRef: second.identity.evidenceBaseReleaseRef,
      }),
    ).toMatchObject({ generationRef: first.generationRef, activationOrdinal: 1 });
    expect(
      await fixture!.adapter.activateGeneration({
        activation: makeActivation(second, 3, first),
        contextRefs: [],
      }),
    ).toEqual({ kind: "activation-conflict" });

    const outcomes = await Promise.all([
      fixture!.adapter.activateGeneration({
        activation: makeActivation(second, 2, first),
        contextRefs: [],
      }),
      fixture!.adapter.activateGeneration({
        activation: makeActivation(third, 2, first),
        contextRefs: [],
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.kind === "activated")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === "activation-conflict")).toHaveLength(1);

    const activations = await sql<{ generation_id: string; activation_ordinal: number }>`
      SELECT generation_id, activation_ordinal FROM business.retrieval_activations
      WHERE evidence_base_release_entity_id = ${series.evidenceBaseReleaseEntityId}
      ORDER BY activation_ordinal
    `.execute(fixture!.runtime.db);
    expect(activations.rows).toHaveLength(2);
    const winnerId = activations.rows[1]?.generation_id;
    expect([
      second.generationRef.reference.entityId,
      third.generationRef.reference.entityId,
    ]).toContain(winnerId);
    expect(await fixture!.adapter.readGenerationStatus(first.generationRef)).toBe("superseded");
    const loser = winnerId === second.generationRef.reference.entityId ? third : second;
    expect(await fixture!.adapter.readGenerationStatus(loser.generationRef)).toBe("ready");
    const active = await fixture!.adapter.readActiveGeneration({
      projectId: PROJECT_ID,
      evidenceBaseReleaseRef: second.identity.evidenceBaseReleaseRef,
      policyRef: second.identity.policyRef,
      authorizationScopeDigest: second.authorizationScopeDigest,
    });
    expect(active?.generationRef.reference.entityId).toBe(winnerId);
  }, 90_000);

  it("registers one formal result per query and rejects a different payload", async () => {
    const generation = makeGeneration("query");
    await fixture!.adapter.ensureBuildingGeneration({
      generation,
      transitionRef: buildingTransition(generation).transitionRef,
      actorRef: ACTOR_REF,
      authorizationContextRef: generation.authorizationContextRef,
      occurredAt: TIMESTAMP,
    });
    await fixture!.adapter.appendTransition({
      transition: readyTransition(generation),
      actorRef: ACTOR_REF,
      authorizationContextRef: generation.authorizationContextRef,
      contextRefs: [],
    });
    const requestDigest = sha("request-query");
    const input = {
      projectId: PROJECT_ID,
      queryId: "query-c20",
      requestDigest,
      generationRef: generation.generationRef,
      policyRef: generation.identity.policyRef,
      authorizationScopeDigest: generation.authorizationScopeDigest,
      resultArtifactRef: {
        kind: "content-artifact" as const,
        reference: { entityId: "query-result-artifact", versionId: `sha256:${sha("artifact")}` },
      },
      knowledgeQueryResultRef: {
        kind: "knowledge-query-result" as const,
        reference: { entityId: "knowledge-query-result", versionId: "v1" },
      },
      recordedAt: TIMESTAMP,
      actorRef: ACTOR_REF,
      authorizationContextRef: generation.authorizationContextRef,
    };
    expect(await fixture!.adapter.registerQueryResult(input)).toEqual({
      kind: "registered",
      replayed: false,
    });
    expect(await fixture!.adapter.registerQueryResult(input)).toEqual({
      kind: "registered",
      replayed: true,
    });
    expect(
      await fixture!.adapter.registerQueryResult({ ...input, requestDigest: sha("request-other") }),
    ).toEqual({ kind: "idempotency-conflict" });

    const stored = await sql<{ count: string; request_digest: string }>`
      SELECT count(*)::text AS count, min(request_digest) AS request_digest
      FROM business.retrieval_query_results
      WHERE project_id = ${PROJECT_ID} AND query_id = 'query-c20'
    `.execute(fixture!.runtime.db);
    expect(stored.rows[0]?.count).toBe("1");
    expect(stored.rows[0]?.request_digest).toBe(requestDigest);
    expect(
      await fixture!.adapter.readQueryResult({ projectId: PROJECT_ID, queryId: "query-c20" }),
    ).toEqual({
      requestDigest,
      knowledgeQueryResultRef: input.knowledgeQueryResultRef,
      resultArtifactRef: input.resultArtifactRef,
    });
  }, 60_000);

  it("reads the active generation only on exact policy and scope match", async () => {
    const generation = makeGeneration("exact", {
      evidenceBaseReleaseEntityId: "evidence-base-exact",
    });
    await fixture!.adapter.ensureBuildingGeneration({
      generation,
      transitionRef: buildingTransition(generation).transitionRef,
      actorRef: ACTOR_REF,
      authorizationContextRef: generation.authorizationContextRef,
      occurredAt: TIMESTAMP,
    });
    await fixture!.adapter.appendTransition({
      transition: readyTransition(generation),
      actorRef: ACTOR_REF,
      authorizationContextRef: generation.authorizationContextRef,
      contextRefs: [],
    });
    expect(
      await fixture!.adapter.activateGeneration({
        activation: makeActivation(generation, 1),
        contextRefs: [],
      }),
    ).toEqual({ kind: "activated" });

    const base = {
      projectId: PROJECT_ID,
      evidenceBaseReleaseRef: generation.identity.evidenceBaseReleaseRef,
      policyRef: generation.identity.policyRef,
      authorizationScopeDigest: generation.authorizationScopeDigest,
    };
    expect((await fixture!.adapter.readActiveGeneration(base))?.generationRef).toEqual(
      generation.generationRef,
    );
    expect(
      await fixture!.adapter.readActiveGeneration({
        ...base,
        policyRef: { entityId: "retrieval-policy", versionId: "v2" },
      }),
    ).toBeUndefined();
    expect(
      (
        await fixture!.adapter.readActiveGeneration({
          ...base,
          authorizationScopeDigest: sha("other-scope"),
        })
      )?.generationRef,
    ).toEqual(generation.generationRef);
    expect(
      await fixture!.adapter.readActiveGeneration({
        ...base,
        evidenceBaseReleaseRef: {
          kind: "retrieval-evidence-base-release",
          reference: { entityId: "evidence-base-other", versionId: "v1" },
        },
      }),
    ).toBeUndefined();
  }, 60_000);

  it("denies update and delete on retrieval facts for the application role", async () => {
    await expect(
      sql`
        UPDATE business.retrieval_generations SET collection_name = 'mutated'
        WHERE generation_id = ${makeGeneration("immutable").generationRef.reference.entityId}
      `.execute(fixture!.runtime.db),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      sql`DELETE FROM business.retrieval_generation_transitions`.execute(fixture!.runtime.db),
    ).rejects.toMatchObject({ code: "42501" });
  }, 60_000);
});
