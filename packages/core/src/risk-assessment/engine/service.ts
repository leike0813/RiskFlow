import { z } from "zod";

import {
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type AssessmentBasisReleaseSetRefV1,
  type AssessmentInputSnapshotRefV1,
  type AssessmentPreparationSnapshotRefV1,
  type KnowledgeReleaseRefV1,
  type ModuleBranchV1,
  type ModuleCapabilityV1,
  type ModuleErrorV1,
  type EngineeringDataQueryV1,
  type EngineeringDataReadResultV1,
  type RiskAssessmentPortV1,
  type SpatialScopeRefV1,
  type SourceVersionRefV1,
  type WaitingRefV1,
} from "@riskflow/contracts/ports";
import {
  type MonitoringResultV1,
  type MonitoringSeriesReaderV1,
  type ResolveMonitoringSnapshotQueryV1,
} from "../../engineering-data/monitoring/index.js";
import type { ApplicabilityMetadataSnapshotV1 } from "../../engineering-data/context-source/index.js";
import type { ForecastRiskStateRequestV1, ForecastRiskStateResultV1 } from "./schema.js";
import type { AssessmentPreparationSnapshotV1 } from "@riskflow/contracts/workflows";
import {
  ArtifactReadRequestV1Schema,
  type ArtifactReadHandleV1,
  type ArtifactStoreV1,
} from "../../artifacts/index.js";
import {
  APPLICABLE_RULE_SET_ARTIFACT_PURPOSE_CODE_V1,
  APPLICABLE_RULE_SET_MEDIA_TYPE_V1,
  ApplicableRuleSetDocumentV1Schema,
  SCORING_RULES_MAX_ARTIFACT_BYTES_V1,
  STRUCTURED_SCORING_RULE_ARTIFACT_PURPOSE_CODE_V1,
  STRUCTURED_SCORING_RULE_MEDIA_TYPE_V1,
  StructuredScoringRuleDocumentV1Schema,
  applicableRuleSetDocumentDigest,
  structuredScoringRuleDocumentDigest,
  type ApplicableRuleSetDocumentV1,
  type StructuredScoringRuleDocumentV1,
} from "../../scoring-rules/index.js";
import {
  RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1,
  RISK_ASSESSMENT_MAX_ARTIFACT_BYTES_V1,
  failRiskAssessment,
  riskAssessmentFailureFrom,
  type AssessmentRuntimePolicySetV1,
  type RiskInputFactsReadRequestV1,
  type RiskInputFactsV1,
} from "./schema.js";

/**
 * C25 通过四个窄接缝消费其它模块拥有的正式事实（D-01）：
 * 风险输入事实、评估准备上下文、C19 评估依据成员、运行时策略提供者。
 * 每个接缝只表达一次读取，不复制任何上游 Schema 或正文。
 */

export interface RiskInputFactsReaderV1 {
  readRiskInputFacts(
    input: RiskInputFactsReadRequestV1,
  ): Promise<
    | { readonly kind: "succeeded"; readonly facts: RiskInputFactsV1 }
    | { readonly kind: "waiting"; readonly waiting: WaitingRefV1 }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  >;
}

export interface AssessmentPreparationContextReaderV1 {
  readAssessmentPreparationContext(input: {
    readonly requestId: string;
    readonly idempotencyKey: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly preparationSnapshotRef: AssessmentPreparationSnapshotRefV1;
  }): Promise<
    | {
        readonly kind: "succeeded";
        readonly preparation: AssessmentPreparationSnapshotV1;
        readonly applicability: ApplicabilityMetadataSnapshotV1;
      }
    | { readonly kind: "waiting"; readonly waiting: WaitingRefV1 }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  >;
}

/** C25 owns the exact frozen assessment input; C29 consumes only this projection. */
export interface AssessmentInputSnapshotReaderV1 {
  readInputSnapshot(input: {
    readonly requestId: string;
    readonly requestedAt: string;
    readonly projectId: string;
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
    readonly inputSnapshotRef: AssessmentInputSnapshotRefV1;
    readonly targetReleaseRef: KnowledgeReleaseRefV1;
  }): Promise<
    | {
        readonly kind: "succeeded";
        readonly projectId: string;
        readonly spatialScopeRef: SpatialScopeRefV1;
        readonly basisReleaseSetRef: AssessmentBasisReleaseSetRefV1;
        readonly targetReleaseRef: KnowledgeReleaseRefV1;
        readonly targetContentDigest: string;
      }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  >;
}

export interface AssessmentRuntimePolicySetProviderV1 {
  readRuntimePolicySet(input: {
    readonly requestId: string;
    readonly idempotencyKey: string;
    readonly requestedAt: string;
    readonly requiredAt: string;
    readonly authorization: AuthorizationContextV1;
    readonly preparationSnapshotRef: AssessmentPreparationSnapshotRefV1;
    readonly assessmentBasisReleaseSetRef: AssessmentBasisReleaseSetRefV1;
  }): Promise<
    | { readonly kind: "succeeded"; readonly policySet: AssessmentRuntimePolicySetV1 }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  >;
}

/**
 * C25 下游读取各自绑定一个精确 C06 分支：调用方上下文只有自己那一个 capability，
 * 不能直传或派生（C06 verify 要求 stored.branch 相等且子上下文 capability ⊆ 父）。
 * 组合根按这些分支签发精确上下文；绑定不符或缺失时 adapter 关闭失败。
 */
export const RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1 = {
  preparationContext: "engineering-data.evidence-access",
  riskInputFacts: "engineering-data.evidence-access",
  basisMembers: "knowledge-modeling.assessment-basis",
  monitoringReads: "engineering-data.monitoring-snapshot-query",
} as const satisfies Readonly<Record<string, ModuleBranchV1>>;

export interface AssessmentDownstreamAuthorizationRequestV1 {
  readonly branch: ModuleBranchV1;
  readonly invocationId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly requestedAt: string;
  readonly requestedSpatialScopeRefs?: readonly SpatialScopeRefV1[];
  readonly requestedSourceVersionRefs?: readonly SourceVersionRefV1[];
}

/** 与 C17 组合根同形的内部签发接缝；非公共 contracts、非依赖变更。 */
export type AssessmentDownstreamAuthorizerV1 = (
  request: AssessmentDownstreamAuthorizationRequestV1,
) => Promise<AuthorizationContextV1>;

/** C14 侧的窄读取组合：快照查询 + 序列修订读取，不复制监测事实。 */
export interface AssessmentMonitoringReaderV1 extends MonitoringSeriesReaderV1 {
  readSnapshot(
    query: Extract<EngineeringDataQueryV1, { kind: "monitoring-snapshot" }>,
  ): Promise<EngineeringDataReadResultV1>;
  resolveSnapshotQuery(query: ResolveMonitoringSnapshotQueryV1): Promise<MonitoringResultV1>;
}

/** C25 用例接口：实现方是 `packages/adapters` 的 PostgreSQL engine。 */
export type RiskAssessmentEngineV1 = RiskAssessmentPortV1;

/**
 * C25 拥有的预测风险状态投影（design D-08）。调用方是 C28：它已冻结正式建议、精确基线与
 * 执行前监测快照，需要一个「按同一评分依据重算后风险落在哪一档」的纯计算接缝。
 *
 * 该端口只读：实现方不得写评估记录、实际值集合、准备快照、预警、收据或 Outbox 事件，
 * 因此同一请求重复执行不产生任何业务写入，却必须给出完全相同的结果。
 */
export interface ForecastRiskStatePortV1 {
  projectForecastRiskState(request: ForecastRiskStateRequestV1): Promise<ForecastRiskStateResultV1>;
}

/* -------------------------------------------------------------------------- */
/* C04 受权有界读取（D-03）                                                    */
/* -------------------------------------------------------------------------- */

const readBoundedContent = async (handle: ArtifactReadHandleV1): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for await (const chunk of handle.content) {
    byteLength += chunk.byteLength;
    if (
      byteLength >
      Math.min(RISK_ASSESSMENT_MAX_ARTIFACT_BYTES_V1, SCORING_RULES_MAX_ARTIFACT_BYTES_V1)
    ) {
      failRiskAssessment("risk-assessment-artifact-mismatch", {
        kind: "content-artifact",
        reference: handle.manifest.artifactRef.reference,
      });
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

const artifactTargetRef = (artifactRef: ContentArtifactRefV1) => ({
  kind: "content-artifact" as const,
  reference: artifactRef.reference,
});

export interface VerifiedArtifactReadInputV1<T> {
  readonly artifactStore: ArtifactStoreV1;
  readonly artifactRef: ContentArtifactRefV1;
  readonly expectedMediaType: string;
  readonly purposeCode: string;
  readonly requiredCapability: ModuleCapabilityV1;
  readonly projectId: string;
  readonly actorId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly authorization: AuthorizationContextV1;
  readonly schema: z.ZodType<T>;
  readonly digest: (value: T) => string;
}

/** 打开、完整校验并按 strict Schema + 拥有方摘要函数解析一份正式工件正文。 */
export const readVerifiedJsonArtifact = async <T>(
  input: VerifiedArtifactReadInputV1<T>,
): Promise<{ readonly value: T; readonly contentDigest: string }> => {
  if (input.authorization.projectId !== input.projectId) {
    failRiskAssessment("risk-assessment-project-mismatch", artifactTargetRef(input.artifactRef));
  }
  const handle = await input.artifactStore
    .open(
      ArtifactReadRequestV1Schema.parse({
        schemaVersion: RISK_ASSESSMENT_ENGINE_SCHEMA_VERSION_V1,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        artifactRef: input.artifactRef,
        projectId: input.projectId,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        purposeCode: input.purposeCode,
        requiredCapability: input.requiredCapability,
        authorization: input.authorization,
      }),
    )
    .catch((error: unknown): never => {
      const failure = riskAssessmentFailureFrom(error);
      if (failure !== undefined) throw error;
      return failRiskAssessment(
        "risk-assessment-artifact-mismatch",
        artifactTargetRef(input.artifactRef),
      );
    });
  const bytes = await readBoundedContent(handle);
  const receipt = await handle.verified;
  if (
    receipt.content.hash.value !== handle.manifest.content.hash.value ||
    receipt.content.byteLength !== handle.manifest.content.byteLength
  ) {
    failRiskAssessment("risk-assessment-artifact-mismatch", artifactTargetRef(input.artifactRef));
  }
  if (handle.manifest.mediaType !== input.expectedMediaType) {
    failRiskAssessment("risk-assessment-artifact-mismatch", artifactTargetRef(input.artifactRef));
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    failRiskAssessment("risk-assessment-artifact-mismatch", artifactTargetRef(input.artifactRef));
  }
  const parsed = input.schema.safeParse(raw);
  if (!parsed.success) {
    failRiskAssessment("risk-assessment-artifact-mismatch", artifactTargetRef(input.artifactRef));
  }
  const value = parsed.data;
  return { value, contentDigest: input.digest(value) };
};

export const readStructuredScoringRuleDocument = (input: {
  readonly artifactStore: ArtifactStoreV1;
  readonly artifactRef: ContentArtifactRefV1;
  readonly projectId: string;
  readonly actorId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly requiredCapability: ModuleCapabilityV1;
  readonly authorization: AuthorizationContextV1;
}): Promise<{ readonly value: StructuredScoringRuleDocumentV1; readonly contentDigest: string }> =>
  readVerifiedJsonArtifact({
    ...input,
    expectedMediaType: STRUCTURED_SCORING_RULE_MEDIA_TYPE_V1,
    purposeCode: STRUCTURED_SCORING_RULE_ARTIFACT_PURPOSE_CODE_V1,
    schema: StructuredScoringRuleDocumentV1Schema,
    digest: structuredScoringRuleDocumentDigest,
  });

export const readApplicableRuleSetDocument = (input: {
  readonly artifactStore: ArtifactStoreV1;
  readonly artifactRef: ContentArtifactRefV1;
  readonly projectId: string;
  readonly actorId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly requiredCapability: ModuleCapabilityV1;
  readonly authorization: AuthorizationContextV1;
}): Promise<{ readonly value: ApplicableRuleSetDocumentV1; readonly contentDigest: string }> =>
  readVerifiedJsonArtifact({
    ...input,
    expectedMediaType: APPLICABLE_RULE_SET_MEDIA_TYPE_V1,
    purposeCode: APPLICABLE_RULE_SET_ARTIFACT_PURPOSE_CODE_V1,
    schema: ApplicableRuleSetDocumentV1Schema,
    digest: applicableRuleSetDocumentDigest,
  });
