import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { VersionReferenceSchema } from "@riskflow/contracts/common";
import { z } from "@riskflow/core/model";
import {
  HybridRetrievalAcceptancePolicyV1Schema,
  HybridRetrievalPolicyV1Schema,
  normalizeRetrievalMembers,
  retrievalGenerationRefFor,
  type HybridRetrievalPolicyV1,
  type RetrievalIndexManifestV1,
  type RetrievalMemberSourceV1,
  type RetrievalSourceKindV1,
} from "@riskflow/core/retrieval";

/**
 * 验收夹具（IP-07 / design D11）：固定中文合成数据集、版本化验收策略、
 * 确定性固定向量与语料构造。C05 模型端口由固定向量替代（不冒充 Qdrant），
 * Qdrant 必须由真实 1.19.0 服务承担。
 */

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));

export const RETRIEVAL_ACCEPTANCE_PROJECT_ID = "project-c20-a";
export const RETRIEVAL_ACCEPTANCE_FOREIGN_PROJECT_ID = "project-c20-b";

const versionReference = VersionReferenceSchema;

const SyntheticMemberV1Schema = z.strictObject({
  memberId: z.string().min(1),
  sourceKind: z.enum(["risk-mechanism", "standard-library", "case-library"]),
  semanticGroup: z.string().min(1),
  text: z.string().min(1),
  evidenceSourceVersionRef: versionReference,
});

const SyntheticQueryV1Schema = z.strictObject({
  queryId: z.string().min(1),
  routeKind: z.enum(["lexical", "semantic-paraphrase", "dual-route"]),
  projectId: z.string().min(1),
  semanticGroup: z.string().min(1),
  text: z.string().min(1),
  expectedRelevantMemberIds: z.array(z.string().min(1)),
});

const InterferenceQueryV1Schema = z.strictObject({
  queryId: z.string().min(1),
  interferenceKind: z.enum(["cross-project", "no-permission"]),
  projectId: z.string().min(1),
  text: z.string().min(1),
  interferenceMemberIds: z.array(z.string().min(1)).min(1),
  note: z.string().min(1),
});

export const SyntheticRetrievalDatasetV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  syntheticSample: z.literal(true),
  sampleNotice: z.literal("合成样本、待甲方复核"),
  datasetRef: versionReference,
  projectId: z.string().min(1),
  members: z.array(SyntheticMemberV1Schema).min(6),
  queries: z.array(SyntheticQueryV1Schema).min(6),
  interference: z.array(InterferenceQueryV1Schema).min(2),
});
export type SyntheticRetrievalDatasetV1 = z.infer<typeof SyntheticRetrievalDatasetV1Schema>;

export const loadRetrievalAcceptanceDataset = (): SyntheticRetrievalDatasetV1 =>
  SyntheticRetrievalDatasetV1Schema.parse(
    JSON.parse(
      readFileSync(join(FIXTURE_DIR, "fixtures/synthetic-hybrid-retrieval.v1.json"), "utf8"),
    ),
  );

export const loadRetrievalAcceptancePolicy = () =>
  HybridRetrievalAcceptancePolicyV1Schema.parse(
    JSON.parse(readFileSync(join(FIXTURE_DIR, "fixtures/acceptance-policy.v1.json"), "utf8")),
  );

/** 固定检索策略：维度与验收数据集固定向量一致，阈值全部来自版本化验收策略。 */
export const retrievalAcceptancePolicy = (): HybridRetrievalPolicyV1 =>
  HybridRetrievalPolicyV1Schema.parse({
    schemaVersion: "1",
    policyRef: { entityId: "retrieval-policy", versionId: "c20-synthetic-v1" },
    evidenceBaseDefinitionType: "retrieval-evidence-base",
    modelDeploymentRef: { entityId: "embedding-deployment", versionId: "c20-synthetic-v1" },
    dense: { vectorName: "dense", dimensions: 8, distance: "cosine" },
    bm25: {
      vectorName: "bm25",
      model: "qdrant/bm25",
      tokenizer: "multilingual",
      language: "chinese",
      stemmer: "none",
      stopwords: [],
    },
    densePrefetchLimit: 10,
    bm25PrefetchLimit: 10,
    topK: 5,
    rrf: { k: 60, denseWeight: 0.6, bm25Weight: 0.4 },
    memberBatchLimit: 16,
    memberByteLimit: 8192,
    memberLimit: 64,
    embeddingTimeoutMs: 5000,
    projectionTimeoutMs: 10_000,
    acceptancePolicyRef: { entityId: "retrieval-acceptance-policy", versionId: "c20-synthetic-v1" },
    projectionCompatibilityRef: { entityId: "projection-compatibility", versionId: "fixture" },
  });

const MEMBER_RELEASE_ENTITY_BY_KIND: Readonly<Record<RetrievalSourceKindV1, string>> = {
  "risk-mechanism": "risk-mechanism-release",
  "standard-library": "standard-library-release",
  "case-library": "case-library-release",
};

/**
 * 数据集条目 → C17 成员条目形状：文本字段承载固定语料，其余字段缺省以减少人工噪音。
 * 成员文本、内容摘要和 point 身份因此都由核心投影函数确定性产生。
 */
export const retrievalMemberSourcesFromDataset = (
  dataset: SyntheticRetrievalDatasetV1,
): readonly RetrievalMemberSourceV1[] =>
  (["risk-mechanism", "standard-library", "case-library"] as const).map((sourceKind) => ({
    sourceKind,
    sourceReleaseRef: {
      kind: "knowledge-release" as const,
      reference: { entityId: MEMBER_RELEASE_ENTITY_BY_KIND[sourceKind], versionId: "1" },
    },
    entries: dataset.members
      .filter((member) => member.sourceKind === sourceKind)
      .map((member) => ({
        entryId: member.memberId,
        entry:
          sourceKind === "risk-mechanism"
            ? { mechanismId: member.memberId, mechanismType: member.text }
            : { entryId: member.memberId, standardIdentity: member.text },
      })),
  }));

export interface RetrievalAcceptanceManifestV1 {
  readonly generationRef: ReturnType<typeof retrievalGenerationRefFor>;
  readonly manifest: RetrievalIndexManifestV1;
  readonly collectionName: string;
  readonly memberIdByPointId: ReadonlyMap<string, string>;
  readonly memberTextByPointId: ReadonlyMap<string, string>;
}

export const buildAcceptanceManifest = (input: {
  readonly dataset: SyntheticRetrievalDatasetV1;
  readonly policy: HybridRetrievalPolicyV1;
}): RetrievalAcceptanceManifestV1 => {
  const generationRef = retrievalGenerationRefFor({
    projectId: input.dataset.projectId,
    sourceEventId: "acceptance-event",
    evidenceBaseReleaseRef: {
      kind: "retrieval-evidence-base-release",
      reference: { entityId: "retrieval-evidence-base-release", versionId: "1" },
    },
    memberReleaseRefs: {
      riskMechanismRef: versionReference.parse({
        entityId: "risk-mechanism-release",
        versionId: "1",
      }),
      standardLibraryRef: versionReference.parse({
        entityId: "standard-library-release",
        versionId: "1",
      }),
      caseLibraryRef: versionReference.parse({
        entityId: "case-library-release",
        versionId: "1",
      }),
    },
    policyRef: input.policy.policyRef,
    modelDeploymentRef: input.policy.modelDeploymentRef,
    projectionCompatibilityRef: input.policy.projectionCompatibilityRef,
  });
  const normalized = normalizeRetrievalMembers({
    projectId: input.dataset.projectId,
    generationRef,
    policy: input.policy,
    authorizationScopeDigest: "0".repeat(64),
    sources: retrievalMemberSourcesFromDataset(input.dataset),
  });
  if (normalized.kind === "failed") {
    throw new Error(`fixture members are invalid: ${normalized.code}/${normalized.detailCode}`);
  }
  const memberIdByPointId = new Map<string, string>();
  const memberTextByPointId = new Map<string, string>();
  for (const [index, point] of normalized.points.entries()) {
    const member = normalized.manifest.members[index]!;
    memberIdByPointId.set(point.pointId, member.sourceEntryId);
    memberTextByPointId.set(point.pointId, point.text);
  }
  return {
    generationRef,
    manifest: normalized.manifest,
    collectionName: `riskflow-retrieval-${generationRef.reference.versionId.replace(/^sha256:/u, "").slice(0, 32)}`,
    memberIdByPointId,
    memberTextByPointId,
  };
};

/**
 * 固定向量：同语义组共享基线方向，成员带微小扰动避免同分量级并列。
 * 该函数替代 C05 模型端口，不替代 Qdrant；query 与 document 使用同一映射。
 */
export const fixedDenseVectorFor = (input: {
  readonly semanticGroup: string;
  readonly memberIndex: number;
}): readonly number[] => {
  const dimensions = 8;
  let hash = 2166136261;
  for (const character of input.semanticGroup) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  }
  const group = Array.from(
    { length: dimensions },
    (_, index) => ((hash >>> (index * 3)) & 0x7) / 8 + 0.05,
  );
  const magnitude = Math.sqrt(group.reduce((sum, value) => sum + value * value, 0));
  const direction = group.map((value) => value / magnitude);
  const perturbed = [...direction];
  perturbed[input.memberIndex % dimensions] =
    (perturbed[input.memberIndex % dimensions] ?? 0) + 0.001;
  const perturbedMagnitude = Math.sqrt(perturbed.reduce((sum, value) => sum + value * value, 0));
  return perturbed.map((value) => value / perturbedMagnitude);
};

export const recallAtK = (input: {
  readonly retrieved: readonly string[];
  readonly relevant: readonly string[];
  readonly k: number;
}): number => {
  if (input.relevant.length === 0) return 1;
  const retrieved = new Set(input.retrieved.slice(0, input.k));
  const hits = input.relevant.filter((memberId) => retrieved.has(memberId)).length;
  return hits / input.relevant.length;
};

export const ndcgAtK = (input: {
  readonly retrieved: readonly string[];
  readonly relevant: readonly string[];
  readonly k: number;
}): number => {
  const relevant = new Set(input.relevant);
  const dcg = input.retrieved
    .slice(0, input.k)
    .reduce(
      (total, memberId, index) => total + (relevant.has(memberId) ? 1 / Math.log2(index + 2) : 0),
      0,
    );
  const ideal = Array.from({ length: Math.min(input.relevant.length, input.k) }).reduce<number>(
    (total, _unused, index) => total + 1 / Math.log2(index + 2),
    0,
  );
  return ideal === 0 ? 1 : dcg / ideal;
};

export const percentile = (values: readonly number[], quantile: number): number => {
  if (values.length === 0) throw new Error("percentile requires at least one sample");
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1);
  return sorted[index]!;
};

export const memberIdForPoint = (
  manifest: RetrievalAcceptanceManifestV1,
  pointId: string,
): string | undefined => manifest.memberIdByPointId.get(pointId);
