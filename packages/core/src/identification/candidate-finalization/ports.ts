import type {
  AuthorizationContextV1,
  IdentificationCandidateSetRefV1,
  IdentificationGroupRefV1,
  IdentificationInputSnapshotRefV1,
  IdentificationPolicySetRefV1,
  IdentificationWorkItemRefV1,
  IdentificationWorkPlanRefV1,
  ModuleBranchV1,
  ModuleErrorV1,
  ReviewAuditPortV1,
  ReviewDecisionRefV1,
  ReviewTaskRefV1,
  SpatialScopeRefV1,
  ValidatedCandidateSetRefV1,
  SourceVersionRefV1,
} from "@riskflow/contracts/ports";
import type {
  ModelOutputResult,
  StandardizedRiskRecordEnvelope,
} from "@riskflow/contracts/records";
import type { IdentificationInputSnapshotV1 } from "@riskflow/contracts/workflows";
import type { VersionReference } from "@riskflow/contracts/common";

import type { ArtifactRefV1, ArtifactStoreV1 } from "../../artifacts/index.js";
import type { ModelContextPayloadV1 } from "../context/schema.js";
import type { TransactionUnitV1 } from "../../persistence/index.js";
import type {
  CompositeConfidencePolicyV1,
  ForcedReviewPolicyV1,
  IdentificationGroupDecisionKindV1,
  RiskCandidateFinalizationResultRowV1,
  RiskCandidateGenerationBudgetV1,
  RiskCandidateGenerationPolicyV1,
  RiskCandidateMergePolicyV1,
  RiskCandidateValidationPolicyV1,
  RiskCandidateV1,
  StandardizedRiskRecordWriteV1,
} from "./schema.js";

type IdentificationReviewRevisableFieldsV1 = Omit<ModelOutputResult, "modelConfidence">;

export type IdentificationReviewRevisionFieldsV1 = {
  readonly [Field in keyof IdentificationReviewRevisableFieldsV1]?:
    IdentificationReviewRevisableFieldsV1[Field] | undefined;
};

/** 组合根与核心服务共用的最窄工作项读取结果（与 C02 公共分支同形）。 */
export interface IdentificationWorkPlanWorkItemV1 {
  readonly workItemRef: IdentificationWorkItemRefV1;
  readonly nodeId: string;
  readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
  readonly sourceVersionRefs: readonly SourceVersionRefV1[];
}

/**
 * C24 冻结识别工作计划（design D-03）：给出本次识别运行的精确输入快照、全部工作项，
 * 以及本运行应当收集的已校验候选集合。C22 不提供生产回退实现，缺失时组合根拒绝构造。
 */
export interface IdentificationWorkPlanExactV1 {
  readonly workPlanRef: IdentificationWorkPlanRefV1;
  readonly inputSnapshotRef: IdentificationInputSnapshotRefV1;
  readonly inputSnapshot: IdentificationInputSnapshotV1;
  readonly workItems: readonly IdentificationWorkPlanWorkItemV1[];
  readonly validatedCandidateSetRefs: readonly ValidatedCandidateSetRefV1[];
}

export interface IdentificationWorkPlanReaderV1 {
  readExact(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly workPlanRef: IdentificationWorkPlanRefV1;
    readonly authorization: AuthorizationContextV1;
  }): Promise<
    | { readonly kind: "succeeded"; readonly read: IdentificationWorkPlanExactV1 }
    | {
        readonly kind: "failed";
        readonly code:
          "AUTHORIZATION_DENIED" | "ENTITY_NOT_FOUND" | "IDENTIFICATION_WORK_PLAN_DRIFT";
        readonly detailCode: string;
      }
  >;
}

/**
 * C21 五项上下文精确窄读（design D-03）：先按 `model-context` 登记回读引用行，再经 C04
 * 读取并解析实际正文；返回前复核工程、输入、工作项、上下文引用、授权摘要与五项内容。
 */
export interface ModelContextReaderV1 {
  readExact(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly workItemRef: IdentificationWorkItemRefV1;
    readonly retrievalArtifactSetRef: { readonly reference: VersionReference };
    readonly authorization: AuthorizationContextV1;
  }): Promise<
    | {
        readonly kind: "succeeded";
        readonly read: {
          readonly payload: ModelContextPayloadV1;
          readonly payloadDigest: string;
          readonly modelContextArtifactSetRef: {
            readonly kind: "model-context-artifact-set";
            readonly reference: VersionReference;
          };
          readonly authorizationScopeDigest: string;
          readonly authorizationContextRef: AuthorizationContextV1["authorizationContextRef"];
        };
      }
    | {
        readonly kind: "failed";
        readonly code: "AUTHORIZATION_DENIED" | "ENTITY_NOT_FOUND" | "SOURCE_FACT_DRIFT";
        readonly detailCode: string;
      }
  >;
}

/**
 * C22 策略精确解析（design D-03）：按命令引用的精确版本读取生成/校验/合并/置信度/强制复核
 * 策略，并校验其属于输入快照冻结的策略集。不提供默认策略，不提供 latest 回退。
 */
export interface RiskCandidatePolicyProviderV1 {
  resolveGeneration(input: {
    readonly projectId: string;
    readonly inputSnapshotRef: IdentificationInputSnapshotRefV1;
    readonly policySetRef: IdentificationPolicySetRefV1;
    readonly modelDeploymentRef: VersionReference;
    readonly promptTemplateRef: VersionReference;
  }): Promise<RiskCandidateGenerationPolicyV1 | undefined>;
  resolveValidation(input: {
    readonly projectId: string;
    readonly inputSnapshotRef: IdentificationInputSnapshotRefV1;
    readonly policySetRef: IdentificationPolicySetRefV1;
    readonly repairPolicyRef: VersionReference;
  }): Promise<RiskCandidateValidationPolicyV1 | undefined>;
  resolveMerge(input: {
    readonly projectId: string;
    readonly inputSnapshotRef: IdentificationInputSnapshotRefV1;
    readonly policySetRef: IdentificationPolicySetRefV1;
    readonly mergePolicyRef: VersionReference;
  }): Promise<RiskCandidateMergePolicyV1 | undefined>;
  resolveConfidence(input: {
    readonly projectId: string;
    readonly inputSnapshotRef: IdentificationInputSnapshotRefV1;
    readonly policySetRef: IdentificationPolicySetRefV1;
    readonly confidencePolicyRef: VersionReference;
  }): Promise<CompositeConfidencePolicyV1 | undefined>;
  resolveForcedReview(input: {
    readonly projectId: string;
    readonly inputSnapshotRef: IdentificationInputSnapshotRefV1;
    readonly policySetRef: IdentificationPolicySetRefV1;
    readonly forcedReviewPolicyRef: VersionReference;
  }): Promise<ForcedReviewPolicyV1 | undefined>;
}

/**
 * C05 授权接缝：按同一 actor/工程/精确调用身份签发收窄读分支上下文，并按调用身份复验当前
 * 授权。C22 不自行构造 `AuthorizationContextV1`，也不扩大原空间与资料范围。
 */
export interface RiskCandidateFinalizationAuthorizationPortV1 {
  issueBranchContext(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly invocationId: string;
    readonly requestedAt: string;
    readonly branch: ModuleBranchV1;
    readonly parentAuthorization: AuthorizationContextV1;
    readonly requestedSpatialScopeRefs: readonly SpatialScopeRefV1[];
    readonly requestedSourceVersionRefs: readonly SourceVersionRefV1[];
  }): Promise<AuthorizationContextV1>;
  verifyCurrent(input: {
    readonly authorization: AuthorizationContextV1;
    readonly invocationId: string;
    readonly branch: ModuleBranchV1;
    readonly requestedSpatialScopeRefs: readonly SpatialScopeRefV1[];
    readonly requestedSourceVersionRefs: readonly SourceVersionRefV1[];
  }): Promise<AuthorizationContextV1 | undefined>;
}

/** D-09 追加式中间登记端口：正文只在 C04，本端口只登记与回读引用行。 */
export interface RiskCandidateFinalizationResultStoreV1 {
  registerResults(
    input: {
      readonly rows: readonly RiskCandidateFinalizationResultRowV1[];
      readonly occurredAt: string;
    },
    context?: unknown,
  ): Promise<
    | { readonly kind: "registered"; readonly replayed: boolean }
    | { readonly kind: "idempotency-conflict" }
  >;
  readResult(input: {
    readonly projectId: string;
    readonly resultKind: RiskCandidateFinalizationResultRowV1["resultKind"];
    readonly resultId: string;
    readonly resultVersionId: string;
  }): Promise<RiskCandidateFinalizationResultRowV1 | undefined>;
}

/** 正式标准化风险记录写入端口（design D-09/D-10）：只在调用方 ambient 事务内写入。 */
export interface StandardizedRiskRecordStoreV1 {
  insertRecords(
    input: {
      readonly rows: readonly StandardizedRiskRecordWriteV1[];
      readonly records: readonly StandardizedRiskRecordEnvelope[];
      readonly occurredAt: string;
    },
    context?: unknown,
  ): Promise<
    | { readonly kind: "inserted" }
    | { readonly kind: "replayed" }
    | { readonly kind: "conflict"; readonly detailCode: string }
  >;
  readRecord(input: { readonly projectId: string; readonly riskRecordId: string }): Promise<
    | {
        readonly riskRecordId: string;
        readonly versionId: string;
        readonly requestDigest: string;
      }
    | undefined
  >;
}

/** C07 人工决定窄读（design D-08）：只返回闭合结果，不返回自由正文。 */
export type IdentificationGroupDecisionReadV1 =
  | {
      readonly kind: "decided";
      readonly decisionKind: IdentificationGroupDecisionKindV1;
      readonly reviewDecisionRef: ReviewDecisionRefV1;
      readonly revisedCandidateSetRef?: IdentificationCandidateSetRefV1;
      readonly decidedAt: string;
    }
  | { readonly kind: "pending" }
  | { readonly kind: "blocked"; readonly detailCode: string };

export interface IdentificationReviewDecisionReaderV1 {
  readIdentificationGroupDecision(input: {
    readonly projectId: string;
    readonly groupRef: IdentificationGroupRefV1;
    readonly reviewTaskRef: ReviewTaskRefV1;
    readonly authorization: AuthorizationContextV1;
    readonly invocationId: string;
    readonly requestedAt: string;
  }): Promise<IdentificationGroupDecisionReadV1>;
}

// ------------------------------------------------------------ RI-S57 模型运行

/** 有界修正反馈：只携带结构化错误码与父版本引用，不含模型自由正文。 */
export interface RiskCandidateRepairFeedbackV1 {
  readonly attempt: number;
  readonly parentCandidates: readonly RiskCandidateV1[];
  readonly failures: readonly {
    readonly candidateId: string;
    readonly candidateVersion: number;
    readonly checkId: string;
    readonly reasonCode: string;
  }[];
  readonly previousRawResponseRefs: readonly ArtifactRefV1[];
}

export interface RiskCandidateModelRequestV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly invocationId: string;
  readonly requestedAt: string;
  readonly deadlineAt: string;
  readonly modelContext: ModelContextPayloadV1;
  readonly modelDeploymentRef: VersionReference;
  readonly promptTemplateRef: VersionReference;
  readonly outputSchemaRef: VersionReference;
  readonly budgetPolicyRef: VersionReference;
  readonly budget: RiskCandidateGenerationBudgetV1;
  readonly maxOutputTokens: number;
  readonly authorization: AuthorizationContextV1;
  readonly repair?: RiskCandidateRepairFeedbackV1;
}

export interface RiskCandidateModelUsageV1 {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly outputBytes: number;
}

export type RiskCandidateModelOutcomeV1 =
  | {
      readonly kind: "succeeded";
      readonly outputs: readonly ModelOutputResult[];
      readonly invocationId: string;
      readonly rawResponseRef: ArtifactRefV1;
      readonly usage: RiskCandidateModelUsageV1;
      readonly elapsedMs: number;
    }
  | { readonly kind: "failed"; readonly error: ModuleErrorV1 };

export interface RiskCandidateEmbeddingRequestV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly invocationId: string;
  readonly requestedAt: string;
  readonly deadlineAt: string;
  readonly projectWorkPlanEntityId: string;
  readonly embeddingDeploymentRef: VersionReference;
  readonly budgetPolicyRef: VersionReference;
  readonly texts: readonly string[];
  readonly authorization: AuthorizationContextV1;
}

/**
 * RI-S57 专用模型节点（design D-04）：直接使用 C10 结构化补全与嵌入，不注册 C08 任务类型，
 * 不让同一模型以审阅 Agent 复审自己的结果。原始响应与向量工件由运行时通过 C04 保存。
 */
export interface RiskCandidateModelPortV1 {
  generateCandidates(input: RiskCandidateModelRequestV1): Promise<RiskCandidateModelOutcomeV1>;
  embedRiskEvents(input: RiskCandidateEmbeddingRequestV1): Promise<
    | {
        readonly kind: "succeeded";
        readonly vectors: readonly (readonly number[])[];
        readonly dimensions: number;
        readonly embeddingArtifactRef: ArtifactRefV1;
        readonly deploymentRef: VersionReference;
        readonly rawResponseRef: ArtifactRefV1;
      }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  >;
}

// ------------------------------------------------------------ C23 人工修订窄端口

/**
 * C23 人工修订窄端口输入（design D-03/D-04/D-08）：只携带精确来源引用、允许字段修订与调用者
 * 提交的 `review-audit.decide-review` 授权。命令身份用于派生稳定内部登记身份，不成为公共契约。
 */
export interface IdentificationReviewRevisionRequestV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
  readonly invocationId: string;
  readonly authorization: AuthorizationContextV1;
  readonly groupRef: IdentificationGroupRefV1;
  readonly validationSnapshotRef: { readonly kind: "validation-snapshot" } & {
    readonly reference: VersionReference;
  };
  readonly evidenceSnapshotRef: { readonly kind: "evidence-snapshot" } & {
    readonly reference: VersionReference;
  };
  readonly sourceCandidateSetRef: IdentificationCandidateSetRefV1;
  readonly sourceValidatedCandidateSetRef: ValidatedCandidateSetRefV1;
  readonly candidateRef: { readonly kind: "content-artifact" } & {
    readonly reference: VersionReference;
  };
  readonly changes: IdentificationReviewRevisionFieldsV1;
}

/**
 * 修订窄端口的闭合结果（design D-09）：调用方按 `kind` 映射公共错误，不匹配完整文案。
 * - `revised`：后继候选集与已校验候选集已成立，可提交 `approve-revised-candidate`。
 * - `unauthorized`：当前 `review-audit.decide-review` 授权不成立。
 * - `stale`：来源任务/分组/候选/快照事实不是当前版本。
 * - `blocked`：修订本身未通过确定性校验或冻结范围约束。
 * - `conflict`：同一幂等身份已存在不同的修订载荷。
 * - `failed`：技术失败，未产生可消费引用。
 */
export type IdentificationReviewRevisionOutcomeV1 =
  | {
      readonly kind: "revised";
      readonly revisedCandidateSetRef: IdentificationCandidateSetRefV1;
      readonly validatedCandidateSetRef: ValidatedCandidateSetRefV1;
    }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "stale"; readonly detailCode: string }
  | { readonly kind: "blocked"; readonly detailCode: string }
  | { readonly kind: "conflict"; readonly priorCommandId: string }
  | { readonly kind: "failed"; readonly detailCode: string };

/**
 * C23 人工修订接缝（design D-03）：由 `RiskCandidateFinalizationService` 在同一模块内实现，
 * 不进入公共 `RiskIdentificationPortV1`，也不让 C23 复制 C22 的工件、身份与登记规则。
 */
export interface IdentificationReviewRevisionPortV1 {
  prepareReviewRevision(
    input: IdentificationReviewRevisionRequestV1,
  ): Promise<IdentificationReviewRevisionOutcomeV1>;
}

/** 由组合根注入的 C22 服务依赖；任一必需项缺失时构造失败，不产生部分组合。 */
export interface RiskCandidateFinalizationServiceOptionsV1 {
  readonly modelContextReader: ModelContextReaderV1;
  readonly workPlanReader: IdentificationWorkPlanReaderV1;
  readonly policyProvider: RiskCandidatePolicyProviderV1;
  readonly reviewDecisionReader: IdentificationReviewDecisionReaderV1;
  readonly authorization: RiskCandidateFinalizationAuthorizationPortV1;
  readonly resultStore: RiskCandidateFinalizationResultStoreV1;
  readonly recordStore: StandardizedRiskRecordStoreV1;
  readonly model: RiskCandidateModelPortV1;
  readonly artifactStore: ArtifactStoreV1;
  readonly transactionUnit: TransactionUnitV1;
  /** C07 复核请求与 C07 决定读取共用的既有公共分支，不新增任务表或事件。 */
  readonly review: Pick<ReviewAuditPortV1, "requestReview">;
  readonly now?: () => Date;
}
