import { randomUUID } from "node:crypto";

import type { Kysely, Selectable, Transaction } from "kysely";

import {
  ACCESS_POLICY_REF_V1,
  AccessServiceError,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  ArtifactPutCommandV1Schema,
  ArtifactReadRequestV1Schema,
  ArtifactReferenceCheckRequestV1Schema,
  type ArtifactReadHandleV1,
  type ArtifactReferenceGuardV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  AgentValidationResultV1Schema,
  buildCompletedAgentTaskResult,
  emptyAgentBudgetUsage,
  makeAgentError,
  AgentRuntimeError,
  type AgentDomainToolExecutionContextV1,
  type AgentDomainToolResultV1,
  type AgentValidationResultV1,
  type AgentTaskStoreV1,
  type AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import {
  AtomicCommandV1Schema,
  sha256CanonicalJson,
  type AtomicCommandV1,
  type AtomicCommitV1,
  type JsonValue,
  type TransactionContextV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import {
  KnowledgeAuthoringBaselineReadRequestV1Schema,
  KnowledgeAuthoringFailureV1Schema,
  KnowledgeAuthoringManifestV1Schema,
  KnowledgeAuthoringSegmentSliceRequestV1Schema,
  applyKnowledgeAuthoringIncrement,
  createKnowledgeAuthoringTaskDefinition,
  identificationBasisPublishedEvent,
  identificationKnowledgePackageDigest,
  isIdentificationKnowledgeDefinitionTypeV1,
  validateIdentificationKnowledgePackage,
  type IdentificationKnowledgeDefinitionTypeV1,
  type IdentificationKnowledgePackageV1,
  type IdentificationKnowledgeValidationPolicyV1,
  type IdentificationKnowledgeValidationReceiptV1,
  type IdentificationPolicySetProviderV1,
  type IdentificationKnowledgeReleaseEventInputV1,
  type IdentificationKnowledgeReleasePolicyV1,
  type IdentificationPreparationKnowledgeReaderV1,
  type KnowledgeAuthoringManifestV1,
  type KnowledgeAuthoringTaskPortV1,
} from "@riskflow/core/identification-knowledge";
import type { DomainEventV1 } from "@riskflow/contracts/events";
import {
  ContentArtifactRefV1Schema as ContractCandidateArtifactRefV1Schema,
  ContentArtifactRefV1Schema,
  IdentificationPreparationSnapshotRefV1Schema,
  KnowledgeGovernanceCommandV1Schema,
  KnowledgeGovernanceResultV1Schema,
  KnowledgeReleaseRefV1Schema,
  KnowledgeResolutionCommandV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  StartAgentTaskCommandV1Schema,
  ProcessModelReleaseRefV1Schema,
  RetrievalEvidenceBaseReleaseRefV1Schema,
  RiskMechanismReleaseRefV1Schema,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type KnowledgeGovernanceCommandV1,
  type KnowledgeGovernanceResultForCommandV1,
  type KnowledgeResolutionCommandV1,
  type KnowledgeResolutionResultV1,
  type KnowledgeRetrievalQueryV1,
  type KnowledgeRetrievalResultV1,
  type AgentTaskPortV1,
  type AgentTaskResultRefV1,
  type AgentTaskRefV1,
  type ModuleBranchV1,
  type ModuleErrorV1,
  type ReviewTaskRefV1,
} from "@riskflow/contracts/ports";
import { IdentifierSchema } from "@riskflow/contracts/common";

import { getPostgresTransaction } from "../postgres/transaction-unit.js";
import type { PostgresKnowledgeGovernanceAdapter } from "../knowledge-governance/index.js";

const SCHEMA_VERSION = "1";
export const IDENTIFICATION_KNOWLEDGE_VALIDATION_PURPOSE_V1 = "identification-knowledge-validation";
export const IDENTIFICATION_KNOWLEDGE_CANDIDATE_PURPOSE_V1 =
  "identification-knowledge-candidate-package";
const VALIDATION_PURPOSE = IDENTIFICATION_KNOWLEDGE_VALIDATION_PURPOSE_V1;
const CANDIDATE_PURPOSE = IDENTIFICATION_KNOWLEDGE_CANDIDATE_PURPOSE_V1;
export const IDENTIFICATION_KNOWLEDGE_MANIFEST_PURPOSE_V1 =
  "identification-knowledge-authoring-manifest";
export const IDENTIFICATION_KNOWLEDGE_FAILURE_PURPOSE_V1 =
  "identification-knowledge-authoring-failure";
export const IDENTIFICATION_KNOWLEDGE_OBSERVATION_PURPOSE_V1 =
  "identification-knowledge-observation";
const MANIFEST_PURPOSE = IDENTIFICATION_KNOWLEDGE_MANIFEST_PURPOSE_V1;
const FAILURE_PURPOSE = IDENTIFICATION_KNOWLEDGE_FAILURE_PURPOSE_V1;
const OBSERVATION_PURPOSE = IDENTIFICATION_KNOWLEDGE_OBSERVATION_PURPOSE_V1;
const MAX_PACKAGE_BYTES = 4 * 1024 * 1024;

interface ValidationRow {
  schema_version: string;
  command_id: string;
  idempotency_key: string;
  validation_id: string;
  version_id: string;
  project_id: string;
  definition_type: string;
  package_digest: string;
  validation_policy_ref: JsonValue;
  preparation_snapshot_ref: JsonValue;
  candidate_artifact_ref: JsonValue;
  validation_artifact_ref: JsonValue;
  decisions: JsonValue;
  disposition: string;
  rejection_class: string | null;
  authorization_context_ref: JsonValue;
  actor_ref: string;
  audit_entry_id: string;
  occurred_at: Date | string;
  recorded_at: Date | string;
  persisted_at: Date | string;
}

interface RevisionBindingRow {
  schema_version: string;
  command_id: string;
  idempotency_key: string;
  revision_id: string;
  revision_version_id: string;
  project_id: string;
  definition_type: string;
  binding_kind: string;
  validation_id: string | null;
  validation_version_id: string | null;
  package_digest: string | null;
  agent_task_ref: JsonValue | null;
  failure_artifact_ref: JsonValue | null;
  actor_ref: string;
  audit_entry_id: string;
  occurred_at: Date | string;
  recorded_at: Date | string;
  persisted_at: Date | string;
}

interface ReleaseBindingRow {
  schema_version: string;
  command_id: string;
  idempotency_key: string;
  release_id: string;
  release_version_id: string;
  project_id: string;
  definition_type: string;
  revision_id: string;
  revision_version_id: string;
  candidate_artifact_ref: JsonValue;
  composite_member_release_refs: JsonValue | null;
  bound_at: Date | string;
  actor_ref: string;
  audit_entry_id: string;
  occurred_at: Date | string;
  recorded_at: Date | string;
  persisted_at: Date | string;
}

interface AuthoringAttemptRow {
  schema_version: string;
  attempt_id: string;
  version_id: string;
  project_id: string;
  definition_type: string;
  manifest_artifact_ref: JsonValue;
  preparation_snapshot_ref: JsonValue;
  manifest_digest: string;
  agent_task_ref: JsonValue;
  stage: string;
  result_revision_ref: JsonValue | null;
  failure_artifact_ref: JsonValue | null;
  review_task_ref: JsonValue | null;
  command_id: string;
  idempotency_key: string;
  actor_ref: string;
  audit_entry_id: string;
  occurred_at: Date | string;
  recorded_at: Date | string;
  persisted_at: Date | string;
}

interface IdentificationKnowledgeDatabase {
  "business.identification_knowledge_validations": ValidationRow;
  "business.identification_knowledge_revision_bindings": RevisionBindingRow;
  "business.identification_knowledge_release_bindings": ReleaseBindingRow;
  "business.identification_knowledge_authoring_attempts": AuthoringAttemptRow;
}

type IdentificationKnowledgeTransaction = Transaction<IdentificationKnowledgeDatabase>;
type ValidationRowSelect = Selectable<
  IdentificationKnowledgeDatabase["business.identification_knowledge_validations"]
>;

export interface PostgresIdentificationKnowledgeAdapterOptionsV1 {
  readonly db: unknown;
  readonly transactionUnit: TransactionUnitV1;
  readonly access: LocalIdentityAccessV1;
  readonly artifactStore: ArtifactStoreV1;
  readonly artifactReferenceGuard: ArtifactReferenceGuardV1;
  readonly governance: PostgresKnowledgeGovernanceAdapter;
  readonly preparationReader: IdentificationPreparationKnowledgeReaderV1;
  readonly policy: IdentificationKnowledgeValidationPolicyV1;
  readonly policySetProvider?: IdentificationPolicySetProviderV1;
  /** 组合发布的成员登记与事件接缝；由组合根注入并同时交给 C16。 */
  readonly releaseEventRecorder?: IdentificationKnowledgeReleaseEventRecorder;
  /** C08 启动接缝：只有编制入口需要。 */
  readonly agentTaskPort?: AgentTaskPortV1;
  /** C08 执行存储：失败收口按精确任务引用读取状态。 */
  readonly agentTaskStore?: AgentTaskStoreV1;
  /** 组合根提供的冻结收窄授权：finalizer 与失败收口以 submit/review 能力收口。 */
  readonly authoringAuthorization?: (input: {
    readonly taskRef?: AgentTaskRefV1;
    readonly projectId: string;
    readonly invocationId: string;
    readonly branch: ModuleBranchV1;
  }) => Promise<AuthorizationContextV1>;
  readonly now?: () => Date;
}

const asKnowledgeTransaction = (
  context: TransactionContextV1,
): IdentificationKnowledgeTransaction =>
  getPostgresTransaction(context) as unknown as IdentificationKnowledgeTransaction;

const jsonValue = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;

/** jsonb 列使用文本形式写入，避免驱动把对象直接交给 text 通道。 */
const jsonbValue = (value: unknown): JsonValue => JSON.stringify(value) as unknown as JsonValue;

const nowIso = (clock: () => Date): string => {
  const value = clock();
  if (!Number.isFinite(value.getTime())) throw new TypeError("clock returned an invalid date");
  return value.toISOString();
};

const randomId = (prefix: string): string => `${prefix}-${randomUUID()}`;

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const refKey = (value: {
  readonly reference: { readonly entityId: string; readonly versionId: string };
}): string => `${value.reference.entityId}:${value.reference.versionId}`;

const versionedReferenceEquals = (
  left: { readonly reference: { readonly entityId: string; readonly versionId: string } },
  right: { readonly reference: { readonly entityId: string; readonly versionId: string } },
): boolean =>
  left.reference.entityId === right.reference.entityId &&
  left.reference.versionId === right.reference.versionId;

const asContractReference = (value: unknown): ContractReferenceV1 => value as ContractReferenceV1;

const one = (bytes: Uint8Array): AsyncIterable<Uint8Array> =>
  (async function* () {
    yield bytes;
  })();

const moduleError = (
  value:
    | { code: "AUTHORIZATION_DENIED"; branch: ModuleBranchV1; causalRunId: string }
    | {
        code: "ENTITY_NOT_FOUND" | "STALE_VERSION";
        targetRef: ContractReferenceV1;
        causalRunId: string;
      }
    | {
        code: "BUSINESS_BLOCKED";
        blockerKind: string;
        blockerRef: ContractReferenceV1;
        causalRunId: string;
      }
    | { code: "UNSUPPORTED_CONTRACT"; causalRunId: string }
    | { code: "TRANSIENT_FAILURE" | "TERMINAL_FAILURE"; causalRunId: string },
): ModuleErrorV1 => {
  const common = {
    stageCode: `identification-knowledge.${value.code.toLowerCase()}`,
    occurredAt: new Date().toISOString(),
    causalRunId: IdentifierSchema.parse(value.causalRunId),
  };
  if (value.code === "AUTHORIZATION_DENIED") {
    return {
      ...common,
      code: value.code,
      category: "authorization",
      retryable: false,
      requiredCapability: MODULE_BRANCH_CAPABILITY_V1[value.branch],
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
    };
  }
  if (value.code === "ENTITY_NOT_FOUND" || value.code === "STALE_VERSION") {
    return {
      ...common,
      code: value.code,
      category: value.code === "ENTITY_NOT_FOUND" ? "not-found" : "concurrency",
      retryable: false,
      targetRef: value.targetRef,
    } as ModuleErrorV1;
  }
  if (value.code === "BUSINESS_BLOCKED") {
    return {
      ...common,
      code: value.code,
      category: "business-blocked",
      retryable: false,
      blockerKind: IdentifierSchema.parse(value.blockerKind),
      blockerRef: value.blockerRef,
    };
  }
  if (value.code === "UNSUPPORTED_CONTRACT") {
    return {
      ...common,
      code: value.code,
      category: "technical",
      retryable: false,
    } as ModuleErrorV1;
  }
  return {
    ...common,
    code: "TERMINAL_FAILURE",
    category: "technical",
    retryable: false,
    diagnosticRef: {
      kind: "diagnostic-artifact",
      reference: {
        entityId: `identification-knowledge-failure-${value.causalRunId}`,
        versionId: `sha256:${sha256CanonicalJson({ causalRunId: value.causalRunId })}`,
      },
    },
  } as ModuleErrorV1;
};

const atomicCommand =
  (command: {
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): ((input: {
    readonly commandKind: string;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly payload: object;
  }) => AtomicCommandV1) =>
  (input) =>
    AtomicCommandV1Schema.parse({
      projectId: command.projectId,
      commandKind: input.commandKind,
      commandId: input.commandId,
      idempotencyKey: input.idempotencyKey,
      payload: jsonValue(input.payload) as Record<string, JsonValue>,
      actorRef: command.actorId,
      authorizationContextRef: command.authorization.authorizationContextRef,
      issuedAt: command.issuedAt,
    });

const auditFor = (input: {
  readonly command: AtomicCommandV1;
  readonly targetRef: ContractReferenceV1;
  readonly action: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly auditEntryId: string;
}): AtomicCommitV1["audit"] => ({
  auditEntryId: input.auditEntryId,
  projectId: input.command.projectId,
  action: input.action,
  targetRef: input.targetRef,
  actorRef: input.command.actorRef,
  authorizationContextRef: input.command.authorizationContextRef,
  occurredAt: input.occurredAt,
  recordedAt: input.recordedAt,
  version:
    "reference" in input.targetRef
      ? input.targetRef.reference
      : { entityId: input.targetRef.eventId, versionId: String(input.targetRef.eventVersion) },
  commandId: input.command.commandId,
  idempotencyKey: input.command.idempotencyKey,
});

const validationReceiptFromRow = (
  row: ValidationRow,
): IdentificationKnowledgeValidationReceiptV1 => {
  const definitionType = isIdentificationKnowledgeDefinitionTypeV1(row.definition_type)
    ? row.definition_type
    : undefined;
  if (definitionType === undefined) {
    throw new Error(`unexpected identification definition type ${row.definition_type}`);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: row.project_id,
    definitionType,
    packageDigest: row.package_digest,
    validationPolicyRef: row.validation_policy_ref as never,
    preparationSnapshotRef: row.preparation_snapshot_ref as never,
    items: row.decisions as never,
    disposition: row.disposition as "accepted" | "rejected",
    ...(row.rejection_class === null
      ? {}
      : { rejectionClass: row.rejection_class as "repairable" | "terminal" }),
    validationArtifactRef: ContentArtifactRefV1Schema.parse(row.validation_artifact_ref),
    validatedAt: asIso(row.recorded_at),
  };
};

/**
 * 识别知识发布事件记录器：组合发布前登记四个成员精确引用，C16 发布事务内据此发出
 * `knowledge.identification-basis-published.v1`；成员未知时保持 fail-closed 不发事件。
 */
export class IdentificationKnowledgeReleaseEventRecorder implements IdentificationKnowledgeReleasePolicyV1 {
  readonly #members = new Map<string, readonly unknown[]>();

  record(input: {
    readonly projectId: string;
    readonly revisionRef: {
      readonly reference: { readonly entityId: string; readonly versionId: string };
    };
    readonly compositeMemberReleaseRefs: readonly unknown[];
  }): void {
    this.#members.set(
      `${input.projectId}:${input.revisionRef.reference.entityId}:${input.revisionRef.reference.versionId}`,
      input.compositeMemberReleaseRefs,
    );
  }

  async appendRelease(
    input: IdentificationKnowledgeReleaseEventInputV1,
  ): Promise<readonly DomainEventV1[]> {
    if (input.definitionType !== "retrieval-evidence-base") return [];
    const key = `${input.projectId}:${input.revisionRef.reference.entityId}:${input.revisionRef.reference.versionId}`;
    const members = this.#members.get(key);
    this.#members.delete(key);
    if (members === undefined) return [];
    return [
      identificationBasisPublishedEvent({
        releaseRef: input.releaseRef,
        compositeMemberReleaseRefs: members as never,
        command: input.command,
        recordedAt: input.recordedAt,
        auditEntryId: input.auditEntryId,
      }),
    ];
  }
}

/**
 * C17 façade：在 C16 生命周期之前设置内容门，在之后追加 C17 绑定；正文始终保存在 C04，
 * 数据库只保存受约束的索引事实（D-05、D-07、D-10、D-12）。
 */
export class PostgresIdentificationKnowledgeAdapter {
  readonly #db: Kysely<IdentificationKnowledgeDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #access: LocalIdentityAccessV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #artifactReferenceGuard: ArtifactReferenceGuardV1;
  readonly #governance: PostgresKnowledgeGovernanceAdapter;
  readonly #preparationReader: IdentificationPreparationKnowledgeReaderV1;
  readonly #policy: IdentificationKnowledgeValidationPolicyV1;
  readonly #policySetProvider: IdentificationPolicySetProviderV1 | undefined;
  readonly #releaseEventRecorder: IdentificationKnowledgeReleaseEventRecorder;
  readonly #agentTaskPort: AgentTaskPortV1 | undefined;
  readonly #agentTaskStore: AgentTaskStoreV1 | undefined;
  readonly #authoringAuthorization:
    PostgresIdentificationKnowledgeAdapterOptionsV1["authoringAuthorization"] | undefined;
  readonly #now: () => Date;

  constructor(options: PostgresIdentificationKnowledgeAdapterOptionsV1) {
    this.#db = options.db as unknown as Kysely<IdentificationKnowledgeDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#access = options.access;
    this.#artifactStore = options.artifactStore;
    this.#artifactReferenceGuard = options.artifactReferenceGuard;
    this.#governance = options.governance;
    this.#preparationReader = options.preparationReader;
    this.#policy = options.policy;
    this.#policySetProvider = options.policySetProvider;
    this.#releaseEventRecorder =
      options.releaseEventRecorder ?? new IdentificationKnowledgeReleaseEventRecorder();
    this.#agentTaskPort = options.agentTaskPort;
    this.#agentTaskStore = options.agentTaskStore;
    this.#authoringAuthorization = options.authoringAuthorization;
    this.#now = options.now ?? (() => new Date());
  }

  // ------------------------------------------------------------------ C02 port

  async govern<T extends KnowledgeGovernanceCommandV1>(
    command: T,
  ): Promise<KnowledgeGovernanceResultForCommandV1<T>> {
    const parsed = KnowledgeGovernanceCommandV1Schema.safeParse(command);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: moduleError({
          code: "UNSUPPORTED_CONTRACT",
          causalRunId: "identification-knowledge",
        }),
      } as KnowledgeGovernanceResultForCommandV1<T>;
    }
    const valid = parsed.data;
    const result =
      valid.kind === "submit-revision" &&
      isIdentificationKnowledgeDefinitionTypeV1(valid.payload.definitionType)
        ? await this.#submitIdentificationRevision(valid)
        : await this.#delegateGovern(valid);
    return result as KnowledgeGovernanceResultForCommandV1<T>;
  }

  async resolve(command: KnowledgeResolutionCommandV1): Promise<KnowledgeResolutionResultV1> {
    const parsed = KnowledgeResolutionCommandV1Schema.safeParse(command);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: "identification-basis" }),
      };
    }
    const valid = parsed.data;
    if (valid.kind === "assessment-basis") {
      return {
        kind: "failed",
        error: moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: valid.commandId }),
      };
    }
    return await this.#resolveIdentificationBasis(valid);
  }

  async retrieve(query: KnowledgeRetrievalQueryV1): Promise<KnowledgeRetrievalResultV1> {
    return {
      kind: "failed",
      error: moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: query.queryId }),
    };
  }

  /** D-12：C20/C24 的唯一窄读面，按精确发布引用返回不可变包与治理元数据。 */
  async readExact(input: {
    readonly projectId: string;
    readonly releaseRef: unknown;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly invocationId?: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<
    | {
        readonly kind: "succeeded";
        readonly read: {
          readonly package: IdentificationKnowledgePackageV1;
          readonly validation: IdentificationKnowledgeValidationReceiptV1;
          readonly releaseBinding: {
            readonly schemaVersion: "1";
            readonly projectId: string;
            readonly definitionType: IdentificationKnowledgeDefinitionTypeV1;
            readonly releaseRef: unknown;
            readonly revisionRef: {
              readonly kind: "knowledge-revision";
              readonly reference: { readonly entityId: string; readonly versionId: string };
            };
            readonly candidateArtifactRef: ReturnType<
              typeof ContractCandidateArtifactRefV1Schema.parse
            >;
            readonly compositeMemberReleaseRefs?: readonly unknown[];
            readonly boundAt: string;
          };
        };
      }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  > {
    const releaseRef = KnowledgeReleaseRefV1Schema.safeParse(input.releaseRef);
    if (!releaseRef.success) {
      return {
        kind: "failed",
        error: moduleError({
          code: "UNSUPPORTED_CONTRACT",
          causalRunId: "identification-knowledge-read",
        }),
      };
    }
    try {
      await this.#verifyAuthorization(
        input.authorization,
        input.projectId,
        input.invocationId ?? `knowledge-read-${refKey(releaseRef.data)}`,
        "knowledge-modeling.identification-basis",
      );
      const binding = await this.#findReleaseBindingByRef(input.projectId, releaseRef.data);
      const revisionBinding =
        binding === undefined
          ? undefined
          : await this.#findRevisionBinding(
              input.projectId,
              binding.revision_id,
              binding.revision_version_id,
            );
      if (
        binding === undefined ||
        revisionBinding === undefined ||
        revisionBinding.binding_kind !== "validated"
      ) {
        return {
          kind: "failed",
          error: moduleError({
            code: "ENTITY_NOT_FOUND",
            causalRunId: `knowledge-read-${input.projectId}`,
            targetRef: asContractReference(releaseRef.data),
          }),
        };
      }
      const validationRow = await this.#findValidation(
        input.projectId,
        revisionBinding.validation_id,
        revisionBinding.validation_version_id,
      );
      if (validationRow === undefined) {
        return {
          kind: "failed",
          error: moduleError({
            code: "ENTITY_NOT_FOUND",
            causalRunId: `knowledge-read-${input.projectId}`,
            targetRef: asContractReference(releaseRef.data),
          }),
        };
      }
      const packageValue = (await this.#readArtifact(
        input.authorization,
        ContractCandidateArtifactRefV1Schema.parse(binding.candidate_artifact_ref),
        CANDIDATE_PURPOSE,
      )) as IdentificationKnowledgePackageV1;
      return {
        kind: "succeeded",
        read: {
          package: packageValue,
          validation: validationReceiptFromRow(validationRow),
          releaseBinding: {
            schemaVersion: SCHEMA_VERSION,
            projectId: binding.project_id,
            definitionType: binding.definition_type as IdentificationKnowledgeDefinitionTypeV1,
            releaseRef: releaseRef.data,
            revisionRef: {
              kind: "knowledge-revision",
              reference: {
                entityId: binding.revision_id,
                versionId: binding.revision_version_id,
              },
            },
            candidateArtifactRef: ContractCandidateArtifactRefV1Schema.parse(
              binding.candidate_artifact_ref,
            ),
            ...(binding.composite_member_release_refs === null
              ? {}
              : { compositeMemberReleaseRefs: binding.composite_member_release_refs as never }),
            boundAt: asIso(binding.bound_at),
          },
        },
      };
    } catch (error) {
      return { kind: "failed", error: await this.#mapError(error, input.projectId) };
    }
  }

  // --------------------------------------------------------------- identification

  async #submitIdentificationRevision(
    command: Extract<KnowledgeGovernanceCommandV1, { kind: "submit-revision" }>,
  ): Promise<ReturnType<typeof KnowledgeGovernanceResultV1Schema.parse>> {
    const definitionType = command.payload.definitionType;
    if (!isIdentificationKnowledgeDefinitionTypeV1(definitionType)) {
      return KnowledgeGovernanceResultV1Schema.parse({
        kind: "failed",
        error: moduleError({ code: "UNSUPPORTED_CONTRACT", causalRunId: command.commandId }),
      });
    }
    try {
      const verified = await this.#verifyAuthorization(
        command.authorization,
        command.projectId,
        command.commandId,
        "knowledge-modeling.submit-revision",
      );
      const candidateArtifactRef = ContractCandidateArtifactRefV1Schema.parse(
        command.payload.candidateArtifactRef,
      );
      const rawCandidate = await this.#readArtifact(
        command.authorization,
        candidateArtifactRef,
        CANDIDATE_PURPOSE,
      );
      const preparationSnapshotRef = IdentificationPreparationSnapshotRefV1Schema.safeParse(
        (rawCandidate as { preparationSnapshotRef?: unknown } | undefined)?.preparationSnapshotRef,
      );
      const outcome = await validateIdentificationKnowledgePackage({
        value: rawCandidate,
        expectedDefinitionType: definitionType,
        dependencies: {
          projectId: command.projectId,
          policy: this.#policy,
          checkEvidence: async (input) => {
            if (!preparationSnapshotRef.success) return [];
            const checked = await this.#preparationReader.checkEvidence({
              projectId: command.projectId,
              preparationSnapshotRef: preparationSnapshotRef.data,
              evidenceReferences: input.evidenceReferences,
              purposeCode: input.purposeCode,
              actorId: command.actorId,
              requestedAt: command.issuedAt,
              authorization: command.authorization,
            });
            return checked.kind === "succeeded" ? checked.items : [];
          },
          resolveProcessModel: (releaseRef) =>
            this.#resolveProcessModelNodes(command.projectId, releaseRef, command),
        },
      });
      const packageValue = rawCandidate as IdentificationKnowledgePackageV1;
      const packageDigest = identificationKnowledgePackageDigest(packageValue);
      const validationArtifactRef = await this.#putArtifact(command, {
        artifactId: `c17-validation-${packageDigest.slice(0, 40)}`,
        purposeCode: VALIDATION_PURPOSE,
        value: {
          schemaVersion: SCHEMA_VERSION,
          projectId: command.projectId,
          definitionType,
          packageDigest,
          items: outcome.items,
          disposition: outcome.disposition,
        },
        parentArtifactRefs: [candidateArtifactRef],
      });
      const validationId = randomId("c17-validation");
      const validationAuditId = randomId("audit");
      const recordedAt = nowIso(this.#now);
      const buildAtomic = atomicCommand(command);
      const validationAtomic = buildAtomic({
        commandKind: "knowledge.identification-knowledge.validate.v1",
        commandId: `${command.commandId}:validation`,
        idempotencyKey: `${command.idempotencyKey}:validation`,
        payload: { packageDigest, disposition: outcome.disposition },
      });
      await this.#transactionUnit.execute(validationAtomic, async (context) => {
        // 候选工件在形成业务事实前必须由引用守卫按当前授权复验。
        await this.#artifactReferenceGuard.assertUsable(
          context,
          ArtifactReferenceCheckRequestV1Schema.parse({
            schemaVersion: SCHEMA_VERSION,
            artifactRef: candidateArtifactRef,
            projectId: command.projectId,
            purposeCode: CANDIDATE_PURPOSE,
            requiredCapability: command.authorization.grantedCapabilities[0],
            authorization: command.authorization,
          }),
        );
        const tx = asKnowledgeTransaction(context);
        await tx
          .insertInto("business.identification_knowledge_validations")
          .values({
            validation_id: validationId,
            version_id: "1",
            schema_version: SCHEMA_VERSION,
            project_id: command.projectId,
            definition_type: definitionType,
            package_digest: packageDigest,
            validation_policy_ref: jsonbValue(this.#policy.policyRef),
            preparation_snapshot_ref: jsonbValue(
              preparationSnapshotRef.success ? preparationSnapshotRef.data : {},
            ),
            candidate_artifact_ref: jsonbValue(candidateArtifactRef),
            validation_artifact_ref: jsonbValue(validationArtifactRef),
            decisions: jsonbValue(outcome.items),
            disposition: outcome.disposition,
            rejection_class: outcome.rejectionClass ?? null,
            authorization_context_ref: jsonbValue(verified.authorizationContextRef),
            command_id: validationAtomic.commandId,
            idempotency_key: validationAtomic.idempotencyKey,
            actor_ref: validationAtomic.actorRef,
            audit_entry_id: validationAuditId,
            occurred_at: new Date(command.issuedAt),
            recorded_at: new Date(recordedAt),
            persisted_at: new Date(recordedAt),
          })
          .onConflict((conflict) => conflict.columns(["project_id", "idempotency_key"]).doNothing())
          .execute();
        return {
          resultRef: asContractReference(validationArtifactRef),
          audit: auditFor({
            command: validationAtomic,
            targetRef: candidateArtifactRef as never,
            action: "identification-knowledge.validate",
            occurredAt: command.issuedAt,
            recordedAt,
            auditEntryId: validationAuditId,
          }),
          events: [],
        } satisfies AtomicCommitV1;
      });
      if (outcome.disposition === "rejected") {
        return KnowledgeGovernanceResultV1Schema.parse({
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: command.commandId,
            blockerKind: `identification-knowledge-${outcome.rejectionClass ?? "repairable"}`,
            blockerRef: asContractReference(validationArtifactRef),
          }),
        });
      }
      // C16 校验绑定在命令身份上：原样委派调用方命令，C17 仅用自己的派生键记录本地阶段。
      const submitted = await this.#governance.govern(command);
      if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") {
        return submitted.kind === "succeeded"
          ? KnowledgeGovernanceResultV1Schema.parse({
              kind: "failed",
              error: moduleError({ code: "TERMINAL_FAILURE", causalRunId: command.commandId }),
            })
          : submitted;
      }
      const revisionRef = submitted.result.knowledgeRevisionRef;
      const bindingAuditId = randomId("audit");
      const bindingAtomic = buildAtomic({
        commandKind: "knowledge.identification-knowledge.bind-revision.v1",
        commandId: `${command.commandId}:bind-revision`,
        idempotencyKey: `${command.idempotencyKey}:bind-revision`,
        payload: { revisionRef },
      });
      await this.#transactionUnit.execute(bindingAtomic, async (context) => {
        const tx = asKnowledgeTransaction(context);
        await tx
          .insertInto("business.identification_knowledge_revision_bindings")
          .values({
            revision_id: revisionRef.reference.entityId,
            revision_version_id: revisionRef.reference.versionId,
            schema_version: SCHEMA_VERSION,
            project_id: command.projectId,
            definition_type: definitionType,
            binding_kind: "validated",
            validation_id: validationId,
            validation_version_id: "1",
            package_digest: packageDigest,
            agent_task_ref: null,
            failure_artifact_ref: null,
            command_id: bindingAtomic.commandId,
            idempotency_key: bindingAtomic.idempotencyKey,
            actor_ref: bindingAtomic.actorRef,
            audit_entry_id: bindingAuditId,
            occurred_at: new Date(command.issuedAt),
            recorded_at: new Date(recordedAt),
            persisted_at: new Date(recordedAt),
          })
          .onConflict((conflict) => conflict.columns(["project_id", "idempotency_key"]).doNothing())
          .execute();
        return {
          resultRef: asContractReference(revisionRef),
          audit: auditFor({
            command: bindingAtomic,
            targetRef: asContractReference(revisionRef),
            action: "identification-knowledge.bind-revision",
            occurredAt: command.issuedAt,
            recordedAt,
            auditEntryId: bindingAuditId,
          }),
          events: [],
        } satisfies AtomicCommitV1;
      });
      return submitted;
    } catch (error) {
      return KnowledgeGovernanceResultV1Schema.parse({
        kind: "failed",
        error: await this.#mapError(error, command.commandId),
      });
    }
  }

  async #resolveProcessModelNodes(
    projectId: string,
    releaseRef: {
      readonly reference: { readonly entityId: string; readonly versionId: string };
    },
    command: {
      readonly actorId: string;
      readonly issuedAt: string;
      readonly authorization: AuthorizationContextV1;
    },
  ): Promise<
    | {
        readonly projectId: string;
        readonly nodes: readonly { readonly nodeId: string; readonly processKind: never }[];
      }
    | undefined
  > {
    const release = KnowledgeReleaseRefV1Schema.parse({
      kind: "knowledge-release",
      reference: releaseRef.reference,
    });
    const read = await this.readExact({
      projectId,
      releaseRef: release,
      actorId: command.actorId,
      requestedAt: command.issuedAt,
      authorization: command.authorization,
    });
    if (read.kind === "failed") return undefined;
    if (read.read.package.definitionType !== "process-model") return undefined;
    return {
      projectId,
      nodes: read.read.package.nodes.map((node) => ({
        nodeId: node.nodeId,
        processKind: node.processKind as never,
      })),
    };
  }

  async #delegateGovern(
    command: KnowledgeGovernanceCommandV1,
  ): Promise<ReturnType<typeof KnowledgeGovernanceResultV1Schema.parse>> {
    try {
      if (command.kind === "request-review") {
        const binding = await this.#findRevisionBindingByRef(
          command.projectId,
          command.payload.revisionRef,
        );
        if (binding !== undefined && binding.binding_kind !== "validated") {
          return KnowledgeGovernanceResultV1Schema.parse({
            kind: "failed",
            error: moduleError({
              code: "BUSINESS_BLOCKED",
              causalRunId: command.commandId,
              blockerKind: "failure-review-only",
              blockerRef: asContractReference(command.payload.revisionRef),
            }),
          });
        }
        return await this.#governance.govern(command);
      }
      if (command.kind === "publish-approved-release") {
        const binding = await this.#findRevisionBindingByRef(
          command.projectId,
          command.payload.revisionRef,
        );
        if (binding === undefined || binding.binding_kind !== "validated") {
          return KnowledgeGovernanceResultV1Schema.parse({
            kind: "failed",
            error: moduleError({
              code: "BUSINESS_BLOCKED",
              causalRunId: command.commandId,
              blockerKind: "identification-knowledge-binding-required",
              blockerRef: asContractReference(command.payload.revisionRef),
            }),
          });
        }
        const published = await this.#governance.govern(command);
        if (published.kind !== "succeeded" || published.result.kind !== "release") {
          console.error("C17_PUBLISH_RESULT", JSON.stringify(published).slice(0, 600));
          return published;
        }
        const validationRow = await this.#findValidation(
          command.projectId,
          binding.validation_id,
          binding.validation_version_id,
        );
        if (validationRow === undefined) return published;
        const candidateArtifactRef = ContractCandidateArtifactRefV1Schema.parse(
          validationRow.candidate_artifact_ref,
        );
        const packageValue = (await this.#readArtifact(
          command.authorization,
          candidateArtifactRef,
          CANDIDATE_PURPOSE,
        )) as IdentificationKnowledgePackageV1;
        const releaseRef = published.result.knowledgeReleaseRef;
        const compositeMembers =
          packageValue.definitionType === "retrieval-evidence-base"
            ? [
                packageValue.riskMechanismReleaseRef,
                packageValue.standardLibraryReleaseRef,
                packageValue.caseLibraryReleaseRef,
              ]
            : undefined;
        if (compositeMembers !== undefined) {
          const resolved = await this.#governance.resolveGovernedReleases({
            projectId: command.projectId,
            requiredDefinitionTypes: [
              "process-model",
              "risk-mechanism",
              "standard-library",
              "case-library",
            ],
            requiredAt: command.payload.effectiveFrom,
            asOfRecordedAt: command.issuedAt,
            authorization: command.authorization,
          });
          if (resolved.kind !== "succeeded") return published;
          const selected = resolved.result.releaseRefs;
          const processModelResolution = await this.#governance.resolveGovernedReleases({
            projectId: command.projectId,
            requiredDefinitionTypes: ["process-model"],
            requiredAt: command.payload.effectiveFrom,
            asOfRecordedAt: command.issuedAt,
            authorization: command.authorization,
          });
          const processModelReleaseRef =
            processModelResolution.kind === "succeeded"
              ? processModelResolution.result.releaseRefs[0]
              : undefined;
          // 事件载荷顺序固定为 process-model → risk-mechanism → standard-library → case-library，
          // 最后一项由 C16 发布事务补上组合发布本身。
          if (
            processModelReleaseRef !== undefined &&
            compositeMembers.every((member) =>
              selected.some((candidate) => versionedReferenceEquals(candidate, member as never)),
            )
          ) {
            this.#releaseEventRecorder.record({
              projectId: command.projectId,
              revisionRef: command.payload.revisionRef,
              compositeMemberReleaseRefs: [processModelReleaseRef, ...compositeMembers],
            });
          }
          if (
            !compositeMembers.every((member) =>
              selected.some((candidate) => versionedReferenceEquals(candidate, member as never)),
            )
          ) {
            return KnowledgeGovernanceResultV1Schema.parse({
              kind: "failed",
              error: moduleError({
                code: "BUSINESS_BLOCKED",
                causalRunId: command.commandId,
                blockerKind: "retrieval-evidence-base-members-invalid",
                blockerRef: asContractReference(releaseRef),
              }),
            });
          }
        }
        await this.#bindRelease(command, {
          releaseRef,
          definitionType: binding.definition_type,
          revisionId: binding.revision_id,
          revisionVersionId: binding.revision_version_id,
          candidateArtifactRef,
          compositeMembers,
        });
        return published;
      }
      if (command.kind === "rollback-by-new-release") {
        const historical = await this.#findReleaseBindingByRef(
          command.projectId,
          command.payload.historicalReleaseRef,
        );
        const rolledBack = await this.#governance.govern(command);
        if (
          historical === undefined ||
          rolledBack.kind !== "succeeded" ||
          rolledBack.result.kind !== "release"
        ) {
          return rolledBack;
        }
        await this.#bindRelease(command, {
          releaseRef: rolledBack.result.knowledgeReleaseRef,
          definitionType: historical.definition_type,
          revisionId: historical.revision_id,
          revisionVersionId: historical.revision_version_id,
          candidateArtifactRef: ContractCandidateArtifactRefV1Schema.parse(
            historical.candidate_artifact_ref,
          ),
          compositeMembers:
            historical.composite_member_release_refs === null
              ? undefined
              : (historical.composite_member_release_refs as never),
        });
        return rolledBack;
      }
      return await this.#governance.govern(command);
    } catch (error) {
      console.error(
        "C17_DELEGATE_ERROR",
        JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})).slice(0, 600),
      );
      return KnowledgeGovernanceResultV1Schema.parse({
        kind: "failed",
        error: await this.#mapError(error, command.commandId),
      });
    }
  }

  async #bindRelease(
    command: Extract<
      KnowledgeGovernanceCommandV1,
      { kind: "publish-approved-release" | "rollback-by-new-release" }
    >,
    input: {
      readonly releaseRef: {
        readonly reference: { readonly entityId: string; readonly versionId: string };
      };
      readonly definitionType: string;
      readonly revisionId: string;
      readonly revisionVersionId: string;
      readonly candidateArtifactRef: ReturnType<typeof ContractCandidateArtifactRefV1Schema.parse>;
      readonly compositeMembers: readonly unknown[] | undefined;
    },
  ): Promise<void> {
    const recordedAt = nowIso(this.#now);
    const auditEntryId = randomId("audit");
    const atomic = atomicCommand(command)({
      commandKind: "knowledge.identification-knowledge.bind-release.v1",
      commandId: `${command.commandId}:bind-release`,
      idempotencyKey: `${command.idempotencyKey}:bind-release`,
      payload: { releaseRef: input.releaseRef },
    });
    await this.#transactionUnit.execute(atomic, async (context) => {
      const tx = asKnowledgeTransaction(context);
      await tx
        .insertInto("business.identification_knowledge_release_bindings")
        .values({
          release_id: input.releaseRef.reference.entityId,
          release_version_id: input.releaseRef.reference.versionId,
          schema_version: SCHEMA_VERSION,
          project_id: command.projectId,
          definition_type: input.definitionType,
          revision_id: input.revisionId,
          revision_version_id: input.revisionVersionId,
          candidate_artifact_ref: jsonbValue(input.candidateArtifactRef),
          composite_member_release_refs:
            input.compositeMembers === undefined ? null : jsonbValue(input.compositeMembers),
          bound_at: new Date(recordedAt),
          command_id: atomic.commandId,
          idempotency_key: atomic.idempotencyKey,
          actor_ref: atomic.actorRef,
          audit_entry_id: auditEntryId,
          occurred_at: new Date(command.issuedAt),
          recorded_at: new Date(recordedAt),
          persisted_at: new Date(recordedAt),
        })
        .onConflict((conflict) => conflict.columns(["project_id", "idempotency_key"]).doNothing())
        .execute();
      return {
        resultRef: asContractReference(input.releaseRef),
        audit: auditFor({
          command: atomic,
          targetRef: asContractReference(input.releaseRef),
          action: "identification-knowledge.bind-release",
          occurredAt: command.issuedAt,
          recordedAt,
          auditEntryId,
        }),
        events: [],
      } satisfies AtomicCommitV1;
    });
  }

  async #resolveIdentificationBasis(
    command: Extract<KnowledgeResolutionCommandV1, { kind: "identification-basis" }>,
  ): Promise<KnowledgeResolutionResultV1> {
    try {
      await this.#verifyAuthorization(
        command.authorization,
        command.projectId,
        command.commandId,
        "knowledge-modeling.identification-basis",
      );
      const preparation = await this.#preparationReader.readExactPreparation({
        projectId: command.projectId,
        preparationSnapshotRef: command.payload.preparationSnapshotRef,
        actorId: command.actorId,
        requestedAt: command.issuedAt,
        authorization: command.authorization,
      });
      if (preparation.kind === "failed") {
        return { kind: "failed", error: preparation.error };
      }
      const requiredAt = command.payload.requiredAt;
      const asOfRecordedAt = command.issuedAt;
      const resolved = await this.#governance.resolveGovernedReleases({
        projectId: command.projectId,
        requiredDefinitionTypes: ["process-model", "risk-mechanism", "retrieval-evidence-base"],
        requiredAt,
        asOfRecordedAt,
        authorization: command.authorization,
      });
      if (resolved.kind !== "succeeded") return resolved;
      const processModel = resolved.result.members.find(
        (member) => member.definitionType === "process-model",
      );
      const riskMechanism = resolved.result.members.find(
        (member) => member.definitionType === "risk-mechanism",
      );
      const composite = resolved.result.members.find(
        (member) => member.definitionType === "retrieval-evidence-base",
      );
      if (processModel === undefined || riskMechanism === undefined || composite === undefined) {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: command.commandId,
            blockerKind: "identification-basis-incomplete",
            blockerRef: asContractReference(command.payload.preparationSnapshotRef),
          }),
        };
      }
      const compositeBinding = await this.#findReleaseBindingByRef(
        command.projectId,
        composite.releaseRef,
      );
      if (
        compositeBinding === undefined ||
        compositeBinding.composite_member_release_refs === null
      ) {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: command.commandId,
            blockerKind: "retrieval-evidence-base-unbound",
            blockerRef: asContractReference(composite.releaseRef),
          }),
        };
      }
      const members = compositeBinding.composite_member_release_refs as unknown as readonly {
        readonly reference: { readonly entityId: string; readonly versionId: string };
      }[];
      const memberResolution = await this.#governance.resolveGovernedReleases({
        projectId: command.projectId,
        requiredDefinitionTypes: ["standard-library", "case-library"],
        requiredAt,
        asOfRecordedAt,
        authorization: command.authorization,
      });
      if (memberResolution.kind !== "succeeded") return memberResolution;
      const compositeRead = await this.readExact({
        projectId: command.projectId,
        releaseRef: composite.releaseRef,
        actorId: command.actorId,
        requestedAt: command.issuedAt,
        authorization: command.authorization,
      });
      if (compositeRead.kind === "failed") return { kind: "failed", error: compositeRead.error };
      const compositePackage = compositeRead.read.package;
      if (compositePackage.definitionType !== "retrieval-evidence-base") {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: command.commandId,
            blockerKind: "retrieval-evidence-base-mismatch",
            blockerRef: asContractReference(composite.releaseRef),
          }),
        };
      }
      if (
        !versionedReferenceEquals(
          compositePackage.riskMechanismReleaseRef,
          riskMechanism.releaseRef as never,
        ) ||
        !memberResolution.result.releaseRefs.every((resolvedMember) =>
          members.some((member) => versionedReferenceEquals(member, resolvedMember as never)),
        )
      ) {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: command.commandId,
            blockerKind: "retrieval-evidence-base-mechanism-mismatch",
            blockerRef: asContractReference(composite.releaseRef),
          }),
        };
      }
      const policySetRef =
        this.#policySetProvider === undefined
          ? undefined
          : await this.#policySetProvider.resolveExact({
              projectId: command.projectId,
              preparationSnapshotRef: command.payload.preparationSnapshotRef,
              requiredAt,
              asOfRecordedAt,
              authorization: command.authorization,
            });
      if (policySetRef === undefined) {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: command.commandId,
            blockerKind: "identification-policy-set-unavailable",
            blockerRef: asContractReference(command.payload.preparationSnapshotRef),
          }),
        };
      }
      return {
        kind: "succeeded",
        result: {
          kind: "identification-basis",
          processModelReleaseRef: ProcessModelReleaseRefV1Schema.parse({
            kind: "process-model-release",
            reference: processModel.releaseRef.reference,
          }),
          riskMechanismReleaseRef: RiskMechanismReleaseRefV1Schema.parse({
            kind: "risk-mechanism-release",
            reference: riskMechanism.releaseRef.reference,
          }),
          retrievalEvidenceBaseReleaseRef: RetrievalEvidenceBaseReleaseRefV1Schema.parse({
            kind: "retrieval-evidence-base-release",
            reference: composite.releaseRef.reference,
          }),
          identificationPolicySetRef: policySetRef,
        },
      };
    } catch (error) {
      return { kind: "failed", error: await this.#mapError(error, command.commandId) };
    }
  }

  // --------------------------------------------------------------- C08 编制面

  /** 组合根用本方法构造 `knowledge-authoring` 的 C08 任务定义（动作、只读工具与收口裁缝）。 */
  createTaskDefinition() {
    const port: KnowledgeAuthoringTaskPortV1 = {
      readSegmentSlice: async (input, context) => await this.#readSegmentSliceTool(input, context),
      readExactKnowledge: async (input, context) =>
        await this.#readExactKnowledgeTool(input, context),
      validateAuthoringCandidate: async ({ task, candidate }) =>
        await this.#validateAuthoringCandidate(task, candidate),
      finalizeAuthoringCandidate: async ({ task, candidate }) =>
        await this.#finalizeAuthoringCandidate(task, candidate),
    };
    return createKnowledgeAuthoringTaskDefinition({ policy: this.#policy, port });
  }

  /** 冻结 manifest 工件后启动（或按同一身份重放）一次 C08 编制任务，并记录 attempt。 */
  async prepareOrReplayAuthoringTask(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly definitionType: IdentificationKnowledgeDefinitionTypeV1;
    readonly preparationSnapshotRef: unknown;
    readonly baseReleaseRef?: unknown;
    readonly parentRunRef: unknown;
    readonly commandId: string;
    readonly idempotencyKey: string;
  }): Promise<
    | {
        readonly kind: "succeeded";
        readonly agentTaskRef: AgentTaskRefV1;
        readonly manifestArtifactRef: ReturnType<typeof ContractCandidateArtifactRefV1Schema.parse>;
        readonly manifest: KnowledgeAuthoringManifestV1;
      }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  > {
    try {
      const authorized = await this.#verifyAuthorization(
        input.authorization,
        input.projectId,
        input.commandId,
        "knowledge-modeling.submit-revision",
      );
      const preparationSnapshotRef = IdentificationPreparationSnapshotRefV1Schema.parse(
        input.preparationSnapshotRef,
      );
      const preparation = await this.#preparationReader.readExactPreparation({
        projectId: input.projectId,
        preparationSnapshotRef,
        actorId: input.actorId,
        requestedAt: input.issuedAt,
        authorization: input.authorization,
      });
      if (preparation.kind === "failed") {
        return { kind: "failed", error: preparation.error };
      }
      const manifest = KnowledgeAuthoringManifestV1Schema.parse({
        schemaVersion: SCHEMA_VERSION,
        manifestId: `${input.commandId}:manifest`,
        projectId: input.projectId,
        targetDefinitionType: input.definitionType,
        preparationSnapshotRef,
        validationPolicyRef: this.#policy.policyRef,
        ...(input.baseReleaseRef === undefined
          ? {}
          : { baseReleaseRef: KnowledgeReleaseRefV1Schema.parse(input.baseReleaseRef) }),
        parentRunRef: input.parentRunRef,
        authorizationContextRef: authorized.authorizationContextRef,
        agent: {
          definitionRef: this.#policy.agent.definitionRef,
          modelDeploymentRef: this.#policy.agent.modelDeploymentRef,
          promptTemplateRef: this.#policy.agent.promptTemplateRef,
          toolPolicyRef: this.#policy.agent.toolPolicyRef,
          budgetPolicyRef: this.#policy.agent.budgetPolicyRef,
          incrementSchemaRef: this.#policy.agent.incrementSchemaRef,
          validationPolicyRef: this.#policy.agent.validationPolicyRef,
        },
        createdBy: input.actorId,
        createdAt: input.issuedAt,
      });
      const manifestArtifactRef = await this.#putArtifact(
        {
          projectId: input.projectId,
          actorId: input.actorId,
          issuedAt: input.issuedAt,
          authorization: input.authorization,
        },
        {
          artifactId: manifest.manifestId,
          purposeCode: MANIFEST_PURPOSE,
          value: manifest,
          parentArtifactRefs: [],
        },
      );
      const taskPort = this.#agentTaskPort;
      if (taskPort === undefined) {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: input.commandId,
            blockerKind: "agent-task-port-required",
            blockerRef: asContractReference(manifestArtifactRef),
          }),
        };
      }
      // C08 启动需要 `agent-task.start` 能力：由组合根的冻结收窄授权提供，而不是调用方的知识分支上下文。
      // 启动身份必须与调用方命令区分：C06 每个 invocationId 只对应一个分支。
      const startCommandId = `${input.commandId}:start-task`;
      const startAuthorization =
        (await this.#authoringAuthorization?.({
          projectId: input.projectId,
          invocationId: startCommandId,
          branch: "agent-task.start-task",
        })) ?? input.authorization;
      const started = await taskPort.startTask(
        StartAgentTaskCommandV1Schema.parse({
          commandId: startCommandId,
          idempotencyKey: `${input.idempotencyKey}:start-task`,
          projectId: input.projectId,
          actorId: input.actorId,
          issuedAt: input.issuedAt,
          authorization: startAuthorization,
          kind: "start-task",
          payload: {
            taskType: "knowledge-authoring",
            triggerMode: "embedded",
            parentRunRef: input.parentRunRef,
            frozenInputRef: manifestArtifactRef,
            modelDeploymentRef: manifest.agent.modelDeploymentRef,
            promptTemplateRef: manifest.agent.promptTemplateRef,
            toolPolicyRef: manifest.agent.toolPolicyRef,
            budgetPolicyRef: manifest.agent.budgetPolicyRef,
            incrementSchemaRef: manifest.agent.incrementSchemaRef,
            validationPolicyRef: manifest.agent.validationPolicyRef,
          },
        }),
      );
      if (started.kind === "failed") {
        return { kind: "failed", error: started.error };
      }
      if (started.kind !== "succeeded") {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            causalRunId: input.commandId,
            blockerKind: "agent-task-not-started",
            blockerRef: asContractReference(manifestArtifactRef),
          }),
        };
      }
      const agentTaskRef = (started.result as { agentTaskRef: AgentTaskRefV1 }).agentTaskRef;
      const attemptId = randomId("c17-attempt");
      const auditEntryId = randomId("audit");
      const recordedAt = nowIso(this.#now);
      const atomic = atomicCommand({
        projectId: input.projectId,
        actorId: input.actorId,
        issuedAt: input.issuedAt,
        authorization: input.authorization,
      })({
        commandKind: "knowledge.identification-knowledge.prepare-authoring.v1",
        // C03 回执按命令身份唯一：C08 启动已占用调用方命令，本地阶段使用稳定派生键。
        commandId: `${input.commandId}:attempt`,
        idempotencyKey: `${input.idempotencyKey}:attempt`,
        payload: { manifestArtifactRef, agentTaskRef },
      });
      await this.#transactionUnit.execute(atomic, async (context) => {
        const tx = asKnowledgeTransaction(context);
        await tx
          .insertInto("business.identification_knowledge_authoring_attempts")
          .values({
            attempt_id: attemptId,
            version_id: "1",
            schema_version: SCHEMA_VERSION,
            project_id: input.projectId,
            definition_type: input.definitionType,
            manifest_artifact_ref: jsonbValue(manifestArtifactRef),
            preparation_snapshot_ref: jsonbValue(preparationSnapshotRef),
            manifest_digest: sha256CanonicalJson(manifest),
            agent_task_ref: jsonbValue(agentTaskRef),
            stage: "task-started",
            result_revision_ref: null,
            failure_artifact_ref: null,
            review_task_ref: null,
            command_id: atomic.commandId,
            idempotency_key: atomic.idempotencyKey,
            actor_ref: atomic.actorRef,
            audit_entry_id: auditEntryId,
            occurred_at: new Date(input.issuedAt),
            recorded_at: new Date(recordedAt),
            persisted_at: new Date(recordedAt),
          } as never)
          .onConflict((conflict) => conflict.columns(["project_id", "idempotency_key"]).doNothing())
          .execute();
        return {
          resultRef: manifestArtifactRef,
          audit: auditFor({
            command: atomic,
            targetRef: manifestArtifactRef,
            action: "identification-knowledge.prepare-authoring",
            occurredAt: input.issuedAt,
            recordedAt,
            auditEntryId,
          }),
          events: [],
        } satisfies AtomicCommitV1;
      });
      return { kind: "succeeded", agentTaskRef, manifestArtifactRef, manifest };
    } catch (error) {
      return { kind: "failed", error: await this.#mapError(error, input.commandId) };
    }
  }

  async #readManifest(task: AgentTaskSnapshotV1): Promise<KnowledgeAuthoringManifestV1> {
    const frozen = task.envelope.frozenInputRef;
    return KnowledgeAuthoringManifestV1Schema.parse(
      await this.#readArtifact(
        task.envelope.authorization,
        ContractCandidateArtifactRefV1Schema.parse(frozen),
        MANIFEST_PURPOSE,
      ),
    );
  }

  async #readSegmentSliceTool(
    input: unknown,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1> {
    const request = KnowledgeAuthoringSegmentSliceRequestV1Schema.parse(input);
    const manifest = await this.#readManifest(context.task);
    const read = await this.#preparationReader.readSegmentSlice({
      projectId: manifest.projectId,
      preparationSnapshotRef: manifest.preparationSnapshotRef,
      sourceSegmentSetRef: request.sourceSegmentSetRef,
      segmentIds: request.sourceSegmentIds,
      limit: request.limit,
      actorId: context.task.envelope.actorId,
      requestedAt: context.task.envelope.createdAt,
      authorization: context.task.envelope.authorization,
    });
    if (read.kind === "failed") {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_TOOL_FAILURE",
          category: "tool",
          retryable: false,
          stage: "worker.knowledge-authoring.tool.segment-slice",
          taskRef: context.taskRef,
          actionId: context.actionId,
        }),
      );
    }
    const observationArtifactRef = await this.#putArtifact(
      {
        projectId: manifest.projectId,
        actorId: context.task.envelope.actorId,
        issuedAt: context.task.envelope.createdAt,
        authorization: context.task.envelope.authorization,
      },
      {
        artifactId: `${context.actionId}:segment-slice`,
        purposeCode: OBSERVATION_PURPOSE,
        value: read.observation,
        parentArtifactRefs: [],
      },
    );
    const segments =
      (read.observation as { readonly segments?: readonly unknown[] }).segments ?? [];
    return {
      observationArtifactRef,
      effect: "none",
      usage: { ...emptyAgentBudgetUsage(), objects: segments.length },
    };
  }

  async #readExactKnowledgeTool(
    input: unknown,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1> {
    const request = KnowledgeAuthoringBaselineReadRequestV1Schema.parse(input);
    const manifest = await this.#readManifest(context.task);
    const read = await this.readExact({
      projectId: manifest.projectId,
      releaseRef: request.releaseRef,
      actorId: context.task.envelope.actorId,
      requestedAt: context.task.envelope.createdAt,
      invocationId: `${context.actionId}:baseline-read`,
      authorization: context.task.envelope.authorization,
    });
    if (read.kind === "failed") {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_TOOL_FAILURE",
          category: "tool",
          retryable: false,
          stage: "worker.knowledge-authoring.tool.baseline-read",
          taskRef: context.taskRef,
          actionId: context.actionId,
        }),
      );
    }
    const observationArtifactRef = await this.#putArtifact(
      {
        projectId: manifest.projectId,
        actorId: context.task.envelope.actorId,
        issuedAt: context.task.envelope.createdAt,
        authorization: context.task.envelope.authorization,
      },
      {
        artifactId: `${context.actionId}:baseline-read`,
        purposeCode: OBSERVATION_PURPOSE,
        value: {
          definitionType: read.read.package.definitionType,
          packageDigest: identificationKnowledgePackageDigest(read.read.package),
          validationDisposition: read.read.validation.disposition,
        },
        parentArtifactRefs: [read.read.releaseBinding.candidateArtifactRef],
      },
    );
    return {
      observationArtifactRef,
      effect: "none",
      usage: { ...emptyAgentBudgetUsage(), objects: 1 },
    };
  }

  async #applyCandidate(
    task: AgentTaskSnapshotV1,
    candidate: unknown,
  ): Promise<
    | {
        readonly kind: "applied";
        readonly manifest: KnowledgeAuthoringManifestV1;
        readonly package: IdentificationKnowledgePackageV1;
        readonly packageDigest: string;
      }
    | {
        readonly kind: "rejected";
        readonly items: readonly unknown[];
        readonly rejectionClass: string;
      }
  > {
    const manifest = await this.#readManifest(task);
    const baseline =
      manifest.baseReleaseRef === undefined
        ? undefined
        : await this.#readBaselinePackage(manifest, task);
    const applied = applyKnowledgeAuthoringIncrement({
      projectId: manifest.projectId,
      preparationSnapshotRef: manifest.preparationSnapshotRef,
      baseline: baseline?.package,
      baselineDigest: baseline?.packageDigest,
      increment: candidate as never,
      generatedAt: nowIso(this.#now),
      policy: this.#policy,
    });
    if (applied.kind === "rejected") {
      return {
        kind: "rejected",
        items: applied.outcome.items,
        rejectionClass: applied.outcome.rejectionClass ?? "repairable",
      };
    }
    return {
      kind: "applied",
      manifest,
      package: applied.package,
      packageDigest: applied.packageDigest,
    };
  }

  async #readBaselinePackage(
    manifest: KnowledgeAuthoringManifestV1,
    task: AgentTaskSnapshotV1,
  ): Promise<
    | { readonly package: IdentificationKnowledgePackageV1; readonly packageDigest: string }
    | undefined
  > {
    if (manifest.baseReleaseRef === undefined) return undefined;
    const read = await this.readExact({
      projectId: manifest.projectId,
      releaseRef: manifest.baseReleaseRef,
      actorId: task.envelope.actorId,
      requestedAt: task.envelope.createdAt,
      invocationId: `${task.envelope.commandId}:baseline`,
      authorization: task.envelope.authorization,
    });
    if (read.kind === "failed") return undefined;
    return {
      package: read.read.package,
      packageDigest: identificationKnowledgePackageDigest(read.read.package),
    };
  }

  async #validateAuthoringCandidate(
    task: AgentTaskSnapshotV1,
    candidate: unknown,
  ): Promise<AgentValidationResultV1> {
    const applied = await this.#applyCandidate(task, candidate);
    const outcome =
      applied.kind === "rejected"
        ? {
            items: applied.items,
            disposition: "rejected" as const,
            rejectionClass: applied.rejectionClass as "repairable" | "terminal",
          }
        : await this.#validatePackage(task, applied.package);
    // C08 校验项只接受检查身份/处置/原因/证据；逐项目标以 checkId 后缀保留可定位性。
    const agentItems = (
      outcome.items as readonly {
        readonly checkId: string;
        readonly targetId?: string;
        readonly disposition: "accepted" | "rejected";
        readonly rejectionClass?: "repairable" | "terminal";
        readonly reasonCode: string;
        readonly evidenceReferences?: readonly unknown[];
      }[]
    ).map((item) => ({
      checkId: `${item.checkId}#${item.targetId ?? "package"}`,
      disposition: item.disposition,
      ...(item.rejectionClass === undefined ? {} : { rejectionClass: item.rejectionClass }),
      reasonCode: item.reasonCode,
      evidenceReferences: [...(item.evidenceReferences ?? [])],
    }));
    const validationArtifactRef = await this.#putArtifact(
      {
        projectId: task.envelope.projectId,
        actorId: task.envelope.actorId,
        issuedAt: task.envelope.createdAt,
        authorization: task.envelope.authorization,
      },
      {
        artifactId: `${task.envelope.commandId}:validation-${sha256CanonicalJson(candidate).slice(0, 16)}`,
        purposeCode: VALIDATION_PURPOSE,
        value: {
          schemaVersion: SCHEMA_VERSION,
          items: agentItems,
          disposition: outcome.disposition,
          ...(outcome.rejectionClass === undefined
            ? {}
            : { rejectionClass: outcome.rejectionClass }),
        },
        parentArtifactRefs: [],
      },
    );
    return AgentValidationResultV1Schema.parse({
      schemaVersion: SCHEMA_VERSION,
      items: agentItems,
      disposition: outcome.disposition,
      ...(outcome.rejectionClass === undefined ? {} : { rejectionClass: outcome.rejectionClass }),
      validationArtifactRef,
      validatedAt: nowIso(this.#now),
    });
  }

  async #validatePackage(
    task: AgentTaskSnapshotV1,
    packageValue: IdentificationKnowledgePackageV1,
  ) {
    return await validateIdentificationKnowledgePackage({
      value: packageValue,
      expectedDefinitionType: packageValue.definitionType,
      dependencies: {
        projectId: packageValue.projectId,
        policy: this.#policy,
        checkEvidence: async (input) => {
          const checked = await this.#preparationReader.checkEvidence({
            projectId: packageValue.projectId,
            preparationSnapshotRef: packageValue.preparationSnapshotRef,
            evidenceReferences: input.evidenceReferences,
            purposeCode: input.purposeCode,
            actorId: task.envelope.actorId,
            requestedAt: task.envelope.createdAt,
            authorization: task.envelope.authorization,
          });
          return checked.kind === "succeeded" ? checked.items : [];
        },
        resolveProcessModel: async (releaseRef) =>
          await this.#resolveProcessModelNodes(packageValue.projectId, releaseRef, {
            actorId: task.envelope.actorId,
            issuedAt: task.envelope.createdAt,
            authorization: task.envelope.authorization,
          }),
      },
    });
  }

  async #finalizeAuthoringCandidate(
    task: AgentTaskSnapshotV1,
    candidate: unknown,
  ): Promise<AgentTaskResultRefV1> {
    const applied = await this.#applyCandidate(task, candidate);
    if (applied.kind === "rejected") {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_VALIDATION_REJECTED",
          category: "validation",
          retryable: false,
          stage: "worker.knowledge-authoring.finalize.apply",
          taskRef: task.envelope.agentTaskRef,
          reasonCode: applied.rejectionClass,
        }),
      );
    }
    const outcome = await this.#validatePackage(task, applied.package);
    if (outcome.disposition !== "accepted") {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_VALIDATION_REJECTED",
          category: "validation",
          retryable: false,
          stage: "worker.knowledge-authoring.finalize.validate",
          taskRef: task.envelope.agentTaskRef,
          reasonCode: outcome.rejectionClass ?? "rejected",
        }),
      );
    }
    const candidateArtifactRef = await this.#putArtifact(
      {
        projectId: task.envelope.projectId,
        actorId: task.envelope.actorId,
        issuedAt: task.envelope.createdAt,
        authorization: task.envelope.authorization,
      },
      {
        artifactId: `${task.envelope.agentTaskRef.reference.entityId}:package-${applied.packageDigest.slice(0, 16)}`,
        purposeCode: CANDIDATE_PURPOSE,
        value: applied.package,
        parentArtifactRefs: [],
      },
    );
    const submitCommandId = `${task.envelope.agentTaskRef.reference.entityId}:submit`;
    const authorization =
      (await this.#authoringAuthorization?.({
        taskRef: task.envelope.agentTaskRef,
        projectId: task.envelope.projectId,
        invocationId: submitCommandId,
        branch: "knowledge-modeling.submit-revision",
      })) ?? task.envelope.authorization;
    const submitted = await this.#submitIdentificationRevision(
      KnowledgeGovernanceCommandV1Schema.parse({
        kind: "submit-revision",
        commandId: submitCommandId,
        idempotencyKey: submitCommandId,
        projectId: task.envelope.projectId,
        actorId: authorization.actorId,
        issuedAt: nowIso(this.#now),
        authorization,
        payload: {
          definitionType: applied.manifest.targetDefinitionType,
          candidateArtifactRef,
          evidenceReferences: [
            (applied.package as { nodes?: readonly { evidence: readonly unknown[] }[] }).nodes?.[0]
              ?.evidence?.[0] ?? {
              locator: { sourceSegmentId: "identification-knowledge-failure" },
              sourceVersion: { entityId: "identification-knowledge", versionId: "1" },
            },
          ],
        },
      }) as Extract<KnowledgeGovernanceCommandV1, { kind: "submit-revision" }>,
    );
    if (submitted.kind === "failed") {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_PERSISTENCE_FAILURE",
          category: "persistence",
          retryable: submitted.error.retryable,
          stage: "worker.knowledge-authoring.finalize.submit",
          taskRef: task.envelope.agentTaskRef,
          ...((submitted.error as { reasonCode?: string }).reasonCode === undefined
            ? {}
            : { reasonCode: (submitted.error as { reasonCode?: string }).reasonCode }),
        }),
      );
    }
    if (submitted.kind !== "succeeded") {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_PERSISTENCE_FAILURE",
          category: "persistence",
          retryable: true,
          stage: "worker.knowledge-authoring.finalize.submit",
          taskRef: task.envelope.agentTaskRef,
        }),
      );
    }
    if (submitted.result.kind !== "revision") {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_PERSISTENCE_FAILURE",
          category: "persistence",
          retryable: false,
          stage: "worker.knowledge-authoring.finalize.submit",
          taskRef: task.envelope.agentTaskRef,
        }),
      );
    }
    // C08 完成结果要求 validation-snapshot 校验引用，而不是候选工件引用。
    return buildCompletedAgentTaskResult(
      task.envelope.agentTaskRef,
      asContractReference(submitted.result.knowledgeRevisionRef),
      asContractReference({
        kind: "validation-snapshot",
        reference: { entityId: `${submitCommandId}:validation`, versionId: "1" },
      }),
      ["knowledge-revision"],
    );
  }

  /** D-09 失败收口：只扫描 C17 未收口的编制尝试，再按 C08 存储读取精确任务状态。 */
  async settleAuthoringFailures(): Promise<number> {
    const store = this.#agentTaskStore;
    if (store === undefined) return 0;
    const rows = await this.#db
      .selectFrom("business.identification_knowledge_authoring_attempts")
      .selectAll()
      .where("stage", "in", ["prepared", "task-started"])
      .execute();
    let settled = 0;
    console.error("C17_SETTLE_SCAN", rows.length, store === undefined ? "no-store" : "store");
    for (const row of rows) {
      const taskRef = row.agent_task_ref as unknown as AgentTaskRefV1;
      const task = await store.getTask(taskRef);
      if (task === undefined) continue;
      const status = task.state.status;
      console.error("C17_SETTLE_STATUS", status);
      if (status !== "terminal-failure" && status !== "cancelled") continue;
      try {
        await this.#settleOneFailure(row, task, taskRef);
        settled += 1;
      } catch {
        continue;
      }
    }
    return settled;
  }

  async #settleOneFailure(
    row: AuthoringAttemptRow,
    task: AgentTaskSnapshotV1,
    taskRef: AgentTaskRefV1,
  ): Promise<void> {
    const failureArtifactRef = await this.#putArtifact(
      {
        projectId: row.project_id,
        actorId: task.envelope.actorId,
        issuedAt: nowIso(this.#now),
        authorization: task.envelope.authorization,
      },
      {
        artifactId: `${taskRef.reference.entityId}:failure`,
        purposeCode: FAILURE_PURPOSE,
        value: KnowledgeAuthoringFailureV1Schema.parse({
          schemaVersion: SCHEMA_VERSION,
          projectId: row.project_id,
          targetDefinitionType: row.definition_type,
          preparationSnapshotRef: row.preparation_snapshot_ref,
          manifestArtifactRef: row.manifest_artifact_ref,
          taskRef,
          terminalStatus: task.state.status,
          errorCodes: [
            (task.state as { lastError?: { code?: string } }).lastError?.code ?? "AGENT_CANCELLED",
          ],
          actionRefs: [],
          candidateRefs: [],
          validationRefs: [],
          usage: emptyAgentBudgetUsage(),
          diagnosticArtifactRef: {
            kind: "diagnostic-artifact",
            reference: {
              entityId: `identification-knowledge-failure-${taskRef.reference.entityId}`,
              versionId: `sha256:${sha256CanonicalJson({ taskRef })}`,
            },
          },
          occurredAt: nowIso(this.#now),
          recordedAt: nowIso(this.#now),
        }),
        parentArtifactRefs: [],
      },
    );
    const failureCommandId = `${taskRef.reference.entityId}:failure-revision`;
    const authorization =
      (await this.#authoringAuthorization?.({
        taskRef,
        projectId: row.project_id,
        invocationId: failureCommandId,
        branch: "knowledge-modeling.submit-revision",
      })) ?? task.envelope.authorization;
    const failureCommand: KnowledgeGovernanceCommandV1 = KnowledgeGovernanceCommandV1Schema.parse({
      kind: "submit-revision",
      commandId: failureCommandId,
      idempotencyKey: failureCommandId,
      projectId: row.project_id,
      actorId: authorization.actorId,
      issuedAt: nowIso(this.#now),
      authorization,
      payload: {
        definitionType: row.definition_type,
        candidateArtifactRef: failureArtifactRef,
        evidenceReferences: [
          {
            locator: { sourceSegmentId: "identification-knowledge-failure-diagnostic" },
            sourceVersion: { entityId: "identification-knowledge", versionId: "1" },
          },
        ],
      },
    });
    const submitted = await this.#governance.govern(failureCommand);
    if (submitted.kind !== "succeeded" || submitted.result.kind !== "revision") return;
    const revisionRef = submitted.result.knowledgeRevisionRef;
    const bindingAuditId = randomId("audit");
    const bindingAtomic = atomicCommand({
      projectId: row.project_id,
      actorId: task.envelope.actorId,
      issuedAt: nowIso(this.#now),
      authorization,
    })({
      commandKind: "knowledge.identification-knowledge.bind-failure-revision.v1",
      commandId: `${taskRef.reference.entityId}:bind-failure-revision`,
      idempotencyKey: `${taskRef.reference.entityId}:bind-failure-revision`,
      payload: { revisionRef },
    });
    await this.#transactionUnit.execute(bindingAtomic, async (context) => {
      const tx = asKnowledgeTransaction(context);
      await tx
        .insertInto("business.identification_knowledge_revision_bindings")
        .values({
          revision_id: revisionRef.reference.entityId,
          revision_version_id: revisionRef.reference.versionId,
          schema_version: SCHEMA_VERSION,
          project_id: row.project_id,
          definition_type: row.definition_type,
          binding_kind: "failure-review-only",
          validation_id: null,
          validation_version_id: null,
          package_digest: null,
          agent_task_ref: jsonbValue(taskRef),
          failure_artifact_ref: jsonbValue(failureArtifactRef),
          command_id: bindingAtomic.commandId,
          idempotency_key: bindingAtomic.idempotencyKey,
          actor_ref: bindingAtomic.actorRef,
          audit_entry_id: bindingAuditId,
          occurred_at: new Date(nowIso(this.#now)),
          recorded_at: new Date(nowIso(this.#now)),
          persisted_at: new Date(nowIso(this.#now)),
        } as never)
        .onConflict((conflict) => conflict.columns(["project_id", "idempotency_key"]).doNothing())
        .execute();
      return {
        resultRef: asContractReference(revisionRef),
        audit: auditFor({
          command: bindingAtomic,
          targetRef: asContractReference(revisionRef),
          action: "identification-knowledge.bind-failure-revision",
          occurredAt: bindingAtomic.issuedAt ?? nowIso(this.#now),
          recordedAt: nowIso(this.#now),
          auditEntryId: bindingAuditId,
        }),
        events: [],
      } satisfies AtomicCommitV1;
    });
    const reviewCommandId = `${taskRef.reference.entityId}:failure-review`;
    const reviewAuthorization =
      (await this.#authoringAuthorization?.({
        taskRef,
        projectId: row.project_id,
        invocationId: reviewCommandId,
        // C16 复核分支（C07 的评审请求由 C16 内部按其自身接缝签发）。
        branch: "knowledge-modeling.request-review",
      })) ?? authorization;
    const review = await this.#requestFailureReview(
      row,
      revisionRef,
      reviewCommandId,
      reviewAuthorization,
    );
    if (review === undefined) return;
    await this.#db
      .updateTable("business.identification_knowledge_authoring_attempts")
      .set({
        stage: "review-linked",
        failure_artifact_ref: jsonbValue(failureArtifactRef),
        review_task_ref: jsonbValue(review),
        persisted_at: new Date(nowIso(this.#now)),
      } as never)
      .where("project_id", "=", row.project_id)
      .where("attempt_id", "=", row.attempt_id)
      .where("stage", "in", ["prepared", "task-started"])
      .execute();
  }

  /** D-09：失败修订由 C16 转 C07 复核，绑定 failure-review-only 永不可发布。 */
  async #requestFailureReview(
    row: AuthoringAttemptRow,
    revisionRef: { readonly reference: { readonly entityId: string; readonly versionId: string } },
    commandId: string,
    authorization: AuthorizationContextV1,
  ): Promise<ReviewTaskRefV1 | undefined> {
    const reviewCommand = KnowledgeGovernanceCommandV1Schema.parse({
      kind: "request-review",
      commandId,
      idempotencyKey: commandId,
      projectId: row.project_id,
      actorId: authorization.actorId,
      issuedAt: nowIso(this.#now),
      authorization,
      payload: {
        revisionRef: asContractReference(revisionRef),
        reviewPolicyRef: { entityId: "identification-knowledge-failure-review", versionId: "1" },
      },
    }) as Extract<KnowledgeGovernanceCommandV1, { kind: "request-review" }>;
    const requested = await this.#governance.govern(reviewCommand);
    if (requested.kind !== "succeeded" || requested.result.kind !== "review-task") {
      return undefined;
    }
    return requested.result.reviewTaskRef;
  }

  // ------------------------------------------------------------------- helpers

  async #verifyAuthorization(
    authorization: AuthorizationContextV1,
    projectId: string,
    invocationId: string,
    branch: ModuleBranchV1,
  ): Promise<AuthorizationContextV1> {
    const decision = await this.#access.verify({
      authorizationContextRef: authorization.authorizationContextRef,
      invocationId,
      projectId,
      branch,
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      requestedAt: authorization.decidedAt,
    });
    return decision.context;
  }

  async #findValidation(
    projectId: string,
    validationId: string | null,
    versionId: string | null,
  ): Promise<ValidationRowSelect | undefined> {
    if (validationId === null || versionId === null) return undefined;
    return await this.#db
      .selectFrom("business.identification_knowledge_validations")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("validation_id", "=", validationId)
      .where("version_id", "=", versionId)
      .executeTakeFirst();
  }

  async #findRevisionBinding(
    projectId: string,
    revisionId: string,
    versionId: string,
  ): Promise<RevisionBindingRow | undefined> {
    return await this.#db
      .selectFrom("business.identification_knowledge_revision_bindings")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("revision_id", "=", revisionId)
      .where("revision_version_id", "=", versionId)
      .executeTakeFirst();
  }

  async #findRevisionBindingByRef(
    projectId: string,
    revisionRef: { readonly reference: { readonly entityId: string; readonly versionId: string } },
  ): Promise<RevisionBindingRow | undefined> {
    return await this.#findRevisionBinding(
      projectId,
      revisionRef.reference.entityId,
      revisionRef.reference.versionId,
    );
  }

  async #findReleaseBindingByRef(
    projectId: string,
    releaseRef: { readonly reference: { readonly entityId: string; readonly versionId: string } },
  ): Promise<ReleaseBindingRow | undefined> {
    return await this.#db
      .selectFrom("business.identification_knowledge_release_bindings")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("release_id", "=", releaseRef.reference.entityId)
      .where("release_version_id", "=", releaseRef.reference.versionId)
      .executeTakeFirst();
  }

  async #putArtifact(
    command: {
      readonly projectId: string;
      readonly actorId: string;
      readonly issuedAt: string;
      readonly authorization: AuthorizationContextV1;
    },
    spec: {
      readonly artifactId: string;
      readonly purposeCode: string;
      readonly value: unknown;
      readonly parentArtifactRefs: readonly {
        readonly kind: string;
        readonly reference: { readonly entityId: string; readonly versionId: string };
      }[];
    },
  ): Promise<ReturnType<typeof ContractCandidateArtifactRefV1Schema.parse>> {
    const bytes = new TextEncoder().encode(JSON.stringify(spec.value));
    const result = await this.#artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: SCHEMA_VERSION,
        commandId: `${spec.artifactId}:put`,
        idempotencyKey: `${spec.artifactId}:put`,
        projectId: command.projectId,
        actorId: command.actorId,
        issuedAt: command.issuedAt,
        authorization: command.authorization,
        requiredCapability: command.authorization.grantedCapabilities[0],
        artifactId: spec.artifactId,
        artifactKind: "content",
        purposeCode: spec.purposeCode,
        mediaType: "application/json",
        parentArtifactRefs: [...spec.parentArtifactRefs].sort((left, right) =>
          refKey(left) < refKey(right) ? -1 : 1,
        ),
        evidenceReferences: [],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      }),
      one(bytes),
    );
    return ContractCandidateArtifactRefV1Schema.parse(result.artifactRef);
  }

  async #readArtifact(
    authorization: AuthorizationContextV1,
    artifactRef: ReturnType<typeof ContractCandidateArtifactRefV1Schema.parse>,
    purposeCode: string,
  ): Promise<unknown> {
    // 读取不是幂等业务动作：每次使用新的访问身份，避免同一工件的重复读取互相冲突。
    const readId = randomId("c17-read");
    const handle: ArtifactReadHandleV1 = await this.#artifactStore.open(
      ArtifactReadRequestV1Schema.parse({
        schemaVersion: SCHEMA_VERSION,
        requestId: readId,
        idempotencyKey: readId,
        artifactRef,
        projectId: authorization.projectId,
        actorId: authorization.actorId,
        requestedAt: authorization.decidedAt,
        purposeCode,
        requiredCapability: authorization.grantedCapabilities[0],
        authorization,
      }),
    );
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of handle.content) {
      size += chunk.byteLength;
      if (size > MAX_PACKAGE_BYTES) throw new RangeError("artifact exceeds the bounded read limit");
      chunks.push(chunk);
    }
    await handle.verified;
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
  }

  async #mapError(error: unknown, causalRunId: string): Promise<ModuleErrorV1> {
    if (error instanceof AccessServiceError) {
      return moduleError({
        code:
          error.details.code === "IDEMPOTENCY_CONFLICT"
            ? "STALE_VERSION"
            : error.details.code === "AUTHORIZATION_DENIED"
              ? "AUTHORIZATION_DENIED"
              : "TERMINAL_FAILURE",
        branch: "knowledge-modeling.submit-revision",
        causalRunId,
      } as never);
    }
    const code = (error as { code?: string } | undefined)?.code;
    if (code === "ARTIFACT_ACCESS_DENIED") {
      return moduleError({
        code: "AUTHORIZATION_DENIED",
        branch: "knowledge-modeling.submit-revision",
        causalRunId,
      });
    }
    if (code === "ARTIFACT_NOT_FOUND") {
      return moduleError({
        code: "ENTITY_NOT_FOUND",
        causalRunId,
        targetRef: asContractReference({
          kind: "content-artifact",
          reference: { entityId: "unknown-artifact", versionId: "1" },
        }),
      });
    }
    return moduleError({ code: "TERMINAL_FAILURE", causalRunId });
  }
}

export const createPostgresIdentificationKnowledgeAdapter = (
  options: PostgresIdentificationKnowledgeAdapterOptionsV1,
): PostgresIdentificationKnowledgeAdapter => new PostgresIdentificationKnowledgeAdapter(options);
