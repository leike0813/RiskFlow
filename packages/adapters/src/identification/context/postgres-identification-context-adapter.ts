import { randomUUID } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import { ArtifactReadRequestV1Schema, type ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1,
  IdentificationContextResultRowV1Schema,
  type IdentificationContextResultRowV1,
  type IdentificationContextResultStoreV1,
  type OfficialHybridResultReaderV1,
  type OfficialHybridResultV1,
  type RetrievalGenerationStoreV1,
} from "@riskflow/core/identification/context";
import type {
  JsonValue,
  TransactionContextV1,
  TransactionUnitV1,
} from "@riskflow/core/persistence";
import {
  HybridRetrievalResultPayloadV1Schema,
  type HybridRetrievalResultPayloadV1,
} from "@riskflow/core/retrieval";
import type { AuthorizationContextV1, ModuleCapabilityV1 } from "@riskflow/contracts/ports";

import { makePersistenceError, mapPostgresError } from "../../postgres/pool.js";
import { getPostgresTransaction } from "../../postgres/transaction-unit.js";
import type { PostgresDatabase } from "../../postgres/types.js";

/** 混合结果正文的有界读取上限：与 C04 受保护工件读取一致，超出即视为不可信来源。 */
const HYBRID_RESULT_MAX_BYTES_V1 = 8 * 1024 * 1024;
const HYBRID_RESULT_PURPOSE_CODE_V1 = "hybrid-retrieval-query-result";
/** C02 公共分支 `knowledge-modeling.relationship-context → knowledge-modeling.retrieve` 所需能力。 */
const RETRIEVE_CAPABILITY_V1: ModuleCapabilityV1 = "knowledge-modeling.retrieve";

const randomId = (prefix: string): string => `${prefix}-${randomUUID()}`;

interface IdentificationContextResultDbRow {
  project_id: string;
  result_kind: string;
  result_id: string;
  result_version_id: string;
  request_digest: string;
  artifact_ref: JsonValue;
  input_snapshot_ref: JsonValue;
  work_item_ref: JsonValue;
  authorization_scope_digest: string;
  actor_ref: string;
  authorization_context_ref: JsonValue;
  query_id: string | null;
  knowledge_query_result_ref: JsonValue | null;
  agent_task_ref: JsonValue | null;
  baseline_query_result_ref: JsonValue | null;
  retrieval_artifact_set_ref: JsonValue | null;
  relationship_query_result_ref: JsonValue | null;
  model_context_artifact_set_ref: JsonValue | null;
  created_at: Date | string;
  persisted_at: Date | string;
  audit_entry_id: string;
}

interface IdentificationContextDatabase {
  "business.identification_context_results": IdentificationContextResultDbRow;
}

/** 局部交集扩展 Kysely 类型，不改动 C03 公共 `PostgresDatabase` 定义。 */
type IdentificationContextDatabaseV1 = PostgresDatabase & IdentificationContextDatabase;
type IdentificationContextQueryExecutorV1 = Kysely<IdentificationContextDatabaseV1>;
type IdentificationContextTransactionV1 = Transaction<IdentificationContextDatabaseV1>;

/** jsonb 列以文本形式写入，避免驱动二次编码。 */
const jsonValue = (value: unknown): JsonValue => JSON.stringify(value) as unknown as JsonValue;

/** 三类结果只写本类专列，它类专列保持 NULL；与迁移的种类 CHECK 一一对应。 */
const insertColumnsFor = (
  row: IdentificationContextResultRowV1,
  occurredAt: string,
): Record<string, unknown> => ({
  project_id: row.projectId,
  result_kind: row.resultKind,
  result_id: row.resultId,
  result_version_id: row.resultVersionId,
  request_digest: row.requestDigest,
  artifact_ref: jsonValue(row.artifactRef),
  input_snapshot_ref: jsonValue(row.inputSnapshotRef),
  work_item_ref: jsonValue(row.workItemRef),
  authorization_scope_digest: row.authorizationScopeDigest,
  actor_ref: row.actorRef,
  authorization_context_ref: jsonValue(row.authorizationContextRef),
  query_id: row.resultKind === "relationship" ? row.queryId : null,
  knowledge_query_result_ref:
    row.resultKind === "relationship" ? jsonValue(row.knowledgeQueryResultRef) : null,
  agent_task_ref: row.resultKind === "reviewed-retrieval" ? jsonValue(row.agentTaskRef) : null,
  baseline_query_result_ref:
    row.resultKind === "reviewed-retrieval" ? jsonValue(row.baselineQueryResultRef) : null,
  retrieval_artifact_set_ref:
    row.resultKind === "relationship" ? null : jsonValue(row.retrievalArtifactSetRef),
  relationship_query_result_ref:
    row.resultKind === "model-context" ? jsonValue(row.relationshipQueryResultRef) : null,
  model_context_artifact_set_ref:
    row.resultKind === "model-context" ? jsonValue(row.modelContextArtifactSetRef) : null,
  created_at: occurredAt,
  audit_entry_id: `${row.artifactRef.reference.entityId}:register:audit`,
});

/** 回读一律经核心严格判别 Schema 复验，避免数据库补足核心未声明的形状。 */
const resultRowFromDbRow = (
  row: IdentificationContextResultDbRow,
): IdentificationContextResultRowV1 => {
  const base = {
    schemaVersion: IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1,
    projectId: row.project_id,
    resultId: row.result_id,
    resultVersionId: row.result_version_id,
    requestDigest: row.request_digest,
    artifactRef: row.artifact_ref,
    inputSnapshotRef: row.input_snapshot_ref,
    workItemRef: row.work_item_ref,
    authorizationScopeDigest: row.authorization_scope_digest,
    actorRef: row.actor_ref,
    authorizationContextRef: row.authorization_context_ref,
  };
  switch (row.result_kind) {
    case "relationship":
      return IdentificationContextResultRowV1Schema.parse({
        ...base,
        resultKind: "relationship",
        queryId: row.query_id,
        knowledgeQueryResultRef: row.knowledge_query_result_ref,
      });
    case "reviewed-retrieval":
      return IdentificationContextResultRowV1Schema.parse({
        ...base,
        resultKind: "reviewed-retrieval",
        agentTaskRef: row.agent_task_ref,
        baselineQueryResultRef: row.baseline_query_result_ref,
        retrievalArtifactSetRef: row.retrieval_artifact_set_ref,
      });
    case "model-context":
      return IdentificationContextResultRowV1Schema.parse({
        ...base,
        resultKind: "model-context",
        relationshipQueryResultRef: row.relationship_query_result_ref,
        retrievalArtifactSetRef: row.retrieval_artifact_set_ref,
        modelContextArtifactSetRef: row.model_context_artifact_set_ref,
      });
    default:
      throw makePersistenceError(
        "TRANSACTION_FAILED",
        "identification-context.result-row-kind",
        false,
        [],
      );
  }
};

const boundedContent = async (
  content: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of content) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new RangeError("artifact exceeds the bounded read limit");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export interface PostgresIdentificationContextAdapterOptionsV1 {
  /** 传 `runtime.db` 即可；类型为 `Kysely<PostgresDatabase & IdentificationContextDatabase>`。 */
  readonly db: unknown;
  /**
   * C03 事务单元由组合根按与 C20 适配器同形的选项注入；登记只在调用方已持有的 ambient
   * 事务内发生，本适配器不自开事务，也不自行写审计行。
   */
  readonly transactionUnit: TransactionUnitV1;
  /** 与 C20 适配器同形的时钟注入位；登记行时间取自调用方 `occurredAt` 与数据库时钟。 */
  readonly now?: () => Date;
}

/**
 * C21 结果登记适配器（design D-03/D-04）：只登记与回读精确输出引用行，正文只在 C04。
 * `registerResult` 必须在 C03 `TransactionUnitV1.execute` handler 内调用：它写调用方的
 * ambient 事务，幂等由数据库唯一性（主键与关系行的 `(project_id, query_id)` 条件唯一索引）
 * 承担，冲突不改写既有行，重放不新增行；审计行由 C03 事务单元按提交对象统一写入。
 */
export class PostgresIdentificationContextAdapter implements IdentificationContextResultStoreV1 {
  readonly #db: IdentificationContextQueryExecutorV1;

  constructor(options: PostgresIdentificationContextAdapterOptionsV1) {
    this.#db = options.db as unknown as IdentificationContextQueryExecutorV1;
  }

  async registerResult(
    input: {
      readonly row: IdentificationContextResultRowV1;
      readonly occurredAt: string;
    },
    context?: unknown,
  ): Promise<
    | { readonly kind: "registered"; readonly replayed: boolean }
    | { readonly kind: "idempotency-conflict" }
  > {
    try {
      const row = IdentificationContextResultRowV1Schema.parse(input.row);
      const transaction = this.#ambientTransaction(context);
      const inserted = await transaction
        .insertInto("business.identification_context_results")
        .values(insertColumnsFor(row, input.occurredAt) as never)
        .onConflict((conflict) => conflict.doNothing())
        .execute();
      const created = (inserted[0]?.numInsertedOrUpdatedRows ?? 0n) > 0n;
      if (created) return { kind: "registered", replayed: false };

      const stored = await this.#selectResultRowByIdentity(transaction, row);
      if (stored !== undefined) {
        return stored.request_digest === row.requestDigest
          ? { kind: "registered", replayed: true }
          : { kind: "idempotency-conflict" };
      }
      // 主键未命中说明是关系行的 `(project_id, query_id)` 条件唯一约束拦下了异载荷登记。
      if (row.resultKind === "relationship") {
        const existing = await this.#selectRelationshipRow(transaction, {
          projectId: row.projectId,
          queryId: row.queryId,
        });
        if (existing !== undefined) {
          return existing.request_digest === row.requestDigest
            ? { kind: "registered", replayed: true }
            : { kind: "idempotency-conflict" };
        }
      }
      throw makePersistenceError(
        "TRANSACTION_FAILED",
        "identification-context.result-register-conflict",
      );
    } catch (error) {
      throw mapPostgresError(error, "identification-context.result-register");
    }
  }

  async readResult(
    input: Parameters<IdentificationContextResultStoreV1["readResult"]>[0],
  ): Promise<IdentificationContextResultRowV1 | undefined> {
    try {
      let query = this.#db
        .selectFrom("business.identification_context_results")
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("result_kind", "=", input.resultKind);
      if ("resultId" in input) query = query.where("result_id", "=", input.resultId);
      else if ("agentTaskRef" in input)
        query = query.where("agent_task_ref", "=", jsonValue(input.agentTaskRef));
      else
        query = query.where(
          "retrieval_artifact_set_ref",
          "=",
          jsonValue(input.retrievalArtifactSetRef),
        );
      const row = await query.orderBy("persisted_at", "desc").limit(1).executeTakeFirst();
      return row === undefined ? undefined : resultRowFromDbRow(row);
    } catch (error) {
      throw mapPostgresError(error, "identification-context.result-read");
    }
  }

  async readRelationshipResult(input: {
    readonly projectId: string;
    readonly queryId: string;
  }): Promise<
    Extract<IdentificationContextResultRowV1, { readonly resultKind: "relationship" }> | undefined
  > {
    try {
      const row = await this.#selectRelationshipRow(this.#db, input);
      if (row === undefined) return undefined;
      const decoded = resultRowFromDbRow(row);
      return decoded.resultKind === "relationship" ? decoded : undefined;
    } catch (error) {
      throw mapPostgresError(error, "identification-context.relationship-result-read");
    }
  }

  #ambientTransaction(context: unknown): IdentificationContextTransactionV1 {
    if (typeof context !== "object" || context === null) {
      throw makePersistenceError(
        "TRANSACTION_FAILED",
        "identification-context.result-register-transaction",
      );
    }
    return getPostgresTransaction(
      context as TransactionContextV1,
    ) as unknown as IdentificationContextTransactionV1;
  }

  async #selectResultRowByIdentity(
    db: IdentificationContextQueryExecutorV1,
    row: IdentificationContextResultRowV1,
  ): Promise<IdentificationContextResultDbRow | undefined> {
    return db
      .selectFrom("business.identification_context_results")
      .selectAll()
      .where("project_id", "=", row.projectId)
      .where("result_kind", "=", row.resultKind)
      .where("result_id", "=", row.resultId)
      .where("result_version_id", "=", row.resultVersionId)
      .executeTakeFirst();
  }

  async #selectRelationshipRow(
    db: IdentificationContextQueryExecutorV1,
    input: { readonly projectId: string; readonly queryId: string },
  ): Promise<IdentificationContextResultDbRow | undefined> {
    return db
      .selectFrom("business.identification_context_results")
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("result_kind", "=", "relationship")
      .where("query_id", "=", input.queryId)
      .executeTakeFirst();
  }
}

export interface PostgresOfficialHybridResultReaderOptionsV1 {
  /** C20 现有只读结果登记：按 `(projectId, queryId)` 回查，不直读 C20 表。 */
  readonly retrievalStore: Pick<RetrievalGenerationStoreV1, "readQueryResult">;
  readonly artifactStore: ArtifactStoreV1;
  /** 与 C20 适配器同形的时钟注入位；受保护正文读取以调用方 `requestedAt` 为准。 */
  readonly now?: () => Date;
}

/**
 * C20 正式混合结果读取（design D-05）：先按精确查询身份回查已登记结果，再以调用方当前
 * 授权经 C04 有界读取受保护正文。任一资格不符、结果缺失或正文不可解码都封闭失败，
 * 不返回部分结果，也不把 C04/C20 私有结构暴露给调用方。
 */
export class PostgresOfficialHybridResultReader implements OfficialHybridResultReaderV1 {
  readonly #retrievalStore: Pick<RetrievalGenerationStoreV1, "readQueryResult">;
  readonly #artifactStore: ArtifactStoreV1;

  constructor(options: PostgresOfficialHybridResultReaderOptionsV1) {
    this.#retrievalStore = options.retrievalStore;
    this.#artifactStore = options.artifactStore;
  }

  async readOfficial(input: {
    readonly projectId: string;
    readonly queryId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<
    | { readonly kind: "succeeded"; readonly result: OfficialHybridResultV1 }
    | {
        readonly kind: "failed";
        readonly code: "AUTHORIZATION_DENIED" | "ENTITY_NOT_FOUND" | "SOURCE_FACT_DRIFT";
        readonly detailCode: string;
      }
  > {
    const denied = (detailCode: string) =>
      ({ kind: "failed", code: "AUTHORIZATION_DENIED", detailCode }) as const;
    if (input.authorization.projectId !== input.projectId) {
      return denied("authorization-project-mismatch");
    }
    if (input.authorization.actorId !== input.actorId) {
      return denied("authorization-actor-mismatch");
    }
    const requiredCapability = input.authorization.grantedCapabilities[0];
    if (
      requiredCapability === undefined ||
      !input.authorization.grantedCapabilities.includes(RETRIEVE_CAPABILITY_V1)
    ) {
      return denied("retrieve-capability-not-granted");
    }

    const stored = await this.#retrievalStore.readQueryResult({
      projectId: input.projectId,
      queryId: input.queryId,
    });
    if (stored === undefined) {
      return { kind: "failed", code: "ENTITY_NOT_FOUND", detailCode: "query-result-missing" };
    }

    let payload: unknown;
    try {
      const handle = await this.#artifactStore.open(
        ArtifactReadRequestV1Schema.parse({
          schemaVersion: "1",
          requestId: randomId("c21-hybrid-read"),
          idempotencyKey: randomId("c21-hybrid-read"),
          artifactRef: stored.resultArtifactRef,
          projectId: input.projectId,
          actorId: input.actorId,
          requestedAt: input.requestedAt,
          purposeCode: HYBRID_RESULT_PURPOSE_CODE_V1,
          requiredCapability,
          authorization: input.authorization,
        }),
      );
      const bytes = await boundedContent(handle.content, HYBRID_RESULT_MAX_BYTES_V1);
      await handle.completed;
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return {
        kind: "failed",
        code: "SOURCE_FACT_DRIFT",
        detailCode: "hybrid-result-artifact-unreadable",
      };
    }

    const parsed = HybridRetrievalResultPayloadV1Schema.safeParse(payload);
    if (!parsed.success) {
      return { kind: "failed", code: "SOURCE_FACT_DRIFT", detailCode: "hybrid-payload-invalid" };
    }
    return {
      kind: "succeeded",
      result: {
        requestDigest: stored.requestDigest,
        knowledgeQueryResultRef: stored.knowledgeQueryResultRef,
        resultArtifactRef: stored.resultArtifactRef,
        payload: parsed.data as HybridRetrievalResultPayloadV1,
      },
    };
  }
}

export const createPostgresIdentificationContextAdapter = (
  options: PostgresIdentificationContextAdapterOptionsV1,
): PostgresIdentificationContextAdapter => new PostgresIdentificationContextAdapter(options);

export const createPostgresOfficialHybridResultReader = (
  options: PostgresOfficialHybridResultReaderOptionsV1,
): PostgresOfficialHybridResultReader => new PostgresOfficialHybridResultReader(options);
