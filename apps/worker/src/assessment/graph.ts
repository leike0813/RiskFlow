/**
 * C30 评估子图 A0～A9（design D-01/D-03/D-04/D-05，IP-05/IP-06）。
 *
 * 本文件只做编排：用真实 `@langchain/langgraph` 的 `StateGraph` 把每个有限入口的 A0～A9 路线
 * 固定下来，节点只调用 C11/C18/C19/C25～C29 的公开端口、C30 核心纯函数与注入的组合根接缝。
 * 节点不读其它模块私表、不重算 P/C、矩阵、阈值或处置三项约束，也不为 A3～A6 建 Agent 任务。
 *
 * 通道正文就是公开 `AssessmentGraphStateV1`：入口、每次节点转换与输出都经
 * `AssessmentGraphStateV1Schema` 解析，解析失败一律收口为 `CONTRACT_INVALID`。
 *
 * 等待语义（design D-05/D-07）：节点先登记等待业务事实（C03 事务，含审计）再把状态置为
 * `waiting`，`wait` 节点随后 `interrupt()` 暂停原线程。恢复时 `wait` 节点不完成任何副作用，
 * 只把状态恢复为 `running`，由路由把控制权交回同一阶段，阶段节点按业务幂等身份重放；因此
 * checkpoint 只承载小型引用，业务事实永不来自 checkpoint 正文。
 *
 * 有限入口（design D-03/D-04）：`assess`/`reassess`/`historical-backfill` 走完整 A0～A9；
 * `forecast-response` 只走 A0→A1→A2→A9（冻结预测输入并调用 C28 `forecastResponse`）；
 * `record-response-feedback` 只走 A0→A1→A2→A3→A4→A9（C28 `calculateDeviation`、C29
 * `prepareInput`/`createSuggestion`）。跨日现场动作一律由人发起新命令，不在同一运行内等待。
 *
 * 阶段结果行只在阶段完成时写入一次，其身份由动作后缀与内容摘要确定性派生，因此恢复重放命中
 * 同一幂等键即同事实重放。缺席链尾以 `workflow-error` 行登记类型化原因码，绝不写占位事实。
 */
import {
  Annotation,
  Command,
  END,
  START,
  StateGraph,
  interrupt,
  isGraphBubbleUp,
  type BaseCheckpointSaver,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";

import type { VersionReference } from "@riskflow/contracts/common";
import {
  ApplicabilityMetadataSnapshotRefV1Schema,
  AssessmentBasisReleaseSetRefV1Schema,
  AssessmentInputSnapshotRefV1Schema,
  ContentArtifactRefV1Schema,
  EffectForecastRefV1Schema,
  ExecutionRecordRefV1Schema,
  FeedbackRefV1Schema,
  MonitoringSnapshotRefV1Schema,
  ProjectRevisionRefV1Schema,
  ResponseForecastInputSnapshotRefV1Schema,
  ResponseRecommendationRefV1Schema,
  RiskAssessmentRecordRefV1Schema,
  RiskInputVersionRefV1Schema,
  RouteDecisionRefV1Schema,
  SpatialScopeRefV1Schema,
  type AgentTaskResultRefV1,
  type AgentTaskRefV1,
  type ApplicabilityMetadataSnapshotRefV1,
  type AssessmentBasisReleaseSetRefV1,
  type AssessmentEvaluationSuccessV1,
  type AssessmentPreparationSnapshotRefV1,
  type AuthorizationContextV1,
  type ContentArtifactRefV1,
  type ContractReferenceV1,
  type DeviationRecordRefV1,
  type EngineeringDataPortV1,
  type KnowledgeQueryResultRefV1,
  type KnowledgeReleaseRefV1,
  type KnowledgeModelingPortV1,
  type MeasureLibraryReleaseRefV1,
  type MonitoringSnapshotRefV1,
  type ProjectRevisionRefV1,
  type RiskAssessmentPortV1,
  type RiskInputVersionRefV1,
  type SpatialScopeRefV1,
  type StageResultRefV1,
  type WarningResponseTaskRefV1,
  type WorkflowReassessmentInputV1,
  type WorkflowEntryModeV1,
  type WorkflowRunRefV1,
} from "@riskflow/contracts/ports";
import type { WorkflowReassessmentReasonV1 } from "@riskflow/contracts/vocabulary";
import {
  AssessmentGraphStateV1Schema,
  AssessmentStageResultV1Schema,
  ResponseFeedbackInputSnapshotV1Schema,
  ResponseForecastInputSnapshotV1Schema,
  type AssessmentGraphStateV1,
  type AssessmentStageV1,
  type ResponseForecastInputSnapshotV1,
} from "@riskflow/contracts/workflows";
import type {
  AssessmentRuntimePolicySetProviderV1,
  AssessmentRuntimePolicySetV1,
} from "@riskflow/core/risk-assessment/engine";
import type {
  CalibrationInputSnapshotRefV1,
  CalibrationServiceV1,
  CalibrationValidationPolicyV1,
} from "@riskflow/core/calibration";
import { VerifiedResponseWorkflowBindingV1Schema } from "@riskflow/core/response-lifecycle";
import type { ResponseLifecycleServiceV1 } from "@riskflow/core/response-lifecycle";
import type {
  AssessmentBasisReleaseSetReadResultV1,
  AssessmentBasisReleaseSetReaderV1,
} from "@riskflow/core/scoring-rules";
import type { RecommendationServiceV1 } from "@riskflow/core/recommendation";
import type { WarningLifecycleServiceV1 } from "@riskflow/core/warning";
import {
  WorkflowGraphArtifactBodyV1Schema,
  WorkflowGraphErrorV1Schema,
  WorkflowGraphResultRowV1Schema,
  WorkflowGraphRunResultV1Schema,
  WorkflowGraphRunStateV1Schema,
  classifyWorkflowGraphFailure,
  initialRunVersionId,
  nextRunVersionId,
  assessmentReasonForWorkflowReassessmentV1,
  normalizeMonitoringInputs,
  workflowEntryIdentityFor,
  type WorkflowGraphArtifactBodyV1,
  type WorkflowGraphBodyPortV1,
  type WorkflowGraphErrorV1,
  type WorkflowGraphLinkV1,
  type WorkflowGraphRegistrationStoreV1,
  type WorkflowGraphResultRowV1,
  type WorkflowGraphRunResultV1,
  type WorkflowGraphRunStateV1,
  type WorkflowLinkRelationV1,
  type WorkflowRunStageV1,
  type WorkflowSkippedTailV1,
} from "@riskflow/core/workflow";
import type {
  AtomicCommitV1,
  TransactionContextV1,
  TransactionUnitV1,
} from "@riskflow/core/persistence";
import { sha256CanonicalJson } from "@riskflow/core/persistence";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";

/** 运行上下文在 LangGraph `configurable` 中的稳定键。 */
export const ASSESSMENT_GRAPH_RUN_CONFIG_KEY_V1 = "riskflowAssessmentGraphRunV1" as const;

/** 评估阶段全序：完整评估入口按此顺序推进。 */
const FULL_STAGE_SEQUENCE_V1: readonly AssessmentStageV1[] = [
  "A0",
  "A1",
  "A2",
  "A3",
  "A4",
  "A5",
  "A6",
  "A7",
  "A8",
  "A9",
];

/**
 * 每个公共入口的有限阶段计划（design D-03/D-04）：预测与反馈分段不跨日等待，
 * 只在各自声明的阶段内组合已成立的领域事实。
 */
const STAGE_PLAN_V1: Readonly<Record<WorkflowEntryModeV1, readonly AssessmentStageV1[]>> = {
  "identify-and-assess": FULL_STAGE_SEQUENCE_V1,
  assess: FULL_STAGE_SEQUENCE_V1,
  reassess: FULL_STAGE_SEQUENCE_V1,
  "historical-backfill": FULL_STAGE_SEQUENCE_V1,
  "forecast-response": ["A0", "A1", "A2", "A9"],
  "record-response-feedback": ["A0", "A1", "A2", "A3", "A4", "A9"],
};

/** 等待节点名：唯一 `interrupt()` 位置，保证恢复时先回到同一阶段重放。 */
const WAIT_NODE_V1 = "wait" as const;

const NODE_FOR_STAGE_V1 = {
  A0: "A0",
  A1: "A1",
  A2: "A2",
  A3: "A3",
  A4: "A4",
  A5: "A5",
  A6: "A6",
  A7: "A7",
  A8: "A8",
  A9: "A9",
} as const satisfies Readonly<Record<AssessmentStageV1, string>>;

type NodeNameV1 = (typeof NODE_FOR_STAGE_V1)[AssessmentStageV1] | typeof WAIT_NODE_V1 | typeof END;

/** 恢复值：只携带稳定引用，不携带自由正文（`wait` 节点消费）。 */
export interface AssessmentGraphResumeValueV1 {
  readonly kind: string;
  readonly resumeCause: unknown;
}

/** 一次 `start`/`resume` 的完整调用身份：冻结值全部来自命令或已登记事实。 */
export interface AssessmentGraphRunContextV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly authorization: AuthorizationContextV1;
  readonly commandId: string;
  readonly idempotencyKey: string;
  /** 记录时刻：登记行的 `recorded_at`。 */
  readonly issuedAt: string;
  /** 业务时刻：登记行的 `valid_at` 与 C25/C28 双时间解析的 `requiredAt`/`effectiveAt`。 */
  readonly validAt: string;
  readonly runRef: WorkflowRunRefV1;
  readonly parentRunRef: WorkflowRunRefV1 | undefined;
  readonly entryMode: WorkflowEntryModeV1;
  readonly entryIdentity: VersionReference;
  readonly frozenRefs: readonly ContractReferenceV1[];
  readonly acceptedRiskRecordRef: ContractReferenceV1 | undefined;
  readonly spatialScopeRef: SpatialScopeRefV1 | undefined;
  readonly applicabilityMetadataSnapshotRef: ContractReferenceV1 | undefined;
  readonly monitoringSnapshotRefs: readonly MonitoringSnapshotRefV1[];
  readonly assessmentRunRefs: readonly WorkflowRunRefV1[];
  /**
   * 重评入口不可变事实（design D-12）：非重评为 undefined。前驱与原因从该对象取值，
   * 不保留可独立改变的第二套前驱，也不再按 frozenRefs 数量推导原因。
   */
  readonly reassessmentEntry: WorkflowReassessmentInputV1 | undefined;
  readonly graphVersion: VersionReference;
  readonly threadId: string;
}

/** 逐阶段登记端口（C30 冻结接口，无授权参数：授权在运行时已复验）。 */
export type AssessmentGraphRegistrationStorePortV1 = WorkflowGraphRegistrationStoreV1;

/** C04 正文端口（design D-05：正文只入 C04，登记行只保存精确引用）。 */
export type AssessmentGraphBodyPortV1 = WorkflowGraphBodyPortV1;

/** Agent 接缝结果：任务未终结返回 `waiting`，已终结返回精确结果引用。 */
export type AssessmentGraphAgentOutcomeV1 =
  | { readonly kind: "waiting"; readonly agentTaskRef: AgentTaskRefV1 }
  | {
      readonly kind: "completed";
      readonly agentTaskRef: AgentTaskRefV1;
      readonly agentTaskResultRef: AgentTaskResultRefV1;
    }
  | { readonly kind: "failed"; readonly reasonCode: string };

/**
 * C27 处置组合 Agent 接缝（C08 有界任务）：生产组合根用真实 C08 适配器 +
 * `createResponseRecommendationTaskDefinition(policy, port)` 实现，图只消费闭合结果。
 */
export interface AssessmentGraphRecommendationAgentPortV1 {
  /** 冻结现场上下文引用：C27 候选组合与三项校验只按精确引用进行。 */
  resolveSiteContextRef(input: {
    readonly run: AssessmentGraphRunContextV1;
    readonly requiredAt: string;
  }): Promise<VersionReference | undefined>;
  /** 启动或观察 C27 组合任务；同一 `actionId` 必须复用同一任务身份。 */
  ensureTask(input: {
    readonly run: AssessmentGraphRunContextV1;
    readonly actionId: string;
    readonly queryResultRef: KnowledgeQueryResultRefV1;
    readonly warningResponseTaskRef: WarningResponseTaskRefV1;
    readonly responseGenerationPolicyRef: VersionReference;
    readonly responseAgentPolicyRef: VersionReference;
  }): Promise<AssessmentGraphAgentOutcomeV1>;
}

/** C29 校准候选 Agent 接缝（C08 有界任务）：生产组合根绑定 C29 任务定义与 C29 端口。 */
export interface AssessmentGraphCalibrationAgentPortV1 {
  ensureTask(input: {
    readonly run: AssessmentGraphRunContextV1;
    readonly actionId: string;
    readonly frozenInputRef: ContentArtifactRefV1;
    readonly inputSnapshotRef: CalibrationInputSnapshotRefV1;
    readonly deviationRecordRef: DeviationRecordRefV1;
    readonly calibrationValidationPolicyRef: VersionReference;
  }): Promise<AssessmentGraphAgentOutcomeV1>;
}

/** 分段入口的冻结策略解析（仅组合根可读；图不内建默认值）。 */
export interface AssessmentGraphPolicyCatalogV1 {
  resolveForecastPolicy(input: {
    readonly projectId: string;
    readonly basisReleaseSetRef: AssessmentBasisReleaseSetRefV1;
    readonly requiredAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<
    | { readonly kind: "resolved"; readonly forecastPolicyRef: VersionReference }
    | { readonly kind: "unavailable"; readonly reasonCode: string }
  >;
  resolveCalibrationPolicy(input: {
    readonly projectId: string;
    readonly basisReleaseSetRef: AssessmentBasisReleaseSetRefV1;
    readonly requiredAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<
    | {
        readonly kind: "resolved";
        readonly targetReleaseRef: KnowledgeReleaseRefV1;
        readonly calibrationValidationPolicyRef: VersionReference;
        readonly agentPolicy: CalibrationValidationPolicyV1;
      }
    | { readonly kind: "unavailable"; readonly reasonCode: string }
  >;
}

/** 图节点可用的全部注入端口；任一必需项缺失即拒绝构造（design D-03/D-04）。 */
export interface AssessmentGraphPortsV1 {
  readonly transactionUnit: TransactionUnitV1;
  readonly registrationStore: AssessmentGraphRegistrationStorePortV1;
  readonly bodies: AssessmentGraphBodyPortV1;
  /** C11 评估准备冻结：只按显式入口引用冻结，不推断“最新版”。 */
  readonly engineeringData: Pick<EngineeringDataPortV1, "freeze">;
  /** C19 已发布评估依据集合与 C18 版本化策略的解析入口。 */
  readonly basis: AssessmentBasisReleaseSetReaderV1;
  /**
   * C17/C19 正式依据解析：`assessment-basis` 分支只按冻结的评估准备快照与 `requiredAt` 物化
   * 确定性集合引用（design D-03），因此 `assess`/`reassess` 无需公共载荷携带依据引用。
   */
  readonly basisResolver: Pick<KnowledgeModelingPortV1, "resolve">;
  /** C25 运行策略提供者：只按冻结准备与依据引用解析十项运行策略。 */
  readonly runtimePolicies: AssessmentRuntimePolicySetProviderV1;
  /** C25 确定性评估：指标取值、决策工件与评估记录由其唯一事实源提交。 */
  readonly riskAssessment: RiskAssessmentPortV1;
  /** C26 预警：空触发集合直接收口，不建预警、任务或建议。 */
  readonly warning: Pick<WarningLifecycleServiceV1, "open">;
  /** C27 处置建议：候选、三项校验与正式建议由 C27 唯一决定。 */
  readonly recommendation: Pick<
    RecommendationServiceV1,
    "measureCandidates" | "createCandidate" | "validateAndRecord"
  >;
  readonly recommendationAgent: AssessmentGraphRecommendationAgentPortV1;
  /** C28 预测与偏差：预测不可计算保留正式原因，不伪造预测值。 */
  readonly responseLifecycle: Pick<
    ResponseLifecycleServiceV1,
    "forecastResponse" | "calculateDeviation"
  >;
  /** C29 校准：越限偏差只形成待人工审核建议，发布不经本图。 */
  readonly calibration: Pick<CalibrationServiceV1, "prepareInput" | "createSuggestion">;
  readonly calibrationAgent: AssessmentGraphCalibrationAgentPortV1;
  readonly policies: AssessmentGraphPolicyCatalogV1;
  readonly now: () => Date;
}

/** 首次运行输入：通道正文就是完整公开状态。 */
export interface AssessmentGraphInputV1 {
  readonly graph: AssessmentGraphStateV1;
}

/** 编译后的子图运行面：由 runtime 独占，节点不直接调用它。 */
export interface AssessmentGraphRunnerV1 {
  invoke(input: AssessmentGraphInputV1, config: LangGraphRunnableConfig): Promise<unknown>;
  resume(
    input: { readonly resume: AssessmentGraphResumeValueV1 },
    config: LangGraphRunnableConfig,
  ): Promise<unknown>;
  retry(state: AssessmentGraphStateV1, config: LangGraphRunnableConfig): Promise<unknown>;
  recover(
    state: AssessmentGraphStateV1,
    completedNode: AssessmentStageV1,
    config: LangGraphRunnableConfig,
  ): Promise<unknown>;
  getState(config: LangGraphRunnableConfig): Promise<unknown>;
}

/** 节点内部失败：只带稳定 C30 错误，不携带上游正文。 */
export class AssessmentGraphNodeFailureV1 extends Error {
  readonly error: WorkflowGraphErrorV1;

  constructor(error: WorkflowGraphErrorV1) {
    super(`${error.code}:${error.detailCode}`);
    this.name = "AssessmentGraphNodeFailureV1";
    this.error = error;
  }
}

/** 登记端口报告同键异载荷：不可重试冲突，不覆盖首次业务事实（design D-08）。 */
export class AssessmentGraphConflictV1 extends Error {
  constructor(readonly priorCommandId: string) {
    super("IDEMPOTENCY_CONFLICT");
    this.name = "AssessmentGraphConflictV1";
  }
}

/**
 * 字段级通道：通道名必须与 `AssessmentGraphStateV1` 的字段一一对应。C03 checkpointer 按
 * `AssessmentGraphStateV1Schema.shape` 校验每次写入并把 `channel_values` 直接解析为该 Schema，
 * 因此不能用单一包裹通道承载整份状态。
 */
const channelsAnnotation = Annotation.Root({
  schemaVersion: Annotation<AssessmentGraphStateV1["schemaVersion"]>(),
  graphVersion: Annotation<AssessmentGraphStateV1["graphVersion"]>(),
  parentRiskFlowRunRef: Annotation<AssessmentGraphStateV1["parentRiskFlowRunRef"]>(),
  runRef: Annotation<AssessmentGraphStateV1["runRef"]>(),
  threadId: Annotation<AssessmentGraphStateV1["threadId"]>(),
  entryMode: Annotation<AssessmentGraphStateV1["entryMode"]>(),
  authorizationContextRef: Annotation<AssessmentGraphStateV1["authorizationContextRef"]>(),
  entrySnapshotRef: Annotation<AssessmentGraphStateV1["entrySnapshotRef"]>(),
  status: Annotation<AssessmentGraphStateV1["status"]>(),
  stage: Annotation<AssessmentGraphStateV1["stage"]>(),
  assessmentInputSnapshotRef: Annotation<AssessmentGraphStateV1["assessmentInputSnapshotRef"]>(),
  waitingRef: Annotation<AssessmentGraphStateV1["waitingRef"]>(),
  assessmentRecordRef: Annotation<AssessmentGraphStateV1["assessmentRecordRef"]>(),
  warningRecordRefs: Annotation<AssessmentGraphStateV1["warningRecordRefs"]>(),
  warningResponseTaskRefs: Annotation<AssessmentGraphStateV1["warningResponseTaskRefs"]>(),
  recommendationCandidateRef: Annotation<AssessmentGraphStateV1["recommendationCandidateRef"]>(),
  agentTaskRefs: Annotation<AssessmentGraphStateV1["agentTaskRefs"]>(),
  responseRecommendationRef: Annotation<AssessmentGraphStateV1["responseRecommendationRef"]>(),
  effectForecastRef: Annotation<AssessmentGraphStateV1["effectForecastRef"]>(),
  executionRecordRef: Annotation<AssessmentGraphStateV1["executionRecordRef"]>(),
  feedbackRef: Annotation<AssessmentGraphStateV1["feedbackRef"]>(),
  deviationRecordRef: Annotation<AssessmentGraphStateV1["deviationRecordRef"]>(),
  calibrationSuggestionRef: Annotation<AssessmentGraphStateV1["calibrationSuggestionRef"]>(),
  reviewTaskRefs: Annotation<AssessmentGraphStateV1["reviewTaskRefs"]>(),
  lastStageResultRef: Annotation<AssessmentGraphStateV1["lastStageResultRef"]>(),
  lastRouteDecisionRef: Annotation<AssessmentGraphStateV1["lastRouteDecisionRef"]>(),
  lastErrorRef: Annotation<AssessmentGraphStateV1["lastErrorRef"]>(),
  resultRef: Annotation<AssessmentGraphStateV1["resultRef"]>(),
});

type GraphChannelsV1 = typeof channelsAnnotation.State;

const DECLARED_STATE_FIELDS_V1: Readonly<Record<string, true>> = Object.fromEntries(
  Object.keys(channelsAnnotation.spec).map((key) => [key, true as const]),
);

/**
 * 通道/图返回值投影：只取本注解声明的状态字段，忽略 LangGraph 内部通道（`__interrupt__` 等）。
 * 图在挂起点返回的是通道集合本身，严格状态解析因此必须先经同一投影。
 */
const projectAssessmentGraphState = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null) return {};
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (DECLARED_STATE_FIELDS_V1[key] === true) record[key] = entry;
  }
  return record;
};

/** 通道集合 → 严格状态输入：只取本注解声明的字段，忽略 LangGraph 内部通道。 */
const stateOfChannels = (channels: GraphChannelsV1): Record<string, unknown> =>
  projectAssessmentGraphState(channels);

/** 严格状态 → 通道更新：逐字段写回，可选字段以显式 `undefined` 清空。 */
const stateAsUpdate = (state: AssessmentGraphStateV1): GraphChannelsV1 => ({
  schemaVersion: state.schemaVersion,
  graphVersion: state.graphVersion,
  parentRiskFlowRunRef: state.parentRiskFlowRunRef,
  runRef: state.runRef,
  threadId: state.threadId,
  entryMode: state.entryMode,
  authorizationContextRef: state.authorizationContextRef,
  entrySnapshotRef: state.entrySnapshotRef,
  status: state.status,
  stage: state.stage,
  assessmentInputSnapshotRef: state.assessmentInputSnapshotRef,
  waitingRef: state.waitingRef,
  assessmentRecordRef: state.assessmentRecordRef,
  warningRecordRefs: state.warningRecordRefs,
  warningResponseTaskRefs: state.warningResponseTaskRefs,
  recommendationCandidateRef: state.recommendationCandidateRef,
  agentTaskRefs: state.agentTaskRefs,
  responseRecommendationRef: state.responseRecommendationRef,
  effectForecastRef: state.effectForecastRef,
  executionRecordRef: state.executionRecordRef,
  feedbackRef: state.feedbackRef,
  deviationRecordRef: state.deviationRecordRef,
  calibrationSuggestionRef: state.calibrationSuggestionRef,
  reviewTaskRefs: state.reviewTaskRefs,
  lastStageResultRef: state.lastStageResultRef,
  lastRouteDecisionRef: state.lastRouteDecisionRef,
  lastErrorRef: state.lastErrorRef,
  resultRef: state.resultRef,
});

const stageOf = (value: unknown): AssessmentStageV1 => {
  if (typeof value === "object" && value !== null && "stage" in value) {
    const stage = (value as { readonly stage?: unknown }).stage;
    if (typeof stage === "string") {
      const matched = FULL_STAGE_SEQUENCE_V1.find((candidate) => candidate === stage);
      if (matched !== undefined) return matched;
    }
  }
  return "A0";
};

const graphError = (input: {
  readonly code: WorkflowGraphErrorV1["code"];
  readonly stage: AssessmentStageV1;
  readonly detailCode: string;
  readonly occurredAt: string;
  readonly retryable?: boolean;
}): WorkflowGraphErrorV1 =>
  WorkflowGraphErrorV1Schema.parse({
    schemaVersion: "1",
    code: input.code,
    retryable: input.retryable ?? false,
    stage: input.stage,
    detailCode: input.detailCode,
    occurredAt: input.occurredAt,
  });

/** 状态通道唯一解析点：任何失败都收口为 `CONTRACT_INVALID`。 */
export const parseAssessmentGraphState = (
  value: unknown,
  occurredAt: string,
): AssessmentGraphStateV1 => {
  const parsed = AssessmentGraphStateV1Schema.safeParse(projectAssessmentGraphState(value));
  if (!parsed.success) {
    throw new AssessmentGraphNodeFailureV1(
      graphError({
        code: "CONTRACT_INVALID",
        stage: stageOf(value),
        detailCode: "graph-state-invalid",
        occurredAt,
      }),
    );
  }
  return parsed.data;
};

/** 运行上下文从 `configurable` 读取：缺失即契约失败，不回退默认值。 */
export const readAssessmentRunContext = (input: {
  readonly config: LangGraphRunnableConfig;
  readonly occurredAt: string;
}): AssessmentGraphRunContextV1 => {
  const value = input.config.configurable?.[ASSESSMENT_GRAPH_RUN_CONFIG_KEY_V1];
  const candidate =
    typeof value === "object" && value !== null
      ? (value as { readonly commandId?: unknown; readonly projectId?: unknown })
      : undefined;
  if (
    candidate === undefined ||
    typeof candidate.commandId !== "string" ||
    typeof candidate.projectId !== "string"
  ) {
    throw new AssessmentGraphNodeFailureV1(
      graphError({
        code: "CONTRACT_INVALID",
        stage: "A0",
        detailCode: "graph-run-context-missing",
        occurredAt: input.occurredAt,
      }),
    );
  }
  return value as AssessmentGraphRunContextV1;
};

const isResumeValue = (value: unknown): value is AssessmentGraphResumeValueV1 =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  typeof (value as { readonly kind?: unknown }).kind === "string";

const readProperty = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;

const sameVersionReference = (left: VersionReference, right: VersionReference): boolean =>
  left.entityId === right.entityId && left.versionId === right.versionId;

interface SafeParseLike<T> {
  safeParse: (value: unknown) => { success: true; data: T } | { success: false };
}

const parseWith = <T>(schema: SafeParseLike<T>, value: unknown): T | undefined => {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

/** 上游端口失败 → C30 稳定错误：只读 code/retryable/blockerKind/reasonCode，不匹配文案。 */
export const toAssessmentGraphError = (input: {
  readonly stage: AssessmentStageV1;
  readonly error: unknown;
  readonly occurredAt: string;
}): WorkflowGraphErrorV1 => {
  const { stage, error, occurredAt } = input;
  if (error instanceof AssessmentGraphConflictV1) {
    return classifyWorkflowGraphFailure({
      stage,
      upstream: { code: "IDEMPOTENCY_CONFLICT", retryable: false },
      detailCode: "registration-idempotency-conflict",
      occurredAt,
    });
  }
  if (error instanceof AssessmentGraphNodeFailureV1) return error.error;
  const code = readProperty(error, "code");
  const retryable = readProperty(error, "retryable");
  const details = readProperty(error, "details");
  const blockerKind = readProperty(details, "blockerKind");
  const reasonCode = readProperty(details, "reasonCode");
  if (typeof code !== "string") {
    return classifyWorkflowGraphFailure({
      stage,
      upstream: { code: "UNSUPPORTED_CONTRACT", retryable: false },
      detailCode: "unrecognized-port-failure",
      occurredAt,
    });
  }
  const detailCode =
    typeof blockerKind === "string"
      ? blockerKind
      : typeof reasonCode === "string"
        ? reasonCode
        : code;
  if (code === "TRANSACTION_FAILED") {
    return classifyWorkflowGraphFailure({
      stage,
      upstream: { code: "TRANSIENT_FAILURE", retryable: true },
      detailCode,
      occurredAt,
    });
  }
  return classifyWorkflowGraphFailure({
    stage,
    upstream: { code, retryable: typeof retryable === "boolean" ? retryable : false },
    detailCode,
    occurredAt,
  });
};

function fail(error: WorkflowGraphErrorV1): never {
  throw new AssessmentGraphNodeFailureV1(error);
}

const artifactIdFor = (kind: string, runId: string, suffix: string): string =>
  `assessment-graph-${kind}:${runId}:${suffix}`;

const actionIdFor = (run: AssessmentGraphRunContextV1, suffix: string): string =>
  `${run.runRef.reference.versionId}:${suffix}`;

const contractInvalid = (input: {
  readonly stage: AssessmentStageV1;
  readonly detailCode: string;
  readonly occurredAt: string;
}): WorkflowGraphErrorV1 => graphError({ code: "CONTRACT_INVALID", ...input, retryable: false });

/** 尚未开始正式评估准备、P/C 或评估成功事实的入口缺失：安全失败，不推断“最新版”。 */
const entryIncomplete = (input: {
  readonly stage: AssessmentStageV1;
  readonly detailCode: string;
  readonly occurredAt: string;
}): WorkflowGraphErrorV1 =>
  graphError({ code: "ENTRY_REFERENCES_INCOMPLETE", ...input, retryable: false });

/** 只按显式冻结引用取用精确引用：缺失按类型化入口错误返回，重复即契约冲突。 */
const frozenRefsOfKind = <T>(input: {
  readonly run: AssessmentGraphRunContextV1;
  readonly kind: ContractReferenceV1["kind"];
  readonly schema: SafeParseLike<T>;
  readonly stage: AssessmentStageV1;
  readonly detailCode: string;
  readonly occurredAt: string;
}): readonly T[] => {
  const matches: T[] = [];
  for (const ref of input.run.frozenRefs) {
    if (ref.kind !== input.kind) continue;
    const parsed = parseWith(input.schema, ref);
    if (parsed === undefined) {
      fail(
        contractInvalid({
          stage: input.stage,
          detailCode: input.detailCode,
          occurredAt: input.occurredAt,
        }),
      );
    }
    matches.push(parsed);
  }
  return matches;
};

/** 必填单值冻结引用。 */
const requiredFrozenRef = <T>(input: {
  readonly run: AssessmentGraphRunContextV1;
  readonly kind: ContractReferenceV1["kind"];
  readonly schema: SafeParseLike<T>;
  readonly stage: AssessmentStageV1;
  readonly detailCode: string;
  readonly occurredAt: string;
}): T => {
  const matches = frozenRefsOfKind(input);
  if (matches.length === 0) {
    fail(
      entryIncomplete({
        stage: input.stage,
        detailCode: input.detailCode,
        occurredAt: input.occurredAt,
      }),
    );
  }
  if (matches.length > 1) {
    fail(
      graphError({
        code: "CONTRACT_INVALID",
        stage: input.stage,
        detailCode: `${input.detailCode}-duplicate`,
        occurredAt: input.occurredAt,
      }),
    );
  }
  return matches[0] as T;
};

/** 可选单值冻结引用（多于一个即契约冲突）。 */
const optionalFrozenRef = <T>(input: {
  readonly run: AssessmentGraphRunContextV1;
  readonly kind: ContractReferenceV1["kind"];
  readonly schema: SafeParseLike<T>;
  readonly stage: AssessmentStageV1;
  readonly detailCode: string;
  readonly occurredAt: string;
}): T | undefined => {
  const matches = frozenRefsOfKind(input);
  if (matches.length > 1) {
    fail(
      graphError({
        code: "CONTRACT_INVALID",
        stage: input.stage,
        detailCode: `${input.detailCode}-duplicate`,
        occurredAt: input.occurredAt,
      }),
    );
  }
  return matches[0];
};

/** 命令上显式携带的引用同样必须按精确形状解析，缺失与错配分开表达。 */
const commandRefOf = <T>(input: {
  readonly value: ContractReferenceV1 | undefined;
  readonly kind: ContractReferenceV1["kind"];
  readonly schema: SafeParseLike<T>;
  readonly stage: AssessmentStageV1;
  readonly detailCode: string;
  readonly occurredAt: string;
}): T | undefined => {
  if (input.value === undefined) return undefined;
  if (input.value.kind !== input.kind) {
    fail(
      contractInvalid({
        stage: input.stage,
        detailCode: input.detailCode,
        occurredAt: input.occurredAt,
      }),
    );
  }
  const parsed = parseWith(input.schema, input.value);
  if (parsed === undefined) {
    fail(
      contractInvalid({
        stage: input.stage,
        detailCode: input.detailCode,
        occurredAt: input.occurredAt,
      }),
    );
  }
  return parsed;
};

/** 入口引用集：只从命令的显式字段与冻结引用取用，缺失即安全失败（design D-01）。 */
interface EntryRefsV1 {
  readonly projectRevisionRef: ProjectRevisionRefV1;
  readonly spatialScopeRef: SpatialScopeRefV1;
  readonly applicabilityMetadataSnapshotRef: ApplicabilityMetadataSnapshotRefV1;
  readonly riskInput: RiskInputVersionRefV1;
  readonly monitoringSnapshotRefs: readonly MonitoringSnapshotRefV1[];
}

const entryRefsOf = (input: {
  readonly run: AssessmentGraphRunContextV1;
  readonly stage: AssessmentStageV1;
  readonly occurredAt: string;
}): EntryRefsV1 => {
  const { run, stage, occurredAt } = input;
  const projectRevisionRef = optionalFrozenRef({
    run,
    kind: "project-revision",
    schema: ProjectRevisionRefV1Schema,
    stage,
    detailCode: "project-revision-missing",
    occurredAt,
  });
  const spatialScopeRef =
    commandRefOf({
      value: run.spatialScopeRef,
      kind: "spatial-scope",
      schema: SpatialScopeRefV1Schema,
      stage,
      detailCode: "spatial-scope-invalid",
      occurredAt,
    }) ??
    optionalFrozenRef({
      run,
      kind: "spatial-scope",
      schema: SpatialScopeRefV1Schema,
      stage,
      detailCode: "spatial-scope-missing",
      occurredAt,
    });
  const applicabilityMetadataSnapshotRef =
    commandRefOf({
      value: run.applicabilityMetadataSnapshotRef,
      kind: "applicability-metadata-snapshot",
      schema: ApplicabilityMetadataSnapshotRefV1Schema,
      stage,
      detailCode: "applicability-metadata-invalid",
      occurredAt,
    }) ??
    optionalFrozenRef({
      run,
      kind: "applicability-metadata-snapshot",
      schema: ApplicabilityMetadataSnapshotRefV1Schema,
      stage,
      detailCode: "applicability-metadata-missing",
      occurredAt,
    });
  const fromRiskRecord = optionalFrozenRef({
    run,
    kind: "standardized-risk-record",
    schema: RiskInputVersionRefV1Schema,
    stage,
    detailCode: "risk-input-invalid",
    occurredAt,
  });
  const fromExternalEvent = optionalFrozenRef({
    run,
    kind: "external-risk-event",
    schema: RiskInputVersionRefV1Schema,
    stage,
    detailCode: "risk-input-invalid",
    occurredAt,
  });
  // 命令显式携带的验收风险记录优先；形状不符时回退到冻结引用（不猜其它形状）。
  const riskInput =
    parseWith(RiskInputVersionRefV1Schema, run.acceptedRiskRecordRef) ??
    fromRiskRecord ??
    fromExternalEvent;
  // 函数声明（而非箭头常量）才会让 `never` 收口参与控制流分析，缺失项之后无需再断言。
  function missing(detailCode: string): never {
    return fail(entryIncomplete({ stage, detailCode, occurredAt }));
  }
  if (projectRevisionRef === undefined) missing("project-revision-missing");
  if (spatialScopeRef === undefined) missing("spatial-scope-missing");
  if (applicabilityMetadataSnapshotRef === undefined) missing("applicability-metadata-missing");
  if (riskInput === undefined) missing("risk-input-missing");
  const monitoring = normalizeMonitoringInputs({
    monitoringSnapshotRefs:
      run.monitoringSnapshotRefs.length === 0 ? undefined : run.monitoringSnapshotRefs,
  });
  if (monitoring.kind === "conflict") missing("monitoring-input");
  return {
    projectRevisionRef,
    spatialScopeRef,
    applicabilityMetadataSnapshotRef,
    riskInput,
    monitoringSnapshotRefs: monitoring.kind === "ok" ? monitoring.refs : [],
  };
};

/**
 * 分段入口（`forecast-response`/`record-response-feedback`）没有可解析的评估准备快照：
 * 其评估依据集合必须由冻结输入显式给出，缺失即按入口不完整安全失败（design D-04）。
 */
const segmentedBasisReleaseSetRefOf = (input: {
  readonly run: AssessmentGraphRunContextV1;
  readonly stage: AssessmentStageV1;
  readonly occurredAt: string;
}): AssessmentBasisReleaseSetRefV1 =>
  requiredFrozenRef({
    run: input.run,
    kind: "assessment-basis-release-set",
    schema: AssessmentBasisReleaseSetRefV1Schema,
    stage: input.stage,
    detailCode: "assessment-basis-missing",
    occurredAt: input.occurredAt,
  });

/**
 * 评估依据集合引用（design D-03）：`historical-backfill` 等显式钉住冻结引用时原样使用；否则按 A0
 * 已冻结的评估准备快照与业务时点，经 C17/C19 `assessment-basis` 解析正式集合。解析身份由冻结输入
 * 确定性派生，因此重放得到同一集合，绝不选择“当前最新值”。
 */
const resolveBasisReleaseSetRef = async (input: {
  readonly ports: AssessmentGraphPortsV1;
  readonly run: AssessmentGraphRunContextV1;
  readonly state: AssessmentGraphStateV1;
  readonly stage: AssessmentStageV1;
  readonly occurredAt: string;
}): Promise<AssessmentBasisReleaseSetRefV1> => {
  const frozen = optionalFrozenRef({
    run: input.run,
    kind: "assessment-basis-release-set",
    schema: AssessmentBasisReleaseSetRefV1Schema,
    stage: input.stage,
    detailCode: "assessment-basis-invalid",
    occurredAt: input.occurredAt,
  });
  if (frozen !== undefined) return frozen;
  const entrySnapshotRef = input.state.entrySnapshotRef;
  if (entrySnapshotRef.kind !== "assessment-preparation") {
    // 分段入口的冻结输入没有评估准备快照可解析：缺失即按入口不完整安全失败（design D-03）。
    fail(
      entryIncomplete({
        stage: input.stage,
        detailCode: "assessment-basis-missing",
        occurredAt: input.occurredAt,
      }),
    );
  }
  const resolved = await input.ports.basisResolver.resolve({
    kind: "assessment-basis",
    commandId: actionIdFor(input.run, `${input.stage}:assessment-basis`),
    idempotencyKey: actionIdFor(input.run, `${input.stage}:assessment-basis`),
    projectId: input.run.projectId,
    actorId: input.run.actorId,
    issuedAt: input.run.issuedAt,
    authorization: input.run.authorization,
    payload: {
      preparationSnapshotRef: entrySnapshotRef.assessmentPreparationSnapshotRef,
      requiredAt: input.run.validAt,
    },
  });
  if (resolved.kind !== "succeeded") {
    fail(
      toAssessmentGraphError({
        stage: input.stage,
        error: { code: "UPSTREAM_WAITING", retryable: false },
        occurredAt: input.occurredAt,
      }),
    );
  }
  if (resolved.result.kind !== "assessment-basis") {
    fail(
      contractInvalid({
        stage: input.stage,
        detailCode: "assessment-basis-resolution-mismatch",
        occurredAt: input.occurredAt,
      }),
    );
  }
  return resolved.result.assessmentBasisReleaseSetRef;
};

/** 一次业务动作的提交材料：正文只入 C04，登记行、链边与审计同属一个 C03 事务。 */
interface StageCommitV1 {
  readonly actionSuffix: string;
  readonly commandKind: string;
  readonly bodies: readonly {
    readonly artifactId: string;
    readonly build: (
      artifactRefs: ReadonlyMap<string, ContentArtifactRefV1>,
    ) => WorkflowGraphArtifactBodyV1;
  }[];
  readonly rows: (
    artifactRefs: ReadonlyMap<string, ContentArtifactRefV1>,
    runVersionId: string,
  ) => readonly WorkflowGraphResultRowV1[];
  readonly links?: (
    artifactRefs: ReadonlyMap<string, ContentArtifactRefV1>,
    stageResultRef: StageResultRefV1 | undefined,
  ) => readonly WorkflowGraphLinkV1[];
  readonly runVersionId: string;
  readonly expectedRunVersionId: string | undefined;
  readonly occurredAt: string;
}

/** 登记行公共列：所有行只在同一 C03 事务里追加，不 UPDATE 既有行。 */
interface RowBaseV1 {
  readonly schemaVersion: "1";
  readonly projectId: string;
  readonly resultId: string;
  readonly resultVersionId: string;
  readonly runId: string;
  readonly runVersionId: string;
  readonly entryMode: WorkflowEntryModeV1;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly actorRef: string;
  readonly authorizationContextRef: AuthorizationContextV1["authorizationContextRef"];
  readonly authorizationScopeDigest: string;
  readonly validAt: string;
  readonly recordedAt: string;
  readonly persistedAt: string;
  readonly auditEntryId: string;
  readonly frozenRefs: readonly ContractReferenceV1[];
  readonly artifactRef?: ContentArtifactRefV1;
}

const rowBase = (input: {
  readonly run: AssessmentGraphRunContextV1;
  readonly artifactRef: ContentArtifactRefV1 | undefined;
  readonly runVersionId: string;
  readonly resultKind: WorkflowGraphResultRowV1["resultKind"];
  readonly idempotencySuffix: string;
  readonly auditEntryId: string;
  readonly recordedAt: string;
  readonly resultId: string;
  readonly resultVersionId: string;
}): RowBaseV1 => ({
  schemaVersion: "1",
  projectId: input.run.projectId,
  resultId: input.resultId,
  resultVersionId: input.resultVersionId,
  runId: input.run.runRef.reference.entityId,
  runVersionId: input.runVersionId,
  entryMode: input.run.entryMode,
  commandId: actionIdFor(input.run, input.idempotencySuffix),
  // 幂等键按运行身份（而非仅阶段）派生：同一工程下的不同评估子运行不得共享幂等键。
  idempotencyKey: `assessment-graph:${input.run.runRef.reference.versionId}:${input.resultKind}:${input.idempotencySuffix}`,
  requestDigest: sha256CanonicalJson({
    resultKind: input.resultKind,
    resultId: input.resultId,
    resultVersionId: input.resultVersionId,
  }),
  actorRef: input.run.actorId,
  authorizationContextRef: input.run.authorization.authorizationContextRef,
  authorizationScopeDigest: authorizationScopeDigest(input.run.authorization),
  validAt: input.run.validAt,
  recordedAt: input.recordedAt,
  persistedAt: input.recordedAt,
  auditEntryId: input.auditEntryId,
  frozenRefs: [],
  ...(input.artifactRef === undefined ? {} : { artifactRef: input.artifactRef }),
});

const artifactRefFrom = (
  artifactRefs: ReadonlyMap<string, ContentArtifactRefV1>,
  artifactId: string,
): ContentArtifactRefV1 => {
  const ref = artifactRefs.get(artifactId);
  if (ref === undefined) throw new TypeError("stage commit is missing a body reference");
  return ref;
};

/** 缺席链尾的类型化原因：原因码进引用身份，供投影从已成立事实重建。 */
const skippedTailRefFor = (input: {
  readonly runId: string;
  readonly tailKind: WorkflowSkippedTailV1["tailKind"];
  readonly reasonCode: string;
  readonly stage: AssessmentStageV1;
}): {
  readonly kind: "workflow-error";
  readonly reference: VersionReference;
} => ({
  kind: "workflow-error",
  reference: {
    entityId: `assessment-graph-skip:${input.tailKind}:${input.reasonCode}`,
    versionId: sha256CanonicalJson({
      runId: input.runId,
      tailKind: input.tailKind,
      reasonCode: input.reasonCode,
      stage: input.stage,
    }),
  },
});

/** 沉淀一条已成立事实的链边；未发生的关系不写空边（design D-05）。 */
export const assessmentGraphLink = (input: {
  readonly run: AssessmentGraphRunContextV1;
  readonly fromRef: ContractReferenceV1;
  readonly toRef: ContractReferenceV1;
  readonly relation: WorkflowLinkRelationV1;
  readonly stage: AssessmentStageV1;
  readonly stageResultRef?: StageResultRefV1;
  readonly recordedAt: string;
  readonly auditEntryId: string;
}): WorkflowGraphLinkV1 => {
  const linkId = `assessment-graph-link:${sha256CanonicalJson({
    runId: input.run.runRef.reference.entityId,
    fromRef: input.fromRef,
    toRef: input.toRef,
    relation: input.relation,
  })}`;
  return {
    schemaVersion: "1",
    projectId: input.run.projectId,
    linkId,
    runId: input.run.runRef.reference.entityId,
    fromRef: input.fromRef,
    toRef: input.toRef,
    relation: input.relation,
    sourceStage: input.stage,
    ...(input.stageResultRef === undefined ? {} : { stageResultRef: input.stageResultRef }),
    authorizationContextRef: input.run.authorization.authorizationContextRef,
    authorizationScopeDigest: authorizationScopeDigest(input.run.authorization),
    actorRef: input.run.actorId,
    recordedAt: input.recordedAt,
    auditEntryId: input.auditEntryId,
  };
};

/** C04 正文先行，随后 C03 事务提交登记行、链边与审计；checkpoint 由 LangGraph 之后独立写入。 */
const commitStage = async (
  ports: AssessmentGraphPortsV1,
  run: AssessmentGraphRunContextV1,
  commit: StageCommitV1,
): Promise<void> => {
  const actionId = actionIdFor(run, commit.actionSuffix);
  const artifactRefs = new Map<string, ContentArtifactRefV1>();
  for (const body of commit.bodies) {
    // C04 幂等键按正文身份派生：一次阶段提交可能写多份正文，复用同一命令身份会因
    // 「同键异载荷」被判为工件幂等冲突；同轮重放仍得同键。
    const put = await ports.bodies.putBody({
      projectId: run.projectId,
      actorId: run.actorId,
      commandId: `${actionId}:body:${body.artifactId}`,
      issuedAt: run.issuedAt,
      artifactId: body.artifactId,
      body: WorkflowGraphArtifactBodyV1Schema.parse(body.build(artifactRefs)),
      authorization: run.authorization,
    });
    artifactRefs.set(body.artifactId, ContentArtifactRefV1Schema.parse(put));
  }
  const rows = commit
    .rows(artifactRefs, commit.runVersionId)
    .map((row) => WorkflowGraphResultRowV1Schema.parse(row));
  const primary = rows[0];
  if (primary === undefined) throw new TypeError("stage commit requires at least one row");
  const auditEntryId = `${actionId}:audit`;
  const fallbackTargetRef: ContractReferenceV1 = {
    kind: "workflow-run",
    reference: {
      entityId: run.runRef.reference.entityId,
      versionId: commit.runVersionId,
    },
  };
  await ports.transactionUnit.execute(
    {
      projectId: run.projectId,
      commandKind: commit.commandKind,
      commandId: actionId,
      idempotencyKey: actionId,
      payload: { actionSuffix: commit.actionSuffix, runVersionId: commit.runVersionId },
      actorRef: run.actorId,
      authorizationContextRef: run.authorization.authorizationContextRef,
      issuedAt: run.issuedAt,
      runId: run.runRef.reference.entityId,
      threadId: run.threadId,
    },
    async (context: TransactionContextV1): Promise<AtomicCommitV1> => {
      const stageResultRef = rows.find((row) => row.resultKind === "stage-result")?.stageResultRef;
      await ports.registrationStore.assertCurrentRunVersion(
        {
          projectId: run.projectId,
          runId: run.runRef.reference.entityId,
          expectedRunVersionId: commit.expectedRunVersionId,
        },
        context,
      );
      for (const row of rows) {
        const outcome = await ports.registrationStore.registerRow(
          { row, occurredAt: commit.occurredAt },
          context,
        );
        if (outcome.kind === "idempotency-conflict") {
          throw new AssessmentGraphConflictV1(outcome.priorCommandId);
        }
      }
      for (const link of commit.links?.(artifactRefs, stageResultRef) ?? []) {
        // 链边与登记行同属本次提交的审计条目（design D-05）：审计身份由阶段提交决定，
        // 不由阶段名另行派生——动作后缀含运行结果摘要时派生值会与审计行不一致，被审计外键拒绝。
        const outcome = await ports.registrationStore.registerLink(
          { link: { ...link, auditEntryId } },
          context,
        );
        if (outcome.kind === "idempotency-conflict") {
          throw new AssessmentGraphConflictV1(outcome.priorCommandId);
        }
      }
      return {
        resultRef: primary.artifactRef ?? fallbackTargetRef,
        audit: {
          auditEntryId,
          projectId: run.projectId,
          action: commit.commandKind,
          targetRef: primary.artifactRef ?? fallbackTargetRef,
          actorRef: run.actorId,
          authorizationContextRef: run.authorization.authorizationContextRef,
          occurredAt: commit.occurredAt,
          recordedAt: ports.now().toISOString(),
          version: { entityId: primary.resultId, versionId: primary.resultVersionId },
          commandId: actionId,
          idempotencyKey: actionId,
          runId: run.runRef.reference.entityId,
          threadId: run.threadId,
        },
        events: [],
      };
    },
  );
};

export const readAssessmentCursor = async (input: {
  readonly ports: AssessmentGraphPortsV1;
  readonly run: AssessmentGraphRunContextV1;
}): Promise<WorkflowGraphRunStateV1 | undefined> => {
  const latest = await input.ports.registrationStore.readLatestRunState({
    projectId: input.run.projectId,
    runId: input.run.runRef.reference.entityId,
    actorId: input.run.actorId,
    requestedAt: input.run.issuedAt,
    authorization: input.run.authorization,
  });
  return latest?.state;
};

interface CursorPatchV1 {
  readonly acceptedRiskRecordRefs?: WorkflowGraphRunStateV1["acceptedRiskRecordRefs"];
  readonly assessmentRecordRefs?: WorkflowGraphRunStateV1["assessmentRecordRefs"];
  readonly warningRecordRefs?: WorkflowGraphRunStateV1["warningRecordRefs"];
  readonly responseRecommendationRefs?: WorkflowGraphRunStateV1["responseRecommendationRefs"];
  readonly deviationRecordRefs?: WorkflowGraphRunStateV1["deviationRecordRefs"];
  readonly calibrationSuggestionRefs?: WorkflowGraphRunStateV1["calibrationSuggestionRefs"];
  readonly assessmentRunRefs?: WorkflowGraphRunStateV1["assessmentRunRefs"];
  readonly lastStageResultRef?: WorkflowGraphRunStateV1["lastStageResultRef"];
  readonly lastRouteDecisionRef?: WorkflowGraphRunStateV1["lastRouteDecisionRef"];
  readonly lastWaitingRef?: WorkflowGraphRunStateV1["lastWaitingRef"];
  readonly lastErrorRef?: WorkflowGraphRunStateV1["lastErrorRef"];
  readonly resultRef?: WorkflowGraphRunStateV1["resultRef"];
}

/** 游标内容 → 游标正文：只按前一版本与本次阶段/状态追加新版本（design D-05）。 */
const cursorBody = (input: {
  readonly run: AssessmentGraphRunContextV1;
  readonly stage: AssessmentStageV1;
  readonly status: WorkflowGraphRunStateV1["status"];
  readonly previous: WorkflowGraphRunStateV1 | undefined;
  readonly recordedAt: string;
  readonly patch?: CursorPatchV1;
}): { readonly state: WorkflowGraphRunStateV1; readonly body: WorkflowGraphArtifactBodyV1 } => {
  const previous = input.previous;
  const patch = input.patch ?? {};
  const lastStageResultRef = patch.lastStageResultRef ?? previous?.lastStageResultRef;
  const lastRouteDecisionRef = patch.lastRouteDecisionRef ?? previous?.lastRouteDecisionRef;
  const lastWaitingRef = patch.lastWaitingRef ?? previous?.lastWaitingRef;
  const lastErrorRef = patch.lastErrorRef ?? previous?.lastErrorRef;
  const resultRef = patch.resultRef ?? previous?.resultRef;
  // 子图每次形成 run-state 工件都保留同一重评入口事实（design D-12）：优先本轮上下文，
  // 否则沿用前一版本已登记值。缺该字段的历史重评不补猜，由读端与继续评估失败闭合。
  const reassessmentEntry = input.run.reassessmentEntry ?? previous?.reassessmentEntry;
  if (reassessmentEntry === undefined && input.run.entryMode === "reassess") {
    // 继续评估失败闭合：重评缺少原入口事实时不得推进，也不得从前驱字段反推。
    throw new AssessmentGraphNodeFailureV1(
      graphError({
        code: "CONTRACT_INVALID",
        stage: "A0",
        detailCode: "reassessment-entry-fact-missing",
        occurredAt: input.recordedAt,
      }),
    );
  }
  const withoutVersion: Omit<WorkflowGraphRunStateV1, "runVersionId"> = {
    schemaVersion: "1",
    projectId: input.run.projectId,
    runId: input.run.runRef.reference.entityId,
    entryMode: input.run.entryMode,
    entryIdentity: input.run.entryIdentity,
    stage: input.stage,
    status: input.status,
    // 精确图版本与重评入口同理：每次形成 run-state 工件都写入同一启动值（design D-04）。
    graphVersion: input.run.graphVersion,
    ...(reassessmentEntry === undefined ? {} : { reassessmentEntry }),
    ...(input.run.parentRunRef === undefined ? {} : { parentRunRef: input.run.parentRunRef }),
    assessmentRunRefs: patch.assessmentRunRefs ?? previous?.assessmentRunRefs ?? [],
    acceptedRiskRecordRefs: patch.acceptedRiskRecordRefs ?? previous?.acceptedRiskRecordRefs ?? [],
    assessmentRecordRefs: patch.assessmentRecordRefs ?? previous?.assessmentRecordRefs ?? [],
    warningRecordRefs: patch.warningRecordRefs ?? previous?.warningRecordRefs ?? [],
    responseRecommendationRefs:
      patch.responseRecommendationRefs ?? previous?.responseRecommendationRefs ?? [],
    deviationRecordRefs: patch.deviationRecordRefs ?? previous?.deviationRecordRefs ?? [],
    calibrationSuggestionRefs:
      patch.calibrationSuggestionRefs ?? previous?.calibrationSuggestionRefs ?? [],
    ...(lastStageResultRef === undefined ? {} : { lastStageResultRef }),
    ...(lastRouteDecisionRef === undefined ? {} : { lastRouteDecisionRef }),
    ...(lastWaitingRef === undefined ? {} : { lastWaitingRef }),
    ...(lastErrorRef === undefined ? {} : { lastErrorRef }),
    ...(resultRef === undefined ? {} : { resultRef }),
    recordedAt: input.recordedAt,
  };
  const runVersionId =
    previous === undefined
      ? initialRunVersionId({
          runId: input.run.runRef.reference.entityId,
          entryMode: input.run.entryMode,
          recordedAt: input.recordedAt,
        })
      : nextRunVersionId({
          runId: input.run.runRef.reference.entityId,
          previousRunVersionId: previous.runVersionId,
          stage: input.stage,
          status: input.status,
          recordedAt: input.recordedAt,
        });
  const state = WorkflowGraphRunStateV1Schema.parse({ ...withoutVersion, runVersionId });
  return { state, body: { bodyKind: "run-state", runState: state } };
};

const assessmentRunResultRefFor = (input: {
  readonly run: AssessmentGraphRunContextV1;
  readonly runResult: unknown;
}): { readonly kind: "assessment-run-result"; readonly reference: VersionReference } => ({
  kind: "assessment-run-result",
  reference: {
    entityId: `assessment-run-result:${input.run.projectId}:${input.run.runRef.reference.entityId}`,
    versionId: sha256CanonicalJson(input.runResult),
  },
});

const stageResultRefFor = (input: {
  readonly run: AssessmentGraphRunContextV1;
  readonly stage: AssessmentStageV1;
  readonly suffix: string;
  readonly stageResult: unknown;
}): StageResultRefV1 => ({
  kind: "stage-result",
  reference: {
    entityId: `assessment-stage-result:${input.run.runRef.reference.entityId}:${input.stage}:${input.suffix}`,
    versionId: sha256CanonicalJson(AssessmentStageResultV1Schema.parse(input.stageResult)),
  },
});

interface StatePatchV1 {
  /** A0 冻结出的真实入口快照：起始种子只在推进到 A1 之前有效。 */
  readonly entrySnapshotRef?: AssessmentGraphStateV1["entrySnapshotRef"];
  readonly assessmentInputSnapshotRef?: AssessmentGraphStateV1["assessmentInputSnapshotRef"];
  readonly assessmentRecordRef?: AssessmentGraphStateV1["assessmentRecordRef"];
  readonly warningRecordRefs?: AssessmentGraphStateV1["warningRecordRefs"];
  readonly warningResponseTaskRefs?: AssessmentGraphStateV1["warningResponseTaskRefs"];
  readonly recommendationCandidateRef?: AssessmentGraphStateV1["recommendationCandidateRef"];
  readonly agentTaskRefs?: AssessmentGraphStateV1["agentTaskRefs"];
  readonly responseRecommendationRef?: AssessmentGraphStateV1["responseRecommendationRef"];
  readonly effectForecastRef?: AssessmentGraphStateV1["effectForecastRef"];
  readonly executionRecordRef?: AssessmentGraphStateV1["executionRecordRef"];
  readonly feedbackRef?: AssessmentGraphStateV1["feedbackRef"];
  readonly deviationRecordRef?: AssessmentGraphStateV1["deviationRecordRef"];
  readonly calibrationSuggestionRef?: AssessmentGraphStateV1["calibrationSuggestionRef"];
  readonly reviewTaskRefs?: AssessmentGraphStateV1["reviewTaskRefs"];
  readonly resultRef?: AssessmentGraphStateV1["resultRef"];
}

interface AdvanceInputV1 {
  readonly ports: AssessmentGraphPortsV1;
  readonly run: AssessmentGraphRunContextV1;
  readonly state: AssessmentGraphStateV1;
  /** 已完成工作的阶段。 */
  readonly stage: AssessmentStageV1;
  /** 下一个要执行的阶段。 */
  readonly nextStage: AssessmentStageV1;
  readonly actionSuffix: string;
  readonly cursor: WorkflowGraphRunStateV1 | undefined;
  readonly cursorPatch?: CursorPatchV1;
  readonly stageResult?: unknown;
  readonly status?: WorkflowGraphRunStateV1["status"];
  readonly runResult?: WorkflowGraphRunResultV1;
  readonly extraRows?: (input: {
    readonly artifactRefs: ReadonlyMap<string, ContentArtifactRefV1>;
    readonly runVersionId: string;
    readonly auditEntryId: string;
    readonly occurredAt: string;
    readonly runStateArtifactId: string;
  }) => readonly WorkflowGraphResultRowV1[];
  readonly links?: (stageResultRef: StageResultRefV1 | undefined) => readonly WorkflowGraphLinkV1[];
  readonly statePatch?: StatePatchV1;
  readonly commandKind: string;
}

/**
 * 推进一个阶段：写运行状态正文（与可选的运行汇总正文），再在**同一** C03 事务里登记阶段结果行、
 * 新游标行、额外行与链边，并让状态指向下一阶段（design D-05）。
 */
const advance = async (input: AdvanceInputV1): Promise<AssessmentGraphStateV1> => {
  const { ports, run, state } = input;
  const occurredAt = ports.now().toISOString();
  const suffix = input.actionSuffix;
  const runStateArtifactId = artifactIdFor("run-state", run.runRef.reference.entityId, suffix);
  const runResultArtifactId = artifactIdFor("run-result", run.runRef.reference.entityId, suffix);
  const writtenStageResultRef =
    input.stageResult === undefined
      ? undefined
      : stageResultRefFor({ run, stage: input.stage, suffix, stageResult: input.stageResult });
  const cursor = cursorBody({
    run,
    stage: input.nextStage,
    status: input.status ?? "running",
    previous: input.cursor,
    recordedAt: occurredAt,
    patch: {
      ...(input.cursorPatch ?? {}),
      ...(writtenStageResultRef === undefined ? {} : { lastStageResultRef: writtenStageResultRef }),
    },
  });
  const bodies: {
    readonly artifactId: string;
    readonly build: (
      artifactRefs: ReadonlyMap<string, ContentArtifactRefV1>,
    ) => WorkflowGraphArtifactBodyV1;
  }[] = [{ artifactId: runStateArtifactId, build: () => cursor.body }];
  if (input.runResult !== undefined) {
    const runResult = input.runResult;
    bodies.push({
      artifactId: runResultArtifactId,
      build: () => ({ bodyKind: "run-result", runResult }),
    });
  }
  const actionId = actionIdFor(run, suffix);
  await commitStage(ports, run, {
    actionSuffix: suffix,
    commandKind: input.commandKind,
    bodies,
    runVersionId: cursor.state.runVersionId,
    expectedRunVersionId: input.cursor?.runVersionId,
    occurredAt,
    rows: (refs, runVersionId) => {
      const runStateRef = artifactRefFrom(refs, runStateArtifactId);
      const rows: WorkflowGraphResultRowV1[] = [];
      if (writtenStageResultRef !== undefined) {
        rows.push(
          WorkflowGraphResultRowV1Schema.parse({
            ...rowBase({
              run,
              artifactRef: runStateRef,
              runVersionId,
              resultKind: "stage-result",
              idempotencySuffix: suffix,
              auditEntryId: `${actionId}:audit`,
              recordedAt: occurredAt,
              resultId: writtenStageResultRef.reference.entityId,
              resultVersionId: writtenStageResultRef.reference.versionId,
            }),
            resultKind: "stage-result",
            stage: input.stage,
            stageResultRef: writtenStageResultRef,
          }),
        );
      }
      rows.push(
        WorkflowGraphResultRowV1Schema.parse({
          ...rowBase({
            run,
            artifactRef: runStateRef,
            runVersionId,
            resultKind: "run-state",
            idempotencySuffix: `${suffix}:run-state:${runVersionId}`,
            auditEntryId: `${actionId}:audit`,
            recordedAt: occurredAt,
            resultId: `assessment-run-state:${run.runRef.reference.entityId}`,
            resultVersionId: runVersionId,
          }),
          resultKind: "run-state",
          stage: input.nextStage,
        }),
      );
      rows.push(
        ...(input.extraRows?.({
          artifactRefs: refs,
          runVersionId,
          auditEntryId: `${actionId}:audit`,
          occurredAt,
          runStateArtifactId,
        }) ?? []),
      );
      return rows;
    },
    ...(input.links === undefined
      ? {}
      : { links: (_refs, stageResultRef) => input.links?.(stageResultRef) ?? [] }),
  });
  const patch = input.statePatch ?? {};
  const resultRef = patch.resultRef ?? state.resultRef;
  const nextState: AssessmentGraphStateV1 = {
    schemaVersion: "1",
    graphVersion: state.graphVersion,
    parentRiskFlowRunRef: state.parentRiskFlowRunRef,
    runRef: state.runRef,
    threadId: state.threadId,
    entryMode: state.entryMode,
    authorizationContextRef: state.authorizationContextRef,
    entrySnapshotRef: patch.entrySnapshotRef ?? state.entrySnapshotRef,
    status: input.status ?? "running",
    stage: input.nextStage,
    warningRecordRefs: patch.warningRecordRefs ?? state.warningRecordRefs,
    warningResponseTaskRefs: patch.warningResponseTaskRefs ?? state.warningResponseTaskRefs,
    agentTaskRefs: patch.agentTaskRefs ?? state.agentTaskRefs,
    reviewTaskRefs: patch.reviewTaskRefs ?? state.reviewTaskRefs,
    ...((patch.assessmentInputSnapshotRef ?? state.assessmentInputSnapshotRef) === undefined
      ? {}
      : {
          assessmentInputSnapshotRef:
            patch.assessmentInputSnapshotRef ?? state.assessmentInputSnapshotRef,
        }),
    ...((patch.assessmentRecordRef ?? state.assessmentRecordRef) === undefined
      ? {}
      : { assessmentRecordRef: patch.assessmentRecordRef ?? state.assessmentRecordRef }),
    ...((patch.recommendationCandidateRef ?? state.recommendationCandidateRef) === undefined
      ? {}
      : {
          recommendationCandidateRef:
            patch.recommendationCandidateRef ?? state.recommendationCandidateRef,
        }),
    ...((patch.responseRecommendationRef ?? state.responseRecommendationRef) === undefined
      ? {}
      : {
          responseRecommendationRef:
            patch.responseRecommendationRef ?? state.responseRecommendationRef,
        }),
    ...((patch.effectForecastRef ?? state.effectForecastRef) === undefined
      ? {}
      : { effectForecastRef: patch.effectForecastRef ?? state.effectForecastRef }),
    ...((patch.executionRecordRef ?? state.executionRecordRef) === undefined
      ? {}
      : { executionRecordRef: patch.executionRecordRef ?? state.executionRecordRef }),
    ...((patch.feedbackRef ?? state.feedbackRef) === undefined
      ? {}
      : { feedbackRef: patch.feedbackRef ?? state.feedbackRef }),
    ...((patch.deviationRecordRef ?? state.deviationRecordRef) === undefined
      ? {}
      : { deviationRecordRef: patch.deviationRecordRef ?? state.deviationRecordRef }),
    ...((patch.calibrationSuggestionRef ?? state.calibrationSuggestionRef) === undefined
      ? {}
      : {
          calibrationSuggestionRef:
            patch.calibrationSuggestionRef ?? state.calibrationSuggestionRef,
        }),
    ...(writtenStageResultRef === undefined
      ? state.lastStageResultRef === undefined
        ? {}
        : { lastStageResultRef: state.lastStageResultRef }
      : { lastStageResultRef: writtenStageResultRef }),
    ...(state.lastRouteDecisionRef === undefined
      ? {}
      : { lastRouteDecisionRef: state.lastRouteDecisionRef }),
    ...(resultRef === undefined ? {} : { resultRef }),
    ...(state.lastErrorRef === undefined ? {} : { lastErrorRef: state.lastErrorRef }),
  };
  return parseAssessmentGraphState(nextState, occurredAt);
};

/**
 * 阶段收口：登记行与运行状态正文的阶段集合同时容纳父/识别阶段，评估子运行只接受 A0～A9
 * （design D-05），其它取值按契约失败收口，绝不把父运行阶段写进评估事实。
 */
export const assessmentStageOf = (
  stage: WorkflowRunStageV1,
  occurredAt: string,
): AssessmentStageV1 => {
  const matched = FULL_STAGE_SEQUENCE_V1.find((candidate) => candidate === stage);
  if (matched === undefined) {
    fail(contractInvalid({ stage: "A0", detailCode: "run-stage-not-assessment", occurredAt }));
  }
  return matched;
};

/**
 * 协作式取消登记（design D-08）：只追加取消态运行状态与类型化原因，未开始的节点不再被推进，
 * 已提交的领域事实、审计与链边一律保留。
 */
export const recordAssessmentCancellation = async (input: {
  readonly ports: AssessmentGraphPortsV1;
  readonly run: AssessmentGraphRunContextV1;
  readonly state: AssessmentGraphStateV1;
  readonly cursor: WorkflowGraphRunStateV1;
  readonly reasonCode: string;
}): Promise<AssessmentGraphStateV1> => {
  const occurredAt = input.ports.now().toISOString();
  const stage = assessmentStageOf(input.cursor.stage, occurredAt);
  const errorRef = {
    kind: "workflow-error" as const,
    reference: {
      entityId: `assessment-graph-cancelled:${input.run.runRef.reference.entityId}`,
      versionId: sha256CanonicalJson({
        runVersionId: input.cursor.runVersionId,
        reasonCode: input.reasonCode,
      }),
    },
  };
  // 取消是终态：公共状态与运行状态都必须携带结果引用（收口 Schema 要求终态有结果），
  // 取消结果引用只由被取消的运行身份与本次取消原因确定，不携带任何领域事实。
  const cancellationResultRef: NonNullable<AssessmentGraphStateV1["resultRef"]> = {
    kind: "assessment-run-result",
    reference: {
      entityId: `assessment-cancellation:${input.run.projectId}:${input.run.runRef.reference.entityId}`,
      versionId: sha256CanonicalJson({
        runVersionId: input.cursor.runVersionId,
        reasonCode: input.reasonCode,
      }),
    },
  };
  return await advance({
    ports: input.ports,
    run: input.run,
    state: input.state,
    stage,
    nextStage: stage,
    status: "cancelled",
    actionSuffix: `cancel:${sha256CanonicalJson({
      runVersionId: input.cursor.runVersionId,
      reasonCode: input.reasonCode,
    }).slice(0, 32)}`,
    cursor: input.cursor,
    commandKind: "assessment-graph.cancel",
    cursorPatch: { lastErrorRef: errorRef, resultRef: cancellationResultRef },
    statePatch: { resultRef: cancellationResultRef },
  });
};

/** 登记等待事实后再暂停：等待投影与游标同一事务提交（design D-05）。 */
const waitFor = async (input: {
  readonly ports: AssessmentGraphPortsV1;
  readonly run: AssessmentGraphRunContextV1;
  readonly state: AssessmentGraphStateV1;
  readonly stage: AssessmentStageV1;
  readonly cursor: WorkflowGraphRunStateV1 | undefined;
  readonly waitingRef: AssessmentGraphStateV1["waitingRef"];
  readonly suffix: string;
  readonly statePatch?: StatePatchV1;
}): Promise<AssessmentGraphStateV1> => {
  const { ports, run, state, stage, cursor } = input;
  const occurredAt = ports.now().toISOString();
  const waitingRef = input.waitingRef;
  if (waitingRef === undefined) {
    fail(contractInvalid({ stage, detailCode: "waiting-reference-missing", occurredAt }));
  }
  const suffix = `${input.suffix}:waiting`;
  const runStateArtifactId = artifactIdFor("run-state", run.runRef.reference.entityId, suffix);
  const cursorState = cursorBody({
    run,
    stage,
    status: "waiting",
    previous: cursor,
    recordedAt: occurredAt,
    patch: { lastWaitingRef: waitingRef },
  });
  const actionId = actionIdFor(run, suffix);
  const waitingResultId =
    waitingRef.kind === "review"
      ? `assessment-waiting:review:${waitingRef.reviewTaskRef.reference.entityId}`
      : waitingRef.kind === "agent-task"
        ? `assessment-waiting:agent-task:${waitingRef.agentTaskRef.reference.entityId}`
        : `assessment-waiting:${run.runRef.reference.entityId}:${stage}`;
  await commitStage(ports, run, {
    actionSuffix: suffix,
    commandKind: "assessment-graph.wait",
    bodies: [{ artifactId: runStateArtifactId, build: () => cursorState.body }],
    runVersionId: cursorState.state.runVersionId,
    expectedRunVersionId: cursor?.runVersionId,
    occurredAt,
    rows: (refs, runVersionId) => [
      WorkflowGraphResultRowV1Schema.parse({
        ...rowBase({
          run,
          artifactRef: artifactRefFrom(refs, runStateArtifactId),
          runVersionId,
          resultKind: "waiting",
          idempotencySuffix: suffix,
          auditEntryId: `${actionId}:audit`,
          recordedAt: occurredAt,
          resultId: waitingResultId,
          resultVersionId: sha256CanonicalJson(waitingRef),
        }),
        resultKind: "waiting",
        stage,
        waitingRef,
      }),
      WorkflowGraphResultRowV1Schema.parse({
        ...rowBase({
          run,
          artifactRef: artifactRefFrom(refs, runStateArtifactId),
          runVersionId,
          resultKind: "run-state",
          idempotencySuffix: `${suffix}:run-state:${runVersionId}`,
          auditEntryId: `${actionId}:audit`,
          recordedAt: occurredAt,
          resultId: `assessment-run-state:${run.runRef.reference.entityId}`,
          resultVersionId: runVersionId,
        }),
        resultKind: "run-state",
        stage,
      }),
    ],
  });
  const patch = input.statePatch ?? {};
  return parseAssessmentGraphState(
    {
      ...state,
      stage,
      status: "waiting",
      waitingRef,
      agentTaskRefs: patch.agentTaskRefs ?? state.agentTaskRefs,
      reviewTaskRefs: patch.reviewTaskRefs ?? state.reviewTaskRefs,
    },
    occurredAt,
  );
};

/** 冻结运行策略集：只按冻结准备与依据引用解析，不用调用方当前视图替换（design D-03）。 */
export const readRuntimePolicySetForRun = async (input: {
  readonly ports: AssessmentGraphPortsV1;
  readonly run: AssessmentGraphRunContextV1;
  readonly stage: AssessmentStageV1;
  readonly preparationSnapshotRef: AssessmentPreparationSnapshotRefV1;
  readonly basisReleaseSetRef: AssessmentBasisReleaseSetRefV1;
}): Promise<AssessmentRuntimePolicySetV1> => {
  const occurredAt = input.ports.now().toISOString();
  const resolved = await input.ports.runtimePolicies.readRuntimePolicySet({
    requestId: actionIdFor(input.run, `${input.stage}:runtime-policies`),
    idempotencyKey: actionIdFor(input.run, `${input.stage}:runtime-policies`),
    requestedAt: input.run.issuedAt,
    requiredAt: input.run.validAt,
    authorization: input.run.authorization,
    preparationSnapshotRef: input.preparationSnapshotRef,
    assessmentBasisReleaseSetRef: input.basisReleaseSetRef,
  });
  if (resolved.kind === "failed") {
    fail(toAssessmentGraphError({ stage: input.stage, error: resolved.error, occurredAt }));
  }
  return resolved.policySet;
};

const readBasisReleaseSet = async (input: {
  readonly ports: AssessmentGraphPortsV1;
  readonly run: AssessmentGraphRunContextV1;
  readonly stage: AssessmentStageV1;
  readonly basisReleaseSetRef: AssessmentBasisReleaseSetRefV1;
}): Promise<Extract<AssessmentBasisReleaseSetReadResultV1, { readonly kind: "succeeded" }>> => {
  const occurredAt = input.ports.now().toISOString();
  const read = await input.ports.basis.readAssessmentBasisReleaseSet({
    requestId: actionIdFor(input.run, `${input.stage}:basis`),
    idempotencyKey: actionIdFor(input.run, `${input.stage}:basis`),
    requestedAt: input.run.issuedAt,
    authorization: input.run.authorization,
    assessmentBasisReleaseSetRef: input.basisReleaseSetRef,
  });
  if (read.kind !== "succeeded") {
    fail(toAssessmentGraphError({ stage: input.stage, error: read.error, occurredAt }));
  }
  return read;
};

const auditTrailRefFor = (run: AssessmentGraphRunContextV1) => ({
  kind: "audit-trail" as const,
  reference: {
    entityId: `${run.commandId}:assessment-graph`,
    versionId: sha256CanonicalJson({ runId: run.runRef.reference.entityId, scope: "assessment" }),
  },
});

/** 只读冻结策略与依据的运行策略集，供 A6/A7/A8 复用（不复制领域规则）。 */
const runtimePoliciesFor = async (input: {
  readonly ports: AssessmentGraphPortsV1;
  readonly run: AssessmentGraphRunContextV1;
  readonly state: AssessmentGraphStateV1;
  readonly stage: AssessmentStageV1;
}): Promise<AssessmentRuntimePolicySetV1> => {
  const occurredAt = input.ports.now().toISOString();
  const entrySnapshotRef = input.state.entrySnapshotRef;
  if (entrySnapshotRef.kind !== "assessment-preparation") {
    fail(
      contractInvalid({
        stage: input.stage,
        detailCode: "assessment-preparation-entry-missing",
        occurredAt,
      }),
    );
  }
  return await readRuntimePolicySetForRun({
    ports: input.ports,
    run: input.run,
    stage: input.stage,
    preparationSnapshotRef: entrySnapshotRef.assessmentPreparationSnapshotRef,
    basisReleaseSetRef: await resolveBasisReleaseSetRef({
      ports: input.ports,
      run: input.run,
      state: input.state,
      stage: input.stage,
      occurredAt,
    }),
  });
};

/** C19 依据里“度量库”成员 → C27 查询的精确释放引用（成员身份唯一决定，不猜最新）。 */
const measureLibraryReleaseRefOf = (input: {
  readonly read: Extract<AssessmentBasisReleaseSetReadResultV1, { readonly kind: "succeeded" }>;
  readonly stage: AssessmentStageV1;
  readonly occurredAt: string;
}): MeasureLibraryReleaseRefV1 => {
  const member = input.read.configurationMembers.find(
    (candidate) => candidate.definitionType === "measure-library",
  );
  if (member === undefined) {
    fail(
      contractInvalid({
        stage: input.stage,
        detailCode: "measure-library-member-missing",
        occurredAt: input.occurredAt,
      }),
    );
  }
  return { kind: "measure-library-release", reference: member.releaseRef.reference };
};

/** 入口冻结（design D-03/D-04）：每个入口用自己的冻结事实，不复制识别正文。 */
export interface AssessmentEntryResolutionV1 {
  readonly entrySnapshotRef: AssessmentGraphStateV1["entrySnapshotRef"];
  readonly entryIdentity: VersionReference;
  /** 评估准备入口的 A0 阶段结果；分段入口不产生 A0 阶段结果（无对应公共变体）。 */
  readonly stageResult: unknown;
  readonly forecastSnapshot?: ResponseForecastInputSnapshotV1;
}

export const resolveAssessmentEntry = async (input: {
  readonly ports: AssessmentGraphPortsV1;
  readonly run: AssessmentGraphRunContextV1;
  readonly occurredAt: string;
}): Promise<AssessmentEntryResolutionV1> => {
  const { ports, run, occurredAt } = input;
  switch (run.entryMode) {
    case "forecast-response": {
      const basisReleaseSetRef = segmentedBasisReleaseSetRefOf({ run, stage: "A0", occurredAt });
      const policy = await ports.policies.resolveForecastPolicy({
        projectId: run.projectId,
        basisReleaseSetRef,
        requiredAt: run.validAt,
        authorization: run.authorization,
      });
      if (policy.kind !== "resolved") {
        fail(
          entryIncomplete({
            stage: "A0",
            detailCode: `forecast-policy-${policy.reasonCode}`,
            occurredAt,
          }),
        );
      }
      const snapshot = ResponseForecastInputSnapshotV1Schema.parse({
        schemaVersion: "1",
        responseRecommendationRef: requiredFrozenRef({
          run,
          kind: "response-recommendation",
          schema: ResponseRecommendationRefV1Schema,
          stage: "A0",
          detailCode: "adopted-recommendation-missing",
          occurredAt,
        }),
        adoptionDecisionRef: requiredFrozenRef({
          run,
          kind: "route-decision",
          schema: RouteDecisionRefV1Schema,
          stage: "A0",
          detailCode: "adoption-decision-missing",
          occurredAt,
        }),
        preActionMonitoringSnapshotRef: requiredFrozenRef({
          run,
          kind: "monitoring-snapshot",
          schema: MonitoringSnapshotRefV1Schema,
          stage: "A0",
          detailCode: "pre-action-monitoring-missing",
          occurredAt,
        }),
        frozenAssessmentBasisRef: requiredFrozenRef({
          run,
          kind: "assessment-input-snapshot",
          schema: AssessmentInputSnapshotRefV1Schema,
          stage: "A0",
          detailCode: "frozen-assessment-basis-missing",
          occurredAt,
        }),
        forecastPolicyRef: policy.forecastPolicyRef,
        authorizationContextRef: run.authorization.authorizationContextRef,
        auditTrailRef: auditTrailRefFor(run),
        createdBy: run.actorId,
        createdAt: run.issuedAt,
      });
      const snapshotRef = ResponseForecastInputSnapshotRefV1Schema.parse({
        kind: "response-forecast-input-snapshot",
        reference: {
          entityId: `response-forecast-input:${run.projectId}:${run.runRef.reference.versionId}`,
          versionId: sha256CanonicalJson(snapshot),
        },
      });
      return {
        entrySnapshotRef: {
          kind: "forecast-input",
          responseForecastInputSnapshotRef: snapshotRef,
        },
        entryIdentity: snapshotRef.reference,
        stageResult: undefined,
        forecastSnapshot: snapshot,
      };
    }
    case "record-response-feedback": {
      const basisReleaseSetRef = segmentedBasisReleaseSetRefOf({ run, stage: "A0", occurredAt });
      const policy = await ports.policies.resolveCalibrationPolicy({
        projectId: run.projectId,
        basisReleaseSetRef,
        requiredAt: run.validAt,
        authorization: run.authorization,
      });
      if (policy.kind !== "resolved") {
        fail(
          entryIncomplete({
            stage: "A0",
            detailCode: `calibration-policy-${policy.reasonCode}`,
            occurredAt,
          }),
        );
      }
      const forecastRef = optionalFrozenRef({
        run,
        kind: "effect-forecast",
        schema: EffectForecastRefV1Schema,
        stage: "A0",
        detailCode: "effect-forecast-invalid",
        occurredAt,
      });
      const snapshot = ResponseFeedbackInputSnapshotV1Schema.parse({
        schemaVersion: "1",
        executionRecordRef: requiredFrozenRef({
          run,
          kind: "execution-record",
          schema: ExecutionRecordRefV1Schema,
          stage: "A0",
          detailCode: "execution-record-missing",
          occurredAt,
        }),
        feedbackRef: requiredFrozenRef({
          run,
          kind: "feedback",
          schema: FeedbackRefV1Schema,
          stage: "A0",
          detailCode: "feedback-missing",
          occurredAt,
        }),
        ...(forecastRef === undefined ? {} : { effectForecastRef: forecastRef }),
        deviationPolicyRef: policy.calibrationValidationPolicyRef,
        calibrationAgentPolicyRef: policy.agentPolicy.policyRef,
        authorizationContextRef: run.authorization.authorizationContextRef,
        auditTrailRef: auditTrailRefFor(run),
        createdBy: run.actorId,
        createdAt: run.issuedAt,
      });
      const snapshotRef = {
        kind: "response-feedback-input-snapshot" as const,
        reference: {
          entityId: `response-feedback-input:${run.projectId}:${run.runRef.reference.versionId}`,
          versionId: sha256CanonicalJson(snapshot),
        },
      };
      return {
        entrySnapshotRef: {
          kind: "feedback-input",
          responseFeedbackInputSnapshotRef: snapshotRef,
        },
        entryIdentity: snapshotRef.reference,
        stageResult: undefined,
      };
    }
    default: {
      const refs = entryRefsOf({ run, stage: "A0", occurredAt });
      // A0 的前驱同样取自已登记的重评入口事实（design D-12），不从冻结引用集合反查。
      const previousAssessmentRecordRef =
        run.reassessmentEntry === undefined
          ? undefined
          : parseWith(
              RiskAssessmentRecordRefV1Schema,
              run.reassessmentEntry.previousAssessmentRecordRef,
            );
      const frozen = await ports.engineeringData.freeze({
        commandId: actionIdFor(run, "A0"),
        idempotencyKey: actionIdFor(run, "A0"),
        projectId: run.projectId,
        actorId: run.actorId,
        issuedAt: run.issuedAt,
        authorization: run.authorization,
        kind: "assessment-preparation",
        payload: {
          riskInput: refs.riskInput,
          projectRevisionRef: refs.projectRevisionRef,
          spatialScopeRef: refs.spatialScopeRef,
          applicabilityMetadataSnapshotRef: refs.applicabilityMetadataSnapshotRef,
          entryMode: run.entryMode,
          // 冻结触发原因只取自入口身份：同一运行的同一入口永远得到同一原因码，不猜“最新原因”。
          triggerReasonCode: run.entryMode,
          ...(previousAssessmentRecordRef === undefined ? {} : { previousAssessmentRecordRef }),
          causalRunRef: run.parentRunRef ?? run.runRef,
          ...(refs.monitoringSnapshotRefs.length === 0
            ? {}
            : { monitoringSnapshotRefs: [...refs.monitoringSnapshotRefs] }),
        },
      });
      if (frozen.kind !== "succeeded") {
        fail(toAssessmentGraphError({ stage: "A0", error: frozen, occurredAt }));
      }
      const result = frozen.result;
      if (result.kind !== "assessment-preparation") {
        fail(contractInvalid({ stage: "A0", detailCode: "freeze-kind-mismatch", occurredAt }));
      }
      return {
        entrySnapshotRef: {
          kind: "assessment-preparation",
          assessmentPreparationSnapshotRef: result.assessmentPreparationSnapshotRef,
        },
        entryIdentity: result.assessmentPreparationSnapshotRef.reference,
        stageResult: AssessmentStageResultV1Schema.parse({
          schemaVersion: "1",
          runRef: run.runRef,
          recordedAt: occurredAt,
          stage: "A0",
          preparationSnapshotRef: result.assessmentPreparationSnapshotRef,
        }),
      };
    }
  }
};

interface HandlerInputV1 {
  readonly ports: AssessmentGraphPortsV1;
  readonly run: AssessmentGraphRunContextV1;
  readonly state: AssessmentGraphStateV1;
}

type StageHandlerV1 = (input: HandlerInputV1) => Promise<AssessmentGraphStateV1>;

const assertStageInPlan = (input: {
  readonly run: AssessmentGraphRunContextV1;
  readonly stage: AssessmentStageV1;
  readonly occurredAt: string;
}): void => {
  if (!STAGE_PLAN_V1[input.run.entryMode].includes(input.stage)) {
    fail(
      contractInvalid({
        stage: input.stage,
        detailCode: "stage-outside-entry-plan",
        occurredAt: input.occurredAt,
      }),
    );
  }
};

const nextStageOf = (
  run: AssessmentGraphRunContextV1,
  stage: AssessmentStageV1,
): AssessmentStageV1 => {
  const plan = STAGE_PLAN_V1[run.entryMode];
  return plan[plan.indexOf(stage) + 1] ?? "A9";
};

const runStageLink = (input: {
  readonly run: AssessmentGraphRunContextV1;
  readonly stage: AssessmentStageV1;
  readonly occurredAt: string;
  readonly stageResultRef: StageResultRefV1 | undefined;
}): readonly WorkflowGraphLinkV1[] =>
  input.stageResultRef === undefined
    ? []
    : [
        assessmentGraphLink({
          run: input.run,
          fromRef: input.run.runRef,
          toRef: input.stageResultRef,
          relation: "run-stage",
          stage: input.stage,
          stageResultRef: input.stageResultRef,
          recordedAt: input.occurredAt,
          auditEntryId: `${actionIdFor(input.run, input.stage)}:audit`,
        }),
      ];

/** A0：按入口语义冻结显式入口，登记入口快照并推进到 A1（design D-01/D-03）。 */
const stageA0: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  assertStageInPlan({ run, stage: "A0", occurredAt });
  const expectedIdentity = workflowEntryIdentityFor({
    entryMode: run.entryMode,
    projectId: run.projectId,
    frozenRefs: run.frozenRefs,
  });
  if (!sameVersionReference(expectedIdentity, run.entryIdentity)) {
    fail(contractInvalid({ stage: "A0", detailCode: "entry-identity-mismatch", occurredAt }));
  }
  const cursor = await readAssessmentCursor({ ports, run });
  const entry = await resolveAssessmentEntry({ ports, run, occurredAt });
  const runStateArtifactId = artifactIdFor("run-state", run.runRef.reference.entityId, "A0");
  return await advance({
    ports,
    run,
    state,
    stage: "A0",
    nextStage: "A1",
    actionSuffix: "A0",
    cursor,
    stageResult: entry.stageResult,
    commandKind: "assessment-graph.a0",
    statePatch: { entrySnapshotRef: entry.entrySnapshotRef },
    extraRows: ({ artifactRefs, runVersionId, auditEntryId, occurredAt: recordedAt }) => [
      WorkflowGraphResultRowV1Schema.parse({
        ...rowBase({
          run,
          artifactRef: artifactRefFrom(artifactRefs, runStateArtifactId),
          runVersionId,
          resultKind: "entry-snapshot",
          idempotencySuffix: "A0:entry",
          auditEntryId,
          recordedAt,
          resultId: entry.entryIdentity.entityId,
          resultVersionId: entry.entryIdentity.versionId,
        }),
        resultKind: "entry-snapshot",
        stage: "A0",
        entryIdentity: entry.entryIdentity,
        frozenRefs: [...run.frozenRefs],
      }),
    ],
    links: (stageResultRef) => runStageLink({ run, stage: "A0", occurredAt, stageResultRef }),
  });
};

/** A1：解析 C19 已发布依据集合与 C18/C25 版本化运行策略；缺项按类型化错误失败。 */
const stageA1: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  assertStageInPlan({ run, stage: "A1", occurredAt });
  const cursor = await readAssessmentCursor({ ports, run });
  const basisReleaseSetRef = await resolveBasisReleaseSetRef({
    ports,
    run,
    state,
    stage: "A1",
    occurredAt,
  });
  const read = await readBasisReleaseSet({ ports, run, stage: "A1", basisReleaseSetRef });
  if (state.entrySnapshotRef.kind === "assessment-preparation") {
    await readRuntimePolicySetForRun({
      ports,
      run,
      stage: "A1",
      preparationSnapshotRef: state.entrySnapshotRef.assessmentPreparationSnapshotRef,
      basisReleaseSetRef,
    });
  }
  const stageResult = AssessmentStageResultV1Schema.parse({
    schemaVersion: "1",
    runRef: run.runRef,
    recordedAt: occurredAt,
    stage: "A1",
    resultKind: "ready",
    assessmentBasisReleaseSetRef: read.assessmentBasisReleaseSetRef,
  });
  return await advance({
    ports,
    run,
    state,
    stage: "A1",
    nextStage: nextStageOf(run, "A1"),
    actionSuffix: "A1",
    cursor,
    stageResult,
    commandKind: "assessment-graph.a1",
    links: (stageResultRef) => runStageLink({ run, stage: "A1", occurredAt, stageResultRef }),
  });
};

/** A2：C25 `prepare` 冻结评估输入（分段入口改调 C28 预测/偏差）。 */
const stageA2: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  assertStageInPlan({ run, stage: "A2", occurredAt });
  const cursor = await readAssessmentCursor({ ports, run });
  if (run.entryMode === "forecast-response") {
    const entry = await resolveAssessmentEntry({ ports, run, occurredAt });
    const snapshot = entry.forecastSnapshot;
    if (snapshot === undefined || entry.entrySnapshotRef.kind !== "forecast-input") {
      fail(contractInvalid({ stage: "A2", detailCode: "forecast-entry-missing", occurredAt }));
    }
    const binding = VerifiedResponseWorkflowBindingV1Schema.parse({
      schemaVersion: "1",
      projectId: run.projectId,
      responseRecommendationRef: snapshot.responseRecommendationRef,
      spatialScopeRef: requiredFrozenRef({
        run,
        kind: "spatial-scope",
        schema: SpatialScopeRefV1Schema,
        stage: "A2",
        detailCode: "spatial-scope-missing",
        occurredAt,
      }),
      routeDecisionRef: snapshot.adoptionDecisionRef,
      forecastRunRef: run.runRef,
      boundAt: run.issuedAt,
    });
    const forecast = await ports.responseLifecycle.forecastResponse({
      commandId: actionIdFor(run, "A2"),
      idempotencyKey: actionIdFor(run, "A2"),
      projectId: run.projectId,
      actorId: run.actorId,
      issuedAt: run.issuedAt,
      authorization: run.authorization,
      payload: {
        binding,
        forecastInputSnapshotRef: entry.entrySnapshotRef.responseForecastInputSnapshotRef,
        forecastInputSnapshot: snapshot,
      },
    });
    if (forecast.kind === "failed") {
      fail(toAssessmentGraphError({ stage: "A2", error: forecast.error, occurredAt }));
    }
    const outcome = forecast.result.outcome;
    if (outcome.availability.kind === "unavailable") {
      const reasonCode = outcome.availability.reasonCode;
      return await advance({
        ports,
        run,
        state,
        stage: "A2",
        nextStage: "A9",
        actionSuffix: "A2",
        cursor,
        commandKind: "assessment-graph.a2",
        extraRows: ({
          artifactRefs,
          runVersionId,
          auditEntryId,
          occurredAt: recordedAt,
          runStateArtifactId,
        }) => [
          skipTailRow({
            run,
            artifactRef: artifactRefFrom(artifactRefs, runStateArtifactId),
            runVersionId,
            auditEntryId,
            recordedAt,
            stage: "A2",
            tailKind: "forecast",
            reasonCode,
          }),
        ],
      });
    }
    const effectForecastRef = outcome.availability.effectForecastRef;
    return await advance({
      ports,
      run,
      state,
      stage: "A2",
      nextStage: "A9",
      actionSuffix: "A2",
      cursor,
      commandKind: "assessment-graph.a2",
      statePatch: { effectForecastRef },
      links: (stageResultRef) => [
        assessmentGraphLink({
          run,
          fromRef: outcome.responseRecommendationRef,
          toRef: effectForecastRef,
          relation: "recommendation-forecast",
          stage: "A2",
          ...(stageResultRef === undefined ? {} : { stageResultRef }),
          recordedAt: occurredAt,
          auditEntryId: `${actionIdFor(run, "A2")}:audit`,
        }),
      ],
    });
  }
  if (run.entryMode === "record-response-feedback") {
    const forecastRef = optionalFrozenRef({
      run,
      kind: "effect-forecast",
      schema: EffectForecastRefV1Schema,
      stage: "A2",
      detailCode: "effect-forecast-invalid",
      occurredAt,
    });
    const feedbackRef = requiredFrozenRef({
      run,
      kind: "feedback",
      schema: FeedbackRefV1Schema,
      stage: "A2",
      detailCode: "feedback-missing",
      occurredAt,
    });
    if (forecastRef === undefined) {
      return await advance({
        ports,
        run,
        state,
        stage: "A2",
        nextStage: "A9",
        actionSuffix: "A2",
        cursor,
        commandKind: "assessment-graph.a2",
        extraRows: ({
          artifactRefs,
          runVersionId,
          auditEntryId,
          occurredAt: recordedAt,
          runStateArtifactId,
        }) => [
          skipTailRow({
            run,
            artifactRef: artifactRefFrom(artifactRefs, runStateArtifactId),
            runVersionId,
            auditEntryId,
            recordedAt,
            stage: "A2",
            tailKind: "deviation",
            reasonCode: "effect-forecast-missing",
          }),
        ],
      });
    }
    const deviation = await ports.responseLifecycle.calculateDeviation({
      kind: "calculate-deviation",
      commandId: actionIdFor(run, "A2"),
      idempotencyKey: actionIdFor(run, "A2"),
      projectId: run.projectId,
      actorId: run.actorId,
      issuedAt: run.issuedAt,
      authorization: run.authorization,
      payload: {
        effectForecastRef: forecastRef,
        feedbackRef,
        frozenAssessmentBasisRef: requiredFrozenRef({
          run,
          kind: "assessment-input-snapshot",
          schema: AssessmentInputSnapshotRefV1Schema,
          stage: "A2",
          detailCode: "frozen-assessment-basis-missing",
          occurredAt,
        }),
      },
    });
    if (deviation.kind === "failed") {
      fail(toAssessmentGraphError({ stage: "A2", error: deviation.error, occurredAt }));
    }
    if (deviation.kind === "unavailable") {
      return await advance({
        ports,
        run,
        state,
        stage: "A2",
        nextStage: "A9",
        actionSuffix: "A2",
        cursor,
        commandKind: "assessment-graph.a2",
        extraRows: ({
          artifactRefs,
          runVersionId,
          auditEntryId,
          occurredAt: recordedAt,
          runStateArtifactId,
        }) => [
          skipTailRow({
            run,
            artifactRef: artifactRefFrom(artifactRefs, runStateArtifactId),
            runVersionId,
            auditEntryId,
            recordedAt,
            stage: "A2",
            tailKind: "deviation",
            reasonCode: deviation.reasonCode,
          }),
        ],
      });
    }
    const fact = deviation.result.fact;
    if (!fact.thresholdExceeded) {
      return await advance({
        ports,
        run,
        state,
        stage: "A2",
        nextStage: "A9",
        actionSuffix: "A2",
        cursor,
        commandKind: "assessment-graph.a2",
        // 偏差事实引用不是公共契约引用：链边在 A3 取得公共偏差记录引用后再沉淀。
        extraRows: ({
          artifactRefs,
          runVersionId,
          auditEntryId,
          occurredAt: recordedAt,
          runStateArtifactId,
        }) => [
          skipTailRow({
            run,
            artifactRef: artifactRefFrom(artifactRefs, runStateArtifactId),
            runVersionId,
            auditEntryId,
            recordedAt,
            stage: "A2",
            tailKind: "calibration",
            reasonCode: "deviation-within-threshold",
          }),
        ],
      });
    }
    return await advance({
      ports,
      run,
      state,
      stage: "A2",
      nextStage: nextStageOf(run, "A2"),
      actionSuffix: "A2",
      cursor,
      commandKind: "assessment-graph.a2",
    });
  }
  const entrySnapshotRef = state.entrySnapshotRef;
  if (entrySnapshotRef.kind !== "assessment-preparation") {
    fail(
      contractInvalid({
        stage: "A2",
        detailCode: "assessment-preparation-entry-missing",
        occurredAt,
      }),
    );
  }
  const basisReleaseSetRef = await resolveBasisReleaseSetRef({
    ports,
    run,
    state,
    stage: "A2",
    occurredAt,
  });
  const preparationSnapshotRef = entrySnapshotRef.assessmentPreparationSnapshotRef;
  // 重评前驱与原因来自已登记的不可变入口事实（design D-12）：不再从 frozenRefs 数量或
  // 适用性引用反推原因，也不保留可独立改变的第二套前驱。历史工件缺该入口字段时失败闭合。
  const reassessmentEntry = run.reassessmentEntry;
  // 已登记入口元数据若存在却解析不出前驱，同样失败闭合，不以 frozenRefs 反推补齐。
  const previousAssessmentRecordRef =
    reassessmentEntry === undefined
      ? undefined
      : parseWith(RiskAssessmentRecordRefV1Schema, reassessmentEntry.previousAssessmentRecordRef);
  const prepared = await ports.riskAssessment.prepare(
    run.entryMode === "reassess"
      ? previousAssessmentRecordRef === undefined
        ? fail(
            entryIncomplete({
              stage: "A2",
              detailCode:
                reassessmentEntry === undefined
                  ? "previous-assessment-record-missing"
                  : "previous-assessment-record-invalid",
              occurredAt,
            }),
          )
        : {
            kind: "reassessment",
            commandId: actionIdFor(run, "A2"),
            idempotencyKey: actionIdFor(run, "A2"),
            projectId: run.projectId,
            actorId: run.actorId,
            issuedAt: run.issuedAt,
            authorization: run.authorization,
            payload: {
              preparationSnapshotRef,
              assessmentBasisReleaseSetRef: basisReleaseSetRef,
              previousAssessmentRecordRef,
              reason: assessmentReasonForWorkflowReassessmentV1(
                (reassessmentEntry as { readonly reason: WorkflowReassessmentReasonV1 }).reason,
              ),
            },
          }
      : run.entryMode === "historical-backfill"
        ? {
            kind: "historical-backfill",
            commandId: actionIdFor(run, "A2"),
            idempotencyKey: actionIdFor(run, "A2"),
            projectId: run.projectId,
            actorId: run.actorId,
            issuedAt: run.issuedAt,
            authorization: run.authorization,
            payload: {
              preparationSnapshotRef,
              assessmentBasisReleaseSetRef: basisReleaseSetRef,
              effectiveAt: run.validAt,
            },
          }
        : {
            kind: "initial",
            commandId: actionIdFor(run, "A2"),
            idempotencyKey: actionIdFor(run, "A2"),
            projectId: run.projectId,
            actorId: run.actorId,
            issuedAt: run.issuedAt,
            authorization: run.authorization,
            payload: {
              preparationSnapshotRef,
              assessmentBasisReleaseSetRef: basisReleaseSetRef,
            },
          },
  );
  if (prepared.kind === "failed") {
    fail(toAssessmentGraphError({ stage: "A2", error: prepared.error, occurredAt }));
  }
  if (prepared.kind === "waiting") {
    return await waitFor({
      ports,
      run,
      state,
      stage: "A2",
      cursor,
      suffix: "A2",
      waitingRef: prepared.waiting,
    });
  }
  const assessmentInputSnapshotRef = prepared.result.assessmentInputSnapshotRef;
  const stageResult = AssessmentStageResultV1Schema.parse({
    schemaVersion: "1",
    runRef: run.runRef,
    recordedAt: occurredAt,
    stage: "A2",
    assessmentInputSnapshotRef,
  });
  return await advance({
    ports,
    run,
    state,
    stage: "A2",
    nextStage: nextStageOf(run, "A2"),
    actionSuffix: "A2",
    cursor,
    stageResult,
    commandKind: "assessment-graph.a2",
    statePatch: { assessmentInputSnapshotRef },
    links: (stageResultRef) => runStageLink({ run, stage: "A2", occurredAt, stageResultRef }),
  });
};

/** A3：C25 `evaluate` 的指标取值集（分段入口改调 C29 `prepareInput`）。 */
const stageA3: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  assertStageInPlan({ run, stage: "A3", occurredAt });
  const cursor = await readAssessmentCursor({ ports, run });
  if (run.entryMode === "record-response-feedback") {
    const basisReleaseSetRef = await resolveBasisReleaseSetRef({
      ports,
      run,
      state,
      stage: "A3",
      occurredAt,
    });
    const policy = await ports.policies.resolveCalibrationPolicy({
      projectId: run.projectId,
      basisReleaseSetRef,
      requiredAt: run.validAt,
      authorization: run.authorization,
    });
    if (policy.kind !== "resolved") {
      fail(
        entryIncomplete({
          stage: "A3",
          detailCode: `calibration-policy-${policy.reasonCode}`,
          occurredAt,
        }),
      );
    }
    const preparedInput = await ports.calibration.prepareInput({
      requestId: actionIdFor(run, "A3"),
      idempotencyKey: actionIdFor(run, "A3"),
      requestedAt: run.issuedAt,
      projectId: run.projectId,
      actorId: run.actorId,
      authorization: run.authorization,
      deviationFactRef: await deviationFactRefFor({ ports, run, occurredAt }),
      basisReleaseSetRef,
      targetReleaseRef: policy.targetReleaseRef,
      calibrationValidationPolicyRef: policy.calibrationValidationPolicyRef,
      agentPolicy: policy.agentPolicy,
    });
    if (preparedInput.kind === "failed") {
      fail(toAssessmentGraphError({ stage: "A3", error: preparedInput.error, occurredAt }));
    }
    if (preparedInput.kind === "not-applicable") {
      return await headToSummary({
        ports,
        run,
        state,
        stage: "A3",
        cursor,
        tailKind: "calibration",
        reasonCode: preparedInput.reasonCode,
        occurredAt,
      });
    }
    return await advance({
      ports,
      run,
      state,
      stage: "A3",
      nextStage: nextStageOf(run, "A3"),
      actionSuffix: "A3",
      cursor,
      commandKind: "assessment-graph.a3",
      cursorPatch: { deviationRecordRefs: [preparedInput.result.deviationRecordRef] },
      statePatch: { deviationRecordRef: preparedInput.result.deviationRecordRef },
      links: () => [
        assessmentGraphLink({
          run,
          fromRef: requiredFrozenRef({
            run,
            kind: "feedback",
            schema: FeedbackRefV1Schema,
            stage: "A3",
            detailCode: "feedback-missing",
            occurredAt,
          }),
          toRef: preparedInput.result.deviationRecordRef,
          relation: "feedback-deviation",
          stage: "A3",
          recordedAt: occurredAt,
          auditEntryId: `${actionIdFor(run, "A3")}:audit`,
        }),
      ],
    });
  }
  const evaluated = await evaluateForRun({ ports, run, state, stage: "A3", occurredAt });
  const stageResult = AssessmentStageResultV1Schema.parse({
    schemaVersion: "1",
    runRef: run.runRef,
    recordedAt: occurredAt,
    stage: "A3",
    indicatorActualValueSetRef: evaluated.indicatorActualValueSetRef,
  });
  return await advance({
    ports,
    run,
    state,
    stage: "A3",
    nextStage: nextStageOf(run, "A3"),
    actionSuffix: "A3",
    cursor,
    stageResult,
    commandKind: "assessment-graph.a3",
    links: (stageResultRef) => runStageLink({ run, stage: "A3", occurredAt, stageResultRef }),
  });
};

/** A4：C25 决策工件（分段入口改调 C29 校准候选 Agent 与 `createSuggestion`）。 */
const stageA4: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  assertStageInPlan({ run, stage: "A4", occurredAt });
  const cursor = await readAssessmentCursor({ ports, run });
  if (run.entryMode === "record-response-feedback") {
    const basisReleaseSetRef = await resolveBasisReleaseSetRef({
      ports,
      run,
      state,
      stage: "A4",
      occurredAt,
    });
    const policy = await ports.policies.resolveCalibrationPolicy({
      projectId: run.projectId,
      basisReleaseSetRef,
      requiredAt: run.validAt,
      authorization: run.authorization,
    });
    if (policy.kind !== "resolved") {
      fail(
        entryIncomplete({
          stage: "A4",
          detailCode: `calibration-policy-${policy.reasonCode}`,
          occurredAt,
        }),
      );
    }
    const preparedInput = await ports.calibration.prepareInput({
      requestId: actionIdFor(run, "A3"),
      idempotencyKey: actionIdFor(run, "A3"),
      requestedAt: run.issuedAt,
      projectId: run.projectId,
      actorId: run.actorId,
      authorization: run.authorization,
      deviationFactRef: await deviationFactRefFor({ ports, run, occurredAt }),
      basisReleaseSetRef,
      targetReleaseRef: policy.targetReleaseRef,
      calibrationValidationPolicyRef: policy.calibrationValidationPolicyRef,
      agentPolicy: policy.agentPolicy,
    });
    if (preparedInput.kind !== "succeeded") {
      fail(
        contractInvalid({ stage: "A4", detailCode: "calibration-input-unavailable", occurredAt }),
      );
    }
    const task = await ports.calibrationAgent.ensureTask({
      run,
      actionId: actionIdFor(run, "A4"),
      frozenInputRef: preparedInput.result.frozenInputRef,
      inputSnapshotRef: preparedInput.result.inputSnapshotRef,
      deviationRecordRef: preparedInput.result.deviationRecordRef,
      calibrationValidationPolicyRef: policy.calibrationValidationPolicyRef,
    });
    if (task.kind === "failed") {
      return await headToSummary({
        ports,
        run,
        state,
        stage: "A4",
        cursor,
        tailKind: "calibration",
        reasonCode: task.reasonCode,
        occurredAt,
      });
    }
    if (task.kind === "waiting") {
      return await waitFor({
        ports,
        run,
        state,
        stage: "A4",
        cursor,
        suffix: "A4",
        waitingRef: { kind: "agent-task", agentTaskRef: task.agentTaskRef },
        statePatch: { agentTaskRefs: appendRef(state.agentTaskRefs, task.agentTaskRef) },
      });
    }
    const suggestion = await ports.calibration.createSuggestion({
      kind: "create-calibration-suggestion",
      commandId: actionIdFor(run, "A4"),
      idempotencyKey: actionIdFor(run, "A4"),
      projectId: run.projectId,
      actorId: run.actorId,
      issuedAt: run.issuedAt,
      authorization: run.authorization,
      payload: {
        deviationRecordRef: preparedInput.result.deviationRecordRef,
        agentTaskResultRef: task.agentTaskResultRef,
        calibrationValidationPolicyRef: policy.calibrationValidationPolicyRef,
      },
    });
    if (suggestion.kind === "waiting") {
      return await waitFor({
        ports,
        run,
        state,
        stage: "A4",
        cursor,
        suffix: "A4",
        waitingRef: suggestion.waiting,
      });
    }
    if (suggestion.kind !== "succeeded") {
      fail(toAssessmentGraphError({ stage: "A4", error: suggestion.error, occurredAt }));
    }
    if (suggestion.result.kind !== "calibration") {
      fail(contractInvalid({ stage: "A4", detailCode: "calibration-result-mismatch", occurredAt }));
    }
    const calibrationSuggestionRef = suggestion.result.calibrationSuggestionRef;
    return await advance({
      ports,
      run,
      state,
      stage: "A4",
      nextStage: nextStageOf(run, "A4"),
      actionSuffix: "A4",
      cursor,
      commandKind: "assessment-graph.a4",
      cursorPatch: { calibrationSuggestionRefs: [calibrationSuggestionRef] },
      statePatch: {
        calibrationSuggestionRef,
        agentTaskRefs: appendRef(state.agentTaskRefs, task.agentTaskRef),
        reviewTaskRefs: appendRef(state.reviewTaskRefs, suggestion.result.reviewTaskRef),
      },
      links: () => [
        assessmentGraphLink({
          run,
          fromRef: preparedInput.result.deviationRecordRef,
          toRef: calibrationSuggestionRef,
          relation: "deviation-calibration",
          stage: "A4",
          recordedAt: occurredAt,
          auditEntryId: `${actionIdFor(run, "A4")}:audit`,
        }),
      ],
    });
  }
  const evaluated = await evaluateForRun({ ports, run, state, stage: "A4", occurredAt });
  const stageResult = AssessmentStageResultV1Schema.parse({
    schemaVersion: "1",
    runRef: run.runRef,
    recordedAt: occurredAt,
    stage: "A4",
    assessmentDecisionArtifactRef: evaluated.assessmentDecisionArtifactRef,
  });
  return await advance({
    ports,
    run,
    state,
    stage: "A4",
    nextStage: nextStageOf(run, "A4"),
    actionSuffix: "A4",
    cursor,
    stageResult,
    commandKind: "assessment-graph.a4",
    links: (stageResultRef) => runStageLink({ run, stage: "A4", occurredAt, stageResultRef }),
  });
};

/** A5：消费 C25 已提交的评估记录（重评与历史补算都只追加新记录）。 */
const stageA5: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  assertStageInPlan({ run, stage: "A5", occurredAt });
  const cursor = await readAssessmentCursor({ ports, run });
  const evaluated = await evaluateForRun({ ports, run, state, stage: "A5", occurredAt });
  const assessmentRecordRef = evaluated.assessmentRecordRef;
  const stageResult = AssessmentStageResultV1Schema.parse({
    schemaVersion: "1",
    runRef: run.runRef,
    recordedAt: occurredAt,
    stage: "A5",
    assessmentRecordRef,
  });
  const riskInputRef = entryRefsOf({ run, stage: "A5", occurredAt }).riskInput;
  return await advance({
    ports,
    run,
    state,
    stage: "A5",
    nextStage: nextStageOf(run, "A5"),
    actionSuffix: "A5",
    cursor,
    stageResult,
    commandKind: "assessment-graph.a5",
    cursorPatch: { assessmentRecordRefs: [assessmentRecordRef] },
    statePatch: { assessmentRecordRef },
    links: (stageResultRef) => [
      ...runStageLink({ run, stage: "A5", occurredAt, stageResultRef }),
      assessmentGraphLink({
        run,
        fromRef: riskInputRef,
        toRef: assessmentRecordRef,
        relation: "risk-assessment",
        stage: "A5",
        ...(stageResultRef === undefined ? {} : { stageResultRef }),
        recordedAt: occurredAt,
        auditEntryId: `${actionIdFor(run, "A5")}:audit`,
      }),
    ],
  });
};

/** A6：C26 `open`；触发集合为空时直接收口到 A9，不建预警、任务或建议。 */
const stageA6: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  assertStageInPlan({ run, stage: "A6", occurredAt });
  const cursor = await readAssessmentCursor({ ports, run });
  const assessmentRecordRef = state.assessmentRecordRef;
  if (assessmentRecordRef === undefined) {
    fail(contractInvalid({ stage: "A6", detailCode: "assessment-record-missing", occurredAt }));
  }
  const policies = await runtimePoliciesFor({ ports, run, state, stage: "A6" });
  const opened = await ports.warning.open({
    kind: "open",
    commandId: actionIdFor(run, "A6"),
    idempotencyKey: actionIdFor(run, "A6"),
    projectId: run.projectId,
    actorId: run.actorId,
    issuedAt: run.issuedAt,
    authorization: run.authorization,
    payload: {
      assessmentRecordRef,
      warningAggregationPolicyRef: policies.warningAggregationPolicyRef,
      notificationPolicyRef: policies.notificationPolicyRef,
    },
  });
  if (opened.kind === "failed") {
    fail(toAssessmentGraphError({ stage: "A6", error: opened.error, occurredAt }));
  }
  if (opened.kind === "waiting") {
    return await waitFor({
      ports,
      run,
      state,
      stage: "A6",
      cursor,
      suffix: "A6",
      waitingRef: opened.waiting,
    });
  }
  const result = opened.result;
  const stageResult = AssessmentStageResultV1Schema.parse({
    schemaVersion: "1",
    runRef: run.runRef,
    recordedAt: occurredAt,
    stage: "A6",
    warningRecordRefs: [...result.warningRecordRefs],
    warningResponseTaskRefs: [...result.warningResponseTaskRefs],
    notificationIntentRefs: [...result.notificationIntentRefs],
  });
  if (result.warningRecordRefs.length === 0) {
    return await advance({
      ports,
      run,
      state,
      stage: "A6",
      nextStage: "A9",
      actionSuffix: "A6",
      cursor,
      stageResult,
      commandKind: "assessment-graph.a6",
      extraRows: ({
        artifactRefs,
        runVersionId,
        auditEntryId,
        occurredAt: recordedAt,
        runStateArtifactId,
      }) => [
        skipTailRow({
          run,
          artifactRef: artifactRefFrom(artifactRefs, runStateArtifactId),
          runVersionId,
          auditEntryId,
          recordedAt,
          stage: "A6",
          tailKind: "warning",
          reasonCode: "no-trigger-indicators",
        }),
      ],
      links: (stageResultRef) => runStageLink({ run, stage: "A6", occurredAt, stageResultRef }),
    });
  }
  return await advance({
    ports,
    run,
    state,
    stage: "A6",
    nextStage: nextStageOf(run, "A6"),
    actionSuffix: "A6",
    cursor,
    stageResult,
    commandKind: "assessment-graph.a6",
    cursorPatch: { warningRecordRefs: [...result.warningRecordRefs] },
    statePatch: {
      warningRecordRefs: [...result.warningRecordRefs],
      warningResponseTaskRefs: [...result.warningResponseTaskRefs],
    },
    links: (stageResultRef) => [
      ...runStageLink({ run, stage: "A6", occurredAt, stageResultRef }),
      ...result.warningRecordRefs.map((warningRecordRef) =>
        assessmentGraphLink({
          run,
          fromRef: assessmentRecordRef,
          toRef: warningRecordRef,
          relation: "assessment-warning",
          stage: "A6",
          ...(stageResultRef === undefined ? {} : { stageResultRef }),
          recordedAt: occurredAt,
          auditEntryId: `${actionIdFor(run, "A6")}:audit`,
        }),
      ),
    ],
  });
};

/** A7：C27 `measureCandidates` + 有界组合任务 + `createCandidate`。 */
const stageA7: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  assertStageInPlan({ run, stage: "A7", occurredAt });
  const cursor = await readAssessmentCursor({ ports, run });
  const assessmentRecordRef = state.assessmentRecordRef;
  const warningResponseTaskRef = state.warningResponseTaskRefs[0];
  if (assessmentRecordRef === undefined || warningResponseTaskRef === undefined) {
    fail(contractInvalid({ stage: "A7", detailCode: "warning-task-missing", occurredAt }));
  }
  const policies = await runtimePoliciesFor({ ports, run, state, stage: "A7" });
  const basisRead = await readBasisReleaseSet({
    ports,
    run,
    stage: "A7",
    basisReleaseSetRef: await resolveBasisReleaseSetRef({
      ports,
      run,
      state,
      stage: "A7",
      occurredAt,
    }),
  });
  const measureLibraryReleaseRef = measureLibraryReleaseRefOf({
    read: basisRead,
    stage: "A7",
    occurredAt,
  });
  const query = await ports.recommendation.measureCandidates({
    queryId: actionIdFor(run, "A7:measure-candidates"),
    projectId: run.projectId,
    actorId: run.actorId,
    requestedAt: run.issuedAt,
    authorization: run.authorization,
    kind: "measure-candidates",
    payload: { assessmentRecordRef, warningResponseTaskRef, measureLibraryReleaseRef },
  });
  if (query.kind === "waiting") {
    return await waitFor({
      ports,
      run,
      state,
      stage: "A7",
      cursor,
      suffix: "A7",
      waitingRef: query.waiting,
    });
  }
  if (query.kind === "failed") {
    return await headToSummary({
      ports,
      run,
      state,
      stage: "A7",
      cursor,
      tailKind: "recommendation",
      reasonCode: "measure-candidates-failed",
      occurredAt,
      lastEstablishedRef: assessmentRecordRef,
    });
  }
  const queryResultRef = query.result.knowledgeQueryResultRef;
  const task = await ports.recommendationAgent.ensureTask({
    run,
    actionId: actionIdFor(run, "A7"),
    queryResultRef,
    warningResponseTaskRef,
    responseGenerationPolicyRef: policies.responseGenerationPolicyRef,
    responseAgentPolicyRef: policies.responseAgentPolicyRef,
  });
  if (task.kind === "failed") {
    return await headToSummary({
      ports,
      run,
      state,
      stage: "A7",
      cursor,
      tailKind: "recommendation",
      reasonCode: task.reasonCode,
      occurredAt,
      lastEstablishedRef: queryResultRef,
    });
  }
  if (task.kind === "waiting") {
    return await waitFor({
      ports,
      run,
      state,
      stage: "A7",
      cursor,
      suffix: "A7",
      waitingRef: { kind: "agent-task", agentTaskRef: task.agentTaskRef },
      statePatch: { agentTaskRefs: appendRef(state.agentTaskRefs, task.agentTaskRef) },
    });
  }
  const created = await ports.recommendation.createCandidate({
    kind: "create-candidate",
    commandId: actionIdFor(run, "A7"),
    idempotencyKey: actionIdFor(run, "A7"),
    projectId: run.projectId,
    actorId: run.actorId,
    issuedAt: run.issuedAt,
    authorization: run.authorization,
    payload: {
      warningResponseTaskRef,
      measureCandidateQueryResultRef: queryResultRef,
      agentTaskResultRef: task.agentTaskResultRef,
      responseGenerationPolicyRef: policies.responseGenerationPolicyRef,
    },
  });
  if (created.kind === "failed") {
    fail(toAssessmentGraphError({ stage: "A7", error: created.error, occurredAt }));
  }
  if (created.kind === "waiting") {
    return await waitFor({
      ports,
      run,
      state,
      stage: "A7",
      cursor,
      suffix: "A7",
      waitingRef: created.waiting,
      statePatch: { agentTaskRefs: appendRef(state.agentTaskRefs, task.agentTaskRef) },
    });
  }
  if (created.result.kind !== "candidate") {
    fail(contractInvalid({ stage: "A7", detailCode: "candidate-result-mismatch", occurredAt }));
  }
  const recommendationCandidateRef = created.result.recommendationCandidateRef;
  const agentTaskRefs = appendRef(state.agentTaskRefs, task.agentTaskRef);
  const stageResult = AssessmentStageResultV1Schema.parse({
    schemaVersion: "1",
    runRef: run.runRef,
    recordedAt: occurredAt,
    stage: "A7",
    measureQueryResultRef: queryResultRef,
    agentTaskRefs,
    recommendationCandidateRefs: [recommendationCandidateRef],
  });
  return await advance({
    ports,
    run,
    state,
    stage: "A7",
    nextStage: nextStageOf(run, "A7"),
    actionSuffix: "A7",
    cursor,
    stageResult,
    commandKind: "assessment-graph.a7",
    statePatch: { recommendationCandidateRef, agentTaskRefs },
    links: (stageResultRef) => runStageLink({ run, stage: "A7", occurredAt, stageResultRef }),
  });
};

/** A8：C27 `validateAndRecord`；三项校验未通过时只保留候选与类型化原因。 */
const stageA8: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  assertStageInPlan({ run, stage: "A8", occurredAt });
  const cursor = await readAssessmentCursor({ ports, run });
  const recommendationCandidateRef = state.recommendationCandidateRef;
  if (recommendationCandidateRef === undefined) {
    fail(contractInvalid({ stage: "A8", detailCode: "candidate-missing", occurredAt }));
  }
  const siteContextRef = await ports.recommendationAgent.resolveSiteContextRef({
    run,
    requiredAt: run.validAt,
  });
  if (siteContextRef === undefined) {
    fail(contractInvalid({ stage: "A8", detailCode: "site-context-missing", occurredAt }));
  }
  const policies = await runtimePoliciesFor({ ports, run, state, stage: "A8" });
  const recorded = await ports.recommendation.validateAndRecord({
    kind: "validate-and-record",
    commandId: actionIdFor(run, "A8"),
    idempotencyKey: actionIdFor(run, "A8"),
    projectId: run.projectId,
    actorId: run.actorId,
    issuedAt: run.issuedAt,
    authorization: run.authorization,
    payload: {
      recommendationCandidateRef,
      responseValidationPolicyRef: policies.responseValidationPolicyRef,
      siteContextRef,
    },
  });
  if (recorded.kind === "failed") {
    return await headToSummary({
      ports,
      run,
      state,
      stage: "A8",
      cursor,
      tailKind: "recommendation",
      reasonCode: "recommendation-validation-rejected",
      occurredAt,
      lastEstablishedRef: recommendationCandidateRef,
    });
  }
  if (recorded.kind === "waiting") {
    return await waitFor({
      ports,
      run,
      state,
      stage: "A8",
      cursor,
      suffix: "A8",
      waitingRef: recorded.waiting,
    });
  }
  if (recorded.result.kind === "waiting-review") {
    const reviewTaskRef = recorded.result.reviewTaskRef;
    return await waitFor({
      ports,
      run,
      state,
      stage: "A8",
      cursor,
      suffix: "A8",
      waitingRef: { kind: "review", reviewTaskRef },
      statePatch: { reviewTaskRefs: appendRef(state.reviewTaskRefs, reviewTaskRef) },
    });
  }
  if (recorded.result.kind !== "recorded") {
    fail(
      contractInvalid({ stage: "A8", detailCode: "recommendation-result-mismatch", occurredAt }),
    );
  }
  const responseRecommendationRef = recorded.result.responseRecommendationRef;
  const stageResult = AssessmentStageResultV1Schema.parse({
    schemaVersion: "1",
    runRef: run.runRef,
    recordedAt: occurredAt,
    stage: "A8",
    resultKind: "recorded",
    responseRecommendationRef,
  });
  const warningResponseTaskRef = state.warningResponseTaskRefs[0];
  return await advance({
    ports,
    run,
    state,
    stage: "A8",
    nextStage: nextStageOf(run, "A8"),
    actionSuffix: "A8",
    cursor,
    stageResult,
    commandKind: "assessment-graph.a8",
    cursorPatch: { responseRecommendationRefs: [responseRecommendationRef] },
    statePatch: { responseRecommendationRef },
    links: (stageResultRef) => [
      ...runStageLink({ run, stage: "A8", occurredAt, stageResultRef }),
      ...(warningResponseTaskRef === undefined
        ? []
        : [
            assessmentGraphLink({
              run,
              fromRef: warningResponseTaskRef,
              toRef: responseRecommendationRef,
              relation: "warning-recommendation",
              stage: "A8",
              ...(stageResultRef === undefined ? {} : { stageResultRef }),
              recordedAt: occurredAt,
              auditEntryId: `${actionIdFor(run, "A8")}:audit`,
            }),
          ]),
    ],
  });
};

/** A9：汇总精确引用与缺席原因，形成不可变运行汇总并收口完成。 */
const stageA9: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  assertStageInPlan({ run, stage: "A9", occurredAt });
  const cursor = await readAssessmentCursor({ ports, run });
  if (cursor === undefined) {
    fail(contractInvalid({ stage: "A9", detailCode: "run-cursor-missing", occurredAt }));
  }
  const rows = await ports.registrationStore.listRunRows({
    projectId: run.projectId,
    runId: run.runRef.reference.entityId,
  });
  const runResult = WorkflowGraphRunResultV1Schema.parse({
    schemaVersion: "1",
    projectId: run.projectId,
    runRef: run.runRef,
    entryMode: run.entryMode,
    stage: "A9",
    ...(run.parentRunRef === undefined ? {} : { parentRunRef: run.parentRunRef }),
    assessmentRunRefs: [...cursor.assessmentRunRefs],
    assessmentRecordRefs: [...cursor.assessmentRecordRefs],
    warningRecordRefs: [...cursor.warningRecordRefs],
    responseRecommendationRefs: [...cursor.responseRecommendationRefs],
    deviationRecordRefs: [...cursor.deviationRecordRefs],
    calibrationSuggestionRefs: [...cursor.calibrationSuggestionRefs],
    skippedTails: skippedTailsFor({ run, state, cursor, rows }),
    auditTrailRef: auditTrailRefFor(run),
    recordedAt: occurredAt,
  });
  const runResultRef = assessmentRunResultRefFor({ run, runResult });
  const stageResult = AssessmentStageResultV1Schema.parse({
    schemaVersion: "1",
    runRef: run.runRef,
    recordedAt: occurredAt,
    stage: "A9",
    assessmentRunResultRef: runResultRef,
  });
  const runResultArtifactId = artifactIdFor(
    "run-result",
    run.runRef.reference.entityId,
    `A9:${runResultRef.reference.versionId.slice(0, 32)}`,
  );
  return await advance({
    ports,
    run,
    state,
    stage: "A9",
    nextStage: "A9",
    actionSuffix: `A9:${runResultRef.reference.versionId.slice(0, 32)}`,
    cursor,
    stageResult,
    status: "completed",
    commandKind: "assessment-graph.a9",
    runResult,
    cursorPatch: { resultRef: runResultRef },
    statePatch: { resultRef: runResultRef },
    extraRows: ({ artifactRefs, runVersionId, auditEntryId, occurredAt: recordedAt }) => [
      WorkflowGraphResultRowV1Schema.parse({
        ...rowBase({
          run,
          artifactRef: artifactRefFrom(artifactRefs, runResultArtifactId),
          runVersionId,
          resultKind: "run-result",
          idempotencySuffix: "A9:run-result",
          auditEntryId,
          recordedAt,
          resultId: runResultRef.reference.entityId,
          resultVersionId: runResultRef.reference.versionId,
        }),
        resultKind: "run-result",
        stage: "A9",
        runResultRef,
      }),
    ],
    links: (stageResultRef) => runStageLink({ run, stage: "A9", occurredAt, stageResultRef }),
  });
};

const appendRef = <T>(refs: readonly T[], ref: T): T[] => [...refs, ref];

/** 缺席链尾行：以 `workflow-error` 保留类型化原因，不改写运行终态。 */
const skipTailRow = (input: {
  readonly run: AssessmentGraphRunContextV1;
  readonly artifactRef: ContentArtifactRefV1 | undefined;
  readonly runVersionId: string;
  readonly auditEntryId: string;
  readonly recordedAt: string;
  readonly stage: AssessmentStageV1;
  readonly tailKind: WorkflowSkippedTailV1["tailKind"];
  readonly reasonCode: string;
}): WorkflowGraphResultRowV1 => {
  const workflowErrorRef = skippedTailRefFor({
    runId: input.run.runRef.reference.entityId,
    tailKind: input.tailKind,
    reasonCode: input.reasonCode,
    stage: input.stage,
  });
  return WorkflowGraphResultRowV1Schema.parse({
    ...rowBase({
      run: input.run,
      artifactRef: input.artifactRef,
      runVersionId: input.runVersionId,
      resultKind: "workflow-error",
      idempotencySuffix: `skip:${input.tailKind}:${input.reasonCode}:${input.stage}`,
      auditEntryId: input.auditEntryId,
      recordedAt: input.recordedAt,
      resultId: workflowErrorRef.reference.entityId,
      resultVersionId: workflowErrorRef.reference.versionId,
    }),
    resultKind: "workflow-error",
    stage: input.stage,
    workflowErrorRef,
  });
};

/** 缺席链尾直接收口到 A9：只登记类型化原因，未开始的动作不再执行。 */
const headToSummary = async (input: {
  readonly ports: AssessmentGraphPortsV1;
  readonly run: AssessmentGraphRunContextV1;
  readonly state: AssessmentGraphStateV1;
  readonly stage: AssessmentStageV1;
  readonly cursor: WorkflowGraphRunStateV1 | undefined;
  readonly tailKind: WorkflowSkippedTailV1["tailKind"];
  readonly reasonCode: string;
  readonly occurredAt: string;
  readonly lastEstablishedRef?: ContractReferenceV1;
}): Promise<AssessmentGraphStateV1> =>
  await advance({
    ports: input.ports,
    run: input.run,
    state: input.state,
    stage: input.stage,
    nextStage: "A9",
    actionSuffix: input.stage,
    cursor: input.cursor,
    commandKind: `assessment-graph.${input.stage.toLowerCase()}`,
    extraRows: ({
      artifactRefs,
      runVersionId,
      auditEntryId,
      occurredAt: recordedAt,
      runStateArtifactId,
    }) => [
      skipTailRow({
        run: input.run,
        artifactRef: artifactRefFrom(artifactRefs, runStateArtifactId),
        runVersionId,
        auditEntryId,
        recordedAt,
        stage: input.stage,
        tailKind: input.tailKind,
        reasonCode: input.reasonCode,
      }),
    ],
  });

/** A3/A4/A5 共用 C25 `evaluate`：同一动作身份重放，返回同一已提交结果。 */
const evaluateForRun = async (input: {
  readonly ports: AssessmentGraphPortsV1;
  readonly run: AssessmentGraphRunContextV1;
  readonly state: AssessmentGraphStateV1;
  readonly stage: AssessmentStageV1;
  readonly occurredAt: string;
}): Promise<AssessmentEvaluationSuccessV1> => {
  const assessmentInputSnapshotRef = input.state.assessmentInputSnapshotRef;
  if (assessmentInputSnapshotRef === undefined) {
    fail(
      contractInvalid({
        stage: input.stage,
        detailCode: "assessment-input-missing",
        occurredAt: input.occurredAt,
      }),
    );
  }
  const evaluated = await input.ports.riskAssessment.evaluate({
    kind: "evaluate",
    commandId: actionIdFor(input.run, "evaluate"),
    idempotencyKey: actionIdFor(input.run, "evaluate"),
    projectId: input.run.projectId,
    actorId: input.run.actorId,
    issuedAt: input.run.issuedAt,
    authorization: input.run.authorization,
    payload: { assessmentInputSnapshotRef },
  });
  if (evaluated.kind === "waiting") {
    // C25 确定性评估不在本阶段产生等待：等待结果按上游等待收口，不静默重试（design D-03/D-08）。
    fail(
      toAssessmentGraphError({
        stage: input.stage,
        error: { code: "UPSTREAM_WAITING", retryable: false },
        occurredAt: input.occurredAt,
      }),
    );
  }
  if (evaluated.kind !== "succeeded") {
    fail(
      toAssessmentGraphError({
        stage: input.stage,
        error: evaluated.error,
        occurredAt: input.occurredAt,
      }),
    );
  }
  return evaluated.result;
};

/** A3/A4 共用的偏差事实：以 A2 的同一动作身份重放 C28 `calculateDeviation`。 */
const deviationFactRefFor = async (input: {
  readonly ports: AssessmentGraphPortsV1;
  readonly run: AssessmentGraphRunContextV1;
  readonly occurredAt: string;
}): Promise<{ readonly kind: "response-deviation-fact"; readonly reference: VersionReference }> => {
  const forecastRef = optionalFrozenRef({
    run: input.run,
    kind: "effect-forecast",
    schema: EffectForecastRefV1Schema,
    stage: "A3",
    detailCode: "effect-forecast-invalid",
    occurredAt: input.occurredAt,
  });
  if (forecastRef === undefined) {
    fail(
      contractInvalid({
        stage: "A3",
        detailCode: "effect-forecast-missing",
        occurredAt: input.occurredAt,
      }),
    );
  }
  const deviation = await input.ports.responseLifecycle.calculateDeviation({
    kind: "calculate-deviation",
    commandId: actionIdFor(input.run, "A2"),
    idempotencyKey: actionIdFor(input.run, "A2"),
    projectId: input.run.projectId,
    actorId: input.run.actorId,
    issuedAt: input.run.issuedAt,
    authorization: input.run.authorization,
    payload: {
      effectForecastRef: forecastRef,
      feedbackRef: requiredFrozenRef({
        run: input.run,
        kind: "feedback",
        schema: FeedbackRefV1Schema,
        stage: "A3",
        detailCode: "feedback-missing",
        occurredAt: input.occurredAt,
      }),
      frozenAssessmentBasisRef: requiredFrozenRef({
        run: input.run,
        kind: "assessment-input-snapshot",
        schema: AssessmentInputSnapshotRefV1Schema,
        stage: "A3",
        detailCode: "frozen-assessment-basis-missing",
        occurredAt: input.occurredAt,
      }),
    },
  });
  if (deviation.kind !== "succeeded") {
    fail(
      contractInvalid({
        stage: "A3",
        detailCode: "deviation-fact-unavailable",
        occurredAt: input.occurredAt,
      }),
    );
  }
  return deviation.result.deviationFactRef;
};

const SKIP_REASON_PREFIX_V1 = "assessment-graph-skip:";

/** 从已登记事实重建缺席链尾：原因码只来自本运行登记的 `workflow-error` 行。 */
const skippedTailsFor = (input: {
  readonly run: AssessmentGraphRunContextV1;
  readonly state: AssessmentGraphStateV1;
  readonly cursor: WorkflowGraphRunStateV1;
  readonly rows: readonly WorkflowGraphResultRowV1[];
}): readonly WorkflowSkippedTailV1[] => {
  const expectedByEntry: Readonly<
    Record<WorkflowEntryModeV1, readonly WorkflowSkippedTailV1["tailKind"][]>
  > = {
    "identify-and-assess": ["warning", "recommendation"],
    assess: ["warning", "recommendation"],
    reassess: ["warning", "recommendation"],
    "historical-backfill": ["warning", "recommendation"],
    "forecast-response": ["forecast"],
    "record-response-feedback": ["deviation", "calibration"],
  };
  const established: Readonly<Record<WorkflowSkippedTailV1["tailKind"], boolean>> = {
    warning: input.cursor.warningRecordRefs.length > 0,
    recommendation: input.cursor.responseRecommendationRefs.length > 0,
    forecast: input.state.effectForecastRef !== undefined,
    feedback: true,
    deviation: input.cursor.deviationRecordRefs.length > 0,
    calibration: input.cursor.calibrationSuggestionRefs.length > 0,
  };
  const tails: WorkflowSkippedTailV1[] = [];
  for (const tailKind of expectedByEntry[input.run.entryMode]) {
    if (established[tailKind]) continue;
    const row = input.rows.find(
      (candidate) =>
        candidate.resultKind === "workflow-error" &&
        candidate.workflowErrorRef?.reference.entityId.startsWith(
          `${SKIP_REASON_PREFIX_V1}${tailKind}:`,
        ) === true,
    );
    const reasonCode =
      row?.workflowErrorRef?.reference.entityId.slice(
        `${SKIP_REASON_PREFIX_V1}${tailKind}:`.length,
      ) ?? `${tailKind}-not-established`;
    const lastEstablishedRef =
      tailKind === "warning"
        ? input.state.assessmentRecordRef
        : tailKind === "recommendation"
          ? input.state.recommendationCandidateRef
          : tailKind === "forecast"
            ? input.state.responseRecommendationRef
            : tailKind === "deviation"
              ? input.state.feedbackRef
              : input.state.deviationRecordRef;
    tails.push({
      tailKind,
      reasonCode,
      ...(lastEstablishedRef === undefined ? {} : { lastEstablishedRef }),
    });
  }
  return tails;
};

/** 节点失败：登记稳定错误与游标，图按状态收口到可重试或终止（design D-08）。 */
const recordNodeFailure = async (input: {
  readonly ports: AssessmentGraphPortsV1;
  readonly run: AssessmentGraphRunContextV1;
  readonly state: AssessmentGraphStateV1;
  readonly stage: AssessmentStageV1;
  readonly error: unknown;
}): Promise<AssessmentGraphStateV1> => {
  const { ports, run, state, stage } = input;
  const occurredAt = ports.now().toISOString();
  const error = toAssessmentGraphError({ stage, error: input.error, occurredAt });
  const rows = await ports.registrationStore.listRunRows({
    projectId: run.projectId,
    runId: run.runRef.reference.entityId,
  });
  const prefix = `assessment-graph-workflow-error:${stage}:${error.detailCode}`;
  const attempts = rows.filter(
    (row) =>
      row.resultKind === "workflow-error" &&
      row.workflowErrorRef?.reference.entityId.startsWith(prefix) === true,
  ).length;
  const retryable = error.retryable && attempts < 1;
  const stableError = WorkflowGraphErrorV1Schema.parse({ ...error, retryable });
  const workflowErrorRef = {
    kind: "workflow-error" as const,
    reference: {
      entityId: `assessment-graph-workflow-error:${stage}:${error.detailCode}`,
      versionId: sha256CanonicalJson({ error: stableError, attempt: attempts + 1 }),
    },
  };
  const suffix = `${stage}:failure:${error.detailCode}:attempt-${attempts + 1}`;
  const runStateArtifactId = artifactIdFor("run-state", run.runRef.reference.entityId, suffix);
  const cursor = await readAssessmentCursor({ ports, run });
  const status = retryable ? "retryable-failure" : "terminal-failure";
  const cursorState = cursorBody({
    run,
    stage,
    status,
    previous: cursor,
    recordedAt: occurredAt,
    patch: { lastErrorRef: workflowErrorRef },
  });
  const actionId = actionIdFor(run, suffix);
  await commitStage(ports, run, {
    actionSuffix: suffix,
    commandKind: "assessment-graph.failure",
    bodies: [{ artifactId: runStateArtifactId, build: () => cursorState.body }],
    runVersionId: cursorState.state.runVersionId,
    expectedRunVersionId: cursor?.runVersionId,
    occurredAt,
    rows: (refs, runVersionId) => [
      WorkflowGraphResultRowV1Schema.parse({
        ...rowBase({
          run,
          artifactRef: artifactRefFrom(refs, runStateArtifactId),
          runVersionId,
          resultKind: "workflow-error",
          idempotencySuffix: suffix,
          auditEntryId: `${actionId}:audit`,
          recordedAt: occurredAt,
          resultId: workflowErrorRef.reference.entityId,
          resultVersionId: workflowErrorRef.reference.versionId,
        }),
        resultKind: "workflow-error",
        stage,
        workflowErrorRef,
      }),
      WorkflowGraphResultRowV1Schema.parse({
        ...rowBase({
          run,
          artifactRef: artifactRefFrom(refs, runStateArtifactId),
          runVersionId,
          resultKind: "run-state",
          idempotencySuffix: `${suffix}:run-state:${runVersionId}`,
          auditEntryId: `${actionId}:audit`,
          recordedAt: occurredAt,
          resultId: `assessment-run-state:${run.runRef.reference.entityId}`,
          resultVersionId: runVersionId,
        }),
        resultKind: "run-state",
        stage,
      }),
    ],
  });
  return parseAssessmentGraphState(
    { ...state, stage, status, lastErrorRef: workflowErrorRef },
    occurredAt,
  );
};

const stageHandlers: Readonly<Record<AssessmentStageV1, StageHandlerV1>> = {
  A0: stageA0,
  A1: stageA1,
  A2: stageA2,
  A3: stageA3,
  A4: stageA4,
  A5: stageA5,
  A6: stageA6,
  A7: stageA7,
  A8: stageA8,
  A9: stageA9,
};

/** 编译 A0～A9 子图；checkpointer 由组合根提供（design D-02）。 */
export const createAssessmentGraph = (options: {
  readonly ports: AssessmentGraphPortsV1;
  readonly checkpointer: BaseCheckpointSaver;
}): AssessmentGraphRunnerV1 => {
  const graph = new StateGraph<
    typeof channelsAnnotation.spec,
    GraphChannelsV1,
    GraphChannelsV1,
    NodeNameV1
  >(channelsAnnotation);
  for (const stage of FULL_STAGE_SEQUENCE_V1) {
    graph.addNode(NODE_FOR_STAGE_V1[stage], async (channels, config) => {
      const now = options.ports.now().toISOString();
      const run = readAssessmentRunContext({ config, occurredAt: now });
      const state = parseAssessmentGraphState({ ...stateOfChannels(channels), stage }, now);
      try {
        const handler = stageHandlers[stage];
        return stateAsUpdate(await handler({ ports: options.ports, run, state }));
      } catch (error: unknown) {
        if (isGraphBubbleUp(error)) throw error;
        if (readProperty(error, "stage") === "workflow-graph.run-version") {
          throw new AssessmentGraphNodeFailureV1(
            graphError({
              code: "VERSION_CONFLICT",
              stage,
              detailCode: "run-state-version-conflict",
              occurredAt: options.ports.now().toISOString(),
            }),
          );
        }
        return stateAsUpdate(
          await recordNodeFailure({
            ports: options.ports,
            run,
            state,
            stage,
            error,
          }),
        );
      }
    });
  }
  graph.addNode(WAIT_NODE_V1, async (channels, config) => {
    const now = options.ports.now().toISOString();
    const run = readAssessmentRunContext({ config, occurredAt: now });
    // 与阶段节点同形：通道投影可能缺少未写入的可选键，阶段与状态以已登记事实为准（design D-08）。
    const cursor = await readAssessmentCursor({ ports: options.ports, run });
    const state = parseAssessmentGraphState(
      {
        ...stateOfChannels(channels),
        ...(cursor === undefined ? {} : { stage: cursor.stage, status: cursor.status }),
      },
      now,
    );
    const resumeValue: unknown = interrupt(state.waitingRef);
    if (!isResumeValue(resumeValue)) {
      fail(
        contractInvalid({
          stage: state.stage,
          detailCode: "resume-value-invalid",
          occurredAt: now,
        }),
      );
    }
    const { waitingRef, ...rest } = state;
    // 恢复必须以精确等待引用为依据：引用缺失时不进入运行态，按契约不一致失败闭合。
    if (waitingRef === undefined) {
      fail(
        contractInvalid({
          stage: state.stage,
          detailCode: "waiting-reference-missing",
          occurredAt: now,
        }),
      );
    }
    return stateAsUpdate(parseAssessmentGraphState({ ...rest, status: "running" }, now));
  });
  graph.addEdge(START, NODE_FOR_STAGE_V1.A0);
  const routes: Record<string, NodeNameV1> = {
    [END]: END,
    [WAIT_NODE_V1]: WAIT_NODE_V1,
  };
  for (const stage of FULL_STAGE_SEQUENCE_V1) {
    routes[NODE_FOR_STAGE_V1[stage]] = NODE_FOR_STAGE_V1[stage];
  }
  const router = (channels: GraphChannelsV1): NodeNameV1 => {
    if (channels.status === "waiting") return WAIT_NODE_V1;
    if (channels.status === "running" || channels.status === "pending") {
      return NODE_FOR_STAGE_V1[channels.stage];
    }
    return END;
  };
  for (const stage of FULL_STAGE_SEQUENCE_V1) {
    graph.addConditionalEdges(NODE_FOR_STAGE_V1[stage], router, routes);
  }
  graph.addConditionalEdges(WAIT_NODE_V1, router, routes);
  // `durability: "sync"`：每个 superstep 末等待检查点落库后再继续，恢复才能与业务事实对账。
  const compiled = graph.compile({ checkpointer: options.checkpointer });
  return {
    invoke: (input, config) => compiled.invoke(input.graph, { ...config, durability: "sync" }),
    resume: (input, config) =>
      compiled.invoke(
        new Command<AssessmentGraphResumeValueV1, GraphChannelsV1, NodeNameV1>({
          resume: input.resume,
        }),
        {
          ...config,
          durability: "sync",
        },
      ),
    retry: (state, config) =>
      compiled.invoke(
        new Command<AssessmentGraphResumeValueV1, GraphChannelsV1, NodeNameV1>({
          update: stateAsUpdate({ ...state, status: "running" }),
          goto: NODE_FOR_STAGE_V1[state.stage],
        }),
        { ...config, durability: "sync" },
      ),
    recover: async (state, completedNode, config) => {
      await compiled.updateState(config, stateAsUpdate(state), completedNode);
      if (
        state.status === "completed" ||
        state.status === "cancelled" ||
        state.status === "terminal-failure" ||
        state.status === "retryable-failure"
      ) {
        return state;
      }
      return compiled.invoke(null, { ...config, durability: "sync" });
    },
    getState: (config) => compiled.getState(config),
  };
};
