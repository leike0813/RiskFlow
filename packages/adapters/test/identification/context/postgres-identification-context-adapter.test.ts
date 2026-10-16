/**
 * 合成样本、待甲方复核：本文件所有工程、参与者、查询身份、摘要与工件正文均为合成夹具，
 * 不代表生产数据，也不得作为生产回退来源。
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ArtifactPutCommandV1Schema,
  type ArtifactRefV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1,
  IdentificationContextResultRowV1Schema,
  modelContextArtifactSetRefFor,
  type IdentificationContextResultRowV1,
} from "@riskflow/core/identification/context";
import type {
  AtomicCommandV1,
  AtomicCommitReceiptV1,
  AtomicCommitV1,
} from "@riskflow/core/persistence";
import {
  HybridRetrievalResultPayloadV1Schema,
  type HybridRetrievalResultPayloadV1,
} from "@riskflow/core/retrieval";
import {
  AuthorizationContextV1Schema,
  type AuthorizationContextV1,
  type KnowledgeQueryResultRefV1,
  type ModuleCapabilityV1,
} from "@riskflow/contracts/ports";

import { createFilesystemArtifactStore } from "../../../src/artifacts/filesystem-artifact-store.js";
import { PostgresArtifactRegistry } from "../../../src/artifacts/postgres-artifact-registry.js";
import {
  PostgresIdentificationContextAdapter,
  PostgresOfficialHybridResultReader,
} from "../../../src/identification/context/postgres-identification-context-adapter.js";
import {
  down as identificationContextResultsDown,
  up as identificationContextResultsUp,
} from "../../../src/postgres/migrations/risk-identification/deliver-relationship-context-and-retrieval-agent-review/000041_identification_context_results.js";
import { runPostgresMigrations } from "../../../src/postgres/migrations/run.js";
import { createPostgresRuntime, type PostgresRuntime } from "../../../src/postgres/pool.js";
import { PostgresTransactionUnit } from "../../../src/postgres/transaction-unit.js";
import { artifactPolicy } from "../../artifacts/fixture.js";
import { startPostgresFixture, type PostgresTestFixture } from "../../postgres/fixture.js";

const SYNTHETIC_SAMPLE_LABEL = "合成样本、待甲方复核";

const PROJECT_ID = "project-c21";
const OTHER_PROJECT_ID = "project-c21-other";
const ACTOR_ID = "actor-c21";
const TIMESTAMP = "2030-01-01T00:00:00.000Z";
const HYBRID_PURPOSE_CODE = "hybrid-retrieval-query-result";

const encoder = new TextEncoder();
const sha = (seed: string): string => createHash("sha256").update(seed).digest("hex");
const refOf = <const T extends string>(
  kind: T,
  entityId: string,
  versionId = "v1",
): {
  readonly kind: T;
  readonly reference: { readonly entityId: string; readonly versionId: string };
} => ({
  kind,
  reference: { entityId, versionId },
});
const plainRef = (entityId: string, versionId = "v1") => ({ entityId, versionId });

interface IdentificationContextTestFixture {
  readonly postgres: PostgresTestFixture;
  readonly runtime: PostgresRuntime;
  readonly migratorRuntime: PostgresRuntime;
  readonly transactionUnit: PostgresTransactionUnit;
  readonly adapter: PostgresIdentificationContextAdapter;
  readonly artifactStore: ArtifactStoreV1;
  close(): Promise<void>;
}

/** 单容器夹具：完整生产迁移链 + C04 文件系统工件存储，供登记与正式结果回读共用。 */
const startIdentificationContextFixture = async (): Promise<IdentificationContextTestFixture> => {
  const postgres = await startPostgresFixture();
  try {
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
      additionalMigrationRoots: [postgres.fixtureMigrationRoot],
    });
    const rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c21-context-"));
    const runtime = createPostgresRuntime(postgres.app, "riskflow_app");
    const migratorRuntime = createPostgresRuntime(postgres.migrator, "riskflow_migrator");
    const transactionUnit = new PostgresTransactionUnit(runtime.db);
    const registry = new PostgresArtifactRegistry({
      db: runtime.db,
      transactionUnit,
      pool: runtime.pool,
    });
    const artifactStore = await createFilesystemArtifactStore({
      rootDirectory,
      policy: artifactPolicy(),
      registry,
      transactionUnit,
    });
    const adapter = new PostgresIdentificationContextAdapter({
      db: runtime.db,
      transactionUnit,
    });
    return {
      postgres,
      runtime,
      migratorRuntime,
      transactionUnit,
      adapter,
      artifactStore,
      async close() {
        await artifactStore.close().catch(() => undefined);
        await runtime.close().catch(() => undefined);
        await migratorRuntime.close().catch(() => undefined);
        await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
        await postgres.close().catch(() => undefined);
      },
    };
  } catch (error) {
    await postgres.close().catch(() => undefined);
    throw error;
  }
};

const agentTaskRefFor = (taskEntityId: string) => ({
  kind: "agent-task" as const,
  reference: plainRef(taskEntityId),
  taskType: "retrieval-review" as const,
  triggerMode: "embedded" as const,
  modelDeploymentRef: plainRef("model-deployment"),
  promptTemplateRef: plainRef("prompt-template"),
  toolPolicyRef: plainRef("tool-policy"),
  budgetPolicyRef: plainRef("budget-policy"),
  incrementSchemaRef: plainRef("increment-schema"),
  validationPolicyRef: plainRef("validation-policy"),
});

const baseResultColumns = () => ({
  schemaVersion: IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1,
  projectId: PROJECT_ID,
  inputSnapshotRef: refOf("identification-input-snapshot", "input-snapshot"),
  workItemRef: refOf("identification-work-item", "work-item"),
  actorRef: ACTOR_ID,
  authorizationContextRef: refOf("authorization-context", "authorization-c21"),
});

const relationshipResultRow = (input: {
  readonly queryId: string;
  readonly requestDigest: string;
  readonly projectId?: string;
}): IdentificationContextResultRowV1 => {
  const projectId = input.projectId ?? PROJECT_ID;
  const knowledgeQueryResultRef = refOf(
    "knowledge-query-result",
    `relationship-query-result:${projectId}:${input.queryId}`,
    input.requestDigest,
  );
  return IdentificationContextResultRowV1Schema.parse({
    ...baseResultColumns(),
    projectId,
    resultKind: "relationship",
    resultId: knowledgeQueryResultRef.reference.entityId,
    resultVersionId: input.requestDigest,
    requestDigest: input.requestDigest,
    artifactRef: refOf(
      "content-artifact",
      `relationship-query-result-${input.queryId}`,
      `sha256:${sha(`relationship-artifact-${input.queryId}`)}`,
    ),
    authorizationScopeDigest: sha(`relationship-scope-${input.queryId}`),
    queryId: input.queryId,
    knowledgeQueryResultRef,
  });
};

const reviewedRetrievalResultRow = (input: {
  readonly taskEntityId: string;
  readonly requestDigest: string;
}): IdentificationContextResultRowV1 => {
  const retrievalArtifactSetRef = refOf(
    "retrieval-artifact-set",
    `retrieval-review:${input.taskEntityId}`,
    input.requestDigest,
  );
  return IdentificationContextResultRowV1Schema.parse({
    ...baseResultColumns(),
    resultKind: "reviewed-retrieval",
    resultId: retrievalArtifactSetRef.reference.entityId,
    resultVersionId: input.requestDigest,
    requestDigest: input.requestDigest,
    artifactRef: refOf(
      "content-artifact",
      `retrieval-artifact-set-${input.taskEntityId}`,
      `sha256:${sha(`retrieval-artifact-${input.taskEntityId}`)}`,
    ),
    authorizationScopeDigest: sha(`retrieval-scope-${input.taskEntityId}`),
    agentTaskRef: agentTaskRefFor(input.taskEntityId),
    baselineQueryResultRef: refOf(
      "knowledge-query-result",
      `hybrid-query-result:${PROJECT_ID}:baseline`,
      sha("baseline-request"),
    ),
    retrievalArtifactSetRef,
  });
};

const modelContextResultRow = (input: {
  readonly workItemEntityId: string;
  readonly requestDigest: string;
}): IdentificationContextResultRowV1 => {
  const modelContextArtifactSetRef = modelContextArtifactSetRefFor({
    entityId: `context-${input.workItemEntityId}`,
    requestDigest: input.requestDigest,
  });
  return IdentificationContextResultRowV1Schema.parse({
    ...baseResultColumns(),
    resultKind: "model-context",
    resultId: modelContextArtifactSetRef.reference.entityId,
    resultVersionId: input.requestDigest,
    requestDigest: input.requestDigest,
    artifactRef: refOf(
      "content-artifact",
      `identification-model-context-${input.workItemEntityId}-task-read`,
      `sha256:${sha(`model-context-artifact-${input.workItemEntityId}`)}`,
    ),
    authorizationScopeDigest: sha(`model-context-scope-${input.workItemEntityId}`),
    relationshipQueryResultRef: refOf(
      "knowledge-query-result",
      `relationship-query-result:${PROJECT_ID}:query-read`,
      sha("relationship-request"),
    ),
    retrievalArtifactSetRef: refOf(
      "retrieval-artifact-set",
      "retrieval-review:task-read",
      sha("retrieval-request"),
    ),
    modelContextArtifactSetRef,
  });
};

type RegistrationOutcome =
  | { readonly kind: "registered"; readonly replayed: boolean }
  | { readonly kind: "idempotency-conflict" };

/**
 * 与核心服务 `#persistResult` 同形的命令身份：artifactId 由三类结果的稳定身份派生，
 * 审计 id 为 `${commandId}:audit`；登记行的审计外键必须与此一致才能提交。
 */
const registrationArtifactIdFor = (row: IdentificationContextResultRowV1): string =>
  row.artifactRef.reference.entityId;

const registrationAuditEntryId = (row: IdentificationContextResultRowV1): string =>
  `${registrationArtifactIdFor(row)}:register:audit`;

const registrationCommand = (
  row: IdentificationContextResultRowV1,
  attempt: string,
): AtomicCommandV1 => {
  // 每次尝试都是独立命令身份：C03 按 `(project_id, command_kind, idempotency_key)` 去重，
  // 同一身份的重放必须复用同一 commandId + 幂等键，异身份不得共用一个 commandId。
  const commandId = `${registrationArtifactIdFor(row)}:register:${attempt}`;
  return {
    projectId: row.projectId,
    commandKind: "identification-context-result-register",
    commandId,
    idempotencyKey: commandId,
    payload: { fixture: SYNTHETIC_SAMPLE_LABEL, attempt },
    actorRef: row.actorRef,
    authorizationContextRef: row.authorizationContextRef,
    issuedAt: TIMESTAMP,
  };
};

const registrationCommit = (
  command: AtomicCommandV1,
  row: IdentificationContextResultRowV1,
  auditEntryId: string,
): AtomicCommitV1 => ({
  resultRef: row.artifactRef,
  audit: {
    auditEntryId,
    projectId: command.projectId,
    action: command.commandKind,
    targetRef: row.artifactRef,
    actorRef: command.actorRef,
    authorizationContextRef: command.authorizationContextRef,
    occurredAt: TIMESTAMP,
    recordedAt: TIMESTAMP,
    version: { entityId: row.resultId, versionId: row.resultVersionId },
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
  },
  events: [],
});

/** 登记必须在 C03 handler 内进行；同命令重放由 C03 收据拦下，适配器不再执行。 */
const registerThroughTransaction = async (
  fixture: IdentificationContextTestFixture,
  row: IdentificationContextResultRowV1,
  attempt: string,
  auditEntryId: string = registrationAuditEntryId(row),
): Promise<{
  readonly receipt: AtomicCommitReceiptV1;
  readonly outcome: RegistrationOutcome | undefined;
}> => {
  const command = registrationCommand(row, attempt);
  let outcome: RegistrationOutcome | undefined;
  const receipt = await fixture.transactionUnit.execute(command, async (context) => {
    outcome = await fixture.adapter.registerResult({ row, occurredAt: TIMESTAMP }, context);
    return registrationCommit(command, row, auditEntryId);
  });
  return { receipt, outcome };
};

const countResultRows = async (
  fixture: IdentificationContextTestFixture,
  input: { readonly projectId: string; readonly resultId: string },
): Promise<number> => {
  const result = await sql<{ count: string }>`
    SELECT count(*)::text AS count
    FROM business.identification_context_results
    WHERE project_id = ${input.projectId} AND result_id = ${input.resultId}
  `.execute(fixture.runtime.db);
  return Number(result.rows[0]?.count ?? "0");
};

const countAuditEntries = async (
  fixture: IdentificationContextTestFixture,
  auditEntryId: string,
): Promise<number> => {
  const result = await sql<{ count: string }>`
    SELECT count(*)::text AS count
    FROM audit.entries
    WHERE audit_entry_id = ${auditEntryId}
  `.execute(fixture.runtime.db);
  return Number(result.rows[0]?.count ?? "0");
};

const hybridAuthorization = (
  overrides: {
    readonly projectId?: string;
    readonly actorId?: string;
    readonly capabilities?: readonly ModuleCapabilityV1[];
  } = {},
): AuthorizationContextV1 =>
  AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: refOf("authorization-context", "authorization-hybrid"),
    actorId: overrides.actorId ?? ACTOR_ID,
    projectId: overrides.projectId ?? PROJECT_ID,
    grantedCapabilities: [...(overrides.capabilities ?? ["knowledge-modeling.retrieve"])],
    spatialScopeRefs: [],
    sourceAccessGrantRefs: [],
    authorizationPolicyRef: plainRef("authorization-policy"),
    decidedAt: TIMESTAMP,
    invocation: { kind: "human" },
  });

const hybridPayload = (queryId: string): HybridRetrievalResultPayloadV1 =>
  HybridRetrievalResultPayloadV1Schema.parse({
    schemaVersion: "1",
    queryId,
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    requestedAt: TIMESTAMP,
    completedAt: TIMESTAMP,
    refs: {
      inputSnapshotRef: refOf("identification-input-snapshot", "input-snapshot"),
      workItemRef: refOf("identification-work-item", "work-item"),
      retrievalPolicyRef: plainRef("retrieval-policy"),
    },
    evidenceBaseReleaseRef: refOf("retrieval-evidence-base-release", "evidence-base"),
    memberReleaseRefs: {
      riskMechanismRef: refOf("knowledge-release", "risk-mechanism-release"),
      standardLibraryRef: refOf("knowledge-release", "standard-library-release"),
      caseLibraryRef: refOf("knowledge-release", "case-library-release"),
    },
    generationRef: refOf("retrieval-generation", "retrieval-generation"),
    collectionName: "riskflow-c21-fixture",
    projectionCompatibilityRef: plainRef("qdrant-1.x"),
    policyRef: plainRef("retrieval-policy"),
    modelDeploymentRef: plainRef("model-deployment"),
    embeddingDimensions: 4,
    bm25: {
      model: "qdrant/bm25",
      tokenizer: "multilingual",
      language: "chinese",
      stemmer: "none",
      stopwords: [],
    },
    rrf: { k: 60, denseWeight: 1, bm25Weight: 1 },
    densePrefetchLimit: 8,
    bm25PrefetchLimit: 8,
    topK: 4,
    authorizationScopeDigest: sha("hybrid-scope"),
    authorizationContextRef: refOf("authorization-context", "authorization-hybrid"),
    hits: [],
    scoreSemantics: "ranking-signal-not-confidence",
    knowledgeQueryResultRef: refOf(
      "knowledge-query-result",
      `hybrid-query-result:${PROJECT_ID}:${queryId}`,
      sha(`hybrid-request-${queryId}`),
    ),
  });

const putHybridResultArtifact = async (
  fixture: IdentificationContextTestFixture,
  input: { readonly queryId: string; readonly content: Uint8Array },
): Promise<ArtifactRefV1> => {
  const result = await fixture.artifactStore.put(
    ArtifactPutCommandV1Schema.parse({
      schemaVersion: "1",
      commandId: `c21-fixture-hybrid-${input.queryId}`,
      idempotencyKey: `c21-fixture-hybrid-${input.queryId}`,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      issuedAt: TIMESTAMP,
      authorization: hybridAuthorization(),
      requiredCapability: "knowledge-modeling.retrieve",
      artifactId: `hybrid-retrieval-result-${input.queryId}`,
      artifactKind: "content",
      purposeCode: HYBRID_PURPOSE_CODE,
      mediaType: "application/json",
      parentArtifactRefs: [],
      evidenceReferences: [],
      additionalSpatialScopeRefs: [],
      additionalSourceAccessGrantRefs: [],
    }),
    (async function* () {
      yield input.content;
    })(),
  );
  return result.artifactRef;
};

const readerWithStoredQueryResult = (
  fixture: IdentificationContextTestFixture,
  stored:
    | {
        readonly requestDigest: string;
        readonly knowledgeQueryResultRef: KnowledgeQueryResultRefV1;
        readonly resultArtifactRef: ArtifactRefV1;
      }
    | undefined,
): PostgresOfficialHybridResultReader =>
  new PostgresOfficialHybridResultReader({
    retrievalStore: { readQueryResult: async () => stored },
    artifactStore: fixture.artifactStore,
  });

describe("PostgreSQL identification context result registry", () => {
  let fixture: IdentificationContextTestFixture | undefined;

  beforeAll(async () => {
    fixture = await startIdentificationContextFixture();
  }, 180_000);

  afterAll(async () => {
    await fixture?.close().catch(() => undefined);
  });

  it("migrates the identification context result table down and back up", async () => {
    const migrator = fixture!.migratorRuntime.db as unknown as Kysely<unknown>;
    const registeredTable = async (): Promise<string | null> => {
      const result = await sql<{ name: string | null }>`
        SELECT to_regclass('business.identification_context_results')::text AS name
      `.execute(fixture!.runtime.db);
      return result.rows[0]?.name ?? null;
    };
    expect(await registeredTable()).toBe("business.identification_context_results");

    await identificationContextResultsDown(migrator);
    expect(await registeredTable()).toBeNull();

    await identificationContextResultsUp(migrator);
    await identificationContextResultsUp(migrator);
    expect(await registeredTable()).toBe("business.identification_context_results");
  }, 90_000);

  it("registers one row and one audit entry, then replays without a second row or audit", async () => {
    const row = relationshipResultRow({
      queryId: "query-first",
      requestDigest: sha("request-first"),
    });

    const first = await registerThroughTransaction(fixture!, row, "first");
    expect(first.outcome).toEqual({ kind: "registered", replayed: false });
    expect(await countResultRows(fixture!, row)).toBe(1);
    expect(await countAuditEntries(fixture!, registrationAuditEntryId(row))).toBe(1);

    // 同命令重放：C03 收据直接重放，handler 不再执行，结果行与审计都不新增。
    const replay = await registerThroughTransaction(fixture!, row, "first");
    expect(replay.receipt.replayed).toBe(true);
    expect(replay.outcome).toBeUndefined();
    expect(await countResultRows(fixture!, row)).toBe(1);
    expect(await countAuditEntries(fixture!, registrationAuditEntryId(row))).toBe(1);

    // 异命令同载荷：适配器按已成立结果判为同摘要重放，原行不被改写。
    const repeated = await registerThroughTransaction(
      fixture!,
      row,
      "second",
      `${registrationAuditEntryId(row)}:second`,
    );
    expect(repeated.outcome).toEqual({ kind: "registered", replayed: true });
    expect(await countResultRows(fixture!, row)).toBe(1);

    const stored = await fixture!.adapter.readRelationshipResult({
      projectId: PROJECT_ID,
      queryId: "query-first",
    });
    expect(stored).toEqual(row);
    expect(await countAuditEntries(fixture!, registrationAuditEntryId(row))).toBe(1);
  }, 90_000);

  it("rejects a different payload for the same relationship query and leaves the original row", async () => {
    const queryId = "query-conflict";
    const original = relationshipResultRow({ queryId, requestDigest: sha("request-original") });
    await registerThroughTransaction(fixture!, original, "first");

    const conflicting = relationshipResultRow({ queryId, requestDigest: sha("request-rewritten") });
    const conflicted = await registerThroughTransaction(
      fixture!,
      conflicting,
      "conflict",
      `${registrationAuditEntryId(conflicting)}:conflict`,
    );
    expect(conflicted.outcome).toEqual({ kind: "idempotency-conflict" });
    expect(await countResultRows(fixture!, original)).toBe(1);

    const stored = await fixture!.adapter.readRelationshipResult({
      projectId: PROJECT_ID,
      queryId,
    });
    expect(stored).toEqual(original);
  }, 90_000);

  it("leaves neither row nor audit entry when the transaction aborts after registration", async () => {
    const row = relationshipResultRow({
      queryId: "query-rollback",
      requestDigest: sha("request-rollback"),
    });
    const command = registrationCommand(row, "rollback");

    await expect(
      fixture!.transactionUnit.execute(command, async (context) => {
        await fixture!.adapter.registerResult({ row, occurredAt: TIMESTAMP }, context);
        throw new Error("fixture handler aborted after registration");
      }),
      // C03 不泄漏 handler 异常内容，统一按持久化失败收口；这里断言该失败码而非原文。
    ).rejects.toThrow("TRANSACTION_FAILED");

    expect(await countResultRows(fixture!, row)).toBe(0);
    expect(await countAuditEntries(fixture!, registrationAuditEntryId(row))).toBe(0);
  }, 90_000);

  it("reads stored rows only for their own project, kind and identity", async () => {
    const relationship = relationshipResultRow({
      queryId: "query-read",
      requestDigest: sha("request-read"),
    });
    const reviewed = reviewedRetrievalResultRow({
      taskEntityId: "task-read",
      requestDigest: sha("request-reviewed"),
    });
    const modelContext = modelContextResultRow({
      workItemEntityId: "work-item-read",
      requestDigest: sha("request-context"),
    });
    for (const row of [relationship, reviewed, modelContext]) {
      const registered = await registerThroughTransaction(fixture!, row, "first");
      expect(registered.outcome).toEqual({ kind: "registered", replayed: false });
    }

    expect(
      await fixture!.adapter.readRelationshipResult({
        projectId: PROJECT_ID,
        queryId: "query-read",
      }),
    ).toEqual(relationship);
    expect(
      await fixture!.adapter.readResult({
        projectId: PROJECT_ID,
        resultKind: "reviewed-retrieval",
        resultId: reviewed.resultId,
      }),
    ).toEqual(reviewed);
    expect(
      await fixture!.adapter.readResult({
        projectId: PROJECT_ID,
        resultKind: "model-context",
        resultId: modelContext.resultId,
      }),
    ).toEqual(modelContext);

    expect(
      await fixture!.adapter.readResult({
        projectId: PROJECT_ID,
        resultKind: "reviewed-retrieval",
        agentTaskRef:
          reviewed.resultKind === "reviewed-retrieval"
            ? reviewed.agentTaskRef
            : (() => {
                throw new Error("reviewed fixture required");
              })(),
      }),
    ).toEqual(reviewed);
    expect(
      await fixture!.adapter.readResult({
        projectId: PROJECT_ID,
        resultKind: "model-context",
        retrievalArtifactSetRef:
          modelContext.resultKind === "model-context"
            ? modelContext.retrievalArtifactSetRef
            : (() => {
                throw new Error("model context fixture required");
              })(),
      }),
    ).toEqual(modelContext);

    expect(
      await fixture!.adapter.readRelationshipResult({
        projectId: OTHER_PROJECT_ID,
        queryId: "query-read",
      }),
    ).toBeUndefined();
    expect(
      await fixture!.adapter.readResult({
        projectId: PROJECT_ID,
        resultKind: "reviewed-retrieval",
        resultId: modelContext.resultId,
      }),
    ).toBeUndefined();
    expect(
      await fixture!.adapter.readResult({
        projectId: OTHER_PROJECT_ID,
        resultKind: "model-context",
        resultId: modelContext.resultId,
      }),
    ).toBeUndefined();
  }, 90_000);

  it("keeps the result registry append-only for the application role", async () => {
    const row = relationshipResultRow({
      queryId: "query-append-only",
      requestDigest: sha("request-append-only"),
    });
    await registerThroughTransaction(fixture!, row, "first");

    await expect(
      sql`UPDATE business.identification_context_results
          SET actor_ref = ${"actor-tampered"}`.execute(fixture!.runtime.db),
    ).rejects.toThrow(/permission denied|denied/i);
    await expect(
      sql`DELETE FROM business.identification_context_results`.execute(fixture!.runtime.db),
    ).rejects.toThrow(/permission denied|denied/i);

    expect(
      await fixture!.adapter.readRelationshipResult({
        projectId: PROJECT_ID,
        queryId: "query-append-only",
      }),
    ).toEqual(row);
  }, 90_000);

  it("denies official hybrid reads without the retrieve capability or on identity mismatch", async () => {
    const reader = readerWithStoredQueryResult(fixture!, undefined);

    expect(
      await reader.readOfficial({
        projectId: PROJECT_ID,
        queryId: "query-hybrid",
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: hybridAuthorization({ capabilities: ["engineering-data.read"] }),
      }),
    ).toEqual({
      kind: "failed",
      code: "AUTHORIZATION_DENIED",
      detailCode: "retrieve-capability-not-granted",
    });
    expect(
      await reader.readOfficial({
        projectId: PROJECT_ID,
        queryId: "query-hybrid",
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: hybridAuthorization({ projectId: OTHER_PROJECT_ID }),
      }),
    ).toEqual({
      kind: "failed",
      code: "AUTHORIZATION_DENIED",
      detailCode: "authorization-project-mismatch",
    });
    expect(
      await reader.readOfficial({
        projectId: PROJECT_ID,
        queryId: "query-hybrid",
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: hybridAuthorization({ actorId: "actor-other" }),
      }),
    ).toEqual({
      kind: "failed",
      code: "AUTHORIZATION_DENIED",
      detailCode: "authorization-actor-mismatch",
    });
  }, 90_000);

  it("fails closed when the registered query result or its payload is unusable", async () => {
    const payload = hybridPayload("query-drift");
    const artifactRef = await putHybridResultArtifact(fixture!, {
      queryId: "query-drift",
      content: encoder.encode(JSON.stringify(payload)),
    });
    const stored = {
      requestDigest: sha("request-drift"),
      knowledgeQueryResultRef: payload.knowledgeQueryResultRef,
      resultArtifactRef: artifactRef,
    };

    expect(
      await readerWithStoredQueryResult(fixture!, undefined).readOfficial({
        projectId: PROJECT_ID,
        queryId: "query-drift",
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: hybridAuthorization(),
      }),
    ).toEqual({ kind: "failed", code: "ENTITY_NOT_FOUND", detailCode: "query-result-missing" });

    expect(
      await readerWithStoredQueryResult(fixture!, {
        ...stored,
        resultArtifactRef: await putHybridResultArtifact(fixture!, {
          queryId: "query-drift-malformed",
          content: encoder.encode("{not-json"),
        }),
      }).readOfficial({
        projectId: PROJECT_ID,
        queryId: "query-drift-malformed",
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: hybridAuthorization(),
      }),
    ).toEqual({
      kind: "failed",
      code: "SOURCE_FACT_DRIFT",
      detailCode: "hybrid-result-artifact-unreadable",
    });

    expect(
      await readerWithStoredQueryResult(fixture!, {
        ...stored,
        resultArtifactRef: await putHybridResultArtifact(fixture!, {
          queryId: "query-drift-wrong-schema",
          content: encoder.encode(
            JSON.stringify({ ...payload, schemaVersion: "2", queryId: "query-drift-wrong-schema" }),
          ),
        }),
      }).readOfficial({
        projectId: PROJECT_ID,
        queryId: "query-drift-wrong-schema",
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: hybridAuthorization(),
      }),
    ).toEqual({ kind: "failed", code: "SOURCE_FACT_DRIFT", detailCode: "hybrid-payload-invalid" });

    expect(
      await readerWithStoredQueryResult(fixture!, {
        ...stored,
        resultArtifactRef: await putHybridResultArtifact(fixture!, {
          queryId: "query-drift-oversized",
          content: encoder.encode("x".repeat(8 * 1024 * 1024 + 1)),
        }),
      }).readOfficial({
        projectId: PROJECT_ID,
        queryId: "query-drift-oversized",
        actorId: ACTOR_ID,
        requestedAt: TIMESTAMP,
        authorization: hybridAuthorization(),
      }),
    ).toEqual({
      kind: "failed",
      code: "SOURCE_FACT_DRIFT",
      detailCode: "hybrid-result-artifact-unreadable",
    });
  }, 120_000);

  it("returns the registered official hybrid result with its exact identity and payload", async () => {
    const payload = hybridPayload("query-hybrid");
    const artifactRef = await putHybridResultArtifact(fixture!, {
      queryId: "query-hybrid",
      content: encoder.encode(JSON.stringify(payload)),
    });
    const requestDigest = sha("request-hybrid");

    const result = await readerWithStoredQueryResult(fixture!, {
      requestDigest,
      knowledgeQueryResultRef: payload.knowledgeQueryResultRef,
      resultArtifactRef: artifactRef,
    }).readOfficial({
      projectId: PROJECT_ID,
      queryId: "query-hybrid",
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      authorization: hybridAuthorization(),
    });

    expect(result).toEqual({
      kind: "succeeded",
      result: {
        requestDigest,
        knowledgeQueryResultRef: payload.knowledgeQueryResultRef,
        resultArtifactRef: artifactRef,
        payload,
      },
    });
  }, 90_000);
});
