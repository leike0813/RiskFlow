import { sql, type Kysely, type Transaction } from "kysely";

import { AccessServiceError, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import { ArtifactReadRequestV1Schema, type ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
  DeviationPolicyDocumentV1Schema,
  ForecastPolicyDocumentV1Schema,
  IndicatorSystemDocumentV1Schema,
  RiskMatrixDocumentV1Schema,
  canonicalDecimalToString,
  roundCanonicalDecimalValue,
  type ForecastPolicyV1,
} from "@riskflow/core/assessment-config";
import type { MonitoringSnapshotV1 } from "@riskflow/core/engineering-data/monitoring";
import {
  sha256CanonicalJson,
  type AtomicCommandV1,
  type AtomicCommitReceiptV1,
  type AtomicCommitV1,
  type JsonValue,
  type TransactionContextV1,
  type TransactionOptionsV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import { decimalFromFiniteNumber } from "@riskflow/core/risk-assessment/engine";
import type { AssessmentMonitoringReaderV1 } from "@riskflow/core/risk-assessment/engine";
import {
  AssessmentBasisReleaseSetReadResultV1Schema,
  type AssessmentBasisReleaseSetReaderV1,
} from "@riskflow/core/scoring-rules";
import {
  MODULE_BRANCH_CAPABILITY_V1,
  MonitoringSnapshotRefV1Schema,
  RiskInputVersionRefV1Schema,
  SpatialScopeRefV1Schema,
  WarningResponseRecordCommandV1Schema,
  WarningResponseRecordResultV1Schema,
  ModuleErrorV1Schema,
  type AuthorizationContextV1,
  type ModuleBranchV1,
  type ModuleCapabilityV1,
  type ModuleErrorV1,
  type MonitoringSnapshotRefV1,
  type WarningResponseRecordCommandV1,
  type WarningResponseRecordResultV1,
} from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";
import type {
  ContractReferenceV1,
  DeviationViewV1,
  ForecastAvailabilityV1,
} from "@riskflow/contracts/ports";
import type {
  C28ReadResultV1,
  RelationAnchorV1,
  RelationPageInputV1,
  RelationPageResultV1,
  ResolveRefsInputV1,
  ResolveRefsResultV1,
  LifecycleReadInputV1,
  WarningResponseLifecycleReaderV1,
} from "../warning/postgres-warning-lifecycle-adapter.js";
import { DomainEventV1Schema } from "@riskflow/contracts/events";
import {
  ResponseRecommendationSchema,
  RiskAssessmentRecordSchema,
} from "@riskflow/contracts/records";

import {
  ForecastResponseCommandV1Schema,
  EffectForecastExecutorOutcomeV1Schema,
  ResponseAdoptionDecisionCommandV1Schema,
  ResponseAdoptionDecisionV1Schema,
  ResponseDeviationFactV1Schema,
  ResponseExecutionRecordV1Schema,
  ResponseFeedbackCommandV1Schema,
  ResponseFeedbackRecordV1Schema,
  ResponseForecastOutcomeV1Schema,
  ResponseForecastResultV1Schema,
  computeResponseDeviation,
  deviationFactRefOf,
  effectForecastRefOf,
  executionRecordRefOf,
  failResponseLifecycle,
  responseDeviationDigest,
  responseExecutionDigest,
  responseForecastInputDigest,
  responseLifecycleFailureFrom,
  toResponseLifecycleModuleError,
  verifyForecastExecutorResult,
  type EffectForecastExecutorV1,
  type ResponseDeviationFactV1,
  type ResponseDeviationFactReadResultV1,
  type ResponseDeviationResultV1,
  type ResponseExecutionRecordV1,
  type ResponseFeedbackRecordV1,
  type ResponseForecastAvailabilityV1,
  type ResponseForecastExecutorRequestV1,
  type ResponseForecastOutcomeV1,
  type ResponseForecastProjectionV1,
  type ResponseForecastResultV1,
  type ResponseLifecycleAssessmentChainV1,
  type ResponseLifecycleBasisMemberV1,
  type ResponseLifecycleContextReaderV1,
  type ResponseLifecycleFrozenContextV1,
  type ResponseLifecycleServiceV1,
  type ResponseDeviationFactReaderV1,
  type VerifiedResponseWorkflowBindingV1,
} from "@riskflow/core/response-lifecycle";

import { mapPostgresError } from "../postgres/pool.js";
import { getPostgresTransaction } from "../postgres/transaction-unit.js";
import type { PostgresDatabase } from "../postgres/types.js";

type JsonColumn = JsonValue;

const ADOPTION_BRANCH_V1 = "warning-response.adopt-recommendation" as const;
const EXECUTION_BRANCH_V1 = "warning-response.record-execution" as const;
const FEEDBACK_BRANCH_V1 = "warning-response.record-feedback" as const;
const DEVIATION_BRANCH_V1 = "warning-response.calculate-deviation" as const;

/** 关系集合单页上限：与公共 C34 目录页大小一致，读侧不再多取。 */
const C34_RELATION_PAGE_SIZE_V1 = 50;
/** C14 窄读、C19 basis 与 C04 正文读取各用既有精确分支，不新增 capability。 */
const MONITORING_BRANCH_V1 = "engineering-data.monitoring-snapshot-query" as const;
const BASIS_BRANCH_V1 = "knowledge-modeling.assessment-basis" as const;
const CONFIGURATION_BRANCH_V1 = "knowledge-modeling.measure-candidates" as const;

const ADOPTION_COMMAND_KIND_V1 = "warning-response.adopt-recommendation";
const FORECAST_COMMAND_KIND_V1 = "warning-response.forecast-response";
const EXECUTION_COMMAND_KIND_V1 = "warning-response.record-execution";
const FEEDBACK_COMMAND_KIND_V1 = "warning-response.record-feedback";
const DEVIATION_COMMAND_KIND_V1 = "warning-response.calculate-deviation";

const FEEDBACK_ARTIFACT_PURPOSE_CODE_V1 = "warning-response.feedback-artifact";
const MAX_ARTIFACT_BYTES_V1 = 8 * 1024 * 1024;
const MAX_SERIALIZATION_ATTEMPTS_V1 = 3;
/** 无预测事实可解析时的稳定不可用原因；只在 C28 私有事实与既有事件内使用。 */
const NO_EFFECT_FORECAST_REASON_V1 = "no-effect-forecast";
const FORECAST_POLICY_MEMBER_TYPES_V1 = [
  "forecast-policy",
  "risk-matrix",
  "indicator-system",
] as const;
const DEVIATION_MEMBER_TYPES_V1 = ["deviation-policy", "risk-matrix", "indicator-system"] as const;

type RecordFeedbackCommandV1 = Extract<WarningResponseRecordCommandV1, { kind: "record-feedback" }>;
type AdoptRecommendationCommandV1 = Extract<
  WarningResponseRecordCommandV1,
  { kind: "adopt-recommendation" }
>;

interface ResponseRecommendationRow {
  recommendation_id: string;
  version_id: string;
  project_id: string;
  warning_record_id: string;
  warning_record_version_id: string;
  warning_response_task_id: string;
  warning_response_task_version_id: string;
  assessment_record_id: string;
  assessment_record_version_id: string;
  spatial_scope_entity_id: string;
  spatial_scope_version_id: string;
  measure_library_release_id: string;
  measure_library_release_version_id: string;
  record_payload: JsonColumn;
}

interface WarningRecordRow {
  warning_record_id: string;
  version_id: string;
  project_id: string;
  risk_input_kind: string;
  risk_input_entity_id: string;
  risk_input_version_id: string;
  assessment_input_snapshot_id: string;
  assessment_input_snapshot_version_id: string;
  spatial_scope_entity_id: string;
}

interface RiskAssessmentRecordRow {
  record_id: string;
  version_id: string;
  project_id: string;
  risk_input_kind: string;
  risk_record_id: string | null;
  external_risk_event_id: string | null;
  input_snapshot_id: string;
  input_snapshot_version_id: string;
  record_payload: JsonColumn;
}

interface AssessmentInputSnapshotRow {
  input_snapshot_id: string;
  version_id: string;
  project_id: string;
  basis_release_set_ref: JsonColumn;
  snapshot_payload: JsonColumn;
}

interface AssessmentPreparationRow {
  snapshot_id: string;
  version_id: string;
  project_id: string;
  spatial_scope_ref: JsonColumn;
  monitoring_snapshot_refs: JsonColumn | null;
}

interface AdoptionDecisionRow {
  decision_id: string;
  version_id: string;
  project_id: string;
  recommendation_id: string;
  recommendation_version_id: string;
  decision: string;
  spatial_scope_entity_id: string;
  spatial_scope_version_id: string;
  decision_payload: JsonColumn;
  content_digest: string;
}

interface ForecastOutcomeRow {
  forecast_id: string;
  version_id: string;
  project_id: string;
  recommendation_id: string;
  recommendation_version_id: string;
  route_decision_id: string;
  route_decision_version_id: string;
  forecast_input_snapshot_id: string;
  forecast_input_snapshot_version_id: string;
  frozen_basis_snapshot_id: string;
  frozen_basis_snapshot_version_id: string;
  pre_action_snapshot_id: string;
  pre_action_snapshot_version_id: string;
  baseline_assessment_record_id: string;
  baseline_assessment_record_version_id: string;
  forecast_policy_entity_id: string;
  forecast_policy_version_id: string;
  availability: string;
  spatial_scope_entity_id: string;
  spatial_scope_version_id: string;
  forecast_payload: JsonColumn;
  content_digest: string;
}

interface ExecutionRow {
  execution_id: string;
  version_id: string;
  project_id: string;
  source_kind: string;
  recommendation_id: string | null;
  recommendation_version_id: string | null;
  spatial_scope_entity_id: string;
  spatial_scope_version_id: string;
  occurred_at: Date;
  execution_payload: JsonColumn;
  content_digest: string;
}

interface FeedbackRow {
  feedback_id: string;
  version_id: string;
  project_id: string;
  execution_id: string;
  execution_version_id: string;
  post_action_snapshot_id: string;
  post_action_snapshot_version_id: string;
  feedback_artifact_id: string;
  feedback_artifact_version_id: string;
  actual_assessment_record_id: string;
  actual_assessment_record_version_id: string;
  effect_forecast_id: string | null;
  effect_forecast_version_id: string | null;
  forecast_availability: string;
  forecast_unavailable_reason: string | null;
  recorded_at: Date;
  spatial_scope_entity_id: string;
  spatial_scope_version_id: string;
  feedback_payload: JsonColumn;
  content_digest: string;
}

interface DeviationRow {
  deviation_id: string;
  version_id: string;
  project_id: string;
  recommendation_id: string;
  recommendation_version_id: string;
  execution_id: string;
  execution_version_id: string;
  effect_forecast_id: string;
  effect_forecast_version_id: string;
  feedback_id: string;
  feedback_version_id: string;
  frozen_basis_snapshot_id: string;
  frozen_basis_snapshot_version_id: string;
  deviation_policy_entity_id: string;
  deviation_policy_version_id: string;
  basis: string;
  risk_matrix_entity_id: string;
  risk_matrix_version_id: string;
  target_indicator_id: string;
  unit: string;
  predicted_value_canonical: string;
  actual_value_canonical: string;
  deviation_value_canonical: string;
  threshold_exceeded: boolean;
  direction: string;
  spatial_scope_entity_id: string;
  spatial_scope_version_id: string;
  deviation_payload: JsonColumn;
  content_digest: string;
  computed_at: Date;
}

type ResponseLifecycleDatabase = PostgresDatabase & {
  "business.response_recommendations": ResponseRecommendationRow;
  "business.warning_records": WarningRecordRow;
  "business.risk_assessment_records": RiskAssessmentRecordRow;
  "business.assessment_input_snapshots": AssessmentInputSnapshotRow;
  "business.assessment_preparation_snapshots": AssessmentPreparationRow;
  "business.response_adoption_decisions": AdoptionDecisionRow;
  "business.response_forecast_outcomes": ForecastOutcomeRow;
  "business.response_execution_records": ExecutionRow;
  "business.response_feedback_records": FeedbackRow;
  "business.response_deviation_facts": DeviationRow;
  "business.assessment_configuration_release_sets": {
    set_id: string;
    version_id: string;
    project_id: string;
  };
  "business.assessment_configuration_release_set_members": {
    set_id: string;
    version_id: string;
    definition_type: string;
    release_id: string;
    release_version_id: string;
  };
};

type LifecycleTargetRefV1 = {
  readonly kind: string;
  readonly reference: VersionReference;
};

const asTransaction = (context: TransactionContextV1): Transaction<ResponseLifecycleDatabase> =>
  getPostgresTransaction(context) as unknown as Transaction<ResponseLifecycleDatabase>;

const jsonValue = (value: unknown): unknown => JSON.stringify(value) as unknown;

const refKey = (value: { readonly entityId: string; readonly versionId: string }): string =>
  `${value.entityId}\u0000${value.versionId}`;

const sameRef = (
  left: { readonly entityId: string; readonly versionId: string },
  right: { readonly entityId: string; readonly versionId: string },
): boolean => refKey(left) === refKey(right);

const parseBasisReleaseSetRef = (
  value: unknown,
  targetRef: LifecycleTargetRefV1,
): {
  readonly kind: "assessment-basis-release-set";
  readonly reference: VersionReference;
} => {
  const candidate = value as {
    kind?: unknown;
    reference?: { entityId?: unknown; versionId?: unknown };
  };
  const entityId = candidate.reference?.entityId;
  const versionId = candidate.reference?.versionId;
  if (
    typeof value !== "object" ||
    value === null ||
    candidate.kind !== "assessment-basis-release-set" ||
    typeof entityId !== "string" ||
    typeof versionId !== "string"
  ) {
    failResponseLifecycle("response-lifecycle-contract-drift", targetRef);
  }
  return { kind: "assessment-basis-release-set", reference: { entityId, versionId } };
};

const parseMonitoringRefs = (
  value: unknown,
  targetRef: LifecycleTargetRefV1,
): readonly MonitoringSnapshotRefV1[] => {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    failResponseLifecycle("response-lifecycle-contract-drift", targetRef);
  }
  return value.map((entry) => {
    const parsed = MonitoringSnapshotRefV1Schema.safeParse(entry);
    if (!parsed.success) {
      failResponseLifecycle("response-lifecycle-contract-drift", targetRef);
    }
    return parsed.data;
  });
};

const memberDocument = <T>(
  members: readonly ResponseLifecycleBasisMemberV1[],
  definitionType: string,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  targetRef: LifecycleTargetRefV1,
): { readonly document: T; readonly releaseRef: VersionReference } => {
  const member = members.find((candidate) => candidate.member.definitionType === definitionType);
  if (member === undefined) {
    failResponseLifecycle("response-forecast-policy-unavailable", targetRef);
  }
  const parsed = schema.safeParse(member.content);
  const document = parsed.success ? parsed.data : undefined;
  if (document === undefined) {
    failResponseLifecycle("response-lifecycle-contract-drift", targetRef);
  }
  return { document, releaseRef: member.member.releaseRef.reference };
};

const indicatorUnitOf = (
  indicators: readonly {
    readonly indicatorId: string;
    readonly valueKind: string;
    readonly canonicalUnit?: string;
  }[],
  indicatorId: string,
): string | undefined => {
  const indicator = indicators.find((candidate) => candidate.indicatorId === indicatorId);
  return indicator?.valueKind === "numeric" ? indicator.canonicalUnit : undefined;
};

/** 有限 number 的规范十进制展示：超过六位小数按 half-away-from-zero 舍入。 */
const canonicalStringOfNumber = (value: number): string => {
  if (!Number.isFinite(value)) {
    failResponseLifecycle("response-deviation-value-incompatible", {
      kind: "response-deviation-fact",
      reference: { entityId: "response-deviation-input", versionId: "1" },
    });
  }
  return canonicalDecimalToString(roundCanonicalDecimalValue(decimalFromFiniteNumber(value), 6));
};

/** 持久化正文只按 strict Schema 复验；摘要不符即契约漂移。 */
const parseForecastOutcome = (
  row: ForecastOutcomeRow,
  forecastRef: VersionReference,
): ResponseForecastOutcomeV1 => {
  const parsed = ResponseForecastOutcomeV1Schema.safeParse(row.forecast_payload);
  if (
    !parsed.success ||
    sha256CanonicalJson(parsed.data) !== row.content_digest ||
    parsed.data.projectId !== row.project_id ||
    !sameRef(parsed.data.effectForecastRef.reference, forecastRef) ||
    !sameRef(parsed.data.responseRecommendationRef.reference, {
      entityId: row.recommendation_id,
      versionId: row.recommendation_version_id,
    }) ||
    !sameRef(parsed.data.routeDecisionRef.reference, {
      entityId: row.route_decision_id,
      versionId: row.route_decision_version_id,
    }) ||
    !sameRef(parsed.data.forecastInputSnapshotRef.reference, {
      entityId: row.forecast_input_snapshot_id,
      versionId: row.forecast_input_snapshot_version_id,
    }) ||
    !sameRef(parsed.data.frozenAssessmentBasisRef.reference, {
      entityId: row.frozen_basis_snapshot_id,
      versionId: row.frozen_basis_snapshot_version_id,
    }) ||
    !sameRef(parsed.data.preActionMonitoringSnapshotRef.reference, {
      entityId: row.pre_action_snapshot_id,
      versionId: row.pre_action_snapshot_version_id,
    }) ||
    !sameRef(parsed.data.baselineAssessmentRecordRef.reference, {
      entityId: row.baseline_assessment_record_id,
      versionId: row.baseline_assessment_record_version_id,
    }) ||
    !sameRef(parsed.data.forecastPolicyRef, {
      entityId: row.forecast_policy_entity_id,
      versionId: row.forecast_policy_version_id,
    }) ||
    parsed.data.availability.kind !== row.availability ||
    !sameRef(parsed.data.spatialScopeRef.reference, {
      entityId: row.spatial_scope_entity_id,
      versionId: row.spatial_scope_version_id,
    })
  ) {
    failResponseLifecycle("response-lifecycle-contract-drift", {
      kind: "effect-forecast",
      reference: forecastRef,
    });
  }
  return parsed.data;
};

const parseAdoptionDecision = (
  row: AdoptionDecisionRow,
  projectId: string,
  recommendationRef: VersionReference,
): void => {
  const parsed = ResponseAdoptionDecisionV1Schema.safeParse(row.decision_payload);
  if (
    !parsed.success ||
    sha256CanonicalJson(parsed.data) !== row.content_digest ||
    parsed.data.projectId !== projectId ||
    parsed.data.decision !== row.decision ||
    !sameRef(parsed.data.responseRecommendationRef.reference, recommendationRef) ||
    !sameRef(parsed.data.routeDecisionRef.reference, {
      entityId: row.decision_id,
      versionId: row.version_id,
    }) ||
    !sameRef(parsed.data.spatialScopeRef.reference, {
      entityId: row.spatial_scope_entity_id,
      versionId: row.spatial_scope_version_id,
    })
  ) {
    failResponseLifecycle("response-lifecycle-contract-drift", {
      kind: "response-recommendation",
      reference: recommendationRef,
    });
  }
};

const parseExecutionRecord = (row: ExecutionRow, executionRef: VersionReference): void => {
  const parsed = ResponseExecutionRecordV1Schema.safeParse(row.execution_payload);
  if (
    !parsed.success ||
    sha256CanonicalJson(parsed.data) !== row.content_digest ||
    parsed.data.projectId !== row.project_id ||
    parsed.data.source.kind !== row.source_kind ||
    !sameRef(parsed.data.executionRecordRef.reference, executionRef) ||
    !sameRef(parsed.data.spatialScopeRef.reference, {
      entityId: row.spatial_scope_entity_id,
      versionId: row.spatial_scope_version_id,
    })
  ) {
    failResponseLifecycle("response-lifecycle-contract-drift", {
      kind: "execution-record",
      reference: executionRef,
    });
  }
};

type SqlFragment = ReturnType<typeof sql>;

/** 解析结果有界：实体标识在三类关系里的登记版本数由公共上限约束。 */
const C28_RESOLVE_MAX_REFS_V1 = 50;

/** 关系页查询行：标识、版本与登记时点，登记时点只用于构造续页位置。 */
interface C28RelationRowV1 {
  readonly entity_id: string;
  readonly version_id: string;
  readonly recorded_at: Date | string;
}

/**
 * 锚点集合为空：这类关系尚不存在，返回空页而不是跨域反查。
 * 空页不携带 kind——没有任何已登记引用时，kind 没有事实来源。
 */
const emptyRelationPage = (): RelationPageResultV1 => ({
  kind: "succeeded",
  refs: [],
  hasMore: false,
  lastRef: undefined,
  lastRecordedAt: undefined,
});

/** 锚点谓词按 OR 组合：多个建议共享一类关系查询，单次 SQL 内完成。 */
const joinAnchorSql = (
  anchors: readonly RelationAnchorV1[],
  predicate: (anchor: RelationAnchorV1) => SqlFragment,
): SqlFragment =>
  anchors.reduce<SqlFragment | undefined>(
    (acc, anchor) => (acc === undefined ? predicate(anchor) : sql`${acc} OR ${predicate(anchor)}`),
    undefined,
  ) ?? sql`FALSE`;

/**
 * keyset 续页位置：登记时点倒序、标识升序。
 * `after` 只携带上一页末行的身份与登记时点，不携带权限材料——每次读取都重新复验当前授权。
 */
const relationAfterSql = (
  after:
    | { readonly recordedAt: string; readonly entityId: string; readonly versionId: string }
    | undefined,
  timeColumn: SqlFragment,
  idColumn: SqlFragment,
): SqlFragment =>
  after === undefined
    ? sql``
    : sql`AND (
           ${timeColumn} < ${after.recordedAt}
           OR (${timeColumn} = ${after.recordedAt} AND ${idColumn} > ${after.entityId})
           OR (${timeColumn} = ${after.recordedAt} AND ${idColumn} = ${after.entityId}
               AND ${sql.ref("version_id")} > ${after.versionId})
         )`;

const parseFeedbackRecord = (row: FeedbackRow, feedbackRef: VersionReference): void => {
  const parsed = ResponseFeedbackRecordV1Schema.safeParse(row.feedback_payload);
  if (
    !parsed.success ||
    sha256CanonicalJson(parsed.data) !== row.content_digest ||
    parsed.data.projectId !== row.project_id ||
    !sameRef(parsed.data.feedbackRef.reference, feedbackRef) ||
    !sameRef(parsed.data.executionRecordRef.reference, {
      entityId: row.execution_id,
      versionId: row.execution_version_id,
    }) ||
    !sameRef(parsed.data.postActionMonitoringSnapshotRef.reference, {
      entityId: row.post_action_snapshot_id,
      versionId: row.post_action_snapshot_version_id,
    }) ||
    !sameRef(parsed.data.feedbackArtifactRef.reference, {
      entityId: row.feedback_artifact_id,
      versionId: row.feedback_artifact_version_id,
    }) ||
    !sameRef(parsed.data.actualAssessmentRecordRef.reference, {
      entityId: row.actual_assessment_record_id,
      versionId: row.actual_assessment_record_version_id,
    }) ||
    parsed.data.forecast.kind !== row.forecast_availability ||
    (parsed.data.forecast.kind === "available" &&
      !sameRef(parsed.data.forecast.effectForecastRef.reference, {
        entityId: row.effect_forecast_id ?? "",
        versionId: row.effect_forecast_version_id ?? "",
      })) ||
    (parsed.data.forecast.kind === "unavailable" &&
      parsed.data.forecast.reasonCode !== row.forecast_unavailable_reason) ||
    !sameRef(parsed.data.spatialScopeRef.reference, {
      entityId: row.spatial_scope_entity_id,
      versionId: row.spatial_scope_version_id,
    })
  ) {
    failResponseLifecycle("response-lifecycle-contract-drift", {
      kind: "feedback",
      reference: feedbackRef,
    });
  }
};

const parseDeviationFact = (
  row: DeviationRow,
  deviationRef: VersionReference,
): ResponseDeviationFactV1 => {
  const parsed = ResponseDeviationFactV1Schema.safeParse(row.deviation_payload);
  if (
    !parsed.success ||
    sha256CanonicalJson(parsed.data) !== row.content_digest ||
    parsed.data.projectId !== row.project_id ||
    !sameRef(parsed.data.deviationFactRef.reference, deviationRef) ||
    !sameRef(parsed.data.responseRecommendationRef.reference, {
      entityId: row.recommendation_id,
      versionId: row.recommendation_version_id,
    }) ||
    !sameRef(parsed.data.executionRecordRef.reference, {
      entityId: row.execution_id,
      versionId: row.execution_version_id,
    }) ||
    !sameRef(parsed.data.effectForecastRef.reference, {
      entityId: row.effect_forecast_id,
      versionId: row.effect_forecast_version_id,
    }) ||
    !sameRef(parsed.data.feedbackRef.reference, {
      entityId: row.feedback_id,
      versionId: row.feedback_version_id,
    }) ||
    !sameRef(parsed.data.frozenAssessmentBasisRef.reference, {
      entityId: row.frozen_basis_snapshot_id,
      versionId: row.frozen_basis_snapshot_version_id,
    }) ||
    !sameRef(parsed.data.deviationPolicyRef, {
      entityId: row.deviation_policy_entity_id,
      versionId: row.deviation_policy_version_id,
    }) ||
    parsed.data.basis !== row.basis ||
    !sameRef(parsed.data.riskMatrixRef, {
      entityId: row.risk_matrix_entity_id,
      versionId: row.risk_matrix_version_id,
    }) ||
    parsed.data.targetIndicatorId !== row.target_indicator_id ||
    parsed.data.unit !== row.unit ||
    parsed.data.predictedValue !== row.predicted_value_canonical ||
    parsed.data.actualValue !== row.actual_value_canonical ||
    parsed.data.deviationValue !== row.deviation_value_canonical ||
    parsed.data.thresholdExceeded !== row.threshold_exceeded ||
    parsed.data.direction !== row.direction ||
    !sameRef(parsed.data.spatialScopeRef.reference, {
      entityId: row.spatial_scope_entity_id,
      versionId: row.spatial_scope_version_id,
    })
  ) {
    failResponseLifecycle("response-lifecycle-contract-drift", {
      kind: "response-deviation-fact",
      reference: deviationRef,
    });
  }
  return parsed.data;
};

/* -------------------------------------------------------------------------- */
/* 注入接缝                                                                    */
/* -------------------------------------------------------------------------- */

/** 下游只读授权签发接缝：组合根按精确 branch 签发，C28 再亲自向 C06 复验。 */
export interface ResponseLifecycleDownstreamAuthorizationRequestV1 {
  readonly branch: ModuleBranchV1;
  readonly invocationId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly requestedAt: string;
  readonly requestedSpatialScopeRefs?: readonly {
    readonly kind: "spatial-scope";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }[];
}

export type ResponseLifecycleDownstreamAuthorizerV1 = (
  request: ResponseLifecycleDownstreamAuthorizationRequestV1,
) => Promise<AuthorizationContextV1>;

/* -------------------------------------------------------------------------- */
/* 精确只读上下文（D-03）                                                       */
/* -------------------------------------------------------------------------- */

/** 组合根以当前请求身份与授权确认同工程精确措施发布。 */
export type ResponseLifecycleMeasureReleaseReaderV1 = Pick<
  ResponseLifecycleContextReaderV1,
  "readPublishedMeasureReleases"
>;

export interface PostgresResponseLifecycleContextReaderOptionsV1 {
  readonly db: Kysely<PostgresDatabase>;
  readonly artifactStore: ArtifactStoreV1;
  readonly basis: AssessmentBasisReleaseSetReaderV1;
  readonly monitoring: AssessmentMonitoringReaderV1;
  readonly measureReleases: ResponseLifecycleMeasureReleaseReaderV1;
  readonly authorizeDownstream: ResponseLifecycleDownstreamAuthorizerV1;
}

/** C28 私有只读端口实现：先授权，再按精确引用投影 C27 建议链、C25 评估与 C19/C04 成员。 */
export class PostgresResponseLifecycleContextReader implements ResponseLifecycleContextReaderV1 {
  readonly #db: Kysely<ResponseLifecycleDatabase>;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #basis: AssessmentBasisReleaseSetReaderV1;
  readonly #monitoring: AssessmentMonitoringReaderV1;
  readonly #measureReleases: ResponseLifecycleMeasureReleaseReaderV1;
  readonly #authorizeDownstream: ResponseLifecycleDownstreamAuthorizerV1;

  constructor(options: PostgresResponseLifecycleContextReaderOptionsV1) {
    this.#db = options.db as unknown as Kysely<ResponseLifecycleDatabase>;
    this.#artifactStore = options.artifactStore;
    this.#basis = options.basis;
    this.#monitoring = options.monitoring;
    this.#measureReleases = options.measureReleases;
    this.#authorizeDownstream = options.authorizeDownstream;
  }

  async readPublishedMeasureReleases(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly measureLibraryReleaseRefs: readonly VersionReference[];
  }): Promise<readonly VersionReference[]> {
    // 保留当前主体与工程授权，由所属发布读取接缝确认精确引用。
    const authorization = input.authorization;
    if (authorization.projectId.length === 0 || authorization.spatialScopeRefs.length === 0) {
      failResponseLifecycle(
        "response-lifecycle-authorization-required",
        {
          kind: "authorization-context",
          reference: { entityId: "warning-response.unauthorized.measure-releases", versionId: "1" },
        },
        "AUTHORIZATION_DENIED",
      );
    }
    return this.#measureReleases.readPublishedMeasureReleases(input);
  }

  async #authorizeFor(
    input: ResponseLifecycleDownstreamAuthorizationRequestV1,
    requiredCapability: ModuleCapabilityV1,
  ): Promise<AuthorizationContextV1> {
    const context = await this.#authorizeDownstream(input);
    const capability = MODULE_BRANCH_CAPABILITY_V1[input.branch];
    const requestedScopeKeys = new Set(
      (input.requestedSpatialScopeRefs ?? []).map((scope) => refKey(scope.reference)),
    );
    if (
      context.projectId !== input.projectId ||
      context.actorId !== input.actorId ||
      context.grantedCapabilities.length !== 1 ||
      !context.grantedCapabilities.includes(capability) ||
      context.spatialScopeRefs.some((scope) => !requestedScopeKeys.has(refKey(scope.reference)))
    ) {
      failResponseLifecycle(
        "response-lifecycle-authorization-required",
        {
          kind: "authorization-context",
          reference: {
            entityId: `response-lifecycle.unauthorized.${requiredCapability}`,
            versionId: "1",
          },
        },
        "AUTHORIZATION_DENIED",
      );
    }
    return context;
  }

  async readRecommendationContext(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly responseRecommendationRef: {
      readonly kind: "response-recommendation";
      readonly reference: VersionReference;
    };
  }): Promise<ResponseLifecycleFrozenContextV1> {
    const authorization = input.authorization;
    const authorizedScopeIds = authorization.spatialScopeRefs.map(
      (scope) => scope.reference.entityId,
    );
    const targetRef = {
      kind: "response-recommendation" as const,
      reference: input.responseRecommendationRef.reference,
    };
    if (authorizedScopeIds.length === 0) {
      failResponseLifecycle(
        "response-lifecycle-authorization-required",
        targetRef,
        "AUTHORIZATION_DENIED",
      );
    }
    const recommendation = await this.#db
      .selectFrom("business.response_recommendations")
      .selectAll()
      .where("project_id", "=", authorization.projectId)
      .where("recommendation_id", "=", targetRef.reference.entityId)
      .where("version_id", "=", targetRef.reference.versionId)
      .where("spatial_scope_entity_id", "in", authorizedScopeIds)
      .executeTakeFirst();
    const warning =
      recommendation === undefined
        ? undefined
        : await this.#db
            .selectFrom("business.warning_records")
            .selectAll()
            .where("project_id", "=", authorization.projectId)
            .where("warning_record_id", "=", recommendation.warning_record_id)
            .where("version_id", "=", recommendation.warning_record_version_id)
            .where("spatial_scope_entity_id", "in", authorizedScopeIds)
            .executeTakeFirst();
    if (recommendation === undefined || warning === undefined) {
      failResponseLifecycle(
        "response-lifecycle-authorization-required",
        targetRef,
        "AUTHORIZATION_DENIED",
      );
    }
    const assessment = await this.#loadAssessmentChain(
      authorization.projectId,
      {
        entityId: recommendation.assessment_record_id,
        versionId: recommendation.assessment_record_version_id,
      },
      authorizedScopeIds,
    );
    const record = ResponseRecommendationSchema.safeParse(recommendation.record_payload);
    if (!record.success) {
      failResponseLifecycle("response-lifecycle-contract-drift", targetRef);
    }
    if (
      !record.data.triggerConsistencyValidation.passed ||
      !record.data.standardsComplianceValidation.passed ||
      !record.data.siteFeasibilityValidation.passed
    ) {
      failResponseLifecycle("response-recommendation-unavailable", targetRef);
    }
    if (
      assessment.riskInput.kind !== warning.risk_input_kind ||
      assessment.riskInput.entityId !== warning.risk_input_entity_id ||
      !sameRef(assessment.inputSnapshotRef, {
        entityId: warning.assessment_input_snapshot_id,
        versionId: warning.assessment_input_snapshot_version_id,
      }) ||
      assessment.spatialScopeRef.reference.entityId !== recommendation.spatial_scope_entity_id ||
      record.data.warningRecordId !== recommendation.warning_record_id
    ) {
      failResponseLifecycle("response-lifecycle-contract-drift", targetRef);
    }
    return {
      projectId: authorization.projectId,
      responseRecommendationRef: targetRef,
      record: record.data,
      spatialScopeRef: SpatialScopeRefV1Schema.parse({
        kind: "spatial-scope",
        reference: {
          entityId: recommendation.spatial_scope_entity_id,
          versionId: recommendation.spatial_scope_version_id,
        },
      }),
      warningRecordRef: {
        kind: "warning-record",
        reference: {
          entityId: recommendation.warning_record_id,
          versionId: recommendation.warning_record_version_id,
        },
      },
      warningResponseTaskRef: {
        kind: "warning-response-task",
        reference: {
          entityId: recommendation.warning_response_task_id,
          versionId: recommendation.warning_response_task_version_id,
        },
      },
      measureLibraryReleaseRef: {
        entityId: recommendation.measure_library_release_id,
        versionId: recommendation.measure_library_release_version_id,
      },
      basisReleaseSetRef: assessment.basisRef,
      riskInputRef: RiskInputVersionRefV1Schema.parse({
        kind: assessment.riskInput.kind,
        reference: {
          entityId: assessment.riskInput.entityId,
          versionId: warning.risk_input_version_id,
        },
      }),
      baselineAssessmentRecordRef: {
        kind: "risk-assessment-record",
        reference: {
          entityId: recommendation.assessment_record_id,
          versionId: recommendation.assessment_record_version_id,
        },
      },
      baselineAssessmentInputSnapshotRef: {
        kind: "assessment-input-snapshot",
        reference: assessment.inputSnapshotRef,
      },
      baseline: {
        riskState: assessment.riskState,
        indicatorValues: assessment.indicatorValues,
      },
    };
  }

  async readAssessmentChain(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly assessmentRecordRef: {
      readonly kind: "risk-assessment-record";
      readonly reference: VersionReference;
    };
  }): Promise<ResponseLifecycleAssessmentChainV1> {
    return this.#loadAssessmentChain(
      input.authorization.projectId,
      input.assessmentRecordRef.reference,
      input.authorization.spatialScopeRefs.map((scope) => scope.reference.entityId),
    );
  }

  async #loadAssessmentChain(
    projectId: string,
    recordRef: VersionReference,
    authorizedScopeIds: readonly string[],
  ): Promise<ResponseLifecycleAssessmentChainV1> {
    const targetRef: LifecycleTargetRefV1 = {
      kind: "risk-assessment-record",
      reference: recordRef,
    };
    const row = await this.#db
      .selectFrom("business.risk_assessment_records")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("record_id", "=", recordRef.entityId)
      .where("version_id", "=", recordRef.versionId)
      .executeTakeFirst();
    if (row === undefined) {
      failResponseLifecycle("response-feedback-actual-assessment-mismatch", targetRef);
    }
    const inputSnapshot = await this.#db
      .selectFrom("business.assessment_input_snapshots")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("input_snapshot_id", "=", row.input_snapshot_id)
      .where("version_id", "=", row.input_snapshot_version_id)
      .executeTakeFirst();
    if (inputSnapshot === undefined) {
      failResponseLifecycle("response-feedback-actual-assessment-mismatch", targetRef);
    }
    const preparationRef = (
      inputSnapshot.snapshot_payload as {
        preparationSnapshotRef?: { reference?: { entityId?: unknown; versionId?: unknown } };
      }
    ).preparationSnapshotRef?.reference;
    if (
      typeof preparationRef?.entityId !== "string" ||
      typeof preparationRef.versionId !== "string"
    ) {
      failResponseLifecycle("response-lifecycle-contract-drift", targetRef);
    }
    const preparation = await this.#db
      .selectFrom("business.assessment_preparation_snapshots")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("snapshot_id", "=", preparationRef.entityId)
      .where("version_id", "=", preparationRef.versionId)
      .executeTakeFirst();
    if (preparation === undefined) {
      failResponseLifecycle("response-feedback-actual-assessment-mismatch", targetRef);
    }
    const record = RiskAssessmentRecordSchema.safeParse(row.record_payload);
    const spatialScopeRef = SpatialScopeRefV1Schema.safeParse(preparation.spatial_scope_ref);
    if (
      !record.success ||
      !spatialScopeRef.success ||
      !authorizedScopeIds.includes(spatialScopeRef.data.reference.entityId)
    ) {
      failResponseLifecycle("response-feedback-actual-assessment-mismatch", targetRef);
    }
    const riskInputKind =
      row.risk_input_kind === "standardized-risk-record" ||
      row.risk_input_kind === "external-risk-event"
        ? row.risk_input_kind
        : undefined;
    const riskInputEntityId = row.risk_record_id ?? row.external_risk_event_id ?? "";
    if (riskInputKind === undefined || riskInputEntityId === "") {
      failResponseLifecycle("response-lifecycle-contract-drift", targetRef);
    }
    return {
      record: record.data,
      riskInput: { kind: riskInputKind, entityId: riskInputEntityId },
      inputSnapshotRef: {
        entityId: row.input_snapshot_id,
        versionId: row.input_snapshot_version_id,
      },
      basisRef: parseBasisReleaseSetRef(inputSnapshot.basis_release_set_ref, targetRef),
      spatialScopeRef: spatialScopeRef.data,
      monitoringSnapshotRefs: parseMonitoringRefs(preparation.monitoring_snapshot_refs, targetRef),
      riskState: {
        likelihoodScore: record.data.likelihoodScore,
        consequenceScore: record.data.consequenceScore,
        riskLevel: record.data.riskLevel,
      },
      indicatorValues: record.data.indicatorResults.map((indicator) => ({
        indicatorItem: indicator.indicatorItem,
        value: indicator.actualValue,
      })),
    };
  }

  /** C25 输入快照只按精确引用读取；找不到即不可枚举失败，不猜 basis。 */
  async readBasisReleaseSetRefForInputSnapshot(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly assessmentInputSnapshotRef: {
      readonly kind: "assessment-input-snapshot";
      readonly reference: VersionReference;
    };
  }): Promise<{
    readonly kind: "assessment-basis-release-set";
    readonly reference: VersionReference;
  }> {
    const targetRef: LifecycleTargetRefV1 = {
      kind: "assessment-input-snapshot",
      reference: input.assessmentInputSnapshotRef.reference,
    };
    const row = await this.#db
      .selectFrom("business.assessment_input_snapshots")
      .select(["basis_release_set_ref"])
      .where("project_id", "=", input.authorization.projectId)
      .where("input_snapshot_id", "=", targetRef.reference.entityId)
      .where("version_id", "=", targetRef.reference.versionId)
      .executeTakeFirst();
    if (row === undefined) {
      failResponseLifecycle("response-deviation-input-unavailable", targetRef);
    }
    return parseBasisReleaseSetRef(row.basis_release_set_ref, targetRef);
  }

  async readBasisMembers(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly basisReleaseSetRef: {
      readonly kind: "assessment-basis-release-set";
      readonly reference: VersionReference;
    };
    readonly definitionTypes: readonly string[];
  }): Promise<readonly ResponseLifecycleBasisMemberV1[]> {
    const authorization = input.authorization;
    const targetRef: LifecycleTargetRefV1 = {
      kind: "assessment-basis-release-set",
      reference: input.basisReleaseSetRef.reference,
    };
    const basisAuthorization = await this.#authorizeFor(
      {
        branch: BASIS_BRANCH_V1,
        invocationId: `${input.requestId}:basis`,
        projectId: authorization.projectId,
        actorId: authorization.actorId,
        requestedAt: input.requestedAt,
        requestedSpatialScopeRefs: [...authorization.spatialScopeRefs],
      },
      "knowledge-modeling.read",
    );
    const basisResult = AssessmentBasisReleaseSetReadResultV1Schema.safeParse(
      await this.#basis.readAssessmentBasisReleaseSet({
        requestId: `${input.requestId}:basis`,
        idempotencyKey: `${input.requestId}:basis`,
        requestedAt: input.requestedAt,
        authorization: basisAuthorization,
        assessmentBasisReleaseSetRef: input.basisReleaseSetRef,
      }),
    );
    if (!basisResult.success) {
      failResponseLifecycle("response-lifecycle-contract-drift", targetRef);
    }
    if (basisResult.data.kind === "unavailable") {
      failResponseLifecycle("response-forecast-policy-unavailable", targetRef);
    }
    if (basisResult.data.kind !== "succeeded") {
      failResponseLifecycle(
        "response-forecast-policy-unavailable",
        targetRef,
        basisResult.data.error.code === "TRANSIENT_FAILURE"
          ? "TRANSIENT_FAILURE"
          : "TERMINAL_FAILURE",
      );
    }
    const configurationAuthorization = await this.#authorizeFor(
      {
        branch: CONFIGURATION_BRANCH_V1,
        invocationId: `${input.requestId}:configuration`,
        projectId: authorization.projectId,
        actorId: authorization.actorId,
        requestedAt: input.requestedAt,
        requestedSpatialScopeRefs: [...authorization.spatialScopeRefs],
      },
      "knowledge-modeling.retrieve",
    );
    const members: ResponseLifecycleBasisMemberV1[] = [];
    for (const definitionType of input.definitionTypes) {
      const member = basisResult.data.configurationMembers.find(
        (candidate) => candidate.definitionType === definitionType,
      );
      if (member === undefined) {
        failResponseLifecycle("response-forecast-policy-unavailable", targetRef);
      }
      const artifactRef = {
        kind: "content-artifact" as const,
        reference: member.artifactRef.reference,
      };
      const document = await this.#readArtifactDocument(
        `${input.requestId}:${definitionType}`,
        input.requestedAt,
        configurationAuthorization,
        artifactRef,
        ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
      );
      if (sha256CanonicalJson(document) !== member.contentDigest) {
        failResponseLifecycle("response-forecast-policy-unavailable", artifactRef);
      }
      members.push({
        member: { definitionType, releaseRef: { reference: member.releaseRef.reference } },
        content: document,
      });
    }
    return members;
  }

  async readMonitoringSnapshot(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly monitoringSnapshotRef: MonitoringSnapshotRefV1;
  }): Promise<MonitoringSnapshotV1> {
    const authorization = input.authorization;
    const targetRef: LifecycleTargetRefV1 = {
      kind: "monitoring-snapshot",
      reference: input.monitoringSnapshotRef.reference,
    };
    const monitoringAuthorization = await this.#authorizeFor(
      {
        branch: MONITORING_BRANCH_V1,
        invocationId: `${input.requestId}:monitoring`,
        projectId: authorization.projectId,
        actorId: authorization.actorId,
        requestedAt: input.requestedAt,
        requestedSpatialScopeRefs: [...authorization.spatialScopeRefs],
      },
      "engineering-data.read",
    );
    const read = await this.#monitoring.readSnapshot({
      kind: "monitoring-snapshot",
      queryId: `${input.requestId}:monitoring`,
      projectId: authorization.projectId,
      actorId: authorization.actorId,
      requestedAt: input.requestedAt,
      authorization: monitoringAuthorization,
      payload: { monitoringSnapshotRef: input.monitoringSnapshotRef },
    });
    if (read.kind !== "succeeded") {
      failResponseLifecycle("response-forecast-input-mismatch", targetRef);
    }
    const resolved = await this.#monitoring.resolveSnapshotQuery({
      queryResultRef: read.result.queryResultRef,
      invocationId: `${input.requestId}:monitoring`,
      projectId: authorization.projectId,
      actorId: authorization.actorId,
      requestedAt: input.requestedAt,
      authorization: monitoringAuthorization,
    });
    if (resolved.kind !== "succeeded" || resolved.result.kind !== "snapshot-query") {
      failResponseLifecycle("response-forecast-input-mismatch", targetRef);
    }
    const snapshot = resolved.result.query.snapshot;
    if (snapshot.projectId !== authorization.projectId) {
      failResponseLifecycle(
        "response-lifecycle-authorization-required",
        targetRef,
        "AUTHORIZATION_DENIED",
      );
    }
    return snapshot;
  }

  async readFeedbackArtifact(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly feedbackArtifactRef: {
      readonly kind: "content-artifact";
      readonly reference: VersionReference;
    };
  }): Promise<unknown> {
    const authorization = input.authorization;
    const artifactAuthorization = await this.#authorizeFor(
      {
        branch: CONFIGURATION_BRANCH_V1,
        invocationId: `${input.requestId}:feedback-artifact`,
        projectId: authorization.projectId,
        actorId: authorization.actorId,
        requestedAt: input.requestedAt,
        requestedSpatialScopeRefs: [...authorization.spatialScopeRefs],
      },
      "knowledge-modeling.retrieve",
    );
    return this.#readArtifactDocument(
      `${input.requestId}:feedback-artifact`,
      input.requestedAt,
      artifactAuthorization,
      input.feedbackArtifactRef,
      FEEDBACK_ARTIFACT_PURPOSE_CODE_V1,
    );
  }

  async #readArtifactDocument(
    readId: string,
    requestedAt: string,
    authorization: AuthorizationContextV1,
    artifactRef: { readonly kind: "content-artifact"; readonly reference: VersionReference },
    purposeCode: string,
  ): Promise<unknown> {
    const handle = await this.#artifactStore.open(
      ArtifactReadRequestV1Schema.parse({
        schemaVersion: "1",
        requestId: readId,
        idempotencyKey: readId,
        artifactRef,
        projectId: authorization.projectId,
        actorId: authorization.actorId,
        requestedAt,
        purposeCode,
        requiredCapability: "knowledge-modeling.retrieve",
        authorization,
      }),
    );
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    for await (const chunk of handle.content) {
      byteLength += chunk.byteLength;
      if (byteLength > MAX_ARTIFACT_BYTES_V1) {
        failResponseLifecycle("response-feedback-artifact-unavailable", artifactRef);
      }
      chunks.push(chunk);
    }
    await handle.verified;
    const buffer = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
    } catch {
      failResponseLifecycle("response-feedback-artifact-unavailable", artifactRef);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 命令 adapter：决定、预测、执行、反馈与私有偏差事实                             */
/* -------------------------------------------------------------------------- */

export interface PostgresResponseLifecycleAdapterOptionsV1 {
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: TransactionUnitV1;
  readonly access: LocalIdentityAccessV1;
  readonly reader: ResponseLifecycleContextReaderV1;
  /** 部署按 `requiredRef` 注入的正式预测执行器；测试夹具不得作为生产实现。 */
  readonly forecastExecutors: readonly EffectForecastExecutorV1[];
  readonly now?: () => Date;
}

export class PostgresResponseLifecycleAdapter
  implements
    ResponseLifecycleServiceV1,
    ResponseDeviationFactReaderV1,
    WarningResponseLifecycleReaderV1
{
  readonly #db: Kysely<ResponseLifecycleDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #access: LocalIdentityAccessV1;
  readonly #reader: ResponseLifecycleContextReaderV1;
  readonly #forecastExecutors: readonly EffectForecastExecutorV1[];
  readonly #now: () => Date;

  constructor(options: PostgresResponseLifecycleAdapterOptionsV1) {
    this.#db = options.db as unknown as Kysely<ResponseLifecycleDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#access = options.access;
    this.#reader = options.reader;
    this.#forecastExecutors = options.forecastExecutors;
    this.#now = options.now ?? (() => new Date());
  }

  // ------------------------------------------------------------- authorization

  #failAuthorization(branch: ModuleBranchV1): never {
    return failResponseLifecycle(
      "response-lifecycle-authorization-required",
      {
        kind: "authorization-context",
        reference: { entityId: `warning-response.unauthorized.${branch}`, versionId: "1" },
      },
      "AUTHORIZATION_DENIED",
    );
  }

  async #verify(
    command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly authorization: AuthorizationContextV1;
    },
    branch: ModuleBranchV1,
  ): Promise<AuthorizationContextV1> {
    const capability = MODULE_BRANCH_CAPABILITY_V1[branch];
    if (
      command.projectId !== command.authorization.projectId ||
      command.actorId !== command.authorization.actorId ||
      !command.authorization.grantedCapabilities.includes(capability)
    ) {
      return this.#failAuthorization(branch);
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
        if (error instanceof AccessServiceError) return this.#failAuthorization(branch);
        throw error;
      });
    if (decision.context.actorId !== command.actorId) {
      return this.#failAuthorization(branch);
    }
    return decision.context;
  }

  /** binding 与命令/上下文逐项一致：工程、建议与授权空间；ref 形态由 strict Schema 保证。 */
  #assertBinding(
    binding: VerifiedResponseWorkflowBindingV1,
    command: { readonly projectId: string },
    verified: AuthorizationContextV1,
    targetRef: LifecycleTargetRefV1,
  ): void {
    if (
      binding.projectId !== command.projectId ||
      !sameRef(binding.responseRecommendationRef.reference, targetRef.reference)
    ) {
      failResponseLifecycle("response-binding-mismatch", targetRef);
    }
    if (
      !verified.spatialScopeRefs.some((scope) =>
        sameRef(scope.reference, binding.spatialScopeRef.reference),
      )
    ) {
      failResponseLifecycle(
        "response-lifecycle-authorization-required",
        targetRef,
        "AUTHORIZATION_DENIED",
      );
    }
  }

  // -------------------------------------------------------------- recordDecision

  async recordDecision(command: unknown): Promise<WarningResponseRecordResultV1> {
    const parsed = ResponseAdoptionDecisionCommandV1Schema.safeParse(command);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: this.#terminalError("unknown", ADOPTION_COMMAND_KIND_V1),
      };
    }
    const binding = parsed.data.binding;
    const publicCommand = parsed.data.command as AdoptRecommendationCommandV1;
    try {
      const verified = await this.#verify(publicCommand, ADOPTION_BRANCH_V1);
      const targetRef = publicCommand.payload.responseRecommendationRef;
      this.#assertBinding(binding, publicCommand, verified, targetRef);
      const context = await this.#reader.readRecommendationContext({
        requestId: publicCommand.commandId,
        requestedAt: publicCommand.issuedAt,
        authorization: verified,
        responseRecommendationRef: targetRef,
      });
      if (!sameRef(context.spatialScopeRef.reference, binding.spatialScopeRef.reference)) {
        failResponseLifecycle("response-binding-mismatch", targetRef);
      }
      const decidedAt = this.#nowIso();
      const decision = ResponseAdoptionDecisionV1Schema.parse({
        schemaVersion: "1",
        projectId: publicCommand.projectId,
        routeDecisionRef: binding.routeDecisionRef,
        responseRecommendationRef: targetRef,
        decision: publicCommand.payload.decision,
        reasonCode: publicCommand.payload.reasonCode,
        forecastRunRef: binding.forecastRunRef,
        spatialScopeRef: context.spatialScopeRef,
        decidedBy: verified.actorId,
        decidedAt,
      });
      const contentDigest = sha256CanonicalJson(decision);
      const atomic = this.#atomicCommand(publicCommand, ADOPTION_COMMAND_KIND_V1, parsed.data);
      const receipt = await this.#executeWithRetry(
        atomic,
        async (transactionContext): Promise<AtomicCommitV1> => {
          const transaction = asTransaction(transactionContext);
          const auditEntryId = `audit-${publicCommand.commandId}:response-adoption-decision`;
          await transaction
            .insertInto("business.response_adoption_decisions")
            .values({
              decision_id: binding.routeDecisionRef.reference.entityId,
              version_id: binding.routeDecisionRef.reference.versionId,
              schema_version: "1",
              project_id: publicCommand.projectId,
              recommendation_id: targetRef.reference.entityId,
              recommendation_version_id: targetRef.reference.versionId,
              decision: decision.decision,
              reason_code: decision.reasonCode,
              forecast_run_id: binding.forecastRunRef.reference.entityId,
              forecast_run_version_id: binding.forecastRunRef.reference.versionId,
              spatial_scope_entity_id: context.spatialScopeRef.reference.entityId,
              spatial_scope_version_id: context.spatialScopeRef.reference.versionId,
              decided_by: verified.actorId,
              decision_payload: jsonValue(decision),
              content_digest: contentDigest,
              command_id: atomic.commandId,
              idempotency_key: publicCommand.idempotencyKey,
              actor_ref: verified.actorId,
              authorization_context_ref: jsonValue(
                publicCommand.authorization.authorizationContextRef,
              ),
              audit_entry_id: auditEntryId,
              occurred_at: publicCommand.issuedAt,
              recorded_at: decidedAt,
            } as never)
            .onConflict((conflict) => conflict.doNothing())
            .execute();
          const stored = await transaction
            .selectFrom("business.response_adoption_decisions")
            .selectAll()
            .where("project_id", "=", publicCommand.projectId)
            .where("recommendation_id", "=", targetRef.reference.entityId)
            .where("recommendation_version_id", "=", targetRef.reference.versionId)
            .executeTakeFirst();
          // 同一建议精确版本只能有一个终局决定；并发或重复决定在此收口。
          if (
            stored === undefined ||
            stored.decision !== decision.decision ||
            stored.content_digest !== contentDigest
          ) {
            failResponseLifecycle("response-decision-conflict", {
              kind: "response-recommendation",
              reference: targetRef.reference,
            });
          }
          return {
            resultRef: binding.routeDecisionRef,
            audit: {
              auditEntryId,
              projectId: publicCommand.projectId,
              action: "warning-response.adopt-recommendation",
              targetRef,
              actorRef: verified.actorId,
              authorizationContextRef: publicCommand.authorization.authorizationContextRef,
              occurredAt: publicCommand.issuedAt,
              recordedAt: decidedAt,
              version: { entityId: auditEntryId, versionId: "1" },
              commandId: atomic.commandId,
              idempotencyKey: publicCommand.idempotencyKey,
            },
            events: [],
          };
        },
      );
      return WarningResponseRecordResultV1Schema.parse({
        kind: "succeeded",
        result: {
          kind: "adoption",
          routeDecisionRef: receipt.resultRef,
          forecastRunRef: binding.forecastRunRef,
        },
      });
    } catch (error: unknown) {
      return { kind: "failed", error: this.#toModuleError(error, publicCommand.commandId) };
    }
  }

  // ------------------------------------------------------------ forecastResponse

  async forecastResponse(command: unknown): Promise<ResponseForecastResultV1> {
    const parsed = ForecastResponseCommandV1Schema.safeParse(command);
    if (!parsed.success) {
      return { kind: "failed", error: this.#terminalError("unknown", FORECAST_COMMAND_KIND_V1) };
    }
    const valid = parsed.data;
    const binding = valid.payload.binding;
    const snapshot = valid.payload.forecastInputSnapshot;
    const targetRef = snapshot.responseRecommendationRef;
    try {
      const verified = await this.#verify(valid, ADOPTION_BRANCH_V1);
      // C30 冻结且不扩大的授权：快照必须由同一次已验证授权与同一路由决定形成。
      if (
        !sameRef(
          snapshot.authorizationContextRef.reference,
          valid.authorization.authorizationContextRef.reference,
        ) ||
        !sameRef(snapshot.adoptionDecisionRef.reference, binding.routeDecisionRef.reference)
      ) {
        failResponseLifecycle("response-forecast-input-mismatch", targetRef);
      }
      this.#assertBinding(binding, valid, verified, targetRef);
      const authorizedScopeIds = verified.spatialScopeRefs.map((scope) => scope.reference.entityId);
      const decision = await this.#loadDecision(valid.projectId, targetRef, authorizedScopeIds);
      if (decision === undefined || decision.decision !== "adopted") {
        failResponseLifecycle("response-recommendation-not-adopted", targetRef);
      }
      if (
        !sameRef(
          { entityId: decision.decision_id, versionId: decision.version_id },
          binding.routeDecisionRef.reference,
        )
      ) {
        failResponseLifecycle("response-binding-mismatch", targetRef);
      }
      const context = await this.#reader.readRecommendationContext({
        requestId: valid.commandId,
        requestedAt: valid.issuedAt,
        authorization: verified,
        responseRecommendationRef: targetRef,
      });
      // 冻结评估依据必须正是建议链基线评估的 C25 输入快照，不接受其它快照或最新依据。
      if (
        !sameRef(context.spatialScopeRef.reference, binding.spatialScopeRef.reference) ||
        !sameRef(
          context.baselineAssessmentInputSnapshotRef.reference,
          snapshot.frozenAssessmentBasisRef.reference,
        )
      ) {
        failResponseLifecycle("response-binding-mismatch", targetRef);
      }
      const members = await this.#reader.readBasisMembers({
        requestId: valid.commandId,
        requestedAt: valid.issuedAt,
        authorization: verified,
        basisReleaseSetRef: context.basisReleaseSetRef,
        definitionTypes: [...FORECAST_POLICY_MEMBER_TYPES_V1],
      });
      const policyMember = memberDocument(
        members,
        "forecast-policy",
        ForecastPolicyDocumentV1Schema,
        targetRef,
      );
      if (!sameRef(snapshot.forecastPolicyRef, policyMember.releaseRef)) {
        failResponseLifecycle("response-forecast-policy-mismatch", targetRef);
      }
      const matrixMember = memberDocument(
        members,
        "risk-matrix",
        RiskMatrixDocumentV1Schema,
        targetRef,
      );
      const indicatorMember = memberDocument(
        members,
        "indicator-system",
        IndicatorSystemDocumentV1Schema,
        targetRef,
      );
      const targetIndicators = new Set(
        context.record.targetIndicators.map((entry) => entry.indicatorItem),
      );
      const matched = policyMember.document.content.policies.filter((policy) =>
        targetIndicators.has(policy.targetIndicatorId),
      );
      if (matched.length > 1) {
        failResponseLifecycle("response-forecast-policy-mismatch", targetRef);
      }
      const policy = matched[0];
      if (policy === undefined) {
        return await this.#persistForecast({
          valid,
          verified,
          binding,
          context,
          reasonCode: "policy-unavailable",
          resolution: "policy-unavailable",
        });
      }
      const policyUnit = indicatorUnitOf(
        indicatorMember.document.content.indicators,
        policy.targetIndicatorId,
      );
      if (policyUnit === undefined || policyUnit !== policy.unit) {
        return await this.#persistForecast({
          valid,
          verified,
          binding,
          context,
          reasonCode: "target-indicator-unsupported",
          resolution: `target-indicator-unsupported:${policy.targetIndicatorId}`,
        });
      }
      const preActionSnapshot = await this.#reader.readMonitoringSnapshot({
        requestId: `${valid.commandId}:pre-action`,
        requestedAt: valid.issuedAt,
        authorization: verified,
        monitoringSnapshotRef: snapshot.preActionMonitoringSnapshotRef,
      });
      if (preActionSnapshot.availability === "unavailable") {
        return await this.#persistForecast({
          valid,
          verified,
          binding,
          context,
          reasonCode: "monitoring-snapshot-unavailable",
          resolution: `monitoring-snapshot-unavailable:${refKey(snapshot.preActionMonitoringSnapshotRef.reference)}`,
        });
      }
      if (
        policy.inputIndicatorIds.some(
          (indicatorId) =>
            !context.baseline.indicatorValues.some((entry) => entry.indicatorItem === indicatorId),
        )
      ) {
        return await this.#persistForecast({
          valid,
          verified,
          binding,
          context,
          reasonCode: "input-indicator-missing",
          resolution: `input-indicator-missing:${policy.policyId}`,
        });
      }
      const executor = this.#forecastExecutors.find(
        (candidate) =>
          candidate.method === policy.method && sameRef(candidate.requiredRef, policy.requiredRef),
      );
      if (executor === undefined) {
        return await this.#persistForecast({
          valid,
          verified,
          binding,
          context,
          reasonCode: "executor-unavailable",
          resolution: `executor-unavailable:${policy.method}:${refKey(policy.requiredRef)}`,
        });
      }
      const request: ResponseForecastExecutorRequestV1 = {
        commandId: valid.commandId,
        projectId: valid.projectId,
        issuedAt: valid.issuedAt,
        idempotencyKey: valid.idempotencyKey,
        authorization: verified,
        snapshot,
        policy,
        baseline: {
          ...context.baseline,
          indicatorValues: context.baseline.indicatorValues.map((entry) => {
            const unit = indicatorUnitOf(
              indicatorMember.document.content.indicators,
              entry.indicatorItem,
            );
            return { ...entry, ...(unit === undefined ? {} : { unit }) };
          }),
        },
        monitoringSnapshot: preActionSnapshot,
        // 正式措施按已采纳建议的 measureItems 下发，模型只能按这些 measureId 给效果。
        adoptedMeasures: context.record.measureItems,
        measureLibraryReleaseRef: context.measureLibraryReleaseRef,
        baselineAssessmentRecordRef: context.baselineAssessmentRecordRef,
      };
      const rawOutcome = await executor.forecast(request);
      const executorOutcome = EffectForecastExecutorOutcomeV1Schema.safeParse(rawOutcome);
      if (!executorOutcome.success) {
        failResponseLifecycle("response-forecast-result-invalid", {
          kind: "effect-forecast",
          reference: { entityId: valid.commandId, versionId: "1" },
        });
      }
      if (executorOutcome.data.kind === "unavailable") {
        return await this.#persistForecast({
          valid,
          verified,
          binding,
          context,
          reasonCode: executorOutcome.data.reasonCode,
          resolution: [
            "policy",
            policy.method,
            refKey(policy.requiredRef),
            policy.targetIndicatorId,
            policy.unit,
            String(policy.horizonSteps),
            executorOutcome.data.reasonCode,
          ].join(":"),
        });
      }
      const execution = verifyForecastExecutorResult({
        method: policy.method,
        requiredRef: policy.requiredRef,
        targetIndicatorId: policy.targetIndicatorId,
        unit: policy.unit,
        horizonSteps: policy.horizonSteps,
        riskLevelIds: matrixMember.document.content.riskLevels.map((level) => level.levelId),
        result: executorOutcome.data.result,
      });
      if (execution.kind === "invalid") {
        failResponseLifecycle("response-forecast-result-invalid", {
          kind: "effect-forecast",
          reference: { entityId: execution.reasonCode, versionId: "1" },
        });
      }
      const outcome = execution.result;
      // 执行器只读不写：只有 validated available outcome 进入 C28 原事务。
      return await this.#persistForecast({
        valid,
        verified,
        binding,
        context,
        policy,
        resolution: [
          "policy",
          policy.method,
          refKey(policy.requiredRef),
          policy.targetIndicatorId,
          policy.unit,
          String(policy.horizonSteps),
        ].join(":"),
        projected: {
          predictedValue: outcome.predictedValue,
          predictedRiskState: outcome.predictedRiskState,
          evidenceReferences: [...outcome.evidenceReferences],
          summary: outcome.summary,
        },
      });
    } catch (error: unknown) {
      const moduleError = ModuleErrorV1Schema.safeParse(error);
      return {
        kind: "failed",
        error: moduleError.success ? moduleError.data : this.#toModuleError(error, valid.commandId),
      };
    }
  }

  /** available / unavailable 都耐久且幂等：同一冻结输入与解析结论对应同一预测事实。 */
  async #persistForecast(input: {
    readonly valid: {
      readonly commandId: string;
      readonly idempotencyKey: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly issuedAt: string;
      readonly authorization: AuthorizationContextV1;
      readonly payload: {
        readonly forecastInputSnapshotRef: { readonly reference: VersionReference };
        readonly forecastInputSnapshot: {
          readonly responseRecommendationRef: { readonly reference: VersionReference };
          readonly frozenAssessmentBasisRef: { readonly reference: VersionReference };
          readonly preActionMonitoringSnapshotRef: { readonly reference: VersionReference };
          readonly forecastPolicyRef: VersionReference;
        };
      };
    };
    readonly verified: AuthorizationContextV1;
    readonly binding: VerifiedResponseWorkflowBindingV1;
    readonly context: ResponseLifecycleFrozenContextV1;
    readonly policy?: ForecastPolicyV1;
    readonly reasonCode?: string;
    readonly resolution: string;
    readonly projected?: ResponseForecastProjectionV1;
  }): Promise<ResponseForecastResultV1> {
    const { valid, verified, binding, context, policy, projected } = input;
    const snapshot = valid.payload.forecastInputSnapshot;
    const inputDigest = responseForecastInputDigest({
      projectId: valid.projectId,
      forecastInputSnapshotRef: valid.payload.forecastInputSnapshotRef.reference,
      responseRecommendationRef: snapshot.responseRecommendationRef.reference,
      routeDecisionRef: binding.routeDecisionRef.reference,
      frozenAssessmentBasisRef: snapshot.frozenAssessmentBasisRef.reference,
      preActionMonitoringSnapshotRef: snapshot.preActionMonitoringSnapshotRef.reference,
      forecastPolicyRef: snapshot.forecastPolicyRef,
      requiredRef: policy?.requiredRef ?? snapshot.forecastPolicyRef,
      method: input.resolution,
      targetIndicatorId: policy?.targetIndicatorId ?? "unresolved",
      unit: policy?.unit ?? "unresolved",
      horizonSteps: policy?.horizonSteps ?? 1,
    });
    const effectForecastRef = effectForecastRefOf(inputDigest);
    const availability: ResponseForecastAvailabilityV1 =
      projected === undefined
        ? { kind: "unavailable", reasonCode: input.reasonCode ?? NO_EFFECT_FORECAST_REASON_V1 }
        : { kind: "available", effectForecastRef };
    const outcome = ResponseForecastOutcomeV1Schema.parse({
      schemaVersion: "1",
      projectId: valid.projectId,
      effectForecastRef,
      responseRecommendationRef: snapshot.responseRecommendationRef,
      routeDecisionRef: binding.routeDecisionRef,
      forecastRunRef: binding.forecastRunRef,
      forecastInputSnapshotRef: valid.payload.forecastInputSnapshotRef,
      frozenAssessmentBasisRef: snapshot.frozenAssessmentBasisRef,
      preActionMonitoringSnapshotRef: snapshot.preActionMonitoringSnapshotRef,
      baselineAssessmentRecordRef: context.baselineAssessmentRecordRef,
      forecastPolicyRef: snapshot.forecastPolicyRef,
      requiredRef: policy?.requiredRef ?? snapshot.forecastPolicyRef,
      method: policy?.method ?? "historical-statistics",
      targetIndicatorId: policy?.targetIndicatorId ?? "unresolved",
      unit: policy?.unit ?? "unresolved",
      horizonSteps: policy?.horizonSteps ?? 1,
      inputDigest,
      availability,
      ...(projected === undefined
        ? {
            projected: {
              kind: "unavailable",
              reasonCode:
                availability.kind === "unavailable"
                  ? availability.reasonCode
                  : NO_EFFECT_FORECAST_REASON_V1,
            },
          }
        : { projected: { kind: "available", ...projected } }),
      spatialScopeRef: context.spatialScopeRef,
      computedBy: verified.actorId,
      computedAt: this.#nowIso(),
    });
    const contentDigest = sha256CanonicalJson(outcome);
    const recordedAt = this.#nowIso();
    const atomic = this.#atomicCommand(valid, FORECAST_COMMAND_KIND_V1, valid);
    await this.#executeWithRetry(atomic, async (transactionContext): Promise<AtomicCommitV1> => {
      const transaction = asTransaction(transactionContext);
      const auditEntryId = `audit-${valid.commandId}:response-forecast`;
      await transaction
        .insertInto("business.response_forecast_outcomes")
        .values({
          forecast_id: effectForecastRef.reference.entityId,
          version_id: effectForecastRef.reference.versionId,
          schema_version: "1",
          project_id: valid.projectId,
          recommendation_id: outcome.responseRecommendationRef.reference.entityId,
          recommendation_version_id: outcome.responseRecommendationRef.reference.versionId,
          route_decision_id: binding.routeDecisionRef.reference.entityId,
          route_decision_version_id: binding.routeDecisionRef.reference.versionId,
          forecast_run_id: binding.forecastRunRef.reference.entityId,
          forecast_run_version_id: binding.forecastRunRef.reference.versionId,
          forecast_input_snapshot_id: outcome.forecastInputSnapshotRef.reference.entityId,
          forecast_input_snapshot_version_id: outcome.forecastInputSnapshotRef.reference.versionId,
          frozen_basis_snapshot_id: outcome.frozenAssessmentBasisRef.reference.entityId,
          frozen_basis_snapshot_version_id: outcome.frozenAssessmentBasisRef.reference.versionId,
          pre_action_snapshot_id: outcome.preActionMonitoringSnapshotRef.reference.entityId,
          pre_action_snapshot_version_id:
            outcome.preActionMonitoringSnapshotRef.reference.versionId,
          baseline_assessment_record_id: outcome.baselineAssessmentRecordRef.reference.entityId,
          baseline_assessment_record_version_id:
            outcome.baselineAssessmentRecordRef.reference.versionId,
          forecast_policy_entity_id: outcome.forecastPolicyRef.entityId,
          forecast_policy_version_id: outcome.forecastPolicyRef.versionId,
          method: policy?.method ?? null,
          required_ref_entity_id: policy?.requiredRef.entityId ?? null,
          required_ref_version_id: policy?.requiredRef.versionId ?? null,
          target_indicator_id: policy?.targetIndicatorId ?? null,
          unit: policy?.unit ?? null,
          horizon_steps: policy?.horizonSteps ?? null,
          availability: availability.kind,
          unavailable_reason: availability.kind === "unavailable" ? availability.reasonCode : null,
          predicted_value_canonical:
            outcome.projected?.kind === "available" ? outcome.projected.predictedValue : null,
          predicted_risk_state:
            outcome.projected?.kind === "available"
              ? jsonValue(outcome.projected.predictedRiskState)
              : null,
          evidence_references:
            outcome.projected?.kind === "available"
              ? jsonValue(outcome.projected.evidenceReferences)
              : null,
          summary: outcome.projected?.kind === "available" ? outcome.projected.summary : null,
          input_digest: inputDigest,
          content_digest: contentDigest,
          forecast_payload: jsonValue(outcome),
          spatial_scope_entity_id: outcome.spatialScopeRef.reference.entityId,
          spatial_scope_version_id: outcome.spatialScopeRef.reference.versionId,
          command_id: atomic.commandId,
          idempotency_key: valid.idempotencyKey,
          actor_ref: verified.actorId,
          authorization_context_ref: jsonValue(valid.authorization.authorizationContextRef),
          audit_entry_id: auditEntryId,
          computed_at: outcome.computedAt,
          recorded_at: recordedAt,
        } as never)
        .onConflict((conflict) => conflict.doNothing())
        .execute();
      return {
        resultRef: effectForecastRef,
        audit: {
          auditEntryId,
          projectId: valid.projectId,
          action: FORECAST_COMMAND_KIND_V1,
          targetRef: effectForecastRef,
          actorRef: verified.actorId,
          authorizationContextRef: valid.authorization.authorizationContextRef,
          occurredAt: valid.issuedAt,
          recordedAt,
          version: { entityId: auditEntryId, versionId: "1" },
          commandId: atomic.commandId,
          idempotencyKey: valid.idempotencyKey,
        },
        events: [],
      };
    });
    const persisted = await this.#loadForecastOutcome(valid.projectId, effectForecastRef.reference);
    const stored =
      persisted === undefined
        ? outcome
        : parseForecastOutcome(persisted, effectForecastRef.reference);
    return ResponseForecastResultV1Schema.parse({
      kind: "succeeded",
      result: { outcome: stored },
    });
  }

  // ------------------------------------------------------------- recordExecution

  async recordExecution(
    command: WarningResponseRecordCommandV1,
  ): Promise<WarningResponseRecordResultV1> {
    const parsed = WarningResponseRecordCommandV1Schema.safeParse(command);
    if (!parsed.success || parsed.data.kind !== "record-execution") {
      return { kind: "failed", error: this.#terminalError("unknown", EXECUTION_COMMAND_KIND_V1) };
    }
    const valid = parsed.data;
    const payload = valid.payload;
    try {
      const verified = await this.#verify(valid, EXECUTION_BRANCH_V1);
      const authorizedScopeIds = verified.spatialScopeRefs.map((scope) => scope.reference.entityId);
      if (payload.recordedByActorId !== verified.actorId) {
        failResponseLifecycle("response-execution-source-invalid", {
          kind: "execution-record",
          reference: { entityId: valid.commandId, versionId: "1" },
        });
      }
      const adoptedSource =
        payload.actionSource.kind === "adopted-recommendation" ? payload.actionSource : undefined;
      const context =
        adoptedSource === undefined
          ? undefined
          : await this.#reader.readRecommendationContext({
              requestId: valid.commandId,
              requestedAt: valid.issuedAt,
              authorization: verified,
              responseRecommendationRef: adoptedSource.responseRecommendationRef,
            });
      let spatialScopeRef = verified.spatialScopeRefs[0]!;
      let source: ResponseExecutionRecordV1["source"];
      if (adoptedSource !== undefined && context !== undefined) {
        const decision = await this.#loadDecision(
          valid.projectId,
          adoptedSource.responseRecommendationRef,
          authorizedScopeIds,
        );
        if (decision === undefined || decision.decision !== "adopted") {
          failResponseLifecycle(
            "response-execution-source-invalid",
            adoptedSource.responseRecommendationRef,
          );
        }
        const decisionPayload = ResponseAdoptionDecisionV1Schema.safeParse(
          decision.decision_payload,
        );
        if (!decisionPayload.success) {
          failResponseLifecycle(
            "response-lifecycle-contract-drift",
            adoptedSource.responseRecommendationRef,
          );
        }
        // 发生时间不得早于采纳决定：执行是决定之后的独立事实。
        if (Date.parse(payload.occurredAt) < Date.parse(decisionPayload.data.decidedAt)) {
          failResponseLifecycle(
            "response-execution-source-invalid",
            adoptedSource.responseRecommendationRef,
          );
        }
        spatialScopeRef = context.spatialScopeRef;
        source = {
          kind: "adopted-recommendation",
          responseRecommendationRef: adoptedSource.responseRecommendationRef,
          routeDecisionRef: {
            kind: "route-decision",
            reference: { entityId: decision.decision_id, versionId: decision.version_id },
          },
        };
      } else {
        const releases =
          payload.actionSource.kind === "independent-action"
            ? payload.actionSource.measureReleaseRefs
            : [];
        const published = await this.#reader.readPublishedMeasureReleases({
          requestId: `${valid.commandId}:measure-releases`,
          requestedAt: valid.issuedAt,
          authorization: verified,
          measureLibraryReleaseRefs: releases.map((release) => release.reference),
        });
        const publishedKeys = new Set(published.map((release) => refKey(release)));
        for (const release of releases) {
          if (!publishedKeys.has(refKey(release.reference))) {
            failResponseLifecycle("response-measure-release-unavailable", release);
          }
        }
        source = { kind: "independent-action", measureReleaseRefs: releases };
      }
      const inputDigest = responseExecutionDigest({
        projectId: valid.projectId,
        source,
        executedByActorId: payload.executedByActorId,
        recordedByActorId: payload.recordedByActorId,
        occurredAt: payload.occurredAt,
        evidenceReferences: payload.evidenceReferences,
      });
      const executionRecordRef = executionRecordRefOf(inputDigest);
      const record = ResponseExecutionRecordV1Schema.parse({
        schemaVersion: "1",
        projectId: valid.projectId,
        executionRecordRef,
        source,
        executedByActorId: payload.executedByActorId,
        recordedByActorId: payload.recordedByActorId,
        spatialScopeRef,
        occurredAt: payload.occurredAt,
        evidenceReferences: [...payload.evidenceReferences],
      });
      const contentDigest = sha256CanonicalJson(record);
      const recordedAt = this.#nowIso();
      const atomic = this.#atomicCommand(valid, EXECUTION_COMMAND_KIND_V1, valid);
      await this.#executeWithRetry(atomic, async (transactionContext): Promise<AtomicCommitV1> => {
        const transaction = asTransaction(transactionContext);
        const auditEntryId = `audit-${valid.commandId}:response-execution`;
        await transaction
          .insertInto("business.response_execution_records")
          .values({
            execution_id: executionRecordRef.reference.entityId,
            version_id: executionRecordRef.reference.versionId,
            schema_version: "1",
            project_id: valid.projectId,
            source_kind: source.kind,
            recommendation_id:
              source.kind === "adopted-recommendation"
                ? source.responseRecommendationRef.reference.entityId
                : null,
            recommendation_version_id:
              source.kind === "adopted-recommendation"
                ? source.responseRecommendationRef.reference.versionId
                : null,
            route_decision_id:
              source.kind === "adopted-recommendation"
                ? source.routeDecisionRef.reference.entityId
                : null,
            route_decision_version_id:
              source.kind === "adopted-recommendation"
                ? source.routeDecisionRef.reference.versionId
                : null,
            measure_release_refs:
              source.kind === "independent-action" ? jsonValue(source.measureReleaseRefs) : null,
            executed_by_actor_id: payload.executedByActorId,
            recorded_by_actor_id: payload.recordedByActorId,
            spatial_scope_entity_id: spatialScopeRef.reference.entityId,
            spatial_scope_version_id: spatialScopeRef.reference.versionId,
            occurred_at: payload.occurredAt,
            evidence_references: jsonValue(payload.evidenceReferences),
            execution_payload: jsonValue(record),
            content_digest: contentDigest,
            command_id: atomic.commandId,
            idempotency_key: valid.idempotencyKey,
            actor_ref: verified.actorId,
            authorization_context_ref: jsonValue(valid.authorization.authorizationContextRef),
            audit_entry_id: auditEntryId,
            recorded_at: recordedAt,
          } as never)
          .onConflict((conflict) => conflict.doNothing())
          .execute();
        return {
          resultRef: executionRecordRef,
          audit: {
            auditEntryId,
            projectId: valid.projectId,
            action: EXECUTION_COMMAND_KIND_V1,
            targetRef: executionRecordRef,
            actorRef: verified.actorId,
            authorizationContextRef: valid.authorization.authorizationContextRef,
            occurredAt: valid.issuedAt,
            recordedAt,
            version: { entityId: auditEntryId, versionId: "1" },
            commandId: atomic.commandId,
            idempotencyKey: valid.idempotencyKey,
          },
          events: [],
        };
      });
      return WarningResponseRecordResultV1Schema.parse({
        kind: "succeeded",
        result: { kind: "execution", executionRecordRef },
      });
    } catch (error: unknown) {
      return { kind: "failed", error: this.#toModuleError(error, valid.commandId) };
    }
  }

  // -------------------------------------------------------------- recordFeedback

  async recordFeedback(command: unknown): Promise<WarningResponseRecordResultV1> {
    const parsed = ResponseFeedbackCommandV1Schema.safeParse(command);
    if (!parsed.success) {
      return { kind: "failed", error: this.#terminalError("unknown", FEEDBACK_COMMAND_KIND_V1) };
    }
    const valid = parsed.data;
    const publicCommand = valid.command as RecordFeedbackCommandV1;
    const payload = publicCommand.payload;
    try {
      const verified = await this.#verify(publicCommand, FEEDBACK_BRANCH_V1);
      const authorizedScopeIds = verified.spatialScopeRefs.map((scope) => scope.reference.entityId);
      if (
        !sameRef(
          valid.feedbackInputSnapshot.authorizationContextRef.reference,
          publicCommand.authorization.authorizationContextRef.reference,
        )
      ) {
        failResponseLifecycle(
          "response-lifecycle-authorization-required",
          payload.executionRecordRef,
          "AUTHORIZATION_DENIED",
        );
      }
      if (
        !sameRef(
          payload.executionRecordRef.reference,
          valid.feedbackInputSnapshot.executionRecordRef.reference,
        )
      ) {
        failResponseLifecycle("response-feedback-chain-mismatch", payload.executionRecordRef);
      }
      const execution = await this.#loadExecution(
        publicCommand.projectId,
        payload.executionRecordRef.reference,
        authorizedScopeIds,
      );
      if (execution === undefined) {
        failResponseLifecycle(
          "response-lifecycle-authorization-required",
          payload.executionRecordRef,
          "AUTHORIZATION_DENIED",
        );
      }
      const postSnapshot = await this.#reader.readMonitoringSnapshot({
        requestId: `${publicCommand.commandId}:post-action`,
        requestedAt: publicCommand.issuedAt,
        authorization: verified,
        monitoringSnapshotRef: payload.postActionMonitoringSnapshotRef,
      });
      // 执行后事实必须晚于执行时点：监测 cutoff 与反馈发生时间都不早于执行。
      if (
        Date.parse(postSnapshot.cutoff) < Date.parse(execution.occurred_at.toISOString()) ||
        Date.parse(payload.occurredAt) < Date.parse(execution.occurred_at.toISOString())
      ) {
        failResponseLifecycle(
          "response-feedback-chain-mismatch",
          payload.postActionMonitoringSnapshotRef,
        );
      }
      await this.#reader.readFeedbackArtifact({
        requestId: publicCommand.commandId,
        requestedAt: publicCommand.issuedAt,
        authorization: verified,
        feedbackArtifactRef: payload.feedbackArtifactRef,
      });
      const assessment = await this.#reader.readAssessmentChain({
        requestId: `${publicCommand.commandId}:actual-assessment`,
        requestedAt: publicCommand.issuedAt,
        authorization: verified,
        assessmentRecordRef: valid.actualAssessmentRecordRef,
      });
      if (
        assessment.spatialScopeRef.reference.entityId !== execution.spatial_scope_entity_id ||
        !assessment.monitoringSnapshotRefs.some((ref) =>
          sameRef(ref.reference, payload.postActionMonitoringSnapshotRef.reference),
        )
      ) {
        failResponseLifecycle("response-feedback-chain-mismatch", valid.actualAssessmentRecordRef);
      }
      const adoptedChain =
        execution.recommendation_id === null
          ? undefined
          : await this.#reader.readRecommendationContext({
              requestId: `${publicCommand.commandId}:chain`,
              requestedAt: publicCommand.issuedAt,
              authorization: verified,
              responseRecommendationRef: {
                kind: "response-recommendation",
                reference: {
                  entityId: execution.recommendation_id,
                  versionId: execution.recommendation_version_id ?? "",
                },
              },
            });
      // 实际评估必须与原风险输入和冻结评估依据相容。
      if (
        adoptedChain !== undefined &&
        (!sameRef(adoptedChain.basisReleaseSetRef.reference, assessment.basisRef.reference) ||
          adoptedChain.riskInputRef.reference.entityId !== assessment.riskInput.entityId ||
          adoptedChain.riskInputRef.kind !== assessment.riskInput.kind)
      ) {
        failResponseLifecycle(
          "response-feedback-actual-assessment-mismatch",
          valid.actualAssessmentRecordRef,
        );
      }
      const forecast = await this.#resolveFeedbackForecast({
        projectId: publicCommand.projectId,
        execution,
        snapshotForecastRef: valid.feedbackInputSnapshot.effectForecastRef?.reference,
        authorizedScopeIds,
      });
      const feedbackRef = valid.feedbackInputSnapshot.feedbackRef;
      const recordedAt = this.#nowIso();
      const record = ResponseFeedbackRecordV1Schema.parse({
        schemaVersion: "1",
        projectId: publicCommand.projectId,
        feedbackRef,
        executionRecordRef: payload.executionRecordRef,
        postActionMonitoringSnapshotRef: payload.postActionMonitoringSnapshotRef,
        feedbackArtifactRef: payload.feedbackArtifactRef,
        actualAssessmentRecordRef: valid.actualAssessmentRecordRef,
        forecast,
        spatialScopeRef: {
          kind: "spatial-scope",
          reference: {
            entityId: execution.spatial_scope_entity_id,
            versionId: execution.spatial_scope_version_id,
          },
        },
        occurredAt: payload.occurredAt,
        recordedAt,
        recordedBy: verified.actorId,
      });
      const contentDigest = sha256CanonicalJson(record);
      const atomic = this.#atomicCommand(publicCommand, FEEDBACK_COMMAND_KIND_V1, valid);
      const event = DomainEventV1Schema.parse({
        schemaVersion: "1",
        eventId: `warning-feedback-recorded-${feedbackRef.reference.entityId}-${feedbackRef.reference.versionId}`,
        eventVersion: 1,
        eventType: "warning.feedback-recorded.v1",
        projectId: publicCommand.projectId,
        aggregateRef: payload.executionRecordRef,
        occurredAt: payload.occurredAt,
        recordedAt,
        causationId: publicCommand.commandId,
        correlationId: `warning-feedback-recorded-${publicCommand.commandId}`,
        producerCommandId: atomic.commandId,
        idempotencyKey: publicCommand.idempotencyKey,
        authorizationContextRef: publicCommand.authorization.authorizationContextRef,
        auditTrailRef: {
          kind: "audit-trail",
          reference: {
            entityId: `audit-${publicCommand.commandId}:response-feedback`,
            versionId: "1",
          },
        },
        payload: {
          executionRecordRef: payload.executionRecordRef,
          feedbackRef,
          forecast,
        },
      });
      await this.#executeWithRetry(atomic, async (transactionContext): Promise<AtomicCommitV1> => {
        const transaction = asTransaction(transactionContext);
        const auditEntryId = `audit-${publicCommand.commandId}:response-feedback`;
        await transaction
          .insertInto("business.response_feedback_records")
          .values({
            feedback_id: feedbackRef.reference.entityId,
            version_id: feedbackRef.reference.versionId,
            schema_version: "1",
            project_id: publicCommand.projectId,
            execution_id: record.executionRecordRef.reference.entityId,
            execution_version_id: record.executionRecordRef.reference.versionId,
            post_action_snapshot_id: record.postActionMonitoringSnapshotRef.reference.entityId,
            post_action_snapshot_version_id:
              record.postActionMonitoringSnapshotRef.reference.versionId,
            feedback_artifact_id: record.feedbackArtifactRef.reference.entityId,
            feedback_artifact_version_id: record.feedbackArtifactRef.reference.versionId,
            actual_assessment_record_id: record.actualAssessmentRecordRef.reference.entityId,
            actual_assessment_record_version_id:
              record.actualAssessmentRecordRef.reference.versionId,
            forecast_availability: forecast.kind,
            effect_forecast_id:
              forecast.kind === "available" ? forecast.effectForecastRef.reference.entityId : null,
            effect_forecast_version_id:
              forecast.kind === "available" ? forecast.effectForecastRef.reference.versionId : null,
            forecast_unavailable_reason:
              forecast.kind === "unavailable" ? forecast.reasonCode : null,
            spatial_scope_entity_id: record.spatialScopeRef.reference.entityId,
            spatial_scope_version_id: record.spatialScopeRef.reference.versionId,
            occurred_at: payload.occurredAt,
            feedback_payload: jsonValue(record),
            content_digest: contentDigest,
            command_id: atomic.commandId,
            idempotency_key: publicCommand.idempotencyKey,
            actor_ref: verified.actorId,
            authorization_context_ref: jsonValue(
              publicCommand.authorization.authorizationContextRef,
            ),
            audit_entry_id: auditEntryId,
            recorded_at: recordedAt,
          } as never)
          .onConflict((conflict) => conflict.doNothing())
          .execute();
        const stored = await transaction
          .selectFrom("business.response_feedback_records")
          .selectAll()
          .where("project_id", "=", publicCommand.projectId)
          .where("feedback_id", "=", feedbackRef.reference.entityId)
          .where("version_id", "=", feedbackRef.reference.versionId)
          .executeTakeFirst();
        if (stored === undefined || stored.content_digest !== contentDigest) {
          failResponseLifecycle("response-lifecycle-idempotency-conflict", {
            kind: "feedback",
            reference: feedbackRef.reference,
          });
        }
        return {
          resultRef: feedbackRef,
          audit: {
            auditEntryId,
            projectId: publicCommand.projectId,
            action: FEEDBACK_COMMAND_KIND_V1,
            targetRef: feedbackRef,
            actorRef: verified.actorId,
            authorizationContextRef: publicCommand.authorization.authorizationContextRef,
            occurredAt: publicCommand.issuedAt,
            recordedAt,
            version: { entityId: auditEntryId, versionId: "1" },
            commandId: atomic.commandId,
            idempotencyKey: publicCommand.idempotencyKey,
          },
          events: [event],
        };
      });
      return WarningResponseRecordResultV1Schema.parse({
        kind: "succeeded",
        result: {
          kind: "feedback",
          feedbackRef,
          // 预测不可用时缺席：调用方按既有 `effect-forecast-missing` 语义跳过支路，不补造预测。
          ...(forecast.kind === "available"
            ? { effectForecastRef: forecast.effectForecastRef }
            : {}),
        },
      });
    } catch (error: unknown) {
      return { kind: "failed", error: this.#toModuleError(error, publicCommand.commandId) };
    }
  }

  /**
   * 反馈可用性只在冻结链上解析：快照给出的预测引用优先；
   * 否则按执行所属建议链唯一解析，零条为稳定不可用原因，多条视为链不唯一而失败闭合。
   */
  async #resolveFeedbackForecast(input: {
    readonly projectId: string;
    readonly execution: ExecutionRow;
    readonly snapshotForecastRef: VersionReference | undefined;
    readonly authorizedScopeIds: readonly string[];
  }): Promise<ResponseForecastAvailabilityV1> {
    const targetRef: LifecycleTargetRefV1 = {
      kind: "execution-record",
      reference: { entityId: input.execution.execution_id, versionId: input.execution.version_id },
    };
    if (input.snapshotForecastRef !== undefined) {
      const row = await this.#loadForecastOutcome(
        input.projectId,
        input.snapshotForecastRef,
        input.authorizedScopeIds,
      );
      if (
        row === undefined ||
        (input.execution.recommendation_id !== null &&
          row.recommendation_id !== input.execution.recommendation_id)
      ) {
        failResponseLifecycle("response-feedback-chain-mismatch", targetRef);
      }
      return parseForecastOutcome(row, input.snapshotForecastRef).availability;
    }
    if (input.execution.recommendation_id === null) {
      return { kind: "unavailable", reasonCode: NO_EFFECT_FORECAST_REASON_V1 };
    }
    const rows = await this.#db
      .selectFrom("business.response_forecast_outcomes")
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("recommendation_id", "=", input.execution.recommendation_id)
      .where("recommendation_version_id", "=", input.execution.recommendation_version_id ?? "")
      .where("spatial_scope_entity_id", "in", input.authorizedScopeIds as string[])
      .execute();
    if (rows.length === 0) {
      return { kind: "unavailable", reasonCode: NO_EFFECT_FORECAST_REASON_V1 };
    }
    if (rows.length > 1) {
      failResponseLifecycle("response-feedback-chain-mismatch", targetRef);
    }
    const row = rows[0]!;
    return parseForecastOutcome(row, {
      entityId: row.forecast_id,
      versionId: row.version_id,
    }).availability;
  }

  // ----------------------------------------------------------- calculateDeviation

  async calculateDeviation(
    command: WarningResponseRecordCommandV1,
  ): Promise<ResponseDeviationResultV1> {
    const parsed = WarningResponseRecordCommandV1Schema.safeParse(command);
    if (!parsed.success || parsed.data.kind !== "calculate-deviation") {
      return { kind: "failed", error: this.#terminalError("unknown", DEVIATION_COMMAND_KIND_V1) };
    }
    const valid = parsed.data;
    const payload = valid.payload;
    try {
      const verified = await this.#verify(valid, DEVIATION_BRANCH_V1);
      const authorizedScopeIds = verified.spatialScopeRefs.map((scope) => scope.reference.entityId);
      const forecastRow = await this.#loadForecastOutcome(
        valid.projectId,
        payload.effectForecastRef.reference,
        authorizedScopeIds,
      );
      if (forecastRow === undefined) {
        return { kind: "unavailable", reasonCode: NO_EFFECT_FORECAST_REASON_V1 };
      }
      const outcome = parseForecastOutcome(forecastRow, payload.effectForecastRef.reference);
      const projected = outcome.projected;
      if (outcome.availability.kind === "unavailable") {
        return { kind: "unavailable", reasonCode: outcome.availability.reasonCode };
      }
      if (projected === undefined || projected.kind !== "available") {
        return { kind: "unavailable", reasonCode: NO_EFFECT_FORECAST_REASON_V1 };
      }
      const feedbackRow = await this.#loadFeedback(
        valid.projectId,
        payload.feedbackRef.reference,
        authorizedScopeIds,
      );
      if (feedbackRow === undefined) {
        failResponseLifecycle(
          "response-lifecycle-authorization-required",
          payload.feedbackRef,
          "AUTHORIZATION_DENIED",
        );
      }
      const feedbackRecord = ResponseFeedbackRecordV1Schema.safeParse(feedbackRow.feedback_payload);
      if (!feedbackRecord.success) {
        failResponseLifecycle("response-lifecycle-contract-drift", payload.feedbackRef);
      }
      if (
        !sameRef(feedbackRecord.data.executionRecordRef.reference, {
          entityId: feedbackRow.execution_id,
          versionId: feedbackRow.execution_version_id,
        }) ||
        !sameRef(
          outcome.frozenAssessmentBasisRef.reference,
          payload.frozenAssessmentBasisRef.reference,
        )
      ) {
        failResponseLifecycle(
          "response-deviation-value-incompatible",
          payload.frozenAssessmentBasisRef,
        );
      }
      if (feedbackRecord.data.forecast.kind === "unavailable") {
        return { kind: "unavailable", reasonCode: feedbackRecord.data.forecast.reasonCode };
      }
      if (
        !sameRef(
          feedbackRecord.data.forecast.effectForecastRef.reference,
          payload.effectForecastRef.reference,
        )
      ) {
        failResponseLifecycle("response-deviation-value-incompatible", payload.effectForecastRef);
      }
      const execution = await this.#loadExecution(
        valid.projectId,
        feedbackRecord.data.executionRecordRef.reference,
        authorizedScopeIds,
      );
      if (execution === undefined || execution.recommendation_id === null) {
        failResponseLifecycle("response-deviation-input-unavailable", payload.effectForecastRef);
      }
      const recommendationRef = {
        kind: "response-recommendation" as const,
        reference: {
          entityId: execution.recommendation_id,
          versionId: execution.recommendation_version_id ?? "",
        },
      };
      if (!sameRef(outcome.responseRecommendationRef.reference, recommendationRef.reference)) {
        failResponseLifecycle("response-deviation-input-unavailable", recommendationRef);
      }
      const basisReleaseSetRef = await this.#reader.readBasisReleaseSetRefForInputSnapshot({
        requestId: valid.commandId,
        requestedAt: valid.issuedAt,
        authorization: verified,
        assessmentInputSnapshotRef: payload.frozenAssessmentBasisRef,
      });
      const members = await this.#reader.readBasisMembers({
        requestId: valid.commandId,
        requestedAt: valid.issuedAt,
        authorization: verified,
        basisReleaseSetRef,
        definitionTypes: [...DEVIATION_MEMBER_TYPES_V1],
      });
      const policyMember = memberDocument(
        members,
        "deviation-policy",
        DeviationPolicyDocumentV1Schema,
        payload.frozenAssessmentBasisRef,
      );
      const matrixMember = memberDocument(
        members,
        "risk-matrix",
        RiskMatrixDocumentV1Schema,
        payload.frozenAssessmentBasisRef,
      );
      const indicatorMember = memberDocument(
        members,
        "indicator-system",
        IndicatorSystemDocumentV1Schema,
        payload.frozenAssessmentBasisRef,
      );
      const policies = policyMember.document.content.policies;
      if (policies.length === 0) {
        return { kind: "unavailable", reasonCode: "policy-unavailable" };
      }
      if (policies.length > 1) {
        failResponseLifecycle(
          "response-deviation-policy-mismatch",
          payload.frozenAssessmentBasisRef,
        );
      }
      const policy = policies[0]!;
      if (
        policy.basis === "risk-level-step" &&
        !sameRef(policy.riskMatrixRef, matrixMember.releaseRef)
      ) {
        failResponseLifecycle(
          "response-deviation-policy-mismatch",
          payload.frozenAssessmentBasisRef,
        );
      }
      const assessment = await this.#reader.readAssessmentChain({
        requestId: `${valid.commandId}:actual-assessment`,
        requestedAt: valid.issuedAt,
        authorization: verified,
        assessmentRecordRef: feedbackRecord.data.actualAssessmentRecordRef,
      });
      const actualIndicator = assessment.record.indicatorResults.find(
        (indicator) => indicator.indicatorItem === outcome.targetIndicatorId,
      );
      if (actualIndicator === undefined || typeof actualIndicator.actualValue !== "number") {
        return { kind: "unavailable", reasonCode: "target-indicator-missing" };
      }
      const computed = computeResponseDeviation({
        basis: policy.basis,
        unit: outcome.unit,
        actualUnit:
          indicatorUnitOf(indicatorMember.document.content.indicators, outcome.targetIndicatorId) ??
          "",
        predictedValue: projected.predictedValue,
        actualValue: actualIndicator.actualValue,
        predictedRiskState: projected.predictedRiskState,
        actualRiskState: assessment.riskState,
        riskLevelOrdinals: new Map(
          matrixMember.document.content.riskLevels.map((level) => [level.levelId, level.ordinal]),
        ),
        ...(policy.basis === "risk-level-step"
          ? { levelStep: policy.levelStep }
          : { threshold: policy.threshold }),
        ...(policy.basis === "relative" ? { minimumBaseline: policy.minimumBaseline } : {}),
      });
      if (computed.kind === "unavailable") {
        return { kind: "unavailable", reasonCode: computed.reasonCode };
      }
      const computation = computed.computation;
      const deviationDigest = responseDeviationDigest({
        projectId: valid.projectId,
        effectForecastRef: payload.effectForecastRef.reference,
        feedbackRef: payload.feedbackRef.reference,
        deviationPolicyRef: policyMember.releaseRef,
        basis: computation.basis,
      });
      const deviationFactRef = deviationFactRefOf(deviationDigest);
      const fact = ResponseDeviationFactV1Schema.parse({
        schemaVersion: "1",
        projectId: valid.projectId,
        deviationFactRef,
        responseRecommendationRef: recommendationRef,
        executionRecordRef: feedbackRecord.data.executionRecordRef,
        effectForecastRef: payload.effectForecastRef,
        feedbackRef: payload.feedbackRef,
        frozenAssessmentBasisRef: payload.frozenAssessmentBasisRef,
        deviationPolicyRef: policyMember.releaseRef,
        basis: computation.basis,
        riskMatrixRef: matrixMember.releaseRef,
        targetIndicatorId: outcome.targetIndicatorId,
        unit: outcome.unit,
        predictedValue: projected.predictedValue,
        actualValue: canonicalStringOfNumber(actualIndicator.actualValue),
        deviationValue: computation.deviationValue,
        deviationValueNumber: computation.deviationValueNumber,
        thresholdExceeded: computation.thresholdExceeded,
        direction: computation.direction,
        predictedRiskState: projected.predictedRiskState,
        actualRiskState: assessment.riskState,
        evidenceReferences: [
          ...projected.evidenceReferences,
          ...assessment.record.evidenceReferences.slice(0, 1),
        ],
        summary: `${computation.basis}:${computation.deviationValue}`,
        spatialScopeRef: {
          kind: "spatial-scope",
          reference: {
            entityId: execution.spatial_scope_entity_id,
            versionId: execution.spatial_scope_version_id,
          },
        },
        computedAt: this.#nowIso(),
      });
      const contentDigest = sha256CanonicalJson(fact);
      const recordedAt = this.#nowIso();
      const atomic = this.#atomicCommand(valid, DEVIATION_COMMAND_KIND_V1, valid);
      await this.#executeWithRetry(atomic, async (transactionContext): Promise<AtomicCommitV1> => {
        const transaction = asTransaction(transactionContext);
        const auditEntryId = `audit-${valid.commandId}:response-deviation`;
        await transaction
          .insertInto("business.response_deviation_facts")
          .values({
            deviation_id: deviationFactRef.reference.entityId,
            version_id: deviationFactRef.reference.versionId,
            schema_version: "1",
            project_id: valid.projectId,
            recommendation_id: fact.responseRecommendationRef.reference.entityId,
            recommendation_version_id: fact.responseRecommendationRef.reference.versionId,
            execution_id: fact.executionRecordRef.reference.entityId,
            execution_version_id: fact.executionRecordRef.reference.versionId,
            effect_forecast_id: fact.effectForecastRef.reference.entityId,
            effect_forecast_version_id: fact.effectForecastRef.reference.versionId,
            feedback_id: fact.feedbackRef.reference.entityId,
            feedback_version_id: fact.feedbackRef.reference.versionId,
            frozen_basis_snapshot_id: fact.frozenAssessmentBasisRef.reference.entityId,
            frozen_basis_snapshot_version_id: fact.frozenAssessmentBasisRef.reference.versionId,
            deviation_policy_entity_id: fact.deviationPolicyRef.entityId,
            deviation_policy_version_id: fact.deviationPolicyRef.versionId,
            basis: fact.basis,
            risk_matrix_entity_id: fact.riskMatrixRef.entityId,
            risk_matrix_version_id: fact.riskMatrixRef.versionId,
            target_indicator_id: fact.targetIndicatorId,
            unit: fact.unit,
            predicted_value_canonical: fact.predictedValue,
            actual_value_canonical: fact.actualValue,
            deviation_value_canonical: fact.deviationValue,
            deviation_value_number: fact.deviationValueNumber,
            threshold_exceeded: fact.thresholdExceeded,
            direction: fact.direction,
            predicted_risk_state: jsonValue(fact.predictedRiskState),
            actual_risk_state: jsonValue(fact.actualRiskState),
            evidence_references: jsonValue(fact.evidenceReferences),
            summary: fact.summary,
            spatial_scope_entity_id: fact.spatialScopeRef.reference.entityId,
            spatial_scope_version_id: fact.spatialScopeRef.reference.versionId,
            deviation_payload: jsonValue(fact),
            content_digest: contentDigest,
            command_id: atomic.commandId,
            idempotency_key: valid.idempotencyKey,
            actor_ref: verified.actorId,
            authorization_context_ref: jsonValue(valid.authorization.authorizationContextRef),
            audit_entry_id: auditEntryId,
            computed_at: fact.computedAt,
            recorded_at: recordedAt,
          } as never)
          .onConflict((conflict) => conflict.doNothing())
          .execute();
        return {
          // C03 回执只承载公共引用：偏差事实引用是 C28 私有，公开锚点是命令的预测引用。
          resultRef: payload.effectForecastRef,
          audit: {
            auditEntryId,
            projectId: valid.projectId,
            action: DEVIATION_COMMAND_KIND_V1,
            targetRef: fact.feedbackRef,
            actorRef: verified.actorId,
            authorizationContextRef: valid.authorization.authorizationContextRef,
            occurredAt: valid.issuedAt,
            recordedAt,
            version: { entityId: auditEntryId, versionId: "1" },
            commandId: atomic.commandId,
            idempotencyKey: valid.idempotencyKey,
          },
          events: [],
        };
      });
      const stored = await this.#loadDeviationFact(
        valid.projectId,
        deviationFactRef.reference,
        authorizedScopeIds,
      );
      if (stored === undefined) {
        failResponseLifecycle("response-lifecycle-contract-drift", deviationFactRef);
      }
      return { kind: "succeeded", result: { deviationFactRef, fact: stored } };
    } catch (error: unknown) {
      return { kind: "failed", error: this.#toModuleError(error, valid.commandId) };
    }
  }

  // ----------------------------------------------------------- readDeviationFact

  async readDeviationFact(input: {
    readonly requestId: string;
    readonly idempotencyKey: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly deviationFactRef: {
      readonly kind: "response-deviation-fact";
      readonly reference: VersionReference;
    };
  }): Promise<ResponseDeviationFactReadResultV1> {
    const command = {
      commandId: input.requestId,
      projectId: input.authorization.projectId,
      actorId: input.authorization.actorId,
      authorization: input.authorization,
    };
    try {
      const verified = await this.#verify(command, DEVIATION_BRANCH_V1);
      const row = await this.#db
        .selectFrom("business.response_deviation_facts")
        .selectAll()
        .where("project_id", "=", command.projectId)
        .where("deviation_id", "=", input.deviationFactRef.reference.entityId)
        .where("version_id", "=", input.deviationFactRef.reference.versionId)
        .where(
          "spatial_scope_entity_id",
          "in",
          verified.spatialScopeRefs.map((scope) => scope.reference.entityId),
        )
        .executeTakeFirst();
      // 目标缺失与无权同形：不提供列表或 latest 查询，也不重算旧偏差。
      if (row === undefined) {
        return this.#failAuthorization(DEVIATION_BRANCH_V1);
      }
      return {
        kind: "succeeded",
        result: { fact: parseDeviationFact(row, input.deviationFactRef.reference) },
      };
    } catch (error: unknown) {
      return { kind: "failed", error: this.#toModuleError(error, input.requestId) };
    }
  }

  // ------------------------------------------------------------------ loaders

  // ------------------------------------------------------------------ C34 所属窄读

  /**
   * 预测/执行/反馈的所属窄读（design D-06）：C26 不访问 C28 私表。
   * 正文一律走既有 loader + parser，缺失与越权同形失败，绝不返回半份结果。
   */
  async #verifyRead(
    input: {
      readonly projectId: string;
      readonly actorId: string;
      readonly requestedAt: string;
      readonly invocationId: string;
      readonly authorization: AuthorizationContextV1;
    },
    branch: ModuleBranchV1,
  ): Promise<AuthorizationContextV1 | undefined> {
    const capability = MODULE_BRANCH_CAPABILITY_V1[branch];
    if (
      input.projectId !== input.authorization.projectId ||
      input.actorId !== input.authorization.actorId ||
      !input.authorization.grantedCapabilities.includes(capability)
    ) {
      return undefined;
    }
    const decision = await this.#access
      .verify({
        authorizationContextRef: input.authorization.authorizationContextRef,
        invocationId: input.invocationId,
        projectId: input.projectId,
        branch,
        requestedSpatialScopeRefs: [...input.authorization.spatialScopeRefs],
        requestedSourceVersionRefs: [],
        requestedAt: input.requestedAt,
      })
      .catch((error: unknown) => {
        if (error instanceof AccessServiceError) return undefined;
        throw error;
      });
    if (decision === undefined || decision.redacted) return undefined;
    if (decision.context.actorId !== input.actorId) return undefined;
    return decision.context;
  }

  /**
   * 公共可用性：available 时取已登记的预测投影（数值与风险状态），unavailable 时只给原因码。
   * 登记事实与投影不同形属于完整性问题，按 drift 失败闭合，不反推数值也不降级为不可用。
   */
  #publicAvailabilityOf(
    availability: ResponseForecastAvailabilityV1,
    projected: ResponseForecastOutcomeV1["projected"],
    forecastRef: VersionReference,
  ): ForecastAvailabilityV1 {
    if (availability.kind === "unavailable") {
      return { kind: "unavailable", reasonCode: availability.reasonCode };
    }
    if (projected === undefined || projected.kind !== "available") {
      failResponseLifecycle("response-lifecycle-contract-drift", {
        kind: "effect-forecast",
        reference: forecastRef,
      });
    }
    return {
      kind: "available",
      predictedValue: projected.predictedValue,
      predictedRiskState: projected.predictedRiskState,
    };
  }

  /**
   * 预测精确读：available 分支给数值与风险状态，unavailable 分支只给原因码；
   * 缺失与越权同形失败，不用 C25 重算预测。
   */
  async readForecastView(input: LifecycleReadInputV1<"effect-forecast">): Promise<C28ReadResultV1> {
    const verified = await this.#verifyRead(input, "warning-response.read");
    if (verified === undefined) return { kind: "failed", error: { code: "AUTHORIZATION_DENIED" } };
    const row = await this.#loadForecastOutcome(
      input.projectId,
      input.targetRef.reference,
      verified.spatialScopeRefs.map((scope) => scope.reference.entityId),
    );
    if (row === undefined) return { kind: "failed", error: { code: "EFFECT_FORECAST_NOT_FOUND" } };
    const forecast = parseForecastOutcome(row, input.targetRef.reference);
    return {
      kind: "succeeded",
      view: {
        effectForecastRef: { kind: "effect-forecast", reference: input.targetRef.reference },
        recommendationRef: forecast.responseRecommendationRef,
        routeDecisionRef: forecast.routeDecisionRef,
        runRef: forecast.forecastRunRef,
        inputSnapshotRef: forecast.forecastInputSnapshotRef,
        frozenAssessmentBasisRef: forecast.frozenAssessmentBasisRef,
        preActionMonitoringSnapshotRef: forecast.preActionMonitoringSnapshotRef,
        baselineAssessmentRecordRef: forecast.baselineAssessmentRecordRef,
        forecastPolicyRef: {
          kind: "knowledge-release",
          reference: forecast.forecastPolicyRef,
        },
        method: forecast.method,
        targetIndicatorId: forecast.targetIndicatorId,
        unit: forecast.unit,
        horizonSteps: forecast.horizonSteps,
        availability: this.#publicAvailabilityOf(
          forecast.availability,
          forecast.projected,
          input.targetRef.reference,
        ),
        spatialScopeEntityId: row.spatial_scope_entity_id,
      },
    };
  }

  /**
   * 执行精确读：来源按登记事实原样投影，关联反馈取同执行已登记的反馈行。
   */
  async readExecutionView(
    input: LifecycleReadInputV1<"execution-record">,
  ): Promise<C28ReadResultV1> {
    const verified = await this.#verifyRead(input, "warning-response.read");
    if (verified === undefined) return { kind: "failed", error: { code: "AUTHORIZATION_DENIED" } };
    const scopeIds = verified.spatialScopeRefs.map((scope) => scope.reference.entityId);
    const row = await this.#loadExecution(input.projectId, input.targetRef.reference, scopeIds);
    if (row === undefined) return { kind: "failed", error: { code: "EXECUTION_RECORD_NOT_FOUND" } };
    const record = ResponseExecutionRecordV1Schema.parse(row.execution_payload);
    const feedbackRefs = await this.#feedbackRefsOf(
      input.projectId,
      input.targetRef.reference,
      scopeIds,
    );
    return {
      kind: "succeeded",
      view: {
        executionRecordRef: { kind: "execution-record", reference: input.targetRef.reference },
        source:
          record.source.kind === "adopted-recommendation"
            ? {
                sourceKind: "adopted-recommendation",
                recommendationRef: record.source.responseRecommendationRef,
                routeDecisionRef: record.source.routeDecisionRef,
              }
            : {
                sourceKind: "independent-action",
                measureReleaseRefs: record.source.measureReleaseRefs,
              },
        executedByActorId: record.executedByActorId,
        recordedByActorId: record.recordedByActorId,
        occurredAt: record.occurredAt,
        spatialScopeRef: record.spatialScopeRef,
        evidenceReferences: record.evidenceReferences,
        feedbackRefs,
        spatialScopeEntityId: row.spatial_scope_entity_id,
      },
    };
  }

  /**
   * 反馈登记的预测可用性：unavailable 只给原因码；available 时数值与风险状态取自
   * 它引用的那条预测事实的已登记投影。反馈自己的措辞不得改写预测判定，不同形即 drift。
   */
  async #publicAvailabilityForFeedback(
    projectId: string,
    feedback: FeedbackRow,
    recorded: ResponseFeedbackRecordV1,
    scopeIds: readonly string[],
  ): Promise<ForecastAvailabilityV1> {
    if (
      feedback.effect_forecast_id === null &&
      feedback.effect_forecast_version_id === null &&
      recorded.forecast.kind === "unavailable"
    ) {
      return { kind: "unavailable", reasonCode: recorded.forecast.reasonCode };
    }
    if (feedback.effect_forecast_id === null || feedback.effect_forecast_version_id === null) {
      failResponseLifecycle("response-lifecycle-contract-drift", {
        kind: "feedback",
        reference: { entityId: feedback.feedback_id, versionId: feedback.version_id },
      });
    }
    const forecastRef = {
      entityId: feedback.effect_forecast_id,
      versionId: feedback.effect_forecast_version_id,
    };
    if (recorded.forecast.kind === "unavailable") {
      return this.#publicAvailabilityOf(recorded.forecast, undefined, forecastRef);
    }
    const row = await this.#loadForecastOutcome(projectId, forecastRef, scopeIds);
    if (row === undefined) {
      failResponseLifecycle("response-lifecycle-contract-drift", {
        kind: "effect-forecast",
        reference: forecastRef,
      });
    }
    const forecast = parseForecastOutcome(row, forecastRef);
    return this.#publicAvailabilityOf(forecast.availability, forecast.projected, forecastRef);
  }

  /**
   * 反馈精确读：预测可用性按登记事实原样给出；偏差事实与公共偏差记录分属
   * 「私有计算解释」与「C29 公共记录」，这里只投影自己拥有的那一半。
   */
  async readFeedbackView(input: LifecycleReadInputV1<"feedback">): Promise<C28ReadResultV1> {
    const verified = await this.#verifyRead(input, "warning-response.read");
    if (verified === undefined) return { kind: "failed", error: { code: "AUTHORIZATION_DENIED" } };
    const scopeIds = verified.spatialScopeRefs.map((scope) => scope.reference.entityId);
    const row = await this.#loadFeedback(input.projectId, input.targetRef.reference, scopeIds);
    if (row === undefined) return { kind: "failed", error: { code: "FEEDBACK_NOT_FOUND" } };
    const record = ResponseFeedbackRecordV1Schema.parse(row.feedback_payload);
    const deviation =
      row.effect_forecast_id === null
        ? undefined
        : await this.#deviationViewOf(input.projectId, row, scopeIds);
    return {
      // 私有偏差事实引用随视图交出：组合方据此向 C29 换公共偏差记录与校准引用，
      // 不必也不得自己回查本模块私表。该引用不是公共引用种类，只作精确版本锚点。
      kind: "succeeded",
      view: {
        feedbackRef: { kind: "feedback", reference: input.targetRef.reference },
        executionRef: {
          kind: "execution-record",
          reference: { entityId: row.execution_id, versionId: row.execution_version_id },
        },
        postActionMonitoringSnapshotRef: {
          kind: "monitoring-snapshot",
          reference: {
            entityId: row.post_action_snapshot_id,
            versionId: row.post_action_snapshot_version_id,
          },
        },
        feedbackArtifactRef: {
          kind: "content-artifact",
          reference: {
            entityId: row.feedback_artifact_id,
            versionId: row.feedback_artifact_version_id,
          },
        },
        actualAssessmentRecordRef: {
          kind: "risk-assessment-record",
          reference: {
            entityId: row.actual_assessment_record_id,
            versionId: row.actual_assessment_record_version_id,
          },
        },
        occurredAt: record.occurredAt,
        forecastAvailability: await this.#publicAvailabilityForFeedback(
          input.projectId,
          row,
          record,
          scopeIds,
        ),
        ...(deviation === undefined
          ? {}
          : { deviation: deviation.view, deviationFactRef: deviation.factRef }),
        spatialScopeEntityId: row.spatial_scope_entity_id,
      },
    };
  }

  async #feedbackRefsOf(
    projectId: string,
    executionRef: VersionReference,
    scopeIds: readonly string[],
  ): Promise<ContractReferenceV1[]> {
    const rows = await this.#db
      .selectFrom("business.response_feedback_records")
      .select(["feedback_id", "version_id"])
      .where("project_id", "=", projectId)
      .where("execution_id", "=", executionRef.entityId)
      .where("execution_version_id", "=", executionRef.versionId)
      .where("spatial_scope_entity_id", "in", scopeIds as string[])
      .orderBy("recorded_at", "desc")
      .limit(C34_RELATION_PAGE_SIZE_V1)
      .execute();
    return rows.map((row) => ({
      kind: "feedback" as const,
      reference: { entityId: row.feedback_id, versionId: row.version_id },
    }));
  }

  /** 偏差事实只取已登记且落在获准空间的那一条；缺失就是没有，不从预测与反馈重算。 */
  async #deviationViewOf(
    projectId: string,
    feedback: FeedbackRow,
    scopeIds: readonly string[],
  ): Promise<{ readonly factRef: VersionReference; readonly view: DeviationViewV1 } | undefined> {
    const row = await this.#db
      .selectFrom("business.response_deviation_facts")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("feedback_id", "=", feedback.feedback_id)
      .where("feedback_version_id", "=", feedback.version_id)
      .where("spatial_scope_entity_id", "in", scopeIds as string[])
      .orderBy("computed_at", "desc")
      .limit(1)
      .executeTakeFirst();
    if (row === undefined) return undefined;
    const fact = parseDeviationFact(row, { entityId: row.deviation_id, versionId: row.version_id });
    return {
      factRef: { entityId: row.deviation_id, versionId: row.version_id },
      view: {
        deviationPolicyRef: fact.deviationPolicyRef,
        basis: fact.basis,
        targetIndicatorId: fact.targetIndicatorId,
        unit: fact.unit,
        // 私有事实登记的是规范十进制字符串，它本身就是合法标量：逐字投影，不另做数值转换。
        predictedValue: fact.predictedValue,
        actualValue: fact.actualValue,
        deviationValue: fact.deviationValue,
        thresholdExceeded: fact.thresholdExceeded,
        direction: fact.direction,
        riskMatrixRef: fact.riskMatrixRef,
        predictedRiskState: fact.predictedRiskState,
        actualRiskState: fact.actualRiskState,
        evidenceReferences: fact.evidenceReferences,
        computedAt: fact.computedAt,
      },
    };
  }

  /* ---------------------------------------------------------- C34 关系页窄读 */

  /**
   * 建议下的五类关系引用（design D-05、D-10）：每条都是一条有界 keyset 查询，
   * 先落工程、空间与锚点筛选再 `LIMIT pageSize+1`；锚点集合为空表示该建议尚无此类
   * 关系，返回空页而不是跨域反查或编造占位引用。
   */
  async readDecisionRefsForRecommendations(
    input: RelationPageInputV1,
  ): Promise<RelationPageResultV1> {
    const scopeIds = await this.#relationScopeIds(input);
    if (typeof scopeIds === "string") return { kind: "failed", error: { code: scopeIds } };
    if (scopeIds === undefined) return emptyRelationPage();
    return this.#relationPage(
      "route-decision",
      input,
      scopeIds,
      sql`
      SELECT d.decision_id AS entity_id, d.version_id, d.recorded_at
        FROM business.response_adoption_decisions d
       WHERE d.project_id = ${input.projectId}
         AND d.spatial_scope_entity_id = ANY(${scopeIds})
         AND (${joinAnchorSql(
           input.anchorRefs,
           (anchor) => sql`d.recommendation_id = ${anchor.reference.entityId}
                 AND d.recommendation_version_id = ${anchor.reference.versionId}`,
         )})
         ${relationAfterSql(input.after, sql`d.recorded_at`, sql`d.decision_id`)}
       ORDER BY d.recorded_at DESC, d.decision_id ASC, d.version_id ASC
       LIMIT ${input.pageSize + 1}
    `,
    );
  }

  async readForecastRefsForRecommendations(
    input: RelationPageInputV1,
  ): Promise<RelationPageResultV1> {
    const scopeIds = await this.#relationScopeIds(input);
    if (typeof scopeIds === "string") return { kind: "failed", error: { code: scopeIds } };
    if (scopeIds === undefined) return emptyRelationPage();
    return this.#relationPage(
      "effect-forecast",
      input,
      scopeIds,
      sql`
      SELECT f.forecast_id AS entity_id, f.version_id, f.recorded_at
        FROM business.response_forecast_outcomes f
       WHERE f.project_id = ${input.projectId}
         AND f.spatial_scope_entity_id = ANY(${scopeIds})
         AND (${joinAnchorSql(
           input.anchorRefs,
           (anchor) => sql`f.recommendation_id = ${anchor.reference.entityId}
                 AND f.recommendation_version_id = ${anchor.reference.versionId}`,
         )})
         ${relationAfterSql(input.after, sql`f.recorded_at`, sql`f.forecast_id`)}
       ORDER BY f.recorded_at DESC, f.forecast_id ASC, f.version_id ASC
       LIMIT ${input.pageSize + 1}
    `,
    );
  }

  async readExecutionRefsForRecommendations(
    input: RelationPageInputV1,
  ): Promise<RelationPageResultV1> {
    const scopeIds = await this.#relationScopeIds(input);
    if (typeof scopeIds === "string") return { kind: "failed", error: { code: scopeIds } };
    if (scopeIds === undefined) return emptyRelationPage();
    return this.#relationPage(
      "execution-record",
      input,
      scopeIds,
      sql`
      SELECT x.execution_id AS entity_id, x.version_id, x.recorded_at
        FROM business.response_execution_records x
       WHERE x.project_id = ${input.projectId}
         AND x.spatial_scope_entity_id = ANY(${scopeIds})
         AND (${joinAnchorSql(
           input.anchorRefs,
           (anchor) => sql`x.recommendation_id = ${anchor.reference.entityId}
                 AND x.recommendation_version_id = ${anchor.reference.versionId}`,
         )})
         ${relationAfterSql(input.after, sql`x.recorded_at`, sql`x.execution_id`)}
       ORDER BY x.recorded_at DESC, x.execution_id ASC, x.version_id ASC
       LIMIT ${input.pageSize + 1}
    `,
    );
  }

  /**
   * 反馈按执行登记：经 C28 自有执行表回到建议，不在 C28 内跨域猜建议归属，
   * 独立行动的反馈没有建议，因此不会出现在任何建议的关系页里。
   */
  async readFeedbackRefsForRecommendations(
    input: RelationPageInputV1,
  ): Promise<RelationPageResultV1> {
    const scopeIds = await this.#relationScopeIds(input);
    if (typeof scopeIds === "string") return { kind: "failed", error: { code: scopeIds } };
    if (scopeIds === undefined) return emptyRelationPage();
    return this.#relationPage(
      "feedback",
      input,
      scopeIds,
      sql`
      SELECT b.feedback_id AS entity_id, b.version_id, b.recorded_at
        FROM business.response_feedback_records b
        JOIN business.response_execution_records x
          ON x.project_id = b.project_id
         AND x.execution_id = b.execution_id
         AND x.version_id = b.execution_version_id
       WHERE b.project_id = ${input.projectId}
         AND b.spatial_scope_entity_id = ANY(${scopeIds})
         AND (${joinAnchorSql(
           input.anchorRefs,
           (anchor) => sql`x.recommendation_id = ${anchor.reference.entityId}
                 AND x.recommendation_version_id = ${anchor.reference.versionId}`,
         )})
         ${relationAfterSql(input.after, sql`b.recorded_at`, sql`b.feedback_id`)}
       ORDER BY b.recorded_at DESC, b.feedback_id ASC, b.version_id ASC
       LIMIT ${input.pageSize + 1}
    `,
    );
  }

  /** 私有偏差事实按建议登记：公共读只拿它的精确引用去问 C29 校准建议。 */
  async readDeviationFactRefsForRecommendations(
    input: RelationPageInputV1,
  ): Promise<RelationPageResultV1> {
    const scopeIds = await this.#relationScopeIds(input);
    if (typeof scopeIds === "string") return { kind: "failed", error: { code: scopeIds } };
    if (scopeIds === undefined) {
      return emptyRelationPage();
    }
    return this.#relationPage(
      "response-deviation-fact",
      input,
      scopeIds,
      sql`
      SELECT v.deviation_id AS entity_id, v.version_id, v.computed_at
        FROM business.response_deviation_facts v
       WHERE v.project_id = ${input.projectId}
         AND v.spatial_scope_entity_id = ANY(${scopeIds})
         AND (${joinAnchorSql(
           input.anchorRefs,
           (anchor) => sql`v.recommendation_id = ${anchor.reference.entityId}
                 AND v.recommendation_version_id = ${anchor.reference.versionId}`,
         )})
         ${relationAfterSql(input.after, sql`v.computed_at`, sql`v.deviation_id`)}
       ORDER BY v.computed_at DESC, v.deviation_id ASC, v.version_id ASC
       LIMIT ${input.pageSize + 1}
    `,
    );
  }

  /**
   * 实体标识解析：只认本模块登记的预测、执行与反馈。
   * 同一标识落在多个类别时如实给出全部类别，不替调用方猜它属于哪一类。
   */
  async resolveLifecycleRefs(input: ResolveRefsInputV1): Promise<ResolveRefsResultV1> {
    const verified = await this.#verifyRead(input, "warning-response.read");
    if (verified === undefined) return { kind: "failed", error: { code: "AUTHORIZATION_DENIED" } };
    const scopeIds = verified.spatialScopeRefs.map((scope) => scope.reference.entityId);
    if (scopeIds.length === 0) {
      return { kind: "failed", error: { code: "AUTHORIZATION_DENIED" } };
    }
    const versionFilter = input.versionId;
    const rows = await sql<{ kind: string; version_id: string }>`
      SELECT 'effect-forecast' AS kind, f.version_id
        FROM business.response_forecast_outcomes f
       WHERE f.project_id = ${input.projectId}
         AND f.spatial_scope_entity_id = ANY(${scopeIds})
         AND f.forecast_id = ${input.entityId}
         ${versionFilter === undefined ? sql`` : sql`AND f.version_id = ${versionFilter}`}
       UNION ALL
      SELECT 'execution-record' AS kind, x.version_id
        FROM business.response_execution_records x
       WHERE x.project_id = ${input.projectId}
         AND x.spatial_scope_entity_id = ANY(${scopeIds})
         AND x.execution_id = ${input.entityId}
         ${versionFilter === undefined ? sql`` : sql`AND x.version_id = ${versionFilter}`}
       UNION ALL
      SELECT 'feedback' AS kind, b.version_id
        FROM business.response_feedback_records b
       WHERE b.project_id = ${input.projectId}
         AND b.spatial_scope_entity_id = ANY(${scopeIds})
         AND b.feedback_id = ${input.entityId}
         ${versionFilter === undefined ? sql`` : sql`AND b.version_id = ${versionFilter}`}
       ORDER BY 1 ASC, 2 ASC
       LIMIT ${C28_RESOLVE_MAX_REFS_V1}
    `.execute(this.#db);
    return {
      kind: "succeeded",
      refs: rows.rows.map((row) => ({
        kind: row.kind,
        reference: { entityId: input.entityId, versionId: row.version_id },
      })),
    };
  }

  /** 关系页授权：与精确读同一分支与同一复验；未授权不读任何行。 */
  async #relationScopeIds(
    input: RelationPageInputV1,
  ): Promise<string[] | "AUTHORIZATION_DENIED" | undefined> {
    const verified = await this.#verifyRead(input, "warning-response.read");
    if (verified === undefined) return "AUTHORIZATION_DENIED";
    if (input.anchorRefs.length === 0) return undefined;
    return verified.spatialScopeRefs.map((scope) => scope.reference.entityId);
  }

  /** 统一收口：`pageSize+1` 判 hasMore，末行位置供公共游标续页。 */
  async #relationPage(
    kind: string,
    input: RelationPageInputV1,
    scopeIds: string[],
    query: SqlFragment,
  ): Promise<RelationPageResultV1> {
    const rows = (await query.execute(this.#db)).rows as readonly C28RelationRowV1[];
    const page = rows.slice(0, input.pageSize);
    const last = page.at(-1);
    return {
      kind: "succeeded",
      hasMore: rows.length > input.pageSize,
      lastRef:
        last === undefined
          ? undefined
          : { kind, reference: { entityId: last.entity_id, versionId: last.version_id } },
      lastRecordedAt:
        last === undefined
          ? undefined
          : last.recorded_at instanceof Date
            ? last.recorded_at.toISOString()
            : last.recorded_at,
      refs: page.map((row) => ({
        kind,
        reference: { entityId: row.entity_id, versionId: row.version_id },
      })),
    };
  }

  async #loadDecision(
    projectId: string,
    recommendationRef: { readonly reference: VersionReference },
    authorizedScopeIds: readonly string[],
  ): Promise<AdoptionDecisionRow | undefined> {
    const row = await this.#db
      .selectFrom("business.response_adoption_decisions")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("recommendation_id", "=", recommendationRef.reference.entityId)
      .where("recommendation_version_id", "=", recommendationRef.reference.versionId)
      .where("spatial_scope_entity_id", "in", authorizedScopeIds)
      .executeTakeFirst();
    if (row !== undefined) parseAdoptionDecision(row, projectId, recommendationRef.reference);
    return row;
  }

  async #loadForecastOutcome(
    projectId: string,
    forecastRef: VersionReference,
    authorizedScopeIds?: readonly string[],
  ): Promise<ForecastOutcomeRow | undefined> {
    const query = this.#db
      .selectFrom("business.response_forecast_outcomes")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("forecast_id", "=", forecastRef.entityId)
      .where("version_id", "=", forecastRef.versionId);
    return (
      authorizedScopeIds === undefined
        ? query
        : query.where("spatial_scope_entity_id", "in", authorizedScopeIds as string[])
    ).executeTakeFirst();
  }

  async #loadExecution(
    projectId: string,
    executionRef: VersionReference,
    authorizedScopeIds: readonly string[],
  ): Promise<ExecutionRow | undefined> {
    const row = await this.#db
      .selectFrom("business.response_execution_records")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("execution_id", "=", executionRef.entityId)
      .where("version_id", "=", executionRef.versionId)
      .where("spatial_scope_entity_id", "in", authorizedScopeIds)
      .executeTakeFirst();
    if (row !== undefined) parseExecutionRecord(row, executionRef);
    return row;
  }

  async #loadFeedback(
    projectId: string,
    feedbackRef: VersionReference,
    authorizedScopeIds: readonly string[],
  ): Promise<FeedbackRow | undefined> {
    const row = await this.#db
      .selectFrom("business.response_feedback_records")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("feedback_id", "=", feedbackRef.entityId)
      .where("version_id", "=", feedbackRef.versionId)
      .where("spatial_scope_entity_id", "in", authorizedScopeIds)
      .executeTakeFirst();
    if (row !== undefined) parseFeedbackRecord(row, feedbackRef);
    return row;
  }

  async #loadDeviationFact(
    projectId: string,
    deviationRef: VersionReference,
    authorizedScopeIds: readonly string[],
  ): Promise<ResponseDeviationFactV1 | undefined> {
    const row = await this.#db
      .selectFrom("business.response_deviation_facts")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("deviation_id", "=", deviationRef.entityId)
      .where("version_id", "=", deviationRef.versionId)
      .where("spatial_scope_entity_id", "in", authorizedScopeIds)
      .executeTakeFirst();
    return row === undefined ? undefined : parseDeviationFact(row, deviationRef);
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
      // `business.command_receipts.command_id` 全局唯一，而同一个人工命令会依次经过 C41 的
      // 决定占位、C30 的运行启动与 C28 的正式写入。按既有约定（C41 的 `:c41-reserve-adoption`）
      // 在本模块派生回执身份：领域行的 `command_id` 外键与审计必须跟着写同一个派生值。
      commandId: `${command.commandId}:c28-${commandKind}`,
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
        // 并发写同一业务身份时的序列化失败在有限预算内重试，随后由唯一性收口。
        if (
          attempt < MAX_SERIALIZATION_ATTEMPTS_V1 &&
          mapPostgresError(error, "warning-response.response-lifecycle.transaction").retryable
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  // ------------------------------------------------------------------------- 错误

  #terminalError(causalRunId: string, stageCode: string): ModuleErrorV1 {
    return toResponseLifecycleModuleError(
      {
        code: "TERMINAL_FAILURE",
        reasonCode: "response-lifecycle-contract-drift",
        targetRef: {
          kind: "response-lifecycle",
          reference: { entityId: stageCode, versionId: "1" },
        },
      },
      causalRunId,
    );
  }

  #toModuleError(error: unknown, causalRunId: string): ModuleErrorV1 {
    const failure = responseLifecycleFailureFrom(error);
    if (failure !== undefined) {
      return toResponseLifecycleModuleError(failure, causalRunId);
    }
    if (error instanceof AccessServiceError) {
      return toResponseLifecycleModuleError(
        {
          code: "AUTHORIZATION_DENIED",
          reasonCode: "response-lifecycle-authorization-required",
          targetRef: {
            kind: "authorization-context",
            reference: { entityId: "warning-response.unauthorized", versionId: "1" },
          },
        },
        causalRunId,
      );
    }
    const mapped = mapPostgresError(error, "warning-response.response-lifecycle.adapter");
    if (mapped.code === "IDEMPOTENCY_CONFLICT") {
      return toResponseLifecycleModuleError(
        {
          code: "IDEMPOTENCY_CONFLICT",
          reasonCode: "response-lifecycle-idempotency-conflict",
          targetRef: {
            kind: "response-lifecycle",
            reference: { entityId: causalRunId, versionId: "1" },
          },
        },
        causalRunId,
      );
    }
    return toResponseLifecycleModuleError(
      {
        code: mapped.retryable ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE",
        reasonCode: "response-lifecycle-contract-drift",
        targetRef: {
          kind: "response-lifecycle",
          reference: { entityId: causalRunId, versionId: "1" },
        },
      },
      causalRunId,
    );
  }
}

export const createPostgresResponseLifecycleAdapter = (
  options: PostgresResponseLifecycleAdapterOptionsV1,
): PostgresResponseLifecycleAdapter => new PostgresResponseLifecycleAdapter(options);

export const createPostgresResponseLifecycleContextReader = (
  options: PostgresResponseLifecycleContextReaderOptionsV1,
): PostgresResponseLifecycleContextReader => new PostgresResponseLifecycleContextReader(options);
