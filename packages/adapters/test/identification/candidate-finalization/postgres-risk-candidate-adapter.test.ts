/**
 * 合成样本、待甲方复核：本文件所有工程、参与者、命令身份、摘要与工件正文均为合成夹具，
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
  ArtifactReadRequestV1Schema,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
  RiskCandidateFinalizationResultRowV1Schema,
  StandardizedRiskRecordWriteV1Schema,
  type RiskCandidateFinalizationResultRowV1,
  type StandardizedRiskRecordWriteV1,
} from "@riskflow/core/identification/candidate-finalization";
import type {
  AtomicCommandV1,
  AtomicCommitReceiptV1,
  AtomicCommitV1,
} from "@riskflow/core/persistence";
import {
  StandardizedRiskRecordEnvelopeSchema,
  type StandardizedRiskRecordEnvelope,
} from "@riskflow/contracts/records";
import { DomainEventV1Schema, type DomainEventV1 } from "@riskflow/contracts/events";
import {
  AuthorizationContextV1Schema,
  type AuthorizationContextV1,
  type ModuleCapabilityV1,
} from "@riskflow/contracts/ports";

import { createFilesystemArtifactStore } from "../../../src/artifacts/filesystem-artifact-store.js";
import { PostgresArtifactRegistry } from "../../../src/artifacts/postgres-artifact-registry.js";
import { PostgresRiskCandidateFinalizationAdapter } from "../../../src/identification/candidate-finalization/postgres-risk-candidate-adapter.js";
import {
  down as riskCandidateFinalizationDown,
  up as riskCandidateFinalizationUp,
} from "../../../src/postgres/migrations/risk-identification/deliver-risk-candidate-validation-merge-and-acceptance/000042_risk_candidate_finalization.js";
import {
  down as formalZeroResultDown,
  up as formalZeroResultUp,
} from "../../../src/postgres/migrations/risk-identification/fix-c22-formal-zero-result-terminal-fact/000049_formal_zero_result.js";
import { runPostgresMigrations } from "../../../src/postgres/migrations/run.js";
import { createPostgresRuntime, type PostgresRuntime } from "../../../src/postgres/pool.js";
import { PostgresTransactionUnit } from "../../../src/postgres/transaction-unit.js";
import { artifactPolicy } from "../../artifacts/fixture.js";
import { startPostgresFixture, type PostgresTestFixture } from "../../postgres/fixture.js";

const PROJECT_ID = "project-c22";
const OTHER_PROJECT_ID = "project-c22-other";
const ACTOR_ID = "actor-c22";
const TIMESTAMP = "2030-01-01T00:00:00.000Z";
const RESULT_SCOPE_DIGEST = "f".repeat(64);
const CANDIDATE_SET_PURPOSE_CODE = "risk-candidate-set";
const PROVIDED_BODY_MARKER = "合成候选集正文只应存在于 C04";

const encoder = new TextEncoder();
const sha = (seed: string): string => createHash("sha256").update(seed).digest("hex");
const plainRef = (entityId: string, versionId = "v1") => ({ entityId, versionId });
const refOf = <const T extends string>(kind: T, entityId: string, versionId = "v1") =>
  ({ kind, reference: { entityId, versionId } }) as const;

/**
 * C22 持久化夹具：完整生产迁移链 + C04 文件系统工件存储；`close()` 由夹具自己回收
 * 容器、连接池与临时目录，正式记录与中间登记共用同一 `riskflow_app` 连接。
 */
interface RiskCandidateFinalizationTestFixture {
  readonly postgres: PostgresTestFixture;
  readonly runtime: PostgresRuntime;
  readonly migratorRuntime: PostgresRuntime;
  readonly transactionUnit: PostgresTransactionUnit;
  readonly adapter: PostgresRiskCandidateFinalizationAdapter;
  readonly artifactStore: ArtifactStoreV1 & { close(): Promise<void> };
  close(): Promise<void>;
}

/** 单容器夹具：完整生产迁移链 + C04 文件系统工件存储，供登记与正式记录写入共用。 */
const startRiskCandidateFinalizationFixture =
  async (): Promise<RiskCandidateFinalizationTestFixture> => {
    const postgres = await startPostgresFixture();
    try {
      await runPostgresMigrations({
        connection: postgres.migrator,
        migrationRoot: postgres.productionMigrationRoot,
        additionalMigrationRoots: [postgres.fixtureMigrationRoot],
      });
      const rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c22-finalization-"));
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
      const adapter = new PostgresRiskCandidateFinalizationAdapter({
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

const finalizationAuthorization = (
  overrides: {
    readonly projectId?: string;
    readonly actorId?: string;
    readonly capabilities?: readonly ModuleCapabilityV1[];
  } = {},
): AuthorizationContextV1 =>
  AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: refOf("authorization-context", "authorization-c22"),
    actorId: overrides.actorId ?? ACTOR_ID,
    projectId: overrides.projectId ?? PROJECT_ID,
    grantedCapabilities: [...(overrides.capabilities ?? ["risk-identification.run"])],
    spatialScopeRefs: [],
    sourceAccessGrantRefs: [],
    authorizationPolicyRef: plainRef("authorization-policy"),
    decidedAt: TIMESTAMP,
    invocation: { kind: "human" },
  });

const workPlanRef = refOf("identification-work-plan", `identification-work-plan:${PROJECT_ID}`);
const groupRefFor = (groupId: string, versionId: string) =>
  refOf("identification-group", `identification-group:${PROJECT_ID}:${groupId}`, versionId);

/**
 * 九类登记行的最小合法夹具；完整引用形状由核心判别联合限定，这里只按类型提供必需引用，
 * 使迁移的种类 CHECK 与核心 Schema 在同一组输入上互为对照。
 */
const resultRowFor = (
  kind: RiskCandidateFinalizationResultRowV1["resultKind"],
  suffix: string,
): RiskCandidateFinalizationResultRowV1 => {
  const requestDigest = sha(`request-${kind}-${suffix}`);
  const base = {
    schemaVersion: RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
    commandId: `c22-fixture-${kind}-${suffix}`,
    projectId: PROJECT_ID,
    resultId: `result-${kind}-${suffix}`,
    resultVersionId: requestDigest,
    requestDigest,
    artifactRef: refOf(
      "content-artifact",
      `artifact-${kind}-${suffix}`,
      `sha256:${sha(`artifact-body-${kind}-${suffix}`)}`,
    ),
    inputSnapshotRef: refOf("identification-input-snapshot", "input-snapshot"),
    authorizationScopeDigest: RESULT_SCOPE_DIGEST,
    actorRef: ACTOR_ID,
    authorizationContextRef: refOf("authorization-context", "authorization-c22"),
  };
  const candidateSetRef = refOf(
    "identification-candidate-set",
    `identification-candidate-set:${PROJECT_ID}:work-item`,
    sha("candidate-set-request"),
  );
  const mergePlanRef = refOf(
    "merge-plan",
    `merge-plan:${PROJECT_ID}:work-plan`,
    sha("merge-plan-request"),
  );
  const groupRef = groupRefFor("group-1", sha("group-request"));
  switch (kind) {
    case "candidate-set":
      return RiskCandidateFinalizationResultRowV1Schema.parse({
        ...base,
        resultKind: "candidate-set",
        workItemRef: refOf("identification-work-item", "work-item"),
        modelContextArtifactSetRef: refOf(
          "model-context-artifact-set",
          `identification-model-context:${PROJECT_ID}:work-item`,
          sha("model-context-request"),
        ),
        candidateSetRef,
      });
    case "validated-candidate-set":
      return RiskCandidateFinalizationResultRowV1Schema.parse({
        ...base,
        resultKind: "validated-candidate-set",
        workItemRef: refOf("identification-work-item", "work-item"),
        candidateSetRef,
        validatedCandidateSetRef: refOf(
          "validated-candidate-set",
          `validated-candidate-set:${PROJECT_ID}:candidate-set`,
          sha("validated-request"),
        ),
      });
    case "zero-result":
      return RiskCandidateFinalizationResultRowV1Schema.parse({
        ...base,
        resultKind: "zero-result",
        workItemRef: refOf("identification-work-item", "work-item"),
        modelContextArtifactSetRef: refOf(
          "model-context-artifact-set",
          `identification-model-context:${PROJECT_ID}:work-item`,
          sha("model-context-request"),
        ),
        zeroResultRef: refOf(
          "identification-zero-result",
          `identification-zero-result:${PROJECT_ID}:work-item`,
          sha(`zero-result-request-${suffix}`),
        ),
      });
    case "identification-group":
      return RiskCandidateFinalizationResultRowV1Schema.parse({
        ...base,
        resultKind: "identification-group",
        workPlanRef,
        groupRef,
      });
    case "merge-plan":
      return RiskCandidateFinalizationResultRowV1Schema.parse({
        ...base,
        resultKind: "merge-plan",
        workPlanRef,
        mergePlanRef,
      });
    case "validation-snapshot":
      return RiskCandidateFinalizationResultRowV1Schema.parse({
        ...base,
        resultKind: "validation-snapshot",
        workPlanRef,
        groupRef,
        validationSnapshotRef: refOf(
          "validation-snapshot",
          `validation-snapshot:${PROJECT_ID}:group-1`,
          sha("validation-snapshot-request"),
        ),
      });
    case "evidence-snapshot":
      return RiskCandidateFinalizationResultRowV1Schema.parse({
        ...base,
        resultKind: "evidence-snapshot",
        workPlanRef,
        groupRef,
        evidenceSnapshotRef: refOf(
          "evidence-snapshot",
          `evidence-snapshot:${PROJECT_ID}:group-1`,
          sha("evidence-snapshot-request"),
        ),
      });
    case "route-decision":
      return RiskCandidateFinalizationResultRowV1Schema.parse({
        ...base,
        resultKind: "route-decision",
        workPlanRef,
        groupRef,
        routeDecisionRef: refOf(
          "route-decision",
          `route-decision:${PROJECT_ID}:merge-plan:group-1`,
          sha("route-decision-request"),
        ),
      });
    case "acceptance-route-set":
      return RiskCandidateFinalizationResultRowV1Schema.parse({
        ...base,
        resultKind: "acceptance-route-set",
        workPlanRef,
        mergePlanRef,
        acceptanceRouteSetRef: refOf(
          "acceptance-route-set",
          `acceptance-route-set:${PROJECT_ID}:work-plan`,
          sha("acceptance-route-set-request"),
        ),
      });
  }
};

const recordEnvelope = (riskRecordId: string, versionId: string): StandardizedRiskRecordEnvelope =>
  StandardizedRiskRecordEnvelopeSchema.parse({
    riskRecordId,
    record: {
      processNodeId: "process-node-1",
      riskSource: "合成样本、待甲方复核",
      riskFactor: "risk-factor-1",
      riskEvent: "risk-event-1",
      riskElementRelations: [
        { sourceElement: "element-a", relation: "induces", targetElement: "element-b" },
      ],
      evidenceLocator: { sourceSegmentId: "segment-1" },
      modelConfidence: 0.8,
    },
    riskMechanismEntryIds: ["mechanism-1"],
    sourceIds: ["segment-1"],
    compositeConfidence: { value: 0.7, basis: ["model-confidence"] },
    version: {
      reference: plainRef(riskRecordId, versionId),
      effectivePeriod: { validFrom: TIMESTAMP },
      systemTime: { recordedAt: TIMESTAMP },
    },
    audit: { actorId: ACTOR_ID, action: "identification.accept-groups", recordedAt: TIMESTAMP },
  });

const recordWrite = (input: {
  readonly riskRecordId: string;
  readonly requestDigest: string;
  readonly versionId: string;
  readonly decisionSource: "route-decision" | "review-decision";
}): StandardizedRiskRecordWriteV1 =>
  StandardizedRiskRecordWriteV1Schema.parse({
    riskRecordId: input.riskRecordId,
    versionId: input.versionId,
    riskRecordRef: refOf("standardized-risk-record", input.riskRecordId, input.versionId),
    rowId: `row-${input.riskRecordId}`,
    idempotencyKey: `identification.accept-groups:${input.riskRecordId}`,
    requestDigest: input.requestDigest,
    projectId: PROJECT_ID,
    workPlanRef,
    identificationRunRef: refOf("workflow-run", `identification-run:${PROJECT_ID}:work-plan`, "v1"),
    inputSnapshotRef: refOf("identification-input-snapshot", "input-snapshot"),
    mergePlanRef: refOf(
      "merge-plan",
      `merge-plan:${PROJECT_ID}:work-plan`,
      sha("merge-plan-request"),
    ),
    ...(input.decisionSource === "route-decision"
      ? {
          routeDecisionRef: refOf(
            "route-decision",
            `route-decision:${PROJECT_ID}:merge-plan:group-1`,
            sha("route-decision-request"),
          ),
        }
      : {
          reviewDecisionRef: {
            kind: "review-decision" as const,
            reference: plainRef("review-decision-1"),
          },
        }),
    groupId: "group-1",
    groupVersionId: sha("group-request"),
    groupRef: groupRefFor("group-1", sha("group-request")),
    representativeCandidateRefs: [
      refOf("content-artifact", "candidate-artifact-1", `sha256:${sha("candidate-1")}`),
    ],
    sourceSegmentIds: ["segment-1"],
    mechanismEntryIds: ["mechanism-1"],
    authorizationScopeDigest: RESULT_SCOPE_DIGEST,
    authorizationContextRef: refOf("authorization-context", "authorization-c22"),
    actorRef: ACTOR_ID,
    commandId: `c22-accept-groups-${input.riskRecordId}`,
    occurredAt: TIMESTAMP,
  });

const acceptedEvent = (write: StandardizedRiskRecordWriteV1, auditEntryId: string): DomainEventV1 =>
  DomainEventV1Schema.parse({
    schemaVersion: "1",
    eventId: `identification-risk-record-accepted:${write.riskRecordId}:${write.versionId}`,
    eventVersion: 1,
    eventType: "identification.risk-record-accepted.v1",
    projectId: write.projectId,
    aggregateRef: write.riskRecordRef,
    occurredAt: TIMESTAMP,
    recordedAt: TIMESTAMP,
    causationId: write.commandId,
    correlationId: write.identificationRunRef.reference.entityId,
    producerCommandId: write.commandId,
    idempotencyKey: write.idempotencyKey,
    authorizationContextRef: write.authorizationContextRef,
    auditTrailRef: refOf("audit-trail", auditEntryId),
    payload: {
      standardizedRiskRecordRef: write.riskRecordRef,
      identificationInputSnapshotRef: write.inputSnapshotRef,
      identificationRunRef: write.identificationRunRef,
    },
  });

/**
 * 与核心 `#persistRows` 同形的命令身份：原子命令的 `commandId` 就是行携带的命令身份，
 * 审计 id 为 `${commandId}:audit`，因此登记行的审计外键必须由行自身派生才能提交。
 * 重放/冲突尝试使用带后缀的独立命令身份，避免 `command_receipts.command_id` 唯一冲突。
 */
const registrationCommand = (
  row: RiskCandidateFinalizationResultRowV1,
  attempt: string,
): AtomicCommandV1 => {
  const commandId = attempt === "first" ? row.commandId : `${row.commandId}:${attempt}`;
  return {
    projectId: row.projectId,
    commandKind: "identification-finalization-result-register",
    commandId,
    idempotencyKey: commandId,
    payload: { fixture: "合成样本、待甲方复核", attempt },
    actorRef: row.actorRef,
    authorizationContextRef: row.authorizationContextRef,
    issuedAt: TIMESTAMP,
  };
};

const registrationCommit = (
  command: AtomicCommandV1,
  row: RiskCandidateFinalizationResultRowV1,
): AtomicCommitV1 => ({
  resultRef: row.artifactRef,
  audit: {
    // 首次登记必须写核心约定的 `${row.commandId}:audit`；重放尝试写自己的命令审计。
    auditEntryId: `${command.commandId}:audit`,
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

type RegistrationOutcome =
  | { readonly kind: "registered"; readonly replayed: boolean }
  | { readonly kind: "idempotency-conflict" };

const registerThroughTransaction = async (
  fixture: RiskCandidateFinalizationTestFixture,
  row: RiskCandidateFinalizationResultRowV1,
  attempt: string,
): Promise<{
  readonly receipt: AtomicCommitReceiptV1;
  readonly outcome: RegistrationOutcome | undefined;
}> => {
  const command = registrationCommand(row, attempt);
  let outcome: RegistrationOutcome | undefined;
  const receipt = await fixture.transactionUnit.execute(command, async (context) => {
    outcome = await fixture.adapter.registerResults(
      { rows: [row], occurredAt: TIMESTAMP },
      context,
    );
    return registrationCommit(command, row);
  });
  return { receipt, outcome };
};

type RecordInsertOutcome =
  | { readonly kind: "inserted" }
  | { readonly kind: "replayed" }
  | { readonly kind: "conflict"; readonly detailCode: string };

/** C03 事务单元先跑 handler 再写审计；这里按同一顺序驱动正式记录的插入与提交。 */
const insertRecordsThroughTransaction = async (
  fixture: RiskCandidateFinalizationTestFixture,
  input: {
    readonly rows: readonly StandardizedRiskRecordWriteV1[];
    readonly records: readonly StandardizedRiskRecordEnvelope[];
    readonly commandId: string;
    readonly auditEntryId: string;
    readonly events?: readonly DomainEventV1[];
    readonly abortOnNonInserted?: boolean;
  },
): Promise<{ readonly outcome: RecordInsertOutcome | undefined; readonly failed: boolean }> => {
  const command: AtomicCommandV1 = {
    projectId: PROJECT_ID,
    commandKind: "identification.accept-groups",
    commandId: input.commandId,
    idempotencyKey: input.commandId,
    payload: {
      fixture: "合成样本、待甲方复核",
      recordIds: input.rows.map((row) => row.riskRecordId),
    },
    actorRef: ACTOR_ID,
    authorizationContextRef: refOf("authorization-context", "authorization-c22"),
    issuedAt: TIMESTAMP,
  };
  let outcome: RecordInsertOutcome | undefined;
  try {
    await fixture.transactionUnit.execute(command, async (context) => {
      outcome = await fixture.adapter.insertRecords(
        { rows: input.rows, records: input.records, occurredAt: TIMESTAMP },
        context,
      );
      if (input.abortOnNonInserted === true && outcome.kind !== "inserted") {
        throw new Error("record insertion did not create the complete batch");
      }
      return {
        resultRef: input.rows[0]?.riskRecordRef ?? refOf("standardized-risk-record", "none"),
        audit: {
          auditEntryId: input.auditEntryId,
          projectId: command.projectId,
          action: command.commandKind,
          targetRef: input.rows[0]?.riskRecordRef ?? refOf("standardized-risk-record", "none"),
          actorRef: command.actorRef,
          authorizationContextRef: command.authorizationContextRef,
          occurredAt: TIMESTAMP,
          recordedAt: TIMESTAMP,
          version: {
            entityId: input.rows[0]?.riskRecordId ?? "",
            versionId: input.rows[0]?.versionId ?? "v1",
          },
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
        },
        events: input.events ?? [],
      } satisfies AtomicCommitV1;
    });
    return { outcome, failed: false };
  } catch {
    return { outcome, failed: true };
  }
};

const countRows = async (
  fixture: RiskCandidateFinalizationTestFixture,
  query: {
    readonly table:
      "business.identification_finalization_results" | "business.standardized_risk_records";
    readonly projectId: string;
    readonly idColumn: "result_id" | "risk_record_id";
    readonly id: string;
  },
): Promise<number> => {
  const result = await sql<{ count: string }>`
    SELECT count(*)::text AS count
    FROM ${sql.table(query.table)}
    WHERE project_id = ${query.projectId} AND ${sql.ref(query.idColumn)} = ${query.id}
  `.execute(fixture.runtime.db);
  return Number(result.rows[0]?.count ?? "0");
};

const tableExists = async (
  fixture: RiskCandidateFinalizationTestFixture,
  table: string,
): Promise<boolean> => {
  const result = await sql<{ name: string | null }>`
    SELECT to_regclass(${table})::text AS name
  `.execute(fixture.runtime.db);
  return result.rows[0]?.name !== null;
};

/** `000049` 的增量列只在 C22 结果表上断言存在性，用于证明 up/down 收敛到同一列集合。 */
const resultsColumnExists = async (
  fixture: RiskCandidateFinalizationTestFixture,
  column: string,
): Promise<boolean> => {
  const result = await sql<{ count: string }>`
    SELECT count(*)::text AS count
    FROM information_schema.columns
    WHERE table_schema = 'business'
      AND table_name = 'identification_finalization_results'
      AND column_name = ${column}
  `.execute(fixture.runtime.db);
  return Number(result.rows[0]?.count ?? "0") > 0;
};

const readArtifactBody = async (
  fixture: RiskCandidateFinalizationTestFixture,
  input: { readonly entityId: string; readonly versionId: string },
): Promise<string> => {
  const handle = await fixture.artifactStore.open(
    ArtifactReadRequestV1Schema.parse({
      schemaVersion: "1",
      requestId: `c22-fixture-read-${input.entityId}`,
      idempotencyKey: `c22-fixture-read-${input.entityId}`,
      artifactRef: refOf("content-artifact", input.entityId, input.versionId),
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      requestedAt: TIMESTAMP,
      purposeCode: CANDIDATE_SET_PURPOSE_CODE,
      requiredCapability: "risk-identification.run",
      authorization: finalizationAuthorization(),
    }),
  );
  const chunks: Uint8Array[] = [];
  for await (const chunk of handle.content) chunks.push(chunk);
  await handle.verified;
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
};

describe("PostgreSQL risk candidate finalization persistence", () => {
  let fixture: RiskCandidateFinalizationTestFixture | undefined;

  beforeAll(async () => {
    fixture = await startRiskCandidateFinalizationFixture();
  }, 180_000);

  afterAll(async () => {
    await fixture?.close().catch(() => undefined);
  });

  it("migrates the finalization registry and the standardized record table down and back up", async () => {
    const migrator = fixture!.migratorRuntime.db as unknown as Kysely<unknown>;
    expect(await tableExists(fixture!, "business.identification_finalization_results")).toBe(true);
    expect(await tableExists(fixture!, "business.standardized_risk_records")).toBe(true);
    expect(await resultsColumnExists(fixture!, "zero_result_ref")).toBe(true);

    // 按迁移栈逆序退回：`000049` 只撤销自己的列、索引与类别，`000042` 再退掉两张表。
    await formalZeroResultDown(migrator);
    expect(await resultsColumnExists(fixture!, "zero_result_ref")).toBe(false);
    await riskCandidateFinalizationDown(migrator);
    expect(await tableExists(fixture!, "business.identification_finalization_results")).toBe(false);
    expect(await tableExists(fixture!, "business.standardized_risk_records")).toBe(false);

    await riskCandidateFinalizationUp(migrator);
    await riskCandidateFinalizationUp(migrator);
    expect(await resultsColumnExists(fixture!, "zero_result_ref")).toBe(false);
    await formalZeroResultUp(migrator);
    await formalZeroResultUp(migrator);
    expect(await tableExists(fixture!, "business.identification_finalization_results")).toBe(true);
    expect(await tableExists(fixture!, "business.standardized_risk_records")).toBe(true);
    expect(await resultsColumnExists(fixture!, "zero_result_ref")).toBe(true);
  }, 90_000);

  it("limits the zero-result kind to its own column shape and refuses rollback with existing facts", async () => {
    const migrator = fixture!.migratorRuntime.db as unknown as Kysely<unknown>;

    // 尚无零结果行时 down/up 可重复执行，并收敛回同一列与同一部分唯一索引。
    await formalZeroResultDown(migrator);
    expect(await resultsColumnExists(fixture!, "zero_result_ref")).toBe(false);
    // 撤销零结果类别后八类判别约束仍然有效：`000042` 的允许组合不放宽、也不被整条删除。
    await expect(
      sql`INSERT INTO business.identification_finalization_results
            (project_id, result_kind, result_id, result_version_id, command_id, request_digest,
             artifact_ref, input_snapshot_ref, authorization_scope_digest, actor_ref,
             authorization_context_ref, created_at, audit_entry_id)
          VALUES (${PROJECT_ID}, ${"unknown-kind"}, ${"result-unknown-kind"},
             ${sha("unknown-kind")}, ${"command-unknown-kind"}, ${sha("unknown-kind")},
             ${sql.lit(JSON.stringify(refOf("content-artifact", "artifact-unknown-kind")))}::jsonb,
             ${sql.lit(JSON.stringify(refOf("identification-input-snapshot", "input-snapshot-unknown")))}::jsonb,
             ${RESULT_SCOPE_DIGEST}, ${ACTOR_ID},
             ${sql.lit(JSON.stringify(refOf("authorization-context", "authorization-c24")))}::jsonb,
             ${TIMESTAMP}, ${"command-unknown-kind:audit"})`.execute(fixture!.runtime.db),
    ).rejects.toThrow(/check constraint/i);
    await formalZeroResultUp(migrator);
    await formalZeroResultUp(migrator);
    expect(await resultsColumnExists(fixture!, "zero_result_ref")).toBe(true);

    const zeroRow = resultRowFor("zero-result", "guarded-shape");
    expect((await registerThroughTransaction(fixture!, zeroRow, "first")).outcome).toEqual({
      kind: "registered",
      replayed: false,
    });
    const readBack = {
      projectId: PROJECT_ID,
      resultKind: "zero-result" as const,
      resultId: zeroRow.resultId,
      resultVersionId: zeroRow.resultVersionId,
    };
    expect(await fixture!.adapter.readResult(readBack)).toEqual(zeroRow);
    expect(
      await fixture!.adapter.readZeroResult({
        projectId: PROJECT_ID,
        commandId: zeroRow.commandId,
      }),
    ).toEqual(zeroRow);
    expect(
      await fixture!.adapter.readZeroResult({ projectId: PROJECT_ID, commandId: "command-other" }),
    ).toBeUndefined();
    expect(
      await fixture!.adapter.readZeroResult({
        projectId: OTHER_PROJECT_ID,
        commandId: zeroRow.commandId,
      }),
    ).toBeUndefined();

    // 九类 CHECK：零结果行不得携带候选集引用，也不得缺少零结果引用列。
    if (zeroRow.resultKind !== "zero-result") throw new Error("zero-result row is required");
    for (const conflicting of [
      {
        candidate_set_ref: zeroRow.modelContextArtifactSetRef,
        zero_result_ref: zeroRow.zeroResultRef,
      },
      { candidate_set_ref: null, zero_result_ref: null },
    ]) {
      await expect(
        sql`INSERT INTO business.identification_finalization_results
              (project_id, result_kind, result_id, result_version_id, command_id, request_digest,
               artifact_ref, input_snapshot_ref, authorization_scope_digest, actor_ref,
               authorization_context_ref, work_item_ref, model_context_artifact_set_ref,
               candidate_set_ref, zero_result_ref, created_at, audit_entry_id)
            VALUES (${PROJECT_ID}, ${"zero-result"}, ${`result-conflicting-${String(conflicting.zero_result_ref === null)}`},
               ${sha("conflicting-zero-result")}, ${"command-conflicting-zero-result"},
               ${sha("conflicting-zero-result")}, ${sql.lit(JSON.stringify(zeroRow.artifactRef))}::jsonb,
               ${sql.lit(JSON.stringify(zeroRow.inputSnapshotRef))}::jsonb, ${RESULT_SCOPE_DIGEST},
               ${ACTOR_ID}, ${sql.lit(JSON.stringify(zeroRow.authorizationContextRef))}::jsonb,
               ${sql.lit(JSON.stringify(zeroRow.workItemRef))}::jsonb,
               ${sql.lit(JSON.stringify(zeroRow.modelContextArtifactSetRef))}::jsonb,
               ${conflicting.candidate_set_ref === null ? sql`NULL` : sql`${sql.lit(JSON.stringify(conflicting.candidate_set_ref))}::jsonb`},
               ${conflicting.zero_result_ref === null ? sql`NULL` : sql`${sql.lit(JSON.stringify(conflicting.zero_result_ref))}::jsonb`},
               ${TIMESTAMP}, ${`${"command-conflicting-zero-result"}:audit`})`.execute(
          fixture!.runtime.db,
        ),
      ).rejects.toThrow(/check constraint/i);
    }

    // 同一工程与命令身份只允许一条零结果：第二个身份在同一命令下整笔失败，原事实不变。
    const duplicate = resultRowFor("zero-result", "guarded-shape-duplicate");
    await expect(
      registerThroughTransaction(
        fixture!,
        { ...duplicate, commandId: zeroRow.commandId },
        "duplicate",
      ),
    ).rejects.toThrow();
    expect(
      await fixture!.adapter.readZeroResult({
        projectId: PROJECT_ID,
        commandId: zeroRow.commandId,
      }),
    ).toEqual(zeroRow);

    // 已成立零事实时 down 拒绝，事实保持可读。
    await expect(formalZeroResultDown(migrator)).rejects.toThrow();
    expect(await resultsColumnExists(fixture!, "zero_result_ref")).toBe(true);
    expect(await fixture!.adapter.readResult(readBack)).toEqual(zeroRow);
  }, 90_000);

  it("registers every result kind with C04 references only, including one real artifact", async () => {
    const kinds: readonly RiskCandidateFinalizationResultRowV1["resultKind"][] = [
      "candidate-set",
      "zero-result",
      "validated-candidate-set",
      "identification-group",
      "merge-plan",
      "validation-snapshot",
      "evidence-snapshot",
      "route-decision",
      "acceptance-route-set",
    ];
    for (const kind of kinds) {
      const row = resultRowFor(kind, "batch");
      const registered = await registerThroughTransaction(fixture!, row, "first");
      expect(registered.outcome).toEqual({ kind: "registered", replayed: false });
      expect(
        await countRows(fixture!, {
          table: "business.identification_finalization_results",
          projectId: PROJECT_ID,
          idColumn: "result_id",
          id: row.resultId,
        }),
      ).toBe(1);
      expect(
        await fixture!.adapter.readResult({
          projectId: PROJECT_ID,
          resultKind: kind,
          resultId: row.resultId,
          resultVersionId: row.resultVersionId,
        }),
      ).toEqual(row);
    }

    // 一类的正文真实写入 C04，登记表只保存引用与摘要：表内不得出现正文内容。
    const candidateSetRow = resultRowFor("candidate-set", "artifact");
    const body = encoder.encode(`${PROVIDED_BODY_MARKER}:${candidateSetRow.requestDigest}`);
    const put = await fixture!.artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: "1",
        commandId: "c22-fixture-put-candidate-set",
        idempotencyKey: "c22-fixture-put-candidate-set",
        projectId: PROJECT_ID,
        actorId: ACTOR_ID,
        issuedAt: TIMESTAMP,
        authorization: finalizationAuthorization(),
        requiredCapability: "risk-identification.run",
        artifactId: "c22-fixture-candidate-set-body",
        artifactKind: "content",
        purposeCode: CANDIDATE_SET_PURPOSE_CODE,
        mediaType: "application/json",
        parentArtifactRefs: [],
        evidenceReferences: [],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      }),
      (async function* () {
        yield body;
      })(),
    );
    const storedRow = RiskCandidateFinalizationResultRowV1Schema.parse({
      ...candidateSetRow,
      artifactRef: put.artifactRef,
    });
    const registered = await registerThroughTransaction(fixture!, storedRow, "first");
    expect(registered.outcome).toEqual({ kind: "registered", replayed: false });

    const dumped = await sql<Record<string, unknown>>`
      SELECT * FROM business.identification_finalization_results
      WHERE project_id = ${PROJECT_ID} AND result_id = ${storedRow.resultId}
    `.execute(fixture!.runtime.db);
    expect(JSON.stringify(dumped.rows)).not.toContain(PROVIDED_BODY_MARKER);
    expect(
      await readArtifactBody(fixture!, {
        entityId: put.artifactRef.reference.entityId,
        versionId: put.artifactRef.reference.versionId,
      }),
    ).toBe(new TextDecoder().decode(body));
  }, 90_000);

  it("replays a matching digest and conflicts on a different digest for the same result identity", async () => {
    const row = resultRowFor("identification-group", "replay");

    const first = await registerThroughTransaction(fixture!, row, "first");
    expect(first.outcome).toEqual({ kind: "registered", replayed: false });

    // 同命令重放：C03 收据直接重放，handler 不再执行，登记行与审计都不新增。
    const receiptReplay = await registerThroughTransaction(fixture!, row, "first");
    expect(receiptReplay.receipt.replayed).toBe(true);
    expect(receiptReplay.outcome).toBeUndefined();

    // 异命令同载荷：适配器按完整身份判为同摘要重放，原行不被改写。
    const adapterReplay = await registerThroughTransaction(fixture!, row, "second");
    expect(adapterReplay.outcome).toEqual({ kind: "registered", replayed: true });

    // 同身份异摘要：主键命中但请求摘要不同，判为幂等冲突且不改写原行。
    const conflicting = RiskCandidateFinalizationResultRowV1Schema.parse({
      ...row,
      requestDigest: sha("request-group-rewritten"),
    });
    const conflicted = await registerThroughTransaction(fixture!, conflicting, "conflict");
    expect(conflicted.outcome).toEqual({ kind: "idempotency-conflict" });

    expect(
      await countRows(fixture!, {
        table: "business.identification_finalization_results",
        projectId: PROJECT_ID,
        idColumn: "result_id",
        id: row.resultId,
      }),
    ).toBe(1);
    expect(
      await fixture!.adapter.readResult({
        projectId: PROJECT_ID,
        resultKind: "identification-group",
        resultId: row.resultId,
        resultVersionId: row.resultVersionId,
      }),
    ).toEqual(row);
  }, 90_000);

  it("reads registered rows and records only for their own project and identity", async () => {
    const row = resultRowFor("route-decision", "read");
    await registerThroughTransaction(fixture!, row, "first");
    const write = recordWrite({
      riskRecordId: "risk-record-read",
      versionId: sha("risk-record-version-read"),
      requestDigest: sha("risk-record-request-read"),
      decisionSource: "route-decision",
    });
    const inserted = await insertRecordsThroughTransaction(fixture!, {
      rows: [write],
      records: [recordEnvelope(write.riskRecordId, write.versionId)],
      commandId: write.commandId,
      auditEntryId: `${write.commandId}:audit`,
    });
    expect(inserted.failed).toBe(false);
    expect(inserted.outcome).toEqual({ kind: "inserted" });

    expect(
      await fixture!.adapter.readResult({
        projectId: PROJECT_ID,
        resultKind: "route-decision",
        resultId: row.resultId,
        resultVersionId: row.resultVersionId,
      }),
    ).toEqual(row);
    expect(
      await fixture!.adapter.readResult({
        projectId: OTHER_PROJECT_ID,
        resultKind: "route-decision",
        resultId: row.resultId,
        resultVersionId: row.resultVersionId,
      }),
    ).toBeUndefined();
    expect(
      await fixture!.adapter.readResult({
        projectId: PROJECT_ID,
        resultKind: "evidence-snapshot",
        resultId: row.resultId,
        resultVersionId: row.resultVersionId,
      }),
    ).toBeUndefined();
    expect(
      await fixture!.adapter.readResult({
        projectId: PROJECT_ID,
        resultKind: "route-decision",
        resultId: row.resultId,
        resultVersionId: sha("other-version"),
      }),
    ).toBeUndefined();

    expect(
      await fixture!.adapter.readRecord({
        projectId: PROJECT_ID,
        riskRecordId: write.riskRecordId,
      }),
    ).toEqual({
      riskRecordId: write.riskRecordId,
      versionId: write.versionId,
      requestDigest: write.requestDigest,
    });
    expect(
      await fixture!.adapter.readRecord({
        projectId: OTHER_PROJECT_ID,
        riskRecordId: write.riskRecordId,
      }),
    ).toBeUndefined();
  }, 90_000);

  it("keeps both new tables append-only for the application role", async () => {
    await expect(
      sql`UPDATE business.identification_finalization_results
          SET actor_ref = ${"actor-tampered"}`.execute(fixture!.runtime.db),
    ).rejects.toThrow(/permission denied|denied/i);
    await expect(
      sql`DELETE FROM business.identification_finalization_results`.execute(fixture!.runtime.db),
    ).rejects.toThrow(/permission denied|denied/i);
    await expect(
      sql`UPDATE business.standardized_risk_records
          SET actor_ref = ${"actor-tampered"}`.execute(fixture!.runtime.db),
    ).rejects.toThrow(/permission denied|denied/i);
    await expect(
      sql`DELETE FROM business.standardized_risk_records`.execute(fixture!.runtime.db),
    ).rejects.toThrow(/permission denied|denied/i);
  }, 90_000);

  it("inserts standardized risk records once, replays the same identity and conflicts on other content", async () => {
    const write = recordWrite({
      riskRecordId: "risk-record-replay",
      versionId: sha("risk-record-version-replay"),
      requestDigest: sha("risk-record-request-replay"),
      decisionSource: "review-decision",
    });
    const envelope = recordEnvelope(write.riskRecordId, write.versionId);

    const first = await insertRecordsThroughTransaction(fixture!, {
      rows: [write],
      records: [envelope],
      commandId: write.commandId,
      auditEntryId: `${write.commandId}:audit`,
    });
    expect(first.failed).toBe(false);
    expect(first.outcome).toEqual({ kind: "inserted" });
    expect(
      await countRows(fixture!, {
        table: "business.standardized_risk_records",
        projectId: PROJECT_ID,
        idColumn: "risk_record_id",
        id: write.riskRecordId,
      }),
    ).toBe(1);

    // 同身份同载荷：唯一键命中且摘要一致，判为重放且不新增行。
    const replay = await insertRecordsThroughTransaction(fixture!, {
      rows: [write],
      records: [envelope],
      commandId: `${write.commandId}:replay`,
      auditEntryId: `${write.commandId}:replay:audit`,
    });
    expect(replay.failed).toBe(false);
    expect(replay.outcome).toEqual({ kind: "replayed" });

    // 同身份异载荷：唯一键命中但摘要不同，判为冲突且保持原记录。
    const conflicting = recordWrite({
      riskRecordId: write.riskRecordId,
      versionId: sha("risk-record-version-conflict"),
      requestDigest: sha("risk-record-request-conflict"),
      decisionSource: "review-decision",
    });
    const conflicted = await insertRecordsThroughTransaction(fixture!, {
      rows: [conflicting],
      records: [recordEnvelope(conflicting.riskRecordId, conflicting.versionId)],
      commandId: `${conflicting.commandId}:conflict`,
      auditEntryId: `${conflicting.commandId}:conflict:audit`,
    });
    expect(conflicted.failed).toBe(false);
    expect(conflicted.outcome).toEqual({
      kind: "conflict",
      detailCode: "standardized-risk-record-payload-mismatch",
    });

    expect(
      await countRows(fixture!, {
        table: "business.standardized_risk_records",
        projectId: PROJECT_ID,
        idColumn: "risk_record_id",
        id: write.riskRecordId,
      }),
    ).toBe(1);
    expect(
      await fixture!.adapter.readRecord({
        projectId: PROJECT_ID,
        riskRecordId: write.riskRecordId,
      }),
    ).toEqual({
      riskRecordId: write.riskRecordId,
      versionId: write.versionId,
      requestDigest: write.requestDigest,
    });
  }, 90_000);

  it("rejects and rolls back a record batch that only partially overlaps existing identities", async () => {
    const existing = recordWrite({
      riskRecordId: "risk-record-partial-existing",
      versionId: sha("risk-record-version-partial-existing"),
      requestDigest: sha("risk-record-request-partial-existing"),
      decisionSource: "route-decision",
    });
    const pending = recordWrite({
      riskRecordId: "risk-record-partial-pending",
      versionId: sha("risk-record-version-partial-pending"),
      requestDigest: sha("risk-record-request-partial-pending"),
      decisionSource: "route-decision",
    });
    const first = await insertRecordsThroughTransaction(fixture!, {
      rows: [existing],
      records: [recordEnvelope(existing.riskRecordId, existing.versionId)],
      commandId: existing.commandId,
      auditEntryId: `${existing.commandId}:audit`,
    });
    expect(first.outcome).toEqual({ kind: "inserted" });

    const partial = await insertRecordsThroughTransaction(fixture!, {
      rows: [existing, pending],
      records: [
        recordEnvelope(existing.riskRecordId, existing.versionId),
        recordEnvelope(pending.riskRecordId, pending.versionId),
      ],
      commandId: `${pending.commandId}:batch`,
      auditEntryId: `${pending.commandId}:batch:audit`,
      abortOnNonInserted: true,
    });

    expect(partial.failed).toBe(true);
    expect(partial.outcome).toEqual({
      kind: "conflict",
      detailCode: "standardized-risk-record-partial-overlap",
    });
    expect(
      await countRows(fixture!, {
        table: "business.standardized_risk_records",
        projectId: PROJECT_ID,
        idColumn: "risk_record_id",
        id: pending.riskRecordId,
      }),
    ).toBe(0);
  }, 90_000);

  it("serializes concurrent inserts of one risk record into a single row", async () => {
    const write = recordWrite({
      riskRecordId: "risk-record-concurrent",
      versionId: sha("risk-record-version-concurrent"),
      requestDigest: sha("risk-record-request-concurrent"),
      decisionSource: "route-decision",
    });
    const envelope = recordEnvelope(write.riskRecordId, write.versionId);

    const [left, right] = await Promise.all([
      insertRecordsThroughTransaction(fixture!, {
        rows: [write],
        records: [envelope],
        commandId: write.commandId,
        auditEntryId: `${write.commandId}:audit`,
      }),
      insertRecordsThroughTransaction(fixture!, {
        rows: [write],
        records: [envelope],
        commandId: `${write.commandId}:rival`,
        auditEntryId: `${write.commandId}:rival:audit`,
      }),
    ]);
    expect([left.outcome?.kind, right.outcome?.kind].sort()).toEqual(["inserted", "replayed"]);
    expect(
      await countRows(fixture!, {
        table: "business.standardized_risk_records",
        projectId: PROJECT_ID,
        idColumn: "risk_record_id",
        id: write.riskRecordId,
      }),
    ).toBe(1);
  }, 90_000);

  it("fails the commit when the record audit identity has no matching audit entry", async () => {
    const write = recordWrite({
      riskRecordId: "risk-record-orphan-audit",
      versionId: sha("risk-record-version-orphan"),
      requestDigest: sha("risk-record-request-orphan"),
      decisionSource: "route-decision",
    });
    const result = await insertRecordsThroughTransaction(fixture!, {
      rows: [write],
      records: [recordEnvelope(write.riskRecordId, write.versionId)],
      commandId: write.commandId,
      auditEntryId: "audit-unmatched-orphan",
    });
    expect(result.failed).toBe(true);
    expect(
      await countRows(fixture!, {
        table: "business.standardized_risk_records",
        projectId: PROJECT_ID,
        idColumn: "risk_record_id",
        id: write.riskRecordId,
      }),
    ).toBe(0);
  }, 90_000);

  it("rolls back the risk record when the accepted event cannot enter the Outbox", async () => {
    const write = recordWrite({
      riskRecordId: "risk-record-outbox-rollback",
      versionId: sha("risk-record-version-outbox-rollback"),
      requestDigest: sha("risk-record-request-outbox-rollback"),
      decisionSource: "route-decision",
    });
    const auditEntryId = `${write.commandId}:audit`;

    await fixture!.postgres.adminPool.query(
      "REVOKE INSERT ON TABLE outbox.events FROM riskflow_app",
    );
    try {
      const result = await insertRecordsThroughTransaction(fixture!, {
        rows: [write],
        records: [recordEnvelope(write.riskRecordId, write.versionId)],
        commandId: write.commandId,
        auditEntryId,
        events: [acceptedEvent(write, auditEntryId)],
      });
      expect(result.failed).toBe(true);
    } finally {
      await fixture!.postgres.adminPool.query(
        "GRANT INSERT ON TABLE outbox.events TO riskflow_app",
      );
    }

    expect(
      await countRows(fixture!, {
        table: "business.standardized_risk_records",
        projectId: PROJECT_ID,
        idColumn: "risk_record_id",
        id: write.riskRecordId,
      }),
    ).toBe(0);
  }, 90_000);
});
