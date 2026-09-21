import { randomUUID } from "node:crypto";

import type { EvidenceReference, VersionReference } from "@riskflow/contracts/common";
import type { SpatialScopeRefV1, SourceVersionRefV1 } from "@riskflow/contracts/ports";
import {
  KnowledgeRetrievalQueryV1Schema,
  ModuleErrorV1Schema,
  type AgentTaskRefV1,
  type AgentTaskResultRefV1,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type KnowledgeQueryResultRefV1,
  type KnowledgeReleaseRefV1,
  type KnowledgeRetrievalQueryV1,
  type KnowledgeRetrievalResultV1,
  type ModuleErrorV1,
} from "@riskflow/contracts/ports";
import { IdentificationInputSnapshotV1Schema } from "@riskflow/contracts/workflows";

import {
  AgentRuntimeError,
  AgentTaskDefinitionMetadataV1Schema,
  buildCompletedAgentTaskResult,
  makeAgentError,
  type AgentDomainToolV1,
  type AgentTaskDefinitionV1,
  type AgentTaskSnapshotV1,
  type AgentValidationResultV1,
} from "../../agent-runtime/index.js";
import { ArtifactPutCommandV1Schema, type ArtifactRefV1 } from "../../artifacts/index.js";
import type { IdentificationKnowledgeExactReadV1 } from "../../identification-knowledge/index.js";
import { sha256CanonicalJson } from "../../persistence/index.js";
import type { TransactionContextV1 } from "../../persistence/transaction.js";
import { authorizationScopeDigest } from "../../retrieval/service.js";
import {
  HybridRetrievalResultPayloadV1Schema,
  type HybridRetrievalResultPayloadV1,
} from "../../retrieval/schema.js";
import type { HybridRetrievalInputReaderV1 } from "../../retrieval/ports.js";

import type {
  IdentificationContextQueryResultV1,
  IdentificationContextServiceOptionsV1,
  OfficialHybridResultV1,
  RetrievalReviewTaskPortV1,
  RetrievalReviewValidationOutcomeV1,
} from "./ports.js";
import {
  BoundedHybridResupplementActionV1Schema,
  IDENTIFICATION_CONTEXT_CHECK_IDS_V1,
  IDENTIFICATION_CONTEXT_REASON_CODES_V1,
  IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1,
  IdentificationContextResultRowV1Schema,
  ModelContextPayloadV1Schema,
  RETRIEVAL_REVIEW_TASK_TYPE,
  ReadFrozenResultActionV1Schema,
  RelationshipContextPayloadV1Schema,
  RetrievalReviewActionV1Schema,
  RetrievalReviewCandidateSetV1Schema,
  RetrievalReviewIncrementV1Schema,
  RetrievalReviewPolicyV1Schema,
  RetrievalResupplementIntentV1Schema,
  ReviewedRetrievalSetV1Schema,
  identificationBasisReadInvocationIdFor,
  isResupplementQueryId,
  modelContextArtifactSetRefFor,
  relationshipQueryResultRefFor,
  resupplementArtifactIdFor,
  resupplementQueryIdFor,
  resupplementQueryTextFor,
  retrievalArtifactSetRefFor,
  type IdentificationContextResultRowV1,
  type ModelContextPayloadV1,
  type RelationshipContextPayloadV1,
  type RetrievalReviewCandidateSetV1,
  type RetrievalReviewCandidateV1,
  type RetrievalReviewPolicyV1,
  type RetrievalReviewResupplementV1,
  type ReviewedRetrievalMemberV1,
  type ReviewedRetrievalSetV1,
} from "./schema.js";

const MAX_ARTIFACT_BYTES_V1 = 8 * 1024 * 1024;
const RELATIONSHIP_PURPOSE_CODE_V1 = "identification-relationship-context";
const CANDIDATE_SET_PURPOSE_CODE_V1 = "retrieval-review-candidate-set";
const RESUPPLEMENT_INTENT_PURPOSE_CODE_V1 = "retrieval-resupplement-intent";
const REVIEWED_SET_PURPOSE_CODE_V1 = "retrieval-artifact-set";
const MODEL_CONTEXT_PURPOSE_CODE_V1 = "identification-model-context";
const OBSERVATION_PURPOSE_CODE_V1 = "identification-context-observation";

export const IDENTIFICATION_CONTEXT_PURPOSE_CODES_V1 = Object.freeze({
  relationship: RELATIONSHIP_PURPOSE_CODE_V1,
  candidateSet: CANDIDATE_SET_PURPOSE_CODE_V1,
  resupplementIntent: RESUPPLEMENT_INTENT_PURPOSE_CODE_V1,
  reviewedSet: REVIEWED_SET_PURPOSE_CODE_V1,
  modelContext: MODEL_CONTEXT_PURPOSE_CODE_V1,
  observation: OBSERVATION_PURPOSE_CODE_V1,
});

/** 基线查询按工作项节点派生稳定身份：重放不重复调用 C20 检索。 */
export const baselineQueryIdFor = (nodeId: string): string => `${nodeId}:retrieval-baseline`;

/** 关系查询按工作项节点派生稳定身份：同一工作项只对应一个正式关系结果。 */
export const relationshipQueryIdFor = (nodeId: string): string => `${nodeId}:relationship-context`;

/** 关系查询的规范化请求摘要：冻结输入、精确发布与授权范围共同构成身份。 */
export const relationshipRequestDigest = (input: {
  readonly refs: {
    readonly inputSnapshotRef: { readonly kind: string; readonly reference: VersionReference };
    readonly workItemRef: { readonly kind: string; readonly reference: VersionReference };
  };
  readonly nodeId: string;
  readonly releaseRefs: {
    readonly processModel: VersionReference;
    readonly riskMechanism: VersionReference;
    readonly retrievalEvidenceBase: VersionReference;
  };
  readonly authorizationScopeDigest: string;
}): string => sha256CanonicalJson(input);

const diagnosticRef = (stage: string) => ({
  kind: "diagnostic-artifact" as const,
  reference: { entityId: `identification-context-${stage}`, versionId: "v1" },
});

const authorizationDenied = (input: {
  readonly causalRunId: string;
  readonly occurredAt: string;
  readonly policyRef: VersionReference;
}): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    stageCode: "identification-context.authorization",
    occurredAt: input.occurredAt,
    causalRunId: input.causalRunId,
    code: "AUTHORIZATION_DENIED",
    category: "authorization",
    retryable: false,
    requiredCapability: "knowledge-modeling.retrieve",
    authorizationPolicyRef: input.policyRef,
  });

const blocked = (input: {
  readonly causalRunId: string;
  readonly occurredAt: string;
  readonly blockerKind: string;
  readonly blockerRef: ContractReferenceV1;
}): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    stageCode: `identification-context.${input.blockerKind}`,
    occurredAt: input.occurredAt,
    causalRunId: input.causalRunId,
    code: "BUSINESS_BLOCKED",
    category: "business-blocked",
    retryable: false,
    blockerKind: input.blockerKind,
    blockerRef: input.blockerRef,
  });

const terminalFailure = (input: {
  readonly causalRunId: string;
  readonly occurredAt: string;
  readonly stage: string;
}): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    stageCode: `identification-context.${input.stage}`,
    occurredAt: input.occurredAt,
    causalRunId: input.causalRunId,
    code: "TERMINAL_FAILURE",
    category: "technical",
    retryable: false,
    diagnosticRef: diagnosticRef(input.stage),
  });

const idempotencyConflict = (input: {
  readonly causalRunId: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly priorCommandId: string;
}): ModuleErrorV1 =>
  ModuleErrorV1Schema.parse({
    stageCode: "identification-context.idempotency",
    occurredAt: input.occurredAt,
    causalRunId: input.causalRunId,
    code: "IDEMPOTENCY_CONFLICT",
    category: "idempotency",
    retryable: false,
    idempotencyKey: input.idempotencyKey,
    priorCommandId: input.priorCommandId,
  });

type RelationshipFailure =
  | { readonly kind: "authorization" }
  | {
      readonly kind: "blocked";
      readonly blockerKind: string;
      readonly blockerRef: ContractReferenceV1;
    }
  | { readonly kind: "idempotency-conflict"; readonly priorCommandId: string }
  | { readonly kind: "terminal"; readonly stage: string };

/** 调用方按 `ModuleErrorV1` 收口的结构化错误；不携带任何正文或成员存在性。 */
export class IdentificationContextError extends Error {
  readonly details: ModuleErrorV1;

  constructor(details: ModuleErrorV1) {
    super(details.code);
    this.name = "IdentificationContextError";
    this.details = details;
  }
}

/** 事务内幂等冲突的哨兵：抛出即回滚，不写登记行也不写审计。 */
class ContextTransactionAbort extends Error {
  constructor() {
    super("identification-context.transaction-abort");
    this.name = "ContextTransactionAbort";
  }
}

const parseRelationshipQuery = (
  query: KnowledgeRetrievalQueryV1,
): Extract<KnowledgeRetrievalQueryV1, { readonly kind: "relationship-context" }> | undefined => {
  const parsed = KnowledgeRetrievalQueryV1Schema.safeParse(query);
  if (!parsed.success || parsed.data.kind !== "relationship-context") return undefined;
  return parsed.data;
};

const asReleaseRef = (reference: VersionReference): KnowledgeReleaseRefV1 => ({
  kind: "knowledge-release",
  reference,
});

const entryEvidenceOf = (
  read: IdentificationKnowledgeExactReadV1,
  sourceKind: string,
  sourceEntryId: string,
): readonly EvidenceReference[] | undefined => {
  const entries =
    read.package.definitionType === "risk-mechanism"
      ? read.package.mechanisms.map((entry) => ({
          id: entry.mechanismId,
          evidence: entry.evidence,
        }))
      : read.package.definitionType === sourceKind && "entries" in read.package
        ? read.package.entries.map((entry) => ({ id: entry.entryId, evidence: entry.evidence }))
        : [];
  return entries.find((entry) => entry.id === sourceEntryId)?.evidence;
};

const applicabilityCovers = (
  node: {
    readonly applicability: {
      readonly constructionMethod: readonly string[];
      readonly stratumCondition: readonly string[];
      readonly engineeringStage: readonly string[];
    };
  },
  mechanism: {
    readonly applicability: {
      readonly constructionMethod: readonly string[];
      readonly stratumCondition: readonly string[];
      readonly engineeringStage: readonly string[];
    };
  },
): boolean =>
  (["constructionMethod", "stratumCondition", "engineeringStage"] as const).every((dimension) =>
    mechanism.applicability[dimension].every((value) =>
      node.applicability[dimension].includes(value),
    ),
  );

/** C21 深模块：三项产物只经显式端口与既有公共分支完成。 */
export class IdentificationContextService implements RetrievalReviewTaskPortV1 {
  readonly #options: IdentificationContextServiceOptionsV1;
  readonly #policy: RetrievalReviewPolicyV1;
  readonly #now: () => Date;
  /** 本次动作的冻结补搜文本；只在一次动作内有效，缺失即失败封闭，不盲重发。 */
  readonly #resupplementTextByQueryId = new Map<string, string>();

  constructor(options: IdentificationContextServiceOptionsV1) {
    this.#options = options;
    this.#policy = RetrievalReviewPolicyV1Schema.parse(options.reviewPolicy);
    this.#now = options.now ?? (() => new Date());
  }

  get reviewPolicy(): RetrievalReviewPolicyV1 {
    return this.#policy;
  }

  /** C20 冻结查询输入窄读：基线用工作项文本，补搜用同一动作的稳定意图记录。 */
  get queryInputReader(): HybridRetrievalInputReaderV1 {
    return {
      readExact: async (input) => {
        const options = this.#options;
        const exact = await options.inputReader.readExact({
          projectId: input.projectId,
          actorId: input.actorId,
          queryId: input.queryId,
          inputSnapshotRef: input.refs.inputSnapshotRef,
          workItemRef: input.refs.workItemRef,
          authorization: input.authorization,
        });
        if (exact.kind === "failed") {
          return {
            kind: "failed",
            code:
              exact.code === "IDENTIFICATION_INPUT_DRIFT" ? "RETRIEVAL_INPUT_DRIFT" : exact.code,
            detailCode: exact.detailCode,
          };
        }
        const snapshot = IdentificationInputSnapshotV1Schema.parse(exact.read.inputSnapshot);
        if (!sameRef(snapshot.retrievalPolicyRef, input.refs.retrievalPolicyRef)) {
          return { kind: "failed", code: "RETRIEVAL_INPUT_DRIFT", detailCode: "policy-ref-drift" };
        }
        const policy = await options.hybridPolicy.resolveExact({
          projectId: input.projectId,
          policyRef: snapshot.retrievalPolicyRef,
        });
        if (policy === undefined) {
          return {
            kind: "failed",
            code: "POLICY_NOT_FOUND",
            detailCode: "retrieval-policy-missing",
          };
        }
        const queryText = await this.#resolveFrozenQueryText({
          queryId: input.queryId,
          baselineQueryText: exact.read.workItem.frozenQueryText,
        });
        if (queryText === undefined) {
          return {
            kind: "failed",
            code: "RETRIEVAL_INPUT_DRIFT",
            detailCode: "query-text-unresolved",
          };
        }
        return {
          kind: "succeeded",
          input: {
            schemaVersion: "1",
            queryId: input.queryId,
            projectId: input.projectId,
            actorId: input.actorId,
            requestedAt: input.requestedAt,
            refs: {
              inputSnapshotRef: input.refs.inputSnapshotRef,
              workItemRef: input.refs.workItemRef,
              retrievalPolicyRef: input.refs.retrievalPolicyRef,
            },
            evidenceBaseReleaseRef: snapshot.retrievalEvidenceBaseReleaseRef,
            policy,
            queryText,
            authorizationScopeDigest: authorizationScopeDigest(input.authorization),
            authorizationContextRef: input.authorization.authorizationContextRef,
            authorization: input.authorization,
          },
        };
      },
    };
  }

  /** 补搜 queryId 只由任务与动作身份派生；文本必须来自本次动作的冻结意图，缺失即失败封闭。 */
  async #resolveFrozenQueryText(input: {
    readonly queryId: string;
    readonly baselineQueryText: string;
  }): Promise<string | undefined> {
    if (!isResupplementQueryId(input.queryId)) return input.baselineQueryText;
    // 意图工件在补搜动作内先行耐久；未证明效果可从稳定 queryId 查回时不重发、不猜文本。
    return this.#resupplementTextByQueryId.get(input.queryId);
  }

  // ------------------------------------------------------------ IP-02 关系检索

  async retrieve(query: KnowledgeRetrievalQueryV1): Promise<KnowledgeRetrievalResultV1> {
    const occurredAt = this.#now().toISOString();
    const parsed = parseRelationshipQuery(query);
    if (parsed === undefined) {
      return {
        kind: "failed",
        error: terminalFailure({ causalRunId: query.queryId, occurredAt, stage: "contract" }),
      };
    }
    const outcome = await this.#runRelationshipQuery(parsed, occurredAt).catch(() => ({
      kind: "failure" as const,
      failure: { kind: "terminal" as const, stage: "unexpected" },
    }));
    if (outcome.kind === "succeeded") return outcome.result;
    return {
      kind: "failed",
      error: this.#relationshipError(parsed.queryId, this.#now().toISOString(), outcome.failure),
    };
  }

  async #runRelationshipQuery(
    query: Extract<KnowledgeRetrievalQueryV1, { readonly kind: "relationship-context" }>,
    occurredAt: string,
  ): Promise<
    | { readonly kind: "succeeded"; readonly result: IdentificationContextQueryResultV1 }
    | { readonly kind: "failure"; readonly failure: RelationshipFailure }
  > {
    const options = this.#options;
    if (!this.#hasRetrieveCapability(query.authorization, query.projectId, query.actorId)) {
      return { kind: "failure", failure: { kind: "authorization" } };
    }
    const exact = await options.inputReader.readExact({
      projectId: query.projectId,
      actorId: query.actorId,
      queryId: query.queryId,
      inputSnapshotRef: query.payload.inputSnapshotRef,
      workItemRef: query.payload.workItemRef,
      authorization: query.authorization,
    });
    if (exact.kind === "failed") {
      return {
        kind: "failure",
        failure: this.#failureFromInputRead(
          exact.code,
          exact.detailCode,
          query.payload.workItemRef,
        ),
      };
    }
    const workItem = exact.read.workItem;
    if (!sameRef(workItem.workItemRef.reference, query.payload.workItemRef.reference)) {
      return {
        kind: "failure",
        failure: {
          kind: "blocked",
          blockerKind: "input-drift",
          blockerRef: query.payload.workItemRef,
        },
      };
    }
    const snapshot = IdentificationInputSnapshotV1Schema.parse(exact.read.inputSnapshot);
    const verified = await options.authorization.verifyCurrent({
      authorization: query.authorization,
      invocationId: query.queryId,
      branch: "knowledge-modeling.relationship-context",
      requestedSpatialScopeRefs: [...workItem.spatialScopeRefs],
      requestedSourceVersionRefs: [...workItem.sourceVersionRefs],
    });
    if (verified === undefined) return { kind: "failure", failure: { kind: "authorization" } };
    const scopeDigest = authorizationScopeDigest(verified);
    const requestDigest = relationshipRequestDigest({
      refs: query.payload,
      nodeId: workItem.nodeId,
      releaseRefs: {
        processModel: snapshot.processModelReleaseRef.reference,
        riskMechanism: snapshot.riskMechanismReleaseRef.reference,
        retrievalEvidenceBase: snapshot.retrievalEvidenceBaseReleaseRef.reference,
      },
      authorizationScopeDigest: scopeDigest,
    });
    const stored = await options.resultStore.readRelationshipResult({
      projectId: query.projectId,
      queryId: query.queryId,
    });
    if (stored !== undefined) {
      if (stored.requestDigest !== requestDigest) {
        return {
          kind: "failure",
          failure: {
            kind: "idempotency-conflict",
            priorCommandId: `relationship-query-result:${query.projectId}:${query.queryId}`,
          },
        };
      }
      return {
        kind: "succeeded",
        result: {
          kind: "succeeded",
          result: { knowledgeQueryResultRef: stored.knowledgeQueryResultRef },
        },
      };
    }
    const facts = await this.#readRelationshipFacts({
      projectId: query.projectId,
      actorId: query.actorId,
      queryId: query.queryId,
      requestedAt: query.requestedAt,
      nodeId: workItem.nodeId,
      spatialScopeRefs: [...workItem.spatialScopeRefs],
      sourceVersionRefs: [...workItem.sourceVersionRefs],
      snapshot,
    });
    if (facts.kind === "failure") return { kind: "failure", failure: facts.failure };
    const closing = await options.authorization.verifyCurrent({
      authorization: query.authorization,
      invocationId: query.queryId,
      branch: "knowledge-modeling.relationship-context",
      requestedSpatialScopeRefs: [...workItem.spatialScopeRefs],
      requestedSourceVersionRefs: [...workItem.sourceVersionRefs],
    });
    if (closing === undefined) return { kind: "failure", failure: { kind: "authorization" } };
    const knowledgeQueryResultRef = relationshipQueryResultRefFor({
      projectId: query.projectId,
      queryId: query.queryId,
      requestDigest,
    });
    const payload = RelationshipContextPayloadV1Schema.parse({
      schemaVersion: IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1,
      projectId: query.projectId,
      queryId: query.queryId,
      actorId: query.actorId,
      requestedAt: query.requestedAt,
      completedAt: this.#now().toISOString(),
      inputSnapshotRef: query.payload.inputSnapshotRef,
      workItemRef: query.payload.workItemRef,
      nodeId: workItem.nodeId,
      policySetRef: snapshot.identificationPolicySetRef,
      retrievalPolicyRef: snapshot.retrievalPolicyRef,
      reviewAgentPolicyRef: snapshot.retrievalReviewAgentPolicyRef,
      releaseBinding: facts.binding,
      currentNode: facts.currentNode,
      neighborNodes: facts.neighbors,
      dependencyEdges: facts.edges,
      mechanisms: facts.mechanisms,
      excludedMechanisms: facts.excluded,
      authorizationScopeDigest: scopeDigest,
      authorizationContextRef: closing.authorizationContextRef,
      knowledgeQueryResultRef,
    });
    const row: IdentificationContextResultRowV1 = {
      schemaVersion: IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1,
      resultKind: "relationship",
      projectId: query.projectId,
      resultId: knowledgeQueryResultRef.reference.entityId,
      resultVersionId: requestDigest,
      requestDigest,
      artifactRef: { kind: "content-artifact", reference: { entityId: "", versionId: "" } },
      inputSnapshotRef: query.payload.inputSnapshotRef,
      workItemRef: query.payload.workItemRef,
      authorizationScopeDigest: scopeDigest,
      actorRef: query.actorId,
      authorizationContextRef: closing.authorizationContextRef,
      queryId: query.queryId,
      knowledgeQueryResultRef,
    };
    const persisted = await this.#persistResult({
      row,
      occurredAt,
      authorization: closing,
      artifactId: `relationship-query-result-${query.queryId}`,
      purposeCode: RELATIONSHIP_PURPOSE_CODE_V1,
      value: payload,
      resultRef: knowledgeQueryResultRef,
      commandKind: "identification.relationship-query-result.register",
    });
    if (persisted.kind !== "succeeded") {
      return {
        kind: "failure",
        failure:
          persisted.kind === "idempotency-conflict"
            ? { kind: "idempotency-conflict", priorCommandId: persisted.priorCommandId }
            : { kind: "terminal", stage: "persistence" },
      };
    }
    return {
      kind: "succeeded",
      result: { kind: "succeeded", result: { knowledgeQueryResultRef } },
    };
  }

  #hasRetrieveCapability(
    authorization: AuthorizationContextV1,
    projectId: string,
    actorId: string,
  ): boolean {
    return (
      authorization.projectId === projectId &&
      authorization.actorId === actorId &&
      authorization.grantedCapabilities.includes("knowledge-modeling.retrieve")
    );
  }

  #failureFromInputRead(
    code: string,
    detailCode: string,
    workItemRef: ContractReferenceV1,
  ): RelationshipFailure {
    if (code === "AUTHORIZATION_DENIED") return { kind: "authorization" };
    return {
      kind: "blocked",
      blockerKind: code === "POLICY_NOT_FOUND" ? "policy-not-found" : detailCode,
      blockerRef: workItemRef,
    };
  }

  /** 一跳关系与适用机理：只读三个精确发布，缺端或错配即封闭失败。 */
  async #readRelationshipFacts(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly queryId: string;
    readonly requestedAt: string;
    readonly nodeId: string;
    readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
    readonly sourceVersionRefs: readonly SourceVersionRefV1[];
    readonly snapshot: import("@riskflow/contracts/workflows").IdentificationInputSnapshotV1;
  }): Promise<
    | {
        readonly kind: "succeeded";
        readonly binding: RelationshipContextPayloadV1["releaseBinding"];
        readonly currentNode: RelationshipContextPayloadV1["currentNode"];
        readonly neighbors: RelationshipContextPayloadV1["neighborNodes"];
        readonly edges: RelationshipContextPayloadV1["dependencyEdges"];
        readonly mechanisms: RelationshipContextPayloadV1["mechanisms"];
        readonly excluded: RelationshipContextPayloadV1["excludedMechanisms"];
      }
    | { readonly kind: "failure"; readonly failure: RelationshipFailure }
  > {
    const options = this.#options;
    const readContext = await options.authorization.issueReadContext({
      projectId: input.projectId,
      actorId: input.actorId,
      invocationId: `c21-identification-basis:${input.queryId}`,
      requestedAt: input.requestedAt,
      requestedSpatialScopeRefs: [...input.spatialScopeRefs],
      requestedSourceVersionRefs: [...input.sourceVersionRefs],
    });
    const releases = [
      { ref: input.snapshot.processModelReleaseRef.reference, expected: "process-model" },
      { ref: input.snapshot.riskMechanismReleaseRef.reference, expected: "risk-mechanism" },
      {
        ref: input.snapshot.retrievalEvidenceBaseReleaseRef.reference,
        expected: "retrieval-evidence-base",
      },
    ] as const;
    const reads: IdentificationKnowledgeExactReadV1[] = [];
    for (const item of releases) {
      const releaseRef = asReleaseRef(item.ref);
      const read = await options.knowledgeReader.readExact({
        projectId: input.projectId,
        releaseRef,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        invocationId: identificationBasisReadInvocationIdFor({
          queryId: input.queryId,
          releaseRef,
        }),
        authorization: readContext,
      });
      if (read.kind === "failed") {
        return {
          kind: "failure",
          failure:
            read.error.code === "AUTHORIZATION_DENIED"
              ? { kind: "authorization" }
              : {
                  kind: "blocked",
                  blockerKind: "source-facts-missing",
                  blockerRef: releaseRef,
                },
        };
      }
      if (
        read.read.package.definitionType !== item.expected ||
        read.read.package.projectId !== input.projectId
      ) {
        return {
          kind: "failure",
          failure: {
            kind: "blocked",
            blockerKind: "release-binding-drift",
            blockerRef: releaseRef,
          },
        };
      }
      reads.push(read.read);
    }
    const [processModelRead, mechanismRead, evidenceBaseRead] = reads as [
      IdentificationKnowledgeExactReadV1,
      IdentificationKnowledgeExactReadV1,
      IdentificationKnowledgeExactReadV1,
    ];
    if (
      processModelRead.package.definitionType !== "process-model" ||
      mechanismRead.package.definitionType !== "risk-mechanism" ||
      evidenceBaseRead.package.definitionType !== "retrieval-evidence-base"
    ) {
      return {
        kind: "failure",
        failure: {
          kind: "blocked",
          blockerKind: "release-definition-drift",
          blockerRef: input.snapshot.processModelReleaseRef,
        },
      };
    }
    const processModel = processModelRead.package;
    const mechanismPackage = mechanismRead.package;
    const memberReleaseRefs = evidenceBaseRead.releaseBinding.compositeMemberReleaseRefs;
    if (
      !sameRef(
        mechanismPackage.processModelReleaseRef.reference,
        processModelRead.releaseBinding.releaseRef.reference,
      ) ||
      !sameRef(
        processModelRead.releaseBinding.releaseRef.reference,
        input.snapshot.processModelReleaseRef.reference,
      )
    ) {
      return {
        kind: "failure",
        failure: {
          kind: "blocked",
          blockerKind: "release-composition-mismatch",
          blockerRef: input.snapshot.riskMechanismReleaseRef,
        },
      };
    }
    if (
      memberReleaseRefs === undefined ||
      memberReleaseRefs.length !== 3 ||
      !memberReleaseRefs.some((member) =>
        sameRef(member.reference, mechanismRead.releaseBinding.releaseRef.reference),
      )
    ) {
      return {
        kind: "failure",
        failure: {
          kind: "blocked",
          blockerKind: "evidence-base-composition-mismatch",
          blockerRef: input.snapshot.retrievalEvidenceBaseReleaseRef,
        },
      };
    }
    const node = processModel.nodes.find((candidate) => candidate.nodeId === input.nodeId);
    if (node === undefined) {
      return {
        kind: "failure",
        failure: {
          kind: "blocked",
          blockerKind: "work-item-node-missing",
          blockerRef: input.snapshot.processModelReleaseRef,
        },
      };
    }
    const nodeById = new Map(processModel.nodes.map((candidate) => [candidate.nodeId, candidate]));
    const incident = processModel.dependencyEdges.filter(
      (edge) => edge.fromNodeId === node.nodeId || edge.toNodeId === node.nodeId,
    );
    if (incident.some((edge) => !nodeById.has(edge.fromNodeId) || !nodeById.has(edge.toNodeId))) {
      return {
        kind: "failure",
        failure: {
          kind: "blocked",
          blockerKind: "relationship-broken",
          blockerRef: input.snapshot.processModelReleaseRef,
        },
      };
    }
    const neighbors = incident.map((edge) => {
      const neighbor = nodeById.get(
        edge.fromNodeId === node.nodeId ? edge.toNodeId : edge.fromNodeId,
      );
      return {
        nodeId: neighbor?.nodeId ?? "",
        processKind: neighbor?.processKind ?? node.processKind,
        edgeId: edge.edgeId,
        relationType: edge.relationType,
        upstream: edge.toNodeId === node.nodeId,
        evidence: edge.evidence,
      };
    });
    const related = mechanismPackage.mechanisms.filter((entry) =>
      entry.nodeIds.includes(node.nodeId),
    );
    const mechanisms = related
      .filter((entry) => applicabilityCovers(node, entry))
      .map((entry) => ({
        mechanismId: entry.mechanismId,
        mechanismType: entry.mechanismType,
        stateParameters: entry.stateParameters,
        monitoringIndicators: entry.monitoringIndicators,
        evidence: entry.evidence,
      }));
    const excluded = related
      .filter((entry) => !applicabilityCovers(node, entry))
      .map((entry) => ({
        mechanismId: entry.mechanismId,
        reasonCode: "mechanism-applicability-mismatch",
      }));
    return {
      kind: "succeeded",
      binding: {
        processModelReleaseRef: processModelRead.releaseBinding.releaseRef,
        processModelPackageDigest: processModelRead.validation.packageDigest,
        riskMechanismReleaseRef: mechanismRead.releaseBinding.releaseRef,
        riskMechanismPackageDigest: mechanismRead.validation.packageDigest,
        retrievalEvidenceBaseReleaseRef: evidenceBaseRead.releaseBinding.releaseRef,
        retrievalEvidenceBasePackageDigest: evidenceBaseRead.validation.packageDigest,
        compositeMemberReleaseRefs: memberReleaseRefs,
      },
      currentNode: {
        nodeId: node.nodeId,
        processKind: node.processKind,
        inputs: node.inputs,
        outputs: node.outputs,
        stateParameters: node.stateParameters,
        monitoringIndicators: node.monitoringIndicators,
        applicability: node.applicability,
        evidence: node.evidence,
      },
      neighbors,
      edges: incident,
      mechanisms,
      excluded,
    };
  }

  #relationshipError(
    causalRunId: string,
    occurredAt: string,
    failure: RelationshipFailure,
  ): ModuleErrorV1 {
    switch (failure.kind) {
      case "authorization":
        return authorizationDenied({ causalRunId, occurredAt, policyRef: this.#policy.policyRef });
      case "blocked":
        return blocked({
          causalRunId,
          occurredAt,
          blockerKind: failure.blockerKind,
          blockerRef: failure.blockerRef,
        });
      case "idempotency-conflict":
        return idempotencyConflict({
          causalRunId,
          occurredAt,
          idempotencyKey: causalRunId,
          priorCommandId: failure.priorCommandId,
        });
      case "terminal":
        return terminalFailure({ causalRunId, occurredAt, stage: failure.stage });
    }
  }

  // ----------------------------------------------------------- C04 先耐久、C03 收口

  async #persistResult(input: {
    readonly row: IdentificationContextResultRowV1;
    readonly occurredAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly artifactId: string;
    readonly purposeCode: string;
    readonly value: unknown;
    readonly resultRef: ContractReferenceV1;
    readonly commandKind: string;
  }): Promise<
    | { readonly kind: "succeeded"; readonly artifactRef: ArtifactRefV1 }
    | { readonly kind: "idempotency-conflict"; readonly priorCommandId: string }
    | { readonly kind: "failed"; readonly error: unknown }
  > {
    const options = this.#options;
    const commandId = `${input.artifactId}:register`;
    let artifactRef: ArtifactRefV1;
    try {
      artifactRef = await this.#putArtifact({
        artifactId: input.artifactId,
        projectId: input.row.projectId,
        actorId: input.row.actorRef,
        issuedAt: input.occurredAt,
        purposeCode: input.purposeCode,
        authorization: input.authorization,
        value: input.value,
        commandId: `${input.artifactId}:put`,
      });
    } catch (error: unknown) {
      return { kind: "failed", error };
    }
    const row = IdentificationContextResultRowV1Schema.parse({
      ...input.row,
      artifactRef: { kind: "content-artifact", reference: artifactRef.reference },
    });
    const command = {
      projectId: row.projectId,
      commandKind: input.commandKind,
      commandId,
      idempotencyKey: commandId,
      payload: {
        resultKind: row.resultKind,
        resultId: row.resultId,
        resultVersionId: row.resultVersionId,
        requestDigest: row.requestDigest,
      },
      actorRef: row.actorRef,
      authorizationContextRef: row.authorizationContextRef,
      issuedAt: input.occurredAt,
    };
    let aborted = false;
    try {
      await options.transactionUnit.execute(command, async (context: TransactionContextV1) => {
        const registration = await options.resultStore.registerResult(
          { row, occurredAt: input.occurredAt },
          context,
        );
        if (registration.kind === "idempotency-conflict") {
          aborted = true;
          throw new ContextTransactionAbort();
        }
        return {
          resultRef: input.resultRef,
          audit: {
            auditEntryId: `${commandId}:audit`,
            projectId: row.projectId,
            action: input.commandKind,
            targetRef: input.resultRef,
            actorRef: row.actorRef,
            authorizationContextRef: row.authorizationContextRef,
            occurredAt: input.occurredAt,
            recordedAt: this.#now().toISOString(),
            version: { entityId: input.artifactId, versionId: row.resultVersionId },
            commandId,
            idempotencyKey: commandId,
          },
          events: [],
        };
      });
    } catch (error: unknown) {
      if (aborted) return { kind: "idempotency-conflict", priorCommandId: commandId };
      return { kind: "failed", error };
    }
    return { kind: "succeeded", artifactRef };
  }

  async #putArtifact(input: {
    readonly artifactId: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly purposeCode: string;
    readonly authorization: AuthorizationContextV1;
    readonly value: unknown;
    readonly commandId: string;
  }): Promise<ArtifactRefV1> {
    const requiredCapability = input.authorization.grantedCapabilities[0];
    if (requiredCapability === undefined) {
      throw new IdentificationContextError(
        authorizationDenied({
          causalRunId: input.artifactId,
          occurredAt: this.#now().toISOString(),
          policyRef: this.#policy.policyRef,
        }),
      );
    }
    const result = await this.#options.artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: "1",
        commandId: input.commandId,
        idempotencyKey: input.commandId,
        projectId: input.projectId,
        actorId: input.actorId,
        issuedAt: input.issuedAt,
        authorization: input.authorization,
        requiredCapability,
        artifactId: input.artifactId,
        artifactKind: "content",
        purposeCode: input.purposeCode,
        mediaType: "application/json",
        parentArtifactRefs: [],
        evidenceReferences: [],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      }),
      (async function* () {
        yield new TextEncoder().encode(JSON.stringify(input.value));
      })(),
    );
    return result.artifactRef;
  }

  async #readArtifactJson(input: {
    readonly artifactRef: ArtifactRefV1;
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly purposeCode: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<unknown> {
    const readId = `c21-read-${randomUUID()}`;
    const requiredCapability = input.authorization.grantedCapabilities[0];
    if (requiredCapability === undefined) {
      throw new IdentificationContextError(
        authorizationDenied({
          causalRunId: input.artifactRef.reference.entityId,
          occurredAt: this.#now().toISOString(),
          policyRef: this.#policy.policyRef,
        }),
      );
    }
    const handle = await this.#options.artifactStore.open({
      schemaVersion: "1",
      requestId: readId,
      idempotencyKey: readId,
      artifactRef: input.artifactRef,
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      purposeCode: input.purposeCode,
      requiredCapability,
      authorization: input.authorization,
    });
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of handle.content) {
      size += chunk.byteLength;
      if (size > MAX_ARTIFACT_BYTES_V1) throw new RangeError("artifact exceeds the bounded read");
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

  // ---------------------------------------------------- IP-04 基线与有界补搜

  /** 冻结 C20 正式基线与关系结果，写候选集 v1；返回 C08 启动命令所需的冻结输入引用。 */
  async prepareReview(
    input: PrepareRetrievalReviewInputV1,
  ): Promise<PrepareRetrievalReviewResultV1> {
    const options = this.#options;
    const exact = await options.inputReader.readExact({
      projectId: input.projectId,
      actorId: input.actorId,
      queryId: input.taskRef.reference.entityId,
      inputSnapshotRef: input.inputSnapshotRef,
      workItemRef: input.workItemRef,
      authorization: input.authorization,
    });
    if (exact.kind === "failed") {
      throw new IdentificationContextError(
        exact.code === "AUTHORIZATION_DENIED"
          ? authorizationDenied({
              causalRunId: input.taskRef.reference.entityId,
              occurredAt: this.#now().toISOString(),
              policyRef: this.#policy.policyRef,
            })
          : blocked({
              causalRunId: input.taskRef.reference.entityId,
              occurredAt: this.#now().toISOString(),
              blockerKind: exact.detailCode,
              blockerRef: input.workItemRef,
            }),
      );
    }
    const snapshot = IdentificationInputSnapshotV1Schema.parse(exact.read.inputSnapshot);
    if (!sameRef(snapshot.retrievalReviewAgentPolicyRef, this.#policy.policyRef)) {
      throw new IdentificationContextError(
        blocked({
          causalRunId: input.taskRef.reference.entityId,
          occurredAt: this.#now().toISOString(),
          blockerKind: "review-policy-drift",
          blockerRef: input.workItemRef,
        }),
      );
    }
    const workItem = exact.read.workItem;
    if (workItem.spatialScopeRefs.length === 0 || workItem.sourceVersionRefs.length === 0) {
      throw new IdentificationContextError(
        authorizationDenied({
          causalRunId: input.taskRef.reference.entityId,
          occurredAt: this.#now().toISOString(),
          policyRef: this.#policy.policyRef,
        }),
      );
    }
    const current = await options.authorization.verifyCurrent({
      authorization: input.authorization,
      invocationId: input.taskRef.reference.entityId,
      branch: "knowledge-modeling.relationship-context",
      requestedSpatialScopeRefs: [...workItem.spatialScopeRefs],
      requestedSourceVersionRefs: [...workItem.sourceVersionRefs],
    });
    if (current === undefined) {
      throw new IdentificationContextError(
        authorizationDenied({
          causalRunId: input.taskRef.reference.entityId,
          occurredAt: this.#now().toISOString(),
          policyRef: this.#policy.policyRef,
        }),
      );
    }
    const nodeId = exact.read.workItem.nodeId;
    const relationship = await this.retrieve({
      queryId: relationshipQueryIdFor(nodeId),
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      authorization: input.authorization,
      kind: "relationship-context",
      payload: { inputSnapshotRef: input.inputSnapshotRef, workItemRef: input.workItemRef },
    });
    if (relationship.kind !== "succeeded") {
      throw new IdentificationContextError(
        relationship.kind === "failed"
          ? relationship.error
          : blocked({
              causalRunId: input.taskRef.reference.entityId,
              occurredAt: this.#now().toISOString(),
              blockerKind: "relationship-query-waiting",
              blockerRef: input.workItemRef,
            }),
      );
    }
    const relationshipQueryResultRef = relationship.result.knowledgeQueryResultRef;
    const baselineQueryResultRef = await this.#runBaselineQuery({
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      authorization: input.authorization,
      inputSnapshotRef: input.inputSnapshotRef,
      workItemRef: input.workItemRef,
      retrievalPolicyRef: snapshot.retrievalPolicyRef,
      nodeId,
    });
    const baseline = await this.readOfficialHybrid({
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      queryId: baselineQueryIdFor(nodeId),
      expectedQueryResultRef: baselineQueryResultRef,
      authorization: input.authorization,
    });
    const members = await this.#freezeMembers({
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      authorization: input.authorization,
      originQueryResultRef: baseline.knowledgeQueryResultRef,
      origin: "baseline",
      payload: baseline.payload,
    });
    const candidateSet = RetrievalReviewCandidateSetV1Schema.parse({
      schemaVersion: IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1,
      projectId: input.projectId,
      taskRef: input.taskRef,
      nodeId,
      inputSnapshotRef: input.inputSnapshotRef,
      workItemRef: input.workItemRef,
      relationshipQueryResultRef,
      baselineQueryResultRef: baseline.knowledgeQueryResultRef,
      baselineRequestDigest: baseline.requestDigest,
      generationRef: baseline.payload.generationRef,
      retrievalPolicyRef: snapshot.retrievalPolicyRef,
      reviewAgentPolicyRef: snapshot.retrievalReviewAgentPolicyRef,
      frozenQueryText: exact.read.workItem.frozenQueryText,
      candidateVersion: 1,
      resupplements: [],
      members,
      frozenAuthorizationScopeDigest: authorizationScopeDigest(input.authorization),
      frozenAuthorizationContextRef: input.authorization.authorizationContextRef,
      frozenAt: this.#now().toISOString(),
    });
    const artifactId = `retrieval-review-candidate-set-${input.taskRef.reference.entityId}`;
    const candidateSetRef = await this.#putArtifact({
      artifactId,
      projectId: input.projectId,
      actorId: input.actorId,
      issuedAt: input.requestedAt,
      purposeCode: CANDIDATE_SET_PURPOSE_CODE_V1,
      authorization: input.authorization,
      value: candidateSet,
      commandId: `${artifactId}:v1`,
    });
    return { candidateSetRef, candidateSet, baselineQueryResultRef };
  }

  async #runBaselineQuery(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly inputSnapshotRef: PrepareRetrievalReviewInputV1["inputSnapshotRef"];
    readonly workItemRef: PrepareRetrievalReviewInputV1["workItemRef"];
    readonly retrievalPolicyRef: VersionReference;
    readonly nodeId: string;
  }): Promise<KnowledgeQueryResultRefV1> {
    const queryId = baselineQueryIdFor(input.nodeId);
    const result = await this.#options.retrievalService.retrieve({
      queryId,
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      authorization: input.authorization,
      kind: "hybrid-evidence",
      payload: {
        inputSnapshotRef: input.inputSnapshotRef,
        workItemRef: input.workItemRef,
        retrievalPolicyRef: input.retrievalPolicyRef,
      },
    } as KnowledgeRetrievalQueryV1);
    if (result.kind !== "succeeded") {
      throw new IdentificationContextError(
        result.kind === "failed"
          ? result.error
          : blocked({
              causalRunId: queryId,
              occurredAt: this.#now().toISOString(),
              blockerKind: "baseline-waiting",
              blockerRef: input.workItemRef,
            }),
      );
    }
    return result.result.knowledgeQueryResultRef;
  }

  /** 回读 C20 正式结果正文并逐项核对结果引用、工程、查询身份与授权摘要。 */
  async readOfficialHybrid(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly queryId: string;
    readonly expectedQueryResultRef?: KnowledgeQueryResultRefV1;
    readonly authorization: AuthorizationContextV1;
  }): Promise<OfficialHybridResultV1> {
    const options = this.#options;
    const official = await options.officialHybrid.readOfficial({
      projectId: input.projectId,
      queryId: input.queryId,
      actorId: input.actorId,
      requestedAt: input.requestedAt,
      authorization: input.authorization,
    });
    if (official.kind === "failed") {
      throw new IdentificationContextError(
        official.code === "AUTHORIZATION_DENIED"
          ? authorizationDenied({
              causalRunId: input.queryId,
              occurredAt: this.#now().toISOString(),
              policyRef: this.#policy.policyRef,
            })
          : blocked({
              causalRunId: input.queryId,
              occurredAt: this.#now().toISOString(),
              blockerKind: `hybrid-${official.detailCode}`,
              blockerRef: input.authorization.authorizationContextRef,
            }),
      );
    }
    const payload = HybridRetrievalResultPayloadV1Schema.parse(official.result.payload);
    if (
      payload.projectId !== input.projectId ||
      payload.queryId !== input.queryId ||
      !sameRef(
        payload.knowledgeQueryResultRef.reference,
        official.result.knowledgeQueryResultRef.reference,
      ) ||
      payload.authorizationScopeDigest !== authorizationScopeDigest(input.authorization)
    ) {
      throw new IdentificationContextError(
        blocked({
          causalRunId: input.queryId,
          occurredAt: this.#now().toISOString(),
          blockerKind: "hybrid-result-drift",
          blockerRef: official.result.knowledgeQueryResultRef,
        }),
      );
    }
    if (
      input.expectedQueryResultRef !== undefined &&
      !sameRef(
        input.expectedQueryResultRef.reference,
        official.result.knowledgeQueryResultRef.reference,
      )
    ) {
      throw new IdentificationContextError(
        blocked({
          causalRunId: input.queryId,
          occurredAt: this.#now().toISOString(),
          blockerKind: "hybrid-result-ref-mismatch",
          blockerRef: input.expectedQueryResultRef,
        }),
      );
    }
    return official.result;
  }

  /** 把命中解析成冻结候选：成员证据来自 C17 精确发布条目，越界成员直接丢弃。 */
  async #freezeMembers(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly originQueryResultRef: KnowledgeQueryResultRefV1;
    readonly origin: "baseline" | "resupplement";
    readonly payload: HybridRetrievalResultPayloadV1;
    readonly existing?: readonly RetrievalReviewCandidateV1[];
  }): Promise<readonly RetrievalReviewCandidateV1[]> {
    const options = this.#options;
    const exact = await options.inputReader.readExact({
      projectId: input.projectId,
      actorId: input.actorId,
      queryId: input.payload.queryId,
      inputSnapshotRef: input.payload.refs.inputSnapshotRef,
      workItemRef: input.payload.refs.workItemRef,
      authorization: input.authorization,
    });
    if (
      exact.kind === "failed" ||
      exact.read.workItem.spatialScopeRefs.length === 0 ||
      exact.read.workItem.sourceVersionRefs.length === 0
    ) {
      throw new IdentificationContextError(
        authorizationDenied({
          causalRunId: input.payload.queryId,
          occurredAt: this.#now().toISOString(),
          policyRef: this.#policy.policyRef,
        }),
      );
    }
    const readContext = await options.authorization.issueReadContext({
      projectId: input.projectId,
      actorId: input.actorId,
      invocationId: `c21-fact-read:${input.originQueryResultRef.reference.entityId}`,
      requestedAt: input.requestedAt,
      requestedSpatialScopeRefs: [...exact.read.workItem.spatialScopeRefs],
      requestedSourceVersionRefs: [...exact.read.workItem.sourceVersionRefs],
    });
    const cache = new Map<string, IdentificationKnowledgeExactReadV1>();
    const members: RetrievalReviewCandidateV1[] = [...(input.existing ?? [])];
    const known = new Set(members.map((member) => member.memberRef.reference.entityId));
    for (const hit of input.payload.hits) {
      if (known.has(hit.memberRef.reference.entityId)) continue;
      if (members.length >= this.#policy.maxCandidateMembers) break;
      const releaseKey = `${hit.sourceReleaseRef.reference.entityId}:${hit.sourceReleaseRef.reference.versionId}`;
      let read = cache.get(releaseKey);
      if (read === undefined) {
        const result = await options.knowledgeReader.readExact({
          projectId: input.projectId,
          releaseRef: hit.sourceReleaseRef,
          actorId: input.actorId,
          requestedAt: input.requestedAt,
          invocationId: identificationBasisReadInvocationIdFor({
            queryId: input.originQueryResultRef.reference.entityId,
            releaseRef: hit.sourceReleaseRef,
          }),
          authorization: readContext,
        });
        if (result.kind === "failed") {
          throw new IdentificationContextError(
            result.error.code === "AUTHORIZATION_DENIED"
              ? authorizationDenied({
                  causalRunId: input.originQueryResultRef.reference.entityId,
                  occurredAt: this.#now().toISOString(),
                  policyRef: this.#policy.policyRef,
                })
              : blocked({
                  causalRunId: input.originQueryResultRef.reference.entityId,
                  occurredAt: this.#now().toISOString(),
                  blockerKind: "candidate-release-missing",
                  blockerRef: hit.sourceReleaseRef,
                }),
          );
        }
        read = result.read;
        cache.set(releaseKey, read);
      }
      const evidence = entryEvidenceOf(read, hit.sourceKind, hit.sourceEntryId);
      if (evidence === undefined) continue;
      members.push({
        memberRef: hit.memberRef,
        sourceKind: hit.sourceKind,
        sourceReleaseRef: hit.sourceReleaseRef,
        sourceEntryId: hit.sourceEntryId,
        contentDigest: hit.contentDigest,
        evidenceSourceVersionRefs: hit.evidenceSourceVersionRefs,
        evidence: [...evidence],
        origin: input.origin,
        originQueryResultRef: input.originQueryResultRef,
        rank: hit.rank,
        fusionScore: hit.fusionScore,
      });
      known.add(hit.memberRef.reference.entityId);
    }
    if (members.length === 0) {
      throw new IdentificationContextError(
        blocked({
          causalRunId: input.originQueryResultRef.reference.entityId,
          occurredAt: this.#now().toISOString(),
          blockerKind: "candidate-set-empty",
          blockerRef: input.originQueryResultRef,
        }),
      );
    }
    return members;
  }

  // ------------------------------------------------------- IP-05 定义、工具与收口

  createTaskDefinition(): AgentTaskDefinitionV1 {
    const policy = this.#policy;
    const readFrozen: AgentDomainToolV1 = {
      toolRef: policy.readFrozenResultToolRef,
      budgetUsage: { objects: 1 },
      execute: (input, context) => this.readFrozenResult(input, context),
    };
    const resupplement: AgentDomainToolV1 = {
      toolRef: policy.resupplementToolRef,
      budgetUsage: { supplementarySearches: 1, objects: 1 },
      execute: (input, context) => this.boundedHybridResupplement(input, context),
    };
    return {
      metadata: AgentTaskDefinitionMetadataV1Schema.parse({
        schemaVersion: "1",
        definitionRef: policy.definitionRef,
        taskType: RETRIEVAL_REVIEW_TASK_TYPE,
        toolPolicyRef: policy.toolPolicyRef,
        incrementSchemaRef: policy.incrementSchemaRef,
        validationPolicyRef: policy.validationPolicyRef,
        supportedTriggerModes: ["embedded"],
        allowedToolRefs: [policy.readFrozenResultToolRef, policy.resupplementToolRef],
        resultFamilies: ["retrieval-artifact-set"],
      }),
      budgetPolicy: {
        schemaVersion: "1",
        policyRef: policy.budgetPolicyRef,
        modelDeploymentRef: policy.modelDeploymentRef,
        promptTemplateRef: policy.promptTemplateRef,
        toolPolicyRef: policy.toolPolicyRef,
        maxModelInvocations: 4,
        maxToolInvocations: 8,
        maxContextTokens: 16_384,
        maxInputBytes: 512_000,
        maxOutputBytes: 128_000,
        maxCandidates: 4,
        maxObjects: policy.maxCandidateMembers,
        maxSupplementarySearches: policy.maxResupplements,
        maxCorrections: 2,
        maxTransientRetries: 2,
        maxConcurrentActions: 1,
        maxWallClockMs: 600_000,
      },
      actionSchema: RetrievalReviewActionV1Schema,
      incrementSchema: RetrievalReviewIncrementV1Schema,
      candidateSchema: RetrievalReviewIncrementV1Schema,
      tools: [readFrozen, resupplement],
      measureCandidateUsage: (candidate) => {
        const typed = RetrievalReviewIncrementV1Schema.parse(candidate);
        return { candidates: 1, objects: typed.operations.length };
      },
      validateCandidate: async (candidate, task) =>
        await this.#validateCandidateForTask(candidate, task),
      finalizeCandidate: async (candidate, task) =>
        await this.finalizeRetrievalReview({ task, candidate }),
    };
  }

  async readFrozenResult(
    input: unknown,
    context: { readonly task: AgentTaskSnapshotV1; readonly actionId: string },
  ): Promise<Awaited<ReturnType<RetrievalReviewTaskPortV1["readFrozenResult"]>>> {
    const action = ReadFrozenResultActionV1Schema.parse(input);
    const task = context.task;
    const candidateSet = await this.#readCandidateSet(task, action.candidateSetRef);
    const knownQueries = [
      candidateSet.baselineQueryResultRef,
      ...candidateSet.resupplements.map((item) => item.queryResultRef),
    ];
    if (!knownQueries.some((ref) => sameRef(ref.reference, action.queryResultRef.reference))) {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_INPUT_INVALID",
          category: "input",
          retryable: false,
          stage: "worker.retrieval-review.tool.frozen-result",
          taskRef: task.envelope.agentTaskRef,
          actionId: context.actionId,
        }),
      );
    }
    const members = candidateSet.members
      .filter((member) =>
        sameRef(member.originQueryResultRef.reference, action.queryResultRef.reference),
      )
      .slice(0, action.maxMembers);
    const artifactRef = await this.#putArtifact({
      artifactId: `${resupplementArtifactIdFor(
        task.envelope.agentTaskRef.reference.entityId,
        context.actionId,
      )}:observation`,
      projectId: task.envelope.projectId,
      actorId: task.envelope.actorId,
      issuedAt: this.#now().toISOString(),
      purposeCode: OBSERVATION_PURPOSE_CODE_V1,
      authorization: task.envelope.authorization,
      value: {
        schemaVersion: IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1,
        candidateSetRef: action.candidateSetRef,
        candidateVersion: candidateSet.candidateVersion,
        queryResultRef: action.queryResultRef,
        members,
        resupplements: candidateSet.resupplements,
      },
      commandId: `${resupplementArtifactIdFor(
        task.envelope.agentTaskRef.reference.entityId,
        context.actionId,
      )}:observation`,
    });
    return { observationArtifactRef: artifactRef, effect: "none" };
  }

  async boundedHybridResupplement(
    input: unknown,
    context: { readonly task: AgentTaskSnapshotV1; readonly actionId: string },
  ): Promise<Awaited<ReturnType<RetrievalReviewTaskPortV1["boundedHybridResupplement"]>>> {
    const action = BoundedHybridResupplementActionV1Schema.parse(input);
    const options = this.#options;
    const task = context.task;
    if (!this.#policy.allowedSupplementIntentCodes.includes(action.supplementIntentCode)) {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_TOOL_NOT_ALLOWED",
          category: "tool",
          retryable: false,
          stage: "worker.retrieval-review.tool.resupplement.policy",
          taskRef: task.envelope.agentTaskRef,
          actionId: context.actionId,
        }),
      );
    }
    const candidateSet = await this.#readCandidateSet(task, action.candidateSetRef);
    if (candidateSet.resupplements.length >= this.#policy.maxResupplements) {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_BUDGET_EXHAUSTED",
          category: "budget",
          retryable: false,
          stage: "worker.retrieval-review.tool.resupplement.budget",
          taskRef: task.envelope.agentTaskRef,
          actionId: context.actionId,
        }),
      );
    }
    const knownEntryIds = new Set(candidateSet.members.map((member) => member.sourceEntryId));
    if (!action.anchorEntryIds.every((entryId) => knownEntryIds.has(entryId))) {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_TOOL_NOT_ALLOWED",
          category: "tool",
          retryable: false,
          stage: "worker.retrieval-review.tool.resupplement.anchor",
          taskRef: task.envelope.agentTaskRef,
          actionId: context.actionId,
        }),
      );
    }
    const taskEntityId = task.envelope.agentTaskRef.reference.entityId;
    const queryId = resupplementQueryIdFor(taskEntityId, context.actionId);
    const artifactId = resupplementArtifactIdFor(taskEntityId, context.actionId);
    const intent = RetrievalResupplementIntentV1Schema.parse({
      schemaVersion: IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1,
      projectId: task.envelope.projectId,
      taskRef: task.envelope.agentTaskRef,
      actionId: context.actionId,
      queryId,
      candidateSetRef: action.candidateSetRef,
      supplementIntentCode: action.supplementIntentCode,
      anchorEntryIds: action.anchorEntryIds,
      queryText: resupplementQueryTextFor({
        frozenQueryText: candidateSet.frozenQueryText,
        supplementIntentCode: action.supplementIntentCode,
        anchorEntryIds: action.anchorEntryIds,
      }),
      frozenAt: this.#now().toISOString(),
    });
    const intentArtifactRef = await this.#putArtifact({
      artifactId,
      projectId: task.envelope.projectId,
      actorId: task.envelope.actorId,
      issuedAt: this.#now().toISOString(),
      purposeCode: RESUPPLEMENT_INTENT_PURPOSE_CODE_V1,
      authorization: task.envelope.authorization,
      value: intent,
      commandId: `${artifactId}:put`,
    });
    const requestedAt = this.#now().toISOString();
    this.#resupplementTextByQueryId.set(queryId, intent.queryText);
    let result: KnowledgeRetrievalResultV1;
    try {
      result = await options.retrievalService.retrieve({
        queryId,
        projectId: task.envelope.projectId,
        actorId: task.envelope.actorId,
        requestedAt,
        authorization: task.envelope.authorization,
        kind: "hybrid-evidence",
        payload: {
          inputSnapshotRef: candidateSet.inputSnapshotRef,
          workItemRef: candidateSet.workItemRef,
          retrievalPolicyRef: candidateSet.retrievalPolicyRef,
        },
      } as KnowledgeRetrievalQueryV1);
    } finally {
      this.#resupplementTextByQueryId.delete(queryId);
    }
    if (result.kind !== "succeeded") {
      // 未确认外部效果不盲重试：保留意图工件并交回 C08 终态收口。
      return {
        observationArtifactRef: intentArtifactRef,
        effect: "uncertain",
        usage: { supplementarySearches: 1 },
      };
    }
    const official = await this.readOfficialHybrid({
      projectId: task.envelope.projectId,
      actorId: task.envelope.actorId,
      requestedAt,
      queryId,
      expectedQueryResultRef: result.result.knowledgeQueryResultRef,
      authorization: task.envelope.authorization,
    });
    const members = await this.#freezeMembers({
      projectId: task.envelope.projectId,
      actorId: task.envelope.actorId,
      requestedAt,
      authorization: task.envelope.authorization,
      originQueryResultRef: official.knowledgeQueryResultRef,
      origin: "resupplement",
      payload: official.payload,
      existing: candidateSet.members,
    });
    const resupplement: RetrievalReviewResupplementV1 = {
      resupplementRef: {
        entityId: `retrieval-resupplement:${queryId}`,
        versionId: official.requestDigest,
      },
      queryId,
      queryResultRef: official.knowledgeQueryResultRef,
      requestDigest: official.requestDigest,
      supplementIntentCode: action.supplementIntentCode,
      anchorEntryIds: action.anchorEntryIds,
      addedMemberCount: Math.max(0, members.length - candidateSet.members.length),
    };
    const nextCandidateSet = RetrievalReviewCandidateSetV1Schema.parse({
      ...candidateSet,
      candidateVersion: candidateSet.candidateVersion + 1,
      parentCandidateSetRef: action.candidateSetRef,
      resupplements: [...candidateSet.resupplements, resupplement],
      members: [...members],
    });
    const nextArtifactRef = await this.#putArtifact({
      artifactId: `${artifactId}:candidate-set`,
      projectId: task.envelope.projectId,
      actorId: task.envelope.actorId,
      issuedAt: this.#now().toISOString(),
      purposeCode: CANDIDATE_SET_PURPOSE_CODE_V1,
      authorization: task.envelope.authorization,
      value: nextCandidateSet,
      commandId: `${artifactId}:candidate-set:v${nextCandidateSet.candidateVersion}`,
    });
    return {
      observationArtifactRef: nextArtifactRef,
      resultRef: { kind: "content-artifact", reference: nextArtifactRef.reference },
      effect: "committed",
      usage: { supplementarySearches: 1, objects: 1 },
    };
  }

  async #readCandidateSet(
    task: AgentTaskSnapshotV1,
    candidateSetRef: { readonly reference: VersionReference },
  ): Promise<RetrievalReviewCandidateSetV1> {
    const value = await this.#readArtifactJson({
      artifactRef: { kind: "content-artifact", reference: candidateSetRef.reference },
      projectId: task.envelope.projectId,
      actorId: task.envelope.actorId,
      requestedAt: this.#now().toISOString(),
      purposeCode: CANDIDATE_SET_PURPOSE_CODE_V1,
      authorization: task.envelope.authorization,
    });
    const parsed = RetrievalReviewCandidateSetV1Schema.safeParse(value);
    if (
      !parsed.success ||
      parsed.data.projectId !== task.envelope.projectId ||
      parsed.data.taskRef.reference.entityId !== task.envelope.agentTaskRef.reference.entityId ||
      parsed.data.taskRef.reference.versionId !== task.envelope.agentTaskRef.reference.versionId
    ) {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_INPUT_INVALID",
          category: "input",
          retryable: false,
          stage: "worker.retrieval-review.candidate-set",
          taskRef: task.envelope.agentTaskRef,
        }),
      );
    }
    return parsed.data;
  }

  /** 逐项校验：候选成员、证据、版本与当前授权；可修正项与原任务预算内重试一致。 */
  async validateReviewIncrement(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: unknown;
  }): Promise<RetrievalReviewValidationOutcomeV1> {
    const task = input.task;
    const items: {
      checkId: string;
      disposition: "accepted" | "rejected";
      rejectionClass?: "repairable" | "terminal";
      reasonCode: string;
      evidenceReferences: EvidenceReference[];
    }[] = [];
    const parsed = RetrievalReviewIncrementV1Schema.safeParse(input.candidate);
    if (!parsed.success) {
      items.push({
        checkId: IDENTIFICATION_CONTEXT_CHECK_IDS_V1.incrementSchema,
        disposition: "rejected",
        rejectionClass: "repairable",
        reasonCode: IDENTIFICATION_CONTEXT_REASON_CODES_V1.schemaInvalid,
        evidenceReferences: [],
      });
      return await this.#validationOutcome(task, items, "repairable");
    }
    const increment = parsed.data;
    items.push({
      checkId: IDENTIFICATION_CONTEXT_CHECK_IDS_V1.incrementSchema,
      disposition: "accepted",
      reasonCode: IDENTIFICATION_CONTEXT_REASON_CODES_V1.accepted,
      evidenceReferences: [],
    });
    let candidateSet: RetrievalReviewCandidateSetV1 | undefined;
    try {
      candidateSet = await this.#readCandidateSet(task, increment.candidateSetRef);
      if (
        candidateSet.candidateVersion !== increment.candidateVersion ||
        candidateSet.frozenAuthorizationScopeDigest !==
          authorizationScopeDigest(task.envelope.authorization) ||
        !sameRef(
          candidateSet.frozenAuthorizationContextRef.reference,
          task.envelope.authorization.authorizationContextRef.reference,
        )
      ) {
        throw new Error("candidate version mismatch");
      }
      items.push({
        checkId: IDENTIFICATION_CONTEXT_CHECK_IDS_V1.candidateSetBinding,
        disposition: "accepted",
        reasonCode: IDENTIFICATION_CONTEXT_REASON_CODES_V1.accepted,
        evidenceReferences: [],
      });
    } catch {
      items.push({
        checkId: IDENTIFICATION_CONTEXT_CHECK_IDS_V1.candidateSetBinding,
        disposition: "rejected",
        rejectionClass: "terminal",
        reasonCode: IDENTIFICATION_CONTEXT_REASON_CODES_V1.candidateSetMismatch,
        evidenceReferences: [],
      });
    }
    if (candidateSet !== undefined) {
      const byEntity = new Map(
        candidateSet.members.map((member) => [member.memberRef.reference.entityId, member]),
      );
      for (const operation of increment.operations) {
        const member = byEntity.get(operation.memberRef.reference.entityId);
        if (
          member === undefined ||
          member.memberRef.reference.versionId !== operation.memberRef.reference.versionId
        ) {
          items.push({
            checkId: IDENTIFICATION_CONTEXT_CHECK_IDS_V1.candidateMembership,
            disposition: "rejected",
            rejectionClass: "terminal",
            reasonCode: IDENTIFICATION_CONTEXT_REASON_CODES_V1.candidateNotFrozen,
            evidenceReferences: [],
          });
          continue;
        }
        items.push({
          checkId: IDENTIFICATION_CONTEXT_CHECK_IDS_V1.candidateMembership,
          disposition: "accepted",
          reasonCode: IDENTIFICATION_CONTEXT_REASON_CODES_V1.accepted,
          evidenceReferences: [],
        });
        if (operation.operation !== "select") continue;
        const frozen = new Set(member.evidence.map((evidence) => evidenceReferenceKey(evidence)));
        const outside = operation.evidence.filter(
          (evidence) => !frozen.has(evidenceReferenceKey(evidence)),
        );
        items.push({
          checkId: IDENTIFICATION_CONTEXT_CHECK_IDS_V1.evidenceReachability,
          disposition: outside.length === 0 ? "accepted" : "rejected",
          ...(outside.length === 0 ? {} : { rejectionClass: "terminal" as const }),
          reasonCode:
            outside.length === 0
              ? IDENTIFICATION_CONTEXT_REASON_CODES_V1.accepted
              : IDENTIFICATION_CONTEXT_REASON_CODES_V1.evidenceNotFrozen,
          evidenceReferences: [...outside],
        });
      }
      const exact = await this.#options.inputReader.readExact({
        projectId: task.envelope.projectId,
        actorId: task.envelope.actorId,
        queryId: task.envelope.agentTaskRef.reference.entityId,
        inputSnapshotRef: candidateSet.inputSnapshotRef,
        workItemRef: candidateSet.workItemRef,
        authorization: task.envelope.authorization,
      });
      const current =
        exact.kind === "succeeded"
          ? await this.#options.authorization.verifyCurrent({
              authorization: task.envelope.authorization,
              invocationId: `${task.envelope.agentTaskRef.reference.entityId}:validate`,
              branch: "knowledge-modeling.relationship-context",
              requestedSpatialScopeRefs: [...exact.read.workItem.spatialScopeRefs],
              requestedSourceVersionRefs: [...exact.read.workItem.sourceVersionRefs],
            })
          : undefined;
      items.push({
        checkId: IDENTIFICATION_CONTEXT_CHECK_IDS_V1.currentAuthorization,
        disposition: current === undefined ? "rejected" : "accepted",
        ...(current === undefined ? { rejectionClass: "terminal" as const } : {}),
        reasonCode:
          current === undefined
            ? IDENTIFICATION_CONTEXT_REASON_CODES_V1.authorizationRevoked
            : IDENTIFICATION_CONTEXT_REASON_CODES_V1.accepted,
        evidenceReferences: [],
      });
    }
    const rejected = items.filter((item) => item.disposition === "rejected");
    if (rejected.length === 0) return await this.#validationOutcome(task, items, undefined);
    const rejectionClass: "repairable" | "terminal" = rejected.some(
      (item) => item.rejectionClass === "terminal",
    )
      ? "terminal"
      : "repairable";
    return await this.#validationOutcome(task, items, rejectionClass);
  }

  async #validateCandidateForTask(
    candidate: unknown,
    task: AgentTaskSnapshotV1,
  ): Promise<AgentValidationResultV1> {
    const outcome = await this.validateReviewIncrement({ task, candidate });
    return {
      schemaVersion: "1",
      items: outcome.items.map((item) => ({
        checkId: item.checkId,
        disposition: item.disposition,
        ...(item.rejectionClass === undefined ? {} : { rejectionClass: item.rejectionClass }),
        reasonCode: item.reasonCode,
        evidenceReferences: [...item.evidenceReferences],
      })),
      disposition: outcome.disposition,
      ...(outcome.rejectionClass === undefined ? {} : { rejectionClass: outcome.rejectionClass }),
      validationArtifactRef: outcome.validationArtifactRef,
      validatedAt: this.#now().toISOString(),
    };
  }

  async #validationOutcome(
    task: AgentTaskSnapshotV1,
    items: readonly {
      readonly checkId: string;
      readonly disposition: "accepted" | "rejected";
      readonly rejectionClass?: "repairable" | "terminal";
      readonly reasonCode: string;
      readonly evidenceReferences: readonly EvidenceReference[];
    }[],
    rejectionClass: "repairable" | "terminal" | undefined,
  ): Promise<RetrievalReviewValidationOutcomeV1> {
    const artifactId = `retrieval-review-validation-${task.envelope.agentTaskRef.reference.entityId}`;
    const validationArtifactRef = await this.#putArtifact({
      artifactId,
      projectId: task.envelope.projectId,
      actorId: task.envelope.actorId,
      issuedAt: this.#now().toISOString(),
      purposeCode: OBSERVATION_PURPOSE_CODE_V1,
      authorization: task.envelope.authorization,
      value: {
        schemaVersion: IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1,
        taskRef: task.envelope.agentTaskRef,
        items,
      },
      commandId: `${artifactId}:${rejectionClass ?? "accepted"}`,
    });
    return {
      items: items.map((item) => ({ ...item, evidenceReferences: [...item.evidenceReferences] })),
      disposition: rejectionClass === undefined ? "accepted" : "rejected",
      ...(rejectionClass === undefined ? {} : { rejectionClass }),
      validationArtifactRef,
    };
  }

  /** 收口正式检索工件集：C04 先行、C03 同事务写登记与单条审计，全部合格才返回引用。 */
  async finalizeRetrievalReview(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: unknown;
  }): Promise<AgentTaskResultRefV1> {
    const task = input.task;
    const increment = RetrievalReviewIncrementV1Schema.parse(input.candidate);
    const candidateSet = await this.#readCandidateSet(task, increment.candidateSetRef);
    const byEntity = new Map(
      candidateSet.members.map((member) => [member.memberRef.reference.entityId, member]),
    );
    const selected: ReviewedRetrievalMemberV1[] = [];
    const excluded: { memberRef: ReviewedRetrievalMemberV1["memberRef"]; reasonCode: string }[] =
      [];
    for (const operation of increment.operations) {
      const member = byEntity.get(operation.memberRef.reference.entityId);
      if (member === undefined) {
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_VALIDATION_REJECTED",
            category: "validation",
            retryable: false,
            stage: "worker.retrieval-review.finalize.membership",
            taskRef: task.envelope.agentTaskRef,
          }),
        );
      }
      if (operation.operation === "exclude") {
        excluded.push({ memberRef: member.memberRef, reasonCode: operation.reasonCode });
        continue;
      }
      selected.push({
        memberRef: member.memberRef,
        sourceKind: member.sourceKind,
        sourceReleaseRef: member.sourceReleaseRef,
        sourceEntryId: member.sourceEntryId,
        contentDigest: member.contentDigest,
        evidence: [...operation.evidence],
        originQueryResultRef: member.originQueryResultRef,
        rankingSignal: {
          rank: member.rank,
          fusionScore: member.fusionScore,
          scoreSemantics: "ranking-signal-not-confidence",
        },
      });
    }
    if (selected.length === 0) {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_VALIDATION_REJECTED",
          category: "validation",
          retryable: false,
          stage: "worker.retrieval-review.finalize.selection",
          taskRef: task.envelope.agentTaskRef,
        }),
      );
    }
    const requestDigest = sha256CanonicalJson({
      candidateSetRef: increment.candidateSetRef,
      operations: increment.operations,
    });
    const retrievalArtifactSetRef = retrievalArtifactSetRefFor({
      taskRef: task.envelope.agentTaskRef,
      requestDigest,
    });
    const validationRef = {
      kind: "validation-snapshot" as const,
      reference: {
        entityId: `retrieval-review-validation:${task.envelope.agentTaskRef.reference.entityId}`,
        versionId: requestDigest,
      },
    };
    const reviewedSet: ReviewedRetrievalSetV1 = ReviewedRetrievalSetV1Schema.parse({
      schemaVersion: IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1,
      projectId: task.envelope.projectId,
      taskRef: task.envelope.agentTaskRef,
      nodeId: candidateSet.nodeId,
      inputSnapshotRef: candidateSet.inputSnapshotRef,
      workItemRef: candidateSet.workItemRef,
      candidateSetRef: increment.candidateSetRef,
      candidateVersion: increment.candidateVersion,
      baselineQueryResultRef: candidateSet.baselineQueryResultRef,
      relationshipQueryResultRef: candidateSet.relationshipQueryResultRef,
      resupplementQueryResultRefs: candidateSet.resupplements.map((item) => item.queryResultRef),
      validationArtifactRef: validationRef,
      selectedMembers: selected,
      excludedMembers: excluded,
      authorizationScopeDigest: candidateSet.frozenAuthorizationScopeDigest,
      authorizationContextRef: candidateSet.frozenAuthorizationContextRef,
      completedAt: this.#now().toISOString(),
    });
    const occurredAt = this.#now().toISOString();
    const persisted = await this.#persistResult({
      row: {
        schemaVersion: IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1,
        resultKind: "reviewed-retrieval",
        projectId: task.envelope.projectId,
        resultId: retrievalArtifactSetRef.reference.entityId,
        resultVersionId: requestDigest,
        requestDigest,
        artifactRef: { kind: "content-artifact", reference: { entityId: "", versionId: "" } },
        inputSnapshotRef: candidateSet.inputSnapshotRef,
        workItemRef: candidateSet.workItemRef,
        authorizationScopeDigest: candidateSet.frozenAuthorizationScopeDigest,
        actorRef: task.envelope.actorId,
        authorizationContextRef: task.envelope.authorization.authorizationContextRef,
        agentTaskRef: task.envelope.agentTaskRef,
        baselineQueryResultRef: candidateSet.baselineQueryResultRef,
        retrievalArtifactSetRef,
      },
      occurredAt,
      authorization: task.envelope.authorization,
      artifactId: `retrieval-artifact-set-${task.envelope.agentTaskRef.reference.entityId}`,
      purposeCode: REVIEWED_SET_PURPOSE_CODE_V1,
      value: reviewedSet,
      resultRef: retrievalArtifactSetRef,
      commandKind: "identification.retrieval-artifact-set.register",
    });
    if (persisted.kind !== "succeeded") {
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_PERSISTENCE_FAILURE",
          category: "persistence",
          retryable: true,
          stage: "worker.retrieval-review.finalize",
          taskRef: task.envelope.agentTaskRef,
        }),
      );
    }
    return buildCompletedAgentTaskResult(
      task.envelope.agentTaskRef,
      retrievalArtifactSetRef,
      validationRef,
      ["retrieval-artifact-set"],
    );
  }

  // ------------------------------------------------------- IP-06 五项上下文组装

  async assembleContext(input: AssembleModelContextInputV1): Promise<AssembleModelContextResultV1> {
    const options = this.#options;
    const exact = await options.inputReader.readExact({
      projectId: input.projectId,
      actorId: input.actorId,
      queryId: input.reviewTaskRef.reference.entityId,
      inputSnapshotRef: input.inputSnapshotRef,
      workItemRef: input.workItemRef,
      authorization: input.authorization,
    });
    if (exact.kind === "failed") {
      throw new IdentificationContextError(
        blocked({
          causalRunId: input.reviewTaskRef.reference.entityId,
          occurredAt: this.#now().toISOString(),
          blockerKind: exact.detailCode,
          blockerRef: input.workItemRef,
        }),
      );
    }
    const snapshot = IdentificationInputSnapshotV1Schema.parse(exact.read.inputSnapshot);
    const nodeId = exact.read.workItem.nodeId;
    const relationshipRow = await options.resultStore.readRelationshipResult({
      projectId: input.projectId,
      queryId: relationshipQueryIdFor(nodeId),
    });
    if (relationshipRow === undefined) {
      throw new IdentificationContextError(
        blocked({
          causalRunId: input.reviewTaskRef.reference.entityId,
          occurredAt: this.#now().toISOString(),
          blockerKind: "relationship-result-missing",
          blockerRef: input.workItemRef,
        }),
      );
    }
    const reviewedRow = await options.resultStore.readResult({
      projectId: input.projectId,
      resultKind: "reviewed-retrieval",
      resultId: `retrieval-review:${input.reviewTaskRef.reference.entityId}`,
    });
    if (reviewedRow === undefined || reviewedRow.resultKind !== "reviewed-retrieval") {
      throw new IdentificationContextError(
        blocked({
          causalRunId: input.reviewTaskRef.reference.entityId,
          occurredAt: this.#now().toISOString(),
          blockerKind: "reviewed-retrieval-missing",
          blockerRef: input.reviewTaskRef,
        }),
      );
    }
    const task = await options.taskReader.getTask(input.reviewTaskRef);
    const taskResult = task?.state.resultRef;
    if (
      task === undefined ||
      task.state.status !== "completed" ||
      taskResult === undefined ||
      taskResult.status !== "completed" ||
      !("incrementRef" in taskResult) ||
      taskResult.incrementRef === undefined ||
      !sameRef(taskResult.incrementRef.reference, reviewedRow.retrievalArtifactSetRef.reference)
    ) {
      throw new IdentificationContextError(
        blocked({
          causalRunId: input.reviewTaskRef.reference.entityId,
          occurredAt: this.#now().toISOString(),
          blockerKind: "review-task-not-completed",
          blockerRef: input.reviewTaskRef,
        }),
      );
    }
    const current = await options.authorization.verifyCurrent({
      authorization: input.authorization,
      invocationId: input.reviewTaskRef.reference.entityId,
      branch: "knowledge-modeling.relationship-context",
      requestedSpatialScopeRefs: [...exact.read.workItem.spatialScopeRefs],
      requestedSourceVersionRefs: [...exact.read.workItem.sourceVersionRefs],
    });
    if (current === undefined) {
      throw new IdentificationContextError(
        authorizationDenied({
          causalRunId: input.reviewTaskRef.reference.entityId,
          occurredAt: this.#now().toISOString(),
          policyRef: this.#policy.policyRef,
        }),
      );
    }
    const scopeDigest = authorizationScopeDigest(current);
    if (
      task.envelope.projectId !== input.projectId ||
      task.envelope.actorId !== input.actorId ||
      !sameRef(task.envelope.agentTaskRef.reference, input.reviewTaskRef.reference) ||
      !sameRef(relationshipRow.inputSnapshotRef.reference, input.inputSnapshotRef.reference) ||
      !sameRef(relationshipRow.workItemRef.reference, input.workItemRef.reference) ||
      !sameRef(reviewedRow.inputSnapshotRef.reference, input.inputSnapshotRef.reference) ||
      !sameRef(reviewedRow.workItemRef.reference, input.workItemRef.reference) ||
      !sameRef(reviewedRow.agentTaskRef.reference, input.reviewTaskRef.reference) ||
      relationshipRow.actorRef !== input.actorId ||
      reviewedRow.actorRef !== input.actorId ||
      relationshipRow.authorizationScopeDigest !== scopeDigest ||
      reviewedRow.authorizationScopeDigest !== scopeDigest
    ) {
      throw new IdentificationContextError(
        blocked({
          causalRunId: input.reviewTaskRef.reference.entityId,
          occurredAt: this.#now().toISOString(),
          blockerKind: "context-source-mismatch",
          blockerRef: input.workItemRef,
        }),
      );
    }
    const requestedAt = this.#now().toISOString();
    const relationshipPayload = RelationshipContextPayloadV1Schema.parse(
      await this.#readArtifactJson({
        artifactRef: relationshipRow.artifactRef,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt,
        purposeCode: RELATIONSHIP_PURPOSE_CODE_V1,
        authorization: current,
      }),
    );
    const reviewedSet = ReviewedRetrievalSetV1Schema.parse(
      await this.#readArtifactJson({
        artifactRef: reviewedRow.artifactRef,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt,
        purposeCode: REVIEWED_SET_PURPOSE_CODE_V1,
        authorization: current,
      }),
    );
    if (
      !sameRef(relationshipPayload.inputSnapshotRef.reference, input.inputSnapshotRef.reference) ||
      !sameRef(relationshipPayload.workItemRef.reference, input.workItemRef.reference) ||
      relationshipPayload.nodeId !== nodeId ||
      !sameRef(
        relationshipPayload.knowledgeQueryResultRef.reference,
        relationshipRow.knowledgeQueryResultRef.reference,
      ) ||
      !sameRef(
        relationshipPayload.releaseBinding.processModelReleaseRef.reference,
        snapshot.processModelReleaseRef.reference,
      ) ||
      !sameRef(
        relationshipPayload.releaseBinding.riskMechanismReleaseRef.reference,
        snapshot.riskMechanismReleaseRef.reference,
      ) ||
      !sameRef(
        relationshipPayload.releaseBinding.retrievalEvidenceBaseReleaseRef.reference,
        snapshot.retrievalEvidenceBaseReleaseRef.reference,
      ) ||
      !sameRef(reviewedSet.inputSnapshotRef.reference, input.inputSnapshotRef.reference) ||
      !sameRef(reviewedSet.workItemRef.reference, input.workItemRef.reference) ||
      !sameRef(reviewedSet.taskRef.reference, input.reviewTaskRef.reference) ||
      reviewedSet.nodeId !== nodeId ||
      !sameRef(
        reviewedSet.relationshipQueryResultRef.reference,
        relationshipRow.knowledgeQueryResultRef.reference,
      ) ||
      !sameRef(
        reviewedSet.baselineQueryResultRef.reference,
        reviewedRow.baselineQueryResultRef.reference,
      ) ||
      relationshipPayload.authorizationScopeDigest !== scopeDigest ||
      reviewedSet.authorizationScopeDigest !== scopeDigest
    ) {
      throw new IdentificationContextError(
        blocked({
          causalRunId: input.reviewTaskRef.reference.entityId,
          occurredAt: this.#now().toISOString(),
          blockerKind: "context-source-mismatch",
          blockerRef: input.workItemRef,
        }),
      );
    }
    const baseline = await this.readOfficialHybrid({
      projectId: input.projectId,
      actorId: input.actorId,
      requestedAt,
      queryId: baselineQueryIdFor(nodeId),
      expectedQueryResultRef: reviewedSet.baselineQueryResultRef,
      authorization: current,
    });
    if (
      !sameRef(
        baseline.payload.refs.inputSnapshotRef.reference,
        input.inputSnapshotRef.reference,
      ) ||
      !sameRef(baseline.payload.refs.workItemRef.reference, input.workItemRef.reference) ||
      !sameRef(baseline.payload.refs.retrievalPolicyRef, snapshot.retrievalPolicyRef) ||
      !sameRef(
        baseline.payload.evidenceBaseReleaseRef.reference,
        snapshot.retrievalEvidenceBaseReleaseRef.reference,
      ) ||
      ![
        baseline.payload.memberReleaseRefs.riskMechanismRef,
        baseline.payload.memberReleaseRefs.standardLibraryRef,
        baseline.payload.memberReleaseRefs.caseLibraryRef,
      ].every((member) =>
        relationshipPayload.releaseBinding.compositeMemberReleaseRefs.some((release) =>
          sameRef(release.reference, member.reference),
        ),
      )
    ) {
      throw new IdentificationContextError(
        blocked({
          causalRunId: input.reviewTaskRef.reference.entityId,
          occurredAt: this.#now().toISOString(),
          blockerKind: "context-source-mismatch",
          blockerRef: input.workItemRef,
        }),
      );
    }
    const timeNeighbors = relationshipPayload.neighborNodes
      .filter((neighbor) => neighbor.relationType === "时间先后关系")
      .map((neighbor) => ({
        nodeId: neighbor.nodeId,
        processKind: neighbor.processKind,
        edgeId: neighbor.edgeId,
        position: neighbor.upstream ? ("predecessor" as const) : ("successor" as const),
        evidence: neighbor.evidence,
      }));
    const forceDependencies = relationshipPayload.dependencyEdges.filter(
      (edge) => edge.relationType === "受力依赖关系",
    );
    const incomplete = (blockerKind: string, blockerRef: ContractReferenceV1) =>
      new IdentificationContextError(
        blocked({
          causalRunId: input.reviewTaskRef.reference.entityId,
          occurredAt: this.#now().toISOString(),
          blockerKind,
          blockerRef,
        }),
      );
    if (forceDependencies.length === 0) {
      throw incomplete("force-dependency-missing", relationshipRow.knowledgeQueryResultRef);
    }
    if (relationshipPayload.currentNode.stateParameters.length === 0) {
      throw incomplete("state-parameters-missing", relationshipRow.knowledgeQueryResultRef);
    }
    if (relationshipPayload.mechanisms.length === 0) {
      throw incomplete("mechanism-missing", relationshipRow.knowledgeQueryResultRef);
    }
    if (reviewedSet.selectedMembers.length === 0) {
      throw incomplete("retrieval-evidence-missing", reviewedRow.retrievalArtifactSetRef);
    }
    const requestDigest = sha256CanonicalJson({
      workItemRef: input.workItemRef,
      relationshipQueryResultRef: relationshipRow.knowledgeQueryResultRef,
      retrievalArtifactSetRef: reviewedRow.retrievalArtifactSetRef,
      reviewTaskRef: input.reviewTaskRef,
    });
    const modelContextArtifactSetRef = modelContextArtifactSetRefFor({
      projectId: input.projectId,
      workItemEntityId: input.workItemRef.reference.entityId,
      taskEntityId: input.reviewTaskRef.reference.entityId,
      requestDigest,
    });
    const existing = await options.resultStore.readResult({
      projectId: input.projectId,
      resultKind: "model-context",
      resultId: modelContextArtifactSetRef.reference.entityId,
    });
    if (existing !== undefined) {
      if (
        existing.resultKind !== "model-context" ||
        existing.requestDigest !== requestDigest ||
        !sameRef(
          existing.modelContextArtifactSetRef.reference,
          modelContextArtifactSetRef.reference,
        )
      ) {
        throw incomplete("model-context-identity-conflict", modelContextArtifactSetRef);
      }
      return {
        modelContextArtifactSetRef,
        payload: ModelContextPayloadV1Schema.parse(
          await this.#readArtifactJson({
            artifactRef: existing.artifactRef,
            projectId: input.projectId,
            actorId: input.actorId,
            requestedAt,
            purposeCode: MODEL_CONTEXT_PURPOSE_CODE_V1,
            authorization: current,
          }),
        ),
      };
    }
    const payload: ModelContextPayloadV1 = ModelContextPayloadV1Schema.parse({
      schemaVersion: IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1,
      projectId: input.projectId,
      nodeId,
      inputSnapshotRef: input.inputSnapshotRef,
      workItemRef: input.workItemRef,
      policySetRef: snapshot.identificationPolicySetRef,
      releaseBinding: relationshipPayload.releaseBinding,
      relationshipQueryResultRef: relationshipRow.knowledgeQueryResultRef,
      baselineQueryResultRef: reviewedSet.baselineQueryResultRef,
      retrievalArtifactSetRef: reviewedRow.retrievalArtifactSetRef,
      reviewTaskRef: input.reviewTaskRef,
      reviewAgentPolicyRef: snapshot.retrievalReviewAgentPolicyRef,
      retrievalPolicyRef: snapshot.retrievalPolicyRef,
      processNode: {
        nodeId: relationshipPayload.currentNode.nodeId,
        processKind: relationshipPayload.currentNode.processKind,
        inputs: relationshipPayload.currentNode.inputs,
        outputs: relationshipPayload.currentNode.outputs,
        adjacentTimeNodes: timeNeighbors,
        evidence: relationshipPayload.currentNode.evidence,
      },
      stateParameters: {
        nodeId: relationshipPayload.currentNode.nodeId,
        stateParameters: relationshipPayload.currentNode.stateParameters,
        monitoringIndicators: relationshipPayload.currentNode.monitoringIndicators,
        evidence: relationshipPayload.currentNode.evidence,
      },
      forceDependencies: [...forceDependencies],
      mechanisms: relationshipPayload.mechanisms.map((mechanism) => ({
        mechanismId: mechanism.mechanismId,
        mechanismType: mechanism.mechanismType,
        stateParameters: mechanism.stateParameters,
        evidence: mechanism.evidence,
      })),
      retrievalEvidence: reviewedSet.selectedMembers.map((member) => ({
        memberRef: member.memberRef,
        sourceKind: member.sourceKind,
        sourceReleaseRef: member.sourceReleaseRef,
        sourceEntryId: member.sourceEntryId,
        evidence: member.evidence,
        rankingSignal: member.rankingSignal,
      })),
      authorizationScopeDigest: relationshipPayload.authorizationScopeDigest,
      authorizationContextRef: current.authorizationContextRef,
      assembledAt: requestedAt,
    });
    const persisted = await this.#persistResult({
      row: {
        schemaVersion: IDENTIFICATION_CONTEXT_SCHEMA_VERSION_V1,
        resultKind: "model-context",
        projectId: input.projectId,
        resultId: modelContextArtifactSetRef.reference.entityId,
        resultVersionId: requestDigest,
        requestDigest,
        artifactRef: { kind: "content-artifact", reference: { entityId: "", versionId: "" } },
        inputSnapshotRef: input.inputSnapshotRef,
        workItemRef: input.workItemRef,
        authorizationScopeDigest: relationshipPayload.authorizationScopeDigest,
        actorRef: input.actorId,
        authorizationContextRef: current.authorizationContextRef,
        relationshipQueryResultRef: relationshipRow.knowledgeQueryResultRef,
        retrievalArtifactSetRef: reviewedRow.retrievalArtifactSetRef,
        modelContextArtifactSetRef,
      },
      occurredAt: requestedAt,
      authorization: current,
      artifactId: `identification-model-context-${input.workItemRef.reference.entityId}-${input.reviewTaskRef.reference.entityId}`,
      purposeCode: MODEL_CONTEXT_PURPOSE_CODE_V1,
      value: payload,
      resultRef: modelContextArtifactSetRef,
      commandKind: "identification.model-context.register",
    });
    if (persisted.kind !== "succeeded") {
      throw incomplete("model-context-persistence", modelContextArtifactSetRef);
    }
    return { modelContextArtifactSetRef, payload };
  }
}

export interface PrepareRetrievalReviewInputV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly requestedAt: string;
  readonly taskRef: AgentTaskRefV1;
  readonly inputSnapshotRef: {
    readonly kind: "identification-input-snapshot";
    readonly reference: VersionReference;
  };
  readonly workItemRef: {
    readonly kind: "identification-work-item";
    readonly reference: VersionReference;
  };
  readonly authorization: AuthorizationContextV1;
}

export interface PrepareRetrievalReviewResultV1 {
  readonly candidateSetRef: ArtifactRefV1;
  readonly candidateSet: RetrievalReviewCandidateSetV1;
  readonly baselineQueryResultRef: KnowledgeQueryResultRefV1;
}

export interface AssembleModelContextInputV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly reviewTaskRef: AgentTaskRefV1;
  readonly inputSnapshotRef: {
    readonly kind: "identification-input-snapshot";
    readonly reference: VersionReference;
  };
  readonly workItemRef: {
    readonly kind: "identification-work-item";
    readonly reference: VersionReference;
  };
  readonly authorization: AuthorizationContextV1;
}

export interface AssembleModelContextResultV1 {
  readonly modelContextArtifactSetRef: {
    readonly kind: "model-context-artifact-set";
    readonly reference: VersionReference;
  };
  readonly payload: ModelContextPayloadV1;
}

const sameRef = (left: VersionReference, right: VersionReference): boolean =>
  left.entityId === right.entityId && left.versionId === right.versionId;

const evidenceReferenceKey = (evidence: EvidenceReference): string =>
  `${evidence.locator.sourceSegmentId}:${evidence.sourceVersion.entityId}:${evidence.sourceVersion.versionId}`;
