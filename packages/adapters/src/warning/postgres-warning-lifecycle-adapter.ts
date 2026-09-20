import { randomUUID } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import { AccessServiceError, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import {
  InAppNotificationV1Schema,
  NotificationIntentV1Schema,
  WarningAssessmentContextV1Schema,
  failWarningLifecycle,
  planWarningOpening,
  toWarningModuleError,
  warningLifecycleFailureFrom,
  type InAppNotificationV1,
  type WarningAcknowledgementCommandV1,
  type WarningAssessmentContextReaderV1,
  type WarningAssessmentContextV1,
  type WarningInAppNotificationWriterV1,
  type WarningLifecycleFailureV1,
  type WarningLifecycleServiceV1,
  type WarningOpeningPlanV1,
  type WarningRuntimePolicyProviderV1,
} from "@riskflow/core/warning";
import {
  sha256CanonicalJson,
  type AtomicCommandV1,
  type AtomicCommitV1,
  type AtomicCommitReceiptV1,
  type TransactionContextV1,
  type TransactionOptionsV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import { DomainEventV1Schema } from "@riskflow/contracts/events";
import {
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  OpenWarningCommandV1Schema,
  RiskInputVersionRefV1Schema,
  SpatialScopeRefV1Schema,
  WarningResponseRecordCommandV1Schema,
  type AuthorizationContextV1,
  type ModuleErrorV1,
  type NotificationIntentRefV1,
  type OpenWarningCommandV1,
  type OpenWarningResultV1,
  type OpenWarningSuccessV1,
  type RiskAssessmentRecordRefV1,
  type SpatialScopeRefV1,
  type WarningRecordRefV1,
  type WarningResponseRecordResultV1,
  type WarningResponseTaskRefV1,
} from "@riskflow/contracts/ports";
import { RiskAssessmentRecordSchema } from "@riskflow/contracts/records";
import { AssessmentInputSnapshotV1Schema } from "@riskflow/contracts/workflows";
import {
  WARNING_TRIGGER_TYPE_VALUES,
  WarningTriggerTypeSchema,
  type WarningTriggerType,
} from "@riskflow/contracts/vocabulary";

import { mapPostgresError } from "../postgres/pool.js";
import { getPostgresTransaction } from "../postgres/transaction-unit.js";
import type { PostgresDatabase } from "../postgres/types.js";
import type { RiskAssessmentDatabase } from "../risk-assessment/engine/index.js";

type JsonColumn = RiskAssessmentDatabase["business.risk_assessment_records"]["record_payload"];
type TimestampColumn = RiskAssessmentDatabase["business.risk_assessment_records"]["occurred_at"];

interface WarningRecordRow {
  project_id: string;
  warning_record_id: string;
  version_id: string;
  schema_version: string;
  assessment_record_id: string;
  assessment_record_version_id: string;
  assessment_input_snapshot_id: string;
  assessment_input_snapshot_version_id: string;
  preparation_snapshot_id: string;
  preparation_snapshot_version_id: string;
  risk_input_kind: string;
  risk_input_entity_id: string;
  risk_input_version_id: string;
  spatial_scope_entity_id: string;
  spatial_scope_version_id: string;
  trigger_type: string;
  risk_level_id: string;
  warning_aggregation_policy_entity_id: string;
  warning_aggregation_policy_version_id: string;
  notification_policy_entity_id: string;
  notification_policy_version_id: string;
  content_digest: string;
  warning_payload: JsonColumn;
  command_id: string;
  idempotency_key: string;
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface WarningResponseTaskRow {
  project_id: string;
  task_id: string;
  schema_version: string;
  risk_input_kind: string;
  risk_input_entity_id: string;
  spatial_scope_entity_id: string;
  aggregation_key: JsonColumn;
  status: "open" | "closed";
  current_version_id: string;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

interface WarningResponseTaskVersionRow {
  project_id: string;
  task_id: string;
  version_id: string;
  schema_version: string;
  status: "open" | "closed";
  aggregation_key: JsonColumn;
  spatial_scope_ref: JsonColumn;
  command_id: string;
  idempotency_key: string;
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface WarningResponseTaskWarningRow {
  project_id: string;
  task_id: string;
  first_included_version_id: string;
  warning_record_id: string;
  warning_record_version_id: string;
  recorded_at: TimestampColumn;
}

interface NotificationIntentRow {
  project_id: string;
  intent_id: string;
  version_id: string;
  schema_version: string;
  warning_record_id: string;
  warning_record_version_id: string;
  task_id: string;
  task_version_id: string;
  notification_policy_entity_id: string;
  notification_policy_version_id: string;
  recipient_actor_id: string;
  channel: string;
  intent_payload: JsonColumn;
  command_id: string;
  idempotency_key: string;
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface InAppNotificationRow {
  project_id: string;
  notification_intent_id: string;
  notification_intent_version_id: string;
  warning_record_id: string;
  warning_record_version_id: string;
  task_id: string;
  task_version_id: string;
  recipient_actor_id: string;
  channel: string;
  delivered_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface WarningAcknowledgementRow {
  project_id: string;
  warning_record_id: string;
  warning_record_version_id: string;
  task_id: string;
  task_version_id: string;
  acknowledged_by_actor_id: string;
  command_id: string;
  idempotency_key: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  acknowledged_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

/** C25 的准备快照行只暴露其自身读取所需列；C26 需要空间与风险输入引用列。 */
type WarningAssessmentPreparationSnapshotRow =
  RiskAssessmentDatabase["business.assessment_preparation_snapshots"] & {
    risk_input_ref: JsonColumn;
    spatial_scope_ref: JsonColumn;
  };

type WarningDatabase = RiskAssessmentDatabase & {
  "business.assessment_preparation_snapshots": WarningAssessmentPreparationSnapshotRow;
  "business.warning_records": WarningRecordRow;
  "business.warning_response_tasks": WarningResponseTaskRow;
  "business.warning_response_task_versions": WarningResponseTaskVersionRow;
  "business.warning_response_task_warnings": WarningResponseTaskWarningRow;
  "business.notification_intents": NotificationIntentRow;
  "business.in_app_notifications": InAppNotificationRow;
  "business.warning_acknowledgements": WarningAcknowledgementRow;
};

type CanonicalWarningV1 = {
  readonly warningRef: WarningRecordRefV1;
  readonly triggerType: WarningTriggerType;
  readonly created: boolean;
};

const asWarningTransaction = (context: TransactionContextV1): Transaction<WarningDatabase> =>
  getPostgresTransaction(context) as unknown as Transaction<WarningDatabase>;

const jsonValue = (value: unknown): unknown => JSON.stringify(value) as unknown;

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const warningRefPairKey = (ref: WarningRecordRefV1): string =>
  `${ref.reference.entityId}\u0000${ref.reference.versionId}`;

const compareVersionReferences = (
  left: { readonly entityId: string; readonly versionId: string },
  right: { readonly entityId: string; readonly versionId: string },
): number =>
  left.entityId === right.entityId
    ? left.versionId < right.versionId
      ? -1
      : 1
    : left.entityId < right.entityId
      ? -1
      : 1;

const sameVersionReference = (
  left: { readonly entityId: string; readonly versionId: string },
  right: { readonly entityId: string; readonly versionId: string },
): boolean => left.entityId === right.entityId && left.versionId === right.versionId;

const MAX_SERIALIZATION_ATTEMPTS_V1 = 3;

/** C26 私有只读端口实现：只按精确引用投影 C25 已持久化的公共评估记录与冻结输入。 */
export class PostgresWarningAssessmentContextReader implements WarningAssessmentContextReaderV1 {
  readonly #db: Kysely<WarningDatabase>;

  constructor(options: { readonly db: Kysely<PostgresDatabase> }) {
    this.#db = options.db as unknown as Kysely<WarningDatabase>;
  }

  async read(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly assessmentRecordRef: RiskAssessmentRecordRefV1;
  }): Promise<WarningAssessmentContextV1> {
    const targetRef = input.assessmentRecordRef;
    const row = await this.#db
      .selectFrom("business.risk_assessment_records as record")
      .innerJoin("business.assessment_input_snapshots as input", (join) =>
        join
          .onRef("input.input_snapshot_id", "=", "record.input_snapshot_id")
          .onRef("input.version_id", "=", "record.input_snapshot_version_id"),
      )
      .innerJoin("business.assessment_preparation_snapshots as preparation", (join) =>
        join
          .onRef("preparation.snapshot_id", "=", "input.preparation_snapshot_id")
          .onRef("preparation.version_id", "=", "input.preparation_snapshot_version_id"),
      )
      .select([
        "record.project_id as project_id",
        "record.record_id as record_id",
        "record.record_payload as record_payload",
        "input.input_snapshot_id as input_snapshot_id",
        "input.version_id as input_snapshot_version_id",
        "input.preparation_snapshot_id as preparation_snapshot_id",
        "input.preparation_snapshot_version_id as preparation_snapshot_version_id",
        "input.snapshot_payload as input_snapshot_payload",
        "preparation.risk_input_ref as risk_input_ref",
        "preparation.spatial_scope_ref as spatial_scope_ref",
      ] as const)
      .where("record.project_id", "=", input.authorization.projectId)
      .where("record.record_id", "=", targetRef.reference.entityId)
      .where("record.version_id", "=", targetRef.reference.versionId)
      .executeTakeFirst();
    if (row === undefined) failWarningLifecycle("assessment-unavailable", targetRef);

    const record = RiskAssessmentRecordSchema.safeParse(row.record_payload);
    const inputSnapshot = AssessmentInputSnapshotV1Schema.safeParse(row.input_snapshot_payload);
    const riskInputRef = RiskInputVersionRefV1Schema.safeParse(row.risk_input_ref);
    const spatialScopeRef = SpatialScopeRefV1Schema.safeParse(row.spatial_scope_ref);
    if (
      !record.success ||
      !inputSnapshot.success ||
      !riskInputRef.success ||
      !spatialScopeRef.success ||
      record.data.assessmentRecordId !== row.record_id ||
      inputSnapshot.data.preparationSnapshotRef.reference.entityId !==
        row.preparation_snapshot_id ||
      inputSnapshot.data.preparationSnapshotRef.reference.versionId !==
        row.preparation_snapshot_version_id
    ) {
      failWarningLifecycle("assessment-contract-drift", targetRef);
    }

    const context = WarningAssessmentContextV1Schema.safeParse({
      schemaVersion: "1",
      projectId: row.project_id,
      assessmentRecordRef: targetRef,
      assessmentRecord: record.data,
      assessmentInputSnapshotRef: {
        kind: "assessment-input-snapshot",
        reference: { entityId: row.input_snapshot_id, versionId: row.input_snapshot_version_id },
      },
      preparationSnapshotRef: {
        kind: "assessment-preparation-snapshot",
        reference: {
          entityId: row.preparation_snapshot_id,
          versionId: row.preparation_snapshot_version_id,
        },
      },
      warningAggregationPolicyRef: inputSnapshot.data.warningAggregationPolicyRef,
      notificationPolicyRef: inputSnapshot.data.notificationPolicyRef,
      riskInputRef: riskInputRef.data,
      spatialScopeRef: spatialScopeRef.data,
    });
    if (!context.success) failWarningLifecycle("assessment-contract-drift", targetRef);
    return context.data;
  }
}

export interface PostgresWarningLifecycleAdapterOptionsV1 {
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: TransactionUnitV1;
  readonly access: LocalIdentityAccessV1;
  /** C25 权威评估记录的精确窄读；组合根注入本包的 `PostgresWarningAssessmentContextReader`。 */
  readonly assessmentContext: WarningAssessmentContextReaderV1;
  /** 部署组合根注入的正式运行时策略提供者：只按精确引用返回，不提供 latest/default。 */
  readonly runtimePolicies: WarningRuntimePolicyProviderV1;
  readonly now?: () => Date;
}

/**
 * C26 正式用例 adapter：`open` 只消费 C25 已持久化触发事实，并在一个事务里写入
 * 预警、任务版本、通知意图、审计、回执与事件；`acknowledge` 只追加独立确认事实。
 * 同时实现事务绑定的应用内投递写入器，供 C03 幂等消费者在自有事务内调用。
 */
export class PostgresWarningLifecycleAdapter
  implements WarningLifecycleServiceV1, WarningInAppNotificationWriterV1
{
  readonly #db: Kysely<WarningDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #access: LocalIdentityAccessV1;
  readonly #assessmentContext: WarningAssessmentContextReaderV1;
  readonly #runtimePolicies: WarningRuntimePolicyProviderV1;
  readonly #now: () => Date;

  constructor(options: PostgresWarningLifecycleAdapterOptionsV1) {
    this.#db = options.db as unknown as Kysely<WarningDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#access = options.access;
    this.#assessmentContext = options.assessmentContext;
    this.#runtimePolicies = options.runtimePolicies;
    this.#now = options.now ?? (() => new Date());
  }

  // --------------------------------------------------------------- authorization

  #failAuthorization(): never {
    failWarningLifecycle("warning-lifecycle-authorization-required", {
      kind: "authorization-context",
      reference: { entityId: "warning-response.unauthorized", versionId: "1" },
    });
  }

  async #verifyCommand(
    command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly authorization: AuthorizationContextV1;
    },
    branch: keyof typeof MODULE_BRANCH_CAPABILITY_V1,
  ): Promise<AuthorizationContextV1> {
    const capability = MODULE_BRANCH_CAPABILITY_V1[branch];
    if (
      command.projectId !== command.authorization.projectId ||
      command.actorId !== command.authorization.actorId ||
      !command.authorization.grantedCapabilities.includes(capability)
    ) {
      this.#failAuthorization();
    }
    const decision = await this.#access
      .verify({
        authorizationContextRef: command.authorization.authorizationContextRef,
        invocationId: command.commandId,
        projectId: command.projectId,
        branch,
        requestedSpatialScopeRefs: [...command.authorization.spatialScopeRefs],
        requestedSourceVersionRefs: [],
        requestedAt: command.authorization.decidedAt,
      })
      .catch((error: unknown): never => {
        if (error instanceof AccessServiceError) this.#failAuthorization();
        throw error;
      });
    if (decision.context.actorId !== command.actorId) this.#failAuthorization();
    return decision.context;
  }

  #requireAuthorizedSpatialScope(
    verified: AuthorizationContextV1,
    spatialScopeRef: SpatialScopeRefV1,
  ): void {
    if (!this.#hasAuthorizedSpatialScope(verified, spatialScopeRef.reference.entityId)) {
      this.#failAuthorization();
    }
  }

  #hasAuthorizedSpatialScope(
    verified: AuthorizationContextV1,
    spatialScopeEntityId: string,
  ): boolean {
    return verified.spatialScopeRefs.some(
      (scope) => scope.reference.entityId === spatialScopeEntityId,
    );
  }

  // -------------------------------------------------------------------------- open

  async open(command: OpenWarningCommandV1): Promise<OpenWarningResultV1> {
    const parsed = OpenWarningCommandV1Schema.safeParse(command);
    if (!parsed.success) {
      return { kind: "failed", error: this.#terminalError("unknown", "warning-response.open") };
    }
    const valid = parsed.data;
    try {
      const verified = await this.#verifyCommand(valid, "warning-response.open");
      const context = await this.#assessmentContext.read({
        requestId: valid.commandId,
        requestedAt: this.#nowIso(),
        authorization: valid.authorization,
        assessmentRecordRef: valid.payload.assessmentRecordRef,
      });
      this.#requireAuthorizedSpatialScope(verified, context.spatialScopeRef);
      if (
        !sameVersionReference(
          valid.payload.warningAggregationPolicyRef,
          context.warningAggregationPolicyRef,
        ) ||
        !sameVersionReference(valid.payload.notificationPolicyRef, context.notificationPolicyRef)
      ) {
        failWarningLifecycle("policy-mismatch", valid.payload.assessmentRecordRef);
      }
      const policies = await this.#runtimePolicies.read({
        requestId: valid.commandId,
        requestedAt: this.#nowIso(),
        authorization: valid.authorization,
        warningAggregationPolicyRef: valid.payload.warningAggregationPolicyRef,
        notificationPolicyRef: valid.payload.notificationPolicyRef,
      });
      const recordedAt = this.#nowIso();
      const plan = planWarningOpening({
        context,
        policies,
        actorId: verified.actorId,
        recordedAt,
        newWarningRecordId: () => randomUUID(),
      });
      await this.#executeWithRetry(
        this.#atomicCommand(valid, "warning-response.open", {
          assessmentRecordRef: valid.payload.assessmentRecordRef,
          warningAggregationPolicyRef: valid.payload.warningAggregationPolicyRef,
          notificationPolicyRef: valid.payload.notificationPolicyRef,
        }),
        async (transactionContext): Promise<AtomicCommitV1> => {
          const transaction = asWarningTransaction(transactionContext);
          const auditEntryId = `audit-${valid.commandId}:warning-open`;
          const audit = {
            auditEntryId,
            projectId: valid.projectId,
            action: "warning-response.open",
            targetRef: valid.payload.assessmentRecordRef,
            actorRef: verified.actorId,
            authorizationContextRef: valid.authorization.authorizationContextRef,
            occurredAt: valid.issuedAt,
            recordedAt,
            version: { entityId: auditEntryId, versionId: "1" },
            commandId: valid.commandId,
            idempotencyKey: valid.idempotencyKey,
          };
          if (plan.warnings.length === 0) {
            return { resultRef: valid.payload.assessmentRecordRef, audit, events: [] };
          }
          const canonicalWarnings = await this.#upsertWarnings(
            transaction,
            valid,
            context,
            plan,
            verified,
            auditEntryId,
            recordedAt,
          );
          const { taskRef, newWarnings } = await this.#appendTaskVersion(
            transaction,
            valid,
            context,
            plan,
            canonicalWarnings,
            verified,
            auditEntryId,
            recordedAt,
          );
          const newWarningKeys = new Set(
            newWarnings.map((warning) => warningRefPairKey(warning.warningRef)),
          );
          const intentRefsByWarning = new Map<string, NotificationIntentRefV1[]>();
          for (const canonical of canonicalWarnings) {
            const key = warningRefPairKey(canonical.warningRef);
            if (!newWarningKeys.has(key)) continue;
            const planned = plan.notificationIntents.filter(
              (intent) => warningRefPairKey(intent.warningRef) === key,
            );
            await this.#insertNotificationIntents(
              transaction,
              valid,
              planned,
              canonical.warningRef,
              taskRef,
              verified,
              auditEntryId,
              recordedAt,
            );
            intentRefsByWarning.set(
              key,
              planned.map((intent) => intent.notificationIntentRef),
            );
          }
          const events = newWarnings.map((warning) =>
            DomainEventV1Schema.parse({
              schemaVersion: "1",
              eventId: `warning-recorded-${warning.warningRef.reference.entityId}-${warning.warningRef.reference.versionId}`,
              eventVersion: 1,
              eventType: "warning.warning-recorded.v1",
              projectId: valid.projectId,
              aggregateRef: taskRef,
              occurredAt: valid.issuedAt,
              recordedAt,
              causationId: valid.commandId,
              correlationId: `warning-recorded-${valid.commandId}`,
              producerCommandId: valid.commandId,
              idempotencyKey: valid.idempotencyKey,
              authorizationContextRef: valid.authorization.authorizationContextRef,
              auditTrailRef: {
                kind: "audit-trail",
                reference: { entityId: auditEntryId, versionId: "1" },
              },
              payload: {
                assessmentRecordRef: valid.payload.assessmentRecordRef,
                warningRecordRef: warning.warningRef,
                warningResponseTaskRef: taskRef,
                notificationIntentRefs:
                  intentRefsByWarning.get(warningRefPairKey(warning.warningRef)) ?? [],
              },
            }),
          );
          return { resultRef: taskRef, audit, events };
        },
      );
      return { kind: "succeeded", result: await this.#canonicalOpenResult(valid) };
    } catch (error: unknown) {
      return { kind: "failed", error: this.#toModuleError(error, valid.commandId) };
    }
  }

  async #upsertWarnings(
    transaction: Transaction<WarningDatabase>,
    command: OpenWarningCommandV1,
    context: WarningAssessmentContextV1,
    plan: WarningOpeningPlanV1,
    verified: AuthorizationContextV1,
    auditEntryId: string,
    recordedAt: string,
  ): Promise<readonly CanonicalWarningV1[]> {
    const canonical: CanonicalWarningV1[] = [];
    for (const planned of plan.warnings) {
      const inserted = await transaction
        .insertInto("business.warning_records")
        .values({
          project_id: command.projectId,
          warning_record_id: planned.warningRef.reference.entityId,
          version_id: planned.warningRef.reference.versionId,
          schema_version: "1",
          assessment_record_id: context.assessmentRecordRef.reference.entityId,
          assessment_record_version_id: context.assessmentRecordRef.reference.versionId,
          assessment_input_snapshot_id: context.assessmentInputSnapshotRef.reference.entityId,
          assessment_input_snapshot_version_id:
            context.assessmentInputSnapshotRef.reference.versionId,
          preparation_snapshot_id: context.preparationSnapshotRef.reference.entityId,
          preparation_snapshot_version_id: context.preparationSnapshotRef.reference.versionId,
          risk_input_kind: context.riskInputRef.kind,
          risk_input_entity_id: context.riskInputRef.reference.entityId,
          risk_input_version_id: context.riskInputRef.reference.versionId,
          spatial_scope_entity_id: context.spatialScopeRef.reference.entityId,
          spatial_scope_version_id: context.spatialScopeRef.reference.versionId,
          trigger_type: planned.triggerType,
          risk_level_id: planned.record.warningLevel,
          warning_aggregation_policy_entity_id: context.warningAggregationPolicyRef.entityId,
          warning_aggregation_policy_version_id: context.warningAggregationPolicyRef.versionId,
          notification_policy_entity_id: context.notificationPolicyRef.entityId,
          notification_policy_version_id: context.notificationPolicyRef.versionId,
          content_digest: sha256CanonicalJson(planned.record),
          warning_payload: jsonValue(planned.record),
          command_id: command.commandId,
          idempotency_key: command.idempotencyKey,
          actor_ref: verified.actorId,
          authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
          audit_entry_id: auditEntryId,
          occurred_at: command.issuedAt,
          recorded_at: recordedAt,
        } as never)
        .onConflict((conflict) => conflict.doNothing())
        .execute();
      if ((inserted[0]?.numInsertedOrUpdatedRows ?? 0n) > 0n) {
        canonical.push({
          warningRef: planned.warningRef,
          triggerType: planned.triggerType,
          created: true,
        });
        continue;
      }
      const existing = await transaction
        .selectFrom("business.warning_records")
        .select(["warning_record_id", "version_id", "trigger_type"])
        .where("project_id", "=", command.projectId)
        .where("assessment_record_id", "=", context.assessmentRecordRef.reference.entityId)
        .where("assessment_record_version_id", "=", context.assessmentRecordRef.reference.versionId)
        .where("trigger_type", "=", planned.triggerType)
        .executeTakeFirst();
      if (existing === undefined) {
        failWarningLifecycle("assessment-contract-drift", planned.warningRef);
      }
      canonical.push({
        warningRef: {
          kind: "warning-record",
          reference: { entityId: existing.warning_record_id, versionId: existing.version_id },
        },
        triggerType: WarningTriggerTypeSchema.parse(existing.trigger_type),
        created: false,
      });
    }
    return canonical;
  }

  async #appendTaskVersion(
    transaction: Transaction<WarningDatabase>,
    command: OpenWarningCommandV1,
    context: WarningAssessmentContextV1,
    plan: WarningOpeningPlanV1,
    warnings: readonly CanonicalWarningV1[],
    verified: AuthorizationContextV1,
    auditEntryId: string,
    recordedAt: string,
  ): Promise<{
    readonly taskRef: WarningResponseTaskRefV1;
    readonly newWarnings: readonly CanonicalWarningV1[];
  }> {
    const aggregationKey = plan.aggregationKey;
    const insertedTask = await transaction
      .insertInto("business.warning_response_tasks")
      .values({
        project_id: aggregationKey.projectId,
        task_id: randomUUID(),
        schema_version: "1",
        risk_input_kind: aggregationKey.riskInputKind,
        risk_input_entity_id: aggregationKey.riskInputEntityId,
        spatial_scope_entity_id: aggregationKey.spatialScopeEntityId,
        aggregation_key: jsonValue(aggregationKey),
        status: "open",
        current_version_id: "1",
        created_at: recordedAt,
        updated_at: recordedAt,
      } as never)
      .onConflict((conflict) => conflict.doNothing())
      .execute();
    const createdTask = (insertedTask[0]?.numInsertedOrUpdatedRows ?? 0n) > 0n;
    const taskRow = await transaction
      .selectFrom("business.warning_response_tasks")
      .selectAll()
      .where("project_id", "=", aggregationKey.projectId)
      .where("risk_input_kind", "=", aggregationKey.riskInputKind)
      .where("risk_input_entity_id", "=", aggregationKey.riskInputEntityId)
      .where("spatial_scope_entity_id", "=", aggregationKey.spatialScopeEntityId)
      .where("status", "=", "open")
      .forUpdate()
      .executeTakeFirst();
    if (taskRow === undefined) {
      failWarningLifecycle("warning-task-mismatch", command.payload.assessmentRecordRef);
    }
    const links = await transaction
      .selectFrom("business.warning_response_task_warnings")
      .select(["warning_record_id", "warning_record_version_id", "first_included_version_id"])
      .where("task_id", "=", taskRow.task_id)
      .execute();
    const firstIncludedVersions = new Map(
      links.map((link) => [
        `${link.warning_record_id}\u0000${link.warning_record_version_id}`,
        link.first_included_version_id,
      ]),
    );
    const newWarnings = warnings.filter(
      (warning) => !firstIncludedVersions.has(warningRefPairKey(warning.warningRef)),
    );
    if (newWarnings.length === 0) {
      const versionId = warnings
        .map((warning) => firstIncludedVersions.get(warningRefPairKey(warning.warningRef)))
        .filter((version): version is string => version !== undefined)
        .sort((left, right) => (left < right ? -1 : 1))[0];
      if (versionId === undefined) {
        failWarningLifecycle("warning-task-mismatch", command.payload.assessmentRecordRef);
      }
      return {
        taskRef: {
          kind: "warning-response-task",
          reference: { entityId: taskRow.task_id, versionId },
        },
        newWarnings: [],
      };
    }
    const versionId = createdTask ? "1" : String(Number(taskRow.current_version_id) + 1);
    await transaction
      .insertInto("business.warning_response_task_versions")
      .values({
        project_id: aggregationKey.projectId,
        task_id: taskRow.task_id,
        version_id: versionId,
        schema_version: "1",
        status: "open",
        aggregation_key: jsonValue(aggregationKey),
        spatial_scope_ref: jsonValue(context.spatialScopeRef),
        command_id: command.commandId,
        idempotency_key: command.idempotencyKey,
        actor_ref: verified.actorId,
        authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
        audit_entry_id: auditEntryId,
        occurred_at: command.issuedAt,
        recorded_at: recordedAt,
      } as never)
      .execute();
    await transaction
      .insertInto("business.warning_response_task_warnings")
      .values(
        newWarnings.map((warning) => ({
          project_id: aggregationKey.projectId,
          task_id: taskRow.task_id,
          first_included_version_id: versionId,
          warning_record_id: warning.warningRef.reference.entityId,
          warning_record_version_id: warning.warningRef.reference.versionId,
          recorded_at: recordedAt,
        })) as never,
      )
      .execute();
    await transaction
      .updateTable("business.warning_response_tasks")
      .set({ current_version_id: versionId, updated_at: recordedAt })
      .where("task_id", "=", taskRow.task_id)
      .execute();
    return {
      taskRef: {
        kind: "warning-response-task",
        reference: { entityId: taskRow.task_id, versionId },
      },
      newWarnings,
    };
  }

  async #insertNotificationIntents(
    transaction: Transaction<WarningDatabase>,
    command: OpenWarningCommandV1,
    plannedIntents: WarningOpeningPlanV1["notificationIntents"],
    warningRef: WarningRecordRefV1,
    taskRef: WarningResponseTaskRefV1,
    verified: AuthorizationContextV1,
    auditEntryId: string,
    recordedAt: string,
  ): Promise<void> {
    for (const planned of plannedIntents) {
      const intentRef = planned.notificationIntentRef;
      const payload = NotificationIntentV1Schema.parse({
        schemaVersion: "1",
        projectId: command.projectId,
        notificationIntentRef: intentRef,
        warningRecordRef: warningRef,
        warningResponseTaskRef: taskRef,
        notificationPolicyRef: planned.notificationPolicyRef,
        recipientActorId: planned.recipientActorId,
        channel: planned.channel,
        recordedAt,
      });
      await transaction
        .insertInto("business.notification_intents")
        .values({
          project_id: command.projectId,
          intent_id: intentRef.reference.entityId,
          version_id: intentRef.reference.versionId,
          schema_version: "1",
          warning_record_id: warningRef.reference.entityId,
          warning_record_version_id: warningRef.reference.versionId,
          task_id: taskRef.reference.entityId,
          task_version_id: taskRef.reference.versionId,
          notification_policy_entity_id: planned.notificationPolicyRef.entityId,
          notification_policy_version_id: planned.notificationPolicyRef.versionId,
          recipient_actor_id: planned.recipientActorId,
          channel: planned.channel,
          intent_payload: jsonValue(payload),
          command_id: command.commandId,
          idempotency_key: command.idempotencyKey,
          actor_ref: verified.actorId,
          authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
          audit_entry_id: auditEntryId,
          occurred_at: command.issuedAt,
          recorded_at: recordedAt,
        } as never)
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    }
  }

  async #canonicalOpenResult(command: OpenWarningCommandV1): Promise<OpenWarningSuccessV1> {
    const assessmentRef = command.payload.assessmentRecordRef;
    const warnings = await this.#db
      .selectFrom("business.warning_records")
      .select(["warning_record_id", "version_id", "trigger_type"])
      .where("project_id", "=", command.projectId)
      .where("assessment_record_id", "=", assessmentRef.reference.entityId)
      .where("assessment_record_version_id", "=", assessmentRef.reference.versionId)
      .execute();
    if (warnings.length === 0) {
      return { warningRecordRefs: [], warningResponseTaskRefs: [], notificationIntentRefs: [] };
    }
    const orderedWarnings = [...warnings].sort(
      (left, right) =>
        WARNING_TRIGGER_TYPE_VALUES.indexOf(left.trigger_type as WarningTriggerType) -
        WARNING_TRIGGER_TYPE_VALUES.indexOf(right.trigger_type as WarningTriggerType),
    );
    const warningRefs: WarningRecordRefV1[] = orderedWarnings.map((warning) => ({
      kind: "warning-record",
      reference: { entityId: warning.warning_record_id, versionId: warning.version_id },
    }));
    const warningIds = warningRefs.map((ref) => ref.reference.entityId);
    const links = await this.#db
      .selectFrom("business.warning_response_task_warnings")
      .select(["task_id", "first_included_version_id"])
      .distinct()
      .where("project_id", "=", command.projectId)
      .where("warning_record_id", "in", warningIds)
      .execute();
    const taskRefs: WarningResponseTaskRefV1[] = links
      .map((link) => ({
        kind: "warning-response-task" as const,
        reference: { entityId: link.task_id, versionId: link.first_included_version_id },
      }))
      .sort((left, right) => compareVersionReferences(left.reference, right.reference));
    const intents = await this.#db
      .selectFrom("business.notification_intents")
      .select(["intent_id", "version_id", "recipient_actor_id", "warning_record_id"])
      .where("project_id", "=", command.projectId)
      .where("warning_record_id", "in", warningIds)
      .where("notification_policy_entity_id", "=", command.payload.notificationPolicyRef.entityId)
      .where("notification_policy_version_id", "=", command.payload.notificationPolicyRef.versionId)
      .execute();
    const warningOrder = new Map(
      warningRefs.map((ref, index) => [ref.reference.entityId, index] as const),
    );
    const intentRefs = [...intents]
      .sort((left, right) => {
        const leftOrder = warningOrder.get(left.warning_record_id) ?? 0;
        const rightOrder = warningOrder.get(right.warning_record_id) ?? 0;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return left.recipient_actor_id < right.recipient_actor_id ? -1 : 1;
      })
      .map((intent) => ({
        kind: "notification-intent" as const,
        reference: { entityId: intent.intent_id, versionId: intent.version_id },
      }));
    return {
      warningRecordRefs: warningRefs,
      warningResponseTaskRefs: taskRefs,
      notificationIntentRefs: intentRefs,
    };
  }

  // ------------------------------------------------------------------- acknowledge

  async acknowledge(
    command: WarningAcknowledgementCommandV1,
  ): Promise<WarningResponseRecordResultV1> {
    const parsed = WarningResponseRecordCommandV1Schema.safeParse(command);
    if (!parsed.success || parsed.data.kind !== "acknowledge") {
      return {
        kind: "failed",
        error: this.#terminalError(command.commandId ?? "unknown", "warning-response.acknowledge"),
      };
    }
    const valid = parsed.data;
    const warningRef = valid.payload.warningRecordRef;
    const taskRef = valid.payload.warningResponseTaskRef;
    let verified: AuthorizationContextV1 | undefined;
    try {
      const currentAuthorization = await this.#verifyCommand(valid, "warning-response.acknowledge");
      verified = currentAuthorization;
      const recordedAt = this.#nowIso();
      await this.#executeWithRetry(
        this.#atomicCommand(valid, "warning-response.acknowledge", {
          warningRecordRef: warningRef,
          warningResponseTaskRef: taskRef,
        }),
        async (transactionContext): Promise<AtomicCommitV1> => {
          const transaction = asWarningTransaction(transactionContext);
          const auditEntryId = `audit-${valid.commandId}:warning-acknowledgement`;
          const targetFailure = await this.#inspectAcknowledgementTargets({
            executor: transaction,
            projectId: valid.projectId,
            warningRef,
            taskRef,
            lock: true,
            authorization: currentAuthorization,
          });
          if (targetFailure !== undefined) {
            failWarningLifecycle(
              targetFailure.reasonCode,
              targetFailure.targetRef,
              targetFailure.code,
            );
          }
          const inserted = await transaction
            .insertInto("business.warning_acknowledgements")
            .values({
              project_id: valid.projectId,
              warning_record_id: warningRef.reference.entityId,
              warning_record_version_id: warningRef.reference.versionId,
              task_id: taskRef.reference.entityId,
              task_version_id: taskRef.reference.versionId,
              acknowledged_by_actor_id: currentAuthorization.actorId,
              command_id: valid.commandId,
              idempotency_key: valid.idempotencyKey,
              authorization_context_ref: jsonValue(valid.authorization.authorizationContextRef),
              audit_entry_id: auditEntryId,
              acknowledged_at: valid.issuedAt,
              recorded_at: recordedAt,
            } as never)
            .onConflict((conflict) => conflict.doNothing())
            .execute();
          if ((inserted[0]?.numInsertedOrUpdatedRows ?? 0n) === 0n) {
            failWarningLifecycle("already-acknowledged", warningRef);
          }
          return {
            resultRef: warningRef,
            audit: {
              auditEntryId,
              projectId: valid.projectId,
              action: "warning-response.acknowledge",
              targetRef: warningRef,
              actorRef: currentAuthorization.actorId,
              authorizationContextRef: valid.authorization.authorizationContextRef,
              occurredAt: valid.issuedAt,
              recordedAt,
              version: { entityId: auditEntryId, versionId: "1" },
              commandId: valid.commandId,
              idempotencyKey: valid.idempotencyKey,
            },
            events: [
              DomainEventV1Schema.parse({
                schemaVersion: "1",
                eventId: `warning-acknowledged-${warningRef.reference.entityId}-${warningRef.reference.versionId}-${taskRef.reference.entityId}-${taskRef.reference.versionId}`,
                eventVersion: 1,
                eventType: "warning.warning-acknowledged.v1",
                projectId: valid.projectId,
                aggregateRef: taskRef,
                occurredAt: valid.issuedAt,
                recordedAt,
                causationId: valid.commandId,
                correlationId: `warning-acknowledged-${valid.commandId}`,
                producerCommandId: valid.commandId,
                idempotencyKey: valid.idempotencyKey,
                authorizationContextRef: valid.authorization.authorizationContextRef,
                auditTrailRef: {
                  kind: "audit-trail",
                  reference: { entityId: auditEntryId, versionId: "1" },
                },
                payload: { warningRecordRef: warningRef, warningResponseTaskRef: taskRef },
              }),
            ],
          };
        },
      );
      const saved = await this.#db
        .selectFrom("business.warning_acknowledgements")
        .select(["acknowledged_by_actor_id"])
        .where("project_id", "=", valid.projectId)
        .where("warning_record_id", "=", warningRef.reference.entityId)
        .where("warning_record_version_id", "=", warningRef.reference.versionId)
        .where("task_id", "=", taskRef.reference.entityId)
        .where("task_version_id", "=", taskRef.reference.versionId)
        .executeTakeFirst();
      if (saved === undefined) {
        return {
          kind: "failed",
          error: this.#terminalError(valid.commandId, "warning-response.acknowledge"),
        };
      }
      return {
        kind: "succeeded",
        result: {
          kind: "acknowledgement",
          status: "acknowledged",
          warningRecordRef: warningRef,
          warningResponseTaskRef: taskRef,
        },
      };
    } catch (error: unknown) {
      const directError = this.#toModuleError(error, valid.commandId);
      if (
        verified === undefined ||
        directError.code === "AUTHORIZATION_DENIED" ||
        directError.code === "IDEMPOTENCY_CONFLICT"
      ) {
        return { kind: "failed", error: directError };
      }
      // C03 事务边界只保留持久化错误码，业务拒绝按提交后可见事实重新定型。
      const classified = await this.#inspectAcknowledgementTargets({
        executor: this.#db,
        projectId: valid.projectId,
        warningRef,
        taskRef,
        lock: false,
        authorization: verified,
      });
      if (classified !== undefined) {
        return { kind: "failed", error: toWarningModuleError(classified, valid.commandId) };
      }
      return { kind: "failed", error: directError };
    }
  }

  /**
   * 确认目标的联合校验：同一事实集合既驱动事务内加锁判定，
   * 也在事务失败后按当前可见事实把业务拒绝重新定型（并发失败者与被拒绝调用语义一致）。
   */
  async #inspectAcknowledgementTargets(input: {
    readonly executor: Kysely<WarningDatabase> | Transaction<WarningDatabase>;
    readonly projectId: string;
    readonly warningRef: WarningRecordRefV1;
    readonly taskRef: WarningResponseTaskRefV1;
    readonly lock: boolean;
    readonly authorization: AuthorizationContextV1;
  }): Promise<WarningLifecycleFailureV1 | undefined> {
    const { executor, projectId, warningRef, taskRef } = input;
    const warningRow = await executor
      .selectFrom("business.warning_records")
      .select(["warning_record_id", "spatial_scope_entity_id"])
      .where("project_id", "=", projectId)
      .where("warning_record_id", "=", warningRef.reference.entityId)
      .where("version_id", "=", warningRef.reference.versionId)
      .executeTakeFirst();
    if (warningRow === undefined) {
      return {
        code: "AUTHORIZATION_DENIED",
        reasonCode: "warning-lifecycle-authorization-required",
        targetRef: warningRef,
      };
    }
    if (!this.#hasAuthorizedSpatialScope(input.authorization, warningRow.spatial_scope_entity_id)) {
      return {
        code: "AUTHORIZATION_DENIED",
        reasonCode: "warning-lifecycle-authorization-required",
        targetRef: warningRef,
      };
    }
    const acknowledgement = await executor
      .selectFrom("business.warning_acknowledgements")
      .select(["acknowledged_by_actor_id"])
      .where("project_id", "=", projectId)
      .where("warning_record_id", "=", warningRef.reference.entityId)
      .where("warning_record_version_id", "=", warningRef.reference.versionId)
      .where("task_id", "=", taskRef.reference.entityId)
      .where("task_version_id", "=", taskRef.reference.versionId)
      .executeTakeFirst();
    if (acknowledgement !== undefined) {
      return {
        code: "BUSINESS_BLOCKED",
        reasonCode: "already-acknowledged",
        targetRef: warningRef,
      };
    }
    const taskQuery = executor
      .selectFrom("business.warning_response_tasks")
      .select(["status", "current_version_id", "spatial_scope_entity_id"])
      .where("project_id", "=", projectId)
      .where("task_id", "=", taskRef.reference.entityId);
    const taskRow = await (input.lock ? taskQuery.forUpdate() : taskQuery).executeTakeFirst();
    if (taskRow === undefined) {
      return {
        code: "AUTHORIZATION_DENIED",
        reasonCode: "warning-lifecycle-authorization-required",
        targetRef: taskRef,
      };
    }
    if (taskRow.spatial_scope_entity_id !== warningRow.spatial_scope_entity_id) {
      return {
        code: "AUTHORIZATION_DENIED",
        reasonCode: "warning-lifecycle-authorization-required",
        targetRef: taskRef,
      };
    }
    if (taskRow.current_version_id !== taskRef.reference.versionId) {
      return { code: "STALE_VERSION", reasonCode: "task-version-stale", targetRef: taskRef };
    }
    if (taskRow.status !== "open") {
      return { code: "BUSINESS_BLOCKED", reasonCode: "warning-task-mismatch", targetRef: taskRef };
    }
    const link = await executor
      .selectFrom("business.warning_response_task_warnings")
      .select(["warning_record_id"])
      .where("project_id", "=", projectId)
      .where("task_id", "=", taskRef.reference.entityId)
      .where("warning_record_id", "=", warningRef.reference.entityId)
      .where("warning_record_version_id", "=", warningRef.reference.versionId)
      .executeTakeFirst();
    if (link === undefined) {
      return {
        code: "BUSINESS_BLOCKED",
        reasonCode: "warning-task-mismatch",
        targetRef: warningRef,
      };
    }
    return undefined;
  }

  // --------------------------------------------------------------------- delivery

  async deliverInAppNotifications(
    context: TransactionContextV1,
    input: {
      readonly projectId: string;
      readonly warningRecordRef: WarningRecordRefV1;
      readonly warningResponseTaskRef: WarningResponseTaskRefV1;
      readonly notificationIntentRefs: readonly NotificationIntentRefV1[];
    },
  ): Promise<{ readonly notifications: readonly InAppNotificationV1[] }> {
    const transaction = asWarningTransaction(context);
    const intentRefs = [...input.notificationIntentRefs].sort((left, right) =>
      compareVersionReferences(left.reference, right.reference),
    );
    if (intentRefs.length === 0) return { notifications: [] };
    const intents = [];
    for (const intentRef of intentRefs) {
      const intent = await transaction
        .selectFrom("business.notification_intents")
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("intent_id", "=", intentRef.reference.entityId)
        .where("version_id", "=", intentRef.reference.versionId)
        .executeTakeFirst();
      if (
        intent === undefined ||
        intent.channel !== "in-app" ||
        intent.warning_record_id !== input.warningRecordRef.reference.entityId ||
        intent.warning_record_version_id !== input.warningRecordRef.reference.versionId ||
        intent.task_id !== input.warningResponseTaskRef.reference.entityId ||
        intent.task_version_id !== input.warningResponseTaskRef.reference.versionId
      ) {
        failWarningLifecycle("notification-intent-mismatch", input.warningRecordRef);
      }
      intents.push(intent);
    }
    const deliveredAt = this.#nowIso();
    await transaction
      .insertInto("business.in_app_notifications")
      .values(
        intents.map((intent) => ({
          project_id: intent.project_id,
          notification_intent_id: intent.intent_id,
          notification_intent_version_id: intent.version_id,
          warning_record_id: intent.warning_record_id,
          warning_record_version_id: intent.warning_record_version_id,
          task_id: intent.task_id,
          task_version_id: intent.task_version_id,
          recipient_actor_id: intent.recipient_actor_id,
          channel: "in-app",
          delivered_at: deliveredAt,
        })) as never,
      )
      .onConflict((conflict) => conflict.doNothing())
      .execute();
    const rows = await transaction
      .selectFrom("business.in_app_notifications")
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where(
        "notification_intent_id",
        "in",
        intents.map((intent) => intent.intent_id),
      )
      .execute();
    return {
      notifications: rows.map((row) =>
        InAppNotificationV1Schema.parse({
          schemaVersion: "1",
          projectId: row.project_id,
          notificationIntentRef: {
            kind: "notification-intent",
            reference: {
              entityId: row.notification_intent_id,
              versionId: row.notification_intent_version_id,
            },
          },
          warningRecordRef: {
            kind: "warning-record",
            reference: {
              entityId: row.warning_record_id,
              versionId: row.warning_record_version_id,
            },
          },
          warningResponseTaskRef: {
            kind: "warning-response-task",
            reference: { entityId: row.task_id, versionId: row.task_version_id },
          },
          recipientActorId: row.recipient_actor_id,
          channel: "in-app",
          deliveredAt: asIso(row.delivered_at),
        }),
      ),
    };
  }

  // ------------------------------------------------------------------------- util

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
        // 并发写入同一预警/任务时的序列化失败在有限预算内重试，随后由唯一性收口。
        if (
          attempt < MAX_SERIALIZATION_ATTEMPTS_V1 &&
          mapPostgresError(error, "warning-response.transaction").retryable
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  #terminalError(causalRunId: string, stageCode: string): ModuleErrorV1 {
    return ModuleErrorV1Schema.parse({
      code: "TERMINAL_FAILURE",
      category: "technical",
      retryable: false,
      stageCode,
      occurredAt: this.#nowIso(),
      causalRunId,
      diagnosticRef: {
        kind: "diagnostic-artifact",
        reference: { entityId: "warning-lifecycle-failure", versionId: "1" },
      },
    });
  }

  #toModuleError(error: unknown, causalRunId: string): ModuleErrorV1 {
    const failure = warningLifecycleFailureFrom(error);
    if (failure !== undefined) return toWarningModuleError(failure, causalRunId);
    if (error instanceof AccessServiceError) {
      return toWarningModuleError(
        {
          code: "AUTHORIZATION_DENIED",
          reasonCode: "warning-lifecycle-authorization-required",
          targetRef: {
            kind: "authorization-context",
            reference: { entityId: "warning-response.unauthorized", versionId: "1" },
          },
        },
        causalRunId,
      );
    }
    const mapped = mapPostgresError(error, "warning-response.adapter");
    if (mapped.code === "IDEMPOTENCY_CONFLICT") {
      return toWarningModuleError(
        {
          code: "IDEMPOTENCY_CONFLICT",
          reasonCode: "warning-lifecycle-idempotency-conflict",
          targetRef: {
            kind: "warning-record",
            reference: { entityId: "warning-response.idempotency", versionId: "1" },
          },
        },
        causalRunId,
      );
    }
    return toWarningModuleError(
      {
        code: mapped.retryable ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE",
        reasonCode: "assessment-contract-drift",
        targetRef: {
          kind: "warning-record",
          reference: { entityId: "warning-response.failure", versionId: "1" },
        },
      },
      causalRunId,
    );
  }
}

export const createPostgresWarningLifecycleAdapter = (
  options: PostgresWarningLifecycleAdapterOptionsV1,
): PostgresWarningLifecycleAdapter => new PostgresWarningLifecycleAdapter(options);
