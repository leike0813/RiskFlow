import { TextDecoder } from "node:util";

import { ArtifactReadRequestV1Schema, type ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  RelationshipContextPayloadV1Schema,
  type IdentificationContextResultStoreV1,
  type OfficialHybridResultReaderV1,
} from "@riskflow/core/identification/context";
import {
  ACCESS_POLICY_REF_V1,
  type AuthorizationDecisionV1,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  KnowledgeRetrievalReadQueryV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  RetrievalReadHybridSuccessV1Schema,
  RetrievalReadRelationshipSuccessV1Schema,
  type KnowledgeRetrievalReadPortV1,
  type KnowledgeRetrievalReadQueryV1,
  type KnowledgeRetrievalReadResultV1,
  type ModuleErrorV1,
} from "@riskflow/contracts/ports";

/** 与 C20/C21 结果登记的稳定身份前缀一致：结果引用实体即 `<前缀><projectId>:<queryId>`。 */
const HYBRID_RESULT_ENTITY_PREFIX_V1 = "retrieval-query-result:";
const RELATIONSHIP_RESULT_ENTITY_PREFIX_V1 = "relationship-query-result:";
/** 关系上下文正文的有界读取上限：与 C21 正式结果读取一致，超出即视为不可信来源。 */
const RELATIONSHIP_RESULT_MAX_BYTES_V1 = 8 * 1024 * 1024;
const RELATIONSHIP_RESULT_PURPOSE_CODE_V1 = "identification-relationship-context";
const RETRIEVAL_READ_REQUIRED_CAPABILITY_V1 =
  MODULE_BRANCH_CAPABILITY_V1["knowledge-modeling.retrieval-result"];
const RETRIEVAL_READ_STAGE_CODE_V1 = "knowledge-modeling.retrieval-result";

export interface PostgresKnowledgeRetrievalReadAdapterOptionsV1 {
  /** C21 结果登记的既有窄读：按 `(projectId, queryId)` 回查关系上下文结果行。 */
  readonly relationshipResults: Pick<IdentificationContextResultStoreV1, "readRelationshipResult">;
  /** C20 正式混合结果读取的既有实现：回查登记行并有界读取受保护正文。 */
  readonly hybridReader: OfficialHybridResultReaderV1;
  readonly artifactStore: ArtifactStoreV1;
  readonly access: LocalIdentityAccessV1;
}

const retrievalReadError = (
  code: "AUTHORIZATION_DENIED" | "UNSUPPORTED_CONTRACT",
  causalRunId: string,
): ModuleErrorV1 => {
  if (code === "AUTHORIZATION_DENIED") {
    return {
      code,
      category: "authorization",
      retryable: false,
      requiredCapability: RETRIEVAL_READ_REQUIRED_CAPABILITY_V1,
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
      stageCode: RETRIEVAL_READ_STAGE_CODE_V1,
      occurredAt: new Date().toISOString(),
      causalRunId,
    } as ModuleErrorV1;
  }
  return {
    code,
    category: "technical",
    retryable: false,
    schemaVersion: "1",
    stageCode: RETRIEVAL_READ_STAGE_CODE_V1,
    occurredAt: new Date().toISOString(),
    causalRunId,
  } as ModuleErrorV1;
};

const failed = (error: ModuleErrorV1): KnowledgeRetrievalReadResultV1 => ({
  kind: "failed",
  error,
});

const denied = (queryId: string): KnowledgeRetrievalReadResultV1 =>
  failed(retrievalReadError("AUTHORIZATION_DENIED", queryId));

/** 与治理只读同形：越权形状的请求在契约解析失败时也按授权失败收口，不披露更多细节。 */
const retrievalRequestDenied = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  const authorization = request.authorization;
  if (typeof authorization !== "object" || authorization === null) return false;
  const context = authorization as Record<string, unknown>;
  if (
    typeof request.projectId === "string" &&
    typeof context.projectId === "string" &&
    request.projectId !== context.projectId
  ) {
    return true;
  }
  if (
    typeof request.actorId === "string" &&
    typeof context.actorId === "string" &&
    request.actorId !== context.actorId
  ) {
    return true;
  }
  const capabilities = context.grantedCapabilities;
  return (
    Array.isArray(capabilities) && !capabilities.includes(RETRIEVAL_READ_REQUIRED_CAPABILITY_V1)
  );
};

const queryIdFromResultRef = (
  entityId: string,
  projectId: string,
  prefix: string,
): string | undefined => {
  const head = `${prefix}${projectId}:`;
  if (!entityId.startsWith(head)) return undefined;
  const queryId = entityId.slice(head.length);
  return queryId.length > 0 ? queryId : undefined;
};

const sameReference = (
  left: { readonly entityId: string; readonly versionId: string },
  right: { readonly entityId: string; readonly versionId: string },
): boolean => left.entityId === right.entityId && left.versionId === right.versionId;

/**
 * C32 检索结果再读取（IP-05）：按结果引用的登记类型分发到既有 C20 混合结果读取与 C21
 * 关系上下文登记窄读 + C04 有界正文读取，复验当前授权摘要后映射为 C32 读取 DTO。
 * 不触发新检索、不调用模型、不产生新事实；引用不存在、类型不符或越权同形失败。
 */
export class PostgresKnowledgeRetrievalReadAdapter implements KnowledgeRetrievalReadPortV1 {
  readonly #relationshipResults: Pick<IdentificationContextResultStoreV1, "readRelationshipResult">;
  readonly #hybridReader: OfficialHybridResultReaderV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #access: LocalIdentityAccessV1;

  constructor(options: PostgresKnowledgeRetrievalReadAdapterOptionsV1) {
    this.#relationshipResults = options.relationshipResults;
    this.#hybridReader = options.hybridReader;
    this.#artifactStore = options.artifactStore;
    this.#access = options.access;
  }

  async read(query: KnowledgeRetrievalReadQueryV1): Promise<KnowledgeRetrievalReadResultV1> {
    const parsed = KnowledgeRetrievalReadQueryV1Schema.safeParse(query);
    if (!parsed.success) {
      if (retrievalRequestDenied(query)) {
        return failed(retrievalReadError("AUTHORIZATION_DENIED", "knowledge-retrieval-read"));
      }
      return failed(retrievalReadError("UNSUPPORTED_CONTRACT", "knowledge-retrieval-read"));
    }
    const valid = parsed.data;
    try {
      await this.#verify(valid);
      const entityId = valid.payload.knowledgeQueryResultRef.reference.entityId;
      const hybridQueryId = queryIdFromResultRef(
        entityId,
        valid.projectId,
        HYBRID_RESULT_ENTITY_PREFIX_V1,
      );
      if (hybridQueryId !== undefined) {
        return await this.#readHybrid(valid, hybridQueryId);
      }
      const relationshipQueryId = queryIdFromResultRef(
        entityId,
        valid.projectId,
        RELATIONSHIP_RESULT_ENTITY_PREFIX_V1,
      );
      if (relationshipQueryId !== undefined) {
        return await this.#readRelationship(valid, relationshipQueryId);
      }
      return denied(valid.queryId);
    } catch {
      return denied(valid.queryId);
    }
  }

  async #verify(query: KnowledgeRetrievalReadQueryV1): Promise<AuthorizationDecisionV1> {
    const decision = await this.#access.verify({
      authorizationContextRef: query.authorization.authorizationContextRef,
      invocationId: query.queryId,
      projectId: query.projectId,
      branch: "knowledge-modeling.retrieval-result",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      requestedAt: query.authorization.decidedAt,
    });
    if (decision.context.actorId !== query.actorId) {
      throw new Error("retrieval read authorization denied");
    }
    return decision;
  }

  async #readHybrid(
    query: KnowledgeRetrievalReadQueryV1,
    queryId: string,
  ): Promise<KnowledgeRetrievalReadResultV1> {
    const official = await this.#hybridReader.readOfficial({
      projectId: query.projectId,
      queryId,
      actorId: query.actorId,
      requestedAt: query.requestedAt,
      authorization: query.authorization,
    });
    if (official.kind === "failed") return denied(query.queryId);
    const payload = official.result.payload;
    if (
      payload.projectId !== query.projectId ||
      payload.queryId !== queryId ||
      payload.actorId !== query.actorId ||
      !sameReference(
        payload.knowledgeQueryResultRef.reference,
        query.payload.knowledgeQueryResultRef.reference,
      )
    ) {
      return denied(query.queryId);
    }
    const success = RetrievalReadHybridSuccessV1Schema.safeParse({
      kind: "hybrid-evidence",
      knowledgeQueryResultRef: query.payload.knowledgeQueryResultRef,
      policyRef: payload.policyRef,
      generationRef: payload.generationRef,
      topK: payload.topK,
      hits: payload.hits.slice(0, 100).map((hit) => ({
        rank: hit.rank,
        memberRef: hit.memberRef,
        sourceKind: hit.sourceKind,
        sourceReleaseRef: hit.sourceReleaseRef,
        sourceEntryId: hit.sourceEntryId,
        denseContribution: hit.denseContribution,
        bm25Contribution: hit.bm25Contribution,
        fusionScore: hit.fusionScore,
        evidenceSourceVersionRefs: hit.evidenceSourceVersionRefs.slice(0, 16),
      })),
    });
    if (!success.success) return denied(query.queryId);
    return { kind: "succeeded", result: success.data };
  }

  async #readRelationship(
    query: KnowledgeRetrievalReadQueryV1,
    queryId: string,
  ): Promise<KnowledgeRetrievalReadResultV1> {
    const row = await this.#relationshipResults.readRelationshipResult({
      projectId: query.projectId,
      queryId,
    });
    if (row === undefined) return denied(query.queryId);
    if (
      !sameReference(
        row.knowledgeQueryResultRef.reference,
        query.payload.knowledgeQueryResultRef.reference,
      )
    ) {
      return denied(query.queryId);
    }
    const payload = await this.#readRelationshipPayload(query, row.artifactRef);
    if (payload === undefined) return denied(query.queryId);
    if (
      payload.projectId !== query.projectId ||
      payload.queryId !== queryId ||
      payload.actorId !== query.actorId ||
      payload.authorizationScopeDigest !== row.authorizationScopeDigest ||
      !sameReference(
        payload.knowledgeQueryResultRef.reference,
        query.payload.knowledgeQueryResultRef.reference,
      )
    ) {
      return denied(query.queryId);
    }
    const success = RetrievalReadRelationshipSuccessV1Schema.safeParse({
      kind: "relationship-context",
      knowledgeQueryResultRef: query.payload.knowledgeQueryResultRef,
      nodeId: payload.nodeId,
      currentNode: payload.currentNode,
      neighborNodes: payload.neighborNodes.slice(0, 64),
      dependencyEdges: payload.dependencyEdges.slice(0, 128),
      mechanisms: payload.mechanisms.slice(0, 128),
      excludedMechanisms: payload.excludedMechanisms.slice(0, 128),
      releaseBinding: {
        processModelReleaseRef: payload.releaseBinding.processModelReleaseRef,
        riskMechanismReleaseRef: payload.releaseBinding.riskMechanismReleaseRef,
        retrievalEvidenceBaseReleaseRef: payload.releaseBinding.retrievalEvidenceBaseReleaseRef,
      },
    });
    if (!success.success) return denied(query.queryId);
    return { kind: "succeeded", result: success.data };
  }

  async #readRelationshipPayload(query: KnowledgeRetrievalReadQueryV1, artifactRef: unknown) {
    try {
      const handle = await this.#artifactStore.open(
        ArtifactReadRequestV1Schema.parse({
          schemaVersion: "1",
          requestId: `${query.queryId}:relationship-body`,
          idempotencyKey: `${query.queryId}:relationship-body`,
          artifactRef,
          projectId: query.projectId,
          actorId: query.actorId,
          requestedAt: query.requestedAt,
          purposeCode: RELATIONSHIP_RESULT_PURPOSE_CODE_V1,
          requiredCapability: RETRIEVAL_READ_REQUIRED_CAPABILITY_V1,
          authorization: query.authorization,
        }),
      );
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of handle.content) {
        size += chunk.byteLength;
        if (size > RELATIONSHIP_RESULT_MAX_BYTES_V1) {
          throw new RangeError("relationship artifact exceeds read bound");
        }
        chunks.push(chunk);
      }
      await handle.completed;
      const buffer = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const parsed = RelationshipContextPayloadV1Schema.safeParse(
        JSON.parse(new TextDecoder().decode(buffer)),
      );
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }
}

export const createPostgresKnowledgeRetrievalReadAdapter = (
  options: PostgresKnowledgeRetrievalReadAdapterOptionsV1,
): KnowledgeRetrievalReadPortV1 => new PostgresKnowledgeRetrievalReadAdapter(options);
