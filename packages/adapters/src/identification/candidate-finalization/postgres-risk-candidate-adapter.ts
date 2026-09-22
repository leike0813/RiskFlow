import type { Kysely, Transaction } from "kysely";

import {
  RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
  RiskCandidateFinalizationResultRowV1Schema,
  StandardizedRiskRecordWriteV1Schema,
  type RiskCandidateFinalizationResultRowV1,
  type RiskCandidateFinalizationResultStoreV1,
  type StandardizedRiskRecordStoreV1,
  type StandardizedRiskRecordWriteV1,
} from "@riskflow/core/identification/candidate-finalization";
import type {
  JsonValue,
  TransactionContextV1,
  TransactionUnitV1,
} from "@riskflow/core/persistence";
import type { StandardizedRiskRecordEnvelope } from "@riskflow/contracts/records";

import { makePersistenceError, mapPostgresError } from "../../postgres/pool.js";
import { getPostgresTransaction } from "../../postgres/transaction-unit.js";
import type { PostgresDatabase } from "../../postgres/types.js";

const RESULTS_TABLE = "business.identification_finalization_results";
const RECORDS_TABLE = "business.standardized_risk_records";

interface IdentificationFinalizationResultDbRow {
  project_id: string;
  result_kind: string;
  result_id: string;
  result_version_id: string;
  command_id: string;
  request_digest: string;
  artifact_ref: JsonValue;
  input_snapshot_ref: JsonValue;
  authorization_scope_digest: string;
  actor_ref: string;
  authorization_context_ref: JsonValue;
  work_item_ref: JsonValue | null;
  model_context_artifact_set_ref: JsonValue | null;
  candidate_set_ref: JsonValue | null;
  validated_candidate_set_ref: JsonValue | null;
  work_plan_ref: JsonValue | null;
  group_ref: JsonValue | null;
  merge_plan_ref: JsonValue | null;
  validation_snapshot_ref: JsonValue | null;
  evidence_snapshot_ref: JsonValue | null;
  route_decision_ref: JsonValue | null;
  acceptance_route_set_ref: JsonValue | null;
  created_at: Date | string;
  persisted_at: Date | string;
  audit_entry_id: string;
}

interface StandardizedRiskRecordDbRow {
  project_id: string;
  risk_record_id: string;
  version_id: string;
  request_digest: string;
  command_id: string;
}

interface RiskCandidateFinalizationDatabase {
  "business.identification_finalization_results": IdentificationFinalizationResultDbRow;
  "business.standardized_risk_records": StandardizedRiskRecordDbRow;
}

/** 局部交集扩展 Kysely 类型，不改动 C03 公共 `PostgresDatabase` 定义。 */
type RiskCandidateFinalizationDatabaseV1 = PostgresDatabase & RiskCandidateFinalizationDatabase;
type RiskCandidateFinalizationQueryExecutorV1 = Kysely<RiskCandidateFinalizationDatabaseV1>;
type RiskCandidateFinalizationTransactionV1 = Transaction<RiskCandidateFinalizationDatabaseV1>;

/** jsonb 列以文本形式写入，避免驱动二次编码。 */
const jsonValue = (value: unknown): JsonValue => JSON.stringify(value) as unknown as JsonValue;

/**
 * 审计外键在提交时延迟校验：C03 事务单元先跑 handler 再由事务写审计行，而登记端口只传结果行，
 * 因此登记行的审计身份必须与核心 `#persistRows` 的 `${commandId}:audit` 约定同形——`commandId`
 * 是核心同时传给 `TransactionUnitV1.execute` 的命令身份，随每一行一起到达，无需读取 C03 内部表。
 * 约定不符时延迟外键会在提交时显式失败，不会静默留下无审计的登记行。
 */
const auditEntryIdFor = (commandId: string): string => `${commandId}:audit`;

/** 本类专列：核心判别联合已限定每类结果的完整引用形状，判别值决定非空列。 */
const kindColumnsFor = (row: RiskCandidateFinalizationResultRowV1): object => {
  switch (row.resultKind) {
    case "candidate-set":
      return {
        work_item_ref: jsonValue(row.workItemRef),
        model_context_artifact_set_ref: jsonValue(row.modelContextArtifactSetRef),
        candidate_set_ref: jsonValue(row.candidateSetRef),
      };
    case "validated-candidate-set":
      return {
        work_item_ref: jsonValue(row.workItemRef),
        candidate_set_ref: jsonValue(row.candidateSetRef),
        validated_candidate_set_ref: jsonValue(row.validatedCandidateSetRef),
      };
    case "identification-group":
      return {
        work_plan_ref: jsonValue(row.workPlanRef),
        group_ref: jsonValue(row.groupRef),
      };
    case "merge-plan":
      return {
        work_plan_ref: jsonValue(row.workPlanRef),
        merge_plan_ref: jsonValue(row.mergePlanRef),
      };
    case "validation-snapshot":
      return {
        work_plan_ref: jsonValue(row.workPlanRef),
        group_ref: jsonValue(row.groupRef),
        validation_snapshot_ref: jsonValue(row.validationSnapshotRef),
      };
    case "evidence-snapshot":
      return {
        work_plan_ref: jsonValue(row.workPlanRef),
        group_ref: jsonValue(row.groupRef),
        evidence_snapshot_ref: jsonValue(row.evidenceSnapshotRef),
      };
    case "route-decision":
      return {
        work_plan_ref: jsonValue(row.workPlanRef),
        group_ref: jsonValue(row.groupRef),
        route_decision_ref: jsonValue(row.routeDecisionRef),
      };
    case "acceptance-route-set":
      return {
        work_plan_ref: jsonValue(row.workPlanRef),
        merge_plan_ref: jsonValue(row.mergePlanRef),
        acceptance_route_set_ref: jsonValue(row.acceptanceRouteSetRef),
      };
  }
};

/** 八类中间结果只写本类专列，它类专列保持 NULL；与迁移的 kind CHECK 一一对应。 */
const resultColumnsFor = (
  row: RiskCandidateFinalizationResultRowV1,
  occurredAt: string,
): Record<string, unknown> => {
  return {
    project_id: row.projectId,
    result_kind: row.resultKind,
    result_id: row.resultId,
    result_version_id: row.resultVersionId,
    command_id: row.commandId,
    request_digest: row.requestDigest,
    artifact_ref: jsonValue(row.artifactRef),
    input_snapshot_ref: jsonValue(row.inputSnapshotRef),
    authorization_scope_digest: row.authorizationScopeDigest,
    actor_ref: row.actorRef,
    authorization_context_ref: jsonValue(row.authorizationContextRef),
    work_item_ref: null,
    model_context_artifact_set_ref: null,
    candidate_set_ref: null,
    validated_candidate_set_ref: null,
    work_plan_ref: null,
    group_ref: null,
    merge_plan_ref: null,
    validation_snapshot_ref: null,
    evidence_snapshot_ref: null,
    route_decision_ref: null,
    acceptance_route_set_ref: null,
    ...kindColumnsFor(row),
    created_at: occurredAt,
    audit_entry_id: auditEntryIdFor(row.commandId),
  };
};

/** 回读一律经核心严格判别 Schema 复验，避免数据库补足核心未声明的形状。 */
const resultRowFromDbRow = (
  row: IdentificationFinalizationResultDbRow,
): RiskCandidateFinalizationResultRowV1 => {
  const base = {
    schemaVersion: RISK_CANDIDATE_FINALIZATION_SCHEMA_VERSION_V1,
    commandId: row.command_id,
    projectId: row.project_id,
    resultId: row.result_id,
    resultVersionId: row.result_version_id,
    requestDigest: row.request_digest,
    artifactRef: row.artifact_ref,
    inputSnapshotRef: row.input_snapshot_ref,
    authorizationScopeDigest: row.authorization_scope_digest,
    actorRef: row.actor_ref,
    authorizationContextRef: row.authorization_context_ref,
  };
  switch (row.result_kind) {
    case "candidate-set":
      return RiskCandidateFinalizationResultRowV1Schema.parse({
        ...base,
        resultKind: "candidate-set",
        workItemRef: row.work_item_ref,
        modelContextArtifactSetRef: row.model_context_artifact_set_ref,
        candidateSetRef: row.candidate_set_ref,
      });
    case "validated-candidate-set":
      return RiskCandidateFinalizationResultRowV1Schema.parse({
        ...base,
        resultKind: "validated-candidate-set",
        workItemRef: row.work_item_ref,
        candidateSetRef: row.candidate_set_ref,
        validatedCandidateSetRef: row.validated_candidate_set_ref,
      });
    case "identification-group":
      return RiskCandidateFinalizationResultRowV1Schema.parse({
        ...base,
        resultKind: "identification-group",
        workPlanRef: row.work_plan_ref,
        groupRef: row.group_ref,
      });
    case "merge-plan":
      return RiskCandidateFinalizationResultRowV1Schema.parse({
        ...base,
        resultKind: "merge-plan",
        workPlanRef: row.work_plan_ref,
        mergePlanRef: row.merge_plan_ref,
      });
    case "validation-snapshot":
      return RiskCandidateFinalizationResultRowV1Schema.parse({
        ...base,
        resultKind: "validation-snapshot",
        workPlanRef: row.work_plan_ref,
        groupRef: row.group_ref,
        validationSnapshotRef: row.validation_snapshot_ref,
      });
    case "evidence-snapshot":
      return RiskCandidateFinalizationResultRowV1Schema.parse({
        ...base,
        resultKind: "evidence-snapshot",
        workPlanRef: row.work_plan_ref,
        groupRef: row.group_ref,
        evidenceSnapshotRef: row.evidence_snapshot_ref,
      });
    case "route-decision":
      return RiskCandidateFinalizationResultRowV1Schema.parse({
        ...base,
        resultKind: "route-decision",
        workPlanRef: row.work_plan_ref,
        groupRef: row.group_ref,
        routeDecisionRef: row.route_decision_ref,
      });
    case "acceptance-route-set":
      return RiskCandidateFinalizationResultRowV1Schema.parse({
        ...base,
        resultKind: "acceptance-route-set",
        workPlanRef: row.work_plan_ref,
        mergePlanRef: row.merge_plan_ref,
        acceptanceRouteSetRef: row.acceptance_route_set_ref,
      });
    default:
      throw makePersistenceError(
        "TRANSACTION_FAILED",
        "identification-candidate-finalization.result-row-kind",
        false,
        [],
      );
  }
};

const recordColumnsFor = (
  row: StandardizedRiskRecordWriteV1,
  envelope: StandardizedRiskRecordEnvelope,
  occurredAt: string,
): Record<string, unknown> => ({
  project_id: row.projectId,
  risk_record_id: row.riskRecordId,
  version_id: row.versionId,
  risk_record_ref: jsonValue(row.riskRecordRef),
  row_id: row.rowId,
  idempotency_key: row.idempotencyKey,
  request_digest: row.requestDigest,
  payload: jsonValue(envelope),
  input_snapshot_ref: jsonValue(row.inputSnapshotRef),
  identification_run_ref: jsonValue(row.identificationRunRef),
  merge_plan_ref: jsonValue(row.mergePlanRef),
  route_decision_ref: row.routeDecisionRef === undefined ? null : jsonValue(row.routeDecisionRef),
  review_decision_ref:
    row.reviewDecisionRef === undefined ? null : jsonValue(row.reviewDecisionRef),
  group_id: row.groupId,
  group_version_id: row.groupVersionId,
  group_ref: jsonValue(row.groupRef),
  representative_candidate_refs: jsonValue(row.representativeCandidateRefs),
  source_segment_ids: jsonValue(row.sourceSegmentIds),
  mechanism_entry_ids: jsonValue(row.mechanismEntryIds),
  authorization_scope_digest: row.authorizationScopeDigest,
  authorization_context_ref: jsonValue(row.authorizationContextRef),
  actor_ref: row.actorRef,
  command_id: row.commandId,
  created_at: occurredAt,
  audit_entry_id: auditEntryIdFor(row.commandId),
});

export interface PostgresRiskCandidateFinalizationAdapterOptionsV1 {
  /** 传 `runtime.db` 即可；类型为 `Kysely<PostgresDatabase & RiskCandidateFinalizationDatabase>`。 */
  readonly db: unknown;
  /**
   * C03 事务单元由组合根按与 C21 适配器同形的选项注入；登记与正式记录写入只在调用方已持有的
   * ambient 事务内发生，本适配器不自开事务，也不自行写命令回执、审计行或 Outbox 事件。
   */
  readonly transactionUnit: TransactionUnitV1;
  /** 与 C21 适配器同形的时钟注入位；登记行时间取自调用方 `occurredAt` 与数据库时钟。 */
  readonly now?: () => Date;
}

/**
 * C22 持久化适配器（design D-09/D-10）：实现 `RiskCandidateFinalizationResultStoreV1` 与
 * `StandardizedRiskRecordStoreV1`。中间结果只登记精确 C04 引用行，正文永不入库；正式标准化
 * 风险记录只追加一次，同身份同摘要重放、异摘要冲突。两个方法都必须在 C03
 * `TransactionUnitV1.execute` handler 内调用：它们写调用方的 ambient 事务，幂等由数据库主键
 * 唯一性承担，冲突不改写既有行，重放不新增行；命令回执、审计与 Outbox 事件由 C03 事务单元
 * 按提交对象统一写入。
 */
export class PostgresRiskCandidateFinalizationAdapter
  implements RiskCandidateFinalizationResultStoreV1, StandardizedRiskRecordStoreV1
{
  readonly #db: RiskCandidateFinalizationQueryExecutorV1;

  constructor(options: PostgresRiskCandidateFinalizationAdapterOptionsV1) {
    this.#db = options.db as unknown as RiskCandidateFinalizationQueryExecutorV1;
  }

  async registerResults(
    input: {
      readonly rows: readonly RiskCandidateFinalizationResultRowV1[];
      readonly occurredAt: string;
    },
    context?: unknown,
  ): Promise<
    | { readonly kind: "registered"; readonly replayed: boolean }
    | { readonly kind: "idempotency-conflict" }
  > {
    try {
      if (input.rows.length === 0) throw new TypeError("at least one result row is required");
      const rows = input.rows.map((row) => RiskCandidateFinalizationResultRowV1Schema.parse(row));
      const transaction = this.#ambientTransaction(context);
      const inserted = await transaction
        .insertInto(RESULTS_TABLE)
        .values(rows.map((row) => resultColumnsFor(row, input.occurredAt)) as never)
        .onConflict((conflict) => conflict.doNothing())
        .execute();
      const created = Number(inserted[0]?.numInsertedOrUpdatedRows ?? 0n);
      if (created === rows.length) return { kind: "registered", replayed: false };

      // 任一主键命中都只能是同身份的既有登记；摘要一致即重放，异摘要即幂等冲突。
      for (const row of rows) {
        const stored = await this.#selectResultDigest(transaction, row);
        if (stored === undefined) {
          throw makePersistenceError(
            "TRANSACTION_FAILED",
            "identification-candidate-finalization.result-register-missing",
            false,
            [],
          );
        }
        if (stored !== row.requestDigest) return { kind: "idempotency-conflict" };
      }
      return { kind: "registered", replayed: true };
    } catch (error) {
      throw mapPostgresError(error, "identification-candidate-finalization.result-register");
    }
  }

  async readResult(input: {
    readonly projectId: string;
    readonly resultKind: RiskCandidateFinalizationResultRowV1["resultKind"];
    readonly resultId: string;
    readonly resultVersionId: string;
  }): Promise<RiskCandidateFinalizationResultRowV1 | undefined> {
    try {
      const row = await this.#db
        .selectFrom(RESULTS_TABLE)
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("result_kind", "=", input.resultKind)
        .where("result_id", "=", input.resultId)
        .where("result_version_id", "=", input.resultVersionId)
        .orderBy("persisted_at", "desc")
        .limit(1)
        .executeTakeFirst();
      return row === undefined ? undefined : resultRowFromDbRow(row);
    } catch (error) {
      throw mapPostgresError(error, "identification-candidate-finalization.result-read");
    }
  }

  async insertRecords(
    input: {
      readonly rows: readonly StandardizedRiskRecordWriteV1[];
      readonly records: readonly StandardizedRiskRecordEnvelope[];
      readonly occurredAt: string;
    },
    context?: unknown,
  ): Promise<
    | { readonly kind: "inserted" }
    | { readonly kind: "replayed" }
    | { readonly kind: "conflict"; readonly detailCode: string }
  > {
    try {
      if (input.rows.length === 0) throw new TypeError("at least one risk record is required");
      if (input.rows.length !== input.records.length) {
        throw new TypeError("risk record rows and envelopes must be index-aligned");
      }
      const rows = input.rows.map((row) => StandardizedRiskRecordWriteV1Schema.parse(row));
      const transaction = this.#ambientTransaction(context);
      const inserted = await transaction
        .insertInto(RECORDS_TABLE)
        .values(
          rows.map((row, index) =>
            recordColumnsFor(
              row,
              input.records[index] as StandardizedRiskRecordEnvelope,
              input.occurredAt,
            ),
          ) as never,
        )
        .onConflict((conflict) => conflict.columns(["project_id", "risk_record_id"]).doNothing())
        .execute();
      const created = Number(inserted[0]?.numInsertedOrUpdatedRows ?? 0n);
      if (created === rows.length) return { kind: "inserted" };

      // 唯一键只按 `(project_id, risk_record_id)` 收口：摘要一致视为同一记录重放，否则是异载荷冲突。
      for (const row of rows) {
        const stored = await this.#selectRecordDigest(transaction, row);
        if (stored === undefined) {
          return {
            kind: "conflict",
            detailCode: "standardized-risk-record-identity-missing",
          };
        }
        if (stored !== row.requestDigest) {
          return { kind: "conflict", detailCode: "standardized-risk-record-payload-mismatch" };
        }
      }
      if (created > 0) {
        return { kind: "conflict", detailCode: "standardized-risk-record-partial-overlap" };
      }
      return { kind: "replayed" };
    } catch (error) {
      throw mapPostgresError(error, "identification-candidate-finalization.record-insert");
    }
  }

  async readRecord(input: { readonly projectId: string; readonly riskRecordId: string }): Promise<
    | {
        readonly riskRecordId: string;
        readonly versionId: string;
        readonly requestDigest: string;
      }
    | undefined
  > {
    try {
      const row = await this.#db
        .selectFrom(RECORDS_TABLE)
        .select(["risk_record_id", "version_id", "request_digest"])
        .where("project_id", "=", input.projectId)
        .where("risk_record_id", "=", input.riskRecordId)
        .executeTakeFirst();
      return row === undefined
        ? undefined
        : {
            riskRecordId: row.risk_record_id,
            versionId: row.version_id,
            requestDigest: row.request_digest,
          };
    } catch (error) {
      throw mapPostgresError(error, "identification-candidate-finalization.record-read");
    }
  }

  #ambientTransaction(context: unknown): RiskCandidateFinalizationTransactionV1 {
    if (typeof context !== "object" || context === null) {
      throw makePersistenceError(
        "TRANSACTION_FAILED",
        "identification-candidate-finalization.transaction",
        false,
        [],
      );
    }
    return getPostgresTransaction(
      context as TransactionContextV1,
    ) as unknown as RiskCandidateFinalizationTransactionV1;
  }

  async #selectResultDigest(
    db: RiskCandidateFinalizationQueryExecutorV1,
    row: RiskCandidateFinalizationResultRowV1,
  ): Promise<string | undefined> {
    const stored = await db
      .selectFrom(RESULTS_TABLE)
      .select(["request_digest"])
      .where("project_id", "=", row.projectId)
      .where("result_kind", "=", row.resultKind)
      .where("result_id", "=", row.resultId)
      .where("result_version_id", "=", row.resultVersionId)
      .executeTakeFirst();
    return stored?.request_digest;
  }

  async #selectRecordDigest(
    db: RiskCandidateFinalizationQueryExecutorV1,
    row: StandardizedRiskRecordWriteV1,
  ): Promise<string | undefined> {
    const stored = await db
      .selectFrom(RECORDS_TABLE)
      .select(["request_digest"])
      .where("project_id", "=", row.projectId)
      .where("risk_record_id", "=", row.riskRecordId)
      .executeTakeFirst();
    return stored?.request_digest;
  }
}

export const createPostgresRiskCandidateFinalizationAdapter = (
  options: PostgresRiskCandidateFinalizationAdapterOptionsV1,
): PostgresRiskCandidateFinalizationAdapter =>
  new PostgresRiskCandidateFinalizationAdapter(options);
