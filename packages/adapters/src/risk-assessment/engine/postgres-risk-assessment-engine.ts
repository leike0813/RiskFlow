import type { ColumnType, Kysely, Transaction } from "kysely";

import {
  canonicalJson,
  sha256CanonicalJson,
  type AtomicCommandV1,
  type AtomicCommitV1,
  type TransactionContextV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import { ACCESS_POLICY_REF_V1, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import {
  ArtifactPutCommandV1Schema,
  type ArtifactReadHandleV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
  ASSESSMENT_CONFIGURATION_MEDIA_TYPE_V1,
  ASSESSMENT_CONFIGURATION_MAX_ARTIFACT_BYTES_V1,
  AssessmentConfigurationDocumentV1Schema,
  assessmentConfigurationDocumentDigest,
  type AssessmentConfigurationDocumentV1,
} from "@riskflow/core/assessment-config";
import type { ApplicabilityMetadataSnapshotV1 } from "@riskflow/core/engineering-data/context-source";
import type {
  AssessmentConfigurationV1,
  AssessmentDownstreamAuthorizationRequestV1,
  AssessmentDownstreamAuthorizerV1,
  AssessmentEngineContextV1,
  AssessmentMonitoringInputV1,
  AssessmentMonitoringReaderV1,
  AssessmentPreparationContextReaderV1,
  AssessmentRuntimePolicySetProviderV1,
  RiskInputFactsReaderV1,
} from "@riskflow/core/risk-assessment/engine";
import {
  RISK_ASSESSMENT_DECISION_ARTIFACT_PURPOSE_CODE_V1,
  RISK_ASSESSMENT_DECISION_MEDIA_TYPE_V1,
  RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1,
  RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1,
  AssessmentRuntimePolicySetV1Schema,
  RiskInputFactsV1Schema,
  evaluateDeterministicAssessment,
  readApplicableRuleSetDocument,
  readStructuredScoringRuleDocument,
  riskAssessmentFailureFrom,
  toModuleError,
  type AssessmentRuntimePolicySetV1,
  type DeterministicAssessmentV1,
  type RiskInputFactsV1,
} from "@riskflow/core/risk-assessment/engine";
import {
  AssessmentBasisReleaseSetReadResultV1Schema,
  assertScoringRuleMembersMatchApplicableRuleSet,
  type ApplicableRuleSetDocumentV1,
  type AssessmentBasisConfigurationMemberV1,
  type AssessmentBasisReleaseSetMemberV1,
  type AssessmentBasisReleaseSetReaderV1,
  type StructuredScoringRuleDocumentV1,
} from "@riskflow/core/scoring-rules";
import {
  AssessmentInputSnapshotV1Schema,
  AssessmentPreparationSnapshotV1Schema,
} from "@riskflow/contracts/workflows";
import type {
  AssessmentInputSnapshotV1,
  AssessmentPreparationSnapshotV1,
} from "@riskflow/contracts/workflows";
import {
  AssessmentEvaluationCommandV1Schema,
  AssessmentEvaluationResultV1Schema,
  AssessmentPreparationCommandV1Schema,
  AssessmentPreparationResultV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  type AssessmentEvaluationCommandV1,
  type AssessmentEvaluationResultV1,
  type AssessmentPreparationCommandV1,
  type AssessmentPreparationResultV1,
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type ContractReferenceV1,
  type ModuleBranchV1,
  type ModuleCapabilityV1,
  type ModuleErrorV1,
  type RiskAssessmentPortV1,
} from "@riskflow/contracts/ports";
import type { VersionReference } from "@riskflow/contracts/common";
import { DomainEventV1Schema, type DomainEventV1 } from "@riskflow/contracts/events";

import { getPostgresTransaction } from "../../postgres/transaction-unit.js";
import { mapPostgresError } from "../../postgres/pool.js";
import type { PostgresDatabase } from "../../postgres/types.js";

type JsonColumn = ColumnType<unknown, unknown, unknown>;
type TimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;

interface AssessmentInputSnapshotRow {
  input_snapshot_id: string;
  version_id: string;
  schema_version: string;
  project_id: string;
  command_id: string;
  idempotency_key: string;
  payload_hash: string;
  preparation_snapshot_ref: JsonColumn;
  preparation_snapshot_id: string;
  preparation_snapshot_version_id: string;
  basis_release_set_ref: JsonColumn;
  basis_release_set_id: string;
  basis_release_set_version_id: string;
  previous_assessment_record_ref: JsonColumn | null;
  entry_kind: string;
  effective_at: TimestampColumn | null;
  reference_digest: string;
  snapshot_payload: JsonColumn;
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface IndicatorActualValueSetRow {
  value_set_id: string;
  version_id: string;
  schema_version: string;
  project_id: string;
  input_snapshot_id: string;
  input_snapshot_version_id: string;
  input_snapshot_ref: JsonColumn;
  content_digest: string;
  evidence_digest: string;
  value_set_payload: JsonColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface AssessmentDecisionArtifactRow {
  decision_id: string;
  version_id: string;
  schema_version: string;
  project_id: string;
  input_snapshot_id: string;
  input_snapshot_version_id: string;
  input_snapshot_ref: JsonColumn;
  value_set_id: string;
  value_set_version_id: string;
  value_set_ref: JsonColumn;
  content_artifact_ref: JsonColumn;
  content_artifact_id: string;
  content_artifact_version_id: string;
  content_digest: string;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface RiskAssessmentRecordRow {
  record_id: string;
  version_id: string;
  schema_version: string;
  project_id: string;
  command_id: string;
  idempotency_key: string;
  risk_input_kind: string;
  risk_record_id: string | null;
  external_risk_event_id: string | null;
  input_snapshot_id: string;
  input_snapshot_version_id: string;
  input_snapshot_ref: JsonColumn;
  value_set_id: string;
  value_set_version_id: string;
  decision_id: string;
  decision_version_id: string;
  record_payload: JsonColumn;
  likelihood_score_canonical: string;
  consequence_score_canonical: string;
  risk_level_id: string;
  configuration_digest: string;
  content_digest: string;
  identity_digest: string;
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface RiskAssessmentDatabase extends PostgresDatabase {
  "business.assessment_input_snapshots": AssessmentInputSnapshotRow;
  "business.indicator_actual_value_sets": IndicatorActualValueSetRow;
  "business.assessment_decision_artifacts": AssessmentDecisionArtifactRow;
  "business.risk_assessment_records": RiskAssessmentRecordRow;
}

const asRiskAssessmentTransaction = (
  context: TransactionContextV1,
): Transaction<RiskAssessmentDatabase> =>
  getPostgresTransaction(context) as unknown as Transaction<RiskAssessmentDatabase>;

const jsonValue = (value: unknown): unknown => JSON.stringify(value) as unknown;

async function* one(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

const refKey = (value: { readonly kind: string; readonly reference: VersionReference }): string =>
  `${value.kind}\u0000${value.reference.entityId}\u0000${value.reference.versionId}`;

const versionKey = (value: VersionReference): string => `${value.entityId}\u0000${value.versionId}`;

const withoutClock = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => key !== "createdAt" && key !== "createdBy" && key !== "auditTrailRef",
    ),
  );

const moduleError = (
  code: ModuleErrorV1["code"],
  causalRunId: string,
  extras: Partial<Record<string, unknown>> = {},
  requiredCapability: ModuleCapabilityV1 = "risk-assessment.read",
): ModuleErrorV1 => {
  const common = {
    stageCode: "risk-assessment.engine",
    occurredAt: new Date().toISOString(),
    causalRunId,
  };
  if (code === "AUTHORIZATION_DENIED") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code,
      category: "authorization",
      retryable: false,
      requiredCapability,
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
      ...extras,
    });
  }
  if (code === "UNSUPPORTED_CONTRACT") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code,
      category: "technical",
      retryable: false,
      schemaVersion: RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1,
      ...extras,
    });
  }
  if (code === "BUSINESS_BLOCKED") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code,
      category: "business-blocked",
      retryable: false,
      blockerKind: "risk-assessment",
      blockerRef: { kind: "project-revision", reference: { entityId: "unknown", versionId: "1" } },
      ...extras,
    });
  }
  if (code === "STALE_VERSION") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code,
      category: "concurrency",
      retryable: false,
      targetRef: { kind: "project-revision", reference: { entityId: "unknown", versionId: "1" } },
      ...extras,
    });
  }
  if (code === "IDEMPOTENCY_CONFLICT") {
    return ModuleErrorV1Schema.parse({
      ...common,
      code,
      category: "idempotency",
      retryable: false,
      idempotencyKey: "unknown",
      priorCommandId: "unknown",
      ...extras,
    });
  }
  return ModuleErrorV1Schema.parse({
    ...common,
    code: "TERMINAL_FAILURE",
    category: "technical",
    retryable: false,
    diagnosticRef: {
      kind: "diagnostic-artifact",
      reference: { entityId: "risk-assessment-failure", versionId: "1" },
    },
    ...extras,
  });
};

const failureToModuleError = (error: unknown, causalRunId: string): ModuleErrorV1 => {
  const failure = riskAssessmentFailureFrom(error);
  if (failure !== undefined) return toModuleError(failure, causalRunId);
  // 已类型化的模块错误（授权/陈旧/业务阻断）原样保留，不被折叠成终止失败。
  const typed = ModuleErrorV1Schema.safeParse(
    typeof error === "object" && error !== null && "code" in error && "category" in error
      ? error
      : undefined,
  );
  if (typed.success) return typed.data;
  // C03 回执冲突与数据库故障：幂等冲突保持不可重试，其余按可重试性分流。
  const mapped = mapPostgresError(error, "risk-assessment.engine");
  if (mapped.code === "IDEMPOTENCY_CONFLICT") {
    return moduleError("IDEMPOTENCY_CONFLICT", causalRunId);
  }
  return moduleError(mapped.retryable ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE", causalRunId);
};

const readBounded = async (
  handle: ArtifactReadHandleV1,
  targetRef: ContractReferenceV1,
  causalRunId: string,
): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for await (const chunk of handle.content) {
    byteLength += chunk.byteLength;
    if (byteLength > ASSESSMENT_CONFIGURATION_MAX_ARTIFACT_BYTES_V1) {
      throw moduleError("STALE_VERSION", causalRunId, { targetRef });
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const INPUT_SNAPSHOT_REFERENCE_FIELDS_V1 = [
  "indicatorSystemRef",
  "indicatorFieldMappingRef",
  "applicableRuleSetRef",
  "weightSetRef",
  "scoringStrategyRef",
  "riskMatrixRef",
  "riskAcceptanceThresholdRef",
  "monitoringWarningThresholdRef",
  "jointTriggerPolicyRef",
  "measureLibraryReleaseRef",
  "warningAggregationPolicyRef",
  "notificationPolicyRef",
  "responseGenerationPolicyRef",
  "responseValidationPolicyRef",
  "responseAgentPolicyRef",
  "effectForecastPolicyRef",
  "deviationPolicyRef",
  "calibrationAgentPolicyRef",
  "retryPolicyRef",
  "reviewPolicyRef",
  "modelDeploymentRef",
  "promptTemplateRef",
] as const satisfies readonly (keyof AssessmentInputSnapshotV1)[];

/** 经 basis 接缝签发的上下文只带 `knowledge-modeling.read`；C04 读取必须与之一致。 */
const BASIS_READ_CAPABILITY: ModuleCapabilityV1 =
  MODULE_BRANCH_CAPABILITY_V1[RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.basisMembers];

const branchForCommandKind = (kind: AssessmentPreparationCommandV1["kind"]): ModuleBranchV1 =>
  kind === "initial"
    ? "risk-assessment.initial"
    : kind === "reassessment"
      ? "risk-assessment.reassessment"
      : "risk-assessment.historical-backfill";

type PreparationReadV1 = Awaited<
  ReturnType<AssessmentPreparationContextReaderV1["readAssessmentPreparationContext"]>
>;
type PreparationContextV1 = Extract<PreparationReadV1, { kind: "succeeded" }>;
type InputSnapshotRefV1 = Extract<ContractReferenceV1, { kind: "assessment-input-snapshot" }>;
type BasisRefV1 = Extract<ContractReferenceV1, { kind: "assessment-basis-release-set" }>;

interface EvaluationResultRefsV1 {
  readonly indicatorActualValueSetRef: Extract<
    ContractReferenceV1,
    { kind: "indicator-actual-value-set" }
  >;
  readonly assessmentDecisionArtifactRef: Extract<
    ContractReferenceV1,
    { kind: "assessment-decision-artifact" }
  >;
  readonly assessmentRecordRef: Extract<ContractReferenceV1, { kind: "risk-assessment-record" }>;
}

interface LoadedBasisV1 {
  readonly applicableRuleSetMember: AssessmentBasisReleaseSetMemberV1;
  readonly scoringRuleMembers: readonly AssessmentBasisReleaseSetMemberV1[];
  readonly configurationMembers: readonly AssessmentBasisConfigurationMemberV1[];
  readonly applicableRuleSet: ApplicableRuleSetDocumentV1;
  readonly rules: readonly {
    readonly member: AssessmentBasisReleaseSetMemberV1;
    readonly document: StructuredScoringRuleDocumentV1;
  }[];
  readonly configuration: AssessmentConfigurationV1;
}

export interface PostgresRiskAssessmentEngineOptionsV1 {
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: TransactionUnitV1;
  readonly access: LocalIdentityAccessV1;
  readonly artifactStore: ArtifactStoreV1;
  /** C11 实现的评估准备上下文窄读。 */
  readonly preparationContext: AssessmentPreparationContextReaderV1;
  /** C24/C11 实现的风险输入事实窄读。 */
  readonly riskInputFacts: RiskInputFactsReaderV1;
  /** C19 实现的评估依据成员窄读。 */
  readonly basisReader: AssessmentBasisReleaseSetReaderV1;
  /** 部署组合根注入的 10 项运行时策略提供者。 */
  readonly runtimePolicies: AssessmentRuntimePolicySetProviderV1;
  /** C14 快照查询与序列修订读取。 */
  readonly monitoring: AssessmentMonitoringReaderV1;
  /** 下游读取授权签发接缝：组合根按精确 branch 签发，绑定不符时关闭失败。 */
  readonly authorizeDownstream: AssessmentDownstreamAuthorizerV1;
  readonly now?: () => Date;
}

/**
 * C25 正式用例 adapter：`prepare` 全量物化 22 引用输入快照，`evaluate` 只消费冻结输入，
 * 并在单事务内保存取值集、决策链接、正式记录、审计、回执与 `assessment.recorded.v1`。
 */
export class PostgresRiskAssessmentEngine implements RiskAssessmentPortV1 {
  readonly #db: Kysely<RiskAssessmentDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #access: LocalIdentityAccessV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #preparationContext: AssessmentPreparationContextReaderV1;
  readonly #riskInputFacts: RiskInputFactsReaderV1;
  readonly #basisReader: AssessmentBasisReleaseSetReaderV1;
  readonly #runtimePolicies: AssessmentRuntimePolicySetProviderV1;
  readonly #monitoring: AssessmentMonitoringReaderV1;
  readonly #authorizeDownstream: AssessmentDownstreamAuthorizerV1;
  readonly #now: () => Date;

  constructor(options: PostgresRiskAssessmentEngineOptionsV1) {
    this.#db = options.db as unknown as Kysely<RiskAssessmentDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#access = options.access;
    this.#artifactStore = options.artifactStore;
    this.#preparationContext = options.preparationContext;
    this.#riskInputFacts = options.riskInputFacts;
    this.#basisReader = options.basisReader;
    this.#runtimePolicies = options.runtimePolicies;
    this.#monitoring = options.monitoring;
    this.#authorizeDownstream = options.authorizeDownstream;
    this.#now = options.now ?? (() => new Date());
  }

  // ------------------------------------------------------------- authorization

  async #verifyCommand(
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
      throw moduleError("AUTHORIZATION_DENIED", command.commandId, {}, capability);
    }
    const decision = await this.#access.verify({
      authorizationContextRef: command.authorization.authorizationContextRef,
      invocationId: command.commandId,
      projectId: command.projectId,
      branch,
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      requestedAt: command.authorization.decidedAt,
    });
    if (decision.context.actorId !== command.actorId) {
      throw moduleError("AUTHORIZATION_DENIED", command.commandId, {}, capability);
    }
    return decision.context;
  }

  async #authorizeFor(
    input: AssessmentDownstreamAuthorizationRequestV1,
    requiredCapability: ModuleCapabilityV1,
  ): Promise<AuthorizationContextV1> {
    const context = await this.#authorizeDownstream(input);
    const capability = MODULE_BRANCH_CAPABILITY_V1[input.branch];
    if (
      context.projectId !== input.projectId ||
      context.actorId !== input.actorId ||
      context.grantedCapabilities.length !== 1 ||
      !context.grantedCapabilities.includes(capability)
    ) {
      throw moduleError("AUTHORIZATION_DENIED", input.invocationId, {}, requiredCapability);
    }
    return context;
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
    runRef?: { readonly reference: VersionReference },
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
      ...(runRef === undefined ? {} : { runId: runRef.reference.entityId }),
    };
  }

  // ------------------------------------------------------------------ loaders

  async #loadPreparationContext(
    input: {
      readonly commandId: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly issuedAt: string;
    },
    preparationSnapshotRef: AssessmentInputSnapshotV1["preparationSnapshotRef"],
  ): Promise<PreparationContextV1> {
    const authorization = await this.#authorizeFor(
      {
        branch: RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.preparationContext,
        invocationId: `${input.commandId}:preparation`,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.issuedAt,
      },
      "risk-assessment.read",
    );
    const read = await this.#preparationContext.readAssessmentPreparationContext({
      requestId: `${input.commandId}:preparation`,
      idempotencyKey: `${input.commandId}:preparation`,
      requestedAt: input.issuedAt,
      authorization,
      preparationSnapshotRef,
    });
    if (read.kind === "failed") throw read.error;
    if (read.kind !== "succeeded") {
      throw moduleError("BUSINESS_BLOCKED", input.commandId, {
        blockerKind: "assessment-preparation-unavailable",
        blockerRef: preparationSnapshotRef,
      });
    }
    return {
      kind: "succeeded",
      preparation: AssessmentPreparationSnapshotV1Schema.parse(read.preparation),
      applicability: read.applicability,
    };
  }

  async #loadRiskFacts(input: {
    readonly commandId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly riskInput: AssessmentPreparationSnapshotV1["riskInput"];
  }): Promise<RiskInputFactsV1> {
    const authorization = await this.#authorizeFor(
      {
        branch: RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.riskInputFacts,
        invocationId: `${input.commandId}:risk-input-facts`,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.issuedAt,
      },
      "risk-assessment.read",
    );
    const read = await this.#riskInputFacts.readRiskInputFacts({
      requestId: `${input.commandId}:risk-input-facts`,
      idempotencyKey: `${input.commandId}:risk-input-facts`,
      requestedAt: input.issuedAt,
      authorization,
      riskInput: input.riskInput,
    });
    if (read.kind === "failed") throw read.error;
    if (read.kind !== "succeeded") {
      throw moduleError("BUSINESS_BLOCKED", input.commandId, {
        blockerKind: "risk-input-facts-unavailable",
        blockerRef: input.riskInput,
      });
    }
    const facts = RiskInputFactsV1Schema.parse(read.facts);
    if (
      facts.projectId !== input.projectId ||
      refKey(facts.riskInput) !== refKey(input.riskInput)
    ) {
      throw moduleError("AUTHORIZATION_DENIED", input.commandId);
    }
    return facts;
  }

  async #loadBasis(input: {
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly requiredCapability: ModuleCapabilityV1;
    readonly basisRef: BasisRefV1;
  }): Promise<LoadedBasisV1> {
    const authorization = await this.#authorizeFor(
      {
        branch: RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.basisMembers,
        invocationId: `${input.commandId}:basis`,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.issuedAt,
      },
      input.requiredCapability,
    );
    const read = AssessmentBasisReleaseSetReadResultV1Schema.parse(
      await this.#basisReader.readAssessmentBasisReleaseSet({
        requestId: `${input.commandId}:basis`,
        idempotencyKey: `${input.idempotencyKey}:basis`,
        requestedAt: input.issuedAt,
        authorization,
        assessmentBasisReleaseSetRef: input.basisRef,
      }),
    );
    if (read.kind === "unavailable") {
      throw moduleError("BUSINESS_BLOCKED", input.commandId, {
        blockerKind: "risk-assessment-basis-unavailable",
        blockerRef: input.basisRef,
      });
    }
    if (read.kind === "failed") {
      throw moduleError(
        read.error.code === "TRANSIENT_FAILURE" ? "TRANSIENT_FAILURE" : "TERMINAL_FAILURE",
        input.commandId,
      );
    }
    const applicableRuleSet = await this.#readApplicableRuleSet(
      {
        commandId: input.commandId,
        projectId: input.projectId,
        actorId: input.actorId,
        issuedAt: input.issuedAt,
        authorization,
      },
      read.applicableRuleSetMember,
    );
    assertScoringRuleMembersMatchApplicableRuleSet({
      document: applicableRuleSet,
      scoringRuleMembers: read.scoringRuleMembers,
    });

    const rules: {
      member: AssessmentBasisReleaseSetMemberV1;
      document: StructuredScoringRuleDocumentV1;
    }[] = [];
    for (const member of read.scoringRuleMembers) {
      const document = await readStructuredScoringRuleDocument({
        artifactStore: this.#artifactStore,
        artifactRef: member.artifactRef,
        projectId: input.projectId,
        actorId: input.actorId,
        requestId: `${input.commandId}:rule:${member.releaseRef.reference.entityId}`,
        idempotencyKey: `${input.commandId}:rule:${member.releaseRef.reference.entityId}`,
        requestedAt: input.issuedAt,
        requiredCapability: BASIS_READ_CAPABILITY,
        authorization,
      });
      if (
        document.contentDigest !== member.contentDigest ||
        versionKey(document.value.configurationSetRef) !==
          versionKey(applicableRuleSet.configurationSetRef) ||
        versionKey(document.value.compatibilityRef) !==
          versionKey(applicableRuleSet.compatibilityRef)
      ) {
        throw moduleError("STALE_VERSION", input.commandId, { targetRef: member.releaseRef });
      }
      rules.push({ member, document: document.value });
    }

    const documents = new Map<string, AssessmentConfigurationDocumentV1>();
    for (const member of read.configurationMembers) {
      documents.set(
        member.definitionType,
        await this.#readConfigurationDocument(input, authorization, member, applicableRuleSet),
      );
    }
    const content = <T extends string>(definitionType: T): unknown => {
      const document = documents.get(definitionType);
      if (document === undefined || document.definitionType !== definitionType) {
        throw moduleError("BUSINESS_BLOCKED", input.commandId, {
          blockerKind: "risk-assessment-configuration-incomplete",
          blockerRef: input.basisRef,
        });
      }
      return document.content;
    };
    const configuration: AssessmentConfigurationV1 = {
      indicatorSystem: content("indicator-system") as never,
      fieldMapping: content("indicator-field-mapping") as never,
      weightSet: content("weight-set") as never,
      scoringStrategy: content("scoring-strategy") as never,
      riskMatrix: content("risk-matrix") as never,
      riskAcceptanceThreshold: content("risk-acceptance-threshold") as never,
      monitoringWarningThreshold: content("monitoring-warning-threshold") as never,
      jointTriggerPolicy: content("joint-trigger-policy") as never,
    };

    return {
      applicableRuleSetMember: read.applicableRuleSetMember,
      scoringRuleMembers: read.scoringRuleMembers,
      configurationMembers: read.configurationMembers,
      applicableRuleSet,
      rules,
      configuration,
    };
  }

  async #readConfigurationDocument(
    input: {
      readonly commandId: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly issuedAt: string;
    },
    authorization: AuthorizationContextV1,
    member: AssessmentBasisConfigurationMemberV1,
    applicableRuleSet: ApplicableRuleSetDocumentV1,
  ): Promise<AssessmentConfigurationDocumentV1> {
    const requestId = `${input.commandId}:configuration:${member.definitionType}`;
    const handle = await this.#artifactStore
      .open({
        schemaVersion: RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1,
        requestId,
        idempotencyKey: requestId,
        artifactRef: member.artifactRef,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.issuedAt,
        purposeCode: ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
        requiredCapability: BASIS_READ_CAPABILITY,
        authorization,
      })
      .catch((): never => {
        throw moduleError("STALE_VERSION", input.commandId, { targetRef: member.releaseRef });
      });
    const bytes = await readBounded(handle, member.releaseRef, input.commandId);
    const receipt = await handle.verified;
    if (
      receipt.content.hash.value !== handle.manifest.content.hash.value ||
      handle.manifest.mediaType !== ASSESSMENT_CONFIGURATION_MEDIA_TYPE_V1
    ) {
      throw moduleError("STALE_VERSION", input.commandId, { targetRef: member.releaseRef });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw moduleError("STALE_VERSION", input.commandId, { targetRef: member.releaseRef });
    }
    const parsed = AssessmentConfigurationDocumentV1Schema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.definitionType !== member.definitionType ||
      assessmentConfigurationDocumentDigest(parsed.data) !== member.contentDigest ||
      versionKey(parsed.data.configurationSetRef) !==
        versionKey(applicableRuleSet.configurationSetRef) ||
      refKey(parsed.data.projectRevisionRef) !== refKey(applicableRuleSet.projectRevisionRef)
    ) {
      throw moduleError("STALE_VERSION", input.commandId, { targetRef: member.releaseRef });
    }
    return parsed.data;
  }

  async #readApplicableRuleSet(
    input: {
      readonly commandId: string;
      readonly projectId: string;
      readonly actorId: string;
      readonly issuedAt: string;
      readonly authorization: AuthorizationContextV1;
    },
    member: AssessmentBasisReleaseSetMemberV1,
  ): Promise<ApplicableRuleSetDocumentV1> {
    const read = await readApplicableRuleSetDocument({
      artifactStore: this.#artifactStore,
      artifactRef: member.artifactRef,
      projectId: input.projectId,
      actorId: input.actorId,
      requestId: `${input.commandId}:applicable-rule-set`,
      idempotencyKey: `${input.commandId}:applicable-rule-set`,
      requestedAt: input.issuedAt,
      requiredCapability: BASIS_READ_CAPABILITY,
      authorization: input.authorization,
    });
    if (read.contentDigest !== member.contentDigest) {
      throw moduleError("STALE_VERSION", input.commandId, { targetRef: member.releaseRef });
    }
    return read.value;
  }

  async #loadRuntimePolicies(input: {
    readonly commandId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly preparationSnapshotRef: AssessmentInputSnapshotV1["preparationSnapshotRef"];
    readonly basisRef: BasisRefV1;
  }): Promise<AssessmentRuntimePolicySetV1> {
    const authorization = await this.#authorizeFor(
      {
        branch: RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.basisMembers,
        invocationId: `${input.commandId}:runtime-policies`,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.issuedAt,
      },
      "risk-assessment.read",
    );
    const read = await this.#runtimePolicies.readRuntimePolicySet({
      requestId: `${input.commandId}:runtime-policies`,
      idempotencyKey: `${input.commandId}:runtime-policies`,
      requestedAt: input.issuedAt,
      requiredAt: input.issuedAt,
      authorization,
      preparationSnapshotRef: input.preparationSnapshotRef,
      assessmentBasisReleaseSetRef: input.basisRef,
    });
    if (read.kind !== "succeeded") {
      throw moduleError("BUSINESS_BLOCKED", input.commandId, {
        blockerKind: "risk-assessment-runtime-policy-incomplete",
        blockerRef: input.basisRef,
      });
    }
    const policySet = AssessmentRuntimePolicySetV1Schema.parse(read.policySet);
    if (policySet.projectId !== input.projectId) {
      throw moduleError("AUTHORIZATION_DENIED", input.commandId);
    }
    return policySet;
  }

  async #loadMonitoring(input: {
    readonly commandId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly preparation: AssessmentPreparationSnapshotV1;
  }): Promise<readonly AssessmentMonitoringInputV1[]> {
    const inputs: AssessmentMonitoringInputV1[] = [];
    for (const monitoringRef of input.preparation.monitoringSnapshotRefs ?? []) {
      const invocationId = `${input.commandId}:monitoring:${monitoringRef.reference.entityId}@${monitoringRef.reference.versionId}`;
      const authorization = await this.#authorizeFor(
        {
          branch: RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.monitoringReads,
          invocationId,
          projectId: input.projectId,
          actorId: input.actorId,
          requestedAt: input.issuedAt,
        },
        "risk-assessment.read",
      );
      const read = await this.#monitoring.readSnapshot({
        kind: "monitoring-snapshot",
        queryId: invocationId,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.issuedAt,
        authorization,
        payload: { monitoringSnapshotRef: monitoringRef },
      });
      if (read.kind !== "succeeded") {
        throw moduleError("BUSINESS_BLOCKED", input.commandId, {
          blockerKind: "risk-assessment-monitoring-unavailable",
          blockerRef: monitoringRef,
        });
      }
      const resolved = await this.#monitoring.resolveSnapshotQuery({
        queryResultRef: read.result.queryResultRef,
        invocationId,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.issuedAt,
        authorization,
      });
      if (resolved.kind !== "succeeded" || resolved.result.kind !== "snapshot-query") {
        throw moduleError("BUSINESS_BLOCKED", input.commandId, {
          blockerKind: "risk-assessment-monitoring-unavailable",
          blockerRef: monitoringRef,
        });
      }
      const snapshot = resolved.result.query.snapshot;
      if (snapshot.projectId !== input.projectId) {
        throw moduleError("AUTHORIZATION_DENIED", input.commandId);
      }
      const seriesRead = await this.#monitoring.readSeriesRevision({
        queryId: invocationId,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.issuedAt,
        authorization,
        monitoringSeriesRef: snapshot.monitoringSeriesRef,
      });
      if (seriesRead.kind !== "succeeded") {
        throw moduleError("BUSINESS_BLOCKED", input.commandId, {
          blockerKind: "risk-assessment-series-unavailable",
          blockerRef: snapshot.monitoringSeriesRef,
        });
      }
      if (
        refKey(seriesRead.result.monitoringSeriesRef) !== refKey(snapshot.monitoringSeriesRef) ||
        seriesRead.result.projectId !== input.projectId
      ) {
        throw moduleError("AUTHORIZATION_DENIED", input.commandId);
      }
      inputs.push({ snapshot, seriesRevision: seriesRead.result });
    }
    return inputs;
  }

  // ------------------------------------------------------------------ context

  #inputSnapshotReferences(
    basis: LoadedBasisV1,
    policySet: AssessmentRuntimePolicySetV1,
  ): Record<(typeof INPUT_SNAPSHOT_REFERENCE_FIELDS_V1)[number], VersionReference> {
    const configurationRef = (definitionType: string): VersionReference => {
      const member = basis.configurationMembers.find(
        (candidate) => candidate.definitionType === definitionType,
      );
      if (member === undefined) {
        throw moduleError("BUSINESS_BLOCKED", "risk-assessment.input-snapshot", {
          blockerKind: "risk-assessment-configuration-incomplete",
        });
      }
      return member.releaseRef.reference;
    };
    return {
      indicatorSystemRef: configurationRef("indicator-system"),
      indicatorFieldMappingRef: configurationRef("indicator-field-mapping"),
      applicableRuleSetRef: basis.applicableRuleSetMember.releaseRef.reference,
      weightSetRef: configurationRef("weight-set"),
      scoringStrategyRef: configurationRef("scoring-strategy"),
      riskMatrixRef: configurationRef("risk-matrix"),
      riskAcceptanceThresholdRef: configurationRef("risk-acceptance-threshold"),
      monitoringWarningThresholdRef: configurationRef("monitoring-warning-threshold"),
      jointTriggerPolicyRef: configurationRef("joint-trigger-policy"),
      measureLibraryReleaseRef: configurationRef("measure-library"),
      warningAggregationPolicyRef: policySet.warningAggregationPolicyRef,
      notificationPolicyRef: policySet.notificationPolicyRef,
      responseGenerationPolicyRef: policySet.responseGenerationPolicyRef,
      responseValidationPolicyRef: policySet.responseValidationPolicyRef,
      responseAgentPolicyRef: policySet.responseAgentPolicyRef,
      effectForecastPolicyRef: configurationRef("forecast-policy"),
      deviationPolicyRef: configurationRef("deviation-policy"),
      calibrationAgentPolicyRef: policySet.calibrationAgentPolicyRef,
      retryPolicyRef: policySet.retryPolicyRef,
      reviewPolicyRef: policySet.reviewPolicyRef,
      modelDeploymentRef: policySet.modelDeploymentRef,
      promptTemplateRef: policySet.promptTemplateRef,
    };
  }

  #engineContext(input: {
    readonly projectId: string;
    readonly preparation: AssessmentPreparationSnapshotV1;
    readonly preparationSnapshotRef: AssessmentInputSnapshotV1["preparationSnapshotRef"];
    readonly inputSnapshot: AssessmentInputSnapshotV1;
    readonly inputSnapshotRef: InputSnapshotRefV1;
    readonly basisRef: BasisRefV1;
    readonly applicability: ApplicabilityMetadataSnapshotV1;
    readonly basis: LoadedBasisV1;
    readonly facts: RiskInputFactsV1;
    readonly monitoring: readonly AssessmentMonitoringInputV1[];
  }): AssessmentEngineContextV1 {
    return {
      projectId: input.projectId,
      projectRevisionRef: input.preparation.projectRevisionRef,
      preparation: input.preparation,
      preparationSnapshotRef: input.preparationSnapshotRef,
      inputSnapshot: input.inputSnapshot,
      inputSnapshotRef: input.inputSnapshotRef,
      assessmentBasisReleaseSetRef: input.basisRef,
      applicabilitySnapshotRef: input.preparation.applicabilityMetadataSnapshotRef,
      applicability: input.applicability.applicabilityMetadata,
      basis: {
        applicableRuleSetMember: input.basis.applicableRuleSetMember,
        scoringRuleMembers: input.basis.scoringRuleMembers,
        configurationMembers: input.basis.configurationMembers,
      },
      configuration: input.basis.configuration,
      applicableRuleSet: input.basis.applicableRuleSet,
      rules: input.basis.rules,
      facts: input.facts,
      monitoring: input.monitoring,
    };
  }

  // ------------------------------------------------------------------ prepare

  async prepare(command: AssessmentPreparationCommandV1): Promise<AssessmentPreparationResultV1> {
    const parsed = AssessmentPreparationCommandV1Schema.safeParse(command);
    if (!parsed.success) {
      return AssessmentPreparationResultV1Schema.parse({
        kind: "failed",
        error: moduleError("UNSUPPORTED_CONTRACT", "risk-assessment.prepare"),
      });
    }
    const valid = parsed.data;
    try {
      await this.#verifyCommand(valid, branchForCommandKind(valid.kind));
      const preparationRead = await this.#loadPreparationContext(
        {
          commandId: valid.commandId,
          projectId: valid.projectId,
          actorId: valid.actorId,
          issuedAt: valid.issuedAt,
        },
        valid.payload.preparationSnapshotRef,
      );
      const preparation = preparationRead.preparation;
      const basisRef = valid.payload.assessmentBasisReleaseSetRef;
      this.#assertEntryBranch(valid, preparation, valid.commandId);

      const basis = await this.#loadBasis({
        commandId: valid.commandId,
        idempotencyKey: valid.idempotencyKey,
        projectId: valid.projectId,
        actorId: valid.actorId,
        issuedAt: valid.issuedAt,
        requiredCapability: "risk-assessment.prepare",
        basisRef,
      });
      this.#assertBasisMatchesPreparation(valid.commandId, basis, preparation);
      const policySet = await this.#loadRuntimePolicies({
        commandId: valid.commandId,
        projectId: valid.projectId,
        actorId: valid.actorId,
        issuedAt: valid.issuedAt,
        preparationSnapshotRef: valid.payload.preparationSnapshotRef,
        basisRef,
      });

      const recordedAt = this.#now().toISOString();
      const auditEntryId = `audit-${valid.commandId}:assessment-input`;
      const inputSnapshot = AssessmentInputSnapshotV1Schema.parse({
        schemaVersion: "1",
        preparationSnapshotRef: valid.payload.preparationSnapshotRef,
        ...this.#inputSnapshotReferences(basis, policySet),
        authorizationContextRef: valid.authorization.authorizationContextRef,
        auditTrailRef: {
          kind: "audit-trail",
          reference: { entityId: auditEntryId, versionId: "1" },
        },
        createdBy: valid.actorId,
        createdAt: recordedAt,
      });
      const referenceDigest = sha256CanonicalJson({
        projectId: valid.projectId,
        ...withoutClock(inputSnapshot as unknown as Record<string, unknown>),
      });
      const inputSnapshotRef: InputSnapshotRefV1 = {
        kind: "assessment-input-snapshot",
        reference: { entityId: `assessment-input-${referenceDigest}`, versionId: "1" },
      };

      const changeEvent =
        valid.kind === "reassessment"
          ? await this.#reassessmentChangeEvent(valid, preparation, inputSnapshot, inputSnapshotRef)
          : undefined;
      await this.#transactionUnit.execute(
        this.#atomicCommand(valid, "risk-assessment.prepare-input-snapshot.v1", {
          inputSnapshotRef,
          referenceDigest,
          entryKind: valid.kind,
        }),
        async (context): Promise<AtomicCommitV1> => {
          const transaction = asRiskAssessmentTransaction(context);
          await transaction
            .insertInto("business.assessment_input_snapshots")
            .values({
              input_snapshot_id: inputSnapshotRef.reference.entityId,
              version_id: inputSnapshotRef.reference.versionId,
              schema_version: "1",
              project_id: valid.projectId,
              command_id: valid.commandId,
              idempotency_key: valid.idempotencyKey,
              payload_hash: referenceDigest,
              preparation_snapshot_ref: jsonValue(inputSnapshot.preparationSnapshotRef),
              preparation_snapshot_id: inputSnapshot.preparationSnapshotRef.reference.entityId,
              preparation_snapshot_version_id:
                inputSnapshot.preparationSnapshotRef.reference.versionId,
              basis_release_set_ref: jsonValue(basisRef),
              basis_release_set_id: basisRef.reference.entityId,
              basis_release_set_version_id: basisRef.reference.versionId,
              previous_assessment_record_ref:
                valid.kind === "reassessment"
                  ? jsonValue(valid.payload.previousAssessmentRecordRef)
                  : null,
              entry_kind: valid.kind,
              effective_at: valid.kind === "historical-backfill" ? valid.payload.effectiveAt : null,
              reference_digest: referenceDigest,
              snapshot_payload: jsonValue(inputSnapshot),
              actor_ref: valid.actorId,
              authorization_context_ref: jsonValue(valid.authorization.authorizationContextRef),
              audit_entry_id: auditEntryId,
              occurred_at: valid.issuedAt,
              recorded_at: recordedAt,
            } as never)
            .onConflict((conflict) =>
              conflict.columns(["input_snapshot_id", "version_id"]).doNothing(),
            )
            .execute();
          return {
            resultRef: inputSnapshotRef,
            audit: {
              auditEntryId,
              projectId: valid.projectId,
              action: "risk-assessment.prepare-input-snapshot",
              targetRef: inputSnapshotRef,
              actorRef: valid.actorId,
              authorizationContextRef: valid.authorization.authorizationContextRef,
              occurredAt: valid.issuedAt,
              recordedAt,
              version: inputSnapshotRef.reference,
              commandId: valid.commandId,
              idempotencyKey: valid.idempotencyKey,
            },
            events: changeEvent === undefined ? [] : [changeEvent],
          } satisfies AtomicCommitV1;
        },
        { isolationLevel: "repeatable read" },
      );

      return AssessmentPreparationResultV1Schema.parse({
        kind: "succeeded",
        result: { assessmentInputSnapshotRef: inputSnapshotRef },
      });
    } catch (error) {
      return AssessmentPreparationResultV1Schema.parse({
        kind: "failed",
        error: failureToModuleError(error, valid.commandId),
      });
    }
  }

  #assertEntryBranch(
    command: AssessmentPreparationCommandV1,
    preparation: AssessmentPreparationSnapshotV1,
    causalRunId: string,
  ): void {
    if (command.kind === "initial") {
      if (preparation.entryMode !== "assess" && preparation.entryMode !== "identify-and-assess") {
        throw moduleError("UNSUPPORTED_CONTRACT", causalRunId);
      }
      return;
    }
    if (command.kind === "reassessment") {
      if (preparation.entryMode !== "reassess") {
        throw moduleError("UNSUPPORTED_CONTRACT", causalRunId);
      }
      const previous = preparation.previousAssessmentRecordRef;
      if (
        previous === undefined ||
        refKey(previous) !== refKey(command.payload.previousAssessmentRecordRef)
      ) {
        throw moduleError("STALE_VERSION", causalRunId, {
          targetRef: command.payload.previousAssessmentRecordRef,
        });
      }
      return;
    }
    if (preparation.entryMode !== "historical-backfill") {
      throw moduleError("UNSUPPORTED_CONTRACT", causalRunId);
    }
  }

  #assertBasisMatchesPreparation(
    causalRunId: string,
    basis: LoadedBasisV1,
    preparation: AssessmentPreparationSnapshotV1,
  ): void {
    if (
      refKey(basis.applicableRuleSet.applicabilitySnapshotRef) !==
        refKey(preparation.applicabilityMetadataSnapshotRef) ||
      refKey(basis.applicableRuleSet.projectRevisionRef) !== refKey(preparation.projectRevisionRef)
    ) {
      throw moduleError("STALE_VERSION", causalRunId, {
        targetRef: basis.applicableRuleSetMember.releaseRef,
      });
    }
  }

  async #reassessmentChangeEvent(
    command: Extract<AssessmentPreparationCommandV1, { kind: "reassessment" }>,
    preparation: AssessmentPreparationSnapshotV1,
    next: AssessmentInputSnapshotV1,
    nextRef: InputSnapshotRefV1,
  ): Promise<DomainEventV1 | undefined> {
    const previousRow = await this.#db
      .selectFrom("business.risk_assessment_records")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("record_id", "=", command.payload.previousAssessmentRecordRef.reference.entityId)
      .where("version_id", "=", command.payload.previousAssessmentRecordRef.reference.versionId)
      .executeTakeFirst();
    if (previousRow === undefined) {
      throw moduleError("AUTHORIZATION_DENIED", command.commandId);
    }
    const previousInputRow = await this.#db
      .selectFrom("business.assessment_input_snapshots")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("input_snapshot_id", "=", previousRow.input_snapshot_id)
      .where("version_id", "=", previousRow.input_snapshot_version_id)
      .executeTakeFirst();
    if (previousInputRow === undefined) {
      throw moduleError("TERMINAL_FAILURE", command.commandId);
    }
    const previousInput = AssessmentInputSnapshotV1Schema.parse(previousInputRow.snapshot_payload);
    const previousPreparation = (
      await this.#loadPreparationContext(
        {
          commandId: `${command.commandId}:previous`,
          projectId: command.projectId,
          actorId: command.actorId,
          issuedAt: command.issuedAt,
        },
        previousInput.preparationSnapshotRef,
      )
    ).preparation;

    const notObserved = (): never => {
      throw moduleError("BUSINESS_BLOCKED", command.commandId, {
        blockerKind: "risk-assessment-change-not-observed",
        blockerRef: nextRef,
      });
    };
    const event = (
      reasonCode: string,
      change:
        | {
            readonly kind: "monitoring-snapshot";
            readonly previousMonitoringSnapshotRefs: readonly unknown[];
            readonly newMonitoringSnapshotRefs: readonly unknown[];
          }
        | {
            readonly kind: "applicability-metadata";
            readonly previousApplicabilityMetadataSnapshotRef: unknown;
            readonly newApplicabilityMetadataSnapshotRef: unknown;
          },
    ): DomainEventV1 =>
      DomainEventV1Schema.parse({
        schemaVersion: "1",
        eventId: `assessment-input-changed-${sha256CanonicalJson({
          projectId: command.projectId,
          previousRecord: command.payload.previousAssessmentRecordRef,
          nextRef,
        })}`,
        eventVersion: 1,
        eventType: "engineering.assessment-input-changed.v1",
        projectId: command.projectId,
        aggregateRef: nextRef,
        occurredAt: command.issuedAt,
        recordedAt: this.#now().toISOString(),
        causationId: command.commandId,
        correlationId: `assessment-input-changed-${nextRef.reference.entityId}`,
        producerCommandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        authorizationContextRef: command.authorization.authorizationContextRef,
        auditTrailRef: next.auditTrailRef,
        payload: { change, reasonCode },
      });

    if (command.payload.reason === "monitoring-snapshot") {
      const previousRefs = previousPreparation.monitoringSnapshotRefs ?? [];
      const currentRefs = preparation.monitoringSnapshotRefs ?? [];
      const previousKeys = new Set(previousRefs.map((ref) => refKey(ref)));
      const currentKeys = new Set(currentRefs.map((ref) => refKey(ref)));
      const changed =
        previousKeys.size !== currentKeys.size ||
        [...previousKeys].some((key) => !currentKeys.has(key));
      if (!changed) throw notObserved();
      return event("monitoring-snapshot", {
        kind: "monitoring-snapshot",
        previousMonitoringSnapshotRefs: [...previousRefs],
        newMonitoringSnapshotRefs: [...currentRefs],
      });
    }
    if (command.payload.reason === "applicability-metadata") {
      const previousRef = previousPreparation.applicabilityMetadataSnapshotRef;
      const currentRef = preparation.applicabilityMetadataSnapshotRef;
      if (refKey(previousRef) === refKey(currentRef)) throw notObserved();
      return event("applicability-metadata", {
        kind: "applicability-metadata",
        previousApplicabilityMetadataSnapshotRef: previousRef,
        newApplicabilityMetadataSnapshotRef: currentRef,
      });
    }
    const field =
      command.payload.reason === "applicable-rule-set"
        ? "applicableRuleSetRef"
        : command.payload.reason === "risk-matrix"
          ? "riskMatrixRef"
          : "weightSetRef";
    if (versionKey(previousInput[field]) === versionKey(next[field])) throw notObserved();
    return undefined;
  }

  // ----------------------------------------------------------------- evaluate

  async evaluate(command: AssessmentEvaluationCommandV1): Promise<AssessmentEvaluationResultV1> {
    const parsed = AssessmentEvaluationCommandV1Schema.safeParse(command);
    if (!parsed.success) {
      return AssessmentEvaluationResultV1Schema.parse({
        kind: "failed",
        error: moduleError("UNSUPPORTED_CONTRACT", "risk-assessment.evaluate"),
      });
    }
    const valid = parsed.data;
    try {
      const verified = await this.#verifyCommand(valid, "risk-assessment.evaluate");
      const inputSnapshotRef = valid.payload.assessmentInputSnapshotRef;
      const inputRow = await this.#db
        .selectFrom("business.assessment_input_snapshots")
        .selectAll()
        .where("project_id", "=", valid.projectId)
        .where("input_snapshot_id", "=", inputSnapshotRef.reference.entityId)
        .where("version_id", "=", inputSnapshotRef.reference.versionId)
        .executeTakeFirst();
      if (inputRow === undefined) {
        return AssessmentEvaluationResultV1Schema.parse({
          kind: "failed",
          error: moduleError(
            "AUTHORIZATION_DENIED",
            valid.commandId,
            {},
            "risk-assessment.evaluate",
          ),
        });
      }
      const inputSnapshot = AssessmentInputSnapshotV1Schema.parse(inputRow.snapshot_payload);
      const basisRef = this.#parseBasisRef(inputRow.basis_release_set_ref, valid.commandId);
      const preparationRead = await this.#loadPreparationContext(
        {
          commandId: valid.commandId,
          projectId: valid.projectId,
          actorId: valid.actorId,
          issuedAt: valid.issuedAt,
        },
        inputSnapshot.preparationSnapshotRef,
      );
      const preparation = preparationRead.preparation;
      const runRef = this.#assessmentRunRef(verified, preparation, valid.commandId);
      const facts = await this.#loadRiskFacts({
        commandId: valid.commandId,
        projectId: valid.projectId,
        actorId: valid.actorId,
        issuedAt: valid.issuedAt,
        riskInput: preparation.riskInput,
      });
      const basis = await this.#loadBasis({
        commandId: valid.commandId,
        idempotencyKey: valid.idempotencyKey,
        projectId: valid.projectId,
        actorId: valid.actorId,
        issuedAt: valid.issuedAt,
        requiredCapability: "risk-assessment.evaluate",
        basisRef,
      });
      const policySet = await this.#loadRuntimePolicies({
        commandId: valid.commandId,
        projectId: valid.projectId,
        actorId: valid.actorId,
        issuedAt: valid.issuedAt,
        preparationSnapshotRef: inputSnapshot.preparationSnapshotRef,
        basisRef,
      });
      this.#assertInputSnapshotReferences(
        valid.commandId,
        inputSnapshot,
        this.#inputSnapshotReferences(basis, policySet),
      );
      const monitoring = await this.#loadMonitoring({
        commandId: valid.commandId,
        projectId: valid.projectId,
        actorId: valid.actorId,
        issuedAt: valid.issuedAt,
        preparation,
      });

      const assessment = evaluateDeterministicAssessment(
        this.#engineContext({
          projectId: valid.projectId,
          preparation,
          preparationSnapshotRef: inputSnapshot.preparationSnapshotRef,
          inputSnapshot,
          inputSnapshotRef,
          basisRef,
          applicability: preparationRead.applicability,
          basis,
          facts,
          monitoring,
        }),
      );
      const decisionArtifact = await this.#putDecisionArtifact(valid, basis, assessment);
      const result = await this.#commitEvaluation({
        command: valid,
        inputSnapshot,
        inputSnapshotRef,
        preparation,
        basis,
        assessment,
        decisionArtifact,
        runRef,
      });
      return AssessmentEvaluationResultV1Schema.parse({ kind: "succeeded", result });
    } catch (error) {
      return AssessmentEvaluationResultV1Schema.parse({
        kind: "failed",
        error: failureToModuleError(error, valid.commandId),
      });
    }
  }

  #parseBasisRef(value: unknown, causalRunId: string): BasisRefV1 {
    const candidate = value as { kind?: unknown };
    if (
      typeof value !== "object" ||
      value === null ||
      candidate.kind !== "assessment-basis-release-set"
    ) {
      throw moduleError("TERMINAL_FAILURE", causalRunId);
    }
    return value as BasisRefV1;
  }

  #assessmentRunRef(
    authorization: AuthorizationContextV1,
    preparation: AssessmentPreparationSnapshotV1,
    causalRunId: string,
  ): { readonly reference: VersionReference } {
    const authorizationRun = authorization.causalRunRef;
    const preparationRun = preparation.causalRunRef;
    if (authorizationRun === undefined && preparationRun === undefined) {
      throw moduleError("BUSINESS_BLOCKED", causalRunId, {
        blockerKind: "risk-assessment-assessment-run-required",
        blockerRef: preparation.applicabilityMetadataSnapshotRef,
      });
    }
    if (
      authorizationRun !== undefined &&
      preparationRun !== undefined &&
      versionKey(authorizationRun.reference) !== versionKey(preparationRun.reference)
    ) {
      throw moduleError("STALE_VERSION", causalRunId, { targetRef: preparationRun });
    }
    return { reference: (authorizationRun ?? preparationRun)!.reference };
  }

  #assertInputSnapshotReferences(
    causalRunId: string,
    stored: AssessmentInputSnapshotV1,
    expected: Record<(typeof INPUT_SNAPSHOT_REFERENCE_FIELDS_V1)[number], VersionReference>,
  ): void {
    for (const field of INPUT_SNAPSHOT_REFERENCE_FIELDS_V1) {
      if (versionKey(stored[field]) !== versionKey(expected[field])) {
        throw moduleError("STALE_VERSION", causalRunId, {
          targetRef: { kind: "project-revision", reference: expected[field] },
        });
      }
    }
  }

  async #putDecisionArtifact(
    command: Extract<AssessmentEvaluationCommandV1, { kind: "evaluate" }>,
    basis: LoadedBasisV1,
    assessment: DeterministicAssessmentV1,
  ): Promise<{ readonly ref: ContentArtifactRefV1; readonly digest: string }> {
    const parentArtifactRefs = [
      basis.applicableRuleSetMember.artifactRef,
      ...basis.scoringRuleMembers.map((member) => member.artifactRef),
    ].sort((left, right) => (refKey(left) < refKey(right) ? -1 : 1));
    const put = await this.#artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1,
        commandId: `${command.commandId}:decision`,
        idempotencyKey: `${command.commandId}:decision`,
        projectId: command.projectId,
        actorId: command.actorId,
        issuedAt: command.issuedAt,
        authorization: command.authorization,
        requiredCapability: "risk-assessment.evaluate",
        artifactId: `assessment-decision-${assessment.decisionDigest}`,
        artifactKind: "content",
        purposeCode: RISK_ASSESSMENT_DECISION_ARTIFACT_PURPOSE_CODE_V1,
        mediaType: RISK_ASSESSMENT_DECISION_MEDIA_TYPE_V1,
        parentArtifactRefs,
        evidenceReferences: [],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      }),
      one(new TextEncoder().encode(canonicalJson(assessment.decision))),
    );
    if (
      put.artifactRef.kind !== "content-artifact" ||
      put.artifactRef.reference.versionId !== `sha256:${assessment.decisionDigest}`
    ) {
      throw moduleError("STALE_VERSION", command.commandId, {
        targetRef: { kind: "content-artifact", reference: put.artifactRef.reference },
      });
    }
    return { ref: put.artifactRef, digest: assessment.decisionDigest };
  }

  async #commitEvaluation(input: {
    readonly command: Extract<AssessmentEvaluationCommandV1, { kind: "evaluate" }>;
    readonly inputSnapshot: AssessmentInputSnapshotV1;
    readonly inputSnapshotRef: InputSnapshotRefV1;
    readonly preparation: AssessmentPreparationSnapshotV1;
    readonly basis: LoadedBasisV1;
    readonly assessment: DeterministicAssessmentV1;
    readonly decisionArtifact: { readonly ref: ContentArtifactRefV1; readonly digest: string };
    readonly runRef: { readonly reference: VersionReference };
  }): Promise<EvaluationResultRefsV1> {
    const command = input.command;
    const assessment = input.assessment;
    const recordedAt = this.#now().toISOString();
    const auditEntryId = `audit-${command.commandId}:assessment-record`;
    const evidenceDigest = sha256CanonicalJson(
      assessment.valueSet.values.map((value) => value.evidenceReferences),
    );
    const configurationDigest = sha256CanonicalJson(
      Object.fromEntries(
        INPUT_SNAPSHOT_REFERENCE_FIELDS_V1.slice(0, 12).map((field) => [
          field,
          input.inputSnapshot[field],
        ]),
      ),
    );
    const riskRecordId =
      "riskRecordId" in assessment.record ? assessment.record.riskRecordId : undefined;
    const externalRiskEventId =
      "externalRiskEventId" in assessment.record
        ? assessment.record.externalRiskEventId
        : undefined;
    const receipt = await this.#transactionUnit.execute(
      this.#atomicCommand(
        command,
        "risk-assessment.record.v1",
        {
          valueSetRef: assessment.valueSet.indicatorActualValueSetRef,
          decisionRef: assessment.decisionRef,
          recordRef: assessment.recordRef,
          inputSnapshotRef: input.inputSnapshotRef,
        },
        input.runRef,
      ),
      async (context): Promise<AtomicCommitV1> => {
        const transaction = asRiskAssessmentTransaction(context);
        await transaction
          .insertInto("business.indicator_actual_value_sets")
          .values({
            value_set_id: assessment.valueSet.indicatorActualValueSetRef.reference.entityId,
            version_id: assessment.valueSet.indicatorActualValueSetRef.reference.versionId,
            schema_version: "1",
            project_id: command.projectId,
            input_snapshot_id: input.inputSnapshotRef.reference.entityId,
            input_snapshot_version_id: input.inputSnapshotRef.reference.versionId,
            input_snapshot_ref: jsonValue(input.inputSnapshotRef),
            content_digest: assessment.valueSet.contentDigest,
            evidence_digest: evidenceDigest,
            value_set_payload: jsonValue(assessment.valueSet),
            recorded_at: recordedAt,
          } as never)
          .onConflict((conflict) => conflict.columns(["value_set_id", "version_id"]).doNothing())
          .execute();
        await transaction
          .insertInto("business.assessment_decision_artifacts")
          .values({
            decision_id: assessment.decisionRef.reference.entityId,
            version_id: assessment.decisionRef.reference.versionId,
            schema_version: "1",
            project_id: command.projectId,
            input_snapshot_id: input.inputSnapshotRef.reference.entityId,
            input_snapshot_version_id: input.inputSnapshotRef.reference.versionId,
            input_snapshot_ref: jsonValue(input.inputSnapshotRef),
            value_set_id: assessment.valueSet.indicatorActualValueSetRef.reference.entityId,
            value_set_version_id:
              assessment.valueSet.indicatorActualValueSetRef.reference.versionId,
            value_set_ref: jsonValue(assessment.valueSet.indicatorActualValueSetRef),
            content_artifact_ref: jsonValue(input.decisionArtifact.ref),
            content_artifact_id: input.decisionArtifact.ref.reference.entityId,
            content_artifact_version_id: input.decisionArtifact.ref.reference.versionId,
            content_digest: input.decisionArtifact.digest,
            recorded_at: recordedAt,
          } as never)
          .onConflict((conflict) => conflict.columns(["decision_id", "version_id"]).doNothing())
          .execute();
        await transaction
          .insertInto("business.risk_assessment_records")
          .values({
            record_id: assessment.recordRef.reference.entityId,
            version_id: assessment.recordRef.reference.versionId,
            schema_version: "1",
            project_id: command.projectId,
            command_id: command.commandId,
            idempotency_key: command.idempotencyKey,
            risk_input_kind:
              riskRecordId === undefined ? "external-risk-event" : "standardized-risk-record",
            risk_record_id: riskRecordId ?? null,
            external_risk_event_id: externalRiskEventId ?? null,
            input_snapshot_id: input.inputSnapshotRef.reference.entityId,
            input_snapshot_version_id: input.inputSnapshotRef.reference.versionId,
            input_snapshot_ref: jsonValue(input.inputSnapshotRef),
            value_set_id: assessment.valueSet.indicatorActualValueSetRef.reference.entityId,
            value_set_version_id:
              assessment.valueSet.indicatorActualValueSetRef.reference.versionId,
            decision_id: assessment.decisionRef.reference.entityId,
            decision_version_id: assessment.decisionRef.reference.versionId,
            record_payload: jsonValue(assessment.record),
            likelihood_score_canonical: assessment.decision.axisScores.possibility.score,
            consequence_score_canonical: assessment.decision.axisScores.consequence.score,
            risk_level_id: assessment.decision.matrix.riskLevelId,
            configuration_digest: configurationDigest,
            content_digest: sha256CanonicalJson(assessment.record),
            identity_digest: assessment.recordDigest,
            actor_ref: command.actorId,
            authorization_context_ref: jsonValue(command.authorization.authorizationContextRef),
            audit_entry_id: auditEntryId,
            occurred_at: command.issuedAt,
            recorded_at: recordedAt,
          } as never)
          .onConflict((conflict) => conflict.columns(["record_id", "version_id"]).doNothing())
          .execute();
        return {
          resultRef: assessment.recordRef,
          audit: {
            auditEntryId,
            projectId: command.projectId,
            action: "risk-assessment.record",
            targetRef: assessment.recordRef,
            actorRef: command.actorId,
            authorizationContextRef: command.authorization.authorizationContextRef,
            occurredAt: command.issuedAt,
            recordedAt,
            version: assessment.recordRef.reference,
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            runId: input.runRef.reference.entityId,
          },
          events: [
            DomainEventV1Schema.parse({
              schemaVersion: "1",
              eventId: `assessment-recorded-${assessment.recordDigest}`,
              eventVersion: 1,
              eventType: "assessment.recorded.v1",
              projectId: command.projectId,
              aggregateRef: assessment.recordRef,
              occurredAt: command.issuedAt,
              recordedAt,
              causationId: command.commandId,
              correlationId: `assessment-record-${assessment.recordDigest}`,
              producerCommandId: command.commandId,
              idempotencyKey: command.idempotencyKey,
              authorizationContextRef: command.authorization.authorizationContextRef,
              auditTrailRef: {
                kind: "audit-trail",
                reference: { entityId: auditEntryId, versionId: "1" },
              },
              payload: {
                riskInputRef: input.preparation.riskInput,
                assessmentInputSnapshotRef: input.inputSnapshotRef,
                assessmentRecordRef: assessment.recordRef,
                assessmentRunRef: input.runRef,
              },
            }),
          ],
        } satisfies AtomicCommitV1;
      },
      { isolationLevel: "repeatable read" },
    );

    const recordRef = receipt.resultRef;
    if (recordRef.kind !== "risk-assessment-record") {
      throw moduleError("TERMINAL_FAILURE", command.commandId);
    }
    const row = await this.#db
      .selectFrom("business.risk_assessment_records")
      .selectAll()
      .where("project_id", "=", command.projectId)
      .where("record_id", "=", recordRef.reference.entityId)
      .where("version_id", "=", recordRef.reference.versionId)
      .executeTakeFirst();
    if (row === undefined) {
      throw moduleError("TERMINAL_FAILURE", command.commandId);
    }
    return {
      indicatorActualValueSetRef: {
        kind: "indicator-actual-value-set",
        reference: { entityId: row.value_set_id, versionId: row.value_set_version_id },
      },
      assessmentDecisionArtifactRef: {
        kind: "assessment-decision-artifact",
        reference: { entityId: row.decision_id, versionId: row.decision_version_id },
      },
      assessmentRecordRef: {
        kind: "risk-assessment-record",
        reference: { entityId: row.record_id, versionId: row.version_id },
      },
    };
  }
}

export const createPostgresRiskAssessmentEngine = (
  options: PostgresRiskAssessmentEngineOptionsV1,
): PostgresRiskAssessmentEngine => new PostgresRiskAssessmentEngine(options);

export type { RiskAssessmentDatabase };
