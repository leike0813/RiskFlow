/**
 * 合成样本、待甲方复核：本文件所有工程、参与者、查询身份、摘要与工件正文均为合成夹具，
 * 不代表生产数据，也不得作为生产回退来源。
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ArtifactPutCommandV1Schema,
  type ArtifactRefV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import type { LocalIdentityAccessV1 } from "@riskflow/core/access";
import {
  RelationshipContextPayloadV1Schema,
  type IdentificationContextResultRowV1,
} from "@riskflow/core/identification/context";
import type { AtomicCommandV1, AtomicCommitV1 } from "@riskflow/core/persistence";
import {
  authorizationScopeDigest,
  HybridRetrievalResultPayloadV1Schema,
  type HybridRetrievalResultPayloadV1,
} from "@riskflow/core/retrieval";
import {
  AuthorizationContextV1Schema,
  type AuthorizationContextV1,
  type KnowledgeQueryResultRefV1,
  type KnowledgeRetrievalReadQueryV1,
} from "@riskflow/contracts/ports";

import { createFilesystemArtifactStore } from "../../../src/artifacts/filesystem-artifact-store.js";
import { PostgresArtifactRegistry } from "../../../src/artifacts/postgres-artifact-registry.js";
import {
  PostgresIdentificationContextAdapter,
  PostgresOfficialHybridResultReader,
} from "../../../src/identification/context/postgres-identification-context-adapter.js";
import { PostgresKnowledgeRetrievalReadAdapter } from "../../../src/identification/context/postgres-knowledge-retrieval-read.js";
import { runPostgresMigrations } from "../../../src/postgres/migrations/run.js";
import { createPostgresRuntime, type PostgresRuntime } from "../../../src/postgres/pool.js";
import { PostgresTransactionUnit } from "../../../src/postgres/transaction-unit.js";
import { artifactPolicy } from "../../artifacts/fixture.js";
import { startPostgresFixture, type PostgresTestFixture } from "../../postgres/fixture.js";

const PROJECT_ID = "project-c32-retrieval";
const ACTOR_ID = "actor-c32-retrieval";
const TIMESTAMP = "2030-01-01T00:00:00.000Z";

const sha = (seed: string): string => createHash("sha256").update(seed).digest("hex");
const refOf = <const T extends string>(
  kind: T,
  entityId: string,
  versionId = "v1",
): {
  readonly kind: T;
  readonly reference: { readonly entityId: string; readonly versionId: string };
} => ({ kind, reference: { entityId, versionId } });
const plainRef = (entityId: string, versionId = "v1") => ({ entityId, versionId });

const segmentEvidence = (segmentId: string) => ({
  locator: { sourceSegmentId: segmentId },
  sourceVersion: plainRef("source-version"),
});

interface RetrievalReadTestFixture {
  readonly postgres: PostgresTestFixture;
  readonly runtime: PostgresRuntime;
  readonly transactionUnit: PostgresTransactionUnit;
  readonly contextAdapter: PostgresIdentificationContextAdapter;
  readonly artifactStore: ArtifactStoreV1;
  close(): Promise<void>;
}

const startRetrievalReadFixture = async (): Promise<RetrievalReadTestFixture> => {
  const postgres = await startPostgresFixture();
  try {
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
      additionalMigrationRoots: [postgres.fixtureMigrationRoot],
    });
    const rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c32-retrieval-"));
    const runtime = createPostgresRuntime(postgres.app, "riskflow_app");
    const transactionUnit = new PostgresTransactionUnit(runtime.db);
    const registry = new PostgresArtifactRegistry({
      db: runtime.db,
      transactionUnit,
      pool: runtime.pool,
    });
    const artifactStore = await createFilesystemArtifactStore({
      rootDirectory,
      policy: artifactPolicy(),
      registry,
      transactionUnit,
    });
    const contextAdapter = new PostgresIdentificationContextAdapter({
      db: runtime.db,
      transactionUnit,
    });
    return {
      postgres,
      runtime,
      transactionUnit,
      contextAdapter,
      artifactStore,
      async close() {
        await artifactStore.close().catch(() => undefined);
        await runtime.close().catch(() => undefined);
        await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
        await postgres.close().catch(() => undefined);
      },
    };
  } catch (error) {
    await postgres.close().catch(() => undefined);
    throw error;
  }
};

/** C06 替身：按上下文引用回表，一引用一调用绑定与 C06 精确复验语义一致。 */
const accessDouble = () => {
  const contexts = new Map<string, AuthorizationContextV1>();
  const boundInvocations = new Map<string, string>();
  const keyOf = (ref: AuthorizationContextV1["authorizationContextRef"]) =>
    `${ref.reference.entityId}:${ref.reference.versionId}`;
  const access: LocalIdentityAccessV1 = {
    verify: async (request: {
      authorizationContextRef: AuthorizationContextV1["authorizationContextRef"];
      invocationId?: string;
    }) => {
      const key = keyOf(request.authorizationContextRef);
      const bound = boundInvocations.get(key);
      if (bound !== undefined && bound !== request.invocationId) {
        throw new Error("AUTHORIZATION_DENIED");
      }
      if (request.invocationId !== undefined) boundInvocations.set(key, request.invocationId);
      const context = contexts.get(key);
      if (context === undefined) throw new Error("AUTHORIZATION_DENIED");
      return { context, contextRef: request.authorizationContextRef, redacted: false };
    },
  } as unknown as LocalIdentityAccessV1;
  return {
    access,
    register: (context: AuthorizationContextV1) =>
      contexts.set(keyOf(context.authorizationContextRef), context),
  };
};

const retrievalAuthorization = (
  overrides: { readonly policyVersion?: string; readonly capabilities?: readonly string[] } = {},
): AuthorizationContextV1 =>
  AuthorizationContextV1Schema.parse({
    schemaVersion: "1",
    authorizationContextRef: refOf(
      "authorization-context",
      `authorization-c32-retrieval-${overrides.policyVersion ?? "v1"}`,
    ),
    actorId: ACTOR_ID,
    projectId: PROJECT_ID,
    grantedCapabilities: [...(overrides.capabilities ?? ["knowledge-modeling.retrieve"])],
    spatialScopeRefs: [],
    sourceAccessGrantRefs: [],
    authorizationPolicyRef: plainRef("authorization-policy", overrides.policyVersion ?? "v1"),
    decidedAt: TIMESTAMP,
    invocation: { kind: "human" },
  });

const putArtifact = async (
  fixture: RetrievalReadTestFixture,
  input: {
    readonly artifactId: string;
    readonly purposeCode: string;
    readonly content: Uint8Array;
    readonly authorization: AuthorizationContextV1;
  },
): Promise<ArtifactRefV1> => {
  const result = await fixture.artifactStore.put(
    ArtifactPutCommandV1Schema.parse({
      schemaVersion: "1",
      commandId: `c32-fixture-${input.artifactId}`,
      idempotencyKey: `c32-fixture-${input.artifactId}`,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      issuedAt: TIMESTAMP,
      authorization: input.authorization,
      requiredCapability: "knowledge-modeling.retrieve",
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
      yield input.content;
    })(),
  );
  return result.artifactRef;
};

const HYBRID_QUERY_ID = "c32-hybrid-query";
const hybridResultRef = (
  requestDigest: string,
  projectId: string = PROJECT_ID,
): KnowledgeQueryResultRefV1 =>
  refOf(
    "knowledge-query-result",
    `retrieval-query-result:${projectId}:${HYBRID_QUERY_ID}`,
    requestDigest,
  );

const hybridPayload = (
  authorization: AuthorizationContextV1,
  requestDigest: string,
): HybridRetrievalResultPayloadV1 =>
  HybridRetrievalResultPayloadV1Schema.parse({
    schemaVersion: "1",
    queryId: HYBRID_QUERY_ID,
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    requestedAt: TIMESTAMP,
    completedAt: TIMESTAMP,
    refs: {
      inputSnapshotRef: refOf("identification-input-snapshot", "input-snapshot"),
      workItemRef: refOf("identification-work-item", "work-item"),
      retrievalPolicyRef: plainRef("retrieval-policy"),
    },
    evidenceBaseReleaseRef: refOf("retrieval-evidence-base-release", "evidence-base"),
    memberReleaseRefs: {
      riskMechanismRef: refOf("knowledge-release", "risk-mechanism-release"),
      standardLibraryRef: refOf("knowledge-release", "standard-library-release"),
      caseLibraryRef: refOf("knowledge-release", "case-library-release"),
    },
    generationRef: refOf("retrieval-generation", "retrieval-generation"),
    collectionName: "riskflow-c32-fixture",
    projectionCompatibilityRef: plainRef("qdrant-1.x"),
    policyRef: plainRef("retrieval-policy"),
    modelDeploymentRef: plainRef("model-deployment"),
    embeddingDimensions: 4,
    bm25: {
      model: "qdrant/bm25",
      tokenizer: "multilingual",
      language: "chinese",
      stemmer: "none",
      stopwords: [],
    },
    rrf: { k: 60, denseWeight: 1, bm25Weight: 1 },
    densePrefetchLimit: 8,
    bm25PrefetchLimit: 8,
    topK: 4,
    authorizationScopeDigest: authorizationScopeDigest(authorization),
    authorizationContextRef: authorization.authorizationContextRef,
    hits: [
      {
        rank: 1,
        memberRef: refOf("retrieval-member", "retrieval-member-1"),
        sourceKind: "risk-mechanism",
        sourceReleaseRef: refOf("knowledge-release", "risk-mechanism-release"),
        sourceEntryId: "MEC-VDS-017",
        contentDigest: sha("member-1"),
        evidenceSourceVersionRefs: [plainRef("source-version")],
        denseRank: 1,
        bm25Rank: 2,
        denseContribution: 0.5,
        bm25Contribution: 0.25,
        fusionScore: 0.75,
      },
    ],
    scoreSemantics: "ranking-signal-not-confidence",
    knowledgeQueryResultRef: hybridResultRef(requestDigest),
  });

const RELATIONSHIP_QUERY_ID = "c32-relationship-query";
const relationshipResultRef = (requestDigest: string): KnowledgeQueryResultRefV1 =>
  refOf(
    "knowledge-query-result",
    `relationship-query-result:${PROJECT_ID}:${RELATIONSHIP_QUERY_ID}`,
    requestDigest,
  );

const relationshipPayload = (authorization: AuthorizationContextV1, requestDigest: string) =>
  RelationshipContextPayloadV1Schema.parse({
    schemaVersion: "1",
    projectId: PROJECT_ID,
    queryId: RELATIONSHIP_QUERY_ID,
    actorId: ACTOR_ID,
    requestedAt: TIMESTAMP,
    completedAt: TIMESTAMP,
    inputSnapshotRef: refOf("identification-input-snapshot", "input-snapshot"),
    workItemRef: refOf("identification-work-item", "work-item"),
    nodeId: "PN-VDS-04",
    policySetRef: refOf("identification-policy-set", "policy-set"),
    retrievalPolicyRef: plainRef("retrieval-policy"),
    reviewAgentPolicyRef: plainRef("review-agent-policy"),
    releaseBinding: {
      processModelReleaseRef: refOf("knowledge-release", "process-model-release"),
      processModelPackageDigest: sha("process-model-package"),
      riskMechanismReleaseRef: refOf("knowledge-release", "risk-mechanism-release"),
      riskMechanismPackageDigest: sha("risk-mechanism-package"),
      retrievalEvidenceBaseReleaseRef: refOf("knowledge-release", "evidence-base-release"),
      retrievalEvidenceBasePackageDigest: sha("evidence-base-package"),
      compositeMemberReleaseRefs: [
        refOf("knowledge-release", "process-model-release"),
        refOf("knowledge-release", "risk-mechanism-release"),
        refOf("knowledge-release", "evidence-base-release"),
      ],
    },
    currentNode: {
      nodeId: "PN-VDS-04",
      processKind: "变径空间扩挖",
      inputs: ["input-a"],
      outputs: ["output-a"],
      stateParameters: ["盾体直径"],
      monitoringIndicators: ["地表沉降"],
      applicability: {
        constructionMethod: ["method-a"],
        stratumCondition: ["stratum-a"],
        engineeringStage: ["stage-a"],
      },
      evidence: [segmentEvidence("segment-current")],
    },
    neighborNodes: [
      {
        nodeId: "PN-VDS-03",
        processKind: "扩径准备",
        edgeId: "edge-time",
        relationType: "时间先后关系",
        upstream: true,
        evidence: [segmentEvidence("segment-neighbor")],
      },
    ],
    dependencyEdges: [
      {
        edgeId: "edge-time",
        fromNodeId: "PN-VDS-03",
        toNodeId: "PN-VDS-04",
        relationType: "时间先后关系",
        evidence: [segmentEvidence("segment-edge")],
      },
    ],
    mechanisms: [
      {
        mechanismId: "MEC-VDS-017",
        mechanismType: "过挖与地表沉降",
        stateParameters: ["盾体直径"],
        monitoringIndicators: ["地表沉降"],
        evidence: [segmentEvidence("segment-mechanism")],
      },
    ],
    excludedMechanisms: [{ mechanismId: "MEC-VDS-018", reasonCode: "applicability-mismatch" }],
    authorizationScopeDigest: authorizationScopeDigest(authorization),
    authorizationContextRef: authorization.authorizationContextRef,
    knowledgeQueryResultRef: relationshipResultRef(requestDigest),
  });

const registerRelationshipResult = async (
  fixture: RetrievalReadTestFixture,
  input: {
    readonly authorization: AuthorizationContextV1;
    readonly requestDigest: string;
  },
): Promise<KnowledgeQueryResultRefV1> => {
  const payload = relationshipPayload(input.authorization, input.requestDigest);
  const artifactRef = await putArtifact(fixture, {
    artifactId: `relationship-query-result-${RELATIONSHIP_QUERY_ID}`,
    purposeCode: "identification-relationship-context",
    content: new TextEncoder().encode(JSON.stringify(payload)),
    authorization: input.authorization,
  });
  const knowledgeQueryResultRef = relationshipResultRef(input.requestDigest);
  const row: IdentificationContextResultRowV1 = {
    schemaVersion: "1",
    projectId: PROJECT_ID,
    resultKind: "relationship",
    resultId: knowledgeQueryResultRef.reference.entityId,
    resultVersionId: input.requestDigest,
    requestDigest: input.requestDigest,
    artifactRef,
    inputSnapshotRef: payload.inputSnapshotRef,
    workItemRef: payload.workItemRef,
    authorizationScopeDigest: payload.authorizationScopeDigest,
    actorRef: ACTOR_ID,
    authorizationContextRef: input.authorization.authorizationContextRef,
    queryId: RELATIONSHIP_QUERY_ID,
    knowledgeQueryResultRef,
  };
  const commandId = `relationship-query-result-${RELATIONSHIP_QUERY_ID}:register:first`;
  const command: AtomicCommandV1 = {
    projectId: PROJECT_ID,
    commandKind: "identification-context-result-register",
    commandId,
    idempotencyKey: commandId,
    payload: { fixture: "合成样本、待甲方复核" },
    actorRef: ACTOR_ID,
    authorizationContextRef: input.authorization.authorizationContextRef,
    issuedAt: TIMESTAMP,
  };
  const commit: AtomicCommitV1 = {
    resultRef: artifactRef,
    audit: {
      auditEntryId: `relationship-query-result-${RELATIONSHIP_QUERY_ID}:register:audit`,
      projectId: PROJECT_ID,
      action: command.commandKind,
      targetRef: artifactRef,
      actorRef: ACTOR_ID,
      authorizationContextRef: input.authorization.authorizationContextRef,
      occurredAt: TIMESTAMP,
      recordedAt: TIMESTAMP,
      version: { entityId: row.resultId, versionId: row.resultVersionId },
      commandId,
      idempotencyKey: commandId,
    },
    events: [],
  };
  await fixture.transactionUnit.execute(command, async (context) => {
    const outcome = await fixture.contextAdapter.registerResult(
      { row, occurredAt: TIMESTAMP },
      context,
    );
    expect(outcome).toEqual({ kind: "registered", replayed: false });
    return commit;
  });
  return knowledgeQueryResultRef;
};

const queryFor = (
  queryId: string,
  knowledgeQueryResultRef: KnowledgeQueryResultRefV1,
  authorization: AuthorizationContextV1,
): KnowledgeRetrievalReadQueryV1 => ({
  queryId,
  projectId: authorization.projectId,
  actorId: authorization.actorId,
  requestedAt: TIMESTAMP,
  authorization,
  kind: "retrieval-result",
  payload: { knowledgeQueryResultRef },
});

describe("C32 PostgreSQL knowledge retrieval read adapter", () => {
  let fixture: RetrievalReadTestFixture | undefined;

  beforeAll(async () => {
    fixture = await startRetrievalReadFixture();
  }, 180_000);

  afterAll(async () => {
    await fixture?.close().catch(() => undefined);
  });

  const adapterWith = (
    access: LocalIdentityAccessV1,
    hybridStored:
      | {
          readonly requestDigest: string;
          readonly knowledgeQueryResultRef: KnowledgeQueryResultRefV1;
          readonly resultArtifactRef: ArtifactRefV1;
        }
      | undefined,
  ) =>
    new PostgresKnowledgeRetrievalReadAdapter({
      relationshipResults: fixture!.contextAdapter,
      hybridReader: new PostgresOfficialHybridResultReader({
        retrievalStore: { readQueryResult: async () => hybridStored },
        artifactStore: fixture!.artifactStore,
      }),
      artifactStore: fixture!.artifactStore,
      access,
    });

  it("授权一致返回混合检索载荷且重放一致", async () => {
    const authorization = retrievalAuthorization();
    const requestDigest = sha("c32-hybrid-request");
    const payload = hybridPayload(authorization, requestDigest);
    const artifactRef = await putArtifact(fixture!, {
      artifactId: `hybrid-retrieval-result-${HYBRID_QUERY_ID}`,
      purposeCode: "hybrid-retrieval-query-result",
      content: new TextEncoder().encode(JSON.stringify(payload)),
      authorization,
    });
    const { access, register } = accessDouble();
    register(authorization);
    const adapter = adapterWith(access, {
      requestDigest,
      knowledgeQueryResultRef: hybridResultRef(requestDigest),
      resultArtifactRef: artifactRef,
    });

    const result = await adapter.read(
      queryFor("c32-read-hybrid", hybridResultRef(requestDigest), authorization),
    );
    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded" || result.result.kind !== "hybrid-evidence") return;
    expect(result.result.topK).toBe(4);
    expect(result.result.generationRef).toEqual(
      refOf("retrieval-generation", "retrieval-generation"),
    );
    expect(result.result.hits).toHaveLength(1);
    expect(result.result.hits[0]).toMatchObject({
      rank: 1,
      sourceKind: "risk-mechanism",
      sourceEntryId: "MEC-VDS-017",
      fusionScore: 0.75,
      denseContribution: 0.5,
      bm25Contribution: 0.25,
    });
    // 白名单外字段（内容摘要）不得进入读取 DTO。
    expect(result.result.hits[0]).not.toHaveProperty("contentDigest");

    // 同一查询身份重放：C06 一上下文一调用绑定下重放沿用原查询身份，内容必须一致。
    const replay = await adapter.read(
      queryFor("c32-read-hybrid", hybridResultRef(requestDigest), authorization),
    );
    expect(replay).toEqual(result);
  }, 90_000);

  it("授权一致返回关系上下文载荷（邻接节点、边、入选与筛除机理）", async () => {
    const authorization = retrievalAuthorization({ policyVersion: "v-relationship" });
    const requestDigest = sha("c32-relationship-request");
    const knowledgeQueryResultRef = await registerRelationshipResult(fixture!, {
      authorization,
      requestDigest,
    });
    const { access, register } = accessDouble();
    register(authorization);
    const adapter = adapterWith(access, undefined);

    const result = await adapter.read(
      queryFor("c32-read-relationship", knowledgeQueryResultRef, authorization),
    );
    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded" || result.result.kind !== "relationship-context") return;
    expect(result.result.nodeId).toBe("PN-VDS-04");
    expect(result.result.currentNode.processKind).toBe("变径空间扩挖");
    expect(result.result.neighborNodes).toHaveLength(1);
    expect(result.result.neighborNodes[0]).toMatchObject({
      nodeId: "PN-VDS-03",
      edgeId: "edge-time",
      relationType: "时间先后关系",
      upstream: true,
    });
    expect(result.result.dependencyEdges).toHaveLength(1);
    expect(result.result.mechanisms.map((member) => member.mechanismId)).toEqual(["MEC-VDS-017"]);
    expect(result.result.excludedMechanisms).toEqual([
      { mechanismId: "MEC-VDS-018", reasonCode: "applicability-mismatch" },
    ]);
    expect(result.result.releaseBinding).toEqual({
      processModelReleaseRef: refOf("knowledge-release", "process-model-release"),
      riskMechanismReleaseRef: refOf("knowledge-release", "risk-mechanism-release"),
      retrievalEvidenceBaseReleaseRef: refOf("knowledge-release", "evidence-base-release"),
    });
  }, 90_000);

  it("引用不存在、类型不符、授权摘要漂移与越权同形失败", async () => {
    const authorization = retrievalAuthorization({ policyVersion: "v-failure" });
    const { access, register } = accessDouble();
    register(authorization);
    const adapter = adapterWith(access, undefined);

    // 未登记的关系结果引用：同形失败。
    const missing = await adapter.read(
      queryFor("c32-read-missing", relationshipResultRef(sha("c32-not-registered")), authorization),
    );
    expect(missing.kind).toBe("failed");
    if (missing.kind === "failed") expect(missing.error.code).toBe("AUTHORIZATION_DENIED");

    // 混合引用走关系登记窄读不到事实（且读取端无登记）：同形失败。
    const hybridRefRead = await adapter.read(
      queryFor("c32-read-wrong-kind", hybridResultRef(sha("c32-no-hybrid")), authorization),
    );
    expect(hybridRefRead.kind).toBe("failed");

    // 授权摘要漂移：同一上下文身份换了策略版本，与登记摘要不符。
    const drifted = retrievalAuthorization({ policyVersion: "v-drifted" });
    register(drifted);
    const drift = await adapter.read(
      queryFor("c32-read-drift", relationshipResultRef(sha("c32-relationship-request")), drifted),
    );
    expect(drift.kind).toBe("failed");
    if (drift.kind === "failed") expect(drift.error.code).toBe("AUTHORIZATION_DENIED");

    // 未持检索能力：契约层即拒绝，适配器按授权失败收口。
    const noCapability = retrievalAuthorization({
      policyVersion: "v-no-capability",
      capabilities: ["knowledge-modeling.read"],
    });
    register(noCapability);
    const deniedResult = await adapter.read(
      queryFor("c32-read-no-capability", relationshipResultRef(sha("x")), noCapability),
    );
    expect(deniedResult.kind).toBe("failed");
    if (deniedResult.kind === "failed") {
      expect(deniedResult.error.code).toBe("AUTHORIZATION_DENIED");
    }

    // 跨工程：授权与查询工程不一致，同形失败且不披露是否存在。
    const otherProject = AuthorizationContextV1Schema.parse({
      ...authorization,
      projectId: "project-c32-other",
    });
    register(otherProject);
    const cross = await adapter.read(
      queryFor("c32-read-cross", relationshipResultRef(sha("x")), otherProject),
    );
    expect(cross.kind).toBe("failed");
    if (cross.kind === "failed") expect(cross.error.code).toBe("AUTHORIZATION_DENIED");
  }, 90_000);
});
