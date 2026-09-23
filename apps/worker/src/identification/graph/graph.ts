/**
 * C24 I0～I9 识别子图（design D-02/D-05/D-08，IP-14）。
 *
 * 本文件只做编排：用真实 `@langchain/langgraph` 的 `StateGraph` 把 I0～I9 固定为一条顺序路线，
 * 节点只调用 C03/C04/C17/C21/C22 的公开端口、C24 核心纯函数与注入的策略目录。节点不读其它
 * 模块私表、Qdrant 或文件路径，不匹配完整错误文案，不实现第二套状态机，也不做未批准的并发
 * 扇出：逐工作项与逐分组的稳定游标全部由 C24 `run-state` 登记行重建。
 *
 * 通道正文就是公开 `IdentificationGraphStateV1`：入口、每次节点转换与输出都经
 * `IdentificationGraphStateV1Schema` 解析，解析失败一律收口为 `CONTRACT_INVALID`。
 *
 * 等待语义（design D-05/D-07）：节点先登记等待业务事实（C03 事务，含审计）再把状态置为
 * `waiting` 与 `toWaitingRef` 投影，`wait` 节点随后 `interrupt()` 暂停原线程。恢复时 `wait`
 * 节点不完成任何副作用，只把状态恢复为 `running`，由路由把控制权交回同一阶段，阶段节点按
 * 业务幂等身份重放；因此 checkpoint 只承载小型引用，业务事实永不来自 checkpoint 正文。
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
  ContentArtifactRefV1Schema,
  type AgentTaskPortV1,
  type ContentArtifactRefV1,
  type AgentTaskRefV1,
  type AuthorizationContextV1,
  type DomainEventRefV1,
  type IdentificationGroupRefV1,
  type IdentificationPreparationSnapshotRefV1,
  type IdentificationWorkItemRefV1,
  type IdentificationWorkPlanRefV1,
  type KnowledgeModelingPortV1,
  type ReviewDecisionRefV1,
  type WaitingRefV1,
  type RouteDecisionRefV1,
  type StageResultRefV1,
  type StandardizedRiskRecordRefV1,
  type WorkflowRunRefV1,
} from "@riskflow/contracts/ports";
import {
  IdentificationGraphStateV1Schema,
  IdentificationStageResultV1Schema,
  type IdentificationGraphStateV1,
  type IdentificationInputSnapshotV1,
  type IdentificationStageV1,
} from "@riskflow/contracts/workflows";

import type { AgentTaskSnapshotV1 } from "@riskflow/core/agent-runtime";
import {
  IdentificationContextError,
  type IdentificationContextService,
} from "@riskflow/core/identification/context";
import {
  RiskCandidateFinalizationError,
  decisionDispositionFor,
  type AcceptanceRouteV1,
  type IdentificationReviewDecisionReaderV1,
  type RiskCandidateFinalizationService,
} from "@riskflow/core/identification/candidate-finalization";
import {
  IdentificationGraphArtifactBodyV1Schema,
  IdentificationGraphErrorV1Schema,
  IdentificationGraphPolicySetV1Schema,
  IdentificationGraphResultRowV1Schema,
  IdentificationGraphRunStateV1Schema,
  buildIdentificationWorkPlan,
  classifyIdentificationGraphOutcome,
  identificationInputSnapshotRefFor,
  identificationWorkPlanRefFor,
  resolveIdentificationInputSnapshot,
  summarizeIdentificationRun,
  toWaitingRef,
  type IdentificationGraphErrorV1,
  type IdentificationGraphPolicySetV1,
  type IdentificationGraphResumeCauseV1,
  type IdentificationGraphProcessNodeFactV1,
  type IdentificationGraphResultRowV1,
  type IdentificationGraphRunStateV1,
  type IdentificationGraphWaitingV1,
  type IdentificationGraphWorkPlanBodyV1,
} from "@riskflow/core/identification/graph";
import {
  IdentificationKnowledgePackageV1Schema,
  type IdentificationKnowledgeReleaseReaderV1,
  type IdentificationPreparationKnowledgeReaderV1,
} from "@riskflow/core/identification-knowledge";
import type {
  AtomicCommitV1,
  TransactionContextV1,
  TransactionUnitV1,
} from "@riskflow/core/persistence";
import { sha256CanonicalJson } from "@riskflow/core/persistence";
import { authorizationScopeDigest } from "@riskflow/core/retrieval";

/** 运行上下文在 LangGraph `configurable` 中的稳定键。 */
export const IDENTIFICATION_GRAPH_RUN_CONFIG_KEY_V1 = "riskflowIdentificationGraphRunV1" as const;

/** 逐工作项顺序游标的五个阶段：I3 形成五项上下文，I4/I5 只对该项生成并校验候选。 */
const STAGE_SEQUENCE_V1: readonly IdentificationStageV1[] = [
  "I0",
  "I1",
  "I2",
  "I3",
  "I4",
  "I5",
  "I6",
  "I7",
  "I8",
  "I9",
];

/** 等待节点名：唯一 `interrupt()` 位置，保证恢复时先回到同一阶段重放（D-07）。 */
const WAIT_NODE_V1 = "wait" as const;

const NODE_FOR_STAGE_V1 = {
  I0: "I0",
  I1: "I1",
  I2: "I2",
  I3: "I3",
  I4: "I4",
  I5: "I5",
  I6: "I6",
  I7: "I7",
  I8: "I8",
  I9: "I9",
} as const satisfies Readonly<Record<IdentificationStageV1, string>>;

type NodeNameV1 =
  (typeof NODE_FOR_STAGE_V1)[IdentificationStageV1] | typeof WAIT_NODE_V1 | typeof END;

/** 恢复值：只携带稳定引用，不携带自由正文（`wait` 节点消费）。 */
export interface IdentificationGraphResumeValueV1 {
  readonly kind: "agent-task-completed" | "review-resolved" | "transient-recovered";
  readonly agentTaskRef?: AgentTaskRefV1;
  readonly reviewDecisionRef?: { readonly reference: VersionReference };
}

/** 一次 `start`/`resume` 的完整调用身份：冻结值全部来自命令或已登记事实。 */
export interface IdentificationGraphRunContextV1 {
  readonly projectId: string;
  readonly actorId: string;
  readonly authorization: AuthorizationContextV1;
  readonly commandId: string;
  readonly idempotencyKey: string;
  /** 记录时刻：登记行的 `recorded_at`。 */
  readonly issuedAt: string;
  /** 业务时刻：登记行的 `valid_at` 与 C17 双时间解析的 `requiredAt`。 */
  readonly validAt: string;
  readonly triggerReasonCode: string;
  readonly runRef: WorkflowRunRefV1;
  readonly parentRiskFlowRunRef: WorkflowRunRefV1;
  readonly graphVersion: VersionReference;
  readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
  readonly threadId: string;
}

/** C04 正文端口：正文只入 C04，登记行只保存精确引用（design D-04/D-06）。 */
export interface IdentificationGraphBodyPortV1 {
  putBody(command: {
    readonly projectId: string;
    readonly actorId: string;
    readonly commandId: string;
    readonly issuedAt: string;
    readonly artifactId: string;
    readonly body: unknown;
    readonly authorization: AuthorizationContextV1;
  }): Promise<unknown>;
  readWorkPlanBody(input: {
    readonly projectId: string;
    readonly workPlanRef: IdentificationWorkPlanRefV1;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<IdentificationGraphWorkPlanBodyV1 | undefined>;
  readInputSnapshotBody(input: {
    readonly projectId: string;
    readonly inputSnapshotRef: {
      readonly kind: "identification-input-snapshot";
      readonly reference: VersionReference;
    };
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<IdentificationInputSnapshotV1 | undefined>;
}

/** checkpoint 引用对账端口（design D-07）：只有当前授权下的业务回读，零补写。 */
export interface IdentificationGraphCheckpointReconcilerV1 {
  reconcileCheckpointReferences(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly state: IdentificationGraphStateV1;
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<
    | { readonly kind: "consistent"; readonly workPlan: unknown }
    | { readonly kind: "inconsistent"; readonly detailCode: string }
  >;
}

/**
 * 验收路线集窄读（C24 自有端口）：C22 `accept-groups` 要求整集分组与整集决定同时提交，
 * 因此图必须能按精确引用回读路线集正文，而 C22 与 C24 adapter 都没有对应 reader。
 * 组合根用 C22 公开结果端口 + C04 实现；图只消费闭合结果，不读 C22 私表。
 */
export interface IdentificationGraphAcceptanceRouteReaderV1 {
  readRoutes(input: {
    readonly projectId: string;
    readonly acceptanceRouteSetRef: {
      readonly kind: "acceptance-route-set";
      readonly reference: VersionReference;
    };
    readonly actorId: string;
    readonly requestedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<readonly AcceptanceRouteV1[] | undefined>;
}

/** C24 登记端口（与 core 冻结接口同形，见 `@riskflow/core/identification/graph`）。 */
export interface IdentificationGraphRegistrationStorePortV1 {
  assertCurrentRunVersion(
    input: {
      readonly projectId: string;
      readonly runId: string;
      readonly expectedRunVersionId: string | undefined;
    },
    context: unknown,
  ): Promise<void>;
  registerRow(
    input: { readonly row: IdentificationGraphResultRowV1; readonly occurredAt: string },
    context?: unknown,
  ): Promise<
    | { readonly kind: "registered"; readonly replayed: boolean }
    | { readonly kind: "idempotency-conflict"; readonly priorCommandId: string }
  >;
  readRow(input: {
    readonly projectId: string;
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
    readonly requestedAt: string;
    readonly resultKind: IdentificationGraphResultRowV1["resultKind"];
    readonly resultId: string;
    readonly resultVersionId: string;
  }): Promise<IdentificationGraphResultRowV1 | undefined>;
  listRunRows(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
    readonly requestedAt: string;
  }): Promise<readonly IdentificationGraphResultRowV1[]>;
  readLatestRunState(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly actorId: string;
    readonly authorization: AuthorizationContextV1;
    readonly requestedAt: string;
  }): Promise<
    | {
        readonly row: Extract<IdentificationGraphResultRowV1, { readonly resultKind: "run-state" }>;
        readonly state: IdentificationGraphRunStateV1;
      }
    | undefined
  >;
}

/** 图节点可用的全部注入端口；任一必需项缺失即拒绝构造（design D-03/D-04）。 */
export interface IdentificationGraphPortsV1 {
  readonly transactionUnit: TransactionUnitV1;
  readonly registrationStore: IdentificationGraphRegistrationStorePortV1;
  readonly bodies: IdentificationGraphBodyPortV1;
  readonly checkpoints: IdentificationGraphCheckpointReconcilerV1;
  readonly policyProvider: {
    resolveExact(input: {
      readonly projectId: string;
      readonly preparationSnapshotRef: IdentificationPreparationSnapshotRefV1;
      readonly requiredAt: string;
      readonly asOfRecordedAt: string;
      readonly authorization: AuthorizationContextV1;
    }): Promise<IdentificationGraphPolicySetV1 | undefined>;
  };
  /** C21 检索审阅策略正文：由同一策略目录按精确引用解析，图不内建默认值。 */
  readonly reviewPolicy: () => Promise<unknown>;
  readonly basisResolver: Pick<KnowledgeModelingPortV1, "resolve">;
  readonly preparationReader: Pick<
    IdentificationPreparationKnowledgeReaderV1,
    "readExactPreparation"
  >;
  readonly knowledgeReleaseReader: Pick<IdentificationKnowledgeReleaseReaderV1, "readExact">;
  readonly contextService: Pick<IdentificationContextService, "prepareReview" | "assembleContext">;
  readonly agentTasks: Pick<AgentTaskPortV1, "startTask">;
  /** C23 任务快照窄读：只读任务状态与增量结果引用，任务正文不进入 C24。 */
  readonly agentTaskReader: {
    getTask(taskRef: AgentTaskRefV1): Promise<AgentTaskSnapshotV1 | undefined>;
  };
  readonly finalizationService: Pick<RiskCandidateFinalizationService, "analyze" | "finalize">;
  readonly reviewDecisionReader: IdentificationReviewDecisionReaderV1;
  readonly acceptanceRoutes: IdentificationGraphAcceptanceRouteReaderV1;
  readonly now: () => Date;
}

/** 首次运行输入：通道正文就是完整公开状态。 */
export interface IdentificationGraphInputV1 {
  readonly graph: IdentificationGraphStateV1;
}

/** 编译后的子图运行面：由 runtime 独占，节点不直接调用它。 */
export interface IdentificationGraphRunnerV1 {
  /** 首次运行：从完整状态进入图。 */
  invoke(input: IdentificationGraphInputV1, config: LangGraphRunnableConfig): Promise<unknown>;
  /** 恢复：以冻结的恢复原因重建 `Command` 后恢复同一线程（同一 thread ID）。 */
  resume(
    input: { readonly resume: IdentificationGraphResumeCauseV1 },
    config: LangGraphRunnableConfig,
  ): Promise<unknown>;
  /** 技术失败重试：从已持久化阶段显式回到同一节点，不经过等待中断通道。 */
  retry(state: IdentificationGraphStateV1, config: LangGraphRunnableConfig): Promise<unknown>;
  getState(config: LangGraphRunnableConfig): Promise<unknown>;
}

/** 节点内部失败：只带稳定 C24 错误，不携带上游正文。 */
export class IdentificationGraphNodeFailureV1 extends Error {
  readonly error: IdentificationGraphErrorV1;

  constructor(error: IdentificationGraphErrorV1) {
    super(`${error.code}:${error.detailCode}`);
    this.name = "IdentificationGraphNodeFailureV1";
    this.error = error;
  }
}

/** 登记端口报告同键异载荷：不可重试冲突，不覆盖首次业务事实（design D-06）。 */
export class IdentificationGraphConflictV1 extends Error {
  constructor(readonly priorCommandId: string) {
    super("IDEMPOTENCY_CONFLICT");
    this.name = "IdentificationGraphConflictV1";
  }
}

/**
 * 字段级通道：通道名必须与 `IdentificationGraphStateV1` 的字段一一对应。C03 checkpointer 按
 * `IdentificationGraphStateV1Schema.shape` 校验每次写入，并把 `channel_values` 直接解析为该
 * Schema（只剔除 LangGraph 协议通道），因此不能用单一包裹通道承载整份状态。
 *
 * 可选字段以显式 `undefined` 写回即可清空：LangGraph 会保留该键、值解析为 `undefined`，
 * zod 的 `.optional()` 与 checkpointer 的写入校验都接受。
 */
const channelsAnnotation = Annotation.Root({
  schemaVersion: Annotation<IdentificationGraphStateV1["schemaVersion"]>(),
  graphVersion: Annotation<IdentificationGraphStateV1["graphVersion"]>(),
  parentRiskFlowRunRef: Annotation<IdentificationGraphStateV1["parentRiskFlowRunRef"]>(),
  runRef: Annotation<IdentificationGraphStateV1["runRef"]>(),
  threadId: Annotation<IdentificationGraphStateV1["threadId"]>(),
  triggerType: Annotation<IdentificationGraphStateV1["triggerType"]>(),
  triggerReasonCode: Annotation<IdentificationGraphStateV1["triggerReasonCode"]>(),
  authorizationContextRef: Annotation<IdentificationGraphStateV1["authorizationContextRef"]>(),
  preparationSnapshotRef: Annotation<IdentificationGraphStateV1["preparationSnapshotRef"]>(),
  inputSnapshotRef: Annotation<IdentificationGraphStateV1["inputSnapshotRef"]>(),
  status: Annotation<IdentificationGraphStateV1["status"]>(),
  stage: Annotation<IdentificationGraphStateV1["stage"]>(),
  workPlanRef: Annotation<IdentificationGraphStateV1["workPlanRef"]>(),
  candidateSetRef: Annotation<IdentificationGraphStateV1["candidateSetRef"]>(),
  mergePlanRef: Annotation<IdentificationGraphStateV1["mergePlanRef"]>(),
  waitingRef: Annotation<IdentificationGraphStateV1["waitingRef"]>(),
  agentTaskRefs: Annotation<IdentificationGraphStateV1["agentTaskRefs"]>(),
  acceptedRiskRecordRefs: Annotation<IdentificationGraphStateV1["acceptedRiskRecordRefs"]>(),
  reviewTaskRefs: Annotation<IdentificationGraphStateV1["reviewTaskRefs"]>(),
  rejectedGroupRefs: Annotation<IdentificationGraphStateV1["rejectedGroupRefs"]>(),
  failedWorkItemRefs: Annotation<IdentificationGraphStateV1["failedWorkItemRefs"]>(),
  lastStageResultRef: Annotation<IdentificationGraphStateV1["lastStageResultRef"]>(),
  lastRouteDecisionRef: Annotation<IdentificationGraphStateV1["lastRouteDecisionRef"]>(),
  lastErrorRef: Annotation<IdentificationGraphStateV1["lastErrorRef"]>(),
  resultRef: Annotation<IdentificationGraphStateV1["resultRef"]>(),
});

type GraphChannelsV1 = typeof channelsAnnotation.State;

/** 通道集合 → 严格状态输入：只取本注解声明的字段，忽略 LangGraph 内部通道。 */
const stateOfChannels = (channels: GraphChannelsV1): Record<string, unknown> => {
  const declared = new Set(Object.keys(channelsAnnotation.spec));
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(channels)) {
    if (declared.has(key)) record[key] = value;
  }
  return record;
};

/** 严格状态 → 通道更新：逐字段写回，可选字段以显式 `undefined` 清空。 */
const stateAsUpdate = (state: IdentificationGraphStateV1): GraphChannelsV1 => ({
  schemaVersion: state.schemaVersion,
  graphVersion: state.graphVersion,
  parentRiskFlowRunRef: state.parentRiskFlowRunRef,
  runRef: state.runRef,
  threadId: state.threadId,
  triggerType: state.triggerType,
  triggerReasonCode: state.triggerReasonCode,
  authorizationContextRef: state.authorizationContextRef,
  preparationSnapshotRef: state.preparationSnapshotRef,
  inputSnapshotRef: state.inputSnapshotRef,
  status: state.status,
  stage: state.stage,
  workPlanRef: state.workPlanRef,
  candidateSetRef: state.candidateSetRef,
  mergePlanRef: state.mergePlanRef,
  waitingRef: state.waitingRef,
  agentTaskRefs: state.agentTaskRefs,
  acceptedRiskRecordRefs: state.acceptedRiskRecordRefs,
  reviewTaskRefs: state.reviewTaskRefs,
  rejectedGroupRefs: state.rejectedGroupRefs,
  failedWorkItemRefs: state.failedWorkItemRefs,
  lastStageResultRef: state.lastStageResultRef,
  lastRouteDecisionRef: state.lastRouteDecisionRef,
  lastErrorRef: state.lastErrorRef,
  resultRef: state.resultRef,
});

const stageOf = (value: unknown): IdentificationStageV1 => {
  if (typeof value === "object" && value !== null && "stage" in value) {
    const stage = (value as { readonly stage?: unknown }).stage;
    if (typeof stage === "string") {
      const matched = STAGE_SEQUENCE_V1.find((candidate) => candidate === stage);
      if (matched !== undefined) return matched;
    }
  }
  return "I0";
};

const graphError = (input: {
  readonly code: IdentificationGraphErrorV1["code"];
  readonly stage: IdentificationStageV1;
  readonly detailCode: string;
  readonly occurredAt: string;
  readonly retryable?: boolean;
}): IdentificationGraphErrorV1 =>
  IdentificationGraphErrorV1Schema.parse({
    schemaVersion: "1",
    code: input.code,
    retryable: input.retryable ?? false,
    stage: input.stage,
    detailCode: input.detailCode,
    occurredAt: input.occurredAt,
  });

/** 状态通道唯一解析点：任何失败都收口为 `CONTRACT_INVALID`。 */
export const parseIdentificationGraphState = (
  value: unknown,
  occurredAt: string,
): IdentificationGraphStateV1 => {
  const parsed = IdentificationGraphStateV1Schema.safeParse(value);
  if (!parsed.success) {
    throw new IdentificationGraphNodeFailureV1(
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
export const readRunContext = (input: {
  readonly config: LangGraphRunnableConfig;
  readonly occurredAt: string;
}): IdentificationGraphRunContextV1 => {
  const value = input.config.configurable?.[IDENTIFICATION_GRAPH_RUN_CONFIG_KEY_V1];
  const candidate =
    typeof value === "object" && value !== null
      ? (value as { readonly commandId?: unknown; readonly projectId?: unknown })
      : undefined;
  if (
    candidate === undefined ||
    typeof candidate.commandId !== "string" ||
    typeof candidate.projectId !== "string"
  ) {
    throw new IdentificationGraphNodeFailureV1(
      graphError({
        code: "CONTRACT_INVALID",
        stage: "I0",
        detailCode: "graph-run-context-missing",
        occurredAt: input.occurredAt,
      }),
    );
  }
  return value as IdentificationGraphRunContextV1;
};

const isResumeValue = (value: unknown): value is IdentificationGraphResumeValueV1 =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  typeof (value as { readonly kind?: unknown }).kind === "string";

const readProperty = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;

const versionReferenceOf = (value: unknown): VersionReference | undefined => {
  const entityId = readProperty(value, "entityId");
  const versionId = readProperty(value, "versionId");
  return typeof entityId === "string" && typeof versionId === "string"
    ? { entityId, versionId }
    : undefined;
};

const sameVersionReference = (left: VersionReference, right: VersionReference): boolean =>
  left.entityId === right.entityId && left.versionId === right.versionId;

/** 上游端口失败 → C24 稳定错误：只读 code/retryable/blockerKind，不匹配文案。 */
export const toIdentificationGraphError = (input: {
  readonly stage: IdentificationStageV1;
  readonly error: unknown;
  readonly occurredAt: string;
  readonly detailCodeOfModuleError?: (details: {
    readonly code: string;
    readonly blockerKind?: string;
    readonly stageCode: string;
  }) => string;
}): IdentificationGraphErrorV1 => {
  const { stage, error, occurredAt } = input;
  if (error instanceof IdentificationGraphConflictV1) {
    return classifyIdentificationGraphOutcome({
      stage,
      upstream: { code: "IDEMPOTENCY_CONFLICT", retryable: false },
      detailCode: "registration-idempotency-conflict",
      occurredAt,
    });
  }
  if (error instanceof IdentificationGraphNodeFailureV1) return error.error;
  if (
    error instanceof IdentificationContextError ||
    error instanceof RiskCandidateFinalizationError
  ) {
    const details = error.details;
    const detailCode =
      details.code === "BUSINESS_BLOCKED" ? details.blockerKind : details.stageCode;
    return classifyIdentificationGraphOutcome({
      stage,
      upstream: { code: details.code, retryable: details.retryable },
      detailCode,
      occurredAt,
    });
  }
  const code = readProperty(error, "code");
  const retryable = readProperty(error, "retryable");
  if (typeof code !== "string") {
    return classifyIdentificationGraphOutcome({
      stage,
      upstream: { code: "UNSUPPORTED_CONTRACT", retryable: false },
      detailCode: "unrecognized-port-failure",
      occurredAt,
    });
  }
  if (code === "TRANSACTION_FAILED") {
    return classifyIdentificationGraphOutcome({
      stage,
      upstream: { code: "TRANSIENT_FAILURE", retryable: true },
      detailCode: code,
      occurredAt,
    });
  }
  return classifyIdentificationGraphOutcome({
    stage,
    upstream: { code, retryable: typeof retryable === "boolean" ? retryable : false },
    detailCode: code,
    occurredAt,
  });
};

function fail(error: IdentificationGraphErrorV1): never {
  throw new IdentificationGraphNodeFailureV1(error);
}

const artifactIdFor = (kind: string, runId: string, suffix: string): string =>
  `identification-graph-${kind}:${runId}:${suffix}`;

const actionIdFor = (run: IdentificationGraphRunContextV1, suffix: string): string =>
  `${run.runRef.reference.versionId}:${suffix}`;

const contractInvalid = (input: {
  readonly stage: IdentificationStageV1;
  readonly detailCode: string;
  readonly occurredAt: string;
}): IdentificationGraphErrorV1 =>
  graphError({ code: "CONTRACT_INVALID", ...input, retryable: false });

/** 一次业务动作的提交材料：正文只入 C04，登记行与审计同属一个 C03 事务（D-07 第 1 步）。 */
interface StageCommitV1 {
  readonly actionSuffix: string;
  readonly commandKind: string;
  readonly bodies: readonly {
    readonly artifactId: string;
    readonly build: (artifactRefs: ReadonlyMap<string, ContentArtifactRefV1>) => unknown;
  }[];
  readonly rows: (
    artifactRefs: ReadonlyMap<string, ContentArtifactRefV1>,
    runVersionId: string,
  ) => readonly IdentificationGraphResultRowV1[];
  readonly runVersionId: string;
  readonly expectedRunVersionId: string | undefined;
  readonly occurredAt: string;
}

/** 登记行公共列：所有行只在同一 C03 事务里追加，不 UPDATE 既有行。 */
const rowBase = (input: {
  readonly run: IdentificationGraphRunContextV1;
  readonly artifactRef: ContentArtifactRefV1;
  readonly runVersionId: string;
  readonly resultKind: IdentificationGraphResultRowV1["resultKind"];
  readonly idempotencySuffix: string;
  readonly auditEntryId: string;
  readonly recordedAt: string;
  readonly validAt: string;
}): Omit<
  Extract<IdentificationGraphResultRowV1, { readonly resultKind: "run-state" }>,
  "resultKind"
> => ({
  schemaVersion: "1",
  projectId: input.run.projectId,
  resultId: input.artifactRef.reference.entityId,
  resultVersionId: input.artifactRef.reference.versionId,
  runId: input.run.runRef.reference.entityId,
  runVersionId: input.runVersionId,
  commandId: actionIdFor(input.run, input.idempotencySuffix),
  idempotencyKey: `identification-graph:${input.resultKind}:${input.idempotencySuffix}`,
  requestDigest: sha256CanonicalJson({
    resultKind: input.resultKind,
    artifactRef: input.artifactRef,
  }),
  artifactRef: input.artifactRef,
  authorizationScopeDigest: authorizationScopeDigest(input.run.authorization),
  actorRef: input.run.actorId,
  authorizationContextRef: input.run.authorization.authorizationContextRef,
  validAt: input.validAt,
  recordedAt: input.recordedAt,
  persistedAt: input.recordedAt,
  auditEntryId: input.auditEntryId,
});

const artifactRefFrom = (
  artifactRefs: ReadonlyMap<string, ContentArtifactRefV1>,
  artifactId: string,
): ContentArtifactRefV1 => {
  const ref = artifactRefs.get(artifactId);
  if (ref === undefined) throw new TypeError("stage commit is missing a body reference");
  return ref;
};

/** C04 正文先行，随后 C03 事务提交登记行与审计；checkpoint 仍由 LangGraph 在之后独立写入。 */
const commitStage = async (
  ports: IdentificationGraphPortsV1,
  run: IdentificationGraphRunContextV1,
  commit: StageCommitV1,
): Promise<ReadonlyMap<string, ContentArtifactRefV1>> => {
  const actionId = actionIdFor(run, commit.actionSuffix);
  const artifactRefs = new Map<string, ContentArtifactRefV1>();
  for (const body of commit.bodies) {
    // C04 幂等键按正文身份派生：同一次阶段提交可能写多份正文（阶段结果 + 运行状态），
    // 复用同一命令身份会因「同键异载荷」被判为 ARTIFACT_IDEMPOTENCY_CONFLICT。
    // 同轮重放仍得同键，跨轮由 actionSuffix 变化区分。
    const bodyCommandId = `${actionId}:body:${body.artifactId}`;
    const put = await ports.bodies.putBody({
      projectId: run.projectId,
      actorId: run.actorId,
      commandId: bodyCommandId,
      issuedAt: run.issuedAt,
      artifactId: body.artifactId,
      body: IdentificationGraphArtifactBodyV1Schema.parse(body.build(artifactRefs)),
      authorization: run.authorization,
    });
    artifactRefs.set(body.artifactId, ContentArtifactRefV1Schema.parse(put));
  }
  const rows = commit
    .rows(artifactRefs, commit.runVersionId)
    .map((row) => IdentificationGraphResultRowV1Schema.parse(row));
  const primary = rows[0];
  if (primary === undefined) throw new TypeError("stage commit requires at least one row");
  const auditEntryId = `${actionId}:audit`;
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
          throw new IdentificationGraphConflictV1(outcome.priorCommandId);
        }
      }
      return {
        resultRef: primary.artifactRef,
        audit: {
          auditEntryId,
          projectId: run.projectId,
          action: commit.commandKind,
          targetRef: primary.artifactRef,
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
  return artifactRefs;
};

export const readCursor = async (input: {
  readonly ports: IdentificationGraphPortsV1;
  readonly run: IdentificationGraphRunContextV1;
}): Promise<IdentificationGraphRunStateV1 | undefined> => {
  const latest = await input.ports.registrationStore.readLatestRunState({
    projectId: input.run.projectId,
    runId: input.run.runRef.reference.entityId,
    actorId: input.run.actorId,
    authorization: input.run.authorization,
    requestedAt: input.run.issuedAt,
  });
  return latest?.state;
};

/** 游标内容 → 游标正文：版本只摘要内容本身，同一内容永远得到同一版本（design D-06）。 */
const cursorBody = (input: {
  readonly runId: string;
  readonly stage: IdentificationStageV1;
  readonly status: IdentificationGraphRunStateV1["status"];
  readonly previous: IdentificationGraphRunStateV1 | undefined;
  readonly patch?: {
    readonly completedWorkItemRefs?: IdentificationGraphRunStateV1["completedWorkItemRefs"];
    readonly pendingWorkItemRefs?: IdentificationGraphRunStateV1["pendingWorkItemRefs"];
    readonly validatedCandidateSetRefs?: IdentificationGraphRunStateV1["validatedCandidateSetRefs"];
    readonly failedWorkItemRefs?: IdentificationGraphRunStateV1["failedWorkItemRefs"];
    readonly acceptedRiskRecordRefs?: IdentificationGraphRunStateV1["acceptedRiskRecordRefs"];
    readonly rejectedGroupRefs?: IdentificationGraphRunStateV1["rejectedGroupRefs"];
    readonly pendingGroupRefs?: IdentificationGraphRunStateV1["pendingGroupRefs"];
    readonly acceptedRouteSetRef?: IdentificationGraphRunStateV1["acceptedRouteSetRef"];
    readonly lastStageResultRef?: IdentificationGraphRunStateV1["lastStageResultRef"];
    readonly lastWaitingRef?: IdentificationGraphRunStateV1["lastWaitingRef"];
    readonly lastErrorRef?: IdentificationGraphRunStateV1["lastErrorRef"];
    readonly resultRef?: IdentificationGraphRunStateV1["resultRef"];
  };
}): { readonly state: IdentificationGraphRunStateV1; readonly body: unknown } => {
  const patch = input.patch ?? {};
  const previous = input.previous;
  const acceptedRouteSetRef = patch.acceptedRouteSetRef ?? previous?.acceptedRouteSetRef;
  const lastStageResultRef = patch.lastStageResultRef ?? previous?.lastStageResultRef;
  const lastWaitingRef = patch.lastWaitingRef ?? previous?.lastWaitingRef;
  const lastErrorRef = patch.lastErrorRef ?? previous?.lastErrorRef;
  const resultRef = patch.resultRef ?? previous?.resultRef;
  const withoutVersion: Omit<IdentificationGraphRunStateV1, "runVersionId"> = {
    schemaVersion: "1",
    runId: input.runId,
    stage: input.stage,
    status: input.status,
    completedWorkItemRefs: patch.completedWorkItemRefs ?? previous?.completedWorkItemRefs ?? [],
    pendingWorkItemRefs: patch.pendingWorkItemRefs ?? previous?.pendingWorkItemRefs ?? [],
    validatedCandidateSetRefs:
      patch.validatedCandidateSetRefs ?? previous?.validatedCandidateSetRefs ?? [],
    failedWorkItemRefs: patch.failedWorkItemRefs ?? previous?.failedWorkItemRefs ?? [],
    acceptedRiskRecordRefs: patch.acceptedRiskRecordRefs ?? previous?.acceptedRiskRecordRefs ?? [],
    rejectedGroupRefs: patch.rejectedGroupRefs ?? previous?.rejectedGroupRefs ?? [],
    pendingGroupRefs: patch.pendingGroupRefs ?? previous?.pendingGroupRefs ?? [],
    ...(acceptedRouteSetRef === undefined ? {} : { acceptedRouteSetRef }),
    ...(lastStageResultRef === undefined ? {} : { lastStageResultRef }),
    ...(lastWaitingRef === undefined ? {} : { lastWaitingRef }),
    ...(lastErrorRef === undefined ? {} : { lastErrorRef }),
    ...(resultRef === undefined ? {} : { resultRef }),
  };
  const state = IdentificationGraphRunStateV1Schema.parse({
    ...withoutVersion,
    runVersionId: sha256CanonicalJson(withoutVersion),
  });
  return { state, body: { bodyKind: "run-state", runState: state } };
};

interface AdvanceInputV1 {
  readonly ports: IdentificationGraphPortsV1;
  readonly run: IdentificationGraphRunContextV1;
  readonly state: IdentificationGraphStateV1;
  /** 已完成工作的阶段。 */
  readonly stage: IdentificationStageV1;
  /** 下一个要执行的阶段（同一阶段表示"还有同类工作项"）。 */
  readonly nextStage: IdentificationStageV1;
  /** 本阶段动作的稳定身份后缀（含工作项/分组身份），同一动作重放得到同一身份。 */
  readonly actionSuffix: string;
  readonly cursor: IdentificationGraphRunStateV1 | undefined;
  readonly cursorPatch?: Parameters<typeof cursorBody>[0]["patch"];
  readonly stageResult?: unknown;
  readonly stageResultRow: boolean;
  readonly status?: IdentificationGraphRunStateV1["status"];
  readonly extraBodies?: readonly {
    readonly artifactId: string;
    readonly build: (artifactRefs: ReadonlyMap<string, ContentArtifactRefV1>) => unknown;
  }[];
  readonly extraRows?: (input: {
    readonly artifactRefs: ReadonlyMap<string, ContentArtifactRefV1>;
    readonly runVersionId: string;
    readonly stageResultRef: StageResultRefV1 | undefined;
    readonly auditEntryId: string;
  }) => readonly IdentificationGraphResultRowV1[];
  /** 状态补丁：只允许公开状态 schema 允许的字段，未提供时保留原值。 */
  readonly statePatch?: {
    readonly inputSnapshotRef?: IdentificationGraphStateV1["inputSnapshotRef"];
    readonly workPlanRef?: IdentificationGraphStateV1["workPlanRef"];
    readonly candidateSetRef?: IdentificationGraphStateV1["candidateSetRef"];
    readonly mergePlanRef?: IdentificationGraphStateV1["mergePlanRef"];
    readonly agentTaskRefs?: IdentificationGraphStateV1["agentTaskRefs"];
    readonly reviewTaskRefs?: IdentificationGraphStateV1["reviewTaskRefs"];
    readonly rejectedGroupRefs?: IdentificationGraphStateV1["rejectedGroupRefs"];
    readonly acceptedRiskRecordRefs?: IdentificationGraphStateV1["acceptedRiskRecordRefs"];
    readonly failedWorkItemRefs?: IdentificationGraphStateV1["failedWorkItemRefs"];
    readonly resultRef?: IdentificationGraphStateV1["resultRef"];
    readonly lastRouteDecisionRef?: IdentificationGraphStateV1["lastRouteDecisionRef"];
  };
  readonly commandKind: string;
}

/**
 * 推进一个阶段：写阶段结果正文（可选）与额外正文，再在**同一** C03 事务里登记阶段结果行、
 * 新游标行与额外行，并让状态指向下一阶段。正文写入一律先于业务事务（design D-07）。
 */
const advance = async (input: AdvanceInputV1): Promise<IdentificationGraphStateV1> => {
  const { ports, run, state } = input;
  const occurredAt = ports.now().toISOString();
  const suffix = input.actionSuffix;
  const stageResultArtifactId = artifactIdFor(
    "stage-result",
    run.runRef.reference.entityId,
    suffix,
  );
  const runStateArtifactId = artifactIdFor("run-state", run.runRef.reference.entityId, suffix);
  const cursor = cursorBody({
    runId: run.runRef.reference.entityId,
    stage: input.nextStage,
    status: input.status ?? "running",
    previous: input.cursor,
    ...(input.cursorPatch === undefined ? {} : { patch: input.cursorPatch }),
  });
  const bodies: {
    readonly artifactId: string;
    readonly build: (artifactRefs: ReadonlyMap<string, ContentArtifactRefV1>) => unknown;
  }[] = [];
  if (input.stageResult !== undefined) {
    const stageResult = input.stageResult;
    bodies.push({
      artifactId: stageResultArtifactId,
      build: () => ({ bodyKind: "stage-result", stageResult }),
    });
  }
  bodies.push(...(input.extraBodies ?? []));
  bodies.push({ artifactId: runStateArtifactId, build: () => cursor.body });
  const actionId = actionIdFor(run, suffix);
  const artifactRefs = await commitStage(ports, run, {
    actionSuffix: suffix,
    commandKind: input.commandKind,
    bodies,
    runVersionId: cursor.state.runVersionId,
    expectedRunVersionId: input.cursor?.runVersionId,
    occurredAt,
    rows: (refs, runVersionId) => {
      const runStateRef = artifactRefFrom(refs, runStateArtifactId);
      const stageResultRef =
        input.stageResult === undefined
          ? undefined
          : {
              kind: "stage-result" as const,
              reference: artifactRefFrom(refs, stageResultArtifactId).reference,
            };
      const rows: IdentificationGraphResultRowV1[] = [];
      if (stageResultRef !== undefined && input.stageResultRow) {
        const workPlanRef = input.statePatch?.workPlanRef ?? state.workPlanRef;
        if (workPlanRef === undefined) {
          throw new TypeError("stage result registration requires the frozen work plan");
        }
        rows.push(
          IdentificationGraphResultRowV1Schema.parse({
            ...rowBase({
              run,
              artifactRef: artifactRefFrom(refs, stageResultArtifactId),
              runVersionId,
              resultKind: "stage-result",
              idempotencySuffix: suffix,
              auditEntryId: `${actionId}:audit`,
              recordedAt: occurredAt,
              validAt: run.validAt,
            }),
            resultKind: "stage-result",
            workPlanRef,
            stageResultRef,
          }),
        );
      }
      rows.push(
        IdentificationGraphResultRowV1Schema.parse({
          ...rowBase({
            run,
            artifactRef: runStateRef,
            runVersionId,
            resultKind: "run-state",
            idempotencySuffix: `${suffix}:run-state:${runVersionId}`,
            auditEntryId: `${actionId}:audit`,
            recordedAt: occurredAt,
            validAt: run.validAt,
          }),
          resultKind: "run-state",
        }),
      );
      rows.push(
        ...(input.extraRows?.({
          artifactRefs: refs,
          runVersionId,
          stageResultRef,
          auditEntryId: `${actionId}:audit`,
        }) ?? []),
      );
      return rows;
    },
  });
  const writtenStageResultRef =
    input.stageResult === undefined
      ? undefined
      : {
          kind: "stage-result" as const,
          reference: artifactRefFrom(artifactRefs, stageResultArtifactId).reference,
        };
  const patch = input.statePatch ?? {};
  const resultRef = patch.resultRef ?? state.resultRef;
  const lastRouteDecisionRef = patch.lastRouteDecisionRef ?? state.lastRouteDecisionRef;
  const nextState: IdentificationGraphStateV1 = {
    schemaVersion: "1",
    graphVersion: state.graphVersion,
    parentRiskFlowRunRef: state.parentRiskFlowRunRef,
    runRef: state.runRef,
    threadId: state.threadId,
    triggerType: state.triggerType,
    triggerReasonCode: state.triggerReasonCode,
    authorizationContextRef: state.authorizationContextRef,
    preparationSnapshotRef: state.preparationSnapshotRef,
    status: input.status ?? "running",
    stage: input.nextStage,
    agentTaskRefs: patch.agentTaskRefs ?? state.agentTaskRefs,
    acceptedRiskRecordRefs: patch.acceptedRiskRecordRefs ?? state.acceptedRiskRecordRefs,
    reviewTaskRefs: patch.reviewTaskRefs ?? state.reviewTaskRefs,
    rejectedGroupRefs: patch.rejectedGroupRefs ?? state.rejectedGroupRefs,
    failedWorkItemRefs: patch.failedWorkItemRefs ?? state.failedWorkItemRefs,
    ...((patch.inputSnapshotRef ?? state.inputSnapshotRef) === undefined
      ? {}
      : { inputSnapshotRef: patch.inputSnapshotRef ?? state.inputSnapshotRef }),
    ...((patch.workPlanRef ?? state.workPlanRef) === undefined
      ? {}
      : { workPlanRef: patch.workPlanRef ?? state.workPlanRef }),
    ...((patch.candidateSetRef ?? state.candidateSetRef) === undefined
      ? {}
      : { candidateSetRef: patch.candidateSetRef ?? state.candidateSetRef }),
    ...((patch.mergePlanRef ?? state.mergePlanRef) === undefined
      ? {}
      : { mergePlanRef: patch.mergePlanRef ?? state.mergePlanRef }),
    ...(input.stageResult === undefined || !input.stageResultRow
      ? state.lastStageResultRef === undefined
        ? {}
        : { lastStageResultRef: state.lastStageResultRef }
      : { lastStageResultRef: writtenStageResultRef }),
    ...(lastRouteDecisionRef === undefined ? {} : { lastRouteDecisionRef }),
    ...(resultRef === undefined ? {} : { resultRef }),
    ...(state.lastErrorRef === undefined ? {} : { lastErrorRef: state.lastErrorRef }),
  };
  return parseIdentificationGraphState(nextState, occurredAt);
};

/** 登记等待事实后再暂停：等待投影与游标同一事务提交（design D-05）。 */
const waitFor = async (input: {
  readonly ports: IdentificationGraphPortsV1;
  readonly run: IdentificationGraphRunContextV1;
  readonly state: IdentificationGraphStateV1;
  readonly stage: IdentificationStageV1;
  readonly cursor: IdentificationGraphRunStateV1 | undefined;
  readonly waiting: IdentificationGraphWaitingV1;
  /** 上游已给出投影后的等待引用时直接采用，避免二次投影漂移。 */
  readonly waitingRef?: WaitingRefV1;
  readonly suffix: string;
  /** 可选：本阶段在等待前成立的部分结果；未提供时不写阶段结果正文。 */
  readonly stageResult?: unknown;
}): Promise<IdentificationGraphStateV1> => {
  const { ports, run, state, stage, cursor, waiting } = input;
  const occurredAt = ports.now().toISOString();
  const waitingRef = input.waitingRef ?? toWaitingRef({ waiting });
  const suffix = `${input.suffix}:waiting`;
  const waitingArtifactId = artifactIdFor("waiting", run.runRef.reference.entityId, suffix);
  const runStateArtifactId = artifactIdFor("run-state", run.runRef.reference.entityId, suffix);
  const cursorState = cursorBody({
    runId: run.runRef.reference.entityId,
    stage,
    status: "waiting",
    previous: cursor,
    patch: { lastWaitingRef: waiting },
  });
  const actionId = actionIdFor(run, suffix);
  const bodies: {
    readonly artifactId: string;
    readonly build: (artifactRefs: ReadonlyMap<string, ContentArtifactRefV1>) => unknown;
  }[] = [];
  if (input.stageResult !== undefined) {
    const stageResult = input.stageResult;
    bodies.push({
      artifactId: waitingArtifactId,
      build: () => ({ bodyKind: "stage-result", stageResult }),
    });
  }
  bodies.push({ artifactId: runStateArtifactId, build: () => cursorState.body });
  await commitStage(ports, run, {
    actionSuffix: suffix,
    commandKind: "identification-graph.wait",
    bodies,
    runVersionId: cursorState.state.runVersionId,
    expectedRunVersionId: input.cursor?.runVersionId,
    occurredAt,
    rows: (refs, runVersionId) => {
      const waitingArtifact = artifactRefFrom(
        refs,
        input.stageResult === undefined ? runStateArtifactId : waitingArtifactId,
      );
      const rows: IdentificationGraphResultRowV1[] = [
        IdentificationGraphResultRowV1Schema.parse({
          ...rowBase({
            run,
            artifactRef: waitingArtifact,
            runVersionId,
            resultKind: "waiting",
            idempotencySuffix: suffix,
            auditEntryId: `${actionId}:audit`,
            recordedAt: occurredAt,
            validAt: run.validAt,
          }),
          resultKind: "waiting",
          waitingRef,
          ...(input.stageResult === undefined || state.workPlanRef === undefined
            ? {}
            : {
                stageResultRef: {
                  kind: "stage-result" as const,
                  reference: waitingArtifact.reference,
                },
              }),
        }),
      ];
      rows.push(
        IdentificationGraphResultRowV1Schema.parse({
          ...rowBase({
            run,
            artifactRef: artifactRefFrom(refs, runStateArtifactId),
            runVersionId,
            resultKind: "run-state",
            idempotencySuffix: `${suffix}:run-state:${runVersionId}`,
            auditEntryId: `${actionId}:audit`,
            recordedAt: occurredAt,
            validAt: run.validAt,
          }),
          resultKind: "run-state",
        }),
      );
      return rows;
    },
  });
  const agentTaskRefs =
    waiting.kind === "retrieval-review-agent"
      ? state.agentTaskRefs.some((ref) =>
          sameVersionReference(ref.reference, waiting.agentTaskRef.reference),
        )
        ? state.agentTaskRefs
        : [...state.agentTaskRefs, waiting.agentTaskRef]
      : state.agentTaskRefs;
  return parseIdentificationGraphState(
    { ...state, stage, status: "waiting", waitingRef, agentTaskRefs },
    occurredAt,
  );
};

/** 冻结策略集：只按输入快照的精确引用回读，不用调用方当前视图替换（design D-03）。 */
export const readFrozenPolicyForRun = async (input: {
  readonly ports: IdentificationGraphPortsV1;
  readonly run: IdentificationGraphRunContextV1;
  readonly state: IdentificationGraphStateV1;
  readonly stage: IdentificationStageV1;
}): Promise<IdentificationGraphPolicySetV1> => {
  const { ports, run, state, stage } = input;
  const occurredAt = ports.now().toISOString();
  const inputSnapshotRef = state.inputSnapshotRef;
  if (inputSnapshotRef === undefined) {
    fail(contractInvalid({ stage, detailCode: "input-snapshot-missing", occurredAt }));
  }
  const snapshot = await ports.bodies.readInputSnapshotBody({
    projectId: run.projectId,
    inputSnapshotRef,
    actorId: run.actorId,
    requestedAt: run.issuedAt,
    authorization: run.authorization,
  });
  if (snapshot === undefined) {
    fail(contractInvalid({ stage, detailCode: "input-snapshot-body-missing", occurredAt }));
  }
  const policySet = await ports.policyProvider.resolveExact({
    projectId: run.projectId,
    preparationSnapshotRef: snapshot.preparationSnapshotRef,
    requiredAt: run.validAt,
    asOfRecordedAt: run.issuedAt,
    authorization: run.authorization,
  });
  if (policySet === undefined) {
    fail(
      graphError({
        code: "POLICY_NOT_READY",
        stage,
        detailCode: "policy-set-not-ready",
        occurredAt,
      }),
    );
  }
  return IdentificationGraphPolicySetV1Schema.parse(policySet);
};

/** C21 审阅策略正文的精确引用：用于派生稳定 Agent 任务身份，不内建默认值。 */
interface RetrievalReviewAgentRefsV1 {
  readonly policyRef: VersionReference;
  readonly modelDeploymentRef: VersionReference;
  readonly promptTemplateRef: VersionReference;
  readonly toolPolicyRef: VersionReference;
  readonly budgetPolicyRef: VersionReference;
  readonly incrementSchemaRef: VersionReference;
  readonly validationPolicyRef: VersionReference;
}

const resolveReviewAgentRefs = async (input: {
  readonly ports: IdentificationGraphPortsV1;
}): Promise<RetrievalReviewAgentRefsV1> => {
  const policy = await input.ports.reviewPolicy();
  const policyRef = versionReferenceOf(readProperty(policy, "policyRef"));
  const modelDeploymentRef = versionReferenceOf(readProperty(policy, "modelDeploymentRef"));
  const promptTemplateRef = versionReferenceOf(readProperty(policy, "promptTemplateRef"));
  const toolPolicyRef = versionReferenceOf(readProperty(policy, "toolPolicyRef"));
  const budgetPolicyRef = versionReferenceOf(readProperty(policy, "budgetPolicyRef"));
  const incrementSchemaRef = versionReferenceOf(readProperty(policy, "incrementSchemaRef"));
  const validationPolicyRef = versionReferenceOf(readProperty(policy, "validationPolicyRef"));
  if (
    policyRef === undefined ||
    modelDeploymentRef === undefined ||
    promptTemplateRef === undefined ||
    toolPolicyRef === undefined ||
    budgetPolicyRef === undefined ||
    incrementSchemaRef === undefined ||
    validationPolicyRef === undefined
  ) {
    fail(
      graphError({
        code: "POLICY_NOT_READY",
        stage: "I3",
        detailCode: "retrieval-review-policy-not-ready",
        occurredAt: input.ports.now().toISOString(),
      }),
    );
  }
  return {
    policyRef,
    modelDeploymentRef,
    promptTemplateRef,
    toolPolicyRef,
    budgetPolicyRef,
    incrementSchemaRef,
    validationPolicyRef,
  };
};

/**
 * 检索审阅 Agent 任务身份：由工程、工作项与冻结审阅策略确定性派生（design D-03）。
 * 等待、恢复与技术重试都沿用同一身份，不新建替代任务。
 */
export const retrievalReviewTaskRefFor = (input: {
  readonly projectId: string;
  readonly workItemRef: IdentificationWorkItemRefV1;
  readonly refs: RetrievalReviewAgentRefsV1;
}): AgentTaskRefV1 => ({
  kind: "agent-task",
  reference: {
    entityId: `retrieval-review-task:${input.projectId}:${input.workItemRef.reference.entityId}`,
    versionId: sha256CanonicalJson({
      workItemRef: input.workItemRef,
      reviewPolicyRef: input.refs.policyRef,
    }),
  },
  taskType: "retrieval-review",
  triggerMode: "embedded",
  modelDeploymentRef: input.refs.modelDeploymentRef,
  promptTemplateRef: input.refs.promptTemplateRef,
  toolPolicyRef: input.refs.toolPolicyRef,
  budgetPolicyRef: input.refs.budgetPolicyRef,
  incrementSchemaRef: input.refs.incrementSchemaRef,
  validationPolicyRef: input.refs.validationPolicyRef,
});

/** 工序事实：适用性由冻结工序模型的节点与冻结机理发布共同判定，查询依据确定性派生。 */
export const processNodeFactsOf = (input: {
  readonly nodeIds: readonly string[];
  readonly mechanismNodeIds: ReadonlySet<string>;
}): readonly IdentificationGraphProcessNodeFactV1[] =>
  input.nodeIds.map((nodeId) => ({
    nodeId,
    applicable: input.mechanismNodeIds.has(nodeId),
    frozenQueryText: `identification-process-node-query:${nodeId}`,
  }));

const auditTrailRefFor = (run: IdentificationGraphRunContextV1) => ({
  kind: "audit-trail" as const,
  reference: {
    entityId: `${run.commandId}:identification-graph`,
    versionId: sha256CanonicalJson({
      runId: run.runRef.reference.entityId,
      scope: "identification",
    }),
  },
});

interface HandlerInputV1 {
  readonly ports: IdentificationGraphPortsV1;
  readonly run: IdentificationGraphRunContextV1;
  readonly state: IdentificationGraphStateV1;
}

type StageHandlerV1 = (input: HandlerInputV1) => Promise<IdentificationGraphStateV1>;

/** I0：校验父运行、准备引用与触发上下文，登记准备结果并推进到 I1。 */
const stageI0: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  const mismatch =
    run.parentRiskFlowRunRef.reference.entityId === run.runRef.reference.entityId ||
    run.triggerReasonCode.trim().length === 0 ||
    !sameVersionReference(run.graphVersion, state.graphVersion) ||
    !sameVersionReference(
      run.preparationSnapshotRef.reference,
      state.preparationSnapshotRef.reference,
    );
  if (mismatch) {
    fail(contractInvalid({ stage: "I0", detailCode: "trigger-context-mismatch", occurredAt }));
  }
  const cursor = await readCursor({ ports, run });
  const stageResult = IdentificationStageResultV1Schema.parse({
    schemaVersion: "1",
    runRef: run.runRef,
    recordedAt: occurredAt,
    stage: "I0",
    preparationSnapshotRef: run.preparationSnapshotRef,
  });
  return await advance({
    ports,
    run,
    state,
    stage: "I0",
    actionSuffix: "I0",
    nextStage: "I1",
    cursor,
    stageResult,
    stageResultRow: false,
    commandKind: "identification-graph.i0",
  });
};

/** I1：解析 C17 识别基础与策略组合，冻结单一输入快照；缺项按类型化等待收口。 */
const stageI1: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  const cursor = await readCursor({ ports, run });
  const policySet = await ports.policyProvider.resolveExact({
    projectId: run.projectId,
    preparationSnapshotRef: run.preparationSnapshotRef,
    requiredAt: run.validAt,
    asOfRecordedAt: run.issuedAt,
    authorization: run.authorization,
  });
  if (policySet === undefined) {
    return await waitFor({
      ports,
      run,
      state,
      stage: "I1",
      cursor,
      suffix: "I1",
      waiting: {
        kind: "knowledge-preparation",
        preparationSnapshotRef: run.preparationSnapshotRef,
        reasonCode: "policy-set-not-ready",
      },
      stageResult: IdentificationStageResultV1Schema.parse({
        schemaVersion: "1",
        runRef: run.runRef,
        recordedAt: occurredAt,
        stage: "I1",
        resultKind: "waiting",
        waitingRef: toWaitingRef({
          waiting: {
            kind: "knowledge-preparation",
            preparationSnapshotRef: run.preparationSnapshotRef,
            reasonCode: "policy-set-not-ready",
          },
        }),
      }),
    });
  }
  const basis = await ports.basisResolver.resolve({
    kind: "identification-basis",
    commandId: actionIdFor(run, "I1:basis"),
    idempotencyKey: actionIdFor(run, "I1:basis"),
    projectId: run.projectId,
    actorId: run.actorId,
    issuedAt: run.issuedAt,
    authorization: run.authorization,
    payload: { preparationSnapshotRef: run.preparationSnapshotRef, requiredAt: run.validAt },
  });
  if (basis.kind === "waiting") {
    return await waitFor({
      ports,
      run,
      state,
      stage: "I1",
      cursor,
      suffix: "I1",
      waiting: {
        kind: "knowledge-preparation",
        preparationSnapshotRef: run.preparationSnapshotRef,
        reasonCode: basis.waiting.kind,
      },
      stageResult: IdentificationStageResultV1Schema.parse({
        schemaVersion: "1",
        runRef: run.runRef,
        recordedAt: occurredAt,
        stage: "I1",
        resultKind: "waiting",
        waitingRef: toWaitingRef({
          waiting: {
            kind: "knowledge-preparation",
            preparationSnapshotRef: run.preparationSnapshotRef,
            reasonCode: basis.waiting.kind,
          },
        }),
      }),
    });
  }
  if (basis.kind === "failed") {
    fail(
      toIdentificationGraphError({
        stage: "I1",
        error: basis.error,
        occurredAt,
      }),
    );
  }
  const resolved = basis.result;
  if (resolved.kind !== "identification-basis") {
    fail(contractInvalid({ stage: "I1", detailCode: "basis-kind-mismatch", occurredAt }));
  }
  const resolvedPolicySet = await ports.policyProvider.resolveExact({
    projectId: run.projectId,
    preparationSnapshotRef: run.preparationSnapshotRef,
    requiredAt: run.validAt,
    asOfRecordedAt: run.issuedAt,
    authorization: run.authorization,
  });
  if (
    resolvedPolicySet === undefined ||
    !sameVersionReference(
      resolvedPolicySet.policySetRef.reference,
      resolved.identificationPolicySetRef.reference,
    )
  ) {
    fail(
      graphError({
        code: "POLICY_NOT_READY",
        stage: "I1",
        detailCode: "policy-set-reference-mismatch",
        occurredAt,
      }),
    );
  }
  const policySet2 = IdentificationGraphPolicySetV1Schema.parse(resolvedPolicySet);
  const inputSnapshotRef = identificationInputSnapshotRefFor({
    projectId: run.projectId,
    preparationSnapshotRef: run.preparationSnapshotRef,
    policySetRef: policySet2.policySetRef,
    processModelReleaseRef: resolved.processModelReleaseRef.reference,
    retrievalEvidenceBaseReleaseRef: resolved.retrievalEvidenceBaseReleaseRef.reference,
  });
  const inputSnapshot = resolveIdentificationInputSnapshot({
    preparationSnapshotRef: run.preparationSnapshotRef,
    policySet: policySet2,
    processModelReleaseRef: resolved.processModelReleaseRef.reference,
    riskMechanismReleaseRef: resolved.riskMechanismReleaseRef.reference,
    retrievalEvidenceBaseReleaseRef: resolved.retrievalEvidenceBaseReleaseRef.reference,
    authorizationContextRef: run.authorization.authorizationContextRef,
    auditTrailRef: auditTrailRefFor(run),
    createdBy: run.actorId,
    createdAt: run.issuedAt,
  });
  const stageResult = IdentificationStageResultV1Schema.parse({
    schemaVersion: "1",
    runRef: run.runRef,
    recordedAt: occurredAt,
    stage: "I1",
    resultKind: "ready",
    inputSnapshotRef,
  });
  const inputSnapshotArtifactId = artifactIdFor(
    "input-snapshot",
    run.runRef.reference.entityId,
    "I1",
  );
  return await advance({
    ports,
    run,
    state,
    stage: "I1",
    actionSuffix: "I1",
    nextStage: "I2",
    cursor,
    stageResult,
    stageResultRow: false,
    commandKind: "identification-graph.i1",
    statePatch: { inputSnapshotRef },
    extraBodies: [
      {
        artifactId: inputSnapshotArtifactId,
        build: () => ({ bodyKind: "input-snapshot", inputSnapshot }),
      },
    ],
    extraRows: ({ artifactRefs, auditEntryId }) => [
      IdentificationGraphResultRowV1Schema.parse({
        ...rowBase({
          run,
          artifactRef: artifactRefFrom(artifactRefs, inputSnapshotArtifactId),
          runVersionId: sha256CanonicalJson({ runId: run.runRef.reference.entityId, stage: "I1" }),
          resultKind: "input-snapshot",
          idempotencySuffix: "I1:input-snapshot",
          auditEntryId,
          recordedAt: occurredAt,
          validAt: run.validAt,
        }),
        resultId: inputSnapshotRef.reference.entityId,
        resultVersionId: inputSnapshotRef.reference.versionId,
        resultKind: "input-snapshot",
        parentRunRef: run.parentRiskFlowRunRef,
        preparationSnapshotRef: run.preparationSnapshotRef,
        inputSnapshotRef,
      }),
    ],
  });
};

/** I2：从精确工序模型与资料范围生成一次不可变工作计划；缺项整体阻断。 */
const stageI2: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  const cursor = await readCursor({ ports, run });
  const inputSnapshotRef = state.inputSnapshotRef;
  if (inputSnapshotRef === undefined) {
    fail(contractInvalid({ stage: "I2", detailCode: "input-snapshot-missing", occurredAt }));
  }
  const inputSnapshot = await ports.bodies.readInputSnapshotBody({
    projectId: run.projectId,
    inputSnapshotRef,
    actorId: run.actorId,
    requestedAt: run.issuedAt,
    authorization: run.authorization,
  });
  if (inputSnapshot === undefined) {
    fail(contractInvalid({ stage: "I2", detailCode: "input-snapshot-body-missing", occurredAt }));
  }
  const preparation = await ports.preparationReader.readExactPreparation({
    projectId: run.projectId,
    preparationSnapshotRef: run.preparationSnapshotRef,
    actorId: run.actorId,
    requestId: actionIdFor(run, "I2:preparation"),
    requestedAt: run.issuedAt,
  });
  if (preparation.kind === "error") {
    fail(toIdentificationGraphError({ stage: "I2", error: preparation.error, occurredAt }));
  }
  const processModel = await ports.knowledgeReleaseReader.readExact({
    projectId: run.projectId,
    releaseRef: {
      kind: "knowledge-release",
      reference: inputSnapshot.processModelReleaseRef.reference,
    },
    actorId: run.actorId,
    requestedAt: run.issuedAt,
    authorization: run.authorization,
  });
  if (processModel.kind === "failed") {
    fail(toIdentificationGraphError({ stage: "I2", error: processModel.error, occurredAt }));
  }
  const mechanism = await ports.knowledgeReleaseReader.readExact({
    projectId: run.projectId,
    releaseRef: {
      kind: "knowledge-release",
      reference: inputSnapshot.riskMechanismReleaseRef.reference,
    },
    actorId: run.actorId,
    requestedAt: run.issuedAt,
    authorization: run.authorization,
  });
  if (mechanism.kind === "failed") {
    fail(toIdentificationGraphError({ stage: "I2", error: mechanism.error, occurredAt }));
  }
  // 知识包按 `definitionType` 判别联合收窄：发布引用与包内定义类型必须精确一致。
  const knowledgePackages = [
    IdentificationKnowledgePackageV1Schema.safeParse(processModel.read.package),
    IdentificationKnowledgePackageV1Schema.safeParse(mechanism.read.package),
  ];
  const [processModelPackage, mechanismPackage] = knowledgePackages;
  if (
    processModelPackage === undefined ||
    mechanismPackage === undefined ||
    processModelPackage.success === false ||
    mechanismPackage.success === false
  ) {
    fail(contractInvalid({ stage: "I2", detailCode: "knowledge-package-invalid", occurredAt }));
  }
  const processModelDefinition = processModelPackage.data;
  const mechanismDefinition = mechanismPackage.data;
  if (
    processModelDefinition.definitionType !== "process-model" ||
    mechanismDefinition.definitionType !== "risk-mechanism"
  ) {
    fail(
      contractInvalid({ stage: "I2", detailCode: "knowledge-package-kind-mismatch", occurredAt }),
    );
  }
  const mechanismNodeIds = new Set<string>(
    mechanismDefinition.mechanisms.flatMap((entry) => [...entry.nodeIds]),
  );
  const workPlanRef = identificationWorkPlanRefFor({
    projectId: run.projectId,
    inputSnapshotRef,
  });
  const plan = buildIdentificationWorkPlan({
    projectId: run.projectId,
    workPlanRef,
    inputSnapshotRef,
    inputSnapshot,
    preparationSnapshot: preparation.snapshot,
    applicableProcessNodes: processNodeFactsOf({
      nodeIds: processModelDefinition.nodes.map((node) => node.nodeId),
      mechanismNodeIds,
    }),
  });
  if (plan.kind === "invalid") {
    fail(
      graphError({
        code: "WORK_PLAN_INVALID",
        stage: "I2",
        detailCode: plan.reasonCode,
        occurredAt,
      }),
    );
  }
  const stageResult = IdentificationStageResultV1Schema.parse({
    schemaVersion: "1",
    runRef: run.runRef,
    recordedAt: occurredAt,
    stage: "I2",
    workPlanRef,
    plannedWorkItemCount: plan.body.workItems.length,
    excludedWorkItemCount: plan.body.excludedWorkItems.length,
  });
  const workPlanArtifactId = artifactIdFor("work-plan", run.runRef.reference.entityId, "I2");
  return await advance({
    ports,
    run,
    state,
    stage: "I2",
    actionSuffix: "I2",
    nextStage: "I3",
    cursor,
    stageResult,
    stageResultRow: true,
    commandKind: "identification-graph.i2",
    statePatch: { workPlanRef },
    cursorPatch: {
      pendingWorkItemRefs: plan.body.workItems.map((item) => item.workItemRef),
    },
    extraBodies: [
      {
        artifactId: workPlanArtifactId,
        build: () => ({ bodyKind: "work-plan", workPlan: plan.body }),
      },
    ],
    extraRows: ({ artifactRefs, runVersionId, auditEntryId }) => [
      IdentificationGraphResultRowV1Schema.parse({
        ...rowBase({
          run,
          artifactRef: artifactRefFrom(artifactRefs, workPlanArtifactId),
          runVersionId,
          resultKind: "work-plan",
          idempotencySuffix: "I2:work-plan",
          auditEntryId,
          recordedAt: occurredAt,
          validAt: run.validAt,
        }),
        resultId: workPlanRef.reference.entityId,
        resultVersionId: workPlanRef.reference.versionId,
        resultKind: "work-plan",
        parentRunRef: run.parentRiskFlowRunRef,
        inputSnapshotRef,
        workPlanRef,
      }),
    ],
  });
};

const retrievalArtifactSetOfTask = async (input: {
  readonly ports: IdentificationGraphPortsV1;
  readonly run: IdentificationGraphRunContextV1;
  readonly stage: IdentificationStageV1;
  readonly taskRef: AgentTaskRefV1;
}): Promise<{
  readonly status: string;
  readonly retrievalArtifactSetRef:
    { readonly kind: "retrieval-artifact-set"; readonly reference: VersionReference } | undefined;
}> => {
  const snapshot = await input.ports.agentTaskReader.getTask(input.taskRef);
  if (snapshot === undefined) return { status: "unknown", retrievalArtifactSetRef: undefined };
  const status = snapshot.state.status;
  const result = snapshot.state.resultRef;
  if (result === undefined || result.status !== "completed") {
    return { status, retrievalArtifactSetRef: undefined };
  }
  const increment = readProperty(result, "incrementRef");
  const reference = versionReferenceOf(readProperty(increment, "reference"));
  const kind = readProperty(increment, "kind");
  if (reference === undefined || kind !== "retrieval-artifact-set") {
    return { status, retrievalArtifactSetRef: undefined };
  }
  return { status, retrievalArtifactSetRef: { kind: "retrieval-artifact-set", reference } };
};

/** I3：逐工作项完成必经检索审阅与五项上下文；任务未终结时登记等待并暂停。 */
const stageI3: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  const cursor = await readCursor({ ports, run });
  if (cursor === undefined) {
    fail(contractInvalid({ stage: "I3", detailCode: "cursor-missing", occurredAt }));
  }
  const workItemRef = cursor.pendingWorkItemRefs[0];
  if (workItemRef === undefined) {
    fail(contractInvalid({ stage: "I3", detailCode: "work-item-cursor-missing", occurredAt }));
  }
  const inputSnapshotRef = state.inputSnapshotRef;
  if (inputSnapshotRef === undefined) {
    fail(contractInvalid({ stage: "I3", detailCode: "input-snapshot-missing", occurredAt }));
  }
  const refs = await resolveReviewAgentRefs({ ports });
  const taskRef = retrievalReviewTaskRefFor({ projectId: run.projectId, workItemRef, refs });
  const prepared = await ports.contextService.prepareReview({
    projectId: run.projectId,
    actorId: run.actorId,
    requestedAt: run.issuedAt,
    taskRef,
    inputSnapshotRef,
    workItemRef,
    authorization: run.authorization,
  });
  const started = await ports.agentTasks.startTask({
    kind: "start-task",
    commandId: actionIdFor(run, `I3:task:${workItemRef.reference.entityId}`),
    idempotencyKey: actionIdFor(run, `I3:task:${workItemRef.reference.entityId}`),
    projectId: run.projectId,
    actorId: run.actorId,
    issuedAt: run.issuedAt,
    authorization: run.authorization,
    payload: {
      taskType: "retrieval-review",
      triggerMode: "embedded",
      parentRunRef: run.runRef,
      frozenInputRef: prepared.candidateSetRef,
      modelDeploymentRef: refs.modelDeploymentRef,
      promptTemplateRef: refs.promptTemplateRef,
      toolPolicyRef: refs.toolPolicyRef,
      budgetPolicyRef: refs.budgetPolicyRef,
      incrementSchemaRef: refs.incrementSchemaRef,
      validationPolicyRef: refs.validationPolicyRef,
    },
  });
  if (started.kind === "failed") {
    fail(toIdentificationGraphError({ stage: "I3", error: started.error, occurredAt }));
  }
  const task = await retrievalArtifactSetOfTask({ ports, run, stage: "I3", taskRef });
  if (
    task.status === "unknown" ||
    task.status === "pending" ||
    task.status === "running" ||
    task.status === "waiting-user-confirmation" ||
    task.status === "retryable-failure"
  ) {
    return await waitFor({
      ports,
      run,
      state,
      stage: "I3",
      cursor,
      suffix: `I3:${workItemRef.reference.entityId}`,
      waiting: { kind: "retrieval-review-agent", agentTaskRef: taskRef, workItemRef, stage: "I3" },
      stageResult: IdentificationStageResultV1Schema.parse({
        schemaVersion: "1",
        runRef: run.runRef,
        recordedAt: occurredAt,
        stage: "I3",
        retrievalArtifactSetRefs: [],
        agentTaskRefs: [taskRef],
        failedWorkItemRefs: cursor?.failedWorkItemRefs ?? [],
      }),
    });
  }
  if (task.status === "terminal-failure" || task.status === "cancelled") {
    return await advance({
      ports,
      run,
      state,
      stage: "I3",
      actionSuffix: `I3:${workItemRef.reference.entityId}`,
      nextStage: cursor.pendingWorkItemRefs.length > 1 ? "I3" : "I6",
      cursor,
      stageResultRow: true,
      commandKind: "identification-graph.i3",
      stageResult: IdentificationStageResultV1Schema.parse({
        schemaVersion: "1",
        runRef: run.runRef,
        recordedAt: occurredAt,
        stage: "I3",
        retrievalArtifactSetRefs: [],
        agentTaskRefs: [taskRef],
        failedWorkItemRefs: [...cursor.failedWorkItemRefs, workItemRef],
      }),
      cursorPatch: {
        pendingWorkItemRefs: cursor.pendingWorkItemRefs.slice(1),
        failedWorkItemRefs: [...cursor.failedWorkItemRefs, workItemRef],
      },
      statePatch: {
        agentTaskRefs: [...state.agentTaskRefs, taskRef],
        failedWorkItemRefs: [...state.failedWorkItemRefs, workItemRef],
      },
    });
  }
  const retrievalArtifactSetRef = task.retrievalArtifactSetRef;
  if (retrievalArtifactSetRef === undefined) {
    fail(contractInvalid({ stage: "I3", detailCode: "retrieval-increment-missing", occurredAt }));
  }
  await ports.contextService.assembleContext({
    projectId: run.projectId,
    actorId: run.actorId,
    reviewTaskRef: taskRef,
    inputSnapshotRef,
    workItemRef,
    authorization: run.authorization,
  });
  return await advance({
    ports,
    run,
    state,
    stage: "I3",
    actionSuffix: `I3:${workItemRef.reference.entityId}`,
    nextStage: "I4",
    cursor,
    stageResultRow: true,
    commandKind: "identification-graph.i3",
    stageResult: IdentificationStageResultV1Schema.parse({
      schemaVersion: "1",
      runRef: run.runRef,
      recordedAt: occurredAt,
      stage: "I3",
      retrievalArtifactSetRefs: [retrievalArtifactSetRef],
      agentTaskRefs: [taskRef],
      failedWorkItemRefs: cursor.failedWorkItemRefs,
    }),
    statePatch: { agentTaskRefs: [...state.agentTaskRefs, taskRef] },
  });
};

/** I4：只对具有正式五项上下文的工作项生成候选（RI-S57 专用推理入口）。 */
const stageI4: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  const cursor = await readCursor({ ports, run });
  if (cursor === undefined) {
    fail(contractInvalid({ stage: "I4", detailCode: "cursor-missing", occurredAt }));
  }
  const workItemRef = cursor.pendingWorkItemRefs[0];
  const taskRef = state.agentTaskRefs[state.agentTaskRefs.length - 1];
  if (workItemRef === undefined || taskRef === undefined) {
    fail(contractInvalid({ stage: "I4", detailCode: "work-item-cursor-missing", occurredAt }));
  }
  const policySet = await readFrozenPolicyForRun({ ports, run, state, stage: "I4" });
  const task = await retrievalArtifactSetOfTask({ ports, run, stage: "I4", taskRef });
  const retrievalArtifactSetRef = task.retrievalArtifactSetRef;
  if (retrievalArtifactSetRef === undefined) {
    fail(contractInvalid({ stage: "I4", detailCode: "retrieval-increment-missing", occurredAt }));
  }
  const analyzed = await ports.finalizationService.analyze({
    kind: "assemble-and-infer",
    commandId: actionIdFor(run, `I4:${workItemRef.reference.entityId}`),
    idempotencyKey: actionIdFor(run, `I4:${workItemRef.reference.entityId}`),
    projectId: run.projectId,
    actorId: run.actorId,
    issuedAt: run.issuedAt,
    authorization: run.authorization,
    payload: {
      workItemRef,
      retrievalArtifactSetRef,
      modelDeploymentRef: policySet.modelDeploymentRef,
      promptTemplateRef: policySet.promptTemplateRef,
    },
  });
  if (analyzed.kind === "waiting") {
    // 上游知识装配等待：登记等待事实后暂停原线程，恢复时按同一动作身份重放本阶段。
    return await waitFor({
      ports,
      run,
      state,
      stage: "I4",
      cursor,
      suffix: `I4:${workItemRef.reference.entityId}`,
      waiting: {
        kind: "retrieval-review-agent",
        agentTaskRef:
          state.agentTaskRefs[0] ??
          fail(contractInvalid({ stage: "I4", detailCode: "agent-task-missing", occurredAt })),
        workItemRef,
        stage: "I4",
      },
      waitingRef: analyzed.waiting,
    });
  }
  if (analyzed.kind !== "succeeded") {
    const upstream = readProperty(analyzed, "error");
    if (upstream === undefined) {
      // 上游以等待收口：C24 无法映射为自身等待事实时按稳定等待错误封闭，不伪装为完成。
      fail(
        graphError({
          code: "UPSTREAM_WAITING",
          stage: "I4",
          detailCode: "upstream-waiting",
          occurredAt,
        }),
      );
    }
    fail(toIdentificationGraphError({ stage: "I4", error: upstream, occurredAt }));
  }
  const analyzedResult = analyzed.result;
  if (analyzedResult.kind !== "assemble-and-infer") {
    fail(contractInvalid({ stage: "I4", detailCode: "analysis-result-kind-mismatch", occurredAt }));
  }
  return await advance({
    ports,
    run,
    state,
    stage: "I4",
    actionSuffix: `I4:${workItemRef.reference.entityId}`,
    nextStage: "I5",
    cursor,
    stageResultRow: true,
    commandKind: "identification-graph.i4",
    stageResult: IdentificationStageResultV1Schema.parse({
      schemaVersion: "1",
      runRef: run.runRef,
      recordedAt: occurredAt,
      stage: "I4",
      modelContextArtifactSetRefs: [analyzedResult.modelContextArtifactSetRef],
      candidateSetRef: analyzedResult.candidateSetRef,
    }),
    statePatch: { candidateSetRef: analyzedResult.candidateSetRef },
  });
};

/** I5：共享确定性校验与有界修正闭环；不可修正失败只封闭该项，不伪装人工复核。 */
const stageI5: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  const cursor = await readCursor({ ports, run });
  if (cursor === undefined) {
    fail(contractInvalid({ stage: "I5", detailCode: "cursor-missing", occurredAt }));
  }
  const workItemRef = cursor.pendingWorkItemRefs[0];
  const candidateSetRef = state.candidateSetRef;
  if (workItemRef === undefined || candidateSetRef === undefined) {
    fail(contractInvalid({ stage: "I5", detailCode: "candidate-set-missing", occurredAt }));
  }
  const policySet = await readFrozenPolicyForRun({ ports, run, state, stage: "I5" });
  const validated = await ports.finalizationService.analyze({
    kind: "repair-and-validate",
    commandId: actionIdFor(run, `I5:${workItemRef.reference.entityId}`),
    idempotencyKey: actionIdFor(run, `I5:${workItemRef.reference.entityId}`),
    projectId: run.projectId,
    actorId: run.actorId,
    issuedAt: run.issuedAt,
    authorization: run.authorization,
    payload: {
      candidateSetRef,
      repairPolicyRef: policySet.repairPolicyRef,
      ruleValidationPolicyRef: policySet.ruleValidationPolicyRef,
      ...(policySet.simulationConstraintPolicyRef === undefined
        ? {}
        : { simulationConstraintPolicyRef: policySet.simulationConstraintPolicyRef }),
    },
  });
  const remaining = cursor.pendingWorkItemRefs.slice(1);
  const nextStage: IdentificationStageV1 = remaining.length > 0 ? "I3" : "I6";
  if (validated.kind === "failed") {
    const error = toIdentificationGraphError({ stage: "I5", error: validated.error, occurredAt });
    return await advance({
      ports,
      run,
      state,
      stage: "I5",
      actionSuffix: `I5:${workItemRef.reference.entityId}`,
      nextStage,
      cursor,
      stageResultRow: true,
      commandKind: "identification-graph.i5",
      stageResult: IdentificationStageResultV1Schema.parse({
        schemaVersion: "1",
        runRef: run.runRef,
        recordedAt: occurredAt,
        stage: "I5",
        validatedCandidateSetRef: {
          kind: "validated-candidate-set",
          reference: {
            entityId: `identification-invalidated-candidate-set:${run.projectId}:${workItemRef.reference.entityId}`,
            versionId: sha256CanonicalJson(error),
          },
        },
        failedCandidateSetRef: candidateSetRef,
        reviewTaskRefs: [],
      }),
      cursorPatch: {
        pendingWorkItemRefs: remaining,
        failedWorkItemRefs: [...cursor.failedWorkItemRefs, workItemRef],
      },
      statePatch: {
        failedWorkItemRefs: [...state.failedWorkItemRefs, workItemRef],
      },
    });
  }
  if (validated.kind === "waiting") {
    return await waitFor({
      ports,
      run,
      state,
      stage: "I5",
      cursor,
      suffix: `I5:${workItemRef.reference.entityId}`,
      waiting: {
        kind: "retrieval-review-agent",
        agentTaskRef:
          state.agentTaskRefs[0] ??
          fail(contractInvalid({ stage: "I5", detailCode: "agent-task-missing", occurredAt })),
        workItemRef,
        stage: "I5",
      },
      waitingRef: validated.waiting,
    });
  }
  if (validated.kind !== "succeeded") {
    const upstream = readProperty(validated, "error");
    if (upstream === undefined) {
      // 上游以等待收口：C24 无法映射为自身等待事实时按稳定等待错误封闭，不伪装为完成。
      fail(
        graphError({
          code: "UPSTREAM_WAITING",
          stage: "I5",
          detailCode: "upstream-waiting",
          occurredAt,
        }),
      );
    }
    fail(toIdentificationGraphError({ stage: "I5", error: upstream, occurredAt }));
  }
  const validatedResult = validated.result;
  if (validatedResult.kind !== "repair-and-validate") {
    fail(contractInvalid({ stage: "I5", detailCode: "analysis-result-kind-mismatch", occurredAt }));
  }
  const validatedCandidateSetRef = validatedResult.validatedCandidateSetRef;
  return await advance({
    ports,
    run,
    state,
    stage: "I5",
    actionSuffix: `I5:${workItemRef.reference.entityId}`,
    nextStage,
    cursor,
    stageResultRow: true,
    commandKind: "identification-graph.i5",
    stageResult: IdentificationStageResultV1Schema.parse({
      schemaVersion: "1",
      runRef: run.runRef,
      recordedAt: occurredAt,
      stage: "I5",
      validatedCandidateSetRef,
      reviewTaskRefs: [],
    }),
    cursorPatch: {
      pendingWorkItemRefs: remaining,
      completedWorkItemRefs: [...cursor.completedWorkItemRefs, workItemRef],
      validatedCandidateSetRefs: [...cursor.validatedCandidateSetRefs, validatedCandidateSetRef],
    },
  });
};

/** I6：全部可处理工作项达到 I5 终态后只调用一次全运行合并。 */
const stageI6: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  const cursor = await readCursor({ ports, run });
  if (cursor === undefined) {
    fail(contractInvalid({ stage: "I6", detailCode: "cursor-missing", occurredAt }));
  }
  if (cursor.validatedCandidateSetRefs.length === 0) {
    // 无合格候选：不调用 C22、不生成空成功记录，直接进入 I9 汇总（spec「不以空工作项继续」）。
    return await advance({
      ports,
      run,
      state,
      stage: "I6",
      actionSuffix: "I6",
      nextStage: "I9",
      cursor,
      stageResultRow: false,
      commandKind: "identification-graph.i6",
    });
  }
  const workPlanRef = state.workPlanRef;
  if (workPlanRef === undefined) {
    fail(contractInvalid({ stage: "I6", detailCode: "work-plan-missing", occurredAt }));
  }
  const policySet = await readFrozenPolicyForRun({ ports, run, state, stage: "I6" });
  const merged = await ports.finalizationService.finalize({
    kind: "merge-run-candidates",
    commandId: actionIdFor(run, "I6:merge"),
    idempotencyKey: actionIdFor(run, "I6:merge"),
    projectId: run.projectId,
    actorId: run.actorId,
    issuedAt: run.issuedAt,
    authorization: run.authorization,
    payload: {
      workPlanRef,
      validatedCandidateSetRefs: cursor.validatedCandidateSetRefs,
      mergePolicyRef: policySet.mergePolicyRef,
    },
  });
  if (merged.kind !== "succeeded") {
    const upstream = readProperty(merged, "error");
    if (upstream === undefined) {
      // 上游以等待收口：C24 无法映射为自身等待事实时按稳定等待错误封闭，不伪装为完成。
      fail(
        graphError({
          code: "UPSTREAM_WAITING",
          stage: "I6",
          detailCode: "upstream-waiting",
          occurredAt,
        }),
      );
    }
    fail(toIdentificationGraphError({ stage: "I6", error: upstream, occurredAt }));
  }
  const mergedResult = merged.result;
  if (mergedResult.kind !== "merge") {
    fail(contractInvalid({ stage: "I6", detailCode: "merge-result-kind-mismatch", occurredAt }));
  }
  return await advance({
    ports,
    run,
    state,
    stage: "I6",
    actionSuffix: "I6",
    nextStage: "I7",
    cursor,
    stageResultRow: true,
    commandKind: "identification-graph.i6",
    stageResult: IdentificationStageResultV1Schema.parse({
      schemaVersion: "1",
      runRef: run.runRef,
      recordedAt: occurredAt,
      stage: "I6",
      mergePlanRef: mergedResult.mergePlanRef,
      skippedMergeGroupRefs: [],
    }),
    statePatch: { mergePlanRef: mergedResult.mergePlanRef },
  });
};

/** I7：按冻结置信度与强制复核策略为每个分组形成唯一验收路线。 */
const stageI7: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  const cursor = await readCursor({ ports, run });
  const mergePlanRef = state.mergePlanRef;
  if (cursor === undefined || mergePlanRef === undefined) {
    fail(contractInvalid({ stage: "I7", detailCode: "merge-plan-missing", occurredAt }));
  }
  const policySet = await readFrozenPolicyForRun({ ports, run, state, stage: "I7" });
  const routed = await ports.finalizationService.finalize({
    kind: "route-acceptance",
    commandId: actionIdFor(run, "I7:route"),
    idempotencyKey: actionIdFor(run, "I7:route"),
    projectId: run.projectId,
    actorId: run.actorId,
    issuedAt: run.issuedAt,
    authorization: run.authorization,
    payload: {
      mergePlanRef,
      confidencePolicyRef: policySet.confidencePolicyRef,
      forcedReviewPolicyRef: policySet.forcedReviewPolicyRef,
    },
  });
  if (routed.kind !== "succeeded") {
    const upstream = readProperty(routed, "error");
    if (upstream === undefined) {
      // 上游以等待收口：C24 无法映射为自身等待事实时按稳定等待错误封闭，不伪装为完成。
      fail(
        graphError({
          code: "UPSTREAM_WAITING",
          stage: "I7",
          detailCode: "upstream-waiting",
          occurredAt,
        }),
      );
    }
    fail(toIdentificationGraphError({ stage: "I7", error: upstream, occurredAt }));
  }
  const routedResult = routed.result;
  if (routedResult.kind !== "route") {
    fail(contractInvalid({ stage: "I7", detailCode: "route-result-kind-mismatch", occurredAt }));
  }
  return await advance({
    ports,
    run,
    state,
    stage: "I7",
    actionSuffix: "I7",
    nextStage: "I8",
    cursor,
    stageResultRow: true,
    commandKind: "identification-graph.i7",
    stageResult: IdentificationStageResultV1Schema.parse({
      schemaVersion: "1",
      runRef: run.runRef,
      recordedAt: occurredAt,
      stage: "I7",
      acceptanceRouteSetRef: routedResult.acceptanceRouteSetRef,
      reviewTaskRefs: routedResult.reviewTaskRefs,
    }),
    cursorPatch: {
      acceptedRouteSetRef: routedResult.acceptanceRouteSetRef,
      pendingGroupRefs: [],
    },
    statePatch: { reviewTaskRefs: routedResult.reviewTaskRefs },
  });
};

/**
 * 单一路线集验收调用点（design D-08）：C22 `accept-groups` 要求 `acceptedGroupRefs` 与决定集合
 * 同时覆盖该路线集的**全部**分组与全部决定，因此整集只提交一次；决定不成立的组由 C22 在自身
 * 事务内封闭（不写记录、不写事件），C24 只按 `decisionDispositionFor` 的稳定语义登记分组终态。
 * 后续若上游改为逐组语义，只需替换本函数体。
 */
const submitGroupAcceptance = async (input: {
  readonly ports: IdentificationGraphPortsV1;
  readonly run: IdentificationGraphRunContextV1;
  readonly occurredAt: string;
  readonly acceptanceRouteSetRef: {
    readonly kind: "acceptance-route-set";
    readonly reference: VersionReference;
  };
  /** 本轮验收动作身份后缀（由已决决定集派生）。 */
  readonly acceptanceSuffix: string;
  readonly routes: readonly AcceptanceRouteV1[];
  readonly decisionRefs: readonly (RouteDecisionRefV1 | ReviewDecisionRefV1)[];
}): Promise<{
  readonly records: readonly StandardizedRiskRecordRefV1[];
  readonly events: readonly DomainEventRefV1[];
  readonly skippedGroupRefs: readonly IdentificationGroupRefV1[];
}> => {
  const accepted = await input.ports.finalizationService.finalize({
    kind: "accept-groups",
    commandId: actionIdFor(input.run, `${input.acceptanceSuffix}:accept`),
    idempotencyKey: actionIdFor(input.run, `${input.acceptanceSuffix}:accept`),
    projectId: input.run.projectId,
    actorId: input.run.actorId,
    issuedAt: input.run.issuedAt,
    authorization: input.run.authorization,
    payload: {
      acceptanceRouteSetRef: input.acceptanceRouteSetRef,
      acceptedGroupRefs: input.routes.map((route) => route.groupRef),
      decisionRefs: [...input.decisionRefs],
    },
  });
  if (accepted.kind !== "succeeded") {
    const upstream = readProperty(accepted, "error");
    if (upstream === undefined) {
      fail(
        graphError({
          code: "UPSTREAM_WAITING",
          stage: "I8",
          detailCode: "upstream-waiting",
          occurredAt: input.occurredAt,
        }),
      );
    }
    fail(
      toIdentificationGraphError({
        stage: "I8",
        error: upstream,
        occurredAt: input.occurredAt,
      }),
    );
  }
  if (accepted.result.kind === "accepted") {
    return {
      records: accepted.result.standardizedRiskRecordRefs,
      events: accepted.result.assessmentEventRefs,
      skippedGroupRefs: [],
    };
  }
  if (accepted.result.kind === "skipped") {
    return { records: [], events: [], skippedGroupRefs: accepted.result.skippedGroupRefs };
  }
  fail(
    contractInvalid({
      stage: "I8",
      detailCode: "acceptance-result-kind-mismatch",
      occurredAt: input.occurredAt,
    }),
  );
};

/**
 * I8：逐组确立决定，整集一次收口。
 *
 * 自动组直接用匹配系统决定；人工组读精确 `identification-group` 决定：已决的提交决定，仍待复核
 * 的组**不提交决定**，由 C22 本轮按待定跳过（不写记录、不写事件）。整集 routes 与已决决定一次
 * 提交；被封闭的组（拒绝、退回上游、保持分立、修订重路由）与待定组都由 C24 按 route set +
 * 已提交决定自行推导并登记，不依赖 C22 回传 `skippedGroupRefs`。
 *
 * 动作身份按「已决决定集」内容派生：第二轮验收（新决组）得到新身份与新登记行，已入库组在 C22
 * 侧按决定引用幂等重放为 no-op，不产生重复记录、事件或审计。
 */
const stageI8: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  const cursor = await readCursor({ ports, run });
  if (cursor === undefined) {
    fail(contractInvalid({ stage: "I8", detailCode: "cursor-missing", occurredAt }));
  }
  const acceptanceRouteSetRef = cursor.acceptedRouteSetRef;
  if (acceptanceRouteSetRef === undefined) {
    fail(contractInvalid({ stage: "I8", detailCode: "acceptance-route-set-missing", occurredAt }));
  }
  const routes = await ports.acceptanceRoutes.readRoutes({
    projectId: run.projectId,
    acceptanceRouteSetRef,
    actorId: run.actorId,
    requestedAt: run.issuedAt,
    authorization: run.authorization,
  });
  if (routes === undefined) {
    fail(contractInvalid({ stage: "I8", detailCode: "acceptance-routes-missing", occurredAt }));
  }
  const decisionRefs: (RouteDecisionRefV1 | ReviewDecisionRefV1)[] = [];
  const closedGroupRefs: IdentificationGroupRefV1[] = [];
  const pendingGroupRefs: IdentificationGroupRefV1[] = [];
  for (const route of routes) {
    if (route.routeKind === "automatic") {
      decisionRefs.push(route.routeDecisionRef);
      continue;
    }
    const read = await ports.reviewDecisionReader.readIdentificationGroupDecision({
      projectId: run.projectId,
      groupRef: route.groupRef,
      reviewTaskRef: route.reviewTaskRef,
      authorization: run.authorization,
      invocationId: actionIdFor(run, `I8:${route.groupVersionId}`),
      requestedAt: run.issuedAt,
    });
    if (read.kind === "pending") {
      // 本轮待定：提交集里不含该组的决定，C22 会按待定跳过它，其它合格组照常入库。
      pendingGroupRefs.push(route.groupRef);
      continue;
    }
    if (read.kind === "blocked") {
      // 决定窄读本身不成立（事实错配、已替代、跨工程或读取失败）：不可据此提交整集验收。
      fail(contractInvalid({ stage: "I8", detailCode: read.detailCode, occurredAt }));
    }
    if (decisionDispositionFor(read.decisionKind) !== "continue") {
      closedGroupRefs.push(route.groupRef);
    }
    decisionRefs.push(read.reviewDecisionRef);
  }
  // 验收动作身份只取决于「本轮提交的决定集」：同决定集重放同一身份，新决定集得到新身份。
  const acceptanceSuffix = `I8:${sha256CanonicalJson(
    decisionRefs.map((ref) => `${ref.kind}/${ref.reference.entityId}/${ref.reference.versionId}`),
  ).slice(0, 32)}`;
  const submitted = await submitGroupAcceptance({
    ports,
    run,
    occurredAt,
    acceptanceSuffix,
    acceptanceRouteSetRef,
    routes,
    decisionRefs,
  });
  const rejectedGroupRefs = [...closedGroupRefs, ...submitted.skippedGroupRefs];
  return await advance({
    ports,
    run,
    state,
    stage: "I8",
    actionSuffix: acceptanceSuffix,
    nextStage: "I9",
    cursor,
    stageResultRow: true,
    commandKind: "identification-graph.i8",
    stageResult: IdentificationStageResultV1Schema.parse({
      schemaVersion: "1",
      runRef: run.runRef,
      recordedAt: occurredAt,
      stage: "I8",
      standardizedRiskRecordRefs: submitted.records,
      eventRefs: submitted.events,
    }),
    cursorPatch: {
      acceptedRiskRecordRefs: [...cursor.acceptedRiskRecordRefs, ...submitted.records],
      rejectedGroupRefs: [...cursor.rejectedGroupRefs, ...rejectedGroupRefs],
      pendingGroupRefs: [...pendingGroupRefs],
    },
    statePatch: {
      acceptedRiskRecordRefs: [...state.acceptedRiskRecordRefs, ...submitted.records],
      rejectedGroupRefs: [...state.rejectedGroupRefs, ...rejectedGroupRefs],
    },
  });
};

/** I9 运行结果身份：由工程、运行与汇总正文确定性派生，重放不产生新身份。 */
const identificationRunResultRefFor = (input: {
  readonly projectId: string;
  readonly runId: string;
  readonly runResult: unknown;
}) => ({
  kind: "identification-run-result" as const,
  reference: {
    entityId: `identification-run-result:${input.projectId}:${input.runId}`,
    versionId: sha256CanonicalJson(input.runResult),
  },
});

/** I9：全部工作项与分组达到稳定终态后形成不可变运行汇总；等待与阻断都不伪装为完成。 */
const stageI9: StageHandlerV1 = async ({ ports, run, state }) => {
  const occurredAt = ports.now().toISOString();
  const cursor = await readCursor({ ports, run });
  const workPlanRef = state.workPlanRef;
  if (cursor === undefined || workPlanRef === undefined) {
    fail(contractInvalid({ stage: "I9", detailCode: "work-plan-missing", occurredAt }));
  }
  const workPlan = await ports.bodies.readWorkPlanBody({
    projectId: run.projectId,
    workPlanRef,
    actorId: run.actorId,
    requestedAt: run.issuedAt,
    authorization: run.authorization,
  });
  if (workPlan === undefined) {
    fail(contractInvalid({ stage: "I9", detailCode: "work-plan-body-missing", occurredAt }));
  }
  const completed = new Set(cursor.completedWorkItemRefs.map((ref) => ref.reference.entityId));
  const failedItems = new Set(cursor.failedWorkItemRefs.map((ref) => ref.reference.entityId));
  const rejectedGroups = new Set(cursor.rejectedGroupRefs.map((ref) => ref.reference.entityId));
  const pendingGroups = new Set(cursor.pendingGroupRefs.map((ref) => ref.reference.entityId));
  const routes =
    cursor.acceptedRouteSetRef === undefined
      ? []
      : await ports.acceptanceRoutes.readRoutes({
          projectId: run.projectId,
          acceptanceRouteSetRef: cursor.acceptedRouteSetRef,
          actorId: run.actorId,
          requestedAt: run.issuedAt,
          authorization: run.authorization,
        });
  if (routes === undefined) {
    fail(contractInvalid({ stage: "I9", detailCode: "acceptance-routes-missing", occurredAt }));
  }
  const summary = summarizeIdentificationRun({
    projectId: run.projectId,
    runRef: run.runRef,
    parentRiskFlowRunRef: run.parentRiskFlowRunRef,
    preparationSnapshotRef: run.preparationSnapshotRef,
    inputSnapshotRef: workPlan.inputSnapshotRef,
    workPlanRef,
    plannedWorkItemRefs: workPlan.workItems.map((item) => item.workItemRef),
    workItemOutcomes: workPlan.workItems.map((item) => {
      const entityId = item.workItemRef.reference.entityId;
      if (failedItems.has(entityId)) {
        return { kind: "failed" as const, workItemRef: item.workItemRef };
      }
      if (completed.has(entityId)) {
        return { kind: "accepted" as const, workItemRef: item.workItemRef };
      }
      return { kind: "skipped" as const, workItemRef: item.workItemRef };
    }),
    // 待复核组必须投影为 `pending-review`：`summarizeIdentificationRun` 据此保持 waiting，
    // 既不生成 completed 汇总，也不把待复核组算作已验收（spec「仍有待复核组」）。
    groupOutcomes: routes.map((route) => {
      const entityId = route.groupRef.reference.entityId;
      if (rejectedGroups.has(entityId)) {
        return { kind: "rejected" as const, groupRef: route.groupRef };
      }
      if (pendingGroups.has(entityId) && route.routeKind === "review") {
        return {
          kind: "pending-review" as const,
          groupRef: route.groupRef,
          reviewTaskRef: route.reviewTaskRef,
        };
      }
      return { kind: "accepted" as const, groupRef: route.groupRef };
    }),
    acceptedRiskRecordRefs: cursor.acceptedRiskRecordRefs,
    acceptedEventRefs: [],
    auditTrailRef: auditTrailRefFor(run),
    recordedAt: occurredAt,
  });
  if (summary.kind === "waiting") {
    // 待定组的权威身份来自 C24 自己的登记事实证明，复核任务必须与该组精确配对。
    const pendingGroup = cursor.pendingGroupRefs[0];
    const pendingRoute = routes.find(
      (route) =>
        route.routeKind === "review" &&
        pendingGroup !== undefined &&
        route.groupRef.reference.entityId === pendingGroup.reference.entityId,
    );
    if (
      pendingGroup === undefined ||
      pendingRoute === undefined ||
      pendingRoute.routeKind !== "review"
    ) {
      fail(contractInvalid({ stage: "I9", detailCode: "pending-review-mismatch", occurredAt }));
    }
    // 游标停在 I8：复核决定落地后的恢复先重入 I8 入库新决组，再进入 I9 收口。
    return await waitFor({
      ports,
      run,
      state,
      stage: "I8",
      cursor,
      suffix: `I9:waiting:${pendingGroup.reference.entityId}`,
      waiting: {
        kind: "human-review",
        reviewTaskRef: pendingRoute.reviewTaskRef,
        groupRef: pendingGroup,
      },
    });
  }
  if (summary.kind === "blocked") {
    fail(
      graphError({
        code: "CONTRACT_INVALID",
        stage: "I9",
        detailCode: summary.reasonCode,
        occurredAt,
      }),
    );
  }
  const runResult = summary.runResult;
  const runResultRef = identificationRunResultRefFor({
    projectId: run.projectId,
    runId: run.runRef.reference.entityId,
    runResult,
  });
  const runResultArtifactId = artifactIdFor("run-result", run.runRef.reference.entityId, "I9");
  return await advance({
    ports,
    run,
    state,
    stage: "I9",
    actionSuffix: `I9:${runResultRef.reference.versionId.slice(0, 32)}`,
    nextStage: "I9",
    cursor,
    stageResultRow: true,
    status: "completed",
    commandKind: "identification-graph.i9",
    stageResult: IdentificationStageResultV1Schema.parse({
      schemaVersion: "1",
      runRef: run.runRef,
      recordedAt: occurredAt,
      stage: "I9",
      identificationRunResultRef: runResultRef,
    }),
    extraBodies: [
      { artifactId: runResultArtifactId, build: () => ({ bodyKind: "run-result", runResult }) },
    ],
    extraRows: ({ artifactRefs, runVersionId, auditEntryId }) => [
      IdentificationGraphResultRowV1Schema.parse({
        ...rowBase({
          run,
          artifactRef: artifactRefFrom(artifactRefs, runResultArtifactId),
          runVersionId,
          resultKind: "run-result",
          idempotencySuffix: "I9:run-result",
          auditEntryId,
          recordedAt: occurredAt,
          validAt: run.validAt,
        }),
        resultId: runResultRef.reference.entityId,
        resultVersionId: runResultRef.reference.versionId,
        resultKind: "run-result",
        workPlanRef,
        runResultRef,
      }),
    ],
    cursorPatch: { resultRef: runResultRef },
    statePatch: { resultRef: runResultRef },
  });
};

const stageHandlers: Readonly<Record<IdentificationStageV1, StageHandlerV1>> = {
  I0: stageI0,
  I1: stageI1,
  I2: stageI2,
  I3: stageI3,
  I4: stageI4,
  I5: stageI5,
  I6: stageI6,
  I7: stageI7,
  I8: stageI8,
  I9: stageI9,
};

/** 节点失败：登记稳定错误与游标，图按状态收口到可重试或终止（design D-10）。 */
const recordNodeFailure = async (input: {
  readonly ports: IdentificationGraphPortsV1;
  readonly run: IdentificationGraphRunContextV1;
  readonly state: IdentificationGraphStateV1;
  readonly stage: IdentificationStageV1;
  readonly error: unknown;
}): Promise<IdentificationGraphStateV1> => {
  const { ports, run, state, stage } = input;
  const occurredAt = ports.now().toISOString();
  const error = toIdentificationGraphError({ stage, error: input.error, occurredAt });
  const attempts = await failureAttempts(ports, run, error.stage, error.detailCode);
  const retryable = error.retryable && attempts < (await retryBudget(ports, run, state));
  const stableError = IdentificationGraphErrorV1Schema.parse({ ...error, retryable });
  const workflowErrorRef = {
    kind: "workflow-error" as const,
    reference: {
      entityId: `identification-graph-workflow-error:${error.stage}:${error.detailCode}`,
      versionId: sha256CanonicalJson({ error: stableError, attempt: attempts + 1 }),
    },
  };
  const suffix = `${stage}:failure:${error.detailCode}:attempt-${attempts + 1}`;
  const runStateArtifactId = artifactIdFor("run-state", run.runRef.reference.entityId, suffix);
  const cursor = await readCursor({ ports, run });
  const cursorState = cursorBody({
    runId: run.runRef.reference.entityId,
    stage,
    status: retryable ? "retryable-failure" : "terminal-failure",
    previous: cursor,
    patch: { lastErrorRef: workflowErrorRef },
  });
  const actionId = actionIdFor(run, suffix);
  await commitStage(ports, run, {
    actionSuffix: suffix,
    commandKind: "identification-graph.failure",
    bodies: [{ artifactId: runStateArtifactId, build: () => cursorState.body }],
    runVersionId: cursorState.state.runVersionId,
    expectedRunVersionId: cursor?.runVersionId,
    occurredAt,
    rows: (refs, runVersionId) => {
      const runStateRef = artifactRefFrom(refs, runStateArtifactId);
      return [
        IdentificationGraphResultRowV1Schema.parse({
          ...rowBase({
            run,
            artifactRef: runStateRef,
            runVersionId,
            resultKind: "workflow-error",
            idempotencySuffix: suffix,
            auditEntryId: `${actionId}:audit`,
            recordedAt: occurredAt,
            validAt: run.validAt,
          }),
          resultKind: "workflow-error",
          workflowErrorRef,
        }),
        IdentificationGraphResultRowV1Schema.parse({
          ...rowBase({
            run,
            artifactRef: runStateRef,
            runVersionId,
            resultKind: "run-state",
            idempotencySuffix: `${suffix}:run-state:${runVersionId}`,
            auditEntryId: `${actionId}:audit`,
            recordedAt: occurredAt,
            validAt: run.validAt,
          }),
          resultKind: "run-state",
        }),
      ];
    },
  });
  return parseIdentificationGraphState(
    {
      ...state,
      stage,
      status: retryable ? "retryable-failure" : "terminal-failure",
      lastErrorRef: workflowErrorRef,
    },
    occurredAt,
  );
};

/** 同一阶段同一错误码的历史失败次数：动作身份不变，attempt 单调增加（design D-05）。 */
const failureAttempts = async (
  ports: IdentificationGraphPortsV1,
  run: IdentificationGraphRunContextV1,
  stage: IdentificationStageV1,
  detailCode: string,
): Promise<number> => {
  const rows = await ports.registrationStore.listRunRows({
    projectId: run.projectId,
    runId: run.runRef.reference.entityId,
    actorId: run.actorId,
    authorization: run.authorization,
    requestedAt: run.issuedAt,
  });
  const prefix = `identification-graph-workflow-error:${stage}:${detailCode}`;
  return rows.filter(
    (row) =>
      row.resultKind === "workflow-error" &&
      row.workflowErrorRef.reference.entityId.startsWith(prefix),
  ).length;
};

/** 冻结重试预算：只来自策略集，不来自调用方或墙钟（design D-05）。 */
const retryBudget = async (
  ports: IdentificationGraphPortsV1,
  run: IdentificationGraphRunContextV1,
  state: IdentificationGraphStateV1,
): Promise<number> => {
  try {
    if (state.inputSnapshotRef === undefined) {
      const policy = await ports.policyProvider.resolveExact({
        projectId: run.projectId,
        preparationSnapshotRef: run.preparationSnapshotRef,
        requiredAt: run.validAt,
        asOfRecordedAt: run.issuedAt,
        authorization: run.authorization,
      });
      return policy?.retryPolicy.maxAttempts ?? 1;
    }
    const policy = await readFrozenPolicyForRun({ ports, run, state, stage: state.stage });
    return policy.retryPolicy.maxAttempts;
  } catch {
    return 1;
  }
};

/** 编译 I0～I9 子图；checkpointer 由组合根提供（design D-02）。 */
export const createIdentificationGraph = (options: {
  readonly ports: IdentificationGraphPortsV1;
  readonly checkpointer: BaseCheckpointSaver;
}): IdentificationGraphRunnerV1 => {
  const graph = new StateGraph<
    typeof channelsAnnotation.spec,
    GraphChannelsV1,
    GraphChannelsV1,
    NodeNameV1
  >(channelsAnnotation);
  for (const stage of STAGE_SEQUENCE_V1) {
    graph.addNode(NODE_FOR_STAGE_V1[stage], async (channels, config) => {
      const run = readRunContext({ config, occurredAt: options.ports.now().toISOString() });
      const state = parseIdentificationGraphState(
        { ...stateOfChannels(channels), stage },
        options.ports.now().toISOString(),
      );
      try {
        const handler = stageHandlers[stage];
        return stateAsUpdate(await handler({ ports: options.ports, run, state }));
      } catch (error: unknown) {
        if (isGraphBubbleUp(error)) throw error;
        if (
          typeof error === "object" &&
          error !== null &&
          "stage" in error &&
          error.stage === "identification-graph.run-version"
        ) {
          throw new IdentificationGraphNodeFailureV1(
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
    const state = parseIdentificationGraphState(
      stateOfChannels(channels),
      options.ports.now().toISOString(),
    );
    readRunContext({ config, occurredAt: options.ports.now().toISOString() });
    const resumeValue: unknown = interrupt(state.waitingRef);
    if (!isResumeValue(resumeValue)) {
      fail(
        contractInvalid({
          stage: state.stage,
          detailCode: "resume-value-invalid",
          occurredAt: options.ports.now().toISOString(),
        }),
      );
    }
    const { waitingRef, ...rest } = state;
    // 恢复必须以精确等待引用为依据：引用缺失时不进入运行态，按契约不一致失败闭合，
    // 避免无等待事实的运行被当作已恢复推进。
    if (waitingRef === undefined) {
      fail(
        contractInvalid({
          stage: state.stage,
          detailCode: "waiting-reference-missing",
          occurredAt: options.ports.now().toISOString(),
        }),
      );
    }
    return stateAsUpdate(
      parseIdentificationGraphState(
        { ...rest, status: "running" },
        options.ports.now().toISOString(),
      ),
    );
  });
  graph.addEdge(START, NODE_FOR_STAGE_V1.I0);
  const routes: Record<string, NodeNameV1> = {
    [END]: END,
    [WAIT_NODE_V1]: WAIT_NODE_V1,
  };
  for (const stage of STAGE_SEQUENCE_V1) {
    routes[NODE_FOR_STAGE_V1[stage]] = NODE_FOR_STAGE_V1[stage];
  }
  const router = (channels: GraphChannelsV1): NodeNameV1 => {
    if (channels.status === "waiting") return WAIT_NODE_V1;
    if (channels.status === "running" || channels.status === "pending") {
      return NODE_FOR_STAGE_V1[channels.stage];
    }
    return END;
  };
  for (const stage of STAGE_SEQUENCE_V1) {
    graph.addConditionalEdges(NODE_FOR_STAGE_V1[stage], router, routes);
  }
  graph.addConditionalEdges(WAIT_NODE_V1, router, routes);
  // `durability: "sync"`：LangGraph 默认 async 会让节点写回与 put 并发，putWrites 可能先于父检查点
  // 落库而被 checkpointer 判为不一致（design D-07 要求检查点写入结果确定、恢复可对账）。
  // 该选项在调用期生效：每个 superstep 末等待检查点落库后再继续。
  const compiled = graph.compile({ checkpointer: options.checkpointer });
  return {
    invoke: (input, config) => compiled.invoke(input.graph, { ...config, durability: "sync" }),
    resume: (input, config) =>
      compiled.invoke(
        new Command<IdentificationGraphResumeCauseV1, GraphChannelsV1, NodeNameV1>({
          resume: input.resume,
        }),
        { ...config, durability: "sync" },
      ),
    retry: (state, config) =>
      compiled.invoke(
        new Command<IdentificationGraphResumeCauseV1, GraphChannelsV1, NodeNameV1>({
          update: stateAsUpdate({ ...state, status: "running" }),
          goto: NODE_FOR_STAGE_V1[state.stage],
        }),
        { ...config, durability: "sync" },
      ),
    getState: (config) => compiled.getState(config),
  };
};
