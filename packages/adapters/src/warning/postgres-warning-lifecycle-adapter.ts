import { randomUUID } from "node:crypto";

import { sql, type Kysely, type Selectable, type Transaction } from "kysely";

import { AccessServiceError, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import {
  InAppNotificationV1Schema,
  NotificationIntentV1Schema,
  WarningAssessmentContextV1Schema,
  failWarningLifecycle,
  planWarningOpening,
  WARNING_LIFECYCLE_SCHEMA_VERSION_V1,
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
  WARNING_RESPONSE_READ_OPERATIONS_V1,
  forecastAvailabilityV1Schema,
  WarningResponseReadQueryV1Schema,
  WarningResponseReadResultV1Schema,
  WarningRecordRefV1Schema,
  ResponseRecommendationRefV1Schema,
  RouteDecisionRefV1Schema,
  ExecutionRecordRefV1Schema,
  EffectForecastRefV1Schema,
  FeedbackRefV1Schema,
  CalibrationSuggestionRefV1Schema,
  MonitoringSnapshotRefV1Schema,
  ContentArtifactRefV1Schema,
  RiskAssessmentRecordRefV1Schema,
  DeviationViewV1Schema,
  WarningResponseRecordCommandV1Schema,
  type AuthorizationContextV1,
  type CalibrationSuggestionRefV1,
  type ContractReferenceV1,
  type ModuleBranchV1,
  type ModuleErrorV1,
  type NotificationIntentRefV1,
  type OpenWarningCommandV1,
  type OpenWarningResultV1,
  type OpenWarningSuccessV1,
  type ReadActionV1,
  type RecommendationValidationResultV1,
  type RiskInputVersionRefV1,
  type ResponseRecommendationRefV1,
  type RiskAssessmentRecordRefV1,
  type RouteDecisionRefV1,
  type SpatialScopeRefV1,
  type WarningAcknowledgementViewV1,
  type WarningCatalogItemV1,
  type WarningNotificationDisclosureV1,
  type WarningRecordRefV1,
  type WarningResponseRecordResultV1,
  type WarningTaskCatalogItemV1,
  type WarningResponseTaskRefV1,
  type WarningResponseReadOperationV1,
  type WarningResponseReadPortV1,
  type WarningResponseReadQueryV1,
  type WarningResponseReadResultV1,
  type WorkflowRunRefV1,
} from "@riskflow/contracts/ports";
import {
  RiskAssessmentRecordSchema,
  WarningRecordSchema,
  type ResponseRecommendation,
} from "@riskflow/contracts/records";
import { type VersionReference } from "@riskflow/contracts/common";
import type { AssessmentDownstreamAuthorizerV1 } from "@riskflow/core/risk-assessment/engine";
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

// ------------------------------------------------------------------ C34 只读基元

const C26_READ_PAGE_SIZE_DEFAULT_V1 = 50;
const C26_READ_PAGE_SIZE_MAX_V1 = 50;

type C26WarningCatalogRow = {
  readonly warning_record_id: string;
  readonly version_id: string;
  readonly assessment_record_id: string;
  readonly assessment_record_version_id: string;
  readonly trigger_type: string;
  readonly risk_level_id: string;
  readonly occurred_at: Date;
};

type C26TaskCatalogRow = {
  readonly task_id: string;
  readonly current_version_id: string;
  readonly status: "open" | "closed";
  readonly spatial_scope_ref: JsonColumn;
  readonly occurred_at: Date;
};

type C26WarningReadRow = Selectable<WarningRecordRow>;

type C26TaskLinkRow = {
  readonly warning_record_id: string;
  readonly task_id: string;
  readonly first_included_version_id: string;
};

type C26TaskLinkDetailRow = {
  readonly task_id: string;
  readonly risk_input_kind: string;
  readonly risk_input_entity_id: string;
  readonly risk_input_version_id: string;
};

type C26NotificationDisclosureRow = {
  readonly intent_id: string;
  readonly version_id: string;
  readonly recipient_actor_id: string;
  readonly channel: string;
  readonly occurred_at: Date;
  readonly delivered_at: Date | null;
};

/** 读面失败携带已定型的模块错误，由 `read()` 统一收口为失败结果。 */
class WarningResponseReadFailure extends Error {
  readonly #error: ModuleErrorV1;

  constructor(error: ModuleErrorV1) {
    super(error.code);
    this.#error = error;
  }

  get error(): ModuleErrorV1 {
    return this.#error;
  }
}

type C26ReadCommandV1<O extends WarningResponseReadOperationV1> = WarningResponseReadQueryV1 & {
  readonly payload: Extract<WarningResponseReadQueryV1["payload"], { readonly operation: O }>;
};

const c26ReadCommand = <O extends WarningResponseReadOperationV1>(
  command: WarningResponseReadQueryV1,
): C26ReadCommandV1<O> => command as C26ReadCommandV1<O>;

/** 只有带空间范围筛选的操作才接受请求范围；精确对象读按已验证范围判定归属。 */
/* ------------------------------------------------ C34 关系页（task-read）分派与游标 */

const C26_RELATION_PAGE_SIZE_V1 = 50;
/** 解析结果有界：实体标识的登记版本数由公共上限约束。 */
const C26_RESOLVE_MAX_REFS_V1 = 50;

/** 七组关系各自独立分页；游标必须声明它属于哪一组。 */
type C26RelationKindV1 =
  | "warning"
  | "recommendation"
  | "decision"
  | "forecast"
  | "execution"
  | "feedback"
  | "calibration"
  /** 私有偏差事实只用于向 C29 换建议引用，不出现在公共关系里。 */
  | "deviation";

type C26RelationPageV1 = {
  readonly refs: readonly RelationPageRefV1[];
  readonly hasMore: boolean;
  readonly lastRef: RelationPageRefV1 | undefined;
  readonly lastRecordedAt: string | undefined;
};

type C26RelationRowV1 = {
  readonly entity_id: string;
  readonly version_id: string;
  readonly recorded_at: Date;
};

type C26RelationAnchorV1 = {
  readonly projectId: string;
  readonly taskRef: VersionReference;
  readonly scopeDigest: string;
};

type C26RelationCursorV1 = C26RelationAnchorV1 & {
  readonly schemaVersion: "1";
  readonly relation: C26RelationKindV1;
  readonly after: {
    readonly recordedAt: string;
    readonly entityId: string;
    readonly versionId: string;
  };
};

const C26_RELATION_CURSOR_KEYS_V1 = [
  "schemaVersion",
  "projectId",
  "taskRef",
  "scopeDigest",
  "relation",
  "after",
] as const;

const C26_RELATION_KINDS_V1: readonly C26RelationKindV1[] = [
  "warning",
  "recommendation",
  "decision",
  "forecast",
  "execution",
  "feedback",
  "calibration",
  "deviation",
];

const c26RelationAnchor = (
  command: WarningResponseReadQueryV1,
  verified: AuthorizationContextV1,
  taskRef: VersionReference,
): C26RelationAnchorV1 => ({
  projectId: command.projectId,
  taskRef,
  // 授权摘要只取空间身份：关系游标因此绑定作用域，却绝不携带权限材料。
  scopeDigest: sha256CanonicalJson(
    verified.spatialScopeRefs.map(
      (scope) => `${scope.reference.entityId}/${scope.reference.versionId}`,
    ),
  ),
});

const decodeC26RelationCursor = (
  cursor: string | undefined,
  anchor: C26RelationAnchorV1,
): C26RelationCursorV1 | undefined | null => {
  if (cursor === undefined) return undefined;
  const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null) return null;
  const keys = Object.keys(parsed);
  if (
    keys.length !== C26_RELATION_CURSOR_KEYS_V1.length ||
    !C26_RELATION_CURSOR_KEYS_V1.every((key) => keys.includes(key))
  ) {
    return null;
  }
  const candidate = parsed as C26RelationCursorV1;
  if (candidate.schemaVersion !== "1") return null;
  if (candidate.projectId !== anchor.projectId || candidate.scopeDigest !== anchor.scopeDigest) {
    return null;
  }
  if (!sameVersionReference(candidate.taskRef, anchor.taskRef)) return null;
  if (C26_RELATION_KINDS_V1.includes(candidate.relation) === false) return null;
  return candidate;
};

const encodeC26RelationCursor = (cursor: C26RelationCursorV1): string =>
  Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");

/** 解析结果按调用方声明的类别投影成公共引用；不跨类别混入。 */
const c26ResolveRef = (
  ref: { readonly kind: string; readonly reference: VersionReference },
  targetKind:
    "warning" | "task" | "recommendation" | "forecast" | "execution" | "feedback" | "calibration",
): ContractReferenceV1 => {
  const expected = RESOLVE_REF_KINDS_V1[targetKind];
  if (ref.kind !== expected) {
    throw new TypeError(`resolve kind mismatch: ${ref.kind} is not ${expected}`);
  }
  return { kind: ref.kind, reference: ref.reference } as ContractReferenceV1;
};

/** 每种类别只列自己的命令分支：借邻近分支代签等于给出不该有的按钮。 */
const RESOLVE_BRANCHES_V1: Readonly<Record<string, readonly ModuleBranchV1[]>> = {
  warning: ["warning-response.acknowledge"],
  task: ["warning-response.acknowledge"],
  recommendation: ["warning-response.adopt-recommendation"],
  forecast: [],
  execution: ["warning-response.record-feedback"],
  feedback: [],
  calibration: ["warning-response.calibration-review-outcome"],
};

const RESOLVE_REF_KINDS_V1 = {
  warning: "warning-record",
  task: "warning-response-task",
  recommendation: "response-recommendation",
  forecast: "effect-forecast",
  execution: "execution-record",
  feedback: "feedback",
  calibration: "calibration-suggestion",
} as const;

/** 公共结果按关系组给出各自的续页游标；没有下一页就不给该游标。 */
const c26RelationCursorField = (
  anchor: C26RelationAnchorV1,
  relation: C26RelationKindV1,
  page: C26RelationPageV1,
): Record<string, string> => {
  void anchor;
  if (page.hasMore === false || page.lastRef === undefined || page.lastRecordedAt === undefined) {
    return {};
  }
  return {
    [`${relation}NextCursor`]: encodeC26RelationCursor({
      schemaVersion: "1",
      projectId: anchor.projectId,
      taskRef: anchor.taskRef,
      scopeDigest: anchor.scopeDigest,
      relation,
      after: {
        recordedAt: page.lastRecordedAt,
        entityId: page.lastRef.reference.entityId,
        versionId: page.lastRef.reference.versionId,
      },
    }),
  };
};

const c26RequestedScopeRef = (
  payload: WarningResponseReadQueryV1["payload"],
): SpatialScopeRefV1 | undefined =>
  "spatialScopeRef" in payload && payload.spatialScopeRef !== undefined
    ? payload.spatialScopeRef
    : undefined;

/**
 * 目录 keyset 游标（design D-10）：绑定工程、操作、筛选与当前空间授权，并携带排序键。
 * 游标是 base64url 编码的 strict 对象而不是权限凭证——每次读取都重新复验当前授权，
 * 作用域改变或格式篡改一律拒绝，绝不用游标决定目标所属或扩大范围。
 */
type C26CursorAnchorV1 = {
  readonly projectId: string;
  readonly operation: WarningResponseReadOperationV1;
  readonly filterDigest: string;
  readonly scopeDigest: string;
};

type C26CursorV1 = C26CursorAnchorV1 & {
  readonly schemaVersion: "1";
  readonly afterOccurredAt: string;
  readonly afterEntityId: string;
  readonly afterVersionId: string;
};

const C26_CURSOR_KEYS_V1 = [
  "schemaVersion",
  "projectId",
  "operation",
  "filterDigest",
  "scopeDigest",
  "afterOccurredAt",
  "afterEntityId",
  "afterVersionId",
] as const;

const C26_OPERATIONS_V1 = new Set<string>(WARNING_RESPONSE_READ_OPERATIONS_V1);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const c26CursorAnchor = (
  command: WarningResponseReadQueryV1,
  verified: AuthorizationContextV1,
): C26CursorAnchorV1 => ({
  projectId: command.projectId,
  operation: command.payload.operation,
  // 筛选摘要排除全部续页参数：换页大小或换续页游标都不改变续页位置，换筛选一定改变。
  filterDigest: sha256CanonicalJson(
    Object.fromEntries(
      Object.entries(command.payload)
        .filter(([key]) => key !== "pageSize" && !key.endsWith("Cursor"))
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  ),
  // 授权摘要只取空间身份：游标因此既绑定作用域又绝不携带权限材料。
  scopeDigest: sha256CanonicalJson(
    verified.spatialScopeRefs
      .map((scope) => `${scope.reference.entityId}/${scope.reference.versionId}`)
      .sort(),
  ),
});

const afterCursorAnchor = (
  anchor: C26CursorAnchorV1,
  row: {
    readonly occurred_at: Date | string;
    readonly entityId: string;
    readonly versionId: string;
  },
): C26CursorV1 => ({
  ...anchor,
  schemaVersion: "1",
  afterOccurredAt: asIso(row.occurred_at),
  afterEntityId: row.entityId,
  afterVersionId: row.versionId,
});

const encodeC26Cursor = (cursor: C26CursorV1): string =>
  Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");

/**
 * 解码游标：缺省为首页；格式被篡改、键不全或与当前工程/操作/筛选/授权不匹配时返回 `null`，
 * 由调用方整体拒绝，绝不退化成「从首页重来」。
 */
const decodeC26Cursor = (
  cursor: string | undefined,
  anchor: C26CursorAnchorV1,
): C26CursorV1 | null | undefined => {
  if (cursor === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (
      C26_CURSOR_KEYS_V1.some((key) => !(key in record)) ||
      Object.keys(record).some((key) => !C26_CURSOR_KEYS_V1.includes(key as never))
    ) {
      return null;
    }
    if (
      record.schemaVersion !== "1" ||
      record.projectId !== anchor.projectId ||
      !C26_OPERATIONS_V1.has(record.operation as string) ||
      record.operation !== anchor.operation ||
      record.filterDigest !== anchor.filterDigest ||
      record.scopeDigest !== anchor.scopeDigest ||
      !isNonEmptyString(record.afterOccurredAt) ||
      !isNonEmptyString(record.afterEntityId) ||
      !isNonEmptyString(record.afterVersionId)
    ) {
      return null;
    }
    return record as unknown as C26CursorV1;
  } catch {
    return null;
  }
};

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
    const authorizedSpatialScopeIds = input.authorization.spatialScopeRefs.map(
      (scope) => scope.reference.entityId,
    );
    if (authorizedSpatialScopeIds.length === 0) {
      failWarningLifecycle("warning-lifecycle-authorization-required", {
        kind: "authorization-context",
        reference: { entityId: "warning-response.unauthorized", versionId: "1" },
      });
    }
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
      .where(
        sql<boolean>`preparation.spatial_scope_ref -> 'reference' ->> 'entityId' IN (${sql.join(
          authorizedSpatialScopeIds,
        )})`,
      )
      .executeTakeFirst();
    if (row === undefined) {
      failWarningLifecycle("warning-lifecycle-authorization-required", {
        kind: "authorization-context",
        reference: { entityId: "warning-response.unauthorized", versionId: "1" },
      });
    }

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

/**
 * C27 正式建议的所属窄读（design D-06）：C26 不访问建议私表，只沿公共契约的 `recommendation-read`
 * 提取出自己需要的形状。注入缺失即整体失败闭合，不用空建议冒充没有。
 */
/** C26 组合 `recommendation-read` 时从 C27 取得的精确事实；不含归属 C41 的终局决定。 */
export type C26RecommendationViewV1 = {
  readonly responseRecommendationRef: ResponseRecommendationRefV1;
  readonly recommendation: ResponseRecommendation;
  readonly taskRef: WarningResponseTaskRefV1;
  readonly validationResults: readonly RecommendationValidationResultV1[];
  readonly generationPolicyRef: VersionReference;
  readonly validationPolicyRef: VersionReference;
  readonly measureReleaseRefs: readonly ContractReferenceV1[];
  readonly spatialScopeEntityId: string;
};

export type C26RecommendationViewResultV1 =
  | { readonly kind: "succeeded"; readonly view: C26RecommendationViewV1 }
  | { readonly kind: "failed"; readonly error: { readonly code: string } };

export type C26RouteDecisionV1 = {
  readonly decisionRef: RouteDecisionRefV1;
  readonly state: "adopted" | "declined";
  readonly actorId: string;
  readonly decidedAt: string;
  readonly reasonCode: string;
  readonly forecastRunRef?: WorkflowRunRefV1;
};

export type C26RouteDecisionResultV1 =
  | { readonly kind: "succeeded"; readonly decision: C26RouteDecisionV1 }
  | { readonly kind: "absent" }
  | { readonly kind: "failed"; readonly error: { readonly code: string } };

export interface WarningResponseRecommendationReaderV1 {
  readRecommendationView(
    input: RecommendationReadViewInputV1,
  ): Promise<C26RecommendationViewResultV1>;
  /** 任务下的正式建议引用：关系页只取引用，不取正文。 */
  readRecommendationRefsForTask(
    input: Omit<RelationPageInputV1, "anchorRefs"> & {
      readonly warningResponseTaskRef: WarningResponseTaskRefV1;
    },
  ): Promise<RelationPageResultV1>;
  /** 把实体标识解析为精确建议引用；不属于本模块时返回空集合。 */
  resolveRecommendationRefs(input: ResolveRefsInputV1): Promise<ResolveRefsResultV1>;
}

/** C26 组合窄读时交给所属方的全部输入：授权、调用身份与精确对象引用。 */
export type RecommendationReadViewInputV1 = {
  readonly projectId: string;
  readonly actorId: string;
  readonly requestedAt: string;
  readonly invocationId: string;
  readonly authorization: AuthorizationContextV1;
  readonly responseRecommendationRef: ResponseRecommendationRefV1;
};

/** C28 预测/执行/反馈的所属窄读：一个拥有方一个接缝，读失败整体收口。 */
export interface WarningResponseLifecycleReaderV1 {
  readForecastView(input: LifecycleReadInputV1<"effect-forecast">): Promise<C28ReadResultV1>;
  readExecutionView(input: LifecycleReadInputV1<"execution-record">): Promise<C28ReadResultV1>;
  readFeedbackView(input: LifecycleReadInputV1<"feedback">): Promise<C28ReadResultV1>;
  /** 建议下的五类关系引用：关系页只取引用，不取正文。 */
  readDecisionRefsForRecommendations(input: RelationPageInputV1): Promise<RelationPageResultV1>;
  readForecastRefsForRecommendations(input: RelationPageInputV1): Promise<RelationPageResultV1>;
  readExecutionRefsForRecommendations(input: RelationPageInputV1): Promise<RelationPageResultV1>;
  readFeedbackRefsForRecommendations(input: RelationPageInputV1): Promise<RelationPageResultV1>;
  readDeviationFactRefsForRecommendations(
    input: RelationPageInputV1,
  ): Promise<RelationPageResultV1>;
  /** 把实体标识解析为精确预测、执行与反馈引用；不属于本模块时返回空集合。 */
  resolveLifecycleRefs(input: ResolveRefsInputV1): Promise<ResolveRefsResultV1>;
}

/** C29 组合 `calibration-read` 时从 C29 取得的精确事实；草案未登记时不给草案引用。 */
export type C29CalibrationViewV1 = {
  readonly calibrationSuggestionRef: CalibrationSuggestionRefV1;
  readonly targetKind: string;
  readonly targetReleaseRef: ContractReferenceV1;
  readonly inputSnapshotRef: ContractReferenceV1;
  readonly validationPolicyRef: VersionReference;
  readonly operations: readonly unknown[];
  readonly status: string;
  readonly reviewTaskRef: unknown;
  readonly deviationRecordRef: ContractReferenceV1;
  readonly deviationRecordVersionId: string;
  readonly reviewDecisionRef?: ContractReferenceV1;
  readonly candidateArtifactRef?: ContractReferenceV1;
  readonly knowledgeRevisionRef?: ContractReferenceV1;
  readonly spatialScopeEntityId: string;
};

export type C29CalibrationViewResultV1 =
  | { readonly kind: "succeeded"; readonly view: C29CalibrationViewV1 }
  | { readonly kind: "failed"; readonly error: { readonly code: string } };

/**
 * 公共偏差记录的所属窄读结果：正文与精确引用同源，缺席表示 C29 未就这条偏差事实
 * 登记过公共记录（读失败与未登记是两种不同事实，不合并）。
 */
export type C29DeviationRecordResultV1 =
  | {
      readonly kind: "succeeded";
      readonly record: unknown;
      readonly deviationRecordRef: ContractReferenceV1;
    }
  | { readonly kind: "absent" }
  | { readonly kind: "failed"; readonly error: { readonly code: string } };

/**
 * 关系页有界输入（design D-05、D-10）：所属方只按精确锚点集合与 keyset 位置取一页，
 * 不知道自己被谁组合，也不决定公共游标形状。
 */
export type RelationPageInputV1 = {
  readonly projectId: string;
  readonly actorId: string;
  readonly requestedAt: string;
  readonly invocationId: string;
  readonly authorization: AuthorizationContextV1;
  readonly anchorRefs: readonly RelationAnchorV1[];
  /** keyset 续页位置：登记时点倒序、标识升序；缺省表示首页。 */
  readonly after?: {
    readonly recordedAt: string;
    readonly entityId: string;
    readonly versionId: string;
  };
  readonly pageSize: number;
};

/**
 * 关系页引用：只带 kind 与精确版本。公共引用联合的成员形状并不统一
 * （事件引用用 eventId），关系页不复用它，公共投影时再按各自 Schema 解析。
 */
/**
 * `resolve` 的所属方输入（design D-05）：调用方只给实体标识与可选版本，
 * 拥有方按自己的表判定它是不是自己登记的精确引用。
 */
export type ResolveRefsInputV1 = {
  readonly projectId: string;
  readonly actorId: string;
  readonly requestedAt: string;
  readonly invocationId: string;
  readonly authorization: AuthorizationContextV1;
  readonly entityId: string;
  readonly versionId: string | undefined;
};

export type ResolveRefsResultV1 =
  | { readonly kind: "succeeded"; readonly refs: readonly RelationPageRefV1[] }
  | { readonly kind: "failed"; readonly error: { readonly code: string } };

export type RelationPageRefV1 = { readonly kind: string; readonly reference: VersionReference };

/** 关系锚点：只要求调用方给出精确版本身份，kind 由所属方自己判定。 */
export type RelationAnchorV1 = { readonly reference: VersionReference };

export type RelationPageResultV1 =
  | {
      readonly kind: "succeeded";
      readonly refs: readonly RelationPageRefV1[];
      readonly hasMore: boolean;
      /** 末页定位：下一页请求据此构造 keyset 位置。 */
      readonly lastRef: RelationPageRefV1 | undefined;
      readonly lastRecordedAt: string | undefined;
    }
  | { readonly kind: "failed"; readonly error: { readonly code: string } };

/** C29 校准建议的所属窄读：一个拥有方一个接缝，读失败整体收口。 */
export interface WarningResponseCalibrationReaderV1 {
  readCalibrationView(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly invocationId: string;
    readonly authorization: AuthorizationContextV1;
    readonly calibrationSuggestionRef: CalibrationSuggestionRefV1;
  }): Promise<C29CalibrationViewResultV1>;
  /** 私有偏差事实下的校准建议引用：关系页只取引用，不取正文。 */
  readCalibrationRefsForDeviationFacts(input: RelationPageInputV1): Promise<RelationPageResultV1>;
  /**
   * 私有偏差事实下的公共偏差记录：只有 C29 自己登记过才给出，未登记即缺席，
   * 不用私有计算偏差冒充公共记录正文。
   */
  readDeviationRecordForDeviationFact(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly invocationId: string;
    readonly authorization: AuthorizationContextV1;
    readonly deviationFactRef: VersionReference;
  }): Promise<C29DeviationRecordResultV1>;
  /** 把实体标识解析为精确校准建议引用；不属于本模块时返回空集合。 */
  resolveCalibrationRefs(input: ResolveRefsInputV1): Promise<ResolveRefsResultV1>;
}

/** 组合根交给 C28 的全部输入：授权、调用身份与精确对象引用。 */
export type LifecycleReadInputV1<K extends "effect-forecast" | "execution-record" | "feedback"> = {
  readonly projectId: string;
  readonly actorId: string;
  readonly requestedAt: string;
  readonly invocationId: string;
  readonly authorization: AuthorizationContextV1;
  readonly targetRef: { readonly kind: K; readonly reference: VersionReference };
};

export type C28ForecastViewV1 = {
  readonly effectForecastRef: ContractReferenceV1;
  readonly recommendationRef: ContractReferenceV1;
  readonly routeDecisionRef: ContractReferenceV1;
  readonly runRef: WorkflowRunRefV1;
  readonly inputSnapshotRef: ContractReferenceV1;
  readonly frozenAssessmentBasisRef: ContractReferenceV1;
  readonly preActionMonitoringSnapshotRef: ContractReferenceV1;
  readonly baselineAssessmentRecordRef: ContractReferenceV1;
  readonly forecastPolicyRef: ContractReferenceV1;
  readonly method: string;
  readonly targetIndicatorId: string;
  readonly unit: string;
  readonly horizonSteps: number;
  readonly availability: unknown;
  readonly spatialScopeEntityId: string;
};

export type C28ExecutionViewV1 = {
  readonly executionRecordRef: ContractReferenceV1;
  readonly source: unknown;
  readonly executedByActorId: string;
  readonly recordedByActorId: string;
  readonly occurredAt: string;
  readonly spatialScopeRef: SpatialScopeRefV1;
  readonly evidenceReferences: readonly unknown[];
  readonly feedbackRefs: readonly ContractReferenceV1[];
  readonly spatialScopeEntityId: string;
};

export type C28FeedbackViewV1 = {
  readonly feedbackRef: ContractReferenceV1;
  readonly executionRef: ContractReferenceV1;
  readonly postActionMonitoringSnapshotRef: ContractReferenceV1;
  readonly feedbackArtifactRef: ContractReferenceV1;
  readonly actualAssessmentRecordRef: ContractReferenceV1;
  readonly occurredAt: string;
  readonly forecastAvailability: unknown;
  readonly deviation: unknown;
  /**
   * 私有偏差事实的精确版本锚点：C26 只能拿它向 C29 换公共偏差记录与校准引用，
   * 不因此获得该事实的公共引用身份——公共偏差记录由 C29 登记后才存在。
   */
  readonly deviationFactRef?: VersionReference;
  readonly spatialScopeEntityId: string;
};

export type C28ReadResultV1 =
  | { readonly kind: "succeeded"; readonly view: unknown }
  | { readonly kind: "failed"; readonly error: { readonly code: string } };

/** C41 采纳/拒绝终局的所属窄读：未注入即整体失败闭合，不用空决定冒充尚未决定。 */
export interface WarningResponseRouteDecisionReaderV1 {
  readRouteDecision(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly invocationId: string;
    readonly authorization: AuthorizationContextV1;
    readonly routeDecisionForRecommendationRef: ResponseRecommendationRefV1;
  }): Promise<C26RouteDecisionResultV1>;
}

export interface PostgresWarningLifecycleAdapterOptionsV1 {
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: TransactionUnitV1;
  readonly access: LocalIdentityAccessV1;
  /** C25 权威评估记录的精确窄读；组合根注入本包的 `PostgresWarningAssessmentContextReader`。 */
  readonly assessmentContext: WarningAssessmentContextReaderV1;
  /** 部署组合根注入的正式运行时策略提供者：只按精确引用返回，不提供 latest/default。 */
  readonly runtimePolicies: WarningRuntimePolicyProviderV1;
  /** 组合根注入的下游签发接缝：动作可用性与组合窄读的授权都按用途逐次签发。 */
  readonly authorizeDownstream: AssessmentDownstreamAuthorizerV1;
  /** C27 正式建议的所属窄读。 */
  readonly recommendations: WarningResponseRecommendationReaderV1;
  /** C41 采纳/拒绝终局的所属窄读。 */
  readonly routeDecisions: WarningResponseRouteDecisionReaderV1;
  /** C28 预测/执行/反馈的所属窄读。 */
  readonly lifecycle: WarningResponseLifecycleReaderV1;
  /** C29 校准建议的所属窄读。 */
  readonly calibration: WarningResponseCalibrationReaderV1;
  readonly now?: () => Date;
}

/**
 * C26 正式用例 adapter：`open` 只消费 C25 已持久化触发事实，并在一个事务里写入
 * 预警、任务版本、通知意图、审计、回执与事件；`acknowledge` 只追加独立确认事实。
 * 同时实现事务绑定的应用内投递写入器，供 C03 幂等消费者在自有事务内调用。
 */
export class PostgresWarningLifecycleAdapter
  implements WarningLifecycleServiceV1, WarningInAppNotificationWriterV1, WarningResponseReadPortV1
{
  readonly #db: Kysely<WarningDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #access: LocalIdentityAccessV1;
  readonly #assessmentContext: WarningAssessmentContextReaderV1;
  readonly #runtimePolicies: WarningRuntimePolicyProviderV1;
  readonly #authorizeDownstream: AssessmentDownstreamAuthorizerV1;
  readonly #recommendations: WarningResponseRecommendationReaderV1;
  readonly #routeDecisions: WarningResponseRouteDecisionReaderV1;
  readonly #lifecycle: WarningResponseLifecycleReaderV1;
  readonly #calibration: WarningResponseCalibrationReaderV1;
  readonly #now: () => Date;

  constructor(options: PostgresWarningLifecycleAdapterOptionsV1) {
    this.#db = options.db as unknown as Kysely<WarningDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#access = options.access;
    this.#assessmentContext = options.assessmentContext;
    this.#runtimePolicies = options.runtimePolicies;
    this.#authorizeDownstream = options.authorizeDownstream;
    this.#recommendations = options.recommendations;
    this.#routeDecisions = options.routeDecisions;
    this.#lifecycle = options.lifecycle;
    this.#calibration = options.calibration;
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
        authorization: verified,
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
        authorization: verified,
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
          const createdWarnings = canonicalWarnings.filter((warning) => warning.created);
          if (createdWarnings.length === 0) {
            return { resultRef: valid.payload.assessmentRecordRef, audit, events: [] };
          }
          const { taskRef } = await this.#appendTaskVersion(
            transaction,
            valid,
            context,
            plan,
            canonicalWarnings,
            verified,
            auditEntryId,
            recordedAt,
          );
          const intentRefsByWarning = new Map<string, NotificationIntentRefV1[]>();
          for (const canonical of createdWarnings) {
            const key = warningRefPairKey(canonical.warningRef);
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
          const events = createdWarnings.map((warning) =>
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

  // ==================================================================  // ==================================================================
  // C34 预警处置只读（design D-05 / D-06 / D-10）
  // ==================================================================

  /**
   * 只读复验：沿 `warning-response.read` 分支复验当前授权上下文。`redacted` 表示授权已撤销或
   * 不可判定，此时失败闭合而不是当作「没有数据」——两者对调用方的含义完全不同。
   */
  async #verifyReadAuthorization(
    command: WarningResponseReadQueryV1,
  ): Promise<AuthorizationContextV1 | undefined> {
    const decision = await this.#access
      .verify({
        authorizationContextRef: command.authorization.authorizationContextRef,
        invocationId: command.queryId,
        projectId: command.projectId,
        branch: "warning-response.read",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        requestedAt: command.requestedAt,
      })
      .catch((error: unknown) => {
        if (error instanceof AccessServiceError) return undefined;
        throw error;
      });
    if (decision === undefined || decision.redacted) return undefined;
    const context = decision.context;
    if (
      context.projectId !== command.projectId ||
      context.actorId !== command.actorId ||
      !context.grantedCapabilities.includes("warning-response.read")
    ) {
      return undefined;
    }
    return context;
  }

  #readDenied(query: WarningResponseReadQueryV1): ModuleErrorV1 {
    return ModuleErrorV1Schema.parse({
      code: "AUTHORIZATION_DENIED",
      category: "authorization",
      retryable: false,
      stageCode: "warning-response.read",
      occurredAt: this.#nowIso(),
      causalRunId: query.queryId,
      requiredCapability: MODULE_BRANCH_CAPABILITY_V1["warning-response.read"],
      authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
    });
  }

  /**
   * 读面失败闭合：`blockerKind` 给出稳定详情码，`blockerRef` 按 `<查询身份>:<详情码>` 编码，
   * 让调用方既拿到类型化错误，也能在不解析正文的前提下定位到具体读操作。
   */
  #readBlocked(query: WarningResponseReadQueryV1, detailCode: string): ModuleErrorV1 {
    return ModuleErrorV1Schema.parse({
      code: "BUSINESS_BLOCKED",
      category: "business-blocked",
      retryable: false,
      stageCode: "warning-response.read",
      occurredAt: this.#nowIso(),
      causalRunId: query.queryId,
      blockerKind: detailCode,
      blockerRef: {
        kind: "project-revision",
        reference: { entityId: `${query.queryId}:${detailCode}`, versionId: "1" },
      },
    });
  }

  #readUnsupported(query: WarningResponseReadQueryV1): ModuleErrorV1 {
    return ModuleErrorV1Schema.parse({
      code: "UNSUPPORTED_CONTRACT",
      category: "technical",
      retryable: false,
      stageCode: "warning-response.read",
      occurredAt: this.#nowIso(),
      causalRunId: query.queryId,
      schemaVersion: WARNING_LIFECYCLE_SCHEMA_VERSION_V1,
    });
  }

  #readFailure(
    query: WarningResponseReadQueryV1,
    error: ModuleErrorV1,
  ): WarningResponseReadResultV1 {
    return WarningResponseReadResultV1Schema.parse({ kind: "failed", error });
  }

  /**
   * 动作可用性（design D-06）：逐分支尝试签发下游授权，仅据此产生安全呈现元数据。
   * 签发失败记 `denied`。读成功绝不推断写能力，也不在此处执行任何领域命令。
   */
  async #readActions(
    command: WarningResponseReadQueryV1,
    branches: readonly ModuleBranchV1[],
  ): Promise<ReadActionV1[]> {
    const actions: ReadActionV1[] = [];
    for (const branch of branches) {
      const issued = await this.#authorizeDownstream({
        branch,
        invocationId: `${command.queryId}:action:${branch}`,
        projectId: command.projectId,
        actorId: command.actorId,
        requestedAt: command.requestedAt,
      }).then(
        (context) => context.grantedCapabilities.includes(MODULE_BRANCH_CAPABILITY_V1[branch]),
        () => false,
      );
      actions.push(
        issued ? { branch, availability: "allowed" } : { branch, availability: "denied" },
      );
    }
    return actions;
  }

  /**
   * 十一条读操作共享同一入口：先按公共读契约解析命令并复验授权，再按 `operation` 分派。
   * 未登记事实、读不到的正文或未注入的所属接缝都失败闭合，不返回部分结果。
   */
  async read(query: WarningResponseReadQueryV1): Promise<WarningResponseReadResultV1> {
    const valid = WarningResponseReadQueryV1Schema.safeParse(query);
    if (!valid.success) {
      return this.#readFailure(query, this.#readUnsupported(query));
    }
    const command = valid.data;
    const verified = await this.#verifyReadAuthorization(command);
    if (verified === undefined) return this.#readFailure(command, this.#readDenied(command));
    try {
      return await this.#dispatchRead(command, verified);
    } catch (error) {
      // 公开读契约是全函数：任何已定型的模块错误都收口为失败结果，绝不把错误对象抛给调用方。
      if (error instanceof WarningResponseReadFailure) {
        return this.#readFailure(command, error.error);
      }
      const typed = ModuleErrorV1Schema.safeParse(error);
      if (typed.success) return this.#readFailure(command, typed.data);
      return this.#readFailure(command, this.#toModuleError(error, command.queryId));
    }
  }

  async #dispatchRead(
    command: WarningResponseReadQueryV1,
    verified: AuthorizationContextV1,
  ): Promise<WarningResponseReadResultV1> {
    switch (command.payload.operation) {
      case "warning-catalog":
        return this.#readWarningCatalog(c26ReadCommand<"warning-catalog">(command), verified);
      case "task-catalog":
        return this.#readTaskCatalog(c26ReadCommand<"task-catalog">(command), verified);
      case "overview":
        return this.#readOverview(c26ReadCommand<"overview">(command), verified);
      case "task-read":
        return this.#readTask(c26ReadCommand<"task-read">(command), verified);
      case "resolve":
        return this.#readResolve(c26ReadCommand<"resolve">(command), verified);
      case "warning-read":
        return this.#readWarning(c26ReadCommand<"warning-read">(command), verified);
      case "recommendation-read":
        return this.#readRecommendation(c26ReadCommand<"recommendation-read">(command), verified);
      case "forecast-read":
        return this.#readForecast(c26ReadCommand<"forecast-read">(command), verified);
      case "execution-read":
        return this.#readExecution(c26ReadCommand<"execution-read">(command), verified);
      case "feedback-read":
        return this.#readFeedback(c26ReadCommand<"feedback-read">(command), verified);
      case "calibration-read":
        return this.#readCalibration(c26ReadCommand<"calibration-read">(command), verified);
      default:
        // 其余操作的所属接缝由各自拥有方提供，尚未注入时整体失败闭合，绝不用空集合冒充没有。
        throw new WarningResponseReadFailure(
          this.#readBlocked(command, "owning-read-seam-not-injected"),
        );
    }
  }

  /**
   * 请求的空间范围必须是当前已验证授权范围内的同一空间身份，否则整体拒绝。
   * 目标不存在、跨空间与被撤权对无权用户同形。
   */
  #readableScopeIds(
    command: WarningResponseReadQueryV1,
    verified: AuthorizationContextV1,
  ): string[] {
    const requested = c26RequestedScopeRef(command.payload);
    if (requested === undefined) {
      return verified.spatialScopeRefs.map((scope) => scope.reference.entityId);
    }
    if (
      !verified.spatialScopeRefs.some((scope) =>
        sameVersionReference(scope.reference, requested.reference),
      )
    ) {
      throw new WarningResponseReadFailure(this.#readDenied(command));
    }
    return [requested.reference.entityId];
  }

  /**
   * `warning-catalog`（design D-05、D-10）：空间与触发类型是两类独立筛选；按业务时点倒序、
   * 标识升序走 keyset 游标，SQL 一次 `LIMIT pageSize+1`。确认状态由独立确认事实证明。
   */
  async #readWarningCatalog(
    command: C26ReadCommandV1<"warning-catalog">,
    verified: AuthorizationContextV1,
  ): Promise<WarningResponseReadResultV1> {
    const scopeIds = this.#readableScopeIds(command, verified);
    const pageSize = command.payload.pageSize ?? C26_READ_PAGE_SIZE_DEFAULT_V1;
    const cursor = c26CursorAnchor(command, verified);
    const after = decodeC26Cursor(command.payload.cursor, cursor);
    if (after === null) throw new WarningResponseReadFailure(this.#readDenied(command));
    let rows: readonly C26WarningCatalogRow[];
    try {
      rows = (
        await sql<C26WarningCatalogRow>`
        SELECT w.warning_record_id,
               w.version_id,
               w.assessment_record_id,
               w.assessment_record_version_id,
               w.trigger_type,
               w.risk_level_id,
               w.occurred_at
          FROM business.warning_records w
         WHERE w.project_id = ${command.projectId}
           AND w.spatial_scope_entity_id = ANY(${scopeIds})
           ${command.payload.triggerType === undefined ? sql`` : sql`AND w.trigger_type = ${command.payload.triggerType}`}
           ${
             after === undefined
               ? sql``
               : sql`AND (
                      w.occurred_at < ${after.afterOccurredAt}
                   OR (w.occurred_at = ${after.afterOccurredAt} AND w.warning_record_id > ${after.afterEntityId})
                   OR (w.occurred_at = ${after.afterOccurredAt} AND w.warning_record_id = ${after.afterEntityId} AND w.version_id > ${after.afterVersionId})
             )`
           }
         ORDER BY w.occurred_at DESC, w.warning_record_id ASC, w.version_id ASC
         LIMIT ${pageSize + 1}
      `.execute(this.#db)
      ).rows;
    } catch (error) {
      throw mapPostgresError(error, "warning-response.read.warning-catalog");
    }
    const page = rows.slice(0, pageSize);
    const links = await this.#taskLinksOf(
      command,
      page.map((row) => row.warning_record_id),
    );
    const acknowledged = await this.#acknowledgedWarningIds(
      command,
      page.map((row) => row.warning_record_id),
    );
    const items: WarningCatalogItemV1[] = page.map((row) => {
      const taskRef = links.get(row.warning_record_id);
      if (taskRef === undefined) {
        throw new WarningResponseReadFailure(
          this.#readBlocked(command, "warning-task-link-missing"),
        );
      }
      return {
        warningRecordRef: {
          kind: "warning-record",
          reference: { entityId: row.warning_record_id, versionId: row.version_id },
        },
        assessmentRecordRef: {
          kind: "risk-assessment-record",
          reference: {
            entityId: row.assessment_record_id,
            versionId: row.assessment_record_version_id,
          },
        },
        taskRef,
        triggerType: row.trigger_type as WarningTriggerType,
        warningLevel: row.risk_level_id,
        occurredAt: asIso(row.occurred_at),
        acknowledged: acknowledged.has(row.warning_record_id),
      };
    });
    return WarningResponseReadResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "warning-catalog",
        actorId: command.actorId,
        items,
        ...(rows.length > pageSize
          ? {
              nextCursor: encodeC26Cursor(
                afterCursorAnchor(cursor, {
                  occurred_at: page.at(-1)!.occurred_at,
                  entityId: page.at(-1)!.warning_record_id,
                  versionId: page.at(-1)!.version_id,
                }),
              ),
            }
          : {}),
        actions: await this.#readActions(command, ["warning-response.acknowledge"]),
      },
    });
  }

  /**
   * `task-catalog`（design D-05、D-10）：任务当前版本才有精确空间范围与业务时点；风险输入的
   * 精确版本只登记在关联预警上，按最新纳入的预警取当前版本，绝不从聚合键反推。
   */
  async #readTaskCatalog(
    command: C26ReadCommandV1<"task-catalog">,
    verified: AuthorizationContextV1,
  ): Promise<WarningResponseReadResultV1> {
    const scopeIds = this.#readableScopeIds(command, verified);
    const pageSize = command.payload.pageSize ?? C26_READ_PAGE_SIZE_DEFAULT_V1;
    const cursor = c26CursorAnchor(command, verified);
    const after = decodeC26Cursor(command.payload.cursor, cursor);
    if (after === null) throw new WarningResponseReadFailure(this.#readDenied(command));
    let rows: readonly C26TaskCatalogRow[];
    try {
      rows = (
        await sql<C26TaskCatalogRow>`
        SELECT t.task_id,
               t.current_version_id,
               t.status,
               v.spatial_scope_ref,
               v.occurred_at
          FROM business.warning_response_tasks t
          JOIN business.warning_response_task_versions v
            ON v.project_id = t.project_id AND v.task_id = t.task_id AND v.version_id = t.current_version_id
         WHERE t.project_id = ${command.projectId}
           AND t.spatial_scope_entity_id = ANY(${scopeIds})
           ${command.payload.status === undefined ? sql`` : sql`AND t.status = ${command.payload.status}`}
           ${
             after === undefined
               ? sql``
               : sql`AND (
                      v.occurred_at < ${after.afterOccurredAt}
                   OR (v.occurred_at = ${after.afterOccurredAt} AND t.task_id > ${after.afterEntityId})
                   OR (v.occurred_at = ${after.afterOccurredAt} AND t.task_id = ${after.afterEntityId} AND t.current_version_id > ${after.afterVersionId})
             )`
           }
         ORDER BY v.occurred_at DESC, t.task_id ASC, t.current_version_id ASC
         LIMIT ${pageSize + 1}
      `.execute(this.#db)
      ).rows;
    } catch (error) {
      throw mapPostgresError(error, "warning-response.read.task-catalog");
    }
    const page = rows.slice(0, pageSize);
    const detail = await this.#taskDetailOf(command, page);
    const items: WarningTaskCatalogItemV1[] = page.map((row) => {
      const exact = detail.get(row.task_id);
      if (exact === undefined) {
        throw new WarningResponseReadFailure(
          this.#readBlocked(command, "task-current-version-unreadable"),
        );
      }
      return {
        taskRef: {
          kind: "warning-response-task",
          reference: { entityId: row.task_id, versionId: row.current_version_id },
        },
        status: row.status,
        riskInput: exact.riskInput,
        spatialScopeRef: exact.spatialScopeRef,
        warningCount: exact.warningCount,
        occurredAt: asIso(row.occurred_at),
      };
    });
    return WarningResponseReadResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "task-catalog",
        actorId: command.actorId,
        items,
        ...(rows.length > pageSize
          ? {
              nextCursor: encodeC26Cursor(
                afterCursorAnchor(cursor, {
                  occurred_at: page.at(-1)!.occurred_at,
                  entityId: page.at(-1)!.task_id,
                  versionId: page.at(-1)!.current_version_id,
                }),
              ),
            }
          : {}),
        actions: await this.#readActions(command, ["warning-response.acknowledge"]),
      },
    });
  }

  /**
   * `overview`（design D-05、D-10）：只聚合已授权空间内拥有方的表，只返回开放任务关联的去重
   * 预警数与有界等级分布，不泄露未授权总量。
   */
  async #readOverview(
    command: C26ReadCommandV1<"overview">,
    verified: AuthorizationContextV1,
  ): Promise<WarningResponseReadResultV1> {
    const scopeIds = this.#readableScopeIds(command, verified);
    let summary: {
      readonly open_task_count: number;
      readonly warning_count: number;
      readonly level_counts: readonly { warningLevel: string; count: number }[];
    };
    try {
      summary = (
        await sql<{
          readonly open_task_count: number;
          readonly warning_count: number;
          readonly level_counts: readonly { warningLevel: string; count: number }[];
        }>`
        SELECT
          (SELECT count(*)::int FROM business.warning_response_tasks t
            WHERE t.project_id = ${command.projectId}
              AND t.status = 'open'
              AND t.spatial_scope_entity_id = ANY(${scopeIds})) AS open_task_count,
          (SELECT count(DISTINCT w.warning_record_id)::int
             FROM business.warning_response_task_warnings w
             JOIN business.warning_response_tasks t
               ON t.project_id = w.project_id AND t.task_id = w.task_id
            WHERE w.project_id = ${command.projectId}
              AND t.status = 'open'
              AND t.spatial_scope_entity_id = ANY(${scopeIds})) AS warning_count,
          COALESCE(
            (SELECT jsonb_agg(
                      jsonb_build_object('warningLevel', bounded.risk_level_id, 'count', bounded.count)
                      ORDER BY bounded.risk_level_id)
               FROM (SELECT r.risk_level_id, count(*)::int AS count
                       FROM business.warning_records r
                      WHERE r.project_id = ${command.projectId}
                        AND r.spatial_scope_entity_id = ANY(${scopeIds})
                      GROUP BY r.risk_level_id
                      LIMIT 32) bounded),
            '[]'::jsonb) AS level_counts
      `.execute(this.#db)
      ).rows[0]!;
    } catch (error) {
      throw mapPostgresError(error, "warning-response.read.overview");
    }
    const levelCounts = summary.level_counts.map((entry) => ({
      warningLevel: entry.warningLevel,
      count: Number(entry.count),
    }));
    return WarningResponseReadResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "overview",
        actorId: command.actorId,
        openTaskCount: Number(summary.open_task_count),
        warningCount: Number(summary.warning_count),
        levelCounts,
        asOf: this.#nowIso(),
        actions: await this.#readActions(command, ["warning-response.acknowledge"]),
      },
    });
  }

  /**
   * `warning-read`（design D-05）：预警正文、确认与通知披露全部取自有登记事实。
   * 触发阈值解释不在这里——页面独立调 C25 精确记录读，C26 不跨域反查。
   */
  /**
   * `task-read`（design D-05、D-10）：任务自身事实与预警关系取自 C26 自有表，
   * 建议、决定、预测、执行、反馈与校准六类关系分别经所属接缝取一页。
   *
   * 七组关系各自独立分页：公共契约只有一个 `relatedCursor`，游标内含它属于哪一组关系，
   * 因此一次请求只续其中一组，其余六组回到首页。任何一组读失败即整体失败闭合，
   * 不用「其余组为空」冒充完整关系。
   */
  async #readTask(
    command: C26ReadCommandV1<"task-read">,
    verified: AuthorizationContextV1,
  ): Promise<WarningResponseReadResultV1> {
    const scopeIds = this.#readableScopeIds(command, verified);
    const taskRef = command.payload.warningResponseTaskRef.reference;
    const task = await this.#loadTaskExact(command, scopeIds, taskRef);
    if (task === undefined) {
      throw new WarningResponseReadFailure(
        this.#readBlocked(command, "warning-response-task-not-found"),
      );
    }
    const anchor = c26RelationAnchor(command, verified, taskRef);
    const resume = decodeC26RelationCursor(command.payload.relatedCursor, anchor);
    if (resume === null) throw new WarningResponseReadFailure(this.#readDenied(command));
    const page = async (relation: C26RelationKindV1) => ({
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.requestedAt,
      invocationId: `${command.queryId}:${relation}`,
      authorization: await this.#authorizeForComposition(command, `${command.queryId}:${relation}`),
      ...(resume !== undefined && resume.relation === relation ? { after: resume.after } : {}),
      pageSize: C26_RELATION_PAGE_SIZE_V1,
    });
    const warnings = await this.#taskWarningRefs(command, taskRef, resume);
    const recommendations = await this.#relation(
      command,
      "recommendation",
      await this.#recommendations.readRecommendationRefsForTask({
        ...(await page("recommendation")),
        warningResponseTaskRef: command.payload.warningResponseTaskRef,
      }),
    );
    const anchors = recommendations.refs;
    const [decisions, forecasts, executions, feedbacks, deviationFacts] = await Promise.all([
      this.#relation(
        command,
        "decision",
        await this.#lifecycle.readDecisionRefsForRecommendations({
          ...(await page("decision")),
          anchorRefs: anchors,
        }),
      ),
      this.#relation(
        command,
        "forecast",
        await this.#lifecycle.readForecastRefsForRecommendations({
          ...(await page("forecast")),
          anchorRefs: anchors,
        }),
      ),
      this.#relation(
        command,
        "execution",
        await this.#lifecycle.readExecutionRefsForRecommendations({
          ...(await page("execution")),
          anchorRefs: anchors,
        }),
      ),
      this.#relation(
        command,
        "feedback",
        await this.#lifecycle.readFeedbackRefsForRecommendations({
          ...(await page("feedback")),
          anchorRefs: anchors,
        }),
      ),
      this.#relation(
        command,
        "deviation",
        await this.#lifecycle.readDeviationFactRefsForRecommendations({
          ...(await page("deviation")),
          anchorRefs: anchors,
        }),
      ),
    ]);
    const calibrations = await this.#relation(
      command,
      "calibration",
      await this.#calibration.readCalibrationRefsForDeviationFacts({
        ...(await page("calibration")),
        anchorRefs: deviationFacts.refs,
      }),
    );
    return WarningResponseReadResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "task-read",
        actorId: command.actorId,
        taskRef: command.payload.warningResponseTaskRef,
        status: task.status,
        riskInput: task.riskInput,
        spatialScopeRef: task.spatialScopeRef,
        occurredAt: task.occurred_at,
        relations: {
          warningRefs: warnings.refs.map((ref) =>
            WarningRecordRefV1Schema.parse({
              kind: "warning-record",
              reference: ref.reference,
            }),
          ),
          recommendationRefs: recommendations.refs.map((ref) =>
            ResponseRecommendationRefV1Schema.parse({
              kind: "response-recommendation",
              reference: ref.reference,
            }),
          ),
          decisionRefs: decisions.refs.map((ref) =>
            RouteDecisionRefV1Schema.parse({ kind: "route-decision", reference: ref.reference }),
          ),
          executionRefs: executions.refs.map((ref) =>
            ExecutionRecordRefV1Schema.parse({
              kind: "execution-record",
              reference: ref.reference,
            }),
          ),
          forecastRefs: forecasts.refs.map((ref) =>
            EffectForecastRefV1Schema.parse({ kind: "effect-forecast", reference: ref.reference }),
          ),
          feedbackRefs: feedbacks.refs.map((ref) =>
            FeedbackRefV1Schema.parse({ kind: "feedback", reference: ref.reference }),
          ),
          calibrationRefs: calibrations.refs.map((ref) =>
            CalibrationSuggestionRefV1Schema.parse({
              kind: "calibration-suggestion",
              reference: ref.reference,
            }),
          ),
          ...c26RelationCursorField(anchor, "warning", warnings),
          ...c26RelationCursorField(anchor, "recommendation", recommendations),
          ...c26RelationCursorField(anchor, "decision", decisions),
          ...c26RelationCursorField(anchor, "execution", executions),
          ...c26RelationCursorField(anchor, "forecast", forecasts),
          ...c26RelationCursorField(anchor, "feedback", feedbacks),
          ...c26RelationCursorField(anchor, "calibration", calibrations),
        },
        actions: await this.#readActions(command, ["warning-response.acknowledge"]),
      },
    });
  }

  /** 任务精确读：只认登记的当前版本，历史版本不与当前状态混用。 */
  async #loadTaskExact(
    command: WarningResponseReadQueryV1,
    scopeIds: readonly string[],
    taskRef: VersionReference,
  ): Promise<
    | {
        readonly status: "open" | "closed";
        readonly riskInput: RiskInputVersionRefV1;
        readonly spatialScopeRef: SpatialScopeRefV1;
        readonly occurred_at: string;
      }
    | undefined
  > {
    let rows: readonly C26TaskCatalogRow[];
    try {
      rows = (
        await sql<C26TaskCatalogRow>`
        SELECT t.task_id,
               t.current_version_id,
               t.status,
               v.spatial_scope_ref,
               v.occurred_at
          FROM business.warning_response_tasks t
          JOIN business.warning_response_task_versions v
            ON v.project_id = t.project_id AND v.task_id = t.task_id AND v.version_id = t.current_version_id
         WHERE t.project_id = ${command.projectId}
           AND t.spatial_scope_entity_id = ANY(${scopeIds})
           AND t.task_id = ${taskRef.entityId}
         LIMIT 1
      `.execute(this.#db)
      ).rows;
    } catch (error) {
      throw mapPostgresError(error, "warning-response.read.task-read");
    }
    const row = rows[0];
    if (row === undefined || row.current_version_id !== taskRef.versionId) return undefined;
    const exact = (await this.#taskDetailOf(command, [row])).get(row.task_id);
    if (exact === undefined) {
      throw new WarningResponseReadFailure(
        this.#readBlocked(command, "task-current-version-unreadable"),
      );
    }
    return {
      status: row.status,
      riskInput: exact.riskInput,
      spatialScopeRef: exact.spatialScopeRef,
      occurred_at: row.occurred_at.toISOString(),
    };
  }

  /** 任务下的预警引用：来自 C26 自有关系表，按登记时点倒序、标识升序。 */
  async #taskWarningRefs(
    command: WarningResponseReadQueryV1,
    taskRef: VersionReference,
    resume: C26RelationCursorV1 | undefined,
  ): Promise<C26RelationPageV1> {
    const after = resume !== undefined && resume.relation === "warning" ? resume.after : undefined;
    let rows: readonly C26RelationRowV1[];
    try {
      rows = (
        await sql<C26RelationRowV1>`
        SELECT w.warning_record_id AS entity_id,
               w.warning_record_version_id AS version_id,
               w.recorded_at
          FROM business.warning_response_task_warnings w
         WHERE w.project_id = ${command.projectId}
           AND w.task_id = ${taskRef.entityId}
           ${
             after === undefined
               ? sql``
               : sql`AND (
                      w.recorded_at < ${after.recordedAt}
                   OR (w.recorded_at = ${after.recordedAt} AND w.warning_record_id > ${after.entityId})
                   OR (w.recorded_at = ${after.recordedAt} AND w.warning_record_id = ${after.entityId}
                       AND w.warning_record_version_id > ${after.versionId})
                 )`
           }
         ORDER BY w.recorded_at DESC, w.warning_record_id ASC, w.warning_record_version_id ASC
         LIMIT ${C26_RELATION_PAGE_SIZE_V1 + 1}
      `.execute(this.#db)
      ).rows;
    } catch (error) {
      throw mapPostgresError(error, "warning-response.read.task-warnings");
    }
    const page = rows.slice(0, C26_RELATION_PAGE_SIZE_V1);
    const last = page.at(-1);
    return {
      hasMore: rows.length > C26_RELATION_PAGE_SIZE_V1,
      lastRef:
        last === undefined
          ? undefined
          : {
              kind: "warning-record",
              reference: { entityId: last.entity_id, versionId: last.version_id },
            },
      lastRecordedAt: last?.recorded_at.toISOString(),
      refs: page.map((row) => ({
        kind: "warning-record",
        reference: { entityId: row.entity_id, versionId: row.version_id },
      })),
    };
  }

  /** 关系页失败即整体失败：所属接缝读不到就不返回半份关系。 */
  async #relation(
    command: WarningResponseReadQueryV1,
    relation: C26RelationKindV1,
    page: RelationPageResultV1,
  ): Promise<C26RelationPageV1> {
    if (page.kind === "failed") {
      throw new WarningResponseReadFailure(
        page.error.code === "AUTHORIZATION_DENIED"
          ? this.#readDenied(command)
          : page.error.code === "OWNING_READ_SEAM_NOT_INJECTED"
            ? this.#readBlocked(command, "owning-read-seam-not-injected")
            : // 原因码按发起该关系页的操作命名：同一关系组在不同操作下失败含义不同。
              this.#readBlocked(
                command,
                `${command.payload.operation}-${relation}-${page.error.code}`,
              ),
      );
    }
    return {
      refs: page.refs,
      hasMore: page.hasMore,
      lastRef: page.lastRef,
      lastRecordedAt: page.lastRecordedAt,
    };
  }

  /**
   * `resolve`（design D-05）：把页面上的实体标识解析为精确引用与版本。
   * 预警与任务取自 C26 自有表，建议、预测、执行、反馈与校准分别经所属接缝解析；
   * 只返回调用方声明的那一类，别的事件域一律不混入。
   */
  async #readResolve(
    command: C26ReadCommandV1<"resolve">,
    verified: AuthorizationContextV1,
  ): Promise<WarningResponseReadResultV1> {
    const scopeIds = this.#readableScopeIds(command, verified);
    const payload = command.payload;
    const resolveInput = async (invocation: string) => ({
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.requestedAt,
      invocationId: `${command.queryId}:${invocation}`,
      authorization: await this.#authorizeForComposition(
        command,
        `${command.queryId}:${invocation}`,
      ),
      entityId: payload.entityId,
      versionId: payload.versionId,
    });
    const own = async (): Promise<readonly RelationPageRefV1[]> => {
      if (payload.targetKind === "warning") {
        const rows = await sql<{ entity_id: string; version_id: string }>`
          SELECT w.warning_record_id AS entity_id, w.version_id
            FROM business.warning_records w
           WHERE w.project_id = ${command.projectId}
             AND w.spatial_scope_entity_id = ANY(${scopeIds})
             AND w.warning_record_id = ${payload.entityId}
             ${payload.versionId === undefined ? sql`` : sql`AND w.version_id = ${payload.versionId}`}
           ORDER BY w.version_id ASC
           LIMIT ${C26_RESOLVE_MAX_REFS_V1}
        `.execute(this.#db);
        return rows.rows.map((row) => ({
          kind: "warning-record",
          reference: { entityId: row.entity_id, versionId: row.version_id },
        }));
      }
      const rows = await sql<{ entity_id: string; version_id: string }>`
        SELECT t.task_id AS entity_id, t.current_version_id AS version_id
          FROM business.warning_response_tasks t
         WHERE t.project_id = ${command.projectId}
           AND t.spatial_scope_entity_id = ANY(${scopeIds})
           AND t.task_id = ${payload.entityId}
           ${payload.versionId === undefined ? sql`` : sql`AND t.current_version_id = ${payload.versionId}`}
         ORDER BY t.task_id ASC
         LIMIT ${C26_RESOLVE_MAX_REFS_V1}
      `.execute(this.#db);
      return rows.rows.map((row) => ({
        kind: "warning-response-task",
        reference: { entityId: row.entity_id, versionId: row.version_id },
      }));
    };
    const refs =
      payload.targetKind === "warning" || payload.targetKind === "task"
        ? await own()
        : payload.targetKind === "recommendation"
          ? await this.#requireResolved(
              command,
              await this.#recommendations.resolveRecommendationRefs(
                await resolveInput("recommendation"),
              ),
            )
          : payload.targetKind === "calibration"
            ? await this.#requireResolved(
                command,
                await this.#calibration.resolveCalibrationRefs(await resolveInput("calibration")),
              )
            : await this.#requireResolved(
                command,
                await this.#lifecycle.resolveLifecycleRefs(await resolveInput("lifecycle")),
              );
    return WarningResponseReadResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "resolve",
        actorId: command.actorId,
        targetKind: payload.targetKind,
        refs: refs.map((ref) => c26ResolveRef(ref, payload.targetKind)),
        // 解析结果按目标类别给出对应命令的当前授权，不借用邻近类别的分支。
        actions: await this.#readActions(command, RESOLVE_BRANCHES_V1[payload.targetKind] ?? []),
      },
    });
  }

  /** 任一所属方解析失败即整体失败：不返回部分解析结果。 */
  async #requireResolved(
    command: WarningResponseReadQueryV1,
    result: ResolveRefsResultV1,
  ): Promise<readonly RelationPageRefV1[]> {
    if (result.kind === "failed") {
      throw new WarningResponseReadFailure(
        result.error.code === "AUTHORIZATION_DENIED"
          ? this.#readDenied(command)
          : this.#readBlocked(command, `resolve-${result.error.code}`),
      );
    }
    return result.refs;
  }

  async #readWarning(
    command: C26ReadCommandV1<"warning-read">,
    verified: AuthorizationContextV1,
  ): Promise<WarningResponseReadResultV1> {
    const scopeIds = this.#readableScopeIds(command, verified);
    const ref = command.payload.warningRecordRef.reference;
    let row: C26WarningReadRow | undefined;
    try {
      row = await this.#db
        .selectFrom("business.warning_records")
        .selectAll()
        .where("project_id", "=", command.projectId)
        .where("warning_record_id", "=", ref.entityId)
        .where("version_id", "=", ref.versionId)
        .executeTakeFirst();
    } catch (error) {
      throw mapPostgresError(error, "warning-response.read.warning-read");
    }
    if (row === undefined || !scopeIds.includes(row.spatial_scope_entity_id)) {
      throw new WarningResponseReadFailure(this.#readBlocked(command, "warning-record-not-found"));
    }
    const record = WarningRecordSchema.safeParse(row.warning_payload);
    if (!record.success) {
      throw new WarningResponseReadFailure(
        this.#readBlocked(command, "warning-record-payload-invalid"),
      );
    }
    const taskRef = (await this.#taskLinksOf(command, [row.warning_record_id])).get(
      row.warning_record_id,
    );
    if (taskRef === undefined) {
      throw new WarningResponseReadFailure(this.#readBlocked(command, "warning-task-link-missing"));
    }
    const acknowledgement = await this.#acknowledgementOf(command, row);
    const notifications = await this.#notificationDisclosuresOf(command, row);
    return WarningResponseReadResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "warning-read",
        actorId: command.actorId,
        warningRecord: record.data,
        warningRecordRef: {
          kind: "warning-record",
          reference: { entityId: row.warning_record_id, versionId: row.version_id },
        },
        assessmentRecordRef: {
          kind: "risk-assessment-record",
          reference: {
            entityId: row.assessment_record_id,
            versionId: row.assessment_record_version_id,
          },
        },
        taskRef,
        ...(acknowledgement === undefined ? {} : { acknowledgement }),
        notifications,
        actions: await this.#readActions(command, ["warning-response.acknowledge"]),
      },
    });
  }

  /**
   * `recommendation-read`（design D-05、D-06）：正文与终局决定分属不同拥有方。
   * C26 只做边界复验与组合：C27 提供正式建议事实，采纳/拒绝终局由 C41 提供；
   * 任一所属接缝未注入都整体失败闭合，不用空决定冒充「尚未决定」。
   */
  async #readRecommendation(
    command: C26ReadCommandV1<"recommendation-read">,
    verified: AuthorizationContextV1,
  ): Promise<WarningResponseReadResultV1> {
    const scopeIds = this.#readableScopeIds(command, verified);
    const view = await this.#recommendations.readRecommendationView({
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.requestedAt,
      invocationId: `${command.queryId}:recommendation`,
      authorization: await this.#authorizeForComposition(
        command,
        `${command.queryId}:recommendation`,
      ),
      responseRecommendationRef: command.payload.responseRecommendationRef,
    });
    if (view.kind === "failed") {
      if (view.error.code === "AUTHORIZATION_DENIED") {
        throw new WarningResponseReadFailure(this.#readDenied(command));
      }
      throw new WarningResponseReadFailure(
        this.#readBlocked(command, `recommendation-read-${view.error.code}`),
      );
    }
    if (!scopeIds.includes(view.view.spatialScopeEntityId)) {
      throw new WarningResponseReadFailure(this.#readBlocked(command, "warning-record-not-found"));
    }
    const decision = await this.#routeDecisions.readRouteDecision({
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.requestedAt,
      invocationId: `${command.queryId}:route-decision`,
      authorization: await this.#authorizeForComposition(
        command,
        `${command.queryId}:route-decision`,
      ),
      routeDecisionForRecommendationRef: view.view.responseRecommendationRef,
    });
    if (decision.kind === "failed") {
      throw new WarningResponseReadFailure(this.#readDenied(command));
    }
    return WarningResponseReadResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "recommendation-read",
        actorId: command.actorId,
        recommendation: view.view.recommendation,
        responseRecommendationRef: view.view.responseRecommendationRef,
        taskRef: view.view.taskRef,
        validationResults: [...view.view.validationResults],
        generationPolicyRef: view.view.generationPolicyRef,
        validationPolicyRef: view.view.validationPolicyRef,
        measureReleaseRefs: [...view.view.measureReleaseRefs],
        ...(decision.kind === "succeeded" ? { decision: decision.decision } : {}),
        actions: await this.#readActions(command, ["warning-response.adopt-recommendation"]),
      },
    });
  }

  /**
   * `forecast-read`（design D-05、D-06）：预测正文、方法、步长与可用性全部取自 C28 自有事实。
   * unavailable 分支不给数值，也不由 C26 反推原因。
   */
  async #readForecast(
    command: C26ReadCommandV1<"forecast-read">,
    verified: AuthorizationContextV1,
  ): Promise<WarningResponseReadResultV1> {
    const scopeIds = this.#readableScopeIds(command, verified);
    const view = await this.#lifecycle.readForecastView({
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.requestedAt,
      invocationId: `${command.queryId}:forecast`,
      authorization: await this.#authorizeForComposition(command, `${command.queryId}:forecast`),
      targetRef: {
        kind: "effect-forecast",
        reference: command.payload.effectForecastRef.reference,
      },
    });
    if (view.kind === "failed") {
      throw new WarningResponseReadFailure(
        view.error.code === "AUTHORIZATION_DENIED"
          ? this.#readDenied(command)
          : this.#readBlocked(command, `forecast-read-${view.error.code}`),
      );
    }
    const exact = view.view as C28ForecastViewV1;
    if (!scopeIds.includes(exact.spatialScopeEntityId)) {
      throw new WarningResponseReadFailure(this.#readBlocked(command, "effect-forecast-not-found"));
    }
    const availability = forecastAvailabilityV1Schema.parse(exact.availability);
    return WarningResponseReadResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "forecast-read",
        actorId: command.actorId,
        effectForecastRef: exact.effectForecastRef,
        recommendationRef: exact.recommendationRef,
        routeDecisionRef: exact.routeDecisionRef,
        runRef: exact.runRef,
        inputSnapshotRef: exact.inputSnapshotRef,
        frozenAssessmentBasisRef: exact.frozenAssessmentBasisRef,
        preActionMonitoringSnapshotRef: exact.preActionMonitoringSnapshotRef,
        baselineAssessmentRecordRef: exact.baselineAssessmentRecordRef,
        forecastPolicyRef: exact.forecastPolicyRef,
        method: exact.method,
        targetIndicatorId: exact.targetIndicatorId,
        unit: exact.unit,
        horizonSteps: exact.horizonSteps,
        availability,
        actions: await this.#readActions(command, ["warning-response.record-execution"]),
      },
    });
  }

  /**
   * `execution-read`（design D-05、D-06）：执行来源、证据与已成立反馈取自 C28 自有事实。
   * 关联反馈按 C28 已登记的反馈行给出，不逐项跨域补查。
   */
  async #readExecution(
    command: C26ReadCommandV1<"execution-read">,
    verified: AuthorizationContextV1,
  ): Promise<WarningResponseReadResultV1> {
    const scopeIds = this.#readableScopeIds(command, verified);
    const view = await this.#lifecycle.readExecutionView({
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.requestedAt,
      invocationId: `${command.queryId}:execution`,
      authorization: await this.#authorizeForComposition(command, `${command.queryId}:execution`),
      targetRef: {
        kind: "execution-record",
        reference: command.payload.executionRecordRef.reference,
      },
    });
    if (view.kind === "failed") {
      throw new WarningResponseReadFailure(
        view.error.code === "AUTHORIZATION_DENIED"
          ? this.#readDenied(command)
          : this.#readBlocked(command, `execution-read-${view.error.code}`),
      );
    }
    const exact = view.view as C28ExecutionViewV1;
    if (!scopeIds.includes(exact.spatialScopeEntityId)) {
      throw new WarningResponseReadFailure(
        this.#readBlocked(command, "execution-record-not-found"),
      );
    }
    return WarningResponseReadResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "execution-read",
        actorId: command.actorId,
        executionRecordRef: exact.executionRecordRef,
        source: exact.source,
        executedByActorId: exact.executedByActorId,
        recordedByActorId: exact.recordedByActorId,
        occurredAt: exact.occurredAt,
        spatialScopeRef: exact.spatialScopeRef,
        evidenceReferences: exact.evidenceReferences,
        feedbackRefs: exact.feedbackRefs,
        actions: await this.#readActions(command, ["warning-response.record-feedback"]),
      },
    });
  }

  /**
   * `feedback-read`（design D-05、D-06）：反馈事实与私有计算偏差解释取自 C28；
   * 公共偏差记录与校准引用取自 C29，并以 C28 交出的私有偏差事实为唯一锚点。
   * 偏差事实不成立时公共偏差记录与校准引用一并缺席——私有解释绝不冒充公共记录，
   * 校准引用也只在 C29 真实登记过该偏差事实时才给出。
   */
  async #readFeedback(
    command: C26ReadCommandV1<"feedback-read">,
    verified: AuthorizationContextV1,
  ): Promise<WarningResponseReadResultV1> {
    const scopeIds = this.#readableScopeIds(command, verified);
    const view = await this.#lifecycle.readFeedbackView({
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.requestedAt,
      invocationId: `${command.queryId}:feedback`,
      authorization: await this.#authorizeForComposition(command, `${command.queryId}:feedback`),
      targetRef: {
        kind: "feedback",
        reference: command.payload.feedbackRef.reference,
      },
    });
    if (view.kind === "failed") {
      throw new WarningResponseReadFailure(
        view.error.code === "AUTHORIZATION_DENIED"
          ? this.#readDenied(command)
          : this.#readBlocked(command, `feedback-read-${view.error.code}`),
      );
    }
    const exact = view.view as C28FeedbackViewV1;
    if (!scopeIds.includes(exact.spatialScopeEntityId)) {
      throw new WarningResponseReadFailure(this.#readBlocked(command, "feedback-record-not-found"));
    }
    // 私有偏差事实不成立就没有可锚定的公共侧事实：两条分支都不编造缺席内容。
    const deviationRecord =
      exact.deviationFactRef === undefined
        ? { kind: "absent" as const }
        : await this.#calibration.readDeviationRecordForDeviationFact({
            projectId: command.projectId,
            actorId: command.actorId,
            requestedAt: command.requestedAt,
            invocationId: `${command.queryId}:deviation-record`,
            authorization: await this.#authorizeForComposition(
              command,
              `${command.queryId}:deviation-record`,
            ),
            deviationFactRef: exact.deviationFactRef,
          });
    if (deviationRecord.kind === "failed") {
      throw new WarningResponseReadFailure(
        deviationRecord.error.code === "AUTHORIZATION_DENIED"
          ? this.#readDenied(command)
          : this.#readBlocked(command, `feedback-read-${deviationRecord.error.code}`),
      );
    }
    const cursorAnchor = c26CursorAnchor(command, verified);
    const after = decodeC26Cursor(command.payload.calibrationCursor, cursorAnchor);
    if (after === null) throw new WarningResponseReadFailure(this.#readDenied(command));
    const calibrations = await this.#relation(
      command,
      "calibration",
      await this.#calibration.readCalibrationRefsForDeviationFacts({
        projectId: command.projectId,
        actorId: command.actorId,
        requestedAt: command.requestedAt,
        invocationId: `${command.queryId}:calibration`,
        authorization: await this.#authorizeForComposition(
          command,
          `${command.queryId}:calibration`,
        ),
        anchorRefs:
          exact.deviationFactRef === undefined ? [] : [{ reference: exact.deviationFactRef }],
        ...(after === undefined
          ? {}
          : {
              after: {
                recordedAt: after.afterOccurredAt,
                entityId: after.afterEntityId,
                versionId: after.afterVersionId,
              },
            }),
        pageSize: C26_RELATION_PAGE_SIZE_V1,
      }),
    );
    return WarningResponseReadResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "feedback-read",
        actorId: command.actorId,
        feedbackRef: FeedbackRefV1Schema.parse(exact.feedbackRef),
        executionRef: ExecutionRecordRefV1Schema.parse(exact.executionRef),
        postActionMonitoringSnapshotRef: MonitoringSnapshotRefV1Schema.parse(
          exact.postActionMonitoringSnapshotRef,
        ),
        feedbackArtifactRef: ContentArtifactRefV1Schema.parse(exact.feedbackArtifactRef),
        actualAssessmentRecordRef: RiskAssessmentRecordRefV1Schema.parse(
          exact.actualAssessmentRecordRef,
        ),
        occurredAt: exact.occurredAt,
        forecastAvailability: exact.forecastAvailability,
        ...(exact.deviation === undefined
          ? {}
          : { deviation: DeviationViewV1Schema.parse(exact.deviation) }),
        ...(deviationRecord.kind === "absent"
          ? {}
          : {
              deviationRecord: deviationRecord.record,
              deviationRecordRef: deviationRecord.deviationRecordRef,
            }),
        calibrationRefs: calibrations.refs.map((ref) =>
          CalibrationSuggestionRefV1Schema.parse({
            kind: "calibration-suggestion",
            reference: ref.reference,
          }),
        ),
        ...(calibrations.hasMore &&
        calibrations.lastRef !== undefined &&
        calibrations.lastRecordedAt !== undefined
          ? {
              nextCursor: encodeC26Cursor(
                afterCursorAnchor(cursorAnchor, {
                  occurred_at: calibrations.lastRecordedAt,
                  entityId: calibrations.lastRef.reference.entityId,
                  versionId: calibrations.lastRef.reference.versionId,
                }),
              ),
            }
          : {}),
        // 反馈是处置闭环的终点事实：本身没有后续可写动作，页面不据此推断校准治理权限。
        actions: await this.#readActions(command, []),
      },
    });
  }

  /**
   * `calibration-read`（design D-05、D-06）：目标定义、逐项校验、偏差记录版本与草案
   * 全部取自 C29 自有事实。公共偏差记录不属于本读，未登记草案时不给草案引用。
   */
  async #readCalibration(
    command: C26ReadCommandV1<"calibration-read">,
    verified: AuthorizationContextV1,
  ): Promise<WarningResponseReadResultV1> {
    const scopeIds = this.#readableScopeIds(command, verified);
    const view = await this.#calibration.readCalibrationView({
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.requestedAt,
      invocationId: `${command.queryId}:calibration`,
      authorization: await this.#authorizeForComposition(command, `${command.queryId}:calibration`),
      calibrationSuggestionRef: command.payload.calibrationSuggestionRef,
    });
    if (view.kind === "failed") {
      throw new WarningResponseReadFailure(
        view.error.code === "AUTHORIZATION_DENIED"
          ? this.#readDenied(command)
          : this.#readBlocked(command, `calibration-read-${view.error.code}`),
      );
    }
    const exact = view.view;
    if (!scopeIds.includes(exact.spatialScopeEntityId)) {
      throw new WarningResponseReadFailure(
        this.#readBlocked(command, "calibration-suggestion-not-found"),
      );
    }
    return WarningResponseReadResultV1Schema.parse({
      kind: "succeeded",
      result: {
        kind: "calibration-read",
        actorId: command.actorId,
        calibrationSuggestionRef: exact.calibrationSuggestionRef,
        targetKind: exact.targetKind,
        targetReleaseRef: exact.targetReleaseRef,
        inputSnapshotRef: exact.inputSnapshotRef,
        validationPolicyRef: exact.validationPolicyRef,
        operations: exact.operations,
        status: exact.status,
        reviewTaskRef: exact.reviewTaskRef,
        deviationRecordRef: exact.deviationRecordRef,
        deviationRecordVersionId: exact.deviationRecordVersionId,
        ...(exact.reviewDecisionRef === undefined
          ? {}
          : { reviewDecisionRef: exact.reviewDecisionRef }),
        ...(exact.candidateArtifactRef === undefined
          ? {}
          : { candidateArtifactRef: exact.candidateArtifactRef }),
        ...(exact.knowledgeRevisionRef === undefined
          ? {}
          : { knowledgeRevisionRef: exact.knowledgeRevisionRef }),
        actions: await this.#readActions(command, [
          "warning-response.calibration-review-outcome",
          "warning-response.calibration-governance-draft",
        ]),
      },
    });
  }

  /**
   * 组合根注入的下游签发接缝按用途逐次取授权；拿不到就按拒绝收口。
   *
   * 分支取本模块自己的读分支 `warning-response.read`，与被组合的关系读取器保持同一
   * 能力口径：推荐（`postgres-recommendation-adapter`）与响应生命周期
   * （`postgres-response-lifecycle-adapter`）的关系入口都按 `warning-response.read`
   * 复验签发身份。这里原先签 `projection.query`，签出的上下文只带该分支能力，关系
   * 子读逐个 AUTHORIZATION_DENIED，任务关系页整体读不出来。改签本模块读分支不会放宽
   * 权限：能走到这段的调用方已在 `#verifyReadAuthorization` 通过同一分支复验。
   */
  async #authorizeForComposition(
    command: WarningResponseReadQueryV1,
    invocationId: string,
  ): Promise<AuthorizationContextV1> {
    return this.#authorizeDownstream({
      branch: "warning-response.read",
      invocationId,
      projectId: command.projectId,
      actorId: command.actorId,
      requestedAt: command.requestedAt,
    });
  }

  async #taskLinksOf(
    command: WarningResponseReadQueryV1,
    warningRecordIds: readonly string[],
  ): Promise<Map<string, WarningResponseTaskRefV1>> {
    if (warningRecordIds.length === 0) return new Map();
    let rows: readonly C26TaskLinkRow[];
    try {
      rows = (
        await sql<C26TaskLinkRow>`
        SELECT w.warning_record_id, l.task_id, l.first_included_version_id
          FROM business.warning_response_task_warnings l
          JOIN business.warning_records w
            ON w.project_id = l.project_id
           AND w.warning_record_id = l.warning_record_id
           AND w.version_id = l.warning_record_version_id
         WHERE l.project_id = ${command.projectId}
           AND l.warning_record_id = ANY(${[...warningRecordIds]})
      `.execute(this.#db)
      ).rows;
    } catch (error) {
      throw mapPostgresError(error, "warning-response.read.task-links");
    }
    return new Map(
      rows.map((row) => [
        row.warning_record_id,
        {
          kind: "warning-response-task" as const,
          reference: { entityId: row.task_id, versionId: row.first_included_version_id },
        },
      ]),
    );
  }

  async #acknowledgedWarningIds(
    command: WarningResponseReadQueryV1,
    warningRecordIds: readonly string[],
  ): Promise<Set<string>> {
    if (warningRecordIds.length === 0) return new Set();
    let rows: readonly { warning_record_id: string }[];
    try {
      rows = (
        await sql<{ warning_record_id: string }>`
        SELECT DISTINCT a.warning_record_id
          FROM business.warning_acknowledgements a
         WHERE a.project_id = ${command.projectId}
           AND a.warning_record_id = ANY(${[...warningRecordIds]})
      `.execute(this.#db)
      ).rows;
    } catch (error) {
      throw mapPostgresError(error, "warning-response.read.acknowledgements");
    }
    return new Set(rows.map((row) => row.warning_record_id));
  }

  async #acknowledgementOf(
    command: WarningResponseReadQueryV1,
    row: C26WarningReadRow,
  ): Promise<WarningAcknowledgementViewV1 | undefined> {
    let acknowledgement: Selectable<WarningAcknowledgementRow> | undefined;
    try {
      acknowledgement = await this.#db
        .selectFrom("business.warning_acknowledgements")
        .selectAll()
        .where("project_id", "=", command.projectId)
        .where("warning_record_id", "=", row.warning_record_id)
        .where("warning_record_version_id", "=", row.version_id)
        .orderBy("task_version_id", "desc")
        .executeTakeFirst();
    } catch (error) {
      throw mapPostgresError(error, "warning-response.read.acknowledgement");
    }
    if (acknowledgement === undefined) return undefined;
    return {
      actorId: acknowledgement.acknowledged_by_actor_id,
      acknowledgedAt: asIso(acknowledgement.acknowledged_at),
      auditTrailRef: {
        kind: "audit-trail",
        reference: { entityId: acknowledgement.audit_entry_id, versionId: "1" },
      },
    };
  }

  /**
   * 通知披露只给「谁在什么时候被通知、经哪个渠道、是否已投递」：投递时刻由已登记的投递行证明，
   * 通知意图自身不能证明已送达；通知策略正文不外泄。
   */
  async #notificationDisclosuresOf(
    command: WarningResponseReadQueryV1,
    row: C26WarningReadRow,
  ): Promise<WarningNotificationDisclosureV1[]> {
    let rows: readonly C26NotificationDisclosureRow[];
    try {
      rows = (
        await sql<C26NotificationDisclosureRow>`
        SELECT i.intent_id,
               i.version_id,
               i.recipient_actor_id,
               i.channel,
               i.occurred_at,
               d.delivered_at
          FROM business.notification_intents i
          LEFT JOIN business.in_app_notifications d
            ON d.project_id = i.project_id
           AND d.notification_intent_id = i.intent_id
           AND d.notification_intent_version_id = i.version_id
         WHERE i.project_id = ${command.projectId}
           AND i.warning_record_id = ${row.warning_record_id}
           AND i.warning_record_version_id = ${row.version_id}
         ORDER BY i.intent_id ASC, i.version_id ASC
         LIMIT ${C26_READ_PAGE_SIZE_MAX_V1}
      `.execute(this.#db)
      ).rows;
    } catch (error) {
      throw mapPostgresError(error, "warning-response.read.notifications");
    }
    return rows.map((intent) => ({
      intentRef: {
        kind: "notification-intent",
        reference: { entityId: intent.intent_id, versionId: intent.version_id },
      },
      recipientActorId: intent.recipient_actor_id,
      channel: intent.channel,
      recordedAt: asIso(intent.occurred_at),
      ...(intent.delivered_at === null ? {} : { deliveredAt: asIso(intent.delivered_at) }),
    }));
  }

  /**
   * 任务当前版本的空间范围、时点与风险输入精确版本：任务聚合键只绑定风险输入标识，
   * 精确版本取最新纳入的预警，绝不从聚合键或历史版本反推。
   */
  async #taskDetailOf(
    command: WarningResponseReadQueryV1,
    rows: readonly C26TaskCatalogRow[],
  ): Promise<
    Map<
      string,
      {
        readonly riskInput: RiskInputVersionRefV1;
        readonly spatialScopeRef: SpatialScopeRefV1;
        readonly warningCount: number;
      }
    >
  > {
    if (rows.length === 0) return new Map();
    const scopeByTask = new Map(
      rows.map(
        (row) => [row.task_id, SpatialScopeRefV1Schema.safeParse(row.spatial_scope_ref)] as const,
      ),
    );
    let linked: readonly C26TaskLinkDetailRow[];
    try {
      linked = (
        await sql<C26TaskLinkDetailRow>`
        SELECT l.task_id,
               r.risk_input_kind,
               r.risk_input_entity_id,
               r.risk_input_version_id
          FROM business.warning_response_task_warnings l
          JOIN business.warning_records r
            ON r.project_id = l.project_id
           AND r.warning_record_id = l.warning_record_id
           AND r.version_id = l.warning_record_version_id
         WHERE l.project_id = ${command.projectId}
           AND l.task_id = ANY(${rows.map((row) => row.task_id)})
         ORDER BY l.recorded_at ASC, r.warning_record_id ASC, r.version_id ASC
      `.execute(this.#db)
      ).rows;
    } catch (error) {
      throw mapPostgresError(error, "warning-response.read.task-detail");
    }
    const countByTask = new Map<string, number>();
    const latestRiskInputByTask = new Map<string, C26TaskLinkDetailRow>();
    for (const link of linked) {
      countByTask.set(link.task_id, (countByTask.get(link.task_id) ?? 0) + 1);
      latestRiskInputByTask.set(link.task_id, link);
    }
    const detail = new Map<
      string,
      {
        readonly riskInput: RiskInputVersionRefV1;
        readonly spatialScopeRef: SpatialScopeRefV1;
        readonly warningCount: number;
      }
    >();
    for (const row of rows) {
      const scope = scopeByTask.get(row.task_id);
      const latest = latestRiskInputByTask.get(row.task_id);
      if (scope === undefined || !scope.success || latest === undefined) {
        throw new WarningResponseReadFailure(
          this.#readBlocked(command, "task-current-version-unreadable"),
        );
      }
      const riskInput = RiskInputVersionRefV1Schema.safeParse({
        kind: latest.risk_input_kind,
        reference: {
          entityId: latest.risk_input_entity_id,
          versionId: latest.risk_input_version_id,
        },
      });
      if (!riskInput.success) {
        throw new WarningResponseReadFailure(
          this.#readBlocked(command, "risk-input-reference-invalid"),
        );
      }
      detail.set(row.task_id, {
        riskInput: riskInput.data,
        spatialScopeRef: scope.data,
        warningCount: countByTask.get(row.task_id) ?? 0,
      });
    }
    return detail;
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
