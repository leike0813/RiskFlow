/**
 * 合成样本、待甲方复核：本文件全部工程、参与者、命令身份、摘要与工件正文均为合成夹具，
 * 不代表生产数据，也不得作为生产回退来源。
 *
 * C24 识别子图行为夹具：真实 Testcontainers PostgreSQL + 完整生产迁移链 + 真实 C03 事务单元 /
 * C04 文件系统工件存储 / 真实 LangGraph PostgreSQL checkpointer + C24 生产适配器。
 * 只有**公开端口**（C17 基础解析、C21 上下文、C22 分析收口、C23 任务、策略目录）用可控替身注入，
 * 替身只返回闭合结果，不读任何私表、不复制领域算法。
 *
 * 用例通过 `world` 上的开关控制端口行为，并用 `world.calls` 断言“图只按冻结引用调用公开端口”。
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { VersionReference } from "@riskflow/contracts/common";
import {
  ModuleErrorV1Schema,
  type AgentTaskRefV1,
  type IdentificationAnalysisCommandV1,
  type IdentificationFinalizationCommandV1,
  type AuthorizationContextV1,
  type DomainEventRefV1,
  type IdentificationCandidateSetRefV1,
  type ReviewDecisionRefV1,
  type ReviewTaskRefV1,
  type StandardizedRiskRecordRefV1,
  type ValidatedCandidateSetRefV1,
  type WorkflowRunRefV1,
} from "@riskflow/contracts/ports";
import { IdentificationPreparationSnapshotV1Schema } from "@riskflow/contracts/workflows";
import type { IdentificationPreparationSnapshotV1 } from "@riskflow/contracts/workflows";

import { AccessServiceError, type LocalIdentityAccessV1 } from "@riskflow/core/access";
import {
  AgentBudgetLedgerV1Schema,
  AgentStructuredErrorV1Schema,
  AgentTaskBudgetPolicyV1Schema,
  AgentTaskEnvelopeV1Schema,
  AgentTaskStateV1Schema,
  emptyAgentBudgetUsage,
  type AgentInternalStatusV1,
  type AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import {
  ArtifactReadRequestV1Schema,
  type ArtifactRefV1,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import {
  AcceptanceRouteV1Schema,
  type AcceptanceRouteV1,
  type IdentificationGroupDecisionKindV1,
  type RiskCandidateFinalizationService,
} from "@riskflow/core/identification/candidate-finalization";
import {
  IdentificationGraphPolicySetV1Schema,
  identificationInputSnapshotRefFor,
  identificationWorkItemRefFor,
  identificationWorkPlanRefFor,
  type IdentificationGraphPolicySetV1,
  type IdentificationGraphResultRowV1,
  type IdentificationGraphRunStateV1,
} from "@riskflow/core/identification/graph";
import {
  IdentificationKnowledgePackageV1Schema,
  type IdentificationKnowledgeExactReadV1,
  type IdentificationKnowledgePackageV1,
  type IdentificationKnowledgeReleaseReaderV1,
  type IdentificationPreparationKnowledgeReaderV1,
} from "@riskflow/core/identification-knowledge";
import { sha256CanonicalJson } from "@riskflow/core/persistence";

import { artifactPolicy } from "../../../../../packages/adapters/test/artifacts/fixture.js";
import {
  startPostgresFixture,
  type PostgresTestFixture,
} from "../../../../../packages/adapters/test/postgres/fixture.js";
import {
  PostgresTransactionUnit,
  PostgresArtifactRegistry,
  createPostgresIdentificationGraphAdapter,
  createFilesystemArtifactStore,
  createPostgresRuntime,
  runPostgresMigrations,
  setupPostgresCheckpointer,
  type PostgresCheckpointer,
  type PostgresIdentificationGraphAdapterV1,
  type PostgresRuntime,
} from "../../../../../packages/adapters/test/identification/graph/wiring.js";

import { retrievalReviewTaskRefFor } from "../../../src/identification/graph/graph.js";
import {
  type IdentificationGraphCancelCommandV1,
  type IdentificationGraphResumeCommandV1,
  type IdentificationGraphRuntimeV1,
  type IdentificationGraphStartCommandV1,
} from "@riskflow/core/identification/graph";
import {
  createIdentificationGraph,
  createIdentificationGraphRuntime,
  identificationRunIdentityFor,
  type IdentificationGraphAuthorizationPortV1,
  type IdentificationGraphPortsV1,
  type IdentificationGraphRunnerV1,
} from "../../../src/identification/graph/index.js";

export const SYNTHETIC_SAMPLE_NOTICE = "合成样本、待甲方复核";
export const PROJECT_ID = "project-c24-graph";
export const ACTOR_ID = "actor-c24-graph";
export const TIMESTAMP = "2030-01-01T00:00:00.000Z";
/** 两个适用工序节点；`nodeIdOf` 依赖“身份最后一段是 nodeId”的稳定约定。 */
export const NODE_CURRENT = "node-current";
export const NODE_NEIGHBOR = "node-neighbor";
export const NODE_EXCLUDED = "node-force";

const digest = (seed: string): string => createHash("sha256").update(seed).digest("hex");

export const versionRef = (entityId: string, versionId = "v1"): VersionReference => ({
  entityId,
  versionId,
});

/** 带判别种类的精确引用；`as const` 让字面量种类直接参与赋值检查，不做类型断言。 */
const refOf = <const K extends string>(kind: K, entityId: string, versionId = "v1") =>
  ({ kind, reference: { entityId, versionId } }) as const;

export const PREPARATION_SNAPSHOT_REF = refOf(
  "identification-preparation-snapshot",
  `identification-preparation-snapshot:${PROJECT_ID}`,
  digest("preparation-snapshot-v1"),
);
export const PARENT_RUN_REF = refOf(
  "workflow-run",
  `risk-flow-run:${PROJECT_ID}`,
  digest("parent-v1"),
);
export const GRAPH_VERSION = versionRef("identification-graph", "1");
export const AUDIT_TRAIL_REF = refOf("audit-trail", `audit-trail:${PROJECT_ID}`);
export const AUTHORIZATION_CONTEXT_REF = refOf(
  "authorization-context",
  `authorization-context:${PROJECT_ID}`,
  digest("authorization-context-v1"),
);
const SPATIAL_SCOPE_REFS = [refOf("spatial-scope", "spatial-scope-c24")];
const SOURCE_ACCESS_GRANT_REFS = [refOf("source-access-grant", "source-access-grant-c24")];
const SOURCE_VERSION_REF = refOf("source-version", "source-version-c24");
const SOURCE_SEGMENT_SET_REF = refOf("source-segment-set", "source-segment-set-c24");
export const PROCESS_MODEL_RELEASE_REF = refOf("process-model-release", "process-model-c24");
export const RISK_MECHANISM_RELEASE_REF = refOf("risk-mechanism-release", "risk-mechanism-c24");
const EVIDENCE_BASE_RELEASE_REF = refOf("retrieval-evidence-base-release", "evidence-base-c24");
const POLICY_SET_REF = refOf("identification-policy-set", "policy-set-c24", digest("policy-v1"));
const REVIEW_POLICY_REF = versionRef("retrieval-review-policy", digest("review-policy-v1"));
const MODEL_DEPLOYMENT_REF = versionRef("model-deployment");
const PROMPT_TEMPLATE_REF = versionRef("prompt-template");

/** 唯一 capability：C24 只复用 `risk-identification.run`（design D-09）。 */
export const AUTHORIZATION_CAPABILITY = "risk-identification.run" as const;

export const authorizationContext = (): AuthorizationContextV1 => ({
  schemaVersion: "1",
  authorizationContextRef: AUTHORIZATION_CONTEXT_REF,
  actorId: ACTOR_ID,
  projectId: PROJECT_ID,
  grantedCapabilities: [AUTHORIZATION_CAPABILITY],
  spatialScopeRefs: [...SPATIAL_SCOPE_REFS],
  sourceAccessGrantRefs: [...SOURCE_ACCESS_GRANT_REFS],
  authorizationPolicyRef: versionRef("authorization-policy"),
  decidedAt: TIMESTAMP,
  invocation: { kind: "human" },
});

/** I1 冻结策略集：图只按这些精确引用调用下游，不内建默认策略。 */
export const policySet = (): IdentificationGraphPolicySetV1 =>
  IdentificationGraphPolicySetV1Schema.parse({
    schemaVersion: "1",
    policySetRef: POLICY_SET_REF,
    retrievalPolicyRef: versionRef("retrieval-policy"),
    retrievalReviewAgentPolicyRef: REVIEW_POLICY_REF,
    repairPolicyRef: versionRef("repair-policy"),
    confidencePolicyRef: versionRef("confidence-policy"),
    forcedReviewPolicyRef: versionRef("forced-review-policy"),
    mergePolicyRef: versionRef("merge-policy"),
    ruleValidationPolicyRef: versionRef("rule-validation-policy"),
    retryPolicyRef: versionRef("retry-policy"),
    modelDeploymentRef: MODEL_DEPLOYMENT_REF,
    promptTemplateRef: PROMPT_TEMPLATE_REF,
    retryPolicy: {
      schemaVersion: "1",
      policyRef: versionRef("retry-policy"),
      maxAttempts: 2,
      backoffMs: 0,
    },
  });

/** C21 审阅策略正文（图只读其中七个精确引用，用于派生稳定 Agent 任务身份）。 */
export const reviewPolicyBody = () => ({
  schemaVersion: "1",
  policyRef: REVIEW_POLICY_REF,
  definitionRef: versionRef("retrieval-review-definition"),
  toolPolicyRef: versionRef("tool-policy"),
  incrementSchemaRef: versionRef("increment-schema"),
  validationPolicyRef: versionRef("validation-policy"),
  readFrozenResultToolRef: versionRef("tool-read-frozen"),
  resupplementToolRef: versionRef("tool-resupplement"),
  budgetPolicyRef: versionRef("budget-policy"),
  modelDeploymentRef: MODEL_DEPLOYMENT_REF,
  promptTemplateRef: PROMPT_TEMPLATE_REF,
  maxCandidateMembers: 8,
  maxResupplements: 2,
  allowedSupplementIntentCodes: ["settlement"],
  maxOutputTokens: 1024,
});

export const preparationSnapshot = (
  overrides: Partial<Record<string, unknown>> = {},
): IdentificationPreparationSnapshotV1 =>
  IdentificationPreparationSnapshotV1Schema.parse({
    schemaVersion: "1",
    projectRevisionRef: refOf("project-revision", `project-revision:${PROJECT_ID}`),
    spatialScopeRefs: [...SPATIAL_SCOPE_REFS],
    sourceVersionRefs: [SOURCE_VERSION_REF],
    includedSourceSegmentSetRefs: [SOURCE_SEGMENT_SET_REF],
    excludedSegmentDecisionRefs: [],
    dataProcessingPolicyRef: versionRef("data-processing-policy"),
    dataProcessingToolRef: versionRef("data-processing-tool"),
    dataProcessingModelRef: versionRef("data-processing-model"),
    coverageDecisionRef: refOf("route-decision", "coverage-decision"),
    authorizationContextRef: AUTHORIZATION_CONTEXT_REF,
    auditTrailRef: AUDIT_TRAIL_REF,
    createdBy: ACTOR_ID,
    createdAt: TIMESTAMP,
    ...overrides,
  });

const evidenceReference = (sourceSegmentId: string) => ({
  locator: { sourceSegmentId },
  sourceVersion: SOURCE_VERSION_REF.reference,
});

/** 工序模型发布正文：`nodeIds` 为适用节点，另加一个仅出现在工序模型里的非适用节点。 */
export const processModelPackage = (nodeIds: readonly string[] = [NODE_CURRENT, NODE_NEIGHBOR]) =>
  IdentificationKnowledgePackageV1Schema.parse({
    schemaVersion: "1",
    projectId: PROJECT_ID,
    validationPolicyRef: versionRef("validation-policy"),
    preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
    generatedAt: TIMESTAMP,
    definitionType: "process-model",
    nodes: [...nodeIds, NODE_EXCLUDED].map((nodeId) => ({
      nodeId,
      processKind: "变径空间扩挖",
      inputs: ["input-a"],
      outputs: ["output-a"],
      equipmentRefs: ["扩径模块"],
      structuralComponentRefs: ["钢管片"],
      stateParameters: ["盾体直径"],
      monitoringIndicators: ["地表沉降"],
      applicability: {
        constructionMethod: ["method-a"],
        stratumCondition: ["stratum-a"],
        engineeringStage: ["stage-a"],
      },
      evidence: [evidenceReference(`segment-${nodeId}`)],
    })),
    dependencyEdges: [],
  });

export const riskMechanismPackage = (nodeIds: readonly string[] = [NODE_CURRENT, NODE_NEIGHBOR]) =>
  IdentificationKnowledgePackageV1Schema.parse({
    schemaVersion: "1",
    projectId: PROJECT_ID,
    validationPolicyRef: versionRef("validation-policy"),
    preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
    generatedAt: TIMESTAMP,
    definitionType: "risk-mechanism",
    processModelReleaseRef: PROCESS_MODEL_RELEASE_REF,
    mechanisms: nodeIds.map((nodeId) => ({
      mechanismId: `mechanism-${nodeId}`,
      mechanismType: "过挖与地表沉降",
      nodeIds: [nodeId],
      stateParameters: ["盾体直径"],
      monitoringIndicators: ["地表沉降"],
      applicability: {
        constructionMethod: ["method-a"],
        stratumCondition: ["stratum-a"],
        engineeringStage: ["stage-a"],
      },
      preconditions: ["precondition-a"],
      triggeringFactors: ["trigger-a"],
      evolutionPath: ["path-a"],
      consequences: ["consequence-a"],
      evidence: [evidenceReference(`segment-mechanism-${nodeId}`)],
    })),
  });

/** 每个发布引用对应一份精确可读的知识包（图只读 `read.package`）。 */
export const knowledgePackagesByRelease = (
  processNodes: readonly string[] = [NODE_CURRENT, NODE_NEIGHBOR],
  mechanismNodes: readonly string[] = processNodes,
): Map<string, IdentificationKnowledgePackageV1> =>
  new Map([
    [PROCESS_MODEL_RELEASE_REF.reference.entityId, processModelPackage(processNodes)],
    [RISK_MECHANISM_RELEASE_REF.reference.entityId, riskMechanismPackage(mechanismNodes)],
  ]);

/** C17 精确读取收据 + 发布绑定：保持闭合形状，供端口替身返回。 */
const knowledgeReadOf = (
  packageValue: IdentificationKnowledgePackageV1,
  releaseEntityId: string,
): IdentificationKnowledgeExactReadV1 => ({
  package: packageValue,
  validation: {
    schemaVersion: "1",
    projectId: PROJECT_ID,
    definitionType: packageValue.definitionType,
    packageDigest: digest(sha256CanonicalJson(packageValue)),
    validationPolicyRef: versionRef("validation-policy"),
    preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
    items: [
      {
        checkId: "package.strict-schema",
        targetKind: "package",
        targetId: packageValue.definitionType,
        disposition: "accepted",
        reasonCode: "accepted",
        evidenceReferences: [],
      },
    ],
    disposition: "accepted",
    validationArtifactRef: refOf(
      "content-artifact",
      "validation-receipt",
      `sha256:${digest("validation-receipt")}`,
    ),
    validatedAt: TIMESTAMP,
  },
  releaseBinding: {
    schemaVersion: "1",
    projectId: PROJECT_ID,
    definitionType: packageValue.definitionType,
    releaseRef: { kind: "knowledge-release", reference: versionRef(releaseEntityId) },
    revisionRef: refOf("knowledge-revision", `knowledge-revision:${releaseEntityId}`),
    candidateArtifactRef: refOf(
      "content-artifact",
      `candidate:${releaseEntityId}`,
      `sha256:${digest(`candidate:${releaseEntityId}`)}`,
    ),
    boundAt: TIMESTAMP,
  },
});

export const moduleError = (input: {
  readonly code: "BUSINESS_BLOCKED" | "STALE_VERSION" | "TERMINAL_FAILURE" | "TRANSIENT_FAILURE";
  readonly stageCode: string;
  readonly blockerKind?: string;
}) => {
  if (input.code === "BUSINESS_BLOCKED") {
    return ModuleErrorV1Schema.parse({
      code: "BUSINESS_BLOCKED",
      category: "business-blocked",
      retryable: false,
      stageCode: input.stageCode,
      occurredAt: TIMESTAMP,
      causalRunId: "c24-graph-test",
      blockerKind: input.blockerKind ?? "candidate-not-repairable",
      blockerRef: refOf("identification-candidate-set", "candidate-set-c24"),
    });
  }
  if (input.code === "STALE_VERSION") {
    return ModuleErrorV1Schema.parse({
      code: "STALE_VERSION",
      category: "concurrency",
      retryable: false,
      stageCode: input.stageCode,
      occurredAt: TIMESTAMP,
      causalRunId: "c24-graph-test",
      targetRef: refOf("identification-work-item", "work-item-c24"),
    });
  }
  if (input.code === "TRANSIENT_FAILURE") {
    return ModuleErrorV1Schema.parse({
      code: "TRANSIENT_FAILURE",
      category: "technical",
      retryable: true,
      stageCode: input.stageCode,
      occurredAt: TIMESTAMP,
      causalRunId: "c24-graph-test",
      attempt: 1,
      retryPolicyRef: versionRef("retry-policy"),
      diagnosticRef: refOf("diagnostic-artifact", `diagnostic:${input.stageCode}`),
    });
  }
  return ModuleErrorV1Schema.parse({
    code: "TERMINAL_FAILURE",
    category: "technical",
    retryable: false,
    stageCode: input.stageCode,
    occurredAt: TIMESTAMP,
    causalRunId: "c24-graph-test",
    diagnosticRef: refOf("diagnostic-artifact", `diagnostic:${input.stageCode}`),
  });
};

export interface IdentificationGraphWorldV1 {
  /** I1 策略目录是否就绪；`false` 时返回 `undefined`（类型化等待）。 */
  policyReady: boolean;
  /** I1 识别基础解析结果（`transient` 为可重试技术失败）。 */
  basis: "succeeded" | "waiting" | "failed" | "transient";
  /** C15 准备快照是否可读；`false` 时按 C17 领域错误收口。 */
  preparationReady: boolean;
  /** 工序模型发布的节点集合（另加一个仅出现在工序模型里的非适用节点）。 */
  applicableNodes: readonly string[];
  /** 机理发布覆盖的节点集合；缺省与工序模型节点一致。 */
  mechanismNodes: readonly string[];
  /** 每个工作项的 C08 任务内部状态；缺省 `completed`。 */
  agentTaskStatus: Map<string, AgentInternalStatusV1>;
  /** I5 每个工作项的 `repair-and-validate` 覆盖结果。 */
  validationOverride: Map<string, "failed" | "waiting">;
  /** 人工组决定（group entityId → 已成立决定）；缺省表示本轮待定。 */
  reviewDecisions: Map<
    string,
    { readonly kind: IdentificationGroupDecisionKindV1; readonly ref: ReviewDecisionRefV1 }
  >;
  /** I7/I8/I9 读取的验收路线集。 */
  routes: readonly AcceptanceRouteV1[];
  /** `accept-groups` 侧已入库的分组（替身模拟 C22 的幂等重放，不重复产生记录）。 */
  readonly acceptedGroups: Set<string>;
  /** 每个分组本轮新入库的标准化风险记录与事件（`accept-groups` 的闭合结果）。 */
  recordsByGroup: Map<
    string,
    {
      readonly records: readonly StandardizedRiskRecordRefV1[];
      readonly events: readonly DomainEventRefV1[];
    }
  >;
  readonly calls: {
    readonly resolveExact: {
      readonly preparationSnapshotRef: unknown;
      readonly requiredAt: string;
      readonly asOfRecordedAt: string;
    }[];
    readonly basis: unknown[];
    readonly preparation: unknown[];
    readonly knowledge: { readonly releaseEntityId: string }[];
    readonly prepareReview: { readonly taskRef: AgentTaskRefV1 }[];
    readonly assembleContext: { readonly workItemRef: { reference: VersionReference } }[];
    readonly startTask: {
      readonly commandId: string;
      readonly idempotencyKey: string;
      readonly payload: {
        readonly taskType: string;
        readonly frozenInputRef: { readonly reference: VersionReference };
        readonly modelDeploymentRef: VersionReference;
        readonly promptTemplateRef: VersionReference;
        readonly budgetPolicyRef: VersionReference;
      };
    }[];
    readonly getTask: AgentTaskRefV1[];
    /** 原始命令（判别联合），用例按 `kind` 收窄后断言冻结引用与整集提交集。 */
    readonly analyze: IdentificationAnalysisCommandV1[];
    readonly finalize: IdentificationFinalizationCommandV1[];
    readonly readDecision: unknown[];
    readonly readRoutes: unknown[];
    readonly verifyCurrent: { readonly invocationId: string; readonly branch: string }[];
    readonly adapterVerify: { readonly invocationId: string; readonly branch: string }[];
  };
}

export const createWorld = (): IdentificationGraphWorldV1 => ({
  policyReady: true,
  basis: "succeeded",
  preparationReady: true,
  applicableNodes: [NODE_CURRENT, NODE_NEIGHBOR],
  mechanismNodes: [NODE_CURRENT, NODE_NEIGHBOR],
  agentTaskStatus: new Map(),
  validationOverride: new Map(),
  reviewDecisions: new Map(),
  routes: [],
  acceptedGroups: new Set(),
  recordsByGroup: new Map(),
  calls: {
    resolveExact: [],
    basis: [],
    preparation: [],
    knowledge: [],
    prepareReview: [],
    assembleContext: [],
    startTask: [],
    getTask: [],
    analyze: [],
    finalize: [],
    readDecision: [],
    readRoutes: [],
    verifyCurrent: [],
    adapterVerify: [],
  },
});

/** 稳定输入快照身份与工作计划身份（与 core 纯函数同一派生规则，供用例断言）。 */
const INPUT_SNAPSHOT_REF = identificationInputSnapshotRefFor({
  projectId: PROJECT_ID,
  preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
  policySetRef: POLICY_SET_REF,
  processModelReleaseRef: PROCESS_MODEL_RELEASE_REF.reference,
  retrievalEvidenceBaseReleaseRef: EVIDENCE_BASE_RELEASE_REF.reference,
});
const WORK_PLAN_REF = identificationWorkPlanRefFor({
  projectId: PROJECT_ID,
  inputSnapshotRef: INPUT_SNAPSHOT_REF,
});
export const INPUT_SNAPSHOT_ENTITY_ID = INPUT_SNAPSHOT_REF.reference.entityId;
export const WORK_PLAN_ENTITY_ID = WORK_PLAN_REF.reference.entityId;

/** 稳定工作项身份（与 core 纯函数 `identificationWorkItemRefFor` 同一派生规则）。 */
export const workItemRefFor = (
  workPlanEntityId: string,
  nodeId: string,
): { readonly kind: "identification-work-item"; readonly reference: VersionReference } =>
  identificationWorkItemRefFor({
    projectId: PROJECT_ID,
    workPlanRef:
      workPlanEntityId === WORK_PLAN_ENTITY_ID
        ? WORK_PLAN_REF
        : refOf("identification-work-plan", workPlanEntityId),
    nodeId,
  });

/** 稳定 Agent 任务身份：直接复用图的公开派生函数，避免夹具与实现漂移。 */
export const reviewTaskRefFor = (workItemRef: {
  readonly kind: "identification-work-item";
  readonly reference: VersionReference;
}): AgentTaskRefV1 =>
  retrievalReviewTaskRefFor({
    projectId: PROJECT_ID,
    workItemRef,
    refs: {
      policyRef: REVIEW_POLICY_REF,
      modelDeploymentRef: MODEL_DEPLOYMENT_REF,
      promptTemplateRef: PROMPT_TEMPLATE_REF,
      toolPolicyRef: versionRef("tool-policy"),
      budgetPolicyRef: versionRef("budget-policy"),
      incrementSchemaRef: versionRef("increment-schema"),
      validationPolicyRef: versionRef("validation-policy"),
    },
  });

export const retrievalArtifactSetRefFor = (taskRef: AgentTaskRefV1) =>
  refOf(
    "retrieval-artifact-set",
    `retrieval-review:${taskRef.reference.entityId}`,
    digest(`retrieval-artifact-set:${taskRef.reference.entityId}`),
  );

export const candidateSetRefFor = (nodeId: string): IdentificationCandidateSetRefV1 =>
  refOf(
    "identification-candidate-set",
    `identification-candidate-set:${PROJECT_ID}:${nodeId}`,
    digest(`candidate-set:${nodeId}`),
  );

export const validatedCandidateSetRefFor = (nodeId: string): ValidatedCandidateSetRefV1 =>
  refOf(
    "validated-candidate-set",
    `validated-candidate-set:${PROJECT_ID}:${nodeId}`,
    digest(`validated-candidate-set:${nodeId}`),
  );

export const modelContextArtifactSetRef = (nodeId: string) =>
  refOf(
    "model-context-artifact-set",
    `identification-model-context:${PROJECT_ID}:${nodeId}`,
    digest(`model-context:${nodeId}`),
  );

/** 占位计划身份：只用于构造替身“返回”的任务引用，图从不据此比对身份。 */
const DUMMY_WORK_PLAN_ENTITY_ID = `identification-work-plan:${PROJECT_ID}:seed`;

/** 仅用于替身返回值的任务引用（图用的是自己按冻结引用派生的身份）。 */
const dummyTaskRefFor = (nodeId: string): AgentTaskRefV1 =>
  reviewTaskRefFor(workItemRefFor(DUMMY_WORK_PLAN_ENTITY_ID, nodeId));

/** C08 任务快照替身：图只读 `state.status` 与 `state.resultRef`。 */
export const agentTaskSnapshot = (
  taskRef: AgentTaskRefV1,
  input: { readonly status: AgentInternalStatusV1; readonly incrementRef: VersionReference },
): AgentTaskSnapshotV1 => {
  const envelope = AgentTaskEnvelopeV1Schema.parse({
    schemaVersion: "1",
    agentTaskRef: taskRef,
    commandId: `c24-graph-task:${taskRef.reference.entityId}`,
    idempotencyKey: `c24-graph-task:${taskRef.reference.entityId}`,
    taskType: "retrieval-review",
    triggerMode: "embedded",
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    parentRunRef: PARENT_RUN_REF,
    frozenInputRef: refOf(
      "content-artifact",
      "retrieval-review-candidate-set",
      `sha256:${digest("retrieval-review-candidate-set")}`,
    ),
    modelDeploymentRef: MODEL_DEPLOYMENT_REF,
    promptTemplateRef: PROMPT_TEMPLATE_REF,
    toolPolicyRef: versionRef("tool-policy"),
    budgetPolicyRef: versionRef("budget-policy"),
    incrementSchemaRef: versionRef("increment-schema"),
    validationPolicyRef: versionRef("validation-policy"),
    authorization: authorizationContext(),
    frozenAuthorization: {
      schemaVersion: "1",
      authorizationContextRef: AUTHORIZATION_CONTEXT_REF,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      grantedCapabilities: [AUTHORIZATION_CAPABILITY],
      spatialScopeRefs: [...SPATIAL_SCOPE_REFS],
      sourceAccessGrantRefs: [...SOURCE_ACCESS_GRANT_REFS],
      authorizationPolicyRef: versionRef("authorization-policy"),
      capturedAt: TIMESTAMP,
    },
    createdAt: TIMESTAMP,
  });
  const state = AgentTaskStateV1Schema.parse({
    schemaVersion: "1",
    agentTaskRef: taskRef,
    status: input.status,
    taskVersion: 3,
    cancelRequested: input.status === "cancelled",
    ...(input.status === "completed"
      ? {
          resultRef: {
            kind: "agent-task-result",
            reference: versionRef(
              `agent-task-result:${taskRef.reference.entityId}`,
              digest(`agent-task-result:${taskRef.reference.entityId}`),
            ),
            status: "completed",
            agentTaskRef: taskRef,
            incrementRef: { kind: "retrieval-artifact-set", reference: input.incrementRef },
          },
        }
      : {}),
    ...(input.status === "terminal-failure"
      ? {
          error: AgentStructuredErrorV1Schema.parse({
            schemaVersion: "1",
            code: "AGENT_MODEL_FAILURE",
            category: "model",
            retryable: false,
            stage: "agent-task.terminal",
            occurredAt: TIMESTAMP,
          }),
        }
      : {}),
    latestCandidateVersion: 1,
    updatedAt: TIMESTAMP,
  });
  return {
    envelope,
    state,
    budgetPolicy: AgentTaskBudgetPolicyV1Schema.parse({
      schemaVersion: "1",
      policyRef: versionRef("budget-policy"),
      modelDeploymentRef: MODEL_DEPLOYMENT_REF,
      promptTemplateRef: PROMPT_TEMPLATE_REF,
      toolPolicyRef: versionRef("tool-policy"),
      maxModelInvocations: 4,
      maxToolInvocations: 8,
      maxContextTokens: 16_384,
      maxInputBytes: 512_000,
      maxOutputBytes: 128_000,
      maxCandidates: 4,
      maxObjects: 8,
      maxSupplementarySearches: 2,
      maxCorrections: 2,
      maxTransientRetries: 2,
      maxConcurrentActions: 1,
      maxWallClockMs: 600_000,
    }),
    budgetLedger: AgentBudgetLedgerV1Schema.parse({
      schemaVersion: "1",
      reserved: emptyAgentBudgetUsage(),
      used: emptyAgentBudgetUsage(),
      activeWallClockMs: 0,
      currentConcurrency: 0,
      ledgerVersion: 1,
      changedAt: TIMESTAMP,
    }),
  };
};

export interface GraphAccessControllerV1 {
  readonly port: Pick<LocalIdentityAccessV1, "verify">;
  readonly authorization: IdentificationGraphAuthorizationPortV1;
  revoke(): void;
  restore(): void;
}

/** C05 复验替身：同一批签发身份服务适配器复验与运行命令复验；撤权后一律拒绝。 */
export const createGraphAccess = (world: IdentificationGraphWorldV1): GraphAccessControllerV1 => {
  let revoked = false;
  const denied = (stage: string, code: string): never => {
    throw new AccessServiceError({
      code: code as "AUTHORIZATION_DENIED",
      retryable: false,
      stage,
      occurredAt: TIMESTAMP,
      diagnosticRef: refOf("audit-trail", `access-diagnostic:${stage}`),
      contextRefs: [],
      requiredCapability: AUTHORIZATION_CAPABILITY,
      authorizationPolicyRef: versionRef("authorization-policy"),
    });
  };
  return {
    revoke: () => {
      revoked = true;
    },
    restore: () => {
      revoked = false;
    },
    port: {
      async verify(request) {
        world.calls.adapterVerify.push({
          invocationId: request.invocationId,
          branch: request.branch,
        });
        if (revoked) denied("verify.current", "SESSION_REVOKED");
        return {
          context: authorizationContext(),
          contextRef: AUTHORIZATION_CONTEXT_REF,
          redacted: false,
        };
      },
    },
    authorization: {
      async verifyCurrent(input) {
        world.calls.verifyCurrent.push({
          invocationId: input.invocationId,
          branch: input.branch,
        });
        return revoked ? undefined : authorizationContext();
      },
    },
  };
};

/**
 * 端口替身里「图从不读取」的领域正文占位：C15 清洗结果、C21 候选集正文与五项上下文正文都有
 * 各自严格的领域 Schema，本切片不复现这些正文（图只消费其中的引用），故在此集中标注占位，
 * 不伪造领域结论。
 */
const unreadDomainBody = <T>(): T => ({}) as T;

/** 公开端口替身：只返回闭合结果，不读私表、不复制领域算法。 */
const createPortDoubles = (input: {
  readonly world: IdentificationGraphWorldV1;
}): Pick<
  IdentificationGraphPortsV1,
  | "policyProvider"
  | "reviewPolicy"
  | "basisResolver"
  | "preparationReader"
  | "knowledgeReleaseReader"
  | "contextService"
  | "agentTasks"
  | "agentTaskReader"
  | "finalizationService"
  | "reviewDecisionReader"
  | "acceptanceRoutes"
> => {
  const { world } = input;

  const preparationReader: Pick<
    IdentificationPreparationKnowledgeReaderV1,
    "readExactPreparation"
  > = {
    async readExactPreparation(command) {
      world.calls.preparation.push(command);
      if (!world.preparationReady) {
        return {
          kind: "error",
          error: moduleError({
            code: "TERMINAL_FAILURE",
            stageCode: "identification-knowledge.read",
          }),
        };
      }
      return {
        kind: "ok",
        snapshot: preparationSnapshot(),
        agentTaskRef: reviewTaskRefFor(workItemRefFor("plan-seed", NODE_CURRENT)),
        // 占位：`result` 是 C15 清洗正文，图从不读取它。
        result: unreadDomainBody(),
        resultArtifactRef: refOf(
          "content-artifact",
          "data-cleaning-result",
          `sha256:${digest("data-cleaning-result")}`,
        ),
      };
    },
  };

  const knowledgeReleaseReader: Pick<IdentificationKnowledgeReleaseReaderV1, "readExact"> = {
    async readExact(command) {
      const releaseEntityId = command.releaseRef.reference.entityId;
      world.calls.knowledge.push({ releaseEntityId });
      const packageValue = knowledgePackagesByRelease(
        world.applicableNodes,
        world.mechanismNodes,
      ).get(releaseEntityId);
      if (packageValue === undefined) {
        return {
          kind: "failed",
          error: moduleError({
            code: "TERMINAL_FAILURE",
            stageCode: "identification-knowledge.release-read",
          }),
        };
      }
      return { kind: "succeeded", read: knowledgeReadOf(packageValue, releaseEntityId) };
    },
  };

  const finalizationService: Pick<RiskCandidateFinalizationService, "analyze" | "finalize"> = {
    async analyze(command) {
      world.calls.analyze.push(command);
      if (command.kind === "assemble-and-infer") {
        const nodeId = nodeIdOf(command.payload.workItemRef.reference.entityId);
        return {
          kind: "succeeded",
          result: {
            kind: "assemble-and-infer",
            modelContextArtifactSetRef: modelContextArtifactSetRef(nodeId),
            candidateSetRef: candidateSetRefFor(nodeId),
          },
        };
      }
      const nodeId = nodeIdOf(command.payload.candidateSetRef.reference.entityId);
      const override = world.validationOverride.get(nodeId);
      if (override === "failed") {
        return {
          kind: "failed",
          error: moduleError({ code: "TERMINAL_FAILURE", stageCode: "risk-candidate.validate" }),
        };
      }
      if (override === "waiting") {
        return {
          kind: "waiting",
          waiting: { kind: "agent-task", agentTaskRef: dummyTaskRefFor(nodeId) },
        };
      }
      return {
        kind: "succeeded",
        result: {
          kind: "repair-and-validate",
          validatedCandidateSetRef: validatedCandidateSetRefFor(nodeId),
        },
      };
    },
    async finalize(command) {
      world.calls.finalize.push(command);
      if (command.kind === "merge-run-candidates") {
        return {
          kind: "succeeded",
          result: {
            kind: "merge",
            mergePlanRef: mergePlanRefFor(command.payload.workPlanRef.reference.entityId),
          },
        };
      }
      if (command.kind === "route-acceptance") {
        return {
          kind: "succeeded",
          result: {
            kind: "route",
            acceptanceRouteSetRef: acceptanceRouteSetRefFor(
              command.payload.mergePlanRef.reference.entityId,
            ),
            reviewTaskRefs: world.routes.flatMap((route) =>
              route.routeKind === "review" ? [route.reviewTaskRef] : [],
            ),
          },
        };
      }
      // `accept-groups`：整集提交集必须恰等于全部 routes，再按已提交决定给出闭合结果。
      const submittedGroups = command.payload.acceptedGroupRefs.map(
        (groupRef) => groupRef.reference.entityId,
      );
      const allGroups = world.routes.map((route) => route.groupRef.reference.entityId);
      if (
        submittedGroups.length !== allGroups.length ||
        allGroups.some((entityId) => !submittedGroups.includes(entityId))
      ) {
        throw new TypeError("accept-groups must submit every route of the acceptance route set");
      }
      const qualified = world.routes.filter((route) => routeQualifies(route, world));
      if (qualified.length === 0) {
        return { kind: "succeeded", result: { kind: "skipped", skippedGroupRefs: [] } };
      }
      const records: StandardizedRiskRecordRefV1[] = [];
      const events: DomainEventRefV1[] = [];
      for (const route of qualified) {
        const groupKey = route.groupRef.reference.entityId;
        // 已入库组按 C22 幂等身份重放为 no-op：不再回传记录，也不重复产生事件。
        if (world.acceptedGroups.has(groupKey)) continue;
        world.acceptedGroups.add(groupKey);
        const stored = world.recordsByGroup.get(groupKey);
        if (stored === undefined) {
          records.push(riskRecordRefFor(route.groupId));
          events.push(acceptedEventRefFor(route.groupId));
          continue;
        }
        records.push(...stored.records);
        events.push(...stored.events);
      }
      return {
        kind: "succeeded",
        result: {
          kind: "accepted",
          standardizedRiskRecordRefs: records,
          assessmentEventRefs: events,
        },
      };
    },
  };

  return {
    policyProvider: {
      async resolveExact(command) {
        world.calls.resolveExact.push({
          preparationSnapshotRef: command.preparationSnapshotRef,
          requiredAt: command.requiredAt,
          asOfRecordedAt: command.asOfRecordedAt,
        });
        return world.policyReady ? policySet() : undefined;
      },
    },
    reviewPolicy: async () => reviewPolicyBody(),
    basisResolver: {
      async resolve(command) {
        world.calls.basis.push(command);
        if (world.basis === "waiting") {
          return {
            kind: "waiting",
            waiting: {
              kind: "knowledge-preparation",
              knowledgePreparationTaskRef: refOf(
                "knowledge-preparation-task",
                "knowledge-preparation-task-c24",
              ),
            },
          };
        }
        if (world.basis === "transient") {
          return {
            kind: "failed",
            error: moduleError({
              code: "TRANSIENT_FAILURE",
              stageCode: "knowledge-modeling.basis",
            }),
          };
        }
        if (world.basis === "failed") {
          return {
            kind: "failed",
            error: moduleError({ code: "STALE_VERSION", stageCode: "knowledge-modeling.basis" }),
          };
        }
        return {
          kind: "succeeded",
          result: {
            kind: "identification-basis",
            processModelReleaseRef: PROCESS_MODEL_RELEASE_REF,
            riskMechanismReleaseRef: RISK_MECHANISM_RELEASE_REF,
            retrievalEvidenceBaseReleaseRef: EVIDENCE_BASE_RELEASE_REF,
            identificationPolicySetRef: POLICY_SET_REF,
          },
        };
      },
    },
    preparationReader,
    knowledgeReleaseReader,
    contextService: {
      async prepareReview(command) {
        world.calls.prepareReview.push({ taskRef: command.taskRef });
        const nodeId = nodeIdOf(command.workItemRef.reference.entityId);
        return {
          candidateSetRef: refOf(
            "content-artifact",
            `retrieval-review-candidate-set:${candidateSetRefFor(nodeId).reference.entityId}`,
            `sha256:${digest("retrieval-review-candidate-set")}`,
          ),
          // 占位：候选集正文由 C21 拥有，图只消费 `candidateSetRef`。
          candidateSet: unreadDomainBody(),
          baselineQueryResultRef: refOf("knowledge-query-result", `baseline:${nodeId}`),
          relationshipQueryResultRef: refOf("knowledge-query-result", `relationship:${nodeId}`),
        };
      },
      async assembleContext(command) {
        world.calls.assembleContext.push({ workItemRef: command.workItemRef });
        const nodeId = nodeIdOf(command.workItemRef.reference.entityId);
        return {
          modelContextArtifactSetRef: modelContextArtifactSetRef(nodeId),
          // 占位：五项上下文正文由 C21 拥有，图只消费工件集引用。
          payload: unreadDomainBody(),
        };
      },
    },
    agentTasks: {
      async startTask(command) {
        const frozenInputRef = command.payload.frozenInputRef;
        if (frozenInputRef.kind !== "content-artifact") {
          throw new TypeError("start-task must freeze a content artifact");
        }
        world.calls.startTask.push({
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          payload: {
            taskType: command.payload.taskType,
            frozenInputRef,
            modelDeploymentRef: command.payload.modelDeploymentRef,
            promptTemplateRef: command.payload.promptTemplateRef,
            budgetPolicyRef: command.payload.budgetPolicyRef,
          },
        });
        const nodeId = nodeIdOf(frozenInputRef.reference.entityId);
        return { kind: "succeeded", result: { agentTaskRef: dummyTaskRefFor(nodeId) } };
      },
    },
    agentTaskReader: {
      async getTask(taskRef) {
        world.calls.getTask.push(taskRef);
        const status =
          world.agentTaskStatus.get(nodeIdOf(taskRef.reference.entityId)) ?? "completed";
        return agentTaskSnapshot(taskRef, {
          status,
          incrementRef: retrievalArtifactSetRefFor(taskRef).reference,
        });
      },
    },
    finalizationService,
    reviewDecisionReader: {
      async readIdentificationGroupDecision(command) {
        world.calls.readDecision.push(command);
        const decision = world.reviewDecisions.get(command.groupRef.reference.entityId);
        if (decision === undefined) return { kind: "pending" };
        return {
          kind: "decided",
          decisionKind: decision.kind,
          reviewDecisionRef: decision.ref,
          decidedAt: TIMESTAMP,
        };
      },
    },
    acceptanceRoutes: {
      async readRoutes(command) {
        world.calls.readRoutes.push(command);
        return world.routes.map((route) => AcceptanceRouteV1Schema.parse(route));
      },
    },
  };
};

/** 自动路线直接用系统决定；review 路线按已成立决定判定是否合格。 */
const routeQualifies = (route: AcceptanceRouteV1, world: IdentificationGraphWorldV1): boolean => {
  if (route.routeKind === "automatic") return true;
  const decision = world.reviewDecisions.get(route.groupRef.reference.entityId);
  if (decision === undefined) return false;
  return ["approve-unchanged", "approve-revised-candidate", "confirm-merge"].includes(
    decision.kind,
  );
};

const colonSegments = (entityId: string): readonly string[] => entityId.split(":");

/** 夹具身份约定：最后一段是 `nodeId`。 */
export const nodeIdOf = (entityId: string): string => colonSegments(entityId).at(-1) ?? entityId;

export const mergePlanRefFor = (workPlanEntityId: string) =>
  refOf("merge-plan", `merge-plan:${PROJECT_ID}:${workPlanEntityId}`, digest("merge-plan-v1"));

export const acceptanceRouteSetRefFor = (mergePlanEntityId: string) =>
  refOf(
    "acceptance-route-set",
    `acceptance-route-set:${PROJECT_ID}:${mergePlanEntityId}`,
    digest("acceptance-route-set-v1"),
  );

export const groupRefFor = (workPlanEntityId: string, groupId: string) =>
  refOf(
    "identification-group",
    `identification-group:${PROJECT_ID}:${workPlanEntityId}:${groupId}`,
    digest(`group:${groupId}`),
  );

export const routeDecisionRefFor = (mergePlanEntityId: string, groupId: string) =>
  refOf(
    "route-decision",
    `route-decision:${PROJECT_ID}:${mergePlanEntityId}:${groupId}`,
    digest(`route-decision:${groupId}`),
  );

/** 标准化风险记录与验收事件的稳定身份（`accept-groups` 替身建立，供用例断言）。 */
export const riskRecordRefFor = (groupId: string) =>
  refOf(
    "standardized-risk-record",
    `standardized-risk-record:${PROJECT_ID}:${groupId}`,
    digest(`risk-record:${groupId}`),
  );

export const acceptedEventRefFor = (groupId: string): DomainEventRefV1 => ({
  kind: "domain-event",
  eventId: `identification.risk-record-accepted.v1:${PROJECT_ID}:${groupId}`,
  eventVersion: 1,
});

/** I8 验收动作身份后缀：由本轮已决决定集确定性派生（与图同一算法）。 */
export const acceptanceSuffixFor = (
  decisions: readonly {
    readonly kind: string;
    readonly reference: { readonly entityId: string; readonly versionId: string };
  }[],
): string =>
  `I8:${sha256CanonicalJson(
    decisions.map((ref) => `${ref.kind}/${ref.reference.entityId}/${ref.reference.versionId}`),
  ).slice(0, 32)}`;

export const reviewDecisionRefFor = (groupId: string) =>
  refOf(
    "review-decision",
    `review-decision:${PROJECT_ID}:${groupId}`,
    digest(`review-decision:${groupId}`),
  );

const compositeConfidence = (
  value: number,
  missingBasisBehavior: "block" | "exclude-and-renormalize",
) => ({
  value,
  basis: [
    {
      source: "model-confidence",
      available: true,
      value,
      weight: 0.25,
      contribution: value * 0.25,
    },
    {
      source: "rule-consistency",
      available: true,
      value,
      weight: 0.25,
      contribution: value * 0.25,
    },
    {
      source: "simulation-constraint",
      available: false,
      value: 0,
      weight: 0.25,
      contribution: 0,
    },
    {
      source: "multi-source-merge",
      available: true,
      value,
      weight: 0.25,
      contribution: value * 0.25,
    },
  ],
  policyRef: versionRef("confidence-policy"),
  missingBasisBehavior,
  roundingDecimals: 2,
});

/** 自动验收路线（判别收窄，便于用例直接断言 `routeDecisionRef`）。 */
export type AutomaticAcceptanceRouteV1 = Extract<
  AcceptanceRouteV1,
  { readonly routeKind: "automatic" }
>;
/** 人工复核验收路线。 */
export type ReviewAcceptanceRouteV1 = Extract<AcceptanceRouteV1, { readonly routeKind: "review" }>;

export const automaticRouteFor = (
  workPlanEntityId: string,
  groupId: string,
): AutomaticAcceptanceRouteV1 => {
  const route = AcceptanceRouteV1Schema.parse({
    routeKind: "automatic",
    groupId,
    groupVersionId: digest(`group-version:${groupId}`),
    groupRef: groupRefFor(workPlanEntityId, groupId),
    compositeConfidence: compositeConfidence(0.9, "exclude-and-renormalize"),
    routeDecisionRef: routeDecisionRefFor(
      mergePlanRefFor(workPlanEntityId).reference.entityId,
      groupId,
    ),
  });
  if (route.routeKind !== "automatic") throw new TypeError("automatic acceptance route expected");
  return route;
};

export const reviewRouteFor = (
  workPlanEntityId: string,
  groupId: string,
  runRef: WorkflowRunRefV1,
): ReviewAcceptanceRouteV1 => {
  const groupRef = groupRefFor(workPlanEntityId, groupId);
  const route = AcceptanceRouteV1Schema.parse({
    routeKind: "review",
    groupId,
    groupVersionId: groupRef.reference.versionId,
    groupRef,
    compositeConfidence: compositeConfidence(0.4, "block"),
    reviewTaskRef: {
      kind: "review-task",
      reference: versionRef(
        `identification-group-review:${PROJECT_ID}:${groupRef.reference.versionId}`,
        REVIEW_POLICY_REF.versionId,
      ),
      reviewType: "identification-group",
      targetRef: { kind: "identification-group", reference: groupRef.reference },
      waitingRunRef: runRef,
    } satisfies ReviewTaskRefV1,
    waitingRunRef: runRef,
    validationSnapshotRef: refOf(
      "validation-snapshot",
      `validation-snapshot:${PROJECT_ID}:${groupId}`,
      digest(`validation:${groupId}`),
    ),
    evidenceSnapshotRef: refOf(
      "evidence-snapshot",
      `evidence-snapshot:${PROJECT_ID}:${groupId}`,
      digest(`evidence:${groupId}`),
    ),
    reviewPolicyRef: REVIEW_POLICY_REF,
    forcedReviewReasonCode: "low-composite-confidence",
  });
  if (route.routeKind !== "review") throw new TypeError("review acceptance route expected");
  return route;
};

export interface IdentificationGraphRunScopeV1 {
  readonly graphVersion: VersionReference;
  readonly runRef: WorkflowRunRefV1;
  readonly threadId: string;
}

export interface IdentificationGraphHarnessV1 {
  readonly world: IdentificationGraphWorldV1;
  readonly access: GraphAccessControllerV1;
  readonly runtime: IdentificationGraphRuntimeV1;
  readonly graph: IdentificationGraphRunnerV1;
  readonly adapter: PostgresIdentificationGraphAdapterV1;
  readonly postgres: PostgresTestFixture;
  readonly app: PostgresRuntime;
  readonly clock: { current: Date; advance(ms: number): void };
  /**
   * 独立运行身份：同一容器内每个用例用不同 `versionId` 取得独立 run/thread，
   * 从而共享夹具又不共享登记事实（行按 run 隔离）。
   */
  scope(versionId: string): IdentificationGraphRunScopeV1;
  startCommand(
    scope: IdentificationGraphRunScopeV1,
    overrides?: Partial<IdentificationGraphStartCommandV1>,
  ): IdentificationGraphStartCommandV1;
  resumeCommand(
    scope: IdentificationGraphRunScopeV1,
    overrides: Partial<IdentificationGraphResumeCommandV1> & {
      readonly resumeCause: IdentificationGraphResumeCommandV1["resumeCause"];
    },
  ): IdentificationGraphResumeCommandV1;
  cancelCommand(
    scope: IdentificationGraphRunScopeV1,
    overrides?: Partial<IdentificationGraphCancelCommandV1>,
  ): IdentificationGraphCancelCommandV1;
  latestRunState(scope: IdentificationGraphRunScopeV1): Promise<{
    readonly row: Extract<IdentificationGraphResultRowV1, { readonly resultKind: "run-state" }>;
    readonly state: IdentificationGraphRunStateV1;
    readonly runVersionId: string;
  }>;
  rows(
    scope: IdentificationGraphRunScopeV1,
    resultKind?: IdentificationGraphResultRowV1["resultKind"],
  ): Promise<readonly IdentificationGraphResultRowV1[]>;
  /** 经 C04 读取任意已登记工件的正文（用途码与写入时一致）。 */
  readArtifactBody(artifactRef: ArtifactRefV1, purposeCode: string): Promise<unknown>;
  close(): Promise<void>;
}

export interface StartHarnessOptionsV1 {
  /** 故障注入：令第 N 次检查点写入失败（其余写入仍走真实实现）。 */
  readonly failCheckpointPutAt?: number;
}

/** 每例一个容器：完整生产迁移链 + C04 工件存储 + 真实 C03 PostgreSQL checkpointer。 */
export const startIdentificationGraphHarness = async (
  options: StartHarnessOptionsV1 = {},
): Promise<IdentificationGraphHarnessV1> => {
  const postgres = await startPostgresFixture();
  const app = createPostgresRuntime(postgres.app, "riskflow_app");
  let rootDirectory: string | undefined;
  let artifactStore: (ArtifactStoreV1 & { close(): Promise<void> }) | undefined;
  let checkpointer: PostgresCheckpointer | undefined;
  try {
    await runPostgresMigrations({
      connection: postgres.migrator,
      migrationRoot: postgres.productionMigrationRoot,
      additionalMigrationRoots: [postgres.fixtureMigrationRoot],
    });
    rootDirectory = await mkdtemp(join(tmpdir(), "riskflow-c24-graph-"));
    const transactionUnit = new PostgresTransactionUnit(app.db);
    const registry = new PostgresArtifactRegistry({
      db: app.db,
      transactionUnit,
      pool: app.pool,
    });
    const store = await createFilesystemArtifactStore({
      rootDirectory,
      policy: artifactPolicy(),
      registry,
      transactionUnit,
    });
    artifactStore = store;
    checkpointer = await setupPostgresCheckpointer({
      ...postgres.checkpointer,
      validateReference: () => true,
    });
    if (options.failCheckpointPutAt !== undefined) {
      // 故障注入：第 N 次检查点写入失败，其余调用仍走真实 checkpointer 实现。
      const failAt = options.failCheckpointPutAt;
      const realPut = checkpointer.put.bind(checkpointer);
      let puts = 0;
      Object.defineProperty(checkpointer, "put", {
        value: async (...args: Parameters<PostgresCheckpointer["put"]>) => {
          puts += 1;
          if (puts === failAt) throw new TypeError("injected checkpoint write failure");
          return await realPut(...args);
        },
      });
    }

    const world = createWorld();
    const clock = {
      current: new Date(TIMESTAMP),
      advance(ms: number) {
        this.current = new Date(this.current.getTime() + ms);
      },
    };
    const access = createGraphAccess(world);
    const adapter = createPostgresIdentificationGraphAdapter({
      db: app.db,
      transactionUnit,
      artifactStore: store,
      authorization: access.port,
      now: () => clock.current,
    });
    const ports: IdentificationGraphPortsV1 = {
      transactionUnit,
      registrationStore: adapter.registrationStore,
      bodies: adapter,
      checkpoints: adapter,
      ...createPortDoubles({ world }),
      now: () => clock.current,
    };
    const graph = createIdentificationGraph({ ports, checkpointer });
    const runtime = createIdentificationGraphRuntime({
      ports,
      graph,
      authorization: access.authorization,
      now: () => clock.current,
    });

    let commandSequence = 0;
    const commandIdFor = (operation: string): string => {
      commandSequence += 1;
      return `c24-graph-${operation}-${commandSequence}`;
    };
    const scope = (versionId: string): IdentificationGraphRunScopeV1 => {
      const graphVersion = versionRef("identification-graph", versionId);
      const identity = identificationRunIdentityFor({
        projectId: PROJECT_ID,
        parentRiskFlowRunRef: PARENT_RUN_REF,
        preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
        graphVersion,
      });
      return { graphVersion, runRef: identity.runRef, threadId: identity.threadId };
    };

    return {
      world,
      access,
      runtime,
      graph,
      adapter,
      postgres,
      app,
      clock,
      scope,
      startCommand(runScope, overrides = {}) {
        const commandId = overrides.commandId ?? commandIdFor("start");
        return {
          projectId: PROJECT_ID,
          actorId: ACTOR_ID,
          commandId,
          idempotencyKey: `idempotency:${commandId}`,
          issuedAt: clock.current.toISOString(),
          validAt: clock.current.toISOString(),
          requestedAt: clock.current.toISOString(),
          authorization: authorizationContext(),
          graphVersion: runScope.graphVersion,
          parentRiskFlowRunRef: PARENT_RUN_REF,
          preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
          triggerReasonCode: "manual-identification-request",
          ...overrides,
        };
      },
      resumeCommand(runScope, overrides) {
        const commandId = overrides.commandId ?? commandIdFor("resume");
        return {
          projectId: PROJECT_ID,
          actorId: ACTOR_ID,
          commandId,
          idempotencyKey: overrides.idempotencyKey ?? `idempotency:${commandId}`,
          issuedAt: clock.current.toISOString(),
          requestedAt: clock.current.toISOString(),
          authorization: authorizationContext(),
          runRef: runScope.runRef,
          expectedRunVersionId: digest("run-version-not-set"),
          ...overrides,
        };
      },
      cancelCommand(runScope, overrides = {}) {
        const commandId = overrides.commandId ?? commandIdFor("cancel");
        return {
          projectId: PROJECT_ID,
          actorId: ACTOR_ID,
          commandId,
          idempotencyKey: `idempotency:${commandId}`,
          issuedAt: clock.current.toISOString(),
          requestedAt: clock.current.toISOString(),
          authorization: authorizationContext(),
          runRef: runScope.runRef,
          expectedRunVersionId: digest("run-version-not-set"),
          reasonCode: "operator-cancelled",
          ...overrides,
        };
      },
      async latestRunState(runScope) {
        const latest = await adapter.registrationStore.readLatestRunState({
          projectId: PROJECT_ID,
          runId: runScope.runRef.reference.entityId,
        });
        if (latest === undefined) throw new TypeError("identification run state is not registered");
        return { row: latest.row, state: latest.state, runVersionId: latest.state.runVersionId };
      },
      async rows(runScope, resultKind) {
        const rows = await adapter.registrationStore.listRunRows({
          projectId: PROJECT_ID,
          runId: runScope.runRef.reference.entityId,
        });
        return resultKind === undefined
          ? rows
          : rows.filter((row) => row.resultKind === resultKind);
      },
      async readArtifactBody(artifactRef, purposeCode) {
        const handle = await store.open(
          ArtifactReadRequestV1Schema.parse({
            schemaVersion: "1",
            requestId: `c24-graph-test-read:${artifactRef.reference.entityId}`,
            idempotencyKey: `c24-graph-test-read:${artifactRef.reference.entityId}`,
            artifactRef,
            projectId: PROJECT_ID,
            actorId: ACTOR_ID,
            requestedAt: clock.current.toISOString(),
            purposeCode,
            requiredCapability: AUTHORIZATION_CAPABILITY,
            authorization: authorizationContext(),
          }),
        );
        const chunks: Uint8Array[] = [];
        for await (const chunk of handle.content) chunks.push(chunk);
        await handle.verified;
        const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
      },
      async close() {
        await checkpointer?.end().catch(() => undefined);
        await artifactStore?.close().catch(() => undefined);
        await app.close().catch(() => undefined);
        if (rootDirectory !== undefined) {
          await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
        }
        await postgres.close().catch(() => undefined);
      },
    };
  } catch (error) {
    await checkpointer?.end().catch(() => undefined);
    await artifactStore?.close().catch(() => undefined);
    await app.close().catch(() => undefined);
    if (rootDirectory !== undefined) {
      await rm(rootDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
    await postgres.close().catch(() => undefined);
    throw error;
  }
};
