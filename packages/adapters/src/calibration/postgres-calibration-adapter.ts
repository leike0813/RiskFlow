import type { ColumnType, Kysely, Transaction } from "kysely";

import { AccessServiceError, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import {
  ArtifactPutCommandV1Schema,
  ArtifactReadRequestV1Schema,
  type ArtifactRefV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import type {
  AgentTaskCompletedResultReadRequestV1,
  AgentTaskCompletedResultReaderV1,
  AgentTaskCompletedResultV1,
} from "@riskflow/core/agent-runtime";
import {
  ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
  AssessmentConfigurationDocumentV1Schema,
} from "@riskflow/core/assessment-config";
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
import type {
  ResponseDeviationFactReaderV1,
  ResponseDeviationFactV1,
} from "@riskflow/core/response-lifecycle";
import type { AssessmentInputSnapshotReaderV1 } from "@riskflow/core/risk-assessment/engine";
import {
  STRUCTURED_SCORING_RULE_ARTIFACT_PURPOSE_CODE_V1,
  StructuredScoringRuleDocumentV1Schema,
  type AssessmentBasisReleaseSetReaderV1,
} from "@riskflow/core/scoring-rules";
import {
  CalibrationCandidateV1Schema,
  CalibrationInputSnapshotV1Schema,
  CalibrationValidationPolicyV1Schema,
  deriveCalibrationInputSnapshotRef,
  deriveCalibrationSuggestionRef,
  deriveDeviationRecordRef,
  deriveSuccessorCalibrationSuggestionRef,
  digestDocument,
  failCalibration,
  calibrationFailureFrom,
  toCalibrationModuleError,
  validateCalibrationCandidate,
  type CalibrationGovernanceDraftResultV1,
  type CalibrationPrepareInputCommandV1,
  type CalibrationPrepareInputResultV1,
  type CalibrationReviewOutcomeCommandV1,
  type CalibrationReviewOutcomeResultV1,
  type CalibrationServiceV1,
  type CalibrationTargetDefinitionTypeV1,
  type CalibrationTargetDocumentV1,
  type CreateCalibrationSuggestionCommandV1,
} from "@riskflow/core/calibration";
import {
  MODULE_BRANCH_CAPABILITY_V1,
  ReviewTaskRefV1Schema,
  ReviewRequestV1Schema,
  WarningResponseRecordCommandV1Schema,
  WarningResponseRecordResultV1Schema,
  type AuthorizationContextV1,
  ContentArtifactRefV1Schema,
  type CalibrationSuggestionApprovalProofQueryV1,
  type CalibrationSuggestionApprovalProofResultV1,
  type CalibrationSuggestionRefV1,
  type ContentArtifactRefV1,
  type DeviationRecordRefV1,
  type KnowledgeGovernanceCommandV1,
  type KnowledgeGovernanceResultForCommandV1,
  type ModuleBranchV1,
  type ModuleCapabilityV1,
  type ModuleErrorV1,
  type SpatialScopeRefV1,
  type ReviewRequestResultV1,
  type ReviewRequestV1,
  type ReviewTaskRefV1,
  type WarningResponseRecordResultV1,
} from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";
import { DeviationRecordSchema, type DeviationRecord } from "@riskflow/contracts/records";
import { DomainEventV1Schema } from "@riskflow/contracts/events";

import { mapPostgresError } from "../postgres/pool.js";
import { getPostgresTransaction } from "../postgres/transaction-unit.js";
import type { PostgresDatabase } from "../postgres/types.js";

type JsonColumn = ColumnType<JsonValue, JsonValue, JsonValue>;

/**
 * C29 命令分支：与公共 `create-calibration-suggestion` 同属 `warning-response.record` 能力，
 * 不新增 capability 或角色枚举。
 */
const CALIBRATION_BRANCH_V1 = "warning-response.create-calibration-suggestion" as const;
const GOVERNANCE_BRANCH_V1 = "knowledge-modeling.submit-revision" as const;
const CALIBRATION_COMMAND_KIND_V1 = "warning-response.create-calibration-suggestion";
const REVIEW_OUTCOME_COMMAND_KIND_V1 = "warning-response.record-calibration-review-outcome";
const GOVERNANCE_DRAFT_COMMAND_KIND_V1 = "warning-response.create-calibration-governance-draft";
const CALIBRATION_INPUT_PURPOSE_CODE_V1 = "warning-response.calibration-input-snapshot";
/**
 * 下游读取各用既有精确分支：C28 偏差事实、C19 评估依据、C08 私有结果、C07 复核请求与
 * C16 知识治理。C06 每次签发只授予单一能力，因此每个用途都必须单独授权，不新增能力值。
 */
const DEVIATION_FACT_BRANCH_V1 = "warning-response.calculate-deviation" as const;
const BASIS_BRANCH_V1 = "knowledge-modeling.assessment-basis" as const;
const AGENT_RESULT_BRANCH_V1 = "agent-task.read-failure-evidence" as const;
const REVIEW_REQUEST_BRANCH_V1 = "review-audit.request-review" as const;
/** C08 写入候选增量工件时使用的既有目的码；读取必须与 manifest 完全一致。 */
const AGENT_INCREMENT_PURPOSE_CODE_V1 = "agent-increment";

const CALIBRATION_PURPOSE_BRANCHES_V1 = {
  deviationFact: DEVIATION_FACT_BRANCH_V1,
  inputSnapshot: "risk-assessment.read-input-snapshot",
  basis: BASIS_BRANCH_V1,
  agentResult: AGENT_RESULT_BRANCH_V1,
  reviewRequest: REVIEW_REQUEST_BRANCH_V1,
  reviewProof: "review-audit.verify-calibration-suggestion-approval",
  governance: GOVERNANCE_BRANCH_V1,
} as const satisfies Record<string, ModuleBranchV1>;

type CalibrationPurposeV1 = keyof typeof CALIBRATION_PURPOSE_BRANCHES_V1;
const CALIBRATION_CANDIDATE_PURPOSE_CODE_V1 = "knowledge-modeling.calibration-candidate";
const CALIBRATION_INPUT_MEDIA_TYPE_V1 = "application/vnd.riskflow.calibration-input+json";
const CALIBRATION_CANDIDATE_MEDIA_TYPE_V1 = "application/vnd.riskflow.configuration-document+json";
const SUGGESTION_CREATED_EVENT_TYPE_V1 = "warning.calibration-suggestion-created.v1";
const MAX_ARTIFACT_BYTES_V1 = 8 * 1024 * 1024;
const MAX_SERIALIZATION_ATTEMPTS_V1 = 3;

interface SuggestionRow {
  suggestion_id: string;
  version_id: string;
  project_id: string;
  deviation_id: string;
  deviation_version_id: string;
  deviation_fact_id: string;
  deviation_fact_version_id: string;
  agent_task_id: string;
  agent_task_version_id: string;
  agent_task_result_ref: JsonColumn;
  validation_policy_entity_id: string;
  validation_policy_version_id: string;
  frozen_input_artifact_id: string;
  frozen_input_artifact_version_id: string;
  target_definition_type: string;
  target_release_entity_id: string;
  target_release_version_id: string;
  base_artifact_id: string;
  base_artifact_version_id: string;
  base_content_digest: string;
  candidate_digest: string;
  candidate_payload: JsonColumn;
  validation_payload: JsonColumn;
  review_task_id: string;
  review_task_version_id: string;
  review_task_ref: JsonColumn;
  status: string;
  command_id: string;
}

interface DeviationRecordRow {
  project_id: string;
  deviation_record_id: string;
  version_id: string;
  version_number: number;
  suggestion_id: string;
  suggestion_version_id: string;
  review_status: string;
  review_task_ref: JsonColumn;
  record_payload: JsonColumn;
  content_digest: string;
}

interface GovernanceDraftRow {
  project_id: string;
  draft_id: string;
  version_id: string;
  knowledge_revision_id: string;
  knowledge_revision_version_id: string;
  candidate_artifact_id: string;
  candidate_artifact_version_id: string;
}

interface SuggestionLineageReservationRow {
  reservation_id: string;
  project_id: string;
  deviation_id: string;
  predecessor_suggestion_id: string;
  predecessor_suggestion_version_id: string;
  successor_suggestion_id: string;
  successor_suggestion_version_id: string;
  review_decision_id: string;
  review_decision_version_id: string;
  command_id: string;
}

interface SuggestionLineageConsumptionRow {
  reservation_id: string;
  project_id: string;
  successor_suggestion_id: string;
  successor_suggestion_version_id: string;
  command_id: string;
}

interface CalibrationDatabase extends PostgresDatabase {
  "business.calibration_suggestions": SuggestionRow;
  "business.calibration_deviation_records": DeviationRecordRow;
  "business.calibration_governance_drafts": GovernanceDraftRow;
  "business.calibration_suggestion_lineage_reservations": SuggestionLineageReservationRow;
  "business.calibration_suggestion_lineage_consumptions": SuggestionLineageConsumptionRow;
}

type CalibrationTransaction = Transaction<CalibrationDatabase>;

const asCalibrationTransaction = (context: TransactionContextV1): CalibrationTransaction =>
  getPostgresTransaction(context) as unknown as CalibrationTransaction;

const jsonValue = (value: unknown): JsonValue => value as JsonValue;
const refEquals = (left: VersionReference, right: VersionReference): boolean =>
  left.entityId === right.entityId && left.versionId === right.versionId;

const atomicCommand = (
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
): AtomicCommandV1 => ({
  projectId: command.projectId,
  commandKind,
  commandId: command.commandId,
  idempotencyKey: command.idempotencyKey,
  payload: JSON.parse(JSON.stringify(payload)) as Record<string, never>,
  actorRef: command.actorId,
  authorizationContextRef: command.authorization.authorizationContextRef,
  issuedAt: command.issuedAt,
});

/** C29 只消费 C07 复核请求与校准批准证明，不声明完整 `ReviewAuditPortV1`。 */
export interface CalibrationReviewSeamV1 {
  requestReview(request: ReviewRequestV1): Promise<ReviewRequestResultV1>;
  verifyCalibrationSuggestionApproval(
    query: CalibrationSuggestionApprovalProofQueryV1,
  ): Promise<CalibrationSuggestionApprovalProofResultV1>;
}

export type SubmitRevisionCommandV1 = Extract<
  KnowledgeGovernanceCommandV1,
  { kind: "submit-revision" }
>;

/** C29 只消费 C16 `submit-revision`，不触达发布、停用或回滚。 */
export interface CalibrationGovernanceSeamV1 {
  govern(
    command: SubmitRevisionCommandV1,
  ): Promise<KnowledgeGovernanceResultForCommandV1<SubmitRevisionCommandV1>>;
}

/** 组合根按精确 branch 签发下游只读/窄写授权；C29 再亲自向 C06 复验。 */
export interface CalibrationDownstreamAuthorizationRequestV1 {
  readonly branch: ModuleBranchV1;
  readonly invocationId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly requestedAt: string;
  readonly requestedSpatialScopeRefs: readonly SpatialScopeRefV1[];
}

export type CalibrationDownstreamAuthorizerV1 = (
  request: CalibrationDownstreamAuthorizationRequestV1,
) => Promise<AuthorizationContextV1>;

export interface PostgresCalibrationAdapterOptionsV1 {
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: TransactionUnitV1;
  readonly access: LocalIdentityAccessV1;
  readonly deviationFacts: ResponseDeviationFactReaderV1;
  readonly inputSnapshots: AssessmentInputSnapshotReaderV1;
  readonly basis: AssessmentBasisReleaseSetReaderV1;
  readonly artifactStore: ArtifactStoreV1;
  readonly agentResults: AgentTaskCompletedResultReaderV1;
  readonly reviews: CalibrationReviewSeamV1;
  readonly governance: CalibrationGovernanceSeamV1;
  readonly authorizeDownstream: CalibrationDownstreamAuthorizerV1;
  readonly now?: () => Date;
}

/**
 * C29 四用例实现：授权先行，只按精确引用读取 C28/C25/C19/C04/C08/C07 公开或窄化接缝，
 * 先请求 C07 复核再以 C03 事务原子写入建议、公共偏差记录、回执、审计与既有 Outbox 事件。
 */
export class PostgresCalibrationAdapter implements CalibrationServiceV1 {
  readonly #db: Kysely<CalibrationDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #access: LocalIdentityAccessV1;
  readonly #deviationFacts: ResponseDeviationFactReaderV1;
  readonly #inputSnapshots: AssessmentInputSnapshotReaderV1;
  readonly #basis: AssessmentBasisReleaseSetReaderV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #agentResults: AgentTaskCompletedResultReaderV1;
  readonly #reviews: CalibrationReviewSeamV1;
  readonly #governance: CalibrationGovernanceSeamV1;
  readonly #authorizeDownstream: CalibrationDownstreamAuthorizerV1;
  readonly #now: () => Date;

  constructor(options: PostgresCalibrationAdapterOptionsV1) {
    this.#db = options.db as unknown as Kysely<CalibrationDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#access = options.access;
    this.#deviationFacts = options.deviationFacts;
    this.#inputSnapshots = options.inputSnapshots;
    this.#basis = options.basis;
    this.#artifactStore = options.artifactStore;
    this.#agentResults = options.agentResults;
    this.#reviews = options.reviews;
    this.#governance = options.governance;
    this.#authorizeDownstream = options.authorizeDownstream;
    this.#now = options.now ?? (() => new Date());
  }

  /* --------------------------------------------------------------- prepareInput */

  async prepareInput(
    command: CalibrationPrepareInputCommandV1,
  ): Promise<CalibrationPrepareInputResultV1> {
    try {
      await this.#verify(command.authorization, command.projectId, command.requestId);
      const agentPolicy = CalibrationValidationPolicyV1Schema.safeParse(command.agentPolicy);
      if (
        !agentPolicy.success ||
        agentPolicy.data.projectId !== command.projectId ||
        !refEquals(agentPolicy.data.policyRef, command.calibrationValidationPolicyRef)
      ) {
        failCalibration("calibration-contract-drift", command.targetReleaseRef);
      }
      const downstream = await this.#purposeContexts(
        {
          invocationId: command.requestId,
          projectId: command.projectId,
          actorId: command.actorId,
          requestedAt: command.requestedAt,
          spatialScopeRefs: command.authorization.spatialScopeRefs,
        },
        ["deviationFact", "basis", "governance"],
      );
      const fact = await this.#readDeviationFact(command, downstream.deviationFact);
      if (!fact.thresholdExceeded) {
        return { kind: "not-applicable", reasonCode: "calibration-deviation-within-threshold" };
      }
      if (fact.evidenceReferences.length === 0) {
        failCalibration("calibration-deviation-fact-incomplete", command.deviationFactRef);
      }
      const snapshotAuthorization = await this.#purposeContexts(
        {
          invocationId: command.requestId,
          projectId: command.projectId,
          actorId: command.actorId,
          requestedAt: command.requestedAt,
          spatialScopeRefs: command.authorization.spatialScopeRefs,
        },
        ["inputSnapshot"],
      );
      const frozen = await this.#inputSnapshots.readInputSnapshot({
        requestId: command.requestId,
        requestedAt: command.requestedAt,
        projectId: command.projectId,
        actorId: command.actorId,
        authorization: snapshotAuthorization.inputSnapshot,
        inputSnapshotRef: fact.frozenAssessmentBasisRef,
        targetReleaseRef: command.targetReleaseRef,
      });
      if (frozen.kind === "failed") {
        failCalibration(
          frozen.error.code === "AUTHORIZATION_DENIED"
            ? "calibration-authorization-required"
            : "calibration-frozen-assessment-mismatch",
          fact.frozenAssessmentBasisRef,
          frozen.error.code === "AUTHORIZATION_DENIED" ? "AUTHORIZATION_DENIED" : "STALE_VERSION",
        );
      }
      if (
        frozen.projectId !== command.projectId ||
        !refEquals(frozen.spatialScopeRef.reference, fact.spatialScopeRef.reference) ||
        !refEquals(frozen.basisReleaseSetRef.reference, command.basisReleaseSetRef.reference) ||
        !refEquals(frozen.targetReleaseRef.reference, command.targetReleaseRef.reference)
      ) {
        failCalibration("calibration-frozen-assessment-mismatch", fact.frozenAssessmentBasisRef);
      }
      const deviationRecordRef = deriveDeviationRecordRef({
        projectId: command.projectId,
        deviationFactRef: fact.deviationFactRef.reference,
      });
      const target = await this.#resolveTarget(command, downstream.basis);
      if (target.contentDigest !== frozen.targetContentDigest) {
        failCalibration("calibration-frozen-assessment-mismatch", command.targetReleaseRef);
      }
      const snapshotRef = deriveCalibrationInputSnapshotRef({
        projectId: command.projectId,
        deviationFactRef: fact.deviationFactRef.reference,
        targetReleaseRef: command.targetReleaseRef.reference,
        calibrationValidationPolicyRef: command.calibrationValidationPolicyRef,
      });
      const snapshot = CalibrationInputSnapshotV1Schema.parse({
        schemaVersion: "1",
        projectId: command.projectId,
        deviationFactRef: fact.deviationFactRef,
        deviationRecordRef,
        frozenAssessmentBasisRef: fact.frozenAssessmentBasisRef,
        basisReleaseSetRef: command.basisReleaseSetRef,
        targetDefinitionType: target.definitionType,
        targetReleaseRef: command.targetReleaseRef,
        baseArtifactRef: target.artifactRef,
        baseContentDigest: target.contentDigest,
        calibrationValidationPolicyRef: command.calibrationValidationPolicyRef,
        modelDeploymentRef: agentPolicy.data.budgetPolicy.modelDeploymentRef,
        promptTemplateRef: agentPolicy.data.budgetPolicy.promptTemplateRef,
        toolPolicyRef: agentPolicy.data.toolPolicyRef,
        budgetPolicyRef: agentPolicy.data.budgetPolicy.policyRef,
        preparedBy: command.actorId,
        preparedAt: command.requestedAt,
      });
      const frozenInputRef = await this.#putArtifact({
        commandId: command.requestId,
        issuedAt: command.requestedAt,
        authorization: downstream.governance,
        artifactId: snapshotRef.reference.entityId,
        purposeCode: CALIBRATION_INPUT_PURPOSE_CODE_V1,
        mediaType: CALIBRATION_INPUT_MEDIA_TYPE_V1,
        value: snapshot,
      });
      return {
        kind: "succeeded",
        result: {
          frozenInputRef,
          inputSnapshotRef: snapshotRef,
          deviationRecordRef,
          targetDefinitionType: target.definitionType,
        },
      };
    } catch (error: unknown) {
      return { kind: "failed", error: this.#toModuleError(error, command.requestId) };
    }
  }

  /* ----------------------------------------------------------- createSuggestion */

  async createSuggestion(
    command: CreateCalibrationSuggestionCommandV1,
  ): Promise<WarningResponseRecordResultV1> {
    const causalRunId =
      typeof command?.commandId === "string" && command.commandId.length > 0
        ? command.commandId
        : CALIBRATION_COMMAND_KIND_V1;
    const parsed = WarningResponseRecordCommandV1Schema.safeParse(command);
    if (!parsed.success || parsed.data.kind !== "create-calibration-suggestion") {
      return { kind: "failed", error: this.#unsupportedContract(causalRunId) };
    }
    const valid = parsed.data;
    try {
      const verified = await this.#verify(valid.authorization, valid.projectId, valid.commandId);
      const downstream = await this.#purposeContexts(
        {
          invocationId: valid.commandId,
          projectId: valid.projectId,
          actorId: valid.actorId,
          requestedAt: valid.issuedAt,
          spatialScopeRefs: valid.authorization.spatialScopeRefs,
        },
        ["agentResult", "basis", "deviationFact", "reviewRequest"],
      );
      const result = await this.#readCompletedResult(valid, downstream.agentResult);
      const frozenInputRef = ContentArtifactRefV1Schema.parse(result.frozenInputRef);
      const snapshot = CalibrationInputSnapshotV1Schema.parse(
        await this.#readArtifact(
          valid.commandId,
          downstream.basis,
          frozenInputRef,
          CALIBRATION_INPUT_PURPOSE_CODE_V1,
        ),
      );
      const candidate = CalibrationCandidateV1Schema.parse(
        await this.#readArtifact(
          valid.commandId,
          downstream.basis,
          result.incrementArtifactRef,
          AGENT_INCREMENT_PURPOSE_CODE_V1,
        ),
      );
      const inputSnapshotRef = deriveCalibrationInputSnapshotRef({
        projectId: snapshot.projectId,
        deviationFactRef: snapshot.deviationFactRef.reference,
        targetReleaseRef: snapshot.targetReleaseRef.reference,
        calibrationValidationPolicyRef: snapshot.calibrationValidationPolicyRef,
      });
      if (
        snapshot.projectId !== valid.projectId ||
        !refEquals(
          snapshot.deviationRecordRef.reference,
          valid.payload.deviationRecordRef.reference,
        ) ||
        !refEquals(
          snapshot.calibrationValidationPolicyRef,
          valid.payload.calibrationValidationPolicyRef,
        ) ||
        !refEquals(candidate.inputSnapshotRef.reference, inputSnapshotRef.reference) ||
        !refEquals(candidate.taskRef.reference, result.taskRef.reference) ||
        !refEquals(candidate.resultRef.reference, result.resultRef.reference)
      ) {
        failCalibration("calibration-agent-result-mismatch", valid.payload.deviationRecordRef);
      }
      const document = await this.#readTargetDocument(valid.commandId, downstream.basis, snapshot);
      const outcome = validateCalibrationCandidate({
        definitionType: snapshot.targetDefinitionType,
        document,
        candidate,
      });
      const candidateDigest = outcome.contentDigest;
      if (outcome.validation.disposition !== "accepted" || candidateDigest === undefined) {
        failCalibration(
          "calibration-candidate-invalid",
          { kind: "agent-task-result", reference: valid.payload.agentTaskResultRef.reference },
          outcome.validation.rejectionClass === "terminal"
            ? "TERMINAL_FAILURE"
            : "BUSINESS_BLOCKED",
        );
        return { kind: "failed", error: this.#unsupportedContract(causalRunId) };
      }
      const fact = await this.#readDeviationFactByRef({
        requestId: valid.commandId,
        idempotencyKey: valid.idempotencyKey,
        requestedAt: valid.issuedAt,
        authorization: downstream.deviationFact,
        projectId: valid.projectId,
        deviationFactRef: snapshot.deviationFactRef,
      });
      const derivedSuggestionRef = deriveCalibrationSuggestionRef({
        deviationRecordRef: valid.payload.deviationRecordRef.reference,
        agentTaskResultRef: valid.payload.agentTaskResultRef.reference,
        calibrationValidationPolicyRef: valid.payload.calibrationValidationPolicyRef,
        candidateDigest,
      });
      const creation = await this.#resolveSuggestionCreation(valid, derivedSuggestionRef, {
        deviationFactRef: snapshot.deviationFactRef.reference,
        frozenInputRef: frozenInputRef.reference,
        targetReleaseRef: snapshot.targetReleaseRef.reference,
        baseArtifactRef: snapshot.baseArtifactRef.reference,
        baseContentDigest: snapshot.baseContentDigest,
      });
      const suggestionRef = creation.suggestionRef;
      const reviewTaskRef = await this.#requestReview({
        command: valid,
        verified: downstream.reviewRequest,
        suggestionRef,
        parentRunRef: result.parentRunRef,
      });
      const recordedAt = this.#nowIso();
      const record = this.#buildPendingDeviationRecord({
        snapshot,
        fact,
        suggestionRef: suggestionRef.reference,
        actorId: verified.actorId,
        recordedAt,
      });
      await this.#executeWithRetry(
        atomicCommand(valid, CALIBRATION_COMMAND_KIND_V1, valid.payload),
        async (context): Promise<AtomicCommitV1> => {
          const transaction = asCalibrationTransaction(context);
          await transaction
            .insertInto("business.calibration_suggestions")
            .values({
              suggestion_id: suggestionRef.reference.entityId,
              version_id: suggestionRef.reference.versionId,
              schema_version: "1",
              project_id: valid.projectId,
              deviation_id: valid.payload.deviationRecordRef.reference.entityId,
              deviation_version_id: valid.payload.deviationRecordRef.reference.versionId,
              deviation_fact_id: snapshot.deviationFactRef.reference.entityId,
              deviation_fact_version_id: snapshot.deviationFactRef.reference.versionId,
              agent_task_id: result.taskRef.reference.entityId,
              agent_task_version_id: result.taskRef.reference.versionId,
              agent_task_result_ref: jsonValue(result.resultRef),
              validation_policy_entity_id: valid.payload.calibrationValidationPolicyRef.entityId,
              validation_policy_version_id: valid.payload.calibrationValidationPolicyRef.versionId,
              frozen_input_artifact_id: frozenInputRef.reference.entityId,
              frozen_input_artifact_version_id: frozenInputRef.reference.versionId,
              target_definition_type: snapshot.targetDefinitionType,
              target_release_entity_id: snapshot.targetReleaseRef.reference.entityId,
              target_release_version_id: snapshot.targetReleaseRef.reference.versionId,
              base_artifact_id: snapshot.baseArtifactRef.reference.entityId,
              base_artifact_version_id: snapshot.baseArtifactRef.reference.versionId,
              base_content_digest: snapshot.baseContentDigest,
              candidate_digest: candidateDigest,
              candidate_payload: jsonValue(candidate),
              validation_payload: jsonValue(outcome.validation),
              review_task_id: reviewTaskRef.reference.entityId,
              review_task_version_id: reviewTaskRef.reference.versionId,
              review_task_ref: jsonValue(reviewTaskRef),
              parent_run_id: result.parentRunRef.reference.entityId,
              parent_run_version_id: result.parentRunRef.reference.versionId,
              spatial_scope_entity_id: fact.spatialScopeRef.reference.entityId,
              spatial_scope_version_id: fact.spatialScopeRef.reference.versionId,
              status: "pending-review",
              returned_decision_ref: null,
              approved_decision_ref: null,
              command_id: valid.commandId,
              idempotency_key: valid.idempotencyKey,
              actor_ref: verified.actorId,
              authorization_context_ref: jsonValue(valid.authorization.authorizationContextRef),
              audit_entry_id: `audit-${valid.commandId}:calibration-suggestion`,
              created_at: new Date(valid.issuedAt),
              recorded_at: this.#nowIso(),
            } as never)
            .onConflict((conflict) => conflict.doNothing())
            .execute();
          const stored = await this.#loadSuggestionRow(
            transaction,
            valid.projectId,
            suggestionRef.reference,
          );
          if (stored === undefined || stored.candidate_digest !== candidateDigest) {
            failCalibration("calibration-idempotency-conflict", suggestionRef);
          }
          if (creation.reservation === undefined) {
            await this.#insertDeviationRecordVersion({
              transaction,
              command: valid,
              record,
              deviationFactRef: snapshot.deviationFactRef.reference,
              suggestionRef: suggestionRef.reference,
              reviewTaskRef,
              versionNumber: 1,
              reviewStatus: "pending",
              auditEntryId: `audit-${valid.commandId}:calibration-suggestion`,
              reviewDecisionRef: undefined,
            });
          } else {
            await transaction
              .insertInto("business.calibration_suggestion_lineage_consumptions")
              .values({
                reservation_id: creation.reservation.reservation_id,
                project_id: valid.projectId,
                successor_suggestion_id: suggestionRef.reference.entityId,
                successor_suggestion_version_id: suggestionRef.reference.versionId,
                command_id: valid.commandId,
                idempotency_key: valid.idempotencyKey,
                audit_entry_id: `audit-${valid.commandId}:calibration-suggestion`,
                recorded_at: recordedAt,
              } as never)
              .onConflict((conflict) => conflict.doNothing())
              .execute();
            const consumption = await this.#loadLineageConsumption(
              transaction,
              creation.reservation.reservation_id,
            );
            if (consumption?.command_id !== valid.commandId) {
              failCalibration("calibration-suggestion-not-advanceable", suggestionRef);
            }
          }
          return {
            resultRef: suggestionRef,
            audit: {
              auditEntryId: `audit-${valid.commandId}:calibration-suggestion`,
              projectId: valid.projectId,
              action: CALIBRATION_COMMAND_KIND_V1,
              targetRef: suggestionRef,
              actorRef: verified.actorId,
              authorizationContextRef: valid.authorization.authorizationContextRef,
              occurredAt: valid.issuedAt,
              recordedAt: this.#nowIso(),
              version: { entityId: `audit-${valid.commandId}`, versionId: "1" },
              commandId: valid.commandId,
              idempotencyKey: valid.idempotencyKey,
            },
            events: [
              DomainEventV1Schema.parse({
                schemaVersion: "1",
                eventId: `${valid.commandId}:calibration-suggestion-created`,
                eventVersion: 1,
                projectId: valid.projectId,
                aggregateRef: suggestionRef,
                occurredAt: valid.issuedAt,
                recordedAt: this.#nowIso(),
                causationId: valid.commandId,
                correlationId: valid.commandId,
                producerCommandId: valid.commandId,
                idempotencyKey: valid.idempotencyKey,
                authorizationContextRef: valid.authorization.authorizationContextRef,
                // C03 要求事件的 auditTrailRef 精确等于同事务审计条目 id。
                auditTrailRef: {
                  kind: "audit-trail",
                  reference: {
                    entityId: `audit-${valid.commandId}:calibration-suggestion`,
                    versionId: "1",
                  },
                },
                eventType: SUGGESTION_CREATED_EVENT_TYPE_V1,
                payload: {
                  deviationRecordRef: valid.payload.deviationRecordRef,
                  calibrationSuggestionRef: suggestionRef,
                  reviewTaskRef,
                },
              }),
            ],
          };
        },
      );
      return WarningResponseRecordResultV1Schema.parse({
        kind: "succeeded",
        result: {
          kind: "calibration",
          calibrationSuggestionRef: suggestionRef,
          reviewTaskRef,
        },
      });
    } catch (error: unknown) {
      return { kind: "failed", error: this.#toModuleError(error, causalRunId) };
    }
  }

  /* -------------------------------------------------------- recordReviewOutcome */

  async recordReviewOutcome(
    command: CalibrationReviewOutcomeCommandV1,
  ): Promise<CalibrationReviewOutcomeResultV1> {
    const verification = await this.#verifySuggestions(command, false);
    if (verification.kind === "failed") return verification;
    try {
      return await this.#closeReviewOutcome(command, verification.row, verification.proof);
    } catch (error: unknown) {
      return { kind: "failed", error: this.#toModuleError(error, command.commandId) };
    }
  }

  /* ------------------------------------------------------ createGovernanceDraft */

  async createGovernanceDraft(
    command: CalibrationReviewOutcomeCommandV1,
  ): Promise<CalibrationGovernanceDraftResultV1> {
    const verification = await this.#verifySuggestions(command, true);
    if (verification.kind === "failed") return verification;
    try {
      return await this.#createDraft(command, verification.row, verification.proof);
    } catch (error: unknown) {
      return { kind: "failed", error: this.#toModuleError(error, command.commandId) };
    }
  }

  /* ----------------------------------------------------------------- internals */

  /** 两个决定用例的公共前置：授权与三项证明校验都发生在任何 C29 写入之前。 */
  async #verifySuggestions(
    command: CalibrationReviewOutcomeCommandV1,
    requireGovernanceCapabilities: true,
  ): Promise<{ kind: "verified"; row: SuggestionRow; proof: CalibrationProofV1 } | FailureV1>;
  async #verifySuggestions(
    command: CalibrationReviewOutcomeCommandV1,
    requireGovernanceCapabilities: false,
  ): Promise<{ kind: "verified"; row: SuggestionRow; proof: CalibrationProofV1 } | FailureV1>;
  async #verifySuggestions(
    command: CalibrationReviewOutcomeCommandV1,
    requireGovernanceCapabilities: boolean,
  ): Promise<{ kind: "verified"; row: SuggestionRow; proof: CalibrationProofV1 } | FailureV1> {
    try {
      await this.#verify(command.authorization, command.projectId, command.commandId);
      if (requireGovernanceCapabilities) this.#assertGovernanceCapabilities(command.authorization);
      const downstream = await this.#purposeContexts(
        {
          invocationId: command.commandId,
          projectId: command.projectId,
          actorId: command.actorId,
          requestedAt: command.issuedAt,
          spatialScopeRefs: command.authorization.spatialScopeRefs,
        },
        ["reviewProof"],
      );
      const row = await this.#loadSuggestion(command);
      const proof = await this.#reviews.verifyCalibrationSuggestionApproval({
        queryId: command.commandId,
        projectId: command.projectId,
        actorId: command.actorId,
        requestedAt: command.issuedAt,
        authorization: downstream.reviewProof,
        kind: "verify-calibration-suggestion-approval",
        payload: {
          calibrationSuggestionRef: command.payload.calibrationSuggestionRef,
          reviewDecisionRef: command.payload.reviewDecisionRef,
        },
      });
      if (proof.kind !== "succeeded") {
        return {
          kind: "failed",
          error:
            proof.kind === "failed" ? proof.error : this.#unsupportedContract(command.commandId),
        };
      }
      return { kind: "verified", row, proof: proof.result };
    } catch (error: unknown) {
      return { kind: "failed", error: this.#toModuleError(error, command.commandId) };
    }
  }

  /**
   * 三种决定的确定性收口：证明是唯一批准依据，决定类型由调用方声明并与证明闭合结果对账。
   */
  async #closeReviewOutcome(
    command: CalibrationReviewOutcomeCommandV1,
    row: SuggestionRow,
    proof: CalibrationProofV1,
  ): Promise<CalibrationReviewOutcomeResultV1> {
    this.#assertProofOutcome(proof, command);
    if (command.payload.outcome === "approve-draft-creation") {
      failCalibration(
        "calibration-review-decision-not-approval",
        command.payload.calibrationSuggestionRef,
        "BUSINESS_BLOCKED",
      );
    }
    if (command.payload.outcome === "return-for-revision") {
      const replay = await this.#loadLineageReservationByDecision(
        this.#db,
        command.projectId,
        command.payload.reviewDecisionRef.reference,
      );
      if (replay !== undefined) {
        if (
          replay.predecessor_suggestion_id !== row.suggestion_id ||
          replay.predecessor_suggestion_version_id !== row.version_id
        ) {
          failCalibration(
            "calibration-review-target-mismatch",
            command.payload.calibrationSuggestionRef,
          );
        }
        if ((await this.#loadLineageConsumption(this.#db, replay.reservation_id)) !== undefined) {
          failCalibration(
            "calibration-suggestion-not-advanceable",
            command.payload.calibrationSuggestionRef,
            "BUSINESS_BLOCKED",
          );
        }
        const replayRecord = await this.#loadDeviationRecordBySuggestion(
          command.projectId,
          replay.deviation_id,
          {
            entityId: replay.successor_suggestion_id,
            versionId: replay.successor_suggestion_version_id,
          },
        );
        if (replayRecord === undefined) {
          failCalibration("calibration-contract-drift", command.payload.calibrationSuggestionRef);
        }
        return {
          kind: "succeeded",
          result: {
            calibrationSuggestionRef: command.payload.calibrationSuggestionRef,
            outcome: "returned",
            deviationRecordRef: {
              kind: "deviation-record",
              reference: DeviationRecordSchema.parse(replayRecord.record_payload).version.reference,
            },
            deviationRecordVersionId: replayRecord.version_id,
          },
        };
      }
    }
    const previous = await this.#loadLatestDeviationRecord(command.projectId, row.deviation_id);
    if (previous === undefined) {
      return failCalibration(
        "calibration-suggestion-not-advanceable",
        command.payload.calibrationSuggestionRef,
      );
    }
    this.#assertCurrentSuggestion(previous, row, command.payload.calibrationSuggestionRef);
    const recordedAt = this.#nowIso();
    const nextVersionNumber = previous.version_number + 1;
    const successorRef =
      command.payload.outcome === "return-for-revision"
        ? deriveSuccessorCalibrationSuggestionRef({
            predecessorSuggestionRef: command.payload.calibrationSuggestionRef.reference,
            reviewDecisionRef: command.payload.reviewDecisionRef.reference,
          })
        : undefined;
    const record =
      command.payload.outcome === "reject"
        ? this.#appendDeviationRecordVersion(previous, "rejected", nextVersionNumber, recordedAt)
        : this.#appendPendingDeviationRecordVersion(
            previous,
            successorRef!.reference,
            nextVersionNumber,
            recordedAt,
          );
    const verified = await this.#verify(
      command.authorization,
      command.projectId,
      command.commandId,
    );
    await this.#executeWithRetry(
      atomicCommand(command, REVIEW_OUTCOME_COMMAND_KIND_V1, command.payload),
      async (context): Promise<AtomicCommitV1> => {
        const transaction = asCalibrationTransaction(context);
        if (command.payload.outcome === "return-for-revision") {
          const reservationId = `calibration-lineage-${sha256CanonicalJson({
            projectId: command.projectId,
            predecessorSuggestionRef: command.payload.calibrationSuggestionRef.reference,
            reviewDecisionRef: command.payload.reviewDecisionRef.reference,
          }).slice(0, 32)}`;
          await transaction
            .insertInto("business.calibration_suggestion_lineage_reservations")
            .values({
              reservation_id: reservationId,
              project_id: command.projectId,
              deviation_id: row.deviation_id,
              predecessor_suggestion_id: row.suggestion_id,
              predecessor_suggestion_version_id: row.version_id,
              successor_suggestion_id: successorRef!.reference.entityId,
              successor_suggestion_version_id: successorRef!.reference.versionId,
              review_decision_id: command.payload.reviewDecisionRef.reference.entityId,
              review_decision_version_id: command.payload.reviewDecisionRef.reference.versionId,
              command_id: command.commandId,
              idempotency_key: command.idempotencyKey,
              audit_entry_id: `audit-${command.commandId}:calibration-review-outcome`,
              recorded_at: recordedAt,
            } as never)
            .onConflict((conflict) => conflict.doNothing())
            .execute();
          const stored = await this.#loadLineageReservationByDecision(
            transaction,
            command.projectId,
            command.payload.reviewDecisionRef.reference,
          );
          if (
            stored === undefined ||
            stored.reservation_id !== reservationId ||
            stored.predecessor_suggestion_id !== row.suggestion_id ||
            stored.predecessor_suggestion_version_id !== row.version_id ||
            stored.successor_suggestion_id !== successorRef!.reference.entityId ||
            stored.successor_suggestion_version_id !== successorRef!.reference.versionId
          ) {
            failCalibration("calibration-idempotency-conflict", command.payload.reviewDecisionRef);
          }
        }
        {
          // 拒绝只追加被拒绝记录版本：三张 C29 表只允许 INSERT/SELECT，建议事实不可原地改写。
          await this.#insertDeviationRecordVersion({
            transaction,
            command,
            record,
            deviationFactRef: {
              entityId: row.deviation_fact_id,
              versionId: row.deviation_fact_version_id,
            },
            suggestionRef: successorRef?.reference ?? {
              entityId: row.suggestion_id,
              versionId: row.version_id,
            },
            reviewTaskRef: ReviewTaskRefV1Schema.parse(row.review_task_ref),
            versionNumber: nextVersionNumber,
            reviewStatus: command.payload.outcome === "reject" ? "rejected" : "pending",
            auditEntryId: `audit-${command.commandId}:calibration-review-outcome`,
            reviewDecisionRef:
              command.payload.outcome === "reject" ? command.payload.reviewDecisionRef : undefined,
          });
        }
        return {
          resultRef: command.payload.calibrationSuggestionRef,
          audit: {
            auditEntryId: `audit-${command.commandId}:calibration-review-outcome`,
            projectId: command.projectId,
            action: REVIEW_OUTCOME_COMMAND_KIND_V1,
            targetRef: command.payload.calibrationSuggestionRef,
            actorRef: verified.actorId,
            authorizationContextRef: command.authorization.authorizationContextRef,
            occurredAt: command.issuedAt,
            recordedAt,
            version: { entityId: `audit-${command.commandId}`, versionId: "1" },
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
          },
          events: [],
        };
      },
    );
    return {
      kind: "succeeded",
      result: {
        calibrationSuggestionRef: command.payload.calibrationSuggestionRef,
        outcome: command.payload.outcome === "reject" ? "rejected" : "returned",
        deviationRecordRef: {
          kind: "deviation-record",
          reference: record.version.reference,
        },
        deviationRecordVersionId: record.version.reference.versionId,
      },
    };
  }

  /**
   * 草案创建：复验治理授权与批准证明，精确重放候选摘要，再以内容工件与幂等命令调用 C16。
   * C16 成功后 C29 才追加 `approved` 公共记录版本与草案关联。
   */
  async #createDraft(
    command: CalibrationReviewOutcomeCommandV1,
    row: SuggestionRow,
    proof: CalibrationProofV1,
  ): Promise<CalibrationGovernanceDraftResultV1> {
    if (command.payload.outcome !== "approve-draft-creation") {
      failCalibration(
        "calibration-review-decision-not-approval",
        command.payload.calibrationSuggestionRef,
      );
    }
    this.#assertProofOutcome(proof, command);
    const verified = await this.#verify(
      command.authorization,
      command.projectId,
      command.commandId,
    );
    const downstream = await this.#purposeContexts(
      {
        invocationId: command.commandId,
        projectId: command.projectId,
        actorId: command.actorId,
        requestedAt: command.issuedAt,
        spatialScopeRefs: command.authorization.spatialScopeRefs,
      },
      ["basis", "governance"],
    );
    const snapshot = CalibrationInputSnapshotV1Schema.parse(
      await this.#readArtifact(
        command.commandId,
        downstream.basis,
        {
          kind: "content-artifact",
          reference: {
            entityId: row.frozen_input_artifact_id,
            versionId: row.frozen_input_artifact_version_id,
          },
        },
        CALIBRATION_INPUT_PURPOSE_CODE_V1,
      ),
    );
    const document = await this.#readTargetDocument(command.commandId, downstream.basis, snapshot);
    const candidate = CalibrationCandidateV1Schema.parse(row.candidate_payload);
    const outcome = validateCalibrationCandidate({
      definitionType: snapshot.targetDefinitionType,
      document,
      candidate,
    });
    const candidateDigest = outcome.contentDigest;
    if (
      outcome.validation.disposition !== "accepted" ||
      candidateDigest === undefined ||
      candidateDigest !== row.candidate_digest
    ) {
      failCalibration(
        "calibration-base-artifact-mismatch",
        command.payload.calibrationSuggestionRef,
      );
      return { kind: "failed", error: this.#unsupportedContract(command.commandId) };
    }
    const candidateArtifactRef = await this.#putArtifact({
      commandId: command.commandId,
      issuedAt: command.issuedAt,
      authorization: downstream.governance,
      artifactId: `calibration-candidate-${row.candidate_digest.slice(0, 32)}`,
      purposeCode: CALIBRATION_CANDIDATE_PURPOSE_CODE_V1,
      mediaType: CALIBRATION_CANDIDATE_MEDIA_TYPE_V1,
      value: outcome.document,
    });
    const revision = await this.#governance.govern({
      kind: "submit-revision",
      commandId: `${command.commandId}:submit-revision`,
      idempotencyKey: `${command.idempotencyKey}:submit-revision`,
      projectId: command.projectId,
      actorId: command.actorId,
      issuedAt: command.issuedAt,
      authorization: downstream.governance,
      payload: {
        definitionType: snapshot.targetDefinitionType,
        baseReleaseRef: snapshot.targetReleaseRef,
        candidateArtifactRef,
        evidenceReferences: [...candidate.evidenceReferences],
      },
    });
    if (revision.kind !== "succeeded" || revision.result.kind !== "revision") {
      return {
        kind: "failed",
        error:
          revision.kind === "failed"
            ? revision.error
            : this.#toModuleError(
                new TypeError("knowledge governance did not return a revision"),
                command.commandId,
              ),
      };
    }
    const knowledgeRevisionRef = revision.result.knowledgeRevisionRef;
    const draftRef: VersionReference = {
      entityId: `calibration-draft-${sha256CanonicalJson({
        suggestionId: row.suggestion_id,
        suggestionVersionId: row.version_id,
        reviewDecisionRef: command.payload.reviewDecisionRef.reference,
      }).slice(0, 32)}`,
      versionId: "1",
    };
    const previous = await this.#loadLatestDeviationRecord(command.projectId, row.deviation_id);
    if (previous === undefined) {
      return failCalibration(
        "calibration-suggestion-not-advanceable",
        command.payload.calibrationSuggestionRef,
      );
    }
    this.#assertCurrentSuggestion(previous, row, command.payload.calibrationSuggestionRef);
    const recordedAt = this.#nowIso();
    const nextVersionNumber = previous.version_number + 1;
    const record = this.#appendDeviationRecordVersion(
      previous,
      "approved",
      nextVersionNumber,
      recordedAt,
    );
    await this.#executeWithRetry(
      atomicCommand(command, GOVERNANCE_DRAFT_COMMAND_KIND_V1, command.payload),
      async (context): Promise<AtomicCommitV1> => {
        const transaction = asCalibrationTransaction(context);
        await transaction
          .insertInto("business.calibration_governance_drafts")
          .values({
            draft_id: draftRef.entityId,
            version_id: draftRef.versionId,
            schema_version: "1",
            project_id: command.projectId,
            suggestion_id: row.suggestion_id,
            suggestion_version_id: row.version_id,
            review_task_id: row.review_task_id,
            review_task_version_id: row.review_task_version_id,
            review_decision_id: command.payload.reviewDecisionRef.reference.entityId,
            review_decision_version_id: command.payload.reviewDecisionRef.reference.versionId,
            decided_at: new Date(command.issuedAt),
            definition_type: snapshot.targetDefinitionType,
            base_release_entity_id: snapshot.targetReleaseRef.reference.entityId,
            base_release_version_id: snapshot.targetReleaseRef.reference.versionId,
            base_artifact_id: snapshot.baseArtifactRef.reference.entityId,
            base_artifact_version_id: snapshot.baseArtifactRef.reference.versionId,
            base_content_digest: snapshot.baseContentDigest,
            candidate_artifact_id: candidateArtifactRef.reference.entityId,
            candidate_artifact_version_id: candidateArtifactRef.reference.versionId,
            candidate_digest: candidateDigest,
            knowledge_revision_id: knowledgeRevisionRef.reference.entityId,
            knowledge_revision_version_id: knowledgeRevisionRef.reference.versionId,
            command_id: command.commandId,
            idempotency_key: command.idempotencyKey,
            actor_ref: verified.actorId,
            authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
            audit_entry_id: `audit-${command.commandId}:calibration-governance-draft`,
            recorded_at: recordedAt,
          } as never)
          .onConflict((conflict) => conflict.doNothing())
          .execute();
        const stored = await this.#loadDraftRow(transaction, command.projectId, draftRef);
        if (
          stored === undefined ||
          stored.knowledge_revision_id !== knowledgeRevisionRef.reference.entityId ||
          stored.knowledge_revision_version_id !== knowledgeRevisionRef.reference.versionId
        ) {
          failCalibration(
            "calibration-governance-draft-conflict",
            command.payload.calibrationSuggestionRef,
          );
        }
        await this.#insertDeviationRecordVersion({
          transaction,
          command,
          record,
          deviationFactRef: {
            entityId: row.deviation_fact_id,
            versionId: row.deviation_fact_version_id,
          },
          suggestionRef: { entityId: row.suggestion_id, versionId: row.version_id },
          reviewTaskRef: ReviewTaskRefV1Schema.parse(row.review_task_ref),
          versionNumber: nextVersionNumber,
          reviewStatus: "approved",
          auditEntryId: `audit-${command.commandId}:calibration-governance-draft`,
          reviewDecisionRef: command.payload.reviewDecisionRef,
        });
        return {
          // C03 回执只承载公共引用：草案关联本身是 C29 私有事实。
          resultRef: command.payload.calibrationSuggestionRef,
          audit: {
            auditEntryId: `audit-${command.commandId}:calibration-governance-draft`,
            projectId: command.projectId,
            action: GOVERNANCE_DRAFT_COMMAND_KIND_V1,
            targetRef: command.payload.calibrationSuggestionRef,
            actorRef: verified.actorId,
            authorizationContextRef: command.authorization.authorizationContextRef,
            occurredAt: command.issuedAt,
            recordedAt,
            version: { entityId: `audit-${command.commandId}`, versionId: "1" },
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
          },
          events: [],
        };
      },
    );
    return {
      kind: "succeeded",
      result: {
        governanceDraftRef: draftRef,
        knowledgeRevisionRef,
        candidateArtifactRef,
        deviationRecordRef: { kind: "deviation-record", reference: record.version.reference },
        deviationRecordVersionId: record.version.reference.versionId,
      },
    };
  }

  async #verify(
    authorization: AuthorizationContextV1,
    projectId: string,
    invocationId: string,
  ): Promise<AuthorizationContextV1> {
    const capability = MODULE_BRANCH_CAPABILITY_V1[CALIBRATION_BRANCH_V1];
    if (
      authorization.projectId !== projectId ||
      !authorization.grantedCapabilities.includes(capability)
    ) {
      failCalibration(
        "calibration-authorization-required",
        {
          kind: "authorization-context",
          reference: { entityId: "warning-response.calibration.unauthorized", versionId: "1" },
        },
        "AUTHORIZATION_DENIED",
      );
    }
    const decision = await this.#access
      .verify({
        authorizationContextRef: authorization.authorizationContextRef,
        invocationId,
        projectId,
        branch: CALIBRATION_BRANCH_V1,
        requestedSpatialScopeRefs: [...authorization.spatialScopeRefs],
        requestedSourceVersionRefs: [],
        requestedAt: authorization.decidedAt,
      })
      .catch((error: unknown): never => {
        if (error instanceof AccessServiceError) {
          failCalibration(
            "calibration-authorization-required",
            {
              kind: "authorization-context",
              reference: { entityId: "warning-response.calibration.unauthorized", versionId: "1" },
            },
            "AUTHORIZATION_DENIED",
          );
        }
        throw error;
      });
    if (decision.context.actorId !== authorization.actorId) {
      failCalibration(
        "calibration-authorization-required",
        {
          kind: "authorization-context",
          reference: { entityId: "warning-response.calibration.unauthorized", versionId: "1" },
        },
        "AUTHORIZATION_DENIED",
      );
    }
    return decision.context;
  }

  /**
   * 每个下游用途单独授权：组合根签发后由 C29 复验工程、主体、单一能力与请求空间子集，
   * 不允许把命令授权直接透传给能力不同的接缝。
   */
  async #authorizeFor(input: {
    readonly branch: ModuleBranchV1;
    readonly invocationId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
  }): Promise<AuthorizationContextV1> {
    const context = await this.#authorizeDownstream({
      branch: input.branch,
      invocationId: input.invocationId,
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      requestedSpatialScopeRefs: input.spatialScopeRefs,
    });
    const capability = MODULE_BRANCH_CAPABILITY_V1[input.branch];
    const requested = new Set(
      input.spatialScopeRefs.map(
        (scope) => `${scope.reference.entityId}\u0000${scope.reference.versionId}`,
      ),
    );
    if (
      context.projectId !== input.projectId ||
      context.actorId !== input.actorId ||
      context.grantedCapabilities.length !== 1 ||
      !context.grantedCapabilities.includes(capability) ||
      context.spatialScopeRefs.some(
        (scope) => !requested.has(`${scope.reference.entityId}\u0000${scope.reference.versionId}`),
      )
    ) {
      failCalibration(
        "calibration-authorization-required",
        {
          kind: "authorization-context",
          reference: {
            entityId: `warning-response.calibration.unauthorized.${capability}`,
            versionId: "1",
          },
        },
        "AUTHORIZATION_DENIED",
      );
    }
    return context;
  }

  /** 草案创建必须同时具备三项既有授权；任一缺失都不得读取建议或决定正文。 */
  #assertGovernanceCapabilities(authorization: AuthorizationContextV1): void {
    const required = [
      MODULE_BRANCH_CAPABILITY_V1[CALIBRATION_BRANCH_V1],
      "review-audit.read",
      MODULE_BRANCH_CAPABILITY_V1[GOVERNANCE_BRANCH_V1],
    ] as readonly ModuleCapabilityV1[];
    for (const capability of required) {
      if (!authorization.grantedCapabilities.includes(capability)) {
        failCalibration(
          "calibration-authorization-required",
          {
            kind: "authorization-context",
            reference: {
              entityId: `warning-response.calibration.unauthorized.${capability}`,
              versionId: "1",
            },
          },
          "AUTHORIZATION_DENIED",
        );
      }
    }
  }

  async #readDeviationFact(
    command: CalibrationPrepareInputCommandV1,
    authorization: AuthorizationContextV1,
  ) {
    const result = await this.#deviationFacts.readDeviationFact({
      requestId: command.requestId,
      idempotencyKey: command.idempotencyKey,
      requestedAt: command.requestedAt,
      authorization,
      deviationFactRef: command.deviationFactRef,
    });
    if (result.kind !== "succeeded") {
      return failCalibration("calibration-deviation-fact-unavailable", command.deviationFactRef);
    }
    const fact = result.result.fact;
    if (
      fact.projectId !== command.projectId ||
      !refEquals(fact.deviationFactRef.reference, command.deviationFactRef.reference)
    ) {
      failCalibration("calibration-deviation-fact-incomplete", command.deviationFactRef);
    }
    return fact;
  }

  async #readDeviationFactByRef(input: {
    readonly requestId: string;
    readonly idempotencyKey: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly projectId: string;
    readonly deviationFactRef: {
      readonly kind: "response-deviation-fact";
      readonly reference: VersionReference;
    };
  }) {
    const result = await this.#deviationFacts.readDeviationFact({
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      requestedAt: input.requestedAt,
      authorization: input.authorization,
      deviationFactRef: input.deviationFactRef,
    });
    if (result.kind !== "succeeded" || result.result.fact.projectId !== input.projectId) {
      return failCalibration("calibration-deviation-fact-unavailable", input.deviationFactRef);
    }
    return result.result.fact;
  }

  /**
   * 目标只从冻结的评估依据解析：`structured-scoring-rule` 取规则成员，
   * 其余六类目标定义取配置成员；目标发布不在依据内即视为越出冻结边界。
   */
  async #resolveTarget(
    command: CalibrationPrepareInputCommandV1,
    authorization: AuthorizationContextV1,
  ): Promise<{
    definitionType: CalibrationTargetDefinitionTypeV1;
    artifactRef: ContentArtifactRefV1;
    contentDigest: string;
  }> {
    const basis = await this.#basis.readAssessmentBasisReleaseSet({
      requestId: command.requestId,
      idempotencyKey: command.idempotencyKey,
      requestedAt: command.requestedAt,
      authorization,
      assessmentBasisReleaseSetRef: command.basisReleaseSetRef,
    });
    if (basis.kind !== "succeeded") {
      return failCalibration("calibration-basis-member-unavailable", command.basisReleaseSetRef);
    }
    const member = basis.configurationMembers.find(
      (candidate) =>
        candidate.releaseRef.reference.entityId === command.targetReleaseRef.reference.entityId &&
        candidate.releaseRef.reference.versionId === command.targetReleaseRef.reference.versionId,
    );
    if (member === undefined) {
      const ruleMember = basis.scoringRuleMembers.find(
        (candidate) =>
          candidate.releaseRef.reference.entityId === command.targetReleaseRef.reference.entityId &&
          candidate.releaseRef.reference.versionId === command.targetReleaseRef.reference.versionId,
      );
      if (ruleMember !== undefined) {
        return {
          definitionType: "structured-scoring-rule",
          artifactRef: ruleMember.artifactRef,
          contentDigest: ruleMember.contentDigest,
        };
      }
      failCalibration("calibration-target-not-affected", command.targetReleaseRef);
    }
    if (!isCalibrationTargetDefinitionType(member.definitionType)) {
      failCalibration("calibration-target-not-affected", command.targetReleaseRef);
    }
    return {
      definitionType: member.definitionType,
      artifactRef: member.artifactRef,
      contentDigest: member.contentDigest,
    };
  }

  async #readTargetDocument(
    requestId: string,
    authorization: AuthorizationContextV1,
    snapshot: {
      readonly targetDefinitionType: CalibrationTargetDefinitionTypeV1;
      readonly baseArtifactRef: ContentArtifactRefV1;
      readonly baseContentDigest: string;
    },
  ): Promise<CalibrationTargetDocumentV1> {
    const value = await this.#readArtifact(
      requestId,
      authorization,
      snapshot.baseArtifactRef,
      snapshot.targetDefinitionType === "structured-scoring-rule"
        ? STRUCTURED_SCORING_RULE_ARTIFACT_PURPOSE_CODE_V1
        : ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
    );
    const document: CalibrationTargetDocumentV1 =
      snapshot.targetDefinitionType === "structured-scoring-rule"
        ? StructuredScoringRuleDocumentV1Schema.parse(value)
        : AssessmentConfigurationDocumentV1Schema.parse(value);
    if (digestDocument(snapshot.targetDefinitionType, document) !== snapshot.baseContentDigest) {
      failCalibration("calibration-base-artifact-mismatch", snapshot.baseArtifactRef);
    }
    return document;
  }

  async #readCompletedResult(
    command: CreateCalibrationSuggestionCommandV1,
    verified: AuthorizationContextV1,
  ): Promise<AgentTaskCompletedResultV1> {
    const request: AgentTaskCompletedResultReadRequestV1 = {
      projectId: command.projectId,
      actorId: command.actorId,
      requestId: command.commandId,
      requestedAt: command.issuedAt,
      taskRef: command.payload.agentTaskResultRef.agentTaskRef,
      resultRef: command.payload.agentTaskResultRef,
      expectedTaskType: "calibration-suggestion",
      authorization: verified,
    };
    const read = await this.#agentResults.readCompletedResult(request);
    if (read.kind !== "succeeded") {
      return failCalibration("calibration-agent-task-unavailable", {
        kind: "agent-task-result",
        reference: command.payload.agentTaskResultRef.reference,
      });
    }
    return read.result;
  }

  async #requestReview(input: {
    readonly command: CreateCalibrationSuggestionCommandV1;
    readonly verified: AuthorizationContextV1;
    readonly suggestionRef: {
      readonly kind: "calibration-suggestion";
      readonly reference: VersionReference;
    };
    readonly parentRunRef: { readonly kind: string; readonly reference: VersionReference };
  }): Promise<ReviewTaskRefV1> {
    const reviewRequestId = `calibration-review-${sha256CanonicalJson({
      projectId: input.command.projectId,
      suggestionRef: input.suggestionRef.reference,
    }).slice(0, 32)}`;
    const requested = await this.#reviews.requestReview(
      ReviewRequestV1Schema.parse({
        commandId: reviewRequestId,
        idempotencyKey: reviewRequestId,
        projectId: input.command.projectId,
        actorId: input.command.actorId,
        issuedAt: input.command.issuedAt,
        kind: "request-review",
        authorization: input.verified,
        payload: {
          reviewType: "calibration-suggestion",
          targetRef: input.suggestionRef,
          validationSnapshotRef: {
            kind: "validation-snapshot",
            reference: {
              entityId: `calibration-validation-${input.suggestionRef.reference.entityId.slice(-32)}`,
              versionId: "1",
            },
          },
          evidenceSnapshotRef: {
            kind: "evidence-snapshot",
            reference: {
              entityId: `calibration-evidence-${input.suggestionRef.reference.entityId.slice(-32)}`,
              versionId: "1",
            },
          },
          waitingRunRef: input.parentRunRef,
          reviewPolicyRef: input.command.payload.calibrationValidationPolicyRef,
        },
      }),
    );
    if (requested.kind !== "succeeded") {
      return failCalibration("calibration-review-task-unavailable", input.suggestionRef);
    }
    return requested.result.reviewTaskRef;
  }

  /** pending 公共偏差记录：真实建议标识、真实预测/实际风险变化与精确阈值版本。 */
  #buildPendingDeviationRecord(input: {
    readonly snapshot: { readonly deviationRecordRef: DeviationRecordRefV1 };
    readonly fact: ResponseDeviationFactV1;
    readonly suggestionRef: VersionReference;
    readonly actorId: string;
    readonly recordedAt: string;
  }): DeviationRecord {
    return DeviationRecordSchema.parse({
      deviationRecordId: input.snapshot.deviationRecordRef.reference.entityId,
      responseRecommendationId: input.fact.responseRecommendationRef.reference.entityId,
      predictedRiskChange: input.fact.predictedRiskState,
      actualRiskChange: input.fact.actualRiskState,
      deviationValue: input.fact.deviationValueNumber,
      deviationThresholdVersion: input.fact.deviationPolicyRef,
      evidenceReferences: input.fact.evidenceReferences,
      calibrationRecommendation: input.suggestionRef.entityId,
      reviewStatus: "pending",
      version: {
        reference: {
          entityId: input.snapshot.deviationRecordRef.reference.entityId,
          versionId: "1",
        },
        effectivePeriod: { validFrom: input.recordedAt },
        systemTime: { recordedAt: input.recordedAt },
      },
      audit: {
        actorId: input.actorId,
        action: CALIBRATION_COMMAND_KIND_V1,
        recordedAt: input.recordedAt,
      },
    });
  }

  /** 决定只追加新版本：保留建议、预测/实际风险变化、证据与阈值版本。 */
  #appendDeviationRecordVersion(
    previous: DeviationRecordRow,
    reviewStatus: "approved" | "rejected",
    versionNumber: number,
    recordedAt: string,
  ): DeviationRecord {
    const current = DeviationRecordSchema.parse(previous.record_payload);
    return DeviationRecordSchema.parse({
      ...current,
      reviewStatus,
      version: {
        reference: { entityId: current.deviationRecordId, versionId: String(versionNumber) },
        effectivePeriod: { validFrom: current.version.effectivePeriod.validFrom },
        systemTime: { recordedAt },
      },
      audit: { ...current.audit, recordedAt },
    });
  }

  /** 退回只预留真实后继引用；公开 pending 版本不包含候选占位内容。 */
  #appendPendingDeviationRecordVersion(
    previous: DeviationRecordRow,
    successorSuggestionRef: VersionReference,
    versionNumber: number,
    recordedAt: string,
  ): DeviationRecord {
    const current = DeviationRecordSchema.parse(previous.record_payload);
    return DeviationRecordSchema.parse({
      ...current,
      calibrationRecommendation: successorSuggestionRef.entityId,
      reviewStatus: "pending",
      version: {
        reference: { entityId: current.deviationRecordId, versionId: String(versionNumber) },
        effectivePeriod: { validFrom: current.version.effectivePeriod.validFrom },
        systemTime: { recordedAt },
      },
      audit: { ...current.audit, recordedAt },
    });
  }

  async #insertDeviationRecordVersion(input: {
    readonly transaction: CalibrationTransaction;
    readonly command: {
      readonly commandId: string;
      readonly idempotencyKey: string;
      readonly projectId: string;
      readonly authorization: AuthorizationContextV1;
    };
    readonly record: DeviationRecord;
    readonly deviationFactRef: VersionReference;
    readonly suggestionRef: VersionReference;
    readonly reviewTaskRef: ReviewTaskRefV1;
    readonly versionNumber: number;
    readonly reviewStatus: "pending" | "approved" | "rejected";
    /** 同事务唯一审计条目 id：C03 每个命令只写一条，记录行必须精确引用它。 */
    readonly auditEntryId: string;
    readonly reviewDecisionRef:
      { readonly kind: "review-decision"; readonly reference: VersionReference } | undefined;
  }): Promise<void> {
    await input.transaction
      .insertInto("business.calibration_deviation_records")
      .values({
        deviation_record_id: input.record.version.reference.entityId,
        version_id: input.record.version.reference.versionId,
        schema_version: "1",
        project_id: input.command.projectId,
        version_number: input.versionNumber,
        deviation_fact_id: input.deviationFactRef.entityId,
        deviation_fact_version_id: input.deviationFactRef.versionId,
        suggestion_id: input.suggestionRef.entityId,
        suggestion_version_id: input.suggestionRef.versionId,
        review_status: input.reviewStatus,
        review_task_ref: jsonValue(input.reviewTaskRef),
        review_decision_ref:
          input.reviewDecisionRef === undefined ? null : jsonValue(input.reviewDecisionRef),
        record_payload: jsonValue(input.record),
        content_digest: sha256CanonicalJson(input.record),
        audit_entry_id: input.auditEntryId,
        command_id: input.command.commandId,
        idempotency_key: input.command.idempotencyKey,
        actor_ref: input.command.authorization.actorId,
        authorization_context_ref: jsonValue(input.command.authorization.authorizationContextRef),
        recorded_at: new Date(input.record.version.systemTime.recordedAt),
      } as never)
      .onConflict((conflict) => conflict.doNothing())
      .execute();
    const stored = await input.transaction
      .selectFrom("business.calibration_deviation_records")
      .select(["suggestion_id", "suggestion_version_id", "review_status", "content_digest"])
      .where("project_id", "=", input.command.projectId)
      .where("deviation_record_id", "=", input.record.version.reference.entityId)
      .where("version_id", "=", input.record.version.reference.versionId)
      .executeTakeFirst();
    if (
      stored === undefined ||
      stored.suggestion_id !== input.suggestionRef.entityId ||
      stored.suggestion_version_id !== input.suggestionRef.versionId ||
      stored.review_status !== input.reviewStatus ||
      stored.content_digest !== sha256CanonicalJson(input.record)
    ) {
      failCalibration("calibration-idempotency-conflict", {
        kind: "deviation-record",
        reference: input.record.version.reference,
      });
    }
  }

  async #resolveSuggestionCreation(
    command: CreateCalibrationSuggestionCommandV1,
    derivedSuggestionRef: CalibrationSuggestionRefV1,
    context: {
      readonly deviationFactRef: VersionReference;
      readonly frozenInputRef: VersionReference;
      readonly targetReleaseRef: VersionReference;
      readonly baseArtifactRef: VersionReference;
      readonly baseContentDigest: string;
    },
  ): Promise<{
    readonly suggestionRef: CalibrationSuggestionRefV1;
    readonly reservation?: SuggestionLineageReservationRow;
  }> {
    const replay = await this.#db
      .selectFrom("business.calibration_suggestions")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("command_id", "=", command.commandId)
      .executeTakeFirst();
    if (replay !== undefined) {
      return {
        suggestionRef: {
          kind: "calibration-suggestion",
          reference: { entityId: replay.suggestion_id, versionId: replay.version_id },
        },
      };
    }

    const latest = await this.#loadLatestDeviationRecord(
      command.projectId,
      command.payload.deviationRecordRef.reference.entityId,
    );
    if (latest === undefined) return { suggestionRef: derivedSuggestionRef };
    const reservation = await this.#loadOpenLineageReservation(
      command.projectId,
      command.payload.deviationRecordRef.reference.entityId,
    );
    if (
      reservation === undefined ||
      latest.review_status !== "pending" ||
      latest.suggestion_id !== reservation.successor_suggestion_id ||
      latest.suggestion_version_id !== reservation.successor_suggestion_version_id
    ) {
      failCalibration("calibration-suggestion-not-advanceable", derivedSuggestionRef);
    }
    const predecessor = await this.#db
      .selectFrom("business.calibration_suggestions")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("suggestion_id", "=", reservation.predecessor_suggestion_id)
      .where("version_id", "=", reservation.predecessor_suggestion_version_id)
      .executeTakeFirst();
    if (
      predecessor === undefined ||
      predecessor.deviation_id !== command.payload.deviationRecordRef.reference.entityId ||
      predecessor.deviation_fact_id !== context.deviationFactRef.entityId ||
      predecessor.deviation_fact_version_id !== context.deviationFactRef.versionId ||
      predecessor.validation_policy_entity_id !==
        command.payload.calibrationValidationPolicyRef.entityId ||
      predecessor.validation_policy_version_id !==
        command.payload.calibrationValidationPolicyRef.versionId ||
      predecessor.frozen_input_artifact_id !== context.frozenInputRef.entityId ||
      predecessor.frozen_input_artifact_version_id !== context.frozenInputRef.versionId ||
      predecessor.target_release_entity_id !== context.targetReleaseRef.entityId ||
      predecessor.target_release_version_id !== context.targetReleaseRef.versionId ||
      predecessor.base_artifact_id !== context.baseArtifactRef.entityId ||
      predecessor.base_artifact_version_id !== context.baseArtifactRef.versionId ||
      predecessor.base_content_digest !== context.baseContentDigest
    ) {
      failCalibration("calibration-agent-result-mismatch", derivedSuggestionRef);
    }
    return {
      suggestionRef: {
        kind: "calibration-suggestion",
        reference: {
          entityId: reservation.successor_suggestion_id,
          versionId: reservation.successor_suggestion_version_id,
        },
      },
      reservation,
    };
  }

  async #loadOpenLineageReservation(
    projectId: string,
    deviationId: string,
  ): Promise<SuggestionLineageReservationRow | undefined> {
    const row = await this.#db
      .selectFrom("business.calibration_suggestion_lineage_reservations as reservation")
      .leftJoin(
        "business.calibration_suggestion_lineage_consumptions as consumption",
        "consumption.reservation_id",
        "reservation.reservation_id",
      )
      .selectAll("reservation")
      .where("reservation.project_id", "=", projectId)
      .where("reservation.deviation_id", "=", deviationId)
      .where("consumption.reservation_id", "is", null)
      .executeTakeFirst();
    return row as SuggestionLineageReservationRow | undefined;
  }

  async #loadLineageReservationByDecision(
    database: Kysely<CalibrationDatabase> | CalibrationTransaction,
    projectId: string,
    decisionRef: VersionReference,
  ): Promise<SuggestionLineageReservationRow | undefined> {
    const row = await (database as Kysely<CalibrationDatabase>)
      .selectFrom("business.calibration_suggestion_lineage_reservations")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("review_decision_id", "=", decisionRef.entityId)
      .where("review_decision_version_id", "=", decisionRef.versionId)
      .executeTakeFirst();
    return row as SuggestionLineageReservationRow | undefined;
  }

  async #loadLineageConsumption(
    database: Kysely<CalibrationDatabase> | CalibrationTransaction,
    reservationId: string,
  ): Promise<SuggestionLineageConsumptionRow | undefined> {
    const row = await (database as Kysely<CalibrationDatabase>)
      .selectFrom("business.calibration_suggestion_lineage_consumptions")
      .selectAll()
      .where("reservation_id", "=", reservationId)
      .executeTakeFirst();
    return row as SuggestionLineageConsumptionRow | undefined;
  }

  async #loadDeviationRecordBySuggestion(
    projectId: string,
    deviationId: string,
    suggestionRef: VersionReference,
  ): Promise<DeviationRecordRow | undefined> {
    const row = await this.#db
      .selectFrom("business.calibration_deviation_records")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("deviation_record_id", "=", deviationId)
      .where("suggestion_id", "=", suggestionRef.entityId)
      .where("suggestion_version_id", "=", suggestionRef.versionId)
      .executeTakeFirst();
    return row as DeviationRecordRow | undefined;
  }

  #assertCurrentSuggestion(
    latest: DeviationRecordRow,
    suggestion: SuggestionRow,
    targetRef: CalibrationSuggestionRefV1,
  ): void {
    if (
      latest.review_status !== "pending" ||
      latest.suggestion_id !== suggestion.suggestion_id ||
      latest.suggestion_version_id !== suggestion.version_id
    ) {
      failCalibration("calibration-suggestion-not-advanceable", targetRef, "BUSINESS_BLOCKED");
    }
  }

  async #loadSuggestion(command: CalibrationReviewOutcomeCommandV1): Promise<SuggestionRow> {
    const row = await this.#db
      .selectFrom("business.calibration_suggestions")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("suggestion_id", "=", command.payload.calibrationSuggestionRef.reference.entityId)
      .where("version_id", "=", command.payload.calibrationSuggestionRef.reference.versionId)
      .executeTakeFirst();
    if (row === undefined) {
      failCalibration(
        "calibration-suggestion-not-advanceable",
        command.payload.calibrationSuggestionRef,
        "ENTITY_NOT_FOUND",
      );
    }
    return row as SuggestionRow;
  }

  async #loadSuggestionRow(
    transaction: CalibrationTransaction,
    projectId: string,
    reference: VersionReference,
  ): Promise<SuggestionRow | undefined> {
    const row = await transaction
      .selectFrom("business.calibration_suggestions")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("suggestion_id", "=", reference.entityId)
      .where("version_id", "=", reference.versionId)
      .executeTakeFirst();
    return row as SuggestionRow | undefined;
  }

  async #loadLatestDeviationRecord(
    projectId: string,
    deviationRecordId: string,
  ): Promise<DeviationRecordRow | undefined> {
    const row = await this.#db
      .selectFrom("business.calibration_deviation_records")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("deviation_record_id", "=", deviationRecordId)
      .orderBy("version_number", "desc")
      .executeTakeFirst();
    return row as DeviationRecordRow | undefined;
  }

  async #loadDraftRow(
    transaction: CalibrationTransaction,
    projectId: string,
    reference: VersionReference,
  ): Promise<GovernanceDraftRow | undefined> {
    const row = await transaction
      .selectFrom("business.calibration_governance_drafts")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("draft_id", "=", reference.entityId)
      .where("version_id", "=", reference.versionId)
      .executeTakeFirst();
    return row as GovernanceDraftRow | undefined;
  }

  /** 证明是唯一批准依据：非批准必须落在调用方声明的非批准决定上。 */
  #assertProofOutcome(proof: CalibrationProofV1, command: CalibrationReviewOutcomeCommandV1): void {
    if (proof.kind === "not-approved") {
      if (proof.reason === "decision-not-found") {
        failCalibration("calibration-review-decision-not-found", command.payload.reviewDecisionRef);
      }
      failCalibration(
        "calibration-review-target-mismatch",
        command.payload.calibrationSuggestionRef,
      );
    }
    const expected =
      command.payload.outcome === "approve-draft-creation"
        ? "approved-for-draft"
        : command.payload.outcome === "reject"
          ? "rejected"
          : "returned-for-revision";
    if (
      proof.kind !== expected ||
      !refEquals(
        proof.calibrationSuggestionRef.reference,
        command.payload.calibrationSuggestionRef.reference,
      ) ||
      !refEquals(proof.reviewDecisionRef.reference, command.payload.reviewDecisionRef.reference)
    ) {
      failCalibration(
        "calibration-review-decision-not-approval",
        command.payload.calibrationSuggestionRef,
      );
    }
  }

  async #readArtifact(
    requestId: string,
    authorization: AuthorizationContextV1,
    artifactRef: ArtifactRefV1,
    purposeCode: string,
  ): Promise<unknown> {
    // C04 把每次授权读取记为一条原子访问命令：同一请求内按用途区分读取身份，
    // 使重试可安全重放、不同工件角色互不覆盖回执与审计条目。
    const readId = `${requestId}:${purposeCode}`;
    const handle = await this.#artifactStore.open(
      ArtifactReadRequestV1Schema.parse({
        schemaVersion: "1",
        requestId: readId,
        idempotencyKey: readId,
        artifactRef,
        projectId: authorization.projectId,
        actorId: authorization.actorId,
        requestedAt: authorization.decidedAt,
        purposeCode,
        requiredCapability: "knowledge-modeling.read",
        authorization,
      }),
    );
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    for await (const chunk of handle.content) {
      byteLength += chunk.byteLength;
      if (byteLength > MAX_ARTIFACT_BYTES_V1) {
        failCalibration("calibration-agent-result-mismatch", artifactRef);
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
      failCalibration("calibration-agent-result-mismatch", artifactRef);
    }
  }

  async #putArtifact(input: {
    readonly commandId: string;
    readonly issuedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly artifactId: string;
    readonly purposeCode: string;
    readonly mediaType: string;
    readonly value: unknown;
  }): Promise<ContentArtifactRefV1> {
    const payload = new TextEncoder().encode(JSON.stringify(input.value, null, 2));
    const result = await this.#artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        // C03 回执的 command_id 全局唯一：工件写入必须拥有独立身份，不能复用命令 id。
        schemaVersion: "1",
        commandId: `${input.commandId}:artifact-put:${input.purposeCode}`,
        idempotencyKey: `${input.commandId}:artifact-put:${input.purposeCode}`,
        projectId: input.authorization.projectId,
        actorId: input.authorization.actorId,
        issuedAt: input.issuedAt,
        authorization: input.authorization,
        requiredCapability: "knowledge-modeling.govern",
        artifactId: input.artifactId,
        artifactKind: "content",
        purposeCode: input.purposeCode,
        mediaType: input.mediaType,
        parentArtifactRefs: [],
        evidenceReferences: [],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      }),
      (async function* () {
        yield payload;
      })(),
    );
    return ContentArtifactRefV1Schema.parse(result.artifactRef);
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
        if (
          attempt < MAX_SERIALIZATION_ATTEMPTS_V1 &&
          mapPostgresError(error, "warning-response.calibration.transaction").retryable
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * 按用例实际需要的用途逐个签发下游授权：工程、主体与空间都来自调用方已复验的授权上下文。
   * C06 每次只授予单一能力，禁止把命令授权透传给能力不同的接缝，也不申请用不到的用途。
   */
  async #purposeContexts<K extends CalibrationPurposeV1>(
    input: {
      readonly invocationId: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly requestedAt: string;
      readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
    },
    purposes: readonly K[],
  ): Promise<Record<K, AuthorizationContextV1>> {
    const entries = await Promise.all(
      purposes.map(
        async (purpose) =>
          [
            purpose,
            await this.#authorizeFor({
              ...input,
              branch: CALIBRATION_PURPOSE_BRANCHES_V1[purpose],
            }),
          ] as const,
      ),
    );
    return Object.fromEntries(entries) as Record<K, AuthorizationContextV1>;
  }

  #nowIso(): string {
    return this.#now().toISOString();
  }

  #unsupportedContract(causalRunId: string): ModuleErrorV1 {
    return toCalibrationModuleError(
      {
        code: "UNSUPPORTED_CONTRACT",
        reasonCode: "calibration-contract-drift",
        targetRef: {
          kind: "calibration-suggestion",
          reference: { entityId: causalRunId, versionId: "1" },
        },
      },
      causalRunId,
      MODULE_BRANCH_CAPABILITY_V1[CALIBRATION_BRANCH_V1],
    );
  }

  #toModuleError(error: unknown, causalRunId: string): ModuleErrorV1 {
    const failure = calibrationFailureFrom(error);
    if (failure !== undefined) {
      return toCalibrationModuleError(
        failure,
        causalRunId,
        MODULE_BRANCH_CAPABILITY_V1[CALIBRATION_BRANCH_V1],
      );
    }
    if (error instanceof AccessServiceError) {
      return toCalibrationModuleError(
        {
          code: "AUTHORIZATION_DENIED",
          reasonCode: "calibration-authorization-required",
          targetRef: {
            kind: "authorization-context",
            reference: { entityId: "warning-response.calibration.unauthorized", versionId: "1" },
          },
        },
        causalRunId,
        MODULE_BRANCH_CAPABILITY_V1[CALIBRATION_BRANCH_V1],
      );
    }
    const mapped = mapPostgresError(error, "warning-response.calibration.adapter");
    return toCalibrationModuleError(
      {
        code:
          mapped.code === "IDEMPOTENCY_CONFLICT"
            ? "IDEMPOTENCY_CONFLICT"
            : mapped.retryable
              ? "TRANSIENT_FAILURE"
              : "TERMINAL_FAILURE",
        reasonCode:
          mapped.code === "IDEMPOTENCY_CONFLICT"
            ? "calibration-idempotency-conflict"
            : "calibration-contract-drift",
        targetRef: {
          kind: "calibration-suggestion",
          reference: { entityId: causalRunId, versionId: "1" },
        },
      },
      causalRunId,
      MODULE_BRANCH_CAPABILITY_V1[CALIBRATION_BRANCH_V1],
    );
  }
}

type FailureV1 = { readonly kind: "failed"; readonly error: ModuleErrorV1 };

type CalibrationProofV1 =
  | {
      readonly kind: "approved-for-draft" | "rejected" | "returned-for-revision";
      readonly calibrationSuggestionRef: { readonly reference: VersionReference };
      readonly reviewTaskRef: ReviewTaskRefV1;
      readonly reviewDecisionRef: { readonly reference: VersionReference };
      readonly decidedAt: string;
    }
  | {
      readonly kind: "not-approved";
      readonly reason: "decision-not-found" | "target-mismatch";
    };

const isCalibrationTargetDefinitionType = (
  value: string,
): value is CalibrationTargetDefinitionTypeV1 =>
  (CALIBRATION_TARGET_TYPES_V1 as readonly string[]).includes(value);

const CALIBRATION_TARGET_TYPES_V1 = [
  "weight-set",
  "risk-matrix",
  "risk-acceptance-threshold",
  "monitoring-warning-threshold",
  "deviation-policy",
  "structured-scoring-rule",
] as const;

export const createPostgresCalibrationAdapter = (
  options: PostgresCalibrationAdapterOptionsV1,
): PostgresCalibrationAdapter => new PostgresCalibrationAdapter(options);
