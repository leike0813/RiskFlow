/**
 * C24 识别子图核心行为测试（IP-10/IP-11/IP-19）：输入快照版本组合与确定性身份、工作计划的
 * 完整覆盖/稳定排序/缺项整体阻断、I9 终态汇总、稳定错误分类与等待投影。
 *
 * 全部 fixture 均为「合成样本、待甲方复核」：准备快照、策略集、工序事实、工作项/分组终态与
 * 上游错误都是手工构造的合成值，不对应任何真实工程资料、真实策略版本或真实模型输出。
 *
 * 断言只覆盖稳定可观察契约：引用相等性、工作项集合与顺序、终态种类、稳定错误码、`retryable`
 * 布尔与计数。不断言完整错误文案、日志、字段顺序或内部调用顺序。
 */
import { describe, expect, it } from "vitest";

import type { VersionReference } from "@riskflow/contracts/common";
import {
  ResumeCauseV1Schema,
  type AgentTaskRefV1,
  type IdentificationGroupRefV1,
  type IdentificationInputSnapshotRefV1,
  type IdentificationPreparationSnapshotRefV1,
  type IdentificationWorkItemRefV1,
  type IdentificationZeroResultRefV1,
  type ReviewTaskRefV1,
  type WorkflowRunRefV1,
} from "@riskflow/contracts/ports";
import {
  IdentificationInputSnapshotV1Schema,
  IdentificationPreparationSnapshotV1Schema,
  type IdentificationInputSnapshotV1,
  type IdentificationPreparationSnapshotV1,
} from "@riskflow/contracts/workflows";

import {
  IDENTIFICATION_GRAPH_ERROR_CODES_V1,
  IdentificationGraphPolicySetV1Schema,
  IdentificationGraphRunResultV1Schema,
  isRetryableIdentificationGraphError,
  type IdentificationGraphPolicySetV1,
  type IdentificationGraphWaitingV1,
} from "../../src/identification/graph/schema.js";
import {
  buildIdentificationWorkPlan,
  classifyIdentificationGraphOutcome,
  identificationInputSnapshotRefFor,
  identificationWorkItemRefFor,
  identificationWorkPlanRefFor,
  resolveIdentificationInputSnapshot,
  summarizeIdentificationRun,
  toWaitingRef,
  type IdentificationGraphGroupOutcomeV1,
  type IdentificationGraphProcessNodeFactV1,
  type IdentificationGraphWorkItemOutcomeV1,
} from "../../src/identification/graph/index.js";

const TIMESTAMP = "2030-01-01T00:00:00.000Z";
const PROJECT = "project-c24";
const ACTOR = "actor-c24";

const versionRef = (entityId: string, versionId = "v1"): VersionReference => ({
  entityId,
  versionId,
});

const PREPARATION_SNAPSHOT_REF: IdentificationPreparationSnapshotRefV1 = {
  kind: "identification-preparation-snapshot",
  reference: versionRef("identification-preparation-c24"),
};
const OTHER_PREPARATION_SNAPSHOT_REF: IdentificationPreparationSnapshotRefV1 = {
  kind: "identification-preparation-snapshot",
  reference: versionRef("identification-preparation-c24-other"),
};
const BLANK_PREPARATION_SNAPSHOT_REF: IdentificationPreparationSnapshotRefV1 = {
  kind: "identification-preparation-snapshot",
  reference: versionRef("   "),
};
const PROCESS_MODEL_RELEASE = versionRef("process-model-release-c24", "release-7");
const RISK_MECHANISM_RELEASE = versionRef("risk-mechanism-release-c24", "release-4");
const RETRIEVAL_EVIDENCE_BASE_RELEASE = versionRef(
  "retrieval-evidence-base-release-c24",
  "release-9",
);
const AUTHORIZATION_CONTEXT_REF = {
  kind: "authorization-context" as const,
  reference: versionRef("authorization-context-c24"),
};
const AUDIT_TRAIL_REF = {
  kind: "audit-trail" as const,
  reference: versionRef("audit-trail-c24"),
};

const NODE_APPLICABLE_A = "node-01-盾构始发";
const NODE_EXCLUDED = "node-02-变径扩挖";
const NODE_APPLICABLE_B = "node-03-刀盘扩径";

/** 故意打乱顺序：I2 必须自行稳定排序，排除项单独成列。 */
const NODE_FACTS: readonly IdentificationGraphProcessNodeFactV1[] = [
  { nodeId: NODE_APPLICABLE_B, applicable: true, frozenQueryText: "查询依据-刀盘扩径" },
  { nodeId: NODE_EXCLUDED, applicable: false, frozenQueryText: "查询依据-变径扩挖" },
  { nodeId: NODE_APPLICABLE_A, applicable: true, frozenQueryText: "查询依据-盾构始发" },
];

const policySet = (
  overrides: Partial<IdentificationGraphPolicySetV1> = {},
): IdentificationGraphPolicySetV1 =>
  IdentificationGraphPolicySetV1Schema.parse({
    schemaVersion: "1",
    policySetRef: {
      kind: "identification-policy-set",
      reference: versionRef("identification-policy-set-c24", "set-v3"),
    },
    retrievalPolicyRef: versionRef("retrieval-policy-c24", "v2"),
    retrievalReviewAgentPolicyRef: versionRef("retrieval-review-agent-policy-c24", "v5"),
    repairPolicyRef: versionRef("repair-policy-c24", "v1"),
    confidencePolicyRef: versionRef("confidence-policy-c24", "v4"),
    forcedReviewPolicyRef: versionRef("forced-review-policy-c24", "v2"),
    mergePolicyRef: versionRef("merge-policy-c24", "v1"),
    ruleValidationPolicyRef: versionRef("rule-validation-policy-c24", "v1"),
    retryPolicyRef: versionRef("retry-policy-c24", "v1"),
    modelDeploymentRef: versionRef("model-deployment-c24", "v7"),
    promptTemplateRef: versionRef("prompt-template-c24", "v9"),
    retryPolicy: {
      schemaVersion: "1",
      policyRef: versionRef("retry-policy-c24", "v1"),
      maxAttempts: 3,
      backoffMs: 1_000,
    },
    ...overrides,
  });

/**
 * 完整准备快照（正常路径经过 Schema 收口）。负向用例需要故意违反 Schema 的部分字段，
 * 因此覆写直接叠加在已收口正文之上，不再二次 parse。
 */
const preparationSnapshot = (
  overrides: Partial<IdentificationPreparationSnapshotV1> = {},
): IdentificationPreparationSnapshotV1 => ({
  ...IdentificationPreparationSnapshotV1Schema.parse({
    schemaVersion: "1",
    projectRevisionRef: {
      kind: "project-revision",
      reference: versionRef("project-revision-c24"),
    },
    spatialScopeRefs: [
      { kind: "spatial-scope", reference: versionRef("spatial-scope-c24-a") },
      { kind: "spatial-scope", reference: versionRef("spatial-scope-c24-b") },
    ],
    sourceVersionRefs: [
      { kind: "source-version", reference: versionRef("source-version-c24-a") },
      { kind: "source-version", reference: versionRef("source-version-c24-b") },
    ],
    includedSourceSegmentSetRefs: [
      { kind: "source-segment-set", reference: versionRef("source-segment-set-c24-a") },
      { kind: "source-segment-set", reference: versionRef("source-segment-set-c24-b") },
    ],
    excludedSegmentDecisionRefs: [],
    dataProcessingPolicyRef: versionRef("data-processing-policy-c24"),
    dataProcessingToolRef: versionRef("data-processing-tool-c24"),
    dataProcessingModelRef: versionRef("data-processing-model-c24"),
    coverageDecisionRef: {
      kind: "route-decision",
      reference: versionRef("coverage-decision-c24"),
    },
    authorizationContextRef: AUTHORIZATION_CONTEXT_REF,
    auditTrailRef: AUDIT_TRAIL_REF,
    createdBy: ACTOR,
    createdAt: TIMESTAMP,
  }),
  ...overrides,
});

const validResolveInput = () => ({
  preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
  policySet: policySet(),
  processModelReleaseRef: PROCESS_MODEL_RELEASE,
  riskMechanismReleaseRef: RISK_MECHANISM_RELEASE,
  retrievalEvidenceBaseReleaseRef: RETRIEVAL_EVIDENCE_BASE_RELEASE,
  authorizationContextRef: AUTHORIZATION_CONTEXT_REF,
  auditTrailRef: AUDIT_TRAIL_REF,
  createdBy: ACTOR,
  createdAt: TIMESTAMP,
});

const inputSnapshot = (): IdentificationInputSnapshotV1 =>
  resolveIdentificationInputSnapshot(validResolveInput());

const inputSnapshotRefFor = (
  preparationSnapshotRef: IdentificationPreparationSnapshotRefV1 = PREPARATION_SNAPSHOT_REF,
): IdentificationInputSnapshotRefV1 =>
  identificationInputSnapshotRefFor({
    projectId: PROJECT,
    preparationSnapshotRef,
    policySetRef: inputSnapshot().identificationPolicySetRef,
    processModelReleaseRef: PROCESS_MODEL_RELEASE,
    retrievalEvidenceBaseReleaseRef: RETRIEVAL_EVIDENCE_BASE_RELEASE,
  });

const workPlanRefFor = () =>
  identificationWorkPlanRefFor({ projectId: PROJECT, inputSnapshotRef: inputSnapshotRefFor() });

const workItemRefFor = (nodeId: string) =>
  identificationWorkItemRefFor({
    projectId: PROJECT,
    workPlanRef: workPlanRefFor(),
    nodeId,
  });

const PLANNED_WORK_ITEM_REFS: readonly [IdentificationWorkItemRefV1, IdentificationWorkItemRefV1] =
  [workItemRefFor(NODE_APPLICABLE_A), workItemRefFor(NODE_APPLICABLE_B)];

/** 零结果引用夹具：身份由工程与节点派生，摘要只区分同一工程内的不同零事实。 */
const zeroResultRefFor = (nodeId: string): IdentificationZeroResultRefV1 => ({
  kind: "identification-zero-result",
  reference: versionRef(`identification-zero-result:${PROJECT}:${nodeId}`, `zero-${nodeId}`),
});

const planInput = (overrides: {
  readonly preparationSnapshot?: IdentificationPreparationSnapshotV1;
  readonly inputSnapshotRef?: IdentificationInputSnapshotRefV1;
  readonly nodes?: readonly IdentificationGraphProcessNodeFactV1[];
}) => ({
  projectId: PROJECT,
  workPlanRef: workPlanRefFor(),
  inputSnapshotRef: overrides.inputSnapshotRef ?? inputSnapshotRefFor(),
  inputSnapshot: inputSnapshot(),
  preparationSnapshot: overrides.preparationSnapshot ?? preparationSnapshot(),
  applicableProcessNodes: overrides.nodes ?? NODE_FACTS,
});

const RUN_REF: WorkflowRunRefV1 = {
  kind: "workflow-run",
  reference: versionRef("identification-run-c24", "run-v1"),
};
const PARENT_RUN_REF: WorkflowRunRefV1 = {
  kind: "workflow-run",
  reference: versionRef("risk-flow-run-c24", "parent-v1"),
};
const GROUP_REF: IdentificationGroupRefV1 = {
  kind: "identification-group",
  reference: versionRef("identification-group-c24-a", "group-digest-a"),
};
const OTHER_GROUP_REF: IdentificationGroupRefV1 = {
  kind: "identification-group",
  reference: versionRef("identification-group-c24-b", "group-digest-b"),
};
const THIRD_GROUP_REF: IdentificationGroupRefV1 = {
  kind: "identification-group",
  reference: versionRef("identification-group-c24-c", "group-digest-c"),
};
const REVIEW_TASK_REF: ReviewTaskRefV1 = {
  kind: "review-task",
  reference: versionRef("identification-group-review-c24-a", "v1"),
  reviewType: "identification-group",
  targetRef: GROUP_REF,
  waitingRunRef: RUN_REF,
};
const AGENT_TASK_REF: AgentTaskRefV1 = {
  kind: "agent-task",
  reference: versionRef("retrieval-review-task-c24", "v1"),
  taskType: "retrieval-review",
  triggerMode: "embedded",
  modelDeploymentRef: versionRef("model-deployment-c24", "v7"),
  promptTemplateRef: versionRef("prompt-template-c24", "v9"),
  toolPolicyRef: versionRef("tool-policy-c24", "v1"),
  budgetPolicyRef: versionRef("budget-policy-c24", "v1"),
  incrementSchemaRef: versionRef("increment-schema-c24", "v1"),
  validationPolicyRef: versionRef("validation-policy-c24", "v1"),
};

const summarizeInput = (overrides: {
  readonly plannedWorkItemRefs?: readonly IdentificationWorkItemRefV1[];
  readonly workItemOutcomes?: readonly IdentificationGraphWorkItemOutcomeV1[];
  readonly groupOutcomes?: readonly IdentificationGraphGroupOutcomeV1[];
}) =>
  summarizeIdentificationRun({
    projectId: PROJECT,
    runRef: RUN_REF,
    parentRiskFlowRunRef: PARENT_RUN_REF,
    preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
    inputSnapshotRef: inputSnapshotRefFor(),
    workPlanRef: workPlanRefFor(),
    plannedWorkItemRefs: overrides.plannedWorkItemRefs ?? PLANNED_WORK_ITEM_REFS,
    workItemOutcomes: overrides.workItemOutcomes ?? [],
    groupOutcomes: overrides.groupOutcomes ?? [],
    acceptedRiskRecordRefs: [
      {
        kind: "standardized-risk-record",
        reference: versionRef("standardized-risk-record-c24-a", "v1"),
      },
    ],
    acceptedEventRefs: [{ kind: "domain-event", eventId: "event-c24-a", eventVersion: 1 }],
    auditTrailRef: AUDIT_TRAIL_REF,
    recordedAt: TIMESTAMP,
  });

const firstPlannedItem = PLANNED_WORK_ITEM_REFS[0];
const secondPlannedItem = PLANNED_WORK_ITEM_REFS[1];

describe("IP-10 输入快照：同一版本组合与确定性身份", () => {
  it("逐字段取自传入的准备快照、策略集与三个发布引用", () => {
    const set = policySet({
      retrievalPolicyRef: versionRef("retrieval-policy-c24", "v3"),
      modelDeploymentRef: versionRef("model-deployment-c24", "v9"),
    });
    const snapshot = resolveIdentificationInputSnapshot({
      ...validResolveInput(),
      policySet: set,
    });

    expect(IdentificationInputSnapshotV1Schema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.preparationSnapshotRef).toEqual(PREPARATION_SNAPSHOT_REF);
    expect(snapshot.processModelReleaseRef).toEqual({
      kind: "process-model-release",
      reference: PROCESS_MODEL_RELEASE,
    });
    expect(snapshot.riskMechanismReleaseRef).toEqual({
      kind: "risk-mechanism-release",
      reference: RISK_MECHANISM_RELEASE,
    });
    expect(snapshot.retrievalEvidenceBaseReleaseRef).toEqual({
      kind: "retrieval-evidence-base-release",
      reference: RETRIEVAL_EVIDENCE_BASE_RELEASE,
    });
    // 策略成员必须来自传入策略集，而不是任何内建默认值。
    expect(snapshot.identificationPolicySetRef).toEqual(set.policySetRef);
    expect(snapshot.retrievalPolicyRef).toEqual(set.retrievalPolicyRef);
    expect(snapshot.retrievalReviewAgentPolicyRef).toEqual(set.retrievalReviewAgentPolicyRef);
    expect(snapshot.repairPolicyRef).toEqual(set.repairPolicyRef);
    expect(snapshot.confidencePolicyRef).toEqual(set.confidencePolicyRef);
    expect(snapshot.forcedReviewPolicyRef).toEqual(set.forcedReviewPolicyRef);
    expect(snapshot.retryPolicyRef).toEqual(set.retryPolicyRef);
    expect(snapshot.modelDeploymentRef).toEqual(set.modelDeploymentRef);
    expect(snapshot.promptTemplateRef).toEqual(set.promptTemplateRef);
    expect(snapshot.authorizationContextRef).toEqual(AUTHORIZATION_CONTEXT_REF);
    expect(snapshot.auditTrailRef).toEqual(AUDIT_TRAIL_REF);
    expect(snapshot.createdBy).toBe(ACTOR);
    expect(snapshot.createdAt).toBe(TIMESTAMP);
  });

  it.each([
    { name: "同一输入重复解析得到相同身份", sameAsFrozen: true },
    { name: "不同准备快照得到不同身份", sameAsFrozen: false },
  ])("输入快照身份确定性：$name", ({ sameAsFrozen }) => {
    const preparationSnapshotRef = sameAsFrozen
      ? PREPARATION_SNAPSHOT_REF
      : OTHER_PREPARATION_SNAPSHOT_REF;
    const first = inputSnapshotRefFor(preparationSnapshotRef);
    const second = inputSnapshotRefFor(preparationSnapshotRef);

    expect(first.kind).toBe("identification-input-snapshot");
    expect(second).toEqual(first);
    if (sameAsFrozen) {
      expect(first).toEqual(inputSnapshotRefFor());
    } else {
      expect(first).not.toEqual(inputSnapshotRefFor());
    }
  });

  it.each([
    {
      name: "准备快照标识为空白",
      input: () => ({
        ...validResolveInput(),
        preparationSnapshotRef: BLANK_PREPARATION_SNAPSHOT_REF,
      }),
    },
    { name: "创建人为空", input: () => ({ ...validResolveInput(), createdBy: "   " }) },
    {
      name: "创建时间不是带偏移时刻",
      input: () => ({ ...validResolveInput(), createdAt: "2030-01-01" }),
    },
    {
      name: "策略成员版本为空白",
      input: () => ({
        ...validResolveInput(),
        policySet: {
          ...policySet(),
          promptTemplateRef: versionRef("prompt-template-c24", "   "),
        },
      }),
    },
  ])("结构不完整时抛错而不返回半快照：$name", ({ input }) => {
    expect(() => resolveIdentificationInputSnapshot(input())).toThrow();
  });
});

describe("IP-10 工作计划：覆盖、稳定排序与缺项阻断", () => {
  it("覆盖全部适用工序并按 nodeId 升序，排除项单独成列", () => {
    const result = buildIdentificationWorkPlan(planInput({}));

    expect(result).toEqual({
      kind: "ready",
      body: {
        schemaVersion: "1",
        projectId: PROJECT,
        workPlanRef: workPlanRefFor(),
        inputSnapshotRef: inputSnapshotRefFor(),
        inputSnapshot: inputSnapshot(),
        workItems: [
          {
            schemaVersion: "1",
            workItemRef: workItemRefFor(NODE_APPLICABLE_A),
            nodeId: NODE_APPLICABLE_A,
            spatialScopeRefs: preparationSnapshot().spatialScopeRefs,
            sourceVersionRefs: preparationSnapshot().sourceVersionRefs,
            sourceSegmentSetRefs: preparationSnapshot().includedSourceSegmentSetRefs,
            frozenQueryText: "查询依据-盾构始发",
          },
          {
            schemaVersion: "1",
            workItemRef: workItemRefFor(NODE_APPLICABLE_B),
            nodeId: NODE_APPLICABLE_B,
            spatialScopeRefs: preparationSnapshot().spatialScopeRefs,
            sourceVersionRefs: preparationSnapshot().sourceVersionRefs,
            sourceSegmentSetRefs: preparationSnapshot().includedSourceSegmentSetRefs,
            frozenQueryText: "查询依据-刀盘扩径",
          },
        ],
        excludedWorkItems: [{ nodeId: NODE_EXCLUDED, reasonCode: "NOT_APPLICABLE" }],
      },
    });
  });

  it("同一输入重复构建得到相同计划身份与相同工作项集合", () => {
    const first = buildIdentificationWorkPlan(planInput({}));
    const second = buildIdentificationWorkPlan(planInput({}));
    if (first.kind !== "ready" || second.kind !== "ready") return;

    expect(first.body.workPlanRef).toEqual(workPlanRefFor());
    expect(second.body).toEqual(first.body);
  });

  it("输入顺序不影响计划：乱序节点得到同一排序结果", () => {
    const reversed = buildIdentificationWorkPlan(planInput({ nodes: [...NODE_FACTS].reverse() }));
    const shuffled = buildIdentificationWorkPlan(
      planInput({ nodes: [NODE_FACTS[0]!, NODE_FACTS[2]!, NODE_FACTS[1]!] }),
    );
    if (reversed.kind !== "ready" || shuffled.kind !== "ready") return;

    const expectedNodeIds = [NODE_APPLICABLE_A, NODE_APPLICABLE_B];
    expect(reversed.body.workItems.map((item) => item.nodeId)).toEqual(expectedNodeIds);
    expect(shuffled.body.workItems.map((item) => item.nodeId)).toEqual(expectedNodeIds);
    expect(reversed.body.excludedWorkItems).toEqual([
      { nodeId: NODE_EXCLUDED, reasonCode: "NOT_APPLICABLE" },
    ]);
  });

  it.each([
    {
      name: "缺空间范围",
      patch: { preparationSnapshot: preparationSnapshot({ spatialScopeRefs: [] }) },
    },
    {
      name: "缺资料版本",
      patch: { preparationSnapshot: preparationSnapshot({ sourceVersionRefs: [] }) },
    },
    {
      name: "缺资料段集合",
      patch: { preparationSnapshot: preparationSnapshot({ includedSourceSegmentSetRefs: [] }) },
    },
    {
      name: "资料段集合与资料版本不一一对应",
      patch: {
        preparationSnapshot: preparationSnapshot({
          includedSourceSegmentSetRefs: [
            { kind: "source-segment-set", reference: versionRef("source-segment-set-c24-a") },
          ],
        }),
      },
    },
    {
      name: "缺冻结查询依据",
      patch: {
        nodes: [{ nodeId: NODE_APPLICABLE_A, applicable: true, frozenQueryText: "   " }],
      },
    },
    {
      name: "工序节点标识为空",
      patch: { nodes: [{ nodeId: "  ", applicable: true, frozenQueryText: "查询依据" }] },
    },
    {
      name: "同一工序节点重复",
      patch: {
        nodes: [
          { nodeId: NODE_APPLICABLE_A, applicable: true, frozenQueryText: "查询依据-一" },
          { nodeId: NODE_APPLICABLE_A, applicable: true, frozenQueryText: "查询依据-二" },
        ],
      },
    },
    {
      name: "没有任何适用工序",
      patch: { nodes: [{ nodeId: NODE_EXCLUDED, applicable: false, frozenQueryText: "" }] },
    },
    {
      name: "准备快照不是输入快照冻结的那一份",
      patch: { inputSnapshotRef: inputSnapshotRefFor(OTHER_PREPARATION_SNAPSHOT_REF) },
    },
  ])("计划不完整时整体阻断且不产生半计划：$name", ({ patch }) => {
    expect(buildIdentificationWorkPlan(planInput(patch))).toEqual({
      kind: "invalid",
      reasonCode: "WORK_PLAN_INVALID",
    });
  });
});

describe("IP-11 上游结果分类：稳定错误码与可重试性", () => {
  it.each([
    {
      name: "权限拒绝不可重试",
      stage: "I3" as const,
      upstream: { code: "AUTHORIZATION_DENIED", retryable: false },
      detailCode: "authorization-denied",
      expectedCode: "AUTHORIZATION_DENIED",
      expectedRetryable: false,
    },
    {
      name: "陈旧版本不可重试",
      stage: "I5" as const,
      upstream: { code: "STALE_VERSION", retryable: false },
      detailCode: "stale-version",
      expectedCode: "VERSION_CONFLICT",
      expectedRetryable: false,
    },
    {
      name: "幂等冲突不可重试",
      stage: "I8" as const,
      upstream: { code: "IDEMPOTENCY_CONFLICT", retryable: false },
      detailCode: "idempotency-conflict",
      expectedCode: "IDEMPOTENCY_CONFLICT",
      expectedRetryable: false,
    },
    {
      name: "检查点不一致不可重试（稳定 detailCode）",
      stage: "I2" as const,
      upstream: { code: "TERMINAL_FAILURE", retryable: false },
      detailCode: "checkpoint-inconsistent",
      expectedCode: "CHECKPOINT_INCONSISTENT",
      expectedRetryable: false,
    },
    {
      name: "检查点不一致不可重试（checkpointer 命名空间）",
      stage: "I2" as const,
      upstream: { code: "TERMINAL_FAILURE", retryable: false },
      detailCode: "checkpointer.reference",
      expectedCode: "CHECKPOINT_INCONSISTENT",
      expectedRetryable: false,
    },
    {
      name: "其它终止失败收口为契约失败",
      stage: "I5" as const,
      upstream: { code: "TERMINAL_FAILURE", retryable: false },
      detailCode: "candidate-validation-terminal",
      expectedCode: "CONTRACT_INVALID",
      expectedRetryable: false,
    },
    {
      name: "可重试技术错误按冻结策略重试",
      stage: "I3" as const,
      upstream: { code: "TRANSIENT_FAILURE", retryable: true },
      detailCode: "retrieval-gateway-unavailable",
      expectedCode: "RETRYABLE_INFRASTRUCTURE_FAILURE",
      expectedRetryable: true,
    },
    {
      name: "上游已封闭的瞬态失败不得再声明可重试",
      stage: "I3" as const,
      upstream: { code: "TRANSIENT_FAILURE", retryable: false },
      detailCode: "retrieval-gateway-unavailable",
      expectedCode: "CONTRACT_INVALID",
      expectedRetryable: false,
    },
    {
      name: "不支持契约收口为契约失败",
      stage: "I0" as const,
      upstream: { code: "UNSUPPORTED_CONTRACT", retryable: false },
      detailCode: "unsupported-contract",
      expectedCode: "CONTRACT_INVALID",
      expectedRetryable: false,
    },
    {
      name: "准备阶段实体缺失表达输入未就绪",
      stage: "I0" as const,
      upstream: { code: "ENTITY_NOT_FOUND", retryable: false },
      detailCode: "preparation-snapshot-missing",
      expectedCode: "INPUT_NOT_READY",
      expectedRetryable: false,
    },
    {
      name: "识别基础阶段实体缺失表达输入未就绪",
      stage: "I1" as const,
      upstream: { code: "ENTITY_NOT_FOUND", retryable: false },
      detailCode: "process-model-release-missing",
      expectedCode: "INPUT_NOT_READY",
      expectedRetryable: false,
    },
    {
      name: "后续阶段实体缺失收口为契约失败",
      stage: "I5" as const,
      upstream: { code: "ENTITY_NOT_FOUND", retryable: false },
      detailCode: "candidate-set-missing",
      expectedCode: "CONTRACT_INVALID",
      expectedRetryable: false,
    },
    {
      name: "I2 业务阻断表达工作计划无效",
      stage: "I2" as const,
      upstream: { code: "BUSINESS_BLOCKED", retryable: false },
      detailCode: "work-plan-incomplete",
      expectedCode: "WORK_PLAN_INVALID",
      expectedRetryable: false,
    },
    {
      name: "其它阶段业务阻断表达上游等待",
      stage: "I3" as const,
      upstream: { code: "BUSINESS_BLOCKED", retryable: false },
      detailCode: "agent-task-not-settled",
      expectedCode: "UPSTREAM_WAITING",
      expectedRetryable: false,
    },
    {
      name: "未知错误码收口为契约失败且不可重试",
      stage: "I3" as const,
      upstream: { code: "SOMETHING_ELSE", retryable: true },
      detailCode: "unknown-upstream-code",
      expectedCode: "CONTRACT_INVALID",
      expectedRetryable: false,
    },
  ])("$name", ({ stage, upstream, detailCode, expectedCode, expectedRetryable }) => {
    const error = classifyIdentificationGraphOutcome({
      stage,
      upstream,
      detailCode,
      occurredAt: TIMESTAMP,
    });

    expect(error.code).toBe(expectedCode);
    expect(error.retryable).toBe(expectedRetryable);
    expect(error.retryable).toBe(isRetryableIdentificationGraphError(error.code));
    expect(error.stage).toBe(stage);
    expect(error.detailCode).toBe(detailCode);
    expect(error.occurredAt).toBe(TIMESTAMP);
    expect(IDENTIFICATION_GRAPH_ERROR_CODES_V1).toContain(error.code);
  });
});

describe("IP-11 I9 汇总：工作项与分组终态", () => {
  it("已验收、拒绝、退回与失败混合时形成可解释的完整汇总", () => {
    const result = summarizeInput({
      workItemOutcomes: [
        { kind: "accepted", workItemRef: firstPlannedItem },
        { kind: "skipped", workItemRef: secondPlannedItem },
      ],
      groupOutcomes: [
        { kind: "accepted", groupRef: GROUP_REF },
        { kind: "rejected", groupRef: OTHER_GROUP_REF },
        { kind: "returned-upstream", groupRef: THIRD_GROUP_REF },
      ],
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;

    expect(result.runResult.skippedWorkItemRefs).toEqual([secondPlannedItem]);
    expect(result.runResult.failedWorkItemRefs).toEqual([]);
    expect(result.runResult.rejectedGroupRefs).toEqual([OTHER_GROUP_REF, THIRD_GROUP_REF]);
    expect(result.runResult.pendingReviewTaskRefs).toEqual([]);
    expect(result.runResult.skippedWorkItemRefs).toHaveLength(1);
    expect(result.runResult.rejectedGroupRefs).toHaveLength(2);
    expect(result.runResult.acceptedRiskRecordRefs).toHaveLength(1);
    expect(result.runResult.acceptedEventRefs).toHaveLength(1);
    expect(result.runResult.workPlanRef).toEqual(workPlanRefFor());
    expect(result.runResult.inputSnapshotRef).toEqual(inputSnapshotRefFor());
    expect(result.runResult.preparationSnapshotRef).toEqual(PREPARATION_SNAPSHOT_REF);
    expect(result.runResult.parentRiskFlowRunRef).toEqual(PARENT_RUN_REF);
    expect(result.runResult.recordedAt).toBe(TIMESTAMP);
  });

  it("失败工作项与失败分组分别记录：失败分组不并入拒绝", () => {
    const result = summarizeInput({
      workItemOutcomes: [
        { kind: "accepted", workItemRef: firstPlannedItem },
        { kind: "failed", workItemRef: secondPlannedItem },
      ],
      groupOutcomes: [
        { kind: "accepted", groupRef: GROUP_REF },
        { kind: "failed", groupRef: OTHER_GROUP_REF },
      ],
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;

    expect(result.runResult.failedWorkItemRefs).toEqual([secondPlannedItem]);
    expect(result.runResult.rejectedGroupRefs).toEqual([]);
    expect(result.runResult.skippedWorkItemRefs).toEqual([]);
  });

  it("全部工作项为正式零结果时逐项列明引用且不产生记录与事件", () => {
    const zeroRefA = zeroResultRefFor("node-a");
    const zeroRefB = zeroResultRefFor("node-b");
    const result = summarizeInput({
      workItemOutcomes: [
        { kind: "zero-result", workItemRef: firstPlannedItem, zeroResultRef: zeroRefA },
        { kind: "zero-result", workItemRef: secondPlannedItem, zeroResultRef: zeroRefB },
      ],
      groupOutcomes: [],
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;

    expect(result.runResult.zeroResults).toEqual([
      { workItemRef: firstPlannedItem, zeroResultRef: zeroRefA },
      { workItemRef: secondPlannedItem, zeroResultRef: zeroRefB },
    ]);
    expect(result.runResult.skippedWorkItemRefs).toEqual([]);
    expect(result.runResult.failedWorkItemRefs).toEqual([]);
  });

  it("零结果与已验收工作项并存时只列明零结果且不改写其它终态", () => {
    const zeroRefB = zeroResultRefFor("node-b");
    const result = summarizeInput({
      workItemOutcomes: [
        { kind: "accepted", workItemRef: firstPlannedItem },
        { kind: "zero-result", workItemRef: secondPlannedItem, zeroResultRef: zeroRefB },
      ],
      groupOutcomes: [{ kind: "accepted", groupRef: GROUP_REF }],
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;

    expect(result.runResult.zeroResults).toEqual([
      { workItemRef: secondPlannedItem, zeroResultRef: zeroRefB },
    ]);
    expect(result.runResult.skippedWorkItemRefs).toEqual([]);
    expect(result.runResult.failedWorkItemRefs).toEqual([]);
    expect(result.runResult.acceptedRiskRecordRefs).toHaveLength(1);
  });

  it("历史汇总正文缺少零结果字段时按空数组解析，不重写历史", () => {
    const historical = IdentificationGraphRunResultV1Schema.parse({
      schemaVersion: "1",
      projectId: PROJECT,
      runRef: RUN_REF,
      parentRiskFlowRunRef: PARENT_RUN_REF,
      preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
      inputSnapshotRef: inputSnapshotRefFor(),
      workPlanRef: workPlanRefFor(),
      acceptedRiskRecordRefs: [],
      acceptedEventRefs: [],
      rejectedGroupRefs: [],
      pendingReviewTaskRefs: [],
      failedWorkItemRefs: [],
      skippedWorkItemRefs: [],
      auditTrailRef: AUDIT_TRAIL_REF,
      recordedAt: TIMESTAMP,
    });

    expect(historical.zeroResults).toEqual([]);
  });

  it("存在待复核分组时保持 waiting 并给出精确复核任务，不生成完成结果", () => {
    const result = summarizeInput({
      workItemOutcomes: [
        { kind: "accepted", workItemRef: firstPlannedItem },
        { kind: "failed", workItemRef: secondPlannedItem },
      ],
      groupOutcomes: [
        { kind: "rejected", groupRef: GROUP_REF },
        { kind: "pending-review", groupRef: OTHER_GROUP_REF, reviewTaskRef: REVIEW_TASK_REF },
      ],
    });

    expect(result).toEqual({ kind: "waiting", pendingReviewTaskRefs: [REVIEW_TASK_REF] });
  });

  it.each([
    {
      name: "计划内工作项缺终态",
      plannedWorkItemRefs: PLANNED_WORK_ITEM_REFS,
      workItemOutcomes: [] as readonly IdentificationGraphWorkItemOutcomeV1[],
      expectedReasonCode: "WORK_ITEM_OUTCOME_MISSING",
    },
    {
      name: "终态引用计划外工作项",
      plannedWorkItemRefs: PLANNED_WORK_ITEM_REFS,
      workItemOutcomes: [
        { kind: "accepted", workItemRef: workItemRefFor("node-99-计划外") },
      ] as readonly IdentificationGraphWorkItemOutcomeV1[],
      expectedReasonCode: "WORK_ITEM_OUTCOME_INCONSISTENT",
    },
    {
      name: "同一工作项出现两个终态",
      plannedWorkItemRefs: PLANNED_WORK_ITEM_REFS,
      workItemOutcomes: [
        { kind: "accepted", workItemRef: firstPlannedItem },
        { kind: "failed", workItemRef: firstPlannedItem },
      ] as readonly IdentificationGraphWorkItemOutcomeV1[],
      expectedReasonCode: "WORK_ITEM_OUTCOME_INCONSISTENT",
    },
    {
      name: "计划为空",
      plannedWorkItemRefs: [] as readonly IdentificationWorkItemRefV1[],
      workItemOutcomes: [] as readonly IdentificationGraphWorkItemOutcomeV1[],
      expectedReasonCode: "WORK_ITEM_OUTCOME_INCONSISTENT",
    },
  ])(
    "$name 时阻断而不谎报完成或等待",
    ({ plannedWorkItemRefs, workItemOutcomes, expectedReasonCode }) => {
      const result = summarizeInput({
        plannedWorkItemRefs,
        workItemOutcomes,
        groupOutcomes: [
          { kind: "pending-review", groupRef: GROUP_REF, reviewTaskRef: REVIEW_TASK_REF },
        ],
      });

      expect(result).toEqual({ kind: "blocked", reasonCode: expectedReasonCode });
    },
  );
});

describe("IP-11 等待投影：C24 等待事实到 C02 WaitingRefV1", () => {
  it("知识准备等待投影为知识准备任务引用，且同一等待重复投影得到同一引用", () => {
    const waiting: IdentificationGraphWaitingV1 = {
      kind: "knowledge-preparation",
      preparationSnapshotRef: PREPARATION_SNAPSHOT_REF,
      reasonCode: "knowledge-release-not-effective",
    };
    const first = toWaitingRef({ waiting });
    const second = toWaitingRef({ waiting });

    expect(second).toEqual(first);
    expect(first.kind).toBe("knowledge-preparation");
    if (first.kind !== "knowledge-preparation") return;
    expect(first.knowledgePreparationTaskRef.reference.entityId).toBe(
      "knowledge-preparation-task:identification-preparation-c24",
    );
    expect(first.knowledgePreparationTaskRef.reference.versionId).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("人工复核等待直接透传精确复核任务引用", () => {
    const waiting: IdentificationGraphWaitingV1 = {
      kind: "human-review",
      reviewTaskRef: REVIEW_TASK_REF,
      groupRef: GROUP_REF,
    };

    expect(toWaitingRef({ waiting })).toEqual({ kind: "review", reviewTaskRef: REVIEW_TASK_REF });
  });

  it("检索审阅等待投影为 agent-task，并与 agent-task-completed 恢复原因成对", () => {
    const waiting: IdentificationGraphWaitingV1 = {
      kind: "retrieval-review-agent",
      agentTaskRef: AGENT_TASK_REF,
      workItemRef: firstPlannedItem,
      stage: "I3",
    };
    const projected = toWaitingRef({ waiting });

    expect(projected).toEqual({ kind: "agent-task", agentTaskRef: AGENT_TASK_REF });

    const resumeCause = ResumeCauseV1Schema.parse({
      kind: "agent-task-completed",
      agentTaskResultRef: {
        kind: "agent-task-result",
        reference: versionRef("retrieval-review-task-result-c24", "v1"),
        status: "completed",
        agentTaskRef: AGENT_TASK_REF,
        incrementRef: {
          kind: "retrieval-artifact-set",
          reference: versionRef("retrieval-artifact-set-c24", "v1"),
        },
      },
    });
    if (
      projected.kind !== "agent-task" ||
      resumeCause.kind !== "agent-task-completed" ||
      resumeCause.agentTaskResultRef.status !== "completed"
    ) {
      return;
    }
    // 同一任务引用即可复原该等待：等待投影与恢复原因指向同一个 Agent 任务身份。
    expect(projected.agentTaskRef.reference).toEqual(
      resumeCause.agentTaskResultRef.agentTaskRef.reference,
    );
  });

  it.each([
    {
      name: "等待引用形状（review）",
      waiting: { kind: "review", reviewTaskRef: REVIEW_TASK_REF },
    },
    {
      name: "等待引用形状（agent-task）",
      waiting: { kind: "agent-task", agentTaskRef: AGENT_TASK_REF },
    },
    { name: "未知等待种类", waiting: { kind: "user-confirmation" } },
  ])("等待种类与 C24 等待事实不一致时抛错：$name", ({ waiting }) => {
    expect(() =>
      toWaitingRef({ waiting: waiting as unknown as IdentificationGraphWaitingV1 }),
    ).toThrow();
  });
});
