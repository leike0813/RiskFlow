import { randomUUID } from "node:crypto";

import { sql, type Kysely, type Transaction } from "kysely";

import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import {
  ArtifactPutCommandV1Schema,
  ArtifactReadRequestV1Schema,
  type ArtifactRefV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import type {
  IdentificationWorkPlanExactV1,
  IdentificationWorkPlanReaderV1,
} from "@riskflow/core/identification/candidate-finalization";
import type {
  IdentificationContextExactInputV1,
  IdentificationContextInputReaderV1,
  IdentificationContextInputRefsV1,
} from "@riskflow/core/identification/context";
import {
  IDENTIFICATION_GRAPH_SCHEMA_VERSION_V1,
  IdentificationGraphArtifactBodyV1Schema,
  identificationWorkPlanRefFor,
  IdentificationGraphResultRowV1Schema,
  type IdentificationGraphArtifactBodyV1,
  type IdentificationGraphRegistrationStoreV1,
  type IdentificationGraphResultKindV1,
  type IdentificationGraphResultRowV1,
  type IdentificationGraphRunResultV1,
  type IdentificationGraphRunStateV1,
  type IdentificationGraphWorkPlanBodyV1,
  type IdentificationGraphWorkPlanReadV1,
} from "@riskflow/core/identification/graph";
import {
  sha256CanonicalJson,
  type JsonValue,
  type TransactionContextV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import type {
  AuthorizationContextRefV1,
  AuthorizationContextV1,
  ContractReferenceV1,
  IdentificationInputSnapshotRefV1,
  IdentificationRunResultRefV1,
  IdentificationWorkPlanRefV1,
  IdentificationPlanCommandV1,
  IdentificationPlanResultV1,
  ModuleBranchV1,
  ModuleCapabilityV1,
  StageResultRefV1,
  ValidatedCandidateSetRefV1,
  WorkflowRunRefV1,
  WorkflowErrorRefV1,
  WaitingRefV1,
} from "@riskflow/contracts/ports";
import { IdentificationPlanCommandV1Schema, WaitingRefV1Schema } from "@riskflow/contracts/ports";
import type {
  IdentificationGraphStateV1,
  IdentificationInputSnapshotV1,
  IdentificationStageResultV1,
} from "@riskflow/contracts/workflows";

import { makePersistenceError, mapPostgresError } from "../../postgres/pool.js";
import { getPostgresTransaction } from "../../postgres/transaction-unit.js";
import type { PostgresDatabase } from "../../postgres/types.js";

const RESULTS_TABLE = "business.identification_graph_results";

/** C04 正文的有界读取上限：超出即视为不可信来源，不做部分解析。 */
const MAX_BODY_BYTES_V1 = 16 * 1024 * 1024;

/**
 * 每类 C04 正文的用途码（design D-06）：C04 读取按 `purposeCode` 与写入清单比对，
 * 因此本适配器的写入与读取共用同一张表，任何旁路写入都会在读取时显式拒绝。
 * 未列出的 `waiting` / `workflow-error` 登记行由自身判别列承载事实，核心
 * `IdentificationGraphArtifactBodyV1Schema` 未为其声明正文类型，因此这两类只核对登记行。
 */
export const IDENTIFICATION_GRAPH_BODY_PURPOSE_CODE_V1 = {
  "input-snapshot": "identification-graph-input-snapshot",
  "work-plan": "identification-graph-work-plan",
  "stage-result": "identification-graph-stage-result",
  "run-state": "identification-graph-run-state",
  "run-result": "identification-graph-run-result",
  cancellation: "identification-graph-cancellation",
} as const;
export type IdentificationGraphBodyKindV1 = keyof typeof IDENTIFICATION_GRAPH_BODY_PURPOSE_CODE_V1;

/**
 * design D-09：C24 不新增 capability，只复用 `risk-identification.run`（冻结输入与工作计划）、
 * `risk-identification.finalize`（运行收口），以及 C21 读取缝已签发的 `knowledge-modeling.retrieve`。
 * 复验分支由授权实际持有的 capability 唯一决定；未列出的 capability 一律拒绝。
 */
const BRANCH_BY_CAPABILITY_V1: Partial<Record<ModuleCapabilityV1, ModuleBranchV1>> = {
  "knowledge-modeling.retrieve": "knowledge-modeling.relationship-context",
  "risk-identification.run": "risk-identification.plan",
  "risk-identification.finalize": "risk-identification.merge-run-candidates",
};

/**
 * design D-09：C05 `verify` 要求复验身份与签发身份逐字相同，而 C21/C22 的 reader 端口不携带
 * 受信调用身份。C24 按精确读写目标确定性派生身份（无墙钟、无调用方正文）：同一目标的读写
 * 身份恒定，签发方必须用同一函数派生，否则复验拒绝——fail closed 且不泄露对象是否存在。
 */
export const identificationGraphReadInvocationIdV1 = (input: {
  readonly operation:
    | "context-input"
    | "work-plan"
    | "result-row"
    | "run-rows"
    | "run-state"
    | "run-result"
    | "stage-result"
    | "reconcile"
    | "body-write";
  readonly projectId: string;
  readonly targetId: string;
}): string => `c24-${input.operation}:${input.projectId}:${input.targetId}`;

const randomId = (prefix: string): string => `${prefix}-${randomUUID()}`;

/** jsonb 列以文本形式写入，避免驱动二次编码。 */
const jsonValue = (value: unknown): JsonValue => JSON.stringify(value) as unknown as JsonValue;

const isoOf = (value: Date | string): string =>
  typeof value === "string" ? new Date(value).toISOString() : value.toISOString();

/** 稳定引用身份：只用于去重、排序与跨行比对，不参与业务语义。 */
const referenceKey = (reference: {
  readonly entityId: string;
  readonly versionId: string;
}): string => `${reference.entityId}@${reference.versionId}`;

const sameJson = (left: unknown, right: unknown): boolean =>
  sha256CanonicalJson(left) === sha256CanonicalJson(right);

interface IdentificationGraphResultDbRow {
  project_id: string;
  result_kind: string;
  result_id: string;
  result_version_id: string;
  run_id: string;
  run_version_id: string;
  command_id: string;
  idempotency_key: string;
  request_digest: string;
  artifact_ref: JsonValue;
  authorization_scope_digest: string;
  actor_ref: string;
  authorization_context_ref: JsonValue;
  parent_run_ref: JsonValue | null;
  preparation_snapshot_ref: JsonValue | null;
  input_snapshot_ref: JsonValue | null;
  work_plan_ref: JsonValue | null;
  stage_result_ref: JsonValue | null;
  waiting_ref: JsonValue | null;
  workflow_error_ref: JsonValue | null;
  run_result_ref: JsonValue | null;
  valid_at: Date | string;
  recorded_at: Date | string;
  persisted_at: Date | string;
  audit_entry_id: string;
}

interface IdentificationGraphDatabase {
  "business.identification_graph_results": IdentificationGraphResultDbRow;
}

/** 局部交集扩展 Kysely 类型，不改动 C03 公共 `PostgresDatabase` 定义。 */
type IdentificationGraphDatabaseV1 = PostgresDatabase & IdentificationGraphDatabase;
type IdentificationGraphQueryExecutorV1 = Kysely<IdentificationGraphDatabaseV1>;
type IdentificationGraphTransactionV1 = Transaction<IdentificationGraphDatabaseV1>;

/**
 * 审计外键在提交时延迟校验：登记端口只传结果行，审计行由 C03 事务单元按提交对象写入，
 * 因此 `auditEntryId` 必须由核心按同一命令身份派生（约定 `${commandId}:audit`）。本适配器
 * 原样落库，不做二次派生，也不读 C03 内部表；约定不符时提交会显式失败。
 */
const insertColumnsFor = (row: IdentificationGraphResultRowV1): Record<string, unknown> => ({
  project_id: row.projectId,
  result_kind: row.resultKind,
  result_id: row.resultId,
  result_version_id: row.resultVersionId,
  run_id: row.runId,
  run_version_id: row.runVersionId,
  command_id: row.commandId,
  idempotency_key: row.idempotencyKey,
  request_digest: row.requestDigest,
  artifact_ref: jsonValue(row.artifactRef),
  authorization_scope_digest: row.authorizationScopeDigest,
  actor_ref: row.actorRef,
  authorization_context_ref: jsonValue(row.authorizationContextRef),
  parent_run_ref: "parentRunRef" in row ? jsonValue(row.parentRunRef) : null,
  preparation_snapshot_ref:
    "preparationSnapshotRef" in row ? jsonValue(row.preparationSnapshotRef) : null,
  input_snapshot_ref: "inputSnapshotRef" in row ? jsonValue(row.inputSnapshotRef) : null,
  work_plan_ref: "workPlanRef" in row ? jsonValue(row.workPlanRef) : null,
  stage_result_ref: "stageResultRef" in row ? jsonValue(row.stageResultRef) : null,
  waiting_ref: "waitingRef" in row ? jsonValue(row.waitingRef) : null,
  workflow_error_ref: "workflowErrorRef" in row ? jsonValue(row.workflowErrorRef) : null,
  run_result_ref: "runResultRef" in row ? jsonValue(row.runResultRef) : null,
  valid_at: row.validAt,
  recorded_at: row.recordedAt,
  audit_entry_id: row.auditEntryId,
});

/** 回读一律经核心严格判别 Schema 复验，避免数据库补足核心未声明的形状。 */
const resultRowFromDbRow = (
  row: IdentificationGraphResultDbRow,
): IdentificationGraphResultRowV1 => {
  const base = {
    schemaVersion: IDENTIFICATION_GRAPH_SCHEMA_VERSION_V1,
    projectId: row.project_id,
    resultId: row.result_id,
    resultVersionId: row.result_version_id,
    runId: row.run_id,
    runVersionId: row.run_version_id,
    commandId: row.command_id,
    idempotencyKey: row.idempotency_key,
    requestDigest: row.request_digest,
    artifactRef: row.artifact_ref,
    authorizationScopeDigest: row.authorization_scope_digest,
    actorRef: row.actor_ref,
    authorizationContextRef: row.authorization_context_ref,
    validAt: isoOf(row.valid_at),
    recordedAt: isoOf(row.recorded_at),
    persistedAt: isoOf(row.persisted_at),
    auditEntryId: row.audit_entry_id,
  };
  switch (row.result_kind) {
    case "input-snapshot":
      return IdentificationGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "input-snapshot",
        parentRunRef: row.parent_run_ref,
        preparationSnapshotRef: row.preparation_snapshot_ref,
        inputSnapshotRef: row.input_snapshot_ref,
      });
    case "work-plan":
      return IdentificationGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "work-plan",
        parentRunRef: row.parent_run_ref,
        inputSnapshotRef: row.input_snapshot_ref,
        workPlanRef: row.work_plan_ref,
      });
    case "stage-result":
      return IdentificationGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "stage-result",
        workPlanRef: row.work_plan_ref,
        stageResultRef: row.stage_result_ref,
      });
    case "waiting":
      return IdentificationGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "waiting",
        waitingRef: row.waiting_ref,
        ...(row.stage_result_ref === null ? {} : { stageResultRef: row.stage_result_ref }),
      });
    case "workflow-error":
      return IdentificationGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "workflow-error",
        workflowErrorRef: row.workflow_error_ref,
      });
    case "run-state":
      return IdentificationGraphResultRowV1Schema.parse({ ...base, resultKind: "run-state" });
    case "run-result":
      return IdentificationGraphResultRowV1Schema.parse({
        ...base,
        resultKind: "run-result",
        workPlanRef: row.work_plan_ref,
        runResultRef: row.run_result_ref,
      });
    case "cancellation":
      return IdentificationGraphResultRowV1Schema.parse({ ...base, resultKind: "cancellation" });
    default:
      throw makePersistenceError(
        "TRANSACTION_FAILED",
        "identification-graph.result-row-kind",
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

/** C24 效果前的授权拒绝（不可重试，携带稳定 detailCode，不携带对象是否存在的信息）。 */
export class IdentificationGraphDeniedError extends Error {
  readonly detailCode: string;

  constructor(detailCode: string) {
    super(`identification-graph authorization denied: ${detailCode}`);
    this.name = "IdentificationGraphDeniedError";
    this.detailCode = detailCode;
  }
}

export interface PostgresIdentificationGraphAdapterOptionsV1 {
  /** 传 `runtime.db` 即可；类型为 `Kysely<PostgresDatabase & IdentificationGraphDatabase>`。 */
  readonly db: unknown;
  /**
   * 与 C21/C22 适配器同形的注入位：登记只写调用方已持有的 ambient C03 事务，本适配器不自开
   * 事务，也不写命令回执、审计行或 Outbox 事件。
   */
  readonly transactionUnit: TransactionUnitV1;
  /** C04 工件存储：正文只入 C04，登记行只保存精确引用。 */
  readonly artifactStore: ArtifactStoreV1;
  /** C05 当前授权复验端口：每次受保护读写前按当前 actor/工程/空间/资料范围复验。 */
  readonly authorization: Pick<LocalIdentityAccessV1, "verify">;
  readonly issueReadContext?: (input: {
    readonly authorization: AuthorizationContextV1;
    readonly projectId: string;
    readonly actorId: string;
    readonly invocationId: string;
    readonly branch: ModuleBranchV1;
    readonly requestedAt: string;
  }) => Promise<{ readonly authorization: AuthorizationContextV1; readonly invocationId: string }>;
  readonly now?: () => Date;
}

export interface PostgresIdentificationGraphBodyWriteCommandV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly commandId: string;
  readonly issuedAt: string;
  /** 工件身份由核心确定性派生（design D-03），本适配器不另行派生。 */
  readonly artifactId: string;
  readonly body: IdentificationGraphArtifactBodyV1;
  readonly authorization: AuthorizationContextV1;
}

export interface PostgresIdentificationGraphWorkPlanBodyReadV1 {
  readonly projectId: string;
  readonly workPlanRef: IdentificationWorkPlanRefV1;
  readonly actorId: string;
  readonly requestedAt: string;
  readonly authorization: AuthorizationContextV1;
}

export interface PostgresIdentificationGraphInputSnapshotBodyReadV1 {
  readonly projectId: string;
  readonly inputSnapshotRef: IdentificationInputSnapshotRefV1;
  readonly actorId: string;
  readonly requestedAt: string;
  readonly authorization: AuthorizationContextV1;
}

export interface PostgresIdentificationGraphReconcileInputV1 {
  readonly projectId: string;
  readonly runId: string;
  readonly state: IdentificationGraphStateV1;
  readonly actorId: string;
  readonly requestedAt: string;
  readonly authorization: AuthorizationContextV1;
}

export type PostgresIdentificationGraphRegistrationOutcomeV1 =
  | { readonly kind: "registered"; readonly replayed: boolean }
  | { readonly kind: "idempotency-conflict"; readonly priorCommandId: string };

export interface PostgresIdentificationGraphRegistrationEntryV1 {
  readonly rows: readonly IdentificationGraphResultRowV1[];
  readonly occurredAt: string;
}

/**
 * C24 PostgreSQL 适配器（design D-04/D-06/D-07/D-09）：八类 C24 业务事实的追加登记与精确回读、
 * C21 `IdentificationContextInputReaderV1`、C22 `IdentificationWorkPlanReaderV1`、C04 正文读写
 * 与 checkpoint 引用对账。两个 `readExact` 由两个独立对象承载（`contextInputReader` /
 * `workPlanReader`），语义互不混同。
 *
 * 当前授权复验身份（design D-09）：`contextInputReader.readExact` 沿用 C21 冻结服务的
 * `queryId` 身份；`workPlanReader.readExact`、`putBody`、`readWorkPlanBody`、
 * `readInputSnapshotBody`、`reconcileCheckpointReferences` 与 `readLatestRunState` 使用
 * `identificationGraphReadInvocationIdV1` 的确定性派生。签发方必须按同一函数派生，否则复验按
 * 拒绝收口（fail closed，不泄露对象是否存在）。
 */
export interface PostgresIdentificationGraphAdapterV1 {
  verifyCheckpointWaitingReference(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly invocationId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly runRef: WorkflowRunRefV1;
    readonly waitingRef: WaitingRefV1;
  }): Promise<boolean>;
  verifyCheckpointReference(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly invocationId: string;
    readonly runRef: WorkflowRunRefV1;
    readonly reference: ContractReferenceV1;
    readonly workPlanRef?: IdentificationWorkPlanRefV1;
  }): Promise<boolean>;
  readonly registrationStore: IdentificationGraphRegistrationStoreV1;
  readonly contextInputReader: IdentificationContextInputReaderV1;
  readonly workPlanReader: IdentificationWorkPlanReaderV1;
  registerResults(
    input: PostgresIdentificationGraphRegistrationEntryV1,
    context?: unknown,
  ): Promise<PostgresIdentificationGraphRegistrationOutcomeV1>;
  putBody(command: PostgresIdentificationGraphBodyWriteCommandV1): Promise<ArtifactRefV1>;
  readWorkPlanBody(
    input: PostgresIdentificationGraphWorkPlanBodyReadV1,
  ): Promise<IdentificationGraphWorkPlanBodyV1 | undefined>;
  readRegisteredWorkPlan(command: IdentificationPlanCommandV1): Promise<IdentificationPlanResultV1>;
  readInputSnapshotBody(
    input: PostgresIdentificationGraphInputSnapshotBodyReadV1,
  ): Promise<IdentificationInputSnapshotV1 | undefined>;
  readStageResultBody(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly stageResultRef: StageResultRefV1;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<IdentificationStageResultV1 | undefined>;
  reconcileCheckpointReferences(input: PostgresIdentificationGraphReconcileInputV1): Promise<
    | {
        readonly kind: "consistent";
        readonly workPlan: IdentificationGraphWorkPlanReadV1 | undefined;
      }
    | { readonly kind: "inconsistent"; readonly detailCode: string }
  >;
}

/**
 * 登记行 + C04 正文的共享核心：三个对外对象共用同一套读写与复验语义，
 * 保证不存在第二条登记/回读路径。所有失败一律收口为 `undefined` 或稳定 detailCode，
 * 不区分"对象不存在"与"无权访问"。
 */
class IdentificationGraphPersistence {
  readonly #db: IdentificationGraphQueryExecutorV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #authorization: Pick<LocalIdentityAccessV1, "verify">;
  readonly #issueReadContext: PostgresIdentificationGraphAdapterOptionsV1["issueReadContext"];
  readonly #now: () => Date;

  constructor(options: PostgresIdentificationGraphAdapterOptionsV1) {
    this.#db = options.db as unknown as IdentificationGraphQueryExecutorV1;
    this.#artifactStore = options.artifactStore;
    this.#authorization = options.authorization;
    this.#issueReadContext = options.issueReadContext;
    this.#now = options.now ?? (() => new Date());
  }

  now(): Date {
    return this.#now();
  }

  /**
   * 当前授权复验（design D-09）：`authorization` 提供复验身份，`verify` 返回的是当前收窄上下文，
   * 冻结引用不能替代它。任何形状不符或异常都按拒绝收口。
   */
  async verifyAuthorization(
    input: {
      readonly authorization: AuthorizationContextV1;
      readonly projectId: string;
      readonly actorId: string;
      readonly invocationId: string;
      readonly requestedAt?: string;
    },
    rejectRedacted = false,
  ): Promise<AuthorizationContextV1 | undefined> {
    if (input.authorization.projectId !== input.projectId) return undefined;
    if (input.authorization.actorId !== input.actorId) return undefined;
    if (input.authorization.grantedCapabilities.length !== 1) return undefined;
    const capability = input.authorization.grantedCapabilities[0];
    if (capability === undefined) return undefined;
    const branch = BRANCH_BY_CAPABILITY_V1[capability];
    if (branch === undefined) return undefined;
    let authorization = input.authorization;
    let invocationId = input.invocationId;
    if (this.#issueReadContext !== undefined) {
      try {
        const issued = await this.#issueReadContext({
          ...input,
          branch,
          requestedAt: input.requestedAt ?? this.#now().toISOString(),
        });
        authorization = issued.authorization;
        invocationId = issued.invocationId;
      } catch {
        return undefined;
      }
      if (
        authorization.projectId !== input.projectId ||
        authorization.actorId !== input.actorId ||
        authorization.grantedCapabilities.length !== 1 ||
        authorization.grantedCapabilities[0] !== capability
      )
        return undefined;
    }
    return this.#verifyRef({
      authorizationContextRef: authorization.authorizationContextRef,
      capability,
      branch,
      projectId: input.projectId,
      actorId: input.actorId,
      invocationId,
      requestedAt: input.requestedAt ?? this.#now().toISOString(),
      rejectRedacted,
    });
  }

  /** 只带冻结上下文的复验入口：`verify` 按引用取当前授权，因此调用方只需引用与期望能力。 */
  async #verifyRef(input: {
    readonly authorizationContextRef: AuthorizationContextRefV1;
    readonly capability: ModuleCapabilityV1;
    readonly branch: ModuleBranchV1;
    readonly projectId: string;
    readonly actorId: string;
    readonly invocationId: string;
    readonly requestedAt: string;
    readonly rejectRedacted?: boolean;
  }): Promise<AuthorizationContextV1 | undefined> {
    try {
      const decision = await this.#authorization.verify({
        authorizationContextRef: input.authorizationContextRef,
        invocationId: input.invocationId,
        projectId: input.projectId,
        branch: input.branch,
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        requestedAt: input.requestedAt,
      });
      const verified = decision.context;
      if (
        (input.rejectRedacted === true && decision.redacted === true) ||
        verified.projectId !== input.projectId ||
        verified.actorId !== input.actorId ||
        verified.spatialScopeRefs.length === 0 ||
        verified.grantedCapabilities.length !== 1 ||
        verified.grantedCapabilities[0] !== input.capability
      ) {
        return undefined;
      }
      return verified;
    } catch {
      return undefined;
    }
  }

  /** 所有运行状态追加与取消共用同一事务锁，锁后再读取最新版本。 */
  async assertCurrentRunVersion(
    input: {
      readonly projectId: string;
      readonly runId: string;
      readonly expectedRunVersionId: string | undefined;
    },
    context: unknown,
  ): Promise<void> {
    const transaction = this.#ambientTransaction(context);
    await sql`SELECT pg_advisory_xact_lock(hashtext(${input.projectId}), hashtext(${input.runId}))`.execute(
      transaction,
    );
    const latest = await transaction
      .selectFrom(RESULTS_TABLE)
      .select("run_version_id")
      .where("project_id", "=", input.projectId)
      .where("result_kind", "=", "run-state")
      .where("run_id", "=", input.runId)
      .orderBy("persisted_at", "desc")
      .orderBy("run_version_id", "desc")
      .limit(1)
      .executeTakeFirst();
    if (latest?.run_version_id !== input.expectedRunVersionId) {
      throw makePersistenceError("IDEMPOTENCY_CONFLICT", "identification-graph.run-version");
    }
  }

  /** 只写调用方 ambient 事务；同键同摘要不覆盖首次行，同键异摘要返回首次命令身份。 */
  async insertRows(
    input: {
      readonly rows: readonly IdentificationGraphResultRowV1[];
      readonly occurredAt: string;
    },
    context: unknown,
  ): Promise<PostgresIdentificationGraphRegistrationOutcomeV1> {
    try {
      if (input.rows.length === 0) throw new TypeError("at least one result row is required");
      const rows = input.rows.map((row) => IdentificationGraphResultRowV1Schema.parse(row));
      const transaction = this.#ambientTransaction(context);
      const inserted = await transaction
        .insertInto(RESULTS_TABLE)
        .values(rows.map((row) => insertColumnsFor(row)) as never)
        .onConflict((conflict) => conflict.doNothing())
        .execute();
      const created = Number(inserted[0]?.numInsertedOrUpdatedRows ?? 0n);
      if (created === rows.length) return { kind: "registered", replayed: false };

      for (const row of rows) {
        // `onConflict.doNothing` 同时覆盖主键与 `(project_id, result_kind, idempotency_key)` 唯一键，
        // 因此逐个身份回查：主键命中是同身份重放，幂等键命中是异载荷登记。
        const stored =
          (await this.#selectRowByIdentity(transaction, row)) ??
          (await this.#selectRowByIdempotencyKey(transaction, row));
        if (stored === undefined) {
          throw makePersistenceError(
            "TRANSACTION_FAILED",
            "identification-graph.result-register-missing",
            false,
            [],
          );
        }
        if (stored.request_digest !== row.requestDigest) {
          return { kind: "idempotency-conflict", priorCommandId: stored.command_id };
        }
      }
      return { kind: "registered", replayed: true };
    } catch (error) {
      throw mapPostgresError(error, "identification-graph.result-register");
    }
  }

  async verifyCheckpointWaitingReference(
    input: Parameters<PostgresIdentificationGraphAdapterV1["verifyCheckpointWaitingReference"]>[0],
  ): Promise<boolean> {
    const verified = await this.verifyAuthorization(input, true);
    if (verified === undefined) return false;
    const waitingRef = WaitingRefV1Schema.parse(input.waitingRef);
    const row = await this.#db
      .selectFrom(RESULTS_TABLE)
      .select("waiting_ref")
      .where("project_id", "=", input.projectId)
      .where("run_id", "=", input.runRef.reference.entityId)
      .where("result_kind", "=", "waiting")
      .where("actor_ref", "=", input.actorId)
      .where("waiting_ref", "=", sql<JsonValue>`${JSON.stringify(waitingRef)}::jsonb`)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  async readRow(input: {
    readonly projectId: string;
    readonly resultKind: IdentificationGraphResultKindV1;
    readonly resultId: string;
    readonly resultVersionId: string;
  }): Promise<IdentificationGraphResultRowV1 | undefined> {
    try {
      const row = await this.#selectRowByIdentity(this.#db, input);
      return row === undefined ? undefined : resultRowFromDbRow(row);
    } catch (error) {
      throw mapPostgresError(error, "identification-graph.result-read");
    }
  }

  async listRunRows(input: {
    readonly projectId: string;
    readonly runId: string;
  }): Promise<readonly IdentificationGraphResultRowV1[]> {
    return this.listRowsOfKind({ projectId: input.projectId, runId: input.runId });
  }

  async readWorkflowErrorRow(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly reference: WorkflowErrorRefV1;
  }): Promise<IdentificationGraphResultRowV1 | undefined> {
    try {
      const rows = await this.#db
        .selectFrom(RESULTS_TABLE)
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("run_id", "=", input.runId)
        .where("result_kind", "=", "workflow-error")
        .where("workflow_error_ref", "=", jsonValue(input.reference))
        .limit(2)
        .execute();
      return rows.length === 1 ? resultRowFromDbRow(rows[0]!) : undefined;
    } catch (error) {
      throw mapPostgresError(error, "identification-graph.error-reference-read");
    }
  }

  /** 按工程 + 种类（+ 可选运行）枚举登记行，只用于精确回读前的候选收窄，不做跨工程回退。 */
  async listRowsOfKind(input: {
    readonly projectId: string;
    readonly resultKind?: IdentificationGraphResultKindV1;
    readonly runId?: string;
  }): Promise<readonly IdentificationGraphResultRowV1[]> {
    try {
      let query = this.#db
        .selectFrom(RESULTS_TABLE)
        .selectAll()
        .where("project_id", "=", input.projectId);
      if (input.resultKind !== undefined) query = query.where("result_kind", "=", input.resultKind);
      if (input.runId !== undefined) query = query.where("run_id", "=", input.runId);
      const rows = await query
        .orderBy("persisted_at", "asc")
        .orderBy("result_kind", "asc")
        .orderBy("result_id", "asc")
        .orderBy("result_version_id", "asc")
        .execute();
      return rows.map((row) => resultRowFromDbRow(row));
    } catch (error) {
      throw mapPostgresError(error, "identification-graph.kind-rows-read");
    }
  }

  async readLatestRunStateRow(input: {
    readonly projectId: string;
    readonly runId: string;
  }): Promise<
    Extract<IdentificationGraphResultRowV1, { readonly resultKind: "run-state" }> | undefined
  > {
    try {
      const row = await this.#db
        .selectFrom(RESULTS_TABLE)
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("result_kind", "=", "run-state")
        .where("run_id", "=", input.runId)
        .orderBy("persisted_at", "desc")
        .orderBy("run_version_id", "desc")
        .limit(1)
        .executeTakeFirst();
      if (row === undefined) return undefined;
      const decoded = resultRowFromDbRow(row);
      return decoded.resultKind === "run-state" ? decoded : undefined;
    } catch (error) {
      throw mapPostgresError(error, "identification-graph.run-state-read");
    }
  }

  /** 只写 C04：正文先入库并由工件存储自行核对摘要；登记行随后在 C03 事务内单独提交。 */
  async putBody(command: PostgresIdentificationGraphBodyWriteCommandV1): Promise<ArtifactRefV1> {
    const body = IdentificationGraphArtifactBodyV1Schema.parse(command.body);
    const verified = await this.verifyAuthorization({
      authorization: command.authorization,
      projectId: command.projectId,
      actorId: command.actorId,
      invocationId: identificationGraphReadInvocationIdV1({
        operation: "body-write",
        projectId: command.projectId,
        targetId: command.artifactId,
      }),
    });
    if (verified === undefined) throw new IdentificationGraphDeniedError("body-write-denied");
    const requiredCapability = verified.grantedCapabilities[0];
    if (requiredCapability === undefined) {
      throw new IdentificationGraphDeniedError("body-write-capability-not-granted");
    }
    // C04 预写可跨越已回滚的业务事务；新正文或当前授权不能复用旧物理写入的键。
    const storageCommandId = `${command.commandId}:${sha256CanonicalJson({
      ...command,
      body,
      authorization: verified,
    })}`;
    const result = await this.#artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: "1",
        commandId: storageCommandId,
        idempotencyKey: storageCommandId,
        projectId: command.projectId,
        actorId: command.actorId,
        issuedAt: command.issuedAt,
        authorization: verified,
        requiredCapability,
        artifactId: command.artifactId,
        artifactKind: "content",
        purposeCode: IDENTIFICATION_GRAPH_BODY_PURPOSE_CODE_V1[body.bodyKind],
        mediaType: "application/json",
        parentArtifactRefs: [],
        evidenceReferences: [],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      }),
      (async function* () {
        yield new TextEncoder().encode(JSON.stringify(body));
      })(),
    );
    return result.artifactRef;
  }

  /**
   * 读 C04 正文（design D-04/D-07）：先读登记行，再按该行的精确 `artifactRef` 打开正文；
   * `handle.completed` 保证字节与引用摘要一致，核心正文 Schema 保证判别种类与形状一致。
   * 任何不一致都抛错，由调用方按同形失败收口。
   */
  async readBody(input: {
    readonly row: IdentificationGraphResultRowV1;
    readonly bodyKind: IdentificationGraphBodyKindV1;
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<IdentificationGraphArtifactBodyV1> {
    const requiredCapability = input.authorization.grantedCapabilities[0];
    if (requiredCapability === undefined) {
      throw new IdentificationGraphDeniedError("body-read-capability-not-granted");
    }
    const handle = await this.#artifactStore.open(
      ArtifactReadRequestV1Schema.parse({
        schemaVersion: "1",
        requestId: randomId("c24-graph-read"),
        idempotencyKey: randomId("c24-graph-read"),
        artifactRef: input.row.artifactRef,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        purposeCode: IDENTIFICATION_GRAPH_BODY_PURPOSE_CODE_V1[input.bodyKind],
        requiredCapability,
        authorization: input.authorization,
      }),
    );
    const bytes = await boundedContent(handle.content, MAX_BODY_BYTES_V1);
    // C04 摘要核对：字节、长度或对象摘要不符都在此失败，不做部分接受。
    await handle.completed;
    const decoded: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const parsed = IdentificationGraphArtifactBodyV1Schema.safeParse(decoded);
    if (!parsed.success || parsed.data.bodyKind !== input.bodyKind) {
      throw makePersistenceError("TRANSACTION_FAILED", "identification-graph.body-kind");
    }
    return parsed.data;
  }

  async verifyBody(
    input: Parameters<IdentificationGraphPersistence["readBody"]>[0],
    validate: (body: IdentificationGraphArtifactBodyV1) => boolean,
  ): Promise<boolean> {
    if (this.#artifactStore.verifyContent === undefined) return false;
    return this.#artifactStore.verifyContent(
      ArtifactReadRequestV1Schema.parse({
        schemaVersion: "1",
        requestId: randomId("c24-checkpoint-proof"),
        idempotencyKey: randomId("c24-checkpoint-proof"),
        artifactRef: input.row.artifactRef,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        purposeCode: IDENTIFICATION_GRAPH_BODY_PURPOSE_CODE_V1[input.bodyKind],
        requiredCapability: input.authorization.grantedCapabilities[0],
        authorization: input.authorization,
      }),
      MAX_BODY_BYTES_V1,
      (bytes) => {
        const body = IdentificationGraphArtifactBodyV1Schema.parse(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        );
        return body.bodyKind === input.bodyKind && validate(body);
      },
    );
  }

  /** 本次运行已登记的 I5 结果汇总（稳定排序、去重）；正文不符返回 `undefined`。 */
  async validatedCandidateSetRefsFor(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly workPlanRef: IdentificationWorkPlanRefV1;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<readonly ValidatedCandidateSetRefV1[] | undefined> {
    const rows = (
      await this.listRowsOfKind({
        projectId: input.projectId,
        resultKind: "stage-result",
        runId: input.runId,
      })
    ).filter(
      (row: IdentificationGraphResultRowV1) =>
        row.resultKind === "stage-result" && sameJson(row.workPlanRef, input.workPlanRef),
    );
    const collected = new Map<string, ValidatedCandidateSetRefV1>();
    for (const row of rows) {
      const body = await this.readBody({
        row,
        bodyKind: "stage-result",
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        authorization: input.authorization,
      });
      if (body.bodyKind !== "stage-result") return undefined;
      const stageResult: IdentificationStageResultV1 = body.stageResult;
      if (stageResult.stage !== "I5") continue;
      collected.set(
        referenceKey(stageResult.validatedCandidateSetRef.reference),
        stageResult.validatedCandidateSetRef,
      );
    }
    return [...collected.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([, ref]) => ref);
  }

  #ambientTransaction(context: unknown): IdentificationGraphTransactionV1 {
    if (typeof context !== "object" || context === null) {
      throw makePersistenceError(
        "TRANSACTION_FAILED",
        "identification-graph.result-register-transaction",
      );
    }
    return getPostgresTransaction(
      context as TransactionContextV1,
    ) as unknown as IdentificationGraphTransactionV1;
  }

  async #selectRowByIdentity(
    db: IdentificationGraphQueryExecutorV1 | IdentificationGraphTransactionV1,
    identity: {
      readonly projectId: string;
      readonly resultKind: string;
      readonly resultId: string;
      readonly resultVersionId: string;
    },
  ): Promise<IdentificationGraphResultDbRow | undefined> {
    return db
      .selectFrom(RESULTS_TABLE)
      .selectAll()
      .where("project_id", "=", identity.projectId)
      .where("result_kind", "=", identity.resultKind)
      .where("result_id", "=", identity.resultId)
      .where("result_version_id", "=", identity.resultVersionId)
      .executeTakeFirst();
  }

  async #selectRowByIdempotencyKey(
    db: IdentificationGraphQueryExecutorV1 | IdentificationGraphTransactionV1,
    identity: {
      readonly projectId: string;
      readonly resultKind: string;
      readonly idempotencyKey: string;
    },
  ): Promise<IdentificationGraphResultDbRow | undefined> {
    return db
      .selectFrom(RESULTS_TABLE)
      .selectAll()
      .where("project_id", "=", identity.projectId)
      .where("result_kind", "=", identity.resultKind)
      .where("idempotency_key", "=", identity.idempotencyKey)
      .executeTakeFirst();
  }
}

/** C24 追加登记端口（`IdentificationGraphRegistrationStoreV1`）：只登记与回读精确引用行。 */
class IdentificationGraphRegistrationStore implements IdentificationGraphRegistrationStoreV1 {
  readonly #persistence: IdentificationGraphPersistence;

  constructor(persistence: IdentificationGraphPersistence) {
    this.#persistence = persistence;
  }

  async assertCurrentRunVersion(
    input: {
      readonly projectId: string;
      readonly runId: string;
      readonly expectedRunVersionId: string | undefined;
    },
    context: unknown,
  ): Promise<void> {
    await this.#persistence.assertCurrentRunVersion(input, context);
  }

  async registerRow(
    input: {
      readonly row: IdentificationGraphResultRowV1;
      readonly occurredAt: string;
    },
    context?: unknown,
  ): Promise<PostgresIdentificationGraphRegistrationOutcomeV1> {
    return this.#persistence.insertRows(
      { rows: [input.row], occurredAt: input.occurredAt },
      context,
    );
  }

  async readRow(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
    readonly requestedAt: string;
    readonly resultKind: IdentificationGraphResultRowV1["resultKind"];
    readonly resultId: string;
    readonly resultVersionId: string;
  }): Promise<IdentificationGraphResultRowV1 | undefined> {
    const verified = await this.#persistence.verifyAuthorization({
      authorization: input.authorization,
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      invocationId: identificationGraphReadInvocationIdV1({
        operation: "result-row",
        projectId: input.projectId,
        targetId: `${input.resultKind}:${input.resultId}:${input.resultVersionId}`,
      }),
    });
    if (verified === undefined) return undefined;
    const row = await this.#persistence.readRow(input);
    return row;
  }

  async listRunRows(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
    readonly requestedAt: string;
  }): Promise<readonly IdentificationGraphResultRowV1[]> {
    const verified = await this.#persistence.verifyAuthorization({
      authorization: input.authorization,
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      invocationId: identificationGraphReadInvocationIdV1({
        operation: "run-rows",
        projectId: input.projectId,
        targetId: input.runId,
      }),
    });
    if (verified === undefined) return [];
    return this.#persistence.listRowsOfKind(input);
  }

  async readLatestRunState(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
    readonly requestedAt: string;
  }): Promise<
    | {
        readonly row: Extract<IdentificationGraphResultRowV1, { readonly resultKind: "run-state" }>;
        readonly state: IdentificationGraphRunStateV1;
      }
    | undefined
  > {
    const verified = await this.#persistence.verifyAuthorization({
      authorization: input.authorization,
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      invocationId: identificationGraphReadInvocationIdV1({
        operation: "run-state",
        projectId: input.projectId,
        targetId: input.runId,
      }),
    });
    if (verified === undefined) return undefined;
    const row = await this.#persistence.readLatestRunStateRow(input);
    if (row === undefined) return undefined;
    try {
      const body = await this.#persistence.readBody({
        row,
        bodyKind: "run-state",
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        authorization: verified,
      });
      // 正文与登记行的运行身份必须逐字一致，否则不是同一状态版本。
      if (
        body.bodyKind !== "run-state" ||
        body.runState.runId !== row.runId ||
        body.runState.runVersionId !== row.runVersionId
      ) {
        return undefined;
      }
      return { row, state: body.runState };
    } catch {
      return undefined;
    }
  }

  /**
   * D-05 已完成运行汇总精确只读：C36 只能经本端口取得覆盖证明，不读 C24 私表或 C04 正文。
   * 读取前与返回前各复验一次当前授权；登记行、C04 正文与最新 `run-state` 必须互相一致且已
   * `completed`。缺失、撤权、跨工程、未完成或状态错配统一返回 `unavailable`（不披露存在性），
   * 登记行与正文损坏返回 `corrupt`，绝不以空数组或旧运行冒充证据。
   */
  async readCompletedRunResult(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly runResultRef: IdentificationRunResultRefV1;
    readonly authorization: AuthorizationContextV1;
    readonly requestedAt: string;
  }): Promise<
    | { readonly kind: "read"; readonly runResult: IdentificationGraphRunResultV1 }
    | { readonly kind: "unavailable" }
    | { readonly kind: "corrupt"; readonly detailCode: string }
  > {
    const verify = () =>
      this.#persistence.verifyAuthorization({
        authorization: input.authorization,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        invocationId: identificationGraphReadInvocationIdV1({
          operation: "run-result",
          projectId: input.projectId,
          targetId: `${input.runResultRef.reference.entityId}:${input.runResultRef.reference.versionId}`,
        }),
      });
    const verified = await verify();
    if (verified === undefined) return { kind: "unavailable" };
    const row = await this.#persistence.readRow({
      projectId: input.projectId,
      resultKind: "run-result",
      resultId: input.runResultRef.reference.entityId,
      resultVersionId: input.runResultRef.reference.versionId,
    });
    if (
      row === undefined ||
      row.resultKind !== "run-result" ||
      !sameJson(row.runResultRef, input.runResultRef)
    ) {
      return { kind: "unavailable" };
    }
    const latest = await this.#persistence.readLatestRunStateRow({
      projectId: input.projectId,
      runId: row.runId,
    });
    if (latest === undefined || latest.runVersionId !== row.runVersionId) {
      return { kind: "unavailable" };
    }
    let latestBody: IdentificationGraphArtifactBodyV1;
    try {
      latestBody = await this.#persistence.readBody({
        row: latest,
        bodyKind: "run-state",
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        authorization: verified,
      });
    } catch {
      return { kind: "corrupt", detailCode: "run-state-body-unavailable" };
    }
    if (
      latestBody.bodyKind !== "run-state" ||
      latestBody.runState.runId !== latest.runId ||
      latestBody.runState.runVersionId !== latest.runVersionId ||
      latestBody.runState.status !== "completed" ||
      latestBody.runState.resultRef === undefined ||
      !sameJson(latestBody.runState.resultRef, input.runResultRef)
    ) {
      return { kind: "unavailable" };
    }
    let body: IdentificationGraphArtifactBodyV1;
    try {
      body = await this.#persistence.readBody({
        row,
        bodyKind: "run-result",
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        authorization: verified,
      });
    } catch {
      return { kind: "corrupt", detailCode: "run-result-body-unavailable" };
    }
    if (body.bodyKind !== "run-result") {
      return { kind: "corrupt", detailCode: "run-result-body-kind-mismatch" };
    }
    const runResult = body.runResult;
    if (
      runResult.projectId !== input.projectId ||
      runResult.runRef.reference.entityId !== row.runId ||
      !sameJson(runResult.workPlanRef, row.workPlanRef)
    ) {
      return { kind: "unavailable" };
    }
    if ((await verify()) === undefined) return { kind: "unavailable" };
    return { kind: "read", runResult };
  }
}

class IdentificationGraphContextInputReader implements IdentificationContextInputReaderV1 {
  readonly #persistence: IdentificationGraphPersistence;

  constructor(persistence: IdentificationGraphPersistence) {
    this.#persistence = persistence;
  }

  /**
   * C21 精确输入窄读（design D-04）：只从 `business.identification_graph_results` 定位
   * `input-snapshot` 与 `work-plan` 登记行，再经 C04 读取并核对正文；失败码只用 C21 已声明的
   * 三个，且不区分"不存在"与"无权"。
   */
  async readExact(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly queryId: string;
    readonly inputSnapshotRef: IdentificationContextInputRefsV1["inputSnapshotRef"];
    readonly workItemRef: IdentificationContextInputRefsV1["workItemRef"];
    readonly authorization: AuthorizationContextV1;
  }): Promise<
    | { readonly kind: "succeeded"; readonly read: IdentificationContextExactInputV1 }
    | {
        readonly kind: "failed";
        readonly code: "AUTHORIZATION_DENIED" | "POLICY_NOT_FOUND" | "IDENTIFICATION_INPUT_DRIFT";
        readonly detailCode: string;
      }
  > {
    const notFound = (detailCode: string) =>
      ({
        kind: "failed",
        code: "POLICY_NOT_FOUND",
        detailCode,
      }) as const;

    const verified = await this.#persistence.verifyAuthorization({
      authorization: input.authorization,
      projectId: input.projectId,
      actorId: input.actorId,
      // C21 冻结服务以 `queryId` 同时作为签发与复验身份（`verifyCurrent({invocationId: query.queryId})`），
      // 本 reader 沿用同一身份，避免出现第二套复验约定。
      invocationId: input.queryId,
    });
    if (verified === undefined) {
      return { kind: "failed", code: "AUTHORIZATION_DENIED", detailCode: "authorization-denied" };
    }

    try {
      const snapshotRow = await this.#persistence.readRow({
        projectId: input.projectId,
        resultKind: "input-snapshot",
        resultId: input.inputSnapshotRef.reference.entityId,
        resultVersionId: input.inputSnapshotRef.reference.versionId,
      });
      if (snapshotRow === undefined || snapshotRow.resultKind !== "input-snapshot") {
        return notFound("input-snapshot-registration-missing");
      }
      // 只在同一运行内按判别列定位工作计划，不接受跨运行或跨输入快照的候选。
      const planRows = await this.#persistence.listRowsOfKind({
        projectId: input.projectId,
        resultKind: "work-plan",
        runId: snapshotRow.runId,
      });
      const planRow = planRows.find(
        (row) =>
          row.resultKind === "work-plan" && sameJson(row.inputSnapshotRef, input.inputSnapshotRef),
      );
      if (planRow === undefined || planRow.resultKind !== "work-plan") {
        return notFound("work-plan-registration-missing");
      }
      const requestedAt = this.#persistence.now().toISOString();
      const snapshotBody = await this.#persistence.readBody({
        row: snapshotRow,
        bodyKind: "input-snapshot",
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt,
        authorization: verified,
      });
      const planBody = await this.#persistence.readBody({
        row: planRow,
        bodyKind: "work-plan",
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt,
        authorization: verified,
      });
      const plan = planBody.bodyKind === "work-plan" ? planBody.workPlan : undefined;
      const drift = (detailCode: string) =>
        ({
          kind: "failed",
          code: "IDENTIFICATION_INPUT_DRIFT",
          detailCode,
        }) as const;
      if (
        snapshotBody.bodyKind !== "input-snapshot" ||
        plan === undefined ||
        plan.projectId !== input.projectId ||
        !sameJson(plan.workPlanRef, planRow.workPlanRef) ||
        !sameJson(plan.inputSnapshotRef, input.inputSnapshotRef) ||
        // 工作计划正文内嵌输入快照必须与 `input-snapshot` 登记行正文逐字一致。
        !sameJson(plan.inputSnapshot, snapshotBody.inputSnapshot)
      ) {
        return drift("input-snapshot-body-mismatch");
      }
      const workItem = plan.workItems.find((item) => sameJson(item.workItemRef, input.workItemRef));
      if (workItem === undefined) return drift("work-item-not-in-work-plan");
      return {
        kind: "succeeded",
        read: {
          inputSnapshot: snapshotBody.inputSnapshot,
          workItem: {
            workItemRef: workItem.workItemRef,
            nodeId: workItem.nodeId,
            spatialScopeRefs: [...workItem.spatialScopeRefs],
            sourceVersionRefs: [...workItem.sourceVersionRefs],
            frozenQueryText: workItem.frozenQueryText,
          },
        },
      };
    } catch {
      return {
        kind: "failed",
        code: "IDENTIFICATION_INPUT_DRIFT",
        detailCode: "input-read-unavailable",
      };
    }
  }
}

class IdentificationGraphWorkPlanReader implements IdentificationWorkPlanReaderV1 {
  readonly #persistence: IdentificationGraphPersistence;

  constructor(persistence: IdentificationGraphPersistence) {
    this.#persistence = persistence;
  }

  /**
   * C22 工作计划精确窄读（design D-04）：先读 `work-plan` 登记行，再经 C04 读取并核对正文、
   * 输入快照与本次运行已登记的 I5 引用；失败码只用 C22 已声明的三个。
   */
  async readExact(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly workPlanRef: IdentificationWorkPlanRefV1;
    readonly authorization: AuthorizationContextV1;
  }): Promise<
    | { readonly kind: "succeeded"; readonly read: IdentificationWorkPlanExactV1 }
    | {
        readonly kind: "failed";
        readonly code:
          "AUTHORIZATION_DENIED" | "ENTITY_NOT_FOUND" | "IDENTIFICATION_WORK_PLAN_DRIFT";
        readonly detailCode: string;
      }
  > {
    const verified = await this.#persistence.verifyAuthorization({
      authorization: input.authorization,
      projectId: input.projectId,
      actorId: input.actorId,
      invocationId: identificationGraphReadInvocationIdV1({
        operation: "work-plan",
        projectId: input.projectId,
        targetId: referenceKey(input.workPlanRef.reference),
      }),
    });
    if (verified === undefined) {
      return { kind: "failed", code: "AUTHORIZATION_DENIED", detailCode: "authorization-denied" };
    }

    const notFound = (detailCode: string) =>
      ({ kind: "failed", code: "ENTITY_NOT_FOUND", detailCode }) as const;
    const drift = (detailCode: string) =>
      ({
        kind: "failed",
        code: "IDENTIFICATION_WORK_PLAN_DRIFT",
        detailCode,
      }) as const;

    try {
      const planRow = await this.#persistence.readRow({
        projectId: input.projectId,
        resultKind: "work-plan",
        resultId: input.workPlanRef.reference.entityId,
        resultVersionId: input.workPlanRef.reference.versionId,
      });
      if (planRow === undefined || planRow.resultKind !== "work-plan") {
        return notFound("work-plan-registration-missing");
      }
      const planBody = await this.#persistence.readBody({
        row: planRow,
        bodyKind: "work-plan",
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        authorization: verified,
      });
      const plan = planBody.bodyKind === "work-plan" ? planBody.workPlan : undefined;
      if (
        plan === undefined ||
        plan.projectId !== input.projectId ||
        !sameJson(plan.workPlanRef, input.workPlanRef)
      ) {
        return drift("work-plan-body-mismatch");
      }
      const snapshotRow = await this.#persistence.readRow({
        projectId: input.projectId,
        resultKind: "input-snapshot",
        resultId: plan.inputSnapshotRef.reference.entityId,
        resultVersionId: plan.inputSnapshotRef.reference.versionId,
      });
      if (snapshotRow === undefined || snapshotRow.resultKind !== "input-snapshot") {
        return drift("input-snapshot-registration-missing");
      }
      const snapshotBody = await this.#persistence.readBody({
        row: snapshotRow,
        bodyKind: "input-snapshot",
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        authorization: verified,
      });
      if (
        snapshotBody.bodyKind !== "input-snapshot" ||
        !sameJson(plan.inputSnapshot, snapshotBody.inputSnapshot)
      ) {
        return drift("input-snapshot-body-mismatch");
      }
      const validatedCandidateSetRefs = await this.#persistence.validatedCandidateSetRefsFor({
        projectId: input.projectId,
        runId: planRow.runId,
        workPlanRef: input.workPlanRef,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        authorization: verified,
      });
      if (validatedCandidateSetRefs === undefined) {
        return drift("stage-result-body-mismatch");
      }
      return {
        kind: "succeeded",
        read: {
          workPlanRef: input.workPlanRef,
          inputSnapshotRef: plan.inputSnapshotRef,
          inputSnapshot: plan.inputSnapshot,
          workItems: plan.workItems.map((item) => ({
            workItemRef: item.workItemRef,
            nodeId: item.nodeId,
            spatialScopeRefs: [...item.spatialScopeRefs],
            sourceVersionRefs: [...item.sourceVersionRefs],
          })),
          validatedCandidateSetRefs,
        },
      };
    } catch {
      return drift("work-plan-read-unavailable");
    }
  }
}

class PostgresIdentificationGraphAdapter implements PostgresIdentificationGraphAdapterV1 {
  readonly registrationStore: IdentificationGraphRegistrationStoreV1;
  readonly contextInputReader: IdentificationContextInputReaderV1;
  readonly workPlanReader: IdentificationWorkPlanReaderV1;
  readonly #persistence: IdentificationGraphPersistence;

  constructor(options: PostgresIdentificationGraphAdapterOptionsV1) {
    this.#persistence = new IdentificationGraphPersistence(options);
    this.registrationStore = new IdentificationGraphRegistrationStore(this.#persistence);
    this.contextInputReader = new IdentificationGraphContextInputReader(this.#persistence);
    this.workPlanReader = new IdentificationGraphWorkPlanReader(this.#persistence);
  }

  async verifyCheckpointWaitingReference(
    input: Parameters<PostgresIdentificationGraphAdapterV1["verifyCheckpointWaitingReference"]>[0],
  ): Promise<boolean> {
    return this.#persistence.verifyCheckpointWaitingReference(input);
  }

  async verifyCheckpointReference(
    input: Parameters<PostgresIdentificationGraphAdapterV1["verifyCheckpointReference"]>[0],
  ): Promise<boolean> {
    const verified = await this.#persistence.verifyAuthorization(input, true);
    if (verified === undefined) return false;
    if (
      input.reference.kind !== "identification-input-snapshot" &&
      input.reference.kind !== "identification-work-plan" &&
      input.reference.kind !== "identification-work-item" &&
      input.reference.kind !== "stage-result" &&
      input.reference.kind !== "workflow-error" &&
      input.reference.kind !== "identification-run-result"
    )
      return false;
    const resultKinds = {
      "identification-input-snapshot": "input-snapshot",
      "identification-work-plan": "work-plan",
      "identification-work-item": "work-plan",
      "stage-result": "stage-result",
      "workflow-error": "workflow-error",
      "identification-run-result": "run-result",
    } as const;
    const resultKind = resultKinds[input.reference.kind];
    const targetRef =
      input.reference.kind === "identification-work-item" ? input.workPlanRef : input.reference;
    if (targetRef === undefined) return false;
    const row =
      input.reference.kind === "workflow-error"
        ? await this.#persistence.readWorkflowErrorRow({
            projectId: input.projectId,
            runId: input.runRef.reference.entityId,
            reference: input.reference,
          })
        : await this.#persistence.readRow({
            projectId: input.projectId,
            resultKind,
            resultId: targetRef.reference.entityId,
            resultVersionId: targetRef.reference.versionId,
          });
    if (row === undefined || row.runId !== input.runRef.reference.entityId) return false;
    const rowRef =
      row.resultKind === "input-snapshot"
        ? row.inputSnapshotRef
        : row.resultKind === "work-plan"
          ? row.workPlanRef
          : row.resultKind === "stage-result"
            ? row.stageResultRef
            : row.resultKind === "workflow-error"
              ? row.workflowErrorRef
              : row.resultKind === "run-result"
                ? row.runResultRef
                : undefined;
    if (!sameJson(rowRef, targetRef)) return false;
    if (row.resultKind === "workflow-error") return true;
    if (
      row.resultKind !== "input-snapshot" &&
      row.resultKind !== "work-plan" &&
      row.resultKind !== "stage-result" &&
      row.resultKind !== "run-result"
    )
      return false;
    return this.#persistence.verifyBody(
      {
        row,
        bodyKind: row.resultKind,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        authorization: verified,
      },
      (body) => {
        switch (body.bodyKind) {
          case "input-snapshot":
            return (
              row.resultKind === "input-snapshot" &&
              sameJson(body.inputSnapshot.preparationSnapshotRef, row.preparationSnapshotRef)
            );
          case "work-plan":
            return (
              row.resultKind === "work-plan" &&
              body.workPlan.projectId === input.projectId &&
              sameJson(body.workPlan.workPlanRef, row.workPlanRef) &&
              sameJson(body.workPlan.inputSnapshotRef, row.inputSnapshotRef) &&
              (input.reference.kind !== "identification-work-item" ||
                body.workPlan.workItems.some((item) => sameJson(item.workItemRef, input.reference)))
            );
          case "stage-result":
            return sameJson(body.stageResult.runRef, input.runRef);
          case "run-result":
            return (
              body.runResult.projectId === input.projectId &&
              sameJson(body.runResult.runRef, input.runRef)
            );
          default:
            return false;
        }
      },
    );
  }

  async registerResults(
    input: PostgresIdentificationGraphRegistrationEntryV1,
    context?: unknown,
  ): Promise<PostgresIdentificationGraphRegistrationOutcomeV1> {
    return this.#persistence.insertRows(input, context);
  }

  async putBody(command: PostgresIdentificationGraphBodyWriteCommandV1): Promise<ArtifactRefV1> {
    return this.#persistence.putBody(command);
  }

  async readWorkPlanBody(
    input: PostgresIdentificationGraphWorkPlanBodyReadV1,
  ): Promise<IdentificationGraphWorkPlanBodyV1 | undefined> {
    const verified = await this.#persistence.verifyAuthorization({
      authorization: input.authorization,
      projectId: input.projectId,
      actorId: input.actorId,
      invocationId: identificationGraphReadInvocationIdV1({
        operation: "work-plan",
        projectId: input.projectId,
        targetId: referenceKey(input.workPlanRef.reference),
      }),
    });
    if (verified === undefined) return undefined;
    return this.#readWorkPlanBody(input, verified);
  }

  async readRegisteredWorkPlan(
    rawCommand: IdentificationPlanCommandV1,
  ): Promise<IdentificationPlanResultV1> {
    const command = IdentificationPlanCommandV1Schema.parse(rawCommand);
    const common = {
      stageCode: "risk-identification.plan",
      causalRunId: command.commandId,
      occurredAt: this.#persistence.now().toISOString(),
      retryable: false as const,
    };
    const verified = await this.#persistence.verifyAuthorization(
      {
        authorization: command.authorization,
        projectId: command.projectId,
        actorId: command.actorId,
        invocationId: command.commandId,
        requestedAt: command.issuedAt,
      },
      true,
    );
    if (
      verified === undefined ||
      command.authorization.spatialScopeRefs.some(
        (ref) => !verified.spatialScopeRefs.some((current) => sameJson(ref, current)),
      ) ||
      command.authorization.sourceAccessGrantRefs.some(
        (ref) => !verified.sourceAccessGrantRefs.some((current) => sameJson(ref, current)),
      )
    ) {
      return {
        kind: "failed",
        error: {
          ...common,
          code: "AUTHORIZATION_DENIED",
          category: "authorization",
          requiredCapability: "risk-identification.run",
          authorizationPolicyRef: command.authorization.authorizationPolicyRef,
        },
      };
    }
    const inputSnapshotRef = command.payload.inputSnapshotRef;
    const workPlanRef = identificationWorkPlanRefFor({
      projectId: command.projectId,
      inputSnapshotRef,
    });
    const plan = await this.#readWorkPlanBody(
      {
        projectId: command.projectId,
        actorId: command.actorId,
        requestedAt: command.issuedAt,
        authorization: verified,
        workPlanRef,
      },
      verified,
    );
    if (plan !== undefined && sameJson(plan.inputSnapshotRef, inputSnapshotRef)) {
      const snapshotRow = await this.#persistence.readRow({
        projectId: command.projectId,
        resultKind: "input-snapshot",
        resultId: inputSnapshotRef.reference.entityId,
        resultVersionId: inputSnapshotRef.reference.versionId,
      });
      if (snapshotRow?.resultKind === "input-snapshot") {
        try {
          const snapshot = await this.#persistence.readBody({
            row: snapshotRow,
            bodyKind: "input-snapshot",
            projectId: command.projectId,
            actorId: command.actorId,
            requestedAt: command.issuedAt,
            authorization: verified,
          });
          if (
            snapshot.bodyKind === "input-snapshot" &&
            sameJson(snapshot.inputSnapshot, plan.inputSnapshot)
          )
            return { kind: "succeeded", result: { workPlanRef } };
        } catch {
          // 已登记引用缺完整正文时不能返回计划成功。
        }
      }
    }
    return {
      kind: "failed",
      error: {
        ...common,
        code: "BUSINESS_BLOCKED",
        category: "business-blocked",
        blockerKind: "identification-work-plan-unavailable",
        blockerRef: inputSnapshotRef,
      },
    };
  }

  async #readWorkPlanBody(
    input: PostgresIdentificationGraphWorkPlanBodyReadV1,
    verified: AuthorizationContextV1,
  ): Promise<IdentificationGraphWorkPlanBodyV1 | undefined> {
    try {
      const row = await this.#persistence.readRow({
        projectId: input.projectId,
        resultKind: "work-plan",
        resultId: input.workPlanRef.reference.entityId,
        resultVersionId: input.workPlanRef.reference.versionId,
      });
      if (row === undefined || row.resultKind !== "work-plan") return undefined;
      const body = await this.#persistence.readBody({
        row,
        bodyKind: "work-plan",
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        authorization: verified,
      });
      if (
        body.bodyKind !== "work-plan" ||
        body.workPlan.projectId !== input.projectId ||
        !sameJson(body.workPlan.workPlanRef, input.workPlanRef) ||
        !sameJson(row.workPlanRef, input.workPlanRef) ||
        !sameJson(row.inputSnapshotRef, body.workPlan.inputSnapshotRef) ||
        body.workPlan.workItems.some((item) =>
          item.spatialScopeRefs.some(
            (scope) => !verified.spatialScopeRefs.some((allowed) => sameJson(scope, allowed)),
          ),
        )
      ) {
        return undefined;
      }
      return body.workPlan;
    } catch {
      return undefined;
    }
  }

  async readInputSnapshotBody(
    input: PostgresIdentificationGraphInputSnapshotBodyReadV1,
  ): Promise<IdentificationInputSnapshotV1 | undefined> {
    const verified = await this.#persistence.verifyAuthorization({
      authorization: input.authorization,
      projectId: input.projectId,
      actorId: input.actorId,
      invocationId: identificationGraphReadInvocationIdV1({
        operation: "context-input",
        projectId: input.projectId,
        targetId: referenceKey(input.inputSnapshotRef.reference),
      }),
    });
    if (verified === undefined) return undefined;
    try {
      const row = await this.#persistence.readRow({
        projectId: input.projectId,
        resultKind: "input-snapshot",
        resultId: input.inputSnapshotRef.reference.entityId,
        resultVersionId: input.inputSnapshotRef.reference.versionId,
      });
      if (row === undefined || row.resultKind !== "input-snapshot") return undefined;
      const body = await this.#persistence.readBody({
        row,
        bodyKind: "input-snapshot",
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        authorization: verified,
      });
      return body.bodyKind === "input-snapshot" ? body.inputSnapshot : undefined;
    } catch {
      return undefined;
    }
  }

  /** 仅从本运行已登记的阶段引用回读 C04 正文；不存在与无权均返回同形结果。 */
  async readStageResultBody(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly stageResultRef: StageResultRefV1;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<IdentificationStageResultV1 | undefined> {
    const verified = await this.#persistence.verifyAuthorization({
      authorization: input.authorization,
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      invocationId: identificationGraphReadInvocationIdV1({
        operation: "stage-result",
        projectId: input.projectId,
        targetId: referenceKey(input.stageResultRef.reference),
      }),
    });
    if (verified === undefined) return undefined;
    try {
      const row = await this.#persistence.readRow({
        projectId: input.projectId,
        resultKind: "stage-result",
        resultId: input.stageResultRef.reference.entityId,
        resultVersionId: input.stageResultRef.reference.versionId,
      });
      if (
        row === undefined ||
        row.resultKind !== "stage-result" ||
        row.runId !== input.runId ||
        !sameJson(row.stageResultRef, input.stageResultRef)
      )
        return undefined;
      const body = await this.#persistence.readBody({
        row,
        bodyKind: "stage-result",
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        authorization: verified,
      });
      return body.bodyKind === "stage-result" &&
        body.stageResult.runRef.reference.entityId === input.runId
        ? body.stageResult
        : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * checkpoint 引用对账（design D-07）：状态内每个 C24 引用都按当前授权做精确业务回读，
   * 任一引用缺失、跨工程或正文与登记不一致即 `inconsistent`。本方法只有 SELECT 与 C04 读取，
   * **零补写**：既不登记新行，也不修写既有行。全部可证明时返回 `workPlan`（状态无
   * `workPlanRef` 时为 `undefined`）。
   */
  async reconcileCheckpointReferences(input: PostgresIdentificationGraphReconcileInputV1): Promise<
    | {
        readonly kind: "consistent";
        readonly workPlan: IdentificationGraphWorkPlanReadV1 | undefined;
      }
    | { readonly kind: "inconsistent"; readonly detailCode: string }
  > {
    const inconsistent = (detailCode: string) => ({ kind: "inconsistent", detailCode }) as const;
    const verified = await this.#persistence.verifyAuthorization({
      authorization: input.authorization,
      projectId: input.projectId,
      actorId: input.actorId,
      invocationId: identificationGraphReadInvocationIdV1({
        operation: "reconcile",
        projectId: input.projectId,
        targetId: input.runId,
      }),
    });
    if (verified === undefined) return inconsistent("authorization-denied");

    const state = input.state;
    // 运行身份必须与调用方声明的运行一致，跨运行或跨工程的 checkpoint 不能作为恢复依据。
    if (state.runRef.reference.entityId !== input.runId) {
      return inconsistent("run-reference-mismatch");
    }
    const rows = await this.#persistence.listRowsOfKind({
      projectId: input.projectId,
      runId: input.runId,
    });

    const readRegisteredRow = async (
      resultKind: IdentificationGraphResultKindV1,
      reference: { readonly entityId: string; readonly versionId: string },
    ): Promise<IdentificationGraphResultRowV1 | undefined> => {
      const row = await this.#persistence.readRow({
        projectId: input.projectId,
        resultKind,
        resultId: reference.entityId,
        resultVersionId: reference.versionId,
      });
      if (row === undefined || row.resultKind !== resultKind) return undefined;
      // 命中行必须属于本次运行的登记集合，否则是别的运行的历史版本。
      const owned = rows.some(
        (candidate) =>
          candidate.resultKind === row.resultKind &&
          candidate.resultId === row.resultId &&
          candidate.resultVersionId === row.resultVersionId,
      );
      return owned ? row : undefined;
    };

    let workPlan: IdentificationGraphWorkPlanReadV1 | undefined;
    if (state.workPlanRef !== undefined) {
      const planRow = await readRegisteredRow("work-plan", state.workPlanRef.reference);
      if (planRow === undefined || planRow.resultKind !== "work-plan") {
        return inconsistent("work-plan-reference-missing");
      }
      if (!sameJson(planRow.workPlanRef, state.workPlanRef)) {
        return inconsistent("work-plan-reference-mismatch");
      }
      const snapshotRow = await readRegisteredRow(
        "input-snapshot",
        planRow.inputSnapshotRef.reference,
      );
      if (snapshotRow === undefined || snapshotRow.resultKind !== "input-snapshot") {
        return inconsistent("input-snapshot-reference-missing");
      }
      if (
        state.inputSnapshotRef !== undefined &&
        !sameJson(snapshotRow.inputSnapshotRef, state.inputSnapshotRef)
      ) {
        return inconsistent("input-snapshot-reference-mismatch");
      }
      const requestedAt = input.requestedAt;
      const body = await this.#persistence.readBody({
        row: planRow,
        bodyKind: "work-plan",
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt,
        authorization: verified,
      });
      if (body.bodyKind !== "work-plan") return inconsistent("work-plan-reference-mismatch");
      const plan = body.workPlan;
      if (
        plan.projectId !== input.projectId ||
        !sameJson(plan.workPlanRef, state.workPlanRef) ||
        !sameJson(plan.inputSnapshotRef, planRow.inputSnapshotRef)
      ) {
        return inconsistent("work-plan-reference-mismatch");
      }
      const snapshotBody = await this.#persistence.readBody({
        row: snapshotRow,
        bodyKind: "input-snapshot",
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt,
        authorization: verified,
      });
      if (
        snapshotBody.bodyKind !== "input-snapshot" ||
        !sameJson(plan.inputSnapshot, snapshotBody.inputSnapshot)
      ) {
        return inconsistent("input-snapshot-reference-mismatch");
      }
      for (const workItemRef of state.failedWorkItemRefs) {
        if (!plan.workItems.some((item) => sameJson(item.workItemRef, workItemRef))) {
          return inconsistent("work-item-reference-missing");
        }
      }
      const validatedCandidateSetRefs = await this.#persistence.validatedCandidateSetRefsFor({
        projectId: input.projectId,
        runId: input.runId,
        workPlanRef: state.workPlanRef,
        actorId: input.actorId,
        requestedAt,
        authorization: verified,
      });
      if (validatedCandidateSetRefs === undefined) {
        return inconsistent("stage-result-reference-mismatch");
      }
      workPlan = {
        workPlanRef: state.workPlanRef,
        inputSnapshotRef: planRow.inputSnapshotRef,
        inputSnapshot: plan.inputSnapshot,
        workItems: plan.workItems.map((item) => ({
          workItemRef: item.workItemRef,
          nodeId: item.nodeId,
          spatialScopeRefs: [...item.spatialScopeRefs],
          sourceVersionRefs: [...item.sourceVersionRefs],
          frozenQueryText: item.frozenQueryText,
        })),
        validatedCandidateSetRefs,
      };
    } else if (state.inputSnapshotRef !== undefined) {
      const row = await readRegisteredRow("input-snapshot", state.inputSnapshotRef.reference);
      if (row === undefined || row.resultKind !== "input-snapshot") {
        return inconsistent("input-snapshot-reference-missing");
      }
      if (!sameJson(row.inputSnapshotRef, state.inputSnapshotRef)) {
        return inconsistent("input-snapshot-reference-mismatch");
      }
    }

    if (state.lastStageResultRef !== undefined) {
      const row = await readRegisteredRow("stage-result", state.lastStageResultRef.reference);
      if (row === undefined || row.resultKind !== "stage-result") {
        return inconsistent("stage-result-reference-missing");
      }
      if (!sameJson(row.stageResultRef, state.lastStageResultRef)) {
        return inconsistent("stage-result-reference-mismatch");
      }
    }

    if (state.lastErrorRef !== undefined) {
      const found = rows.some(
        (row) =>
          row.resultKind === "workflow-error" && sameJson(row.workflowErrorRef, state.lastErrorRef),
      );
      if (!found) return inconsistent("workflow-error-reference-missing");
    }

    if (state.waitingRef !== undefined) {
      const found = rows.some(
        (row) => row.resultKind === "waiting" && sameJson(row.waitingRef, state.waitingRef),
      );
      if (!found) return inconsistent("waiting-reference-missing");
    }

    if (state.resultRef !== undefined) {
      const row = await readRegisteredRow("run-result", state.resultRef.reference);
      if (row === undefined || row.resultKind !== "run-result") {
        return inconsistent("run-result-reference-missing");
      }
      if (!sameJson(row.runResultRef, state.resultRef)) {
        return inconsistent("run-result-reference-mismatch");
      }
    }

    return { kind: "consistent", workPlan };
  }
}

export const createPostgresIdentificationGraphAdapter = (
  options: PostgresIdentificationGraphAdapterOptionsV1,
): PostgresIdentificationGraphAdapterV1 => new PostgresIdentificationGraphAdapter(options);
