import { sql, type Kysely, type Selectable, type Transaction } from "kysely";

import { AccessServiceError, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import {
  ArtifactPutCommandV1Schema,
  ArtifactReadRequestV1Schema,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  canonicalJson,
  sha256CanonicalJson,
  type AtomicCommandV1,
  type AtomicCommitReceiptV1,
  type AtomicCommitV1,
  type JsonValue,
  type TransactionContextV1,
  type TransactionOptionsV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import {
  ApplicabilityConditionV1Schema,
  ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
  IndicatorFieldMappingDocumentV1Schema,
  JointTriggerPolicyDocumentV1Schema,
  MeasureLibraryDocumentV1Schema,
  MonitoringWarningThresholdDocumentV1Schema,
} from "@riskflow/core/assessment-config";
import { ApplicabilityMetadataSnapshotV1Schema } from "@riskflow/core/engineering-data/context-source";
import {
  AssessmentBasisReleaseSetReadResultV1Schema,
  type AssessmentBasisReleaseSetReaderV1,
} from "@riskflow/core/scoring-rules";
import {
  AgentValidationResultV1Schema,
  buildCompletedAgentTaskResult,
  type AgentTaskSnapshotV1,
  type AgentValidationResultV1,
} from "@riskflow/core/agent-runtime";
import {
  KnowledgeRetrievalQueryV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  RecommendationCommandV1Schema,
  ReviewRequestV1Schema,
  ReviewTaskRefV1Schema,
  RiskInputVersionRefV1Schema,
  SpatialScopeRefV1Schema,
  type AgentTaskResultRefV1,
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type ReviewRequestResultV1,
  type KnowledgeQueryResultRefV1,
  type KnowledgeRetrievalQueryV1,
  type KnowledgeRetrievalResultV1,
  ModuleErrorV1Schema,
  type ModuleErrorV1,
  type ModuleBranchV1,
  type RecommendationCandidateRefV1,
  type RecommendationResultV1,
  type ReviewTaskRefV1,
  type RiskInputVersionRefV1,
} from "@riskflow/contracts/ports";
import { ResponseRecommendationSchema, WarningRecordSchema } from "@riskflow/contracts/records";
import {
  AssessmentInputSnapshotV1Schema,
  type AssessmentInputSnapshotV1,
} from "@riskflow/contracts/workflows";
import {
  MeasureCandidateSetV1Schema,
  RECOMMENDATION_TASK_TYPE_V1,
  RecommendationCandidateV1Schema,
  buildRecommendationValidationEvidence,
  buildResponseRecommendationRecord,
  failRecommendation,
  measureCandidateInputDigest,
  primaryWarningRecordRef,
  recommendationFailureFrom,
  recommendationValidationPassed,
  resolveTriggerIndicators,
  selectFrozenMeasures,
  toRecommendationModuleError,
  validateRecommendationCandidate,
  type CreateCandidateCommandV1,
  type MeasureCandidateSetV1,
  type RecommendationCandidateV1,
  type RecommendationContextReaderV1,
  type RecommendationFrozenContextV1,
  type RecommendationFrozenWarningV1,
  type RecommendationPolicyProviderV1,
  type RecommendationServiceV1,
  type RecommendationValidationEvidenceV1,
  type RecommendationValidationOutcomeV1,
  type ResponseRecommendationIncrementV1,
  type ResponseRecommendationTaskPortV1,
  type ValidateAndRecordCommandV1,
} from "@riskflow/core/recommendation";

import { RecommendationValidationEvidenceV1Schema } from "@riskflow/core/recommendation";
import type { WarningResponseTaskRefV1 } from "@riskflow/contracts/ports";

/** 解析结果有界：实体标识的登记版本数由公共上限约束。 */
const C26_RESOLVE_MAX_REFS_V1 = 50;
import type {
  C26RecommendationViewResultV1,
  RecommendationReadViewInputV1,
  RelationPageInputV1,
  RelationPageResultV1,
  ResolveRefsInputV1,
  ResolveRefsResultV1,
  WarningResponseRecommendationReaderV1,
} from "../warning/postgres-warning-lifecycle-adapter.js";
import { mapPostgresError } from "../postgres/pool.js";
import { getPostgresTransaction } from "../postgres/transaction-unit.js";
import type { PostgresDatabase } from "../postgres/types.js";

type JsonColumn = JsonValue;

const MEASURE_CANDIDATE_SET_PURPOSE_CODE_V1 = "warning-response.measure-candidate-set";
const MEASURE_CANDIDATE_SET_MEDIA_TYPE_V1 = "application/vnd.riskflow.measure-candidate-set+json";
const RECOMMENDATION_CANDIDATE_PURPOSE_CODE_V1 = "warning-response.recommendation-candidate";
const RECOMMENDATION_CANDIDATE_MEDIA_TYPE_V1 =
  "application/vnd.riskflow.recommendation-candidate+json";
const RECOMMENDATION_EVIDENCE_PURPOSE_CODE_V1 = "warning-response.recommendation-evidence";
const RECOMMENDATION_EVIDENCE_MEDIA_TYPE_V1 =
  "application/vnd.riskflow.recommendation-evidence+json";
/** C08 候选记录只接受该用途的校验工件；与 C19 编制任务保持一致。 */
const AGENT_VALIDATION_PURPOSE_CODE_V1 = "agent-validation";
const AGENT_VALIDATION_MEDIA_TYPE_V1 = "application/vnd.riskflow.agent-validation+json";
const MAX_SERIALIZATION_ATTEMPTS_V1 = 3;
const MAX_ARTIFACT_BYTES_V1 = 8 * 1024 * 1024;

interface WarningRecordRow {
  project_id: string;
  warning_record_id: string;
  version_id: string;
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
  warning_payload: JsonColumn;
}

interface WarningResponseTaskVersionRow {
  project_id: string;
  task_id: string;
  version_id: string;
  spatial_scope_ref: JsonColumn;
}

interface WarningResponseTaskWarningRow {
  project_id: string;
  task_id: string;
  first_included_version_id: string;
  warning_record_id: string;
  warning_record_version_id: string;
}

interface AssessmentPreparationRow {
  snapshot_id: string;
  version_id: string;
  applicability_values: JsonColumn;
}

interface AssessmentInputSnapshotRow {
  input_snapshot_id: string;
  version_id: string;
  project_id: string;
  basis_release_set_ref: JsonColumn;
  snapshot_payload: JsonColumn;
}

interface RiskAssessmentRecordRow {
  record_id: string;
  version_id: string;
  project_id: string;
  record_payload: JsonColumn;
}

interface MeasureCandidateQueryRow {
  query_result_id: string;
  version_id: string;
  project_id: string;
  warning_response_task_id: string;
  warning_response_task_version_id: string;
  risk_input_kind: string;
  risk_input_entity_id: string;
  risk_input_version_id: string;
  spatial_scope_entity_id: string;
  spatial_scope_version_id: string;
  risk_event_category: string;
  generation_policy_entity_id: string;
  generation_policy_version_id: string;
  measure_library_release_id: string;
  measure_library_release_version_id: string;
  measure_artifact_id: string;
  measure_artifact_version_id: string;
  measure_content_digest: string;
  input_digest: string;
  candidate_count: number;
  candidate_set_artifact_id: string;
  candidate_set_artifact_version_id: string;
  candidate_set_digest: string;
  candidate_set_payload: JsonColumn;
  warning_links: JsonColumn;
}

interface RecommendationCandidateRow {
  candidate_id: string;
  version_id: string;
  project_id: string;
  warning_response_task_id: string;
  warning_response_task_version_id: string;
  query_result_id: string;
  query_result_version_id: string;
  generation_policy_entity_id: string;
  generation_policy_version_id: string;
  spatial_scope_entity_id: string;
  spatial_scope_version_id: string;
  agent_task_id: string;
  agent_task_type: string;
  agent_result_id: string;
  agent_result_version_id: string;
  parent_run_id: string;
  parent_run_version_id: string;
  primary_warning_record_id: string;
  primary_warning_record_version_id: string;
  candidate_payload: JsonColumn;
  candidate_artifact_id: string;
  candidate_artifact_version_id: string;
  content_digest: string;
}

interface RecommendationValidationRow {
  validation_id: string;
  version_id: string;
  project_id: string;
  candidate_id: string;
  candidate_version_id: string;
  review_task_id: string | null;
  trigger_consistency_passed: boolean;
  standards_compliance_passed: boolean;
  site_feasibility_passed: boolean;
  validation_payload: JsonColumn;
}

interface ResponseRecommendationRow {
  recommendation_id: string;
  version_id: string;
  project_id: string;
  candidate_id: string;
  candidate_version_id: string;
  validation_id: string;
  validation_version_id: string;
  warning_response_task_id: string;
  warning_response_task_version_id: string;
  spatial_scope_entity_id: string;
  spatial_scope_version_id: string;
  measure_library_release_id: string;
  measure_library_release_version_id: string;
  generation_policy_entity_id: string;
  generation_policy_version_id: string;
  validation_policy_entity_id: string;
  validation_policy_version_id: string;
  review_status: string;
  record_payload: JsonColumn;
  content_digest: string;
}

type RecommendationDatabase = PostgresDatabase & {
  "business.risk_assessment_records": RiskAssessmentRecordRow;
  "business.assessment_input_snapshots": AssessmentInputSnapshotRow;
  "business.assessment_preparation_snapshots": AssessmentPreparationRow;
  "business.warning_records": WarningRecordRow;
  "business.warning_response_task_versions": WarningResponseTaskVersionRow;
  "business.warning_response_task_warnings": WarningResponseTaskWarningRow;
  "business.measure_candidate_queries": MeasureCandidateQueryRow;
  "business.recommendation_candidates": RecommendationCandidateRow;
  "business.recommendation_validations": RecommendationValidationRow;
  "business.response_recommendations": ResponseRecommendationRow;
};

const asTransaction = (context: TransactionContextV1): Transaction<RecommendationDatabase> =>
  getPostgresTransaction(context) as unknown as Transaction<RecommendationDatabase>;

const jsonValue = (value: unknown): unknown => JSON.stringify(value) as unknown;

const refKey = (value: { readonly entityId: string; readonly versionId: string }): string =>
  `${value.entityId}\u0000${value.versionId}`;

const sameRef = (
  left: { readonly entityId: string; readonly versionId: string },
  right: { readonly entityId: string; readonly versionId: string },
): boolean => refKey(left) === refKey(right);

async function* one(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

const applicabilityConditionsOf = (applicability: {
  readonly constructionMethod: string;
  readonly stratumCondition: string;
  readonly engineeringStage: string;
}) =>
  ApplicabilityConditionV1Schema.array().parse([
    { dimension: "施工工法数据", values: [applicability.constructionMethod] },
    { dimension: "地层条件数据", values: [applicability.stratumCondition] },
    { dimension: "工程阶段数据", values: [applicability.engineeringStage] },
  ]);

/** 精确集合引用只接受显式 kind；任何其它形态都是契约漂移，不做宽松解析。 */
const parseBasisReleaseSetRef = (
  value: unknown,
  targetRef: {
    readonly kind: string;
    readonly reference: { readonly entityId: string; readonly versionId: string };
  },
): {
  readonly kind: "assessment-basis-release-set";
  readonly reference: { readonly entityId: string; readonly versionId: string };
} => {
  const candidate = value as {
    kind?: unknown;
    reference?: { entityId?: unknown; versionId?: unknown };
  };
  if (
    typeof value !== "object" ||
    value === null ||
    candidate.kind !== "assessment-basis-release-set" ||
    typeof candidate.reference?.entityId !== "string" ||
    typeof candidate.reference.versionId !== "string"
  ) {
    failRecommendation("recommendation-contract-drift", targetRef);
  }
  return {
    kind: "assessment-basis-release-set",
    reference: {
      entityId: candidate.reference.entityId,
      versionId: candidate.reference.versionId,
    },
  };
};

/* -------------------------------------------------------------------------- */
/* 注入接缝                                                                    */
/* -------------------------------------------------------------------------- */

/** C08 只读窄接缝：C27 按精确任务引用读取冻结信封与终态结果，不写 C08 事实。 */
export interface RecommendationAgentTaskReaderV1 {
  getTask(taskRef: unknown): Promise<AgentTaskSnapshotV1 | undefined>;
}

/** C07 复核授权提供者：C27 派生精确调用身份，provider 只解析受信来源与 C06 授权。 */
export interface RecommendationReviewAuthorizationProviderV1 {
  authorize(input: {
    readonly task: "request-review";
    readonly projectId: string;
    readonly actorId: string;
    readonly invocationId: string;
    readonly requestedAt: string;
    readonly branch: "review-audit.request-review";
    readonly candidateRef: RecommendationCandidateRefV1;
  }): Promise<AuthorizationContextV1>;
}

/** C07 只读复核请求接缝：C27 只消费其原子端口结果，不建第二套复核表。 */
export interface RecommendationReviewAuditPortV1 {
  requestReview(request: unknown): Promise<ReviewRequestResultV1>;
}

/**
 * 处置 Agent 任务写入授权提供者：组合根按任务发起人身份为有界任务派生精确分支授权，
 * C27 再用任务身份向 C06 亲自复验，不复用 C08 任务信封内的启动授权。
 */
export interface RecommendationTaskAuthorizationProviderV1 {
  authorize(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly purpose: "increment-validation" | "recommendation-candidate";
  }): Promise<AuthorizationContextV1>;
}

/* -------------------------------------------------------------------------- */
/* 精确只读上下文（D-02）                                                       */
/* -------------------------------------------------------------------------- */

interface LoadedWarningV1 {
  readonly warningRef: RecommendationFrozenWarningV1;
  readonly inputSnapshot: AssessmentInputSnapshotV1;
  readonly riskInputRef: RiskInputVersionRefV1;
  readonly applicability: {
    readonly constructionMethod: string;
    readonly stratumCondition: string;
    readonly engineeringStage: string;
  };
  readonly basisRef: {
    readonly kind: "assessment-basis-release-set";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  };
}

/** C27 私有只读端口实现：按精确引用投影 C26 任务/预警、C25 评估与快照、C19 成员与 C04 措施正文。 */
export class PostgresRecommendationContextReader implements RecommendationContextReaderV1 {
  readonly #db: Kysely<RecommendationDatabase>;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #basis: AssessmentBasisReleaseSetReaderV1;

  constructor(options: {
    readonly db: Kysely<PostgresDatabase>;
    readonly artifactStore: ArtifactStoreV1;
    readonly basis: AssessmentBasisReleaseSetReaderV1;
  }) {
    this.#db = options.db as unknown as Kysely<RecommendationDatabase>;
    this.#artifactStore = options.artifactStore;
    this.#basis = options.basis;
  }

  async readFrozenContext(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly warningResponseTaskRef: {
      readonly kind: "warning-response-task";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
    readonly measureLibraryReleaseRef: {
      readonly kind: "measure-library-release";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
  }): Promise<RecommendationFrozenContextV1> {
    const authorization = input.authorization;
    const taskTarget = {
      kind: "warning-response-task" as const,
      reference: input.warningResponseTaskRef.reference,
    };
    const authorizedScopeIds = authorization.spatialScopeRefs.map(
      (scope) => scope.reference.entityId,
    );
    if (authorizedScopeIds.length === 0) {
      failRecommendation("recommendation-authorization-required", taskTarget);
    }
    const taskVersion = await this.#db
      .selectFrom("business.warning_response_task_versions")
      .selectAll()
      .where("project_id", "=", authorization.projectId)
      .where("task_id", "=", input.warningResponseTaskRef.reference.entityId)
      .where("version_id", "=", input.warningResponseTaskRef.reference.versionId)
      .where(
        sql<boolean>`spatial_scope_ref -> 'reference' ->> 'entityId' IN (${sql.join(
          authorizedScopeIds,
        )})`,
      )
      .executeTakeFirst();
    if (taskVersion === undefined) {
      failRecommendation("recommendation-authorization-required", taskTarget);
    }
    const taskSpatialScope = SpatialScopeRefV1Schema.safeParse(taskVersion.spatial_scope_ref);
    if (!taskSpatialScope.success) {
      failRecommendation("recommendation-contract-drift", taskTarget);
    }
    const targetVersion = Number(taskVersion.version_id);
    const links = await this.#db
      .selectFrom("business.warning_response_task_warnings")
      .selectAll()
      .where("project_id", "=", authorization.projectId)
      .where("task_id", "=", input.warningResponseTaskRef.reference.entityId)
      .execute();
    const included = links
      .filter((link) => Number(link.first_included_version_id) <= targetVersion)
      .sort((left, right) =>
        left.warning_record_id === right.warning_record_id
          ? left.warning_record_version_id < right.warning_record_version_id
            ? -1
            : 1
          : left.warning_record_id < right.warning_record_id
            ? -1
            : 1,
      );
    if (included.length === 0) {
      failRecommendation("recommendation-warning-mismatch", taskTarget);
    }

    const loaded: LoadedWarningV1[] = [];
    for (const link of included) {
      if (
        loaded.some(
          (entry) =>
            refKey(entry.warningRef.warningRecordRef.reference) ===
            refKey({ entityId: link.warning_record_id, versionId: link.warning_record_version_id }),
        )
      ) {
        continue;
      }
      loaded.push(await this.#loadWarning(link, authorization, authorizedScopeIds, taskTarget));
    }
    const first = loaded[0];
    if (first === undefined) {
      failRecommendation("recommendation-warning-mismatch", taskTarget);
    }
    const measureLibraryReleaseRef = {
      kind: "measure-library-release" as const,
      reference: first.inputSnapshot.measureLibraryReleaseRef,
    };
    if (!sameRef(measureLibraryReleaseRef.reference, input.measureLibraryReleaseRef.reference)) {
      failRecommendation("recommendation-task-version-stale", input.measureLibraryReleaseRef);
    }
    for (const entry of loaded.slice(1)) {
      const consistent =
        sameRef(entry.inputSnapshot.measureLibraryReleaseRef, measureLibraryReleaseRef.reference) &&
        sameRef(entry.riskInputRef.reference, first.riskInputRef.reference) &&
        entry.riskInputRef.kind === first.riskInputRef.kind &&
        sameRef(entry.basisRef.reference, first.basisRef.reference) &&
        refKey(entry.inputSnapshot.applicableRuleSetRef) ===
          refKey(first.inputSnapshot.applicableRuleSetRef) &&
        sameRef(
          entry.inputSnapshot.responseGenerationPolicyRef,
          first.inputSnapshot.responseGenerationPolicyRef,
        ) &&
        sameRef(
          entry.inputSnapshot.responseValidationPolicyRef,
          first.inputSnapshot.responseValidationPolicyRef,
        ) &&
        sameRef(
          entry.inputSnapshot.responseAgentPolicyRef,
          first.inputSnapshot.responseAgentPolicyRef,
        ) &&
        sameRef(entry.inputSnapshot.reviewPolicyRef, first.inputSnapshot.reviewPolicyRef) &&
        JSON.stringify(entry.applicability) === JSON.stringify(first.applicability);
      if (!consistent) {
        failRecommendation("recommendation-warning-mismatch", taskTarget);
      }
    }

    const basisResult = AssessmentBasisReleaseSetReadResultV1Schema.safeParse(
      await this.#basis.readAssessmentBasisReleaseSet({
        requestId: input.requestId,
        idempotencyKey: input.requestId,
        requestedAt: input.requestedAt,
        authorization,
        assessmentBasisReleaseSetRef: first.basisRef,
      }),
    );
    if (!basisResult.success) {
      failRecommendation("recommendation-contract-drift", taskTarget);
    }
    if (basisResult.data.kind === "unavailable") {
      failRecommendation("measure-candidates-unavailable", measureLibraryReleaseRef);
    }
    if (basisResult.data.kind !== "succeeded") {
      failRecommendation(
        "measure-candidates-unavailable",
        measureLibraryReleaseRef,
        basisResult.data.error.code === "TRANSIENT_FAILURE"
          ? "TRANSIENT_FAILURE"
          : "TERMINAL_FAILURE",
      );
    }
    const measureMember = basisResult.data.configurationMembers.find(
      (member) => member.definitionType === "measure-library",
    );
    if (
      measureMember === undefined ||
      !sameRef(measureMember.releaseRef.reference, measureLibraryReleaseRef.reference)
    ) {
      failRecommendation("measure-candidates-unavailable", measureLibraryReleaseRef);
    }
    const measureArtifactRef = {
      kind: "content-artifact" as const,
      reference: measureMember.artifactRef.reference,
    };
    const configurationMembers = basisResult.data.configurationMembers;
    const readMember = async (definitionType: string): Promise<unknown> => {
      const member = configurationMembers.find((entry) => entry.definitionType === definitionType);
      if (member === undefined)
        failRecommendation("measure-candidates-unavailable", first.basisRef);
      const artifactRef = {
        kind: "content-artifact" as const,
        reference: member.artifactRef.reference,
      };
      const document = await this.#readConfigurationDocument(
        input.requestId,
        input.requestedAt,
        authorization,
        artifactRef,
        definitionType,
      );
      if (sha256CanonicalJson(document) !== member.contentDigest) {
        failRecommendation("measure-candidates-unavailable", artifactRef);
      }
      return document;
    };
    const library = MeasureLibraryDocumentV1Schema.safeParse(await readMember("measure-library"));
    const fieldMapping = IndicatorFieldMappingDocumentV1Schema.safeParse(
      await readMember("indicator-field-mapping"),
    );
    const monitoringThresholds = MonitoringWarningThresholdDocumentV1Schema.safeParse(
      await readMember("monitoring-warning-threshold"),
    );
    const jointTriggerPolicy = JointTriggerPolicyDocumentV1Schema.safeParse(
      await readMember("joint-trigger-policy"),
    );
    if (
      !library.success ||
      !fieldMapping.success ||
      !monitoringThresholds.success ||
      !jointTriggerPolicy.success
    ) {
      failRecommendation("measure-candidates-unavailable", measureArtifactRef);
    }
    const configurationSetRef = library.data.configurationSetRef;
    const projectRevisionRef = library.data.projectRevisionRef.reference;
    if (
      [fieldMapping.data, monitoringThresholds.data, jointTriggerPolicy.data].some(
        (document) =>
          !sameRef(document.configurationSetRef, configurationSetRef) ||
          !sameRef(document.projectRevisionRef.reference, projectRevisionRef),
      )
    ) {
      failRecommendation("measure-candidates-unavailable", first.basisRef);
    }
    const triggerConfiguration = {
      fieldMapping: fieldMapping.data.content,
      monitoringThresholds: monitoringThresholds.data.content,
      jointTriggerPolicy: jointTriggerPolicy.data.content,
    };
    const warnings = loaded.map((entry) => {
      const resolution = resolveTriggerIndicators(
        entry.warningRef.triggerIndicators.map((trigger) => trigger.indicatorItem),
        triggerConfiguration,
      );
      return {
        ...entry.warningRef,
        resolvedTargetIndicatorIds: [...resolution.indicatorIds],
        unresolvedTriggerItems: [...resolution.unresolvedItems],
      };
    });

    return {
      projectId: authorization.projectId,
      warningResponseTaskRef: taskTarget,
      riskInputRef: first.riskInputRef,
      spatialScopeRef: taskSpatialScope.data,
      applicableRuleSetRef: basisResult.data.applicableRuleSetMember.releaseRef.reference,
      basisReleaseSetRef: first.basisRef,
      measureLibraryReleaseRef,
      measureArtifactRef,
      measureContentDigest: measureMember.contentDigest,
      measureLibrary: library.data.content,
      applicability: applicabilityConditionsOf(first.applicability),
      warnings,
      generationPolicyRef: first.inputSnapshot.responseGenerationPolicyRef,
      validationPolicyRef: first.inputSnapshot.responseValidationPolicyRef,
      agentPolicyRef: first.inputSnapshot.responseAgentPolicyRef,
      reviewPolicyRef: first.inputSnapshot.reviewPolicyRef,
    };
  }

  async #loadWarning(
    link: WarningResponseTaskWarningRow,
    authorization: AuthorizationContextV1,
    authorizedScopeIds: readonly string[],
    taskTarget: {
      readonly kind: string;
      readonly reference: { readonly entityId: string; readonly versionId: string };
    },
  ): Promise<LoadedWarningV1> {
    const row = await this.#db
      .selectFrom("business.warning_records as warning")
      .innerJoin("business.risk_assessment_records as record", (join) =>
        join
          .onRef("record.record_id", "=", "warning.assessment_record_id")
          .onRef("record.version_id", "=", "warning.assessment_record_version_id"),
      )
      .innerJoin("business.assessment_input_snapshots as input", (join) =>
        join
          .onRef("input.input_snapshot_id", "=", "warning.assessment_input_snapshot_id")
          .onRef("input.version_id", "=", "warning.assessment_input_snapshot_version_id"),
      )
      .innerJoin("business.assessment_preparation_snapshots as preparation", (join) =>
        join
          .onRef("preparation.snapshot_id", "=", "warning.preparation_snapshot_id")
          .onRef("preparation.version_id", "=", "warning.preparation_snapshot_version_id"),
      )
      .select([
        "warning.warning_record_id as warning_record_id",
        "warning.version_id as warning_version_id",
        "warning.assessment_record_id as assessment_record_id",
        "warning.assessment_record_version_id as assessment_record_version_id",
        "warning.assessment_input_snapshot_id as assessment_input_snapshot_id",
        "warning.assessment_input_snapshot_version_id as assessment_input_snapshot_version_id",
        "warning.preparation_snapshot_id as preparation_snapshot_id",
        "warning.preparation_snapshot_version_id as preparation_snapshot_version_id",
        "warning.spatial_scope_entity_id as spatial_scope_entity_id",
        "warning.risk_input_kind as risk_input_kind",
        "warning.risk_input_entity_id as risk_input_entity_id",
        "warning.risk_input_version_id as risk_input_version_id",
        "warning.warning_payload as warning_payload",
        "input.basis_release_set_ref as basis_release_set_ref",
        "input.snapshot_payload as input_snapshot_payload",
        "preparation.applicability_values as applicability_values",
      ] as const)
      .where("warning.project_id", "=", authorization.projectId)
      .where("warning.warning_record_id", "=", link.warning_record_id)
      .where("warning.version_id", "=", link.warning_record_version_id)
      .where("warning.spatial_scope_entity_id", "in", authorizedScopeIds)
      .executeTakeFirst();
    if (row === undefined) {
      failRecommendation(
        "recommendation-authorization-required",
        taskTarget,
        "AUTHORIZATION_DENIED",
      );
    }
    const warningRecord = WarningRecordSchema.safeParse(row.warning_payload);
    const inputSnapshot = AssessmentInputSnapshotV1Schema.safeParse(row.input_snapshot_payload);
    const applicability = ApplicabilityMetadataSnapshotV1Schema.safeParse(row.applicability_values);
    if (
      !warningRecord.success ||
      !inputSnapshot.success ||
      !applicability.success ||
      warningRecord.data.warningRecordId !== row.warning_record_id ||
      warningRecord.data.assessmentRecordId !== row.assessment_record_id
    ) {
      failRecommendation("recommendation-contract-drift", taskTarget);
    }
    return {
      warningRef: {
        warningRecordRef: {
          kind: "warning-record",
          reference: { entityId: row.warning_record_id, versionId: row.warning_version_id },
        },
        triggerType: warningRecord.data.triggerType,
        triggerIndicators: warningRecord.data.triggerIndicators,
        resolvedTargetIndicatorIds: [],
        unresolvedTriggerItems: [],
        evidenceReferences: warningRecord.data.evidenceReferences,
        assessmentRecordRef: {
          kind: "risk-assessment-record",
          reference: {
            entityId: row.assessment_record_id,
            versionId: row.assessment_record_version_id,
          },
        },
        assessmentInputSnapshotRef: {
          kind: "assessment-input-snapshot",
          reference: {
            entityId: row.assessment_input_snapshot_id,
            versionId: row.assessment_input_snapshot_version_id,
          },
        },
        preparationSnapshotRef: {
          kind: "assessment-preparation-snapshot",
          reference: {
            entityId: row.preparation_snapshot_id,
            versionId: row.preparation_snapshot_version_id,
          },
        },
      },
      inputSnapshot: inputSnapshot.data,
      riskInputRef: RiskInputVersionRefV1Schema.parse({
        kind: row.risk_input_kind,
        reference: {
          entityId: row.risk_input_entity_id,
          versionId: row.risk_input_version_id,
        },
      }),
      applicability: applicability.data.applicabilityMetadata,
      basisRef: parseBasisReleaseSetRef(row.basis_release_set_ref, taskTarget),
    };
  }

  async #readConfigurationDocument(
    requestId: string,
    requestedAt: string,
    authorization: AuthorizationContextV1,
    artifactRef: {
      readonly kind: "content-artifact";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    },
    definitionType: string,
  ): Promise<unknown> {
    const readId = `${requestId}:${definitionType}`;
    const handle = await this.#artifactStore.open(
      ArtifactReadRequestV1Schema.parse({
        schemaVersion: "1",
        requestId: readId,
        idempotencyKey: readId,
        artifactRef,
        projectId: authorization.projectId,
        actorId: authorization.actorId,
        requestedAt,
        purposeCode: ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
        requiredCapability: "knowledge-modeling.retrieve",
        authorization,
      }),
    );
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    for await (const chunk of handle.content) {
      byteLength += chunk.byteLength;
      if (byteLength > MAX_ARTIFACT_BYTES_V1) {
        failRecommendation("measure-candidates-unavailable", artifactRef);
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(buffer)) as unknown;
    } catch {
      failRecommendation("measure-candidates-unavailable", artifactRef);
    }
    return parsed;
  }
}

/* -------------------------------------------------------------------------- */
/* 命令 adapter：候选冻结、建议候选、三项校验与正式入库                          */
/* -------------------------------------------------------------------------- */

export interface PostgresRecommendationAdapterOptionsV1 {
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: TransactionUnitV1;
  readonly access: LocalIdentityAccessV1;
  readonly artifactStore: ArtifactStoreV1;
  readonly reader: RecommendationContextReaderV1;
  readonly policies: RecommendationPolicyProviderV1;
  readonly agentTasks: RecommendationAgentTaskReaderV1;
  readonly reviewAudit?: RecommendationReviewAuditPortV1;
  readonly reviewAuthorization?: RecommendationReviewAuthorizationProviderV1;
  readonly taskAuthorization?: RecommendationTaskAuthorizationProviderV1;
  readonly now?: () => Date;
}

/**
 * 候选集窄读的调用身份与精确对象引用。授权、调用标识与查询结果引用三者一同绑定，
 * C27 用同一 `invocationId`、同一分支亲自向 C06 复验。
 */
export type MeasureCandidateSetReadInputV1 = {
  readonly projectId: string;
  readonly actorId: string;
  readonly requestedAt: string;
  readonly invocationId: string;
  readonly authorization: AuthorizationContextV1;
  readonly knowledgeQueryResultRef: KnowledgeQueryResultRefV1;
};

export type MeasureCandidateSetReadResultV1 =
  | {
      readonly kind: "succeeded";
      readonly knowledgeQueryResultRef: KnowledgeQueryResultRefV1;
      /** 已冻结的候选集原文：组合根据此合成 Agent 任务输入，不自行拼装候选。 */
      readonly candidateSet: MeasureCandidateSetV1;
      readonly candidateSetArtifactRef: {
        readonly kind: "content-artifact";
        readonly reference: { readonly entityId: string; readonly versionId: string };
      };
    }
  | { readonly kind: "failed"; readonly error: { readonly code: string } };

export class PostgresRecommendationAdapter
  implements
    RecommendationServiceV1,
    ResponseRecommendationTaskPortV1,
    WarningResponseRecommendationReaderV1
{
  readonly #db: Kysely<RecommendationDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #access: LocalIdentityAccessV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #reader: RecommendationContextReaderV1;
  readonly #policies: RecommendationPolicyProviderV1;
  readonly #agentTasks: RecommendationAgentTaskReaderV1;
  readonly #reviewAudit: RecommendationReviewAuditPortV1 | undefined;
  readonly #reviewAuthorization: RecommendationReviewAuthorizationProviderV1 | undefined;
  readonly #taskAuthorization: RecommendationTaskAuthorizationProviderV1 | undefined;
  readonly #now: () => Date;

  constructor(options: PostgresRecommendationAdapterOptionsV1) {
    this.#db = options.db as unknown as Kysely<RecommendationDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#access = options.access;
    this.#artifactStore = options.artifactStore;
    this.#reader = options.reader;
    this.#policies = options.policies;
    this.#agentTasks = options.agentTasks;
    this.#reviewAudit = options.reviewAudit;
    this.#reviewAuthorization = options.reviewAuthorization;
    this.#taskAuthorization = options.taskAuthorization;
    this.#now = options.now ?? (() => new Date());
  }

  // ------------------------------------------------------------- authorization

  #failAuthorization(branch: ModuleBranchV1): never {
    return failRecommendation(
      "recommendation-authorization-required",
      {
        kind: "authorization-context",
        reference: {
          entityId: `warning-response.unauthorized.${branch}`,
          versionId: "1",
        },
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
      readonly issuedAt: string;
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

  // ---------------------------------------------------------------- measureCandidates

  async measureCandidates(query: KnowledgeRetrievalQueryV1): Promise<KnowledgeRetrievalResultV1> {
    const parsed = KnowledgeRetrievalQueryV1Schema.safeParse(query);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: this.#terminalError("unknown", "knowledge-modeling.measure-candidates"),
      };
    }
    const valid = parsed.data;
    try {
      if (valid.kind !== "measure-candidates") {
        return {
          kind: "failed",
          error: this.#terminalError(valid.queryId, "knowledge-modeling.measure-candidates"),
        };
      }
      const verified = await this.#verify(
        {
          commandId: valid.queryId,
          projectId: valid.projectId,
          actorId: valid.actorId,
          authorization: valid.authorization,
          issuedAt: valid.requestedAt,
        },
        "knowledge-modeling.measure-candidates",
      );
      const context = await this.#reader.readFrozenContext({
        requestId: valid.queryId,
        requestedAt: valid.requestedAt,
        authorization: verified,
        warningResponseTaskRef: valid.payload.warningResponseTaskRef,
        measureLibraryReleaseRef: valid.payload.measureLibraryReleaseRef,
      });
      const generationPolicy = await this.#policies.readGenerationPolicy({
        requestId: valid.queryId,
        requestedAt: valid.requestedAt,
        authorization: verified,
        generationPolicyRef: context.generationPolicyRef,
      });
      const binding = generationPolicy.bindings.find(
        (candidate) =>
          candidate.riskInputRef.kind === context.riskInputRef.kind &&
          sameRef(candidate.riskInputRef.reference, context.riskInputRef.reference),
      );
      const assessmentLinked = context.warnings.some((warning) =>
        sameRef(warning.assessmentRecordRef.reference, valid.payload.assessmentRecordRef.reference),
      );
      if (
        !assessmentLinked ||
        binding === undefined ||
        generationPolicy.projectId !== verified.projectId
      ) {
        failRecommendation("measure-category-unbound", {
          kind: context.riskInputRef.kind,
          reference: context.riskInputRef.reference,
        });
      }
      const candidates = selectFrozenMeasures({
        library: context.measureLibrary,
        riskEventCategory: binding.riskEventCategory,
        applicability: context.applicability,
        warnings: context.warnings.map((warning) => ({
          warningRecordRef: warning.warningRecordRef,
          triggerType: warning.triggerType,
        })),
      });
      if (candidates.length === 0) {
        failRecommendation("measure-candidates-empty", {
          kind: "measure-library-release",
          reference: context.measureLibraryReleaseRef.reference,
        });
      }
      const inputDigest = measureCandidateInputDigest({
        projectId: context.projectId,
        warningResponseTaskRef: context.warningResponseTaskRef,
        riskInputRef: context.riskInputRef,
        measureLibraryReleaseRef: context.measureLibraryReleaseRef,
        generationPolicyRef: context.generationPolicyRef,
        riskEventCategory: binding.riskEventCategory,
        warnings: context.warnings,
      });
      const queryResultRef = {
        kind: "knowledge-query-result" as const,
        reference: { entityId: `measure-candidates-${inputDigest.slice(0, 32)}`, versionId: "1" },
      };
      const existing = await this.#readQueryByInput({
        projectId: context.projectId,
        taskId: context.warningResponseTaskRef.reference.entityId,
        taskVersionId: context.warningResponseTaskRef.reference.versionId,
        measureLibraryReleaseRef: context.measureLibraryReleaseRef.reference,
        inputDigest,
      });
      const atomicCommand = this.#atomicCommand(
        {
          commandId: valid.queryId,
          idempotencyKey: valid.queryId,
          projectId: context.projectId,
          actorId: verified.actorId,
          issuedAt: valid.requestedAt,
          authorization: valid.authorization,
        },
        "knowledge-modeling.measure-candidates",
        { query: valid.payload, riskEventCategory: binding.riskEventCategory, inputDigest },
      );
      if (existing !== undefined) {
        const resultRef = refOfQueryRow(existing);
        await this.#executeWithRetry(atomicCommand, async (): Promise<AtomicCommitV1> => {
          const auditEntryId = `audit-${valid.queryId}:measure-candidates`;
          return {
            resultRef,
            audit: {
              auditEntryId,
              projectId: context.projectId,
              action: "knowledge-modeling.measure-candidates",
              targetRef: context.warningResponseTaskRef,
              actorRef: verified.actorId,
              authorizationContextRef: valid.authorization.authorizationContextRef,
              occurredAt: valid.requestedAt,
              recordedAt: this.#nowIso(),
              version: { entityId: auditEntryId, versionId: "1" },
              commandId: valid.queryId,
              idempotencyKey: valid.queryId,
            },
            events: [],
          };
        });
        return {
          kind: "succeeded",
          result: { knowledgeQueryResultRef: resultRef },
        };
      }
      const recordedAt = this.#nowIso();
      const candidateSet = MeasureCandidateSetV1Schema.parse({
        schemaVersion: "1",
        projectId: context.projectId,
        warningResponseTaskRef: context.warningResponseTaskRef,
        riskInputRef: context.riskInputRef,
        spatialScopeRef: context.spatialScopeRef,
        applicableRuleSetRef: context.applicableRuleSetRef,
        basisReleaseSetRef: context.basisReleaseSetRef,
        measureLibraryReleaseRef: context.measureLibraryReleaseRef,
        measureArtifactRef: context.measureArtifactRef,
        measureContentDigest: context.measureContentDigest,
        generationPolicyRef: context.generationPolicyRef,
        validationPolicyRef: context.validationPolicyRef,
        agentPolicyRef: context.agentPolicyRef,
        reviewPolicyRef: context.reviewPolicyRef,
        riskEventCategory: binding.riskEventCategory,
        warnings: context.warnings,
        candidates,
        inputDigest,
        frozenAt: recordedAt,
        frozenBy: verified.actorId,
      });
      const candidateSetDigest = sha256CanonicalJson(candidateSet);
      const artifactRef = await this.#putArtifact({
        commandId: valid.queryId,
        projectId: context.projectId,
        actorId: verified.actorId,
        issuedAt: valid.requestedAt,
        authorization: verified,
        requiredCapability: "knowledge-modeling.retrieve",
        purposeCode: MEASURE_CANDIDATE_SET_PURPOSE_CODE_V1,
        mediaType: MEASURE_CANDIDATE_SET_MEDIA_TYPE_V1,
        artifactId: `measure-candidate-set-${inputDigest.slice(0, 32)}`,
        parentArtifactRefs: [context.measureArtifactRef],
        value: candidateSet,
      });
      await this.#executeWithRetry(
        atomicCommand,
        async (transactionContext): Promise<AtomicCommitV1> => {
          const transaction = asTransaction(transactionContext);
          const auditEntryId = `audit-${valid.queryId}:measure-candidates`;
          await transaction
            .insertInto("business.measure_candidate_queries")
            .values({
              query_result_id: queryResultRef.reference.entityId,
              version_id: queryResultRef.reference.versionId,
              schema_version: "1",
              project_id: context.projectId,
              warning_response_task_id: context.warningResponseTaskRef.reference.entityId,
              warning_response_task_version_id: context.warningResponseTaskRef.reference.versionId,
              risk_input_kind: context.riskInputRef.kind,
              risk_input_entity_id: context.riskInputRef.reference.entityId,
              risk_input_version_id: context.riskInputRef.reference.versionId,
              spatial_scope_entity_id: context.spatialScopeRef.reference.entityId,
              spatial_scope_version_id: context.spatialScopeRef.reference.versionId,
              risk_event_category: binding.riskEventCategory,
              generation_policy_entity_id: context.generationPolicyRef.entityId,
              generation_policy_version_id: context.generationPolicyRef.versionId,
              basis_release_set_id: context.basisReleaseSetRef.reference.entityId,
              basis_release_set_version_id: context.basisReleaseSetRef.reference.versionId,
              measure_library_release_id: context.measureLibraryReleaseRef.reference.entityId,
              measure_library_release_version_id:
                context.measureLibraryReleaseRef.reference.versionId,
              measure_artifact_id: context.measureArtifactRef.reference.entityId,
              measure_artifact_version_id: context.measureArtifactRef.reference.versionId,
              measure_content_digest: context.measureContentDigest,
              input_digest: inputDigest,
              candidate_count: candidates.length,
              candidate_set_artifact_id: artifactRef.reference.entityId,
              candidate_set_artifact_version_id: artifactRef.reference.versionId,
              candidate_set_digest: candidateSetDigest,
              candidate_set_payload: jsonValue(candidateSet),
              warning_links: jsonValue(context.warnings),
              command_id: valid.queryId,
              idempotency_key: valid.queryId,
              actor_ref: verified.actorId,
              authorization_context_ref: jsonValue(valid.authorization.authorizationContextRef),
              audit_entry_id: auditEntryId,
              occurred_at: valid.requestedAt,
              recorded_at: recordedAt,
            } as never)
            .onConflict((conflict) => conflict.doNothing())
            .execute();
          return {
            resultRef: queryResultRef,
            audit: {
              auditEntryId,
              projectId: context.projectId,
              action: "knowledge-modeling.measure-candidates",
              targetRef: context.warningResponseTaskRef,
              actorRef: verified.actorId,
              authorizationContextRef: valid.authorization.authorizationContextRef,
              occurredAt: valid.requestedAt,
              recordedAt,
              version: { entityId: auditEntryId, versionId: "1" },
              commandId: valid.queryId,
              idempotencyKey: valid.queryId,
            },
            events: [],
          };
        },
      );
      return { kind: "succeeded", result: { knowledgeQueryResultRef: queryResultRef } };
    } catch (error: unknown) {
      return {
        kind: "failed",
        error: this.#toModuleError(error, valid.queryId, "knowledge-modeling.retrieve"),
      };
    }
  }

  // ---------------------------------------------------------------- createCandidate

  async createCandidate(command: CreateCandidateCommandV1): Promise<RecommendationResultV1> {
    const parsed = RecommendationCommandV1Schema.safeParse(command);
    if (!parsed.success || parsed.data.kind !== "create-candidate") {
      return {
        kind: "failed",
        error: this.#terminalError("unknown", "warning-response.create-candidate"),
      };
    }
    const valid = parsed.data;
    try {
      const verified = await this.#verify(valid, "warning-response.create-candidate");
      const agentResult = valid.payload.agentTaskResultRef;
      const candidateRef = await this.#bindAgentResult({
        projectId: valid.projectId,
        spatialScopeIds: verified.spatialScopeRefs.map((scope) => scope.reference.entityId),
        warningResponseTaskRef: valid.payload.warningResponseTaskRef,
        measureCandidateQueryResultRef: valid.payload.measureCandidateQueryResultRef,
        responseGenerationPolicyRef: valid.payload.responseGenerationPolicyRef,
        agentResult,
      });
      const receipt = await this.#executeWithRetry(
        this.#atomicCommand(valid, "warning-response.create-candidate", valid.payload),
        async (transactionContext): Promise<AtomicCommitV1> => {
          const transaction = asTransaction(transactionContext);
          const row = await transaction
            .selectFrom("business.recommendation_candidates")
            .select(["candidate_id", "version_id"])
            .where("project_id", "=", valid.projectId)
            .where("candidate_id", "=", candidateRef.reference.entityId)
            .executeTakeFirst();
          if (row === undefined) {
            failRecommendation("recommendation-candidate-mismatch", candidateRef);
          }
          const auditEntryId = `audit-${valid.commandId}:recommendation-candidate`;
          return {
            resultRef: candidateRef,
            audit: {
              auditEntryId,
              projectId: valid.projectId,
              action: "warning-response.create-candidate",
              targetRef: candidateRef,
              actorRef: verified.actorId,
              authorizationContextRef: valid.authorization.authorizationContextRef,
              occurredAt: valid.issuedAt,
              recordedAt: this.#nowIso(),
              version: { entityId: auditEntryId, versionId: "1" },
              commandId: valid.commandId,
              idempotencyKey: valid.idempotencyKey,
            },
            events: [],
          };
        },
      );
      return {
        kind: "succeeded",
        result: {
          kind: "candidate",
          recommendationCandidateRef: receipt.resultRef as RecommendationCandidateRefV1,
        },
      };
    } catch (error: unknown) {
      return {
        kind: "failed",
        error: this.#toModuleError(error, valid.commandId, "warning-response.recommend"),
      };
    }
  }

  /**
   * D-05：命令只接受与冻结依据精确对应的已完成 C08 结果；
   * 任务类型、结果族、候选版本、生成策略、查询与工程任一不符即类型化拒绝。
   */
  async #bindAgentResult(input: {
    readonly projectId: string;
    readonly spatialScopeIds: readonly string[];
    readonly warningResponseTaskRef: {
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
    readonly measureCandidateQueryResultRef: KnowledgeQueryResultRefV1;
    readonly responseGenerationPolicyRef: { readonly entityId: string; readonly versionId: string };
    readonly agentResult: AgentTaskResultRefV1;
  }): Promise<RecommendationCandidateRefV1> {
    const agentResult = input.agentResult;
    if (
      agentResult.status !== "completed" ||
      agentResult.agentTaskRef.taskType !== RECOMMENDATION_TASK_TYPE_V1 ||
      !("candidateRef" in agentResult) ||
      agentResult.candidateRef === undefined ||
      agentResult.candidateRef.kind !== "recommendation-candidate"
    ) {
      failRecommendation("agent-task-result-mismatch", {
        kind: "agent-task",
        reference: agentResult.agentTaskRef.reference,
      });
    }
    const candidateRef = agentResult.candidateRef;
    const candidateRow = await this.#readCandidateRow(
      input.projectId,
      candidateRef,
      input.spatialScopeIds,
    );
    if (candidateRow === undefined) {
      failRecommendation(
        "recommendation-authorization-required",
        candidateRef,
        "AUTHORIZATION_DENIED",
      );
    }
    const queryRow = await this.#readQueryById(
      input.projectId,
      { entityId: candidateRow.query_result_id, versionId: candidateRow.query_result_version_id },
      input.spatialScopeIds,
    );
    if (queryRow === undefined) {
      failRecommendation(
        "recommendation-authorization-required",
        candidateRef,
        "AUTHORIZATION_DENIED",
      );
    }
    const task = await this.#agentTasks.getTask(agentResult.agentTaskRef);
    if (
      task === undefined ||
      task.envelope.projectId !== input.projectId ||
      task.envelope.taskType !== RECOMMENDATION_TASK_TYPE_V1 ||
      task.state.status !== "completed" ||
      task.state.resultRef === undefined ||
      JSON.stringify(task.state.resultRef) !== JSON.stringify(agentResult) ||
      task.envelope.frozenInputRef.kind !== "knowledge-query-result" ||
      !sameRef(
        task.envelope.frozenInputRef.reference,
        input.measureCandidateQueryResultRef.reference,
      )
    ) {
      failRecommendation("agent-task-result-mismatch", {
        kind: "agent-task",
        reference: agentResult.agentTaskRef.reference,
      });
    }
    const consistent =
      candidateRow.warning_response_task_id === input.warningResponseTaskRef.reference.entityId &&
      candidateRow.warning_response_task_version_id ===
        input.warningResponseTaskRef.reference.versionId &&
      candidateRow.query_result_id === input.measureCandidateQueryResultRef.reference.entityId &&
      candidateRow.query_result_version_id ===
        input.measureCandidateQueryResultRef.reference.versionId &&
      candidateRow.generation_policy_entity_id === input.responseGenerationPolicyRef.entityId &&
      candidateRow.generation_policy_version_id === input.responseGenerationPolicyRef.versionId &&
      candidateRow.agent_task_id === agentResult.agentTaskRef.reference.entityId &&
      candidateRow.agent_task_type === RECOMMENDATION_TASK_TYPE_V1 &&
      candidateRow.agent_result_id === agentResult.reference.entityId &&
      candidateRow.agent_result_version_id === agentResult.reference.versionId &&
      queryRow.project_id === input.projectId &&
      queryRow.warning_response_task_id === candidateRow.warning_response_task_id &&
      queryRow.warning_response_task_version_id === candidateRow.warning_response_task_version_id;
    if (!consistent) {
      failRecommendation("recommendation-candidate-mismatch", candidateRef);
    }
    return {
      kind: "recommendation-candidate",
      reference: {
        entityId: candidateRow.candidate_id,
        versionId: candidateRow.version_id,
      },
    };
  }

  // -------------------------------------------------------------- validateAndRecord

  async validateAndRecord(command: ValidateAndRecordCommandV1): Promise<RecommendationResultV1> {
    const parsed = RecommendationCommandV1Schema.safeParse(command);
    if (!parsed.success || parsed.data.kind !== "validate-and-record") {
      return {
        kind: "failed",
        error: this.#terminalError("unknown", "warning-response.validate-and-record"),
      };
    }
    const valid = parsed.data;
    try {
      const verified = await this.#verify(valid, "warning-response.validate-and-record");
      const candidateRef = valid.payload.recommendationCandidateRef;
      const spatialScopeIds = verified.spatialScopeRefs.map((scope) => scope.reference.entityId);
      const candidateRow = await this.#readCandidateRow(
        valid.projectId,
        candidateRef,
        spatialScopeIds,
      );
      if (candidateRow === undefined) {
        failRecommendation(
          "recommendation-authorization-required",
          candidateRef,
          "AUTHORIZATION_DENIED",
        );
      }
      const queryRow = await this.#readQueryById(
        valid.projectId,
        { entityId: candidateRow.query_result_id, versionId: candidateRow.query_result_version_id },
        spatialScopeIds,
      );
      if (queryRow === undefined) {
        failRecommendation(
          "recommendation-authorization-required",
          candidateRef,
          "AUTHORIZATION_DENIED",
        );
      }
      const candidateSet = MeasureCandidateSetV1Schema.parse(queryRow.candidate_set_payload);
      const candidate = this.#readCandidatePayload(candidateRow);
      if (
        !sameRef(candidate.warningResponseTaskRef.reference, {
          entityId: queryRow.warning_response_task_id,
          versionId: queryRow.warning_response_task_version_id,
        }) ||
        !sameRef(candidate.measureCandidateQueryResultRef.reference, {
          entityId: queryRow.query_result_id,
          versionId: queryRow.version_id,
        }) ||
        !sameRef(candidate.generationPolicyRef, {
          entityId: queryRow.generation_policy_entity_id,
          versionId: queryRow.generation_policy_version_id,
        }) ||
        !sameRef(candidateSet.generationPolicyRef, candidate.generationPolicyRef)
      ) {
        failRecommendation("recommendation-candidate-mismatch", candidateRef);
      }
      if (!sameRef(candidateSet.validationPolicyRef, valid.payload.responseValidationPolicyRef)) {
        failRecommendation("response-policy-mismatch", candidateRef);
      }
      const { validationPolicy, siteContext } = await this.#policies.readValidationContext({
        requestId: valid.commandId,
        requestedAt: valid.issuedAt,
        authorization: verified,
        validationPolicyRef: valid.payload.responseValidationPolicyRef,
        siteContextRef: valid.payload.siteContextRef,
      });
      if (
        validationPolicy.projectId !== valid.projectId ||
        !sameRef(validationPolicy.policyRef, valid.payload.responseValidationPolicyRef) ||
        !sameRef(siteContext.siteContextRef, valid.payload.siteContextRef) ||
        siteContext.projectId !== valid.projectId ||
        !sameRef(siteContext.spatialScopeRef.reference, candidateSet.spatialScopeRef.reference)
      ) {
        failRecommendation("site-context-mismatch", {
          kind: "spatial-scope",
          reference: candidateSet.spatialScopeRef.reference,
        });
      }
      const outcome = validateRecommendationCandidate({
        candidateSet,
        selections: candidate.selections,
        validationPolicy,
        siteContext,
      });
      const validatedAt = this.#nowIso();
      const bindingDigest = sha256CanonicalJson({
        candidateRef,
        validationPolicyRef: valid.payload.responseValidationPolicyRef,
        siteContextRef: valid.payload.siteContextRef,
      });
      const validationId = `recommendation-validation-${bindingDigest.slice(0, 32)}`;
      const evidence = buildRecommendationValidationEvidence({
        projectId: valid.projectId,
        candidate,
        validationPolicyRef: valid.payload.responseValidationPolicyRef,
        siteContextRef: valid.payload.siteContextRef,
        outcome,
        validatedBy: verified.actorId,
        validatedAt,
      });
      const evidenceArtifactRef = await this.#putArtifact({
        commandId: `${valid.commandId}:evidence`,
        projectId: valid.projectId,
        actorId: verified.actorId,
        issuedAt: valid.issuedAt,
        authorization: verified,
        requiredCapability: "warning-response.recommend",
        purposeCode: RECOMMENDATION_EVIDENCE_PURPOSE_CODE_V1,
        mediaType: RECOMMENDATION_EVIDENCE_MEDIA_TYPE_V1,
        artifactId: `recommendation-evidence-${validationId}`,
        parentArtifactRefs: [
          {
            kind: "content-artifact",
            reference: {
              entityId: candidateRow.candidate_artifact_id,
              versionId: candidateRow.candidate_artifact_version_id,
            },
          },
        ],
        value: evidence,
      });
      const evidenceDigest = sha256CanonicalJson(evidence);
      const passed = recommendationValidationPassed(outcome.results);
      const recordTarget = passed
        ? ({
            kind: "response-recommendation",
            reference: {
              entityId: `response-recommendation-${bindingDigest.slice(0, 32)}`,
              versionId: "1",
            },
          } as const)
        : await this.#requestReview({
            commandId: valid.commandId,
            issuedAt: valid.issuedAt,
            projectId: valid.projectId,
            actorId: verified.actorId,
            authorization: valid.authorization,
            candidateRef,
            candidate,
            candidateSet,
            validationId,
            evidenceDigest,
          });
      const receipt = await this.#executeWithRetry(
        this.#atomicCommand(valid, "warning-response.validate-and-record", valid.payload),
        async (transactionContext): Promise<AtomicCommitV1> =>
          this.#validateAndRecordCommit(transactionContext, {
            valid,
            verified,
            candidateRef,
            candidateRow,
            candidate,
            candidateSet,
            outcome,
            evidence,
            evidenceArtifactRef,
            validationId,
            recordTarget,
          }),
      );
      if (receipt.resultRef.kind === "response-recommendation") {
        return {
          kind: "succeeded",
          result: {
            kind: "recorded",
            responseRecommendationRef: receipt.resultRef as never,
          },
        };
      }
      return {
        kind: "succeeded",
        result: { kind: "waiting-review", reviewTaskRef: receipt.resultRef as ReviewTaskRefV1 },
      };
    } catch (error: unknown) {
      return {
        kind: "failed",
        error: this.#toModuleError(error, valid.commandId, "warning-response.recommend"),
      };
    }
  }

  /** 校验事实与正式建议在同一 C03 事务内落库，审计失败整体回滚。 */
  async #validateAndRecordCommit(
    transactionContext: TransactionContextV1,
    input: {
      readonly valid: ValidateAndRecordCommandV1;
      readonly verified: AuthorizationContextV1;
      readonly candidateRef: RecommendationCandidateRefV1;
      readonly candidateRow: RecommendationCandidateRow;
      readonly candidate: RecommendationCandidateV1;
      readonly candidateSet: MeasureCandidateSetV1;
      readonly outcome: RecommendationValidationOutcomeV1;
      readonly evidence: RecommendationValidationEvidenceV1;
      readonly evidenceArtifactRef: ContentArtifactRefV1;
      readonly validationId: string;
      readonly recordTarget:
        | {
            readonly kind: "response-recommendation";
            readonly reference: { readonly entityId: string; readonly versionId: string };
          }
        | ReviewTaskRefV1;
    },
  ): Promise<AtomicCommitV1> {
    const { valid, verified, candidateRef, candidateRow, candidate, candidateSet, outcome } = input;
    const transaction = asTransaction(transactionContext);
    const recordedAt = this.#nowIso();
    const auditEntryId = `audit-${valid.commandId}:recommendation-validation`;
    const reviewTaskRef =
      input.recordTarget.kind === "review-task" ? input.recordTarget : undefined;
    await transaction
      .insertInto("business.recommendation_validations")
      .values({
        validation_id: input.validationId,
        version_id: "1",
        schema_version: "1",
        project_id: valid.projectId,
        candidate_id: candidateRef.reference.entityId,
        candidate_version_id: candidateRef.reference.versionId,
        candidate_content_digest: candidateRow.content_digest,
        validation_policy_entity_id: valid.payload.responseValidationPolicyRef.entityId,
        validation_policy_version_id: valid.payload.responseValidationPolicyRef.versionId,
        site_context_entity_id: valid.payload.siteContextRef.entityId,
        site_context_version_id: valid.payload.siteContextRef.versionId,
        trigger_consistency_passed: outcome.results.triggerConsistency.passed,
        standards_compliance_passed: outcome.results.standardsCompliance.passed,
        site_feasibility_passed: outcome.results.siteFeasibility.passed,
        validation_payload: jsonValue(input.evidence),
        evidence_artifact_id: input.evidenceArtifactRef.reference.entityId,
        evidence_artifact_version_id: input.evidenceArtifactRef.reference.versionId,
        evidence_digest: sha256CanonicalJson(input.evidence),
        review_task_id: reviewTaskRef?.reference.entityId ?? null,
        review_task_version_id: reviewTaskRef?.reference.versionId ?? null,
        review_task_status: reviewTaskRef === undefined ? null : "pending",
        command_id: valid.commandId,
        idempotency_key: valid.idempotencyKey,
        actor_ref: verified.actorId,
        authorization_context_ref: jsonValue(valid.authorization.authorizationContextRef),
        audit_entry_id: auditEntryId,
        occurred_at: valid.issuedAt,
        recorded_at: recordedAt,
      } as never)
      .onConflict((conflict) => conflict.doNothing())
      .execute();
    if (input.recordTarget.kind === "response-recommendation") {
      const record = buildResponseRecommendationRecord({
        recommendationRef: input.recordTarget,
        primaryWarningRecordRef: candidate.primaryWarningRecordRef,
        outcome,
        actorId: verified.actorId,
        recordedAt,
      });
      const primaryWarning = candidateSet.warnings.find((warning) =>
        sameRef(warning.warningRecordRef.reference, candidate.primaryWarningRecordRef.reference),
      );
      if (primaryWarning === undefined) {
        failRecommendation("recommendation-candidate-mismatch", candidateRef);
      }
      await transaction
        .insertInto("business.response_recommendations")
        .values({
          recommendation_id: input.recordTarget.reference.entityId,
          version_id: input.recordTarget.reference.versionId,
          schema_version: "1",
          project_id: valid.projectId,
          candidate_id: candidateRef.reference.entityId,
          candidate_version_id: candidateRef.reference.versionId,
          validation_id: input.validationId,
          validation_version_id: "1",
          warning_response_task_id: candidateSet.warningResponseTaskRef.reference.entityId,
          warning_response_task_version_id: candidateSet.warningResponseTaskRef.reference.versionId,
          warning_record_id: candidate.primaryWarningRecordRef.reference.entityId,
          warning_record_version_id: candidate.primaryWarningRecordRef.reference.versionId,
          assessment_record_id: primaryWarning.assessmentRecordRef.reference.entityId,
          assessment_record_version_id: primaryWarning.assessmentRecordRef.reference.versionId,
          spatial_scope_entity_id: candidateSet.spatialScopeRef.reference.entityId,
          spatial_scope_version_id: candidateSet.spatialScopeRef.reference.versionId,
          measure_library_release_id: candidateSet.measureLibraryReleaseRef.reference.entityId,
          measure_library_release_version_id:
            candidateSet.measureLibraryReleaseRef.reference.versionId,
          generation_policy_entity_id: candidateSet.generationPolicyRef.entityId,
          generation_policy_version_id: candidateSet.generationPolicyRef.versionId,
          validation_policy_entity_id: valid.payload.responseValidationPolicyRef.entityId,
          validation_policy_version_id: valid.payload.responseValidationPolicyRef.versionId,
          site_context_entity_id: valid.payload.siteContextRef.entityId,
          site_context_version_id: valid.payload.siteContextRef.versionId,
          agent_task_id: candidateRow.agent_task_id,
          agent_result_id: candidateRow.agent_result_id,
          agent_result_version_id: candidateRow.agent_result_version_id,
          review_status: "pending",
          record_payload: jsonValue(record),
          warning_links: jsonValue(candidateSet.warnings),
          content_digest: sha256CanonicalJson(record),
          command_id: valid.commandId,
          idempotency_key: valid.idempotencyKey,
          actor_ref: verified.actorId,
          authorization_context_ref: jsonValue(valid.authorization.authorizationContextRef),
          audit_entry_id: auditEntryId,
          occurred_at: valid.issuedAt,
          recorded_at: recordedAt,
        } as never)
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    }
    return {
      resultRef: input.recordTarget,
      audit: {
        auditEntryId,
        projectId: valid.projectId,
        action: "warning-response.validate-and-record",
        targetRef: candidateRef,
        actorRef: verified.actorId,
        authorizationContextRef: valid.authorization.authorizationContextRef,
        occurredAt: valid.issuedAt,
        recordedAt,
        version: { entityId: auditEntryId, versionId: "1" },
        commandId: valid.commandId,
        idempotencyKey: valid.idempotencyKey,
      },
      events: [],
    };
  }

  /**
   * 三项失败时先使 C04 快照耐久，再以稳定幂等键请求 C07 独立原子复核；
   * 没有任何合法等待运行或复核端口时失败闭合，不伪造 review ref。
   */
  async #requestReview(input: {
    readonly commandId: string;
    readonly issuedAt: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
    readonly candidateRef: RecommendationCandidateRefV1;
    readonly candidate: RecommendationCandidateV1;
    readonly candidateSet: MeasureCandidateSetV1;
    readonly validationId: string;
    readonly evidenceDigest: string;
  }): Promise<ReviewTaskRefV1> {
    const audit = this.#reviewAudit;
    const provider = this.#reviewAuthorization;
    if (audit === undefined || provider === undefined) {
      failRecommendation("recommendation-validation-rejected", input.candidateRef);
    }
    const invocationId = `${input.commandId}:review`;
    const context = await provider.authorize({
      task: "request-review",
      projectId: input.projectId,
      actorId: input.actorId,
      invocationId,
      requestedAt: input.issuedAt,
      branch: "review-audit.request-review",
      candidateRef: input.candidateRef,
    });
    const decision = await this.#access
      .verify({
        authorizationContextRef: context.authorizationContextRef,
        invocationId,
        projectId: input.projectId,
        branch: "review-audit.request-review",
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        requestedAt: input.issuedAt,
      })
      .catch((error: unknown) => {
        if (error instanceof AccessServiceError) return undefined;
        throw error;
      });
    const verified = decision?.context;
    if (
      verified === undefined ||
      verified.projectId !== input.projectId ||
      verified.actorId !== context.actorId ||
      !verified.grantedCapabilities.includes("review-audit.request")
    ) {
      return this.#failAuthorization("review-audit.request-review");
    }
    const request = ReviewRequestV1Schema.parse({
      kind: "request-review",
      commandId: invocationId,
      idempotencyKey: invocationId,
      projectId: input.projectId,
      actorId: verified.actorId,
      issuedAt: input.issuedAt,
      authorization: verified,
      payload: {
        reviewType: "response-candidate",
        targetRef: input.candidateRef,
        validationSnapshotRef: {
          kind: "validation-snapshot",
          reference: { entityId: input.validationId, versionId: "1" },
        },
        evidenceSnapshotRef: {
          kind: "evidence-snapshot",
          reference: { entityId: input.validationId, versionId: input.evidenceDigest },
        },
        waitingRunRef: input.candidate.parentRunRef,
        reviewPolicyRef: input.candidateSet.reviewPolicyRef,
      },
    });
    const result = await audit.requestReview(request);
    if (result.kind === "succeeded") {
      return ReviewTaskRefV1Schema.parse(result.result.reviewTaskRef);
    }
    if (result.kind === "failed") {
      const failure = recommendationFailureFrom(result.error);
      if (failure !== undefined) throw result.error;
      const parsedError = ModuleErrorV1Schema.safeParse(result.error);
      const code = parsedError.success ? parsedError.data.code : undefined;
      failRecommendation(
        "review-request-failed",
        input.candidateRef,
        code === "AUTHORIZATION_DENIED" ||
          code === "STALE_VERSION" ||
          code === "TRANSIENT_FAILURE" ||
          code === "UNSUPPORTED_CONTRACT" ||
          code === "IDEMPOTENCY_CONFLICT"
          ? code
          : "TERMINAL_FAILURE",
      );
    }
    failRecommendation("review-request-failed", input.candidateRef, "BUSINESS_BLOCKED");
  }

  // ------------------------------------------------------------------ C08 任务定义接缝

  /** 越界增量逐项拒绝：只有候选集引用类错误可修复，其余不通过修正循环绕过。 */
  async validateIncrement(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: ResponseRecommendationIncrementV1;
  }): Promise<AgentValidationResultV1> {
    const envelope = input.task.envelope;
    const { candidateSet } = await this.#taskCandidateSet(envelope);
    const allowed = new Set(
      candidateSet.candidates.map((candidate) => candidate.measure.measureId),
    );
    const items = input.candidate.selections.map((selection) =>
      allowed.has(selection.measureId)
        ? {
            checkId: `candidate-measure-${selection.measureId}`,
            disposition: "accepted" as const,
            reasonCode: "measure-in-frozen-candidates",
            evidenceReferences: [],
          }
        : {
            checkId: `candidate-measure-${selection.measureId}`,
            disposition: "rejected" as const,
            rejectionClass: "repairable" as const,
            reasonCode: "measure-outside-frozen-candidates",
            evidenceReferences: [],
          },
    );
    const validationAuthorization = await this.#taskWriteAuthorization(
      input.task,
      "increment-validation",
    );
    const validationArtifactRef = await this.#putArtifact({
      commandId: `${envelope.agentTaskRef.reference.entityId}:increment-validation`,
      projectId: envelope.projectId,
      actorId: envelope.actorId,
      issuedAt: this.#nowIso(),
      authorization: validationAuthorization,
      requiredCapability: "warning-response.recommend",
      purposeCode: AGENT_VALIDATION_PURPOSE_CODE_V1,
      mediaType: AGENT_VALIDATION_MEDIA_TYPE_V1,
      artifactId: `recommendation-increment-${envelope.agentTaskRef.reference.entityId}`,
      parentArtifactRefs: [
        { kind: "content-artifact", reference: candidateSet.measureArtifactRef.reference },
      ],
      value: {
        schemaVersion: "1",
        projectId: envelope.projectId,
        inputDigest: candidateSet.inputDigest,
        selections: input.candidate.selections,
        items,
      },
    });
    return AgentValidationResultV1Schema.parse({
      schemaVersion: "1",
      items,
      disposition: items.some((item) => item.disposition === "rejected") ? "rejected" : "accepted",
      ...(items.some((item) => item.disposition === "rejected")
        ? { rejectionClass: "repairable" }
        : {}),
      validationArtifactRef,
      validatedAt: this.#nowIso(),
    });
  }

  /** 合法增量只追加不可变候选版本与任务结果引用；Agent 不写正式建议或采纳。 */
  async finalizeIncrement(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: ResponseRecommendationIncrementV1;
  }): Promise<AgentTaskResultRefV1> {
    const envelope = input.task.envelope;
    const { candidateSet, artifactRef: setArtifactRef } = await this.#taskCandidateSet(envelope);
    const allowed = new Set(
      candidateSet.candidates.map((candidate) => candidate.measure.measureId),
    );
    if (input.candidate.selections.some((selection) => !allowed.has(selection.measureId))) {
      failRecommendation("recommendation-candidate-mismatch", {
        kind: "agent-task",
        reference: envelope.agentTaskRef.reference,
      });
    }
    const frozenInputRef = envelope.frozenInputRef as KnowledgeQueryResultRefV1;
    const matchedWarningRefs = candidateSet.warnings.map((warning) => warning.warningRecordRef);
    const primaryWarning = primaryWarningRecordRef(candidateSet.warnings);
    const candidateDigest = sha256CanonicalJson({
      warningResponseTaskRef: candidateSet.warningResponseTaskRef,
      measureCandidateQueryResultRef: frozenInputRef,
      generationPolicyRef: candidateSet.generationPolicyRef,
      agentTaskRef: envelope.agentTaskRef,
      selections: input.candidate.selections,
      matchedWarningRefs,
    });
    const candidateRef = {
      kind: "recommendation-candidate" as const,
      reference: {
        entityId: `recommendation-candidate-${candidateDigest.slice(0, 32)}`,
        versionId: "1",
      },
    };
    const createdAt = this.#nowIso();
    const candidatePayload = RecommendationCandidateV1Schema.parse({
      schemaVersion: "1",
      projectId: envelope.projectId,
      candidateRef,
      warningResponseTaskRef: candidateSet.warningResponseTaskRef,
      measureCandidateQueryResultRef: frozenInputRef,
      generationPolicyRef: candidateSet.generationPolicyRef,
      agentTaskRef: { kind: "agent-task", reference: envelope.agentTaskRef.reference },
      parentRunRef: envelope.parentRunRef,
      riskEventCategory: candidateSet.riskEventCategory,
      spatialScopeRef: candidateSet.spatialScopeRef,
      selections: input.candidate.selections,
      primaryWarningRecordRef: primaryWarning,
      matchedWarningRefs,
      candidateDigest,
      createdBy: envelope.actorId,
      createdAt,
    });
    const candidateAuthorization = await this.#taskWriteAuthorization(
      input.task,
      "recommendation-candidate",
    );
    const artifactRef = await this.#putArtifact({
      commandId: `${envelope.agentTaskRef.reference.entityId}:candidate`,
      projectId: envelope.projectId,
      actorId: envelope.actorId,
      issuedAt: createdAt,
      authorization: candidateAuthorization,
      requiredCapability: "warning-response.recommend",
      purposeCode: RECOMMENDATION_CANDIDATE_PURPOSE_CODE_V1,
      mediaType: RECOMMENDATION_CANDIDATE_MEDIA_TYPE_V1,
      artifactId: candidateRef.reference.entityId,
      parentArtifactRefs: [setArtifactRef],
      value: candidatePayload,
    });
    await this.#executeWithRetry(
      this.#atomicCommand(
        {
          commandId: `${envelope.agentTaskRef.reference.entityId}:candidate`,
          idempotencyKey: `${envelope.agentTaskRef.reference.entityId}:candidate`,
          projectId: envelope.projectId,
          actorId: envelope.actorId,
          issuedAt: createdAt,
          authorization: candidateAuthorization,
        },
        "warning-response.recommendation-candidate",
        {
          candidateRef,
          warningResponseTaskRef: candidateSet.warningResponseTaskRef,
          measureCandidateQueryResultRef: frozenInputRef,
          agentTaskRef: envelope.agentTaskRef,
        },
      ),
      async (transactionContext): Promise<AtomicCommitV1> => {
        const transaction = asTransaction(transactionContext);
        const recordedAt = this.#nowIso();
        const auditEntryId = `audit-${envelope.agentTaskRef.reference.entityId}:recommendation-candidate`;
        await transaction
          .insertInto("business.recommendation_candidates")
          .values({
            candidate_id: candidateRef.reference.entityId,
            version_id: candidateRef.reference.versionId,
            schema_version: "1",
            project_id: envelope.projectId,
            warning_response_task_id: candidateSet.warningResponseTaskRef.reference.entityId,
            warning_response_task_version_id:
              candidateSet.warningResponseTaskRef.reference.versionId,
            query_result_id: frozenInputRef.reference.entityId,
            query_result_version_id: frozenInputRef.reference.versionId,
            generation_policy_entity_id: candidateSet.generationPolicyRef.entityId,
            generation_policy_version_id: candidateSet.generationPolicyRef.versionId,
            risk_event_category: candidateSet.riskEventCategory,
            spatial_scope_entity_id: candidateSet.spatialScopeRef.reference.entityId,
            spatial_scope_version_id: candidateSet.spatialScopeRef.reference.versionId,
            agent_task_id: envelope.agentTaskRef.reference.entityId,
            agent_task_type: envelope.taskType,
            agent_result_id: `agent-result:${envelope.agentTaskRef.reference.entityId}`,
            agent_result_version_id: "1",
            parent_run_id: envelope.parentRunRef.reference.entityId,
            parent_run_version_id: envelope.parentRunRef.reference.versionId,
            primary_warning_record_id: primaryWarning.reference.entityId,
            primary_warning_record_version_id: primaryWarning.reference.versionId,
            candidate_payload: jsonValue(candidatePayload),
            candidate_artifact_id: artifactRef.reference.entityId,
            candidate_artifact_version_id: artifactRef.reference.versionId,
            content_digest: candidateDigest,
            command_id: `${envelope.agentTaskRef.reference.entityId}:candidate`,
            idempotency_key: `${envelope.agentTaskRef.reference.entityId}:candidate`,
            actor_ref: envelope.actorId,
            authorization_context_ref: jsonValue(candidateAuthorization.authorizationContextRef),
            audit_entry_id: auditEntryId,
            occurred_at: createdAt,
            recorded_at: recordedAt,
          } as never)
          .onConflict((conflict) => conflict.doNothing())
          .execute();
        return {
          resultRef: candidateRef,
          audit: {
            auditEntryId,
            projectId: envelope.projectId,
            action: "warning-response.recommendation-candidate",
            targetRef: candidateRef,
            actorRef: envelope.actorId,
            authorizationContextRef: candidateAuthorization.authorizationContextRef,
            occurredAt: createdAt,
            recordedAt,
            version: { entityId: auditEntryId, versionId: "1" },
            commandId: `${envelope.agentTaskRef.reference.entityId}:candidate`,
            idempotencyKey: `${envelope.agentTaskRef.reference.entityId}:candidate`,
          },
          events: [],
        };
      },
    );
    return buildCompletedAgentTaskResult(envelope.agentTaskRef, candidateRef, undefined, [
      "recommendation-candidate",
    ]);
  }

  /** 任务写入授权：按任务发起人派生精确分支授权，并用任务身份向 C06 亲自复验。 */
  async #taskWriteAuthorization(
    task: AgentTaskSnapshotV1,
    purpose: "increment-validation" | "recommendation-candidate",
  ): Promise<AuthorizationContextV1> {
    const envelope = task.envelope;
    const target = { kind: "agent-task", reference: envelope.agentTaskRef.reference };
    const provider = this.#taskAuthorization;
    if (provider === undefined) {
      failRecommendation("recommendation-authorization-required", target, "AUTHORIZATION_DENIED");
    }
    const invocationId = `${envelope.agentTaskRef.reference.entityId}:${purpose}`;
    const context = await provider.authorize({ task, purpose });
    const decision = await this.#access
      .verify({
        authorizationContextRef: context.authorizationContextRef,
        invocationId,
        projectId: envelope.projectId,
        branch: "warning-response.create-candidate",
        requestedSpatialScopeRefs: [...envelope.authorization.spatialScopeRefs],
        requestedSourceVersionRefs: [],
        requestedAt: context.decidedAt,
      })
      .catch((error: unknown) => {
        if (error instanceof AccessServiceError) return undefined;
        throw error;
      });
    const verified = decision?.context;
    if (
      verified === undefined ||
      verified.projectId !== envelope.projectId ||
      verified.actorId !== envelope.actorId ||
      !verified.grantedCapabilities.includes("warning-response.recommend")
    ) {
      failRecommendation("recommendation-authorization-required", target, "AUTHORIZATION_DENIED");
    }
    return verified;
  }

  async #taskCandidateSet(envelope: AgentTaskSnapshotV1["envelope"]): Promise<{
    readonly candidateSet: MeasureCandidateSetV1;
    readonly artifactRef: {
      readonly kind: "content-artifact";
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
  }> {
    if (
      envelope.taskType !== RECOMMENDATION_TASK_TYPE_V1 ||
      envelope.frozenInputRef.kind !== "knowledge-query-result"
    ) {
      failRecommendation("recommendation-contract-drift", {
        kind: "agent-task",
        reference: envelope.agentTaskRef.reference,
      });
    }
    const queryRow = await this.#readQueryById(
      envelope.projectId,
      envelope.frozenInputRef.reference,
    );
    if (queryRow === undefined) {
      failRecommendation("measure-candidates-unavailable", {
        kind: "agent-task",
        reference: envelope.agentTaskRef.reference,
      });
    }
    return {
      candidateSet: MeasureCandidateSetV1Schema.parse(queryRow.candidate_set_payload),
      artifactRef: {
        kind: "content-artifact",
        reference: {
          entityId: queryRow.candidate_set_artifact_id,
          versionId: queryRow.candidate_set_artifact_version_id,
        },
      },
    };
  }

  // ------------------------------------------------------------------------- 存储读取

  async #readCandidateRow(
    projectId: string,
    candidateRef: RecommendationCandidateRefV1,
    spatialScopeIds: readonly string[],
  ): Promise<RecommendationCandidateRow | undefined> {
    if (spatialScopeIds.length === 0) return undefined;
    return this.#db
      .selectFrom("business.recommendation_candidates")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("candidate_id", "=", candidateRef.reference.entityId)
      .where("version_id", "=", candidateRef.reference.versionId)
      .where("spatial_scope_entity_id", "in", spatialScopeIds)
      .executeTakeFirst();
  }

  #readCandidatePayload(row: RecommendationCandidateRow): RecommendationCandidateV1 {
    const payload = row.candidate_payload as Record<string, unknown> | null;
    const parsed = RecommendationCandidateV1Schema.safeParse(payload);
    if (
      !parsed.success ||
      !sameRef(parsed.data.candidateRef.reference, {
        entityId: row.candidate_id,
        versionId: row.version_id,
      }) ||
      parsed.data.candidateDigest !== row.content_digest
    ) {
      failRecommendation("recommendation-candidate-mismatch", {
        kind: "recommendation-candidate",
        reference: { entityId: row.candidate_id, versionId: row.version_id },
      });
    }
    return parsed.data;
  }

  async #readQueryById(
    projectId: string,
    ref: { readonly entityId: string; readonly versionId: string },
    spatialScopeIds?: readonly string[],
  ): Promise<MeasureCandidateQueryRow | undefined> {
    if (spatialScopeIds?.length === 0) return undefined;
    let query = this.#db
      .selectFrom("business.measure_candidate_queries")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("query_result_id", "=", ref.entityId)
      .where("version_id", "=", ref.versionId);
    if (spatialScopeIds !== undefined) {
      query = query.where("spatial_scope_entity_id", "in", spatialScopeIds);
    }
    return query.executeTakeFirst();
  }

  async #readQueryByInput(input: {
    readonly projectId: string;
    readonly taskId: string;
    readonly taskVersionId: string;
    readonly measureLibraryReleaseRef: { readonly entityId: string; readonly versionId: string };
    readonly inputDigest: string;
  }): Promise<MeasureCandidateQueryRow | undefined> {
    return this.#db
      .selectFrom("business.measure_candidate_queries")
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("warning_response_task_id", "=", input.taskId)
      .where("warning_response_task_version_id", "=", input.taskVersionId)
      .where("measure_library_release_id", "=", input.measureLibraryReleaseRef.entityId)
      .where("measure_library_release_version_id", "=", input.measureLibraryReleaseRef.versionId)
      .where("input_digest", "=", input.inputDigest)
      .executeTakeFirst();
  }

  // ------------------------------------------------------------------------- 工件

  async #putArtifact(input: {
    readonly commandId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly requiredCapability: "knowledge-modeling.retrieve" | "warning-response.recommend";
    readonly purposeCode: string;
    readonly mediaType: string;
    readonly artifactId: string;
    readonly parentArtifactRefs: readonly {
      readonly kind: string;
      readonly reference: { readonly entityId: string; readonly versionId: string };
    }[];
    readonly value: unknown;
  }): Promise<{
    readonly kind: "content-artifact";
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }> {
    const command = ArtifactPutCommandV1Schema.parse({
      schemaVersion: "1",
      commandId: `${input.commandId}:artifact`,
      idempotencyKey: `${input.commandId}:artifact`,
      projectId: input.projectId,
      actorId: input.actorId,
      issuedAt: input.issuedAt,
      authorization: input.authorization,
      requiredCapability: input.requiredCapability,
      artifactId: input.artifactId,
      artifactKind: "content",
      purposeCode: input.purposeCode,
      mediaType: input.mediaType,
      parentArtifactRefs: [...input.parentArtifactRefs],
      evidenceReferences: [],
      additionalSpatialScopeRefs: [],
      additionalSourceAccessGrantRefs: [],
    });
    const content = one(new TextEncoder().encode(canonicalJson(input.value)));
    const contentRef = {
      kind: "content-artifact" as const,
      reference: {
        entityId: input.artifactId,
        versionId: `sha256:${sha256CanonicalJson(input.value)}`,
      },
    };
    try {
      const result = await this.#artifactStore.put(command, content);
      return {
        kind: "content-artifact",
        reference: {
          entityId: result.artifactRef.reference.entityId,
          versionId: result.artifactRef.reference.versionId,
        },
      };
    } catch (error: unknown) {
      // 内容寻址重复：同一正文已由另一事务登记，按同一引用回读并等待校验完成即同一逻辑结果。
      const existing = await this.#artifactStore
        .open(
          ArtifactReadRequestV1Schema.parse({
            schemaVersion: "1",
            requestId: `${input.commandId}:artifact-read`,
            idempotencyKey: `${input.commandId}:artifact-read`,
            artifactRef: contentRef,
            projectId: input.projectId,
            actorId: input.actorId,
            requestedAt: input.issuedAt,
            purposeCode: input.purposeCode,
            requiredCapability: input.requiredCapability,
            authorization: input.authorization,
          }),
        )
        .catch(() => undefined);
      if (existing === undefined) throw error;
      await existing.verified;
      return {
        kind: "content-artifact",
        reference: {
          entityId: existing.manifest.artifactRef.reference.entityId,
          versionId: existing.manifest.artifactRef.reference.versionId,
        },
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

  // ---------------------------------------------------------------- recommendation-read

  /**
   * C27 正式建议的所属窄读（design D-06）：C26 不访问建议私表，只沿公共契约取自己需要的形状。
   * 正文、校验结果与政策引用全部取自已登记事实；内容摘要不符即失败闭合，不返回半份建议。
   */
  async readRecommendationView(
    input: RecommendationReadViewInputV1,
  ): Promise<C26RecommendationViewResultV1> {
    const verified = await this.#verifyRead(input, "warning-response.read").catch(
      (): undefined => undefined,
    );
    if (verified === undefined) {
      return { kind: "failed", error: { code: "AUTHORIZATION_DENIED" } };
    }
    const ref = input.responseRecommendationRef.reference;
    let row: Selectable<ResponseRecommendationRow> | undefined;
    let validation: Selectable<RecommendationValidationRow> | undefined;
    try {
      row = await this.#db
        .selectFrom("business.response_recommendations")
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("recommendation_id", "=", ref.entityId)
        .where("version_id", "=", ref.versionId)
        .executeTakeFirst();
      if (row === undefined) {
        return { kind: "failed", error: { code: "RECOMMENDATION_NOT_FOUND" } };
      }
      validation = await this.#db
        .selectFrom("business.recommendation_validations")
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("validation_id", "=", row.validation_id)
        .where("version_id", "=", row.validation_version_id)
        .executeTakeFirst();
    } catch (error) {
      const mapped = mapPostgresError(error, "recommendation.read");
      return { kind: "failed", error: { code: mapped.code } };
    }
    // 建议的空间范围必须落在已验证授权内；越权与不存在对调用方同形。
    if (
      !verified.spatialScopeRefs.some(
        (scope) => scope.reference.entityId === row.spatial_scope_entity_id,
      )
    ) {
      return { kind: "failed", error: { code: "AUTHORIZATION_DENIED" } };
    }
    const record = ResponseRecommendationSchema.safeParse(row.record_payload);
    if (
      !record.success ||
      validation === undefined ||
      sha256CanonicalJson(record.data) !== row.content_digest
    ) {
      return { kind: "failed", error: { code: "RECOMMENDATION_PAYLOAD_INVALID" } };
    }
    const evidence = RecommendationValidationEvidenceV1Schema.safeParse(
      validation.validation_payload,
    );
    if (!evidence.success) {
      return { kind: "failed", error: { code: "RECOMMENDATION_VALIDATION_UNREADABLE" } };
    }
    return {
      kind: "succeeded",
      view: {
        responseRecommendationRef: {
          kind: "response-recommendation",
          reference: { entityId: row.recommendation_id, versionId: row.version_id },
        },
        recommendation: record.data,
        taskRef: {
          kind: "warning-response-task",
          reference: {
            entityId: row.warning_response_task_id,
            versionId: row.warning_response_task_version_id,
          },
        },
        validationResults: [
          {
            checkId: "trigger-consistency",
            pass: validation.trigger_consistency_passed,
            // 校验诊断登记的是领域引用，不是资料段证据引用：这里不把两种引用互相转换。
            evidenceReferences: [],
          },
          {
            checkId: "standards-compliance",
            pass: validation.standards_compliance_passed,
            evidenceReferences: [],
          },
          {
            checkId: "site-feasibility",
            pass: validation.site_feasibility_passed,
            evidenceReferences: [],
          },
        ],
        generationPolicyRef: {
          entityId: row.generation_policy_entity_id,
          versionId: row.generation_policy_version_id,
        },
        validationPolicyRef: {
          entityId: row.validation_policy_entity_id,
          versionId: row.validation_policy_version_id,
        },
        // 建议只登记一组措施库发布引用，逐字投影，不补全库里没有的其它发布。
        measureReleaseRefs: [
          {
            kind: "measure-library-release",
            reference: {
              entityId: row.measure_library_release_id,
              versionId: row.measure_library_release_version_id,
            },
          },
        ],
        spatialScopeEntityId: row.spatial_scope_entity_id,
      },
    };
  }

  /** 读侧复验：与命令复验同形，但用请求时点而不是签发时点，并返回 `undefined` 表示拒绝。 */
  /**
   * C27 候选组合输入的公开窄读（design D-06）：`measureCandidates` 成功时只交出查询结果
   * 引用，处置 Agent 的有界任务必须据此取回已冻结的候选集原文来合成输入。
   * C27 是候选集的唯一拥有方：正文只按已登记事实返回，摘要对不上、越权或未登记都失败闭合，
   * 既不返回空集，也不为调用方代造候选。
   */
  async readMeasureCandidateSet(
    input: MeasureCandidateSetReadInputV1,
  ): Promise<MeasureCandidateSetReadResultV1> {
    const verified = await this.#verifyRead(input, "warning-response.read").catch(
      (): undefined => undefined,
    );
    if (verified === undefined) {
      return { kind: "failed", error: { code: "AUTHORIZATION_DENIED" } };
    }
    const scopeIds = verified.spatialScopeRefs.map((scope) => scope.reference.entityId);
    let row: MeasureCandidateQueryRow | undefined;
    try {
      row = await this.#readQueryById(
        input.projectId,
        input.knowledgeQueryResultRef.reference,
        scopeIds,
      );
    } catch (error) {
      const mapped = mapPostgresError(error, "recommendation.read-measure-candidate-set");
      return { kind: "failed", error: { code: mapped.code } };
    }
    if (row === undefined) {
      return { kind: "failed", error: { code: "MEASURE_CANDIDATES_UNAVAILABLE" } };
    }
    const candidateSet = MeasureCandidateSetV1Schema.safeParse(row.candidate_set_payload);
    if (
      !candidateSet.success ||
      sha256CanonicalJson(candidateSet.data) !== row.candidate_set_digest ||
      candidateSet.data.projectId !== input.projectId ||
      !scopeIds.includes(candidateSet.data.spatialScopeRef.reference.entityId)
    ) {
      return { kind: "failed", error: { code: "MEASURE_CANDIDATE_SET_INVALID" } };
    }
    return {
      kind: "succeeded",
      knowledgeQueryResultRef: input.knowledgeQueryResultRef,
      candidateSet: candidateSet.data,
      candidateSetArtifactRef: {
        kind: "content-artifact",
        reference: {
          entityId: row.candidate_set_artifact_id,
          versionId: row.candidate_set_artifact_version_id,
        },
      },
    };
  }

  /**
   * 任务下的正式建议引用（design D-05、D-10）：按登记时点倒序、标识升序走 keyset，
   * 先落工程、空间与任务筛选再 `LIMIT pageSize+1`。
   * C26 不访问本表，也不为「还没有建议」编造占位引用。
   */
  async readRecommendationRefsForTask(
    input: Omit<RelationPageInputV1, "anchorRefs"> & {
      readonly warningResponseTaskRef: WarningResponseTaskRefV1;
    },
  ): Promise<RelationPageResultV1> {
    const verified = await this.#verifyRead(input, "warning-response.read").catch(
      (): undefined => undefined,
    );
    if (verified === undefined) return { kind: "failed", error: { code: "AUTHORIZATION_DENIED" } };
    const scopeIds = verified.spatialScopeRefs.map((scope) => scope.reference.entityId);
    if (scopeIds.length === 0) {
      return { kind: "failed", error: { code: "AUTHORIZATION_DENIED" } };
    }
    const task = input.warningResponseTaskRef.reference;
    const rows = await sql<{
      entity_id: string;
      version_id: string;
      recorded_at: Date;
    }>`
      SELECT r.recommendation_id AS entity_id, r.version_id, r.recorded_at
        FROM business.response_recommendations r
       WHERE r.project_id = ${input.projectId}
         AND r.spatial_scope_entity_id = ANY(${scopeIds})
         AND r.warning_response_task_id = ${task.entityId}
         AND r.warning_response_task_version_id = ${task.versionId}
         ${
           input.after === undefined
             ? sql``
             : sql`AND (
                    r.recorded_at < ${input.after.recordedAt}
                 OR (r.recorded_at = ${input.after.recordedAt} AND r.recommendation_id > ${input.after.entityId})
                 OR (r.recorded_at = ${input.after.recordedAt} AND r.recommendation_id = ${input.after.entityId}
                     AND r.version_id > ${input.after.versionId})
               )`
         }
       ORDER BY r.recorded_at DESC, r.recommendation_id ASC, r.version_id ASC
       LIMIT ${input.pageSize + 1}
    `.execute(this.#db);
    const page = rows.rows.slice(0, input.pageSize);
    const last = page.at(-1);
    return {
      kind: "succeeded",
      hasMore: rows.rows.length > input.pageSize,
      lastRef:
        last === undefined
          ? undefined
          : {
              kind: "response-recommendation",
              reference: { entityId: last.entity_id, versionId: last.version_id },
            },
      lastRecordedAt: last?.recorded_at.toISOString(),
      refs: page.map((row) => ({
        kind: "response-recommendation",
        reference: { entityId: row.entity_id, versionId: row.version_id },
      })),
    };
  }

  /** 实体标识解析：只认本模块登记的建议，版本缺省时给出该实体的全部登记版本。 */
  async resolveRecommendationRefs(input: ResolveRefsInputV1): Promise<ResolveRefsResultV1> {
    const verified = await this.#verifyRead(input, "warning-response.read").catch(
      (): undefined => undefined,
    );
    if (verified === undefined) return { kind: "failed", error: { code: "AUTHORIZATION_DENIED" } };
    const scopeIds = verified.spatialScopeRefs.map((scope) => scope.reference.entityId);
    if (scopeIds.length === 0) {
      return { kind: "failed", error: { code: "AUTHORIZATION_DENIED" } };
    }
    const rows = await sql<{ version_id: string }>`
      SELECT r.version_id
        FROM business.response_recommendations r
       WHERE r.project_id = ${input.projectId}
         AND r.spatial_scope_entity_id = ANY(${scopeIds})
         AND r.recommendation_id = ${input.entityId}
         ${input.versionId === undefined ? sql`` : sql`AND r.version_id = ${input.versionId}`}
       ORDER BY r.version_id ASC
       LIMIT ${C26_RESOLVE_MAX_REFS_V1}
    `.execute(this.#db);
    return {
      kind: "succeeded",
      refs: rows.rows.map((row) => ({
        kind: "response-recommendation",
        reference: { entityId: input.entityId, versionId: row.version_id },
      })),
    };
  }

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

  async #executeWithRetry(
    command: AtomicCommandV1,
    handler: (context: TransactionContextV1) => Promise<AtomicCommitV1>,
  ): Promise<AtomicCommitReceiptV1> {
    const options: TransactionOptionsV1 = { isolationLevel: "serializable" };
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.#transactionUnit.execute(command, handler, options);
      } catch (error: unknown) {
        // 并发写入同一候选/校验时的序列化失败在有限预算内重试，随后由唯一性收口。
        if (
          attempt < MAX_SERIALIZATION_ATTEMPTS_V1 &&
          mapPostgresError(error, "warning-response.recommendation.transaction").retryable
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  // ------------------------------------------------------------------------- 错误

  #terminalError(causalRunId: string, stageCode: string): ModuleErrorV1 {
    return toRecommendationModuleError(
      {
        code: "TERMINAL_FAILURE",
        reasonCode: "recommendation-contract-drift",
        targetRef: {
          kind: "warning-response-task",
          reference: { entityId: stageCode, versionId: "1" },
        },
      },
      causalRunId,
    );
  }

  #toModuleError(
    error: unknown,
    causalRunId: string,
    requiredCapability: "knowledge-modeling.retrieve" | "warning-response.recommend",
  ): ModuleErrorV1 {
    const failure = recommendationFailureFrom(error);
    if (failure !== undefined) {
      return toRecommendationModuleError(failure, causalRunId, requiredCapability);
    }
    if (error instanceof AccessServiceError) {
      return toRecommendationModuleError(
        {
          code: "AUTHORIZATION_DENIED",
          reasonCode: "recommendation-authorization-required",
          targetRef: {
            kind: "authorization-context",
            reference: {
              entityId: `warning-response.unauthorized.${requiredCapability}`,
              versionId: "1",
            },
          },
        },
        causalRunId,
        requiredCapability,
      );
    }
    const mapped = mapPostgresError(error, "warning-response.recommendation.adapter");
    if (mapped.code === "IDEMPOTENCY_CONFLICT") {
      return toRecommendationModuleError(
        {
          code: "IDEMPOTENCY_CONFLICT",
          reasonCode: "recommendation-idempotency-conflict",
          targetRef: {
            kind: "warning-response-task",
            reference: { entityId: causalRunId, versionId: "1" },
          },
        },
        causalRunId,
        requiredCapability,
      );
    }
    return toRecommendationModuleError(
      {
        code: mapped.retryable ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE",
        reasonCode: "recommendation-contract-drift",
        targetRef: {
          kind: "warning-response-task",
          reference: { entityId: causalRunId, versionId: "1" },
        },
      },
      causalRunId,
      requiredCapability,
    );
  }
}

const refOfQueryRow = (row: MeasureCandidateQueryRow): KnowledgeQueryResultRefV1 => ({
  kind: "knowledge-query-result",
  reference: { entityId: row.query_result_id, versionId: row.version_id },
});

export const createPostgresRecommendationAdapter = (
  options: PostgresRecommendationAdapterOptionsV1,
): PostgresRecommendationAdapter => new PostgresRecommendationAdapter(options);

export const createPostgresRecommendationContextReader = (options: {
  readonly db: Kysely<PostgresDatabase>;
  readonly artifactStore: ArtifactStoreV1;
  readonly basis: AssessmentBasisReleaseSetReaderV1;
}): PostgresRecommendationContextReader => new PostgresRecommendationContextReader(options);
