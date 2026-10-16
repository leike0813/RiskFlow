import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  AuthorizationContextV1,
  KnowledgeGovernanceReadQueryV1,
} from "@riskflow/contracts/ports";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";

import {
  createPostgresKnowledgeGovernanceReadAdapter,
  type PostgresKnowledgeGovernanceReadAdapter,
} from "../../src/knowledge-governance/index.js";
import {
  startKnowledgeGovernanceFixture,
  type KnowledgeGovernancePostgresFixture,
} from "./fixture.js";

const now = "2030-01-01T00:00:00.000Z";
const projectId = "c32-governance-read-project";
const actorId = "manager-1";

const authorization = (
  overrides: Partial<AuthorizationContextV1> = {},
): AuthorizationContextV1 => ({
  schemaVersion: "1",
  authorizationContextRef: {
    kind: "authorization-context",
    reference: { entityId: `authorization-${projectId}-${actorId}`, versionId: "1" },
  },
  actorId,
  projectId,
  grantedCapabilities: ["knowledge-modeling.read"],
  spatialScopeRefs: [],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
  decidedAt: now,
  invocation: { kind: "human" },
  ...overrides,
});

const authContextRef = {
  kind: "authorization-context",
  reference: { entityId: "ctx-1", versionId: "1" },
};
const audit = "audit-1";
const digest = "a".repeat(64);
const evidence = [
  {
    locator: { sourceSegmentId: "DOC1-S1-SEG1" },
    sourceVersion: { entityId: "s1", versionId: "1" },
  },
];

const processModelPackage = {
  schemaVersion: "1",
  projectId,
  definitionType: "process-model",
  validationPolicyRef: { entityId: "vp", versionId: "1" },
  preparationSnapshotRef: {
    kind: "identification-preparation-snapshot",
    reference: { entityId: "prep-1", versionId: "1" },
  },
  generatedAt: now,
  nodes: [
    {
      nodeId: "PN-VDS-04",
      processKind: "变径空间扩挖",
      inputs: ["扩挖设计"],
      outputs: ["扩挖断面"],
      equipmentRefs: ["扩挖机构"],
      structuralComponentRefs: ["钢管片"],
      stateParameters: ["盾体直径"],
      monitoringIndicators: ["地表沉降"],
      applicability: {
        constructionMethod: ["变径盾构"],
        stratumCondition: ["软土"],
        engineeringStage: ["扩挖"],
      },
      evidence,
    },
  ],
  dependencyEdges: [],
};

const mechanismPackage = {
  schemaVersion: "1",
  projectId,
  definitionType: "risk-mechanism",
  validationPolicyRef: { entityId: "vp", versionId: "1" },
  preparationSnapshotRef: {
    kind: "identification-preparation-snapshot",
    reference: { entityId: "prep-1", versionId: "1" },
  },
  generatedAt: now,
  processModelReleaseRef: {
    kind: "process-model-release",
    reference: { entityId: "pm-release-1", versionId: "1" },
  },
  mechanisms: [
    {
      mechanismId: "MEC-VDS-017",
      mechanismType: "过挖与地表沉降",
      nodeIds: ["PN-VDS-04"],
      stateParameters: ["土仓/泥水压力"],
      monitoringIndicators: ["地表沉降"],
      applicability: {
        constructionMethod: ["变径盾构"],
        stratumCondition: ["软土"],
        engineeringStage: ["扩挖"],
      },
      preconditions: ["土仓压力不足"],
      triggeringFactors: ["超挖"],
      evolutionPath: ["变形发展"],
      consequences: ["地表沉降超限"],
      evidence,
    },
  ],
};

const matrixDocument = {
  schemaVersion: "1",
  definitionType: "risk-matrix",
  projectRevisionRef: {
    kind: "project-revision",
    reference: { entityId: projectId, versionId: "1" },
  },
  configurationSetRef: { entityId: "config-set", versionId: "1" },
  content: {
    matrixId: "matrix-1",
    matrixVersion: "2026.06",
    possibilityAxis: { bands: [{ bandId: "P1", lower: "0", upper: "0.2" }] },
    consequenceAxis: { bands: [{ bandId: "C1", lower: "0", upper: "0.2" }] },
    riskLevels: [{ levelId: "I", ordinal: 1 }],
    cells: [{ possibilityBandId: "P1", consequenceBandId: "C1", riskLevelId: "I" }],
  },
};

const measureDocument = {
  schemaVersion: "1",
  definitionType: "measure-library",
  projectRevisionRef: {
    kind: "project-revision",
    reference: { entityId: projectId, versionId: "1" },
  },
  configurationSetRef: { entityId: "config-set", versionId: "1" },
  content: {
    measures: [
      {
        measureId: "MS-001",
        riskEventCategory: "地表沉降超限",
        applicabilityConditions: [{ dimension: "施工工法数据", values: ["变径盾构"] }],
        triggerTypes: ["监测指标越限"],
        steps: [{ stepOrdinal: 1, instruction: "加强注浆" }],
        resourceRequirements: ["注浆设备"],
        targetIndicatorIds: ["地表沉降"],
        evidenceRequirements: ["监测日报"],
        contraindications: [],
      },
    ],
  },
};

const artifactVersion = `sha256:${"c".repeat(64)}`;
const artifactRef = (id: string) => ({
  kind: "content-artifact",
  reference: { entityId: id, versionId: artifactVersion },
});

const bodies = new Map<string, string>([
  [`art-pm@${artifactVersion}`, JSON.stringify(processModelPackage)],
  [`art-mec@${artifactVersion}`, JSON.stringify(mechanismPackage)],
  [`art-matrix@${artifactVersion}`, JSON.stringify(matrixDocument)],
  [`art-measure@${artifactVersion}`, JSON.stringify(measureDocument)],
]);

const stubArtifactStore = {
  open: async (request: {
    artifactRef: { reference: { entityId: string; versionId: string } };
  }) => {
    const key = `${request.artifactRef.reference.entityId}@${request.artifactRef.reference.versionId}`;
    const text = bodies.get(key);
    if (text === undefined) throw new Error("ARTIFACT_ACCESS_DENIED");
    const bytes = new TextEncoder().encode(text);
    return {
      content: (async function* () {
        yield bytes;
      })(),
      completed: Promise.resolve(),
    };
  },
  put: async () => {
    throw new Error("put is not used by the read adapter");
  },
} as unknown as ArtifactStoreV1;

const queryFor = (
  queryId: string,
  payload: KnowledgeGovernanceReadQueryV1["payload"],
  auth: AuthorizationContextV1 = authorization(),
): KnowledgeGovernanceReadQueryV1 => ({
  queryId,
  projectId,
  actorId,
  requestedAt: now,
  authorization: auth,
  kind: "governance-read",
  payload,
});

describe("C32 PostgreSQL knowledge governance read adapter", () => {
  let fixture: KnowledgeGovernancePostgresFixture;
  let adapter: PostgresKnowledgeGovernanceReadAdapter;

  beforeAll(async () => {
    fixture = await startKnowledgeGovernanceFixture();
    const db = fixture.runtime.db;
    // C03 命令回执与审计条目：治理行经外键依赖它们。
    await db
      .insertInto("business.command_receipts" as never)
      .values({
        project_id: projectId,
        command_kind: "knowledge-modeling.govern.v1",
        idempotency_key: "c32-governance-seed",
        command_id: "cmd-c32-governance-seed",
        payload_sha256: "b".repeat(64),
        result_ref: JSON.stringify({
          kind: "knowledge-definition",
          reference: { entityId: "seed", versionId: "1" },
        }),
        audit_entry_id: audit,
        actor_ref: actorId,
        authorization_context_ref: JSON.stringify(authContextRef),
        completed_at: now,
        created_at: now,
      } as never)
      .execute();
    await db
      .insertInto("audit.entries" as never)
      .values({
        audit_entry_id: audit,
        project_id: projectId,
        action: "knowledge-modeling.seed",
        target_ref: JSON.stringify({ entityId: "seed", versionId: "1" }),
        actor_ref: actorId,
        authorization_context_ref: JSON.stringify(authContextRef),
        version_ref: JSON.stringify({ entityId: "seed", versionId: "1" }),
        occurred_at: now,
        recorded_at: now,
        command_id: "cmd-c32-governance-seed",
        idempotency_key: "c32-governance-seed",
      } as never)
      .execute();
    const insertDefinition = (id: string, type: string) =>
      db
        .insertInto("business.knowledge_definitions" as never)
        .values({
          definition_id: id,
          version_id: "1",
          project_id: projectId,
          definition_type: type,
          created_by: actorId,
          authorization_context_ref: JSON.stringify(authContextRef),
          command_id: "cmd-c32-governance-seed",
          audit_entry_id: audit,
          created_at: now,
          occurred_at: now,
          recorded_at: now,
          persisted_at: now,
        } as never)
        .execute();
    const insertRevision = (
      id: string,
      definitionId: string,
      type: string,
      artifactId: string,
      recordedAt: string,
    ) =>
      db
        .insertInto("business.knowledge_revisions" as never)
        .values({
          revision_id: id,
          version_id: "1",
          definition_id: definitionId,
          definition_version_id: "1",
          project_id: projectId,
          definition_type: type,
          candidate_artifact_entity_id: artifactId,
          candidate_artifact_version_id: "1",
          candidate_artifact_ref: JSON.stringify(artifactRef(artifactId)),
          evidence_references: JSON.stringify(evidence),
          base_release_ref: null,
          base_revision_ref: null,
          artifact_identity_digest: digest,
          command_id: "cmd-c32-governance-seed",
          actor_ref: actorId,
          authorization_context_ref: JSON.stringify(authContextRef),
          audit_entry_id: audit,
          occurred_at: recordedAt,
          recorded_at: recordedAt,
          persisted_at: recordedAt,
        } as never)
        .execute();
    const insertLink = (attemptId: string, revisionId: string) =>
      db
        .insertInto("business.knowledge_review_links" as never)
        .values({
          review_attempt_id: attemptId,
          version_id: "1",
          project_id: projectId,
          revision_id: revisionId,
          revision_version_id: "1",
          revision_ref: JSON.stringify({
            kind: "knowledge-revision",
            reference: { entityId: revisionId, versionId: "1" },
          }),
          review_policy_entity_id: "rp",
          review_policy_version_id: "1",
          review_policy_ref: JSON.stringify({ entityId: "rp", versionId: "1" }),
          validation_snapshot_ref: JSON.stringify({
            kind: "content-artifact",
            reference: { entityId: "vs-1", versionId: "1" },
          }),
          evidence_snapshot_ref: JSON.stringify({
            kind: "content-artifact",
            reference: { entityId: "es-1", versionId: "1" },
          }),
          waiting_run_ref: JSON.stringify({
            kind: "workflow-run",
            reference: { entityId: "run-1", versionId: "1" },
          }),
          review_task_ref: null,
          review_decision_ref: null,
          state: "waiting",
          requested_by: actorId,
          authorization_context_ref: JSON.stringify(authContextRef),
          command_id: "cmd-c32-governance-seed",
          audit_entry_id: audit,
          requested_at: now,
          occurred_at: now,
          recorded_at: now,
          persisted_at: now,
        } as never)
        .execute();
    const insertRelease = (id: string, definitionId: string, revisionId: string, type: string) =>
      db
        .insertInto("business.knowledge_releases" as never)
        .values({
          release_id: id,
          version_id: "1",
          definition_id: definitionId,
          definition_version_id: "1",
          project_id: projectId,
          definition_type: type,
          revision_id: revisionId,
          revision_version_id: "1",
          revision_ref: JSON.stringify({
            kind: "knowledge-revision",
            reference: { entityId: revisionId, versionId: "1" },
          }),
          review_task_ref: JSON.stringify({
            kind: "review-task",
            reference: { entityId: "rt-1", versionId: "1" },
          }),
          review_decision_ref: JSON.stringify({
            kind: "review-decision",
            reference: { entityId: "rd-1", versionId: "1" },
          }),
          effective_from: now,
          restored_from_release_ref: null,
          reason_code: null,
          command_id: "cmd-c32-governance-seed",
          actor_ref: actorId,
          authorization_context_ref: JSON.stringify(authContextRef),
          audit_entry_id: audit,
          occurred_at: now,
          recorded_at: now,
          persisted_at: now,
        } as never)
        .execute();
    const insertDecision = (id: string, releaseId: string, definitionId: string) =>
      db
        .insertInto("business.knowledge_release_decisions" as never)
        .values({
          decision_id: id,
          version_id: "1",
          release_id: releaseId,
          release_version_id: "1",
          project_id: projectId,
          definition_id: definitionId,
          release_ref: JSON.stringify({
            kind: "knowledge-release",
            reference: { entityId: releaseId, versionId: "1" },
          }),
          decision: "deactivated",
          reason_code: "superseded",
          command_id: "cmd-c32-governance-seed",
          actor_ref: actorId,
          authorization_context_ref: JSON.stringify(authContextRef),
          audit_entry_id: audit,
          occurred_at: now,
          recorded_at: now,
          persisted_at: now,
        } as never)
        .execute();

    // D1 risk-mechanism：草稿修订（无发布）
    await insertDefinition("def-mec", "risk-mechanism");
    await insertRevision("rev-mec-1", "def-mec", "risk-mechanism", "art-mec", now);
    // D2 case-library：在审修订
    await insertDefinition("def-case", "case-library");
    await insertRevision("rev-case-1", "def-case", "case-library", "art-case", now);
    await insertLink("attempt-case-1", "rev-case-1");
    // D3 risk-matrix：已发布
    await insertDefinition("def-matrix", "risk-matrix");
    await insertRevision("rev-matrix-1", "def-matrix", "risk-matrix", "art-matrix", now);
    await insertRelease("rel-matrix-1", "def-matrix", "rev-matrix-1", "risk-matrix");
    // D4 measure-library：发布后停用
    await insertDefinition("def-measure", "measure-library");
    await insertRevision("rev-measure-1", "def-measure", "measure-library", "art-measure", now);
    await insertRelease("rel-measure-1", "def-measure", "rev-measure-1", "measure-library");
    await insertDecision("dec-measure-1", "rel-measure-1", "def-measure");
    // D5 process-model：已发布
    await insertDefinition("def-pm", "process-model");
    await insertRevision("rev-pm-1", "def-pm", "process-model", "art-pm", now);
    await insertRelease("rel-pm-1", "def-pm", "rev-pm-1", "process-model");

    adapter = createPostgresKnowledgeGovernanceReadAdapter({
      db: fixture.runtime.db,
      access: fixture.access,
      artifactStore: stubArtifactStore,
    }) as PostgresKnowledgeGovernanceReadAdapter;
  }, 240_000);

  afterAll(async () => {
    await fixture?.close();
  }, 60_000);

  it("list-definitions 按类型返回生命周期状态与版本摘要（无正文）", async () => {
    const result = await adapter.read(
      queryFor("q-list-mec", { operation: "list-definitions", definitionType: "risk-mechanism" }),
    );
    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded" || result.result.kind !== "list-definitions") return;
    expect(result.result.totalCount).toBe(1);
    expect(result.result.items[0]).toMatchObject({
      definitionRef: { reference: { entityId: "def-mec" } },
      lifecycleStatus: "draft",
    });
    const inReview = await adapter.read(
      queryFor("q-list-case", { operation: "list-definitions", definitionType: "case-library" }),
    );
    expect(inReview.kind).toBe("succeeded");
    if (inReview.kind !== "succeeded" || inReview.result.kind !== "list-definitions") return;
    expect(inReview.result.items[0]).toMatchObject({
      definitionRef: { reference: { entityId: "def-case" } },
      lifecycleStatus: "in-review",
    });
    for (const item of [...result.result.items, ...inReview.result.items]) {
      expect(item).not.toHaveProperty("body");
    }
  });

  it("list-definitions 支持生命周期筛选与关键字", async () => {
    const published = await adapter.read(
      queryFor("q-list-published", {
        operation: "list-definitions",
        definitionType: "risk-matrix",
        lifecycleStatus: "published",
      }),
    );
    expect(published.kind).toBe("succeeded");
    if (published.kind !== "succeeded" || published.result.kind !== "list-definitions") return;
    expect(published.result.items).toHaveLength(1);
    expect(published.result.items[0]).toMatchObject({
      lifecycleStatus: "published",
      currentReleaseRef: { reference: { entityId: "rel-matrix-1" } },
    });
    const keyword = await adapter.read(
      queryFor("q-list-keyword", {
        operation: "list-definitions",
        definitionType: "case-library",
        keyword: "case",
      }),
    );
    expect(keyword.kind).toBe("succeeded");
    if (keyword.kind !== "succeeded" || keyword.result.kind !== "list-definitions") return;
    expect(keyword.result.items.map((item) => item.definitionRef.reference.entityId)).toEqual([
      "def-case",
    ]);
  });

  it("read-definition-release 返回矩阵正文且可重放", async () => {
    const read = await adapter.read(
      queryFor("q-read-matrix", {
        operation: "read-definition-release",
        knowledgeReleaseRef: {
          kind: "knowledge-release",
          reference: { entityId: "rel-matrix-1", versionId: "1" },
        },
      }),
    );
    expect(read.kind).toBe("succeeded");
    if (read.kind !== "succeeded" || read.result.kind !== "read-definition-release") return;
    expect(read.result.body).toMatchObject({
      definitionType: "risk-matrix",
      matrixId: "matrix-1",
      riskLevels: [{ levelId: "I", ordinal: 1 }],
      cells: [{ possibilityBandId: "P1", consequenceBandId: "C1", riskLevelId: "I" }],
    });
    expect(read.result.deactivatedAt).toBeUndefined();
    const replay = await adapter.read(
      queryFor("q-read-matrix-replay", {
        operation: "read-definition-release",
        knowledgeReleaseRef: {
          kind: "knowledge-release",
          reference: { entityId: "rel-matrix-1", versionId: "1" },
        },
      }),
    );
    expect(replay).toEqual(read);
  });

  it("read-definition-release 对已停用发布返回 deactivatedAt；read-definition-revision 返回草稿状态与机理正文", async () => {
    const deactivated = await adapter.read(
      queryFor("q-read-measure", {
        operation: "read-definition-release",
        knowledgeReleaseRef: {
          kind: "knowledge-release",
          reference: { entityId: "rel-measure-1", versionId: "1" },
        },
      }),
    );
    expect(deactivated.kind).toBe("succeeded");
    if (deactivated.kind !== "succeeded" || deactivated.result.kind !== "read-definition-release")
      return;
    expect(deactivated.result.deactivatedAt).toBe(now);
    expect(deactivated.result.body).toMatchObject({
      definitionType: "measure-library",
      measures: [{ measureId: "MS-001" }],
    });

    const draft = await adapter.read(
      queryFor("q-read-rev-mec", {
        operation: "read-definition-revision",
        knowledgeRevisionRef: {
          kind: "knowledge-revision",
          reference: { entityId: "rev-mec-1", versionId: "1" },
        },
      }),
    );
    expect(draft.kind).toBe("succeeded");
    if (draft.kind !== "succeeded" || draft.result.kind !== "read-definition-revision") return;
    expect(draft.result.revisionStatus).toBe("draft");
    expect(draft.result.body).toMatchObject({
      definitionType: "risk-mechanism",
      mechanisms: [{ mechanismId: "MEC-VDS-017", mechanismType: "过挖与地表沉降" }],
    });
    expect(draft.result.evidenceReferences).toHaveLength(1);
  });

  it("current-release-set 只含当前有效发布", async () => {
    const result = await adapter.read(
      queryFor("q-release-set", { operation: "current-release-set" }),
    );
    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded" || result.result.kind !== "current-release-set") return;
    const byType = new Map(
      result.result.releases.map((member) => [
        member.definitionType,
        member.releaseRef.reference.entityId,
      ]),
    );
    expect(byType.get("risk-matrix")).toBe("rel-matrix-1");
    expect(byType.get("process-model")).toBe("rel-pm-1");
    expect(byType.has("measure-library")).toBe(false);
  });

  it("越权、跨工程与不存在同形失败", async () => {
    const wrongProject = await adapter.read(
      queryFor(
        "q-denied-project",
        { operation: "current-release-set" },
        authorization({ projectId: "project-other" }),
      ),
    );
    expect(wrongProject.kind).toBe("failed");
    if (wrongProject.kind === "failed") {
      expect(wrongProject.error.code).toBe("AUTHORIZATION_DENIED");
    }
    const missing = await adapter.read(
      queryFor("q-denied-missing", {
        operation: "read-definition-release",
        knowledgeReleaseRef: {
          kind: "knowledge-release",
          reference: { entityId: "rel-missing", versionId: "1" },
        },
      }),
    );
    expect(missing.kind).toBe("failed");
    if (missing.kind === "failed") {
      expect(missing.error.code).toBe("AUTHORIZATION_DENIED");
    }
    const noCapability = await adapter.read(
      queryFor(
        "q-denied-capability",
        { operation: "current-release-set" },
        authorization({ grantedCapabilities: ["engineering-data.read"] }),
      ),
    );
    expect(noCapability.kind).toBe("failed");
    if (noCapability.kind === "failed") {
      expect(noCapability.error.code).toBe("AUTHORIZATION_DENIED");
    }
  });
});
