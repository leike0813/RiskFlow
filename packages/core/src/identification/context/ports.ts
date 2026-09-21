import type { VersionReference } from "@riskflow/contracts/common";
import type {
  AgentTaskRefV1,
  AgentTaskResultRefV1,
  AuthorizationContextV1,
  KnowledgeModelingPortV1,
  KnowledgeQueryResultRefV1,
  KnowledgeRetrievalQueryV1,
  KnowledgeRetrievalResultV1,
  SpatialScopeRefV1,
  SourceVersionRefV1,
} from "@riskflow/contracts/ports";
import type { IdentificationInputSnapshotV1 } from "@riskflow/contracts/workflows";

import type {
  AgentDomainToolExecutionContextV1,
  AgentDomainToolResultV1,
  AgentTaskSnapshotV1,
  AgentValidationItemV1,
} from "../../agent-runtime/index.js";
import type { ArtifactRefV1, ArtifactStoreV1 } from "../../artifacts/index.js";
import type { IdentificationKnowledgeReleaseReaderV1 } from "../../identification-knowledge/index.js";
import type { TransactionUnitV1 } from "../../persistence/index.js";
import type { RetrievalGenerationStoreV1 } from "../../retrieval/ports.js";
import type {
  HybridRetrievalPolicyV1,
  HybridRetrievalResultPayloadV1,
} from "../../retrieval/schema.js";

import type { IdentificationContextResultRowV1, RetrievalReviewPolicyV1 } from "./schema.js";

/** 组合根与核心服务共用的最窄输入引用对（与 C02 公共分支同形）。 */
export interface IdentificationContextInputRefsV1 {
  readonly inputSnapshotRef: {
    readonly kind: "identification-input-snapshot";
    readonly reference: VersionReference;
  };
  readonly workItemRef: {
    readonly kind: "identification-work-item";
    readonly reference: VersionReference;
  };
}

export interface IdentificationContextWorkItemV1 {
  readonly workItemRef: IdentificationContextInputRefsV1["workItemRef"];
  readonly nodeId: string;
  /** 工作项授权范围：读取只能落在该空间与资料范围内。 */
  readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
  readonly sourceVersionRefs: readonly SourceVersionRefV1[];
  /** 工作项冻结查询文本；基线与补搜文本都从它派生，不接受调用方自由正文。 */
  readonly frozenQueryText: string;
}

export interface IdentificationContextExactInputV1 {
  readonly inputSnapshot: IdentificationInputSnapshotV1;
  readonly workItem: IdentificationContextWorkItemV1;
}

/**
 * C21 最窄输入端口（design D-02）：由 C24 冻结输入生产者实现，返回同工程精确输入快照、
 * 工作项所属工序节点、工作项授权范围与冻结查询文本。C21 不提供生产回退实现。
 */
export interface IdentificationContextInputReaderV1 {
  readExact(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly queryId: string;
    readonly inputSnapshotRef: IdentificationContextInputRefsV1["inputSnapshotRef"];
    readonly workItemRef: IdentificationContextInputRefsV1["workItemRef"];
    readonly authorization: AuthorizationContextV1;
  }): Promise<
    | { readonly kind: "succeeded"; readonly read: IdentificationContextExactInputV1 }
    | {
        readonly kind: "failed";
        readonly code: "AUTHORIZATION_DENIED" | "POLICY_NOT_FOUND" | "IDENTIFICATION_INPUT_DRIFT";
        readonly detailCode: string;
      }
  >;
}

/**
 * C06 授权接缝：按同一 actor/工程/精确调用身份签发收窄读分支上下文，并按调用身份复验当前授权。
 * C21 不自行构造 `AuthorizationContextV1`，也不扩大原资料范围。
 */
export interface IdentificationContextAuthorizationPortV1 {
  /** 为 C17 精确发布读签发 `knowledge-modeling.identification-basis` 上下文。 */
  issueReadContext(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly invocationId: string;
    readonly requestedAt: string;
    readonly requestedSpatialScopeRefs: readonly SpatialScopeRefV1[];
    readonly requestedSourceVersionRefs: readonly SourceVersionRefV1[];
  }): Promise<AuthorizationContextV1>;
  /** 当前授权复验；撤销或范围不符时返回 `undefined`，调用方按同形拒绝收口。 */
  verifyCurrent(input: {
    readonly authorization: AuthorizationContextV1;
    readonly invocationId: string;
    readonly branch: "knowledge-modeling.relationship-context";
    readonly requestedSpatialScopeRefs: readonly SpatialScopeRefV1[];
    readonly requestedSourceVersionRefs: readonly SourceVersionRefV1[];
  }): Promise<AuthorizationContextV1 | undefined>;
}

/** C21 结果登记端口（D-03）：正文只入 C04，本端口只登记与回读引用行。 */
export interface IdentificationContextResultStoreV1 {
  registerResult(
    input: {
      readonly row: IdentificationContextResultRowV1;
      readonly occurredAt: string;
    },
    context?: unknown,
  ): Promise<
    | { readonly kind: "registered"; readonly replayed: boolean }
    | { readonly kind: "idempotency-conflict" }
  >;
  readResult(input: {
    readonly projectId: string;
    readonly resultKind: IdentificationContextResultRowV1["resultKind"];
    readonly resultId: string;
  }): Promise<IdentificationContextResultRowV1 | undefined>;
  readRelationshipResult(input: {
    readonly projectId: string;
    readonly queryId: string;
  }): Promise<
    Extract<IdentificationContextResultRowV1, { readonly resultKind: "relationship" }> | undefined
  >;
}

/** C20 正式混合结果读取端口（D-05）：按精确查询身份回读已登记结果与受保护正文。 */
export interface OfficialHybridResultReaderV1 {
  readOfficial(input: {
    readonly projectId: string;
    readonly queryId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<
    | { readonly kind: "succeeded"; readonly result: OfficialHybridResultV1 }
    | {
        readonly kind: "failed";
        readonly code: "AUTHORIZATION_DENIED" | "ENTITY_NOT_FOUND" | "SOURCE_FACT_DRIFT";
        readonly detailCode: string;
      }
  >;
}

export interface OfficialHybridResultV1 {
  readonly requestDigest: string;
  readonly knowledgeQueryResultRef: KnowledgeQueryResultRefV1;
  readonly resultArtifactRef: ArtifactRefV1;
  readonly payload: HybridRetrievalResultPayloadV1;
}

/** C20 检索策略精确解析（同一策略引用在基线与补搜之间不得更换）。 */
export interface HybridRetrievalPolicyReaderV1 {
  resolveExact(input: {
    readonly projectId: string;
    readonly policyRef: VersionReference;
  }): Promise<HybridRetrievalPolicyV1 | undefined>;
}

/** C08 任务快照窄读：只读终态与已成立结果引用，不读候选正文。 */
export interface AgentTaskSnapshotReaderV1 {
  getTask(taskRef: AgentTaskRefV1): Promise<AgentTaskSnapshotV1 | undefined>;
}

/** 审阅任务端口：C21 核心服务实现它；定义只经类型化动作暴露两项有界工具与确定性收口。 */
export interface RetrievalReviewTaskPortV1 {
  readFrozenResult(
    input: unknown,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1>;
  boundedHybridResupplement(
    input: unknown,
    context: AgentDomainToolExecutionContextV1,
  ): Promise<AgentDomainToolResultV1>;
  validateReviewIncrement(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: unknown;
  }): Promise<RetrievalReviewValidationOutcomeV1>;
  finalizeRetrievalReview(input: {
    readonly task: AgentTaskSnapshotV1;
    readonly candidate: unknown;
  }): Promise<AgentTaskResultRefV1>;
}

export interface RetrievalReviewValidationOutcomeV1 {
  readonly items: readonly AgentValidationItemV1[];
  readonly disposition: "accepted" | "rejected";
  readonly rejectionClass?: "repairable" | "terminal";
  readonly validationArtifactRef: ArtifactRefV1;
}

/** 由组合根注入的 C21 服务依赖；任一必需项缺失时构造失败，不产生部分组合。 */
export interface IdentificationContextServiceOptionsV1 {
  readonly inputReader: IdentificationContextInputReaderV1;
  readonly authorization: IdentificationContextAuthorizationPortV1;
  readonly resultStore: IdentificationContextResultStoreV1;
  readonly officialHybrid: OfficialHybridResultReaderV1;
  /** C20 正式检索服务：基线与每次补搜都走同一 `retrieve` 分支。 */
  readonly retrievalService: Pick<KnowledgeModelingPortV1, "retrieve">;
  readonly knowledgeReader: IdentificationKnowledgeReleaseReaderV1;
  readonly hybridPolicy: HybridRetrievalPolicyReaderV1;
  readonly taskReader: AgentTaskSnapshotReaderV1;
  readonly artifactStore: ArtifactStoreV1;
  readonly transactionUnit: TransactionUnitV1;
  readonly reviewPolicy: RetrievalReviewPolicyV1;
  readonly now?: () => Date;
}

export type IdentificationContextQueryV1 = Extract<
  KnowledgeRetrievalQueryV1,
  { readonly kind: "relationship-context" }
>;
export type IdentificationContextQueryResultV1 = KnowledgeRetrievalResultV1;
export type { RetrievalGenerationStoreV1 };
