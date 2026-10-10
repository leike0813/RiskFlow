import { sql, type Kysely, type Transaction } from "kysely";

import { makePersistenceError } from "../postgres/pool.js";

import {
  DeploymentOperationResultV1Schema,
  type DeploymentOperationResultV1,
  type DeploymentOperationStatusV1,
} from "./schema.js";

/**
 * C37 D-19：单实例活动写运维动作通过 PostgreSQL advisory lock + 操作行租约串行；
 * 阶段、状态与追加审计在同一事务提交。审计提交失败即整体失败，不留半完成状态。
 */

export const DEPLOYMENT_OPERATION_STAGE_V1 = {
  accepted: "accepted",
  awaitingConfirmation: "awaiting-confirmation",
  running: "running",
  auditPending: "audit-pending",
  completed: "completed",
  failed: "failed",
} as const;
export type DeploymentOperationStageV1 =
  (typeof DEPLOYMENT_OPERATION_STAGE_V1)[keyof typeof DEPLOYMENT_OPERATION_STAGE_V1];

export interface DeploymentOperationRowV1 {
  readonly operationId: string;
  readonly instanceId: string;
  readonly idempotencyKey: string;
  readonly payloadDigest: string;
  readonly action: string;
  readonly revision: number;
  readonly stage: string;
  readonly status: DeploymentOperationStatusV1;
  readonly actorId: string;
  readonly inputRefs: readonly string[];
  readonly resultRefs: DeploymentOperationResultRefsV1;
  readonly leaseOwner: string | null;
  readonly leaseUntil: Date | null;
}

/** 结果引用只保存安全标识；正文、秘密与宿主绝对路径从不落库。 */
export interface DeploymentOperationResultRefsV1 {
  readonly releaseId: string;
  readonly backupId?: string;
  readonly perProjectAuditRefs: readonly string[];
  readonly stageCounters: Readonly<Record<string, number>>;
}

const EMPTY_RESULT_REFS_V1: DeploymentOperationResultRefsV1 = Object.freeze({
  releaseId: "unrecorded",
  perProjectAuditRefs: Object.freeze([]),
  stageCounters: Object.freeze({}),
});

const toResultRefs = (value: unknown): DeploymentOperationResultRefsV1 => {
  if (typeof value !== "object" || value === null) return EMPTY_RESULT_REFS_V1;
  const record = value as Record<string, unknown>;
  if (typeof record.releaseId !== "string") return EMPTY_RESULT_REFS_V1;
  return Object.freeze({
    releaseId: record.releaseId,
    ...(typeof record.backupId === "string" ? { backupId: record.backupId } : {}),
    perProjectAuditRefs: Object.freeze(
      Array.isArray(record.perProjectAuditRefs)
        ? record.perProjectAuditRefs.filter((item): item is string => typeof item === "string")
        : [],
    ),
    stageCounters: Object.freeze(
      typeof record.stageCounters === "object" && record.stageCounters !== null
        ? (record.stageCounters as Record<string, number>)
        : {},
    ),
  });
};

export interface DeploymentOperationStoreV1 {
  /** 同 operationId + 同 payloadDigest 复用原阶段；异载荷不可重试冲突。 */
  accept(input: {
    operationId: string;
    instanceId: string;
    idempotencyKey: string;
    payloadDigest: string;
    action: string;
    actorId: string;
    inputRefs: readonly string[];
  }): Promise<DeploymentOperationRowV1>;
  advance(input: {
    operationId: string;
    instanceId: string;
    expectedRevision: number;
    stage: DeploymentOperationStageV1;
    status: DeploymentOperationStatusV1;
    resultRefs: DeploymentOperationResultRefsV1;
    leaseOwner?: string;
    leaseUntil?: Date;
    reasonCode: string;
  }): Promise<DeploymentOperationRowV1>;
  /** 完整消费全部审计行后才允许调用方声明成功。 */
  readAuditRefs(input: { operationId: string; instanceId: string }): Promise<readonly string[]>;
  readResult(input: {
    operationId: string;
    instanceId: string;
  }): Promise<DeploymentOperationResultV1 | undefined>;
  close(): Promise<void>;
}

const AUDIT_ADVISORY_LOCK_NAMESPACE = 700056;

const toRow = (record: Record<string, unknown>): DeploymentOperationRowV1 => ({
  operationId: String(record.operation_id),
  instanceId: String(record.instance_id),
  idempotencyKey: String(record.idempotency_key),
  payloadDigest: String(record.payload_digest),
  action: String(record.action),
  revision: Number(record.revision),
  stage: String(record.stage),
  status: String(record.status) as DeploymentOperationStatusV1,
  actorId: String(record.actor_id),
  inputRefs: (record.input_refs ?? []) as readonly string[],
  resultRefs: toResultRefs(record.result_refs),
  leaseOwner: record.lease_owner === null ? null : String(record.lease_owner),
  leaseUntil: record.lease_until === null ? null : new Date(String(record.lease_until)),
});

export interface PostgresDeploymentOperationStoreV1Options {
  readonly db: Kysely<unknown>;
  readonly instanceId: string;
  readonly now?: () => Date;
  readonly idGenerator?: () => string;
}

/** Kysely 事务执行器：阶段与审计必须在同一事务内提交。 */
type DeploymentOperationExecutorV1 = Kysely<unknown> | Transaction<unknown>;

/** 同键异载荷与陈旧修订都不可重试：调用方必须以原身份重新受理新操作。 */
const conflict = () => makePersistenceError("IDEMPOTENCY_CONFLICT", "deployment.operation");

/** 同实例串行用的确定性 advisory lock 键；只用于进程间串行，不承载业务身份。 */
const advisoryLockKeyFor = (instanceId: string): number =>
  instanceId
    .split("")
    .reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) % 2 ** 31, 7);

export const createPostgresDeploymentOperationStoreV1 = (
  options: PostgresDeploymentOperationStoreV1Options,
): DeploymentOperationStoreV1 => {
  const now = options.now ?? (() => new Date());
  let sequence = 0;
  const nextAuditId = options.idGenerator ?? (() => `deployment-audit-${++sequence}`);

  const appendAudit = async (
    executor: DeploymentOperationExecutorV1,
    row: DeploymentOperationRowV1,
    outcome: string,
    reasonCode: string,
  ): Promise<string> => {
    const eventId = nextAuditId();
    await sql`INSERT INTO business.deployment_operation_audit
      (event_id, operation_id, instance_id, revision, action, stage, outcome, actor_id,
       context_refs, release_refs, backup_ref, reason_code, recorded_at)
      VALUES (${eventId}, ${row.operationId}, ${row.instanceId}, ${row.revision}, ${row.action},
              ${row.stage}, ${outcome}, ${row.actorId},
              ${JSON.stringify(row.inputRefs)}::jsonb,
              ${JSON.stringify([row.resultRefs.releaseId])}::jsonb,
              ${row.resultRefs.backupId ?? null},
              ${reasonCode}, ${now().toISOString()})`.execute(executor);
    return eventId;
  };

  return {
    async accept(input) {
      return options.db.transaction().execute(async (transaction) => {
        // advisory lock 保证同实例的活动运维动作串行，避免阶段交错。
        await sql`SELECT pg_advisory_xact_lock(${AUDIT_ADVISORY_LOCK_NAMESPACE}, ${advisoryLockKeyFor(
          input.instanceId,
        )})`.execute(transaction);

        const existing = await sql<
          Record<string, unknown>
        >`SELECT * FROM business.deployment_operations
          WHERE instance_id = ${input.instanceId} AND idempotency_key = ${input.idempotencyKey}
          FOR UPDATE`.execute(transaction);
        const current = existing.rows[0];
        if (current !== undefined) {
          const row = toRow(current);
          if (row.payloadDigest !== input.payloadDigest) {
            throw conflict();
          }
          return row;
        }

        const inserted = await sql<
          Record<string, unknown>
        >`INSERT INTO business.deployment_operations
          (instance_id, operation_id, idempotency_key, payload_digest, action, revision, stage,
           status, actor_id, input_refs, result_refs, created_at, updated_at)
          VALUES (${input.instanceId}, ${input.operationId}, ${input.idempotencyKey},
                  ${input.payloadDigest}, ${input.action}, 0, ${DEPLOYMENT_OPERATION_STAGE_V1.accepted},
                  'accepted', ${input.actorId}, ${JSON.stringify(input.inputRefs)}::jsonb,
                  '[]'::jsonb, ${now().toISOString()}, ${now().toISOString()})
          ON CONFLICT (instance_id, operation_id) DO NOTHING
          RETURNING *`.execute(transaction);
        const created = inserted.rows[0];
        if (created === undefined) {
          const raced = await sql<
            Record<string, unknown>
          >`SELECT * FROM business.deployment_operations
            WHERE instance_id = ${input.instanceId} AND operation_id = ${input.operationId}
            FOR UPDATE`.execute(transaction);
          const row = toRow(raced.rows[0]!);
          if (row.payloadDigest !== input.payloadDigest) {
            throw conflict();
          }
          return row;
        }
        const row = toRow(created);
        await appendAudit(transaction, row, "accepted", "OPERATION_ACCEPTED");
        return row;
      });
    },

    async advance(input) {
      return options.db.transaction().execute(async (transaction) => {
        await sql`SELECT pg_advisory_xact_lock(${AUDIT_ADVISORY_LOCK_NAMESPACE}, ${advisoryLockKeyFor(
          input.instanceId,
        )})`.execute(transaction);
        const leaseOwner = input.leaseOwner ?? null;
        const leaseUntil = input.leaseUntil ?? null;
        const updated = await sql<Record<string, unknown>>`UPDATE business.deployment_operations
          SET revision = revision + 1, stage = ${input.stage}, status = ${input.status},
              result_refs = ${JSON.stringify(input.resultRefs)}::jsonb,
              lease_owner = ${leaseOwner}, lease_until = ${leaseUntil},
              updated_at = ${now().toISOString()}
          WHERE instance_id = ${input.instanceId} AND operation_id = ${input.operationId}
            AND revision = ${input.expectedRevision}
          RETURNING *`.execute(transaction);
        const record = updated.rows[0];
        if (record === undefined) {
          throw conflict();
        }
        const row = toRow(record);
        await appendAudit(
          transaction,
          row,
          input.status === "completed"
            ? "completed"
            : input.status === "failed"
              ? "failed"
              : "advanced",
          input.reasonCode,
        );
        return row;
      });
    },

    async readAuditRefs(input) {
      const result = await sql<{ event_id: string }>`SELECT event_id
        FROM business.deployment_operation_audit
        WHERE instance_id = ${input.instanceId} AND operation_id = ${input.operationId}
        ORDER BY recorded_at, event_id`.execute(options.db);
      return Object.freeze(result.rows.map((row) => row.event_id));
    },

    async readResult(input) {
      const auditRefs = await this.readAuditRefs(input);
      const result = await sql<Record<string, unknown>>`SELECT * FROM business.deployment_operations
        WHERE instance_id = ${input.instanceId} AND operation_id = ${input.operationId}`.execute(
        options.db,
      );
      const record = result.rows[0];
      if (record === undefined) return undefined;
      const row = toRow(record);
      // 终止原因码取自最后一条已提交审计；缺失说明尚未成立终态结论。
      const terminal = await sql<{ reason_code: string }>`SELECT reason_code
        FROM business.deployment_operation_audit
        WHERE instance_id = ${input.instanceId} AND operation_id = ${input.operationId}
        ORDER BY recorded_at DESC, event_id DESC LIMIT 1`.execute(options.db);
      const reasonCode = terminal.rows[0]?.reason_code;
      if (reasonCode === undefined) return undefined;
      // 只回放已登记的引用；正文、秘密与宿主路径从不进入结果。
      return DeploymentOperationResultV1Schema.parse({
        operationId: row.operationId,
        revision: row.revision,
        stage: row.stage,
        status: row.status,
        safeReasonCode: reasonCode,
        releaseId: row.resultRefs.releaseId,
        instanceId: row.instanceId,
        ...(row.resultRefs.backupId !== undefined ? { backupId: row.resultRefs.backupId } : {}),
        perProjectAuditRefs: row.resultRefs.perProjectAuditRefs,
        operationAuditIds: auditRefs,
        stageCounters: row.resultRefs.stageCounters,
        elapsedMs: 0,
      });
    },

    async close() {
      /* 生命周期由宿主 runtime 统一关闭，store 不持有独立连接。 */
    },
  };
};
