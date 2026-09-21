import { sql, type Kysely, type Transaction } from "kysely";

import {
  RetrievalActivationV1Schema,
  RetrievalGenerationRefV1Schema,
  RetrievalGenerationTransitionV1Schema,
  RetrievalGenerationV1Schema,
  assertGenerationTransition,
  type RetrievalActivationV1,
  type RetrievalEvidenceBaseReleaseRefV1,
  type RetrievalGenerationRefV1,
  type RetrievalGenerationStatusV1,
  type RetrievalGenerationStoreV1,
  type RetrievalGenerationTransitionV1,
  type RetrievalGenerationV1,
  type Sha256V1,
} from "@riskflow/core/retrieval";
import type {
  AtomicCommandV1,
  AtomicCommitReceiptV1,
  AtomicCommitV1,
  AuditAppendV1,
  JsonValue,
  TransactionContextV1,
  TransactionOptionsV1,
  TransactionUnitV1,
} from "@riskflow/core/persistence";
import {
  AuthorizationContextRefV1Schema,
  KnowledgeQueryResultRefV1Schema,
  type AuthorizationContextRefV1,
  type ContractReferenceV1,
  type KnowledgeQueryResultRefV1,
} from "@riskflow/contracts/ports";
import { ArtifactRefV1Schema, type ArtifactRefV1 } from "@riskflow/core/artifacts";

import { mapPostgresError, makePersistenceError } from "../postgres/pool.js";
import { getPostgresTransaction } from "../postgres/transaction-unit.js";
import type { PostgresDatabase } from "../postgres/types.js";

const MAX_SERIALIZATION_ATTEMPTS_V1 = 3;

/**
 * 状态序号由适配器与投影 handler 共同冻结：1=building、2=ready、9000=failed 由投影侧写入，
 * 激活链路独占 3=active、4=superseded，因此“最新状态 = 最大序号”始终可判定。
 */
const RETRIEVAL_ACTIVATION_ORDINAL_V1 = { active: 3, superseded: 4 } as const;

interface GenerationRow {
  generation_id: string;
  generation_version_id: string;
  schema_version: string;
  project_id: string;
  source_event_id: string;
  evidence_base_release_entity_id: string;
  evidence_base_release_version_id: string;
  risk_mechanism_release_entity_id: string;
  risk_mechanism_release_version_id: string;
  standard_library_release_entity_id: string;
  standard_library_release_version_id: string;
  case_library_release_entity_id: string;
  case_library_release_version_id: string;
  policy_entity_id: string;
  policy_version_id: string;
  model_deployment_entity_id: string;
  model_deployment_version_id: string;
  projection_compatibility_entity_id: string;
  projection_compatibility_version_id: string;
  authorization_scope_digest: string;
  expected_member_count: number;
  manifest_sha256: string;
  collection_name: string;
  created_by: string;
  authorization_context_ref: JsonValue;
  created_at: Date | string;
  persisted_at: Date | string;
  audit_entry_id: string;
}

interface TransitionRow {
  project_id: string;
  generation_id: string;
  generation_version_id: string;
  ordinal: number;
  status: RetrievalGenerationStatusV1;
  manifest_sha256: string | null;
  failure_code: string | null;
  note_code: string | null;
  transition_ref: JsonValue;
  actor_ref: string;
  authorization_context_ref: JsonValue;
  context_refs: JsonValue;
  occurred_at: Date | string;
  persisted_at: Date | string;
  audit_entry_id: string;
}

interface ActivationRow {
  project_id: string;
  evidence_base_release_entity_id: string;
  evidence_base_release_version_id: string;
  activation_ordinal: number;
  generation_id: string;
  generation_version_id: string;
  previous_generation_id: string | null;
  previous_generation_version_id: string | null;
  policy_entity_id: string;
  policy_version_id: string;
  authorization_scope_digest: string;
  actor_ref: string;
  authorization_context_ref: JsonValue;
  context_refs: JsonValue;
  activated_at: Date | string;
  persisted_at: Date | string;
  audit_entry_id: string;
}

interface QueryResultRow {
  project_id: string;
  query_id: string;
  request_digest: string;
  generation_id: string;
  generation_version_id: string;
  policy_entity_id: string;
  policy_version_id: string;
  authorization_scope_digest: string;
  result_artifact_ref: JsonValue;
  knowledge_query_result_ref: JsonValue;
  actor_ref: string;
  authorization_context_ref: JsonValue;
  recorded_at: Date | string;
  persisted_at: Date | string;
  audit_entry_id: string;
}

interface RetrievalDatabase {
  "business.retrieval_generations": GenerationRow;
  "business.retrieval_generation_transitions": TransitionRow;
  "business.retrieval_activations": ActivationRow;
  "business.retrieval_query_results": QueryResultRow;
}

/** 局部交集扩展 Kysely 类型，不改动 C03 公共 `PostgresDatabase` 定义。 */
type RetrievalDatabaseV1 = PostgresDatabase & RetrievalDatabase;
/** 只读路径：`Transaction` 继承 `Kysely`，两者都能直接执行 select。 */
type RetrievalQueryExecutorV1 = Kysely<RetrievalDatabaseV1>;
type RetrievalTransactionV1 = Transaction<RetrievalDatabaseV1>;

/**
 * 写入作用域。`appendAuditRow` 只在调用方已持有 C03 事务时为真：此时审计行必须落在
 * 同一个 ambient 事务里（ready/激活/替换/审计/消费者回执同事务提交）；自开事务路径由
 * C03 事务单元统一追加审计，避免同一事实出现两条审计。
 */
interface RetrievalWriteScopeV1 {
  readonly transaction: RetrievalTransactionV1;
  readonly appendAuditRow: boolean;
}

export interface PostgresRetrievalAdapterOptionsV1 {
  /** 传 `runtime.db` 即可；类型为 `Kysely<PostgresDatabase & RetrievalDatabase>`。 */
  readonly db: unknown;
  readonly transactionUnit: TransactionUnitV1;
  readonly now?: () => Date;
}

const asRetrievalTransaction = (context: TransactionContextV1): RetrievalTransactionV1 =>
  getPostgresTransaction(context) as unknown as RetrievalTransactionV1;

/** jsonb 列以文本形式写入，避免驱动二次编码。 */
const jsonValue = (value: unknown): JsonValue => JSON.stringify(value) as unknown as JsonValue;

const nowIso = (clock: () => Date): string => {
  const value = clock();
  if (!Number.isFinite(value.getTime())) throw new TypeError("clock returned an invalid date");
  return value.toISOString();
};

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const versionedRef = <const T extends string>(
  kind: T,
  entityId: string,
  versionId: string,
): {
  readonly kind: T;
  readonly reference: { readonly entityId: string; readonly versionId: string };
} => ({
  kind,
  reference: { entityId, versionId },
});

const sameRef = (
  left: { readonly entityId: string; readonly versionId: string },
  right: { readonly entityId: string; readonly versionId: string },
): boolean => left.entityId === right.entityId && left.versionId === right.versionId;

const generationRowRef = (row: {
  readonly generation_id: string;
  readonly generation_version_id: string;
}): RetrievalGenerationRefV1 =>
  RetrievalGenerationRefV1Schema.parse(
    versionedRef("retrieval-generation", row.generation_id, row.generation_version_id),
  );

const generationFromRow = (row: GenerationRow): RetrievalGenerationV1 =>
  RetrievalGenerationV1Schema.parse({
    schemaVersion: row.schema_version,
    generationRef: generationRowRef(row),
    identity: {
      projectId: row.project_id,
      sourceEventId: row.source_event_id,
      evidenceBaseReleaseRef: versionedRef(
        "retrieval-evidence-base-release",
        row.evidence_base_release_entity_id,
        row.evidence_base_release_version_id,
      ),
      memberReleaseRefs: {
        riskMechanismRef: versionedRef(
          "knowledge-release",
          row.risk_mechanism_release_entity_id,
          row.risk_mechanism_release_version_id,
        ),
        standardLibraryRef: versionedRef(
          "knowledge-release",
          row.standard_library_release_entity_id,
          row.standard_library_release_version_id,
        ),
        caseLibraryRef: versionedRef(
          "knowledge-release",
          row.case_library_release_entity_id,
          row.case_library_release_version_id,
        ),
      },
      policyRef: { entityId: row.policy_entity_id, versionId: row.policy_version_id },
      modelDeploymentRef: {
        entityId: row.model_deployment_entity_id,
        versionId: row.model_deployment_version_id,
      },
      projectionCompatibilityRef: {
        entityId: row.projection_compatibility_entity_id,
        versionId: row.projection_compatibility_version_id,
      },
    },
    collectionName: row.collection_name,
    authorizationScopeDigest: row.authorization_scope_digest,
    expectedMemberCount: row.expected_member_count,
    manifestSha256: row.manifest_sha256,
    createdAt: asIso(row.created_at),
    createdBy: row.created_by,
    authorizationContextRef: AuthorizationContextRefV1Schema.parse(row.authorization_context_ref),
  });

const activationFromRow = (row: ActivationRow): RetrievalActivationV1 =>
  RetrievalActivationV1Schema.parse({
    schemaVersion: "1",
    generationRef: generationRowRef(row),
    projectId: row.project_id,
    evidenceBaseReleaseRef: versionedRef(
      "retrieval-evidence-base-release",
      row.evidence_base_release_entity_id,
      row.evidence_base_release_version_id,
    ),
    policyRef: { entityId: row.policy_entity_id, versionId: row.policy_version_id },
    authorizationScopeDigest: row.authorization_scope_digest,
    activationOrdinal: row.activation_ordinal,
    ...(row.previous_generation_id === null || row.previous_generation_version_id === null
      ? {}
      : {
          previousGenerationRef: versionedRef(
            "retrieval-generation",
            row.previous_generation_id,
            row.previous_generation_version_id,
          ),
        }),
    activatedAt: asIso(row.activated_at),
    actorRef: row.actor_ref,
    authorizationContextRef: AuthorizationContextRefV1Schema.parse(row.authorization_context_ref),
  });

/**
 * 审计目标必须落在公共引用联合内；代际/成员引用是 C20 局部类型，因此审计一律以
 * 发布或查询结果引用为目标，并以 `version` 记录其版本。
 */
const auditFor = (input: {
  readonly auditEntryId: string;
  readonly projectId: string;
  readonly action: string;
  readonly targetRef: ContractReferenceV1;
  readonly actorRef: string;
  readonly authorizationContextRef: AuthorizationContextRefV1;
  readonly occurredAt: string;
  readonly recordedAt: string;
}): AuditAppendV1 => ({
  auditEntryId: input.auditEntryId,
  projectId: input.projectId,
  action: input.action,
  targetRef: input.targetRef,
  actorRef: input.actorRef,
  authorizationContextRef: input.authorizationContextRef,
  occurredAt: input.occurredAt,
  recordedAt: input.recordedAt,
  version:
    "reference" in input.targetRef
      ? input.targetRef.reference
      : { entityId: input.targetRef.eventId, versionId: String(input.targetRef.eventVersion) },
});

const commandFor = (input: {
  readonly projectId: string;
  readonly commandKind: string;
  readonly stableKey: string;
  readonly payload: object;
  readonly actorRef: string;
  readonly authorizationContextRef: AtomicCommandV1["authorizationContextRef"];
  readonly issuedAt: string;
}): AtomicCommandV1 => ({
  projectId: input.projectId,
  commandKind: input.commandKind,
  commandId: `retrieval:${input.stableKey}`,
  idempotencyKey: `retrieval:${input.stableKey}`,
  payload: JSON.parse(JSON.stringify(input.payload)) as Record<string, JsonValue>,
  actorRef: input.actorRef,
  authorizationContextRef: input.authorizationContextRef,
  issuedAt: input.issuedAt,
});

const auditEntryIdFor = (operation: string, stableKey: string): string =>
  `retrieval-audit:${operation}:${stableKey}`;

/** 重复序号只允许内容完全相同的重放：jsonb 键序不保证，因此逐字段比较而非整对象比较。 */
const sameTransition = (row: TransitionRow, transition: RetrievalGenerationTransitionV1): boolean =>
  row.ordinal === transition.ordinal &&
  row.status === transition.status &&
  row.manifest_sha256 === (transition.manifestSha256 ?? null) &&
  row.failure_code === (transition.failureCode ?? null) &&
  row.note_code === (transition.noteCode ?? null) &&
  refLikeOf(row) === refLikeOf(transition.transitionRef);

const refLikeOf = (value: unknown): string => {
  const ref = value as {
    readonly kind?: unknown;
    readonly reference?: { readonly entityId?: unknown; readonly versionId?: unknown };
  };
  return `${String(ref.kind)}:${String(ref.reference?.entityId)}:${String(ref.reference?.versionId)}`;
};

/**
 * C20 检索事实适配器（design D5/D8）：代际身份与状态只追加，激活按
 * compare-and-swap 追加，查询结果按 `{projectId, queryId}` 幂等登记。
 * 传入 `context` 时必须复用该 ambient 事务，使 ready/激活/替换/审计/消费者回执同事务提交；
 * 未传时以 C03 `TransactionUnitV1` 自开事务并追加审计。
 */
export class PostgresRetrievalAdapter implements RetrievalGenerationStoreV1 {
  readonly #db: RetrievalQueryExecutorV1;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #now: () => Date;

  constructor(options: PostgresRetrievalAdapterOptionsV1) {
    this.#db = options.db as unknown as RetrievalQueryExecutorV1;
    this.#transactionUnit = options.transactionUnit;
    this.#now = options.now ?? (() => new Date());
  }

  // -------------------------------------------------------------- 代际事实

  async ensureBuildingGeneration(input: {
    readonly generation: RetrievalGenerationV1;
    readonly transitionRef: RetrievalGenerationTransitionV1["transitionRef"];
    readonly actorRef: string;
    readonly authorizationContextRef: AuthorizationContextRefV1;
    readonly occurredAt: string;
    readonly context?: TransactionContextV1;
  }): Promise<{
    readonly generation: RetrievalGenerationV1;
    readonly created: boolean;
    readonly status: string;
  }> {
    const generation = RetrievalGenerationV1Schema.parse(input.generation);
    // building 是代际唯一合法首状态，必须先过核心状态机再落库。
    const building = RetrievalGenerationTransitionV1Schema.parse({
      schemaVersion: "1",
      transitionRef: input.transitionRef,
      generationRef: generation.generationRef,
      ordinal: 1,
      status: "building",
      occurredAt: input.occurredAt,
    });
    const stableKey = `${generation.identity.projectId}:${generation.generationRef.reference.versionId}`;
    const auditEntryId = auditEntryIdFor("generation-ensure", stableKey);
    const body = (scope: RetrievalWriteScopeV1) =>
      this.#ensureBuildingGenerationInScope(
        scope,
        generation,
        building,
        input.actorRef,
        auditEntryId,
      );

    if (input.context !== undefined) {
      const { value } = await body({
        transaction: asRetrievalTransaction(input.context),
        appendAuditRow: true,
      });
      return value;
    }
    let outcome:
      { generation: RetrievalGenerationV1; created: boolean; status: string } | undefined;
    const receipt = await this.#executeWithRetry(
      commandFor({
        projectId: generation.identity.projectId,
        commandKind: "retrieval.generation-ensure",
        stableKey: `generation-ensure:${stableKey}`,
        payload: {
          generationRef: generation.generationRef,
          identity: generation.identity,
          collectionName: generation.collectionName,
          manifestSha256: generation.manifestSha256,
          authorizationScopeDigest: generation.authorizationScopeDigest,
          expectedMemberCount: generation.expectedMemberCount,
          transitionRef: building.transitionRef,
        },
        actorRef: input.actorRef,
        authorizationContextRef: input.authorizationContextRef,
        issuedAt: input.occurredAt,
      }),
      async (context) => {
        const handled = await body({
          transaction: asRetrievalTransaction(context),
          appendAuditRow: false,
        });
        outcome = handled.value;
        return {
          resultRef: generation.identity.evidenceBaseReleaseRef,
          audit: handled.audit,
          events: [],
        };
      },
    );
    // C03 命令回执命中时 handler 不再执行：按同一形状从已提交事实重建返回。
    if (receipt.replayed || outcome === undefined) return this.#readEnsuredGeneration(generation);
    return outcome;
  }

  async appendTransition(input: {
    readonly transition: RetrievalGenerationTransitionV1;
    readonly actorRef: string;
    readonly authorizationContextRef: AuthorizationContextRefV1;
    readonly contextRefs: readonly ContractReferenceV1[];
    readonly context?: TransactionContextV1;
  }): Promise<void> {
    const transition = RetrievalGenerationTransitionV1Schema.parse(input.transition);
    const stableKey = `${transition.generationRef.reference.entityId}:${transition.generationRef.reference.versionId}:${transition.ordinal}`;
    const auditEntryId = auditEntryIdFor("generation-transition", stableKey);
    const request = {
      actorRef: input.actorRef,
      authorizationContextRef: input.authorizationContextRef,
      contextRefs: input.contextRefs,
    };
    if (input.context !== undefined) {
      await this.#appendTransitionInScope(
        { transaction: asRetrievalTransaction(input.context), appendAuditRow: true },
        transition,
        request,
        auditEntryId,
      );
      return;
    }
    // 自开事务的命令身份需要工程，代际不存在时在任何写入之前失败。
    const generation = await this.#requireCommittedGeneration(transition.generationRef);
    await this.#executeWithRetry(
      commandFor({
        projectId: generation.project_id,
        commandKind: "retrieval.generation-transition",
        stableKey: `generation-transition:${stableKey}`,
        payload: {
          transitionRef: transition.transitionRef,
          generationRef: transition.generationRef,
          ordinal: transition.ordinal,
          status: transition.status,
          ...(transition.manifestSha256 === undefined
            ? {}
            : { manifestSha256: transition.manifestSha256 }),
          ...(transition.failureCode === undefined ? {} : { failureCode: transition.failureCode }),
          ...(transition.noteCode === undefined ? {} : { noteCode: transition.noteCode }),
        },
        actorRef: input.actorRef,
        authorizationContextRef: input.authorizationContextRef,
        issuedAt: transition.occurredAt,
      }),
      async (context) => {
        const handled = await this.#appendTransitionInScope(
          { transaction: asRetrievalTransaction(context), appendAuditRow: false },
          transition,
          request,
          auditEntryId,
        );
        return {
          resultRef: input.contextRefs[0] ?? input.authorizationContextRef,
          audit: handled.audit,
          events: [],
        };
      },
    );
  }

  async activateGeneration(input: {
    readonly activation: RetrievalActivationV1;
    readonly contextRefs: readonly ContractReferenceV1[];
    readonly context?: TransactionContextV1;
  }): Promise<{ readonly kind: "activated" } | { readonly kind: "activation-conflict" }> {
    const activation = RetrievalActivationV1Schema.parse(input.activation);
    const stableKey = [
      activation.projectId,
      activation.evidenceBaseReleaseRef.reference.entityId,
      activation.evidenceBaseReleaseRef.reference.versionId,
      activation.generationRef.reference.versionId,
      String(activation.activationOrdinal),
    ].join(":");
    // 身份带激活时刻：重试同一意图命中回执幂等，而失败尝试不会把同一意图永久锁死为冲突。
    const auditEntryId = auditEntryIdFor(
      "generation-activate",
      `${stableKey}:${activation.activatedAt}`,
    );
    const body = (scope: RetrievalWriteScopeV1) =>
      this.#activateGenerationInScope(scope, activation, input.contextRefs, auditEntryId);

    if (input.context !== undefined) {
      const { value } = await body({
        transaction: asRetrievalTransaction(input.context),
        appendAuditRow: true,
      });
      return value;
    }
    let outcome: { kind: "activated" } | { kind: "activation-conflict" } | undefined;
    const receipt = await this.#executeWithRetry(
      commandFor({
        projectId: activation.projectId,
        commandKind: "retrieval.generation-activate",
        stableKey: `generation-activate:${stableKey}:${activation.activatedAt}`,
        payload: {
          generationRef: activation.generationRef,
          evidenceBaseReleaseRef: activation.evidenceBaseReleaseRef,
          policyRef: activation.policyRef,
          authorizationScopeDigest: activation.authorizationScopeDigest,
          activationOrdinal: activation.activationOrdinal,
          ...(activation.previousGenerationRef === undefined
            ? {}
            : { previousGenerationRef: activation.previousGenerationRef }),
        },
        actorRef: activation.actorRef,
        authorizationContextRef: activation.authorizationContextRef,
        issuedAt: activation.activatedAt,
      }),
      async (context) => {
        const handled = await body({
          transaction: asRetrievalTransaction(context),
          appendAuditRow: false,
        });
        outcome = handled.value;
        return {
          resultRef: activation.evidenceBaseReleaseRef,
          audit: handled.audit,
          events: [],
        };
      },
      { isolationLevel: "serializable" },
    );
    if (receipt.replayed || outcome === undefined) {
      return this.#readActivationOutcome(activation);
    }
    return outcome;
  }

  async registerQueryResult(input: {
    readonly projectId: string;
    readonly queryId: string;
    readonly requestDigest: Sha256V1;
    readonly generationRef: RetrievalGenerationRefV1;
    readonly policyRef: RetrievalGenerationV1["identity"]["policyRef"];
    readonly authorizationScopeDigest: Sha256V1;
    readonly resultArtifactRef: ArtifactRefV1;
    readonly knowledgeQueryResultRef: KnowledgeQueryResultRefV1;
    readonly recordedAt: string;
    readonly actorRef: string;
    readonly authorizationContextRef: AuthorizationContextRefV1;
    readonly context?: TransactionContextV1;
  }): Promise<
    | { readonly kind: "registered"; readonly replayed: boolean }
    | { readonly kind: "idempotency-conflict" }
  > {
    const resultArtifactRef = ArtifactRefV1Schema.parse(input.resultArtifactRef);
    const knowledgeQueryResultRef = KnowledgeQueryResultRefV1Schema.parse(
      input.knowledgeQueryResultRef,
    );
    const stableKey = `${input.projectId}:${input.queryId}:${input.requestDigest}`;
    const auditEntryId = auditEntryIdFor("query-result-register", stableKey);
    const body = (scope: RetrievalWriteScopeV1) =>
      this.#registerQueryResultInScope(
        scope,
        {
          projectId: input.projectId,
          queryId: input.queryId,
          requestDigest: input.requestDigest,
          generationRef: input.generationRef,
          policyRef: input.policyRef,
          authorizationScopeDigest: input.authorizationScopeDigest,
          resultArtifactRef,
          knowledgeQueryResultRef,
          recordedAt: input.recordedAt,
          actorRef: input.actorRef,
          authorizationContextRef: input.authorizationContextRef,
        },
        auditEntryId,
      );

    if (input.context !== undefined) {
      const { value } = await body({
        transaction: asRetrievalTransaction(input.context),
        appendAuditRow: true,
      });
      return value;
    }
    let outcome:
      { kind: "registered"; replayed: boolean } | { kind: "idempotency-conflict" } | undefined;
    const receipt = await this.#executeWithRetry(
      commandFor({
        projectId: input.projectId,
        commandKind: "retrieval.query-result-register",
        stableKey: `query-result-register:${stableKey}`,
        payload: {
          queryId: input.queryId,
          requestDigest: input.requestDigest,
          generationRef: input.generationRef,
          policyRef: input.policyRef,
          authorizationScopeDigest: input.authorizationScopeDigest,
          resultArtifactRef,
          knowledgeQueryResultRef,
        },
        actorRef: input.actorRef,
        authorizationContextRef: input.authorizationContextRef,
        issuedAt: input.recordedAt,
      }),
      async (context) => {
        const handled = await body({
          transaction: asRetrievalTransaction(context),
          appendAuditRow: false,
        });
        outcome = handled.value;
        return {
          resultRef: knowledgeQueryResultRef,
          audit: handled.audit,
          events: [],
        };
      },
    );
    if (receipt.replayed || outcome === undefined) {
      const stored = await this.readQueryResult({
        projectId: input.projectId,
        queryId: input.queryId,
      });
      if (stored === undefined) {
        throw makePersistenceError("TRANSACTION_FAILED", "retrieval.query-result-replay");
      }
      return stored.requestDigest === input.requestDigest
        ? { kind: "registered", replayed: true }
        : { kind: "idempotency-conflict" };
    }
    return outcome;
  }

  async readGeneration(
    generationRef: RetrievalGenerationRefV1,
    context?: TransactionContextV1,
  ): Promise<RetrievalGenerationV1 | undefined> {
    try {
      const ref = RetrievalGenerationRefV1Schema.parse(generationRef);
      const db = this.#executor(context);
      const row = await this.#selectGenerationRow(db, ref);
      return row === undefined ? undefined : generationFromRow(row);
    } catch (error) {
      throw mapPostgresError(error, "retrieval.generation-read");
    }
  }

  async readGenerationStatus(
    generationRef: RetrievalGenerationRefV1,
    context?: TransactionContextV1,
  ): Promise<string | undefined> {
    try {
      const ref = RetrievalGenerationRefV1Schema.parse(generationRef);
      const row = await this.#selectLatestTransitionRow(this.#executor(context), ref);
      return row?.status;
    } catch (error) {
      throw mapPostgresError(error, "retrieval.generation-status");
    }
  }

  /**
   * 只返回与发布、策略、授权摘要逐字段精确匹配，且最新状态为 ready/active 的代际；
   * 任何差异都返回 undefined，不做放宽回退、也不借用旧代际。
   */
  async readActiveGeneration(input: {
    readonly projectId: string;
    readonly evidenceBaseReleaseRef: RetrievalEvidenceBaseReleaseRefV1;
    readonly policyRef: RetrievalGenerationV1["identity"]["policyRef"];
    readonly authorizationScopeDigest: Sha256V1;
    readonly context?: TransactionContextV1;
  }): Promise<RetrievalGenerationV1 | undefined> {
    try {
      const db = this.#executor(input.context);
      const activation = await this.#selectLatestActivationRow(db, {
        projectId: input.projectId,
        evidenceBaseReleaseRef: input.evidenceBaseReleaseRef,
      });
      if (activation === undefined) return undefined;
      if (
        activation.policy_entity_id !== input.policyRef.entityId ||
        activation.policy_version_id !== input.policyRef.versionId ||
        activation.authorization_scope_digest !== input.authorizationScopeDigest
      ) {
        return undefined;
      }
      const ref = generationRowRef(activation);
      const row = await this.#selectGenerationRow(db, ref);
      if (row === undefined) {
        throw makePersistenceError("TRANSACTION_FAILED", "retrieval.active-generation-missing");
      }
      if (row.authorization_scope_digest !== input.authorizationScopeDigest) return undefined;
      const status = await this.#selectLatestTransitionRow(db, ref);
      if (status === undefined) {
        throw makePersistenceError("TRANSACTION_FAILED", "retrieval.active-generation-status");
      }
      if (status.status !== "ready" && status.status !== "active") return undefined;
      return generationFromRow(row);
    } catch (error) {
      throw mapPostgresError(error, "retrieval.active-generation-read");
    }
  }

  async readActivation(
    generationRef: RetrievalGenerationRefV1,
    context?: TransactionContextV1,
  ): Promise<RetrievalActivationV1 | undefined> {
    try {
      const ref = RetrievalGenerationRefV1Schema.parse(generationRef);
      const row = await this.#executor(context)
        .selectFrom("business.retrieval_activations")
        .selectAll()
        .where("generation_id", "=", ref.reference.entityId)
        .where("generation_version_id", "=", ref.reference.versionId)
        .orderBy("activation_ordinal", "desc")
        .limit(1)
        .executeTakeFirst();
      return row === undefined ? undefined : activationFromRow(row);
    } catch (error) {
      throw mapPostgresError(error, "retrieval.activation-read");
    }
  }

  async readQueryResult(
    input: { readonly projectId: string; readonly queryId: string },
    context?: TransactionContextV1,
  ): Promise<
    | {
        readonly requestDigest: Sha256V1;
        readonly knowledgeQueryResultRef: KnowledgeQueryResultRefV1;
        readonly resultArtifactRef: ArtifactRefV1;
      }
    | undefined
  > {
    try {
      const row = await this.#selectQueryResultRow(this.#executor(context), input);
      if (row === undefined) return undefined;
      return {
        requestDigest: row.request_digest as Sha256V1,
        knowledgeQueryResultRef: KnowledgeQueryResultRefV1Schema.parse(
          row.knowledge_query_result_ref,
        ),
        resultArtifactRef: ArtifactRefV1Schema.parse(row.result_artifact_ref),
      };
    } catch (error) {
      throw mapPostgresError(error, "retrieval.query-result-read");
    }
  }

  #executor(context: TransactionContextV1 | undefined): RetrievalQueryExecutorV1 {
    return context === undefined ? this.#db : asRetrievalTransaction(context);
  }

  async #ensureBuildingGenerationInScope(
    scope: RetrievalWriteScopeV1,
    generation: RetrievalGenerationV1,
    building: RetrievalGenerationTransitionV1,
    actorRef: string,
    auditEntryId: string,
  ): Promise<{
    readonly value: { generation: RetrievalGenerationV1; created: boolean; status: string };
    readonly audit: AuditAppendV1;
  }> {
    const identity = generation.identity;
    const inserted = await scope.transaction
      .insertInto("business.retrieval_generations")
      .values({
        generation_id: generation.generationRef.reference.entityId,
        generation_version_id: generation.generationRef.reference.versionId,
        schema_version: generation.schemaVersion,
        project_id: identity.projectId,
        source_event_id: identity.sourceEventId,
        evidence_base_release_entity_id: identity.evidenceBaseReleaseRef.reference.entityId,
        evidence_base_release_version_id: identity.evidenceBaseReleaseRef.reference.versionId,
        risk_mechanism_release_entity_id:
          identity.memberReleaseRefs.riskMechanismRef.reference.entityId,
        risk_mechanism_release_version_id:
          identity.memberReleaseRefs.riskMechanismRef.reference.versionId,
        standard_library_release_entity_id:
          identity.memberReleaseRefs.standardLibraryRef.reference.entityId,
        standard_library_release_version_id:
          identity.memberReleaseRefs.standardLibraryRef.reference.versionId,
        case_library_release_entity_id:
          identity.memberReleaseRefs.caseLibraryRef.reference.entityId,
        case_library_release_version_id:
          identity.memberReleaseRefs.caseLibraryRef.reference.versionId,
        policy_entity_id: identity.policyRef.entityId,
        policy_version_id: identity.policyRef.versionId,
        model_deployment_entity_id: identity.modelDeploymentRef.entityId,
        model_deployment_version_id: identity.modelDeploymentRef.versionId,
        projection_compatibility_entity_id: identity.projectionCompatibilityRef.entityId,
        projection_compatibility_version_id: identity.projectionCompatibilityRef.versionId,
        authorization_scope_digest: generation.authorizationScopeDigest,
        expected_member_count: generation.expectedMemberCount,
        manifest_sha256: generation.manifestSha256,
        collection_name: generation.collectionName,
        created_by: generation.createdBy,
        authorization_context_ref: jsonValue(generation.authorizationContextRef),
        created_at: generation.createdAt,
        audit_entry_id: auditEntryId,
      } as never)
      .onConflict((conflict) => conflict.doNothing())
      .execute();
    const created = (inserted[0]?.numInsertedOrUpdatedRows ?? 0n) > 0n;
    // 身份输入唯一约束与主键都可能命中；两种情况都必须返回已存在事实供调用方判定漂移。
    const stored =
      (await this.#selectGenerationRow(scope.transaction, generation.generationRef)) ??
      (await this.#selectGenerationRowByIdentity(scope.transaction, identity));
    if (stored === undefined) {
      throw makePersistenceError("TRANSACTION_FAILED", "retrieval.generation-ensure");
    }
    if (created) {
      await this.#insertTransitionRow(scope.transaction, building, {
        projectId: stored.project_id,
        actorRef,
        authorizationContextRef: generation.authorizationContextRef,
        contextRefs: [],
        auditEntryId,
      });
    }
    const latest = await this.#selectLatestTransitionRow(
      scope.transaction,
      generationRowRef(stored),
    );
    if (latest === undefined) {
      throw makePersistenceError("TRANSACTION_FAILED", "retrieval.generation-ensure-status");
    }
    const audit = auditFor({
      auditEntryId,
      projectId: stored.project_id,
      action: "retrieval-generation.ensure",
      targetRef: identity.evidenceBaseReleaseRef,
      actorRef,
      authorizationContextRef: generation.authorizationContextRef,
      occurredAt: building.occurredAt,
      recordedAt: nowIso(this.#now),
    });
    if (scope.appendAuditRow) await this.#appendAuditRow(scope.transaction, audit);
    return {
      value: { generation: generationFromRow(stored), created, status: latest.status },
      audit,
    };
  }

  async #appendTransitionInScope(
    scope: RetrievalWriteScopeV1,
    transition: RetrievalGenerationTransitionV1,
    request: {
      readonly actorRef: string;
      readonly authorizationContextRef: AuditAppendV1["authorizationContextRef"];
      readonly contextRefs: readonly ContractReferenceV1[];
    },
    auditEntryId: string,
  ): Promise<{ readonly value: undefined; readonly audit: AuditAppendV1 }> {
    const ref = transition.generationRef;
    const generation = await this.#selectGenerationRow(scope.transaction, ref);
    if (generation === undefined) {
      throw makePersistenceError("TRANSACTION_FAILED", "retrieval.transition-generation");
    }
    const latest = await this.#selectLatestTransitionRow(scope.transaction, ref);
    let appended = true;
    if (latest === undefined) {
      // 没有历史时只有 building 可以成为首状态。
      if (transition.status !== "building") {
        throw makePersistenceError("TRANSACTION_FAILED", "retrieval.transition-not-initial");
      }
    } else if (transition.ordinal <= latest.ordinal) {
      const existing = await this.#selectTransitionRow(scope.transaction, ref, transition.ordinal);
      // 只为止损重放放行同序号同内容的重复追加；其余一律拒绝，历史行永不改写。
      if (existing === undefined || !sameTransition(existing, transition)) {
        throw makePersistenceError("IDEMPOTENCY_CONFLICT", "retrieval.transition-replay");
      }
      appended = false;
    } else if (!assertGenerationTransition(latest.status, transition.status)) {
      throw makePersistenceError("TRANSACTION_FAILED", "retrieval.transition-illegal");
    }
    if (appended) {
      await this.#insertTransitionRow(scope.transaction, transition, {
        projectId: generation.project_id,
        actorRef: request.actorRef,
        authorizationContextRef: request.authorizationContextRef,
        contextRefs: request.contextRefs,
        auditEntryId,
      });
    }
    const audit = auditFor({
      auditEntryId,
      projectId: generation.project_id,
      action: `retrieval-generation.${transition.status}`,
      targetRef: request.contextRefs[0] ?? request.authorizationContextRef,
      actorRef: request.actorRef,
      authorizationContextRef: request.authorizationContextRef,
      occurredAt: transition.occurredAt,
      recordedAt: nowIso(this.#now),
    });
    if (scope.appendAuditRow) await this.#appendAuditRow(scope.transaction, audit);
    return { value: undefined, audit };
  }

  /**
   * 激活：事务级 advisory lock 串行化同一 `(projectId, 证据库系列)`，再复读当前激活做
   * compare-and-swap。失配时不写任何行（包括审计行），由调用方收口 ACTIVATION_CONFLICT。
   */
  async #activateGenerationInScope(
    scope: RetrievalWriteScopeV1,
    activation: RetrievalActivationV1,
    contextRefs: readonly ContractReferenceV1[],
    auditEntryId: string,
  ): Promise<{
    readonly value: { kind: "activated" } | { kind: "activation-conflict" };
    readonly audit: AuditAppendV1;
  }> {
    const projectId = activation.projectId;
    const evidenceBaseReleaseRef = activation.evidenceBaseReleaseRef;
    const ref = activation.generationRef;
    const previous = activation.previousGenerationRef;
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`riskflow.c20.retrieval-activation.${projectId}.${evidenceBaseReleaseRef.reference.entityId}`}, 0))`.execute(
      scope.transaction,
    );
    const decide = (kind: "activated" | "activation-conflict"): AuditAppendV1 =>
      auditFor({
        auditEntryId,
        projectId,
        action: `retrieval-generation.activate.${kind}`,
        targetRef: evidenceBaseReleaseRef,
        actorRef: activation.actorRef,
        authorizationContextRef: activation.authorizationContextRef,
        occurredAt: activation.activatedAt,
        recordedAt: nowIso(this.#now),
      });
    const current = await this.#selectLatestActivationRow(scope.transaction, {
      projectId,
      evidenceBaseReleaseRef,
    });
    if (
      current !== undefined &&
      sameRef(generationRowRef(current).reference, ref.reference) &&
      current.activation_ordinal === activation.activationOrdinal
    ) {
      const audit = decide("activated");
      if (scope.appendAuditRow) await this.#appendAuditRow(scope.transaction, audit);
      return { value: { kind: "activated" }, audit };
    }
    const currentMatches =
      current === undefined
        ? previous === undefined
        : previous !== undefined &&
          sameRef(generationRowRef(current).reference, previous.reference);
    if (!currentMatches) {
      return { value: { kind: "activation-conflict" }, audit: decide("activation-conflict") };
    }
    const generation = await this.#selectGenerationRow(scope.transaction, ref);
    if (generation === undefined || generation.project_id !== projectId) {
      throw makePersistenceError("TRANSACTION_FAILED", "retrieval.activation-generation");
    }
    const latest = await this.#selectLatestTransitionRow(scope.transaction, ref);
    if (latest === undefined || !assertGenerationTransition(latest.status, "active")) {
      throw makePersistenceError("TRANSACTION_FAILED", "retrieval.activation-not-ready");
    }
    if (previous !== undefined) {
      const previousStatus = await this.#selectLatestTransitionRow(scope.transaction, previous);
      if (
        previousStatus === undefined ||
        !assertGenerationTransition(previousStatus.status, "superseded")
      ) {
        throw makePersistenceError("TRANSACTION_FAILED", "retrieval.supersede-not-allowed");
      }
    }
    const inserted = await scope.transaction
      .insertInto("business.retrieval_activations")
      .values({
        project_id: projectId,
        evidence_base_release_entity_id: evidenceBaseReleaseRef.reference.entityId,
        evidence_base_release_version_id: evidenceBaseReleaseRef.reference.versionId,
        activation_ordinal: activation.activationOrdinal,
        generation_id: ref.reference.entityId,
        generation_version_id: ref.reference.versionId,
        previous_generation_id: previous?.reference.entityId ?? null,
        previous_generation_version_id: previous?.reference.versionId ?? null,
        policy_entity_id: activation.policyRef.entityId,
        policy_version_id: activation.policyRef.versionId,
        authorization_scope_digest: activation.authorizationScopeDigest,
        actor_ref: activation.actorRef,
        authorization_context_ref: jsonValue(activation.authorizationContextRef),
        context_refs: jsonValue(contextRefs),
        activated_at: activation.activatedAt,
        audit_entry_id: auditEntryId,
      } as never)
      .onConflict((conflict) => conflict.doNothing())
      .execute();
    if ((inserted[0]?.numInsertedOrUpdatedRows ?? 0n) === 0n) {
      // 主键即 CAS 守卫：并发事务已占用该序号，按复读结果区分幂等与冲突，绝不覆盖历史。
      const settled = await this.#selectLatestActivationRow(scope.transaction, {
        projectId,
        evidenceBaseReleaseRef,
      });
      const mine =
        settled !== undefined &&
        sameRef(generationRowRef(settled).reference, ref.reference) &&
        settled.activation_ordinal === activation.activationOrdinal;
      const audit = decide(mine ? "activated" : "activation-conflict");
      if (mine && scope.appendAuditRow) await this.#appendAuditRow(scope.transaction, audit);
      return { value: { kind: mine ? "activated" : "activation-conflict" }, audit };
    }
    await this.#insertTransitionRow(
      scope.transaction,
      RetrievalGenerationTransitionV1Schema.parse({
        schemaVersion: "1",
        transitionRef: versionedRef(
          "retrieval-generation-transition",
          `${ref.reference.entityId}:${ref.reference.versionId}:${RETRIEVAL_ACTIVATION_ORDINAL_V1.active}`,
          `activation-${activation.activationOrdinal}`,
        ),
        generationRef: ref,
        ordinal: RETRIEVAL_ACTIVATION_ORDINAL_V1.active,
        status: "active",
        occurredAt: activation.activatedAt,
        manifestSha256: generation.manifest_sha256,
        noteCode: "activation-committed",
      }),
      {
        projectId,
        actorRef: activation.actorRef,
        authorizationContextRef: activation.authorizationContextRef,
        contextRefs,
        auditEntryId,
      },
    );
    if (previous !== undefined) {
      await this.#insertTransitionRow(
        scope.transaction,
        RetrievalGenerationTransitionV1Schema.parse({
          schemaVersion: "1",
          transitionRef: versionedRef(
            "retrieval-generation-transition",
            `${previous.reference.entityId}:${previous.reference.versionId}:${RETRIEVAL_ACTIVATION_ORDINAL_V1.superseded}`,
            `superseded-by-${ref.reference.versionId}`,
          ),
          generationRef: previous,
          ordinal: RETRIEVAL_ACTIVATION_ORDINAL_V1.superseded,
          status: "superseded",
          occurredAt: activation.activatedAt,
          noteCode: "activation-superseded",
        }),
        {
          projectId,
          actorRef: activation.actorRef,
          authorizationContextRef: activation.authorizationContextRef,
          contextRefs,
          auditEntryId,
        },
      );
    }
    const audit = decide("activated");
    if (scope.appendAuditRow) await this.#appendAuditRow(scope.transaction, audit);
    return { value: { kind: "activated" }, audit };
  }

  async #registerQueryResultInScope(
    scope: RetrievalWriteScopeV1,
    input: {
      readonly projectId: string;
      readonly queryId: string;
      readonly requestDigest: Sha256V1;
      readonly generationRef: RetrievalGenerationRefV1;
      readonly policyRef: RetrievalGenerationV1["identity"]["policyRef"];
      readonly authorizationScopeDigest: Sha256V1;
      readonly resultArtifactRef: ArtifactRefV1;
      readonly knowledgeQueryResultRef: KnowledgeQueryResultRefV1;
      readonly recordedAt: string;
      readonly actorRef: string;
      readonly authorizationContextRef: AuditAppendV1["authorizationContextRef"];
    },
    auditEntryId: string,
  ): Promise<{
    readonly value: { kind: "registered"; replayed: boolean } | { kind: "idempotency-conflict" };
    readonly audit: AuditAppendV1;
  }> {
    const inserted = await scope.transaction
      .insertInto("business.retrieval_query_results")
      .values({
        project_id: input.projectId,
        query_id: input.queryId,
        request_digest: input.requestDigest,
        generation_id: input.generationRef.reference.entityId,
        generation_version_id: input.generationRef.reference.versionId,
        policy_entity_id: input.policyRef.entityId,
        policy_version_id: input.policyRef.versionId,
        authorization_scope_digest: input.authorizationScopeDigest,
        result_artifact_ref: jsonValue(input.resultArtifactRef),
        knowledge_query_result_ref: jsonValue(input.knowledgeQueryResultRef),
        actor_ref: input.actorRef,
        authorization_context_ref: jsonValue(input.authorizationContextRef),
        recorded_at: input.recordedAt,
        audit_entry_id: auditEntryId,
      } as never)
      .onConflict((conflict) => conflict.columns(["project_id", "query_id"]).doNothing())
      .execute();
    const created = (inserted[0]?.numInsertedOrUpdatedRows ?? 0n) > 0n;
    let value: { kind: "registered"; replayed: boolean } | { kind: "idempotency-conflict" };
    if (created) {
      value = { kind: "registered", replayed: false };
    } else {
      const stored = await this.#selectQueryResultRow(scope.transaction, input);
      if (stored === undefined) {
        throw makePersistenceError("TRANSACTION_FAILED", "retrieval.query-result-register");
      }
      value =
        stored.request_digest === input.requestDigest
          ? { kind: "registered", replayed: true }
          : { kind: "idempotency-conflict" };
    }
    const audit = auditFor({
      auditEntryId,
      projectId: input.projectId,
      action:
        value.kind === "registered"
          ? "retrieval-query-result.register"
          : "retrieval-query-result.idempotency-conflict",
      targetRef: input.knowledgeQueryResultRef,
      actorRef: input.actorRef,
      authorizationContextRef: input.authorizationContextRef,
      occurredAt: input.recordedAt,
      recordedAt: nowIso(this.#now),
    });
    // 冲突结果不改写任何事实，也不追加审计行；由调用方按 IDEMPOTENCY_CONFLICT 收口。
    if (scope.appendAuditRow && value.kind === "registered") {
      await this.#appendAuditRow(scope.transaction, audit);
    }
    return { value, audit };
  }

  async #insertTransitionRow(
    transaction: RetrievalTransactionV1,
    transition: RetrievalGenerationTransitionV1,
    request: {
      readonly projectId: string;
      readonly actorRef: string;
      readonly authorizationContextRef: AuditAppendV1["authorizationContextRef"];
      readonly contextRefs: readonly ContractReferenceV1[];
      readonly auditEntryId: string;
    },
  ): Promise<void> {
    await transaction
      .insertInto("business.retrieval_generation_transitions")
      .values({
        project_id: request.projectId,
        generation_id: transition.generationRef.reference.entityId,
        generation_version_id: transition.generationRef.reference.versionId,
        ordinal: transition.ordinal,
        status: transition.status,
        manifest_sha256: transition.manifestSha256 ?? null,
        failure_code: transition.failureCode ?? null,
        note_code: transition.noteCode ?? null,
        transition_ref: jsonValue(transition.transitionRef),
        actor_ref: request.actorRef,
        authorization_context_ref: jsonValue(request.authorizationContextRef),
        context_refs: jsonValue(request.contextRefs),
        occurred_at: transition.occurredAt,
        audit_entry_id: request.auditEntryId,
      } as never)
      .execute();
  }

  async #appendAuditRow(transaction: RetrievalTransactionV1, audit: AuditAppendV1): Promise<void> {
    await transaction
      .insertInto("audit.entries")
      .values({
        audit_entry_id: audit.auditEntryId,
        project_id: audit.projectId,
        action: audit.action,
        target_ref: jsonValue(audit.targetRef),
        actor_ref: audit.actorRef,
        authorization_context_ref: jsonValue(audit.authorizationContextRef),
        version_ref: jsonValue(audit.version),
        occurred_at: audit.occurredAt,
        recorded_at: audit.recordedAt,
        persisted_at: sql`clock_timestamp()`,
        command_id: audit.commandId ?? `retrieval:${audit.auditEntryId}`,
        idempotency_key: audit.idempotencyKey ?? `retrieval:${audit.auditEntryId}`,
        run_id: audit.runId ?? null,
        thread_id: audit.threadId ?? null,
        reason_ref: audit.reasonRef === undefined ? null : jsonValue(audit.reasonRef),
      } as never)
      .onConflict((conflict) => conflict.column("audit_entry_id").doNothing())
      .execute();
  }

  async #executeWithRetry(
    command: AtomicCommandV1,
    handler: (context: TransactionContextV1) => Promise<AtomicCommitV1>,
    options?: TransactionOptionsV1,
  ): Promise<AtomicCommitReceiptV1> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await (options === undefined
          ? this.#transactionUnit.execute(command, handler)
          : this.#transactionUnit.execute(command, handler, options));
      } catch (error: unknown) {
        // 并发序列化失败在有限预算内重试；其余错误按原样上抛，绝不降级为静默成功。
        if (
          attempt < MAX_SERIALIZATION_ATTEMPTS_V1 &&
          mapPostgresError(error, "retrieval.transaction").retryable
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  async #selectGenerationRow(
    db: RetrievalQueryExecutorV1,
    ref: RetrievalGenerationRefV1,
  ): Promise<GenerationRow | undefined> {
    return db
      .selectFrom("business.retrieval_generations")
      .selectAll()
      .where("generation_id", "=", ref.reference.entityId)
      .where("generation_version_id", "=", ref.reference.versionId)
      .executeTakeFirst();
  }

  async #selectGenerationRowByIdentity(
    db: RetrievalQueryExecutorV1,
    identity: RetrievalGenerationV1["identity"],
  ): Promise<GenerationRow | undefined> {
    return db
      .selectFrom("business.retrieval_generations")
      .selectAll()
      .where("project_id", "=", identity.projectId)
      .where("source_event_id", "=", identity.sourceEventId)
      .where(
        "evidence_base_release_entity_id",
        "=",
        identity.evidenceBaseReleaseRef.reference.entityId,
      )
      .where(
        "evidence_base_release_version_id",
        "=",
        identity.evidenceBaseReleaseRef.reference.versionId,
      )
      .where(
        "risk_mechanism_release_entity_id",
        "=",
        identity.memberReleaseRefs.riskMechanismRef.reference.entityId,
      )
      .where(
        "risk_mechanism_release_version_id",
        "=",
        identity.memberReleaseRefs.riskMechanismRef.reference.versionId,
      )
      .where(
        "standard_library_release_entity_id",
        "=",
        identity.memberReleaseRefs.standardLibraryRef.reference.entityId,
      )
      .where(
        "standard_library_release_version_id",
        "=",
        identity.memberReleaseRefs.standardLibraryRef.reference.versionId,
      )
      .where(
        "case_library_release_entity_id",
        "=",
        identity.memberReleaseRefs.caseLibraryRef.reference.entityId,
      )
      .where(
        "case_library_release_version_id",
        "=",
        identity.memberReleaseRefs.caseLibraryRef.reference.versionId,
      )
      .where("policy_entity_id", "=", identity.policyRef.entityId)
      .where("policy_version_id", "=", identity.policyRef.versionId)
      .where("model_deployment_entity_id", "=", identity.modelDeploymentRef.entityId)
      .where("model_deployment_version_id", "=", identity.modelDeploymentRef.versionId)
      .where(
        "projection_compatibility_entity_id",
        "=",
        identity.projectionCompatibilityRef.entityId,
      )
      .where(
        "projection_compatibility_version_id",
        "=",
        identity.projectionCompatibilityRef.versionId,
      )
      .executeTakeFirst();
  }

  async #selectLatestTransitionRow(
    db: RetrievalQueryExecutorV1,
    ref: RetrievalGenerationRefV1,
  ): Promise<TransitionRow | undefined> {
    return db
      .selectFrom("business.retrieval_generation_transitions")
      .selectAll()
      .where("generation_id", "=", ref.reference.entityId)
      .where("generation_version_id", "=", ref.reference.versionId)
      .orderBy("ordinal", "desc")
      .limit(1)
      .executeTakeFirst();
  }

  async #selectTransitionRow(
    db: RetrievalQueryExecutorV1,
    ref: RetrievalGenerationRefV1,
    ordinal: number,
  ): Promise<TransitionRow | undefined> {
    return db
      .selectFrom("business.retrieval_generation_transitions")
      .selectAll()
      .where("generation_id", "=", ref.reference.entityId)
      .where("generation_version_id", "=", ref.reference.versionId)
      .where("ordinal", "=", ordinal)
      .executeTakeFirst();
  }

  async #selectLatestActivationRow(
    db: RetrievalQueryExecutorV1,
    input: {
      readonly projectId: string;
      readonly evidenceBaseReleaseRef: RetrievalEvidenceBaseReleaseRefV1;
    },
  ): Promise<ActivationRow | undefined> {
    return db
      .selectFrom("business.retrieval_activations")
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where(
        "evidence_base_release_entity_id",
        "=",
        input.evidenceBaseReleaseRef.reference.entityId,
      )
      .where(
        "evidence_base_release_version_id",
        "=",
        input.evidenceBaseReleaseRef.reference.versionId,
      )
      .orderBy("activation_ordinal", "desc")
      .limit(1)
      .executeTakeFirst();
  }

  async #selectQueryResultRow(
    db: RetrievalQueryExecutorV1,
    input: { readonly projectId: string; readonly queryId: string },
  ): Promise<QueryResultRow | undefined> {
    return db
      .selectFrom("business.retrieval_query_results")
      .selectAll()
      .where("project_id", "=", input.projectId)
      .where("query_id", "=", input.queryId)
      .executeTakeFirst();
  }

  async #requireCommittedGeneration(ref: RetrievalGenerationRefV1): Promise<GenerationRow> {
    const row = await this.#selectGenerationRow(this.#db, ref);
    if (row === undefined) {
      throw makePersistenceError("TRANSACTION_FAILED", "retrieval.transition-generation");
    }
    return row;
  }

  async #readEnsuredGeneration(generation: RetrievalGenerationV1): Promise<{
    readonly generation: RetrievalGenerationV1;
    readonly created: boolean;
    readonly status: string;
  }> {
    const stored =
      (await this.#selectGenerationRow(this.#db, generation.generationRef)) ??
      (await this.#selectGenerationRowByIdentity(this.#db, generation.identity));
    if (stored === undefined) {
      throw makePersistenceError("TRANSACTION_FAILED", "retrieval.generation-ensure-replay");
    }
    const latest = await this.#selectLatestTransitionRow(this.#db, generationRowRef(stored));
    if (latest === undefined) {
      throw makePersistenceError("TRANSACTION_FAILED", "retrieval.generation-ensure-status");
    }
    return { generation: generationFromRow(stored), created: false, status: latest.status };
  }

  async #readActivationOutcome(
    activation: RetrievalActivationV1,
  ): Promise<{ readonly kind: "activated" } | { readonly kind: "activation-conflict" }> {
    const current = await this.#selectLatestActivationRow(this.#db, {
      projectId: activation.projectId,
      evidenceBaseReleaseRef: activation.evidenceBaseReleaseRef,
    });
    if (
      current !== undefined &&
      sameRef(generationRowRef(current).reference, activation.generationRef.reference) &&
      current.activation_ordinal === activation.activationOrdinal
    ) {
      return { kind: "activated" };
    }
    return { kind: "activation-conflict" };
  }
}
