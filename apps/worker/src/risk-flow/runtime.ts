/**
 * C30 父运行运行时（design D-02/D-07/D-08，IP-03/IP-06）。
 *
 * 实现公共 `WorkflowPortV1` 语义（`startRun`/`resumeRun`/`cancelRun`）并把公共命令映射到真实
 * LangGraph 父图：入口先复验 C06 当前授权与完整冻结引用，再派生稳定父子身份、登记命令回执与
 * 运行事实；恢复先按 `expectedStateVersion` 与精确等待/运行引用核对，再与 checkpoint 对账
 * （业务领先恰好一格且能由已登记阶段结果证明时只补一个增量，否则 `CHECKPOINT_INCONSISTENT`
 * 零补写）；取消是协作式的，只阻止未开始动作并保留全部已成立事实。
 */
import { GraphInterrupt, type LangGraphRunnableConfig } from "@langchain/langgraph";

import type { VersionReference } from "@riskflow/contracts/common";
import {
  CancelWorkflowRunCommandV1Schema,
  ModuleErrorV1Schema,
  ResumeWorkflowRunCommandV1Schema,
  StartWorkflowRunCommandV1Schema,
  type AuthorizationContextV1,
  type CancelWorkflowRunCommandV1,
  type ContractReferenceV1,
  type DiagnosticArtifactRefV1,
  type HumanDecisionProofPortV1,
  type IdentificationPreparationSnapshotRefV1,
  type ModuleBranchV1,
  type ModuleErrorV1,
  type MonitoringSnapshotRefV1,
  type ResumeCauseV1,
  type ResumeWorkflowRunCommandV1,
  type ResumeWorkflowRunResultV1,
  type CancelWorkflowRunResultV1,
  type ResponseRecommendationRefV1,
  type RouteDecisionRefV1,
  type SpatialScopeRefV1,
  type StandardizedRiskRecordRefV1,
  type StartWorkflowRunCommandV1,
  type StartWorkflowRunResultV1,
  type WaitingRefV1,
  type WorkflowEntryModeV1,
  type WorkflowPortV1,
  type WorkflowReassessmentInputV1,
  type WorkflowRunRefV1,
} from "@riskflow/contracts/ports";
import {
  RiskFlowGraphStateV1Schema,
  type RiskFlowGraphStateV1,
} from "@riskflow/contracts/workflows";
import { sha256CanonicalJson } from "@riskflow/core/persistence";
import {
  WorkflowGraphErrorV1Schema,
  classifyWorkflowGraphFailure,
  evaluateWorkflowEntryGate,
  reassessmentEntryFromStartPayloadV1,
  reconcileCheckpointReference,
  workflowEntryIdentityFor,
  workflowRunIdentityFor,
  type WorkflowGraphErrorCodeV1,
  type WorkflowGraphErrorV1,
  type WorkflowGraphResultRowV1,
  type WorkflowGraphRunStateV1,
  type WorkflowStartPayloadV1,
} from "@riskflow/core/workflow";

import {
  RISK_FLOW_GRAPH_RUN_CONFIG_KEY_V1,
  RISK_FLOW_ROUTE_KIND_HUMAN_DECISION_COMMITTED_V1,
  RISK_FLOW_ROUTE_KIND_RISK_ACCEPTED_V1,
  appendEntryFacts,
  identificationPreparationWaitingFor,
  parseRiskFlowGraphState,
  readRiskFlowCursor,
  readRiskFlowRows,
  recordRiskFlowCancellation,
  graphStateOf,
  frozenRefsFromRowsV1,
  identificationPreparationFromRowsV1,
  pairingsFromRowsV1,
  riskFlowGraphError,
  riskFlowStageOf,
  type RiskFlowAssessmentPairingV1,
  type RiskFlowGraphPortsV1,
  type RiskFlowGraphRunContextV1,
  type RiskFlowGraphRunnerV1,
  type RiskFlowResumeValueV1,
} from "./graph.js";

/** C05 授权接缝：按精确调用身份复验当前授权，撤销或范围不符即返回 `undefined`。 */
export interface RiskFlowGraphAuthorizationPortV1 {
  verifyCurrent(input: {
    readonly authorization: AuthorizationContextV1;
    readonly projectId: string;
    readonly actorId: string;
    readonly invocationId: string;
    readonly branch: ModuleBranchV1;
    readonly requestedAt: string;
  }): Promise<AuthorizationContextV1 | undefined>;
}

/** 运行时失败：只携带稳定 C30 错误与（可选的）重试时刻。 */
export class RiskFlowGraphRunErrorV1 extends Error {
  readonly error: WorkflowGraphErrorV1;
  readonly retryAt: string | undefined;

  constructor(error: WorkflowGraphErrorV1, retryAt?: string, cause?: unknown) {
    super(`${error.code}:${error.detailCode}`, cause === undefined ? undefined : { cause });
    this.name = "RiskFlowGraphRunErrorV1";
    this.error = error;
    this.retryAt = retryAt;
  }
}

const runFailure = (input: {
  readonly stage: RiskFlowGraphStateV1["stage"];
  readonly code: WorkflowGraphErrorCodeV1;
  readonly retryable: boolean;
  readonly detailCode: string;
  readonly occurredAt: string;
  readonly retryAt?: string;
}): RiskFlowGraphRunErrorV1 =>
  new RiskFlowGraphRunErrorV1(
    riskFlowGraphError({
      code: input.code,
      stage: input.stage,
      retryable: input.retryable,
      detailCode: input.detailCode,
      occurredAt: input.occurredAt,
    }),
    input.retryAt,
  );

/** 运行命令的闭合处置：`created`/`existing` 与取消回执，与公共结果逐项对应（design D-08）。 */
export type RiskFlowRunDispositionV1 =
  "created" | "existing" | "cancellation-recorded" | "already-cancelled";

export interface RiskFlowRunOutcomeV1 {
  readonly disposition: RiskFlowRunDispositionV1;
  readonly runRef: WorkflowRunRefV1;
  readonly runVersionId: string;
  readonly status: WorkflowGraphRunStateV1["status"];
  readonly stage: RiskFlowGraphStateV1["stage"];
  readonly assessmentRunRefs: readonly WorkflowRunRefV1[];
  readonly lastStageResultRef?: WorkflowGraphRunStateV1["lastStageResultRef"];
  readonly lastWaitingRef?: WorkflowGraphRunStateV1["lastWaitingRef"];
  readonly resultRef?: WorkflowGraphRunStateV1["resultRef"];
  readonly errorRef?: WorkflowGraphRunStateV1["lastErrorRef"];
}

/** 父运行入口命令：公共 `start-run` 载荷经门禁后的冻结输入与调用身份（design D-01）。 */
export interface RiskFlowStartCommandV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly authorization: AuthorizationContextV1;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
  readonly validAt: string;
  readonly graphVersion: VersionReference;
  readonly retryPolicyRef: VersionReference;
  readonly entryMode: WorkflowEntryModeV1;
  readonly entryIdentity: VersionReference;
  readonly frozenRefs: readonly ContractReferenceV1[];
  readonly pairing: readonly RiskFlowAssessmentPairingV1[];
  readonly primaryRiskRef?: ContractReferenceV1;
  /** 重评入口不可变事实（design D-12）；非重评不携带。 */
  readonly reassessmentEntry?: WorkflowReassessmentInputV1;
  readonly runRef: WorkflowRunRefV1;
  readonly threadId: string;
  /** 人工采纳等待意图（design D2）：只由公共 `forecast-response` 载荷的可选字段给出。 */
  readonly waitForDecision?: true;
  /** 等待模式下的精确建议引用：等待行据它复核采纳证明，不从其它入口推断。 */
  readonly adoptedRecommendationRef?: ResponseRecommendationRefV1;
}

/** 父运行恢复命令：只带精确运行引用、预期状态版本与恢复原因（design D-08）。 */
export interface RiskFlowResumeCommandV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly authorization: AuthorizationContextV1;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
  readonly validAt: string;
  readonly runRef: WorkflowRunRefV1;
  readonly expectedRunVersionId: string;
  readonly resumeCause: RiskFlowResumeValueV1;
}

/** 父运行取消命令：协作式，只阻止未开始动作（design D-08）。 */
export interface RiskFlowCancelCommandV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly authorization: AuthorizationContextV1;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
  readonly validAt: string;
  readonly runRef: WorkflowRunRefV1;
  readonly expectedRunVersionId: string;
  readonly reasonCode: string;
}

export interface RiskFlowGraphRuntimeOptionsV1 {
  readonly ports: RiskFlowGraphPortsV1;
  readonly graph: RiskFlowGraphRunnerV1;
  readonly authorization: RiskFlowGraphAuthorizationPortV1;
  /**
   * C41 人工采纳证明接缝（design D2/D3）：等待态运行只在该证明逐项核对运行、建议与空间一致后推进。
   * 必需注入（组合根缺失即拒绝构造）：缺失时绝不据恢复原因自行推进等待态运行。
   */
  readonly humanDecisionProof: HumanDecisionProofPortV1;
  readonly now: () => Date;
}

/** 父运行运行时：公共 `WorkflowPortV1` 语义 + 事件消费者复用的恢复入口。 */
export interface RiskFlowGraphRuntimeV1 {
  start(command: RiskFlowStartCommandV1): Promise<RiskFlowRunOutcomeV1>;
  resume(command: RiskFlowResumeCommandV1): Promise<RiskFlowRunOutcomeV1>;
  cancel(command: RiskFlowCancelCommandV1): Promise<RiskFlowRunOutcomeV1>;
  /**
   * `engineering.inputs-ready.v1` 入口：登记识别准备引用后把父运行恢复到识别阶段。
   * 同 `eventId` 重放命中同一事实，不新建第二次准备（design D-02）。
   */
  applyIdentificationPreparation(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly issuedAt: string;
    readonly runRef: WorkflowRunRefV1;
    readonly identificationPreparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
  }): Promise<RiskFlowRunOutcomeV1>;
  /**
   * `identification.risk-record-accepted.v1` 入口：登记已验收精确版本后恢复父运行，
   * 由识别/评估阶段按版本幂等建立唯一评估子运行（design D-02）。
   */
  applyAcceptedRisk(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly issuedAt: string;
    readonly runRef: WorkflowRunRefV1;
    readonly identificationRunRef: WorkflowRunRefV1;
    readonly riskRecordRef: StandardizedRiskRecordRefV1;
  }): Promise<RiskFlowRunOutcomeV1>;
  /** 公共端口适配：唯一对外工作流入口（design D-02）。 */
  readonly workflowPort: WorkflowPortV1;
}

/** 入口门禁的合格结果：逐空间配对、冻结引用与规范化监测序列（design D-01）。 */
interface RiskFlowEntryReadyV1 {
  readonly frozenRefs: readonly ContractReferenceV1[];
  readonly monitoringSnapshotRefs: readonly MonitoringSnapshotRefV1[];
  readonly assessmentContexts: readonly RiskFlowAssessmentPairingV1[];
}

const graphConfig = (run: RiskFlowGraphRunContextV1): LangGraphRunnableConfig => ({
  configurable: {
    thread_id: run.threadId,
    [RISK_FLOW_GRAPH_RUN_CONFIG_KEY_V1]: run,
  },
});

const invocationIdFor = (input: {
  readonly operation: string;
  readonly projectId: string;
  readonly targetId: string;
}): string => `c30-${input.operation}:${input.projectId}:${input.targetId}`;

/** checkpoint 状态读取：只读公开状态正文，绝不据 checkpoint 写业务事实（design D-08）。 */
const readCheckpointState = async (input: {
  readonly graph: RiskFlowGraphRunnerV1;
  readonly run: RiskFlowGraphRunContextV1;
}): Promise<RiskFlowGraphStateV1 | undefined> => {
  const snapshot = await input.graph.getState({ configurable: { thread_id: input.run.threadId } });
  if (typeof snapshot !== "object" || snapshot === null || !("values" in snapshot))
    return undefined;
  const values = (snapshot as { readonly values?: unknown }).values;
  if (typeof values !== "object" || values === null) return undefined;
  const declared = new Set(Object.keys(RiskFlowGraphStateV1Schema.shape));
  const record = Object.fromEntries(Object.entries(values).filter(([key]) => declared.has(key)));
  const parsed = RiskFlowGraphStateV1Schema.safeParse(record);
  return parsed.success ? parsed.data : undefined;
};

/**
 * 图调用结果 → 严格公共状态：只保留公共 Schema 声明的通道，忽略 LangGraph 的协议字段
 * （等待节点挂起时结果携带 `__interrupt__` 等调度信息，不是业务事实）。未知业务键仍由严格
 * Schema 拒绝，因此这里不放宽任何状态校验。
 */
const parseGraphResult = (value: unknown): unknown =>
  typeof value === "object" && value !== null
    ? Object.fromEntries(
        Object.entries(value).filter(([key]) =>
          Object.hasOwn(RiskFlowGraphStateV1Schema.shape, key),
        ),
      )
    : value;

/** 运行结果收口：稳定引用、状态与错误引用，不携带正文（design D-01）。 */
const outcomeOf = (input: {
  readonly cursor: WorkflowGraphRunStateV1;
  readonly state: RiskFlowGraphStateV1;
  readonly disposition: RiskFlowRunDispositionV1;
}): RiskFlowRunOutcomeV1 => ({
  disposition: input.disposition,
  runRef: input.state.runRef,
  runVersionId: input.cursor.runVersionId,
  status: input.state.status,
  stage: input.state.stage,
  assessmentRunRefs: input.cursor.assessmentRunRefs,
  ...(input.cursor.lastStageResultRef === undefined
    ? {}
    : { lastStageResultRef: input.cursor.lastStageResultRef }),
  ...(input.cursor.lastWaitingRef === undefined
    ? {}
    : { lastWaitingRef: input.cursor.lastWaitingRef }),
  ...(input.cursor.resultRef === undefined ? {} : { resultRef: input.cursor.resultRef }),
  ...(input.cursor.lastErrorRef === undefined ? {} : { errorRef: input.cursor.lastErrorRef }),
});

/**
 * 精确引用同一性：只有种类与两段引用都一致才算同一事实，不做版本回退或“最新”匹配；
 * `domain-event` 引用没有版本引用，与版本引用永不相等。
 */
const sameReference = (
  left: ContractReferenceV1,
  right: {
    readonly kind: string;
    readonly reference: { readonly entityId: string; readonly versionId: string };
  },
): boolean =>
  "reference" in left &&
  left.kind === right.kind &&
  left.reference.entityId === right.reference.entityId &&
  left.reference.versionId === right.reference.versionId;

/**
 * 人工决定等待门（design D2）：只有 `waitForDecision` 的 `forecast-response` 运行进入等待态。
 * 空间不猜测：只接受恰好一个已授权空间；入口模式或授权空间不支持时以类型化失败收口，
 * 不创建运行、不产生预测，也绝不沿用其它入口的语义。
 */
const humanDecisionGateFor = (input: {
  readonly command: RiskFlowStartCommandV1;
  readonly authorized: AuthorizationContextV1;
  readonly occurredAt: string;
}): RiskFlowGraphRunContextV1["humanDecisionGate"] => {
  if (input.command.waitForDecision !== true) return undefined;
  const spatialScopeRef =
    input.authorized.spatialScopeRefs.length === 1
      ? input.authorized.spatialScopeRefs[0]
      : undefined;
  const responseRecommendationRef = input.command.adoptedRecommendationRef;
  if (
    input.command.entryMode !== "forecast-response" ||
    spatialScopeRef === undefined ||
    responseRecommendationRef === undefined
  ) {
    throw runFailure({
      stage: "preparing",
      code: "ENTRY_REFERENCES_INCOMPLETE",
      retryable: false,
      detailCode: "wait-for-decision-unsupported",
      occurredAt: input.occurredAt,
    });
  }
  return { responseRecommendationRef, spatialScopeRef };
};

/**
 * 等待模式的冻结输入：把唯一已授权空间并入冻结引用（`forecast-response` 公共载荷没有空间字段，
 * 而评估子运行 A2 的绑定要求精确空间引用）。已存在同一空间引用时原样保留，绝不产生第二条。
 */
const frozenRefsWithSpatialScope = (input: {
  readonly frozenRefs: readonly ContractReferenceV1[];
  readonly spatialScopeRef: SpatialScopeRefV1;
}): readonly ContractReferenceV1[] =>
  input.frozenRefs.some((ref) => sameReference(ref, input.spatialScopeRef))
    ? input.frozenRefs
    : [...input.frozenRefs, input.spatialScopeRef];

/**
 * 恢复前核对精确等待/运行引用：引用不符即失败，绝不按“最新”推进（design D-08）。
 * 返回人工决定等待行（仅 `human-decision-committed` 恢复原因）：它是本次推进唯一被承认的等待事实。
 */
const assertResumeReferences = (input: {
  readonly rows: readonly WorkflowGraphResultRowV1[];
  readonly cursor: WorkflowGraphRunStateV1;
  readonly runRef: WorkflowRunRefV1;
  readonly cause: RiskFlowResumeValueV1;
  readonly occurredAt: string;
}): Extract<WaitingRefV1, { readonly kind: "human-decision" }> | undefined => {
  const blocked = (detailCode: string): never => {
    throw runFailure({
      stage: riskFlowStageOf(input.cursor.stage, input.occurredAt),
      code: "UPSTREAM_WAITING",
      retryable: false,
      detailCode,
      occurredAt: input.occurredAt,
    });
  };
  const humanDecisionWaitings = input.rows.filter(
    (row) => row.resultKind === "waiting" && row.waitingRef?.kind === "human-decision",
  );
  if (input.cause.kind === "human-decision-committed") {
    // 等待态运行只认同一次已登记的人工决定路由：必须恰好一条等待行、其决定路由引用与恢复原因一致，
    // 且运行仍处等待态，否则保持等待（design D2）。
    const pending =
      humanDecisionWaitings.length === 1 ? humanDecisionWaitings[0]?.waitingRef : undefined;
    const matched = pending?.kind === "human-decision" ? pending : undefined;
    const accepted =
      matched !== undefined &&
      sameReference(matched.routeDecisionRef, input.cause.routeDecisionRef) &&
      input.cursor.status === "waiting";
    if (!accepted) blocked("human-decision-reference-mismatch");
    return matched;
  }
  if (humanDecisionWaitings.length > 0 && input.cursor.status === "waiting") {
    // 人工采纳事实成立前，等待中的预测运行不接受任何其它恢复原因（design D2）。
    blocked("human-decision-pending");
  }
  switch (input.cause.kind) {
    case "inputs-ready": {
      const expected = identificationPreparationWaitingFor({ runRef: input.runRef });
      const matched = input.rows.some(
        (row) =>
          row.resultKind === "waiting" &&
          row.waitingRef?.kind === "knowledge-preparation" &&
          row.waitingRef.knowledgePreparationTaskRef.reference.entityId ===
            expected.knowledgePreparationTaskRef.reference.entityId,
      );
      if (!matched) blocked("waiting-reference-mismatch");
      return;
    }
    case "transient-recovered":
      if (input.cursor.status !== "retryable-failure") blocked("not-a-retryable-failure");
      return;
    case "risk-record-accepted": {
      const related = input.cause.identificationRunRef;
      if (input.cursor.identificationRunRef?.reference.entityId !== related.reference.entityId) {
        blocked("run-reference-mismatch");
      }
      return;
    }
    case "reevaluate": {
      const related = input.cause.relatedRunRef;
      if (related === undefined) return;
      const matched =
        input.cursor.identificationRunRef?.reference.entityId === related.reference.entityId ||
        input.cursor.assessmentRunRefs.some(
          (ref) =>
            ref.reference.entityId === related.reference.entityId &&
            ref.reference.versionId === related.reference.versionId,
        );
      if (!matched) blocked("run-reference-mismatch");
      return;
    }
    default:
      return;
  }
};

/** 业务提交是否由已登记阶段结果证明：无法证明时检查点对账按不一致收口（design D-08）。 */
const businessAheadIsProvable = (input: {
  readonly cursor: WorkflowGraphRunStateV1;
  readonly rows: readonly WorkflowGraphResultRowV1[];
}): boolean => {
  const stageResultRef = input.cursor.lastStageResultRef;
  if (stageResultRef === undefined) return false;
  return input.rows.some(
    (row) =>
      row.resultKind === "stage-result" &&
      row.stageResultRef?.reference.entityId === stageResultRef.reference.entityId &&
      row.stageResultRef.reference.versionId === stageResultRef.reference.versionId,
  );
};

/** C30 稳定错误 → 公共 `ModuleErrorV1`：只披露稳定码、阶段与诊断引用，不含正文（design D-07）。 */
const moduleErrorFor = (input: {
  readonly error: WorkflowGraphErrorV1;
  readonly authorization: AuthorizationContextV1;
  readonly runRef: WorkflowRunRefV1;
  readonly idempotencyKey: string;
  readonly attempt: number;
  readonly retryPolicyRef: VersionReference;
}): ModuleErrorV1 => {
  const common = {
    stageCode: input.error.stage,
    occurredAt: input.error.occurredAt,
    causalRunId: input.runRef.reference.entityId,
  };
  const diagnosticRef: DiagnosticArtifactRefV1 = {
    kind: "diagnostic-artifact",
    reference: {
      entityId: `workflow-graph-error:${input.error.detailCode}`,
      versionId: sha256CanonicalJson(input.error),
    },
  };
  const requiredCapability = input.authorization.grantedCapabilities[0] ?? "workflow.start";
  switch (input.error.code) {
    case "AUTHORIZATION_DENIED":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "AUTHORIZATION_DENIED",
        category: "authorization",
        retryable: false,
        requiredCapability,
        authorizationPolicyRef: input.authorization.authorizationPolicyRef,
      });
    case "RUN_NOT_FOUND":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "ENTITY_NOT_FOUND",
        category: "not-found",
        retryable: false,
        targetRef: input.runRef,
      });
    case "VERSION_CONFLICT":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "STALE_VERSION",
        category: "concurrency",
        retryable: false,
        targetRef: input.runRef,
      });
    case "IDEMPOTENCY_CONFLICT":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "IDEMPOTENCY_CONFLICT",
        category: "idempotency",
        retryable: false,
        idempotencyKey: input.idempotencyKey,
        priorCommandId: input.error.detailCode,
      });
    case "RETRYABLE_INFRASTRUCTURE_FAILURE":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "TRANSIENT_FAILURE",
        category: "technical",
        retryable: true,
        attempt: input.attempt,
        retryPolicyRef: input.retryPolicyRef,
        diagnosticRef,
      });
    case "ENTRY_REFERENCES_INCOMPLETE":
    case "UPSTREAM_WAITING":
    case "CANCELLED":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "BUSINESS_BLOCKED",
        category: "business-blocked",
        retryable: false,
        blockerKind: input.error.detailCode,
        blockerRef: input.runRef,
      });
    default:
      return ModuleErrorV1Schema.parse({
        ...common,
        code: "TERMINAL_FAILURE",
        category: "technical",
        retryable: false,
        diagnosticRef,
      });
  }
};

/** 公共 `start-run` 载荷 → 逐空间配对：识别入口逐空间配对，其它入口只有唯一冻结空间。 */
const pairingsOfPayload = (input: {
  readonly payload: WorkflowStartPayloadV1;
  readonly gate: RiskFlowEntryReadyV1;
}): readonly RiskFlowAssessmentPairingV1[] => {
  if (input.payload.entryMode === "identify-and-assess") return input.gate.assessmentContexts;
  // 分段入口没有逐空间配对：冻结引用已由门禁证明，父运行不建入口快照行（design D-01/D-04）。
  if (
    input.payload.entryMode === "forecast-response" ||
    input.payload.entryMode === "record-response-feedback"
  ) {
    return [];
  }
  const spatialScopeRef = input.payload.spatialScopeRef;
  const applicabilityMetadataSnapshotRef = input.payload.applicabilityMetadataSnapshotRef;
  if (spatialScopeRef === undefined || applicabilityMetadataSnapshotRef === undefined) {
    // 门禁已证明这三项完备；此处缺失只能是调用方在门禁之后改写了载荷。
    throw new TypeError("risk-flow entry payload lacks the frozen spatial pairing");
  }
  const monitoring = input.gate.monitoringSnapshotRefs;
  return [
    {
      spatialScopeRef,
      applicabilityMetadataSnapshotRef,
      ...(monitoring.length === 0 ? {} : { monitoringSnapshotRefs: monitoring }),
    },
  ];
};

/** 公共载荷的冻结风险输入：只取显式风险输入字段，不从其它入口推断（design D-01）。 */
const primaryRiskRefOfPayload = (
  payload: WorkflowStartPayloadV1,
): ContractReferenceV1 | undefined => {
  switch (payload.entryMode) {
    case "assess":
    case "reassess":
    case "historical-backfill":
      return payload.riskInput;
    default:
      return undefined;
  }
};

/** 公共恢复原因 → 父图恢复值：只映射稳定引用，未知原因按“条件变化后重判”收口（design D-08）。 */
const resumeValueOfCause = (cause: ResumeCauseV1): RiskFlowResumeValueV1 => {
  switch (cause.kind) {
    case "knowledge-ready":
      return {
        kind: "inputs-ready",
        knowledgePreparationTaskRef: cause.knowledgePreparationTaskRef,
      };
    case "human-decision-committed":
      // 只映射稳定决定引用：运行、建议与空间由 C41 精确采纳证明核对，父图不自行取用（design D2）。
      return { kind: "human-decision-committed", routeDecisionRef: cause.routeDecisionRef };
    case "transient-recovered":
      return { kind: "transient-recovered" };
    default:
      return { kind: "reevaluate", reasonCode: cause.kind };
  }
};

/** 公共入口门禁未通过 → 类型化公共失败（design D-01/D-07）。 */
const gateFailure = (input: {
  readonly detailCode: string;
  readonly projectId: string;
}): ModuleErrorV1 => {
  const runRef: WorkflowRunRefV1 = {
    kind: "workflow-run",
    reference: {
      entityId: `risk-flow-run-entry:${input.projectId}`,
      versionId: sha256CanonicalJson(input.detailCode),
    },
  };
  return ModuleErrorV1Schema.parse({
    code: "BUSINESS_BLOCKED",
    category: "business-blocked",
    retryable: false,
    blockerKind: input.detailCode,
    blockerRef: runRef,
    stageCode: "entry-gate",
    occurredAt: new Date().toISOString(),
    causalRunId: runRef.reference.entityId,
  });
};

/** 运行时失败解包：非运行时失败按可重试技术错误收口，绝不静默成功（design D-07）。 */
const requireRunError = (error: unknown, occurredAt: string): WorkflowGraphErrorV1 =>
  error instanceof RiskFlowGraphRunErrorV1
    ? error.error
    : classifyWorkflowGraphFailure({
        stage: "preparing",
        upstream: { code: "TRANSACTION_FAILED", retryable: true },
        detailCode: "unclassified-failure",
        occurredAt,
      });

export const createRiskFlowGraphRuntime = (
  options: RiskFlowGraphRuntimeOptionsV1,
): RiskFlowGraphRuntimeV1 => {
  const { ports } = options;

  /**
   * 只用于“先按运行身份找到已登记事实”的占位上下文：入口模式、冻结引用与线程都要由已登记行
   * 重建，绝不在这里猜测（design D-08）。
   */
  const provisionalRunContext = (input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly issuedAt: string;
    readonly validAt: string;
    readonly runRef: WorkflowRunRefV1;
  }): RiskFlowGraphRunContextV1 => ({
    projectId: input.projectId,
    actorId: input.actorId,
    authorization: input.authorization,
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    issuedAt: input.issuedAt,
    validAt: input.validAt,
    entryRecordedAt: input.issuedAt,
    runRef: input.runRef,
    threadId: "risk-flow-run-thread:unregistered",
    entryMode: "assess",
    entryIdentity: { entityId: "unregistered", versionId: "unregistered" },
    frozenRefs: [],
    pairing: [],
    retryPolicyRef: ports.retryPolicyRef,
    subGraphVersions: ports.subGraphVersions,
  });

  const verifyCurrent = async (input: {
    readonly authorization: AuthorizationContextV1;
    readonly projectId: string;
    readonly actorId: string;
    readonly operation: string;
    readonly targetId: string;
    readonly branch: ModuleBranchV1;
    readonly requestedAt: string;
    readonly stage: RiskFlowGraphStateV1["stage"];
  }): Promise<AuthorizationContextV1> => {
    const authorized = await options.authorization.verifyCurrent({
      authorization: input.authorization,
      projectId: input.projectId,
      actorId: input.actorId,
      invocationId: invocationIdFor({
        operation: input.operation,
        projectId: input.projectId,
        targetId: input.targetId,
      }),
      branch: input.branch,
      requestedAt: input.requestedAt,
    });
    if (authorized === undefined) {
      throw runFailure({
        stage: input.stage,
        code: "AUTHORIZATION_DENIED",
        retryable: false,
        detailCode: "authorization_denied",
        occurredAt: options.now().toISOString(),
      });
    }
    return authorized;
  };

  const runGraph = async (input: {
    readonly run: RiskFlowGraphRunContextV1;
    readonly invocation:
      | { readonly kind: "start"; readonly state: RiskFlowGraphStateV1 }
      | { readonly kind: "resume"; readonly resumeValue: RiskFlowResumeValueV1 }
      | { readonly kind: "retry"; readonly state: RiskFlowGraphStateV1 }
      | {
          readonly kind: "recover";
          readonly state: RiskFlowGraphStateV1;
          readonly completedNode: RiskFlowGraphStateV1["stage"];
        };
    readonly stage: RiskFlowGraphStateV1["stage"];
  }): Promise<RiskFlowGraphStateV1> => {
    try {
      const result =
        input.invocation.kind === "start"
          ? await options.graph.invoke({ graph: input.invocation.state }, graphConfig(input.run))
          : input.invocation.kind === "resume"
            ? await options.graph.resume(
                { resume: input.invocation.resumeValue },
                graphConfig(input.run),
              )
            : input.invocation.kind === "retry"
              ? await options.graph.retry(input.invocation.state, graphConfig(input.run))
              : await options.graph.recover(
                  input.invocation.state,
                  input.invocation.completedNode,
                  graphConfig(input.run),
                );
      return parseRiskFlowGraphState(parseGraphResult(result), options.now().toISOString());
    } catch (error: unknown) {
      if (error instanceof GraphInterrupt) {
        // 等待节点挂起：图状态已落 checkpoint，业务状态仍以登记行为准（design D-08）。
        const cursor = await readRiskFlowCursor({ ports, run: input.run });
        if (cursor === undefined) {
          throw runFailure({
            stage: input.stage,
            code: "CONTRACT_INVALID",
            retryable: false,
            detailCode: "run-cursor-missing",
            occurredAt: options.now().toISOString(),
          });
        }
        return graphStateOf(input.run, cursor);
      }
      if (error instanceof Error && error.name === "RiskFlowGraphNodeFailureV1") {
        const typed = (error as { readonly error?: unknown }).error;
        if (typed !== undefined) {
          throw new RiskFlowGraphRunErrorV1(WorkflowGraphErrorV1Schema.parse(typed));
        }
      }
      throw new RiskFlowGraphRunErrorV1(
        classifyWorkflowGraphFailure({
          stage: input.stage,
          upstream: { code: "TRANSIENT_FAILURE", retryable: true },
          detailCode: "graph-invocation-failed",
          occurredAt: options.now().toISOString(),
        }),
        undefined,
        error,
      );
    }
  };

  const start = async (command: RiskFlowStartCommandV1): Promise<RiskFlowRunOutcomeV1> => {
    const authorized = await verifyCurrent({
      authorization: command.authorization,
      projectId: command.projectId,
      actorId: command.actorId,
      operation: "workflow-start",
      targetId: command.commandId,
      branch: "workflow.start-run",
      requestedAt: command.validAt,
      stage: "preparing",
    });
    const humanDecisionGate = humanDecisionGateFor({
      command,
      authorized,
      occurredAt: options.now().toISOString(),
    });
    const run: RiskFlowGraphRunContextV1 = {
      projectId: command.projectId,
      actorId: command.actorId,
      authorization: authorized,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      issuedAt: command.issuedAt,
      validAt: command.validAt,
      entryRecordedAt: command.issuedAt,
      runRef: command.runRef,
      threadId: command.threadId,
      entryMode: command.entryMode,
      entryIdentity: command.entryIdentity,
      // 等待模式并入唯一已授权空间（A2 绑定需要精确空间）；其余入口的冻结集合一字不改。
      frozenRefs:
        humanDecisionGate === undefined
          ? command.frozenRefs
          : frozenRefsWithSpatialScope({
              frozenRefs: command.frozenRefs,
              spatialScopeRef: humanDecisionGate.spatialScopeRef,
            }),
      pairing: command.pairing,
      retryPolicyRef: command.retryPolicyRef,
      subGraphVersions: ports.subGraphVersions,
      ...(command.primaryRiskRef === undefined ? {} : { primaryRiskRef: command.primaryRiskRef }),
      ...(command.reassessmentEntry === undefined
        ? {}
        : { reassessmentEntry: command.reassessmentEntry }),
      ...(humanDecisionGate === undefined ? {} : { humanDecisionGate }),
    };
    const existing = await readRiskFlowCursor({ ports, run });
    if (existing !== undefined) {
      // 已存在的运行：返回既有事实，不重复任何业务动作（design D-08）。
      return outcomeOf({
        cursor: existing,
        state: graphStateOf(run, existing),
        disposition: "existing",
      });
    }
    const initialState = RiskFlowGraphStateV1Schema.parse({
      schemaVersion: "1",
      graphVersion: command.graphVersion,
      runRef: command.runRef,
      threadId: command.threadId,
      entryMode: command.entryMode,
      authorizationContextRef: authorized.authorizationContextRef,
      status: "running",
      stage: "preparing",
      assessmentRunRefs: [],
      waitingRefs: [],
    });
    const state = await runGraph({
      run,
      invocation: { kind: "start", state: initialState },
      stage: "preparing",
    });
    const cursor = await readRiskFlowCursor({ ports, run });
    if (cursor === undefined) {
      throw runFailure({
        stage: state.stage,
        code: "RETRYABLE_INFRASTRUCTURE_FAILURE",
        retryable: true,
        detailCode: "run-state-unconfirmed",
        occurredAt: options.now().toISOString(),
      });
    }
    return outcomeOf({ cursor, state, disposition: "created" });
  };

  const resume = async (command: RiskFlowResumeCommandV1): Promise<RiskFlowRunOutcomeV1> => {
    const provisional = provisionalRunContext({
      projectId: command.projectId,
      actorId: command.actorId,
      authorization: command.authorization,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      issuedAt: command.issuedAt,
      validAt: command.validAt,
      runRef: command.runRef,
    });
    const cursorBefore = await readRiskFlowCursor({ ports, run: provisional });
    if (cursorBefore === undefined) {
      throw runFailure({
        stage: "preparing",
        code: "RUN_NOT_FOUND",
        retryable: false,
        detailCode: "entity_not_found",
        occurredAt: options.now().toISOString(),
      });
    }
    const resumeStage = riskFlowStageOf(cursorBefore.stage, options.now().toISOString());
    const authorized = await verifyCurrent({
      authorization: command.authorization,
      projectId: command.projectId,
      actorId: command.actorId,
      operation: "workflow-resume",
      targetId: command.commandId,
      branch: "workflow.resume-run",
      requestedAt: command.validAt,
      stage: resumeStage,
    });
    const rows = await readRiskFlowRows({ ports, run: provisional });
    const threadId = rows.find((row) => row.threadId !== undefined)?.threadId;
    if (threadId === undefined) {
      throw runFailure({
        stage: resumeStage,
        code: "CONTRACT_INVALID",
        retryable: false,
        detailCode: "run-thread-missing",
        occurredAt: options.now().toISOString(),
      });
    }
    const frozenRefs = frozenRefsFromRowsV1(rows);
    const preparation = identificationPreparationFromRowsV1(rows);
    const resumePreparation =
      command.resumeCause.kind === "inputs-ready"
        ? command.resumeCause.identificationPreparationSnapshotRef
        : undefined;
    const primaryRiskRef = frozenRefs.find(
      (ref) => ref.kind === "standardized-risk-record" || ref.kind === "external-risk-event",
    );
    const run: RiskFlowGraphRunContextV1 = {
      ...provisional,
      authorization: authorized,
      entryRecordedAt: cursorBefore.recordedAt,
      threadId,
      entryMode: cursorBefore.entryMode,
      entryIdentity: cursorBefore.entryIdentity,
      frozenRefs,
      pairing: pairingsFromRowsV1(rows),
      ...(primaryRiskRef === undefined ? {} : { primaryRiskRef }),
      ...(resumePreparation === undefined
        ? preparation === undefined
          ? {}
          : { identificationPreparationSnapshotRef: preparation }
        : { identificationPreparationSnapshotRef: resumePreparation }),
    };
    if (cursorBefore.status === "cancelled") {
      // 已取消的运行不再推进，也不新建任何动作（design D-08）。
      return outcomeOf({
        cursor: cursorBefore,
        state: graphStateOf(run, cursorBefore),
        disposition: "already-cancelled",
      });
    }
    if (cursorBefore.runVersionId !== command.expectedRunVersionId) {
      throw runFailure({
        stage: resumeStage,
        code: "VERSION_CONFLICT",
        retryable: false,
        detailCode: "stale_version",
        occurredAt: options.now().toISOString(),
      });
    }
    const pendingHumanDecision = assertResumeReferences({
      rows,
      cursor: cursorBefore,
      runRef: command.runRef,
      cause: command.resumeCause,
      occurredAt: options.now().toISOString(),
    });
    const pendingDecisionRef =
      command.resumeCause.kind === "human-decision-committed"
        ? command.resumeCause.routeDecisionRef
        : undefined;
    if (
      pendingDecisionRef !== undefined &&
      pendingHumanDecision !== undefined &&
      !run.frozenRefs.some((ref) => sameReference(ref, pendingDecisionRef))
    ) {
      // 等待态运行推进前必须由 C41 精确采纳证明逐项核对运行、建议与空间（design D2/D3）：
      // 证明缺失、失败或任一引用不符即保持等待，绝不据恢复原因自行推进或产生预测。
      const committed = await options.humanDecisionProof.verifyHumanDecisionCommitted({
        kind: "verify-human-decision-committed",
        // C41 以该恢复命令自身身份签发 C30 恢复授权，证明内部按同一 `queryId` 复验。
        queryId: command.commandId,
        projectId: command.projectId,
        actorId: command.actorId,
        requestedAt: command.issuedAt,
        authorization: authorized,
        payload: {
          routeDecisionRef: pendingDecisionRef,
          workflowRunRef: command.runRef,
          responseRecommendationRef: pendingHumanDecision.responseRecommendationRef,
        },
      });
      const adopted =
        committed.kind === "succeeded" &&
        committed.result.kind === "adopted" &&
        sameReference(committed.result.routeDecisionRef, pendingDecisionRef) &&
        sameReference(committed.result.workflowRunRef, command.runRef) &&
        sameReference(
          committed.result.responseRecommendationRef,
          pendingHumanDecision.responseRecommendationRef,
        ) &&
        authorized.spatialScopeRefs.some((scope) =>
          sameReference(scope, committed.result.spatialScopeRef),
        );
      if (!adopted) {
        throw runFailure({
          stage: resumeStage,
          code: "UPSTREAM_WAITING",
          retryable: false,
          detailCode: "human-decision-not-committed",
          occurredAt: options.now().toISOString(),
        });
      }
      // 已证实的决定引用进入本运行冻结事实：评估子运行据此取精确采纳决定引用（design D2）。
      const runWithDecision: RiskFlowGraphRunContextV1 = {
        ...run,
        frozenRefs: frozenRefsFromRowsV1(rows, [pendingDecisionRef]),
      };
      // 决定引用本身就是本运行创建时登记的入口路由引用（等待行据它请求采纳证明），因此这里登记
      // 一条身份独立的路由行来承载冻结事实与原因码，绝不重复登记同一路由引用（那是同一事实）。
      const committedRouteRef: RouteDecisionRefV1 = {
        kind: "route-decision",
        reference: {
          entityId: `risk-flow-human-decision:${command.runRef.reference.entityId}`,
          versionId: sha256CanonicalJson({
            decisionRef: pendingDecisionRef,
            runRef: command.runRef,
          }),
        },
      };
      await appendEntryFacts({
        ports,
        run: runWithDecision,
        cursor: cursorBefore,
        stage: resumeStage,
        actionSuffix: `human-decision-committed:${sha256CanonicalJson(pendingDecisionRef).slice(0, 32)}`,
        commandKind: "risk-flow-graph.human-decision-committed",
        routeDecisions: [
          {
            ref: committedRouteRef,
            routeKind: RISK_FLOW_ROUTE_KIND_HUMAN_DECISION_COMMITTED_V1,
          },
        ],
      });
      const afterFacts = await readRiskFlowCursor({ ports, run: runWithDecision });
      if (afterFacts === undefined) {
        throw runFailure({
          stage: resumeStage,
          code: "RETRYABLE_INFRASTRUCTURE_FAILURE",
          retryable: true,
          detailCode: "run-state-unconfirmed",
          occurredAt: options.now().toISOString(),
        });
      }
      // 决定引用已登记：按既有恢复语义推进（等待节点消费该恢复原因，评估子运行只建立一次）。
      return await resume({ ...command, expectedRunVersionId: afterFacts.runVersionId });
    }
    const checkpointState = await readCheckpointState({ graph: options.graph, run });
    if (checkpointState === undefined) {
      throw runFailure({
        stage: resumeStage,
        code: "RETRYABLE_INFRASTRUCTURE_FAILURE",
        retryable: true,
        detailCode: "checkpoint-unavailable",
        occurredAt: options.now().toISOString(),
      });
    }
    const reconciliation = reconcileCheckpointReference({
      checkpointStage: checkpointState.stage,
      registeredStage: cursorBefore.stage,
    });
    const provable =
      reconciliation === "business-ahead" &&
      businessAheadIsProvable({ cursor: cursorBefore, rows });
    if (
      reconciliation === "inconsistent" ||
      reconciliation === "checkpoint-ahead" ||
      (reconciliation === "business-ahead" && !provable)
    ) {
      // 检查点指向已登记事实无法证明的位置：零补写封闭（design D-08）。
      throw runFailure({
        stage: resumeStage,
        code: "CHECKPOINT_INCONSISTENT",
        retryable: false,
        detailCode: "checkpoint-inconsistent",
        occurredAt: options.now().toISOString(),
      });
    }
    const state = await runGraph({
      run,
      invocation:
        command.resumeCause.kind === "transient-recovered"
          ? { kind: "retry", state: checkpointState }
          : provable
            ? { kind: "recover", state: checkpointState, completedNode: checkpointState.stage }
            : { kind: "resume", resumeValue: command.resumeCause },
      stage: cursorBefore.status === "waiting" ? resumeStage : checkpointState.stage,
    });
    const cursor = await readRiskFlowCursor({ ports, run });
    if (cursor === undefined) {
      throw runFailure({
        stage: state.stage,
        code: "RETRYABLE_INFRASTRUCTURE_FAILURE",
        retryable: true,
        detailCode: "run-state-unconfirmed",
        occurredAt: options.now().toISOString(),
      });
    }
    return outcomeOf({ cursor, state, disposition: "existing" });
  };

  const cancel = async (command: RiskFlowCancelCommandV1): Promise<RiskFlowRunOutcomeV1> => {
    const provisional = provisionalRunContext({
      projectId: command.projectId,
      actorId: command.actorId,
      authorization: command.authorization,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      issuedAt: command.issuedAt,
      validAt: command.validAt,
      runRef: command.runRef,
    });
    const cursor = await readRiskFlowCursor({ ports, run: provisional });
    if (cursor === undefined) {
      throw runFailure({
        stage: "preparing",
        code: "RUN_NOT_FOUND",
        retryable: false,
        detailCode: "entity_not_found",
        occurredAt: options.now().toISOString(),
      });
    }
    const cancelStage = riskFlowStageOf(cursor.stage, options.now().toISOString());
    const authorized = await verifyCurrent({
      authorization: command.authorization,
      projectId: command.projectId,
      actorId: command.actorId,
      operation: "workflow-cancel",
      targetId: command.commandId,
      branch: "workflow.cancel-run",
      requestedAt: command.validAt,
      stage: cancelStage,
    });
    const rows = await readRiskFlowRows({ ports, run: provisional });
    const threadId = rows.find((row) => row.threadId !== undefined)?.threadId;
    if (threadId === undefined) {
      throw runFailure({
        stage: cancelStage,
        code: "CONTRACT_INVALID",
        retryable: false,
        detailCode: "run-thread-missing",
        occurredAt: options.now().toISOString(),
      });
    }
    const run: RiskFlowGraphRunContextV1 = {
      ...provisional,
      authorization: authorized,
      entryRecordedAt: cursor.recordedAt,
      threadId,
      entryMode: cursor.entryMode,
      entryIdentity: cursor.entryIdentity,
      frozenRefs: frozenRefsFromRowsV1(rows),
      pairing: pairingsFromRowsV1(rows),
    };
    if (cursor.status === "cancelled") {
      return outcomeOf({
        cursor,
        state: graphStateOf(run, cursor),
        disposition: "already-cancelled",
      });
    }
    if (cursor.status === "completed" || cursor.status === "terminal-failure") {
      throw runFailure({
        stage: cancelStage,
        code: "RUN_TERMINATED",
        retryable: false,
        detailCode: "run-already-terminal",
        occurredAt: options.now().toISOString(),
      });
    }
    if (cursor.runVersionId !== command.expectedRunVersionId) {
      throw runFailure({
        stage: cancelStage,
        code: "VERSION_CONFLICT",
        retryable: false,
        detailCode: "stale_version",
        occurredAt: options.now().toISOString(),
      });
    }
    const cancellationRef: RouteDecisionRefV1 = {
      kind: "route-decision",
      reference: {
        entityId: `risk-flow-cancellation:${cursor.runId}`,
        versionId: sha256CanonicalJson({
          reasonCode: command.reasonCode,
          runVersionId: cursor.runVersionId,
        }),
      },
    };
    await recordRiskFlowCancellation({
      ports,
      run,
      cursor,
      cancellationRef,
      reasonCode: command.reasonCode,
    });
    const cancelled = await readRiskFlowCursor({ ports, run });
    if (cancelled === undefined) {
      throw runFailure({
        stage: cancelStage,
        code: "RETRYABLE_INFRASTRUCTURE_FAILURE",
        retryable: true,
        detailCode: "run-state-unconfirmed",
        occurredAt: options.now().toISOString(),
      });
    }
    return outcomeOf({
      cursor: cancelled,
      state: graphStateOf(run, cancelled),
      disposition: "cancellation-recorded",
    });
  };

  /**
   * 运行终态失败、取消或可重试失败 → 公共失败错误：运行已登记失败事实时调用方必须能据公共结果
   * 区分它，绝不把失败伪装成成功（design D-07）。
   */
  const terminalFailureOf = (input: {
    readonly outcome: RiskFlowRunOutcomeV1;
    readonly authorization: AuthorizationContextV1;
    readonly runRef: WorkflowRunRefV1;
    readonly idempotencyKey: string;
    readonly retryPolicyRef: VersionReference;
  }): ModuleErrorV1 | undefined => {
    const status = input.outcome.status;
    if (status !== "terminal-failure" && status !== "cancelled" && status !== "retryable-failure") {
      return undefined;
    }
    return moduleErrorFor({
      error: riskFlowGraphError({
        code:
          status === "cancelled"
            ? "CANCELLED"
            : status === "retryable-failure"
              ? "RETRYABLE_INFRASTRUCTURE_FAILURE"
              : "CONTRACT_INVALID",
        stage: input.outcome.stage,
        retryable: status === "retryable-failure",
        detailCode: `run-${status}`,
        occurredAt: options.now().toISOString(),
      }),
      authorization: input.authorization,
      runRef: input.runRef,
      idempotencyKey: input.idempotencyKey,
      attempt: 1,
      retryPolicyRef: input.retryPolicyRef,
    });
  };

  const startRunPort = async (
    command: StartWorkflowRunCommandV1,
  ): Promise<StartWorkflowRunResultV1> => {
    const parsed = StartWorkflowRunCommandV1Schema.parse(command);
    const gate = evaluateWorkflowEntryGate(parsed.payload);
    if (gate.kind !== "ready") {
      return {
        kind: "failed",
        error: gateFailure({
          detailCode: gate.detailCode,
          projectId: parsed.projectId,
        }),
      };
    }
    const entryMode = parsed.payload.entryMode;
    // 入口身份由 core 唯一构造函数给出（design D-12）：此处不再复制一份摘要算法，
    // 也不把前驱伪装成变化引用加入 frozenRefs；不同前驱、原因或变化引用不共享运行分区。
    const reassessmentEntry = reassessmentEntryFromStartPayloadV1(parsed.payload);
    const entryIdentity = workflowEntryIdentityFor({
      entryMode,
      projectId: parsed.projectId,
      frozenRefs: gate.frozenRefs,
      reassessmentEntry,
    });
    const { runRef, threadId } = workflowRunIdentityFor({
      projectId: parsed.projectId,
      entryMode,
      entryIdentity,
      graphVersion: parsed.payload.graphVersion,
    });
    const primaryRiskRef = primaryRiskRefOfPayload(parsed.payload);
    try {
      const outcome = await start({
        projectId: parsed.projectId,
        actorId: parsed.actorId,
        authorization: parsed.authorization,
        commandId: parsed.commandId,
        idempotencyKey: parsed.idempotencyKey,
        issuedAt: parsed.issuedAt,
        validAt: parsed.issuedAt,
        graphVersion: parsed.payload.graphVersion,
        retryPolicyRef: parsed.payload.retryPolicyRef,
        entryMode,
        entryIdentity,
        frozenRefs: gate.frozenRefs,
        pairing: pairingsOfPayload({ payload: parsed.payload, gate }),
        ...(primaryRiskRef === undefined ? {} : { primaryRiskRef }),
        ...(reassessmentEntry === undefined ? {} : { reassessmentEntry }),
        ...(parsed.payload.entryMode === "forecast-response"
          ? {
              adoptedRecommendationRef: parsed.payload.adoptedRecommendationRef,
              ...(parsed.payload.waitForDecision === true
                ? { waitForDecision: true as const }
                : {}),
            }
          : {}),
        runRef,
        threadId,
      });
      if (outcome.status === "waiting") {
        // 等待态必然有精确等待引用（公共状态 Schema 收口），缺失即契约失败。
        if (outcome.lastWaitingRef === undefined) {
          return {
            kind: "failed",
            error: moduleErrorFor({
              error: riskFlowGraphError({
                code: "CONTRACT_INVALID",
                stage: outcome.stage,
                detailCode: "waiting-reference-missing",
                occurredAt: options.now().toISOString(),
              }),
              authorization: parsed.authorization,
              runRef,
              idempotencyKey: parsed.idempotencyKey,
              attempt: 1,
              retryPolicyRef: parsed.payload.retryPolicyRef,
            }),
          };
        }
        // 等待结果同时给出已登记的真实运行引用：调用方据此按精确运行继续，不自行派生身份。
        return { kind: "waiting", waiting: outcome.lastWaitingRef, workflowRunRef: outcome.runRef };
      }
      const terminalFailure = terminalFailureOf({
        outcome,
        authorization: parsed.authorization,
        runRef,
        idempotencyKey: parsed.idempotencyKey,
        retryPolicyRef: parsed.payload.retryPolicyRef,
      });
      if (terminalFailure !== undefined) {
        return { kind: "failed", error: terminalFailure };
      }
      return {
        kind: "succeeded",
        result: {
          workflowRunRef: outcome.runRef,
          disposition: outcome.disposition === "created" ? "created" : "existing",
        },
      };
    } catch (error: unknown) {
      return {
        kind: "failed",
        error: moduleErrorFor({
          error: requireRunError(error, options.now().toISOString()),
          authorization: parsed.authorization,
          runRef,
          idempotencyKey: parsed.idempotencyKey,
          attempt: 1,
          retryPolicyRef: parsed.payload.retryPolicyRef,
        }),
      };
    }
  };

  const resumeRunPort = async (
    command: ResumeWorkflowRunCommandV1,
  ): Promise<ResumeWorkflowRunResultV1> => {
    const parsed = ResumeWorkflowRunCommandV1Schema.parse(command);
    const runRef = parsed.payload.workflowRunRef;
    try {
      const outcome = await resume({
        projectId: parsed.projectId,
        actorId: parsed.actorId,
        authorization: parsed.authorization,
        commandId: parsed.commandId,
        idempotencyKey: parsed.idempotencyKey,
        issuedAt: parsed.issuedAt,
        validAt: parsed.issuedAt,
        runRef,
        expectedRunVersionId: parsed.payload.expectedStateVersion,
        resumeCause: resumeValueOfCause(parsed.payload.resumeCause),
      });
      if (outcome.status === "waiting" && outcome.lastWaitingRef !== undefined) {
        return { kind: "waiting", waiting: outcome.lastWaitingRef, workflowRunRef: outcome.runRef };
      }
      const terminalFailure = terminalFailureOf({
        outcome,
        authorization: parsed.authorization,
        runRef,
        idempotencyKey: parsed.idempotencyKey,
        retryPolicyRef: ports.retryPolicyRef,
      });
      if (terminalFailure !== undefined) {
        return { kind: "failed", error: terminalFailure };
      }
      return {
        kind: "succeeded",
        result: { workflowRunRef: outcome.runRef, disposition: "existing" },
      };
    } catch (error: unknown) {
      return {
        kind: "failed",
        error: moduleErrorFor({
          error: requireRunError(error, options.now().toISOString()),
          authorization: parsed.authorization,
          runRef,
          idempotencyKey: parsed.idempotencyKey,
          attempt: 1,
          retryPolicyRef: ports.retryPolicyRef,
        }),
      };
    }
  };

  const cancelRunPort = async (
    command: CancelWorkflowRunCommandV1,
  ): Promise<CancelWorkflowRunResultV1> => {
    const parsed = CancelWorkflowRunCommandV1Schema.parse(command);
    const runRef = parsed.payload.workflowRunRef;
    try {
      const outcome = await cancel({
        projectId: parsed.projectId,
        actorId: parsed.actorId,
        authorization: parsed.authorization,
        commandId: parsed.commandId,
        idempotencyKey: parsed.idempotencyKey,
        issuedAt: parsed.issuedAt,
        validAt: parsed.issuedAt,
        runRef,
        expectedRunVersionId: parsed.payload.expectedStateVersion,
        reasonCode: parsed.payload.reasonCode,
      });
      // 取消回执本身就是成功结果：只有非取消处置下的终态才映射为公共失败。
      const terminalFailure =
        outcome.disposition === "cancellation-recorded" ||
        outcome.disposition === "already-cancelled"
          ? undefined
          : terminalFailureOf({
              outcome,
              authorization: parsed.authorization,
              runRef,
              idempotencyKey: parsed.idempotencyKey,
              retryPolicyRef: ports.retryPolicyRef,
            });
      if (terminalFailure !== undefined) {
        return { kind: "failed", error: terminalFailure };
      }
      return {
        kind: "succeeded",
        result: {
          workflowRunRef: outcome.runRef,
          disposition:
            outcome.disposition === "cancellation-recorded"
              ? "cancellation-recorded"
              : "already-cancelled",
        },
      };
    } catch (error: unknown) {
      return {
        kind: "failed",
        error: moduleErrorFor({
          error: requireRunError(error, options.now().toISOString()),
          authorization: parsed.authorization,
          runRef,
          idempotencyKey: parsed.idempotencyKey,
          attempt: 1,
          retryPolicyRef: ports.retryPolicyRef,
        }),
      };
    }
  };

  /**
   * `engineering.inputs-ready.v1` 入口：以事件携带的精确准备引用恢复原父运行，识别阶段据此启动
   * C24 子运行；同一命令/幂等身份重放命中同一运行版本，不产生第二次准备（design D-02/D-08）。
   */
  const applyIdentificationPreparation = async (input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly issuedAt: string;
    readonly runRef: WorkflowRunRefV1;
    readonly identificationPreparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
  }): Promise<RiskFlowRunOutcomeV1> => {
    const cursor = await readRiskFlowCursor({
      ports,
      run: provisionalRunContext({ ...input, validAt: input.issuedAt }),
    });
    if (cursor === undefined) {
      throw runFailure({
        stage: "preparing",
        code: "RUN_NOT_FOUND",
        retryable: false,
        detailCode: "entity_not_found",
        occurredAt: options.now().toISOString(),
      });
    }
    return await resume({
      projectId: input.projectId,
      actorId: input.actorId,
      authorization: input.authorization,
      commandId: input.commandId,
      idempotencyKey: input.idempotencyKey,
      issuedAt: input.issuedAt,
      validAt: input.issuedAt,
      runRef: input.runRef,
      expectedRunVersionId: cursor.runVersionId,
      resumeCause: {
        kind: "inputs-ready",
        identificationPreparationSnapshotRef: input.identificationPreparationSnapshotRef,
      },
    });
  };

  /**
   * `identification.risk-record-accepted.v1` 入口：父运行只登记该精确风险版本的路由事实，再用
   * 原父运行身份恢复；评估子运行仍由识别阶段按版本幂等建立（design D-02/D-08）。
   */
  const applyAcceptedRisk = async (input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly issuedAt: string;
    readonly runRef: WorkflowRunRefV1;
    readonly identificationRunRef: WorkflowRunRefV1;
    readonly riskRecordRef: StandardizedRiskRecordRefV1;
  }): Promise<RiskFlowRunOutcomeV1> => {
    const provisional = provisionalRunContext({ ...input, validAt: input.issuedAt });
    const cursor = await readRiskFlowCursor({ ports, run: provisional });
    if (cursor === undefined) {
      throw runFailure({
        stage: "preparing",
        code: "RUN_NOT_FOUND",
        retryable: false,
        detailCode: "entity_not_found",
        occurredAt: options.now().toISOString(),
      });
    }
    const stage = riskFlowStageOf(cursor.stage, options.now().toISOString());
    const authorized = await verifyCurrent({
      authorization: input.authorization,
      projectId: input.projectId,
      actorId: input.actorId,
      operation: "workflow-resume",
      targetId: input.commandId,
      branch: "workflow.resume-run",
      requestedAt: input.issuedAt,
      stage,
    });
    const rows = await readRiskFlowRows({ ports, run: provisional });
    const threadId = rows.find((row) => row.threadId !== undefined)?.threadId;
    if (threadId === undefined) {
      throw runFailure({
        stage,
        code: "CONTRACT_INVALID",
        retryable: false,
        detailCode: "run-thread-missing",
        occurredAt: options.now().toISOString(),
      });
    }
    // 已验收风险引用进入本运行冻结集合：父运行据此可重建“哪条精确版本已被验收”（design D-02）。
    const run: RiskFlowGraphRunContextV1 = {
      ...provisional,
      authorization: authorized,
      entryRecordedAt: cursor.recordedAt,
      threadId,
      entryMode: cursor.entryMode,
      entryIdentity: cursor.entryIdentity,
      frozenRefs: frozenRefsFromRowsV1(rows, [input.riskRecordRef]),
      pairing: pairingsFromRowsV1(rows),
    };
    const acceptedRouteRef: RouteDecisionRefV1 = {
      kind: "route-decision",
      reference: {
        entityId: `risk-flow-risk-accepted:${cursor.runId}:${sha256CanonicalJson(input.riskRecordRef).slice(0, 32)}`,
        versionId: sha256CanonicalJson({
          riskRecordRef: input.riskRecordRef,
          identificationRunRef: input.identificationRunRef,
        }),
      },
    };
    await appendEntryFacts({
      ports,
      run,
      cursor,
      stage,
      actionSuffix: `risk-record-accepted:${sha256CanonicalJson(input.riskRecordRef).slice(0, 32)}`,
      commandKind: "risk-flow-graph.risk-record-accepted",
      routeDecisions: [{ ref: acceptedRouteRef, routeKind: RISK_FLOW_ROUTE_KIND_RISK_ACCEPTED_V1 }],
    });
    const afterFacts = await readRiskFlowCursor({ ports, run });
    if (afterFacts === undefined) {
      throw runFailure({
        stage,
        code: "RETRYABLE_INFRASTRUCTURE_FAILURE",
        retryable: true,
        detailCode: "run-state-unconfirmed",
        occurredAt: options.now().toISOString(),
      });
    }
    return await resume({
      projectId: input.projectId,
      actorId: input.actorId,
      authorization: input.authorization,
      commandId: input.commandId,
      idempotencyKey: input.idempotencyKey,
      issuedAt: input.issuedAt,
      validAt: input.issuedAt,
      runRef: input.runRef,
      expectedRunVersionId: afterFacts.runVersionId,
      resumeCause: {
        kind: "risk-record-accepted",
        identificationRunRef: input.identificationRunRef,
        riskRecordRef: input.riskRecordRef,
      },
    });
  };

  const workflowPort: WorkflowPortV1 = {
    startRun: startRunPort,
    resumeRun: resumeRunPort,
    cancelRun: cancelRunPort,
  };

  return {
    start,
    resume,
    cancel,
    applyIdentificationPreparation,
    applyAcceptedRisk,
    workflowPort,
  };
};
