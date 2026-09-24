/**
 * C41 人工决定与反馈命令 PostgreSQL 适配器（design D3/D4/D5）。
 *
 * 只持久化 C41 自有事实：决定终局索引与反馈冻结输入；命令回执、审计、Outbox 事件与事务边界全部
 * 复用 C03 既有事实。公开命令与采纳证明是仅有的两个入口，二者各自复验 C06；表内行只保存精确引用、
 * 状态与规范 DTO，不复制 C27/C28/C30/C25 的正文。
 */
import type { Kysely, Selectable, Transaction } from "kysely";

import {
  MODULE_BRANCH_CAPABILITY_V1,
  HumanDecisionProofQueryV1Schema,
  type AuthorizationContextV1,
  type HumanDecisionProofPortV1,
  type HumanDecisionProofQueryV1,
  type HumanDecisionProofResultV1,
  type HumanDecisionFeedbackPortV1,
  type ModuleBranchV1,
  type RouteDecisionRefV1,
  type WarningResponseRecordResultV1,
} from "@riskflow/contracts/ports";
import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import {
  HumanDecisionFeedbackService,
  type HumanDecisionFeedbackDownstreamAuthorizerV1,
  type HumanDecisionFeedbackServicePortsV1,
  type HumanFeedbackSnapshotStoreV1,
  type HumanResponseDecisionStoreV1,
} from "@riskflow/core/human-decision-feedback";
import {
  HumanFeedbackInputSnapshotRowV1Schema,
  HumanResponseDecisionV1Schema,
  HumanResponseDecisionStateV1Schema,
  failHumanDecisionFeedback,
  toHumanDecisionFeedbackModuleError,
  type HumanFeedbackInputSnapshotRowV1,
  type HumanFeedbackSnapshotReservationV1,
  type HumanResponseDecisionReservationV1,
  type HumanResponseDecisionV1,
} from "@riskflow/core/human-decision-feedback";
import {
  sha256CanonicalJson,
  type AtomicCommandV1,
  type AtomicCommitReceiptV1,
  type AtomicCommitV1,
  type TransactionContextV1,
  type TransactionOptionsV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import type { ResponseLifecycleContextReaderV1, ResponseLifecycleServiceV1 } from "@riskflow/core/response-lifecycle";
import type { ActualAssessmentProofPortV1, ResponseWorkflowBindingProofPortV1, WorkflowPortV1 } from "@riskflow/contracts/ports";

import { getPostgresTransaction } from "../postgres/transaction-unit.js";
import { mapPostgresError } from "../postgres/pool.js";
import type { PostgresDatabase } from "../postgres/types.js";

type JsonColumn = unknown;
type TimestampColumn = Date | string;

interface HumanResponseDecisionDbRow {
  decision_id: string;
  version_id: string;
  schema_version: string;
  project_id: string;
  recommendation_id: string;
  recommendation_version_id: string;
  spatial_scope_entity_id: string;
  spatial_scope_version_id: string;
  state: string;
  reason_code: string;
  decided_by: string;
  decided_at: TimestampColumn;
  route_decision_id: string | null;
  route_decision_version_id: string | null;
  forecast_run_id: string | null;
  forecast_run_version_id: string | null;
  resumed_at: TimestampColumn | null;
  decision_payload: JsonColumn;
  content_digest: string;
  command_id: string;
  idempotency_key: string;
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface HumanFeedbackInputSnapshotDbRow {
  snapshot_id: string;
  version_id: string;
  schema_version: string;
  project_id: string;
  command_kind: string;
  execution_id: string;
  execution_version_id: string;
  actual_assessment_record_id: string;
  actual_assessment_record_version_id: string;
  feedback_id: string;
  feedback_version_id: string;
  spatial_scope_entity_id: string;
  spatial_scope_version_id: string;
  state: string;
  input_digest: string;
  snapshot_payload: JsonColumn;
  content_digest: string;
  command_id: string;
  idempotency_key: string;
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  prepared_at: TimestampColumn;
  committed_at: TimestampColumn | null;
  segment_started_at: TimestampColumn | null;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface HumanDecisionFeedbackDatabase extends PostgresDatabase {
  "business.human_response_decisions": HumanResponseDecisionDbRow;
  "business.human_feedback_input_snapshots": HumanFeedbackInputSnapshotDbRow;
}

const DECISIONS_TABLE = "business.human_response_decisions";
const SNAPSHOTS_TABLE = "business.human_feedback_input_snapshots";

const asTransaction = (
  context: TransactionContextV1,
): Transaction<HumanDecisionFeedbackDatabase> =>
  getPostgresTransaction(context) as unknown as Transaction<HumanDecisionFeedbackDatabase>;

const jsonValue = (value: unknown): unknown => JSON.stringify(value) as unknown;
const toIso = (value: TimestampColumn | null): string | undefined =>
  value === null ? undefined : (value instanceof Date ? value : new Date(value)).toISOString();

const refKey = (ref: { readonly reference: { readonly entityId: string; readonly versionId: string } }): string =>
  `${ref.reference.entityId}\u0000${ref.reference.versionId}`;

const sameRef = (
  left: { readonly reference: { readonly entityId: string; readonly versionId: string } },
  right: { readonly reference: { readonly entityId: string; readonly versionId: string } },
): boolean => refKey(left) === refKey(right);

const sameVersionRef = (
  left: { readonly entityId: string; readonly versionId: string },
  right: { readonly entityId: string; readonly versionId: string },
): boolean => left.entityId === right.entityId && left.versionId === right.versionId;

/** 行 → 规范决定：索引列与正文逐项一致，任一不符即视为不可用事实。 */
const decisionFromRow = (row: Selectable<HumanResponseDecisionDbRow>): HumanResponseDecisionV1 | undefined => {
  const parsed = HumanResponseDecisionV1Schema.safeParse(row.decision_payload);
  const state = HumanResponseDecisionStateV1Schema.safeParse(row.state);
  if (!parsed.success || !state.success || parsed.data.state !== state.data) return undefined;
  const decision = parsed.data;
  if (
    decision.decisionRef.reference.entityId !== row.decision_id ||
    decision.decisionRef.reference.versionId !== row.version_id ||
    decision.projectId !== row.project_id ||
    decision.responseRecommendationRef.reference.entityId !== row.recommendation_id ||
    decision.responseRecommendationRef.reference.versionId !== row.recommendation_version_id ||
    decision.spatialScopeRef.reference.entityId !== row.spatial_scope_entity_id ||
    decision.spatialScopeRef.reference.versionId !== row.spatial_scope_version_id ||
    decision.commandId !== row.command_id ||
    decision.idempotencyKey !== row.idempotency_key ||
    decision.commandDigest !== row.content_digest
  ) {
    return undefined;
  }
  if (
    row.route_decision_id === null ||
    row.route_decision_version_id === null ||
    decision.routeDecisionRef?.reference.entityId !== row.route_decision_id ||
    decision.routeDecisionRef?.reference.versionId !== row.route_decision_version_id
  ) {
    if (row.route_decision_id !== null || decision.routeDecisionRef !== undefined) return undefined;
  }
  if (
    row.forecast_run_id === null ||
    row.forecast_run_version_id === null ||
    decision.forecastRunRef?.reference.entityId !== row.forecast_run_id ||
    decision.forecastRunRef?.reference.versionId !== row.forecast_run_version_id
  ) {
    if (row.forecast_run_id !== null || decision.forecastRunRef !== undefined) return undefined;
  }
  if (decision.resumedAt !== toIso(row.resumed_at)) return undefined;
  return decision;
};

const snapshotFromRow = (
  row: Selectable<HumanFeedbackInputSnapshotDbRow>,
): HumanFeedbackInputSnapshotRowV1 | undefined => {
  const parsed = HumanFeedbackInputSnapshotRowV1Schema.safeParse(row.snapshot_payload);
  if (!parsed.success) return undefined;
  const snapshot = parsed.data;
  if (
    snapshot.feedbackInputSnapshotRef.reference.entityId !== row.snapshot_id ||
    snapshot.feedbackInputSnapshotRef.reference.versionId !== row.version_id ||
    snapshot.projectId !== row.project_id ||
    snapshot.commandKind !== row.command_kind ||
    snapshot.commandId !== row.command_id ||
    snapshot.idempotencyKey !== row.idempotency_key ||
    snapshot.inputDigest !== row.input_digest ||
    snapshot.state !== row.state ||
    snapshot.executionRecordRef.reference.entityId !== row.execution_id ||
    snapshot.executionRecordRef.reference.versionId !== row.execution_version_id ||
    snapshot.actualAssessmentRecordRef.reference.entityId !== row.actual_assessment_record_id ||
    snapshot.actualAssessmentRecordRef.reference.versionId !==
      row.actual_assessment_record_version_id ||
    snapshot.snapshot.feedbackRef.reference.entityId !== row.feedback_id ||
    snapshot.snapshot.feedbackRef.reference.versionId !== row.feedback_version_id ||
    snapshot.spatialScopeRef.reference.entityId !== row.spatial_scope_entity_id ||
    snapshot.spatialScopeRef.reference.versionId !== row.spatial_scope_version_id
  ) {
    return undefined;
  }
  return snapshot;
};

/** 决定行写入列：状态列与规范 DTO 同源，避免出现第二套字段。 */
const decisionColumns = (
  decision: HumanResponseDecisionV1,
  authorization: AuthorizationContextV1,
): Record<string, unknown> => ({
  decision_id: decision.decisionRef.reference.entityId,
  version_id: decision.decisionRef.reference.versionId,
  schema_version: decision.schemaVersion,
  project_id: decision.projectId,
  recommendation_id: decision.responseRecommendationRef.reference.entityId,
  recommendation_version_id: decision.responseRecommendationRef.reference.versionId,
  spatial_scope_entity_id: decision.spatialScopeRef.reference.entityId,
  spatial_scope_version_id: decision.spatialScopeRef.reference.versionId,
  state: decision.state,
  reason_code: decision.reasonCode,
  decided_by: decision.decidedBy,
  decided_at: decision.decidedAt,
  route_decision_id: decision.routeDecisionRef?.reference.entityId ?? null,
  route_decision_version_id: decision.routeDecisionRef?.reference.versionId ?? null,
  forecast_run_id: decision.forecastRunRef?.reference.entityId ?? null,
  forecast_run_version_id: decision.forecastRunRef?.reference.versionId ?? null,
  resumed_at: decision.resumedAt ?? null,
  decision_payload: jsonValue(decision),
  content_digest: decision.commandDigest,
  command_id: decision.commandId,
  idempotency_key: decision.idempotencyKey,
  // 写者与授权上下文逐行留痕：C41 自有事实必须能回答“谁在什么授权下占用/终局了该决定”。
  actor_ref: decision.decidedBy,
  authorization_context_ref: jsonValue(authorization.authorizationContextRef),
});

const snapshotColumns = (row: HumanFeedbackInputSnapshotRowV1): Record<string, unknown> => ({
  snapshot_id: row.feedbackInputSnapshotRef.reference.entityId,
  version_id: row.feedbackInputSnapshotRef.reference.versionId,
  schema_version: row.schemaVersion,
  project_id: row.projectId,
  command_kind: row.commandKind,
  execution_id: row.executionRecordRef.reference.entityId,
  execution_version_id: row.executionRecordRef.reference.versionId,
  actual_assessment_record_id: row.actualAssessmentRecordRef.reference.entityId,
  actual_assessment_record_version_id: row.actualAssessmentRecordRef.reference.versionId,
  feedback_id: row.snapshot.feedbackRef.reference.entityId,
  feedback_version_id: row.snapshot.feedbackRef.reference.versionId,
  spatial_scope_entity_id: row.spatialScopeRef.reference.entityId,
  spatial_scope_version_id: row.spatialScopeRef.reference.versionId,
  state: row.state,
  input_digest: row.inputDigest,
  snapshot_payload: jsonValue(row),
  content_digest: sha256CanonicalJson(row.snapshot),
  command_id: row.commandId,
  idempotency_key: row.idempotencyKey,
  actor_ref: row.snapshot.createdBy,
  authorization_context_ref: jsonValue(row.snapshot.authorizationContextRef),
  prepared_at: row.preparedAt,
  committed_at: row.committedAt ?? null,
  segment_started_at: row.segmentStartedAt ?? null,
  occurred_at: row.snapshot.createdAt,
});

const MAX_SERIALIZATION_ATTEMPTS_V1 = 5;

export interface PostgresHumanDecisionFeedbackAdapterOptionsV1 {
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: TransactionUnitV1;
  /** C05 复验接缝：公开命令入口与采纳证明各自复验当前授权。 */
  readonly access: Pick<LocalIdentityAccessV1, "verify">;
  readonly authorizeDownstream: HumanDecisionFeedbackDownstreamAuthorizerV1;
  /** C30 公共写入口。 */
  readonly workflow: WorkflowPortV1;
  readonly bindingProof: ResponseWorkflowBindingProofPortV1;
  readonly assessmentProof: ActualAssessmentProofPortV1;
  readonly responseLifecycle: ResponseLifecycleServiceV1;
  readonly responseContext: ResponseLifecycleContextReaderV1;
  readonly workflowStartControl: HumanDecisionFeedbackServicePortsV1["workflowStartControl"];
  readonly now?: () => Date;
}

export class PostgresHumanDecisionFeedbackAdapter
  implements HumanDecisionFeedbackPortV1, HumanDecisionProofPortV1
{
  readonly #db: Kysely<HumanDecisionFeedbackDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #access: Pick<LocalIdentityAccessV1, "verify">;
  readonly #service: HumanDecisionFeedbackService;
  readonly #now: () => Date;

  constructor(options: PostgresHumanDecisionFeedbackAdapterOptionsV1) {
    this.#db = options.db as unknown as Kysely<HumanDecisionFeedbackDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#access = options.access;
    this.#now = options.now ?? (() => new Date());
    this.#service = new HumanDecisionFeedbackService({
      ports: {
        access: options.access,
        authorizeDownstream: options.authorizeDownstream,
        decisions: this.#decisions,
        feedbackSnapshots: this.#snapshots,
        workflow: options.workflow,
        bindingProof: options.bindingProof,
        assessmentProof: options.assessmentProof,
        responseLifecycle: options.responseLifecycle,
        responseContext: options.responseContext,
        workflowStartControl: options.workflowStartControl,
        now: this.#now,
      },
    });
  }

  record(
    command: Parameters<HumanDecisionFeedbackPortV1["record"]>[0],
  ): Promise<WarningResponseRecordResultV1> {
    return this.#service.record(command);
  }

  /**
   * 采纳证明（design D5）：只按精确决定引用回读已终局采纳，运行、建议与空间逐项一致；
   * pending、declined、缺失与越权一律同型失败，不披露目标存在性或正文。
   */
  async verifyHumanDecisionCommitted(
    query: HumanDecisionProofQueryV1,
  ): Promise<HumanDecisionProofResultV1> {
    const causalRunId =
      typeof query === "object" && query !== null && "queryId" in query
        ? String((query as { readonly queryId: unknown }).queryId)
        : "human-decision-feedback.unknown-proof";
    try {
      const parsed = HumanDecisionProofQueryV1Schema.safeParse(query);
      if (!parsed.success) {
        failHumanDecisionFeedback(
          "human-decision-feedback-command-unsupported",
          "terminal",
          parsed.error,
        );
      }
      const valid = parsed.data;
      const branch: ModuleBranchV1 = "workflow.resume-run";
      if (
        valid.projectId !== valid.authorization.projectId ||
        valid.actorId !== valid.authorization.actorId ||
        !valid.authorization.grantedCapabilities.includes(MODULE_BRANCH_CAPABILITY_V1[branch])
      ) {
        failHumanDecisionFeedback("human-decision-feedback-authorization-required", "authorization");
      }
      const row = await this.#db
        .selectFrom(DECISIONS_TABLE)
        .selectAll()
        .where("project_id", "=", valid.projectId)
        .where("route_decision_id", "=", valid.payload.routeDecisionRef.reference.entityId)
        .where("route_decision_version_id", "=", valid.payload.routeDecisionRef.reference.versionId)
        .executeTakeFirst();
      if (row === undefined) {
        // 缺失与越权同型：调用方无法据此枚举是否存在该决定。
        failHumanDecisionFeedback("human-decision-feedback-authorization-required", "authorization");
      }
      const decision = decisionFromRow(row);
      if (decision === undefined) {
        failHumanDecisionFeedback("human-decision-feedback-contract-drift", "terminal");
      }
      if (
        decision.state !== "adopted" ||
        decision.routeDecisionRef === undefined ||
        decision.forecastRunRef === undefined ||
        !sameRef(decision.responseRecommendationRef, valid.payload.responseRecommendationRef) ||
        !sameRef(decision.forecastRunRef, valid.payload.workflowRunRef) ||
        !sameVersionRef(decision.routeDecisionRef.reference, valid.payload.routeDecisionRef.reference)
      ) {
        failHumanDecisionFeedback("human-decision-feedback-authorization-required", "authorization");
      }
      const verified = await this.#access
        .verify({
          authorizationContextRef: valid.authorization.authorizationContextRef,
          invocationId: valid.queryId,
          projectId: valid.projectId,
          branch,
          requestedSpatialScopeRefs: [decision.spatialScopeRef],
          requestedSourceVersionRefs: [],
          requestedAt: valid.authorization.decidedAt,
        })
        .catch((error: unknown): never =>
          failHumanDecisionFeedback(
            "human-decision-feedback-authorization-required",
            "authorization",
            error,
          ),
        );
      if (verified.context.actorId !== valid.actorId) {
        failHumanDecisionFeedback("human-decision-feedback-authorization-required", "authorization");
      }
      return {
        kind: "succeeded",
        result: {
          kind: "adopted",
          projectId: decision.projectId,
          routeDecisionRef: decision.routeDecisionRef,
          workflowRunRef: decision.forecastRunRef,
          responseRecommendationRef: decision.responseRecommendationRef,
          spatialScopeRef: decision.spatialScopeRef,
          decidedBy: decision.decidedBy,
          decidedAt: decision.decidedAt,
          auditTrailRef: decision.auditTrailRef,
        },
      };
    } catch (error: unknown) {
      return {
        kind: "failed",
        error: toHumanDecisionFeedbackModuleError(error, causalRunId, this.#nowIso()),
      };
    }
  }

  // ------------------------------------------------------------------------- 事务

  #nowIso(): string {
    return this.#now().toISOString();
  }

  #atomicCommand(
    command: {
      readonly commandId: string;
      readonly idempotencyKey: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly issuedAt: string;
      readonly authorization: AuthorizationContextV1;
    },
    commandKind: string,
    payload: object,
  ): AtomicCommandV1 {
    return {
      projectId: command.projectId,
      commandKind,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      payload: JSON.parse(JSON.stringify(payload)) as Record<string, never>,
      actorRef: command.actorId,
      authorizationContextRef: command.authorization.authorizationContextRef,
      issuedAt: command.issuedAt,
    };
  }

  async #executeWithRetry(
    command: AtomicCommandV1,
    handler: (context: TransactionContextV1) => Promise<AtomicCommitV1>,
  ): Promise<AtomicCommitReceiptV1> {
    const options: TransactionOptionsV1 = { isolationLevel: "serializable" };
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.#transactionUnit.execute(command, handler, options);
      } catch (error: unknown) {
        // 同一业务身份的并发写以唯一约束收口；有限预算内重试序列化失败。
        if (
          attempt < MAX_SERIALIZATION_ATTEMPTS_V1 &&
          mapPostgresError(error, "human-decision-feedback.transaction").retryable
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  #audit(
    input: {
      readonly commandId: string;
      readonly idempotencyKey: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly issuedAt: string;
      readonly authorization: AuthorizationContextV1;
    },
    action: string,
    targetRef: AtomicCommitV1["audit"]["targetRef"],
    recordedAt: string,
    suffix: string,
  ): AtomicCommitV1["audit"] {
    const auditEntryId = `audit-${input.commandId}:${suffix}`;
    return {
      auditEntryId,
      projectId: input.projectId,
      action,
      targetRef,
      actorRef: input.actorId,
      authorizationContextRef: input.authorization.authorizationContextRef,
      occurredAt: input.issuedAt,
      recordedAt,
      version: { entityId: auditEntryId, versionId: "1" },
      commandId: input.commandId,
      idempotencyKey: input.idempotencyKey,
    };
  }

  #decisions: HumanResponseDecisionStoreV1 = {
    readDecision: async (input) => {
      const row = await this.#db
        .selectFrom(DECISIONS_TABLE)
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("recommendation_id", "=", input.responseRecommendationRef.reference.entityId)
        .where(
          "recommendation_version_id",
          "=",
          input.responseRecommendationRef.reference.versionId,
        )
        .executeTakeFirst();
      return row === undefined ? undefined : decisionFromRow(row);
    },

    reserveAdoption: async (input) => {
      const decision = input.decision;
      if (decision.state !== "pending-adoption") {
        failHumanDecisionFeedback("human-decision-feedback-contract-drift", "terminal");
      }
      const receiptCommandId = `${decision.commandId}:c41-reserve-adoption`;
      await this.#executeWithRetry(
        this.#atomicCommand(
          {
            commandId: receiptCommandId,
            idempotencyKey: decision.idempotencyKey,
            projectId: decision.projectId,
            actorId: decision.decidedBy,
            issuedAt: decision.decidedAt,
            authorization: input.authorization,
          },
          "human-decision-feedback.reserve-adoption",
          decision,
        ),
        async (context): Promise<AtomicCommitV1> => {
          const transaction = asTransaction(context);
          const recordedAt = this.#nowIso();
          const audit = this.#audit(
            {
              commandId: receiptCommandId,
              idempotencyKey: decision.idempotencyKey,
              projectId: decision.projectId,
              actorId: decision.decidedBy,
              issuedAt: decision.decidedAt,
              authorization: input.authorization,
            },
            "human-decision-feedback.reserve-adoption",
            decision.decisionRef,
            recordedAt,
            "human-decision-feedback-reserve",
          );
          await transaction
            .insertInto(DECISIONS_TABLE)
            .values({
              ...decisionColumns(decision, input.authorization),
              audit_entry_id: audit.auditEntryId,
              occurred_at: decision.decidedAt,
              recorded_at: recordedAt,
            } as never)
            .onConflict((conflict) =>
              conflict
                .columns(["project_id", "recommendation_id", "recommendation_version_id"])
                .doNothing(),
            )
            .execute();
          return { resultRef: decision.decisionRef, audit, events: [] };
        },
      );
      return await this.#settleReservation(decision);
    },

    declineDecision: async (input) => {
      const decision = input.decision;
      if (decision.state !== "declined") {
        failHumanDecisionFeedback("human-decision-feedback-contract-drift", "terminal");
      }
      const receiptCommandId = `${decision.commandId}:c41-decline-decision`;
      await this.#executeWithRetry(
        this.#atomicCommand(
          {
            commandId: receiptCommandId,
            idempotencyKey: decision.idempotencyKey,
            projectId: decision.projectId,
            actorId: decision.decidedBy,
            issuedAt: decision.decidedAt,
            authorization: input.authorization,
          },
          "human-decision-feedback.decline-decision",
          decision,
        ),
        async (context): Promise<AtomicCommitV1> => {
          const transaction = asTransaction(context);
          const recordedAt = this.#nowIso();
          const audit = this.#audit(
            {
              commandId: receiptCommandId,
              idempotencyKey: decision.idempotencyKey,
              projectId: decision.projectId,
              actorId: decision.decidedBy,
              issuedAt: decision.decidedAt,
              authorization: input.authorization,
            },
            "human-decision-feedback.decline-decision",
            decision.decisionRef,
            recordedAt,
            "human-decision-feedback-decline",
          );
          await transaction
            .insertInto(DECISIONS_TABLE)
            .values({
              ...decisionColumns(decision, input.authorization),
              audit_entry_id: audit.auditEntryId,
              occurred_at: decision.decidedAt,
              recorded_at: recordedAt,
            } as never)
            .onConflict((conflict) =>
              conflict
                .columns(["project_id", "recommendation_id", "recommendation_version_id"])
                .doNothing(),
            )
            .execute();
          return { resultRef: decision.decisionRef, audit, events: [] };
        },
      );
      const stored = await this.#readDecisionRow(
        decision.projectId,
        decision.responseRecommendationRef,
      );
      if (
        stored === undefined ||
        stored.commandId !== decision.commandId ||
        stored.idempotencyKey !== decision.idempotencyKey ||
        stored.commandDigest !== decision.commandDigest ||
        stored.state !== "declined"
      ) {
        // 采纳与拒绝互斥：任何既有异主体/异载荷/已采纳事实都不得被覆盖。
        return {
          kind: "conflict",
          detailCode: "human-decision-feedback-decision-conflict",
        } satisfies HumanResponseDecisionReservationV1;
      }
      return { kind: "reserved", decision: stored } satisfies HumanResponseDecisionReservationV1;
    },

    commitAdoption: async (input) => {
      const stored = await this.#readDecisionRowById(input.projectId, input.decisionRef);
      if (stored === undefined) {
        failHumanDecisionFeedback("human-decision-feedback-decision-required", "business-blocked");
      }
      const settled: HumanResponseDecisionV1 = HumanResponseDecisionV1Schema.parse({
        ...stored,
        state: "adopted",
        routeDecisionRef: input.routeDecisionRef,
        forecastRunRef: input.forecastRunRef,
      });
      const receiptCommandId = `${stored.commandId}:c41-commit-adoption`;
      const receiptIdempotencyKey = `${input.decisionRef.entityId}:${input.decisionRef.versionId}:commit-adoption`;
      await this.#executeWithRetry(
        this.#atomicCommand(
          {
            commandId: receiptCommandId,
            idempotencyKey: receiptIdempotencyKey,
            projectId: input.projectId,
            actorId: stored.decidedBy,
            issuedAt: input.committedAt,
            authorization: input.authorization,
          },
          "human-decision-feedback.commit-adoption",
          { decisionRef: input.decisionRef, routeDecisionRef: input.routeDecisionRef, forecastRunRef: input.forecastRunRef },
        ),
        async (context): Promise<AtomicCommitV1> => {
          const transaction = asTransaction(context);
          const recordedAt = this.#nowIso();
          await transaction
            .updateTable(DECISIONS_TABLE)
            .set({
              state: settled.state,
              route_decision_id: input.routeDecisionRef.reference.entityId,
              route_decision_version_id: input.routeDecisionRef.reference.versionId,
              forecast_run_id: input.forecastRunRef.reference.entityId,
              forecast_run_version_id: input.forecastRunRef.reference.versionId,
              decision_payload: jsonValue(settled),
              content_digest: settled.commandDigest,
            } as never)
            .where("project_id", "=", input.projectId)
            .where("decision_id", "=", input.decisionRef.entityId)
            .where("version_id", "=", input.decisionRef.versionId)
            .execute();
          return {
            resultRef: input.routeDecisionRef,
            audit: this.#audit(
              {
                commandId: receiptCommandId,
                idempotencyKey: receiptIdempotencyKey,
                projectId: input.projectId,
                actorId: stored.decidedBy,
                issuedAt: settled.decidedAt,
                authorization: input.authorization,
              },
              "human-decision-feedback.commit-adoption",
              input.routeDecisionRef,
              recordedAt,
              "human-decision-feedback-commit",
            ),
            events: [],
          };
        },
      );
      const committed = await this.#readDecisionRowById(input.projectId, input.decisionRef);
      if (
        committed === undefined ||
        committed.state !== "adopted" ||
        committed.routeDecisionRef === undefined ||
        !sameVersionRef(committed.routeDecisionRef.reference, input.routeDecisionRef.reference) ||
        committed.forecastRunRef === undefined ||
        !sameVersionRef(committed.forecastRunRef.reference, input.forecastRunRef.reference)
      ) {
        failHumanDecisionFeedback("human-decision-feedback-decision-conflict", "idempotency");
      }
      return committed;
    },

    markAdoptionResumed: async (input) => {
      const stored = await this.#readDecisionRowById(input.projectId, input.decisionRef);
      if (stored === undefined || stored.state !== "adopted") {
        failHumanDecisionFeedback("human-decision-feedback-decision-required", "business-blocked");
      }
      const resumed = HumanResponseDecisionV1Schema.parse({
        ...stored,
        resumedAt: input.resumedAt,
      });
      const receiptCommandId = `${stored.commandId}:c41-mark-adoption-resumed`;
      const receiptIdempotencyKey = `${input.decisionRef.entityId}:${input.decisionRef.versionId}:resumed`;
      await this.#executeWithRetry(
        this.#atomicCommand(
          {
            commandId: receiptCommandId,
            idempotencyKey: receiptIdempotencyKey,
            projectId: input.projectId,
            actorId: stored.decidedBy,
            issuedAt: input.resumedAt,
            authorization: input.authorization,
          },
          "human-decision-feedback.mark-adoption-resumed",
          { decisionRef: input.decisionRef, resumedAt: input.resumedAt },
        ),
        async (context): Promise<AtomicCommitV1> => {
          const transaction = asTransaction(context);
          const recordedAt = this.#nowIso();
          await transaction
            .updateTable(DECISIONS_TABLE)
            .set({ resumed_at: input.resumedAt, decision_payload: jsonValue(resumed) } as never)
            .where("project_id", "=", input.projectId)
            .where("decision_id", "=", input.decisionRef.entityId)
            .where("version_id", "=", input.decisionRef.versionId)
            .execute();
          return {
            resultRef: stored.decisionRef,
            audit: this.#audit(
              {
                commandId: receiptCommandId,
                idempotencyKey: receiptIdempotencyKey,
                projectId: input.projectId,
                actorId: stored.decidedBy,
                issuedAt: input.resumedAt,
                authorization: input.authorization,
              },
              "human-decision-feedback.mark-adoption-resumed",
              stored.decisionRef,
              recordedAt,
              "human-decision-feedback-resumed",
            ),
            events: [],
          };
        },
      );
    },
  };

  /** 占用回读：内容寻址，重放命中同一行；异主体或异载荷即冲突（design D3）。 */
  async #settleReservation(
    decision: HumanResponseDecisionV1,
  ): Promise<HumanResponseDecisionReservationV1> {
    const stored = await this.#readDecisionRow(decision.projectId, decision.responseRecommendationRef);
    if (stored === undefined) {
      return { kind: "conflict", detailCode: "human-decision-feedback-decision-required" };
    }
    if (
      stored.commandId !== decision.commandId ||
      stored.idempotencyKey !== decision.idempotencyKey ||
      stored.commandDigest !== decision.commandDigest ||
      stored.state === "declined"
    ) {
      return { kind: "conflict", detailCode: "human-decision-feedback-decision-conflict" };
    }
    return { kind: "reserved", decision: stored };
  }

  async #readDecisionRow(
    projectId: string,
    recommendationRef: { readonly reference: { readonly entityId: string; readonly versionId: string } },
  ): Promise<HumanResponseDecisionV1 | undefined> {
    const row = await this.#db
      .selectFrom(DECISIONS_TABLE)
      .selectAll()
      .where("project_id", "=", projectId)
      .where("recommendation_id", "=", recommendationRef.reference.entityId)
      .where("recommendation_version_id", "=", recommendationRef.reference.versionId)
      .executeTakeFirst();
    return row === undefined ? undefined : decisionFromRow(row);
  }

  async #readDecisionRowById(
    projectId: string,
    decisionRef: { readonly entityId: string; readonly versionId: string },
  ): Promise<HumanResponseDecisionV1 | undefined> {
    const row = await this.#db
      .selectFrom(DECISIONS_TABLE)
      .selectAll()
      .where("project_id", "=", projectId)
      .where("decision_id", "=", decisionRef.entityId)
      .where("version_id", "=", decisionRef.versionId)
      .executeTakeFirst();
    return row === undefined ? undefined : decisionFromRow(row);
  }

  #snapshots: HumanFeedbackSnapshotStoreV1 = {
    readSnapshot: async (input) => {
      const row = await this.#db
        .selectFrom(SNAPSHOTS_TABLE)
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("command_kind", "=", input.commandKind)
        .where("idempotency_key", "=", input.idempotencyKey)
        .executeTakeFirst();
      return row === undefined ? undefined : snapshotFromRow(row);
    },

    prepareSnapshot: async (input) => {
      const prepared = input.row;
      const receiptCommandId = `${prepared.commandId}:c41-prepare-snapshot`;
      await this.#executeWithRetry(
        this.#atomicCommand(
          {
            commandId: receiptCommandId,
            idempotencyKey: prepared.idempotencyKey,
            projectId: prepared.projectId,
            actorId: prepared.snapshot.createdBy,
            issuedAt: prepared.snapshot.createdAt,
            authorization: input.authorization,
          },
          "human-decision-feedback.prepare-snapshot",
          { inputDigest: prepared.inputDigest, feedbackRef: prepared.snapshot.feedbackRef },
        ),
        async (context): Promise<AtomicCommitV1> => {
          const transaction = asTransaction(context);
          const recordedAt = this.#nowIso();
          const audit = this.#audit(
            {
              commandId: receiptCommandId,
              idempotencyKey: prepared.idempotencyKey,
              projectId: prepared.projectId,
              actorId: prepared.snapshot.createdBy,
              issuedAt: prepared.snapshot.createdAt,
              authorization: input.authorization,
            },
            "human-decision-feedback.prepare-snapshot",
            prepared.feedbackInputSnapshotRef,
            recordedAt,
            "human-decision-feedback-prepare",
          );
          await transaction
            .insertInto(SNAPSHOTS_TABLE)
            .values({
              ...snapshotColumns(prepared),
              audit_entry_id: audit.auditEntryId,
              recorded_at: recordedAt,
            } as never)
            .onConflict((conflict) =>
              conflict.columns(["project_id", "command_kind", "idempotency_key"]).doNothing(),
            )
            .execute();
          return { resultRef: prepared.feedbackInputSnapshotRef, audit, events: [] };
        },
      );
      const stored = await this.#readSnapshotRow(
        prepared.projectId,
        prepared.commandKind,
        prepared.idempotencyKey,
      );
      if (stored === undefined) {
        return { kind: "conflict", detailCode: "human-decision-feedback-frozen-input-unavailable" };
      }
      if (stored.inputDigest !== prepared.inputDigest) {
        return { kind: "conflict", detailCode: "human-decision-feedback-frozen-input-conflict" };
      }
      return { kind: "prepared", row: stored };
    },

    markSnapshotCommitted: async (input) => {
      const stored = await this.#readSnapshotRowByRef(input.projectId, input.feedbackInputSnapshotRef);
      if (stored === undefined) {
        failHumanDecisionFeedback("human-decision-feedback-frozen-input-unavailable", "business-blocked");
      }
      const committed = HumanFeedbackInputSnapshotRowV1Schema.parse({
        ...stored,
        state: "committed",
        committedAt: input.committedAt,
      });
      const receiptCommandId = `${stored.commandId}:c41-mark-snapshot-committed`;
      const receiptIdempotencyKey = `${stored.feedbackInputSnapshotRef.reference.entityId}:committed`;
      await this.#executeWithRetry(
        this.#atomicCommand(
          {
            commandId: receiptCommandId,
            idempotencyKey: receiptIdempotencyKey,
            projectId: input.projectId,
            actorId: stored.snapshot.createdBy,
            issuedAt: input.committedAt,
            authorization: input.authorization,
          },
          "human-decision-feedback.commit-snapshot",
          { snapshotRef: stored.feedbackInputSnapshotRef, committedAt: input.committedAt },
        ),
        async (context): Promise<AtomicCommitV1> => {
          const transaction = asTransaction(context);
          const recordedAt = this.#nowIso();
          await transaction
            .updateTable(SNAPSHOTS_TABLE)
            .set({
              state: "committed",
              committed_at: input.committedAt,
              snapshot_payload: jsonValue(committed),
            } as never)
            .where("project_id", "=", input.projectId)
            .where("snapshot_id", "=", stored.feedbackInputSnapshotRef.reference.entityId)
            .where("version_id", "=", stored.feedbackInputSnapshotRef.reference.versionId)
            .execute();
          return {
            resultRef: stored.feedbackInputSnapshotRef,
            audit: this.#audit(
              {
                commandId: receiptCommandId,
                idempotencyKey: receiptIdempotencyKey,
                projectId: input.projectId,
                actorId: stored.snapshot.createdBy,
                issuedAt: stored.snapshot.createdAt,
                authorization: input.authorization,
              },
              "human-decision-feedback.commit-snapshot",
              stored.feedbackInputSnapshotRef,
              recordedAt,
              "human-decision-feedback-committed",
            ),
            events: [],
          };
        },
      );
    },

    markSegmentStarted: async (input) => {
      const stored = await this.#readSnapshotRowByRef(input.projectId, input.feedbackInputSnapshotRef);
      if (stored === undefined || stored.state !== "committed") {
        failHumanDecisionFeedback("human-decision-feedback-frozen-input-unavailable", "business-blocked");
      }
      const started = HumanFeedbackInputSnapshotRowV1Schema.parse({
        ...stored,
        segmentStartedAt: input.startedAt,
      });
      const receiptCommandId = `${stored.commandId}:c41-mark-segment-started`;
      const receiptIdempotencyKey = `${stored.feedbackInputSnapshotRef.reference.entityId}:segment-started`;
      await this.#executeWithRetry(
        this.#atomicCommand(
          {
            commandId: receiptCommandId,
            idempotencyKey: receiptIdempotencyKey,
            projectId: input.projectId,
            actorId: stored.snapshot.createdBy,
            issuedAt: input.startedAt,
            authorization: input.authorization,
          },
          "human-decision-feedback.mark-segment-started",
          { snapshotRef: stored.feedbackInputSnapshotRef, startedAt: input.startedAt },
        ),
        async (context): Promise<AtomicCommitV1> => {
          const transaction = asTransaction(context);
          const recordedAt = this.#nowIso();
          await transaction
            .updateTable(SNAPSHOTS_TABLE)
            .set({ segment_started_at: input.startedAt, snapshot_payload: jsonValue(started) } as never)
            .where("project_id", "=", input.projectId)
            .where("snapshot_id", "=", stored.feedbackInputSnapshotRef.reference.entityId)
            .where("version_id", "=", stored.feedbackInputSnapshotRef.reference.versionId)
            .execute();
          return {
            resultRef: stored.feedbackInputSnapshotRef,
            audit: this.#audit(
              {
                commandId: receiptCommandId,
                idempotencyKey: receiptIdempotencyKey,
                projectId: input.projectId,
                actorId: stored.snapshot.createdBy,
                issuedAt: stored.snapshot.createdAt,
                authorization: input.authorization,
              },
              "human-decision-feedback.mark-segment-started",
              stored.feedbackInputSnapshotRef,
              recordedAt,
              "human-decision-feedback-segment",
            ),
            events: [],
          };
        },
      );
    },
  };

  async #readSnapshotRow(
    projectId: string,
    commandKind: "warning-response.record-feedback",
    idempotencyKey: string,
  ): Promise<HumanFeedbackInputSnapshotRowV1 | undefined> {
    const row = await this.#db
      .selectFrom(SNAPSHOTS_TABLE)
      .selectAll()
      .where("project_id", "=", projectId)
      .where("command_kind", "=", commandKind)
      .where("idempotency_key", "=", idempotencyKey)
      .executeTakeFirst();
    return row === undefined ? undefined : snapshotFromRow(row);
  }

  async #readSnapshotRowByRef(
    projectId: string,
    snapshotRef: { readonly reference: { readonly entityId: string; readonly versionId: string } },
  ): Promise<HumanFeedbackInputSnapshotRowV1 | undefined> {
    const row = await this.#db
      .selectFrom(SNAPSHOTS_TABLE)
      .selectAll()
      .where("project_id", "=", projectId)
      .where("snapshot_id", "=", snapshotRef.reference.entityId)
      .where("version_id", "=", snapshotRef.reference.versionId)
      .executeTakeFirst();
    return row === undefined ? undefined : snapshotFromRow(row);
  }
}

export const createPostgresHumanDecisionFeedbackAdapter = (
  options: PostgresHumanDecisionFeedbackAdapterOptionsV1,
): PostgresHumanDecisionFeedbackAdapter => new PostgresHumanDecisionFeedbackAdapter(options);
