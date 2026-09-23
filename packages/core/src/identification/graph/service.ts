/**
 * C24 识别子图核心纯函数（design D-03/D-10，IP-10/IP-11）：
 *
 * - `resolveIdentificationInputSnapshot`：把同一版本组合（准备快照 + 三个发布 + 策略集成员）
 *   冻结为一个 `IdentificationInputSnapshotV1`，缺项由 Schema 收口抛错，不写半快照；
 * - `buildIdentificationWorkPlan`：从准备快照与受治理工序事实形成覆盖全部适用工序的稳定
 *   排序工作计划，缺项整体阻断，不产生空项或部分计划；
 * - `classifyIdentificationGraphOutcome`：只按稳定 code、retryable 与 detailCode 分类到 C24
 *   自有错误码，不匹配完整文案，也不把技术失败改写为业务决定；
 * - `summarizeIdentificationRun`：只有全部计划内工作项与分组达到允许终态才形成 I9 汇总，
 *   待复核只表达为 waiting，不生成完成的空成功记录。
 *
 * 身份（输入快照/工作计划/工作项，以及知识准备等待的补足身份）一律由 `sha256CanonicalJson`
 * 从冻结输入确定性派生；墙钟、调用方正文与“最新版”都不参与。本文件不读数据库、不注入时钟、
 * 不复制领域算法。
 */
import type { VersionReference } from "@riskflow/contracts/common";
import {
  WaitingRefV1Schema,
  type AuditTrailRefV1,
  type AuthorizationContextRefV1,
  type DomainEventRefV1,
  type IdentificationGroupRefV1,
  type IdentificationInputSnapshotRefV1,
  type IdentificationPolicySetRefV1,
  type IdentificationPreparationSnapshotRefV1,
  type IdentificationWorkItemRefV1,
  type IdentificationWorkPlanRefV1,
  type ReviewTaskRefV1,
  type StandardizedRiskRecordRefV1,
  type WaitingRefV1,
  type WorkflowRunRefV1,
} from "@riskflow/contracts/ports";
import {
  IdentificationInputSnapshotV1Schema,
  type IdentificationInputSnapshotV1,
  type IdentificationPreparationSnapshotV1,
  type IdentificationStageV1,
} from "@riskflow/contracts/workflows";

import { sha256CanonicalJson } from "../../persistence/canonical-json.js";

import {
  IDENTIFICATION_GRAPH_SCHEMA_VERSION_V1,
  IdentificationGraphErrorV1Schema,
  IdentificationGraphExcludedWorkItemV1Schema,
  IdentificationGraphRunResultV1Schema,
  IdentificationGraphWorkItemV1Schema,
  IdentificationGraphWorkPlanBodyV1Schema,
  isRetryableIdentificationGraphError,
  type IdentificationGraphErrorCodeV1,
  type IdentificationGraphErrorV1,
  type IdentificationGraphExcludedWorkItemV1,
  type IdentificationGraphPolicySetV1,
  type IdentificationGraphRunResultV1,
  type IdentificationGraphWaitingV1,
  type IdentificationGraphWorkItemV1,
  type IdentificationGraphWorkPlanBodyV1,
} from "./schema.js";

/** I2 计划缺项时的稳定业务阻断原因码（spec「工作计划不完整时拒绝」）。 */
const WORK_PLAN_INVALID_REASON_CODE = "WORK_PLAN_INVALID";
/** 非适用工序节点进入 `excludedWorkItems` 的稳定原因码：工序模型已判定该节点不适用。 */
const NOT_APPLICABLE_REASON_CODE = "NOT_APPLICABLE";
/** I9 阻断原因码：计划内工作项尚无终态。 */
const BLOCKED_WORK_ITEM_OUTCOME_MISSING_REASON_CODE = "WORK_ITEM_OUTCOME_MISSING";
/** I9 阻断原因码：终态引用计划外、重复或计划为空，无法给出与计划一致的计数。 */
const BLOCKED_WORK_ITEM_OUTCOME_INCONSISTENT_REASON_CODE = "WORK_ITEM_OUTCOME_INCONSISTENT";
/** 检查点不一致的稳定 detailCode（D-07）：既有 checkpointer 与 C24 对账都使用该命名空间。 */
const CHECKPOINT_INCONSISTENT_DETAIL_CODE = "checkpoint-inconsistent";
const CHECKPOINT_DETAIL_CODE_PREFIX = "checkpointer.";

/** I2 从工序事实形成的冻结查询依据必须是已治理的稳定标识，不接受自由调用方正文。 */
export interface IdentificationGraphProcessNodeFactV1 {
  readonly nodeId: string;
  readonly applicable: boolean;
  readonly frozenQueryText: string;
}

export type IdentificationGraphWorkItemOutcomeV1 =
  | { readonly kind: "accepted"; readonly workItemRef: IdentificationWorkItemRefV1 }
  | { readonly kind: "skipped"; readonly workItemRef: IdentificationWorkItemRefV1 }
  | { readonly kind: "failed"; readonly workItemRef: IdentificationWorkItemRefV1 };

export type IdentificationGraphGroupOutcomeV1 =
  | { readonly kind: "accepted"; readonly groupRef: IdentificationGroupRefV1 }
  | { readonly kind: "rejected"; readonly groupRef: IdentificationGroupRefV1 }
  | { readonly kind: "returned-upstream"; readonly groupRef: IdentificationGroupRefV1 }
  | {
      readonly kind: "pending-review";
      readonly groupRef: IdentificationGroupRefV1;
      readonly reviewTaskRef: ReviewTaskRefV1;
    }
  | { readonly kind: "failed"; readonly groupRef: IdentificationGroupRefV1 };

/**
 * 输入快照身份（design D-03）：同一工程、准备快照与冻结发布组合只对应一个身份。
 * 只摘要参与冻结的引用，不含策略正文、当前时间或调用方正文。
 */
export const identificationInputSnapshotRefFor = (input: {
  readonly projectId: string;
  readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
  readonly policySetRef: IdentificationPolicySetRefV1;
  readonly processModelReleaseRef: VersionReference;
  readonly retrievalEvidenceBaseReleaseRef: VersionReference;
}): IdentificationInputSnapshotRefV1 => ({
  kind: "identification-input-snapshot",
  reference: {
    entityId: `identification-input-snapshot:${input.projectId}:${input.preparationSnapshotRef.reference.entityId}`,
    versionId: sha256CanonicalJson({
      projectId: input.projectId,
      preparationSnapshotRef: input.preparationSnapshotRef,
      policySetRef: input.policySetRef,
      processModelReleaseRef: input.processModelReleaseRef,
      retrievalEvidenceBaseReleaseRef: input.retrievalEvidenceBaseReleaseRef,
    }),
  },
});

/** 工作计划身份：同一输入快照只对应一个计划身份，版本由该输入快照引用决定。 */
export const identificationWorkPlanRefFor = (input: {
  readonly projectId: string;
  readonly inputSnapshotRef: IdentificationInputSnapshotRefV1;
}): IdentificationWorkPlanRefV1 => ({
  kind: "identification-work-plan",
  reference: {
    entityId: `identification-work-plan:${input.projectId}:${input.inputSnapshotRef.reference.entityId}`,
    versionId: sha256CanonicalJson({
      projectId: input.projectId,
      inputSnapshotRef: input.inputSnapshotRef,
    }),
  },
});

/** 工作项身份：一个计划内一个工序节点一个身份，版本随计划版本（及其输入快照版本）变化。 */
export const identificationWorkItemRefFor = (input: {
  readonly projectId: string;
  readonly workPlanRef: IdentificationWorkPlanRefV1;
  readonly nodeId: string;
}): IdentificationWorkItemRefV1 => ({
  kind: "identification-work-item",
  reference: {
    entityId: `identification-work-item:${input.projectId}:${input.workPlanRef.reference.entityId}:${input.nodeId}`,
    versionId: sha256CanonicalJson({
      projectId: input.projectId,
      workPlanRef: input.workPlanRef,
      nodeId: input.nodeId,
    }),
  },
});

/**
 * I1 冻结单一输入快照（design D-03，spec「合格准备形成单一输入和工作计划」）：只把传入的准备
 * 快照引用、策略集成员与三个精确发布引用组合成同一版本组合。加工、模型与提示引用全部取自
 * 传入策略集，不内建默认值；任何缺项或不兼容由 `IdentificationInputSnapshotV1Schema` 收口抛错，
 * 因此调用方拿不到半套输入快照。是否就绪（未生效、已停用、错工程）由 I1 上游解析与等待判定。
 */
export const resolveIdentificationInputSnapshot = (input: {
  readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
  readonly policySet: IdentificationGraphPolicySetV1;
  readonly processModelReleaseRef: VersionReference;
  readonly riskMechanismReleaseRef: VersionReference;
  readonly retrievalEvidenceBaseReleaseRef: VersionReference;
  readonly authorizationContextRef: AuthorizationContextRefV1;
  readonly auditTrailRef: AuditTrailRefV1;
  readonly createdBy: string;
  readonly createdAt: string;
}): IdentificationInputSnapshotV1 =>
  IdentificationInputSnapshotV1Schema.parse({
    schemaVersion: IDENTIFICATION_GRAPH_SCHEMA_VERSION_V1,
    preparationSnapshotRef: input.preparationSnapshotRef,
    processModelReleaseRef: {
      kind: "process-model-release",
      reference: input.processModelReleaseRef,
    },
    riskMechanismReleaseRef: {
      kind: "risk-mechanism-release",
      reference: input.riskMechanismReleaseRef,
    },
    retrievalEvidenceBaseReleaseRef: {
      kind: "retrieval-evidence-base-release",
      reference: input.retrievalEvidenceBaseReleaseRef,
    },
    identificationPolicySetRef: input.policySet.policySetRef,
    retrievalPolicyRef: input.policySet.retrievalPolicyRef,
    retrievalReviewAgentPolicyRef: input.policySet.retrievalReviewAgentPolicyRef,
    repairPolicyRef: input.policySet.repairPolicyRef,
    confidencePolicyRef: input.policySet.confidencePolicyRef,
    forcedReviewPolicyRef: input.policySet.forcedReviewPolicyRef,
    retryPolicyRef: input.policySet.retryPolicyRef,
    modelDeploymentRef: input.policySet.modelDeploymentRef,
    promptTemplateRef: input.policySet.promptTemplateRef,
    authorizationContextRef: input.authorizationContextRef,
    auditTrailRef: input.auditTrailRef,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  });

/**
 * I2 从精确工序模型形成覆盖全部适用工序的不可变工作计划（design D-03）。
 *
 * 一致性：`IdentificationPreparationSnapshotV1` 正文不自带自引用，因此“计划只能引用被冻结的
 * 准备快照”由两条可判定事实共同证明——传入的 `inputSnapshotRef` 必须能由 `inputSnapshot` 的
 * 冻结组合回推（即计划的准备快照就是输入快照冻结的那一份），且准备快照必须给出空间、资料版本
 * 与逐资料段集合。任一不成立即整体阻断，不产生空项、自由正文或部分计划。
 */
export const buildIdentificationWorkPlan = (input: {
  readonly projectId: string;
  readonly workPlanRef: IdentificationWorkPlanRefV1;
  readonly inputSnapshotRef: IdentificationInputSnapshotRefV1;
  readonly inputSnapshot: IdentificationInputSnapshotV1;
  readonly preparationSnapshot: IdentificationPreparationSnapshotV1;
  readonly applicableProcessNodes: readonly IdentificationGraphProcessNodeFactV1[];
}):
  | { readonly kind: "ready"; readonly body: IdentificationGraphWorkPlanBodyV1 }
  | { readonly kind: "invalid"; readonly reasonCode: string } => {
  const invalid = { kind: "invalid", reasonCode: WORK_PLAN_INVALID_REASON_CODE } as const;

  const expectedInputSnapshotRef = identificationInputSnapshotRefFor({
    projectId: input.projectId,
    preparationSnapshotRef: input.inputSnapshot.preparationSnapshotRef,
    policySetRef: input.inputSnapshot.identificationPolicySetRef,
    processModelReleaseRef: input.inputSnapshot.processModelReleaseRef.reference,
    retrievalEvidenceBaseReleaseRef: input.inputSnapshot.retrievalEvidenceBaseReleaseRef.reference,
  });
  if (
    expectedInputSnapshotRef.reference.entityId !== input.inputSnapshotRef.reference.entityId ||
    expectedInputSnapshotRef.reference.versionId !== input.inputSnapshotRef.reference.versionId
  ) {
    return invalid;
  }

  const { spatialScopeRefs, sourceVersionRefs, includedSourceSegmentSetRefs } =
    input.preparationSnapshot;
  if (
    spatialScopeRefs.length === 0 ||
    sourceVersionRefs.length === 0 ||
    includedSourceSegmentSetRefs.length === 0 ||
    // 每个资料版本必须固定其资料段集合，否则工作项的资料段范围不完整。
    includedSourceSegmentSetRefs.length !== sourceVersionRefs.length
  ) {
    return invalid;
  }

  const workItems: IdentificationGraphWorkItemV1[] = [];
  const excludedWorkItems: IdentificationGraphExcludedWorkItemV1[] = [];
  const seenNodeIds = new Set<string>();
  // 先按 nodeId 升序排列工序事实，再单趟形成两类列表，输出顺序即稳定排序（design D-03）。
  const orderedNodes = [...input.applicableProcessNodes].sort((left, right) => {
    const leftNodeId = left.nodeId.trim();
    const rightNodeId = right.nodeId.trim();
    return leftNodeId < rightNodeId ? -1 : leftNodeId > rightNodeId ? 1 : 0;
  });
  for (const fact of orderedNodes) {
    const nodeId = fact.nodeId.trim();
    // 空标识或同一节点出现两次会形成无效/同身份工作项，计划不再是一对一覆盖。
    if (nodeId.length === 0 || seenNodeIds.has(nodeId)) {
      return invalid;
    }
    seenNodeIds.add(nodeId);

    if (!fact.applicable) {
      excludedWorkItems.push(
        IdentificationGraphExcludedWorkItemV1Schema.parse({
          nodeId,
          reasonCode: NOT_APPLICABLE_REASON_CODE,
        }),
      );
      continue;
    }

    const frozenQueryText = fact.frozenQueryText.trim();
    if (frozenQueryText.length === 0) {
      return invalid;
    }
    workItems.push(
      IdentificationGraphWorkItemV1Schema.parse({
        schemaVersion: IDENTIFICATION_GRAPH_SCHEMA_VERSION_V1,
        workItemRef: identificationWorkItemRefFor({
          projectId: input.projectId,
          workPlanRef: input.workPlanRef,
          nodeId,
        }),
        nodeId,
        spatialScopeRefs,
        sourceVersionRefs,
        sourceSegmentSetRefs: includedSourceSegmentSetRefs,
        frozenQueryText,
      }),
    );
  }

  // 无适用工序不得形成空计划继续检索（spec「不以空工作项…继续检索」）。
  if (workItems.length === 0) {
    return invalid;
  }

  return {
    kind: "ready",
    body: IdentificationGraphWorkPlanBodyV1Schema.parse({
      schemaVersion: IDENTIFICATION_GRAPH_SCHEMA_VERSION_V1,
      projectId: input.projectId,
      workPlanRef: input.workPlanRef,
      inputSnapshotRef: input.inputSnapshotRef,
      inputSnapshot: input.inputSnapshot,
      workItems,
      excludedWorkItems,
    }),
  };
};

/**
 * 只按稳定 code（必要时结合 retryable 与 detailCode）分类到 C24 错误码（design D-10）。
 * 拒绝、退回与等待不会进入本函数；本函数也不把技术失败改写为业务决定。
 */
const identificationGraphErrorCodeFor = (input: {
  readonly stage: IdentificationStageV1;
  readonly upstream: { readonly code: string; readonly retryable: boolean };
  readonly detailCode: string;
}): IdentificationGraphErrorCodeV1 => {
  switch (input.upstream.code) {
    case "AUTHORIZATION_DENIED":
      return "AUTHORIZATION_DENIED";
    case "STALE_VERSION":
      return "VERSION_CONFLICT";
    case "IDEMPOTENCY_CONFLICT":
      return "IDEMPOTENCY_CONFLICT";
    case "BUSINESS_BLOCKED":
      // I2 的业务阻断只可能来自工作计划本身，其余阶段类型化阻断是上游等待。
      return input.stage === "I2" ? "WORK_PLAN_INVALID" : "UPSTREAM_WAITING";
    case "TRANSIENT_FAILURE":
      // 瞬态码被上游标记为不可重试时，失败已在上游封闭：C24 不得再声明可重试。
      return input.upstream.retryable ? "RETRYABLE_INFRASTRUCTURE_FAILURE" : "CONTRACT_INVALID";
    case "TERMINAL_FAILURE":
      // 只有检查点对账类 detailCode 才是不可重试的检查点不一致，其余终止失败收口为契约失败。
      return input.detailCode === CHECKPOINT_INCONSISTENT_DETAIL_CODE ||
        input.detailCode.startsWith(CHECKPOINT_DETAIL_CODE_PREFIX)
        ? "CHECKPOINT_INCONSISTENT"
        : "CONTRACT_INVALID";
    case "UNSUPPORTED_CONTRACT":
      return "CONTRACT_INVALID";
    case "ENTITY_NOT_FOUND":
      // I0/I1 的缺失是输入/知识未就绪，之后阶段读到无法证明的引用只能是契约失败。
      return input.stage === "I0" || input.stage === "I1" ? "INPUT_NOT_READY" : "CONTRACT_INVALID";
    default:
      return "CONTRACT_INVALID";
  }
};

/**
 * 上游公开端口结果的确定路由（design D-10）：输出 `code` 只由稳定 code/retryable/detailCode
 * 决定，`retryable` 与 `isRetryableIdentificationGraphError` 保持一致，因此重试路线只由冻结
 * 错误码表决定；权限、版本、契约、幂等冲突与检查点不一致都不可重试。
 */
export const classifyIdentificationGraphOutcome = (input: {
  readonly stage: IdentificationStageV1;
  readonly upstream: { readonly code: string; readonly retryable: boolean };
  readonly detailCode: string;
  readonly occurredAt: string;
}): IdentificationGraphErrorV1 => {
  const code = identificationGraphErrorCodeFor(input);
  return IdentificationGraphErrorV1Schema.parse({
    schemaVersion: IDENTIFICATION_GRAPH_SCHEMA_VERSION_V1,
    code,
    retryable: isRetryableIdentificationGraphError(code),
    stage: input.stage,
    detailCode: input.detailCode,
    occurredAt: input.occurredAt,
  });
};

const blockedOutcome = (
  reasonCode: string,
): { readonly kind: "blocked"; readonly reasonCode: string } => ({
  kind: "blocked",
  reasonCode,
});

/**
 * I9 运行汇总（design D-03/D-10，spec「I9 汇总明确区分每个工作项和分组终态」）：只有计划内每个
 * 工作项与每个分组都达到允许终态才生成完整运行结果。缺失终态、计划外/重复终态或空计划都阻断；
 * 存在待复核分组只返回 waiting 与复核任务引用，不生成完成结果、也不把待复核算作拒绝；拒绝与
 * 退回上游收进 `rejectedGroupRefs`，失败分组不并入拒绝（技术失败不得改写为业务决定）。
 */
export const summarizeIdentificationRun = (input: {
  readonly projectId: string;
  readonly runRef: WorkflowRunRefV1;
  readonly parentRiskFlowRunRef: WorkflowRunRefV1;
  readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
  readonly inputSnapshotRef: IdentificationInputSnapshotRefV1;
  readonly workPlanRef: IdentificationWorkPlanRefV1;
  readonly plannedWorkItemRefs: readonly IdentificationWorkItemRefV1[];
  readonly workItemOutcomes: readonly IdentificationGraphWorkItemOutcomeV1[];
  readonly groupOutcomes: readonly IdentificationGraphGroupOutcomeV1[];
  readonly acceptedRiskRecordRefs: readonly StandardizedRiskRecordRefV1[];
  readonly acceptedEventRefs: readonly DomainEventRefV1[];
  readonly auditTrailRef: AuditTrailRefV1;
  readonly recordedAt: string;
}):
  | { readonly kind: "ready"; readonly runResult: IdentificationGraphRunResultV1 }
  | { readonly kind: "waiting"; readonly pendingReviewTaskRefs: readonly ReviewTaskRefV1[] }
  | { readonly kind: "blocked"; readonly reasonCode: string } => {
  if (input.plannedWorkItemRefs.length === 0) {
    return blockedOutcome(BLOCKED_WORK_ITEM_OUTCOME_INCONSISTENT_REASON_CODE);
  }

  const plannedRefKeys = new Set(
    input.plannedWorkItemRefs.map((ref) => `${ref.reference.entityId}/${ref.reference.versionId}`),
  );
  const outcomeByRefKey = new Map<string, IdentificationGraphWorkItemOutcomeV1>();
  for (const outcome of input.workItemOutcomes) {
    const refKey = `${outcome.workItemRef.reference.entityId}/${outcome.workItemRef.reference.versionId}`;
    if (!plannedRefKeys.has(refKey) || outcomeByRefKey.has(refKey)) {
      return blockedOutcome(BLOCKED_WORK_ITEM_OUTCOME_INCONSISTENT_REASON_CODE);
    }
    outcomeByRefKey.set(refKey, outcome);
  }
  // 计划内存在无终态工作项时，运行既不完整也不确定，不得按待复核或完成汇报。
  if (outcomeByRefKey.size !== plannedRefKeys.size) {
    return blockedOutcome(BLOCKED_WORK_ITEM_OUTCOME_MISSING_REASON_CODE);
  }

  const skippedWorkItemRefs: IdentificationWorkItemRefV1[] = [];
  const failedWorkItemRefs: IdentificationWorkItemRefV1[] = [];
  for (const outcome of input.workItemOutcomes) {
    if (outcome.kind === "skipped") {
      skippedWorkItemRefs.push(outcome.workItemRef);
    } else if (outcome.kind === "failed") {
      failedWorkItemRefs.push(outcome.workItemRef);
    }
  }

  const rejectedGroupRefs: IdentificationGroupRefV1[] = [];
  const pendingReviewTaskRefs: ReviewTaskRefV1[] = [];
  for (const outcome of input.groupOutcomes) {
    switch (outcome.kind) {
      case "rejected":
      case "returned-upstream":
        rejectedGroupRefs.push(outcome.groupRef);
        break;
      case "pending-review":
        pendingReviewTaskRefs.push(outcome.reviewTaskRef);
        break;
      case "accepted":
      case "failed":
        break;
    }
  }
  if (pendingReviewTaskRefs.length > 0) {
    return { kind: "waiting", pendingReviewTaskRefs };
  }

  return {
    kind: "ready",
    runResult: IdentificationGraphRunResultV1Schema.parse({
      schemaVersion: IDENTIFICATION_GRAPH_SCHEMA_VERSION_V1,
      projectId: input.projectId,
      runRef: input.runRef,
      parentRiskFlowRunRef: input.parentRiskFlowRunRef,
      preparationSnapshotRef: input.preparationSnapshotRef,
      inputSnapshotRef: input.inputSnapshotRef,
      workPlanRef: input.workPlanRef,
      acceptedRiskRecordRefs: input.acceptedRiskRecordRefs,
      acceptedEventRefs: input.acceptedEventRefs,
      rejectedGroupRefs,
      pendingReviewTaskRefs: [],
      failedWorkItemRefs,
      skippedWorkItemRefs,
      auditTrailRef: input.auditTrailRef,
      recordedAt: input.recordedAt,
    }),
  };
};

/**
 * C24 自有等待判别联合到 C02 `WaitingRefV1` 的唯一投影（design D-05/D-10，契约 §4 三路映射）：
 *
 * - `knowledge-preparation` → `{kind:"knowledge-preparation"}`：C24 等待事实只有准备快照引用与
 *   原因码，没有可透传的 C15 任务引用，因此补足身份只能由该等待事实确定性派生（`versionId` 摘要
 *   同时覆盖可选 `groupVersionId`，保证同一等待重复投影得到同一引用）；
 * - `human-review` → `{kind:"review"}`：直接透传精确复核任务引用；
 * - `retrieval-review-agent` → `{kind:"agent-task"}`：直接透传精确 C08 任务引用，与
 *   `ResumeCauseV1` 的 `agent-task-completed` 成对，同一任务引用即可复原该等待。
 *
 * 等待事实 kind 不在上述三类时抛错，绝不改用其它等待类（例如把 Agent 等待投影成人工复核）。
 */
export const toWaitingRef = (input: {
  readonly waiting: IdentificationGraphWaitingV1;
  readonly groupVersionId?: string;
}): WaitingRefV1 => {
  switch (input.waiting.kind) {
    case "knowledge-preparation":
      return WaitingRefV1Schema.parse({
        kind: "knowledge-preparation",
        knowledgePreparationTaskRef: {
          kind: "knowledge-preparation-task",
          reference: {
            entityId: `knowledge-preparation-task:${input.waiting.preparationSnapshotRef.reference.entityId}`,
            versionId: sha256CanonicalJson({
              waiting: input.waiting,
              groupVersionId: input.groupVersionId ?? null,
            }),
          },
        },
      });
    case "human-review":
      return WaitingRefV1Schema.parse({
        kind: "review",
        reviewTaskRef: input.waiting.reviewTaskRef,
      });
    case "retrieval-review-agent":
      return WaitingRefV1Schema.parse({
        kind: "agent-task",
        agentTaskRef: input.waiting.agentTaskRef,
      });
    default:
      throw new TypeError("unsupported identification graph waiting fact kind");
  }
};
